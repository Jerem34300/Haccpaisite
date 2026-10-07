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
var _stk = { pages: [], draft: null, q: '', busy: false };

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
function _stkRefresh(){ try { if (typeof cur !== 'undefined' && cur === 'stock') renderMain(); } catch(e){ console.warn('[stock] refresh', e); } }
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
  var h = '';
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
      var ph = ['photo','photo2','photo3'].map(function(k){ try { return bl[k] ? photoThumb(bl[k], '', true) : ''; } catch(e){ return ''; } }).join('');
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
    if (!groups.length) return '<div class="empty-s">Aucun produit en stock.<br><small>Scanne un bon de livraison pour commencer.</small></div>';
    return groups.map(function(G){
      var recs = G.items.map(function(i){ return _stkFr(i.date_rec); }).filter(function(v,i,a){ return a.indexOf(v)===i; });
      var src = G.lot_auto ? (_stkE(G.items[0].fournisseur)+' · sans lot (BL du '+_stkFr(G.items[0].bl_date)+')')
        : ('Lot '+_stkE(G.lot||'—')+' · reçu le '+recs.join(' et le '));
      var chips = '';
      if (G.entames) chips += '<span class="stk-chip ent">🟠 '+G.entames+' entamé'+(G.entames>1?'s':'')+(G.ouvert_le?' (ouvert le '+_stkFr(G.ouvert_le)+')':'')+'</span>';
      if (G.neufs) chips += '<span class="stk-chip neuf">'+G.neufs+' neuf'+(G.neufs>1?'s':'')+'</span>';
      chips += _stkDlcChip(G.dlc);
      if (G.bloque) chips += '<span class="stk-chip blk">⛔ Lot bloqué</span>';
      var k = _stkA(G.key);
      return '<div class="stk-line"'+(G.bloque?' style="border-color:#fca5a5;background:#fff5f5"':'')+'><div class="nm">'+_stkE(G.produit)+'</div>'
        + '<div class="mt">'+src+(G.dlc?' · '+(G.items[0].dlc_type||'DLC')+' '+_stkFr(G.dlc):'')+'</div><div>'+chips+'</div>'
        + '<div class="stk-act">'
        + '<button onclick="stkEntamer(\''+k+'\')">J\'entame</button>'
        + '<button onclick="stkFini(\''+k+'\')">Fini</button>'
        + '<button onclick="stkCorriger(\''+k+'\')">✏️ Corriger</button>'
        + '</div></div>';
    }).join('');
  } catch(e){ console.warn('[stock] list', e); return ''; }
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
    _stk.draft = {
      fournisseur: res.fournisseur||'', numero: res.numero||'', date: res.date||_stkToday(),
      pages: _stk.pages.slice(),
      lignes: (res.lignes||[]).map(function(l){ return {
        produit: l.produit||'', conditionnement: l.conditionnement||'', qte_texte: l.qte_texte||'',
        qte: Math.max(1, parseInt(l.qte,10)||1), unite: l.unite||'', lot: l.lot||'', dlc: l.dlc||'', dlc_type: l.dlc_type||'',
        statut: '', hors_bl: false, edit: false }; })
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
    if (l.statut === 'refuse') extra = '<div class="mt" style="color:#991b1b">Refusé — non-conformité ENR30 pré-remplie à la validation</div>';
    var edit = l.edit ? ('<div class="stk-grid">'
      + '<input class="stk-in" value="'+_stkA(l.produit)+'" placeholder="Produit" onchange="stkLineSet('+i+',\'produit\',this.value)">'
      + '<input class="stk-in" type="number" min="1" value="'+_stkA(l.qte)+'" placeholder="Unités" onchange="stkLineSet('+i+',\'qte\',this.value)">'
      + '<input class="stk-in" value="'+_stkA(l.lot)+'" placeholder="Lot" onchange="stkLineSet('+i+',\'lot\',this.value)">'
      + '<input class="stk-in" type="date" value="'+_stkA(l.dlc)+'" onchange="stkLineSet('+i+',\'dlc\',this.value)"></div>') : '';
    return '<div class="stk-line'+(l.statut?'':' todo')+'"><div style="display:flex;gap:6px"><div style="flex:1"><div class="nm">'+_stkE(l.produit||'(sans nom)')+(l.hors_bl?' <span class="stk-chip dlc">hors BL</span>':'')+'</div>'
      + '<div class="mt">'+meta+' · <b>'+l.qte+' unité'+(l.qte>1?'s':'')+' en stock</b></div></div>'
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
function stkDraftSet(k, v){ try { if (_stk.draft) { _stk.draft[k] = String(v||'').trim(); } } catch(e){ console.warn('[stock] draftSet', e); } }
function stkLineSet(i, k, v){
  try {
    var l = _stk.draft && _stk.draft.lignes[i]; if (!l) return;
    if (k === 'qte') l.qte = Math.max(1, parseInt(v,10)||1); else l[k] = String(v||'').trim();
    if (k === 'qte') _stkRefresh();
  } catch(e){ console.warn('[stock] lineSet', e); }
}
function stkLineEdit(i){ try { var l = _stk.draft.lignes[i]; l.edit = !l.edit; _stkRefresh(); } catch(e){ console.warn('[stock] lineEdit', e); } }
function stkLineStat(i, st){ try { var l = _stk.draft.lignes[i]; l.statut = (l.statut === st) ? '' : st; _stkRefresh(); } catch(e){ console.warn('[stock] lineStat', e); } }
function stkToutRecu(){ try { _stk.draft.lignes.forEach(function(l){ if (!l.statut) l.statut = 'recu'; }); _stkRefresh(); } catch(e){ console.warn('[stock] toutRecu', e); } }
function stkHorsBl(){
  try {
    _stk.draft.lignes.push({ produit:'', conditionnement:'', qte_texte:'', qte:1, unite:'', lot:'', dlc:'', dlc_type:'', statut:'recu', hors_bl:true, edit:true });
    _stkRefresh();
  } catch(e){ console.warn('[stock] horsBl', e); }
}
function stkAbandon(){
  try {
    showConfirm('Abandonner ce BL ?', 'Rien n\'a été enregistré. Les photos seront perdues.', 'Abandonner', function(){ _stk.draft = null; _stkRefresh(); });
  } catch(e){ _stk.draft = null; _stkRefresh(); }
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
        return o;
      })
    };
    var nR = rec.lignes_bl.filter(function(l){ return l.statut==='recu'; }).length,
        nM = rec.lignes_bl.filter(function(l){ return l.statut==='manquant'; }).length,
        nX = rec.lignes_bl.filter(function(l){ return l.statut==='refuse'; }).length;
    rec.nb_recu = nR; rec.nb_manquant = nM; rec.nb_refuse = nX;
    rec.resume = nR+' reçu'+(nR>1?'s':'')+' · '+nM+' manquant'+(nM>1?'s':'')+' · '+nX+' refusé'+(nX>1?'s':'');
    // Photos du BL : même format que photoSave (miniature lisible), champs photo/photo2/photo3 (+ photos_extra)
    try {
      for (var i = 0; i < d.pages.length; i++) {
        var ref = await _stkThumbRef(d.pages[i], 900);
        if (!ref) continue;
        if (i === 0) rec.photo = ref; else if (i === 1) rec.photo2 = ref; else if (i === 2) rec.photo3 = ref;
        else { rec.photos_extra = rec.photos_extra || []; rec.photos_extra.push(ref); }
      }
    } catch(e){ console.warn('[stock] photos', e); }
    _stkPush(STK_SEC, rec);
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
function _stkChoice(title, sub, opts, cb){
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
        if (i >= 0) cb(opts[i]);
      } catch(e){ console.warn('[stock] choice', e); }
    });
    document.body.appendChild(ov);
  } catch(e){ console.warn('[stock] choice', e); }
}
function stkEntamer(key, after){
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
        if (o.kind === 'ent') { toast('🟠 On continue le '+(o.it.unite||'produit')+' entamé','success'); if (after) after(o.it, null); return; }
        if (G.entames > 0) toast('⚠️ Attention : il reste un entamé de ce lot — à utiliser en priorité','warning');
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
