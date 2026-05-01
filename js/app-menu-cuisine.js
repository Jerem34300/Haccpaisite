/**
 * app-menu-cuisine.js — Module MENU pour la tablette cuisine (v36.3)
 *
 * v36.3 — corrections critiques + features complètes :
 *   - Fix dictée vocale "tout le menu" (parser multi-keywords)
 *   - Fix widget accueil (patch wgGet/wgRemove/wgCatalogAdd, robuste)
 *   - Détection BF Cru améliorée (Carotte, Betterave bare → BF Cru)
 *   - Checkboxes Mixé / Sans sel par plat (remplace boutons en haut)
 *   - Génération auto des plats témoins (1 clic)
 *   - Imprimer toutes les étiquettes du jour (1 page A4)
 *   - Historique des menus enregistrés sous les boutons
 *   - Préremplissage formulaire ENR avec les vrais IDs DOM
 */

(function(){
'use strict';

const PROFILS = {
  BF_CUIT:       { ico:'🥘', label:'BF Cuit',        color:'#dc2626', enr:['enr23','enr07','enr01','enr_tc_distrib','enr33'] },
  BF_CRU:        { ico:'🥗', label:'BF Cru',         color:'#16a34a', enr:['enr23','enr08','enr_tc_distrib','enr33'] },
  REMISE_TC:     { ico:'🔥', label:'Remise T°C',     color:'#ea580c', enr:['enr23','enr03','enr_tc_distrib'] },
  SORTIE_DIRECTE:{ ico:'📦', label:'Sortie directe', color:'#0ea5e9', enr:['enr23'] },
  PREP_MINUTE:   { ico:'⚡', label:'Préparé minute', color:'#7c3aed', enr:['enr23'] },
};

// Ordre IMPORTANT : patterns spécifiques (cuits) AVANT patterns bare (crus)
const KW = [
  // --- BF_CUIT spécifiques (cuissons) ---
  { re:/\b(boeuf bourguignon|sauté de|blanquette|bourguignon|navarin|tajine|chili|gratin|hachis|lasagne|moussaka|paella|risotto|cassoulet|pot[- ]au[- ]feu|pot au feu|ragout|ragoût|carbonade|osso buco)\b/i, p:'BF_CUIT' },
  { re:/\b(rôti|roti|escalope|filet de|steak|cuisses?|saumon|poisson|cabillaud|colin|merlu|truite|côtes?|côtelettes?|epaule|épaule|poulet|dinde|veau|porc|bœuf|boeuf|agneau)\b/i, p:'BF_CUIT' },
  { re:/\b(soupe|veloutés?|velouté|potage|consommé|bouillon)\b/i, p:'BF_CUIT' },
  { re:/\b(purée|puree|gratin de|riz pilaf|pilaf|pâtes? cuites?|nouilles?|polenta|semoule|boulgour|quinoa cuit)\b/i, p:'BF_CUIT' },
  { re:/\b(haricots? verts cuits?|courgettes? sautées?|petits pois|épinards? cuits?|brocolis? cuits?)\b/i, p:'BF_CUIT' },
  { re:/\bcarottes?\s+(braisées?|sautées?|cuites?|vichy|au beurre|wok|à la crème)\b/i, p:'BF_CUIT' },
  { re:/\bbetteraves?\s+(cuites?|chaudes?)\b/i, p:'BF_CUIT' },
  { re:/\bchou\s+(braisé|sauté|farci|chou farci)\b/i, p:'BF_CUIT' },

  // --- BF_CRU spécifiques ---
  { re:/\b(carottes? râpées?|carottes rapees|crudités?|crudites|taboul[ée]|coleslaw|céleri rémoulade|celeri remoulade|salade composée|salade composee|piémontaise|piemontaise)\b/i, p:'BF_CRU' },
  { re:/\b(jambon[- ]?(beurre|cru|blanc)|saucisson|rosette|rillettes?|terrine|pâté|pate de|saumon fumé|saumon fume|tarama|houmous|guacamole)\b/i, p:'BF_CRU' },
  { re:/\b(œuf mayo|oeuf mayo|œufs? durs?|oeufs? durs?)\b/i, p:'BF_CRU' },

  // --- BF_CRU bare (mots seuls — typiquement servis crus en collectivité) ---
  { re:/\b(carottes?|betteraves?|concombres?|tomates? mozza|salade|chou rouge|chou blanc|radis|endives?|mâche|mache|roquette|mesclun|poireau cru)\b/i, p:'BF_CRU' },

  // --- REMISE_TC ---
  { re:/\b(raviolis? (en )?(boîte|boite|conserve)|cassoulet (en )?(boîte|boite|conserve)|conserve|en boite|en boîte|surgelé|surgele|pré[- ]?cuit|precuit|nuggets|cordon bleu|pizza)\b/i, p:'REMISE_TC' },

  // --- SORTIE_DIRECTE ---
  { re:/\b(yaourt|fromage blanc|petits suisses|kiri|vache qui rit|fruit (entier|nature)|pomme|poire|banane|orange|kiwi|clementine|clémentine|mandarine|prune|raisin|abricot|pêche|peche|nectarine|crème dessert|creme dessert|liégeois|liegeois|compote|riz au lait|semoule au lait)\b/i, p:'SORTIE_DIRECTE' },
  { re:/\b(pain|baguette|biscotte|crackers?|biscuit)\b/i, p:'SORTIE_DIRECTE' },
  { re:/\b(camembert|brie|emmental|comté|comte|gruyère|gruyere|mimolette|tomme|chèvre|chevre|roquefort|bleu d'auvergne|reblochon|munster|fromage [a-zà-ÿ\s]*portion)\b/i, p:'SORTIE_DIRECTE' },

  // --- PREP_MINUTE ---
  { re:/\b(sandwich|wrap|panini|club|croque[- ]monsieur|burger|croque)\b/i, p:'PREP_MINUTE' },
];

function detectProfil(nom){
  if(!nom) return 'BF_CUIT';
  const s = nom.toLowerCase();
  for(const k of KW){ if(k.re.test(s)) return k.p; }
  return 'BF_CUIT';
}

const COMPOSANTS_KW = [
  ['betterave','betterave'],['carotte','carotte'],['concombre','concombre'],['tomate','tomate'],
  ['celeri','céleri'],['céleri','céleri'],['radis','radis'],['chou','chou'],
  ['salade','salade verte'],['mache','mâche'],['mâche','mâche'],['roquette','roquette'],
  ['endive','endive'],['poireau','poireau'],['oignon','oignon'],['ail','ail'],
  ['pomme de terre','pomme de terre'],['patate','pomme de terre'],['riz','riz'],['pâtes','pâtes'],['pates','pâtes'],
  ['boeuf','bœuf'],['bœuf','bœuf'],['veau','veau'],['porc','porc'],['agneau','agneau'],['mouton','mouton'],
  ['poulet','poulet'],['dinde','dinde'],['canard','canard'],['lapin','lapin'],
  ['saumon','saumon'],['cabillaud','cabillaud'],['colin','colin'],['truite','truite'],['merlu','merlu'],
  ['oeuf','œuf'],['œuf','œuf'],['fromage','fromage'],['mozza','mozzarella'],['mozzarella','mozzarella'],
  ['mayonnaise','mayonnaise'],['vinaigrette','vinaigrette'],['huile','huile'],['beurre','beurre'],
  ['jambon','jambon'],['saucisson','saucisson'],['lardon','lardons'],['lardons','lardons'],
];
function detectComposants(nom){
  if(!nom) return [];
  const s = nom.toLowerCase();
  const out = new Set();
  for(const [kw,label] of COMPOSANTS_KW){ if(s.includes(kw)) out.add(label); }
  return [...out];
}

const CATS = [
  { id:'potages',    label:'🍲 Potages',    short:'Potage' },
  { id:'entrees',    label:'🥗 Entrées',    short:'Entrée' },
  { id:'plats',      label:'🍽️ Plats',     short:'Plat' },
  { id:'garnitures', label:'🥦 Garnitures', short:'Garniture' },
  { id:'fromages',   label:'🧀 Fromages',   short:'Fromage' },
  { id:'desserts',   label:'🍰 Desserts',   short:'Dessert' },
  { id:'pains',      label:'🥖 Pains',      short:'Pain' },
];
const SERVICES = [
  { id:'petitdej', label:'☕ P-déj' },
  { id:'midi',     label:'🌞 Midi' },
  { id:'gouter',   label:'🍪 Goûter' },
  { id:'soir',     label:'🌙 Soir' },
];

function emptyCategories(){
  const o = {};
  CATS.forEach(c => { o[c.id] = []; });
  return o;
}
function getMenus(){ if(!S.menus) S.menus = {}; return S.menus; }
function menuKey(date, service){ return date + '::' + service; }
function getMenu(date, service){ return getMenus()[menuKey(date, service)] || null; }
function setMenu(date, service, menu){
  getMenus()[menuKey(date, service)] = menu;
  save();
}

let _menuState = {
  date:    today(),
  service: 'midi',
};

function addDays(dateStr, n){
  const d = new Date(dateStr+'T12:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0,10);
}
function capitalize(s){ if(!s) return s; return s.charAt(0).toUpperCase() + s.slice(1); }
function fmtDateFr(dateStr){
  try { return new Date(dateStr+'T12:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'}); }
  catch(e){ return dateStr; }
}

// ════════════════════════════════════════════════════
// RENDU PRINCIPAL
// ════════════════════════════════════════════════════
function renderMenuJour(){
  const d = _menuState.date;
  const sv = _menuState.service;
  let menu = getMenu(d, sv);
  if(!menu){
    menu = { categories: emptyCategories(), menu_id:newUUID() };
    setMenu(d, sv, menu);
  }
  if(!menu.menu_id) menu.menu_id = newUUID();
  if(!menu.categories) menu.categories = emptyCategories();
  CATS.forEach(c => { if(!Array.isArray(menu.categories[c.id])) menu.categories[c.id] = []; });

  const dFr = new Date(d+'T12:00').toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' });
  const cov = computeMenuCoverage(menu);
  const today_ = today();
  const isToday = d === today_;
  const isPast = d < today_;
  const dPrev = addDays(d, -1);
  const dNext = addDays(d, +1);

  let totalPlats = 0;
  CATS.forEach(c => totalPlats += (menu.categories[c.id]||[]).length);

  return `
  <style>
    .mn-hd{background:linear-gradient(135deg,#5C1E5A,#C93A78);color:#fff;border-radius:16px;padding:14px 16px;margin-bottom:12px}
    .mn-hd-title-row{display:flex;align-items:center;gap:8px;margin-bottom:8px}
    .mn-hd h2{margin:0;font-size:1rem;font-weight:900;flex:1;line-height:1.2}
    .mn-nav-btn{background:rgba(255,255,255,.18);border:none;color:#fff;width:32px;height:32px;border-radius:50%;font-size:1rem;cursor:pointer;font-family:inherit;font-weight:900;flex-shrink:0}
    .mn-nav-btn:active{background:rgba(255,255,255,.35)}
    .mn-date-input{background:rgba(255,255,255,.95);color:#5C1E5A;border:none;border-radius:9px;padding:5px 10px;font-size:.78rem;font-weight:800;font-family:inherit}
    .mn-hd-sub{font-size:.74rem;opacity:.95;margin-top:2px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
    .mn-when-pill{background:rgba(255,255,255,.22);padding:1px 8px;border-radius:8px;font-size:.66rem;font-weight:800;text-transform:uppercase;letter-spacing:.4px}
    .mn-hd-row{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}
    .mn-hd-pill{background:rgba(255,255,255,.18);border:none;color:#fff;padding:7px 12px;border-radius:18px;font-size:.78rem;font-weight:800;cursor:pointer;font-family:inherit}
    .mn-hd-pill.on{background:#fff;color:#5C1E5A}
    .mn-toolbar{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
    .mn-tb{flex:1;min-width:48%;padding:9px 10px;border:1.5px solid var(--brd,#e0d0e0);background:var(--fond,#fff);border-radius:10px;font-size:.78rem;font-weight:800;cursor:pointer;font-family:inherit;color:var(--plum,#5C1E5A)}
    .mn-tb:active{opacity:.8}
    .mn-cat{background:#fff;border:1.5px solid var(--brd,#e0d0e0);border-radius:14px;padding:11px 12px;margin-bottom:9px}
    .mn-cat-hd{display:flex;align-items:center;gap:8px;margin-bottom:8px}
    .mn-cat-tit{font-size:.88rem;font-weight:900;color:var(--plum,#5C1E5A);flex:1}
    .mn-cat-cnt{font-size:.7rem;font-weight:700;color:#b89ab6;background:#f3e8f3;padding:2px 9px;border-radius:10px}
    .mn-add-row{display:flex;gap:5px;margin-bottom:7px}
    .mn-add-inp{flex:1;border:1.5px solid #ddd0dd;border-radius:9px;padding:8px 10px;font-size:.85rem;font-family:inherit;background:#f7f2f7;min-width:0}
    .mn-add-inp:focus{outline:none;border-color:var(--plum,#5C1E5A)}
    .mn-add-btn{background:var(--plum,#5C1E5A);color:#fff;border:none;border-radius:9px;padding:8px 11px;font-weight:800;cursor:pointer;font-family:inherit;font-size:.82rem;flex-shrink:0}
    .mn-mic-btn{background:#fff;color:var(--plum,#5C1E5A);border:1.5px solid #d8b4d8;border-radius:9px;padding:8px 10px;font-weight:800;cursor:pointer;font-family:inherit;font-size:.95rem;flex-shrink:0}
    .mn-mic-btn.recording{background:#dc2626;color:#fff;border-color:#dc2626;animation:micPulse 1s infinite}
    @keyframes micPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.08)} }
    .mn-add-btn:active,.mn-mic-btn:active{opacity:.8}
    .mn-plat{background:#f7f2f7;border-radius:10px;padding:8px 10px;margin-bottom:5px;border:1.5px solid #ede0ed}
    .mn-plat-row1{display:flex;align-items:center;gap:7px}
    .mn-plat-name{flex:1;font-size:.86rem;font-weight:700;color:#3b1e3b;line-height:1.25;word-break:break-word}
    .mn-plat-prof{font-size:.65rem;font-weight:800;padding:2px 8px;border-radius:9px;color:#fff;flex-shrink:0;cursor:pointer;border:none;font-family:inherit}
    .mn-plat-del{background:#fee2e2;color:#dc2626;border:1.5px solid #fca5a5;border-radius:8px;padding:4px 7px;font-size:.7rem;font-weight:800;cursor:pointer;font-family:inherit;flex-shrink:0}
    .mn-plat-row2{display:flex;align-items:center;gap:6px;margin-top:5px;flex-wrap:wrap}
    .mn-plat-row3{display:flex;align-items:center;gap:10px;margin-top:6px;padding-top:5px;border-top:1px dashed #d8b4d8}
    .mn-plat-chk{display:inline-flex;align-items:center;gap:4px;font-size:.74rem;font-weight:700;color:#5C1E5A;cursor:pointer;user-select:none}
    .mn-plat-chk input{width:18px;height:18px;accent-color:#5C1E5A;cursor:pointer}
    .mn-plat-st{font-size:.66rem;font-weight:800;padding:2px 7px;border-radius:8px}
    .mn-plat-st.todo{background:#fef9c3;color:#854d0e}
    .mn-plat-st.partial{background:#fed7aa;color:#9a3412}
    .mn-plat-st.ok{background:#dcfce7;color:#166534}
    .mn-plat-st.auto{background:#dbeafe;color:#1e3a8a}
    .mn-plat-comp{font-size:.66rem;color:#7A6579;font-style:italic}
    .mn-cov{background:linear-gradient(135deg,#1b5e20,#2e7d32);color:#fff;border-radius:14px;padding:11px 14px;margin-bottom:10px}
    .mn-cov.warn{background:linear-gradient(135deg,#92400e,#d97706)}
    .mn-cov.bad{background:linear-gradient(135deg,#991b1b,#dc2626)}
    .mn-cov-tit{font-size:.78rem;font-weight:800;margin-bottom:3px;display:flex;align-items:center;gap:6px}
    .mn-cov-bar{height:7px;background:rgba(255,255,255,.25);border-radius:6px;overflow:hidden;margin-top:4px}
    .mn-cov-fill{height:100%;background:#fff;border-radius:6px;transition:.3s}
    .mn-cov-sub{font-size:.7rem;opacity:.92;margin-top:5px;line-height:1.4}
    .mn-empty{font-size:.78rem;color:#b89ab6;font-style:italic;text-align:center;padding:8px}
    .mn-action-grid{display:flex;flex-direction:column;gap:8px;margin-top:14px}
    .mn-act{width:100%;padding:15px 16px;border:none;border-radius:14px;font-weight:800;font-family:inherit;cursor:pointer;font-size:.9rem;color:#fff;display:flex;align-items:center;justify-content:center;gap:6px;text-align:center;line-height:1.2;letter-spacing:.2px;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
    .mn-act:active{transform:scale(.97);opacity:.9}
    .mn-act.save{background:linear-gradient(135deg,#5C1E5A,#C93A78);box-shadow:0 3px 10px rgba(92,30,90,.35)}
    .mn-act.clear{background:#fff;color:#dc2626;border:1.5px solid #fca5a5}
    .mn-hist{background:#fff;border:1.5px solid var(--brd,#e0d0e0);border-radius:14px;padding:11px 12px;margin-top:14px;margin-bottom:30px}
    .mn-hist-tit{font-size:.88rem;font-weight:900;color:var(--plum,#5C1E5A);margin-bottom:8px;display:flex;align-items:center;gap:7px}
    .mn-hist-item{background:#f7f2f7;border-radius:10px;padding:9px 10px;margin-bottom:5px;border:1.5px solid #ede0ed;cursor:pointer}
    .mn-hist-item:active{opacity:.8}
    .mn-hist-row1{display:flex;align-items:center;gap:7px}
    .mn-hist-date{flex:1;font-size:.78rem;font-weight:800;color:#3b1e3b}
    .mn-hist-svc{background:#5C1E5A;color:#fff;font-size:.62rem;font-weight:800;padding:2px 7px;border-radius:8px}
    .mn-hist-cnt{font-size:.66rem;color:#7A6579;background:#fff;padding:1px 7px;border-radius:8px;border:1px solid #ede0ed}
    .mn-hist-row2{font-size:.7rem;color:#7A6579;margin-top:3px;line-height:1.4}
  </style>

  <div class="mn-hd">
    <div class="mn-hd-title-row">
      <button class="mn-nav-btn" onclick="window._menuSwitchDate('${dPrev}')" title="Jour précédent">‹</button>
      <h2>🍽️ Menu — ${dFr}</h2>
      <button class="mn-nav-btn" onclick="window._menuSwitchDate('${dNext}')" title="Jour suivant">›</button>
    </div>
    <div class="mn-hd-sub">
      <input type="date" class="mn-date-input" value="${d}" onchange="window._menuSwitchDate(this.value)">
      ${isToday ? '<span class="mn-when-pill">Aujourd\'hui</span>' : (isPast ? '<span class="mn-when-pill">Passé</span>' : '<span class="mn-when-pill">À venir</span>')}
      <span class="mn-when-pill" style="background:rgba(255,255,255,.35)">${totalPlats} plat${totalPlats>1?'s':''}</span>
    </div>
    <div class="mn-hd-row">
      ${SERVICES.map(s=>`<button class="mn-hd-pill ${sv===s.id?'on':''}" onclick="window._menuSwitchService('${s.id}')">${s.label}</button>`).join('')}
    </div>
  </div>

  ${renderCoverageCard(cov)}

  <div class="mn-toolbar">
    <button class="mn-tb" onclick="window._menuRecopierHier()">🔁 Recopier menu d'hier</button>
    <button class="mn-tb" onclick="window._menuValiderSorties()">⚡ Valider tout préparé minute</button>
  </div>
  <div class="mn-toolbar">
    <button class="mn-tb" onclick="window._menuFullDictee()" style="border-color:#5C1E5A;background:linear-gradient(135deg,#fdf4fd,#f7e0f7)">🎤 Dicter tout le menu</button>
    <button class="mn-tb" onclick="window._menuQuickJump()">📅 Aller à une date…</button>
  </div>

  ${renderProductsDatalist()}

  ${CATS.map(cat => renderCatBlock(menu, cat)).join('')}

  <div class="mn-action-grid">
    <button class="mn-act save" onclick="window._menuSave()">💾 Enregistrer le menu</button>
    <button class="mn-act clear" onclick="window._menuClear()">🗑️ Vider ${SERVICES.find(s=>s.id===sv)?.label||'ce service'}</button>
  </div>

  ${renderMenuHistory()}
  `;
}

function renderProductsDatalist(){
  const prods = (S.produits||[]).slice(0,400);
  if(!prods.length) return '';
  return `<datalist id="mn-prods-list">${prods.map(p=>`<option value="${escH(p)}">`).join('')}</datalist>`;
}

function renderCatBlock(menu, cat){
  const items = menu.categories[cat.id] || [];
  return `
  <div class="mn-cat">
    <div class="mn-cat-hd">
      <div class="mn-cat-tit">${cat.label}</div>
      <div class="mn-cat-cnt">${items.length}</div>
    </div>
    <div class="mn-add-row">
      <input id="mn-inp-${cat.id}" class="mn-add-inp" type="text" placeholder="Ajouter ${cat.short.toLowerCase()}…" list="mn-prods-list"
        onkeydown="if(event.key==='Enter'){event.preventDefault();window._menuAdd('${cat.id}');}" autocomplete="off">
      <button class="mn-mic-btn" id="mn-mic-${cat.id}" onclick="window._menuMicToggle('${cat.id}')" title="Dicter">🎤</button>
      <button class="mn-add-btn" onclick="window._menuAdd('${cat.id}')">+</button>
    </div>
    ${items.length === 0 ? `<div class="mn-empty">Aucun ${cat.short.toLowerCase()} pour ce service</div>` : items.map((p,i)=>renderPlatRow(cat.id, p, i)).join('')}
  </div>`;
}

function renderPlatRow(catId, plat, idx){
  const prof = PROFILS[plat.profil_haccp] || PROFILS.BF_CUIT;
  const stat = computePlatStatus(plat);
  const variants = plat.variants || {};
  return `
  <div class="mn-plat">
    <div class="mn-plat-row1">
      <div class="mn-plat-name">${escH(plat.nom)}</div>
      <button class="mn-plat-prof" style="background:${prof.color}" onclick="window._menuChangeProfil('${catId}',${idx})" title="Changer le profil HACCP">${prof.ico} ${prof.label}</button>
      <button class="mn-plat-del" onclick="window._menuRemove('${catId}',${idx})">✕</button>
    </div>
    <div class="mn-plat-row2">
      <span class="mn-plat-st ${stat.cls}">${stat.label}</span>
      ${plat.composants && plat.composants.length ? `<span class="mn-plat-comp">📝 ${plat.composants.map(escH).join(', ')}</span>` : ''}
    </div>
    <div class="mn-plat-row3">
      <label class="mn-plat-chk">
        <input type="checkbox" ${variants.mixe?'checked':''} onchange="window._menuToggleVariant('${catId}',${idx},'mixe',this.checked)">
        🥄 Mixé
      </label>
      <label class="mn-plat-chk">
        <input type="checkbox" ${variants.sans_sel?'checked':''} onchange="window._menuToggleVariant('${catId}',${idx},'sans_sel',this.checked)">
        🚫 Sans sel
      </label>
      <label class="mn-plat-chk">
        <input type="checkbox" ${variants.hp?'checked':''} onchange="window._menuToggleVariant('${catId}',${idx},'hp',this.checked)">
        💪 HP
      </label>
    </div>
  </div>`;
}

function computePlatStatus(plat){
  if(plat.statut_auto === 'preparé_minute') return { cls:'auto', label:'⚡ Préparé minute' };
  const linked = countEnrLinkedToPlat(plat.plat_id);
  const expected = (PROFILS[plat.profil_haccp]||PROFILS.BF_CUIT).enr.length;
  if(linked === 0) return { cls:'todo', label:'À tracer' };
  if(linked >= expected) return { cls:'ok', label:`✓ ${linked}/${expected} tracé`};
  return { cls:'partial', label:`⏳ ${linked}/${expected} tracé` };
}

function countEnrLinkedToPlat(platId){
  if(!platId) return 0;
  let n = 0;
  const d = _menuState.date;
  const SECT = ['enr01','enr02','enr03','enr04','enr07','enr08','enr09','enr10','enr11','enr12',
                'enr13','enr14','enr15','enr16','enr23','enr30','enr33','enr34','enr_tc_distrib'];
  SECT.forEach(s => {
    const lignes = (S[s]?.lignes || S[s]?.saisies || []);
    lignes.forEach(l => {
      if(l._plat_id === platId && (l.date === d || (l._ts||'').slice(0,10) === d)) n++;
    });
  });
  return n;
}

function renderCoverageCard(cov){
  const pct = cov.expected === 0 ? 0 : Math.round((cov.tracked / cov.expected) * 100);
  const cls = pct >= 80 ? '' : (pct >= 40 ? 'warn' : 'bad');
  const ico = pct >= 80 ? '✅' : (pct >= 40 ? '⚠️' : '❗');
  return `
  <div class="mn-cov ${cls}">
    <div class="mn-cov-tit">${ico} Couverture HACCP du menu — ${pct}%</div>
    <div class="mn-cov-bar"><div class="mn-cov-fill" style="width:${pct}%"></div></div>
    <div class="mn-cov-sub">${cov.total} plat${cov.total>1?'s':''} • ${cov.tracked} ENR enregistré${cov.tracked>1?'s':''} sur ${cov.expected} attendu${cov.expected>1?'s':''}</div>
  </div>`;
}

function computeMenuCoverage(menu){
  let total=0, expected=0, tracked=0;
  CATS.forEach(c => {
    (menu.categories[c.id]||[]).forEach(p => {
      total++;
      const prof = PROFILS[p.profil_haccp] || PROFILS.BF_CUIT;
      expected += prof.enr.length;
      if(p.statut_auto === 'preparé_minute') tracked += prof.enr.length;
      else tracked += countEnrLinkedToPlat(p.plat_id);
    });
  });
  return { total, expected, tracked };
}

// ════════════════════════════════════════════════════
// HISTORIQUE DES MENUS
// ════════════════════════════════════════════════════
function renderMenuHistory(){
  const hist = (S.menu_history||[]).slice().sort((a,b) => (b.menu_date||'').localeCompare(a.menu_date||'') || (b._ts||'').localeCompare(a._ts||''));
  if(hist.length === 0){
    return `<div class="mn-hist">
      <div class="mn-hist-tit">📚 Historique des menus</div>
      <div class="mn-empty">Aucun menu enregistré pour le moment.<br>Saisissez un menu et appuyez sur 💾 Enregistrer.</div>
    </div>`;
  }
  // Limiter à 30
  const items = hist.slice(0, 30);
  return `<div class="mn-hist">
    <div class="mn-hist-tit">📚 Historique des menus <span style="font-size:.66rem;font-weight:700;color:#7A6579;background:#f3e8f3;padding:1px 7px;border-radius:8px;margin-left:auto">${hist.length}</span></div>
    ${items.map((h,i) => {
      const svc = SERVICES.find(s => s.id === h.service);
      let nbPlats = 0;
      const cats = h.categories || {};
      const catSummary = [];
      CATS.forEach(c => {
        const arr = cats[c.id] || [];
        nbPlats += arr.length;
        if(arr.length) catSummary.push(c.short + ' ('+arr.length+')');
      });
      return `<div class="mn-hist-item" onclick="window._menuLoadFromHistory(${i})">
        <div class="mn-hist-row1">
          <div class="mn-hist-date">${escH(fmtDateFr(h.menu_date||h.date||''))}</div>
          <span class="mn-hist-svc">${escH(svc?.label||h.service||'')}</span>
          <span class="mn-hist-cnt">${nbPlats} plats</span>
        </div>
        <div class="mn-hist-row2">${catSummary.length ? escH(catSummary.join(' • ')) : '—'}</div>
      </div>`;
    }).join('')}
  </div>`;
}

window._menuLoadFromHistory = function(idx){
  const hist = (S.menu_history||[]).slice().sort((a,b) => (b.menu_date||'').localeCompare(a.menu_date||'') || (b._ts||'').localeCompare(a._ts||''));
  const h = hist[idx];
  if(!h) return;
  if(!confirm('Charger ce menu (' + fmtDateFr(h.menu_date) + ' / ' + h.service + ') sur la date courante ('+fmtDateFr(_menuState.date)+' / '+_menuState.service+') ?')) return;
  // Recopier dans la date courante
  const newMenu = {
    menu_id: newUUID(),
    categories: {},
  };
  CATS.forEach(c => {
    newMenu.categories[c.id] = ((h.categories||{})[c.id] || []).map(p => ({
      ...p,
      plat_id: newUUID().slice(0,8),
      statut_auto: null,
    }));
  });
  setMenu(_menuState.date, _menuState.service, newMenu);
  if(typeof renderMain === 'function') renderMain();
  if(typeof toast === 'function') toast('✅ Menu chargé depuis l\'historique','success');
};

// ════════════════════════════════════════════════════
// ACTIONS
// ════════════════════════════════════════════════════
window._menuSwitchService = function(s){
  _menuState.service = s;
  if(typeof renderMain === 'function') renderMain();
};
window._menuSwitchDate = function(d){
  if(!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
  _menuState.date = d;
  if(typeof renderMain === 'function') renderMain();
};
window._menuQuickJump = function(){
  const today_ = today();
  const opts = [
    { lbl:'📅 Aujourd\'hui',     d: today_ },
    { lbl:'➡️ Demain',           d: addDays(today_, +1) },
    { lbl:'➡️ Après-demain',     d: addDays(today_, +2) },
    { lbl:'⬅️ Hier',             d: addDays(today_, -1) },
    { lbl:'➡️ Dans 1 semaine',   d: addDays(today_, +7) },
  ];
  const ov = document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9000;display:flex;align-items:flex-end;justify-content:center';
  ov.innerHTML = `<div style="background:#fff;border-radius:18px 18px 0 0;width:100%;max-width:480px;padding:16px 14px 24px">
    <div style="font-size:.95rem;font-weight:900;color:#5C1E5A;margin-bottom:10px">📅 Sauter à une date</div>
    ${opts.map(o => `<button data-d="${o.d}" style="display:block;width:100%;text-align:left;background:#f7f2f7;border:1.5px solid #ede0ed;border-radius:10px;padding:11px 13px;margin-bottom:6px;cursor:pointer;font-family:inherit;font-size:.86rem;font-weight:700;color:#3b1e3b">${o.lbl} <span style="float:right;font-weight:500;color:#7A6579;font-size:.75rem">${new Date(o.d+'T12:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'})}</span></button>`).join('')}
    <button id="_menuJumpCancel" style="width:100%;margin-top:8px;padding:11px;background:#f3e8f3;color:#5C1E5A;border:none;border-radius:10px;font-weight:800;cursor:pointer;font-family:inherit">Annuler</button>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => {
    if(e.target === ov){ document.body.removeChild(ov); return; }
    const b = e.target.closest('button[data-d]');
    if(b){ document.body.removeChild(ov); window._menuSwitchDate(b.dataset.d); }
  });
  document.getElementById('_menuJumpCancel')?.addEventListener('click', ()=>document.body.removeChild(ov));
};

function _addPlat(catId, nom){
  const menu = getMenu(_menuState.date, _menuState.service) || { categories:emptyCategories(), menu_id:newUUID() };
  if(!menu.categories[catId]) menu.categories[catId] = [];
  const profil = detectProfil(nom);
  const plat = {
    plat_id:    newUUID().slice(0,8),
    nom:        nom,
    profil_haccp: profil,
    composants: detectComposants(nom),
    allergenes: [],
    statut_auto:null,
    variants:   {},
  };
  menu.categories[catId].push(plat);
  setMenu(_menuState.date, _menuState.service, menu);
  if(typeof S.produits !== 'undefined'){
    if(!S.produits) S.produits = [];
    if(!S.produits.includes(nom)) S.produits = [nom, ...S.produits].slice(0,400);
    save();
  }
  return plat;
}
window._menuAdd = function(catId){
  const inp = document.getElementById('mn-inp-'+catId);
  if(!inp) return;
  const nom = (inp.value||'').trim();
  if(!nom){ if(typeof toast==='function') toast('Entrez un nom de plat','warning'); return; }
  // Garde-fou : pas de plat avec plus de 80 caractères (probablement bug dictée)
  if(nom.length > 80){
    if(typeof toast==='function') toast('Nom trop long ('+nom.length+' car) — utilisez la dictée par catégorie','warning');
    return;
  }
  _addPlat(catId, nom);
  inp.value = '';
  if(typeof renderMain === 'function') renderMain();
  setTimeout(()=>{ const x=document.getElementById('mn-inp-'+catId); if(x) x.focus(); },50);
};
window._menuRemove = function(catId, idx){
  const menu = getMenu(_menuState.date, _menuState.service);
  if(!menu) return;
  menu.categories[catId].splice(idx,1);
  setMenu(_menuState.date, _menuState.service, menu);
  if(typeof renderMain === 'function') renderMain();
};
window._menuChangeProfil = function(catId, idx){
  const menu = getMenu(_menuState.date, _menuState.service);
  if(!menu) return;
  const plat = menu.categories[catId][idx];
  if(!plat) return;
  const order = ['BF_CUIT','BF_CRU','REMISE_TC','SORTIE_DIRECTE','PREP_MINUTE'];
  const cur = order.indexOf(plat.profil_haccp);
  plat.profil_haccp = order[(cur+1) % order.length];
  if(!['SORTIE_DIRECTE','PREP_MINUTE'].includes(plat.profil_haccp)) plat.statut_auto = null;
  setMenu(_menuState.date, _menuState.service, menu);
  if(typeof renderMain === 'function') renderMain();
  if(typeof toast === 'function') toast('Profil → ' + (PROFILS[plat.profil_haccp]?.label||'?'), 'info');
};
window._menuToggleVariant = function(catId, idx, variant, checked){
  const menu = getMenu(_menuState.date, _menuState.service);
  if(!menu) return;
  const plat = menu.categories[catId][idx];
  if(!plat) return;
  plat.variants = plat.variants || {};
  plat.variants[variant] = !!checked;
  setMenu(_menuState.date, _menuState.service, menu);
  // Pas de re-render complet — la checkbox est déjà à jour visuellement
};
window._menuRecopierHier = function(){
  const dStr = addDays(_menuState.date, -1);
  const hier = getMenu(dStr, _menuState.service);
  if(!hier){
    if(typeof toast==='function') toast('Pas de menu enregistré pour la veille ('+_menuState.service+')','warning');
    return;
  }
  const menu = {
    menu_id:    newUUID(),
    categories: {},
  };
  CATS.forEach(c => {
    menu.categories[c.id] = (hier.categories[c.id]||[]).map(p => ({
      ...p, plat_id: newUUID().slice(0,8), statut_auto:null,
    }));
  });
  setMenu(_menuState.date, _menuState.service, menu);
  if(typeof renderMain === 'function') renderMain();
  if(typeof toast === 'function') toast('✅ Menu de la veille recopié','success');
};
window._menuValiderSorties = function(){
  const menu = getMenu(_menuState.date, _menuState.service);
  if(!menu){ if(typeof toast==='function') toast('Aucun menu','warning'); return; }
  let n = 0;
  CATS.forEach(c => {
    (menu.categories[c.id]||[]).forEach(p => {
      if(p.profil_haccp === 'SORTIE_DIRECTE' || p.profil_haccp === 'PREP_MINUTE'){
        p.statut_auto = 'preparé_minute';
        n++;
      }
    });
  });
  setMenu(_menuState.date, _menuState.service, menu);
  if(typeof renderMain === 'function') renderMain();
  if(typeof toast === 'function') toast(n ? '✅ '+n+' plat(s) auto-validé(s)' : 'Aucun plat à auto-valider', n?'success':'info');
};
window._menuClear = function(){
  const sv = SERVICES.find(s => s.id === _menuState.service)?.label || _menuState.service;
  if(!confirm('Vider le menu de '+sv+' ?')) return;
  const menu = { categories: emptyCategories(), menu_id: newUUID() };
  setMenu(_menuState.date, _menuState.service, menu);
  if(typeof renderMain === 'function') renderMain();
};
window._menuSave = function(){
  const menu = getMenu(_menuState.date, _menuState.service);
  if(!menu){ if(typeof toast==='function') toast('Aucun menu','warning'); return; }
  let total = 0;
  CATS.forEach(c => total += (menu.categories[c.id]||[]).length);
  if(total === 0){ if(typeof toast==='function') toast('Menu vide — ajoutez au moins un plat','warning'); return; }
  const rec = stampEntry({
    menu_date: _menuState.date,
    service:   _menuState.service,
    categories:menu.categories,
    menu_id:   menu.menu_id,
    date:      _menuState.date,
    _ts:       new Date().toISOString(),
  });
  if(!S.menu_history) S.menu_history = [];
  S.menu_history = S.menu_history.filter(h => !(h.menu_date===_menuState.date && h.service===_menuState.service));
  S.menu_history.push(rec);
  if(S.menu_history.length > 200) S.menu_history = S.menu_history.slice(-200);
  save();
  try {
    if(typeof SupaEngine !== 'undefined' && SupaEngine.enqueue){
      SupaEngine.enqueue('enr_menu', rec);
      if(SupaEngine.flush) setTimeout(()=>SupaEngine.flush(), 200);
    }
  } catch(e){ console.warn('[menu] enqueue:', e); }
  // Auto-générer ENR33 + ajouter étiquettes au lot
  _menuAutoOnSave(menu);
  if(typeof renderMain === 'function') renderMain();
};

// Appelé automatiquement à chaque "Enregistrer le menu"
function _menuAutoOnSave(menu){
  const chef = (typeof getActiveSession==='function' ? getActiveSession() : null) ||
               (S.config?.chefs && S.config.chefs[0]) || '';
  const heure       = (typeof nowT === 'function') ? nowT() : new Date().toTimeString().slice(0,5);
  const datePrelev  = _menuState.date;
  const dateDestruct= addDays(datePrelev, 7);
  const serviceTxt  = _menuState.service === 'midi'     ? 'Déjeuner'
                    : _menuState.service === 'soir'     ? 'Dîner'
                    : _menuState.service === 'petitdej' ? 'Petit-déjeuner' : 'Goûter';

  S.enr33 = S.enr33 || {}; S.enr33.lignes = S.enr33.lignes || [];
  const deja = (S.enr33.lignes||[]).filter(l =>
    l._menu_id === menu.menu_id && (l.date === today() || (l._ts||'').slice(0,10) === today())
  );
  let count33 = 0;
  if(deja.length === 0){
    CATS.forEach(c => {
      (menu.categories[c.id]||[]).forEach(plat => {
        addPlatTemoin(plat.nom, plat, chef, datePrelev, heure, dateDestruct, serviceTxt, menu.menu_id, '');
        count33++;
        if(plat.variants?.mixe)    { addPlatTemoin(plat.nom+' (mixé)',    plat, chef, datePrelev, heure, dateDestruct, serviceTxt, menu.menu_id, 'mixé');    count33++; }
        if(plat.variants?.sans_sel){ addPlatTemoin(plat.nom+' (sans sel)',plat, chef, datePrelev, heure, dateDestruct, serviceTxt, menu.menu_id, 'sans_sel');count33++; }
        if(plat.variants?.hp)      { addPlatTemoin(plat.nom+' (HP)',      plat, chef, datePrelev, heure, dateDestruct, serviceTxt, menu.menu_id, 'hp');       count33++; }
      });
    });
    save();
    try { if(typeof SupaEngine !== 'undefined' && SupaEngine.flush) SupaEngine.flush(); } catch(e){}
  }

  // Ajouter les étiquettes au lot ENR34 (sans imprimer)
  S.enr34 = S.enr34 || {}; S.enr34.lignes = S.enr34.lignes || [];
  let count34 = 0;
  CATS.forEach(c => {
    (menu.categories[c.id]||[]).forEach(plat => {
      const variants = [
        { nom: plat.nom, variant: '' },
        ...(plat.variants?.mixe     ? [{ nom: plat.nom+' (mixé)',    variant: 'MIXÉ'    }] : []),
        ...(plat.variants?.sans_sel ? [{ nom: plat.nom+' (sans sel)',variant: 'SANS SEL'}] : []),
        ...(plat.variants?.hp       ? [{ nom: plat.nom+' (HP)',      variant: 'HP'      }] : []),
      ];
      variants.forEach(v => {
        const ts = new Date().toISOString();
        const rec = {
          produit: v.nom, association: v.nom, service: serviceTxt,
          date: datePrelev, heure_prelev: heure, date_destruct: dateDestruct,
          operateur: chef, nb_etiq: 1,
          _sec: 'enr34', _ts: ts,
          _plat_id: plat.plat_id, _plat_nom: plat.nom, _menu_id: menu.menu_id,
          _variant: v.variant || null, _from_menu: true,
        };
        S.enr34.lignes.unshift(rec);
        try { if(typeof SupaEngine !== 'undefined' && SupaEngine.enqueue) SupaEngine.enqueue('enr34', rec); } catch(e){}
        count34++;
      });
    });
  });
  save();

  const msg = count33 > 0
    ? `✅ Menu enregistré · ${count33} plat${count33>1?'s':''} témoin${count33>1?'s':''} créé${count33>1?'s':''} · ${count34} étiquette${count34>1?'s':''} dans le lot`
    : `✅ Menu enregistré · ${count34} étiquette${count34>1?'s':''} mises à jour dans le lot`;
  if(typeof toast === 'function') toast(msg, 'success');
}

// ════════════════════════════════════════════════════
// GÉNÉRATION AUTO PLATS TÉMOINS (ENR33)
// ════════════════════════════════════════════════════
window._menuGenerateTemoins = function(){
  const menu = getMenu(_menuState.date, _menuState.service);
  if(!menu){ if(typeof toast==='function') toast('Aucun menu pour ce service','warning'); return; }

  // Récupérer le chef en session
  const chef = (typeof getActiveSession==='function' ? getActiveSession() : null) ||
               (S.config?.chefs && S.config.chefs[0]) || '';
  const heure = (typeof nowT === 'function') ? nowT() : new Date().toTimeString().slice(0,5);
  const datePrelev = _menuState.date;
  const dateDestruct = addDays(datePrelev, 7); // 7j pour plats témoins
  const svcLabel = SERVICES.find(s=>s.id===_menuState.service)?.label || '';
  const serviceTxt = _menuState.service === 'midi' ? 'Déjeuner' :
                     _menuState.service === 'soir' ? 'Dîner' :
                     _menuState.service === 'petitdej' ? 'Petit-déjeuner' : 'Goûter';

  S.enr33 = S.enr33 || {};
  S.enr33.lignes = S.enr33.lignes || [];

  // Vérifier doublons : ne pas régénérer si déjà fait aujourd'hui pour ce menu
  const existing = S.enr33.lignes.filter(l => l._menu_id === menu.menu_id && (l.date === today() || (l._ts||'').slice(0,10) === today()));
  if(existing.length > 0){
    if(!confirm(existing.length+' plat(s) témoin(s) déjà générés pour ce menu aujourd\'hui. En générer à nouveau ?')) return;
  }

  let count = 0;
  CATS.forEach(c => {
    (menu.categories[c.id]||[]).forEach(plat => {
      // Plat normal
      addPlatTemoin(plat.nom, plat, chef, datePrelev, heure, dateDestruct, serviceTxt, menu.menu_id, '');
      count++;
      // Variantes
      if(plat.variants?.mixe){
        addPlatTemoin(plat.nom + ' (mixé)', plat, chef, datePrelev, heure, dateDestruct, serviceTxt, menu.menu_id, 'mixé');
        count++;
      }
      if(plat.variants?.sans_sel){
        addPlatTemoin(plat.nom + ' (sans sel)', plat, chef, datePrelev, heure, dateDestruct, serviceTxt, menu.menu_id, 'sans_sel');
        count++;
      }
      if(plat.variants?.hp){
        addPlatTemoin(plat.nom + ' (HP)', plat, chef, datePrelev, heure, dateDestruct, serviceTxt, menu.menu_id, 'hp');
        count++;
      }
    });
  });

  save();
  try {
    if(typeof SupaEngine !== 'undefined' && SupaEngine.flush) SupaEngine.flush();
  } catch(e){}
  if(typeof toast === 'function') toast('✅ '+count+' plat'+(count>1?'s':'')+' témoin'+(count>1?'s':'')+' généré'+(count>1?'s':'')+' (ENR33)','success');
  if(typeof renderMain === 'function') renderMain();
};

function addPlatTemoin(nom, plat, chef, datePrelev, heure, dateDestruct, serviceTxt, menuId, variant){
  const rec = stampEntry({
    produit:        nom,
    operateur:      chef,
    date:           today(),
    date_prelev:    datePrelev,
    heure_prelev:   heure,
    date_destruct:  dateDestruct,
    service:        serviceTxt,
    nb_etiq:        1,
    _sec:          'enr33',
    _ts:           new Date().toISOString(),
    _plat_id:       plat.plat_id,
    _plat_nom:      plat.nom,
    _plat_profil:   plat.profil_haccp,
    _menu_id:       menuId,
    _from_menu:     true,
    _variant:       variant || null,
  });
  S.enr33.lignes.unshift(rec);
  try { if(typeof SupaEngine !== 'undefined' && SupaEngine.enqueue) SupaEngine.enqueue('enr33', rec); } catch(e){}
}

// ════════════════════════════════════════════════════
// IMPRIMER TOUTES LES ÉTIQUETTES DU MENU DU JOUR
// ════════════════════════════════════════════════════
window._menuPrintEtiquettes = function(){
  const menu = getMenu(_menuState.date, _menuState.service);
  if(!menu){ if(typeof toast==='function') toast('Aucun menu pour ce service','warning'); return; }

  const chef = (typeof getActiveSession==='function' ? getActiveSession() : null) ||
               (S.config?.chefs && S.config.chefs[0]) || '';
  const heure = (typeof nowT === 'function') ? nowT() : new Date().toTimeString().slice(0,5);
  const datePrelev = _menuState.date;
  const dateDestruct = addDays(datePrelev, 7);
  const serviceTxt = _menuState.service === 'midi' ? 'Déjeuner' :
                     _menuState.service === 'soir' ? 'Dîner' :
                     _menuState.service === 'petitdej' ? 'Petit-déjeuner' : 'Goûter';

  // Collecter les étiquettes par plat et aligner sur grille 2 colonnes
  // Chaque plat = [normal, mixé?, sans_sel?, hp?] → si nombre impair on ajoute un espaceur null
  const etiqs = [];
  CATS.forEach(c => {
    (menu.categories[c.id]||[]).forEach(plat => {
      const group = [{ nom: plat.nom, variant: '' }];
      if(plat.variants?.mixe)     group.push({ nom: plat.nom, variant: 'MIXÉ' });
      if(plat.variants?.sans_sel) group.push({ nom: plat.nom, variant: 'SANS SEL' });
      if(plat.variants?.hp)       group.push({ nom: plat.nom, variant: 'HP' });
      // Pad à un multiple de 2 pour que le plat suivant commence toujours à gauche
      if(group.length % 2 !== 0)  group.push(null);
      etiqs.push(...group);
    });
  });

  if(!etiqs.some(Boolean)){
    if(typeof toast==='function') toast('Aucun plat dans le menu','warning');
    return;
  }

  // Construire une page d'impression A4 avec toutes les étiquettes
  const dPrelev = fmtDateFr(datePrelev);
  const dDestr = fmtDateFr(dateDestruct);
  const ico = _menuState.service==='midi'?'☀️':_menuState.service==='soir'?'🌙':_menuState.service==='petitdej'?'🌅':'🍰';
  const etabName = (S.syncCfg?.siteNom || S.config?.etab || 'Établissement');

  const realCount = etiqs.filter(Boolean).length;
  const cards = etiqs.map(e => {
    if(e === null) return `<div class="etiq-spacer"></div>`;
    const fullNom = e.variant ? (e.nom + ' — ' + e.variant) : e.nom;
    const variantBadge = e.variant ? `<div class="variant-badge">${escH(e.variant)}</div>` : '';
    return `<div class="etiq">
      <div class="hd">
        <span class="logo">${escH(etabName)}</span>
        <span class="title">PLAT TÉMOIN</span>
      </div>
      ${variantBadge}
      <div class="service">${ico} ${escH(serviceTxt)}</div>
      <div class="prod">${escH(fullNom)}</div>
      <div class="row">Prélevé le : <b>${dPrelev}</b> à <b>${heure}</b></div>
      <div class="row">Par : ${escH(chef||'—')}</div>
      <div class="conserve">🌡️ Conserver 0°C / +3°C — NE PAS OUVRIR</div>
      <div class="destruct">🗑️ À détruire le : <b>${dDestr}</b></div>
    </div>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Étiquettes — Menu du ${dPrelev}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;background:#f5f5f5;padding:12px}
.no-print{background:#fff;border-radius:10px;padding:10px 12px;margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;box-shadow:0 1px 4px rgba(0,0,0,.1)}
.no-print button{cursor:pointer;font-family:inherit}
.no-print h2{font-size:14px;color:#5C1E5A;margin:0;font-weight:800}
.page{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start}
.etiq-spacer{width:calc(50% - 10px);min-width:280px;visibility:hidden}
.etiq{width:calc(50% - 10px);min-width:280px;border:2.5px solid #5C1E5A;border-radius:5px;padding:8px 10px;display:flex;flex-direction:column;gap:4px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.1);page-break-inside:avoid}
.hd{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #5C1E5A;padding-bottom:5px;gap:6px}
.logo{font-size:9px;font-weight:bold;color:#c93a78;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.title{background:#5C1E5A;color:#fff;font-size:10px;font-weight:bold;padding:2px 6px;border-radius:3px;flex-shrink:0}
.variant-badge{background:#dc2626;color:#fff;font-size:9px;font-weight:900;padding:2px 6px;border-radius:3px;align-self:flex-start;letter-spacing:.5px}
.service{font-size:10px;color:#5C1E5A;font-weight:bold}
.prod{font-size:13px;font-weight:bold;color:#111;line-height:1.2}
.row{font-size:9.5px;color:#333}
.conserve{font-size:8.5px;color:#666;font-style:italic;border-top:1px dashed #ccc;padding-top:4px}
.destruct{font-size:10.5px;font-weight:bold;color:#c00;background:#fff5f5;border-radius:3px;padding:3px 5px}
@media print {
  body{background:#fff;padding:0}
  .no-print{display:none !important}
  .page{gap:3mm}
  .etiq-spacer{width:calc(50% - 3mm);visibility:hidden}
  .etiq{width:calc(50% - 3mm);min-width:0;border-width:0.4mm;padding:2.5mm 3mm;gap:1mm;box-shadow:none}
  .hd{padding-bottom:1mm}
  .logo{font-size:6pt}
  .title{font-size:7pt;padding:0.5mm 1.5mm}
  .variant-badge{font-size:6.5pt;padding:0.4mm 1.2mm}
  .service{font-size:7pt}
  .prod{font-size:9.5pt;line-height:1.1}
  .row{font-size:6.5pt}
  .conserve{font-size:6pt;padding-top:0.8mm}
  .destruct{font-size:7.5pt;padding:0.8mm 1.5mm}
  @page { size:A4; margin:8mm }
}
</style>
</head><body>
<div class="no-print">
  <h2>🖨️ ${realCount} étiquette${realCount>1?'s':''} — Menu ${dPrelev} ${serviceTxt}</h2>
  <button onclick="window.print()" style="background:#5C1E5A;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:bold">🖨️ Imprimer</button>
  <button onclick="window.close()" style="background:#eee;color:#333;border:1px solid #ccc;padding:10px 20px;border-radius:8px;font-size:13px">✕ Fermer</button>
  <span style="font-size:12px;color:#666">À détruire le ${dDestr}</span>
</div>
<div class="page">${cards}</div>
<script>window.onload=function(){setTimeout(function(){try{window.print();}catch(e){}},400);};</script>
</body></html>`;

  try {
    const w = window.open('', '_blank', 'width=900,height=700');
    if(!w){
      if(typeof toast==='function') toast('Impression bloquée — autorisez les popups dans Chrome','danger');
      return;
    }
    w.document.write(html);
    w.document.close();
    if(typeof toast==='function') toast('🖨️ '+realCount+' étiquettes prêtes à imprimer','success');
  } catch(e){
    console.warn('[menu print]', e);
    if(typeof toast==='function') toast('Erreur impression: '+e.message,'danger');
  }
};

// ════════════════════════════════════════════════════
// DICTÉE VOCALE (par catégorie + plein menu)
// ════════════════════════════════════════════════════
let _activeRecognition = null;
let _activeMicCatId = null;

function getSpeechRecognition(){
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

window._menuMicToggle = function(catId){
  const SR = getSpeechRecognition();
  if(!SR){
    if(typeof toast==='function') toast('Dictée non supportée. Utilisez Chrome.','warning');
    return;
  }
  if(_activeRecognition && _activeMicCatId === catId){
    try { _activeRecognition.stop(); } catch(e){}
    _activeRecognition = null;
    _activeMicCatId = null;
    const btn = document.getElementById('mn-mic-'+catId);
    if(btn) btn.classList.remove('recording');
    return;
  }
  if(_activeRecognition){
    try { _activeRecognition.abort(); } catch(e){}
    if(_activeMicCatId){ const old = document.getElementById('mn-mic-'+_activeMicCatId); if(old) old.classList.remove('recording'); }
  }
  const rec = new SR();
  rec.lang = 'fr-FR';
  rec.continuous = false;
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  _activeRecognition = rec;
  _activeMicCatId = catId;
  const btn = document.getElementById('mn-mic-'+catId);
  if(btn) btn.classList.add('recording');
  rec.onresult = function(ev){
    const txt = ev.results[0][0].transcript.trim();
    if(txt && txt.length <= 80) {
      _addPlat(catId, capitalize(txt));
      if(typeof toast==='function') toast('🎤 → '+txt, 'success');
      if(typeof renderMain === 'function') renderMain();
    } else if(txt.length > 80){
      if(typeof toast==='function') toast('Texte trop long — dictez plat par plat','warning');
    }
  };
  rec.onerror = function(ev){
    console.warn('[menu mic]', ev.error);
    if(ev.error === 'no-speech'){ if(typeof toast==='function') toast('Aucune voix détectée','warning'); }
    else if(ev.error === 'not-allowed'){ if(typeof toast==='function') toast('Microphone refusé','danger'); }
    else { if(typeof toast==='function') toast('Erreur dictée: '+ev.error,'warning'); }
  };
  rec.onend = function(){
    if(btn) btn.classList.remove('recording');
    if(_activeRecognition === rec){ _activeRecognition = null; _activeMicCatId = null; }
  };
  try { rec.start(); }
  catch(e){
    console.warn('[menu mic start]', e);
    if(btn) btn.classList.remove('recording');
    _activeRecognition = null; _activeMicCatId = null;
  }
};

window._menuFullDictee = function(){
  const SR = getSpeechRecognition();
  if(!SR){
    if(typeof toast==='function') toast('Dictée non supportée. Utilisez Chrome.','warning');
    return;
  }
  const ov = document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML = `<div style="background:#fff;border-radius:18px;max-width:420px;width:100%;padding:18px 18px 16px">
    <div style="font-size:1rem;font-weight:900;color:#5C1E5A;margin-bottom:8px">🎤 Dicter tout le menu</div>
    <div style="font-size:.78rem;color:#3b1e3b;line-height:1.5;margin-bottom:12px">
      Annoncez les plats par catégorie. Exemple :<br>
      <em>« entrée carottes râpées, plat poulet rôti, garniture haricots verts, dessert yaourt »</em>
    </div>
    <div style="font-size:.7rem;color:#7A6579;background:#f7f2f7;padding:8px 10px;border-radius:8px;margin-bottom:14px">
      Mots-clés : <strong>potage, entrée, plat, garniture, fromage, dessert, pain</strong>
    </div>
    <div id="mn-dict-status" style="text-align:center;font-size:.85rem;font-weight:800;color:#5C1E5A;margin-bottom:12px;min-height:22px">Prêt — appuyez sur Démarrer</div>
    <div style="display:flex;gap:8px">
      <button id="mn-dict-cancel" style="flex:1;padding:11px;background:#f3e8f3;color:#5C1E5A;border:none;border-radius:10px;font-weight:800;cursor:pointer;font-family:inherit">Annuler</button>
      <button id="mn-dict-start" style="flex:2;padding:11px;background:linear-gradient(135deg,#5C1E5A,#C93A78);color:#fff;border:none;border-radius:10px;font-weight:800;cursor:pointer;font-family:inherit">🎤 Démarrer la dictée</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  let recObj = null;
  document.getElementById('mn-dict-cancel').onclick = ()=>{
    if(recObj){ try{recObj.abort();}catch(e){} }
    document.body.removeChild(ov);
  };
  document.getElementById('mn-dict-start').onclick = ()=>{
    const status = document.getElementById('mn-dict-status');
    status.textContent = '🎙️ Écoute en cours…';
    status.style.color = '#dc2626';
    const rec = new SR();
    rec.lang = 'fr-FR';
    rec.continuous = true;
    rec.interimResults = true;
    recObj = rec;
    let finalText = '';
    rec.onresult = function(ev){
      let interim = '';
      for(let i = ev.resultIndex; i < ev.results.length; i++){
        if(ev.results[i].isFinal) finalText += ev.results[i][0].transcript + ' ';
        else interim += ev.results[i][0].transcript;
      }
      status.textContent = '🎙️ ' + (interim || finalText).slice(-80);
    };
    rec.onerror = function(ev){
      status.textContent = '⚠️ ' + ev.error;
      status.style.color = '#dc2626';
    };
    rec.onend = function(){
      status.textContent = '⏳ Analyse…';
      status.style.color = '#5C1E5A';
      const parsed = parseDicteeFullMenu(finalText);
      setTimeout(()=>{
        if(document.body.contains(ov)) document.body.removeChild(ov);
        if(parsed > 0){ if(typeof toast==='function') toast('✅ '+parsed+' plat(s) ajouté(s)','success'); }
        else { if(typeof toast==='function') toast('Aucun plat reconnu — réessayez en disant les mots-clés','warning'); }
        if(typeof renderMain === 'function') renderMain();
      }, 350);
    };
    document.getElementById('mn-dict-start').textContent = '⏹ Arrêter';
    document.getElementById('mn-dict-start').onclick = ()=>{ try{rec.stop();}catch(e){} };
    try { rec.start(); }
    catch(e){ status.textContent = '⚠️ '+e.message; }
  };
};

// Mapping mot-clé → catégorie
const KW_TO_CAT_PAIRS = [
  [/^(potages?|soupes?|veloutés?)$/i, 'potages'],
  [/^(entrées?|crudités?)$/i, 'entrees'],
  [/^(plats?|viandes?|poissons?)$/i, 'plats'],
  [/^(garnitures?|accompagnements?|légumes?|legumes?)$/i, 'garnitures'],
  [/^(fromages?)$/i, 'fromages'],
  [/^(desserts?|laitages?|fruits?|pâtisseries?|patisseries?)$/i, 'desserts'],
  [/^(pains?|baguettes?)$/i, 'pains'],
];
function kwToCat(kw){
  for(const [re,c] of KW_TO_CAT_PAIRS){ if(re.test(kw)) return c; }
  return null;
}

// ⚡ NOUVEAU PARSER — utilise TOUTES les positions de mots-clés comme délimiteurs
function parseDicteeFullMenu(txt){
  if(!txt) return 0;
  const cleanTxt = txt.toLowerCase()
    .replace(/[.!?;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Trouver TOUTES les positions des mots-clés de catégorie
  const KW_PATTERN = /\b(potages?|soupes?|veloutés?|entrées?|crudités?|plats?|viandes?|poissons?|garnitures?|accompagnements?|légumes?|legumes?|fromages?|desserts?|laitages?|fruits?|pâtisseries?|patisseries?|pains?|baguettes?)\b/gi;

  const matches = [];
  let m;
  while((m = KW_PATTERN.exec(cleanTxt)) !== null){
    matches.push({pos: m.index, len: m[0].length, kw: m[0].toLowerCase()});
  }

  if(matches.length === 0) return 0;

  let added = 0;
  for(let i = 0; i < matches.length; i++){
    const cat = kwToCat(matches[i].kw);
    if(!cat) continue;
    const start = matches[i].pos + matches[i].len;
    const end = i + 1 < matches.length ? matches[i+1].pos : cleanTxt.length;
    let content = cleanTxt.slice(start, end).trim();
    if(!content) continue;

    // Nettoyer mots de liaison aux extrémités
    content = content.replace(/^(ou|et|puis|ensuite|d'|de|du|des|le|la|les|un|une)\s+/i, '')
                     .replace(/\s+(ou|et|puis|ensuite)$/i, '')
                     .trim();
    if(!content) continue;

    // Découper sur "et", "ou", "," — créer plusieurs plats si nécessaire
    const items = content.split(/\s+(?:et|ou|puis|ensuite)\s+|\s*,\s*/)
      .map(s => s.trim())
      .filter(s => s.length > 1 && s.length <= 80)
      // Filtrer items qui sont juste un mot-clé de catégorie
      .filter(it => !KW_PATTERN.test(it.replace(KW_PATTERN, '').length === 0 ? '' : it));

    items.forEach(it => {
      // Pas de doublons exacts dans la même catégorie
      const menu = getMenu(_menuState.date, _menuState.service);
      const exists = menu && (menu.categories[cat]||[]).some(p => p.nom.toLowerCase() === it.toLowerCase());
      if(exists) return;
      _addPlat(cat, capitalize(it));
      added++;
    });
  }
  return added;
}

// ════════════════════════════════════════════════════
// SÉLECTEUR PLAT (pour liaison ENR)
// ════════════════════════════════════════════════════
window._menuPickPlat = function(callback, opts){
  const allMenus = [];
  SERVICES.forEach(svc => {
    const m = getMenu(today(), svc.id);
    if(m) allMenus.push({ svc:svc.label, svcId:svc.id, menu:m });
  });
  const flat = [];
  allMenus.forEach(({svc, svcId, menu}) => {
    CATS.forEach(c => {
      (menu.categories[c.id]||[]).forEach(p => {
        if(opts && opts.profilFilter && p.profil_haccp !== opts.profilFilter) return;
        flat.push({ cat:c.label, svc, svcId, ...p, _menu_id:menu.menu_id });
      });
    });
  });
  if(!flat.length){
    if(typeof toast==='function') toast('Pas de plat correspondant dans le menu du jour','warning');
    return;
  }
  const ov = document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9000;display:flex;align-items:flex-end;justify-content:center';
  ov.innerHTML = `<div style="background:#fff;border-radius:18px 18px 0 0;width:100%;max-width:480px;max-height:80vh;overflow-y:auto;padding:16px 14px 24px">
    <div style="font-size:.95rem;font-weight:900;color:#5C1E5A;margin-bottom:10px">🍽️ Quel plat du menu ?</div>
    ${flat.map((p,i)=>{
      const prof = PROFILS[p.profil_haccp] || PROFILS.BF_CUIT;
      return `<button data-i="${i}" style="display:block;width:100%;text-align:left;background:#f7f2f7;border:1.5px solid #ede0ed;border-radius:10px;padding:11px 12px;margin-bottom:6px;cursor:pointer;font-family:inherit">
        <div style="font-size:.84rem;font-weight:800;color:#3b1e3b">${escH(p.nom)}</div>
        <div style="font-size:.7rem;color:#7A6579;margin-top:3px">
          <span style="background:${prof.color};color:#fff;padding:1px 7px;border-radius:8px;font-weight:800">${prof.ico} ${prof.label}</span>
          <span style="margin-left:6px">${escH(p.cat)} • ${escH(p.svc)}</span>
        </div>
      </button>`;
    }).join('')}
    <button id="_menupick_cancel" style="width:100%;margin-top:8px;padding:11px;background:#f3e8f3;color:#5C1E5A;border:none;border-radius:10px;font-weight:800;cursor:pointer;font-family:inherit">Annuler</button>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => {
    if(e.target === ov){ document.body.removeChild(ov); return; }
    const btn = e.target.closest('button[data-i]');
    if(btn){
      const p = flat[parseInt(btn.dataset.i)];
      document.body.removeChild(ov);
      callback({ plat_id:p.plat_id, nom:p.nom, profil_haccp:p.profil_haccp, menu_id:p._menu_id });
    }
  });
  document.getElementById('_menupick_cancel')?.addEventListener('click', ()=>document.body.removeChild(ov));
};

// ════════════════════════════════════════════════════
// LIAISON ENR + PRÉREMPLISSAGE
// ════════════════════════════════════════════════════
const LINK_ENRS = ['enr01','enr02','enr03','enr04','enr07','enr08','enr09','enr10',
                   'enr11','enr12','enr13','enr14','enr15','enr16','enr23','enr31','enr33','enr34'];

let _menuLinkPending = {};

const FILL_FIELD_PRIORITY = {
  enr01: ['produit'], enr02: ['produit'], enr03: ['produit'],
  enr04: ['produit'], enr07: ['produit'], enr08: ['produit'],
  enr09: ['produit'], enr10: ['produit'],
  enr11: ['produit'], enr12: ['produit'],
  enr13: ['type','produit'], enr14: ['produit','type'],
  enr15: ['produit'], enr16: ['produit'],
  enr23: ['produit'], enr31: ['produit'], enr33: ['produit'],
  enr34: ['produit','association'],
};

window._menuOpenLinkPicker = function(enrId){
  if(typeof window._menuPickPlat !== 'function') return;
  const opts = {};
  if(enrId === 'enr07') opts.profilFilter = 'BF_CUIT';
  if(enrId === 'enr08') opts.profilFilter = 'BF_CRU';
  window._menuPickPlat(function(ref){
    _menuLinkPending[enrId] = ref;
    if(typeof toast === 'function') toast('🔗 Lié : '+ref.nom, 'success');
    refreshLinkBanner(enrId);
    fillFormWithPlat(enrId, ref);
  }, opts);
};

window._menuClearLink = function(enrId){
  delete _menuLinkPending[enrId];
  refreshLinkBanner(enrId);
};

function fillFormWithPlat(enrId, ref){
  if(!ref || !ref.nom) return;
  const fields = FILL_FIELD_PRIORITY[enrId] || ['produit'];

  // 1. Mettre à jour le draft
  S[enrId] = S[enrId] || {};
  // ENR33 utilise draft33
  if(enrId === 'enr33'){
    S.enr33.draft33 = S.enr33.draft33 || {};
    S.enr33.draft33.produit = ref.nom;
  } else {
    S[enrId].draft = S[enrId].draft || {};
    let filledKey = null;
    for(const f of fields){
      if(!S[enrId].draft[f]){ S[enrId].draft[f] = ref.nom; filledKey = f; break; }
    }
    if(!filledKey){ S[enrId].draft[fields[0]] = ref.nom; }
  }
  save();

  // 2. Mettre à jour le DOM en direct (vrais IDs)
  fields.forEach(f => {
    const ids = [
      'ac-'+f+'-'+enrId,
      'inp-'+f+'-'+enrId,
      'ta-'+f+'-'+enrId,
    ];
    ids.forEach(id => {
      const inp = document.getElementById(id);
      if(inp){
        inp.value = ref.nom;
        try { inp.dispatchEvent(new Event('input', {bubbles:true})); } catch(e){}
        try { inp.dispatchEvent(new Event('change', {bubbles:true})); } catch(e){}
      }
    });
  });

  // 3. ENR33 fallback : trouver l'input "produit" via label
  if(enrId === 'enr33'){
    const inputs = document.querySelectorAll('#main-content input[type="text"]');
    inputs.forEach(inp => {
      const lblText = inp.closest('.fg')?.querySelector('label')?.textContent?.toLowerCase() || '';
      if((lblText.includes('plat') || lblText.includes('produit') || lblText.includes('nom')) && !inp.value){
        inp.value = ref.nom;
        try { inp.dispatchEvent(new Event('input', {bubbles:true})); } catch(e){}
        try { inp.dispatchEvent(new Event('change', {bubbles:true})); } catch(e){}
      }
    });
  }
}

function refreshLinkBanner(enrId){
  const banner = document.getElementById('mn-link-banner-'+enrId);
  if(!banner) return;
  banner.innerHTML = buildBannerInner(enrId);
}

function buildBannerInner(enrId){
  const ref = _menuLinkPending[enrId];
  let nbPlats = 0;
  SERVICES.forEach(svc => {
    const m = getMenu(today(), svc.id);
    if(m) CATS.forEach(c => { nbPlats += (m.categories?.[c.id]||[]).length; });
  });

  if(ref){
    const prof = PROFILS[ref.profil_haccp] || PROFILS.BF_CUIT;
    return `
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:1rem">🔗</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:.7rem;font-weight:700;color:#7A6579;text-transform:uppercase;letter-spacing:.3px">Plat lié au menu</div>
          <div style="font-size:.85rem;font-weight:800;color:#5C1E5A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escH(ref.nom)}</div>
        </div>
        <span style="font-size:.62rem;font-weight:800;padding:2px 7px;border-radius:8px;color:#fff;background:${prof.color};flex-shrink:0">${prof.ico} ${prof.label}</span>
        <button onclick="window._menuOpenLinkPicker('${enrId}')" style="background:#5C1E5A;color:#fff;border:none;border-radius:8px;padding:6px 9px;font-size:.7rem;font-weight:800;cursor:pointer;font-family:inherit;flex-shrink:0">↻</button>
        <button onclick="window._menuClearLink('${enrId}')" style="background:#fee2e2;color:#dc2626;border:1.5px solid #fca5a5;border-radius:8px;padding:6px 9px;font-size:.7rem;font-weight:800;cursor:pointer;font-family:inherit;flex-shrink:0">✕</button>
      </div>`;
  }
  if(nbPlats === 0){
    return `
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:1rem">🍽️</span>
        <div style="flex:1;font-size:.74rem;font-weight:700;color:#7A6579">Aucun menu saisi aujourd'hui</div>
        <button onclick="goTo('menu_jour')" style="background:#5C1E5A;color:#fff;border:none;border-radius:8px;padding:6px 11px;font-size:.72rem;font-weight:800;cursor:pointer;font-family:inherit">📋 Saisir</button>
      </div>`;
  }
  return `
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:1rem">🍽️</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:.7rem;font-weight:700;color:#7A6579;text-transform:uppercase;letter-spacing:.3px">Lier au plat du menu</div>
        <div style="font-size:.74rem;color:#3b1e3b">Remplit auto le nom du plat + traçabilité</div>
      </div>
      <button onclick="window._menuOpenLinkPicker('${enrId}')" style="background:linear-gradient(135deg,#5C1E5A,#C93A78);color:#fff;border:none;border-radius:9px;padding:8px 12px;font-size:.76rem;font-weight:800;cursor:pointer;font-family:inherit;flex-shrink:0">🔗 Choisir</button>
    </div>`;
}

function buildBannerHTML(enrId){
  return `<div id="mn-link-banner-${enrId}" style="background:#fff;border:1.5px dashed #d8b4d8;border-radius:12px;padding:10px 12px;margin-bottom:10px">${buildBannerInner(enrId)}</div>`;
}

function injectLinkBanners(){
  if(typeof cur === 'undefined') return;
  if(!LINK_ENRS.includes(cur)) return;
  const main = document.getElementById('main-content');
  if(!main) return;
  if(main.querySelector('#mn-link-banner-'+cur)) return;
  const firstCard = main.querySelector('.card, [class*="card"]');
  const wrapper = document.createElement('div');
  wrapper.innerHTML = buildBannerHTML(cur);
  if(firstCard && firstCard.parentNode){
    firstCard.parentNode.insertBefore(wrapper.firstChild, firstCard);
  } else {
    main.insertBefore(wrapper.firstChild, main.firstChild);
  }
  if(_menuLinkPending[cur]){ fillFormWithPlat(cur, _menuLinkPending[cur]); }
}

function hookRenderMain(){
  if(typeof window.renderMain !== 'function'){
    setTimeout(hookRenderMain, 250);
    return;
  }
  if(window.__menuRenderMainHooked) return;
  const orig = window.renderMain;
  window.renderMain = function(){
    const r = orig.apply(this, arguments);
    setTimeout(injectLinkBanners, 30);
    return r;
  };
  window.__menuRenderMainHooked = true;
}

function hookSaveRow(){
  if(typeof window.saveRow !== 'function'){
    setTimeout(hookSaveRow, 250);
    return;
  }
  if(window.__menuSaveRowHooked) return;
  const orig = window.saveRow;
  window.saveRow = function(id){
    const r = orig.apply(this, arguments);
    try {
      const ref = _menuLinkPending[id];
      if(ref && ref.plat_id && S[id] && Array.isArray(S[id].lignes) && S[id].lignes.length > 0){
        const last = S[id].lignes[0];
        last._plat_id = ref.plat_id;
        last._plat_nom = ref.nom;
        last._menu_id = ref.menu_id;
        last._plat_profil = ref.profil_haccp;
        save();
        try {
          if(typeof SupaEngine !== 'undefined' && SupaEngine.enqueue){
            SupaEngine.enqueue(id, last);
          }
        } catch(e){}
      }
    } catch(e){ console.warn('[menu] hookSaveRow:', e); }
    return r;
  };
  window.__menuSaveRowHooked = true;
}

function hookBatchFunctions(){
  ['e33AddBatch','e34AddBatch'].forEach(fnName => {
    if(typeof window[fnName] !== 'function') return;
    if(window['__menu_'+fnName+'_hooked']) return;
    const enrId = fnName === 'e33AddBatch' ? 'enr33' : 'enr34';
    const orig = window[fnName];
    window[fnName] = function(){
      const r = orig.apply(this, arguments);
      try {
        const ref = _menuLinkPending[enrId];
        if(ref && ref.plat_id){
          const arr = S[enrId]?.lignes || [];
          const recent = arr.slice(0, 5).filter(l => !l._plat_id && (l._ts||'').slice(0,10) === today());
          recent.forEach(l => {
            l._plat_id = ref.plat_id;
            l._plat_nom = ref.nom;
            l._menu_id = ref.menu_id;
            l._plat_profil = ref.profil_haccp;
          });
          if(recent.length){
            save();
            try {
              if(typeof SupaEngine !== 'undefined' && SupaEngine.enqueue){
                recent.forEach(l => SupaEngine.enqueue(enrId, l));
              }
            } catch(e){}
          }
        }
      } catch(e){ console.warn('[menu] hookBatch:', e); }
      return r;
    };
    window['__menu_'+fnName+'_hooked'] = true;
  });
  if(typeof window.e33AddBatch !== 'function' || typeof window.e34AddBatch !== 'function'){
    setTimeout(hookBatchFunctions, 500);
  }
}

// ════════════════════════════════════════════════════
// WIDGET ACCUEIL — APPROCHE BULLETPROOF
// ════════════════════════════════════════════════════
function renderMenuHomeWidget(){
  const t = today();
  const services = SERVICES.filter(s => getMenu(t, s.id));
  const totalPlats = services.reduce((acc, s) => {
    const m = getMenu(t, s.id);
    if(!m) return acc;
    return acc + CATS.reduce((a,c) => a + (m.categories?.[c.id]?.length||0), 0);
  }, 0);

  if(services.length === 0){
    return `<div class="wc wc-warn" onclick="goTo('menu_jour')" style="cursor:pointer;background:linear-gradient(135deg,#fef3c7,#fef9c3);border:1.5px solid #f59e0b">
      <span class="wc-ico">🍽️</span>
      <div class="wc-label">Menu du jour</div>
      <div class="wc-val" style="color:#92400e;font-size:.8rem">Pas saisi — tap ici</div>
      <span class="wc-arrow">›</span>
    </div>`;
  }

  let enrLinked = 0;
  const platIds = new Set();
  services.forEach(s => {
    const m = getMenu(t, s.id);
    if(!m) return;
    CATS.forEach(c => (m.categories?.[c.id]||[]).forEach(p => platIds.add(p.plat_id)));
  });
  ['enr01','enr02','enr03','enr07','enr08','enr23','enr33','enr34','enr_tc_distrib'].forEach(sec => {
    const arr = (S[sec]?.lignes || S[sec]?.saisies || []);
    arr.forEach(l => {
      if(l._plat_id && platIds.has(l._plat_id) && (l.date===t || (l._ts||'').slice(0,10)===t)) enrLinked++;
    });
  });

  const previewItems = [];
  services.forEach(s => {
    const m = getMenu(t, s.id);
    if(!m) return;
    CATS.forEach(c => {
      (m.categories?.[c.id]||[]).slice(0,1).forEach(p => {
        if(previewItems.length < 4) previewItems.push({ svc:s.label, cat:c.short, nom:p.nom });
      });
    });
  });

  return `<div class="wc" style="cursor:pointer;background:linear-gradient(135deg,#fdf4fd,#fff);border:1.5px solid #d8b4d8" onclick="goTo('menu_jour')">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
      <span style="font-size:1.3rem">🍽️</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:.8rem;font-weight:900;color:#5C1E5A">Menu du jour</div>
        <div style="font-size:.62rem;font-weight:700;color:#7A6579">${services.map(s=>s.label).join(' • ')} • ${totalPlats} plats • ${enrLinked} ENR liés</div>
      </div>
    </div>
    ${previewItems.length ? '<div style="font-size:.68rem;color:#3b1e3b;line-height:1.5;background:#fff;border-radius:8px;padding:6px 8px;border:1px solid #ede0ed;max-height:90px;overflow:hidden">'
      + previewItems.map(p=>'<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><span style="color:#7A6579">'+escH(p.cat)+' :</span> <strong>'+escH(p.nom)+'</strong></div>').join('')
      +'</div>' : ''}
  </div>`;
}

// Patch tout ce qui touche aux widgets — APPROCHE DÉFENSIVE
function patchAllWidgetSystem(){
  // 1. Enregistrer dans le catalogue WG_CATALOG_BASE
  if(typeof WG_CATALOG_BASE !== 'undefined' && Array.isArray(WG_CATALOG_BASE)){
    if(!WG_CATALOG_BASE.some(w => w.id === 'menu_jour_w')){
      WG_CATALOG_BASE.unshift({
        id:'menu_jour_w',
        ico:'🍽️',
        name:'Menu du jour',
        desc:'Aperçu du menu + couverture HACCP',
        size:'full'
      });
      console.log('[menu] widget ajouté au catalogue');
    }
  } else {
    setTimeout(patchAllWidgetSystem, 250);
    return;
  }

  // 2. Patcher wgGet pour TOUJOURS injecter notre widget (sauf si user l'a explicitement supprimé)
  if(typeof window.wgGet === 'function' && !window.__menuWgGetPatched){
    const origGet = window.wgGet;
    window.wgGet = function(){
      const list = origGet.apply(this, arguments);
      try {
        const removed = S.config && S.config.menuWgRemoved === true;
        if(Array.isArray(list) && !list.some(w => w.id === 'menu_jour_w') && !removed){
          list.unshift({id: 'menu_jour_w'});
        }
      } catch(e){}
      return list;
    };
    window.__menuWgGetPatched = true;
    console.log('[menu] wgGet patché');
  } else if(typeof window.wgGet !== 'function'){
    setTimeout(patchAllWidgetSystem, 250);
    return;
  }

  // 3. Patcher wgRemove → flag de suppression explicite
  if(typeof window.wgRemove === 'function' && !window.__menuWgRemovePatched){
    const origRm = window.wgRemove;
    window.wgRemove = function(id){
      if(id === 'menu_jour_w'){
        S.config = S.config || {};
        S.config.menuWgRemoved = true;
        save();
      }
      return origRm.apply(this, arguments);
    };
    window.__menuWgRemovePatched = true;
  }

  // 4. Patcher wgCatalogAdd → reset flag si user re-ajoute
  if(typeof window.wgCatalogAdd === 'function' && !window.__menuWgAddPatched){
    const origAdd = window.wgCatalogAdd;
    window.wgCatalogAdd = function(id){
      if(id === 'menu_jour_w'){
        S.config = S.config || {};
        S.config.menuWgRemoved = false;
        save();
      }
      return origAdd.apply(this, arguments);
    };
    window.__menuWgAddPatched = true;
  }

  // 5. Patcher _wgRenderOne → notre rendu
  if(typeof window._wgRenderOne === 'function' && !window.__menuWgRenderPatched){
    const origRender = window._wgRenderOne;
    window._wgRenderOne = function(w){
      if(w && w.id === 'menu_jour_w'){
        try { return renderMenuHomeWidget(); }
        catch(e){ console.warn('[menu wg]', e); return ''; }
      }
      return origRender.apply(this, arguments);
    };
    window.__menuWgRenderPatched = true;
  }

  // 6. Persister dans S.config.homeWidgets si présent
  try {
    if(S.config && Array.isArray(S.config.homeWidgets)){
      const removed = S.config.menuWgRemoved === true;
      if(!removed && !S.config.homeWidgets.some(w => w.id === 'menu_jour_w')){
        S.config.homeWidgets.unshift({id:'menu_jour_w'});
        save();
        console.log('[menu] widget injecté dans homeWidgets');
      }
    }
  } catch(e){ console.warn('[menu wg persist]', e); }
}

// ════════════════════════════════════════════════════
// ENREGISTREMENT
// ════════════════════════════════════════════════════
function registerMenuTab(){
  if(typeof ALL === 'undefined' || typeof REND === 'undefined'){
    setTimeout(registerMenuTab, 200);
    return;
  }
  if(!ALL.some(s => s.id === 'menu_jour')){
    const idx = ALL.findIndex(s => s.id === 'search');
    const tab = { id:'menu_jour', short:'🍽️ Menu', label:'Menu du jour', cat:'menu', fixed:false };
    if(idx >= 0) ALL.splice(idx+1, 0, tab); else ALL.push(tab);
  }
  REND['menu_jour'] = renderMenuJour;
  console.log('[menu] onglet enregistré');
}

function _setupAll(){
  registerMenuTab();
  hookRenderMain();
  hookSaveRow();
  hookBatchFunctions();
  patchAllWidgetSystem();
  // Re-essayer plusieurs fois pour le widget (timing parfois capricieux)
  setTimeout(patchAllWidgetSystem, 500);
  setTimeout(patchAllWidgetSystem, 1500);
  setTimeout(patchAllWidgetSystem, 3000);
}
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', _setupAll);
} else {
  _setupAll();
}

})();
