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
function _stkToday(){ try { return today(); } catch(e){ var d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); } } // heure locale, jamais UTC
function _stkHM(d){ d = d || new Date(); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
function _stkFr(ymd){ try { var m = String(ymd||'').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? (m[3]+'/'+m[2]) : String(ymd||''); } catch(e){ return ''; } }
function _stkFrY(ymd){ try { var m = String(ymd||'').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? (m[3]+'/'+m[2]+'/'+m[1]) : String(ymd||''); } catch(e){ return ''; } }
/** « sacs » → « sac » (accord : « l'entamé (sac) ») */
function _stkUnitSg(u){ try { u = String(u||'').trim().toLowerCase(); if (!u) return 'produit'; if (u === 'colis') return u; return u.length > 3 ? u.replace(/s$/,'') : u; } catch(e){ return 'produit'; } }
function _stkDType(t){ try { t = String(t||'').toUpperCase(); return (t === 'DDM' || t === 'DLUO') ? 'DDM' : 'DLC'; } catch(e){ return 'DLC'; } }
/** Contrôles OCR d'une ligne de brouillon → liste de motifs « Vérifie » */
function _stkCheckLine(l, dateRec){
  var w = [];
  try {
    var rec = dateRec || _stkToday(), y = parseInt(rec.slice(0,4),10) || new Date().getFullYear();
    if (l.dlc) {
      var dy = parseInt(String(l.dlc).slice(0,4),10);
      if (!dy || dy < y - 1 || dy > y + 5) w.push('année de la '+_stkDType(l.dlc_type)+' improbable ('+_stkFrY(l.dlc)+')');
      else if (String(l.dlc) < rec && _stkDType(l.dlc_type) === 'DLC') w.push('DLC déjà dépassée à la réception ('+_stkFrY(l.dlc)+')');
      else if (String(l.dlc) < rec) w.push('DDM déjà dépassée ('+_stkFrY(l.dlc)+')');
    }
    var lot = String(l.lot||'');
    if (lot && (lot.length < 3 || /[?*_]/.test(lot) || /^\d{1,2}[\/.]\d{1,2}([\/.]\d{2,4})?$/.test(lot) || /^\d+\s*(x|×|kg|g|l)\b/i.test(lot))) w.push('n° de lot à vérifier');
    if (l._qte_auto) w.push('quantité déduite de « '+l._qte_auto+' » ('+l.qte+' u.)');
    else if (l.qte === 1 && /(\d+)\s*[x×*]\s*\d/i.test(String(l.conditionnement||'')+' '+String(l.qte_texte||''))) w.push('quantité à vérifier (conditionnement multiple)');
  } catch(e){}
  return w;
}
/** « 20×250 g » / « 6 x 1 L » → 20 / 6 (nb d'unités par colis) ; null sinon */
function _stkMulti(txt){ try { var m = String(txt||'').match(/(\d+)\s*[x×*]\s*\d/i); return m ? parseInt(m[1],10) : null; } catch(e){ return null; } }
/** v493 : 'dlc' = DLC dépassée (inutilisable), 'ddm' = DDM dépassée (avertissement), '' sinon */
function _stkPerime(dlc, typ){ try { if (!dlc || String(dlc) >= _stkToday()) return ''; return _stkDType(typ) === 'DDM' ? 'ddm' : 'dlc'; } catch(e){ return ''; } }
/** v495 : distance d'édition (variantes OCR « chault / chalut ») */
function _stkLev(a, b){
  try {
    a = String(a||''); b = String(b||''); if (a === b) return 0;
    var m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) { cur = [i]; for (j = 1; j <= n; j++) cur[j] = Math.min(prev[j]+1, cur[j-1]+1, prev[j-1] + (a[i-1] === b[j-1] ? 0 : 1)); prev = cur; }
    return prev[n];
  } catch(e){ return 99; }
}
function _stkClose(a, b){
  try { a = _stkNorm(a); b = _stkNorm(b); if (a === b) return true; var d = _stkLev(a, b), L = Math.max(a.length, b.length); return L >= 5 && (d <= 2 || d / L <= 0.2); } catch(e){ return false; }
}
/** v495 : clé de famille produit + lot tolérante (même lot réel + noms proches = même famille) */
function _stkFamKey(reg, produit, lot){
  try {
    var pn = _stkNorm(produit), ln = _stkNorm(lot);
    if (ln && ln !== '—' && !/^bl /.test(ln)) {
      var f = reg.find(function(x){ return x.ln === ln && _stkClose(x.pn, pn); });
      if (f) return f.key;
    }
    var key = pn + '|' + ln; reg.push({ ln: ln, pn: pn, key: key }); return key;
  } catch(e){ return _stkNorm(produit) + '|' + _stkNorm(lot); }
}
function _stkNorm(s){ try { return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\barrivees?\b/g,'arrivage').replace(/\s+/g,' ').trim(); } catch(e){ return String(s||'').toLowerCase().trim(); } }
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
        if (_stk.draft || _stk.pages.length) return; // v496 : réception déjà en cours → ne pas bloquer ses sauvegardes avec un ancien brouillon
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
  try { return ('BL ' + String(f||'').replace(/\s*\(.*?\)\s*/g,' ').trim() + ' ' + (num||'') + ' ' + _stkFrY(date)).replace(/\s+/g,' ').trim(); } catch(e){ return 'BL'; }
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
          date_rec: bl.date_reception || bl.date || '', bl_date: bl.date_bl || bl.date || '',
          produit: l.produit||'', conditionnement: l.conditionnement||'', unite: l.unite||'',
          lot: l.lot||'', lot_auto: !!l.lot_auto, dlc: l.dlc||'', dlc_type: l.dlc_type||'',
          qte: Math.max(0, parseInt(l.qte,10)||0), sans_etiquette: !!l.sans_etiquette,
          ouverts: [], fin_ent: 0, fin_neuf: 0, corr: 0, jete_ent: 0, jete_neuf: 0, jetes: [], bloque: false, bloque_motif: ''
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
      else if (m.type === 'jete') { // v494 : produit jeté (append-only, tracé)
        var ne = Math.max(0, parseInt(m.n_ent,10)||0), nn = Math.max(0, parseInt(m.n_neuf,10)||0);
        it.jete_ent += ne; it.jete_neuf += nn; it.ouverts.splice(0, ne);
        it.jetes.push({ date: m.date || String(m._ts||'').slice(0,10), heure: m.heure || '', n: ne + nn, motif: m.motif || '', par: m.cuisinier || '' });
      }
      else if (m.type === 'correction') { it.corr += (parseInt(m.delta,10)||0); }
      else if (m.type === 'bloque') { it.bloque = true; it.bloque_motif = m.motif||''; }
      else if (m.type === 'debloque') { it.bloque = false; }
    });
    items.forEach(function(it){
      it.entames = it.ouverts.length;
      it.neufs = Math.max(0, it.qte + it.corr - it.entames - it.fin_ent - it.fin_neuf - it.jete_ent - it.jete_neuf);
      it.dispo = it.neufs + it.entames;
    });
  } catch(e){ console.warn('[stock] items', e); }
  return items;
}
/** Regroupe par produit + lot (même lot sur 2 livraisons = 2 items distincts dans le groupe). */
function stkGroups(items){
  var g = {}, out = [], reg = [];
  try {
    (items||stkItems()).forEach(function(it){
      // v492 : une ligne de stock par BL + date de réception (FIFO) — même lot sur 2 BL = 2 lignes
      // v495 : variantes OCR du même produit (même lot) regroupées dans la même famille / ligne
      var fam = _stkFamKey(reg, it.produit, it.lot);
      var k = fam + '|' + String(it.bl_ts||'');
      if (!g[k]) { g[k] = { key: k, fam: fam, produit: it.produit, lot: it.lot, lot_auto: it.lot_auto, items: [] }; out.push(g[k]); }
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
      G.dlc_type = G.dlc ? _stkDType((G.items.find(function(i){ return i.dlc === G.dlc; })||{}).dlc_type) : '';
      G.date_rec = (G.items[0]||{}).date_rec || '';
      G.ouvert_le = G.items.reduce(function(a,i){ return a.concat(i.ouverts); },[]).sort()[0] || '';
    });
    // Tri : entamés d'abord, puis DLC la plus proche
    out.sort(function(a,b){
      if ((b.entames>0) !== (a.entames>0)) return (b.entames>0) - (a.entames>0);
      if (a.dlc && b.dlc) return a.dlc.localeCompare(b.dlc);
      if (a.dlc) return -1; if (b.dlc) return 1;
      return String(a.produit).localeCompare(String(b.produit));
    });
    // FIFO : les lignes d'un même produit + lot restent groupées, la plus ancienne réception d'abord
    try {
      var pos = {}, fams = {};
      out.forEach(function(G, i){ if (pos[G.fam] === undefined) pos[G.fam] = i; (fams[G.fam] = fams[G.fam] || []).push(G); });
      Object.keys(fams).forEach(function(f){ fams[f].sort(function(a,b){ return String(a.date_rec).localeCompare(String(b.date_rec)) || String(a.items[0].bl_ts).localeCompare(String(b.items[0].bl_ts)); }); });
      var seen = {}, res = [];
      out.forEach(function(G){ if (seen[G.fam]) return; seen[G.fam] = 1; res = res.concat(fams[G.fam]); });
      out = res;
    } catch(e){ console.warn('[stock] fifo', e); }
  } catch(e){ console.warn('[stock] groups', e); }
  return out;
}
function _stkDlcChip(dlc, typ){
  try {
    if (!dlc) return '';
    var T = _stkDType(typ);
    if (T === 'DDM') { var jd = Math.round((new Date(dlc+'T12:00') - new Date(_stkToday()+'T12:00')) / 86400000); return jd < 0 ? '<span class="stk-chip dlc">DDM dépassée ('+_stkFrY(dlc)+')</span>' : ''; }
    var t = _stkToday();
    var d1 = new Date(dlc+'T12:00'), d0 = new Date(t+'T12:00');
    var j = Math.round((d1 - d0) / 86400000);
    if (j < 0) return '<span class="stk-chip exp">⛔ DLC dépassée ('+_stkFrY(dlc)+')</span>';
    if (j === 0) return '<span class="stk-chip exp">⚠️ DLC aujourd\'hui</span>';
    if (j === 1) return '<span class="stk-chip dlc">⚠️ DLC demain</span>';
    if (j <= 3) return '<span class="stk-chip dlc">DLC '+_stkFrY(dlc)+'</span>';
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
  // v498 : Rappel de lot visible dès l'accueil Stock (gros bouton en tête)
  h += '<button class="stk-btn big" style="margin:0 0 10px;border:2px solid #5C1E5A;color:#5C1E5A;font-weight:900" onclick="try{stkRecallFocus()}catch(e){}">🔎 Rappel de lot</button>';
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
      return '<div class="stk-line"><div class="nm">'+_stkE(bl.fournisseur||'Fournisseur ?')+' — '+_stkE(/^BL/i.test(bl.numero||'')?bl.numero:'BL '+(bl.numero||'?'))+'</div>'
        + '<div class="mt">Reçu le '+_stkFrY(bl.date_reception||bl.date)+' '+_stkE(bl.heure||'')+' par '+_stkE(bl.cuisinier||'?')+' · BL du '+_stkFrY(bl.date_bl||bl.date)+' · '+_stkE(bl.resume||'')+'</div>'
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
      var it0 = G.items[0] || {};
      var nFam = groups.filter(function(X){ return X.fam === G.fam; }).length;
      var src = G.lot_auto ? (_stkE(it0.fournisseur)+' · sans lot (BL du '+_stkFr(it0.bl_date)+')')
        : ('Lot '+_stkE(G.lot||'—')+' · reçu le '+_stkFr(G.date_rec)+' (BL '+_stkE(it0.bl_numero||'?')+')'+(nFam>1 && groups.filter(function(X){ return X.fam === G.fam; })[0] === G ? ' · <b>le plus ancien</b>' : ''));
      var chips = '';
      if (G.entames) chips += '<span class="stk-chip ent">🟠 '+G.entames+' entamé'+(G.entames>1?'s':'')+(G.ouvert_le?' (ouvert le '+_stkFr(G.ouvert_le)+')':'')+'</span>';
      if (G.neufs) chips += '<span class="stk-chip neuf">'+G.neufs+' neuf'+(G.neufs>1?'s':'')+'</span>';
      var dchip = _stkDlcChip(G.dlc, G.dlc_type);
      chips += dchip;
      if (G.bloque) chips += '<span class="stk-chip blk">⛔ Lot bloqué</span>';
      return '<div class="stk-line"'+(G.bloque?' style="border-color:#fca5a5;background:#fff5f5"':'')+'><div class="nm">'+_stkE(G.produit)+'</div>'
        + '<div class="mt">'+src+((G.dlc && !dchip)?' · '+G.dlc_type+' '+_stkFrY(G.dlc):'')+(G.items.some(function(i){ return i.lot_lu && _stkNorm(i.lot_lu)!==_stkNorm(i.lot); })?' · lot étiquette '+_stkE(G.items.find(function(i){ return i.lot_lu; }).lot_lu):'')+'</div><div>'+chips+'</div>'
        + '<div class="stk-act">'
        + (_stkPerime(G.dlc, G.dlc_type) === 'dlc'
          ? '<button onclick="stkGroupAct(\'jeter\','+gi+')" style="background:#dc2626;border-color:#dc2626;color:#fff">🗑️ Jeter</button>'
          : '<button onclick="stkGroupAct(\'entamer\','+gi+')">J\'entame</button>'
            + '<button onclick="stkGroupAct(\'fini\','+gi+')">Fini</button>')
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
    else if (act === 'jeter') stkJeter(G.key);
    else if (act === 'menu') _stkChoice(G.produit, '', [{ k: 'jeter', html: '🗑️ Jeter (DLC dépassée, abîmé, autre…)' }, { k: 'corr', html: '✏️ Corriger le stock (motif obligatoire)' }], function(o){ if (o.k === 'corr') stkCorriger(G.key); else if (o.k === 'jeter') stkJeter(G.key); });
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
/** Inputs fichier PROPRES au stock (id uniques, hors des modales, handler scopé) — jamais l'input logo. */
function _stkFileInput(id, camera, multiple){
  try {
    var old = document.getElementById(id); if (old) old.remove();
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.id = id; inp.setAttribute('data-stk', '1');
    if (camera) inp.setAttribute('capture', 'environment'); if (multiple) inp.multiple = true;
    inp.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0';
    inp.addEventListener('click', function(ev){ try { ev.stopPropagation(); } catch(e){} });
    document.body.appendChild(inp);
    return inp;
  } catch(e){ console.warn('[stock] input', e); return null; }
}
function stkPick(source){
  try {
    var inp = _stkFileInput(source === 'camera' ? 'stk-bl-cam' : 'stk-bl-gal', source === 'camera', source !== 'camera');
    if (!inp) return;
    inp.addEventListener('change', function(ev){ try { ev.stopPropagation(); } catch(e){} try { stkAddFiles(inp.files); } catch(e){ console.warn('[stock] files', e); } try { inp.remove(); } catch(e){} });
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
        var p = (typeof _ocrCompressForUpload === 'function') ? _ocrCompressForUpload(raw, { maxSide: 2048, maxChars: 1450000 }) /* v496 : BL dense → 2048 px (plafond de l'API en detail high), ≤1,45 Mo × 6 pages < limite serveur 9 Mo */ : Promise.resolve(raw);
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
  try {
    if (res && res.lignes_manquantes > 0) toast('⚠️ La lecture voit '+res.nb_lignes_vues+' lignes mais n\'en a extrait que '+res.lignes.length+' — vérifie le BL et ajoute les manquantes (« + Produit hors BL »)','warning',{ force: true });
    else if (res && res.tronque) toast('⚠️ BL très long : lecture peut-être incomplète — vérifie les dernières lignes','warning',{ force: true });
  } catch(e){}
  stkOpenDraft(res);
  try { if (_stk.draft && res) { _stk.draft.ocr_model = res.model || ''; _stk.draft.ocr_detail = res.detail || ''; _stk.draft.ocr_lignes_vues = res.nb_lignes_vues != null ? res.nb_lignes_vues : ''; } } catch(e){}
}
function stkManual(){ stkOpenDraft({ fournisseur:'', numero:'', date:_stkToday(), lignes:[] }); }
function stkOpenDraft(res){
  try {
    _stk.resume = null;
    _stk.draft = {
      fournisseur: res.fournisseur||'', numero: res.numero||'', date: res.date||_stkToday(),
      pages: _stk.pages.slice(),
      lignes: (res.lignes||[]).map(function(l){
        var o = {
        produit: l.produit||'', conditionnement: l.conditionnement||'', qte_texte: l.qte_texte||'',
        qte: Math.max(1, parseInt(l.qte,10)||1), unite: l.unite||'', lot: l.lot||'', dlc: l.dlc||'', dlc_type: l.dlc_type ? _stkDType(l.dlc_type) : '',
        statut: '', hors_bl: false, edit: false, sans_etiquette: !l.lot,
        _ocr: { produit: l.produit||'', lot: l.lot||'', dlc: l.dlc||'', qte: parseInt(l.qte,10)||1 } }; // v496 : valeurs lues, pour mesurer le taux d'erreur OCR
        // « 20×250 g » lu comme 1 unité → 20 unités (× nb de colis), signalé « Vérifie »
        try {
          var src = String(l.conditionnement||'') + ' ' + String(l.qte_texte||'');
          var per = _stkMulti(src);
          if (per && per > 1 && o.qte < per) { var col = Math.max(1, parseInt(l.colis,10)||1); o.qte = per * col; o._qte_auto = (col>1?col+' colis × ':'') + String(src.match(/\d+\s*[x×*]\s*[\d.,]+\s*\w*/i)[0]).trim(); }
        } catch(e){}
        return o; })
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
    var meta = [l.conditionnement, (l.qte_texte||(l.qte+' u.')), l.lot?('lot '+l.lot):'sans lot', l.dlc?(_stkDType(l.dlc_type)+' '+_stkFrY(l.dlc)):''].filter(Boolean).map(_stkE).join(' · ');
    var extra = '';
    var chk = _stkCheckLine(l, _stkToday());
    if (chk.length) extra += '<div class="mt" style="color:#c2410c;font-weight:800;background:#fff7ed;border:1.5px solid #fdba74;border-radius:8px;padding:4px 7px;margin-top:4px">⚠️ Vérifie : '+chk.map(_stkE).join(' · ')+'</div>';
    if (l.statut === 'manquant') extra = '<div class="mt" style="color:#4b5563">Trace : manquant sur BL n° '+_stkE(d.numero||'?')+'</div>';
    if (l.statut === 'refuse') extra = '<div class="mt" style="color:#991b1b">Refusé — fiche non-conformité pré-remplie à la validation</div>';
    var edit = l.edit ? ('<div class="stk-grid">'
      + '<input class="stk-in" value="'+_stkA(l.produit)+'" placeholder="Produit" oninput="stkLineSet('+i+',\'produit\',this.value,1)" onchange="stkLineSet('+i+',\'produit\',this.value)">'
      + '<input class="stk-in" value="'+_stkA(l.conditionnement)+'" placeholder="Conditionnement (ex : sac 10 kg, cal. 40/50)" oninput="stkLineSet('+i+',\'conditionnement\',this.value,1)" onchange="stkLineSet('+i+',\'conditionnement\',this.value)">'
      + '<input class="stk-in" type="number" min="1" value="'+_stkA(l.qte)+'" placeholder="Unités" onchange="stkLineSet('+i+',\'qte\',this.value)">'
      + '<input class="stk-in" value="'+_stkA(l.lot)+'" placeholder="Lot" oninput="stkLineSet('+i+',\'lot\',this.value,1)" onchange="stkLineSet('+i+',\'lot\',this.value)">'
      + '<input class="stk-in" type="date" value="'+_stkA(l.dlc)+'" onchange="stkLineSet('+i+',\'dlc\',this.value)">'
      + '<select class="stk-in" onchange="stkLineSet('+i+',\'dlc_type\',this.value)"><option value="DLC"'+(_stkDType(l.dlc_type)==='DLC'?' selected':'')+'>DLC (à consommer jusqu\'au)</option><option value="DDM"'+(_stkDType(l.dlc_type)==='DDM'?' selected':'')+'>DDM (de préférence avant)</option></select></div>') : '';
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
function stkLineSet(i, k, v, silent){
  try {
    var l = _stk.draft && _stk.draft.lignes[i]; if (!l) return;
    // v496 : saisie enregistrée à chaque frappe dans le brouillon → un re-rendu (sync, minuterie) ne remet plus l'ancienne valeur
    if (silent) { l[k] = String(v||''); stkPersist(); return; }
    if (k === 'qte') l.qte = Math.max(1, parseInt(v,10)||1);
    else if (k === 'sans_etiquette') l.sans_etiquette = !!v;
    else l[k] = String(v||'').trim();
    if (k === 'qte') delete l._qte_auto;
    if (k === 'lot' && l.lot && !l._se_touche) l.sans_etiquette = false;
    if (k === 'sans_etiquette') l._se_touche = true;
    stkPersist();
    if (k === 'qte' || k === 'lot' || k === 'sans_etiquette' || k === 'dlc' || k === 'dlc_type') _stkRefresh();
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
    // v495 : même n° de BL déjà reçu → « Voir l'existant » / « Continuer quand même »
    try {
      var nn = _stkNorm(d.numero).replace(/^bl\s*/,'');
      var dup = (!d._dup_ok && nn) ? _stkBls().find(function(b){ return _stkNorm(b.numero).replace(/^bl\s*/,'') === nn && (!d.fournisseur || !b.fournisseur || _stkClose(String(d.fournisseur).split(' ')[0], String(b.fournisseur).split(' ')[0]) || _stkNorm(d.fournisseur) === _stkNorm(b.fournisseur)); }) : null;
      if (dup) {
        _stkChoice('⚠️ BL déjà reçu', 'Le BL n° <b>'+_stkE(dup.numero)+'</b> ('+_stkE(dup.fournisseur||'?')+') a déjà été reçu le '+_stkFrY(dup.date_reception||dup.date)+' '+_stkE(dup.heure||'')+' par '+_stkE(dup.cuisinier||'?')+' — '+_stkE(dup.resume||'')+'.', [
          { k: 'see', html: '📄 Voir la réception existante (ne rien enregistrer)', hl: true },
          { k: 'go', html: '➡️ Continuer quand même (2e livraison sur ce BL)' }
        ], function(o){
          try {
            if (o.k === 'go') { d._dup_ok = true; stkValider(); return; }
            var ph = ''; try { ph = JSON.parse(dup.photo||'{}').thumb || ''; } catch(e){}
            if (ph && typeof photoFullscreen === 'function') photoFullscreen(ph);
            else toast('Réception existante : '+(dup.resume||'')+' — voir « Dernières réceptions »','warning');
          } catch(e){ console.warn('[stock] dup', e); }
        }, null, 'Annuler');
        return;
      }
    } catch(e){ console.warn('[stock] dup check', e); }
    // v495 : lignes du même lot aux noms très proches (variante de lecture) → proposer la fusion
    try {
      if (!d._merge_ok) {
        var pairs = [];
        d.lignes.forEach(function(a, i){ d.lignes.forEach(function(b, j){ if (j > i && a.statut === 'recu' && b.statut === 'recu' && a.lot && _stkNorm(a.lot) === _stkNorm(b.lot) && _stkNorm(a.produit) !== _stkNorm(b.produit) && _stkClose(a.produit, b.produit)) pairs.push([i, j]); }); });
        if (pairs.length) {
          var P = pairs[0], A = d.lignes[P[0]], B = d.lignes[P[1]];
          _stkChoice('🔎 Même produit ?', '« '+_stkE(A.produit)+' » et « '+_stkE(B.produit)+' » — même lot <b>'+_stkE(A.lot)+'</b>. Probable variante de lecture.', [
            { k: 'merge', html: '🔗 Fusionner en « '+_stkE(A.produit)+' » ('+(A.qte+B.qte)+' u.)', hl: true },
            { k: 'keep', html: '↔️ Ce sont 2 produits différents' }
          ], function(o){
            try {
              if (o.k === 'merge') { A.qte = (parseInt(A.qte,10)||0) + (parseInt(B.qte,10)||0); d.lignes.splice(P[1], 1); }
              else d._merge_ok = true;
              stkPersist(); stkValider();
            } catch(e){ console.warn('[stock] merge', e); }
          }, null, 'Annuler');
          return;
        }
      }
    } catch(e){ console.warn('[stock] merge check', e); }
    _stk.busy = true;
    var now = new Date();
    var rec = {
      _ts: now.toISOString(), _sec: STK_SEC,
      // v493 : « date » = date LOCALE de réception (classement des historiques) ; date du BL dans date_bl
      date: _stkToday(), date_bl: d.date || _stkToday(), date_reception: _stkToday(), heure: _stkHM(now),
      fournisseur: d.fournisseur||'', fournisseur_id: d.fournisseur_id||'', numero: d.numero||'',
      cuisinier: who, pages: d.pages.length, produit: 'BL '+(d.fournisseur||'')+' '+(d.numero||''),
      ocr_model: d.ocr_model||'', ocr_detail: d.ocr_detail||'', ocr_lignes_vues: d.ocr_lignes_vues!=null?d.ocr_lignes_vues:'',
      lignes_bl: d.lignes.map(function(l){
        var lot = l.lot, auto = false;
        if (!lot && l.statut === 'recu') { lot = stkLotFromBl(d.fournisseur, d.numero, d.date); auto = true; }
        var o = { produit: l.produit, conditionnement: l.conditionnement, qte_texte: l.qte_texte, qte: l.statut==='recu' ? l.qte : 0, qte_bl: l.qte,
          unite: l.unite, lot: lot, lot_auto: auto, dlc: l.dlc, dlc_type: l.dlc ? _stkDType(l.dlc_type) : '', statut: l.statut, hors_bl: !!l.hors_bl };
        try { if (l._ocr) { var cg = ['produit','lot','dlc','qte'].filter(function(k){ return String(l._ocr[k]||'') !== String((k==='qte'?l.qte:l[k])||''); }); if (cg.length) { o.ocr_lu = l._ocr; o.ocr_corrige = cg; } } } catch(e){}
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
    // Refusés → fiche NC ENR30 créée (même mécanisme que les NC auto de réception : autoCreateNC → compteur NC)
    if (nX) {
      try {
        var refs = rec.lignes_bl.filter(function(l){ return l.statut==='refuse'; });
        var desc = 'Produit(s) refusé(s) à la réception — BL n° '+(rec.numero||'?')+' ('+(rec.fournisseur||'fournisseur ?')+') : '
          + refs.map(function(l){ return l.produit+(l.lot && !l.lot_auto ? ' (lot '+l.lot+')' : ''); }).join(', ');
        if (typeof autoCreateNC === 'function') {
          autoCreateNC('Réception BL '+(rec.numero||rec._ts), desc, 'Réception marchandises', 'Refus de la marchandise / retour fournisseur',
            { non_conformity_type: 'reception', nom_fct: who, _bl_ts: rec._ts, fournisseur: rec.fournisseur||'', bl_numero: rec.numero||'' });
        }
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
function _stkChoice(title, sub, opts, cb, onCancel, cancelLbl){
  try {
    var ov = document.createElement('div');
    ov.className = 'hacc-wait-ov'; ov.id = 'stk-choice-ov';
    ov.innerHTML = '<div class="hacc-wait-card" style="text-align:left;padding:16px;max-width:380px">'
      + '<div class="stk-h">'+_stkE(title)+'</div>' + (sub ? '<div class="stk-sub" style="margin-bottom:8px">'+sub+'</div>' : '')
      + opts.map(function(o, i){ return o.disabled
          ? '<div class="stk-btn big" aria-disabled="true" style="text-align:left;margin:5px 0;opacity:.5;background:#f3f4f6;border-color:#d1d5db;color:#6b7280;cursor:not-allowed">'+o.html+'</div>'
          : '<button class="stk-btn big" style="text-align:left;margin:5px 0;'+(o.hl?'border-color:#f59e0b;background:#fffbeb':'')+'" data-i="'+i+'">'+o.html+'</button>'; }).join('')
      + (cancelLbl === false ? '' : '<button class="stk-btn big" style="margin-top:8px;color:#7a6378" data-i="-1">'+_stkE(cancelLbl||'Annuler')+'</button>') + '</div>';
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
    var G0 = _stkGroup(key); if (!G0) return;
    if (G0.bloque) { toast('⛔ Lot bloqué — ne pas utiliser','warning'); return; }
    // Même produit + lot sur plusieurs BL : choix proposé sur toutes les réceptions, plus ancienne d'abord (FIFO)
    var fam = stkGroups().filter(function(X){ return X.fam === G0.fam && !X.bloque; });
    var G = { produit: G0.produit, lot: G0.lot, items: [], entames: 0 };
    fam.forEach(function(X){ G.items = G.items.concat(X.items); G.entames += X.entames; });
    G.items.sort(function(a,b){ return String(a.date_rec).localeCompare(String(b.date_rec)) || String(a.bl_ts).localeCompare(String(b.bl_ts)); });
    var opts = [];
    G.items.forEach(function(it){
      var pe = _stkPerime(it.dlc, it.dlc_type);
      if (pe === 'dlc') return; // v494 : un produit à DLC dépassée ne s'ouvre jamais — il se jette
      if (it.entames > 0) opts.push({ kind: 'ent', it: it, hl: true, html: (pe==='ddm'?'⚠️ DDM dépassée · ':'')+'🟠 Continuer l\'entamé ('+_stkE(_stkUnitSg(it.unite))+') — reçu le '+_stkFr(it.date_rec)+'<br><small>ouvert le '+_stkFr(it.ouverts[0])+' · à finir en priorité</small>' });
    });
    G.items.forEach(function(it, j){
      var pe = _stkPerime(it.dlc, it.dlc_type);
      if (pe === 'dlc') return;
      if (it.neufs > 0) opts.push({ kind: 'neuf', it: it, html: (pe==='ddm'?'⚠️ DDM dépassée · ':'')+'🟢 Ouvrir un neuf — reçu le '+_stkFr(it.date_rec)+' (BL '+_stkE(it.bl_numero||'?')+')<br><small>'+it.neufs+' neuf'+(it.neufs>1?'s':'')+(it.dlc?' · '+_stkDType(it.dlc_type)+' '+_stkFrY(it.dlc):'')+(G.entames?' · ⚠️ il reste un entamé':'')+'</small>' });
    });
    // Le neuf le plus ancien est mis en avant quand il n'y a pas d'entamé
    try { if (!G.entames) { var fn = opts.find(function(o){ return o.kind === 'neuf'; }); if (fn) fn.hl = true; } } catch(e){}
    if (!opts.length) {
      var exp = G.items.some(function(it){ return it.dispo > 0 && _stkPerime(it.dlc, it.dlc_type) === 'dlc'; });
      toast(exp ? '⛔ DLC dépassée — ne pas ouvrir : à jeter (bouton 🗑️ Jeter)' : 'Plus rien en stock pour ce produit','warning'); return;
    }
    var go = function(o){
      try {
        if (o.kind === 'ent') { toast('🟠 On continue l\'entamé ('+_stkUnitSg(o.it.unite)+')','success'); if (after) after(o.it, defer ? 'ent' : null); return; }
        if (G.entames > 0) toast('⚠️ Attention : il reste un entamé de ce lot — à utiliser en priorité','warning');
        if (defer) { if (after) after(o.it, 'neuf'); return; }
        var row = stkMvt('entame', o.it, { from: 'neuf' });
        if (after) after(o.it, row); else { toast('✅ '+o.it.produit+' entamé','success'); _stkRefresh(); }
      } catch(e){ console.warn('[stock] entamer go', e); }
    };
    // Choix seulement si entamé ET neuf, ou plusieurs entamés ; sinon prise directe (entamé unique / neuf le plus ancien)
    var oE = opts.filter(function(o){ return o.kind === 'ent'; }), oN = opts.filter(function(o){ return o.kind === 'neuf'; });
    if (oE.length === 1 && !oN.length) { go(oE[0]); return; }
    if (!oE.length && oN.length) { go(oN[0]); return; }
    var multi = G.items.length > 1 ? ('Lot '+_stkE(G.lot)+' reçu sur '+G.items.length+' livraisons — la plus ancienne d\'abord (FIFO)') : (G.entames ? 'Un entamé existe déjà — on le continue ou on ouvre un neuf ?' : 'Lequel ouvres-tu ?');
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
/** v494 — Historique des produits jetés (mouvements « jete »), du plus récent au plus ancien. */
function _stkJetes(from, to){
  try { return _stkMvts().filter(function(m){ return m.type === 'jete' && (!from || (m.date||'') >= from) && (!to || (m.date||'') <= to); }).sort(function(a,b){ return String(b._ts).localeCompare(String(a._ts)); }); } catch(e){ return []; }
}
function _stkJetesCard(limit, title){
  try {
    var J = _stkJetes().slice(0, limit || 10); if (!J.length) return '';
    return '<div class="card"><div class="stk-h">'+_stkE(title||'🗑️ Produits jetés')+'</div>' + J.map(function(m){
      return '<div class="stk-line"><div class="nm">'+_stkE(m.produit||'?')+' — '+_stkE(m.n||1)+' u.</div><div class="mt">'+_stkFrY(m.date)+' '+_stkE(m.heure||'')+' par '+_stkE(m.cuisinier||'?')+' · motif : '+_stkE(m.motif||'—')+' · lot '+_stkE(m.lot||'—')+' · BL '+_stkE(m.bl_numero||'?')+'</div></div>';
    }).join('') + '</div>';
  } catch(e){ return ''; }
}
/** v494 — Jeter : confirmation, motif (DLC dépassée / abîmé / autre), mouvement « jete » append-only (qui / quand / combien / pourquoi). */
function stkJeter(key){
  try {
    var who = _stkNeedWho(); if (!who) return;
    var G = _stkGroup(key); if (!G) return;
    var items = G.items.filter(function(i){ return i.dispo > 0; });
    if (!items.length) { toast('Plus rien en stock sur cette ligne','warning'); return; }
    var nE = items.reduce(function(s,i){ return s+i.entames; },0), nN = items.reduce(function(s,i){ return s+i.neufs; },0), tot = nE + nN;
    var expired = _stkPerime(G.dlc, G.dlc_type) === 'dlc';
    var record = function(qty, motif){
      try {
        var left = qty, n = 0;
        items.forEach(function(it){
          if (left <= 0) return;
          var e = qty >= tot ? it.entames : Math.min(it.entames, left); left -= e;
          var nn = qty >= tot ? it.neufs : Math.min(it.neufs, Math.max(0, left)); left -= nn;
          if (!(e + nn)) return;
          stkMvt('jete', it, { n: e + nn, n_ent: e, n_neuf: nn, motif: motif, dlc_type: it.dlc_type || '' });
          n += e + nn;
        });
        toast('🗑️ '+G.produit+' — '+n+' unité'+(n>1?'s':'')+' jetée'+(n>1?'s':'')+' ('+motif+') — tracé','success');
        _stkRefresh();
      } catch(e){ console.warn('[stock] jeter rec', e); try{ toast('⚠️ Erreur — rien n\'a été jeté','warning'); }catch(_e){} }
    };
    var askQty = function(motif){
      try {
        if (tot <= 1) { record(tot, motif); return; }
        _stkChoice('🗑️ Jeter — '+G.produit, 'Motif : '+_stkE(motif), [
          { k: 'all', html: '🗑️ Tout jeter ('+tot+' unité'+(tot>1?'s':'')+(nE?' dont '+nE+' entamé'+(nE>1?'s':''):'')+')', hl: true },
          { k: 'one', html: '🗑️ Jeter 1 unité'+(nE?' (l\'entamé)':'') }
        ], function(o){ record(o.k === 'all' ? tot : 1, motif); }, null, 'Ne rien jeter');
      } catch(e){ console.warn('[stock] jeter qty', e); }
    };
    var sub = '<div><b>'+_stkE(G.produit)+'</b> — lot '+_stkE(G.lot||'—')+'</div><div>'+tot+' en stock'+(G.dlc?' · '+_stkDType(G.dlc_type)+' '+_stkFrY(G.dlc):'')+'</div>'
      + (expired ? '<div style="color:#991b1b;font-weight:800;margin-top:4px">⛔ DLC dépassée : un produit périmé ne s\'ouvre jamais, il se jette.</div>' : '');
    var opts = [{ k: 'DLC dépassée', html: '⛔ DLC dépassée', hl: expired }, { k: 'Produit abîmé', html: '💥 Abîmé (emballage, aspect, odeur…)' }, { k: 'autre', html: '✍️ Autre motif…' }];
    _stkChoice('🗑️ Jeter ce produit ?', sub + '<div style="margin-top:6px">Pourquoi ?</div>', opts, function(o){
      if (o.k !== 'autre') { askQty(o.k); return; }
      showPrompt('Motif — '+G.produit, 'Obligatoire — tracé avec ton nom et l\'heure', 'Ex : rupture chaîne du froid', function(m){
        m = String(m||'').trim(); if (!m) { toast('⚠️ Motif obligatoire','warning'); return; }
        askQty(m);
      }, 'Suivant');
    }, null, 'Ne rien jeter');
  } catch(e){ console.warn('[stock] jeter', e); }
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
      date: _stkToday(), produit: it.produit, lot: o.lot || it.lot || '—', dlc: o.dlc || it.dlc_lue || it.dlc || '', dlc_type: it.dlc_type || '',
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
        { k: 'camera', html: '📷 Caméra', hl: true }, { k: 'gallery', html: '🖼️ Galerie (1 ou 2 photos)' }, { k: 'none', html: '🚫 Pas d\'étiquette sur ce produit' }, { k: 'nophoto', html: '➡️ Continuer sans photo (fiche traçabilité sans photo)' }
      ], function(o){
        try {
          if (o.k === 'none' || o.k === 'nophoto') { done(it, stkCommitEntame(it, 'neuf', {})); return; }
          var handled = false;
          var finish = function(files){
            if (handled) return; handled = true;
            try { window.removeEventListener('focus', onFocus); } catch(e){}
            if (files && files.length) stkLabelFiles(it, files, done);
            else { toast('Pas de photo — fiche traçabilité remplie avec le lot du BL','warning'); done(it, stkCommitEntame(it, 'neuf', {})); }
          };
          var inp = _stkFileInput(o.k === 'camera' ? 'stk-lbl-cam' : 'stk-lbl-gal', o.k === 'camera', o.k !== 'camera');
          if (!inp) { finish(null); return; }
          inp.addEventListener('change', function(ev){ try { ev.stopPropagation(); } catch(e){} var f = inp.files; try { inp.remove(); } catch(e){} finish(f); });
          inp.addEventListener('cancel', function(){ try { inp.remove(); } catch(e){} finish(null); });
          // Repli (navigateurs sans évènement « cancel ») : retour au premier plan sans fichier
          var onFocus = function(){ setTimeout(function(){ if (!handled && !(inp.files && inp.files.length)) finish(null); }, 1500); };
          setTimeout(function(){ try { window.addEventListener('focus', onFocus); } catch(e){} }, 400);
          inp.click();
        } catch(e){ console.warn('[stock] label pick', e); done(it, stkCommitEntame(it, 'neuf', {})); }
      }, function(){ toast('Ouverture annulée — rien n\'a été enregistré','success'); done(null, null); }); // « Annuler » = vrai abandon
    } catch(e){ console.warn('[stock] entamerFlow', e); }
  }, true);
}
function stkEntamerPhoto(key){
  stkEntamerFlow(key, function(it, rec){
    if (!(it && rec)) { _stkRefresh(); return; }
    toast('✅ Entamé — fiche traçabilité remplie','success');
    _stkAskDishes(it, rec, function(){ _stkRefresh(); });
  });
}
/** v493 : après « J'entame » depuis le Stock, proposer (facultatif) les plats du menu du jour à lier. */
function _stkAskDishes(it, rec, cb){
  cb = cb || function(){};
  try {
    var plats = [];
    try { plats = (window._stkMenuApi && window._stkMenuApi.todayMenuPlats) ? window._stkMenuApi.todayMenuPlats() : []; } catch(e){ plats = []; }
    if (!plats.length) { cb(); return; }
    var ov = document.createElement('div');
    ov.className = 'hacc-wait-ov'; ov.id = 'stk-ask-dish-ov';
    ov.innerHTML = '<div class="hacc-wait-card" style="text-align:left;padding:16px;max-width:400px;max-height:85vh;overflow:auto">'
      + '<div class="stk-h">🍽️ Utilisé dans quel plat ?</div><div class="stk-sub" style="margin-bottom:8px">'+_stkE(it.produit)+' — facultatif, coche les plats du menu du jour qui l\'utilisent.</div>'
      + plats.map(function(x, i){ return '<label class="stk-line" style="display:flex;gap:8px;align-items:center;cursor:pointer;padding:8px"><input type="checkbox" data-pi="'+i+'" style="width:20px;height:20px;accent-color:#16a34a"><span><b>'+_stkE(x.p.nom)+'</b>'+(x.svc && x.svc.label ? ' <small>('+_stkE(x.svc.label)+')</small>' : '')+'</span></label>'; }).join('')
      + '<button class="stk-btn ok big" data-ok="1" style="margin-top:8px">🔗 Lier aux plats cochés</button>'
      + '<button class="stk-btn big" data-no="1" style="margin-top:6px">Pas de plat pour l\'instant</button></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function(ev){
      try {
        if (ev.target === ov || ev.target.closest('[data-no]')) { ov.remove(); cb(); return; }
        if (!ev.target.closest('[data-ok]')) return;
        var refs = [], svc = '';
        ov.querySelectorAll('input[data-pi]:checked').forEach(function(c){
          var x = plats[parseInt(c.getAttribute('data-pi'),10)]; if (!x) return;
          refs.push({ plat_id: x.p.plat_id, nom: x.p.nom, menu_id: x.menu_id || '', profil_haccp: x.p.profil_haccp || '' });
          if (!svc && x.svc) svc = x.svc.label || x.svc.id || '';
        });
        ov.remove();
        if (refs.length) { var n = stkUseForDish(it, rec, refs, 'entame', { service: svc, date: _stkToday() }); if (n) toast('🔗 Lié à '+refs.map(function(r){ return r.nom; }).join(', '),'success'); }
        cb();
      } catch(e){ console.warn('[stock] askDish', e); try { ov.remove(); } catch(_e){} cb(); }
    });
  } catch(e){ console.warn('[stock] askDishes', e); cb(); }
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
  try { dlc = _stkIso(prop && prop.dlc); } catch(e){}
  if (!prop) toast('Étiquette non lue — lot du BL gardé, photo jointe','warning');
  var commit = function(useLot){
    try {
      var rec = stkCommitEntame(it, 'neuf', { lot: useLot || it.lot, dlc: dlc || it.dlc, estampille: (prop && prop.estampille) || '',
        p1: pairs[0] || null, p2: pairs[1] || null, lot_lu: lot, dlc_lue: dlc });
      done(it, rec);
    } catch(e){ console.warn('[stock] label commit', e); done(null, null); }
  };
  // v493 : l'étiquette lue doit correspondre au produit / lot du BL choisi — sinon on demande (jamais de rattachement silencieux)
  var lotDiff = !!(lot && it.lot && !it.lot_auto && _stkNorm(lot) !== _stkNorm(it.lot));
  var prodDiff = !!(prop && prop.produit && !_stkSameProduct(prop.produit, it.produit));
  if (lotDiff || prodDiff) {
    var sub = (prodDiff ? '<div style="color:#991b1b;font-weight:800">Étiquette lue : « '+_stkE(prop.produit)+' »</div><div>Produit du BL : « '+_stkE(it.produit)+' » ('+_stkE(it.fournisseur||'?')+', BL '+_stkE(it.bl_numero||'?')+')</div>' : '')
      + (lotDiff ? '<div style="margin-top:4px">Lot étiquette <b>'+_stkE(lot)+'</b> ≠ lot du BL <b>'+_stkE(it.lot)+'</b></div>' : '');
    var opts = [];
    if (!it.lot_auto && it.lot) opts.push({ k: 'bl', html: '📄 Garder le lot du BL ('+_stkE(it.lot)+')', hl: !prodDiff });
    if (lot) opts.push({ k: 'lbl', html: '🏷️ Utiliser le lot de l\'étiquette ('+_stkE(lot)+')' });
    if (!opts.length) opts.push({ k: 'bl', html: '📄 Continuer avec le lot du BL' });
    opts.push({ k: 'no', html: '✋ Ce n\'est pas ce produit — ne rien enregistrer', hl: prodDiff });
    _stkChoice('⚠️ Étiquette ≠ BL', sub, opts, function(o){
      if (o.k === 'no') { toast('Rien n\'a été enregistré — choisis le bon produit dans le stock','warning'); done(null, null); return; }
      commit(o.k === 'lbl' ? lot : it.lot);
    }, function(){ done(null, null); }, false);
    return;
  }
  commit(lot || it.lot);
}
/** Date OCR (ISO ou JJ/MM/AAAA, JJ/MM/AA) → ISO, sinon '' */
function _stkIso(v){
  try {
    var t = String(v||'').trim(), m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1]+'-'+m[2]+'-'+m[3];
    m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
    if (m) return (m[3].length === 2 ? '20'+m[3] : m[3])+'-'+('0'+m[2]).slice(-2)+'-'+('0'+m[1]).slice(-2);
  } catch(e){}
  return '';
}
/** Même produit ? au moins un mot significatif (≥ 4 lettres) en commun */
function _stkSameProduct(a, b){
  try {
    var w = function(x){ return _stkNorm(x).replace(/[^a-z0-9 ]/g,' ').split(' ').filter(function(t){ return t.length >= 4; }).map(function(t){ return t.replace(/s$/,''); }); };
    var A = w(a), B = w(b);
    if (!A.length || !B.length) return true;
    return A.some(function(t){ return B.some(function(u){ return u.indexOf(t) === 0 || t.indexOf(u) === 0; }); });
  } catch(e){ return true; }
}
/** v493 : DLC dépassée = refus de lier à un plat (comme un lot bloqué) ; DDM dépassée = simple avertissement. true = refusé. */
function stkDlcLinkCheck(l){
  try {
    if (!l) return false;
    var d = _stkIso(l.dlc); if (!d || d >= _stkToday()) return false;
    var typ = l.dlc_type;
    if (!typ && l._stock_item_id) { var it = stkItems().find(function(i){ return i.id === l._stock_item_id; }); if (it) typ = it.dlc_type; }
    if (_stkDType(typ) === 'DDM') { try { toast('⚠️ DDM dépassée ('+_stkFrY(d)+') pour '+(l.produit||'ce produit')+' — vérifie l\'aspect avant usage','warning'); } catch(e){} return false; }
    try { toast('⛔ DLC dépassée ('+_stkFrY(d)+') — '+(l.produit||'produit')+' ne peut pas être lié à un plat','error',{ force: true }); } catch(e){}
    _stkChoice('⛔ DLC dépassée', '<div style="color:#991b1b;font-weight:800">'+_stkE(l.produit||'')+' — lot '+_stkE(l.lot||'—')+'</div><div>DLC : '+_stkFrY(d)+'</div><div style="margin-top:6px">Un produit à DLC dépassée ne doit pas être utilisé ni lié à un plat. Isole-le (non-conformité / destruction).</div>',
      [{ k: 'ok', html: '✋ J\'ai compris — je n\'utilise pas ce produit', hl: true }], function(){}, null, false);
    return true;
  } catch(e){ console.warn('[stock] dlcCheck', e); return false; }
}
window.stkDlcLinkCheck = stkDlcLinkCheck;

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
      + '<div style="margin-top:6px">Ce lot ne peut pas être utilisé ni lié à un plat.</div>', [{ k: 'ok', html: '✋ J\'ai compris — je n\'utilise pas ce lot', hl: true }], function(){}, null, false);
  } catch(e){ console.warn('[stock] blockedAlert', e); }
}
/** Utilisé par app-menu-cuisine (_menuSetLotPlat) : true = refusé. */
window.stkLotBlockCheck = function(l){
  try { var b = l ? stkBlockedInfo(l.lot, l.produit) : null; if (b) { stkBlockedAlert(b); return true; } } catch(e){}
  try { if (stkDlcLinkCheck(l)) return true; } catch(e){}
  return false;
};

/** Sélecteur « Choisir dans le stock » : produits cochés → switch entamé / fini, puis même parcours que J'entame. */
function stkPickForDish(ref, ctx){
  try {
    if (!_stkNeedWho()) return;
    ctx = ctx || {};
    var groups = stkGroups().filter(function(G){ return G.dispo > 0 && !G.bloque && _stkPerime(G.dlc, G.dlc_type) !== 'dlc'; }); // v494 : DLC dépassée jamais proposée
    // v495 : une seule ligne par produit + lot (le choix de la réception se fait ensuite, FIFO) — plus de doublons visuels
    try { var seenF = {}; groups = groups.filter(function(G){ if (seenF[G.fam]) return false; seenF[G.fam] = 1; return true; }); } catch(e){}
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
          var pe = _stkPerime(G.dlc, G.dlc_type);
          return '<div class="stk-line" style="display:flex;align-items:center;gap:8px;padding:8px">'
            + '<input type="checkbox" data-gi="'+i+'" style="width:20px;height:20px;accent-color:#16a34a">'
            + '<div style="flex:1;min-width:0"><div class="nm">'+_stkE(G.produit)+'</div><div class="mt">'+src+(G.entames?' · entamé '+_stkFr(G.ouvert_le):' · neuf')+(pe==='ddm'?' · <b style="color:#c2410c">⚠️ DDM dépassée ('+_stkFrY(G.dlc)+')</b>':'')+'</div></div>'
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
        // v495 : sélection du bandeau vidée DÈS la validation (avant : seulement en fin de chaîne → restait cochée si un produit était annulé)
        try { if (pend.length && window._stkMenuApi && window._stkMenuApi.clearPending) window._stkMenuApi.clearPending('enr31'); } catch(e){}
        var linked = 0, n = 0;
        var next = function(){
          if (!todo.length) {
            try { if (pend.length && window._stkMenuApi && window._stkMenuApi.clearPending) window._stkMenuApi.clearPending('enr31'); } catch(e){}
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
    try { if (refs.length && (window.stkLotBlockCheck(rec || { lot: it.lot, produit: it.produit, dlc: it.dlc, dlc_type: it.dlc_type }))) refs = []; } catch(e){}
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
    if (refs.length) stkMvt('usage', it, { plat_id: refs.map(function(z){ return z.plat_id; }).join(','), plat: refs.map(function(z){ return z.nom; }).join(', '),
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
function _stkAddDays(ymd, n){ try { var d = new Date(ymd+'T12:00'); d.setDate(d.getDate()+n); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); } catch(e){ return ''; } }
/** Durée de conservation après ouverture connue ? (mémoire locale par produit, puis DLC_BASE par nom) */
function _stkDlcOuvJ(produit){
  try {
    var m = ((S.config||{}).stk_dlc_ouv||{})[_stkNorm(produit)];
    if (m != null && !isNaN(parseInt(m,10))) return parseInt(m,10);
    var fj = _stkFamOuvJ(produit); if (fj != null) return fj;
    if (typeof DLC_BASE !== 'undefined') {
      var n = _stkNorm(produit).split(' ')[0];
      var b = n && n.length > 3 && DLC_BASE.find(function(p){ return p && p.dlc_j != null && !p.dlc_ddm && _stkNorm(p.produit).indexOf(n) >= 0; });
      if (b) return parseInt(b.dlc_j,10);
    }
  } catch(e){}
  return null;
}
/** v498 : durées par défaut APRÈS OUVERTURE par famille (jours) — proposées, toujours confirmées ;
 *  modifiables par site via S.config.stk_dlc_ouv_fam = { vinaigrette: 5, … } (clé = famille ci-dessous). */
var STK_OUV_FAM = [
  { k: 'vinaigrette', re: /\b(vinaigrette|sauce salade)\b/, j: 7 },
  { k: 'mayonnaise', re: /\b(mayonnaise|mayo|aioli|tartare|remoulade)\b/, j: 3 },
  { k: 'sauce', re: /\b(sauce|coulis|fond|jus|bechamel|veloute)\b/, j: 3 },
  { k: 'compote', re: /\b(compote|puree de fruits?|fruits? au sirop)\b/, j: 3 },
  { k: 'pate', re: /\b(pate (feuilletee|brisee|sablee|a pizza|fraiche)|pates fraiches|pate)\b/, j: 2 },
  { k: 'creme', re: /\b(creme|lait|yaourt|fromage blanc)\b/, j: 3 },
  { k: 'charcuterie', re: /\b(jambon|lardons?|bacon|saucisson|chorizo|charcuterie|cervelas)\b/, j: 3 },
  { k: 'fromage', re: /\b(fromage|emmental|comte|camembert|brie|mozzarella|rape)\b/, j: 5 },
  { k: 'conserve', re: /\b(conserve|boite|macedoine|mais|thon|haricots?|petits pois|tomate concassee|concentre)\b/, j: 3 },
  { k: 'condiment', re: /\b(ketchup|moutarde|cornichons?|capres|olives)\b/, j: 30 }
];
function _stkFamOuvJ(produit){
  try {
    var n = _stkNorm(produit), f = STK_OUV_FAM.find(function(x){ return x.re.test(n); });
    if (!f) return null;
    var ov = ((S.config||{}).stk_dlc_ouv_fam||{})[f.k];
    return (ov != null && !isNaN(parseInt(ov,10))) ? parseInt(ov,10) : f.j;
  } catch(e){ return null; }
}
window.STK_OUV_FAM = STK_OUV_FAM;
/** Étiquette « Entamé » depuis le stock : DLC = date d'ouverture + durée après ouverture (jamais la DDM du sac). */
function stkEtiq(G, itX, kX){
  try {
    if (!G && !itX) return;
    var it = itX || G.items.find(function(x){ return x.entames > 0; }); if (!it) return;
    var k = (kX != null) ? kX : _stkEtiqIdx(G);
    var ouv = it.ouverts[0] || _stkToday();
    var go = function(j){
      try {
        var dlc = '';
        if (j != null && !isNaN(j)) { dlc = _stkAddDays(ouv, j); if (it.dlc && _stkDType(it.dlc_type) === 'DLC' && it.dlc < dlc) dlc = it.dlc; }
        S['enr34'] = S['enr34'] || {};
        var r = k >= 0 ? (((S.enr31||{}).lignes||[])[k]||{}) : {};
        S['enr34'].draft34 = { produit: it.produit||r.produit||'', statut: 'Entamé', date_fab: ouv, heure_fab: (typeof nowT === 'function' ? nowT() : _stkHM()),
          dlc: dlc, stockage: '0 / +3°C', cuisinier34: _stkWho() || r.cuisinier || '' };
        save();
        goTo('enr34');
        toast(dlc ? ('🏷️ Étiquette Entamé — DLC après ouverture '+_stkFrY(dlc)) : '🏷️ Étiquette Entamé — saisis la DLC après ouverture', dlc ? 'success' : 'warning');
      } catch(e){ console.warn('[stock] etiq go', e); }
    };
    // Sécurité alimentaire : la durée proposée (mémoire ou DLC_BASE) est TOUJOURS montrée et doit être confirmée
    var j = _stkDlcOuvJ(it.produit);
    showPrompt('DLC après ouverture — '+it.produit, 'Ouvert le '+_stkFrY(ouv)+'. '+(j != null ? ('Durée proposée : '+j+' jour'+(j>1?'s':'')+' — vérifie l\'emballage, confirme ou modifie. ') : 'Combien de jours se conserve-t-il une fois ouvert ? (voir l\'emballage) ')+'Laisse vide pour saisir la date à la main.', 'Ex : 3', function(v){
      try {
        var n = parseInt(String(v||'').trim(),10);
        if (!isNaN(n) && n >= 0 && n < 400) { S.config = S.config || {}; S.config.stk_dlc_ouv = S.config.stk_dlc_ouv || {}; S.config.stk_dlc_ouv[_stkNorm(it.produit)] = n; go(n); }
        // v498 : produit à DDM seule → la durée après ouverture est obligatoire (jamais « DLC: DDM »)
        else if (!it.dlc || _stkDType(it.dlc_type) === 'DDM') { toast('⛔ DDM seule : indique la durée de conservation après ouverture (en jours)','warning',{ force: true }); setTimeout(function(){ try { stkEtiq(G, itX, kX); } catch(e){} }, 150); }
        else go(null);
      } catch(e){ console.warn('[stock] etiq prompt', e); go(null); }
    }, 'Confirmer et créer l\'étiquette');
    try { if (j != null) { var pi = document.getElementById('prompt-input'); if (pi) pi.value = String(j); } } catch(e){}
  } catch(e){ console.warn('[stock] etiq', e); }
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
      try { stkEtiq((_stk.view||[])[i]); } catch(e){ console.warn('[stock] etiq', e); }
    };
  } catch(e){ console.warn('[stock] hook etiq', e); }
  try {
    // Fiche ENR31 : bouton « Choisir dans le stock » à côté de la saisie manuelle
    if (typeof REND !== 'undefined' && typeof REND['enr31'] === 'function') {
      var _r31 = REND['enr31'];
      REND['enr31'] = function(){
        var h = _r31.apply(this, arguments);
        try {
          try { h = h + _stkJetesCard(10); } catch(e){}
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

/* ════════════════════════════════════════════════════════════════════
 * PR C (v490) — Rappel de lot : lot → BL, plats concernés, stock, « Bloquer ce lot »,
 * + export PDF (inspecteur) et branchement exports existants (Audit / Traça MP).
 * ════════════════════════════════════════════════════════════════════ */
_stk.rq = '';
/** Rapport complet pour un lot (recherche tolérante : lot, produit). */
function stkRecall(q){
  var out = { q: q, lots: [] };
  try {
    var n = _stkNorm(q); if (!n) return out;
    var items = stkItems().filter(function(i){ return _stkNorm(i.lot).indexOf(n) >= 0 || _stkNorm(i.lot_lu||'').indexOf(n) >= 0; });
    var e31 = ((S.enr31||{}).lignes||[]).filter(function(l){ return l && !l._deleted && _stkNorm(l.lot).indexOf(n) >= 0; });
    var keys = {}, reg = [];
    items.forEach(function(i){ var k = _stkFamKey(reg, i.produit, i.lot); (keys[k] = keys[k] || { produit: i.produit, lot: i.lot, items: [], e31: [] }).items.push(i); });
    e31.forEach(function(l){
      var it = l._stock_item_id && items.find(function(i){ return i.id === l._stock_item_id; });
      var k = it ? _stkFamKey(reg, it.produit, it.lot) : _stkFamKey(reg, l.produit, l.lot);
      (keys[k] = keys[k] || { produit: l.produit, lot: l.lot, items: [], e31: [] }).e31.push(l);
    });
    var mv = _stkMvts();
    Object.keys(keys).forEach(function(k){
      var L = keys[k], ids = {};
      L.items.forEach(function(i){ ids[i.id] = 1; });
      var bls = {}, plats = [];
      L.items.forEach(function(i){ bls[i.bl_ts] = { fournisseur: i.fournisseur, numero: i.bl_numero, date: i.bl_date, date_rec: i.date_rec }; });
      // v493 : plats dédoublonnés (même plat + même jour = 1 ligne, service complété si connu)
      var addPlat = function(nom, date, service, par){
        try {
          nom = String(nom||'').trim(); if (!nom) return;
          var ex = plats.find(function(x){ return _stkNorm(x.nom) === _stkNorm(nom) && x.date === date; });
          if (ex) { if (!ex.service && service) ex.service = service; return; }
          plats.push({ nom: nom, date: date || '', service: service || '', par: par || '' });
        } catch(e){}
      };
      // v496 : source unique = liste de plats de la fiche ENR31 (comme ✅) ; les anciens libellés
      // m.plat des mouvements (sélection non vidée) ne servent qu'en secours si aucune fiche n'est liée.
      var _e31Plats = 0; L.e31.forEach(function(l){ try { _e31Plats += _stkPlatsOf(l).length; } catch(e){} });
      mv.filter(function(m){ return !_e31Plats && ids[m.item_id] && m.type === 'usage' && m.plat; }).forEach(function(m){
        String(m.plat).split(', ').forEach(function(n){ addPlat(n, m.date_service || m.date, m.service || '', m.cuisinier || ''); });
      });
      L.e31.forEach(function(l){
        try { _stkPlatsOf(l).forEach(function(n){ addPlat(n, l.date || '', '', l.cuisinier || ''); }); } catch(e){}
      });
      plats.sort(function(a,b){ return String(a.date).localeCompare(String(b.date)); });
      L.bls = Object.keys(bls).map(function(t){ return bls[t]; });
      L.plats = plats;
      L.entames = L.items.reduce(function(s,i){ return s+i.entames; },0);
      L.neufs = L.items.reduce(function(s,i){ return s+i.neufs; },0);
      L.bloque = L.items.some(function(i){ return i.bloque; });
      L.motif = (L.items.find(function(i){ return i.bloque; })||{}).bloque_motif || '';
      out.lots.push(L);
    });
  } catch(e){ console.warn('[stock] recall', e); }
  return out;
}
var _stkPlatIdx = null, _stkPlatIdxT = 0;
/** v498 : id de plat → nom actuel dans S.menus (index recalculé au plus toutes les 5 s). */
function _stkPlatNomActuel(id){
  try {
    if (!id) return '';
    if (!_stkPlatIdx || Date.now() - _stkPlatIdxT > 5000) {
      _stkPlatIdx = {}; _stkPlatIdxT = Date.now();
      var M = S.menus || {}, keys = Object.keys(M).sort(); // ordre chronologique : le plus récent écrase
      keys.forEach(function(k){ try { var c = (M[k] && M[k].categories) || {}; Object.keys(c).forEach(function(ck){ (c[ck]||[]).forEach(function(p){ if (p && p.plat_id && p.nom) _stkPlatIdx[String(p.plat_id)] = p.nom; }); }); } catch(e){} });
    }
    return _stkPlatIdx[String(id)] || '';
  } catch(e){ return ''; }
}
/** Noms des plats liés à une fiche ENR31 (tous, dédoublonnés). */
function _stkPlatsOf(l){
  var out = [];
  try {
    var add = function(n){ n = String(n||'').trim(); if (n && !out.some(function(x){ return _stkNorm(x) === _stkNorm(n); })) out.push(n); };
    // v498 : nom ACTUEL du plat dans le menu (par id), anciens noms regroupés ; sinon nom normalisé (dédoublonné par add)
    (Array.isArray(l && l._plat_liens) ? l._plat_liens : []).forEach(function(p){ if (p) add(_stkPlatNomActuel(p.plat_id) || p.nom); });
    (Array.isArray(l && l._plat_ids) ? l._plat_ids : []).forEach(function(id){ var n = _stkPlatNomActuel(id); if (n) add(n); });
    if (l && l._plat_nom) add(l._plat_nom);
  } catch(e){}
  return out;
}
window._stkPlatsOf = _stkPlatsOf;
/** v496 : nom affiché normalisé (variantes OCR/saisie : arrivée ↔ arrivage, espaces, casse). */
function _stkCanonNom(n){
  try { return String(n||'').replace(/\barriv[ée]e(s)?\b/gi, 'arrivage').replace(/\s+/g,' ').trim(); } catch(e){ return String(n||''); }
}
window._stkCanonNom = _stkCanonNom;
/** v496 : source unique pour une fiche ENR31 dans les exports — article de stock (id, sinon lot+nom proche),
 *  DLC (tous les champs connus : fiche, lecture étiquette, BL), statut jeté. */
function _stkInfoFor31(r){
  var o = { item: null, produit: '', dlc: '', dlc_type: '', jete: false };
  try {
    r = r || {};
    var items = stkItems();
    var it = r._stock_item_id ? items.find(function(x){ return x.id === r._stock_item_id; }) : null;
    if (!it && r.lot && r.lot !== '—') {
      var ln = _stkNorm(r.lot), pn = _stkNorm(r.produit);
      it = items.find(function(x){ return _stkNorm(x.lot) === ln && _stkClose(_stkNorm(x.produit), pn); }) || null;
    }
    o.item = it;
    o.produit = _stkCanonNom(r.produit || (it && it.produit) || '');
    o.dlc = _stkIso(r.dlc) || _stkIso(r.ddm) || _stkIso(r.dluo) || _stkIso(r.dlc_lue) || (it ? (_stkIso(it.dlc_lue) || _stkIso(it.dlc)) : '');
    o.dlc_type = r.dlc_type || (it && it.dlc_type) || '';
    // statut Jeté seulement si TOUS les retraits sont des jets (aucun « fini ») et plus rien en stock
    o.jete = !!(it && it.jetes && it.jetes.length && (it.jete_ent + it.jete_neuf) > 0 && (it.fin_ent + it.fin_neuf) === 0 && (it.entames + it.neufs) === 0);
  } catch(e){}
  return o;
}
window._stkInfoFor31 = _stkInfoFor31;
function stkRecallHtml(q){
  try {
    if (!String(q||'').trim()) return '<div class="stk-sub">Tape un n° de lot (ou une partie) pour voir les BL, les plats concernés et le stock restant.</div>';
    var R = stkRecall(q);
    if (!R.lots.length) return '<div class="empty-s">Aucun lot trouvé pour « '+_stkE(q)+' ».</div>';
    return R.lots.map(function(L, i){
      return '<div class="stk-line"'+(L.bloque?' style="border-color:#fca5a5;background:#fff5f5"':'')+'>'
        + '<div class="nm">'+_stkE(L.produit)+'</div><div class="mt">Lot <b>'+_stkE(L.lot||'—')+'</b></div>'
        + '<div class="mt">'+(L.bls.length ? ('Reçu : '+L.bls.map(function(b){ return _stkE(/^BL/i.test(b.numero||'')?b.numero:'BL '+(b.numero||'?'))+' ('+_stkE(b.fournisseur||'?')+') du '+_stkFr(b.date)+(b.date_rec && b.date_rec!==b.date?' · reçu le '+_stkFr(b.date_rec):''); }).join(' · ')) : 'Hors stock (saisie Traçabilité MP manuelle)')+'</div>'
        + '<div class="stk-h" style="font-size:.78rem;margin-top:8px">PLATS CONCERNÉS ('+L.plats.length+')</div>'
        + (L.plats.length ? L.plats.map(function(p){ return '<div class="mt">🍽️ '+_stkE(p.nom)+' — '+_stkFr(p.date)+(p.service?' '+_stkE(p.service):'')+'</div>'; }).join('') : '<div class="mt">Aucun plat lié</div>')
        + '<div class="stk-h" style="font-size:.78rem;margin-top:8px">EN STOCK</div>'
        + L.items.slice().sort(function(a,b){ return String(a.date_rec).localeCompare(String(b.date_rec)); }).map(function(it){ return '<div class="mt">• BL '+_stkE(it.bl_numero||'?')+' reçu le '+_stkFrY(it.date_rec)+' : '+it.entames+' entamé'+(it.entames>1?'s':'')+' · '+it.neufs+' neuf'+(it.neufs>1?'s':'')+(it.jetes.length?' · 🗑️ '+it.jetes.map(function(j){ return j.n+' jeté'+(j.n>1?'s':'')+' le '+_stkFr(j.date)+' ('+_stkE(j.motif)+', '+_stkE(j.par)+')'; }).join(', '):'')+'</div>'; }).join('')
        + '<div class="mt"><b>Total : '+L.entames+' entamé'+(L.entames>1?'s':'')+' · '+L.neufs+' neuf'+(L.neufs>1?'s':'')+'</b>'+(L.bloque?' · <span style="color:#991b1b;font-weight:800">⛔ bloqué'+(L.motif?' ('+_stkE(L.motif)+')':'')+'</span>':((L.entames+L.neufs)?' → à bloquer':''))+'</div>'
        + (L.items.length ? (L.bloque
            ? '<button class="stk-btn big" style="margin-top:8px" onclick="stkBloquer('+i+',false)">↩️ Débloquer (code admin)</button>'
            : '<button class="stk-btn big" style="margin-top:8px;background:#dc2626;border-color:#dc2626;color:#fff" onclick="stkBloquer('+i+',true)">⛔ Bloquer ce lot</button>') : '')
        + '</div>';
    }).join('') + '<div style="display:flex;gap:6px;margin-top:8px"><button class="stk-btn" style="flex:1" onclick="stkRecallPdf()">🖨️ Imprimer / PDF</button>'
      + '<button class="stk-btn pri" style="flex:1" onclick="stkRecallShare()">⬇️ Télécharger / partager</button></div>';
  } catch(e){ console.warn('[stock] recallHtml', e); return ''; }
}
function stkRecallFocus(){
  try { var c = document.getElementById('stk-recall'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); var q = document.getElementById('stk-recall-q'); if (q) setTimeout(function(){ try { q.focus(); } catch(e){} }, 350); } catch(e){ console.warn('[stock] recallFocus', e); }
}
function stkRecallSearch(v){
  try { _stk.rq = String(v||''); var el = document.getElementById('stk-recall-res'); if (el) el.innerHTML = stkRecallHtml(_stk.rq); var ja = document.getElementById('stk-jetes-all'); if (ja) ja.style.display = _stk.rq.trim() ? 'none' : ''; } catch(e){ console.warn('[stock] recallSearch', e); }
}
/** Bloquer / débloquer : motif obligatoire, tracé (qui / quand / pourquoi) sur chaque ligne du lot. Débloquer = code admin. */
function stkBloquer(idx, on){
  try {
    var who = _stkNeedWho(); if (!who) return;
    var lots = stkRecall(_stk.rq).lots;
    var L = lots[idx]; if (!L) return;
    var apply = function(sel){
      showPrompt(on ? '⛔ Bloquer '+sel.length+' lot'+(sel.length>1?'s':'') : '↩️ Débloquer le lot '+(L.lot||''), 'Motif obligatoire — tracé avec ton nom et l\'heure', on ? 'Ex : rappel fournisseur, alerte DGAL…' : 'Ex : levée du rappel', function(m){
        try {
          m = String(m||'').trim();
          if (!m) { toast('⚠️ Motif obligatoire','warning'); return; }
          sel.forEach(function(X){ X.items.forEach(function(it){ stkMvt(on ? 'bloque' : 'debloque', it, { motif: m }); }); });
          toast(on ? '⛔ Bloqué : '+sel.map(function(X){ return X.lot; }).join(', ')+' — ne plus utiliser' : '↩️ Lot '+L.lot+' débloqué', on ? 'warning' : 'success');
          stkRecallSearch(_stk.rq);
        } catch(e){ console.warn('[stock] bloquer2', e); }
      }, on ? 'Bloquer' : 'Débloquer');
    };
    if (on) {
      // Confirmation : liste exacte des lots qui seront bloqués (recherche partielle → plusieurs possibles), décochables
      var cand = lots.filter(function(X){ return !X.bloque && X.items.length; });
      var ov = document.createElement('div');
      ov.className = 'hacc-wait-ov'; ov.id = 'stk-block-ov';
      ov.innerHTML = '<div class="hacc-wait-card" style="text-align:left;padding:16px;max-width:400px">'
        + '<div class="stk-h">⛔ Lots à bloquer</div><div class="stk-sub" style="margin-bottom:8px">Vérifie la liste : seuls les lots cochés seront bloqués.</div>'
        + cand.map(function(X, j){ var same = _stkNorm(X.lot) === _stkNorm(L.lot);
            return '<label class="stk-line" style="display:flex;gap:8px;align-items:flex-start;cursor:pointer"><input type="checkbox" data-bi="'+j+'" '+(same?'checked':'')+' style="width:20px;height:20px;accent-color:#dc2626;margin-top:2px">'
              + '<span><b>'+_stkE(X.lot||'—')+'</b> — '+_stkE(X.produit)+'<br><small>'+X.entames+' entamé(s) · '+X.neufs+' neuf(s) · '+X.bls.length+' BL</small></span></label>'; }).join('')
        + '<button class="stk-btn big" data-ok="1" style="margin-top:8px;background:#dc2626;border-color:#dc2626;color:#fff">⛔ '+(cand.length>1?'Bloquer les lots cochés':'Bloquer ce lot')+'</button>'
        + '<button class="stk-btn big" data-no="1" style="margin-top:6px">Ne rien faire</button></div>';
      document.body.appendChild(ov);
      ov.addEventListener('click', function(ev){
        try {
          if (ev.target === ov || ev.target.closest('[data-no]')) { ov.remove(); return; }
          if (!ev.target.closest('[data-ok]')) return;
          var sel = [];
          ov.querySelectorAll('input[data-bi]:checked').forEach(function(c){ sel.push(cand[parseInt(c.getAttribute('data-bi'),10)]); });
          if (!sel.length) { toast('Coche au moins un lot','warning'); return; }
          ov.remove(); apply(sel);
        } catch(e){ console.warn('[stock] block ov', e); }
      });
      return;
    }
    // Déblocage : fail closed — code admin EXISTANT obligatoire (jamais de création à la volée)
    if (!S.adminPin) { toast('⛔ Déblocage impossible : définis d\'abord un code admin dans ⚙️ Réglages','error'); return; }
    if (typeof openPinModal !== 'function') { toast('⛔ Déblocage refusé (code admin non vérifiable)','error'); return; }
    try { openPinModal({ mode: 'check', target: 'admin', onSuccess: function(){ apply([L]); } }); }
    catch(e){ console.warn('[stock] admin pin', e); toast('⛔ Déblocage refusé (code admin non vérifié)','error'); }
  } catch(e){ console.warn('[stock] bloquer', e); }
}
function _stkRecallPdfSection(R){
  try {
    return R.lots.map(function(L){
      return '<h2 style="color:#5C1E5A;border-color:#d9a8d6">🔎 Lot '+_stkE(L.lot||'—')+' — '+_stkE(L.produit)+(L.bloque?' — ⛔ BLOQUÉ':'')+'</h2>'
        + '<table><thead><tr><th>Bon de livraison</th><th>Fournisseur</th><th>Date BL</th><th>Reçu le</th></tr></thead><tbody>'
        + (L.bls.map(function(b){ return '<tr><td>'+_stkE(b.numero||'—')+'</td><td>'+_stkE(b.fournisseur||'—')+'</td><td>'+_stkFrY(b.date)+'</td><td>'+_stkFrY(b.date_rec)+'</td></tr>'; }).join('') || '<tr><td colspan="4">Saisie Traçabilité MP manuelle (hors stock)</td></tr>')
        + '</tbody></table><table style="margin-top:6px"><thead><tr><th>Plat concerné</th><th>Date</th><th>Service</th><th>Cuisinier</th></tr></thead><tbody>'
        + (L.plats.map(function(p){ return '<tr><td>'+_stkE(p.nom)+'</td><td>'+_stkFrY(p.date)+'</td><td>'+_stkE(p.service||'—')+'</td><td>'+_stkE(p.par||'—')+'</td></tr>'; }).join('') || '<tr><td colspan="4">Aucun plat lié</td></tr>')
        + '</tbody></table>'
        + '<table style="margin-top:6px"><thead><tr><th>BL</th><th>Reçu le</th><th>Entamés</th><th>Neufs</th><th>Jetés</th></tr></thead><tbody>'
        + L.items.slice().sort(function(a,b){ return String(a.date_rec).localeCompare(String(b.date_rec)); }).map(function(it){ return '<tr><td>'+_stkE(it.bl_numero||'—')+'</td><td>'+_stkFrY(it.date_rec)+'</td><td>'+it.entames+'</td><td>'+it.neufs+'</td><td>'+(it.jetes.map(function(j){ return j.n+' le '+_stkFrY(j.date)+' ('+_stkE(j.motif)+', '+_stkE(j.par)+')'; }).join('<br>')||'—')+'</td></tr>'; }).join('')
        + '</tbody></table><p style="font-size:11px">Total en stock : <b>'+L.entames+' entamé(s), '+L.neufs+' neuf(s)</b>'+(L.bloque?' — bloqué'+(L.motif?' (motif : '+_stkE(L.motif)+')':''):'')+'</p>';
    }).join('');
  } catch(e){ return ''; }
}
function _stkRecallDoc(){
  var R = stkRecall(_stk.rq);
  if (!R.lots.length) return null;
  var site = ''; try { site = getSiteName(); } catch(e){}
  var css = ''; try { css = _pdfCSS(); } catch(e){}
  return { R: R, site: site, html: '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rappel de lot — '+_stkE(site)+'</title><style>'+css+'@media print{.no-print{display:none!important}}</style></head><body>'
    + '<div class="no-print" style="padding:10px"><button onclick="window.print()" style="background:#5C1E5A;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-weight:bold">🖨️ Imprimer / PDF</button></div>'
    + '<div class="hdr" style="border-color:#5C1E5A"><div><h1 style="color:#5C1E5A">🔎 Rappel de lot « '+_stkE(R.q)+' »</h1><p><strong>'+_stkE(site)+'</strong></p><p>Généré le '+new Date().toLocaleString('fr-FR')+' par '+_stkE(_stkWho()||'—')+'</p></div></div>'
    + _stkRecallPdfSection(R)
    + '<div class="footer"><span>HACC.PRO — Rappel de lot — '+_stkE(site)+'</span></div></body></html>' };
}
/** Télécharger / partager le rapport (fichier HTML imprimable en PDF) — partage natif si dispo, sinon téléchargement. */
async function stkRecallShare(){
  try {
    var D = _stkRecallDoc(); if (!D) { toast('Aucun lot à exporter','warning'); return; }
    var name = ('rappel-lot-'+String(D.R.q||'lot').replace(/[^\w-]+/g,'_')+'-'+_stkToday()+'.html');
    var blob = new Blob([D.html], { type: 'text/html;charset=utf-8' });
    try {
      var file = (typeof File === 'function') ? new File([blob], name, { type: 'text/html' }) : null;
      if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], title: 'Rappel de lot '+D.R.q, text: 'Rapport de rappel de lot — '+D.site });
        return;
      }
    } catch(e){ if (e && e.name === 'AbortError') return; console.warn('[stock] share', e); }
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function(){ try { a.remove(); URL.revokeObjectURL(url); } catch(e){} }, 5000);
    toast('⬇️ Rapport téléchargé ('+name+')','success');
  } catch(e){ console.warn('[stock] recallShare', e); try{ toast('⚠️ Téléchargement impossible','warning'); }catch(_e){} }
}
function stkRecallPdf(){
  try {
    var R = stkRecall(_stk.rq);
    if (!R.lots.length) { toast('Aucun lot à exporter','warning'); return; }
    var site = ''; try { site = getSiteName(); } catch(e){}
    var css = ''; try { css = _pdfCSS(); } catch(e){}
    var html = '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rappel de lot — '+_stkE(site)+'</title><style>'+css+'@media print{.no-print{display:none!important}}</style></head><body>'
      + '<div class="no-print" style="padding:10px"><button onclick="window.print()" style="background:#5C1E5A;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-weight:bold">🖨️ Imprimer / PDF</button></div>'
      + '<div class="hdr" style="border-color:#5C1E5A"><div><h1 style="color:#5C1E5A">🔎 Rappel de lot « '+_stkE(R.q)+' »</h1><p><strong>'+_stkE(site)+'</strong></p><p>Généré le '+new Date().toLocaleString('fr-FR')+' par '+_stkE(_stkWho()||'—')+'</p></div></div>'
      + _stkRecallPdfSection(R)
      + '<div class="footer"><span>HACC.PRO — Rappel de lot — '+_stkE(site)+'</span></div></body></html>';
    openPrintWindow(html);
  } catch(e){ console.warn('[stock] recallPdf', e); try{ toast('⚠️ Export impossible','warning'); }catch(_e){} }
}
/** Section « Réceptions BL / lots bloqués » pour les exports existants. */
function _stkExportSection(from, to){
  try {
    var bls = _stkBls().filter(function(b){ var d = b.date_reception || b.date; return (!from || d >= from) && (!to || d <= to); });
    var blk = stkGroups().filter(function(G){ return G.bloque; });
    var jet = _stkJetes(from, to);
    if (!bls.length && !blk.length && !jet.length) return '';
    var h = '<h2 style="color:#5C1E5A;border-color:#d9a8d6">📦 Réceptions (bons de livraison) — stock</h2>';
    if (bls.length) h += '<table><thead><tr><th>Reçu le</th><th>Fournisseur</th><th>N° BL</th><th>Bilan</th><th>Écarts</th><th>Par</th></tr></thead><tbody>'
      + bls.map(function(b){
          var ec = (b.lignes_bl||[]).filter(function(l){ return l.statut !== 'recu'; }).map(function(l){ return (l.statut==='refuse'?'⛔ ':'✗ ')+_stkE(l.produit); }).join('<br>');
          return '<tr><td>'+_stkFrY(b.date_reception||b.date)+'</td><td>'+_stkE(b.fournisseur||'—')+'</td><td>'+_stkE(b.numero||'—')+'</td><td>'+_stkE(b.resume||'')+'</td><td>'+(ec||'—')+'</td><td>'+_stkE(b.cuisinier||'—')+'</td></tr>';
        }).join('') + '</tbody></table>';
    if (blk.length) h += '<h2 style="color:#b71c1c">⛔ Lots bloqués</h2><table><thead><tr><th>Produit</th><th>Lot</th><th>Motif</th><th>En stock</th></tr></thead><tbody>'
      + blk.map(function(G){ var it = G.items.find(function(i){ return i.bloque; }) || {}; return '<tr><td>'+_stkE(G.produit)+'</td><td>'+_stkE(G.lot)+'</td><td>'+_stkE(it.bloque_motif||'')+'</td><td>'+G.entames+' entamé(s) · '+G.neufs+' neuf(s)</td></tr>'; }).join('') + '</tbody></table>';
    if (jet.length) h += '<h2 style="color:#b71c1c">🗑️ Produits jetés</h2><table><thead><tr><th>Date</th><th>Produit</th><th>Lot</th><th>Qté</th><th>Motif</th><th>Par</th></tr></thead><tbody>'
      + jet.map(function(m){ return '<tr><td>'+_stkFrY(m.date)+' '+_stkE(m.heure||'')+'</td><td>'+_stkE(m.produit||'')+'</td><td style="word-break:break-all">'+_stkE(m.lot||'—')+'</td><td>'+_stkE(m.n||1)+'</td><td>'+_stkE(m.motif||'')+'</td><td>'+_stkE(m.cuisinier||'—')+'</td></tr>'; }).join('') + '</tbody></table>';
    return h;
  } catch(e){ console.warn('[stock] exportSection', e); return ''; }
}
(function stkHooksD(){
  // v493 : étiquette « Entamé » depuis l'historique Traça MP = même logique que le Stock (ouverture + durée confirmée, jamais la DDM)
  try {
    if (typeof enr31ToEtiq === 'function') {
      enr31ToEtiq = function(i){
        try {
          var r = ((S.enr31||{}).lignes||[])[i];
          if (!r) { toast('⚠️ Introuvable','warning'); return; }
          var st = r._stock_item_id ? stkItems().find(function(x){ return x.id === r._stock_item_id; }) : null;
          var it = st ? Object.assign({}, st, { ouverts: st.ouverts.length ? st.ouverts : [r.date || _stkToday()] })
            : { produit: r.produit || '', ouverts: [r.date || _stkToday()], dlc: _stkIso(r.dlc), dlc_type: r.dlc_type || '' };
          stkEtiq(null, it, i);
        } catch(e){ console.warn('[stock] enr31ToEtiq', e); }
      };
    }
  } catch(e){ console.warn('[stock] hook etiq31', e); }
  // v493 : historique Réception (ENR23) — les réceptions BL du Stock y apparaissent aussi (date locale de réception)
  try {
    if (typeof REND !== 'undefined' && typeof REND['enr23'] === 'function') {
      var _r23 = REND['enr23'];
      REND['enr23'] = function(){
        var h = _r23.apply(this, arguments);
        try {
          var bls = _stkBls().slice().sort(function(a,b){ return String(b.date_reception||b.date).localeCompare(String(a.date_reception||a.date)) || String(b._ts).localeCompare(String(a._ts)); }).slice(0, 15);
          if (!bls.length) return h;
          return h + '<div class="card"><div class="stk-h">📦 Réceptions BL (module Stock)</div>' + bls.map(function(bl){
            return '<div class="stk-line"><div class="nm">'+_stkE(bl.fournisseur||'Fournisseur ?')+' — '+_stkE(/^BL/i.test(bl.numero||'')?bl.numero:'BL '+(bl.numero||'?'))+'</div>'
              + '<div class="mt">Reçu le '+_stkFrY(bl.date_reception||bl.date)+' '+_stkE(bl.heure||'')+' par '+_stkE(bl.cuisinier||'?')+' · BL du '+_stkFrY(bl.date_bl||bl.date)+' · '+_stkE(bl.resume||'')+'</div>'
              + (function(){ try { var ph = ['photo','photo2','photo3','photo4','photo5','photo6'].map(function(k){ return bl[k] ? photoThumb(bl[k], '', true) : ''; }).join(''); return ph ? '<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">'+ph+'</div>' : ''; } catch(e){ return ''; } })()
              + '</div>';
          }).join('') + '<button class="stk-btn big" style="margin-top:6px" onclick="goTo(\'stock\')">Ouvrir le Stock</button></div>';
        } catch(e){ console.warn('[stock] enr23 inject', e); return h; }
      };
    }
  } catch(e){ console.warn('[stock] hook enr23', e); }
  // v493 : accès « Rappel de lot » depuis Traça MP et Accueil
  try {
    window.stkOpenRecall = function(){ try { if (typeof cur !== 'undefined' && cur !== 'stock') goTo('stock'); setTimeout(stkRecallFocus, 200); } catch(e){ console.warn('[stock] openRecall', e); } };
    var btn = '<div style="display:flex;justify-content:flex-end;margin:0 0 8px"><button class="stk-btn" onclick="stkOpenRecall()">🔎 Rappel de lot</button></div>';
    ['enr31','accueil'].forEach(function(id){
      if (typeof REND === 'undefined' || typeof REND[id] !== 'function') return;
      var _o = REND[id];
      REND[id] = function(){ var h = _o.apply(this, arguments); try { return btn + h; } catch(e){ return h; } };
    });
  } catch(e){ console.warn('[stock] hook recall access', e); }
})();
(function stkHooksC(){
  try {
    // Carte « Rappel de lot » en bas de l'onglet Stock
    var _rs = stkRender;
    stkRender = function(){
      var h = _rs.apply(this, arguments);
      if (_stk.draft) return h;
      var top = ''; // v498 : bouton désormais en tête de stkRender
      return top + h + '<div class="card" id="stk-recall" style="margin-bottom:96px"><div class="stk-h">🔎 Rappel de lot</div>'
        + '<input class="stk-in" id="stk-recall-q" placeholder="N° de lot…" value="'+_stkA(_stk.rq)+'" oninput="stkRecallSearch(this.value)">'
        + '<div id="stk-recall-res" style="margin-top:8px">'+stkRecallHtml(_stk.rq)+'</div></div>' + '<div id="stk-jetes-all"'+(String(_stk.rq||'').trim()?' style="display:none"':'')+'>' + _stkJetesCard(10, '🗑️ Derniers produits jetés (tous lots)') + '</div>';
    };
  } catch(e){ console.warn('[stock] hook recall', e); }
  try {
    // Export PDF Traça MP existant : ajoute réceptions BL + lots bloqués de la période (fonction d'origine inchangée)
    if (typeof exportMP_PDF === 'function') {
      var _mp = exportMP_PDF;
      exportMP_PDF = function(period){
        var opw = openPrintWindow, from = '', to = '';
        try { if (period === 'jour') { from = to = _stkToday(); } else if (typeof _mpDateRange === 'function') { var rg = _mpDateRange(period); from = rg.from; to = rg.to; } } catch(e){}
        try {
          openPrintWindow = function(html){
            try { var sec = _stkExportSection(from, to); if (sec) html = String(html).replace('<div class="footer">', sec + '<div class="footer">'); } catch(e){ console.warn('[stock] inject mp', e); }
            return opw(html);
          };
          return _mp.apply(this, arguments);
        } finally { openPrintWindow = opw; }
      };
    }
  } catch(e){ console.warn('[stock] hook exportMP', e); }
  try {
    // Audit contrôle sanitaire : ajoute la même section (mois en cours)
    if (typeof buildAuditBody === 'function') {
      var _ab = buildAuditBody;
      buildAuditBody = function(){
        var h = _ab.apply(this, arguments);
        try { var m = (typeof getConfigMois === 'function') ? getConfigMois() : _stkToday().slice(0,7); var sec = _stkExportSection(m+'-01', m+'-31'); if (sec) h += '<div class="stk-audit">'+sec+'</div>'; } catch(e){ console.warn('[stock] inject audit', e); }
        return h;
      };
    }
  } catch(e){ console.warn('[stock] hook audit', e); }
})();
