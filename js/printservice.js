/**
   * printService.js — Gestion de l'impression et des étiquettes
   *
   * Ce module centralise TOUTE la logique d'impression de l'application :
   *   - Ouverture de fenêtres d'impression (compatible iOS Safari via Blob URL)
   *   - Génération du CSS d'impression pour étiquettes
   *   - Gestion des formats d'étiquettes A4
   *   - Logique de re-impression
   *   - Impression de toutes les étiquettes en attente
   *
   * ⚠️  CRITIQUE : Ne pas modifier ce fichier sans tester l'impression
   *     sur iOS Safari et Chrome Android. Le système Blob URL est
   *     spécifiquement conçu pour contourner les restrictions mobiles.
   *
   * Dépend de : supabaseConfig.js, utils.js (chargés avant)
   */

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

// ── Format unifié pour TOUTES les étiquettes ──────────────────────
// Une seule clé : S['enr34'].format (fallback S.config.etiqA4Fmt pour compat)
// E34_FORMATS est la référence complète (7 formats) pour tous les types d'étiquettes
// Batch = liste d'étiquettes à imprimer ensemble
let _e34batch=[];
// Formats d'étiquettes
// ── Formats physiques A4 (14 étiquettes/feuille) ────────────────────
const ETIQ_A4_FORMATS=[
  {id:'a4_119763',label:'99,1 × 38,1 mm — Réf. 119763',w:99.1,h:38.1,pm:'15.15mm 5.9mm'},
  {id:'a4_115287',label:'105 × 39 mm — Réf. 115287',w:105,h:39,pm:'12mm 0'}
];
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

const E34_FORMATS=[
  {id:'a4_119763', label:'📄 A4 — 99,1×38,1mm (Réf. 119763)', w:99.1, h:38.1, perPage:14, pm:'15.15mm 5.9mm'},
  {id:'a4_115287', label:'📄 A4 — 105×39mm (Réf. 115287)', w:105, h:39, perPage:14, pm:'12mm 0'},
  {id:'a4_2col', label:'📄 A4 — 2 colonnes (90×45mm)', w:90, h:45, perPage:16, pm:'8mm'},
  {id:'a4_1col', label:'📄 A4 — 1 colonne (180×50mm)', w:180, h:50, perPage:8, pm:'8mm'},
  {id:'therm_57', label:'🏷️ Thermique 57×40mm', w:57, h:40, perPage:1},
  {id:'therm_62', label:'🏷️ Thermique 62×29mm', w:62, h:29, perPage:1},
  {id:'therm_100', label:'🏷️ Thermique 100×50mm', w:100, h:50, perPage:1},
];
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
  _e34batch.push({...d, nb:_e34qty, _sel:_e34sel});
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
  