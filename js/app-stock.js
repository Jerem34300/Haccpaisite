/* ════════════════════════════════════════════════════════════════════
 * app-stock.js — Module STOCK (v488)
 * Scan du bon de livraison (BL) → confirmation ligne par ligne → stock en UNITÉS.
 *  - S.stock.lignes      : réceptions BL validées (enr_type 'stock', 1 enregistrement par BL)
 *  - S.stock_mvt.lignes  : mouvements append-only (entame / fini / correction / bloque…)
 *    → jamais de modification ni suppression sans trace (qui / quand / pourquoi).
 * Sync : SupaEngine.enqueue (pms_records), rechargé par le cas général de _loadFromSupabase,
 * purgé au changement de site (liste PURGE_SAISIES d'app-cuisine.js).
 * Chargé APRÈS app-cuisine.js (utilise S, save, toast, REND, ALL, renderMain…).
 * ════════════════════════════════════════════════════════════════════ */
var STK_SEC = 'stock';
var STK_MVT = 'stock_mvt';
var _stk = { pages: [], draft: null, q: '', busy: false, view: [], resume: null, resumeChecked: false };

(function stkInit(){
  try {
    if (typeof ALL !== 'undefined' && !ALL.some(function(s){ return s.id === 'stock'; })) {
      // Inséré juste après l'accueil ; fixed → toujours visible (pas de filtre tenant)
      ALL.splice(1, 0, { id: 'stock', short: '📦 Stock', label: 'Stock — Réceptions BL', cat: 'nav', fixed: true });
    }
    if (typeof REND !== 'undefined') REND['stock'] = function(){ try { return stkRender(); } catch(e){ console.warn('[stock] render', e); return '<div class="card">⚠️ Erreur d\'affichage du stock</div>'; } };
  } catch(e){ try{ console.warn('[stock] init', e); }catch(_e){} }
  try {
    var st = document.createElement('style');
    st.textContent = [
      '.stk-h{font-weight:900;color:#5C1E5A;font-size:1rem;margin:2px 0 6px}',
      '.stk-sub{font-size:.74rem;color:#7a6378}',
      '.stk-lock{background:#f3e8f7;color:#5C1E5A;border-radius:10px;padding:8px 10px;font-size:.78rem;font-weight:700;margin:8px 0}',
      '.stk-btn{border:1.5px solid #d9c6dc;background:#fff;color:#5C1E5A;border-radius:10px;padding:9px 12px;font-weight:800;font-size:.82rem;cursor:pointer;font-family:inherit}',
      '.stk-btn.big{width:100%;padding:12px;font-size:.95rem}',
      '.stk-btn.pri{background:#5C1E5A;color:#fff;border-color:#5C1E5A}',
      '.stk-btn.ok{background:#16a34a;color:#fff;border-color:#16a34a}',
      '.stk-btn[disabled]{opacity:.45;pointer-events:none}',
      '.stk-line{border:1.5px solid #eadcec;border-radius:12px;padding:9px 10px;margin:7px 0;background:#fff}',
      '.stk-line.todo{border-color:#f59e0b;background:#fffbeb}',
      '.stk-line .nm{font-weight:800;font-size:.86rem;color:#2a1f29}',
      '.stk-line .mt{font-size:.72rem;color:#7a6378;margin-top:2px}',
      '.stk-3{display:flex;gap:6px;margin-top:7px}',
      '.stk-3 button{flex:1;border:1.5px solid #d9c6dc;background:#fff;border-radius:9px;padding:7px 4px;font-weight:800;font-size:.76rem;cursor:pointer;font-family:inherit;color:#5C1E5A}',
      '.stk-3 button.on-r{background:#16a34a;border-color:#16a34a;color:#fff}',
      '.stk-3 button.on-m{background:#6b7280;border-color:#6b7280;color:#fff}',
      '.stk-3 button.on-x{background:#dc2626;border-color:#dc2626;color:#fff}',
      '.stk-chip{display:inline-block;border-radius:20px;padding:2px 8px;font-size:.7rem;font-weight:800;margin:2px 4px 2px 0}',
      '.stk-chip.ent{background:#ffedd5;color:#9a3412}.stk-chip.neuf{background:#dcfce7;color:#166534}',
      '.stk-chip.dlc{background:#fef3c7;color:#92400e}.stk-chip.exp{background:#fee2e2;color:#991b1b}.stk-chip.blk{background:#fee2e2;color:#991b1b}',
      '.stk-pages{display:flex;gap:8px;overflow-x:auto;padding:6px 0}',
      '.stk-pg{position:relative;flex:0 0 auto}',
      '.stk-pg img{width:74px;height:98px;object-fit:cover;border-radius:8px;border:1.5px solid #d9c6dc}',
      '.stk-pg b{position:absolute;left:4px;top:4px;background:#5C1E5A;color:#fff;border-radius:10px;font-size:.62rem;padding:1px 6px}',
      '.stk-pg button{position:absolute;right:2px;top:2px;border:none;background:#fff;border-radius:50%;width:20px;height:20px;font-size:.7rem;cursor:pointer}',
      '.stk-in{width:100%;box-sizing:border-box;border:1.5px solid #d9c6dc;border-radius:9px;padding:7px 9px;font-size:.84rem;font-family:inherit}',
      '.stk-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px}',
      '.stk-item{display:flex;gap:10px;align-items:flex-start}',
      '.stk-act{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}',
      '.stk-act button{border:1.5px solid #d9c6dc;background:#fff;color:#5C1E5A;border-radius:9px;padding:6px 10px;font-weight:800;font-size:.76rem;cursor:pointer;font-family:inherit}'
    ].join('\n');
    document.head.appendChild(st);
  } catch(e){ try{ console.warn('[stock] css', e); }catch(_e){} }
})();

// ── Utilitaires ─────────────────────────────────────────────────────
function _stkE(s){ try { return (typeof escH === 'function') ? escH(s) : String(s||''); } catch(e){ return ''; } }
function _stkA(s){ try { return (typeof escAttr === 'function') ? escAttr(s) : String(s||''); } catch(e){ return ''; } }
function _stkToday(){ try { return today(); } catch(e){ return new Date().toISOString().slice(0,10); } }
function _stkHM(d){ d = d || new Date(); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
function _stkFr(ymd){ try { var m = String(ymd||'').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? (m[3]+'/'+m[2]) : String(ymd||''); } catch(e){ return ''; } }
function _stkFrY(ymd){ try { var m = String(ymd||'').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? (m[3]+'/'+m[2]+'/'+m[1]) : String(ymd||''); } catch(e){ return ''; } }
function _stkNorm(s){ try { return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim(); } catch(e){ return String(s||'').toLowerCase().trim(); } }
function _stkWho(){ try { return (typeof getActiveSession === 'function') ? getActiveSession() : null; } catch(e){ return null; } }
function _stkNeedWho(){
  var w = _stkWho();
  if (!w) {
    try { toast('👤 Choisis ton profil (bouton 👤 en haut à droite)','warning'); } catch(e){}
    try { if (typeof openSessModal === 'function') openSessModal(); } catch(e){ console.warn('[stock] profil', e); }
  }
  return w;
}
function _stkBls(){ try { return ((S[STK_SEC]||{}).lignes||[]).filter(function(r){ return r && !r._deleted; }); } catch(e){ return []; } }
function _stkMvts(){ try { return ((S[STK_MVT]||{}).lignes||[]).filter(function(r){ return r && !r._deleted; }); } catch(e){ return []; } }
function _stkRefresh(){ stkPersist(); try { if (typeof cur !== 'undefined' && cur === 'stock') renderMain(); } catch(e){ console.warn('[stock] refresh', e); } }
// ── Brouillon de réception persistant (IndexedDB : photos trop lourdes pour localStorage) ──
// Survit à un rechargement, à la fermeture iOS ou à une mise à jour du service worker.
var STK_IDB = 'haccpro_stock', STK_IDB_KEY = 'bl_draft';
function _stkIdb(){
  return new Promise(function(res, rej){
    try {
      var rq = indexedDB.open(STK_IDB, 1);
      rq.onupgradeneeded = function(){ try { rq.result.createObjectStore('kv'); } catch(e){} };
      rq.onsuccess = function(){ res(rq.result); };
      rq.onerror = function(){ rej(rq.error); };
    } catch(e){ rej(e); }
  });
}
function _stkSiteKey(){ try { var c = JSON.parse(localStorage.getItem('haccpro_supa_cfg')||localStorage.getItem('haccp_supa_cfg_v1')||'{}'); return String(c.siteId||c.site_id||''); } catch(e){ return ''; } }
var _stkPersistT = null;
function stkPersist(){
  try {
    if (_stkPersistT) clearTimeout(_stkPersistT);
    if (_stk.resume) return; // brouillon en attente de « Reprendre / Abandonner » : ne pas l'écraser
    _stkPersistT = setTimeout(function(){
      _stkIdb().then(function(db){
        try {
          var tx = db.transaction('kv', 'readwrite'), st = tx.objectStore('kv');
          if (!_stk.draft && !_stk.pages.length) st.delete(STK_IDB_KEY);
          else st.put({ draft: _stk.draft, pages: _stk.pages, site: _stkSiteKey(), who: _stkWho()||'', ts: new Date().toISOString() }, STK_IDB_KEY);
        } catch(e){ console.warn('[stock] persist', e); }
      }).catch(function(e){ console.warn('[stock] idb', e); });
    }, 250);
  } catch(e){ console.warn('[stock] persist', e); }
}
function _stkLoadPersisted(){
  return _stkIdb().then(function(db){
    return new Promise(function(res){
      try { var rq = db.transaction('kv','readonly').objectStore('kv').get(STK_IDB_KEY); rq.onsuccess = function(){ res(rq.result||null); }; rq.onerror = function(){ res(null); }; }
      catch(e){ res(null); }
    });
  }).catch(function(){ return null; });
}
function _stkCheckResume(){
  try {
    if (_stk.resumeChecked || _stk.draft || _stk.pages.length) return;
    _stk.resumeChecked = true;
    _stkLoadPersisted().then(function(d){
      try {
        if (!d || (!d.draft && !(d.pages||[]).length)) return;
        if (d.site && _stkSiteKey() && d.site !== _stkSiteKey()) return; // jamais d'un site à l'autre
        _stk.resume = d;
        if (typeof cur !== 'undefined' && cur === 'stock') renderMain();
      } catch(e){ console.warn('[stock] resume', e); }
    });
  } catch(e){ console.warn('[stock] checkResume', e); }
}
function stkResume(){
  try {
    var d = _stk.resume; if (!d) return;
    _stk.draft = d.draft || null; _stk.pages = d.pages || []; _stk.resume = null;
    _stkRefresh(); window.scrollTo(0,0);
  } catch(e){ console.warn('[stock] resume', e); }
}
/** Abandon d'une réception en cours : rien en stock, mais trace (qui / quand / quoi). */
function _stkTraceAbandon(d, pages, motif){
  try {
    var now = new Date();
    var row = { _ts: now.toISOString(), _sec: STK_MVT, date: _stkToday(), heure: _stkHM(now), type: 'abandon_bl', item_id: '',
      fournisseur: (d && d.fournisseur) || '', bl_numero: (d && d.numero) || '', nb_lignes: d && d.lignes ? d.lignes.length : 0,
      pages: pages || 0, motif: motif || 'Réception abandonnée avant validation', cuisinier: _stkWho() || '' };
    _stkPush(STK_MVT, row);
  } catch(e){ console.warn('[stock] trace abandon', e); }
}
function stkAbandonResume(){
  try {
    var d = _stk.resume; if (!d) return;
    if (!_stkNeedWho()) return;
    showConfirm('Abandonner la réception en cours ?', 'Rien n\'entrera en stock. L\'abandon est tracé à ton nom.', 'Abandonner', function(){
      try { _stkTraceAbandon(d.draft, (d.draft && d.draft.pages ? d.draft.pages.length : (d.pages||[]).length)); _stk.resume = null; _stk.draft = null; _stk.pages = []; _stkRefresh(); toast('Réception abandonnée (tracée)','success'); }
      catch(e){ console.warn('[stock] abandonResume', e); }
    });
  } catch(e){ console.warn('[stock] abandonResume', e); }
}
function _stkPush(sec, row){
  try {
    S[sec] = S[sec] || {};
    S[sec].lignes = Array.isArray(S[sec].lignes) ? S[sec].lignes : [];
    S[sec].lignes.unshift(stampEntry(row));
    save();
    try { SupaEngine.enqueue(sec, row); } catch(e){ console.warn('[stock] sync '+sec, e); }
    return row;
  } catch(e){ console.warn('[stock] push', e); return null; }
}
/** Lot par défaut d'un produit frais sans lot : fournisseur + n° BL + date */
function stkLotFromBl(f, num, date){
  try { return ('BL ' + String(f||'').replace(/\s*\(.*?\)\s*/g,' ').trim().split(' ').slice(0,2).join(' ') + ' ' + (num||'') + ' ' + _stkFr(date)).replace(/\s+/g,' ').trim(); } catch(e){ return 'BL'; }
}

// ── Modèle : items de stock dérivés des BL + mouvements ─────────────
function stkItems(){
  var items = [], byId = {};
  try {
    _stkBls().forEach(function(bl){
      (bl.lignes_bl||[]).forEach(function(l, i){
        if (!l || l.statut !== 'recu') return;
        var it = {
          id: (bl._ts||'') + '#' + i, bl_ts: bl._ts, bl_numero: bl.numero||'', fournisseur: bl.fournisseur||'',
          date_rec: bl.date_reception || bl.date || '', bl_date: bl.date || '',
          produit: l.produit||'', conditionnement: l.conditionnement||'', unite: l.unite||'',
          lot: l.lot||'', lot_auto: !!l.lot_auto, dlc: l.dlc||'', dlc_type: l.dlc_type||'',
          qte: Math.max(0, parseInt(l.qte,10)||0), sans_etiquette: !!l.sans_etiquette,
          ouverts: [], fin_ent: 0, fin_neuf: 0, corr: 0, bloque: false, bloque_motif: ''
        };
        items.push(it); byId[it.id] = it;
      });
    });
    _stkMvts().slice().sort(function(a,b){ return String(a._ts).localeCompare(String(b._ts)); }).forEach(function(m){
      var it = byId[m.item_id]; if (!it) return;
      var n = Math.max(1, parseInt(m.n,10)||1);
      if (m.type === 'entame') { for (var k=0;k<n;k++) it.ouverts.push(m.date||String(m._ts||'').slice(0,10)); if (m.lot_lu && !it.lot_lu) it.lot_lu = m.lot_lu; if (m.dlc_lue) it.dlc_lue = m.dlc_lue; }
      else if (m.type === 'fini') { if (m.from === 'neuf') it.fin_neuf += n; else { it.fin_ent += n; it.ouverts.splice(0, n); } }
      else if (m.type === 'lecture_etiquette') { if (m.lot_lu) it.lot_lu = m.lot_lu; if (m.dlc_lue) it.dlc_lue = m.dlc_lue; }
      else if (m.type === 'correction') { it.corr += (parseInt(m.delta,10)||0); }
      else if (m.type === 'bloque') { it.bloque = true; it.bloque_motif = m.motif||''; }
      else if (m.type === 'debloque') { it.bloque = false; }
    });
    items.forEach(function(it){
      it.entames = it.ouverts.length;
      it.neufs = Math.max(0, it.qte + it.corr - it.entames - it.fin_ent - it.fin_neuf);
      it.dispo = it.neufs + it.entames;
    });
  } catch(e){ console.warn('[stock] items', e); }
  return items;
}
/** Regroupe par produit + lot (même lot sur 2 livraisons = 2 items distincts dans le groupe). */
function stkGroups(items){
  var g = {}, out = [];
  try {
    (items||stkItems()).forEach(function(it){
      var k = _stkNorm(it.produit) + '|' + _stkNorm(it.lot);
      if (!g[k]) { g[k] = { key: k, produit: it.produit, lot: it.lot, lot_auto: it.lot_auto, items: [] }; out.push(g[k]); }
      g[k].items.push(it);
    });
    out.forEach(function(G){
      G.items.sort(function(a,b){ return String(a.date_rec).localeCompare(String(b.date_rec)) || String(a.bl_ts).localeCompare(String(b.bl_ts)); });
      G.entames = G.items.reduce(function(s,i){ return s+i.entames; },0);
      G.neufs = G.items.reduce(function(s,i){ return s+i.neufs; },0);
      G.dispo = G.entames + G.neufs;
      G.bloque = G.items.some(function(i){ return i.bloque; });
      var dl = G.items.filter(function(i){ return i.dispo>0 && i.dlc; }).map(function(i){ return i.dlc; }).sort();
      G.dlc = dl[0] || '';
      G.ouvert_le = G.items.reduce(function(a,i){ return a.concat(i.ouverts); },[]).sort()[0] || '';
    });
    // Tri : entamés d'abord, puis DLC la plus proche
    out.sort(function(a,b){
      if ((b.entames>0) !== (a.entames>0)) return (b.entames>0) - (a.entames>0);
      if (a.dlc && b.dlc) return a.dlc.localeCompare(b.dlc);
      if (a.dlc) return -1; if (b.dlc) return 1;
      return String(a.produit).localeCompare(String(b.produit));
    });
  } catch(e){ console.warn('[stock] groups', e); }
  return out;
}
function _stkDlcChip(dlc){
  try {
    if (!dlc) return '';
    var t = _stkToday();
    var d1 = new Date(dlc+'T12:00'), d0 = new Date(t+'T12:00');
    var j = Math.round((d1 - d0) / 86400000);
    if (j < 0) return '<span class="stk-chip exp">⛔ DLC dépassée ('+_stkFr(dlc)+')</span>';
    if (j === 0) return '<span class="stk-chip exp">⚠️ DLC aujourd\'hui</span>';
    if (j === 1) return '<span class="stk-chip dlc">⚠️ DLC demain</span>';
    if (j <= 3) return '<span class="stk-chip dlc">DLC '+_stkFr(dlc)+'</span>';
    return '';
  } catch(e){ return ''; }
}

// ── Rendu principal ─────────────────────────────────────────────────
function stkRender(){
  if (_stk.draft) return stkRenderConfirm();
  _stkCheckResume();
  var h = '';
  if (_stk.resume) {
    var rd = _stk.resume.draft, np = rd ? (rd.pages||[]).length : (_stk.resume.pages||[]).length;
    h += '<div class="card" style="border:2px solid #f59e0b;background:#fffbeb"><div class="stk-h">⏸️ Réception en cours non validée</div>'
      + '<div class="stk-sub">'+(rd ? ('BL '+_stkE(rd.fournisseur||'…')+' '+_stkE(rd.numero||'')+' · '+(rd.lignes||[]).length+' ligne(s) · ') : '')+np+' page(s) · '+_stkE(_stk.resume.who||'')+' '+_stkFr(String(_stk.resume.ts||'').slice(0,10))+'</div>'
      + '<button class="stk-btn ok big" style="margin-top:8px" onclick="stkResume()">▶️ Reprendre la réception en cours</button>'
      + '<button class="stk-btn big" style="margin-top:6px" onclick="stkAbandonResume()">Abandonner</button></div>';
  }
  // Scan BL
  h += '<div class="card"><div class="stk-h">📄 Nouvelle réception</div>'
    + '<div class="stk-sub">Photographie le bon de livraison (plusieurs pages possibles, gardées dans l\'ordre).</div>'
    + '<div style="display:flex;gap:8px;margin-top:8px">'
    + '<button class="stk-btn pri" style="flex:1" onclick="stkPick(\'camera\')">📷 Caméra</button>'
    + '<button class="stk-btn" style="flex:1" onclick="stkPick(\'gallery\')">🖼️ Galerie</button></div>';
  if (_stk.pages.length) {
    h += '<div class="stk-pages">' + _stk.pages.map(function(p, i){
      return '<div class="stk-pg"><img src="'+_stkA(p)+'" alt="Page '+(i+1)+'"><b>p.'+(i+1)+'</b><button onclick="stkDelPage('+i+')" aria-label="Retirer">✕</button></div>';
    }).join('') + '</div>'
      + '<button class="stk-btn ok big" onclick="stkAnalyse()">📖 Lire le bon de livraison ('+_stk.pages.length+' page'+(_stk.pages.length>1?'s':'')+')</button>';
  }
  h += '<div style="margin-top:8px;text-align:right"><button class="stk-btn" style="font-size:.74rem;padding:6px 10px" onclick="stkManual()">✍️ Saisie sans photo</button></div></div>';
  // Stock
  var groups = stkGroups().filter(function(G){ return G.dispo > 0; });
  var q = _stkNorm(_stk.q);
  if (q) groups = groups.filter(function(G){ return _stkNorm(G.produit+' '+G.lot+' '+G.items.map(function(i){ return i.fournisseur+' '+i.bl_numero; }).join(' ')).indexOf(q) >= 0; });
  h += '<div class="card"><div class="stk-h">📦 Stock cuisine</div>'
    + '<input class="stk-in" id="stk-q" placeholder="🔍 Rechercher un produit, un lot…" value="'+_stkA(_stk.q)+'" oninput="stkSearch(this.value)">'
    + '<div class="stk-sub" style="margin:6px 0">↕️ Entamés en premier, puis DLC la plus proche. Quantités en unités.</div>'
    + '<div id="stk-list">' + stkListHtml(groups) + '</div></div>';
  // Dernières réceptions (historique BL + photos)
  var bls = _stkBls().slice(0, 8);
  if (bls.length) {
    h += '<div class="card"><div class="stk-h">🧾 Dernières réceptions</div>' + bls.map(function(bl){
      var ph = ['photo','photo2','photo3','photo4','photo5','photo6'].map(function(k){ try { return bl[k] ? photoThumb(bl[k], '', true) : ''; } catch(e){ return ''; } }).join('');
      var refus = (bl.lignes_bl||[]).filter(function(l){ return l.statut==='refuse'; }).map(function(l){ return '⛔ '+_stkE(l.produit)+' — refusé'; });
      var manq = (bl.lignes_bl||[]).filter(function(l){ return l.statut==='manquant'; }).map(function(l){ return '✗ '+_stkE(l.produit)+' — manquant sur BL n° '+_stkE(bl.numero||'?'); });
      return '<div class="stk-line"><div class="nm">'+_stkE(bl.fournisseur||'Fournisseur ?')+' — BL '+_stkE(bl.numero||'?')+'</div>'
        + '<div class="mt">'+_stkFrY(bl.date)+' · reçu le '+_stkFr(bl.date_reception)+' '+_stkE(bl.heure||'')+' par '+_stkE(bl.cuisinier||'?')+' · '+_stkE(bl.resume||'')+'</div>'
        + (ph ? '<div style="display:flex;gap:6px;margin-top:6px">'+ph+'</div>' : '')
        + ((refus.length||manq.length) ? '<div class="mt" style="color:#991b1b">'+refus.concat(manq).join('<br>')+'</div>' : '')
        + '</div>';
    }).join('') + '</div>';
  }
  return h;
}
function stkListHtml(groups){
  try {
    _stk.view = groups; // handlers par index (jamais de texte OCR/saisi dans un onclick)
    if (!groups.length) return '<div class="empty-s">Aucun produit en stock.<br><small>Scanne un bon de livraison pour commencer.</small></div>';
    return groups.map(function(G, gi){
      var recs = G.items.map(function(i){ return _stkFr(i.date_rec); }).filter(function(v,i,a){ return a.indexOf(v)===i; });
      var src = G.lot_auto ? (_stkE(G.items[0].fournisseur)+' · sans lot (BL du '+_stkFr(G.items[0].bl_date)+')')
        : ('Lot '+_stkE(G.lot||'—')+' · reçu le '+recs.join(' et le '));
      var chips = '';
      if (G.entames) chips += '<span class="stk-chip ent">🟠 '+G.entames+' entamé'+(G.entames>1?'s':'')+(G.ouvert_le?' (ouvert le '+_stkFr(G.ouvert_le)+')':'')+'</span>';
      if (G.neufs) chips += '<span class="stk-chip neuf">'+G.neufs+' neuf'+(G.neufs>1?'s':'')+'</span>';
      var dchip = _stkDlcChip(G.dlc);
      chips += dchip;
      if (G.bloque) chips += '<span class="stk-chip blk">⛔ Lot bloqué</span>';
      return '<div class="stk-line"'+(G.bloque?' style="border-color:#fca5a5;background:#fff5f5"':'')+'><div class="nm">'+_stkE(G.produit)+'</div>'
        + '<div class="mt">'+src+((G.dlc && !dchip)?' · DLC '+_stkFr(G.dlc):'')+(G.items.some(function(i){ return i.lot_lu && _stkNorm(i.lot_lu)!==_stkNorm(i.lot); })?' · lot étiquette '+_stkE(G.items.find(function(i){ return i.lot_lu; }).lot_lu):'')+'</div><div>'+chips+'</div>'
        + '<div class="stk-act">'
        + '<button onclick="stkGroupAct(\'entamer\','+gi+')">J\'entame</button>'
        + '<button onclick="stkGroupAct(\'fini\','+gi+')">Fini</button>'
        + '<button onclick="stkGroupAct(\'menu\','+gi+')" aria-label="Plus d\'actions" style="margin-left:auto">⋯</button>'
        + '</div></div>';
    }).join('');
  } catch(e){ console.warn('[stock] list', e); return ''; }
}
/** Actions de la liste par index (G.key n'apparaît jamais dans le HTML). */
var stkEntamerUI = function(key){ stkEntamer(key); };
function stkGroupAct(act, i){
  try {
    var G = (_stk.view||[])[i]; if (!G) return;
    if (act === 'entamer') stkEntamerUI(G.key);
    else if (act === 'fini') stkFini(G.key);
    else if (act === 'menu') _stkChoice(G.produit, '', [{ k: 'corr', html: '✏️ Corriger le stock (motif obligatoire)' }], function(o){ if (o.k === 'corr') stkCorriger(G.key); });
  } catch(e){ console.warn('[stock] groupAct', e); }
}
function stkSearch(v){
  try {
    _stk.q = String(v||'');
    var el = document.getElementById('stk-list');
    if (!el) return;
    var groups = stkGroups().filter(function(G){ return G.dispo > 0; });
    var q = _stkNorm(_stk.q);
    if (q) groups = groups.filter(function(G){ return _stkNorm(G.produit+' '+G.lot+' '+G.items.map(function(i){ return i.fournisseur+' '+i.bl_numero; }).join(' ')).indexOf(q) >= 0; });
    el.innerHTML = stkListHtml(groups);
  } catch(e){ console.warn('[stock] search', e); }
}

// ── Capture des pages du BL (caméra / galerie, multi-photos, ordre conservé) ──
function stkPick(source){
  try {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    if (source === 'camera') inp.setAttribute('capture', 'environment'); else inp.multiple = true;
    inp.style.display = 'none';
    inp.onchange = function(){ try { stkAddFiles(inp.files); } catch(e){ console.warn('[stock] files', e); } try { inp.remove(); } catch(e){} };
    document.body.appendChild(inp);
    inp.click();
  } catch(e){ console.warn('[stock] pick', e); try{ toast('⚠️ Impossible d\'ouvrir la capture','warning'); }catch(_e){} }
}
function stkAddFiles(files){
  try {
    // Ordre de sélection conservé (lecture séquentielle)
    var arr = Array.prototype.slice.call(files||[]).filter(function(f){ return f && /^image\//.test(f.type||'image/'); });
    if (!arr.length) return;
    if (_stk.pages.length + arr.length > 6) { toast('⚠️ 6 pages maximum par BL','warning'); arr = arr.slice(0, Math.max(0, 6 - _stk.pages.length)); }
    var i = 0;
    var next = function(){
      if (i >= arr.length) { _stkRefresh(); return; }
      var f = arr[i++];
      if (f.size > 25*1024*1024) { toast('⚠️ Photo trop lourde (max 25 Mo)','warning'); next(); return; }
      var rd = new FileReader();
      rd.onload = function(){
        var raw = String(rd.result||'');
        var p = (typeof _ocrCompressForUpload === 'function') ? _ocrCompressForUpload(raw, { maxSide: 1600 }) : Promise.resolve(raw);
        p.then(function(c){ _stk.pages.push(c || raw); next(); }).catch(function(){ _stk.pages.push(raw); next(); });
      };
      rd.onerror = function(){ next(); };
      rd.readAsDataURL(f);
    };
    next();
  } catch(e){ console.warn('[stock] addFiles', e); }
}
function stkDelPage(i){ try { _stk.pages.splice(i,1); _stkRefresh(); } catch(e){ console.warn('[stock] delPage', e); } }

/** Comme photoSave : { ref: JSON miniature 640 px, full: JPEG 2000 px q0.88 } */
function _stkPhotoPair(dataUrl){
  return new Promise(function(resolve){
    try {
      var img = new Image();
      img.onload = function(){
        try {
          var draw = function(maxW, maxH, q){
            var w = img.naturalWidth, h = img.naturalHeight;
            if (w > maxW) { h = Math.round(h*maxW/w); w = maxW; }
            if (maxH && h > maxH) { w = Math.round(w*maxH/h); h = maxH; }
            var c = document.createElement('canvas'); c.width = w; c.height = h;
            var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0,0,w,h); g.drawImage(img,0,0,w,h);
            var out = c.toDataURL('image/jpeg', q); try { c.width = c.height = 0; } catch(e){}
            return out;
          };
          resolve({ ref: JSON.stringify({ thumb: draw(640, 0, 0.72), file: '', date: _stkToday() }), full: draw(2000, 1500, 0.88) });
        } catch(e){ resolve(null); }
      };
      img.onerror = function(){ resolve(null); };
      img.src = dataUrl;
    } catch(e){ resolve(null); }
  });
}
/** Enqueue avec pleine résolution : _pendingPhotos prêté le temps de l'appel (enqueue est synchrone), puis restauré. */
function _stkPushWithPhotos(sec, row, fulls){
  var saved = {}, pend = (typeof _pendingPhotos !== 'undefined') ? _pendingPhotos : null;
  try {
    S[sec] = S[sec] || {};
    S[sec].lignes = Array.isArray(S[sec].lignes) ? S[sec].lignes : [];
    S[sec].lignes.unshift(stampEntry(row));
    save();
    try {
      if (pend && fulls) Object.keys(fulls).forEach(function(k){ saved[k] = pend[k]; pend[k] = fulls[k]; });
      SupaEngine.enqueue(sec, row);
    } catch(e){ console.warn('[stock] sync photos', e); }
    finally {
      try { if (pend && fulls) Object.keys(fulls).forEach(function(k){ if (saved[k] === undefined) delete pend[k]; else pend[k] = saved[k]; }); } catch(e){}
    }
    return row;
  } catch(e){ console.warn('[stock] pushPhotos', e); return null; }
}
/** Miniature lisible pour la preuve (même format que photoSave : JSON {thumb,file,date}). */
function _stkThumbRef(dataUrl, maxW){
  return new Promise(function(resolve){
    try {
      var img = new Image();
      img.onload = function(){
        try {
          var w = img.naturalWidth, h = img.naturalHeight, mw = maxW || 900;
          if (w > mw) { h = Math.round(h*mw/w); w = mw; }
          var c = document.createElement('canvas'); c.width = w; c.height = h;
          var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0,0,w,h); g.drawImage(img,0,0,w,h);
          resolve(JSON.stringify({ thumb: c.toDataURL('image/jpeg', 0.7), file: '', date: _stkToday() }));
        } catch(e){ resolve(''); }
      };
      img.onerror = function(){ resolve(''); };
      img.src = dataUrl;
    } catch(e){ resolve(''); }
  });
}

// ── Analyse via netlify/functions/bl-ocr ────────────────────────────
async function stkAnalyse(){
  if (_stk.busy || !_stk.pages.length) return;
  _stk.busy = true;
  try { haccShowWait({ icon: '📄', title: 'Lecture du bon de livraison…', sub: 'Rien n’entre en stock avant ta validation' }); } catch(e){}
  var res = null, err = '';
  try {
    var resp = await fetch('/.netlify/functions/bl-ocr', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: _stk.pages })
    });
    var data = null; try { data = await resp.json(); } catch(e){ data = null; }
    if (resp.ok && data && Array.isArray(data.lignes)) res = data;
    else err = (data && data.error) ? String(data.error).replace(/\bOCR\b/gi,'lecture') : ('Lecture impossible ('+resp.status+')');
  } catch(e){ err = 'Lecture indisponible (réseau)'; console.warn('[stock] analyse', e); }
  try { haccHideWait(); } catch(e){}
  _stk.busy = false;
  if (!res) { try { toast('⚠️ '+err+' — complète le BL à la main','warning'); } catch(e){} res = { fournisseur:'', numero:'', date:'', lignes:[] }; }
  stkOpenDraft(res);
}
function stkManual(){ stkOpenDraft({ fournisseur:'', numero:'', date:_stkToday(), lignes:[] }); }
function stkOpenDraft(res){
  try {
    _stk.resume = null;
    _stk.draft = {
      fournisseur: res.fournisseur||'', numero: res.numero||'', date: res.date||_stkToday(),
      pages: _stk.pages.slice(),
      lignes: (res.lignes||[]).map(function(l){ return {
        produit: l.produit||'', conditionnement: l.conditionnement||'', qte_texte: l.qte_texte||'',
        qte: Math.max(1, parseInt(l.qte,10)||1), unite: l.unite||'', lot: l.lot||'', dlc: l.dlc||'', dlc_type: l.dlc_type||'',
        statut: '', hors_bl: false, edit: false, sans_etiquette: !l.lot }; })
    };
    _stk.pages = [];
    // Fournisseur connu ? (calendrier fournisseurs) → nom canonique
    try {
      var fn = _stkNorm(_stk.draft.fournisseur).split(' ')[0];
      var f = fn && (getFournisseurs()||[]).find(function(x){ return _stkNorm(x.nom).indexOf(fn) === 0; });
      if (f) _stk.draft.fournisseur_id = f.id;
    } catch(e){}
    if (typeof cur !== 'undefined' && cur !== 'stock') goTo('stock'); else renderMain();
    window.scrollTo(0,0);
  } catch(e){ console.warn('[stock] draft', e); }
}

// ── Confirmation ligne par ligne ────────────────────────────────────
function stkRenderConfirm(){
  var d = _stk.draft, L = d.lignes;
  var nR = L.filter(function(l){ return l.statut==='recu'; }).length, nM = L.filter(function(l){ return l.statut==='manquant'; }).length,
      nX = L.filter(function(l){ return l.statut==='refuse'; }).length, nT = L.filter(function(l){ return !l.statut; }).length;
  var h = '<div class="card">'
    + '<div class="stk-h">BL '+_stkE(d.fournisseur||'…')+' — '+_stkFr(d.date)+' · '+(d.pages.length||0)+' page'+(d.pages.length>1?'s':'')+'</div>'
    + '<div class="stk-grid"><input class="stk-in" placeholder="Fournisseur" value="'+_stkA(d.fournisseur)+'" onchange="stkDraftSet(\'fournisseur\',this.value)">'
    + '<input class="stk-in" placeholder="N° BL" value="'+_stkA(d.numero)+'" onchange="stkDraftSet(\'numero\',this.value)"></div>'
    + '<div class="stk-grid"><input class="stk-in" type="date" value="'+_stkA(d.date)+'" onchange="stkDraftSet(\'date\',this.value)"><div class="stk-sub" style="align-self:center">Date du BL</div></div>'
    + (d.pages.length ? '<div class="stk-pages">'+d.pages.map(function(p,i){ return '<div class="stk-pg"><img src="'+_stkA(p)+'" onclick="try{photoFullscreen(this.src)}catch(e){}"><b>p.'+(i+1)+'</b></div>'; }).join('')+'</div>' : '')
    + '<div class="stk-lock">🔒 Rien n\'entre en stock avant validation</div>'
    + '<button class="stk-btn big" onclick="stkToutRecu()">✓ Tout reçu</button>';
  h += L.map(function(l, i){
    var meta = [l.conditionnement, (l.qte_texte||(l.qte+' u.')), l.lot?('lot '+l.lot):'sans lot', l.dlc?((l.dlc_type||'DLC')+' '+_stkFrY(l.dlc)):''].filter(Boolean).map(_stkE).join(' · ');
    var extra = '';
    if (l.statut === 'manquant') extra = '<div class="mt" style="color:#4b5563">Trace : manquant sur BL n° '+_stkE(d.numero||'?')+'</div>';
    if (l.statut === 'refuse') extra = '<div class="mt" style="color:#991b1b">Refusé — fiche non-conformité pré-remplie à la validation</div>';
    var edit = l.edit ? ('<div class="stk-grid">'
      + '<input class="stk-in" value="'+_stkA(l.produit)+'" placeholder="Produit" onchange="stkLineSet('+i+',\'produit\',this.value)">'
      + '<input class="stk-in" type="number" min="1" value="'+_stkA(l.qte)+'" placeholder="Unités" onchange="stkLineSet('+i+',\'qte\',this.value)">'
      + '<input class="stk-in" value="'+_stkA(l.lot)+'" placeholder="Lot" onchange="stkLineSet('+i+',\'lot\',this.value)">'
      + '<input class="stk-in" type="date" value="'+_stkA(l.dlc)+'" onchange="stkLineSet('+i+',\'dlc\',this.value)"></div>') : '';
    return '<div class="stk-line'+(l.statut?'':' todo')+'"><div style="display:flex;gap:6px"><div style="flex:1"><div class="nm">'+_stkE(l.produit||'(sans nom)')+(l.hors_bl?' <span class="stk-chip dlc">hors BL</span>':'')+'</div>'
      + '<div class="mt">'+meta+' · <b>'+l.qte+' unité'+(l.qte>1?'s':'')+' sur le BL</b></div>'
      + '<label class="mt" style="display:flex;align-items:center;gap:6px;margin-top:4px"><input type="checkbox" '+(l.sans_etiquette?'checked':'')+' onchange="stkLineSet('+i+',\'sans_etiquette\',this.checked)" style="width:18px;height:18px;accent-color:#5C1E5A"> Sans étiquette (pas de photo à l\'ouverture)</label></div>'
      + '<button class="stk-btn" style="padding:4px 8px;align-self:flex-start" onclick="stkLineEdit('+i+')" aria-label="Modifier">✏️</button></div>'
      + extra + edit
      + '<div class="stk-3"><button class="'+(l.statut==='recu'?'on-r':'')+'" onclick="stkLineStat('+i+',\'recu\')">✓ Reçu</button>'
      + '<button class="'+(l.statut==='manquant'?'on-m':'')+'" onclick="stkLineStat('+i+',\'manquant\')">✗ Manquant</button>'
      + '<button class="'+(l.statut==='refuse'?'on-x':'')+'" onclick="stkLineStat('+i+',\'refuse\')">⛔ Refusé</button></div></div>';
  }).join('');
  if (!L.length) h += '<div class="empty-s">Aucune ligne lue. Ajoute les produits avec « + Produit hors BL ».</div>';
  h += '<button class="stk-btn big" style="margin-top:6px" onclick="stkHorsBl()">+ Produit hors BL</button>'
    + '<button class="stk-btn ok big" style="margin-top:10px" '+((nT||!L.length)?'disabled':'')+' onclick="stkValider()">Valider la réception<br><small>('+nR+' reçu'+(nR>1?'s':'')+' · '+nM+' manquant'+(nM>1?'s':'')+' · '+nX+' refusé'+(nX>1?'s':'')+(nT?' · '+nT+' à confirmer':'')+')</small></button>'
    + '<button class="stk-btn big" style="margin-top:6px" onclick="stkAbandon()">Annuler</button></div>';
  return h;
}
function stkDraftSet(k, v){ try { if (_stk.draft) { _stk.draft[k] = String(v||'').trim(); stkPersist(); } } catch(e){ console.warn('[stock] draftSet', e); } }
function stkLineSet(i, k, v){
  try {
    var l = _stk.draft && _stk.draft.lignes[i]; if (!l) return;
    if (k === 'qte') l.qte = Math.max(1, parseInt(v,10)||1);
    else if (k === 'sans_etiquette') l.sans_etiquette = !!v;
    else l[k] = String(v||'').trim();
    if (k === 'lot' && l.lot && !l._se_touche) l.sans_etiquette = false;
    if (k === 'sans_etiquette') l._se_touche = true;
    stkPersist();
    if (k === 'qte' || k === 'lot' || k === 'sans_etiquette') _stkRefresh();
  } catch(e){ console.warn('[stock] lineSet', e); }
}
function stkLineEdit(i){ try { var l = _stk.draft.lignes[i]; l.edit = !l.edit; _stkRefresh(); } catch(e){ console.warn('[stock] lineEdit', e); } }
function stkLineStat(i, st){ try { var l = _stk.draft.lignes[i]; l.statut = (l.statut === st) ? '' : st; _stkRefresh(); } catch(e){ console.warn('[stock] lineStat', e); } }
function stkToutRecu(){ try { _stk.draft.lignes.forEach(function(l){ if (!l.statut) l.statut = 'recu'; }); _stkRefresh(); } catch(e){ console.warn('[stock] toutRecu', e); } }
function stkHorsBl(){
  try {
    _stk.draft.lignes.push({ produit:'', conditionnement:'', qte_texte:'', qte:1, unite:'', lot:'', dlc:'', dlc_type:'', statut:'recu', hors_bl:true, edit:true, sans_etiquette:true });
    _stkRefresh();
  } catch(e){ console.warn('[stock] horsBl', e); }
}
function stkAbandon(){
  try {
    if (!_stkNeedWho()) return;
    showConfirm('Abandonner ce BL ?', 'Rien n\'entrera en stock. L\'abandon est tracé à ton nom.', 'Abandonner', function(){
      try { _stkTraceAbandon(_stk.draft, (_stk.draft.pages||[]).length); } catch(e){}
      _stk.draft = null; _stkRefresh();
    });
  } catch(e){ console.warn('[stock] abandon', e); }
}
async function stkValider(){
  var d = _stk.draft; if (!d || _stk.busy) return;
  try {
    if (d.lignes.some(function(l){ return !l.statut; })) { toast('⚠️ Confirme chaque ligne (Reçu / Manquant / Refusé)','warning'); return; }
    if (d.lignes.some(function(l){ return !String(l.produit||'').trim(); })) { toast('⚠️ Une ligne n\'a pas de nom de produit','warning'); return; }
    var who = _stkNeedWho(); if (!who) return;
    _stk.busy = true;
    var now = new Date();
    var rec = {
      _ts: now.toISOString(), _sec: STK_SEC,
      date: d.date || _stkToday(), date_reception: _stkToday(), heure: _stkHM(now),
      fournisseur: d.fournisseur||'', fournisseur_id: d.fournisseur_id||'', numero: d.numero||'',
      cuisinier: who, pages: d.pages.length, produit: 'BL '+(d.fournisseur||'')+' '+(d.numero||''),
      lignes_bl: d.lignes.map(function(l){
        var lot = l.lot, auto = false;
        if (!lot && l.statut === 'recu') { lot = stkLotFromBl(d.fournisseur, d.numero, d.date); auto = true; }
        var o = { produit: l.produit, conditionnement: l.conditionnement, qte_texte: l.qte_texte, qte: l.statut==='recu' ? l.qte : 0, qte_bl: l.qte,
          unite: l.unite, lot: lot, lot_auto: auto, dlc: l.dlc, dlc_type: l.dlc_type, statut: l.statut, hors_bl: !!l.hors_bl };
        if (l.statut === 'manquant') o.trace = 'manquant sur BL n° '+(d.numero||'?');
        if (l.statut === 'refuse') o.trace = 'refusé à la réception';
        o.sans_etiquette = !!l.sans_etiquette;
        return o;
      })
    };
    var nR = rec.lignes_bl.filter(function(l){ return l.statut==='recu'; }).length,
        nM = rec.lignes_bl.filter(function(l){ return l.statut==='manquant'; }).length,
        nX = rec.lignes_bl.filter(function(l){ return l.statut==='refuse'; }).length;
    rec.nb_recu = nR; rec.nb_manquant = nM; rec.nb_refuse = nX;
    rec.resume = nR+' reçu'+(nR>1?'s':'')+' · '+nM+' manquant'+(nM>1?'s':'')+' · '+nX+' refusé'+(nX>1?'s':'');
    // Photos du BL : même chaîne que photoSave — miniature 640 px {thumb,file,date} dans le dossier (S),
    // pleine résolution (2000 px) confiée à SupaEngine via _pendingPhotos → Supabase Storage (bucket privé) → siège.
    var fulls = {};
    try {
      for (var i = 0; i < d.pages.length; i++) {
        var pair = await _stkPhotoPair(d.pages[i]);
        if (!pair || !pair.ref) continue;
        var fld = i === 0 ? 'photo' : ('photo' + (i + 1));
        rec[fld] = pair.ref;
        if (pair.full && i < 3) fulls[i === 0 ? 'enr31' : ('enr31_' + (i + 1))] = pair.full; // préfixes connus de SupaEngine (photo/photo2/photo3)
      }
    } catch(e){ console.warn('[stock] photos', e); }
    _stkPushWithPhotos(STK_SEC, rec, fulls);
    _stk.draft = null; _stk.busy = false;
    toast('✅ Réception enregistrée — '+rec.resume,'success');
    // Refusés → NC ENR30 pré-remplie via le flux existant (nc_auto_pending + ncAutoFill)
    if (nX) {
      try {
        S.nc_auto_pending = S.nc_auto_pending || [];
        var refs = rec.lignes_bl.filter(function(l){ return l.statut==='refuse'; });
        S.nc_auto_pending.push({
          date: _stkToday(), heure: rec.heure, source: 'Réception', lieu: 'Réception marchandises',
          desc: 'Produit(s) refusé(s) à la réception — BL n° '+(rec.numero||'?')+' ('+(rec.fournisseur||'fournisseur ?')+') : '
            + refs.map(function(l){ return l.produit+(l.lot && !l.lot_auto ? ' (lot '+l.lot+')' : ''); }).join(', '),
          action: 'Refus de la marchandise / retour fournisseur',
          non_conformity_type: 'reception', _bl_ts: rec._ts
        });
        save();
        ncAutoFill(S.nc_auto_pending.length - 1);
        return;
      } catch(e){ console.warn('[stock] NC refus', e); }
    }
    _stkRefresh(); window.scrollTo(0,0);
  } catch(e){
    _stk.busy = false;
    console.warn('[stock] valider', e);
    try { toast('⚠️ Erreur à l\'enregistrement de la réception','warning'); } catch(_e){}
  }
}

// ── Mouvements (entame / fini / correction) — append-only, tracés ───
function _stkGroup(key){ try { return stkGroups().find(function(G){ return G.key === key; }) || null; } catch(e){ return null; } }
function stkMvt(type, it, extra){
  var who = _stkWho() || '';
  var now = new Date();
  var row = Object.assign({ _ts: now.toISOString(), _sec: STK_MVT, date: _stkToday(), heure: _stkHM(now), type: type,
    item_id: it.id, bl_ts: it.bl_ts, bl_numero: it.bl_numero, fournisseur: it.fournisseur, produit: it.produit, lot: it.lot,
    dlc: it.dlc, n: 1, cuisinier: who }, extra || {});
  return _stkPush(STK_MVT, row);
}
/** Choix de l'unité à ouvrir : sac entamé (continuer) ou neuf d'une livraison donnée. */
function _stkChoice(title, sub, opts, cb, onCancel){
  try {
    var ov = document.createElement('div');
    ov.className = 'hacc-wait-ov'; ov.id = 'stk-choice-ov';
    ov.innerHTML = '<div class="hacc-wait-card" style="text-align:left;padding:16px;max-width:380px">'
      + '<div class="stk-h">'+_stkE(title)+'</div>' + (sub ? '<div class="stk-sub" style="margin-bottom:8px">'+sub+'</div>' : '')
      + opts.map(function(o, i){ return '<button class="stk-btn big" style="text-align:left;margin:5px 0;'+(o.hl?'border-color:#f59e0b;background:#fffbeb':'')+'" data-i="'+i+'">'+o.html+'</button>'; }).join('')
      + '<button class="stk-btn big" style="margin-top:8px;color:#7a6378" data-i="-1">Annuler</button></div>';
    ov.addEventListener('click', function(ev){
      try {
        var b = ev.target.closest ? ev.target.closest('button[data-i]') : null;
        if (!b && ev.target !== ov) return;
        var i = b ? parseInt(b.getAttribute('data-i'),10) : -1;
        ov.remove();
        if (i >= 0) cb(opts[i]); else if (onCancel) onCancel();
      } catch(e){ console.warn('[stock] choice', e); }
    });
    document.body.appendChild(ov);
  } catch(e){ console.warn('[stock] choice', e); }
}
/** defer=true : rien n'est écrit ici, after(it, 'ent'|'neuf') écrit mouvement + fiche ensemble. */
function stkEntamer(key, after, defer){
  try {
    if (!_stkNeedWho()) return;
    var G = _stkGroup(key); if (!G) return;
    if (G.bloque) { toast('⛔ Lot bloqué — ne pas utiliser','warning'); return; }
    var opts = [];
    G.items.forEach(function(it){
      if (it.entames > 0) opts.push({ kind: 'ent', it: it, hl: true, html: '🟠 Le '+_stkE(it.unite||'produit')+' entamé — reçu le '+_stkFr(it.date_rec)+'<br><small>ouvert le '+_stkFr(it.ouverts[0])+' · le plus ancien</small>' });
    });
    G.items.forEach(function(it){
      if (it.neufs > 0) opts.push({ kind: 'neuf', it: it, html: '🟢 Un neuf — reçu le '+_stkFr(it.date_rec)+' (BL '+_stkE(it.bl_numero||'?')+')<br><small>'+it.neufs+' neuf'+(it.neufs>1?'s':'')+(it.dlc?' · '+(it.dlc_type||'DLC')+' '+_stkFr(it.dlc):'')+(G.entames?' · ⚠️ il reste un entamé':'')+'</small>' });
    });
    if (!opts.length) { toast('Plus rien en stock pour ce produit','warning'); return; }
    var go = function(o){
      try {
        if (o.kind === 'ent') { toast('🟠 On continue le '+(o.it.unite||'produit')+' entamé','success'); if (after) after(o.it, defer ? 'ent' : null); return; }
        if (G.entames > 0) toast('⚠️ Attention : il reste un entamé de ce lot — à utiliser en priorité','warning');
        if (defer) { if (after) after(o.it, 'neuf'); return; }
        var row = stkMvt('entame', o.it, { from: 'neuf' });
        if (after) after(o.it, row); else { toast('✅ '+o.it.produit+' entamé','success'); _stkRefresh(); }
      } catch(e){ console.warn('[stock] entamer go', e); }
    };
    if (opts.length === 1 && opts[0].kind === 'neuf') { go(opts[0]); return; }
    var multi = G.items.length > 1 ? ('Lot '+_stkE(G.lot)+' trouvé sur '+G.items.length+' livraisons — lequel ouvres-tu ?') : 'Lequel ouvres-tu ?';
    _stkChoice(G.produit, multi, opts, go);
  } catch(e){ console.warn('[stock] entamer', e); }
}
function stkFini(key){
  try {
    if (!_stkNeedWho()) return;
    var G = _stkGroup(key); if (!G) return;
    var opts = [];
    G.items.forEach(function(it){ if (it.entames > 0) opts.push({ from: 'entame', it: it, hl: true, html: '🟠 L\'entamé (ouvert le '+_stkFr(it.ouverts[0])+') est fini' }); });
    G.items.forEach(function(it){ if (it.neufs > 0) opts.push({ from: 'neuf', it: it, html: '🟢 Un neuf utilisé en entier — reçu le '+_stkFr(it.date_rec) }); });
    if (!opts.length) return;
    var go = function(o){
      try { stkMvt('fini', o.it, { from: o.from }); toast('✅ '+o.it.produit+' — fini','success'); _stkRefresh(); }
      catch(e){ console.warn('[stock] fini go', e); }
    };
    if (opts.length === 1) { go(opts[0]); return; }
    _stkChoice(G.produit, 'Qu\'est-ce qui est fini ?', opts, go);
  } catch(e){ console.warn('[stock] fini', e); }
}
/** Correction de quantité : motif obligatoire, trace (qui / quand / pourquoi), jamais d'écrasement. */
function stkCorriger(key){
  try {
    var who = _stkNeedWho(); if (!who) return;
    var G = _stkGroup(key); if (!G) return;
    var it = G.items.filter(function(i){ return i.dispo > 0; }).slice(-1)[0] || G.items[G.items.length-1];
    showPrompt('Corriger le stock — '+G.produit, 'Nombre de NEUFS réellement présents (actuellement '+it.neufs+', BL '+(it.bl_numero||'?')+')', String(it.neufs), function(v){
      try {
        var n = parseInt(v,10);
        if (isNaN(n) || n < 0) { toast('⚠️ Nombre invalide','warning'); return; }
        var delta = n - it.neufs;
        if (!delta) return;
        showPrompt('Motif de la correction', 'Obligatoire — tracé avec ton nom et l\'heure', 'Ex : casse, erreur de comptage, perte…', function(m){
          try {
            m = String(m||'').trim();
            if (!m) { toast('⚠️ Motif obligatoire','warning'); return; }
            stkMvt('correction', it, { delta: delta, avant: it.neufs, apres: n, motif: m });
            toast('✏️ Stock corrigé (trace enregistrée)','success'); _stkRefresh();
          } catch(e){ console.warn('[stock] corr2', e); }
        }, 'Enregistrer');
      } catch(e){ console.warn('[stock] corr', e); }
    }, 'Suivant');
  } catch(e){ console.warn('[stock] corriger', e); }
}

/* ════════════════════════════════════════════════════════════════════
 * PR B (v489) — « J'entame » avec photo d'étiquette → fiche traçabilité (ENR31) auto,
 * « Choisir dans le stock » à côté de la saisie manuelle (traça plat), lots bloqués refusés.
 * Règle : le mouvement « entame » et la ligne ENR31 sont TOUJOURS écrits ensemble.
 * ════════════════════════════════════════════════════════════════════ */
function _stkEnr31For(itemId){
  try { return ((S.enr31||{}).lignes||[]).find(function(l){ return l && !l._deleted && l._stock_item_id === itemId; }) || null; } catch(e){ return null; }
}
/** Crée la ligne ENR31 liée au BL et au stock (photos : chaîne photoSave, pleine résolution vers Storage). */
function stkCreateEnr31(it, o){
  try {
    o = o || {};
    var now = new Date();
    var rec = {
      _ts: now.toISOString(), _sec: 'enr31',
      date: _stkToday(), produit: it.produit, lot: o.lot || it.lot || '—', dlc: o.dlc || it.dlc || '',
      estampille: o.estampille || '', cuisinier: _stkWho() || '',
      _from_stock: true, _stock_item_id: it.id, _bl_ts: it.bl_ts, bl_numero: it.bl_numero, fournisseur: it.fournisseur,
      date_reception: it.date_rec
    };
    var fulls = {};
    if (o.p1) { rec.photo = o.p1.ref; if (o.p1.full) fulls.enr31 = o.p1.full; }
    if (o.p2) { rec.photo2 = o.p2.ref; if (o.p2.full) fulls.enr31_2 = o.p2.full; }
    if (o.mvt_ts) rec._stock_mvt_ts = o.mvt_ts;
    return _stkPushWithPhotos('enr31', rec, fulls);
  } catch(e){ console.warn('[stock] enr31', e); return null; }
}
/** Écrit ENSEMBLE le mouvement « entame » (si neuf) et la fiche ENR31. kind = 'neuf' | 'ent'. */
function stkCommitEntame(it, kind, o){
  try {
    o = o || {};
    if (kind === 'ent') { var ex = _stkEnr31For(it.id); if (ex) return ex; return stkCreateEnr31(it, o); }
    var row = stkMvt('entame', it, { from: 'neuf', lot_lu: o.lot_lu || '', dlc_lue: o.dlc_lue || '' });
    o.mvt_ts = row ? row._ts : '';
    return stkCreateEnr31(it, o);
  } catch(e){ console.warn('[stock] commitEntame', e); return null; }
}
/**
 * Parcours « J'entame » complet : choix entamé / neuf (+ alerte), photo d'étiquette sauf « sans étiquette ».
 * done(it, enr31) appelé une fois tout écrit ; done(null) si annulé AVANT toute écriture.
 * Sélecteur de fichier fermé sans photo → fiche créée quand même, sans photo (jamais de chaîne cassée).
 */
function stkEntamerFlow(key, done){
  done = done || function(){};
  stkEntamer(key, function(it, kind){
    try {
      if (kind === 'ent') { done(it, stkCommitEntame(it, 'ent', {})); return; }
      if (it.sans_etiquette) { done(it, stkCommitEntame(it, 'neuf', {})); return; }
      _stkChoice(it.produit, '📷 Prends l\'étiquette en photo (lot et date remplis automatiquement)', [
        { k: 'camera', html: '📷 Caméra', hl: true }, { k: 'gallery', html: '🖼️ Galerie (1 ou 2 photos)' }, { k: 'none', html: '🚫 Pas d\'étiquette sur ce produit' }
      ], function(o){
        try {
          if (o.k === 'none') { done(it, stkCommitEntame(it, 'neuf', {})); return; }
          var handled = false;
          var finish = function(files){
            if (handled) return; handled = true;
            try { window.removeEventListener('focus', onFocus); } catch(e){}
            if (files && files.length) stkLabelFiles(it, files, done);
            else { toast('Pas de photo — fiche traçabilité remplie avec le lot du BL','warning'); done(it, stkCommitEntame(it, 'neuf', {})); }
          };
          var inp = document.createElement('input');
          inp.type = 'file'; inp.accept = 'image/*';
          if (o.k === 'camera') inp.setAttribute('capture','environment'); else inp.multiple = true;
          inp.style.display = 'none';
          inp.onchange = function(){ var f = inp.files; try { inp.remove(); } catch(e){} finish(f); };
          inp.addEventListener('cancel', function(){ try { inp.remove(); } catch(e){} finish(null); });
          // Repli (navigateurs sans évènement « cancel ») : retour au premier plan sans fichier
          var onFocus = function(){ setTimeout(function(){ if (!handled && !(inp.files && inp.files.length)) finish(null); }, 1500); };
          setTimeout(function(){ try { window.addEventListener('focus', onFocus); } catch(e){} }, 400);
          document.body.appendChild(inp); inp.click();
        } catch(e){ console.warn('[stock] label pick', e); done(it, stkCommitEntame(it, 'neuf', {})); }
      }, function(){ done(it, stkCommitEntame(it, 'neuf', {})); });
    } catch(e){ console.warn('[stock] entamerFlow', e); }
  }, true);
}
function stkEntamerPhoto(key){
  stkEntamerFlow(key, function(it, rec){ if (it && rec) toast('✅ Entamé — fiche traçabilité remplie','success'); _stkRefresh(); });
}
function _stkReadFile(f){
  return new Promise(function(res){ try { var rd = new FileReader(); rd.onload = function(){ res(String(rd.result||'')); }; rd.onerror = function(){ res(''); }; rd.readAsDataURL(f); } catch(e){ res(''); } });
}
async function stkLabelFiles(it, files, done){
  var arr = Array.prototype.slice.call(files||[]).slice(0, 2);
  try { haccShowWait({ icon: '📷', title: 'Lecture de l\'étiquette…', sub: 'Lot et date proposés, à vérifier' }); } catch(e){}
  var pairs = [], prop = null;
  try {
    for (var i = 0; i < arr.length; i++) {
      var raw = await _stkReadFile(arr[i]); if (!raw) continue;
      pairs.push(await _stkPhotoPair(raw));
      try {
        var res = (typeof _labelOcrPost === 'function') ? await _labelOcrPost(raw) : null;
        if (res && res.proposed) prop = (typeof _labelOcrMerge === 'function') ? _labelOcrMerge(prop, res.proposed) : (prop || res.proposed);
      } catch(e){ console.warn('[stock] label post', e); }
    }
  } catch(e){ console.warn('[stock] label', e); }
  try { haccHideWait(); } catch(e){}
  var lot = (prop && prop.lot) || '', dlc = '';
  try { dlc = (prop && /^\d{4}-\d{2}-\d{2}$/.test(String(prop.dlc||''))) ? prop.dlc : ''; } catch(e){}
  var warn = (lot && it.lot && !it.lot_auto && _stkNorm(lot) !== _stkNorm(it.lot)) ? ('lot étiquette '+lot+' ≠ lot du BL '+it.lot) : '';
  if (!prop) toast('Étiquette non lue — lot du BL gardé, photo jointe','warning');
  var rec = stkCommitEntame(it, 'neuf', { lot: lot || it.lot, dlc: dlc || it.dlc, estampille: (prop && prop.estampille) || '',
    p1: pairs[0] || null, p2: pairs[1] || null, lot_lu: lot, dlc_lue: dlc });
  if (warn) toast('⚠️ Vérifie : '+warn,'warning');
  done(it, rec);
}

// ── Lots bloqués : refus dans TOUS les chemins de liaison (fiche manuelle, bandeau menu, stock) ──
function stkBlockedInfo(lot, produit){
  try {
    var n = _stkNorm(lot); if (!n || n === '—') return null;
    var it = stkItems().find(function(i){ return i.bloque && (_stkNorm(i.lot) === n || _stkNorm(i.lot_lu||'') === n); });
    if (!it) return null;
    var m = _stkMvts().filter(function(x){ return x.item_id === it.id && x.type === 'bloque'; }).sort(function(a,b){ return String(b._ts).localeCompare(String(a._ts)); })[0] || {};
    return { lot: it.lot, produit: it.produit, motif: it.bloque_motif || m.motif || '', par: m.cuisinier || '', date: m.date || '' };
  } catch(e){ return null; }
}
function stkBlockedAlert(b){
  try {
    var msg = '⛔ LOT BLOQUÉ — ' + b.produit + ' (lot ' + b.lot + ')' + (b.motif ? ' — motif : ' + b.motif : '') + (b.par ? ' — bloqué par ' + b.par + (b.date ? ' le ' + _stkFr(b.date) : '') : '') + '. Ne pas utiliser ce lot.';
    try { toast(msg, 'error', { force: true }); } catch(e){}
    _stkChoice('⛔ Lot bloqué', '<div style="color:#991b1b;font-weight:800">'+_stkE(b.produit)+' — lot '+_stkE(b.lot)+'</div>'
      + (b.motif ? '<div>Motif : '+_stkE(b.motif)+'</div>' : '') + (b.par ? '<div>Bloqué par '+_stkE(b.par)+(b.date?' le '+_stkFr(b.date):'')+'</div>' : '')
      + '<div style="margin-top:6px">Ce lot ne peut pas être utilisé ni lié à un plat.</div>', [{ k: 'ok', html: 'Compris', hl: true }], function(){});
  } catch(e){ console.warn('[stock] blockedAlert', e); }
}
/** Utilisé par app-menu-cuisine (_menuSetLotPlat) : true = refusé. */
window.stkLotBlockCheck = function(l){
  try { var b = l ? stkBlockedInfo(l.lot, l.produit) : null; if (b) { stkBlockedAlert(b); return true; } } catch(e){}
  return false;
};

/** Sélecteur « Choisir dans le stock » : produits cochés → switch entamé / fini, puis même parcours que J'entame. */
function stkPickForDish(ref, ctx){
  try {
    if (!_stkNeedWho()) return;
    ctx = ctx || {};
    var groups = stkGroups().filter(function(G){ return G.dispo > 0 && !G.bloque; });
    var plats = [];
    try { plats = (window._stkMenuApi && window._stkMenuApi.todayMenuPlats) ? window._stkMenuApi.todayMenuPlats() : []; } catch(e){ plats = []; }
    var pend = [];
    try { if (!ref && window._stkMenuApi && window._stkMenuApi.pendingRefs) pend = (window._stkMenuApi.pendingRefs('enr31')||[]).filter(function(r){ return r && r.plat_id; }); } catch(e){ pend = []; }
    var prev = document.getElementById('stk-dish-ov'); if (prev) prev.remove();
    var ov = document.createElement('div');
    ov.id = 'stk-dish-ov';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9500;display:flex;align-items:flex-end;justify-content:center';
    var platSel = pend.length ? '<div class="stk-sub" style="margin-bottom:6px">🍽️ '+pend.map(function(r){ return _stkE(r.nom||''); }).join(', ')+' <small>(bandeau Menu du jour)</small></div>'
      : ref ? '<div class="stk-sub" style="margin-bottom:6px">🍽️ '+_stkE(ref.nom||'')+'</div>'
      : ('<select id="stk-dish-plat" class="stk-in" style="margin-bottom:8px"><option value="">— Plat (facultatif) —</option>'
        + plats.map(function(x, i){ return '<option value="'+i+'">'+_stkE(x.p.nom)+(x.svc&&x.svc.label?' ('+_stkE(x.svc.label)+')':'')+'</option>'; }).join('') + '</select>');
    ov.innerHTML = '<div style="background:#fff;border-radius:18px 18px 0 0;width:100%;max-width:520px;padding:16px 14px 22px;max-height:88vh;overflow:auto">'
      + '<div class="stk-h">📦 Produits du stock</div>' + platSel
      + (groups.length ? groups.map(function(G, i){
          var src = G.lot_auto ? ('BL '+_stkE(G.items[0].fournisseur)+' '+_stkFr(G.items[0].bl_date)) : _stkE(G.lot);
          return '<div class="stk-line" style="display:flex;align-items:center;gap:8px;padding:8px">'
            + '<input type="checkbox" data-gi="'+i+'" style="width:20px;height:20px;accent-color:#16a34a">'
            + '<div style="flex:1;min-width:0"><div class="nm">'+_stkE(G.produit)+'</div><div class="mt">'+src+(G.entames?' · entamé '+_stkFr(G.ouvert_le):' · neuf')+'</div></div>'
            + '<div style="display:none;border:1.5px solid #d9c6dc;border-radius:9px;overflow:hidden" data-sw="'+i+'">'
            + '<button type="button" data-v="entame" style="border:none;padding:6px 9px;font-weight:800;font-size:.74rem;background:#f59e0b;color:#fff;font-family:inherit">Entamé</button>'
            + '<button type="button" data-v="fini" style="border:none;padding:6px 9px;font-weight:800;font-size:.74rem;background:#fff;color:#5C1E5A;font-family:inherit">Fini</button></div></div>';
        }).join('') : '<div class="empty-s">Stock vide — utilise la saisie manuelle.</div>')
      + '<button type="button" id="stk-dish-ok" class="stk-btn ok big" style="margin-top:10px">✓ Valider</button>'
      + '<button type="button" id="stk-dish-cancel" class="stk-btn big" style="margin-top:6px">Fermer</button></div>';
    document.body.appendChild(ov);
    var etat = {};
    ov.querySelectorAll('input[data-gi]').forEach(function(cb){
      cb.addEventListener('change', function(){ try { var sw = ov.querySelector('[data-sw="'+cb.getAttribute('data-gi')+'"]'); if (sw) sw.style.display = cb.checked ? 'flex' : 'none'; } catch(e){} });
    });
    ov.querySelectorAll('[data-sw]').forEach(function(sw){
      sw.addEventListener('click', function(ev){
        try {
          var b = ev.target.closest('button[data-v]'); if (!b) return;
          var i = sw.getAttribute('data-sw'); etat[i] = b.getAttribute('data-v');
          sw.querySelectorAll('button').forEach(function(x){ var on = x === b; x.style.background = on ? (x.getAttribute('data-v')==='fini'?'#16a34a':'#f59e0b') : '#fff'; x.style.color = on ? '#fff' : '#5C1E5A'; });
        } catch(e){ console.warn('[stock] switch', e); }
      });
    });
    var close = function(){ try { ov.remove(); renderMain(); renderNav(); } catch(e){} };
    ov.addEventListener('click', function(e){ if (e.target === ov) close(); });
    document.getElementById('stk-dish-cancel').onclick = close;
    document.getElementById('stk-dish-ok').onclick = function(){
      try {
        var svc = ctx.service || '', dsv = ctx.date || _stkToday();
        var refs = ref ? [ref] : pend.slice();
        if (!refs.length) {
          var sel = document.getElementById('stk-dish-plat');
          var x = sel && sel.value !== '' ? plats[parseInt(sel.value,10)] : null;
          if (x) { refs = [{ plat_id: x.p.plat_id, nom: x.p.nom, menu_id: x.menu_id || '', profil_haccp: x.p.profil_haccp || '' }]; svc = (x.svc && (x.svc.label || x.svc.id)) || ''; }
        }
        var todo = [];
        ov.querySelectorAll('input[data-gi]:checked').forEach(function(cb){ var i = cb.getAttribute('data-gi'); todo.push({ G: groups[parseInt(i,10)], etat: etat[i] || 'entame' }); });
        if (!todo.length) { toast('Coche au moins un produit','warning'); return; }
        ov.remove();
        var linked = 0, n = 0;
        var next = function(){
          if (!todo.length) {
            try { renderMain(); renderNav(); } catch(e){}
            if (linked) toast('🔗 Chaîne complète ✓ — '+linked+' produit'+(linked>1?'s':'')+' lié'+(linked>1?'s':'')+' à '+refs.map(function(r){ return r.nom; }).join(', '),'success');
            else if (n) toast('✅ '+n+' produit'+(n>1?'s':'')+' tracé'+(n>1?'s':'')+' (aucun plat choisi)','success');
            return;
          }
          var t = todo.shift();
          stkEntamerFlow(t.G.key, function(it, rec){
            try { if (it && rec) { n++; if (stkUseForDish(it, rec, refs, t.etat, { service: svc, date: dsv })) linked++; } } catch(e){ console.warn('[stock] dish step', e); }
            setTimeout(next, 50);
          });
        };
        next();
      } catch(e){ console.warn('[stock] dish ok', e); }
    };
  } catch(e){ console.warn('[stock] pickForDish', e); }
}
/** Après le parcours J'entame : lien plat(s) ↔ fiche ENR31, mouvement « usage », « fini » éventuel. Renvoie le nb de plats liés. */
function stkUseForDish(it, rec, refs, etat, ctx){
  try {
    refs = (refs||[]).filter(function(r){ return r && r.plat_id; });
    var linked = 0;
    refs.forEach(function(rf){
      try {
        if (!rec || !rec._uuid || !window._stkMenuApi || !window._stkMenuApi.setLotPlat) return;
        window._stkMenuApi.setLotPlat(rec._uuid, rf, true);
        var ok = window._stkMenuApi.refsFromLigne ? window._stkMenuApi.refsFromLigne(rec).some(function(z){ return String(z.plat_id) === String(rf.plat_id); }) : true;
        if (ok) linked++;
      } catch(e){ console.warn('[stock] lien plat', e); }
    });
    if (etat === 'fini') stkMvt('fini', it, { from: 'entame', plat: refs.map(function(z){ return z.nom; }).join(', ') });
    stkMvt('usage', it, { plat_id: refs.map(function(z){ return z.plat_id; }).join(','), plat: refs.map(function(z){ return z.nom; }).join(', '),
      service: (ctx && ctx.service) || '', date_service: (ctx && ctx.date) || _stkToday(), etat: etat, enr31_uuid: rec ? rec._uuid : '' });
    return linked;
  } catch(e){ console.warn('[stock] useForDish', e); return 0; }
}
/** Index (dans S.enr31.lignes) de la fiche traçabilité de l'entamé le plus ancien du groupe, sinon -1. */
function _stkEtiqIdx(G){
  try {
    if (!G) return -1;
    var L = (S.enr31||{}).lignes||[];
    for (var j = 0; j < G.items.length; j++) {
      var it = G.items[j]; if (!it.entames) continue;
      var l = _stkEnr31For(it.id); if (l) return L.indexOf(l);
    }
  } catch(e){}
  return -1;
}
/* Branchements non intrusifs (aucune modification des formulaires existants) */
(function stkHooksB(){
  try { stkEntamerUI = stkEntamerPhoto; } catch(e){ console.warn('[stock] hook entamer', e); }
  try {
    // Bouton étiquette EXISTANT (🏷️ de l'historique Traçabilité MP → enr31ToEtiq) sur les produits entamés du stock
    var _lh = stkListHtml;
    stkListHtml = function(groups){
      var h = String(_lh(groups));
      try {
        if (typeof enr31ToEtiq !== 'function') return h;
        return h.replace(/<button onclick="stkGroupAct\('fini',(\d+)\)">Fini<\/button>/g, function(m, gi){
          return _stkEtiqIdx((_stk.view||[])[parseInt(gi,10)]) >= 0
            ? m + '<button onclick="stkGroupAct(\'etiq\','+gi+')" title="Créer étiquette Entamé">🏷️ Étiquette</button>' : m;
        });
      } catch(e){ return h; }
    };
    var _ga = stkGroupAct;
    stkGroupAct = function(act, i){
      if (act !== 'etiq') return _ga.apply(this, arguments);
      try { var k = _stkEtiqIdx((_stk.view||[])[i]); if (k >= 0) enr31ToEtiq(k); } catch(e){ console.warn('[stock] etiq', e); }
    };
  } catch(e){ console.warn('[stock] hook etiq', e); }
  try {
    // Fiche ENR31 : bouton « Choisir dans le stock » à côté de la saisie manuelle
    if (typeof REND !== 'undefined' && typeof REND['enr31'] === 'function') {
      var _r31 = REND['enr31'];
      REND['enr31'] = function(){
        var h = _r31.apply(this, arguments);
        try {
          var btn = '<div class="label-ocr-bar" style="margin:6px 0 10px"><button type="button" onclick="stkPickForDish(null)" style="background:#16a34a;color:#fff;border-color:#16a34a">📦 Choisir dans le stock</button></div>';
          var anchor = '<div class="fg-label">Nouvelle saisie</div>';
          return h.indexOf(anchor) >= 0 ? h.replace(anchor, btn + anchor) : (btn + h);
        } catch(e){ return h; }
      };
    }
  } catch(e){ console.warn('[stock] hook enr31', e); }
  try {
    // Saisie manuelle ENR31 : lot bloqué → refus avec alerte rouge (motif)
    if (typeof saveRow === 'function') {
      var _sr = saveRow;
      saveRow = function(id){
        try {
          if (id === 'enr31') {
            var d = (S.enr31||{}).draft||{};
            var b = stkBlockedInfo(d.lot, d.produit);
            if (b) { stkBlockedAlert(b); return; }
          }
        } catch(e){ console.warn('[stock] saveRow guard', e); }
        return _sr.apply(this, arguments);
      };
    }
  } catch(e){ console.warn('[stock] hook saveRow', e); }
})();
