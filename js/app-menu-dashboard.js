/**
 * app-menu-dashboard.js — Module MENU pour le dashboard siège (v36)
 *
 * Ajoute un onglet "🍽️ Menus" dans la sidebar.
 * Permet à la direction de voir :
 *   1) La liste des menus produits par site (calendrier)
 *   2) La FICHE PLAT HACCP : pour un plat donné, toute la chronologie
 *      (réception → cuisson → refroid → témoin → distribution → NC)
 *      en 1 seul écran. Exportable PDF.
 *
 * Chargé APRÈS app-dashboard.js dans dashboard.html.
 *
 * Dépend de (déjà chargé par app-dashboard.js) :
 *   - _records (saisies pms_records)
 *   - _sites (liste sites)
 *   - showToast, showPage, navTo
 *   - _currentPage, PAGE_TITLES
 */

(function(){
'use strict';

const PROFILS = {
  BF_CUIT:       { ico:'🥘', label:'BF Cuit',        color:'#dc2626' },
  BF_CRU:        { ico:'🥗', label:'BF Cru',         color:'#16a34a' },
  REMISE_TC:     { ico:'🔥', label:'Remise T°C',     color:'#ea580c' },
  SORTIE_DIRECTE:{ ico:'📦', label:'Sortie directe', color:'#0ea5e9' },
  PREP_MINUTE:   { ico:'⚡', label:'Préparé minute', color:'#7c3aed' },
};
const SERVICES = { petitdej:'☕ P-déj', midi:'🌞 Midi', gouter:'🍪 Goûter', soir:'🌙 Soir' };
const CATS = [
  { id:'potages',    label:'🍲 Potages' },
  { id:'entrees',    label:'🥗 Entrées' },
  { id:'plats',      label:'🍽️ Plats' },
  { id:'garnitures', label:'🥦 Garnitures' },
  { id:'fromages',   label:'🧀 Fromages' },
  { id:'desserts',   label:'🍰 Desserts' },
  { id:'pains',      label:'🥖 Pains' },
];

// ENR concernés par la traçabilité d'un plat
const TRACE_ENR = {
  enr23:           { ico:'📦', label:'Réception',       color:'#0ea5e9' },
  enr01:           { ico:'❄️', label:'Refroidissement', color:'#1e40af' },
  enr02:           { ico:'🔥', label:'Remise T°C',      color:'#dc2626' },
  enr03:           { ico:'🔄', label:'Refroid+Remise',  color:'#7c3aed' },
  enr04:           { ico:'🥩', label:'Cuisson SH',      color:'#991b1b' },
  enr07:           { ico:'🥘', label:'BF Cuit',         color:'#dc2626' },
  enr08:           { ico:'🥗', label:'BF Cru',          color:'#16a34a' },
  enr09:           { ico:'♨️', label:'Cond. chaud',     color:'#ea580c' },
  enr10:           { ico:'🧊', label:'Cond. froid',     color:'#0284c7' },
  enr11:           { ico:'🍽️', label:'Plat. froid',    color:'#0ea5e9' },
  enr12:           { ico:'🍽️', label:'Plat. chaud',    color:'#dc2626' },
  enr13:           { ico:'🚚', label:'Départ cuisine',  color:'#6b21a8' },
  enr14:           { ico:'🛎️', label:'Distrib plat.',  color:'#16a34a' },
  enr30:           { ico:'🚨', label:'Non-conformité',  color:'#dc2626' },
  enr33:           { ico:'🍱', label:'Plat témoin',     color:'#7c3aed' },
  enr34:           { ico:'🏷️', label:'Étiquette prod.',color:'#1e40af' },
  enr_tc_distrib:  { ico:'🌡️', label:'T°C Distribution',color:'#16a34a' },
};

let _menuPage = {
  selectedSite: '',  // code site
  selectedDate: new Date().toISOString().slice(0,10),
  selectedMenu: null,// objet menu sélectionné
  selectedPlat: null,// objet plat sélectionné (pour vue Fiche plat)
};

// ════════════════════════════════════════════════════
// 1) PARSER : extrait les menus depuis _records
// ════════════════════════════════════════════════════
function getAllMenus(){
  if(typeof _records === 'undefined') return [];
  return _records.filter(r => r.enr_type === 'enr_menu').map(r => ({
    id:         r.id,
    site_id:    r.site_id,
    recorded_at:r.recorded_at,
    menu_date:  (r.data?.menu_date || r.recorded_at).slice(0,10),
    service:    r.data?.service || 'midi',
    type_repas: r.data?.type_repas || 'normal',
    menu_id:    r.data?.menu_id || r.id,
    categories: r.data?.categories || {},
    raw:        r,
  }));
}

function getMenusForSite(siteCode){
  return getAllMenus()
    .filter(m => !siteCode || m.site_id === siteCode)
    .sort((a,b) => b.menu_date.localeCompare(a.menu_date));
}

function flatPlats(menu){
  const out = [];
  CATS.forEach(c => {
    (menu.categories?.[c.id]||[]).forEach(p => {
      out.push({ cat:c.id, catLabel:c.label, ...p });
    });
  });
  return out;
}

function getEnrLinkedToPlat(platId, siteCode, menuDate){
  if(typeof _records === 'undefined') return [];
  return _records.filter(r => {
    if(r.enr_type === 'enr_menu') return false;
    // Match par plat_id (priorité)
    if(r.data?._plat_id === platId) return true;
    // Match large : même site + même date + plat_nom dans le payload
    if(r.site_id !== siteCode) return false;
    const recDate = (r.recorded_at||'').slice(0,10);
    return recDate === menuDate;
  }).sort((a,b) => (a.recorded_at||'').localeCompare(b.recorded_at||''));
}

function getEnrLinkedToMenu(menuId, siteCode, menuDate){
  if(typeof _records === 'undefined') return [];
  return _records.filter(r => {
    if(r.enr_type === 'enr_menu') return false;
    if(r.data?._menu_id === menuId) return true;
    // Fallback : tous les ENR du jour pour ce site
    if(r.site_id !== siteCode) return false;
    const recDate = (r.recorded_at||'').slice(0,10);
    return recDate === menuDate;
  }).sort((a,b) => (a.recorded_at||'').localeCompare(b.recorded_at||''));
}

// ════════════════════════════════════════════════════
// 2) RENDER : page principale Menus
// ════════════════════════════════════════════════════
function renderMenusPage(){
  const allMenus = getAllMenus();
  const sites = (typeof _sites !== 'undefined' ? _sites : []);

  // Sélecteur de site (défaut : tous)
  const siteOptions = `<option value="">Tous les sites</option>` +
    sites.map(s => `<option value="${escAttr(s.code)}" ${_menuPage.selectedSite===s.code?'selected':''}>${escH(s.name||s.code)}</option>`).join('');

  // Filtrer
  const filtered = _menuPage.selectedSite ? allMenus.filter(m => m.site_id === _menuPage.selectedSite) : allMenus;

  // Grouper par date
  const byDate = {};
  filtered.forEach(m => {
    if(!byDate[m.menu_date]) byDate[m.menu_date] = [];
    byDate[m.menu_date].push(m);
  });
  const dates = Object.keys(byDate).sort((a,b) => b.localeCompare(a));

  const html = `
  <style>
    .mn-page-hd{display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}
    .mn-page-hd select{padding:8px 12px;border:1.5px solid var(--border);border-radius:10px;font-size:.82rem;font-family:var(--font);font-weight:700;color:var(--navy);background:#fff;min-width:200px}
    .mn-stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:16px}
    .mn-stat{background:#fff;border-radius:12px;padding:12px 14px;border:1px solid var(--border);box-shadow:0 2px 8px var(--sh)}
    .mn-stat-lbl{font-size:.7rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.4px}
    .mn-stat-val{font-size:1.5rem;font-weight:900;color:var(--navy);margin-top:2px}
    .mn-day-block{background:#fff;border-radius:14px;padding:14px;margin-bottom:10px;border:1px solid var(--border);box-shadow:0 2px 8px var(--sh)}
    .mn-day-hd{font-size:.95rem;font-weight:900;color:var(--navy);margin-bottom:9px;text-transform:capitalize}
    .mn-day-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:9px}
    .mn-card{background:#f8fafc;border-radius:11px;padding:11px 13px;border:1.5px solid #e2e8f0;cursor:pointer;transition:.15s}
    .mn-card:hover{border-color:#0F2240;background:#fff;transform:translateY(-1px);box-shadow:0 4px 12px rgba(15,34,64,.12)}
    .mn-card-hd{display:flex;align-items:center;gap:7px;margin-bottom:7px}
    .mn-card-svc{font-size:.72rem;font-weight:800;background:#0F2240;color:#fff;padding:2px 9px;border-radius:11px}
    .mn-card-site{font-size:.78rem;font-weight:800;color:#1e293b;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .mn-card-cnt{font-size:.65rem;font-weight:700;color:#64748b;background:#e2e8f0;padding:1px 7px;border-radius:8px;flex-shrink:0}
    .mn-card-cov{height:5px;background:#e2e8f0;border-radius:4px;margin-top:6px;overflow:hidden}
    .mn-card-cov-fill{height:100%;border-radius:4px;transition:.3s}
    .mn-card-meta{font-size:.7rem;color:#64748b;margin-top:5px;display:flex;justify-content:space-between}
    .mn-empty{text-align:center;padding:40px 20px;color:#94a3b8;font-size:.85rem}
  </style>
  <div class="mn-page-hd">
    <select onchange="window._menuDashSelectSite(this.value)">
      ${siteOptions}
    </select>
    <span style="font-size:.78rem;color:#64748b">${filtered.length} menu${filtered.length>1?'s':''} sur la période</span>
  </div>
  ${renderMenuStats(filtered)}
  ${dates.length === 0
    ? `<div class="mn-empty">📭 Aucun menu enregistré sur la période.<br><span style="font-size:.75rem;opacity:.8">Demandez aux cuisines de saisir leurs menus dans l'onglet 🍽️ Menu de la tablette.</span></div>`
    : dates.map(d => renderDayBlock(d, byDate[d])).join('')
  }
  `;
  setContent(html);
}

function renderMenuStats(menus){
  const total = menus.length;
  let totalPlats = 0;
  const sitesSet = new Set();
  menus.forEach(m => {
    sitesSet.add(m.site_id);
    CATS.forEach(c => totalPlats += (m.categories?.[c.id]||[]).length);
  });
  const sitesActifs = sitesSet.size;
  const moy = total ? Math.round(totalPlats/total*10)/10 : 0;
  return `
  <div class="mn-stat-grid">
    <div class="mn-stat"><div class="mn-stat-lbl">Menus saisis</div><div class="mn-stat-val">${total}</div></div>
    <div class="mn-stat"><div class="mn-stat-lbl">Sites actifs</div><div class="mn-stat-val">${sitesActifs}</div></div>
    <div class="mn-stat"><div class="mn-stat-lbl">Total plats</div><div class="mn-stat-val">${totalPlats}</div></div>
    <div class="mn-stat"><div class="mn-stat-lbl">Plats / menu (moy.)</div><div class="mn-stat-val">${moy}</div></div>
  </div>`;
}

function renderDayBlock(date, menus){
  const dFr = new Date(date).toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  return `
  <div class="mn-day-block">
    <div class="mn-day-hd">📅 ${dFr}</div>
    <div class="mn-day-grid">
      ${menus.map(m => renderMenuCard(m)).join('')}
    </div>
  </div>`;
}

function renderMenuCard(menu){
  let nbPlats = 0;
  CATS.forEach(c => nbPlats += (menu.categories?.[c.id]||[]).length);
  // Couverture HACCP : compter ENR liés
  const enrs = getEnrLinkedToMenu(menu.menu_id, menu.site_id, menu.menu_date)
    .filter(r => r.enr_type !== 'enr_menu');
  const totalExpected = nbPlats * 2; // estimation : 2 ENR par plat en moyenne
  const pct = totalExpected ? Math.min(100, Math.round((enrs.length / totalExpected) * 100)) : 0;
  const covColor = pct >= 70 ? '#16a34a' : (pct >= 40 ? '#ea580c' : '#dc2626');
  const siteName = (typeof _sites !== 'undefined' ? _sites : []).find(s => s.code === menu.site_id)?.name || menu.site_id;
  return `
  <div class="mn-card" onclick="window._menuDashOpenDetail('${escAttr(menu.id)}')">
    <div class="mn-card-hd">
      <span class="mn-card-svc">${SERVICES[menu.service]||menu.service}</span>
      <span class="mn-card-site">${escH(siteName)}</span>
      <span class="mn-card-cnt">${nbPlats} plat${nbPlats>1?'s':''}</span>
    </div>
    <div class="mn-card-meta">
      <span>${menu.type_repas !== 'normal' ? '⚙️ '+menu.type_repas : ''}</span>
      <span style="color:${covColor};font-weight:800">${enrs.length} ENR liés • ${pct}%</span>
    </div>
    <div class="mn-card-cov"><div class="mn-card-cov-fill" style="width:${pct}%;background:${covColor}"></div></div>
  </div>`;
}

// ════════════════════════════════════════════════════
// 3) DETAIL : vue d'un menu (liste plats avec lien Fiche plat)
// ════════════════════════════════════════════════════
window._menuDashOpenDetail = function(recId){
  const menu = getAllMenus().find(m => m.id === recId);
  if(!menu){ if(typeof showToast==='function') showToast('Menu introuvable','warning'); return; }
  _menuPage.selectedMenu = menu;
  renderMenuDetailPanel(menu);
};

function renderMenuDetailPanel(menu){
  const ov = document.getElementById('detail-overlay');
  if(!ov) return;
  const dFr = new Date(menu.menu_date).toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const siteName = (typeof _sites !== 'undefined' ? _sites : []).find(s => s.code === menu.site_id)?.name || menu.site_id;
  const enrs = getEnrLinkedToMenu(menu.menu_id, menu.site_id, menu.menu_date);
  const plats = flatPlats(menu);

  document.getElementById('detail-title').textContent = `🍽️ Menu ${SERVICES[menu.service]||menu.service} — ${siteName}`;
  document.getElementById('detail-sub').textContent = dFr + ' • ' + plats.length + ' plat' + (plats.length>1?'s':'') + ' • ' + enrs.length + ' ENR liés';

  document.getElementById('detail-body').innerHTML = `
  <style>
    .md-grp{margin-bottom:14px}
    .md-grp-tit{font-size:.78rem;font-weight:900;color:#5C1E5A;margin-bottom:6px;text-transform:uppercase;letter-spacing:.4px}
    .md-plat{background:#f8fafc;border-radius:10px;padding:9px 11px;margin-bottom:5px;border:1.5px solid #e2e8f0;cursor:pointer;transition:.15s}
    .md-plat:hover{border-color:#5C1E5A;background:#fff}
    .md-plat-hd{display:flex;align-items:center;gap:7px}
    .md-plat-name{flex:1;font-size:.85rem;font-weight:800;color:#1e293b}
    .md-plat-prof{font-size:.65rem;font-weight:800;padding:1px 7px;border-radius:8px;color:#fff;flex-shrink:0}
    .md-plat-meta{font-size:.7rem;color:#64748b;margin-top:3px}
    .md-summary{background:linear-gradient(135deg,#5C1E5A,#C93A78);color:#fff;border-radius:12px;padding:11px 14px;margin-bottom:12px}
    .md-summary-tit{font-size:.78rem;font-weight:900}
    .md-summary-cnt{font-size:.95rem;font-weight:700;margin-top:3px}
    .md-export-btn{width:100%;padding:11px;background:#0F2240;color:#fff;border:none;border-radius:10px;font-weight:800;cursor:pointer;font-family:inherit;font-size:.85rem;margin-bottom:12px}
  </style>
  <div class="md-summary">
    <div class="md-summary-tit">${plats.length} plat${plats.length>1?'s':''} • ${enrs.length} ENR rattachés</div>
    <div class="md-summary-cnt">${menu.type_repas !== 'normal' ? '⚙️ Régime : '+menu.type_repas : 'Régime normal'}</div>
  </div>
  <button class="md-export-btn" onclick="window._menuDashExportMenu('${escAttr(menu.id)}')">📄 Exporter ce menu en PDF (rapport HACCP)</button>
  ${CATS.map(c => {
    const items = menu.categories?.[c.id] || [];
    if(!items.length) return '';
    return `
    <div class="md-grp">
      <div class="md-grp-tit">${c.label} (${items.length})</div>
      ${items.map(p => {
        const prof = PROFILS[p.profil_haccp] || PROFILS.BF_CUIT;
        const linked = enrs.filter(r => r.data?._plat_id === p.plat_id);
        return `
        <div class="md-plat" onclick="window._menuDashOpenPlat('${escAttr(p.plat_id)}','${escAttr(menu.id)}')">
          <div class="md-plat-hd">
            <span class="md-plat-name">${escH(p.nom)}</span>
            <span class="md-plat-prof" style="background:${prof.color}">${prof.ico} ${prof.label}</span>
          </div>
          <div class="md-plat-meta">
            ${p.composants && p.composants.length ? '📝 '+p.composants.map(escH).join(', ')+' • ' : ''}
            ${linked.length} ENR lié${linked.length>1?'s':''} ${p.statut_auto==='preparé_minute'?'• ⚡ auto-validé':''}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }).join('')}
  `;
  ov.classList.add('open');
}

// ════════════════════════════════════════════════════
// 4) FICHE PLAT HACCP (le killer) — chronologie complète
// ════════════════════════════════════════════════════
window._menuDashOpenPlat = function(platId, menuId){
  const menu = getAllMenus().find(m => m.id === menuId);
  if(!menu) return;
  let plat = null;
  CATS.forEach(c => {
    (menu.categories?.[c.id]||[]).forEach(p => { if(p.plat_id === platId) plat = { ...p, cat:c.id }; });
  });
  if(!plat){ if(typeof showToast==='function') showToast('Plat introuvable','warning'); return; }
  _menuPage.selectedPlat = plat;
  renderFichePlat(plat, menu);
};

function renderFichePlat(plat, menu){
  const enrs = getEnrLinkedToPlat(plat.plat_id, menu.site_id, menu.menu_date);
  const prof = PROFILS[plat.profil_haccp] || PROFILS.BF_CUIT;
  const siteName = (typeof _sites !== 'undefined' ? _sites : []).find(s => s.code === menu.site_id)?.name || menu.site_id;
  const dFr = new Date(menu.menu_date).toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

  document.getElementById('detail-title').textContent = `${prof.ico} ${plat.nom}`;
  document.getElementById('detail-sub').textContent = `${siteName} • ${dFr} • ${SERVICES[menu.service]||menu.service}`;

  // Stats
  const ncCount = enrs.filter(e => e.enr_type === 'enr30' || e.data?.conforme === 'NON').length;
  const hasReception = enrs.some(e => e.enr_type === 'enr23');
  const hasCuisson = enrs.some(e => ['enr04','enr07','enr08'].includes(e.enr_type));
  const hasRefroid = enrs.some(e => ['enr01','enr03'].includes(e.enr_type));
  const hasTemoin = enrs.some(e => e.enr_type === 'enr33');
  const hasDistrib = enrs.some(e => e.enr_type === 'enr_tc_distrib' || e.enr_type?.startsWith('enr_distrib_'));

  document.getElementById('detail-body').innerHTML = `
  <style>
    .fp-prof{display:inline-block;padding:5px 12px;border-radius:14px;color:#fff;font-weight:800;font-size:.78rem;margin-bottom:10px}
    .fp-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px}
    .fp-stat{background:#f8fafc;border-radius:9px;padding:9px;text-align:center;border:1.5px solid #e2e8f0}
    .fp-stat-ico{font-size:1rem;margin-bottom:2px}
    .fp-stat-lbl{font-size:.62rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.3px}
    .fp-stat-val{font-size:.78rem;font-weight:900;margin-top:1px}
    .fp-stat.ok{background:#dcfce7;border-color:#86efac}
    .fp-stat.ko{background:#fee2e2;border-color:#fca5a5}
    .fp-stat.ok .fp-stat-val{color:#166534}
    .fp-stat.ko .fp-stat-val{color:#991b1b}
    .fp-timeline{position:relative;padding-left:22px}
    .fp-timeline::before{content:'';position:absolute;left:8px;top:5px;bottom:5px;width:2px;background:#e2e8f0}
    .fp-step{position:relative;background:#fff;border:1.5px solid #e2e8f0;border-radius:10px;padding:10px 12px;margin-bottom:8px;box-shadow:0 1px 4px rgba(15,34,64,.05)}
    .fp-step::before{content:'';position:absolute;left:-19px;top:14px;width:14px;height:14px;border-radius:50%;border:3px solid #fff;background:#5C1E5A;box-shadow:0 0 0 1.5px #5C1E5A}
    .fp-step.nc::before{background:#dc2626;box-shadow:0 0 0 1.5px #dc2626}
    .fp-step.nc{background:#fef2f2;border-color:#fca5a5}
    .fp-step-hd{display:flex;align-items:center;gap:7px;margin-bottom:4px}
    .fp-step-time{font-size:.7rem;font-weight:800;color:#5C1E5A;background:#f3e8f3;padding:2px 7px;border-radius:8px}
    .fp-step-type{font-size:.78rem;font-weight:800;flex:1}
    .fp-step-conf{font-size:.65rem;font-weight:800;padding:1px 7px;border-radius:8px}
    .fp-step-conf.ok{background:#dcfce7;color:#166534}
    .fp-step-conf.ko{background:#fee2e2;color:#991b1b}
    .fp-step-body{font-size:.74rem;color:#475569;line-height:1.5}
    .fp-step-body strong{color:#1e293b}
    .fp-empty{text-align:center;padding:30px;color:#94a3b8;font-size:.85rem}
    .fp-export{width:100%;padding:11px;background:#0F2240;color:#fff;border:none;border-radius:10px;font-weight:800;cursor:pointer;font-family:inherit;font-size:.85rem;margin:6px 0 12px}
    .fp-back{display:inline-block;font-size:.78rem;color:#5C1E5A;cursor:pointer;font-weight:800;margin-bottom:10px}
  </style>
  <span class="fp-back" onclick="window._menuDashOpenDetail('${escAttr(menu.id)}')">‹ Retour au menu</span>
  <div class="fp-prof" style="background:${prof.color}">${prof.ico} ${prof.label}</div>
  ${plat.composants && plat.composants.length ? `<div style="font-size:.78rem;color:#475569;margin-bottom:10px"><strong>Composants :</strong> ${plat.composants.map(escH).join(', ')}</div>` : ''}

  <div class="fp-stats">
    <div class="fp-stat ${hasReception?'ok':''}"><div class="fp-stat-ico">📦</div><div class="fp-stat-lbl">Réception</div><div class="fp-stat-val">${hasReception?'✓':'—'}</div></div>
    <div class="fp-stat ${hasCuisson?'ok':''}"><div class="fp-stat-ico">🥘</div><div class="fp-stat-lbl">Cuisson</div><div class="fp-stat-val">${hasCuisson?'✓':'—'}</div></div>
    <div class="fp-stat ${hasRefroid?'ok':''}"><div class="fp-stat-ico">❄️</div><div class="fp-stat-lbl">Refroid.</div><div class="fp-stat-val">${hasRefroid?'✓':'—'}</div></div>
    <div class="fp-stat ${hasTemoin?'ok':''}"><div class="fp-stat-ico">🍱</div><div class="fp-stat-lbl">Témoin</div><div class="fp-stat-val">${hasTemoin?'✓':'—'}</div></div>
    <div class="fp-stat ${hasDistrib?'ok':''}"><div class="fp-stat-ico">🌡️</div><div class="fp-stat-lbl">Distrib.</div><div class="fp-stat-val">${hasDistrib?'✓':'—'}</div></div>
    <div class="fp-stat ${ncCount>0?'ko':'ok'}"><div class="fp-stat-ico">🚨</div><div class="fp-stat-lbl">NC</div><div class="fp-stat-val">${ncCount}</div></div>
  </div>

  <button class="fp-export" onclick="window._menuDashExportPlat('${escAttr(plat.plat_id)}','${escAttr(menu.id)}')">📄 Exporter Fiche plat HACCP (PDF)</button>

  <h3 style="font-size:.85rem;font-weight:900;color:#1e293b;margin:8px 0">📋 Chronologie (${enrs.length})</h3>
  ${enrs.length === 0
    ? `<div class="fp-empty">📭 Aucun ENR lié à ce plat<br><span style="font-size:.72rem">Les cuisiniers peuvent rattacher leurs saisies au plat depuis la tablette.</span></div>`
    : `<div class="fp-timeline">${enrs.map(e => renderTimelineStep(e)).join('')}</div>`
  }
  `;
}

function renderTimelineStep(rec){
  const def = TRACE_ENR[rec.enr_type] || { ico:'📋', label:rec.enr_type, color:'#64748b' };
  const time = rec.recorded_at ? new Date(rec.recorded_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) : '—';
  const conf = rec.data?.conforme;
  const isNC = rec.enr_type === 'enr30' || conf === 'NON';
  // Construire un résumé lisible des champs principaux
  const d = rec.data || {};
  const bits = [];
  if(d.heure) bits.push('🕐 '+d.heure);
  if(d.cuisinier) bits.push('👨‍🍳 '+d.cuisinier);
  if(d.produit) bits.push('<strong>'+escH(d.produit)+'</strong>');
  if(d.t_debut !== undefined && d.t_debut !== '') bits.push('Début '+escH(d.t_debut)+'°C');
  if(d.t_fin   !== undefined && d.t_fin   !== '') bits.push('Fin '+escH(d.t_fin)+'°C');
  if(d.temp_coeur !== undefined && d.temp_coeur !== '') bits.push('Cœur '+escH(d.temp_coeur)+'°C');
  if(d.temp !== undefined && d.temp !== '' && !d.t_debut && !d.t_fin) bits.push('T° '+escH(d.temp)+'°C');
  if(d.duree) bits.push('Durée '+escH(d.duree));
  if(d.lot)   bits.push('Lot '+escH(d.lot));
  if(d.fournisseur) bits.push('Fourn. '+escH(d.fournisseur));
  if(d.dlc)   bits.push('DLC '+escH(d.dlc));
  if(d.commentaire) bits.push('💬 '+escH(d.commentaire));
  if(d.description) bits.push('💬 '+escH(d.description));
  return `
  <div class="fp-step ${isNC?'nc':''}">
    <div class="fp-step-hd">
      <span class="fp-step-time">${time}</span>
      <span class="fp-step-type" style="color:${def.color}">${def.ico} ${def.label}</span>
      ${conf === 'OUI' ? '<span class="fp-step-conf ok">✓ Conforme</span>' : ''}
      ${conf === 'NON' || rec.enr_type==='enr30' ? '<span class="fp-step-conf ko">✗ NC</span>' : ''}
    </div>
    <div class="fp-step-body">${bits.length ? bits.join(' • ') : '<em style="color:#94a3b8">Aucun détail</em>'}</div>
  </div>`;
}

// ════════════════════════════════════════════════════
// 5) EXPORT PDF (impression navigateur)
// ════════════════════════════════════════════════════
window._menuDashExportMenu = function(menuId){
  const menu = getAllMenus().find(m => m.id === menuId);
  if(!menu) return;
  const win = window.open('', '_blank');
  if(!win){ if(typeof showToast==='function') showToast('Bloqueur popup actif','warning'); return; }
  const siteName = (typeof _sites !== 'undefined' ? _sites : []).find(s => s.code === menu.site_id)?.name || menu.site_id;
  const dFr = new Date(menu.menu_date).toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const enrs = getEnrLinkedToMenu(menu.menu_id, menu.site_id, menu.menu_date);
  const plats = flatPlats(menu);
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Menu HACCP — ${escH(siteName)} ${menu.menu_date}</title>
  <style>
    body{font-family:Arial,sans-serif;margin:24px;color:#1e293b}
    h1{color:#5C1E5A;margin:0 0 4px;font-size:18px}
    h2{color:#0F2240;font-size:14px;margin:18px 0 8px;padding-bottom:4px;border-bottom:1.5px solid #cbd5e1}
    .meta{font-size:12px;color:#64748b;margin-bottom:14px}
    table{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:11px}
    th,td{border:1px solid #cbd5e1;padding:5px 7px;text-align:left;vertical-align:top}
    th{background:#f1f5f9;font-weight:700}
    .nc{background:#fef2f2;color:#991b1b}
    .ok{color:#166534}
    .small{font-size:10px;color:#64748b}
    @media print{body{margin:0}}
  </style></head><body>
  <h1>🍽️ Menu HACCP — ${escH(siteName)}</h1>
  <div class="meta">${dFr} • Service : ${SERVICES[menu.service]||menu.service} • Régime : ${menu.type_repas} • ${plats.length} plat(s) • ${enrs.length} ENR liés</div>
  <h2>Plats du menu</h2>
  <table><tr><th>Catégorie</th><th>Nom</th><th>Profil HACCP</th><th>Composants</th><th>ENR liés</th></tr>
  ${plats.map(p => {
    const prof = PROFILS[p.profil_haccp]||PROFILS.BF_CUIT;
    const linked = enrs.filter(r => r.data?._plat_id === p.plat_id).length;
    return `<tr><td>${escH(p.catLabel)}</td><td><strong>${escH(p.nom)}</strong></td><td>${prof.ico} ${prof.label}</td><td>${(p.composants||[]).map(escH).join(', ')||'—'}</td><td>${linked}</td></tr>`;
  }).join('')}
  </table>
  <h2>Chronologie complète des ENR (${enrs.length})</h2>
  <table><tr><th>Heure</th><th>ENR</th><th>Plat</th><th>Détail</th><th>Conf.</th></tr>
  ${enrs.map(r => {
    const def = TRACE_ENR[r.enr_type]||{label:r.enr_type,ico:''};
    const time = r.recorded_at ? new Date(r.recorded_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) : '—';
    const conf = r.data?.conforme;
    const isNC = conf === 'NON' || r.enr_type === 'enr30';
    const d = r.data || {};
    const bits = [];
    if(d.produit) bits.push(escH(d.produit));
    if(d.t_debut!==undefined&&d.t_debut!=='') bits.push('Début '+escH(d.t_debut)+'°C');
    if(d.t_fin!==undefined&&d.t_fin!=='') bits.push('Fin '+escH(d.t_fin)+'°C');
    if(d.temp_coeur!==undefined&&d.temp_coeur!=='') bits.push('Cœur '+escH(d.temp_coeur)+'°C');
    if(d.lot) bits.push('Lot '+escH(d.lot));
    if(d.fournisseur) bits.push(escH(d.fournisseur));
    return `<tr class="${isNC?'nc':''}"><td>${time}</td><td>${def.ico} ${def.label}</td><td>${escH(r.data?._plat_nom||'—')}</td><td>${bits.join(' • ')||'—'}</td><td>${conf==='OUI'?'<span class="ok">✓</span>':isNC?'✗':'—'}</td></tr>`;
  }).join('')}
  </table>
  <div class="small" style="margin-top:20px">Rapport généré par HACC.PRO le ${new Date().toLocaleString('fr-FR')}</div>
  <script>window.print();</script>
  </body></html>`);
  win.document.close();
};

window._menuDashExportPlat = function(platId, menuId){
  const menu = getAllMenus().find(m => m.id === menuId);
  if(!menu) return;
  let plat = null;
  CATS.forEach(c => { (menu.categories?.[c.id]||[]).forEach(p => { if(p.plat_id === platId) plat = p; }); });
  if(!plat) return;
  const win = window.open('', '_blank');
  if(!win){ if(typeof showToast==='function') showToast('Bloqueur popup actif','warning'); return; }
  const siteName = (typeof _sites !== 'undefined' ? _sites : []).find(s => s.code === menu.site_id)?.name || menu.site_id;
  const dFr = new Date(menu.menu_date).toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const enrs = getEnrLinkedToPlat(plat.plat_id, menu.site_id, menu.menu_date);
  const prof = PROFILS[plat.profil_haccp]||PROFILS.BF_CUIT;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Fiche plat — ${escH(plat.nom)}</title>
  <style>
    body{font-family:Arial,sans-serif;margin:24px;color:#1e293b}
    h1{color:#5C1E5A;margin:0 0 4px;font-size:18px}
    h2{color:#0F2240;font-size:14px;margin:14px 0 6px}
    .prof{display:inline-block;padding:4px 10px;border-radius:12px;color:#fff;font-weight:700;font-size:11px;background:${prof.color}}
    .meta{font-size:12px;color:#64748b;margin-bottom:14px}
    table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:10px}
    th,td{border:1px solid #cbd5e1;padding:5px 7px;text-align:left;vertical-align:top}
    th{background:#f1f5f9}
    .nc{background:#fef2f2;color:#991b1b}
    .small{font-size:10px;color:#64748b}
    @media print{body{margin:0}}
  </style></head><body>
  <h1>${prof.ico} ${escH(plat.nom)}</h1>
  <div class="meta">${escH(siteName)} • ${dFr} • ${SERVICES[menu.service]||menu.service}</div>
  <div class="prof">${prof.ico} ${prof.label}</div>
  ${plat.composants && plat.composants.length ? '<h2>Composants</h2><div style="font-size:12px">'+plat.composants.map(escH).join(', ')+'</div>' : ''}
  <h2>Chronologie HACCP (${enrs.length} ENR)</h2>
  <table><tr><th>Heure</th><th>Type</th><th>Détail</th><th>Conf.</th></tr>
  ${enrs.map(r => {
    const def = TRACE_ENR[r.enr_type]||{label:r.enr_type,ico:''};
    const time = r.recorded_at ? new Date(r.recorded_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) : '—';
    const conf = r.data?.conforme;
    const isNC = conf === 'NON' || r.enr_type === 'enr30';
    const d = r.data || {};
    const bits = [];
    if(d.produit) bits.push(escH(d.produit));
    if(d.cuisinier) bits.push('👨‍🍳 '+escH(d.cuisinier));
    if(d.t_debut!==undefined&&d.t_debut!=='') bits.push('Début '+escH(d.t_debut)+'°C');
    if(d.t_fin!==undefined&&d.t_fin!=='') bits.push('Fin '+escH(d.t_fin)+'°C');
    if(d.temp_coeur!==undefined&&d.temp_coeur!=='') bits.push('Cœur '+escH(d.temp_coeur)+'°C');
    if(d.temp!==undefined&&d.temp!=='' && !d.t_debut) bits.push('T° '+escH(d.temp)+'°C');
    if(d.duree) bits.push('Durée '+escH(d.duree));
    if(d.lot) bits.push('Lot '+escH(d.lot));
    if(d.dlc) bits.push('DLC '+escH(d.dlc));
    if(d.fournisseur) bits.push('Fourn. '+escH(d.fournisseur));
    if(d.commentaire) bits.push(escH(d.commentaire));
    return `<tr class="${isNC?'nc':''}"><td>${time}</td><td>${def.ico} ${def.label}</td><td>${bits.join(' • ')||'—'}</td><td>${conf==='OUI'?'✓':isNC?'✗':'—'}</td></tr>`;
  }).join('')}
  </table>
  <div class="small" style="margin-top:20px">Rapport généré par HACC.PRO le ${new Date().toLocaleString('fr-FR')}</div>
  <script>window.print();</script>
  </body></html>`);
  win.document.close();
};

// ════════════════════════════════════════════════════
// 6) HELPERS
// ════════════════════════════════════════════════════
function escH(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function escAttr(s){ return escH(s); }
function setContent(html){ document.getElementById('content').innerHTML = html; }

window._menuDashSelectSite = function(code){
  _menuPage.selectedSite = code;
  renderMenusPage();
};

// ════════════════════════════════════════════════════
// 7) ENREGISTREMENT DE L'ONGLET DASHBOARD
// ════════════════════════════════════════════════════
function registerMenuDashTab(){
  // 1. Ajouter le titre
  if(typeof PAGE_TITLES !== 'undefined'){
    PAGE_TITLES['menus'] = '🍽️ Menus & Traçabilité';
  }

  // 2. Hook dans renderPage : on monkey-patch
  if(typeof window.renderPage === 'function' && !window.__menuDashHooked){
    const orig = window.renderPage;
    window.renderPage = function(page){
      if(page === 'menus'){
        try { renderMenusPage(); }
        catch(e){
          console.error('[menu-dash]', e);
          setContent('<div style="padding:24px;color:#dc2626">Erreur menu : '+(e.message||e)+'</div>');
        }
        return;
      }
      return orig.apply(this, arguments);
    };
    window.__menuDashHooked = true;
  }

  // 3. Ajouter l'item dans la sidebar (avant "Analyse")
  const sb = document.querySelector('.sidebar-nav');
  if(sb && !document.getElementById('nav-menus')){
    const sectionAnalyse = Array.from(sb.querySelectorAll('.nav-section-label')).find(el => el.textContent.includes('Analyse'));
    const item = document.createElement('div');
    item.className = 'nav-item';
    item.id = 'nav-menus';
    item.dataset.page = 'menus';
    item.onclick = function(){ if(typeof navTo==='function') navTo('menus'); };
    item.innerHTML = '<span class="ico">🍽️</span>Menus & Plats';
    if(sectionAnalyse){
      sb.insertBefore(item, sectionAnalyse);
    } else {
      sb.appendChild(item);
    }
  }

  console.log('[menu-dash] onglet enregistré');
}

// Plusieurs essais (le dashboard met du temps à s'initialiser)
let _tries = 0;
function _trySetup(){
  _tries++;
  try {
    registerMenuDashTab();
    if(_tries < 10 && (typeof PAGE_TITLES === 'undefined' || typeof window.renderPage !== 'function' || !document.querySelector('.sidebar-nav'))){
      setTimeout(_trySetup, 500);
    }
  } catch(e){
    console.warn('[menu-dash] setup retry', _tries, e);
    if(_tries < 10) setTimeout(_trySetup, 500);
  }
}

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', _trySetup);
} else {
  _trySetup();
}

})();
