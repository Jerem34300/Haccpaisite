/**
   * supabaseService.js — Service centralisé pour toutes les interactions Supabase
   *
   * Ce module gère :
   *   - La configuration et les tokens de session
   *   - La queue d'envoi hors-ligne (persistence locale + flush vers Supabase)
   *   - L'upload de photos vers Supabase Storage
   *   - La synchronisation des données
   *   - Le rafraîchissement automatique du token
   *
   * Dépend de : supabaseConfig.js, utils.js
   *
   * API publique exposée via le module (fonctions globales suffixées "Supa") :
   *   - openSupaModal()       — Ouvrir le panneau de configuration Supabase
   *   - supaFlushNow()        — Forcer l'envoi immédiat de la queue
   *   - supaTestConnection()  — Tester la connexion Supabase
   *   - startSupaTokenRefresh() — Démarrer le rafraîchissement auto du token
   *   - clearSupaQueue()      — Vider la queue locale
   *   - resetCompleteLocal()  — Réinitialisation complète des données locales
   *
   * Usage interne via la queue :
   *   - enqueue(record)       — Ajouter un enregistrement à la queue
   *   - scheduleFlush()       — Planifier un envoi différé
   */

  
// ════════════════════════════════════════════════════
const SUPA_QUEUE_KEY = 'haccp_supa_queue_v1';
const SUPA_CFG_KEY   = 'haccp_supa_cfg_v1';
const _PMS_URL_DEFAULT = SUPABASE_URL;
const _PMS_KEY_DEFAULT = SUPABASE_ANON_KEY;

const SupaEngine = (() => {
  let _flushing = false;
  let _flushTimer = null;

  // ── Config ────────────────────────────────────────
  function cfg() {
    // Priorité : clé dédiée (persiste entre fichiers HTML)
    try {
      const raw = localStorage.getItem(SUPA_CFG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (!parsed.url) parsed.url = _PMS_URL_DEFAULT;
        if (!parsed.anonKey) parsed.anonKey = _PMS_KEY_DEFAULT;
        return parsed;
      }
    } catch{}
    // Migration : app-login.js écrit dans 'haccpro_supa_cfg', on migre vers la clé officielle
    try {
      const loginRaw = localStorage.getItem('haccpro_supa_cfg');
      if (loginRaw) {
        const lc = JSON.parse(loginRaw);
        if (lc.userToken && lc.siteId) {
          const migrated = {
            url: lc.url || _PMS_URL_DEFAULT,
            anonKey: lc.anonKey || _PMS_KEY_DEFAULT,
            userToken: lc.userToken,
            refreshToken: lc.refreshToken || '',
            siteId: lc.siteId,
            siteNom: lc.siteNom || '',
            tenantId: lc.tenantId || '',
            userRole: lc.userRole || 'cuisinier',
            userEmail: lc.userEmail || '',
          };
          try { localStorage.setItem(SUPA_CFG_KEY, JSON.stringify(migrated)); } catch(e){}
          return migrated;
        }
      }
    } catch{}
    // Fallback : S.supaCfg
    if (typeof S !== 'undefined' && S.supaCfg && S.supaCfg.url) return S.supaCfg;
    // Défaut intégré
    return { url: _PMS_URL_DEFAULT, anonKey: _PMS_KEY_DEFAULT };
  }
  function saveCfgLocal(o) {
    // Toujours sauvegarder dans la clé dédiée EN PREMIER
    try { localStorage.setItem(SUPA_CFG_KEY, JSON.stringify(o)); } catch(e){}
    // Et aussi dans S pour la cohérence
    try { if(typeof S !== 'undefined'){ S.supaCfg = o; if(typeof save==='function') save(); } } catch(e){}
  }
  function freshToken(baseCfg){
    // Lecture synchrone du token — utilisé comme fallback
    try{
      var stored=localStorage.getItem('sb-lthxpucxjcwzphshdhmp-auth-token');
      if(stored){var p=JSON.parse(stored);if(p&&p.access_token)return p.access_token;}
    }catch(e){}
    return baseCfg.userToken||baseCfg.anonKey;
  }

  // Garantit un token valide avant flush — rafraichit si expire
  async function _ensureFreshToken(c) {
    // 1. Supabase JS client (autoRefresh integre)
    try {
      if (window._supaClient) {
        var sess = await window._supaClient.auth.getSession();
        var s = sess && sess.data && sess.data.session;
        if (s && s.access_token) {
          if (s.access_token !== c.userToken) {
            c.userToken = s.access_token;
            if (s.refresh_token) c.refreshToken = s.refresh_token;
            saveCfgLocal(c);
            _supaLog('[TOKEN] Rafraichi via session client');
          }
          return s.access_token;
        }
      }
    } catch(e) { _supaLog('[TOKEN] getSession erreur : ' + e.message); }

    // 2. Refresh manuel via refresh_token
    if (c.refreshToken && c.url && c.anonKey) {
      try {
        var r = await fetch(c.url + '/auth/v1/token?grant_type=refresh_token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': c.anonKey },
          body: JSON.stringify({ refresh_token: c.refreshToken })
        });
        if (r.ok) {
          var d2 = await r.json();
          if (d2.access_token) {
            c.userToken = d2.access_token;
            if (d2.refresh_token) c.refreshToken = d2.refresh_token;
            saveCfgLocal(c);
            _supaLog('[TOKEN] Rafraichi via refresh_token');
            return d2.access_token;
          }
        }
      } catch(e) { _supaLog('[TOKEN] refresh_token erreur : ' + e.message); }
    }

    // 3. Fallback : token stocke ou anon key
    return freshToken(c);
  }

  function isEnabled() {
    const c = cfg();
    return !!(c.url && c.anonKey && c.siteId);
  }

  // ── Queue ─────────────────────────────────────────
  function getQueue() {
    try { return JSON.parse(localStorage.getItem(SUPA_QUEUE_KEY)||'[]'); } catch{ return []; }
  }
  function setQueue(q) {
    try { localStorage.setItem(SUPA_QUEUE_KEY, JSON.stringify(q)); } catch(e){}
  }
  function qStats() {
    const q = getQueue();
    return {
      pending: q.filter(e=>e.status==='pending').length,
      synced:  q.filter(e=>e.status==='synced').length,
      errors:  q.filter(e=>e.status==='error').length,
    };
  }

  // ── Enqueue ───────────────────────────────────────
  // ── Détection de base64 image dans une valeur ─────
  function _isB64Photo(val) {
    if (typeof val !== 'string') return false;
    if (val.startsWith('data:image/')) return true;
    // JSON {thumb, file, date} contenant un thumb base64
    if (val.startsWith('{') && val.includes('"thumb"') && val.includes('data:image/')) return true;
    return false;
  }

  // ── Extraire {thumb, full, file} depuis un champ photo ─
  function _parsePhotoField(val, fullPhotos, fieldKey) {
    if (!val) return null;
    if (typeof val === 'string' && val.startsWith('data:image/')) {
      return { full: fullPhotos?.[fieldKey] || val, thumb: val, file: '' };
    }
    if (typeof val === 'string' && val.startsWith('{')) {
      try {
        const o = JSON.parse(val);
        return {
          full: fullPhotos?.[fieldKey] || o.thumb || '',
          thumb: o.thumb || '',
          file: o.file || '',
        };
      } catch { return null; }
    }
    return null;
  }

  // ── Upload vers Supabase Storage ───────────────────
  async function _uploadToStorage(b64, storagePath, c, authToken) {
    if (!b64 || !b64.startsWith('data:image/')) throw new Error('Données image invalides');
    const [meta, data] = b64.split(',');
    const mime = (meta.match(/:(.*?);/) || [])[1] || 'image/jpeg';
    const binary = atob(data);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    const blob = new Blob([arr], { type: mime });
    const r = await fetch(`${c.url}/storage/v1/object/pms-photos/${storagePath}`, {
      method: 'POST',
      headers: {
        'apikey': c.anonKey,
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': mime,
        'x-upsert': 'true',
      },
      body: blob,
    });
    if (!r.ok) {
      const t = await r.text().catch(()=>'');
      throw new Error(`Storage HTTP ${r.status} — ${t.slice(0,60)}`);
    }
    return `${c.url}/storage/v1/object/public/pms-photos/${storagePath}`;
  }

  // ── Traitement des photos d'une entrée avant POST ──
  // Modifie entry.data en place, remplace base64 par URLs publiques
  async function _processEntryPhotos(entry, c, authToken) {
    const date = (entry.recorded_at||'').slice(0,10) || 'nodate';
    const siteId = (entry.site_id||'SITE').toUpperCase();
    const enrType = entry.enr_type || 'enr';
    const fullPhotos = entry._fullPhotos || {};
    const qShort = (entry.qid||'').slice(0,8);
    let uploaded = 0, failed = 0;

    const photoEntries = Object.entries(entry.data).filter(([,v]) => _isB64Photo(v));
    if (!photoEntries.length) { delete entry._fullPhotos; return { uploaded, failed }; }

    // Upload en parallèle par lots de 3 pour ne pas saturer la tablette
    const CONCURRENCY = 3;
    for (let i = 0; i < photoEntries.length; i += CONCURRENCY) {
      const chunk = photoEntries.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(chunk.map(async ([key, val]) => {
        const parsed = _parsePhotoField(val, fullPhotos, key);
        if (!parsed) throw new Error('parse failed');
        const sourceB64 = parsed.full || parsed.thumb;
        if (!sourceB64 || !sourceB64.startsWith('data:image/')) throw new Error('no b64');
        const storagePath = `${siteId}/${enrType}/${date}/${key}_${qShort}.jpg`;
        const publicUrl = await _uploadToStorage(sourceB64, storagePath, c, authToken);
        entry.data[key] = JSON.stringify({
          url: publicUrl,
          thumb_url: publicUrl,
          file: parsed.file || storagePath.split('/').pop(),
          date,
          storage: 'supabase',
        });
        _supaLog(`📷 Photo uploadée : ${key} → ${storagePath}`);
        return key;
      }));
      for (let j = 0; j < results.length; j++) {
        const [key] = chunk[j];
        if (results[j].status === 'fulfilled') {
          uploaded++;
        } else {
          const msg = (results[j].reason?.message || 'erreur').slice(0, 60);
          const parsed = _parsePhotoField(entry.data[key], fullPhotos, key);
          entry.data[key] = JSON.stringify({ file: parsed?.file || '', date, upload_error: msg });
          failed++;
          _supaLog(`⚠️ Photo ${key} : ${msg}`);
        }
      }
    }

    delete entry._fullPhotos;
    return { uploaded, failed };
  }

  function enqueue(enrType, record) {
    if (!isEnabled()) {
      // Debug : afficher pourquoi on skip
      const c = cfg();
      if (!c.url || !c.anonKey || !c.siteId) {
        console.warn('[SupaEngine] enqueue skipped — config manquante', {url:!!c.url, key:!!c.anonKey, site:c.siteId});
        // Afficher un toast une fois toutes les 5 min max
        const now = Date.now();
        const last = parseInt(localStorage.getItem('_supa_warn_ts')||'0');
        if (now - last > 300000) {
          localStorage.setItem('_supa_warn_ts', String(now));
          if (typeof toast === 'function') toast('⚠️ Config Supabase manquante — ouvrez ⚙️ → 🗄️ et validez', 'warning');
        }
      }
      return;
    }
    const c = cfg();
    const q = getQueue();

    // Copier les données telles quelles (photos incluses — thumb = ~5 Ko)
    const data = {...record};

    // Capturer la pleine résolution depuis _pendingPhotos (en mémoire, avant nettoyage)
    // _pendingPhotos est défini globalement dans le PMS
    const fullPhotos = {};
    const pendingRef = (typeof _pendingPhotos !== 'undefined') ? _pendingPhotos : {};
    // Map des préfixes _pendingPhotos vers les clés de champ du draft
    const pfxToField = { p1: 'p1_photo', p2: 'p2_photo', enr31: 'photo', enr31_2: 'photo2', enr31_3: 'photo3' };
    for (const [pfx, field] of Object.entries(pfxToField)) {
      if (pendingRef[pfx] && data[field]) {
        fullPhotos[field] = pendingRef[pfx]; // pleine résolution
      }
    }
    // Champs photo custom non couverts par les préfixes connus :
    // on détecte directement si le draft a un champ base64 direct
    for (const [key, val] of Object.entries(data)) {
      if (typeof val === 'string' && val.startsWith('data:image/') && !fullPhotos[key]) {
        fullPhotos[key] = val; // déjà pleine résolution
      }
    }

    // client_id DÉTERMINISTE = site_id + enr_type + _ts
    // Cela garantit que le même enregistrement ne peut JAMAIS être inséré deux fois
    // même si supaBackupSync le re-enqueue, la contrainte UNIQUE client_id bloquera
    const stableClientId = [c.siteId, enrType, record._ts || new Date().toISOString()]
      .join('::')
      .replace(/[^a-zA-Z0-9:._-]/g, '_')
      .slice(0, 200);

    // Vérifier si ce client_id est déjà en queue
    const existingInQueue = q.findIndex(e => e.qid === stableClientId);
    if (existingInQueue >= 0) {
      const existing = q[existingInQueue];
      if (existing.status === 'pending') {
        // Encore en attente : mettre à jour les données (ex: soir après midi)
        q[existingInQueue].data = data;
        setQueue(q);
        console.log('[SupaEngine] entrée mise à jour (pending):', stableClientId.slice(0,60));
        return;
      }
      // Déjà synced : retirer et ré-enqueuer avec les nouvelles données
      q.splice(existingInQueue, 1);
      console.log('[SupaEngine] re-enqueue après sync:', stableClientId.slice(0,60));
    }

    q.push({
      qid: stableClientId,
      enr_type: enrType,
      data,
      _fullPhotos: Object.keys(fullPhotos).length ? fullPhotos : undefined,
      recorded_at: record._ts || new Date().toISOString(),
      site_id: c.siteId,
      tenant_id: c.tenantId || null,
      status: 'pending',
      retries: 0,
    });
    setQueue(q);
    _updateBadge();
    scheduleFlush();
  }

  // ── Flush ─────────────────────────────────────────
  function scheduleFlush(delay=3000) {
    if (_flushTimer) clearTimeout(_flushTimer);
    _flushTimer = setTimeout(flush, delay);
  }

  async function flush() {
    if (!isEnabled() || !navigator.onLine || _flushing) return;
    const q = getQueue();
    const now = new Date().toISOString();
    const pending = q.filter(e =>
      e.status === 'pending' ||
      (e.status === 'error' && e.retries < 5 && (!e.next_retry_at || e.next_retry_at <= now))
    );
    if (!pending.length) return;

    _flushing = true;
    _updateBadge('syncing');
    const c = cfg();
    // Toujours garantir un token valide avant d'envoyer (gere JWT expired)
    const authToken = await _ensureFreshToken(c);
    let hasError = false;
    let syncedCount = 0;
    let totalPhotos = 0;

    for (const entry of pending) {
      try {
        // ── 1. Uploader les photos vers Storage ──────
        const hasPhotos = Object.values(entry.data||{}).some(_isB64Photo) || !!entry._fullPhotos;
        if (hasPhotos) {
          const { uploaded, failed } = await _processEntryPhotos(entry, c, authToken);
          totalPhotos += uploaded;
          if (failed > 0) _supaLog(`⚠️ ${failed} photo(s) non uploadée(s) pour ${entry.enr_type}`);
          // Remettre à jour dans la queue locale (les base64 sont maintenant des URLs)
          setQueue(q);
        }

        // ── 2. POST l'enregistrement ─────────────────
        const payload = {
          site_id: entry.site_id,
          enr_type: entry.enr_type,
          data: entry.data,
          recorded_at: entry.recorded_at,
          client_id: entry.qid,
          ...(entry.tenant_id ? { tenant_id: entry.tenant_id } : (c.tenantId ? { tenant_id: c.tenantId } : {})),
        };
        const r = await fetch(`${c.url}/rest/v1/pms_records`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': c.anonKey,
            'Authorization': `Bearer ${authToken}`,
            'Prefer': 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify(payload),
        });
        if (!r.ok) {
          const errTxt = await r.text().catch(()=>'');
          // 409 = conflit client_id UNIQUE → faire un PATCH pour vraiment mettre à jour
          // (merge-duplicates de PostgREST ne marche pas si la contrainte n'est pas reconnue)
          if (r.status === 409) {
            try {
              const patchBody = {
                data: entry.data,
                recorded_at: entry.recorded_at,
                ...(entry.tenant_id ? { tenant_id: entry.tenant_id } : (c.tenantId ? { tenant_id: c.tenantId } : {})),
              };
              const rPatch = await fetch(
                `${c.url}/rest/v1/pms_records?client_id=eq.${encodeURIComponent(entry.qid)}`,
                {
                  method: 'PATCH',
                  headers: {
                    'Content-Type': 'application/json',
                    'apikey': c.anonKey,
                    'Authorization': `Bearer ${authToken}`,
                    'Prefer': 'return=minimal',
                  },
                  body: JSON.stringify(patchBody),
                }
              );
              if (rPatch.ok) {
                entry.status = 'synced';
                entry.synced_at = new Date().toISOString();
                syncedCount++;
                _supaLog(`✅ ${entry.enr_type} (mis à jour via PATCH)`);
                continue;
              }
              const patchErr = await rPatch.text().catch(()=>'');
              throw new Error(`PATCH HTTP ${rPatch.status}${patchErr?' — '+patchErr.slice(0,80):''}`);
            } catch(patchE) {
              // Fallback : si le PATCH échoue aussi, marquer synced quand même (au moins le POST initial était en base)
              entry.status = 'synced';
              entry.synced_at = new Date().toISOString();
              syncedCount++;
              _supaLog(`⚠️ ${entry.enr_type} POST 409 + PATCH échec : ${patchE.message.slice(0,60)}`);
              continue;
            }
          }
          throw new Error(`HTTP ${r.status}${errTxt?' — '+errTxt.slice(0,80):''}`);
        }
        entry.status = 'synced';
        entry.synced_at = new Date().toISOString();
        syncedCount++;
        _supaLog(`✅ ${entry.enr_type} (${entry.recorded_at?.slice(0,10)}) envoyé`);
      } catch(e) {
        entry.status = 'error';
        entry.retries = (entry.retries||0) + 1;
        entry.last_error = e.message;
        // Backoff exponentiel : 3s, 6s, 12s, 24s, 48s (max 5 essais)
        entry.next_retry_at = new Date(Date.now() + Math.min(3000 * Math.pow(2, entry.retries - 1), 48000)).toISOString();
        hasError = true;
        _supaLog(`⚠️ ${entry.enr_type} erreur (essai ${entry.retries}) : ${e.message}`);
      }
    }

    // Garder les synced des 6 derniers mois (pas de limite arbitraire)
    const updated = q.map(e => pending.find(p=>p.qid===e.qid) || e);
    const cutoff6m = new Date(Date.now() - 186 * 24 * 3600 * 1000).toISOString();
    const synced  = updated.filter(e => e.status==='synced' && (e.recorded_at||'') >= cutoff6m);
    const rest    = updated.filter(e => e.status!=='synced');
    setQueue([...rest, ...synced]);

    _flushing = false;
    if (syncedCount > 0) {
      const c2 = cfg(); c2.lastSync = new Date().toISOString();
      if (totalPhotos > 0) c2.lastPhotoSync = new Date().toISOString();
      saveCfgLocal(c2);
    }
    _updateBadge(hasError ? 'error' : 'ok');
    _refreshModalStats();
  }

  // ── Test connexion ────────────────────────────────
  async function testConnection() {
    if (!isEnabled()) { _supaLog('⚠️ Configuration incomplète', true); return; }
    const c = cfg();
    _supaLog('🔌 Test de connexion…', true);
    let ok = true;
    try {
      const r = await fetch(`${c.url}/rest/v1/pms_records?limit=1`, {
        headers:{ 'apikey': c.anonKey, 'Authorization':`Bearer ${c.anonKey}` }
      });
      if (r.ok || r.status===406) {
        _supaLog('✅ Table pms_records accessible');
      } else {
        _supaLog(`❌ Table pms_records — HTTP ${r.status}`); ok=false;
      }
    } catch(e) {
      _supaLog(`❌ Impossible de joindre Supabase : ${e.message}`); ok=false;
    }
    // Tester bucket Storage — upload d'un fichier test
    try {
      const testBlob = new Blob(['ok'], { type: 'text/plain' });
      const testPath = `_test/cnx_${Date.now()}.txt`;
      const testToken = await _ensureFreshToken(c);
      const r2 = await fetch(`${c.url}/storage/v1/object/pms-photos/${testPath}`, {
        method: 'POST',
        headers: {
          'apikey': c.anonKey,
          'Authorization': `Bearer ${testToken}`,
          'Content-Type': 'text/plain',
          'x-upsert': 'true',
        },
        body: testBlob,
      });
      if (r2.ok || r2.status===200) {
        _supaLog('✅ Bucket pms-photos OK — photos activees');
      } else if (r2.status===404) {
        _supaLog('⚠️ Bucket pms-photos introuvable — verifiez Supabase Storage');
        ok = false;
      } else if (r2.status===403 || r2.status===400) {
        const t2 = await r2.text().catch(()=>'');
        _supaLog('❌ Bucket pms-photos : acces refuse (403) — ajoutez les 2 politiques RLS Storage dans Supabase');
        _supaLog('SQL a coller dans Supabase SQL Editor :');
        _supaLog("CREATE POLICY \"auth_upload\" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = \'pms-photos\');");
        _supaLog("CREATE POLICY \"auth_update\" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = \'pms-photos\');");
        ok = false;
      } else {
        const t2 = await r2.text().catch(()=>'');
        _supaLog(`⚠️ Storage HTTP ${r2.status} — ${t2.slice(0,80)}`);
      }
    } catch(e) {
      _supaLog(`⚠️ Storage : ${e.message}`);
    }
    _updateBadge(ok ? 'ok' : 'error');
  }

  // ── Badge header ──────────────────────────────────
  function _updateBadge(state) {
    const el = document.getElementById('supa-sync-badge');
    if (!el) return;
    if (!isEnabled()) { el.style.display='none'; return; }
    el.style.display = 'inline-flex';
    const st = qStats();
    if (state==='syncing') {
      el.textContent='🔄'; el.style.color='#93c5fd'; el.title='Synchronisation…';
    } else if (state==='error' || st.errors>0) {
      el.textContent='⚠️'; el.style.color='#fca5a5'; el.title=`${st.errors} erreur(s)`;
    } else if (st.pending>0) {
      el.textContent=`☁️ ${st.pending}`; el.style.color='#fde68a'; el.title=`${st.pending} en attente`;
    } else {
      el.textContent='☁️'; el.style.color='rgba(255,255,255,.85)'; el.title='Synchronisé';
    }
  }

  // ── Log dans modal ────────────────────────────────
  function _supaLog(msg, clear=false) {
    const el = document.getElementById('supa-log');
    if (!el) return;
    el.style.display='block';
    if (clear) el.innerHTML='';
    const ts = new Date().toTimeString().slice(0,8);
    el.innerHTML += `<div>[${ts}] ${msg}</div>`;
    el.scrollTop = el.scrollHeight;
  }

  function _refreshModalStats() {
    const st = qStats();
    const qi = document.getElementById('supa-queue-info');
    if (qi) qi.style.display = 'block';
    const p = document.getElementById('supa-q-pending');
    const s = document.getElementById('supa-q-synced');
    const err = document.getElementById('supa-q-errors');
    if(p) p.textContent = st.pending;
    if(s) s.textContent = st.synced;
    if(err) err.textContent = st.errors;
    // Activer le bouton flush si pending > 0
    const fb = document.getElementById('supa-flush-btn');
    if(fb){ fb.style.opacity=st.pending>0?'1':'0.5'; fb.style.pointerEvents=st.pending>0?'auto':'none'; }
    // Bouton retry erreurs
    const rb = document.getElementById('supa-retry-btn');
    if(rb) rb.style.display = st.errors>0 ? 'block' : 'none';
    // Status bar
    const dot = document.getElementById('supa-status-dot');
    const txt = document.getElementById('supa-status-txt');
    if (!isEnabled()) {
      if(dot) dot.style.background='#94a3b8';
      if(txt) txt.textContent='Non configuré — renseignez URL, clé et code site';
    } else if (st.errors>0) {
      if(dot) dot.style.background='#dc2626';
      if(txt) txt.textContent=`${st.errors} erreur(s) — vérifiez la configuration`;
    } else if (st.pending>0) {
      if(dot) dot.style.background='#f59e0b';
      if(txt) txt.textContent=`${st.pending} saisie(s) en attente d'envoi`;
    } else {
      const c2 = cfg();
      const last = c2.lastSync ? new Date(c2.lastSync).toLocaleString('fr-FR') : 'jamais';
      if(dot) dot.style.background='#16a34a';
      if(txt) txt.textContent=`Synchronisé — dernière sync : ${last}`;
    }
  }

  function init() {
    // ── Purger les doublons dans la queue locale ──────────
    // Les anciens qid (UUID aléatoires) peuvent causer des doublons en base.
    // On déduplique par (enr_type + recorded_at) en gardant le plus récent.
    try {
      const q = getQueue();
      const seen = new Map(); // clé: enr_type+recorded_at → entrée la plus récente
      q.forEach(e => {
        const k = (e.enr_type||'') + '::' + (e.recorded_at||'');
        const existing = seen.get(k);
        // Garder: synced > pending > error, et si même statut le plus récent
        if (!existing || (e.status==='synced' && existing.status!=='synced') ||
            (e.status===existing.status && (e.synced_at||e.qid) > (existing.synced_at||existing.qid))) {
          seen.set(k, e);
        }
      });
      const deduped = [...seen.values()];
      if (deduped.length < q.length) {
        console.log(`[SupaEngine] init: ${q.length - deduped.length} doublon(s) purgé(s) de la queue`);
        setQueue(deduped);
      }
    } catch(e) { console.warn('[SupaEngine] purge erreur:', e); }

    window.addEventListener('online', () => {
      _supaLog('📶 Réseau disponible — tentative de sync…');
      scheduleFlush(1500);
    });
    window.addEventListener('offline', () => _updateBadge());
    _updateBadge();
    const c = cfg();
    if (isEnabled()) {
      console.log('[SupaEngine] init OK — site:', c.siteId, 'keyLen:', c.anonKey?.length||0);
      if (navigator.onLine) scheduleFlush(5000);
    } else {
      console.warn('[SupaEngine] init — config manquante, sync désactivée', {url:!!c.url, keyLen:c.anonKey?.length||0, site:c.siteId});
    }
  }

  return { init, enqueue, flush, testConnection, isEnabled, cfg, saveCfgLocal, qStats, _updateBadge, _refreshModalStats, _supaLog };
})();

// ── Fonctions UI Supabase Modal ────────────────────────────
function openSupaModal() {
  const c = SupaEngine.cfg();
  const siteEl = document.getElementById('supa-site-id');
  if(siteEl) siteEl.value = c.siteId||'';
  SupaEngine._refreshModalStats();
  const ov = document.getElementById('supa-ov');
  if(ov){ ov.style.opacity='1'; ov.style.pointerEvents='auto'; }
  // Afficher email connecté si dispo
  const statusBar = document.getElementById('supa-status-bar');
  if (statusBar && c.userEmail) {
    const dot = document.getElementById('supa-status-dot');
    const txt = document.getElementById('supa-status-txt');
    if (dot) dot.style.background = '#22c55e';
    if (txt) txt.textContent = '✅ Connecté — ' + c.userEmail;
  }
}
function supaRetryErrors() {
  // Réinitialiser les retries des entrées en erreur → elles repassent en pending
  const queue = JSON.parse(localStorage.getItem('haccp_supa_queue_v1')||'[]');
  let count = 0;
  queue.forEach(e => {
    if (e.status === 'error') {
      e.status = 'pending';
      e.retries = 0;
      e.last_error = null;
      count++;
    }
  });
  localStorage.setItem('haccp_supa_queue_v1', JSON.stringify(queue));
  toast(`🔁 ${count} saisie(s) remises en attente`, 'info');
  SupaEngine._refreshModalStats();
  // Lancer le flush immédiatement
  setTimeout(() => { try { SupaEngine.flush(); } catch{} }, 300);
}

function closeSupaModal() {
  saveSupaCfg(); // sauvegarder à la fermeture aussi
  const ov = document.getElementById('supa-ov');
  if(ov){ ov.style.opacity='0'; ov.style.pointerEvents='none'; }
}
async function supaLoginUser() {
  const c = SupaEngine.cfg();
  if (!c.url || !c.anonKey) { toast('⚠️ Configurez l\'URL et la clé Supabase d\'abord', 'warning'); return; }
  const email = document.getElementById('supa-login-email')?.value?.trim();
  const pass  = document.getElementById('supa-login-pass')?.value;
  const statusEl = document.getElementById('supa-login-status');
  if (!email || !pass) { toast('Email et mot de passe requis', 'warning'); return; }
  if (statusEl) { statusEl.style.display='block'; statusEl.style.background='#f1f5f9'; statusEl.style.color='#475569'; statusEl.textContent='⏳ Connexion…'; }
  try {
    const r = await fetch(`${c.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': c.anonKey },
      body: JSON.stringify({ email, password: pass })
    });
    const data = await r.json();
    if (!data.access_token) throw new Error(data.error_description || data.msg || 'Erreur de connexion');
    // Stocker le token et le refresh token
    const cfg2 = SupaEngine.cfg();
    cfg2.userToken    = data.access_token;
    cfg2.refreshToken = data.refresh_token || '';
    cfg2.userEmail    = email;
    // Récupérer le tenant_id depuis le profil
    try {
      const pr = await fetch(`${c.url}/rest/v1/profiles?id=eq.${data.user?.id}&select=tenant_id,role,site_id&limit=1`, {
        headers: { 'apikey': c.anonKey, 'Authorization': `Bearer ${data.access_token}`, 'Accept': 'application/json' }
      });
      if (pr.ok) {
        const profiles = await pr.json();
        if (profiles?.[0]?.tenant_id) cfg2.tenantId = profiles[0].tenant_id;
        if (profiles?.[0]?.role) cfg2.userRole = profiles[0].role;
        // Récupérer le site_code depuis sites via site_id UUID
        if (profiles?.[0]?.site_id) {
          try {
            const sr = await fetch(`${c.url}/rest/v1/sites?id=eq.${profiles[0].site_id}&select=code,name&limit=1`, {
              headers: { 'apikey': c.anonKey, 'Authorization': `Bearer ${data.access_token}`, 'Accept': 'application/json' }
            });
            if (sr.ok) {
              const sites = await sr.json();
              if (sites?.[0]?.code) { cfg2.siteId = sites[0].code; cfg2.siteNom = sites[0].name; }
            }
          } catch(e) { console.warn('[login] site fetch failed', e); }
        }
      }
    } catch(e) { console.warn('[login] profile fetch failed', e); }
    SupaEngine.saveCfgLocal(cfg2);
    // Mettre à jour le champ tenant_id visible si présent
    const tenantEl = document.getElementById('supa-tenant-id');
    if (tenantEl && cfg2.tenantId) tenantEl.value = cfg2.tenantId;
    if (statusEl) { statusEl.style.background='#f0fdf4'; statusEl.style.color='#166534'; statusEl.textContent='✅ Connecté — ' + email; }
    toast('✅ Connecté en tant que ' + email, 'success');
    // Démarrer le refresh automatique (50 min)
    startSupaTokenRefresh();
    SupaEngine._updateBadge();
  } catch(e) {
    if (statusEl) { statusEl.style.display='block'; statusEl.style.background='#fee2e2'; statusEl.style.color='#991b1b'; statusEl.textContent='❌ ' + e.message; }
    toast('❌ ' + e.message, 'error');
  }
}

let _supaRefreshTimer = null;
function startSupaTokenRefresh() {
  if (_supaRefreshTimer) clearInterval(_supaRefreshTimer);
  _supaRefreshTimer = setInterval(async () => {
    const c = SupaEngine.cfg();
    if (!c.refreshToken || !c.url || !c.anonKey) return;
    try {
      const r = await fetch(`${c.url}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': c.anonKey },
        body: JSON.stringify({ refresh_token: c.refreshToken })
      });
      if (r.ok) {
        const data = await r.json();
        if (data.access_token) {
          c.userToken = data.access_token;
          c.refreshToken = data.refresh_token || c.refreshToken;
          SupaEngine.saveCfgLocal(c);
        }
      }
    } catch(e) { console.warn('[token refresh PMS]', e); }
  }, 50 * 60 * 1000);
}

function clearSupaQueue() {
  const q = JSON.parse(localStorage.getItem('haccp_supa_queue_v1')||'[]');
  const errors = q.filter(e => e.status === 'error');
  const pending = q.filter(e => e.status !== 'error' && e.status !== 'synced');
  if (errors.length === 0 && pending.length === 0) {
    toast('Aucune saisie en erreur à supprimer', 'info'); return;
  }
  const msg = `Supprimer ${errors.length} erreur(s) et ${pending.length} en attente ? Cette action est irréversible.`;
  if (!confirm(msg)) return;
  // Garder uniquement les synced
  const synced = q.filter(e => e.status === 'synced');
  localStorage.setItem('haccp_supa_queue_v1', JSON.stringify(synced));
  toast(`🗑️ Queue vidée — ${errors.length + pending.length} saisie(s) supprimée(s)`, 'success');
  SupaEngine._refreshModalStats();
  SupaEngine._updateBadge();
}

// ── RESET COMPLET : vide TOUT le localStorage HACCP et recharge ────
// À utiliser quand des fantômes reviennent malgré les purges Supabase.
// Conserve uniquement la config Supabase (URL, clé, email login) pour
// ne pas avoir à tout reconfigurer. Au rechargement, l'app lit Supabase
// depuis zéro et ne peut plus remonter de "fantômes" depuis le cache local.
function resetCompleteLocal(){
  const step1 = confirm(
    '🔥 RESET COMPLET DE LA TABLETTE\n\n' +
    'Ceci va :\n' +
    '• Effacer toutes les saisies locales (haccp_v6)\n' +
    '• Vider la queue de sync (haccp_supa_queue_v1)\n' +
    '• Conserver la config Supabase (URL, clé, login)\n' +
    '• Recharger la page\n\n' +
    'À utiliser UNIQUEMENT après avoir fait les DELETE SQL correspondants.\n' +
    'Toutes les données Supabase seront retéléchargées proprement.\n\n' +
    'Continuer ?'
  );
  if (!step1) return;
  const step2 = confirm(
    '⚠️ DERNIÈRE CONFIRMATION\n\n' +
    'Cette action est IRRÉVERSIBLE côté local.\n' +
    'Tout ce qui n\'est pas encore en base Supabase sera perdu.\n\n' +
    'Tu as bien :\n' +
    '  ✓ Fait les DELETE SQL dans Supabase\n' +
    '  ✓ Vérifié que le flush était passé avant\n\n' +
    'Lancer le reset ?'
  );
  if (!step2) return;

  try {
    // Sauvegarder la config Supabase avant reset
    const supaCfg = localStorage.getItem('haccp_supa_cfg_v1');
    const purgeVersion = localStorage.getItem('haccp_purge_version');

    // Vider tout ce qui concerne HACCP
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith('haccp_') || k === 'haccp_v6') {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));

    // Restaurer la config Supabase (pour ne pas avoir à se reconnecter)
    if (supaCfg) localStorage.setItem('haccp_supa_cfg_v1', supaCfg);
    if (purgeVersion) localStorage.setItem('haccp_purge_version', purgeVersion);

    alert('✅ Reset effectué.\n\nLa page va recharger. L\'app va retélécharger toutes les données depuis Supabase.');
    setTimeout(() => { location.reload(); }, 300);
  } catch (e) {
    alert('❌ Erreur pendant le reset : ' + e.message);
  }
}

function saveSupaCfg() {
  const existing = SupaEngine.cfg();
  const c = {
    url:       document.getElementById('supa-url')?.value || _PMS_URL_DEFAULT,
    anonKey:   document.getElementById('supa-anon-key')?.value || _PMS_KEY_DEFAULT,
    siteId:    (document.getElementById('supa-site-id')?.value||'').trim().toUpperCase(),
    tenantId:  existing.tenantId || '',
    userToken: existing.userToken || '',
    refreshToken: existing.refreshToken || '',
    userEmail: existing.userEmail || '',
    lastSync:  existing.lastSync || null,
  };
  SupaEngine.saveCfgLocal(c);
  SupaEngine._updateBadge();
  SupaEngine._refreshModalStats();
}
function _supaValiderCfg() {
  // Lire explicitement tous les champs et sauvegarder
  const keyInp = document.getElementById('supa-anon-key');
  if (keyInp) {
    // Forcer la lecture de la valeur réelle du DOM
    const v = keyInp.value || keyInp.getAttribute('value') || '';
    if (!v && keyInp.textContent) keyInp.value = keyInp.textContent;
  }
  saveSupaCfg();
  const c = SupaEngine.cfg();
  if (!c.url || !c.anonKey) {
    toast('⚠️ URL ou clé manquante', 'warning');
    return;
  }
  if (c.anonKey.length < 100) {
    toast('⚠️ Clé trop courte (' + c.anonKey.length + ' car.) — collez la clé complète', 'warning');
    return;
  }
  toast('✅ Config enregistrée — ' + c.anonKey.length + ' car. — testez la connexion', 'success');
  SupaEngine._updateBadge();
  SupaEngine._refreshModalStats();
}
function _supaToggleKey() {
  const inp = document.getElementById('supa-anon-key');
  const btn = document.getElementById('supa-key-eye');
  if (!inp) return;
  if (inp.type === 'password') {
    inp.type = 'text';
    if (btn) btn.textContent = '🙈';
  } else {
    inp.type = 'password';
    if (btn) btn.textContent = '👁';
  }
}
// ── Nettoyage des doublons Supabase ──────────────────────────────────
async function supaDeduplicateRecords() {
  const btn = document.getElementById('supa-dedup-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Analyse en cours…'; }
  SupaEngine._supaLog('🔍 Analyse des doublons en base…', true);

  const c = SupaEngine.cfg();
  if (!c.url || !c.anonKey || !c.siteId) {
    SupaEngine._supaLog('⚠️ Config incomplète', true);
    if (btn) { btn.disabled = false; btn.innerHTML = '🧹 Nettoyer les doublons en base'; }
    return;
  }
  const token = c.userToken || c.anonKey;

  try {
    // 1. Charger tous les records du site (6 mois)
    const since = new Date(Date.now() - 186 * 24 * 3600 * 1000).toISOString();
    const res = await fetch(
      `${c.url}/rest/v1/pms_records?site_id=eq.${encodeURIComponent(c.siteId)}&recorded_at=gte.${since}&select=id,enr_type,client_id,recorded_at,data&order=recorded_at.asc&limit=10000`,
      { headers: { 'apikey': c.anonKey, 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const recs = await res.json();
    SupaEngine._supaLog(`📋 ${recs.length} enregistrements chargés`);

    // 2. Identifier les doublons par (enr_type + _ts)
    // Garder le plus récent (id le plus grand), supprimer les autres
    const seen = new Map(); // clé: enr_type::_ts → id à garder
    const toDelete = [];

    recs.forEach(r => {
      const ts  = r.data?._ts || r.recorded_at;
      const key = (r.enr_type || '') + '::' + ts;
      if (!seen.has(key)) {
        seen.set(key, r.id);
      } else {
        // Doublon — on supprime celui-ci (on garde le premier = le plus ancien qui a la bonne data)
        toDelete.push(r.id);
      }
    });

    if (toDelete.length === 0) {
      SupaEngine._supaLog('✅ Aucun doublon trouvé — base propre');
      toast('✅ Aucun doublon trouvé', 'success');
      if (btn) { btn.disabled = false; btn.innerHTML = '✅ Base propre'; }
      return;
    }

    SupaEngine._supaLog(`🗑️ ${toDelete.length} doublon(s) à supprimer…`);

    // 3. Supprimer les doublons par lots de 50
    let deleted = 0;
    const BATCH = 50;
    for (let i = 0; i < toDelete.length; i += BATCH) {
      const batch = toDelete.slice(i, i + BATCH);
      const ids   = batch.map(id => `"${id}"`).join(',');
      const delRes = await fetch(
        `${c.url}/rest/v1/pms_records?id=in.(${ids})`,
        {
          method: 'DELETE',
          headers: {
            'apikey': c.anonKey,
            'Authorization': `Bearer ${token}`,
            'Prefer': 'return=minimal',
          },
        }
      );
      if (delRes.ok || delRes.status === 204) {
        deleted += batch.length;
        SupaEngine._supaLog(`🗑️ Lot ${Math.ceil((i+1)/BATCH)}/${Math.ceil(toDelete.length/BATCH)} — ${deleted} supprimé(s)`);
      } else {
        SupaEngine._supaLog(`⚠️ Erreur lot ${i} — HTTP ${delRes.status}`);
      }
    }

    // 4. Aussi dédupliquer le localStorage
    let localDedup = 0;
    Object.keys(S).forEach(sec => {
      if (!Array.isArray(S[sec]?.lignes) || S[sec].lignes.length < 2) return;
      const seen2 = new Map();
      S[sec].lignes.forEach(r => { if (r._ts && !seen2.has(r._ts)) seen2.set(r._ts, r); });
      if (seen2.size < S[sec].lignes.length) {
        localDedup += S[sec].lignes.length - seen2.size;
        S[sec].lignes = [...seen2.values()];
      }
    });
    if (localDedup > 0) { save(); SupaEngine._supaLog(`🧹 ${localDedup} doublon(s) local(aux) supprimé(s)`); }

    SupaEngine._supaLog(`✅ Terminé — ${deleted} doublon(s) supprimé(s) en base`);
    toast(`✅ ${deleted} doublon(s) supprimé(s)`, 'success');
    if (btn) { btn.disabled = false; btn.innerHTML = `✅ ${deleted} doublon(s) supprimé(s)`; }

    // Recharger l'affichage
    renderNav(); renderMain();

  } catch(e) {
    SupaEngine._supaLog(`❌ Erreur : ${e.message}`);
    toast('❌ Erreur : ' + e.message, 'warning');
    if (btn) { btn.disabled = false; btn.innerHTML = '🧹 Nettoyer les doublons en base'; }
  }
}


async function supaPurgeOrphans() {
  const btn = document.getElementById('supa-purge-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Analyse en cours…'; }
  SupaEngine._supaLog('🗑️ Analyse des orphelins en base…', true);

  const c = SupaEngine.cfg();
  if (!c.url || !c.anonKey || !c.siteId) {
    SupaEngine._supaLog('⚠️ Config incomplète', true);
    if (btn) { btn.disabled = false; btn.innerHTML = '🗑️ Purger les orphelins'; }
    return;
  }
  const token = c.userToken || c.anonKey;

  try {
    let totalDeleted = 0;

    // 1. Supprimer ENR01 (refroidissement) de plus de 7 jours
    const cutoff7j = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const res1 = await fetch(
      `${c.url}/rest/v1/pms_records?site_id=eq.${encodeURIComponent(c.siteId)}&enr_type=eq.enr01&recorded_at=lt.${cutoff7j}&select=id`,
      { headers: { 'apikey': c.anonKey, 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } }
    );
    if (res1.ok) {
      const toDelete1 = (await res1.json()).map(r => r.id);
      SupaEngine._supaLog(`🌡️ ${toDelete1.length} refroidissement(s) ENR01 >7j trouvé(s)`);
      const BATCH = 50;
      for (let i = 0; i < toDelete1.length; i += BATCH) {
        const ids = toDelete1.slice(i, i + BATCH).map(id => `"${id}"`).join(',');
        const del = await fetch(`${c.url}/rest/v1/pms_records?id=in.(${ids})`, {
          method: 'DELETE',
          headers: { 'apikey': c.anonKey, 'Authorization': `Bearer ${token}`, 'Prefer': 'return=minimal' }
        });
        if (del.ok || del.status === 204) totalDeleted += Math.min(BATCH, toDelete1.length - i);
      }
    }

    // 2. Supprimer plats témoins (ENR13) périmés (>5 jours réglementaires)
    const cutoff5j = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
    const res2 = await fetch(
      `${c.url}/rest/v1/pms_records?site_id=eq.${encodeURIComponent(c.siteId)}&enr_type=eq.enr13&recorded_at=lt.${cutoff5j}&select=id`,
      { headers: { 'apikey': c.anonKey, 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } }
    );
    if (res2.ok) {
      const toDelete2 = (await res2.json()).map(r => r.id);
      SupaEngine._supaLog(`🍽️ ${toDelete2.length} plat(s) témoin ENR13 périmé(s) trouvé(s)`);
      const BATCH = 50;
      for (let i = 0; i < toDelete2.length; i += BATCH) {
        const ids = toDelete2.slice(i, i + BATCH).map(id => `"${id}"`).join(',');
        const del = await fetch(`${c.url}/rest/v1/pms_records?id=in.(${ids})`, {
          method: 'DELETE',
          headers: { 'apikey': c.anonKey, 'Authorization': `Bearer ${token}`, 'Prefer': 'return=minimal' }
        });
        if (del.ok || del.status === 204) totalDeleted += Math.min(BATCH, toDelete2.length - i);
      }
    }

    if (totalDeleted === 0) {
      SupaEngine._supaLog('✅ Aucun orphelin trouvé — base propre');
      toast('✅ Aucun orphelin à purger', 'success');
      if (btn) { btn.disabled = false; btn.innerHTML = '✅ Base propre'; }
    } else {
      SupaEngine._supaLog(`✅ Terminé — ${totalDeleted} enregistrement(s) purgé(s)`);
      toast(`✅ ${totalDeleted} orphelin(s) purgé(s)`, 'success');
      if (btn) { btn.disabled = false; btn.innerHTML = `✅ ${totalDeleted} purgé(s)`; }
    }

  } catch(e) {
    SupaEngine._supaLog(`❌ Erreur : ${e.message}`);
    toast('❌ Erreur : ' + e.message, 'warning');
    if (btn) { btn.disabled = false; btn.innerHTML = '🗑️ Purger les orphelins'; }
  }
}

function supaFlushNow() {
  const btn = document.querySelector('[onclick="supaFlushNow()"]');
  if (btn && btn.disabled) return;
  if (btn) { btn.disabled = true; btn.style.opacity = '.6'; btn.innerHTML = '⏳ Envoi en cours…'; }
  SupaEngine._supaLog('⬆️ Envoi manuel déclenché…', true);
  SupaEngine.flush().finally(() => {
    if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.innerHTML = '⬆️ Envoyer maintenant'; }
  });
}
function supaTestConnection() {
  SupaEngine.testConnection();
}

// ════════════════════════════════════════════════════
// QR CODE SCANNER — Config Supabase
// Utilise jsQR (CDN) + getUserMedia
// ════════════════════════════════════════════════════
let _qrStream = null;
let _qrRaf = null;

function supaStartQR() {
  const wrap = document.getElementById('supa-qr-wrap');
  const video = document.getElementById('supa-qr-video');
  if (!wrap || !video) return;

  // Charger jsQR si pas encore chargé
  if (!window.jsQR) {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
    s.onload = () => _supaOpenCamera(wrap, video);
    s.onerror = () => toast('⚠️ Impossible de charger le lecteur QR (réseau requis)', 'warning');
    document.head.appendChild(s);
  } else {
    _supaOpenCamera(wrap, video);
  }
}

async function _supaOpenCamera(wrap, video) {
  try {
    _qrStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: {ideal:1280}, height: {ideal:720} }
    });
    video.srcObject = _qrStream;
    wrap.style.display = 'block';
    _qrScan(video);
  } catch(e) {
    toast('⚠️ Caméra inaccessible — autorisez l\'accès', 'warning');
  }
}

function _qrScan(video) {
  const canvas = document.getElementById('supa-qr-canvas');
  const ctx = canvas.getContext('2d');

  function tick() {
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert'
      });
      if (code && code.data) {
        _supaApplyQR(code.data);
        return; // stoppe le scan
      }
    }
    _qrRaf = requestAnimationFrame(tick);
  }
  _qrRaf = requestAnimationFrame(tick);
}

function _supaApplyQR(data) {
  supaStopQR();
  try {
    const cfg = JSON.parse(data);
    if (!cfg.url || !cfg.key) throw new Error('QR invalide');
    const urlEl   = document.getElementById('supa-url');
    const keyEl   = document.getElementById('supa-anon-key');
    const siteEl  = document.getElementById('supa-site-id');
    if (urlEl)  { urlEl.value  = cfg.url;  urlEl.style.borderColor='#8DC63F'; }
    if (keyEl)  { keyEl.value  = cfg.key;  keyEl.style.borderColor='#8DC63F'; }
    if (siteEl && cfg.siteId) { siteEl.value = cfg.siteId; siteEl.style.borderColor='#8DC63F'; }
    saveSupaCfg();
    SupaEngine._refreshModalStats();
    toast('✅ Configuration Supabase importée via QR !', 'success');
    // Flash vert sur les champs
    setTimeout(() => {
      [urlEl, keyEl, siteEl].forEach(el => { if(el) el.style.borderColor=''; });
    }, 3000);
  } catch(e) {
    toast('⚠️ QR non reconnu — utilisez la page générateur', 'warning');
  }
}

function supaStopQR() {
  if (_qrRaf) { cancelAnimationFrame(_qrRaf); _qrRaf = null; }
  if (_qrStream) { _qrStream.getTracks().forEach(t => t.stop()); _qrStream = null; }
  const wrap = document.getElementById('supa-qr-wrap');
  if (wrap) wrap.style.display = 'none';
  const video = document.getElementById('supa-qr-video');
  if (video) video.srcObject = null;
}

// ════════════════════════════════════════════════════
// DICTÉE VOCALE — Web Speech API
// Fonctionne sur Chrome/Android natif
// Sur iOS : besoin de Safari + microphone autorisé
// ════════════════════════════════════════════════════
// ── DICTÉE VOCALE — Web Speech API avec fallback clavier ──────────
const _SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition || null;
let _micActive = false;
let _micRecog = null;

function _micSupported() {
  return !!_SpeechRec; // fonctionne https + http + file://
}

function _micStop() {
  if (_micRecog) { try { _micRecog.stop(); } catch(e){} _micRecog = null; }
  _micActive = false;
  // Reset toutes les icônes mic
  document.querySelectorAll('.mic-btn').forEach(b => {
    b.textContent = '🎤'; b.classList.remove('recording');
  });
}

function _micStartReal(inp, btn, onResult) {
  if (_micActive) { _micStop(); return; }
  const rec = new _SpeechRec();
  _micRecog = rec;
  rec.lang = 'fr-FR';
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  const base = inp.value;
  rec.onstart = () => {
    _micActive = true;
    btn.textContent = '⏹'; btn.classList.add('recording');
    toast('🎤 Parlez…', 'success', 3000);
  };
  rec.onresult = (e) => {
    const transcript = Array.from(e.results).map(r=>r[0].transcript).join('');
    const isFinal = e.results[e.results.length-1].isFinal;
    inp.value = base + (base && !base.endsWith(' ') ? ' ' : '') + transcript;
    inp.dispatchEvent(new Event('input'));
    if (isFinal) { onResult(inp.value); _micStop(); }
  };
  rec.onerror = (e) => {
    _micStop();
    if (e.error === 'not-allowed') toast('⚠️ Micro non autorisé — vérifiez les permissions', 'warning');
    else if (e.error === 'no-speech') toast('Aucune parole détectée', 'warning');
    else toast('Erreur micro : ' + e.error, 'warning');
  };
  rec.onend = () => _micStop();
  try { rec.start(); } catch(e) { _micStop(); }
}

function startMicField(inputId, onResult) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  if (_micSupported()) {
    const btn = inp.parentElement?.querySelector('.mic-btn') || inp.nextElementSibling;
    _micStartReal(inp, btn || {textContent:'',classList:{add:()=>{},remove:()=>{}}}, (val) => {
      onResult(val);
    });
  } else {
    inp.focus();
    const len = inp.value.length;
    try { inp.setSelectionRange(len, len); } catch(e) {}
    toast('🎤 Appuyez sur le micro de votre clavier pour dicter', 'success', 4000);
  }
}

function startMic(inputId, fid, sec, isAc) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  if (_micSupported()) {
    const btn = inp.nextElementSibling || document.querySelector(`[onclick*="${inputId}"]`);
    _micStartReal(inp, btn || {textContent:'', classList:{add:()=>{},remove:()=>{}}}, (val) => {
      sd(fid, val, sec);
      if (isAc) { inp.dispatchEvent(new Event('input')); }
    });
  } else {
    // Fallback : focus + tooltip discret une seule fois
    inp.focus();
    const len = inp.value.length;
    try { inp.setSelectionRange(len, len); } catch(e) {}
    toast('🎤 Appuyez sur le micro de votre clavier pour dicter', 'success', 4000);
  }
}

function startMicTA(taId, fid, sec) {
  const ta = document.getElementById(taId);
  if (!ta) return;
  if (_micSupported()) {
    const btn = ta.nextElementSibling;
    _micStartReal(ta, btn || {textContent:'', classList:{add:()=>{},remove:()=>{}}}, (val) => {
      sd(fid, val, sec);
    });
  } else {
    ta.focus();
    const len = ta.value.length;
    try { ta.setSelectionRange(len, len); } catch(e) {}
    toast('🎤 Appuyez sur le micro de votre clavier pour dicter', 'success', 4000);
  }
}

// ════════════════════════════════════════════════════
// RAPPEL HUILE FRITURE
// Compte les services depuis le dernier changement
// par numéro de friteuse, sur ENR05 + ENR06 combinés
// ════════════════════════════════════════════════════
const HUILE_MAX = 8;

function getHuileStats() {
  // Fusionner ENR05 + ENR06 triés chronologiquement
  const all = [
    ...(S['enr05']?.lignes || []).map(r => ({...r, _src:'enr05'})),
    ...(S['enr06']?.lignes || []).map(r => ({...r, _src:'enr06'})),
  ].sort((a, b) => {
    const da = a.date || '', db = b.date || '';
    if (da !== db) return da.localeCompare(db);
    return (a._ts || '').localeCompare(b._ts || '');
  });

  // Par friteuse : compter les services depuis le dernier changement
  const stats = {}; // { '1': { services: 3, lastChange: '2025-03-08', lastDate: '2025-03-10' } }
  all.forEach(r => {
    const f = String(r.friteuse || '1').trim() || '1';
    if (!stats[f]) stats[f] = { services: 0, lastChange: null, lastDate: null };
    stats[f].lastDate = r.date || stats[f].lastDate;
    if (r.change === 'OUI') {
      stats[f].services = 0;
      stats[f].lastChange = r.date || null;
    } else {
      stats[f].services++;
    }
  });
  return stats;
}

function huileAlertBlock() {
  const stats = getHuileStats();
  const entries = Object.entries(stats);
  if (entries.length === 0) return '';

  const items = entries.map(([f, s]) => {
    const pct = Math.min(s.services / HUILE_MAX, 1);
    const isDanger = s.services >= HUILE_MAX;
    const isWarn   = s.services >= HUILE_MAX - 2 && !isDanger;
    const cls = isDanger ? 'danger' : isWarn ? 'warn' : 'ok';
    const icon = isDanger ? '🚨' : isWarn ? '⚠️' : '✅';
    const title = isDanger
      ? `Friteuse n°${f} — CHANGER L'HUILE (${s.services}/${HUILE_MAX} services)`
      : isWarn
      ? `Friteuse n°${f} — Bientôt à changer (${s.services}/${HUILE_MAX})`
      : `Friteuse n°${f} — OK (${s.services}/${HUILE_MAX} services)`;
    const sub = s.lastChange
      ? `Dernier changement : ${s.lastChange}`
      : `Aucun changement enregistré`;
    // Barre de progression
    const barColor = isDanger ? '#f87171' : isWarn ? '#fb923c' : '#86efac';
    const bar = `<div style="height:5px;border-radius:3px;background:#e5e7eb;margin-top:6px;overflow:hidden">
      <div style="height:100%;width:${Math.round(pct*100)}%;background:${barColor};transition:.4s;border-radius:3px"></div>
    </div>`;
    return `<div class="huile-banner ${cls}">
      <div class="huile-banner-icon">${icon}</div>
      <div class="huile-banner-txt">
        <div class="huile-banner-title" style="color:${isDanger?'#991b1b':isWarn?'#9a3412':'#166534'}">${title}</div>
        <div class="huile-banner-sub">${sub}</div>
        ${bar}
      </div>
    </div>`;
  }).join('');

  return items;
}

// makeHuileFR déplacé dans app-cuisine.js (dépend de REND, FDEFS)

// ════════════════════════════════════════════════════
// EXPORT EXCEL (SheetJS)
// ════════════════════════════════════════════════════
const EXP_SECTIONS_BASE = [
  {id:'enr01',label:'❄️ Refroidissement'},  {id:'enr02',label:'🔥 Remise T°C'},
  {id:'enr03',label:'🔄 Refroid.+Remise'},  {id:'enr04',label:'🥩 Steaks hachés'},
  {id:'enr05',label:'🍟 Fritures'},          {id:'enr06',label:'🍟 Fritures testeur'},
  {id:'enr07',label:'🥘 Bien Faits cuit'},   {id:'enr08',label:'🥗 TM/BF'},
  {id:'enr09',label:'♨️ Cond. chaud'},       {id:'enr10',label:'🧊 Cond. froid'},
  {id:'enr11',label:'🍽️ Plat. froids'},      {id:'enr12',label:'🍽️ Plat. chauds'},
  {id:'enr13',label:'🚚 Départ'},            {id:'enr14',label:'🛎️ Distribution'},
  {id:'enr15',label:'🏠 SAM'},               {id:'enr16',label:'🍴 Self'},
  {id:'enr17',label:'🚐 Livraison froide'}, {id:'enr18',label:'🚐 Livraison chaude'},
  {id:'enr19',label:'🌡️ Stockage'},          {id:'enr23',label:'📦 Réception'},
  {id:'enr26',label:'🌡️ Thermomètres'},      {id:'enr27',label:'📊 Afficheurs'},
  {id:'enr28',label:'🧹 Nettoyage'},         {id:'enr29',label:'👥 Sensibilisation'},
  {id:'enr30',label:'🚨 Non-conformités'},   {id:'enr31',label:'📋 Traçabilité'},
  {id:'enr32',label:'⚠️ TIAC'},              {id:'enr33',label:'🍱 Plats témoins'},
  {id:'enr34',label:'🏷️ Étiq. prod.'},       {id:'enr35',label:'🥩 Origines'},
  {id:'enr36',label:'♻️ Excédents'},          {id:'enr39',label:'🧺 Pique-nique'},
  {id:'enr52',label:'🌡️ T°C excédents'},     {id:'enr53',label:'🤝 Don assoc.'},
  {id:'enr_tc_distrib',label:'🌡️ T°C Distribution (ancien)'},
];
// Sections dynamiques incluant les services de distribution
function getExpSections(){
  var svcs = getDistribServices();
  var distribSecs = svcs.map(function(svc){
    return {id:'enr_distrib_'+svc.id, label:(svc.ico||'🍽️')+' '+svc.label};
  });
  return distribSecs.concat(EXP_SECTIONS_BASE);
}
var EXP_SECTIONS = EXP_SECTIONS_BASE; // compat — sera remplacé dynamiquement

function saveExpCfg() {
  S.expCfg = S.expCfg || {};
  S.expCfg.email = document.getElementById('exp-email')?.value || '';
  save();
}
  