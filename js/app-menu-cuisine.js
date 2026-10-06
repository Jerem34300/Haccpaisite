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
  BF_CUIT:       { ico:'🥘', label:'BF Cuit',        color:'#dc2626', enr:['enr23','enr07','enr01','enr_tc_distrib'] },
  BF_CRU:        { ico:'🥗', label:'BF Cru',         color:'#16a34a', enr:['enr23','enr08','enr_tc_distrib'] },
  REMISE_TC:     { ico:'🔥', label:'Remise T°C',     color:'#ea580c', enr:['enr23','enr02','enr_tc_distrib'] },
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

// BF Cuit = mixé chaud (plat cuit/chaud → mixé → servi chaud)
// BF Cru  = mixé froid (aliment cru/froid → mixé → servi froid)
function mixeProfil(plat){
  return ['BF_CUIT','REMISE_TC'].includes(plat.profil_haccp) ? 'BF_CUIT' : 'BF_CRU';
}

const CATS = [
  { id:'entrees',    label:'🥗 Entrées',    short:'Entrée' },
  { id:'plats',      label:'🍽️ Plats',     short:'Plat' },
  { id:'garnitures', label:'🥦 Garnitures', short:'Garniture' },
  { id:'fromages',   label:'🧀 Fromages',   short:'Fromage' },
  { id:'desserts',   label:'🍰 Desserts',   short:'Dessert' },
];
/** Liste unique P-déj / Goûter (clé data: categories.libre). */
const FREE_CAT = { id:'libre', label:'🍽️ Liste', short:'élément' };
const SERVICES = [
  { id:'petitdej', label:'☕ Petit-déjeuner' },
  { id:'midi',     label:'🌞 Midi' },
  { id:'gouter',   label:'🍪 Goûter' },
  { id:'soir',     label:'🌙 Soir' },
];
function isFreeListService(svcId){ return svcId === 'petitdej' || svcId === 'gouter'; }
function catsForService(svcId){ return isFreeListService(svcId) ? [FREE_CAT] : CATS; }
/** Catégories UI + clé libre (après migrations potages/pains). */
function allDisplayCats(){ return CATS.concat([FREE_CAT]); }

function emptyCategories(){
  const o = {};
  CATS.forEach(c => { o[c.id] = []; });
  o.libre = [];
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
  openServices: { midi: true },
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

function _menuEnsureService(svcId){
  try { if(svcId) _menuState.service = svcId; } catch(e){}
}
function countPlatsInMenu(menu){
  let n = 0;
  try {
    allDisplayCats().forEach(c => { n += (menu && menu.categories && menu.categories[c.id] || []).length; });
  } catch(e){}
  return n;
}
/** Migre les anciens plats « potages » vers Entrées (catégorie retirée de l’UI). */
function migratePotagesToEntrees(menu){
  try {
    if(!menu || !menu.categories) return false;
    const pots = menu.categories.potages;
    if(!Array.isArray(pots) || !pots.length) return false;
    if(!Array.isArray(menu.categories.entrees)) menu.categories.entrees = [];
    menu.categories.entrees = menu.categories.entrees.concat(pots);
    menu.categories.potages = [];
    return true;
  } catch(e){ console.warn('[menu] migrate potages', e); return false; }
}
/** Migre les anciens « pains » vers Entrées (catégorie retirée de l’UI). */
function migratePainsToEntrees(menu){
  try {
    if(!menu || !menu.categories) return false;
    const pains = menu.categories.pains;
    if(!Array.isArray(pains) || !pains.length) return false;
    if(!Array.isArray(menu.categories.entrees)) menu.categories.entrees = [];
    menu.categories.entrees = menu.categories.entrees.concat(pains);
    menu.categories.pains = [];
    return true;
  } catch(e){ console.warn('[menu] migrate pains', e); return false; }
}
/** P-déj / Goûter : aplatit les anciennes grilles vers categories.libre. */
function migrateToLibreList(menu){
  try {
    if(!menu || !menu.categories) return false;
    if(!Array.isArray(menu.categories.libre)) menu.categories.libre = [];
    let changed = false;
    const sources = ['entrees','plats','garnitures','fromages','desserts','pains','potages'];
    sources.forEach(id => {
      const arr = menu.categories[id];
      if(Array.isArray(arr) && arr.length){
        menu.categories.libre = menu.categories.libre.concat(arr);
        menu.categories[id] = [];
        changed = true;
      }
    });
    return changed;
  } catch(e){ console.warn('[menu] migrate libre', e); return false; }
}
/** Midi/Soir : éventuelle liste libre historique → Entrées. */
function migrateLibreToEntrees(menu){
  try {
    if(!menu || !menu.categories) return false;
    const lib = menu.categories.libre;
    if(!Array.isArray(lib) || !lib.length) return false;
    if(!Array.isArray(menu.categories.entrees)) menu.categories.entrees = [];
    menu.categories.entrees = menu.categories.entrees.concat(lib);
    menu.categories.libre = [];
    return true;
  } catch(e){ console.warn('[menu] migrate libre→entrees', e); return false; }
}
function applyMenuMigrations(menu, service){
  let changed = false;
  try {
    if(migratePotagesToEntrees(menu)) changed = true;
    if(migratePainsToEntrees(menu)) changed = true;
    if(isFreeListService(service)){
      if(migrateToLibreList(menu)) changed = true;
    } else if(service){
      if(migrateLibreToEntrees(menu)) changed = true;
    }
  } catch(e){ console.warn('[menu] migrations', e); }
  return changed;
}
function ensureMenuFor(date, service){
  let menu = getMenu(date, service);
  if(!menu){
    menu = { categories: emptyCategories(), menu_id:newUUID() };
    setMenu(date, service, menu);
  }
  if(!menu.menu_id) menu.menu_id = newUUID();
  if(!menu.categories) menu.categories = emptyCategories();
  CATS.forEach(c => { if(!Array.isArray(menu.categories[c.id])) menu.categories[c.id] = []; });
  if(!Array.isArray(menu.categories.libre)) menu.categories.libre = [];
  if(applyMenuMigrations(menu, service)){
    try { setMenu(date, service, menu); } catch(e){}
  }
  return menu;
}
function computeDayCoverage(date){
  let total=0, tracked=0;
  try {
    SERVICES.forEach(s => {
      const menu = getMenu(date, s.id);
      if(!menu) return;
      try { applyMenuMigrations(menu, s.id); } catch(e){}
      const cov = computeMenuCoverage(menu, date);
      total += cov.total;
      tracked += cov.tracked;
    });
  } catch(e){ console.warn('[menu] day coverage', e); }
  return { total, expected: total, tracked };
}

/** Pastille calendrier : null = aucun plat ; todo=orange ; late=rouge ; done=vert */
function menuDayDotStatus(date){
  try {
    const cov = computeDayCoverage(date);
    if(!cov || !cov.total) return null;
    const pct = cov.expected === 0 ? 0 : (cov.tracked / cov.expected) * 100;
    if(pct >= 100) return 'done';
    const today_ = today();
    if(date < today_) return 'late';
    return 'todo'; // aujourd'hui ou futur, couverture < 100 %
  } catch(e){ return null; }
}


// ════════════════════════════════════════════════════
// RENDU PRINCIPAL
// ════════════════════════════════════════════════════
function renderMenuJour(){
  const d = _menuState.date;
  try {
    if(!_menuState.openServices) _menuState.openServices = { midi: true };
  } catch(e){ _menuState.openServices = { midi: true }; }

  const dFr = new Date(d+'T12:00').toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' });
  const cov = computeDayCoverage(d);
  const today_ = today();
  const isToday = d === today_;
  const isPast = d < today_;

  let dayTotal = 0;
  try {
    SERVICES.forEach(s => {
      const m = getMenu(d, s.id);
      if(m){ try { applyMenuMigrations(m, s.id); } catch(e){} dayTotal += countPlatsInMenu(m); }
    });
  } catch(e){}

  return `
  <style>
    .mn-hd{background:#fff;color:#3b1e3b;border:1.5px solid var(--brd,#e0d0e0);border-radius:16px;padding:12px 14px;margin-bottom:12px}
    .mn-hd-title-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}
    .mn-hd h2{margin:0;font-size:.95rem;font-weight:900;flex:1;line-height:1.2;color:var(--plum,#5C1E5A)}
    .mn-date-input{background:#f7f2f7;color:#5C1E5A;border:1.5px solid #d8b4d8;border-radius:9px;padding:7px 10px;font-size:.82rem;font-weight:800;font-family:inherit;width:100%;max-width:220px;box-sizing:border-box}
    .mn-hd-sub{font-size:.74rem;margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
    .mn-when-pill{background:#f3e8f3;color:#5C1E5A;padding:2px 8px;border-radius:8px;font-size:.66rem;font-weight:800;text-transform:uppercase;letter-spacing:.4px}
    .mn-svc{background:#fff;border:1.5px solid var(--brd,#e0d0e0);border-radius:14px;margin-bottom:10px;overflow:hidden}
    .mn-svc-hd{display:flex;align-items:center;gap:8px;padding:12px 14px;cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent;background:#faf6fa}
    .mn-svc-hd:active{opacity:.85}
    .mn-svc-hd.open{background:#f3e8f3;border-bottom:1.5px solid #ede0ed}
    .mn-svc-tit{flex:1;font-size:.92rem;font-weight:900;color:var(--plum,#5C1E5A)}
    .mn-svc-cnt{font-size:.7rem;font-weight:700;color:#b89ab6;background:#fff;padding:2px 9px;border-radius:10px;border:1px solid #ede0ed}
    .mn-svc-chev{font-size:.85rem;color:#7A6579;font-weight:900;width:18px;text-align:center}
    .mn-svc-body{padding:10px 12px 12px}
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
    button.mn-plat-st{border:none;cursor:pointer;font-family:inherit}
    .mn-chip{font-size:.62rem;font-weight:800;background:#fff;color:#5C1E5A;border:1px solid #d8b4d8;border-radius:999px;padding:1px 7px}
    .mn-plat-comp{font-size:.66rem;color:#7A6579;font-style:italic}
    .mn-pas{font-size:.66rem;font-weight:800;padding:3px 8px;border-radius:999px;cursor:pointer;font-family:inherit;background:#fff;border:1.5px solid currentColor;opacity:.55;touch-action:manipulation}
    .mn-pas.on{color:#fff !important;opacity:1}
    .mn-pas.fiche{color:#7A6579;border-style:dashed}
    .mn-pas.fiche.on{background:#16a34a;border:1.5px solid #16a34a}
    .mn-cov{background:linear-gradient(135deg,#1b5e20,#2e7d32);color:#fff;border-radius:14px;padding:11px 14px;margin-bottom:10px}
    .mn-cov.warn{background:linear-gradient(135deg,#92400e,#d97706)}
    .mn-cov.bad{background:linear-gradient(135deg,#991b1b,#dc2626)}
    .mn-cov-tit{font-size:.78rem;font-weight:800;margin-bottom:3px;display:flex;align-items:center;gap:6px}
    .mn-cov-bar{height:7px;background:rgba(255,255,255,.25);border-radius:6px;overflow:hidden;margin-top:4px}
    .mn-cov-fill{height:100%;background:#fff;border-radius:6px;transition:.3s}
    .mn-cov-sub{font-size:.7rem;opacity:.92;margin-top:5px;line-height:1.4}
    .mn-empty{font-size:.78rem;color:#b89ab6;font-style:italic;text-align:center;padding:8px}
    .mn-action-grid{display:flex;flex-direction:column;gap:8px;margin-top:10px}
    .mn-act{width:100%;padding:13px 16px;border:none;border-radius:14px;font-weight:800;font-family:inherit;cursor:pointer;font-size:.86rem;color:#fff;display:flex;align-items:center;justify-content:center;gap:6px;text-align:center;line-height:1.2;letter-spacing:.2px;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
    .mn-act:active{transform:scale(.97);opacity:.9}
    .mn-act.save{background:linear-gradient(135deg,#5C1E5A,#C93A78);box-shadow:0 3px 10px rgba(92,30,90,.35)}
    .mn-act.clear{background:#fff;color:#dc2626;border:1.5px solid #fca5a5}
    .mn-cal{background:#fff;border:1.5px solid var(--brd,#e0d0e0);border-radius:14px;padding:11px 12px;margin-bottom:12px}
    .mn-cal-hd{display:flex;align-items:center;gap:8px;margin-bottom:8px}
    .mn-cal-tit{flex:1;text-align:center;font-size:.88rem;font-weight:900;color:var(--plum,#5C1E5A);text-transform:capitalize}
    .mn-cal-nav{background:#f7f2f7;border:1.5px solid #ede0ed;color:#5C1E5A;width:32px;height:32px;border-radius:10px;font-size:1rem;font-weight:900;cursor:pointer;font-family:inherit;line-height:1}
    .mn-cal-nav:active{opacity:.8}
    .mn-cal-dow{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:4px}
    .mn-cal-dow span{text-align:center;font-size:.62rem;font-weight:800;color:#b89ab6;text-transform:uppercase;padding:2px 0}
    .mn-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}
    .mn-cal-day{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:42px;border:none;background:transparent;border-radius:10px;cursor:pointer;font-family:inherit;padding:4px 2px 6px;-webkit-tap-highlight-color:transparent}
    .mn-cal-day:active{opacity:.85}
    .mn-cal-day.out{opacity:.35;cursor:default}
    .mn-cal-day.sel{background:#f3e8f3;box-shadow:inset 0 0 0 1.5px #d8b4d8}
    .mn-cal-day.today:not(.sel){box-shadow:inset 0 0 0 1.5px #5C1E5A}
    .mn-cal-num{font-size:.78rem;font-weight:800;color:#3b1e3b;line-height:1.1}
    .mn-cal-day.sel .mn-cal-num{color:#5C1E5A}
    .mn-cal-dot{width:7px;height:7px;border-radius:50%;margin-top:3px;flex-shrink:0}
    .mn-cal-dot.todo{background:#F59E0B}
    .mn-cal-dot.late{background:#DC2626}
    .mn-cal-dot.done{background:#16A34A}
    .mn-cal-dot.empty{visibility:hidden}
    .mn-cal-leg{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:9px;font-size:.68rem;font-weight:700;color:#7A6579}
    .mn-cal-leg span{display:inline-flex;align-items:center;gap:4px}
    .mn-hist{background:#fff;border:1.5px solid var(--brd,#e0d0e0);border-radius:14px;padding:11px 12px;margin-top:14px;margin-bottom:30px}
    .mn-hist-tit{font-size:.88rem;font-weight:900;color:var(--plum,#5C1E5A);margin-bottom:8px;display:flex;align-items:center;gap:7px}
    .mn-hist-item{background:#f7f2f7;border-radius:10px;padding:9px 10px;margin-bottom:5px;border:1.5px solid #ede0ed;cursor:pointer}
    .mn-hist-item:active{opacity:.8}
    .mn-hist-row1{display:flex;align-items:center;gap:7px}
    .mn-hist-date{flex:1;font-size:.78rem;font-weight:800;color:#3b1e3b}
    .mn-hist-svc{background:#5C1E5A;color:#fff;font-size:.62rem;font-weight:800;padding:2px 7px;border-radius:8px}
    .mn-hist-cnt{font-size:.66rem;color:#7A6579;background:#fff;padding:1px 7px;border-radius:8px;border:1px solid #ede0ed}
    .mn-hist-row2{font-size:.7rem;color:#7A6579;margin-top:3px;line-height:1.4}
    .mn-photo-row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
    .mn-photo-btn{flex:1;min-width:120px;padding:11px 12px;border-radius:12px;border:1.5px solid #d8b4d8;background:#fff;color:#5C1E5A;font-weight:800;font-family:inherit;font-size:.8rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
    .mn-photo-btn:active{opacity:.85;transform:scale(.98)}
    .mn-photo-btn.cam{background:linear-gradient(135deg,#5C1E5A,#C93A78);color:#fff;border-color:transparent;box-shadow:0 2px 8px rgba(92,30,90,.28)}
    .mn-photo-hint{font-size:.68rem;color:#7A6579;margin-top:6px;line-height:1.35}
  </style>

  <div class="mn-hd">
    <div class="mn-hd-title-row">
      <h2>🍽️ Menu du jour</h2>
    </div>
    <div class="mn-photo-row">
      <button type="button" class="mn-photo-btn cam" onclick="window._menuPhotoPick('camera')" aria-label="Prendre une photo du menu">📷 Caméra</button>
      <button type="button" class="mn-photo-btn" onclick="window._menuPhotoPick('gallery')" aria-label="Choisir une photo dans la galerie">🖼️ Galerie</button>
    </div>
    <div class="mn-photo-hint">Photo = menu du jour ou trame semaine. Rien n’est enregistré avant Valider.</div>
    <input type="file" id="mn-photo-cam" accept="image/*" capture="environment" style="display:none" onchange="window._menuPhotoOnFile(this)">
    <input type="file" id="mn-photo-gal" accept="image/*" style="display:none" onchange="window._menuPhotoOnFile(this)">
    <div class="mn-hd-sub">
      <input type="date" class="mn-date-input" value="${d}" onchange="window._menuSwitchDate(this.value)" aria-label="Date du menu">
      ${isToday ? '<span class="mn-when-pill">Aujourd\'hui</span>' : (isPast ? '<span class="mn-when-pill">Passé</span>' : '<span class="mn-when-pill">À venir</span>')}
      <span class="mn-when-pill">${dFr}</span>
      <span class="mn-when-pill">${dayTotal} plat${dayTotal>1?'s':''}</span>
    </div>
  </div>

  ${renderMenuCalendar()}

  ${renderCoverageCard(cov)}

  ${renderProductsDatalist()}

  ${SERVICES.map(s => renderServiceAccordion(d, s)).join('')}

  ${renderMenuHistory()}
  `;
}

function renderMenuCalendar(){
  const today_ = today();
  const sel = _menuState.date || today_;
  try {
    if(_menuState.calY == null || _menuState.calM == null){
      const d0 = new Date(sel+'T12:00');
      _menuState.calY = d0.getFullYear();
      _menuState.calM = d0.getMonth();
    }
  } catch(e){
    const d0 = new Date(today_+'T12:00');
    _menuState.calY = d0.getFullYear();
    _menuState.calM = d0.getMonth();
  }
  const y = _menuState.calY;
  const m = _menuState.calM;
  const moisNoms = (typeof MOIS_FR !== 'undefined' && MOIS_FR)
    ? MOIS_FR
    : ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  const titre = (moisNoms[m] || '') + ' ' + y;
  const firstDow = (new Date(y, m, 1).getDay() + 6) % 7; // Lun=0
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for(let i = 0; i < firstDow; i++) cells.push({ out:true });
  for(let day = 1; day <= daysInMonth; day++){
    const ymd = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    cells.push({
      out: false,
      day,
      ymd,
      sel: ymd === sel,
      today: ymd === today_,
      status: menuDayDotStatus(ymd),
    });
  }
  while(cells.length % 7) cells.push({ out:true });
  return `
  <div class="mn-cal" aria-label="Calendrier des menus">
    <div class="mn-cal-hd">
      <button type="button" class="mn-cal-nav" onclick="window._menuCalMove(-1)" aria-label="Mois précédent">‹</button>
      <div class="mn-cal-tit">${titre}</div>
      <button type="button" class="mn-cal-nav" onclick="window._menuCalMove(1)" aria-label="Mois suivant">›</button>
    </div>
    <div class="mn-cal-dow">${['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].map(j=>`<span>${j}</span>`).join('')}</div>
    <div class="mn-cal-grid">
      ${cells.map(c => {
        if(c.out) return `<div class="mn-cal-day out" aria-hidden="true"></div>`;
        const cls = ['mn-cal-day'];
        if(c.sel) cls.push('sel');
        if(c.today) cls.push('today');
        const dotCls = c.status ? ('mn-cal-dot ' + c.status) : 'mn-cal-dot empty';
        return `<button type="button" class="${cls.join(' ')}" onclick="window._menuPickCalDay('${c.ymd}')" aria-label="${c.ymd}${c.status ? ' · ' + c.status : ''}">
          <span class="mn-cal-num">${c.day}</span>
          <span class="${dotCls}"></span>
        </button>`;
      }).join('')}
    </div>
    <div class="mn-cal-leg" aria-label="Légende">🟠 À finir · 🔴 En retard · 🟢 Terminé</div>
  </div>`;
}

function renderServiceAccordion(date, svc){
  const open = !!( _menuState.openServices && _menuState.openServices[svc.id] );
  let menu = null;
  try {
    menu = getMenu(date, svc.id);
    if(menu) applyMenuMigrations(menu, svc.id);
    // Ne matérialiser le menu en storage que si le service est ouvert (évite 4 menus vides)
    if(open) menu = ensureMenuFor(date, svc.id);
  } catch(e){
    console.warn('[menu] ensure', e);
    menu = open ? { categories: emptyCategories(), menu_id:'' } : null;
  }
  const n = countPlatsInMenu(menu || { categories: {} });
  const chev = open ? '▾' : '▸';
  const cats = catsForService(svc.id);
  return `
  <div class="mn-svc" data-svc="${svc.id}">
    <div class="mn-svc-hd ${open?'open':''}" onclick="window._menuToggleAccordion('${svc.id}')" role="button" aria-expanded="${open?'true':'false'}">
      <span class="mn-svc-chev">${chev}</span>
      <div class="mn-svc-tit">${svc.label}</div>
      <div class="mn-svc-cnt">${n} plat${n>1?'s':''}</div>
    </div>
    ${open ? `<div class="mn-svc-body">
      ${cats.map(cat => renderCatBlock(menu, cat, svc.id)).join('')}
      <div class="mn-action-grid">
        <button class="mn-act save" onclick="window._menuSave('${svc.id}')">💾 Enregistrer — ${svc.label}</button>
        <button class="mn-act clear" onclick="window._menuClear('${svc.id}')">🗑️ Vider ${svc.label}</button>
      </div>
    </div>` : ''}
  </div>`;
}

function renderProductsDatalist(){
  const prods = (S.produits||[]).slice(0,400);
  if(!prods.length) return '';
  return `<datalist id="mn-prods-list">${prods.map(p=>`<option value="${escH(p)}">`).join('')}</datalist>`;
}

function renderCatBlock(menu, cat, svcId){
  const items = menu.categories[cat.id] || [];
  const sid = svcId || _menuState.service;
  const inpId = 'mn-inp-'+sid+'-'+cat.id;
  const micId = 'mn-mic-'+sid+'-'+cat.id;
  return `
  <div class="mn-cat">
    <div class="mn-cat-hd">
      <div class="mn-cat-tit">${cat.label}</div>
      <div class="mn-cat-cnt">${items.length}</div>
    </div>
    <div class="mn-add-row">
      <input id="${inpId}" class="mn-add-inp" type="text" placeholder="Ajouter ${cat.short.toLowerCase()}…" list="mn-prods-list"
        onkeydown="if(event.key==='Enter'){event.preventDefault();window._menuAdd('${cat.id}','${sid}');}" autocomplete="off">
      <button class="mn-mic-btn" id="${micId}" onclick="window._menuMicToggle('${cat.id}','${sid}')" title="Dicter">🎤</button>
      <button class="mn-add-btn" onclick="window._menuAdd('${cat.id}','${sid}')">+</button>
    </div>
    ${items.length === 0 ? `<div class="mn-empty">Aucun ${cat.short.toLowerCase()} pour ce service</div>` : items.map((p,i)=>renderPlatRow(cat.id, p, i, sid)).join('')}
  </div>`;
}

// Un lot ENR31 → plusieurs plats. _plat_id (1er) reste pour les anciennes lectures.
function _ligneHasPlat(l, platId){
  try {
    if(!l || platId == null || platId === '') return false;
    const id = String(platId);
    if(l._plat_id != null && String(l._plat_id) === id) return true;
    if(Array.isArray(l._plat_ids) && l._plat_ids.some(x => String(x) === id)) return true;
    if(Array.isArray(l._plat_liens) && l._plat_liens.some(x => x && String(x.plat_id) === id)) return true;
  } catch(e){}
  return false;
}
function _menuPlatRefsFromLigne(l){
  const out = [];
  try {
    const seen = {};
    const push = (id, nom, menu_id, profil) => {
      if(id == null || id === '' || seen[String(id)]) return;
      seen[String(id)] = 1;
      out.push({ plat_id:String(id), nom:nom||'', menu_id:menu_id||'', profil:profil||'' });
    };
    if(l && Array.isArray(l._plat_liens)) l._plat_liens.forEach(x => { if(x) push(x.plat_id, x.nom, x.menu_id, x.profil); });
    if(l && Array.isArray(l._plat_ids)) l._plat_ids.forEach(id => push(id, '', '', ''));
    if(l && l._plat_id) push(l._plat_id, l._plat_nom, l._menu_id, l._plat_profil);
  } catch(e){ console.warn('[menu] refs ligne', e); }
  return out;
}
function _menuWritePlatLiens(l, refs){
  try {
    if(!l) return;
    const clean = [];
    const seen = {};
    (refs||[]).forEach(r => {
      if(!r || r.plat_id == null || r.plat_id === '' || seen[String(r.plat_id)]) return;
      seen[String(r.plat_id)] = 1;
      clean.push({ plat_id:String(r.plat_id), nom:r.nom||'', menu_id:r.menu_id||'', profil:r.profil_haccp||r.profil||'' });
    });
    l._plat_liens = clean;
    l._plat_ids = clean.map(x => x.plat_id);
    if(clean[0]){
      l._plat_id = clean[0].plat_id;
      l._plat_nom = clean[0].nom || l._plat_nom || '';
      if(clean[0].menu_id) l._menu_id = clean[0].menu_id;
      if(clean[0].profil) l._plat_profil = clean[0].profil;
    } else {
      delete l._plat_id; delete l._plat_nom; delete l._menu_id; delete l._plat_profil;
    }
  } catch(e){ console.warn('[menu] write liens', e); }
}
let _menuLinkPendingMulti = {};
function _menuPendingRefs(enrId){
  try {
    const arr = _menuLinkPendingMulti[enrId];
    if(Array.isArray(arr) && arr.length) return arr.slice();
    const one = (typeof _menuLinkPending !== 'undefined') ? _menuLinkPending[enrId] : null;
    if(one && one.plat_id) return [one];
  } catch(e){}
  return [];
}
function _menuTogglePending(enrId, ref){
  try {
    if(!_menuLinkPendingMulti[enrId]) _menuLinkPendingMulti[enrId] = [];
    const arr = _menuLinkPendingMulti[enrId];
    const i = arr.findIndex(x => x && String(x.plat_id) === String(ref.plat_id));
    if(i >= 0) arr.splice(i, 1); else arr.push(ref);
    if(typeof _menuLinkPending !== 'undefined'){
      if(arr[0]) _menuLinkPending[enrId] = arr[0];
      else delete _menuLinkPending[enrId];
    }
  } catch(e){ console.warn('[menu] toggle pending', e); }
}
function _menuChipsForPlat(plat){
  try {
    const names = [];
    const seen = {};
    const add = (n) => {
      const t = String(n||'').trim();
      if(!t || seen[t.toLowerCase()]) return;
      seen[t.toLowerCase()] = 1;
      names.push(t);
    };
    ((S.enr31 && S.enr31.lignes) || []).forEach(l => {
      try {
        if(!l || l._deleted) return;
        if(!_ligneHasPlat(l, plat && plat.plat_id)) return;
        add(l.produit);
      } catch(e){}
    });
    ((plat && plat.composants) || []).forEach(add);
    return names;
  } catch(e){ return []; }
}
function _menuFindEnr31(uuid){
  try {
    const lignes = (S.enr31 && S.enr31.lignes) || [];
    return lignes.find(l => l && String(l._uuid||'') === String(uuid||'')) || null;
  } catch(e){ return null; }
}
function _menuSetLotPlat(uuid, ref, on){
  try {
    const l = _menuFindEnr31(uuid);
    if(!l || !ref || !ref.plat_id) return;
    let refs = _menuPlatRefsFromLigne(l);
    if(on){
      if(!refs.some(r => String(r.plat_id) === String(ref.plat_id))) refs.push(ref);
    } else {
      refs = refs.filter(r => String(r.plat_id) !== String(ref.plat_id));
    }
    _menuWritePlatLiens(l, refs);
    save();
    try { if(typeof SupaEngine !== 'undefined' && SupaEngine.enqueue) SupaEngine.enqueue('enr31', l); } catch(e){}
  } catch(e){ console.warn('[menu] set lot plat', e); }
}
// Historique Traçabilité MP : un bouton par plat du jour pour lier / délier le lot après coup
function _mpSafeId(v){ return String(v == null ? '' : v).replace(/[^\w-]/g, ''); }
window._menuMpPlatsChips = function(l){
  try {
    if(!l || l._deleted) return '';
    const plats = l._uuid ? todayMenuPlats() : [];
    const uuid = _mpSafeId(l._uuid);
    // Plats liés hors menu du jour : affichés par leur nom (pas le code plat_id)
    const autres = _menuPlatRefsFromLigne(l)
      .filter(r => !plats.some(x => String(x.p.plat_id) === String(r.plat_id)))
      .map(r => r.nom || (String(r.plat_id) === String(l._plat_id||'') ? l._plat_nom : '') || 'Plat d\'un autre jour');
    const fixes = autres.map(n => '<span style="border-radius:999px;padding:4px 10px;font-size:.7rem;font-weight:800;background:#f0fdf4;color:#166534;border:1.5px solid #bbf7d0">🔗 ' + escH(n) + '</span>').join('');
    if(!plats.length && !fixes) return '';
    const chips = plats.map(x => {
      const on = _ligneHasPlat(l, x.p.plat_id);
      return '<button type="button" onclick="event.stopPropagation();window._menuMpToggle(\''+uuid+'\',\''+_mpSafeId(x.p.plat_id)+'\')"'
        + ' style="font-family:inherit;cursor:pointer;border-radius:999px;padding:4px 10px;font-size:.7rem;font-weight:800;touch-action:manipulation;'
        + (on ? 'background:#dcfce7;color:#166534;border:1.5px solid #86efac' : 'background:#fff;color:#7A6579;border:1.5px dashed #d8b4d8')
        + '">' + (on ? '✅ ' : '＋ ') + escH(x.p.nom) + '</button>';
    }).join('');
    return '<div style="margin-top:8px"><div style="font-size:.62rem;font-weight:800;color:#7A6579;text-transform:uppercase;letter-spacing:.3px;margin-bottom:4px">Utilisé dans</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:5px">' + chips + fixes + '</div></div>';
  } catch(e){ console.warn('[menu] mp chips', e); return ''; }
};
window._menuMpToggle = function(uuid, platId){
  try {
    const l = _menuFindEnr31(uuid);
    const x = todayMenuPlats().find(y => y && y.p && _mpSafeId(y.p.plat_id) === platId);
    if(!l || !x) return;
    const ref = { plat_id:x.p.plat_id, nom:x.p.nom, menu_id:x.menu_id || '', profil_haccp:x.p.profil_haccp || '' };
    _menuSetLotPlat(uuid, ref, !_ligneHasPlat(l, x.p.plat_id));
    if(typeof renderMain === 'function') renderMain();
    if(typeof renderNav === 'function') renderNav();
  } catch(e){ console.warn('[menu] mp toggle', e); }
};

function _menuAddMpToPlats(nom, lot, refs){
  try {
    const name = String(nom||'').trim();
    if(!name) return;
    const chef = (typeof getActiveSession==='function' ? (getActiveSession()||'') : '') ||
                 ((S.config && S.config.chefs && S.config.chefs[0]) || '') || '—';
    const rec = (typeof stampEntry==='function' ? stampEntry : (o=>o))({
      date: (typeof today==='function' ? today() : ''),
      produit: name,
      lot: String(lot||'').trim() || '—',
      dlc: (typeof today==='function' ? today() : ''),
      estampille: '',
      cuisinier: chef,
      _sec: 'enr31',
      _ts: new Date().toISOString(),
      _from_menu: true,
      _saisie_menu: true,
    });
    _menuWritePlatLiens(rec, refs||[]);
    S.enr31 = S.enr31 || {};
    S.enr31.lignes = S.enr31.lignes || [];
    S.enr31.lignes.unshift(rec);
    save();
    try { if(typeof SupaEngine !== 'undefined' && SupaEngine.enqueue) SupaEngine.enqueue('enr31', rec); } catch(e){}
    if(typeof toast==='function') toast('✅ '+name+' lié au plat','success');
  } catch(e){ console.warn('[menu] add mp', e); }
}
window._menuOpenTraces = function(catId, idx, svcId){
  try {
    _menuEnsureService(svcId);
    const menu = getMenu(_menuState.date, _menuState.service);
    const plat = menu && menu.categories && menu.categories[catId] && menu.categories[catId][idx];
    if(!plat) return;
    const prev = document.getElementById('mn-trace-ov');
    if(prev) prev.remove();
    const ref = { plat_id:plat.plat_id, nom:plat.nom, menu_id:menu.menu_id, profil_haccp:plat.profil_haccp||'' };
    const lignes = ((S.enr31 && S.enr31.lignes) || []).filter(l => l && !l._deleted).slice(0, 40);
    const lots = lignes.map(l => {
      const on = _ligneHasPlat(l, plat.plat_id);
      const lot = l.lot ? ' · lot '+escH(l.lot) : '';
      return `<label style="display:flex;align-items:flex-start;gap:8px;padding:8px 4px;border-bottom:1px solid #f1e6f1;font-size:.82rem">
        <input type="checkbox" data-mp-uuid="${escH(l._uuid||'')}" ${on?'checked':''} style="margin-top:3px;width:18px;height:18px;accent-color:#5C1E5A">
        <span><b>${escH(l.produit||'—')}</b><span style="color:#7A6579">${lot}</span></span>
      </label>`;
    }).join('') || '<div style="color:#94a3b8;font-size:.8rem;padding:8px 0">Aucun lot. Ajoutez un ingrédient ci-dessous, ou ouvrez la fiche Traçabilité MP.</div>';
    let others = [];
    try { others = todayMenuPlats().filter(x => x && x.p && String(x.p.plat_id) !== String(plat.plat_id)).slice(0, 24); } catch(e){ others = []; }
    const otherChecks = others.map(x => `<label style="display:inline-flex;align-items:center;gap:4px;margin:3px 8px 3px 0;font-size:.75rem;font-weight:700;color:#3b1e3b"><input type="checkbox" data-extra-plat="${escH(x.p.plat_id)}" data-extra-nom="${escH(x.p.nom)}" data-extra-menu="${escH(x.menu_id||'')}" style="accent-color:#5C1E5A"> ${escH(x.p.nom)}</label>`).join('');
    const ov = document.createElement('div');
    ov.id = 'mn-trace-ov';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9000;display:flex;align-items:flex-end;justify-content:center';
    ov.innerHTML = `<div style="background:#fff;border-radius:18px 18px 0 0;width:100%;max-width:520px;padding:16px 14px 22px;max-height:88vh;overflow:auto">
      <div style="font-size:.95rem;font-weight:900;color:#5C1E5A;margin-bottom:4px">Traçabilité — ${escH(plat.nom)}</div>
      <div style="font-size:.75rem;color:#7A6579;margin-bottom:8px">Cochez les lots de ce plat. Un même lot peut servir plusieurs plats.</div>
      <div style="font-size:.68rem;font-weight:800;color:#5C1E5A;text-transform:uppercase;letter-spacing:.3px">Lots existants</div>
      <div id="mn-trace-lots">${lots}</div>
      <div style="font-size:.68rem;font-weight:800;color:#5C1E5A;text-transform:uppercase;letter-spacing:.3px;margin-top:12px">Ajouter un ingrédient à la main</div>
      <input id="mn-trace-nom" placeholder="Ex : œufs, farine, beurre…" style="width:100%;box-sizing:border-box;margin-top:6px;border:1.5px solid #ddd0dd;border-radius:9px;padding:8px 10px;font-family:inherit">
      <input id="mn-trace-lot" placeholder="N° de lot (facultatif)" style="width:100%;box-sizing:border-box;margin-top:6px;border:1.5px solid #ddd0dd;border-radius:9px;padding:8px 10px;font-family:inherit">
      ${otherChecks ? `<div style="font-size:.72rem;color:#7A6579;margin-top:8px">Aussi utilisé dans :</div><div>${otherChecks}</div>` : ''}
      <button id="mn-trace-add" type="button" style="width:100%;margin-top:8px;padding:11px;background:#5C1E5A;color:#fff;border:none;border-radius:10px;font-weight:800;cursor:pointer;font-family:inherit">Ajouter et lier à ce plat</button>
      <button id="mn-trace-close" type="button" style="width:100%;margin-top:8px;padding:11px;background:#f3e8f3;color:#5C1E5A;border:none;border-radius:10px;font-weight:800;cursor:pointer;font-family:inherit">Fermer</button>
    </div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', function(e){ if(e.target===ov){ ov.remove(); try{ if(typeof renderMain==='function') renderMain(); if(typeof renderNav==='function') renderNav(); }catch(err){} } });
    document.getElementById('mn-trace-close').onclick = function(){ ov.remove(); try{ if(typeof renderMain==='function') renderMain(); if(typeof renderNav==='function') renderNav(); }catch(e){} };
    ov.querySelectorAll('input[data-mp-uuid]').forEach(cb => {
      cb.addEventListener('change', function(){
        try { _menuSetLotPlat(cb.getAttribute('data-mp-uuid'), ref, cb.checked); } catch(err){ console.warn('[menu] toggle lot', err); }
      });
    });
    document.getElementById('mn-trace-add').onclick = function(){
      try {
        const nomEl = document.getElementById('mn-trace-nom');
        const lotEl = document.getElementById('mn-trace-lot');
        const nom = (nomEl && nomEl.value || '').trim();
        const lot = (lotEl && lotEl.value || '').trim();
        if(!nom){ if(typeof toast==='function') toast('Indiquez l\'ingrédient','warning'); return; }
        const extras = [];
        ov.querySelectorAll('input[data-extra-plat]:checked').forEach(el => {
          extras.push({ plat_id:el.getAttribute('data-extra-plat'), nom:el.getAttribute('data-extra-nom')||'', menu_id:el.getAttribute('data-extra-menu')||'' });
        });
        _menuAddMpToPlats(nom, lot, [ref].concat(extras));
        ov.remove();
        if(typeof renderMain==='function') renderMain();
        if(typeof renderNav==='function') renderNav();
      } catch(err){ console.warn('[menu] add mp', err); }
    };
  } catch(e){ console.warn('[menu] open traces', e); }
};

// Pastilles colorées du plat (v486) : Préparé minute / Sortie directe / Remise T°C (profil HACCP)
// + fiche de traçabilité liée. Plus de « À tracer » ni de chips ingrédients devinés depuis le nom.
const PASTILLES_PLAT = ['PREP_MINUTE','SORTIE_DIRECTE','REMISE_TC'];
function renderPlatPastilles(catId, plat, idx, sid){
  try {
    const btns = PASTILLES_PLAT.map(k => {
      const pr = PROFILS[k];
      const on = plat.profil_haccp === k;
      return `<button type="button" class="mn-pas${on?' on':''}" style="color:${pr.color};${on?'background:'+pr.color+';border-color:'+pr.color:''}" onclick="event.preventDefault();event.stopPropagation();window._menuSetPastille('${catId}',${idx},'${k}','${sid}')" title="${on?'Retirer':'Marquer'} : ${pr.label}">${pr.ico} ${pr.label}</button>`;
    }).join('');
    let linked = 0;
    try { linked = countEnrLinkedToPlat(plat.plat_id); } catch(e){ linked = 0; }
    const fiche = `<button type="button" class="mn-pas fiche${linked>0?' on':''}" onclick="event.preventDefault();event.stopPropagation();window._menuOpenTraces('${catId}',${idx},'${sid}')" title="Fiches de traçabilité liées à ce plat">📝 ${linked>0 ? linked+' fiche'+(linked>1?'s':'')+' liée'+(linked>1?'s':'') : 'Lier une fiche'}</button>`;
    return btns + fiche;
  } catch(e){ console.warn('[menu] pastilles', e); return ''; }
}

function renderPlatRow(catId, plat, idx, svcId){
  const sid = svcId || _menuState.service;
  const variants = plat.variants || {};
  const mxp = PROFILS[variants.mixe_profil || mixeProfil(plat)] || PROFILS.BF_CUIT;
  const mxBadge = variants.mixe
    ? ` <button onclick="event.preventDefault();event.stopPropagation();window._menuToggleMixeProfil('${catId}',${idx},'${sid}')" style="background:${mxp.color};color:#fff;font-size:.58rem;padding:1px 7px;border-radius:5px;font-weight:800;vertical-align:middle;border:none;cursor:pointer;font-family:inherit;touch-action:manipulation">${mxp.label} ⇄</button>`
    : '';
  return `
  <div class="mn-plat">
    <div class="mn-plat-row1">
      <div class="mn-plat-name">${escH(plat.nom)}</div>
      <button class="mn-plat-del" onclick="window._menuRemove('${catId}',${idx},'${sid}')">✕</button>
    </div>
    <div class="mn-plat-row2">
      ${renderPlatPastilles(catId, plat, idx, sid)}
    </div>
    <div class="mn-plat-row3">
      <label class="mn-plat-chk">
        <input type="checkbox" ${variants.mixe?'checked':''} onchange="window._menuToggleVariant('${catId}',${idx},'mixe',this.checked,'${sid}')">
        🥄 Mixé${mxBadge}
      </label>
      <label class="mn-plat-chk">
        <input type="checkbox" ${variants.sans_sel?'checked':''} onchange="window._menuToggleVariant('${catId}',${idx},'sans_sel',this.checked,'${sid}')">
        🚫 Sans sel
      </label>
      <label class="mn-plat-chk">
        <input type="checkbox" ${variants.hp?'checked':''} onchange="window._menuToggleVariant('${catId}',${idx},'hp',this.checked,'${sid}')">
        💪 HP
      </label>
    </div>
  </div>`;
}

function computePlatStatus(plat){
  let linked = 0;
  try { linked = countEnrLinkedToPlat(plat.plat_id); } catch(e){ linked = 0; }
  if(linked > 0) return { cls:'ok', label:`✓ ${linked} tracé${linked>1?'s':''}` };
  if(plat.statut_auto === 'preparé_minute') return { cls:'auto', label:'⚡ Préparé minute' };
  return { cls:'todo', label:'À tracer' };
}

function countEnrLinkedToPlat(platId, dateOpt){
  if(!platId) return 0;
  let n = 0;
  const d = dateOpt || _menuState.date;
  const SECT = ['enr01','enr02','enr03','enr04','enr07','enr08','enr09','enr10','enr11','enr12',
                'enr13','enr14','enr15','enr16','enr23','enr30','enr31','enr33','enr34','enr_tc_distrib'];
  SECT.forEach(sec => {
    const lignes = (S[sec]?.lignes || S[sec]?.saisies || []);
    lignes.forEach(l => {
      try {
        if(!_ligneHasPlat(l, platId)) return;
        if(sec === 'enr31'){ if(l && l._deleted) return; n++; return; }
        if(l.date === d || (l._ts||'').slice(0,10) === d) n++;
      } catch(e){}
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
    <div class="mn-cov-tit">${ico} Couverture HACCP du jour — ${pct}%</div>
    <div class="mn-cov-bar"><div class="mn-cov-fill" style="width:${pct}%"></div></div>
    <div class="mn-cov-sub">${cov.total} plat${cov.total>1?'s':''} • ${cov.tracked} tracé${cov.tracked>1?'s':''} sur ${cov.total}</div>
  </div>`;
}

function computeMenuCoverage(menu, dateOpt){
  let total=0, tracked=0;
  try { migratePotagesToEntrees(menu); migratePainsToEntrees(menu); } catch(e){}
  const ids = allDisplayCats().map(c => c.id);
  // Sécurité : compter aussi d'éventuels potages/pains non migrés
  if(menu && menu.categories && Array.isArray(menu.categories.potages) && menu.categories.potages.length){
    if(ids.indexOf('potages') < 0) ids.push('potages');
  }
  if(menu && menu.categories && Array.isArray(menu.categories.pains) && menu.categories.pains.length){
    if(ids.indexOf('pains') < 0) ids.push('pains');
  }
  ids.forEach(id => {
    (menu && menu.categories && menu.categories[id] || []).forEach(p => {
      total++;
      if(p.statut_auto === 'preparé_minute' || countEnrLinkedToPlat(p.plat_id, dateOpt) > 0) tracked++;
    });
  });
  return { total, expected: total, tracked };
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
      allDisplayCats().forEach(c => {
        const arr = cats[c.id] || [];
        nbPlats += arr.length;
        if(arr.length) catSummary.push((c.short || c.label) + ' ('+arr.length+')');
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
  allDisplayCats().forEach(c => {
    newMenu.categories[c.id] = ((h.categories||{})[c.id] || []).map(p => ({
      ...p,
      plat_id: newUUID().slice(0,8),
      statut_auto: null,
    }));
  });
  // Récupérer d'éventuels potages/pains historiques → Entrées
  try {
    const pots = ((h.categories||{}).potages || []).map(p => ({
      ...p,
      plat_id: newUUID().slice(0,8),
      statut_auto: null,
    }));
    if(pots.length) newMenu.categories.entrees = (newMenu.categories.entrees||[]).concat(pots);
    const pains = ((h.categories||{}).pains || []).map(p => ({
      ...p,
      plat_id: newUUID().slice(0,8),
      statut_auto: null,
    }));
    if(pains.length) newMenu.categories.entrees = (newMenu.categories.entrees||[]).concat(pains);
  } catch(e){}
  try { applyMenuMigrations(newMenu, _menuState.service); } catch(e){}
  setMenu(_menuState.date, _menuState.service, newMenu);
  if(typeof renderMain === 'function') renderMain();
  if(typeof toast === 'function') toast('✅ Menu chargé depuis l\'historique','success');
};

// ════════════════════════════════════════════════════
// ACTIONS
// ════════════════════════════════════════════════════
window._menuSwitchService = function(s){
  try {
    _menuState.service = s;
    if(!_menuState.openServices) _menuState.openServices = { midi: true };
    _menuState.openServices[s] = true;
  } catch(e){}
  if(typeof renderMain === 'function') renderMain();
};
window._menuToggleAccordion = function(svcId){
  try {
    if(!_menuState.openServices) _menuState.openServices = { midi: true };
    _menuState.openServices[svcId] = !_menuState.openServices[svcId];
    _menuState.service = svcId;
  } catch(e){ console.warn('[menu] accordion', e); }
  if(typeof renderMain === 'function') renderMain();
};
window._menuSwitchDate = function(d){
  if(!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
  _menuState.date = d;
  try {
    _menuState.service = 'midi';
    _menuState.openServices = { midi: true };
    const dt = new Date(d+'T12:00');
    _menuState.calY = dt.getFullYear();
    _menuState.calM = dt.getMonth();
  } catch(e){}
  if(typeof renderMain === 'function') renderMain();
};
window._menuPickCalDay = function(d){
  window._menuSwitchDate(d);
};
window._menuCalMove = function(dir){
  try {
    let m = (_menuState.calM == null ? new Date((_menuState.date||today())+'T12:00').getMonth() : _menuState.calM) + (dir||0);
    let y = _menuState.calY == null ? new Date((_menuState.date||today())+'T12:00').getFullYear() : _menuState.calY;
    while(m > 11){ m -= 12; y++; }
    while(m < 0){ m += 12; y--; }
    _menuState.calY = y;
    _menuState.calM = m;
  } catch(e){ console.warn('[menu] cal move', e); }
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
    composants: [],
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
window._menuAdd = function(catId, svcId){
  try {
    _menuEnsureService(svcId);
    const sid = svcId || _menuState.service;
    const inp = document.getElementById('mn-inp-'+sid+'-'+catId) || document.getElementById('mn-inp-'+catId);
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
    setTimeout(()=>{ const x=document.getElementById('mn-inp-'+sid+'-'+catId) || document.getElementById('mn-inp-'+catId); if(x) x.focus(); },50);
  } catch(e){ console.warn('[menu] add', e); }
};
window._menuRemove = function(catId, idx, svcId){
  try {
    _menuEnsureService(svcId);
    const menu = getMenu(_menuState.date, _menuState.service);
    if(!menu) return;
    menu.categories[catId].splice(idx,1);
    setMenu(_menuState.date, _menuState.service, menu);
    if(typeof renderMain === 'function') renderMain();
  } catch(e){ console.warn('[menu] remove', e); }
};
window._menuChangeProfil = function(catId, idx, svcId){
  _menuEnsureService(svcId);
  const menu = getMenu(_menuState.date, _menuState.service);
  if(!menu) return;
  const plat = menu.categories[catId][idx];
  if(!plat) return;
  const order = ['BF_CUIT','BF_CRU','REMISE_TC','SORTIE_DIRECTE','PREP_MINUTE'];
  const cur = order.indexOf(plat.profil_haccp);
  plat.profil_haccp = order[(cur+1) % order.length];
  if(!['SORTIE_DIRECTE','PREP_MINUTE'].includes(plat.profil_haccp)) plat.statut_auto = null;
  // Recalculate mixé BF profile if the variant is active
  if(plat.variants?.mixe){
    plat.variants.mixe_profil = mixeProfil(plat);
    if(typeof toast === 'function') toast('Profil → ' + (PROFILS[plat.profil_haccp]?.label||'?') + ' · Mixé → ' + (PROFILS[plat.variants.mixe_profil]?.label||'?'), 'info');
  } else {
    if(typeof toast === 'function') toast('Profil → ' + (PROFILS[plat.profil_haccp]?.label||'?'), 'info');
  }
  setMenu(_menuState.date, _menuState.service, menu);
  _menuSyncAfterEdit(menu);
  if(typeof renderMain === 'function') renderMain();
};
// Menu déjà validé (« Enregistrer ») : renvoyer la version à jour au siège (enr_menu) et
// recaler le profil des plats témoins du jour (ENR33 + lot d'étiquettes en attente).
function _menuSyncAfterEdit(menu){
  try {
    if(!menu || !menu.categories) return;
    const d = _menuState.date, svc = _menuState.service;
    const plats = {};
    allDisplayCats().forEach(c => (menu.categories[c.id]||[]).forEach(p => { if(p && p.plat_id) plats[p.plat_id] = p; }));
    const profFor = function(p, variant){
      const v = String(variant||'').toLowerCase();
      if(v === 'mixé' || v === 'mixe') return (p.variants && (p.variants.mixe_profil || mixeProfil(p))) || mixeProfil(p);
      return p.profil_haccp;
    };
    try {
      ((S.enr33 && S.enr33.lignes) || []).forEach(l => {
        try {
          if(!l || l._menu_id !== menu.menu_id || !plats[l._plat_id]) return;
          const np = profFor(plats[l._plat_id], l._variant);
          if(np && l._plat_profil !== np){
            l._plat_profil = np;
            if(typeof SupaEngine !== 'undefined' && SupaEngine.enqueue) SupaEngine.enqueue('enr33', l);
          }
        } catch(e){}
      });
    } catch(e){ console.warn('[menu] sync enr33', e); }
    try {
      if(typeof _e33batch !== 'undefined' && Array.isArray(_e33batch)){
        _e33batch.forEach(b => {
          try { if(b && b._from_menu && plats[b._plat_id]) b._plat_profil = profFor(plats[b._plat_id], b._variant) || b._plat_profil; } catch(e){}
        });
      }
    } catch(e){}
    const hist = (S.menu_history || []).find(h => h && h.menu_date === d && h.service === svc);
    if(!hist) return; // brouillon jamais validé : il partira au siège à « Enregistrer »
    const rec = stampEntry({ menu_date:d, service:svc, categories:menu.categories, menu_id:menu.menu_id, date:d, _ts:new Date().toISOString() });
    menu._ts = rec._ts;
    S.menu_history = S.menu_history.filter(h => !(h && h.menu_date === d && h.service === svc));
    S.menu_history.push(rec);
    save();
    if(typeof SupaEngine !== 'undefined' && SupaEngine.enqueue){
      SupaEngine.enqueue('enr_menu', rec);
      if(SupaEngine.flush) setTimeout(()=>{ try { SupaEngine.flush(); } catch(e){} }, 200);
    }
  } catch(e){ console.warn('[menu] sync after edit', e); }
}
window._menuSyncAfterEdit = _menuSyncAfterEdit;
// Pastille Préparé minute / Sortie directe / Remise T°C : 2e clic = retour au profil de base
window._menuSetPastille = function(catId, idx, key, svcId){
  try {
    _menuEnsureService(svcId);
    const menu = getMenu(_menuState.date, _menuState.service);
    const plat = menu && menu.categories && menu.categories[catId] && menu.categories[catId][idx];
    if(!plat || !PROFILS[key]) return;
    if(plat.profil_haccp === key){
      const det = detectProfil(plat.nom);
      plat.profil_haccp = plat.profil_base || ((det === 'BF_CUIT' || det === 'BF_CRU') ? det : 'BF_CUIT');
      plat.statut_auto = null;
    } else {
      if(plat.profil_haccp === 'BF_CUIT' || plat.profil_haccp === 'BF_CRU') plat.profil_base = plat.profil_haccp;
      plat.profil_haccp = key;
      plat.statut_auto = (key === 'SORTIE_DIRECTE' || key === 'PREP_MINUTE') ? 'preparé_minute' : null;
    }
    if(plat.variants && plat.variants.mixe) plat.variants.mixe_profil = mixeProfil(plat);
    setMenu(_menuState.date, _menuState.service, menu);
    _menuSyncAfterEdit(menu);
    if(typeof toast === 'function') toast((PROFILS[plat.profil_haccp]?.ico||'') + ' ' + plat.nom + ' → ' + (PROFILS[plat.profil_haccp]?.label||'?'), 'info');
    if(typeof renderMain === 'function') renderMain();
  } catch(e){ console.warn('[menu] set pastille', e); }
};
window._menuToggleVariant = function(catId, idx, variant, checked, svcId){
  _menuEnsureService(svcId);
  const menu = getMenu(_menuState.date, _menuState.service);
  if(!menu) return;
  const plat = menu.categories[catId][idx];
  if(!plat) return;
  plat.variants = plat.variants || {};
  plat.variants[variant] = !!checked;
  if(variant === 'mixe'){
    if(checked){
      plat.variants.mixe_profil = mixeProfil(plat);
    } else {
      delete plat.variants.mixe_profil;
    }
  }
  setMenu(_menuState.date, _menuState.service, menu);
  _menuSyncAfterEdit(menu);
  if(typeof renderMain === 'function') renderMain();
};
window._menuToggleMixeProfil = function(catId, idx, svcId){
  _menuEnsureService(svcId);
  const menu = getMenu(_menuState.date, _menuState.service);
  if(!menu) return;
  const plat = menu.categories[catId]?.[idx];
  if(!plat || !plat.variants?.mixe) return;
  const cur = plat.variants.mixe_profil || mixeProfil(plat);
  plat.variants.mixe_profil = cur === 'BF_CUIT' ? 'BF_CRU' : 'BF_CUIT';
  setMenu(_menuState.date, _menuState.service, menu);
  _menuSyncAfterEdit(menu);
  if(typeof renderMain === 'function') renderMain();
  if(typeof toast === 'function') toast('Mixé → ' + (PROFILS[plat.variants.mixe_profil]?.label||'?'), 'info');
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
  allDisplayCats().forEach(c => {
    menu.categories[c.id] = (hier.categories[c.id]||[]).map(p => ({
      ...p, plat_id: newUUID().slice(0,8), statut_auto:null,
    }));
  });
  try { applyMenuMigrations(menu, _menuState.service); } catch(e){}
  setMenu(_menuState.date, _menuState.service, menu);
  if(typeof renderMain === 'function') renderMain();
  if(typeof toast === 'function') toast('✅ Menu de la veille recopié','success');
};
window._menuValiderSorties = function(){
  const menu = getMenu(_menuState.date, _menuState.service);
  if(!menu){ if(typeof toast==='function') toast('Aucun menu','warning'); return; }
  let n = 0;
  allDisplayCats().forEach(c => {
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
window._menuClear = function(svcId){
  try {
    _menuEnsureService(svcId);
    const sv = SERVICES.find(s => s.id === _menuState.service)?.label || _menuState.service;
    if(!confirm('Vider le menu de '+sv+' ?')) return;
    const menu = { categories: emptyCategories(), menu_id: newUUID() };
    setMenu(_menuState.date, _menuState.service, menu);
    if(typeof renderMain === 'function') renderMain();
  } catch(e){ console.warn('[menu] clear', e); }
};
window._menuSave = function(svcId){
  _menuEnsureService(svcId);
  const menu = getMenu(_menuState.date, _menuState.service);
  if(!menu){ if(typeof toast==='function') toast('Aucun menu','warning'); return; }
  let total = 0;
  allDisplayCats().forEach(c => total += (menu.categories[c.id]||[]).length);
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
  let count33 = 0;
  // Ne pas sauter tout le menu si AU MOINS un témoin existe : n'enqueue que les plats
  // (plat_id + variante) absents pour ce menu aujourd'hui. Les 4 déjà créés ne sont pas dupliqués.
  try {
    const day = today();
    const varKey = function(v){ return (v == null || v === '') ? '' : String(v); };
    const hasTemoin = function(platId, variant){
      if (!platId) return false;
      const vk = varKey(variant);
      return (S.enr33.lignes||[]).some(function(l){
        try {
          if (!l || l._menu_id !== menu.menu_id || l._plat_id !== platId) return false;
          if (varKey(l._variant) !== vk) return false;
          return l.date === day || String(l._ts||'').slice(0,10) === day;
        } catch (e) { return false; }
      });
    };
    allDisplayCats().forEach(c => {
      (menu.categories[c.id]||[]).forEach(plat => {
        try {
          if (!plat) return;
          if (!hasTemoin(plat.plat_id, '')) {
            addPlatTemoin(plat.nom, plat, chef, datePrelev, heure, dateDestruct, serviceTxt, menu.menu_id, '');
            count33++;
          }
          if (plat.variants?.mixe && !hasTemoin(plat.plat_id, 'mixé')) {
            const mxProfil = plat.variants.mixe_profil || mixeProfil(plat);
            addPlatTemoin(plat.nom+' (mixé)', plat, chef, datePrelev, heure, dateDestruct, serviceTxt, menu.menu_id, 'mixé', mxProfil);
            count33++;
          }
          if (plat.variants?.sans_sel && !hasTemoin(plat.plat_id, 'sans_sel')) {
            addPlatTemoin(plat.nom+' (sans sel)', plat, chef, datePrelev, heure, dateDestruct, serviceTxt, menu.menu_id, 'sans_sel');
            count33++;
          }
          if (plat.variants?.hp && !hasTemoin(plat.plat_id, 'hp')) {
            addPlatTemoin(plat.nom+' (HP)', plat, chef, datePrelev, heure, dateDestruct, serviceTxt, menu.menu_id, 'hp');
            count33++;
          }
        } catch (e) { console.warn('[_menuAutoOnSave] plat témoin', e); }
      });
    });
    if (count33 > 0) {
      save();
      try { if (typeof SupaEngine !== 'undefined' && SupaEngine.flush) SupaEngine.flush(); } catch (e) {}
    }
  } catch (e) { console.warn('[_menuAutoOnSave] témoins manquants', e); }

  // Ajouter les plats témoins au lot d'impression ENR33 (_e33batch)
  let count34 = 0;
  allDisplayCats().forEach(c => {
    (menu.categories[c.id]||[]).forEach(plat => {
      const mxProfil = plat.variants?.mixe ? (plat.variants.mixe_profil || mixeProfil(plat)) : null;
      const variants = [
        { nom: plat.nom, variant: '', profil: plat.profil_haccp },
        ...(plat.variants?.mixe     ? [{ nom: plat.nom+' (mixé)',    variant: 'MIXÉ',     profil: mxProfil    }] : []),
        ...(plat.variants?.sans_sel ? [{ nom: plat.nom+' (sans sel)',variant: 'SANS SEL', profil: plat.profil_haccp }] : []),
        ...(plat.variants?.hp       ? [{ nom: plat.nom+' (HP)',      variant: 'HP',       profil: plat.profil_haccp }] : []),
      ];
      variants.forEach(v => {
        // Pousser dans le lot plats témoins (_e33batch = variable globale de app-cuisine.js)
        if(typeof _e33batch !== 'undefined'){
          _e33batch.push({
            produit:      v.nom,
            service:      serviceTxt,
            date_prelev:  datePrelev,
            heure_prelev: heure,
            date_destruct:dateDestruct,
            operateur:    chef,
            nb:           1,
            _plat_id:     plat.plat_id,
            _plat_profil: v.profil || null,
            _variant:     v.variant || null,
            _from_menu:   true,
          });
        }
        count34++;
      });
    });
  });
  if(typeof renderNav === 'function') renderNav(); // mettre à jour le badge du lot

  const msg = count33 > 0
    ? `✅ Menu enregistré · ${count33} plat${count33>1?'s':''} témoin${count33>1?'s':''} créé${count33>1?'s':''} · ${count34} étiquette${count34>1?'s':''} dans le lot témoins`
    : `✅ Menu enregistré · ${count34} étiquette${count34>1?'s':''} dans le lot témoins`;
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
  allDisplayCats().forEach(c => {
    (menu.categories[c.id]||[]).forEach(plat => {
      addPlatTemoin(plat.nom, plat, chef, datePrelev, heure, dateDestruct, serviceTxt, menu.menu_id, '');
      count++;
      if(plat.variants?.mixe){
        const mxProfil = plat.variants.mixe_profil || mixeProfil(plat);
        addPlatTemoin(plat.nom + ' (mixé)', plat, chef, datePrelev, heure, dateDestruct, serviceTxt, menu.menu_id, 'mixé', mxProfil);
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

var _enr33TsCursor = 0;
function _nextEnr33Ts(){
  try {
    var ms = Date.now();
    if (ms <= _enr33TsCursor) ms = _enr33TsCursor + 1;
    _enr33TsCursor = ms;
    return new Date(ms).toISOString();
  } catch (e) {
    try { return new Date().toISOString(); } catch (e2) { return ''; }
  }
}
function addPlatTemoin(nom, plat, chef, datePrelev, heure, dateDestruct, serviceTxt, menuId, variant, overrideProfil){
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
    _ts:           _nextEnr33Ts(),
    _plat_id:       plat.plat_id,
    _plat_nom:      plat.nom,
    _plat_profil:   overrideProfil || plat.profil_haccp,
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
  allDisplayCats().forEach(c => {
    (menu.categories[c.id]||[]).forEach(plat => {
      const tag = ({ REMISE_TC:'REMISE T°C', SORTIE_DIRECTE:'SORTIE DIRECTE', PREP_MINUTE:'PRÉPARÉ MINUTE' })[plat.profil_haccp] || '';
      const withTag = function(v){ return [v, tag].filter(Boolean).join(' · '); };
      const mxLab = plat.variants?.mixe ? ((plat.variants.mixe_profil || mixeProfil(plat)) === 'BF_CRU' ? 'MIXÉ · BF CRU' : 'MIXÉ · BF CUIT') : '';
      const group = [{ nom: plat.nom, variant: tag }];
      if(plat.variants?.mixe)     group.push({ nom: plat.nom, variant: mxLab });
      if(plat.variants?.sans_sel) group.push({ nom: plat.nom, variant: withTag('SANS SEL') });
      if(plat.variants?.hp)       group.push({ nom: plat.nom, variant: withTag('HP') });
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
    // Les témoins du menu ne sont validés qu'après confirmation de l'impression
    const imprimes = [];
    allDisplayCats().forEach(c => {
      (menu.categories[c.id]||[]).forEach(plat => {
        imprimes.push({ _plat_id: plat.plat_id, _variant: '' });
        if(plat.variants?.mixe)     imprimes.push({ _plat_id: plat.plat_id, _variant: 'mixé' });
        if(plat.variants?.sans_sel) imprimes.push({ _plat_id: plat.plat_id, _variant: 'sans_sel' });
        if(plat.variants?.hp)       imprimes.push({ _plat_id: plat.plat_id, _variant: 'hp' });
      });
    });
    setTimeout(function(){
      try {
        showConfirm('🖨️ Étiquettes bien imprimées ?', 'Si oui, les plats témoins seront validés.', '✅ Oui', function(){
          window._temoinMarkImprime(imprimes);
          if(typeof renderMain === 'function') renderMain();
        });
      } catch(e){ console.warn('[menu print] confirm:', e); }
    }, 1500);
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

window._menuMicToggle = function(catId, svcId){
  try {
    _menuEnsureService(svcId);
    const sid = svcId || _menuState.service;
    const micKey = sid + '::' + catId;
    const micElId = 'mn-mic-'+sid+'-'+catId;
    const SR = getSpeechRecognition();
    if(!SR){
      if(typeof toast==='function') toast('Dictée non supportée. Utilisez Chrome.','warning');
      return;
    }
    if(_activeRecognition && _activeMicCatId === micKey){
      try { _activeRecognition.stop(); } catch(e){}
      _activeRecognition = null;
      _activeMicCatId = null;
      const btn = document.getElementById(micElId) || document.getElementById('mn-mic-'+catId);
      if(btn) btn.classList.remove('recording');
      return;
    }
    if(_activeRecognition){
      try { _activeRecognition.abort(); } catch(e){}
      if(_activeMicCatId){
        const parts = String(_activeMicCatId).split('::');
        const oldId = parts.length === 2 ? ('mn-mic-'+parts[0]+'-'+parts[1]) : ('mn-mic-'+_activeMicCatId);
        const old = document.getElementById(oldId);
        if(old) old.classList.remove('recording');
      }
    }
    const rec = new SR();
    rec.lang = 'fr-FR';
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    _activeRecognition = rec;
    _activeMicCatId = micKey;
    const btn = document.getElementById(micElId) || document.getElementById('mn-mic-'+catId);
    if(btn) btn.classList.add('recording');
    rec.onresult = function(ev){
      const txt = ev.results[0][0].transcript.trim();
      if(txt && txt.length <= 80) {
        _menuEnsureService(sid);
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
  } catch(e){ console.warn('[menu] mic', e); }
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
  [/^(potages?|soupes?|veloutés?)$/i, 'entrees'],
  [/^(entrées?|crudités?)$/i, 'entrees'],
  [/^(plats?|viandes?|poissons?)$/i, 'plats'],
  [/^(garnitures?|accompagnements?|légumes?|legumes?)$/i, 'garnitures'],
  [/^(fromages?)$/i, 'fromages'],
  [/^(desserts?|laitages?|fruits?|pâtisseries?|patisseries?)$/i, 'desserts'],
  [/^(pains?|baguettes?)$/i, 'entrees'],
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
    allDisplayCats().forEach(c => {
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
function menuBannerWanted(id){
  try {
    if(!id || id === 'enr04') return false;
    if(LINK_ENRS.includes(id)) return true;
    return String(id).indexOf('enr_distrib_') === 0;
  } catch(e){ return false; }
}

const LINK_ENRS = ['enr01','enr02','enr03','enr07','enr08','enr09','enr10',
                   'enr11','enr12','enr13','enr14','enr15','enr16','enr23','enr31','enr33','enr34','enr36','enr_allergenes'];

let _menuLinkPending = {};
let _bannerOpen = {};

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

function fillNamedField(el, value){
  try {
    if(!el) return;
    el.value = value;
    el.dispatchEvent(new Event('input', {bubbles:true}));
    el.dispatchEvent(new Event('change', {bubbles:true}));
  } catch(e){ console.warn('[menu] fillNamedField:', e); }
}

function fillFormWithPlat(enrId, ref){
  if(!ref || !ref.nom) return;
  try {
    if(enrId === 'enr36') fillNamedField(document.getElementById('e36-produit-inp'), ref.nom);
    if(enrId === 'enr_allergenes'){
      const inp = document.querySelector('#main-content input[type="text"]');
      fillNamedField(inp, ref.nom);
    }
    if(String(enrId).indexOf('enr_distrib_') === 0){
      const inputs = Array.from(document.querySelectorAll('#main-content input.distrib-plat-inp')).filter(el => !el.readOnly);
      const target = inputs.find(el => !String(el.value||'').trim());
      if(target) fillNamedField(target, ref.nom);
    }
    if(enrId === 'enr36' || enrId === 'enr_allergenes' || String(enrId).indexOf('enr_distrib_') === 0) return;
  } catch(e){ console.warn('[menu] fill extra:', e); }
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
  try { applyBannerContent(banner, enrId); }
  catch(e){ console.warn('[menu] refreshLinkBanner:', e); }
}

function ligneIsToday(l){
  if(!l) return false;
  const d = today();
  return l.date === d || String(l._ts||'').slice(0,10) === d;
}

// ── Reconnaissance d'un plat du menu à partir d'un nom saisi à la main ──
// Ignore majuscules, accents, pluriels simples et petits mots. Un nom n'est
// rattaché automatiquement que s'il désigne UN SEUL plat du menu du jour.
const _MN_STOP = new Set(['de','du','des','la','le','les','l','d','a','au','aux','et','en','avec','sur','facon']);
function _mnNormTokens(s){
  try {
    return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/)
      .filter(w => w && !_MN_STOP.has(w))
      .map(w => (w.length > 3 && /[sx]$/.test(w)) ? w.slice(0,-1) : w);
  } catch(e){ return []; }
}
function todayMenuPlats(){
  const out = [];
  try {
    const t = today();
    SERVICES.forEach(s => {
      const m = getMenu(t, s.id);
      if(!m) return;
      allDisplayCats().forEach(c => (m.categories?.[c.id]||[]).forEach(p => out.push({ p, svc:s, menu_id: p.menu_id || m.menu_id })));
    });
  } catch(e){ console.warn('[menu] todayMenuPlats:', e); }
  return out;
}
function menuMatchNom(nom){
  const res = { sure:null, candidates:[] };
  try {
    const tk = _mnNormTokens(nom);
    if(!tk.length) return res;
    const set = new Set(tk);
    const plats = todayMenuPlats();
    const exact = [], contain = [], partial = [];
    plats.forEach(x => {
      const pt = _mnNormTokens(x.p.nom);
      if(!pt.length) return;
      const ps = new Set(pt);
      const same = pt.length === tk.length && pt.every(w => set.has(w));
      if(same){ exact.push(x); return; }
      const inP = tk.every(w => ps.has(w)), inT = pt.every(w => set.has(w));
      if(inP || inT){ contain.push(x); return; }
      if(tk.some(w => w.length > 3 && ps.has(w))) partial.push(x);
    });
    if(exact.length === 1){ res.sure = exact[0]; return res; }
    if(exact.length > 1){ res.candidates = exact; return res; }
    if(contain.length === 1){ res.sure = contain[0]; return res; }
    res.candidates = contain.length ? contain : partial;
  } catch(e){ console.warn('[menu] menuMatchNom:', e); }
  return res;
}
function _ligneNom(l){ return (l && (l.produit || l.plat || l.nom || l._plat_nom)) || ''; }
function _tagLigne(enrId, l, x){
  try {
    l._plat_id = x.p.plat_id; l._plat_nom = x.p.nom; l._menu_id = x.menu_id; l._plat_profil = x.p.profil_haccp;
    save();
    try { if(typeof SupaEngine !== 'undefined' && SupaEngine.enqueue) SupaEngine.enqueue(enrId, l); } catch(e){ console.warn('[menu] enqueue tag:', e); }
  } catch(e){ console.warn('[menu] _tagLigne:', e); }
}
// Fenêtre « Ce produit correspond-il à un plat du menu ? » (seulement si la reconnaissance n'est pas sûre)
function askPlatPourLigne(enrId, l, candidates){
  try {
    const old = document.getElementById('mn-ask-plat'); if(old) old.remove();
    const wrap = document.createElement('div');
    wrap.id = 'mn-ask-plat';
    wrap.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px';
    const btns = candidates.slice(0,6).map((x,i) =>
      '<button type="button" data-i="'+i+'" style="display:block;width:100%;text-align:left;margin:6px 0;padding:12px 14px;border-radius:12px;border:1.5px solid #d8b4d8;background:#fdf4fd;font:inherit;font-weight:800;color:#3b1e3b;cursor:pointer">🍽️ '+escH(x.p.nom)+' <span style="font-weight:600;color:#7A6579;font-size:.8em">· '+escH(x.svc.label)+'</span></button>').join('');
    wrap.innerHTML = '<div style="background:#fff;border-radius:18px;max-width:440px;width:100%;padding:18px 18px 14px;box-shadow:0 20px 60px rgba(0,0,0,.3)">'
      + '<div style="font-weight:900;font-size:1.05rem;color:#3b1e3b;margin-bottom:4px">Ce produit est-il un plat du menu ?</div>'
      + '<div style="font-size:.85rem;color:#7A6579;margin-bottom:6px">« '+escH(_ligneNom(l))+' » — touchez le plat correspondant pour cocher sa traçabilité.</div>'
      + btns
      + '<button type="button" data-i="-1" style="display:block;width:100%;margin-top:8px;padding:11px;border-radius:12px;border:1.5px solid #e2e8f0;background:#f8fafc;font:inherit;font-weight:700;color:#475569;cursor:pointer">Non, autre produit</button></div>';
    wrap.addEventListener('click', function(ev){
      const b = ev.target.closest('button[data-i]');
      if(!b && ev.target !== wrap) return;
      const i = b ? parseInt(b.getAttribute('data-i'),10) : -1;
      if(i >= 0 && candidates[i]){ _tagLigne(enrId, l, candidates[i]); if(typeof toast === 'function') toast('✅ Rattaché à « '+candidates[i].p.nom+' »','success'); }
      wrap.remove();
      try { refreshLinkBanner(enrId); } catch(e){}
    });
    document.body.appendChild(wrap);
  } catch(e){ console.warn('[menu] askPlatPourLigne:', e); }
}
// Ligne enregistrée sans passer par le menu : rattachement sûr → silencieux ; incertain → on demande.
const MN_TRACE_ENRS = ['enr33','enr02','enr07','enr08']; // fiches comptées dans la traçabilité par plat
function autoLinkLigne(enrId, l){
  try {
    if(MN_TRACE_ENRS.indexOf(enrId) < 0) return;
    if(!l || l._plat_id) return;
    const nom = _ligneNom(l);
    if(!nom) return;
    const m = menuMatchNom(nom);
    if(m.sure){ _tagLigne(enrId, l, m.sure); return; }
    if(m.candidates.length) askPlatPourLigne(enrId, l, m.candidates);
  } catch(e){ console.warn('[menu] autoLinkLigne:', e); }
}
// Suggestions de la saisie « Produit » : plats du menu du jour en premier
window._menuProdSuggest = function(q){
  try {
    const nq = _mnNormTokens(q).join(' ');
    if(!nq) return [];
    return todayMenuPlats().map(x => x.p.nom).filter((n,i,a) => a.indexOf(n) === i && _mnNormTokens(n).join(' ').includes(nq));
  } catch(e){ return []; }
};

// Plats témoins créés depuis le menu : ne comptent comme faits qu'une fois l'étiquette
// imprimée (confirmation « Étiquettes bien imprimées ? »). Mémorisé pour le jour en cours.
function _temoinKey(platId, variant){
  return String(platId||'') + '|' + String(variant||'').toLowerCase().replace(/\s+/g,'_');
}
function _temoinImprime(l){
  try {
    if(!l || !l._from_menu) return true;
    const m = S.etiqImprimees;
    return !!(m && m.date === today() && m.keys && m.keys[_temoinKey(l._plat_id, l._variant)]);
  } catch(e){ return true; }
}
window._temoinMarkImprime = function(entries){
  try {
    const t = today();
    if(!S.etiqImprimees || S.etiqImprimees.date !== t) S.etiqImprimees = { date:t, keys:{} };
    (entries||[]).forEach(b => {
      if(b && b._plat_id) S.etiqImprimees.keys[_temoinKey(b._plat_id, b._variant)] = true;
    });
    save();
  } catch(e){ console.warn('[menu] _temoinMarkImprime:', e); }
};

function platDejaSaisi(enrId, plat){
  try {
    const store = (typeof S !== 'undefined' && S[enrId]) || {};
    const lignes = store.lignes || store.saisies || [];
    const nom = String(plat && plat.nom || '').trim().toLowerCase();
    return lignes.some(l => {
      if(!ligneIsToday(l)) return false;
      if(enrId === 'enr33' && !_temoinImprime(l)) return false;
      if(plat && plat.plat_id && _ligneHasPlat(l, plat.plat_id)) return true;
      const alt = String(l._plat_nom || l.produit || '').trim().toLowerCase();
      if(nom && alt && alt === nom) return true;
      if(!l._plat_id && plat && plat.plat_id){
        const m = menuMatchNom(_ligneNom(l));
        if(m.sure && m.sure.p.plat_id === plat.plat_id) return true;
      }
      return false;
    });
  } catch(e){ return false; }
}

function enrIdsForProfil(key){
  try {
    const prof = PROFILS[key];
    return (prof && prof.enr) ? prof.enr : [];
  } catch(e){ return []; }
}

function enrHasProfil(enrId){
  try {
    return Object.keys(PROFILS).some(k => enrIdsForProfil(k).includes(enrId));
  } catch(e){ return false; }
}

function platShowsOnEnr(p, enrId){
  try {
    if(!p || !enrId) return false;
    if(!enrHasProfil(enrId)) return true;
    // Bien Faits cuit (ENR07) / sans cuisson (ENR08) : seulement les plats cochés « Mixé »,
    // rangés selon leur profil mixé (décision Jérémie, oct. 2026).
    if(enrId === 'enr07' || enrId === 'enr08'){
      if(!(p.variants && p.variants.mixe)) return false;
      return enrIdsForProfil(p.variants.mixe_profil || mixeProfil(p)).includes(enrId);
    }
    if(enrIdsForProfil(p.profil_haccp).includes(enrId)) return true;
    if(p.variants && p.variants.mixe){
      const mx = p.variants.mixe_profil || mixeProfil(p);
      if(enrIdsForProfil(mx).includes(enrId)) return true;
    }
    return false;
  } catch(e){ return false; }
}

function collectBannerGroups(enrId){
  const groups = [];
  let anyDish = false;
  SERVICES.forEach(svc => {
    const m = getMenu(today(), svc.id);
    if(!m) return;
    const plats = [];
    allDisplayCats().forEach(c => {
      (m.categories?.[c.id]||[]).forEach(p => {
        anyDish = true;
        if(!platShowsOnEnr(p, enrId)) return;
        plats.push({
          plat_id: p.plat_id,
          nom: p.nom,
          profil_haccp: p.profil_haccp,
          menu_id: m.menu_id
        });
      });
    });
    if(plats.length) groups.push({ label: svc.label, plats });
  });
  return { groups, anyDish };
}

let _mnNoMixeToastVisit = '';
function toastNoMixeOnce(enrId){
  try {
    const key = enrId + '|' + today();
    if(_mnNoMixeToastVisit === key) return;
    _mnNoMixeToastVisit = key;
    if(typeof toast === 'function') toast('Pas de plat correspondant dans le menu du jour','warning');
  } catch(e){}
}

function findBannerPlat(enrId, platId){
  const info = collectBannerGroups(enrId);
  for(const g of info.groups){
    const p = g.plats.find(x => String(x.plat_id) === String(platId));
    if(p) return { plat_id:p.plat_id, nom:p.nom, profil_haccp:p.profil_haccp, menu_id:p.menu_id };
  }
  return null;
}

function ensureLinkPickStyle(){
  try {
    if(document.getElementById('mn-link-pick-style')) return;
    const st = document.createElement('style');
    st.id = 'mn-link-pick-style';
    st.textContent = 'button.mn-link-pick.mn-link-on{background:#e0e7ff!important;border-color:#4f46e5!important;box-shadow:inset 4px 0 0 #4f46e5}';
    (document.head || document.documentElement).appendChild(st);
  } catch(e){ console.warn('[menu] ensureLinkPickStyle:', e); }
}

function markBannerPick(banner, btn){
  try {
    if(!banner || !btn) return;
    banner.querySelectorAll('.mn-link-on').forEach(el => { if(el !== btn) el.classList.remove('mn-link-on'); });
    btn.classList.add('mn-link-on');
  } catch(e){ console.warn('[menu] markBannerPick:', e); }
}

function bindBannerPick(banner, enrId){
  if(!banner || banner._mnPickBound) return;
  banner._mnPickBound = true;
  try { ensureLinkPickStyle(); } catch(e){}
  banner.addEventListener('click', function(ev){
    const fold = ev.target.closest('[data-mn-fold]');
    if(fold && banner.contains(fold)){
      try { _bannerOpen[enrId] = !_bannerOpen[enrId]; applyBannerContent(banner, enrId); } catch(e){}
      return;
    }
    const btn = ev.target.closest('[data-mn-pick]');
    if(!btn || !banner.contains(btn)) return;
    try {
      const ref = findBannerPlat(enrId, btn.getAttribute('data-plat-id'));
      if(!ref) return;
      if(enrId === 'enr31'){
        try { _menuTogglePending(enrId, ref); } catch(e){}
        try { applyBannerContent(banner, enrId); } catch(e){}
        return;
      }
      _menuLinkPending[enrId] = ref;
      try { markBannerPick(banner, btn); } catch(e){}
      fillFormWithPlat(enrId, ref);
    } catch(e){ console.warn('[menu] banner pick:', e); }
  });
}

function buildBannerInner(enrId){
  try {
    const info = collectBannerGroups(enrId);
    if(!info.anyDish){
      return `
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:1rem">🍽️</span>
        <div style="flex:1;font-size:.74rem;font-weight:700;color:#7A6579">Aucun menu saisi aujourd'hui</div>
        <button type="button" onclick="goTo('menu_jour')" style="background:#5C1E5A;color:#fff;border:none;border-radius:8px;padding:6px 11px;font-size:.72rem;font-weight:800;cursor:pointer;font-family:inherit">📋 Saisir</button>
      </div>`;
    }
    if(!info.groups.length) return '';
    const nPlats = info.groups.reduce((n,g) => n + g.plats.length, 0);
    const open = !!_bannerOpen[enrId];
    const picked = {};
    try {
      const refs = (enrId === 'enr31') ? _menuPendingRefs(enrId) : [];
      if(refs.length) refs.forEach(r => { if(r && r.plat_id) picked[String(r.plat_id)] = 1; });
      else if(_menuLinkPending[enrId] && _menuLinkPending[enrId].plat_id) picked[String(_menuLinkPending[enrId].plat_id)] = 1;
    } catch(e){}
    const rows = info.groups.map(g => {
      const items = g.plats.map(p => {
        const pastille = platDejaSaisi(enrId, p)
          ? `<span style="display:inline-block;margin-left:6px;font-size:.58rem;font-weight:800;line-height:1;padding:2px 6px;border-radius:8px;background:#dcfce7;color:#166534;vertical-align:middle">✓ saisi</span>`
          : '';
        const on = !!picked[String(p.plat_id)];
        return `<button type="button" data-mn-pick="1" data-plat-id="${escH(p.plat_id)}" class="mn-link-pick${on ? ' mn-link-on' : ''}" style="display:flex;align-items:center;width:100%;text-align:left;background:#f7f2f7;border:1.5px solid #ede0ed;border-radius:10px;padding:8px 10px;margin-bottom:4px;cursor:pointer;font-family:inherit">
        <span style="flex:1;min-width:0;font-size:.84rem;font-weight:800;color:#3b1e3b;line-height:1.3;word-break:break-word">${escH(p.nom)}${pastille}</span>
      </button>`;
      }).join('');
      return `<div style="font-size:.68rem;font-weight:800;color:#5C1E5A;margin:8px 0 4px">${escH(g.label)}</div>${items}`;
    }).join('');
    const hint = (enrId === 'enr31' && open) ? `<div style="font-size:.72rem;color:#7A6579;margin:6px 0 2px">Cochez tous les plats qui utilisent ce lot. Un même lot peut servir plusieurs plats. Le nom du produit se saisit dans la fiche, pas ici.</div>` : '';
    return `<button type="button" data-mn-fold="1" style="display:flex;align-items:center;width:100%;text-align:left;background:none;border:none;padding:0;cursor:pointer;font-family:inherit">
      <span style="flex:1;font-size:.7rem;font-weight:700;color:#7A6579;text-transform:uppercase;letter-spacing:.3px">Menu du jour · ${nPlats}</span>
      <span style="font-size:.72rem;font-weight:800;color:#5C1E5A">${open ? 'Replier' : 'Voir'}</span>
    </button>${open ? hint + rows : ''}`;
  } catch(e){
    console.warn('[menu] buildBannerInner:', e);
    return '';
  }
}

function applyBannerContent(banner, enrId){
  try { ensureLinkPickStyle(); } catch(e){}
  const inner = buildBannerInner(enrId);
  if(!inner){
    banner.style.display = 'none';
    banner.style.padding = '0';
    banner.style.margin = '0';
    banner.style.border = 'none';
    banner.innerHTML = '';
    return;
  }
  banner.style.display = '';
  banner.style.padding = '10px 12px';
  banner.style.marginBottom = '10px';
  banner.style.border = '1.5px dashed #d8b4d8';
  banner.innerHTML = inner;
}

function buildBannerHTML(enrId){
  return `<div id="mn-link-banner-${enrId}" style="background:#fff;border:1.5px dashed #d8b4d8;border-radius:12px;padding:10px 12px;margin-bottom:10px">${buildBannerInner(enrId)}</div>`;
}

function injectLinkBanners(){
  if(typeof cur === 'undefined') return;
  if(cur !== 'enr07') _mnNoMixeToastVisit = '';
  if(!menuBannerWanted(cur)) return;
  const main = document.getElementById('main-content');
  if(!main) return;
  if(main.querySelector('#mn-link-banner-'+cur)) return;
  const firstCard = main.querySelector('.card, [class*="card"]');
  const wrapper = document.createElement('div');
  let node = null;
  try {
    wrapper.innerHTML = buildBannerHTML(cur);
    node = wrapper.firstChild;
    if(node) applyBannerContent(node, cur);
  } catch(e){
    console.warn('[menu] injectLinkBanners:', e);
    return;
  }
  if(!node) return;
  if(firstCard && firstCard.parentNode){
    firstCard.parentNode.insertBefore(node, firstCard);
  } else {
    main.insertBefore(node, main.firstChild);
  }
  bindBannerPick(node, cur);
  if(_menuLinkPending[cur]){
    try { fillFormWithPlat(cur, _menuLinkPending[cur]); } catch(e){}
  }
  try {
    const info = collectBannerGroups(cur);
    if(enrHasProfil(cur) && info.anyDish && !info.groups.length) toastNoMixeOnce(cur);
  } catch(e){}
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
    let nAvant = -1;
    try { nAvant = (S[id] && Array.isArray(S[id].lignes)) ? S[id].lignes.length : 0; } catch(e){}
    const r = orig.apply(this, arguments);
    let ajoutee = false;
    try { ajoutee = !!(S[id] && Array.isArray(S[id].lignes) && S[id].lignes.length > nAvant); } catch(e){}
    try {
      const ref = _menuLinkPending[id];
      if(!ajoutee){
        // Enregistrement bloqué (ex. ENR02 sans refroidissement) : ne rien rattacher à une ancienne ligne
      } else if(id === 'enr31' && S[id] && Array.isArray(S[id].lignes) && S[id].lignes[0]){
        try {
          const last = S[id].lignes[0];
          const refs = _menuPendingRefs('enr31');
          if(refs.length){
            _menuWritePlatLiens(last, _menuPlatRefsFromLigne(last).concat(refs));
            save();
            try { if(typeof SupaEngine !== 'undefined' && SupaEngine.enqueue) SupaEngine.enqueue(id, last); } catch(e){}
            _menuLinkPendingMulti['enr31'] = [];
            delete _menuLinkPending['enr31'];
          }
        } catch(e){ console.warn('[menu] enr31 liens', e); }
      } else if(!(ref && ref.plat_id)){
        autoLinkLigne(id, S[id].lignes[0]);
      } else if(ref && ref.plat_id && S[id] && Array.isArray(S[id].lignes) && S[id].lignes.length > 0){
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
    try { if(menuBannerWanted(id)) refreshLinkBanner(id); } catch(e){}
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
        } else {
          const l0 = (S[enrId]?.lignes || [])[0];
          if(l0 && !l0._plat_id && (l0._ts||'').slice(0,10) === today()) autoLinkLigne(enrId, l0);
        }
      } catch(e){ console.warn('[menu] hookBatch:', e); }
      try { refreshLinkBanner(enrId); } catch(e){}
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
// ── Traçabilité par plat (accueil) ─────────────────────────────────
// Règles Jérémie (oct. 2026) : plat témoin pour tous ; Remise T°C → ENR02 ;
// coché Mixé → ENR07 (mixé cuit) ou ENR08 (mixé cru). Pas d'ENR01 pour BF Cuit,
// pas de températures de distribution.
// Lot matière première (ENR31) lié au plat — tous profils, sortie directe comprise
function platMpCount(p){
  try {
    return ((S.enr31 && S.enr31.lignes) || []).filter(l => l && !l._deleted && _ligneHasPlat(l, p && p.plat_id)).length;
  } catch(e){ return 0; }
}
function platMpLie(p){ return platMpCount(p) > 0; }
// Noms des ingrédients (lots ENR31) déjà liés au plat, pour les afficher sous le plat
function platMpNoms(p){
  try {
    const seen = {};
    return ((S.enr31 && S.enr31.lignes) || [])
      .filter(l => l && !l._deleted && _ligneHasPlat(l, p && p.plat_id))
      .map(l => String(l.produit || '').trim())
      .filter(n => n && !seen[n.toLowerCase()] && (seen[n.toLowerCase()] = 1));
  } catch(e){ return []; }
}
// Lots MP fait = au moins un lot lié ET le cuisinier a confirmé « tout est tracé »
// (l'appli ne connaît pas la recette : un seul lot ne suffit pas à valider)
function platMpComplet(p){ return !!(p && p.mp_complet === true) && platMpLie(p); }
function platStepDone(enrId, p){
  return enrId === 'enr31' ? platMpComplet(p) : platDejaSaisi(enrId, p);
}
// Pastille de l'onglet Traçabilité MP : plats du menu du jour pas encore complets
window._menuMpManquants = function(){
  try { return todayMenuPlats().filter(x => x && x.p && !platMpComplet(x.p)).length; }
  catch(e){ return 0; }
};
// Bouton « ✔ Tout tracé » / « ↺ Rouvrir » du widget d'accueil
window._menuMpComplet = function(ev, svcId, catId, idx){
  try { if(ev){ ev.preventDefault(); ev.stopPropagation(); } } catch(e){}
  try {
    const t = today();
    const m = getMenu(t, svcId);
    const p = m && m.categories && m.categories[catId] && m.categories[catId][idx];
    if(!p) return;
    p.mp_complet = !(p.mp_complet === true);
    // Menu renvoyé au cloud (sinon le prochain pull remet l'ancienne version sans mp_complet)
    const rec = stampEntry({ menu_date:t, service:svcId, categories:m.categories, menu_id:m.menu_id, date:t, _ts:new Date().toISOString() });
    m._ts = rec._ts;
    setMenu(t, svcId, m);
    try {
      if(typeof SupaEngine !== 'undefined' && SupaEngine.enqueue){
        SupaEngine.enqueue('enr_menu', rec);
        if(SupaEngine.flush) setTimeout(()=>SupaEngine.flush(), 200);
      }
    } catch(e){ console.warn('[menu] mp complet enqueue:', e); }
    if(typeof toast === 'function') toast(p.mp_complet ? '✅ '+p.nom+' : tous les ingrédients tracés' : '↺ '+p.nom+' : traçabilité MP rouverte', 'success');
    if(typeof renderMain === 'function') renderMain();
    if(typeof renderNav === 'function') renderNav();
  } catch(e){ console.warn('[menu] _menuMpComplet:', e); }
};

function platTraceSteps(p){
  const steps = [{ enr:'enr33', ico:'🍱', label:'Témoin' }, { enr:'enr31', ico:'📋', label:'Lots MP' }];
  try {
    if(p && p.profil_haccp === 'REMISE_TC') steps.push({ enr:'enr02', ico:'🔥', label:'Remise T°C' });
    if(p && p.variants && p.variants.mixe){
      const mx = p.variants.mixe_profil || mixeProfil(p);
      if(mx === 'BF_CUIT') steps.push({ enr:'enr07', ico:'🥄', label:'Mixé cuit' });
      else if(mx === 'BF_CRU') steps.push({ enr:'enr08', ico:'🥄', label:'Mixé cru' });
    }
  } catch(e){ console.warn('[menu] platTraceSteps:', e); }
  return steps;
}

window._menuOpenStep = function(ev, enrId, svcId, catId, idx){
  try { if(ev){ ev.preventDefault(); ev.stopPropagation(); } } catch(e){}
  try {
    const m = getMenu(today(), svcId);
    const p = m && m.categories && m.categories[catId] && m.categories[catId][idx];
    if(!p) { goTo('menu_jour'); return; }
    if(!enrId){
      const todo = platTraceSteps(p).find(st => !platStepDone(st.enr, p));
      enrId = (todo || platTraceSteps(p)[0]).enr;
    }
    _menuLinkPending[enrId] = { plat_id:p.plat_id, nom:p.nom, profil_haccp:p.profil_haccp, menu_id:p.menu_id || m.menu_id };
    // Lots MP : fiche Traçabilité MP liée à ce seul plat (pas de liens restés d'une saisie précédente)
    if(enrId === 'enr31') _menuLinkPendingMulti['enr31'] = [_menuLinkPending[enrId]];
    goTo(enrId);
  } catch(e){ console.warn('[menu] _menuOpenStep:', e); try { goTo('menu_jour'); } catch(_){} }
};

// Repli du détail des plats sur l'accueil (seule la barre de traçabilité reste) — mémorisé dans S.config
window._menuWgToggle = function(ev){
  try { if(ev){ ev.preventDefault(); ev.stopPropagation(); } } catch(e){}
  try {
    S.config = S.config || {};
    const folded = S.config.menuWgFolded !== false;
    S.config.menuWgFolded = !folded;
    save();
    const box = document.getElementById('menu-wg-plats');
    const btn = document.getElementById('menu-wg-fold');
    if(box) box.style.display = folded ? '' : 'none';
    if(btn) btn.textContent = folded ? '▴ Replier' : '▾ Voir les plats';
  } catch(e){ console.warn('[menu] _menuWgToggle:', e); }
};

function renderMenuHomeWidget(){
  const t = today();
  const services = SERVICES.filter(s => getMenu(t, s.id));
  const totalPlats = services.reduce((acc, s) => {
    const m = getMenu(t, s.id);
    if(!m) return acc;
    return acc + allDisplayCats().reduce((a,c) => a + (m.categories?.[c.id]?.length||0), 0);
  }, 0);

  if(services.length === 0){
    return `<div class="wc wc-warn" onclick="goTo('menu_jour')" style="cursor:pointer;background:linear-gradient(135deg,#fef3c7,#fef9c3);border:1.5px solid #f59e0b">
      <span class="wc-ico">🍽️</span>
      <div class="wc-label">Menu du jour</div>
      <div class="wc-val" style="color:#92400e;font-size:.8rem">Pas saisi — tap ici</div>
      <span class="wc-arrow">›</span>
    </div>`;
  }

  let stepsTotal = 0, stepsDone = 0;
  const q = v => String(v).replace(/\\/g,'\\\\').replace(/'/g,"\\'");

  // Tous les plats, groupés par service puis par catégorie, avec une coche par fiche à remplir
  const blocks = services.map(s => {
    const m = getMenu(t, s.id);
    if(!m) return '';
    const cats = catsForService(s.id).map(c => {
      const plats = (m.categories?.[c.id]||[]);
      if(!plats.length) return '';
      const items = plats.map((p, idx) => {
        let col = '#94a3b8';
        try { col = (PROFILS[p.profil_haccp] && PROFILS[p.profil_haccp].color) || col; } catch(e){}
        const steps = platTraceSteps(p);
        let allDone = true;
        const chips = steps.map(st => {
          let done = false;
          try { done = platStepDone(st.enr, p); } catch(e){}
          stepsTotal++; if(done) stepsDone++; else allDone = false;
          // Lots MP : nombre de lots liés ; orange tant que « tout tracé » n'est pas confirmé
          let nMp = 0, enCours = false, mpBtn = '';
          if(st.enr === 'enr31'){
            try { nMp = platMpCount(p); } catch(e){}
            enCours = !done && nMp > 0;
            if(nMp > 0){
              mpBtn = '<button type="button" onclick="window._menuMpComplet(event,\''+q(s.id)+'\',\''+q(c.id)+'\','+idx+')"'
                + ' style="font-family:inherit;cursor:pointer;border-radius:999px;padding:2px 7px;font-size:.6rem;font-weight:800;line-height:1.3;'
                + (done ? 'background:#fff;color:#7A6579;border:1px solid #e5d5e5' : 'background:#5C1E5A;color:#fff;border:1px solid #5C1E5A')
                + '">' + (done ? '↺ Rouvrir' : '✔ Tout tracé') + '</button>';
            }
          }
          return '<button type="button" onclick="window._menuOpenStep(event,\''+st.enr+'\',\''+q(s.id)+'\',\''+q(c.id)+'\','+idx+')"'
            + ' style="font-family:inherit;cursor:pointer;border-radius:999px;padding:2px 7px;font-size:.6rem;font-weight:800;line-height:1.3;'
            + (done ? 'background:#dcfce7;color:#166534;border:1px solid #86efac'
                : enCours ? 'background:#fff7ed;color:#9a3412;border:1px solid #fdba74'
                : 'background:#fff;color:#7A6579;border:1px dashed #d8b4d8')
            + '">' + (done ? '✅ ' : enCours ? '🟠 ' : '⬜ ') + st.ico + ' ' + escH(st.label) + (nMp > 0 ? ' · ' + nMp : '') + '</button>' + mpBtn;
        }).join('');
        let mpNomsHtml = '';
        try {
          const noms = platMpNoms(p);
          if(noms.length) mpNomsHtml = '<div style="display:flex;flex-wrap:wrap;gap:3px;margin:3px 0 0 14px">'
            + noms.map(n => '<span style="border-radius:999px;padding:1px 6px;font-size:.58rem;font-weight:800;background:#dcfce7;color:#166534;border:1px solid #86efac">'+escH(n)+'</span>').join('')
            + '</div>';
        } catch(e){}
        return '<div style="padding:4px 0;border-bottom:1px dashed #f1e6f1;min-width:0">'
          + '<div onclick="window._menuOpenStep(event,\'\',\''+q(s.id)+'\',\''+q(c.id)+'\','+idx+')" style="display:flex;align-items:center;gap:6px;min-width:0;cursor:pointer">'
          + '<span style="flex:none;width:8px;height:8px;border-radius:50%;background:'+escH(col)+'"></span>'
          + '<span style="font-size:.74rem;font-weight:800;color:'+(allDone?'#166534':'#3b1e3b')+';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+escH(p.nom)+'</span>'
          + (allDone ? '<span style="flex:none;font-size:.7rem">✅</span>' : '')
          + '</div>'
          + '<div style="display:flex;flex-wrap:wrap;gap:4px;margin:3px 0 0 14px">'+chips+'</div>'
          + mpNomsHtml
          + '</div>';
      }).join('');
      return '<div style="background:#fff;border:1px solid #ede0ed;border-radius:10px;padding:6px 9px;min-width:0">'
        + '<div style="font-size:.6rem;font-weight:800;color:#7A6579;text-transform:uppercase;letter-spacing:.3px;margin-bottom:2px">'+escH(c.label)+'</div>'
        + items + '</div>';
    }).join('');
    return '<div style="margin-top:6px">'
      + (services.length > 1 ? '<div style="font-size:.66rem;font-weight:900;color:#5C1E5A;margin:2px 0 4px">'+escH(s.label)+'</div>' : '')
      + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px">'+cats+'</div></div>';
  }).join('');

  const pct = stepsTotal ? Math.round(stepsDone * 100 / stepsTotal) : 0;
  const barCol = pct >= 100 ? '#16a34a' : (pct >= 50 ? '#f59e0b' : '#dc2626');
  let folded = true;
  try { folded = !(S.config && S.config.menuWgFolded === false); } catch(e){}

  return `<div class="wc" style="cursor:pointer;background:linear-gradient(135deg,#fdf4fd,#fff);border:1.5px solid #d8b4d8" onclick="goTo('menu_jour')">
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:1.3rem">🍽️</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:.85rem;font-weight:900;color:#5C1E5A">Menu du jour</div>
        <div style="font-size:.62rem;font-weight:700;color:#7A6579">${escH(services.map(s=>s.label).join(' • '))} • ${totalPlats} plat${totalPlats>1?'s':''}</div>
      </div>
      <button type="button" id="menu-wg-fold" onclick="window._menuWgToggle(event)" style="flex:none;font-family:inherit;cursor:pointer;background:#fff;border:1px solid #d8b4d8;color:#5C1E5A;border-radius:999px;padding:4px 10px;font-size:.66rem;font-weight:800">${folded ? '▾ Voir les plats' : '▴ Replier'}</button>
    </div>
    <div style="margin-top:8px">
      <div style="display:flex;justify-content:space-between;font-size:.66rem;font-weight:800;color:#5C1E5A;margin-bottom:3px">
        <span>Traçabilité des plats</span><span>${stepsDone} / ${stepsTotal} fiche${stepsTotal>1?'s':''} · ${pct}%</span>
      </div>
      <div style="height:8px;background:#f1e6f1;border-radius:999px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${barCol};border-radius:999px"></div></div>
    </div>
    <div id="menu-wg-plats" style="${folded ? 'display:none' : ''}">${blocks}</div>
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
// IMPORT PHOTO MENU (caméra / galerie → OCR → validation)
// ════════════════════════════════════════════════════
let _menuPhotoDraft = null; // { type, days:[{date, services:{midi:[],gouter:[],soir:[]}}] } après corrections UI

/** Heuristique catégorie pour Midi/Soir (sans Pains). */
function guessMenuCat(nom){
  const s = String(nom||'').toLowerCase();
  if(/\b(potage|soupe|velouté|veloute|consommé|consomme|bouillon)\b/.test(s)) return 'entrees';
  if(/\b(vinaigrette|crudité|crudite|salade|râpé|rape|mimosa|terrine|mousse de|oeuf|œuf|céleri|celeri|carotte|betterave|endive|concombre|macédoine|macedoine|piémontaise|piemontaise)\b/.test(s)) return 'entrees';
  if(/\b(fromage|laitage|produit laitier|plateaux? de produit)\b/.test(s)) return 'fromages';
  if(/\b(dessert|yaourt|compote|fruit|farandole|éclair|eclair|entremets|liégeois|liegeois|cake|riz au lait|semoule au lait|spécialité|specialite|salade de fruits)\b/.test(s)) return 'desserts';
  if(/\b(riz|pâtes?|pates?|frites|semoule|légume|legume|haricot|chou|carotte|pomme de terre|garniture|purée|puree|polenta|boulgour|quinoa|courgette|brocoli|épinard|epinard|romanesco)\b/.test(s)
     && !/\b(rôti|roti|escalope|filet|steak|poulet|porc|veau|agneau|poisson|saumon|colin|jambon|curry|bourguignon|blanquette|kefta|tourte|poêlée|poelee|sauté|saute)\b/.test(s)){
    return 'garnitures';
  }
  return 'plats';
}

function _menuPhotoMakePlat(nom){
  const n = String(nom||'').replace(/\s+/g,' ').trim();
  if(!n) return null;
  const profil = detectProfil(n);
  return {
    plat_id: newUUID().slice(0,8),
    nom: n,
    profil_haccp: profil,
    composants: [],
    allergenes: [],
    statut_auto: null,
    variants: {},
  };
}

function _menuPhotoCloseOv(){
  const ov = document.getElementById('mn-photo-ov');
  if(ov) ov.remove();
}

function _menuPhotoShowLoading(msg){
  _menuPhotoCloseOv();
  const ov = document.createElement('div');
  ov.id = 'mn-photo-ov';
  ov.className = 'hacc-wait-ov';
  const title = msg || 'Préparation du menu…';
  ov.innerHTML = `<div class="hacc-wait-card" role="status" aria-live="polite">
    <div class="hacc-wait-top">
      <div class="hacc-wait-icon-wrap">
        <div class="hacc-wait-spin" aria-hidden="true"></div>
        <div class="hacc-wait-icon">🍽️</div>
      </div>
      <div class="hacc-wait-title">${escH(title)}</div>
    </div>
    <div class="hacc-wait-sub">Rien n’est enregistré pour l’instant</div>
  </div>`;
  document.body.appendChild(ov);
}

window._menuPhotoPick = function(mode){
  try {
    const id = mode === 'camera' ? 'mn-photo-cam' : 'mn-photo-gal';
    const el = document.getElementById(id);
    if(!el){ if(typeof toast==='function') toast('Sélecteur photo indisponible','warning'); return; }
    el.value = '';
    el.click();
  } catch(e){ console.warn('[menu photo pick]', e); }
};

window._menuPhotoOnFile = function(input){
  try {
    const file = input && input.files && input.files[0];
    if(!file) return;
    if(!/^image\//.test(file.type||'')){
      if(typeof toast==='function') toast('Fichier image requis','warning');
      return;
    }
    // Fichier brut accepté jusqu'à 20 Mo : compressé avant envoi (_menuPhotoRunOcr)
    if(file.size > 20*1024*1024){
      if(typeof toast==='function') toast('Photo trop lourde (max 20 Mo)','warning');
      return;
    }
    _menuPhotoShowLoading('Préparation du menu…');
    const reader = new FileReader();
    reader.onerror = function(){
      _menuPhotoCloseOv();
      if(typeof toast==='function') toast('Lecture photo impossible','danger');
    };
    reader.onload = function(){
      const dataUrl = String(reader.result||'');
      if(!dataUrl.startsWith('data:image/')){
        _menuPhotoCloseOv();
        if(typeof toast==='function') toast('Image invalide','danger');
        return;
      }
      _menuPhotoRunOcr(dataUrl);
    };
    reader.readAsDataURL(file);
  } catch(e){
    console.warn('[menu photo file]', e);
    _menuPhotoCloseOv();
  }
};

async function _menuPhotoRunOcr(dataUrl){
  _menuPhotoShowLoading('Préparation du menu…');
  try {
    // Compression avant envoi (serveur : max ~2 Mo encodés) — côté max 2000 px (texte dense)
    try {
      if(typeof _ocrCompressForUpload === 'function') dataUrl = await _ocrCompressForUpload(dataUrl, { maxSide: 2000 });
    } catch(e){ console.warn('[menu-ocr compress]', e); }
    if(String(dataUrl||'').length > 2400000){
      _menuPhotoCloseOv();
      if(typeof toast==='function') toast('Image trop volumineuse même compressée — recadrez ou reprenez la photo','warning');
      return;
    }
    const resp = await fetch('/.netlify/functions/menu-ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl }),
    });
    let data = null;
    try { data = await resp.json(); } catch(e){ data = null; }
    if(!resp.ok){
      _menuPhotoCloseOv();
      const err = (data && data.error) || ('Analyse impossible ('+resp.status+')');
      const hint = data && data.hint ? '\n'+data.hint : '';
      if(typeof toast==='function') toast(String(err).replace(/OCR/gi,'Analyse'), 'danger');
      console.warn('[menu-ocr]', err, hint, data);
      // Écran d’aide si stub (clé manquante)
      if(data && data.stub){
        _menuPhotoShowStubHelp(data);
      }
      return;
    }
    if(!data || !Array.isArray(data.days) || !data.days.length){
      _menuPhotoCloseOv();
      if(typeof toast==='function') toast('Aucun plat détecté sur la photo','warning');
      return;
    }
    _menuPhotoDraft = {
      type: data.type === 'semaine' ? 'semaine' : 'jour',
      days: data.days.map(function(d){
        const svc = (d && d.services) || {};
        return {
          date: String(d.date||'').slice(0,10),
          services: {
            midi: (svc.midi||[]).slice(),
            gouter: (svc.gouter||[]).slice(),
            soir: (svc.soir||[]).slice(),
          },
        };
      }),
    };
    _menuPhotoShowValidation();
  } catch(e){
    console.warn('[menu-ocr fetch]', e);
    _menuPhotoCloseOv();
    if(typeof toast==='function') toast('Analyse photo indisponible (réseau)','danger');
  }
}

function _menuPhotoShowStubHelp(data){
  _menuPhotoCloseOv();
  const ov = document.createElement('div');
  ov.id = 'mn-photo-ov';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9200;display:flex;align-items:flex-end;justify-content:center';
  ov.innerHTML = `<div style="background:#fff;border-radius:18px 18px 0 0;width:100%;max-width:520px;padding:16px 14px 22px">
    <div style="font-size:.95rem;font-weight:900;color:#5C1E5A;margin-bottom:6px">Analyse photo non configurée</div>
    <div style="font-size:.8rem;color:#3b1e3b;line-height:1.45;margin-bottom:12px">
      L’analyse de photo n’est pas encore activée sur ce serveur.
      Contactez le responsable technique Hacc.Pro (clé API manquante).
      Aucun secret n’est stocké dans le dépôt.
    </div>
    <button type="button" id="mn-photo-stub-ok" style="width:100%;padding:12px;background:#5C1E5A;color:#fff;border:none;border-radius:12px;font-weight:800;font-family:inherit;cursor:pointer">Compris</button>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', function(e){ if(e.target===ov) ov.remove(); });
  document.getElementById('mn-photo-stub-ok').onclick = function(){ ov.remove(); };
}

function _menuPhotoSvcLabel(id){
  if(id==='midi') return '🌞 Midi';
  if(id==='soir') return '🌙 Soir';
  if(id==='gouter') return '🍪 Goûter';
  return id;
}

function _menuPhotoRenderDraftHtml(){
  const draft = _menuPhotoDraft;
  if(!draft) return '<div class="mn-empty">Aucune détection</div>';
  const typeLab = draft.type === 'semaine' ? 'Trame semaine' : 'Menu du jour';
  let html = `<div style="font-size:.72rem;font-weight:800;color:#7A6579;margin-bottom:10px;text-transform:uppercase;letter-spacing:.3px">${escH(typeLab)} — corrigez avant Valider</div>`;
  draft.days.forEach(function(day, di){
    html += `<div style="background:#f7f2f7;border:1.5px solid #ede0ed;border-radius:12px;padding:10px;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
        <span style="font-size:.85rem;font-weight:900;color:#5C1E5A">📅</span>
        <input type="date" value="${escH(day.date||'')}" onchange="window._menuPhotoSetDate(${di},this.value)"
          style="border:1.5px solid #d8b4d8;border-radius:9px;padding:6px 8px;font-family:inherit;font-weight:800;color:#5C1E5A;background:#fff">
      </div>`;
    ['midi','gouter','soir'].forEach(function(svc){
      const items = (day.services && day.services[svc]) || [];
      html += `<div style="margin-top:8px">
        <div style="font-size:.78rem;font-weight:900;color:#5C1E5A;margin-bottom:4px">${_menuPhotoSvcLabel(svc)}
          <span style="font-size:.65rem;font-weight:700;color:#b89ab6;margin-left:6px">${items.length}</span>
        </div>`;
      if(!items.length){
        html += `<div style="font-size:.72rem;color:#b89ab6;font-style:italic;margin-bottom:4px">Aucun plat</div>`;
      }
      items.forEach(function(nom, pi){
        const catHint = svc === 'gouter' ? 'libre' : guessMenuCat(nom);
        html += `<div style="display:flex;gap:5px;align-items:center;margin-bottom:4px">
          <input type="text" value="${escH(nom)}" onchange="window._menuPhotoEditPlat(${di},'${svc}',${pi},this.value)"
            style="flex:1;min-width:0;border:1.5px solid #ddd0dd;border-radius:8px;padding:7px 8px;font-size:.8rem;font-family:inherit;background:#fff">
          ${svc==='gouter' ? '<span style="font-size:.62rem;color:#7A6579;font-weight:800">liste</span>'
            : `<span style="font-size:.58rem;color:#7A6579;font-weight:700;max-width:70px;overflow:hidden;text-overflow:ellipsis" title="${escH(catHint)}">${escH(catHint)}</span>`}
          <button type="button" onclick="window._menuPhotoRemovePlat(${di},'${svc}',${pi})"
            style="background:#fee2e2;color:#dc2626;border:1.5px solid #fca5a5;border-radius:8px;padding:5px 7px;font-size:.7rem;font-weight:800;cursor:pointer;font-family:inherit">✕</button>
        </div>`;
      });
      html += `<button type="button" onclick="window._menuPhotoAddPlat(${di},'${svc}')"
        style="margin-top:2px;background:#fff;border:1.5px dashed #d8b4d8;color:#5C1E5A;border-radius:8px;padding:6px 8px;font-size:.72rem;font-weight:800;cursor:pointer;font-family:inherit;width:100%">+ Ajouter</button>
      </div>`;
    });
    html += `</div>`;
  });
  return html;
}

function _menuPhotoShowValidation(){
  _menuPhotoCloseOv();
  const ov = document.createElement('div');
  ov.id = 'mn-photo-ov';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9200;display:flex;align-items:flex-end;justify-content:center';
  ov.innerHTML = `<div style="background:#fff;border-radius:18px 18px 0 0;width:100%;max-width:560px;max-height:92vh;display:flex;flex-direction:column">
    <div style="padding:14px 14px 8px;border-bottom:1px solid #f1e6f1;flex-shrink:0">
      <div style="font-size:.95rem;font-weight:900;color:#5C1E5A">📸 Validation import photo</div>
      <div style="font-size:.72rem;color:#7A6579;margin-top:3px">Coches / ratures ignorées. Aucune fiche traça auto à la validation.</div>
    </div>
    <div id="mn-photo-draft-body" style="padding:10px 14px;overflow:auto;flex:1;-webkit-overflow-scrolling:touch">${_menuPhotoRenderDraftHtml()}</div>
    <div style="padding:10px 14px 18px;display:flex;gap:8px;flex-shrink:0;border-top:1px solid #f1e6f1">
      <button type="button" id="mn-photo-cancel" style="flex:1;padding:13px;background:#f3e8f3;color:#5C1E5A;border:none;border-radius:12px;font-weight:800;font-family:inherit;cursor:pointer">Annuler</button>
      <button type="button" id="mn-photo-validate" style="flex:2;padding:13px;background:linear-gradient(135deg,#5C1E5A,#C93A78);color:#fff;border:none;border-radius:12px;font-weight:800;font-family:inherit;cursor:pointer;box-shadow:0 3px 10px rgba(92,30,90,.3)">✅ Valider</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', function(e){ if(e.target===ov){ ov.remove(); _menuPhotoDraft=null; } });
  document.getElementById('mn-photo-cancel').onclick = function(){ ov.remove(); _menuPhotoDraft=null; };
  document.getElementById('mn-photo-validate').onclick = function(){ window._menuPhotoValidate(); };
}

function _menuPhotoRefreshValidationBody(){
  const body = document.getElementById('mn-photo-draft-body');
  if(body) body.innerHTML = _menuPhotoRenderDraftHtml();
}

window._menuPhotoSetDate = function(di, val){
  try {
    if(!_menuPhotoDraft || !_menuPhotoDraft.days[di]) return;
    _menuPhotoDraft.days[di].date = String(val||'').slice(0,10);
  } catch(e){}
};

window._menuPhotoEditPlat = function(di, svc, pi, val){
  try {
    const day = _menuPhotoDraft && _menuPhotoDraft.days[di];
    if(!day || !day.services[svc]) return;
    day.services[svc][pi] = String(val||'').trim();
  } catch(e){}
};

window._menuPhotoRemovePlat = function(di, svc, pi){
  try {
    const day = _menuPhotoDraft && _menuPhotoDraft.days[di];
    if(!day || !day.services[svc]) return;
    day.services[svc].splice(pi, 1);
    _menuPhotoRefreshValidationBody();
  } catch(e){}
};

window._menuPhotoAddPlat = function(di, svc){
  try {
    const day = _menuPhotoDraft && _menuPhotoDraft.days[di];
    if(!day) return;
    if(!day.services[svc]) day.services[svc] = [];
    day.services[svc].push('Nouveau plat');
    _menuPhotoRefreshValidationBody();
  } catch(e){}
};

/** Nb de plats déjà saisis dans un menu existant (toutes catégories, y.c. libre). */
function _menuPhotoCountExisting(date, svc){
  try {
    const menu = getMenu(date, svc);
    if(!menu || !menu.categories) return 0;
    let n = 0;
    Object.keys(menu.categories).forEach(function(k){
      const arr = menu.categories[k];
      if(Array.isArray(arr)) n += arr.filter(function(p){ return p && String(p.nom||'').trim(); }).length;
    });
    return n;
  } catch(e){ return 0; }
}

/** Liste des (jour, service) du brouillon qui écraseraient un menu déjà saisi. */
function _menuPhotoFindConflicts(draft){
  const out = [];
  const seen = {};
  (draft && draft.days || []).forEach(function(day){
    const date = String(day.date||'').slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    ['midi','gouter','soir'].forEach(function(svc){
      const names = ((day.services && day.services[svc]) || [])
        .map(function(n){ return String(n||'').trim(); }).filter(Boolean);
      if(!names.length) return; // service vide dans l’import = non touché
      const k = date+'::'+svc;
      if(seen[k]) return;
      seen[k] = true;
      const n = _menuPhotoCountExisting(date, svc);
      if(n > 0) out.push({ date: date, svc: svc, count: n });
    });
  });
  return out;
}

/** Confirmation remplacement (overlay au-dessus de l’écran de validation — pas de confirm() natif, bloqué sous Android). */
function _menuPhotoAskReplace(conflicts, onYes){
  const old = document.getElementById('mn-photo-confirm');
  if(old) old.remove();
  const ov = document.createElement('div');
  ov.id = 'mn-photo-confirm';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(30,10,30,.6);z-index:9300;display:flex;align-items:center;justify-content:center;padding:18px';
  const lines = conflicts.map(function(c){
    let dl = c.date;
    try { dl = new Date(c.date+'T12:00').toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' }); } catch(e){}
    return `<li style="margin:3px 0"><b>${escH(dl)}</b> — ${escH(_menuPhotoSvcLabel(c.svc))} <span style="color:#7A6579">(${c.count} plat${c.count>1?'s':''})</span></li>`;
  }).join('');
  const plural = conflicts.length > 1;
  ov.innerHTML = `<div role="alertdialog" aria-modal="true" aria-labelledby="mn-photo-confirm-t" style="background:#fff;border-radius:18px;max-width:380px;width:100%;padding:18px 16px 16px;box-shadow:0 10px 30px rgba(0,0,0,.25)">
    <div id="mn-photo-confirm-t" style="font-size:.98rem;font-weight:900;color:#5C1E5A;margin-bottom:6px">⚠️ Ça remplace le menu déjà saisi</div>
    <div style="font-size:.8rem;color:#3b1e3b;line-height:1.45">
      ${plural ? 'Ces services ont' : 'Ce service a'} déjà des plats :
      <ul style="margin:6px 0 8px;padding-left:18px">${lines}</ul>
      Les plats existants seront <b>remplacés</b> par ceux de la photo (pas de fusion). Les autres services ne sont pas touchés.
    </div>
    <div style="display:flex;gap:8px;margin-top:14px">
      <button type="button" id="mn-photo-confirm-no" style="flex:1;padding:12px;background:#f3e8f3;color:#5C1E5A;border:none;border-radius:12px;font-weight:800;font-family:inherit;cursor:pointer">Annuler</button>
      <button type="button" id="mn-photo-confirm-yes" style="flex:1.4;padding:12px;background:#dc2626;color:#fff;border:none;border-radius:12px;font-weight:800;font-family:inherit;cursor:pointer">Remplacer</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  const close = function(){ ov.remove(); };
  ov.addEventListener('click', function(e){ if(e.target===ov) close(); });
  document.getElementById('mn-photo-confirm-no').onclick = close;
  document.getElementById('mn-photo-confirm-yes').onclick = function(){ close(); onYes(); };
}

/** Valider : confirmation si des services cibles ont déjà des plats, puis écriture. */
window._menuPhotoValidate = function(){
  try {
    const draft = _menuPhotoDraft;
    if(!draft || !draft.days || !draft.days.length){
      if(typeof toast==='function') toast('Rien à enregistrer','warning');
      return;
    }
    const conflicts = _menuPhotoFindConflicts(draft);
    if(conflicts.length){
      _menuPhotoAskReplace(conflicts, function(){ _menuPhotoCommit(); });
      return;
    }
    _menuPhotoCommit();
  } catch(e){
    console.warn('[menu photo validate]', e);
    if(typeof toast==='function') toast('Erreur enregistrement import','danger');
  }
};

/** Écrit dans le store menu existant (remplacement, pas de merge en v1). AUCUNE fiche traça auto. */
function _menuPhotoCommit(){
  try {
    const draft = _menuPhotoDraft;
    if(!draft || !draft.days || !draft.days.length){
      if(typeof toast==='function') toast('Rien à enregistrer','warning');
      return;
    }
    let written = 0;
    let firstDate = '';
    draft.days.forEach(function(day){
      const date = String(day.date||'').slice(0,10);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      if(!firstDate) firstDate = date;
      ['midi','gouter','soir'].forEach(function(svc){
        const names = ((day.services && day.services[svc]) || [])
          .map(function(n){ return String(n||'').replace(/\s+/g,' ').trim(); })
          .filter(Boolean);
        if(!names.length) return;
        const menu = ensureMenuFor(date, svc);
        const cats = emptyCategories();
        if(svc === 'gouter'){
          names.forEach(function(nom){
            const p = _menuPhotoMakePlat(nom);
            if(p) cats.libre.push(p);
          });
        } else {
          names.forEach(function(nom){
            const p = _menuPhotoMakePlat(nom);
            if(!p) return;
            const cat = guessMenuCat(nom);
            if(!cats[cat]) cats[cat] = [];
            cats[cat].push(p);
          });
        }
        menu.categories = cats;
        if(!menu.menu_id) menu.menu_id = newUUID();
        // Copie éditable dans le store — PAS d'appel _menuSave / _menuAutoOnSave
        setMenu(date, svc, menu);
        written++;
      });
    });
    _menuPhotoDraft = null;
    _menuPhotoCloseOv();
    if(firstDate){
      _menuState.date = firstDate;
      try {
        const d0 = new Date(firstDate+'T12:00');
        _menuState.calY = d0.getFullYear();
        _menuState.calM = d0.getMonth();
      } catch(e){}
      _menuState.openServices = { midi: true, soir: true, gouter: true };
    }
    if(typeof renderMain === 'function') renderMain();
    if(typeof renderNav === 'function') renderNav();
    if(typeof toast==='function'){
      toast(written ? ('✅ '+written+' service(s) importé(s) — pastilles à jour') : 'Aucun service rempli', written ? 'success' : 'warning');
    }
  } catch(e){
    console.warn('[menu photo commit]', e);
    if(typeof toast==='function') toast('Erreur enregistrement import','danger');
  }
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
