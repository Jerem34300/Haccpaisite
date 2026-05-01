/**
 * tracabilite.js — Moteur de traçabilité HACCP par apprentissage historique
 *
 * Principe : zéro IA externe. Plus tu saisies, plus ça reconnaît.
 *
 * Fonctionnement :
 *   1. À chaque sauvegarde ENR, on mémorise le plat + son type ENR dans un
 *      registre local (haccp_patterns_v1). Ex: "bourguignon → enr01, enr07, enr33"
 *
 *   2. Quand tu sélectionnes "bourguignon" dans le menu ou dans un ENR,
 *      on cherche dans S[] (local) ET dans Supabase les ENR récents de ce plat.
 *      On propose de lier automatiquement (ex: "Refroidissement du 28/04 → Lier").
 *
 *   3. La timeline montre le cycle complet du plat sur les ENR déjà saisis.
 *
 *   4. Le moteur déduit la chaîne habituelle du plat à partir de l'historique :
 *      si "bourguignon" a toujours eu enr01 + enr07 + enr33, on sait que c'est
 *      un BF Cuit et on peut prévenir l'oubli d'une étape.
 */

const Tracabilite = (() => {
  const LIFECYCLE_KEY = 'haccp_lifecycle_v1';   // Cycles des plats en cours (14 jours)
  const PATTERNS_KEY  = 'haccp_patterns_v1';    // Apprentissage long-terme (nom → ENR types vus)
  const SEARCH_CACHE  = 'haccp_search_cache_v1';// Cache requêtes Supabase (5 min)

  // Métadonnées de chaque ENR dans la chaîne HACCP
  const ENR_META = {
    enr08:           { icon: '📦', label: 'Réception / BF Cru',  step: 1 },
    enr23:           { icon: '🔗', label: 'Liaison froide',        step: 2 },
    enr01:           { icon: '❄️', label: 'Refroidissement',       step: 3 },
    enr07:           { icon: '🥘', label: 'Remise en T°',          step: 4 },
    enr_tc_distrib:  { icon: '🌡️', label: 'T° distribution',      step: 5 },
    enr33:           { icon: '🧪', label: 'Plat témoin',           step: 6 },
    enr34:           { icon: '🏷️', label: 'Étiquette',            step: 7 },
  };

  // Fenêtres de temps pour l'auto-liaison (heures)
  const LINK_WINDOWS = {
    enr07_from_enr01:          72,  // Remise T° jusqu'à 3 jours après refroidissement
    enr07_from_enr23:          48,
    enr33_from_enr07:           6,
    enr33_from_enr01:           6,
    enr33_from_enr08:           4,
    enr34_from_enr33:          24,
    enr01_from_enr07:           2,
    enr01_from_enr08:           4,
    enr_tc_distrib_from_enr07:  4,
    enr_tc_distrib_from_enr08:  4,
  };

  // ── Normalisation des noms de plats ───────────────────────────
  // "Bourguignon de bœuf" == "bourguignon boeuf" == "bourguignons"
  function _norm(s) {
    return String(s || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')   // accents
      .replace(/œ/g, 'oe').replace(/æ/g, 'ae')
      .replace(/[^a-z0-9]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  // Score de similarité entre deux noms (0–100)
  // Heuristique : mots en commun / mots totaux (Jaccard)
  function _similarity(a, b) {
    const wa = new Set(_norm(a).split(' ').filter(w => w.length > 2));
    const wb = new Set(_norm(b).split(' ').filter(w => w.length > 2));
    if (!wa.size || !wb.size) return 0;
    let inter = 0;
    wa.forEach(w => { if (wb.has(w)) inter++; });
    return Math.round((inter / Math.max(wa.size, wb.size)) * 100);
  }

  function _matches(a, b, threshold = 60) {
    if (!a || !b) return false;
    return _similarity(a, b) >= threshold;
  }

  // ── Stockage lifecycle (cycles en cours) ──────────────────────
  function _lcGet()    { try { return JSON.parse(localStorage.getItem(LIFECYCLE_KEY) || '{}'); } catch { return {}; } }
  function _lcSet(d)   { try { localStorage.setItem(LIFECYCLE_KEY, JSON.stringify(d)); } catch(e) {} }
  function getLifecycle(platId) { return _lcGet()[platId] || null; }

  function upsertLifecycle(platId, updates) {
    const all = _lcGet();
    all[platId] = { platId, steps: {}, ...(all[platId] || {}), ...updates };
    _lcSet(all);
    return all[platId];
  }

  function addStepToLifecycle(platId, enrType, record) {
    const all = _lcGet();
    const lc  = all[platId] || { platId, steps: {} };
    lc.steps  = lc.steps || {};
    if (enrType === 'enr33' || enrType === 'enr34') {
      if (!Array.isArray(lc.steps[enrType])) lc.steps[enrType] = [];
      lc.steps[enrType].push({ _ts: record._ts, date: record.date || (record._ts||'').slice(0,10), variant: record._variant || '' });
    } else {
      lc.steps[enrType] = { _ts: record._ts, date: record.date || (record._ts||'').slice(0,10) };
    }
    lc.lastUpdated = new Date().toISOString();
    all[platId] = lc;
    _lcSet(all);
    return lc;
  }

  // ── Patterns d'apprentissage ───────────────────────────────────
  // Structure : { "bourguignon": { enr01: 5, enr07: 4, enr33: 5 }, ... }
  function _patGet()  { try { return JSON.parse(localStorage.getItem(PATTERNS_KEY) || '{}'); } catch { return {}; } }
  function _patSet(d) { try { localStorage.setItem(PATTERNS_KEY, JSON.stringify(d)); } catch(e) {} }

  function _learnPattern(platNom, enrType) {
    if (!platNom || !enrType) return;
    const key = _norm(platNom);
    if (!key) return;
    const all = _patGet();
    all[key] = all[key] || {};
    all[key][enrType] = (all[key][enrType] || 0) + 1;
    all[key]._lastSeen = new Date().toISOString();
    _patSet(all);
  }

  // Retourne la chaîne ENR la plus probable pour ce plat, d'après l'historique
  function _inferChain(platNom) {
    if (!platNom) return [];
    const key  = _norm(platNom);
    const pats = _patGet();

    // Cherche le pattern exact ou le plus similaire
    let best  = null;
    let bestScore = 0;
    for (const [k, v] of Object.entries(pats)) {
      const s = k === key ? 100 : _similarity(key, k);
      if (s > bestScore && s >= 60) { bestScore = s; best = v; }
    }
    if (!best) return [];

    // Trier par fréquence, garder ceux vus au moins 1 fois
    return Object.entries(best)
      .filter(([k]) => ENR_META[k])
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k)
      .sort((a, b) => (ENR_META[a]?.step || 99) - (ENR_META[b]?.step || 99));
  }

  // ── Recherche dans S[] (localStorage/mémoire) ─────────────────
  function _searchLocal(platNom, enrTypes, maxHoursAgo = 168) {
    const results = [];
    const cutoff  = Date.now() - maxHoursAgo * 3600 * 1000;
    const types   = enrTypes || Object.keys(ENR_META);

    for (const enrType of types) {
      const lignes = (typeof S !== 'undefined' && S[enrType]?.lignes) || [];
      for (const ligne of lignes) {
        const ts = ligne._ts ? new Date(ligne._ts).getTime() : 0;
        if (ts > 0 && ts < cutoff) continue;
        const produit = ligne.produit || ligne.libelle || ligne._plat_nom || '';
        if (!_matches(produit, platNom)) continue;
        results.push({
          enrType,
          _ts:        ligne._ts,
          date:       ligne.date || (ligne._ts||'').slice(0,10),
          heure:      ligne.heure || '',
          produit,
          _plat_id:   ligne._plat_id || '',
          _menu_id:   ligne._menu_id || '',
          source:     'local',
          confidence: ligne._plat_id ? 'haute' : 'bonne',
        });
      }
    }
    return results;
  }

  // ── Recherche dans Supabase (7 derniers jours) ─────────────────
  async function _searchSupabase(platNom, maxDays = 7) {
    // Cache 5 min pour éviter de re-requêter à chaque frappe
    const cacheKey = _norm(platNom);
    try {
      const c = JSON.parse(localStorage.getItem(SEARCH_CACHE) || '{}');
      const e = c[cacheKey];
      if (e && (Date.now() - e.ts) < 5 * 60 * 1000) return e.data;
    } catch(e) {}

    const supaCfg = (typeof SupaEngine !== 'undefined' && typeof SupaEngine._cfg === 'function')
      ? SupaEngine._cfg()
      : null;
    if (!supaCfg?.url || !supaCfg?.anonKey || !supaCfg?.siteId) return [];

    const since = new Date(Date.now() - maxDays * 24 * 3600 * 1000).toISOString();
    const normPlatNom = _norm(platNom).replace(/ /g, '%20');

    let authToken = supaCfg.userToken || supaCfg.anonKey;
    try {
      if (window._supaClient) {
        const sess = await window._supaClient.auth.getSession();
        if (sess?.data?.session?.access_token) authToken = sess.data.session.access_token;
      }
    } catch(e) {}

    try {
      // Chercher par _plat_nom dans le JSONB data
      const url = `${supaCfg.url}/rest/v1/pms_records`
        + `?site_id=eq.${encodeURIComponent(supaCfg.siteId)}`
        + `&recorded_at=gte.${since}`
        + `&select=enr_type,recorded_at,data,client_id`
        + `&order=recorded_at.desc&limit=200`;

      const r = await fetch(url, {
        headers: {
          apikey:        supaCfg.anonKey,
          Authorization: `Bearer ${authToken}`,
          Accept:        'application/json',
        },
      });
      if (!r.ok) return [];
      const rows = await r.json();

      const results = [];
      for (const row of rows) {
        const data    = row.data || {};
        const produit = data._plat_nom || data.produit || data.libelle || '';
        if (!produit || !_matches(produit, platNom)) continue;
        results.push({
          enrType:    row.enr_type,
          _ts:        row.recorded_at,
          date:       (row.recorded_at || '').slice(0, 10),
          heure:      data.heure || '',
          produit,
          _plat_id:   data._plat_id || '',
          _menu_id:   data._menu_id || '',
          source:     'supabase',
          confidence: data._plat_id ? 'haute' : 'bonne',
        });
      }

      // Mettre en cache
      try {
        const c = JSON.parse(localStorage.getItem(SEARCH_CACHE) || '{}');
        c[cacheKey] = { ts: Date.now(), data: results };
        // Garder max 50 entrées en cache
        const keys = Object.keys(c).filter(k => k !== cacheKey);
        if (keys.length > 49) delete c[keys[0]];
        localStorage.setItem(SEARCH_CACHE, JSON.stringify(c));
      } catch(e) {}

      return results;
    } catch(e) {
      console.warn('[Tracabilite] searchSupabase:', e.message);
      return [];
    }
  }

  // ── Candidats pour auto-liaison ────────────────────────────────
  // Cherche les ENR qui précèdent logiquement targetEnrType pour ce plat
  function _findCandidates(targetEnrType, platNom, platId, supaResults) {
    const now = Date.now();
    const predecessors = Object.keys(LINK_WINDOWS)
      .filter(k => k.startsWith(targetEnrType + '_from_'))
      .map(k => ({ enrType: k.replace(targetEnrType + '_from_', ''), maxHours: LINK_WINDOWS[k] }));

    const localResults = _searchLocal(platNom, predecessors.map(p => p.enrType));
    const allResults   = [...localResults, ...(supaResults || [])
      .filter(r => predecessors.some(p => p.enrType === r.enrType))
    ];

    // Dédupliquer par _ts
    const seen = new Set();
    const unique = allResults.filter(r => {
      if (!r._ts || seen.has(r._ts)) return false;
      seen.add(r._ts);
      return true;
    });

    // Filtrer par fenêtre temporelle
    return unique.filter(r => {
      const pred = predecessors.find(p => p.enrType === r.enrType);
      if (!pred) return false;
      const rTs = r._ts ? new Date(r._ts).getTime() : 0;
      if (!rTs) return false;
      const gap = now - rTs;
      return gap >= 0 && gap <= pred.maxHours * 3600 * 1000;
    }).sort((a, b) => {
      // Priorité : haute confidence, puis local, puis plus récent
      const cScore = (x) => x.confidence === 'haute' ? 2 : 1;
      const sScore = (x) => x.source === 'local' ? 1 : 0;
      return (cScore(b) - cScore(a)) || (sScore(b) - sScore(a));
    });
  }

  // ── Timeline HTML ──────────────────────────────────────────────
  function _renderTimelineHTML(platId, platNom, supaResults) {
    const found = {};

    // 1. Lifecycle local
    const lc = getLifecycle(platId);
    if (lc?.steps) Object.assign(found, lc.steps);

    // 2. S[] local
    if (typeof S !== 'undefined') {
      for (const et of Object.keys(ENR_META)) {
        if (found[et]) continue;
        const m = (S[et]?.lignes || []).find(l =>
          (platId && l._plat_id === platId) ||
          (platNom && _matches(l.produit || l.libelle || l._plat_nom || '', platNom))
        );
        if (m) found[et] = { _ts: m._ts, date: m.date || (m._ts||'').slice(0,10) };
      }
    }

    // 3. Résultats Supabase
    if (supaResults) {
      for (const r of supaResults) {
        if (!found[r.enrType] && ENR_META[r.enrType]) {
          found[r.enrType] = { _ts: r._ts, date: r.date };
        }
      }
    }

    const present = Object.keys(ENR_META)
      .filter(et => found[et])
      .sort((a, b) => ENR_META[a].step - ENR_META[b].step);

    if (!present.length) return '';

    const dots = present.map(et => {
      const meta = ENR_META[et];
      const step = found[et];
      const d    = Array.isArray(step) ? step[0]?.date : step.date;
      const fmt  = d ? d.slice(5).replace('-', '/') : '';
      return `<div class="trc-step">
        <span class="trc-icon">${meta.icon}</span>
        <span class="trc-label">${meta.label}</span>
        ${fmt ? `<span class="trc-date">${fmt}</span>` : ''}
      </div>`;
    }).join('<span class="trc-arrow">→</span>');

    return `<div class="trc-timeline" id="trc-tl-${platId}">
      <div class="trc-title">📋 Cycle HACCP de ce plat</div>
      <div class="trc-steps">${dots}</div>
    </div>`;
  }

  // ── Suggestions HTML ───────────────────────────────────────────
  function _renderSuggestionsHTML(targetEnrType, platNom, platId, candidates) {
    if (!candidates.length) return '';
    const items = candidates.slice(0, 3).map(c => {
      const meta  = ENR_META[c.enrType] || {};
      const dFmt  = c.date ? c.date.slice(5).replace('-', '/') : '';
      const hFmt  = c.heure ? ` à ${c.heure}` : '';
      const safeTs = (c._ts || '').replace(/['"]/g, '');
      return `<div class="trc-suggestion-item">
        ${meta.icon||'🔗'} <strong>${meta.label||c.enrType}</strong> · ${dFmt}${hFmt}
        <span class="trc-conf trc-conf-${c.confidence}">${c.confidence}</span>
        <button class="trc-link-btn"
          onclick="Tracabilite.applyLink('${targetEnrType}','${safeTs}','${c.enrType}','${(c.produit||'').replace(/'/g,'')}')">
          ✅ Lier
        </button>
      </div>`;
    }).join('');

    return `<div class="trc-suggestions">
      <div class="trc-sugg-title">💡 Trouvé dans l'historique — à lier ?</div>
      ${items}
    </div>`;
  }

  // ── Étapes manquantes (alerte) ─────────────────────────────────
  function _renderMissingStepsHTML(platNom, foundSteps) {
    const chain = _inferChain(platNom);
    if (chain.length < 2) return ''; // pas assez d'historique
    const missing = chain.filter(et => !foundSteps.has(et));
    if (!missing.length) return '';

    const chips = missing.map(et => {
      const m = ENR_META[et] || {};
      return `<span class="trc-missing-chip">${m.icon||''} ${m.label||et}</span>`;
    }).join('');
    return `<div class="trc-missing">
      <div class="trc-missing-title">⚠️ Étapes habituellement requises pour ce plat</div>
      <div class="trc-missing-chips">${chips}</div>
    </div>`;
  }

  // ── Appliquer une liaison ──────────────────────────────────────
  function applyLink(targetEnrType, sourceTs, sourceEnrType, produit) {
    try {
      // Chercher la ligne source localement
      const srcLigne = ((typeof S !== 'undefined' && S[sourceEnrType]?.lignes) || [])
        .find(l => l._ts === sourceTs);

      if (typeof S !== 'undefined') {
        S[targetEnrType]       = S[targetEnrType] || {};
        S[targetEnrType].draft = S[targetEnrType].draft || {};
        const draft = S[targetEnrType].draft;

        if (!draft.produit && (produit || srcLigne?.produit)) {
          draft.produit = produit || srcLigne.produit;
        }
        draft[`_${sourceEnrType}_ts`] = sourceTs;
        draft._linked_from             = sourceEnrType;
        draft._linked_ts               = sourceTs;

        if (srcLigne?._plat_id) {
          draft._plat_id  = srcLigne._plat_id;
          draft._plat_nom = srcLigne._plat_nom || srcLigne.produit || produit || '';
          draft._menu_id  = srcLigne._menu_id  || '';
        }

        if (typeof save === 'function') save();

        // Mettre à jour le DOM
        const inp = document.getElementById(`ac-produit-${targetEnrType}`)
          || document.getElementById(`inp-produit-${targetEnrType}`);
        if (inp && !inp.value && draft.produit) {
          inp.value = draft.produit;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }

      if (typeof toast === 'function') {
        const m = ENR_META[sourceEnrType] || {};
        toast(`✅ Lié à ${m.icon||''} ${m.label||sourceEnrType}`, 'success');
      }

      // Invalider le cache Supabase pour ce plat
      try {
        const c = JSON.parse(localStorage.getItem(SEARCH_CACHE) || '{}');
        delete c[_norm(produit)];
        localStorage.setItem(SEARCH_CACHE, JSON.stringify(c));
      } catch(e) {}

    } catch(e) {
      console.warn('[Tracabilite] applyLink:', e);
    }
  }

  // ── Injecter dans le banner ────────────────────────────────────
  async function _injectInBanner(enrId, ref) {
    const banner = document.getElementById('mn-link-banner-' + enrId);
    if (!banner || banner.querySelector('.trc-banner-extra')) return;

    const extra = document.createElement('div');
    extra.className = 'trc-banner-extra';
    extra.innerHTML = `<div class="trc-recette-loading">🔍 Recherche dans l'historique…</div>`;
    banner.appendChild(extra);

    // Recherche Supabase en arrière-plan
    const supaResults = await _searchSupabase(ref.nom, 7);

    // Candidats pour auto-liaison
    const candidates = _findCandidates(enrId, ref.nom, ref.plat_id, supaResults);

    // Steps déjà trouvés (pour alerte étapes manquantes)
    const foundSteps = new Set([
      ...Object.keys((getLifecycle(ref.plat_id)||{}).steps || {}),
      ...supaResults.map(r => r.enrType),
    ]);

    const suggestHtml  = _renderSuggestionsHTML(enrId, ref.nom, ref.plat_id, candidates);
    const timelineHtml = _renderTimelineHTML(ref.plat_id, ref.nom, supaResults);
    const missingHtml  = _renderMissingStepsHTML(ref.nom, foundSteps);

    extra.innerHTML = (suggestHtml || '') + (timelineHtml || '') + (missingHtml || '');

    if (!suggestHtml && !timelineHtml) {
      extra.innerHTML = `<div class="trc-recette-loading">Aucun historique trouvé pour ce plat — les prochaines saisies seront mémorisées.</div>`;
    }
  }

  // ── Hook SupaEngine.enqueue ────────────────────────────────────
  function _hookEnqueue() {
    if (!window.SupaEngine?.enqueue) { setTimeout(_hookEnqueue, 500); return; }
    if (window.__trcEnqueueHooked) return;
    const orig = SupaEngine.enqueue.bind(SupaEngine);
    SupaEngine.enqueue = function(enrType, record) {
      const r = orig(enrType, record);
      try {
        const platNom = record._plat_nom || record.produit || '';
        // Apprendre le pattern (nom plat → type ENR)
        if (platNom && ENR_META[enrType]) _learnPattern(platNom, enrType);
        // Mettre à jour le lifecycle si plat_id connu
        if (record._plat_id && ENR_META[enrType]) {
          addStepToLifecycle(record._plat_id, enrType, record);
          if (!getLifecycle(record._plat_id)?.platNom && platNom) {
            upsertLifecycle(record._plat_id, { platNom, menuId: record._menu_id || '' });
          }
          // Invalider le cache Supabase pour ce plat
          try {
            const c = JSON.parse(localStorage.getItem(SEARCH_CACHE) || '{}');
            delete c[_norm(platNom)];
            localStorage.setItem(SEARCH_CACHE, JSON.stringify(c));
          } catch(e) {}
        }
      } catch(e) {}
      return r;
    };
    window.__trcEnqueueHooked = true;
  }

  // ── Hook fillFormWithPlat ──────────────────────────────────────
  function _hookFillForm() {
    if (typeof window.fillFormWithPlat !== 'function') { setTimeout(_hookFillForm, 500); return; }
    if (window.__trcFillFormHooked) return;
    const orig = window.fillFormWithPlat;
    window.fillFormWithPlat = function(enrId, ref) {
      const r = orig.apply(this, arguments);
      try {
        if (ref?.nom) {
          if (ref.plat_id && !getLifecycle(ref.plat_id)) {
            upsertLifecycle(ref.plat_id, { platNom: ref.nom, menuId: ref.menu_id || '' });
          }
          // Lancer la recherche et l'injection async dans le banner
          setTimeout(() => _injectInBanner(enrId, ref), 80);
        }
      } catch(e) {}
      return r;
    };
    window.__trcFillFormHooked = true;
  }

  // ── Nettoyage (lifecycles > 14 jours) ─────────────────────────
  function _prune() {
    try {
      const all    = _lcGet();
      const cutoff = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
      let changed  = false;
      for (const [id, lc] of Object.entries(all)) {
        if ((lc.lastUpdated || '') < cutoff) { delete all[id]; changed = true; }
      }
      if (changed) _lcSet(all);
    } catch(e) {}
  }

  // ── Init ───────────────────────────────────────────────────────
  function _init() {
    _hookEnqueue();
    _hookFillForm();
    _prune();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _init);
  else setTimeout(_init, 200);

  // ── API publique ───────────────────────────────────────────────
  return {
    getLifecycle,
    addStepToLifecycle,
    applyLink,
    searchHistory: _searchLocal,
    inferChain: _inferChain,
  };
})();
