/**
   * app-cuisine.js — Application HACC.PRO Cuisine
   *
   * Module principal de la page Cuisine (HACCP terrain).
   * Contient toute la logique UI, les rendu des formulaires (ENR),
   * la gestion des sessions cuisinier, l'impression d'étiquettes,
   * et les interactions utilisateur.
   *
   * Dépend de (chargés avant via <script src>) :
   *   - supabaseConfig.js  — Clés et URL Supabase
   *   - authGuard.js       — Vérification de session au démarrage
   *   - supabaseService.js — Queue de sync + upload photos
   *   - printService.js    — Impression d'étiquettes
   *   - utils.js           — Fonctions utilitaires partagées
   */

  
// ════════════════════════════════════════════════════
// ÉTAT GLOBAL
// ════════════════════════════════════════════════════
const SK='haccp_v6';
let S=JSON.parse(localStorage.getItem(SK)||'{}');
let cur='accueil';

// ── UUID stable sur chaque entrée (déduplication sync) ──
function newUUID(){return(typeof crypto!=='undefined'&&crypto.randomUUID)?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0;return(c==='x'?r:(r&0x3|0x8)).toString(16);});}
function stampEntry(obj){if(!obj._uuid)obj._uuid=newUUID();if(!obj._created)obj._created=new Date().toISOString();return obj;}
let _cloudSaveTimer = null;
function save(){
  try {
    localStorage.setItem(SK,JSON.stringify(S));
    // Sauvegarde cloud debounced (10 sec après la dernière modif)
    if (_cloudSaveTimer) clearTimeout(_cloudSaveTimer);
    _cloudSaveTimer = setTimeout(() => {
      if (typeof _saveConfigToSupabase === 'function') _saveConfigToSupabase();
    }, 10000);
  } catch(e) {
    // localStorage plein — compresser les photos async puis réessayer
    if(e.name==='QuotaExceededError'||e.code===22){
      try {
        const s2=JSON.parse(JSON.stringify(S));
        const _photoKeys=['p1_photo','p2_photo','photo'];
        const _tasks=[];
        ['enr23','enr31'].forEach(sec=>{
          const d=(s2[sec]||{}).draft||{};
          _photoKeys.forEach(k=>{
            if(d[k]&&d[k].length>50000){
              _tasks.push(new Promise(res=>_compressB64Async(d[k],0.4,c=>{d[k]=c;res();})));
            }
          });
          (s2[sec]?.lignes||[]).forEach(r=>{
            _photoKeys.forEach(k=>{
              if(r[k]&&r[k].length>50000){
                _tasks.push(new Promise(res=>_compressB64Async(r[k],0.4,c=>{r[k]=c;res();})));
              }
            });
          });
        });
        Promise.all(_tasks).then(()=>{
          try{
            localStorage.setItem(SK,JSON.stringify(s2));
            Object.assign(S,s2);
            toast('\u26a0\ufe0f Stockage plein \u2014 photos compress\u00e9es automatiquement','warning');
          }catch(e2){
            toast('\u26a0\ufe0f Stockage plein \u2014 supprimez des anciennes fiches','error');
          }
        });
      } catch(e2){
        toast('\u26a0\ufe0f Stockage plein \u2014 impossible de compresser','error');
      }
    }
  }
}
function _compressB64Async(b64, quality, callback) {
  try {
    if (!b64 || b64.length < 100) { callback(b64); return; }
    if (b64.startsWith('data:image/jpeg') && b64.length < 40000) { callback(b64); return; }
    const img = new Image();
    img.onload = function() {
      try {
        const c = document.createElement('canvas');
        c.width = 600; c.height = 450;
        c.getContext('2d').drawImage(img, 0, 0, 600, 450);
        callback(c.toDataURL('image/jpeg', quality || 0.4));
      } catch(e) { callback(b64); }
    };
    img.onerror = function() { callback(b64); };
    img.src = b64;
  } catch(e) { callback(b64); }
}
// Ancienne version synchrone conservée uniquement pour compatibilité ascendante — NE PAS utiliser pour les photos
function _compressB64(b64, quality) {
  try {
    if (!b64 || b64.length < 100) return b64;
    if (b64.startsWith('data:image/jpeg') && b64.length < 40000) return b64;
    const c = document.createElement('canvas');
    c.width = 600; c.height = 450;
    const ctx = c.getContext('2d');
    return c.toDataURL('image/jpeg', quality || 0.4);
  } catch(e) { return b64; }
}
// today / nowT / nowDT définis dans utils.js

// Récupère le nom de l'établissement depuis la source la plus fiable disponible.
// Ordre de priorité :
//   1. S.config.etab (rempli par _loadFromSupabase depuis sites.name)
//   2. haccp_supa_cfg_v1.siteNom (posé par index.html au login)
//   3. S.syncCfg.siteNom (legacy)
//   4. 'Établissement' en dernier recours
function getSiteName(){
  try {
    const e = (S.config?.etab||'').trim();
    if (e) return e;
  } catch(e){}
  try {
    const cfg = JSON.parse(localStorage.getItem('haccp_supa_cfg_v1')||'{}');
    if (cfg.siteNom && String(cfg.siteNom).trim()) return String(cfg.siteNom).trim();
  } catch(e){}
  try {
    if (S.syncCfg?.siteNom && String(S.syncCfg.siteNom).trim()) return String(S.syncCfg.siteNom).trim();
  } catch(e){}
  return 'Établissement';
}
// escH défini dans utils.js
const gd=(id,sec)=>((S[sec]||{}).draft||{})[id];
function sd(id,val,sec){S[sec]=S[sec]||{};S[sec].draft=S[sec].draft||{};S[sec].draft[id]=val;save();}
function saveCfg(){
  S.config=S.config||{};
  S.config.etab=document.getElementById('etab-nom').value;
  S.config.code=document.getElementById('etab-code').value;
  S.config.mois=document.getElementById('etab-mois').value;
  save();
  // h-etab-disp supprimé — rien à mettre à jour dans le header
}
function toast(msg,type='success'){
  // Ne pas afficher si le modal PIN est ouvert (évite de bloquer le pavé)
  const pinOpen=document.getElementById('pin-modal')?.classList.contains('open');
  if(pinOpen) return;
  const t=document.getElementById('toast');
  t.textContent=msg;t.className=`show ${type}`;
  setTimeout(()=>t.className='',1800);
}
function escAttr(v){ return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;'); }

function closeTabletAlertModal(){
  _photoReqCaptureDataUrl = '';
  document.getElementById('tablet-alert-ov')?.remove();
}

let _photoReqCaptureDataUrl = '';

async function acknowledgeTabletAlert(alertId, response, extra = {}){
  const cfg = SupaEngine.cfg();
  const siteCode = (cfg.siteId||'').toUpperCase();
  if(!alertId) return;
  let note = '';
  if(response === 'other' && !extra.note){
    // Utiliser le modal in-app au lieu du prompt() natif Android
    showInputModal(
      '✍️ Action corrective effectuée',
      'Précisez ce qui a été fait (retrait produit, information équipe...)',
      async (val)=>{
        if(!val||!val.trim()) return;
        await acknowledgeTabletAlert(alertId, response, {...extra, note:val.trim()});
      }
    );
    return; // La callback reprendra l'appel avec la note
  }
  try{
    // ACK direct Supabase — bypass Netlify Function
    const _ac = cfg;
    const now = new Date().toISOString();
    const ackRow = {
      site_id: _ac.siteId||'',
      tenant_id: _ac.tenantId||null,
      enr_type: 'hub_alert_ack',
      client_id: 'ack:'+alertId+':'+(cfg.siteId||'')+'_'+Date.now(),
      recorded_at: now,
      data: {
        alert_id: alertId,
        site_code: siteCode,
        response: response||'ok',
        note: extra.note||note||'',
        acked_at: now,
        has_photo: !!(extra.photo_data_url),
        zone: extra.zone||'',
        period_mode: extra.period_mode||'',
        shot_view: extra.shot_view||''
      }
    };
    const ackRes = await fetch(`${_ac.url}/rest/v1/pms_records`, {
      method: 'POST',
      headers: {
        apikey: _ac.anonKey,
        Authorization: `Bearer ${_ac.userToken}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(ackRow)
    });
    if(!ackRes.ok){
      const t=await ackRes.text().catch(()=>'');
      throw new Error('HTTP '+ackRes.status+' '+t.slice(0,80));
    }
    // Upload photo si présente → stocker l'URL publique dans l'ack
    if(extra.photo_data_url && extra.photo_data_url.startsWith('data:image/')){
      try{
        const [meta,b64]=extra.photo_data_url.split(',');
        const mime=((meta.match(/data:([^;]+)/)||[])[1])||'image/jpeg';
        const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
        const path=`acks/${_ac.siteId}/${alertId}_${Date.now()}.jpg`;
        const uploadRes=await fetch(`${_ac.url}/storage/v1/object/pms-photos/${path}`,{
          method:'POST',
          headers:{apikey:_ac.anonKey,Authorization:`Bearer ${_ac.userToken}`,'Content-Type':mime,'x-upsert':'true'},
          body:bytes
        });
        if(uploadRes.ok){
          // Mettre à jour l'ack avec l'URL publique de la photo
          const photoUrl=`${_ac.url}/storage/v1/object/public/pms-photos/${path}`;
          ackRow.data.photo_url = photoUrl;
          // Patch le record qu'on vient d'insérer avec l'URL
          await fetch(`${_ac.url}/rest/v1/pms_records?client_id=eq.${encodeURIComponent(ackRow.client_id)}`,{
            method:'PATCH',
            headers:{apikey:_ac.anonKey,Authorization:`Bearer ${_ac.userToken}`,'Content-Type':'application/json','Prefer':'return=minimal'},
            body:JSON.stringify({data:ackRow.data})
          });
        }
      }catch(imgE){console.warn('[ack photo]',imgE);}
    }
    toast('✅ Réponse envoyée','success');
  }catch(e){
    console.warn('[tablet alert ack]',e.message);
    toast('⚠️ Envoi impossible : '+e.message.slice(0,60), 'warning');
    return;
  }
  closeTabletAlertModal();
}

function _compressImageDataUrl(rawDataUrl, maxW=1280, maxH=960, quality=.78){
  return new Promise((resolve,reject)=>{
    const img = new Image();
    img.onload = ()=>{
      let w = img.width;
      let h = img.height;
      if(w>maxW){ h = Math.round(h*maxW/w); w = maxW; }
      if(h>maxH){ w = Math.round(w*maxH/h); h = maxH; }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img,0,0,w,h);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = ()=>reject(new Error('Image invalide'));
    img.src = rawDataUrl;
  });
}

function onPhotoRequestFileSelected(input){
  const file = input?.files?.[0];
  const preview = document.getElementById('photo-req-preview');
  if(!file){
    _photoReqCaptureDataUrl = '';
    if(preview) preview.innerHTML = '';
    return;
  }
  const fr = new FileReader();
  fr.onload = async ()=>{
    try{
      const raw = String(fr.result||'');
      const compressed = await _compressImageDataUrl(raw, 1280, 960, .78);
      _photoReqCaptureDataUrl = compressed;
      if(preview){
        preview.innerHTML = `<img src="${compressed}" style="width:100%;max-height:220px;object-fit:cover;border-radius:10px;border:1.5px solid #bfdbfe"><div style="font-size:.68rem;color:#1e3a8a;font-weight:700;margin-top:4px">✅ Photo prête à l'envoi</div>`;
      }
    }catch(e){
      _photoReqCaptureDataUrl = '';
      if(preview) preview.innerHTML = '';
      toast('Image invalide','warning');
    }
  };
  fr.onerror = ()=>toast('Erreur lecture image','warning');
  fr.readAsDataURL(file);
}

async function submitPhotoRequestAck(alertId){
  if(!_photoReqCaptureDataUrl){
    toast('📷 Ajoutez une photo avant envoi','warning');
    return;
  }
  const zone = (document.getElementById('photo-req-zone')?.textContent||'').trim();
  const period_mode = document.getElementById('photo-req-period')?.dataset.value || 'weekly';
  const shot_view = document.getElementById('photo-req-view')?.dataset.value || 'face';
  await acknowledgeTabletAlert(alertId,'ok',{
    photo_data_url:_photoReqCaptureDataUrl,
    zone,
    period_mode,
    shot_view,
  });
}

async function submitPhotoRequestNoPhoto(alertId){
  showInputModal(
    '⚠️ Impossible maintenant',
    'Indiquez pourquoi la photo ne peut pas être prise maintenant :',
    async (val)=>{
      if(!val||!val.trim()) return;
      await acknowledgeTabletAlert(alertId,'other',{note:val.trim()});
    }
  );
}

function showTabletPhotoRequestModal(alert){
  closeTabletAlertModal();
  const title = escH(alert?.title || 'Demande photo hygiène');
  const msg = escH(alert?.message || '');
  const zone = escH(alert?.zone || alert?.requested_zone || 'Zone non précisée');
  const periodMode = String(alert?.period_mode||'weekly');
  const shotView = String(alert?.shot_view||'face');
  const periodLabel = periodMode==='monthly' ? 'Mensuelle' : 'Hebdomadaire';
  const viewLabel = shotView==='detail' ? 'Détail zone' : 'De face (vue générale)';
  const dueLabel = alert?.due_at ? new Date(alert.due_at).toLocaleString('fr-FR') : '';
  const aid = escAttr(alert.id||'');
  const el = document.createElement('div');
  el.id = 'tablet-alert-ov';
  el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(10,22,48,.84);display:flex;align-items:center;justify-content:center;padding:14px';
  el.innerHTML = `<div style="background:#fff;border-radius:18px;max-width:560px;width:100%;max-height:92vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.35);border:2px solid #bfdbfe">
    <div style="padding:14px 16px;background:#1e3a8a;color:#fff">
      <div style="font-size:.72rem;font-weight:800;letter-spacing:.6px;text-transform:uppercase;opacity:.9">DEMANDE SIÈGE</div>
      <div style="font-size:1rem;font-weight:900;margin-top:2px">${title}</div>
    </div>
    <div style="padding:14px 16px">
      <div id="photo-req-zone" style="font-size:.8rem;font-weight:800;color:#1e3a8a;margin-bottom:6px">📍 ${zone}</div>
      <div style="font-size:.72rem;color:#475569;margin-bottom:8px" id="photo-req-period" data-value="${escAttr(periodMode)}">📆 ${periodLabel}</div>
      <div style="font-size:.72rem;color:#475569;margin-bottom:8px" id="photo-req-view" data-value="${escAttr(shotView)}">👁️ ${viewLabel}</div>
      ${dueLabel?`<div style="font-size:.72rem;color:#991b1b;font-weight:700;margin-bottom:8px">⏰ Échéance: ${escH(dueLabel)}</div>`:''}
      <div style="font-size:.84rem;line-height:1.45;color:#111827;white-space:pre-wrap">${msg}</div>
      <div style="margin-top:12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:10px 12px">
        <div style="font-size:.75rem;font-weight:800;color:#1e3a8a;margin-bottom:6px">📷 Photo demandée</div>
        <label style="display:inline-flex;align-items:center;gap:8px;background:#1e3a8a;color:#fff;border-radius:8px;padding:9px 12px;cursor:pointer;font-size:.78rem;font-weight:700">
          Ouvrir la caméra
          <input type="file" accept="image/*" capture="environment" style="display:none" onchange="onPhotoRequestFileSelected(this)">
        </label>
        <div id="photo-req-preview" style="margin-top:8px"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px">
        <button onclick="submitPhotoRequestAck('${aid}')" style="padding:14px 10px;background:#1e3a8a;color:#fff;border:none;border-radius:12px;font-size:.8rem;font-weight:900;cursor:pointer;font-family:inherit">✅ Envoyer la photo</button>
        <button onclick="submitPhotoRequestNoPhoto('${aid}')" style="padding:14px 10px;background:#475569;color:#fff;border:none;border-radius:12px;font-size:.8rem;font-weight:900;cursor:pointer;font-family:inherit">⚠️ Impossible maintenant</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(el);
  appVibrate([120,70,120]);
}

function showTabletRecallModal(alert){
  closeTabletAlertModal();
  const title = escH(alert?.title || 'Alerte retrait de lot');
  const msg = escH(alert?.message || '');
  const product = alert?.product_name ? escH(alert.product_name) : '';
  const lot = alert?.lot_number ? escH(alert.lot_number) : '';
  const dlc = alert?.product_dlc ? new Date(String(alert.product_dlc)+'T12:00').toLocaleDateString('fr-FR') : '';
  const image = alert?.image_data_url ? String(alert.image_data_url) : '';
  const el = document.createElement('div');
  el.id = 'tablet-alert-ov';
  el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(20,5,25,.84);display:flex;align-items:center;justify-content:center;padding:14px';
  const infoLine = [
    product?`Produit: ${product}`:'',
    lot?`Lot: ${lot}`:'',
    dlc?`DLC: ${escH(dlc)}`:''
  ].filter(Boolean).join(' · ');
  const aid = escAttr(alert.id||'');
  el.innerHTML = `<div style="background:#fff;border-radius:18px;max-width:560px;width:100%;max-height:92vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.35);border:2px solid #fecaca">
    <div style="padding:14px 16px;background:#7f1d1d;color:#fff">
      <div style="font-size:.72rem;font-weight:800;letter-spacing:.6px;text-transform:uppercase;opacity:.9">ALERTE TABLETTE</div>
      <div style="font-size:1rem;font-weight:900;margin-top:2px">${title}</div>
    </div>
    <div style="padding:14px 16px">
      ${infoLine?`<div style="font-size:.8rem;font-weight:700;color:#991b1b;margin-bottom:8px;padding:8px 10px;background:#fef2f2;border-radius:8px">${infoLine}</div>`:''}
      <div style="font-size:.85rem;line-height:1.45;color:#111827;white-space:pre-wrap">${msg}</div>
      ${image?`<div style="margin-top:12px"><img src="${escAttr(image)}" style="width:100%;max-height:260px;object-fit:contain;border:1px solid #fecaca;border-radius:12px;background:#fff5f5"></div>`:''}
      <div style="margin-top:14px;font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#475569;margin-bottom:8px">Action corrective effectuée</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <button onclick="acknowledgeTabletAlert('${aid}','removed')" style="padding:14px 10px;background:#16a34a;color:#fff;border:none;border-radius:12px;font-size:.8rem;font-weight:900;cursor:pointer;font-family:inherit">✅ Produit retiré</button>
        <button onclick="acknowledgeTabletAlert('${aid}','not_in_stock')" style="padding:14px 10px;background:#475569;color:#fff;border:none;border-radius:12px;font-size:.8rem;font-weight:900;cursor:pointer;font-family:inherit">📭 Pas en stock</button>
        <button onclick="acknowledgeTabletAlert('${aid}','ok')" style="padding:14px 10px;background:#1e3a8a;color:#fff;border:none;border-radius:12px;font-size:.8rem;font-weight:900;cursor:pointer;font-family:inherit">👍 OK / Non concerné</button>
        <button onclick="acknowledgeTabletAlert('${aid}','other')" style="padding:14px 10px;background:#b45309;color:#fff;border:none;border-radius:12px;font-size:.8rem;font-weight:900;cursor:pointer;font-family:inherit">✍️ Autre (préciser)</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(el);
  appVibrate([160,100,160,100,240]);
}


// ── Modal saisie texte (remplace prompt() Android) ────────────────────────
function showInputModal(title, placeholder, cb){
  const existing=document.getElementById('input-modal-ov');
  if(existing)existing.remove();
  const el=document.createElement('div');
  el.id='input-modal-ov';
  el.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:20px';
  el.innerHTML=`<div style="background:#fff;border-radius:16px;padding:20px;max-width:420px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.3)">
    <div style="font-size:.9rem;font-weight:900;color:#1e293b;margin-bottom:10px">${escH(title)}</div>
    <textarea id="input-modal-val" placeholder="${escH(placeholder)}" rows="3"
      style="width:100%;padding:10px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:.85rem;font-family:inherit;resize:none;box-sizing:border-box;outline:none"></textarea>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button onclick="document.getElementById('input-modal-ov').remove()"
        style="flex:1;padding:10px;background:#f1f5f9;color:#64748b;border:none;border-radius:10px;font-size:.8rem;font-weight:700;cursor:pointer;font-family:inherit">Annuler</button>
      <button onclick="(()=>{const v=document.getElementById('input-modal-val').value;document.getElementById('input-modal-ov').remove();(window._inputModalCb||function(){})(v);})()"
        style="flex:2;padding:10px;background:#1e3a8a;color:#fff;border:none;border-radius:10px;font-size:.8rem;font-weight:800;cursor:pointer;font-family:inherit">✅ Confirmer</button>
    </div>
  </div>`;
  window._inputModalCb=cb;
  document.body.appendChild(el);
  setTimeout(()=>document.getElementById('input-modal-val')?.focus(),100);
}

function showTabletAlertModal(alert){
  if(String(alert?.kind||'')==='photo_request'){
    showTabletPhotoRequestModal(alert);
    return;
  }
  showTabletRecallModal(alert);
}

async function pollTabletAlerts(){
  if(_tabletAlertsPollBusy) return;
  const cfg = SupaEngine.cfg();
  if(!cfg.userToken || !cfg.siteId || !cfg.url) return;
  _tabletAlertsPollBusy = true;
  try{
    const siteCode = String(cfg.siteId||'').toUpperCase();
    const now = new Date().toISOString();
    // Lecture directe Supabase — bypass Netlify Blobs
    // Récupérer alertes ET demandes photo
    const res = await fetch(
      `${cfg.url}/rest/v1/pms_records?enr_type=in.(hub_alert,hub_photo_request)&site_id=eq.${encodeURIComponent(siteCode)}&order=recorded_at.desc&limit=50`,
      { headers:{ apikey:cfg.anonKey, Authorization:`Bearer ${cfg.userToken}`, Accept:'application/json' } }
    );
    const rows = res.ok ? await res.json() : [];
    const alerts = (Array.isArray(rows)?rows:[])
      .map(r=>r.data||{})
      .filter(a=>a.id && !a.closed_at && (!a.expires_at||a.expires_at>now));
    // Alertes non encore vues
    const toShow = alerts.find(a=>!_tabletAlertsLastShown.has(a.id));
    if(toShow){
      _tabletAlertsLastShown.add(toShow.id);
      _saveSeenAlert(toShow.id);
      showTabletAlertModal(toShow);
    }
  }catch(e){
    console.warn('[tablet alerts]',e.message);
  }finally{
    _tabletAlertsPollBusy = false;
  }
}

// ════════════════════════════════════════════════════
// CUISINIERS
// ════════════════════════════════════════════════════
const getChefs=()=>S.config?.chefs||[];
function addChef(){
  const inp=document.getElementById('chef-inp');
  const n=inp.value.trim();
  if(!n)return;
  S.config=S.config||{};
  S.config.chefs=[...new Set([...(S.config.chefs||[]),n])];
  // Aussi sauver dans chefs_manuels pour survivre au rechargement depuis profiles
  S.config.chefs_manuels=[...new Set([...(S.config.chefs_manuels||[]),n])];
  inp.value='';save();renderChefList();
  _saveConfigToSupabase();
}
function removeChef(i){
  const name = (S.config?.chefs||[])[i];
  showConfirm('Supprimer '+name+' ?', 'Ce cuisinier sera retiré de la liste.', '🗑️ Supprimer', ()=>{
    S.config.chefs.splice(i,1);
    // Retirer aussi de chefs_manuels
    if(S.config.chefs_manuels) S.config.chefs_manuels = S.config.chefs_manuels.filter(c=>c!==name);
    save(); _chefPinExpanded=null; renderChefList();
    _saveConfigToSupabase();
  });
}
function renderChefList(){
  const chefs=getChefs();
  document.getElementById('chef-list').innerHTML=chefs.length===0
    ?'<div style="color:#b89ab6;font-size:.82rem;padding:5px 4px">Aucun cuisinier enregistré.</div>'
    :chefs.map((c,i)=>`<div class="chef-row"><span>👨‍🍳 ${escH(c)}</span><button class="del" onclick="removeChef(${i})">🗑</button></div>`).join('');
}
function chefSel(id,sec,label){
  const chefs=getChefs();
  const active=getActiveSession();
  // Auto-remplissage si session active et champ vide
  if(active && chefs.includes(active) && !gd(id,sec)){
    sd(id,active,sec);
  }
  const val=gd(id,sec)||'';
  if(chefs.length===0)return inpEl({id,label,ph:'Visa / Initiales'},sec);
  return`<div class="fg"><label>${label}${active&&val===active?' <span style="font-size:.65rem;background:#dcfce7;color:#166534;padding:1px 6px;border-radius:8px;font-weight:700">✓ Session</span>':''}</label>
    <select class="fi" onchange="sd('${id}',this.value,'${sec}');doAutoCalc('${sec}')">
      <option value="">— Sélectionner —</option>
      ${chefs.map(c=>`<option ${val===c?'selected':''}>${escH(c)}</option>`).join('')}
    </select></div>`;
}

// ════════════════════════════════════════════════════
// CATALOGUE PRODUITS (autocomplétion)
// ════════════════════════════════════════════════════
const getProds=()=>S.produits||[];
function addProd(p){
  if(!p?.trim())return;
  p=p.trim();
  const l=getProds();
  if(!l.includes(p)){S.produits=[p,...l].slice(0,400);save();}
}
const matchProds=q=>{
  if(!q||q.length<2)return[];
  const lq=q.toLowerCase();
  return getProds().filter(p=>p.toLowerCase().includes(lq)).slice(0,8);
};

// ════════════════════════════════════════════════════
// SECTIONS
// ════════════════════════════════════════════════════
const ALL=[
  {id:'accueil',short:'🏠 Accueil',label:'Accueil',cat:'nav',fixed:true},
  {id:'search',short:'🔍 Historique',label:'Historique & Recherche',cat:'tool',fixed:true},
  {id:'enr01',short:'❄️ Refroidissement',label:'ENR01 – Refroidissement',cat:'ccp',tag:'CCP'},
  {id:'enr02',short:'🔥 Remise en T°C',label:'ENR02 – Remise en T°C',cat:'ccp',tag:'CCP'},
  {id:'enr03',short:'🔄 Refroid.+Remise',label:'ENR03 – Refroid.+Remise',cat:'ccp',tag:'CCP'},
  {id:'enr04',short:'🥩 Steaks hachés',label:'ENR04 – Cuisson steaks hachés',cat:'prpo',tag:'PrPo'},
  {id:'enr05',short:'🍟 Fritures',label:'ENR05 – Fritures',cat:'prpo',tag:'PrPo'},
  {id:'enr06',short:'🍟 Fritures+test',label:'ENR06 – Fritures testeur',cat:'prpo',tag:'PrPo'},
  {id:'enr07',short:'🥘 Bien Faits cuit',label:'ENR07 – Bien Faits cuit',cat:'prpo',tag:'PrPo'},
  {id:'enr08',short:'🥗 TM/BF sans cuis.',label:'ENR08 – TM/BF sans cuisson',cat:'prpo',tag:'PrPo'},
  {id:'enr09',short:'♨️ Cond. chaud',label:'ENR09 – Conditionnement chaud',cat:'prpo',tag:'PrPo'},
  {id:'enr10',short:'🧊 Cond. froid',label:'ENR10 – Conditionnement froid',cat:'prpo',tag:'PrPo'},
  {id:'enr11',short:'🍽️ Plateaux froids',label:'ENR11 – Chaîne plateaux froid',cat:'prpo',tag:'PrPo'},
  {id:'enr12',short:'🍽️ Plateaux chauds',label:'ENR12 – Chaîne plateaux chaud',cat:'prpo',tag:'PrPo'},
  {id:'enr13',short:'🚚 Départ cuisine',label:'ENR13 – Départ cuisine',cat:'prpo',tag:'PrPo'},
  {id:'enr14',short:'🛎️ Distrib. plat.',label:'ENR14 – Distribution plateaux',cat:'prpo',tag:'PrPo'},
  {id:'enr15',short:'🏠 Distrib. SAM',label:'ENR15 – Distribution SAM',cat:'prpo',tag:'PrPo'},
  {id:'enr16',short:'🍴 Distrib. Self',label:'ENR16 – Distribution Self',cat:'prpo',tag:'PrPo'},
  {id:'enr17',short:'🚐 Livraison froide',label:'ENR17 – Livraison froide',cat:'prpo',tag:'PrPo'},
  {id:'enr18',short:'🚐 Livraison chaude',label:'ENR18 – Livraison chaude',cat:'prpo',tag:'PrPo'},
  {id:'enr19',short:'🌡️ Stockage T°C',label:'ENR19 – T°C Stockage mensuel',cat:'mensuel'},
  {id:'enr20',short:'☀️ Stockage canicule',label:'ENR20 – T°C Stockage canicule',cat:'mensuel'},
  {id:'enr21',short:'🌡️ Saisie individuelle',label:'ENR21 – T°C Stockage individuel',cat:'mensuel'},
  {id:'enr23',short:'📦 Réception',label:'ENR23 – Contrôle réception',cat:'mensuel'},
  {id:'enr26',short:'🌡️ Thermomètres',label:'ENR26 – Ctrl thermomètres',cat:'suivi'},
  {id:'enr27',short:'📊 Afficheurs CF',label:'ENR27 – Ctrl afficheurs',cat:'suivi'},
  {id:'enr28',short:'🧹 Nettoyage',label:'ENR28 – Validation nettoyage',cat:'suivi'},
  {id:'enr29',short:'👥 Sensibilisation',label:'ENR29 – Sensibilisation',cat:'ponctuel'},
  {id:'enr30',short:'🚨 Non-conformité',label:'ENR30 – Non-conformité',cat:'ponctuel'},
  {id:'enr31',short:'📋 Traçabilité MP',label:'ENR31 – Traçabilité MP',cat:'mensuel'},
  {id:'enr32',short:'⚠️ TIAC',label:'ENR32 – Suspicion TIAC',cat:'ponctuel'},
  {id:'enr33',short:'🍱 Plats témoins',label:'ENR33 – Plats témoins',cat:'etiq'},
  {id:'enr34',short:'🏷️ Étiq. production',label:'ENR34 – Étiq. production',cat:'etiq'},
  {id:'enr35',short:'🥩 Origine viandes',label:'ENR35 – Origine viandes',cat:'etiq'},
  {id:'enr36',short:'♻️ Excédents',label:'ENR36 – Étiq. excédents',cat:'etiq'},
  {id:'enr39',short:'🧺 Pique-nique',label:'ENR39 – Pique-nique',cat:'ponctuel'},
  {id:'enr52',short:'🌡️ T°C excédents',label:'ENR52 – Ctrl T°C excédents',cat:'prpo',tag:'PrPo'},
  {id:'enr53',short:'🤝 Don assoc.',label:'ENR53 – Récépissé de don',cat:'ponctuel'},
  {id:'enr_allergenes',short:'⚠️ Allergènes',label:'ENR-ALG – Gestion des allergènes',cat:'tracabilite',tag:'INCO',fixed:false},
  {id:'enr_tc_distrib',short:'🌡️ T°C Distribution',label:'T°C Distribution – Midi & Soir',cat:'prpo'},
  {id:'enr24',short:'🔧 Maintenance',label:'ENR24 – Plan de maintenance équipements',cat:'suivi'},
  {id:'enr25',short:'🔬 Contrôle labo',label:'ENR25 – Plan de contrôle microbiologique',cat:'suivi'},
];

/* Set of ENR IDs allowed by the tenant — null means no restriction */
window._tenantAllowedEnr = null;

function navOrder(){
  const cfg=S.navCfg||{},hid=cfg.hidden||{};
  let order=cfg.order||ALL.map(s=>s.id);
  ALL.forEach(s=>{if(!order.includes(s.id))order.push(s.id);});
  const allowed=window._tenantAllowedEnr;
  return order.filter(id=>{
    const s=ALL.find(s=>s.id===id);
    if(!s) return false;
    if(s.fixed) return true;
    if(allowed && !allowed.has(id)) return false;
    return !hid[id];
  });
}
// ════════════════════════════════════════════════════
// BADGES DE NAVIGATION — alertes visuelles par module
// ════════════════════════════════════════════════════
function pendingLabelsCount(){
  // Lot ENR34 production + lot ENR36 excédents
  return _e34batch.length + _e36batch.length + _e33batch.length;
}

function navBadge(id){
  try {
    switch(id){

      // ENR30 — NC auto non clôturées
      case 'enr30':{
        const n=ncAutoCount();
        return n>0?{n,col:'#dc2626'}:null;
      }

      // ENR28 — Nettoyage en retard ou NC + nuisibles non vérifiés aujourd'hui
      case 'enr28':{
        // Badge = uniquement items nettoyage en RETARD ou NC
        // (les nuisibles ont leur propre pastille sur l'onglet, pas besoin de les mélanger)
        const nettUrgent=nettRef().filter(it=>['retard','nc'].includes(nettStatus(it))).length;
        const hasNC=nettRef().some(it=>nettStatus(it)==='nc');
        return nettUrgent>0?{n:nettUrgent,col:hasNC?'#dc2626':'#d97706'}:null;
      }

      // ENR01 — Refroidissements en attente (ni réchauffé ni servi froid, récents)
      case 'enr01':{
        const _now48hA = Date.now() - 48*60*60*1000;
        const _tsTA = new Set();
        (S['enr02']?.lignes||[]).forEach(r=>{ if(r._enr01_ts) _tsTA.add(r._enr01_ts); });
        (S['enr03']?.lignes||[]).forEach(r=>{ if(r._enr01_ts) _tsTA.add(r._enr01_ts); });
        const n=(S['enr01']?.lignes||[]).filter(r=>{
          if(r._statut && r._statut!=='en_attente') return false;
          if(r._ts && _tsTA.has(r._ts)) return false;
          // destination filter retiré : anciennes saisies sans destination
          const ts = r._ts ? new Date(r._ts).getTime() : (r.date ? new Date(r.date+'T12:00').getTime() : 0);
          return ts >= _now48hA;
        }).length;
        return n>0?{n,col:'#1d4ed8'}:null;
      }

      // ENR19 — Enceintes non saisies aujourd'hui (ouverture ou fermeture manquante)
      case 'enr19':{
        const todayStr=today();
        const encs=getEnceintes();
        const saisies=(S['enr19']?.saisies||[]).filter(r=>r.date===todayStr);
        // Enceintes avec au moins une saisie hors seuil aujourd'hui
        const ncEnc=encs.filter(e=>{
          const rOuv=saisies.filter(r=>r.enc_id===e.id&&r.moment==='ouv').slice(-1)[0];
          const rFerm=saisies.filter(r=>r.enc_id===e.id&&r.moment==='ferm').slice(-1)[0];
          return encConforme(rOuv?.temp,e.consigne)===false||encConforme(rFerm?.temp,e.consigne)===false;
        }).length;
        // Enceintes sans aucune saisie aujourd'hui
        const manquantes=encs.filter(e=>!saisies.some(r=>r.enc_id===e.id)).length;
        const n=ncEnc>0?ncEnc:manquantes;
        return n>0?{n,col:ncEnc>0?'#dc2626':'#6d28d9'}:null;
      }

      // ENR23 — Réceptions du jour non saisies (pas de ligne aujourd'hui = avertissement doux)
      // On ne badge que s'il y a des NC réception
      case 'enr23':{
        const todayStr=today();
        const nc=(S['enr23']?.lignes||[]).filter(r=>r.date===todayStr&&r.conforme==='NON').length;
        return nc>0?{n:nc,col:'#dc2626'}:null;
      }

      // ENR02 — Remises en T°C attendues (ENR01 en attente mode rechauffe)
      case 'enr02':{
        const _now48h = Date.now() - 48*60*60*1000;
        const _tsTraites = new Set();
        (S['enr02']?.lignes||[]).forEach(r=>{ if(r._enr01_ts) _tsTraites.add(r._enr01_ts); });
        (S['enr03']?.lignes||[]).forEach(r=>{ if(r._enr01_ts) _tsTraites.add(r._enr01_ts); });
        const n=(S['enr01']?.lignes||[])
          .filter(r=>{
            if(r._statut && r._statut!=='en_attente') return false;
            if(r._ts && _tsTraites.has(r._ts)) return false;
            // destination filter retiré
            const ts = r._ts ? new Date(r._ts).getTime() : (r.date ? new Date(r.date+'T12:00').getTime() : 0);
            return ts >= _now48h;
          })
          .length;
        return n>0?{n,col:'#d97706'}:null;
      }

      case 'enr34':{
        const n=_e34batch.length;
        return n>0?{n,col:'#7c3aed'}:null;
      }
      case 'enr36':{
        const n=_e36batch.length;
        return n>0?{n,col:'#1d4ed8'}:null;
      }
      case 'enr33':{
        const n=_e33batch.length;
        const hasNom=e33d().produit&&!n;
        return n>0?{n,col:'#5C1E5A'}:hasNom?{n:'!',col:'#d97706'}:null;
      }
      default: return null;
    }
  } catch(e){ return null; }
}

function renderNav(){
  document.getElementById('main-nav').innerHTML=navOrder().map(id=>{
    const s=ALL.find(s=>s.id===id);if(!s)return'';
    const cl=[s.cat==='ccp'?'ccp':s.cat==='prpo'?'prpo':s.cat==='tool'?'tool':s.custom?'custom':'',cur===id?'active':''].join(' ');
    const _b=navBadge(id);
    const _badgeHtml=_b
      ?`<span style="background:${_b.col};color:#fff;border-radius:20px;padding:0 6px;font-size:.58rem;font-weight:900;margin-left:3px;vertical-align:middle;line-height:1.7;display:inline-block;min-width:16px;text-align:center">${_b.n}</span>`
      :'';
    return`<button class="nb ${cl}" onclick="goTo('${id}')">${s.short}${_badgeHtml}</button>`;
  }).join('');
  const a=document.querySelector('.nb.active');
  if(a)setTimeout(()=>a.scrollIntoView({block:'nearest',inline:'center',behavior:'smooth'}),60);
}
function goTo(id, scrollTarget){
  if(id==='enr30' && cur!=='enr30'){
    nettAdminGuard(()=>{
      const prev=cur; cur='enr30';
      try{history.pushState({page:'enr30',prev},'',' ');}catch(e){}
      renderNav();renderMain();window.scrollTo(0,0);ccpTimerStop();
      loadCorrectiveActionsCatalog(false);
    });
    return;
  }
  const prev=cur; cur=id;
  try{history.pushState({page:id,prev},'',' ');}catch(e){}
  renderNav();renderMain();window.scrollTo(0,0);
  if(id==='enr30') loadCorrectiveActionsCatalog(false);
  if(id==='enr01'||id==='enr02'||id==='enr07'){ccpTimerStart();}else{ccpTimerStop();}
  if(scrollTarget){setTimeout(function(){var t=document.getElementById(scrollTarget);if(t)t.scrollIntoView({behavior:'smooth',block:'start'});},150);}
}

// ── Bouton Retour Android ─────────────────────────
window.addEventListener('popstate',function(e){
  var target=(e.state&&e.state.prev)||'accueil';
  cur=target;
  renderNav();renderMain();window.scrollTo(0,0);
  if(target==='enr01'||target==='enr02'||target==='enr07'){ccpTimerStart();}else{ccpTimerStop();}
});
// ════════════════════════════════════════════════════
// LICENCE SYSTÈME
// ════════════════════════════════════════════════════
const LIC_SECRET = 'RSTA2024HACCP_INTERNAL_V1_PMS';
const LIC_FEAT = {EXPORT:1, SYNC:2, AUDIT:4, CUSTOM:8};
const LIC_B32  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function licFNV32(s){
  let h = 0x811c9dc5 >>> 0;
  for(let i=0;i<s.length;i++) h=(Math.imul(h^s.charCodeAt(i),0x01000193))>>>0;
  return h;
}
function licToB32(bytes){
  let r='',bits=0,val=0;
  for(const b of bytes){val=(val<<8)|b;bits+=8;while(bits>=5){r+=LIC_B32[(val>>>(bits-5))&31];bits-=5;}}
  if(bits>0) r+=LIC_B32[(val<<(5-bits))&31];
  return r;
}
function licFromB32(s){
  const bytes=[];let bits=0,val=0;
  for(const c of s.toUpperCase()){
    const idx=LIC_B32.indexOf(c);if(idx<0)continue;
    val=(val<<5)|idx;bits+=5;
    if(bits>=8){bytes.push((val>>>(bits-8))&255);bits-=8;}
  }
  return new Uint8Array(bytes);
}

function parseLicKey(rawKey){
  try{
    const clean=rawKey.replace(/^RSTA[-\s]*/i,'').replace(/[^A-Z2-7]/gi,'').toUpperCase();
    if(clean.length<24) return{valid:false,reason:'Clé incomplète ('+clean.length+'/24 car.)'};
    const bytes=licFromB32(clean.slice(0,24));
    if(bytes.length<15) return{valid:false,reason:'Décodage échoué'};
    const payArr=Array.from(bytes.slice(0,10));
    const payStr=payArr.join(',');
    const h1=licFNV32(payStr+LIC_SECRET)>>>0;
    const h2=licFNV32(LIC_SECRET+payStr)>>>0;
    const sigOk=bytes[10]===((h1>>24)&0xFF)&&bytes[11]===((h1>>16)&0xFF)&&
                bytes[12]===((h1>>8)&0xFF)&&bytes[13]===(h1&0xFF)&&
                bytes[14]===((h2>>24)&0xFF);
    if(!sigOk) return{valid:false,reason:'Signature invalide — clé incorrecte'};
    const expCode=(bytes[0]<<8)|bytes[1];
    const year=2020+Math.floor(expCode/12);
    const month=(expCode%12)+1;
    const seats=bytes[2];
    const features=bytes[3];
    const siteHash=((bytes[4]<<24)|(bytes[5]<<16)|(bytes[6]<<8)|bytes[7])>>>0;
    const uid=((bytes[8]<<8)|bytes[9]).toString(16).toUpperCase().padStart(4,'0');
    const expEnd=new Date(year,month,0);
    const now=new Date();
    const expired=now>expEnd;
    const daysLeft=Math.ceil((expEnd-now)/86400000);
    return{valid:true,expired,daysLeft,
      exp:`${year}-${String(month).padStart(2,'0')}`,
      expDisplay:`${String(month).padStart(2,'0')}/${year}`,
      seats,features,siteHash,uid};
  }catch(e){return{valid:false,reason:'Erreur de décodage'};}
}

function isRO(){
  return false; // hors ligne
}
function roCheck(){ return false; }
function hasLicFeat(bit){
  try{ const c=JSON.parse(localStorage.getItem('haccp_supa_cfg_v1')||'{}'); return !!(c.userToken); }catch(e){ return false; }
}
function featCheck(bit,name){ return false; }

function licSiteMatch(parsed){
  if(!parsed||!parsed.valid) return false;
  const site=(S.config?.etab||'').toLowerCase().trim();
  if(!site) return true;
  return (licFNV32(site)>>>0)===parsed.siteHash;
}

function checkLicense(){
  // désactivé hors ligne
}

function updateLicBadge(){
  const el=document.getElementById('lic-header-badge');
  if(!el) return;
  try{
    const c=JSON.parse(localStorage.getItem('haccp_supa_cfg_v1')||'{}');
    el.textContent=c.userToken?'☁️ Connecté':'';
    el.style.cssText=c.userToken?'background:#f0fdf4;color:#166534;padding:4px 9px;border-radius:6px;font-size:.72rem;font-weight:800;display:inline-block':'display:none';
  }catch(e){ el.style.display='none'; }
}

function roBanner(){ return ''; }

let _licForced=false;
function openLicModal(forced){ }
function closeLicModal(){
  document.getElementById('lic-ov').classList.remove('open');
}

function licKeyInput(raw){
  const inp=document.getElementById('lic-key-inp');
  const stat=document.getElementById('lic-status');
  const info=document.getElementById('lic-info-panel');
  const btn=document.getElementById('lic-save-btn');
  // Normaliser : uppercase, garder tirets
  const norm=raw.toUpperCase().replace(/[^A-Z2-7\-]/g,'');
  if(inp.value!==norm) inp.value=norm;
  if(norm.replace(/-/g,'').length<8){
    stat.className='lic-status';info.style.display='none';
    btn.style.opacity='.4';btn.style.pointerEvents='none';return;
  }
  const parsed=parseLicKey(norm);
  if(!parsed.valid){
    inp.className='lic-key-input err';
    stat.className='lic-status err';stat.innerHTML='❌ '+parsed.reason;
    info.style.display='none';btn.style.opacity='.4';btn.style.pointerEvents='none';return;
  }
  const site=(S.config?.etab||'').trim()||'Non configuré';
  const siteOk=licSiteMatch(parsed);
  if(!siteOk){
    inp.className='lic-key-input err';
    stat.className='lic-status err';
    stat.innerHTML=`❌ Clé délivrée pour un autre établissement.<br><small>Site actuel : <strong>${site}</strong></small>`;
    info.style.display='none';btn.style.opacity='.4';btn.style.pointerEvents='none';return;
  }
  // Infos
  const feats=[];
  if(parsed.features&LIC_FEAT.EXPORT) feats.push('📊 Export');
  if(parsed.features&LIC_FEAT.SYNC)   feats.push('☁️ Sync');
  if(parsed.features&LIC_FEAT.AUDIT)  feats.push('🔍 Audit');
  if(parsed.features&LIC_FEAT.CUSTOM) feats.push('✨ Custom');
  document.getElementById('li-site').textContent=site||'—';
  document.getElementById('li-exp').textContent=parsed.expDisplay+(parsed.expired?' ⚠️ EXPIRÉE':parsed.daysLeft<=30?' ('+parsed.daysLeft+'j)':'');
  document.getElementById('li-seats').textContent=parsed.seats+' poste'+(parsed.seats>1?'s':'');
  document.getElementById('li-feats').textContent=feats.join(' ')||'Saisie seule';
  document.getElementById('li-uid').textContent='#'+parsed.uid;
  info.style.display='block';
  if(parsed.expired){
    inp.className='lic-key-input err';
    stat.className='lic-status warn';
    stat.innerHTML='⚠️ Licence expirée. Mode lecture seule actif. Renouvelez auprès de votre prestataire.';
    btn.style.opacity='.4';btn.style.pointerEvents='none';
  } else {
    inp.className='lic-key-input ok';
    stat.className='lic-status ok';
    stat.innerHTML='✅ Clé valide — expire le '+parsed.expDisplay+(parsed.daysLeft<=30?' (<strong>'+parsed.daysLeft+' jours</strong>)':'');
    btn.style.opacity='1';btn.style.pointerEvents='auto';
  }
}

function saveLicense(){
  const raw=document.getElementById('lic-key-inp').value;
  const parsed=parseLicKey(raw);
  if(!parsed.valid||parsed.expired){toast('❌ Clé invalide ou expirée','warning');return;}
  if(!S.license) S.license={};
  S.license.key=raw.toUpperCase();
  S.license.parsed=parsed;
  save();
  updateLicBadge();
  closeLicModal();
  toast('✅ Licence activée jusqu\'au '+parsed.expDisplay,'success');
  renderNav();renderMain();
}

function deleteLicense(){
  showConfirm('Supprimer la licence','Voulez-vous vraiment supprimer la licence ? L\'application passera en mode lecture seule.','Supprimer',()=>{
    S.license={};save();updateLicBadge();
    renderNav();renderMain();renderSP();
    toast('Licence supprimée — mode lecture seule actif','warning');
  });
}

function licInfoHtml(){
  try{
    const c=JSON.parse(localStorage.getItem('haccp_supa_cfg_v1')||'{}');
    if(c.userToken) return '<div style="background:#f0fdf4;border-radius:10px;padding:8px 12px;font-size:.78rem;font-weight:700;color:#166534">✅ Accès complet — connecté via Supabase</div>';
  }catch(e){}
  return '';
}

function renderMain(){
  const fn=REND[cur];
  const body=fn?fn():`<div class="card"><p style="color:#b89ab6;text-align:center;padding:30px">Section en développement</p></div>`;
  const banner=cur!=='accueil'?roBanner():'';
  document.getElementById('main-content').innerHTML=banner+body;
  if(AR[cur])setTimeout(()=>doAutoCalc(cur),30);
  // Déclencher la recherche dès que la page search est ouverte
  if(cur==='search')setTimeout(()=>{
    // Nettoyer les filtres de date persistants du DOM
    ['sf-hidden','st-hidden'].forEach(id=>{const el=document.getElementById(id);if(el&&el.parentNode)el.parentNode.removeChild(el);});
    // Vider les inputs date visuels
    const sf=document.getElementById('sf');if(sf)sf.value='';
    const st=document.getElementById('st');if(st)st.value='';
    ['dpf-sf-search','dpf-st-search'].forEach(bid=>{const b=document.getElementById(bid);if(b){const sp=b.querySelector('.dp-val');if(sp){sp.textContent=bid.includes('sf')?'Depuis…':'Jusqu’au…';sp.classList.add('empty');}}});
    if(typeof doSearch==='function')doSearch();
  },60);
  // Init pad signature ENR30
  if(cur==='enr30')setTimeout(nc30SigInit,60);
  // Init swipe sur tous les containers concernés
  setTimeout(function(){
    ['nett-plan-body','e33-histo-list','e34-histo-list','e36-histo-list','nuis-histo-list'].forEach(function(id){
      var el=document.getElementById(id);
      if(el) initSwipeRows(el);
    });
  },140);
}

// ════════════════════════════════════════════════════
// SETTINGS
// ════════════════════════════════════════════════════
function openSP(){
  // Reset bouton au cas où il serait resté bloqué
  const _btn = document.querySelector('.sp-close');
  if(_btn){ _btn.disabled=false; _btn.textContent='✓ Enregistrer et fermer'; }
  if(S.adminPin){
    openPinModal({mode:'check', target:'admin', onSuccess:()=>{ renderSP(); document.getElementById('sp').classList.add('open'); }});
  } else {
    renderSP(); document.getElementById('sp').classList.add('open');
  }
}
function toggleNav(){
  const nav=document.getElementById('main-nav');
  const btn=document.getElementById('nav-toggle-btn');
  const collapsed=nav.classList.toggle('nav-collapsed');
  btn.textContent=collapsed?'▸ Fiches':'▾ Fiches';
  S._navCollapsed=collapsed; save();
}
function initNavCollapsed(){
  if(S._navCollapsed){
    document.getElementById('main-nav')?.classList.add('nav-collapsed');
    const btn=document.getElementById('nav-toggle-btn');
    if(btn) btn.textContent='▸ Fiches';
  }
}
async function closeSP(){
  const btn = document.querySelector('.sp-close');
  if(btn){ btn.disabled=true; btn.textContent='⏳ Enregistrement…'; }
  save();
  try {
    // Timeout 4s max — ferme quoi qu'il arrive
    await Promise.race([
      _saveConfigToSupabase(),
      new Promise(r=>setTimeout(r,4000))
    ]);
    if(S['enr19']?.enceintes) syncEnceinteConfig(S['enr19'].enceintes);
  } catch(e) { console.warn('[closeSP]', e); }
  finally {
    if(btn){ btn.disabled=false; btn.textContent='✓ Enregistrer et fermer'; }
    document.getElementById('sp').classList.remove('open');
    renderNav();
    toast('✅ Configuration enregistrée', 'success');
  }
}
function spBg(e){if(e.target===document.getElementById('sp'))closeSP();}
function renderSP(){
  // Licence
  const licEl=document.getElementById('sp-licence');
  if(licEl) licEl.innerHTML=licInfoHtml();
  renderChefList();
  renderNavLayoutUI();
  updateDictCount();
  renderEnceinteConfig();
  renderCustomPageConfig();
  renderSecuritySection();
  initLastBackupDisplay();
  initSpPeriod();
  // Init nav lock button
  setTimeout(()=>{
    const btn=document.getElementById('nav-lock-btn');
    if(btn&&S.navCfg?.locked){btn.textContent='🔒 Réorganisation bloquée';btn.style.background='#dcfce7';btn.style.color='#166534';btn.style.borderColor='#86efac';}
    // Init color picker value
    const pick=document.getElementById('custom-color-pick');
    if(pick&&S.config?.themeColor)pick.value=S.config.themeColor;
    // Init champs nom
    const inpG=document.getElementById('sp-groupe-label');
    const inpN=document.getElementById('sp-nom-label');
    if(inpG)inpG.value=S.config?.headerGroupe||'';
    if(inpN)inpN.value=S.config?.headerNom||'';
    // Preview logo
    const prev=document.getElementById('sp-logo-preview');
    if(prev&&S.config?.headerLogo)prev.innerHTML=`<img src="${S.config.headerLogo}" style="width:32px;height:32px;object-fit:contain">`;
    renderDistribServicesConfig();
    renderPoubelles();
    // Sync toggles son/vibration/darkmode
    const togDark = document.getElementById('tog-dark');
    if(togDark) togDark.checked = S.config?.darkMode || false;
    const togSound = document.getElementById('tog-sound');
    if(togSound) togSound.checked = S.config?.soundOn !== false;
    const togVib = document.getElementById('tog-vibrate');
    if(togVib) togVib.checked = S.config?.vibrateOn !== false;
    const selEtiq = document.getElementById('sel-etiq-fmt');
    if(selEtiq) selEtiq.value = getEtiqA4FmtId();
  },50);
  // Rendre la liste des exports CSV par section
  const expEl=document.getElementById('sp-exports');
  if(expEl){
    const ALL_EXP=[
      {id:'enr01',l:'❄️ Refroidissement'},{id:'enr02',l:'🔥 Remise T°C'},
      {id:'enr03',l:'🔄 Refroid.+Remise'},{id:'enr04',l:'🥩 Steaks hachés'},
      {id:'enr05',l:'🍟 Fritures'},{id:'enr06',l:'🍟 Fritures testeur'},
      {id:'enr07',l:'🥘 Bien Faits cuit'},{id:'enr08',l:'🥗 TM/BF'},
      {id:'enr09',l:'♨️ Cond. chaud'},{id:'enr10',l:'🧊 Cond. froid'},
      {id:'enr19',l:'🌡️ Stockage T°C'},{id:'enr23',l:'📦 Réception'},
      {id:'enr28',l:'🧹 Nettoyage'},{id:'enr30',l:'🚨 Non-conform.'},
    ];
    expEl.innerHTML=ALL_EXP.filter(s=>(S[s.id]?.lignes?.length||0)+(S[s.id]?.saisies?.length||0)>0)
      .map(s=>`<button class="btn btn-sec" style="font-size:.72rem;padding:8px 6px;text-align:left" onclick="expSec('${s.id}');closeSP()">${s.l} <span style="opacity:.6">(${(S[s.id]?.lignes?.length||0)+(S[s.id]?.saisies?.length||0)})</span></button>`)
      .join('')||'<div style="font-size:.75rem;color:#b89ab6;grid-column:1/-1">Aucune donnée à exporter</div>';
  }
  // Restaurer les champs établissement dans le panel
  const cfg=S.config||{};
  const nomEl=document.getElementById('etab-nom');
  const codeEl=document.getElementById('etab-code');
  const moisEl=document.getElementById('etab-mois');
  // Nom et code : depuis Supabase uniquement (champs readonly)
  const _sc=SupaEngine.cfg();
  if(nomEl) nomEl.value=_sc.siteNom||S.config?.etab||'';
  if(codeEl) codeEl.value=_sc.siteId||'';
  if(moisEl)moisEl.value=new Date().toISOString().slice(0,7); // toujours le mois actuel

  const navCfg=S.navCfg||{},hid=navCfg.hidden||{};
  let order=navCfg.order||ALL.map(s=>s.id);
  // Inclure toutes les sections (built-in + custom) non encore dans l'ordre
  ALL.forEach(s=>{if(!order.includes(s.id))order.push(s.id);});
  const mv=order.filter(id=>!ALL.find(s=>s.id===id)?.fixed);
  const fx=order.filter(id=>ALL.find(s=>s.id===id)?.fixed);
  document.getElementById('sp-fixed').innerHTML=fx.map(id=>{
    const s=ALL.find(s=>s.id===id);if(!s)return'';
    return`<div class="sp-row" style="cursor:default"><span class="sp-name">${s.short}</span><span style="font-size:.7rem;color:#b89ab6;margin-left:auto">Fixe</span></div>`;
  }).join('');
  const isLocked=S.navCfg?.locked||false;
  const listEl=document.getElementById('sp-list');
  listEl.innerHTML=mv.map(id=>{
    const s=ALL.find(s=>s.id===id);if(!s)return'';
    return`<div class="sp-row" draggable="${!isLocked}" data-id="${id}">
      <span class="sp-drag-handle" title="Glisser pour réorganiser">⠿</span>
      <label class="tog" onclick="event.stopPropagation()"><input type="checkbox" ${!hid[id]?'checked':''} onchange="tgH('${id}',this.checked)"><span class="tog-sl"></span></label>
      <span class="sp-name" style="flex:1">${s.short}</span>
      <button onclick="event.stopPropagation();quickDuplicatePage('${id}')"
        title="Dupliquer cette page"
        style="background:none;border:1.5px solid var(--brd);border-radius:8px;width:26px;height:26px;font-size:.85rem;cursor:pointer;color:var(--plum);font-weight:900;display:flex;align-items:center;justify-content:center;flex-shrink:0">+</button>
    </div>`;
  }).join('');
  initDragDrop(listEl);
}
function renderDistribServicesConfig(){
  const el = document.getElementById('sp-distrib-services');
  if(!el) return;
  const svcs = getDistribServices();
  if(!svcs.length){ el.innerHTML='<div style="font-size:.75rem;color:#b89ab6;padding:6px 0">Aucun service — ajoutez-en un.</div>'; return; }
  el.innerHTML = svcs.map((svc,i)=>{
    // Compat ascendante : si ancienne structure heure/deadline, migrer
    const mDeb = svc.midi_deb || svc.heure || '';
    const mFin = svc.midi_fin || (svc.deadline ? (typeof svc.deadline==='string'&&svc.deadline.includes(':')?svc.deadline:String(svc.deadline).padStart(2,'0')+':00') : '') || '';
    const sDeb = svc.soir_deb || '';
    const sFin = svc.soir_fin || '';
    const timeBtn = (idx, field, val, lbl) =>
      `<div>
        <div style="font-size:.58rem;font-weight:800;color:#7A6579;margin-bottom:3px;text-transform:uppercase">${lbl}</div>
        <button class="time-btn" onclick="distribOpenTW4(${idx},'${field}','${val||'--:--'}','${lbl}')" style="width:100%;padding:6px">
          <span>⏰</span><span class="tv" style="font-size:.82rem">${val||'—'}</span>
        </button>
      </div>`;
    return `<div style="background:var(--fond);border:1.5px solid var(--brd);border-radius:12px;padding:9px 10px;margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
        <input type="text" value="${escH(svc.ico||'🌡️')}" maxlength="2"
          style="width:32px;text-align:center;border:1.5px solid var(--brd);border-radius:8px;padding:4px;font-size:1rem;font-family:inherit;flex-shrink:0"
          oninput="distribSvcUpdate(${i},'ico',this.value)">
        <input type="text" value="${escH(svc.label)}" placeholder="Nom du service"
          style="flex:1;min-width:0;border:1.5px solid var(--brd);border-radius:8px;padding:6px 8px;font-size:.82rem;font-family:inherit;font-weight:700;color:var(--gris)"
          oninput="distribSvcUpdate(${i},'label',this.value)">
        <button onclick="distribSvcDelete(${i})" style="background:#fee2e2;border:none;border-radius:8px;padding:5px 8px;font-size:.8rem;cursor:pointer;color:#dc2626;flex-shrink:0">🗑</button>
      </div>
      <div style="background:#fff7ed;border-radius:8px;padding:7px 9px;margin-bottom:7px">
        <div style="font-size:.62rem;font-weight:900;color:#d97706;margin-bottom:5px">🌞 SERVICE MIDI</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          ${timeBtn(i,'midi_deb',mDeb,'Début Midi')}
          ${timeBtn(i,'midi_fin',mFin,'Fin Midi')}
        </div>
      </div>
      <div style="background:#f0f0ff;border-radius:8px;padding:7px 9px">
        <div style="font-size:.62rem;font-weight:900;color:#4338ca;margin-bottom:5px">🌙 SERVICE SOIR</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          ${timeBtn(i,'soir_deb',sDeb,'Début Soir')}
          ${timeBtn(i,'soir_fin',sFin,'Fin Soir')}
        </div>
      </div>
    </div>`;
  }).join('');
}

function distribSvcUpdate(i, key, val){
  const svcs = getDistribServices();
  svcs[i][key] = val;
  saveDistribServices(svcs);
}

function distribSvcUpdateDeadline(i, heureVal){
  const h = parseInt(heureVal.split(':')[0]);
  const min = heureVal.split(':')[1]||'00';
  const svcs = getDistribServices();
  svcs[i].deadline = String(Math.min(23, h + 2)).padStart(2,'0')+':'+min;
  saveDistribServices(svcs);
  renderDistribServicesConfig();
}

function distribOpenTW(i, field, currentVal, label){
  // Compat ascendante — délègue à distribOpenTW4
  distribOpenTW4(i, field, currentVal, label);
}

function distribOpenTW4(i, field, currentVal, label){
  const tmpKey = '_distrib_tw_tmp';
  S[tmpKey] = S[tmpKey]||{};
  S[tmpKey].draft = S[tmpKey].draft||{};
  S[tmpKey].draft.val = (currentVal && currentVal !== '--:--') ? currentVal : '12:00';
  openTW('val', tmpKey, label);
  window._twCloseCb = ()=>{
    const v = gd('val', tmpKey);
    if(!v) return;
    const svcs = getDistribServices();
    // Stocker dans le bon champ (midi_deb, midi_fin, soir_deb, soir_fin)
    // Compat ascendante : heure → midi_deb, deadline → midi_fin
    if(field === 'heure')      { svcs[i].midi_deb = v; svcs[i].heure = v; }
    else if(field === 'deadline') { svcs[i].midi_fin = v; svcs[i].deadline = v; }
    else { svcs[i][field] = v; }
    saveDistribServices(svcs);
    renderDistribServicesConfig();
  };
}

// ════════════════════════════════════════════════════
// POUBELLES & RECYCLAGE
// ════════════════════════════════════════════════════
const POUBELLE_JOURS = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
const POUBELLE_TYPES_DEFAULT = [
  {ico:'🗑️', label:'Ordures ménagères'},
  {ico:'♻️', label:'Recyclage'},
  {ico:'🫙', label:'Verre'},
  {ico:'🟫', label:'Carton'},
];

function getPoubelles(){ return S.config?.poubelles||[]; }
function savePoubelles(list){ S.config=S.config||{}; S.config.poubelles=list; save(); _saveConfigToSupabase(); }

function poubelleAdd(){
  showPrompt('Nouveau bac','','Ex: Ordures, Recyclage, Verre…', label=>{
    if(!label) return;
    const list=getPoubelles();
    // Choisir un emoji par défaut selon le label
    const ico = label.toLowerCase().includes('recycl')?'♻️'
              : label.toLowerCase().includes('verre')?'🫙'
              : label.toLowerCase().includes('carton')?'🟫':'🗑️';
    list.push({id:'pb_'+Date.now(), ico, label:label.trim(), jours:[]});
    savePoubelles(list);
    renderPoubelles();
    toast('✅ Bac "'+label+'" ajouté','success');
  },'Ajouter');
}

function poubelleToggleJour(id, jour){
  const list=getPoubelles();
  const p=list.find(x=>x.id===id); if(!p) return;
  p.jours=p.jours||[];
  if(p.jours.includes(jour)) p.jours=p.jours.filter(j=>j!==jour);
  else p.jours.push(jour);
  savePoubelles(list);
  const btn=document.getElementById('pjb-'+id+'-'+jour);
  if(btn) btn.className='fourc-day'+(p.jours.includes(jour)?' on':'');
}

function poubelleDelete(id){
  const list=getPoubelles();
  const p=list.find(x=>x.id===id);
  showConfirm('Supprimer le bac', p?'"'+p.label+'"':'', '🗑 Supprimer', ()=>{
    savePoubelles(list.filter(x=>x.id!==id));
    renderPoubelles();
    toast('Bac supprimé','success');
  });
}

function renderPoubelles(){
  const el=document.getElementById('sp-poubelles'); if(!el) return;
  const list=getPoubelles();
  const addBtn=`<button onclick="poubelleAdd()" style="width:100%;padding:10px;background:var(--fond);border:1.5px dashed var(--plum);border-radius:10px;font-size:.82rem;font-weight:800;color:var(--plum);cursor:pointer;font-family:inherit;margin-top:4px;touch-action:manipulation">+ Ajouter un bac</button>`;
  if(!list.length){
    el.innerHTML=`<div style="font-size:.75rem;color:#b89ab6;padding:4px 0 6px">Aucun bac configuré.</div>${addBtn}`;
    return;
  }
  el.innerHTML=list.map(p=>`
    <div style="background:var(--fond);border:1.5px solid var(--brd);border-radius:12px;padding:9px 10px;margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:1.3rem">${p.ico||'🗑️'}</span>
        <span style="font-size:.88rem;font-weight:900;color:var(--plum);flex:1">${escH(p.label)}</span>
        <button onclick="poubelleDelete('${p.id}')" style="background:#fee2e2;border:none;border-radius:8px;padding:5px 8px;font-size:.8rem;cursor:pointer;color:#dc2626;flex-shrink:0;touch-action:manipulation">🗑</button>
      </div>
      <div style="font-size:.62rem;font-weight:800;color:#7A6579;margin-bottom:4px;text-transform:uppercase">Jours de collecte</div>
      <div class="fourc-days">
        ${POUBELLE_JOURS.map(j=>`<button class="fourc-day${(p.jours||[]).includes(j)?' on':''}" id="pjb-${p.id}-${j}"
          onclick="poubelleToggleJour('${p.id}','${j}')" style="touch-action:manipulation">${j}</button>`).join('')}
      </div>
    </div>`).join('')+addBtn;
}

function poubellesTodayVeille(){
  // Retourne les bacs à sortir CE SOIR (collecte demain)
  const list=getPoubelles();
  const dow=(new Date().getDay()+6)%7; // 0=Lun
  const demainJour=POUBELLE_JOURS[(dow+1)%7];
  return list.filter(p=>(p.jours||[]).includes(demainJour));
}

function poubellesTodayRentrer(){
  // Retourne les bacs à rentrer CE MATIN (collecte aujourd'hui)
  const dow=(new Date().getDay()+6)%7;
  const aujourdhuiJour=POUBELLE_JOURS[dow];
  const list=getPoubelles();
  return list.filter(p=>(p.jours||[]).includes(aujourdhuiJour));
}

function poubellesCheckDone(type){
  // type = 'sortir' | 'rentrer'
  const key='poubelles_'+type+'_'+today();
  return (S.config?.poubellesDone||{})[key]===true;
}

function poubellesSetDone(type){
  S.config=S.config||{};
  S.config.poubellesDone=S.config.poubellesDone||{};
  S.config.poubellesDone['poubelles_'+type+'_'+today()]=true;
  save(); renderMain();
}

function distribSvcDelete(i){
  const svcs = getDistribServices();
  svcs.splice(i,1);
  saveDistribServices(svcs);
  renderDistribServicesConfig();
}

function addDistribService(){
  const svcs = getDistribServices();
  const id = 'svc_' + Date.now();
  svcs.push({id, label:'Nouveau service', ico:'🌡️', midi_deb:'12:00', midi_fin:'13:30', soir_deb:'18:30', soir_fin:'20:00'});
  saveDistribServices(svcs);
  renderDistribServicesConfig();
  toast('✅ Service ajouté — modifiez son nom et ses horaires','success');
}

function applyHeaderName(){
  const groupe=document.getElementById('sp-groupe-label')?.value||'';
  const nom=document.getElementById('sp-nom-label')?.value||'';
  S.config=S.config||{};
  if(groupe) S.config.headerGroupe=groupe;
  if(nom) S.config.headerNom=nom;
  save();
  const elG=document.getElementById('header-groupe');
  const elN=document.getElementById('header-nom');
  if(elG)elG.textContent=groupe||(S.config.headerGroupe||'GROUPE');
  if(elN)elN.textContent=nom||(S.config.headerNom||'Mon Établissement');
}

function applyHeaderLogo(input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    const dataUrl=e.target.result;
    S.config=S.config||{};S.config.headerLogo=dataUrl;save();
    updateHeaderLogo(dataUrl);
    // Preview
    const prev=document.getElementById('sp-logo-preview');
    if(prev)prev.innerHTML=`<img src="${dataUrl}" style="width:32px;height:32px;object-fit:contain">`;
  };
  reader.readAsDataURL(file);
}

function updateHeaderLogo(dataUrl){
  const el=document.getElementById('header-logo-img');
  if(!el)return;
  if(dataUrl){
    el.innerHTML=`<img src="${dataUrl}" style="width:32px;height:32px;object-fit:contain;border-radius:4px">`;
  } else {
    el.innerHTML=`<svg width="32" height="32" viewBox="0 0 40 40" fill="none">
      <ellipse cx="13" cy="17" rx="10" ry="14" transform="rotate(-16 13 17)" fill="#8DC63F"/>
      <ellipse cx="27" cy="17" rx="10" ry="14" transform="rotate(16 27 17)" fill="#E86048"/>
      <ellipse cx="20" cy="19" rx="7" ry="10" fill="#C93A78" opacity=".84"/>
      <ellipse cx="20" cy="29" rx="7.5" ry="4.5" fill="#C93A78" opacity=".45"/>
    </svg>`;
  }
}

function resetHeaderLogo(){
  S.config=S.config||{};delete S.config.headerLogo;save();
  updateHeaderLogo(null);
  const prev=document.getElementById('sp-logo-preview');
  if(prev)prev.innerHTML='';
}

function initHeaderBranding(){
  const cfg=S.config||{};
  const elG=document.getElementById('header-groupe');
  const elN=document.getElementById('header-nom');
  if(elG&&cfg.headerGroupe)elG.textContent=cfg.headerGroupe;
  if(elN&&cfg.headerNom)elN.textContent=cfg.headerNom;
  if(cfg.headerLogo)updateHeaderLogo(cfg.headerLogo);

  // Charger le branding depuis Supabase tenant
  const supaCfg = SupaEngine.cfg();
  if (supaCfg.tenantId && supaCfg.url && supaCfg.anonKey) {
    fetch(`${supaCfg.url}/rest/v1/tenants?id=eq.${supaCfg.tenantId}&select=name,tagline,primary_color,accent_color,logo_url,allowed_enr&limit=1`, {
      headers: { 'apikey': supaCfg.anonKey, 'Authorization': `Bearer ${supaCfg.userToken || supaCfg.anonKey}`, 'Accept': 'application/json' }
    }).then(r => r.json()).then(data => {
      const t = data?.[0];
      if (!t) return;
      // Nom entreprise
      if (t.name && elG) elG.textContent = t.name;
      if (t.tagline && elN) elN.textContent = t.tagline;
      // Logo
      if (t.logo_url) updateHeaderLogo(t.logo_url);
      // Couleur primaire
      if (t.primary_color) applyTheme(t.primary_color);
      // Modules autorisés — filtre les onglets ENR non souscrits
      if (t.allowed_enr) {
        try {
          const arr = Array.isArray(t.allowed_enr) ? t.allowed_enr
            : (typeof t.allowed_enr === 'string' ? JSON.parse(t.allowed_enr) : null);
          if (arr && arr.length) {
            window._tenantAllowedEnr = new Set(arr);
            renderNav();
          }
        } catch(e) {}
      }
    }).catch(() => {});
  }
}

function applyTheme(color){
  const hex2rgb=h=>{const r=parseInt(h.slice(1,3),16),g=parseInt(h.slice(3,5),16),b=parseInt(h.slice(5,7),16);return[r,g,b];};
  const rgb2hex=(r,g,b)=>'#'+[r,g,b].map(x=>Math.min(255,Math.max(0,Math.round(x))).toString(16).padStart(2,'0')).join('');
  const darken=([r,g,b],f)=>rgb2hex(r*f,g*f,b*f);
  const lighten=([r,g,b],f)=>rgb2hex(r+(255-r)*f,g+(255-g)*f,b+(255-b)*f);
  const rgb=hex2rgb(color);
  const root=document.documentElement;
  root.style.setProperty('--plum',color);
  root.style.setProperty('--plum2',darken(rgb,0.85));
  root.style.setProperty('--fond',lighten(rgb,0.97));
  root.style.setProperty('--brd',lighten(rgb,0.85));
  root.style.setProperty('--sh','rgba('+rgb.join(',')+',0.13)');
  const mag=rgb2hex(rgb[0]*1.1+30,rgb[1]*0.55,rgb[2]*1.2);
  root.style.setProperty('--mag',mag);
  S.config=S.config||{};S.config.themeColor=color;save();
  const pick=document.getElementById('custom-color-pick');if(pick)pick.value=color;
  _saveConfigToSupabase();
}
function initTheme(){
  const color=S.config?.themeColor;
  if(color&&color!=='#5C1E5A')applyTheme(color);
  initDarkMode();
}

function toggleDarkMode(on){
  document.body.classList.toggle('dark-mode', on);
  S.config=S.config||{}; S.config.darkMode=on; save();
  // Mettre à jour le meta theme-color
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta) meta.content = on ? '#1a1218' : (S.config.themeColor||'#5C1E5A');
}

function initDarkMode(){
  const on = S.config?.darkMode || false;
  document.body.classList.toggle('dark-mode', on);
  const tog = document.getElementById('tog-dark');
  if(tog) tog.checked = on;
}

// Wrappers son + vibration respectant les préférences
function appVibrate(pattern){
  if(S.config?.vibrateOn===false) return;
  if(navigator.vibrate) navigator.vibrate(pattern);
}

function appBeep(){
  if(S.config?.soundOn===false) return;
  try{
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    const osc=ctx.createOscillator();
    const gain=ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type='sine'; osc.frequency.value=880;
    gain.gain.setValueAtTime(.25,ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.6);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime+.6);
  }catch(e){}
}
function toggleNavLock(){
  S.navCfg=S.navCfg||{};
  S.navCfg.locked=!S.navCfg.locked;
  save();
  if(typeof _saveConfigToSupabase==='function') _saveConfigToSupabase();
  const btn=document.getElementById('nav-lock-btn');
  if(btn){
    const locked=S.navCfg.locked;
    btn.textContent=locked?'🔒 Bloqué':'🔓 Réorg.';
    btn.style.background=locked?'#dcfce7':'var(--fond)';
    btn.style.color=locked?'#166534':'#7B2D78';
    btn.style.borderColor=locked?'#86efac':'var(--brd)';
  }
  renderSP();
  toast(S.navCfg.locked?'🔒 Réorganisation bloquée':'🔓 Réorganisation activée');
}
function tgH(id,v){S.navCfg=S.navCfg||{};S.navCfg.hidden=S.navCfg.hidden||{};S.navCfg.hidden[id]=!v;save();if(typeof _saveConfigToSupabase==='function')_saveConfigToSupabase();}

// ── Drag & Drop natif (touch + mouse) ────────────────────────
let _drag=null,_dragIdx=null;
function initDragDrop(container){
  // Si la réorganisation est verrouillée, ne pas attacher les listeners de drag
  // Cela permet au scroll de fonctionner normalement dans le conteneur
  const isLocked = S.navCfg?.locked;
  // Drag natif HTML5
  container.querySelectorAll('[draggable]').forEach((row,i)=>{
    // Désactiver draggable quand verrouillé (le navigateur gère mieux le scroll)
    if(isLocked) row.setAttribute('draggable','false');
    else row.setAttribute('draggable','true');
    row.addEventListener('dragstart',e=>{
      if(S.navCfg?.locked){ e.preventDefault(); return; }
      _drag=row;_dragIdx=i;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed='move';
    });
    row.addEventListener('dragend',()=>{
      row.classList.remove('dragging');
      container.querySelectorAll('.drag-over').forEach(r=>r.classList.remove('drag-over'));
      _drag=null;
    });
    row.addEventListener('dragover',e=>{
      if(S.navCfg?.locked) return;
      e.preventDefault();
      if(_drag&&_drag!==row){
        container.querySelectorAll('.drag-over').forEach(r=>r.classList.remove('drag-over'));
        row.classList.add('drag-over');
      }
    });
    row.addEventListener('drop',e=>{
      if(S.navCfg?.locked) return;
      e.preventDefault();
      if(!_drag||_drag===row)return;
      row.classList.remove('drag-over');
      // Réordonner dans le DOM
      const rows=[...container.querySelectorAll('[data-id]')];
      const fromIdx=rows.indexOf(_drag);
      const toIdx=rows.indexOf(row);
      if(fromIdx<0||toIdx<0)return;
      if(fromIdx<toIdx)container.insertBefore(_drag,row.nextSibling);
      else container.insertBefore(_drag,row);
      // Sauvegarder le nouvel ordre
      saveDragOrder(container);
    });
    // Touch support — respecte le lock
    row.addEventListener('touchstart',e=>{
      if(S.navCfg?.locked) return; // scroll libre quand verrouillé
      touchDragStart(e,row,container);
    },{passive:true});
    row.addEventListener('touchmove',e=>{
      if(S.navCfg?.locked) return; // pas de preventDefault → scroll natif
      touchDragMove(e,container);
    },{passive:false});
    row.addEventListener('touchend',e=>{
      if(S.navCfg?.locked) return;
      touchDragEnd(e,container);
    });
  });
}
function saveDragOrder(container){
  const fx=(S.navCfg?.order||ALL.map(s=>s.id)).filter(id=>ALL.find(s=>s.id===id)?.fixed);
  const newMv=[...container.querySelectorAll('[data-id]')].map(r=>r.dataset.id);
  S.navCfg=S.navCfg||{};
  S.navCfg.order=[...fx,...newMv];
  save();
  if(typeof _saveConfigToSupabase==='function') _saveConfigToSupabase();
}
// Touch drag
let _tDrag=null,_tClone=null,_tContainer=null;
function touchDragStart(e,row,container){
  _tDrag=row;_tContainer=container;
  row.classList.add('dragging');
}
function touchDragMove(e,container){
  if(!_tDrag)return;
  e.preventDefault();
  const touch=e.touches[0];
  const el=document.elementFromPoint(touch.clientX,touch.clientY);
  const target=el?.closest('[data-id]');
  container.querySelectorAll('.drag-over').forEach(r=>r.classList.remove('drag-over'));
  if(target&&target!==_tDrag)target.classList.add('drag-over');
}
function touchDragEnd(e,container){
  if(!_tDrag)return;
  _tDrag.classList.remove('dragging');
  const over=container.querySelector('.drag-over');
  if(over&&over!==_tDrag){
    over.classList.remove('drag-over');
    const rows=[...container.querySelectorAll('[data-id]')];
    const fi=rows.indexOf(_tDrag),ti=rows.indexOf(over);
    if(fi<ti)container.insertBefore(_tDrag,over.nextSibling);
    else container.insertBefore(_tDrag,over);
    saveDragOrder(container);
  }
  _tDrag=null;
}

// ════════════════════════════════════════════════════
// TEMPERATURE PICKER
// Plage -20..+250, 270 unités
// ════════════════════════════════════════════════════
const TMin=-20,TMax=250,TRange=270;
// Converts temperature to % position on the slider axis
const tPct=t=>`${((t-TMin)/TRange*100).toFixed(2)}%`;

const TP_COLD=[-20,-18,-5,0,3,6,10];
const TP_MIX_FROID=[-5,-2,0,1,2,3,6]; // Mixage froid BF/TM : -5°C à +6°C
const TP_HOT=[0,3,10,60,63,65,75,85,100];
const TP_ALL=[-20,-18,0,3,10,63,65,75,100];

function tpHtml(id,sec,presets,label){
  presets=presets||TP_ALL;
  const stored=gd(id,sec);
  const numV=(stored!==undefined&&stored!==''&&!isNaN(parseFloat(stored)))?parseFloat(stored):null;
  // Plage slider adaptée aux presets (+marge 20%)
  const pMin=Math.min(...presets), pMax=Math.max(...presets);
  const margin=Math.max(5, Math.round((pMax-pMin)*0.2));
  const sMin=Math.max(TMin, pMin-margin);
  const sMax=Math.min(TMax, pMax+margin);
  const sRange=sMax-sMin;
  const slV=numV!==null?Math.max(sMin,Math.min(sMax,numV)):(pMin+pMax)/2;
  const disp=numV!==null?(numV%1===0?numV.toFixed(0):numV.toFixed(1)):'—';
  // Axis labels adaptés à la plage
  const allAxisPts=[[-20,'-20°'],[-18,'-18°'],[0,'0°'],[3,'+3°'],[6,'+6°'],[10,'+10°'],[63,'+63°'],[75,'+75°'],[100,'+100°']];
  const axisPts=allAxisPts.filter(([t])=>t>=sMin&&t<=sMax);
  const tPctLocal=t=>`${((t-sMin)/sRange*100).toFixed(1)}%`;
  const axisH=axisPts.map(([t,l])=>`<span style="left:${tPctLocal(t)}">${l}</span>`).join('');
  const presetsH=presets.map(p=>`<button class="tp-pre${numV===p?' on':''}" onclick="onTP('${id}','${sec}',${p})">${p>=0?'+':''}${p}°C</button>`).join('');
  return`<div class="fg full">
    ${label?`<label>${label}</label>`:''}
    <div class="tp" id="tp-${id}-${sec}">
      <div class="tp-disp" id="td-${id}-${sec}" data-qt="f" data-qi="${id}" data-qs="${sec}" data-qn="${sMin}" data-qx="${sMax}" onclick="qtTap(this)" style="cursor:pointer">${numV===null?'<span style="font-size:.9rem;color:#b89ab6">Tap ou glisser ↓</span>':disp+'<sub>°C</sub>'}</div>
      <div class="tp-wrap">
        <input type="range" class="tp-slider" id="ts-${id}-${sec}"
          min="${sMin}" max="${sMax}" step="0.1" value="${slV}"
          oninput="onTS('${id}','${sec}',this.value)"
          onchange="onTS('${id}','${sec}',this.value)">
        <div class="tp-axis">${axisH}</div>
      </div>
      <div class="tp-manual"><span style="font-size:.74rem;color:#b89ab6;font-weight:700">Tap :</span><div id="tm-${id}-${sec}" class="qt-fake-inp" data-qt="f" data-qi="${id}" data-qs="${sec}" data-qn="${sMin}" data-qx="${sMax}" onclick="qtTap(this)">${numV!==null?(numV%1===0?numV.toFixed(0):numV.toFixed(1)):''}</div><span style="font-size:1rem;font-weight:800;color:var(--gris2)">°C</span></div>
      <div class="tp-presets">${presetsH}</div>
    </div>
  </div>`;
}

function tpSet(id,sec,vn){
  // 1. Store
  sd(id,String(vn),sec);
  // 2. Display
  const disp=document.getElementById(`td-${id}-${sec}`);
  if(disp)disp.innerHTML=`${vn%1===0?vn.toFixed(0):vn.toFixed(1)}<sub>°C</sub>`;
  // 3. Slider (direct by id)
  const sl=document.getElementById(`ts-${id}-${sec}`);
  if(sl)sl.value=Math.max(TMin,Math.min(TMax,vn));
  // 4. Fake-input div
  const mi=document.getElementById(`tm-${id}-${sec}`);
  if(mi) mi.textContent=vn%1===0?vn.toFixed(0):vn.toFixed(1);
  // 5. Presets
  const tp=document.getElementById(`tp-${id}-${sec}`);
  if(tp)tp.querySelectorAll('.tp-pre').forEach(b=>{
    const pv=parseFloat(b.textContent);
    b.classList.toggle('on',pv===vn);
  });
  // 6. Auto-calc
  doAutoCalc(sec);
}
function onTS(id,sec,val){tpSet(id,sec,parseFloat(val));}
function onTM(id,sec,val){const v=parseFloat(val);if(!isNaN(v))tpSet(id,sec,v);}
function onTP(id,sec,vn){tpSet(id,sec,vn);}

// ════════════════════════════════════════════════════
// TIME WHEEL
// ════════════════════════════════════════════════════
const IH=70;
let TW={fid:null,sec:null,h:0,m:0};
let TDS={h:{drag:false,sY:0,sV:0},m:{drag:false,sY:0,sV:0}};

const buildWL=(n,pad)=>Array.from({length:n*5},(_,i)=>
  `<div class="tw-item" data-v="${i%n}">${String(i%n).padStart(pad,'0')}</div>`).join('');

function twPos(val,tot){return -(2*tot+val)*IH+IH;}
function setWheel(col,val,fromInput){
  const tot=col==='h'?24:60;
  val=((val%tot)+tot)%tot;
  const list=document.getElementById(`twl-${col}`);
  if(!list)return;
  list.style.transition='transform .26s cubic-bezier(.25,.46,.45,.94)';
  list.style.transform=`translateY(${twPos(val,tot)}px)`;
  TW[col]=val;
  updWH(col,val,tot);
  // Sync champ de saisie directe (sauf si l'appel vient du champ lui-même)
  if(!fromInput){
    const inp=document.getElementById(`tw-inp-${col}`);
    if(inp) inp.value=String(val).padStart(2,'0');
  }
}
function updWH(col,val,tot){
  if(!tot)tot=col==='h'?24:60;
  document.getElementById(`twl-${col}`)?.querySelectorAll('.tw-item').forEach(el=>{
    const iv=parseInt(el.dataset.v);
    const d=Math.min(Math.abs(iv-val),tot-Math.abs(iv-val));
    el.classList.toggle('sel',d===0);el.classList.toggle('near',d===1);
  });
}

// Saisie directe dans les champs HH/MM
function twDirectInput(col,inp){
  const tot=col==='h'?24:60;
  const raw=inp.value.replace(/\D/g,'');
  inp.value=raw; // ne garder que les chiffres
  const v=parseInt(raw);
  if(raw.length===0) return; // en cours de saisie
  if(!isNaN(v) && v>=0 && v<tot){
    inp.classList.add('flash');
    setTimeout(()=>inp.classList.remove('flash'),300);
    setWheel(col,v,true); // true = vient du champ, ne pas re-setter l'input
    // Auto-focus sur le champ minutes si 2 chiffres valides saisis pour les heures
    if(col==='h' && raw.length>=2){
      setTimeout(()=>{const m=document.getElementById('tw-inp-m');if(m){m.focus();m.select();}},120);
    }
  }
}
function twDirectBlur(col,inp){
  const tot=col==='h'?24:60;
  let v=parseInt(inp.value);
  if(isNaN(v)||v<0) v=0;
  if(v>=tot) v=tot-1;
  inp.value=String(v).padStart(2,'0');
  setWheel(col,v,true);
}
function openTW(fid,sec,label){
  TW.fid=fid;TW.sec=sec;
  document.getElementById('tw-lbl').textContent=label||'Heure';
  const stored=gd(fid,sec)||'';
  let h=new Date().getHours(),m=new Date().getMinutes();
  if(stored.includes(':')){const p=stored.split(':');h=parseInt(p[0]);m=parseInt(p[1]);}
  document.getElementById('twl-h').innerHTML=buildWL(24,2);
  document.getElementById('twl-m').innerHTML=buildWL(60,2);
  ['h','m'].forEach(col=>{
    const el=document.getElementById(`twc-${col}`);
    const newEl=el.cloneNode(true);el.parentNode.replaceChild(newEl,el);
    newEl.addEventListener('mousedown',e=>{e.preventDefault();twSD(e,col);});
    // touchstart DOIT être passive:false pour pouvoir appeler preventDefault sur touchmove
    newEl.addEventListener('touchstart',e=>{e.stopPropagation();twSD(e,col);},{passive:false});
    newEl.addEventListener('mousemove',e=>twSM(e,col));
    newEl.addEventListener('touchmove',e=>{e.preventDefault();e.stopPropagation();twSM(e,col);},{passive:false});
    newEl.addEventListener('mouseup',()=>twSE(col));
    newEl.addEventListener('touchend',e=>{e.stopPropagation();twSE(col);});
    newEl.addEventListener('wheel',e=>{e.preventDefault();const tot=col==='h'?24:60;setWheel(col,((TW[col]+(e.deltaY>0?1:-1))%tot+tot)%tot);},{passive:false});
  });
  const twOv = document.getElementById('tw-ov');
  // Bloquer tout scroll de la page quand le TW est ouvert
  twOv._blockScroll = e => { e.preventDefault(); e.stopPropagation(); };
  twOv.addEventListener('touchmove', twOv._blockScroll, {passive:false});
  twOv.classList.add('open');
  setTimeout(()=>{
    setWheel('h',h);setWheel('m',m);
    // Init direct inputs
    const ih=document.getElementById('tw-inp-h');
    const im=document.getElementById('tw-inp-m');
    if(ih) ih.value=String(h).padStart(2,'0');
    if(im) im.value=String(m).padStart(2,'0');
  },40);
}
function twBg(e){if(e.target===document.getElementById('tw-ov'))twClose();}
function twClose(){
  const twOv = document.getElementById('tw-ov');
  if(twOv._blockScroll){ twOv.removeEventListener('touchmove', twOv._blockScroll); twOv._blockScroll=null; }
  twOv.classList.remove('open');
}
function twConfirm(){
  const val=`${String(TW.h).padStart(2,'0')}:${String(TW.m).padStart(2,'0')}`;
  sd(TW.fid,val,TW.sec);
  const btn=document.querySelector(`[data-tw="${TW.fid}-${TW.sec}"]`);
  if(btn)btn.innerHTML=`<span>⏰</span><span class="tv">${val}</span>`;
  twClose();
  // Déclencher le callback custom si défini (pour ENR33/ENR36 etc.)
  if(window._twCloseCb){ const cb=window._twCloseCb; window._twCloseCb=null; cb(); }
  else doAutoCalc(TW.sec);
}
function twSD(e,col){TDS[col]={drag:true,sY:e.touches?e.touches[0].clientY:e.clientY,sV:TW[col]};}
function twSM(e,col){
  if(!TDS[col].drag)return;
  const y=e.touches?e.touches[0].clientY:e.clientY;
  const delta=Math.round((TDS[col].sY-y)/IH);
  const tot=col==='h'?24:60;
  const nv=((TDS[col].sV+delta)%tot+tot)%tot;
  const list=document.getElementById(`twl-${col}`);
  if(list){list.style.transition='none';list.style.transform=`translateY(${twPos(nv,tot)}px)`;}
  TW[col]=nv;updWH(col,nv,tot);
}
function twSE(col){TDS[col].drag=false;setWheel(col,TW[col]);}

function timeBtnHtml(id,sec,label,autoTime){
  let val=gd(id,sec);
  // Si autoTime et pas encore en draft → pré-sauvegarder l'heure courante
  if(!val && autoTime){
    val=nowT();
    if(sec){S[sec]=S[sec]||{};S[sec].draft=S[sec].draft||{};S[sec].draft[id]=val;}
  }
  const inner=val
    ?`<span>⏰</span><span class="tv">${val}</span>`
    :`<span>⏰</span><span class="tp2">Appuyer pour saisir</span>`;
  return`<div class="fg"><label>${label}</label>
    <button type="button" class="time-btn" data-tw="${id}-${sec}" onclick="openTW('${id}','${sec}','${label}')">${inner}</button>
  </div>`;
}

// ════════════════════════════════════════════════════
// AUTO-CALC HACCP
// ════════════════════════════════════════════════════
const tdiff=(t1,t2,maxH)=>{
  if(!t1||!t2)return null;
  const[h1,m1]=t1.split(':').map(Number);
  const[h2,m2]=t2.split(':').map(Number);
  let d=(h2*60+m2)-(h1*60+m1);
  if(d<0)d+=1440;
  // Si un max est précisé (en heures) et dépassé → saisie incohérente, retourner null
  if(maxH&&d>maxH*60)return null;
  return d;
};
const fmtD=m=>{
  if(m===null||m===undefined)return'—';
  const h=Math.floor(m/60),mn=m%60;
  return h===0?`${mn}min`:mn===0?`${h}h`:`${h}h${String(mn).padStart(2,'0')}`;
};
const gtv=(fid,sec)=>{const x=(S[sec]||{}).draft?.[fid];return(x!==undefined&&x!==''&&!isNaN(parseFloat(x)))?parseFloat(x):null;};
const gts=(fid,sec)=>(S[sec]||{}).draft?.[fid]||'';
const cv=(ok,has)=>has?(ok?'OUI':'NON'):null;

const AR={
  enr01:sec=>{
    const d=(S[sec]||{}).draft||{};
    const isPre=d.pre_ref==='OUI';
    const durPre=isPre?tdiff(d.h_pref_deb,d.h_pref_fin):null;
    const dur=tdiff(d.h_ref_deb,d.h_ref_fin);
    const tf=gtv('t_ref_fin',sec);
    const r={duree:fmtD(dur),conforme:cv(dur!==null&&dur<=120&&tf!==null&&tf<=10,dur!==null&&tf!==null)};
    if(isPre)r.duree_pre=fmtD(durPre);
    return r;
  },
  enr02:sec=>{const d=(S[sec]||{}).draft||{},dur=tdiff(d.h_deb,d.h_fin),td=gtv('t_deb',sec),tf=gtv('t_fin',sec);return{duree:fmtD(dur),conf_deb:cv(td!==null&&td<=10,td!==null),conforme:cv(dur!==null&&dur<=60&&tf!==null&&tf>=63&&td!==null&&td<=10,dur!==null&&tf!==null&&td!==null)};},
  enr03:sec=>{const d=(S[sec]||{}).draft||{},dR=tdiff(d.h1,d.h2),t2=gtv('t2',sec),dRT=tdiff(d.h3,d.h4),t3=gtv('t3',sec),t4=gtv('t4',sec);return{duree_r:fmtD(dR),conf_r:cv(dR!==null&&dR<=120&&t2!==null&&t2<=10,dR!==null&&t2!==null),duree_rt:fmtD(dRT),conf_t3:cv(t3!==null&&t3<=10,t3!==null),conf_rt:cv(dRT!==null&&dRT<=60&&t4!==null&&t4>=63&&t3!==null&&t3<=10,dRT!==null&&t4!==null&&t3!==null)};},
  enr04:sec=>{const t=gtv('tc',sec);return{conforme:cv(t!==null&&t>=65,t!==null)};},
  enr07:sec=>{
    const d=(S[sec]||{}).draft||{};
    const mode=d.mode_mixage||'froid';
    const dur=tdiff(d.h_deb,d.h_fin,1); // max 1h — si > c'est une erreur de saisie
    const tc=gtv('t_cuisson',sec);
    if(mode==='chaud'){
      const tm_deb=gtv('t_mix_deb',sec), tm_fin=gtv('t_mix_fin',sec);
      return{
        duree:fmtD(dur),
        conf_duree:cv(dur!==null&&dur<=10,dur!==null),
        conf_mix_deb:cv(tm_deb!==null&&tm_deb>=63,tm_deb!==null),
        conf_mix_fin:cv(tm_fin!==null&&tm_fin>=63,tm_fin!==null),
        conf_cuisson:cv(tc!==null&&tc>=75,tc!==null)
      };
    } else {
      const td=gtv('t_deb',sec);
      return{
        duree:fmtD(dur),
        conf_deb:cv(td!==null&&td<=3,td!==null),
        conf_duree:cv(dur!==null&&dur<=10,dur!==null),
        conf_cuisson:cv(tc!==null&&tc>=75,tc!==null)
      };
    }
  },
  enr08:sec=>{const d=(S[sec]||{}).draft||{},dur=tdiff(d.h1,d.h2,1),t1=gtv('t1',sec),t2=gtv('t2',sec);return{duree:fmtD(dur),conf1:cv(t1!==null&&t1<=3,t1!==null),conf_duree:cv(dur!==null&&dur<=10,dur!==null),conf2:cv(t2!==null&&t2<=6,t2!==null)};},
  enr09:sec=>{const td=gtv('t_debut',sec),tf=gtv('t_fin',sec);return{conf_debut:cv(td!==null&&td>=63,td!==null),conf_fin:cv(tf!==null&&tf>=63,tf!==null)};},
  enr10:sec=>{const d=(S[sec]||{}).draft||{},td=gtv('t_debut',sec),tf=gtv('t_fin',sec),dur=tdiff(d.h_ref_deb,d.h_ref_fin);return{conf_debut:cv(td!==null&&td<=3,td!==null),conf_couple:cv(dur!==null&&dur<=120,dur!==null),conf_fin:cv(tf!==null&&tf<=6,tf!==null)};},
  enr11:sec=>{const d=(S[sec]||{}).draft||{},t1=gtv('t_premier',sec),dur=tdiff(d.h_ref_deb,d.h_ref_fin);return{conf_premier:cv(t1!==null&&t1<=3,t1!==null),conf_couple:cv(dur!==null&&dur<=120,dur!==null)};},
  enr12:sec=>{const t1=gtv('t_premier',sec),td=gtv('t_ref_deb',sec);return{conf_premier:cv(t1!==null&&t1>=63,t1!==null),conf_couple:cv(td!==null&&td>=63,td!==null)};},
  enr13:sec=>{const t=gtv('tc',sec),tp=gts('type',sec);if(t===null||!tp)return{};return{conforme:cv(tp==='Froid'?t<=10:t>=63,true)};},
  enr14:sec=>{const tp=gtv('t_prem',sec),td=gtv('t_dern',sec),type=gts('type',sec);if(!type)return{};const r={};if(tp!==null)r.conf_prem=cv(type==='Froid'?tp<=10:tp>=63,true);if(td!==null)r.conf_dern=cv(type==='Froid'?td<=10:td>=63,true);return r;},
  enr15:sec=>{const td=gtv('t_deb',sec),tf=gtv('t_fin',sec),type=gts('type',sec);if(!type)return{};const r={};if(td!==null)r.conf_deb=cv(type==='Froid'?td<=3:td>=63,true);if(tf!==null)r.conf_fin=cv(type==='Froid'?tf<=3:tf>=63,true);return r;},
  enr16:sec=>{const td=gtv('t_deb',sec),tf=gtv('t_fin',sec),type=gts('type',sec);if(!type)return{};const r={};if(td!==null)r.conf_deb=cv(type==='Froid'?td<=10:td>=63,true);if(tf!==null)r.conf_fin=cv(type==='Froid'?tf<=10:tf>=63,true);return r;},
  enr17:sec=>{const t=gtv('tc',sec);return{conforme:cv(t!==null&&t<=6,t!==null)};},
  enr18:sec=>{const t=gtv('tc',sec),tp=gts('type',sec);if(t===null||!tp)return{};return{conforme:cv(tp==='Froid'?t<=6:t>=63,true)};},
  enr23:sec=>{
    const d=(S[sec]||{}).draft||{};
    const visuelOk=d.vehicule==='OUI'&&d.emballage==='OUI'&&d.etiquetage==='OUI'&&d.qualite==='OUI';
    const visuelHas=!!(d.vehicule&&d.emballage&&d.etiquetage&&d.qualite);
    // Vérification T°C produits (seuil ≤+4°C pour produits frais par défaut)
    const tc1=d.p1_tc!==undefined&&d.p1_tc!==''?parseFloat(d.p1_tc):null;
    const tc2=d.p2_tc!==undefined&&d.p2_tc!==''?parseFloat(d.p2_tc):null;
    const tcOk=(tc1===null||tc1<=4)&&(tc2===null||tc2<=4);
    const allOk=visuelOk&&tcOk;
    return{conforme:cv(allOk,visuelHas)};
  },
  enr26:sec=>{const e=gtv('ecart',sec);return{conf:cv(e!==null&&Math.abs(e)<=1,e!==null)};},
  enr27:sec=>{const te=gtv('t_ext',sec),ti=gtv('t_int',sec);if(te===null||ti===null)return{};const e=Math.abs(te-ti).toFixed(1);return{ecart:e,conf:cv(parseFloat(e)<=1,true)};},
  enr39:sec=>{const tg=gtv('t_glac',sec),tp=gtv('t_prod',sec);return{conf_glac:cv(tg!==null&&tg<=6,tg!==null),conf_prod:cv(tp!==null&&tp<=6,tp!==null)};},
  enr52:sec=>{const t=gtv('tc',sec);return{conforme:cv(t!==null&&(t<=3||t>=63),t!==null)};},
  enr53:sec=>{const tf=gtv('t_f',sec),tc=gtv('t_c',sec);return{conf_f:cv(tf!==null&&tf<=3,tf!==null),conf_c:cv(tc!==null&&tc>=63,tc!==null)};},
};

const CONF_FIDS=['conforme','conf_r','conf_rt','conf_deb','conf_fin','conf_debut','conf_pre','conf_t3',
  'conf_duree','conf_cuisson','conf_mix_deb','conf_mix_fin',
  'conf1','conf2','conf_premier','conf_couple',
  'conf_prem','conf_dern','conf_glac','conf_prod','conf_f','conf_c','conf',
  'vehicule','emballage','etiquetage','qualite','remise','filtre','change','conf_test'];

function doAutoCalc(sec){
  const rules=AR[sec];if(!rules)return;
  let hadNC=false;
  try{
    const updates=rules(sec);
    Object.entries(updates||{}).forEach(([fid,val])=>{
      if(val===null||val===undefined)return;
      // 1. Persister en draft (valeurs non-null uniquement, pas les placeholders)
      S[sec]=S[sec]||{};S[sec].draft=S[sec].draft||{};
      if(val!=='—') S[sec].draft[fid]=String(val);
      // 2. Computed div (durées) — toujours mettre à jour l'affichage
      const cd=document.querySelector(`[data-cd="${fid}"]`);
      if(cd)cd.textContent=String(val);
      // 3. Conf OUI/NON — boutons + badge
      if(val==='OUI'||val==='NON'){
        const cg=document.querySelector(`[data-cg="${fid}"]`);
        if(cg){
          cg.querySelectorAll('[data-cv]').forEach(b=>b.classList.toggle('on',b.dataset.cv===val));
          const badge=cg.nextElementSibling;
          if(badge?.classList.contains('auto-badge')){
            badge.style.display='';
            if(val==='OUI'){badge.className='auto-badge';badge.innerHTML='✓ Auto-validé HACCP';}
            else{badge.className='auto-badge nc';badge.innerHTML='⚠️ Non-conforme – agir !';
              if(!hadNC){hadNC=true;setTimeout(()=>toast('⚠️ Non-conforme détecté !','warning'),80);}}
          }
        }
      }
    });
  }catch(e){console.warn('AutoCalc',e);}
}

// ════════════════════════════════════════════════════
// FORM ENGINE
// ════════════════════════════════════════════════════
const dflt=f=>{if(f.autoDate)return today();if(f.autoTime)return nowT();if(f.autoDT)return nowDT();return f.default||'';};
const fVal=(id,sec)=>{const v=gd(id,sec);return v!==undefined?v:dflt((FDEFS[sec]?.fields||[]).find(f=>f.id===id)||{});};

function rf(f,sec){
  if(f.type==='temp')return tpHtml(f.id,sec,f.presets,f.label);
  if(f.type==='time')return timeBtnHtml(f.id,sec,f.label,f.autoTime);
  if(f.type==='conf')return cfEl(f,sec);
  if(f.type==='select')return selEl(f,sec);
  if(f.type==='textarea')return taEl(f,sec);
  if(f.type==='prod')return acHtml(f.id,sec,f.label,f.ph);
  if(f.type==='chef')return chefSel(f.id,sec,f.label);
  if(f.type==='photo')return cpPhotoEl(f.id,sec,f.label);
  if(f.computed)return compEl(f,sec);
  return inpEl(f,sec);
}

// ── Photo widget pour pages custom ────────────────────────
function cpPhotoEl(fid, sec, label){
  const stored = gd(fid, sec)||'';
  let thumb='', fname='', hasPhoto=false;
  if(stored){
    try{ const obj=JSON.parse(stored); thumb=obj.thumb||''; fname=obj.file||''; hasPhoto=!!thumb; }catch{ hasPhoto=false; }
  }
  const inputId = 'cp-photo-inp-'+fid+'-'+sec;
  return `<div class="fg full">
    <label>${label||'Photo'}</label>
    ${hasPhoto
      ? `<div style="display:flex;align-items:center;gap:10px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;padding:10px">
          <img src="${thumb}" style="width:72px;height:54px;object-fit:cover;border-radius:8px;cursor:pointer" onclick="cpPhotoLightbox('${fid}','${sec}')" alt="Photo">
          <div style="flex:1;min-width:0">
            <div style="font-size:.72rem;font-weight:800;color:#166534">📷 Photo enregistrée</div>
            ${fname?`<div style="font-size:.62rem;color:#4b5563;word-break:break-all">${fname}</div>`:''}
          </div>
          <button onclick="cpPhotoDelete('${fid}','${sec}')" style="background:#fee2e2;border:none;border-radius:8px;padding:5px 8px;color:#dc2626;cursor:pointer;font-size:.75rem">🗑</button>
        </div>`
      : `<label for="${inputId}" style="display:flex;align-items:center;gap:10px;background:#f7f2f7;border:2px dashed var(--plum);border-radius:12px;padding:12px;cursor:pointer">
          <span style="font-size:1.8rem">📷</span>
          <div>
            <div style="font-size:.82rem;font-weight:800;color:var(--plum)">Prendre une photo</div>
            <div style="font-size:.68rem;color:var(--gris2)">Compressée et datée automatiquement</div>
          </div>
        </label>`
    }
    <input type="file" accept="image/*" capture="environment" id="${inputId}" style="display:none"
      onchange="cpPhotoCapture(this,'${fid}','${sec}')">
  </div>`;
}

function cpPhotoCapture(inp, fid, sec){
  const file = inp.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      // Compression : max 1200px, 0.78 qualité
      const c = document.createElement('canvas');
      const maxW=1200, maxH=900;
      let w=img.width, h=img.height;
      if(w>maxW){h=Math.round(h*maxW/w);w=maxW;}
      if(h>maxH){w=Math.round(w*maxH/h);h=maxH;}
      c.width=w; c.height=h;
      c.getContext('2d').drawImage(img,0,0,w,h);
      const full = c.toDataURL('image/jpeg',0.78);
      // Miniature
      const ct=document.createElement('canvas'); const maxT=200;
      let tw=img.width,th=img.height;
      if(tw>maxT){th=Math.round(th*maxT/tw);tw=maxT;}
      ct.width=tw;ct.height=th;ct.getContext('2d').drawImage(img,0,0,tw,th);
      const thumb=ct.toDataURL('image/jpeg',0.55);
      // Nom de fichier
      const d=today(); const df=d.slice(8,10)+'-'+d.slice(5,7)+'-'+d.slice(0,4);
      const secClean=(sec||'page').replace(/[^a-z0-9]/gi,'_').slice(0,12);
      const fname='HACCP_Photo_'+df+'_'+secClean+'_'+fid+'.jpg';
      // Télécharger immédiatement sur l'appareil
      const a=document.createElement('a'); a.href=full; a.download=fname;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      // Stocker la miniature
      const ref=JSON.stringify({thumb,file:fname,date:d});
      sd(fid,ref,sec);
      save(); renderMain();
      toast('📷 Photo enregistrée sur l\'appareil ✓','success');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function cpPhotoDelete(fid, sec){
  sd(fid,'',sec); save(); renderMain();
  toast('🗑️ Photo supprimée','success');
}

function cpPhotoLightbox(fid, sec){
  const stored=gd(fid,sec)||'';
  if(!stored) return;
  try{
    const obj=JSON.parse(stored);
    if(!obj.thumb) return;
    const ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:9999;display:flex;align-items:center;justify-content:center';
    ov.onclick=()=>ov.remove();
    ov.innerHTML=`<img src="${obj.thumb}" style="max-width:95vw;max-height:90vh;border-radius:10px;object-fit:contain">`;
    document.body.appendChild(ov);
  }catch{}
}
function inpEl(f,sec){
  // Date → date picker custom avec data-attributes (évite les quotes imbriquées)
  if(f.inputType==='date'){
    const val=fVal(f.id,sec)||'';
    const df=val?new Date(val+'T12:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short',year:'numeric'}):'';
    // Sauvegarder autoDate dans draft si pas encore présent
    if(!fVal(f.id,sec) && f.autoDate && sec){
      S[sec]=S[sec]||{};S[sec].draft=S[sec].draft||{};S[sec].draft[f.id]=today();
    }
    return`<div class="fg ${f.full?'full':''}"><label>${f.label}</label>
      <button class="dp-trigger" id="dpf-${f.id}-${sec}"
        data-fid="${f.id}" data-sec="${sec}"
        onclick="dpOpenForField(this,{})">
        <span class="dp-ico">📅</span>
        <span class="dp-val${!val?' empty':''}">${df||'Sélectionner une date'}</span>
        <span style="font-size:.7rem;color:#c0a0c0">▼</span>
      </button></div>`;
  }
  const isTxt=!f.inputType||f.inputType==='text';
  const inp=`<input class="fi" type="${f.inputType||'text'}" id="inp-${f.id}-${sec}" value="${escH(fVal(f.id,sec))}" placeholder="${escH(f.ph||'')}"
    oninput="sd('${f.id}',this.value,'${sec}');doAutoCalc('${sec}')">`;
  if(isTxt){
    return`<div class="fg ${f.full?'full':''}"><label>${f.label}</label>
      <div class="mic-wrap">${inp}<button type="button" class="mic-btn" title="Dicter" onclick="startMic('inp-${f.id}-${sec}','${f.id}','${sec}')">🎤</button></div></div>`;
  }
  return`<div class="fg ${f.full?'full':''}"><label>${f.label}</label>${inp}</div>`;
}
function compEl(f,sec){
  return`<div class="fg computed"><label>🔄 ${f.label}</label><div class="fi-auto" data-cd="${f.id}">${gd(f.id,sec)||'—'}</div></div>`;
}
function selEl(f,sec){
  const val=fVal(f.id,sec);
  return`<div class="fg ${f.full?'full':''}"><label>${f.label}</label>
    <select class="fi" onchange="sd('${f.id}',this.value,'${sec}');doAutoCalc('${sec}')">
      <option value="">— Choisir —</option>
      ${f.opts.map(o=>`<option ${val===o?'selected':''}>${o}</option>`).join('')}
    </select></div>`;
}
// Raisons NC prédéfinies selon type de champ
const NC_RAISONS_TEMP = ['Température insuffisante','Température trop élevée','Panne matériel','Rupture chaîne du froid','Sonde défectueuse','Autre'];
const NC_RAISONS_DUREE = ['Durée dépassée','Durée trop courte','Retard logistique','Urgence / Imprévu','Autre'];
const NC_RAISONS_GEN = ['Température non conforme','Durée non conforme','Panne équipement','Rupture chaîne du froid','Erreur humaine','Autre'];
const NC_TYPE_OPTIONS = [
  { key:'temperature', label:'🌡️ Température' },
  { key:'hygiene', label:'🧼 Hygiène' },
  { key:'storage', label:'📦 Stockage' },
  { key:'autre', label:'📝 Autre' },
];
const NC_TYPE_LABELS = NC_TYPE_OPTIONS.reduce((a,t)=>{a[t.key]=t.label;return a;},{});
const HACCP_DEFAULT_CORRECTIVE_ACTIONS = [
  // Température
  { id:'fallback-temp-remise', name:'Remise en température immédiate', description:'Rétablir la température réglementaire sans délai.', category:'temperature', is_default:true },
  { id:'fallback-temp-destruction', name:'Destruction du produit', description:'Retirer et détruire le produit non conforme.', category:'temperature', is_default:true },
  { id:'fallback-temp-materiel', name:'Contrôle du matériel', description:'Contrôler sonde, enceinte ou équipement concerné.', category:'temperature', is_default:true },
  { id:'fallback-temp-lot', name:'Isolement du lot', description:'Identifier et isoler le lot impacté.', category:'temperature', is_default:true },
  // Hygiène
  { id:'fallback-hyg-nettoyage', name:'Nettoyage et désinfection immédiate', description:'Réaliser immédiatement le nettoyage et la désinfection.', category:'hygiene', is_default:true },
  { id:'fallback-hyg-plan', name:'Renforcement du plan de nettoyage', description:'Renforcer fréquence et points de contrôle du plan de nettoyage.', category:'hygiene', is_default:true },
  { id:'fallback-hyg-controle', name:'Contrôle visuel par responsable', description:'Faire valider visuellement la conformité par un responsable.', category:'hygiene', is_default:true },
  // Stockage
  { id:'fallback-sto-reorg', name:'Réorganisation des denrées', description:'Réorganiser les denrées pour éviter contamination/croisement.', category:'storage', is_default:true },
  { id:'fallback-sto-dlc', name:'Vérification DLC/DDM', description:'Contrôler les DLC/DDM des denrées concernées.', category:'storage', is_default:true },
  { id:'fallback-sto-quar', name:'Mise en quarantaine', description:'Mettre en quarantaine les produits en attente de décision.', category:'storage', is_default:true },
];
let _ncActionsCatalogLoading = false;
let _ncActionsCatalogLoadedAt = 0;
let _ncKnowledge = { problems: [], recommendations: [], updated_at: null };
let _tabletAlertsPollBusy = false;
// Persister les alertes déjà vues dans localStorage pour éviter de re-afficher après rechargement
const _ALERTS_SEEN_KEY = 'haccpro_alerts_seen_v1';
function _loadSeenAlerts(){
  try{const raw=localStorage.getItem(_ALERTS_SEEN_KEY);return new Set(raw?JSON.parse(raw):[]);}catch{return new Set();}
}
function _saveSeenAlert(id){
  try{
    const s=_loadSeenAlerts();s.add(id);
    // Garder max 200 IDs (FIFO)
    const arr=[...s].slice(-200);
    localStorage.setItem(_ALERTS_SEEN_KEY,JSON.stringify(arr));
  }catch{}
}
let _tabletAlertsLastShown = _loadSeenAlerts();

function normalizeNCType(v){
  const t=String(v||'').trim().toLowerCase();
  if(t==='temperature'||t==='hygiene'||t==='storage'||t==='autre') return t;
  return 'autre';
}
function inferNCTypeFromValues(source, desc, lieu, extra){
  const txt = [source,desc,lieu,extra?.action,extra?.mesure,extra?.commentaire]
    .map(v=>String(v||'').toLowerCase()).join(' ');
  if(/temp|°c|froid|chaud|frigo|enceinte|remise en temp|chaine du froid|cha[iî]ne du froid|sonde|cuisson/.test(txt)) return 'temperature';
  if(/hygi|nettoyage|d[ée]sinfection|nuisible|parasite|lavage|propret|contamination/.test(txt)) return 'hygiene';
  if(/stock|stockage|dlc|ddm|quarantaine|lot|r[ée]organisation|rangement|r[ée]ception/.test(txt)) return 'storage';
  return 'autre';
}
function sanitizeLegacyCorrectiveAction(action, desc){
  const a = String(action||'').trim();
  if(!a) return '';
  const normAction = _normalizeTextForMatch(a);
  const normDesc = _normalizeTextForMatch(desc||'');
  if(!normDesc) return a;
  if(normAction===normDesc) return '';
  if(normAction.includes(normDesc)) return '';
  return a;
}
async function hubApiCuisine(method, query='', body=null){
  const cfg = SupaEngine.cfg();
  const token = cfg.userToken || '';
  if(!token) throw new Error('Session manquante');
  const q = query ? `?${query}` : '';
  const opts = {
    method,
    headers: {
      'Content-Type':'application/json',
      'Authorization':`Bearer ${token}`
    }
  };
  if(body && method!=='GET' && method!=='DELETE') opts.body = JSON.stringify(body);
  const r = await fetch(`/.netlify/functions/haccp-hub${q}`, opts);
  const t = await r.text().catch(()=> '');
  let data = null;
  try{ data = t ? JSON.parse(t) : null; } catch(_e){ data = null; }
  if(!r.ok){
    throw new Error((data&&data.error)||t||('HTTP '+r.status));
  }
  return data || {};
}
function _normalizeTextForMatch(v){
  return String(v||'')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9\s]/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}
function _problemMatchScore(reference,current){
  const refTokens = _normalizeTextForMatch(reference).split(' ').filter(w=>w.length>=4);
  const cur = _normalizeTextForMatch(current);
  if(!refTokens.length || !cur) return 0;
  let hit = 0;
  refTokens.forEach(w=>{ if(cur.includes(w)) hit++; });
  return hit / refTokens.length;
}
async function loadKnowledgeCatalog(force){
  if(!force && _ncKnowledge?.updated_at) return;
  try{
    const data = await hubApiCuisine('GET','op=knowledge');
    _ncKnowledge = {
      problems:Array.isArray(data?.problems)?data.problems:[],
      recommendations:Array.isArray(data?.recommendations)?data.recommendations:[],
      updated_at:data?.updated_at||null
    };
  }catch(e){
    console.warn('[nc_knowledge]',e.message);
  }
}
function _ncCatalog(){
  const fromStore = S.corrective_actions_catalog || {};
  const mapped = fromStore.mappings && typeof fromStore.mappings==='object' ? fromStore.mappings : {};
  const actions = Array.isArray(fromStore.actions) && fromStore.actions.length
    ? fromStore.actions
    : HACCP_DEFAULT_CORRECTIVE_ACTIONS;
  return {
    actions,
    mappings: mapped,
    source: Array.isArray(fromStore.actions) && fromStore.actions.length ? 'supabase' : 'fallback',
    updated_at: fromStore.updated_at || null,
  };
}
function _mappedIdsForType(type, catalog){
  const t = normalizeNCType(type);
  const ids = Array.isArray(catalog.mappings?.[t]) ? catalog.mappings[t] : [];
  return new Set(ids);
}
function getSuggestedCorrectiveActions(type, problemText){
  const t = normalizeNCType(type);
  const catalog = _ncCatalog();
  const mappedIds = _mappedIdsForType(t, catalog);
  let list = catalog.actions
    .filter(a => normalizeNCType(a.category)===t)
    .map(a => ({...a, recommended: mappedIds.size===0 ? true : mappedIds.has(a.id)}));

  if(mappedIds.size>0){
    list = list.filter(a => mappedIds.has(a.id));
  }
  if(list.length===0){
    list = catalog.actions
      .filter(a=>a.is_default && normalizeNCType(a.category)===t)
      .map(a=>({...a,recommended:true}));
  }
  const learned = (_ncKnowledge?.recommendations||[])
    .filter(r=>normalizeNCType(r.nc_type)===t)
    .map((r,idx)=>{
      const score = _problemMatchScore(r.problem||'', problemText||'');
      return {
        id:r.id || `learned-${idx}`,
        name:r.action||'Action recommandée',
        description:(r.problem ? `Basé sur: ${r.problem}` : ''),
        category:t,
        is_default:false,
        recommended:true,
        _learned:true,
        _matchScore:score
      };
    })
    .filter(r=>!problemText || r._matchScore>=0.34)
    .slice(0,8);
  if(learned.length){
    const byName = new Set(list.map(a=>String(a.name||'').toLowerCase()));
    learned.forEach(a=>{
      if(!byName.has(String(a.name||'').toLowerCase())) list.unshift(a);
    });
  }
  return list;
}
function getSelectedCorrectiveActionIds(draft){
  if(Array.isArray(draft?.corrective_action_ids)) return [...new Set(draft.corrective_action_ids.filter(Boolean))];
  return [];
}
function getSelectedCorrectiveActionNames(draft){
  const byId = new Map((_ncCatalog().actions||[]).map(a=>[a.id,a.name]));
  const ids = getSelectedCorrectiveActionIds(draft);
  const namesFromIds = ids.map(id=>byId.get(id)||'').filter(Boolean);
  if(namesFromIds.length) return namesFromIds;
  if(Array.isArray(draft?.corrective_action_names)) return draft.corrective_action_names.filter(Boolean);
  return [];
}
async function loadCorrectiveActionsCatalog(force){
  const now = Date.now();
  if(!force && _ncActionsCatalogLoadedAt && (now - _ncActionsCatalogLoadedAt) < 5*60*1000) return;
  if(_ncActionsCatalogLoading) return;
  const c = SupaEngine.cfg();
  if(!c.url || !c.anonKey || !c.siteId) return;
  _ncActionsCatalogLoading = true;
  try{
    const headers = {
      'apikey': c.anonKey,
      'Authorization': `Bearer ${c.userToken || c.anonKey}`,
      'Accept': 'application/json'
    };
    const [actRes,mapRes] = await Promise.all([
      fetch(`${c.url}/rest/v1/corrective_actions?select=id,name,description,category,is_default&order=category.asc,name.asc`,{headers}),
      fetch(`${c.url}/rest/v1/nc_action_mapping?select=non_conformity_type,corrective_action_id`,{headers})
    ]);
    if(!actRes.ok || !mapRes.ok){
      throw new Error(`HTTP ${actRes.status}/${mapRes.status}`);
    }
    const actions = await actRes.json();
    const mappingsRaw = await mapRes.json();
    const mappings = {};
    (mappingsRaw||[]).forEach(m=>{
      const t = normalizeNCType(m.non_conformity_type);
      if(!mappings[t]) mappings[t] = [];
      if(m.corrective_action_id) mappings[t].push(m.corrective_action_id);
    });
    S.corrective_actions_catalog = {
      actions: Array.isArray(actions) ? actions : [],
      mappings,
      updated_at: new Date().toISOString()
    };
    _ncActionsCatalogLoadedAt = Date.now();
    save();
    if(cur==='enr30') renderMain();
  } catch(e){
    console.warn('[nc_actions] chargement catalogue:', e.message);
  } finally {
    _ncActionsCatalogLoading = false;
  }
  await loadKnowledgeCatalog(force);
}
function nc30SetType(type){
  S['enr30']=S['enr30']||{};
  S['enr30'].draft=S['enr30'].draft||{};
  S['enr30'].draft.non_conformity_type=normalizeNCType(type);
  save();
  renderMain();
}
function nc30ToggleCorrectiveAction(actionId){
  S['enr30']=S['enr30']||{};
  S['enr30'].draft=S['enr30'].draft||{};
  const d=S['enr30'].draft;
  const ids = new Set(getSelectedCorrectiveActionIds(d));
  if(ids.has(actionId)) ids.delete(actionId); else ids.add(actionId);
  d.corrective_action_ids = [...ids];
  d.corrective_action_names = d.corrective_action_ids
    .map(id=>(_ncCatalog().actions||[]).find(a=>a.id===id)?.name||'')
    .filter(Boolean);
  save();
  renderMain();
}

function _ncRaisonsFor(fid){
  if(fid.includes('duree')||fid.includes('couple')||fid==='conf_duree') return NC_RAISONS_DUREE;
  if(fid.includes('temp')||fid.includes('tc')||fid==='conf_t'||fid.includes('_t_')||fid.includes('prem')||fid.includes('dern')||fid.includes('deb')||fid.includes('fin')||fid==='conf_r'||fid==='conf_rt'||fid==='conforme') return NC_RAISONS_TEMP;
  return NC_RAISONS_GEN;
}

function cfEl(f,sec){
  const val=fVal(f.id,sec);
  const raisonKey='nc_raison__'+f.id;
  const raisonVal=gd(raisonKey,sec)||'';
  const raisOpts=_ncRaisonsFor(f.id);
  const ncPanelId='nc-panel-'+f.id+'-'+sec;
  return`<div class="fg ${f.full?'full':''}" style="flex-direction:column">
    <div class="cfl">${f.label}</div>
    <div class="cfg" data-cg="${f.id}">
      <button class="cfb oui${val==='OUI'?' on':''}" data-cv="OUI" onclick="setCF('${f.id}','OUI',this,'${sec}')">✓ OUI</button>
      <button class="cfb non${val==='NON'?' on':''}" data-cv="NON" onclick="setCF('${f.id}','NON',this,'${sec}')">✗ NON</button>
    </div>
    <div class="auto-badge${val==='NON'?' nc':''}" style="${val?'':'display:none'}">${val==='OUI'?'✓ Conforme':val==='NON'?'⚠️ Non-conforme – agir !':''}</div>
    ${!f.auto?`<div id="${ncPanelId}" class="nc-raison-panel" style="${val==='NON'?'':'display:none'}">
      <div class="nc-raison-title">📋 Cause de la non-conformité</div>
      <div class="nc-raison-pills">
        ${raisOpts.map(r=>`<button class="nc-pill${raisonVal===r?' selected':''}" onclick="setNCRaison('${f.id}','${sec}',${JSON.stringify(r)},this)">${r}</button>`).join('')}
      </div>
      ${raisonVal==='Autre'||(!raisOpts.includes(raisonVal)&&raisonVal)?
        `<input class="fi nc-raison-input" type="text" placeholder="Préciser la cause..." value="${escH(raisonVal==='Autre'?'':raisonVal)}"
          oninput="sd('nc_raison__${f.id}',this.value||'Autre','${sec}')">` : ''}
    </div>`:''}
  </div>`;
}

function setNCRaison(fid, sec, raison, el){
  sd('nc_raison__'+fid, raison, sec);
  const panel=el.closest('.nc-raison-panel');
  panel.querySelectorAll('.nc-pill').forEach(b=>b.classList.toggle('selected',b===el));
  // Afficher input libre si "Autre"
  let input=panel.querySelector('.nc-raison-input');
  if(raison==='Autre'){
    if(!input){
      input=document.createElement('input');
      input.className='fi nc-raison-input';
      input.placeholder='Préciser la cause...';
      input.oninput=function(){sd('nc_raison__'+fid,this.value||'Autre',sec);};
      panel.appendChild(input);
      setTimeout(()=>input.focus(),50);
    }
  } else {
    if(input) input.remove();
  }
}
function taEl(f,sec){
  return`<div class="fg full"><label>${f.label}
    <button type="button" class="mic-btn" style="width:32px;height:28px;border-radius:8px;font-size:.85rem;margin-left:6px;border:none;cursor:pointer;vertical-align:middle" title="Dicter" onclick="startMicTA('ta-${f.id}-${sec}','${f.id}','${sec}')">🎤</button>
  </label>
    <textarea rows="${f.rows||3}" class="fi" id="ta-${f.id}-${sec}" oninput="sd('${f.id}',this.value,'${sec}')">${escH(fVal(f.id,sec))}</textarea></div>`;
}
function acHtml(id,sec,label,ph){
  return`<div class="fg full" style="position:relative">
    <label>${label}</label>
    <div class="mic-wrap">
      <input class="fi" type="text" value="${escH(gd(id,sec)||'')}" placeholder="${escH(ph||'')}"
        id="ac-${id}-${sec}" oninput="acIn('${id}','${sec}',this.value)" onblur="acBl('${id}','${sec}')" autocomplete="off" style="border-radius:10px 0 0 10px;border-right:none">
      <button type="button" class="mic-btn" title="Dicter" onclick="startMic('ac-${id}-${sec}','${id}','${sec}',true)">🎤</button>
    </div>
    <div class="ac-drop" id="acd-${id}-${sec}" style="display:none"></div>
  </div>`;
}
function acIn(id,sec,val){
  sd(id,val,sec);doAutoCalc(sec);
  const drop=document.getElementById(`acd-${id}-${sec}`);
  const m=matchProds(val);
  if(m.length&&val.length>=2){
    drop.style.display='block';
    drop.innerHTML=m.map(p=>`<div class="ac-item" onmousedown="acPick('${id}','${sec}','${escH(p)}')">${p}</div>`).join('');
  }else drop.style.display='none';
}
function acBl(id,sec){setTimeout(()=>{const d=document.getElementById(`acd-${id}-${sec}`);if(d)d.style.display='none';},250);}
function acPick(id,sec,val){
  sd(id,val,sec);
  const inp=document.getElementById(`ac-${id}-${sec}`);if(inp)inp.value=val;
  const drop=document.getElementById(`acd-${id}-${sec}`);if(drop)drop.style.display='none';
}
function setCF(id,val,el,sec){
  if(roCheck())return;
  sd(id,val,sec);doAutoCalc(sec);
  el.parentElement.querySelectorAll('[data-cv]').forEach(b=>b.classList.toggle('on',b.dataset.cv===val));
  const badge=el.parentElement.nextElementSibling;
  if(badge?.classList.contains('auto-badge')){
    badge.style.display='';badge.className=val==='OUI'?'auto-badge':'auto-badge nc';
    badge.innerHTML=val==='OUI'?'✓ Conforme':'⚠️ Non-conforme – agir !';
  }
  // Afficher / cacher le panel raison NC
  const panel=document.getElementById('nc-panel-'+id+'-'+sec);
  if(panel){
    panel.style.display=val==='NON'?'':'none';
    if(val==='OUI'){
      // Réinitialiser la raison si on repasse à OUI
      sd('nc_raison__'+id,'',sec);
      panel.querySelectorAll('.nc-pill').forEach(b=>b.classList.remove('selected'));
      const inp=panel.querySelector('.nc-raison-input');
      if(inp)inp.remove();
    } else {
      // Focus sur les pills
      setTimeout(()=>panel.querySelector('.nc-pill')?.scrollIntoView({block:'nearest'}),100);
    }
  }
  if(val==='NON')toast('⚠️ Non-conforme ! Indiquez la cause ci-dessous.','warning');
}
const renderFields=(fields,sec)=>`<div class="fgrid">${fields.map(f=>rf(f,sec)).join('')}</div>`;

// ════════════════════════════════════════════════════
// HISTORY RENDERING – affiche TOUTES les données
// ════════════════════════════════════════════════════
const FLAB={
  date:'Date',heure:'Heure',dt:'Date/Heure',produit:'Produit',fournisseur:'Fournisseur',
  nc_raison__conforme:'Cause NC',nc_raison__conf_r:'Cause NC refroid.',nc_raison__conf_rt:'Cause NC remise',
  nc_raison__conf_deb:'Cause NC début',nc_raison__conf_fin:'Cause NC fin',nc_raison__conf_prem:'Cause NC 1er',
  nc_raison__conf_dern:'Cause NC dernier',nc_raison__conf_duree:'Cause NC durée',nc_raison__conf_couple:'Cause NC couple',
  nc_raison__conf_premier:'Cause NC 1er plat',nc_raison__conf1:'Cause NC début',nc_raison__conf2:'Cause NC fin',
  pre_ref:'Pré-refroid.',
  h_pref_deb:'Heure pré-deb.',h_pref_fin:'Heure pré-fin',
  t_pref_deb:'T°C pré-deb.',t_pref_fin:'T°C pré-fin',
  h_ref_deb:'Heure refroid. deb',h_ref_fin:'Heure refroid. fin',
  t_ref_deb:'T°C refroid. deb',t_ref_fin:'T°C refroid. fin',
  duree:'Durée',duree_pre:'Durée pré-refroid.',duree_r:'Durée refroid.',duree_rt:'Durée remise',
  h_deb:'Heure début',h_fin:'Heure fin',t_deb:'T°C début',t_fin:'T°C fin',
  h1:'Heure 1',h2:'Heure 2',h3:'Heure 3',h4:'Heure 4',
  t1:'T°C 1',t2:'T°C 2',t3:'T°C 3',t4:'T°C 4',
  tc:'T°C',t_debut:'T°C début',t_cuisson:'T°C cuisson',t_premier:'T°C 1er',
  t_ext:'T°C afficheur',t_int:'T°C thermomètre',t_glac:'T°C glacière',t_prod:'T°C produit',
  t_f:'T°C froid',t_c:'T°C chaud',ecart:'Écart',
  conforme:'Conforme',conf_r:'Refroid. conf.',conf_rt:'Remise conf.',
  conf_deb:'Début conf.',conf_fin:'Fin conf.',conf_debut:'Début conf.',
  conf_pre:'Pré-refroid. conf.',conf_duree:'Durée conf.',conf_cuisson:'Cuisson conf.',
  conf_mix_deb:'Mixage déb. conf.',conf_mix_fin:'Mixage fin conf.',
  t_mix_deb:'T°C mixage début',t_mix_fin:'T°C mixage fin',mode_mixage:'Mode mixage',
  conf1:'T°C déb. conf.',conf2:'T°C fin conf.',conf_premier:'1er plateau conf.',
  conf_couple:'Couple conf.',conf_prem:'1er conf.',conf_dern:'Dernier conf.',
  conf_glac:'Glacière conf.',conf_prod:'Produit conf.',conf_f:'Froid conf.',conf_c:'Chaud conf.',
  conf:'Conforme',vehicule:'Véhicule OK',emballage:'Emballage OK',etiquetage:'Étiquetage OK',
  qualite:'Qualité OK',filtre:'Filtrée',change:'Changée',conf_test:'Test conf.',remise:'1ère remise',
  date_refroid:'Date refroidissement',date_rechauff:'Date réchauffe',
  cuisinier:'Cuisinier',visa:'Visa',chariot:'Chariot',etage:'Étage/Salle',type:'Type',
  service:'Service',lot:'N° lot',dlc:'DLC/DDM',estampille:'Estampille',
  tournee:'Tournée',satellite:'Satellite',friteuse:'Friteuse n°',
  ne_eleve:'Né/Élevé',abattu:'Abattu',origine:'Origine',
  operateur:'Opérateur',participants:'Participants',theme:'Thème',responsable:'Responsable',
  association:'Association',prod_f:'Produit froid',prod_c:'Produit chaud',
  visa_assoc:'Visa association',h_prem:'Heure 1er',h_dern:'Heure dernier',
  // ENR23 réception 2 produits
  p1_produit:'Produit 1', p1_lot:'Lot 1', p1_dlc:'DLC 1', p1_tc:'T°C prod.1',
  p1_emballage:'Emballage 1', p1_etiquetage:'Étiquetage 1', p1_qualite:'Qualité 1',
  p2_produit:'Produit 2', p2_lot:'Lot 2', p2_dlc:'DLC 2', p2_tc:'T°C prod.2',
  p2_emballage:'Emballage 2', p2_etiquetage:'Étiquetage 2', p2_qualite:'Qualité 2',
  // ENR_TC_DISTRIB
  midi_froid_plat:'Midi – Plat froid',midi_froid_temp:'Midi – T°C froid',midi_froid_conf:'Midi – Froid conf.',
  midi_chaud_plat:'Midi – Plat chaud',midi_chaud_temp:'Midi – T°C chaud',midi_chaud_conf:'Midi – Chaud conf.',
  midi_valide:'Midi – Validé',midi_cuisinier:'Midi – Cuisinier',
  soir_froid_plat:'Soir – Plat froid',soir_froid_temp:'Soir – T°C froid',soir_froid_conf:'Soir – Froid conf.',
  soir_chaud_plat:'Soir – Plat chaud',soir_chaud_temp:'Soir – T°C chaud',soir_chaud_conf:'Soir – Chaud conf.',
  soir_valide:'Soir – Validé',soir_cuisinier:'Soir – Cuisinier',
  non_conformity_type:'Type NC',
  corrective_action_names:'Actions correctives',
  corrective_action_custom:'Action personnalisée',
  action_custom:'Action personnalisée',
};
const SKIP=['_ts','_sec','photo','p1_photo','p2_photo','signature','_key','_auto','_auto_ligne_idx','_auto_idx','_pending_idx','_ligne_ts','_enr01_ref','_enr02_ref','_enr01_idx','_enr01_ts','_orig','_statut','_src','_auto_key','corrective_action_ids','corrective_action_trace',
  '_lienBF','_lienBF_ts','_enr01_link']; // champs de lien traçabilité → affichés en badge, pas bruts
const IS_NC_RAISON=k=>k.startsWith('nc_raison__');
const IS_TEMP_FID=k=>k.startsWith('t_')||k==='tc'||/^t[1-4]$/.test(k)||k==='ecart';
const IS_CONF_FID=k=>CONF_FIDS.includes(k);


// ── Lier un refroidissement (ENR01) à son origine BF + pré-remplir la fiche ──
function lierRefroid(idx, type) {
  const lignes = (S['enr01'] || {}).lignes || [];
  if (!lignes[idx]) return;
  const r01 = lignes[idx];
  const ancien = r01._lienBF || '';

  if (ancien === type) {
    // toggle : on retire le lien
    delete r01._lienBF;
    delete r01._lienBF_ts;
    save();
    toast('🔗 Lien retiré', 'info');
    renderMain();
    return;
  }

  // Poser le lien sur l'ENR01
  r01._lienBF = type;
  r01._lienBF_ts = new Date().toISOString();
  save();

  // Pré-remplir la fiche ENR07 (BF cuit) ou ENR08 (BF cru) avec le produit
  const cible = type === 'cuit' ? 'enr07' : 'enr08';
  const produit = r01.produit || '';
  S[cible] = S[cible] || {};
  S[cible].draft = S[cible].draft || {};
  // Pré-remplir produit + date + note de traçabilité
  if (produit) S[cible].draft.produit = produit;
  S[cible].draft.date = S[cible].draft.date || r01.date || today();
  S[cible].draft._enr01_link = r01._ts || ''; // lien traçabilité
  save();

  toast(type === 'cuit'
    ? '🥘 Lié BF Cuit → fiche ENR07 pré-remplie avec "' + produit + '"'
    : '🥗 Lié BF Cru → fiche ENR08 pré-remplie avec "' + produit + '"',
    'success', 3500);

  // Naviguer vers la fiche cible
  setTimeout(() => goTo(cible), 400);
}

function renderHistoCard(secId,fieldDefs,opts){
  opts=opts||{};
  const extraBtn=opts.extraBtn||null;
  const allLignes=(S[secId]||{}).lignes||[];
  // Séparer saisies normales et masquées
  const lignes = allLignes.filter(r=>!r._deleted);
  const deletedCount = allLignes.filter(r=>r._deleted).length;
  const extraLab={};(fieldDefs||[]).forEach(f=>{extraLab[f.id]=f.label;});
  return`<div class="card">
    <div class="hh">
      <span class="hh-title">📜 Historique des saisies</span>
      <span class="hh-badge">${lignes.length} saisie${lignes.length!==1?'s':''}</span>
    </div>
    ${deletedCount>0?`<div style="font-size:.68rem;color:#9a3412;background:#ffedd5;padding:5px 10px;border-radius:8px;margin-bottom:8px">🔒 ${deletedCount} saisie${deletedCount>1?'s':''} masquée${deletedCount>1?'s':''} — conservée${deletedCount>1?'s':''} en base (conformité HACCP)</div>`:''}
    ${lignes.length===0
      ?`<div class="empty-s">Aucune saisie enregistrée.<br><small>Complétez le formulaire ci-dessus puis appuyez sur Enregistrer.</small></div>`
      :lignes.map((r,i)=>{
        const isEnr19 = secId === 'enr19';
        const encs19Cache = isEnr19 ? getEnceintes() : [];
        const enc19 = isEnr19 ? encs19Cache.find(e=>e.id===r.enc_id) : null;

        const prod = isEnr19
          ? (enc19?.label || r.enc_id || 'Enceinte')
          : (r.produit||r.fournisseur||r.association||r.theme||r.num||r.enceinte||'Saisie');
        const date=r.date||r.dt?.slice(0,10)||'';
        const heure=r.heure||r.h||r.h_deb||r.h_ref_deb||(isEnr19?r.heure:'');
        const cuisinier=r.cuisinier||r.operateur||r.visa||'';
        // ENR19 : badges température et conformité
        let confBadges;
        if (isEnr19) {
          const tVal = r.temp !== undefined ? ((parseFloat(r.temp)>=0?'+':'')+parseFloat(r.temp).toFixed(1)+'°C') : '—';
          const conf19 = enc19 ? encConforme(r.temp, enc19.consigne) : null;
          const momentLabel = r.moment==='ouv'?'🌅 Ouverture':'🌙 Fermeture';
          const confBadge = conf19===true
            ? `<span class="bo oui">✓ Conforme</span>`
            : conf19===false
            ? `<span class="bo non">⚠️ Hors seuil</span>` : '';
          confBadges = `<span style="font-size:.75rem;font-weight:800;color:var(--plum)">${tVal}</span> <span style="font-size:.7rem;color:var(--gris2)">${momentLabel}</span> ${confBadge}`;
        } else {
          confBadges = CONF_FIDS.filter(k=>r[k]==='OUI'||r[k]==='NON').slice(0,3)
            .map(k=>{const rNC=r[k]==='NON'&&r['nc_raison__'+k]?(' — '+r['nc_raison__'+k]):'';return`<span class="bo ${r[k]==='OUI'?'oui':'non'}">${FLAB[k]||k}: ${r[k]}${escH(rNC)}</span>`;}).join('');
        }
        // All data items (non-conf, non-skip)
        const dataKeys=Object.keys(r).filter(k=>!SKIP.includes(k)&&!IS_NC_RAISON(k)&&r[k]&&String(r[k]).trim());
        const confItems=dataKeys.filter(k=>IS_CONF_FID(k));
        const dataItems=dataKeys.filter(k=>!IS_CONF_FID(k));
        const mkItem=(k,flagConf)=>{
          const lbl=extraLab[k]||FLAB[k]||k;
          const val=String(r[k]);
          let cls='';
          if(flagConf)cls=val==='OUI'?'conf-oui':'conf-non';
          const disp=IS_TEMP_FID(k)&&val!=='OUI'&&val!=='NON'?`${val}°C`:val;
          const raisonNC=flagConf&&val==='NON'?r['nc_raison__'+k]||'':'';
          return`<div class="hdi">
            <div class="hdi-label">${lbl}</div>
            <div class="hdi-val ${cls}">${disp}</div>
            ${raisonNC?'<div class="hdi-nc-raison">📋 '+escH(raisonNC)+'</div>':''}
          </div>`;
        };
        const grid=[...dataItems.map(k=>mkItem(k,false)),...confItems.map(k=>mkItem(k,true))].join('');
        // Badge auto-NC à compléter
        const isAutoNC=secId==='enr30'&&r._auto===true&&r.cloture!=='OUI';
        const autoNCBadge=isAutoNC?`<span style="background:#dc2626;color:#fff;border-radius:8px;padding:2px 7px;font-size:.62rem;font-weight:900;margin-right:4px">⚡ AUTO — À compléter</span>`:'';
        const autoCompleteBtn=isAutoNC?`<button onclick="event.stopPropagation();ncAutoFillFromLigne(${i})" style="background:#dc2626;color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:.7rem;font-weight:800;font-family:inherit;cursor:pointer;white-space:nowrap">📋 Compléter</button>`:'';
        // Boutons lien BF Cuit / BF Cru pour ENR01 (Refroidissement)
        const lienBF = secId==='enr01' ? r._lienBF || '' : null;
        const bfCuitBtn = secId==='enr01' ? `<button onclick="event.stopPropagation();lierRefroid(${i},'cuit')" title="Lier à Bien Fait Cuit (ENR07)" style="background:${lienBF==='cuit'?'#1565c0':'#e3f2fd'};color:${lienBF==='cuit'?'#fff':'#1565c0'};border:1.5px solid #1565c0;border-radius:8px;padding:5px 8px;font-size:.68rem;font-weight:800;font-family:inherit;cursor:pointer;white-space:nowrap">${lienBF==='cuit'?'✅':'🔗'} BF Cuit</button>` : '';
        const bfCruBtn  = secId==='enr01' ? `<button onclick="event.stopPropagation();lierRefroid(${i},'cru')" title="Lier à BF Cru / TM sans cuisson (ENR08)" style="background:${lienBF==='cru'?'#2e7d32':'#e8f5e9'};color:${lienBF==='cru'?'#fff':'#2e7d32'};border:1.5px solid #2e7d32;border-radius:8px;padding:5px 8px;font-size:.68rem;font-weight:800;font-family:inherit;cursor:pointer;white-space:nowrap">${lienBF==='cru'?'✅':'🔗'} BF Cru</button>` : '';
        return`<div class="hr-card" style="${isAutoNC?'border:2px solid #fca5a5;background:#fff8f8':''}">
          <div class="hr-card-top" onclick="toggleHR(this)">
            <div style="flex:1;min-width:0">
              <div class="hr-card-main">${autoNCBadge}${escH(prod)}</div>
              <div class="hr-card-meta">
                ${r.date_refroid?`❄️ Refr. ${r.date_refroid} → 🔥 Réchauffé ${r.date_rechauff||date}`:date}${heure?' · ⏰'+heure:''}${cuisinier?' · 👨‍🍳'+escH(cuisinier):''}</div>
              <div class="conf-badges" style="margin-top:5px">${confBadges}</div>
            </div>
            <div style="display:flex;gap:4px;align-items:flex-start;flex-shrink:0">
              ${autoCompleteBtn}
              ${bfCuitBtn}
              ${bfCruBtn}
              ${extraBtn?extraBtn(r,i):''}

              <span class="hr-expand">▼</span>
            </div>
          </div>
          <div class="hr-card-data">
            <div class="hr-data-grid">${grid}</div>
            ${r.photo?photoThumb(r.photo,'📷 Étiquette'):''}
            ${r.signature&&r.signature.startsWith('data:')?`<div style="margin-top:6px"><div style="font-size:.65rem;font-weight:700;color:#b89ab6;margin-bottom:3px">✍️ SIGNATURE</div><img src="${r.signature}" style="max-height:50px;max-width:100%;border:1px solid var(--brd);border-radius:8px;background:#fdf8fd" alt="Signature"></div>`:r.signature?`<div style="font-size:.72rem;color:#7A6579;margin-top:4px">✍️ ${escH(r.signature)}</div>`:''}
          </div>
        </div>`;
      }).join('')
    }
  </div>`;
}
function toggleHR(top){
  const data=top.nextElementSibling;
  const isOpen=data.classList.toggle('open');
  const arrow=top.querySelector('.hr-expand');
  if(arrow)arrow.textContent=isOpen?'▲':'▼';
}

// ════════════════════════════════════════════════════
// SAVE / DELETE
// ════════════════════════════════════════════════════
// ════════════════════════════════════════════════════
// AUTO-NC : création automatique depuis toutes les pages
// ════════════════════════════════════════════════════
function autoCreateNC(source, desc, lieu, action, extraFields){
  const now=new Date();
  const heure=now.getHours().toString().padStart(2,'0')+':'+now.getMinutes().toString().padStart(2,'0');
  const ts=new Date().toISOString();
  const inferredType = inferNCTypeFromValues(source, desc, lieu, extraFields||{});
  // Éviter les doublons immédiats (même source + même minute)
  const key=source+'|'+today()+'|'+heure;
  S.nc_auto_pending=S.nc_auto_pending||[];
  if(S.nc_auto_pending.some(p=>p._key===key))return;

  // ── 1. Générer le numéro NC automatique ──────────────
  S['enr30']=S['enr30']||{};
  S['enr30'].lignes=S['enr30'].lignes||[];
  const nextNum=String(S['enr30'].lignes.length+1).padStart(2,'0');
  const year=new Date().getFullYear();
  const num=year+'/'+nextNum;

  // ── 2. Pousser directement dans l'historique ENR30 ───
  const ligneAuto={
    _ts:ts, _auto:true, _key:key,
    num, date:today(), heure_nc:heure,
    desc, lieu:lieu||source,
    action:action||'',
    action_custom:action||'',
    non_conformity_type:inferredType,
    cloture:'NON',
    nom_fct:getActiveSession()||'',
    _pending_idx:null,
    ...(extraFields||{})
  };
  S['enr30'].lignes.unshift(stampEntry(ligneAuto));

  // ── 3. Garder en pending pour le badge / complétion ──
  const pendingEntry={_ts:ts,_key:key,source,desc,lieu:lieu||'',action:action||'',action_custom:action||'',non_conformity_type:inferredType,date:today(),heure,_ligne_ts:ts};
  S.nc_auto_pending.push(pendingEntry);

  save();
  // ── Supabase sync ──
  try { SupaEngine.enqueue('enr30', ligneAuto); } catch(e){}
  setTimeout(()=>toast('🚨 NC auto-créée dans ENR30 — à compléter','warning'),120);
}
function ncAutoPending(){return S.nc_auto_pending||[];}
function ncAutoCount(){
  // Compte les NC auto dans l'historique ENR30 qui ne sont pas encore clôturées
  const autoOpen=(S['enr30']?.lignes||[]).filter(r=>r._auto===true&&r.cloture!=='OUI').length;
  return autoOpen;
}
function ncAutoFill(idx){
  const all=ncAutoPending();
  const p=all[idx];if(!p)return;
  S['enr30']=S['enr30']||{};
  const existing=(S['enr30'].lignes||[]);
  const nextNum=(existing.length+1).toString().padStart(2,'0');
  const year=new Date().getFullYear();
  S['enr30'].draft={
    num:year+'/'+nextNum,
    date:p.date,
    heure_nc:p.heure,
    desc:p.desc,
    lieu:p.lieu||p.source,
    action:p.action||'',
    action_custom:p.action_custom||p.action||'',
    non_conformity_type:normalizeNCType(p.non_conformity_type||inferNCTypeFromValues(p.source,p.desc,p.lieu,p)),
    _auto_idx:String(idx)
  };
  save();
  goTo('enr30');
  toast('📋 Formulaire NC pré-rempli — complétez et enregistrez','success');
}
function ncAutoFillFromLigne(ligneIdx){
  // Pré-remplit le formulaire depuis une ligne auto existante dans l'historique
  const lignes=(S['enr30']||{}).lignes||[];
  const r=lignes[ligneIdx];if(!r)return;
  // Extraire les cause_xxx du record pour les mettre dans le draft
  const _causeKeys=Object.keys(r).filter(k=>k.startsWith('cause_'));
  const _causes={};_causeKeys.forEach(k=>{_causes[k]=r[k];});
  // Mapper les causes depuis la ligne vers les clés du formulaire ENR30
  const _causeMap={
    cause_matriel:'1',  // Matériel
    cause_milieu:'1',   // Milieu  
    cause_mthode:'1',   // Méthode
    cause_matirepremire:'1', // Matière première
    cause_mainduvre:'1', // Main d'œuvre
    cause_autre:'1'     // Autre
  };
  const _draftCauses={};
  Object.keys(_causeMap).forEach(k=>{if(r[k])_draftCauses[k]=r[k];});
  S['enr30'].draft={
    num:r.num||'',
    date:r.date||today(),
    heure_nc:r.heure_nc||r.heure||'',
    desc:r.desc||'',
    lieu:r.lieu||'',
    action:r.action||'',
    action_custom:r.action_custom||r.corrective_action_custom||sanitizeLegacyCorrectiveAction(r.action,r.desc)||'',
    non_conformity_type:normalizeNCType(r.non_conformity_type||inferNCTypeFromValues(r.source,r.desc,r.lieu,r)),
    corrective_action_ids:Array.isArray(r.corrective_action_ids)?r.corrective_action_ids:[],
    corrective_action_names:Array.isArray(r.corrective_action_names)?r.corrective_action_names:[],
    nom_fct:r.nom_fct||getActiveSession()||'',
    _auto_ligne_idx:String(ligneIdx),
    ..._draftCauses
  };
  save();
  // Scroll vers le haut du formulaire
  window.scrollTo(0,0);
  renderMain();
  toast('📋 Formulaire pré-rempli — complétez et enregistrez','success');
}

function ncAutoDismiss(idx){
  const all=[...(S.nc_auto_pending||[])];
  all.splice(idx,1);
  S.nc_auto_pending=all;
  save();renderMain();
}

function saveRow(id){
  // Quand ENR07 est sauvegardé, marquer les ENR01 BF Cuit liés comme traités → lève le blocage
  if(id==='enr07'){
    const draft=((S['enr07']||{}).draft||{});
    const produit=(draft.produit||'').toLowerCase().trim();
    ((S['enr01']||{}).lignes||[]).forEach(r=>{
      if(r._lienBF==='cuit'&&(!r._statut||r._statut==='en_attente')){
        const p01=(r.produit||'').toLowerCase().trim();
        if(!produit||!p01||p01===produit||produit.includes(p01)||p01.includes(produit)){
          r._lienBF='traite';
        }
      }
    });
    save();
  }
  if(roCheck())return;
  // Calculs auto dans le draft avant lecture (doAutoCalc l'a déjà fait en temps réel,
  // on rappelle ici pour garantir que saveRow a toujours les bonnes valeurs)
  if(AR[id]){try{const u=AR[id](id);Object.entries(u||{}).forEach(([k,v])=>{if(v!=null){S[id]=S[id]||{};S[id].draft=S[id].draft||{};S[id].draft[k]=String(v);}});}catch(e){}}
  const def=FDEFS[id];const draft={...((S[id]||{}).draft||{})};
  if(def)def.fields.forEach(f=>{if((draft[f.id]===undefined||draft[f.id]==='')&&dflt(f))draft[f.id]=dflt(f);});
  if(Object.values(draft).filter(v=>v&&String(v).trim()).length===0){toast('⚠️ Aucune donnée saisie','warning');return;}
  const prod=draft.produit||draft.fournisseur||draft.association||draft.theme||'';
  if(prod)addProd(prod.trim());
  const ts=new Date().toISOString();
  // ── Photo différée : télécharger avec le bon nom produit ──
  const _savedRow = {...draft, _sec:id, _ts:ts};
  // Inclure photo2/3 dans le row ENR31 si présentes
  if(id==='enr31'){
    if(draft.photo2) _savedRow.photo2=draft.photo2;
    if(draft.photo3) _savedRow.photo3=draft.photo3;
  }
  S[id]=S[id]||{};S[id].lignes=S[id].lignes||[];
  S[id].lignes.unshift(stampEntry(_savedRow));
  S[id].draft={};

  const draftFinal=draft;
  // ENR31: download photos APRÈS avoir mis dans S[] (pour Supabase enqueue ci-dessous)
  if(id==='enr31' && _pendingPhotos['enr31']){
    const produit31 = draftFinal.produit||draftFinal.fournisseur||'Tracabilite';
    const date31 = draftFinal.date||today();
    const fname31 = _downloadPendingPhoto('enr31', produit31, '', date31);
    if(fname31) S[id].lignes[0].photo = _photoUpdateFilename(S[id].lignes[0].photo, fname31);
  }

  // ── Lien ENR01 → ENR02 ou ENR03 ──────────────────────────
  if(id==='enr02'||id==='enr03'){
    let idx = -1;
    // Cas 1 : lien explicite via bouton "Réchauffer" depuis ENR01
    if(draftFinal._enr01_idx!==undefined){
      idx = parseInt(draftFinal._enr01_idx);
    } else {
      // Cas 2 : auto-matching par produit + "en attente"
      // Cherche l'ENR01 en attente le plus récent avec le même produit
      // (peu importe destination, qui peut être null sur les anciennes saisies)
      const prod = (draftFinal.produit||'').trim().toLowerCase();
      if(prod){
        const lignes01 = S['enr01']?.lignes||[];
        let bestIdx = -1, bestTs = 0;
        lignes01.forEach((r,i)=>{
          if(!r.produit) return;
          if(r._statut && r._statut!=='en_attente') return;
          if((r.produit||'').trim().toLowerCase()!==prod) return;
          const ts = r._ts ? new Date(r._ts).getTime() : 0;
          if(ts>bestTs){ bestTs=ts; bestIdx=i; }
        });
        if(bestIdx>=0){
          idx = bestIdx;
          // Mémoriser le lien aussi dans la ligne ENR02/03 fraîchement créée
          if(S[id].lignes[0]){
            S[id].lignes[0]._enr01_idx = idx;
            S[id].lignes[0]._enr01_ts = lignes01[idx]._ts||'';
          }
        }
      }
    }
    if(idx>=0 && S['enr01']?.lignes?.[idx]){
      S['enr01'].lignes[idx]._statut=id==='enr02'?'rechauffe':'rechauffe_remise';
      // Re-synchroniser cette ligne vers Supabase avec le nouveau _statut
      try { SupaEngine.enqueue('enr01', S['enr01'].lignes[idx]); } catch(e){}
    }
    // Si ENR02 validé depuis ENR01 → créer ENR03 automatiquement
    if(id==='enr02' && draftFinal._enr01_idx!==undefined){
      const r01=S['enr01']?.lignes?.[idx]||{};
      // Recalculer les durées ENR03 depuis les heures réelles
      const durR=tdiff(r01.h_ref_deb,r01.h_ref_fin);
      const durRT=tdiff(draftFinal.h_deb,draftFinal.h_fin);
      const t2v=parseFloat(r01.t_ref_fin)||null;
      const t4v=parseFloat(draftFinal.t_fin)||null;
      const confR=durR!==null&&t2v!==null?(durR<=120&&t2v<=10?'OUI':'NON'):'';
      const t3v=parseFloat(draftFinal.t3)||null;
      const confRT=durRT!==null&&t4v!==null&&t3v!==null?(durRT<=60&&t4v>=63&&t3v<=10?'OUI':'NON'):'';
      S['enr03']=S['enr03']||{};S['enr03'].lignes=S['enr03'].lignes||[];
      const dateRechauff=draftFinal.date||today();
      S['enr03'].lignes.unshift(stampEntry({
        date:dateRechauff,
        date_refroid:r01.date||'',
        date_rechauff:dateRechauff,
        produit:draftFinal.produit||r01.produit||'',
        h1:r01.h_ref_deb||'',t1:r01.t_ref_deb||'',
        h2:r01.h_ref_fin||'',t2:r01.t_ref_fin||'',
        duree_r:fmtD(durR),conf_r:confR,
        h3:draftFinal.h_deb||'',t3:draftFinal.t_deb||'',
        h4:draftFinal.h_fin||'',t4:draftFinal.t_fin||'',
        duree_rt:fmtD(durRT),conf_rt:confRT,
        cuisinier:draftFinal.cuisinier||r01.cuisinier||'',
        _auto:'1',_enr01_ref:r01._ts||'',_enr02_ref:ts,
        _sec:'enr03',_ts:new Date().toISOString(),
      }));
      autoBackup();
  toast('✅ Saisie enregistrée + fiche ENR03 créée automatiquement !','success');
      save();autoBackup();goTo(id);return;
    }
  }

  // ── Auto-matching INVERSE : ENR01 → ENR02/ENR03 déjà existant ────────────
  // Cas : le cuisinier saisit l'ENR02 AVANT de valider l'ENR01 (ordre inhabituel)
  // Ou : l'ENR01 est créé après un ENR02 déjà validé pour le même produit
  // On cherche un ENR02/ENR03 récent (< 48h) avec le même produit qui n'est
  // pas encore lié (pas de _enr01_ts), on le lie à ce nouvel ENR01 et on pose
  // _statut='rechauffe' sur la ligne ENR01 qu'on vient de créer.
  if(id==='enr01'){
    const ligne01 = S['enr01'].lignes[0]; // celle qu'on vient d'ajouter
    const prod01 = (ligne01?.produit||'').trim().toLowerCase();
    if(prod01 && ligne01._ts){
      const now48h = Date.now() - 48*60*60*1000;
      // Chercher dans ENR02 puis ENR03
      for(const secCible of ['enr02','enr03']){
        const lignesCible = S[secCible]?.lignes||[];
        for(const r of lignesCible){
          if(r._enr01_ts) continue; // déjà lié
          if(!r.produit) continue;
          if((r.produit||'').trim().toLowerCase()!==prod01) continue;
          const ts = r._ts ? new Date(r._ts).getTime() : 0;
          if(ts < now48h) continue;
          // Match trouvé : lier et marquer
          r._enr01_ts = ligne01._ts;
          ligne01._statut = (secCible==='enr02') ? 'rechauffe' : 'rechauffe_remise';
          try { SupaEngine.enqueue(secCible, r); } catch(e){}
          try { SupaEngine.enqueue('enr01', ligne01); } catch(e){}
          save();
          break;
        }
        if(ligne01._statut) break;
      }
    }
  }

  // ── Auto-NC si non-conformité détectée ──────────────────
  const _ncFields=Object.entries(draftFinal).filter(([k,v])=>CONF_FIDS.includes(k)&&v==='NON');
  if(_ncFields.length>0){
    const _sLabel=ALL.find(s=>s.id===id)?.label||id.toUpperCase();
    const _sLabelShort=_sLabel.replace(/^ENR\d+ – /,'');
    const _prod=draftFinal.produit||draftFinal.fournisseur||draftFinal.association||draftFinal.plat||draftFinal.plat_midi||'';
    // Construire une description lisible par le cuisinier pour chaque champ NC
    const _TEMP_FIELD_PAIRS={
      conf_deb:'t_deb', conf_t3:'t3', conf_fin:'t_fin', conforme:'tc', conf_r:'t2',
      conf_rt:'t4', conf1:'t1', conf2:'t2', conf_prem:'tc',
      conf_dern:'tc', conf_f:'t_f', conf_c:'t_c', conf_cuisson:'t_cuisson',
      conf_pre:'tc', conf_glac:'t_glac', conf_prod:'t_prod', conf_premier:'tc'
    };
    // Seuils attendus par champ conf
    const _SEUILS={
      conf_deb:'≤ +10°C', conf_t3:'≤ +10°C', conf_fin:'≤ +10°C', conf_r:'≤ +10°C',
      conf_rt:'≥ +63°C', conf2:'≥ +63°C', conforme:'voir seuil',
      conf_cuisson:'≥ +65°C', conf_f:'≤ +10°C', conf_c:'≥ +63°C',
      conf_pre:'≤ +10°C', conf_glac:'≤ +6°C', conf_prod:'≤ +6°C'
    };
    const _fDetails=_ncFields.map(([k])=>{
      const tempKey=_TEMP_FIELD_PAIRS[k];
      const tempVal=tempKey&&draftFinal[tempKey]?parseFloat(draftFinal[tempKey]):null;
      const seuil=_SEUILS[k]||'';
      const fieldNames={conforme:'Conformité',conf_r:'Refroidissement',conf_rt:'Remise T°C',
        conf_deb:'T°C départ remise ≤10°C',conf_t3:'Départ remise ≤10°C',conf_fin:'T°C fin',conf_pre:'Pré-refroid.',conf_duree:'Durée',
        conf_cuisson:'Cuisson',conf1:'T°C début',conf2:'T°C fin',conf_premier:'1er plateau',
        conf_prem:'1er',conf_dern:'Dernier',conf_f:'Froid',conf_c:'Chaud',
        conf_test:'Test',conf_glac:'Glacière',conf_prod:'Produit'};
      const fname=fieldNames[k]||k;
      if(tempVal!==null&&seuil){
        // Déterminer si trop haut ou trop bas
        const seuilNum=parseFloat(seuil.replace(/[^0-9.-]/g,''));
        const trop=seuil.startsWith('≤')?tempVal>seuilNum?'trop haute':'':tempVal<seuilNum?'trop basse':'';
        return`${fname} ${trop?trop+' ':''}(${tempVal}°C, seuil ${seuil})`;
      }
      return fname+' non conforme';
    }).join(' · ');
    const _desc=_sLabelShort+(_prod?' — '+_prod:'')+' : '+_fDetails;
    const _lieu=_sLabelShort;
    const _action=draftFinal.action||draftFinal.mesure||'';
    autoCreateNC(_sLabel, _desc, _lieu, _action);
  }
  save();autoBackup();goTo(id);
  // ── Supabase : enqueue l'enregistrement ──
  try { SupaEngine.enqueue(id, _savedRow); } catch(e){}
  toast('✅ Saisie enregistrée !','success');
}
function clearRow(id){showConfirm('Effacer la saisie ?','Toutes les données saisies seront perdues.','🔄 Effacer',()=>{S[id]=S[id]||{};S[id].draft={};save();goTo(id);});}
function delRow(id,idx){
  if(roCheck())return;
  const chef = (S.config?.chefs||[]).find(c=>c.pin===_adminPin)||{nom:'Cuisinier'};
  const doSoftDelete = () => {
    const lignes = S[id]?.lignes;
    if(!lignes) return;
    // idx peut être un index numérique OU un _ts string
    let row, realIdx;
    if(typeof idx === 'string') {
      // Chercher par _ts
      realIdx = lignes.findIndex(r=>r._ts===idx);
    } else {
      realIdx = idx;
    }
    if(realIdx<0||realIdx>=lignes.length) return;
    row = lignes[realIdx];
    // Soft delete : marquer au lieu de supprimer
    row._deleted = true;
    row._deleted_by = chef.nom || 'Cuisinier';
    row._deleted_at = new Date().toISOString();
    save();
    // Notifier Supabase si client_id connu
    if(row._ts){
      try {
        const stableId = [SupaEngine._cfg()?.siteId, id, row._ts].join('::').replace(/[^a-zA-Z0-9:._-]/g,'_').slice(0,200);
        const c = SupaEngine._cfg();
        if(c?.url && c?.anonKey){
          fetch(`${c.url}/rest/v1/pms_records?client_id=eq.${encodeURIComponent(stableId)}`, {
            method:'PATCH',
            headers:{'Content-Type':'application/json','apikey':c.anonKey,'Authorization':`Bearer ${c.userToken||c.anonKey}`,'Prefer':'return=minimal'},
            body: JSON.stringify({data: {...row}})
          }).catch(e=>console.warn('[soft-delete]',e));
        }
      } catch(e){}
    }
    goTo(id);
    toast('⚠️ Saisie masquée — conservée en base pour conformité HACCP','warning');
  };

  // ENR30 (NC) : protégé par PIN admin
  if(id==='enr30'){
    nettAdminGuard(()=>{
      showConfirm('Masquer cette NC ?','La NC sera masquée sur la tablette mais conservée dans la base de données (obligation HACCP — 5 ans).','🔒 Masquer',doSoftDelete);
    });
    return;
  }
  showConfirm('Masquer cette saisie','Cette saisie sera masquée sur la tablette mais conservée dans la base de données (obligation HACCP — 5 ans de conservation).\n\nElle restera visible sur le dashboard du responsable.','🔒 Masquer',doSoftDelete);
}
function expSec(id){
  // Filtrer par la période sélectionnée dans le panel
  const _sp=getPeriodByKey(S.expCfg?.spPeriod||'mois','sp');
  const _f=arr=>(arr||[]).filter(r=>{const d=r.date||r._ts?.slice(0,10)||'';return d>=_sp.from&&d<=_sp.to;});
  const raw=S[id]||{};
  const filtered={
    ...raw,
    lignes:_f(raw.lignes||[]),
    saisies:_f(raw.saisies||[]),
  };
  // Ajouter aussi nuisibles si ENR28
  const extra=id==='enr28'?{nett_val:_f(S.nett_val||[]),nuisibles_val:_f(S.nuisibles_val||[])}:{};
  const dd=JSON.stringify({section:id,periode:_sp.label,date:new Date().toISOString(),config:S.config||{},data:{...filtered,...extra}},null,2);
  const _slug=_sp.from===_sp.to?_sp.from:_sp.from+'_au_'+_sp.to;
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([dd],{type:'application/json'}));
  a.download=`HACCP_${id}_${_slug}.json`;a.click();
  toast('📥 Export '+_sp.label+' téléchargé','success');
}

// ════════════════════════════════════════════════════
// GENERIC FORM RENDERER
// ════════════════════════════════════════════════════

// ── Vérif BF Cuit refroidi sans remise en T°C → bloquer ENR09 ──────────────
function checkBFCuitNonRetraite() {
  const lignes01 = (S['enr01'] || {}).lignes || [];
  const lignes02 = (S['enr02'] || {}).lignes || [];
  // ENR01 des 48h avec lien BF Cuit
  const cutoff = new Date(Date.now() - 48*3600*1000).toISOString().slice(0,10);
  const bfCuits = lignes01.filter(r => r._lienBF === 'cuit' && !r._deleted && (r.date || '') >= cutoff);
  if (!bfCuits.length) return null;
  // Vérifier si une remise en T°C (ENR02) a été faite APRÈS le refroidissement
  return bfCuits.filter(r01 => {
    const ts01 = r01._ts || (r01.date + 'T00:00:00Z');
    const produit01 = (r01.produit || '').toLowerCase().trim();
    // Chercher un ENR02 plus récent pour le même produit (ou si produit vide, toujours bloquer)
    return !lignes02.some(r02 => {
      const ts02 = r02._ts || (r02.date + 'T23:59:59Z');
      if (ts02 < ts01) return false; // ENR02 avant le refroid → ne compte pas
      if (!produit01) return false; // pas de produit → bloquer systématiquement
      const produit02 = (r02.produit || '').toLowerCase().trim();
      return produit02.includes(produit01) || produit01.includes(produit02);
    });
  });
}

function renderBannerBFCuit(bfCuits) {
  if (!bfCuits || !bfCuits.length) return '';
  const prods = bfCuits.map(r => escH(r.produit || 'Produit refroidi')).join(', ');
  return `<div style="background:#fef3c7;border:2px solid #f59e0b;border-radius:12px;padding:13px 14px;margin-bottom:12px">
    <div style="font-size:.85rem;font-weight:900;color:#92400e;margin-bottom:5px">⚠️ ATTENTION — Produit(s) refroidi(s) après cuisson</div>
    <div style="font-size:.77rem;color:#78350f;margin-bottom:9px"><strong>${prods}</strong><br>
    Ces produits ont été refroidis après cuisson (ENR01 lié BF Cuit).<br>
    Pour les servir à chaud : faire obligatoirement une <strong>Remise en T°C (ENR02)</strong> avant le conditionnement chaud.</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button onclick="goTo('enr02')" style="background:#1565c0;color:#fff;border:none;border-radius:8px;padding:8px 13px;font-size:.75rem;font-weight:800;font-family:inherit;cursor:pointer">🔥 Aller à ENR02 — Remise T°C</button>
      <button onclick="enr09IgnoreWarning=true;renderMain()" style="background:#fff;color:#92400e;border:1.5px solid #f59e0b;border-radius:8px;padding:8px 13px;font-size:.75rem;font-weight:700;font-family:inherit;cursor:pointer">Ignorer et continuer</button>
    </div>
  </div>`;
}

let enr09IgnoreWarning = false;

function makeFR(def){
  return()=>{
    const tagH=def.tag?`<span class="tag ${def.tagCat||''}">${def.tag}</span>`:'';
    // Vérif blocage ENR09 (conditionnement chaud après BF Cuit refroidi)
    const _bfCuitsNT = def.id === 'enr09' && !enr09IgnoreWarning ? checkBFCuitNonRetraite() : null;
    if (def.id !== 'enr09') enr09IgnoreWarning = false; // reset si on quitte enr09
    const _bannerBF = _bfCuitsNT && _bfCuitsNT.length ? renderBannerBFCuit(_bfCuitsNT) : '';
    return`
      ${_bannerBF}
      <div class="card">
        <div class="card-title">${def.title} ${tagH}</div>
        <div class="regle">${def.regle}</div>
        <div class="fg-label">Nouvelle saisie</div>
        ${renderFields(def.fields,def.id)}
        <div class="btn-row">
          <button class="btn-save" onclick="saveRow('${def.id}')">✅ Enregistrer</button>
          <button class="btn btn-sec" onclick="clearRow('${def.id}')">🔄 Effacer</button>

        </div>
      </div>
      ${renderHistoCard(def.id,def.fields)}`;
  };
}

// ════════════════════════════════════════════════════
// ENR01 — SPÉCIAL : question pré-refroidissement
// ════════════════════════════════════════════════════
function renderENR01(){
  const lignes=(S['enr01']||{}).lignes||[];
  const draft=(S['enr01']||{}).draft||{};
  const isPre=draft.pre_ref==='OUI';
  const preAnswered=draft.pre_ref==='OUI'||draft.pre_ref==='NON';

  const preSection=isPre?`
    <div class="sec-block" style="border-color:#93c5fd;background:#edf5ff;">
      <div class="sec-block-title" style="color:#1e40af">🔵 Données de pré-refroidissement</div>
      <div class="fgrid">
        ${timeBtnHtml('h_pref_deb','enr01','Heure début',true)}
        ${tpHtml('t_pref_deb','enr01',[60,63,70,80,100],'T°C début')}
        ${timeBtnHtml('h_pref_fin','enr01','Heure fin',false)}
        ${tpHtml('t_pref_fin','enr01',TP_ALL,'T°C fin')}
        ${compEl({id:'duree_pre',label:'Durée pré-refroid.'},'enr01')}
      </div>
    </div>`:
    preAnswered?`<div style="background:#f0fdf4;border-radius:10px;padding:10px 14px;margin-bottom:10px;font-size:.82rem;color:#166534;font-weight:700">✓ Passage direct au refroidissement (sans pré-refroidissement)</div>`:
    '';

  return`
    <div class="card">
      <div class="card-title">❄️ Refroidissement <span class="tag ccp">CCP</span></div>
      <div class="regle"><strong>+63°C → +10°C en moins de 2h.</strong> Si non conforme : <strong>JETER + fiche NC.</strong><br>Durée et conformité calculées automatiquement dès saisie des heures et températures.</div>
      <div id="ccp-timer-enr01"></div>
      <div class="fg-label">Nouvelle saisie</div>
      <div class="fgrid">
        ${inpEl({id:'date',label:'Date',inputType:'date',autoDate:true},'enr01')}
        ${acHtml('produit','enr01','Libellé produit','Ex: Blanquette de veau')}
      </div>

      <!-- Question pré-refroidissement -->
      <div style="background:#f8f0f8;border-radius:12px;padding:12px 14px;margin-bottom:10px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="font-size:.88rem;font-weight:700;flex:1">🔵 Pré-refroidissement effectué ?</span>
        <div style="display:flex;gap:6px">
          <button class="cfb oui${isPre?' on':''}" style="min-width:80px;padding:10px" onclick="setPreRef('OUI',this)">✓ OUI</button>
          <button class="cfb non${draft.pre_ref==='NON'?' on':''}" style="min-width:80px;padding:10px" onclick="setPreRef('NON',this)">✗ NON</button>
        </div>
      </div>

      ${preSection}

      <!-- Refroidissement principal -->
      <div class="sec-block" style="border-color:#fbbf24;background:#fffbeb;">
        <div class="sec-block-title" style="color:#92400e">❄️ Refroidissement</div>
        <div class="fgrid">
          ${timeBtnHtml('h_ref_deb','enr01','Heure début',false)}
          ${tpHtml('t_ref_deb','enr01',TP_ALL,'T°C début')}
          ${timeBtnHtml('h_ref_fin','enr01','Heure fin',false)}
          ${tpHtml('t_ref_fin','enr01',TP_COLD,'T°C fin')}
          ${compEl({id:'duree',label:'Durée refroidissement'},'enr01')}
          ${cfEl({id:'conforme',label:'Couple T/T°C conforme ?'},'enr01')}
          ${chefSel('cuisinier','enr01','Cuisinier / Visa')}
        </div>
      </div>

      <div class="btn-row">
        <button class="btn-save" onclick="saveRow('enr01')">✅ Enregistrer</button>
        <button class="btn btn-sec" onclick="clearRow('enr01')">🔄 Effacer</button>
      </div>
    </div>
    ${renderENR01Histo()}`;
}
function setPreRef(val,el){
  sd('pre_ref',val,'enr01');
  el.parentElement.querySelectorAll('.cfb').forEach(b=>b.classList.toggle('on',b===el));
  goTo('enr01');
}

// ════════════════════════════════════════════════════
// ENR01 — HISTORIQUE AVEC STATUTS ET ACTIONS
// ════════════════════════════════════════════════════
function renderENR01Histo(){
  const lignes=(S['enr01']||{}).lignes||[];
  if(lignes.length===0)return`<div class="card"><div class="empty-s">Aucune saisie enregistrée.</div></div>`;

  // Tri chronologique : plus récent en premier, mais affichage regroupé par date
  const sorted=[...lignes.map((r,i)=>({...r,_orig:i}))].sort((a,b)=>{
    const da=a.date||'',db=b.date||'';
    if(da!==db)return db.localeCompare(da);
    return(b.h_ref_fin||b.h_ref_deb||'').localeCompare(a.h_ref_fin||a.h_ref_deb||'');
  });

  const stBadge=s=>{
    if(!s||s==='en_attente')return`<span class="st-badge st-attente">🟡 En attente</span>`;
    if(s==='servi_froid')return`<span class="st-badge st-froid">🍽️ Servi froid</span>`;
    if(s==='rechauffe')return`<span class="st-badge st-chaud">🔥 Réchauffé → ENR03 créé</span>`;
    if(s==='rechauffe_remise')return`<span class="st-badge st-remise">🔄 Refroid.+Remise</span>`;
    return'';
  };
  // Badge BF pour afficher le lien de traçabilité (visible dans la carte)
  const bfBadge=r=>{
    const lien=r._lienBF||'';
    if(lien==='cuit')return`<span style="background:#dbeafe;color:#1565c0;border:1.5px solid #1565c0;border-radius:20px;padding:2px 9px;font-size:.67rem;font-weight:800">🥘 BF Cuit → ENR07</span>`;
    if(lien==='cru') return`<span style="background:#dcfce7;color:#166534;border:1.5px solid #166534;border-radius:20px;padding:2px 9px;font-size:.67rem;font-weight:800">🥗 BF Cru → ENR08</span>`;
    if(lien==='traite')return`<span style="background:#f0fdf4;color:#166534;border:1.5px solid #86efac;border-radius:20px;padding:2px 9px;font-size:.67rem;font-weight:800">✅ BF traité → ENR07 créé</span>`;
    return'';
  };

  const actionBtns=(r,orig)=>{
    if(r._statut&&r._statut!=='en_attente')return'';
    const timerKey='enr01_'+(r._ts||String(orig));
    const timerActive=!!_ccpTimers[timerKey];
    const timerBtn=timerActive
      ?`<button class="pcb" style="background:#fee2e2;border-color:#fca5a5;color:#991b1b" onclick="event.stopPropagation();ccpTimerArreter('${timerKey}')">⏹ Arrêter minuterie</button>`
      :`<button class="pcb" style="background:#f0fdf4;border-color:#86efac;color:#166534" onclick="event.stopPropagation();ccpTimerLancer('${timerKey}',120)">⏱️ Lancer minuterie 2h</button>`;
    const lienBF=r._lienBF||'';
    const bfCuitBtnA=`<button class="pcb" style="background:${lienBF==='cuit'?'#1565c0':'#e3f2fd'};color:${lienBF==='cuit'?'#fff':'#1565c0'};border:1.5px solid #1565c0" onclick="event.stopPropagation();lierRefroid(${orig},'cuit')" title="Lier à Bien Fait Cuit (ENR07) — bloque mixage chaud">${lienBF==='cuit'?'✅':'🔗'} BF Cuit</button>`;
    const bfCruBtnA=`<button class="pcb" style="background:${lienBF==='cru'?'#2e7d32':'#e8f5e9'};color:${lienBF==='cru'?'#fff':'#2e7d32'};border:1.5px solid #2e7d32" onclick="event.stopPropagation();lierRefroid(${orig},'cru')" title="Lier à BF Cru / TM sans cuisson (ENR08)">${lienBF==='cru'?'✅':'🔗'} BF Cru</button>`;
    return`<div class="pending-btns" style="margin-top:8px">
      <button class="pcb pcb-chaud" onclick="event.stopPropagation();lancerENR02(${orig})">🔥 Réchauffer</button>
      <button class="pcb pcb-remise" onclick="event.stopPropagation();lancerENR03(${orig})">🔄 Refroid.+Remise</button>
      <button class="pcb pcb-froid" onclick="event.stopPropagation();serviFroid01(${orig})">🍽️ Servi froid</button>
      ${timerBtn}
      ${bfCuitBtnA}
      ${bfCruBtnA}
    </div>`;
  };

  const nb=lignes.length;
  const _tsTraites01 = new Set();
  (S['enr02']?.lignes||[]).forEach(r=>{ if(r._enr01_ts) _tsTraites01.add(r._enr01_ts); });
  (S['enr03']?.lignes||[]).forEach(r=>{ if(r._enr01_ts) _tsTraites01.add(r._enr01_ts); });
  const nbAttente=lignes.filter(r=>{
    if(r._statut && r._statut!=='en_attente') return false;
    if(r._ts && _tsTraites01.has(r._ts)) return false;
    // destination filter retiré
    return true;
  }).length;

  const cards=sorted.map((r)=>{
    const orig=r._orig;
    const prod=r.produit||'—';
    const date=r.date||'';
    const heure=r.h_ref_fin||r.h_ref_deb||'';
    const tFin=r.t_ref_fin!==undefined&&r.t_ref_fin!==''?`→ ${r.t_ref_fin}°C`:'';
    const conf=r.conforme==='OUI'?'<span class="bo oui" style="font-size:.65rem">✓ Conforme</span>':r.conforme==='NON'?'<span class="bo non" style="font-size:.65rem">✗ NC</span>':'';

    // Data grid pour le détail
    const dataKeys=Object.keys(r).filter(k=>!['_ts','_sec','_orig','_statut','_enr01_idx','_enr01_ts'].includes(k)&&r[k]&&String(r[k]).trim());
    const grid=dataKeys.map(k=>{
      const lbl=FLAB[k]||k;const val=String(r[k]);
      const isT=IS_TEMP_FID(k)&&val!=='OUI'&&val!=='NON';
      const isC=IS_CONF_FID(k);
      const cls=isC?(val==='OUI'?'conf-oui':val==='NON'?'conf-non':''):'';
      return`<div class="hdi"><div class="hdi-label">${lbl}</div><div class="hdi-val ${cls}">${isT?val+'°C':val}</div></div>`;
    }).join('');

    return`<div class="hr-card">
      <div class="hr-card-top" onclick="toggleHR(this)">
        <div style="flex:1;min-width:0">
          <div class="hr-card-main">${escH(prod)}</div>
          <div class="hr-card-meta">${date}${heure?' · ⏰ '+heure:''}${tFin?' · '+tFin:''} ${conf}</div>
          <div style="margin-top:5px;display:flex;flex-wrap:wrap;gap:5px;align-items:center">
            ${stBadge(r._statut)}
            ${bfBadge(r)}
            <button onclick="event.stopPropagation();etiq33FromENR01(${orig})"
              style="display:inline-flex;align-items:center;gap:4px;font-size:.68rem;font-weight:800;padding:3px 9px;border-radius:20px;background:#fef9c3;border:1.5px solid #ca8a04;color:#78350f;cursor:pointer;font-family:inherit;white-space:nowrap">
              🍱 Témoin
            </button>
            <button onclick="event.stopPropagation();etiq34FromENR01(${orig})"
              style="display:inline-flex;align-items:center;gap:4px;font-size:.68rem;font-weight:800;padding:3px 9px;border-radius:20px;background:#f3e8f3;border:1.5px solid var(--plum);color:var(--plum);cursor:pointer;font-family:inherit;white-space:nowrap">
              🏷️ Étiq.
            </button>
          </div>
          ${actionBtns(r,orig)}
        </div>
        <div style="display:flex;gap:4px;align-items:flex-start;flex-shrink:0">

          <span class="hr-expand">▼</span>
        </div>
      </div>
      <div class="hr-card-data"><div class="hr-data-grid">${grid}</div></div>
    </div>`;
  }).join('');

  return`<div class="card">
    <div class="hh">
      <span class="hh-title">📜 Historique des refroidissements</span>
      <span class="hh-badge">${nb} saisie${nb!==1?'s':''}</span>
      ${nbAttente>0?`<span class="st-badge st-attente">${nbAttente} en attente</span>`:''}
    </div>
    ${cards}
  </div>`;
}

// ── Actions depuis ENR01 ──────────────────────────────────────
function serviFroid01(idx){
  S['enr01']=S['enr01']||{};
  S['enr01'].lignes[idx]._statut='servi_froid';
  try { SupaEngine.enqueue('enr01', S['enr01'].lignes[idx]); } catch(e){}
  save();goTo('enr01');
  toast('🍽️ Marqué servi froid','success');
}
function lancerENR02(idx){
  const r=S['enr01'].lignes[idx];
  S['enr02']=S['enr02']||{};
  S['enr02'].draft={
    produit:r.produit||'',
    date:today(),
    _enr01_idx:idx,
    _enr01_ts:r._ts||'',
  };
  save();goTo('enr02');
  toast('🔥 Produit chargé — complétez la remise en T°C','success');
}
function lancerENR03(idx){
  const r=S['enr01'].lignes[idx];
  S['enr03']=S['enr03']||{};
  S['enr03'].draft={
    produit:r.produit||'',
    date:r.date||today(),
    h1:r.h_ref_deb||'',t1:r.t_ref_deb||'',
    h2:r.h_ref_fin||'',t2:r.t_ref_fin||'',
    _enr01_idx:idx,
    _enr01_ts:r._ts||'',
  };
  save();goTo('enr03');
  toast('🔄 Refroidissement chargé — complétez la remise','success');
}

// ── Bloc "produits en attente" affiché en haut de ENR02 et ENR03 ─
function pendingENR01Block(cible){
  const _now48h = Date.now() - 48*60*60*1000;
  const _tsTraites = new Set();
  (S['enr02']?.lignes||[]).forEach(r=>{ if(r._enr01_ts) _tsTraites.add(r._enr01_ts); });
  (S['enr03']?.lignes||[]).forEach(r=>{ if(r._enr01_ts) _tsTraites.add(r._enr01_ts); });
  const pending=(S['enr01']?.lignes||[])
    .map((r,i)=>({...r,_orig:i}))
    .filter(r=>{
      if(r._statut && r._statut!=='en_attente') return false;
      if(r._ts && _tsTraites.has(r._ts)) return false;
      if(r.destination==='servi_froid') return false;
      const ts = r._ts ? new Date(r._ts).getTime() : (r.date ? new Date(r.date+'T12:00').getTime() : 0);
      return ts >= _now48h;
    })
    .sort((a,b)=>{
      const da=a.date||'',db=b.date||'';
      if(da!==db)return da.localeCompare(db); // plus ancien en premier
      return(a.h_ref_fin||a.h_ref_deb||'').localeCompare(b.h_ref_fin||b.h_ref_deb||'');
    });
  if(pending.length===0)return'';
  const fn=cible==='enr02'?'lancerENR02':'lancerENR03';
  const label=cible==='enr02'?'🔥 Sélectionner pour réchauffer':'🔄 Sélectionner pour Refroid.+Remise';
  const items=pending.map(r=>{
    const tFin=r.t_ref_fin!==undefined&&r.t_ref_fin!==''?` · ${r.t_ref_fin}°C`:'';
    const heure=r.h_ref_fin||r.h_ref_deb||'';
    return`<div class="pending-item">
      <div class="pending-info">
        <div class="pending-name">${escH(r.produit||'—')}</div>
        <div class="pending-meta">${r.date||'?'}${heure?' · ⏰ '+heure:''}${tFin}</div>
      </div>
      <button class="pcb ${cible==='enr02'?'pcb-chaud':'pcb-remise'}" onclick="${fn}(${r._orig})">${label}</button>
    </div>`;
  }).join('');
  return`<div class="pending-block">
    <div class="pending-title">⬇️ ${pending.length} refroidissement${pending.length>1?'s':''} en attente — cliquez pour pré-remplir</div>
    ${items}
  </div>`;
}

// ════════════════════════════════════════════════════
// FORM DEFINITIONS
// ════════════════════════════════════════════════════
const FDEFS={
  enr02:{id:'enr02',title:'🔥 Remise en température',tag:'CCP',tagCat:'ccp',
    regle:'Départ <strong>≤ +10°C</strong>, arrivée <strong>≥ +63°C en moins de 1h.</strong> Si NC : <strong>JETER + fiche NC.</strong>',
    fields:[
      {id:'date',label:'Date',inputType:'date',autoDate:true},
      {id:'produit',label:'Libellé produit',type:'prod',ph:'Ex: Gratin dauphinois'},
      {id:'h_deb',label:'Heure début',type:'time',autoTime:true},
      {id:'t_deb',label:'T°C départ (doit être ≤ +10°C)',type:'temp',presets:TP_COLD},
      {id:'conf_deb',label:'Départ ≤ +10°C ? (auto)',type:'conf',auto:true},
      {id:'h_fin',label:'Heure fin',type:'time'},
      {id:'t_fin',label:'T°C fin (doit être ≥ +63°C)',type:'temp',presets:[60,63,70,80]},
      {id:'duree',label:'Durée (auto)',computed:true},
      {id:'conforme',label:'Couple T/T°C conforme ?',type:'conf',auto:true},
      {id:'cuisinier',label:'Cuisinier / Visa',type:'chef'},
    ]},
  enr03:{id:'enr03',title:'🔄 Refroidissement + Remise T°C',tag:'CCP',tagCat:'ccp',
    regle:'Refroid. : +63°C→+10°C en &lt;2h. Remise : +10°C→+63°C en &lt;1h.',
    fields:[
      {id:'date',label:'Date',inputType:'date',autoDate:true},{id:'produit',label:'Produit',type:'prod'},
      {id:'h1',label:'Refroid. Heure début',type:'time',autoTime:true},{id:'t1',label:'Refroid. T°C début',type:'temp',presets:[60,63,70]},
      {id:'h2',label:'Refroid. Heure fin',type:'time'},{id:'t2',label:'Refroid. T°C fin',type:'temp',presets:TP_COLD},
      {id:'duree_r',label:'Durée refroid. (auto)',computed:true},{id:'conf_r',label:'Refroid. conforme ?',type:'conf',auto:true},
      {id:'h3',label:'Remise Heure début',type:'time'},{id:'t3',label:'Remise T°C départ (≤ +10°C)',type:'temp',presets:TP_COLD},{id:'conf_t3',label:'Départ remise ≤ +10°C ? (auto)',type:'conf',auto:true},
      {id:'h4',label:'Remise Heure fin',type:'time'},{id:'t4',label:'Remise T°C fin',type:'temp',presets:[60,63,70]},
      {id:'duree_rt',label:'Durée remise (auto)',computed:true},{id:'conf_rt',label:'Remise T°C conforme ?',type:'conf',auto:true},
      {id:'cuisinier',label:'Cuisinier / Visa',type:'chef'},
    ]},
  enr04:{id:'enr04',title:'🥩 Cuisson – Steaks hachés',tag:'PrPo',tagCat:'prpo',
    regle:'T°C cible : <strong>≥ +65°C à cœur.</strong> Si &lt;+65°C : continuer la cuisson ou jeter.',
    fields:[
      {id:'date',label:'Date',inputType:'date',autoDate:true},
      {id:'h',label:'Heure fin cuisson',type:'time',autoTime:true},
      {id:'tc',label:'T°C à cœur',type:'temp',presets:[60,63,65,70,75,80]},
      {id:'conforme',label:'T°C ≥ +65°C ? (auto)',type:'conf',auto:true},
      {id:'cuisinier',label:'Cuisinier / Visa',type:'chef'},
    ]},
  enr05:{id:'enr05',title:'🍟 Huiles de friture (sans testeur)',tag:'PrPo',tagCat:'prpo',
    regle:"Filtrer après chaque utilisation. Changer après pané/poisson ou après <strong>8 utilisations.</strong>",
    fields:[{id:'date',label:'Date',inputType:'date',autoDate:true},{id:'friteuse',label:'Friteuse n°',inputType:'number',ph:'1'},
      {id:'filtre',label:'Huile filtrée ?',type:'conf'},{id:'change',label:'Huile changée ?',type:'conf'},
      {id:'cuisinier',label:'Cuisinier / Visa',type:'chef'}]},
  enr06:{id:'enr06',title:'🍟 Huiles de friture (avec testeur)',tag:'PrPo',tagCat:'prpo',
    regle:"Filtrer et tester après chaque utilisation.",
    fields:[{id:'date',label:'Date',inputType:'date',autoDate:true},{id:'friteuse',label:'Friteuse n°',inputType:'number',ph:'1'},
      {id:'conf_test',label:'Test conforme ?',type:'conf'},{id:'filtre',label:'Filtrée ?',type:'conf'},{id:'change',label:'Changée ?',type:'conf'},
      {id:'cuisinier',label:'Cuisinier / Visa',type:'chef'}]},
  enr07:{id:'enr07',title:'🥘 Bien Faits – avec cuisson',tag:'PrPo',tagCat:'prpo',
    regle:'<strong>Froid :</strong> Mixage ≤+3°C, max 10 min, cuisson ≥+75°C. <strong>Chaud :</strong> Mixage ≥+63°C début et fin, cuisson ≥+75°C.',
    fields:[]},
  enr08:{id:'enr08',title:'🥗 TM / Bien Faits – sans cuisson',tag:'PrPo',tagCat:'prpo',
    regle:'Mixage froid : T°C ≤+3°C début, ≤+6°C fin. Durée max 10 min.',
    fields:[{id:'date',label:'Date',inputType:'date',autoDate:true},{id:'produit',label:'Produit',type:'prod'},
      {id:'h1',label:'Heure début',type:'time',autoTime:true},{id:'t1',label:'T°C début',type:'temp',presets:TP_MIX_FROID},{id:'conf1',label:'Début ≤3°C ? (auto)',type:'conf',auto:true},
      {id:'h2',label:'Heure fin',type:'time'},{id:'t2',label:'T°C fin',type:'temp',presets:TP_MIX_FROID},{id:'duree',label:'Durée (auto)',computed:true},{id:'conf_duree',label:'Durée ≤10min ? (auto)',type:'conf',auto:true},
      {id:'conf2',label:'Fin ≤6°C ? (auto)',type:'conf',auto:true},{id:'cuisinier',label:'Cuisinier / Visa',type:'chef'}]},
  enr09:{id:'enr09',title:'♨️ Conditionnement à chaud',tag:'PrPo',tagCat:'prpo',
    regle:'T°C ≥+63°C début et fin. Sinon → <strong>JETER + fiche NC.</strong>',
    fields:[{id:'date',label:'Date',inputType:'date',autoDate:true},{id:'produit',label:'Produit',type:'prod'},
      {id:'t_debut',label:'T°C début',type:'temp',presets:[60,63,70,80]},{id:'conf_debut',label:'Début ≥63°C ? (auto)',type:'conf',auto:true},
      {id:'t_fin',label:'T°C fin',type:'temp',presets:[60,63,70,80]},{id:'conf_fin',label:'Fin ≥63°C ? (auto)',type:'conf',auto:true},
      {id:'cuisinier',label:'Cuisinier / Visa',type:'chef'}]},
  enr10:{id:'enr10',title:'🧊 Conditionnement à froid',tag:'PrPo',tagCat:'prpo',
    regle:'T°C ≤+3°C. Si &gt;+6°C → <strong>JETER.</strong>',
    fields:[{id:'date',label:'Date',inputType:'date',autoDate:true},{id:'produit',label:'Produit',type:'prod'},
      {id:'t_debut',label:'T°C début',type:'temp',presets:TP_COLD},{id:'conf_debut',label:'Début ≤3°C ? (auto)',type:'conf',auto:true,auto:true},
      {id:'h_ref_deb',label:'Refroid. Heure début',type:'time'},{id:'t_ref_deb',label:'T°C refroid. deb',type:'temp',presets:TP_COLD},
      {id:'h_ref_fin',label:'Refroid. Heure fin',type:'time'},{id:'t_ref_fin',label:'T°C refroid. fin',type:'temp',presets:TP_COLD},
      {id:'conf_couple',label:'Couple ≤2h ? (auto)',type:'conf',auto:true},{id:'t_fin',label:'T°C fin',type:'temp',presets:TP_COLD},{id:'conf_fin',label:'Fin ≤6°C ? (auto)',type:'conf',auto:true},
      {id:'cuisinier',label:'Cuisinier / Visa',type:'chef'}]},
  enr11:{id:'enr11',title:'🍽️ Chaîne plateaux – froid',tag:'PrPo',tagCat:'prpo',
    regle:'T°C ≤+3°C. Si &gt;+6°C → JETER.',
    fields:[{id:'date',label:'Date',inputType:'date',autoDate:true},{id:'chariot',label:'Chariot n°',inputType:'number'},{id:'produit',label:'Produit',type:'prod'},
      {id:'t_premier',label:'T°C 1er plateau',type:'temp',presets:TP_COLD},{id:'conf_premier',label:'1er ≤3°C ? (auto)',type:'conf',auto:true},
      {id:'h_ref_deb',label:'Refroid. Heure début',type:'time'},{id:'t_ref_deb',label:'T°C refroid. deb',type:'temp',presets:TP_COLD},
      {id:'h_ref_fin',label:'Refroid. Heure fin',type:'time'},{id:'t_ref_fin',label:'T°C refroid. fin',type:'temp',presets:TP_COLD},
      {id:'conf_couple',label:'Couple ≤2h ? (auto)',type:'conf',auto:true},{id:'cuisinier',label:'Cuisinier / Visa',type:'chef'}]},
  enr12:{id:'enr12',title:'🍽️ Chaîne plateaux – chaud',tag:'PrPo',tagCat:'prpo',
    regle:'T°C ≥+63°C. Sinon JETER + fiche NC.',
    fields:[{id:'date',label:'Date',inputType:'date',autoDate:true},{id:'chariot',label:'Chariot n°',inputType:'number'},{id:'type',label:'Type plat'},
      {id:'t_premier',label:'T°C 1er plateau',type:'temp',presets:[60,63,70,80]},{id:'conf_premier',label:'1er ≥63°C ? (auto)',type:'conf',auto:true},
      {id:'h_ref_deb',label:'Heure début',type:'time'},{id:'t_ref_deb',label:'T°C début',type:'temp',presets:[60,63,70]},{id:'conf_couple',label:'Couple ≥63°C ? (auto)',type:'conf',auto:true},
      {id:'cuisinier',label:'Cuisinier / Visa',type:'chef'}]},
  enr13:{id:'enr13',title:'🚚 Départ cuisine',tag:'PrPo',tagCat:'prpo',
    regle:'Froid ≤+10°C. Chaud ≥+63°C.',
    fields:[{id:'date',label:'Date',inputType:'date',autoDate:true},{id:'heure',label:'Heure',type:'time',autoTime:true},
      {id:'etage',label:'Salle/Étage'},{id:'type',label:'Type',type:'select',opts:['Froid','Chaud']},{id:'produit',label:'Libellé produit',type:'prod'},
      {id:'tc',label:'T°C',type:'temp',presets:TP_ALL},{id:'conforme',label:'Conforme ? (auto)',type:'conf',auto:true},{id:'cuisinier',label:'Cuisinier / Visa',type:'chef'}]},
  enr14:{id:'enr14',title:'🛎️ Distribution plateaux',tag:'PrPo',tagCat:'prpo',
    regle:'Froid ≤+10°C. Chaud ≥+63°C.',
    fields:[{id:'date',label:'Date',inputType:'date',autoDate:true},{id:'chariot',label:'Chariot'},{id:'type',label:'Type',type:'select',opts:['Froid','Chaud']},{id:'produit',label:'Libellé produit',type:'prod'},
      {id:'h_prem',label:'Heure 1er',type:'time',autoTime:true},{id:'t_prem',label:'T°C 1er',type:'temp',presets:TP_ALL},{id:'conf_prem',label:'1er conf. ? (auto)',type:'conf',auto:true},
      {id:'h_dern',label:'Heure dernier',type:'time'},{id:'t_dern',label:'T°C dernier',type:'temp',presets:TP_ALL},{id:'conf_dern',label:'Dernier conf. ? (auto)',type:'conf',auto:true},
      {id:'cuisinier',label:'Cuisinier / Visa',type:'chef'}]},
  enr15:{id:'enr15',title:'🏠 Distribution SAM',tag:'PrPo',tagCat:'prpo',
    regle:'Froid ≤+3°C début. Chaud ≥+63°C.',
    fields:[{id:'date',label:'Date',inputType:'date',autoDate:true},{id:'type',label:'Type',type:'select',opts:['Froid','Chaud']},{id:'produit',label:'Libellé plat',type:'prod'},
      {id:'h_deb',label:'Heure début',type:'time',autoTime:true},{id:'t_deb',label:'T°C début',type:'temp',presets:TP_ALL},{id:'conf_deb',label:'Début conf. ? (auto)',type:'conf',auto:true},
      {id:'h_fin',label:'Heure fin',type:'time'},{id:'t_fin',label:'T°C fin',type:'temp',presets:TP_ALL},{id:'conf_fin',label:'Fin conf. ? (auto)',type:'conf',auto:true},
      {id:'cuisinier',label:'Cuisinier / Visa',type:'chef'}]},
  enr16:{id:'enr16',title:'🍴 Distribution Self',tag:'PrPo',tagCat:'prpo',
    regle:'Froid ≤+10°C. Chaud ≥+63°C.',
    fields:[{id:'date',label:'Date',inputType:'date',autoDate:true},{id:'type',label:'Type',type:'select',opts:['Froid','Chaud']},{id:'produit',label:'Libellé plat',type:'prod'},
      {id:'h_deb',label:'Heure début',type:'time',autoTime:true},{id:'t_deb',label:'T°C début',type:'temp',presets:TP_ALL},{id:'conf_deb',label:'Début conf. ? (auto)',type:'conf',auto:true},
      {id:'h_fin',label:'Heure fin',type:'time'},{id:'t_fin',label:'T°C fin',type:'temp',presets:TP_ALL},{id:'conf_fin',label:'Fin conf. ? (auto)',type:'conf',auto:true},
      {id:'cuisinier',label:'Cuisinier / Visa',type:'chef'}]},
  enr17:{id:'enr17',title:'🚐 Livraison froide',tag:'PrPo',tagCat:'prpo',
    regle:'T°C ≤+3°C (tol. ≤+6°C). Si &gt;+6°C : JETER.',
    fields:[{id:'date',label:'Date',inputType:'date',autoDate:true},{id:'heure',label:'Heure',type:'time',autoTime:true},
      {id:'tournee',label:'Tournée'},{id:'satellite',label:'Nom satellite'},{id:'produit',label:'Libellé produit',type:'prod'},
      {id:'tc',label:'T°C produit',type:'temp',presets:TP_COLD},{id:'conforme',label:'Conforme ≤+6°C ? (auto)',type:'conf',auto:true},
      {id:'cuisinier',label:'Visa chauffeur',type:'chef'}]},
  enr18:{id:'enr18',title:'🚐 Livraison chaude',tag:'PrPo',tagCat:'prpo',
    regle:'Froid ≤+6°C. Chaud ≥+63°C.',
    fields:[{id:'date',label:'Date',inputType:'date',autoDate:true},{id:'heure',label:'Heure',type:'time',autoTime:true},
      {id:'tournee',label:'Tournée'},{id:'satellite',label:'Satellite'},{id:'type',label:'Type',type:'select',opts:['Froid','Chaud']},{id:'produit',label:'Produit',type:'prod'},
      {id:'tc',label:'T°C',type:'temp',presets:TP_ALL},{id:'conforme',label:'Conforme ? (auto)',type:'conf',auto:true},{id:'cuisinier',label:'Visa chauffeur',type:'chef'}]},
  enr23:{id:'enr23',title:'📦 Contrôle à réception',tag:'PrPo',tagCat:'prpo',
    regle:'Au moins <strong>2 produits par livraison.</strong> T°C ≤ consigne. Emballage, étiquetage, qualité OK.',
    fields:[]}, // Géré par renderer custom
  enr26:{id:'enr26',title:'🌡️ Contrôle des thermomètres',tag:'',tagCat:'',
    regle:"Écart ≤ ±1°C : OK. Écart &gt; ±1°C : remplacer.",
    fields:[{id:'date',label:'Date',inputType:'date',autoDate:true},{id:'num',label:'N° thermomètre'},{id:'zone',label:"Zone d'affectation"},
      {id:'ecart',label:'Écart mesuré (°C)',type:'temp',presets:[-2,-1,0,1,2]},{id:'conf',label:'Conforme ≤ ±1°C ? (auto)',type:'conf',auto:true},
      {id:'cuisinier',label:'Cuisinier / Visa',type:'chef'}]},
  enr27:{id:'enr27',title:'📊 Contrôle afficheurs enceintes',tag:'',tagCat:'',
    regle:"Contrôler une fois par semaine. Écart &gt; ±1°C : maintenance.",
    fields:[{id:'date',label:'Date',inputType:'date',autoDate:true},{id:'enceinte',label:'Nom enceinte froide'},
      {id:'t_ext',label:'T°C afficheur ext.',type:'temp',presets:TP_COLD},{id:'t_int',label:'T°C thermomètre int.',type:'temp',presets:TP_COLD},
      {id:'ecart',label:'Écart mesuré (auto)',computed:true},{id:'conf',label:'Conforme ≤ ±1°C ? (auto)',type:'conf',auto:true},
      {id:'cuisinier',label:'Cuisinier / Visa',type:'chef'}]},
  enr29:{id:'enr29',title:'👥 Sensibilisations du personnel',tag:'',tagCat:'',
    regle:'Enregistrer chaque session de formation.',
    fields:[{id:'date',label:'Date',inputType:'date',autoDate:true},{id:'theme',label:'Thème',full:true},
      {id:'duree',label:'Durée'},{id:'responsable',label:'Responsable'},{id:'participants',label:'Participants',type:'textarea',rows:3}]},
  enr31:{id:'enr31',title:'📋 Traçabilité des matières premières',tag:'',tagCat:'',
    regle:'Une étiquette par lot. Archiver 1 mois.',
    fields:[
      {id:'date',label:'Date dernière utilisation',inputType:'date',autoDate:true},
      {id:'produit',label:'Nom du produit',type:'prod'},
      {id:'lot',label:'N° de lot'},
      {id:'dlc',label:'DLC / DDM',inputType:'date'},
      {id:'estampille',label:'Estampille sanitaire',ph:'Ex: FR 65 143 001 CE'},
      {id:'cuisinier',label:'Cuisinier / Visa',type:'chef'}
    ]},
  enr32:{id:'enr32',title:'⚠️ Suspicion de TIAC',tag:'',tagCat:'',
    regle:'Informer <strong>immédiatement</strong> responsable ET Service Qualité.',
    fields:[{id:'date',label:'Date',inputType:'date',autoDate:true},{id:'consommateur',label:'Consommateur n°'},{id:'date_symp',label:'Date symptômes',inputType:'date'},
      {id:'type_symp',label:'Manifestations cliniques',type:'textarea',rows:2},{id:'plats',label:'Plats consommés',type:'textarea',rows:2},
      {id:'date_conso',label:'Date consommation',inputType:'date'},{id:'site',label:'Site'}]},
  enr33:{id:'enr33',title:'🍱 Plats témoins',tag:'ÉTIQUETTE',tagCat:'etiq',
    regle:'Conserver <strong>7 jours</strong> entre <strong>0°C et +3°C.</strong>',
    fields:[{id:'dt',label:'Date et heure',inputType:'datetime-local',autoDT:true},
      {id:'service',label:'Service',type:'select',opts:['Déjeuner','Dîner','Petit-déjeuner']},
      {id:'produit',label:'Nom du produit',type:'prod'},{id:'operateur',label:"Nom de l'opérateur",type:'chef'}]},
  enr34:{id:'enr34',title:'🏷️ Étiquettes de production',tag:'ÉTIQUETTE',tagCat:'etiq',
    regle:'Conserver entre 0°C et +3°C.',
    fields:[{id:'produit',label:'Nom du produit',type:'prod'},{id:'statut',label:'Statut',type:'select',opts:['Fabriqué','Entamé','Décongélation']},
      {id:'date_fab',label:'Date fabrication',inputType:'date',autoDate:true},{id:'heure_fab',label:'Heure',type:'time',autoTime:true},{id:'dlc',label:"À consommer jusqu'au",inputType:'date'}]},
  enr35:{id:'enr35',title:'🥩 Origine des viandes',tag:'ÉTIQUETTE',tagCat:'etiq',
    regle:'Bœuf, porc, ovin, volaille.',
    fields:[{id:'produit',label:'Nom du produit',type:'prod'},{id:'ne_eleve',label:'Né et élevé'},{id:'abattu',label:'Abattu'},{id:'origine',label:'Origine'}]},
  enr36:{id:'enr36',title:'♻️ Étiquettes excédents',tag:'ÉTIQUETTE',tagCat:'etiq',
    regle:'Conserver 0°C–+3°C ou ≥+63°C.',
    fields:[{id:'produit',label:'Nom du produit',type:'prod'},{id:'dlc',label:"À consommer jusqu'au",inputType:'date',autoDate:true},{id:'remise',label:'1ère remise en T°C ?',type:'conf'}]},
  enr39:{id:'enr39',title:'🧺 Pique-nique – départ cuisine',tag:'',tagCat:'',
    regle:'T°C ≤+3°C (tol. ≤+6°C). Si &gt;+6°C : JETER + menu substitution.',
    fields:[{id:'date',label:'Date',inputType:'date',autoDate:true},{id:'heure',label:'Heure',type:'time',autoTime:true},{id:'produit',label:'Libellé produit',type:'prod'},
      {id:'t_glac',label:'T°C glacière',type:'temp',presets:TP_COLD},{id:'conf_glac',label:'Glacière conf. ? (auto)',type:'conf',auto:true},
      {id:'t_prod',label:'T°C produit',type:'temp',presets:TP_COLD},{id:'conf_prod',label:'Produit conf. ? (auto)',type:'conf',auto:true},
      {id:'cuisinier',label:'Cuisinier / Visa',type:'chef'}]},
  enr52:{id:'enr52',title:'🌡️ Contrôle T°C excédents',tag:'PrPo',tagCat:'prpo',
    regle:'Froid : 0°C &lt; T°C ≤+3°C. Chaud : T°C ≥+63°C.',
    fields:[{id:'date',label:'Date',inputType:'date',autoDate:true},{id:'heure',label:'Heure',type:'time',autoTime:true},{id:'produit',label:'Libellé produit',type:'prod'},
      {id:'tc',label:'T°C',type:'temp',presets:TP_ALL},{id:'conforme',label:'Conforme ? (auto)',type:'conf',auto:true},{id:'cuisinier',label:'Cuisinier / Visa',type:'chef'}]},
  enr53:{id:'enr53',title:'🤝 Récépissé de don',tag:'',tagCat:'',
    regle:'Froid ≤+3°C. Chaud ≥+63°C.',
    fields:[{id:'date',label:'Date',inputType:'date',autoDate:true},{id:'heure',label:'Heure',type:'time',autoTime:true},{id:'association',label:"Nom de l'association"},
      {id:'prod_f',label:'Produit froid',type:'prod'},{id:'t_f',label:'T°C froid',type:'temp',presets:TP_COLD},{id:'conf_f',label:'Froid conf. ? (auto)',type:'conf',auto:true},
      {id:'prod_c',label:'Produit chaud',type:'prod'},{id:'t_c',label:'T°C chaud',type:'temp',presets:[60,63,75]},{id:'conf_c',label:'Chaud conf. ? (auto)',type:'conf'},
      {id:'dlc',label:'DLC',inputType:'date'},{id:'cuisinier',label:'Cuisinier / Visa',type:'chef'},{id:'visa_assoc',label:'Visa Association'}]},
  enr24:{id:'enr24',title:'🔧 Plan de maintenance équipements',tag:'',tagCat:'',
    regle:'Enregistrer chaque intervention sur les équipements (préventive, corrective, réglementaire).',
    fields:[
      {id:'date',label:'Date',inputType:'date',autoDate:true},
      {id:'equipement',label:'Équipement',full:true,ph:'Ex: Chambre froide positive, Four Rational, Lave-vaisselle…'},
      {id:'type_maint',label:'Type de maintenance',type:'select',opts:['Préventive','Corrective','Réglementaire','Vérification']},
      {id:'intervenant',label:'Intervenant / Société',ph:'Ex: Technicien froid, HACCP Service SAS…'},
      {id:'observations',label:'Travaux réalisés / Observations',type:'textarea',rows:3,ph:'Décrire les travaux, pièces remplacées, réglages…'},
      {id:'conforme',label:'Équipement opérationnel après intervention ?',type:'conf'},
      {id:'actions',label:'Actions à prévoir',type:'textarea',rows:2,ph:'Laisser vide si aucune action complémentaire'},
      {id:'cuisinier',label:'Cuisinier / Visa',type:'chef'}
    ]},
  enr25:{id:'enr25',title:'🔬 Plan de contrôle microbiologique',tag:'',tagCat:'',
    regle:'Enregistrer chaque prélèvement labo (surfaces, denrées, eau). Fréquence : trimestrielle minimum.',
    fields:[
      {id:'date',label:'Date du prélèvement',inputType:'date',autoDate:true},
      {id:'type_analyse',label:'Type analyse',type:'select',opts:['Surface','Denree alimentaire','Eau','Air ambiant']},
      {id:'zone_produit',label:'Zone / Produit analysé',full:true,ph:'Ex: Plan de travail central, Volaille crue, Robinet cuisine…'},
      {id:'laboratoire',label:'Laboratoire',ph:'Ex: Eurofins, LDA 22, Cofrac accrédité…'},
      {id:'reference',label:'N° de référence analyse',ph:'N° dossier labo'},
      {id:'resultats',label:'Résultats',type:'textarea',rows:3,ph:'Ex: Conforme aux critères CE 2073/2005. Flore totale < 100 UFC/cm²…'},
      {id:'conforme',label:'Résultats conformes ?',type:'conf'},
      {id:'actions',label:'Actions correctives (si non conforme)',type:'textarea',rows:2,ph:'Laisser vide si résultats conformes'},
      {id:'cuisinier',label:'Cuisinier / Visa',type:'chef'}
    ]},
};

// ════════════════════════════════════════════════════
// ════════════════════════════════════════════════════
// ENR19 — T°C Enceintes : saisie par card, grille à l'export
// ════════════════════════════════════════════════════

// Enceintes par défaut si rien configuré
const ENC_DEFAULT=[
  {id:'bof',label:'Enceinte BOF',type:'frigo',consigne:'0°C à +3°C'},
  {id:'viandes',label:'Viandes & Charcuteries',type:'frigo',consigne:'0°C à +3°C'},
  {id:'prod_finis',label:'Produits finis',type:'frigo',consigne:'0°C à +3°C'},
  {id:'fruits_leg',label:'Fruits & Légumes',type:'frigo',consigne:'+4°C à +8°C'},
  {id:'negative',label:'Enceinte Négative',type:'congelateur',consigne:'≤ -18°C'},
];

// Config par défaut appliquée aux nouveaux sites sans config Supabase
const DEFAULT_SITE_CONFIG = {
  distribServices: [
    {id:'midi', label:'Service Midi', ico:'🌞', midi_deb:'12:00', midi_fin:'13:30', soir_deb:'', soir_fin:''},
    {id:'soir', label:'Service Soir', ico:'🌙', midi_deb:'', midi_fin:'', soir_deb:'18:30', soir_fin:'20:00'},
  ],
  poubelles: [],
  chefs: [],
  theme: 'plum',
};

function applyDefaultConfigIfNeeded() {
  // Appliquer uniquement si distribServices est vide/null
  S.config = S.config || {};
  if (!S.config.distribServices || S.config.distribServices.length === 0) {
    S.config.distribServices = JSON.parse(JSON.stringify(DEFAULT_SITE_CONFIG.distribServices));
  }
  if (!S['enr19']?.enceintes || S['enr19'].enceintes.length === 0) {
    S['enr19'] = S['enr19'] || {};
    S['enr19'].enceintes = JSON.parse(JSON.stringify(ENC_DEFAULT));
  }
  save();
  if(typeof registerDistribSvcPages === 'function') registerDistribSvcPages();
}

function getEnceintes(){
  // Priorité : S.config.enceintes (remonte depuis Supabase via CONFIG_KEYS)
  // puis S['enr19'].enceintes (legacy local)
  // puis valeurs par défaut
  if (S.config?.enceintes && Array.isArray(S.config.enceintes) && S.config.enceintes.length) {
    // Miroir dans enr19 aussi pour compat ascendante avec le reste du code
    S['enr19'] = S['enr19'] || {};
    if (!S['enr19'].enceintes || S['enr19'].enceintes.length !== S.config.enceintes.length) {
      S['enr19'].enceintes = S.config.enceintes;
    }
    return S.config.enceintes;
  }
  return S['enr19']?.enceintes || JSON.parse(JSON.stringify(ENC_DEFAULT));
}
function saveEnceintes(list){
  S['enr19']=S['enr19']||{};
  S['enr19'].enceintes=list;
  // Miroir dans S.config.enceintes pour bénéficier du bridge cloud CONFIG_KEYS
  // → remonte automatiquement dans sites.config et sera lu par le dashboard + PDF
  S.config = S.config || {};
  S.config.enceintes = list;
  save();
  syncEnceinteConfig(list);  // legacy : sync vers pms_config aussi (si la table existe)
  if(typeof _saveConfigToSupabase==='function') _saveConfigToSupabase();
}

// ── Sync config enceintes → table pms_config ─────────────────
function syncEnceinteConfig(list){
  try{
    var c=JSON.parse(localStorage.getItem('haccp_supa_cfg_v1')||'{}');
    if(!c.url||!c.anonKey||!c.siteId)return;
    var token=c.userToken||c.anonKey;
    var payload={
      site_id:c.siteId,
      tenant_id:c.tenantId||null,
      type:'enceintes',
      data:list,
      updated_at:new Date().toISOString()
    };
    // Upsert via POST + Prefer: resolution=merge-duplicates
    fetch(c.url+'/rest/v1/pms_config',{
      method:'POST',
      headers:{
        'apikey':c.anonKey,
        'Authorization':'Bearer '+token,
        'Content-Type':'application/json',
        'Prefer':'resolution=merge-duplicates,return=minimal'
      },
      body:JSON.stringify(payload)
    }).then(function(r){
      if(r.ok) console.log('[HACCPro] Config enceintes synchronisée →',c.siteId);
    }).catch(function(){});
  }catch(e){}
}

// ── Resync ENR19 : envoie les saisies localStorage → Supabase ──
// Utile si les relevés ont été faits via le widget accueil avant la v10

// ════════════════════════════════════════════════════════════════
// MODE CANICULE — 3ème relevé T°C (après-midi) activable à distance
// ════════════════════════════════════════════════════════════════
function caniculeActive(){ return !!(S.config&&S.config.caniculeMode); }

async function checkCaniculeMode(){
  try{
    var c=JSON.parse(localStorage.getItem('haccp_supa_cfg_v1')||'{}');
    if(!c.url||!c.anonKey||!c.siteId)return;
    var token=c.userToken||c.anonKey;
    var res=await fetch(c.url+'/rest/v1/pms_config?site_id=eq.'+encodeURIComponent(c.siteId)+'&type=eq.canicule&select=data',{
      headers:{'apikey':c.anonKey,'Authorization':'Bearer '+token}
    });
    if(!res.ok)return;
    var data=await res.json();
    var active=!!(data&&data[0]&&data[0].data&&data[0].data.active);
    S.config=S.config||{};
    if(S.config.caniculeMode!==active){
      S.config.caniculeMode=active;
      save();
      if(active) toast('☀️ Mode Canicule activé — 3 relevés/jour requis','warning');
      else toast('✅ Mode Canicule désactivé — 2 relevés/jour','success');
      renderMain();
    }
  }catch(e){}
}

function resyncEnr19(){
  const saisies=(S['enr19']&&S['enr19'].saisies)||[];
  if(!saisies.length){toast('Aucune saisie ENR19 en mémoire','warning');return;}
  const encs=getEnceintes();
  let count=0;
  saisies.forEach(function(s){
    // Compléter les champs manquants avant envoi
    if(!s._ts) s._ts=s.date?new Date(s.date+'T'+(s.heure||'12:00')+':00').toISOString():new Date().toISOString();
    if(!s._sec) s._sec='enr19';
    if(!s.enc_label){
      var enc=encs.find(function(e){return e.id===s.enc_id;});
      if(enc) s.enc_label=enc.label;
    }
    if(!s.cuisinier&&s.by) s.cuisinier=s.by;
    try{ SupaEngine.enqueue('enr19',s); count++; }catch(e){}
  });
  save();
  toast('🔄 '+count+' relevé(s) ENR19 envoyés vers Supabase','success');
  setTimeout(function(){toast('✅ Synchro en cours — actualisez le dashboard dans 30s','success');},2500);
}

// Vérifie si la T°C est conforme selon le type d'enceinte
function encConforme(temp, consigne){
  if(temp===null||temp===undefined||temp==='')return null;
  const t=parseFloat(temp);if(isNaN(t))return null;
  if(!consigne||typeof consigne!=='string')return null; // ← FIX: consigne undefined crash
  // Normaliser : remplacer le tiret Unicode − (U+2212) par le tiret ASCII
  const c=consigne.replace(/−/g,'-').replace(/≤/g,'<=');
  // Consigne "≤ X" ou "<= X"
  if(c.includes('<=')|| c.includes('≤')){
    const max=parseFloat(c.replace(/.*[<=≤]\s*/,''));
    return isNaN(max)?null:t<=max;
  }
  // Consigne "X à Y"
  const m=c.match(/([-+]?\d+\.?\d*)\s*(?:°C|°|C)?\s*[àa]\s*([+\-]?\d+\.?\d*)/);
  if(m)return t>=parseFloat(m[1])&&t<=parseFloat(m[2]);
  return null;
}

function renderENR19(){
  const encs=getEnceintes();
  const todayStr=today();
  const saisies=(S['enr19']?.saisies||[]).filter(r=>r.date===todayStr);

  return`<div class="card" style="padding:13px 14px">
    <div class="card-title">🌡️ T°C Enceintes de stockage</div>
    <div class="regle" style="margin-bottom:8px">Relevé à l'ouverture et à la fermeture. NC → fiche Non-conformité.</div>
    <div style="font-size:.73rem;color:var(--gris2)">📅 Relevés du ${new Date().toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'})}</div>
  </div>
  ${encs.map(e=>{
    const rOuv=saisies.filter(r=>r.enc_id===e.id&&r.moment==='ouv').slice(-1)[0];
    const rFerm=saisies.filter(r=>r.enc_id===e.id&&r.moment==='ferm').slice(-1)[0];
    const cOuv=encConforme(rOuv?.temp, e.consigne);
    const cFerm=encConforme(rFerm?.temp, e.consigne);
    const cardCls=(!rOuv&&!rFerm)?'':((cOuv===false||cFerm===false)?'nc':'ok');
    const icon=e.type==='congelateur'?'🧊':'🧊';
    const ic=e.type==='congelateur'?'❄️':'🌡️';
    const valCls=v=>v===null?'empty':v?'ok':'nc';
    const dispTemp=r=>r?`${parseFloat(r.temp)>=0?'+':''}${parseFloat(r.temp).toFixed(1)}°C`:'—';
    return`<div class="enc-card ${cardCls}">
      <div class="enc-head">
        <span class="enc-icon">${ic}</span>
        <div style="flex:1">
          <div class="enc-name">${e.label}</div>
          <div class="enc-consigne">Consigne : ${e.consigne}</div>
        </div>
        ${cardCls==='nc'?'<span style="background:#fee2e2;color:#d32f2f;border-radius:8px;padding:3px 8px;font-size:.7rem;font-weight:800">⚠️ NC</span>':
          cardCls==='ok'?'<span style="background:#dcfce7;color:#16a34a;border-radius:8px;padding:3px 8px;font-size:.7rem;font-weight:800">✓ OK</span>':''}
      </div>
            <div class="enc-readings" id="enc-rd-${e.id}" style="grid-template-columns:1fr 1fr">
        <div class="enc-reading">
          <div class="enc-reading-label">🌅 Ouverture</div>
          <div class="enc-reading-val ${valCls(cOuv)}">${dispTemp(rOuv)}</div>
          ${rOuv?'<div style="font-size:.6rem;color:var(--gris2)">'+rOuv.heure+(rOuv.cuisinier?' · '+rOuv.cuisinier:'')+'</div>':''}
        </div>
        ${caniculeActive()?(function(){
          var rA=saisies.filter(function(r){return r.enc_id===e.id&&r.moment==='aprem';}).slice(-1)[0];
          var cA=rA?encConforme(rA.temp,e.consigne):null;
          var cls=cA===false?'nc':cA===true?'ok':'empty';
          return '<div class="enc-reading" style="border-left:2px solid #f59e0b;padding-left:6px">'
            +'<div class="enc-reading-label" style="color:#f59e0b">☀️ Après-midi</div>'
            +'<div class="enc-reading-val '+cls+'">'+dispTemp(rA)+'</div>'
            +(rA?'<div style="font-size:.6rem;color:var(--gris2)">'+rA.heure+(rA.cuisinier?' · '+rA.cuisinier:'')+'</div>':'')
            +'</div>';
        })():''}
        <div class="enc-reading">
          <div class="enc-reading-label">🌙 Fermeture</div>
          <div class="enc-reading-val ${valCls(cFerm)}">${dispTemp(rFerm)}</div>
          ${rFerm?'<div style="font-size:.6rem;color:var(--gris2)">'+rFerm.heure+(rFerm.cuisinier?' · '+rFerm.cuisinier:'')+'</div>':''}
        </div>
      </div></div>
      <div class="enc-btns">
        <button class="enc-btn ${cOuv===false?'nc':rOuv?'done':''}" onclick="openEncSaisie('${e.id}','ouv')">
          ${cOuv===false?'⚠️':rOuv?'✓':'+'} Ouverture
        </button>
        ${caniculeActive()?(()=>{const rA=saisies.filter(r=>r.date===todayStr&&r.enc_id===e.id&&r.moment==='aprem').slice(-1)[0];const cA=rA?encConforme(rA.temp,e.consigne):null;return `<button class="enc-btn ${cA===false?'nc':rA?'done':''}" onclick="openEncSaisie('${e.id}','aprem')" style="background:#ff9800;color:#fff">${cA===false?'⚠️':rA?'✓':'☀️'} Après-midi</button>`;})():''}
        <button class="enc-btn ${cFerm===false?'nc':rFerm?'done':''}" onclick="openEncSaisie('${e.id}','ferm')">
          ${cFerm===false?'⚠️':rFerm?'✓':'+'} Fermeture
        </button>
      </div>
    </div>`;
  }).join('')}`;
}

// ── Gradient adapté à la consigne ─────────────────────────
function _encGradient(tMin, tMax, consigne) {
  const R = tMax - tMin;
  const p = v => Math.max(0, Math.min(100, ((v - tMin) / R * 100))).toFixed(1);
  const RED = '#f87171', GREEN = '#34d399';
  const c = (consigne||'').replace(/−/g,'-').replace(/≤/g,'<=');
  const mMax = c.match(/<=\s*([-+]?\d+\.?\d*)/);
  if (mMax) {
    const pOk = p(parseFloat(mMax[1]));
    return `linear-gradient(to right, ${GREEN} 0%, ${GREEN} ${pOk}%, #fbbf24 ${Math.min(100,parseFloat(pOk)+4).toFixed(1)}%, ${RED} 100%)`;
  }
  const mRange = c.match(/([-+]?\d+\.?\d*)\s*(?:°C)?\s*[àa]\s*([-+]?\d+\.?\d*)/);
  if (mRange) {
    const p1 = parseFloat(p(parseFloat(mRange[1]))), p2 = parseFloat(p(parseFloat(mRange[2])));
    const t = 3;
    return `linear-gradient(to right, ${RED} 0%, ${RED} ${Math.max(0,p1-t).toFixed(1)}%, ${GREEN} ${p1.toFixed(1)}%, ${GREEN} ${p2.toFixed(1)}%, ${RED} ${Math.min(100,p2+t).toFixed(1)}%, ${RED} 100%)`;
  }
  return tMin < -10
    ? `linear-gradient(to right,#1e3a8a 0%,#3b82f6 50%,#60a5fa 80%,#a5f3fc 100%)`
    : `linear-gradient(to right,#60a5fa 0%,#34d399 40%,#fbbf24 80%,#f87171 100%)`;
}

// ── Badge live conformité ──────────────────────────────────
function _updateEncConfBadge(vn) {
  const el = document.getElementById('enc-conf-badge');
  if (!el || !_encSaisie.consigne) return;
  if (vn === null || isNaN(vn)) { el.innerHTML = ''; return; }
  const ok = encConforme(vn, _encSaisie.consigne);
  if (ok === null) { el.innerHTML = ''; return; }
  const disp = (vn>=0?'+':'')+vn.toFixed(1)+'°C';
  if (ok) {
    el.innerHTML = `<div style="background:#dcfce7;border:1.5px solid #86efac;border-radius:10px;padding:8px 12px;display:flex;align-items:center;gap:8px"><span style="font-size:1.1rem">✅</span><span style="font-size:.82rem;font-weight:900;color:#166534">${disp} — Conforme · consigne ${_encSaisie.consigne}</span></div>`;
  } else {
    el.innerHTML = `<div style="background:#fee2e2;border:1.5px solid #fca5a5;border-radius:10px;padding:8px 12px;display:flex;align-items:center;gap:8px"><span style="font-size:1.1rem">⚠️</span><span style="font-size:.82rem;font-weight:900;color:#991b1b">${disp} — HORS SEUIL · consigne ${_encSaisie.consigne}</span></div>`;
  }
}

// ── Slider température dédié enceintes (plage HACCP réduite) ─
function tpHtmlEnc(id, sec, label, tMin, tMax, presets){
  const tRange = tMax - tMin;
  const stored = gd(id, sec);
  const numV = (stored !== undefined && stored !== '' && !isNaN(parseFloat(stored)))
    ? parseFloat(stored) : null;
  const slV = numV !== null ? Math.max(tMin, Math.min(tMax, numV)) : tMin + tRange/2;
  const disp = numV !== null ? ((numV>=0?'+':'')+numV.toFixed(1)) : '—';

  const mid = Math.round((tMin+tMax)/2);
  const axisPts = [
    [tMin, (tMin>=0?'+':'')+tMin+'°'],
    [mid,  (mid>=0?'+':'')+mid+'°'],
    [tMax, (tMax>=0?'+':'')+tMax+'°']
  ];
  const grad = _encGradient(tMin, tMax, _encSaisie.consigne||'');

  const pct = v => ((v - tMin) / tRange * 100).toFixed(1) + '%';
  const axisH = axisPts.map(([t,l]) => `<span style="left:${pct(t)}">${l}</span>`).join('');
  const presetsH = presets.map(p =>
    `<button class="tp-pre${numV===p?' on':''}" onclick="onEncTP('${id}','${sec}',${p},${tMin},${tMax})">${p>=0?'+':''}${p}°C</button>`
  ).join('');

  if (numV !== null) setTimeout(() => _updateEncConfBadge(numV), 30);

  return `<div class="fg full">
    ${label ? `<label>${label}</label>` : ''}
    <div class="tp" id="tp-${id}-${sec}" style="--tp-grad:${grad}">
      <div class="tp-disp" id="td-${id}-${sec}" data-qt="e" data-qi="${id}" data-qs="${sec}" data-qn="${tMin}" data-qx="${tMax}" onclick="qtTap(this)" style="cursor:pointer">${disp}<sub>°C</sub></div>
      <div class="tp-wrap">
        <input type="range" class="tp-slider" id="ts-${id}-${sec}"
          min="${tMin}" max="${tMax}" step="0.1" value="${slV}"
          style="background:${grad}"
          oninput="onEncTS('${id}','${sec}',this.value,${tMin},${tMax})"
          onchange="onEncTS('${id}','${sec}',this.value,${tMin},${tMax})">
        <div class="tp-axis">${axisH}</div>
      </div>
      <div class="tp-manual"><span style="font-size:.74rem;color:#b89ab6;font-weight:700">Tap :</span><div id="tm-${id}-${sec}" class="qt-fake-inp" data-qt="e" data-qi="${id}" data-qs="${sec}" data-qn="${tMin}" data-qx="${tMax}" onclick="qtTap(this)">${numV!==null?(numV%1===0?numV.toFixed(0):numV.toFixed(1)):''}</div><span style="font-size:1rem;font-weight:800;color:var(--gris2)">°C</span></div>
      <div class="tp-presets">${presetsH}</div>
    </div>
  </div>`;
}
function onEncTS(id,sec,v,mn,mx){
  const vn=Math.max(mn,Math.min(mx,parseFloat(v)));
  sd(id,String(vn),sec);
  const disp=document.getElementById('td-'+id+'-'+sec);
  if(disp)disp.innerHTML=(vn>=0?'+':'')+(vn%1===0?vn.toFixed(0):vn.toFixed(1))+'<sub>°C</sub>';
  const sl=document.getElementById('ts-'+id+'-'+sec);
  if(sl)sl.value=vn;
  const mn2=document.getElementById('tm-'+id+'-'+sec);
  if(mn2) mn2.textContent=vn%1===0?vn.toFixed(0):vn.toFixed(1);
  document.querySelectorAll('#tp-'+id+'-'+sec+' .tp-pre').forEach(b=>{
    b.classList.toggle('on',parseFloat(b.textContent)===vn);
  });
  _updateEncConfBadge(vn);
}
function onEncTM(id,sec,v,mn,mx){
  const raw=v.replace(',','.');
  if(raw===''||raw==='-'||raw==='+') return;
  const vn=parseFloat(raw);
  if(isNaN(vn)) return;
  const clamped=Math.max(mn,Math.min(mx,vn));
  sd(id,String(vn),sec);
  const disp=document.getElementById('td-'+id+'-'+sec);
  if(disp)disp.innerHTML=(clamped>=0?'+':'')+clamped.toFixed(1)+'<sub>°C</sub>';
  const sl=document.getElementById('ts-'+id+'-'+sec);
  if(sl)sl.value=clamped;
  document.querySelectorAll('#tp-'+id+'-'+sec+' .tp-pre').forEach(b=>{
    const bv=parseFloat(b.textContent);b.classList.toggle('on',bv===clamped);
  });
  _updateEncConfBadge(vn);
}
function onEncTP(id,sec,p,mn,mx){onEncTS(id,sec,p,mn,mx);}

// ── Modale saisie enceinte ─────────────────────────────────
let _encSaisie={};
function openEncSaisie(encId, moment){
  const enc=getEnceintes().find(e=>e.id===encId);
  if(!enc)return;
  _encSaisie={encId,moment,consigne:enc.consigne,label:enc.label||encId};
  const _mLabel=moment==='ouv'?'🌅 Ouverture':moment==='aprem'?'☀️ Après-midi':'🌙 Fermeture';
  document.getElementById('enc-modal-title').textContent=enc.label+' — '+_mLabel;
  document.getElementById('enc-modal-sub').textContent=`Consigne : ${enc.consigne}`;
  // Plages HACCP adaptées au type
  const isConge = enc.type==='congelateur';
  const tMin = isConge ? -30 : -10;
  const tMax = isConge ? 5  : 25;
  const presets = isConge ? [-25,-22,-20,-18,-15] : [0,2,3,4,5,6,7,8,10,12,14];
  // Reset draft
  S['enc_modal']=S['enc_modal']||{};S['enc_modal'].draft={enc_temp:'',enc_chef:''};
  document.getElementById('enc-modal-tp').innerHTML=
    tpHtmlEnc('enc_temp','enc_modal','Température relevée', tMin, tMax, presets);
  // Chef
  document.getElementById('enc-modal-chef').innerHTML=
    chefSel('enc_chef','enc_modal','Cuisinier / Visa');
  document.getElementById('enc-ov').classList.add('open');
}
function closeEncSaisie(){
  document.getElementById('enc-ov').classList.remove('open');
  _encSaisie={};
}
function saveEncSaisie(){
  if(roCheck())return;
  const temp=(S['enc_modal']?.draft?.enc_temp)||'';
  const chef=(S['enc_modal']?.draft?.enc_chef)||'';
  if(temp===''||temp===undefined){toast('⚠️ Saisissez la température','warning');return;}
  const saisie={
    date:today(),heure:nowT(),
    enc_id:_encSaisie.encId,
    enc_label:_encSaisie.label||_encSaisie.encId,
    moment:_encSaisie.moment,
    temp:String(temp),
    cuisinier:chef,
    _ts:new Date().toISOString(),_sec:'enr19'
  };
  S['enr19']=S['enr19']||{};
  S['enr19'].saisies=S['enr19'].saisies||[];
  S['enr19'].saisies.unshift(saisie);
  save();
  // ── Supabase sync ──
  try { SupaEngine.enqueue('enr19', saisie); } catch(e){}
  const ok=encConforme(temp,_encSaisie.consigne);
  if(ok===false){
    appVibrate([300,100,300,100,300]);
    toast('⚠️ T°C hors seuil — NC créée automatiquement','warning');
    const _encLabel=_encSaisie.label||_encSaisie.encId||'Enceinte';
    const _tVal=(parseFloat(temp)>=0?'+':'')+parseFloat(temp).toFixed(1)+'°C';
    const _moment=_encSaisie.moment==='ouv'?'ouverture':'fermeture';
    const _desc='T°C enceinte hors seuil — '+_encLabel+' ('+_moment+') : '+_tVal+' — consigne '+_encSaisie.consigne;
    autoCreateNC('ENR19 – T°C Enceintes', _desc, _encLabel, '', {cause_matriel:'1', cause_milieu:'1'});
  } else {
    appVibrate([50]);
    autoBackup();
    toast('✅ Relevé enregistré','success');
  }
  closeEncSaisie();
  renderNav();
  renderMain();
}


// ════════════════════════════════════════════════════
// ENR20 — T°C Stockage CANICULE
// ════════════════════════════════════════════════════
function renderENR20(){
  var encs=getEnceintes();
  var todayStr=today();
  var saisies=((S['enr20']&&S['enr20'].saisies)||[]).filter(function(r){return r.date===todayStr;});
  var active=caniculeActive();

  var html='<div class="card" style="padding:13px 14px">'
    +'<div class="card-title">☀️ T°C Stockage — Plan Canicule</div>'
    +'<div class="regle" style="margin-bottom:8px">Relevés obligatoires : Ouverture · Midi · Fermeture. NC automatique si seuil dépassé.</div>'
    +(active
      ?'<div style="background:#fff7ed;border:1.5px solid #fed7aa;border-radius:10px;padding:8px 12px;font-size:.75rem;font-weight:700;color:#c2410c;margin-bottom:8px">☀️ MODE CANICULE ACTIF — 3 relevés obligatoires</div>'
      :'<div style="background:#f1f5f9;border:1.5px solid #cbd5e1;border-radius:10px;padding:8px 12px;font-size:.75rem;color:#64748b;margin-bottom:8px">ℹ️ Mode canicule non activé — saisie libre disponible</div>'
    )
    +'<div style="font-size:.73rem;color:var(--gris2)">📅 '+new Date().toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'})+'</div>'
    +'</div>';

  encs.forEach(function(e){
    var rOuv=saisies.filter(function(r){return r.enc_id===e.id&&r.moment==='ouv';}).slice(-1)[0];
    var rMidi=saisies.filter(function(r){return r.enc_id===e.id&&r.moment==='midi';}).slice(-1)[0];
    var rFerm=saisies.filter(function(r){return r.enc_id===e.id&&r.moment==='ferm';}).slice(-1)[0];
    var cOuv=encConforme(rOuv&&rOuv.temp,e.consigne);
    var cMidi=encConforme(rMidi&&rMidi.temp,e.consigne);
    var cFerm=encConforme(rFerm&&rFerm.temp,e.consigne);
    var anyNC=(cOuv===false||cMidi===false||cFerm===false);
    var allDone=!!(rOuv&&rMidi&&rFerm);
    var cardCls=(!rOuv&&!rMidi&&!rFerm)?'':(anyNC?'nc':'ok');
    var ic=e.type==='congelateur'?'❄️':'🌡️';
    var disp=function(r){return r?((parseFloat(r.temp)>=0?'+':'')+parseFloat(r.temp).toFixed(1)+'°C'):'—';};
    var valCls=function(c){return c===null?'empty':c?'ok':'nc';};

    html+='<div class="enc-card '+cardCls+'">'
      +'<div class="enc-head">'
        +'<span class="enc-icon">'+ic+'</span>'
        +'<div style="flex:1"><div class="enc-name">'+e.label+'</div><div class="enc-consigne">Consigne : '+e.consigne+'</div></div>'
        +(anyNC?'<span style="background:#fee2e2;color:#d32f2f;border-radius:8px;padding:3px 8px;font-size:.7rem;font-weight:800">⚠️ NC</span>'
          :allDone?'<span style="background:#dcfce7;color:#16a34a;border-radius:8px;padding:3px 8px;font-size:.7rem;font-weight:800">✓ OK</span>':'')
      +'</div>'
      +'<div class="enc-readings" style="grid-template-columns:1fr 1fr 1fr">'
        +'<div class="enc-reading"><div class="enc-reading-label">🌅 Ouverture</div>'
          +'<div class="enc-reading-val '+valCls(cOuv)+'">'+disp(rOuv)+'</div>'
          +(rOuv?'<div style="font-size:.6rem;color:var(--gris2)">'+rOuv.heure+(rOuv.cuisinier?' · '+rOuv.cuisinier:'')+'</div>':'')
        +'</div>'
        +'<div class="enc-reading" style="border-left:2px solid #f59e0b;padding-left:6px">'
          +'<div class="enc-reading-label" style="color:#f59e0b">☀️ Midi</div>'
          +'<div class="enc-reading-val '+valCls(cMidi)+'">'+disp(rMidi)+'</div>'
          +(rMidi?'<div style="font-size:.6rem;color:var(--gris2)">'+rMidi.heure+(rMidi.cuisinier?' · '+rMidi.cuisinier:'')+'</div>':'')
        +'</div>'
        +'<div class="enc-reading"><div class="enc-reading-label">🌙 Fermeture</div>'
          +'<div class="enc-reading-val '+valCls(cFerm)+'">'+disp(rFerm)+'</div>'
          +(rFerm?'<div style="font-size:.6rem;color:var(--gris2)">'+rFerm.heure+(rFerm.cuisinier?' · '+rFerm.cuisinier:'')+'</div>':'')
        +'</div>'
      +'</div>'
      +'<div class="enc-btns">'
        +'<button class="enc-btn '+(cOuv===false?'nc':rOuv?'done':'')+'" onclick="openEncSaisie20(\''+e.id+'\',\'ouv\')">'+(cOuv===false?'⚠️':rOuv?'✓':'+')+'Ouverture</button>'
        +'<button class="enc-btn '+(cMidi===false?'nc':rMidi?'done':'')+'" onclick="openEncSaisie20(\''+e.id+'\',\'midi\')" style="background:#f59e0b;color:#fff">'+(cMidi===false?'⚠️':rMidi?'✓':'☀️')+' Midi</button>'
        +'<button class="enc-btn '+(cFerm===false?'nc':rFerm?'done':'')+'" onclick="openEncSaisie20(\''+e.id+'\',\'ferm\')">'+(cFerm===false?'⚠️':rFerm?'✓':'+')+'Fermeture</button>'
      +'</div>'
    +'</div>';
  });

  var hist=((S['enr20']&&S['enr20'].saisies)||[]).slice(0,30);
  if(hist.length>0){
    html+='<div class="card" style="margin-top:10px;padding:12px 14px">'
      +'<div style="font-size:.78rem;font-weight:800;color:var(--plum);margin-bottom:8px">📋 Historique récent</div>';
    hist.forEach(function(r){
      html+='<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f3e9f3;font-size:.75rem">'
        +'<span style="color:var(--gris2);min-width:80px">'+r.date+'</span>'
        +'<span style="font-weight:700;flex:1">'+escH(r.enc_label||r.enc_id)+'</span>'
        +'<span style="color:#f59e0b;min-width:55px">'+({ouv:'Ouv.',midi:'Midi',ferm:'Ferm.'}[r.moment]||r.moment)+'</span>'
        +'<span style="font-weight:700;color:var(--navy)">'+((parseFloat(r.temp)>=0?'+':'')+parseFloat(r.temp).toFixed(1))+'°C</span>'
        +(r.cuisinier?'<span style="color:var(--gris2)">'+escH(r.cuisinier)+'</span>':'')
      +'</div>';
    });
    html+='</div>';
  }
  return html;
}

function openEncSaisie20(encId, moment){
  var enc=getEnceintes().find(function(e){return e.id===encId;});
  if(!enc)return;
  _encSaisie={encId:encId,moment:moment,consigne:enc.consigne,label:enc.label||encId,_sec20:true};
  var mLabel=moment==='ouv'?'🌅 Ouverture':moment==='midi'?'☀️ Midi':'🌙 Fermeture';
  document.getElementById('enc-modal-title').textContent=enc.label+' — '+mLabel+' (Plan Canicule)';
  document.getElementById('enc-modal-sub').textContent='Consigne : '+enc.consigne;
  var isConge=enc.type==='congelateur';
  var tMin=isConge?-30:-10; var tMax=isConge?5:25;
  var presets=isConge?[-25,-22,-20,-18,-15]:[0,2,3,4,5,6,7,8,10,12,14];
  S['enc_modal']=S['enc_modal']||{}; S['enc_modal'].draft={enc_temp:'',enc_chef:''};
  document.getElementById('enc-modal-tp').innerHTML=tpHtmlEnc('enc_temp','enc_modal','Température relevée',tMin,tMax,presets);
  document.getElementById('enc-modal-chef').innerHTML=chefSel('enc_chef','enc_modal','Cuisinier / Visa');
  var btn=document.querySelector('#enc-ov .btn-save');
  if(btn) btn.setAttribute('onclick','saveEncSaisie20()');
  document.getElementById('enc-ov').classList.add('open');
}
function saveEncSaisie20(){
  if(roCheck())return;
  var temp=(S['enc_modal']&&S['enc_modal'].draft&&S['enc_modal'].draft.enc_temp)||'';
  var chef=(S['enc_modal']&&S['enc_modal'].draft&&S['enc_modal'].draft.enc_chef)||'';
  if(temp===''||temp===undefined){toast('⚠️ Saisissez la température','warning');return;}
  var saisie={
    date:today(),heure:nowT(),
    enc_id:_encSaisie.encId,
    enc_label:_encSaisie.label||_encSaisie.encId,
    moment:_encSaisie.moment,
    temp:String(temp),
    cuisinier:chef,
    _ts:new Date().toISOString(),_sec:'enr20'
  };
  S['enr20']=S['enr20']||{}; S['enr20'].saisies=S['enr20'].saisies||[];
  S['enr20'].saisies.unshift(saisie);
  save();
  try{SupaEngine.enqueue('enr20',saisie);}catch(e){}
  var ok=encConforme(temp,_encSaisie.consigne);
  if(ok===false){
    toast('⚠️ T°C hors seuil — NC créée','warning');
    autoCreateNC('ENR20 Canicule T°C','Plan canicule — hors seuil : '+(_encSaisie.label||'')+' ('+_encSaisie.moment+') : '+((parseFloat(temp)>=0?'+':'')+parseFloat(temp).toFixed(1))+'°C — consigne '+_encSaisie.consigne,_encSaisie.label||'','',{cause_matriel:'1',cause_milieu:'1'});
  } else {
    autoBackup();
    toast('✅ Relevé canicule enregistré','success');
  }
  var btn=document.querySelector('#enc-ov .btn-save');
  if(btn) btn.setAttribute('onclick','saveEncSaisie()');
  closeEncSaisie();
  renderNav(); renderMain();
}

// ════════════════════════════════════════════════════
// ENR21 — T°C Stockage INDIVIDUEL (ponctuel)
// ════════════════════════════════════════════════════
function renderENR21(){
  var encs=getEnceintes();
  var lignes=((S['enr21']&&S['enr21'].lignes)||[]);
  var todayLignes=lignes.filter(function(r){return r.date===today();});

  var html='<div class="card" style="padding:13px 14px">'
    +'<div class="card-title">🌡️ T°C Stockage individuel</div>'
    +'<div class="regle" style="margin-bottom:8px">Contrôle ponctuel d\'une enceinte : incident, doute, livraison, inspection. Saisie libre à tout moment.</div>'
    +'</div>';

  html+='<div class="card" style="padding:12px 14px">'
    +'<div style="font-size:.78rem;font-weight:800;color:var(--plum);margin-bottom:10px">📌 Nouvelle saisie</div>';

  encs.forEach(function(e){
    var derniere=lignes.filter(function(r){return r.enc_id===e.id;}).slice(0,1)[0];
    var ic=e.type==='congelateur'?'❄️':'🌡️';
    var conf=derniere?encConforme(derniere.temp,e.consigne):null;
    var dispDern=derniere?((parseFloat(derniere.temp)>=0?'+':'')+parseFloat(derniere.temp).toFixed(1)+'°C · '+derniere.date):'Aucune saisie';
    html+='<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid #f3e9f3">'
      +'<div style="flex:1">'
        +'<div style="font-size:.8rem;font-weight:700">'+ic+' '+escH(e.label)+'</div>'
        +'<div style="font-size:.65rem;color:var(--gris2)">Consigne '+escH(e.consigne)+' · Dernière : <span style="color:'+(conf===false?'#dc2626':conf===true?'#16a34a':'var(--gris2)')+'">'+dispDern+'</span></div>'
      +'</div>'
      +'<button class="btn-save" style="padding:7px 13px;font-size:.72rem;margin-left:8px" onclick="openEncSaisie21(\''+e.id+'\')">+ Saisir</button>'
    +'</div>';
  });
  html+='</div>';

  if(todayLignes.length>0){
    html+='<div class="card" style="padding:12px 14px;margin-top:10px">'
      +'<div style="font-size:.78rem;font-weight:800;color:var(--plum);margin-bottom:8px">📋 Saisies du jour ('+todayLignes.length+')</div>';
    todayLignes.forEach(function(r){
      var ok=encConforme(r.temp,r.enc_consigne||null);
      html+='<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f3e9f3;font-size:.75rem">'
        +'<span style="font-weight:700;flex:1">'+escH(r.enc_label||r.enc_id)+'</span>'
        +'<span style="font-weight:900;font-size:.9rem;color:'+(ok===false?'#dc2626':ok===true?'#16a34a':'var(--navy)')+'">'+((parseFloat(r.temp)>=0?'+':'')+parseFloat(r.temp).toFixed(1))+'°C</span>'
        +'<span style="color:var(--gris2)">'+r.heure+'</span>'
        +(r.motif?'<span style="background:#f0e6f0;color:var(--plum);border-radius:6px;padding:2px 6px;font-size:.65rem">'+escH(r.motif)+'</span>':'')
        +(ok===false?'<span style="color:#dc2626;font-size:.7rem;font-weight:800">⚠️</span>':'')
      +'</div>';
    });
    html+='</div>';
  }

  if(lignes.length>todayLignes.length){
    html+='<div class="card" style="padding:12px 14px;margin-top:10px">'
      +'<div style="font-size:.78rem;font-weight:800;color:var(--plum);margin-bottom:8px">📋 Historique ('+lignes.length+')</div>';
    lignes.slice(0,50).forEach(function(r){
      var ok=encConforme(r.temp,r.enc_consigne||null);
      html+='<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #f3e9f3;font-size:.73rem">'
        +'<span style="color:var(--gris2);min-width:80px">'+r.date+'</span>'
        +'<span style="font-weight:700;flex:1">'+escH(r.enc_label||r.enc_id)+'</span>'
        +'<span style="font-weight:900;color:'+(ok===false?'#dc2626':ok===true?'#16a34a':'var(--navy)')+'">'+((parseFloat(r.temp)>=0?'+':'')+parseFloat(r.temp).toFixed(1))+'°C</span>'
        +(r.motif?'<span style="background:#f0e6f0;color:var(--plum);border-radius:6px;padding:2px 5px;font-size:.62rem">'+escH(r.motif)+'</span>':'')
      +'</div>';
    });
    html+='</div>';
  }
  return html;
}

function _setEncMotif(val){
  S['enc_modal']=S['enc_modal']||{};
  S['enc_modal'].draft=S['enc_modal'].draft||{};
  S['enc_modal'].draft.enc_motif=val;
}
function openEncSaisie21(encId){
  var enc=getEnceintes().find(function(e){return e.id===encId;});
  if(!enc)return;
  _encSaisie={encId:encId,moment:'ponctuel',consigne:enc.consigne,label:enc.label||encId,_sec21:true};
  document.getElementById('enc-modal-title').textContent=enc.label+' — Contrôle individuel';
  document.getElementById('enc-modal-sub').textContent='Consigne : '+enc.consigne;
  var isConge=enc.type==='congelateur';
  var tMin=isConge?-30:-10; var tMax=isConge?5:25;
  var presets=isConge?[-25,-22,-20,-18,-15]:[0,2,3,4,5,6,7,8,10,12,14];
  S['enc_modal']=S['enc_modal']||{}; S['enc_modal'].draft={enc_temp:'',enc_chef:'',enc_motif:''};
  var motifHtml='<div style="margin-top:10px">'
    +'<div style="font-size:.72rem;font-weight:700;color:var(--gris2);margin-bottom:4px">📝 Motif (optionnel)</div>'
    +'<input type="text" id="enc-motif-inp" placeholder="Incident, livraison, inspection..." '
    +'style="width:100%;box-sizing:border-box;padding:9px 11px;border:1.5px solid #e5e7eb;border-radius:10px;font-size:.82rem;font-family:inherit;outline:none" '
    +'oninput="_setEncMotif(this.value)">'
    +'</div>';
  document.getElementById('enc-modal-tp').innerHTML=
    tpHtmlEnc('enc_temp','enc_modal','Température relevée',tMin,tMax,presets)+motifHtml;
  document.getElementById('enc-modal-chef').innerHTML=chefSel('enc_chef','enc_modal','Cuisinier / Visa');
  var btn=document.querySelector('#enc-ov .btn-save');
  if(btn) btn.setAttribute('onclick','saveEncSaisie21()');
  document.getElementById('enc-ov').classList.add('open');
}
function saveEncSaisie21(){
  if(roCheck())return;
  var temp=(S['enc_modal']&&S['enc_modal'].draft&&S['enc_modal'].draft.enc_temp)||'';
  var chef=(S['enc_modal']&&S['enc_modal'].draft&&S['enc_modal'].draft.enc_chef)||'';
  var motif=(S['enc_modal']&&S['enc_modal'].draft&&S['enc_modal'].draft.enc_motif)||'';
  if(temp===''||temp===undefined){toast('⚠️ Saisissez la température','warning');return;}
  var ligne={
    date:today(),heure:nowT(),
    enc_id:_encSaisie.encId,
    enc_label:_encSaisie.label||_encSaisie.encId,
    enc_consigne:_encSaisie.consigne||'',
    temp:String(temp),
    motif:motif,
    cuisinier:chef,
    _ts:new Date().toISOString(),_sec:'enr21'
  };
  S['enr21']=S['enr21']||{}; S['enr21'].lignes=S['enr21'].lignes||[];
  S['enr21'].lignes.unshift(ligne);
  save();
  try{SupaEngine.enqueue('enr21',ligne);}catch(e){}
  var ok=encConforme(temp,_encSaisie.consigne);
  if(ok===false){
    toast('⚠️ T°C hors seuil — NC créée','warning');
    autoCreateNC('ENR21 T°C individuel','T°C hors seuil : '+(_encSaisie.label||'')+' — '+((parseFloat(temp)>=0?'+':'')+parseFloat(temp).toFixed(1))+'°C — consigne '+_encSaisie.consigne+(motif?' ('+motif+')':''),_encSaisie.label||'','',{cause_matriel:'1'});
  } else {
    autoBackup();
    toast('✅ T°C enregistrée','success');
  }
  var btn=document.querySelector('#enc-ov .btn-save');
  if(btn) btn.setAttribute('onclick','saveEncSaisie()');
  closeEncSaisie();
  renderNav(); renderMain();
}

// ── Rendu Config enceintes (drag&drop) ────────────────────
function renderEnceinteConfig(){
  const encs=getEnceintes();
  const el=document.getElementById('sp-enceintes');
  if(!el)return;
  el.innerHTML=encs.map((e,i)=>`
    <div class="sp-row" draggable="true" data-eid="${e.id}" style="gap:6px">
      <span class="sp-drag-handle">⠿</span>
      <span style="font-size:1.1rem">${e.type==='congelateur'?'❄️':'🌡️'}</span>
      <span class="sp-name" style="flex:1;cursor:pointer" onclick="editEnceinteLabel('${e.id}')" title="Cliquer pour renommer">${e.label}</span>
      <span style="font-size:.66rem;color:var(--gris2);white-space:nowrap">${e.consigne}</span>
      <button onclick="delEnceinte('${e.id}')" style="background:#fee2e2;border:none;border-radius:7px;padding:4px 8px;color:#d32f2f;cursor:pointer;font-size:.78rem">✕</button>
    </div>`).join('');
  initEncDrag(el);
}
function delEnceinte(id){
  showConfirm('Supprimer enceinte','Supprimer cette enceinte et toutes ses données ?','🗑 Supprimer',()=>{
    const list=getEnceintes().filter(e=>e.id!==id);
    saveEnceintes(list);renderEnceinteConfig();
  });
}
function addEnceinte(type){
  if(type==='congelateur'){
    const id='enc_'+Date.now();
    const list=[...getEnceintes(),{id,label:'Congélateur',type:'congelateur',consigne:'≤ −18°C'}];
    saveEnceintes(list);renderEnceinteConfig();
    setTimeout(()=>editEnceinteLabel(id),100);
    return;
  }
  // Frigo : choisir la consigne via picker
  const TYPES_FRIGO=[
    {label:'BOF / Produits laitiers',  consigne:'0°C à +3°C'},
    {label:'Viandes & Charcuteries',   consigne:'0°C à +3°C'},
    {label:'Produits finis',           consigne:'0°C à +3°C'},
    {label:'Poissons & Crustacés',consigne:'0°C à +4°C'},
    {label:'Fruits & Légumes',    consigne:'+4°C à +8°C'},
    {label:'Réfrigérateur général', consigne:'0°C à +6°C'},
  ];
  const el=document.getElementById('sp-enceintes');
  if(!el)return;
  const pickerId='enc-consigne-picker';
  if(document.getElementById(pickerId)){document.getElementById(pickerId).remove();return;}
  const div=document.createElement('div');
  div.id=pickerId;
  div.style.cssText='background:#f7f2f7;border:2px dashed var(--plum);border-radius:12px;padding:12px;margin-top:8px';
  div.innerHTML='<div style="font-size:.78rem;font-weight:900;color:var(--plum);margin-bottom:8px">ℹ️ Choisir le type :</div>'
    +TYPES_FRIGO.map((t,i)=>`<button data-picker-idx="${i}" style="display:block;width:100%;text-align:left;padding:8px 10px;margin-bottom:4px;background:#fff;border:1.5px solid var(--brd);border-radius:8px;cursor:pointer;font-family:inherit;font-size:.8rem"><strong>${t.label}</strong> <span style="color:var(--gris2);font-size:.74rem">${t.consigne}</span></button>`).join('')
    +'<button onclick="document.getElementById(\'enc-consigne-picker\')?.remove()" style="width:100%;padding:6px;background:none;border:none;color:#b89ab6;font-size:.75rem;cursor:pointer;font-family:inherit;margin-top:2px">Annuler</button>';
  div.querySelectorAll('[data-picker-idx]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const t=TYPES_FRIGO[parseInt(btn.dataset.pickerIdx)];
      const id='enc_'+Date.now();
      const list=[...getEnceintes(),{id,label:t.label,type:'frigo',consigne:t.consigne}];
      saveEnceintes(list);
      document.getElementById('enc-consigne-picker')?.remove();
      renderEnceinteConfig();
      setTimeout(()=>editEnceinteLabel(id),100);
    });
  });
  el.appendChild(div);
}
function editEnceinteLabel(id){
  const row=document.querySelector(`[data-eid="${id}"] .sp-name`);
  if(!row)return;
  const cur=row.textContent;
  const inp=document.createElement('input');
  inp.className='fi';inp.style.cssText='flex:1;padding:4px 8px;font-size:.82rem';
  inp.value=cur;
  row.replaceWith(inp);
  inp.focus();inp.select();
  const doSave=()=>{
    const newLabel=(inp.value||cur).trim();
    const list=getEnceintes();
    const e=list.find(x=>x.id===id);
    if(e&&newLabel!==cur){
      e.label=newLabel;
      saveEnceintes(list);
      // Mettre à jour les saisies existantes en localStorage
      if(S['enr19']&&S['enr19'].saisies){
        S['enr19'].saisies.forEach(s=>{if(s.enc_id===id)s.enc_label=newLabel;});
        save();
      }
      toast('🏷️ Enceinte renommée : '+newLabel,'success');
    }
    renderEnceinteConfig();
  };
  inp.onblur=doSave;inp.onkeydown=e=>{if(e.key==='Enter'){inp.blur();}if(e.key==='Escape'){renderEnceinteConfig();}};
}
function initEncDrag(container){
  let drag=null;
  container.querySelectorAll('[data-eid]').forEach(row=>{
    row.addEventListener('dragstart',()=>{drag=row;row.classList.add('dragging');});
    row.addEventListener('dragend',()=>{row.classList.remove('dragging');drag=null;});
    row.addEventListener('dragover',e=>{e.preventDefault();if(drag&&drag!==row){
      container.querySelectorAll('.drag-over').forEach(r=>r.classList.remove('drag-over'));
      row.classList.add('drag-over');}});
    row.addEventListener('drop',e=>{e.preventDefault();if(!drag||drag===row)return;
      row.classList.remove('drag-over');
      const fi=drag.dataset.eid,ti=row.dataset.eid;
      const list=getEnceintes();
      const a=list.findIndex(e=>e.id===fi),b=list.findIndex(e=>e.id===ti);
      if(a<0||b<0)return;
      list.splice(b,0,list.splice(a,1)[0]);
      saveEnceintes(list);renderEnceinteConfig();
    });
    // Touch
    row.addEventListener('touchstart',e=>{drag=row;row.classList.add('dragging');},{passive:true});
    row.addEventListener('touchmove',e=>{
      e.preventDefault();const t=e.touches[0];
      const el=document.elementFromPoint(t.clientX,t.clientY)?.closest('[data-eid]');
      container.querySelectorAll('.drag-over').forEach(r=>r.classList.remove('drag-over'));
      if(el&&el!==drag)el.classList.add('drag-over');
    },{passive:false});
    row.addEventListener('touchend',()=>{
      const over=container.querySelector('.drag-over');
      if(over&&over!==drag){
        over.classList.remove('drag-over');
        const list=getEnceintes();
        const a=list.findIndex(e=>e.id===drag.dataset.eid),b=list.findIndex(e=>e.id===over.dataset.eid);
        if(a>=0&&b>=0){list.splice(b,0,list.splice(a,1)[0]);saveEnceintes(list);}
      }
      if(drag)drag.classList.remove('dragging');drag=null;
      renderEnceinteConfig();
    });
  });
}

function s19(enc,key,val){S['enr19']=S['enr19']||{};S['enr19'][enc]=S['enr19'][enc]||{};S['enr19'][enc][key]=val;save();}

// ════════════════════════════════════════════════════
// ENR28 — PLAN DE NETTOYAGE HACCP
// ════════════════════════════════════════════════════

// ── Référentiel par défaut ───────────────────────────
const NETT_REF_DEFAULT = [
  // Cuisine chaude
  {id:'n01',zone:'Cuisine chaude',materiel:'Plans de travail',freq:'apres_usage',produit:'Dégraissant alimentaire'},
  {id:'n02',zone:'Cuisine chaude',materiel:'Plancha / grill',freq:'apres_usage',produit:'Dégraissant haute température'},
  {id:'n03',zone:'Cuisine chaude',materiel:'Fours',freq:'quotidien',produit:'Dégraissant four'},
  {id:'n04',zone:'Cuisine chaude',materiel:'Marmites / casseroles',freq:'apres_usage',produit:'Liquide vaisselle'},
  {id:'n05',zone:'Cuisine chaude',materiel:'Sol',freq:'quotidien',produit:'Désinfectant sol'},
  {id:'n06',zone:'Cuisine chaude',materiel:'Hottes / filtres',freq:'hebdo',produit:'Dégraissant'},
  {id:'n07',zone:'Cuisine chaude',materiel:'Murs / carrelage',freq:'mensuel',produit:'Désinfectant surfaces'},
  // Cuisine froide / préparations
  {id:'n08',zone:'Cuisine froide',materiel:'Plans de travail',freq:'apres_usage',produit:'Désinfectant surfaces'},
  {id:'n09',zone:'Cuisine froide',materiel:'Trancheuse',freq:'apres_usage',produit:'Désinfectant alimentaire'},
  {id:'n10',zone:'Cuisine froide',materiel:'Couteaux / ustensiles',freq:'apres_usage',produit:'Liquide vaisselle + désinfection'},
  {id:'n11',zone:'Cuisine froide',materiel:'Sol',freq:'quotidien',produit:'Désinfectant sol'},
  // Légumerie
  {id:'n12',zone:'Légumerie',materiel:'Plans de travail',freq:'apres_usage',produit:'Désinfectant surfaces'},
  {id:'n13',zone:'Légumerie',materiel:'Éplucheuse',freq:'apres_usage',produit:'Désinfectant alimentaire'},
  {id:'n14',zone:'Légumerie',materiel:'Bacs / éviers',freq:'apres_usage',produit:'Désinfectant'},
  {id:'n15',zone:'Légumerie',materiel:'Sol',freq:'quotidien',produit:'Désinfectant sol'},
  // Plonge
  {id:'n16',zone:'Plonge',materiel:'Lave-vaisselle / armoire de lavage',freq:'quotidien',produit:'Produit machine'},
  {id:'n17',zone:'Plonge',materiel:'Bacs trempage',freq:'apres_usage',produit:'Désinfectant'},
  {id:'n18',zone:'Plonge',materiel:'Sol',freq:'quotidien',produit:'Désinfectant sol'},
  // Enceintes froides
  {id:'n19',zone:'Enceintes froides',materiel:'Réfrigérateurs — étagères',freq:'hebdo',produit:'Désinfectant alimentaire'},
  {id:'n20',zone:'Enceintes froides',materiel:'Congélateurs — étagères',freq:'mensuel',produit:'Désinfectant alimentaire'},
  {id:'n21',zone:'Enceintes froides',materiel:'Joints de portes',freq:'hebdo',produit:'Désinfectant'},
  // Réception / stockage
  {id:'n22',zone:'Réception',materiel:'Tables / plans de réception',freq:'apres_usage',produit:'Désinfectant surfaces'},
  {id:'n23',zone:'Réception',materiel:'Sol',freq:'quotidien',produit:'Désinfectant sol'},
  // Local déchets
  {id:'n24',zone:'Local déchets',materiel:'Bacs poubelles',freq:'quotidien',produit:'Désinfectant + eau chaude'},
  {id:'n25',zone:'Local déchets',materiel:'Sol',freq:'quotidien',produit:'Désinfectant sol'},
  // Sanitaires / vestiaires
  {id:'n26',zone:'Sanitaires',materiel:'WC / lavabos',freq:'quotidien',produit:'Désinfectant sanitaire'},
  {id:'n27',zone:'Sanitaires',materiel:'Sol',freq:'quotidien',produit:'Désinfectant sol'},
  // Distribution
  {id:'n28z',zone:'Distribution',materiel:'Chariots / bacs de distribution',freq:'apres_usage',produit:'Désinfectant alimentaire'},
  {id:'n29',zone:'Distribution',materiel:'Sol',freq:'quotidien',produit:'Désinfectant sol'},
  // Général
  {id:'n30',zone:'Général',materiel:'Poignées de portes',freq:'quotidien',produit:'Désinfectant'},
  {id:'n31',zone:'Général',materiel:'Murs / carrelage (zones annexes)',freq:'mensuel',produit:'Désinfectant surfaces'},
];

const NETT_FREQ_LABEL = {apres_usage:'Après usage',quotidien:'Quotidien',hebdo:'Hebdomadaire',mensuel:'Mensuel'};
const NETT_FREQ_ICO   = {apres_usage:'⚡',quotidien:'📅',hebdo:'📆',mensuel:'🗓️'};

// ── Accès données ────────────────────────────────────
function nettRef(){
  if(!S.nett_ref || !Array.isArray(S.nett_ref) || S.nett_ref.length===0){
    S.nett_ref=JSON.parse(JSON.stringify(NETT_REF_DEFAULT));
    save();
    // Tenter de synchro vers le cloud si vide
    setTimeout(function(){if(typeof _saveConfigToSupabase==='function')_saveConfigToSupabase();},2000);
  }
  return S.nett_ref;
}
function nettVal(){return S.nett_val||[];}

// ── Dernière validation d'un item ────────────────────
function nettLastVal(refId){
  const vals=nettVal().filter(v=>v.ref_id===refId);
  if(!vals.length)return null;
  return vals.reduce((a,b)=>a._ts>b._ts?a:b);
}

// ── Statut d'un item : 'retard'|'today'|'semaine'|'mois'|'ok' ──
// ── Calcul prochaine échéance ────────────────────────
// Retourne {status, nextDue, joursRestants, label}
function nettInfo(item){
  const last=nettLastVal(item.id);
  const now=new Date(); now.setHours(0,0,0,0);
  const todayStr=today();
  const isoToDate=s=>{ const d=new Date(s+'T12:00'); d.setHours(0,0,0,0); return d; };
  const datePlusJ=(d,j)=>{ const r=new Date(d); r.setDate(r.getDate()+j); return r; };
  // Fix timezone : utiliser composantes locales (et non toISOString qui converti en UTC)
  const toIso=d=>{
    const y=d.getFullYear();
    const m=String(d.getMonth()+1).padStart(2,'0');
    const day=String(d.getDate()).padStart(2,'0');
    return y+'-'+m+'-'+day;
  };
  const isoFr=d=>d?d.slice(8,10)+'/'+d.slice(5,7)+'/'+d.slice(0,4):'—';

  // NC persistante : on garde en retard jusqu'à validation OUI
  if(last&&last.conforme==='NON'){
    return{status:'nc',nextDue:todayStr,joursRestants:-99,
      label:'⚠️ NC — à refaire',lastInfo:'NC le '+isoFr(last.date)+(last.cuisinier?' par '+last.cuisinier:'')};
  }

  const lastDate=last?isoToDate(last.date):null;
  let nextDueDate=null;

  if(item.freq==='apres_usage'){
    if(last&&last.date===todayStr)
      return{status:'ok',nextDue:null,joursRestants:0,label:"Fait aujourd'hui",lastInfo:'Fait à '+(last.heure||'?')+(last.cuisinier?' — '+last.cuisinier:'')};
    return{status:'today',nextDue:todayStr,joursRestants:0,label:'À faire lors du prochain usage',lastInfo:last?'Dernier : '+isoFr(last.date):'Jamais effectué'};
  }

  if(item.freq==='quotidien'){
    nextDueDate=lastDate?datePlusJ(lastDate,1):now;
  } else if(item.freq==='hebdo'){
    nextDueDate=lastDate?datePlusJ(lastDate,7):now;
  } else if(item.freq==='mensuel'){
    if(lastDate){
      nextDueDate=new Date(lastDate);
      nextDueDate.setMonth(nextDueDate.getMonth()+1);
    } else { nextDueDate=now; }
  }

  const diff=Math.round((nextDueDate-now)/(1000*60*60*24));
  const lastInfo=last
    ?'Dernier : '+isoFr(last.date)+(last.heure?' à '+last.heure:'')+(last.cuisinier?' — '+last.cuisinier:'')
    :'Jamais effectué';
  const nextStr=toIso(nextDueDate);

  // Si l'item a été validé OK aujourd'hui → statut "fait aujourd'hui"
  // (disparaît de la liste des choses à faire, quelle que soit la fréquence)
  if(last && last.date===todayStr && last.conforme!=='NON'){
    return{status:'done_today',nextDue:nextStr,joursRestants:diff,
      label:'✅ Fait aujourd\'hui à '+(last.heure||'?')+(last.cuisinier?' par '+last.cuisinier:''),
      lastInfo:'Prochain : '+isoFr(nextStr)};
  }

  let status,label;
  if(diff<0){
    status='retard';
    label='En retard de '+Math.abs(diff)+' jour'+(Math.abs(diff)>1?'s':'');
  } else if(diff===0){
    status='today';
    label="À faire aujourd'hui";
  } else if(diff<=2){
    status='demain';
    label='Dans '+(diff===1?'1 jour':diff+' jours')+' — prévoir le '+isoFr(nextStr);
  } else if(diff<=7){
    status='semaine';
    label='Cette semaine — prévu le '+isoFr(nextStr);
  } else if(diff<=30){
    status='mois';
    label='Ce mois — prévu le '+isoFr(nextStr);
  } else {
    status='ok';
    label='Prochain : '+isoFr(nextStr);
  }

  return{status,nextDue:nextStr,joursRestants:diff,label,lastInfo};
}

// Compatibilité : nettStatus utilise nettInfo
function nettStatus(item){ return nettInfo(item).status; }

// ── Compter les retards (pour accueil) ───────────────
function nettNbRetards(){
  return nettRef().filter(it=>['retard','nc'].includes(nettStatus(it))).length;
}

// ── Onglet actif ENR28 ───────────────────────────────
let _nettTab = 'priorites'; // 'priorites' | 'zones' | 'ref'

function nettSetTab(t){
  if(t==='ref'){
    // Onglet référentiel protégé : PIN admin requis, mais garder l'onglet actif après
    _nettTab='ref';
    nettAdminGuard(()=>{ if(_nettTab!=='ref') _nettTab='ref'; renderMain(); });
    return;
  }
  _nettTab=t;renderMain();
}

// ── Renderer principal ENR28 ─────────────────────────
function renderENR28(){
  const _nuisZonesRestantes=nuisiblesZones().filter(z=>nuisiblesTodayForZone(z)===null).length;
  const _nuisBadge=_nuisZonesRestantes>0
    ?`<span style="background:#dc2626;color:#fff;border-radius:20px;padding:1px 6px;font-size:.6rem;font-weight:900;margin-left:3px;line-height:1.4;display:inline-block;vertical-align:middle">${_nuisZonesRestantes}</span>`
    :`<span style="background:#166534;color:#fff;border-radius:20px;padding:1px 5px;font-size:.65rem;font-weight:900;margin-left:3px;line-height:1.4;display:inline-block;vertical-align:middle">✓</span>`;
  const tabs=[
    {id:'priorites',ico:'🚨',label:'Priorités'},
    {id:'zones',ico:'🗂️',label:'Par zone'},
    {id:'nuisibles',ico:'🐀',label:'Nuisibles',badge:_nuisBadge},
    {id:'ref',ico:'⚙️',label:'Référentiel 🔒'},
  ];
  const tabBar=`<div class="nett-tabs">
    ${tabs.map(t=>`<button class="nett-tab${_nettTab===t.id?' active':''}" onclick="nettSetTab('${t.id}')">${t.ico} ${t.label}${t.badge||''}</button>`).join('')}
  </div>`;
  let body='';
  if(_nettTab==='priorites') body=renderNettPriorites();
  else if(_nettTab==='zones') body=renderNettZones();
  else if(_nettTab==='nuisibles') body=renderNettNuisibles();
  else body=renderNettRef();
  return`<div class="card" style="padding:0;overflow:hidden">
    <div style="padding:14px 14px 0">${tabBar}</div>
    <div id="nett-plan-body" style="padding:12px 14px 16px">${body}</div>
  </div>
  ${_nettTab==='ref'?'':_nettTab==='nuisibles'?renderNuisiblesHisto():renderNettHisto()}`;
}

// ── Vue Priorités ────────────────────────────────────
function renderNettPriorites(){
  const ref=nettRef();
  // Enrichir chaque item avec nettInfo, trier par joursRestants
  const enriched=ref.map(it=>({it,info:nettInfo(it)}));
  enriched.sort((a,b)=>a.info.joursRestants-b.info.joursRestants);

  const groups={
    nc:         {ico:'⚠️',label:'Non-conformes — à refaire immédiatement',col:'#991b1b',bg:'#fef2f2',border:'#fca5a5',items:[]},
    retard:     {ico:'🔴',label:'En retard',col:'#dc2626',bg:'#fff5f5',border:'#fca5a5',items:[]},
    today:      {ico:'🟠',label:'À faire aujourd\'hui',col:'#d97706',bg:'#fffbeb',border:'#fde68a',items:[]},
    demain:     {ico:'🟡',label:'Dans 1-2 jours',col:'#b45309',bg:'#fefce8',border:'#fde68a',items:[]},
    semaine:    {ico:'🔵',label:'Cette semaine',col:'#1d4ed8',bg:'#eff6ff',border:'#bfdbfe',items:[]},
    mois:       {ico:'🟣',label:'Ce mois',col:'#6d28d9',bg:'#f5f3ff',border:'#ddd6fe',items:[]},
    ok:         {ico:'✅',label:'À jour',col:'#166534',bg:'#f0fdf4',border:'#bbf7d0',items:[]},
    done_today: {ico:'✅',label:'Fait aujourd\'hui',col:'#166534',bg:'#f0fdf4',border:'#bbf7d0',items:[]},
  };
  enriched.forEach(({it,info})=>{
    const g=groups[info.status]||groups.ok;
    g.items.push({it,info});
  });

  // Résumé stats en haut
  const nbUrgent=(groups.nc.items.length+groups.retard.items.length+groups.today.items.length);
  const statsHtml=`<div class="nett-stats-bar">
    ${nbUrgent>0?
      `<span class="nett-stat-pill red">${nbUrgent} urgent${nbUrgent>1?'s':''}</span>`:''}
    ${groups.demain.items.length?
      `<span class="nett-stat-pill orange">${groups.demain.items.length} dans 1-2j</span>`:''}
    ${groups.semaine.items.length?
      `<span class="nett-stat-pill blue">${groups.semaine.items.length} cette semaine</span>`:''}
    ${groups.done_today.items.length?
      `<span class="nett-stat-pill green">${groups.done_today.items.length} fait${groups.done_today.items.length>1?'s':''} aujourd'hui</span>`:''}
    ${groups.ok.items.length?
      `<span class="nett-stat-pill green">${groups.ok.items.length} à jour</span>`:''}
  </div>`;

  let html=statsHtml;
  ['nc','retard','today','demain','semaine','mois','ok','done_today'].forEach(k=>{
    const g=groups[k];
    if(!g.items.length)return;
    html+=`<div style="margin-bottom:14px">
      <div style="font-size:.71rem;font-weight:900;letter-spacing:.4px;color:${g.col};margin-bottom:6px;padding:5px 10px;background:${g.bg};border-radius:8px;border:1px solid ${g.border}">
        ${g.ico} ${g.label.toUpperCase()} — ${g.items.length} élément${g.items.length>1?'s':''}
      </div>
      ${g.items.map(({it,info})=>nettItemRow(it,info)).join('')}
    </div>`;
  });
  if(enriched.length===0)html='<div class="empty-s">Aucun élément dans le plan.</div>';
  return html;
}

// ── Ligne item nettoyage (nouveau : accepte info objet ou status string) ─
function nettItemRow(it, infoOrStatus){
  // Accepte soit un objet {status,label,lastInfo,...} soit une string status
  const info = (typeof infoOrStatus==='object'&&infoOrStatus!==null) ? infoOrStatus : nettInfo(it);
  const {status,label,lastInfo,joursRestants} = info;

  // Classe de couleur
  const urgClass = status==='nc'||status==='retard' ? 'nett-row-retard'
    : status==='today' ? 'nett-row-today'
    : status==='demain' ? 'nett-row-demain'
    : status==='semaine' ? 'nett-row-semaine'
    : 'nett-row-ok';

  // Barre de progression (jours restants visuels)
  let progressHtml='';
  if(it.freq!=='apres_usage' && it.freq!=='quotidien'){
    const maxJ = it.freq==='hebdo'?7:30;
    const elapsed = maxJ - Math.max(0,Math.min(joursRestants,maxJ));
    const pct = Math.round((elapsed/maxJ)*100);
    const barCol = status==='retard'||status==='nc'?'#dc2626':status==='today'?'#d97706':status==='demain'?'#b45309':'#6d28d9';
    progressHtml=`<div class="nett-progress-bar"><div class="nett-progress-fill" style="width:${pct}%;background:${barCol}"></div></div>`;
  }

  // Badge urgence
  const badge = status==='nc'?'⚠️ NC'
    :status==='retard'?'🔴 Retard'
    :status==='today'?'🟠 Aujourd\'hui'
    :status==='demain'?'🟡 '+(joursRestants===1?'Demain':'Dans '+joursRestants+'j')
    :status==='semaine'?'🔵 '+joursRestants+'j'
    :status==='ok'?'✅':'🟣';

  return`<div class="swipe-row" data-swipe-right="nettSwipeOK('${it.id}')" data-swipe-left="nettSwipeNC('${it.id}')">
    <div class="swipe-action swipe-action-del" style="background:#166534">✅ OK</div>
    <div class="swipe-action swipe-action-right" style="background:#dc2626">⚠️ NC</div>
    <div class="swipe-row-inner nett-item-row ${urgClass}" style="border-radius:10px;border:1.5px solid transparent;">
      <div class="nett-item-info">
        <div class="nett-item-main">
          <span class="nett-zone-badge">${escH(it.zone)}</span>
          ${escH(it.materiel)}
          <span class="nett-urgence-badge">${badge}</span>
        </div>
        <div class="nett-item-meta">${NETT_FREQ_ICO[it.freq]} ${NETT_FREQ_LABEL[it.freq]} · ${escH(it.produit||'')}</div>
        <div class="nett-item-planning">${escH(label)}</div>
        <div class="nett-item-last">${escH(lastInfo)}</div>
        ${progressHtml}
      </div>
      <button class="nett-val-btn" onclick="openNettModal('${it.id}')">✓ Fait</button>
    </div>
  </div>`;
}

// ── Vue Par zone ─────────────────────────────────────
function renderNettZones(){
  const ref=nettRef();
  const zones={};
  ref.forEach(it=>{zones[it.zone]=zones[it.zone]||[];zones[it.zone].push(it);});
  return Object.entries(zones).map(([zone,items])=>{
    const nbRetard=items.filter(it=>nettStatus(it)==='retard').length;
    const badge=nbRetard>0?`<span style="background:#dc2626;color:#fff;border-radius:10px;padding:1px 7px;font-size:.65rem;font-weight:800;margin-left:6px">${nbRetard} retard${nbRetard>1?'s':''}</span>`:'';
    return`<details style="margin-bottom:8px">
      <summary style="cursor:pointer;padding:9px 11px;background:#f5eef5;border-radius:10px;font-weight:800;font-size:.82rem;color:var(--plum);list-style:none;display:flex;align-items:center;justify-content:space-between">
        <span>📍 ${escH(zone)}${badge}</span>
        <span style="font-size:.7rem;font-weight:600;color:#b89ab6">${items.length} éléments ▾</span>
      </summary>
      <div style="padding:6px 4px 2px">
        ${items.map(it=>nettItemRow(it,nettStatus(it))).join('')}
      </div>
    </details>`;
  }).join('');
}

// ── Vue Référentiel ───────────────────────────────────
function renderNettRef(){
  const ref=nettRef();
  // Construire la liste ordonnée des zones (ordre d'apparition)
  const zonesOrd=[...new Set(ref.map(it=>it.zone))];
  // Ajouter zones custom sauvegardées sans éléments
  (S.nett_zones_extra||[]).forEach(z=>{if(!zonesOrd.includes(z))zonesOrd.push(z);});

  const zonesHtml=zonesOrd.map(zone=>{
    const items=ref.filter(it=>it.zone===zone);
    const itemsHtml=items.length
      ? items.map(it=>{
          const gi=ref.findIndex(r=>r.id===it.id);
          return`<div class="nett-ref-item">
            <div class="nett-ref-item-info">
              <span class="nett-ref-item-name">${escH(it.materiel)}</span>
              <span class="nett-ref-item-freq">${NETT_FREQ_ICO[it.freq]} ${NETT_FREQ_LABEL[it.freq]}</span>
              ${it.produit?`<span class="nett-ref-item-prod">🧴 ${escH(it.produit)}</span>`:''}
            </div>
            <button class="nett-ref-del" onclick="nettDelRef(${gi})" title="Supprimer">🗑</button>
          </div>`;
        }).join('')
      : `<div style="font-size:.72rem;color:#bbb;padding:8px 10px;font-style:italic">Aucun élément — ajoutez-en un ci-dessous</div>`;

    return`<div class="nett-zone-block">
      <div class="nett-zone-header">
        <span class="nett-zone-name">📍 ${escH(zone)}</span>
        <div style="display:flex;gap:5px;align-items:center">
          <span style="font-size:.65rem;color:#b89ab6">${items.length} élément${items.length!==1?'s':''}</span>
          <button class="nett-zone-add-btn" onclick="openNettAddModal('${escH(zone)}')" title="Ajouter un élément dans cette zone">+ Matériel</button>
          <button class="nett-zone-del-btn" onclick="nettDelZone('${escH(zone)}')" title="Supprimer toute la zone">🗑 Zone</button>
        </div>
      </div>
      <div class="nett-zone-items">${itemsHtml}</div>
    </div>`;
  }).join('');

  return`<div>
    <div class="nett-ref-topbar">
      <span style="font-size:.75rem;color:#888">${ref.length} éléments · ${zonesOrd.length} zones</span>
      <div style="display:flex;gap:6px">
        <button class="btn btn-sec" style="font-size:.72rem;padding:6px 10px" onclick="nettResetRef()">↺ Défaut</button>
        <button class="nett-zone-new-btn" onclick="nettAddZone()">+ Nouvelle zone</button>
      </div>
    </div>
    ${zonesHtml||'<div class="empty-s">Aucune zone — créez-en une avec "+ Nouvelle zone"</div>'}
  </div>`;
}

// ── NUISIBLES ─────────────────────────────────────────
function nuisiblesZones(){
  const zones=[...new Set(nettRef().map(it=>it.zone)),...(S.nett_zones_extra||[])];
  if(!zones.length) return['Cuisine chaude','Cuisine froide','Légumerie','Plonge','Local déchets','Réserves'];
  return zones;
}
function nuisiblesVal(){return S.nuisibles_val||[];}
function nuisiblesTodayForZone(zone){
  const d=today();
  return nuisiblesVal().filter(v=>v.date===d&&v.zone===zone).slice(-1)[0]||null;
}

function renderNettNuisibles(){
  const zones=nuisiblesZones();
  const nbNC=nuisiblesVal().filter(v=>v.presence==='OUI').length;
  const todayChecked=zones.filter(z=>nuisiblesTodayForZone(z)!==null).length;

  const statsHtml=`<div class="nett-stats-bar" style="margin-bottom:12px">
    <span class="nett-stat-pill ${todayChecked===zones.length?'green':'orange'}">${todayChecked}/${zones.length} zones vérifiées aujourd'hui</span>
    ${nbNC>0?`<span class="nett-stat-pill red">${nbNC} présence${nbNC>1?'s':''} détectée${nbNC>1?'s':''} au total</span>`:''}
  </div>`;

  const rows=zones.map(zone=>{
    const rec=nuisiblesTodayForZone(zone);
    let statusBadge='';
    let btn='';
    if(!rec){
      statusBadge=`<span style="background:#f3f4f6;color:#6b7280;border-radius:10px;padding:2px 9px;font-size:.68rem;font-weight:700">⏳ À vérifier</span>`;
      btn=`<button class="nett-val-btn" style="background:var(--plum);min-width:80px" onclick="openNuisiblesModal('${escH(zone)}')">🔍 Vérifier</button>`;
    } else if(rec.presence==='NON'){
      statusBadge=`<span style="background:#dcfce7;color:#166534;border-radius:10px;padding:2px 9px;font-size:.68rem;font-weight:700">✅ RAS — ${rec.heure}</span>`;
      btn=`<button class="nett-val-btn" style="background:#6b7280;min-width:80px;font-size:.7rem" onclick="openNuisiblesModal('${escH(zone)}')">↺ Refaire</button>`;
    } else {
      statusBadge=`<span style="background:#fef2f2;color:#991b1b;border-radius:10px;padding:2px 9px;font-size:.68rem;font-weight:700">⚠️ PRÉSENCE — ${rec.heure}</span>`;
      btn=`<button class="nett-val-btn" style="background:#dc2626;min-width:80px;font-size:.7rem" onclick="openNuisiblesModal('${escH(zone)}')">↺ Refaire</button>`;
    }
    const actionLine=rec&&rec.presence==='OUI'&&rec.action
      ?`<div style="font-size:.7rem;color:#dc2626;margin-top:3px">🔧 ${escH(rec.action)}</div>`:'';
    const cuiLine=rec?`<div style="font-size:.68rem;color:#b89ab6;margin-top:2px">👤 ${escH(rec.cuisinier||'—')}</div>`:'';
    return`<div class="swipe-row" data-swipe-right="nuisSwipeOK('${escH(zone)}')" data-swipe-left="nuisSwipeNC('${escH(zone)}')">
      <div class="swipe-action swipe-action-del" style="background:#166534">✅ RAS</div>
      <div class="swipe-action swipe-action-right" style="background:#dc2626">⚠️ Présence</div>
      <div class="swipe-row-inner nett-item-row ${rec&&rec.presence==='OUI'?'nett-row-retard':rec?'nett-row-ok':''}">
        <div class="nett-item-info">
          <div class="nett-item-main">
            <span class="nett-zone-badge">${escH(zone)}</span>
            ${statusBadge}
          </div>
          ${actionLine}${cuiLine}
        </div>
        ${btn}
      </div>
    </div>`;
  }).join('');

  return`<div>
    ${statsHtml}
    <div style="font-size:.7rem;color:#b89ab6;margin-bottom:10px;font-weight:700;letter-spacing:.3px">VÉRIFICATION QUOTIDIENNE PAR ZONE</div>
    ${rows||'<div class="empty-s">Aucune zone définie. Ajoutez des zones dans le Référentiel.</div>'}
  </div>`;
}

function renderNuisiblesHisto(){
  const vals=[...nuisiblesVal()].sort((a,b)=>b._ts.localeCompare(a._ts)).slice(0,40);
  if(!vals.length)return`<div class="card"><div class="hh"><span class="hh-title">📜 Historique nuisibles</span><span class="hh-badge">0 saisie</span></div><div class="empty-s">Aucune vérification enregistrée.</div></div>`;
  const rows=vals.map((v,i)=>{
    const nc=v.presence==='OUI';
    const fnDel=`(function(){var all=[...nuisiblesVal()].sort((a,b)=>b._ts.localeCompare(a._ts));var ts=all[${i}]&&all[${i}]._ts;if(!ts)return;showConfirm('🗑 Supprimer ?','Supprimer ce relevé nuisibles ?','🗑 Supprimer',function(){S.nuisibles_val=(S.nuisibles_val||[]).filter(v=>v._ts!==ts);save();renderNav();renderMain();toast('Supprimé');});})()`;
    return`<div class="swipe-row" data-swipe-right="${fnDel}">
      <div class="swipe-action swipe-action-del">🗑 Supprimer</div>
      <div class="swipe-row-inner">
        <div style="font-size:1.1rem;line-height:1;margin-top:1px;flex-shrink:0">${nc?'⚠️':'✅'}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:.88rem;font-weight:800;color:${nc?'#dc2626':'var(--gris)'}">
            ${escH(v.zone)} — <span style="font-weight:600">${nc?'Présence détectée':'RAS'}</span>
          </div>
          ${nc&&v.action?`<div style="font-size:.75rem;color:#dc2626;margin-top:2px">🔧 ${escH(v.action)}</div>`:''}
          <div style="font-size:.72rem;color:#b89ab6;margin-top:2px">${v.date} · ${v.heure||''} · ${escH(v.cuisinier||'—')}</div>
        </div>
      </div>
    </div>`;
  }).join('');
  const ncCount=vals.filter(v=>v.presence==='OUI').length;
  const html=`<div class="card">
    <div class="hh">
      <span class="hh-title">📜 Historique nuisibles</span>
      <span class="hh-badge">${vals.length} entrée${vals.length>1?'s':''}${ncCount>0?` · <span style="color:#dc2626">${ncCount} NC</span>`:''}</span>
    </div>
    <div style="font-size:.68rem;color:#b89ab6;padding:0 14px 6px">← Glisser à droite = supprimer</div>
    <div id="nuis-histo-list" style="padding:0 14px 14px">${rows}</div>
  </div>`;
  setTimeout(function(){initSwipeRows(document.getElementById('nuis-histo-list'));},120);
  return html;
}

let _nuisiblesModalZone='';
function openNuisiblesModal(zone){
  _nuisiblesModalZone=zone;
  const now=new Date();
  const heure=now.getHours().toString().padStart(2,'0')+':'+now.getMinutes().toString().padStart(2,'0');
  const active=getActiveSession()||'';
  const cuisiniers=S.cuisiniers||[];
  const chefOpts=cuisiniers.length
    ?cuisiniers.map(c=>`<option value="${escH(c)}" ${c===active?'selected':''}>` + escH(c) + `</option>`).join('')
    :`<option value="${escH(active)}">${active||'—'}</option>`;
  document.getElementById('nuis-modal-zone').textContent=zone;
  document.getElementById('nuis-modal-heure').value=heure;
  document.getElementById('nuis-modal-chef').innerHTML=chefOpts;
  document.getElementById('nuis-modal-presence').value='NON';
  document.getElementById('nuis-pres-non').classList.add('on');
  document.getElementById('nuis-pres-oui').classList.remove('on');
  document.getElementById('nuis-action-block').style.display='none';
  document.getElementById('nuis-modal-action').value='';
  document.getElementById('nuis-modal-ov').classList.add('open');
}
function closeNuisiblesModal(){document.getElementById('nuis-modal-ov').classList.remove('open');}
function nuisiblesTogglePresence(val){
  document.getElementById('nuis-modal-presence').value=val;
  const btnOui=document.getElementById('nuis-pres-oui');
  const btnNon=document.getElementById('nuis-pres-non');
  if(val==='OUI'){
    btnOui.classList.add('on'); btnNon.classList.remove('on');
    document.getElementById('nuis-action-block').style.display='block';
  } else {
    btnNon.classList.add('on'); btnOui.classList.remove('on');
    document.getElementById('nuis-action-block').style.display='none';
  }
}
function saveNuisiblesCheck(){
  const presence=document.getElementById('nuis-modal-presence').value;
  const action=document.getElementById('nuis-modal-action').value.trim();
  if(presence==='OUI'&&!action){
    alert('Veuillez renseigner l\'action corrective effectuée.');
    return;
  }
  const heure=document.getElementById('nuis-modal-heure').value;
  const cuisinier=document.getElementById('nuis-modal-chef').value;
  const val={
    _ts:new Date().toISOString(),
    date:today(),
    zone:_nuisiblesModalZone,
    presence,action,heure,cuisinier
  };
  S.nuisibles_val=S.nuisibles_val||[];
  S.nuisibles_val.push(val);
  if(S.nuisibles_val.length>600)S.nuisibles_val=S.nuisibles_val.slice(-600);
  save();
  try { SupaEngine.enqueue('nuisibles_val', val); } catch(e){}
  closeNuisiblesModal();
  renderNav();
  renderMain();
  if(presence==='NON') toast(`✅ ${_nuisiblesModalZone} — Aucun nuisible détecté`,'success');
  else {
    toast(`⚠️ ${_nuisiblesModalZone} — Présence détectée ! NC enregistrée`,'warning');
    autoBackup();
    toast('🔧 Action corrective enregistrée','success');
    autoCreateNC('ENR28 – Nuisibles','Présence de nuisibles détectée — Zone : '+_nuisiblesModalZone,'Zone '+_nuisiblesModalZone,action,{cause_milieu:'1'});
  }
}
function nuisiblesDelVal(i){
  const all=[...nuisiblesVal()].sort((a,b)=>b._ts.localeCompare(a._ts));
  const ts=all[i]?._ts;
  if(!ts)return;
  S.nuisibles_val=(S.nuisibles_val||[]).filter(v=>v._ts!==ts);
  save();renderNav();renderMain();
}

// ── Historique des validations ────────────────────────
function renderNettHisto(){
  const vals=[...nettVal()].sort((a,b)=>b._ts.localeCompare(a._ts)).slice(0,30);
  const ref=nettRef();
  if(!vals.length)return`<div class="card"><div class="hh"><span class="hh-title">📜 Historique</span><span class="hh-badge">0 saisie</span></div><div class="empty-s">Aucune validation enregistrée.</div></div>`;
  return`<div class="card">
    <div class="hh"><span class="hh-title">📜 Historique des validations</span><span class="hh-badge">${vals.length} (30 dernières)</span></div>
    ${vals.map((v,i)=>{
      const item=ref.find(r=>r.id===v.ref_id)||{zone:'?',materiel:v.ref_id};
      return`<div class="hr-card">
        <div class="hr-card-top" onclick="toggleHR(this)">
          <div style="flex:1;min-width:0">
            <div class="hr-card-main">${escH(item.materiel)} <span style="font-size:.7rem;font-weight:500;color:#b89ab6">— ${escH(item.zone)}</span></div>
            <div class="hr-card-meta">${(v.date?v.date.slice(8,10)+'/'+v.date.slice(5,7)+'/'+v.date.slice(0,4):'—')} ${v.heure||''} · 👨‍🍳 ${escH(v.cuisinier||'—')} · <span class="${v.conforme==='OUI'?'conf-oui':'conf-non'}">${v.conforme||'—'}</span></div>
          </div>
          <div style="display:flex;gap:4px;align-items:flex-start">
            <button onclick="event.stopPropagation();nettDelVal(${i})" style="background:none;border:none;color:#ccc;font-size:.8rem;cursor:pointer;padding:4px;flex-shrink:0" title="Supprimer">🗑</button>
            <span class="hr-expand">▼</span>
          </div>
        </div>
        <div class="hr-card-data">
          <div class="hr-data-grid">
            <div class="hdi"><div class="hdi-label">Zone</div><div class="hdi-val">${escH(item.zone)}</div></div>
            <div class="hdi"><div class="hdi-label">Fréquence</div><div class="hdi-val">${NETT_FREQ_LABEL[item.freq]||''}</div></div>
            <div class="hdi"><div class="hdi-label">Conforme</div><div class="hdi-val ${v.conforme==='OUI'?'conf-oui':'conf-non'}">${v.conforme||'—'}</div></div>
            ${v.commentaire?`<div class="hdi" style="grid-column:1/-1"><div class="hdi-label">Commentaire NC</div><div class="hdi-val">${escH(v.commentaire)}</div></div>`:''}
            ${v.photo_nc?(()=>{let src=v.photo_nc;try{const o=JSON.parse(v.photo_nc);src=o.thumb||src;}catch(e){}return`<div class="hdi" style="grid-column:1/-1"><div class="hdi-label">📸 Photo NC</div><div class="hdi-val"><img src="${src}" style="max-width:100%;max-height:150px;border-radius:8px;border:1.5px solid #fca5a5;margin-top:4px">${typeof v.photo_nc==='string'&&v.photo_nc.startsWith('{')?(()=>{try{const o=JSON.parse(v.photo_nc);return o.file?'<div style="font-size:.62rem;color:#6b7280;margin-top:2px">📁 '+o.file+'</div>':'';}catch(e){return'';}})():''}</div></div>`;})():''}
          </div>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

// ── Modal validation ──────────────────────────────────
let _nettModalId=null;
function openNettModal(refId){
  if(roCheck())return;
  _nettModalId=refId;
  const ref=nettRef();
  const item=ref.find(r=>r.id===refId);
  if(!item)return;
  const now=new Date();
  const heure=now.getHours().toString().padStart(2,'0')+':'+now.getMinutes().toString().padStart(2,'0');
  const active=getActiveSession()||'';
  const cuisiniers=(S.cuisiniers||[]);
  const chefOpts=cuisiniers.length
    ?cuisiniers.map(c=>`<option value="${escH(c)}" ${c===active?'selected':''}>${escH(c)}</option>`).join('')
    :`<option value="${escH(active)}">${active||'—'}</option>`;

  document.getElementById('nett-modal-title').textContent=item.materiel;
  document.getElementById('nett-modal-zone').textContent=item.zone+' · '+NETT_FREQ_LABEL[item.freq];
  document.getElementById('nett-modal-produit').textContent=item.produit||'';
  document.getElementById('nett-modal-heure').value=heure;
  document.getElementById('nett-modal-chef').innerHTML=chefOpts;
  document.getElementById('nett-modal-conf').value='OUI';
  document.getElementById('nett-conf-oui').classList.add('on');
  document.getElementById('nett-conf-non').classList.remove('on');
  document.getElementById('nett-modal-comment').value='';
  document.getElementById('nett-modal-ov').classList.add('open');
}
function closeNettModal(){
  _nettNCPhoto = null;
  const zone = document.getElementById('nett-photo-zone');
  if(zone) zone.style.display='none';
  const prev = document.getElementById('nett-photo-preview');
  if(prev) prev.innerHTML='';document.getElementById('nett-modal-ov').classList.remove('open');}
let _nettNCPhoto = null;

function nettNCHandlePhoto(input){
  const file = input.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      // Pleine résolution compressée → téléchargement tablette
      const c = document.createElement('canvas');
      const maxW=1200, maxH=900;
      let w=img.width, h=img.height;
      if(w>maxW){h=Math.round(h*maxW/w);w=maxW;}
      if(h>maxH){w=Math.round(w*maxH/h);h=maxH;}
      c.width=w; c.height=h;
      c.getContext('2d').drawImage(img,0,0,w,h);
      const full = c.toDataURL('image/jpeg', 0.78);
      // Téléchargement immédiat sur la tablette
      const d=today(); const df=d.slice(8,10)+'-'+d.slice(5,7)+'-'+d.slice(0,4);
      const fname='HACCP_NC_Nettoyage_'+df+'.jpg';
      const a=document.createElement('a'); a.href=full; a.download=fname;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      // Miniature pour stockage localStorage
      const ct=document.createElement('canvas'); const maxT=280;
      let tw=img.width,th=img.height;
      if(tw>maxT){th=Math.round(th*maxT/tw);tw=maxT;}
      ct.width=tw; ct.height=th;
      ct.getContext('2d').drawImage(img,0,0,tw,th);
      const thumb=ct.toDataURL('image/jpeg', 0.6);
      _nettNCPhoto = JSON.stringify({thumb, file:fname, date:d});
      const prev = document.getElementById('nett-photo-preview');
      if(prev) prev.innerHTML = '<img src="'+thumb+'" style="max-width:100%;max-height:160px;border-radius:8px;border:1.5px solid #86efac;margin-top:4px">'
        +'<div style="font-size:.68rem;color:#166534;font-weight:700;margin-top:4px">✅ Photo enregistrée sur la tablette ('+fname+')</div>';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function saveNettVal(){
  if(!_nettModalId)return;
  const heure=document.getElementById('nett-modal-heure').value;
  const cuisinier=document.getElementById('nett-modal-chef').value;
  const conforme=document.getElementById('nett-modal-conf').value;
  const commentaire=document.getElementById('nett-modal-comment').value.trim();
  // Si NC : photo recommandée mais non-bloquante
  if(conforme==='NON' && !_nettNCPhoto){
    showConfirm(
      '📸 Photo manquante',
      'La réglementation recommande une photo pour les NC. Valider sans photo ?',
      '⚠️ Valider sans photo',
      function(){ _doSaveNettVal(heure,cuisinier,conforme,commentaire); }
    );
    return;
  }
  _doSaveNettVal(heure,cuisinier,conforme,commentaire);
}
function _doSaveNettVal(heure,cuisinier,conforme,commentaire){
  const nettItems = nettRef();
  const item = nettItems.find(r=>r.id===_nettModalId)||{materiel:'?',zone:'',produit:''};
  const val={
    _ts:new Date().toISOString(),
    ref_id:_nettModalId,
    zone: item.zone || '',
    materiel: item.materiel || '',
    produit_nett: item.produit || '',
    date:today(),
    heure,cuisinier,conforme,commentaire,
    ...(conforme==='NON' && _nettNCPhoto ? {photo_nc:_nettNCPhoto} : {})
  };
  S.nett_val=S.nett_val||[];
  S.nett_val.push(stampEntry(val));
  // Garder max 500 validations
  if(S.nett_val.length>500)S.nett_val=S.nett_val.slice(-500);
  save();
  // ── Supabase sync ──
  try { SupaEngine.enqueue('enr28', {...val, _sec:'enr28'}); } catch(e){}
  closeNettModal();
  renderNav();
  renderMain();
  toast(`✅ ${item.materiel} — nettoyage validé${conforme==='NON'?' ⚠️ NC':''}`, conforme==='OUI'?'success':'warning');
  if(conforme==='NON'){
    toast('⚠️ Non-conforme : recommencer le nettoyage et ouvrir une fiche NC','warning');
    const _nDesc='Nettoyage non conforme — '+item.materiel+' (Zone : '+(item.zone||'?')+')';
    autoCreateNC('ENR28 – Nettoyage', _nDesc, 'Zone '+(item.zone||item.materiel), commentaire, {cause_mthode:'1'});
  }
}
function nettDelVal(idx){
  const all=[...nettVal()].sort((a,b)=>b._ts.localeCompare(a._ts));
  const ts=all[idx]?._ts;
  if(!ts)return;
  S.nett_val=(S.nett_val||[]).filter(v=>v._ts!==ts);
  save();renderNav();renderMain();
}

// ── Gestion référentiel ───────────────────────────────
function nettResetRef(){
  nettAdminGuard(()=>{
    showConfirm('Réinitialiser le référentiel','Remettre la liste par défaut ? Les éléments personnalisés seront perdus.','↺ Réinitialiser',()=>{
    S.nett_ref=JSON.parse(JSON.stringify(NETT_REF_DEFAULT));
    save();renderMain();toast('↺ Référentiel réinitialisé','success');
    _saveConfigToSupabase();
    });
  });
}
function nettDelRef(i){
  nettAdminGuard(()=>{
    showConfirm('Supprimer','Supprimer cet élément du plan de nettoyage ?','🗑 Supprimer',()=>{
    nettRef().splice(i,1);save();renderMain();
    _saveConfigToSupabase();
    });
  });
}
// ── Guard admin pour le référentiel nettoyage ────────
function nettAdminGuard(action){
  if(S.adminPin){
    openPinModal({mode:'check', target:'admin', onSuccess: action});
  } else {
    action();
  }
}

function nettDelZone(zone){
  nettAdminGuard(()=>{
    const ref=nettRef();
      const nb=ref.filter(it=>it.zone===zone).length;
      const msg=nb>0
        ? `Supprimer la zone "${zone}" et ses ${nb} élément${nb>1?'s':''} ?`
        : `Supprimer la zone "${zone}" ?`;
      if(!confirm(msg))return;
      S.nett_ref=ref.filter(it=>it.zone!==zone);
      S.nett_zones_extra=(S.nett_zones_extra||[]).filter(z=>z!==zone);
      save();renderMain();toast(`🗑 Zone "${zone}" supprimée`,'success');
      _saveConfigToSupabase();
  });
}
function nettAddZone(){
  nettAdminGuard(()=>{
    showPrompt('Nouvelle zone de nettoyage','','Ex: Vestiaires, Bureau, Réserve...', z=>{
      if(!z) return;
      const exists=nettRef().some(it=>it.zone===z)||(S.nett_zones_extra||[]).includes(z);
      if(exists){toast('Cette zone existe déjà','warning');return;}
      S.nett_zones_extra=S.nett_zones_extra||[];
      S.nett_zones_extra.push(z);
      save();renderMain();toast('✅ Zone "'+z+'" créée — ajoutez-y du matériel','success');
      _saveConfigToSupabase();
    },'Créer');
  });
}

// ── Modal ajout élément ───────────────────────────────
function openNettAddModal(zonePreset){
  // Mettre à jour la datalist avec les zones actuelles
  const zones=[...new Set(nettRef().map(it=>it.zone)),...(S.nett_zones_extra||[])];
  const dl=document.getElementById('nett-zones-list');
  if(dl)dl.innerHTML=zones.map(z=>`<option>${escH(z)}</option>`).join('');
  document.getElementById('nett-add-zone').value=zonePreset||'';
  document.getElementById('nett-add-materiel').value='';
  document.getElementById('nett-add-freq').value='quotidien';
  document.getElementById('nett-add-produit').value='';
  document.getElementById('nett-add-ov').classList.add('open');
  setTimeout(()=>{
    const el=zonePreset
      ? document.getElementById('nett-add-materiel')
      : document.getElementById('nett-add-zone');
    el&&el.focus();
  },200);
}
function closeNettAddModal(){document.getElementById('nett-add-ov').classList.remove('open');}
function saveNettAdd(){
  const zone=document.getElementById('nett-add-zone').value.trim();
  const materiel=document.getElementById('nett-add-materiel').value.trim();
  const freq=document.getElementById('nett-add-freq').value;
  const produit=document.getElementById('nett-add-produit').value.trim();
  if(!zone||!materiel){toast('Zone et matériel obligatoires','warning');return;}
  closeNettAddModal();
  nettAdminGuard(()=>{
    const id='nc_'+Date.now();
    nettRef().push({id,zone,materiel,freq,produit,custom:true});
    S.nett_zones_extra=(S.nett_zones_extra||[]).filter(z=>z!==zone);
    save();
    _saveConfigToSupabase();renderMain();toast(`✅ ${materiel} ajouté dans "${zone}"`, 'success');
    _saveConfigToSupabase();
  });
}

// ════════════════════════════════════════════════════
// ENR30 — Fiche Non-Conformité
// ════════════════════════════════════════════════════
function renderENR30(){
  const d=(S['enr30']||{}).draft||{};const g=k=>d[k]||'';
  const inferredType = inferNCTypeFromValues(g('source'), g('desc'), g('lieu'), d);
  const ncType = normalizeNCType(g('non_conformity_type')||inferredType);
  const suggestedActions = getSuggestedCorrectiveActions(ncType, g('desc'));
  const selectedActionIds = new Set(getSelectedCorrectiveActionIds(d));
  const selectedActionNames = getSelectedCorrectiveActionNames(d);
  const customActionValue = g('action_custom') || (!selectedActionIds.size ? g('action') : '');
  loadCorrectiveActionsCatalog(false);
  // ── Panneau NC auto à compléter (depuis lignes ENR30) ──
  const autoOpen=((S['enr30']||{}).lignes||[]).map((r,i)=>({r,i})).filter(({r})=>r._auto===true&&r.cloture!=='OUI');
  let pendingHtml='';
  if(autoOpen.length>0){
    const rows=autoOpen.map(({r,i})=>`
      <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid #fca5a5">
        <div style="font-size:1.1rem;flex-shrink:0">🚨</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:.8rem;font-weight:800;color:#991b1b">${escH(r.lieu||r.desc||'')}</div>
          <div style="font-size:.75rem;color:#7f1d1d;margin-top:2px">${escH(r.desc||'')}</div>
          ${r.action?`<div style="font-size:.7rem;color:#dc2626;margin-top:2px">🔧 ${escH(r.action)}</div>`:''}
          <div style="font-size:.67rem;color:#b89ab6;margin-top:3px">${r.date||''} · ${r.heure_nc||''} · N° ${r.num||'—'}</div>
        </div>
        <div style="flex-shrink:0">
          <button onclick="ncAutoFillFromLigne(${i})" style="background:#dc2626;color:#fff;border:none;border-radius:8px;padding:7px 11px;font-size:.72rem;font-weight:800;font-family:inherit;cursor:pointer">📋 Compléter</button>
        </div>
      </div>`).join('');
    pendingHtml=`<div class="card" style="border:2px solid #fca5a5;background:#fef2f2;margin-bottom:10px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div style="font-size:.85rem;font-weight:900;color:#991b1b">⚠️ ${autoOpen.length} NC à compléter</div>
        <span style="background:#dc2626;color:#fff;border-radius:20px;padding:2px 9px;font-size:.7rem;font-weight:900">${autoOpen.length}</span>
      </div>
      <div style="font-size:.72rem;color:#7f1d1d;margin-bottom:8px">Générées automatiquement — cliquez <strong>Compléter</strong> pour remplir la fiche officielle.</div>
      ${rows}
    </div>`;
  }
  const causes=["Méthode","Milieu","Matériel","Matière première","Main d'œuvre","Autre"];
  const traits=["Produit jeté","Produit conservé","Bloqué reprise fournisseur","Autre"];
  return pendingHtml+`<div class="card">
    <div class="card-title">🚨 Fiche de Non-Conformité</div>
    <div class="regle danger">Compléter dès détection. Format N° : 2025/01</div>
    <div class="fgrid">
      <div class="fg"><label>N° NC</label><input class="fi" type="text" value="${escH(g('num'))}" placeholder="2025/01" oninput="nc30('num',this.value)"></div>
      <div class="fg"><label>Date</label>
        <button class="dp-trigger" id="dpf-date-enr30"
          data-fid="date" data-sec="enr30"
          onclick="dpOpenForField(this,{max:today()})">
          <span class="dp-ico">📅</span>
          <span class="dp-val">${(()=>{const v=g('date')||today();return new Date(v+'T12:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'});})()} </span>
          <span style="font-size:.7rem;color:#c0a0c0">▼</span>
        </button></div>
      ${timeBtnHtml('heure_nc','enr30','Heure',true)}
      ${chefSel('nom_fct','enr30','Cuisinier / Responsable')}
    </div>
    <div class="fg full" style="margin-bottom:10px"><label>Description de la NC</label><textarea rows="3" class="fi" oninput="nc30('desc',this.value)">${escH(g('desc'))}</textarea></div>
    <div class="fg full" style="margin-bottom:10px"><label>Lieu du constat</label><input class="fi" type="text" value="${escH(g('lieu'))}" oninput="nc30('lieu',this.value)"></div>
    <div class="fg full nc-type-wrap">
      <label>Type de non-conformité</label>
      <div class="nc-type-grid">
        ${NC_TYPE_OPTIONS.map(t=>`<button class="nc-type-btn${ncType===t.key?' active':''}" onclick="nc30SetType('${t.key}')">${t.label}</button>`).join('')}
      </div>
      <div class="nc-type-hint">Détection auto: <strong>${NC_TYPE_LABELS[inferredType]||NC_TYPE_LABELS.autre}</strong> · modifiable en 1 tap.</div>
    </div>
    <div class="fg full" style="margin-bottom:12px"><label>Cause probable</label><div class="ck-grid">${causes.map(c=>{const k='cause_'+c.replace(/[^a-z]/gi,'').toLowerCase();return`<div class="ckg"><input type="checkbox" id="nc_${k}" ${g(k)?'checked':''} onchange="nc30('${k}',this.checked?'1':'')"><label for="nc_${k}">${c}</label></div>`;}).join('')}</div></div>
    <div class="fg full nc-actions-wrap">
      <label>Actions correctives suggérées</label>
      <div class="nc-actions-grid">
        ${suggestedActions.map(a=>`<button class="nc-action-btn${selectedActionIds.has(a.id)?' selected':''}${a.recommended?' recommended':''}" onclick="nc30ToggleCorrectiveAction('${a.id}')">
          <span class="nc-action-name">${escH(a.name)}</span>
          ${a.description?`<span class="nc-action-desc">${escH(a.description)}</span>`:''}
          ${a.recommended?'<span class="nc-action-pill">Recommandée</span>':''}
        </button>`).join('')}
      </div>
      ${suggestedActions.length===0?'<div class="nc-type-hint">Aucune action liée à ce type. Saisissez une action personnalisée ci-dessous.</div>':''}
      <div class="nc-selected-summary">
        ${selectedActionNames.length?`✅ Sélection: ${escH(selectedActionNames.join(' · '))}`:'⚠️ Sélectionnez au moins une action rapide ou saisissez une action personnalisée.'}
      </div>
      <div style="margin-top:8px">
        <label style="font-size:.74rem;color:var(--gris2)">Action personnalisée (optionnelle)</label>
        <textarea rows="2" class="fi" placeholder="Ex: appel maintenance, retrait immédiat du lot..." oninput="nc30('action_custom',this.value)">${escH(customActionValue)}</textarea>
      </div>
    </div>
    <div class="fg full" style="margin-bottom:12px"><label>Traitement du produit</label><div class="ck-grid">${traits.map(t=>{const k='trait_'+t.replace(/[^a-z]/gi,'').toLowerCase();return`<div class="ckg"><input type="checkbox" id="nct_${k}" ${g(k)?'checked':''} onchange="nc30('${k}',this.checked?'1':'')"><label for="nct_${k}">${t}</label></div>`;}).join('')}</div></div>
    <div class="fgrid">
      ${chefSel('resp','enr30','Responsable informé')}
      <div class="fg"><div class="cfl">Clôturée ?</div><div class="cfg">
        <button class="cfb oui${g('cloture')==='OUI'?' on':''}" onclick="nc30cf('OUI',this)">✓ OUI</button>
        <button class="cfb non${g('cloture')==='NON'?' on':''}" onclick="nc30cf('NON',this)">✗ NON</button>
      </div></div>
    </div>
    <div class="fg full" style="margin:10px 0"><label>Plan d'action correctif / préventif</label><textarea rows="3" class="fi" oninput="nc30('plan',this.value)">${escH(g('plan'))}</textarea></div>
    <div class="fgrid">
      <div class="fg"><label>Date de réalisation</label>
        <button class="dp-trigger" id="dpf-date_real-enr30"
          data-fid="date_real" data-sec="enr30"
          onclick="dpOpenForField(this,{})">
          <span class="dp-ico">📅</span>
          <span class="dp-val${!g('date_real')?' empty':''}">${g('date_real')?new Date(g('date_real')+'T12:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'}):'Sélectionner'}</span>
          <span style="font-size:.7rem;color:#c0a0c0">▼</span>
        </button></div>
      <div class="fg full" style="margin-top:4px">
        <label>Signature du responsable</label>
        <div style="border:1.5px solid var(--brd);border-radius:12px;overflow:hidden;background:#fdf8fd;margin-top:4px">
          <canvas id="nc30-sig-canvas" width="800" height="180"
            style="display:block;width:100%;height:90px;touch-action:none;cursor:crosshair;"></canvas>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 10px;background:#f9f0f9;border-top:1px solid var(--brd)">
            <span style="font-size:.7rem;color:#b89ab6;font-weight:700">✍️ Signez avec le doigt</span>
            <button onclick="nc30SigClear()" style="background:none;border:none;color:#b89ab6;font-size:.75rem;cursor:pointer;font-family:inherit;font-weight:700">🗑 Effacer</button>
          </div>
        </div>
        <input type="hidden" id="nc30-sig-data" value="${escH(g('signature'))}">
      </div>
    </div>
    <div class="btn-row">
      <button class="btn-save" onclick="nc30Save()">✅ Enregistrer cette NC</button>
      <button class="btn btn-sec" onclick="nc30Reset()">🔄 Effacer</button>
    </div>
    <!-- Photo NC -->
    <div style="margin-top:14px">
      <div style="font-size:.75rem;font-weight:700;color:var(--gris2);margin-bottom:8px">📷 Photo(s) de la non-conformité</div>
      <div style="display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap">
        ${(()=>{
          const stored = g('photo_nc');
          if (stored) {
            let src = stored;
            try { const o = JSON.parse(stored); src = o.thumb || o.url || stored; } catch(e) {}
            return `<div style="position:relative">
              <img src="${src}" style="height:80px;width:80px;object-fit:cover;border-radius:10px;border:2px solid #fca5a5">
              <button onclick="nc30('photo_nc','');renderMain()" style="position:absolute;top:-6px;right:-6px;background:#dc2626;color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:.7rem;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0">✕</button>
            </div>`;
          }
          return '';
        })()}
        <button onclick="openOcrModal('nc30')" style="height:80px;width:80px;border:2px dashed #fca5a5;border-radius:10px;background:#fef2f2;color:#dc2626;font-size:1.4rem;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px">
          📷<span style="font-size:.55rem;font-weight:700">Ajouter</span>
        </button>
      </div>
    </div>
  </div>
  ${renderHistoCard('enr30',null)}`;
}
function nc30(k,v){S['enr30']=S['enr30']||{};S['enr30'].draft=S['enr30'].draft||{};S['enr30'].draft[k]=v;save();}

// ── Pad de signature ENR30 ────────────────────────────
let _nc30SigDrawing=false,_nc30SigLast=null,_nc30SigPrev=null;
function nc30SigInit(){
  const c=document.getElementById('nc30-sig-canvas');if(!c)return;
  const ctx=c.getContext('2d');
  ctx.strokeStyle='#3a0a3a';ctx.lineWidth=2.5;ctx.lineCap='round';ctx.lineJoin='round';
  ctx.fillStyle='#fdf8fd';ctx.fillRect(0,0,c.width,c.height);
  // Si signature existante, l'afficher
  const stored=document.getElementById('nc30-sig-data')?.value;
  if(stored&&stored.startsWith('data:')){
    const img=new Image();img.onload=()=>ctx.drawImage(img,0,0,c.width,c.height);img.src=stored;
  }
  const pt=e=>{const r=c.getBoundingClientRect();const s=e.touches?e.touches[0]:e;const sx=c.width/r.width,sy=c.height/r.height;return{x:(s.clientX-r.left)*sx,y:(s.clientY-r.top)*sy};};
  let _pts30=[];
  const start=e=>{
    e.preventDefault();_nc30SigDrawing=true;_nc30SigLast=pt(e);_nc30SigPrev=null;_pts30=[_nc30SigLast];
    ctx.beginPath();ctx.moveTo(_nc30SigLast.x,_nc30SigLast.y);
  };
  const move=e=>{
    e.preventDefault();if(!_nc30SigDrawing)return;
    const p=pt(e);_pts30.push(p);
    const n=_pts30.length;
    ctx.beginPath();
    if(n>=3){
      const p0=_pts30[n-3],p1=_pts30[n-2],p2=_pts30[n-1];
      const mx=(p1.x+p2.x)/2,my=(p1.y+p2.y)/2;
      ctx.moveTo((p0.x+p1.x)/2,(p0.y+p1.y)/2);
      ctx.quadraticCurveTo(p1.x,p1.y,mx,my);
    } else {ctx.moveTo(_nc30SigLast.x,_nc30SigLast.y);ctx.lineTo(p.x,p.y);}
    ctx.stroke();_nc30SigLast=p;
  };
  const stop=e=>{
    e.preventDefault();_nc30SigDrawing=false;
    if(_pts30.length>3){
      // Compresser immédiatement en JPEG 400px pour économiser de l'espace
      try {
        const sig = document.createElement('canvas');
        const maxW = 400;
        let w = c.width, h = c.height;
        if(w > maxW){h = Math.round(h*maxW/w); w = maxW;}
        sig.width = w; sig.height = h;
        const sctx = sig.getContext('2d');
        sctx.fillStyle = '#fff'; sctx.fillRect(0,0,w,h);
        sctx.drawImage(c,0,0,w,h);
        nc30('signature', sig.toDataURL('image/jpeg', 0.75));
      } catch(ex) {
        nc30('signature', c.toDataURL('image/jpeg', 0.75));
      }
    }
    _pts30=[];
  };
  c.removeEventListener('mousedown',start);c.removeEventListener('mousemove',move);c.removeEventListener('mouseup',stop);
  c.removeEventListener('touchstart',start);c.removeEventListener('touchmove',move);c.removeEventListener('touchend',stop);
  c.addEventListener('mousedown',start);c.addEventListener('mousemove',move);c.addEventListener('mouseup',stop);
  c.addEventListener('touchstart',start,{passive:false});c.addEventListener('touchmove',move,{passive:false});c.addEventListener('touchend',stop,{passive:false});
}
function nc30SigClear(){
  const c=document.getElementById('nc30-sig-canvas');if(!c)return;
  const ctx=c.getContext('2d');ctx.fillStyle='#fdf8fd';ctx.fillRect(0,0,c.width,c.height);
  nc30('signature','');
}
function nc30cf(v,el){nc30('cloture',v);el.parentElement.querySelectorAll('.cfb').forEach(b=>b.classList.toggle('on',b===el));}
function nc30Save(){
  const d=(S['enr30']||{}).draft||{};
  S['enr30']=S['enr30']||{};S['enr30'].lignes=S['enr30'].lignes||[];
  const selectedActionIds = getSelectedCorrectiveActionIds(d);
  const selectedActionNames = getSelectedCorrectiveActionNames(d);
  const customActionRaw = String(d.action_custom||'').trim();
  const legacyFallback = (!customActionRaw && selectedActionIds.length===0)
    ? sanitizeLegacyCorrectiveAction(d.action,d.desc)
    : '';
  const customAction = customActionRaw || legacyFallback;
  if(selectedActionIds.length===0 && !customAction){
    toast('⚠️ Sélectionnez au moins une action corrective ou saisissez une action personnalisée.','warning');
    return;
  }
  const actionCatalogById = new Map((_ncCatalog().actions||[]).map(a=>[a.id,a]));
  const resolvedActionNames = selectedActionIds.map((id,i)=>actionCatalogById.get(id)?.name||selectedActionNames[i]||'').filter(Boolean);
  const actor = d.nom_fct || d.resp || getActiveSession() || '';
  const nowIso = new Date().toISOString();
  d.non_conformity_type = normalizeNCType(d.non_conformity_type||inferNCTypeFromValues(d.source,d.desc,d.lieu,d));
  d.corrective_action_ids = selectedActionIds;
  d.corrective_action_names = resolvedActionNames;
  d.corrective_action_custom = customAction;
  d.action_custom = customAction;
  d.corrective_action_trace = [
    ...selectedActionIds.map((id,i)=>({
      corrective_action_id:id,
      action_name:resolvedActionNames[i]||id,
      selected_by:actor,
      selected_at:nowIso,
      non_conformity_type:d.non_conformity_type,
      is_custom:false
    })),
    ...(customAction ? [{
      corrective_action_id:null,
      action_name:customAction,
      selected_by:actor,
      selected_at:nowIso,
      non_conformity_type:d.non_conformity_type,
      is_custom:true
    }] : [])
  ];
  const actionSummary = [...resolvedActionNames, ...(customAction?[customAction]:[])].join(' | ');
  d.action = actionSummary;

  // La signature est déjà compressée en JPEG 400px (fait dans nc30SigInit stop)
  // Si c'est encore un PNG lourd (anciennes saisies), on le compresse maintenant
  if (d.signature && d.signature.startsWith('data:image/png')) {
    try {
      const c2 = document.createElement('canvas');
      c2.width = 400; c2.height = 120;
      const ctx2 = c2.getContext('2d');
      ctx2.fillStyle = '#fff'; ctx2.fillRect(0,0,400,120);
      const img2 = new Image();
      img2.src = d.signature;
      ctx2.drawImage(img2,0,0,400,120);
      d.signature = c2.toDataURL('image/jpeg',0.7);
      S['enr30'].draft.signature = d.signature;
    } catch(e) {}
  }

  // ── Photo NC : nommer avec date+num NC ──
  if (_pendingPhotos['nc30']) {
    const dateNC = d.date || today();
    const df = dateNC.slice(8,10)+'-'+dateNC.slice(5,7)+'-'+dateNC.slice(0,4);
    const fname = 'NC_'+df+'_'+(d.num||'').replace(/[^a-zA-Z0-9]/g,'_')+'.jpg';
    // Uploader la photo via SupaEngine (sera gérée dans flush)
    _pendingPhotos['nc30_named'] = _pendingPhotos['nc30'];
    delete _pendingPhotos['nc30'];
    // Mettre à jour la référence dans le draft avec le nom
    if (d.photo_nc) {
      try {
        const ref = JSON.parse(d.photo_nc);
        ref.file = fname;
        d.photo_nc = JSON.stringify(ref);
        S['enr30'].draft.photo_nc = d.photo_nc;
      } catch(e) {}
    }
  }

  // ── Si la NC vient d'une ligne auto existante : mettre à jour au lieu d'ajouter ──
  if(d._auto_ligne_idx!==undefined){
    const li=parseInt(d._auto_ligne_idx);
    if(S['enr30'].lignes[li]){
      Object.assign(S['enr30'].lignes[li],{...d,_auto:false,cloture:d.cloture||'OUI',_ts_completed:new Date().toISOString()});
      delete S['enr30'].lignes[li]._auto_ligne_idx;
    }
    // Retirer du pending via _key
    if(S['enr30'].lignes[li]?._key){
      const key=S['enr30'].lignes[li]._key;
      S.nc_auto_pending=(S.nc_auto_pending||[]).filter(p=>p._key!==key);
    }
  } else {
    S['enr30'].lignes.unshift(stampEntry({...d,_ts:new Date().toISOString()}));
    // Retirer la NC auto-pending par _auto_idx si présent
    if(d._auto_idx!==undefined){
      const idx=parseInt(d._auto_idx);
      const all=[...(S.nc_auto_pending||[])];
      if(idx>=0&&idx<all.length)all.splice(idx,1);
      S.nc_auto_pending=all;
    }
  }
  S['enr30'].draft={};save();autoBackup();
  // ── Supabase : UPSERT par client_id déterministe ──────────
  // merge-duplicates = si le client_id existe déjà → UPDATE, sinon INSERT
  // Garantit qu'il n'y aura jamais un record ouvert + un fermé pour la même NC
  try {
    const dernNC = d._auto_ligne_idx!==undefined
      ? S['enr30'].lignes[parseInt(d._auto_ligne_idx)]
      : S['enr30'].lignes[0];
    if(dernNC && dernNC._ts){
      const c = SupaEngine.cfg();
      if(c.url && c.anonKey && c.siteId){
        const stableId = [c.siteId,'enr30',dernNC._ts]
          .join('::').replace(/[^a-zA-Z0-9:._-]/g,'_').slice(0,200);
        const hdrs = {
          'apikey': c.anonKey,
          'Authorization': `Bearer ${c.userToken||c.anonKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=minimal',
        };
        const payload = {
          site_id: c.siteId,
          enr_type: 'enr30',
          data: dernNC,
          recorded_at: dernNC._ts,
          client_id: stableId,
          ...(c.tenantId ? {tenant_id: c.tenantId} : {}),
        };
        fetch(`${c.url}/rest/v1/pms_records`, {method:'POST', headers:hdrs, body:JSON.stringify(payload)})
          .then(r => {
            if(!r.ok) r.text().then(t => {
              console.warn('[nc30] UPSERT HTTP',r.status,t.slice(0,80));
              // Fallback : PATCH direct par _ts dans data
              fetch(`${c.url}/rest/v1/pms_records?site_id=eq.${encodeURIComponent(c.siteId)}&enr_type=eq.enr30&data->>_ts=eq.${encodeURIComponent(dernNC._ts)}&select=id`, {
                headers:{'apikey':c.anonKey,'Authorization':`Bearer ${c.userToken||c.anonKey}`,'Accept':'application/json'}
              }).then(r2=>r2.ok?r2.json():[]).then(rows=>{
                rows.forEach(row=>{
                  fetch(`${c.url}/rest/v1/pms_records?id=eq.${row.id}`,{
                    method:'PATCH',
                    headers:{...hdrs,'Prefer':'return=minimal'},
                    body:JSON.stringify({data:dernNC})
                  });
                });
              }).catch(()=>SupaEngine.enqueue('enr30',dernNC));
            });
            else console.log('[nc30] UPSERT OK ✅');
          })
          .catch(()=>SupaEngine.enqueue('enr30',dernNC));
      }
    }
  } catch(e){ try{SupaEngine.enqueue('enr30',S['enr30']?.lignes?.[0]);}catch{} }
  goTo('enr30');toast('✅ NC enregistrée et clôturée','success');
}
function nc30Reset(){S['enr30']=S['enr30']||{};S['enr30'].draft={};save();goTo('enr30');}

// ════════════════════════════════════════════════════
// HISTORIQUE & RECHERCHE AVANCÉE
// ════════════════════════════════════════════════════
function renderSearch(){
  const ncOuvertes=((S['enr30']&&S['enr30'].lignes)||[]).filter(r=>r.cloture!=='OUI').length;
  const temoinsPerimes=((S['enr33']&&S['enr33'].lignes)||[]).filter(r=>r.date_destruct&&r.date_destruct<=today()&&!r._jete).length;
  const quickFilters=[
    ncOuvertes>0?`<button onclick="document.getElementById('sq').value='';document.getElementById('sc').value='ponctuel';document.getElementById('sf-hidden')&&(document.getElementById('sf-hidden').value='');doSearch();setTimeout(()=>{const r=document.getElementById('sr');if(r){[...r.querySelectorAll('.hdi-item')].filter(el=>!el.innerText.includes('clôturée')||el.innerText.includes('ouvert')).forEach(el=>el.style.outline='2px solid #dc2626');}},200)" style="padding:5px 12px;background:#fee2e2;border:1.5px solid #fca5a5;border-radius:20px;font-size:.71rem;font-weight:800;color:#991b1b;cursor:pointer;font-family:inherit;white-space:nowrap">📋 NC ouvertes (${ncOuvertes})</button>`:null,
    temoinsPerimes>0?`<button onclick="document.getElementById('sq').value='';document.getElementById('sc').value='etiq';doSearch()" style="padding:5px 12px;background:#fee2e2;border:1.5px solid #fca5a5;border-radius:20px;font-size:.71rem;font-weight:800;color:#991b1b;cursor:pointer;font-family:inherit;white-space:nowrap">🍱 Témoins périmés (${temoinsPerimes})</button>`:null,
    `<button onclick="document.getElementById('sq').value='';document.getElementById('sc').value='';const hid=document.getElementById('sf-hidden');if(hid)hid.value='${today()}';document.getElementById('sf').value='${today()}';const btn=document.getElementById('dpf-sf-search');if(btn){const sp=btn.querySelector('.dp-val');if(sp){sp.textContent='Aujourd\\'hui';sp.classList.remove('empty');}}doSearch()" style="padding:5px 12px;background:#f0e4f0;border:1.5px solid var(--plum);border-radius:20px;font-size:.71rem;font-weight:800;color:var(--plum);cursor:pointer;font-family:inherit;white-space:nowrap">📅 Aujourd'hui</button>`,
    `<button onclick="document.getElementById('sq').value='';document.getElementById('sc').value='ccp';doSearch()" style="padding:5px 12px;background:#fee2e2;border:1.5px solid #fca5a5;border-radius:20px;font-size:.71rem;font-weight:800;color:#991b1b;cursor:pointer;font-family:inherit;white-space:nowrap">🔴 CCP seulement</button>`,
    `<button onclick="document.getElementById('sq').value='';document.getElementById('sc').value='';const h1=document.getElementById('sf-hidden');const h2=document.getElementById('st-hidden');if(h1)h1.value='';if(h2)h2.value='';document.getElementById('sf').value='';document.getElementById('st').value='';['dpf-sf-search','dpf-st-search'].forEach(id=>{const b=document.getElementById(id);if(b){const sp=b.querySelector('.dp-val');if(sp){sp.textContent=id.includes('sf')?'Depuis…':'Jusqu\\'au…';sp.classList.add('empty');}}});doSearch()" style="padding:5px 12px;background:var(--fond);border:1.5px solid var(--brd);border-radius:20px;font-size:.71rem;font-weight:700;color:var(--gris2);cursor:pointer;font-family:inherit;white-space:nowrap">✕ Tout effacer</button>`,
  ].filter(Boolean).join('');

  return`<div class="card">
    <div class="card-title">🔍 Historique & Recherche</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${quickFilters}</div>
    <div class="si-wrap"><input type="text" id="sq" placeholder="Plat, cuisinier, fournisseur, N° lot…" oninput="doSearch()"><span class="si-ico">🔍</span></div>
    <div class="f-row">
      <select id="sc" onchange="doSearch()">
        <option value="">Toutes catégories</option>
        <option value="ccp">🔴 CCP</option><option value="prpo">🟠 PrPo</option>
        <option value="mensuel">📅 Mensuels</option><option value="suivi">📋 Suivi</option>
        <option value="etiq">🏷️ Étiquettes</option><option value="ponctuel">⚡ Ponctuels</option>
      </select>
      <button class="dp-trigger" style="flex:1" id="dpf-sf-search" onclick="openDP(document.getElementById('sf-hidden')?.value||'', (v)=>{const h=document.getElementById('sf-hidden');if(!h){const i=document.createElement('input');i.id='sf-hidden';i.type='hidden';i.value=v;document.body.appendChild(i);}else h.value=v;const el=document.getElementById('dpf-sf-search');if(el){el.querySelector('.dp-val').textContent=new Date(v+'T12:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short'});el.querySelector('.dp-val').classList.remove('empty');}doSearch();},{})">
        <span class="dp-ico" style="font-size:.85rem">📅</span>
        <span class="dp-val empty" style="font-size:.8rem">Depuis…</span>
      </button>
      <input type="hidden" id="sf">
      <button class="dp-trigger" style="flex:1" id="dpf-st-search" onclick="openDP(document.getElementById('st-hidden')?.value||'', (v)=>{const h=document.getElementById('st-hidden');if(!h){const i=document.createElement('input');i.id='st-hidden';i.type='hidden';i.value=v;document.body.appendChild(i);}else h.value=v;const el=document.getElementById('dpf-st-search');if(el){el.querySelector('.dp-val').textContent=new Date(v+'T12:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short'});el.querySelector('.dp-val').classList.remove('empty');}doSearch();},{})">
        <span class="dp-ico" style="font-size:.85rem">📅</span>
        <span class="dp-val empty" style="font-size:.8rem">Jusqu'au…</span>
      </button>
      <input type="hidden" id="st">
      <select id="sgr" onchange="doSearch()">
        <option value="day">Par jour</option>
        <option value="month">Par mois</option>
        <option value="year">Par année</option>
        <option value="sec">Par type de fiche</option>
      </select>
    </div>
    <div id="sr-stats"></div>
    <div id="sr"></div>
  </div>`;
}

// ── Formateurs de date pour doSearch (doivent être définis AVANT doSearch) ──────
const fmtM=s=>{if(!s?.includes('-'))return s||'?';const[y,m]=s.split('-');return['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'][parseInt(m)-1]+' '+y;};
const fmtDay=s=>{try{return new Date(s+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});}catch{return s||'?';}};

function doSearch(){
  try{
  const q=(document.getElementById('sq')?.value||'').toLowerCase().trim();
  const cat=document.getElementById('sc')?.value||'';
  // Lire les filtres date depuis sf-hidden OU sf (sf-hidden peut persister entre navigations)
  // On ne considère le filtre date que si le bouton dp-trigger montre une valeur non vide
  const sfBtn=document.getElementById('dpf-sf-search');
  const stBtn=document.getElementById('dpf-st-search');
  const sfBtnEmpty=!sfBtn||sfBtn.querySelector('.dp-val')?.classList.contains('empty');
  const stBtnEmpty=!stBtn||stBtn.querySelector('.dp-val')?.classList.contains('empty');
  const df=sfBtnEmpty?'':(document.getElementById('sf-hidden')?.value||document.getElementById('sf')?.value||'');
  const dt=stBtnEmpty?'':(document.getElementById('st-hidden')?.value||document.getElementById('st')?.value||'');
  const gr=document.getElementById('sgr')?.value||'day';

  // Filtre commun date + texte
  const pass=(r,dv)=>{
    if(df&&dv&&dv<df)return false;
    if(dt&&dv&&dv>dt)return false;
    if(q){try{if(!JSON.stringify(r).toLowerCase().includes(q))return false;}catch{return false;}}
    return true;
  };

  const raw=[];

  // ── Sources principales (toutes les fiches ENR avec .lignes) ──
  ALL.filter(s=>s.id!=='accueil'&&s.id!=='search').forEach(s=>{
    if(cat&&s.cat!==cat)return;
    ((S[s.id]||{}).lignes||[]).forEach(r=>{
      const dv=r.date||r.dt?.slice(0,10)||r._ts?.slice(0,10)||'';
      if(!pass(r,dv))return;
      raw.push({s,r,date:dv,_ts:r._ts||''});
    });
  });

  // ── ENR19 : saisies enceintes ──
  if(!cat||cat==='prpo'){
    const s19={id:'enr19',short:'🌡️ T°C Enceintes',cat:'prpo'};
    const encs19=getEnceintes();
    (S['enr19']?.saisies||[]).forEach(r=>{
      const dv=r.date||r._ts?.slice(0,10)||'';
      const enc=encs19.find(e=>e.id===r.enc_id);
      const rE={...r,produit:enc?enc.label:(r.enc_id||'Enceinte'),
        _moment:r.moment==='ouv'?'🌅 Ouverture':'🌙 Fermeture',
        _conformite:encConforme(r.temp,enc?.consigne)?'OUI':(r.temp?'NON':''),tc:r.temp};
      if(!pass(rE,dv))return;
      raw.push({s:s19,r:rE,date:dv,_ts:r._ts||''});
    });
  }

  // ── ENR_TC_DISTRIB et services dynamiques ──
  if(!cat||cat==='prpo'){
    const allDistribKeys=['enr_tc_distrib',...getDistribServices().map(svc=>'enr_distrib_'+svc.id)];
    allDistribKeys.forEach(key=>{
      const svc=getDistribServices().find(svc=>'enr_distrib_'+svc.id===key);
      const sLabel={id:key,short:svc?svc.ico+' '+svc.label:'🌡️ T°C Distribution',cat:'prpo'};
      ((S[key]||{}).lignes||[]).forEach(r=>{
        const dv=r.date||r._ts?.slice(0,10)||'';
        if(!pass(r,dv))return;
        raw.push({s:sLabel,r,date:dv,_ts:r._ts||''});
      });
    });
  }

  // ── Nettoyage nett_val ──
  if(!cat||cat==='prpo'){
    const sNett={id:'enr28',short:'🧹 Nettoyage',cat:'prpo'};
    (S.nett_val||[]).forEach(r=>{
      const dv=r.date||r._ts?.slice(0,10)||'';
      if(!pass(r,dv))return;
      raw.push({s:sNett,r,date:dv,_ts:r._ts||''});
    });
  }

  // ── Nuisibles ──
  if(!cat||cat==='prpo'){
    const sNuis={id:'enr28',short:'🐀 Nuisibles',cat:'prpo'};
    (S.nuisibles_val||[]).forEach(r=>{
      const dv=r.date||r._ts?.slice(0,10)||'';
      if(!pass(r,dv))return;
      raw.push({s:sNuis,r,date:dv,_ts:r._ts||''});
    });
  }

  // ── Déduplication stricte par (section + _ts) ──
  const seen=new Set();
  const all=raw.filter(item=>{
    const key=item.s.id+'||'+item._ts;
    if(!item._ts) return true; // garder les sans _ts
    if(seen.has(key)) return false;
    seen.add(key); return true;
  });

  all.sort((a,b)=>(b.date+b._ts).localeCompare(a.date+a._ts));
  const statEl=document.getElementById('sr-stats');
  const resEl=document.getElementById('sr');
  if(!statEl||!resEl)return;
  const nc=all.filter(({r})=>CONF_FIDS.some(k=>r[k]==='NON')).length;
  statEl.innerHTML=`<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
    <div style="background:#f8f0f8;border-radius:10px;padding:8px 13px;font-size:.81rem;font-weight:700;color:var(--plum)">${all.length} enregistrement${all.length!==1?'s':''}</div>
    ${nc>0?`<div style="background:#fee2e2;border-radius:10px;padding:8px 13px;font-size:.81rem;font-weight:700;color:#991b1b">⚠️ ${nc} non-conforme${nc>1?'s':''}</div>`:''}
  </div>`;
  if(all.length===0){resEl.innerHTML=`<div style="color:#b89ab6;text-align:center;padding:24px;font-size:.86rem">Aucun résultat.</div>`;return;}
  // Grouper
  const groups={};
  all.forEach(item=>{
    let key;
    if(gr==='day')key=item.date||'Sans date';
    else if(gr==='month')key=item.date?.slice(0,7)||'Sans date';
    else if(gr==='year')key=item.date?.slice(0,4)||'Sans date';
    else key=item.s.label||item.s.short;
    if(!groups[key])groups[key]=[];
    groups[key].push(item);
  });
  const keys=Object.keys(groups).sort((a,b)=>gr==='sec'?a.localeCompare(b):b.localeCompare(a));
  resEl.innerHTML=keys.map(k=>{
    const items=groups[k];
    const ncc=items.filter(({r})=>CONF_FIDS.some(f=>r[f]==='NON')).length;
    const keyDisp=gr==='month'?fmtM(k):gr==='day'?fmtDay(k):k;
    const rows=items.slice(0,60).map(({s,r})=>{
      const prod=r.produit||r.fournisseur||r.association||r.theme||r.num||'—';
      const heure=r.heure||r.h||r.h_deb||'';
      const cuisinier=r.cuisinier||r.operateur||r.visa||'';
      const confBadges=CONF_FIDS.filter(f=>r[f]==='OUI'||r[f]==='NON').slice(0,4)
        .map(f=>`<span class="bo ${r[f]==='OUI'?'oui':'non'}">${FLAB[f]||f}: ${r[f]}</span>`).join(' ');
      const dataKeys=Object.keys(r).filter(f=>{try{return!SKIP.includes(f)&&r[f]&&String(r[f]).trim();}catch{return false;}});
      const dataGrid=dataKeys.map(f=>{
        try{
        const lbl=FLAB[f]||f;const val=String(r[f]);
        const isConf=IS_CONF_FID(f);const isT=IS_TEMP_FID(f);
        const cls=isConf?(val==='OUI'?'conf-oui':val==='NON'?'conf-non':''):'';
        const disp=isT&&val!=='OUI'&&val!=='NON'?`${val}°C`:val;
        return`<div class="hdi"><div class="hdi-label">${lbl}</div><div class="hdi-val ${cls}">${disp}</div></div>`;
        }catch{return'';}
      }).join('');
      return`<div class="hr-card">
        <div class="hr-card-top" onclick="toggleHR(this)">
          <div>
            <div class="hr-card-main">${escH(prod)}</div>
            <div class="hr-card-meta">${s.short}${heure?' · ⏰'+heure:''}${cuisinier?' · 👨‍🍳'+escH(cuisinier):''}</div>
            <div class="conf-badges" style="margin-top:5px">${confBadges}</div>
          </div>
          <div style="display:flex;gap:4px;align-items:flex-start;flex-shrink:0">
            <span style="font-size:.8rem;color:#b89ab6;cursor:pointer" onclick="event.stopPropagation();goTo('${s.id}')">✏️</span>
            <span class="hr-expand">▼</span>
          </div>
        </div>
        <div class="hr-card-data"><div class="hr-data-grid">${dataGrid}</div></div>
      </div>`;
    }).join('');
    return`<div style="margin-bottom:14px">
      <div class="grp-hdr">
        <span>${keyDisp}</span>
        <span class="cnt">${items.length} saisie${items.length>1?'s':''}</span>
        ${ncc>0?`<span style="background:#fee2e2;color:#991b1b;border-radius:8px;padding:1px 8px;font-size:.7rem">⚠️ ${ncc} NC</span>`:''}
      </div>
      ${rows}
      ${items.length>60?`<div style="color:#b89ab6;font-size:.78rem;text-align:center;padding:6px">+ ${items.length-60} autres — affinez la recherche</div>`:''}
    </div>`;
  }).join('');
  }catch(e){
    console.error('[doSearch]',e);
    const resEl2=document.getElementById('sr');
    if(resEl2)resEl2.innerHTML=`<div style="color:#dc2626;padding:12px;font-size:.8rem">⚠️ Erreur recherche — rechargez la page (${e.message})</div>`;
  }
}

// ════════════════════════════════════════════════════
// ACCUEIL
// ════════════════════════════════════════════════════
// ════════════════════════════════════════════════════
// ACCUEIL — Tableau de bord HACCP
// ════════════════════════════════════════════════════

function taskStatus(done, urgent, label, icon, action, detail){
  // done: bool, urgent: bool, label: string, icon: string, action: fn string, detail: string
  const cls = done ? 'task-done' : urgent ? 'task-urgent' : 'task-todo';
  const badge = done ? '✅' : urgent ? '🔴' : '⏳';
  return `<div class="task-row ${cls}" onclick="${action}">
    <span class="task-icon">${icon}</span>
    <div class="task-body">
      <div class="task-label">${label}</div>
      ${detail?`<div class="task-detail">${detail}</div>`:''}
    </div>
    <span class="task-badge">${badge}</span>
    ${!done?`<span class="task-arrow">›</span>`:''}
  </div>`;
}

function accueilTaches(){
  const now = new Date();
  const h = now.getHours();
  const todayStr = today();
  const mois = S.config?.mois || todayStr.slice(0,7);
  const tasks = [];

  // ── 1. T°C ENCEINTES OUVERTURE ─────────────────────
  const encs = getEnceintes();
  const saisiesEnc = S['enr19']?.saisies||[];
  const todaySaisies = saisiesEnc.filter(r=>r.date===todayStr);
  const encAvecOuv = encs.filter(e=>todaySaisies.some(r=>r.enc_id===e.id&&r.moment==='ouv'));
  const encAvecFerm = encs.filter(e=>todaySaisies.some(r=>r.enc_id===e.id&&r.moment==='ferm'));
  const ouvDone = encAvecOuv.length >= encs.length;
  const fermDone = encAvecFerm.length >= encs.length;
  tasks.push({
    time:'matin', priority: ouvDone?0:3,
    html: taskStatus(ouvDone, h>=9&&!ouvDone,
      'T°C enceintes — Ouverture',
      '🌡️', "goTo('enr19')",
      ouvDone ? `${encAvecOuv.length}/${encs.length} enceintes relevées` : `${encAvecOuv.length}/${encs.length} faite${encAvecOuv.length>1?'s':''} — ${encs.length-encAvecOuv.length} manquante${encs.length-encAvecOuv.length>1?'s':''}`
    )
  });

  // ── 2+3. T°C DISTRIBUTION — services configurables, MIDI et SOIR séparés
  const distribDraftNow = distribDraft();
  const distribDate = distribDraftNow.date||todayStr;
  const distribToday = (S['enr_tc_distrib']?.lignes||[]).find(r=>r.date===todayStr);
  const distribSvcs = getDistribServices();

  // Helper : fabriquer une tâche pour un créneau (midi ou soir) d'un service
  function pushDistribTask(svc, creneau) {
    const svcId = svc.id;
    const isMidi = creneau === 'midi';
    const flagKey = isMidi ? 'midi_valide' : 'soir_valide';

    // Recherche de la validation dans TOUTES les sources possibles :
    //  1. S['enr_distrib_'+svcId].lignes (nouvelle page service)
    //  2. S['enr_distrib_'+svcId].draft (brouillon non encore sauvé en ligne)
    //  3. S['enr_tc_distrib'].lignes (ancienne page générique) avec svcId+'_valide'
    //  4. distribDraftNow (draft générique)
    const svcLignes = (S['enr_distrib_'+svcId]?.lignes)||[];
    const svcDraft = S['enr_distrib_'+svcId]?.draft || {};
    const creneauDone = svcLignes.some(r=>r.date===todayStr && r[flagKey]==='OUI')
                      || (svcDraft.date===todayStr && svcDraft[flagKey]==='OUI')
                      || (distribDate===todayStr && distribDraftNow[svcId+'_'+flagKey]==='OUI')
                      || distribToday?.[svcId+'_'+flagKey]==='OUI'
                      // Fallback legacy : ancienne logique midi/soir en un seul flag
                      || (isMidi && svcLignes.some(r=>r.date===todayStr && r.midi_valide==='OUI'))
                      || (!isMidi && svcLignes.some(r=>r.date===todayStr && r.soir_valide==='OUI'));

    // Horaires du créneau demandé
    const _deb = isMidi ? (svc.midi_deb || svc.heure || '12:00') : (svc.soir_deb || '18:30');
    const _fin = isMidi
      ? (svc.midi_fin || (svc.deadline ? (typeof svc.deadline==='string'&&svc.deadline.includes(':')?svc.deadline:String(svc.deadline||14).padStart(2,'0')+':00') : '14:00'))
      : (svc.soir_fin || '20:00');

    // Le créneau soir n'est pas proposé si le service n'a pas de soir configuré
    if (!isMidi && !svc.soir_deb && !svc.soir_fin) return;
    // Le créneau midi n'est pas proposé si le service n'a pas de midi configuré
    if (isMidi && !svc.midi_deb && !svc.heure) return;

    const svcH = parseInt(_deb.split(':')[0]) || (isMidi?12:18);
    const deadline = _fin ? (parseInt(_fin.split(':')[0])+parseInt(_fin.split(':')[1]||'0')/60) : (svcH+2);
    const hNow = h + (new Date().getMinutes()/60);

    // Fenêtre d'affichage : on n'affiche le créneau SOIR que dans l'après-midi
    // pour ne pas encombrer l'accueil le matin
    if (!isMidi && hNow < 15) return;

    const isUrgent = !creneauDone && hNow >= (svcH - 0.5);
    const isRetard = !creneauDone && hNow >= deadline;
    const creneauLabel = isMidi ? 'Midi' : 'Soir';
    const detail = creneauDone ? 'Validé ✓'
      : isRetard ? '⚠️ En retard — à faire maintenant !'
      : isUrgent ? '🔔 Service dans moins de 30 min !'
      : 'T°C à prendre avant '+ _fin + ' (service ' + _deb + ')';
    const distribTarget = REND['enr_distrib_'+svcId] ? 'enr_distrib_'+svcId : 'enr_tc_distrib';
    tasks.push({
      time: svcId+'_'+creneau,
      priority: creneauDone?0: isRetard?3: isUrgent?2:1,
      html: taskStatus(creneauDone, isRetard,
        'T°C Distribution — '+svc.label+' ('+creneauLabel+')',
        svc.ico||'🌡️', "goTo('"+distribTarget+"')",
        detail
      )
    });
  }

  distribSvcs.forEach(svc=>{
    pushDistribTask(svc, 'midi');
    pushDistribTask(svc, 'soir');
  });

  // ── 4. REFROIDISSEMENTS EN ATTENTE ─────────────────
  // Seulement les refroidissements destinés à être réchauffés (destination='rechauffe')
  // Et pas plus vieux que 48h (au-delà, considérer abandonné)
  // Croiser avec ENR02/ENR03 : si une ligne pointe sur ce refroidissement via _enr01_ts
  // ou _enr01_idx, on considère qu'il a été traité (même si _statut n'a pas été sync)
  const now48h = Date.now() - 48*60*60*1000;
  const enr02Lignes = (S['enr02']?.lignes||[]);
  const enr03Lignes = (S['enr03']?.lignes||[]);
  const tsTraites = new Set();
  enr02Lignes.forEach(r=>{ if(r._enr01_ts) tsTraites.add(r._enr01_ts); });
  enr03Lignes.forEach(r=>{ if(r._enr01_ts) tsTraites.add(r._enr01_ts); });
  const pending = (S['enr01']?.lignes||[]).filter(r=>{
    if(r._statut && r._statut!=='en_attente') return false; // déjà traité (flag local/sync)
    if(r._ts && tsTraites.has(r._ts)) return false; // traité via ENR02/ENR03 lié
    // destination filter retiré (anciennes saisies n'ont pas ce champ)
    const ts = r._ts ? new Date(r._ts).getTime() : (r.date ? new Date(r.date+'T12:00').getTime() : 0);
    return ts >= now48h;
  });
  if(pending.length>0){
    tasks.push({
      time:'alerte', priority:4,
      html: taskStatus(false, true,
        `${pending.length} refroidissement${pending.length>1?'s':''} en attente de suivi`,
        '❄️', "goTo('enr01')",
        pending.map(r=>r.produit||'Produit').slice(0,2).join(', ')+(pending.length>2?'…':'')
      )
    });
  }

  // ── 5. HUILE FRITURE ──────────────────────────────
  const huileStats = getHuileStats();
  Object.entries(huileStats).forEach(([f,s])=>{
    const isDanger = s.services >= HUILE_MAX;
    const isWarn = s.services >= HUILE_MAX-2 && !isDanger;
    if(isDanger||isWarn){
      tasks.push({
        time:'friture', priority: isDanger?4:2,
        html: taskStatus(false, isDanger,
          isDanger?`Friteuse n°${f} — CHANGER L'HUILE !`:`Friteuse n°${f} — Huile bientôt à changer`,
          '🍟', "goTo('enr05')",
          `${s.services}/${HUILE_MAX} services effectués${s.lastChange?' — Dernier changement : '+s.lastChange:''}`
        )
      });
    }
  });

  // ── 6. T°C ENCEINTES FERMETURE ─────────────────────
  if(h>=16){
    tasks.push({
      time:'soir', priority: fermDone?0: h>=20?3: h>=18?2:1,
      html: taskStatus(fermDone, h>=20&&!fermDone,
        'T°C enceintes — Fermeture',
        '🌡️', "goTo('enr19')",
        fermDone ? `${encAvecFerm.length}/${encs.length} enceintes relevées` : `À faire en fin de service (${encAvecFerm.length}/${encs.length} faite${encAvecFerm.length>1?'s':''})`
      )
    });
  }

  // ── 7. NETTOYAGE — alertes + top 3 priorités ────────────────────────
  const nettRet = nettNbRetards();
  // Compter uniquement les items dont la DERNIÈRE validation est NON (NC non refaites)
  const nettNC = nettRef().filter(it=>{
    const last=nettLastVal(it.id);
    return last && last.conforme==='NON';
  }).length;
  const nettTopItems = nettRef().filter(it=>nettStatus(it)==='retard').slice(0,3);
  const nettTopHtml = nettTopItems.length
    ? '<div style="margin-top:4px">' + nettTopItems.map(it=>
        '<div style="font-size:.67rem;color:#991b1b;padding:1px 0">🔴 <b>' + escH(it.materiel) + '</b> <span style="color:#b89ab6;font-weight:400">— ' + escH(it.zone) + '</span></div>'
      ).join('') + (nettRet>3 ? '<div style="font-size:.65rem;color:#b89ab6">+ '+(nettRet-3)+' autres...</div>' : '') + '</div>'
    : '';
  const nettDetail = nettRet>0
    ? '⚠️ ' + nettRet + ' en retard' + (nettNC>0 ? ' · ' + nettNC + ' NC ⚠️' : '') + nettTopHtml
    : (nettNC>0 ? '⚠️ ' + nettNC + ' non-conformité' + (nettNC>1?'s':'') + ' à résoudre' : '✓ Tout à jour');
  tasks.push({
    time:'quotidien', priority: nettRet>0?2:(nettNC>0?1:0),
    html: taskStatus(nettRet===0&&nettNC===0, nettRet>0||nettNC>0,
      'Plan de nettoyage',
      '🧹', "goTo('enr28')",
      nettDetail
    )
  });

  // ── 8. THERMOMÈTRES — mensuel ──────────────────────
  const thermoMois = (S['enr26']?.lignes||[]).some(r=>(r.date||'').startsWith(mois));
  tasks.push({
    time:'mensuel', priority: thermoMois?0:1,
    html: taskStatus(thermoMois, !thermoMois,
      'Contrôle thermomètres — ce mois',
      '🌡️', "goTo('enr26')",
      thermoMois ? 'Contrôlé ce mois ✓' : `À faire ce mois (${new Date(+mois.split('-')[0],+mois.split('-')[1]-1,1).toLocaleDateString('fr-FR',{month:'long'})})`
    )
  });

  // ── 9. PLATS TÉMOINS — widget unique d'accès direct ────────
  const hid = (S.navCfg||{}).hidden||{};
  if(!hid['enr33']){
    const tLignes = (S['enr33']?.lignes||[]);
    const nbTemoinsAujourdhui = tLignes.filter(r=>(r.date_prelev||r.date)===todayStr && !r._jete).length;
    tasks.push({
      time:'jour', priority: nbTemoinsAujourdhui>0?0: h>=12?2:1,
      html: taskStatus(nbTemoinsAujourdhui>0, h>=12&&nbTemoinsAujourdhui===0,
        '🖨️ Imprimer étiquette plat témoin',
        '🏷️', "goTo('enr33')",
        nbTemoinsAujourdhui>0
          ? nbTemoinsAujourdhui+' prélevé'+(nbTemoinsAujourdhui>1?'s':'')+' aujourd\'hui — Tap pour en ajouter'
          : 'Prélever à chaque service — Tap pour créer'
      )
    });
  }

  // ── RAPPELS FOURNISSEURS ──────────────────────────
  const todayDeliveries = fourcTodayDeliveries();
  todayDeliveries.forEach(f=>{
    const done = fourcAlreadyDone(f.nom);
    if(!done){
      tasks.push({
        time:'reception', priority: h>=8?3:2,
        html: taskStatus(false, h>=8,
          'Livraison attendue — '+f.nom,
          '🚚', "goTo('enr23')",
          f.notes ? f.notes : 'Faire la réception et la traçabilité'
        )
      });
    }
  });

  // ── POUBELLES : sortir ce soir ─────────────────────
  const pbSortir = poubellesTodayVeille();
  if(pbSortir.length > 0){
    const doneSortir = poubellesCheckDone('sortir');
    const isFinJournee = h >= 18;
    const nomsSortir = pbSortir.map(p=>p.ico+' '+p.label).join(', ');
    const cls=doneSortir?'task-done':isFinJournee?'task-urgent':'task-todo';
    const badge=doneSortir?'✅':isFinJournee?'🔴':'⏳';
    tasks.push({
      time:'poubelles_sortir', priority: doneSortir?0: isFinJournee?3:1,
      html:`<div class="task-row ${cls}">
        <span class="task-icon">🗑️</span>
        <div class="task-body" style="flex:1">
          <div class="task-label">Sortir les bacs ce soir</div>
          <div class="task-detail">${doneSortir?'Bacs sortis ✓':nomsSortir}</div>
        </div>
        <span class="task-badge">${badge}</span>
        ${!doneSortir?`<button onclick="poubellesSetDone('sortir')" style="background:var(--plum);color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:.72rem;font-weight:800;cursor:pointer;font-family:inherit;flex-shrink:0;touch-action:manipulation">✓ Sorti</button>`:''}
      </div>`
    });
  }

  // ── POUBELLES : rentrer ce matin ───────────────────
  const pbRentrer = poubellesTodayRentrer();
  if(pbRentrer.length > 0){
    const doneRentrer = poubellesCheckDone('rentrer');
    const isMatin = h >= 6 && h < 14;
    const nomsRentrer = pbRentrer.map(p=>p.ico+' '+p.label).join(', ');
    const cls2=doneRentrer?'task-done':isMatin?'task-urgent':'task-todo';
    const badge2=doneRentrer?'✅':isMatin?'🔴':'⏳';
    tasks.push({
      time:'poubelles_rentrer', priority: doneRentrer?0: isMatin?3:1,
      html:`<div class="task-row ${cls2}">
        <span class="task-icon">🗑️</span>
        <div class="task-body" style="flex:1">
          <div class="task-label">Rentrer les bacs ce matin</div>
          <div class="task-detail">${doneRentrer?'Bacs rentrés ✓':nomsRentrer}</div>
        </div>
        <span class="task-badge">${badge2}</span>
        ${!doneRentrer?`<button onclick="poubellesSetDone('rentrer')" style="background:var(--plum);color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:.72rem;font-weight:800;cursor:pointer;font-family:inherit;flex-shrink:0;touch-action:manipulation">✓ Rentré</button>`:''}
      </div>`
    });
  }

  // Trier : alertes d'abord, puis par priorité décroissante
  tasks.sort((a,b)=>b.priority-a.priority);

  // Grouper les tâches : urgentes / en cours / ok
  const urgentes = tasks.filter(t=>t.priority>=3);
  const encours  = tasks.filter(t=>t.priority>0&&t.priority<3);
  const faites   = tasks.filter(t=>t.priority===0);

  const nbTotal = tasks.length;
  const nbOk = faites.length;
  const pct = Math.round(nbOk/nbTotal*100);

  return `
    <!-- En-tête du jour -->
    <div class="card" style="padding:14px 16px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div>
          <div style="font-size:.75rem;font-weight:800;color:#b89ab6;text-transform:uppercase;letter-spacing:.5px">Tableau de bord</div>
          <div style="font-size:1rem;font-weight:900;color:var(--plum);margin-top:1px">${new Date().toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'})}</div>
          ${getActiveSession()?`<div style="font-size:.78rem;font-weight:700;color:#b89ab6;margin-top:2px">👋 Bonjour ${escH(getActiveSession())} !</div>`:''}
        </div>
        <div style="text-align:center">
          <div class="task-progress-ring">
            <svg width="58" height="58" viewBox="0 0 58 58">
              <circle cx="29" cy="29" r="24" fill="none" stroke="#f0e4f0" stroke-width="5"/>
              <circle cx="29" cy="29" r="24" fill="none" stroke="${pct===100?'#4caf50':'#5C1E5A'}" stroke-width="5"
                stroke-dasharray="${2*Math.PI*24}" stroke-dashoffset="${2*Math.PI*24*(1-pct/100)}"
                stroke-linecap="round" transform="rotate(-90 29 29)" style="transition:.6s"/>
            </svg>
            <div class="task-ring-txt">
              <div style="font-size:.95rem;font-weight:900;color:var(--plum)">${nbOk}/${nbTotal}</div>
            </div>
          </div>
          <div style="font-size:.62rem;font-weight:700;color:#b89ab6;margin-top:2px">${pct===100?'✅ Tout fait !':'tâches ok'}</div>
        </div>
      </div>
      <!-- Raccourcis rapides -->
      <div class="task-shortcuts">
        <button class="task-sh-btn" onclick="goTo('enr01')">❄️<br><span>Refroid.</span></button>
        <button class="task-sh-btn" onclick="goTo('enr_tc_distrib')">🌡️<br><span>Distrib.</span></button>
        <button class="task-sh-btn" onclick="goTo('enr19')">🧊<br><span>Enceintes</span></button>
        <button class="task-sh-btn" onclick="goTo('enr30')">🚨<br><span>Non-conf.</span></button>
        <button class="task-sh-btn" onclick="goTo('enr23')">📦<br><span>Réception</span></button>
        <button class="task-sh-btn" style="border-color:#d4a017;background:#fff8e6" onclick="openAuditModal()">🔍<br><span style="color:#92400e">Audit</span></button>
      </div>
    </div>

    ${urgentes.length?`
    <div class="task-section-title urgent">🔴 Urgent — action requise</div>
    <div class="task-list">${urgentes.map(t=>t.html).join('')}</div>`:''}

    ${encours.length?`
    <div class="task-section-title">📋 À faire aujourd'hui</div>
    <div class="task-list">${encours.map(t=>t.html).join('')}</div>`:''}

    ${faites.length?`
    <div class="task-section-title done">✅ Complété</div>
    <div class="task-list">${faites.map(t=>t.html).join('')}</div>`:''}

    ${pct===100?`<div style="background:linear-gradient(135deg,#1b5e20,#2e7d32);color:#fff;border-radius:14px;padding:16px;text-align:center;font-size:.95rem;font-weight:800;margin-top:4px">🎉 Toutes les tâches HACCP du jour sont complètes !</div>`:''}`;
}


// ════════════════════════════════════════════════════
// GAMIFICATION — Score HACCP du jour/mois
// ════════════════════════════════════════════════════

// ══════════════════════════════════════════════
// LAYOUT NAVIGATION PAR UTILISATEUR
// ══════════════════════════════════════════════
const _NAV_POSITIONS = ['top','bottom','left','right'];
const _NAV_LABELS = {top:'En haut', bottom:'En bas', left:'À gauche', right:'À droite'};
const _NAV_ICONS  = {top:'⬆️', bottom:'⬇️', left:'⬅️', right:'➡️'};

function getNavLayout(mode){ // mode: 'portrait' | 'landscape'
  const active = getActiveSession();
  const prefs = active ? (S.chefPrefs?.[active]||{}) : (S.config||{});
  return (mode==='landscape' ? prefs.navLand : prefs.navPort) || (mode==='landscape' ? 'top' : 'top');
}

function setNavLayout(mode, pos){
  const active = getActiveSession();
  if(active){
    S.chefPrefs = S.chefPrefs||{};
    S.chefPrefs[active] = S.chefPrefs[active]||{};
    if(mode==='landscape') S.chefPrefs[active].navLand = pos;
    else S.chefPrefs[active].navPort = pos;
  } else {
    if(mode==='landscape') { S.config=S.config||{}; S.config.navLand=pos; }
    else { S.config=S.config||{}; S.config.navPort=pos; }
  }
  save();
  if(typeof _saveConfigToSupabase==='function') _saveConfigToSupabase();
  applyNavLayout();
  renderNavLayoutUI();
}

function applyNavLayout(){
  const body = document.body;
  // Remove all nav classes
  ['nav-top','nav-bottom','nav-left','nav-right',
   'nav-land-top','nav-land-bottom','nav-land-left','nav-land-right'].forEach(c=>body.classList.remove(c));
  const port = getNavLayout('portrait');
  const land = getNavLayout('landscape');
  if(port && port!=='top') body.classList.add('nav-'+port);
  if(land && land!=='top') body.classList.add('nav-land-'+land);
}

function renderNavLayoutUI(){
  const el = document.getElementById('nav-layout-ui');
  if(!el) return;
  const port = getNavLayout('portrait');
  const land = getNavLayout('landscape');
  el.innerHTML = `
    <div style="margin-bottom:12px">
      <div style="font-size:.68rem;font-weight:900;text-transform:uppercase;letter-spacing:.5px;color:#7A6579;margin-bottom:6px">📱 Portrait</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${_NAV_POSITIONS.map(p=>`<button onclick="setNavLayout('portrait','${p}')"
          style="flex:1;padding:8px 6px;border-radius:8px;border:2px solid ${port===p?'var(--plum)':'var(--brd)'};background:${port===p?'var(--plum)':'var(--fond)'};color:${port===p?'#fff':'var(--gris2)'};font-size:.72rem;font-weight:800;cursor:pointer;font-family:inherit">
          ${_NAV_ICONS[p]} ${_NAV_LABELS[p]}
        </button>`).join('')}
      </div>
    </div>
    <div>
      <div style="font-size:.68rem;font-weight:900;text-transform:uppercase;letter-spacing:.5px;color:#7A6579;margin-bottom:6px">🖥️ Paysage</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${_NAV_POSITIONS.map(p=>`<button onclick="setNavLayout('landscape','${p}')"
          style="flex:1;padding:8px 6px;border-radius:8px;border:2px solid ${land===p?'var(--plum)':'var(--brd)'};background:${land===p?'var(--plum)':'var(--fond)'};color:${land===p?'#fff':'var(--gris2)'};font-size:.72rem;font-weight:800;cursor:pointer;font-family:inherit">
          ${_NAV_ICONS[p]} ${_NAV_LABELS[p]}
        </button>`).join('')}
      </div>
    </div>`;
}


// ══════════════════════════════════════════════
// DICTIONNAIRE PRODUITS — Gestion
// ══════════════════════════════════════════════
function _dictRefresh(){
  // Rafraîchir le contenu sans toggle (après suppression/import)
  const el = document.getElementById('sp-dict-ui');
  if(!el || el.dataset.dictOpen !== '1') return;
  const div = el.querySelector('.dict-mgr-list');
  if(!div) return;
  const cur = getProds();
  div.innerHTML = cur.length === 0
    ? '<div style="padding:14px;text-align:center;color:#b89ab6;font-size:.8rem">Aucun produit</div>'
    : cur.map((p,i) => `<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid var(--brd)">
        <span style="flex:1;font-size:.8rem">${escH(p)}</span>
        <button onclick="_dictDelItem(${i})" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:.85rem;padding:2px 5px" title="Supprimer">✕</button>
      </div>`).join('');
  const countEl = document.getElementById('sp-dict-count');
  if(countEl) countEl.textContent = cur.length;
}
function _dictDelItem(i){ S.produits.splice(i,1); save(); _dictRefresh(); }

function openDictManager(){
  const el = document.getElementById('sp-dict-ui');
  if(!el) return;
  // Toggle : si ouvert → fermer
  if(el.dataset.dictOpen === '1'){
    el.dataset.dictOpen = '0';
    el.querySelectorAll('.dict-mgr-part').forEach(n=>n.remove());
    return;
  }
  el.dataset.dictOpen = '1';

  const div = document.createElement('div');
  div.className = 'dict-mgr-part dict-mgr-list';
  div.style.cssText = 'background:var(--fond);border:1.5px solid var(--brd);border-radius:10px;margin-top:8px;max-height:300px;overflow-y:auto;';
  div.innerHTML = getProds().length === 0
    ? '<div style="padding:14px;text-align:center;color:#b89ab6;font-size:.8rem">Aucun produit</div>'
    : getProds().map((p,i) => `<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid var(--brd)">
        <span style="flex:1;font-size:.8rem">${escH(p)}</span>
        <button onclick="_dictDelItem(${i})" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:.85rem;padding:2px 5px" title="Supprimer">✕</button>
      </div>`).join('');
  const countEl = document.getElementById('sp-dict-count');
  if(countEl) countEl.textContent = getProds().length;

  const footer = document.createElement('div');
  footer.className = 'dict-mgr-part';
  footer.style.cssText = 'display:flex;gap:6px;margin-top:6px;margin-bottom:2px';
  footer.innerHTML = `
    <button onclick="(()=>{const s=window._PRODUITS_DEFAULT||[];const c=getProds();const n=s.filter(p=>!c.includes(p));S.produits=[...c,...n].sort();save();_dictRefresh();toast('✅ '+n.length+' produits ajoutés','success');})()"
      style="flex:1;padding:7px;background:#dcfce7;border:1px solid #86efac;border-radius:8px;font-size:.72rem;font-weight:800;color:#166534;cursor:pointer;font-family:inherit">+ Charger la liste resto</button>
    <button onclick="(()=>{if(!confirm('Effacer tout le dictionnaire ?'))return;S.produits=[];save();openDictManager();toast('Dictionnaire vidé','success');})()"
      style="padding:7px 10px;background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;font-size:.72rem;font-weight:800;color:#dc2626;cursor:pointer;font-family:inherit">🗑 Tout</button>`;

  el.appendChild(div);
  el.appendChild(footer);
}

function updateDictCount(){
  const el = document.getElementById('sp-dict-count');
  if(el) el.textContent = getProds().length;
}


// ══════════════════════════════════════════════
// EXPORT PHOTOS DU MOIS — ZIP
// ══════════════════════════════════════════════
async function exportPhotosZip(){
  const mois = S.config?.mois || today().slice(0,7);
  const moisLabel = mois.slice(0,7);
  const photos = [];

  // Collecter toutes les photos du mois dans tous les champs photo
  // ── Photos nettoyage NC ──────────────────────────────────────
  (S.nett_val||[]).filter(v=>(v.date||'').startsWith(mois)&&v.photo_nc).forEach(v=>{
    try {
      const obj = v.photo_nc.startsWith('{') ? JSON.parse(v.photo_nc) : {thumb:v.photo_nc, file:'NC_nettoyage_'+v.date+'.jpg'};
      if(obj.thumb) photos.push({thumb:obj.thumb, file:obj.file||'NC_nettoyage_'+v.date+'.jpg', date:v.date, sec:'nett_nc', produit:'NC Nettoyage'});
    } catch(e){}
  });
  const photoSections = ['enr23','enr31'];
  photoSections.forEach(sec=>{
    (S[sec]?.lignes||[]).filter(r=>(r.date||'').startsWith(mois)).forEach(r=>{
      ['photo','p1_photo','p2_photo'].forEach(field=>{
        if(!r[field]) return;
        try {
          const obj = r[field].startsWith('{') ? JSON.parse(r[field]) : null;
          if(obj?.thumb){
            photos.push({
              thumb: obj.thumb,
              file: obj.file || (sec+'_'+r.date+'_'+field+'.jpg'),
              date: r.date||mois,
              sec, produit: r.produit||r.fournisseur||field
            });
          }
        } catch(e){}
      });
    });
  });

  // Photos pages custom
  (S.customPages||[]).forEach(cp=>{
    const photoFields = (cp.fields||[]).filter(f=>f.type==='photo');
    if(!photoFields.length) return;
    (S[cp.id]?.lignes||[]).filter(r=>(r.date||'').startsWith(mois)).forEach(r=>{
      photoFields.forEach(f=>{
        if(!r[f.id]) return;
        try {
          const obj = r[f.id].startsWith('{') ? JSON.parse(r[f.id]) : null;
          if(obj?.thumb) photos.push({thumb:obj.thumb, file:obj.file||(cp.id+'_'+r.date+'_'+f.id+'.jpg'), date:r.date||mois, sec:cp.id, produit:f.label});
        } catch(e){}
      });
    });
  });

  if(!photos.length){
    toast('Aucune photo ce mois — '+ moisLabel, 'warning');
    return;
  }

  if(typeof JSZip === 'undefined'){
    toast('⚠️ JSZip non disponible — téléchargement individuel', 'warning');
    // Fallback : télécharger une par une
    for(let i=0; i<photos.length; i++){
      const p=photos[i];
      const a=document.createElement('a');
      a.href=p.thumb; a.download=p.file||('photo_'+i+'.jpg');
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      await new Promise(r=>setTimeout(r,300));
    }
    return;
  }

  toast('📦 Création du ZIP… ('+ photos.length +' photos)', 'success', 5000);
  const zip = new JSZip();
  const folder = zip.folder('Photos_HACCP_'+moisLabel);
  for(const p of photos){
    const b64 = p.thumb.split(',')[1];
    if(b64) folder.file(p.file || ('photo.jpg'), b64, {base64:true});
  }
  const blob = await zip.generateAsync({type:'blob'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download='Photos_HACCP_'+moisLabel+'.zip';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),3000);
  toast('✅ ZIP téléchargé — '+ photos.length +' photo'+(photos.length>1?'s':''), 'success');
}


// ══════════════════════════════════════════════
// PRODUITS RESTAURATION COLLECTIVE — liste de référence
// ══════════════════════════════════════════════
window._PRODUITS_DEFAULT = [
  // Viandes
  "Bœuf bourguignon","Bœuf haché frais","Blanquette de veau","Côte de porc","Cuisses de poulet",
  "Dinde rôtie","Escalope de dinde","Escalope de veau","Filet de poulet","Gigot d'agneau",
  "Jarret de porc","Joues de bœuf","Lapin à la moutarde","Manchons de canard","Merguez",
  "Noix de veau","Osso buco","Pavé de bœuf","Poitrine de porc","Poulet rôti",
  "Rôti de bœuf","Rôti de porc","Saucisses de Toulouse","Steaks hachés","Veau Marengo",
  // Poissons / Fruits de mer
  "Bar en papillote","Cabillaud au four","Colin à la crème","Crevettes","Darnes de saumon",
  "Dos de cabillaud","Filet de bar","Filet de merlan","Filet de sole","Lieu noir",
  "Moules marinières","Pavé de saumon","Sardines","Thon en sauce","Truite aux amandes",
  // Légumes / Accompagnements
  "Brocolis vapeur","Carottes glacées","Carottes vichy","Champignons de Paris","Chou-fleur gratiné",
  "Courgettes sautées","Endives braisées","Épinards à la crème","Flageolets","Gratin de courgettes",
  "Gratin de pommes de terre","Haricots verts","Lentilles cuisinées","Petits pois carottes",
  "Pois chiches","Poêlée de légumes","Poireaux vinaigrette","Pommes dauphine","Pommes de terre sautées",
  "Pommes noisettes","Purée de carottes","Purée de pommes de terre","Riz blanc","Riz pilaf",
  "Ratatouille","Semoule","Taboulé","Tomates farcies","Wok de légumes",
  // Féculents / Céréales
  "Blé concassé","Fettucines","Gnocchis","Lasagnes","Macaroni au gratin",
  "Orge perlé","Pâtes bolognaise","Pâtes carbonara","Penne à la tomate","Polenta",
  "Quinoa","Raviolis","Risotto","Spaghetti","Tagliatelles à la crème",
  // Soupes / Entrées chaudes
  "Crème de champignons","Crème de courgettes","Crème de tomate","Potage de légumes","Potage parmentier",
  "Soupe de poisson","Soupe de potiron","Velouté de butternut","Velouté de carottes","Velouté de céleri",
  // Entrées froides
  "Betteraves vinaigrette","Carottes râpées","Céleri rémoulade","Cervelas salade",
  "Concombre vinaigrette","Macédoine de légumes","Mimosa","Pamplemousse","Radis beurre",
  "Salade composée","Salade de riz","Salade de thon","Salade niçoise","Salade verte","Tomates concombres",
  // Desserts / Produits laitiers
  "Compote de pommes","Crème caramel","Crème chocolat","Crème dessert vanille",
  "Entremets","Flan pâtissier","Fromage blanc","Fruit de saison","Gateau au yaourt",
  "Gratin de fruits","Mousse au chocolat","Pain perdu","Pomme cuite","Riz au lait","Tiramisu",
  "Yaourt nature","Yaourt aux fruits",
  // Produits bruts / Ingrédients courants
  "Beurre","Chapelure","Crème fraîche","Cube de bouillon","Farine",
  "Fond de veau","Fromage râpé","Herbes de Provence","Huile d'olive","Lait demi-écrémé",
  "Margarine","Moutarde","Oignons","Ail","Persil",
  "Sel","Poivre","Sauce tomate","Sucre","Vinaigre balsamique",
  // Pains / Viennoiseries
  "Baguette","Brioche","Pain de campagne","Pain de mie","Pain Graham",
].sort();

function calcHACCPScore(){
  const mois=S.config?.mois||today().slice(0,7);
  const t=today();
  const encs=getEnceintes();
  const saisies=S['enr19']?.saisies||[];
  const nettVals=S.nett_val||[];
  const nuisVals=S.nuisibles_val||[];

  const criteres=[];

  // ── T°C Enceintes aujourd'hui ─────────────────────
  const encToday=saisies.filter(r=>r.date===t);
  const encOuv=encs.filter(e=>encToday.some(r=>r.enc_id===e.id&&r.moment==='ouv')).length;
  const encFerm=encs.filter(e=>encToday.some(r=>r.enc_id===e.id&&r.moment==='ferm')).length;
  const encNC=encToday.filter(r=>{const e=encs.find(e=>e.id===r.enc_id);return e&&encConforme(r.temp,e.consigne)===false;}).length;
  const encScore=encs.length>0?Math.round(((encOuv+encFerm)/(encs.length*2))*100):100;
  criteres.push({
    ico:'🌡️',label:'T°C Enceintes',
    pts:encNC>0?0:encScore,max:100,
    detail:encNC>0?`${encNC} hors seuil !`:encOuv===encs.length&&encFerm===encs.length?'Toutes relevées ✓':`${encOuv}/${encs.length} ouv · ${encFerm}/${encs.length} ferm`,
    action:encOuv<encs.length||encFerm<encs.length?{label:'Saisir T°C',id:'enr19'}:null,
    ok:encNC===0&&encScore===100
  });

  // ── Nettoyage — retards + items dus aujourd'hui non faits ──────
  const nettItems=nettRef();
  const nettRetards=nettItems.filter(it=>['retard','nc'].includes(nettStatus(it))).length;
  // Items dus AUJOURD'HUI non validés (hors apres_usage qui est optionnel)
  const nettTodayMissed=nettItems.filter(it=>nettStatus(it)==='today'&&it.freq!=='apres_usage').length;
  const nettTotal=nettItems.length;
  const nettToday=nettVals.filter(v=>v.date===t&&v.conforme==='OUI').length;
  const nettPts=nettRetards>0
    ? Math.max(0, Math.round((1-(nettRetards+nettTodayMissed*0.5)/Math.max(1,nettTotal))*100))
    : nettTodayMissed>0
      ? Math.max(10, Math.round((1-nettTodayMissed*0.6/Math.max(1,nettTotal))*100))
      : 100;
  criteres.push({
    ico:'🧹',label:'Plan de nettoyage',
    pts:nettPts,max:100,
    detail:nettRetards>0?`${nettRetards} en retard${nettTodayMissed>0?' · '+nettTodayMissed+' à faire':''}`:
           nettTodayMissed>0?`${nettTodayMissed} à faire aujourd'hui`:
           `${nettToday} fait${nettToday>1?'s':''} aujourd'hui`,
    action:(nettRetards>0||nettTodayMissed>0)?{label:'Voir nettoyage',id:'enr28'}:null,
    ok:nettRetards===0&&nettTodayMissed===0
  });

  // ── Nuisibles — toutes zones vérifiées ────────────
  const nuisZones=nuisiblesZones();
  const nuisChecked=nuisZones.filter(z=>nuisiblesTodayForZone(z)!==null).length;
  const nuisNC=nuisVals.filter(v=>v.date===t&&v.presence==='OUI').length;
  // Si aucune zone n'a été vérifiée ET c'est un premier jour = score 50 neutre (pas pénalisant)
  const nuisPts=nuisNC>0?0:nuisChecked===0&&(S.nuisibles_val||[]).length===0?50:Math.round((nuisChecked/Math.max(1,nuisZones.length))*100);
  criteres.push({
    ico:'🐀',label:'Contrôle nuisibles',
    pts:nuisPts,max:100,
    detail:nuisNC>0?`${nuisNC} présence détectée !`:nuisChecked===0&&(S.nuisibles_val||[]).length===0?'Premier contrôle à faire':nuisChecked===nuisZones.length?'Toutes zones OK ✓':`${nuisChecked}/${nuisZones.length} zones vérifiées`,
    action:nuisChecked<nuisZones.length?{label:'Vérifier',id:'enr28',tab:'nuisibles'}:null,
    ok:nuisNC===0&&nuisChecked===nuisZones.length
  });

  // ── NC en attente ──────────────────────────────────
  const ncOpen=(S['enr30']?.lignes||[]).filter(r=>r._auto===true&&r.cloture!=='OUI').length;
  const ncTotal=(S['enr30']?.lignes||[]).filter(r=>r.date?.startsWith(mois)).length;
  const ncPts=ncOpen===0?100:Math.max(0,Math.round((1-ncOpen/Math.max(1,ncTotal))*100));
  criteres.push({
    ico:'🚨',label:'Non-conformités',
    pts:ncPts,max:100,
    detail:ncOpen>0?`${ncOpen} NC non clôturée${ncOpen>1?'s':''}`:ncTotal>0?`${ncTotal} NC traitée${ncTotal>1?'s':''} ✓`:'Aucune NC ce mois ✓',
    action:ncOpen>0?{label:'Traiter NC',id:'enr30'}:null,
    ok:ncOpen===0
  });

  // ── Refroidissements CCP ───────────────────────────
  const enr01Mois=(S['enr01']?.lignes||[]).filter(r=>r.date?.startsWith(mois));
  const enr01NC=enr01Mois.filter(r=>r.conf_r==='NON'||r.conforme==='NON').length;
  const enr01Pending=enr01Mois.filter(r=>!r._statut||r._statut==='en_attente').length;
  const ccp1Pts=enr01NC>0?Math.max(0,100-enr01NC*20):enr01Pending>0?80:100;
  criteres.push({
    ico:'❄️',label:'Refroidissements CCP',
    pts:ccp1Pts,max:100,
    detail:enr01NC>0?`${enr01NC} NC ce mois`:enr01Pending>0?`${enr01Pending} en attente`:enr01Mois.length>0?`${enr01Mois.length} OK ce mois`:'Aucun ce mois',
    action:enr01Pending>0?{label:'Traiter',id:'enr01'}:null,
    ok:enr01NC===0
  });

  // ── Traçabilité réception — basé sur le calendrier fournisseurs ──
  const fourc=getFournisseurs();
  const recepToday=(S['enr23']?.lignes||[]).filter(r=>r.date===t);
  const livraisonsAttendues=fourcTodayDeliveries(); // fournisseurs attendus aujourd'hui
  let recepPts=100, recepDetail='', recepAction=null, recepOk=true;
  if(livraisonsAttendues.length>0){
    // Il y a des livraisons prévues aujourd'hui
    const faites=livraisonsAttendues.filter(f=>fourcAlreadyDone(f.nom)).length;
    recepPts=Math.round((faites/livraisonsAttendues.length)*100);
    recepDetail=`${faites}/${livraisonsAttendues.length} livraison${livraisonsAttendues.length>1?'s':''} contrôlée${faites>1?'s':''}`;
    recepAction=faites<livraisonsAttendues.length?{label:'Saisir',id:'enr23'}:null;
    recepOk=faites===livraisonsAttendues.length;
  } else if(fourc.length>0){
    // Des fournisseurs existent mais pas de livraison prévue aujourd'hui
    recepPts=100;
    recepDetail="Pas de livraison prévue aujourd'hui";
    recepOk=true;
  } else {
    // Aucun fournisseur configuré — critère N/A, ne pas pénaliser
    const recepMois=(S['enr23']?.lignes||[]).filter(r=>r.date?.startsWith(mois)).length;
    recepPts=75; // neutre, ni pénalisant ni gonflant
    recepDetail='Aucun fournisseur configuré';
    recepAction={label:'Configurer',id:'enr23'};
    recepOk=true; // n/a = ne pénalise pas
  }
  // Ne pas inclure dans le score global si N/A (aucun fournisseur)
  if(fourc.length>0 || livraisonsAttendues.length>0){
    criteres.push({
      ico:'📦',label:'Contrôles réception',
      pts:recepPts,max:100,
      detail:recepDetail,
      action:recepAction,
      ok:recepOk
    });
  } else {
    criteres.push({
      ico:'📦',label:'Contrôles réception',
      pts:75,max:100,
      detail:'Non applicable — aucun fournisseur configuré',
      action:{label:'Configurer',id:'enr23'},
      ok:true,
      na:true
    });
  }

  // ── Score global ───────────────────────────────────
  const total=Math.round(criteres.reduce((s,c)=>s+c.pts,0)/criteres.length);
  return{total,criteres};
}

let _scoreCollapsed = false;
function toggleScore(){ _scoreCollapsed=!_scoreCollapsed; renderMain(); }
function toggleCat(k){ S._catCollapsed=S._catCollapsed||{}; S._catCollapsed[k]=!S._catCollapsed[k]; save(); renderMain(); }

function renderScoreHACCP(){
  const{total,criteres}=calcHACCPScore();
  const col=total>=90?'#166534':total>=70?'#92400e':total>=50?'#c2410c':'#991b1b';
  const bg=total>=90?'#f0fdf4':total>=70?'#fffbeb':total>=50?'#fff7ed':'#fef2f2';
  const emoji=total>=90?'🏆':total>=70?'🥈':total>=50?'🥉':'⚠️';
  const label=total>=90?'Excellent':total>=70?'Bien':total>=50?'Moyen':'À améliorer';

  // Barre de progression animée
  const barItems=criteres.map(c=>{
    const pct=c.pts;
    const cCol=c.ok?'#22c55e':pct>=70?'#f59e0b':'#ef4444';
    return`<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
      <span style="font-size:.9rem;flex-shrink:0">${c.ico}</span>
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
          <span style="font-size:.72rem;font-weight:800;color:#3D2A3C">${c.label}</span>
          <span style="font-size:.68rem;font-weight:900;color:${cCol}">${c.pts}/100</span>
        </div>
        <div style="height:6px;background:#e8d8e8;border-radius:10px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${cCol};border-radius:10px;transition:width .6s ease"></div>
        </div>
        <div style="font-size:.64rem;color:#7A6579;margin-top:1px">${c.detail}</div>
      </div>
      ${c.action?`<button onclick="${c.action.tab?`_nettTab='${c.action.tab}';`:``}goTo('${c.action.id}')" style="background:${cCol};color:#fff;border:none;border-radius:8px;padding:4px 8px;font-size:.62rem;font-weight:800;cursor:pointer;font-family:inherit;white-space:nowrap;flex-shrink:0">${c.action.label}</button>`:''}
    </div>`;
  }).join('');

  return`<div style="background:${bg};border:2px solid ${col}30;border-radius:16px;padding:14px;margin-bottom:14px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:${_scoreCollapsed?'0':'12px'}">
      <div style="position:relative;width:64px;height:64px;flex-shrink:0">
        <svg viewBox="0 0 36 36" style="width:64px;height:64px;transform:rotate(-90deg)">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e8d8e8" stroke-width="3"/>
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="${col}" stroke-width="3"
            stroke-dasharray="${total} ${100-total}" stroke-linecap="round"/>
        </svg>
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column">
          <span style="font-size:1.1rem;font-weight:900;color:${col};line-height:1">${total}</span>
          <span style="font-size:.48rem;font-weight:700;color:${col}">pts</span>
        </div>
      </div>
      <div style="flex:1">
        <div style="font-size:.85rem;font-weight:900;color:${col}">${emoji} Score HACCP — ${label}</div>
        <div style="font-size:.72rem;color:#7A6579;margin-top:2px">Conformité terrain aujourd'hui</div>
        <div style="font-size:.65rem;color:#b89ab6;margin-top:1px">${criteres.filter(c=>c.ok).length}/${criteres.length} critères validés</div>
      </div>
      <button onclick="toggleScore()" style="background:rgba(0,0,0,.08);border:none;border-radius:20px;padding:5px 10px;font-size:.8rem;cursor:pointer;color:${col};font-weight:800;flex-shrink:0;font-family:inherit">
        ${_scoreCollapsed?'▼ Voir':'▲ Replier'}
      </button>
    </div>
    ${_scoreCollapsed ? '' : barItems}
  </div>`;
}

function renderCatSections(mois){
  const catDefs = [
    {k:'ccp',    l:'🔴 Points Critiques (CCP)'},
    {k:'prpo',   l:'🟠 Prérequis opérationnels (PrPo)'},
    {k:'mensuel',l:'📅 Enregistrements mensuels'},
    {k:'suivi',  l:'📋 Plans de suivi'},
    {k:'etiq',   l:'🏷️ Étiquettes'},
    {k:'ponctuel',l:'⚡ Enregistrements ponctuels'},
  ];
  const hid = (S.navCfg||{}).hidden||{};
  const collapsed = S._catCollapsed||{};
  const bySec = {};
  catDefs.forEach(c=>{ bySec[c.k]=[]; });
  ALL.filter(s=>s.id!=='accueil'&&s.id!=='search'&&!hid[s.id])
     .forEach(s=>{ if(bySec[s.cat]) bySec[s.cat].push(s); });

  return catDefs.filter(c=>bySec[c.k].length>0).map(c=>{
    const isOpen = !collapsed[c.k];
    const cards = bySec[c.k].map(s=>{
      const nb = s.id==='enr28'
        ? (S.nett_val||[]).filter(r=>r.date&&r.date.startsWith(mois)).length
        : s.id==='enr19'
          ? _pFilter(S['enr19']?.saisies||[]).length
          : (S[s.id]?.lignes||[]).filter(r=>(r.date||r.dt?.slice(0,10)||'').startsWith(mois)).length;
      const code = s.label.split('–')[0].trim();
      const titre = (s.label.split('–')[1]||s.short).trim();
      const nbBadge = nb>0 ? '<span style="font-size:.68rem;color:#2e7d32;font-weight:800">✓ '+nb+'</span>' : '';
      return '<div class="hc" onclick="goTo(\''+s.id+'\')">'
        +'<span class="code">'+code+'</span>'
        +'<span class="titre">'+titre+'</span>'
        +'<div style="display:flex;justify-content:space-between;align-items:center;margin-top:auto">'
        +'<span class="ccat cat-'+s.cat+'">'+(s.tag||s.cat)+'</span>'
        +nbBadge
        +'</div></div>';
    }).join('');

    const arrow = isOpen ? '▲' : '▼';
    const header = '<div onclick="toggleCat(\''+c.k+'\')" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;margin:12px 0 0;padding:6px 2px;border-bottom:1px solid var(--brd)">'
      +'<span style="font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#7A6579">'+c.l+'</span>'
      +'<span style="font-size:.8rem;color:#b89ab6;font-weight:800">'+arrow+'</span>'
      +'</div>';
    const body = isOpen ? '<div class="hg">'+cards+'</div>' : '';
    return header + body;
  }).join('');
}

function renderEtiqReminder(){
  const t = today();
  // ── Plats témoins ENR33 expirés (DLC dépassée) — seulement ceux pas encore jetés ─
  const temoinsExpires = (S['enr33']?.lignes||[]).filter(r=>{
    if(!r.date_destruct) return false;
    if(r._jete) return false; // déjà marqué détruit
    return r.date_destruct < t;
  });
  const temoinsExpiresBlock = temoinsExpires.length > 0
    ? `<div style="background:linear-gradient(135deg,#dc2626,#b91c1c);border-radius:14px;padding:12px 14px;margin-bottom:10px;display:flex;align-items:center;gap:12px">
        <div style="font-size:1.8rem;flex-shrink:0">⚠️</div>
        <div style="flex:1;min-width:0;cursor:pointer" onclick="goTo('enr33')">
          <div style="font-size:.88rem;font-weight:900;color:#fff">🍱 Plats témoins à détruire !</div>
          <div style="font-size:.75rem;color:rgba(255,255,255,.85);margin-top:2px">${temoinsExpires.length} plat${temoinsExpires.length>1?'s':''} — DLC dépassée — obligation réglementaire</div>
        </div>
        <button onclick="event.stopPropagation();marquerTemoinsJetes()" style="background:rgba(255,255,255,.25);color:#fff;border:none;border-radius:10px;padding:8px 12px;font-size:.72rem;font-weight:900;cursor:pointer;font-family:inherit;white-space:nowrap;touch-action:manipulation">🗑️ Jetés</button>
      </div>`
    : '';

  const totalBatch = pendingLabelsCount();
  const batchBlock = totalBatch > 0 ? (()=>{
    const parts=[];
    if(_e34batch.length>0) parts.push(`${_e34batch.length} étiquette${_e34batch.length>1?'s':''} production`);
    if(_e36batch.length>0) parts.push(`${_e36batch.length} excédent${_e36batch.length>1?'s':''} `);
    if(_e33batch.length>0) parts.push(`${_e33batch.length} plat${_e33batch.length>1?'s':''} témoin`);
    return `<div onclick="goTo('enr34')" style="background:linear-gradient(135deg,#7c3aed,#a855f7);border-radius:14px;padding:12px 14px;margin-bottom:12px;cursor:pointer;display:flex;align-items:center;gap:12px">
      <div style="font-size:1.8rem;flex-shrink:0">🏷️</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:.88rem;font-weight:900;color:#fff">Étiquettes en attente d'impression !</div>
        <div style="font-size:.75rem;color:rgba(255,255,255,.8);margin-top:2px">${parts.join(' · ')} — N'oubliez pas de les coller !</div>
      </div>
      <div style="background:rgba(255,255,255,.25);color:#fff;border-radius:20px;padding:2px 10px;font-size:.8rem;font-weight:900;flex-shrink:0">${totalBatch}</div>
    </div>`;
  })() : '';

  if(!temoinsExpiresBlock && !batchBlock) return '';
  return temoinsExpiresBlock + batchBlock;
}

// ════════════════════════════════════════════════════
// BILAN FIN DE JOURNÉE — affiché après 20h30
// ════════════════════════════════════════════════════
function renderBilanJour() {
  const h = new Date().getHours();
  const hDec = h + new Date().getMinutes()/60;
  // Heure de fin = deadline du dernier service configuré (ou 20h30 par défaut)
  var svcs = getDistribServices();
  var lastDeadline = 20.5;
  if (svcs.length > 0) {
    var lastSvc = svcs[svcs.length - 1];
    var dl = lastSvc.deadline;
    if (typeof dl === 'string' && dl.includes(':')) {
      lastDeadline = parseInt(dl.split(':')[0]) + parseInt(dl.split(':')[1]||'0')/60;
    } else {
      lastDeadline = Number(dl) || 20.5;
    }
  }
  const isPreview = hDec < lastDeadline;
  if (isPreview && !S._bilanPreview) {
    return `<button onclick="S._bilanPreview=true;renderMain()" style="width:100%;padding:11px;background:var(--fond);border:1.5px solid var(--brd);border-radius:12px;font-size:.8rem;font-weight:800;color:var(--gris2);cursor:pointer;font-family:inherit;margin-bottom:12px">👁 Voir le bilan en cours (aperçu)</button>`;
  }

  const t = today();
  const mois = S.config?.mois || t.slice(0,7);

  // Tâches du tableau de bord
  const encs = getEnceintes();
  const saisies = S['enr19']?.saisies || [];
  const encToday = saisies.filter(r=>r.date===t);
  const encOuv = encs.filter(e=>encToday.some(r=>r.enc_id===e.id&&r.moment==='ouv')).length;
  const encFerm = encs.filter(e=>encToday.some(r=>r.enc_id===e.id&&r.moment==='ferm')).length;

  const distribSvcs = getDistribServices();
  const draft = distribDraft();
  const distribOk = distribSvcs.every(svc => {
    return (draft.date===t && draft[svc.id+'_valide']==='OUI')
        || (S['enr_tc_distrib']?.lignes||[]).some(r=>r.date===t&&r[svc.id+'_valide']==='OUI');
  });

  const refroidOk = (S['enr01']?.lignes||[]).filter(r=>r.date===t).length;
  const refroidNC = (S['enr01']?.lignes||[]).filter(r=>r.date===t&&r.conforme==='NON').length;
  const refroidAttente = (S['enr01']?.lignes||[]).filter(r=>r.date===t&&(!r._statut||r._statut==='en_attente')).length;

  const ncJour = (S['enr30']?.lignes||[]).filter(r=>r.date===t).length;
  const ncOuvertes = (S['enr30']?.lignes||[]).filter(r=>r.date===t&&r._auto===true&&r.cloture!=='OUI').length;

  const recepJour = (S['enr23']?.lignes||[]).filter(r=>r.date===t).length;
  const nettJour = (S.nett_val||[]).filter(r=>r.date===t&&r.conforme==='OUI').length;
  const nettRetards = nettRef().filter(it=>['retard','nc'].includes(nettStatus(it))).length;

  const items = [
    { ok: encs.length===0||encOuv>=encs.length, label: `T°C enceintes ouverture`, val: encs.length>0?`${encOuv}/${encs.length}`:'—' },
    { ok: encs.length===0||encFerm>=encs.length, label: `T°C enceintes fermeture`, val: encs.length>0?`${encFerm}/${encs.length}`:'—' },
    { ok: distribOk, label: `T°C distribution`, val: distribOk?'Validée':'Manquante ⚠️' },
    { ok: refroidAttente===0, label: `Refroidissements`, val: refroidOk>0?`${refroidOk} saisi${refroidOk>1?'s':''}${refroidNC>0?' · '+refroidNC+' NC ⚠️':''}${refroidAttente>0?' · '+refroidAttente+' en attente ⚠️':''}`:refroidAttente>0?'En attente ⚠️':'Aucun ce jour' },
    { ok: ncOuvertes===0, label: `Non-conformités`, val: ncJour>0?`${ncJour} créée${ncJour>1?'s':''}${ncOuvertes>0?' · '+ncOuvertes+' à clôturer ⚠️':''}`:' Aucune ✓' },
    { ok: recepJour>0, label: `Réceptions`, val: recepJour>0?`${recepJour} contrôlée${recepJour>1?'s':''}`:' Aucune ce jour' },
    { ok: nettRetards===0 && (nettJour>0 || !nettRef().some(it=>it.freq==='quotidien')), label: `Nettoyage`, val: nettRetards>0?`${nettRetards} en retard ⚠️`:nettJour>0?`${nettJour} valida${nettJour>1?'tions':'tion'} aujourd'hui`:'Aucune validation ⚠️' },
  ];

  const nbOk = items.filter(i=>i.ok).length;
  const score = Math.round(nbOk/items.length*100);
  const scoreColor = score===100?'#166534':score>=70?'#92400e':'#991b1b';
  const scoreBg = score===100?'#f0fdf4':score>=70?'#fff7ed':'#fee2e2';

  const previewBadge = isPreview ? `<div style="background:#fef3c7;border-radius:8px;padding:4px 10px;font-size:.65rem;font-weight:800;color:#92400e;margin-bottom:8px;display:inline-block">👁 Aperçu en cours de journée <button onclick="S._bilanPreview=false;renderMain()" style="background:none;border:none;cursor:pointer;color:#92400e;font-weight:900;font-size:.7rem;margin-left:6px">✕ Masquer</button></div>` : '';
  return `<div style="background:${scoreBg};border:1.5px solid ${score===100?'#86efac':score>=70?'#fde68a':'#fca5a5'};border-radius:16px;padding:14px 16px;margin-bottom:14px">
    ${previewBadge}
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <span style="font-size:1.3rem">${isPreview?'🔎':'🌙'}</span>
      <div style="flex:1">
        <div style="font-size:.88rem;font-weight:900;color:${scoreColor}">Bilan de la journée</div>
        <div style="font-size:.72rem;color:${scoreColor};opacity:.8">${nbOk}/${items.length} tâches complètes — ${score}%</div>
      </div>
      <div style="font-size:1.4rem;font-weight:900;color:${scoreColor}">${score}%</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:5px">
      ${items.map(i=>`<div style="display:flex;align-items:center;gap:8px;font-size:.78rem">
        <span>${i.ok?'✅':'⚠️'}</span>
        <span style="flex:1;font-weight:700;color:var(--gris)">${i.label}</span>
        <span style="color:${i.ok?'#166534':'#c2410c'};font-weight:700">${i.val}</span>
      </div>`).join('')}
    </div>
    ${ncOuvertes>0?`<button onclick="goTo('enr30')" style="width:100%;margin-top:10px;padding:10px;background:#dc2626;color:#fff;border:none;border-radius:10px;font-size:.82rem;font-weight:800;cursor:pointer;font-family:inherit">📋 Clôturer ${ncOuvertes} NC avant de partir</button>`:''}
    ${score===100?'<div style="text-align:center;font-size:.88rem;font-weight:800;color:#166534;margin-top:8px">🎉 Journée HACCP parfaite — bravo !</div>':''}
  </div>`;
}

function renderAccueil(){
  const mois = S.config?.mois||today().slice(0,7);
  const [y,m] = mois.split('-');
  const moisLabel = new Date(+y,+m-1,1).toLocaleDateString('fr-FR',{month:'long',year:'numeric'});
  return `
    ${renderBadgeEmploye()}
    ${renderHomeWidgets()}
    <div style="font-size:.65rem;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#b89ab6;margin:16px 0 8px 2px">📂 Toutes les fiches — ${moisLabel}</div>
    ${renderCatSections(mois)}`;
}

// ════════════════════════════════════════════════════
// ENR_TC_DISTRIB — T°C Distribution Midi & Soir
// ════════════════════════════════════════════════════
const DISTRIB_SEC = 'enr_tc_distrib';

// Services de distribution configurables
function getDistribServices(){
  return S.config?.distribServices || [
    {id:'midi', label:'Service Midi', ico:'🌞', midi_deb:'11:45', midi_fin:'13:30', soir_deb:'', soir_fin:''},
    {id:'soir', label:'Service Soir', ico:'🌙', midi_deb:'', midi_fin:'', soir_deb:'18:30', soir_fin:'20:00'},
  ];
}
function saveDistribServices(svcs){ S.config=S.config||{}; S.config.distribServices=svcs; save(); registerDistribSvcPages(); _saveConfigToSupabase(); }
const DISTRIB_FROID_MAX = 10;  // ≤ +10°C conforme
const DISTRIB_CHAUD_MIN = 63;  // ≥ +63°C conforme

// Structure draft: { date, midi_froid_plat, midi_froid_temp, midi_chaud_plat, midi_chaud_temp,
//   midi_valide, midi_cuisinier, midi_heure,
//   soir_froid_plat, soir_froid_temp, soir_chaud_plat, soir_chaud_temp,
//   soir_valide, soir_cuisinier, soir_heure }

function distribGD(id){ return ((S[DISTRIB_SEC]||{}).draft||{})[id]; }
function distribSD(id,val){ S[DISTRIB_SEC]=S[DISTRIB_SEC]||{}; S[DISTRIB_SEC].draft=S[DISTRIB_SEC].draft||{}; S[DISTRIB_SEC].draft[id]=val; save(); }
function distribDraft(){ return (S[DISTRIB_SEC]||{}).draft||{}; }

function distribTempConf(temp, type){
  if(temp===undefined||temp===''||temp===null||isNaN(parseFloat(temp))) return 'nd';
  const v=parseFloat(temp);
  return type==='froid' ? (v<=DISTRIB_FROID_MAX?'ok':'nc') : (v>=DISTRIB_CHAUD_MIN?'ok':'nc');
}

function distribTempBadge(temp, type){
  const conf=distribTempConf(temp,type);
  const disp=(temp!==undefined&&temp!==''&&!isNaN(parseFloat(temp)))?parseFloat(temp).toFixed(1)+'°C':'—';
  const icons={ok:'✅',nc:'❌',nd:'—'};
  return `<span class="distrib-temp-badge ${conf}">${icons[conf]} ${disp}</span>`;
}

function distribTempWidget(idPrefix, svc, type){
  const id=`${svc}_${type}_temp`;
  const val=distribGD(id);
  const numV=(val!==undefined&&val!==''&&!isNaN(parseFloat(val)))?parseFloat(val):null;
  const conf=distribTempConf(numV,type);
  const isFroid=type==='froid';
  const slMin=isFroid?-5:40; const slMax=isFroid?15:100; const slDef=isFroid?4:70;
  const slV=numV!==null?Math.max(slMin,Math.min(slMax,numV)):slDef;
  const slClass=isFroid?'froid':'chaud';
  const disp=numV!==null?numV.toFixed(1):'';
  return `<div class="distrib-temp-row">
    ${distribTempBadge(numV,type)}
    <input type="range" class="distrib-temp-slider ${slClass}" min="${slMin}" max="${slMax}" step="0.1"
      value="${slV}" id="dts-${svc}-${type}"
      oninput="distribSlider('${svc}','${type}',this.value)"
      onchange="distribSlider('${svc}','${type}',this.value)">
    <input type="number" step="0.1" min="${slMin}" max="${slMax}" class="distrib-temp-direct"
      value="${disp}" placeholder="°C" id="dtd-${svc}-${type}"
      oninput="distribDirect('${svc}','${type}',this.value)"
      onfocus="this.select()">
  </div>`;
}

function distribSlider(svc, type, val){
  const v=parseFloat(val);
  if(isNaN(v)) return;
  const id=`${svc}_${type}_temp`;
  distribSD(id,String(v));
  // Update direct input
  const di=document.getElementById(`dtd-${svc}-${type}`);
  if(di&&document.activeElement!==di) di.value=v.toFixed(1);
  // Update badge
  const badge=document.getElementById(`dtbadge-${svc}-${type}`);
  const conf=distribTempConf(v,type);
  const icons={ok:'✅',nc:'❌',nd:'—'};
  if(badge) badge.innerHTML=`${icons[conf]} ${v.toFixed(1)}°C`;
  if(badge) badge.className=`distrib-temp-badge ${conf}`;
  // Update auto-conf
  const cfid=`${svc}_${type}_conf`;
  distribSD(cfid, conf==='ok'?'OUI':'NON');
}

function distribDirect(svc, type, val){
  const v=parseFloat(val);
  if(isNaN(v)) return;
  const id=`${svc}_${type}_temp`;
  distribSD(id,String(v));
  // Update slider
  const slMin=type==='froid'?-5:40; const slMax=type==='froid'?15:100;
  const sl=document.getElementById(`dts-${svc}-${type}`);
  if(sl) sl.value=Math.max(slMin,Math.min(slMax,v));
  // Update badge
  const badge=document.getElementById(`dtbadge-${svc}-${type}`);
  const conf=distribTempConf(v,type);
  const icons={ok:'✅',nc:'❌',nd:'—'};
  if(badge) badge.innerHTML=`${icons[conf]} ${v.toFixed(1)}°C`;
  if(badge) badge.className=`distrib-temp-badge ${conf}`;
  const cfid=`${svc}_${type}_conf`;
  distribSD(cfid, conf==='ok'?'OUI':'NON');
}

function distribSaveService(svc){
  if(roCheck())return;
  const draft=distribDraft();
  const platFroid=(draft[`${svc}_froid_plat`]||'').trim();
  const platChaud=(draft[`${svc}_chaud_plat`]||'').trim();
  const tempFroid=draft[`${svc}_froid_temp`];
  const tempChaud=draft[`${svc}_chaud_temp`];
  if(!platFroid && !platChaud){ toast('⚠️ Saisissez au moins un plat','warning'); return; }
  if((!tempFroid&&platFroid) || (!tempChaud&&platChaud)){ toast('⚠️ Relevez la T°C de chaque plat','warning'); return; }

  const confF=distribTempConf(tempFroid,'froid');
  const confC=distribTempConf(tempChaud,'chaud');
  distribSD(`${svc}_conf_froid`, platFroid ? (confF==='ok'?'OUI':'NON') : '');
  distribSD(`${svc}_conf_chaud`, platChaud ? (confC==='ok'?'OUI':'NON') : '');
  distribSD(`${svc}_valide`, 'OUI');
  distribSD(`${svc}_cuisinier`, getActiveSession() || draft[`${svc}_cuisinier`] || '');
  if(!draft[`${svc}_heure`]) distribSD(`${svc}_heure`, nowT());

  // Alertes NC
  if((platFroid&&confF==='nc') || (platChaud&&confC==='nc')){
    appVibrate([300,100,300,100,300]);
    toast('⚠️ Température NON CONFORME — Complétez une fiche NC !','warning');
  } else {
    appVibrate([50]);
    toast(`✅ Service ${svc==='midi'?'Midi':'Soir'} validé !`);
  }

  // Si les deux services sont validés → sauvegarder la ligne journalière
  const d=distribDraft();
  if(d.midi_valide==='OUI' && d.soir_valide==='OUI'){
    distribSaveDailyRow();
  }
  renderMain();
}

function distribSaveDailyRow(){
  const d=distribDraft();
  const date=d.date||today();
  S[DISTRIB_SEC]=S[DISTRIB_SEC]||{};
  S[DISTRIB_SEC].lignes=S[DISTRIB_SEC].lignes||[];
  const lignes=S[DISTRIB_SEC].lignes;
  // Chercher si déjà une entrée pour ce jour
  const existIdx=lignes.findIndex(r=>r.date===date);
  // _ts déterministe : même client_id si midi puis soir → upsert Supabase
  const existingTs = existIdx>=0 ? (lignes[existIdx]._ts || (date+'T00:00:00.000Z')) : (date+'T00:00:00.000Z');
  const row={
    _ts:existingTs, _sec:DISTRIB_SEC, date,
    midi_froid_plat:d.midi_froid_plat||'', midi_froid_temp:d.midi_froid_temp||'',
    midi_froid_conf:d.midi_conf_froid||'', midi_chaud_plat:d.midi_chaud_plat||'',
    midi_chaud_temp:d.midi_chaud_temp||'', midi_chaud_conf:d.midi_conf_chaud||'',
    midi_valide:d.midi_valide||'', midi_cuisinier:d.midi_cuisinier||'', midi_heure:d.midi_heure||'',
    soir_froid_plat:d.soir_froid_plat||'', soir_froid_temp:d.soir_froid_temp||'',
    soir_froid_conf:d.soir_conf_froid||'', soir_chaud_plat:d.soir_chaud_plat||'',
    soir_chaud_temp:d.soir_chaud_temp||'', soir_chaud_conf:d.soir_conf_chaud||'',
    soir_valide:d.soir_valide||'', soir_cuisinier:d.soir_cuisinier||'', soir_heure:d.soir_heure||'',
  };
  if(existIdx>=0) lignes[existIdx]=row;
  else lignes.unshift(row);
  save(); autoBackup();
  try { SupaEngine.enqueue(DISTRIB_SEC, row); } catch(e){}
}

function distribResetService(svc){
  const draft=distribDraft();
  [`${svc}_froid_plat`,`${svc}_froid_temp`,`${svc}_chaud_plat`,`${svc}_chaud_temp`,
   `${svc}_conf_froid`,`${svc}_conf_chaud`,`${svc}_valide`,`${svc}_cuisinier`,`${svc}_heure`
  ].forEach(k=>{ delete draft[k]; });
  save(); renderMain();
}

function distribServiceCard(svc){
  const draft=distribDraft();
  const label=svc==='midi'?'🌞 Service Midi':'🌙 Service Soir';
  const valide=draft[`${svc}_valide`]==='OUI';
  const cuisinier=draft[`${svc}_cuisinier`]||'';
  const heure=draft[`${svc}_heure`]||'';
  const confF=distribTempConf(draft[`${svc}_froid_temp`],'froid');
  const confC=distribTempConf(draft[`${svc}_chaud_temp`],'chaud');
  const allOk=confF==='ok'&&confC==='ok';
  const hasNC=(confF==='nc'||confC==='nc');
  const status=valide?(allOk?'done':'done'):'pending';

  return `<div class="distrib-svc ${valide?'done':''}">
    <div class="distrib-svc-title">
      ${label}
      <span class="distrib-svc-badge ${valide?(allOk?'done':'done'):'pending'}">
        ${valide?'✓ Validé':'À saisir'}
      </span>
      ${valide&&cuisinier?`<span style="font-size:.65rem;color:#b89ab6;font-weight:700;margin-left:auto">👨‍🍳 ${escH(cuisinier)}${heure?' · '+heure:''}</span>`:''}
    </div>
    ${valide&&hasNC?`<div style="background:#fee2e2;border-radius:8px;padding:7px 10px;font-size:.75rem;font-weight:700;color:#991b1b;margin-bottom:8px">❌ Température non conforme — Fiche NC requise</div>`:''}

    <div class="distrib-sub">❄️ Plat froid</div>
    <div class="mic-wrap" style="${valide?'opacity:.6;pointer-events:none':''}">
      <input class="distrib-plat-inp fi" id="distrib-inp-${svc}-froid" type="text" placeholder="Nom du plat froid..." maxlength="60"
        value="${escH(draft[`${svc}_froid_plat`]||'')}"
        oninput="distribSD('${svc}_froid_plat',this.value)"
        style="border-radius:10px 0 0 10px;border-right:none;margin-bottom:0"
        ${valide?'readonly':''}>
      <button type="button" class="mic-btn" title="Dicter" onclick="startMicField('distrib-inp-${svc}-froid',v=>distribSD('${svc}_froid_plat',v))">🎤</button>
    </div>
    <div id="dts-wrap-${svc}-froid">
      ${distribTempWidget(svc,svc,'froid')}
      <div id="dtbadge-${svc}-froid" class="distrib-temp-badge ${confF}" style="display:inline-block;margin-bottom:4px">
        ${confF==='ok'?'✅':confF==='nc'?'❌':'—'} ${draft[`${svc}_froid_temp`]!==undefined&&draft[`${svc}_froid_temp`]!==''?parseFloat(draft[`${svc}_froid_temp`]).toFixed(1)+'°C':'—'}
      </div>
      <span style="font-size:.7rem;color:#b89ab6;font-weight:700"> Consigne ≤ +${DISTRIB_FROID_MAX}°C</span>
    </div>

    <div class="distrib-sub">🔥 Plat chaud</div>
    <div class="mic-wrap" style="${valide?'opacity:.6;pointer-events:none':''}">
      <input class="distrib-plat-inp fi" id="distrib-inp-${svc}-chaud" type="text" placeholder="Nom du plat chaud..." maxlength="60"
        value="${escH(draft[`${svc}_chaud_plat`]||'')}"
        oninput="distribSD('${svc}_chaud_plat',this.value)"
        style="border-radius:10px 0 0 10px;border-right:none;margin-bottom:0"
        ${valide?'readonly':''}>
      <button type="button" class="mic-btn" title="Dicter" onclick="startMicField('distrib-inp-${svc}-chaud',v=>distribSD('${svc}_chaud_plat',v))">🎤</button>
    </div>
    <div id="dts-wrap-${svc}-chaud">
      ${distribTempWidget(svc,svc,'chaud')}
      <div id="dtbadge-${svc}-chaud" class="distrib-temp-badge ${confC}" style="display:inline-block;margin-bottom:4px">
        ${confC==='ok'?'✅':confC==='nc'?'❌':'—'} ${draft[`${svc}_chaud_temp`]!==undefined&&draft[`${svc}_chaud_temp`]!==''?parseFloat(draft[`${svc}_chaud_temp`]).toFixed(1)+'°C':'—'}
      </div>
      <span style="font-size:.7rem;color:#b89ab6;font-weight:700"> Consigne ≥ +${DISTRIB_CHAUD_MIN}°C</span>
    </div>

    <div class="distrib-sub">🕐 Heure de prise de température</div>
    ${(()=>{
      const heureId=`${svc}_heure`;
      const heureVal=distribGD(heureId)||'';
      const inner=heureVal?`<span>⏰</span><span class="tv">${heureVal}</span>`:`<span>⏰</span><span class="tp2">Appuyer pour saisir</span>`;
      return `<button type="button" class="time-btn" data-tw="${heureId}-${DISTRIB_SEC}" onclick="openTW('${heureId}','${DISTRIB_SEC}','Heure – service ${svc==='midi'?'Midi':'Soir'}')" ${valide?'disabled style="opacity:.5"':''}>${inner}</button>`;
    })()}

    ${valide
      ? `<button class="distrib-val-btn edit" onclick="distribResetService('${svc}')">✏️ Modifier le service ${svc==='midi'?'midi':'soir'}</button>`
      : `<button class="distrib-val-btn ready" onclick="distribSaveService('${svc}')">✅ Valider le service ${svc==='midi'?'Midi':'Soir'}</button>`
    }
  </div>`;
}

function distribAlertBanner(){
  const now=new Date();
  const h=now.getHours();
  const draft=distribDraft();
  const date=draft.date||today();
  if(date!==today()) return '';
  const midiOk=draft.midi_valide==='OUI';
  const soirOk=draft.soir_valide==='OUI';
  const alerts=[];
  if(!midiOk && h>=14) alerts.push('⏰ Le service Midi n\'a pas encore été validé !');
  if(!soirOk && h>=21) alerts.push('⏰ Le service Soir n\'a pas encore été validé !');
  if(!alerts.length) return '';
  return `<div class="distrib-alert-banner">
    <span class="distrib-alert-icon">⚠️</span>
    <div class="distrib-alert-text">${alerts.join('<br>')}</div>
  </div>`;
}

function distribHistoCard(){
  const lignes=(S[DISTRIB_SEC]||{}).lignes||[];
  if(!lignes.length) return `<div class="card"><div class="empty-s">Aucune journée enregistrée.</div></div>`;
  const rows=lignes.slice(0,30).map((r,i)=>{
    const dateF=r.date?new Date(r.date+'T12:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'}):'—';
    const confGlobal=[r.midi_froid_conf,r.midi_chaud_conf,r.soir_froid_conf,r.soir_chaud_conf];
    const hasNC=confGlobal.includes('NON');
    const allValidated=r.midi_valide==='OUI'&&r.soir_valide==='OUI';
    return `<div class="distrib-histo-row">
      <div class="distrib-histo-date">
        📅 ${escH(dateF)}
        ${allValidated?'<span class="bo oui" style="font-size:.65rem">✓ Complet</span>':'<span class="bo nd" style="font-size:.65rem">Partiel</span>'}
        ${hasNC?'<span class="bo non" style="font-size:.65rem">⚠️ NC</span>':''}

      </div>
      <div class="distrib-histo-grid">
        <div class="distrib-histo-svc">
          <div class="distrib-histo-svc-title">🌞 Midi ${r.midi_heure?'· '+r.midi_heure:''}</div>
          ${r.midi_froid_plat?`<div class="distrib-histo-item"><span>❄️ ${escH(r.midi_froid_plat)}</span><span class="distrib-tc ${r.midi_froid_conf==='OUI'?'ok':r.midi_froid_conf==='NON'?'nc':'nd'}">${r.midi_froid_temp?parseFloat(r.midi_froid_temp).toFixed(1)+'°C':'—'}</span></div>`:''}
          ${r.midi_chaud_plat?`<div class="distrib-histo-item"><span>🔥 ${escH(r.midi_chaud_plat)}</span><span class="distrib-tc ${r.midi_chaud_conf==='OUI'?'ok':r.midi_chaud_conf==='NON'?'nc':'nd'}">${r.midi_chaud_temp?parseFloat(r.midi_chaud_temp).toFixed(1)+'°C':'—'}</span></div>`:''}
          ${r.midi_cuisinier?`<div style="font-size:.68rem;color:#b89ab6;margin-top:4px">👨‍🍳 ${escH(r.midi_cuisinier)}</div>`:''}
        </div>
        <div class="distrib-histo-svc">
          <div class="distrib-histo-svc-title">🌙 Soir ${r.soir_heure?'· '+r.soir_heure:''}</div>
          ${r.soir_froid_plat?`<div class="distrib-histo-item"><span>❄️ ${escH(r.soir_froid_plat)}</span><span class="distrib-tc ${r.soir_froid_conf==='OUI'?'ok':r.soir_froid_conf==='NON'?'nc':'nd'}">${r.soir_froid_temp?parseFloat(r.soir_froid_temp).toFixed(1)+'°C':'—'}</span></div>`:''}
          ${r.soir_chaud_plat?`<div class="distrib-histo-item"><span>🔥 ${escH(r.soir_chaud_plat)}</span><span class="distrib-tc ${r.soir_chaud_conf==='OUI'?'ok':r.soir_chaud_conf==='NON'?'nc':'nd'}">${r.soir_chaud_temp?parseFloat(r.soir_chaud_temp).toFixed(1)+'°C':'—'}</span></div>`:''}
          ${r.soir_cuisinier?`<div style="font-size:.68rem;color:#b89ab6;margin-top:4px">👨‍🍳 ${escH(r.soir_cuisinier)}</div>`:''}
        </div>
      </div>
    </div>`;
  }).join('');
  return `<div class="card">
    <div class="hh">
      <span class="hh-title">📜 Historique</span>
      <span class="hh-badge">${lignes.length} jour${lignes.length>1?'s':''}</span>
    </div>
    ${rows}
  </div>`;
}

function distribDeleteRow(i){
  showConfirm('Supprimer cette journée ?','Toutes les températures de ce jour seront effacées.','🗑️ Supprimer',()=>{
    (S[DISTRIB_SEC]||{lignes:[]}).lignes.splice(i,1); save(); renderMain();
  });
}

function distribNouvelleJournee(){
  S[DISTRIB_SEC]=S[DISTRIB_SEC]||{}; S[DISTRIB_SEC].draft={}; distribSD('date',today()); save(); renderMain();
}


// ════════════════════════════════════════════════════
// DISTRIBUTION PAR SERVICE — pages indépendantes
// Chaque service configuré a sa propre section :
//   enr_distrib_{svcId}  →  S['enr_distrib_midi'], etc.
// ════════════════════════════════════════════════════

function distribSvcKey(svcId){ return 'enr_distrib_'+svcId; }
function distribSvcDraft(svcId){ var k=distribSvcKey(svcId); return (S[k]&&S[k].draft)||{}; }
function distribSvcGD(svcId,key){ return distribSvcDraft(svcId)[key]; }
function distribSvcSD(svcId,key,val){
  var k=distribSvcKey(svcId);
  S[k]=S[k]||{}; S[k].draft=S[k].draft||{};
  S[k].draft[key]=val; save();
}
// slot = 'midi' ou 'soir'
function distribSvcSlotSD(svcId,slot,field,val){ distribSvcSD(svcId,slot+'_'+field,val); }
function distribSvcSlotGD(svcId,slot,field){ return distribSvcGD(svcId,slot+'_'+field); }

// Sauvegarder un slot (midi ou soir) — structure identique à enr_tc_distrib
function distribSvcSaveRow(svcId, slot){
  const svc = getDistribServices().find(s=>s.id===svcId);
  if(!svc) return;
  const d = distribSvcDraft(svcId);
  const date = d.date||today();
  const k = distribSvcKey(svcId);
  S[k]=S[k]||{}; S[k].lignes=S[k].lignes||[];
  const lignes=S[k].lignes;
  const existIdx=lignes.findIndex(r=>r.date===date);
  // Pour les distributions, on utilise date+siteId comme clé déterministe
  // Si la ligne existe déjà (ex: midi déjà sauvé), on garde son _ts MAIS on force un nouvel _ts
  // pour que SupaEngine re-enqueue avec les données complètes
  // _ts déterministe basé sur la date → même client_id pour midi et soir du même jour
  // Quand la ligne existe déjà (midi sauvé), on garde son _ts : même client_id → upsert Supabase
  const deterministicTs = date + 'T00:00:00.000Z';
  const existing = existIdx>=0
    ? {...lignes[existIdx]}             // Garder le _ts original → même client_id → merge
    : {_ts:deterministicTs,_sec:k,date}; // Nouveau : _ts basé sur date, pas l'heure
  const confF=distribTempConf(d[slot+'_froid_temp'],'froid');
  const confC=distribTempConf(d[slot+'_chaud_temp'],'chaud');
  existing[slot+'_froid_plat']=d[slot+'_froid_plat']||'';
  existing[slot+'_froid_temp']=d[slot+'_froid_temp']||'';
  existing[slot+'_froid_conf']=confF==='ok'?'OUI':'NON';
  existing[slot+'_chaud_plat']=d[slot+'_chaud_plat']||'';
  existing[slot+'_chaud_temp']=d[slot+'_chaud_temp']||'';
  existing[slot+'_chaud_conf']=confC==='ok'?'OUI':'NON';
  existing[slot+'_valide']='OUI';
  existing[slot+'_cuisinier']=d[slot+'_cuisinier']||getActiveSession()||'';
  existing[slot+'_heure']=d[slot+'_heure']||nowT();
  if(existIdx>=0) lignes[existIdx]=existing; else lignes.unshift(existing);
  save(); autoBackup();
  try { SupaEngine.enqueue(k, existing); } catch(e){}
  if(confF==='nc') autoCreateNC(k,'T°C froid NC : '+svc.label+' '+slot,svc.label,'Contrôler');
  if(confC==='nc') autoCreateNC(k,'T°C chaud NC : '+svc.label+' '+slot,svc.label,'Contrôler');
}

function distribSvcValidate(svcId, slot){
  if(roCheck()) return;
  const d = distribSvcDraft(svcId);
  if(!d[slot+'_froid_temp'] && !d[slot+'_chaud_temp']){ toast('⚠️ Saisissez au moins une T°C','warning'); return; }
  distribSvcSD(svcId,slot+'_valide','OUI');
  if(!d[slot+'_cuisinier']) distribSvcSD(svcId,slot+'_cuisinier',getActiveSession()||'');
  if(!d[slot+'_heure']) distribSvcSD(svcId,slot+'_heure',nowT());
  distribSvcSaveRow(svcId,slot);
  toast('✅ Validé et enregistré','success');
  renderMain();
}

function distribSvcReset(svcId, slot){
  const k=distribSvcKey(svcId);
  if(!S[k]) S[k]={};
  if(!S[k].draft) S[k].draft={};
  const d=S[k].draft;
  ['froid_plat','froid_temp','chaud_plat','chaud_temp','valide','cuisinier','heure'].forEach(f=>{
    delete d[slot+'_'+f];
  });
  save(); renderMain();
}

function distribSvcResetAll(svcId){
  const k=distribSvcKey(svcId);
  S[k]=S[k]||{}; S[k].draft={date:today()};
  save(); renderMain();
}

function distribSvcDelRow(svcId, i){
  showConfirm('Supprimer cette journée ?','Toutes les températures de ce jour seront effacées.','🗑️ Supprimer',()=>{
    const k='enr_distrib_'+svcId;
    if(S[k]&&S[k].lignes) S[k].lignes.splice(i,1);
    save(); renderMain();
  });
}

// Variable pour scroller au bon slot à l'ouverture
var _distribSvcScroll = null;

function renderENR_DISTRIB_SVC(svcId){
  const svc = getDistribServices().find(s=>s.id===svcId);
  if(!svc) return '<div class="card"><p style="color:#b89ab6;text-align:center;padding:30px">Service introuvable.</p></div>';
  const k = distribSvcKey(svcId);
  const d = distribSvcDraft(svcId);
  const t = today();
  // Si le draft est d'un autre jour, réinitialiser les validations
  if(d.date && d.date !== t){
    // Garder la date d'hier pour permettre la saisie rétroactive,
    // mais ne pas laisser les validations d'hier bloquer
  }
  if(!d.date) distribSvcSD(svcId,'date',t);
  const date = d.date||t;
  const dateF = new Date(date+'T12:00').toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'});
  const midiOk = d.midi_valide==='OUI';
  const soirOk = d.soir_valide==='OUI';

  // Générer une carte identique à distribServiceCard pour chaque slot
  const makeSlotCard = (slot, slotLabel) => {
    const ico = slot==='midi'?'🌞':'🌙';
    // valide = OUI ET au moins une T°C saisie
    const valide = d[slot+'_valide']==='OUI' && (d[slot+'_froid_temp'] || d[slot+'_chaud_temp']);
    const cuisinier = d[slot+'_cuisinier']||'';
    const heure = d[slot+'_heure']||'';
    const confF = distribTempConf(d[slot+'_froid_temp'],'froid');
    const confC = distribTempConf(d[slot+'_chaud_temp'],'chaud');
    const hasNC = confF==='nc'||confC==='nc';
    const numF=(d[slot+'_froid_temp']!==undefined&&d[slot+'_froid_temp']!==''&&!isNaN(parseFloat(d[slot+'_froid_temp'])))?parseFloat(d[slot+'_froid_temp']):null;
    const numC=(d[slot+'_chaud_temp']!==undefined&&d[slot+'_chaud_temp']!==''&&!isNaN(parseFloat(d[slot+'_chaud_temp'])))?parseFloat(d[slot+'_chaud_temp']):null;
    const slMinF=-5,slMaxF=15,slMinC=40,slMaxC=100;
    const slVF=numF!==null?Math.max(slMinF,Math.min(slMaxF,numF)):4;
    const slVC=numC!==null?Math.max(slMinC,Math.min(slMaxC,numC)):70;
    const dispF=numF!==null?numF.toFixed(1):'';
    const dispC=numC!==null?numC.toFixed(1):'';
    const heureVal=d[slot+'_heure']||'';
    const heureInner=heureVal?`<span>⏰</span><span class="tv">${heureVal}</span>`:`<span>⏰</span><span class="tp2">Appuyer pour saisir</span>`;
    const chefVal=d[slot+'_cuisinier']||'';
    const chefs=getChefs();
    const active=getActiveSession();
    // NE PAS appeler distribSvcSD pendant le rendu — juste lire la valeur
    const chefValFinal = chefVal || (active&&chefs.includes(active)?active:'');
    const chefShtml=chefs.length===0
      ?`<div class="fg"><label>Cuisinier</label><input class="fi" type="text" value="${escH(chefValFinal)}" oninput="distribSvcSD('${svcId}','${slot}_cuisinier',this.value)" placeholder="Visa / Initiales" ${valide?'readonly':''}></div>`
      :`<div class="fg"><label>Cuisinier</label><select class="fi" onchange="distribSvcSD('${svcId}','${slot}_cuisinier',this.value)" ${valide?'disabled':''}><option value="">— Sélectionner —</option>${chefs.map(c=>`<option ${chefValFinal===c?'selected':''}>${escH(c)}</option>`).join('')}</select></div>`;

    return `<div class="distrib-svc ${valide?'done':''}" id="dsvc-slot-${svcId}-${slot}">
      <div class="distrib-svc-title">
        ${ico} ${slotLabel}
        <span class="distrib-svc-badge ${valide?'done':'pending'}">${valide?'✓ Validé':'À saisir'}</span>
        ${valide&&cuisinier?`<span style="font-size:.65rem;color:#b89ab6;font-weight:700;margin-left:auto">👨‍🍳 ${escH(cuisinier)}${heure?' · '+heure:''}</span>`:''}
      </div>
      ${valide&&hasNC?`<div style="background:#fee2e2;border-radius:8px;padding:7px 10px;font-size:.75rem;font-weight:700;color:#991b1b;margin-bottom:8px">❌ Température non conforme — Fiche NC requise</div>`:''}

      <div class="distrib-sub">❄️ Plat froid</div>
      <div class="mic-wrap" style="${valide?'opacity:.6;pointer-events:none':''}">
        <input class="distrib-plat-inp fi" id="dsvc-${svcId}-${slot}-fp" type="text" placeholder="Nom du plat froid..." maxlength="60"
          value="${escH(d[slot+'_froid_plat']||'')}"
          oninput="distribSvcSD('${svcId}','${slot}_froid_plat',this.value)"
          style="border-radius:10px 0 0 10px;border-right:none;margin-bottom:0" ${valide?'readonly':''}>
        <button type="button" class="mic-btn" onclick="startMicField('dsvc-${svcId}-${slot}-fp',function(v){distribSvcSD('${svcId}','${slot}_froid_plat',v);document.getElementById('dsvc-${svcId}-${slot}-fp').value=v;})">🎤</button>
      </div>
      <div class="distrib-temp-row">
        <div data-qt="svc" data-qs="${svcId}" data-qt2="${slot}_froid" data-qn="${slMinF}" data-qx="${slMaxF}" onclick="qtTap(this)" style="cursor:pointer;flex-shrink:0">${distribTempBadge(numF,'froid')}</div>
        <input type="range" class="distrib-temp-slider froid" min="${slMinF}" max="${slMaxF}" step="0.1" value="${slVF}"
          id="dsvcs-${svcId}-${slot}-froid"
          oninput="distribSvcSlider('${svcId}','${slot}_froid',this.value)"
          onchange="distribSvcSlider('${svcId}','${slot}_froid',this.value)" ${valide?'disabled':''}>
        <div id="dtd-svc-${svcId}-${slot}-froid" class="qt-fake-inp distrib-temp-direct"
          data-qt="svc" data-qs="${svcId}" data-qt2="${slot}_froid" data-qn="${slMinF}" data-qx="${slMaxF}"
          onclick="qtTap(this)">${dispF}</div>
      </div>
      <div id="dtbadge-svc-${svcId}-${slot}-froid" class="distrib-temp-badge ${confF}" style="display:inline-block;margin-bottom:4px">
        ${confF==='ok'?'✅':confF==='nc'?'❌':'—'} ${numF!==null?numF.toFixed(1)+'°C':'—'}
      </div>
      <span style="font-size:.7rem;color:#b89ab6;font-weight:700"> Consigne ≤ +${DISTRIB_FROID_MAX}°C</span>

      <div class="distrib-sub">🔥 Plat chaud</div>
      <div class="mic-wrap" style="${valide?'opacity:.6;pointer-events:none':''}">
        <input class="distrib-plat-inp fi" id="dsvc-${svcId}-${slot}-cp" type="text" placeholder="Nom du plat chaud..." maxlength="60"
          value="${escH(d[slot+'_chaud_plat']||'')}"
          oninput="distribSvcSD('${svcId}','${slot}_chaud_plat',this.value)"
          style="border-radius:10px 0 0 10px;border-right:none;margin-bottom:0" ${valide?'readonly':''}>
        <button type="button" class="mic-btn" onclick="startMicField('dsvc-${svcId}-${slot}-cp',function(v){distribSvcSD('${svcId}','${slot}_chaud_plat',v);document.getElementById('dsvc-${svcId}-${slot}-cp').value=v;})">🎤</button>
      </div>
      <div class="distrib-temp-row">
        <div data-qt="svc" data-qs="${svcId}" data-qt2="${slot}_chaud" data-qn="${slMinC}" data-qx="${slMaxC}" onclick="qtTap(this)" style="cursor:pointer;flex-shrink:0">${distribTempBadge(numC,'chaud')}</div>
        <input type="range" class="distrib-temp-slider chaud" min="${slMinC}" max="${slMaxC}" step="0.1" value="${slVC}"
          id="dsvcs-${svcId}-${slot}-chaud"
          oninput="distribSvcSlider('${svcId}','${slot}_chaud',this.value)"
          onchange="distribSvcSlider('${svcId}','${slot}_chaud',this.value)" ${valide?'disabled':''}>
        <div id="dtd-svc-${svcId}-${slot}-chaud" class="qt-fake-inp distrib-temp-direct"
          data-qt="svc" data-qs="${svcId}" data-qt2="${slot}_chaud" data-qn="${slMinC}" data-qx="${slMaxC}"
          onclick="qtTap(this)">${dispC}</div>
      </div>
      <div id="dtbadge-svc-${svcId}-${slot}-chaud" class="distrib-temp-badge ${confC}" style="display:inline-block;margin-bottom:4px">
        ${confC==='ok'?'✅':confC==='nc'?'❌':'—'} ${numC!==null?numC.toFixed(1)+'°C':'—'}
      </div>
      <span style="font-size:.7rem;color:#b89ab6;font-weight:700"> Consigne ≥ +${DISTRIB_CHAUD_MIN}°C</span>

      <div class="distrib-sub">🕐 Heure de prise de température</div>
      <button type="button" class="time-btn" data-tw="${slot}_heure-${k}"
        onclick="openTW('${slot}_heure','${k}','Heure – ${slotLabel}')"
        ${valide?'disabled style="opacity:.5"':''}>${heureInner}</button>

      ${chefShtml}

      ${valide
        ?`<button class="distrib-val-btn edit" onclick="distribSvcReset('${svcId}','${slot}')">✏️ Modifier ${slotLabel}</button>`
        :`<button class="distrib-val-btn ready" onclick="distribSvcValidate('${svcId}','${slot}')">✅ Valider ${slotLabel}</button>`
      }
    </div>`;
  };

  // Historique
  const lignes = (S[k]&&S[k].lignes)||[];
  const histoRows = lignes.slice(0,30).map((r,i)=>{
    const dateH = r.date?new Date(r.date+'T12:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'}):'—';
    const midiV=r.midi_valide==='OUI', soirV=r.soir_valide==='OUI';
    const hasNCr=[r.midi_froid_conf,r.midi_chaud_conf,r.soir_froid_conf,r.soir_chaud_conf].includes('NON');
    return `<div class="distrib-histo-row">
      <div class="distrib-histo-date">
        📅 ${escH(dateH)}
        ${midiV&&soirV?'<span class="bo oui" style="font-size:.65rem">✓ Complet</span>':'<span class="bo nd" style="font-size:.65rem">Partiel</span>'}
        ${hasNCr?'<span class="bo non" style="font-size:.65rem">⚠️ NC</span>':''}

      </div>
      <div class="distrib-histo-grid">
        <div class="distrib-histo-svc">
          <div class="distrib-histo-svc-title">🌞 Midi${r.midi_heure?' · '+r.midi_heure:''}</div>
          ${r.midi_froid_plat?`<div class="distrib-histo-item"><span>❄️ ${escH(r.midi_froid_plat)}</span><span class="distrib-tc ${r.midi_froid_conf==='OUI'?'ok':'nc'}">${r.midi_froid_temp?parseFloat(r.midi_froid_temp).toFixed(1)+'°C':'—'}</span></div>`:''}
          ${r.midi_chaud_plat?`<div class="distrib-histo-item"><span>🔥 ${escH(r.midi_chaud_plat)}</span><span class="distrib-tc ${r.midi_chaud_conf==='OUI'?'ok':'nc'}">${r.midi_chaud_temp?parseFloat(r.midi_chaud_temp).toFixed(1)+'°C':'—'}</span></div>`:''}
          ${r.midi_cuisinier?`<div style="font-size:.68rem;color:#b89ab6;margin-top:4px">👨‍🍳 ${escH(r.midi_cuisinier)}</div>`:''}
        </div>
        <div class="distrib-histo-svc">
          <div class="distrib-histo-svc-title">🌙 Soir${r.soir_heure?' · '+r.soir_heure:''}</div>
          ${r.soir_froid_plat?`<div class="distrib-histo-item"><span>❄️ ${escH(r.soir_froid_plat)}</span><span class="distrib-tc ${r.soir_froid_conf==='OUI'?'ok':'nc'}">${r.soir_froid_temp?parseFloat(r.soir_froid_temp).toFixed(1)+'°C':'—'}</span></div>`:''}
          ${r.soir_chaud_plat?`<div class="distrib-histo-item"><span>🔥 ${escH(r.soir_chaud_plat)}</span><span class="distrib-tc ${r.soir_chaud_conf==='OUI'?'ok':'nc'}">${r.soir_chaud_temp?parseFloat(r.soir_chaud_temp).toFixed(1)+'°C':'—'}</span></div>`:''}
          ${r.soir_cuisinier?`<div style="font-size:.68rem;color:#b89ab6;margin-top:4px">👨‍🍳 ${escH(r.soir_cuisinier)}</div>`:''}
        </div>
      </div>
    </div>`;
  }).join('');

  return `
    <div class="card">
      <div class="card-title">${svc.ico||'🍽️'} ${escH(svc.label)}
        <span class="tag prpo">PrPo</span>
      </div>
      <div class="regle">Froid ≤ +${DISTRIB_FROID_MAX}°C — Chaud ≥ +${DISTRIB_CHAUD_MIN}°C</div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:0">
          <div style="font-size:.66rem;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#b89ab6;margin-bottom:4px">Date</div>
          <button class="dp-trigger" id="dpf-date-${k}" onclick="openDP('${date}',(v)=>{distribSvcSD('${svcId}','date',v);renderMain();},{max:'${t}'})">
            <span class="dp-ico">📅</span>
            <span class="dp-val">${new Date(date+'T12:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'})}</span>
            <span style="font-size:.7rem;color:#c0a0c0">▼</span>
          </button>
        </div>
        ${midiOk&&soirOk?`<button class="btn btn-sec" style="padding:8px 12px;font-size:.8rem;align-self:flex-end" onclick="distribSvcResetAll('${svcId}')">+ Nouvelle journée</button>`:''}
      </div>
      <div class="distrib-services">
        ${makeSlotCard('midi','🌞 Service Midi')}
        ${makeSlotCard('soir','🌙 Service Soir')}
      </div>
      ${midiOk&&soirOk?`<div style="background:#f0fdf4;border:2px solid #4caf50;border-radius:12px;padding:12px 14px;text-align:center;font-size:.9rem;font-weight:800;color:#166534">
        ✅ Journée du ${escH(dateF)} complète — Enregistrée
        <button class="btn btn-sec" style="display:block;width:100%;margin-top:8px;font-size:.78rem" onclick="distribSvcResetAll('${svcId}')">+ Saisir une autre journée</button>
      </div>`:''}
    </div>
    ${lignes.length?`<div class="card"><div class="hh"><span class="hh-title">📜 Historique — ${escH(svc.label)}</span><span class="hh-badge">${lignes.length} jour${lignes.length>1?'s':''}</span></div>${histoRows}</div>`:`<div class="card"><div class="empty-s">Aucune journée enregistrée.</div></div>`}`;
}


// Slider + qtTap pour les sections par service
// slotType = "midi_froid" | "midi_chaud" | "soir_froid" | "soir_chaud"
function distribSvcSlider(svcId, slotType, val){
  const v=parseFloat(val); if(isNaN(v)) return;
  const parts = slotType.split('_');
  const tempType = parts[parts.length-1]; // 'froid' ou 'chaud'
  // Sauvegarder
  distribSvcSD(svcId, slotType+'_temp', String(v));
  // IDs HTML utilisent des tirets : dtd-svc-up-midi-froid
  const domId = slotType.replace('_','-'); // "midi_froid" → "midi-froid"
  const di=document.getElementById('dtd-svc-'+svcId+'-'+domId);
  if(di) di.textContent=v.toFixed(1);
  const badge=document.getElementById('dtbadge-svc-'+svcId+'-'+domId);
  const conf=distribTempConf(v,tempType);
  const icons={ok:'✅',nc:'❌',nd:'—'};
  if(badge){ badge.innerHTML=(icons[conf]||'—')+' '+v.toFixed(1)+'°C'; badge.className='distrib-temp-badge '+conf; }
  const sl=document.getElementById('dsvcs-'+svcId+'-'+domId);
  const mn=tempType==='froid'?-5:40, mx=tempType==='froid'?15:100;
  if(sl) sl.value=Math.max(mn,Math.min(mx,v));
}

// Enregistrer les sections par service dans REND dynamiquement
function registerDistribSvcPages(){
  getDistribServices().forEach(function(svc){
    var secId='enr_distrib_'+svc.id;
    // Capturer svc.id dans une closure propre
    (function(id){
      REND[secId]=function(){
        return renderENR_DISTRIB_SVC(id);
      };
    })(svc.id);
    if(!ALL.find(function(s){return s.id===secId;})){
      ALL.push({id:secId, short:(svc.ico||'🍽️')+' '+svc.label, label:(svc.ico||'🍽️')+' '+svc.label+' – T°C', cat:'prpo', tag:'PrPo', _hidden:true});
    }
  });
}

function renderENR_TC_DISTRIB(){
  const draft=distribDraft();
  const date=draft.date||today();
  const isToday=date===today();
  const dateF=new Date(date+'T12:00').toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'});
  const midiOk=draft.midi_valide==='OUI';
  const soirOk=draft.soir_valide==='OUI';
  return `
    <div class="card">
      <div class="card-title">🌡️ T°C Distribution
        <span class="tag prpo">PrPo</span>
      </div>
      <div class="regle">Froid ≤ +${DISTRIB_FROID_MAX}°C — Chaud ≥ +${DISTRIB_CHAUD_MIN}°C. Contrôle à chaque service (Midi &amp; Soir).</div>

      ${distribAlertBanner()}

      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:0">
          <div style="font-size:.66rem;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#b89ab6;margin-bottom:4px">Date</div>
          <button class="dp-trigger" id="dpf-date-distrib" onclick="openDP('${date}', (v)=>{distribSD('date',v);renderMain();},{max:'${today()}'})">
        <span class="dp-ico">📅</span>
        <span class="dp-val">${new Date(date+'T12:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'})}</span>
        <span style="font-size:.7rem;color:#c0a0c0">▼</span>
      </button>
        </div>
        ${(!midiOk||!soirOk)&&date!==today()?'':
          (midiOk&&soirOk?`<button class="btn btn-sec" style="padding:8px 12px;font-size:.8rem;align-self:flex-end" onclick="distribNouvelleJournee()">+ Nouvelle journée</button>`:'')
        }
      </div>

      <div class="distrib-services">
        ${distribServiceCard('midi')}
        ${distribServiceCard('soir')}
      </div>

      ${midiOk&&soirOk?`<div style="background:#f0fdf4;border:2px solid #4caf50;border-radius:12px;padding:12px 14px;text-align:center;font-size:.9rem;font-weight:800;color:#166534">
        ✅ Journée du ${escH(dateF)} complète — Enregistrée
        <button class="btn btn-sec" style="display:block;width:100%;margin-top:8px;font-size:.78rem" onclick="distribNouvelleJournee()">+ Saisir une autre journée</button>
      </div>`:''}
    </div>
    ${distribHistoCard()}`;
}

// ── Rappels de distribution ─────────────────────────────────────────────────
const _svcRappelSent = {}; // {svcId_'15'|'0': true} — évite les doublons

const RAPPEL_MSGS_15 = [
  "🚀 {label} dans 15 min — Préparez le thermomètre, on chauffe !",
  "⏰ {label} approche ! Plus que 15 min — Soyez prêts pour les T°C !",
  "🏁 Départ dans 15 min pour {label} — Les chariots n'attendent pas !",
  "🌡️ T°C de {label} dans 15 min — Tout le monde en position !",
  "💪 {label} dans un quart d'heure — Le service va être top !",
];
const RAPPEL_MSGS_0 = [
  "🔔 C'est l'heure ! Prenez les T°C de {label} maintenant !",
  "⚡ {label} — C'est parti ! N'oubliez pas le releve de temperature !",
  "🚀 {label} — Les chariots partent ! T°C a saisir maintenant !",
  "🌡️ Hop hop hop ! {label} a commence — T°C immediatement !",
];

function distribCheckReminders(){
  const now = new Date();
  const hNow = now.getHours();
  const mNow = now.getMinutes();
  const minNow = hNow*60+mNow;
  const draft = distribDraft();
  const isToday = (draft.date||today()) === today();
  const svcs = getDistribServices();

  let needsAlert = false;

  svcs.forEach(svc=>{
    // Helper : parser HH:MM → minutes depuis minuit
    function toMin(hhmm){ if(!hhmm||!hhmm.includes(':')) return null; const p=hhmm.split(':'); return parseInt(p[0])*60+parseInt(p[1]||0); }

    // Compat ascendante : si ancienne structure heure/deadline
    const mDeb = toMin(svc.midi_deb||svc.heure||'');
    const mFin = toMin(svc.midi_fin || (svc.deadline ? (typeof svc.deadline==='string'&&svc.deadline.includes(':')?svc.deadline:String(svc.deadline).padStart(2,'0')+':00') : null));
    const sDeb = toMin(svc.soir_deb||'');
    const sFin = toMin(svc.soir_fin||'');

    // Créneaux actifs pour ce service : tableau [{slot, deb, fin, doneKey}]
    const creneaux = [];
    if(mDeb !== null){ creneaux.push({slot:'midi', deb:mDeb, fin:mFin||mDeb+120, doneKey:svc.id+'_midi'}); }
    if(sDeb !== null){ creneaux.push({slot:'soir', deb:sDeb, fin:sFin||sDeb+120, doneKey:svc.id+'_soir'}); }

    // Pour les services à créneau unique (ancienne structure) : doneKey = svc.id
    if(creneaux.length===0 && (svc.heure||svc.midi_deb)){
      const deb = toMin(svc.heure||'12:00')||720;
      creneaux.push({slot:'midi', deb, fin:deb+120, doneKey:svc.id+'_midi'});
    }

    creneaux.forEach(cr=>{
      // Vérifier si ce slot est déjà validé
      // Pour les services individuels (enr_distrib_*), lire S['enr_distrib_'+svc.id]
      const k = 'enr_distrib_'+svc.id;
      const svcDraft = (S[k]&&S[k].draft)||draft;
      const slotDone = isToday && (svcDraft[cr.slot+'_valide']==='OUI' || draft[svc.id+'_valide']==='OUI');
      if(slotDone) return;

      // Retard : après fin du créneau sans validation
      if(minNow >= cr.fin) needsAlert = true;

      // Rappel 15 min avant début
      const diff15 = cr.deb - minNow;
      const key15 = svc.id+'_'+cr.slot+'_15';
      if(diff15 >= 13 && diff15 <= 16 && !_svcRappelSent[key15]){
        _svcRappelSent[key15] = true;
        const msg = RAPPEL_MSGS_15[Math.floor(Math.random()*RAPPEL_MSGS_15.length)]
          .replace('{label}', svc.label+' '+(cr.slot==='midi'?'Midi':'Soir'));
        showDistribAlerte(msg, svc.ico||'⏰', 'warning', 8000, svc.id);
      }

      // Rappels toutes les 10 min entre deb et fin
      const minsSince = minNow - cr.deb;
      if(minsSince >= 0 && minsSince <= (cr.fin-cr.deb)){
        const slot10 = Math.floor(minsSince/10);
        const key10 = svc.id+'_'+cr.slot+'_slot'+slot10;
        if(!_svcRappelSent[key10]){
          _svcRappelSent[key10] = true;
          let msg;
          const label = svc.label+' '+(cr.slot==='midi'?'Midi':'Soir');
          if(slot10 === 0){
            msg = RAPPEL_MSGS_0[Math.floor(Math.random()*RAPPEL_MSGS_0.length)].replace('{label}', label);
          } else {
            const retardMsgs = [
              '🚨 {label} — '+minsSince+' min de retard ! Les T°C ne sont toujours pas saisies !',
              '⚠️ Toujours pas de T°C pour {label} — '+minsSince+' min de retard !',
              '🔴 URGENT — {label} : '+minsSince+' minutes sans relevé de température !',
              '🌡️ '+minsSince+' min que le service est parti sans T°C ! Saisissez {label} maintenant !',
            ];
            msg = retardMsgs[Math.floor(Math.random()*retardMsgs.length)].replace(/{label}/g, label);
          }
          showDistribAlerte(msg, svc.ico||'🔔', slot10===0?'alerte':'urgent', slot10>=6?15000:10000, svc.id);
        }
      }

      // Reset à 5h du matin
      if(hNow < 5){
        Object.keys(_svcRappelSent).forEach(k=>{
          if(k.startsWith(svc.id+'_')) delete _svcRappelSent[k];
        });
      }
    });
  });

  // Badge nav
  // Badge sur tous les boutons de distribution (enr_tc_distrib + enr_distrib_*)
  const btns=[...document.querySelectorAll('[onclick*="enr_tc_distrib"],[onclick*="enr_distrib_"]')];
  btns.forEach(btn=>btn.classList.toggle('nb-alert', needsAlert&&isToday));
}

function showDistribAlerte(msg, ico, type, duration, svcId){
  // Créer une bannière distinctive au-dessus du toast standard
  const id = 'distrib-alerte-'+Date.now();
  const bg = type==='urgent' ? 'linear-gradient(135deg,#7f0000,#c62828)' : type==='alerte' ? 'linear-gradient(135deg,#c62828,#e53935)' : 'linear-gradient(135deg,#e65100,#f57c00)';
  const div = document.createElement('div');
  div.id = id;
  div.style.cssText = 'position:fixed;top:72px;left:10px;right:10px;z-index:9900;background:'+bg+';color:#fff;'
    +'border-radius:14px;padding:13px 16px;box-shadow:0 8px 30px rgba(0,0,0,.35);'
    +'display:flex;align-items:center;gap:12px;animation:slideDown .35s ease;cursor:pointer;';
  div.innerHTML = '<span style="font-size:1.6rem;flex-shrink:0">'+ico+'</span>'
    +'<div style="flex:1"><div style="font-size:.88rem;font-weight:900;line-height:1.3">'+msg+'</div>'
    +'<div style="font-size:.7rem;opacity:.8;margin-top:3px">Appuyez pour saisir les T°C</div></div>'
    +'<span style="font-size:.9rem;opacity:.7;flex-shrink:0">✕</span>';
  div.onclick = ()=>{
    document.body.removeChild(div);
    if(svcId) goTo('enr_distrib_'+svcId); else goTo('enr_tc_distrib');
  };
  document.body.appendChild(div);
  // CSS animation si pas déjà injectée
  if(!document.getElementById('distrib-alerte-css')){
    const s=document.createElement('style');s.id='distrib-alerte-css';
    s.textContent='@keyframes slideDown{from{transform:translateY(-80px);opacity:0}to{transform:translateY(0);opacity:1}}';
    document.head.appendChild(s);
  }
  setTimeout(()=>{ if(document.getElementById(id)) document.body.removeChild(div); }, duration||8000);
}

setInterval(distribCheckReminders, 60*1000); // check chaque minute

// Export Excel dédié pour ENR_TC_DISTRIB
function expDistrib(){
  if(typeof XLSX==='undefined'){toast('⚠️ SheetJS non chargé','warning');return;}
  const lignes=(S[DISTRIB_SEC]||{}).lignes||[];
  if(!lignes.length){toast('⚠️ Aucune donnée à exporter','warning');return;}
  const site=getSiteName();
  const mois=S.config?.mois||new Date().toISOString().slice(0,7);
  const wb=XLSX.utils.book_new();
  const headers=['Date','Midi – Plat froid','Midi – T°C froid','Midi – Froid conf.','Midi – Plat chaud','Midi – T°C chaud','Midi – Chaud conf.','Midi – Heure','Midi – Cuisinier','Soir – Plat froid','Soir – T°C froid','Soir – Froid conf.','Soir – Plat chaud','Soir – T°C chaud','Soir – Chaud conf.','Soir – Heure','Soir – Cuisinier'];
  const rows=lignes.map(r=>{
    const df=r.date?new Date(r.date+'T12:00').toLocaleDateString('fr-FR'):r.date||'';
    return[df,r.midi_froid_plat||'',r.midi_froid_temp||'',r.midi_froid_conf||'',r.midi_chaud_plat||'',r.midi_chaud_temp||'',r.midi_chaud_conf||'',r.midi_heure||'',r.midi_cuisinier||'',r.soir_froid_plat||'',r.soir_froid_temp||'',r.soir_froid_conf||'',r.soir_chaud_plat||'',r.soir_chaud_temp||'',r.soir_chaud_conf||'',r.soir_heure||'',r.soir_cuisinier||''];
  });
  const wsData=[
    [`T°C DISTRIBUTION – ${site}`,'',' ','','',' ',''],
    [`Période : ${mois}`,'Export le :',new Date().toLocaleString('fr-FR'),'','','',''],
    [],
    headers,...rows
  ];
  const ws=XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols']=[{wch:14},{wch:22},{wch:12},{wch:14},{wch:22},{wch:12},{wch:14},{wch:10},{wch:18},{wch:22},{wch:12},{wch:14},{wch:22},{wch:12},{wch:14},{wch:10},{wch:18}];
  XLSX.utils.book_append_sheet(wb,ws,'T°C Distribution');
  const filename=`HACCP_Distribution_${site.replace(/\s+/g,'_')}_${mois}.xlsx`;
  const wbout=XLSX.write(wb,{bookType:'xlsx',type:'array'});
  const blob=new Blob([wbout],{type:'application/octet-stream'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=filename;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  toast('📊 Export Distribution généré !');
}

// ════════════════════════════════════════════════════
// ════════════════════════════════════════════════════
// ════════════════════════════════════════════════════
// PHOTO ÉTIQUETTE — capture simple, stockage base64
// ════════════════════════════════════════════════════
let _photoPfx = 'p1';   // 'p1', 'p2', ou 'enr31'
let _photoB64 = null;   // base64 de la photo en cours

function openOcrModal(pfx) {
  _photoPfx = pfx || 'p1';
  _photoB64 = null;
  // Reset UI
  const img = document.getElementById('ocr-img');
  img.style.display = 'none';
  img.src = '';
  document.getElementById('ocr-placeholder').style.display = 'block';
  const btn = document.getElementById('ocr-apply-btn');
  btn.style.opacity = '.4'; btn.style.pointerEvents = 'none';
  document.getElementById('ocr-ov').classList.add('open');
  // PAS d'ouverture auto caméra → évite le toast fantôme "Aucune photo"
  // L'utilisateur appuie sur le bouton pour ouvrir la caméra
}
function closeOcrModal() {
  document.getElementById('ocr-ov').classList.remove('open');
  _photoB64 = null;
  const inp = document.getElementById('ocr-file-input');
  if(inp) inp.value = '';
  const btn = document.getElementById('ocr-apply-btn');
  if(btn){ btn.style.opacity='.4'; btn.style.pointerEvents='none'; }
  const img = document.getElementById('ocr-img');
  if(img){ img.style.display='none'; img.src=''; }
  const ph = document.getElementById('ocr-placeholder');
  if(ph) ph.textContent='📷 Appuyez sur "Ouvrir la caméra"';
}
function ocrTriggerCamera() {
  const inp = document.getElementById('ocr-file-input');
  inp.value = ''; inp.click();
}

function photoHandleFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    _photoB64 = e.target.result; // data:image/jpeg;base64,…
    const img = document.getElementById('ocr-img');
    img.src = _photoB64;
    img.style.display = 'block';
    document.getElementById('ocr-placeholder').style.display = 'none';
    const btn = document.getElementById('ocr-apply-btn');
    btn.style.opacity = '1'; btn.style.pointerEvents = 'auto';
    const info=document.getElementById('ocr-save-info');
    if(info) info.style.display='';
  };
  reader.readAsDataURL(file);
}

// ── Photos en attente (plein résolution, pas encore téléchargées) ──
// Clé : pfx ('p1','p2','enr31') → base64 pleine résolution
const _pendingPhotos = {};

function photoSave() {
  const _ocrOv = document.getElementById('ocr-ov');
  if(!_ocrOv || !_ocrOv.classList.contains('open')) return; // modal fermé → ignorer
  if (!_photoB64) { toast('⚠️ Appuyez d\'abord sur "Ouvrir la caméra"','warning'); return; }
  const pfx = _photoPfx;
  const img = document.getElementById('ocr-img');

  // ── 1. Garder la photo pleine résolution en mémoire (téléchargement différé) ──
  try {
    const c = document.createElement('canvas');
    const maxW=2000, maxH=1500;
    let w=img.naturalWidth||1200, h=img.naturalHeight||900;
    if(w>maxW){h=Math.round(h*maxW/w);w=maxW;}
    if(h>maxH){w=Math.round(w*maxH/h);h=maxH;}
    c.width=w; c.height=h;
    c.getContext('2d').drawImage(img,0,0,w,h);
    _pendingPhotos[pfx] = c.toDataURL('image/jpeg', 0.88);
  } catch(e){ _pendingPhotos[pfx] = _photoB64; }

  // ── 2. Miniature légère → stockage localStorage (~3-8 Ko) ──────────────────
  let thumbData = '';
  try {
    if(img && img.naturalWidth > 0){
      const c = document.createElement('canvas');
      const maxW=200;
      let w=img.naturalWidth, h=img.naturalHeight;
      if(w>maxW){h=Math.round(h*maxW/w);w=maxW;}
      c.width=w; c.height=h;
      c.getContext('2d').drawImage(img,0,0,w,h);
      thumbData = c.toDataURL('image/jpeg', 0.55);
    }
  } catch(e){ thumbData = ''; }

  // ── 3. Stocker la miniature dans le draft (pas la pleine résolution) ────────
  try {
    const photoRef = JSON.stringify({ thumb: thumbData, file: '', date: today() });
    if (pfx === 'enr31') {
      sd('photo', photoRef, 'enr31');
    } else if (pfx === 'enr31_2') {
      sd('photo2', photoRef, 'enr31');
    } else if (pfx === 'enr31_3') {
      sd('photo3', photoRef, 'enr31');
    } else if (pfx === 'nc30') {
      // Photo de non-conformité ENR30
      nc30('photo_nc', photoRef);
    } else {
      r23s(pfx+'_photo', photoRef);
    }
    _photoB64 = null;
    closeOcrModal();
    renderMain();
    toast('📷 Photo prête — sera nommée à l\'enregistrement ✓', 'success');
  } catch(e) {
    toast('⚠️ Stockage plein — supprimez d\'anciennes fiches','warning');
  }
}

// ── Télécharger une photo en attente avec le bon nom ─────────────────────────
function _downloadPendingPhoto(pfx, produit, fournisseur, dateStr){
  const fullJpeg = _pendingPhotos[pfx];
  if(!fullJpeg) return ''; // pas de photo en attente pour ce pfx
  const d = dateStr || today();
  const df = d.slice(8,10)+'-'+d.slice(5,7)+'-'+d.slice(0,4);
  const clean = s => (s||'').replace(/[^a-zA-Z0-9À-ž]/g,'_').slice(0,22);
  let fname;
  if(pfx==='enr31'){
    fname = 'HACCP_Tracabilite_'+df+'_'+clean(produit)+'.jpg';
  } else {
    const num = pfx==='p1'?'P1':'P2';
    const prod = produit ? '_'+clean(produit) : '';
    fname = 'HACCP_Reception_'+df+'_'+clean(fournisseur)+prod+'_'+num+'.jpg';
  }
  try {
    const a = document.createElement('a');
    a.href = fullJpeg;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    delete _pendingPhotos[pfx];
    return fname;
  } catch(e){ return ''; }
}

// ── Mettre à jour le nom de fichier dans une photoRef stockée ────────────────
function _photoUpdateFilename(stored, fname){
  if(!stored || !fname) return stored;
  try {
    const obj = stored.startsWith('{') ? JSON.parse(stored) : { thumb: stored, date: today() };
    obj.file = fname;
    return JSON.stringify(obj);
  } catch{ return stored; }
}

// Lire une photo stockée (miniature ou base64 legacy)
function _photoGetThumb(stored){
  if(!stored) return '';
  if(stored.startsWith('{')){ try{ return JSON.parse(stored).thumb||''; }catch{return '';} }
  return stored; // legacy base64 plein
}
function _photoGetFile(stored){
  if(!stored) return '';
  if(stored.startsWith('{')){ try{ return JSON.parse(stored).file||''; }catch{return '';} }
  return ''; // legacy sans nom
}

// Mini-vignette photo pour afficher dans les fiches
function photoThumb(stored, label) {
  if (!stored) return '';
  const thumb = _photoGetThumb(stored);
  const fname = _photoGetFile(stored);
  if(!thumb) return '';
  const finfo = fname
    ? '<div style="font-size:.62rem;color:#b89ab6;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📁 '+escH(fname)+'</div>'
    : '';
  return `<div style="margin:8px 0">
    <div style="font-size:.68rem;font-weight:700;color:#b89ab6;margin-bottom:4px">${label||'📷 Photo étiquette'}</div>
    <img src="${thumb}" style="max-width:100%;max-height:140px;border-radius:8px;border:1.5px solid #e0d0e0;cursor:pointer;object-fit:contain"
      onclick="photoFullscreen(this.src)" title="Agrandir — photo pleine taille dans Téléchargements">
    ${finfo}
  </div>`;
}

function photoFullscreen(src) {
  // src peut être un thumb ou un stored JSON — on prend le thumb
  const realSrc = src.startsWith('{') ? _photoGetThumb(src) : src;
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;cursor:pointer';
  ov.onclick = () => document.body.removeChild(ov);
  const img = document.createElement('img');
  img.src = realSrc;
  img.style.cssText = 'max-width:100%;max-height:80vh;border-radius:12px;object-fit:contain';
  ov.appendChild(img);
  const close = document.createElement('div');
  close.style.cssText = 'position:absolute;top:16px;right:16px;color:#fff;font-size:2rem;cursor:pointer;line-height:1';
  close.textContent = '✕';
  ov.appendChild(close);
  document.body.appendChild(ov);
}

// ENR23 — Contrôle réception (2 produits par livraison)
// ════════════════════════════════════════════════════
const ENR23_SEC = 'enr23';
function r23d(id){ return ((S[ENR23_SEC]||{}).draft||{})[id]; }
function r23s(id,val){ S[ENR23_SEC]=S[ENR23_SEC]||{}; S[ENR23_SEC].draft=S[ENR23_SEC].draft||{}; S[ENR23_SEC].draft[id]=val; save(); }

function r23ConfGlobal(){
  const d=(S[ENR23_SEC]||{}).draft||{};
  const vehiculeOk=d.vehicule==='OUI';
  // Vérif T°C selon type (frais/surgelé)
  const p1TcOk=!d.p1_tc||(d.p1_surge==='1'?parseFloat(d.p1_tc)<=-15:parseFloat(d.p1_tc)<=6);
  const p2TcOk=!d.p2_tc||(d.p2_surge==='1'?parseFloat(d.p2_tc)<=-15:parseFloat(d.p2_tc)<=6);
  const p1Ok=d.p1_emballage==='OUI'&&d.p1_etiquetage==='OUI'&&d.p1_qualite==='OUI'&&p1TcOk;
  const p2Ok=!d.p2_produit||(d.p2_emballage==='OUI'&&d.p2_etiquetage==='OUI'&&d.p2_qualite==='OUI'&&p2TcOk);
  return vehiculeOk&&p1Ok&&p2Ok;
}

function r23ToggleSurge(pfx, el){
  const current=r23d(pfx+'_surge')==='1';
  const newVal=current?'0':'1';
  r23s(pfx+'_surge', newVal);
  // Reset T°C pour ce produit
  r23s(pfx+'_tc','');
  // Re-render juste ce bloc
  const wrap=document.getElementById('r23wrap-'+pfx);
  if(wrap){
    const num=pfx==='p1'?1:2;
    wrap.outerHTML=r23ProdBlock(pfx,num);
  }
  r23UpdateConfBanner();
}

// ── Sélecteur fournisseur ENR23 ──────────────────────
function r23FourcPickerHtml(){
  const d=(S[ENR23_SEC]||{}).draft||{};
  const nomActuel=d._fourc_nom||'';
  const blActuel=d._fourc_bl||'';
  const todayFourc=fourcTodayDeliveries();
  const todayNoms=todayFourc.map(f=>f.nom);
  const allFourc=getFournisseurs();
  const autresFourc=allFourc.filter(f=>!todayNoms.includes(f.nom));
  const libreMode=d._fourc_libre==='1';

  // Chips aujourd'hui
  const todayChips=todayFourc.map(f=>{
    const done=fourcAlreadyDone(f.nom);
    const sel=nomActuel===f.nom&&!libreMode;
    return `<button class="r23-fourc-chip today${done?' done':''}${sel?' selected':''}"
      onclick="r23FourcSelect('${escH(f.nom)}')">${escH(f.nom)}</button>`;
  }).join('');

  // Chips autres
  const autresChips=autresFourc.map(f=>{
    const sel=nomActuel===f.nom&&!libreMode;
    return `<button class="r23-fourc-chip${sel?' selected':''}"
      onclick="r23FourcSelect('${escH(f.nom)}')">${escH(f.nom)}</button>`;
  }).join('');

  const showToday=todayFourc.length>0;
  const showAutres=autresFourc.length>0;

  // Partie haute : chips
  let html=`<div class="r23-fourc-picker">`;
  if(showToday) html+=`<div>
    <div class="r23-fourc-section-lbl">📅 Prévus aujourd'hui</div>
    <div class="r23-fourc-chips">${todayChips}</div>
  </div>`;
  if(showAutres) html+=`<div>
    ${showToday?'<div class="r23-fourc-section-lbl" style="margin-top:4px">Autres fournisseurs</div>':''}
    <div class="r23-fourc-chips">${autresChips}</div>
  </div>`;
  // Bouton saisie libre + nouveau fournisseur
  html+=`<div class="r23-fourc-libre">
    <button class="r23-fourc-libre-btn" onclick="r23FourcLibre()">✏️ Saisie libre</button>
    <button class="r23-fourc-libre-btn" onclick="r23FourcAddNew()">＋ Nouveau</button>
  </div>`;
  html+=`</div>`;

  // Partie basse : champ BL si fournisseur sélectionné (mode chips)
  if(nomActuel&&!libreMode){
    html+=`<div class="r23-bl-wrap">
      <span class="r23-bl-nom">${escH(nomActuel)}</span>
      <span class="r23-bl-sep">— BL</span>
      <input class="r23-bl-input" type="text" id="r23-bl-input"
        value="${escH(blActuel)}" placeholder="N° de bon de livraison..."
        oninput="r23FourcBL(this.value)" onfocus="this.select()">
      <button class="r23-bl-clear" onclick="r23FourcReset()" title="Changer de fournisseur">✕</button>
    </div>`;
  }
  // Saisie libre
  if(libreMode){
    const libreVal=d.fournisseur||'';
    html+=`<div class="r23-bl-wrap" style="background:#f8f4f8;border-color:#d0b0d0">
      <input class="r23-bl-input" type="text" id="r23-fourc-libre-input"
        value="${escH(libreVal)}" placeholder="Fournisseur + N° BL..."
        oninput="r23FourcLibreVal(this.value)" onfocus="this.select()" autofocus>
      <button class="r23-bl-clear" onclick="r23FourcReset()">✕</button>
    </div>`;
  }
  return html;
}

function r23FourcSelect(nom){
  r23s('_fourc_nom', nom);
  r23s('_fourc_libre','0');
  // Recombiner immédiatement (sans BL pour l'instant)
  const bl=(S[ENR23_SEC]?.draft||{})._fourc_bl||'';
  r23s('fournisseur', bl ? nom+' — BL '+bl : nom);
  r23FourcRefresh();
}

function r23FourcBL(val){
  r23s('_fourc_bl', val);
  const nom=(S[ENR23_SEC]?.draft||{})._fourc_nom||'';
  r23s('fournisseur', val.trim() ? nom+' — BL '+val.trim() : nom);
}

function r23FourcLibre(){
  r23s('_fourc_libre','1');
  r23s('_fourc_nom','');
  r23FourcRefresh();
  setTimeout(()=>document.getElementById('r23-fourc-libre-input')?.focus(),50);
}

function r23FourcLibreVal(val){
  r23s('fournisseur', val);
}

function r23FourcReset(){
  r23s('_fourc_nom','');
  r23s('_fourc_bl','');
  r23s('_fourc_libre','0');
  r23s('fournisseur','');
  r23FourcRefresh();
}

function r23FourcRefresh(){
  const wrap=document.getElementById('r23-fourc-picker-wrap');
  if(wrap) wrap.innerHTML=r23FourcPickerHtml();
}

function r23FourcPicker(){
  // Initialiser les champs _fourc depuis fournisseur existant si nécessaire
  const d=(S[ENR23_SEC]||{}).draft||{};
  if(d.fournisseur&&!d._fourc_nom&&!d._fourc_libre){
    // Draft existant sans état picker → mode libre
    r23s('_fourc_libre','1');
  }
  return `<div id="r23-fourc-picker-wrap">${r23FourcPickerHtml()}</div>`;
}

function r23FourcAddNew(){
  showPrompt('Nouveau fournisseur','','Ex: Grossiste Martin...', nom=>{
    if(!nom) return;
    const id='f_'+Date.now();
    S.fournisseurs=S.fournisseurs||[];
    S.fournisseurs.push({id, nom:nom.trim(), jours:[], notes:''});
    save();
    r23FourcSelect(nom.trim());
  },'Ajouter');
}
// ──────────────────────────────────────────────────────

function r23ConfBtn(id, label, extraCls){
  const val=r23d(id)||'';
  const yes=val==='OUI', no=val==='NON';
  return `<div class="fg${extraCls?' '+extraCls:''}" style="position:relative;z-index:5">
    <label>${label}</label>
    <div class="r23-conf-wrap" id="r23cb-${id}">
      <button class="r23-btn${yes?' r23-oui-on':''}" onclick="r23SetConf2('${id}','OUI')">✓ OUI</button>
      <button class="r23-btn${no?' r23-non-on':''}" onclick="r23SetConf2('${id}','NON')">✗ NON</button>
    </div>
  </div>`;
}

function r23SetConf2(id, val){
  // Toggle : re-cliquer sur la valeur déjà active la désélectionne
  const current = r23d(id)||'';
  const newVal = current === val ? '' : val;
  r23s(id, newVal);
  const wrap = document.getElementById('r23cb-'+id);
  if(!wrap) return;
  wrap.querySelectorAll('.r23-btn').forEach(b=>{
    const isOui = b.textContent.includes('OUI');
    const isNon = b.textContent.includes('NON');
    if(isOui) b.className = 'r23-btn' + (newVal==='OUI' ? ' r23-oui-on' : '');
    if(isNon) b.className = 'r23-btn' + (newVal==='NON' ? ' r23-non-on' : '');
  });
  r23UpdateConfBanner();
}
function r23SetConf(id, val, btn){
  r23s(id, val);
  // Chercher le wrapper par id direct (plus robuste que closest sur Android)
  const wrap = document.getElementById('r23cb-'+id) || btn.closest('.r23-conf-wrap');
  if(!wrap) return;
  const btns = wrap.querySelectorAll('.r23-btn');
  if(btns.length >= 2){
    btns[0].className = 'r23-btn' + (val==='OUI' ? ' r23-oui-on' : '');
    btns[1].className = 'r23-btn' + (val==='NON' ? ' r23-non-on' : '');
  }
  r23UpdateConfBanner();
}

function r23UpdateConfBanner(){
  const banner = document.getElementById('r23-conf-banner');
  if(!banner) return;
  const ok = r23ConfGlobal();
  banner.style.background = ok ? '#f0fdf4' : '#fff5f5';
  banner.style.color = ok ? '#166534' : '#991b1b';
  banner.textContent = ok ? '✅ Réception conforme' : '❌ Réception non conforme — vérifiez les champs';
}

function r23TempWidget(pfx){
  const id=pfx+'_tc';
  const surge=r23d(pfx+'_surge')==='1';
  const val=r23d(id);
  const numV=(val!==undefined&&val!==''&&!isNaN(parseFloat(val)))?parseFloat(val):null;
  const slMin=surge?-40:-10, slMax=surge?5:20;
  const slV=numV!==null?Math.max(slMin,Math.min(slMax,numV)):(surge?-18:3);
  const confStr=numV!==null?(surge?(numV<=-15?'ok':'nc'):(numV<=6?'ok':'nc')):null;
  const disp=numV!==null?numV.toFixed(1):'';
  const consigne=surge?'Consigne ≤ -18°C (surgélation)':'Consigne ≤ +3°C (tol. +6°C)';
  const badgeCls='distrib-temp-badge '+(confStr||'nd');
  const badgeTxt=(confStr==='ok'?'✅ ':confStr==='nc'?'❌ ':''  )+(disp?disp+'°C':'—');
  const sliderCls='distrib-temp-slider'+(surge?'':' froid');
  const colorConsigne=surge?'#1d4ed8':'#b89ab6';
  const h=[];
  h.push('<div class="fg full">');
  h.push('<label>T°C produit</label>');
  h.push('<div style="display:flex;align-items:center;gap:8px;flex-wrap:nowrap;overflow:hidden">');
  h.push('<span class="'+badgeCls+'" style="width:72px;min-width:72px;flex-shrink:0;white-space:nowrap;font-size:.82rem" id="r23badge-'+pfx+'">'+badgeTxt+'</span>');
  const inp1a='<input type="range" class="'+sliderCls+'" style="flex:1;min-width:60px"';
  const inp1b=' min="'+slMin+'" max="'+slMax+'" step="0.1" value="'+slV+'" id="r23sl-'+pfx+'"';
  const inp1c=' oninput="r23s(this.dataset.id,this.value);r23UpdateTemp(this.dataset.pfx,this.value)"';
  const inp1d=' onchange="r23s(this.dataset.id,this.value);r23UpdateTemp(this.dataset.pfx,this.value)"';
  const inp1e=' data-id="'+id+'" data-pfx="'+pfx+'">';
  h.push(inp1a+inp1b+inp1c+inp1d+inp1e);
  h.push('<div class="qt-fake-inp distrib-temp-direct" style="flex-shrink:0" id="r23di-'+pfx+'" data-qt="r" data-qs="'+pfx+'" data-qn="'+slMin+'" data-qx="'+slMax+'" onclick="qtTap(this)">'+disp+'</div>');
  h.push('</div>');
  h.push('<div style="font-size:.68rem;color:'+colorConsigne+';font-weight:700;margin-top:2px">'+consigne+'</div>');
  h.push('</div>');
  return h.join('');
}

function r23UpdateTemp(pfx, val){
  const v=parseFloat(val); if(isNaN(v)) return;
  const di=document.getElementById('r23di-'+pfx);
  if(di) di.textContent=v.toFixed(1);
  const surge=r23d(pfx+'_surge')==='1';
  const conf=surge?(v<=-15?'ok':'nc'):(v<=6?'ok':'nc');
  const badge=document.getElementById('r23badge-'+pfx);
  if(badge){
    badge.className='distrib-temp-badge '+conf;
    badge.textContent=(conf==='ok'?'✅ ':'❌ ')+v.toFixed(1)+'°C';
  }
  r23UpdateConfBanner();
}
function r23DirectTemp(pfx, val){
  const v=parseFloat(val); if(isNaN(v)) return;
  r23s(`${pfx}_tc`,String(v));
  const sl=document.getElementById(`r23sl-${pfx}`);
  if(sl) sl.value=Math.max(-10,Math.min(20,v));
  r23UpdateTemp(pfx, v);
}

function r23ProdBlock(pfx, num){
  const d=(S[ENR23_SEC]||{}).draft||{};
  const required=num===1;
  const hasData=d[`${pfx}_produit`]||d[`${pfx}_lot`]||d[`${pfx}_dlc`];
  const surge=d[pfx+'_surge']==='1';
  return `<div id="r23wrap-${pfx}" style="background:var(--fond);border:1.5px solid ${hasData?'var(--plum)':'var(--brd)'};border-radius:12px;padding:13px;margin-bottom:8px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span style="font-size:.78rem;font-weight:900;color:var(--plum);flex:1">
        📦 Produit ${num}${required?'':' <span style="font-size:.65rem;font-weight:600;color:#b89ab6">(optionnel)</span>'}
      </span>
      <button class="photo-btn" style="width:auto;padding:7px 13px;margin:0;font-size:.75rem"
        onclick="openOcrModal('${pfx}')">
        ${d[pfx+'_photo']?'📷 Changer photo':'📷 Photo étiquette'}
      </button>
    </div>
    ${d[pfx+'_photo']?photoThumb(d[pfx+'_photo'],'📷 Étiquette produit '+num):''}
    <div class="surge-toggle${surge?' on':''}" onclick="r23ToggleSurge('${pfx}',this)">
      <span style="font-size:1rem">${surge?'❄️':'🌡️'}</span>
      <span class="surge-toggle-lbl">${surge?'Surgelé — consigne ≤ -18°C':'Frais/réfrigéré — consigne ≤ +3°C'}</span>
      <span style="margin-left:auto;font-size:.7rem;color:#b89ab6">Changer</span>
    </div>
    <div class="fgrid">
      <div class="fg full">
        <label>Nom du produit</label>
        <div class="mic-wrap">
          <input class="fi" id="r23-prod-inp-${pfx}" type="text" value="${escH(d[pfx+'_produit']||'')}" placeholder="Ex: Saumon fumé..." maxlength="80"
            oninput="r23s('${pfx}_produit',this.value)">
          <button type="button" class="mic-btn" title="Dicter" onclick="startMicField('r23-prod-inp-${pfx}',v=>r23s('${pfx}_produit',v))">🎤</button>
        </div>
      </div>
      <div class="fg">
        <label>N° de lot</label>
        <input class="fi" type="text" value="${escH(d[pfx+'_lot']||'')}" placeholder="N° lot..."
          oninput="r23s('${pfx}_lot',this.value)">
      </div>
      <div class="fg">
        <label>DLC / DDM</label>
        <button class="dp-trigger" id="dpf-dlc-${pfx}" onclick="openDP('${d[pfx+'_dlc']||''}', (v)=>{r23s('${pfx}_dlc',v);const el=document.getElementById('dpf-dlc-${pfx}');if(el){el.querySelector('.dp-val').textContent=new Date(v+'T12:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'});el.querySelector('.dp-val').classList.remove('empty');}},{})">
          <span class="dp-ico">📅</span>
          <span class="dp-val${!d[pfx+'_dlc']?' empty':''}">${d[pfx+'_dlc']?new Date(d[pfx+'_dlc']+'T12:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'}):'DLC / DDM'}</span>
          <span style="font-size:.7rem;color:#c0a0c0">▼</span>
        </button>
      </div>
      ${r23TempWidget(pfx)}
      ${r23ConfBtn(`${pfx}_emballage`,'Emballage intact ?')}
      ${r23ConfBtn(`${pfx}_etiquetage`,'Étiquetage OK ?')}
      ${r23ConfBtn(`${pfx}_qualite`,'Qualité / aspect OK ?')}
    </div>
  </div>`;
}

function r23Save(){
  const d=(S[ENR23_SEC]||{}).draft||{};
  if(!d.fournisseur?.trim()){ toast('⚠️ Saisissez le fournisseur','warning'); return; }
  if(!d.p1_produit?.trim()){ toast('⚠️ Saisissez au moins le produit 1','warning'); return; }
  const confGlobal=r23ConfGlobal();
  const now=new Date();
  const row={
    _ts:now.toISOString(), _sec:ENR23_SEC,
    date:d.date||today(), fournisseur:d.fournisseur||'',
    vehicule:d.vehicule||'',
    // Produit 1
    p1_produit:d.p1_produit||'', p1_lot:d.p1_lot||'', p1_dlc:d.p1_dlc||'',
    p1_tc:d.p1_tc||'', p1_surge:d.p1_surge||'0',
    p1_emballage:d.p1_emballage||'',
    p1_etiquetage:d.p1_etiquetage||'', p1_qualite:d.p1_qualite||'',
    p1_photo:d.p1_photo||'',
    // Produit 2
    p2_produit:d.p2_produit||'', p2_lot:d.p2_lot||'', p2_dlc:d.p2_dlc||'',
    p2_tc:d.p2_tc||'', p2_surge:d.p2_surge||'0',
    p2_emballage:d.p2_emballage||'',
    p2_etiquetage:d.p2_etiquetage||'', p2_qualite:d.p2_qualite||'',
    p2_photo:d.p2_photo||'',
    conforme:confGlobal?'OUI':'NON',
    cuisinier:d.cuisinier||getActiveSession()||'',
  };
  // ── Supabase sync AVANT download (pour que _pendingPhotos soit encore disponible) ──
  S[ENR23_SEC]=S[ENR23_SEC]||{};
  S[ENR23_SEC].lignes=S[ENR23_SEC].lignes||[];
  S[ENR23_SEC].lignes.unshift(stampEntry(row));
  S[ENR23_SEC].draft={};
  save(); autoBackup();
  try { SupaEngine.enqueue(ENR23_SEC, row); } catch(e){}
  // ── Télécharger les photos avec le bon nom (après enqueue qui lit _pendingPhotos) ──
  const dateRec = row.date || today();
  if(_pendingPhotos['p1']){
    const fname = _downloadPendingPhoto('p1', row.p1_produit, row.fournisseur, dateRec);
    if(fname) S[ENR23_SEC].lignes[0].p1_photo = _photoUpdateFilename(S[ENR23_SEC].lignes[0].p1_photo||row.p1_photo, fname);
  }
  if(_pendingPhotos['p2']){
    const fname = _downloadPendingPhoto('p2', row.p2_produit, row.fournisseur, dateRec);
    if(fname) S[ENR23_SEC].lignes[0].p2_photo = _photoUpdateFilename(S[ENR23_SEC].lignes[0].p2_photo||row.p2_photo, fname);
  }
  if(!confGlobal) toast('⚠️ Réception NON CONFORME — Vérifiez les produits','warning');
  else autoBackup();
  toast('✅ Réception enregistrée !');
  renderMain();
}

function r23HistoCard(){
  const lignes=(S[ENR23_SEC]||{}).lignes||[];
  if(!lignes.length) return `<div class="card"><div class="empty-s">Aucune réception enregistrée.</div></div>`;
  const rows=lignes.map((r,i)=>{
    const dateF=r.date?new Date(r.date+'T12:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'}):'—';
    const conf=r.conforme==='OUI';
    const p1T=r.p1_tc?parseFloat(r.p1_tc).toFixed(1)+'°C':'—';
    const p2T=r.p2_tc?parseFloat(r.p2_tc).toFixed(1)+'°C':'—';
    return `<div class="hr-card">
      <div class="hr-card-top" onclick="toggleHR(this)">
        <div style="flex:1;min-width:0">
          <div class="hr-card-main">📦 ${escH(r.fournisseur||'—')}</div>
          <div class="hr-card-meta">${dateF} · ${r.cuisinier||''}</div>
          <div style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap">
            <span class="bo ${conf?'oui':'non'}">${conf?'✓ Conforme':'✗ Non conforme'}</span>
            ${r.vehicule==='OUI'?'<span class="bo oui" style="font-size:.6rem">🚚 Véhicule OK</span>':r.vehicule==='NON'?'<span class="bo non" style="font-size:.6rem">🚚 Véhicule ✗</span>':''}
          </div>
        </div>
        <div style="display:flex;gap:4px;align-items:flex-start">

          <span class="hr-expand">▼</span>
        </div>
      </div>
      <div class="hr-card-data">
        <div class="hr-data-grid">
          <div class="hdi"><div class="hdi-label">Produit 1</div><div class="hdi-val">${escH(r.p1_produit||'—')}</div></div>
          <div class="hdi"><div class="hdi-label">T°C prod. 1</div><div class="hdi-val ${r.p1_tc&&(r.p1_surge==='1'?parseFloat(r.p1_tc)<=-15:parseFloat(r.p1_tc)<=6)?'conf-oui':'conf-non'}">${r.p1_surge==='1'?'❄️ ':''}${p1T}</div></div>
          <div class="hdi"><div class="hdi-label">DLC prod. 1</div><div class="hdi-val">${r.p1_dlc||'—'}</div></div>
          <div class="hdi"><div class="hdi-label">Lot prod. 1</div><div class="hdi-val">${r.p1_lot||'—'}</div></div>
          ${r.p1_photo?`<div class="hdi" style="grid-column:1/-1">${photoThumb(r.p1_photo,'📷 Étiquette produit 1')}</div>`:''}
          ${r.p2_produit?`
          <div class="hdi"><div class="hdi-label">Produit 2</div><div class="hdi-val">${escH(r.p2_produit)}</div></div>
          <div class="hdi"><div class="hdi-label">T°C prod. 2</div><div class="hdi-val ${r.p2_tc&&parseFloat(r.p2_tc)<=6?'conf-oui':'conf-non'}">${p2T}</div></div>
          <div class="hdi"><div class="hdi-label">DLC prod. 2</div><div class="hdi-val">${r.p2_dlc||'—'}</div></div>
          <div class="hdi"><div class="hdi-label">Lot prod. 2</div><div class="hdi-val">${r.p2_lot||'—'}</div></div>
          ${r.p2_photo?`<div class="hdi" style="grid-column:1/-1">${photoThumb(r.p2_photo,'📷 Étiquette produit 2')}</div>`:''}`:''}
          <div class="hdi"><div class="hdi-label">Propreté véhicule</div><div class="hdi-val ${r.vehicule==='OUI'?'conf-oui':r.vehicule==='NON'?'conf-non':''}">${r.vehicule||'—'}</div></div>
        </div>
      </div>
    </div>`;
  }).join('');
  return `<div class="card">
    <div class="hh"><span class="hh-title">📜 Historique des réceptions</span>
    <span class="hh-badge">${lignes.length} réception${lignes.length>1?'s':''}</span></div>
    ${rows}
  </div>`;
}


// ════════════════════════════════════════════════════
// CALENDRIER FOURNISSEURS
// ════════════════════════════════════════════════════
const FOURC_JOURS = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];

function getFournisseurs(){ return S.fournisseurs || []; }

function fourcTodayDeliveries(){
  // Jour de semaine : 0=Dim->6=Sam  →  adapter en Lun=0..Dim=6
  const dow = (new Date().getDay()+6)%7; // 0=Lun..6=Dim
  const today = FOURC_JOURS[dow];
  return getFournisseurs().filter(f=>(f.jours||[]).includes(today));
}

function fourcAlreadyDone(nom){
  const todayStr = today();
  return (S['enr23']?.lignes||[]).some(r=>
    r.date===todayStr && r.fournisseur && r.fournisseur.toLowerCase().includes(nom.toLowerCase())
  );
}

function fourcAddFournisseur(){
  nettAdminGuard(()=>{
    showPrompt('Ajouter un fournisseur','','Ex: Terre Azur, Metro, Brake...', nom=>{
      if(!nom) return;
      const id='f_'+Date.now();
      S.fournisseurs=S.fournisseurs||[];
      S.fournisseurs.push({id, nom:nom.trim(), jours:[], notes:''});
      save(); renderMain(); _saveConfigToSupabase();
      toast('✅ Fournisseur "'+nom+'" ajouté','success');
    },'Ajouter');
  });
}

function fourcDelFournisseur(id){
  nettAdminGuard(()=>{
    const f=(S.fournisseurs||[]).find(f=>f.id===id);
    showConfirm('Supprimer le fournisseur', f?'"'+f.nom+'"':'',' 🗑 Supprimer',()=>{
      S.fournisseurs=(S.fournisseurs||[]).filter(f=>f.id!==id);
      save(); renderMain(); _saveConfigToSupabase();
      toast('Fournisseur supprimé','success');
    });
  });
}

function fourcToggleJour(fid, jour){
  const f=(S.fournisseurs||[]).find(f=>f.id===fid); if(!f) return;
  f.jours=f.jours||[];
  if(f.jours.includes(jour)) f.jours=f.jours.filter(j=>j!==jour);
  else f.jours.push(jour);
  save(); _saveConfigToSupabase();
  const btn=document.getElementById('fjb-'+fid+'-'+jour);
  if(btn) btn.className='fourc-day'+(f.jours.includes(jour)?' on':'');
}

function fourcUpdateNotes(fid, val){
  const f=(S.fournisseurs||[]).find(f=>f.id===fid); if(!f) return;
  f.notes=val; save(); _saveConfigToSupabase();
}

function renderFourcCalendar(){
  const list=getFournisseurs();
  return `<div class="card">
    <div class="card-title">📅 Calendrier fournisseurs</div>
    <div class="regle">Planifiez les jours de livraison par fournisseur. Un rappel apparaîtra sur l'accueil si la réception n'est pas faite.</div>
    <div style="margin-bottom:10px">
      <button class="btn btn-sec" onclick="fourcAddFournisseur()">+ Ajouter un fournisseur</button>
    </div>
    ${list.length===0
      ? '<div class="empty-s">Aucun fournisseur configuré.<br><small>Appuyez sur "+ Ajouter" pour commencer.</small></div>'
      : list.map(f=>`<div class="fourc-card">
          <div style="display:flex;align-items:center;gap:8px">
            <span class="fourc-name">🚚 ${escH(f.nom)}</span>
            <button class="del" style="margin-left:auto" onclick="fourcDelFournisseur('${f.id}')">🗑</button>
          </div>
          <div style="font-size:.7rem;color:#b89ab6;font-weight:700;margin:6px 0 4px;text-transform:uppercase">Jours de livraison</div>
          <div class="fourc-days">
            ${FOURC_JOURS.map(j=>`<button class="fourc-day${(f.jours||[]).includes(j)?' on':''}" id="fjb-${f.id}-${j}"
              onclick="fourcToggleJour('${f.id}','${j}')">${j}</button>`).join('')}
          </div>
          <div style="margin-top:8px">
            <input class="fi" type="text" placeholder="Notes (horaire, contact...)"
              value="${escH(f.notes||'')}" style="font-size:.78rem"
              oninput="fourcUpdateNotes('${f.id}',this.value)">
          </div>
        </div>`).join('')}
  </div>`;
}





function renderENR23(){
  const d=(S[ENR23_SEC]||{}).draft||{};
  if(!d.date) r23s('date',today());
  const confGlobal=r23ConfGlobal();
  return `<div class="card">
    <div class="card-title">📦 Contrôle à réception <span class="tag prpo">PrPo</span></div>
    <div class="regle">Au moins <strong>2 produits par livraison.</strong> T°C ≤ +3°C (tolérance +6°C). NC → fiche Non-conformité.</div>

    <div class="fg-label">Nouvelle réception</div>

    <div class="fgrid" style="margin-bottom:10px">
      <div class="fg">
        <label>Date</label>
        <button class="dp-trigger" id="dpf-date-enr23" onclick="openDP('${d.date||today()}', (v)=>{r23s('date',v);const el=document.getElementById('dpf-date-enr23');if(el){el.querySelector('.dp-val').textContent=new Date(v+'T12:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'});el.querySelector('.dp-val').classList.remove('empty');}},{max:'${today()}'})">
          <span class="dp-ico">📅</span>
          <span class="dp-val">${new Date((d.date||today())+'T12:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'})}</span>
          <span style="font-size:.7rem;color:#c0a0c0">▼</span>
        </button>
      </div>
      <div class="fg full">
        <label>Fournisseur + N° BL</label>
        ${r23FourcPicker()}
      </div>
      ${r23ConfBtn('vehicule','🚚 Propreté du véhicule ?','full')}
    </div>

    ${r23ProdBlock('p1',1)}
    ${r23ProdBlock('p2',2)}

    <div class="fgrid" style="margin-top:4px">
      ${chefSel('cuisinier',ENR23_SEC,'Cuisinier / Visa')}
    </div>

    <div id="r23-conf-banner" style="background:${confGlobal?'#f0fdf4':'#fff5f5'};border-radius:10px;padding:10px 13px;margin:10px 0;font-size:.82rem;font-weight:800;color:${confGlobal?'#166534':'#991b1b'}">
      ${confGlobal?'✅ Réception conforme':'❌ Réception non conforme — vérifiez les champs'}
    </div>

    <div class="btn-row">
      <button class="btn-save" onclick="r23Save()">✅ Enregistrer la réception</button>
      <button class="btn btn-sec" onclick="S['enr23'].draft={};save();renderMain()">🔄 Effacer</button>
    </div>
  </div>
  ${r23HistoCard()}
  ${renderFourcCalendar()}`;
}

// ════════════════════════════════════════════════════
// MODE AUDIT — Rapport contrôle sanitaire
// ════════════════════════════════════════════════════

function openAuditModal(){
  if(featCheck(LIC_FEAT.AUDIT,"Audit contrôle sanitaire"))return;
  document.getElementById('audit-body').innerHTML = buildAuditBody();
  document.getElementById('audit-ov').classList.add('open');
  requestAnimationFrame(()=>{sigInit();initAuditPeriod();});
}
function closeAuditModal(){ document.getElementById('audit-ov').classList.remove('open'); }

function buildAuditBody(){
  const mois = S.config?.mois || today().slice(0,7);
  const site = getSiteName();
  const todayStr = today();
  const [y,m] = mois.split('-');
  const moisLabel = new Date(+y,+m-1,1).toLocaleDateString('fr-FR',{month:'long',year:'numeric'});

  // ── Analyse des données ─────────────────────────
  const issues = []; // {level:'danger'|'warn', msg}
  const checks = []; // {label, ok, detail}

  // 1. T°C Enceintes aujourd'hui
  const encs = getEnceintes();
  const saisiesEnc = (S['enr19']?.saisies||[]).filter(r=>r.date===todayStr);
  const ouvFaites = encs.filter(e=>saisiesEnc.some(r=>r.enc_id===e.id&&r.moment==='ouv')).length;
  const fermFaites = encs.filter(e=>saisiesEnc.some(r=>r.enc_id===e.id&&r.moment==='ferm')).length;
  const ncEnc = (S['enr19']?.saisies||[]).filter(r=>{
    const enc=encs.find(e=>e.id===r.enc_id);
    return enc && encConforme(r.temp,enc.consigne)===false;
  });
  const encOk = ouvFaites===encs.length;
  checks.push({label:'T°C enceintes — aujourd\'hui', ok:encOk, detail:`${ouvFaites}/${encs.length} ouverture · ${fermFaites}/${encs.length} fermeture`});
  if(!encOk) issues.push({level:'danger',msg:`T°C enceintes incomplètes aujourd'hui (${ouvFaites}/${encs.length})`});
  if(ncEnc.length>0) issues.push({level:'danger',msg:`${ncEnc.length} relevé(s) T°C enceinte hors consigne ce mois`});

  // 2. T°C enceintes ce mois
  const saisiesMois = _pFilter(S['enr19']?.saisies||[]);
  const joursUniques = [...new Set(saisiesMois.map(r=>r.date))].length;
  const nbJoursMois = new Date(+y,+m,0).getDate();
  const jrsActuels = Math.min(new Date().getDate(), nbJoursMois);
  const encMoisOk = joursUniques >= jrsActuels * 0.8;
  checks.push({label:'T°C enceintes — assiduité mensuelle', ok:encMoisOk, detail:`${joursUniques}/${jrsActuels} jours relevés ce mois`});
  if(!encMoisOk) issues.push({level:'warn',msg:`Relevés T°C enceintes irréguliers ce mois (${joursUniques}/${jrsActuels} jours)`});

  // 3. T°C Distribution ce mois
  const distribLignes = _pFilter(S['enr_tc_distrib']?.lignes||[]);
  const distribJours = distribLignes.length;
  const distribNC = distribLignes.filter(r=>r.midi_froid_conf==='NON'||r.midi_chaud_conf==='NON'||r.soir_froid_conf==='NON'||r.soir_chaud_conf==='NON');
  const distribOk = distribJours >= jrsActuels * 0.8;
  checks.push({label:'T°C Distribution Midi/Soir', ok:distribOk, detail:`${distribJours} jour${distribJours>1?'s':''} enregistré${distribJours>1?'s':''} ce mois${distribNC.length>0?' · '+distribNC.length+' NC':''}`});
  if(distribNC.length>0) issues.push({level:'danger',msg:`${distribNC.length} service(s) de distribution non conforme(s)`});
  if(!distribOk) issues.push({level:'warn',msg:`Relevés T°C distribution incomplets ce mois (${distribJours}/${jrsActuels} jours)`});

  // 4. Refroidissements
  const enr01 = S['enr01']?.lignes||[];
  const enr01Mois = enr01.filter(r=>r.date?.startsWith(mois));
  const pendingR = enr01Mois.filter(r=>!r._statut||r._statut==='en_attente');
  const enr01NC = enr01Mois.filter(r=>r.conf_r==='NON');
  checks.push({label:'Refroidissements CCP', ok:pendingR.length===0, detail:`${enr01Mois.length} saisie${enr01Mois.length>1?'s':''} ce mois · ${pendingR.length} en attente`});
  if(pendingR.length>0) issues.push({level:'danger',msg:`${pendingR.length} refroidissement(s) sans suivi`});
  if(enr01NC.length>0) issues.push({level:'danger',msg:`${enr01NC.length} refroidissement(s) non conforme(s) ce mois`});

  // 5. Huile friture
  const huileStats = getHuileStats();
  let huileDanger=false, huileWarn=false;
  Object.entries(huileStats).forEach(([f,s])=>{
    if(s.services>=HUILE_MAX){huileDanger=true;issues.push({level:'danger',msg:`Friteuse n°${f} : huile à changer ! (${s.services}/${HUILE_MAX} services)`});}
    else if(s.services>=HUILE_MAX-2){huileWarn=true;issues.push({level:'warn',msg:`Friteuse n°${f} : huile bientôt à changer (${s.services}/${HUILE_MAX})`});}
  });
  checks.push({label:'Huile(s) de friture', ok:!huileDanger&&!huileWarn, detail:Object.entries(huileStats).map(([f,s])=>`Friteuse n°${f} : ${s.services}/${HUILE_MAX}`).join(' · ')||'Aucune friteuse configurée'});

  // 6. Nettoyage
  const lundi=new Date(); lundi.setDate(lundi.getDate()-lundi.getDay()+1);
  const lundiStr=lundi.toISOString().slice(0,10);
  const nettRetardsAudit=nettNbRetards();
  const nettValsMois=_pFilter(S.nett_val||[]).length;
  checks.push({label:'Plan de nettoyage', ok:nettRetardsAudit===0, detail:`${nettValsMois} validation${nettValsMois>1?'s':''} ce mois · ${nettRetardsAudit} en retard`});
  if(nettRetardsAudit>0) issues.push({level:'warn',msg:`${nettRetardsAudit} nettoyage${nettRetardsAudit>1?'s':''} en retard`});

  // 7. Thermomètres
  const thermoMois=(S['enr26']?.lignes||[]).some(r=>r.date?.startsWith(mois));
  checks.push({label:'Contrôle thermomètres', ok:thermoMois, detail:thermoMois?'Contrôlé ce mois ✓':'Non contrôlé ce mois'});
  if(!thermoMois) issues.push({level:'warn',msg:'Thermomètres non contrôlés ce mois'});

  // 8. Réception
  const receptionMois=_pFilter(S['enr23']?.lignes||[]);
  const receptionNC=receptionMois.filter(r=>r.conforme==='NON');
  checks.push({label:'Contrôles à réception', ok:receptionNC.length===0, detail:`${receptionMois.length} réception${receptionMois.length>1?'s':''} ce mois${receptionNC.length>0?' · '+receptionNC.length+' NC':''}`});
  if(receptionNC.length>0) issues.push({level:'danger',msg:`${receptionNC.length} réception(s) non conforme(s) ce mois`});

  // 9. NC enregistrées
  const ncMois=_pFilter(S['enr30']?.lignes||[]);
  checks.push({label:'Fiches non-conformités', ok:true, detail:`${ncMois.length} NC enregistrée${ncMois.length>1?'s':''} ce mois`});

  // ── Score global ────────────────────────────────
  const nbChecks=checks.length;
  const nbOk=checks.filter(c=>c.ok).length;
  const score=Math.round(nbOk/nbChecks*100);
  const scoreColor=score>=90?'#2e7d32':score>=70?'#e65100':'#c62828';
  const scoreTxt=score>=90?'Très bien préparé':score>=70?'Quelques points à corriger':'Action requise avant contrôle';
  const pctDash=2*Math.PI*28;

  // ── HTML ────────────────────────────────────────
  const checksHtml=checks.map(c=>`
    <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #f0f0f0">
      <span style="font-size:1.1rem">${c.ok?'✅':'❌'}</span>
      <div style="flex:1">
        <div style="font-size:.82rem;font-weight:800;color:var(--gris)">${c.label}</div>
        <div style="font-size:.7rem;color:#b89ab6;font-weight:600">${c.detail}</div>
      </div>
    </div>`).join('');

  const issuesHtml=issues.length?`
    <div class="audit-section">
      <div class="audit-sec-title">⚠️ Points à corriger avant contrôle</div>
      <div class="audit-nc-list">
        ${issues.map(i=>`<div class="audit-nc-item">
          <span>${i.level==='danger'?'🔴':'🟡'}</span>
          <span>${i.msg}</span>
        </div>`).join('')}
      </div>
    </div>`:'<div style="background:#f0fdf4;border-radius:12px;padding:12px 14px;font-size:.85rem;font-weight:800;color:#166534;margin-bottom:14px">🎉 Aucun point bloquant — vous êtes prêt pour un contrôle !</div>';

  return `
    <!-- Score -->
    <div class="audit-score">
      <div class="audit-score-ring">
        <svg width="72" height="72" viewBox="0 0 72 72">
          <circle cx="36" cy="36" r="28" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="6"/>
          <circle cx="36" cy="36" r="28" fill="none" stroke="#fff" stroke-width="6"
            stroke-dasharray="${pctDash}" stroke-dashoffset="${pctDash*(1-score/100)}"
            stroke-linecap="round" transform="rotate(-90 36 36)"/>
          <text x="36" y="41" text-anchor="middle" font-size="16" font-weight="900" fill="#fff">${score}%</text>
        </svg>
      </div>
      <div>
        <div class="audit-score-label">Score de préparation — ${moisLabel}</div>
        <div class="audit-score-big">${site}</div>
        <div class="audit-score-txt">${scoreTxt}</div>
      </div>
    </div>

    ${issuesHtml}

    <!-- Checklist détaillée -->
    <div class="audit-section">
      <div class="audit-sec-title">📋 Checklist complète HACCP</div>
      ${checksHtml}
    </div>

    <!-- Stats rapides -->
    <div class="audit-section">
      <div class="audit-sec-title">📊 Statistiques du mois</div>
      <div class="audit-stat-grid">
        <div class="audit-stat ${_pFilter(S['enr01']?.lignes||[]).length>0?'ok':''}">
          <div class="audit-stat-label">Refroidissements</div>
          <div class="audit-stat-val">${(S['enr01']?.lignes||[]).filter(r=>r.date?.startsWith(mois)).length}</div>
          <div class="audit-stat-sub">saisies ce mois</div>
        </div>
        <div class="audit-stat ${distribJours>0?'ok':''}">
          <div class="audit-stat-label">T°C Distribution</div>
          <div class="audit-stat-val">${distribJours}</div>
          <div class="audit-stat-sub">jours enregistrés</div>
        </div>
        <div class="audit-stat ${joursUniques>0?'ok':'warn'}">
          <div class="audit-stat-label">Relevés enceintes</div>
          <div class="audit-stat-val">${joursUniques}</div>
          <div class="audit-stat-sub">jours ce mois</div>
        </div>
        <div class="audit-stat ${receptionNC.length===0?'ok':'danger'}">
          <div class="audit-stat-label">Réceptions</div>
          <div class="audit-stat-val">${receptionMois.length}</div>
          <div class="audit-stat-sub">${receptionNC.length} non conforme${receptionNC.length>1?'s':''}</div>
        </div>
        <div class="audit-stat ${issues.filter(i=>i.level==='danger').length===0?'ok':'danger'}">
          <div class="audit-stat-label">Alertes critiques</div>
          <div class="audit-stat-val">${issues.filter(i=>i.level==='danger').length}</div>
          <div class="audit-stat-sub">à corriger</div>
        </div>
        <div class="audit-stat ${ncMois.length>=0?'ok':''}">
          <div class="audit-stat-label">Fiches NC</div>
          <div class="audit-stat-val">${ncMois.length}</div>
          <div class="audit-stat-sub">enregistrées</div>
        </div>
      </div>
    </div>

    <!-- Signature -->
    <div class="audit-section">
      <div class="audit-sec-title">✍️ Signature du responsable</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px">
        <input type="text" id="audit-resp-name" class="fi" placeholder="Nom du responsable..." style="border-radius:10px;padding:10px 13px;border:1.5px solid var(--brd);font-size:.88rem;font-family:inherit;width:100%"
          value="${escH(S.config?.responsable||getActiveSession()||'')}">
        <input type="text" id="audit-resp-role" class="fi" placeholder="Fonction (ex: Chef de cuisine...)" style="border-radius:10px;padding:10px 13px;border:1.5px solid var(--brd);font-size:.88rem;font-family:inherit;width:100%"
          value="${escH(S.config?.responsableRole||'')}">
      </div>
      <div class="sig-wrap">
        <canvas class="sig-canvas" id="sig-canvas" width="800" height="220"></canvas>
        <div class="sig-bar">
          <span>✍️ Signez ici avec le doigt</span>
          <button class="sig-clear" onclick="sigClear()">🗑 Effacer</button>
        </div>
      </div>
    </div>

    <!-- Actions -->
    <div class="audit-section">
      <div class="audit-sec-title">📅 Période du rapport</div>
      <div class="period-pills" id="audit-period-pills">
        <button class="period-pill on" data-period="mois" onclick="setAuditPeriod('mois')">Ce mois</button>
        <button class="period-pill" data-period="today" onclick="setAuditPeriod('today')">Aujourd'hui</button>
        <button class="period-pill" data-period="week" onclick="setAuditPeriod('week')">7 jours</button>
        <button class="period-pill" data-period="15j" onclick="setAuditPeriod('15j')">15 jours</button>
        <button class="period-pill" data-period="all" onclick="setAuditPeriod('all')">Tout</button>
        <button class="period-pill" data-period="custom" onclick="setAuditPeriod('custom')">Perso.</button>
      </div>
      <div class="period-custom" id="audit-period-custom" style="display:none;margin-bottom:8px">
        <input type="date" id="audit-period-from">
        <span style="font-size:.8rem;color:#b89ab6;font-weight:700">au</span>
        <input type="date" id="audit-period-to">
      </div>
      <div id="audit-period-label" style="font-size:.72rem;color:var(--mag);font-weight:700;margin-bottom:10px"></div>
    </div>
    <div class="audit-section">
      <div class="audit-sec-title">📥 Générer le rapport</div>
      <div style="font-size:.72rem;font-weight:800;color:#b89ab6;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Choisir le rapport à générer :</div>
      <button class="audit-go-btn" style="background:linear-gradient(135deg,#5C1E5A,#9C2775)" onclick="generatePDF('general')">
        📋 Rapport Général — Vue d'ensemble
      </button>
      <button class="audit-go-btn" style="background:linear-gradient(135deg,#c62828,#e53935);margin-top:7px" onclick="generatePDF('haccp')">
        🌡️ Rapport HACCP — Températures &amp; CCP
      </button>
      <button class="audit-go-btn" style="background:linear-gradient(135deg,#1565c0,#1976d2);margin-top:7px" onclick="generatePDF('nettoyage')">
        🧹 Rapport Nettoyage — Plan sanitaire
      </button>
      <button class="audit-go-btn secondary" style="margin-top:10px" onclick="closeAuditModal();openExpModal()">
        📊 Export Excel HACCP complet
      </button>
      <button class="audit-go-btn" style="background:linear-gradient(135deg,#7B2D78,#c93a78);margin-top:7px" onclick="closeAuditModal();openAuditMP()">
        📦 Audit Matières Premières — Top 20
      </button>
    </div>
    <div style="height:20px"></div>`;
}

// ── Signature tactile ─────────────────────────────────
let _sigDrawing=false, _sigLast=null, _sigPrev=null;
function sigInit(){
  const c=document.getElementById('sig-canvas'); if(!c) return;
  const ctx=c.getContext('2d');
  ctx.strokeStyle='#3a0a3a'; ctx.lineWidth=2.5; ctx.lineCap='round'; ctx.lineJoin='round';
  // Remplir fond blanc (pour export PNG)
  ctx.fillStyle='#fdf8fd'; ctx.fillRect(0,0,c.width,c.height);

  const pt=e=>{
    const r=c.getBoundingClientRect();
    const src=e.touches?e.touches[0]:e;
    const scaleX=c.width/r.width, scaleY=c.height/r.height;
    return{x:(src.clientX-r.left)*scaleX, y:(src.clientY-r.top)*scaleY};
  };
  let _ptsAudit=[];
  const start=e=>{
    e.preventDefault();_sigDrawing=true;_sigLast=pt(e);_sigPrev=null;_ptsAudit=[_sigLast];
    ctx.beginPath();ctx.moveTo(_sigLast.x,_sigLast.y);
  };
  const move=e=>{
    e.preventDefault();if(!_sigDrawing)return;
    const p=pt(e);_ptsAudit.push(p);
    const n=_ptsAudit.length;
    ctx.beginPath();
    if(n>=3){
      const p0=_ptsAudit[n-3],p1=_ptsAudit[n-2],p2=_ptsAudit[n-1];
      const mx=(p1.x+p2.x)/2,my=(p1.y+p2.y)/2;
      ctx.moveTo((p0.x+p1.x)/2,(p0.y+p1.y)/2);
      ctx.quadraticCurveTo(p1.x,p1.y,mx,my);
    } else {ctx.moveTo(_sigLast.x,_sigLast.y);ctx.lineTo(p.x,p.y);}
    ctx.stroke();_sigLast=p;_sigPrev=p;
  };
  const stop=e=>{e.preventDefault();_sigDrawing=false;};
  c.addEventListener('mousedown',start); c.addEventListener('mousemove',move); c.addEventListener('mouseup',stop);
  c.addEventListener('touchstart',start,{passive:false}); c.addEventListener('touchmove',move,{passive:false}); c.addEventListener('touchend',stop,{passive:false});
}
function sigClear(){
  const c=document.getElementById('sig-canvas'); if(!c) return;
  const ctx=c.getContext('2d');
  ctx.fillStyle='#fdf8fd'; ctx.fillRect(0,0,c.width,c.height);
}
function sigGetDataURL(){
  const c=document.getElementById('sig-canvas');
  if(!c) return null;
  // Vérifier si signature non vide (pas uniquement la couleur de fond)
  const ctx=c.getContext('2d');
  const px=ctx.getImageData(0,0,c.width,c.height).data;
  let drawn=false;
  for(let i=0;i<px.length;i+=4){
    if(px[i]<200||px[i+1]<200||px[i+2]<200){drawn=true;break;}
  }
  return drawn ? c.toDataURL('image/png') : null;
}

function generatePDF(type){
  const mois = S.config?.mois || today().slice(0,7);
  const site = getSiteName();
  const code = S.config?.code || '';
  const todayStr = today();
  const [y,m] = mois.split('-');
  const moisLabel = new Date(+y,+m-1,1).toLocaleDateString('fr-FR',{month:'long',year:'numeric'});
  // Période sélectionnée dans le modal
  const _pdfPeriod=getPeriodByKey(S.expCfg?.auditPeriod||'mois','audit');
  const _pFrom=_pdfPeriod.from, _pTo=_pdfPeriod.to, _pLabel=_pdfPeriod.label;
  // _pFilter est global — pas besoin de le redéfinir ici
  const dateGen = new Date().toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

  // Récupérer responsable + signature
  const respName = document.getElementById('audit-resp-name')?.value?.trim() || S.config?.responsable || '';
  const respRole = document.getElementById('audit-resp-role')?.value?.trim() || '';
  const sigDataURL = sigGetDataURL();
  // Sauvegarder pour la prochaine fois
  if(respName){ S.config=S.config||{}; S.config.responsable=respName; }
  if(respRole){ S.config=S.config||{}; S.config.responsableRole=respRole; }
  save();

  // Helpers
  const fmtDate = d => d ? new Date(d+'T12:00').toLocaleDateString('fr-FR') : '—';
  const fmtT = t => t!==undefined&&t!==''&&!isNaN(parseFloat(t)) ? (parseFloat(t)>=0?'+':'')+parseFloat(t).toFixed(1)+'°C' : '—';
  const conf = v => v==='OUI'?'<span style="color:#166534;font-weight:800">✓ OUI</span>':v==='NON'?'<span style="color:#c62828;font-weight:800">✗ NON</span>':'—';

  // T°C Enceintes — tableau mensuel
  const encs = getEnceintes();
  const saisiesEnc = S['enr19']?.saisies||[];
  const encDays = [...new Set(_pFilter(saisiesEnc).map(r=>r.date))].sort();
  const encTable = encDays.length ? `
    <table><thead><tr><th>Date</th>${encs.map(e=>`<th>🌅 ${e.label}</th><th>🌙 ${e.label}</th>`).join('')}</tr></thead>
    <tbody>${encDays.map(d=>`<tr><td>${fmtDate(d)}</td>${encs.map(e=>{
      const ouv=saisiesEnc.find(r=>r.date===d&&r.enc_id===e.id&&r.moment==='ouv');
      const fer=saisiesEnc.find(r=>r.date===d&&r.enc_id===e.id&&r.moment==='ferm');
      const cO=ouv?encConforme(ouv.temp,e.consigne):null;
      const cF=fer?encConforme(fer.temp,e.consigne):null;
      return`<td class="${cO===false?'nc':cO===true?'ok':''}">${fmtT(ouv?.temp)}</td><td class="${cF===false?'nc':cF===true?'ok':''}">${fmtT(fer?.temp)}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table>` : '<p class="empty">Aucune donnée</p>';

  // T°C Distribution — tableau
  // Distribution par service (nouvelles sections) + ancienne section
  const _distribSvcs=getDistribServices();
  const _distribSvcData=_distribSvcs.map(function(svc){
    const k='enr_distrib_'+svc.id;
    const lig=_pFilter((S[k]&&S[k].lignes)||[]).sort(function(a,b){return a.date.localeCompare(b.date);});
    return {svc:svc,lignes:lig};
  }).filter(function(d){return d.lignes.length>0;});
  const distribLignes = _pFilter(S['enr_tc_distrib']?.lignes||[]).sort((a,b)=>a.date.localeCompare(b.date));
  const distribTable = distribLignes.length ? `
    <table><thead><tr><th>Date</th><th>Plat froid</th><th>T°C</th><th>Conf.</th><th>Plat chaud</th><th>T°C</th><th>Conf.</th><th>Service</th></tr></thead>
    <tbody>
    ${distribLignes.flatMap(r=>[
      r.midi_froid_plat||r.midi_chaud_plat ? `<tr><td>${fmtDate(r.date)}</td><td>${r.midi_froid_plat||'—'}</td><td class="${r.midi_froid_conf==='NON'?'nc':r.midi_froid_conf==='OUI'?'ok':''}">${fmtT(r.midi_froid_temp)}</td><td>${conf(r.midi_froid_conf)}</td><td>${r.midi_chaud_plat||'—'}</td><td class="${r.midi_chaud_conf==='NON'?'nc':r.midi_chaud_conf==='OUI'?'ok':''}">${fmtT(r.midi_chaud_temp)}</td><td>${conf(r.midi_chaud_conf)}</td><td>🌞 Midi${r.midi_heure?' '+r.midi_heure:''}</td></tr>` : '',
      r.soir_froid_plat||r.soir_chaud_plat ? `<tr><td>${fmtDate(r.date)}</td><td>${r.soir_froid_plat||'—'}</td><td class="${r.soir_froid_conf==='NON'?'nc':r.soir_froid_conf==='OUI'?'ok':''}">${fmtT(r.soir_froid_temp)}</td><td>${conf(r.soir_froid_conf)}</td><td>${r.soir_chaud_plat||'—'}</td><td class="${r.soir_chaud_conf==='NON'?'nc':r.soir_chaud_conf==='OUI'?'ok':''}">${fmtT(r.soir_chaud_temp)}</td><td>${conf(r.soir_chaud_conf)}</td><td>🌙 Soir${r.soir_heure?' '+r.soir_heure:''}</td></tr>` : ''
    ]).filter(Boolean).join('')}
    </tbody></table>` : '<p class="empty">Aucune donnée</p>';

  // HTML complet distribution : ancienne table générique + nouvelles fiches par service
  // Calculé ici pour être passé directement aux fonctions build* sans changer leur signature
  const _distribSvcHtml = _distribSvcData.map(function(d){
    if(!d.lignes.length) return '';
    const rows = d.lignes.map(function(r){
      const cF=r.froid_conf==='OUI', cC=r.chaud_conf==='OUI';
      return '<tr><td>'+fmtDate(r.date)+'</td>'
        +'<td>'+escH(r.froid_plat||'—')+'</td>'
        +'<td class="'+(cF?'ok':'nc')+'">'+fmtT(r.froid_temp)+'</td>'
        +'<td>'+conf(r.froid_conf)+'</td>'
        +'<td>'+escH(r.chaud_plat||'—')+'</td>'
        +'<td class="'+(cC?'ok':'nc')+'">'+fmtT(r.chaud_temp)+'</td>'
        +'<td>'+conf(r.chaud_conf)+'</td>'
        +'<td>'+(r.heure||'—')+'</td>'
        +'<td>'+escH(r.cuisinier||'—')+'</td></tr>';
    }).join('');
    return '<h3 style="color:#5C1E5A;margin:12px 0 4px">'+d.svc.ico+' '+escH(d.svc.label)+'</h3>'
      +'<table><thead><tr><th>Date</th><th>Plat froid</th><th>T°C froid</th><th>Conf.</th>'
      +'<th>Plat chaud</th><th>T°C chaud</th><th>Conf.</th><th>Heure</th><th>Cuisinier</th>'
      +'</tr></thead><tbody>'+rows+'</tbody></table>';
  }).join('');
  const distribAllHtml = distribTable + _distribSvcHtml;

  // Refroidissements
  const enr01 = _pFilter(S['enr01']?.lignes||[]);
  const ref01Table = enr01.length ? `
    <table><thead><tr><th>Date</th><th>Produit</th><th>T°C début</th><th>T°C fin</th><th>Durée</th><th>Conforme</th><th>Cuisinier</th></tr></thead>
    <tbody>${enr01.map(r=>`<tr>
      <td>${fmtDate(r.date)}</td><td>${r.produit||'—'}</td>
      <td>${fmtT(r.t_pref_deb||r.t_ref_deb)}</td><td>${fmtT(r.t_pref_fin||r.t_ref_fin)}</td>
      <td>${r.duree||r.duree_r||'—'}</td>
      <td class="${r.conf_r==='NON'?'nc':r.conf_r==='OUI'?'ok':''}">${conf(r.conf_r||r.conforme)}</td>
      <td>${r.cuisinier||'—'}</td>
    </tr>`).join('')}</tbody></table>` : '<p class="empty">Aucune donnée</p>';

  // Réceptions
  const recep = _pFilter(S['enr23']?.lignes||[]);
  const recepTable = recep.length ? `
    <table><thead><tr><th>Date</th><th>Fournisseur</th><th>Produit 1</th><th>T°C</th><th>Produit 2</th><th>T°C</th><th>Conf.</th></tr></thead>
    <tbody>${recep.map(r=>`<tr>
      <td>${fmtDate(r.date)}</td><td>${r.fournisseur||'—'}</td>
      <td>${r.p1_produit||'—'}</td><td class="${r.p1_tc&&parseFloat(r.p1_tc)<=6?'ok':'nc'}">${fmtT(r.p1_tc)}</td>
      <td>${r.p2_produit||'—'}</td><td class="${r.p2_tc&&parseFloat(r.p2_tc)<=6?'ok':'nc'}">${fmtT(r.p2_tc)}</td>
      <td class="${r.conforme==='NON'?'nc':'ok'}">${conf(r.conforme)}</td>
    </tr>`).join('')}</tbody></table>` : '<p class="empty">Aucune donnée</p>';

  // NC
  const ncList = _pFilter(S['enr30']?.lignes||[]);
  const ncTable = ncList.length ? `
    <table><thead><tr><th>N°</th><th>Date</th><th>Problème</th><th>Action corrective</th><th>Responsable</th><th>Statut</th></tr></thead>
    <tbody>${ncList.map(r=>`<tr>
      <td style="font-size:10px;font-weight:700">${r.num||'—'}</td>
      <td>${fmtDate(r.date)}</td><td>${r.probleme||r.description||r.desc||'—'}</td>
      <td>${r.action||'—'}</td><td>${r.cuisinier||r.resp||r.nom_fct||'—'}</td>
      <td class="${r.cloture==='OUI'?'ok':'nc'}" style="font-weight:700;font-size:10px">${r.cloture==='OUI'?'✅ Clôturée':'⚠️ Ouverte'}</td>
    </tr>`).join('')}</tbody></table>` : '<p class="empty">Aucune non-conformité enregistrée</p>';

  // Générer le score pour le rapport aussi
  const encs2=getEnceintes();
  const s2=S['enr19']?.saisies||[];
  const ouvFaites2=encs2.filter(e=>s2.filter(r=>r.date===todayStr).some(r=>r.enc_id===e.id&&r.moment==='ouv')).length;
  const score2=Math.round([
    ouvFaites2===encs2.length,
    distribLignes.length>0,
    (S['enr01']?.lignes||[]).filter(r=>r._statut==='en_attente').length===0,
    _pFilter(S.nett_val||[]).length>0,
    _pFilter(S['enr26']?.lignes||[]).length>0,
  ].filter(Boolean).length/5*100);

  // Sections supplémentaires pour rapport complet
  // Historique nettoyage depuis nouveau système
  const nettRef2=S.nett_ref||[];
  const nettMois=_pFilter(S.nett_val||[]).map(v=>{
    const it=nettRef2.find(r=>r.id===v.ref_id)||{zone:'?',materiel:v.ref_id||'?',freq:''};
    return {date:v.date,heure:v.heure||'',zone:it.zone,materiel:it.materiel,
      frequence:it.freq,cuisinier:v.cuisinier||'',conforme:v.conforme||'',commentaire:v.commentaire||''};
  });
  const enr04Mois=_pFilter(S['enr04']?.lignes||[]);
  const enr05Mois=_pFilter([...(S['enr05']?.lignes||[]),...(S['enr06']?.lignes||[])]);
  const enr33Mois=_pFilter(S['enr33']?.lignes||[]);
  const cpData=(S.customPages||[]).map(cp=>({cp,lignes:_pFilter(S[cp.id]?.lignes||[])})).filter(x=>x.lignes.length>0);
  // Helper tableau générique PDF
  const SKIP_PDF=['_ts','_sec','_orig','_statut','_src','_auto','_enr01_idx','_enr01_ts'];
  const pdfTable=(lignes,fields)=>{
    if(!lignes||!lignes.length) return '<p style="color:#999;font-style:italic;font-size:10px;padding:6px 0">Aucune donnée</p>';
    const keys=fields?.length?fields.map(f=>f.id):[...new Set(lignes.flatMap(r=>Object.keys(r).filter(k=>!SKIP_PDF.includes(k))))];
    const rows=lignes.map(r=>`<tr>${keys.map(k=>{const v=r[k];
      if(!v&&v!==0)return'<td>—</td>';
      if(k==='date')try{return`<td>${new Date(v+'T12:00').toLocaleDateString('fr-FR')}</td>`;}catch{return`<td>${v}</td>`;}
      if(['conforme','conf_r','conf_rt','conf_deb','conf_fin','conf_prem','conf_dern','conf_premier','conf1','conf2','conf_duree','conf_couple','vehicule','emballage','etiquetage','qualite','change'].includes(k)){
        const raisNC=r['nc_raison__'+k];
        return`<td style="background:${v==='OUI'?'#e8f5e9;color:#1b5e20':v==='NON'?'#ffebee;color:#b71c1c':'#fff'};font-weight:700">${v}${v==='NON'&&raisNC?' <span style=\"font-size:9px;display:block;font-weight:400\">📋 '+raisNC+'</span>':''}</td>`;}
      if((k.startsWith('t_')||k==='tc')&&!isNaN(parseFloat(v)))return`<td>${(parseFloat(v)>=0?'+':'')+parseFloat(v).toFixed(1)}°C</td>`;
      return`<td>${String(v)}</td>`;}).join('')}</tr>`).join('');
    return`<table style="width:100%;border-collapse:collapse;font-size:10px;margin-bottom:8px"><thead><tr>${keys.map(k=>`<th style="background:#f5edf5;color:#5C1E5A;font-weight:800;padding:5px 6px;text-align:left;border:1px solid #e8d5e8">${FLAB[k]||k}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
  };

  const _htmlBuilt=`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rapport HACCP — ${site} — ${_pLabel}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#222;background:#fff;padding:24px;}
  h1{font-size:20px;font-weight:900;color:#5C1E5A;margin-bottom:4px;}
  h2{font-size:15px;font-weight:800;color:#5C1E5A;margin:22px 0 8px;border-bottom:2px solid #f0e4f0;padding-bottom:4px;}
  h3{font-size:12px;font-weight:800;color:#444;margin:12px 0 5px;}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;padding-bottom:14px;border-bottom:3px solid #5C1E5A;}
  .header-left p{color:#666;font-size:11px;margin-top:3px;}
  .score-badge{background:linear-gradient(135deg,#5C1E5A,#C93A78);color:#fff;border-radius:12px;padding:12px 18px;text-align:center;}
  .score-badge .s-num{font-size:28px;font-weight:900;}
  .score-badge .s-lbl{font-size:10px;opacity:.85;}
  table{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:11px;}
  th{background:#f5edf5;color:#5C1E5A;font-weight:800;padding:7px 8px;text-align:left;border:1px solid #e8d5e8;}
  td{padding:6px 8px;border:1px solid #eee;vertical-align:top;}
  tr:nth-child(even) td{background:#faf5fa;}
  td.ok{background:#e8f5e9!important;color:#1b5e20;font-weight:700;}
  td.nc{background:#ffebee!important;color:#b71c1c;font-weight:700;}
  .check-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px;}
  .check-item{display:flex;align-items:center;gap:8px;background:#f9f9f9;border-radius:8px;padding:8px 10px;border:1px solid #eee;}
  .check-item.ok{border-color:#c8e6c9;background:#f1f8e9;}
  .check-item.fail{border-color:#ffcdd2;background:#fff5f5;}
  .check-lbl{font-size:11px;font-weight:700;}
  .check-det{font-size:10px;color:#888;}
  .empty{color:#999;font-style:italic;padding:10px 0;font-size:11px;}
  .nc-alert{background:#fff3e0;border:1.5px solid #ff9800;border-radius:8px;padding:10px 12px;margin-bottom:10px;}
  .nc-alert h3{color:#e65100;margin:0 0 6px;}
  .nc-alert li{font-size:11px;color:#bf360c;margin:3px 0 3px 14px;}
  .footer{margin-top:30px;padding-top:10px;border-top:1px solid #eee;font-size:10px;color:#999;display:flex;justify-content:space-between;}
  @media print{body{padding:12px;}h2{page-break-before:auto;}}
</style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h1>🔍 Rapport HACCP — Contrôle Sanitaire</h1>
      <p><strong>${site}</strong>${code?' · Code : '+code:''}</p>
      <p>Période analysée : <strong>${_pLabel}</strong></p>
      <p>Rapport généré le : <strong>${dateGen}</strong></p>
    </div>
    <div class="score-badge">
      <div class="s-num">${score2}%</div>
      <div class="s-lbl">Score préparation</div>
    </div>
  </div>

  <h2>✅ Checklist de conformité</h2>
  <div class="check-grid">
    ${[
      {ok:ouvFaites2===encs2.length, lbl:'T°C enceintes — Aujourd\'hui', det:`${ouvFaites2}/${encs2.length} relevées`},
      {ok:distribLignes.length>0||_distribSvcData.length>0, lbl:'T°C Distribution — ce mois',
        det:(distribLignes.length+_distribSvcData.reduce(function(s,d){return s+d.lignes.length;},0))+' enregistrements'},
      {ok:(S['enr01']?.lignes||[]).filter(r=>r._statut==='en_attente').length===0, lbl:'Refroidissements', det:'Sans retard'},
      {ok:_pFilter(S.nett_val||[]).length>0, lbl:'Nettoyage', det:`${_pFilter(S.nett_val||[]).length} validation(s)`},
      {ok:_pFilter(S['enr26']?.lignes||[]).length>0, lbl:'Thermomètres', det:'Contrôle mensuel'},
      {ok:recep.filter(r=>r.conforme==='NON').length===0, lbl:'Réceptions', det:`${recep.length} ce mois`},
    ].map(c=>`<div class="check-item ${c.ok?'ok':'fail'}">
      <span style="font-size:16px">${c.ok?'✅':'❌'}</span>
      <div><div class="check-lbl">${c.lbl}</div><div class="check-det">${c.det}</div></div>
    </div>`).join('')}
  </div>

  <h2>🌡️ T°C Enceintes de stockage — ${_pLabel}</h2>
  <p style="font-size:10px;color:#666;margin-bottom:6px">Consignes : BOF/Viandes/Prod. finis 0→+3°C · Fruits &amp; Légumes +4→+8°C · Négative ≤-18°C</p>
  ${encTable}

  <h2>🌡️ T°C Distribution Midi &amp; Soir — ${_pLabel}</h2>
  <p style="font-size:10px;color:#666;margin-bottom:6px">Froid ≤+10°C · Chaud ≥+63°C</p>
  ${distribAllHtml}

  <h2>❄️ Refroidissements CCP — ${_pLabel}</h2>
  <p style="font-size:10px;color:#666;margin-bottom:6px">Atteindre ≤+10°C en 2h, ≤+3°C en 2h supplémentaires</p>
  ${ref01Table}

  <h2>📦 Contrôles à réception — ${_pLabel}</h2>
  ${recepTable}

  ${enr04Mois.length?`<h2>🥩 Steaks hachés — ${_pLabel}</h2>${pdfTable(enr04Mois,FDEFS['enr04']?.fields)}`:''}
  ${enr05Mois.length?`<h2>🍟 Fritures — ${_pLabel}</h2>${pdfTable(enr05Mois)}`:''}
  ${enr33Mois.length?`<h2>🍱 Plats témoins — ${_pLabel}</h2>${pdfTable(enr33Mois)}`:''}
  ${nettMois.length?`<h2>🧹 Nettoyage — ${_pLabel}</h2>${pdfTable(nettMois)}`:''}
  ${cpData.map(x=>`<h2>${x.cp.emoji} ${x.cp.name} — ${_pLabel}</h2>${pdfTable(x.lignes,x.cp.fields)}`).join('')}

  <h2>🚨 Non-conformités — ${_pLabel}</h2>
  ${ncTable}

  <h2>✍️ Signature du responsable</h2>
  <table style="width:100%;margin-top:8px">
    <tr>
      <td style="width:50%;vertical-align:top;padding:12px 16px;border:1px solid #eee">
        <div style="font-size:11px;font-weight:800;color:#444;margin-bottom:6px">Responsable</div>
        <div style="font-size:13px;font-weight:900;color:#5C1E5A">${respName||'__________________________'}</div>
        ${respRole?`<div style="font-size:11px;color:#888;margin-top:3px">${respRole}</div>`:''}
        <div style="font-size:10px;color:#aaa;margin-top:8px">Date : ${new Date().toLocaleDateString('fr-FR')}</div>
      </td>
      <td style="width:50%;vertical-align:top;padding:12px 16px;border:1px solid #eee">
        <div style="font-size:11px;font-weight:800;color:#444;margin-bottom:6px">Signature</div>
        ${sigDataURL
          ? `<img src="${sigDataURL}" style="max-width:100%;height:70px;object-fit:contain;display:block">`
          : '<div style="height:70px;border-bottom:2px solid #ccc;margin-bottom:4px"></div>'
        }
      </td>
    </tr>
  </table>

  <div class="footer">
    <span>PMS HACCP — ${site}${code?' ('+code+')':''}</span>
    <span>Rapport généré le ${new Date().toLocaleString('fr-FR')}</span>
  </div>
<\/body>
<\/html>`;

  // ─── Sélection du HTML selon type ───────────────
  const html=_htmlBuilt;
  let finalHtml, pdfTitle;
  if(type==='nettoyage'){
    finalHtml = buildNettoyagePDF(site,code,mois,_pLabel,dateGen,respName,respRole,sigDataURL);
    pdfTitle = 'Nettoyage';
  } else if(type==='haccp'){
    finalHtml = buildHaccpPDF(site,code,mois,_pLabel,dateGen,respName,respRole,sigDataURL,
      fmtDate,fmtT,conf,encTable,distribAllHtml,ref01Table,recepTable,ncTable,
      enr04Mois,enr05Mois,enr33Mois,pdfTable);
    pdfTitle = 'HACCP';
  } else {
    finalHtml = buildGeneralPDF(site,code,mois,_pLabel,dateGen,respName,respRole,sigDataURL,
      fmtDate,fmtT,conf,encTable,distribAllHtml,ref01Table,recepTable,ncTable,
      nettMois,enr04Mois,enr05Mois,enr33Mois,cpData,pdfTable,score2,
      ouvFaites2,encs2,distribLignes,recep);
    pdfTitle = 'General';
  }

  const blob=new Blob([finalHtml],{type:'text/html'});
  const url=URL.createObjectURL(blob);
  const w=window.open(url,'_blank');
  if(w){ setTimeout(()=>{ w.print(); },900); }
  else {
    const a=document.createElement('a');
    a.href=url; a.download=`HACCP_${pdfTitle}_${site.replace(/\s+/g,'_')}_${mois}.html`;
    a.click();
  }
  setTimeout(()=>URL.revokeObjectURL(url),5000);
  toast('🖨️ Rapport '+pdfTitle+' généré !');
}

// ════════════════════════════════════════════════════
// HELPERS PDF — CSS commun + score
// ════════════════════════════════════════════════════
function _pdfCSS(){
  return `*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#222;background:#fff;padding:20px;}
h1{font-size:19px;font-weight:900;margin-bottom:4px;}
h2{font-size:14px;font-weight:800;margin:18px 0 7px;border-bottom:2px solid;padding-bottom:4px;}
h3{font-size:11px;font-weight:800;color:#444;margin:10px 0 4px;}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;padding-bottom:12px;border-bottom:3px solid;}
.hdr p{color:#666;font-size:10px;margin-top:3px;}
.score-ring{width:90px;height:90px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;flex-shrink:0;}
.score-ring .s-num{font-size:26px;font-weight:900;line-height:1;}
.score-ring .s-lbl{font-size:9px;opacity:.85;text-align:center;margin-top:2px;}
.score-detail{margin-top:6px;display:flex;flex-wrap:wrap;gap:5px;}
.sd-item{font-size:10px;padding:3px 8px;border-radius:8px;font-weight:700;}
table{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:11px;}
th{background:#f5edf5;color:#5C1E5A;font-weight:800;padding:6px 7px;text-align:left;border:1px solid #e8d5e8;}
td{padding:5px 7px;border:1px solid #eee;vertical-align:top;}
tr:nth-child(even) td{background:#faf5fa;}
td.ok{background:#e8f5e9!important;color:#1b5e20;font-weight:700;}
td.nc{background:#ffebee!important;color:#b71c1c;font-weight:700;}
.check-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:10px;}
.check-item{display:flex;align-items:center;gap:7px;background:#f9f9f9;border-radius:7px;padding:7px 9px;border:1px solid #eee;}
.check-item.ok{border-color:#c8e6c9;background:#f1f8e9;}
.check-item.fail{border-color:#ffcdd2;background:#fff5f5;}
.check-lbl{font-size:11px;font-weight:700;}
.check-det{font-size:10px;color:#888;}
.empty{color:#999;font-style:italic;padding:8px 0;font-size:10px;}
.section-score{display:inline-block;padding:2px 9px;border-radius:10px;font-size:10px;font-weight:800;margin-left:8px;}
.footer{margin-top:24px;padding-top:8px;border-top:1px solid #eee;font-size:9px;color:#999;display:flex;justify-content:space-between;}
.sig-block{display:flex;gap:16px;margin-top:8px;}
.sig-col{flex:1;border:1px solid #eee;border-radius:8px;padding:10px 12px;}
.sig-col-lbl{font-size:10px;font-weight:800;color:#444;margin-bottom:4px;}
@media print{body{padding:10px;}h2{page-break-before:auto;}}`;
}

function _pdfScoreBadge(score, color, label){
  return `<div class="score-ring" style="background:${color}">
    <div class="s-num">${score}%</div>
    <div class="s-lbl">${label}</div>
  </div>`;
}

function _pdfSig(respName, respRole, sigDataURL){
  return `<h2 style="color:#444;border-color:#ccc">✍️ Signature du responsable</h2>
  <div class="sig-block">
    <div class="sig-col">
      <div class="sig-col-lbl">Responsable</div>
      <div style="font-size:13px;font-weight:900;color:#5C1E5A">${respName||'___________________'}</div>
      ${respRole?'<div style="font-size:10px;color:#888;margin-top:2px">'+respRole+'</div>':''}
      <div style="font-size:9px;color:#aaa;margin-top:6px">Date : ${new Date().toLocaleDateString('fr-FR')}</div>
    </div>
    <div class="sig-col">
      <div class="sig-col-lbl">Signature</div>
      ${sigDataURL
        ? '<img src="'+sigDataURL+'" style="max-width:100%;height:60px;object-fit:contain;display:block">'
        : '<div style="height:60px;border-bottom:2px solid #ccc;margin-bottom:2px"></div>'}
    </div>
  </div>`;
}

function _pdfWrap(title, accentColor, site, code, mois, moisLabel, dateGen, bodyHtml, scoreBadge, footerExtra){
  return `<!DOCTYPE html><html lang="fr"><head>
<meta charset="UTF-8"><title>${title} — ${site} — ${moisLabel}</title>
<style>${_pdfCSS()}</style></head><body>
<div class="hdr" style="border-color:${accentColor}">
  <div>
    <h1 style="color:${accentColor}">${title}</h1>
    <p><strong>${site}</strong>${code?' · Code : '+code:''}</p>
    <p>Période : <strong>${moisLabel}</strong></p>
    <p>Généré le : <strong>${dateGen}</strong></p>
    ${footerExtra||''}
  </div>
  ${scoreBadge}
</div>
${bodyHtml}
<div class="footer">
  <span>PMS HACCP — ${S.config?.headerGroupe||'HACC.PRO'} — ${site}${code?' ('+code+')':''}</span>
  <span>Généré le ${new Date().toLocaleString('fr-FR')}</span>
</div>
</body></html>`;
}

// ════════════════════════════════════════════════════
// PDF GÉNÉRAL
// ════════════════════════════════════════════════════

// ── Helper bilan fournisseurs mois ──────────────────
function fourcBilanMois(mois){
  const fournisseurs=S.fournisseurs||[];
  const receps=S['enr23']?.lignes||[];
  const recepsMois=receps.filter(r=>r.date?.startsWith(mois));
  // Pour chaque fournisseur, compter les livraisons attendues vs reçues
  return fournisseurs.map(f=>{
    const jours=f.jours||[];
    if(!jours.length) return null;
    // Compter les jours attendus dans le mois
    const [y,m]=mois.split('-').map(Number);
    const daysInMonth=new Date(y,m,0).getDate();
    let attendus=0;
    for(let d=1;d<=daysInMonth;d++){
      const dow=(new Date(y,m-1,d).getDay()+6)%7; // 0=Lun
      if(jours.includes(['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'][dow])) attendus++;
    }
    // Réceptions effectivement faites ce mois pour ce fournisseur
    const faites=recepsMois.filter(r=>
      r.fournisseur&&r.fournisseur.toLowerCase().includes(f.nom.toLowerCase())
    ).length;
    const manquantes=Math.max(0,attendus-faites);
    return {nom:f.nom, jours:jours.join(', '), notes:f.notes||'', attendus, faites, manquantes,
      taux:attendus>0?Math.round(faites/attendus*100):100};
  }).filter(Boolean);
}

function buildGeneralPDF(site,code,mois,moisLabel,dateGen,respName,respRole,sigDataURL,
  fmtDate,fmtT,conf,encTable,distribAllHtml,ref01Table,recepTable,ncTable,
  nettMois,enr04Mois,enr05Mois,enr33Mois,cpData,pdfTable,score2,
  ouvFaites2,encs2,distribLignes,recep){

  // Score général sur 10 critères
  const criteres=[
    {lbl:'T°C enceintes', ok:ouvFaites2===encs2.length, det:ouvFaites2+'/'+encs2.length},
    {lbl:'Distribution', ok:distribLignes.length>0, det:distribLignes.length+' j.'},
    {lbl:'Refroidissements', ok:(S['enr01']?.lignes||[]).filter(r=>r._statut==='en_attente').length===0, det:'Sans retard'},
    {lbl:'Remises T°C', ok:_pFilter(S['enr02']?.lignes||[]).length>0, det:(S['enr02']?.lignes||[]).filter(r=>r.date?.startsWith(mois)).length+' fiche(s)'},
    {lbl:'Réceptions', ok:recep.filter(r=>r.conforme==='NON').length===0, det:recep.length+' réc.'},
    {lbl:'Nettoyage', ok:(S.nett_val||[]).filter(v=>v.date?.startsWith(mois)&&v.conforme==='OUI').length>=5, det:(S.nett_val||[]).filter(v=>v.date?.startsWith(mois)).length+' val.'},
    {lbl:'Thermomètres', ok:(S['enr26']?.lignes||[]).some(r=>r.date?.startsWith(mois)), det:'Contrôle mensuel'},
    {lbl:'Traçabilité', ok:(S['enr31']?.lignes||[]).filter(r=>r.date?.startsWith(mois)).length>0, det:(S['enr31']?.lignes||[]).filter(r=>r.date?.startsWith(mois)).length+' saisie(s)'},
    {lbl:'NC traitées', ok:(S['enr30']?.lignes||[]).filter(r=>r.date?.startsWith(mois)&&r.action).length===(S['enr30']?.lignes||[]).filter(r=>r.date?.startsWith(mois)).length, det:(S['enr30']?.lignes||[]).filter(r=>r.date?.startsWith(mois)).length+' NC'},
    {lbl:'Plats témoins', ok:enr33Mois.length>0, det:enr33Mois.length+' enr.'},
  ];
  const nbOk=criteres.filter(c=>c.ok).length;
  const score=Math.round(nbOk/criteres.length*100);
  const scoreCol=score>=80?'#2e7d32':score>=60?'#f57f17':'#c62828';

  // Résumé activité par section
  const ALL_SECS=[
    {id:'enr01',lbl:'❄️ Refroidissements'},{id:'enr02',lbl:'🔥 Remises T°C'},{id:'enr03',lbl:'🔄 Refroid.+Remise'},
    {id:'enr04',lbl:'🥩 Steaks hachés'},{id:'enr05',lbl:'🍟 Fritures'},{id:'enr23',lbl:'📦 Réceptions'},
    {id:'enr26',lbl:'🌡️ Thermomètres'},{id:'enr29',lbl:'👥 Sensibilisation'},{id:'enr30',lbl:'🚨 NC'},
    {id:'enr31',lbl:'📋 Traçabilité'},{id:'enr33',lbl:'🍱 Plats témoins'},{id:'enr36',lbl:'♻️ Excédents'},
  ];
  const recapRows=ALL_SECS.map(s=>{
    const nb=(S[s.id]?.lignes||[]).filter(r=>r.date?.startsWith(mois)).length;
    const nbNC=(S[s.id]?.lignes||[]).filter(r=>r.date?.startsWith(mois)&&r.conforme==='NON').length;
    return `<tr><td>${s.lbl}</td><td style="text-align:center">${nb||'—'}</td>
      <td style="text-align:center" class="${nbNC>0?'nc':nb>0?'ok':''}">${nbNC>0?nbNC+' ⚠️':nb>0?'✓':'—'}</td></tr>`;
  });

  const body=`
  <h2 style="color:#5C1E5A;border-color:#e0d0e0">✅ Tableau de bord — ${moisLabel}</h2>
  <div class="check-grid">
    ${criteres.map(cr=>`<div class="check-item ${cr.ok?'ok':'fail'}">
      <span style="font-size:15px">${cr.ok?'✅':'❌'}</span>
      <div><div class="check-lbl">${cr.lbl}</div><div class="check-det">${cr.det}</div></div>
    </div>`).join('')}
  </div>

  <h2 style="color:#5C1E5A;border-color:#e0d0e0">📊 Activité par section — ${moisLabel}</h2>
  <table><thead><tr><th>Section</th><th style="text-align:center">Saisies</th><th style="text-align:center">NC</th></tr></thead>
  <tbody>${recapRows.join('')}</tbody></table>

  <h2 style="color:#5C1E5A;border-color:#e0d0e0">🌡️ T°C Enceintes — ${moisLabel}</h2>
  ${encTable}
  <h2 style="color:#5C1E5A;border-color:#e0d0e0">🌡️ Distribution — ${moisLabel}</h2>
  ${distribAllHtml}
  <h2 style="color:#5C1E5A;border-color:#e0d0e0">🚨 Non-conformités — ${moisLabel}</h2>
  ${ncTable}
  ${nettMois.length?'<h2 style="color:#1565c0;border-color:#bbdefb">🧹 Nettoyage — '+moisLabel+'</h2>'+pdfTable(nettMois):''}
  ${(()=>{
    const bilan=fourcBilanMois(mois);
    if(!bilan.length) return '';
    const rows=bilan.map(f=>`<tr>
      <td><strong>${escH(f.nom)}</strong>${f.notes?'<br><span style="font-size:9px;color:#888">'+escH(f.notes)+'</span>':''}</td>
      <td style="text-align:center">${f.jours}</td>
      <td style="text-align:center">${f.attendus}</td>
      <td style="text-align:center" class="${f.faites>0?'ok':''}">${f.faites}</td>
      <td style="text-align:center" class="${f.manquantes>0?'nc':''}">${f.manquantes>0?f.manquantes+' ⚠️':'✓'}</td>
      <td style="text-align:center" class="${f.taux>=80?'ok':'nc'}">${f.taux}%</td>
    </tr>`).join('');
    return `<h2 style="color:#5C1E5A;border-color:#e0d0e0">🚚 Suivi fournisseurs — ${moisLabel}</h2>
    <table><thead><tr><th>Fournisseur</th><th>Jours livraison</th><th style="text-align:center">Attendues</th><th style="text-align:center">Reçues</th><th style="text-align:center">Manquantes</th><th style="text-align:center">Taux</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
  })()}
  ${_pdfSig(respName,respRole,sigDataURL)}`;

  return _pdfWrap('📋 Rapport Général HACCP','#5C1E5A',site,code,mois,moisLabel,dateGen,body,
    _pdfScoreBadge(score,scoreCol,'Score global'));
}

// ════════════════════════════════════════════════════
// PDF HACCP — Températures & CCP
// ════════════════════════════════════════════════════
function buildHaccpPDF(site,code,mois,moisLabel,dateGen,respName,respRole,sigDataURL,
  fmtDate,fmtT,conf,encTable,distribAllHtml,ref01Table,recepTable,ncTable,
  enr04Mois,enr05Mois,enr33Mois,pdfTable){

  const ligEnr02=(S['enr02']?.lignes||[]).filter(r=>r.date?.startsWith(mois));
  const ligEnr03=_pFilter(S['enr03']?.lignes||[]);
  const ligEnr01=_pFilter(S['enr01']?.lignes||[]);
  const encs=getEnceintes();
  const saisies=S['enr19']?.saisies||[];
  const encNC=saisies.filter(r=>r.date?.startsWith(mois)&&encConforme(r.temp,
    encs.find(e=>e.id===r.enc_id)?.consigne)===false).length;
  const distribNC=(S['enr_tc_distrib']?.lignes||[]).filter(r=>r.date?.startsWith(mois)&&
    (r.midi_froid_conf==='NON'||r.midi_chaud_conf==='NON'||r.soir_froid_conf==='NON'||r.soir_chaud_conf==='NON')).length;
  const refNC=ligEnr01.filter(r=>r.conf_r==='NON'||r.conforme==='NON').length;
  const recepLig=(S['enr23']?.lignes||[]).filter(r=>r.date?.startsWith(mois));
  const recepNC=recepLig.filter(r=>r.conforme==='NON').length;

  // Score HACCP : basé sur taux de conformité CCP
  const haccpCriteres=[
    {lbl:'T°C enceintes', ok:encNC===0, det:encNC===0?'Toutes conformes':encNC+' NC'},
    {lbl:'T°C distribution', ok:distribNC===0, det:distribNC===0?'Toutes conformes':distribNC+' NC'},
    {lbl:'Refroidissements CCP', ok:refNC===0&&ligEnr01.length>0, det:ligEnr01.length+' fiche(s)'+( refNC>0?' · '+refNC+' NC':'')},
    {lbl:'Remises en T°C', ok:ligEnr02.length>0, det:ligEnr02.length+' fiche(s)'},
    {lbl:'Réceptions', ok:recepNC===0&&recepLig.length>0, det:recepLig.length+' réc.'+( recepNC>0?' · '+recepNC+' NC':'')},
    {lbl:'Steaks hachés', ok:enr04Mois.length>0, det:enr04Mois.length+' fiche(s)'},
    {lbl:'Fritures', ok:enr05Mois.length>0, det:enr05Mois.length+' fiche(s)'},
    {lbl:'Plats témoins', ok:enr33Mois.length>0, det:enr33Mois.length+' fiche(s)'},
  ];
  const nbOkH=haccpCriteres.filter(c=>c.ok).length;
  const scoreH=Math.round(nbOkH/haccpCriteres.length*100);
  const scoreColH=scoreH>=80?'#b71c1c':scoreH>=60?'#e65100':'#7f0000';

  const remise02Table=ligEnr02.length?pdfTable(ligEnr02):'<p class="empty">Aucune donnée</p>';
  const remise03Table=ligEnr03.length?pdfTable(ligEnr03):'';

  const body=`
  <h2 style="color:#c62828;border-color:#ffcdd2">🔴 Points Critiques CCP — ${moisLabel}</h2>
  <div class="check-grid">
    ${haccpCriteres.map(cr=>`<div class="check-item ${cr.ok?'ok':'fail'}">
      <span style="font-size:15px">${cr.ok?'✅':'❌'}</span>
      <div><div class="check-lbl">${cr.lbl}</div><div class="check-det">${cr.det}</div></div>
    </div>`).join('')}
  </div>

  <h2 style="color:#c62828;border-color:#ffcdd2">🌡️ T°C Enceintes — ${moisLabel}</h2>
  <p style="font-size:10px;color:#666;margin-bottom:5px">BOF/Viandes 0→+3°C · Légumes +4→+8°C · Négatif ≤-18°C</p>
  ${encTable}

  <h2 style="color:#c62828;border-color:#ffcdd2">🌡️ T°C Distribution — ${moisLabel}</h2>
  <p style="font-size:10px;color:#666;margin-bottom:5px">Froid ≤+10°C · Chaud ≥+63°C</p>
  ${distribAllHtml}

  <h2 style="color:#c62828;border-color:#ffcdd2">❄️ Refroidissements CCP — ${moisLabel}</h2>
  <p style="font-size:10px;color:#666;margin-bottom:5px">≤+10°C en 2h, ≤+3°C en 2h supplémentaires</p>
  ${ref01Table}

  <h2 style="color:#c62828;border-color:#ffcdd2">🔥 Remises en T°C — ${moisLabel}</h2>
  <p style="font-size:10px;color:#666;margin-bottom:5px">Atteindre ≥+63°C en ≤1h</p>
  ${remise02Table}${remise03Table}

  <h2 style="color:#c62828;border-color:#ffcdd2">📦 Réceptions — ${moisLabel}</h2>
  ${recepTable}

  ${enr04Mois.length?'<h2 style="color:#c62828;border-color:#ffcdd2">🥩 Steaks hachés — '+moisLabel+'</h2>'+pdfTable(enr04Mois):''}
  ${enr05Mois.length?'<h2 style="color:#c62828;border-color:#ffcdd2">🍟 Fritures — '+moisLabel+'</h2>'+pdfTable(enr05Mois):''}
  ${enr33Mois.length?'<h2 style="color:#c62828;border-color:#ffcdd2">🍱 Plats témoins — '+moisLabel+'</h2>'+pdfTable(enr33Mois):''}

  <h2 style="color:#c62828;border-color:#ffcdd2">🚨 Non-conformités — ${moisLabel}</h2>
  ${ncTable}
  ${(()=>{
    const bilan=fourcBilanMois(mois);
    if(!bilan.length) return '';
    const rows=bilan.map(f=>`<tr>
      <td>${escH(f.nom)}</td>
      <td style="text-align:center">${f.attendus}</td>
      <td style="text-align:center" class="${f.faites>0?'ok':''}">${f.faites}</td>
      <td style="text-align:center" class="${f.manquantes>0?'nc':''}">${f.manquantes>0?f.manquantes+' ⚠️':'✓'}</td>
    </tr>`).join('');
    return `<h2 style="color:#c62828;border-color:#ffcdd2">🚚 Réceptions fournisseurs — ${moisLabel}</h2>
    <table><thead><tr><th>Fournisseur</th><th style="text-align:center">Attendues</th><th style="text-align:center">Reçues</th><th style="text-align:center">Manquantes</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
  })()}
  ${_pdfSig(respName,respRole,sigDataURL)}`;

  return _pdfWrap('🌡️ Rapport HACCP — Températures & CCP','#c62828',site,code,mois,moisLabel,dateGen,body,
    _pdfScoreBadge(scoreH,scoreColH,'Score CCP'));
}

// ════════════════════════════════════════════════════
// PDF NETTOYAGE
// ════════════════════════════════════════════════════
function buildNettoyagePDF(site,code,mois,moisLabel,dateGen,respName,respRole,sigDataURL){
  const ref=nettRef();
  const valsTotal=S.nett_val||[];
  const valsMois=valsTotal.filter(v=>v.date?.startsWith(mois));
  const valsConf=valsMois.filter(v=>v.conforme==='OUI');
  const valsNC=valsMois.filter(v=>v.conforme==='NON');

  // Score nettoyage : éléments valides ce mois / total attendus (hors apres_usage)
  const attendus=ref.filter(it=>it.freq!=='apres_usage');
  const valides=attendus.filter(it=>valsTotal.some(v=>v.ref_id===it.id&&v.date?.startsWith(mois)&&v.conforme==='OUI'));
  const score=attendus.length?Math.round(valides.length/attendus.length*100):0;
  const scoreCol=score>=80?'#1565c0':score>=60?'#f57f17':'#c62828';

  // Score détaillé par fréquence
  const byFreq={quotidien:{att:0,ok:0},hebdo:{att:0,ok:0},mensuel:{att:0,ok:0}};
  ['quotidien','hebdo','mensuel'].forEach(f=>{
    const items=ref.filter(it=>it.freq===f);
    byFreq[f].att=items.length;
    byFreq[f].ok=items.filter(it=>valsTotal.some(v=>v.ref_id===it.id&&v.date?.startsWith(mois)&&v.conforme==='OUI')).length;
  });

  // Vue par zone
  const zones=[...new Set(ref.map(it=>it.zone))];
  const zoneRows=zones.map(zone=>{
    const items=ref.filter(it=>it.zone===zone);
    const rows=items.map(it=>{
      const lastVal=valsTotal.filter(v=>v.ref_id===it.id).sort((a,b)=>b._ts.localeCompare(a._ts))[0];
      const statut=lastVal?.date?.startsWith(mois)
        ?(lastVal.conforme==='OUI'?'ok':'nc')
        :'manquant';
      const lastInfo=lastVal
        ?(lastVal.date.slice(8,10)+'/'+lastVal.date.slice(5,7)+' '+( lastVal.heure||'')+' — '+(lastVal.cuisinier||''))
        :'—';
      return `<tr>
        <td>${escH(it.materiel)}</td>
        <td style="text-align:center">FREQ_ICO_${it.freq} ${NETT_FREQ_LABEL[it.freq]}</td>
        <td class="${statut==='ok'?'ok':statut==='nc'?'nc':''}" style="text-align:center">
          ${statut==='ok'?'✅ Conforme':statut==='nc'?'⚠️ NC':'— Non fait'}</td>
        <td style="font-size:10px">${lastInfo}</td>
      </tr>`;
    }).join('');
    const nbOkZ=items.filter(it=>valsTotal.some(v=>v.ref_id===it.id&&v.date?.startsWith(mois)&&v.conforme==='OUI')).length;
    return `<tr style="background:#f5edf5"><td colspan="4" style="font-weight:800;color:#5C1E5A;padding:7px 8px">
      📍 ${escH(zone)} — ${nbOkZ}/${items.length} validés</td></tr>${rows}`;
  }).join('');

  // Historique du mois trié
  const histoRows=[...valsMois].sort((a,b)=>b._ts.localeCompare(a._ts)).map(v=>{
    const it=ref.find(r=>r.id===v.ref_id)||{zone:'?',materiel:v.ref_id};
    return `<tr>
      <td>${v.date.slice(8,10)+'/'+v.date.slice(5,7)}</td>
      <td>${escH(it.zone)}</td>
      <td>${escH(it.materiel)}</td>
      <td class="${v.conforme==='OUI'?'ok':'nc'}">${v.conforme==='OUI'?'✅ OUI':'⚠️ NON'}</td>
      <td style="font-size:10px">${escH(v.cuisinier||'—')}${v.heure?' à '+v.heure:''}</td>
      <td style="font-size:10px">${escH(v.commentaire||'')}</td>
    </tr>`;
  }).join('');

  const scoreDetails=`<div class="score-detail">
    <span class="sd-item" style="background:#e8f5e9;color:#1b5e20">📅 Quotidien : ${byFreq.quotidien.ok}/${byFreq.quotidien.att}</span>
    <span class="sd-item" style="background:#e3f2fd;color:#1565c0">📆 Hebdo : ${byFreq.hebdo.ok}/${byFreq.hebdo.att}</span>
    <span class="sd-item" style="background:#f3e5f5;color:#6a1b9a">🗓️ Mensuel : ${byFreq.mensuel.ok}/${byFreq.mensuel.att}</span>
    ${valsNC.length>0?'<span class="sd-item" style="background:#ffebee;color:#c62828">⚠️ '+valsNC.length+' NC</span>':''}</div>`;

  const body=`
  <div style="margin-bottom:14px">${scoreDetails}</div>

  <h2 style="color:#1565c0;border-color:#bbdefb">📊 Bilan par zone — ${moisLabel}</h2>
  <table><thead><tr><th>Matériel</th><th>Fréquence</th><th style="text-align:center">Statut</th><th>Dernier nettoyage</th></tr></thead>
  <tbody>${zoneRows}</tbody></table>

  <h2 style="color:#1565c0;border-color:#bbdefb">📋 Historique complet — ${moisLabel}
    <span class="section-score" style="background:#e3f2fd;color:#1565c0">${valsMois.length} validations · ${valsConf.length} conf. · ${valsNC.length} NC</span>
  </h2>
  ${histoRows.length?
    `<table><thead><tr><th>Date</th><th>Zone</th><th>Matériel</th><th>Conf.</th><th>Cuisinier</th><th>Commentaire</th></tr></thead>
    <tbody>${histoRows}</tbody></table>`
    :'<p class="empty">Aucune validation ce mois</p>'}

  ${valsNC.length?
    `<h2 style="color:#c62828;border-color:#ffcdd2">⚠️ Non-conformités nettoyage — ${moisLabel}</h2>
    <table><thead><tr><th>Date</th><th>Zone</th><th>Matériel</th><th>Cuisinier</th><th>Commentaire</th></tr></thead>
    <tbody>${valsNC.map(v=>{const it=ref.find(r=>r.id===v.ref_id)||{zone:'?',materiel:'?'};
      return '<tr class="nc"><td>'+v.date.slice(8,10)+'/'+v.date.slice(5,7)+'</td><td>'+escH(it.zone)+'</td><td>'+escH(it.materiel)+'</td><td>'+escH(v.cuisinier||'—')+'</td><td>'+escH(v.commentaire||'')+'</td></tr>';
    }).join('')}</tbody></table>`
    :''}

  ${_pdfSig(respName,respRole,sigDataURL)}`;

  // Remplacer les placeholders FREQ_ICO
  const finalBody=body
    .replace(/FREQ_ICO_quotidien/g,'📅')
    .replace(/FREQ_ICO_hebdo/g,'📆')
    .replace(/FREQ_ICO_mensuel/g,'🗓️')
    .replace(/FREQ_ICO_apres_usage/g,'⚡');

  return _pdfWrap('🧹 Rapport Plan de Nettoyage','#1565c0',site,code,mois,moisLabel,dateGen,finalBody,
    _pdfScoreBadge(score,scoreCol,'Score nettoyage'));
}

// ════════════════════════════════════════════════════
// SAUVEGARDE JSON — Export / Import / Auto-backup
// ════════════════════════════════════════════════════
const BACKUP_KEY = 'haccp_v6_backup';
const BACKUP_TS_KEY = 'haccp_v6_backup_ts';

function exportJSON(){
  const site = getSiteName() || 'HACCP';
  const mois = S.config?.mois || today().slice(0,7);
  const data = JSON.stringify(S, null, 2);
  const blob = new Blob([data], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `HACCP_Sauvegarde_${site.replace(/\s+/g,'_')}_${mois}_${today()}.json`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 2000);
  toast('📥 Sauvegarde complète : données + config + plan de nettoyage téléchargés !');
}

function importJSON(input){
  const file = input.files[0];
  if(!file){ return; }
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      // Vérification basique
      if(typeof data !== 'object' || Array.isArray(data)){
        toast('⚠️ Fichier JSON invalide','warning'); return;
      }
      showConfirm(
        'Restaurer la sauvegarde ?',
        'Toutes les données actuelles seront remplacées par celles du fichier. Cette action est irréversible.',
        '📤 Restaurer',
        ()=>{
          // Sauvegarder l'état actuel avant d'écraser
          localStorage.setItem(BACKUP_KEY, JSON.stringify(S));
          localStorage.setItem(BACKUP_TS_KEY, new Date().toISOString());
          // Restaurer
          Object.assign(S, data);
          save();
          registerCustomPages();
          registerDistribSvcPages();
          renderNav();
          renderMain();
          closeSP();
          toast('✅ Données restaurées avec succès !');
        }
      );
    } catch(err){
      toast('⚠️ Erreur de lecture JSON : '+err.message,'warning');
    }
    input.value = ''; // reset pour permettre re-import du même fichier
  };
  reader.readAsText(file);
}

// Sections à scanner pour le sync Supabase
const SUPA_SCAN_SECTIONS = [
  // Standard : S[id].lignes
  'enr01','enr02','enr03','enr04','enr05','enr06','enr07','enr08','enr09','enr10',
  'enr11','enr12','enr13','enr14','enr15','enr16','enr17','enr18',
  'enr23','enr26','enr27','enr29','enr30','enr31','enr32','enr33',
  'enr34','enr35','enr36','enr39','enr52','enr53',
  'enr24','enr25',
];

function supaBackupSync() {
  // Appelée depuis autoBackup — enqueue tout ce qui n'a pas encore été envoyé
  try {
    if (!SupaEngine.isEnabled()) return;

    // Construire un Set des _ts déjà dans la queue (pending ou synced)
    const queue = SupaEngine._getQueueRaw ? SupaEngine._getQueueRaw() :
      (() => { try { return JSON.parse(localStorage.getItem('haccp_supa_queue_v1')||'[]'); } catch{ return []; } })();
    const knownTs = new Set(queue.map(e => e.data?._ts || e.recorded_at).filter(Boolean));

    let newCount = 0;

    // Scanner les sections standard
    SUPA_SCAN_SECTIONS.forEach(id => {
      const lignes = (S[id]?.lignes) || [];
      lignes.forEach(row => {
        if (!row._ts) return;
        if (knownTs.has(row._ts)) return; // déjà en queue
        SupaEngine.enqueue(id, row);
        knownTs.add(row._ts); // éviter les doublons dans ce scan
        newCount++;
      });
    });

    // ENR19 enceintes (structure saisies au lieu de lignes)
    const saisiesEnc = (S['enr19']?.saisies) || [];
    saisiesEnc.forEach(row => {
      if (!row._ts || knownTs.has(row._ts)) return;
      SupaEngine.enqueue('enr19', row);
      knownTs.add(row._ts);
      newCount++;
    });

    // ENR28 nettoyage (S.nett_val)
    const nettVal = S.nett_val || [];
    nettVal.forEach(row => {
      if (!row._ts || knownTs.has(row._ts)) return;
      SupaEngine.enqueue('enr28', {...row, _sec:'enr28'});
      knownTs.add(row._ts);
      newCount++;
    });

    // Pages custom (S.customPages)
    const customPages = S.customPages || [];
    customPages.forEach(cp => {
      const lignes = (S[cp.id]?.lignes) || [];
      lignes.forEach(row => {
        if (!row._ts || knownTs.has(row._ts)) return;
        SupaEngine.enqueue(cp.id, row);
        knownTs.add(row._ts);
        newCount++;
      });
    });

    // Services de distribution personnalisés (enr_distrib_svc_xxx)
    // Ces fiches sont créées dynamiquement via getDistribServices() et leurs ID
    // ne sont donc pas dans SUPA_SCAN_SECTIONS. On les scanne ici.
    const distribKeys = Object.keys(S).filter(k => k.startsWith('enr_distrib_'));
    distribKeys.forEach(key => {
      const lignes = (S[key]?.lignes) || [];
      lignes.forEach(row => {
        if (!row._ts || knownTs.has(row._ts)) return;
        SupaEngine.enqueue(key, row);
        knownTs.add(row._ts);
        newCount++;
      });
    });

    if (newCount > 0) {
      console.log(`[SupaBackupSync] ${newCount} nouvelle(s) ligne(s) enqueued depuis backup`);
    }
  } catch(e) {
    console.warn('[SupaBackupSync] erreur:', e);
  }
}

function autoBackup(){
  // Sauvegarde silencieuse dans localStorage (slot séparé)
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(S));
    const ts = new Date().toISOString();
    localStorage.setItem(BACKUP_TS_KEY, ts);
    // Mettre à jour l'affichage dans config
    const el = document.getElementById('sp-last-backup');
    if(el) el.textContent = new Date(ts).toLocaleString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
    // ── Supabase : enqueuer tout ce qui n'a pas encore été envoyé ──
    supaBackupSync();
  } catch(e){ console.warn('Auto-backup failed:', e); }
}

function initLastBackupDisplay(){
  const ts = localStorage.getItem(BACKUP_TS_KEY);
  const el = document.getElementById('sp-last-backup');
  if(el && ts){
    el.textContent = new Date(ts).toLocaleString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  }
}

// ════════════════════════════════════════════════════
// ENR07 — Bien Faits avec cuisson (mixage froid ET chaud)
// ════════════════════════════════════════════════════
function enr07s(k,v){S['enr07']=S['enr07']||{};S['enr07'].draft=S['enr07'].draft||{};S['enr07'].draft[k]=v;doAutoCalc('enr07');save();renderMain();}

// Slider T°C à plage personnalisée — appelle tpSet pour déclencher doAutoCalc
function tpHtmlR(id,sec,presets,label,tMin,tMax){
  const tRange=tMax-tMin;
  const stored=gd(id,sec);
  const numV=(stored!==undefined&&stored!==''&&!isNaN(parseFloat(stored)))?parseFloat(stored):null;
  const slV=numV!==null?Math.max(tMin,Math.min(tMax,numV)):Math.round((tMin+tMax)/2);
  const disp=numV!==null?((numV>=0?'+':'')+( numV%1===0?numV.toFixed(0):numV.toFixed(1))):'—';
  const pct=v=>((v-tMin)/tRange*100).toFixed(1)+'%';
  const axisPts=[[tMin,(tMin>=0?'+':'')+tMin+'°'],[Math.round((tMin+tMax)/2),(Math.round((tMin+tMax)/2)>=0?'+':'')+Math.round((tMin+tMax)/2)+'°'],[tMax,(tMax>=0?'+':'')+tMax+'°']];
  const axisH=axisPts.map(([t,l])=>`<span style="left:${pct(t)}">${l}</span>`).join('');
  const grad=tMin>=30
    ?'linear-gradient(to right,#fbbf24 0%,#f97316 40%,#ef4444 70%,#dc2626 100%)'
    :'linear-gradient(to right,#3b82f6 0%,#34d399 50%,#fbbf24 80%,#f87171 100%)';
  const presH=presets.map(p=>`<button class="tp-pre${numV===p?' on':''}" onclick="tpSet('${id}','${sec}',${p})">${p>=0?'+':''}${p}°C</button>`).join('');
  return`<div class="fg full">
    ${label?`<label>${label}</label>`:''}
    <div class="tp" id="tp-${id}-${sec}" style="--tp-grad:${grad}">
      <div class="tp-disp" id="td-${id}-${sec}" data-qt="f" data-qi="${id}" data-qs="${sec}" data-qn="${tMin}" data-qx="${tMax}" onclick="qtTap(this)" style="cursor:pointer">${disp}<sub>°C</sub></div>
      <div class="tp-wrap">
        <input type="range" class="tp-slider" id="ts-${id}-${sec}"
          min="${tMin}" max="${tMax}" step="0.1" value="${slV}"
          style="background:${grad}"
          oninput="tpSet('${id}','${sec}',parseFloat(this.value))"
          onchange="tpSet('${id}','${sec}',parseFloat(this.value))">
        <div class="tp-axis">${axisH}</div>
      </div>
      <div class="tp-manual"><span style="font-size:.74rem;color:#b89ab6;font-weight:700">Tap :</span><div id="tm-${id}-${sec}" class="qt-fake-inp" data-qt="f" data-qi="${id}" data-qs="${sec}" data-qn="${tMin}" data-qx="${tMax}" onclick="qtTap(this)">${numV!==null?(numV%1===0?numV.toFixed(0):numV.toFixed(1)):''}</div><span style="font-size:1rem;font-weight:800;color:var(--gris2)">°C</span></div>
      <div class="tp-presets">${presH}</div>
    </div>
  </div>`;
}

function renderENR07(){
  const SEC='enr07';
  // Pre-fill draft avant lecture pour que tdiff fonctionne dès la 1ère saisie h_fin
  S[SEC]=S[SEC]||{};S[SEC].draft=S[SEC].draft||{};
  if(!S[SEC].draft.date)  S[SEC].draft.date=today();
  if(!S[SEC].draft.h_deb) S[SEC].draft.h_deb=nowT();
  const d=S[SEC].draft;
  const mode=d.mode_mixage||'froid';

  // Vérifier si un refroidissement BF Cuit actif bloque le mixage chaud
  // Blocage mixage chaud : ENR01 lié BF Cuit EN ATTENTE (pas encore traité)
  const _bfCuitActif = ((S['enr01']||{}).lignes||[]).some(r=>
    r._lienBF==='cuit' && !r._deleted &&
    (!r._statut || r._statut==='en_attente') &&
    r._lienBF!=='traite'
  );
  const _blocChaud = _bfCuitActif;

  // Sélecteur de mode
  const modeSelector=`
    ${_blocChaud?`<div style="background:#fff3cd;border:1.5px solid #f59e0b;border-radius:10px;padding:9px 12px;margin-bottom:10px;font-size:.76rem;font-weight:700;color:#92400e">
      ⚠️ Produit refroidi après cuisson (ENR01 → BF Cuit) détecté.<br>
      <span style="font-weight:800">Mixage chaud désactivé</span> — obligatoire : mixer froid, puis remise en T°C (ENR02).
    </div>`:''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
      <button onclick="enr07s('mode_mixage','froid')" style="padding:11px 8px;border-radius:12px;border:2.5px solid ${mode==='froid'?'#1565c0':'var(--brd)'};background:${mode==='froid'?'#e3f2fd':'var(--fond)'};font-size:.85rem;font-weight:800;cursor:pointer;color:${mode==='froid'?'#1565c0':'#aaa'};font-family:inherit;transition:.15s">
        🧊 Mixage froid<br><span style="font-size:.7rem;font-weight:600">Produit ≤ +3°C</span>
      </button>
      <button ${_blocChaud?'disabled':''}onclick="${_blocChaud?'toast(\'⛔ Mixage chaud interdit — produit refroidi après cuisson. Utiliser mixage froid.\',\'error\')':'enr07s(\'mode_mixage\',\'chaud\')'}" style="padding:11px 8px;border-radius:12px;border:2.5px solid ${_blocChaud?'#9ca3af':mode==='chaud'?'#c62828':'var(--brd)'};background:${_blocChaud?'#f3f4f6':mode==='chaud'?'#fff3e0':'var(--fond)'};font-size:.85rem;font-weight:800;cursor:${_blocChaud?'not-allowed':'pointer'};color:${_blocChaud?'#9ca3af':mode==='chaud'?'#c62828':'#aaa'};font-family:inherit;transition:.15s;opacity:${_blocChaud?'.5':'1'}">
        🔥 Mixage chaud<br><span style="font-size:.7rem;font-weight:600">${_blocChaud?'⛔ Interdit':'Produit ≥ +63°C'}</span>
      </button>
    </div>`;

  const regle=mode==='froid'
    ?`<div class="regle">Mixage <strong>froid</strong> : T°C ≤ +3°C au départ, durée max <strong>10 min</strong>, cuisson fin ≥ <strong>+75°C</strong>.</div>`
    :`<div class="regle" style="border-left-color:#e65100;background:#fff8f0">Mixage <strong>chaud</strong> : T°C ≥ +63°C tout au long, durée max <strong>10 min</strong>, cuisson fin ≥ <strong>+75°C</strong>.</div>`;

  // Champs de conformité via cfEl — génère les data-cg pour doAutoCalc
  const fconf=(id,label)=>cfEl({id,label,type:'conf',auto:true},SEC);

  return `<div class="card">
    <div class="card-title">🥘 Bien Faits – avec cuisson <span class="tag prpo">PrPo</span></div>
    ${regle}

    <div class="fg-label">Nouvelle saisie</div>
    ${modeSelector}

    <div class="fgrid">
      <div class="fg"><label>Date</label>
        <button class="dp-trigger" id="dpf-date-enr07" onclick="openDP('${d.date||today()}', (v)=>{enr07s('date',v);const el=document.getElementById('dpf-date-enr07');if(el){el.querySelector('.dp-val').textContent=new Date(v+'T12:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'});el.querySelector('.dp-val').classList.remove('empty');}},{max:'${today()}'})">
        <span class="dp-ico">📅</span>
        <span class="dp-val">${new Date((d.date||today())+'T12:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'})}</span>
        <span style="font-size:.7rem;color:#c0a0c0">▼</span>
      </button>
      </div>
    </div>
    <div class="fgrid">
      ${acHtml('produit',SEC,'Produit','Nom du produit…')}
    </div>

    ${mode==='froid' ? `
    <div class="fgrid">
      ${tpHtmlR('t_deb',SEC,[-5,-2,0,1,2,3],'T°C début mixage',-5,15)}
      ${fconf('conf_deb','Début ≤ +3°C ?')}
    </div>` : `
    <div class="fgrid">
      ${tpHtmlR('t_mix_deb',SEC,[60,63,65,70,75,80],'T°C mixage début',40,100)}
      ${fconf('conf_mix_deb','Début ≥ +63°C ?')}
    </div>
    <div class="fgrid">
      ${tpHtmlR('t_mix_fin',SEC,[60,63,65,70,75,80],'T°C mixage fin',40,100)}
      ${fconf('conf_mix_fin','Fin ≥ +63°C ?')}
    </div>`}

    <div class="fgrid">
      ${timeBtnHtml('h_deb',SEC,'Heure début mixage',true)}
      ${timeBtnHtml('h_fin',SEC,'Heure fin mixage')}
    </div>
    <div class="fgrid">
      <div class="fg computed"><label>🔄 Durée mixage (auto)</label>
        <div class="fi-auto" data-cd="duree">${d.duree||'—'}</div></div>
      ${fconf('conf_duree','Durée ≤ 10 min ?')}
    </div>

    <div class="fgrid">
      ${tpHtmlR('t_cuisson',SEC,[68,70,75,78,80,85],'T°C fin de cuisson',40,100)}
      ${fconf('conf_cuisson','Cuisson ≥ +75°C ?')}
    </div>

    <div class="fgrid">
      ${chefSel('cuisinier',SEC,'Cuisinier / Visa')}
    </div>

    <div id="ccp-timer-enr07"></div>

    <div class="btn-row">
      <button class="btn-save" onclick="saveRow('enr07')">✅ Enregistrer</button>
      <button class="btn btn-sec" onclick="clearRow('enr07')">🔄 Effacer</button>
    </div>
  </div>
  ${renderHistoCard('enr07')}`;
}

// ════════════════════════════════════════════════════
// REGISTER ALL RENDERERS
// ════════════════════════════════════════════════════
const REND={
  accueil:renderAccueil,
  search:renderSearch,
  enr01:renderENR01,
  enr19:renderENR19,
  enr23:renderENR23,
  enr28:renderENR28,
  enr30:renderENR30,
  enr_tc_distrib:renderENR_TC_DISTRIB,
  enr_allergenes:renderAllergenes,
  enr20:renderENR20,
  enr21:renderENR21,
  enr24:makeFR(FDEFS['enr24']),
  enr25:makeFR(FDEFS['enr25']),
};

// ── Surcharge ENR05/ENR06 avec bloc huile (dépend de REND/FDEFS) ──
function makeHuileFR(defId) {
  return () => {
    const def = FDEFS[defId];
    const tagH = `<span class="tag prpo">PrPo</span>`;
    return `
      ${huileAlertBlock()}
      <div class="card">
        <div class="card-title">${def.title} ${tagH}</div>
        <div class="regle">${def.regle}</div>
        <div class="fg-label">Nouvelle saisie</div>
        ${renderFields(def.fields, def.id)}
        <div class="btn-row">
          <button class="btn-save" onclick="saveRow('${def.id}')">✅ Enregistrer</button>
          <button class="btn btn-sec" onclick="clearRow('${def.id}')">🔄 Effacer</button>
        </div>
      </div>
      ${renderHistoCard(def.id, def.fields)}`;
  };
}
REND['enr05'] = makeHuileFR('enr05');
REND['enr06'] = makeHuileFR('enr06');

// Register all FDEFS as generic forms

// ════════════════════════════════════════════════════
// SYNC CLOUD COMPLET — Tout S dans Supabase
// Le PMS est identique sur tous les appareils
// ════════════════════════════════════════════════════

// Clés de config à stocker dans sites.config (pas dans pms_records)
const CONFIG_KEYS = [
  'config',        // chefs, thème, poubelles, nom, logo, services distrib...
  'chefPins',      // codes PIN par cuisinier
  'chefPrefs',     // préférences cuisinier
  'chefSchedule',  // planning cuisiniers
  'navCfg',        // ordre des fiches
  'customPages',   // pages personnalisées
  'nett_ref',      // plan de nettoyage
  'nett_zones_extra', // zones nettoyage extra
  'fournisseurs',  // liste fournisseurs + jours livraison
  'produits',      // catalogue produits
  '_navCollapsed', // état nav
  'expCfg',        // config exports
  'adminPin',      // code admin
  'adminQ',        // question sécurité admin
  'adminA',        // réponse sécurité admin
  'menus',         // menus du jour (multi-dates × services) — v36
  'menu_history',  // historique des menus enregistrés — v36
];

// Clés de saisies à stocker dans pms_records (avec date)
const SAISIE_SECTIONS = [
  'enr01','enr02','enr03','enr04','enr05','enr06','enr07',
  'enr19','enr20','enr21','enr23','enr24','enr25','enr26','enr28','enr30','enr31','enr33','enr34','enr36','enr39','enr52','enr53',
  'enr_allergenes','enr_tc_distrib','nett_val','nuisibles_val','notes_home','nc_auto_pending',
];

async function _loadFromSupabase() {
  const c = SupaEngine.cfg();
  if (!c.url || !c.anonKey || !c.siteId) return;

  // ── Purge forcée si nouvelle version de données ──────────────────────────
  const DATA_PURGE_VERSION = '17s';
  const lastPurgeVer = localStorage.getItem('haccp_data_purge_ver') || '';
  if (lastPurgeVer !== DATA_PURGE_VERSION) {
    const PURGE_SAISIES_BOOT = [
      'enr01','enr02','enr03','enr04','enr05','enr06','enr07','enr08','enr09','enr10','enr11','enr12','enr13','enr14','enr15','enr16','enr17','enr18','enr19','enr23','enr26','enr27','enr28','enr29','enr30','enr31','enr32','enr33','enr34','enr35','enr36','enr39','enr52','enr53','enr24','enr25','enr_allergenes','enr_tc_distrib','nc_auto_pending',
    ];
    const _S = JSON.parse(localStorage.getItem('haccp_v6') || '{}');
    PURGE_SAISIES_BOOT.forEach(key => {
      if (key==='enr19') {
        const encSaved = _S['enr19']?.enceintes; // préserver la config enceintes
        _S[key]={saisies:[]}; S[key]={saisies:[]};
        if (encSaved) { _S['enr19'].enceintes = encSaved; S['enr19'].enceintes = encSaved; }
      }
      else if (key==='nc_auto_pending') { _S[key]=[]; S[key]=[]; }
      else { _S[key]={lignes:[]}; S[key]={lignes:[]}; }
    });
    _S.nett_val=[]; _S.nuisibles_val=[]; S.nett_val=[]; S.nuisibles_val=[];
    Object.keys(_S).filter(k=>k.startsWith('enr_distrib_')).forEach(k=>{ _S[k]={lignes:[]}; S[k]={lignes:[]}; });
    // Pages custom : vider les saisies de chaque fiche créée dynamiquement
    (_S.customPages||[]).forEach(cp=>{ if(cp.id){ _S[cp.id]={lignes:[]}; S[cp.id]={lignes:[]}; } });
    localStorage.setItem('haccp_v6', JSON.stringify(_S));
    localStorage.setItem('haccp_data_purge_ver', DATA_PURGE_VERSION);
    localStorage.removeItem('haccp_last_user_email');
    localStorage.removeItem('haccp_last_site_id');
    // Vider aussi le nom/code établissement pour forcer rechargement depuis Supabase
    if (S.config) { S.config.etab = ''; S.config.code = ''; }
    if (_S.config) { _S.config.etab = ''; _S.config.code = ''; }
    localStorage.setItem('haccp_v6', JSON.stringify(_S));
    console.log('[HACCPro] Purge v'+DATA_PURGE_VERSION+' — données locales réinitialisées');
  }

  // ── Détecter un changement de site OU d'utilisateur (tablette réassignée / compte changé) ──
  const lastSiteKey = 'haccp_last_site_id';
  const lastUserKey = 'haccp_last_user_email';
  const lastSite  = localStorage.getItem(lastSiteKey) || '';
  const lastUser  = localStorage.getItem(lastUserKey) || '';
  const currentSite = (c.siteId || '').toUpperCase();
  const currentUser = (c.userEmail || '').toLowerCase();
  const siteChanged = lastSite !== currentSite;
  const userChanged = currentUser && lastUser && lastUser !== currentUser;

  // Ne pas reset ici — le reset est fait DANS le try{} après chargement cloud réussi
  // (évite de perdre les données si le cloud est inaccessible)
  const isFirstTime = siteChanged && !lastSite;
  localStorage.setItem(lastSiteKey, currentSite);
  if (currentUser) localStorage.setItem(lastUserKey, currentUser);

  const headers = {
    'apikey': c.anonKey,
    'Authorization': `Bearer ${c.userToken || c.anonKey}`,
    'Accept': 'application/json'
  };

  try {
    // ── 0. Référentiel actions correctives HACCP (catalogue + mapping) ──
    await loadCorrectiveActionsCatalog(true);

    // ── 1. Config du site : cuisiniers, fournisseurs, thème, etc. ──
    const siteRes = await fetch(
      `${c.url}/rest/v1/sites?code=eq.${encodeURIComponent(c.siteId)}&select=name,config&limit=1`,
      { headers }
    );
    if (siteRes.ok) {
      const sites = await siteRes.json();
      const site = sites?.[0];
      if (site) {
        // Config cloud — écraser le local (cloud = source de vérité)
        const cloud = site.config || {};
        // ── Reset config si changement de site OU d'utilisateur (APRÈS avoir le cloud en main) ──
        if (siteChanged || userChanged) {
          if (userChanged) console.log('[_loadFromSupabase] Compte changé ('+lastUser+' → '+currentUser+') — purge localStorage');
          const PURGE_SAISIES = [
            'enr01','enr02','enr03','enr04','enr05','enr06','enr07','enr08','enr09','enr10','enr11','enr12','enr13','enr14','enr15','enr16','enr17','enr18','enr19','enr23','enr26','enr27','enr28','enr29','enr30','enr31','enr32','enr33','enr34','enr35','enr36','enr39','enr52','enr53','enr24','enr25','enr_allergenes','enr_tc_distrib','nc_auto_pending',
          ];
          PURGE_SAISIES.forEach(key => {
            if (key==='enr19') {
              const encSaved2 = S['enr19']?.enceintes;
              S['enr19'] = {saisies:[]};
              if (encSaved2) S['enr19'].enceintes = encSaved2;
            }
            else if (key==='nc_auto_pending') { S.nc_auto_pending=[]; }
            else { S[key] = {lignes:[]}; }
          });
          S.nett_val = []; S.nuisibles_val = [];
          Object.keys(S).filter(k=>k.startsWith('enr_distrib_')).forEach(k=>{ S[k]={lignes:[]}; });
          (S.customPages||[]).forEach(cp=>{ if(cp.id) S[cp.id]={lignes:[]}; });
          // Reset config UNIQUEMENT si changement de site (pas juste de compte)
          // Le cloud écrasera juste en-dessous — si cloud vide on pousse le local
          if (siteChanged) {
            // FIX v36 : ne plus vider produits/fournisseurs (le dico s'effaçait à chaque reco)
            // S.produits et S.fournisseurs sont conservés ; le cloud les écrasera s'il en a.
            S.nett_ref = []; S.nett_zones_extra = [];
            S.chefPins = {}; S.chefPrefs = {}; S.chefSchedule = {};
            if (S.config) {
              S.config.chefs = [];
              S.config.distribServices = null;
              S.config.wgDistribSeen = {};
              if (Array.isArray(S.config.homeWidgets))
                S.config.homeWidgets = S.config.homeWidgets.filter(w=>!w.id?.startsWith('d_'));
            }
            if (S['enr19']) S['enr19'].enceintes = [];
          }
          if (!isFirstTime) toast(userChanged ? '🔄 Compte changé — rechargement des données…' : '🔄 Site changé — chargement du nouveau site…', 'info');
        }
        // ── Nom établissement : APRÈS la purge pour qu'il ne soit pas écrasé ──
        // site.name vient de la table sites (source de vérité), config.code vient du siteId
        S.config = S.config || {};
        if (site.name) S.config.etab = site.name;
        if (c.siteId) S.config.code = c.siteId;
        // Forcer l'application si cloud a une valeur (même si S[key] est déjà défini)
        CONFIG_KEYS.forEach(key => {
          // Pour nett_ref: appliquer si cloud a des données (même si S.nett_ref=[])
          if (key === 'nett_ref') {
            if (Array.isArray(cloud[key]) && cloud[key].length > 0) {
              S.nett_ref = cloud[key];
            }
            return;
          }
          if (cloud[key] === undefined) return;
          if (key === 'config') {
            S.config = S.config || {};
            const cc = cloud.config || {};
            Object.keys(cc).forEach(k => { if (cc[k] !== undefined) S.config[k] = cc[k]; });
          } else {
            S[key] = cloud[key];
          }
        });
      }
    }

    // ── 1b. Charger les cuisiniers du site depuis profiles Supabase ──
    // Remplace les chefs du localStorage qui peuvent venir d'un autre site
    if (c.siteId) {
      try {
        // Résoudre code site → UUID pour filtrer profiles
        let _siteUuid = null;
        try {
          const siteUuidRes = await fetch(
            `${c.url}/rest/v1/sites?code=eq.${encodeURIComponent(c.siteId)}&select=id&limit=1`,
            { headers }
          );
          if (siteUuidRes.ok) {
            const siteUuidData = await siteUuidRes.json();
            _siteUuid = siteUuidData?.[0]?.id || null;
          }
        } catch(e) {}

        // Guard: charger cuisiniers UNIQUEMENT si UUID connu → jamais mélanger les sites
        const profsRes = _siteUuid ? await fetch(
          `${c.url}/rest/v1/profiles?role=in.(cuisinier,chef_secteur,directeur)&site_id=eq.${encodeURIComponent(_siteUuid)}&select=full_name&limit=100`,
          { headers }
        ) : null;
        if (profsRes && profsRes.ok) {
          const profs = await profsRes.json();
          if (Array.isArray(profs) && profs.length > 0) {
            const noms = profs.map(p => p.full_name).filter(Boolean);
            if (noms.length > 0) {
              S.config = S.config || {};
              // Fusionner avec les chefs manuels existants, en gardant la priorité cloud
              const manuels = (S.config.chefs_manuels || []);
              S.config.chefs = [...new Set([...noms, ...manuels])];
              save();
            }
          }
        }
      } catch(e) { console.warn('[cloud] chefs:', e); }
    }

    // ── 2. Saisies 6 mois depuis Supabase ──────────────
    const since = new Date(Date.now() - 186 * 24 * 3600 * 1000).toISOString();
    const recsRes = await fetch(
      `${c.url}/rest/v1/pms_records?site_id=eq.${encodeURIComponent(c.siteId)}&recorded_at=gte.${since}&order=recorded_at.desc&limit=5000`,
      { headers }
    );
    if (!recsRes.ok) throw new Error(`pms_records HTTP ${recsRes.status}`);

    const recs = await recsRes.json();
    if (!Array.isArray(recs)) throw new Error('Réponse invalide');

    // ── CLOUD = SOURCE DE VÉRITÉ ──
    // On vide toutes les saisies locales avant d'injecter le cloud
    // pour éviter tout doublon (le localStorage était un cache temporaire)
    const SAISIE_KEYS_TO_CLEAR = [
      'enr01','enr02','enr03','enr04','enr05','enr06','enr07','enr08','enr09','enr10','enr11','enr12','enr13','enr14','enr15','enr16','enr17','enr18','enr19','enr23','enr26','enr27','enr28','enr29','enr30','enr31','enr32','enr33','enr34','enr35','enr36','enr39','enr52','enr53','enr24','enr25','enr_allergenes','enr_tc_distrib','nc_auto_pending',
    ];
    // Vider les saisies (garder config/draft)
    SAISIE_KEYS_TO_CLEAR.forEach(key => {
      if (key === 'enr19') {
        if(S['enr19']) S['enr19'].saisies = []; // garder enceintes intactes
      }
      else if (key === 'nc_auto_pending') { S.nc_auto_pending = []; }
      else if (S[key]?.lignes) { S[key].lignes = []; }
    });
    S.nett_val = [];
    S.nuisibles_val = [];
    // Vider aussi les services distrib dynamiques
    getDistribServices().forEach(svc => {
      const k = 'enr_distrib_'+svc.id;
      if (S[k]?.lignes) S[k].lignes = [];
    });
    // Pages custom : vider les saisies de chaque fiche créée dynamiquement
    (S.customPages||[]).forEach(cp=>{ if(cp.id && S[cp.id]?.lignes) S[cp.id].lignes = []; });

    if (recs.length === 0) {
      save(); initTheme(); renderNav(); renderMain();
      if (typeof renderChefList === 'function') renderChefList();
      toast('☁️ PMS synchronisé (aucune saisie récente)', 'info');
      return;
    }

    // Grouper par enr_type
    const byType = {};
    recs.forEach(r => {
      if (!r.enr_type || !r.data) return;
      (byType[r.enr_type] = byType[r.enr_type]||[]).push(r);
    });

    Object.entries(byType).forEach(([sec, recsList]) => {
      const datas = recsList.map(r => ({...r.data, _ts: r.data._ts||r.recorded_at, _client_id: r.client_id}));

      // ── ENR19 : tableau saisies enceintes ──
      if (sec === 'enr19') {
        S['enr19'] = S['enr19'] || {};
        const existTs = new Set((S['enr19'].saisies||[]).map(l=>l._ts));
        const toAdd = datas.filter(d=>!existTs.has(d._ts));
        S['enr19'].saisies = [...toAdd, ...(S['enr19'].saisies||[])];
        return;
      }

      // ── nuisibles_val : tableau simple d'objets ──
      if (sec === 'nuisibles_val') {
        const existTs = new Set((S.nuisibles_val||[]).map(l=>l._ts));
        const toAdd = datas.filter(d=>!existTs.has(d._ts));
        S.nuisibles_val = [...toAdd, ...(S.nuisibles_val||[])];
        return;
      }

      // ── ENR28 nettoyage : tableau nett_val ──
      if (sec === 'enr28' || sec === 'nett_val') {
        const existTs = new Set((S.nett_val||[]).map(l=>l._ts));
        const toAdd = datas.filter(d=>!existTs.has(d._ts));
        S.nett_val = [...toAdd, ...(S.nett_val||[])];
        return;
      }

      // ── Distrib tc et services dynamiques ──
      if (sec === 'enr_tc_distrib' || sec.startsWith('enr_distrib_')) {
        S[sec] = S[sec] || {};
        const existTs = new Set((S[sec].lignes||[]).map(l=>l._ts));
        const toAdd = datas.filter(d=>!existTs.has(d._ts));
        S[sec].lignes = [...toAdd, ...(S[sec].lignes||[])];
        return;
      }

      // ── notes_home : objet simple ──
      if (sec === 'notes_home') {
        S.notes_home = datas[0]; return;
      }

      // ── ENR30 NC : gestion spéciale ──
      // En cas de mise à jour cloture, on veut la version la plus récente
      if (sec === 'enr30') {
        S['enr30'] = S['enr30'] || {};
        S['enr30'].lignes = S['enr30'].lignes || [];
        // Remplacer par les données cloud complètes (plus à jour)
        const cloudMap = {};
        datas.forEach(d => { if (d._ts) cloudMap[d._ts] = d; });
        // Mettre à jour les lignes existantes
        S['enr30'].lignes = S['enr30'].lignes.map(l =>
          l._ts && cloudMap[l._ts] ? {...cloudMap[l._ts]} : l
        );
        // Ajouter les nouvelles
        const localTs = new Set(S['enr30'].lignes.map(l=>l._ts));
        datas.filter(d=>!localTs.has(d._ts)).forEach(d => S['enr30'].lignes.unshift(stampEntry(d)));
        return;
      }

      // ── Cas général : section avec .lignes ──
      S[sec] = S[sec] || {};
      S[sec].lignes = S[sec].lignes || [];
      // Dédupliquer datas par _ts avant ajout (évite les doublons si Supabase en a)
      const seenTs = new Map();
      datas.forEach(d => { if(d._ts && !seenTs.has(d._ts)) seenTs.set(d._ts, d); });
      const datasDedup = [...seenTs.values()].filter(d => !d._deleted); // ignorer les supprimés
      const existTs = new Set(S[sec].lignes.map(l=>l._ts).filter(Boolean));
      // Supprimer en local les lignes que Supabase a marquées _deleted
      const deletedTs = new Set([...seenTs.values()].filter(d=>d._deleted).map(d=>d._ts));
      if(deletedTs.size>0) S[sec].lignes = S[sec].lignes.filter(l => !deletedTs.has(l._ts));
      const toAdd = datasDedup.filter(d => d._ts && !existTs.has(d._ts));
      S[sec].lignes = [...toAdd, ...S[sec].lignes];
      // ── Merger les flags de mise à jour (Supabase peut avoir reçu une version plus récente)
      // Flags mergés : _statut (ENR01 après réchauffe), _jete (ENR33 après destruction)
      const supaByTs = new Map(datasDedup.map(d=>[d._ts,d]));
      S[sec].lignes.forEach(l=>{
        if(!l._ts) return;
        const supa = supaByTs.get(l._ts);
        if(!supa) return;
        // _statut : propager si Supabase a une valeur "finale" et local a rien ou "en_attente"
        if(supa._statut && supa._statut!=='en_attente' && (!l._statut || l._statut==='en_attente')){
          l._statut = supa._statut;
        }
        // _jete : propager le flag destruction si Supabase l'a
        if(supa._jete && !l._jete){
          l._jete = true;
          if(supa._jete_date) l._jete_date = supa._jete_date;
          if(supa._jete_by) l._jete_by = supa._jete_by;
        }
      });
    });

    // ── Déduplication finale par _ts sur toutes les sections ──────────
    // Supprime les doublons qui auraient pu être insérés en base avant le fix
    Object.keys(S).forEach(sec => {
      if (!Array.isArray(S[sec]?.lignes) || S[sec].lignes.length < 2) return;
      const seen = new Map();
      S[sec].lignes.forEach(r => { if(r._ts && !seen.has(r._ts)) seen.set(r._ts, r); else if(!r._ts) seen.set(Math.random(), r); });
      if (seen.size < S[sec].lignes.length) {
        S[sec].lignes = [...seen.values()];
      }
    });
    // ENR19 saisies
    if (Array.isArray(S['enr19']?.saisies) && S['enr19'].saisies.length > 1) {
      const seen19 = new Map();
      S['enr19'].saisies.forEach(r => { if(r._ts && !seen19.has(r._ts)) seen19.set(r._ts, r); });
      S['enr19'].saisies = [...seen19.values()];
    }

    save();
    // ── Charger la config enceintes depuis pms_config (par site) ──
    // CRITIQUE : chaque site a ses propres enceintes stockées dans pms_config
    // Ne pas lire depuis le localStorage global qui peut contenir la config d'un autre site
    try {
      const encCfgRes = await fetch(
        `${c.url}/rest/v1/pms_config?site_id=eq.${encodeURIComponent(c.siteId)}&type=eq.enceintes&select=data&limit=1`,
        { headers }
      );
      if (encCfgRes.ok) {
        const encCfgData = await encCfgRes.json();
        const encList = encCfgData?.[0]?.data;
        if (Array.isArray(encList) && encList.length > 0) {
          // Écraser la config locale avec celle du site Supabase
          S['enr19'] = S['enr19'] || {};
          S['enr19'].enceintes = encList;
          save();
        }
        // Si aucune config en base → garder le local ET l'envoyer vers Supabase
        else if (!encCfgData?.[0]) {
          syncEnceinteConfig(getEnceintes());
        }
      }
    } catch(e) { console.warn('[cloud] pms_config enceintes:', e.message); }

    // Appliquer config par défaut si le site n'a pas encore de config
    applyDefaultConfigIfNeeded();
    initTheme();
    renderNav();
    renderMain();
    if (typeof renderChefList === 'function') renderChefList();

    // ── Marquer tous les _ts chargés depuis le cloud comme déjà synced ──
    // Évite que supaBackupSync() les re-enqueue et génère des "déjà en base"
    try {
      const qRaw = JSON.parse(localStorage.getItem('haccp_supa_queue_v1') || '[]');
      const knownQids = new Set(qRaw.map(e => e.qid));
      const c2 = SupaEngine.cfg();
      const toAdd = [];
      recs.forEach(r => {
        if (!r.enr_type || !r.data?._ts) return;
        const stableId = [c2.siteId, r.enr_type, r.data._ts]
          .join('::').replace(/[^a-zA-Z0-9:._-]/g, '_').slice(0, 200);
        if (!knownQids.has(stableId)) {
          toAdd.push({
            qid: stableId,
            enr_type: r.enr_type,
            data: r.data,
            recorded_at: r.data._ts,
            site_id: c2.siteId,
            tenant_id: c2.tenantId || null,
            status: 'synced',
            synced_at: new Date().toISOString(),
            retries: 0,
          });
          knownQids.add(stableId);
        }
      });
      if (toAdd.length > 0) {
        // Garder les synced des 6 derniers mois + les nouveaux + les pending/error existants
        const cutoff6m = new Date(Date.now() - 186 * 24 * 3600 * 1000).toISOString();
        const pending = qRaw.filter(e => e.status !== 'synced');
        const synced  = [...qRaw.filter(e => e.status === 'synced' && (e.recorded_at||'') >= cutoff6m), ...toAdd];
        localStorage.setItem('haccp_supa_queue_v1', JSON.stringify([...pending, ...synced]));
        console.log(`[_loadFromSupabase] ${toAdd.length} ts marqués synced → supaBackupSync ignorera ces lignes`);
      }
    } catch(e) { console.warn('[_loadFromSupabase] markSynced:', e); }

    // AutoBackup après le chargement cloud = checkpoint propre, un seul site
    autoBackup();
    save();
    renderNav(); renderMain();
    if (typeof renderChefList === 'function') renderChefList();
    toast(`☁️ ${recs.length} saisie(s) — 6 mois chargés depuis le cloud`, 'success');

    // Flag : le chargement initial a bien eu lieu → les saves vers cloud sont maintenant sûrs
    window._supaLoadDone = true;

  } catch(e) {
    console.warn('[_loadFromSupabase]', e);
    toast('⚠️ Erreur chargement cloud : '+e.message, 'warning');
  }
}

async function _saveConfigToSupabase() {
  const c = SupaEngine.cfg();
  if (!c.url || !c.anonKey || !c.siteId) return;

  // ── Protection anti-écrasement : ne pas sauvegarder tant que le chargement initial
  // depuis Supabase n'a pas réussi. Sinon on risque d'écraser le cloud avec un S vide.
  if (!window._supaLoadDone) {
    console.log('[save config cloud] SKIP — _loadFromSupabase pas encore terminé');
    return;
  }

  try {
    // ── Étape 1 : Lire le cloud ACTUEL avant d'écrire ──
    // Évite d'écraser des données cloud plus complètes avec un local partiel
    // (cas : tablette qui vient juste de démarrer, S pas encore rempli par _loadFromSupabase)
    let cloudCurrent = {};
    try {
      const readRes = await fetch(
        `${c.url}/rest/v1/sites?code=eq.${encodeURIComponent(c.siteId)}&select=config&limit=1`,
        {
          headers: {
            'apikey': c.anonKey,
            'Authorization': `Bearer ${c.userToken || c.anonKey}`,
            'Accept': 'application/json',
          }
        }
      );
      if (readRes.ok) {
        const sites = await readRes.json();
        cloudCurrent = sites?.[0]?.config || {};
      }
    } catch(e) { console.warn('[save config cloud] lecture préalable échouée', e); }

    // ── Étape 2 : Construire le merge (local prime si défini) ──
    // Pour chaque clé CONFIG_KEYS :
    //  - si local a la clé définie → on la pousse
    //  - sinon on garde la valeur cloud existante
    // Spécial pour 'config' : merge champ par champ
    const cloudConfig = { ...cloudCurrent }; // on part du cloud

    CONFIG_KEYS.forEach(key => {
      const localVal = S[key];
      if (localVal === undefined || localVal === null) {
        // local n'a pas la clé → garde la valeur cloud (rien à faire)
        return;
      }
      if (key === 'config' && typeof localVal === 'object') {
        // Merge field-by-field : le local prime si défini
        const cloudSub = (cloudCurrent.config && typeof cloudCurrent.config === 'object') ? cloudCurrent.config : {};
        const merged = { ...cloudSub };
        Object.keys(localVal).forEach(k => {
          if (localVal[k] !== undefined) merged[k] = localVal[k];
        });
        cloudConfig.config = merged;
      } else if (Array.isArray(localVal)) {
        // Arrays : si local est vide ET cloud ne l'est pas → garde le cloud
        // Évite d'écraser une liste cloud non vide par une liste locale vide
        const cloudArr = Array.isArray(cloudCurrent[key]) ? cloudCurrent[key] : [];
        if (localVal.length === 0 && cloudArr.length > 0) {
          cloudConfig[key] = cloudArr; // garde cloud
        } else {
          cloudConfig[key] = localVal;
        }
      } else if (typeof localVal === 'object') {
        // Objets : merge (ex chefPins, chefSchedule)
        const cloudObj = (cloudCurrent[key] && typeof cloudCurrent[key] === 'object') ? cloudCurrent[key] : {};
        cloudConfig[key] = { ...cloudObj, ...localVal };
      } else {
        cloudConfig[key] = localVal;
      }
    });

    // ── Étape 3 : Écrire le résultat mergé ──
    const r = await fetch(`${c.url}/rest/v1/sites?code=eq.${c.siteId}`, {
      method: 'PATCH',
      headers: {
        'apikey': c.anonKey,
        'Authorization': `Bearer ${c.userToken || c.anonKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ config: cloudConfig })
    });
    if(!r.ok) console.warn('[save config cloud] HTTP', r.status);
    else console.log('[save config cloud] OK (merged) →', c.siteId);
  } catch(e) { console.warn('[save config cloud]', e); }
}

// Sauvegarder config dans le cloud toutes les 5 min
setInterval(() => { if(SupaEngine.isEnabled()) _saveConfigToSupabase(); }, 5 * 60 * 1000);
// ════════════════════════════════════════════════════
const ALLERGENES_14 = [
  {id:'gluten',   ico:'🌾', label:'Gluten',          detail:'Blé, seigle, orge, avoine, épeautre…'},
  {id:'crustaces',ico:'🦐', label:'Crustacés',        detail:'Crevettes, crabes, homards, langoustines…'},
  {id:'oeufs',    ico:'🥚', label:'Œufs',             detail:'Tous les œufs et produits dérivés'},
  {id:'poissons', ico:'🐟', label:'Poissons',          detail:'Tous les poissons et produits à base de poisson'},
  {id:'arachides',ico:'🥜', label:'Arachides',         detail:'Cacahuètes et produits dérivés'},
  {id:'soja',     ico:'🫘', label:'Soja',              detail:'Fèves de soja et produits dérivés'},
  {id:'lait',     ico:'🥛', label:'Lait',              detail:'Lait et produits laitiers (lactose inclus)'},
  {id:'fruits_coq',ico:'🌰',label:'Fruits à coque',    detail:'Amandes, noisettes, noix, cajou, pistaches…'},
  {id:'celeri',   ico:'🥬', label:'Céleri',            detail:'Céleri rave, branche, graines, extraits'},
  {id:'moutarde', ico:'🟡', label:'Moutarde',          detail:'Graines, feuilles, fleurs, huile de moutarde'},
  {id:'sesame',   ico:'🪸', label:'Graines de sésame', detail:'Graines entières, huile, farine de sésame'},
  {id:'so2',      ico:'💨', label:'SO₂ / Sulfites',    detail:'Concentrations > 10mg/kg ou 10mg/L'},
  {id:'lupin',    ico:'🌼', label:'Lupin',             detail:'Farine de lupin, graines, produits dérivés'},
  {id:'mollusques',ico:'🐚',label:'Mollusques',         detail:'Moules, huîtres, escargots, calmars…'},
];

function renderAllergenes(){
  S['enr_allergenes'] = S['enr_allergenes'] || {};
  const hist = (S['enr_allergenes'].fiches||[]).slice().reverse();
  const draft = S['enr_allergenes'].draft || {};

  const allergenesHtml = ALLERGENES_14.map(a => {
    const val = draft['alg_'+a.id] || '';
    return `<div style="background:#fff;border:1.5px solid var(--brd);border-radius:12px;padding:10px 12px;margin-bottom:6px">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:1.3rem;flex-shrink:0">${a.ico}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:800;font-size:.85rem">${a.label}</div>
          <div style="font-size:.62rem;color:#9c7a9b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a.detail}</div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          ${['Présent','Traces','Absent'].map(v => `
            <button onclick="algSet('${a.id}','${v}');renderMain()"
              style="padding:5px 8px;border:1.5px solid ${val===v?(v==='Présent'?'#dc2626':v==='Traces'?'#d97706':'#16a34a'):'var(--brd)'};
                     background:${val===v?(v==='Présent'?'#fee2e2':v==='Traces'?'#fff7ed':'#f0fdf4'):'#f9f5f9'};
                     color:${val===v?(v==='Présent'?'#dc2626':v==='Traces'?'#d97706':'#16a34a'):'#9c7a9b'};
                     border-radius:8px;font-size:.62rem;font-weight:800;cursor:pointer;font-family:inherit">
              ${v==='Présent'?'⚠️':v==='Traces'?'〰️':'✓'} ${v}
            </button>`).join('')}
        </div>
      </div>
    </div>`;
  }).join('');

  const histHtml = hist.length ? hist.slice(0,5).map(f => {
    const presents = ALLERGENES_14.filter(a => f['alg_'+a.id]==='Présent').map(a=>a.ico+a.label);
    const traces = ALLERGENES_14.filter(a => f['alg_'+a.id]==='Traces').map(a=>a.ico+a.label);
    return `<div style="background:#fff;border:1.5px solid var(--brd);border-radius:12px;padding:12px 14px;margin-bottom:8px">
      <div style="font-size:.78rem;font-weight:800;color:var(--plum);margin-bottom:2px">📅 ${f.date||'—'} — ${f.plat||'Plat non défini'}</div>
      <div style="font-size:.68rem;color:#9c7a9b;margin-bottom:6px">${f.service||''}${f.cuisinier?' · 👤 '+f.cuisinier:''}</div>
      ${presents.length?`<div style="font-size:.72rem;margin-bottom:3px;color:#dc2626;font-weight:700">⚠️ Présents : ${presents.join(' · ')}</div>`:''}
      ${traces.length?`<div style="font-size:.72rem;margin-bottom:3px;color:#d97706;font-weight:700">〰️ Traces : ${traces.join(' · ')}</div>`:''}
      ${!presents.length&&!traces.length?`<div style="font-size:.72rem;color:#16a34a;font-weight:700">✓ Aucun allergène déclaré</div>`:''}
      ${f.observation?`<div style="font-size:.72rem;color:#5C1E5A;margin-top:4px;font-style:italic">💬 ${f.observation}</div>`:''}
    </div>`;
  }).join('') : `<div style="text-align:center;padding:20px;color:#b89ab6;font-size:.8rem">Aucune fiche enregistrée</div>`;

  return `<div class="card">
    <div class="card-title">⚠️ Allergènes <span style="font-size:.6rem;background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:8px;font-weight:800;vertical-align:middle">INCO 1169/2011</span></div>
    <div class="regle" style="margin-bottom:12px">Déclarez les 14 allergènes majeurs pour chaque plat. Obligatoire à chaque nouveau menu.</div>

    <div style="margin-bottom:10px">
      <div class="field-label">📅 Date</div>
      <input type="date" value="${draft.alg_date||today()}"
        onchange="algDraftSet('alg_date',this.value)"
        style="width:100%;padding:9px 12px;border:1.5px solid var(--brd);border-radius:10px;font-size:.85rem;font-family:inherit;box-sizing:border-box;background:#fff">
    </div>
    <div style="margin-bottom:10px">
      <div class="field-label">🍽️ Nom du plat / menu</div>
      <input type="text" placeholder="Ex: Blanquette de veau, menu du 31 mars…"
        value="${draft.plat||''}"
        oninput="algDraftSet('plat',this.value)"
        style="width:100%;padding:9px 12px;border:1.5px solid var(--brd);border-radius:10px;font-size:.85rem;font-family:inherit;box-sizing:border-box">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
      <div>
        <div class="field-label">👤 Cuisinier</div>
        <select onchange="algDraftSet('cuisinier',this.value)"
          style="width:100%;padding:9px 10px;border:1.5px solid var(--brd);border-radius:10px;font-size:.82rem;font-family:inherit;background:#fff">
          <option value="">— Sélectionner —</option>
          ${getChefs().map(c=>`<option value="${c}" ${draft.cuisinier===c?'selected':''}>${c}</option>`).join('')}
        </select>
      </div>
      <div>
        <div class="field-label">🍽️ Service</div>
        <select onchange="algDraftSet('service',this.value)"
          style="width:100%;padding:9px 10px;border:1.5px solid var(--brd);border-radius:10px;font-size:.82rem;font-family:inherit;background:#fff">
          ${['','Midi','Soir','Buffet','Pique-nique','Autre'].map(v=>`<option value="${v}" ${draft.service===v?'selected':''}>${v||'— Service —'}</option>`).join('')}
        </select>
      </div>
    </div>

    <div style="font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#9c7a9b;margin-bottom:8px">14 allergènes à déclarer</div>
    ${allergenesHtml}

    <div style="margin:10px 0">
      <div class="field-label">💬 Observation</div>
      <textarea placeholder="Ex: sauce contient traces de lait…"
        oninput="algDraftSet('observation',this.value)"
        style="width:100%;padding:9px 12px;border:1.5px solid var(--brd);border-radius:10px;font-size:.82rem;font-family:inherit;box-sizing:border-box;resize:vertical;min-height:60px">${draft.observation||''}</textarea>
    </div>

    <button class="btn-save" onclick="saveAllergenes()">✅ Enregistrer la fiche allergènes</button>
  </div>

  <div class="card" style="margin-top:10px">
    <div class="card-title">📋 Historique des fiches</div>
    ${histHtml}
  </div>`;
}

function algSet(id, val) {
  S['enr_allergenes'] = S['enr_allergenes'] || {};
  S['enr_allergenes'].draft = S['enr_allergenes'].draft || {};
  S['enr_allergenes'].draft['alg_'+id] = val;
  save();
}
function algDraftSet(key, val) {
  S['enr_allergenes'] = S['enr_allergenes'] || {};
  S['enr_allergenes'].draft = S['enr_allergenes'].draft || {};
  S['enr_allergenes'].draft[key] = val;
  save();
}
function saveAllergenes() {
  const draft = S['enr_allergenes']?.draft || {};
  if (!draft.plat) { toast('⚠️ Indiquez le nom du plat', 'warning'); return; }
  if (!draft.alg_date) draft.alg_date = today();

  // Compter les allergènes non déclarés
  const manquants = ALLERGENES_14.filter(a => !draft['alg_'+a.id]);
  if (manquants.length > 0) {
    if (!confirm(`⚠️ ${manquants.length} allergène(s) non renseigné(s) :\n${manquants.map(a=>a.label).join(', ')}\n\nEnregistrer quand même ?`)) return;
  }

  const fiche = {
    ...draft,
    date: draft.alg_date || today(),
    plat: draft.plat,
    cuisinier: draft.cuisinier || '',
    service: draft.service || '',
    _ts: new Date().toISOString(),
    _sec: 'enr_allergenes',
  };

  S['enr_allergenes'] = S['enr_allergenes'] || {};
  S['enr_allergenes'].fiches = S['enr_allergenes'].fiches || [];
  S['enr_allergenes'].fiches.unshift(fiche);
  S['enr_allergenes'].draft = {};
  save();
  autoBackup();

  // Sync Supabase
  try { SupaEngine.enqueue('enr_allergenes', fiche); } catch(e) {}

  toast('✅ Fiche allergènes enregistrée', 'success');
  goTo('enr_allergenes');
}
// ════════════════════════════════════════════════════
let _auditMPPeriod = 'mois';

function openAuditMP(){
  const ov = document.getElementById('audit-mp-ov');
  if(!ov) return;
  ov.style.opacity='1'; ov.style.pointerEvents='all';
  const box = document.getElementById('audit-mp-box');
  if(box) box.style.transform='translateY(0)';
  auditMPSetPeriod(_auditMPPeriod);
}

function closeAuditMP(){
  const ov = document.getElementById('audit-mp-ov');
  if(!ov) return;
  ov.style.opacity='0'; ov.style.pointerEvents='none';
  const box = document.getElementById('audit-mp-box');
  if(box) box.style.transform='translateY(100%)';
}

function auditMPSetPeriod(p){
  _auditMPPeriod = p;
  ['mois','15j','semaine','all'].forEach(k=>{
    const btn = document.getElementById('amp-pill-'+k);
    if(btn) btn.className = 'period-pill'+(k===p?' on':'');
  });
  renderAuditMP(p);
}

function _mpDateRange(period){
  const now = new Date();
  const todayStr = today();
  if(period==='semaine'){
    const dow=(now.getDay()+6)%7;
    const lun=new Date(now); lun.setDate(now.getDate()-dow);
    return {from:lun.toISOString().slice(0,10), to:todayStr,
      label:'Semaine du '+lun.toLocaleDateString('fr-FR',{day:'numeric',month:'long'})};
  }
  if(period==='15j'){
    const d15=new Date(now); d15.setDate(now.getDate()-14);
    return {from:d15.toISOString().slice(0,10), to:todayStr, label:'15 derniers jours'};
  }
  if(period==='mois'){
    const mois=S.config?.mois||todayStr.slice(0,7);
    const [y,m]=mois.split('-');
    const label=new Date(+y,+m-1,1).toLocaleDateString('fr-FR',{month:'long',year:'numeric'});
    const lastDay=new Date(+y,+m,0).toISOString().slice(0,10);
    return {from:mois+'-01', to:lastDay, label};
  }
  return {from:'1970-01-01', to:'9999-12-31', label:'Toutes les données'};
}

function renderAuditMP(period){
  const el = document.getElementById('audit-mp-body');
  if(!el) return;

  const {from, to, label} = _mpDateRange(period);
  const lignes = (S['enr31']?.lignes||[]).filter(r=>r.date&&r.date>=from&&r.date<=to);

  if(!lignes.length){
    el.innerHTML=`<div style="text-align:center;padding:30px;color:#b89ab6;font-size:.9rem">
      Aucune saisie pour cette période.<br><span style="font-size:.75rem">Ajoutez des matières premières dans Traçabilité MP.</span>
    </div>`;
    return;
  }

  // ── Top 20 produits ──────────────────────────────
  const prodCount = {};
  const prodDates = {};
  lignes.forEach(r=>{
    const p = (r.produit||'—').trim();
    prodCount[p] = (prodCount[p]||0) + 1;
    if(!prodDates[p]) prodDates[p] = [];
    prodDates[p].push(r.date);
  });
  const sorted = Object.entries(prodCount).sort((a,b)=>b[1]-a[1]).slice(0,20);
  const maxCount = sorted[0]?.[1] || 1;

  const top20Rows = sorted.map(([prod, cnt], i)=>{
    const pct = Math.round(cnt/maxCount*100);
    const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':'';
    const barColor = i<3?'#5C1E5A':i<10?'#8e44ad':'#b89ab6';
    const lastDate = prodDates[prod].sort().reverse()[0];
    const lastDateFmt = lastDate ? new Date(lastDate+'T12:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}) : '—';
    return `<div style="margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
        <span style="width:22px;text-align:right;font-size:.8rem;color:#b89ab6;font-weight:700;flex-shrink:0">${i+1}.</span>
        <span style="flex:1;font-size:.82rem;font-weight:800;color:var(--gris)">${medal} ${escH(prod)}</span>
        <span style="font-size:.75rem;font-weight:900;color:${barColor};flex-shrink:0">${cnt}×</span>
        <span style="font-size:.65rem;color:#b89ab6;flex-shrink:0">dernière: ${lastDateFmt}</span>
      </div>
      <div style="height:7px;background:#f0e4f0;border-radius:4px;overflow:hidden;margin-left:28px">
        <div style="height:100%;width:${pct}%;background:${barColor};border-radius:4px;transition:.4s"></div>
      </div>
    </div>`;
  }).join('');

  // ── Stats par cuisinier ──────────────────────────
  const chefCount = {};
  const chefProds = {};
  lignes.forEach(r=>{
    const c = (r.cuisinier||'Non renseigné').trim();
    chefCount[c] = (chefCount[c]||0) + 1;
    if(!chefProds[c]) chefProds[c] = new Set();
    if(r.produit) chefProds[c].add(r.produit.trim());
  });
  const chefsSorted = Object.entries(chefCount).sort((a,b)=>b[1]-a[1]);
  const chefMax = chefsSorted[0]?.[1] || 1;

  const chefRows = chefsSorted.map(([chef, cnt])=>{
    const pct = Math.round(cnt/chefMax*100);
    const nbProds = chefProds[chef]?.size || 0;
    const isTop = cnt===chefMax;
    const isLow = cnt===chefsSorted[chefsSorted.length-1][1] && chefsSorted.length>1;
    return `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #f0e4f0">
      <div style="width:32px;height:32px;border-radius:50%;background:${isTop?'#5C1E5A':isLow?'#f0e4f0':'#d0b0d0'};
        color:${isTop?'#fff':isLow?'#b89ab6':'#5C1E5A'};display:flex;align-items:center;justify-content:center;
        font-size:.75rem;font-weight:900;flex-shrink:0">${(chef||'?')[0].toUpperCase()}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:.82rem;font-weight:800;color:var(--gris)">${escH(chef)}</div>
        <div style="height:5px;background:#f0e4f0;border-radius:3px;margin-top:3px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${isTop?'#5C1E5A':'#d0b0d0'};border-radius:3px"></div>
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:.82rem;font-weight:900;color:${isTop?'#5C1E5A':'var(--gris2)'}">${cnt} saisie${cnt>1?'s':''}</div>
        <div style="font-size:.65rem;color:#b89ab6">${nbProds} produit${nbProds>1?'s':''} différents</div>
      </div>
      ${isTop?'<span style="font-size:.7rem;background:#5C1E5A;color:#fff;border-radius:6px;padding:2px 6px;flex-shrink:0">🏆 Top</span>':''}
      ${isLow?'<span style="font-size:.7rem;background:#fee2e2;color:#dc2626;border-radius:6px;padding:2px 6px;flex-shrink:0">↓ Moins actif</span>':''}
    </div>`;
  }).join('');

  // ── Résumé global ────────────────────────────────
  const totalSaisies = lignes.length;
  const nbProduitsDistincts = Object.keys(prodCount).length;
  const nbJours = new Set(lignes.map(r=>r.date)).size;
  const moy = nbJours ? (totalSaisies/nbJours).toFixed(1) : '0';

  el.innerHTML = `
    <!-- Résumé -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
      <div style="background:#f5edf5;border-radius:10px;padding:10px 12px;text-align:center">
        <div style="font-size:1.6rem;font-weight:900;color:var(--plum)">${totalSaisies}</div>
        <div style="font-size:.7rem;color:#b89ab6;font-weight:700">saisies totales</div>
      </div>
      <div style="background:#f5edf5;border-radius:10px;padding:10px 12px;text-align:center">
        <div style="font-size:1.6rem;font-weight:900;color:var(--plum)">${nbProduitsDistincts}</div>
        <div style="font-size:.7rem;color:#b89ab6;font-weight:700">produits différents</div>
      </div>
      <div style="background:#f5edf5;border-radius:10px;padding:10px 12px;text-align:center">
        <div style="font-size:1.6rem;font-weight:900;color:var(--plum)">${nbJours}</div>
        <div style="font-size:.7rem;color:#b89ab6;font-weight:700">jours d'activité</div>
      </div>
      <div style="background:#f5edf5;border-radius:10px;padding:10px 12px;text-align:center">
        <div style="font-size:1.6rem;font-weight:900;color:var(--plum)">${moy}</div>
        <div style="font-size:.7rem;color:#b89ab6;font-weight:700">saisies / jour</div>
      </div>
    </div>

    <!-- Top 20 produits -->
    <div style="font-size:.72rem;font-weight:900;text-transform:uppercase;letter-spacing:.5px;color:#b89ab6;margin-bottom:8px">
      🏆 Top ${sorted.length} produits — ${escH(label)}
    </div>
    ${top20Rows}

    <!-- Stats cuisiniers -->
    <div style="font-size:.72rem;font-weight:900;text-transform:uppercase;letter-spacing:.5px;color:#b89ab6;margin:14px 0 8px">
      👨‍🍳 Activité par cuisinier
    </div>
    ${chefRows || '<div style="color:#b89ab6;font-size:.8rem">Aucun cuisinier renseigné</div>'}
  `;
}

// ════════════════════════════════════════════════════
// ENR31 — Traçabilité MP (renderer custom)
// ════════════════════════════════════════════════════
// ════════════════════════════════════════════════════
// ENR31 — Export PDF Traçabilité Matières Premières
// ════════════════════════════════════════════════════
function exportMP_PDF(period){
  const lignes = (S['enr31']?.lignes||[]).slice();
  const site = getSiteName();
  const code = S.config?.code||'';
  const todayStr = today();
  const now = new Date();

  // Calcul de la plage selon la période
  let from, to, periodLabel;
  if(period==='jour'){
    from = to = todayStr;
    periodLabel = 'Aujourd\'hui — '+now.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  } else {
    const range = _mpDateRange(period);
    from = range.from; to = range.to; periodLabel = range.label;
  }

  const filtered = lignes.filter(r=>r.date&&r.date>=from&&r.date<=to)
    .sort((a,b)=>a.date.localeCompare(b.date));

  const fmtDate = d => d ? new Date(d+'T12:00').toLocaleDateString('fr-FR',{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'}) : '—';

  // Grouper par jour
  const byDay = {};
  filtered.forEach(r=>{
    const d = r.date||'—';
    if(!byDay[d]) byDay[d]=[];
    byDay[d].push(r);
  });

  const dateGen = now.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

  let tableBody = '';
  let totalLignes = 0;

  if(!filtered.length){
    tableBody = '<tr><td colspan="6" style="text-align:center;color:#999;font-style:italic;padding:16px">Aucune saisie pour cette période</td></tr>';
  } else {
    Object.entries(byDay).forEach(([date, rows])=>{
      // Ligne de date (séparateur)
      tableBody += `<tr style="background:#f5edf5">
        <td colspan="6" style="font-weight:900;color:#5C1E5A;font-size:12px;padding:6px 8px">
          📅 ${fmtDate(date)} — ${rows.length} produit${rows.length>1?'s':''}
        </td></tr>`;
      rows.forEach(r=>{
        totalLignes++;
        const dlc = r.dlc ? new Date(r.dlc+'T12:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'}) : '—';
        const dlcOk = r.dlc ? r.dlc >= todayStr : null;
        tableBody += `<tr>
          <td>${escH(r.produit||'—')}</td>
          <td>${escH(r.lot||'—')}</td>
          <td style="${dlcOk===false?'color:#b71c1c;font-weight:800':dlcOk===true?'color:#1b5e20':''}">
            ${dlc}${dlcOk===false?' ⚠️ PÉRIMÉ':''}
          </td>
          <td>${escH(r.estampille||'—')}</td>
          <td>${escH(r.cuisinier||'—')}</td>
        </tr>`;
      });
    });
  }

  const html = `<!DOCTYPE html><html lang="fr"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Traçabilité MP — ${site} — ${periodLabel}</title>
<style>
  ${_pdfCSS()}
  .no-print{background:#fff;padding:10px 14px;margin-bottom:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-radius:8px;border:1px solid #eee;}
  @media print{.no-print{display:none!important;}}
  th{white-space:nowrap;}
  td{word-break:break-word;}
  .periode-badge{display:inline-block;background:#f5edf5;color:#5C1E5A;border:1.5px solid #d9a8d6;border-radius:8px;padding:4px 12px;font-size:11px;font-weight:800;margin-top:4px;}
</style></head><body>
<div class="no-print">
  <button onclick="window.print()" style="background:#5C1E5A;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer;font-weight:bold">🖨️ Imprimer / PDF</button>
  <button onclick="window.close()" style="background:#eee;color:#333;border:1px solid #ccc;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer">✕ Fermer</button>
  <span style="font-size:13px;color:#666">${totalLignes} produit${totalLignes>1?'s':''} — ${periodLabel}</span>
</div>
<div class="hdr" style="border-color:#5C1E5A">
  <div>
    <h1 style="color:#5C1E5A">📋 Traçabilité Matières Premières</h1>
    <p><strong>${escH(site)}</strong>${code?' · Code : '+escH(code):''}</p>
    <div class="periode-badge">📅 ${periodLabel}</div>
    <p style="margin-top:6px">Généré le : <strong>${dateGen}</strong></p>
  </div>
  <div class="score-ring" style="background:#5C1E5A">
    <div class="s-num">${totalLignes}</div>
    <div class="s-lbl">produit${totalLignes>1?'s':''}</div>
  </div>
</div>

<h2 style="color:#5C1E5A;border-color:#d9a8d6">📦 Produits sortis — ${periodLabel}</h2>
<table>
  <thead>
    <tr>
      <th style="width:28%">Produit</th>
      <th style="width:18%">N° de lot</th>
      <th style="width:16%">DLC / DDM</th>
      <th style="width:20%">Estampille sanitaire</th>
      <th style="width:18%">Cuisinier / Visa</th>
    </tr>
  </thead>
  <tbody>${tableBody}</tbody>
</table>

<div class="footer">
  <span>PMS HACCP — Traçabilité MP — ${escH(site)}${code?' ('+escH(code)+')':''}</span>
  <span>Généré le ${new Date().toLocaleString('fr-FR')}</span>
</div>
</body></html>`;

  openPrintWindow(html);
}

function renderENR31() {
  const def = FDEFS['enr31'];
  if (!def) return '<div class="card"><p>ENR31 non défini</p></div>';
  const draft = (S['enr31']||{}).draft||{};
  // Pré-remplir la date si absente
  if (!draft.date) { sd('date', today(), 'enr31'); }
  return `
    <div class="card">
      <div class="card-title">${def.title}</div>
      <div class="regle">${def.regle}</div>

      <div style="margin-bottom:12px">
        <div style="font-size:.7rem;font-weight:800;color:var(--plum);margin-bottom:6px;text-transform:uppercase;letter-spacing:.3px">📷 Photos étiquettes (max 3)</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">
          <div>
            <button class="photo-btn" style="width:100%;padding:8px 4px;font-size:.72rem;margin:0 0 4px" onclick="openOcrModal('enr31')">
              ${(S['enr31']?.draft?.photo)?'✓ Photo 1':'📷 Photo 1'}
            </button>
            ${(S['enr31']?.draft?.photo)?photoThumb(S['enr31'].draft.photo,'Photo 1'):''}
          </div>
          <div>
            <button class="photo-btn" style="width:100%;padding:8px 4px;font-size:.72rem;margin:0 0 4px" onclick="openOcrModal('enr31_2')">
              ${(S['enr31']?.draft?.photo2)?'✓ Photo 2':'📷 Photo 2'}
            </button>
            ${(S['enr31']?.draft?.photo2)?photoThumb(S['enr31'].draft.photo2,'Photo 2'):''}
          </div>
          <div>
            <button class="photo-btn" style="width:100%;padding:8px 4px;font-size:.72rem;margin:0 0 4px" onclick="openOcrModal('enr31_3')">
              ${(S['enr31']?.draft?.photo3)?'✓ Photo 3':'📷 Photo 3'}
            </button>
            ${(S['enr31']?.draft?.photo3)?photoThumb(S['enr31'].draft.photo3,'Photo 3'):''}
          </div>
        </div>
      </div>

      <div class="fg-label">Nouvelle saisie</div>
      ${renderFields(def.fields, 'enr31')}

    <div class="btn-row">
        <button class="btn-save" onclick="saveRow('enr31')">✅ Enregistrer</button>
        <button class="btn btn-sec" onclick="clearRow('enr31')">🔄 Effacer</button>
      </div>
      <div style="margin-top:10px">
        <div style="font-size:.68rem;font-weight:800;color:#b89ab6;text-transform:uppercase;letter-spacing:.3px;margin-bottom:5px">📄 Export PDF listing matières premières</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-sec" style="flex:1;padding:9px;font-size:.78rem;touch-action:manipulation" onclick="exportMP_PDF('jour')">📅 Auj.</button>
          <button class="btn btn-sec" style="flex:1;padding:9px;font-size:.78rem;touch-action:manipulation" onclick="exportMP_PDF('semaine')">📅 Semaine</button>
          <button class="btn btn-sec" style="flex:1;padding:9px;font-size:.78rem;touch-action:manipulation" onclick="exportMP_PDF('15j')">📅 15 jours</button>
          <button class="btn btn-sec" style="flex:1;padding:9px;font-size:.78rem;touch-action:manipulation" onclick="exportMP_PDF('mois')">📅 Mois</button>
          <button class="btn btn-sec" style="flex:1;padding:9px;font-size:.78rem;touch-action:manipulation" onclick="exportMP_PDF('all')">📅 Tout</button>
        </div>
        <button class="btn" style="width:100%;margin-top:6px;padding:10px;background:linear-gradient(135deg,#7B2D78,#c93a78);color:#fff;border:none;border-radius:10px;font-size:.82rem;font-weight:800;cursor:pointer;font-family:inherit;touch-action:manipulation" onclick="openAuditMP()">
          📊 Audit MP — Top 20 & Statistiques
        </button>
      </div>
    </div>
    ${renderHistoCard('enr31', def.fields, {
      extraBtn: (r,i) => `<button onclick="enr31ToEtiq(${i})" style="background:#f5eef5;border:1.5px solid var(--plum);border-radius:8px;padding:5px 8px;font-size:.7rem;cursor:pointer;font-family:inherit;color:var(--plum);font-weight:700;flex-shrink:0;touch-action:manipulation" title="Créer étiquette Entamé">🏷️</button>`
    })}`;
}


// Génère une étiquette ENR34 "Entamé" depuis une ligne ENR31
function enr31ToEtiq(i){
  const r=((S['enr31']||{}).lignes||[])[i];
  if(!r){toast('⚠️ Introuvable','warning');return;}
  // Chercher la DLC correspondante dans DLC_BASE
  const dlcEntry=DLC_BASE.find(p=>p.dlc_j!==null&&!p.dlc_ddm) || DLC_BASE[0];
  S['enr34']=S['enr34']||{};
  S['enr34'].draft34={
    produit: r.produit||'',
    statut: 'Entamé',
    date_fab: r.date||today(),
    heure_fab: nowT(),
    dlc: r.dlc||'',
    stockage: '0 / +3°C',
    cuisinier34: r.cuisinier||getActiveSession()||''
  };
  save();
  goTo('enr34');
  toast('🏷️ Étiquette "Entamé" pré-remplie depuis la traçabilité','success');
}


// ════════════════════════════════════════════════════

function e33d(){ return (S['enr33']||{}).draft33||{}; }
function e33sv(k,v){ S['enr33']=S['enr33']||{}; S['enr33'].draft33=S['enr33'].draft33||{}; S['enr33'].draft33[k]=v; save(); }

// Helper chef selector pour les formulaires étiquettes (e33/e34/e36)
// getter = nom de la fonction draft (ex: 'e33d'), setter = nom de la fonction save (ex: 'e33sv')
function etiqChefSel(field, getter, setter, label){
  const chefs=getChefs();
  const active=getActiveSession();
  const d=window[getter]();
  if(active && chefs.includes(active) && !d[field]) window[setter](field, active);
  const val=window[getter]()[field]||'';
  label=label||'Cuisinier / Visa';
  if(!chefs.length){
    return `<div class="fg"><label>${label}</label>
      <input class="fi" type="text" value="${escH(val)}" placeholder="Visa / Initiales"
        oninput="${setter}('${field}',this.value)"></div>`;
  }
  const sess=active&&val===active;
  return`<div class="fg"><label>${label}${sess?' <span style="font-size:.65rem;background:#dcfce7;color:#166534;padding:1px 6px;border-radius:8px;font-weight:700">✓ Session</span>':''}</label>
    <select class="fi" onchange="${setter}('${field}',this.value)">
      <option value="">— Sélectionner —</option>
      ${chefs.map(c=>`<option ${val===c?'selected':''}>${escH(c)}</option>`).join('')}
    </select></div>`;
}
function e33s(k,v){ e33sv(k,v); renderMain(); }
function e33sr(){ S['enr33']=S['enr33']||{}; S['enr33'].draft33={}; _e33qty=1; save(); renderMain(); }
let _e33qty=1;
let _e33batch=[];

function renderENR33(){
  const d=e33d();
  const lignes=(S['enr33']||{}).lignes||[];
  const services=[
    {v:'Déjeuner',ico:'☀️',hdef:'12:00'},
    {v:'Dîner',ico:'🌙',hdef:'19:00'},
    {v:'Petit-déjeuner',ico:'🌅',hdef:'08:00'},
    {v:'Goûter',ico:'🍰',hdef:'15:00'},
  ];

  // Date destruction = J+7
  const datePrelevDisp=d.date_prelev?new Date(d.date_prelev+'T12:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'}):"Aujourd'hui";
  const dateDestruct=d.date_prelev?(()=>{const f=new Date(d.date_prelev+'T12:00');f.setDate(f.getDate()+7);return f.toISOString().slice(0,10);})():(()=>{const f=new Date();f.setDate(f.getDate()+7);return f.toISOString().slice(0,10);})();
  const dateDestructDisp=new Date(dateDestruct+'T12:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'});

  // Aujourd'hui, combien de témoins déjà pris
  const t=today();
  const temoinsToday=(S['enr33']?.lignes||[]).filter(r=>r.date_prelev===t||r.date===t).length;

  return`<div class="card">
    <div class="card-title">🍱 Plat témoin</div>
    <div class="regle">Prélever <strong>100g minimum</strong> par plat, en début de service. Conserver <strong>7 jours à 0/+3°C</strong>. Ne jamais ouvrir.</div>

    ${temoinsToday>0?`<div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:10px;padding:8px 12px;margin-bottom:10px;font-size:.78rem;font-weight:700;color:#166534">✓ ${temoinsToday} témoin${temoinsToday>1?'s':''} déjà enregistré${temoinsToday>1?'s':''} aujourd'hui</div>`:''}

    <!-- Service -->
    <div class="fg full" style="margin-bottom:10px">
      <label>Service</label>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:5px">
        ${services.map(s=>`<button onclick="e33s('service','${s.v}');if(!e33d().heure_prelev||e33d().heure_prelev==='')e33s('heure_prelev','${s.hdef}')"
          style="padding:8px 14px;border-radius:10px;border:2px solid ${d.service===s.v?'var(--plum)':'var(--brd)'};
          background:${d.service===s.v?'var(--plum)':'var(--fond)'};color:${d.service===s.v?'#fff':'var(--gris2)'};
          font-size:.8rem;font-weight:800;cursor:pointer;font-family:inherit">
          ${s.ico} ${s.v}</button>`).join('')}
      </div>
    </div>

    <!-- Produit -->
    <div class="fg full" style="margin-bottom:8px">
      <label>Nom du plat *</label>
      ${(()=>{
        const recents=[...new Set(((S['enr33']||{}).lignes||[]).slice(0,30).map(r=>r.produit).filter(Boolean))].slice(0,5);
        if(!recents.length||d.produit) return '';
        return '<div style="display:flex;gap:5px;flex-wrap:wrap;margin:5px 0 6px">'
          +recents.map(p=>`<button onclick="e33sv('produit','${escH(p).replace(/'/g,"\\'")}');document.getElementById('e33-produit-inp').value='${escH(p).replace(/'/g,"\\'")}'" style="padding:4px 10px;background:var(--fond);border:1.5px solid var(--brd);border-radius:20px;font-size:.7rem;font-weight:700;color:var(--gris2);cursor:pointer;font-family:inherit">↩ ${escH(p)}</button>`).join('')
          +'</div>';
      })()}
      <div class="mic-wrap" style="margin-top:4px">
        <input class="fi" id="e33-produit-inp" type="text" value="${escH(d.produit||'')}" placeholder="Ex: Bœuf bourguignon, Salade niçoise…"
          oninput="e33sv('produit',this.value)">
        <button type="button" class="mic-btn" title="Dicter" onclick="startMicField('e33-produit-inp',v=>e33sv('produit',v))">🎤</button>
      </div>
    </div>

    <!-- Date + Heure prélèvement -->
    <div class="fgrid" style="margin-bottom:8px">
      <div class="fg">
        <label>Date prélèvement</label>
        <button class="dp-trigger" onclick="openDP('${d.date_prelev||today()}',v=>{e33s('date_prelev',v);},{max:'${today()}'})">
          <span class="dp-ico">📅</span>
          <span class="dp-val ${!d.date_prelev?'empty':''}">${datePrelevDisp}</span>
          <span style="font-size:.7rem;color:#c0a0c0">▼</span>
        </button>
      </div>
      <div class="fg">
        <label>Heure prélèvement</label>
        <button type="button" class="time-btn" onclick="S['_e33tmp']=S['_e33tmp']||{};S['_e33tmp'].draft=S['_e33tmp'].draft||{};S['_e33tmp'].draft.h=e33d().heure_prelev||nowT();openTW('h','_e33tmp','Heure prélèvement');window._twCloseCb=()=>{const v=gd('h','_e33tmp');if(v)e33s('heure_prelev',v);}">
          ${d.heure_prelev?`<span>⏰</span><span class="tv">${d.heure_prelev}</span>`:`<span>⏰</span><span class="tp2">Appuyer</span>`}
        </button>
      </div>
    </div>

    <!-- Destruction auto J+7 -->
    <div style="background:#fef2f2;border:1.5px solid #fca5a5;border-radius:10px;padding:9px 12px;margin-bottom:10px;display:flex;align-items:center;gap:10px">
      <span style="font-size:1.2rem">🗑️</span>
      <div>
        <div style="font-size:.78rem;font-weight:800;color:#991b1b">À détruire le : ${dateDestructDisp}</div>
        <div style="font-size:.68rem;color:#b89ab6">7 jours après prélèvement — calculé automatiquement</div>
      </div>
    </div>

    <!-- Opérateur + Quantité -->
    <div class="fgrid">
      <div class="fg">${etiqChefSel('operateur','e33d','e33sv','Opérateur')}</div>
      <div class="fg">
        <label>Nb d'étiquettes</label>
        <div style="display:flex;align-items:center;gap:10px;margin-top:4px">
          <button onclick="_e33qty=Math.max(1,_e33qty-1);document.getElementById('e33qd').textContent=_e33qty"
            style="width:36px;height:36px;border-radius:50%;border:2px solid var(--brd);background:var(--fond);font-size:1.3rem;cursor:pointer;font-family:inherit;font-weight:800">−</button>
          <span id="e33qd" style="font-size:1.4rem;font-weight:900;color:var(--plum);min-width:30px;text-align:center">${_e33qty}</span>
          <button onclick="_e33qty=Math.min(10,_e33qty+1);document.getElementById('e33qd').textContent=_e33qty"
            style="width:36px;height:36px;border-radius:50%;border:2px solid var(--plum);background:var(--plum);color:#fff;font-size:1.3rem;cursor:pointer;font-family:inherit;font-weight:800">+</button>
        </div>
        ${(()=>{var r=etiqRestantes(),p=etiqPerPage(),l=printAllTotal();if(p<=1)return '';var libre=r>0?r-l:p-l;if(libre>0&&libre<p&&libre!==_e33qty)return '<button onclick="_e33qty='+libre+';document.getElementById(\'e33qd\').textContent='+libre+'" style="margin-top:5px;padding:4px 10px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:8px;font-size:.68rem;font-weight:800;color:#166534;cursor:pointer;font-family:inherit;width:100%">📄 Compléter la feuille (→ '+libre+')</button>';return '';})()}
      </div>
    </div>

    <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">
      <button class="btn-save" style="width:100%" onclick="e33Save()">✅ Enregistrer + Étiquette</button>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sec" style="flex:1;touch-action:manipulation" onclick="e33AddBatch()">➕ Ajouter au lot</button>
        <button class="btn btn-sec" style="touch-action:manipulation" onclick="e33sr()">🔄</button>
      </div>
    </div>
  </div>

  ${_e33batch.length>0?`<div style="background:#f0f0ff;border:1.5px solid #8888ff;border-radius:12px;padding:10px 12px;margin-bottom:10px">
    <div style="font-size:.78rem;font-weight:800;color:#3333aa;margin-bottom:6px">🗂️ Lot en cours — ${_e33batch.length} plat${_e33batch.length>1?'s':''} témoin${_e33batch.length>1?'s':''}</div>
    ${_e33batch.map((b,i)=>`<div style="display:flex;justify-content:space-between;align-items:center;font-size:.72rem;color:#555;padding:3px 0;border-bottom:1px solid #ddd">
      <span>${b.nb||1}× ${escH(b.produit||'—')} — ${b.service||''}</span>
      <button onclick="_e33batch.splice(${i},1);renderNav();renderMain()" style="background:none;border:none;color:#999;cursor:pointer">✕</button>
    </div>`).join('')}
    <button class="btn-save" style="width:100%;margin-top:8px;font-size:.82rem" onclick="e33PrintBatch()">🖨️ Imprimer le lot (${_e33batch.reduce((s,b)=>s+(b.nb||1),0)} étiquettes)</button>
    <button onclick="_e33batch=[];renderNav();renderMain()" style="width:100%;margin-top:5px;padding:8px;background:var(--fond);border:1.5px solid var(--brd);border-radius:10px;font-size:.75rem;font-weight:700;cursor:pointer;color:#666;font-family:inherit">✕ Vider</button>
  </div>`:''}
  ${printAllBanner()}
  ${e33RenderHisto(lignes)}`;
}

function e33AddBatch(){
  const d=e33d();
  if(!d.produit){toast('⚠️ Saisissez le nom du plat','warning');return;}
  const t=today();
  const datePrelev=d.date_prelev||t;
  const destruct=(()=>{const f=new Date(datePrelev+'T12:00');f.setDate(f.getDate()+7);return f.toISOString().slice(0,10);})();
  const batchEntry={...d,date_prelev:datePrelev,date_destruct:destruct,nb:_e33qty};
  _e33batch.push(batchEntry);
  // Sauvegarder immédiatement dans l'historique (sans attendre l'impression)
  const rec=stampEntry({...batchEntry,date:t,_ts:new Date().toISOString(),_sec:'enr33',nb_etiq:batchEntry.nb||1,_dans_lot:true});
  S['enr33']=S['enr33']||{};S['enr33'].lignes=S['enr33'].lignes||[];
  S['enr33'].lignes.unshift(rec);
  try{SupaEngine.enqueue('enr33',rec);}catch(e){}
  toast(`✅ Ajouté au lot — ${_e33batch.length} plat${_e33batch.length>1?'s':''}`, 'success');
  S['enr33'].draft33={}; _e33qty=1; save(); autoBackup(); renderNav(); renderMain();
}

function e33PrintBatch(){
  S['enr33']=S['enr33']||{}; S['enr33'].lignes=S['enr33'].lignes||[];
  _e33batch.forEach(b=>S['enr33'].lignes.unshift(stampEntry({...b,date:today(),_ts:new Date().toISOString(),_sec:'enr33',nb_etiq:b.nb||1})));
  save();
  const nb33=_e33batch.reduce(function(s,b){return s+(b.nb||1);},0);
  _e33batch.forEach(b=>e33Print(b, b.nb||1));
  autoBackup();
  setTimeout(function(){
    showConfirm('🖨️ Étiquettes bien imprimées ?',etiqConfirmMsg(nb33),'✅ Oui, vider le lot',function(){
      etiqAfterPrint(nb33);
      _e33batch=[]; renderNav(); renderMain(); toast('✅ Lot plats témoins vidé','success');
    });
  },1500);
}

function e33Save(){
  const d=e33d();
  if(!d.produit){toast('⚠️ Saisissez le nom du plat','warning');return;}
  const t=today();
  const datePrelev=d.date_prelev||t;
  const destruct=(()=>{const f=new Date(datePrelev+'T12:00');f.setDate(f.getDate()+7);return f.toISOString().slice(0,10);})();
  const rec={...d, date:t, date_prelev:datePrelev, date_destruct:destruct, _ts:new Date().toISOString(), _sec:'enr33'};
  const nb=_e33qty;
  const sim=etiqSimule(nb+printAllTotal());
  function doSave(){
    S['enr33']=S['enr33']||{}; S['enr33'].lignes=S['enr33'].lignes||[];
    S['enr33'].lignes.unshift(stampEntry(rec));
    save();
    try { SupaEngine.enqueue('enr33', stampEntry(rec)); } catch(e){}
    e33Print(rec, nb);
    S['enr33'].draft33={}; _e33qty=1; save(); renderNav(); renderMain();
    setTimeout(function(){
      showConfirm('🖨️ Étiquettes bien imprimées ?',
        etiqConfirmMsg(nb),
        '✅ Oui, c\'est imprimé',
        function(){ etiqAfterPrint(nb); renderMain(); toast('📄 Compteur mis à jour','success'); });
    },1500);
  }
  // Alerte si gaspillage important (>= perPage/2 cases perdues)
  if(sim&&!sim.rentreTotal&&sim.gaspillees>=Math.floor(etiqPerPage()/2)){
    showConfirm(
      '⚠️ Gaspillage détecté',
      sim.gaspillees+' case'+(sim.gaspillees>1?'s':'')+' seront gaspillée'+(sim.gaspillees>1?'s':'')+' sur la nouvelle feuille.\n\n💡 Astuce : ajoute ce plat au lot (➕) et imprime avec les prochaines étiquettes.',
      '🖨️ Imprimer quand même',
      doSave
    );
  } else { doSave(); }
}

function e33Print(rec, nb){
  nb=nb||1;
  const logoLine=etiqLogoLine();
  const datePrelev=rec.date_prelev?new Date(rec.date_prelev+'T12:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'}):'__/__/____';
  const destruct=rec.date_destruct?new Date(rec.date_destruct+'T12:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'}):'__/__/____';
  const heure=rec.heure_prelev||'__h__';
  const service=rec.service||'';
  const ico=service==='Déjeuner'?'☀️':service==='Dîner'?'🌙':service==='Petit-déjeuner'?'🌅':'🍰';

  const label=`<div class="etiq">
    <div class="hd">
      <span class="logo">${logoLine}</span>
      <span class="title">PLAT TÉMOIN</span>
    </div>
    <div class="service">${ico} ${service||'Service'}</div>
    <div class="prod">${rec.produit||'—'}</div>
    <div class="row">Prélevé le : <b>${datePrelev}</b> à <b>${heure}</b></div>
    <div class="row">Par : ${rec.operateur||'—'}</div>
    <div class="conserve">🌡️ Conserver 0°C / +3°C — NE PAS OUVRIR</div>
    <div class="destruct">🗑️ À détruire le : <b>${destruct}</b></div>
  </div>`;

  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Plat témoin — ${rec.produit}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:Arial,sans-serif;background:#f5f5f5;padding:12px;}
    .no-print{background:#fff;border-radius:10px;padding:10px 12px;margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;box-shadow:0 1px 4px rgba(0,0,0,.1);}
    .page{display:flex;flex-wrap:wrap;gap:12px;}
    /* Aperçu écran : étiquettes en px lisibles */
    .etiq{width:calc(100vw - 24px);max-width:360px;border:2.5px solid #5C1E5A;border-radius:5px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.1);}
    .hd{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #5C1E5A;padding-bottom:6px;}
    .logo{font-size:9px;font-weight:bold;color:#c93a78;}
    .title{background:#5C1E5A;color:#fff;font-size:11px;font-weight:bold;padding:2px 7px;border-radius:3px;}
    .service{font-size:10px;color:#5C1E5A;font-weight:bold;}
    .prod{font-size:14px;font-weight:bold;color:#111;line-height:1.2;}
    .row{font-size:10px;color:#333;}
    .conserve{font-size:9px;color:#666;font-style:italic;border-top:1px dashed #ccc;padding-top:5px;}
    .destruct{font-size:11px;font-weight:bold;color:#c00;background:#fff5f5;border-radius:3px;padding:4px 6px;}
    /* Impression : retour aux vraies tailles mm */
  </style>
  <style>${buildA4PrintCss(getEtiqA4Fmt(),'.hd{padding-bottom:1mm;}.logo{font-size:6pt;}.title{font-size:7pt;padding:0.5mm 1.5mm;}.service{font-size:7pt;}.prod{font-size:9pt;line-height:1.1;}.row{font-size:6.5pt;}.conserve{font-size:6pt;padding-top:0.8mm;}.destruct{font-size:7.5pt;padding:0.8mm 1.5mm;}')}</style>
  </head><body>
  <div class="no-print" style="background:#fff;border-radius:10px;padding:10px 12px;margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;box-shadow:0 1px 4px rgba(0,0,0,.1);">
    <button onclick="window.print()" style="background:#5C1E5A;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer;font-weight:bold">🖨️ Imprimer</button>
    <span style="font-size:12px;background:#f0e4f0;color:#5C1E5A;padding:6px 12px;border-radius:8px;font-weight:700">🏷️ ${getEtiqA4Fmt().label}</span>
    <button onclick="window.close()" style="background:#eee;color:#333;border:1px solid #ccc;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer">✕ Fermer</button>
    <span style="font-size:13px;color:#666">${nb} étiquette${nb>1?'s':''} — ${rec.produit} — À détruire le ${destruct}</span>
  </div>
  <div class="page">${Array(nb).fill(label).join('')}</div>
  </body></html>`;

  openPrintWindow(html);
  setTimeout(function(){
    showConfirm('🖨️ Étiquettes bien imprimées ?',etiqConfirmMsg(nb),'✅ Oui, compteur mis à jour',function(){
      etiqAfterPrint(nb); renderMain(); toast('📄 Compteur mis à jour','success');
    });
  },1500);
}

function e33RenderHisto(lignes){
  if(!lignes.length)return`<div class="card"><div class="hh"><span class="hh-title">📜 Historique plats témoins</span><span class="hh-badge">0</span></div><div class="empty-s">Aucun plat témoin enregistré.</div></div>`;
  const t=today();
  const rows=[...lignes].slice(0,40).map((r,i)=>{
    const destruct=r.date_destruct;
    const isExpire=destruct&&destruct<t;
    const isADetruire=destruct&&!isExpire&&(()=>{const d=new Date(destruct+'T12:00');const now=new Date();const diff=Math.round((d-now)/(1000*60*60*24));return diff<=1;})();
    const recJson=JSON.stringify(r).replace(/"/g,"'");
    const fnPrint=`reimprAsk('enr33',${recJson},${r.nb_etiq||1})`;
    const fnDel=`deleteENRLigne('enr33',${i},'Supprimer ce plat témoin ? Il sera également retiré du cloud.')`;
    return`<div class="swipe-row" data-swipe-left="${fnPrint}" data-swipe-right="${fnDel}">
      <div class="swipe-action swipe-action-del">🗑 Supprimer</div>
      <div class="swipe-action swipe-action-right">🖨️ Réimprimer</div>
      <div class="swipe-row-inner">
        <div style="font-size:1.2rem;flex-shrink:0">${isExpire?'🗑️':isADetruire?'⚠️':'✅'}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:.92rem;font-weight:800;color:${isExpire?'#dc2626':'var(--gris)'}"> ${escH(r.produit||'—')} <span style="font-size:.72rem;font-weight:600;color:#b89ab6">${r.service||''}</span></div>
          <div style="font-size:.75rem;color:#b89ab6;margin-top:3px">
            Prélevé ${r.date_prelev||r.date||''} ${r.heure_prelev?'à '+r.heure_prelev:''} · ${escH(r.operateur||'')}
          </div>
          <div style="font-size:.78rem;font-weight:700;color:${isExpire?'#dc2626':isADetruire?'#d97706':'#166534'};margin-top:3px">
            ${isExpire?'🗑️ PÉRIMÉ — À jeter':isADetruire?'⚠️ À détruire bientôt':'🗑️ Détruire le '+new Date(destruct+'T12:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'})}
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
  const nbExpires=lignes.filter(r=>r.date_destruct&&r.date_destruct<t&&!r._jete).length;
  const html=`<div class="card">
    <div class="hh">
      <span class="hh-title">📜 Historique plats témoins</span>
      <span class="hh-badge">${lignes.length}${nbExpires>0?` · <span style="color:#dc2626">${nbExpires} périmé${nbExpires>1?'s':''}</span>`:''}</span>
    </div>
    ${nbExpires>0?`<div style="background:#fef2f2;border-radius:8px;padding:8px 12px;margin:0 14px 10px;font-size:.78rem;font-weight:700;color:#dc2626">🗑️ ${nbExpires} plat${nbExpires>1?'s témoins périmés':'  témoin périmé'} — À retirer du stockage et jeter</div>`:''}
    <div style="font-size:.68rem;color:#b89ab6;padding:0 14px 8px">← Glisser à gauche = réimprimer · Glisser à droite = supprimer</div>
    <div id="e33-histo-list" style="padding:0 14px 10px">${rows}</div>
  </div>`;
  setTimeout(function(){initSwipeRows(document.getElementById('e33-histo-list'));},120);
  return html;
}
// ════════════════════════════════════════════════════
// ENR36 — ÉTIQUETTES EXCÉDENTS
// ════════════════════════════════════════════════════

function e36d(){ return (S['enr36']||{}).draft36||{}; }
function e36sv(k,v){ S['enr36']=S['enr36']||{}; S['enr36'].draft36=S['enr36'].draft36||{}; S['enr36'].draft36[k]=v; save(); } // save silencieux (input texte)
function e36s(k,v){ e36sv(k,v); renderMain(); }
function e36sr(){ S['enr36']=S['enr36']||{}; S['enr36'].draft36={}; _e36qty=1; _e36batch=[]; save(); renderMain(); }
let _e36qty=1, _e36batch=[];

function renderENR36(){
  const d=e36d();
  const lignes=(S['enr36']||{}).lignes||[];

  // Type de conservation
  const typesCons=[
    {v:'froid',ico:'❄️',label:'Froid 0/+3°C',couleur:'#1d4ed8',dlc_j:3},
    {v:'chaud',ico:'🔥',label:'Chaud ≥+63°C',couleur:'#dc2626',dlc_j:0,dlc_h:2},
  ];
  const typeSel=typesCons.find(t=>t.v===d.type_cons)||null;

  // Calcul DLC auto
  const dateRefExc=d.date_prod||today();
  let dlcAutoExc='';
  if(typeSel){
    if(typeSel.dlc_h){ const f=new Date(dateRefExc+'T12:00');f.setHours(f.getHours()+typeSel.dlc_h);dlcAutoExc=f.toISOString().slice(0,10); }
    else if(typeSel.dlc_j>0){ const f=new Date(dateRefExc+'T12:00');f.setDate(f.getDate()+typeSel.dlc_j);dlcAutoExc=f.toISOString().slice(0,10); }
    else dlcAutoExc=dateRefExc;
    if(!d.dlc) e36sv('dlc',dlcAutoExc); // silencieux, pas de renderMain en boucle
  }
  const dlcDisp=d.dlc?new Date(d.dlc+'T12:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'}):'';
  const dateProdDisp=d.date_prod?new Date(d.date_prod+'T12:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'}):"Aujourd'hui";

  // Remise T°C — warning si déjà réchauffé
  const dejaRechauffe=d.remise==='OUI';

  // Batch
  const batchHtml=_e36batch.length>0?`<div style="background:#f0f0ff;border:1.5px solid #8888ff;border-radius:12px;padding:10px 12px;margin-bottom:10px">
    <div style="font-size:.78rem;font-weight:800;color:#3333aa;margin-bottom:6px">🗂️ Lot — ${_e36batch.length} étiquette${_e36batch.length>1?'s':''}</div>
    ${_e36batch.map((b,i)=>`<div style="display:flex;justify-content:space-between;font-size:.72rem;color:#555;padding:3px 0;border-bottom:1px solid #ddd">
      <span>${b.nb}× ${escH(b.produit)} — ${b.type_cons==='froid'?'❄️':'🔥'} DLC: ${b.dlc?new Date(b.dlc+'T12:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}):'—'}</span>
      <button onclick="_e36batch.splice(${i},1);renderMain()" style="background:none;border:none;color:#999;cursor:pointer">✕</button>
    </div>`).join('')}
    <button class="btn-save" style="width:100%;margin-top:8px;font-size:.82rem" onclick="e36PrintBatch()">🖨️ Imprimer le lot</button>
    <button onclick="_e36batch=[];renderMain()" style="width:100%;margin-top:5px;padding:8px;background:var(--fond);border:1.5px solid var(--brd);border-radius:10px;font-size:.75rem;font-weight:700;cursor:pointer;color:#666;font-family:inherit">✕ Vider</button>
  </div>`:'';

  return`<div class="card">
    <div class="card-title">♻️ Étiquette excédent</div>
    <div class="regle">Refroidi : conserver <strong>J+3 à 0/+3°C</strong>. Chaud : service dans <strong>2h max</strong>. <strong>1 seule remise en T°C autorisée.</strong></div>

    <!-- Produit -->
    <div class="fg full" style="margin-bottom:10px">
      <label>Nom du plat *</label>
      <div class="mic-wrap" style="margin-top:4px">
        <input class="fi" id="e36-produit-inp" type="text" value="${escH(d.produit||'')}" placeholder="Ex: Gratin dauphinois, Poulet rôti…"
          oninput="e36sv('produit',this.value)">
        <button type="button" class="mic-btn" title="Dicter" onclick="startMicField('e36-produit-inp',v=>e36sv('produit',v))">🎤</button>
      </div>
    </div>

    <!-- Type conservation -->
    <div class="fg full" style="margin-bottom:10px">
      <label>Mode de conservation</label>
      <div style="display:flex;gap:8px;margin-top:5px">
        ${typesCons.map(t=>`<button onclick="e36s('type_cons','${t.v}')"
          style="flex:1;padding:12px 8px;border-radius:12px;border:2px solid ${d.type_cons===t.v?t.couleur:'var(--brd)'};
          background:${d.type_cons===t.v?t.couleur:'var(--fond)'};color:${d.type_cons===t.v?'#fff':'var(--gris2)'};
          font-size:.85rem;font-weight:800;cursor:pointer;font-family:inherit;text-align:center">
          <div style="font-size:1.3rem">${t.ico}</div>
          <div>${t.label}</div>
          <div style="font-size:.65rem;opacity:.8">${t.dlc_h?'2h max':'J+3'}</div>
        </button>`).join('')}
      </div>
    </div>

    <!-- Date + Heure production -->
    <div class="fgrid" style="margin-bottom:8px">
      <div class="fg">
        <label>Date production</label>
        <button class="dp-trigger" onclick="openDP('${d.date_prod||today()}',v=>{e36s('date_prod',v);e36AutoDlc();},{max:'${today()}'})">
          <span class="dp-ico">📅</span>
          <span class="dp-val ${!d.date_prod?'empty':''}">${dateProdDisp}</span>
          <span style="font-size:.7rem;color:#c0a0c0">▼</span>
        </button>
      </div>
      <div class="fg">
        <label>Heure</label>
        <button type="button" class="time-btn" onclick="S['_e36tmp']=S['_e36tmp']||{};S['_e36tmp'].draft=S['_e36tmp'].draft||{};S['_e36tmp'].draft.h=e36d().heure_prod||nowT();openTW('h','_e36tmp','Heure production');window._twCloseCb=()=>{const v=gd('h','_e36tmp');if(v)e36s('heure_prod',v);}">
          ${d.heure_prod?`<span>⏰</span><span class="tv">${d.heure_prod}</span>`:`<span>⏰</span><span class="tp2">Appuyer</span>`}
        </button>
      </div>
      <div class="fg full">
        <label>À consommer jusqu'au (DLC) ${typeSel?`<span style="font-size:.65rem;color:#888">— calculée auto : ${typeSel.dlc_h?'2h max':'J+'+typeSel.dlc_j}</span>`:''}</label>
        <button class="dp-trigger" onclick="openDP('${d.dlc||today()}',v=>{e36s('dlc',v);},{})">
          <span class="dp-ico">📅</span>
          <span class="dp-val ${!d.dlc?'empty':''}">${dlcDisp||'Sélectionner'}</span>
          <span style="font-size:.7rem;color:#c0a0c0">▼</span>
        </button>
      </div>
    </div>

    <!-- Remise T°C -->
    <div class="fg full" style="margin-bottom:10px">
      <label>Déjà réchauffé une fois ?</label>
      <div style="display:flex;gap:8px;margin-top:5px">
        <button onclick="e36s('remise','NON')"
          style="flex:1;padding:11px;border-radius:10px;border:2px solid ${d.remise==='NON'?'#166534':'var(--brd)'};
          background:${d.remise==='NON'?'#dcfce7':'var(--fond)'};color:${d.remise==='NON'?'#166534':'var(--gris2)'};
          font-size:.85rem;font-weight:800;cursor:pointer;font-family:inherit">✅ NON — 1 remise possible</button>
        <button onclick="e36s('remise','OUI')"
          style="flex:1;padding:11px;border-radius:10px;border:2px solid ${d.remise==='OUI'?'#dc2626':'var(--brd)'};
          background:${d.remise==='OUI'?'#fee2e2':'var(--fond)'};color:${d.remise==='OUI'?'#dc2626':'var(--gris2)'};
          font-size:.85rem;font-weight:800;cursor:pointer;font-family:inherit">⚠️ OUI — Ne plus réchauffer</button>
      </div>
    </div>

    ${dejaRechauffe?`<div style="background:#fef2f2;border:2px solid #fca5a5;border-radius:10px;padding:10px 12px;margin-bottom:10px">
      <div style="font-size:.82rem;font-weight:900;color:#dc2626">⛔ ATTENTION — Ce produit a déjà été réchauffé une fois</div>
      <div style="font-size:.75rem;color:#991b1b;margin-top:3px">Ne pas réchauffer à nouveau. Servir immédiatement ou JETER.</div>
    </div>`:''}

    <!-- Cuisinier + Quantité -->
    <div class="fgrid">
      <div class="fg">${etiqChefSel('cuisinier36','e36d','e36sv','Cuisinier')}</div>
      <div class="fg">
        <label>Nb d'étiquettes</label>
        <div style="display:flex;align-items:center;gap:10px;margin-top:4px">
          <button onclick="_e36qty=Math.max(1,_e36qty-1);document.getElementById('e36qd').textContent=_e36qty"
            style="width:36px;height:36px;border-radius:50%;border:2px solid var(--brd);background:var(--fond);font-size:1.3rem;cursor:pointer;font-family:inherit;font-weight:800">−</button>
          <span id="e36qd" style="font-size:1.4rem;font-weight:900;color:var(--plum);min-width:30px;text-align:center">${_e36qty}</span>
          <button onclick="_e36qty=Math.min(20,_e36qty+1);document.getElementById('e36qd').textContent=_e36qty"
            style="width:36px;height:36px;border-radius:50%;border:2px solid var(--plum);background:var(--plum);color:#fff;font-size:1.3rem;cursor:pointer;font-family:inherit;font-weight:800">+</button>
        </div>
        ${(()=>{var r=etiqRestantes(),p=etiqPerPage(),l=printAllTotal();if(p<=1)return '';var libre=r>0?r-l:p-l;if(libre>0&&libre<p&&libre!==_e36qty)return '<button onclick="_e36qty='+libre+';document.getElementById(\'e36qd\').textContent='+libre+'" style="margin-top:5px;padding:4px 10px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:8px;font-size:.68rem;font-weight:800;color:#166534;cursor:pointer;font-family:inherit;width:100%">📄 Compléter la feuille (→ '+libre+')</button>';return '';})()}
      </div>
    </div>

    <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">
      ${d.remise==='OUI'
        ?`<button class="btn-save" style="width:100%;background:#dc2626" onclick="e36JeterConfirm()">🗑️ Enregistrer — JETER</button>`
        :`<button class="btn-save" style="width:100%" onclick="e36Save()">✅ Enregistrer + Imprimer</button>
          <div style="display:flex;gap:8px">
            <button class="btn btn-sec" style="flex:1;touch-action:manipulation" onclick="e36AddBatch()">➕ Ajouter au lot</button>
            <button class="btn btn-sec" style="touch-action:manipulation" onclick="e36sr()">🔄</button>
          </div>`
      }
      ${d.remise==='OUI'?`<button class="btn btn-sec" style="touch-action:manipulation" onclick="e36sr()">🔄 Effacer</button>`:''}
    </div>
  </div>

  ${batchHtml}
  ${printAllBanner()}
  ${e36RenderHisto(lignes)}`;
}

function e36AutoDlc(){
  const d=e36d();
  const tc=d.type_cons;
  if(!tc)return;
  const dateRef=d.date_prod||today();
  if(tc==='froid'){const f=new Date(dateRef+'T12:00');f.setDate(f.getDate()+3);e36s('dlc',f.toISOString().slice(0,10));}
  else {e36s('dlc',dateRef);} // chaud = même jour
}

function e36JeterConfirm(){
  const d=e36d();
  showConfirm(
    '🗑️ Produit à jeter',
    (d.produit||'Ce produit')+' a déjà été réchauffé une fois. Il doit être jeté. Confirmer ?',
    '🗑️ Confirmer — Jeter',
    ()=>{
      const rec={...d,date:today(),_ts:new Date().toISOString(),_sec:'enr36',jete:true,nb_etiq:0};
      S['enr36']=S['enr36']||{}; S['enr36'].lignes=S['enr36'].lignes||[];
      S['enr36'].lignes.unshift(stampEntry(rec));
      // Créer une NC automatique
      autoCreateNC('ENR36 – Excédents','Produit jeté — '+(d.produit||'excédent')+' (déjà réchauffé une 2e fois)',d.produit||'Excédent','Produit jeté');
      save();
      toast('🗑️ Produit jeté — NC créée automatiquement','warning');
      S['enr36'].draft36={}; _e36qty=1; save(); autoBackup(); renderMain();
    }
  );
}

function e36Save(){
  const d=e36d();
  if(!d.produit){toast('⚠️ Saisissez le nom du plat','warning');return;}
  const nb=_e36qty;
  const rec={...d,date:today(),_ts:new Date().toISOString(),_sec:'enr36',nb_etiq:nb};
  const sim=etiqSimule(nb+printAllTotal());
  function doSave(){
    S['enr36']=S['enr36']||{}; S['enr36'].lignes=S['enr36'].lignes||[];
    S['enr36'].lignes.unshift(stampEntry(rec));
    save();
    try { SupaEngine.enqueue('enr36', rec); } catch(e){}
    e36Print([{...rec,nb:nb}]);
    S['enr36'].draft36={}; _e36qty=1; save(); renderMain();
    setTimeout(function(){
      showConfirm('🖨️ Étiquettes bien imprimées ?',
        etiqConfirmMsg(nb),
        '✅ Oui, c\'est imprimé',
        function(){ etiqAfterPrint(nb); renderMain(); toast('📄 Compteur mis à jour','success'); });
    },1500);
  }
  if(sim&&!sim.rentreTotal&&sim.gaspillees>=Math.floor(etiqPerPage()/2)){
    showConfirm('⚠️ Gaspillage détecté',
      sim.gaspillees+' case'+(sim.gaspillees>1?'s':'')+' seront gaspillée'+(sim.gaspillees>1?'s':'')+'. 💡 Utilise le lot (➕) pour grouper avec d\'autres étiquettes.',
      '🖨️ Imprimer quand même', doSave);
  } else { doSave(); }
}

function e36AddBatch(){
  const d=e36d();
  if(!d.produit){toast('⚠️ Saisissez le nom du plat','warning');return;}
  _e36batch.push({...d,nb:_e36qty});
  toast(`✅ Ajouté au lot`,'success');
  S['enr36'].draft36={}; _e36qty=1; save(); autoBackup(); renderNav(); renderMain();
}

function e36PrintBatch(){
  S['enr36']=S['enr36']||{}; S['enr36'].lignes=S['enr36'].lignes||[];
  _e36batch.forEach(b=>S['enr36'].lignes.unshift(stampEntry({...b,date:today(),_ts:new Date().toISOString(),_sec:'enr36',nb_etiq:b.nb})));
  save();
  const nb36=_e36batch.reduce(function(s,b){return s+(b.nb||1);},0);
  e36Print([..._e36batch]);
  autoBackup();
  setTimeout(function(){
    showConfirm('🖨️ Étiquettes bien imprimées ?',etiqConfirmMsg(nb36),'✅ Oui, vider le lot',function(){
      etiqAfterPrint(nb36);
      _e36batch=[]; renderNav(); renderMain(); toast('✅ Lot excédents vidé','success');
    });
  },1500);
}

function e36Print(items){
  const logoLine=etiqLogoLine();
  const makeLabel=(rec)=>{
    const dlcDisp=rec.dlc?new Date(rec.dlc+'T12:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'}):'__/__/____';
    const dateProd=rec.date_prod?new Date(rec.date_prod+'T12:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'}):'__/__/____';
    const isFroid=rec.type_cons!=='chaud';
    const dejaRech=rec.remise==='OUI';
    return`<div class="etiq" style="border-color:${isFroid?'#1d4ed8':'#dc2626'}">
      <div class="hd" style="border-color:${isFroid?'#1d4ed8':'#dc2626'}">
        <span class="logo">${logoLine}</span>
        <span class="title" style="background:${isFroid?'#1d4ed8':'#dc2626'}">${isFroid?'❄️ EXCÉDENT FROID':'🔥 EXCÉDENT CHAUD'}</span>
      </div>
      <div class="prod">${rec.produit||'—'}</div>
      <div class="row">Produit le : <b>${dateProd}</b>${rec.heure_prod?' à <b>'+rec.heure_prod+'</b>':''}</div>
      <div class="row">Conservation : <b>${isFroid?'0°C / +3°C':'≥ +63°C'}</b></div>
      ${dejaRech?`<div class="rech-warn">⛔ DÉJÀ RÉCHAUFFÉ — NE PAS RÉCHAUFFER</div>`:
        `<div class="rech-ok">✅ 1ère remise en T°C autorisée</div>`}
      <div class="dlc" style="background:${isFroid?'#eff6ff':'#fff5f5'};border-color:${isFroid?'#bfdbfe':'#fca5a5'}">
        <span style="color:${isFroid?'#1d4ed8':'#dc2626'}">
          ${isFroid?'🗓️ Consommer avant :':'⏰ Servir avant (2h) :'}
        </span>
        <b>${dlcDisp}</b>
      </div>
      ${rec.cuisinier36?`<div class="oper">👤 ${rec.cuisinier36}</div>`:''}
    </div>`;
  };

  const allLabels=[];
  items.forEach(rec=>{for(let i=0;i<(rec.nb||1);i++)allLabels.push(makeLabel(rec));});

  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Excédents</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:Arial,sans-serif;background:#f5f5f5;padding:12px;}
    .no-print{background:#fff;border-radius:10px;padding:10px 12px;margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;box-shadow:0 1px 4px rgba(0,0,0,.1);}
    .page{display:flex;flex-wrap:wrap;gap:12px;}
    .etiq{width:calc(100vw - 24px);max-width:360px;border:2.5px solid #333;border-radius:5px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.1);}
    .hd{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #333;padding-bottom:6px;}
    .logo{font-size:9px;font-weight:bold;color:#c93a78;}
    .title{color:#fff;font-size:11px;font-weight:bold;padding:2px 7px;border-radius:3px;}
    .prod{font-size:14px;font-weight:bold;color:#111;line-height:1.2;}
    .row{font-size:10px;color:#333;}
    .rech-warn{font-size:10px;font-weight:bold;color:#dc2626;background:#fee2e2;border-radius:3px;padding:5px;}
    .rech-ok{font-size:10px;font-weight:bold;color:#166534;background:#dcfce7;border-radius:3px;padding:5px;}
    .dlc{font-size:11px;font-weight:bold;border:1.5px solid #ccc;border-radius:4px;padding:6px;display:flex;flex-direction:column;gap:3px;}
    .oper{font-size:9px;color:#888;}
  </style>
  <style>${buildA4PrintCss(getEtiqA4Fmt(),'.hd{padding-bottom:1mm;}.logo{font-size:6pt;}.title{font-size:7pt;padding:0.5mm 1.5mm;}.prod{font-size:9pt;line-height:1.1;}.row{font-size:6.5pt;}.rech-warn,.rech-ok{font-size:6.5pt;padding:0.8mm;}.dlc{font-size:7.5pt;padding:1mm;gap:0.5mm;margin-top:0.5mm;}.oper{font-size:6pt;}')}</style>
  </head><body>
  <div class="no-print" style="background:#fff;border-radius:10px;padding:10px 12px;margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;box-shadow:0 1px 4px rgba(0,0,0,.1);">
    <button onclick="window.print()" style="background:#5C1E5A;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer;font-weight:bold">🖨️ Imprimer</button>
    <span style="font-size:12px;background:#f0e4f0;color:#5C1E5A;padding:6px 12px;border-radius:8px;font-weight:700">🏷️ ${getEtiqA4Fmt().label}</span>
    <button onclick="window.close()" style="background:#eee;color:#333;border:1px solid #ccc;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer">✕ Fermer</button>
    <span style="font-size:13px;color:#666">${allLabels.length} étiquette${allLabels.length>1?'s':''}</span>
  </div>
  <div class="page">${allLabels.join('')}</div>
  </body></html>`;

  openPrintWindow(html);
  var _nb36=allLabels.length;
  setTimeout(function(){
    showConfirm('🖨️ Étiquettes bien imprimées ?',etiqConfirmMsg(_nb36),'✅ Oui, compteur mis à jour',function(){
      etiqAfterPrint(_nb36); renderMain(); toast('📄 Compteur mis à jour','success');
    });
  },1500);
}

function e36RenderHisto(lignes){
  if(!lignes.length)return`<div class="card"><div class="hh"><span class="hh-title">📜 Historique excédents</span><span class="hh-badge">0</span></div><div class="empty-s">Aucun excédent enregistré.</div></div>`;
  const t=today();
  const rows=[...lignes].slice(0,30).map((r,i)=>{
    const isExpire=r.dlc&&r.dlc<t;
    const isFroid=r.type_cons!=='chaud';
    const recJson=JSON.stringify(r).replace(/"/g,"'");
    const fnPrint=`reimprAsk('enr36',${recJson},${r.nb_etiq||1})`;
    const fnDel=`nettAdminGuard(()=>{deleteENRLigne('enr36',${i},'Supprimer cet excédent ? Il sera retiré du cloud.')})`;
    return`<div class="swipe-row" data-swipe-left="${fnPrint}" data-swipe-right="${fnDel}">
      <div class="swipe-action swipe-action-del">🗑 Supprimer</div>
      <div class="swipe-action swipe-action-right">🖨️ Réimprimer</div>
      <div class="swipe-row-inner">
        <div style="font-size:1.2rem;flex-shrink:0">${isFroid?'❄️':'🔥'}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:.92rem;font-weight:800;color:${isExpire?'#dc2626':'var(--gris)'}"> ${escH(r.produit||'—')}</div>
          <div style="font-size:.75rem;color:#b89ab6;margin-top:3px">
            ${r.date_prod||r.date||''} ${r.heure_prod?'à '+r.heure_prod:''}
          </div>
          <div style="font-size:.78rem;font-weight:700;margin-top:3px">
            <span style="color:${isExpire?'#dc2626':'#166534'}">DLC: ${r.dlc?new Date(r.dlc+'T12:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'}):'—'}</span>
            ${r.remise==='OUI'?'· <span style="color:#dc2626">⛔ Ne plus réchauffer</span>':''}
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
  const html=`<div class="card">
    <div class="hh"><span class="hh-title">📜 Historique excédents</span><span class="hh-badge">${lignes.length}</span></div>
    <div style="font-size:.68rem;color:#b89ab6;padding:0 14px 8px">← Glisser à gauche = réimprimer · Glisser à droite = supprimer</div>
    <div id="e36-histo-list" style="padding:0 14px 10px">${rows}</div>
  </div>`;
  setTimeout(function(){initSwipeRows(document.getElementById('e36-histo-list'));},120);
  return html;
}

// ════════════════════════════════════════════════════
// ENR34 — ÉTIQUETTES DE PRODUCTION v2
// ════════════════════════════════════════════════════

const DLC_BASE = [
  {famille:'🥩 Viandes & Charcuteries', produit:'Charcuteries (saucisses, andouillettes, lardons…)', stockage:'0/+3°C', dlc_j:2},
  {famille:'🥩 Viandes & Charcuteries', produit:'Charcuterie découpée sur place', stockage:'0/+3°C', dlc_j:1},
  {famille:'🥩 Viandes & Charcuteries', produit:'Viandes crues fraîches ou saumurée', stockage:'0/+3°C', dlc_j:2},
  {famille:'🥩 Viandes & Charcuteries', produit:'Viandes marinées', stockage:'0/+3°C', dlc_j:1},
  {famille:'🥩 Viandes & Charcuteries', produit:'Viandes hachées fraîches', stockage:'0/+2°C', dlc_j:0, dlc_h:24},
  {famille:'🥦 Fruits & Légumes frais', produit:'Fruits et légumes décontaminés', stockage:'0/+3°C', dlc_j:3},
  {famille:'🥦 Fruits & Légumes frais', produit:'Fruits et légumes frais prêts à l\'emploi', stockage:'0/+3°C', dlc_j:3},
  {famille:'🧀 Produits laitiers', produit:'Beurres et margarines', stockage:'0/+3°C', dlc_j:null, dlc_ddm:true},
  {famille:'🧀 Produits laitiers', produit:'Crème fraîche, laits', stockage:'0/+3°C', dlc_j:3},
  {famille:'🧀 Produits laitiers', produit:'Fromages (râpés, tartiflette…)', stockage:'0/+3°C', dlc_j:3},
  {famille:'🧀 Produits laitiers', produit:'Fromage blanc en seau', stockage:'0/+3°C', dlc_j:3},
  {famille:'🥚 Œufs & Ovoproduits', produit:'Ovoproduits liquides', stockage:'0/+3°C', dlc_j:2},
  {famille:'🥚 Œufs & Ovoproduits', produit:'Œufs en poche', stockage:'0/+3°C', dlc_j:3},
  {famille:'🥫 Produits appertisés', produit:'Concentré de tomate, olives…', stockage:'0/+3°C', dlc_j:3},
  {famille:'🥫 Produits appertisés', produit:'Conserves poisson/viande/légumes/crèmes desserts', stockage:'0/+3°C', dlc_j:2},
  {famille:'🥖 Boulangerie', produit:'Pain de mie', stockage:'Ambiant', dlc_j:null, dlc_ddm:true},
  {famille:'🥐 Pâtisserie', produit:'Coques, bouchées, chou, baba, génoise', stockage:'Ambiant', dlc_j:null, dlc_ddm:true},
  {famille:'🧴 Sauces & Condiments', produit:'Moutarde, vinaigrette, ketchup, mayonnaise', stockage:'0/+3°C', dlc_j:null, dlc_ddm:true},
  {famille:'🍝 Féculents & Légumes secs', produit:'Pâtes, riz, semoule, boulgour, légumes secs', stockage:'Ambiant', dlc_j:null, dlc_ddm:true},
  {famille:'🫙 Produits lyophilisés', produit:'Poudres, potages, entremets', stockage:'Ambiant', dlc_j:null, dlc_ddm:true},
  {famille:'🫙 Produits lyophilisés', produit:'Fonds de sauce, gélifiant, liant', stockage:'Ambiant', dlc_j:null, dlc_ddm:true},
  {famille:'🛒 Épicerie Divers', produit:'Épices, aromates, herbes lyophilisées', stockage:'Ambiant', dlc_j:null, dlc_ddm:true},
  {famille:'🛒 Épicerie Divers', produit:'Confiture', stockage:'0/+3°C', dlc_j:5},
  {famille:'🛒 Épicerie Divers', produit:'Topping, coulis, sirop, pâte à tartiner', stockage:'Ambiant', dlc_j:null, dlc_ddm:true},
  {famille:'🛒 Épicerie Divers', produit:'Fruits secs et oléagineux', stockage:'Ambiant', dlc_j:null, dlc_ddm:true},
  {famille:'❄️ Surgelés', produit:'Produits surgelés', stockage:'-18°C', dlc_j:null, dlc_ddm:true},
  {famille:'🍲 Production interne', produit:'Plat cuisiné refroidi J+3', stockage:'0/+3°C', dlc_j:3},
  {famille:'🍲 Production interne', produit:'Plat cuisiné refroidi J+1', stockage:'0/+3°C', dlc_j:1},
  {famille:'🍲 Production interne', produit:'Plat cuisiné refroidi J+2', stockage:'0/+3°C', dlc_j:2},
];

function dlcCalc(item, dateRef){
  const d = new Date(dateRef+'T12:00');
  if(item.dlc_ddm) return null;
  if(item.dlc_h){ const fin=new Date(d.getTime()+item.dlc_h*3600000); return fin.toISOString().slice(0,10); }
  if(item.dlc_j!==null&&item.dlc_j!==undefined){ const fin=new Date(d); fin.setDate(fin.getDate()+item.dlc_j); return fin.toISOString().slice(0,10); }
  return null;
}

function dlcLabel(item){ return item.dlc_ddm?'DDM d\'origine':item.dlc_h?'24h':item.dlc_j!==null?'J+'+item.dlc_j:'—'; }

// ── State ENR34 ────────────────────────────────────
function e34d(){ return (S['enr34']||{}).draft34||{}; }
function e34s(k,v){ S['enr34']=S['enr34']||{}; S['enr34'].draft34=S['enr34'].draft34||{}; S['enr34'].draft34[k]=v; save(); }
function e34sR(k,v){ e34s(k,v); renderMain(); } // avec re-render (boutons, selects)
function e34sr(){ S['enr34']=S['enr34']||{}; S['enr34'].draft34={}; _e34sel=null; _e34qty=1; save(); renderMain(); }
let _e34sel=null, _e34qty=1;

// ── Analyse gaspillage feuille ─────────────────────────────────────
// Retourne {feuilles, restantesApres, nouvellesFeuilles, conseil, couleur}
function etiqWasteInfo(nb){
  var perPage=etiqPerPage();
  if(perPage<=1) return null; // thermique
  var restantes=etiqRestantes();
  var total=nb;
  var feuilles=0;
  var r=restantes;
  // On remplit la feuille en cours d'abord
  if(r>0){
    if(total<=r){
      // On reste sur la feuille en cours
      return {
        feuilles:0, restantesApres:r-total, nouvellesFeuilles:0,
        conseil: total===r
          ? '✅ Parfait — complète exactement la feuille en cours'
          : '📄 Reste sur la feuille en cours · '+( r-total)+' case'+(r-total>1?'s':'')+' libres après',
        couleur:'#166534', bg:'#f0fdf4', border:'#86efac'
      };
    }
    total-=r;
    feuilles+=1; // on compte la feuille en cours comme utilisée
  }
  // Nouvelles feuilles entamées
  var nouvellesFeuilles=Math.ceil(total/perPage);
  var restantesApres=(perPage-(total%perPage))%perPage;
  var totalFeuilles=(r>0?1:0)+nouvellesFeuilles;
  var couleur,bg,border;
  if(restantesApres===0){
    couleur='#166534';bg='#f0fdf4';border='#86efac';
  } else if(restantesApres>=Math.floor(perPage/2)){
    couleur='#92400e';bg='#fffbeb';border='#fcd34d';
  } else {
    couleur='#1e40af';bg='#eff6ff';border='#bfdbfe';
  }
  var fStr=totalFeuilles===1?'1 feuille':(totalFeuilles+' feuilles');
  var conseil;
  if(restantesApres===0){
    conseil='✅ '+fStr+' complète'+(totalFeuilles>1?'s':'');
  } else if(restantesApres>=Math.floor(perPage/2)){
    conseil='⚠️ '+fStr+' utilisée'+(totalFeuilles>1?'s':'')+' — '+restantesApres+' case'+(restantesApres>1?'s':'')+' gaspillée'+(restantesApres>1?'s':'');
  } else {
    conseil='📄 '+fStr+' · '+restantesApres+' case'+(restantesApres>1?'s':'')+' libre'+(restantesApres>1?'s':'')+' après';
  }
  return {feuilles:totalFeuilles, restantesApres, nouvellesFeuilles, conseil, couleur, bg, border};
}

// ── HTML inline du résumé feuille (pour afficher dans les lots) ────
function etiqWasteHtml(nb){
  if(!nb) return '';
  var perPage=etiqPerPage();
  if(perPage<=1) return '';
  var info=etiqWasteInfo(nb);
  if(!info) return '';
  return '<div style="font-size:.68rem;font-weight:700;color:'+info.couleur+';background:'+info.bg+';border:1px solid '+info.border+';border-radius:6px;padding:4px 8px;margin-top:5px;text-align:center">'+info.conseil+'</div>';
}

// ── Quantité suggérée pour compléter la feuille ───────────────────
function etiqSuggestQty(){
  var perPage=etiqPerPage();
  if(perPage<=1) return null;
  var r=etiqRestantes();
  var lotActuel=printAllTotal();
  if(r===0){
    // Feuille vierge : suggérer de remplir
    if(lotActuel>0&&lotActuel<perPage) return perPage-lotActuel;
    return null;
  }
  // Feuille en cours : combien il manque pour la compléter
  var manque=r-lotActuel;
  if(manque>0&&manque<r) return manque;
  return null;
}
// Stocké dans S.config.etiqRestantes (nombre de cases libres sur la feuille en cours)
// Réinitialisé à chaque nouvelle feuille entamée
function etiqPerPage(){
  var fmt=getEtiqA4Fmt();
  return fmt.perPage||14;
}
function etiqRestantes(){
  return (S.config&&typeof S.config.etiqRestantes==='number') ? S.config.etiqRestantes : 0;
}
// Appelé après chaque impression confirmée — nb = nombre d'étiquettes imprimées
function etiqAfterPrint(nb){
  if(!nb) return;
  var perPage=etiqPerPage();
  if(perPage<=1) return; // thermique : pas de notion de feuille
  var restantes=etiqRestantes();
  // On consomme les cases restantes puis on entame de nouvelles feuilles
  var total=restantes>0 ? restantes+((nb-restantes<=0)?0:0) : 0;
  // Calcul simple : (restantes - nb) sur la feuille en cours
  // Si nb > restantes, on entame une ou plusieurs nouvelles feuilles
  var apres;
  if(restantes===0){
    // Feuille fraîche : on calcule ce qu'il reste après
    apres=(perPage-(nb%perPage))%perPage;
  } else {
    // On continue la feuille en cours
    var utilise=nb;
    var r=restantes;
    // On finit la feuille en cours
    if(utilise>=r){
      utilise-=r;
      // puis nouvelles feuilles
      apres=(perPage-(utilise%perPage))%perPage;
    } else {
      apres=r-utilise;
    }
  }
  S.config=S.config||{};
  S.config.etiqRestantes=apres;
  save();
}
function etiqReinitFeuille(){
  S.config=S.config||{}; S.config.etiqRestantes=0; save(); renderMain();
  toast('📄 Nouvelle feuille — 0 case utilisée','success');
}

// ── Calcule la situation d'un lot avant impression ─────────────────
// Retourne {rentreTotal, feuillesNeuves, gaspillees, parfait}
function etiqSimule(nbAImprimer){
  var perPage=etiqPerPage();
  var restantes=etiqRestantes();
  // Cases dispo sur la feuille en cours (0 = feuille vierge = perPage dispo)
  var dispoFeuilleCours=restantes>0 ? restantes : perPage;
  if(nbAImprimer<=dispoFeuilleCours){
    return {
      rentreTotal:true, feuillesNeuves:0,
      gaspillees:0, manquantes:dispoFeuilleCours-nbAImprimer,
      parfait:nbAImprimer===dispoFeuilleCours
    };
  }
  // Débordement
  var apresPremieFeuille=nbAImprimer-dispoFeuilleCours;
  var feuillesNeuves=Math.ceil(apresPremieFeuille/perPage);
  var derniereFeuilleUsed=apresPremieFeuille%perPage||perPage;
  var gaspillees=derniereFeuilleUsed<perPage ? perPage-derniereFeuilleUsed : 0;
  return {
    rentreTotal:false, feuillesNeuves:feuillesNeuves,
    gaspillees:gaspillees, manquantes:0, parfait:false
  };
}

// ── Grille visuelle des cases ──────────────────────────────────────
// t33/t36f/t36c/t34 = nb de chaque type dans le lot en cours
function etiqGrilleHtml(){
  var perPage=etiqPerPage();
  var isTherm=getEtiqA4Fmt().id.startsWith('therm');
  if(isTherm||perPage<=1) return '';

  var restantes=etiqRestantes();
  // Cases occupées sur la feuille en cours
  var occupees=restantes>0 ? perPage-restantes : 0;

  // Couleurs par type
  var t33=_e33batch.reduce(function(s,b){return s+(b.nb||1);},0);
  var t36f=_e36batch.reduce(function(s,b){return b.type_cons!=='chaud'?s+(b.nb||1):s;},0);
  var t36c=_e36batch.reduce(function(s,b){return b.type_cons==='chaud'?s+(b.nb||1):s;},0);
  var t34=_e34batch.reduce(function(s,b){return s+(b.nb||1);},0);
  var total=t33+t36f+t36c+t34;

  // Construire les cases
  var cases=[];
  // Cases déjà imprimées sur la feuille (grises foncées)
  for(var i=0;i<occupees;i++) cases.push('used');
  // Cases du lot courant par type
  for(var i=0;i<t33;i++) cases.push('temoin');
  for(var i=0;i<t34;i++) cases.push('prod');
  for(var i=0;i<t36f;i++) cases.push('excf');
  for(var i=0;i<t36c;i++) cases.push('excc');
  // Cases libres restantes
  while(cases.length<perPage) cases.push('libre');
  // Si débordement : cases supplémentaires
  if(cases.length>perPage){
    // Afficher 2 feuilles max
    while(cases.length<perPage*2) cases.push('libre');
  }

  var colorMap={
    'used':'#c4b5c4',    // déjà imprimé
    'temoin':'#5C1E5A',  // plat témoin — violet
    'prod':'#f97316',    // production — orange
    'excf':'#1d4ed8',    // excédent froid — bleu
    'excc':'#dc2626',    // excédent chaud — rouge
    'libre':'#f0e4f0'    // libre — mauve clair
  };

  var cols=2; // toujours 2 colonnes pour A4 14/feuille
  var rows=Math.ceil(cases.length/cols);
  // Grouper par feuille
  var feuille1=cases.slice(0,perPage);
  var feuille2=cases.length>perPage?cases.slice(perPage):[];

  function renderFeuille(arr,titre){
    var r=Math.ceil(arr.length/cols);
    var cells=arr.map(function(c,i){
      var lbl='';
      if(c==='used') lbl='✓';
      if(c==='temoin') lbl='👁';
      if(c==='prod') lbl='🏷';
      if(c==='excf') lbl='❄';
      if(c==='excc') lbl='🔥';
      return '<div style="width:22px;height:13px;border-radius:2px;background:'+colorMap[c]+';display:flex;align-items:center;justify-content:center;font-size:7px;color:'+(c==='libre'?'#b89ab6':'rgba(255,255,255,.8)')+'">'+lbl+'</div>';
    }).join('');
    return '<div style="margin-right:10px">'
      +'<div style="font-size:.6rem;color:#b89ab6;font-weight:700;margin-bottom:3px;text-align:center">'+titre+'</div>'
      +'<div style="display:grid;grid-template-columns:repeat('+cols+',22px);gap:2px">'+cells+'</div>'
      +'</div>';
  }

  var legende='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">'
    +(occupees>0?'<span style="display:flex;align-items:center;gap:3px;font-size:.6rem;color:#888"><span style="width:10px;height:10px;border-radius:2px;background:#c4b5c4;display:inline-block"></span>déjà imprimé</span>':'')
    +(t33>0?'<span style="display:flex;align-items:center;gap:3px;font-size:.6rem;color:#888"><span style="width:10px;height:10px;border-radius:2px;background:#5C1E5A;display:inline-block"></span>témoin</span>':'')
    +(t34>0?'<span style="display:flex;align-items:center;gap:3px;font-size:.6rem;color:#888"><span style="width:10px;height:10px;border-radius:2px;background:#f97316;display:inline-block"></span>production</span>':'')
    +(t36f>0?'<span style="display:flex;align-items:center;gap:3px;font-size:.6rem;color:#888"><span style="width:10px;height:10px;border-radius:2px;background:#1d4ed8;display:inline-block"></span>excéd. froid</span>':'')
    +(t36c>0?'<span style="display:flex;align-items:center;gap:3px;font-size:.6rem;color:#888"><span style="width:10px;height:10px;border-radius:2px;background:#dc2626;display:inline-block"></span>excéd. chaud</span>':'')
    +'</div>';

  return '<div style="background:#fdf4ff;border:1.5px solid #e9d5ff;border-radius:10px;padding:10px 12px;margin-bottom:8px">'
    +'<div style="font-size:.72rem;font-weight:800;color:#7A6579;margin-bottom:6px">📄 Placement sur la feuille</div>'
    +'<div style="display:flex;align-items:flex-start">'
    +renderFeuille(feuille1,'Feuille en cours')
    +(feuille2.length>0?renderFeuille(feuille2,'Nouvelle feuille'):'')
    +'</div>'
    +legende
    +'</div>';
}

function printAllBanner(){
  var total=printAllTotal();
  var restantes=etiqRestantes();
  var perPage=etiqPerPage();
  var isTherm=getEtiqA4Fmt().id.startsWith('therm');

  if(isTherm){
    if(!total) return '';
    return '<div style="background:linear-gradient(135deg,#3b1f8c,#5C1E5A);border-radius:12px;padding:11px 14px;margin-bottom:10px;display:flex;align-items:center;gap:10px">'
      +'<span style="font-size:.8rem;color:rgba(255,255,255,.85);flex:1">🗂️ <b style="color:#fff">'+total+' étiquette'+(total>1?'s':'')+' en attente</b></span>'
      +'<button onclick="printAllLabels()" style="background:#fff;color:#5C1E5A;border:none;border-radius:8px;padding:7px 13px;font-size:.78rem;font-weight:900;cursor:pointer;font-family:inherit;white-space:nowrap;touch-action:manipulation">🖨️ Imprimer</button>'
      +'</div>';
  }

  // Calcul situation
  var sim=total>0?etiqSimule(total):null;
  var dispoFeuilleCours=restantes>0?restantes:perPage;

  // ── Bannière état feuille ──
  var feuilleHtml='';
  if(restantes>0){
    var conseil=total>0&&total<dispoFeuilleCours
      ? ' — ajoute <b>'+(dispoFeuilleCours-total)+'</b> étiquette'+(dispoFeuilleCours-total>1?'s':'')+' pour remplir'
      : '';
    feuilleHtml='<div style="background:linear-gradient(135deg,#166534,#15803d);border-radius:12px;padding:10px 14px;margin-bottom:8px;display:flex;align-items:center;gap:10px">'
      +'<span style="font-size:1.1rem">📄</span>'
      +'<span style="font-size:.78rem;color:rgba(255,255,255,.95);flex:1"><b style="color:#fff">'+restantes+' case'+(restantes>1?'s':'')+' libres</b> sur la feuille en cours'+conseil+'</span>'
      +'<button onclick="etiqReinitFeuille()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:5px 9px;font-size:.65rem;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap">🔄 Nouvelle feuille</button>'
      +'</div>';
  } else if(total>0){
    feuilleHtml='<div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:10px;padding:7px 12px;margin-bottom:8px;font-size:.72rem;color:#166534;font-weight:700">'
      +'📄 Feuille vierge — '+perPage+' cases disponibles'
      +'</div>';
  }

  if(!total) return feuilleHtml;

  // ── Grille visuelle ──
  var grilleHtml=etiqGrilleHtml();

  // ── Alerte débordement ou confirmation ──
  var alerteHtml='';
  if(sim&&sim.parfait){
    alerteHtml='<div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:10px;padding:7px 12px;margin-bottom:8px;font-size:.72rem;color:#166534;font-weight:800">'
      +'🎯 Parfait — ce lot complète exactement la feuille, zéro gaspillage !'
      +'</div>';
  } else if(sim&&!sim.rentreTotal){
    alerteHtml='<div style="background:#fff7ed;border:1.5px solid #fed7aa;border-radius:10px;padding:8px 12px;margin-bottom:8px;font-size:.72rem;color:#92400e">'
      +'⚠️ Ce lot déborde sur <b>'+sim.feuillesNeuves+' nouvelle'+(sim.feuillesNeuves>1?'s':'')+' feuille'+(sim.feuillesNeuves>1?'s':'')+' — '+sim.gaspillees+' case'+(sim.gaspillees>1?'s':'')+' gaspillée'+(sim.gaspillees>1?'s':'')+'</b>'
      +(sim.gaspillees>0?'<span style="display:block;margin-top:2px;font-size:.68rem">💡 Réduis le lot de '+sim.gaspillees+' pour éviter le gaspillage</span>':'')
      +'</div>';
  } else if(sim&&sim.manquantes>0){
    alerteHtml='<div style="background:#fffbeb;border:1.5px solid #fde68a;border-radius:10px;padding:7px 12px;margin-bottom:8px;font-size:.72rem;color:#92400e">'
      +'💡 '+sim.manquantes+' case'+(sim.manquantes>1?'s':'')+' libre'+(sim.manquantes>1?'s':'')+' après impression — ajoute des étiquettes pour ne pas gaspiller'
      +'</div>';
  }

  // ── Résumé lot ──
  var parts=[];
  var t33=_e33batch.reduce(function(s,b){return s+(b.nb||1);},0);
  var t36=_e36batch.reduce(function(s,b){return s+(b.nb||1);},0);
  var t34=_e34batch.reduce(function(s,b){return s+(b.nb||1);},0);
  if(t33) parts.push(t33+' témoin'+(t33>1?'s':''));
  if(t36) parts.push(t36+' excédent'+(t36>1?'s':''));
  if(t34) parts.push(t34+' prod.');

  var lotHtml='<div style="background:linear-gradient(135deg,#3b1f8c,#5C1E5A);border-radius:12px;padding:11px 14px;margin-bottom:10px;display:flex;align-items:center;gap:10px">'
    +'<span style="font-size:.8rem;color:rgba(255,255,255,.85);flex:1">'
    +'🗂️ <b style="color:#fff">'+total+' étiquette'+(total>1?'s':'')+' en attente</b>'
    +'<span style="font-size:.68rem;opacity:.75"> — '+parts.join(' · ')+'</span>'
    +'</span>'
    +'<button onclick="printAllLabels()" style="background:#fff;color:#5C1E5A;border:none;border-radius:8px;padding:7px 13px;font-size:.78rem;font-weight:900;cursor:pointer;font-family:inherit;white-space:nowrap;touch-action:manipulation">🖨️ Tout imprimer</button>'
    +'</div>';

  return feuilleHtml+grilleHtml+alerteHtml+lotHtml;
}
// ── Message confirm post-impression avec récap feuille ────────────
function etiqConfirmMsg(nb){
  var perPage=etiqPerPage();
  if(perPage<=1) return 'Si oui, le compteur sera mis à jour.';
  var sim=etiqSimule(nb);
  if(!sim) return 'Si oui, le compteur sera mis à jour.';
  if(sim.parfait) return '🎯 Parfait — ce lot complète exactement la feuille, zéro gaspillage !';
  if(sim.rentreTotal){
    if(sim.manquantes===0) return '✅ Feuille complète — aucun gaspillage.';
    return '📄 Il restera '+sim.manquantes+' case'+(sim.manquantes>1?'s':'')+' libre'+(sim.manquantes>1?'s':'')+' sur la feuille — garde-la pour la prochaine impression.';
  }
  return '⚠️ '+sim.feuillesNeuves+' nouvelle'+(sim.feuillesNeuves>1?'s':'')+' feuille'+(sim.feuillesNeuves>1?'s':'')+' entamée'+(sim.feuillesNeuves>1?'s':'')+' — '+sim.gaspillees+' case'+(sim.gaspillees>1?'s':'')+' gaspillée'+(sim.gaspillees>1?'s':'')+'.\nConserve la feuille pour la suite.';
}

// ── Modale SWIPE RÉIMPRIMER — choix Imprimer seul / Ajouter au lot ──
function reimprAsk(type, rec, nb){
  nb = nb || rec.nb_etiq || 1;
  var label = rec.produit || '—';
  var ovId='reimpr-ov';
  var prev=document.getElementById(ovId); if(prev) prev.remove();
  var ov=document.createElement('div');
  ov.id=ovId;
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  ov.innerHTML='<div style="background:#fff;border-radius:16px;padding:20px;max-width:360px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.3)">'+
    '<div style="font-size:1.05rem;font-weight:900;color:var(--plum);margin-bottom:6px">🖨️ Réimprimer ?</div>'+
    '<div style="font-size:.85rem;color:var(--gris);margin-bottom:4px"><b>'+escH(label)+'</b></div>'+
    '<div style="font-size:.72rem;color:#888;margin-bottom:16px">'+nb+' étiquette'+(nb>1?'s':'')+'</div>'+
    '<button id="reimpr-print" style="width:100%;background:linear-gradient(135deg,var(--mag),var(--plum));color:#fff;border:none;border-radius:12px;padding:14px;font-size:.9rem;font-weight:800;cursor:pointer;font-family:inherit;margin-bottom:8px;touch-action:manipulation">🖨️ Imprimer maintenant</button>'+
    '<button id="reimpr-edit" style="width:100%;background:#fef3c7;color:#92400e;border:1.5px solid #fcd34d;border-radius:12px;padding:12px;font-size:.85rem;font-weight:800;cursor:pointer;font-family:inherit;margin-bottom:8px;touch-action:manipulation">✏️ Modifier avant d\'imprimer</button>'+
    '<button id="reimpr-lot" style="width:100%;background:#f0f0ff;color:#3333aa;border:1.5px solid #8888ff;border-radius:12px;padding:12px;font-size:.85rem;font-weight:800;cursor:pointer;font-family:inherit;margin-bottom:8px;touch-action:manipulation">➕ Ajouter au lot en cours</button>'+
    '<button id="reimpr-cancel" style="width:100%;background:none;border:1.5px solid var(--brd);border-radius:12px;padding:10px;font-size:.8rem;font-weight:700;color:#666;cursor:pointer;font-family:inherit;touch-action:manipulation">✕ Annuler</button>'+
    '</div>';
  document.body.appendChild(ov);
  var close=function(){ov.remove();};
  document.getElementById('reimpr-cancel').onclick=close;
  document.getElementById('reimpr-print').onclick=function(){
    close();
    if(type==='enr33') e33Print(rec, nb);
    else if(type==='enr34') e34Print([{...rec,nb:nb}]);
    else if(type==='enr36') e36Print([{...rec,nb:nb}]);
    setTimeout(function(){
      showConfirm('🖨️ Étiquettes bien imprimées ?',etiqConfirmMsg(nb),'✅ Oui, compteur mis à jour',function(){
        etiqAfterPrint(nb); renderMain(); toast('📄 Compteur mis à jour','success');
      });
    },1500);
  };
  document.getElementById('reimpr-edit').onclick=function(){
    close();
    reimprEditModal(type, rec, nb);
  };
  document.getElementById('reimpr-lot').onclick=function(){
    close();
    var entry={...rec, nb:nb};
    if(type==='enr33'){ _e33batch.push(entry); toast('✅ Ajouté au lot témoins','success'); }
    else if(type==='enr34'){ _e34batch.push(entry); toast('✅ Ajouté au lot production','success'); }
    else if(type==='enr36'){ _e36batch.push(entry); toast('✅ Ajouté au lot excédents','success'); }
    renderNav(); renderMain();
  };
}

// ── Modale d'édition avant réimpression ──────────────────────────────
// Permet de modifier produit, dates, cuisinier, etc. sans toucher à l'historique original
function reimprEditModal(type, rec, nb){
  var ovId='reimpr-edit-ov';
  var prev=document.getElementById(ovId); if(prev) prev.remove();
  var ov=document.createElement('div');
  ov.id=ovId;
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto';

  // Champs selon le type d'étiquette
  var fieldsHtml='';
  var inputStyle='width:100%;padding:10px 12px;border:1.5px solid var(--brd);border-radius:10px;font-size:.85rem;font-family:inherit;box-sizing:border-box;margin-top:4px';
  var labelStyle='font-size:.72rem;font-weight:800;color:var(--plum);margin-top:10px;display:block';

  if(type==='enr34'){
    fieldsHtml =
      '<label style="'+labelStyle+'">Produit</label>'+
      '<input id="ed-produit" type="text" value="'+escH(rec.produit||'')+'" style="'+inputStyle+'">'+
      '<label style="'+labelStyle+'">Date de fabrication</label>'+
      '<input id="ed-date-fab" type="date" value="'+(rec.date_fab||today())+'" style="'+inputStyle+'">'+
      '<label style="'+labelStyle+'">Heure de fabrication</label>'+
      '<input id="ed-heure-fab" type="time" value="'+(rec.heure_fab||nowT())+'" style="'+inputStyle+'">'+
      '<label style="'+labelStyle+'">DLC</label>'+
      '<input id="ed-dlc" type="date" value="'+(rec.dlc||'')+'" style="'+inputStyle+'">'+
      '<label style="'+labelStyle+'">Cuisinier</label>'+
      '<input id="ed-cuisinier" type="text" value="'+escH(rec.cuisinier34||rec.cuisinier||getActiveSession()||'')+'" style="'+inputStyle+'">';
  } else if(type==='enr33'){
    fieldsHtml =
      '<label style="'+labelStyle+'">Produit</label>'+
      '<input id="ed-produit" type="text" value="'+escH(rec.produit||'')+'" style="'+inputStyle+'">'+
      '<label style="'+labelStyle+'">Service</label>'+
      '<input id="ed-service" type="text" value="'+escH(rec.service||'')+'" style="'+inputStyle+'">'+
      '<label style="'+labelStyle+'">Date prélèvement</label>'+
      '<input id="ed-date-prelev" type="date" value="'+(rec.date_prelev||rec.date||today())+'" style="'+inputStyle+'">'+
      '<label style="'+labelStyle+'">Heure prélèvement</label>'+
      '<input id="ed-heure-prelev" type="time" value="'+(rec.heure_prelev||rec.heure||nowT())+'" style="'+inputStyle+'">'+
      '<label style="'+labelStyle+'">Date de destruction</label>'+
      '<input id="ed-date-destruct" type="date" value="'+(rec.date_destruct||'')+'" style="'+inputStyle+'">'+
      '<label style="'+labelStyle+'">Cuisinier</label>'+
      '<input id="ed-cuisinier" type="text" value="'+escH(rec.cuisinier33||rec.cuisinier||getActiveSession()||'')+'" style="'+inputStyle+'">';
  } else if(type==='enr36'){
    fieldsHtml =
      '<label style="'+labelStyle+'">Produit</label>'+
      '<input id="ed-produit" type="text" value="'+escH(rec.produit||'')+'" style="'+inputStyle+'">'+
      '<label style="'+labelStyle+'">Date de production</label>'+
      '<input id="ed-date-prod" type="date" value="'+(rec.date_prod||today())+'" style="'+inputStyle+'">'+
      '<label style="'+labelStyle+'">DLC</label>'+
      '<input id="ed-dlc" type="date" value="'+(rec.dlc||'')+'" style="'+inputStyle+'">'+
      '<label style="'+labelStyle+'">Cuisinier</label>'+
      '<input id="ed-cuisinier" type="text" value="'+escH(rec.cuisinier36||rec.cuisinier||getActiveSession()||'')+'" style="'+inputStyle+'">';
  }

  ov.innerHTML='<div style="background:#fff;border-radius:16px;padding:20px;max-width:380px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.3);max-height:90vh;overflow-y:auto">'+
    '<div style="font-size:1.05rem;font-weight:900;color:var(--plum);margin-bottom:4px">✏️ Modifier avant impression</div>'+
    '<div style="font-size:.72rem;color:#888;margin-bottom:10px">Les modifications ne changent pas l\'historique d\'origine</div>'+
    '<label style="'+labelStyle+';margin-top:2px">Nombre d\'étiquettes</label>'+
    '<input id="ed-nb" type="number" min="1" max="50" value="'+nb+'" style="'+inputStyle+'">'+
    fieldsHtml +
    '<div style="display:flex;gap:8px;margin-top:18px">'+
      '<button id="ed-cancel" style="flex:1;background:none;border:1.5px solid var(--brd);border-radius:12px;padding:12px;font-size:.82rem;font-weight:700;color:#666;cursor:pointer;font-family:inherit;touch-action:manipulation">✕ Annuler</button>'+
      '<button id="ed-print" style="flex:2;background:linear-gradient(135deg,var(--mag),var(--plum));color:#fff;border:none;border-radius:12px;padding:12px;font-size:.85rem;font-weight:800;cursor:pointer;font-family:inherit;touch-action:manipulation">🖨️ Imprimer</button>'+
    '</div>'+
    '<button id="ed-batch" style="width:100%;margin-top:8px;background:#f0f0ff;color:#3333aa;border:1.5px solid #8888ff;border-radius:12px;padding:10px;font-size:.78rem;font-weight:800;cursor:pointer;font-family:inherit;touch-action:manipulation">➕ Plutôt ajouter au lot en cours</button>'+
    '</div>';
  document.body.appendChild(ov);

  var closeEd=function(){ov.remove();};

  // Fonction pour récupérer les modifications
  function buildModifiedRec(){
    var newNb=Math.max(1, Math.min(50, parseInt(document.getElementById('ed-nb').value)||1));
    var r={...rec};
    var gv=function(id){var el=document.getElementById(id);return el?el.value:''; };
    if(type==='enr34'){
      r.produit=gv('ed-produit');
      r.date_fab=gv('ed-date-fab');
      r.heure_fab=gv('ed-heure-fab');
      r.dlc=gv('ed-dlc');
      r.cuisinier34=gv('ed-cuisinier');
    } else if(type==='enr33'){
      r.produit=gv('ed-produit');
      r.service=gv('ed-service');
      r.date_prelev=gv('ed-date-prelev');
      r.heure_prelev=gv('ed-heure-prelev');
      r.date_destruct=gv('ed-date-destruct');
      r.cuisinier33=gv('ed-cuisinier');
    } else if(type==='enr36'){
      r.produit=gv('ed-produit');
      r.date_prod=gv('ed-date-prod');
      r.dlc=gv('ed-dlc');
      r.cuisinier36=gv('ed-cuisinier');
    }
    return {rec:r, nb:newNb};
  }

  document.getElementById('ed-cancel').onclick=closeEd;
  document.getElementById('ed-print').onclick=function(){
    var m=buildModifiedRec();
    closeEd();
    if(type==='enr33') e33Print(m.rec, m.nb);
    else if(type==='enr34') e34Print([{...m.rec,nb:m.nb}]);
    else if(type==='enr36') e36Print([{...m.rec,nb:m.nb}]);
    setTimeout(function(){
      showConfirm('🖨️ Étiquettes bien imprimées ?',etiqConfirmMsg(m.nb),'✅ Oui, compteur mis à jour',function(){
        etiqAfterPrint(m.nb); renderMain(); toast('📄 Compteur mis à jour','success');
      });
    },1500);
  };
  document.getElementById('ed-batch').onclick=function(){
    var m=buildModifiedRec();
    closeEd();
    var entry={...m.rec, nb:m.nb};
    if(type==='enr33'){ _e33batch.push(entry); toast('✅ Ajouté au lot témoins','success'); }
    else if(type==='enr34'){ _e34batch.push(entry); toast('✅ Ajouté au lot production','success'); }
    else if(type==='enr36'){ _e36batch.push(entry); toast('✅ Ajouté au lot excédents','success'); }
    renderNav(); renderMain();
  };
}

// ── Étiquettes PRODUCTION VIDES (trame à remplir à la main) ───────────
function e34PrintBlanks(n){
  if(!n||n<=0) return;
  var blanks=[];
  for(var i=0;i<n;i++){
    blanks.push({ produit:'', statut:'', date_fab:'', heure_fab:'',
      stockage:'0 / +3°C', dlc:'', cuisinier34:'', nb:1 });
  }
  e34Print(blanks);
}

// ── Assistant complément de feuille ─────────────────────────────────
// À appeler après etiqAfterPrint quand il reste des cases libres
// ── Assistant complément de feuille AVANT impression ───────────────
// Appelé au début de chaque PrintBatch/printAllLabels
// Si la feuille peut être complétée avec des blancs, propose au cuisinier
// cb(addBlanks) : callback avec le nb d'étiquettes vides à ajouter (0 si refus)
function askCompleteBeforePrint(nbLot, cb){
  cb = cb || function(){};
  var perPage=etiqPerPage();
  if(perPage<=1){ cb(0); return; }
  var restantes=etiqRestantes();
  // Cases dispo sur la feuille en cours (feuille vierge = perPage, entamée = restantes)
  var dispo = restantes>0 ? restantes : perPage;
  // Combien de blancs faudrait-il ajouter pour remplir pile la feuille ?
  // Si le lot rentre dans la feuille en cours → blancs = dispo - nbLot
  // Sinon, calculer ce qui reste sur la dernière feuille
  var blancsNecessaires;
  if(nbLot <= dispo){
    blancsNecessaires = dispo - nbLot;
  } else {
    // Débordement : le lot prend toute la feuille + une autre
    var apresPremieFeuille = nbLot - dispo;
    var resteDerniere = apresPremieFeuille % perPage;
    blancsNecessaires = resteDerniere===0 ? 0 : (perPage - resteDerniere);
  }
  // Rien à proposer si la feuille est déjà pleine
  if(blancsNecessaires <= 0){ cb(0); return; }
  // Si le lot remplit déjà >= 80% des cases restantes, ne pas proposer (faible gain)
  var totalFeuille = nbLot + blancsNecessaires;
  var msg='Ton lot fait '+nbLot+' étiquette'+(nbLot>1?'s':'')+'. '+
    'Il restera '+blancsNecessaires+' case'+(blancsNecessaires>1?'s':'')+' libre'+(blancsNecessaires>1?'s':'')+' sur la feuille. '+
    'Ajouter '+blancsNecessaires+' étiquette'+(blancsNecessaires>1?'s':'')+' vide'+(blancsNecessaires>1?'s':'')+' (trame à remplir à la main) pour imprimer une feuille complète ?';
  // Utiliser une modale custom avec 2 choix OUI/NON qui appellent tous les deux cb
  var ovId='askblanks-ov';
  var prev=document.getElementById(ovId); if(prev) prev.remove();
  var ov=document.createElement('div');
  ov.id=ovId;
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  ov.innerHTML='<div style="background:#fff;border-radius:16px;padding:20px;max-width:380px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.3)">'+
    '<div style="font-size:1.05rem;font-weight:900;color:var(--plum);margin-bottom:10px">📄 Compléter la feuille ?</div>'+
    '<div style="font-size:.82rem;color:var(--gris);margin-bottom:16px;line-height:1.4">'+msg+'</div>'+
    '<button id="askblanks-yes" style="width:100%;background:linear-gradient(135deg,#15803d,#166534);color:#fff;border:none;border-radius:12px;padding:14px;font-size:.9rem;font-weight:800;cursor:pointer;font-family:inherit;margin-bottom:8px;touch-action:manipulation">✅ Oui, compléter ('+totalFeuille+' étiq. au total)</button>'+
    '<button id="askblanks-no" style="width:100%;background:none;border:1.5px solid var(--brd);border-radius:12px;padding:12px;font-size:.85rem;font-weight:700;color:#666;cursor:pointer;font-family:inherit;touch-action:manipulation">❌ Non, imprimer seulement mon lot</button>'+
    '</div>';
  document.body.appendChild(ov);
  var close=function(){ov.remove();};
  document.getElementById('askblanks-yes').onclick=function(){ close(); cb(blancsNecessaires); };
  document.getElementById('askblanks-no').onclick=function(){ close(); cb(0); };
}

// ── Ancienne askCompleteFeuille (gardée pour compatibilité, ne fait plus rien) ──
function askCompleteFeuille(){ /* obsolète — remplacé par askCompleteBeforePrint */ }

// ── Marquer tous les plats témoins périmés comme jetés ─────────────
function marquerTemoinsJetes(){
  const t = today();
  const lignes = (S['enr33']?.lignes)||[];
  const aJeter = lignes.filter(r=>r.date_destruct && r.date_destruct<t && !r._jete);
  if(aJeter.length===0){ toast('Aucun plat témoin à marquer','info'); return; }
  showConfirm(
    '🗑️ Confirmer la destruction',
    'Marquer les '+aJeter.length+' plat'+(aJeter.length>1?'s':'')+' témoin'+(aJeter.length>1?'s':'')+' périmé'+(aJeter.length>1?'s':'')+' comme détruit'+(aJeter.length>1?'s':'')+' ? Ils ne réapparaîtront plus dans l\'alerte rouge.',
    '✅ Oui, jetés',
    function(){
      aJeter.forEach(r=>{
        r._jete = true;
        r._jete_date = t;
        r._jete_by = getActiveSession()||'';
        try{ SupaEngine.enqueue('enr33', r); }catch(e){}
      });
      save();
      toast('✅ '+aJeter.length+' plat'+(aJeter.length>1?'s':'')+' marqué'+(aJeter.length>1?'s':'')+' détruit'+(aJeter.length>1?'s':''),'success');
      renderNav(); renderMain();
    }
  );
}

// ── Suppression soft-delete vers Supabase ─────────────────────────
// Marque la ligne _deleted:true en base → au prochain chargement elle est ignorée
function deleteLineFromSupabase(sec, ligne){
  if(!ligne||!ligne._ts) return;
  try{
    var tombstone={...ligne, _deleted:true, _sec:sec};
    SupaEngine.enqueue(sec, tombstone);
  }catch(e){ console.warn('[deleteLineFromSupabase]',e); }
}
function deleteENRLigne(sec, idx, confirmMsg, onDone){
  var lignes=(S[sec]&&S[sec].lignes)||[];
  var ligne=lignes[idx];
  showConfirm('🗑 Supprimer ?',confirmMsg||'Cette action est définitive.','🗑 Supprimer',function(){
    if(ligne) deleteLineFromSupabase(sec, ligne);
    lignes.splice(idx,1);
    save();
    autoBackup();
    renderMain();
    toast('Supprimé');
    if(onDone) onDone();
  });
}
// Usage: <div class="swipe-row" data-swipe-left="fn()" data-swipe-right="fn()">
//          <div class="swipe-action swipe-action-del">🗑 Supprimer</div>
//          <div class="swipe-action swipe-action-right">🖨️ Réimprimer</div>
//          <div class="swipe-row-inner">...contenu...</div>
//        </div>
// ── Validation rapide par swipe ───────────────────────────────────
function nettSwipeOK(refId){
  if(roCheck()) return;
  var item=(nettRef()||[]).find(function(r){return r.id===refId;});
  if(!item) return;
  var val={_ts:new Date().toISOString(),ref_id:refId,zone:item.zone||'',materiel:item.materiel||'',
    produit_nett:item.produit||'',date:today(),heure:nowT(),cuisinier:getActiveSession()||'',conforme:'OUI',commentaire:''};
  S.nett_val=S.nett_val||[]; S.nett_val.push(stampEntry(val));
  if(S.nett_val.length>500) S.nett_val=S.nett_val.slice(-500);
  save(); try{SupaEngine.enqueue('enr28',{...val,_sec:'enr28'});}catch(e){}
  appVibrate([50]); toast('✅ '+item.materiel+' — Validé OK','success');
  renderNav(); renderMain();
}
function nettSwipeNC(refId){
  openNettModal(refId);
  setTimeout(function(){
    var btnN=document.getElementById('nett-conf-non');
    var btnO=document.getElementById('nett-conf-oui');
    var conf=document.getElementById('nett-modal-conf');
    if(btnN) btnN.classList.add('on');
    if(btnO) btnO.classList.remove('on');
    if(conf) conf.value='NON';
  },150);
}
function nuisSwipeOK(zone){
  var val={_ts:new Date().toISOString(),date:today(),zone:zone,presence:'NON',action:'',heure:nowT(),cuisinier:getActiveSession()||''};
  S.nuisibles_val=S.nuisibles_val||[]; S.nuisibles_val.push(val);
  if(S.nuisibles_val.length>600) S.nuisibles_val=S.nuisibles_val.slice(-600);
  save(); try{SupaEngine.enqueue('nuisibles_val',val);}catch(e){}
  appVibrate([50]); toast('✅ '+zone+' — Aucun nuisible','success');
  renderNav(); renderMain();
}
function nuisSwipeNC(zone){
  openNuisiblesModal(zone);
  setTimeout(function(){ nuisiblesTogglePresence('OUI'); },150);
}

function initSwipeRows(container){
  if(!container) return;
  var rows=container.querySelectorAll('.swipe-row');
  rows.forEach(function(row){
    var inner=row.querySelector('.swipe-row-inner');
    if(!inner||inner._swipeInit) return;
    inner._swipeInit=true;
    var startX=0,startY=0,dx=0,moved=false;
    var THRESHOLD=60,MAX=110;
    function onStart(e){
      var t=e.touches?e.touches[0]:e;
      startX=t.clientX; startY=t.clientY; dx=0; moved=false;
      inner.classList.add('no-transition');
    }
    function onMove(e){
      if(!e.touches) return;
      var t=e.touches[0];
      dx=t.clientX-startX;
      var dy=t.clientY-startY;
      if(!moved&&Math.abs(dy)>Math.abs(dx)){return;} // scroll vertical
      moved=true;
      if(Math.abs(dx)<3) return;
      e.preventDefault();
      var clamped=Math.max(-MAX,Math.min(MAX,dx));
      inner.style.transform='translateX('+clamped+'px)';
    }
    function onEnd(){
      inner.classList.remove('no-transition');
      if(!moved){inner.style.transform='';return;}
      if(dx<-THRESHOLD){
        // swipe gauche → action droite (réimprimer)
        inner.style.transform='translateX(-'+MAX+'px)';
        setTimeout(function(){
          inner.style.transform='';
          var fn=row.getAttribute('data-swipe-left');
          if(fn) try{eval(fn);}catch(e){}
        },200);
      } else if(dx>THRESHOLD){
        // swipe droite → action gauche (supprimer)
        inner.style.transform='translateX('+MAX+'px)';
        setTimeout(function(){
          inner.style.transform='';
          var fn=row.getAttribute('data-swipe-right');
          if(fn) try{eval(fn);}catch(e){}
        },200);
      } else {
        inner.style.transform='';
      }
    }
    inner.addEventListener('touchstart',onStart,{passive:true});
    inner.addEventListener('touchmove',onMove,{passive:false});
    inner.addEventListener('touchend',onEnd,{passive:true});
  });
}

function etiqLogoLine(){
  var societe=(S.config&&S.config.headerGroupe&&S.config.headerGroupe.trim())||'';
  var etab=(S.config&&S.config.etab&&S.config.etab.trim())||'';
  var code=(S.config&&S.config.code&&S.config.code.trim())||'';
  var parts=[];
  if(societe) parts.push(societe);
  if(etab) parts.push(etab);
  if(code) parts.push('('+code+')');
  return parts.join(' • ')||'HACC.PRO';
}

// ── Impression cross-platform (Android + iOS) ──────────────────────
// Utilise Blob URL pour contourner le blocage window.open('') sur iOS Safari
function openPrintWindow(html) {
  try {
    var blob = new Blob([html], {type: 'text/html;charset=utf-8'});
    var url = URL.createObjectURL(blob);
    var w = window.open(url, '_blank');
    if (w) {
      setTimeout(function(){ try{ URL.revokeObjectURL(url); }catch(e){} }, 15000);
    } else {
      // Fallback iOS : simuler un clic sur un lien
      var a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      setTimeout(function(){ try{ document.body.removeChild(a); URL.revokeObjectURL(url); }catch(e){} }, 5000);
    }
  } catch(e) {
    toast('⚠️ Erreur impression : ' + e.message, 'error');
  }
}

// _e34batch, ETIQ_A4_FORMATS, E34_FORMATS définis dans printService.js
// Lire le format depuis E34_FORMATS (référence complète) avec double fallback
function getEtiqA4FmtId(){ return (S['enr34']||{}).format||(S.config||{}).etiqA4Fmt||'a4_119763'; }
function getEtiqA4Fmt(){ return E34_FORMATS.find(function(f){return f.id===getEtiqA4FmtId();})||E34_FORMATS[0]; }
// setEtiqA4Fmt met à jour les DEUX clés pour rétrocompatibilité
function setEtiqA4Fmt(id){ S.config=S.config||{}; S.config.etiqA4Fmt=id; S['enr34']=S['enr34']||{}; S['enr34'].format=id; save(); renderMain(); toast('🏷️ Format étiquette mis à jour','success'); }
function buildA4PrintCss(fmt,extra){
  // Colonnes = 2 pour les formats 14/feuille, 1 sinon
  const cols=(fmt.perPage&&fmt.perPage>=14)?2:1;
  return '@media print{body{background:#fff!important;padding:0!important;margin:0!important;}'+
    '.no-print{display:none!important;}'+
    '.page{display:flex!important;flex-wrap:wrap!important;gap:0!important;align-content:flex-start!important;padding:0!important;margin:0!important;}'+
    '.etiq{width:'+fmt.w+'mm!important;height:'+fmt.h+'mm!important;max-width:none!important;min-width:0!important;'+
    'overflow:hidden!important;padding:1.5mm 2mm!important;display:flex!important;flex-direction:column!important;gap:0.8mm!important;'+
    'box-shadow:none!important;border-radius:0!important;border-width:1px!important;page-break-inside:avoid!important;}'+
    // Si nombre impair d'étiquettes : la dernière est décalée à droite pour éviter la case déjà décollée
    (cols===2?'.etiq:last-child:nth-child(odd){margin-left:'+fmt.w+'mm!important;}':'')+
    (extra||'')+
    '@page{margin:'+fmt.pm+';size:A4 portrait;}}';
}

// E34_FORMATS défini dans printService.js
function e34Format(){ return (S['enr34']||{}).format||(S.config||{}).etiqA4Fmt||'a4_119763'; }

// ── Renderer principal ─────────────────────────────
function renderENR34(){
  const d=e34d();
  // Auto-initialiser heure_fab si vide
  if(!d.heure_fab){ e34s('heure_fab', nowT()); d.heure_fab=nowT(); }
  const lignes=(S['enr34']||{}).lignes||[];
  const fmt=e34Format();

  // Sélecteur de produit — pills par famille
  const familles=[...new Set(DLC_BASE.map(p=>p.famille))];
  const prodPills=familles.map(f=>{
    const prods=DLC_BASE.filter(p=>p.famille===f);
    return`<div style="margin-bottom:8px">
      <div style="font-size:.68rem;font-weight:800;color:#7A6579;text-transform:uppercase;letter-spacing:.3px;margin-bottom:4px">${f}</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px">
        ${prods.map(p=>{const i=DLC_BASE.indexOf(p);return`<button onclick="e34SelectProd(${i})"
          style="padding:6px 10px;border-radius:10px;border:2px solid ${_e34sel===i?'var(--plum)':'var(--brd)'};
          background:${_e34sel===i?'var(--plum)':'var(--fond)'};color:${_e34sel===i?'#fff':'var(--gris2)'};
          font-size:.72rem;font-weight:700;cursor:pointer;font-family:inherit;text-align:left">
          ${p.produit}</button>`;}).join('')}
      </div>
    </div>`;
  }).join('');

  // Info DLC sélectionnée
  const dlcInfo=_e34sel!==null?`<div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:10px;padding:8px 12px;margin-bottom:10px">
    <span style="font-weight:800;color:#166534">${DLC_BASE[_e34sel].produit}</span>
    <span style="color:#166534;margin-left:8px">🌡️ ${DLC_BASE[_e34sel].stockage}</span>
    <span style="color:#166534;margin-left:8px">⏳ ${dlcLabel(DLC_BASE[_e34sel])}</span>
  </div>`:'';

  const dateFabDisp=d.date_fab?new Date(d.date_fab+'T12:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'}):"Aujourd'hui";
  const dlcDisp=d.dlc?new Date(d.dlc+'T12:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'}):'';

  // Boutons statut
  const statuts=[{v:'Fabriqué',ico:'🍳'},{v:'Entamé',ico:'📦'},{v:'Mise en décongélation',ico:'❄️'}];

  // Batch en cours
  const batchHtml=_e34batch.length>0?`<div style="background:#f0f0ff;border:1.5px solid #8888ff;border-radius:12px;padding:10px 12px;margin-bottom:10px">
    <div style="font-size:.78rem;font-weight:800;color:#3333aa;margin-bottom:6px">🗂️ Lot en cours — ${_e34batch.length} étiquette${_e34batch.length>1?'s':''}</div>
    ${_e34batch.map((b,i)=>`<div style="display:flex;justify-content:space-between;align-items:center;font-size:.72rem;color:#555;padding:3px 0;border-bottom:1px solid #ddd">
      <span>${b.nb}× ${escH(b.produit)} — DLC: ${b.dlc?new Date(b.dlc+'T12:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}):'DDM'}</span>
      <button onclick="e34RemoveBatch(${i})" style="background:none;border:none;color:#999;cursor:pointer;font-size:.8rem">✕</button>
    </div>`).join('')}
    <button class="btn-save" style="width:100%;margin-top:8px;font-size:.82rem" onclick="e34PrintBatch()">🖨️ Imprimer le lot (${_e34batch.reduce((s,b)=>s+b.nb,0)} étiquettes)</button>
    <button onclick="_e34batch=[];renderMain()" style="width:100%;margin-top:5px;padding:8px;background:var(--fond);border:1.5px solid var(--brd);border-radius:10px;font-size:.75rem;font-weight:700;cursor:pointer;color:#666;font-family:inherit">✕ Vider le lot</button>
  </div>`:'';

  return`<div class="card">
    <div class="card-title">🏷️ Nouvelle étiquette de production</div>
    <div class="regle">Sélectionnez le type → la DLC se calcule automatiquement.</div>

    ${(()=>{
      if(d.produit||_e34sel!==null) return '';
      const recents=[...new Map(((S['enr34']||{}).lignes||[]).slice(0,40)
        .filter(r=>r.produit&&r._sel!=null)
        .map(r=>[r.produit,r])).values()].slice(0,5);
      if(!recents.length) return '';
      return '<div style="background:#f9f0ff;border:1.5px solid #e9d5ff;border-radius:12px;padding:10px 12px;margin-bottom:10px">'
        +'<div style="font-size:.68rem;font-weight:800;color:#7A6579;text-transform:uppercase;letter-spacing:.3px;margin-bottom:6px">↩ Réutiliser un produit récent</div>'
        +'<div style="display:flex;gap:5px;flex-wrap:wrap">'
        +recents.map(r=>`<button onclick="e34SelectProd(${r._sel});e34sR('produit','${escH(r.produit).replace(/'/g,"\\'")}');document.getElementById('e34-produit-inp')&&(document.getElementById('e34-produit-inp').value='${escH(r.produit).replace(/'/g,"\\'")}');" style="padding:5px 10px;background:#fff;border:1.5px solid #d8b4fe;border-radius:20px;font-size:.72rem;font-weight:700;color:#7c3aed;cursor:pointer;font-family:inherit">${escH(r.produit)}</button>`).join('')
        +'</div></div>';
    })()}

    <!-- Sélecteur produit -->
    <div style="margin-bottom:10px">
      <label style="font-size:.75rem;font-weight:800;color:#7A6579;text-transform:uppercase;letter-spacing:.4px">Type de produit</label>
      <div style="margin-top:6px;max-height:240px;overflow-y:auto;border:1.5px solid var(--brd);border-radius:12px;padding:10px">${prodPills}</div>
    </div>
    ${dlcInfo}

    <!-- Nom libre -->
    <div class="fg full" style="margin-bottom:8px">
      <label>Nom du produit *</label>
      <div class="mic-wrap" style="margin-top:4px">
        <input class="fi" id="e34-produit-inp" type="text" value="${escH(d.produit||'')}" placeholder="Ex: Gratin dauphinois"
          oninput="e34s('produit',this.value)">
        <button type="button" class="mic-btn" title="Dicter" onclick="startMicField('e34-produit-inp',v=>e34s('produit',v))">🎤</button>
      </div>
    </div>

    <!-- Statut + Date fab -->
    <div class="fgrid" style="margin-bottom:8px">
      <div class="fg full">
        <label>Statut</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
          ${statuts.map(s=>`<button onclick="e34sR('statut','${s.v}')"
            style="padding:7px 12px;border-radius:10px;border:2px solid ${d.statut===s.v?'var(--plum)':'var(--brd)'};
            background:${d.statut===s.v?'var(--plum)':'var(--fond)'};color:${d.statut===s.v?'#fff':'var(--gris2)'};
            font-size:.75rem;font-weight:800;cursor:pointer;font-family:inherit">${s.ico} ${s.v}</button>`).join('')}
        </div>
      </div>
      <div class="fg">
        <label>Date fabrication</label>
        <button class="dp-trigger" onclick="openDP('${d.date_fab||today()}',v=>{e34sR('date_fab',v);e34AutoDlc();},{max:'${today()}'})">
          <span class="dp-ico">📅</span>
          <span class="dp-val ${!d.date_fab?'empty':''}">${dateFabDisp}</span>
          <span style="font-size:.7rem;color:#c0a0c0">▼</span>
        </button>
      </div>
      <div class="fg">
        <label>Heure fabrication</label>
        <button type="button" class="time-btn" onclick="S['_e34tmp']=S['_e34tmp']||{};S['_e34tmp'].draft=S['_e34tmp'].draft||{};S['_e34tmp'].draft.h=e34d().heure_fab||nowT();openTW('h','_e34tmp','Heure fabrication');window._twCloseCb=()=>{const v=gd('h','_e34tmp');if(v)e34sR('heure_fab',v);}">
          ${d.heure_fab?`<span>⏰</span><span class="tv">${d.heure_fab}</span>`:`<span>⏰</span><span class="tp2">Appuyer</span>`}
        </button>
      </div>
      <div class="fg full">
        <label>À consommer jusqu'au (DLC) ${_e34sel!==null&&DLC_BASE[_e34sel]?.dlc_ddm?'<span style="color:#92400e;font-size:.65rem"> — DDM d\'origine, saisir manuellement</span>':''}</label>
        <button class="dp-trigger" onclick="openDP('${d.dlc||today()}',v=>{e34sR('dlc',v);},{})">
          <span class="dp-ico">📅</span>
          <span class="dp-val ${!d.dlc?'empty':''}">${dlcDisp||'Sélectionner'}</span>
          <span style="font-size:.7rem;color:#c0a0c0">▼</span>
        </button>
      </div>
      <div class="fg">${etiqChefSel('cuisinier34','e34d','e34s','Cuisinier')}</div>
      <div class="fg">
        <label>Nb d'étiquettes</label>
        <div style="display:flex;align-items:center;gap:10px;margin-top:4px">
          <button onclick="e34qty(-1)" style="width:36px;height:36px;border-radius:50%;border:2px solid var(--brd);background:var(--fond);font-size:1.3rem;cursor:pointer;font-family:inherit;font-weight:800">−</button>
          <span id="e34qd" style="font-size:1.4rem;font-weight:900;color:var(--plum);min-width:30px;text-align:center">${_e34qty}</span>
          <button onclick="e34qty(1)" style="width:36px;height:36px;border-radius:50%;border:2px solid var(--plum);background:var(--plum);color:#fff;font-size:1.3rem;cursor:pointer;font-family:inherit;font-weight:800">+</button>
        </div>
        ${(()=>{var r=etiqRestantes(),p=etiqPerPage(),l=printAllTotal();if(p<=1)return '';var libre=r>0?r-l:p-l;if(libre>0&&libre<p&&libre!==_e34qty)return '<button onclick="var el=document.getElementById(\'e34qd\');_e34qty='+libre+';if(el)el.textContent='+libre+'" style="margin-top:5px;padding:4px 10px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:8px;font-size:.68rem;font-weight:800;color:#166534;cursor:pointer;font-family:inherit;width:100%">📄 Compléter la feuille (→ '+libre+')</button>';return '';})()}
      </div>
    </div>

    <div class="fg full" style="margin-bottom:10px">
      <label>Format d'étiquette</label>
      <select class="fi" onchange="setEtiqA4Fmt(this.value)" style="margin-top:4px">
        ${E34_FORMATS.map(f=>`<option value="${f.id}" ${fmt===f.id?'selected':''}>${f.label}</option>`).join('')}
      </select>
    </div>

    <div style="display:flex;flex-direction:column;gap:8px">
      <button class="btn-save" style="width:100%;touch-action:manipulation" onclick="e34Save()">✅ Enregistrer + Imprimer</button>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sec" style="flex:1;touch-action:manipulation" onclick="e34AddBatch()">➕ Ajouter au lot</button>
        <button class="btn btn-sec" style="touch-action:manipulation" onclick="e34sr()">🔄</button>
      </div>
    </div>
  </div>

  ${batchHtml}
  ${printAllBanner()}
  ${e34RenderHisto(lignes)}`;
}

function e34OpenHeure(){
  const d=e34d();
  S['_e34tmp']=S['_e34tmp']||{};
  S['_e34tmp'].draft=S['_e34tmp'].draft||{};
  S['_e34tmp'].draft.heure_fab=d.heure_fab||nowT();
  openTW('heure_fab','_e34tmp','Heure fabrication');
  window._twCloseCb=()=>{
    const v=gd('heure_fab','_e34tmp');
    if(v) e34sR('heure_fab',v);
  };
}

function e34SelectProd(i){
  _e34sel=i;
  const item=DLC_BASE[i];
  if(!e34d().produit) e34s('produit',item.produit);
  e34s('stockage',item.stockage);
  e34AutoDlc();
  renderMain();
}

function e34AutoDlc(){
  if(_e34sel===null)return;
  const item=DLC_BASE[_e34sel];
  const dateRef=e34d().date_fab||today();
  const dlc=dlcCalc(item,dateRef);
  if(dlc) e34s('dlc',dlc);
}

function e34qty(delta){
  _e34qty=Math.max(1,Math.min(20,_e34qty+delta));
  const el=document.getElementById('e34qd');
  if(el)el.textContent=_e34qty;
}

function e34AddBatch(){
  const d=e34d();
  if(!d.produit){toast('⚠️ Saisissez le nom du produit','warning');return;}
  const batchEntry={...d, nb:_e34qty, _sel:_e34sel};
  _e34batch.push(batchEntry);
  // Sauvegarder immédiatement dans l'historique (sans attendre l'impression)
  const rec=stampEntry({...batchEntry,date:today(),_ts:new Date().toISOString(),_sec:'enr34',nb_etiq:_e34qty,_dans_lot:true});
  S['enr34']=S['enr34']||{};S['enr34'].lignes=S['enr34'].lignes||[];
  S['enr34'].lignes.unshift(rec);
  try{SupaEngine.enqueue('enr34',rec);}catch(e){}
  toast(`✅ Ajouté au lot — ${_e34batch.length} type${_e34batch.length>1?'s':''}`, 'success');
  // Reset pour nouvelle saisie, garder le format
  S['enr34'].draft34={};_e34sel=null;_e34qty=1;save();autoBackup();renderNav();renderMain();
}

function e34RemoveBatch(i){ _e34batch.splice(i,1); renderNav(); renderMain(); }

function e34Save(){
  const d=e34d();
  if(!d.produit){toast('⚠️ Saisissez le nom du produit','warning');return;}
  const nb=_e34qty;
  const rec={...d,date:today(),_ts:new Date().toISOString(),_sec:'enr34',nb_etiq:nb};
  const sim=etiqSimule(nb+printAllTotal());
  function doSave(){
    S['enr34']=S['enr34']||{};
    S['enr34'].lignes=S['enr34'].lignes||[];
    S['enr34'].lignes.unshift(stampEntry(rec));
    save();
    try { SupaEngine.enqueue('enr34', rec); } catch(e){}
    e34Print([{...rec,nb:nb}]);
    S['enr34'].draft34={}; _e34sel=null; _e34qty=1;
    save(); renderMain();
    setTimeout(function(){
      showConfirm('🖨️ Étiquettes bien imprimées ?',
        etiqConfirmMsg(nb),
        '✅ Oui, c\'est imprimé',
        function(){ etiqAfterPrint(nb); renderMain(); toast('📄 Compteur mis à jour','success'); });
    },1500);
  }
  if(sim&&!sim.rentreTotal&&sim.gaspillees>=Math.floor(etiqPerPage()/2)){
    showConfirm('⚠️ Gaspillage détecté',
      sim.gaspillees+' case'+(sim.gaspillees>1?'s':'')+' seront gaspillée'+(sim.gaspillees>1?'s':'')+'. 💡 Utilise le lot (➕) pour grouper avec d\'autres étiquettes.',
      '🖨️ Imprimer quand même', doSave);
  } else { doSave(); }
}

function e34PrintBatch(){
  const batchCopy=[..._e34batch];
  const nb34=batchCopy.reduce(function(s,b){return s+(b.nb||1);},0);
  if(!nb34){ toast('⚠️ Lot vide','warning'); return; }
  askCompleteBeforePrint(nb34, function(addBlanks){
    S['enr34']=S['enr34']||{};S['enr34'].lignes=S['enr34'].lignes||[];
    _e34batch.forEach(b=>{ S['enr34'].lignes.unshift(stampEntry({...b,date:today(),_ts:new Date().toISOString(),_sec:'enr34',nb_etiq:b.nb})); });
    save();
    var printItems=[...batchCopy];
    if(addBlanks>0){
      for(var i=0;i<addBlanks;i++){
        printItems.push({produit:'',statut:'',date_fab:'',heure_fab:'',stockage:'0 / +3°C',dlc:'',cuisinier34:'',nb:1});
      }
    }
    e34Print(printItems);
    autoBackup();
    var nbTotal=nb34+addBlanks;
    setTimeout(function(){
      showConfirm('🖨️ Étiquettes bien imprimées ?',etiqConfirmMsg(nbTotal),'✅ Oui, vider le lot',function(){
        etiqAfterPrint(nbTotal);
        _e34batch=[]; renderNav(); renderMain();
        toast(addBlanks>0?'✅ Feuille complète — lot vidé':'✅ Lot production vidé','success');
      });
    },1500);
  });
}

function e34Print(items){
  const logoLine=etiqLogoLine();
  const fmt=E34_FORMATS.find(f=>f.id===e34Format())||E34_FORMATS[0];
  const isTherm=fmt.id.startsWith('therm');

  const makeLabel=(rec)=>{
    const dlcDisp=rec.dlc?new Date(rec.dlc+'T12:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'}):'___/___/______';
    const dateFab=rec.date_fab?new Date(rec.date_fab+'T12:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'}):'___/___/______';
    const h=rec.heure_fab||'__h__';
    const statut=rec.statut||'Fabriqué';
    const stockage=rec.stockage||'0 / +3°C';
    return`<div class="etiq">
      <div class="etiq-hd">
        <span class="etiq-logo">${logoLine}</span>
        <span class="etiq-title">PRODUCTION</span>
      </div>
      <div class="etiq-prod">${rec.produit||'—'}</div>
      <div class="etiq-statuts">
        <span class="${statut==='Mise en décongélation'?'son':'soff'}">Mise en décongélation</span>
        <span class="${statut==='Fabriqué'?'son':'soff'}">Fabriqué</span>
        <span class="${statut==='Entamé'?'son':'soff'}">Entamé</span>
      </div>
      <div class="etiq-daterow">le <b>${dateFab}</b> à <b>${h}</b></div>
      <div class="etiq-stock">${stockage}</div>
      <div class="etiq-dlc">Consommer avant : <b>${dlcDisp}</b></div>
      ${rec.cuisinier34?`<div class="etiq-sign">${rec.cuisinier34}</div>`:''}
    </div>`;
  };

  // Répéter chaque item nb fois
  const allLabels=[];
  items.forEach(rec=>{ for(let i=0;i<(rec.nb||1);i++) allLabels.push(makeLabel(rec)); });

  const css=isTherm?`
    body{margin:0;padding:0;font-family:Arial,sans-serif;}
    .etiq{width:${fmt.w}mm;height:${fmt.h}mm;border:1px solid #000;padding:2mm;box-sizing:border-box;page-break-after:always;display:flex;flex-direction:column;gap:1mm;}
    .etiq-hd{display:flex;justify-content:space-between;border-bottom:1px solid #000;padding-bottom:1mm;}
    .etiq-logo{font-size:6pt;font-weight:bold;color:#c93a78;}
    .etiq-title{background:#f90;font-size:7pt;font-weight:bold;padding:0 2mm;border-radius:2px;}
    .etiq-prod{font-size:9pt;font-weight:bold;line-height:1.2;}
    .etiq-statuts{display:flex;gap:2mm;font-size:6pt;flex-wrap:wrap;}
    .soff{color:#aaa;}.son{font-weight:bold;color:#000;}
    .soff::before{content:"○ ";}.son::before{content:"● ";}
    .etiq-daterow{font-size:7pt;}.etiq-stock{font-size:6pt;color:#666;font-style:italic;}
    .etiq-dlc{font-size:8pt;font-weight:bold;color:#c00;border-top:1px dashed #ccc;padding-top:1mm;margin-top:auto;}
    .etiq-sign{font-size:6pt;color:#666;}
  `:`
    body{font-family:Arial,sans-serif;background:#f5f5f5;padding:12px;}
    .no-print{background:#fff;border-radius:10px;padding:10px 12px;margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;box-shadow:0 1px 4px rgba(0,0,0,.1);}
    .page{display:flex;flex-wrap:wrap;gap:12px;}
    .etiq{width:calc(100vw - 24px);max-width:360px;border:2px solid #333;border-radius:4px;padding:10px 12px;box-sizing:border-box;display:flex;flex-direction:column;gap:5px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.1);}
    .etiq-hd{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #f90;padding-bottom:6px;}
    .etiq-logo{font-size:9px;font-weight:bold;color:#c93a78;}
    .etiq-title{background:#f90;color:#fff;font-size:11px;font-weight:bold;padding:2px 7px;border-radius:2px;}
    .etiq-prod{font-size:14px;font-weight:bold;line-height:1.2;}
    .etiq-statuts{display:flex;gap:8px;font-size:10px;flex-wrap:wrap;}
    .soff{color:#bbb;}.son{font-weight:bold;color:#000;}
    .soff::before{content:"○ ";}.son::before{content:"● ";}
    .etiq-daterow{font-size:10px;}.etiq-stock{font-size:9px;color:#888;font-style:italic;}
    .etiq-dlc{font-size:11px;font-weight:bold;color:#c00;border-top:1px dashed #ccc;padding-top:5px;margin-top:auto;}
    .etiq-sign{font-size:9px;color:#888;}
    @media print{
      body{background:#fff;padding:0;margin:0;}
      .no-print{display:none!important;}
      .page{display:flex;flex-wrap:wrap;gap:0;align-content:flex-start;}
      .etiq{width:${fmt.w}mm!important;height:${fmt.h}mm!important;overflow:hidden!important;max-width:none!important;min-width:0!important;
        padding:1.5mm 2mm;display:flex;flex-direction:column;gap:0.8mm;box-shadow:none;border-radius:0;border-width:1px;page-break-inside:avoid;}
      .etiq-hd{padding-bottom:1mm;}
      .etiq-logo{font-size:6pt;}.etiq-title{font-size:7pt;padding:0.5mm 1.5mm;}
      .etiq-prod{font-size:9pt;line-height:1.1;}.etiq-statuts{gap:2mm;font-size:6pt;}
      .etiq-daterow{font-size:6.5pt;}.etiq-stock{font-size:6pt;}
      .etiq-dlc{font-size:7.5pt;padding-top:0.8mm;}.etiq-sign{font-size:6pt;}
      @page{margin:${fmt.pm||'8mm'};size:A4 portrait;}
    }
  `;

  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Étiquettes — ${items.map(r=>r.produit).join(', ')}</title>
  <style>${css}</style></head><body>
  <div class="no-print" style="margin-bottom:8mm;display:flex;gap:6px;align-items:center">
    <button onclick="window.print()" style="background:#5C1E5A;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer;font-weight:bold">🖨️ Imprimer</button>
    <button onclick="window.close()" style="background:#eee;color:#333;border:1px solid #ccc;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer">✕ Fermer</button>
    <span style="font-size:13px;color:#666">${allLabels.length} étiquette${allLabels.length>1?'s':''} — Format : ${fmt.label}</span>
  </div>
  ${isTherm?allLabels.join(''):`<div class="page">${allLabels.join('')}</div>`}
  </body></html>`;

  openPrintWindow(html);
}

function e34RenderHisto(lignes){
  if(!lignes.length)return`<div class="card"><div class="hh"><span class="hh-title">📜 Historique étiquettes</span><span class="hh-badge">0</span></div><div class="empty-s">Aucune étiquette créée.</div></div>`;
  const rows=[...lignes].slice(0,30).map((r,i)=>{
    const recJson34=JSON.stringify(r).replace(/"/g,"'");
    const fnPrint=`reimprAsk('enr34',${recJson34},${r.nb_etiq||1})`;
    const fnDel=`deleteENRLigne('enr34',${i},'Supprimer cette étiquette ? Elle sera retirée du cloud.')`;
    const dlcDate=r.dlc?new Date(r.dlc+'T12:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'}):'DDM';
    const fabDate=r.date_fab||r.date||'';
    return`<div class="swipe-row" data-swipe-left="${fnPrint}" data-swipe-right="${fnDel}">
      <div class="swipe-action swipe-action-del">🗑 Supprimer</div>
      <div class="swipe-action swipe-action-right">🖨️ Réimprimer</div>
      <div class="swipe-row-inner">
        <div style="flex:1;min-width:0">
          <div style="font-size:.92rem;font-weight:800;color:var(--gris)">${escH(r.produit||'—')} <span style="font-size:.72rem;font-weight:600;color:#b89ab6">${r.statut||''}</span></div>
          <div style="font-size:.75rem;color:#b89ab6;margin-top:3px">
            Fab: ${fabDate} ${r.heure_fab?'à '+r.heure_fab:''}
          </div>
          <div style="font-size:.78rem;font-weight:700;margin-top:3px">
            <span style="color:#c62828">DLC: ${dlcDate}</span>
            · <span style="color:var(--gris2)">${r.nb_etiq||1} étiq.</span>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
  const html=`<div class="card">
    <div class="hh"><span class="hh-title">📜 Historique étiquettes</span><span class="hh-badge">${lignes.length}</span></div>
    <div style="font-size:.68rem;color:#b89ab6;padding:0 14px 8px">← Glisser à gauche = réimprimer · Glisser à droite = supprimer</div>
    <div id="e34-histo-list" style="padding:0 14px 10px">${rows}</div>
  </div>`;
  setTimeout(function(){initSwipeRows(document.getElementById('e34-histo-list'));},120);
  return html;
}
function e34Reprint(i){
  const r=((S['enr34']||{}).lignes||[])[i];
  if(!r) return;
  const nb=r.nb_etiq||1;
  e34Print([{...r,nb:nb}]);
  setTimeout(function(){
    showConfirm('🖨️ Étiquettes bien imprimées ?',etiqConfirmMsg(nb),'✅ Oui, compteur mis à jour',function(){
      etiqAfterPrint(nb); renderMain(); toast('📄 Compteur mis à jour','success');
    });
  },1500);
}

// ════════════════════════════════════════════════════
// IMPRESSION GLOBALE — tous les lots en une seule page
// ════════════════════════════════════════════════════
function printAllLabels(){
  const logoLine=etiqLogoLine();
  const totalE33=_e33batch.reduce((s,b)=>s+(b.nb||1),0);
  const totalE36=_e36batch.reduce((s,b)=>s+(b.nb||1),0);
  const totalE34=_e34batch.reduce((s,b)=>s+(b.nb||1),0);
  const total=totalE33+totalE36+totalE34;
  if(!total){ toast('⚠️ Aucune étiquette dans les lots','warning'); return; }

  // ── Vérification débordement ──────────────────────
  const sim=etiqSimule(total);
  if(!sim.parfait && !sim.rentreTotal && sim.gaspillees>0){
    const msg='Ce lot déborde sur '+sim.feuillesNeuves+' nouvelle'+(sim.feuillesNeuves>1?'s':'')+' feuille'+(sim.feuillesNeuves>1?'s':'')+' et gaspillera '+sim.gaspillees+' case'+(sim.gaspillees>1?'s':'')+' vide'+(sim.gaspillees>1?'s':'')+'. Tu peux retirer des étiquettes du lot pour économiser.';
    showConfirm('⚠️ Débordement de feuille', msg, '🖨️ Imprimer quand même', function(){
      _askAndPrintAll(logoLine, total);
    });
    return;
  }
  _askAndPrintAll(logoLine, total);
}

// Intermédiaire : propose d'ajouter des blancs puis imprime
function _askAndPrintAll(logoLine, total){
  askCompleteBeforePrint(total, function(addBlanks){
    if(addBlanks>0){
      // Ajouter N étiquettes production vides au batch _e34batch avant impression
      for(var i=0;i<addBlanks;i++){
        _e34batch.push({produit:'',statut:'',date_fab:'',heure_fab:'',
          stockage:'0 / +3°C',dlc:'',cuisinier34:'',nb:1,_isBlank:true});
      }
    }
    _doPrintAllLabels(logoLine, total+addBlanks);
  });
}

function _doPrintAllLabels(logoLine, total){
  const allLabels=[];
  const totalE33=_e33batch.reduce(function(s,b){return s+(b.nb||1);},0);
  const totalE36=_e36batch.reduce(function(s,b){return s+(b.nb||1);},0);
  const totalE34=_e34batch.reduce(function(s,b){return s+(b.nb||1);},0);

  // ── ENR33 Plats témoins ───────────────────────────
  _e33batch.forEach(b=>{
    const datePrelev=b.date_prelev?new Date(b.date_prelev+'T12:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'}):'__/__/____';
    const destruct=b.date_destruct?new Date(b.date_destruct+'T12:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'}):'__/__/____';
    const heure=b.heure_prelev||'__h__';
    const service=b.service||'';
    const ico=service==='Déjeuner'?'☀️':service==='Dîner'?'🌙':service==='Petit-déjeuner'?'🌅':'🍰';
    const lbl=`<div class="etiq etiq-temoin">
      <div class="ehd ehd-temoin"><span class="elogo">${logoLine}</span><span class="etitle etitle-temoin">PLAT TÉMOIN</span></div>
      <div class="eservice">${ico} ${service||'Service'}</div>
      <div class="eprod">${b.produit||'—'}</div>
      <div class="erow">Prélevé le : <b>${datePrelev}</b> à <b>${heure}</b></div>
      <div class="erow">Par : ${b.operateur||'—'}</div>
      <div class="econserve">🌡️ 0°C/+3°C — NE PAS OUVRIR</div>
      <div class="edestruct">🗑️ Détruire le : <b>${destruct}</b></div>
    </div>`;
    for(let i=0;i<(b.nb||1);i++) allLabels.push(lbl);
  });

  // ── ENR36 Excédents ───────────────────────────────
  _e36batch.forEach(b=>{
    const dlcDisp=b.dlc?new Date(b.dlc+'T12:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'}):'__/__/____';
    const dateProd=b.date_prod?new Date(b.date_prod+'T12:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'}):'__/__/____';
    const isFroid=b.type_cons!=='chaud';
    const dejaRech=b.remise==='OUI';
    const col=isFroid?'#1d4ed8':'#dc2626';
    const lbl=`<div class="etiq" style="border-color:${col}">
      <div class="ehd" style="border-color:${col}"><span class="elogo">${logoLine}</span>
        <span class="etitle" style="background:${col}">${isFroid?'❄️ EXCÉDENT FROID':'🔥 EXCÉDENT CHAUD'}</span></div>
      <div class="eprod">${b.produit||'—'}</div>
      <div class="erow">Produit le : <b>${dateProd}</b>${b.heure_prod?' à <b>'+b.heure_prod+'</b>':''}</div>
      <div class="erow">Conservation : <b>${isFroid?'0°C / +3°C':'≥ +63°C'}</b></div>
      ${dejaRech?'<div class="erech-warn">⛔ DÉJÀ RÉCHAUFFÉ — NE PAS RÉCHAUFFER</div>':'<div class="erech-ok">✅ 1ère remise en T°C autorisée</div>'}
      <div class="edlc" style="background:${isFroid?'#eff6ff':'#fff5f5'};border-color:${isFroid?'#bfdbfe':'#fca5a5'}">
        <span style="color:${col}">${isFroid?'🗓️ Consommer avant :':'⏰ Servir avant (2h) :'}</span>
        <b>${dlcDisp}</b>
      </div>
      ${b.cuisinier36?`<div class="eoper">👤 ${b.cuisinier36}</div>`:''}
    </div>`;
    for(let i=0;i<(b.nb||1);i++) allLabels.push(lbl);
  });

  // ── ENR34 Production ──────────────────────────────
  _e34batch.forEach(b=>{
    const dlcDisp=b.dlc?new Date(b.dlc+'T12:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'}):'___/___/______';
    const dateFab=b.date_fab?new Date(b.date_fab+'T12:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'}):'___/___/______';
    const h=b.heure_fab||'__h__';
    const statut=b.statut||'Fabriqué';
    const stockage=b.stockage||'0 / +3°C';
    const lbl=`<div class="etiq etiq-prod34">
      <div class="ehd ehd-prod34"><span class="elogo">${logoLine}</span><span class="etitle etitle-prod34">PRODUCTION</span></div>
      <div class="eprod">${b.produit||'—'}</div>
      <div class="estatuts">
        <span class="${statut==='Mise en décongélation'?'eson':'esoff'}">Mise en décongélation</span>
        <span class="${statut==='Fabriqué'?'eson':'esoff'}">Fabriqué</span>
        <span class="${statut==='Entamé'?'eson':'esoff'}">Entamé</span>
      </div>
      <div class="erow">le <b>${dateFab}</b> à <b>${h}</b></div>
      <div class="estock">${stockage}</div>
      <div class="edlc-prod">Consommer avant : <b>${dlcDisp}</b></div>
      ${b.cuisinier34?`<div class="eoper">${b.cuisinier34}</div>`:''}
    </div>`;
    for(let i=0;i<(b.nb||1);i++) allLabels.push(lbl);
  });

  const summary=[];
  if(totalE33) summary.push(`${totalE33} plat${totalE33>1?'s':''} témoin${totalE33>1?'s':''}`);
  if(totalE36) summary.push(`${totalE36} excédent${totalE36>1?'s':''}`);
  if(totalE34) summary.push(`${totalE34} production`);

  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Impression globale étiquettes</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:Arial,sans-serif;background:#f5f5f5;padding:12px;}
    .no-print{background:#fff;border-radius:10px;padding:10px 12px;margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;box-shadow:0 1px 4px rgba(0,0,0,.1);}
    .page{display:flex;flex-wrap:wrap;gap:12px;}
    /* Base commune — aperçu écran */
    .etiq{width:calc(100vw - 24px);max-width:360px;border:2.5px solid #5C1E5A;border-radius:5px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.1);}
    .ehd{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #5C1E5A;padding-bottom:6px;}
    .elogo{font-size:9px;font-weight:bold;color:#c93a78;}
    .etitle{color:#fff;font-size:11px;font-weight:bold;padding:2px 7px;border-radius:3px;}
    .eprod{font-size:14px;font-weight:bold;color:#111;line-height:1.2;}
    .erow{font-size:10px;color:#333;}
    .eoper{font-size:9px;color:#888;}
    /* Plat témoin */
    .etiq-temoin{border-color:#5C1E5A;}.ehd-temoin{border-color:#5C1E5A;}.etitle-temoin{background:#5C1E5A;}
    .eservice{font-size:10px;color:#5C1E5A;font-weight:bold;}
    .econserve{font-size:9px;color:#666;font-style:italic;border-top:1px dashed #ccc;padding-top:5px;}
    .edestruct{font-size:11px;font-weight:bold;color:#c00;background:#fff5f5;border-radius:3px;padding:4px 6px;}
    /* Excédents */
    .erech-warn{font-size:10px;font-weight:bold;color:#dc2626;background:#fee2e2;border-radius:3px;padding:5px;}
    .erech-ok{font-size:10px;font-weight:bold;color:#166534;background:#dcfce7;border-radius:3px;padding:5px;}
    .edlc{font-size:11px;font-weight:bold;border:1.5px solid #ccc;border-radius:4px;padding:6px;display:flex;flex-direction:column;gap:3px;}
    /* Production */
    .etiq-prod34{border-color:#f90;}.ehd-prod34{border-bottom-color:#f90;}.etitle-prod34{background:#f90;color:#fff;}
    .estatuts{display:flex;gap:8px;font-size:10px;flex-wrap:wrap;}
    .esoff{color:#bbb;}.eson{font-weight:bold;color:#000;}
    .esoff::before{content:"○ ";}.eson::before{content:"● ";}
    .estock{font-size:9px;color:#888;font-style:italic;}
    .edlc-prod{font-size:11px;font-weight:bold;color:#c00;border-top:1px dashed #ccc;padding-top:5px;margin-top:auto;}
    /* Impression : retour aux vraies tailles mm */
  </style>
  <style>${buildA4PrintCss(getEtiqA4Fmt(),'.ehd{padding-bottom:0.5mm;}.elogo{font-size:5.5pt;}.etitle{font-size:6.5pt;padding:0.3mm 1mm;}.eprod{font-size:8.5pt;line-height:1.1;}.erow{font-size:6pt;}.eoper{font-size:5.5pt;}.eservice{font-size:6.5pt;}.econserve{font-size:5.5pt;padding-top:0.5mm;border-top-width:0.5px;}.edestruct{font-size:7pt;padding:0.5mm 1mm;}.erech-warn,.erech-ok{font-size:6pt;padding:0.5mm;}.edlc{font-size:7pt;padding:0.8mm;gap:0.3mm;margin-top:0.3mm;}.estatuts{gap:1.5mm;font-size:5.5pt;}.estock{font-size:5.5pt;}.edlc-prod{font-size:7pt;padding-top:0.5mm;}')}</style>
  </head><body>
  <div class="no-print" style="background:#fff;border-radius:10px;padding:10px 12px;margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;box-shadow:0 1px 4px rgba(0,0,0,.1);">
    <button onclick="window.print()" style="background:#5C1E5A;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer;font-weight:bold">🖨️ Imprimer</button>
    <span style="font-size:12px;background:#f0e4f0;color:#5C1E5A;padding:6px 12px;border-radius:8px;font-weight:700">🏷️ ${getEtiqA4Fmt().label}</span>
    <button onclick="window.close()" style="background:#eee;color:#333;border:1px solid #ccc;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer">✕ Fermer</button>
    <span style="font-size:13px;color:#666"><b>${total} étiquettes</b> — ${summary.join(' · ')}</span>
  </div>
  <div class="page">${allLabels.join('')}</div>
  </body></html>`;

  openPrintWindow(html);
  // Demander confirmation après un court délai (temps que la boîte d'impression s'ouvre)
  var _nbTotal=total;
  setTimeout(function(){
    showConfirm(
      '🖨️ Étiquettes bien imprimées ?',
      etiqConfirmMsg(_nbTotal),
      '✅ Oui, vider le lot',
      function(){
        etiqAfterPrint(_nbTotal);
        _e33batch=[]; _e36batch=[]; _e34batch=[];
        renderNav(); renderMain();
        toast('✅ Lot vidé — prêt pour de nouvelles étiquettes', 'success');
      }
    );
  }, 1500);
}

function printAllTotal(){
  return _e33batch.reduce((s,b)=>s+(b.nb||1),0)
       + _e36batch.reduce((s,b)=>s+(b.nb||1),0)
       + _e34batch.reduce((s,b)=>s+(b.nb||1),0);
}

function printAllBanner(){
  const total=printAllTotal();
  const restantes=etiqRestantes();
  const perPage=etiqPerPage();
  const isTherm=getEtiqA4Fmt().id.startsWith('therm');

  // Bannière feuille restante (seulement format A4)
  var feuilleHtml='';
  if(!isTherm && restantes>0){
    // Combien manque-t-il pour finir la feuille en cours ?
    const manque=restantes-total;
    var conseil='';
    if(total===0){
      conseil='Ajoute des étiquettes pour remplir les '+restantes+' cases.';
    } else if(total<restantes){
      conseil='Lot actuel : '+total+' étiq. · Il en manque <b style="color:#fff">'+(restantes-total)+'</b> pour remplir la feuille.';
    } else if(total===restantes){
      conseil='🎯 Le lot actuel ('+total+') remplit exactement les '+restantes+' cases restantes !';
    } else {
      counsel='Lot actuel : '+total+' étiq. → déborde sur une 2ème feuille.';
      conseil='Lot actuel : '+total+' étiq. — les '+restantes+' cases restantes seront remplies + '+(total-restantes)+' sur la feuille suivante.';
    }
    feuilleHtml=`<div style="background:linear-gradient(135deg,#166534,#15803d);border-radius:12px;padding:10px 14px;margin-bottom:8px;display:flex;align-items:center;gap:10px">
    <span style="font-size:1.3rem">📄</span>
    <span style="font-size:.78rem;color:rgba(255,255,255,.9);flex:1">
      <b style="color:#fff">${restantes} case${restantes>1?'s':''} libre${restantes>1?'s':''}</b> sur la feuille entamée
      <span style="font-size:.67rem;opacity:.85;display:block;margin-top:2px">${conseil}</span>
    </span>
    <button onclick="etiqReinitFeuille()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:5px 9px;font-size:.67rem;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;flex-shrink:0" title="À cliquer quand tu prends une feuille neuve OU que tu remets la feuille dans le bon sens">🆕 Feuille neuve</button>
  </div>`;
  } else if(!isTherm && restantes===0 && total>0){
    feuilleHtml=`<div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:10px;padding:7px 12px;margin-bottom:8px;font-size:.72rem;color:#166534;font-weight:700">
    📄 Feuille neuve — ${perPage} cases disponibles
  </div>`;
  }

  if(!total) return feuilleHtml;
  const parts=[];
  const t33=_e33batch.reduce((s,b)=>s+(b.nb||1),0);
  const t36=_e36batch.reduce((s,b)=>s+(b.nb||1),0);
  const t34=_e34batch.reduce((s,b)=>s+(b.nb||1),0);
  if(t33) parts.push(`${t33} témoin${t33>1?'s':''}`);
  if(t36) parts.push(`${t36} excédent${t36>1?'s':''}`);
  if(t34) parts.push(`${t34} prod.`);
  return feuilleHtml+`<div style="background:linear-gradient(135deg,#3b1f8c,#5C1E5A);border-radius:12px;padding:11px 14px;margin-bottom:10px;display:flex;align-items:center;gap:10px">
    <span style="font-size:.8rem;color:rgba(255,255,255,.85);flex:1">
      🗂️ <b style="color:#fff">${total} étiquette${total>1?'s':''} en attente</b>
      <span style="font-size:.7rem;opacity:.75"> — ${parts.join(' · ')}</span>
    </span>
    <button onclick="printAllLabels()" style="background:#fff;color:#5C1E5A;border:none;border-radius:8px;padding:7px 13px;font-size:.78rem;font-weight:900;cursor:pointer;font-family:inherit;white-space:nowrap;touch-action:manipulation">🖨️ Tout imprimer</button>
  </div>`;
}

function etiq33FromENR01(idx){
  // Plat Témoin depuis refroidissement
  const r=(S['enr01']?.lignes||[])[idx];
  if(!r)return;
  S['enr33']=S['enr33']||{};
  S['enr33'].draft33={
    produit:r.produit||'',
    date_prelev:r.date||today(),
    heure_prelev:r.h_ref_fin||'',
    service:'',
    operateur:r.cuisinier||''
  };
  save();autoBackup();goTo('enr33');
  toast('🍱 Plat témoin pré-rempli','success');
}
function etiq34FromENR01(idx){
  // Étiquette production depuis refroidissement
  const r=(S['enr01']?.lignes||[])[idx];
  if(!r)return;
  const dlcIdx=DLC_BASE.findIndex(p=>p.produit.includes('J+3'));
  _e34sel=dlcIdx>=0?dlcIdx:null;
  S['enr34']=S['enr34']||{};
  S['enr34'].draft34={
    produit:r.produit||'',statut:'Fabriqué',
    date_fab:r.date||today(),heure_fab:r.h_ref_fin||'',
    dlc:dlcIdx>=0?dlcCalc(DLC_BASE[dlcIdx],r.date||today()):'',
    stockage:'0/+3°C'
  };
  save();autoBackup();goTo('enr34');
  toast('🏷️ Étiquette pré-remplie','success');
}

Object.values(FDEFS).forEach(def=>{REND[def.id]=makeFR(def);});
// Re-appliquer les renderers custom qui auraient été écrasés
REND['enr23']=renderENR23;
// ════════════════════════════════════════════════════
// DUPLICATION PAGES BUILT-IN
// ════════════════════════════════════════════════════

// Pages built-in duplicables avec leur configuration
const BUILTIN_DUPLICABLE = [
  {id:'enr_tc_distrib', label:'🌡️ T°C Distribution', desc:'Températures Midi & Soir froid/chaud', emoji:'🌡️', cat:'prpo',
   fields:[
     {id:'date',label:'Date',inputType:'date',autoDate:true},
     {id:'service',label:'Service',type:'select',opts:['Midi','Soir','Petit-déjeuner','Goûter']},
     {id:'plat_froid',label:'Plat froid',type:'prod'},{id:'temp_froid',label:'T°C froid',type:'temp',presets:[2,4,6,8,10]},
     {id:'conf_froid',label:'Froid ≤+10°C ? (auto)',type:'conf',auto:true},
     {id:'plat_chaud',label:'Plat chaud',type:'prod'},{id:'temp_chaud',label:'T°C chaud',type:'temp',presets:[63,70,75,80]},
     {id:'conf_chaud',label:'Chaud ≥+63°C ? (auto)',type:'conf',auto:true},
     {id:'cuisinier',label:'Cuisinier / Visa',type:'chef'}
   ],
   regle:'Froid ≤ +10°C — Chaud ≥ +63°C. Une ligne par service.'},
  {id:'enr01', label:'❄️ Refroidissement', desc:'CCP — +63°C → +10°C en 2h', emoji:'❄️', cat:'ccp',
   fields:[
     {id:'date',label:'Date',inputType:'date',autoDate:true},{id:'produit',label:'Produit',type:'prod'},
     {id:'h_ref_deb',label:'Heure début',type:'time',autoTime:true},{id:'t_ref_deb',label:'T°C début',type:'temp',presets:[60,63,70]},
     {id:'h_ref_fin',label:'Heure fin',type:'time'},{id:'t_ref_fin',label:'T°C fin',type:'temp',presets:[0,2,4,6,8,10]},
     {id:'conf_r',label:'Refroid. conforme ?',type:'conf'},{id:'cuisinier',label:'Cuisinier',type:'chef'}
   ],
   regle:'CCP — +63°C → +10°C en moins de 2h.'},
  {id:'enr04', label:'🥩 Cuisson steaks', desc:'PrPo — T°C cœur ≥ +65°C', emoji:'🥩', cat:'prpo',
   fields:[
     {id:'date',label:'Date',inputType:'date',autoDate:true},{id:'h',label:'Heure',type:'time',autoTime:true},
     {id:'produit',label:'Produit',type:'prod'},{id:'tc',label:'T°C à cœur',type:'temp',presets:[63,65,70,75]},
     {id:'conforme',label:'T°C ≥ +65°C ?',type:'conf'},{id:'cuisinier',label:'Cuisinier',type:'chef'}
   ],
   regle:'T°C cœur ≥ +65°C.'},
  {id:'enr19', label:'🌡️ T°C Stockage', desc:'Enceintes ouverture/fermeture', emoji:'🌡️', cat:'mensuel',
   fields:[
     {id:'date',label:'Date',inputType:'date',autoDate:true},{id:'enceinte',label:'Nom enceinte',type:'prod'},
     {id:'moment',label:'Moment',type:'select',opts:['Ouverture','Fermeture']},
     {id:'tc',label:'T°C relevée',type:'temp',presets:[-25,-22,-20,-18,0,2,3,4,6,8]},
     {id:'conforme',label:'Conforme ?',type:'conf'},{id:'cuisinier',label:'Cuisinier',type:'chef'}
   ],
   regle:"Relever à l'ouverture et à la fermeture."},
  {id:'enr23', label:'📦 Réception', desc:'Contrôle qualité à réception', emoji:'📦', cat:'mensuel',
   fields:[
     {id:'date',label:'Date',inputType:'date',autoDate:true},{id:'fournisseur',label:'Fournisseur',type:'prod'},
     {id:'produit',label:'Produit',type:'prod'},{id:'tc',label:'T°C produit',type:'temp',presets:TP_COLD},
     {id:'conforme',label:'Conforme ?',type:'conf'},{id:'cuisinier',label:'Cuisinier',type:'chef'}
   ],
   regle:'Contrôle T°C, emballage, étiquetage à chaque réception.'},
];

function quickDuplicatePage(sourceId){
  // Chercher dans BUILTIN_DUPLICABLE d'abord, sinon dans FDEFS, sinon custom
  const builtin = BUILTIN_DUPLICABLE.find(p=>p.id===sourceId);
  const fdefs = FDEFS[sourceId];
  const custom = (S.customPages||[]).find(p=>p.id===sourceId);
  const source = builtin || custom;
  const sourceName = builtin?.label || fdefs?.title || custom?.name || sourceId;
  const sourceEmoji = builtin?.emoji || custom?.emoji || '📋';
  const sourceCat = builtin?.cat || fdefs?.tagCat || custom?.cat || 'suivi';
  const sourceRegle = builtin?.regle || fdefs?.regle || custom?.regle || '';
  const sourceFields = builtin?.fields || fdefs?.fields || custom?.fields || [];

  const newId = 'cp_' + Date.now();
  const newName = sourceName + ' — Copie';

  const copy = {
    id: newId,
    name: newName,
    emoji: sourceEmoji,
    cat: sourceCat,
    regle: sourceRegle,
    fields: sourceFields.map(f=>({...f})),
    sourceId: builtin ? sourceId : undefined  // pour hériter le renderer built-in spécial
  };

  S.customPages = S.customPages||[];
  S.customPages.push(copy);
  registerCustomPages();
  save(); renderSP();

  // Focus sur le champ renommer de la nouvelle page
  setTimeout(()=>{
    const inp = document.getElementById('cp-rename-'+newId);
    if(inp){ inp.focus(); inp.select(); }
  }, 150);

  toast('📋 "'+newName+'" créée — renommez-la ci-dessus', 'success');
}

function openDuplicateBuiltinModal(){
  const items = BUILTIN_DUPLICABLE.map((p,i)=>`
    <div onclick="duplicateBuiltinPage(${i})" style="display:flex;align-items:center;gap:12px;padding:12px;border:1.5px solid var(--brd);border-radius:12px;cursor:pointer;margin-bottom:8px;background:var(--fond);transition:.15s"
      onmousedown="this.style.background='#f0e8f0'" onmouseup="this.style.background='var(--fond)'">
      <span style="font-size:1.6rem">${p.emoji}</span>
      <div>
        <div style="font-size:.88rem;font-weight:800;color:var(--gris)">${p.label}</div>
        <div style="font-size:.72rem;color:#b89ab6;margin-top:2px">${p.desc}</div>
      </div>
      <span style="margin-left:auto;font-size:1rem;color:var(--plum)">📋</span>
    </div>`).join('');

  showPrompt('📋 Dupliquer une page','Choisissez la page à dupliquer puis donnez un nom :',
    `<div style="max-height:60vh;overflow-y:auto;margin-bottom:12px">${items}</div>`,
    ()=>{});
}

function duplicateBuiltinPage(idx){
  const p = BUILTIN_DUPLICABLE[idx];
  showPrompt('Nom de la copie', 'Ex: '+p.label+' — Salle 2', p.label+' — Copie', name=>{
    if(!name||!name.trim())return;
    const newId='cp_'+Date.now();
    const copy={
      id:newId, name:name.trim(), emoji:p.emoji, cat:p.cat,
      regle:p.regle, fields:[...p.fields.map(f=>({...f}))]
    };
    S.customPages=S.customPages||[];
    S.customPages.push(copy);
    registerCustomPages();
    save();renderSP();
    toast('📋 "'+name.trim()+'" créée — visible dans la nav','success');
  });
}

REND['enr_tc_distrib']=renderENR_TC_DISTRIB;
REND['enr07']=renderENR07;
REND['enr31']=renderENR31;
REND['enr33']=renderENR33;
REND['enr36']=renderENR36;
REND['enr34']=renderENR34;


// ── Surcharge ENR02 et ENR03 avec le bloc "en attente ENR01" ──
REND['enr02']=()=>{
  const def=FDEFS['enr02'];
  const tagH=`<span class="tag ccp">CCP</span>`;
  return`
    ${pendingENR01Block('enr02')}
    <div class="card">
      <div class="card-title">${def.title} ${tagH}</div>
      <div class="regle">${def.regle}</div>
      <div id="ccp-timer-enr02"></div>
      <div class="fg-label">Nouvelle saisie${((S['enr02']||{}).draft||{})._enr01_idx!==undefined?' — <span style="color:#166534;font-weight:800">Pré-rempli depuis Refroidissement ✓</span>':''}</div>
      ${renderFields(def.fields,def.id)}
      <div class="btn-row">
        <button class="btn-save" onclick="saveRow('enr02')">✅ Enregistrer</button>
        <button class="btn btn-sec" onclick="clearRow('enr02')">🔄 Effacer</button>

      </div>
    </div>
    ${renderHistoCard('enr02',def.fields)}`;
};
REND['enr03']=()=>{
  const def=FDEFS['enr03'];
  const tagH=`<span class="tag ccp">CCP</span>`;
  const draft=(S['enr03']||{}).draft||{};
  const isAuto=draft._enr01_idx!==undefined;
  return`
    ${pendingENR01Block('enr03')}
    <div class="card">
      <div class="card-title">${def.title} ${tagH}</div>
      <div class="regle">${def.regle}</div>
      <div class="fg-label">Nouvelle saisie${isAuto?' — <span style="color:#166534;font-weight:800">Refroidissement pré-rempli ✓ — complétez la remise</span>':''}</div>
      ${renderFields(def.fields,def.id)}
      <div class="btn-row">
        <button class="btn-save" onclick="saveRow('enr03')">✅ Enregistrer</button>
        <button class="btn btn-sec" onclick="clearRow('enr03')">🔄 Effacer</button>

      </div>
    </div>
    ${renderHistoCard('enr03',def.fields)}`;
};

// ════════════════════════════════════════════════════
// SYNC ENGINE
// ════════════════════════════════════════════════════
// ════════════════════════════════════════════════════
// SYNC ENGINE — Google Sheets via Apps Script
// ════════════════════════════════════════════════════
const SYNC_SECTIONS_DEF = [
  {id:'enr01',label:'❄️ Refroid. CCP'},{id:'enr02',label:'🔥 Remise T°C CCP'},
  {id:'enr03',label:'🔄 Refroid.+Remise'},{id:'enr04',label:'🥩 Steaks hachés'},
  {id:'enr05',label:'🍟 Fritures'},{id:'enr06',label:'🍟 Fritures+test'},
  {id:'enr07',label:'🥘 Bien Faits cuit'},{id:'enr08',label:'🥗 TM/BF'},
  {id:'enr09',label:'♨️ Cond. chaud'},{id:'enr10',label:'🧊 Cond. froid'},
  {id:'enr11',label:'🍽️ Plateaux froids'},{id:'enr12',label:'🍽️ Plateaux chauds'},
  {id:'enr13',label:'🚚 Départ cuisine'},{id:'enr14',label:'🛎️ Distrib. plat.'},
  {id:'enr15',label:'🏠 Distrib. SAM'},{id:'enr16',label:'🍴 Distrib. Self'},
  {id:'enr17',label:'🚐 Livraison froide'},{id:'enr18',label:'🚐 Livraison chaude'},
  {id:'enr19',label:'🌡️ Stockage T°C'},{id:'enr23',label:'📦 Réception'},
  {id:'enr26',label:'🌡️ Thermomètres'},{id:'enr27',label:'📊 Afficheurs'},
  {id:'enr29',label:'👥 Sensibilisation'},{id:'enr30',label:'🚨 Non-conformités'},
  {id:'enr31',label:'📋 Traçabilité MP'},{id:'enr32',label:'⚠️ TIAC'},
  {id:'enr33',label:'🍱 Plats témoins'},{id:'enr34',label:'🏷️ Étiq. prod.'},
  {id:'enr35',label:'🥩 Origine viandes'},{id:'enr36',label:'♻️ Excédents'},
  {id:'enr39',label:'🧺 Pique-nique'},{id:'enr52',label:'🌡️ T°C excédents'},
  {id:'enr53',label:'🤝 Don assoc.'},
  {id:'enr28',label:'🧹 Nettoyage'},
  {id:'enr_tc_distrib',label:'🌡️ T°C Distribution (ancien)'},
  {id:'enr24',label:'🔧 Maintenance équipements'},
  {id:'enr25',label:'🔬 Contrôle labo'},
  {id:'enr_allergenes',label:'⚠️ Allergènes INCO'},
];
// Sections dynamiques : distribution + custom pages
function getSyncSections(){
  var svcs=getDistribServices();
  var distribSecs=svcs.map(function(s){return {id:'enr_distrib_'+s.id,label:(s.ico||'🍽️')+' '+s.label};});
  var customSecs=(S.customPages||[]).filter(function(cp){return (S[cp.id]&&S[cp.id].lignes||[]).length>0;})
    .map(function(cp){return {id:cp.id,label:cp.emoji+' '+cp.name};});
  return distribSecs.concat(SYNC_SECTIONS_DEF).concat(customSecs);
}

function getSyncCfg(){return S.syncCfg||{};}
function saveSyncCfg(){
  S.syncCfg=S.syncCfg||{};
  S.syncCfg.url=document.getElementById('sync-url')?.value||'';
  S.syncCfg.siteId=document.getElementById('sync-site-id')?.value||'';
  S.syncCfg.siteNom=document.getElementById('sync-site-nom')?.value||'';
  save();
}

function openSyncModal(){
  if(featCheck(LIC_FEAT.SYNC,"Synchronisation Google Sheets"))return;
  const cfg=getSyncCfg();
  // Remplir les champs
  const urlEl=document.getElementById('sync-url');
  const idEl=document.getElementById('sync-site-id');
  const nomEl=document.getElementById('sync-site-nom');
  if(urlEl)urlEl.value=cfg.url||'';
  if(idEl)idEl.value=cfg.siteId||document.getElementById('etab-code')?.value||'';
  if(nomEl)nomEl.value=cfg.siteNom||document.getElementById('etab-nom')?.value||'';
  // Rendu de la liste des sections
  renderSyncSections();
  // Statut banner
  updateSyncBanner();
  // Réinitialiser le log
  const logEl=document.getElementById('sync-log');
  if(logEl){logEl.style.display='none';logEl.innerHTML='';}
  document.getElementById('sync-ov').classList.add('open');
}
function closeSyncModal(){document.getElementById('sync-ov').classList.remove('open');}

function renderSyncSections(){
  const cfg=getSyncCfg();
  const synced=cfg.synced||{};      // {enr01: "2025-03-08T14:22:00Z", ...}
  const selected=cfg.selected!=null?cfg.selected:getSyncSections().map(s=>s.id);
  const el=document.getElementById('sync-sections');
  if(!el)return;
  el.innerHTML=getSyncSections().map(s=>{
    const nb=s.id==='enr28'?(S.nett_val||[]).length:s.id==='enr19'?(S['enr19']?.saisies||[]).length:(S[s.id]?.lignes||[]).length;
    if(nb===0)return''; // Ne pas afficher les sections vides
    const lastSync=synced[s.id];
    const isChecked=selected.includes(s.id);
    const syncInfo=lastSync
      ? `<span class="cnt">✓ ${new Date(lastSync).toLocaleDateString('fr-FR')}</span>`
      : `<span class="cnt" style="color:#e65100">Non envoyé</span>`;
    return`<div class="sync-sec-item" onclick="toggleSyncSec('${s.id}',this)">
      <input type="checkbox" id="ss-${s.id}" ${isChecked?'checked':''} onclick="event.stopPropagation();toggleSyncSec('${s.id}',this.closest('.sync-sec-item'))">
      <div><label for="ss-${s.id}" style="pointer-events:none">${s.label}</label><br>${syncInfo} · <span class="cnt">${nb} saisie${nb>1?'s':''}</span></div>
    </div>`;
  }).join('');
}
function toggleSyncSec(id,el){
  const cb=el.querySelector('input[type=checkbox]');if(!cb)return;
  cb.checked=!cb.checked;
  S.syncCfg=S.syncCfg||{};
  let sel=S.syncCfg.selected!=null?[...S.syncCfg.selected]:getSyncSections().map(s=>s.id);
  if(cb.checked){if(!sel.includes(id))sel.push(id);}
  else{sel=sel.filter(x=>x!==id);}
  S.syncCfg.selected=sel;save();
}
function syncSelectAll(v){
  S.syncCfg=S.syncCfg||{};
  S.syncCfg.selected=v?getSyncSections().map(s=>s.id):[];
  save();renderSyncSections();
}
function syncSelectNonSynced(){
  const cfg=getSyncCfg();const synced=cfg.synced||{};
  S.syncCfg=S.syncCfg||{};
  S.syncCfg.selected=getSyncSections().filter(s=>{var nb=s.id==='enr28'?(S.nett_val||[]).length:s.id==='enr19'?(S['enr19']?.saisies||[]).length:(S[s.id]?.lignes||[]).length;return nb>0&&!synced[s.id];}).map(s=>s.id);
  save();renderSyncSections();
}

function updateSyncBanner(){
  const cfg=getSyncCfg();
  const banner=document.getElementById('sync-banner');
  const txt=document.getElementById('sync-banner-txt');
  if(!banner||!txt)return;
  const lastSync=cfg.lastSync;
  const dot=banner.querySelector('.sync-dot');
  if(!lastSync){
    banner.className='sync-banner never';
    if(dot){dot.className='sync-dot idle';}
    txt.textContent='Jamais synchronisé — Les données restent uniquement sur cette tablette';
  } else {
    const d=new Date(lastSync);
    const diffH=Math.round((Date.now()-d)/3600000);
    const ok=diffH<25;
    banner.className=`sync-banner ${ok?'ok':'warn'}`;
    if(dot){dot.className=`sync-dot ${ok?'ok':'warn'}`;}
    txt.textContent=`Dernière sync : ${d.toLocaleString('fr-FR')} (il y a ${diffH<2?'moins d\'1h':`${diffH}h`})`;
  }
}

function syncLog(msg,type='info'){
  const el=document.getElementById('sync-log');
  if(!el)return;
  el.style.display='block';
  const span=document.createElement('span');
  span.className=type;
  span.textContent=`[${new Date().toLocaleTimeString('fr-FR')}] ${msg}\n`;
  el.appendChild(span);
  el.scrollTop=el.scrollHeight;
}

async function doSync(){
  const cfg=getSyncCfg();
  const url=document.getElementById('sync-url')?.value?.trim();
  const siteId=document.getElementById('sync-site-id')?.value?.trim();
  const siteNom=document.getElementById('sync-site-nom')?.value?.trim();
  saveSyncCfg();

  if(!url){toast('⚠️ Renseignez l\'URL du script Google','warning');return;}
  if(!siteId){toast('⚠️ Renseignez le code site','warning');return;}

  const selected=cfg.selected!=null?cfg.selected:getSyncSections().map(s=>s.id);
  const toSync=getSyncSections().filter(s=>{
    if(!selected.includes(s.id)) return false;
    if(s.id==='enr28') return (S.nett_val||[]).length>0;
    if(s.id==='enr19') return (S['enr19']?.saisies||[]).length>0;
    return (S[s.id]?.lignes||[]).length>0;
  });

  if(toSync.length===0){toast('⚠️ Aucune section sélectionnée avec des données','warning');return;}

  const btn=document.getElementById('sync-go-btn');
  const mainBtn=document.getElementById('sp-sync-dot');
  if(btn){btn.disabled=true;btn.innerHTML='<span class="spin">⏳</span> Envoi en cours…';}
  if(mainBtn){mainBtn.style.background='#ff9800';}

  // Log console
  const logEl=document.getElementById('sync-log');
  if(logEl){logEl.style.display='block';logEl.innerHTML='';}
  syncLog(`Connexion à ${url.slice(0,60)}…`,'info');
  syncLog(`Site : ${siteId} — ${siteNom}`,'info');
  syncLog(`${toSync.length} section(s) à envoyer`,'info');

  // Construire le payload
  const mois=document.getElementById('etab-mois')?.value||new Date().toISOString().slice(0,7);
  const payload=toSync.map(s=>({
    site_id:siteId,
    site_nom:siteNom,
    mois,
    enr_section:s.id,
    records:s.id==='enr28'?(S.nett_val||[]):s.id==='enr19'?(S['enr19']?.saisies||[]):(S[s.id]?.lignes||[]),
    config:S.config||{},
  }));

  let success=0,errors=0;
  // Envoyer par batch de 5 sections pour éviter les timeouts
  const BATCH=5;
  for(let i=0;i<payload.length;i+=BATCH){
    const batch=payload.slice(i,i+BATCH);
    const sectionNames=batch.map(b=>b.enr_section).join(', ');
    syncLog(`Envoi : ${sectionNames}…`,'info');
    try{
      const resp=await fetch(url,{
        method:'POST',
        // Apps Script n'accepte pas application/json cross-origin sans CORS config,
        // on passe par text/plain que Apps Script accepte toujours
        headers:{'Content-Type':'text/plain'},
        body:JSON.stringify(batch),
        mode:'cors',
      });
      if(!resp.ok)throw new Error(`HTTP ${resp.status}`);
      const data=await resp.json();
      if(data.status==='ok'){
        success+=batch.length;
        syncLog(`✓ ${sectionNames} — ${data.processed} section(s) traitée(s)`,'ok');
        // Marquer comme synchro réussie
        batch.forEach(b=>{
          S.syncCfg.synced=S.syncCfg.synced||{};
          S.syncCfg.synced[b.enr_section]=new Date().toISOString();
        });
      } else {
        throw new Error(data.message||'Erreur serveur');
      }
    } catch(err){
      errors+=batch.length;
      syncLog(`✗ ${sectionNames} : ${err.message}`,'err');
    }
  }

  // Résultat final
  const ts=new Date().toISOString();
  if(success>0){S.syncCfg.lastSync=ts;}
  save();
  updateSyncBanner();

  if(errors===0){
    syncLog(`══ Terminé : ${success} section(s) envoyée(s) avec succès ══`,'ok');
    toast(`✅ Sync réussie — ${success} section(s) envoyées`,'success');
    updateSyncDot('ok');
  } else if(success>0){
    syncLog(`══ Partiel : ${success} OK / ${errors} erreur(s) ══`,'err');
    toast(`⚠️ Sync partielle — ${errors} erreur(s)`,'warning');
    updateSyncDot('warn');
  } else {
    syncLog(`══ Échec complet — vérifiez l'URL et le Wi-Fi ══`,'err');
    toast('❌ Sync échouée — vérifiez la connexion','warning');
    updateSyncDot('err');
  }

  if(btn){btn.disabled=false;btn.innerHTML='⬆️ Synchroniser à nouveau';}
  if(mainBtn){mainBtn.style.background='#4caf50';}
  renderSyncSections();
}

function updateSyncDot(state){
  const dot=document.getElementById('sync-dot');
  if(dot)dot.className=`sync-dot ${state}`;
}

// Vérifier le statut au démarrage
function initSyncStatus(){
  const cfg=getSyncCfg();
  if(!cfg.url){updateSyncDot('idle');return;}
  if(!cfg.lastSync){updateSyncDot('warn');return;}
  const diffH=(Date.now()-new Date(cfg.lastSync))/3600000;
  updateSyncDot(diffH<25?'ok':'warn');
}

// Auto-sync si Wi-Fi disponible et dernière sync > 24h
async function autoSyncCheck(){
  const cfg=getSyncCfg();
  if(!cfg.url||!cfg.siteId)return;
  if(!cfg.lastSync)return; // Ne pas forcer la 1ère sync
  const diffH=(Date.now()-new Date(cfg.lastSync))/3600000;
  if(diffH<12)return; // OK si < 12h
  // Proposer une sync si > 24h
  if(diffH>24){
    toast('⚠️ Dernière sync > 24h — pensez à synchroniser','warning');
    updateSyncDot('warn');
  }
}


// ════════════════════════════════════════════════════
// SUPABASE SYNC ENGINE — offline-first queue

// ════════════════════════════════════════════════════
// EXPORT — GESTION DE LA PÉRIODE
// ════════════════════════════════════════════════════
function setPeriod(p){
  S.expCfg=S.expCfg||{};
  S.expCfg.period=p;
  save();
  // Mise à jour pills
  document.querySelectorAll('.period-pill').forEach(b=>{
    b.classList.toggle('on',b.dataset.period===p);
  });
  // Afficher/masquer custom
  const customBlock=document.getElementById('period-custom-block');
  if(customBlock)customBlock.style.display=p==='custom'?'flex':'none';
  updatePeriodLabel();
}
function getExpPeriod(){
  return getPeriodByKey(S.expCfg?.period||'mois','excel');
}
function fmtDateFr(iso){
  if(!iso)return'';
  try{return new Date(iso+'T12:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'});}catch(e){return iso;}
}
function updatePeriodLabel(){
  const el=document.getElementById('period-label');
  if(!el)return;
  const{label}=getExpPeriod();
  el.textContent='📅 '+label;
}
// ── Période pour le modal Audit (PDF) ──────────────
function setAuditPeriod(p){
  S.expCfg=S.expCfg||{};S.expCfg.auditPeriod=p;save();
  document.querySelectorAll('#audit-period-pills .period-pill').forEach(b=>b.classList.toggle('on',b.dataset.period===p));
  const cb=document.getElementById('audit-period-custom');
  if(cb)cb.style.display=p==='custom'?'flex':'none';
  const lbl=document.getElementById('audit-period-label');
  if(lbl)lbl.textContent='📅 '+getPeriodByKey(p,'audit').label;
}
function initAuditPeriod(){
  const p=S.expCfg?.auditPeriod||'mois';
  setTimeout(()=>{
    document.querySelectorAll('#audit-period-pills .period-pill').forEach(b=>b.classList.toggle('on',b.dataset.period===p));
    const cb=document.getElementById('audit-period-custom');
    if(cb)cb.style.display=p==='custom'?'flex':'none';
    const lbl=document.getElementById('audit-period-label');
    if(lbl)lbl.textContent='📅 '+getPeriodByKey(p,'audit').label;
  },60);
}

// ── Période pour le panel CSV ────────────────────────
function setSpPeriod(p){
  S.expCfg=S.expCfg||{};S.expCfg.spPeriod=p;save();
  document.querySelectorAll('#sp-period-pills .period-pill').forEach(b=>b.classList.toggle('on',b.dataset.period===p));
  const cb=document.getElementById('sp-period-custom');
  if(cb)cb.style.display=p==='custom'?'flex':'none';
  const lbl=document.getElementById('sp-period-label');
  if(lbl)lbl.textContent='📅 '+getPeriodByKey(p,'sp').label;
}
function initSpPeriod(){
  const p=S.expCfg?.spPeriod||'mois';
  setTimeout(()=>{
    document.querySelectorAll('#sp-period-pills .period-pill').forEach(b=>b.classList.toggle('on',b.dataset.period===p));
    const cb=document.getElementById('sp-period-custom');
    if(cb)cb.style.display=p==='custom'?'flex':'none';
    const lbl=document.getElementById('sp-period-label');
    if(lbl)lbl.textContent='📅 '+getPeriodByKey(p,'sp').label;
  },60);
}

// ── Fonction générique de calcul de période par contexte ─
function getPeriodByKey(p, ctx){
  const t=today();
  const d=new Date(t+'T12:00');
  const iso=d=>d.toISOString().slice(0,10);
  const mois=S.config?.mois||t.slice(0,7);
  if(p==='today') return{from:t,to:t,label:"Aujourd'hui ("+fmtDateFr(t)+')'};
  if(p==='week'){const f=new Date(d);f.setDate(f.getDate()-6);return{from:iso(f),to:t,label:'7 derniers jours'};}
  if(p==='15j'){const f=new Date(d);f.setDate(f.getDate()-14);return{from:iso(f),to:t,label:'15 derniers jours'};}
  if(p==='all') return{from:'2020-01-01',to:'2099-12-31',label:'Toutes les données'};
  if(p==='custom'){
    const fromId=ctx==='audit'?'audit-period-from':ctx==='sp'?'sp-period-from':'period-from';
    const toId=ctx==='audit'?'audit-period-to':ctx==='sp'?'sp-period-to':'period-to';
    const f=document.getElementById(fromId)?.value||S.expCfg?.periodFrom||t;
    const to=document.getElementById(toId)?.value||S.expCfg?.periodTo||t;
    if(ctx!=='excel'&&ctx!=='audit'&&ctx!=='sp'){const pf=document.getElementById('period-from');const pt=document.getElementById('period-to');if(pf)pf.value=f;if(pt)pt.value=to;}
    return{from:f,to:to,label:'Du '+fmtDateFr(f)+' au '+fmtDateFr(to)};
  }
  return{from:mois+'-01',to:mois+'-31',label:'Mois de '+new Date(mois+'-01T12:00').toLocaleDateString('fr-FR',{month:'long',year:'numeric'})};
}

// _pFilter global — utilise la période du contexte courant (audit par défaut)
function _pFilter(arr, ctx){
  const p=getPeriodByKey(S.expCfg?.auditPeriod||'mois', ctx||'audit');
  return (arr||[]).filter(r=>{const d=r.date||r._ts?.slice(0,10)||'';return d>=p.from&&d<=p.to;});
}

function filterByPeriod(arr,dateKey='date'){
  const{from,to}=getExpPeriod();
  return arr.filter(r=>{
    const d=r[dateKey]||r._ts?.slice(0,10)||'';
    return d>=from&&d<=to;
  });
}

function openExpModal() {
  const cfg = S.expCfg || {};
  const emailEl = document.getElementById('exp-email');
  if (emailEl) emailEl.value = cfg.email || '';
  renderExpSections();
  // Restaurer la période
  const p=cfg.period||'mois';
  setTimeout(()=>{
    document.querySelectorAll('.period-pill').forEach(b=>b.classList.toggle('on',b.dataset.period===p));
    const cb=document.getElementById('period-custom-block');
    if(cb)cb.style.display=p==='custom'?'flex':'none';
    const pf=document.getElementById('period-from');
    const pt=document.getElementById('period-to');
    if(pf)pf.value=cfg.periodFrom||today();
    if(pt)pt.value=cfg.periodTo||today();
    updatePeriodLabel();
  },30);
  document.getElementById('exp-ov').classList.add('open');
}
function closeExpModal() { document.getElementById('exp-ov').classList.remove('open'); }

function renderExpSections() {
  const sel = (S.expCfg || {}).expSel;
  const el = document.getElementById('exp-sections');
  if (!el) return;
  // Sections fixes + pages custom
  const customSections = (S.customPages||[]).map(cp=>({id:cp.id,label:cp.emoji+' '+cp.name}));
  const allSec = [...getExpSections(), ...customSections];
  // Ajouter ENR19 si pas déjà
  if(!allSec.find(s=>s.id==='enr19')) allSec.push({id:'enr19',label:'🌡️ Enceintes T°C'});
  el.innerHTML = allSec.map(s => {
    const nb = s.id==='enr19'
      ? (S['enr19']?.saisies||[]).length
      : s.id==='enr28'
        ? (S.nett_val||[]).length
        : (S[s.id]?.lignes || []).length;
    const checked = sel ? sel.includes(s.id) : nb > 0;
    return `<div class="exp-sec-item" onclick="toggleExpSec('${s.id}',this)">
      <input type="checkbox" id="es-${s.id}" ${checked ? 'checked' : ''} onclick="event.stopPropagation();toggleExpSec('${s.id}',this.closest('.exp-sec-item'))">
      <div><label for="es-${s.id}" style="pointer-events:none">${s.label}</label><br>
      <span class="cnt">${nb} saisie${nb !== 1 ? 's' : ''}</span></div>
    </div>`;
  }).join('');
}
function toggleExpSec(id, el) {
  const cb = el.querySelector('input[type=checkbox]'); if (!cb) return;
  cb.checked = !cb.checked;
  S.expCfg = S.expCfg || {};
  let sel = S.expCfg.expSel != null ? [...S.expCfg.expSel] : EXP_SECTIONS.filter(s => (S[s.id]?.lignes||[]).length > 0).map(s => s.id);
  if (cb.checked) { if (!sel.includes(id)) sel.push(id); }
  else { sel = sel.filter(x => x !== id); }
  S.expCfg.expSel = sel; save();
}
function expSelectAll(v) {
  S.expCfg = S.expCfg || {};
  const allIds = [...getExpSections(), ...(S.customPages||[]).map(cp=>({id:cp.id}))].map(s=>s.id);
  S.expCfg.expSel = v ? allIds : [];
  save(); renderExpSections();
}
function expSelectWithData() {
  S.expCfg = S.expCfg || {};
  const allSec = [...getExpSections(), ...(S.customPages||[]).map(cp=>({id:cp.id}))];
  S.expCfg.expSel = allSec.filter(s => {
    if(s.id==='enr28') return (S.nett_val||[]).length>0;
    return (S[s.id]?.lignes||[]).length>0 || (S[s.id]?.saisies||[]).length>0;
  }).map(s => s.id);
  save(); renderExpSections();
}

async function doExportXLSX() {
  if(featCheck(LIC_FEAT.EXPORT,"Export Excel"))return;
  if (typeof XLSX === 'undefined') {
    toast('⚠️ SheetJS non chargé — vérifiez la connexion internet', 'warning'); return;
  }
  const cfg = S.expCfg || {};
  const email = document.getElementById('exp-email')?.value?.trim() || '';
  saveExpCfg();

  // Construire la liste dynamique : sections fixes + pages custom avec données
  const customSections = (S.customPages||[])
    .filter(cp=>(S[cp.id]?.lignes||[]).length>0)
    .map(cp=>({id:cp.id, label:cp.emoji+' '+cp.name}));
  const allSections = [...getExpSections(), ...customSections];

  const sel = cfg.expSel != null ? cfg.expSel : allSections.filter(s => (S[s.id]?.lignes||[]).length > 0 || s.id==='enr19').map(s => s.id);
  const toExp = allSections.filter(s => sel.includes(s.id) && ((S[s.id]?.lignes||[]).length > 0 || s.id==='enr19'));

  if (toExp.length === 0) { toast('⚠️ Aucune section avec des données sélectionnée', 'warning'); return; }

  const btn = document.getElementById('exp-go-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Génération…'; }

  // Laisser l'UI se mettre à jour avant le traitement lourd
  await new Promise(r => setTimeout(r, 80));

  const wb = XLSX.utils.book_new();
  const site = S.config?.etab || S.syncCfg?.siteNom || 'Site';
  const mois = S.config?.mois || new Date().toISOString().slice(0, 7);
  const [_y,_m]=mois.split('-');
  const moisLabel=new Date(+_y,+_m-1,1).toLocaleDateString('fr-FR',{month:'long',year:'numeric'});
  // ── Période sélectionnée ──────────────────────────────
  const _period=getExpPeriod();
  const _pFrom=_period.from, _pTo=_period.to, _pLabel=_period.label;
  const _pFilter=arr=>arr.filter(r=>{const d=r.date||r._ts?.slice(0,10)||'';return d>=_pFrom&&d<=_pTo;});
  const fmtDate=d=>d?new Date(d+'T12:00').toLocaleDateString('fr-FR'):'';
  const fmtT=v=>v!==undefined&&v!==''?parseFloat(v).toFixed(1)+'°C':'';
  const conf=v=>v==='OUI'?'✓ OUI':v==='NON'?'✗ NON':v||'';

  // ══════════════════════════════════════════════════════════
  // FEUILLE 1 — TABLEAU DE BORD DIRECTEUR
  // ══════════════════════════════════════════════════════════
  const ligNC=_pFilter(S['enr30']?.lignes||[]);
  const ligNCopen=ligNC.filter(r=>r.cloture!=='OUI');
  const ligEnr01=(S['enr01']?.lignes||[]).filter(r=>r.date?.startsWith(mois));
  const ligEnr01NC=ligEnr01.filter(r=>r.conf_r==='NON'||r.conforme==='NON');
  const saisiesEnc=_pFilter(S['enr19']?.saisies||[]);
  const encs=getEnceintes();
  const encNC=saisiesEnc.filter(r=>{const e=encs.find(e=>e.id===r.enc_id);return e&&encConforme(r.temp,e.consigne)===false;}).length;
  const ligNett=_pFilter(S.nett_val||[]);
  const ligNettNC=ligNett.filter(v=>v.conforme==='NON');
  const ligRecep=_pFilter(S['enr23']?.lignes||[]);
  const ligRecepNC=ligRecep.filter(r=>r.conforme==='NON');
  const nuisOUI=_pFilter(S.nuisibles_val||[]).filter(v=>v.presence==='OUI');

  const dashData=[
    ['TABLEAU DE BORD HACCP — '+site.toUpperCase(),'','',''],
    ['Période :',_pLabel,'Export :',new Date().toLocaleString('fr-FR')],
    ['','','',''],
    ['INDICATEUR','RÉSULTAT',mois,'STATUT'],
    ['Non-conformités enregistrées ce mois',ligNC.length,'',ligNC.length===0?'✓ Aucune':'⚠️ Voir détail'],
    ['NC en attente de clôture',ligNCopen.length,'',ligNCopen.length===0?'✓ Toutes clôturées':'⚠️ '+ligNCopen.length+' à traiter'],
    ['Refroidissements non conformes',ligEnr01NC.length,'',ligEnr01NC.length===0?'✓ OK':'✗ NC'],
    ['Relevés T°C enceintes hors seuil',encNC,'',encNC===0?'✓ OK':'✗ NC'],
    ['Nettoyages non conformes',ligNettNC.length,'',ligNettNC.length===0?'✓ OK':'⚠️ Voir'],
    ['Présence nuisibles détectée',nuisOUI.length,'',nuisOUI.length===0?'✓ RAS':'⚠️ Voir'],
    ['Contrôles réception NC',ligRecepNC.length,'',ligRecepNC.length===0?'✓ OK':'⚠️ Voir'],
    ['','','',''],
    ['VOLUMES','','',''],
    ['Refroidissements enregistrés',ligEnr01.length,'',''],
    ['Relevés enceintes ce mois',saisiesEnc.length,'',''],
    ['Nettoyages validés ce mois',ligNett.length,'',''],
    ['T°C Distribution enregistrées',getDistribServices().reduce(function(s,svc){return s+((S['enr_distrib_'+svc.id]&&S['enr_distrib_'+svc.id].lignes||[]).length);},0),'',''],
    ['Réceptions contrôlées',ligRecep.length,'',''],
    ['Vérifications nuisibles',((S.nuisibles_val||[]).filter(v=>v.date?.startsWith(mois))).length,'',''],
  ];
  const wsDash=XLSX.utils.aoa_to_sheet(dashData);
  wsDash['!cols']=[{wch:42},{wch:12},{wch:12},{wch:28}];
  wsDash['!merges']=[{s:{r:0,c:0},e:{r:0,c:3}}];
  XLSX.utils.book_append_sheet(wb,wsDash,'📊 Tableau de bord');

  // ══════════════════════════════════════════════════════════
  // FEUILLE 2 — NON-CONFORMITÉS (toutes, pas seulement le mois)
  // ══════════════════════════════════════════════════════════
  const allNC=_pFilter(S['enr30']?.lignes||[]);
  if(allNC.length>0){
    const hdrsNC=['N° NC','Date','Heure','Responsable','Source','Description','Lieu','Cause Méthode','Cause Milieu','Cause Matériel','Cause Matière 1ère','Cause Main d\'œuvre','Action corrective immédiate','Traitement produit','Responsable informé','Clôturée ?','Plan d\'action préventif','Date réalisation','Signature'];
    const rowsNC=allNC.map(r=>{
      const traits=[];
      if(r.trait_produitjet||r.trait_produitjete)traits.push('Produit jeté');
      if(r.trait_produitconserv)traits.push('Conservé');
      if(r.trait_bloqureprisefournis||r.trait_bloqureprisefournisseur)traits.push('Bloqué fournisseur');
      if(r.trait_autre)traits.push('Autre');
      return[
        r.num||'—', fmtDate(r.date), r.heure_nc||'', r.nom_fct||'',
        r._auto?'🤖 Auto':'✍️ Manuel',
        r.desc||'', r.lieu||'',
        r.cause_mthode?'✓':'', r.cause_milieu?'✓':'', r.cause_matriel?'✓':'',
        r.cause_matirepremi?'✓':'', r.cause_mainduvre?'✓':'',
        r.action||'', traits.join(', '), r.resp||'',
        r.cloture==='OUI'?'✓ Clôturée':'⏳ En attente',
        r.plan||'', fmtDate(r.date_real),
        r.signature?'✓ Signée':''
      ];
    });
    const wsNC=XLSX.utils.aoa_to_sheet([
      ['REGISTRE DES NON-CONFORMITÉS — '+site,'','','',''],
      ['Toutes périodes confondues — Export :',new Date().toLocaleString('fr-FR'),'','',''],
      ['Total NC :',allNC.length,'  Clôturées :',allNC.filter(r=>r.cloture==='OUI').length,'  En attente :',allNC.filter(r=>r.cloture!=='OUI').length],
      [],
      hdrsNC,...rowsNC
    ]);
    wsNC['!cols']=[{wch:10},{wch:12},{wch:8},{wch:18},{wch:12},{wch:45},{wch:22},{wch:8},{wch:8},{wch:8},{wch:8},{wch:8},{wch:38},{wch:22},{wch:20},{wch:14},{wch:38},{wch:14},{wch:10}];
    XLSX.utils.book_append_sheet(wb,wsNC,'🚨 Non-conformités');
  }

  // ══════════════════════════════════════════════════════════
  // FEUILLE 3 — T°C ENCEINTES (par enceinte, vue tableau croisé)
  // ══════════════════════════════════════════════════════════
  const allSaisies=_pFilter(S['enr19']?.saisies||[]);
  if(allSaisies.length>0){
    // Trier par date
    const sorted=[...allSaisies].sort((a,b)=>a._ts?.localeCompare(b._ts)||0);
    // En-têtes dynamiques : Date + une paire Ouv/Ferm par enceinte
    const encLabels=encs.map(e=>e.label);
    const hdrsEnc=['Date',...encLabels.flatMap(l=>[l+' Ouv.','Conf.','Ferm.','Conf.']),'Cuisinier'];
    // Grouper par date
    const byDate={};
    sorted.forEach(r=>{byDate[r.date]=byDate[r.date]||{};const key=r.enc_id+'_'+r.moment;byDate[r.date][key]=r;byDate[r.date].cuisinier=byDate[r.date].cuisinier||r.cuisinier||'';});
    const rowsEnc=Object.entries(byDate).sort((a,b)=>a[0].localeCompare(b[0])).map(([date,recs])=>{
      const row=[fmtDate(date)];
      encs.forEach(e=>{
        const ouv=recs[e.id+'_ouv'];const ferm=recs[e.id+'_ferm'];
        const cO=ouv?encConforme(ouv.temp,e.consigne):null;
        const cF=ferm?encConforme(ferm.temp,e.consigne):null;
        row.push(ouv?fmtT(ouv.temp):'—');
        row.push(cO===true?'✓ OUI':cO===false?'✗ NON':'—');
        row.push(ferm?fmtT(ferm.temp):'—');
        row.push(cF===true?'✓ OUI':cF===false?'✗ NON':'—');
      });
      row.push(recs.cuisinier||'');
      return row;
    });
    const wsEnc=XLSX.utils.aoa_to_sheet([
      ['T°C ENCEINTES DE STOCKAGE — '+site,'','',''],
      ['Consignes : '+encs.map(e=>e.label+' '+e.consigne).join(' · '),'','',''],
      [],
      hdrsEnc,...rowsEnc
    ]);
    const encCols=[{wch:12},...encs.flatMap(()=>[{wch:12},{wch:10},{wch:12},{wch:10}]),{wch:18}];
    wsEnc['!cols']=encCols;
    XLSX.utils.book_append_sheet(wb,wsEnc,'🌡️ T°C Enceintes');
  }

  // ══════════════════════════════════════════════════════════
  // FEUILLE 4 — REFROIDISSEMENTS CCP (ENR01/02/03)
  // ══════════════════════════════════════════════════════════
  const ligR=_pFilter(S['enr01']?.lignes||[]);
  if(ligR.length>0){
    const hdrsR=['Date','Produit','Heure début refr.','T°C début','Heure fin refr.','T°C fin','Durée refr.','Conforme refr.','Statut suivi','Cuisinier'];
    const rowsR=ligR.map(r=>[
      fmtDate(r.date),r.produit||'',
      r.h_ref_deb||'',fmtT(r.t_ref_deb),r.h_ref_fin||'',fmtT(r.t_ref_fin),
      r.duree_r||r.duree||'',conf(r.conf_r||r.conforme),
      r._statut==='rechauffe'?'🔥 Réchauffé':r._statut==='servi_froid'?'❄️ Servi froid':r._statut==='rechauffe_remise'?'🔄 Refr.+Remise':'⏳ En attente',
      r.cuisinier||''
    ]);
    const wsR=XLSX.utils.aoa_to_sheet([
      ['CCP REFROIDISSEMENTS — '+site,'','',''],
      ['Règle : +63°C → +10°C en moins de 2h','','',''],
      ['Total :',ligR.length,'  NC :',ligEnr01NC.length],
      [],
      hdrsR,...rowsR
    ]);
    wsR['!cols']=[{wch:12},{wch:28},{wch:14},{wch:12},{wch:14},{wch:12},{wch:14},{wch:14},{wch:20},{wch:18}];
    XLSX.utils.book_append_sheet(wb,wsR,'❄️ Refroidissements CCP');
  }

  // ══════════════════════════════════════════════════════════
  // FEUILLE 5 — REMISES EN T°C (ENR02)
  // ══════════════════════════════════════════════════════════
  const ligRec=_pFilter(S['enr02']?.lignes||[]);
  if(ligRec.length>0){
    const hdrsRec=['Date','Produit','Heure début','T°C début','Heure fin','T°C fin','Durée','Conforme','Cuisinier'];
    const rowsRec=ligRec.map(r=>[fmtDate(r.date),r.produit||'',r.h_deb||'',fmtT(r.t_deb),r.h_fin||'',fmtT(r.t_fin),r.duree||'',conf(r.conforme),r.cuisinier||'']);
    const wsRec=XLSX.utils.aoa_to_sheet([
      ['CCP REMISES EN TEMPÉRATURE — '+site,'',''],
      ['Règle : +10°C → +63°C en moins de 1h','',''],
      [],
      hdrsRec,...rowsRec
    ]);
    wsRec['!cols']=[{wch:12},{wch:28},{wch:12},{wch:12},{wch:12},{wch:12},{wch:12},{wch:12},{wch:18}];
    XLSX.utils.book_append_sheet(wb,wsRec,'🔥 Remises en T°C');
  }

  // ══════════════════════════════════════════════════════════
  // FEUILLE 6 — NETTOYAGE + NUISIBLES
  // ══════════════════════════════════════════════════════════
  const valsNett=[..._pFilter(S.nett_val||[])].sort((a,b)=>a._ts?.localeCompare(b._ts)||0);
  const refNett=S.nett_ref||[];
  if(valsNett.length>0){
    const FREQ={'quotidien':'Quotidien','hebdo':'Hebdomadaire','mensuel':'Mensuel','apres_usage':'Après usage'};
    const hdrsNett=['Date','Heure','Zone','Matériel / Surface','Fréquence','Cuisinier','Conforme ?','Commentaire'];
    const rowsNett=valsNett.map(v=>{
      const it=refNett.find(r=>r.id===v.ref_id)||{zone:'?',materiel:v.ref_id||'?',freq:''};
      return[fmtDate(v.date),v.heure||'',it.zone,it.materiel,FREQ[it.freq]||it.freq,v.cuisinier||'',conf(v.conforme),v.commentaire||''];
    });
    // Nuisibles
    const valsNuis=[..._pFilter(S.nuisibles_val||[])].sort((a,b)=>a._ts?.localeCompare(b._ts)||0);
    const hdrsNuis=['Date','Heure','Zone','Présence ?','Action corrective','Cuisinier'];
    const rowsNuis=valsNuis.map(v=>[fmtDate(v.date),v.heure||'',v.zone||'',v.presence==='OUI'?'⚠️ OUI':'✓ NON',v.action||'',v.cuisinier||'']);

    const wsNett=XLSX.utils.aoa_to_sheet([
      ['PLAN DE NETTOYAGE & NUISIBLES — '+site,'','','','','','',''],
      ['Période complète — '+valsNett.length+' validations nettoyage · '+valsNuis.length+' contrôles nuisibles','','','','','','',''],
      ['NC nettoyage :',ligNettNC.length,'  Présences nuisibles :',nuisOUI.length,'','','',''],
      [],
      ['── VALIDATIONS NETTOYAGE ──','','','','','','',''],
      hdrsNett,...rowsNett,
      [],[],
      ['── CONTRÔLES NUISIBLES ──','','','','',''],
      hdrsNuis,...rowsNuis
    ]);
    wsNett['!cols']=[{wch:12},{wch:8},{wch:18},{wch:28},{wch:14},{wch:18},{wch:10},{wch:35}];
    XLSX.utils.book_append_sheet(wb,wsNett,'🧹 Nettoyage & Nuisibles');
  }

  // ══════════════════════════════════════════════════════════
  // FEUILLE 7 — RÉCEPTIONS
  // ══════════════════════════════════════════════════════════
  const ligRecep2=_pFilter(S['enr23']?.lignes||[]);
  if(ligRecep2.length>0){
    const hdrsRecep=['Date','Fournisseur','Véhicule OK','Produit 1','Type','Lot 1','DLC 1','T°C P1','Emballage','Étiquetage','Qualité','Produit 2','Lot 2','DLC 2','T°C P2','Conforme globale','Cuisinier'];
    const rowsRecep=ligRecep2.map(r=>[
      fmtDate(r.date),r.fournisseur||'',r.vehicule||'',
      r.p1_produit||'',r.p1_surge==='1'?'Surgelé':'Frais',r.p1_lot||'',fmtDate(r.p1_dlc),
      fmtT(r.p1_tc),r.p1_emballage||'',r.p1_etiquetage||'',r.p1_qualite||'',
      r.p2_produit||'',r.p2_lot||'',fmtDate(r.p2_dlc),fmtT(r.p2_tc),
      conf(r.conforme),r.cuisinier||r.nom_fct||''
    ]);
    const wsRecep=XLSX.utils.aoa_to_sheet([
      ['CONTRÔLES À LA RÉCEPTION — '+site,'','',''],
      ['Total :',ligRecep2.length,'  NC :',ligRecep2.filter(r=>r.conforme==='NON').length],
      [],
      hdrsRecep,...rowsRecep
    ]);
    wsRecep['!cols']=[{wch:12},{wch:24},{wch:12},{wch:24},{wch:10},{wch:12},{wch:12},{wch:10},{wch:12},{wch:12},{wch:10},{wch:24},{wch:12},{wch:12},{wch:10},{wch:14},{wch:18}];
    XLSX.utils.book_append_sheet(wb,wsRecep,'📦 Réceptions');
  }

  // ══════════════════════════════════════════════════════════
  // FEUILLES DISTRIBUTION — une par service configuré
  // ══════════════════════════════════════════════════════════
  const hdrsD=['Date','Plat froid','T°C froid','Conforme froid','Plat chaud','T°C chaud','Conforme chaud','Heure','Cuisinier'];
  getDistribServices().forEach(function(svc){
    const k='enr_distrib_'+svc.id;
    const ligSvc=_pFilter((S[k]&&S[k].lignes)||[]);
    if(ligSvc.length===0) return;
    const rowsSvc=ligSvc.map(function(r){
      return[fmtDate(r.date),r.froid_plat||'',fmtT(r.froid_temp),conf(r.froid_conf),r.chaud_plat||'',fmtT(r.chaud_temp),conf(r.chaud_conf),r.heure||'',r.cuisinier||''];
    });
    const wsD=XLSX.utils.aoa_to_sheet([
      [(svc.ico||'🍽️')+' '+svc.label+' — '+site,'',''],
      ['Froid ≤ +'+DISTRIB_FROID_MAX+'°C  ·  Chaud ≥ +'+DISTRIB_CHAUD_MIN+'°C','',''],
      [],
      hdrsD,...rowsSvc
    ]);
    wsD['!cols']=[{wch:12},{wch:24},{wch:12},{wch:14},{wch:24},{wch:12},{wch:14},{wch:10},{wch:18}];
    const sheetName=(svc.ico||'')+' '+(svc.label||svc.id);
    XLSX.utils.book_append_sheet(wb,wsD,sheetName.slice(0,28));
  });
  // Ancienne section distribution (rétro-compatibilité)
  const ligDistrib=_pFilter(S['enr_tc_distrib']?.lignes||[]);
  if(ligDistrib.length>0){
    const rowsD=ligDistrib.flatMap(function(r){
      const rows=[];
      if(r.midi_froid_plat||r.midi_chaud_plat)rows.push([fmtDate(r.date),'Midi',r.midi_froid_plat||'',fmtT(r.midi_froid_temp),conf(r.midi_froid_conf),r.midi_chaud_plat||'',fmtT(r.midi_chaud_temp),conf(r.midi_chaud_conf),r.midi_heure||'',r.midi_cuisinier||'']);
      if(r.soir_froid_plat||r.soir_chaud_plat)rows.push([fmtDate(r.date),'Soir',r.soir_froid_plat||'',fmtT(r.soir_froid_temp),conf(r.soir_froid_conf),r.soir_chaud_plat||'',fmtT(r.soir_chaud_temp),conf(r.soir_chaud_conf),r.soir_heure||'',r.soir_cuisinier||'']);
      return rows;
    });
    if(rowsD.length>0){
      const wsD=XLSX.utils.aoa_to_sheet([['T°C DISTRIBUTION (ancien format) — '+site,''],['Froid ≤ +10°C  ·  Chaud ≥ +63°C','',''],[],['Date','Service',...hdrsD.slice(1)],...rowsD]);
      wsD['!cols']=[{wch:12},{wch:8},{wch:24},{wch:12},{wch:14},{wch:24},{wch:12},{wch:14},{wch:10},{wch:18}];
      XLSX.utils.book_append_sheet(wb,wsD,'🍽️ Distrib. (ancien)');
    }
  }

  // ══════════════════════════════════════════════════════════
  // FEUILLES SUPPLÉMENTAIRES — sections avec données (ENR04→ENR18, ENR26, ENR27 etc.)
  // ══════════════════════════════════════════════════════════
  const SKIP_KEYS=['_ts','_sec','_auto','_key','_auto_ligne_idx','_auto_idx','_pending_idx','_ligne_ts','_enr01_ref','_enr02_ref','_enr01_idx','_enr01_ts','_orig','_statut','_src','nom_fct'];
  const isPhotoKey=k=>k.includes('_photo')||k==='photo';
  const isNcRaisonKey=k=>k.startsWith('nc_raison__')||k.startsWith('cause_')||k.startsWith('trait_');

  // Sections déjà traitées en dédié
  // Sections déjà traitées en dédié + toutes les enr_distrib_*
  const _distribIds=getDistribServices().map(function(s){return 'enr_distrib_'+s.id;});
  const ALREADY=['enr28','enr19','enr23','enr_tc_distrib','enr30','enr01','enr02'].concat(_distribIds);

  toExp.forEach(sec=>{
    if(ALREADY.includes(sec.id))return;
    const lignes=_pFilter(S[sec.id]?.lignes||[]);
    if(lignes.length===0)return;

    const def=FDEFS[sec.id];
    // Utiliser les champs FDEFS si disponibles, sinon générer depuis les données
    let cols=[];
    if(def?.fields?.length>0){
      cols=def.fields.filter(f=>!f.computed||lignes.some(r=>r[f.id])).map(f=>f.id);
    } else {
      cols=[...new Set(lignes.flatMap(r=>Object.keys(r).filter(k=>!SKIP_KEYS.includes(k)&&!isPhotoKey(k)&&!isNcRaisonKey(k))))];
    }
    // Toujours avoir date en premier
    if(cols.includes('date'))cols=[,'date',...cols.filter(k=>k!=='date')].filter(Boolean);

    const hdrs=cols.map(k=>{
      if(def?.fields){const f=def.fields.find(f=>f.id===k);if(f)return f.label;}
      return FLAB[k]||k;
    });

    const rows=lignes.map(r=>cols.map(k=>{
      const v=r[k];
      if(v===undefined||v===null||v==='')return'';
      if(k==='date')return fmtDate(String(v));
      const sv=String(v);
      if(sv.length>32760)return'[donnée trop longue]';
      // Formater les conformités
      if(CONF_FIDS.includes(k))return conf(sv);
      // Formater les températures
      if((k.startsWith('t_')||k==='tc')&&!isNaN(parseFloat(sv)))return fmtT(sv);
      return sv;
    }));

    const wsData=[
      [def?.title||sec.label,'',''],
      ['Établissement :',site,'Export :',new Date().toLocaleString('fr-FR')],
      ['Total saisies :',lignes.length,''],
      [],
      hdrs,...rows
    ];
    const ws=XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols']=cols.map(k=>({wch:Math.max(12,(FLAB[k]||k).length+4)}));
    const sheetName=(def?.title||sec.label).replace(/[^\w\s\-+éèêëàâùûüîïôœç°]/g,'').slice(0,28).trim()||sec.id;
    XLSX.utils.book_append_sheet(wb,ws,sheetName);
  });

  // ══════════════════════════════════════════════════════════
  // FEUILLE FINALE — SUIVI FOURNISSEURS
  // ══════════════════════════════════════════════════════════
  const bilanFourc=fourcBilanMois(mois);
  if(bilanFourc.length>0){
    const fourcHdr=['Fournisseur','Jours de livraison','Notes','Livraisons attendues','Reçues','Manquantes','Taux conformité'];
    const fourcRows=bilanFourc.map(f=>[f.nom,f.jours,f.notes,f.attendus,f.faites,f.manquantes,f.taux+'%']);
    const wsFourc=XLSX.utils.aoa_to_sheet([
      ['SUIVI FOURNISSEURS — '+moisLabel,'',''],
      ['Établissement :',site,''],
      [],
      ['BILAN MENSUEL','',''],
      fourcHdr,...fourcRows
    ]);
    wsFourc['!cols']=[{wch:24},{wch:22},{wch:20},{wch:14},{wch:8},{wch:12},{wch:14}];
    XLSX.utils.book_append_sheet(wb,wsFourc,'🤝 Fournisseurs');
  }


  // Générer le fichier
  // Nom fichier avec période
  const _pSlug=_period.from===_period.to?_period.from:_period.from+'_au_'+_period.to;
  const filename = `HACCP_${site.replace(/\s+/g,'_')}_${_pSlug}.xlsx`;
  let wbout, blob;
  try {
    wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  } catch(e) {
    if (btn) { btn.disabled = false; btn.textContent = '📊 Générer et partager'; }
    toast('⚠️ Erreur génération Excel : ' + e.message, 'warning');
    console.error('XLSX error:', e);
    return;
  }

  if (btn) { btn.disabled = false; btn.textContent = '📊 Générer et partager'; }

  // ── Tentative Web Share API avec fichier (fonctionne sur tablette si HTTPS) ──
  if (navigator.share && navigator.canShare) {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          title: `HACCP ${site} — ${mois}`,
          files: [file],
        });
        toast('✅ Fichier partagé', 'success');
        closeExpModal();
        return;
      } catch (e) {
        // AbortError = l'utilisateur a annulé = normal
        // Autres erreurs = on passe au fallback
        if (e.name === 'AbortError') { closeExpModal(); return; }
        console.warn('Share API error, fallback au téléchargement', e);
      }
    }
  }

  // ── Fallback : téléchargement + modale d'instructions ──
  // (mailto ne peut PAS joindre un fichier — limitation OS universelle)
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);

  closeExpModal();

  // Stocker les infos pour la modale post-export
  window._lastExportFilename = filename;
  window._lastExportEmail = email;
  window._lastExportSite = site;
  window._lastExportMois = mois;

  // Afficher la modale d'instructions
  const fnEl = document.getElementById('exp-done-fname');
  if (fnEl) fnEl.textContent = filename;
  document.getElementById('exp-done-ov').classList.add('open');
}

// Ouvrir la messagerie depuis la modale post-export (sans fausse promesse de PJ)
function openMailFromDone() {
  const email = window._lastExportEmail || '';
  const site  = window._lastExportSite  || '';
  const mois  = window._lastExportMois  || '';
  const fname = window._lastExportFilename || '';
  const subject = encodeURIComponent(`HACCP ${site} — Export ${mois}`);
  const body = encodeURIComponent(
    `Bonjour,

Veuillez trouver en pièce jointe l'export Excel PMS HACCP.

` +
    `Fichier : ${fname}
` +
    `(disponible dans vos Téléchargements)

` +
    `Établissement : ${site}
Période : ${mois}

Cordialement`
  );
  window.open(`mailto:${email}?subject=${subject}&body=${body}`, '_blank');
}


// ════════════════════════════════════════════════════
// PAGE CREATOR — Pages personnalisées
// ════════════════════════════════════════════════════

// Palette de blocs disponibles
const BLOCK_PALETTE = [
  {key:'date',      emoji:'📅', label:'Date',           field:{id:'date',      label:'Date',                inputType:'date', autoDate:true}},
  {key:'heure',     emoji:'🕐', label:'Heure',          field:{id:'heure',     label:'Heure',               type:'time', autoTime:true}},
  {key:'produit',   emoji:'🍽️', label:'Produit',        field:{id:'produit',   label:'Produit',             type:'prod', ph:'Ex: Gratin...'}},
  {key:'temp_froid',emoji:'🧊', label:'T°C Froid',      field:{id:'temp',      label:'T°C relevé',          type:'temp', presets:TP_COLD, tMin:-10, tMax:20}},
  {key:'temp_chaud',emoji:'🔥', label:'T°C Chaud',      field:{id:'temp',      label:'T°C fin cuisson',     type:'temp', presets:[60,63,70,80], tMin:40, tMax:100}},
  {key:'conf',      emoji:'✅', label:'OUI / NON',       field:{id:'conf',      label:'Conforme ?',          type:'conf'}},
  {key:'cuisinier', emoji:'👨‍🍳', label:'Cuisinier',      field:{id:'cuisinier', label:'Cuisinier / Visa',    type:'chef'}},
  {key:'texte',     emoji:'📝', label:'Texte libre',    field:{id:'texte',     label:'Observation',         ph:'Saisir...'}},
  {key:'commentaire',emoji:'💬',label:'Commentaire',    field:{id:'commentaire',label:'Commentaire',        type:'textarea', ph:'Commentaire...'}},
  {key:'nombre',    emoji:'🔢', label:'Nombre',          field:{id:'nombre',    label:'Valeur',              inputType:'number', ph:'0'}},
  {key:'select',    emoji:'📋', label:'Liste de choix', field:{id:'select',    label:'Choix',               type:'select', opts:['Option 1','Option 2','Option 3']}},
  {key:'heure2',    emoji:'🕑', label:'Heure fin',      field:{id:'heure_fin', label:'Heure fin',           type:'time'}},
  {key:'photo',     emoji:'📷', label:'Photo',          field:{id:'photo',     label:'Photo',               type:'photo'}},
];

// État courant du créateur
let cpState = {cpId:null, name:'', emoji:'📄', cat:'suivi', regle:'', fields:[]};

// Enregistrer toutes les pages custom dans FDEFS + REND + ALL
function registerCustomPages(){
  const pages = S.customPages || [];
  pages.forEach(cp => {
    const idx = ALL.findIndex(s => s.id === cp.id);
    if(idx > -1) ALL.splice(idx, 1);
    ALL.push({id:cp.id, short: cp.emoji+' '+cp.name, label: cp.emoji+' '+cp.name, cat: cp.cat || 'suivi', custom:true});
    const fdef = {id: cp.id, title: cp.emoji+' '+cp.name, tag:'Custom', tagCat: cp.cat||'suivi', regle: cp.regle||'', fields: cp.fields.map(f=>({...f}))};
    FDEFS[cp.id] = fdef;
    REND[cp.id] = makeFR(fdef);
  });
}

// Rendre la liste des pages custom dans Config
function renderCustomPageConfig(){
  const el = document.getElementById('sp-custpages');
  if(!el) return;
  const pages = S.customPages || [];
  if(!pages.length){
    el.innerHTML = `<div class="cp-empty">Aucune page personnalisée.<br>Créez votre première page !</div>`;
    return;
  }
  el.innerHTML = pages.map(cp => `
    <div class="sp-row" style="cursor:default;flex-wrap:wrap;gap:6px">
      <span style="font-size:1.1rem">${cp.emoji}</span>
      <input id="cp-rename-${cp.id}" value="${escH(cp.name)}"
        style="flex:1;min-width:80px;border:1.5px solid var(--brd);border-radius:8px;padding:5px 8px;font-size:.85rem;font-weight:700;font-family:inherit;color:var(--gris)"
        onblur="cpRename('${cp.id}',this.value)">
      <span style="font-size:.7rem;background:#f3e8f3;color:#7B2D78;padding:2px 8px;border-radius:10px;font-weight:700;align-self:center">${cp.fields.length} champ${cp.fields.length>1?'s':''}</span>
      <button onclick="openPageCreator('${cp.id}')" style="background:#f3e8f3;border:none;border-radius:8px;padding:6px 10px;font-size:.78rem;font-weight:700;color:var(--plum);cursor:pointer;font-family:inherit">✏️</button>
      <button onclick="cpDuplicate('${cp.id}')" style="background:#e8f5e9;border:none;border-radius:8px;padding:6px 10px;font-size:.78rem;font-weight:700;color:#2e7d32;cursor:pointer;font-family:inherit" title="Dupliquer">📋</button>
      <button onclick="cpDeletePage('${cp.id}')" style="background:#fee2e2;border:none;border-radius:8px;padding:6px 10px;font-size:.78rem;font-weight:700;color:#dc2626;cursor:pointer;font-family:inherit">🗑️</button>
    </div>`).join('');
}

function cpRename(cpId, newName){
  newName = newName?.trim();
  if(!newName) return;
  const pages = S.customPages||[];
  const cp = pages.find(p=>p.id===cpId);
  if(!cp || cp.name===newName) return;
  cp.name = newName;
  S.customPages = pages;
  save();
  // Mettre à jour ALL (nav)
  const sec = ALL.find(s=>s.id===cpId);
  if(sec){ sec.short=cp.emoji+' '+newName; sec.label=cp.emoji+' '+newName; }
  // Mettre à jour FDEFS et re-créer le renderer avec le nouveau titre
  if(FDEFS[cpId]){
    FDEFS[cpId].title = cp.emoji+' '+newName;
    REND[cpId] = makeFR(FDEFS[cpId]);
  }
  renderNav();
  if(cur===cpId) renderMain();
  toast('✅ Page renommée');
}

function cpDuplicate(cpId){
  const pages = S.customPages||[];
  const cp = pages.find(p=>p.id===cpId);
  if(!cp) return;
  const newId='cp_'+Date.now();
  const copy={
    id:newId, name:cp.name+' — Copie', emoji:cp.emoji,
    cat:cp.cat||'suivi', regle:cp.regle||'',
    fields:(cp.fields||[]).map(f=>({...f}))
  };
  S.customPages=S.customPages||[];
  S.customPages.push(copy);
  registerCustomPages();
  save(); renderSP();
  setTimeout(()=>{
    const inp=document.getElementById('cp-rename-'+newId);
    if(inp){inp.focus();inp.select();}
  },150);
  toast('📋 "'+copy.name+'" créée','success');
}

// Ouvrir le créateur (cpId=null → création, cpId=id → édition)
function openPageCreator(cpId){
  if(cpId===undefined&&featCheck(LIC_FEAT.CUSTOM,"Pages personnalisées"))return;
  closeSP();
  const modal = document.getElementById('cp-modal');
  if(cpId){
    const cp = (S.customPages||[]).find(p=>p.id===cpId);
    if(!cp) return;
    cpState = {cpId: cp.id, name: cp.name, emoji: cp.emoji, cat: cp.cat||'suivi', regle: cp.regle||'', fields: cp.fields.map(f=>({...f, _uid:f._uid||Math.random().toString(36).slice(2)}))};
    document.getElementById('cp-modal-title').textContent = 'Modifier la page';
  } else {
    cpState = {cpId:null, name:'', emoji:'📄', cat:'suivi', regle:'', fields:[]};
    document.getElementById('cp-modal-title').textContent = 'Créer une page personnalisée';
  }
  // Pré-remplir les champs
  document.getElementById('cp-emoji').value = cpState.emoji;
  document.getElementById('cp-name').value = cpState.name;
  document.getElementById('cp-regle').value = cpState.regle;
  cpRenderPalette();
  cpRenderCats();
  cpRenderFields();
  modal.classList.add('open');
}
function closePageCreator(){document.getElementById('cp-modal').classList.remove('open');}
function cpBg(e){if(e.target===document.getElementById('cp-modal'))closePageCreator();}

function cpSetCat(cat){cpState.cat=cat;cpRenderCats();}
function cpRenderCats(){
  document.querySelectorAll('.cp-cat-btn').forEach(btn=>{
    const c=btn.getAttribute('onclick').replace("cpSetCat('","").replace("')","");
    btn.classList.toggle('active', c===cpState.cat);
  });
}

function cpRenderPalette(){
  document.getElementById('cp-palette').innerHTML = BLOCK_PALETTE.map(b=>`
    <div class="cp-block" onclick="cpAddBlock('${b.key}')" title="Ajouter : ${b.label}">
      <span class="cp-block-ico">${b.emoji}</span>
      <span class="cp-block-lbl">${b.label}</span>
    </div>`).join('');
}

function cpAddBlock(key){
  const tpl = BLOCK_PALETTE.find(b=>b.key===key);
  if(!tpl) return;
  const field = {...tpl.field, _key:key, _uid:Math.random().toString(36).slice(2)};
  cpState.fields.push(field);
  cpRenderFields();
  // Scroll vers le bas pour voir le champ ajouté
  setTimeout(()=>{const fl=document.getElementById('cp-field-list');if(fl)fl.lastElementChild?.scrollIntoView({behavior:'smooth',block:'nearest'});},50);
}

function cpRenderFields(){
  const list = document.getElementById('cp-field-list');
  const count = document.getElementById('cp-field-count');
  const fields = cpState.fields;
  count.textContent = fields.length ? `(${fields.length} champ${fields.length>1?'s':''})` : '';
  if(!fields.length){
    list.innerHTML = `<div class="cp-empty" style="border:2px dashed #e0d0e0;border-radius:12px">Appuyez sur un bloc ci-dessus<br>pour ajouter des champs 👆</div>`;
    return;
  }
  list.innerHTML = fields.map((f,i)=>{
    const tpl = BLOCK_PALETTE.find(b=>b.key===f._key)||{emoji:'🔵'};
    const isSelect = f.type==='select';
    const optsStr = isSelect ? (f.opts||[]).join(', ') : '';
    return `<div class="cp-field-item">
      <span class="cp-field-ico">${tpl.emoji}</span>
      <div style="flex:1;display:flex;flex-direction:column;gap:4px">
        <input class="cp-field-inp" value="${escH(f.label)}" onchange="cpEditLabel(${i},this.value)" placeholder="Nom du champ...">
        ${isSelect?`<input class="cp-field-inp" style="font-size:.72rem;color:#7A6579" value="${escH(optsStr)}" onchange="cpEditOpts(${i},this.value)" placeholder="Options séparées par des virgules...">`:``}
      </div>
      <div class="cp-field-actions">
        ${i>0?`<button class="cp-fa-btn" onclick="cpMoveField(${i},-1)" title="Monter">↑</button>`:`<button class="cp-fa-btn" style="opacity:.3" disabled>↑</button>`}
        ${i<fields.length-1?`<button class="cp-fa-btn" onclick="cpMoveField(${i},1)" title="Descendre">↓</button>`:`<button class="cp-fa-btn" style="opacity:.3" disabled>↓</button>`}
        <button class="cp-fa-btn del" onclick="cpRemoveField(${i})" title="Supprimer">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

function cpEditLabel(i, val){cpState.fields[i].label = val;}
function cpEditOpts(i, val){cpState.fields[i].opts = val.split(',').map(s=>s.trim()).filter(Boolean);}
function cpMoveField(i, dir){
  const f=cpState.fields;
  [f[i],f[i+dir]]=[f[i+dir],f[i]];
  cpRenderFields();
}
function cpRemoveField(i){
  cpState.fields.splice(i,1);
  cpRenderFields();
}

// Génère des IDs uniques par type dans la liste de champs
function cpGenerateFieldIds(fields){
  const counts={};
  return fields.map(f=>{
    const base = f.id||f._key||'field';
    counts[base]=(counts[base]||0);
    const uid = counts[base]===0 ? base : base+'_'+counts[base];
    counts[base]++;
    return {...f, id:uid};
  });
}

function cpSavePage(){
  // Lire les valeurs actuelles des inputs (au cas où l'utilisateur n'a pas quitté le champ)
  cpState.name = document.getElementById('cp-name').value.trim();
  cpState.emoji = document.getElementById('cp-emoji').value.trim()||'📄';
  cpState.regle = document.getElementById('cp-regle').value.trim();

  if(!cpState.name){toast('⚠️ Donnez un nom à la page');return;}
  if(!cpState.fields.length){toast('⚠️ Ajoutez au moins un champ');return;}

  const pages = S.customPages || [];
  const fields = cpGenerateFieldIds(cpState.fields);

  if(cpState.cpId){
    // Édition
    const idx = pages.findIndex(p=>p.id===cpState.cpId);
    if(idx>-1) pages[idx] = {id:cpState.cpId, name:cpState.name, emoji:cpState.emoji, cat:cpState.cat, regle:cpState.regle, fields};
    else pages.push({id:cpState.cpId, name:cpState.name, emoji:cpState.emoji, cat:cpState.cat, regle:cpState.regle, fields});
  } else {
    const newId = 'cp_'+Date.now();
    pages.push({id:newId, name:cpState.name, emoji:cpState.emoji, cat:cpState.cat, regle:cpState.regle, fields});
    cpState.cpId = newId;
  }
  S.customPages = pages;
  save();
  registerCustomPages();
  renderNav();
  closePageCreator();
  toast('✅ Page "'+cpState.name+'" enregistrée !');
}

function cpDeletePage(cpId){
  const page = (S.customPages||[]).find(p=>p.id===cpId);
  if(!page) return;
  const lignes = S[cpId]?.lignes||[];
  const hasData = lignes.length > 0;
  const msg = hasData
    ? `Supprimer "${page.name}" ? Elle contient ${lignes.length} saisie${lignes.length>1?'s':''}. Un export JSON sera proposé.`
    : `Supprimer "${page.name}" ? Aucune donnée à perdre.`;
  showConfirm('Supprimer la page ?', msg, '🗑️ Supprimer', ()=>{
    // Proposer export JSON si données
    if(hasData){
      const blob = new Blob([JSON.stringify({page, lignes}, null, 2)], {type:'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'export_'+page.name.replace(/[^a-z0-9]/gi,'_')+'_'+today()+'.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(url), 2000);
    }
    S.customPages = (S.customPages||[]).filter(p=>p.id!==cpId);
    delete S[cpId];
    const idx = ALL.findIndex(s=>s.id===cpId);
    if(idx>-1) ALL.splice(idx,1);
    delete REND[cpId]; delete FDEFS[cpId];
    if(S.navCfg?.order) S.navCfg.order = S.navCfg.order.filter(id=>id!==cpId);
    if(S.navCfg?.hidden) delete S.navCfg.hidden[cpId];
    save();
    if(cur===cpId) goTo('accueil');
    renderCustomPageConfig();
    renderNav();
    toast(hasData?'🗑️ Page supprimée — données exportées':'🗑️ Page supprimée');
  });
}

// ════════════════════════════════════════════════════

// ════════════════════════════════════════════════════
// PROMPT MODAL (remplace prompt() bloqué sous Android)
// ════════════════════════════════════════════════════
let _promptCb = null;
function showPrompt(title, msg, placeholder, cb, okTxt) {
  _promptCb = cb;
  document.getElementById('prompt-title').textContent = title || 'Saisir';
  const msgEl = document.getElementById('prompt-msg');
  if(msg){ msgEl.textContent=msg; msgEl.style.display=''; }
  else msgEl.style.display='none';
  const inp = document.getElementById('prompt-input');
  inp.value = '';
  inp.placeholder = placeholder || '';
  document.getElementById('prompt-ok-btn').textContent = okTxt || 'OK';
  document.getElementById('prompt-modal').classList.add('open');
  setTimeout(()=>inp.focus(), 100);
}
function promptOk(){
  const val = document.getElementById('prompt-input').value.trim();
  document.getElementById('prompt-modal').classList.remove('open');
  if(_promptCb) _promptCb(val);
  _promptCb = null;
}
function promptCancel(){
  document.getElementById('prompt-modal').classList.remove('open');
  _promptCb = null;
}


// ════════════════════════════════════════════════════
// DATE PICKER CUSTOM — remplace <input type="date">
// ════════════════════════════════════════════════════
const MOIS_FR=['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const JOURS_FR=['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
let _ccpTimerInterval = null;

// ── Persistance des timers ────────────────────────────────────────────
const _CCP_TIMERS_KEY = 'haccp_ccp_timers';
const _ccpTimers = (function(){
  try {
    const raw = localStorage.getItem(_CCP_TIMERS_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // Nettoyer les timers dépassés de plus de 2h (7200s) pour ne pas polluer
      const now = Date.now();
      const cleaned = {};
      Object.keys(saved).forEach(function(k) {
        var t = saved[k];
        if (t && t.startMs && (now - t.startMs) < (t.maxMin + 120) * 60000) {
          cleaned[k] = t;
        }
      });
      return cleaned;
    }
  } catch(e) {}
  return {};
})();

function _ccpTimersSave() {
  try { localStorage.setItem(_CCP_TIMERS_KEY, JSON.stringify(_ccpTimers)); } catch(e) {}
}

function ccpTimerLancer(timerKey, maxMin) {
  _ccpTimers[timerKey] = { startMs: Date.now(), maxMin: maxMin };
  _ccpTimersSave();
  if (!_ccpTimerInterval) {
    _ccpTimerInterval = setInterval(ccpTimerRefreshAll, 10000);
  }
  ccpTimerRefreshAll();
  toast('Minuterie lancée : ' + maxMin + ' min', 'success');
}

function ccpTimerArreter(timerKey) {
  delete _ccpTimers[timerKey];
  _ccpTimersSave();
  if (Object.keys(_ccpTimers).length === 0) ccpTimerStop();
  ccpTimerRefreshAll();
}

function ccpTimerMsg(timerKey, isDepasse, isAlerte, restantMin, dispElapsed) {
  if (timerKey === 'enr01') {
    if (isDepasse) return '&#128680; Ca dure depuis ' + Math.abs(restantMin) + ' min &mdash; ca doit etre froid ! Verifiez la cellule.';
    if (isAlerte && restantMin <= 15) return '&#10052;&#65039; Plus que ' + restantMin + ' min &mdash; pensez a vider la cellule si elle est pleine !';
    if (isAlerte) return '&#10052;&#65039; ' + restantMin + ' min &mdash; le froid doit descendre, il faut aller vite.';
    return '&#9203; ' + dispElapsed + ' &mdash; le produit refroidit, encore ' + restantMin + ' min.';
  }
  if (timerKey === 'enr02') {
    if (isDepasse) return '&#128680; Ca dure depuis ' + Math.abs(restantMin) + ' min &mdash; ca doit etre chaud ! Verifiez la T°C.';
    if (isAlerte && restantMin <= 10) return '&#128293; Plus que ' + restantMin + ' min &mdash; ca doit etre chaud, ne tardons pas !';
    if (isAlerte) return '&#128293; ' + restantMin + ' min &mdash; la temperature monte, il faut aller vite.';
    return '&#9203; ' + dispElapsed + ' &mdash; remontee en T°C en cours, ' + restantMin + ' min devant vous.';
  }
  if (timerKey === 'enr07') {
    if (isDepasse) return '&#128680; Ca dure depuis ' + Math.abs(restantMin) + ' min &mdash; le mixage doit etre termine !';
    if (isAlerte && restantMin <= 3) return '&#128293; Encore ' + restantMin + ' min &mdash; finalisez vite, la limite approche !';
    if (isAlerte) return '&#128293; ' + restantMin + ' min &mdash; ne tardons pas, le mixage a une duree limite.';
    return '&#9203; ' + dispElapsed + ' &mdash; mixage en cours, ' + restantMin + ' min devant vous.';
  }
  if (isDepasse) return '&#128680; Depasse de ' + Math.abs(restantMin) + ' min &mdash; a verifier !';
  if (isAlerte) return '&#128276; ' + restantMin + ' min &mdash; il faut aller vite.';
  return '&#9203; ' + dispElapsed + ' &mdash; ' + restantMin + ' min restantes.';
}

function ccpTimerRenderBlock(timerKey, maxMin, label) {
  var t = _ccpTimers[timerKey];
  if (!t) {
    return '<div style="margin-bottom:12px">'
      + '<button onclick="ccpTimerLancer(\'' + timerKey + '\',' + maxMin + ')" style="display:flex;align-items:center;gap:10px;width:100%;padding:12px 16px;background:#f8f0f8;border:2px dashed var(--plum);border-radius:12px;cursor:pointer;font-family:inherit;font-size:.85rem;font-weight:800;color:var(--plum)">'
      + '&#9203; Lancer la minuterie &mdash; ' + label + ' (' + maxMin + ' min max)'
      + '</button></div>';
  }
  var elapsedMs = Date.now() - t.startMs;
  var elapsedMin = Math.floor(elapsedMs / 60000);
  var elapsedSec = Math.floor((elapsedMs % 60000) / 1000);
  var restantMin = t.maxMin - elapsedMin;
  var pct = Math.min(100, Math.round(elapsedMin / t.maxMin * 100));
  var alerteSeuil = Math.max(3, Math.ceil(t.maxMin * 0.25)); // 25% du temps, min 3 min
  var isAlerte = restantMin <= alerteSeuil && restantMin > 0;
  var isDepasse = restantMin <= 0;
  var bgColor = isDepasse ? '#fee2e2' : isAlerte ? '#fff7ed' : '#f0fdf4';
  var borderColor = isDepasse ? '#fca5a5' : isAlerte ? '#fed7aa' : '#bbf7d0';
  var textColor = isDepasse ? '#991b1b' : isAlerte ? '#c2410c' : '#166534';
  var barColor = isDepasse ? '#dc2626' : isAlerte ? '#f97316' : '#16a34a';
  var dispElapsed = elapsedMin + 'min ' + String(elapsedSec).padStart(2,'0') + 's';
  var statusLabel = ccpTimerMsg(timerKey, isDepasse, isAlerte, restantMin, dispElapsed);
  return '<div style="background:' + bgColor + ';border:2px solid ' + borderColor + ';border-radius:12px;padding:10px 14px;margin-bottom:12px">'
    + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'
    + '<span style="font-size:.85rem;font-weight:900;color:' + textColor + ';flex:1">' + statusLabel + '</span>'
    + '<button onclick="ccpTimerArreter(\'' + timerKey + '\')" style="background:none;border:1.5px solid ' + borderColor + ';border-radius:8px;padding:4px 10px;font-size:.72rem;font-weight:800;cursor:pointer;color:' + textColor + ';font-family:inherit">&#9632; Stop</button>'
    + '</div>'
    + '<div style="background:#e5e7eb;border-radius:10px;height:8px;overflow:hidden">'
    + '<div style="height:100%;width:' + pct + '%;background:' + barColor + ';border-radius:10px;transition:width .3s"></div>'
    + '</div></div>';
}

function ccpTimerRefreshAll() {
  var el01 = document.getElementById('ccp-timer-enr01');
  if (el01) el01.innerHTML = ccpTimerRenderBlock('enr01', 120, 'Refroidissement');
  var el02 = document.getElementById('ccp-timer-enr02');
  if (el02) el02.innerHTML = ccpTimerRenderBlock('enr02', 60, 'Remise T\u00B0C');
  var el07 = document.getElementById('ccp-timer-enr07');
  if (el07) {
    var mode = ((S['enr07']||{}).draft||{}).mode_mixage || 'froid';
    el07.innerHTML = ccpTimerRenderBlock('enr07', 10, 'Mixage ' + (mode==='chaud'?'chaud':'froid'));
  }
  // Mise à jour widget accueil sans re-render complet
  var elHome = document.getElementById('home-timers-widget');
  if (elHome) elHome.innerHTML = _renderTimersHomeInner();
  Object.keys(_ccpTimers).forEach(function(k) {
    var t2 = _ccpTimers[k];
    var elapsed2 = Math.floor((Date.now() - t2.startMs) / 60000);
    var vkey = 'vib_dep_' + k;
    if (elapsed2 >= t2.maxMin && !_alertsFired[vkey]) {
      _alertsFired[vkey] = true;
      appVibrate([1000,300,1000,300,1000]); appBeep();
      toast('⏰ Minuterie ' + k.toUpperCase() + ' dépassée !', 'warning');
    }
  });
}

// ── Widget timers accueil ───────────────────────────────────────────────
const _TIMER_META = {
  enr01: { label:'Refroidissement', emoji:'❄️', maxMin:120, enr:'enr01' },
  enr02: { label:'Remise en T°C',   emoji:'🔥', maxMin:60,  enr:'enr02' },
  enr07: { label:'Mixage',          emoji:'🥣', maxMin:10,  enr:'enr07' },
};
// Résoudre les meta pour les timers enr01_XXX dynamiques
function _timerMeta(k) {
  if (k === 'enr01' || k.startsWith('enr01_')) {
    // Trouver le nom du produit si possible
    const ts = k.slice('enr01_'.length);
    const ligne = (S['enr01']?.lignes||[]).find(r=>r._ts===ts);
    const prod = ligne?.produit ? ' — '+ligne.produit.slice(0,18) : '';
    return { label:'Refroid.'+prod, emoji:'❄️', maxMin:120, enr:'enr01' };
  }
  return _TIMER_META[k] || { label:k, emoji:'⏱️', maxMin:(_ccpTimers[k]?.maxMin||60), enr:'enr01' };
}

function _renderTimersHomeInner() {
  var keys = Object.keys(_ccpTimers);
  if (keys.length === 0) return '';
  var cards = keys.map(function(k) {
    var t = _ccpTimers[k];
    var meta = _timerMeta(k);
    var elapsedMs = Date.now() - t.startMs;
    var elapsedMin = Math.floor(elapsedMs / 60000);
    var elapsedSec = Math.floor((elapsedMs % 60000) / 1000);
    var restantTotal = t.maxMin - elapsedMin;
    var restantSec   = 60 - elapsedSec;
    if (restantSec === 60) { restantSec = 0; }
    var pct = Math.min(100, Math.round(elapsedMin / t.maxMin * 100));
    var isDepasse = restantTotal <= 0;
    var isAlerte  = restantTotal > 0 && restantTotal <= Math.ceil(t.maxMin * 0.25);

    // Couleurs selon état
    var bg, border, txtColor, barColor, badgeBg, badgeTxt;
    if (isDepasse) {
      bg='#fff1f2'; border='#fca5a5'; txtColor='#991b1b'; barColor='#dc2626';
      badgeBg='#dc2626'; badgeTxt='#fff';
    } else if (isAlerte) {
      bg='#fff7ed'; border='#fed7aa'; txtColor='#c2410c'; barColor='#f97316';
      badgeBg='#f97316'; badgeTxt='#fff';
    } else {
      bg='#f0fdf4'; border='#86efac'; txtColor='#166534'; barColor='#16a34a';
      badgeBg='#16a34a'; badgeTxt='#fff';
    }

    // Affichage temps
    var dispElapsed = elapsedMin + 'min ' + String(elapsedSec).padStart(2,'0') + 's';
    var dispRestant = isDepasse
      ? '+' + Math.abs(restantTotal) + 'min'
      : restantTotal + 'min ' + String(restantSec).padStart(2,'0') + 's';
    var statusTxt = isDepasse ? 'Dépassé !' : isAlerte ? 'Bientôt !' : 'En cours';

    return '<div onclick="goTo(\'' + meta.enr + '\')" style="cursor:pointer;background:' + bg + ';border:2px solid ' + border + ';border-radius:16px;padding:12px 14px;flex:1;min-width:130px;max-width:200px;box-shadow:0 2px 8px rgba(0,0,0,.07)">'
      + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">'
      +   '<span style="font-size:1.3rem">' + meta.emoji + '</span>'
      +   '<div style="flex:1">'
      +     '<div style="font-size:.72rem;font-weight:900;text-transform:uppercase;letter-spacing:.5px;color:' + txtColor + '">' + meta.label + '</div>'
      +     '<div style="font-size:.62rem;font-weight:700;color:' + txtColor + ';opacity:.7">' + dispElapsed + ' écoulé</div>'
      +   '</div>'
      +   '<span style="background:' + badgeBg + ';color:' + badgeTxt + ';font-size:.6rem;font-weight:900;padding:2px 7px;border-radius:20px">' + statusTxt + '</span>'
      + '</div>'
      + '<div style="font-size:1.5rem;font-weight:900;color:' + txtColor + ';text-align:center;margin:4px 0 6px;letter-spacing:1px">' + dispRestant + '</div>'
      + '<div style="background:#e5e7eb;border-radius:10px;height:6px;overflow:hidden;margin-bottom:8px">'
      +   '<div style="height:100%;width:' + pct + '%;background:' + barColor + ';border-radius:10px;transition:width .5s"></div>'
      + '</div>'
      + '<button onclick="event.stopPropagation();ccpTimerArreter(\'' + k + '\')" style="width:100%;padding:5px;background:none;border:1.5px solid ' + border + ';border-radius:8px;font-size:.7rem;font-weight:900;color:' + txtColor + ';cursor:pointer;font-family:inherit">■ Arrêter</button>'
      + '</div>';
  }).join('');

  return '<div style="display:flex;flex-wrap:wrap;gap:10px">' + cards + '</div>';
}

function renderTimersWidget() {
  var keys = Object.keys(_ccpTimers);
  if (keys.length === 0) return '';
  return '<div style="margin-bottom:14px">'
    + '<div style="font-size:.65rem;font-weight:900;text-transform:uppercase;letter-spacing:.5px;color:#b89ab6;margin-bottom:8px">⏱️ Minuteries actives</div>'
    + '<div id="home-timers-widget">' + _renderTimersHomeInner() + '</div>'
    + '</div>';
}

function ccpTimerRefresh() { ccpTimerRefreshAll(); }
function ccpTimerStart() { ccpTimerRefreshAll(); }
function ccpTimerStop() {
  if (_ccpTimerInterval) { clearInterval(_ccpTimerInterval); _ccpTimerInterval = null; }
}


// ══════════════════════════════════════════════
// VIBRATION & ALERTES — Rappels deadlines
// ══════════════════════════════════════════════

// ══════════════════════════════════════════════════════
// TABLETTE QUI PARLE — Messages spontanés 4x/jour
// ══════════════════════════════════════════════════════
const _TABLET_MSGS = [
  // Matin (~8h)
  { slot:'matin',  ico:'🌅', msgs:[
    "Bonjour ! Je suis prête pour une nouvelle journée HACCP — et toi ? 😊",
    "Bonne journée ! Pense à mes températures d'ouverture, j'aime être relevée le matin 🌡️",
    "Coucou ! J'ai bien dormi. Et les enceintes, elles aussi ont besoin qu'on s'occupe d'elles 🧊",
    "Debout ! Les relevés de T°C d'ouverture n'attendent pas ☀️",
  ]},
  // Avant-midi (~11h30)
  { slot:'avantmidi', ico:'🍽️', msgs:[
    "Psst… le service de midi arrive ! Les T°C de distribution sont prêtes ? 🌡️",
    "Dans 30 min c'est l'heure ! N'oublie pas les températures du midi 👨‍🍳",
    "Je sens que les plats sont chauds — tu as vérifié les T°C ? 🔥",
    "Rappel sympa : les T°C distribution midi, c'est maintenant ! 📋",
  ]},
  // Après-midi (~15h)
  { slot:'apresmidi', ico:'🧹', msgs:[
    "Petit rappel de ta tablette préférée : et le nettoyage, c'est fait ? 🧹",
    "Je me sens un peu sale moi aussi — c'est peut-être l'heure de désinfecter quelques surfaces 🫧",
    "Tu penses à moi entre les services ? Moi je pense aux plans de nettoyage 😄",
    "Après le rush du midi, on nettoie ! J'ai regardé le plan de nettoyage et il y a des choses à faire 🧽",
    "Psst… la DDPP arrive toujours quand on s'y attend le moins. Le nettoyage est à jour ? 😅",
  ]},
  // Soir (~18h)
  { slot:'soir', ico:'🌙', msgs:[
    "Dernière ligne droite ! Les T°C de fermeture des enceintes sont faites ? 🌡️",
    "Bonsoir ! Pense aux relevés de fermeture — et bonne soirée après ça 🌙",
    "Le service du soir approche. T°C distribution soir : coché ? 🍽️",
    "Avant de finir la journée, check rapide : tout est saisi ? Je garde un œil sur toi 😊",
  ]},
];

const _TABLET_HOURS = { matin:8, avantmidi:11, apresmidi:15, soir:18 };

function checkTabletVoice(){
  const now = new Date();
  const h = now.getHours();
  const todayStr = today();
  // Trouver le slot actif (fenêtre de 60min après l'heure)
  for(const [slot, slotH] of Object.entries(_TABLET_HOURS)){
    const diff = h - slotH;
    if(diff >= 0 && diff < 1){
      const key = 'tablet_voice_' + todayStr + '_' + slot;
      if(_alertsFired[key]) continue;
      // Tirer un message aléatoire
      const grp = _TABLET_MSGS.find(g=>g.slot===slot);
      if(!grp) continue;
      const msg = grp.msgs[Math.floor(Math.random()*grp.msgs.length)];
      _alertsFired[key] = true;
      // Afficher dans 5-30s (aléatoire, pour ne pas être trop mécanique)
      const delay = (5 + Math.floor(Math.random()*25)) * 1000;
      setTimeout(()=>showTabletVoice(grp.ico, msg), delay);
      break;
    }
  }
}

function showTabletVoice(ico, msg){
  // Créer/réutiliser un toast spécial "tablette qui parle"
  let el = document.getElementById('tablet-voice-toast');
  if(!el){
    el = document.createElement('div');
    el.id = 'tablet-voice-toast';
    el.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:9000;max-width:340px;width:calc(100% - 32px);animation:tvIn .4s ease';
    document.body.appendChild(el);
  }
  el.innerHTML = `<div style="background:linear-gradient(135deg,#5C1E5A,#7B2D78);border-radius:16px;padding:14px 16px;box-shadow:0 8px 32px rgba(92,30,90,.4);display:flex;gap:10px;align-items:flex-start">
    <span style="font-size:1.6rem;flex-shrink:0">${ico}</span>
    <div style="flex:1">
      <div style="font-size:.65rem;font-weight:900;text-transform:uppercase;letter-spacing:.8px;color:rgba(255,255,255,.6);margin-bottom:4px">💬 Ta tablette te dit…</div>
      <div style="font-size:.82rem;font-weight:700;color:#fff;line-height:1.4">${msg}</div>
    </div>
    <button onclick="document.getElementById('tablet-voice-toast').remove()" style="background:rgba(255,255,255,.15);border:none;border-radius:20px;color:#fff;font-size:.72rem;font-weight:800;cursor:pointer;padding:4px 9px;font-family:inherit;flex-shrink:0">✕</button>
  </div>`;
  // Auto-fermeture après 12s
  clearTimeout(el._tvTimer);
  el._tvTimer = setTimeout(()=>{ if(el.parentNode) el.style.animation='tvOut .4s ease forwards'; setTimeout(()=>el.remove(),400); }, 12000);
  appVibrate([100,50,100]);
}

const _alertsFired = {}; // évite de vibrer 2x pour la même alerte

function checkVibrationAlerts() {
  const now = new Date();
  const h = now.getHours();
  const hDec = h + now.getMinutes() / 60;
  const todayStr = today();

  // T°C Distribution — 15 min avant chaque service
  getDistribServices().forEach(svc => {
    const svcH = svc.heure ? parseFloat(svc.heure.split(':')[0]) + parseFloat(svc.heure.split(':')[1]||0)/60 : 12;
    const key = 'distrib_' + svc.id + '_' + todayStr;
    const draft = distribDraft();
    const done = (draft.date===todayStr && draft[svc.id+'_valide']==='OUI')
               || (S['enr_tc_distrib']?.lignes||[]).find(r=>r.date===todayStr)?.[svc.id+'_valide']==='OUI';
    if (!done && Math.abs(hDec - svcH) < 0.25 && !_alertsFired[key]) {
      _alertsFired[key] = true;
      appVibrate([300, 100, 300, 100, 300]);
      toast('🔔 T°C Distribution — ' + svc.label + ' dans moins de 15 min !', 'warning');
    }
  });

  // ENR01 refroid. en attente — alerte à 1h30 (30 min avant deadline 2h)
  (S['enr01']?.lignes||[]).filter(r=>!r._statut||r._statut==='en_attente').forEach(r => {
    if (!r.h_ref_deb) return;
    const [rh, rm] = r.h_ref_deb.split(':').map(Number);
    const debMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), rh, rm).getTime();
    const elapsedMin = (now.getTime() - debMs) / 60000;
    const key = 'refr_alerte_' + r._ts;
    if (elapsedMin >= 90 && elapsedMin < 91 && !_alertsFired[key]) {
      _alertsFired[key] = true;
      appVibrate([500, 200, 500]);
      toast('⚠️ Refroidissement "' + (r.produit||'') + '" — 30 min avant deadline !', 'warning');
    }
    const keyDepasse = 'refr_depasse_' + r._ts;
    if (elapsedMin >= 120 && elapsedMin < 121 && !_alertsFired[keyDepasse]) {
      _alertsFired[keyDepasse] = true;
      appVibrate([1000, 300, 1000, 300, 1000]);
      toast('🚨 Refroidissement "' + (r.produit||'') + '" DÉPASSÉ — NC obligatoire !', 'warning');
    }
  });
}

// ══════════════════════════════════════════════
// NOTES ACCUEIL
// ══════════════════════════════════════════════
const NOTE_COLORS = [
  {id:'yellow', bg:'#FFF9C4', text:'#5a4800'},
  {id:'pink',   bg:'#FCE4EC', text:'#7b0033'},
  {id:'green',  bg:'#E8F5E9', text:'#1a4f1c'},
  {id:'blue',   bg:'#E3F2FD', text:'#0a3166'},
  {id:'orange', bg:'#FFF3E0', text:'#a63c00'},
];
let _noteColor = 'yellow';
let _noteFormOpen = false;
let _noteDateSel = today();

function notesGet(){
  const arr = S.notes_home || [];
  const t = today();
  const filtered = arr.filter(n => !n.date || n.date >= t);
  if(filtered.length !== arr.length){ S.notes_home = filtered; save(); }
  return filtered;
}
function notesSave(arr){ S.notes_home = arr; save(); }

function noteAdd(){
  const txt = (document.getElementById('note-inp-text')||{}).value?.trim();
  const sig = (document.getElementById('note-inp-sig')||{}).value?.trim();
  if(!txt){ toast('⚠️ Saisissez le texte de la note','warning'); return; }
  if(!sig){ toast('⚠️ Signez la note','warning'); return; }
  if(!_noteDateSel){ toast('⚠️ Choisissez une date','warning'); return; }
  const arr = notesGet();
  arr.unshift({ id: Date.now(), text: txt, date: _noteDateSel, sig, color: _noteColor });
  notesSave(arr);
  document.getElementById('note-inp-text').value = '';
  document.getElementById('note-inp-sig').value = '';
  _noteDateSel = today();
  // Refermer le formulaire
  _noteFormOpen = false;
  renderMain();
}

function noteDel(id){
  notesSave(notesGet().filter(n=>n.id!==id));
  renderMain();
}

function noteToggleForm(){
  _noteFormOpen = !_noteFormOpen;
  const body = document.getElementById('note-form-body');
  const arrow = document.getElementById('note-toggle-arrow');
  const toggle = document.getElementById('note-toggle-btn');
  if(!body) return;
  body.classList.toggle('open', _noteFormOpen);
  if(arrow) arrow.classList.toggle('open', _noteFormOpen);
  if(toggle) toggle.style.borderRadius = _noteFormOpen ? '12px 12px 0 0' : '12px';
  if(_noteFormOpen) setTimeout(()=>document.getElementById('note-inp-text')?.focus(), 300);
}

function noteOpenDP(){
  openDP(_noteDateSel, (v)=>{
    _noteDateSel = v;
    const el = document.getElementById('note-dp-btn');
    if(el){
      el.querySelector('.dp-val').textContent = new Date(v+'T12:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'});
      el.querySelector('.dp-val').classList.remove('empty');
    }
  }, {});
}

function noteSetColor(id){
  _noteColor = id;
  document.querySelectorAll('.note-cdot').forEach(d => d.classList.toggle('sel', d.dataset.cid===id));
}

function renderNotes(){
  const notes = notesGet();
  const dateDisp = _noteDateSel
    ? new Date(_noteDateSel+'T12:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'})
    : 'Choisir une date';
  const cardsHtml = notes.length === 0
    ? '<div style="font-size:.8rem;color:#c0a0c0;text-align:center;padding:14px 0">Aucune note pour le moment</div>'
    : notes.map(n=>{
        const c = NOTE_COLORS.find(x=>x.id===n.color)||NOTE_COLORS[0];
        const df = n.date ? new Date(n.date+'T12:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'}) : '';
        return `<div class="note-card" style="background:${c.bg};color:${c.text}">
          <button class="note-del" onclick="noteDel(${n.id})">✕</button>
          <div class="note-text">${n.text}</div>
          <div class="note-meta"><span>${df}</span><span style="font-style:italic">${n.sig||''}</span></div>
        </div>`;
      }).join('');

  const colorDots = NOTE_COLORS.map(c=>
    `<div class="note-cdot${_noteColor===c.id?' sel':''}" data-cid="${c.id}" style="background:${c.bg};border-color:${_noteColor===c.id?c.text:'transparent'}" onclick="noteSetColor('${c.id}')"></div>`
  ).join('');

  const formOpen = _noteFormOpen;
  return `
  <div style="margin:0 0 18px">
    <div style="font-size:.65rem;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#b89ab6;margin:0 0 10px 2px">📝 Notes</div>
    <div class="notes-grid">${cardsHtml}</div>
    <button class="note-toggle" id="note-toggle-btn" onclick="noteToggleForm()" style="border-radius:${formOpen?'12px 12px 0 0':'12px'}">
      <span>+ Ajouter une note</span>
      <span class="note-toggle-arrow${formOpen?' open':''}" id="note-toggle-arrow">▼</span>
    </button>
    <div class="note-form-body${formOpen?' open':''}" id="note-form-body">
      <div class="note-form-inner">
        <div class="note-form-row">
          <label>Note</label>
          <textarea id="note-inp-text" placeholder="Anniversaire, repas thème, rappel cuisinier…" maxlength="140" rows="2" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();noteAdd();}"></textarea>
        </div>
        <div class="note-form-row">
          <label>Date</label>
          <button class="dp-trigger" id="note-dp-btn" onclick="noteOpenDP()" style="flex:1">
            <span class="dp-ico">📅</span>
            <span class="dp-val${!_noteDateSel?' empty':''}">${dateDisp}</span>
          </button>
        </div>
        <div class="note-form-row">
          <label>Signé</label>
          <input type="text" id="note-inp-sig" placeholder="Prénom ou initiales" maxlength="30" value="${escH(getActiveSession()||'')}">
        </div>
        <div style="display:flex;align-items:center;margin-top:4px">
          <div class="note-color-row">${colorDots}</div>
          <button class="note-add-btn" onclick="noteAdd()">Ajouter ↵</button>
        </div>
      </div>
    </div>
  </div>`;
}

let _dp={y:0,m:0,sel:null,cb:null,max:null,min:null};

function openDP(currentVal, cb, opts){
  opts=opts||{};
  _dp.max=opts.max||null; _dp.min=opts.min||null; _dp.cb=cb;
  // Clamp : si la valeur stockée dépasse le max ou est avant le min, on part de la borne
  let safeVal = currentVal||null;
  if(safeVal && _dp.max && safeVal>_dp.max) safeVal=_dp.max;
  if(safeVal && _dp.min && safeVal<_dp.min) safeVal=_dp.min;
  _dp.sel = safeVal;
  const d = safeVal ? new Date(safeVal+'T12:00')
              : _dp.max ? new Date(_dp.max+'T12:00') : new Date();
  _dp.y=d.getFullYear(); _dp.m=d.getMonth();
  dpRender();
  const yp=document.getElementById('dp-year-picker');
  if(yp) yp.style.display='none';
  document.getElementById('dp-ov').classList.add('open');
}
function dpCancel(){ document.getElementById('dp-ov').classList.remove('open'); }
function dpConfirm(){
  if(!_dp.sel) return;
  document.getElementById('dp-ov').classList.remove('open');
  if(_dp.cb) _dp.cb(_dp.sel);
}
function dpMove(dir){
  // Calculer la cible avant d'appliquer
  let tm=_dp.m+dir, ty=_dp.y;
  while(tm>11){tm-=12;ty++;}
  while(tm<0){tm+=12;ty--;}
  // Bloquer si dépasse le max
  if(_dp.max){
    const mx=new Date(_dp.max+'T12:00');
    if(ty>mx.getFullYear()||(ty===mx.getFullYear()&&tm>mx.getMonth())) return;
  }
  // Bloquer si avant le min
  if(_dp.min){
    const mn=new Date(_dp.min+'T12:00');
    if(ty<mn.getFullYear()||(ty===mn.getFullYear()&&tm<mn.getMonth())) return;
  }
  _dp.m=tm; _dp.y=ty;
  const picker=document.getElementById('dp-year-picker');
  if(picker) picker.style.display='none';
  dpRender();
}
function dpPickDay(ymd){
  _dp.sel=ymd;
  dpRender();
}
function dpYearInput(){
  // Afficher un sélecteur d'année rapide
  const curY = _dp.y;
  const now = new Date().getFullYear();
  // Générer les années -5 à +10 depuis aujourd'hui
  let html = '<div style="display:flex;flex-wrap:wrap;gap:6px;padding:10px 14px;justify-content:center">';
  for(let y = now-3; y <= now+8; y++){
    const active = y===curY;
    html += '<button onclick="dpSetYear('+y+')" style="padding:7px 12px;border-radius:10px;border:1.5px solid '+(active?'var(--plum)':'var(--brd)')
      +';background:'+(active?'var(--plum)':'var(--fond)')+';color:'+(active?'#fff':'var(--gris)')
      +';font-size:.88rem;font-weight:'+(active?'900':'700')+';cursor:pointer;font-family:inherit">'+y+'</button>';
  }
  html += '</div>';
  // Injecter dans une zone au-dessus des jours
  let picker = document.getElementById('dp-year-picker');
  if(!picker){
    picker = document.createElement('div');
    picker.id = 'dp-year-picker';
    picker.style.cssText = 'border-top:1px solid #f0e4f0;border-bottom:1px solid #f0e4f0;background:#faf5fa;';
    const days = document.getElementById('dp-days');
    days.parentNode.insertBefore(picker, days);
  }
  if(picker.style.display==='none'||picker.innerHTML===''){
    picker.innerHTML = html;
    picker.style.display = '';
  } else {
    picker.style.display = 'none';
  }
}

function dpSetYear(y){
  if(_dp.max && y>parseInt(_dp.max.slice(0,4))) return;
  if(_dp.min && y<parseInt(_dp.min.slice(0,4))) return;
  _dp.y = y;
  const picker = document.getElementById('dp-year-picker');
  if(picker) picker.style.display = 'none';
  dpRender();
}
function dpRender(){
  const todayStr=today();
  // Header
  const hday=document.getElementById('dp-hday');
  const hdate=document.getElementById('dp-hdate');
  if(_dp.sel){
    const sd=new Date(_dp.sel+'T12:00');
    hday.textContent=JOURS_FR[sd.getDay()];
    hdate.textContent=sd.getDate()+' '+MOIS_FR[sd.getMonth()].slice(0,3)+'. '+sd.getFullYear();
  } else {
    hday.textContent='Sélectionnez une date';
    hdate.textContent='—';
  }
  document.getElementById('dp-month-lbl').textContent=MOIS_FR[_dp.m]+' '+_dp.y;
  // Griser les flèches de navigation si on est aux limites
  const _nxt=document.querySelector('#dp-ov .dp-nav-btn[onclick*="dpMove(1"]');
  const _nxtY=document.querySelector('#dp-ov .dp-nav-btn[onclick*="dpMove(12"]');
  const _prv=document.querySelector('#dp-ov .dp-nav-btn[onclick*="dpMove(-1"]');
  const _prvY=document.querySelector('#dp-ov .dp-nav-btn[onclick*="dpMove(-12"]');
  const _atMax=_dp.max&&(()=>{const mx=new Date(_dp.max+'T12:00');return _dp.y>mx.getFullYear()||(_dp.y===mx.getFullYear()&&_dp.m>=mx.getMonth());})();
  const _atMin=_dp.min&&(()=>{const mn=new Date(_dp.min+'T12:00');return _dp.y<mn.getFullYear()||(_dp.y===mn.getFullYear()&&_dp.m<=mn.getMonth());})();
  if(_nxt) _nxt.style.opacity=_atMax?'0.2':'';
  if(_nxtY) _nxtY.style.opacity=_atMax?'0.2':'';
  if(_prv) _prv.style.opacity=_atMin?'0.2':'';
  if(_prvY) _prvY.style.opacity=_atMin?'0.2':'';
  // Grille jours
  const firstDow=(new Date(_dp.y,_dp.m,1).getDay()+6)%7; // Lun=0
  const daysInMonth=new Date(_dp.y,_dp.m+1,0).getDate();
  const daysInPrev=new Date(_dp.y,_dp.m,0).getDate();
  let html='';
  // Jours du mois précédent
  for(let i=0;i<firstDow;i++){
    const d=daysInPrev-firstDow+1+i;
    html+=`<button class="dp-day other-month" onclick="dpPickDay('${_dp.y}-${String(_dp.m===0?12:_dp.m).padStart(2,'0')}-${String(d).padStart(2,'0')}')">${d}</button>`;
  }
  // Jours du mois
  for(let d=1;d<=daysInMonth;d++){
    const ymd=`${_dp.y}-${String(_dp.m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday=ymd===todayStr;
    const isSel=ymd===_dp.sel;
    const isDisabled=(_dp.max&&ymd>_dp.max)||(_dp.min&&ymd<_dp.min);
    let cls='dp-day';
    if(isToday) cls+=' today';
    if(isSel) cls+=' selected';
    if(isDisabled) cls+=' other-month';
    html+='<button class="'+cls+'" '+(isDisabled?'disabled':'onclick="dpPickDay(\''+ymd+'\')"')+'>'+d+'</button>';
  }
  // Compléter la grille
  const total=firstDow+daysInMonth;
  const remaining=(7-total%7)%7;
  for(let d=1;d<=remaining;d++){
    html+=`<button class="dp-day other-month">${d}</button>`;
  }
  document.getElementById('dp-days').innerHTML=html;
}

// ── dpOpenForField : ouvre le picker depuis un bouton avec data-attributes ──
function dpOpenForField(btn, opts){
  const fid = btn.dataset.fid;
  const sec = btn.dataset.sec;
  const btnId = btn.id;
  // Lire la valeur actuelle
  let curVal = '';
  if(sec && fid) curVal = (sec==='enr30' ? ((S['enr30']||{}).draft||{})[fid] : gd(fid,sec)) || '';
  openDP(curVal, (v)=>{
    // Sauvegarder
    if(sec && fid){
      if(sec==='enr30'){ nc30(fid,v); }
      else { sd(fid,v,sec); doAutoCalc(sec); }
    }
    // Mettre à jour le bouton
    const el=document.getElementById(btnId);
    if(el){
      const span=el.querySelector('.dp-val');
      if(span){
        span.textContent=new Date(v+'T12:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
        span.classList.remove('empty');
      }
    }
  }, opts||{});
}

// ── Générer un champ date custom (remplace <input type="date">) ──
function dpField(id, sec, label, val, opts){
  opts=opts||{};
  const df=val?new Date(val+'T12:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short',year:'numeric'}):'';
  const cbStr=sec
    ? `(v)=>{sd('${id}',v,'${sec}');doAutoCalc('${sec}');const el=document.getElementById('dpf-${id}-${sec}');if(el){el.querySelector('.dp-val').textContent=new Date(v+'T12:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short',year:'numeric'});el.querySelector('.dp-val').classList.remove('empty');}}`
    : `(v)=>{const el=document.getElementById('dpf-${id}-${sec||'x'}');if(el){el.querySelector('.dp-val').textContent=new Date(v+'T12:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short',year:'numeric'});el.querySelector('.dp-val').classList.remove('empty');}}`;
  const maxStr=opts.max?`',max:'${opts.max}'`:'';
  return `<div class="fg ${opts.full?'full':''}">
    ${label?`<label>${label}</label>`:''}
    <button class="dp-trigger" id="dpf-${id}-${sec||'x'}"
      onclick="openDP('${val||''}',${cbStr},{max:'${opts.max||''}',min:'${opts.min||''}'})">
      <span class="dp-ico">📅</span>
      <span class="dp-val${!val?' empty':''}">${df||'Sélectionner une date'}</span>
      <span style="font-size:.7rem;color:#c0a0c0">▼</span>
    </button>
  </div>`;
}

// CONFIRM MODAL (remplace confirm() bloqué sous Android)
// ════════════════════════════════════════════════════
let _confirmCb = null;
function showConfirm(title, msg, yesTxt, cb) {
  _confirmCb = cb;
  document.getElementById('confirm-title').textContent = title || 'Confirmer ?';
  document.getElementById('confirm-msg').textContent = msg || '';
  document.getElementById('confirm-yes-btn').textContent = yesTxt || 'Confirmer';
  document.getElementById('confirm-modal').classList.add('open');
}
function confirmYes(){ document.getElementById('confirm-modal').classList.remove('open'); if(_confirmCb)_confirmCb(); _confirmCb=null; }
function confirmNo(){ document.getElementById('confirm-modal').classList.remove('open'); _confirmCb=null; }

// ════════════════════════════════════════════════════
// PIN MODAL — réutilisable (admin + chefs)
// ════════════════════════════════════════════════════
// _pinCtx : { mode: 'check'|'set1'|'set2'|'recovery', target: 'admin'|'chef:NOM', onSuccess: fn, first: '' }
let _pinCtx = {};
let _pinBuf = '';

function openPinModal(ctx){
  _pinCtx = {...ctx, first:''};
  _pinBuf = '';
  _updatePinDisplay();
  _setPinLabels();
  document.getElementById('pin-recovery-area').innerHTML = '';
  document.getElementById('pin-modal').classList.add('open');
}
function closePinModal(){ document.getElementById('pin-modal').classList.remove('open'); _pinBuf=''; }

function _setPinLabels(){
  const m = _pinCtx.mode;
  const isChef = _pinCtx.target?.startsWith('chef:');
  const name = isChef ? _pinCtx.target.slice(5) : 'admin';
  const titles = {
    check: isChef ? 'Session cuisinier' : 'Code administrateur',
    set1:  isChef ? 'Créer votre code PIN' : 'Définir le code admin',
    set2:  'Confirmez le code',
    recovery: isChef ? 'Code oublié ?' : 'Récupération admin'
  };
  const subs = {
    check: isChef ? 'Code PIN de '+name : 'Entrez le code admin (4 chiffres)',
    set1:  'Choisissez un code à 4 chiffres',
    set2:  'Retapez le même code',
    recovery: ''
  };
  document.getElementById('pin-title').textContent = titles[m]||'Code';
  document.getElementById('pin-sub').textContent = subs[m]||'';

  // Lien récupération (mode check uniquement si question définie)
  const ra = document.getElementById('pin-recovery-area');
  if(m === 'check'){
    let q = '';
    if(_pinCtx.target==='admin') q = S.adminQ||'';
    else if(isChef){ const cp=S.chefPins?.[name]; q=cp?.question||''; }
    ra.innerHTML = q
      ? `<a class="pin-recovery-link" onclick="pinShowRecovery()">🔑 Code oublié ?</a><br>`
      : '';
  } else { ra.innerHTML = ''; }
}

function pinPress(d){
  if(_pinCtx.mode==='recovery') return;
  if(_pinBuf.length >= 4) return;
  _pinBuf += d;
  _updatePinDisplay();
  if(_pinBuf.length === 4) setTimeout(_pinValidate, 160);
}
function pinDelete(){ if(_pinCtx.mode==='recovery') return; _pinBuf=_pinBuf.slice(0,-1); _updatePinDisplay(); }

function _updatePinDisplay(){
  [0,1,2,3].forEach(i=>{
    const d=document.getElementById('pd'+i);
    if(!d) return;
    d.classList.toggle('filled', i < _pinBuf.length);
    d.classList.remove('error');
  });
}

function _pinError(msg){
  [0,1,2,3].forEach(i=>document.getElementById('pd'+i)?.classList.add('error'));
  if(msg) { const s=document.getElementById('pin-sub'); const old=s.textContent; s.style.color='#dc2626'; s.textContent=msg; setTimeout(()=>{s.style.color='';s.textContent=old;},1400); }
  setTimeout(()=>{ _pinBuf=''; _updatePinDisplay(); }, 600);
}

function _pinValidate(){
  const m = _pinCtx.mode;
  const isChef = _pinCtx.target?.startsWith('chef:');
  const name = isChef ? _pinCtx.target.slice(5) : '';

  if(m==='check'){
    const correct = _pinCtx.target==='admin' ? S.adminPin : (S.chefPins?.[name]?.pin||'');
    if(_pinBuf === correct){ closePinModal(); _pinCtx.onSuccess?.(); }
    else _pinError('Code incorrect');
  } else if(m==='set1'){
    _pinCtx.first = _pinBuf; _pinBuf='';
    _pinCtx.mode = 'set2'; _setPinLabels(); _updatePinDisplay();
  } else if(m==='set2'){
    if(_pinBuf !== _pinCtx.first){ _pinError('Les codes ne correspondent pas'); _pinCtx.first=''; _pinCtx.mode='set1'; _setPinLabels(); return; }
    const pin = _pinBuf;
    closePinModal();
    if(_pinCtx.target==='admin'){ S.adminPin=pin; save(); toast('🔒 Code admin défini'); renderSecuritySection(); }
    else if(isChef){ S.chefPins=S.chefPins||{}; S.chefPins[name]=S.chefPins[name]||{}; S.chefPins[name].pin=pin; save(); if(typeof _saveConfigToSupabase==='function')_saveConfigToSupabase(); toast('🔑 Code défini pour '+name); renderChefList(); }
    _pinCtx.onSuccess?.();
  }
}

function pinShowRecovery(){
  _pinCtx.mode = 'recovery';
  _setPinLabels();
  const isChef = _pinCtx.target?.startsWith('chef:');
  const name = isChef ? _pinCtx.target.slice(5) : '';
  let q = _pinCtx.target==='admin' ? (S.adminQ||'') : (S.chefPins?.[name]?.question||'');
  document.getElementById('pin-recovery-area').innerHTML = `
    <div class="pin-recovery-form">
      <div class="pin-recovery-q">❓ ${escH(q)}</div>
      <input class="pin-recovery-inp" id="pin-rec-inp" type="text" placeholder="Votre réponse..." autocomplete="off">
      <button onclick="pinCheckRecovery()" style="width:100%;padding:10px;border-radius:10px;border:none;background:var(--plum);color:#fff;font-weight:800;font-family:inherit;font-size:.9rem;cursor:pointer">Valider la réponse</button>
    </div>`;
}

function pinCheckRecovery(){
  const isChef = _pinCtx.target?.startsWith('chef:');
  const name = isChef ? _pinCtx.target.slice(5) : '';
  const correct = (_pinCtx.target==='admin' ? (S.adminA||'') : (S.chefPins?.[name]?.answer||'')).trim().toLowerCase();
  const ans = (document.getElementById('pin-rec-inp')?.value||'').trim().toLowerCase();
  if(!ans){ toast('⚠️ Entrez votre réponse'); return; }
  if(ans !== correct){ toast('❌ Réponse incorrecte'); return; }
  // Réponse correcte → connexion + option de réinitialiser le PIN
  closePinModal();
  if(_pinCtx.target==='admin'){
    toast('✅ Réponse correcte — accès autorisé');
    renderSP(); document.getElementById('sp').classList.add('open');
  } else if(isChef){
    setActiveSession(name);
    toast('✅ Accès autorisé — Bonjour '+name+' !');
  }
}

// ════════════════════════════════════════════════════
// ADMIN PIN — gestion dans Config
// ════════════════════════════════════════════════════
function renderSecuritySection(){
  const el=document.getElementById('sp-security');
  if(!el) return;
  const hasPin = !!S.adminPin;
  el.innerHTML = `
    <div class="sec-admin-status">
      <span class="sec-admin-dot ${hasPin?'on':'off'}"></span>
      <div style="flex:1">
        <div style="font-size:.83rem;font-weight:800;color:var(--gris)">${hasPin?'Code admin actif':'Aucun code admin défini'}</div>
        <div style="font-size:.7rem;color:#b89ab6">${hasPin?'La config est protégée par un code PIN':'Accès libre à la configuration'}</div>
      </div>
    </div>
    ${hasPin?`
    <div style="display:flex;gap:8px;margin-bottom:6px">
      <button class="btn btn-sec" style="flex:1;font-size:.8rem;padding:9px" onclick="spChangeAdminPin()">🔄 Changer le code</button>
      <button class="btn btn-sec" style="flex:1;font-size:.8rem;padding:9px;color:#dc2626;background:#fff5f5;border:1px solid #fca5a5" onclick="spRemoveAdminPin()">🗑️ Supprimer le code</button>
    </div>`:
    `<button class="btn btn-sec" style="width:100%;padding:9px;font-size:.8rem;margin-bottom:6px" onclick="spSetAdminPin()">🔒 Définir un code admin</button>`}
    ${renderAdminQForm()}`;
}

function renderAdminQForm(){
  const q = S.adminQ||''; const a = S.adminA||'';
  return `<div style="font-size:.66rem;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#b89ab6;margin:10px 0 6px">Question de secours (si code oublié)</div>
    <input class="cp-inp" type="text" placeholder="Ex: Nom de ma première cuisine ?" value="${escH(q)}" oninput="S.adminQ=this.value;save()" style="margin-bottom:6px">
    <input class="cp-inp" type="text" placeholder="Réponse secrète..." value="${escH(a)}" oninput="S.adminA=this.value.trim().toLowerCase();save()">
    <div style="font-size:.68rem;color:#b89ab6;margin-top:4px">Mémorisez bien votre réponse — elle sert à récupérer l'accès.</div>`;
}

function spSetAdminPin(){
  openPinModal({mode:'set1', target:'admin', onSuccess:()=>{ renderSecuritySection(); }});
}
function spChangeAdminPin(){
  // Vérifier l'ancien code d'abord
  openPinModal({mode:'check', target:'admin', onSuccess:()=>{
    setTimeout(()=>openPinModal({mode:'set1', target:'admin', onSuccess:()=>renderSecuritySection()}),200);
  }});
}
function spRemoveAdminPin(){
  showConfirm('Supprimer le code admin ?', 'La configuration sera accessible sans code.', 'Oui, supprimer', ()=>{
    delete S.adminPin; save(); renderSecuritySection(); toast('🔓 Code admin supprimé');
  });
}

// Surcharge openSP pour protéger par PIN
const _origOpenSP = typeof openSP === 'function' ? openSP : null;

// ════════════════════════════════════════════════════
// SESSION CUISINIER
// ════════════════════════════════════════════════════
const SESS_COLORS = ['#5C1E5A','#1565c0','#1b5e20','#e65100','#6a1b9a','#b71c1c','#004d40','#37474f'];
function sessColor(name){ let h=0; for(let c of name) h=(h+c.charCodeAt(0))%SESS_COLORS.length; return SESS_COLORS[h]; }
function sessInitials(name){ return name.split(' ').map(p=>p[0]||'').slice(0,2).join('').toUpperCase()||'?'; }

function getActiveSession(){ return S.activeSession||null; }

// Validation valeurs aberrantes
function validateTemperature(val, context) {
  const n = parseFloat(val);
  if (isNaN(n)) return true; // pas une temp, on laisse passer
  if (context === 'froid' && (n < -30 || n > 15)) {
    showConfirm(`Température suspecte : ${n}°C`, 'Cette valeur semble aberrante pour un stockage froid. Confirmez-vous ?', '✅ Confirmer', () => {});
    return false;
  }
  if (context === 'cuisson' && (n < 0 || n > 150)) {
    showConfirm(`Température suspecte : ${n}°C`, 'Cette valeur semble aberrante pour une cuisson. Confirmez-vous ?', '✅ Confirmer', () => {});
    return false;
  }
  return true;
}
function setActiveSession(name){
  S.activeSession = name;
  save();
  updateSessHeader();
  applyNavLayout();
  closeSessModal();
  toast('👋 Bonjour '+name+' !');
}
function clearSession(){
  delete S.activeSession;
  save();
  // Effacer toute la config Supabase (token + siteId + email)
  try {
    localStorage.removeItem('haccp_supa_cfg_v1');
    localStorage.removeItem('haccp_last_site_id');
    localStorage.removeItem('haccp_last_user_email');
    localStorage.removeItem('haccp_data_purge_ver');
    if(window._supaClient) window._supaClient.auth.signOut().catch(()=>{});
  } catch(e){}
  // Retour page login
  window.location.href = 'index.html';
}

function updateSessHeader(){
  const btn = document.getElementById('sess-hdr-btn');
  if(!btn) return;
  const active = getActiveSession();
  if(active){
    const col = sessColor(active);
    const ini = sessInitials(active);
    btn.innerHTML = `<span class="sess-av-mini" style="background:${col}">${ini}</span> <span style="max-width:70px;overflow:hidden;text-overflow:ellipsis;font-size:.72rem">${active.split(' ')[0]}</span>`;
    btn.style.background = col+'cc';
    btn.style.borderColor = col;
  } else {
    btn.innerHTML = '👤';
    btn.style.background = 'rgba(255,255,255,.16)';
    btn.style.borderColor = 'rgba(255,255,255,.25)';
  }
}

function openSessModal(){
  renderSessBody();
  document.getElementById('sess-modal').classList.add('open');
}
function closeSessModal(){ document.getElementById('sess-modal').classList.remove('open'); }
function sessBg(e){ if(e.target===document.getElementById('sess-modal')) closeSessModal(); }

function renderSessBody(){
  const chefs = getChefs();
  const active = getActiveSession();
  const el = document.getElementById('sess-body');
  if(!chefs.length){
    const cfg = SupaEngine.cfg();
    const emailDisplay = cfg.userEmail || active || '—';
    el.innerHTML = `
      <button class="sess-logout" onclick="clearSession()" style="margin-bottom:10px">🚪 Se déconnecter de l'application</button>
      <div class="cp-empty" style="padding:10px 0">Connecté en tant que : <strong>${emailDisplay}</strong></div>`;
    return;
  }
  // Trier : qui travaille aujourd'hui en premier
  const chefsTriés = [...chefs].sort((a,b)=>{
    const wa = chefWorksToday(a); const wb = chefWorksToday(b);
    if(wa && !wb) return -1; if(!wa && wb) return 1; return 0;
  });
  const cards = chefsTriés.map(name=>{
    const col = sessColor(name);
    const ini = sessInitials(name);
    const hasPin = !!(S.chefPins?.[name]?.pin);
    const isActive = active === name;
    const works = chefWorksToday(name);
    const workLabel = works===false
      ? '<span style="font-size:.58rem;background:#fee2e2;color:#991b1b;padding:2px 6px;border-radius:8px;font-weight:800;display:block;margin-top:2px">Repos aujourd\'hui</span>'
      : works
        ? `<span style="font-size:.58rem;background:#dcfce7;color:#166534;padding:2px 6px;border-radius:8px;font-weight:800;display:block;margin-top:2px">${works==='full'?'En service':'Service '+works}</span>`
        : '';
    const opacity = works===false ? 'opacity:.45;' : '';
    return `<div class="sess-card${isActive?' active-sess':''}" style="${opacity}" onclick="sessSelectChef('${escH(name).replace(/'/g,"\\'")}')">
      <div class="sess-avatar" style="background:${col}">${ini}</div>
      <div class="sess-name">${escH(name)}</div>
      ${workLabel}
      <span class="sess-pin-badge ${hasPin?'has-pin':'no-pin'}">${hasPin?'🔑 Code PIN':'Sans code'}</span>
      ${isActive?'<span style="font-size:.65rem;color:var(--plum);font-weight:800">✓ Actif</span>':''}
    </div>`;
  }).join('');
  el.innerHTML = `<div class="sess-grid">${cards}</div>
    <button class="sess-logout" onclick="clearSession()" style="margin-top:10px">🚪 Se déconnecter de l'application</button>`;
}

function sessSelectChef(name){
  const outgoing=getActiveSession();
  const doSwitch=()=>{
    const cp=S.chefPins?.[name];
    if(cp?.pin){closeSessModal();openPinModal({mode:'check',target:'chef:'+name,onSuccess:()=>setActiveSession(name)});}
    else setActiveSession(name);
  };
  if(outgoing&&outgoing!==name){closeSessModal();checkEndOfService(outgoing,doSwitch);}
  else doSwitch();
}

// ════════════════════════════════════════════════════
// CHEF PIN MANAGEMENT (dans Config)
// ════════════════════════════════════════════════════
let _chefPinExpanded = null; // nom du chef dont le panneau PIN est ouvert

// ── Helpers semaines A/B ───────────────────────────────────────────
// Calcule la semaine courante (A ou B) à partir du n° de semaine ISO.
// Par défaut : semaine ISO paire = A, impaire = B.
// L'utilisateur peut inverser via un offset stocké dans S.config.weekAB_offset.
function getIsoWeekNumber(d){
  d = d || new Date();
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}
function getCurrentWeekAB(){
  const weekNum = getIsoWeekNumber();
  const offset = (S.config?.weekAB_offset) || 0; // 0 = pair=A, 1 = pair=B
  return ((weekNum + offset) % 2 === 0) ? 'A' : 'B';
}
function toggleWeekABOffset(){
  S.config = S.config || {};
  S.config.weekAB_offset = ((S.config.weekAB_offset||0) + 1) % 2;
  save();
  if(typeof _saveConfigToSupabase==='function') _saveConfigToSupabase();
  renderChefList();
  toast('📅 Semaine courante : '+getCurrentWeekAB());
}

// ── Accès planning avec compat ascendante ──────────────────────────
// Ancien format : S.chefSchedule[name] = {lun:'full', mar:'repos', ...}
// Nouveau A/B  : S.chefSchedule[name] = {mode:'ab', A:{...}, B:{...}}
// ou legacy    : S.chefSchedule[name] = {mode:'simple', plan:{...}}
// La lecture auto-détecte.
function chefSchedGet(name, weekAB){
  const raw = S.chefSchedule?.[name];
  if(!raw) return {};
  // Nouveau format A/B
  if(raw.mode === 'ab') return raw[weekAB] || {};
  // Nouveau format simple explicite
  if(raw.mode === 'simple') return raw.plan || {};
  // Ancien format (jours directement à la racine)
  return raw;
}
function chefSchedIsAB(name){
  return S.chefSchedule?.[name]?.mode === 'ab';
}
function chefSchedToggleMode(name){
  S.chefSchedule = S.chefSchedule || {};
  const current = S.chefSchedule[name];
  if(chefSchedIsAB(name)){
    // A/B → simple : on garde la semaine A comme plan unique
    const planA = current?.A || {};
    S.chefSchedule[name] = { mode:'simple', plan: planA };
  } else {
    // simple/legacy → A/B : copie le plan actuel dans A, B vide
    let planSource = {};
    if(current?.mode === 'simple') planSource = current.plan || {};
    else if(current) planSource = {...current}; // legacy
    S.chefSchedule[name] = { mode:'ab', A: planSource, B: {} };
  }
  save();
  if(typeof _saveConfigToSupabase==='function') _saveConfigToSupabase();
  renderChefList();
}

function renderChefList(){
  const chefs = getChefs();
  const el = document.getElementById('chef-list');
  if(!el) return;
  if(!chefs.length){ el.innerHTML='<div style="color:#b89ab6;font-size:.82rem;padding:5px 4px">Aucun cuisinier enregistré.</div>'; return; }
  const JOURS=[['lun','Lun'],['mar','Mar'],['mer','Mer'],['jeu','Jeu'],['ven','Ven'],['sam','Sam'],['dim','Dim']];
  const SERVICES=[['full','Jour'],['midi','Midi'],['soir','Soir'],['repos','Repos']];
  const currentWeek = getCurrentWeekAB();
  el.innerHTML = chefs.map((c,i)=>{
    const hasPin = !!(S.chefPins?.[c]?.pin);
    const expanded = _chefPinExpanded === c;
    const planningExpanded = _chefPlanExpanded === c;
    const q = S.chefPins?.[c]?.question||'';
    const a = S.chefPins?.[c]?.answer||'';
    const isAB = chefSchedIsAB(c);
    // Pour le badge du jour : utiliser la semaine courante
    const sched = chefSchedGet(c, currentWeek);
    const todayKey = ['dim','lun','mar','mer','jeu','ven','sam'][new Date().getDay()];
    const todaySvc = sched[todayKey]||null;
    const worksBadge = todaySvc && todaySvc!=='repos'
      ? `<span style="background:#dcfce7;color:#166534;font-size:.58rem;font-weight:800;padding:2px 6px;border-radius:8px">${todaySvc==='full'?'Aujourd\'hui':'Auj. '+todaySvc}${isAB?' ('+currentWeek+')':''}</span>`
      : todaySvc==='repos'
        ? `<span style="background:#f3f4f6;color:#6b7280;font-size:.58rem;font-weight:800;padding:2px 6px;border-radius:8px">Repos${isAB?' ('+currentWeek+')':''}</span>`
        : '';
    // Panel planning : onglets A/B si mode AB, sinon un seul tableau
    let planningHtml = '';
    if(planningExpanded){
      const escName = c.replace(/'/g,"\\'");
      const modeToggleHtml = `<div style="display:flex;gap:6px;margin-bottom:10px;align-items:center;flex-wrap:wrap">
        <button class="btn btn-sec" style="font-size:.72rem;padding:6px 10px;${isAB?'background:#ede9fe;color:#5b21b6;border:1.5px solid #c4b5fd':''}" onclick="chefSchedToggleMode('${escName}')">
          ${isAB?'🔄 Alternance A/B activée':'➕ Activer alternance A/B'}
        </button>
        ${isAB?`<span style="font-size:.68rem;color:#7B2D78;font-weight:700">Semaine courante : <b>${currentWeek}</b></span>
          <button class="btn btn-sec" style="font-size:.65rem;padding:4px 8px" onclick="toggleWeekABOffset()">🔁 Inverser</button>`:''}
      </div>`;
      if(isAB){
        // Deux onglets A et B
        const _plab = _chefPlanTab[c] || 'A';
        const tabsHtml = `<div style="display:flex;gap:4px;margin-bottom:8px">
          <button class="btn btn-sec" style="flex:1;font-size:.75rem;padding:7px;${_plab==='A'?'background:var(--plum);color:#fff':''}" onclick="setChefPlanTab('${escName}','A')">Semaine A ${currentWeek==='A'?'• en cours':''}</button>
          <button class="btn btn-sec" style="flex:1;font-size:.75rem;padding:7px;${_plab==='B'?'background:var(--plum);color:#fff':''}" onclick="setChefPlanTab('${escName}','B')">Semaine B ${currentWeek==='B'?'• en cours':''}</button>
        </div>`;
        const schedTab = chefSchedGet(c, _plab);
        const rowsHtml = JOURS.map(([jKey,jLbl])=>{
          const cur = schedTab[jKey]||'repos';
          return `<div class="chef-plan-row">
            <span class="chef-plan-day">${jLbl}</span>
            <div class="chef-plan-btns">
              ${SERVICES.map(([sKey,sLbl])=>`<button class="chef-plan-btn${cur===sKey?' on-'+sKey:''}" onclick="setChefPlan('${escName}','${jKey}','${sKey}','${_plab}')">${sLbl}</button>`).join('')}
            </div>
          </div>`;
        }).join('');
        planningHtml = `<div class="chef-planning">
          <div class="chef-planning-title">📅 Planning ${escH(c)}</div>
          ${modeToggleHtml}${tabsHtml}${rowsHtml}
        </div>`;
      } else {
        // Simple : un seul tableau (comportement actuel)
        const rowsHtml = JOURS.map(([jKey,jLbl])=>{
          const cur = sched[jKey]||'repos';
          return `<div class="chef-plan-row">
            <span class="chef-plan-day">${jLbl}</span>
            <div class="chef-plan-btns">
              ${SERVICES.map(([sKey,sLbl])=>`<button class="chef-plan-btn${cur===sKey?' on-'+sKey:''}" onclick="setChefPlan('${escName}','${jKey}','${sKey}')">${sLbl}</button>`).join('')}
            </div>
          </div>`;
        }).join('');
        planningHtml = `<div class="chef-planning">
          <div class="chef-planning-title">📅 Planning de la semaine</div>
          ${modeToggleHtml}${rowsHtml}
        </div>`;
      }
    }
    const pinHtml = expanded ? `<div class="chef-pin-panel">
      <div style="font-size:.78rem;font-weight:800;color:var(--plum);margin-bottom:10px">⚙️ Code PIN de ${escH(c)}</div>
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <button class="btn btn-sec" style="flex:1;font-size:.78rem;padding:8px" onclick="chefSetPin('${c.replace(/'/g,"\\'")}')">
          ${hasPin?'🔄 Changer le code':'🔑 Définir un code PIN'}
        </button>
        ${hasPin?`<button class="btn btn-sec" style="font-size:.78rem;padding:8px;color:#dc2626;background:#fff5f5;border:1px solid #fca5a5" onclick="chefRemovePin('${c.replace(/'/g,"\\'")}')">🗑️ Supprimer</button>`:''}
      </div>
      <label>Question si code oublié</label>
      <input type="text" placeholder="Ex: Mon premier poste ?" value="${escH(q)}"
        oninput="saveChefQ('${c.replace(/'/g,"\\'")}','question',this.value)">
      <label>Réponse secrète</label>
      <input type="text" placeholder="Réponse..." value="${escH(a)}"
        oninput="saveChefQ('${c.replace(/'/g,"\\'")}','answer',this.value.trim().toLowerCase())">
    </div>` : '';
    return `<div>
      <div class="chef-row">
        <div class="sess-avatar" style="background:${sessColor(c)};width:28px;height:28px;font-size:.7rem;flex-shrink:0">${sessInitials(c)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:.85rem;font-weight:700">${escH(c)}</div>
          ${worksBadge}
        </div>
        <button class="chef-pin-badge ${planningExpanded?'has':'none'}" onclick="toggleChefPlanPanel('${c.replace(/'/g,"\\'")}')">📅</button>
        <button class="chef-pin-badge ${hasPin?'has':'none'}" onclick="toggleChefPinPanel('${c.replace(/'/g,"\\'")}')">
          ${hasPin?'🔑':'⚙️'}
        </button>
        <button class="del" onclick="removeChef(${i})">🗑</button>
      </div>
      ${planningHtml}
      ${pinHtml}
    </div>`;
  }).join('');
}

function toggleChefPinPanel(name){
  _chefPinExpanded = _chefPinExpanded===name ? null : name;
  renderChefList();
}

let _chefPlanExpanded = null;
let _chefPlanTab = {}; // onglet A/B courant en édition par cuisinier
function toggleChefPlanPanel(name){
  _chefPlanExpanded = _chefPlanExpanded===name ? null : name;
  _chefPinExpanded = null;
  renderChefList();
}
function setChefPlanTab(name, tab){
  _chefPlanTab[name] = tab;
  renderChefList();
}
function setChefPlan(name, jour, service, weekAB){
  S.chefSchedule = S.chefSchedule||{};
  const cur = S.chefSchedule[name];
  // Si AB et weekAB fourni, écrit dans la bonne semaine
  if(weekAB && cur?.mode === 'ab'){
    cur[weekAB] = cur[weekAB] || {};
    cur[weekAB][jour] = service;
  } else if(cur?.mode === 'simple'){
    cur.plan = cur.plan || {};
    cur.plan[jour] = service;
  } else {
    // Legacy ou nouveau chef sans config : écriture à plat (rétro-compat)
    S.chefSchedule[name] = S.chefSchedule[name] || {};
    S.chefSchedule[name][jour] = service;
  }
  save();
  if(typeof _saveConfigToSupabase==='function') _saveConfigToSupabase();
  renderChefList();
}

// ── Filtrage sessions par jour de travail ───────────────
function chefWorksToday(name){
  const weekAB = getCurrentWeekAB();
  const sched = chefSchedGet(name, weekAB);
  if(!sched || !Object.keys(sched).length) return null; // pas de planning → indéterminé
  const jKeys = ['dim','lun','mar','mer','jeu','ven','sam'];
  const k = jKeys[new Date().getDay()];
  const v = sched[k]||'repos';
  return v !== 'repos' ? v : false;
}

// ── Badge employé de la semaine ─────────────────────────
const _BADGE_MSGS = [
  "Top du classement cette semaine — le resto te doit une bière !",
  "Irremplaçable. On l'a vérifié.",
  "Tu portes toute l'équipe, et on le sait.",
  "HACCP sous contrôle, surtout grâce à toi.",
  "Si la cuisine était un sport, tu serais en finale.",
  "Champion·ne de la traçabilité — ça mérite une mention au planning.",
  "Quelqu'un a lu le règlement CE 178/2002. C'est toi. Respect.",
  "L'HACCP n'aurait pas de sens sans des gens comme toi.",
  "Meilleure assiduité de la semaine — et ça fait vraiment la différence.",
  "Sans toi, certains frigos auraient une vie très mystérieuse.",
];
function _badgeWeekKey(){
  const d=new Date(); const y=d.getFullYear();
  const s=new Date(y,0,1); const w=Math.ceil(((d-s)/86400000+s.getDay()+1)/7);
  return y+'-W'+String(w).padStart(2,'0');
}
function calcEmployeBadge(){
  const chefs=getChefs(); if(!chefs.length) return null;
  const wk=_badgeWeekKey();
  if(S._badgeDismissed===wk) return null;
  // Dates de la semaine courante
  const now=new Date(); const day=now.getDay();
  const monday=new Date(now); monday.setDate(now.getDate()-(day===0?6:day-1)); monday.setHours(0,0,0,0);
  const monStr=monday.toISOString().slice(0,10);
  const scores={};
  chefs.forEach(c=>scores[c]=0);
  function addIfChef(name, pts){
    if(chefs.includes(name)) scores[name]=(scores[name]||0)+pts;
  }
  // Scanner toutes les lignes de toutes les sections
  const secIds=['enr01','enr02','enr03','enr04','enr05','enr06','enr07','enr08',
    'enr19','enr23','enr26','enr28','enr30','enr33','enr34','enr_tc_distrib'];
  secIds.forEach(id=>{
    (S[id]?.lignes||[]).forEach(r=>{
      if((r.date||'')>=monStr){
        const who=r.cuisinier||r.nom_fct||r.operateur||r.visa||'';
        if(who) addIfChef(who,1);
      }
    });
    // saisies ENR19
    (S[id]?.saisies||[]).forEach(r=>{
      if((r.date||'')>=monStr) addIfChef(r.cuisinier||'',1);
    });
  });
  // Nettoyage
  (S.nett_val||[]).forEach(v=>{ if((v.date||'')>=monStr) addIfChef(v.cuisinier||'',1); });
  // T°C distrib
  (S['enr_tc_distrib']?.lignes||[]).forEach(r=>{
    if((r.date||'')>=monStr){
      addIfChef(r.midi_cuisinier||'',1);
      addIfChef(r.soir_cuisinier||'',1);
    }
  });
  const entries=Object.entries(scores).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  if(!entries.length) return null;
  // Seuil mini : au moins 3 actions
  if(entries[0][1]<3) return null;
  // Écart significatif si 2+ chefs
  if(entries.length>1 && entries[1][1]>0 && entries[0][1]<entries[1][1]*1.2) return null;
  const [winner, count] = entries[0];
  const msgIdx = Math.abs([...winner].reduce((h,c)=>h+c.charCodeAt(0),0) + new Date().getDate()) % _BADGE_MSGS.length;
  return {winner, count, msg: _BADGE_MSGS[msgIdx], week:wk};
}
function dismissBadge(){
  S._badgeDismissed=_badgeWeekKey(); save(); renderMain();
}
function renderBadgeEmploye(){
  const b=calcEmployeBadge(); if(!b) return '';
  const col=sessColor(b.winner); const ini=sessInitials(b.winner);
  return `<div class="badge-employe">
    <button class="badge-employe-dismiss" onclick="dismissBadge()">✕ Fermer</button>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
      <div class="badge-employe-avatar" style="background:${col}">${ini}</div>
      <div>
        <div style="font-size:.65rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,.7)">⭐ Employé·e de la semaine</div>
        <div style="font-size:1.05rem;font-weight:900;color:#fff">${escH(b.winner)}</div>
        <div style="font-size:.72rem;color:rgba(255,255,255,.8);margin-top:2px">${b.count} action${b.count>1?'s':''} enregistrée${b.count>1?'s':''} cette semaine</div>
      </div>
    </div>
    <div style="background:rgba(255,255,255,.15);border-radius:10px;padding:10px 12px;font-size:.8rem;font-weight:700;color:#fff;font-style:italic">"${b.msg}"</div>
  </div>`;
}
function saveChefQ(name,field,val){
  S.chefPins = S.chefPins||{}; S.chefPins[name]=S.chefPins[name]||{};
  S.chefPins[name][field]=val; save(); if(typeof _saveConfigToSupabase==='function')_saveConfigToSupabase();
}
function chefSetPin(name){
  openPinModal({mode:'set1', target:'chef:'+name, onSuccess:()=>{ _chefPinExpanded=name; renderChefList(); }});
}
function chefRemovePin(name){
  showConfirm('Supprimer le code de '+name+' ?', 'Le cuisinier pourra se connecter sans code.', 'Supprimer', ()=>{
    S.chefPins=S.chefPins||{}; if(S.chefPins[name]) delete S.chefPins[name].pin;
    save(); _chefPinExpanded=name; renderChefList(); toast('🔓 Code supprimé pour '+name);
  });
}

// ════════════════════════════════════════════════════
// ════════════════════════════════════════════════════
// PURGE GUIDÉE — Archivage & Nettoyage localStorage
// Règlement CE 178/2002 : données texte 5 ans, miniatures 6 mois
// ════════════════════════════════════════════════════
const PURGE_6MOIS_MS = 6 * 30.5 * 24 * 60 * 60 * 1000;
const PURGE_5ANS_MS  = 5 * 365.25 * 24 * 60 * 60 * 1000;

function purgeGetVieuxMiniatures() {
  const cutoff = Date.now() - PURGE_6MOIS_MS;
  const result = [];
  // Chercher les miniatures dans les lignes ENR23, ENR31
  ['enr23','enr31'].forEach(sec => {
    (S[sec]?.lignes||[]).forEach((r,i) => {
      ['photo','p1_photo','p2_photo'].forEach(k => {
        if (r[k] && r[k].thumb) {
          const ts = r._ts ? new Date(r._ts).getTime() : 0;
          if (ts < cutoff && ts > 0) result.push({sec, i, key:k, ts: r._ts||''});
        }
      });
    });
  });
  return result;
}

function purgeGetDonneesAnciennesTexte() {
  const cutoff5ans = Date.now() - PURGE_5ANS_MS;
  const avertissement6mois = Date.now() - PURGE_6MOIS_MS;
  const result = { vieux5ans: [], avertissement6mois: [] };
  Object.keys(S).forEach(sec => {
    if (!Array.isArray(S[sec]?.lignes)) return;
    S[sec].lignes.forEach((r,i) => {
      const ts = r._ts ? new Date(r._ts).getTime() : 0;
      if (ts > 0 && ts < cutoff5ans) result.vieux5ans.push({sec, i, ts:r._ts, date:r.date||''});
      else if (ts > 0 && ts < avertissement6mois) result.avertissement6mois.push({sec, i, ts:r._ts, date:r.date||''});
    });
  });
  return result;
}

function purgeCheckStatus() {
  const el = document.getElementById('sp-purge-status');
  if (!el) return;
  const minis = purgeGetVieuxMiniatures();
  const donnees = purgeGetDonneesAnciennesTexte();
  const nb6m = donnees.avertissement6mois.length;
  const nb5ans = donnees.vieux5ans.length;
  const nbMinis = minis.length;

  // Calcul occupation localStorage
  let lsSize = 0;
  try { lsSize = new Blob([JSON.stringify(S)]).size; } catch(e){}
  const lsKo = Math.round(lsSize / 1024);
  const lsBar = Math.min(100, Math.round(lsKo / 51200 * 100)); // 5 Mo max estimé

  el.innerHTML = `<div style="background:#f8f0f8;border:1.5px solid var(--brd);border-radius:12px;padding:12px 14px;font-size:.78rem;line-height:1.7">
    <div style="font-weight:800;color:var(--plum);margin-bottom:6px">📊 État du stockage</div>
    <div style="background:#e5e7eb;border-radius:6px;height:7px;margin-bottom:6px">
      <div style="height:100%;width:${lsBar}%;background:${lsBar>80?'#dc2626':lsBar>50?'#f97316':'#16a34a'};border-radius:6px"></div>
    </div>
    <div style="color:var(--gris2)">Données : <strong>${lsKo} Ko</strong></div>
    <div style="color:${nbMinis>0?'#c2410c':'#166534'};font-weight:700">🖼️ Miniatures &gt;6 mois : ${nbMinis}</div>
    <div style="color:${nb6m>0?'#c2410c':'#166534'};font-weight:700">⚠️ Saisies &gt;6 mois : ${nb6m} <span style="font-weight:500">(archivez avant purge)</span></div>
    <div style="color:${nb5ans>0?'#991b1b':'#166534'};font-weight:700">🗑️ Saisies &gt;5 ans : ${nb5ans} <span style="font-weight:500">(peuvent être supprimées)</span></div>
  </div>`;
  toast('🔍 Analyse terminée', 'success');
}

function purgeExportJSON() {
  const donnees = purgeGetDonneesAnciennesTexte();
  const totalAvertis = donnees.avertissement6mois.length + donnees.vieux5ans.length;
  const exportData = {
    export_date: new Date().toISOString(),
    etablissement: S.config?.etab || '',
    reglementation: 'Règlement CE 178/2002 — Conservation 5 ans',
    nb_enregistrements: totalAvertis,
    sections: {}
  };
  // Regrouper par section
  [...donnees.avertissement6mois, ...donnees.vieux5ans].forEach(({sec, i}) => {
    if (!exportData.sections[sec]) exportData.sections[sec] = [];
    const r = (S[sec]?.lignes||[])[i];
    if (r) {
      // Exclure les photos base64 de l'export JSON
      const clean = {...r};
      ['photo','p1_photo','p2_photo','signature'].forEach(k => { if(clean[k]) delete clean[k]; });
      exportData.sections[sec].push(clean);
    }
  });
  const json = JSON.stringify(exportData, null, 2);
  const dateStr = today();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], {type:'application/json'}));
  a.download = `HACCP_Archive_${dateStr}.json`;
  a.click();
  toast('💾 Archive JSON téléchargée — conservez ce fichier 5 ans', 'success');
}

function purgeMiniatures() {
  const minis = purgeGetVieuxMiniatures();
  if (minis.length === 0) { toast('✅ Aucune miniature à purger', 'success'); return; }
  showConfirm(
    'Purger ' + minis.length + ' miniature' + (minis.length>1?'s':''),
    'Les photos de plus de 6 mois seront supprimees. Exportez vos donnees avant si necessaire.',
    '🗑️ Purger',
    () => {
      let count = 0;
      // Supprimer par ordre inverse pour ne pas décaler les indices
      const bySecIdx = {};
      minis.forEach(({sec,i,key}) => {
        if (!bySecIdx[sec]) bySecIdx[sec] = {};
        if (!bySecIdx[sec][i]) bySecIdx[sec][i] = [];
        bySecIdx[sec][i].push(key);
      });
      Object.entries(bySecIdx).forEach(([sec, idxMap]) => {
        Object.entries(idxMap).forEach(([i, keys]) => {
          const r = (S[sec]?.lignes||[])[parseInt(i)];
          if (r) keys.forEach(k => { delete r[k]; count++; });
        });
      });
      save();
      toast('✅ ' + count + ' miniature' + (count>1?'s':'') + ' supprimée' + (count>1?'s':''), 'success');
      purgeCheckStatus();
    }
  );
}

function purgeCheckAlerte() {
  // Appelée au démarrage — alerte si des données dépassent 6 mois
  const donnees = purgeGetDonneesAnciennesTexte();
  const nb = donnees.avertissement6mois.length + donnees.vieux5ans.length;
  if (nb > 0 && (!S._purgeAlerteDismissed_today || S._purgeAlerteDismissed_today !== today())) {
    if (donnees.vieux5ans.length > 0) {
      setTimeout(() => toast('⚠️ ' + donnees.vieux5ans.length + ' saisie(s) dépassent 5 ans — archivez via Paramètres', 'warning'), 4000);
    } else if (donnees.avertissement6mois.length > 30) {
      setTimeout(() => toast('📦 ' + donnees.avertissement6mois.length + ' saisies dépassent 6 mois — pensez à archiver', 'warning'), 4000);
    }
  }
}

// INIT
// ════════════════════════════════════════════════════
function init(){
  // Forcer la visibilité — authGuard peut être encore en attente de refresh
  document.body.style.visibility = 'visible';
  checkLicense();
  const now=new Date();
  const cfg=S.config||{};
  // Restaurer les champs dans le panel Config
  // Nom et code depuis Supabase (readonly — pas depuis localStorage)
  const _c = SupaEngine.cfg();
  if(_c.siteId) document.getElementById('etab-code').value = _c.siteId;
  if(_c.siteNom || S.config?.etab) document.getElementById('etab-nom').value = _c.siteNom || S.config.etab || '';
  document.getElementById('etab-mois').value=cfg.mois||now.toISOString().slice(0,7);
  // h-etab-disp supprimé
  registerCustomPages();
  registerDistribSvcPages();
  if(!distribGD('date')) distribSD('date',today());
  distribCheckReminders();
  setInterval(()=>{ if(cur==='accueil') renderMain(); distribCheckReminders(); checkVibrationAlerts(); checkTabletVoice(); }, 60*1000);
  // Relancer l'interval si des timers ont été restaurés depuis localStorage
  if (Object.keys(_ccpTimers).length > 0 && !_ccpTimerInterval) {
    _ccpTimerInterval = setInterval(ccpTimerRefreshAll, 10000);
  }
  setInterval(autoBackup, 30*60*1000); // sauvegarde auto toutes les 30 min
  // NE PAS appeler autoBackup() ici — on attend _loadFromSupabase() pour éviter
  // de ré-enqueuer l'ancien localStorage avant que le cloud soit chargé
  applyNavLayout();
  renderNav();
  renderMain();
  initNavCollapsed();
  try{history.replaceState({page:'accueil',prev:'accueil'},'', ' ');}catch(e){}
  // ── Session depuis la page login unifiée ─────────────
  try {
    const session = JSON.parse(localStorage.getItem('haccpro_supa_cfg') || '{}');
    if (session.userToken) {
      const existing = JSON.parse(localStorage.getItem('haccp_supa_cfg_v1') || '{}');
      const merged = {
        url: _PMS_URL_DEFAULT,
        anonKey: _PMS_KEY_DEFAULT,
        userToken: session.userToken,
        refreshToken: session.refreshToken || '',
        userEmail: session.userEmail || '',
        tenantId: session.tenantId || '',
        // siteId et siteNom : TOUJOURS depuis la session fraîche, jamais l'ancien
        siteId: session.siteId || '',
        siteNom: session.siteNom || '',
        userRole: session.userRole || '',
      };
      localStorage.setItem('haccp_supa_cfg_v1', JSON.stringify(merged));
      localStorage.removeItem('haccpro_supa_cfg');
      const siteEl = document.getElementById('supa-site-id');
      if (siteEl && merged.siteId) siteEl.value = merged.siteId;
    }
  } catch(e) {}

  // ── Refresh token via SDK si disponible ──────────────
  try {
    if(window._supaClient){
      window._supaClient.auth.getSession().then(function(res){
        if(res.data&&res.data.session){
          var s=res.data.session;
          var cfg=JSON.parse(localStorage.getItem('haccp_supa_cfg_v1')||'{}');
          cfg.userToken=s.access_token;
          if(s.refresh_token)cfg.refreshToken=s.refresh_token;
          localStorage.setItem('haccp_supa_cfg_v1',JSON.stringify(cfg));
        }
      }).catch(function(){});
    }
  } catch(e){}
  // ── Vérification session ──────────────────────────────
  try {
    const cfg = JSON.parse(localStorage.getItem('haccp_supa_cfg_v1') || '{}');
    // Bloquer seulement si rôle non-cuisinier explicitement (ex: admin qui ouvre le mauvais lien)
    if (cfg.userToken && cfg.userRole && cfg.userRole !== 'cuisinier') {
      document.body.innerHTML = `
        <div style="position:fixed;inset:0;background:#0F2240;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px">
          <div style="font-size:2.5rem;margin-bottom:16px">⛔</div>
          <div style="color:#fff;font-size:1.1rem;font-weight:800;margin-bottom:8px">Accès non autorisé</div>
          <div style="color:rgba(255,255,255,.7);font-size:.85rem;text-align:center;margin-bottom:24px">
            Cette application est réservée aux cuisiniers.<br>
            Compte connecté : ${cfg.userEmail||''}
          </div>
          <button onclick="localStorage.removeItem('haccp_supa_cfg_v1');window.location.href='index.html'" style="background:#dc2626;color:#fff;border:none;border-radius:14px;padding:14px 32px;font-size:1rem;font-weight:800;cursor:pointer;font-family:inherit">
            Changer de compte
          </button>
        </div>`;
      return;
    }
    // Pas de token → afficher bannière non bloquante (tablette configurée en mode local)
    if (!cfg.userToken && cfg.siteId) {
      // Tablette configurée mais sans token récent → continuer normalement
      // Un toast sera affiché par SupaEngine si sync échoue
    }
  } catch(e) {}

  initTheme();
  initHeaderBranding();
  initSyncStatus();
  setTimeout(autoSyncCheck, 3000);
  SupaEngine.init();
  purgeCheckAlerte();
  updateSessHeader();
  _loadFromSupabase();
  setTimeout(()=>{ pollTabletAlerts(); }, 4000);
  setInterval(()=>{ pollTabletAlerts(); }, 45*1000);
  // Sync config enceintes au démarrage (au cas où elle n'existe pas encore)
  setTimeout(function(){ syncEnceinteConfig(getEnceintes()); checkCaniculeMode(); }, 5000);
  setInterval(function(){ checkCaniculeMode(); }, 10*60*1000);
}

// ══════════════════════════════════════════════════════
// NUMPAD UNIVERSEL T°C
// ══════════════════════════════════════════════════════
var _qtCtx=null,_qtBuf='';

function qtTap(el){
  var d=el.dataset,t=d.qt;
  if(t==='f'){
    var stored=gd(d.qi,d.qs);
    var cur=(stored!==undefined&&stored!==''&&!isNaN(parseFloat(stored)))?parseFloat(stored):null;
    _qtOpen({label:'🌡️ Température',sub:'',min:parseFloat(d.qn),max:parseFloat(d.qx),val:cur,
      ok:function(v){tpSet(d.qi,d.qs,v);}});
  } else if(t==='e'){
    var stored2=gd(d.qi,d.qs);
    var cur2=(stored2!==undefined&&stored2!==''&&!isNaN(parseFloat(stored2)))?parseFloat(stored2):null;
    var mn=parseFloat(d.qn),mx=parseFloat(d.qx);
    _qtOpen({label:'🌡️ Température',sub:'',min:mn,max:mx,val:cur2,consigne:(_encSaisie&&_encSaisie.consigne!=null)?_encSaisie.consigne:null,
      ok:function(v){onEncTS(d.qi,d.qs,v,mn,mx);}});
  } else if(t==='d'){
    var svc=d.qs,type=d.qt2;
    var id2=svc+'_'+type+'_temp';
    var val=distribGD(id2);
    var cur3=(val!==undefined&&val!==''&&!isNaN(parseFloat(val)))?parseFloat(val):null;
    _qtOpen({label:type==='froid'?'❄️ T°C Froid':'🔥 T°C Chaud',sub:'Distribution',
      min:parseFloat(d.qn),max:parseFloat(d.qx),val:cur3,
      ok:function(v){distribDirect(svc,type,String(v));}});
  } else if(t==='r'){
    var pfx=d.qs;
    var diEl=document.getElementById('r23di-'+pfx);
    var cur4=diEl?parseFloat(diEl.textContent):NaN;
    _qtOpen({label:'🌡️ T°C produit',sub:'Réception',
      min:parseFloat(d.qn),max:parseFloat(d.qx),val:isNaN(cur4)?null:cur4,
      ok:function(v){r23DirectTemp(pfx,v);}});
  } else if(t==='svc'){
    var svcId2=d.qs, slotType2=d.qt2; // ex: "midi_froid"
    var parts2=slotType2.split('_');
    var tempType2=parts2[parts2.length-1]; // 'froid' ou 'chaud'
    var val2=distribSvcGD(svcId2,slotType2+'_temp');
    var cur5=(val2!==undefined&&val2!==''&&!isNaN(parseFloat(val2)))?parseFloat(val2):null;
    _qtOpen({label:tempType2==='froid'?'❄️ T°C Froid':'🔥 T°C Chaud',sub:svcId2,
      min:parseFloat(d.qn),max:parseFloat(d.qx),val:cur5,
      ok:function(v){distribSvcSD(svcId2,slotType2+'_temp',String(v));distribSvcSlider(svcId2,slotType2,v);}});
  } else if(t==='enc'){
    openQTemp(d.qi,d.qm);
  }
}

function _qtOpen(cfg){
  var titleEl=document.getElementById('qtemp-title');
  var subEl=document.getElementById('qtemp-sub');
  if(!titleEl||!subEl)return;
  _qtCtx=cfg;
  _qtBuf=cfg.val!==null&&cfg.val!==undefined?String(cfg.val):'';
  titleEl.textContent=cfg.label||'🌡️ T°C';
  subEl.textContent=cfg.sub||'';
  _qtRefresh();
  document.getElementById('qtemp-ov').classList.add('open');
}

function qtempPress(v){
  if(v==='.'&&_qtBuf.indexOf('.')>=0)return;
  var digits=_qtBuf.replace(/[-.]/g,'');
  if(v!=='.'&&digits.length>=4)return;
  _qtBuf+=v;_qtRefresh();
}
function qtempToggleMinus(){
  _qtBuf=_qtBuf.charAt(0)==='-'?_qtBuf.slice(1):'-'+_qtBuf;_qtRefresh();
}
function qtempDel(){_qtBuf=_qtBuf.slice(0,-1);_qtRefresh();}

function _qtRefresh(){
  var dispEl=document.getElementById('qtemp-disp');
  var btnEl=document.getElementById('qtemp-confirm');
  if(!dispEl||!btnEl)return;
  var num=parseFloat(_qtBuf);
  var empty=_qtBuf===''||_qtBuf==='-';
  dispEl.textContent=empty?'—':(num>=0?'+':'')+_qtBuf+' °C';
  dispEl.className='qtemp-display';
  if(!empty&&!isNaN(num)&&_qtCtx&&_qtCtx.consigne!=null){
    var ok=encConforme(num,_qtCtx.consigne);
    if(ok===true)dispEl.classList.add('ok');
    else if(ok===false)dispEl.classList.add('nc');
  }
  btnEl.disabled=empty||isNaN(num);
}

function qtempConfirm(){
  if(!_qtCtx)return;
  var num=parseFloat(_qtBuf);
  if(isNaN(num))return;
  var clamped=Math.max(_qtCtx.min!=null?_qtCtx.min:-999,Math.min(_qtCtx.max!=null?_qtCtx.max:999,num));
  var cb=_qtCtx.ok;
  qtempClose();
  if(cb)cb(clamped);
}
function qtempClose(){
  var ov=document.getElementById('qtemp-ov');
  if(ov)ov.classList.remove('open');
  _qtCtx=null;_qtBuf='';
}

// ── Enceintes accueil ──
function openQTemp(encId,moment){
  var enc=getEnceintes().find(function(e){return e.id===encId;});
  if(!enc)return;
  var t=today();
  var saisies=(S['enr19']&&S['enr19'].saisies)||[];
  var existing=saisies.find(function(r){return r.date===t&&r.enc_id===encId&&r.moment===moment;});
  var _subLabel=moment==='ouv'?'🌅 Ouverture':moment==='aprem'?'☀️ Après-midi':'🌙 Fermeture';
  _qtOpen({label:'🌡️ '+enc.label,sub:_subLabel,
    min:-30,max:100,val:existing?existing.temp:null,consigne:enc.consigne,
    ok:function(v){
      S['enr19']=S['enr19']||{};S['enr19'].saisies=S['enr19'].saisies||[];
      var idx=S['enr19'].saisies.findIndex(function(r){return r.date===t&&r.enc_id===encId&&r.moment===moment;});
      var entry={
        date:t, enc_id:encId, enc_label:enc.label||encId, moment:moment, temp:v,
        heure:nowT(), cuisinier:getActiveSession()||'',
        _ts:new Date().toISOString(), _sec:'enr19'
      };
      if(idx>=0){
        // Mise à jour : garder le _ts original si déjà synced, sinon nouveau
        entry._ts = S['enr19'].saisies[idx]._ts || entry._ts;
        S['enr19'].saisies[idx]=entry;
      } else {
        S['enr19'].saisies.push(entry);
      }
      save(); autoBackup();
      // ── Supabase sync (manquant dans le widget accueil) ──
      try { SupaEngine.enqueue('enr19', entry); } catch(e){}
      var ok=encConforme(v,enc.consigne);
      toast((ok?'✅ ':'⚠️ ')+enc.label+' : '+(v>=0?'+':'')+v+'°C'+(ok?' — Conforme ✓':' — NC !'),ok?'success':'warning');
      if(ok===false)autoCreateNC('ENR19','T°C non conforme : '+enc.label,enc.label,'Vérifier le réglage');
      if(cur==='accueil')renderMain();
    }
  });
}

// ══════════════════════════════════════════════════════
// WIDGET ENCEINTES ACCUEIL
// ══════════════════════════════════════════════════════
function renderQuickEnc(){
  var encs=getEnceintes();
  if(!encs.length)return'';
  var t=today(),saisies=(S['enr19']&&S['enr19'].saisies)||[];
  var h=new Date().getHours();
  var allDone=true;
  var tiles=encs.map(function(enc){
    var can=caniculeActive();
    var ouv=saisies.find(function(r){return r.date===t&&r.enc_id===enc.id&&r.moment==='ouv';});
    var fer=saisies.find(function(r){return r.date===t&&r.enc_id===enc.id&&r.moment==='ferm';});
    var apr=can?saisies.find(function(r){return r.date===t&&r.enc_id===enc.id&&r.moment==='aprem';}):null;
    if(!ouv||!fer||(can&&!apr))allDone=false;
    var okO=ouv?encConforme(ouv.temp,enc.consigne):null;
    var okF=fer?encConforme(fer.temp,enc.consigne):null;
    var hasNC=okO===false||okF===false;
    var hasAll=!!ouv&&!!fer;
    var hasSome=!!ouv||!!fer;
    var cls=hasNC?'has-nc':hasAll?'all-ok':hasSome?'partial':'';
    var nextM=!ouv?'ouv':(can&&!apr)?'aprem':!fer?'ferm':h<8?'ouv':h<14?'aprem':'ferm';
    function fmtT(r){if(!r||r.temp===undefined||isNaN(parseFloat(r.temp)))return'—';var v=parseFloat(r.temp);return(v>=0?'+':'')+v.toFixed(1)+'°';}
    function clsT(r){if(!r)return't-nd';var c=encConforme(r.temp,enc.consigne);return c===true?'t-ok':c===false?'t-nc':'';}
    // Canicule : inclure aprem dans hasNC/hasAll/cls
    var okA=apr?encConforme(apr.temp,enc.consigne):null;
    if(can&&okA===false) hasNC=true;
    if(can) hasAll=!!ouv&&!!fer&&!!apr;
    if(can) hasSome=!!ouv||!!fer||!!apr;
    cls=hasNC?'has-nc':hasAll?'all-ok':hasSome?'partial':'';
    return'<div class="qenc-tile '+cls+'" data-qt="enc" data-qi="'+enc.id+'" data-qm="'+nextM+'" onclick="qtTap(this)">'+
      (can?'<div style="font-size:.5rem;font-weight:900;background:#f59e0b;color:#fff;border-radius:4px;padding:1px 5px;margin-bottom:3px;text-align:center">☀️ CANICULE</div>':'')+
      '<div class="qenc-name">'+escH(enc.label)+'</div>'+
      '<div class="qenc-temps" style="justify-content:'+(can?'space-between':'center')+'">'+
        '<div class="qenc-temp-col"><div class="qenc-temp '+clsT(ouv)+'">'+fmtT(ouv)+'</div><div class="qenc-lbl">Ouv.</div></div>'+
        (can?'<div class="qenc-temp-col"><div class="qenc-temp '+(apr?(encConforme(apr.temp,enc.consigne)===false?'t-nc':'t-ok'):'t-nd')+'">'+fmtT(apr)+'</div><div class="qenc-lbl" style="color:#f59e0b">Aprem.</div></div>':'')+
        '<div class="qenc-temp-col"><div class="qenc-temp '+clsT(fer)+'">'+fmtT(fer)+'</div><div class="qenc-lbl">Ferm.</div></div>'+
      '</div>'+
      '<div class="qenc-consigne">'+(enc.consigne!==undefined?enc.consigne:'')+'</div>'+
    '</div>';
  }).join('');
  var badge=allDone?'<div style="font-size:.65rem;font-weight:800;color:#166534;background:#dcfce7;padding:2px 9px;border-radius:10px">✓ Tout saisi</div>':'<div style="font-size:.65rem;font-weight:800;color:#92400e;background:#fef3c7;padding:2px 9px;border-radius:10px">À compléter</div>';
  return'<div style="margin-bottom:14px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><div style="font-size:.65rem;font-weight:900;text-transform:uppercase;letter-spacing:.5px;color:#b89ab6">🌡️ Enceintes — tap pour saisir</div>'+badge+'</div><div class="qenc-grid">'+tiles+'</div></div>';
}

// ══════════════════════════════════════════════════════
// BOUTON BILAN DU MOIS
// ══════════════════════════════════════════════════════
function renderBilanMoisBtn(){
  var now=new Date();
  var lastDay=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
  var dayNum=now.getDate();
  if(dayNum<lastDay-4&&dayNum!==1)return'';
  var mois=S.config&&S.config.mois?S.config.mois:today().slice(0,7);
  var parts=mois.split('-');
  var moisLabel=new Date(+parts[0],+parts[1]-1,1).toLocaleDateString('fr-FR',{month:'long',year:'numeric'});
  return'<div onclick="openAuditModal()" style="background:linear-gradient(135deg,var(--plum),var(--mag));border-radius:16px;padding:15px 16px;margin-bottom:14px;cursor:pointer;display:flex;align-items:center;gap:12px;user-select:none"><span style="font-size:1.9rem">📄</span><div style="flex:1"><div style="font-size:.92rem;font-weight:900;color:#fff">Bilan '+moisLabel+'</div><div style="font-size:.72rem;color:rgba(255,255,255,.8);margin-top:2px">Générer les 3 rapports PDF + Excel</div></div><span style="font-size:1.3rem;color:rgba(255,255,255,.65)">›</span></div>';
}

// ══════════════════════════════════════════════════════
// ALERTE FIN DE SERVICE
// ══════════════════════════════════════════════════════
var _eosNext=null,_eosMissing=[];
function checkEndOfService(outgoing,next){
  var t=today(),encs=getEnceintes(),saisies=(S['enr19']&&S['enr19'].saisies)||[];
  var missing=[];
  var ferManq=encs.filter(function(e){return!saisies.some(function(r){return r.date===t&&r.enc_id===e.id&&r.moment==='ferm';});});
  if(ferManq.length)missing.push({icon:'🌡️',label:'T°C fermeture'+(ferManq.length>1?' ('+ferManq.length+' enceintes)':' — '+ferManq[0].label),detail:ferManq.map(function(e){return e.label;}).join(', '),goto:'enr19'});
  var ncOpen=((S['enr30']&&S['enr30'].lignes)||[]).filter(function(r){return r._auto===true&&r.cloture!=='OUI';}).length;
  if(ncOpen>0)missing.push({icon:'📋',label:ncOpen+' NC à clôturer',detail:'Obligatoire avant fin de service',goto:'enr30'});
  var refAttente=((S['enr01']&&S['enr01'].lignes)||[]).filter(function(r){return r.date===t&&(!r._statut||r._statut==='en_attente');}).length;
  if(refAttente>0)missing.push({icon:'❄️',label:refAttente+' refroidissement'+(refAttente>1?'s':'')+' en attente',detail:'À clôturer avant de partir',goto:'enr01'});
  var livraisons=fourcTodayDeliveries();
  var recepFaites=((S['enr23']&&S['enr23'].lignes)||[]).filter(function(r){return r.date===t;}).length;
  if(livraisons.length>0&&recepFaites===0)missing.push({icon:'📦',label:'Réceptions non saisies',detail:livraisons.map(function(f){return f.nom;}).join(', '),goto:'enr23'});
  // Plats témoins périmés à détruire
  var temoinsADetruire=((S['enr33']&&S['enr33'].lignes)||[]).filter(function(r){return r.date_destruct&&r.date_destruct<=t&&!r._jete;}).length;
  if(temoinsADetruire>0)missing.push({icon:'🍱',label:temoinsADetruire+' plat'+(temoinsADetruire>1?'s':'')+' témoin'+(temoinsADetruire>1?'s':'')+' à détruire',detail:'DLC dépassée — obligation réglementaire HACCP',goto:'enr33'});
  // Lots étiquettes non imprimés
  var lotsEnAttente=(_e33batch.reduce(function(s,b){return s+(b.nb||1);},0))+(_e34batch.reduce(function(s,b){return s+(b.nb||1);},0))+(_e36batch.reduce(function(s,b){return s+(b.nb||1);},0));
  if(lotsEnAttente>0)missing.push({icon:'🏷️',label:lotsEnAttente+' étiquette'+(lotsEnAttente>1?'s':'')+' en attente d\'impression',detail:'Lot non imprimé — à faire avant de fermer',goto:'enr34'});
  if(!missing.length){next();return;}
  _eosNext=next;_eosMissing=missing;
  var titleEl=document.getElementById('eos-title');
  var subEl=document.getElementById('eos-sub');
  var itemsEl=document.getElementById('eos-items');
  var btnEl=document.getElementById('eos-btn-go');
  if(!titleEl||!subEl||!itemsEl||!btnEl)return;
  titleEl.textContent=outgoing?'👋 '+outgoing+' — avant de partir':'👋 Fin de service';
  subEl.textContent=missing.length+' point'+(missing.length>1?'s':'')+' à régler :';
  itemsEl.innerHTML=missing.map(function(m,i){return'<div class="eos-item missing" onclick="eosGoItem('+i+')"><span style="font-size:1.25rem;flex-shrink:0">'+m.icon+'</span><div style="flex:1"><div>'+m.label+'</div><div style="font-size:.7rem;opacity:.75;margin-top:1px">'+m.detail+'</div></div><span style="opacity:.4">›</span></div>';}).join('');
  btnEl.textContent='→ Corriger ('+missing.length+')';
  document.getElementById('eos-ov').classList.add('open');
  appVibrate([200,100,200]);
}
function eosGoItem(i){document.getElementById('eos-ov').classList.remove('open');if(_eosMissing[i])goTo(_eosMissing[i].goto);}
function eosGoFirst(){document.getElementById('eos-ov').classList.remove('open');if(_eosMissing[0])goTo(_eosMissing[0].goto);}
function eosSkip(){document.getElementById('eos-ov').classList.remove('open');var cb=_eosNext;_eosNext=null;_eosMissing=[];if(cb)cb();}


// ════════════════════════════════════════════════════
// SYSTÈME DE WIDGETS ACCUEIL
// ════════════════════════════════════════════════════

// ── Catalogue de tous les widgets disponibles ──────
var WG_CATALOG_BASE = [
  {id:'enc',       ico:'🌡️', name:'Enceintes T°C',        desc:'Relevés ouverture/fermeture — tap pour saisir', size:'full'},
  {id:'refroid',   ico:'❄️', name:'Timers refroidissement',desc:'Minuteries CCP actives en temps réel', size:'full'},
  {id:'recep',     ico:'📦', name:'Réceptions',            desc:'Contrôles du jour — tap pour saisir', size:'half'},
  {id:'nett',      ico:'🧹', name:'Nettoyage',             desc:'Statut du plan de nettoyage', size:'half'},
  {id:'nc',        ico:'📋', name:'Non-conformités',       desc:'NC ouvertes à clôturer', size:'half'},
  {id:'score',     ico:'📊', name:'Score HACCP',           desc:'Score de préparation du mois', size:'full'},
  {id:'bilan',     ico:'🌙', name:'Bilan journée',         desc:'Récap de toutes les tâches du jour', size:'full'},
  {id:'bilan_mois',ico:'📄', name:'Bilan du mois',         desc:'Visible en fin de mois — génère les PDF', size:'full'},
  {id:'etiq',      ico:'🏷️', name:'Rappels étiquetage',   desc:'Lots ouverts et DLC à surveiller', size:'half'},
  {id:'notes',     ico:'📝', name:'Notes',                  desc:'Post-its de l\'équipe', size:'full'},
  {id:'raccourcis',ico:'🔗', name:'Raccourcis sections',   desc:'Accès direct aux fiches les plus utilisées', size:'full'},
];

// Catalogue dynamique : inclut un widget par service de distribution configuré
function wgGetCatalog(){
  var svcs = getDistribServices();
  var distribWidgets = [];
  svcs.forEach(function(svc){
    distribWidgets.push({id:'d_'+svc.id+'_midi', ico:'🌞', name:svc.label+' — Midi', desc:'T°C froid & chaud Midi', size:'half', svcId:svc.id, slot:'midi'});
    distribWidgets.push({id:'d_'+svc.id+'_soir', ico:'🌙', name:svc.label+' — Soir', desc:'T°C froid & chaud Soir', size:'half', svcId:svc.id, slot:'soir'});
  });
  return distribWidgets.concat(WG_CATALOG_BASE);
}
var WG_CATALOG = WG_CATALOG_BASE; // sera mis à jour dynamiquement

function wgGetDefault(){
  var svcs = getDistribServices();
  var defs = [{id:'menu_jour_w'},{id:'enc'}];
  svcs.forEach(function(svc){
    defs.push({id:'d_'+svc.id+'_midi'});
    defs.push({id:'d_'+svc.id+'_soir'});
  });
  defs.push({id:'refroid'});
  defs.push({id:'recep'},{id:'nett'});
  defs.push({id:'nc'},{id:'score'});
  defs.push({id:'bilan_mois'});
  defs.push({id:'raccourcis'});
  return defs;
}

var WG_VER = 5;
function wgGet(){
  WG_CATALOG = wgGetCatalog(); // rafraîchir le catalogue
  var saved = S.config && S.config.homeWidgets && S.config.homeWidgetsVer === WG_VER
    ? S.config.homeWidgets : null;
  if(!saved) return wgGetDefault();

  // Auto-ajouter UNIQUEMENT les widgets pour les services JAMAIS vus
  // (ne jamais ré-ajouter ce que l'utilisateur a supprimé)
  S.config=S.config||{};
  var seen=S.config.wgDistribSeen||{};
  var svcs = getDistribServices();
  var changed = false;
  svcs.forEach(function(svc){
    ['midi','soir'].forEach(function(slot){
      var wid = 'd_'+svc.id+'_'+slot;
      // Si jamais vu ET pas déjà dans la liste → ajouter une seule fois
      if(!seen[wid] && !saved.some(function(w){return w.id===wid;})){
        var lastDIdx = -1;
        saved.forEach(function(w,i){ if(w.id.slice(0,2)==='d_') lastDIdx=i; });
        if(lastDIdx>=0) saved.splice(lastDIdx+1,0,{id:wid});
        else saved.splice(1,0,{id:wid});
        changed = true;
      }
      // Marquer comme vu (même si supprimé manuellement)
      seen[wid]=true;
    });
  });
  S.config.wgDistribSeen=seen;
  if(changed){ wgSave(saved); }
  // Dédupliquer et SAUVEGARDER (persistant)
  var seen2={};
  var deduped=saved.filter(function(w){if(seen2[w.id])return false;seen2[w.id]=true;return true;});
  if(deduped.length !== saved.length){ wgSave(deduped); } // Supprimer les doublons définitivement
  return deduped;
}
function wgSave(list){
  S.config = S.config||{};
  S.config.homeWidgets = list;
  S.config.homeWidgetsVer = WG_VER;
  save();
}

// ── Mode édition ───────────────────────────────────
var _wgEditing = false;
var _wgLongPressTimer = null;

function wgStartLongPress(e){
  _wgLongPressTimer = setTimeout(function(){
    if(!_wgEditing){ _wgEditing=true; renderMain(); toast('✏️ Mode édition — réorganisez vos widgets','success'); appVibrate([60,30,60]); }
  }, 600);
}
function wgCancelLongPress(){ clearTimeout(_wgLongPressTimer); }

function wgToggleEdit(){
  _wgEditing = !_wgEditing;
  renderMain();
}

function wgRemove(id){
  var list = wgGet().filter(function(w){ return w.id !== id; });
  wgSave(list); renderMain();
}
function wgRmById(el){
  var id=el.getAttribute('data-wid')||el.parentElement&&el.parentElement.getAttribute('data-wid');
  if(id) wgRemove(id);
}
// Délégation document — capture tout clic/touch sur .wg-rm même en dynamic HTML
document.addEventListener('click',function(e){
  var t=e.target;
  if(t.classList&&t.classList.contains('wg-rm')){
    e.stopPropagation(); e.preventDefault();
    var id=t.getAttribute('data-wid');
    if(id) wgRemove(id);
  }
},true);

// ── Catalogue modal ────────────────────────────────
function wgCatalogOpen(){
  var current = wgGet().map(function(w){ return w.id; });
  WG_CATALOG = wgGetCatalog();
  var html2 = WG_CATALOG.map(function(w){
    var already = current.indexOf(w.id) >= 0;
    return '<div class="wg-catalog-item'+(already?' already':'')+'" onclick="wgCatalogAdd(&quot;'+w.id+'&quot;)">'
      +'<div class="wg-catalog-ico">'+w.ico+'</div>'
      +'<div class="wg-catalog-info"><div class="wg-catalog-name">'+w.name+(already?' ✓':' ')+'</div><div class="wg-catalog-desc">'+w.desc+'</div></div>'
      +'<div class="wg-catalog-size">'+(w.size==='full'?'Plein':'Demi')+'</div>'
      +'</div>';
  }).join('');
  document.getElementById('wg-catalog-list').innerHTML = html2;
  document.getElementById('wg-catalog-ov').classList.add('open');
}
function wgCatalogClose(){
  document.getElementById('wg-catalog-ov').classList.remove('open');
}
function wgCatalogAdd(id){
  var current = wgGet();
  if(current.find(function(w){ return w.id===id; })) return;
  current.push({id:id});
  wgSave(current);
  wgCatalogClose();
  renderMain();
  toast('✅ Widget ajouté','success');
}

// ── Drag & drop touch ──────────────────────────────
var _wgDrag = null;

function wgDragStart(e, id){
  e.preventDefault();
  e.stopPropagation();
  var pt = e.touches ? e.touches[0] : e;
  var card = document.querySelector('.wg-card-wrap[data-wid="'+id+'"]');
  if(!card) return;
  var rect = card.getBoundingClientRect();
  // Créer un clone visuel
  var clone = card.cloneNode(true);
  clone.id = 'wg-clone';
  clone.style.width = rect.width + 'px';
  clone.style.top = rect.top + 'px';
  clone.style.left = rect.left + 'px';
  document.body.appendChild(clone);
  card.style.opacity = '0.3';
  _wgDrag = {
    id: id,
    startY: pt.clientY,
    startX: pt.clientX,
    offsetY: pt.clientY - rect.top,
    clone: clone,
    card: card,
    lastTarget: null
  };
  appVibrate([30]);
}

function wgDragMove(e){
  if(!_wgDrag) return;
  e.preventDefault();
  var pt = e.touches ? e.touches[0] : e;
  var x = pt.clientX, y = pt.clientY;
  // Déplacer le clone
  _wgDrag.clone.style.top = (y - _wgDrag.offsetY) + 'px';
  _wgDrag.clone.style.left = (x - (_wgDrag.clone.offsetWidth/2)) + 'px';
  // Trouver la cible la plus proche
  var els = document.querySelectorAll('.wg-card-wrap');
  var closest = null, closestDist = Infinity;
  els.forEach(function(el){
    if(el.dataset.wid === _wgDrag.id) return;
    var r = el.getBoundingClientRect();
    var mid = r.top + r.height/2;
    var dist = Math.abs(y - mid);
    if(dist < closestDist){ closestDist = dist; closest = el; }
  });
  // Highlight cible
  document.querySelectorAll('.wg-drag-over').forEach(function(el){ el.classList.remove('wg-drag-over'); });
  if(closest && closestDist < 80){
    closest.classList.add('wg-drag-over');
    _wgDrag.lastTarget = closest.dataset.wid;
  } else {
    _wgDrag.lastTarget = null;
  }
}

function wgDragEnd(e){
  if(!_wgDrag) return;
  // Retirer le clone
  if(_wgDrag.clone) _wgDrag.clone.remove();
  if(_wgDrag.card) _wgDrag.card.style.opacity = '';
  document.querySelectorAll('.wg-drag-over').forEach(function(el){ el.classList.remove('wg-drag-over'); });
  // Appliquer le réordonnement si une cible était sélectionnée
  if(_wgDrag.lastTarget){
    var list = wgGet();
    var fromIdx = list.findIndex(function(w){ return w.id===_wgDrag.id; });
    var toIdx = list.findIndex(function(w){ return w.id===_wgDrag.lastTarget; });
    if(fromIdx>=0 && toIdx>=0 && fromIdx!==toIdx){
      var item = list.splice(fromIdx,1)[0];
      list.splice(toIdx,0,item);
      wgSave(list);
      renderMain();
      appVibrate([40]);
    }
  }
  _wgDrag = null;
}

// ── Render individuel par type ─────────────────────
function wgGoto(id){ return ' onclick="goTo(\''+id+'\')" style="cursor:pointer"'; }
function wgGotoScroll(el){ var sc=el.dataset.scroll; if(sc){setTimeout(function(){var t=document.getElementById(sc);if(t)t.scrollIntoView({behavior:'smooth',block:'start'});},120);} }

function _wgRenderOne(w){
  var id=w.id, t=today();

  if(id==='enc') return renderQuickEnc();

  // Widget par service de distribution (id = 'd_svcId')
  if(id.slice(0,2)==='d_'){
    // id = 'd_{svcId}_{slot}' ex: 'd_up_midi'
    var parts3 = id.slice(2).split('_');
    var slot3 = parts3[parts3.length-1]; // 'midi' ou 'soir'
    var svcId = parts3.slice(0,-1).join('_'); // 'up' ou 'service_midi' sans le slot
    var svcs2 = getDistribServices();
    var svc = svcs2.find(function(s){ return s.id===svcId; });
    if(!svc) return '';
    var draft2 = distribDraft();
    var todayStr2 = today();
    // Vérifier que le draft est bien d'AUJOURD'HUI (pas celui de la veille)
    var draftIsToday = draft2.date === todayStr2;
    var done = draftIsToday && draft2[slot3+'_valide']==='OUI';
    var tF = (draftIsToday && draft2[slot3+'_froid_temp']) ? parseFloat(draft2[slot3+'_froid_temp']).toFixed(1)+'°' : '—';
    var tC = (draftIsToday && draft2[slot3+'_chaud_temp']) ? parseFloat(draft2[slot3+'_chaud_temp']).toFixed(1)+'°' : '—';
    var platF = draftIsToday ? draft2[slot3+'_froid_plat'] || '' : '';
    var platC = draftIsToday ? draft2[slot3+'_chaud_plat'] || '' : '';
    var confF = draftIsToday ? distribTempConf(draft2[slot3+'_froid_temp'],'froid') : 'nd';
    var confC = draftIsToday ? distribTempConf(draft2[slot3+'_chaud_temp'],'chaud') : 'nd';
    var cls = done ? 'wc-ok' : (confF==='nc'||confC==='nc') ? 'wc-danger' : 'wc-warn';
    var slotLabel3 = slot3==='midi'?'🌞 Midi':'🌙 Soir';
    var scrollId3 = 'dsvc-slot-'+svcId+'-'+slot3;
    if(done){
      return '<div class="wc wc-ok" onclick="goTo(\'enr_distrib_'+svcId+'\',\''+scrollId3+'\')" style="cursor:pointer">'
        +'<span class="wc-ico">'+(svc.ico||'🍽️')+'</span>'
        +'<div class="wc-label">'+escH(svc.label)+'</div>'
        +'<div style="font-size:.65rem;font-weight:800;color:'+(slot3==='midi'?'#d97706':'#4338ca')+';margin-top:-2px;margin-bottom:4px">'+slotLabel3+'</div>'
        +'<div class="wc-val ok">✓ Validé</div>'
        +'<span class="wc-arrow">›</span></div>';
    }
    var scrollId3='dsvc-slot-'+svcId+'-'+slot3;
    return '<div class="wc '+cls+'" onclick="goTo(\'enr_distrib_'+svcId+'\',\''+scrollId3+'\')" style="cursor:pointer">'  
      +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">'
      +'<span style="font-size:1.1rem">'+(svc.ico||'🍽️')+'</span>'
      +'<div style="flex:1;min-width:0">'
      +'<div style="font-size:.78rem;font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+svc.label+'</div>'
      +'<div style="font-size:.63rem;font-weight:800;color:'+(slot3==='midi'?'#d97706':'#4338ca')+'">'+slotLabel3+'</div>'
      +'</div>'
      +'<span style="font-size:.75rem;color:#b89ab6">›</span>'
      +'</div>'
      +'<div style="display:flex;gap:6px">'
      +'<div style="flex:1;background:'+(confF==='nc'?'#fee2e2':confF==='ok'?'#dcfce7':'var(--fond)')+';border-radius:8px;padding:6px 8px;text-align:center">'
      +'<div style="font-size:.58rem;font-weight:700;color:#b89ab6;text-transform:uppercase;letter-spacing:.3px">❄️ Froid</div>'
      +'<div style="font-size:.95rem;font-weight:900;color:'+(confF==='nc'?'#991b1b':confF==='ok'?'#166534':'#b89ab6')+'">'+tF+'</div>'
      +(platF?'<div style="font-size:.6rem;color:#b89ab6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+platF+'</div>':'')
      +'</div>'
      +'<div style="flex:1;background:'+(confC==='nc'?'#fee2e2':confC==='ok'?'#dcfce7':'var(--fond)')+';border-radius:8px;padding:6px 8px;text-align:center">'
      +'<div style="font-size:.58rem;font-weight:700;color:#b89ab6;text-transform:uppercase;letter-spacing:.3px">🔥 Chaud</div>'
      +'<div style="font-size:.95rem;font-weight:900;color:'+(confC==='nc'?'#991b1b':confC==='ok'?'#166534':'#b89ab6')+'">'+tC+'</div>'
      +(platC?'<div style="font-size:.6rem;color:#b89ab6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+platC+'</div>':'')
      +'</div>'
      +'</div>'
      +'</div>';
  }

  if(id==='refroid'){
    // Timers actifs
    var timerKeys = Object.keys(_ccpTimers||{});
    // Lignes ENR01 en attente aujourd'hui
    var attente = ((S['enr01']&&S['enr01'].lignes)||[]).filter(function(r){
      return r.date===t && (!r._statut||r._statut==='en_attente');
    });
    var nbTimer = timerKeys.length, nbAttente = attente.length;
    var hasData = nbTimer>0||nbAttente>0;
    var cls = nbTimer>0?'wc-warn':nbAttente>0?'wc-idle':'wc-ok';

    // Lignes timers
    var timerRows = timerKeys.map(function(k){
      var ti = _ccpTimers[k];
      if(!ti||!ti.start) return '';
      var elapsedMin = Math.floor((Date.now()-ti.start)/60000);
      var maxMin = ti.maxMin||120;
      var restant = maxMin - elapsedMin;
      var isDepasse = elapsedMin >= maxMin;
      var pct = Math.min(100, Math.round(elapsedMin/maxMin*100));
      var col = isDepasse?'#dc2626':elapsedMin>=maxMin*0.75?'#f97316':'#2563eb';
      var label = ti.label||k;
      return '<div style="padding:5px 0;border-bottom:1px solid var(--brd)">'
        +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">'
        +'<span style="font-size:.8rem;font-weight:800;flex:1;color:var(--gris)">'+label+'</span>'
        +'<span style="font-size:.75rem;font-weight:900;color:'+col+'">'
        +(isDepasse?'⚠️ +'+Math.abs(restant)+' min dépassé':restant+' min restant')
        +'</span></div>'
        +'<div style="height:5px;background:#e8d8e8;border-radius:3px;overflow:hidden">'
        +'<div style="height:100%;width:'+pct+'%;background:'+col+';border-radius:3px;transition:.5s"></div>'
        +'</div></div>';
    }).join('');

    // Lignes en attente (sans timer)
    var attenteRows = attente.slice(0,3).map(function(r){
      var prod = r.produit||r.plat||'Plat';
      var hDeb = r.h_ref_deb||r.h_pref_deb||'';
      var elapsed = '';
      if(hDeb){
        var parts = hDeb.split(':');
        var now2 = new Date();
        var debMs = new Date(now2.getFullYear(),now2.getMonth(),now2.getDate(),+parts[0],+parts[1]).getTime();
        var elMin = Math.floor((Date.now()-debMs)/60000);
        if(elMin>=0) elapsed = ' · '+elMin+' min';
      }
      return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--brd)">'
        +'<span style="font-size:.88rem">⏳</span>'
        +'<span style="font-size:.8rem;font-weight:700;flex:1">'+prod+'</span>'
        +'<span style="font-size:.72rem;color:#92400e;font-weight:700">En attente'+elapsed+'</span>'
        +'</div>';
    }).join('');

    if(!hasData) return '<div class="wc wc-ok"'+wgGoto('enr01')+'>'
      +'<span class="wc-ico">❄️</span>'
      +'<div class="wc-label">Refroidissements</div>'
      +'<div class="wc-val ok">Aucun en cours ✓</div>'
      +'<div class="wc-sub">Tap pour saisir</div>'
      +'<span class="wc-arrow">›</span></div>';

    return '<div class="wc" style="padding:0"'+wgGoto('enr01')+'>'
      +'<div style="padding:12px 14px 8px;display:flex;align-items:center;gap:8px">'
      +'<span style="font-size:1.2rem">❄️</span>'
      +'<span style="font-size:.78rem;font-weight:900">Refroidissements</span>'
      +(nbTimer>0?'<span style="font-size:.65rem;font-weight:800;background:#dbeafe;color:#1e3a8a;padding:2px 7px;border-radius:8px;margin-left:4px">'+nbTimer+' timer'+(nbTimer>1?'s':'')+'</span>':'')
      +(nbAttente>0?'<span style="font-size:.65rem;font-weight:800;background:#fef3c7;color:#92400e;padding:2px 7px;border-radius:8px;margin-left:4px">'+nbAttente+' attente</span>':'')
      +'<span style="font-size:.75rem;color:#b89ab6;margin-left:auto">›</span>'
      +'</div>'
      +'<div style="padding:0 14px 12px">'
      +(timerRows||attenteRows||'')
      +'</div></div>';
  }

  if(id==='recep'){
    var lignes=(S['enr23']&&S['enr23'].lignes||[]).filter(function(r){return r.date===t;});
    var livraisons=fourcTodayDeliveries();
    var nb=lignes.length, attendus=livraisons.length;
    var cls=nb===0&&attendus>0?'wc-warn':nb>0?'wc-ok':'wc-idle';
    var val=nb>0?nb+' contrôlée'+(nb>1?'s':''):'Aucune';
    var sub=attendus>0?attendus+' fournisseur'+(attendus>1?'s':'')+' attendu'+(attendus>1?'s':''):'Tap pour saisir';
    return '<div class="wc '+cls+'"'+wgGoto('enr23')+'>'
      +'<span class="wc-ico">📦</span>'
      +'<div class="wc-label">Réceptions</div>'
      +'<div class="wc-val '+(nb===0&&attendus>0?'warn':nb>0?'ok':'')+'">'+val+'</div>'
      +'<div class="wc-sub">'+sub+'</div>'
      +'<span class="wc-arrow">›</span></div>';
  }

  if(id==='nett'){
    var retards=nettRef().filter(function(it){return ['retard','nc'].includes(nettStatus(it));}).length;
    var valsJour=(S.nett_val||[]).filter(function(r){return r.date===t&&r.conforme==='OUI';}).length;
    var cls2=retards>0?'wc-danger':valsJour>0?'wc-ok':'wc-idle';
    var val2=retards>0?retards+' en retard':valsJour>0?valsJour+' validé'+(valsJour>1?'s':''):'—';
    return '<div class="wc '+cls2+'"'+wgGoto('enr28')+'>'
      +'<span class="wc-ico">🧹</span>'
      +'<div class="wc-label">Nettoyage</div>'
      +'<div class="wc-val '+(retards>0?'danger':valsJour>0?'ok':'')+'">'+val2+'</div>'
      +'<div class="wc-sub">Tap pour valider</div>'
      +'<span class="wc-arrow">›</span></div>';
  }

  if(id==='nc'){
    var ncTot=((S['enr30']&&S['enr30'].lignes)||[]).filter(function(r){return r.date===t;}).length;
    var ncOuv=((S['enr30']&&S['enr30'].lignes)||[]).filter(function(r){return r._auto===true&&r.cloture!=='OUI';}).length;
    var cls3=ncOuv>0?'wc-danger':ncTot>0?'wc-warn':'wc-ok';
    var val3=ncOuv>0?ncOuv+' à clôturer':ncTot>0?ncTot+' ce jour':'Aucune ✓';
    return '<div class="wc '+cls3+'"'+wgGoto('enr30')+'>'
      +'<span class="wc-ico">📋</span>'
      +'<div class="wc-label">Non-conformités</div>'
      +'<div class="wc-val '+(ncOuv>0?'danger':ncTot>0?'warn':'ok')+'">'+val3+'</div>'
      +'<div class="wc-sub">Tap pour ouvrir</div>'
      +'<span class="wc-arrow">›</span></div>';
  }

  if(id==='score') return renderScoreHACCP();
  if(id==='bilan') return renderBilanJour();
  if(id==='bilan_mois') return renderBilanMoisBtn();

  if(id==='etiq'){
    var etiqH=renderEtiqReminder();
    if(!etiqH) return '<div class="wc wc-ok"'+wgGoto('enr34')+'>'
      +'<span class="wc-ico">🏷️</span>'
      +'<div class="wc-label">Étiquetage</div>'
      +'<div class="wc-val ok">À jour ✓</div>'
      +'<span class="wc-arrow">›</span></div>';
    return '<div class="wc" style="padding:0"'+wgGoto('enr34')+'><div style="padding:10px 12px">'+etiqH+'</div></div>';
  }

  if(id==='notes') return renderNotes();
  if(id==='raccourcis') return accueilTaches();
  return '';
}

// ── Layout : groupe les half en paires ─────────────
function _wgRenderGrid(container, list){
  var out='', i=0;
  while(i<list.length){
    var w=list[i];
    var def=WG_CATALOG.find(function(d){return d.id===w.id;});
    var size=def?def.size:(w.id.slice(0,2)==='d_'?'half':'full');
    var c=_wgRenderOne(w);
    var eb='';
    if(_wgEditing){
      eb='<div class="wg-rm" data-wid="'+w.id+'" onclick="event.stopPropagation();wgRmById(this)" ontouchend="event.preventDefault();wgRmById(this)">✕</div>'
        +'<div class="wg-drag-handle" ontouchstart="wgDragStart(event,\''+w.id+'\')" ontouchmove="wgDragMove(event)" ontouchend="wgDragEnd(event)">☰</div>';
    }
    if(size==='half'){
      var nx=list[i+1];
      var nxd=nx?WG_CATALOG.find(function(d){return d.id===nx.id;}):null;
      if(nxd&&nxd.size==='half'){
        var cn=_wgRenderOne(nx);
        var ebn='';
        if(_wgEditing){
          ebn='<div class="wg-rm" data-wid="'+nx.id+'" onclick="event.stopPropagation();wgRmById(this)" ontouchend="event.preventDefault();wgRmById(this)">✕</div>'
            +'<div class="wg-drag-handle" ontouchstart="wgDragStart(event,\''+nx.id+'\')" ontouchmove="wgDragMove(event)" ontouchend="wgDragEnd(event)">☰</div>';
        }
        out+='<div class="wg-row">'
          +'<div class="wg-half wg-card-wrap" data-wid="'+w.id+'">'+(_wgEditing&&c?'<div style="position:relative">'+eb+c+'</div>':c)+'</div>'
          +'<div class="wg-half wg-card-wrap" data-wid="'+nx.id+'">'+(_wgEditing&&cn?'<div style="position:relative">'+ebn+cn+'</div>':cn)+'</div>'
          +'</div>';
        i+=2; continue;
      }
    }
    out+='<div class="wg-card-wrap" data-wid="'+w.id+'">'+(_wgEditing&&c?'<div style="position:relative">'+eb+c+'</div>':c)+'</div>';
    i++;
  }
  if(_wgEditing) out+='<button class="wg-add-btn" onclick="wgCatalogOpen()">➕ Ajouter un widget</button>';
  if(container) container.innerHTML=out;
  return out;
}

// ── Render principal accueil ───────────────────────
function renderHomeWidgets(){
  var list = wgGet();
  var editBar = _wgEditing
    ? '<div class="wg-edit-bar"><div><div class="wg-edit-title">✏️ Mode édition</div><div style="font-size:.68rem;opacity:.8">Maintenez ☰ pour déplacer</div></div><button class="wg-edit-done" onclick="wgToggleEdit()">✓ Terminer</button></div>'
    : '';
  var emptyHint = (!list.length)
    ? '<div style="text-align:center;padding:20px 16px;color:var(--gris2)">'
      +'<div style="font-size:2rem;margin-bottom:8px">🧩</div>'
      +'<div style="font-size:.82rem;font-weight:700;margin-bottom:12px">Aucun widget — appuyez pour en ajouter</div>'
      +'<button onclick="wgCatalogOpen()" style="padding:10px 20px;background:var(--plum);color:#fff;border:none;border-radius:12px;font-size:.82rem;font-weight:800;cursor:pointer;font-family:inherit">➕ Ajouter un widget</button>'
      +'</div>'
    : '';
  var editToggle = (!_wgEditing && list.length)
    ? '<div style="text-align:right;padding:0 4px 6px"><button onclick="wgToggleEdit()" style="background:none;border:none;color:var(--gris2);font-size:.65rem;cursor:pointer;font-family:inherit">✏️ Modifier</button></div>'
    : '';
  return editBar + editToggle + '<div class="wg-grid" id="wg-grid" '
    +'onmousedown="wgStartLongPress(event)" ontouchstart="wgStartLongPress(event)" '
    +'onmouseup="wgCancelLongPress()" ontouchend="wgCancelLongPress()" ontouchmove="wgCancelLongPress()">'
    + (list.length ? _wgRenderGrid(null, list) : emptyHint)
    +'</div>';
}

init();

  
