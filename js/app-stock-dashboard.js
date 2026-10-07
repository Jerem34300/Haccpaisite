/* ════════════════════════════════════════════════════════════════════
 * app-stock-dashboard.js — Stock vu du siège (v491), LECTURE SEULE.
 * Source : _records (pms_records déjà filtrés par tenant + rôle dans loadData :
 * chef de secteur / directeur restreints à leurs sites) — on re-filtre en plus sur
 * les codes de _sites : aucun mélange inter-sites / inter-entreprises possible.
 * enr_type : 'stock' (BL validé), 'stock_mvt' (mouvements), 'fourc_nonlivre', 'enr30', 'enr31'.
 * Chargé APRÈS app-dashboard.js.
 * ════════════════════════════════════════════════════════════════════ */
var _sdState = { site: '', q: '' };
function _sdE(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function _sdN(s){ try { return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim(); } catch(e){ return String(s||'').toLowerCase(); } }
function _sdFr(ymd){ var m = String(ymd||'').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3]+'/'+m[2]+'/'+m[1] : String(ymd||''); }
function _sdToday(){ try { return (typeof toLocalYMD === 'function') ? toLocalYMD(new Date()) : new Date().toISOString().slice(0,10); } catch(e){ return new Date().toISOString().slice(0,10); } }
function _sdSiteName(code){ try { var s = (_sites||[]).find(function(x){ return x.code === code; }); return s ? (s.name || code) : code; } catch(e){ return code; } }
/** Enregistrements stock autorisés : uniquement les sites visibles par ce compte. */
function _sdRecs(types){
  try {
    var codes = new Set((_sites||[]).map(function(s){ return s.code; }));
    return (_records||[]).filter(function(r){
      return r && r.data && types.indexOf(r.enr_type) >= 0 && codes.has(r.site_id) && !r._deleted && !r.data._deleted;
    });
  } catch(e){ console.warn('[stock siège] recs', e); return []; }
}
/** Reconstitution du stock d'UN site (même logique que la cuisine, clé = site). */
function _sdItems(site){
  var items = [], byId = {};
  try {
    _sdRecs(['stock']).filter(function(r){ return r.site_id === site; }).forEach(function(r){
      var bl = r.data;
      (bl.lignes_bl||[]).forEach(function(l, i){
        if (!l || l.statut !== 'recu') return;
        var it = { id: (bl._ts||'')+'#'+i, site: site, rec_id: r.id, produit: l.produit||'', lot: l.lot||'', lot_auto: !!l.lot_auto, dlc: l.dlc||'',
          qte: Math.max(0, parseInt(l.qte,10)||0), fournisseur: bl.fournisseur||'', bl_numero: bl.numero||'', bl_date: bl.date||'', date_rec: bl.date_reception||bl.date||'',
          ouverts: [], fin: 0, corr: 0, bloque: false, motif: '', lot_lu: '' };
        items.push(it); byId[it.id] = it;
      });
    });
    _sdRecs(['stock_mvt']).filter(function(r){ return r.site_id === site; }).map(function(r){ return r.data; })
      .sort(function(a,b){ return String(a._ts).localeCompare(String(b._ts)); }).forEach(function(m){
        var it = byId[m.item_id]; if (!it) return;
        var n = Math.max(1, parseInt(m.n,10)||1);
        if (m.type === 'entame') { for (var k=0;k<n;k++) it.ouverts.push(m.date||''); if (m.lot_lu) it.lot_lu = m.lot_lu; }
        else if (m.type === 'lecture_etiquette') { if (m.lot_lu) it.lot_lu = m.lot_lu; }
        else if (m.type === 'fini') { it.fin += n; if (m.from !== 'neuf') it.ouverts.splice(0, n); else it.finNeuf = (it.finNeuf||0) + n; }
        else if (m.type === 'correction') it.corr += (parseInt(m.delta,10)||0);
        else if (m.type === 'bloque') { it.bloque = true; it.motif = m.motif||''; it.bloque_par = m.cuisinier||''; it.bloque_le = m.date||''; }
        else if (m.type === 'debloque') it.bloque = false;
      });
    items.forEach(function(it){
      it.entames = it.ouverts.length;
      it.neufs = Math.max(0, it.qte + it.corr - it.fin - it.entames);
    });
  } catch(e){ console.warn('[stock siège] items', e); }
  return items;
}
function _sdSitesWithStock(){
  try {
    var set = {};
    _sdRecs(['stock','stock_mvt']).forEach(function(r){ set[r.site_id] = 1; });
    return (_sites||[]).filter(function(s){ return set[s.code]; });
  } catch(e){ return []; }
}
function _sdPhotos(r){
  try {
    return ['photo','photo2','photo3','photo4','photo5','photo6'].filter(function(k){ return r.data[k]; }).map(function(k, i){
      return '<img data-psrc="1" data-prec="'+_sdE(r.id)+'" data-pfield="'+k+'" alt="Page '+(i+1)+'" title="Page '+(i+1)+'" onclick="event.stopPropagation();try{openLightbox(this.src)}catch(e){}" style="width:64px;height:84px;object-fit:cover;border-radius:8px;border:1px solid #c7d2fe;cursor:pointer;background:#f1f5f9">';
    }).join('');
  } catch(e){ return ''; }
}
function _sdNcFor(site, bl){
  try {
    var num = _sdN(bl.numero); if (!num) return [];
    return _sdRecs(['enr30']).filter(function(r){ return r.site_id === site && _sdN(r.data.desc).indexOf(num) >= 0; });
  } catch(e){ return []; }
}
function renderStockHQ(){
  try {
    var sites = _sdSitesWithStock();
    var f = (typeof getFilters === 'function') ? getFilters() : {};
    if (f.site && sites.some(function(s){ return s.code === f.site; })) _sdState.site = f.site;
    if (!_sdState.site || !sites.some(function(s){ return s.code === _sdState.site; })) _sdState.site = sites[0] ? sites[0].code : '';
    var site = _sdState.site;
    var card = function(t, b){ return '<div class="card" style="background:#fff;border-radius:14px;padding:14px 16px;margin-bottom:14px;box-shadow:0 1px 3px rgba(0,0,0,.06)"><div style="font-weight:900;color:#0F2240;margin-bottom:8px">'+t+'</div>'+b+'</div>'; };
    var h = '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">'
      + '<label style="font-weight:800;font-size:.85rem">Site :</label><select id="sd-site" onchange="_sdState.site=this.value;renderStockHQ()" style="padding:7px 10px;border-radius:9px;border:1.5px solid #cbd5e1;font-family:inherit">'
      + (sites.length ? sites.map(function(s){ return '<option value="'+_sdE(s.code)+'"'+(s.code===site?' selected':'')+'>'+_sdE(s.name||s.code)+'</option>'; }).join('') : '<option value="">Aucun site avec stock</option>')
      + '</select><span style="font-size:.75rem;color:#64748b">Lecture seule — les modifications se font en cuisine, tracées.</span></div>';
    // 1. Réceptions BL
    var bls = _sdRecs(['stock']).filter(function(r){ return r.site_id === site; }).sort(function(a,b){ return String(b.data._ts||b.recorded_at).localeCompare(String(a.data._ts||a.recorded_at)); }).slice(0, 30);
    var st = { recu: ['✓ Reçu','#166534','#dcfce7'], manquant: ['✗ Manquant','#374151','#f3f4f6'], refuse: ['⛔ Refusé','#991b1b','#fee2e2'] };
    h += card('📄 Réceptions (bons de livraison) — '+_sdE(_sdSiteName(site)), bls.length ? bls.map(function(r){
      var d = r.data, ncs = _sdNcFor(site, d);
      return '<div style="border:1.5px solid #e2e8f0;border-radius:12px;padding:10px;margin-bottom:10px">'
        + '<div style="display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap"><div style="flex:1;min-width:200px"><div style="font-weight:900">'+_sdE(d.fournisseur||'Fournisseur ?')+' — '+_sdE(d.numero||'?')+'</div>'
        + '<div style="font-size:.75rem;color:#64748b">BL du '+_sdFr(d.date)+' · reçu le '+_sdFr(d.date_reception)+' '+_sdE(d.heure||'')+' par '+_sdE(d.cuisinier||'?')+'</div>'
        + '<div style="font-size:.78rem;font-weight:800;margin-top:3px">'+_sdE(d.resume||'')+'</div></div>'
        + '<div style="display:flex;gap:6px;flex-wrap:wrap">'+_sdPhotos(r)+'</div></div>'
        + '<details style="margin-top:6px"><summary style="cursor:pointer;font-size:.78rem;font-weight:800;color:#1d4ed8">Lignes du BL ('+(d.lignes_bl||[]).length+')</summary>'
        + (d.lignes_bl||[]).map(function(l){ var s = st[l.statut] || ['?','#555','#eee'];
            return '<div style="display:flex;gap:8px;align-items:center;border-bottom:1px solid #f1f5f9;padding:4px 0;font-size:.78rem"><span style="background:'+s[2]+';color:'+s[1]+';border-radius:8px;padding:2px 8px;font-weight:800;white-space:nowrap">'+s[0]+'</span><span style="flex:1"><b>'+_sdE(l.produit)+'</b>'+(l.hors_bl?' (hors BL)':'')+' <span style="color:#64748b">'+_sdE([l.conditionnement, l.qte_bl?l.qte_bl+' u.':'', l.lot?'lot '+l.lot:'', l.dlc?'DLC '+_sdFr(l.dlc):'', l.trace||''].filter(Boolean).join(' · '))+'</span></span></div>'; }).join('')
        + '</details>'
        + (ncs.length ? '<div style="margin-top:6px;font-size:.78rem">🚨 NC liée'+(ncs.length>1?'s':'')+' : '+ncs.map(function(n){ return '<a href="#" onclick="event.preventDefault();try{openDetail(\''+_sdE(String(n.id).replace(/[^\w-]/g,''))+'\')}catch(e){}" style="color:#b91c1c;font-weight:800">'+_sdE(n.data.num||'NC')+' '+(n.data.cloture==='OUI'?'(clôturée)':'(ouverte)')+'</a>'; }).join(', ')+'</div>' : '')
        + '<div style="margin-top:6px"><a href="#" onclick="event.preventDefault();try{openDetail(\''+_sdE(String(r.id).replace(/[^\w-]/g,''))+'\')}catch(e){}" style="font-size:.75rem;color:#1d4ed8;font-weight:800">Voir la fiche complète →</a></div>'
        + '</div>';
    }).join('') : '<div style="color:#64748b;font-size:.85rem">Aucune réception BL pour ce site sur la période chargée.</div>');
    // 2. Stock (lecture seule)
    var items = _sdItems(site).filter(function(i){ return i.entames + i.neufs > 0 || i.bloque; });
    var t = _sdToday(), lim = new Date(Date.now()+3*86400000).toISOString().slice(0,10);
    var ent = items.filter(function(i){ return i.entames > 0; });
    var dlc = items.filter(function(i){ return i.dlc && i.dlc <= lim && (i.entames+i.neufs) > 0; }).sort(function(a,b){ return a.dlc.localeCompare(b.dlc); });
    var blk = items.filter(function(i){ return i.bloque; });
    var row = function(i, extra){ return '<div style="font-size:.8rem;padding:4px 0;border-bottom:1px solid #f1f5f9"><b>'+_sdE(i.produit)+'</b> <span style="color:#64748b">lot '+_sdE(i.lot||'—')+' · '+_sdE(/^BL/i.test(i.bl_numero)?i.bl_numero:'BL '+i.bl_numero)+'</span> · '+i.entames+' entamé(s) · '+i.neufs+' neuf(s)'+(extra||'')+'</div>'; };
    h += card('📦 Stock — '+_sdE(_sdSiteName(site))+' <span style="font-weight:600;font-size:.75rem;color:#64748b">('+items.length+' ligne(s))</span>',
      '<div style="font-weight:800;font-size:.8rem;color:#9a3412;margin-top:2px">🟠 Entamés ('+ent.length+')</div>'+(ent.map(function(i){ return row(i, ' · ouvert le '+_sdFr(i.ouverts[0])); }).join('')||'<div style="font-size:.78rem;color:#64748b">—</div>')
      + '<div style="font-weight:800;font-size:.8rem;color:#92400e;margin-top:8px">⚠️ DLC proches ≤ 3 j ('+dlc.length+')</div>'+(dlc.map(function(i){ return row(i, ' · <b style="color:'+(i.dlc<t?'#b91c1c':'#92400e')+'">DLC '+_sdFr(i.dlc)+(i.dlc<t?' dépassée':'')+'</b>'); }).join('')||'<div style="font-size:.78rem;color:#64748b">—</div>')
      + '<div style="font-weight:800;font-size:.8rem;color:#b91c1c;margin-top:8px">⛔ Lots bloqués ('+blk.length+')</div>'+(blk.map(function(i){ return row(i, ' · motif : '+_sdE(i.motif||'—')+' ('+_sdE(i.bloque_par||'?')+' '+_sdFr(i.bloque_le)+')'); }).join('')||'<div style="font-size:.78rem;color:#64748b">—</div>'));
    // 3. Rappel de lot multi-sites
    h += card('🔎 Rappel de lot — tous les sites de l\'organisation', '<input id="sd-q" value="'+_sdE(_sdState.q)+'" placeholder="N° de lot…" oninput="_sdState.q=this.value;_sdRecallRender()" style="width:100%;box-sizing:border-box;padding:9px 11px;border-radius:9px;border:1.5px solid #cbd5e1;font-family:inherit"><div id="sd-recall" style="margin-top:8px">'+_sdRecallHtml(_sdState.q)+'</div>');
    // 4. Fil des traces
    h += card('🧾 Fil des traces (pas livré, corrections, blocages, annulations)', _sdTraceHtml());
    setContent(h);
  } catch(e){ console.error('[stock siège]', e); setContent('<div class="empty">⚠️ Erreur affichage Stock : '+_sdE(e && e.message)+'</div>'); }
}
function _sdRecall(q){
  var out = [];
  try {
    var n = _sdN(q); if (!n) return out;
    _sdSitesWithStock().concat((_sites||[]).filter(function(s){ return _sdRecs(['enr31']).some(function(r){ return r.site_id === s.code; }); }))
      .filter(function(s, i, a){ return a.findIndex(function(x){ return x.code === s.code; }) === i; })
      .forEach(function(s){
        var items = _sdItems(s.code).filter(function(i){ return _sdN(i.lot).indexOf(n) >= 0 || _sdN(i.lot_lu).indexOf(n) >= 0; });
        var e31 = _sdRecs(['enr31']).filter(function(r){ return r.site_id === s.code && _sdN(r.data.lot).indexOf(n) >= 0; });
        if (!items.length && !e31.length) return;
        var ids = {}; items.forEach(function(i){ ids[i.id] = 1; });
        var plats = [], seen = {};
        _sdRecs(['stock_mvt']).filter(function(r){ return r.site_id === s.code && ids[r.data.item_id] && r.data.type === 'usage' && r.data.plat; }).forEach(function(r){
          var k = r.data.plat+'|'+(r.data.date_service||r.data.date)+'|'+(r.data.service||''); if (seen[k]) return; seen[k] = 1;
          plats.push({ nom: r.data.plat, date: r.data.date_service || r.data.date, service: r.data.service || '' });
        });
        e31.forEach(function(r){ (r.data._plat_liens||[]).forEach(function(p){ if (p && p.nom && !plats.some(function(x){ return x.nom === p.nom && x.date === r.data.date; })) plats.push({ nom: p.nom, date: r.data.date, service: '' }); }); });
        var bls = {}; items.forEach(function(i){ bls[i.bl_numero+'|'+i.fournisseur] = { numero: i.bl_numero, fournisseur: i.fournisseur, date: i.bl_date, rec: i.date_rec }; });
        var prods = {}; items.forEach(function(i){ prods[i.produit] = 1; }); e31.forEach(function(r){ prods[r.data.produit] = 1; });
        out.push({ site: s.code, nom: s.name || s.code, produits: Object.keys(prods), lots: items.map(function(i){ return i.lot; }).concat(e31.map(function(r){ return r.data.lot; })).filter(function(v,i,a){ return v && a.indexOf(v)===i; }),
          bls: Object.keys(bls).map(function(k){ return bls[k]; }), plats: plats.sort(function(a,b){ return String(a.date).localeCompare(String(b.date)); }),
          entames: items.reduce(function(a,i){ return a+i.entames; },0), neufs: items.reduce(function(a,i){ return a+i.neufs; },0), bloque: items.some(function(i){ return i.bloque; }) });
      });
  } catch(e){ console.warn('[stock siège] recall', e); }
  return out;
}
function _sdRecallHtml(q){
  if (!String(q||'').trim()) return '<div style="font-size:.78rem;color:#64748b">Recherche sur tous les sites visibles par ton compte : BL, plats concernés, stock restant.</div>';
  var R = _sdRecall(q);
  if (!R.length) return '<div style="font-size:.8rem;color:#64748b">Aucun site concerné par « '+_sdE(q)+' ».</div>';
  return '<div style="font-size:.8rem;font-weight:800;margin-bottom:6px">'+R.length+' site(s) concerné(s)</div>' + R.map(function(x){
    return '<div style="border:1.5px solid '+(x.bloque?'#fca5a5':'#e2e8f0')+';background:'+(x.bloque?'#fff5f5':'#fff')+';border-radius:12px;padding:10px;margin-bottom:8px;font-size:.8rem">'
      + '<div style="font-weight:900">🏠 '+_sdE(x.nom)+(x.bloque?' <span style="color:#b91c1c">⛔ bloqué</span>':'')+'</div>'
      + '<div>'+_sdE(x.produits.join(', '))+' — lot '+_sdE(x.lots.join(', '))+'</div>'
      + '<div style="color:#475569">BL : '+(x.bls.map(function(b){ return _sdE(b.numero)+' ('+_sdE(b.fournisseur)+', '+_sdFr(b.date)+')'; }).join(' · ')||'saisie manuelle hors stock')+'</div>'
      + '<div>Plats : '+(x.plats.map(function(p){ return _sdE(p.nom)+' '+_sdFr(p.date)+(p.service?' '+_sdE(p.service):''); }).join(' · ')||'aucun')+'</div>'
      + '<div><b>En stock : '+x.entames+' entamé(s) · '+x.neufs+' neuf(s)</b></div></div>';
  }).join('') + '<button onclick="_sdRecallPdf()" style="padding:10px 16px;background:#0F2240;color:#fff;border:none;border-radius:10px;font-weight:800;cursor:pointer;font-family:inherit">📄 Export PDF rappel (tous sites)</button>';
}
function _sdRecallRender(){ try { var el = document.getElementById('sd-recall'); if (el) el.innerHTML = _sdRecallHtml(_sdState.q); } catch(e){ console.warn('[stock siège] recallRender', e); } }
function _sdRecallPdf(){
  try {
    var R = _sdRecall(_sdState.q); if (!R.length) return;
    var rows = R.map(function(x){
      return '<h2>'+_sdE(x.nom)+(x.bloque?' — ⛔ BLOQUÉ':'')+'</h2><p>'+_sdE(x.produits.join(', '))+' — lot '+_sdE(x.lots.join(', '))+'</p>'
        + '<table><tr><th>BL</th><th>Fournisseur</th><th>Date BL</th><th>Reçu le</th></tr>'+(x.bls.map(function(b){ return '<tr><td>'+_sdE(b.numero)+'</td><td>'+_sdE(b.fournisseur)+'</td><td>'+_sdFr(b.date)+'</td><td>'+_sdFr(b.rec)+'</td></tr>'; }).join('')||'<tr><td colspan="4">Saisie manuelle</td></tr>')+'</table>'
        + '<table><tr><th>Plat</th><th>Date</th><th>Service</th></tr>'+(x.plats.map(function(p){ return '<tr><td>'+_sdE(p.nom)+'</td><td>'+_sdFr(p.date)+'</td><td>'+_sdE(p.service||'—')+'</td></tr>'; }).join('')||'<tr><td colspan="3">Aucun plat lié</td></tr>')+'</table>'
        + '<p>En stock : <b>'+x.entames+' entamé(s), '+x.neufs+' neuf(s)</b></p>';
    }).join('');
    var w = window.open('', '_blank');
    if (!w) { try { showToast('Autorisez les fenêtres pour exporter','warning'); } catch(e){} return; }
    w.document.write('<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Rappel de lot '+_sdE(_sdState.q)+'</title><style>body{font-family:Arial,sans-serif;padding:20px;color:#111}h1{color:#0F2240}h2{border-bottom:2px solid #0F2240;margin-top:22px}table{width:100%;border-collapse:collapse;margin:6px 0;font-size:12px}td,th{border:1px solid #999;padding:4px 6px;text-align:left}th{background:#eef2f7}@media print{button{display:none}}</style></head><body><button onclick="window.print()">🖨️ Imprimer / PDF</button><h1>🔎 Rappel de lot « '+_sdE(_sdState.q)+' » — '+R.length+' site(s)</h1><p>Généré le '+new Date().toLocaleString('fr-FR')+'</p>'+rows+'</body></html>');
    w.document.close();
  } catch(e){ console.warn('[stock siège] pdf', e); }
}
function _sdTraceHtml(){
  try {
    var lab = { correction: '✏️ Correction de stock', bloque: '⛔ Lot bloqué', debloque: '↩️ Lot débloqué', abandon_bl: '🗑️ Réception abandonnée' };
    var ev = [];
    _sdRecs(['stock_mvt']).forEach(function(r){ var d = r.data; if (!lab[d.type]) return;
      ev.push({ ts: d._ts || r.recorded_at, site: r.site_id, quoi: lab[d.type], det: [d.produit, d.lot?'lot '+d.lot:'', d.bl_numero?'BL '+d.bl_numero:'', d.type==='correction'?(d.avant+' → '+d.apres+' neufs'):'', d.motif?'motif : '+d.motif:''].filter(Boolean).join(' · '), qui: d.cuisinier || '?' }); });
    _sdRecs(['fourc_nonlivre']).forEach(function(r){ var d = r.data;
      ev.push({ ts: d._ts || r.recorded_at, site: r.site_id, quoi: '🚚 Pas livré', det: d.fournisseur || '', qui: d.cuisinier || '?' });
      if (d.annule === 'OUI') ev.push({ ts: d.annule_ts || d._ts, site: r.site_id, quoi: '↩️ « Pas livré » annulé', det: d.fournisseur || '', qui: d.annule_par || 'Admin' }); });
    ev.sort(function(a,b){ return String(b.ts).localeCompare(String(a.ts)); });
    if (!ev.length) return '<div style="font-size:.8rem;color:#64748b">Aucune trace sur la période chargée.</div>';
    return '<table style="width:100%;border-collapse:collapse;font-size:.78rem"><tr style="background:#f1f5f9"><th style="text-align:left;padding:5px">Quand</th><th style="text-align:left;padding:5px">Site</th><th style="text-align:left;padding:5px">Quoi</th><th style="text-align:left;padding:5px">Détail</th><th style="text-align:left;padding:5px">Qui</th></tr>'
      + ev.slice(0, 150).map(function(e){ var d = new Date(e.ts); var w = isNaN(d) ? '' : d.toLocaleString('fr-FR',{ day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
        return '<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:5px;white-space:nowrap">'+_sdE(w)+'</td><td style="padding:5px">'+_sdE(_sdSiteName(e.site))+'</td><td style="padding:5px;font-weight:800">'+e.quoi+'</td><td style="padding:5px">'+_sdE(e.det)+'</td><td style="padding:5px">'+_sdE(e.qui)+'</td></tr>'; }).join('') + '</table>';
  } catch(e){ console.warn('[stock siège] traces', e); return ''; }
}
(function sdInit(){
  try { if (typeof PAGE_TITLES !== 'undefined') PAGE_TITLES['pg-stock'] = '📦 Stock & réceptions BL'; } catch(e){}
  try {
    if (typeof renderPage === 'function') {
      var _rp = renderPage;
      renderPage = function(page){ if (page === 'pg-stock') { try { renderStockHQ(); } catch(e){ console.error('[stock siège]', e); } return; } return _rp.apply(this, arguments); };
    }
  } catch(e){ console.warn('[stock siège] hook', e); }
  var addNav = function(){
    try {
      if (document.querySelector('.nav-item[data-page="pg-stock"]')) return;
      var ref = document.querySelector('.nav-item[data-page="pg-tracabilite"]'); if (!ref) return;
      var n = document.createElement('div');
      n.className = 'nav-item'; n.setAttribute('data-page','pg-stock'); n.setAttribute('role','menuitem'); n.tabIndex = 0;
      n.innerHTML = '<span class="ico" aria-hidden="true">📦</span>Stock & BL';
      n.onclick = function(){ try { navTo('pg-stock'); } catch(e){ showPage('pg-stock'); } };
      ref.parentNode.insertBefore(n, ref.nextSibling);
    } catch(e){ console.warn('[stock siège] nav', e); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addNav); else addNav();
})();
