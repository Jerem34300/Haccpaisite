/**
   * app-dashboard.js — Application HACC.PRO Dashboard
   *
   * Module principal du tableau de bord de supervision HACCP.
   * Permet la consultation des données de tous les sites,
   * la gestion des utilisateurs, la génération de rapports PDF,
   * et la supervision des non-conformités.
   *
   * Rôles autorisés : super_admin, siege, directeur, chef_secteur
   *
   * Dépend de (chargés avant via <script src>) :
   *   - supabaseConfig.js  — Clés et URL Supabase
   *   - authGuard.js       — Vérification de session au démarrage
   *   - utils.js           — Fonctions utilitaires partagées
   */

console.log('%c[HACC.PRO] app-dashboard.js v35 — Refonte alertes ✨', 'background:#1e3a8a;color:#fff;padding:4px 10px;border-radius:4px;font-weight:bold');

// Auto-clean : si un ancien SW est actif, on l'unregister silencieusement
// pour que la prochaine visite charge la nouvelle version
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(reg => {
      // Si le SW est plus vieux que la version courante, on le rafraîchit
      reg.update().catch(()=>{});
    });
  });
}

// ── Fonctions isNC déclarées en PREMIER (utilisées dans les 3 blocs) ──────────
const CONF_KEYS = ['conf_r','conf_rt','conforme','conf_fin','conf_deb','conf_t3',
  'conf1','conf2','conf_f','conf_c','conf_cuisson','conf_glac','conf_prod',
  'conf_prem','conf_dern','conf_premier','conf_pre','conf_test'];
function isNC(r){
  const d=r.data||{};
  if(r.enr_type==='enr30') return d.cloture!=='OUI';
  if(r.enr_type==='nuisibles_val') return d.presence==='OUI'&&d.cloture!=='OUI';
  return CONF_KEYS.some(k=>d[k]==='NON')&&d.cloture!=='OUI';
}
function isNCCloturee(r){
  const d=r.data||{};
  if(r.enr_type==='enr30') return d.cloture==='OUI';
  if(r.enr_type==='nuisibles_val') return d.presence==='OUI'&&d.cloture==='OUI';
  return CONF_KEYS.some(k=>d[k]==='NON')&&d.cloture==='OUI';
}
// ════════════════════════════════════════════════════
// CONFIG & STATE
// ════════════════════════════════════════════════════
const _SUPA_URL_DEFAULT = SUPABASE_URL;
const _SUPA_KEY_DEFAULT = SUPABASE_ANON_KEY;
const _SUPA_SVC_DEFAULT = ''; // clé service_role supprimée — proxy Netlify utilisé
let SUPA_URL=_SUPA_URL_DEFAULT, SUPA_KEY=_SUPA_KEY_DEFAULT, SUPA_SERVICE_KEY=_SUPA_SVC_DEFAULT, _token='', _refreshToken='', _userId='', _profile=null, _viewTenant=null;
let _records=[], _gmos=[], _sites=[], _sectors=[], _territories=[];
let _encConfigs={}; // { siteId: { data: [...enceintes] } }
let _caniculeConfigs={}; // { siteId: { data: {active:bool} } }
let _correctiveActions=[]; // référentiel actions correctives HACCP
let _ncActionMappings=[];  // liaisons type NC -> actions
let _knowledgeProblems=[]; // problèmes NC appris (Netlify Blobs)
let _knowledgeRecommendations=[]; // recommandations apprises (Netlify Blobs)
let _tabletAlertsHistory=[]; // historique alertes tablettes
let _alertDraftImageDataUrl=''; // dataURL image retrait lot
let _photoReqFilters={period:'all',view:'all',zone:'all'};
let _photoReqAlertsLoaded=false;
let _currentPage='overview';
const CFG_STORE='haccp_dash_cfg_v2';

function loadCfg(){
  SUPA_URL = _SUPA_URL_DEFAULT;
  SUPA_KEY = _SUPA_KEY_DEFAULT;
  SUPA_SERVICE_KEY = _SUPA_SVC_DEFAULT;

  // ── Session depuis la page login unifiée ─────────────
  try {
    const session = JSON.parse(localStorage.getItem('haccpro_session') || '{}');
    if (session.token) {
      // url/key optionnels — utiliser les valeurs par défaut si absentes
      SUPA_URL = session.url || _SUPA_URL_DEFAULT;
      SUPA_KEY = session.key || _SUPA_KEY_DEFAULT;
      SUPA_SERVICE_KEY = session.serviceKey || _SUPA_SVC_DEFAULT;
      _token = session.token;
      _refreshToken = session.refreshToken || '';
      _userId = session.userId || '';
      // Sauvegarder AVANT de supprimer (ordre critique)
      localStorage.setItem(CFG_STORE, JSON.stringify({
        url: SUPA_URL, key: SUPA_KEY, serviceKey: SUPA_SERVICE_KEY,
        token: _token, refreshToken: _refreshToken, userId: _userId
      }));
      localStorage.removeItem('haccpro_session');
      window._autoLoginFromSession = true;
      return;
    }
  } catch(e) {}

  try{
    const c=JSON.parse(localStorage.getItem(CFG_STORE)||'{}');
    // Toujours utiliser les clés intégrées
    SUPA_URL = _SUPA_URL_DEFAULT;
    SUPA_KEY = _SUPA_KEY_DEFAULT;
    SUPA_SERVICE_KEY = _SUPA_SVC_DEFAULT;
    // Remplir les champs cachés
    const urlEl = document.getElementById('cfg-url'); if(urlEl) urlEl.value = SUPA_URL;
    const keyEl = document.getElementById('cfg-key'); if(keyEl) keyEl.value = SUPA_KEY;
    const svcEl = document.getElementById('cfg-service-key'); if(svcEl) svcEl.value = SUPA_SERVICE_KEY;
    // login-email supprimé (connexion via index.html uniquement)
    // Masquer la config avancée
    const advLink = document.getElementById('cfg-advanced-link');
    if(advLink) advLink.style.display = 'none';
  }catch{}
}
function saveCfg(){
  const sk=document.getElementById('cfg-service-key')?.value||'';
  if(sk) SUPA_SERVICE_KEY=sk.trim();
  localStorage.setItem(CFG_STORE,JSON.stringify({
    url:SUPA_URL,key:SUPA_KEY,serviceKey:SUPA_SERVICE_KEY,
    email:''
  }));
}

// ════════════════════════════════════════════════════
// MOBILE NAV
// ════════════════════════════════════════════════════
function setUserAvatar(name) {
  const el = document.getElementById('sb-avatar');
  if (!el) return;
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  el.textContent = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (parts[0] ? parts[0].slice(0, 2).toUpperCase() : '?');
}
function toggleSidebar(){
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
}
function closeSidebar(){
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}
function navTo(page){
  showPage(page);
  closeSidebar();
}

function openCuisine(siteId, siteCode, siteName){
  var sc = {};
  try { sc = JSON.parse(localStorage.getItem('haccp_supa_cfg_v1') || '{}'); } catch(e){}
  // cuisine.html uses c.siteId for `sites?code=eq.{siteId}` — must be the text code, not UUID
  sc.siteId    = siteCode || siteId;
  sc.siteUUID  = siteId;
  sc.siteNom   = siteName;
  sc.nom       = localStorage.getItem('sa_tenant_name') || siteName;
  sc.url       = SUPA_URL;
  sc.anonKey   = SUPA_KEY;
  sc.userToken = _token;
  sc.token     = _token;
  sc.userId    = _userId;
  if(_profile && _profile.tenant_id) sc.tenantId = _profile.tenant_id;
  localStorage.setItem('haccp_supa_cfg_v1', JSON.stringify(sc));

  // Reset branding fields in haccp_v6 so cuisine.html shows the correct
  // site name/logo and not the stale values from the previous session.
  var tenantName = (document.getElementById('sidebar-tenant-name') || {}).textContent
                 || localStorage.getItem('sa_tenant_name') || '';
  try {
    var v6 = JSON.parse(localStorage.getItem('haccp_v6') || '{}');
    v6.config = v6.config || {};
    v6.config.headerGroupe = tenantName;
    v6.config.headerNom    = siteName;
    delete v6.config.headerLogo;   // let cuisine.html reload tenant logo from Supabase
    localStorage.setItem('haccp_v6', JSON.stringify(v6));
  } catch(e){}

  window.location.href = 'cuisine.html';
}

// syncFilterMobile supprimé


// ════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════
// ════════════════════════════════════════════════════
// MODE DÉMO — données mockées sans Supabase
// ════════════════════════════════════════════════════
const DEMO_PASSWORD = 'demo2025';
function activerModeDemo() {
  _DEMO_MODE = true;
  _token = 'demo-token';
  _userId = 'demo-user-id';
  _profile = { id:'demo-user-id', role:'siege', full_name:'Mode Démo', sector_id:null, territory_id:null };
  // Données mockées réalistes
  const sites = [
    {id:'s1',code:'LYON01',name:'EHPAD Les Tilleuls',sector_id:'sec1'},
    {id:'s2',code:'LYON02',name:'Collège Jean Moulin',sector_id:'sec1'},
    {id:'s3',code:'GRE01', name:'Hôpital Nord',sector_id:'sec2'},
    {id:'s4',code:'GRE02', name:'Crèche Les Lucioles',sector_id:'sec2'},
    {id:'s5',code:'PAR01', name:'Lycée Voltaire',sector_id:'sec3'},
  ];
  const sectors = [
    {id:'sec1',code:'SEC-LYON',name:'Secteur Lyon',territory_id:'ter1'},
    {id:'sec2',code:'SEC-GRE', name:'Secteur Grenoble',territory_id:'ter1'},
    {id:'sec3',code:'SEC-PAR', name:'Secteur Paris',territory_id:'ter2'},
  ];
  const territories = [
    {id:'ter1',code:'SUD-EST',name:'Territoire Sud-Est'},
    {id:'ter2',code:'IDF',    name:'Territoire Île-de-France'},
  ];
  // Génère 120 enregistrements réalistes
  const enrTypes = ['reception','tracabilite','ccp','nettoyage','cuisson','distrib'];
  const records = [];
  for (let i = 0; i < 120; i++) {
    const site = sites[i % sites.length];
    const d = new Date(); d.setDate(d.getDate() - Math.floor(Math.random() * 30));
    const isNC = Math.random() < 0.12;
    records.push({
      id: 'rec-' + i,
      site_id: site.code,
      enr_type: enrTypes[i % enrTypes.length],
      recorded_at: d.toISOString(),
      data: { conforme: isNC ? 'NON' : 'OUI', produit: 'Produit exemple ' + (i+1), temperature: (Math.random()*5+1).toFixed(1) }
    });
  }
  // GMOs mockés
  const gmos = sites.slice(0,3).map((s,i) => ({
    id: 'gmo-'+i, site_id: s.id,
    visit_date: new Date(Date.now() - i*7*86400000).toISOString().slice(0,10),
    observations: 'Visite de routine — établissement globalement conforme.',
    scores: { locaux:90, personnel:75, reception:85, ccp:88, cuisson:92, nettoyage:100, tracabilite:80, _global:87, _bilan:[], _detail:{} }
  }));
  _sites = sites; _sectors = sectors; _territories = territories;
  _records = records; _gmos = gmos;
  var _ls=document.getElementById('login-screen'); if(_ls) _ls.style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('sb-name').textContent = 'Mode Démo';
  document.getElementById('sb-role').textContent = 'Siège';
  setUserAvatar('Mode Démo');
  ['nav-admin','nav-gmo','nav-compare'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'flex';
  });
  ['nav-admin-section'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'block';
  });
  document.getElementById('nav-super') && (document.getElementById('nav-super').style.display = 'flex');
  populateFilters();
  showPage('overview');
  showToast('🎯 Mode démo activé — données simulées', 'info', 5000);
}
let _DEMO_MODE = false;

// ── Mot de passe oublié ──────────────────────────────────────
async function showForgotPassword() {
  const url = (document.getElementById('cfg-url').value || SUPA_URL || '').trim();
  const key = (document.getElementById('cfg-key').value || SUPA_KEY || '').trim();
  if (!url || !key) {
    // Montrer config avancée si pas de config
    document.getElementById('cfg-advanced').style.display = 'block';
    document.getElementById('login-err').textContent = 'Configurez Supabase d\'abord';
    document.getElementById('login-err').style.display = 'block';
    return;
  }
  const email = document.getElementById('login-email').value.trim();
  if (!email) {
    document.getElementById('login-err').textContent = 'Entrez votre email d\'abord';
    document.getElementById('login-err').style.display = 'block';
    return;
  }
  try {
    const r = await fetch(url + '/auth/v1/recover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': key },
      body: JSON.stringify({ email })
    });
    const errEl = document.getElementById('login-err');
    errEl.style.display = 'block';
    errEl.style.color = r.ok ? '#86efac' : '#fca5a5';
    errEl.textContent = r.ok
      ? '✅ Email de réinitialisation envoyé à ' + email
      : '⚠️ Erreur — vérifiez l\'email';
  } catch(e) {
    document.getElementById('login-err').textContent = 'Erreur réseau : ' + e.message;
    document.getElementById('login-err').style.display = 'block';
  }
}

// ── Config avancée toggle ────────────────────────────────────
function toggleAdvancedCfg() {
  const el = document.getElementById('cfg-advanced');
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function doLogin(){
  const loginBtn = document.getElementById('login-btn');
  if (loginBtn && loginBtn.disabled) return;
  if (loginBtn) { loginBtn.disabled = true; loginBtn.textContent = '⏳ Connexion…'; }
  SUPA_URL=(document.getElementById('cfg-url').value||'').trim().replace(/\/$/,'');
  SUPA_KEY=(document.getElementById('cfg-key').value||'').trim();
  // service_role key gérée côté serveur (Netlify Function)
  const email=document.getElementById('login-email').value.trim();
  const pass=document.getElementById('login-pass').value;
  const errEl=document.getElementById('login-err');
  errEl.style.display='none';
  if(!SUPA_URL||!SUPA_KEY||!email||!pass){errEl.textContent='Remplissez tous les champs';errEl.style.display='block';return;}
  try{
    const r=await supa('POST','/auth/v1/token?grant_type=password',{email,password:pass},true);
    if(!r.access_token)throw new Error(r.error_description||r.msg||'Erreur de connexion');
    _token=r.access_token;
    _refreshToken=r.refresh_token||'';
    _userId=(r.user&&r.user.id)||'';
    saveCfg();
    startTokenRefresh();
    await bootApp();
  } catch(e) {
    errEl.textContent = e.message; errEl.style.display = 'block';
    if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = 'Se connecter →'; }
  }
}
function doLogout(){
  _token=''; _refreshToken=''; _profile=null; _records=[];
  stopTokenRefresh();
  // Effacer toute la config (sinon la prochaine visite reconnecte automatiquement)
  try {
    localStorage.removeItem(CFG_STORE);
    localStorage.removeItem('haccpro_session');
    localStorage.removeItem('sa_active_company');
    sessionStorage.removeItem('sa_view_tenant');
  } catch(e){}
  // Retour à la page de connexion
  window.location.replace('/');
}

// ── Auto-refresh JWT ──────────────────────────────
let _tokenRefreshTimer = null;
function startTokenRefresh() {
  stopTokenRefresh();
  // Refresh toutes les 50 minutes (token Supabase expire après 60 min)
  _tokenRefreshTimer = setInterval(async () => {
    if (!_refreshToken || !SUPA_URL || !SUPA_KEY) return;
    try {
      const r = await fetch(SUPA_URL + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPA_KEY },
        body: JSON.stringify({ refresh_token: _refreshToken })
      });
      if (r.ok) {
        const data = await r.json();
        if (data.access_token) {
          _token = data.access_token;
          _refreshToken = data.refresh_token || _refreshToken;
          // Persister dans localStorage pour que les prochains reloads aient le bon token
          try {
            const c = JSON.parse(localStorage.getItem(CFG_STORE) || '{}');
            c.token = _token;
            c.refreshToken = _refreshToken;
            localStorage.setItem(CFG_STORE, JSON.stringify(c));
          } catch(e){}
        }
      } else {
        // Token expiré et refresh raté → déconnecter
        showToast('Session expirée, reconnectez-vous', 'error');
        doLogout();
      }
    } catch(e) { console.warn('[token refresh]', e); }
  }, 50 * 60 * 1000); // 50 minutes
}
function stopTokenRefresh() {
  if (_tokenRefreshTimer) { clearInterval(_tokenRefreshTimer); _tokenRefreshTimer = null; }
}

// ════════════════════════════════════════════════════
// SUPABASE CLIENT
// ════════════════════════════════════════════════════
async function supa(method,path,body,anon=false,extraHeaders={}){
  if (_DEMO_MODE) { console.log('[DEMO] supa skipped:', method, path); return Array.isArray(body)?[]:{ok:true}; }
  const headers={
    'Content-Type':'application/json',
    'Accept':'application/json',
    'apikey':SUPA_KEY,
    'Authorization':`Bearer ${anon?SUPA_KEY:_token}`,
    ...extraHeaders
  };
  const opts={method,headers};
  if(body&&method!=='GET')opts.body=JSON.stringify(body);
  // Timeout 20s pour éviter le blocage infini (Supabase cold start)
  const _ctrl = new AbortController();
  const _tid = setTimeout(() => _ctrl.abort(), 5000);
  let r;
  try {
    r = await fetch(SUPA_URL+path, {...opts, signal: _ctrl.signal});
  } finally {
    clearTimeout(_tid);
  }
  // Si 401 et refresh token dispo → tenter refresh puis retry
  if(r.status===401 && !anon && _refreshToken){
    try{
      const rr=await fetch(SUPA_URL+'/auth/v1/token?grant_type=refresh_token',{
        method:'POST',
        headers:{'Content-Type':'application/json','apikey':SUPA_KEY},
        body:JSON.stringify({refresh_token:_refreshToken})
      });
      if(rr.ok){
        const data=await rr.json();
        if(data.access_token){
          _token=data.access_token;
          _refreshToken=data.refresh_token||_refreshToken;
          // Persister dans localStorage pour que les prochains reloads aient le bon token
          try {
            const c = JSON.parse(localStorage.getItem(CFG_STORE) || '{}');
            c.token = _token;
            c.refreshToken = _refreshToken;
            localStorage.setItem(CFG_STORE, JSON.stringify(c));
          } catch(e){}
          headers['Authorization']=`Bearer ${_token}`;
          r=await fetch(SUPA_URL+path,{method,headers:headers,body:opts.body,signal:_ctrl.signal});
        }
      } else { doLogout(); return Array.isArray(body)?[]:{ok:false}; }
    }catch(e){ console.warn('[refresh]',e); }
  }
  if(!r.ok){
    const t=await r.text().catch(()=>'');
    console.error('[supa]',method,path,'→',r.status,t.slice(0,200));
    throw new Error(`HTTP ${r.status}: ${t.slice(0,120)}`);
  }
  const ct=r.headers.get('content-type')||'';
  const data=ct.includes('json')?await r.json():null;
  console.log('[supa]',method,path,'→',Array.isArray(data)?data.length+' rows':typeof data);
  return data||[];
}
async function supaGet(table,query=''){return supa('GET',`/rest/v1/${table}?${query}`,null);}
async function supaAdmin(method,path,body,extraHeaders={}){
  // Proxy sécurisé — la clé service_role ne quitte jamais le serveur Netlify
  const _ac = new AbortController();
  const _at = setTimeout(() => _ac.abort(), 5000);
  let r;
  try {
    r = await fetch('/.netlify/functions/admin-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${_token}` },
      body: JSON.stringify({ method, path, body: body||null, extraHeaders }),
      signal: _ac.signal
    });
  } finally { clearTimeout(_at); }
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    let msg = t;
    try { msg = JSON.parse(t).error || t; } catch(e2) {}
    throw new Error(`HTTP ${r.status}: ${msg.slice(0, 150)}`);
  }
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : null;
}
async function hubApi(method, query='', body=null){
  const q = query ? `?${query}` : '';
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${_token}`
    }
  };
  if(body && method !== 'GET' && method !== 'DELETE') opts.body = JSON.stringify(body);
  const r = await fetch(`/.netlify/functions/haccp-hub${q}`, opts);
  const t = await r.text().catch(()=> '');
  let data = null;
  try { data = t ? JSON.parse(t) : null; } catch(_e) { data = null; }
  if(!r.ok){
    const msg = data?.error || t || `HTTP ${r.status}`;
    throw new Error(String(msg).slice(0,180));
  }
  return data || {};
}
function normalizeNCTypeLocal(v){
  const t=String(v||'').trim().toLowerCase();
  if(t==='temperature'||t==='hygiene'||t==='storage'||t==='autre') return t;
  return 'autre';
}
function inferNCTypeFromText(...parts){
  const txt = parts.map(v=>String(v||'').toLowerCase()).join(' ');
  if(!txt.trim()) return '';
  if(/temp|°c|froid|chaud|frigo|enceinte|remise en temp|cha[iî]ne du froid|sonde|cuisson|refroid/.test(txt)) return 'temperature';
  if(/hygi|nettoyage|d[ée]sinfection|nuisible|parasite|lavage|propret|contamination/.test(txt)) return 'hygiene';
  if(/stock|stockage|dlc|ddm|quarantaine|r[ée]organisation|rangement|r[ée]ception|fifo/.test(txt)) return 'storage';
  return '';
}
function inferNCTypeFromActionIds(ids){
  if(!Array.isArray(ids) || !ids.length || !_correctiveActions.length) return '';
  const counts = {};
  ids.forEach(id=>{
    const a = _correctiveActions.find(x=>x.id===id);
    const c = String(a?.category||'').toLowerCase();
    if(c==='temperature'||c==='hygiene'||c==='storage'){
      counts[c]=(counts[c]||0)+1;
    }
  });
  const top = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
  return top ? top[0] : '';
}
function inferNCTypeForLearning(d){
  const stored = String(d?.non_conformity_type||'').trim().toLowerCase();
  if(stored==='temperature'||stored==='hygiene'||stored==='storage') return stored;
  const fromActions = inferNCTypeFromActionIds(d?.corrective_action_ids);
  if(fromActions) return fromActions;
  const names = Array.isArray(d?.corrective_action_names) ? d.corrective_action_names.join(' ') : '';
  const fromText = inferNCTypeFromText(d?.desc, d?.description, d?.probleme, d?.action, d?.lieu, d?.source, d?.commentaire, names);
  if(fromText) return fromText;
  return 'autre';
}
function displayNCTypeFromItem(item){
  const stored = String(item?.nc_type||'').trim().toLowerCase();
  if(stored==='temperature'||stored==='hygiene'||stored==='storage') return stored;
  const fromText = inferNCTypeFromText(item?.problem, item?.action);
  return fromText || 'autre';
}
const NC_TYPE_DISPLAY_LABELS = {
  temperature:'🌡️ Température',
  hygiene:'🧼 Hygiène',
  storage:'📦 Stockage',
  autre:'📝 Autre'
};
function getScopedSiteCodes(){
  const f = getFilters();
  if(f.site) return [f.site];
  let sites = _sites.slice();
  if(f.secteur) sites = sites.filter(s=>s.sector_id===f.secteur);
  if(f.territoire){
    const secIds = new Set(_sectors.filter(s=>s.territory_id===f.territoire).map(s=>s.id));
    sites = sites.filter(s=>secIds.has(s.sector_id));
  }
  return [...new Set(sites.map(s=>s.code).filter(Boolean))];
}
function getSiteByCode(siteCode){
  return _sites.find(s=>String(s.code||'').toUpperCase()===String(siteCode||'').toUpperCase())||null;
}
function getSiteCleaningZones(siteCode){
  const site = getSiteByCode(siteCode);
  const cfg = (site && site.config && typeof site.config==='object') ? site.config : {};
  const fromRef = Array.isArray(cfg.nett_ref)
    ? cfg.nett_ref.map(it=>String(it?.zone||'').trim()).filter(Boolean)
    : [];
  const extra = Array.isArray(cfg.nett_zones_extra)
    ? cfg.nett_zones_extra.map(z=>String(z||'').trim()).filter(Boolean)
    : [];
  return [...new Set([...fromRef, ...extra])];
}
function getScopedCleaningZones(){
  const siteCodes = getScopedSiteCodes();
  const zones = [];
  siteCodes.forEach(code => {
    getSiteCleaningZones(code).forEach(z => zones.push(z));
  });
  return [...new Set(zones)].sort((a,b)=>a.localeCompare(b,'fr'));
}
async function loadKnowledgeData(){
  try{
    const data = await hubApi('GET', 'op=knowledge');
    _knowledgeProblems = Array.isArray(data?.problems) ? data.problems : [];
    _knowledgeRecommendations = Array.isArray(data?.recommendations) ? data.recommendations : [];
  } catch(e){
    _knowledgeProblems = [];
    _knowledgeRecommendations = [];
    console.warn('[knowledge]', e.message);
  }
}
// ── Alertes : bypass Netlify Blobs → Supabase direct ────────────────────────
function _supaAlertId(){ return 'alert_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8); }
function _mergeAlertRows(rows){
  const byId={};
  rows.forEach(row=>{
    const d=row.data||{};
    // L'ID de l'alerte est dans data.id (ex: 'alert_xxx')
    // client_id = 'alert_xxx:SITE_CODE' → prendre la partie avant ':'
    const id = d.id || (row.client_id||'').split(':')[0] || row.id;
    if(!id)return;
    if(!byId[id]){
      byId[id]={...d,id,_rowIds:[row.id],site_codes:[row.site_id].filter(Boolean),acks:[]};
    } else {
      byId[id]._rowIds.push(row.id);
      if(row.site_id&&!byId[id].site_codes.includes(row.site_id))
        byId[id].site_codes.push(row.site_id);
    }
  });
  return Object.values(byId);
}
async function loadTabletAlertsHistory(){
  try{
    const tenantId=_profile?.tenant_id;
    if(!tenantId){_tabletAlertsHistory=[];return;}
    // Charger alertes + acks en une requête
    const rows = await supaGet('pms_records',
      `enr_type=in.(hub_alert,hub_alert_ack,hub_photo_request)&tenant_id=eq.${encodeURIComponent(tenantId)}&order=recorded_at.desc&limit=400`);
    const alertRows   = (rows||[]).filter(r=>r.enr_type==='hub_alert');
    const ackRows      = (rows||[]).filter(r=>r.enr_type==='hub_alert_ack');
    const photoReqRows = (rows||[]).filter(r=>r.enr_type==='hub_photo_request');

    // Fusionner alertes et photo_requests
    const allMerged = [
      ..._mergeAlertRows(alertRows),
      ..._mergeAlertRows(photoReqRows)
    ];

    // Attacher les acks à leur alerte/photo_request
    ackRows.forEach(ack=>{
      const alertId = ack.data?.alert_id||'';
      const target  = allMerged.find(x=>x.id===alertId);
      if(target) target.acks.push({
        site_code: ack.data?.site_code||ack.site_id||'',
        response:  ack.data?.response||'ok',
        note:      ack.data?.note||'',
        photo_url: ack.data?.photo_url||'',
        photo_data_url: ack.data?.photo_data_url||ack.data?.photo_url||'',
        acked_at:  ack.data?.acked_at||ack.data?.acknowledged_at||ack.recorded_at,
        acknowledged_at: ack.data?.acknowledged_at||ack.data?.acked_at||ack.recorded_at,
        user_name: ack.data?.user_name||'',
        zone:      ack.data?.zone||''
      });
    });

    // Trier par date décroissante
    _tabletAlertsHistory = allMerged.sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
  }catch(e){
    _tabletAlertsHistory=[];
    console.warn('[alerts]',e.message);
  }
}
async function supaPost(table,body){return supa('POST',`/rest/v1/${table}`,body);}
async function supaPatch(table,id,body){return supa('PATCH',`/rest/v1/${table}?id=eq.${id}`,body);}
async function supaDelete(table,id){return supa('DELETE',`/rest/v1/${table}?id=eq.${id}`,null);}

// ════════════════════════════════════════════════════
// BOOT
// ════════════════════════════════════════════════════
async function bootApp(){
  document.body.style.visibility = 'visible';
  var ls = document.getElementById('login-screen'); if(ls) ls.style.display='none';
  var appEl = document.getElementById('app');
  if(appEl) appEl.style.display='block';
  try{
    let profiles = await supaGet('profiles',`select=*${_userId?'&id=eq.'+_userId:''}&limit=1`).catch((e)=>{return[];});
    
    if(!profiles||!profiles.length){
      try{
        profiles = await supaAdmin('GET',`/rest/v1/profiles?select=*${_userId?'&id=eq.'+_userId:''}&limit=1`,null);
        if(!Array.isArray(profiles)) profiles = [];
      }catch(e2){
        console.warn('[bootApp] fallback admin-proxy failed',e2);
        // Utiliser la session localStorage comme fallback
        try {
          const sess = JSON.parse(localStorage.getItem('haccpro_session')||localStorage.getItem(CFG_STORE)||'{}');
          if(sess.role) profiles = [{role:sess.role,tenant_id:sess.tenantId||null,full_name:sess.fullName||''}];
        } catch(e3){}
      }
    }
    _profile=profiles[0]||{role:'siege'};

    // ── Mode impersonation super_admin ─────────────────────
    if (_profile?.role === 'super_admin') {
      try {
        const _imp = JSON.parse(sessionStorage.getItem('sa_view_tenant') || 'null');
        if (_imp?.id && _imp?.name) _viewTenant = _imp;
      } catch(e) {}
    }
    // Bannière d'impersonation
    const _impBanner = document.getElementById('sa-impersonate-banner');
    if (_impBanner) {
      if (_viewTenant) {
        _impBanner.innerHTML =
          '<span>👁 Vue entreprise&nbsp;: <strong>' + (_viewTenant.name||'') + '</strong></span>'
          + '<button onclick="sessionStorage.removeItem(\'sa_view_tenant\');window.location.href=\'superadmin.html\'" style="background:#92400e;color:#fff;border:none;border-radius:8px;padding:5px 12px;font-size:.75rem;font-weight:800;cursor:pointer">← Retour SuperAdmin</button>';
        _impBanner.style.display = 'flex';
        // Afficher le nom du tenant impersonné dans la sidebar
        const _tnEl = document.getElementById('sidebar-tenant-name');
        if (_tnEl) _tnEl.textContent = _viewTenant.name;
      } else {
        _impBanner.style.display = 'none';
      }
    }

    // ── Vérifier verrou données ────────────────────────────
    if (_profile.data_locked && _profile.role !== 'super_admin') {
      document.getElementById('sb-name').textContent = _profile.full_name||'Utilisateur';
      document.getElementById('sb-role').textContent = 'Accès restreint';
      setUserAvatar(_profile.full_name||'Utilisateur');
      // Masquer tout sauf GMO dans la sidebar
      document.querySelectorAll('.nav-item').forEach(el => {
        if (!el.getAttribute('onclick')?.includes('gmo')) el.style.display = 'none';
      });
      // Afficher message et rediriger vers GMO
      setContent(`
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:14px;padding:16px 18px;margin-bottom:16px;display:flex;align-items:center;gap:12px">
          <span style="font-size:1.4rem">🔒</span>
          <div>
            <div style="font-size:.85rem;font-weight:800;color:#92400e">Accès aux données restreint</div>
            <div style="font-size:.75rem;color:#a16207;margin-top:2px">Votre responsable a désactivé la consultation des données. Vous pouvez uniquement effectuer vos visites GMO.</div>
          </div>
        </div>`);
      await loadData(); // charge quand même pour le GMO
      showPage('gmo');
      return;
    }
    document.getElementById('sb-name').textContent=_profile.full_name||'Utilisateur';
    const roleLabels={cuisinier:'Cuisinier',chef_secteur:'Chef de secteur',directeur:'Administrateur',siege:'Siège'};
    document.getElementById('sb-role').textContent=roleLabels[_profile.role]||_profile.role;
    setUserAvatar(_profile.full_name||'Utilisateur');

    // ── Charger le branding depuis tenants ─────────────────────
    if (_profile.tenant_id) {
      try {
        const tenants = await supaGet('tenants', `select=id,name,tagline,primary_color,accent_color,logo_url&id=eq.${_profile.tenant_id}&limit=1`);
        const t = tenants?.[0];
        if (t) applyTenantBranding(t);
      } catch(e) { console.warn('[bootApp] tenant branding failed', e); }
    } else {
      // super_admin : restaurer depuis localStorage
      restoreBranding();
    }
    // Afficher admin si siège
    if(_profile.role==='super_admin'){
      const nsa = document.getElementById('nav-super'); if(nsa) nsa.style.display='flex';
      document.getElementById('nav-admin-section').style.display='block';
    }
    if(_profile.role==='siege'||_profile.role==='super_admin'){
      document.getElementById('nav-admin').style.display='flex';
      document.getElementById('nav-admin-section').style.display='block';
      document.getElementById('filter-territoire').style.display='block';
      document.getElementById('filter-secteur').style.display='block';
      const actNC = document.getElementById('nav-actions-nc');
      if(actNC) actNC.style.display='flex';
    }
    if(['super_admin','siege','directeur','chef_secteur'].includes(_profile.role||'')){
      const alertsNav = document.getElementById('nav-alerts');
      if(alertsNav) alertsNav.style.display = 'flex';
    }
    if(_profile.role==='chef_secteur'||_profile.role==='siege'||_profile.role==='directeur'){
      document.getElementById('nav-gmo').style.display='flex';
      document.getElementById('nav-compare').style.display='flex';
    }
    if(_profile.role==='siege'){
      const navSub = document.getElementById('nav-subscription');
      if(navSub) navSub.style.display='flex';
    }
    await loadData();
    showPage('overview');
  }catch(e){
    const msg = e.name === 'AbortError'
      ? '⏱️ Délai dépassé — Supabase met du temps à répondre. Rechargez la page.'
      : e.message;
    setContent(`<div class="empty"><div class="empty-ico">⚠️</div>${msg}<br><button onclick="loadData()" style="margin-top:12px;padding:10px 20px;background:#0f2240;color:#fff;border:none;border-radius:8px;font-size:.85rem;cursor:pointer">🔄 Réessayer</button></div>`);
  }
}

// ── Auto-refresh ──────────────────────────────────
let _autoRefreshTimer = null;
let _autoRefreshInterval = 600; // secondes (10 minutes)
let _countdownTimer = null;

function startAutoRefresh() {
  stopAutoRefresh();
  // Ne pas démarrer l'auto-refresh sur la page GMO
  if (_currentPage === 'gmo') return;

  const indicator = document.getElementById('sync-indicator');
  if (indicator) indicator.style.display = 'flex';

  let remaining = _autoRefreshInterval;
  _countdownTimer = setInterval(() => {
    // Annuler si on est passé sur GMO entre temps
    if (_currentPage === 'gmo') { stopAutoRefresh(); return; }
    remaining--;
    const el = document.getElementById('sync-countdown');
    if (el) {
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      el.textContent = `${m}:${s.toString().padStart(2,'0')}`;
    }
    if (remaining <= 0) {
      loadData();
    }
  }, 1000);
}

function stopAutoRefresh() {
  if (_countdownTimer) { clearInterval(_countdownTimer); _countdownTimer = null; }
  const indicator = document.getElementById('sync-indicator');
  if (indicator) indicator.style.display = 'none';
}

async function loadData(){
  stopAutoRefresh();
  // Animation bouton refresh
  const ico = document.getElementById('refresh-ico');
  const btn = document.getElementById('btn-refresh-main');
  if (ico) { ico.style.animation = 'spin .7s linear infinite'; }
  if (btn) { btn.disabled = true; btn.style.opacity = '0.7'; }
  const _setStep = (s) => setContent('<div class="loading"><div class="spinner"></div>' + s + '</div>');
  _setStep('Connexion Supabase…');
  try{
    const _get = async (table, query) => { _setStep('Chargement ' + table + '…'); return supaGet(table, query); };
    // Filtre tenant — obligatoire pour tous les rôles sauf super_admin
    // Sans tenant_id, on ne charge rien pour éviter de voir les données des autres entreprises
    if(_profile?.role !== 'super_admin' && !_profile?.tenant_id){
      _setStep('');
      setContent(`<div class="empty"><div class="empty-ico">⚠️</div><strong>Configuration incomplète</strong><br>Votre compte n'est pas encore rattaché à une organisation.<br><br><a href="onboarding.html" style="color:var(--navy);font-weight:800">Terminer la configuration →</a></div>`);
      return;
    }
    // En mode impersonation, filtrer sur le tenant sélectionné dans superadmin
    const _effectiveTenantId = _viewTenant?.id || _profile?.tenant_id || null;
    const tenantFilter = _effectiveTenantId ? `&tenant_id=eq.${_effectiveTenantId}` : '';

    _sites=await _get('sites',`select=*,sectors(*,territories(*))&order=name${tenantFilter}`);
    _sectors=await _get('sectors',`select=*,territories(*)&order=name${tenantFilter}`);
    if(_profile?.role==='siege'||_profile?.role==='super_admin'||_profile?.role==='directeur')
      _territories=await _get('territories',`select=*&order=name${tenantFilter}`);
    // Filtre période — par défaut 6 mois (rétention PMS réglementaire)
    const _loadPeriodSel = document.getElementById('filter-load-period');
    const _loadMonths = _loadPeriodSel ? parseInt(_loadPeriodSel.value)||6 : 6;
    const _loadSince = new Date(Date.now() - _loadMonths*30*24*3600*1000).toISOString().slice(0,10);
    _records=await _get('pms_records',`select=*&order=recorded_at.desc&limit=5000&recorded_at=gte.${_loadSince}${tenantFilter}`);
    // Charger la config des enceintes par site
    try {
      const configs = await _get('pms_config', `select=*&type=eq.enceintes${tenantFilter}`);
      _encConfigs = {};
      (configs||[]).forEach(c => { _encConfigs[c.site_id] = c; });
    } catch(e) { _encConfigs = {}; }
    // Charger le mode canicule par site
    try {
      const canCfgs = await _get('pms_config', `select=*&type=eq.canicule${tenantFilter}`);
      _caniculeConfigs = {};
      (canCfgs||[]).forEach(c => { _caniculeConfigs[c.site_id] = c; });
    } catch(e) { _caniculeConfigs = {}; }
    _gmos=await _get('gmo',`select=*&order=visit_date.desc&limit=200${tenantFilter}`);

    // ── Restriction chef de secteur : ne voir que ses sites ──
    if(_profile?.role==='chef_secteur' && _profile?.sector_id){
      const sectorId = _profile.sector_id;
      _sites   = _sites.filter(s => s.sector_id === sectorId);
      _sectors = _sectors.filter(s => s.id === sectorId);
      const allowedCodes = new Set(_sites.map(s => s.code));
      const allowedIds   = new Set(_sites.map(s => s.id));
      _records = _records.filter(r => allowedCodes.has(r.site_id));
      _gmos    = _gmos.filter(g => allowedIds.has(g.site_id));
    }

    // ── Restriction directeur : ne voir que son territoire ──
    if(_profile?.role==='directeur' && _profile?.territory_id){
      const terrId = _profile.territory_id;
      const terrSectors = new Set(_sectors.filter(s=>s.territory_id===terrId).map(s=>s.id));
      _sites   = _sites.filter(s => terrSectors.has(s.sector_id));
      _sectors = _sectors.filter(s => s.territory_id === terrId);
      _territories = _territories.filter(t => t.id === terrId);
      const allowedCodes = new Set(_sites.map(s => s.code));
      const allowedIds   = new Set(_sites.map(s => s.id));
      _records = _records.filter(r => allowedCodes.has(r.site_id));
      _gmos    = _gmos.filter(g => allowedIds.has(g.site_id));
    }
    console.log('[loadData] records:', _records.length, 'sites:', _sites.length);
    // Pas de tentative bloquante si 0 records — juste loguer
    if(_records.length===0){
      console.log('[loadData] 0 records — RLS ou données vides');
    }
    populateFilters();
    // Ne pas re-rendre si GMO avec formulaire actif
    const gmoActive = _currentPage === 'gmo' && !!document.getElementById('gmo-site-selector');
    if (!gmoActive) renderPage(_currentPage);
    // Stopper animation + auto-refresh uniquement hors GMO
    const ico2 = document.getElementById('refresh-ico');
    const btn2 = document.getElementById('btn-refresh-main');
    if (ico2) ico2.style.animation = '';
    if (btn2) { btn2.disabled = false; btn2.style.opacity = ''; }
    if (!gmoActive) startAutoRefresh();
  }catch(e){
    console.error('[loadData]',e);
    const ico2 = document.getElementById('refresh-ico');
    const btn2 = document.getElementById('btn-refresh-main');
    if (ico2) ico2.style.animation = '';
    if (btn2) { btn2.disabled = false; btn2.style.opacity = ''; }
    setContent(`<div class="empty"><div class="empty-ico">⚠️</div><strong>Erreur de chargement</strong><br><small style="color:var(--muted)">${e.message}</small><br><button onclick="loadData()" style="margin-top:12px;padding:8px 16px;background:var(--green);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700">↻ Réessayer</button></div>`);
    startAutoRefresh();
  }
}

function populateFilters(){
  const moisSet=[...new Set(_records.map(r=>r.recorded_at?.slice(0,7)).filter(Boolean))].sort().reverse();
  const curM=new Date().toISOString().slice(0,7);
  // Mois — par défaut "Tous les mois" si des données existent sur plusieurs mois
  [document.getElementById('filter-mois'),document.getElementById('filter-mois-m')].forEach(el=>{
    if(!el)return;
    const curVal = el.value; // garder la valeur actuelle si déjà sélectionnée
    el.innerHTML='<option value="">Tous les mois</option>';
    moisSet.forEach(m=>el.innerHTML+=`<option value="${m}" ${curVal===m?'selected':''}>${m}</option>`);
  });
  // Auto-détecter les sites inconnus dans les records
  const knownCodes=new Set(_sites.map(s=>s.code));
  const recordCodes=[...new Set(_records.map(r=>r.site_id).filter(Boolean))];
  const unknownCodes=recordCodes.filter(c=>!knownCodes.has(c));
  // Remplir territoire (siège uniquement)
  if(_profile?.role==='siege'||_profile?.role==='super_admin'){
    const terrSel=document.getElementById('filter-territoire');
    if(terrSel){
      terrSel.innerHTML='<option value="">Tous les territoires</option>';
      _territories.forEach(t=>terrSel.innerHTML+=`<option value="${t.id}">${t.name}</option>`);
    }
    const sectSel=document.getElementById('filter-secteur');
    if(sectSel){
      sectSel.innerHTML='<option value="">Tous les secteurs</option>';
      _sectors.forEach(s=>sectSel.innerHTML+=`<option value="${s.id}">${s.name}</option>`);
    }
  } else {
    // Masquer territoire et secteur pour chef_secteur
    const terrRow = document.getElementById('filter-territoire')?.closest('.filter-combo-row');
    const sectRow = document.getElementById('filter-secteur')?.closest('.filter-combo-row');
    if(terrRow) terrRow.style.display='none';
    if(sectRow) sectRow.style.display='none';
  }
  cascadeFilters(unknownCodes);
  updateComboLabel();
  const noFilterPages = ['gmo','compare','admin','rapports'];
  const drawer=document.getElementById('filter-drawer');
  if(drawer){
    if(!noFilterPages.includes(_currentPage)){
      
    } else {
      
    }
  }
}

function cascadeFilters(unknownCodes){
  const terrId=document.getElementById('filter-territoire')?.value||'';
  const sectId=document.getElementById('filter-secteur')?.value||'';
  // Filtrer les secteurs selon territoire sélectionné
  const sectSel=document.getElementById('filter-secteur');
  if(sectSel&&terrId){
    const visibleSects=_sectors.filter(s=>s.territory_id===terrId);
    sectSel.innerHTML='<option value="">Tous les secteurs</option>';
    visibleSects.forEach(s=>sectSel.innerHTML+=`<option value="${s.id}">${s.name}</option>`);
  }
  // Filtrer les sites selon secteur (ou territoire)
  let visibleSites=_sites;
  if(sectId) visibleSites=_sites.filter(s=>s.sector_id===sectId);
  else if(terrId){
    const sectIds=new Set(_sectors.filter(s=>s.territory_id===terrId).map(s=>s.id));
    visibleSites=_sites.filter(s=>sectIds.has(s.sector_id));
  }
  const extra=unknownCodes||[];
  [document.getElementById('filter-site'),document.getElementById('filter-site-m')].forEach(el=>{
    if(!el)return;
    el.innerHTML='<option value="">Tous les sites</option>';
    visibleSites.forEach(s=>el.innerHTML+=`<option value="${s.code}">${s.name} (${s.code})</option>`);
    // Ajouter sites inconnus (code seul, pas encore dans la table sites)
    extra.forEach(code=>el.innerHTML+=`<option value="${code}">⚠️ ${code} (non enregistré)</option>`);
  });
}

function getFilters(){
  return{
    mois:document.getElementById('filter-mois')?.value||'',
    site:document.getElementById('filter-site')?.value||'',
    territoire:document.getElementById('filter-territoire')?.value||'',
    secteur:document.getElementById('filter-secteur')?.value||'',
  };
}
function filteredRecords(){
  const f=getFilters();
  return _records.filter(r=>{
    if(f.mois&&!r.recorded_at?.startsWith(f.mois))return false;
    if(f.site&&r.site_id!==f.site)return false;
    // Chef de secteur : toujours restreint à son secteur (déjà filtré dans _records)
    if(f.secteur){const site=_sites.find(s=>s.code===r.site_id);if(!site||site.sector_id!==f.secteur)return false;}
    if(f.territoire){
      const site=_sites.find(s=>s.code===r.site_id);if(!site)return false;
      const sect=_sectors.find(s=>s.id===site.sector_id);if(!sect||sect.territory_id!==f.territoire)return false;
    }
    return true;
  });
}

// ════════════════════════════════════════════════════
// FILTRE COMBO : territoire → secteur → site
// ════════════════════════════════════════════════════
function toggleFilterCombo() {
  const dd = document.getElementById('filter-combo-dropdown');
  const btn = document.getElementById('filter-combo-btn');
  if (!dd) return;
  const isOpen = dd.classList.contains('open');
  // Fermer en cliquant ailleurs
  if (!isOpen) {
    dd.classList.add('open');
    btn.classList.add('open');
    setTimeout(() => {
      document.addEventListener('click', closeComboOutside, {once:true});
    }, 10);
  } else {
    dd.classList.remove('open');
    btn.classList.remove('open');
  }
}
function closeComboOutside(e) {
  const wrap = document.getElementById('filter-combo-wrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('filter-combo-dropdown')?.classList.remove('open');
    document.getElementById('filter-combo-btn')?.classList.remove('open');
  }
}
function updateComboLabel() {
  const site   = document.getElementById('filter-site')?.value;
  const sect   = document.getElementById('filter-secteur')?.value;
  const terr   = document.getElementById('filter-territoire')?.value;
  const btn    = document.getElementById('filter-combo-btn');
  const label  = document.getElementById('filter-combo-label');
  if (!label) return;
  let txt = 'Tous les sites';
  if (site) {
    const s = _sites.find(x => x.code === site);
    txt = s ? s.name + ' (' + s.code + ')' : site;
  } else if (sect) {
    const s = _sectors.find(x => x.id === sect);
    txt = s ? '📍 ' + s.name : sect;
  } else if (terr) {
    const t = _territories.find(x => x.id === terr);
    txt = t ? '🗺️ ' + t.name : terr;
  }
  label.textContent = txt;
  if (btn) btn.classList.toggle('active', !!(site || sect || terr));
}
function onComboTerrChange() {
  // Reset secteur et site
  const sectSel = document.getElementById('filter-secteur');
  const siteSel = document.getElementById('filter-site');
  const terrId  = document.getElementById('filter-territoire')?.value || '';
  if (sectSel) {
    const visibleSects = terrId ? _sectors.filter(s=>s.territory_id===terrId) : _sectors;
    sectSel.innerHTML = '<option value="">Tous les secteurs</option>';
    visibleSects.forEach(s => sectSel.innerHTML += `<option value="${s.id}">${s.name}</option>`);
    sectSel.value = '';
  }
  if (siteSel) {
    const visibleSites = terrId
      ? _sites.filter(s => { const sec=_sectors.find(x=>x.id===s.sector_id); return sec?.territory_id===terrId; })
      : _sites;
    siteSel.innerHTML = '<option value="">Tous les sites</option>';
    visibleSites.forEach(s => siteSel.innerHTML += `<option value="${s.code}">${s.name} (${s.code})</option>`);
    siteSel.value = '';
  }
  updateComboLabel();
  applyFilters();
}
function onComboSectChange() {
  const sectId  = document.getElementById('filter-secteur')?.value || '';
  const siteSel = document.getElementById('filter-site');
  if (siteSel) {
    const visibleSites = sectId ? _sites.filter(s=>s.sector_id===sectId) : _sites;
    siteSel.innerHTML = '<option value="">Tous les sites</option>';
    visibleSites.forEach(s => siteSel.innerHTML += `<option value="${s.code}">${s.name} (${s.code})</option>`);
    siteSel.value = '';
  }
  updateComboLabel();
  applyFilters();
}
function onComboSiteChange() {
  updateComboLabel();
  applyFilters();
}

function applyFilters(){renderPage(_currentPage);}

// ════════════════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════════════════
const PAGE_TITLES={
  overview:'📊 Vue d\'ensemble',saisies:'📋 Saisies PMS',
  super:'🌐 Super Admin',
  photos:'📷 Photos',nc:'🚨 Non-conformités',
  'pg-reception':'📦 Réceptions ENR23',
  'pg-tracabilite':'📋 Traçabilité MP ENR31',
  'pg-ccp':'❄️ CCP',
  'pg-temperatures':'🌡️ Températures',
  'pg-nettoyage':'🧹 Nettoyage',
  'pg-nuisibles':'🐀 Nuisibles',
  'pg-cuisson':'🥘 Cuisson & Distribution',
  'pg-suivi':'📋 Maintenance & Labo',
  compare:'⚖️ PMS vs GMO',gmo:'📝 GMO',
  rapports:'📄 Rapports PDF',
  alerts:'🚨 Alertes cuisines',
  'actions-nc':'🛠️ Actions correctives NC',
  admin:'⚙️ Gérer l\'organisation',
};

function showPage(page){
  // Bloquer navigation si data_locked — uniquement GMO autorisé
  if (_profile?.data_locked && page !== 'gmo') {
    showToast('🔒 Accès restreint — uniquement les GMO sont disponibles', 'warning');
    return;
  }
  const prevPage = _currentPage;
  _currentPage=page;
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.page===page));
  document.getElementById('page-title').textContent=PAGE_TITLES[page]||page;
  renderPage(page);
  // Masquer les filtres topbar sur GMO et Compare
  const hiddenPages = ['gmo','compare'];
  const topbar = document.getElementById('topbar-filters');
  if(topbar) topbar.style.display = hiddenPages.includes(page) ? 'none' : 'flex';
  // Masquer drawer mobile sur GMO/Compare

  // Gérer auto-refresh : stopper sur GMO, relancer en quittant GMO
  if(page === 'gmo'){
    stopAutoRefresh();
  } else if(prevPage === 'gmo'){
    startAutoRefresh();
  }
  closeSidebar();
}
function renderPage(page){
  try {
    if(page==='overview')renderOverview();
    else if(page==='saisies')renderSaisies();
    else if(page==='photos')renderPhotos();
    else if(page==='nc')renderNC();
    else if(page==='pg-reception')renderPageENR('reception');
    else if(page==='pg-tracabilite')renderPageENR('tracabilite');
    else if(page==='pg-ccp')renderPageENR('ccp');
    else if(page==='pg-temperatures')renderPageENR('temperatures');
    else if(page==='pg-nettoyage')renderPageENR('nettoyage');
    else if(page==='pg-nuisibles')renderPageENR('nuisibles');
    else if(page==='pg-cuisson')renderPageENR('cuisson');
    else if(page==='pg-suivi')renderPageENR('suivi');
    else if(page==='compare')renderCompare();
    else if(page==='gmo')renderGMO();
    else if(page==='rapports')renderRapports();
    else if(page==='admin')renderAdmin();
    else if(page==='alerts'){_adminTab='alerts';renderAdmin();}
    else if(page==='actions-nc'){_adminTab='corrective';renderAdmin();}
    else if(page==='super')renderSuperAdmin();
    else if(page==='subscription')renderSubscription();
  } catch(e) {
    console.error('[renderPage] crash:', page, e);
    setContent('<div style="padding:24px;text-align:center">'
      +'<div style="font-size:2rem;margin-bottom:8px">⚠️</div>'
      +'<div style="font-size:.88rem;font-weight:800;color:#dc2626;margin-bottom:6px">Erreur de chargement</div>'
      +'<div style="font-size:.72rem;color:#991b1b;background:#fff5f5;border-radius:8px;padding:8px;text-align:left;word-break:break-all;margin-bottom:12px">'+(e&&e.message||String(e))+'</div>'
      +'<button onclick="_pgRetry()" style="padding:9px 18px;background:var(--navy);color:#fff;border:none;border-radius:10px;font-size:.8rem;font-weight:700;cursor:pointer">🔄 Réessayer</button>'
      +'</div>');
  }
}
function setContent(html){document.getElementById('content').innerHTML=html;}
function _pgRetry(){try{renderPage(_currentPage);}catch(e){console.error('[retry]',e);}}

// ════════════════════════════════════════════════════
// TOAST
// ════════════════════════════════════════════════════
function showToast(msg,type='info',duration=3000){
  const wrap=document.getElementById('toast-wrap');
  if(!wrap)return;
  const t=document.createElement('div');
  t.className=`toast ${type}`;t.textContent=msg;
  wrap.appendChild(t);
  setTimeout(()=>t.remove(),duration);
}

// ════════════════════════════════════════════════════
// PAGE : OVERVIEW
// ════════════════════════════════════════════════════
// ── Helpers vue d\'ensemble ───────────────────────────

// ════════════════════════════════════════════════════
// SCORE PMS PONDÉRÉ — même logique que GMO
// Ignoré : Locaux (10%) et Personnel (15%) — pas d'équivalent PMS
// Utilisé : CCP×20%, Cuisson×20%, Réception×15%, Nettoyage×10%, Traçabilité×10%
// Total utilisé = 75% → normalisé sur 100
// ════════════════════════════════════════════════════
const PMS_WEIGHTED_MAP = [
  { catKey:'ccp',     enrs:['enr01','enr02','enr03'],                                                                  coeff:20 },
  { catKey:'cuisson', enrs:['enr04','enr05','enr06','enr07','enr08','enr09','enr10','enr11','enr12','enr13','enr14','enr15','enr16','enr17','enr18','enr52'], coeff:20 },
  { catKey:'recep',   enrs:['enr23'],                                                                                  coeff:15 },
  { catKey:'nett',    enrs:['enr28'],                                                                                  coeff:10 },
  { catKey:'trac',    enrs:['enr31'],                                                                                  coeff:10 },
  // ENR19 traité séparément via calcEnr19Assiduite (coeff 15)
];

// ══ Score assiduité ENR19 ═══════════════════════════════════════════════════
// Si on oublie de prendre les températures, aucune saisie n'est créée
// donc isNC() ne détecte rien et le score reste 100%.
// Solution : taux assiduité = slots uniques faits / slots attendus
// (nb enceintes × nb jours × 2 moments ouverture+fermeture)
function isSiteCanicule(siteId){
  const cfg=_caniculeConfigs[siteId];
  return !!(cfg&&cfg.data&&cfg.data.active);
}

function getCaniculeScopeTarget(){
  const f=getFilters();
  const terrId=f.territoire||'';
  const sectId=f.secteur||'';
  const siteId=f.site||'';
  let sites=[], scope='all', label='Tous les sites';

  if(siteId){
    scope='site';
    sites=_sites.filter(s=>s.code===siteId);
    label=sites[0]?.name||siteId;
  } else if(sectId){
    scope='sector';
    sites=_sites.filter(s=>s.sector_id===sectId);
    label=_sectors.find(s=>s.id===sectId)?.name||'Secteur';
  } else if(terrId){
    scope='territory';
    const sectIds=new Set(_sectors.filter(s=>s.territory_id===terrId).map(s=>s.id));
    sites=_sites.filter(s=>sectIds.has(s.sector_id));
    label=_territories.find(t=>t.id===terrId)?.name||'Territoire';
  } else {
    sites=[..._sites];
  }
  return { scope, label, sites, siteIds: sites.map(s=>s.code) };
}

function getCaniculeScopeStats(siteIds){
  const ids=[...new Set((siteIds||[]).filter(Boolean))];
  const active=ids.filter(id=>isSiteCanicule(id)).length;
  return { total: ids.length, active, inactive: Math.max(0, ids.length-active) };
}

async function upsertCaniculeSite(siteId, activate){
  const tenantId = _profile?.tenant_id || null;
  const existing = _caniculeConfigs[siteId];
  const nowIso = new Date().toISOString();
  if(existing && existing.id){
    await supa('PATCH',`/rest/v1/pms_config?id=eq.${existing.id}`,
      {data:{active:!!activate},updated_at:nowIso},
      false,{'Prefer':'return=minimal'});
    _caniculeConfigs[siteId]={...existing,data:{active:!!activate},site_id:siteId,updated_at:nowIso};
    return;
  }
  const created = await supa('POST','/rest/v1/pms_config',
    {site_id:siteId,tenant_id:tenantId,type:'canicule',data:{active:!!activate},updated_at:nowIso},
    false,{'Prefer':'return=representation'});
  const row = Array.isArray(created) ? created[0] : created;
  _caniculeConfigs[siteId]={
    ...(existing||{}),
    ...(row&&typeof row==='object'?row:{}),
    site_id:siteId,
    type:'canicule',
    data:{active:!!activate},
    updated_at:nowIso
  };
}

async function setCaniculeBulk(activate){
  const target=getCaniculeScopeTarget();
  const stats=getCaniculeScopeStats(target.siteIds);
  if(stats.total===0){
    showToast('Aucun site trouvé pour cette portée', 'warning');
    return;
  }
  const title = activate ? 'Activer le mode canicule' : 'Désactiver le mode canicule';
  const ok = await showConfirmModal(
    title,
    `${activate?'Activation':'Désactivation'} sur ${stats.total} cuisine(s) — portée: ${target.label}.`,
    activate?'Activer':'Désactiver',
    'Annuler'
  );
  if(!ok) return;

  let success=0, failed=0;
  for(const siteId of target.siteIds){
    try{
      await upsertCaniculeSite(siteId, activate);
      success++;
    }catch(e){
      failed++;
      console.error('[setCaniculeBulk]',siteId,e);
    }
  }

  if(failed===0){
    showToast(`☀️ Mode canicule ${activate?'activé':'désactivé'} sur ${success} cuisine(s)`, activate?'warning':'success');
  } else if(success>0){
    showToast(`⚠️ Mode canicule partiel: ${success} réussi(s), ${failed} en erreur`, 'warning', 5000);
  } else {
    showToast('Erreur: impossible de modifier le mode canicule', 'error', 5000);
  }
  renderPage(_currentPage);
}

async function toggleCanicule(siteId,activate){
  try{
    await upsertCaniculeSite(siteId, activate);
    showToast((activate?'☀️ Mode Canicule activé sur ':'✅ Mode Canicule désactivé sur ')+(_siteName(siteId)||siteId),(activate?'warning':'success'));
    renderPage(_currentPage);
  }catch(e){showToast('Erreur toggle canicule: '+e.message,'error');}
}
// ════════════════════════════════════════════════════════════
// PDF TABLEAU TEMPÉRATURES DU MOIS
// ════════════════════════════════════════════════════════════
function calcEnr19Assiduite(recs, mois) {
  const enr19 = recs.filter(r => r.enr_type === 'enr19');
  if (enr19.length === 0) return null;

  // Nb de jours dans la période — le mois commence TOUJOURS le 1er
  // (si on oublie la 1ère semaine, ça doit compter contre soi)
  let nbJours = 30;
  const _allDates = [...new Set(enr19.map(r => r.data && r.data.date).filter(Boolean))].sort();
  if (mois) {
    const parts = mois.split('-').map(Number);
    const y = parts[0], m = parts[1];
    const now = new Date();
    if (y === now.getFullYear() && m === now.getMonth() + 1) {
      nbJours = now.getDate(); // mois en cours : du 1er à aujourd'hui
    } else {
      nbJours = new Date(y, m, 0).getDate(); // mois passé : mois complet
    }
  } else {
    // "Tous les mois" : span depuis la 1ère saisie jusqu'à aujourd'hui
    if (_allDates.length > 0) {
      const first = new Date(_allDates[0] + 'T12:00');
      const today = new Date();
      nbJours = Math.max(1, Math.ceil((today - first) / (1000*60*60*24)) + 1);
    }
  }

  // Enceintes connues via enc_id des relevés
  const encIds = [...new Set(enr19.map(r => r.data && r.data.enc_id).filter(Boolean))];
  const nbEnc = Math.max(encIds.length, 1);

  // Mode canicule pour ce site ? (3 moments si actif)
  const siteId = enr19.length > 0 ? enr19[0].site_id : null;
  const canMode = (typeof isSiteCanicule === 'function') ? (siteId ? isSiteCanicule(siteId) : false) : false;
  const nbMoments = canMode ? 3 : 2;

  // Relevés attendus = enceintes × jours × nb moments (2 normal, 3 canicule)
  const attendus = nbEnc * nbJours * nbMoments;

  // Compter les SLOTS UNIQUES (date, enc_id, moment)
  const slotsOuv  = new Set(enr19.filter(r => r.data && r.data.moment === 'ouv')
    .map(r => (r.data.date||'')+'|'+(r.data.enc_id||'')));
  const slotsAprem = new Set(enr19.filter(r => r.data && r.data.moment === 'aprem')
    .map(r => (r.data.date||'')+'|'+(r.data.enc_id||'')));
  const slotsFerm = new Set(enr19.filter(r => r.data && r.data.moment === 'ferm')
    .map(r => (r.data.date||'')+'|'+(r.data.enc_id||'')));
  const ouv  = slotsOuv.size;
  const aprem = slotsAprem.size;
  const ferm = slotsFerm.size;
  const faits = ouv + ferm + (canMode ? aprem : 0);

  // NC de température (hors seuil)
  const ncTemp = enr19.filter(r => isNC(r)).length;

  // Assiduité = slots faits / slots attendus, jamais > 100%
  const assiduite  = Math.min(1, attendus > 0 ? faits / attendus : 0);
  const conformite = faits > 0 ? (1 - ncTemp / faits) : 1;

  // Score combiné : 60 % assiduité + 40 % conformité
  const combined = Math.round((assiduite * 0.6 + conformite * 0.4) * 100);

  const firstDateDisp = _allDates.length > 0
    ? new Date(_allDates[0]+'T12:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short'})
    : null;
  return {
    pct: combined,
    assiduite: Math.round(assiduite * 100),
    conformite: Math.round(conformite * 100),
    nbEnc, nbJours, attendus, faits, ouv, ferm, ncTemp,
    oublis: Math.max(0, attendus - faits),
    firstDate: firstDateDisp
  };
}

function pmsWeightedScore(recs, mois) {
  let totalWeight = 0, weightedSum = 0;
  PMS_WEIGHTED_MAP.forEach(cat => {
    const catRecs = recs.filter(r => cat.enrs.includes(r.enr_type));
    if (catRecs.length === 0) return;
    const nc = catRecs.filter(r => isNC(r)).length;
    weightedSum += Math.round((1 - nc / catRecs.length) * 100) * cat.coeff;
    totalWeight += cat.coeff;
  });
  // ENR19 assiduité (coeff 15)
  const e19 = calcEnr19Assiduite(recs, mois);
  if (e19 !== null) { weightedSum += e19.pct * 15; totalWeight += 15; }
  if (totalWeight === 0) return null;
  return Math.round(weightedSum / totalWeight);
}

function pmsWeightedByCategory(recs, mois) {
  const result = {};
  PMS_WEIGHTED_MAP.forEach(cat => {
    const catRecs = recs.filter(r => cat.enrs.includes(r.enr_type));
    const nb = catRecs.length, nc = catRecs.filter(r => isNC(r)).length;
    result[cat.catKey] = { nb, nc, pct: nb > 0 ? Math.round((1 - nc/nb)*100) : null, coeff: cat.coeff };
  });
  const e19 = calcEnr19Assiduite(recs, mois);
  result['temp'] = e19
    ? { nb: e19.faits, nc: e19.ncTemp, pct: e19.pct, coeff: 15,
        _assiduite: e19.assiduite, _conformite: e19.conformite,
        _attendus: e19.attendus, _nbEnc: e19.nbEnc, _nbJours: e19.nbJours }
    : { nb: 0, nc: 0, pct: null, coeff: 15 };
  return result;
}

const CAT_GROUPS = [
  {key:'ccp',    label:'❄️ CCP',         ico:'❄️', enrs:['enr01','enr02','enr03'],            page:'pg-ccp'},
  {key:'cuisson',label:'🥘 Cuisson',     ico:'🥘', enrs:['enr04','enr05','enr06','enr07','enr08','enr09','enr10','enr11','enr12','enr13','enr14','enr15','enr16','enr17','enr18','enr52','enr_tc_distrib','enr_distrib_midi','enr_distrib_soir'], page:'pg-cuisson'},
  {key:'recep',  label:'📦 Réception',   ico:'📦', enrs:['enr23'],                             page:'pg-reception'},
  {key:'nett',   label:'🧹 Nettoyage',   ico:'🧹', enrs:['enr28'],                             page:'pg-nettoyage'},
  {key:'trac',   label:'📋 Traçabilité', ico:'📋', enrs:['enr31'],                             page:'pg-tracabilite'},
  {key:'temp',   label:'🌡️ Températures',ico:'🌡️', enrs:['enr19','enr20','enr21','enr27','enr26'], page:'pg-temperatures'},
  {key:'suivi',  label:'📋 Suivi',         ico:'📋', enrs:['enr24','enr25','enr_allergenes'],       page:'pg-suivi'},
];

function _siteName(code){return _sites.find(x=>x.code===code)?.name||code;}
function _siteTerr(code){
  const s=_sites.find(x=>x.code===code);
  if(!s)return'';
  const sc=_sectors.find(x=>x.id===s.sector_id);
  const t=_territories.find(x=>x.id===sc?.territory_id);
  return[t?.name,sc?.name].filter(Boolean).join(' › ');
}


// ════════════════════════════════════════════════════════════
// ALERTES ENCEINTES — enceintes non relevées HIER
// ════════════════════════════════════════════════════════════
function getYesterdayStr(){
  const d=new Date(); d.setDate(d.getDate()-1);
  return d.toISOString().slice(0,10);
}

function checkEnceinteAlerts(){
  const yStr=getYesterdayStr();
  const alerts=[];
  // Sites à vérifier: ceux avec config OU ceux qui ont eu des ENR19 ce mois
  const sitesWithConfig=Object.keys(_encConfigs);
  const sitesWithRecords=[...new Set(_records.filter(r=>r.enr_type==='enr19').map(r=>r.site_id).filter(Boolean))];
  const sitesToCheck=[...new Set([...sitesWithConfig,...sitesWithRecords])];
  sitesToCheck.forEach(function(siteId){
    const cfg=_encConfigs[siteId];
    let enceintes=(cfg&&cfg.data)||[];
    // Si pas de config Supabase, déduire les enceintes depuis les records récents
    if(!enceintes.length){
      const recentIds=[...new Set(_records.filter(r=>r.enr_type==='enr19'&&r.site_id===siteId).map(r=>r.data&&r.data.enc_id).filter(Boolean))];
      enceintes=recentIds.map(id=>({id,label:(_records.find(r=>r.enr_type==='enr19'&&r.site_id===siteId&&r.data&&r.data.enc_id===id)?.data?.enc_label)||id}));
    }
    if(!enceintes.length)return;
    // Relevés d'hier pour ce site
    const yRecs=_records.filter(function(r){
      return r.enr_type==='enr19'&&r.site_id===siteId&&r.data&&r.data.date===yStr;
    });
    // Enceintes sans AUCUN relevé hier → rouge
    const manquantes=enceintes.filter(function(enc){
      return !yRecs.some(function(r){return r.data.enc_id===enc.id;});
    });
    // Enceintes avec relevé PARTIEL hier (ouv ou ferm manquant) → orange
    const partielles=enceintes.filter(function(enc){
      const encRecs=yRecs.filter(function(r){return r.data.enc_id===enc.id;});
      if(!encRecs.length)return false;
      const hasOuv=encRecs.some(function(r){return r.data.moment==='ouv';});
      const hasFerm=encRecs.some(function(r){return r.data.moment==='ferm';});
      return !(hasOuv&&hasFerm);
    });
    if(manquantes.length||partielles.length){
      alerts.push({siteId,siteName:_siteName(siteId),date:yStr,manquantes,partielles});
    }
  });
  return alerts;
}

function renderEnceinteAlerts(){
  const yStr=getYesterdayStr();
  const yLabel=new Date(yStr+'T12:00').toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'});
  const alerts=checkEnceinteAlerts();
  if(!alerts.length)return'';
  const total=alerts.reduce(function(s,a){return s+a.manquantes.length+a.partielles.length;},0);
  const rows=alerts.map(function(a){
    const parts=[];
    if(a.manquantes.length){
      parts.push('<div style="margin-top:6px">🔴 <b>Non relevé(s) :</b> '
        +a.manquantes.map(function(e){return escH(e.label||e.id);}).join(', ')+'</div>');
    }
    if(a.partielles.length){
      parts.push('<div style="margin-top:4px">🟠 <b>Partiel(s) :</b> '
        +a.partielles.map(function(e){return escH(e.label||e.id);}).join(', ')+'</div>');
    }
    return `<div onclick="navTo('pg-temperatures');applyTempFilter('${a.siteId}','${a.date}')"
      style="background:#fff;border-radius:10px;padding:10px 12px;margin-bottom:8px;cursor:pointer;border-left:4px solid #dc2626">
      <div style="font-weight:800;font-size:.88rem;color:#111">${escH(a.siteName||a.siteId)}</div>
      ${parts.join('')}
      <div style="font-size:.65rem;color:#9ca3af;margin-top:4px">Tap pour voir la fiche →</div>
    </div>`;
  }).join('');
  return `<div style="background:#fef2f2;border:2px solid #dc2626;border-radius:12px;padding:12px 14px;margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <span style="font-size:.78rem;font-weight:900;text-transform:uppercase;letter-spacing:.5px;color:#dc2626">🔴 Alertes températures</span>
      <span style="font-size:.72rem;font-weight:700;background:#dc2626;color:#fff;padding:2px 8px;border-radius:8px">${total} enceinte${total>1?'s':''}</span>
    </div>
    <div style="font-size:.7rem;color:#6b7280;margin-bottom:8px">Hier — ${yLabel}</div>
    ${rows}
  </div>`;
}

function applyTempFilter(siteId, date){
  // Forcer le filtre sur ce site et naviguer sur la page températures
  try{
    const selSite=document.getElementById('filter-site');
    if(selSite){selSite.value=siteId;applyFilters();}
  }catch(e){}
}
function renderOverview(){
  const recs  = filteredRecords();
  const nb    = recs.length;
  const _alertBanner = renderEnceinteAlerts();
  const f0    = getFilters();
  const mois0 = f0.mois || new Date().toISOString().slice(0,7);
  const pct   = pmsWeightedScore(recs, mois0) ?? 100;
  const colGlob = pct>=90?'#16a34a':pct>=75?'#d97706':'#dc2626';

  // ── Calcul des données par site ──────────────────────────────
  const siteMap = {};
  recs.forEach(r => {
    if(!siteMap[r.site_id]) siteMap[r.site_id]={total:0,nc:0,cats:{},lastActivity:null};
    siteMap[r.site_id].total++;
    if(isNC(r)) siteMap[r.site_id].nc++;
    if(r.recorded_at && (!siteMap[r.site_id].lastActivity || r.recorded_at > siteMap[r.site_id].lastActivity))
      siteMap[r.site_id].lastActivity = r.recorded_at;
    const cat=CAT_GROUPS.find(c=>c.enrs.includes(r.enr_type));
    if(cat){
      if(!siteMap[r.site_id].cats[cat.key]) siteMap[r.site_id].cats[cat.key]={t:0,nc:0};
      siteMap[r.site_id].cats[cat.key].t++;
      if(isNC(r)) siteMap[r.site_id].cats[cat.key].nc++;
    }
  });
  const activeCodes = new Set(Object.keys(siteMap));
  const rows = Object.entries(siteMap).map(([code,v])=>({
    code, name:_siteName(code), terr:_siteTerr(code), ...v,
    pct: Math.round((1-v.nc/v.total)*100),
  }));
  // Sites sans saisies ce mois
  const inactiveRows = _sites
    .filter(s=>!activeCodes.has(s.code))
    .map(s=>({code:s.code,name:s.name,terr:_siteTerr(s.code),total:0,nc:0,pct:null,lastActivity:null,cats:{}}));
  const allRows = [...rows,...inactiveRows];

  // ── KPIs ────────────────────────────────────────────────────
  const sitesEnAlerte  = rows.filter(r=>r.pct<75).length;
  const ncActives      = recs.filter(r=>isNC(r)&&!isNCCloturee(r)).length;
  const sitesInactifs  = inactiveRows.length;
  const dernSaisie     = recs[0]?.recorded_at
    ? new Date(recs[0].recorded_at).toLocaleDateString('fr-FR',{day:'numeric',month:'short'})
    : null;

  // ── Triage sites ─────────────────────────────────────────────
  const critiques = rows.filter(r=>r.pct<70||r.nc>5).sort((a,b)=>a.pct-b.pct);
  const critSet   = new Set(critiques.map(r=>r.code));
  const warnings  = rows.filter(r=>!critSet.has(r.code)&&(r.pct<85||r.nc>0)).sort((a,b)=>a.pct-b.pct);
  const warnSet   = new Set(warnings.map(r=>r.code));
  const oks       = rows.filter(r=>!critSet.has(r.code)&&!warnSet.has(r.code));

  // ── Helpers pour les cartes ──────────────────────────────────
  function relTime(iso){
    if(!iso)return'jamais';
    const diff=Date.now()-new Date(iso).getTime();
    const h=Math.floor(diff/3600000);
    if(h<1)return'il y a < 1h';
    if(h<24)return`il y a ${h}h`;
    const d=Math.floor(h/24);
    if(d===1)return'hier';
    return`il y a ${d}j`;
  }
  function scoreCol(p){return p==null?'#94a3b8':p>=85?'#16a34a':p>=70?'#d97706':'#dc2626';}
  function scoreBg(p) {return p==null?'#f8fafc':p>=85?'#f0fdf4':p>=70?'#fffbeb':'#fff5f5';}
  function scoreBrd(p){return p==null?'#e2e8f0':p>=85?'#bbf7d0':p>=70?'#fde68a':'#fecaca';}
  function siteCard(s){
    const col=scoreCol(s.pct), bg=scoreBg(s.pct), brd=scoreBrd(s.pct);
    const searchKey=(s.name+' '+s.code+' '+s.terr).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
    const catBadges = CAT_GROUPS.filter(c=>s.cats[c.key]).map(c=>{
      const cv=s.cats[c.key]; const cp=Math.round((1-cv.nc/cv.t)*100);
      const cc=scoreCol(cp);
      return `<span style="font-size:.58rem;font-weight:800;padding:2px 6px;border-radius:4px;background:${cc}18;color:${cc};border:1px solid ${cc}40">${c.ico} ${cp}%</span>`;
    }).join('');
    return `<div class="ov-site-card" data-search="${escH(searchKey)}" data-pct="${s.pct??-1}"
      style="background:${bg};border:1.5px solid ${brd};border-radius:16px;padding:14px 16px;cursor:pointer;transition:box-shadow .15s,transform .15s"
      onmouseover="this.style.boxShadow='0 4px 16px rgba(0,0,0,.1)';this.style.transform='translateY(-2px)'"
      onmouseout="this.style.boxShadow='';this.style.transform=''"
      onclick="(function(){const el=document.getElementById('filter-site');if(el){el.value='${s.code}';applyFilters();}navTo('saisies');})()">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px">
        <div style="flex:1;min-width:0">
          <div style="font-size:.85rem;font-weight:800;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escH(s.name)}</div>
          <div style="font-size:.65rem;color:var(--muted);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escH(s.terr||s.code)}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:1.55rem;font-weight:900;color:${col};line-height:1">${s.pct!=null?s.pct+'%':'—'}</div>
          ${s.nc>0?`<span style="font-size:.6rem;font-weight:800;background:#fee2e2;color:#991b1b;padding:1px 6px;border-radius:4px">${s.nc} NC</span>`:''}
        </div>
      </div>
      ${s.pct!=null?`<div style="height:4px;background:rgba(0,0,0,.07);border-radius:2px;margin-bottom:8px;overflow:hidden"><div style="width:${s.pct}%;height:100%;background:${col};border-radius:2px;transition:width .5s"></div></div>`:''}
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:.62rem;color:var(--muted)">${s.total?s.total+' saisies':'Aucune saisie'} · ${relTime(s.lastActivity)}</div>
        <span style="font-size:.7rem;color:var(--muted)">›</span>
      </div>
      ${catBadges?`<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:7px">${catBadges}</div>`:''}
      <div style="margin-top:10px;text-align:right">
        <button onclick="event.stopPropagation();openCuisine('${escH(s.id)}','${escH(s.code)}','${escH(s.name)}')"
          style="padding:5px 12px;background:var(--navy);color:#fff;border:none;border-radius:8px;font-size:.72rem;font-weight:800;cursor:pointer;font-family:var(--font);transition:background .15s"
          onmouseover="this.style.background='var(--navy2)'" onmouseout="this.style.background='var(--navy)'">
          Ouvrir PMS →
        </button>
      </div>
    </div>`;
  }

  // ── NC récentes ──────────────────────────────────────────────
  const ncRecs = recs.filter(r=>isNC(r)).slice(0,6);
  let ncBlock='';
  if(ncRecs.length>0){
    ncBlock=`<div class="ov-panel ov-panel-danger" style="margin-bottom:18px">
      <div class="ov-panel-title">🚨 ${ncRecs.length} NC récente${ncRecs.length>1?'s':''} <span style="font-size:.7rem;font-weight:600;opacity:.7">${recs.filter(r=>isNC(r)).length} ce mois</span></div>
      ${ncRecs.map(r=>{
        const d=r.data||{}, site=_siteName(r.site_id);
        const dt=r.recorded_at?new Date(r.recorded_at).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}):'';
        let produit=d.produit||d.fournisseur||d.probleme||d.desc||d.enc_id||'—';
        const enrL=ENR_LABELS[r.enr_type]||r.enr_type?.toUpperCase()||'';
        const cloturee=isNCCloturee(r);
        return `<div class="ov-nc-row" onclick="openDetail('${r.id}')">
          <div style="flex:1;min-width:0">
            <div style="font-size:.8rem;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escH(produit)}</div>
            <div style="font-size:.68rem;color:var(--muted);margin-top:1px">${enrL} · ${escH(site)} · ${dt}</div>
          </div>
          <span style="flex-shrink:0;font-size:.62rem;font-weight:800;padding:2px 8px;border-radius:6px;${cloturee?'background:#dcfce7;color:#166534':'background:#fee2e2;color:#991b1b'}">${cloturee?'Clôturée':'En cours'}</span>
          <span style="color:#fca5a5;font-size:.85rem;flex-shrink:0">›</span>
        </div>`;
      }).join('')}
      ${recs.filter(r=>isNC(r)).length>6?`<div style="text-align:center;margin-top:8px"><button onclick="navTo('nc')" style="background:none;border:none;color:#dc2626;font-size:.78rem;font-weight:700;cursor:pointer;font-family:var(--font)">Voir toutes les NC →</button></div>`:''}
    </div>`;
  }

  // ── Domaines ────────────────────────────────────────────────
  const _mTile=mois0;
  let domHtml=`<div style="font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-bottom:10px">Score par domaine</div>
  <div class="ov-domain-grid" style="margin-bottom:20px">`;
  CAT_GROUPS.forEach(cat=>{
    if(cat.key==='temp'){
      const a=calcEnr19Assiduite(recs,_mTile);
      if(!a){
        domHtml+=`<div class="ov-domain-card ov-dom-empty"><span class="ov-dom-ico">${cat.ico}</span><div class="ov-dom-label">${cat.label.replace(/^../,'')}</div><div class="ov-dom-sub">Aucune saisie</div></div>`;
        return;
      }
      const c=scoreCol(a.pct),bg=scoreBg(a.pct),brd=scoreBrd(a.pct);
      domHtml+=`<div class="ov-domain-card" style="background:${bg};border-color:${brd}" onclick="navTo('${cat.page}')">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px"><span class="ov-dom-ico">${cat.ico}</span><span style="font-size:1.4rem;font-weight:900;color:${c};line-height:1">${a.pct}%</span></div>
        <div class="ov-dom-label">${cat.label.replace(/^../,'')}</div>
        <div style="height:3px;background:rgba(0,0,0,.07);border-radius:2px;margin:6px 0;overflow:hidden"><div style="width:${a.pct}%;height:100%;background:${c}"></div></div>
        <div class="ov-dom-sub">${a.faits}/${a.attendus} relevés</div>
      </div>`;
      return;
    }
    const catRecs=recs.filter(r=>cat.enrs.includes(r.enr_type));
    if(!catRecs.length){
      domHtml+=`<div class="ov-domain-card ov-dom-empty"><span class="ov-dom-ico">${cat.ico}</span><div class="ov-dom-label">${cat.label.replace(/^../,'')}</div><div class="ov-dom-sub">Aucune saisie</div></div>`;
      return;
    }
    const nNC=catRecs.filter(r=>isNC(r)).length;
    const p=Math.round((1-nNC/catRecs.length)*100);
    const c=scoreCol(p),bg=scoreBg(p),brd=scoreBrd(p);
    domHtml+=`<div class="ov-domain-card" style="background:${bg};border-color:${brd}" onclick="navTo('${cat.page}')">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px"><span class="ov-dom-ico">${cat.ico}</span><span style="font-size:1.4rem;font-weight:900;color:${c};line-height:1">${p}%</span></div>
      <div class="ov-dom-label">${cat.label.replace(/^../,'')}</div>
      <div style="height:3px;background:rgba(0,0,0,.07);border-radius:2px;margin:6px 0;overflow:hidden"><div style="width:${p}%;height:100%;background:${c}"></div></div>
      <div class="ov-dom-sub">${catRecs.length} saisies · ${nNC} NC</div>
    </div>`;
  });
  domHtml+=`</div>`;

  // ── Sections sites ────────────────────────────────────────────
  function siteSection(title,colorClass,items,collapsed=false){
    if(!items.length)return'';
    const id='ov-sec-'+Math.random().toString(36).slice(2,8);
    return `<div class="ov-section ${colorClass}" style="margin-bottom:16px">
      <div class="ov-sec-hd" onclick="(function(){var g=document.getElementById('${id}');g.style.display=g.style.display==='none'?'':'none';})()" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-radius:14px 14px 0 0;user-select:none">
        <div style="font-size:.82rem;font-weight:800">${title} <span class="ov-sec-count" style="font-size:.72rem;opacity:.8">(${items.length})</span></div>
        <span style="font-size:.9rem;opacity:.6">▾</span>
      </div>
      <div id="${id}" style="display:${collapsed?'none':''};padding:12px;display:grid" class="ov-site-grid">
        ${items.map(siteCard).join('')}
      </div>
    </div>`;
  }

  // ── GMO ──────────────────────────────────────────────────────
  let gmoSection='';
  const rolesGMO=['siege','directeur','chef_secteur'];
  if(_profile&&rolesGMO.includes(_profile.role)&&_gmos.length>=0){
    const gmosMois=_gmos.filter(g=>g.visit_date?.startsWith(mois0));
    const sitesSansGMO=_sites.filter(s=>!gmosMois.some(g=>g.site_id===s.id)&&recs.some(r=>r.site_id===s.code));
    const ncMajeures=[];
    _gmos.slice(0,20).forEach(g=>{
      const bilan=g.scores?._bilan||[];
      const site=_sites.find(s=>s.id===g.site_id);
      bilan.filter(nc=>nc.niveau==='NC majeure'&&!nc.verifie).forEach(nc=>{
        ncMajeures.push({...nc,siteName:site?.name||'—',visitDate:g.visit_date,gmoId:g.id});
      });
    });
    gmoSection=`<div style="font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-bottom:10px;margin-top:4px">Suivi GMO — ${mois0}</div>`;
    if(ncMajeures.length>0){
      gmoSection+=`<div class="ov-panel ov-panel-danger" style="margin-bottom:14px">
        <div class="ov-panel-title">⚠️ ${ncMajeures.length} NC majeure${ncMajeures.length>1?'s':''} GMO en attente</div>
        ${ncMajeures.slice(0,5).map(nc=>{
          const ncSite=_sites.find(s=>s.name===nc.siteName);
          const canV=_profile?.role==='siege'||(_profile?.role==='chef_secteur'&&ncSite?.sector_id===_profile?.sector_id);
          return `<div class="ov-nc-row" ${canV&&nc.gmoId?`onclick="openGMODetail('${nc.gmoId}')" style="cursor:pointer"`:''}>
            <div style="flex:1;min-width:0">
              <div style="font-size:.78rem;font-weight:700">${escH(nc.siteName)}</div>
              <div style="font-size:.68rem;color:var(--muted)">${escH(nc.axe)} › ${escH(nc.critere)}</div>
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
              <span style="font-size:.63rem;color:var(--muted)">${new Date(nc.visitDate+'T12:00:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'})}</span>
              ${canV&&nc.gmoId?'<span style="font-size:.63rem;font-weight:700;color:#1d4ed8;background:#dbeafe;padding:1px 7px;border-radius:6px">Valider →</span>':''}
            </div>
          </div>`;
        }).join('')}
      </div>`;
    }
    if(gmosMois.length>0){
      gmoSection+=`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:10px;margin-bottom:14px">`;
      gmosMois.slice(0,12).forEach(g=>{
        const site=_sites.find(s=>s.id===g.site_id);
        const sc=g.scores||{};
        const vals=Object.entries(sc).filter(([k])=>!k.startsWith('_')).map(([,v])=>Number(v));
        const gp=sc._global!=null?sc._global:vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):null;
        const bilan=sc._bilan||[];
        const maj=bilan.filter(n=>n.niveau==='NC majeure').length;
        const min=bilan.filter(n=>n.niveau==='NC mineure').length;
        const c=gp!=null?gmoColor(gp):'#a0aec0';
        const bg=gp==null?'#f8fafc':gp>=85?'#f0fdf4':gp>=70?'#fffbeb':'#fff5f5';
        const brd=gp==null?'#e2e8f0':gp>=85?'#bbf7d0':gp>=70?'#fde68a':'#fecaca';
        gmoSection+=`<div onclick="openGMODetail('${g.id}')" style="background:${bg};border:1.5px solid ${brd};border-radius:14px;padding:12px;cursor:pointer">
          <div style="font-size:.75rem;font-weight:800;color:var(--navy);margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escH(site?.name||'—')}</div>
          <div style="font-size:.63rem;color:var(--muted);margin-bottom:6px">${new Date(g.visit_date+'T12:00:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'long'})}</div>
          <div style="font-size:1.7rem;font-weight:900;color:${c};line-height:1">${gp!=null?gp+'%':'—'}</div>
          ${(maj||min)?`<div style="display:flex;gap:4px;margin-top:5px;flex-wrap:wrap">
            ${maj?`<span style="font-size:.6rem;font-weight:800;padding:1px 6px;background:#fee2e2;color:#991b1b;border-radius:4px">${maj} maj.</span>`:''}
            ${min?`<span style="font-size:.6rem;font-weight:800;padding:1px 6px;background:#fef3c7;color:#92400e;border-radius:4px">${min} min.</span>`:''}
          </div>`:`<div style="font-size:.63rem;color:#16a34a;margin-top:4px;font-weight:700">✅ Aucune NC</div>`}
        </div>`;
      });
      gmoSection+=`</div>`;
    }
    if(sitesSansGMO.length>0)
      gmoSection+=`<div style="background:#f0f9ff;border:1.5px solid #bae6fd;border-radius:14px;padding:12px 14px;margin-bottom:4px">
        <div style="font-size:.75rem;font-weight:800;color:#0369a1;margin-bottom:8px">📋 ${sitesSansGMO.length} site${sitesSansGMO.length>1?'s':''} sans visite GMO ce mois</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">${sitesSansGMO.map(s=>`<span style="font-size:.7rem;font-weight:700;padding:3px 9px;background:#e0f2fe;color:#0369a1;border-radius:6px">${escH(s.name)}</span>`).join('')}</div>
      </div>`;
  }

  // ══════════════════════════════════════════════════════════════
  // ASSEMBLAGE HTML
  // ══════════════════════════════════════════════════════════════
  const html = `
  <style>
    .ov-kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
    @media(max-width:640px){.ov-kpi-row{grid-template-columns:repeat(2,1fr)}}
    .ov-kpi-card{background:#fff;border:2px solid;border-radius:16px;padding:14px 16px;position:relative;overflow:hidden}
    .ov-kpi-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px}
    .ov-kpi-big{font-size:2.2rem;font-weight:900;line-height:1;margin-bottom:4px}
    .ov-kpi-label{font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)}
    .ov-kpi-sub{font-size:.65rem;color:var(--muted);margin-top:3px}
    .ov-kpi-bar{height:4px;background:rgba(0,0,0,.07);border-radius:2px;margin-top:8px;overflow:hidden}
    .ov-kpi-bar-fill{height:100%;border-radius:2px;transition:width .6s}
    .ov-search-row{display:flex;gap:8px;align-items:center;margin-bottom:18px;flex-wrap:wrap}
    .ov-search-inp{flex:1;min-width:200px;padding:10px 14px;border:1.5px solid var(--border);border-radius:12px;font-size:.85rem;font-family:var(--font);background:#fff;outline:none}
    .ov-search-inp:focus{border-color:var(--navy)}
    .ov-period-btns{display:flex;gap:5px;flex-wrap:wrap}
    .ov-period-btn{padding:8px 12px;border:1.5px solid var(--border);border-radius:10px;font-size:.75rem;font-weight:700;cursor:pointer;font-family:var(--font);background:#fff;color:var(--text);white-space:nowrap}
    .ov-period-btn.on{background:var(--navy);color:#fff;border-color:var(--navy)}
    .ov-period-btn:hover{border-color:var(--navy)}
    .ov-panel{border-radius:14px;padding:14px 16px}
    .ov-panel-danger{background:#fff5f5;border:1.5px solid #fecaca}
    .ov-panel-warn{background:#fffbeb;border:1.5px solid #fde68a}
    .ov-panel-title{font-size:.82rem;font-weight:800;margin-bottom:10px}
    .ov-panel-danger .ov-panel-title{color:#991b1b}
    .ov-panel-warn .ov-panel-title{color:#92400e}
    .ov-nc-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(0,0,0,.06)}
    .ov-nc-row:last-child{border-bottom:none}
    .ov-domain-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px}
    .ov-domain-card{border:1.5px solid var(--border);border-radius:14px;padding:13px;cursor:pointer;transition:transform .15s,box-shadow .15s}
    .ov-domain-card:hover{transform:translateY(-2px);box-shadow:0 4px 16px rgba(0,0,0,.1)}
    .ov-domain-card.ov-dom-empty{background:#faf6fa;opacity:.55;cursor:default}
    .ov-domain-card.ov-dom-empty:hover{transform:none;box-shadow:none}
    .ov-dom-ico{font-size:1.25rem;display:block;margin-bottom:4px}
    .ov-dom-label{font-size:.72rem;font-weight:700;color:var(--text);margin-bottom:2px}
    .ov-dom-sub{font-size:.62rem;color:var(--muted)}
    .ov-section{border-radius:14px;border:1.5px solid}
    .ov-section.crit{border-color:#fecaca}
    .ov-section.warn{border-color:#fde68a}
    .ov-section.ok{border-color:#bbf7d0}
    .ov-section.inactive{border-color:#e2e8f0}
    .ov-sec-hd{background:rgba(0,0,0,.035)}
    .ov-section.crit .ov-sec-hd{background:#fff5f5;color:#991b1b}
    .ov-section.warn .ov-sec-hd{background:#fffbeb;color:#92400e}
    .ov-section.ok .ov-sec-hd{background:#f0fdf4;color:#166534}
    .ov-section.inactive .ov-sec-hd{background:#f8fafc;color:var(--muted)}
    .ov-site-grid{grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;padding:12px!important}
    .ov-site-card{transition:box-shadow .15s,transform .15s}
  </style>

  ${_alertBanner||''}

  <!-- Search + Period -->
  <div class="ov-search-row">
    <input id="ov-search-inp" class="ov-search-inp" type="search" placeholder="🔍 Chercher un établissement…"
      oninput="(function(q){var lq=q.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'');document.querySelectorAll('.ov-site-card[data-search]').forEach(function(el){el.style.display=!lq||el.dataset.search.includes(lq)?'':'none';});})(this.value)">
    <div class="ov-period-btns">
      ${[
        {lbl:'Ce mois', val: mois0},
        {lbl:'Mois préc.', val: (()=>{const d=new Date(mois0+'-01');d.setMonth(d.getMonth()-1);return d.toISOString().slice(0,7);})()},
        {lbl:'3 mois',   val: (()=>{const d=new Date(mois0+'-01');d.setMonth(d.getMonth()-2);return d.toISOString().slice(0,7);})()},
      ].map(p=>`<button class="ov-period-btn ${f0.mois===p.val||(!f0.mois&&p.val===mois0)?'on':''}" onclick="(function(){var el=document.getElementById('filter-mois');if(el){el.value='${p.val}';applyFilters();}})()">${p.lbl}</button>`).join('')}
    </div>
  </div>

  <!-- KPIs -->
  <div class="ov-kpi-row">
    <div class="ov-kpi-card" style="border-color:${colGlob}40">
      <div class="ov-kpi-big" style="color:${colGlob}">${pct}%</div>
      <div class="ov-kpi-label">Conformité globale</div>
      <div class="ov-kpi-bar"><div class="ov-kpi-bar-fill" style="width:${pct}%;background:${colGlob}"></div></div>
      <div class="ov-kpi-sub">${nb} saisies${dernSaisie?' · '+dernSaisie:''}</div>
    </div>
    <div class="ov-kpi-card" style="border-color:${sitesEnAlerte>0?'#fecaca':'#bbf7d0'}">
      <div class="ov-kpi-big" style="color:${sitesEnAlerte>0?'#dc2626':'#16a34a'}">${sitesEnAlerte}</div>
      <div class="ov-kpi-label">Sites en alerte</div>
      <div class="ov-kpi-sub">score &lt; 75% · ${rows.length} actifs</div>
    </div>
    <div class="ov-kpi-card" style="border-color:${ncActives>0?'#fca5a5':'#bbf7d0'}">
      <div class="ov-kpi-big" style="color:${ncActives>0?'#dc2626':'#16a34a'}">${ncActives}</div>
      <div class="ov-kpi-label">NC ouvertes</div>
      <div class="ov-kpi-sub">${recs.filter(r=>isNC(r)).length} NC ce mois</div>
    </div>
    <div class="ov-kpi-card" style="border-color:${sitesInactifs>0?'#e2e8f0':'#bbf7d0'}">
      <div class="ov-kpi-big" style="color:${sitesInactifs>0?'#64748b':'#16a34a'}">${sitesInactifs}</div>
      <div class="ov-kpi-label">Sans saisie ce mois</div>
      <div class="ov-kpi-sub">sur ${allRows.length} site${allRows.length>1?'s':''}</div>
    </div>
  </div>

  ${ncBlock}
  ${domHtml}

  <!-- Sites triés par statut -->
  ${siteSection('🔴 Critiques — score &lt; 70% ou ≥ 6 NC','crit',critiques)}
  ${siteSection('⚠️ À surveiller — score 70–85% ou NC actives','warn',warnings)}
  ${siteSection('✅ Conformes','ok',oks,oks.length>6)}
  ${inactiveRows.length>0?siteSection('⬜ Aucune saisie ce mois','inactive',inactiveRows,true):''}

  ${gmoSection}
  `;

  setContent(html);
}

// ── Panel détail d\'une visite GMO ─────────────────
function openGMODetail(gmoId) {
  const g    = _gmos.find(x => x.id === gmoId);
  if (!g) return;
  const site = _sites.find(s => s.id === g.site_id);
  const sc   = g.scores || {};
  const vals = Object.entries(sc).filter(([k])=>!k.startsWith('_')).map(([,v])=>Number(v));
  const pct  = sc._global != null ? sc._global : vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length) : null;
  const bilan = sc._bilan || [];
  const col   = pct!=null ? gmoColor(pct) : '#a0aec0';

  const bilanHTML = bilan.length === 0
    ? `<div style="text-align:center;padding:16px;color:#16a34a;font-weight:700">✅ Aucune non-conformité relevée</div>`
    : bilan.map((nc,i) => `
      <div style="padding:12px;border-radius:12px;margin-bottom:8px;${nc.niveau==='NC majeure'?'background:#fff5f5;border-left:3px solid #e53e3e':'background:#fffbeb;border-left:3px solid #d69e2e'}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:5px">
          <div>
            <span style="font-size:.65rem;font-weight:800;padding:2px 7px;border-radius:10px;${nc.niveau==='NC majeure'?'background:#fee2e2;color:#991b1b':'background:#fef3c7;color:#92400e'}">${nc.niveau}</span>
            <span style="font-size:.72rem;font-weight:700;color:var(--navy);margin-left:6px">${escH(nc.axe)}</span>
          </div>
          <label style="display:flex;align-items:center;gap:5px;cursor:pointer;flex-shrink:0">
            <input type="checkbox" ${nc.verifie?'checked':''} onchange="gmoToggleVerif('${gmoId}',${i},this.checked)" style="cursor:pointer">
            <span style="font-size:.65rem;font-weight:700;color:var(--muted)">Vérifié ✓</span>
          </label>
        </div>
        <div style="font-size:.75rem;font-weight:600;color:#374151;margin-bottom:4px">▸ ${escH(nc.critere)}</div>
        ${nc.constat?`<div style="font-size:.72rem;color:#4b5563;margin-bottom:4px">📝 <em>${escH(nc.constat)}</em></div>`:''}
        ${nc.action?`<div style="font-size:.72rem;color:#1d4ed8;font-weight:600">→ ${escH(nc.action)}</div>`:''}
        ${nc.verifie?`<div style="font-size:.65rem;color:#16a34a;font-weight:700;margin-top:4px">✅ Corrigé et vérifié</div>`:''}
      </div>`).join('');

  const axeScoresHTML = Object.entries(sc)
    .filter(([k])=>!k.startsWith('_'))
    .map(([k,v])=>{
      const axe = GMO_AXES.find(a=>a.key===k);
      if(!axe) return '';
      const c = gmoColor(Number(v));
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
        <span style="font-size:.78rem;min-width:20px">${axe.icon}</span>
        <span style="font-size:.72rem;color:var(--muted);flex:1">${axe.label}</span>
        <div style="width:80px;height:5px;background:#e2e8f0;border-radius:3px"><div style="width:${v}%;height:100%;background:${c};border-radius:3px"></div></div>
        <span style="font-size:.72rem;font-weight:800;color:${c};min-width:30px;text-align:right">${v}%</span>
      </div>`;
    }).join('');

  const modalHTML = `
  <div id="gmo-detail-overlay" onclick="if(event.target===this)closeGMODetail()" style="position:fixed;inset:0;background:rgba(20,5,25,.7);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto">
    <div style="background:#fff;border-radius:18px;width:100%;max-width:640px;margin:auto;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <!-- Header -->
      <div style="background:linear-gradient(135deg,var(--navy),#1e3a6e);padding:20px 22px;color:#fff">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div style="font-size:.65rem;font-weight:700;color:rgba(255,255,255,.55);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Rapport de visite GMO</div>
            <div style="font-size:1.1rem;font-weight:900">${escH(site?.name||'—')}</div>
            <div style="font-size:.75rem;color:rgba(255,255,255,.6);margin-top:2px">${new Date(g.visit_date+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:2.5rem;font-weight:900;color:${col==='#38a169'?'#86efac':col==='#d69e2e'?'#fcd34d':'#fca5a5'}">${pct!=null?pct+'%':'—'}</div>
            <div style="font-size:.65rem;font-weight:700;color:rgba(255,255,255,.7)">${pct!=null?gmoLabel(pct):''}</div>
          </div>
        </div>
        <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap">
          ${bilan.filter(n=>n.niveau==='NC majeure').length?`<span style="font-size:.65rem;font-weight:800;padding:3px 9px;background:rgba(239,68,68,.3);border-radius:10px;color:#fca5a5">${bilan.filter(n=>n.niveau==='NC majeure').length} NC majeure${bilan.filter(n=>n.niveau==='NC majeure').length>1?'s':''}</span>`:''}
          ${bilan.filter(n=>n.niveau==='NC mineure').length?`<span style="font-size:.65rem;font-weight:800;padding:3px 9px;background:rgba(251,191,36,.25);border-radius:10px;color:#fcd34d">${bilan.filter(n=>n.niveau==='NC mineure').length} NC mineure${bilan.filter(n=>n.niveau==='NC mineure').length>1?'s':''}</span>`:''}
          ${bilan.filter(n=>n.verifie).length?`<span style="font-size:.65rem;font-weight:800;padding:3px 9px;background:rgba(52,211,153,.2);border-radius:10px;color:#6ee7b7">${bilan.filter(n=>n.verifie).length} corrigée${bilan.filter(n=>n.verifie).length>1?'s':''}</span>`:''}
        </div>
      </div>

      <div style="padding:18px 22px;max-height:70vh;overflow-y:auto">
        <!-- Scores axes -->
        <div style="font-size:.72rem;font-weight:800;text-transform:uppercase;color:var(--muted);letter-spacing:.5px;margin-bottom:8px">Scores par axe</div>
        <div style="background:#faf6fa;border-radius:10px;padding:12px;margin-bottom:16px">${axeScoresHTML}</div>

        <!-- Bilan NC -->
        <div style="font-size:.72rem;font-weight:800;text-transform:uppercase;color:var(--muted);letter-spacing:.5px;margin-bottom:8px">Bilan des non-conformités</div>
        ${bilanHTML}

        <!-- Observations -->
        ${g.observations?`
        <div style="font-size:.72rem;font-weight:800;text-transform:uppercase;color:var(--muted);letter-spacing:.5px;margin-bottom:8px;margin-top:14px">Observations générales</div>
        <div style="background:#faf6fa;border-radius:10px;padding:12px;font-size:.78rem;color:var(--text);font-style:italic">${escH(g.observations)}</div>`:''}
      </div>

      <!-- Footer -->
      <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:10px;justify-content:flex-end">
        <button onclick="closeGMODetail()" style="padding:9px 18px;background:#f1f5f9;color:var(--text);border:none;border-radius:12px;font-size:.82rem;font-weight:700;cursor:pointer;font-family:var(--font)">Fermer</button>
        <button onclick="generateGMOPDF('${gmoId}')" style="padding:9px 18px;background:linear-gradient(135deg,var(--navy),var(--navy2));color:#fff;border:none;border-radius:12px;font-size:.82rem;font-weight:800;cursor:pointer;font-family:var(--font);display:flex;align-items:center;gap:6px">📄 Télécharger PDF</button>
      </div>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', modalHTML);
}

function closeGMODetail() {
  document.getElementById('gmo-detail-overlay')?.remove();
}

async function gmoToggleVerif(gmoId, ncIndex, checked) {
  const g = _gmos.find(x => x.id === gmoId);
  if (!g) return;
  const sc = JSON.parse(JSON.stringify(g.scores || {}));
  if (!sc._bilan || !sc._bilan[ncIndex]) return;
  sc._bilan[ncIndex].verifie = checked;

  try {
    await supa('PATCH', `/rest/v1/gmo?id=eq.${gmoId}`, { scores: sc });
    g.scores = sc;
    showToast(checked ? '✅ NC marquée comme corrigée' : 'NC remise en attente', 'success');
    // Rafraîchir le détail ET le dashboard si besoin
    closeGMODetail();
    openGMODetail(gmoId);
    // Mettre à jour la vue d'ensemble en arrière-plan
    if (_currentPage === 'overview') renderPage('overview');
  } catch(e) {
    showToast('Erreur : ' + e.message, 'error');
  }
}

// ════════════════════════════════════════════════════
// PAGE : ADMIN — Gérer l'organisation
// ════════════════════════════════════════════════════

// ════════════════════════════════════════════════════
// ADMIN — Gérer l'organisation
// ════════════════════════════════════════════════════
let _adminTab = 'overview';
let _adminModal = null; // {type, id, data}

async function loadAdminCorrectiveData(){
  try{
    const [actions, mappings] = await Promise.all([
      supaAdmin('GET','/rest/v1/corrective_actions?select=*&order=category.asc,name.asc',null),
      supaAdmin('GET','/rest/v1/nc_action_mapping?select=*&order=non_conformity_type.asc',null),
    ]);
    _correctiveActions = Array.isArray(actions) ? actions : [];
    _ncActionMappings = Array.isArray(mappings) ? mappings : [];
  } catch(e){
    _correctiveActions = [];
    _ncActionMappings = [];
    console.warn('[admin corrective]', e.message);
  }
}

async function renderAdmin(){
  const role = _profile?.role || '';
  const canManageOrg = ['siege','super_admin'].includes(role);
  const canSendAlerts = ['super_admin','siege','directeur','chef_secteur'].includes(role);
  if(!canManageOrg && !canSendAlerts){
    setContent(`<div class="empty"><div class="empty-ico">🔒</div><strong>Accès restreint</strong><br>La gestion de l\'organisation est réservée au rôle Siège.</div>`);
    return;
  }
  if(!canManageOrg) _adminTab = 'alerts';
  // Sur la page "admin" (Gérer l'organisation), s'assurer que l'onglet est un onglet d'organisation,
  // pas Actions NC / Alertes tablettes (qui sont devenues des pages top-level).
  if(_currentPage==='admin' && canManageOrg && !['overview','sites','users'].includes(_adminTab)){
    _adminTab = 'overview';
  }
  if(canManageOrg){
    await Promise.all([
      loadAdminCorrectiveData(),
      loadKnowledgeData(),
      loadTabletAlertsHistory()
    ]);
  } else {
    await loadTabletAlertsHistory();
  }
  // Charger profils — super_admin voit tout via proxy, les autres filtrent par tenant
  let profiles = [];
  const adminTenantFilter = _profile?.tenant_id ? `&tenant_id=eq.${_profile.tenant_id}` : '';
  if(canManageOrg){
    if(_profile?.role === 'super_admin'){
      try { profiles = await supaAdmin('GET', `/rest/v1/profiles?select=*&order=created_at`, null); } catch{}
    } else {
      try { profiles = await supaGet('profiles', `select=*&order=created_at${adminTenantFilter}`); } catch{}
    }
  }

  const knownCodes = new Set(_sites.map(s=>s.code));
  const unknownCodes = [...new Set(_records.map(r=>r.site_id).filter(Boolean))].filter(c=>!knownCodes.has(c));

  // Stats par site
  const siteStats = {};
  _records.forEach(r=>{
    if(!siteStats[r.site_id]) siteStats[r.site_id]={total:0,nc:0,lastSync:null};
    siteStats[r.site_id].total++;
    if(isNC(r)) siteStats[r.site_id].nc++;
    if(!siteStats[r.site_id].lastSync||r.recorded_at>siteStats[r.site_id].lastSync)
      siteStats[r.site_id].lastSync=r.recorded_at;
  });

  const tabs = canManageOrg ? [
    {key:'overview',  label:'🏗️ Organisation'},
    {key:'sites',     label:`🏠 Sites${unknownCodes.length?` <span style="background:#dc2626;color:#fff;border-radius:10px;padding:1px 6px;font-size:.6rem;font-weight:800">${unknownCodes.length}!</span>`:''}` },
    {key:'users',     label:'👥 Utilisateurs'},
  ] : [];

  // Tabs affichées uniquement sur la page "admin" classique (pas sur les pages dédiées Alertes/Actions NC)
  const tabsHtml = (tabs.length && _currentPage==='admin')
    ? `<div style="display:flex;gap:4px;margin-bottom:18px;border-bottom:2px solid var(--border);padding-bottom:0">
      ${tabs.map(t=>`<button onclick="switchAdminTab('${t.key}')" style="padding:9px 16px;font-size:.8rem;font-weight:700;cursor:pointer;border:1px solid ${_adminTab===t.key?'var(--border)':'transparent'};border-bottom:${_adminTab===t.key?'2px solid #fff':'none'};border-radius:10px 10px 0 0;background:${_adminTab===t.key?'#fff':'transparent'};color:${_adminTab===t.key?'var(--navy)':'var(--muted)'};font-family:var(--font);margin-bottom:-2px">${t.label}</button>`).join('')}
    </div>`
    : '';

  let html = `
  <!-- Modal édition -->
  <div id="admin-modal-ov" onclick="if(event.target===this)closeAdminModal()" style="display:none;position:fixed;inset:0;background:rgba(20,5,25,.7);z-index:2000;align-items:flex-end;justify-content:center">
    <div id="admin-modal-box" style="background:#fff;border-radius:20px 20px 0 0;width:100%;max-width:560px;max-height:88vh;overflow-y:auto;padding:0 0 28px">
      <div id="admin-modal-content"></div>
    </div>
  </div>

  ${tabsHtml}`;

  // ══ TAB : ORGANISATION (arborescence) ══════════════════
  if (_adminTab === 'overview') {
    // Vue hiérarchique : territoire → secteur → site avec stats
    html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div style="font-size:.72rem;color:var(--muted)">${_territories.length} territoire(s) · ${_sectors.length} secteur(s) · ${_sites.length} site(s)</div>
      <div style="display:flex;gap:8px">
        <button onclick="openAdminModal('territory',null)" style="padding:7px 14px;background:var(--navy);color:#fff;border:none;border-radius:20px;font-size:.75rem;font-weight:800;cursor:pointer;font-family:var(--font)">+ Territoire</button>
        <button onclick="openAdminModal('sector',null)" style="padding:7px 14px;background:#475569;color:#fff;border:none;border-radius:20px;font-size:.75rem;font-weight:800;cursor:pointer;font-family:var(--font)">+ Secteur</button>
      </div>
    </div>`;

    if (_territories.length === 0 && _sectors.length === 0 && _sites.length === 0) {
      html += `<div class="empty"><div class="empty-ico">🏗️</div><strong>Organisation vide</strong><br>Commencez par créer un territoire, puis des secteurs et des sites.</div>`;
    }

    // Sites sans territoire/secteur
    const sitesOrphelins = _sites.filter(s=>!s.sector_id);

    _territories.forEach(t => {
      const tSectors = _sectors.filter(s=>s.territory_id===t.id);
      const tSites = _sites.filter(s=>tSectors.some(sc=>sc.id===s.sector_id));
      const tRecs = _records.filter(r=>tSites.some(st=>st.code===r.site_id));
      const tPct = tRecs.length>0?Math.round((1-tRecs.filter(r=>isNC(r)).length/tRecs.length)*100):null;
      const tCol = tPct===null?'var(--muted)':tPct>=90?'#16a34a':tPct>=75?'#d97706':'#dc2626';

      html += `<div style="background:var(--card);border-radius:16px;border:1px solid var(--border);margin-bottom:14px;overflow:hidden;box-shadow:0 2px 14px var(--sh)">
        <!-- Territoire header -->
        <div style="background:var(--navy);color:#fff;padding:12px 16px;display:flex;align-items:center;gap:10px">
          <span style="font-size:1.1rem">🗺️</span>
          <div style="flex:1">
            <div style="font-size:.9rem;font-weight:800">${escH(t.name)}</div>
            <div style="font-size:.65rem;color:rgba(255,255,255,.5)">${t.code} · ${tSectors.length} secteur(s) · ${tSites.length} site(s)</div>
          </div>
          ${tPct!==null?`<span style="font-size:.85rem;font-weight:800;color:${tPct>=90?'#86efac':tPct>=75?'#fcd34d':'#fca5a5'}">${tPct}%</span>`:''}
          <div style="display:flex;gap:6px">
            <button onclick="openAdminModal('territory','${t.id}')" style="padding:4px 10px;background:rgba(255,255,255,.15);color:#fff;border:none;border-radius:6px;font-size:.7rem;cursor:pointer;font-family:var(--font)">✏️</button>
            <button onclick="confirmDelete('territories','${t.id}','${escH(t.name)}')" style="padding:4px 10px;background:rgba(255,255,255,.1);color:#fca5a5;border:none;border-radius:6px;font-size:.7rem;cursor:pointer;font-family:var(--font)">🗑</button>
          </div>
        </div>
        <!-- Secteurs -->
        ${tSectors.length===0?`<div style="padding:12px 16px;font-size:.75rem;color:var(--muted);font-style:italic">Aucun secteur — <button onclick="openAdminModal('sector',null,{territory_id:'${t.id}'})" style="background:none;border:none;color:var(--navy);font-weight:700;cursor:pointer;font-family:var(--font);font-size:.75rem">+ Créer un secteur</button></div>`:''}
        ${tSectors.map(sc=>{
          const scSites=_sites.filter(s=>s.sector_id===sc.id);
          const scRecs=_records.filter(r=>scSites.some(st=>st.code===r.site_id));
          const scPct=scRecs.length>0?Math.round((1-scRecs.filter(r=>isNC(r)).length/scRecs.length)*100):null;
          const scCol=scPct===null?'var(--muted)':scPct>=90?'#16a34a':scPct>=75?'#d97706':'#dc2626';

          return `<div style="border-top:1px solid var(--border)">
            <!-- Secteur header -->
            <div style="padding:10px 16px;background:#faf6fa;display:flex;align-items:center;gap:8px">
              <span style="font-size:.85rem">🏢</span>
              <div style="flex:1">
                <div style="font-size:.82rem;font-weight:700">${escH(sc.name)}</div>
                <div style="font-size:.65rem;color:var(--muted)">${sc.code} · ${scSites.length} site(s)</div>
              </div>
              ${scPct!==null?`<span style="font-size:.78rem;font-weight:800;color:${scCol}">${scPct}%</span>`:''}
              <div style="display:flex;gap:4px">
                <button onclick="openAdminModal('sector','${sc.id}')" style="padding:3px 8px;background:#e2e8f0;color:var(--navy);border:none;border-radius:5px;font-size:.68rem;cursor:pointer;font-family:var(--font)">✏️</button>
                <button onclick="confirmDelete('sectors','${sc.id}','${escH(sc.name)}')" style="padding:3px 8px;background:#fff5f5;color:#dc2626;border:none;border-radius:5px;font-size:.68rem;cursor:pointer;font-family:var(--font)">🗑</button>
                <button onclick="openAdminModal('site',null,{sector_id:'${sc.id}'})" style="padding:3px 8px;background:var(--navy);color:#fff;border:none;border-radius:5px;font-size:.68rem;cursor:pointer;font-family:var(--font)">+ Site</button>
              </div>
            </div>
            <!-- Sites du secteur -->
            ${scSites.length===0?`<div style="padding:8px 16px 8px 32px;font-size:.72rem;color:var(--muted);font-style:italic">Aucun site</div>`:''}
            ${scSites.map(s=>{
              const st=siteStats[s.code]||{total:0,nc:0,lastSync:null};
              const sPct=st.total>0?Math.round((1-st.nc/st.total)*100):null;
              const sCol=sPct===null?'var(--muted)':sPct>=90?'#16a34a':sPct>=75?'#d97706':'#dc2626';
              const lastSync=st.lastSync?new Date(st.lastSync).toLocaleDateString('fr-FR',{day:'numeric',month:'short'}):'—';
              return `<div style="padding:8px 16px 8px 28px;border-top:1px solid #f1f5f9;display:flex;align-items:center;gap:8px">
                <span style="width:6px;height:6px;border-radius:50%;background:${sPct!==null?sCol:'#cbd5e0'};flex-shrink:0"></span>
                <div style="flex:1;min-width:0">
                  <div style="font-size:.8rem;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escH(s.name)}</div>
                  <div style="font-size:.65rem;color:var(--muted)">Code: <strong>${s.code}</strong> · ${st.total} saisies · sync: ${lastSync}</div>
                </div>
                ${sPct!==null?`<span style="font-size:.75rem;font-weight:800;color:${sCol};flex-shrink:0">${sPct}%</span>`:'<span style="font-size:.65rem;color:var(--muted)">Aucune donnée</span>'}
                <div style="display:flex;gap:4px;flex-shrink:0">
                  <button onclick="createTabletAccount('${s.id}','${escH(s.name)}','${s.code}')" style="padding:3px 8px;background:#f0fdf4;color:#166534;border:none;border-radius:5px;font-size:.68rem;cursor:pointer;font-family:var(--font)" title="Créer compte tablette">📱</button>
                  <button onclick="openAdminModal('site','${s.id}')" style="padding:3px 8px;background:#e2e8f0;color:var(--navy);border:none;border-radius:5px;font-size:.68rem;cursor:pointer;font-family:var(--font)">✏️</button>
                  <button onclick="confirmDelete('sites','${s.id}','${escH(s.name)}')" style="padding:3px 8px;background:#fff5f5;color:#dc2626;border:none;border-radius:5px;font-size:.68rem;cursor:pointer;font-family:var(--font)">🗑</button>
                </div>
              </div>`;
            }).join('')}
          </div>`;
        }).join('')}
      </div>`;
    });

    // Secteurs sans territoire
    const sectsOrphelins = _sectors.filter(s=>!s.territory_id);
    if (sectsOrphelins.length > 0) {
      html += `<div style="background:var(--card);border-radius:16px;border:1.5px dashed var(--border);margin-bottom:14px;overflow:hidden">
        <div style="padding:10px 16px;background:#faf6fa;font-size:.78rem;font-weight:700;color:var(--muted)">📁 Secteurs sans territoire (${sectsOrphelins.length})</div>
        ${sectsOrphelins.map(sc=>`<div style="padding:10px 16px;border-top:1px solid var(--border);display:flex;align-items:center;gap:8px">
          <div style="flex:1"><div style="font-size:.82rem;font-weight:700">${escH(sc.name)}</div><div style="font-size:.65rem;color:var(--muted)">${sc.code}</div></div>
          <button onclick="openAdminModal('sector','${sc.id}')" style="padding:3px 8px;background:#e2e8f0;color:var(--navy);border:none;border-radius:5px;font-size:.68rem;cursor:pointer;font-family:var(--font)">✏️ Rattacher</button>
        </div>`).join('')}
      </div>`;
    }

    // Sites orphelins
    if (sitesOrphelins.length > 0) {
      html += `<div style="background:var(--card);border-radius:16px;border:1.5px dashed #fbd38d;margin-bottom:14px;overflow:hidden">
        <div style="padding:10px 16px;background:#fffbeb;font-size:.78rem;font-weight:700;color:#92400e">🏠 Sites sans secteur (${sitesOrphelins.length})</div>
        ${sitesOrphelins.map(s=>`<div style="padding:10px 16px;border-top:1px solid #fde68a;display:flex;align-items:center;gap:8px">
          <div style="flex:1"><div style="font-size:.82rem;font-weight:700">${escH(s.name)}</div><div style="font-size:.65rem;color:var(--muted)">Code: ${s.code}</div></div>
          <button onclick="openAdminModal('site','${s.id}')" style="padding:3px 8px;background:#fef3c7;color:#92400e;border:1px solid #fbd38d;border-radius:5px;font-size:.68rem;cursor:pointer;font-family:var(--font)">✏️ Rattacher</button>
        </div>`).join('')}
      </div>`;
    }
  }

  // ══ TAB : SITES ════════════════════════════════════════
  else if (_adminTab === 'sites') {
    html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div style="font-size:.72rem;color:var(--muted)">${_sites.length} site(s) enregistré(s)</div>
      <button onclick="openAdminModal('site',null)" style="padding:7px 14px;background:var(--navy);color:#fff;border:none;border-radius:20px;font-size:.75rem;font-weight:800;cursor:pointer;font-family:var(--font)">+ Nouveau site</button>
    </div>`;

    // Alerte sites inconnus
    if (unknownCodes.length > 0) {
      html += `<div style="background:#fffbeb;border:1.5px solid #fbd38d;border-radius:14px;margin-bottom:14px;overflow:hidden">
        <div style="padding:12px 16px;font-size:.82rem;font-weight:800;color:#92400e">⚠️ ${unknownCodes.length} code(s) non enregistré(s) — envoient des données !</div>
        ${unknownCodes.map(code=>{
          const st=siteStats[code]||{total:0};
          return `<div style="padding:10px 16px;border-top:1px solid #fde68a;display:flex;align-items:center;gap:10px">
            <div style="flex:1">
              <div style="font-size:.82rem;font-weight:700;color:#92400e">📡 ${code}</div>
              <div style="font-size:.68rem;color:var(--muted)">${st.total} saisie(s) reçue(s) — non rattaché à un établissement</div>
            </div>
            <button onclick="openAdminModal('site',null,{code:'${code}'})" style="padding:6px 12px;background:var(--navy);color:#fff;border:none;border-radius:7px;font-size:.75rem;font-weight:800;cursor:pointer;font-family:var(--font)">Enregistrer →</button>
          </div>`;
        }).join('')}
      </div>`;
    }

    // Liste tous les sites avec stats
    _sites.forEach(s=>{
      const sect=_sectors.find(x=>x.id===s.sector_id);
      const terr=sect?_territories.find(t=>t.id===sect.territory_id):null;
      const st=siteStats[s.code]||{total:0,nc:0,lastSync:null};
      const pct=st.total>0?Math.round((1-st.nc/st.total)*100):null;
      const col=pct===null?'var(--muted)':pct>=90?'#16a34a':pct>=75?'#d97706':'#dc2626';
      const lastSync=st.lastSync?new Date(st.lastSync).toLocaleDateString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'Jamais';

      html+=`<div style="background:var(--card);border-radius:14px;border:1px solid var(--border);margin-bottom:10px;padding:14px 16px">
        <div style="display:flex;align-items:flex-start;gap:10px">
          <div style="width:8px;height:8px;border-radius:50%;background:${pct!==null?col:'#cbd5e0'};margin-top:6px;flex-shrink:0"></div>
          <div style="flex:1;min-width:0">
            <div style="font-size:.88rem;font-weight:800">${escH(s.name)}</div>
            <div style="font-size:.72rem;color:var(--muted);margin-top:2px">
              Code tablette: <strong>${s.code}</strong>
              ${terr?` · 🗺️ ${terr.name}`:''}${sect?` › 🏢 ${sect.name}`:''}
            </div>
            ${s.address?`<div style="font-size:.68rem;color:var(--muted)">📍 ${escH(s.address)}</div>`:''}
            <div style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap">
              <div style="font-size:.7rem"><span style="color:var(--muted)">Saisies :</span> <strong>${st.total}</strong></div>
              <div style="font-size:.7rem"><span style="color:var(--muted)">NC :</span> <strong style="color:${st.nc>0?'#dc2626':'#16a34a'}">${st.nc}</strong></div>
              <div style="font-size:.7rem"><span style="color:var(--muted)">Conformité :</span> <strong style="color:${col}">${pct!==null?pct+'%':'—'}</strong></div>
              <div style="font-size:.7rem"><span style="color:var(--muted)">Dernière sync :</span> ${lastSync}</div>
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button onclick="openAdminModal('site','${s.id}')" style="padding:5px 10px;background:#e2e8f0;color:var(--navy);border:none;border-radius:7px;font-size:.72rem;font-weight:700;cursor:pointer;font-family:var(--font)">✏️ Modifier</button>
            <button onclick="confirmDelete('sites','${s.id}','${escH(s.name)}')" style="padding:5px 10px;background:#fff5f5;color:#dc2626;border:none;border-radius:7px;font-size:.72rem;font-weight:700;cursor:pointer;font-family:var(--font)">🗑</button>
          </div>
        </div>
      </div>`;
    });
  }

  // ══ TAB : UTILISATEURS ═════════════════════════════════
  else if (_adminTab === 'users') {
    const roleCls={siege:'role-siege',directeur:'role-directeur',chef_secteur:'role-chef',cuisinier:'role-cuisinier'};
    const roleLabel={siege:'Siège',directeur:'Directeur',chef_secteur:'Chef de secteur',cuisinier:'Cuisinier'};
    const roleIco={siege:'🏛️',directeur:'📊',chef_secteur:'👔',cuisinier:'👨‍🍳'};
    const hasAdmin = !!_token; // proxy admin-proxy toujours disponible si connecté

    html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <div style="font-size:.78rem;color:var(--muted);font-weight:600">${profiles.length} utilisateur(s) enregistré(s)</div>
      <button onclick="openAdminModal('create-user',null)" style="padding:8px 16px;background:var(--navy);color:#fff;border:none;border-radius:12px;font-size:.78rem;font-weight:800;cursor:pointer;font-family:var(--font);display:flex;align-items:center;gap:6px">
        ➕ Inviter un utilisateur
      </button>
    </div>
    ${!hasAdmin?`<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:.75rem;color:#92400e">
      <strong>💡 Pour inviter des utilisateurs :</strong> renseignez la clé <strong>service_role</strong> dans l\'écran de connexion (Supabase → Settings → API → service_role). Elle ne sert qu\'à la création de comptes.
    </div>`:''}`;

    // Grouper par rôle
    const roleOrder=['siege','directeur','chef_secteur','cuisinier'];
    roleOrder.forEach(role=>{
      const roleProfiles=profiles.filter(p=>p.role===role);
      if(!roleProfiles.length) return;

      html+=`<div style="margin-bottom:18px">
        <div style="font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-bottom:8px;display:flex;align-items:center;gap:6px">
          ${roleIco[role]} ${roleLabel[role]} <span style="background:#f1f5f9;padding:1px 8px;border-radius:10px">${roleProfiles.length}</span>
        </div>`;

      roleProfiles.forEach(p=>{
        const site=_sites.find(s=>s.id===p.site_id);
        const sect=_sectors.find(s=>s.id===p.sector_id);
        const terr=_territories.find(t=>t.id===p.territory_id);
        // Stats de cet utilisateur
        const userRecs=_records.filter(r=>{
          if(site) return r.site_id===site.code;
          if(sect) return _sites.filter(s=>s.sector_id===sect.id).some(s=>r.site_id===s.code);
          return false;
        });
        const scope=site?site.name:sect?sect.name:terr?terr.name:'—';
        const scopeIco=site?'🏠':sect?'🏢':terr?'🗺️':'';
        const initials=(p.full_name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();

        html+=`<div style="background:var(--card);border-radius:14px;border:1px solid var(--border);padding:0;margin-bottom:8px;overflow:hidden">
          <!-- Ligne principale -->
          <div style="padding:13px 14px;display:flex;align-items:center;gap:12px">
            <!-- Avatar -->
            <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--navy),#3b82f6);color:#fff;display:flex;align-items:center;justify-content:center;font-size:.82rem;font-weight:800;flex-shrink:0">${initials}</div>
            <!-- Infos -->
            <div style="flex:1;min-width:0">
              <div style="font-size:.88rem;font-weight:800;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                ${escH(p.full_name||'Sans nom')}
                <span class="badge-role ${roleCls[role]||''}" style="font-size:.6rem">${roleLabel[role]}</span>
              </div>
              <div style="font-size:.7rem;color:var(--muted);margin-top:2px">
                ${scopeIco?`${scopeIco} ${escH(scope)}`:'Périmètre non défini'}
                ${p.email?` · 📧 ${escH(p.email)}`:''}
                ${p.phone?` · 📞 ${escH(p.phone)}`:''}
                ${userRecs.length?` · ${userRecs.length} saisie(s)`:''}
              </div>
            </div>
            <!-- Actions -->
            <div style="display:flex;gap:6px;flex-shrink:0">
              ${(role==='chef_secteur'||role==='directeur') && (_profile?.role==='siege'||_profile?.role==='super_admin'||_profile?.role==='directeur') ? `
              <button onclick="toggleDataLock('${p.id}',${!!p.data_locked})"
                style="padding:6px 10px;background:${p.data_locked?'#fee2e2':'#f0fdf4'};color:${p.data_locked?'#991b1b':'#166534'};border:none;border-radius:7px;font-size:.72rem;font-weight:800;cursor:pointer;font-family:var(--font)"
                title="${p.data_locked?'Déverrouiller l\'accès aux données':'Verrouiller l\'accès aux données'}">
                ${p.data_locked?'🔒 Verrouillé':'🔓 Actif'}
              </button>` : ''}
              <button onclick="openUserDetail('${p.id}')" style="padding:6px 10px;background:#f1f5f9;color:var(--navy);border:none;border-radius:7px;font-size:.72rem;font-weight:700;cursor:pointer;font-family:var(--font)">👁 Voir</button>
              <button onclick="openAdminModal('user','${p.id}')" style="padding:6px 10px;background:#e2e8f0;color:var(--navy);border:none;border-radius:7px;font-size:.72rem;font-weight:700;cursor:pointer;font-family:var(--font)">✏️</button>
            </div>
          </div>
        </div>`;
      });
      html+=`</div>`;
    });
  }

  // ══ TAB : ACTIONS CORRECTIVES NC ═════════════════════
  else if (_adminTab === 'corrective') {
    const typeLabels = {
      temperature:'🌡️ Température',
      hygiene:'🧼 Hygiène',
      storage:'📦 Stockage',
      autre:'📝 Autre'
    };
    const byType = {temperature:[],hygiene:[],storage:[],autre:[]};
    (_ncActionMappings||[]).forEach(m=>{
      const key = (m.non_conformity_type||'autre').toLowerCase();
      if(!byType[key]) byType[key]=[];
      byType[key].push(m.corrective_action_id);
    });
    const actionNameById = new Map((_correctiveActions||[]).map(a=>[a.id,a.name]));

    html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:8px;flex-wrap:wrap">
      <div style="font-size:.78rem;color:var(--muted);font-weight:600">${_correctiveActions.length} action(s) · ${_ncActionMappings.length} liaison(s)</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button onclick="openAdminModal('corrective-action',null)" style="padding:8px 14px;background:var(--navy);color:#fff;border:none;border-radius:11px;font-size:.78rem;font-weight:800;cursor:pointer;font-family:var(--font)">+ Action corrective</button>
      </div>
    </div>`;

    html += `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:10px 12px;margin-bottom:12px;font-size:.73rem;color:#92400e">
      Les actions sélectionnées ici sont proposées automatiquement aux équipes cuisine lors d'une non-conformité.
    </div>`;

    html += `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:10px 12px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <div style="font-size:.72rem;color:#1e3a8a;font-weight:800">🧠 Base apprenante (copie problème/action depuis les NC)</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button onclick="openAdminModal('knowledge-problem',null)" style="padding:6px 10px;background:#dbeafe;color:#1e3a8a;border:none;border-radius:8px;font-size:.72rem;font-weight:800;cursor:pointer;font-family:var(--font)">+ Problème type</button>
          <button onclick="openAdminModal('knowledge-recommendation',null)" style="padding:6px 10px;background:#1e3a8a;color:#fff;border:none;border-radius:8px;font-size:.72rem;font-weight:800;cursor:pointer;font-family:var(--font)">+ Recommandation</button>
        </div>
      </div>
      <div style="font-size:.7rem;color:#334155;margin-top:6px">${_knowledgeProblems.length} problème(s) type · ${_knowledgeRecommendations.length} recommandation(s) apprises</div>
    </div>`;

    if(_knowledgeRecommendations.length){
      html += `<div style="margin-bottom:12px">
        <div style="font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-bottom:8px">Recommandations apprises</div>
        <div style="background:#fff;border:1px solid var(--border);border-radius:12px;padding:10px 12px">
          ${_knowledgeRecommendations.slice(0,30).map(r=>{
            const dispType = displayNCTypeFromItem(r);
            const typeLabel = NC_TYPE_DISPLAY_LABELS[dispType]||dispType;
            return `<div style="padding:7px 0;border-bottom:1px solid #eef2f7;display:flex;gap:8px;align-items:flex-start">
            <div style="flex:1;min-width:0">
              <div style="font-size:.68rem;color:#64748b;margin-bottom:2px">${typeLabel}${r.source_site_code?` · ${escH(r.source_site_code)}`:''}</div>
              <div style="font-size:.78rem;font-weight:800;color:#0f172a">${escH(r.problem||'')}</div>
              <div style="font-size:.76rem;color:#1e3a8a;margin-top:2px">→ ${escH(r.action||'')}</div>
            </div>
            <button onclick="deleteKnowledgeItem('recommendation','${r.id}')" style="padding:4px 8px;background:#fff5f5;color:#dc2626;border:none;border-radius:7px;font-size:.68rem;font-weight:700;cursor:pointer;font-family:var(--font)">🗑</button>
          </div>`;}).join('')}
        </div>
      </div>`;
    }

    if(_knowledgeProblems.length){
      html += `<div style="margin-bottom:12px">
        <div style="font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-bottom:8px">Problèmes types</div>
        <div style="background:#fff;border:1px solid var(--border);border-radius:12px;padding:10px 12px">
          ${_knowledgeProblems.slice(0,30).map((p,idx)=>{
            const dispType = displayNCTypeFromItem(p);
            const typeLabel = NC_TYPE_DISPLAY_LABELS[dispType]||dispType;
            return `<div style="padding:7px 0;border-bottom:1px solid #eef2f7;display:flex;gap:8px;align-items:flex-start">
            <div style="flex:1;min-width:0">
              <div style="font-size:.68rem;color:#64748b;margin-bottom:2px">${typeLabel}${p.source_site_code?` · ${escH(p.source_site_code)}`:''}</div>
              <div style="font-size:.78rem;font-weight:800;color:#0f172a">${escH(p.problem||'')}</div>
            </div>
            <button onclick="copyKnowledgeProblem(${idx})" style="padding:4px 8px;background:#eff6ff;color:#1e3a8a;border:none;border-radius:7px;font-size:.68rem;font-weight:700;cursor:pointer;font-family:var(--font)">📋</button>
            <button onclick="deleteKnowledgeItem('problem','${p.id}')" style="padding:4px 8px;background:#fff5f5;color:#dc2626;border:none;border-radius:7px;font-size:.68rem;font-weight:700;cursor:pointer;font-family:var(--font)">🗑</button>
          </div>`;}).join('')}
        </div>
      </div>`;
    }

    // Mappings par type
    html += `<div style="margin-bottom:14px">
      <div style="font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-bottom:8px">Types NC et actions recommandées</div>
      ${Object.keys(typeLabels).map(type=>{
        const ids = [...new Set(byType[type]||[])];
        return `<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:10px 12px;margin-bottom:8px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
            <div style="font-size:.82rem;font-weight:800">${typeLabels[type]}</div>
            <button onclick="openAdminModal('corrective-mapping','${type}')" style="padding:5px 10px;background:#e2e8f0;color:var(--navy);border:none;border-radius:7px;font-size:.72rem;font-weight:700;cursor:pointer;font-family:var(--font)">Gérer</button>
          </div>
          <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
            ${ids.length ? ids.map(id=>`<span style="background:#fef2f2;color:#991b1b;border:1px solid #fecaca;border-radius:20px;padding:3px 9px;font-size:.68rem;font-weight:700">${escH(actionNameById.get(id)||id)}</span>`).join('') : '<span style="font-size:.72rem;color:var(--muted)">Aucune action liée</span>'}
          </div>
        </div>`;
      }).join('')}
    </div>`;

    // Catalogue actions
    const categories = ['temperature','hygiene','storage','autre'];
    html += `<div style="font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-bottom:8px">Catalogue des actions</div>`;
    categories.forEach(cat=>{
      const rows = (_correctiveActions||[]).filter(a=>(a.category||'autre').toLowerCase()===cat);
      if(!rows.length) return;
      html += `<div style="background:#fff;border:1px solid var(--border);border-radius:12px;padding:10px 12px;margin-bottom:8px">
        <div style="font-size:.8rem;font-weight:800;color:var(--navy);margin-bottom:8px">${typeLabels[cat]||cat}</div>
        ${rows.map(a=>`<div style="padding:8px 0;border-top:1px solid #f1f5f9;display:flex;align-items:flex-start;gap:10px">
          <div style="flex:1;min-width:0">
            <div style="font-size:.8rem;font-weight:800;color:#1f2937">${escH(a.name||'')}</div>
            ${a.description?`<div style="font-size:.72rem;color:var(--muted);margin-top:2px">${escH(a.description)}</div>`:''}
            ${a.is_default?`<span style="display:inline-block;margin-top:4px;background:#ecfdf5;color:#166534;border-radius:10px;padding:1px 7px;font-size:.62rem;font-weight:800">Par défaut</span>`:''}
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button onclick="openAdminModal('corrective-action','${a.id}')" style="padding:4px 9px;background:#e2e8f0;color:var(--navy);border:none;border-radius:7px;font-size:.7rem;font-weight:700;cursor:pointer;font-family:var(--font)">✏️</button>
            <button onclick="confirmDelete('corrective_actions','${a.id}','${escH(a.name||'')}')" style="padding:4px 9px;background:#fff5f5;color:#dc2626;border:none;border-radius:7px;font-size:.7rem;font-weight:700;cursor:pointer;font-family:var(--font)">🗑</button>
          </div>
        </div>`).join('')}
      </div>`;
    });
    if(!_correctiveActions.length){
      html += `<div class="empty"><div class="empty-ico">🛠️</div><strong>Aucune action corrective</strong><br>Ajoutez des actions pour alimenter les suggestions ENR30.</div>`;
    }
  }
  else if (_adminTab === 'alerts') {
    const targetCodes = getScopedSiteCodes();
    const targetLabel = targetCodes.length ? `${targetCodes.length} site(s) ciblé(s)` : 'Aucun site ciblé';
    const zonesForReq = getScopedCleaningZones();
    const zoneOptions = zonesForReq.length
      ? zonesForReq.map(z=>`<option value="${escAttr(z)}">${escH(z)}</option>`).join('')
      : `<option value="">Aucune zone détectée (ajoutez des zones dans le PMS)</option>`;
    html += `<div style="background:#fff;border:1px solid var(--border);border-radius:14px;padding:14px;margin-bottom:12px">
      <div style="font-size:.86rem;font-weight:900;color:var(--navy);margin-bottom:6px">🚨 Envoyer une alerte tablette (retrait de lot)</div>
      <div style="font-size:.72rem;color:var(--muted);margin-bottom:10px">Portée actuelle des filtres: <strong>${targetLabel}</strong>. Les tablettes recevront un message prioritaire avec accusé de lecture.</div>
      <div class="admin-field"><label>Titre</label><input id="alert-title" type="text" value="Alerte retrait de lot" maxlength="160"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
        <div class="admin-field"><label>Produit</label><input id="alert-product" type="text" placeholder="Ex: Escalope de dinde"></div>
        <div class="admin-field"><label>N° lot</label><input id="alert-lot" type="text" placeholder="Ex: LOT-2026-04-24"></div>
        <div class="admin-field"><label>DLC du produit</label><input id="alert-dlc" type="date"></div>
      </div>
      <div class="admin-field"><label>Message d'alerte</label><textarea id="alert-message" rows="4" placeholder="Expliquer précisément le retrait et l'action immédiate attendue (isoler, ne pas servir, vérifier stock)."></textarea></div>
      <div class="admin-field">
        <label>Photo produit à retirer (optionnelle)</label>
        <input id="alert-photo" type="file" accept="image/*" onchange="onAlertImageSelected(this)">
        <div id="alert-photo-preview" style="margin-top:8px"></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button onclick="sendTabletAlert()" style="padding:9px 14px;background:#b91c1c;color:#fff;border:none;border-radius:10px;font-size:.78rem;font-weight:800;cursor:pointer;font-family:var(--font)">📣 Envoyer l'alerte</button>
        <button onclick="clearAlertDraft()" style="padding:9px 14px;background:#f1f5f9;color:#475569;border:none;border-radius:10px;font-size:.78rem;font-weight:700;cursor:pointer;font-family:var(--font)">Effacer</button>
      </div>
    </div>`;

    html += `<div style="background:#fff;border:1px solid var(--border);border-radius:14px;padding:14px;margin-bottom:12px">
      <div style="font-size:.86rem;font-weight:900;color:#1e3a8a;margin-bottom:6px">📷 Demande photo hygiène par zone</div>
      <div style="font-size:.72rem;color:var(--muted);margin-bottom:10px">
        Les zones proposées viennent du plan de nettoyage (fiche nettoyage + zones ajoutées dans le PMS).
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
        <div class="admin-field">
          <label>Mode</label>
          <select id="photo-req-mode" onchange="togglePhotoReqMode()">
            <option value="random">🎲 Zone aléatoire</option>
            <option value="manual">📍 Zone choisie</option>
          </select>
        </div>
        <div class="admin-field">
          <label>Zone</label>
          <select id="photo-req-zone">${zoneOptions}</select>
        </div>
        <div class="admin-field">
          <label>Périodicité</label>
          <select id="photo-req-period">
            <option value="weekly">📆 Hebdomadaire</option>
            <option value="monthly">🗓️ Mensuelle</option>
          </select>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="admin-field">
          <label>Type de vue</label>
          <select id="photo-req-view">
            <option value="face">🏠 De face (vue générale)</option>
            <option value="detail">🔎 Détail zone</option>
          </select>
        </div>
        <div class="admin-field">
          <label>Date limite (optionnel)</label>
          <input id="photo-req-due" type="datetime-local">
        </div>
      </div>
      <div class="admin-field">
        <label>Message (optionnel)</label>
        <textarea id="photo-req-message" rows="3" placeholder="Ex: Merci de photographier la zone demandée après nettoyage, en cadrant l'ensemble de la zone."></textarea>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button onclick="sendPhotoRequestAlert()" style="padding:9px 14px;background:#1e3a8a;color:#fff;border:none;border-radius:10px;font-size:.78rem;font-weight:800;cursor:pointer;font-family:var(--font)">📤 Envoyer la demande photo</button>
      </div>
    </div>`;

    html += _renderAlertsHistory();
  }

  setContent(html);
  if(_adminTab==='alerts') togglePhotoReqMode();
}

// ════════════════════════════════════════════════════
// HISTORIQUE ALERTES — UI scalable (1000+ sites)
// ════════════════════════════════════════════════════

let _alertsUI = {
  filter: 'open',     // 'all' | 'open' | 'closed'
  kind: '',           // '' | 'recall' | 'photo_request'
  search: '',
  sort: 'date_desc',  // 'date_desc' | 'date_asc' | 'rate_asc' | 'rate_desc'
  limit: 20
};

let _alertDetailUI = {
  alertId: '',
  tab: 'responses',   // 'responses' | 'photos' | 'pending'
  search: '',
  filter: '',         // type de réponse à filtrer
  limit: 50
};

const _RESP_LABELS = {removed:'✅ Produit retiré',not_in_stock:'📭 Pas en stock',ok:'👍 OK / Non concerné',other:'✍️ Autre'};
const _RESP_COLORS = {removed:'#16a34a',not_in_stock:'#475569',ok:'#1e3a8a',other:'#b45309'};
const _RESP_BG     = {removed:'#dcfce7',not_in_stock:'#f1f5f9',ok:'#eff6ff',other:'#fef3c7'};

function _alertStats(a) {
  const acks = Array.isArray(a.acks) ? a.acks : [];
  const total = Array.isArray(a.site_codes) ? a.site_codes.length : 0;
  const breakdown = { removed:0, not_in_stock:0, ok:0, other:0 };
  acks.forEach(k=>{
    const r = k.response || 'ok';
    if(breakdown[r] !== undefined) breakdown[r]++;
    else breakdown.other++;
  });
  const photos = acks.filter(k=>k.photo_url||k.photo_data_url).length;
  const respondedSites = new Set(acks.map(k=>String(k.site_code||'').toUpperCase()).filter(Boolean));
  const pendingSites = (a.site_codes||[]).filter(s=>!respondedSites.has(String(s||'').toUpperCase()));
  const rate = total ? acks.length/total*100 : 0;
  return { total, responded: acks.length, breakdown, photos, pendingSites, rate };
}

function _filterAlerts(alerts) {
  const u = _alertsUI;
  let list = alerts.slice();
  if(u.filter==='open')   list = list.filter(a=>!a.closed_at);
  else if(u.filter==='closed') list = list.filter(a=>!!a.closed_at);
  if(u.kind==='photo_request') list = list.filter(a=>a.kind==='photo_request');
  else if(u.kind==='recall')   list = list.filter(a=>a.kind!=='photo_request');
  const q = (u.search||'').trim().toLowerCase();
  if(q){
    list = list.filter(a=>{
      const blob = `${a.title||''} ${a.message||''} ${a.product_name||''} ${a.lot_number||''} ${a.requested_zone||''} ${(a.site_codes||[]).join(' ')}`.toLowerCase();
      if(blob.includes(q)) return true;
      // chercher aussi dans les acks (notes, sites qui ont répondu)
      return (a.acks||[]).some(k=>`${k.site_code||''} ${k.note||''} ${k.user_name||''}`.toLowerCase().includes(q));
    });
  }
  if(u.sort==='date_asc')      list.sort((a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||'')));
  else if(u.sort==='rate_asc') list.sort((a,b)=>_alertStats(a).rate-_alertStats(b).rate);
  else if(u.sort==='rate_desc')list.sort((a,b)=>_alertStats(b).rate-_alertStats(a).rate);
  else                          list.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
  return list;
}

function setAlertsFilter(key, value) {
  _alertsUI[key] = value;
  if(key !== 'search') _alertsUI.limit = 20;
  if(key === 'search'){
    // Ne re-rendre que si la modale est fermée — on veut garder le focus sur l'input
    const input = document.getElementById('alerts-search');
    const caret = input ? input.selectionStart : null;
    renderAdmin();
    setTimeout(()=>{ const el = document.getElementById('alerts-search'); if(el){ el.focus(); if(caret!=null){ try{el.setSelectionRange(caret,caret);}catch(e){} } } }, 0);
  } else {
    renderAdmin();
  }
}

function loadMoreAlerts() {
  _alertsUI.limit += 20;
  renderAdmin();
}

function resetAlertsLimit() {
  _alertsUI.limit = 20;
  renderAdmin();
  window.scrollTo({top:0,behavior:'smooth'});
}

function _renderAlertsHistory() {
  if(!_tabletAlertsHistory.length){
    return `<div class="empty"><div class="empty-ico">🔔</div><strong>Aucune alerte envoyée</strong><br>Utilisez le formulaire ci-dessus pour notifier les tablettes.</div>`;
  }

  const all = _tabletAlertsHistory;
  const totalAll = all.length;
  const totalOpen = all.filter(a=>!a.closed_at).length;
  const totalClosed = totalAll - totalOpen;
  const totalRecall = all.filter(a=>a.kind!=='photo_request').length;
  const totalPhoto = all.filter(a=>a.kind==='photo_request').length;

  // Stats globales sur "en cours"
  let totalSitesTargeted = 0, totalResponses = 0, totalPhotosReceived = 0, totalPending = 0;
  all.filter(a=>!a.closed_at).forEach(a=>{
    const s = _alertStats(a);
    totalSitesTargeted += s.total;
    totalResponses += s.responded;
    totalPhotosReceived += s.photos;
    totalPending += s.pendingSites.length;
  });
  const globalRate = totalSitesTargeted ? Math.round(totalResponses/totalSitesTargeted*100) : 0;

  const filtered = _filterAlerts(all);
  const visible = filtered.slice(0, _alertsUI.limit);
  const hasMore = filtered.length > _alertsUI.limit;

  const F = _alertsUI;
  let html = '';

  // ── Stats globales ──
  html += `
  <div style="background:#fff;border:1px solid var(--border);border-radius:14px;padding:14px;margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px">
      <div style="font-size:.86rem;font-weight:900;color:var(--navy)">📊 Pilotage des alertes</div>
      <div style="font-size:.7rem;color:var(--muted)">${totalAll} alerte(s) au total</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px">
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:10px;text-align:center">
        <div style="font-size:1.5rem;font-weight:900;color:#b91c1c;line-height:1">${totalOpen}</div>
        <div style="font-size:.62rem;font-weight:700;color:#7f1d1d;text-transform:uppercase;letter-spacing:.4px;margin-top:4px">🔴 En cours</div>
      </div>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:10px;text-align:center">
        <div style="font-size:1.5rem;font-weight:900;color:#166534;line-height:1">${totalClosed}</div>
        <div style="font-size:.62rem;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:.4px;margin-top:4px">✅ Clôturées</div>
      </div>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:10px;text-align:center">
        <div style="font-size:1.5rem;font-weight:900;color:#1e3a8a;line-height:1">${globalRate}%</div>
        <div style="font-size:.62rem;font-weight:700;color:#1e3a8a;text-transform:uppercase;letter-spacing:.4px;margin-top:4px">📈 Taux réponse</div>
      </div>
      <div style="background:#fdf4ff;border:1px solid #e9d5ff;border-radius:10px;padding:10px;text-align:center">
        <div style="font-size:1.5rem;font-weight:900;color:#7c3aed;line-height:1">${totalPhotosReceived}</div>
        <div style="font-size:.62rem;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.4px;margin-top:4px">📷 Photos reçues</div>
      </div>
      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:10px;text-align:center">
        <div style="font-size:1.5rem;font-weight:900;color:#c2410c;line-height:1">${totalPending}</div>
        <div style="font-size:.62rem;font-weight:700;color:#9a3412;text-transform:uppercase;letter-spacing:.4px;margin-top:4px">⏳ En attente</div>
      </div>
    </div>
  </div>`;

  // ── Filtres ──
  html += `
  <div style="background:#fff;border:1px solid var(--border);border-radius:14px;padding:12px;margin-bottom:12px">
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
      <button onclick="setAlertsFilter('filter','open')" style="padding:7px 12px;border-radius:999px;border:1.5px solid ${F.filter==='open'?'#dc2626':'#e2e8f0'};background:${F.filter==='open'?'#fee2e2':'#fff'};color:${F.filter==='open'?'#991b1b':'#475569'};font-size:.72rem;font-weight:800;cursor:pointer;font-family:var(--font)">🔴 En cours (${totalOpen})</button>
      <button onclick="setAlertsFilter('filter','closed')" style="padding:7px 12px;border-radius:999px;border:1.5px solid ${F.filter==='closed'?'#16a34a':'#e2e8f0'};background:${F.filter==='closed'?'#dcfce7':'#fff'};color:${F.filter==='closed'?'#166534':'#475569'};font-size:.72rem;font-weight:800;cursor:pointer;font-family:var(--font)">✅ Clôturées (${totalClosed})</button>
      <button onclick="setAlertsFilter('filter','all')" style="padding:7px 12px;border-radius:999px;border:1.5px solid ${F.filter==='all'?'#1e3a8a':'#e2e8f0'};background:${F.filter==='all'?'#eff6ff':'#fff'};color:${F.filter==='all'?'#1e3a8a':'#475569'};font-size:.72rem;font-weight:800;cursor:pointer;font-family:var(--font)">🗂️ Tout (${totalAll})</button>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
      <button onclick="setAlertsFilter('kind','')" style="padding:5px 11px;border-radius:999px;border:1.5px solid ${F.kind===''?'#1e3a8a':'#e2e8f0'};background:${F.kind===''?'#1e3a8a':'#fff'};color:${F.kind===''?'#fff':'#475569'};font-size:.7rem;font-weight:700;cursor:pointer;font-family:var(--font)">Tous types</button>
      <button onclick="setAlertsFilter('kind','recall')" style="padding:5px 11px;border-radius:999px;border:1.5px solid ${F.kind==='recall'?'#1e3a8a':'#e2e8f0'};background:${F.kind==='recall'?'#1e3a8a':'#fff'};color:${F.kind==='recall'?'#fff':'#475569'};font-size:.7rem;font-weight:700;cursor:pointer;font-family:var(--font)">🚨 Retraits · ${totalRecall}</button>
      <button onclick="setAlertsFilter('kind','photo_request')" style="padding:5px 11px;border-radius:999px;border:1.5px solid ${F.kind==='photo_request'?'#1e3a8a':'#e2e8f0'};background:${F.kind==='photo_request'?'#1e3a8a':'#fff'};color:${F.kind==='photo_request'?'#fff':'#475569'};font-size:.7rem;font-weight:700;cursor:pointer;font-family:var(--font)">📷 Photos · ${totalPhoto}</button>
    </div>
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:8px;align-items:end">
      <div>
        <label style="font-size:.65rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Rechercher</label>
        <input id="alerts-search" type="search" value="${escAttr(F.search||'')}" oninput="setAlertsFilter('search',this.value)" placeholder="Titre, produit, lot, zone, site…" style="width:100%;padding:8px 10px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:.78rem;font-family:var(--font)">
      </div>
      <div>
        <label style="font-size:.65rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Tri</label>
        <select onchange="setAlertsFilter('sort',this.value)" style="width:100%;padding:8px 10px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:.75rem;font-family:var(--font);background:#fff">
          <option value="date_desc" ${F.sort==='date_desc'?'selected':''}>📅 Plus récentes</option>
          <option value="date_asc"  ${F.sort==='date_asc'?'selected':''}>📅 Plus anciennes</option>
          <option value="rate_asc"  ${F.sort==='rate_asc'?'selected':''}>📉 Taux réponse ↑</option>
          <option value="rate_desc" ${F.sort==='rate_desc'?'selected':''}>📈 Taux réponse ↓</option>
        </select>
      </div>
    </div>
  </div>`;

  // ── Liste ──
  if(!filtered.length){
    html += `<div class="empty"><div class="empty-ico">🔍</div><strong>Aucune alerte ne correspond aux filtres</strong></div>`;
  } else {
    html += `<div style="display:flex;flex-direction:column;gap:10px">${visible.map(a=>_renderAlertCard(a)).join('')}</div>`;
    if(hasMore){
      html += `<div style="text-align:center;margin-top:14px"><button onclick="loadMoreAlerts()" style="padding:10px 20px;background:#fff;border:1.5px solid var(--border);border-radius:10px;font-size:.78rem;font-weight:800;color:var(--navy);cursor:pointer;font-family:var(--font)">↓ Voir 20 alerte(s) de plus &nbsp;<span style="color:var(--muted);font-weight:600">(${filtered.length-_alertsUI.limit} restante(s))</span></button></div>`;
    } else if(_alertsUI.limit > 20 && filtered.length > 20){
      html += `<div style="text-align:center;margin-top:14px"><button onclick="resetAlertsLimit()" style="padding:7px 14px;background:transparent;border:1px solid #e2e8f0;border-radius:8px;font-size:.7rem;font-weight:700;color:var(--muted);cursor:pointer;font-family:var(--font)">↑ Réduire la liste</button></div>`;
    }
  }

  return html;
}

function _renderAlertCard(a) {
  const stats = _alertStats(a);
  const closed = !!a.closed_at;
  const isPhotoReq = a.kind === 'photo_request';
  const dlcTxt = a.product_dlc ? new Date(a.product_dlc+'T12:00').toLocaleDateString('fr-FR') : '';

  // Barre de progression empilée (segments par type de réponse + zone vide pour les non-répondus)
  const bd = stats.breakdown;
  let stackBar = '';
  if(stats.total){
    const segs = [];
    if(bd.removed)      segs.push({pct: bd.removed/stats.total*100,      color:'#16a34a'});
    if(bd.not_in_stock) segs.push({pct: bd.not_in_stock/stats.total*100, color:'#475569'});
    if(bd.ok)           segs.push({pct: bd.ok/stats.total*100,           color:'#1e3a8a'});
    if(bd.other)        segs.push({pct: bd.other/stats.total*100,        color:'#b45309'});
    stackBar = `<div style="display:flex;height:8px;background:#f1f5f9;border-radius:999px;overflow:hidden;margin:8px 0 6px">
      ${segs.map(s=>`<div style="width:${s.pct}%;background:${s.color}"></div>`).join('')}
    </div>`;
  }

  // Légende compacte
  const legendParts = [];
  if(bd.removed)      legendParts.push(`<span style="color:#16a34a">✅ ${bd.removed}</span>`);
  if(bd.not_in_stock) legendParts.push(`<span style="color:#475569">📭 ${bd.not_in_stock}</span>`);
  if(bd.ok)           legendParts.push(`<span style="color:#1e3a8a">👍 ${bd.ok}</span>`);
  if(bd.other)        legendParts.push(`<span style="color:#b45309">✍️ ${bd.other}</span>`);
  if(stats.pendingSites.length) legendParts.push(`<span style="color:#94a3b8">⏳ ${stats.pendingSites.length} en attente</span>`);
  const legend = legendParts.length ? `<div style="display:flex;gap:10px;flex-wrap:wrap;font-size:.66rem;font-weight:700">${legendParts.join('')}</div>` : '';

  // Mini galerie photos (4 max + bouton "voir +N")
  const allPhotos = (a.acks||[]).filter(k=>k.photo_url||k.photo_data_url);
  const photosThumbs = allPhotos.slice(0,4);
  let photoHtml = '';
  if(photosThumbs.length){
    const cols = Math.min(4, photosThumbs.length) + (allPhotos.length>4 ? 1 : 0);
    photoHtml = `<div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:6px;margin-top:8px">
      ${photosThumbs.map(p=>{const u=escAttr(p.photo_url||p.photo_data_url);return `<img src="${u}" onclick="event.stopPropagation();openLightbox('${u}')" style="width:100%;height:72px;object-fit:cover;border-radius:8px;border:1px solid #c7d2fe;cursor:pointer" onerror="this.style.display='none'">`;}).join('')}
      ${allPhotos.length>4 ? `<div onclick="event.stopPropagation();openAlertDetail('${escAttr(a.id)}','photos')" style="height:72px;background:#1e3a8a;color:#fff;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:800;cursor:pointer">+${allPhotos.length-4}</div>` : ''}
    </div>`;
  }

  // Méta selon type
  const metaHtml = isPhotoReq
    ? `Zone: <strong>${escH(a.requested_zone||'—')}</strong> · Vue: <strong>${escH(a.shot_view==='detail'?'Détail':'De face')}</strong> · ${escH(a.period_mode==='monthly'?'Mensuelle':'Hebdomadaire')}`
    : `${a.product_name?`Produit: <strong>${escH(a.product_name)}</strong>`:''}${a.lot_number?`${a.product_name?' · ':''}Lot: <strong>${escH(a.lot_number)}</strong>`:''}${dlcTxt?` · DLC: <strong>${escH(dlcTxt)}</strong>`:''}`;

  // Actions
  const closeBtn = closed
    ? `<span style="font-size:.66rem;font-weight:800;color:#166534;background:#dcfce7;border-radius:10px;padding:4px 10px;white-space:nowrap">✅ Clôturée ${a.closed_at?new Date(a.closed_at).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):''}${a.closed_by_name?' · '+escH(a.closed_by_name):''}</span>`
    : `<button onclick="event.stopPropagation();closeTabletAlert('${escAttr(a.id)}')" style="padding:6px 11px;background:#166534;color:#fff;border:none;border-radius:8px;font-size:.7rem;font-weight:800;cursor:pointer;font-family:var(--font);white-space:nowrap">🛑 Clôturer</button>`;

  const borderL  = closed ? '#16a34a' : (isPhotoReq?'#1e3a8a':'#b91c1c');
  const titleColor = closed ? '#334155' : (isPhotoReq?'#1e3a8a':'#7f1d1d');
  const rateColor = stats.rate>=80 ? '#16a34a' : stats.rate>=50 ? '#b45309' : '#b91c1c';

  return `<div onclick="openAlertDetail('${escAttr(a.id)}')" style="background:#fff;border:1px solid ${closed?'#e2e8f0':'#fecaca'};border-left:4px solid ${borderL};border-radius:12px;padding:12px 14px;cursor:pointer;transition:box-shadow .15s,transform .15s" onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,.08)'" onmouseout="this.style.boxShadow='none'">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;margin-bottom:4px">
      <div style="flex:1;min-width:0">
        <div style="font-size:.82rem;font-weight:800;color:${titleColor}">${isPhotoReq?'📷 ':''}${escH(a.title||'Alerte')}</div>
        ${a.message?`<div style="font-size:.72rem;color:#334155;margin-top:3px;white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escH(a.message)}</div>`:''}
      </div>
      <div style="font-size:.66rem;color:#64748b;white-space:nowrap;text-align:right">${a.created_at?new Date(a.created_at).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—'}</div>
    </div>
    ${metaHtml?`<div style="font-size:.66rem;color:#64748b;margin-bottom:4px">${metaHtml}</div>`:''}
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-top:8px">
      <div style="font-size:.78rem;font-weight:800;color:var(--navy)">
        ${stats.responded}/${stats.total} <span style="font-weight:600;color:var(--muted)">réponse(s)</span> · <span style="color:${rateColor}">${Math.round(stats.rate)}%</span>
      </div>
      ${allPhotos.length?`<div style="font-size:.66rem;font-weight:700;color:#7c3aed">📷 ${allPhotos.length} photo(s)</div>`:''}
    </div>
    ${stackBar}
    ${legend}
    ${photoHtml}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:8px;flex-wrap:wrap">
      <button onclick="event.stopPropagation();openAlertDetail('${escAttr(a.id)}')" style="padding:6px 11px;background:#eff6ff;color:#1e3a8a;border:1px solid #bfdbfe;border-radius:8px;font-size:.7rem;font-weight:800;cursor:pointer;font-family:var(--font)">👁️ Voir le détail</button>
      ${closeBtn}
    </div>
  </div>`;
}

// ════════════════════════════════════════════════════
// MODALE DÉTAIL ALERTE
// ════════════════════════════════════════════════════

function openAlertDetail(alertId, tab) {
  _alertDetailUI.alertId = alertId;
  _alertDetailUI.tab = tab || 'responses';
  _alertDetailUI.search = '';
  _alertDetailUI.filter = '';
  _alertDetailUI.limit = 50;
  _renderAlertDetailModal();
}

function closeAlertDetail() {
  _alertDetailUI.alertId = '';
  const m = document.getElementById('alert-detail-modal');
  if(m) m.remove();
  document.body.style.overflow = '';
}

function setAlertDetailTab(tab) {
  _alertDetailUI.tab = tab;
  _alertDetailUI.search = '';
  _alertDetailUI.filter = '';
  _alertDetailUI.limit = 50;
  _renderAlertDetailModal();
}

function setAlertDetailFilter(key, value) {
  _alertDetailUI[key] = value;
  if(key !== 'search') _alertDetailUI.limit = 50;
  if(key === 'search'){
    const input = document.getElementById('alert-detail-search');
    const caret = input ? input.selectionStart : null;
    _renderAlertDetailModal();
    setTimeout(()=>{ const el = document.getElementById('alert-detail-search'); if(el){ el.focus(); if(caret!=null){ try{el.setSelectionRange(caret,caret);}catch(e){} } } }, 0);
  } else {
    _renderAlertDetailModal();
  }
}

function loadMoreResponses() {
  _alertDetailUI.limit += 50;
  _renderAlertDetailModal();
}

function exportAlertResponses(alertId) {
  const a = _tabletAlertsHistory.find(x=>x.id===alertId);
  if(!a) return;
  const acks = (a.acks||[]).slice().sort((x,y)=>String(y.acked_at||'').localeCompare(String(x.acked_at||'')));
  const sep = ';';
  const header = ['Site','Réponse','Note','Zone','Utilisateur','Date réponse','Photo'];
  const lines = [header.join(sep)];
  acks.forEach(k=>{
    const respLbl = (_RESP_LABELS[k.response||'ok']||'').replace(/^[^\s]+\s/,'');
    const dt = k.acked_at ? new Date(k.acked_at).toLocaleString('fr-FR') : '';
    const photo = (k.photo_url||k.photo_data_url) ? 'OUI' : '';
    const fields = [k.site_code||'', respLbl, k.note||'', k.zone||'', k.user_name||'', dt, photo];
    lines.push(fields.map(f=>{
      const s = String(f||'').replace(/"/g,'""');
      return /[";\n]/.test(s) ? `"${s}"` : s;
    }).join(sep));
  });
  const csv = '\uFEFF' + lines.join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeTitle = String(a.title||'alerte').replace(/[^\w\-]+/g,'_').slice(0,40);
  const datePart = a.created_at ? new Date(a.created_at).toISOString().slice(0,10) : 'export';
  link.href = url;
  link.download = `alerte_${datePart}_${safeTitle}.csv`;
  document.body.appendChild(link);
  link.click();
  setTimeout(()=>{document.body.removeChild(link); URL.revokeObjectURL(url);}, 100);
  showToast('📥 Export CSV téléchargé','success');
}

function _renderAlertDetailModal() {
  const a = _tabletAlertsHistory.find(x=>x.id===_alertDetailUI.alertId);
  if(!a){ closeAlertDetail(); return; }

  const stats = _alertStats(a);
  const closed = !!a.closed_at;
  const isPhotoReq = a.kind === 'photo_request';
  const D = _alertDetailUI;
  const dlcTxt = a.product_dlc ? new Date(a.product_dlc+'T12:00').toLocaleDateString('fr-FR') : '';

  // Onglets
  const photosCount = (a.acks||[]).filter(k=>k.photo_url||k.photo_data_url).length;
  const tabs = [
    {key:'responses', label:`💬 Réponses · ${stats.responded}`},
    {key:'photos',    label:`📷 Photos · ${photosCount}`},
    {key:'pending',   label:`⏳ En attente · ${stats.pendingSites.length}`}
  ];

  // Header alerte
  const metaHtml = isPhotoReq
    ? `Zone: <strong>${escH(a.requested_zone||'—')}</strong> · Vue: <strong>${escH(a.shot_view==='detail'?'Détail':'De face')}</strong> · Périodicité: <strong>${escH(a.period_mode==='monthly'?'Mensuelle':'Hebdomadaire')}</strong>`
    : `${a.product_name?`Produit: <strong>${escH(a.product_name)}</strong>`:''}${a.lot_number?` · Lot: <strong>${escH(a.lot_number)}</strong>`:''}${dlcTxt?` · DLC: <strong>${escH(dlcTxt)}</strong>`:''}`;

  let body = '';

  if(D.tab === 'responses'){
    // Filtres réponses
    const bd = stats.breakdown;
    const filterChips = [
      ['',     `Toutes · ${stats.responded}`,'#1e3a8a'],
      ['removed',     `✅ Retirés · ${bd.removed}`, '#16a34a'],
      ['not_in_stock',`📭 Pas en stock · ${bd.not_in_stock}`,'#475569'],
      ['ok',          `👍 OK · ${bd.ok}`,         '#1e3a8a'],
      ['other',       `✍️ Autre · ${bd.other}`,   '#b45309']
    ];
    body += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
      ${filterChips.map(([v,l,c])=>`<button onclick="setAlertDetailFilter('filter','${v}')" style="padding:5px 11px;border-radius:999px;border:1.5px solid ${D.filter===v?c:'#e2e8f0'};background:${D.filter===v?c:'#fff'};color:${D.filter===v?'#fff':'#475569'};font-size:.7rem;font-weight:700;cursor:pointer;font-family:var(--font)">${l}</button>`).join('')}
    </div>
    <div style="margin-bottom:10px">
      <input id="alert-detail-search" type="search" value="${escAttr(D.search||'')}" oninput="setAlertDetailFilter('search',this.value)" placeholder="🔍 Rechercher (site, note, utilisateur…)" style="width:100%;padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:.78rem;font-family:var(--font)">
    </div>`;

    // Filtrage des réponses
    let acks = (a.acks||[]).slice();
    if(D.filter){
      acks = acks.filter(k=>(k.response||'ok')===D.filter);
    }
    if(D.search.trim()){
      const q = D.search.trim().toLowerCase();
      acks = acks.filter(k=>`${k.site_code||''} ${k.note||''} ${k.user_name||''} ${k.zone||''}`.toLowerCase().includes(q));
    }
    acks.sort((x,y)=>String(y.acked_at||'').localeCompare(String(x.acked_at||'')));

    const total = acks.length;
    const visible = acks.slice(0, D.limit);
    const hasMore = total > D.limit;

    if(!total){
      body += `<div class="empty"><div class="empty-ico">🔍</div><strong>Aucune réponse trouvée</strong></div>`;
    } else {
      body += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="font-size:.7rem;color:var(--muted);font-weight:700">${total} réponse(s) · affichage ${Math.min(D.limit,total)}</div>
        <button onclick="exportAlertResponses('${escAttr(a.id)}')" style="padding:5px 11px;background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;border-radius:8px;font-size:.68rem;font-weight:800;cursor:pointer;font-family:var(--font)">📥 Export CSV</button>
      </div>`;

      body += `<div style="display:flex;flex-direction:column;gap:6px">${visible.map(k=>{
        const r = k.response||'ok';
        const lbl = _RESP_LABELS[r]||_RESP_LABELS.ok;
        const col = _RESP_COLORS[r]||'#1e3a8a';
        const bg  = _RESP_BG[r]||'#eff6ff';
        const dt  = k.acked_at ? new Date(k.acked_at).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
        const photoUrl = k.photo_url||k.photo_data_url;
        return `<div style="display:flex;gap:10px;align-items:center;padding:8px 10px;background:${bg};border:1px solid ${col}33;border-radius:10px">
          ${photoUrl?`<img src="${escAttr(photoUrl)}" onclick="openLightbox('${escAttr(photoUrl)}')" style="width:44px;height:44px;object-fit:cover;border-radius:6px;border:1px solid #c7d2fe;cursor:pointer;flex-shrink:0" onerror="this.style.display='none'">`:''}
          <div style="flex:1;min-width:0">
            <div style="display:flex;justify-content:space-between;gap:6px;align-items:baseline;flex-wrap:wrap">
              <div style="font-size:.76rem;font-weight:800;color:${col}">${escH(k.site_code||'—')} · ${lbl}</div>
              <div style="font-size:.62rem;color:var(--muted);white-space:nowrap">${escH(dt)}</div>
            </div>
            ${k.note?`<div style="font-size:.7rem;color:#334155;margin-top:2px">${escH(k.note)}</div>`:''}
            ${(k.user_name||k.zone)?`<div style="font-size:.62rem;color:var(--muted);margin-top:2px">${k.user_name?escH(k.user_name):''}${k.user_name&&k.zone?' · ':''}${k.zone?escH(k.zone):''}</div>`:''}
          </div>
        </div>`;
      }).join('')}</div>`;

      if(hasMore){
        body += `<div style="text-align:center;margin-top:12px"><button onclick="loadMoreResponses()" style="padding:9px 18px;background:#fff;border:1.5px solid var(--border);border-radius:10px;font-size:.76rem;font-weight:800;color:var(--navy);cursor:pointer;font-family:var(--font)">↓ Voir 50 réponse(s) de plus &nbsp;<span style="color:var(--muted);font-weight:600">(${total-D.limit} restante(s))</span></button></div>`;
      }
    }
  }
  else if(D.tab === 'photos'){
    const photoAcks = (a.acks||[]).filter(k=>k.photo_url||k.photo_data_url);
    photoAcks.sort((x,y)=>String(y.acked_at||'').localeCompare(String(x.acked_at||'')));

    if(D.search.trim()){
      const q = D.search.trim().toLowerCase();
      const filtered = photoAcks.filter(k=>`${k.site_code||''} ${k.note||''} ${k.zone||''}`.toLowerCase().includes(q));
      photoAcks.length = 0;
      filtered.forEach(p=>photoAcks.push(p));
    }

    body += `<div style="margin-bottom:10px">
      <input id="alert-detail-search" type="search" value="${escAttr(D.search||'')}" oninput="setAlertDetailFilter('search',this.value)" placeholder="🔍 Filtrer par site, note, zone…" style="width:100%;padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:.78rem;font-family:var(--font)">
    </div>`;

    const visible = photoAcks.slice(0, D.limit);
    const hasMore = photoAcks.length > D.limit;

    if(!photoAcks.length){
      body += `<div class="empty"><div class="empty-ico">📷</div><strong>Aucune photo reçue</strong></div>`;
    } else {
      body += `<div style="font-size:.7rem;color:var(--muted);font-weight:700;margin-bottom:8px">${photoAcks.length} photo(s) · affichage ${Math.min(D.limit,photoAcks.length)}</div>`;
      body += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px">${visible.map(k=>{
        const u = k.photo_url||k.photo_data_url;
        const dt = k.acked_at ? new Date(k.acked_at).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
        const r = k.response||'ok';
        const col = _RESP_COLORS[r]||'#1e3a8a';
        return `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
          <img src="${escAttr(u)}" onclick="openLightbox('${escAttr(u)}')" style="width:100%;aspect-ratio:1;object-fit:cover;cursor:pointer;display:block" onerror="this.style.display='none'">
          <div style="padding:6px 8px">
            <div style="font-size:.68rem;font-weight:800;color:${col}">${escH(k.site_code||'—')}</div>
            ${k.note?`<div style="font-size:.62rem;color:#334155;margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escH(k.note)}</div>`:''}
            <div style="font-size:.58rem;color:var(--muted);margin-top:3px">${escH(dt)}</div>
          </div>
        </div>`;
      }).join('')}</div>`;
      if(hasMore){
        body += `<div style="text-align:center;margin-top:12px"><button onclick="loadMoreResponses()" style="padding:9px 18px;background:#fff;border:1.5px solid var(--border);border-radius:10px;font-size:.76rem;font-weight:800;color:var(--navy);cursor:pointer;font-family:var(--font)">↓ Voir 50 photo(s) de plus &nbsp;<span style="color:var(--muted);font-weight:600">(${photoAcks.length-D.limit} restante(s))</span></button></div>`;
      }
    }
  }
  else if(D.tab === 'pending'){
    let pending = stats.pendingSites.slice();
    if(D.search.trim()){
      const q = D.search.trim().toLowerCase();
      pending = pending.filter(s=>{
        const site = (typeof _sites!=='undefined') ? _sites.find(x=>x.code===s) : null;
        const blob = `${s} ${site?.name||''}`.toLowerCase();
        return blob.includes(q);
      });
    }
    pending.sort();

    body += `<div style="margin-bottom:10px">
      <input id="alert-detail-search" type="search" value="${escAttr(D.search||'')}" oninput="setAlertDetailFilter('search',this.value)" placeholder="🔍 Filtrer les sites…" style="width:100%;padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:.78rem;font-family:var(--font)">
    </div>`;

    if(!pending.length){
      body += `<div class="empty"><div class="empty-ico">✅</div><strong>${stats.pendingSites.length===0?'Tous les sites ont répondu':'Aucun site ne correspond'}</strong></div>`;
    } else {
      body += `<div style="font-size:.7rem;color:var(--muted);font-weight:700;margin-bottom:8px">${pending.length} site(s) en attente</div>`;
      body += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:6px">${pending.map(code=>{
        const site = (typeof _sites!=='undefined') ? _sites.find(x=>x.code===code) : null;
        return `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:8px 10px">
          <div style="font-size:.74rem;font-weight:800;color:#9a3412;font-family:var(--mono)">${escH(code)}</div>
          ${site?`<div style="font-size:.66rem;color:#7c2d12;margin-top:1px">${escH(site.name)}</div>`:''}
        </div>`;
      }).join('')}</div>`;
    }
  }

  // Compose la modale complète
  const titleColor = closed ? '#334155' : (isPhotoReq?'#1e3a8a':'#7f1d1d');
  const headerBg   = closed ? '#f0fdf4' : (isPhotoReq?'#eff6ff':'#fef2f2');
  const headerBorder = closed ? '#bbf7d0' : (isPhotoReq?'#bfdbfe':'#fecaca');

  const closeFooter = closed
    ? `<div style="font-size:.72rem;font-weight:800;color:#166534">✅ Clôturée le ${a.closed_at?new Date(a.closed_at).toLocaleString('fr-FR'):'—'}${a.closed_by_name?' par '+escH(a.closed_by_name):''}</div>`
    : `<button onclick="closeTabletAlert('${escAttr(a.id)}')" style="padding:9px 16px;background:#166534;color:#fff;border:none;border-radius:10px;font-size:.78rem;font-weight:800;cursor:pointer;font-family:var(--font)">🛑 Clôturer l'alerte à distance</button>`;

  const html = `<div onclick="if(event.target===this)closeAlertDetail()" style="position:fixed;inset:0;background:rgba(15,23,42,.6);z-index:9000;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto;font-family:var(--font);-webkit-tap-highlight-color:transparent">
    <div style="background:#fff;border-radius:16px;width:100%;max-width:780px;box-shadow:0 24px 60px rgba(0,0,0,.3);overflow:hidden;display:flex;flex-direction:column;max-height:calc(100vh - 40px)">
      <div style="padding:16px 18px;background:${headerBg};border-bottom:1px solid ${headerBorder};display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-shrink:0">
        <div style="flex:1;min-width:0">
          <div style="font-size:.96rem;font-weight:900;color:${titleColor};margin-bottom:3px">${isPhotoReq?'📷 ':'🚨 '}${escH(a.title||'Alerte')}</div>
          ${a.message?`<div style="font-size:.74rem;color:#334155;white-space:pre-wrap;margin-bottom:6px">${escH(a.message)}</div>`:''}
          <div style="font-size:.66rem;color:#64748b">${metaHtml}</div>
          <div style="font-size:.66rem;color:#64748b;margin-top:3px">📅 Envoyée le ${a.created_at?new Date(a.created_at).toLocaleString('fr-FR'):'—'} · ${stats.total} site(s) ciblé(s)</div>
        </div>
        <button onclick="closeAlertDetail()" style="background:transparent;border:none;font-size:1.4rem;color:#64748b;cursor:pointer;padding:4px 8px;line-height:1;flex-shrink:0" aria-label="Fermer">✕</button>
      </div>
      <div style="padding:10px 18px;background:#fff;border-bottom:1px solid #e2e8f0;display:flex;gap:6px;flex-wrap:wrap;flex-shrink:0">
        ${tabs.map(t=>`<button onclick="setAlertDetailTab('${t.key}')" style="padding:7px 12px;border-radius:8px;border:1.5px solid ${D.tab===t.key?'var(--navy)':'#e2e8f0'};background:${D.tab===t.key?'var(--navy)':'#fff'};color:${D.tab===t.key?'#fff':'#475569'};font-size:.72rem;font-weight:800;cursor:pointer;font-family:var(--font)">${t.label}</button>`).join('')}
      </div>
      <div style="padding:14px 18px;flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch">${body}</div>
      <div style="padding:12px 18px;background:#f8fafc;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;flex-shrink:0">
        <button onclick="closeAlertDetail()" style="padding:9px 16px;background:#fff;color:#475569;border:1.5px solid #e2e8f0;border-radius:10px;font-size:.78rem;font-weight:700;cursor:pointer;font-family:var(--font)">Fermer</button>
        ${closeFooter}
      </div>
    </div>
  </div>`;

  let modal = document.getElementById('alert-detail-modal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'alert-detail-modal';
    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';
  }
  modal.innerHTML = html;
}

function copyKnowledgeProblem(idx){
  const p = _knowledgeProblems[idx];
  if(!p?.problem) return;
  copyText(p.problem);
  showToast('📋 Problème copié','success');
}

async function deleteKnowledgeItem(kind,id){
  if(!id) return;
  const label = kind==='problem' ? 'ce problème type' : 'cette recommandation';
  _showConfirmDash('🗑️ Supprimer',`Supprimer "${label}" ?`,'Supprimer',()=>{_doDeleteKnowledge(kind,id,label);},'danger');
  return;
  try{
    await hubApi('DELETE', `op=knowledge_delete&kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`);
    await loadKnowledgeData();
    renderAdmin();
    showToast('✅ Élément supprimé','success');
  }catch(e){
    showToast('Erreur suppression : '+e.message,'error');
  }
}

function clearAlertDraft(){
  _alertDraftImageDataUrl = '';
  const titleEl = document.getElementById('alert-title');
  const productEl = document.getElementById('alert-product');
  const lotEl = document.getElementById('alert-lot');
  const dlcEl = document.getElementById('alert-dlc');
  const msgEl = document.getElementById('alert-message');
  const photoEl = document.getElementById('alert-photo');
  const previewEl = document.getElementById('alert-photo-preview');
  if(titleEl) titleEl.value = 'Alerte retrait de lot';
  if(productEl) productEl.value = '';
  if(lotEl) lotEl.value = '';
  if(dlcEl) dlcEl.value = '';
  if(msgEl) msgEl.value = '';
  if(photoEl) photoEl.value = '';
  if(previewEl) previewEl.innerHTML = '';
}

function onAlertImageSelected(input){
  const file = input?.files?.[0];
  const previewEl = document.getElementById('alert-photo-preview');
  if(!file){
    _alertDraftImageDataUrl = '';
    if(previewEl) previewEl.innerHTML = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = ()=>{
    const dataUrl = String(reader.result||'');
    _alertDraftImageDataUrl = dataUrl;
    if(previewEl){
      previewEl.innerHTML = `<div style="display:flex;align-items:flex-start;gap:10px"><img src="${dataUrl}" style="width:90px;height:90px;object-fit:cover;border-radius:10px;border:1px solid #fecaca"><div style="font-size:.7rem;color:#64748b">Photo jointe<br>${escH(file.name||'image')}</div></div>`;
    }
  };
  reader.onerror = ()=>showToast('Erreur lecture image','error');
  reader.readAsDataURL(file);
}

function togglePhotoReqMode(){
  const modeEl = document.getElementById('photo-req-mode');
  const zoneEl = document.getElementById('photo-req-zone');
  if(!modeEl || !zoneEl) return;
  const isRandom = modeEl.value === 'random';
  zoneEl.disabled = isRandom;
  zoneEl.style.opacity = isRandom ? '.65' : '1';
}

async function sendPhotoRequestAlert(){
  const targetCodes = getScopedSiteCodes();
  if(!targetCodes.length){
    showToast('Sélectionnez un site/secteur/territoire cible','warning');
    return;
  }
  const mode = (document.getElementById('photo-req-mode')?.value||'random').trim();
  const zone = (document.getElementById('photo-req-zone')?.value||'').trim();
  const period_mode = (document.getElementById('photo-req-period')?.value||'weekly').trim();
  const shot_view = (document.getElementById('photo-req-view')?.value||'face').trim();
  const dueRaw = (document.getElementById('photo-req-due')?.value||'').trim();
  const message = (document.getElementById('photo-req-message')?.value||'').trim();
  const availableZones = getScopedCleaningZones();
  if(!availableZones.length){
    showToast('Aucune zone disponible — ajoutez des zones dans le PMS','warning');
    return;
  }
  if(mode!=='random' && !zone){
    showToast('Sélectionnez une zone','warning');
    return;
  }
  try{
    const reqId = _supaAlertId();
    const now = new Date().toISOString();
    const tenantId = _profile?.tenant_id||null;
    // Choisir la zone (aléatoire si mode random)
    let resolvedZone = zone;
    if(mode==='random' && availableZones.length){
      resolvedZone = availableZones[Math.floor(Math.random()*availableZones.length)];
    }
    const reqData = {
      id:reqId, tenant_id:tenantId, kind:'photo_request',
      title:`📷 Demande photo — ${resolvedZone||'zone aléatoire'}`,
      message: message||'',
      zone: resolvedZone||'',
      available_zones: availableZones,
      request_mode: mode==='random'?'random':'manual',
      period_mode, shot_view,
      due_at: dueRaw||null,
      site_codes: targetCodes,
      created_at: now,
      created_by: _profile?.id,
      created_by_name: _profile?.full_name||'',
      closed_at: null,
      severity: 'info'
    };
    const rows = targetCodes.map(sc=>({
      site_id: sc, tenant_id: tenantId, enr_type:'hub_photo_request',
      client_id: `${reqId}:${sc}`,
      recorded_at: now,
      data: {...reqData, dispatch_site_code:sc}
    }));
    await supa('POST','/rest/v1/pms_records',rows,false,{'Prefer':'resolution=merge-duplicates,return=minimal'});
    await loadTabletAlertsHistory();
    showToast(`✅ Demande photo envoyée à ${targetCodes.length} site(s)`,'success');
    const msgEl = document.getElementById('photo-req-message');
    const dueEl = document.getElementById('photo-req-due');
    if(msgEl) msgEl.value = '';
    if(dueEl) dueEl.value = '';
    renderAdmin();
  }catch(e){
    showToast('Erreur envoi demande photo : '+e.message,'error');
  }
}


// ── Modal confirm in-app (remplace confirm() Android) ─────────────────────
function _showConfirmDash(title, msg, okLabel, cb, okClass='danger'){
  const existing=document.getElementById('confirm-ov-dash');
  if(existing)existing.remove();
  const el=document.createElement('div');
  el.id='confirm-ov-dash';
  el.className='confirm-ov';
  el.innerHTML=`<div class="confirm-box">
    <div class="cb-title">${escH(title)}</div>
    <div class="cb-msg">${msg}</div>
    <div class="cb-btns">
      <button class="cb-cancel" onclick="document.getElementById('confirm-ov-dash').remove()">Annuler</button>
      <button class="cb-ok ${okClass}" id="cb-ok-btn">${escH(okLabel)}</button>
    </div>
  </div>`;
  document.body.appendChild(el);
  document.getElementById('cb-ok-btn').onclick=()=>{el.remove();cb();};
}

async function sendTabletAlert(){
  const targetCodes = getScopedSiteCodes();
  if(!targetCodes.length){
    showToast('Sélectionnez un site/secteur/territoire cible','warning');
    return;
  }
  const title = (document.getElementById('alert-title')?.value||'').trim();
  const product_name = (document.getElementById('alert-product')?.value||'').trim();
  const lot_number = (document.getElementById('alert-lot')?.value||'').trim();
  const product_dlc = (document.getElementById('alert-dlc')?.value||'').trim();
  const message = (document.getElementById('alert-message')?.value||'').trim();
  if(!message){
    showToast('Message d’alerte obligatoire','warning');
    return;
  }
  try{
    const alertId=_supaAlertId();
    const now=new Date().toISOString();
    const tenantId=_profile?.tenant_id||null;
    // Upload photo si présente
    let imageUrl='';
    if(_alertDraftImageDataUrl&&_alertDraftImageDataUrl.startsWith('data:image/')){
      try{
        const [meta,b64]=_alertDraftImageDataUrl.split(',');
        const mime=((meta.match(/data:([^;]+)/)||[])[1])||'image/jpeg';
        const ext=mime==='image/png'?'png':'jpg';
        const path=`alerts/${tenantId}/${alertId}.${ext}`;
        const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
        await supa('POST',`/storage/v1/object/pms-photos/${path}`,bytes,false,{'Content-Type':mime,'x-upsert':'true'});
        imageUrl=`${SUPA_URL||_SUPA_URL_DEFAULT}/storage/v1/object/public/pms-photos/${path}`;
      }catch(imgE){console.warn('[alert img]',imgE);}
    }
    const alertData={id:alertId,tenant_id:tenantId,title:title||'Alerte retrait de lot',message,product_name,lot_number,product_dlc,image_url:imageUrl,site_codes:targetCodes,created_at:now,created_by:_profile?.id,created_by_name:_profile?.full_name||'',kind:'product_recall',closed_at:null,severity:'critical'};
    const rows=targetCodes.map(sc=>({
      site_id:sc,tenant_id:tenantId,enr_type:'hub_alert',
      client_id:`${alertId}:${sc}`,recorded_at:now,
      data:{...alertData,dispatch_site_code:sc}
    }));
    await supa('POST','/rest/v1/pms_records',rows,false,{'Prefer':'resolution=merge-duplicates,return=minimal'});
    await loadTabletAlertsHistory();
    showToast(`✅ Alerte envoyée à ${targetCodes.length} site(s)`,'success');
    clearAlertDraft();
    renderAdmin();
  }catch(e){
    showToast('Erreur envoi alerte : '+e.message,'error');
  }
}

async function closeTabletAlert(alertId){
  if(!alertId) return;
  _showConfirmDash(
    '🛑 Clôturer',
    "L'alerte ne sera plus visible sur les tablettes. Action irréversible.",
    '✅ Confirmer', async ()=>{
      try{
        const tenantId=_profile?.tenant_id||null;
        const closedAt=new Date().toISOString();
        const closedByName=_profile?.full_name||'';
        const existing=await supaGet('pms_records',
          `enr_type=in.(hub_alert,hub_photo_request)&client_id=like.${encodeURIComponent(alertId+'%')}&tenant_id=eq.${encodeURIComponent(tenantId)}&select=id,data`);
        for(const row of (existing||[])){
          const updated={...(row.data||{}),closed_at:closedAt,closed_by_name:closedByName};
          await supa('PATCH',`/rest/v1/pms_records?id=eq.${row.id}`,{data:updated},false,{'Prefer':'return=minimal'});
        }
        await loadTabletAlertsHistory();
        showToast('✅ Alerte clôturée','success');
        renderAdmin();
      }catch(e){
        showToast('Erreur clôture : '+e.message,'error');
      }
    }, 'primary'
  );
}

async function addProblemFromNC(problem,ncType,sourceSiteCode){
  const p = String(problem||'').trim();
  if(!p){
    showToast('Problème vide','warning');
    return;
  }
  copyText(p);
  try{
    await hubApi('POST','',{
      op:'knowledge_add_problem',
      problem:p,
      nc_type:normalizeNCTypeLocal(ncType),
      source_site_code:sourceSiteCode||''
    });
    showToast('✅ Problème ajouté à la base apprenante','success');
    if(_currentPage==='admin' && _adminTab==='corrective'){
      await loadKnowledgeData();
      renderAdmin();
    }
  }catch(e){
    showToast('Erreur ajout problème : '+e.message,'error');
  }
}

async function learnActionFromNC(problem,action,ncType,sourceSiteCode){
  const p = String(problem||'').trim();
  const a = String(action||'').trim();
  if(!p || !a){
    showToast('Problème/action manquant','warning');
    return;
  }
  copyText(a);
  try{
    await hubApi('POST','',{
      op:'knowledge_add_recommendation',
      problem:p,
      action:a,
      nc_type:normalizeNCTypeLocal(ncType),
      source_site_code:sourceSiteCode||''
    });
    showToast('🧠 Action apprise pour recommandations futures','success');
    if(_currentPage==='admin' && _adminTab==='corrective'){
      await loadKnowledgeData();
      renderAdmin();
    }
  }catch(e){
    showToast('Erreur apprentissage : '+e.message,'error');
  }
}

async function createTabletAccount(siteId, siteName, siteCode) {
  if (!_token) { showToast('Session expirée, reconnectez-vous', 'error'); return; }
  // Générer email et mot de passe
  const tenantSlug = (_profile?.tenant_id || 'tenant').slice(0, 8);
  const email = `tablette.${siteCode.toLowerCase()}@haccpro.app`;
  const pass  = siteCode.toLowerCase() + '-' + Math.random().toString(36).slice(2, 8);

  // Vérifier si le compte existe déjà
  const existCheck = await supaAdmin('GET', `/auth/v1/admin/users?email=${encodeURIComponent(email)}`, null).catch(()=>null);
  const existingUid = existCheck?.users?.[0]?.id;

  let uid = existingUid;
  if (!uid) {
    // Créer le compte Supabase
    const r = await supaAdmin('POST', '/auth/v1/admin/users', {
      email, password: pass, email_confirm: true
    }).catch(e => { showToast('Erreur création compte : ' + e.message, 'error'); return null; });
    if (!r?.id) return;
    uid = r.id;
  } else {
    // Compte existant → réinitialiser le mot de passe
    await supaAdmin('PUT', `/auth/v1/admin/users/${uid}`, { password: pass })
      .catch(e => showToast('⚠️ Reset mdp : ' + e.message, 'warning'));
  }

  // Créer/MAJ le profil avec tenant_id et site_id
  await supa('POST', '/rest/v1/profiles', {
    id: uid,
    full_name: 'Tablette ' + siteName,
    role: 'cuisinier',
    site_id: siteId,
    tenant_id: _profile?.tenant_id || null,
    email: email,
  }, false, { 'Prefer': 'resolution=merge-duplicates' }).catch(()=>{});

  // Afficher modal avec les identifiants
  const isNew = !existingUid;
  const passDisplay = pass; // toujours afficher le mot de passe
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(20,5,25,.78);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:18px;padding:24px;width:100%;max-width:420px;box-shadow:0 20px 60px rgba(92,30,90,.4)">
      <div style="font-size:1rem;font-weight:900;color:var(--navy);margin-bottom:4px">📱 Compte tablette ${isNew ? 'créé' : 'renouvelé'}</div>
      <div style="font-size:.75rem;color:var(--muted);margin-bottom:18px">${siteName} — ${siteCode}${!isNew ? ' · mot de passe réinitialisé' : ''}</div>

      <div style="background:var(--bg);border-radius:12px;padding:14px;margin-bottom:12px">
        <div style="font-size:.62rem;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:8px">À saisir dans le PMS tablette</div>
        <div style="margin-bottom:8px">
          <div style="font-size:.68rem;color:var(--muted);margin-bottom:3px">Email</div>
          <div style="font-size:.85rem;font-weight:800;font-family:monospace;background:#fff;border:1.5px solid var(--border);border-radius:8px;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;gap:8px">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${email}</span>
            <button data-copy="${email}" onclick="copyText(this.dataset.copy)" style="background:none;border:none;cursor:pointer;font-size:.9rem;flex-shrink:0">📋</button>
          </div>
        </div>
        <div style="margin-bottom:8px">
          <div style="font-size:.68rem;color:var(--muted);margin-bottom:3px">Mot de passe</div>
          <div style="font-size:.85rem;font-weight:800;font-family:monospace;background:#fff;border:1.5px solid var(--border);border-radius:8px;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;gap:8px">
            <span>${passDisplay}</span>
            <button data-copy="${pass}" onclick="copyText(this.dataset.copy)" style="background:none;border:none;cursor:pointer;font-size:.9rem;flex-shrink:0">📋</button>
          </div>
        </div>
        <div>
          <div style="font-size:.68rem;color:var(--muted);margin-bottom:3px">Code site</div>
          <div style="font-size:.85rem;font-weight:800;font-family:monospace;background:#fff;border:1.5px solid var(--border);border-radius:8px;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;gap:8px">
            <span>${siteCode}</span>
            <button data-copy="${siteCode}" onclick="copyText(this.dataset.copy)" style="background:none;border:none;cursor:pointer;font-size:.9rem;flex-shrink:0">📋</button>
          </div>
        </div>
      </div>

      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 12px;font-size:.72rem;color:#92400e;margin-bottom:16px">
        💡 Notez ce mot de passe maintenant — il ne sera plus affiché.
      </div>

      <button onclick="this.closest('[style*=fixed]').remove()" style="width:100%;padding:12px;background:var(--navy);color:#fff;border:none;border-radius:12px;font-size:.88rem;font-weight:800;cursor:pointer;font-family:var(--font)">
        ✅ C'est noté, fermer
      </button>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

async function toggleDataLock(profileId, currentlyLocked) {
  const newState = !currentlyLocked;
  const label = newState ? 'Verrouiller' : 'Déverrouiller';
  if (!confirm(`${label} l'accès aux données pour cet utilisateur ?`)) return;
  try {
    await supa('PATCH', `/rest/v1/profiles?id=eq.${profileId}`, { data_locked: newState });
    showToast(newState ? '🔒 Accès verrouillé' : '🔓 Accès déverrouillé', newState ? 'warning' : 'success');
    renderAdmin();
  } catch(e) {
    showToast('Erreur : ' + e.message, 'error');
  }
}

function generateGMOPDF(gmoId) {
  const g    = _gmos.find(x => x.id === gmoId);
  if (!g) return;
  const site = _sites.find(s => s.id === g.site_id);
  const sc   = g.scores || {};
  const pct  = sc._global ?? null;
  const bilan = sc._bilan || [];
  const detail = sc._detail || {};      // { critKey: 0|1|2 }
  const constats = sc._constats || {};  // { critKey: 'texte' }
  const actions  = sc._actions  || {};  // { critKey: 'texte' }

  const dt = new Date(g.visit_date+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const majCount = bilan.filter(n=>n.niveau==='NC majeure').length;
  const minCount = bilan.filter(n=>n.niveau==='NC mineure').length;
  const corCount = bilan.filter(n=>n.verifie).length;
  const okCount  = Object.values(detail).filter(v=>v===2).length;

  // ── Construire les sections par axe ──────────────────
  const axeSections = GMO_AXES.map(axe => {
    const axeScore = gmoAxeScore(axe.key, detail);
    const col = axeScore!=null ? (axeScore>=85?'#16a34a':axeScore>=70?'#d97706':'#dc2626') : '#9ca3af';

    const criteresRows = axe.criteres.map(c => {
      const val = detail[c.key];
      const constat = constats[c.key] || '';
      const action  = actions[c.key]  || '';

      let badge, bgRow;
      if (val === 2)      { badge = '<span style="font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;background:#d1fae5;color:#065f46">✓ Conforme</span>';   bgRow = '#f9fffe'; }
      else if (val === 1) { badge = '<span style="font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;background:#fef3c7;color:#92400e">△ NC mineure</span>';  bgRow = '#fffcf0'; }
      else if (val === 0) { badge = '<span style="font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;background:#fee2e2;color:#991b1b">✗ NC majeure</span>';  bgRow = '#fff8f8'; }
      else                { badge = '<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:6px;background:#f1f5f9;color:#94a3b8">— Non noté</span>';   bgRow = '#fafafa'; }

      return `<tr style="background:${bgRow}">
        <td style="padding:7px 10px;font-size:11px;color:#374151;border-bottom:1px solid #f1f5f9;vertical-align:top;width:46%">${c.label}</td>
        <td style="padding:7px 10px;font-size:11px;border-bottom:1px solid #f1f5f9;vertical-align:top;width:18%">${badge}</td>
        <td style="padding:7px 10px;font-size:11px;color:#6b7280;font-style:italic;border-bottom:1px solid #f1f5f9;vertical-align:top;width:18%">${constat ? '📝 '+constat : ''}</td>
        <td style="padding:7px 10px;font-size:11px;color:#1d4ed8;border-bottom:1px solid #f1f5f9;vertical-align:top;width:18%">${action ? '→ '+action : ''}</td>
      </tr>`;
    }).join('');

    return `<div style="margin-bottom:16px;break-inside:avoid">
      <div style="display:flex;justify-content:space-between;align-items:center;background:#faf6fa;padding:8px 12px;border-radius:10px 10px 0 0;border:1px solid #e2e8f0;border-bottom:none">
        <span style="font-size:13px;font-weight:800;color:#1e3a5f">${axe.icon} ${axe.label}</span>
        <span style="font-size:13px;font-weight:900;color:${col}">${axeScore!=null?axeScore+'%':'—'}</span>
      </div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:0 0 8px 8px;overflow:hidden">
        <thead>
          <tr style="background:#f1f5f9">
            <th style="padding:5px 10px;font-size:10px;font-weight:700;color:#6b7280;text-align:left;text-transform:uppercase;letter-spacing:.5px">Critère</th>
            <th style="padding:5px 10px;font-size:10px;font-weight:700;color:#6b7280;text-align:left;text-transform:uppercase;letter-spacing:.5px">Résultat</th>
            <th style="padding:5px 10px;font-size:10px;font-weight:700;color:#6b7280;text-align:left;text-transform:uppercase;letter-spacing:.5px">Constat</th>
            <th style="padding:5px 10px;font-size:10px;font-weight:700;color:#6b7280;text-align:left;text-transform:uppercase;letter-spacing:.5px">Action corrective</th>
          </tr>
        </thead>
        <tbody>${criteresRows}</tbody>
      </table>
    </div>`;
  }).join('');

  // ── Scores par axe (résumé) ──────────────────────────
  const axeScoresBars = Object.entries(sc)
    .filter(([k,v]) => !k.startsWith('_') && typeof v === 'number')
    .map(([k,v]) => {
      const axe = GMO_AXES.find(a=>a.key===k);
      if (!axe) return '';
      const col = v>=85?'#16a34a':v>=70?'#d97706':'#dc2626';
      return `<tr>
        <td style="padding:4px 8px;font-size:11px">${axe.icon} ${axe.label}</td>
        <td style="padding:4px 8px;vertical-align:middle">
          <div style="width:120px;height:7px;background:#e5e7eb;border-radius:4px;display:inline-block;vertical-align:middle">
            <div style="width:${Math.round(v)}%;height:100%;background:${col};border-radius:4px"></div>
          </div>
        </td>
        <td style="padding:4px 8px;font-size:11px;font-weight:900;color:${col};text-align:right">${Math.round(v)}%</td>
      </tr>`;
    }).join('');

  const sigDataURL = sc._signature || null;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Rapport GMO — ${site?.name||''} — ${g.visit_date||''}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a202c; font-size: 12px; }
  .page { max-width: 860px; margin: 0 auto; padding: 24px; }
  .header { background: linear-gradient(135deg,#0F2240,#1a3a6a); color: #fff; padding: 20px 24px; border-radius: 12px; margin-bottom: 20px; }
  .score-big { font-size: 2.8rem; font-weight: 900; line-height: 1; }
  .section-title { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #64748b; margin: 20px 0 8px; border-bottom: 2px solid #e2e8f0; padding-bottom: 4px; }
  .summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
  @media print {
    body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    .page { padding: 15px; }
    .no-break { break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- HEADER -->
  <div class="header">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px">
      <div>
        <div style="font-size:10px;letter-spacing:1px;opacity:.55;text-transform:uppercase;margin-bottom:5px">Rapport de visite GMO</div>
        <div style="font-size:1.5rem;font-weight:900;margin-bottom:3px">${site?.name||'—'}</div>
        <div style="font-size:12px;opacity:.7;display:flex;align-items:center;gap:8px"><span>${dt}</span>${site?.code?`<span style="font-family:monospace;font-size:11px;background:rgba(255,255,255,.15);padding:1px 7px;border-radius:5px">${site.code}</span>`:''}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div class="score-big" style="color:${pct>=85?'#86efac':pct>=70?'#fcd34d':'#fca5a5'}">${pct!=null?pct+'%':'—'}</div>
        <div style="font-size:11px;opacity:.75;margin-top:2px">${pct>=85?'✅ Satisfaisant':pct>=70?'⚠️ À améliorer':'🔴 Insuffisant'}</div>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
      <span style="font-size:11px;font-weight:700;padding:3px 10px;background:rgba(255,255,255,.15);border-radius:8px">${okCount} conforme${okCount>1?'s':''}</span>
      ${majCount?`<span style="font-size:11px;font-weight:800;padding:3px 10px;background:rgba(239,68,68,.35);border-radius:8px;color:#fca5a5">${majCount} NC majeure${majCount>1?'s':''}</span>`:''}
      ${minCount?`<span style="font-size:11px;font-weight:800;padding:3px 10px;background:rgba(251,191,36,.3);border-radius:8px;color:#fcd34d">${minCount} NC mineure${minCount>1?'s':''}</span>`:''}
      ${corCount?`<span style="font-size:11px;font-weight:800;padding:3px 10px;background:rgba(52,211,153,.25);border-radius:8px;color:#6ee7b7">${corCount} corrigée${corCount>1?'s':''}</span>`:''}
    </div>
  </div>

  <!-- RÉSUMÉ SCORES PAR AXE -->
  <div class="summary-grid no-break">
    <div>
      <div class="section-title">Scores par axe</div>
      <table style="width:100%;border-collapse:collapse">${axeScoresBars}</table>
    </div>
    <div>
      <div class="section-title">Observations générales</div>
      <div style="background:#faf6fa;border-radius:8px;padding:12px;font-size:12px;font-style:italic;color:#374151;min-height:60px">${g.observations||'<span style="color:#9ca3af">Aucune observation</span>'}</div>
      <div class="section-title" style="margin-top:14px">Signature chef de secteur</div>
      <div style="border:2px dashed #e2e8f0;border-radius:8px;padding:10px;min-height:70px;display:flex;align-items:center;justify-content:center;background:#fafafa">
        ${sigDataURL?`<img src="${sigDataURL}" style="max-height:65px;max-width:100%">` : '<span style="color:#d1d5db;font-size:12px">Aucune signature</span>'}
      </div>
    </div>
  </div>

  <!-- DÉTAIL COMPLET PAR AXE -->
  <div class="section-title">Évaluation détaillée — Tous les critères</div>
  ${axeSections}

  <!-- PIED DE PAGE -->
  <div style="text-align:center;margin-top:20px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:10px;color:#94a3b8">
    Rapport généré le ${new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'})} à ${new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})} — PMS HACCP Dashboard | ${site?.name||''} | Visite du ${g.visit_date||''}
  </div>
</div>
</body></html>`;

  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 800);
  }
}


function switchAdminTab(tab){ _adminTab=tab; renderAdmin(); }

// ── Modal d'édition ─────────────────────────────────
function openAdminModal(type, id, prefill={}) {
  _adminModal = {type, id, prefill};
  const ov = document.getElementById('admin-modal-ov');
  const box = document.getElementById('admin-modal-content');
  if (!ov||!box) { renderAdmin(); setTimeout(()=>openAdminModal(type,id,prefill),200); return; }

  const roleOpts=[{v:'siege',l:'🏛️ Siège'},{v:'directeur',l:'📊 Directeur'},{v:'chef_secteur',l:'👔 Chef de secteur'},{v:'cuisinier',l:'👨‍🍳 Cuisinier'}];
  let content='';

  // Rediriger create-user vers sa propre fonction
  if (type === 'create-user') { openCreateUserModal(); return; }

  if (type==='territory') {
    const t = id ? _territories.find(x=>x.id===id) : null;
    content=`<div style="padding:20px">
      <div style="font-size:1rem;font-weight:900;color:var(--navy);margin-bottom:16px">${id?'✏️ Modifier le territoire':'➕ Nouveau territoire'}</div>
      <div class="admin-field"><label>Nom du territoire</label><input type="text" id="am-terr-name" placeholder="Ex: Île-de-France" value="${escH(t?.name||'')}"></div>
      <div class="admin-field"><label>Code court</label><input type="text" id="am-terr-code" placeholder="Ex: IDF" value="${t?.code||''}" oninput="this.value=this.value.toUpperCase()" style="text-transform:uppercase"></div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button onclick="saveAdminModal()" style="flex:1;padding:12px;background:var(--navy);color:#fff;border:none;border-radius:10px;font-weight:800;cursor:pointer;font-family:var(--font)">💾 Enregistrer</button>
        <button onclick="closeAdminModal()" style="padding:12px 16px;background:#f1f5f9;color:var(--muted);border:none;border-radius:10px;font-weight:700;cursor:pointer;font-family:var(--font)">Annuler</button>
        ${id?`<button onclick="confirmDelete('territories','${id}','${escH(t?.name||'')}')" style="padding:12px;background:#fff5f5;color:#dc2626;border:none;border-radius:10px;font-weight:700;cursor:pointer;font-family:var(--font)">🗑</button>`:''}
      </div>
    </div>`;
  }

  else if (type==='sector') {
    const s = id ? _sectors.find(x=>x.id===id) : null;
    const defTerrId = prefill.territory_id||s?.territory_id||'';
    content=`<div style="padding:20px">
      <div style="font-size:1rem;font-weight:900;color:var(--navy);margin-bottom:16px">${id?'✏️ Modifier le secteur':'➕ Nouveau secteur'}</div>
      <div class="admin-field"><label>Territoire</label>
        <select id="am-sect-terr">
          <option value="">Sans territoire</option>
          ${_territories.map(t=>`<option value="${t.id}" ${t.id===defTerrId?'selected':''}>${t.name}</option>`).join('')}
        </select>
      </div>
      <div class="admin-field"><label>Nom du secteur</label><input type="text" id="am-sect-name" placeholder="Ex: IDF Nord" value="${escH(s?.name||'')}"></div>
      <div class="admin-field"><label>Code</label><input type="text" id="am-sect-code" placeholder="Ex: IDF_NORD" value="${s?.code||''}" oninput="this.value=this.value.toUpperCase()" style="text-transform:uppercase"></div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button onclick="saveAdminModal()" style="flex:1;padding:12px;background:var(--navy);color:#fff;border:none;border-radius:10px;font-weight:800;cursor:pointer;font-family:var(--font)">💾 Enregistrer</button>
        <button onclick="closeAdminModal()" style="padding:12px 16px;background:#f1f5f9;color:var(--muted);border:none;border-radius:10px;font-weight:700;cursor:pointer;font-family:var(--font)">Annuler</button>
        ${id?`<button onclick="confirmDelete('sectors','${id}','${escH(s?.name||'')}')" style="padding:12px;background:#fff5f5;color:#dc2626;border:none;border-radius:10px;font-weight:700;cursor:pointer;font-family:var(--font)">🗑</button>`:''}
      </div>
    </div>`;
  }

  else if (type==='site') {
    const s = id ? _sites.find(x=>x.id===id) : null;
    const defCode = prefill.code||s?.code||'';
    const defSect = prefill.sector_id||s?.sector_id||'';
    content=`<div style="padding:20px">
      <div style="font-size:1rem;font-weight:900;color:var(--navy);margin-bottom:16px">${id?'✏️ Modifier le site':'➕ Nouveau site'}</div>
      <div class="admin-field"><label>Nom de l'établissement</label><input type="text" id="am-site-name" placeholder="Ex: EHPAD Les Tilleuls" value="${escH(s?.name||'')}"></div>
      <div class="admin-field"><label>Code site <span style="color:#dc2626">*</span> <span style="font-weight:400;color:var(--muted)">(à saisir sur la tablette)</span></label>
        <input type="text" id="am-site-code" placeholder="Ex: RA3414" value="${defCode}" oninput="this.value=this.value.toUpperCase()" style="text-transform:uppercase;font-family:var(--mono);font-weight:700">
      </div>
      <div class="admin-field"><label>Secteur</label>
        <select id="am-site-sect">
          <option value="">Sans secteur</option>
          ${_sectors.map(sc=>`<option value="${sc.id}" ${sc.id===defSect?'selected':''}>${sc.name}</option>`).join('')}
        </select>
      </div>
      <div class="admin-field"><label>Adresse</label><input type="text" id="am-site-addr" placeholder="12 rue de la Paix, 75001 Paris" value="${escH(s?.address||'')}"></div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button onclick="saveAdminModal()" style="flex:1;padding:12px;background:var(--navy);color:#fff;border:none;border-radius:10px;font-weight:800;cursor:pointer;font-family:var(--font)">💾 Enregistrer</button>
        <button onclick="closeAdminModal()" style="padding:12px 16px;background:#f1f5f9;color:var(--muted);border:none;border-radius:10px;font-weight:700;cursor:pointer;font-family:var(--font)">Annuler</button>
        ${id?`<button onclick="confirmDelete('sites','${id}','${escH(s?.name||'')}')" style="padding:12px;background:#fff5f5;color:#dc2626;border:none;border-radius:10px;font-weight:700;cursor:pointer;font-family:var(--font)">🗑</button>`:''}
      </div>
    </div>`;
  }

  else if (type==='corrective-action') {
    const a = id ? _correctiveActions.find(x=>x.id===id) : null;
    content=`<div style="padding:20px">
      <div style="font-size:1rem;font-weight:900;color:var(--navy);margin-bottom:16px">${id?'✏️ Modifier action corrective':'➕ Nouvelle action corrective'}</div>
      <div class="admin-field"><label>Nom</label><input type="text" id="am-ca-name" placeholder="Ex: Remise en température immédiate" value="${escH(a?.name||'')}"></div>
      <div class="admin-field"><label>Description</label><textarea id="am-ca-desc" rows="3" placeholder="Conduite à tenir sur le terrain">${escH(a?.description||'')}</textarea></div>
      <div class="admin-field"><label>Catégorie</label>
        <select id="am-ca-category">
          ${[
            ['temperature','🌡️ Température'],
            ['hygiene','🧼 Hygiène'],
            ['storage','📦 Stockage'],
            ['autre','📝 Autre']
          ].map(([k,l])=>`<option value="${k}" ${(a?.category||'')===k?'selected':''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="admin-field" style="display:flex;align-items:center;gap:8px">
        <input type="checkbox" id="am-ca-default" ${a?.is_default?'checked':''} style="width:18px;height:18px">
        <label for="am-ca-default" style="margin:0;font-size:.8rem;font-weight:700;color:var(--text)">Action par défaut</label>
      </div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button onclick="saveAdminModal()" style="flex:1;padding:12px;background:var(--navy);color:#fff;border:none;border-radius:10px;font-weight:800;cursor:pointer;font-family:var(--font)">💾 Enregistrer</button>
        <button onclick="closeAdminModal()" style="padding:12px 16px;background:#f1f5f9;color:var(--muted);border:none;border-radius:10px;font-weight:700;cursor:pointer;font-family:var(--font)">Annuler</button>
        ${id?`<button onclick="confirmDelete('corrective_actions','${id}','${escH(a?.name||'')}')" style="padding:12px;background:#fff5f5;color:#dc2626;border:none;border-radius:10px;font-weight:700;cursor:pointer;font-family:var(--font)">🗑</button>`:''}
      </div>
    </div>`;
  }

  else if (type==='corrective-mapping') {
    const typeKey = (id||prefill.type||'autre').toLowerCase();
    const mappedIds = new Set((_ncActionMappings||[])
      .filter(m=>(m.non_conformity_type||'').toLowerCase()===typeKey)
      .map(m=>m.corrective_action_id));
    const typeLabel = {
      temperature:'🌡️ Température',
      hygiene:'🧼 Hygiène',
      storage:'📦 Stockage',
      autre:'📝 Autre'
    }[typeKey] || typeKey;
    content=`<div style="padding:20px">
      <div style="font-size:1rem;font-weight:900;color:var(--navy);margin-bottom:6px">🔗 Lier actions et type NC</div>
      <div style="font-size:.78rem;color:var(--muted);margin-bottom:14px">Type: <strong>${typeLabel}</strong></div>
      <input type="hidden" id="am-map-type" value="${typeKey}">
      <div style="max-height:52vh;overflow-y:auto;border:1px solid var(--border);border-radius:10px;padding:8px 10px;background:#fafafa">
        ${_correctiveActions.length?_correctiveActions.map(a=>`<label style="display:flex;align-items:flex-start;gap:8px;padding:7px 2px;border-bottom:1px solid #edf2f7;cursor:pointer">
          <input type="checkbox" class="am-map-action" value="${a.id}" ${mappedIds.has(a.id)?'checked':''} style="margin-top:2px;width:17px;height:17px">
          <span style="flex:1;min-width:0">
            <span style="display:block;font-size:.8rem;font-weight:800;color:#1f2937">${escH(a.name||'')}</span>
            ${a.description?`<span style="display:block;font-size:.7rem;color:var(--muted)">${escH(a.description)}</span>`:''}
          </span>
        </label>`).join(''):'<div style="font-size:.78rem;color:var(--muted);padding:8px">Aucune action corrective disponible.</div>'}
      </div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button onclick="saveAdminModal()" style="flex:1;padding:12px;background:var(--navy);color:#fff;border:none;border-radius:10px;font-weight:800;cursor:pointer;font-family:var(--font)">💾 Enregistrer</button>
        <button onclick="closeAdminModal()" style="padding:12px 16px;background:#f1f5f9;color:var(--muted);border:none;border-radius:10px;font-weight:700;cursor:pointer;font-family:var(--font)">Annuler</button>
      </div>
    </div>`;
  }
  else if (type==='knowledge-problem') {
    const item = id ? _knowledgeProblems.find(x=>x.id===id) : null;
    content=`<div style="padding:20px">
      <div style="font-size:1rem;font-weight:900;color:var(--navy);margin-bottom:16px">${id?'✏️ Modifier problème type':'➕ Nouveau problème type'}</div>
      <div class="admin-field"><label>Type de non-conformité</label>
        <select id="am-kp-type">
          ${[
            ['temperature','🌡️ Température'],
            ['hygiene','🧼 Hygiène'],
            ['storage','📦 Stockage'],
            ['autre','📝 Autre']
          ].map(([k,l])=>`<option value="${k}" ${(item?.nc_type||'autre')===k?'selected':''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="admin-field"><label>Problème type</label><textarea id="am-kp-problem" rows="3" placeholder="Ex: Chambre froide +8°C à l'ouverture">${escH(item?.problem||'')}</textarea></div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button onclick="saveAdminModal()" style="flex:1;padding:12px;background:var(--navy);color:#fff;border:none;border-radius:10px;font-weight:800;cursor:pointer;font-family:var(--font)">💾 Enregistrer</button>
        <button onclick="closeAdminModal()" style="padding:12px 16px;background:#f1f5f9;color:var(--muted);border:none;border-radius:10px;font-weight:700;cursor:pointer;font-family:var(--font)">Annuler</button>
      </div>
    </div>`;
  }
  else if (type==='knowledge-recommendation') {
    const item = id ? _knowledgeRecommendations.find(x=>x.id===id) : null;
    content=`<div style="padding:20px">
      <div style="font-size:1rem;font-weight:900;color:var(--navy);margin-bottom:16px">${id?'✏️ Modifier recommandation':'➕ Nouvelle recommandation'}</div>
      <div class="admin-field"><label>Type de non-conformité</label>
        <select id="am-kr-type">
          ${[
            ['temperature','🌡️ Température'],
            ['hygiene','🧼 Hygiène'],
            ['storage','📦 Stockage'],
            ['autre','📝 Autre']
          ].map(([k,l])=>`<option value="${k}" ${(item?.nc_type||'autre')===k?'selected':''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="admin-field"><label>Problème lié</label><textarea id="am-kr-problem" rows="3" placeholder="Ex: Température de réception non conforme">${escH(item?.problem||'')}</textarea></div>
      <div class="admin-field"><label>Action recommandée</label><textarea id="am-kr-action" rows="3" placeholder="Ex: Isoler le lot et informer le responsable">${escH(item?.action||'')}</textarea></div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button onclick="saveAdminModal()" style="flex:1;padding:12px;background:var(--navy);color:#fff;border:none;border-radius:10px;font-weight:800;cursor:pointer;font-family:var(--font)">💾 Enregistrer</button>
        <button onclick="closeAdminModal()" style="padding:12px 16px;background:#f1f5f9;color:var(--muted);border:none;border-radius:10px;font-weight:700;cursor:pointer;font-family:var(--font)">Annuler</button>
      </div>
    </div>`;
  }

  else if (type==='user') {
    const p = id ? null : null; // on passe l'id directement
    // On va chercher dans profiles (rechargé)
    content=`<div style="padding:20px">
      <div style="font-size:1rem;font-weight:900;color:var(--navy);margin-bottom:16px">✏️ Modifier l'utilisateur</div>
      <input type="hidden" id="am-user-id" value="${id||''}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="admin-field"><label>Prénom</label><input type="text" id="am-user-prenom" placeholder="Prénom"></div>
        <div class="admin-field"><label>Nom</label><input type="text" id="am-user-nom" placeholder="Nom"></div>
      </div>
      <input type="hidden" id="am-user-name">
      <div class="admin-field"><label>Email</label><input type="email" id="am-user-email" placeholder="email@domaine.fr" autocomplete="off"></div>
      <div class="admin-field"><label>Téléphone</label><input type="tel" id="am-user-phone" placeholder="06 12 34 56 78"></div>
      <div class="admin-field"><label>Rôle</label>
        <select id="am-user-role" onchange="amUpdateUserFields()">
          ${roleOpts.map(r=>`<option value="${r.v}">${r.l}</option>`).join('')}
        </select>
      </div>
      <div class="admin-field" id="am-field-site"><label>Site (cuisinier)</label>
        <select id="am-user-site">
          <option value="">Aucun</option>
          ${_sites.map(s=>`<option value="${s.id}">${s.name} (${s.code})</option>`).join('')}
        </select>
      </div>
      <div class="admin-field" id="am-field-sector"><label>Secteur (chef de secteur)</label>
        <select id="am-user-sector">
          <option value="">Aucun</option>
          ${_sectors.map(s=>`<option value="${s.id}">${s.name}</option>`).join('')}
        </select>
      </div>
      <div class="admin-field" id="am-field-territory"><label>Territoire (directeur)</label>
        <select id="am-user-territory">
          <option value="">Aucun</option>
          ${_territories.map(t=>`<option value="${t.id}">${t.name}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button onclick="saveAdminModal()" style="flex:1;padding:12px;background:var(--navy);color:#fff;border:none;border-radius:10px;font-weight:800;cursor:pointer;font-family:var(--font)">💾 Enregistrer</button>
        <button onclick="closeAdminModal()" style="padding:12px 16px;background:#f1f5f9;color:var(--muted);border:none;border-radius:10px;font-weight:700;cursor:pointer;font-family:var(--font)">Annuler</button>
        ${id?`<button onclick="confirmDeleteUser('${id||''}')" style="padding:12px;background:#fff5f5;color:#dc2626;border:none;border-radius:10px;font-weight:700;cursor:pointer;font-family:var(--font)">🗑</button>`:''}
      </div>
    </div>`;
  }

  box.innerHTML = content;
  ov.style.display='flex';

  // Pré-remplir user si id fourni
  if (type==='user' && id) {
    // Chercher dans les derniers profils chargés
    supaGet('profiles',`select=*&id=eq.${id}&limit=1`).then(rows=>{
      const p=rows[0];
      if(!p)return;
      const parts=(p.full_name||'').split(' ');
      const prenomEl=document.getElementById('am-user-prenom');
      const nomEl=document.getElementById('am-user-nom');
      const nameEl=document.getElementById('am-user-name');
      const emailEl=document.getElementById('am-user-email');
      const phoneEl=document.getElementById('am-user-phone');
      const roleEl=document.getElementById('am-user-role');
      const siteEl=document.getElementById('am-user-site');
      const sectEl=document.getElementById('am-user-sector');
      const terrEl=document.getElementById('am-user-territory');
      if(prenomEl) prenomEl.value=parts[0]||'';
      if(nomEl) nomEl.value=parts.slice(1).join(' ')||'';
      if(nameEl) nameEl.value=p.full_name||'';
      if(emailEl) emailEl.value=p.email||'';
      if(phoneEl) phoneEl.value=p.phone||'';
      if(roleEl){ roleEl.value=p.role||'cuisinier'; amUpdateUserFields(); }
      if(siteEl) siteEl.value=p.site_id||'';
      if(sectEl) sectEl.value=p.sector_id||'';
      if(terrEl) terrEl.value=p.territory_id||'';
    }).catch(()=>{});
  }
  amUpdateUserFields();
}

function amUpdateUserFields(){
  const role=document.getElementById('am-user-role')?.value||'';
  const sf=document.getElementById('am-field-site');
  const scf=document.getElementById('am-field-sector');
  const tf=document.getElementById('am-field-territory');
  if(sf) sf.style.display=role==='cuisinier'?'block':'none';
  if(scf) scf.style.display=role==='chef_secteur'?'block':'none';
  if(tf) tf.style.display=role==='directeur'?'block':'none';
}

// ── Créer un utilisateur ────────────────────────────
async function createUser(email, password, fullName, role, siteId, sectorId, terrId, phone=''){
  if(!_token){ showToast('⚠️ Session expirée, reconnectez-vous', 'error'); return false; }

  let uid = null;

  // 1. Essayer de créer le compte Auth
  try {
    const authData = await supaAdmin('POST','/auth/v1/admin/users',{
      email, password,
      email_confirm: true,
      user_metadata: { full_name: fullName }
    });
    if(authData?.id) uid = authData.id;
  } catch(e) {
    // Détecter toutes les variantes d'erreur "email déjà utilisé"
    // Supabase peut retourner 409, 422, "email_exists", "already exists", "duplicate"
    const isEmailExists = e.message.includes('409')
      || e.message.includes('422')
      || e.message.includes('email_exists')
      || e.message.includes('already registered')
      || e.message.includes('already exists')
      || e.message.includes('duplicate');

    if(isEmailExists) {
      // Email déjà dans Supabase → trouver l'uid SANS jamais changer le mot de passe
      try {
        const usersResp = await supaAdmin('GET',`/auth/v1/admin/users?page=1&per_page=1000`,null);
        const allUsers = usersResp?.users || usersResp || [];
        const found = allUsers.find(u => u.email === email);

        if(!found?.id) {
          throw new Error('Email déjà utilisé mais introuvable dans le système. Vérifiez l\'adresse ou contactez le support.');
        }
        uid = found.id;

        // Vérifier si ce user appartient à un autre tenant → refuser
        const existingProfiles = await supa('GET',
          `/rest/v1/profiles?id=eq.${uid}&select=id,tenant_id`,null);
        const existing = Array.isArray(existingProfiles) && existingProfiles[0];
        if(existing && existing.tenant_id && existing.tenant_id !== (_profile?.tenant_id||null)) {
          throw new Error(
            'L\'email ' + email + ' appartient à un autre établissement. '
            + 'Choisissez une adresse différente.'
          );
        }

        // Même tenant ou pas encore de profil : on peut associer
        // ⚠️ On ne touche JAMAIS au mot de passe d'un compte existant
        showToast('ℹ️ Email déjà enregistré — profil mis à jour sans changer le mot de passe','info');

      } catch(e2) {
        if(e2.message.includes('établissement') || e2.message.includes('introuvable')) throw e2;
        throw new Error('Email déjà utilisé. ' + e2.message);
      }
    } else {
      throw e;
    }

  }

  if(!uid) throw new Error('Impossible de créer ou récupérer le compte');

  // 2. UPSERT du profil
  // Si service_role dispo → supaAdmin (bypasse RLS)
  // Sinon → supa() avec JWT (fonctionne si la RLS profiles_rls_fix.sql a été exécutée)
  const profileData = {
    id: uid,
    full_name: fullName,
    role,
    email,
    phone: phone||null,
    site_id: siteId||null,
    sector_id: sectorId||null,
    territory_id: terrId||null,
    tenant_id: _profile?.tenant_id || null,
  };
  await supaAdmin('POST','/rest/v1/profiles', profileData,
    {'Prefer':'resolution=merge-duplicates,return=minimal'});
  return uid;
}

// ── Modal création utilisateur ────────────────────
function openCreateUserModal(){
  _adminModal={type:'create-user',id:null};
  const ov=document.getElementById('admin-modal-ov');
  const box=document.getElementById('admin-modal-content');
  if(!ov||!box){renderAdmin();setTimeout(()=>openCreateUserModal(),200);return;}

  const roleOpts=[
    {v:'siege',l:'🏛️ Siège'},
    {v:'directeur',l:'📊 Directeur de territoire'},
    {v:'chef_secteur',l:'👔 Chef de secteur'},
    {v:'cuisinier',l:'👨‍🍳 Cuisinier'}
  ];

  box.innerHTML=`<div style="padding:22px">
    <div style="font-size:1rem;font-weight:900;color:var(--navy);margin-bottom:4px">➕ Inviter un utilisateur</div>
    <div style="font-size:.75rem;color:var(--muted);margin-bottom:18px">Un compte sera créé et les identifiants générés.</div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="admin-field"><label>Prénom <span style="color:#dc2626">*</span></label>
        <input type="text" id="cu-prenom" placeholder="Prénom">
      </div>
      <div class="admin-field"><label>Nom <span style="color:#dc2626">*</span></label>
        <input type="text" id="cu-nom" placeholder="Nom">
      </div>
    </div>
    <input type="hidden" id="cu-name">
    <div class="admin-field"><label>Email <span style="color:#dc2626">*</span></label>
      <input type="email" id="cu-email" placeholder="prenom.nom@etablissement.fr" autocomplete="off">
    </div>
    <div class="admin-field"><label>Téléphone</label>
      <input type="tel" id="cu-phone" placeholder="06 12 34 56 78">
    </div>
    <div class="admin-field"><label>Mot de passe provisoire <span style="color:#dc2626">*</span></label>
      <div style="display:flex;gap:6px">
        <input type="text" id="cu-pass" placeholder="Min. 8 caractères" style="flex:1;font-family:var(--mono)">
        <button onclick="cuGenPass()" style="padding:8px 12px;background:#f1f5f9;border:1.5px solid var(--border);border-radius:8px;cursor:pointer;font-size:.75rem;font-weight:700;font-family:var(--font)">🎲 Générer</button>
      </div>
    </div>
    <div class="admin-field"><label>Rôle <span style="color:#dc2626">*</span></label>
      <select id="cu-role" onchange="cuUpdateFields()">
        ${roleOpts.map(r=>`<option value="${r.v}">${r.l}</option>`).join('')}
      </select>
    </div>
    <div id="cu-field-site" class="admin-field" style="display:none"><label>Site (cuisine)</label>
      <select id="cu-site">
        <option value="">— Sélectionner —</option>
        ${_sites.map(s=>`<option value="${s.id}">${s.name} (${s.code})</option>`).join('')}
      </select>
    </div>
    <div id="cu-field-sector" class="admin-field" style="display:none"><label>Secteur</label>
      <select id="cu-sector">
        <option value="">— Sélectionner —</option>
        ${_sectors.map(s=>`<option value="${s.id}">${s.name}</option>`).join('')}
      </select>
    </div>
    <div id="cu-field-terr" class="admin-field" style="display:none"><label>Territoire</label>
      <select id="cu-terr">
        <option value="">— Sélectionner —</option>
        ${_territories.map(t=>`<option value="${t.id}">${t.name}</option>`).join('')}
      </select>
    </div>

    <!-- Récap identifiants -->
    <div id="cu-recap" style="display:none;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px;margin-top:14px">
      <div style="font-size:.8rem;font-weight:800;color:#166534;margin-bottom:10px">✅ Compte créé — informations d'accès</div>
      <div style="font-family:var(--mono);font-size:.8rem;line-height:1.8" id="cu-recap-txt"></div>
      <button onclick="cuCopyInfo()" style="margin-top:10px;width:100%;padding:10px;background:#16a34a;color:#fff;border:none;border-radius:8px;font-weight:800;cursor:pointer;font-family:var(--font)">📋 Copier les identifiants</button>
    </div>

    <div style="display:flex;gap:8px;margin-top:18px" id="cu-btns">
      <button onclick="cuSubmit()" id="cu-submit" style="flex:1;padding:13px;background:var(--navy);color:#fff;border:none;border-radius:10px;font-weight:800;cursor:pointer;font-family:var(--font)">✅ Créer le compte</button>
      <button onclick="closeAdminModal()" style="padding:13px 16px;background:#f1f5f9;color:var(--muted);border:none;border-radius:10px;font-weight:700;cursor:pointer;font-family:var(--font)">Annuler</button>
    </div>
  </div>`;

  ov.style.display='flex';
  cuUpdateFields();
}

function cuGenPass(){
  const chars='abcdefghijkmnpqrstuvwxyz23456789!@#';
  let pass='';
  for(let i=0;i<10;i++) pass+=chars[Math.floor(Math.random()*chars.length)];
  const el=document.getElementById('cu-pass');
  if(el) el.value=pass;
}

function cuUpdateFields(){
  const role=document.getElementById('cu-role')?.value||'cuisinier';
  const sf=document.getElementById('cu-field-site');
  const scf=document.getElementById('cu-field-sector');
  const tf=document.getElementById('cu-field-terr');
  if(sf) sf.style.display=role==='cuisinier'?'block':'none';
  if(scf) scf.style.display=role==='chef_secteur'?'block':'none';
  if(tf) tf.style.display=role==='directeur'?'block':'none';
}

async function cuSubmit(){
  const prenom=(document.getElementById('cu-prenom')?.value||'').trim();
  const nom=(document.getElementById('cu-nom')?.value||'').trim();
  const name=(prenom+' '+nom).trim() || document.getElementById('cu-name')?.value.trim();
  if(document.getElementById('cu-name')) document.getElementById('cu-name').value=name;
  const email=document.getElementById('cu-email')?.value.trim();
  const pass=document.getElementById('cu-pass')?.value.trim();
  const phone=document.getElementById('cu-phone')?.value.trim()||'';
  const role=document.getElementById('cu-role')?.value||'cuisinier';
  const siteId=document.getElementById('cu-site')?.value||null;
  const sectorId=document.getElementById('cu-sector')?.value||null;
  const terrId=document.getElementById('cu-terr')?.value||null;

  if(!name||!email||!pass){showToast('Remplissez nom, email et mot de passe','error');return;}
  if(pass.length<8){showToast('Mot de passe trop court (min. 8 caractères)','error');return;}

  const btn=document.getElementById('cu-submit');
  if(btn){btn.textContent='⏳ Création…';btn.disabled=true;}

  try{
    const uid=await createUser(email,pass,name,role,siteId,sectorId,terrId,phone);
    if(!uid){if(btn){btn.textContent='✅ Créer le compte';btn.disabled=false;}return;}

    // Résoudre les noms pour le récap
    const siteName=siteId?(_sites.find(s=>s.id===siteId)?.name||''):'';
    const siteCode=siteId?(_sites.find(s=>s.id===siteId)?.code||''):'';
    const sectName=sectorId?(_sectors.find(s=>s.id===sectorId)?.name||''):'';
    const terrName=terrId?(_territories.find(t=>t.id===terrId)?.name||''):'';
    const roleLabels={siege:'Siège',directeur:'Directeur',chef_secteur:'Chef de secteur',cuisinier:'Cuisinier'};
    const scope=siteName?siteName+(siteCode?' ('+siteCode+')':''):sectName||terrName||'—';

    // Afficher le récap
    const recap=document.getElementById('cu-recap');
    const recapTxt=document.getElementById('cu-recap-txt');
    const btns=document.getElementById('cu-btns');
    if(recap) recap.style.display='block';
    if(btns) btns.style.display='none';
    if(recapTxt) recapTxt.innerHTML=`
      <div>👤 <strong>Nom :</strong> ${escH(name)}</div>
      <div>📧 <strong>Email :</strong> ${escH(email)}</div>
      <div>🔑 <strong>Mot de passe :</strong> ${escH(pass)}</div>
      <div>🎭 <strong>Rôle :</strong> ${roleLabels[role]||role}</div>
      <div>🏠 <strong>Périmètre :</strong> ${escH(scope)}</div>
    `;
    window._lastCreatedUser={name,email,pass,role:roleLabels[role]||role,scope};

    // Recharger les profils
    showToast(`✅ Compte créé pour ${name}`,'success');
    await loadData();
  }catch(e){
    let _em=e.message||'';
    if(_em.includes('email_exists')||_em.includes('already registered')||_em.includes('422')){
      _em='Cet email est déjà enregistré. Le compte existant a été mis à jour si possible.';
    } else if(_em.includes('service_role')||_em.includes('401')){
      _em='Clé service_role manquante ou invalide.';
    } else if(_em.includes('password')||_em.includes('weak')){
      _em='Mot de passe trop faible (min. 6 caractères).';
    }
    showToast('❌ '+_em,'error');
    if(btn){btn.textContent='✅ Créer le compte';btn.disabled=false;}
  }
}

function cuCopyInfo(){
  const u=window._lastCreatedUser;
  if(!u)return;
  const txt=`Identifiants PMS HACCP\nNom : ${u.name}\nEmail : ${u.email}\nMot de passe : ${u.pass}\nRôle : ${u.role}\nPérimètre : ${u.scope}`;
  navigator.clipboard.writeText(txt).then(()=>showToast('✅ Identifiants copiés','success')).catch(()=>showToast('Copiez manuellement','info'));
}

// ── Fiche utilisateur — voir ses saisies ─────────────
function openUserDetail(profileId){
  _adminModal={type:'user-detail',id:profileId};
  const ov=document.getElementById('admin-modal-ov');
  const box=document.getElementById('admin-modal-content');
  if(!ov||!box)return;

  // Chercher le profil
  supaGet('profiles',`select=*&id=eq.${profileId}&limit=1`).then(rows=>{
    const p=rows[0];
    if(!p){showToast('Profil introuvable','error');return;}

    const roleCls={siege:'role-siege',directeur:'role-directeur',chef_secteur:'role-chef',cuisinier:'role-cuisinier'};
    const roleLabel={siege:'Siège',directeur:'Directeur',chef_secteur:'Chef de secteur',cuisinier:'Cuisinier'};
    const roleIco={siege:'🏛️',directeur:'📊',chef_secteur:'👔',cuisinier:'👨‍🍳'};

    const site=_sites.find(s=>s.id===p.site_id);
    const sect=_sectors.find(s=>s.id===p.sector_id);
    const terr=_territories.find(t=>t.id===p.territory_id);
    const initials=(p.full_name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();

    // Saisies de cet utilisateur (par site si cuisinier)
    let userRecs=[];
    if(site) userRecs=_records.filter(r=>r.site_id===site.code);
    else if(sect) userRecs=_records.filter(r=>_sites.filter(s=>s.sector_id===sect.id).some(s=>r.site_id===s.code));

    const nb=userRecs.length;
    const nc=userRecs.filter(r=>isNC(r)).length;
    const pct=pmsWeightedScore(userRecs);
    const pctCol=pct===null?'var(--muted)':pct>=90?'#16a34a':pct>=75?'#d97706':'#dc2626';

    // Par catégorie
    const cats=CAT_GROUPS.map(cat=>{
      const cr=userRecs.filter(r=>cat.enrs.includes(r.enr_type));
      const cp=cr.length>0?Math.round((1-cr.filter(r=>isNC(r)).length/cr.length)*100):null;
      return{...cat,n:cr.length,pct:cp};
    }).filter(c=>c.n>0);

    // 5 dernières saisies
    const recent=userRecs.slice(0,5);

    box.innerHTML=`<div style="padding:0">
      <!-- Header -->
      <div style="background:linear-gradient(135deg,var(--navy),var(--navy2));padding:22px 20px;display:flex;align-items:center;gap:14px">
        <div style="width:52px;height:52px;border-radius:50%;background:rgba(255,255,255,.2);color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.2rem;font-weight:900;flex-shrink:0">${initials}</div>
        <div style="flex:1">
          <div style="font-size:1.05rem;font-weight:900;color:#fff">${escH(p.full_name||'Sans nom')}</div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:4px;flex-wrap:wrap">
            <span class="badge-role ${roleCls[p.role]||''}" style="font-size:.65rem">${roleLabel[p.role]||p.role}</span>
            ${site?`<span style="font-size:.72rem;color:rgba(255,255,255,.7)">🏠 ${escH(site.name)} (${site.code})</span>`:''}
            ${sect&&!site?`<span style="font-size:.72rem;color:rgba(255,255,255,.7)">🏢 ${escH(sect.name)}</span>`:''}
            ${terr&&!sect&&!site?`<span style="font-size:.72rem;color:rgba(255,255,255,.7)">🗺️ ${escH(terr.name)}</span>`:''}
            ${p.email?`<span style="font-size:.7rem;color:rgba(255,255,255,.6)">📧 ${escH(p.email)}</span>`:''}
            ${p.phone?`<span style="font-size:.7rem;color:rgba(255,255,255,.6)">📞 ${escH(p.phone)}</span>`:''}
          </div>
        </div>
        <button onclick="closeAdminModal()" style="background:rgba(255,255,255,.2);border:none;color:#fff;border-radius:50%;width:32px;height:32px;font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center">✕</button>
      </div>

      <div style="padding:18px 20px">
        <!-- Stats globales -->
        ${nb>0?`<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px">
          <div style="text-align:center;background:#faf6fa;border-radius:10px;padding:12px">
            <div style="font-size:1.5rem;font-weight:900;color:var(--navy)">${nb}</div>
            <div style="font-size:.65rem;color:var(--muted);font-weight:700;text-transform:uppercase">Saisies</div>
          </div>
          <div style="text-align:center;background:#fff5f5;border-radius:10px;padding:12px">
            <div style="font-size:1.5rem;font-weight:900;color:#dc2626">${nc}</div>
            <div style="font-size:.65rem;color:var(--muted);font-weight:700;text-transform:uppercase">NC</div>
          </div>
          <div style="text-align:center;background:${pct>=90?'#f0fdf4':pct>=75?'#fffbeb':'#fff5f5'};border-radius:10px;padding:12px">
            <div style="font-size:1.5rem;font-weight:900;color:${pctCol}">${pct}%</div>
            <div style="font-size:.65rem;color:var(--muted);font-weight:700;text-transform:uppercase">Conformité</div>
          </div>
        </div>`:`<div style="text-align:center;padding:20px;color:var(--muted);font-size:.82rem;background:#faf6fa;border-radius:10px;margin-bottom:18px">Aucune saisie enregistrée pour cet utilisateur</div>`}

        <!-- Scores par catégorie -->
        ${cats.length>0?`<div style="font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-bottom:8px">Scores par domaine</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px;margin-bottom:18px">
          ${cats.map(cat=>{
            const c=cat.pct>=90?'#16a34a':cat.pct>=75?'#d97706':'#dc2626';
            return`<div style="background:#faf6fa;border-radius:8px;padding:10px;text-align:center">
              <div style="font-size:1rem;margin-bottom:2px">${cat.ico}</div>
              <div style="font-size:.65rem;color:var(--muted);font-weight:600">${cat.label.replace(/^../,'')}</div>
              <div style="font-size:1rem;font-weight:900;color:${c};margin-top:2px">${cat.pct}%</div>
              <div style="font-size:.6rem;color:var(--muted)">${cat.n} saisies</div>
            </div>`;
          }).join('')}
        </div>`:''}

        <!-- Dernières saisies -->
        ${recent.length>0?`<div style="font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-bottom:8px">Dernières saisies</div>
        <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:18px">
          ${recent.map(r=>{
            const d=r.data||{};
            const dt=r.recorded_at?new Date(r.recorded_at):null;
            const dateStr=dt?dt.toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
            const produit=d.produit||d.fournisseur||d.ref_id||d.enc_id||'—';
            const nc=isNC(r);
            return`<div onclick="closeAdminModal();openDetail('${r.id}')" style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:#faf6fa;border-radius:8px;cursor:pointer">
              <div style="flex:1;min-width:0">
                <div style="font-size:.78rem;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escH(produit)}</div>
                <div style="font-size:.65rem;color:var(--muted)">${ENR_LABELS[r.enr_type]||r.enr_type?.toUpperCase()} · ${dateStr}</div>
              </div>
              <span class="tag ${nc?'tag-err':'tag-ok'}" style="font-size:.65rem">${nc?'NC':'OK'}</span>
            </div>`;
          }).join('')}
          ${nb>5?`<button onclick="closeAdminModal();navTo('saisies')" style="width:100%;padding:8px;background:none;border:1px solid var(--border);border-radius:8px;font-size:.75rem;color:var(--muted);cursor:pointer;font-family:var(--font)">Voir toutes les saisies →</button>`:''}
        </div>`:''}

        <!-- Actions -->
        <div style="display:flex;gap:8px">
          <button onclick="closeAdminModal();openAdminModal('user','${p.id}')" style="flex:1;padding:11px;background:#e2e8f0;color:var(--navy);border:none;border-radius:12px;font-weight:700;cursor:pointer;font-family:var(--font)">✏️ Modifier le profil</button>
          <button onclick="openResetPassword('${p.id}','${p.full_name||p.email}')" style="flex:1;padding:11px;background:#fef3c7;color:#92400e;border:none;border-radius:12px;font-weight:700;cursor:pointer;font-family:var(--font)">🔑 Mot de passe</button>
          <button onclick="closeAdminModal()" style="padding:11px 16px;background:#f1f5f9;color:var(--muted);border:none;border-radius:12px;font-weight:700;cursor:pointer;font-family:var(--font)">Fermer</button>
        </div>
      </div>
    </div>`;
    ov.style.display='flex';
  }).catch(e=>showToast('Erreur : '+e.message,'error'));
}


function openResetPassword(userId, userName) {
  const overlay = document.createElement('div');
  overlay.id = 'reset-pass-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(20,5,25,.78);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';

  // Générer un nouveau MDP
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789ABCDEFGHJKMNPQRSTUVWXYZ!@#';
  const newPass = Array.from({length:10}, () => chars[Math.floor(Math.random()*chars.length)]).join('');

  overlay.innerHTML = `<div style="background:#fff;border-radius:18px;padding:24px;max-width:380px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3)">
    <div style="font-size:1rem;font-weight:900;color:var(--navy);margin-bottom:6px">🔑 Réinitialiser le mot de passe</div>
    <div style="font-size:.78rem;color:var(--muted);margin-bottom:18px">${escH(userName)}</div>

    <label style="font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);display:block;margin-bottom:6px">Nouveau mot de passe</label>
    <div style="display:flex;gap:6px;margin-bottom:8px">
      <input id="rp-input" type="text" value="${newPass}"
        style="flex:1;padding:10px 12px;border:1.5px solid var(--border);border-radius:12px;font-size:.9rem;font-family:monospace;font-weight:700;color:var(--navy);outline:none">
      <button onclick="document.getElementById('rp-input').value=Array.from({length:10},()=>'abcdefghjkmnpqrstuvwxyz23456789ABCDEFGHJKMNPQRSTUVWXYZ!@#'[Math.floor(Math.random()*57)]).join('')"
        style="padding:10px 12px;background:#f1f5f9;border:1px solid var(--border);border-radius:12px;cursor:pointer;font-size:.85rem" title="Générer">🔄</button>
    </div>
    <div style="font-size:.7rem;color:var(--muted);margin-bottom:18px">Modifiez le mot de passe ou utilisez celui généré automatiquement.</div>

    <div style="display:flex;gap:10px">
      <button id="rp-cancel" style="flex:1;padding:12px;background:#f1f5f9;color:var(--muted);border:none;border-radius:10px;font-weight:700;cursor:pointer;font-family:var(--font)">Annuler</button>
      <button id="rp-confirm" style="flex:1;padding:12px;background:var(--navy);color:#fff;border:none;border-radius:10px;font-weight:800;cursor:pointer;font-family:var(--font)">Appliquer</button>
    </div>

    <div id="rp-success" style="display:none;margin-top:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px">
      <div style="font-size:.8rem;font-weight:800;color:#166534;margin-bottom:8px">✅ Mot de passe mis à jour</div>
      <div id="rp-recap" style="font-size:.82rem;font-family:monospace;background:#fff;border:1px solid #d1fae5;border-radius:7px;padding:9px;color:var(--navy)"></div>
      <button id="rp-copy" style="width:100%;margin-top:8px;padding:9px;background:#dcfce7;color:#166534;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-family:var(--font)">📋 Copier les identifiants</button>
    </div>
  </div>`;

  document.body.appendChild(overlay);

  overlay.querySelector('#rp-cancel').onclick = () => overlay.remove();

  overlay.querySelector('#rp-confirm').onclick = async () => {
    const pass = overlay.querySelector('#rp-input').value.trim();
    if (pass.length < 8) { showToast('Minimum 8 caractères', 'error'); return; }

    if (!_token) { showToast('Session expirée, reconnectez-vous', 'error'); return; }

    const btn = overlay.querySelector('#rp-confirm');
    btn.textContent = '⏳…'; btn.disabled = true;

    try {
      await supaAdmin('PUT', '/auth/v1/admin/users/' + userId, { password: pass });
      // Afficher le récap
      overlay.querySelector('#rp-success').style.display = 'block';
      overlay.querySelector('#rp-recap').textContent = escH(userName) + '  |  ' + pass;
      overlay.querySelector('#rp-cancel').textContent = 'Fermer';
      overlay.querySelector('#rp-confirm').style.display = 'none';
      // Copier
      overlay.querySelector('#rp-copy').onclick = () => {
        const txt = userName + ' | Mot de passe : ' + pass;
        navigator.clipboard.writeText(txt).then(
          () => showToast('Copié !', 'success'),
          () => showToast('Copiez manuellement : ' + pass, 'info')
        );
      };
      showToast('✅ Mot de passe réinitialisé', 'success');
    } catch(e) {
      showToast('Erreur : ' + e.message, 'error');
      btn.textContent = 'Appliquer'; btn.disabled = false;
    }
  };
}


function generateComparePDF() {
  const f = getFilters();
  const moisFilter = f.mois || new Date().toISOString().slice(0,7);
  const siteFilter = f.site || '';
  const secteurFilter = f.secteur || '';

  const sitesFiltered = _sites.filter(s => {
    if (siteFilter && s.code !== siteFilter) return false;
    if (secteurFilter && s.sector_id !== secteurFilter) return false;
    return true;
  });

  const genDate = new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'});
  const genTime = new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
  const periodeLabel = moisFilter ? new Date(moisFilter+'-01').toLocaleDateString('fr-FR',{month:'long',year:'numeric'}) : 'Toutes périodes';
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // ── Construire les données par site ──────────────────────
  const sitesData = sitesFiltered.map(site => {
    const siteRecs = _records.filter(r =>
      r.site_id === site.code && r.recorded_at?.startsWith(moisFilter)
    );
    const siteGMO = _gmos.find(g =>
      g.site_id === site.id && g.visit_date?.startsWith(moisFilter)
    );
    const nb  = siteRecs.length;
    const nc  = siteRecs.filter(r => isNC(r)).length;
    const pct = pmsWeightedScore(siteRecs);

    let gmoAvg = null, gmoAxes = {}, gmoBilan = [], gmoObs = '', gmoDate = '', gmoSig = null;
    if (siteGMO) {
      const sc = siteGMO.scores || {};
      gmoAvg = sc._global ?? null;
      if (gmoAvg === null && sc._detail) gmoAvg = gmoGlobalScore(sc._detail);
      gmoAxes  = sc;
      gmoBilan = sc._bilan || [];
      gmoObs   = siteGMO.observations || '';
      gmoDate  = siteGMO.visit_date   || '';
      gmoSig   = sc._signature || null;
    }

    // Score PMS par catégorie
    const catScores = CAT_GROUPS.map(cat => {
      const catRecs = siteRecs.filter(r => cat.enrs.includes(r.enr_type));
      if (!catRecs.length) return {key: cat.key, label: cat.label, ico: cat.ico, pct: null, nb: 0};
      const ncCat = catRecs.filter(r => isNC(r)).length;
      return {key: cat.key, label: cat.label, ico: cat.ico, pct: Math.round((1-ncCat/catRecs.length)*100), nb: catRecs.length};
    });

    const sect = _sectors.find(s => s.id === site.sector_id);
    const terr = sect ? _territories.find(t => t.id === sect.territory_id) : null;

    return { site, sect, terr, nb, nc, pct, gmoAvg, gmoAxes, gmoBilan, gmoObs, gmoDate, gmoSig, catScores, hasGMO: !!siteGMO };
  }).filter(x => x.nb > 0 || x.hasGMO);

  if (!sitesData.length) {
    showToast('Aucune donnée pour cette période', 'warning');
    return;
  }

  // ── Helpers visuels ───────────────────────────────────────
  const col = v => v == null ? '#94a3b8' : v >= 85 ? '#16a34a' : v >= 70 ? '#d97706' : '#dc2626';
  const bg  = v => v == null ? '#f8fafc'  : v >= 85 ? '#f0fdf4' : v >= 70 ? '#fffbeb' : '#fff5f5';
  const brd = v => v == null ? '#e2e8f0'  : v >= 85 ? '#bbf7d0' : v >= 70 ? '#fde68a' : '#fecaca';
  const bar = (v, w='100px') => v == null ? '<span style="color:#94a3b8">—</span>' :
    `<div style="display:inline-flex;align-items:center;gap:6px">
      <div style="width:${w};height:7px;background:#e5e7eb;border-radius:4px;flex-shrink:0">
        <div style="width:${v}%;height:100%;background:${col(v)};border-radius:4px"></div>
      </div>
      <strong style="color:${col(v)};min-width:34px">${v}%</strong>
    </div>`;
  const ecartBadge = (pms, gmo) => {
    if (pms == null || gmo == null) return '<span style="color:#94a3b8">—</span>';
    const d = gmo - pms;
    const s = d > 0 ? '+' : '';
    const c = Math.abs(d) <= 15 ? '#16a34a' : d < -15 ? '#dc2626' : '#d97706';
    const bg2 = Math.abs(d) <= 15 ? '#dcfce7' : d < -15 ? '#fee2e2' : '#fef3c7';
    return `<span style="font-size:11px;font-weight:800;padding:2px 8px;border-radius:7px;background:${bg2};color:${c}">${s}${d} pts</span>`;
  };

  // ── SECTION : tableau comparatif global ──────────────────
  const tableRows = sitesData.map(d => `
    <tr>
      <td>
        <div style="font-weight:800;color:#0F2240">${esc(d.site.name)}</div>
        <div style="font-size:10px;font-family:monospace;color:#64748b;margin-top:1px">${esc(d.site.code)}</div>
        ${d.sect ? `<div style="font-size:10px;color:#94a3b8">${esc(d.sect.name)}</div>` : ''}
      </td>
      <td style="text-align:center">${d.nb > 0 ? `<span style="font-weight:700">${d.nb}</span><br><small style="color:#94a3b8">${d.nc} NC</small>` : '<span style="color:#94a3b8">—</span>'}</td>
      <td>${bar(d.pct)}</td>
      <td>${d.hasGMO && d.gmoDate ? `<small style="color:#64748b">${new Date(d.gmoDate+'T12:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'short'})}</small>` : '<span style="color:#e2e8f0">—</span>'}</td>
      <td>${bar(d.gmoAvg)}</td>
      <td style="text-align:center">${ecartBadge(d.pct, d.gmoAvg)}</td>
      <td style="text-align:center">${d.pct != null && d.gmoAvg != null
        ? `<div style="font-size:18px">${Math.abs(d.gmoAvg-d.pct)<=15 ? '✅' : d.pct>d.gmoAvg+15 ? '⚠️' : '❓'}</div>`
        : '—'}</td>
    </tr>`).join('');

  // ── SECTION : fiche détaillée par site ───────────────────
  const siteFiches = sitesData.map(d => {
    // Axes PMS
    const catRows = d.catScores.map(c => {
      const gmoKey = {ccp:'ccp', cuisson:'cuisson', recep:'recep', nett:'nett', trac:'trac', temp:'temp'}[c.key];
      const gmoVal = d.gmoAxes && gmoKey ? (() => {
        // Mapper cat PMS → clé axe GMO
        const keyMap = {ccp:'chaine_froid', cuisson:'cuisson', recep:'reception', nett:'nettoyage', trac:'tracabilite', temp:'chaine_froid'};
        const gmoAxeKey = Object.keys(d.gmoAxes).find(k => !k.startsWith('_') && GMO_AXES.find(a=>a.key===k && (a.key.includes(gmoKey)||gmoKey.includes(a.key.slice(0,5)))));
        return null; // sera rempli par axes GMO directs
      })() : null;
      const pmsStyle = `background:${bg(c.pct)};border:1px solid ${brd(c.pct)};border-radius:7px;padding:4px 8px;display:inline-block`;
      return `<tr>
        <td style="font-size:11px">${c.ico} ${esc(c.label.replace(/^[^\s]+ /,''))}</td>
        <td>${c.nb > 0 ? `<span style="${pmsStyle}"><strong style="color:${col(c.pct)}">${c.pct}%</strong> <span style="font-size:9px;color:#64748b">${c.nb} saisies</span></span>` : '<span style="color:#94a3b8;font-size:10px">Aucune saisie</span>'}</td>
        <td style="font-size:10px;color:#64748b;font-style:italic">${c.pct != null && c.pct < 100 ? `${d.nc} NC détectée${d.nc>1?'s':''}` : c.nb > 0 ? '✅ Tout conforme' : ''}</td>
      </tr>`;
    }).join('');

    // Axes GMO
    const gmoAxeRows = GMO_AXES.map(axe => {
      const v = d.gmoAxes[axe.key];
      if (v == null || typeof v !== 'number') return '';
      return `<tr>
        <td style="font-size:11px">${axe.icon} ${esc(axe.label)}</td>
        <td><span style="background:${bg(v)};border:1px solid ${brd(v)};border-radius:7px;padding:4px 8px;display:inline-block"><strong style="color:${col(v)}">${Math.round(v)}%</strong></span></td>
        <td style="font-size:10px;color:#64748b"></td>
      </tr>`;
    }).filter(Boolean).join('');

    // NCs GMO
    const ncMaj = d.gmoBilan.filter(n => n.niveau === 'NC majeure');
    const ncMin = d.gmoBilan.filter(n => n.niveau === 'NC mineure');
    const ncCorrigees = d.gmoBilan.filter(n => n.verifie);
    const ncRows = d.gmoBilan.map(n => `
      <div style="margin-bottom:8px;padding:8px 10px;border-radius:7px;${n.niveau==='NC majeure'?'background:#fff5f5;border-left:3px solid #e53e3e':'background:#fffbeb;border-left:3px solid #d69e2e'}">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">
          <span style="font-size:10px;font-weight:800;padding:1px 6px;border-radius:5px;${n.niveau==='NC majeure'?'background:#fee2e2;color:#991b1b':'background:#fef3c7;color:#92400e'}">${n.niveau}</span>
          ${n.verifie ? '<span style="font-size:10px;font-weight:700;color:#16a34a">✅ Corrigé</span>' : '<span style="font-size:10px;color:#94a3b8">En attente</span>'}
        </div>
        <div style="font-size:11px;font-weight:700;color:#1e3a5f;margin-bottom:2px">${esc(n.axe)} › ${esc(n.critere)}</div>
        ${n.constat ? `<div style="font-size:10px;color:#6b7280;font-style:italic">📝 ${esc(n.constat)}</div>` : ''}
        ${n.action  ? `<div style="font-size:10px;color:#1d4ed8;font-weight:600">→ ${esc(n.action)}</div>` : ''}
      </div>`).join('');

    // Tableau aligné PMS ↔ GMO
    const ALIGNED_ROWS = [
      {pmsKey:'ccp',     pmsLabel:'❄️ CCP / Refroidissement',    gmoKey:'ccp',        gmoLabel:'❄️ Chaîne du froid / CCP'},
      {pmsKey:'cuisson', pmsLabel:'🔥 Cuisson',                   gmoKey:'cuisson',    gmoLabel:'🔥 Cuisson & Refroidissement'},
      {pmsKey:'recep',   pmsLabel:'📦 Réception',                 gmoKey:'reception',  gmoLabel:'📦 Réception & Stockage'},
      {pmsKey:'nett',    pmsLabel:'🧹 Nettoyage',                 gmoKey:'nettoyage',  gmoLabel:'🧹 Nettoyage & Désinfection'},
      {pmsKey:'trac',    pmsLabel:'📋 Traçabilité',               gmoKey:'tracabilite',gmoLabel:'📋 Traçabilité & Documentation'},
      {pmsKey:'temp',    pmsLabel:'🌡️ Températures enceintes',   gmoKey:null,         gmoLabel:null},
      {pmsKey:null,      pmsLabel:null,                           gmoKey:'locaux',     gmoLabel:'🏗️ Locaux & Équipements'},
      {pmsKey:null,      pmsLabel:null,                           gmoKey:'personnel',  gmoLabel:'👨‍🍳 Hygiène du personnel'},
    ];
    const catMap = {};
    d.catScores.forEach(c => { catMap[c.key] = c; });

    const alignedRows = ALIGNED_ROWS.map(row => {
      const pmsCat = row.pmsKey ? catMap[row.pmsKey] : null;
      const gmoVal = row.gmoKey && d.gmoAxes[row.gmoKey] != null && typeof d.gmoAxes[row.gmoKey] === 'number' ? Math.round(d.gmoAxes[row.gmoKey]) : null;

      const pmsCell = pmsCat && pmsCat.nb > 0
        ? `<div style="display:flex;align-items:center;gap:6px">
            <div style="width:70px;height:7px;background:#e5e7eb;border-radius:4px;flex-shrink:0">
              <div style="width:${pmsCat.pct}%;height:100%;background:${col(pmsCat.pct)};border-radius:4px"></div>
            </div>
            <strong style="color:${col(pmsCat.pct)};min-width:30px">${pmsCat.pct}%</strong>
            <span style="font-size:9px;color:#94a3b8">${pmsCat.nb} saisies</span>
          </div>`
        : (row.pmsKey ? '<span style="color:#cbd5e0;font-size:10px">Aucune saisie</span>' : '<span style="color:#e5e7eb">—</span>');

      const gmoCell = gmoVal != null
        ? `<div style="display:flex;align-items:center;gap:6px">
            <div style="width:70px;height:7px;background:#e5e7eb;border-radius:4px;flex-shrink:0">
              <div style="width:${gmoVal}%;height:100%;background:${col(gmoVal)};border-radius:4px"></div>
            </div>
            <strong style="color:${col(gmoVal)};min-width:30px">${gmoVal}%</strong>
          </div>`
        : (row.gmoKey ? '<span style="color:#cbd5e0;font-size:10px">Non évalué</span>' : '<span style="color:#e5e7eb">—</span>');

      // Écart si les deux existent
      const pmsV = pmsCat?.pct;
      const ecart = pmsV != null && gmoVal != null
        ? (() => {
            const d2 = gmoVal - pmsV;
            const sign = d2 > 0 ? '+' : '';
            const c2 = Math.abs(d2) <= 15 ? '#16a34a' : d2 < -15 ? '#dc2626' : '#d97706';
            const bg2 = Math.abs(d2) <= 15 ? '#dcfce7' : d2 < -15 ? '#fee2e2' : '#fef3c7';
            return `<span style="font-size:10px;font-weight:800;padding:2px 6px;border-radius:6px;background:${bg2};color:${c2}">${sign}${d2}</span>`;
          })()
        : '';

      // Label de la ligne
      const label = row.pmsLabel || row.gmoLabel;
      const isMatchedRow = row.pmsKey && row.gmoKey;
      const rowBg = isMatchedRow ? '' : 'background:#fafbfc';

      // Afficher le coeff GMO si disponible
      const gmoAxeObj = row.gmoKey ? GMO_AXES.find(a => a.key === row.gmoKey) : null;
      const coeffBadge = gmoAxeObj
        ? `<span style="font-size:9px;font-weight:700;padding:1px 5px;background:#ebf8ff;color:#2b6cb0;border-radius:4px;margin-left:5px">×${gmoAxeObj.coeff}%</span>`
        : '';
      return `<tr style="${rowBg}">
        <td style="font-size:11px;font-weight:600;color:#374151;padding:7px 8px">${label}${coeffBadge}</td>
        <td style="padding:7px 8px">${pmsCell}</td>
        <td style="padding:7px 8px">${gmoCell}</td>
        <td style="padding:7px 8px;text-align:center">${ecart}</td>
      </tr>`;
    }).join('');

    const alignedTable = `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:10px;color:#166534;line-height:1.5">
      ✅ <strong>Méthode de calcul unifiée :</strong> Les deux scores utilisent la même pondération par domaine (CCP×20%, Cuisson×20%, Réception×15%, Personnel×15%, Nettoyage×10%, Locaux×10%, Traçabilité×10%).
      Pour le score PMS, les domaines sans équivalent PMS (Locaux & Personnel) sont ignorés, le résultat est normalisé sur 100.
      Un écart de 0 signifie une cohérence parfaite entre auto-évaluation terrain et visite GMO.
    </div>
    <table style="width:100%">
      <thead><tr>
        <th style="width:28%">Domaine <span style="font-size:8px;opacity:.7">(coeff GMO)</span></th>
        <th style="width:30%">Score PMS <span style="font-size:8px;opacity:.7">taux brut</span></th>
        <th style="width:30%">Score GMO <span style="font-size:8px;opacity:.7">pondéré</span></th>
        <th style="width:12%;text-align:center">Écart</th>
      </tr></thead>
      <tbody>${alignedRows}</tbody>
    </table>`;

    return `
    <div class="site-fiche">
      <!-- En-tête site -->
      <div class="site-header" style="background:linear-gradient(135deg,#0F2240,#1a3a6a)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
          <div>
            <div style="font-size:10px;opacity:.55;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Fiche comparative</div>
            <div style="font-size:1.3rem;font-weight:900;color:#fff">${esc(d.site.name)}</div>
            <div style="display:flex;gap:8px;margin-top:4px;flex-wrap:wrap">
              <span style="font-family:monospace;font-size:10px;background:rgba(255,255,255,.15);padding:1px 7px;border-radius:5px;color:#fff">${esc(d.site.code)}</span>
              ${d.sect ? `<span style="font-size:10px;color:rgba(255,255,255,.6)">📍 ${esc(d.sect.name)}</span>` : ''}
              ${d.terr ? `<span style="font-size:10px;color:rgba(255,255,255,.6)">🗺️ ${esc(d.terr.name)}</span>` : ''}
            </div>
          </div>
          <div style="display:flex;gap:16px;align-items:center">
            <div style="text-align:center">
              <div style="font-size:2rem;font-weight:900;color:${d.pct>=85?'#86efac':d.pct>=70?'#fcd34d':'#fca5a5'};line-height:1">${d.pct!=null?d.pct+'%':'—'}</div>
              <div style="font-size:10px;color:rgba(255,255,255,.6);margin-top:2px">Score PMS</div>
              <div style="font-size:9px;color:rgba(255,255,255,.5)">${d.nb} saisies · ${d.nc} NC</div>
            </div>
            <div style="width:1px;height:40px;background:rgba(255,255,255,.2)"></div>
            <div style="text-align:center">
              <div style="font-size:2rem;font-weight:900;color:${d.gmoAvg>=85?'#86efac':d.gmoAvg>=70?'#fcd34d':'#fca5a5'};line-height:1">${d.gmoAvg!=null?d.gmoAvg+'%':'—'}</div>
              <div style="font-size:10px;color:rgba(255,255,255,.6);margin-top:2px">Score GMO</div>
              <div style="font-size:9px;color:rgba(255,255,255,.5)">${d.gmoDate ? new Date(d.gmoDate+'T12:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'2-digit'}) : 'Pas de visite'}</div>
            </div>
            ${d.pct!=null && d.gmoAvg!=null ? `
            <div style="width:1px;height:40px;background:rgba(255,255,255,.2)"></div>
            <div style="text-align:center">
              <div style="font-size:1.4rem;font-weight:900;color:${Math.abs(d.gmoAvg-d.pct)<=15?'#86efac':d.pct>d.gmoAvg+15?'#fca5a5':'#fcd34d'};line-height:1">${d.gmoAvg-d.pct>0?'+':''}${d.gmoAvg-d.pct} pts</div>
              <div style="font-size:10px;color:rgba(255,255,255,.6);margin-top:2px">Écart</div>
              <div style="font-size:9px;color:rgba(255,255,255,.5)">${Math.abs(d.gmoAvg-d.pct)<=15?'Cohérent':d.pct>d.gmoAvg+15?'PMS surestimé ?':'GMO > PMS'}</div>
            </div>` : ''}
          </div>
        </div>
      </div>

      <!-- Corps : tableau aligné PMS vs GMO -->
      <div style="padding:16px">
        <div class="subsection-title">📋 Scores par domaine — PMS vs GMO</div>
        ${alignedTable}
      </div>

      <!-- NC GMO -->
      ${d.gmoBilan.length > 0 ? `
      <div style="padding:0 16px 16px">
        <div class="subsection-title">🚨 Non-conformités GMO (${ncMaj.length} maj. · ${ncMin.length} min. · ${ncCorrigees.length} corrigée${ncCorrigees.length>1?'s':''})</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px">${ncRows}</div>
      </div>` : `
      <div style="padding:0 16px 16px">
        <div style="padding:10px;background:#f0fdf4;border-radius:8px;font-size:11px;color:#16a34a;font-weight:700;text-align:center">✅ Aucune non-conformité GMO sur cette période</div>
      </div>`}

      <!-- Observations + signature -->
      ${d.gmoObs || d.gmoSig ? `
      <div style="padding:0 16px 16px;display:grid;grid-template-columns:1fr ${d.gmoSig?'180px':''};gap:12px">
        ${d.gmoObs ? `<div>
          <div class="subsection-title">💬 Observations du chef de secteur</div>
          <div style="background:#faf6fa;border-radius:8px;padding:10px;font-size:11px;font-style:italic;color:#374151">"${esc(d.gmoObs)}"</div>
        </div>` : ''}
        ${d.gmoSig ? `<div>
          <div class="subsection-title">✍️ Signature</div>
          <div style="border:1.5px dashed #e2e8f0;border-radius:8px;padding:8px;background:#fafafa;text-align:center">
            <img src="${d.gmoSig}" style="max-height:55px;max-width:100%">
          </div>
        </div>` : ''}
      </div>` : ''}
    </div>`;
  }).join('');

  // ── Légende cohérence ────────────────────────────────────
  const legendeHTML = `
  <div class="section" style="margin-bottom:20px">
    <div class="section-header">
      <div>
        <div class="section-title">ℹ️ Lecture du rapport comparatif</div>
        <div class="section-desc">Les deux scores utilisent désormais la même pondération GMO — les écarts reflètent directement la différence entre auto-évaluation quotidienne et visite terrain, domaine par domaine.</div>
      </div>
    </div>
    <div style="padding:14px;display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:12px">
        <div style="font-size:11px;font-weight:800;color:#166534;margin-bottom:4px">✅ Cohérent (écart ≤15 pts)</div>
        <div style="font-size:10px;color:#374151;line-height:1.5">Les saisies PMS reflètent fidèlement la réalité constatée lors de la visite. Bonne maîtrise.</div>
      </div>
      <div style="background:#fff5f5;border:1px solid #fecaca;border-radius:12px;padding:12px">
        <div style="font-size:11px;font-weight:800;color:#991b1b;margin-bottom:4px">⚠️ PMS surestimé (PMS >> GMO)</div>
        <div style="font-size:10px;color:#374151;line-height:1.5">Les enregistrements PMS sont meilleurs que ce que révèle la visite terrain. Risque de saisies non conformes à la réalité.</div>
      </div>
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:12px">
        <div style="font-size:11px;font-weight:800;color:#92400e;margin-bottom:4px">❓ GMO élevé (GMO >> PMS)</div>
        <div style="font-size:10px;color:#374151;line-height:1.5">Le terrain est meilleur que ce que montrent les enregistrements PMS. Peut indiquer des difficultés de saisie ou critères trop sévères.</div>
      </div>
    </div>
  </div>`;

  // ── Assemblage HTML final ────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Rapport Comparatif PMS vs GMO — ${periodeLabel}</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Segoe UI',Arial,sans-serif; color:#1a202c; font-size:12px; background:#faf6fa; }
  .page { max-width:960px; margin:0 auto; padding:24px; }
  .header { background:linear-gradient(135deg,#0F2240,#1a3a6a); color:#fff; padding:22px 28px; border-radius:14px; margin-bottom:20px; }
  .header-body { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; flex-wrap:wrap; }
  .section { background:#fff; border-radius:14px; border:1px solid #e2e8f0; margin-bottom:16px; overflow:hidden; }
  .section-header { display:flex; justify-content:space-between; align-items:flex-start; padding:14px 16px; background:#faf6fa; border-bottom:1px solid #e2e8f0; gap:12px; }
  .section-title { font-size:13px; font-weight:800; color:#0F2240; margin-bottom:3px; }
  .section-desc { font-size:10px; color:#64748b; line-height:1.4; }
  .site-fiche { background:#fff; border-radius:14px; border:1px solid #e2e8f0; margin-bottom:20px; overflow:hidden; break-inside:avoid; }
  .site-header { padding:18px 20px; }
  .subsection-title { font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.5px; color:#64748b; margin-bottom:8px; border-bottom:1.5px solid #f1f5f9; padding-bottom:4px; }
  table { width:100%; border-collapse:collapse; font-size:11px; }
  thead tr { background:#0F2240; }
  th { padding:6px 8px; font-size:9.5px; font-weight:700; color:#fff; text-align:left; text-transform:uppercase; letter-spacing:.3px; }
  td { padding:6px 8px; border-bottom:1px solid #f1f5f9; vertical-align:middle; }
  tr:last-child td { border-bottom:none; }
  .footer { text-align:center; margin-top:20px; padding-top:12px; border-top:2px solid #e2e8f0; font-size:10px; color:#94a3b8; }
  @media print {
    body { background:#fff; }
    .page { padding:12px; }
    .site-fiche, .section { break-inside:avoid; }
    @page { margin:12mm; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- HEADER PRINCIPAL -->
  <div class="header">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
      <div style="position:relative;width:32px;height:32px;flex-shrink:0">
        <div style="position:absolute;width:22px;height:22px;background:#8DC63F;border-radius:50%;top:0;left:0"></div>
        <div style="position:absolute;width:22px;height:22px;background:#E86048;border-radius:50%;top:0;right:0"></div>
        <div style="position:absolute;width:16px;height:16px;background:#C93A78;border-radius:50%;bottom:0;left:50%;transform:translateX(-50%)"></div>
      </div>
      <div>
        <div style="font-size:1.2rem;font-weight:900">PMS HACCP — Rapport Comparatif PMS vs GMO</div>
        <div style="font-size:11px;opacity:.6;margin-top:2px">Généré le ${genDate} à ${genTime}</div>
      </div>
    </div>
    <div class="header-body">
      <div>
        <div style="font-size:1.4rem;font-weight:900;margin-bottom:4px">${periodeLabel}</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:11px;opacity:.7">
          <span>📊 ${sitesData.length} site${sitesData.length>1?'s':''} analysé${sitesData.length>1?'s':''}</span>
          <span>📋 ${sitesData.reduce((s,d)=>s+d.nb,0)} saisies PMS</span>
          <span>📝 ${sitesData.filter(d=>d.hasGMO).length} visite${sitesData.filter(d=>d.hasGMO).length>1?'s':''} GMO</span>
        </div>
      </div>
      <div style="display:flex;gap:20px">
        <div style="text-align:center">
          ${(() => { const avg = sitesData.filter(d=>d.pct!=null); const v = avg.length ? Math.round(avg.reduce((s,d)=>s+d.pct,0)/avg.length) : null; return v!=null ? `<div style="font-size:2.2rem;font-weight:900;color:${v>=85?'#86efac':v>=70?'#fcd34d':'#fca5a5'};line-height:1">${v}%</div><div style="font-size:10px;color:rgba(255,255,255,.6);margin-top:2px">Moy. PMS</div>` : ''; })()}
        </div>
        <div style="width:1px;background:rgba(255,255,255,.2)"></div>
        <div style="text-align:center">
          ${(() => { const avg = sitesData.filter(d=>d.gmoAvg!=null); const v = avg.length ? Math.round(avg.reduce((s,d)=>s+d.gmoAvg,0)/avg.length) : null; return v!=null ? `<div style="font-size:2.2rem;font-weight:900;color:${v>=85?'#86efac':v>=70?'#fcd34d':'#fca5a5'};line-height:1">${v}%</div><div style="font-size:10px;color:rgba(255,255,255,.6);margin-top:2px">Moy. GMO</div>` : ''; })()}
        </div>
      </div>
    </div>
    <div style="height:3px;background:#8DC63F;border-radius:2px;margin-top:14px;opacity:.6"></div>
  </div>

  <!-- LÉGENDE -->
  ${legendeHTML}

  <!-- TABLEAU COMPARATIF GLOBAL -->
  <div class="section" style="margin-bottom:20px">
    <div class="section-header">
      <div>
        <div class="section-title">📊 Tableau comparatif — Tous les sites</div>
        <div class="section-desc">Vue synthétique PMS vs GMO avec écart et indicateur de cohérence pour chaque établissement</div>
      </div>
    </div>
    <table>
      <thead><tr>
        <th style="width:22%">Établissement</th>
        <th style="width:10%">Saisies</th>
        <th style="width:18%">Score PMS</th>
        <th style="width:10%">Visite GMO</th>
        <th style="width:18%">Score GMO</th>
        <th style="width:12%">Écart</th>
        <th style="width:10%">Cohérence</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>

  <!-- FICHES DÉTAILLÉES PAR SITE -->
  <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:#64748b;margin-bottom:12px;border-bottom:2px solid #e2e8f0;padding-bottom:6px">
    Fiches détaillées par établissement
  </div>
  ${siteFiches}

  <div class="footer">
    Rapport Comparatif PMS vs GMO | Période : ${periodeLabel} | ${sitesData.length} site${sitesData.length>1?'s':''} | Généré le ${genDate} à ${genTime} — PMS HACCP Dashboard
  </div>
</div>
</body></html>`;

  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 800);
  }
}

function closeAdminModal(){
  const ov=document.getElementById('admin-modal-ov');
  if(ov) ov.style.display='none';
  _adminModal=null;
}

async function saveAdminModal(){
  if(!_adminModal) return;
  const {type, id} = _adminModal;
  const tid = _profile?.tenant_id || null;
  try{
    if(type==='territory'){
      const name=document.getElementById('am-terr-name').value.trim();
      const code=document.getElementById('am-terr-code').value.trim().toUpperCase();
      if(!name||!code){showToast('Remplissez nom et code','error');return;}
      if(id) await supa('PATCH',`/rest/v1/territories?id=eq.${id}`,{name,code});
      else   await supaPost('territories',{name,code,...(tid?{tenant_id:tid}:{})});
      const tf = (!['super_admin'].includes(_profile?.role) && tid) ? `&tenant_id=eq.${tid}` : '';
      _territories=await supaGet('territories',`select=*&order=name${tf}`);
      showToast(id?'✅ Territoire modifié':'✅ Territoire créé','success');
    }
    else if(type==='sector'){
      const name=document.getElementById('am-sect-name').value.trim();
      const code=document.getElementById('am-sect-code').value.trim().toUpperCase();
      const territory_id=document.getElementById('am-sect-terr').value||null;
      if(!name||!code){showToast('Remplissez nom et code','error');return;}
      if(id) await supa('PATCH',`/rest/v1/sectors?id=eq.${id}`,{name,code,territory_id});
      else   await supaPost('sectors',{name,code,territory_id,...(tid?{tenant_id:tid}:{})});
      const sf = (!['super_admin'].includes(_profile?.role) && tid) ? `&tenant_id=eq.${tid}` : '';
      _sectors=await supaGet('sectors',`select=*,territories(*)&order=name${sf}`);
      showToast(id?'✅ Secteur modifié':'✅ Secteur créé','success');
    }
    else if(type==='site'){
      const name=document.getElementById('am-site-name').value.trim();
      const code=document.getElementById('am-site-code').value.trim().toUpperCase();
      const sector_id=document.getElementById('am-site-sect').value||null;
      const address=document.getElementById('am-site-addr').value.trim()||null;
      if(!name||!code){showToast('Remplissez nom et code site','error');return;}
      if(id) await supa('PATCH',`/rest/v1/sites?id=eq.${id}`,{name,code,sector_id,address});
      else   await supaPost('sites',{name,code,sector_id,address,...(tid?{tenant_id:tid}:{})});
      const sitef = (!['super_admin'].includes(_profile?.role) && tid) ? `&tenant_id=eq.${tid}` : '';
      _sites=await supaGet('sites',`select=*,sectors(*,territories(*))&order=name${sitef}`);
      showToast(id?'✅ Site modifié':'✅ Site créé','success');
    }
    else if(type==='user'){
      const uid=document.getElementById('am-user-id').value;
      if(!uid){showToast('ID utilisateur manquant','error');return;}
      const prenom2=(document.getElementById('am-user-prenom')?.value||'').trim();
      const nom2=(document.getElementById('am-user-nom')?.value||'').trim();
      const full_name=(prenom2+' '+nom2).trim()||document.getElementById('am-user-name').value.trim();
      const email2=document.getElementById('am-user-email')?.value.trim()||null;
      const phone2=document.getElementById('am-user-phone')?.value.trim()||null;
      const role=document.getElementById('am-user-role').value;
      const site_id=document.getElementById('am-user-site').value||null;
      const sector_id=document.getElementById('am-user-sector').value||null;
      const territory_id=document.getElementById('am-user-territory').value||null;
      await supa('PATCH',`/rest/v1/profiles?id=eq.${uid}`,{full_name,email:email2,phone:phone2,role,site_id,sector_id,territory_id});
      showToast('✅ Utilisateur mis à jour','success');
    }
    else if(type==='corrective-action'){
      const name=(document.getElementById('am-ca-name')?.value||'').trim();
      const description=(document.getElementById('am-ca-desc')?.value||'').trim();
      const category=(document.getElementById('am-ca-category')?.value||'autre').trim().toLowerCase();
      const is_default=!!document.getElementById('am-ca-default')?.checked;
      if(!name){showToast('Nom de l\'action obligatoire','error');return;}
      const payload={name,description:description||null,category,is_default};
      if(id) await supaAdmin('PATCH',`/rest/v1/corrective_actions?id=eq.${id}`,payload,{'Prefer':'return=minimal'});
      else   await supaAdmin('POST','/rest/v1/corrective_actions',payload,{'Prefer':'return=minimal'});
      await loadAdminCorrectiveData();
      _adminTab='corrective';
      showToast(id?'✅ Action corrective modifiée':'✅ Action corrective créée','success');
    }
    else if(type==='corrective-mapping'){
      const ncType=(document.getElementById('am-map-type')?.value||'autre').trim().toLowerCase();
      const selectedIds=[...document.querySelectorAll('.am-map-action:checked')].map(el=>el.value).filter(Boolean);
      await supaAdmin('DELETE',`/rest/v1/nc_action_mapping?non_conformity_type=eq.${encodeURIComponent(ncType)}`,null,{'Prefer':'return=minimal'});
      if(selectedIds.length){
        await supaAdmin(
          'POST',
          '/rest/v1/nc_action_mapping',
          selectedIds.map(cid=>({non_conformity_type:ncType,corrective_action_id:cid})),
          {'Prefer':'return=minimal'}
        );
      }
      await loadAdminCorrectiveData();
      _adminTab='corrective';
      showToast('✅ Mapping mis à jour','success');
    }
    else if(type==='knowledge-problem'){
      const problem=(document.getElementById('am-kp-problem')?.value||'').trim();
      const nc_type=(document.getElementById('am-kp-type')?.value||'autre').trim().toLowerCase();
      if(!problem){showToast('Problème obligatoire','error');return;}
      await hubApi('POST','',{
        op:'knowledge_add_problem',
        problem,
        nc_type
      });
      await loadKnowledgeData();
      _adminTab='corrective';
      showToast('✅ Problème type ajouté','success');
    }
    else if(type==='knowledge-recommendation'){
      const problem=(document.getElementById('am-kr-problem')?.value||'').trim();
      const action=(document.getElementById('am-kr-action')?.value||'').trim();
      const nc_type=(document.getElementById('am-kr-type')?.value||'autre').trim().toLowerCase();
      if(!problem||!action){showToast('Problème et action obligatoires','error');return;}
      await hubApi('POST','',{
        op:'knowledge_add_recommendation',
        problem,
        action,
        nc_type
      });
      await loadKnowledgeData();
      _adminTab='corrective';
      showToast('✅ Recommandation ajoutée','success');
    }
    closeAdminModal();
    renderAdmin();
  }catch(e){showToast('Erreur : '+e.message,'error');}
}

// ── Confirmation suppression (custom modal) ──────────
function confirmDelete(table, id, name){
  const ov=document.getElementById('admin-modal-ov');
  const box=document.getElementById('admin-modal-content');
  if(!ov||!box)return;
  _adminModal={type:'delete',table,id,name};
  box.innerHTML=`<div style="padding:24px;text-align:center">
    <div style="font-size:2rem;margin-bottom:12px">🗑️</div>
    <div style="font-size:.95rem;font-weight:800;margin-bottom:8px">Supprimer "${escH(name)}" ?</div>
    <div style="font-size:.78rem;color:var(--muted);margin-bottom:20px">Cette action est irréversible.</div>
    <div style="display:flex;gap:10px">
      <button onclick="closeAdminModal()" style="flex:1;padding:12px;background:#f1f5f9;color:var(--muted);border:none;border-radius:10px;font-weight:700;cursor:pointer;font-family:var(--font)">Annuler</button>
      <button onclick="execDelete()" style="flex:1;padding:12px;background:#dc2626;color:#fff;border:none;border-radius:10px;font-weight:800;cursor:pointer;font-family:var(--font)">Supprimer</button>
    </div>
  </div>`;
  ov.style.display='flex';
}
// ── Supprimer un utilisateur ────────────────────────
function confirmDeleteUser(uid){
  const prev=_adminModal;
  _adminModal={type:'delete-user',uid};
  const box=document.getElementById('admin-modal-content');
  if(!box)return;
  box.innerHTML=`<div style="padding:24px;text-align:center">
    <div style="font-size:2rem;margin-bottom:12px">🗑️</div>
    <div style="font-size:.95rem;font-weight:800;margin-bottom:8px">Supprimer cet utilisateur ?</div>
    <div style="font-size:.78rem;color:var(--muted);margin-bottom:6px">Le compte et toutes ses données de profil seront supprimés.</div>
    <div style="font-size:.72rem;color:#dc2626;margin-bottom:20px;background:#fff5f5;padding:8px;border-radius:8px">⚠️ Les saisies PMS restent dans la base.</div>
    <div style="display:flex;gap:10px">
      <button onclick="closeAdminModal()" style="flex:1;padding:12px;background:#f1f5f9;color:var(--muted);border:none;border-radius:10px;font-weight:700;cursor:pointer;font-family:var(--font)">Annuler</button>
      <button onclick="execDeleteUser()" style="flex:1;padding:12px;background:#dc2626;color:#fff;border:none;border-radius:10px;font-weight:800;cursor:pointer;font-family:var(--font)">Supprimer</button>
    </div>
  </div>`;
}

async function execDeleteUser(){
  if(!_adminModal?.uid) return;
  const uid=_adminModal.uid;
  try{
    // Supprimer profil
    await supa('DELETE',`/rest/v1/profiles?id=eq.${uid}`,null);
    // Supprimer compte Auth (nécessite service_role)
    await supaAdmin('DELETE',`/auth/v1/admin/users/${uid}`,null);
    showToast('✅ Utilisateur supprimé','success');
    closeAdminModal();
    await loadData();
    _adminTab='users';
    renderAdmin();
  }catch(e){showToast('Erreur suppression : '+e.message,'error');}
}

async function execDelete(){
  if(!_adminModal||_adminModal.type!=='delete')return;
  const {table,id,name}=_adminModal;
  try{
    if(table==='corrective_actions' || table==='nc_action_mapping'){
      await supaAdmin('DELETE',`/rest/v1/${table}?id=eq.${id}`,null,{'Prefer':'return=minimal'});
    } else {
      await supa('DELETE',`/rest/v1/${table}?id=eq.${id}`,null);
    }
    showToast(`✅ "${name}" supprimé`,'success');
    if(table==='territories')_territories=await supaGet('territories','select=*&order=name');
    else if(table==='sectors')_sectors=await supaGet('sectors','select=*,territories(*)&order=name');
    else if(table==='sites')_sites=await supaGet('sites','select=*,sectors(*,territories(*))&order=name');
    else if(table==='corrective_actions'){ await loadAdminCorrectiveData(); _adminTab='corrective'; }
    closeAdminModal();
    renderAdmin();
  }catch(e){showToast('Erreur : '+e.message,'error');}
}

// Legacy compat (appelé depuis bootApp)
function updateUserFormFields(){ amUpdateUserFields(); }

// ════════════════════════════════════════════════════
// DETAIL PANEL
// ════════════════════════════════════════════════════
function closeDetail(){document.getElementById('detail-overlay').classList.remove('open');}

async function clotureNCDash(recordId) {
  const r = _records.find(x=>x.id===recordId);
  if (!r) return;
  const actionInput = document.getElementById('detail-action-input');
  const action = actionInput?.value?.trim() || '';
  const btn = document.querySelector('[onclick*="clotureNCDash"]');
  if(btn){btn.textContent='⏳…';btn.disabled=true;}
  try {
    const newData = {...r.data, cloture:'OUI', action_cloture:action||r.data?.action||'', date_cloture:new Date().toLocaleDateString('fr-FR')};
    await supa('PATCH',`/rest/v1/pms_records?id=eq.${recordId}`,{data:newData});
    r.data = newData;
    showToast('✅ NC clôturée','success');
    closeDetail();
    if(_currentPage==='nc') renderPage('nc');
    if(_currentPage==='overview') renderPage('overview');
  } catch(e) {
    showToast('Erreur : '+e.message,'error');
    if(btn){btn.textContent='✅ Clôturer';btn.disabled=false;}
  }
}
function openLightbox(url){document.getElementById('lightbox-img').src=url;document.getElementById('lightbox').classList.add('open');}
function closeLightbox(){document.getElementById('lightbox').classList.remove('open');document.getElementById('lightbox-img').src='';}




const ENR_LABELS = {
  enr01:'❄️ Refroidissement',enr02:'🔥 Remise T°C',enr03:'🔄 Refroid.+Remise',
  enr04:'🥩 Steaks hachés',enr05:'🍟 Fritures',enr06:'🍟 Fritures+test',
  enr07:'🥘 Bien Faits',enr08:'🥗 TM/BF',enr09:'♨️ Cond. chaud',
  enr10:'🧊 Cond. froid',enr11:'🍽️ Plat. froids',enr12:'🍽️ Plat. chauds',
  enr13:'🚚 Départ',enr14:'🛎️ Distribution',enr15:'🏠 SAM',enr16:'🍴 Self',
  enr17:'🚐 Livr. froide',enr18:'🚐 Livr. chaude',enr19:'🌡️ Stockage',enr20:'☀️ Stockage Canicule',enr21:'🌡️ Stockage Individuel',
  enr23:'📦 Réception',enr26:'🌡️ Thermomètres',enr27:'📊 Afficheurs',
  enr28:'🧹 Nettoyage',enr29:'👥 Sensibilisation',enr30:'🚨 NC',
  enr31:'📋 Traçabilité',enr32:'⚠️ TIAC',enr33:'🍱 Plats témoins',
  enr34:'🏷️ Étiq. prod.',enr35:'🥩 Origine viandes',enr36:'♻️ Excédents',
  enr39:'🧺 Pique-nique',enr52:'🌡️ T°C excédents',enr53:'🤝 Don assoc.',
  enr_distrib_midi:'🌞 Distribution Midi',enr_distrib_soir:'🌙 Distribution Soir',
  enr_tc_distrib:'🌡️ T°C Distribution',
  enr24:'🔧 Maintenance',enr25:'🔬 Contrôle labo',enr_allergenes:'⚠️ Allergènes INCO',
};

// Labels lisibles pour les champs data
const FIELD_LABELS = {
  date:'📅 Date', heure:'⏰ Heure', cuisinier:'👤 Cuisinier',
  enc_id:'🧊 Enceinte', enc_label:'🧊 Enceinte', enc_consigne:'🎯 Consigne', motif:'📝 Motif', moment:'⏱ Moment',
  midi_froid_temp:'🌞 T° froid Midi', midi_chaud_temp:'🌞 T° chaud Midi',
  soir_froid_temp:'🌙 T° froid Soir', soir_chaud_temp:'🌙 T° chaud Soir',
  midi_froid_plat:'🌞 Plat froid Midi', midi_chaud_plat:'🌞 Plat chaud Midi',
  equipement:'🔧 Équipement', type_maint:'🔩 Type maintenance', intervenant:'👷 Intervenant',
  zone_produit:'🔬 Zone/Produit', laboratoire:'🏥 Laboratoire', reference:'🔖 Référence',
  resultats:'📊 Résultats', observations:'📝 Observations', actions:'⚡ Actions',
  plat:'🍽️ Plat/Menu', service:'🍴 Service', observation:'💬 Observation',
  soir_froid_plat:'🌙 Plat froid Soir', soir_chaud_plat:'🌙 Plat chaud Soir',
  midi_froid_conf:'✅ Conf. froid Midi', midi_chaud_conf:'✅ Conf. chaud Midi',
  soir_froid_conf:'✅ Conf. froid Soir', soir_chaud_conf:'✅ Conf. chaud Soir',
  midi_valide:'🌞 Validé Midi', soir_valide:'🌙 Validé Soir',
  midi_heure:'🌞 Heure Midi', soir_heure:'🌙 Heure Soir',
  midi_cuisinier:'🌞 Agent Midi', soir_cuisinier:'🌙 Agent Soir',
  produit:'🥘 Produit', fournisseur:'🏭 Fournisseur',
  t_deb:'🌡️ T° départ', t_fin:'🌡️ T° fin', tc:'🌡️ T° cœur',
  t_ref_deb:'🌡️ T° déb. refroid.', t_ref_fin:'🌡️ T° fin refroid.',
  t3:'🌡️ T° départ remise', t1:'🌡️ T° début', t2:'🌡️ T° fin',
  t4:'🌡️ T° fin RT', t_f:'🌡️ T° froid', t_c:'🌡️ T° chaud',
  h_deb:'⏰ H. début', h_fin:'⏰ H. fin',
  h_ref_deb:'⏰ H. déb. refroid.', h_ref_fin:'⏰ H. fin refroid.',
  duree_r:'⏱ Durée refroid.', duree_rt:'⏱ Durée RT',
  conf_r:'✅ Conf. refroid.', conf_rt:'✅ Conf. remise',
  conforme:'✅ Conforme', conf_fin:'✅ Conf. fin',
  conf_deb:'✅ Conf. départ', conf_t3:'✅ Conf. départ remise',
  conf1:'✅ Conf. T1', conf2:'✅ Conf. T2',
  conf_f:'✅ Conf. froid', conf_c:'✅ Conf. chaud',
  conf_cuisson:'✅ Cuisson', conf_glac:'✅ Glacière',
  action:'🔧 Action corrective', mesure:'🔧 Mesure',
  lot:'🔢 N° lot', dlc:'📅 DLC/DDM',
  observations:'📝 Observations', commentaire:'📝 Commentaire',
  theme:'📌 Thème', association:'🤝 Association',
  plat:'🍽️ Plat', plat_midi:'🍽️ Plat midi',
};

const SKIP_FIELDS = ['_ts','_sec','_auto','_enr01_ref','_enr02_ref','_enr01_idx',
  '_enr01_ts','_orig','_statut','_src','_auto_key','_key','_pending_idx',
  '_ligne_ts','_auto_idx','_auto_ligne_idx',
  'signature'];

const TEMP_FIELDS = ['t_deb','t_fin','tc','temp',
  'midi_froid_temp','midi_chaud_temp','soir_froid_temp','soir_chaud_temp','t_ref_deb','t_ref_fin','t3','t1','t2',
  't4','t_f','t_c','t_cuisson','t_glac','t_prod',
  'midi_froid_temp','midi_chaud_temp','soir_froid_temp','soir_chaud_temp'];
const CONF_FIELDS_ALL = ['conf_r','conf_rt','conforme','conf_fin','conf_deb','conf_t3',
  'conf1','conf2','conf_f','conf_c','conf_cuisson','conf_glac','conf_prod',
  'conf_prem','conf_dern','conf_premier','conf_pre','conf_test',
  'midi_froid_conf','midi_chaud_conf','soir_froid_conf','soir_chaud_conf'];
const PHOTO_FIELDS = ['photo','p1_photo','p2_photo','photo_nc','photo2','photo3'];
const PHOTO_LABELS = {
  photo:    '📷 Photo principale',
  p1_photo: '📷 Produit 1',
  p2_photo: '📷 Produit 2',
  photo_nc: '📷 Photo NC',
  photo2:   '📷 Étiquette 2',
  photo3:   '📷 Étiquette 3',
};

function renderSaisies() {
  let recs = filteredRecords();
  if (_filterEnr) recs = recs.filter(r => r.enr_type === _filterEnr);

  // Tri
  recs = [...recs];
  if (_sortField === 'date_desc') recs.sort((a,b) => b.recorded_at?.localeCompare(a.recorded_at||'')||0);
  else if (_sortField === 'date_asc') recs.sort((a,b) => a.recorded_at?.localeCompare(b.recorded_at||'')||0);
  else if (_sortField === 'site') recs.sort((a,b) => (a.site_id||'').localeCompare(b.site_id||''));
  else if (_sortField === 'enr') recs.sort((a,b) => (a.enr_type||'').localeCompare(b.enr_type||''));

  // Pills ENR présents
  const enrSet = [...new Set(_records.map(r=>r.enr_type).filter(Boolean))].sort();

  let html = `
  <div class="enr-filter-wrap">
    <span class="enr-pill ${!_filterEnr?'active':''}" onclick="_setEnrFilter('')">Tous</span>
    ${enrSet.map(e=>`<span class="enr-pill ${_filterEnr===e?'active':''}" onclick="_setEnrFilter('${e}')">${ENR_LABELS[e]||e.toUpperCase()}</span>`).join('')}
  </div>
  <div class="sort-bar">
    <span style="font-size:.73rem;color:var(--muted);font-weight:700">Trier :</span>
    <span class="sort-btn ${_sortField==='date_desc'?'active':''}" onclick="_setSort('date_desc')">📅 Plus récent</span>
    <span class="sort-btn ${_sortField==='date_asc'?'active':''}" onclick="_setSort('date_asc')">📅 Plus ancien</span>
    <span class="sort-btn ${_sortField==='site'?'active':''}" onclick="_setSort('site')">🏠 Site</span>
    <span class="sort-btn ${_sortField==='enr'?'active':''}" onclick="_setSort('enr')">📋 ENR</span>
    <span style="margin-left:auto;font-size:.73rem;color:var(--muted)">${recs.length} saisie(s)</span>
  </div>
  <div class="table-card"><div class="table-wrap"><table>
  <thead><tr>
    <th>Date & Heure</th><th>Site</th><th>Fiche</th><th>Produit / Info</th><th>Temp.</th><th>Conf.</th><th>📷</th>
  </tr></thead><tbody>`;

  if (recs.length === 0) {
    html += `<tr><td colspan="7" style="text-align:center;color:#718096;padding:24px">Aucune saisie trouvée</td></tr>`;
  }

  recs.slice(0,300).forEach(r => {
    const site = _sites.find(s=>s.code===r.site_id);
    const d = r.data||{};
    const produit = d.produit||d.fournisseur||d.plat||d.plat_midi||d.theme||d.association
      ||(r.enr_type&&r.enr_type.includes('distrib')?(d.midi_chaud_plat||d.soir_chaud_plat||d.midi_froid_plat||d.soir_froid_plat||'Distribution'):'')
      ||'—';
    const nc = isNC(r);
    const tagCls = nc ? 'tag-err' : 'tag-ok';
    const tagTxt = nc ? '✗ NC' : '✓ OK';
    const photoCell = hasPhoto(r) ? `<span style="cursor:pointer" onclick="openPhotoFromRecord('${r.id}')">📷</span>` : '—';
    const dt = r.recorded_at ? new Date(r.recorded_at) : null;
    const dateStr = dt ? dt.toLocaleDateString('fr-FR') : '—';
    const timeStr = dt ? dt.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) : '';
    // Trouver la première température
    const tempVal = TEMP_FIELDS.map(k=>d[k]).find(v=>v&&v!=='');
    const tempCell = tempVal ? `<span style="font-family:var(--mono);font-weight:700;color:${nc?'var(--red)':'var(--text)'}">${tempVal}°C</span>` : '—';

    html += `<tr style="cursor:pointer" onclick="openDetail('${r.id}')" title="Voir le détail">
      <td>
        <div style="font-family:var(--mono);font-size:.78rem;font-weight:700">${dateStr}</div>
        <div style="font-size:.68rem;color:var(--muted)">${timeStr} · ${d.cuisinier||d.agent||''}</div>
      </td>
      <td><span class="site-badge"><span class="site-dot"></span>${site?.name||r.site_id}</span></td>
      <td><span class="tag tag-info" style="white-space:nowrap">${ENR_LABELS[r.enr_type]||r.enr_type?.toUpperCase()||'—'}</span></td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600">${escH(produit)}</td>
      <td>${tempCell}</td>
      <td><span class="tag ${tagCls}">${tagTxt}</span></td>
      <td>${photoCell}</td>
    </tr>`;
  });
  html += `</tbody></table></div></div>`;
  try { setContent(html); }
  catch(e) {
    console.error('[renderSaisies]',e);
    setContent('<div class="empty"><div class="empty-ico">⚠️</div><strong>Erreur affichage Saisies</strong><br><small style="color:var(--muted)">'+e.message+'</small><br><small>Vérifiez la RLS table pms_records</small></div>');
  }
}

function _setEnrFilter(enr) { _filterEnr = enr; renderSaisies(); }
function _setSort(s) { _sortField = s; renderSaisies(); }

// ════════════════════════════════════════════════════
// DETAIL PANEL
// ════════════════════════════════════════════════════
function openDetail(id) {
  const r = _records.find(x=>x.id===id);
  if (!r) return;
  const d = r.data||{};
  const site = _sites.find(s=>s.code===r.site_id);
  const dt = r.recorded_at ? new Date(r.recorded_at) : null;
  const dateStr = dt ? dt.toLocaleDateString('fr-FR',{weekday:'long',year:'numeric',month:'long',day:'numeric'}) : '—';
  const timeStr = dt ? dt.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) : '';

  document.getElementById('detail-title').textContent = ENR_LABELS[r.enr_type] || r.enr_type?.toUpperCase() || '—';
  document.getElementById('detail-sub').textContent = `${site?.name||r.site_id} · ${dateStr} à ${timeStr}`;

  let body = '';

  // ── Bandeau NC + bouton clôture ──────────────────────
  const hasNCData = CONF_FIELDS_ALL.some(k=>d[k]==='NON') || r.enr_type==='enr30' || d.cloture==='OUI';
  if (hasNCData) {
    const isCloturee = d.cloture === 'OUI';
    body += `<div style="background:${isCloturee?'#f0fdf4':'#fff5f5'};border:1.5px solid ${isCloturee?'#bbf7d0':'#fecaca'};border-radius:12px;padding:12px 14px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <div style="font-size:.82rem;font-weight:800;color:${isCloturee?'#166534':'#991b1b'}">${isCloturee?'✅ NC clôturée':'🔴 Non-conformité en cours'}</div>
      ${!isCloturee?`<div style="display:flex;gap:6px;flex-wrap:wrap">
        <input type="text" id="detail-action-input" placeholder="Action corrective…" style="padding:6px 10px;border:1.5px solid #fecaca;border-radius:8px;font-size:.75rem;font-family:var(--font);outline:none;min-width:150px">
        <button onclick="clotureNCDash('${r.id}')" style="padding:6px 12px;background:#16a34a;color:#fff;border:none;border-radius:8px;font-size:.75rem;font-weight:800;cursor:pointer;font-family:var(--font);white-space:nowrap">✅ Clôturer</button>
      </div>`:`<div style="font-size:.72rem;color:#16a34a">${d.action_cloture?'→ '+escH(d.action_cloture):''}</div>`}
    </div>`;
  }

  // Grouper les champs
  const temps = {}, confs = {}, autres = {}, photos = {};
  const isAlgField = k => k.startsWith('alg_');
  const isEnr24Field = k => r.enr_type==='enr24'&&['equipement','type_maint','intervenant','observations','actions'].includes(k);
  const isEnr25Field = k => r.enr_type==='enr25'&&['type_analyse','zone_produit','laboratoire','reference','resultats','actions'].includes(k);
  Object.entries(d).forEach(([k,v]) => {
    if (SKIP_FIELDS.includes(k) || !v || v==='' ) return;
    if (isAlgField(k)||isEnr24Field(k)||isEnr25Field(k)) return; // handled in special blocks
    if (PHOTO_FIELDS.includes(k)) { photos[k]=v; return; }
    if (TEMP_FIELDS.includes(k)) { temps[k]=v; return; }
    if (CONF_FIELDS_ALL.includes(k)) { confs[k]=v; return; }
    autres[k]=v;
  });

  // ── ENR23 : section produits structurée ─────────────
  const hasP1=d.p1_produit||d.p1_tc, hasP2=d.p2_produit||d.p2_tc;
  if(hasP1||hasP2){
    const fmtProd=pfx=>{
      const fields=[
        d[pfx+'_produit']?`<div class="detail-field"><div class="detail-field-label">Produit</div><div class="detail-field-value" style="font-weight:700">${escH(d[pfx+'_produit'])}</div></div>`:'',
        d[pfx+'_tc']?`<div class="detail-field"><div class="detail-field-label">T° cœur</div><div class="detail-field-value" style="font-size:1.1rem;color:var(--navy)">${escH(d[pfx+'_tc'])}°C</div></div>`:'',
        d[pfx+'_lot']?`<div class="detail-field"><div class="detail-field-label">N° Lot</div><div class="detail-field-value" style="font-family:var(--mono)">${escH(d[pfx+'_lot'])}</div></div>`:'',
        d[pfx+'_dlc']?`<div class="detail-field"><div class="detail-field-label">DLC</div><div class="detail-field-value">${escH(d[pfx+'_dlc'])}</div></div>`:'',
        d[pfx+'_surge']==='1'?`<div class="detail-field"><div class="detail-field-label">Surgelé</div><div class="detail-field-value">🧊 Oui</div></div>`:'',
        d[pfx+'_qualite']?`<div class="detail-field"><div class="detail-field-label">Qualité</div><div class="detail-field-value">${d[pfx+'_qualite']==='OUI'?'✅ OK':'❌ '+d[pfx+'_qualite']}</div></div>`:'',
        d[pfx+'_emballage']?`<div class="detail-field"><div class="detail-field-label">Emballage</div><div class="detail-field-value">${d[pfx+'_emballage']==='OUI'?'✅ OK':'❌'}</div></div>`:'',
      ].filter(Boolean).join('');
      return fields;
    };
    let prodHtml='';
    if(hasP1) prodHtml+=`<div style="font-size:.7rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;grid-column:1/-1">Produit 1</div>`+fmtProd('p1');
    if(hasP2) prodHtml+=`<div style="font-size:.7rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin:10px 0 6px;grid-column:1/-1">Produit 2</div>`+fmtProd('p2');
    if(prodHtml) body+=`<div class="detail-section"><div class="detail-section-title">📦 Produits réceptionnés</div><div class="detail-grid">${prodHtml}</div></div>`;
  }

  // ── ENR28 : zone/matériel ─────────────────────────────
  if(r.enr_type==='enr28'||d.ref_id){
    const zone=d.zone||nettZone(d.ref_id||'', r.site_id)||'';
    const mat=d.materiel||nettMateriel(d.ref_id||'', r.site_id)||'';
    const pnett=d.produit_nett||nettProduit(d.ref_id||'', r.site_id)||'';
    if(zone||mat) body+=`<div class="detail-section"><div class="detail-section-title">🧹 Nettoyage</div><div class="detail-grid">
      ${zone?`<div class="detail-field"><div class="detail-field-label">Zone</div><div class="detail-field-value">${escH(zone)}</div></div>`:''}
      ${mat?`<div class="detail-field"><div class="detail-field-label">Matériel</div><div class="detail-field-value">${escH(mat)}</div></div>`:''}
      ${pnett?`<div class="detail-field"><div class="detail-field-label">Produit nettoyant</div><div class="detail-field-value">${escH(pnett)}</div></div>`:''}
      ${d.commentaire?`<div class="detail-field full"><div class="detail-field-label">Commentaire</div><div class="detail-field-value">${escH(d.commentaire)}</div></div>`:''}
    </div></div>`;
  }

  // ── ENR_ALLERGENES : affichage structuré des 14 allergènes ──────────────
  if(r.enr_type==='enr_allergenes'){
    const ALLERGEN_DEFS=[
      {id:'alg_gluten',label:'Gluten',ico:'🌾'},{id:'alg_crustaces',label:'Crustacés',ico:'🦞'},
      {id:'alg_oeufs',label:'Œufs',ico:'🥚'},{id:'alg_poisson',label:'Poisson',ico:'🐟'},
      {id:'alg_arachides',label:'Arachides',ico:'🥜'},{id:'alg_soja',label:'Soja',ico:'🌿'},
      {id:'alg_lait',label:'Lait',ico:'🥛'},{id:'alg_fruits_coq',label:'Fruits à coque',ico:'🌰'},
      {id:'alg_celeri',label:'Céleri',ico:'🥬'},{id:'alg_moutarde',label:'Moutarde',ico:'🌻'},
      {id:'alg_sesame',label:'Sésame',ico:'⚪'},{id:'alg_so2',label:'SO₂/Sulfites',ico:'🍷'},
      {id:'alg_lupin',label:'Lupin',ico:'🌼'},{id:'alg_mollusques',label:'Mollusques',ico:'🦪'}
    ];
    const presents=ALLERGEN_DEFS.filter(a=>d[a.id]==='Présent');
    const traces=ALLERGEN_DEFS.filter(a=>d[a.id]==='Traces');
    const absents=ALLERGEN_DEFS.filter(a=>d[a.id]==='Absent'||d[a.id]);
    let algHtml='';
    if(presents.length) algHtml+=`<div style="background:#fff5f5;border:1.5px solid #fecaca;border-radius:10px;padding:10px 12px;margin-bottom:8px"><div style="font-size:.72rem;font-weight:800;color:#991b1b;margin-bottom:6px">⚠️ PRÉSENT (${presents.length})</div><div style="display:flex;flex-wrap:wrap;gap:6px">${presents.map(a=>`<span style="background:#fee2e2;color:#991b1b;border-radius:8px;padding:4px 10px;font-size:.75rem;font-weight:700">${a.ico} ${a.label}</span>`).join('')}</div></div>`;
    if(traces.length) algHtml+=`<div style="background:#fffbeb;border:1.5px solid #fde68a;border-radius:10px;padding:10px 12px;margin-bottom:8px"><div style="font-size:.72rem;font-weight:800;color:#92400e;margin-bottom:6px">〰️ TRACES (${traces.length})</div><div style="display:flex;flex-wrap:wrap;gap:6px">${traces.map(a=>`<span style="background:#fef3c7;color:#92400e;border-radius:8px;padding:4px 10px;font-size:.75rem;font-weight:700">${a.ico} ${a.label}</span>`).join('')}</div></div>`;
    if(!presents.length&&!traces.length) algHtml+=`<div style="background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:10px;padding:10px 12px;margin-bottom:8px;font-size:.82rem;font-weight:800;color:#166534">✅ Aucun des 14 allergènes majeurs déclaré</div>`;
    if(d.observation) algHtml+=`<div style="background:#f5f3ff;border-radius:8px;padding:8px 12px;font-size:.78rem;color:#5C1E5A"><strong>💬 Observation :</strong> ${escH(d.observation)}</div>`;
    body+=`<div class="detail-section"><div class="detail-section-title">⚠️ Déclaration allergènes INCO 1169/2011</div>${algHtml}</div>`;
  }

  // ── ENR24 Maintenance : bloc structuré ──────────────────────────────────
  if(r.enr_type==='enr24'){
    const mKeys=[['equipement','🔧 Équipement'],['type_maint','🔩 Type'],['intervenant','👷 Intervenant'],['observations','📝 Travaux réalisés'],['actions','⚡ Actions à prévoir']];
    const mHtml=mKeys.filter(([k])=>d[k]).map(([k,lbl])=>`<div class="detail-field ${k==='observations'||k==='actions'?'full':''}"><div class="detail-field-label">${lbl}</div><div class="detail-field-value">${escH(String(d[k]))}</div></div>`).join('');
    if(mHtml) body+=`<div class="detail-section"><div class="detail-section-title">🔧 Maintenance équipement</div><div class="detail-grid">${mHtml}</div></div>`;
  }

  // ── ENR25 Labo : bloc structuré ─────────────────────────────────────────
  if(r.enr_type==='enr25'){
    const lKeys=[['type_analyse','🔬 Type'],['zone_produit','📍 Zone/Produit'],['laboratoire','🏥 Laboratoire'],['reference','🔖 Référence'],['resultats','📊 Résultats'],['actions','⚡ Actions correctives']];
    const lHtml=lKeys.filter(([k])=>d[k]).map(([k,lbl])=>`<div class="detail-field ${k==='resultats'||k==='actions'?'full':''}"><div class="detail-field-label">${lbl}</div><div class="detail-field-value">${escH(String(d[k]))}</div></div>`).join('');
    if(lHtml) body+=`<div class="detail-section"><div class="detail-section-title">🔬 Contrôle microbiologique</div><div class="detail-grid">${lHtml}</div></div>`;
  }

  // Infos principales
  const infoKeys = ['date','heure','cuisinier','agent','produit','fournisseur','plat','plat_midi','theme','association','lot','dlc'];
  const infos = infoKeys.filter(k=>d[k]).map(k=>`
    <div class="detail-field">
      <div class="detail-field-label">${FIELD_LABELS[k]||k}</div>
      <div class="detail-field-value">${escH(String(d[k]))}</div>
    </div>`).join('');
  if (infos) body += `<div class="detail-section"><div class="detail-section-title">Informations</div><div class="detail-grid">${infos}</div></div>`;

  // Températures
  if (Object.keys(temps).length) {
    const tHtml = Object.entries(temps).map(([k,v])=>`
      <div class="detail-field">
        <div class="detail-field-label">${FIELD_LABELS[k]||k}</div>
        <div class="detail-field-value" style="font-size:1.1rem;color:var(--navy)">${escH(String(v))}°C</div>
      </div>`).join('');
    body += `<div class="detail-section"><div class="detail-section-title">🌡️ Températures</div><div class="detail-grid">${tHtml}</div></div>`;
  }

  // Conformités
  if (Object.keys(confs).length) {
    const cHtml = Object.entries(confs).map(([k,v])=>{
      const isOK = v==='OUI'; const isNO = v==='NON';
      const cls = isOK?'ok':isNO?'nc':'';
      const ico = isOK?'✅':isNO?'❌':'—';
      return `<div class="detail-field">
        <div class="detail-field-label">${FIELD_LABELS[k]||k}</div>
        <div class="detail-field-value ${cls}">${ico} ${escH(String(v))}</div>
      </div>`;
    }).join('');
    body += `<div class="detail-section"><div class="detail-section-title">✅ Conformité</div><div class="detail-grid">${cHtml}</div></div>`;
  }

  // Autres champs
  const autresFiltered = Object.entries(autres).filter(([k])=>!infoKeys.includes(k));
  if (autresFiltered.length) {
    const aHtml = autresFiltered.map(([k,v])=>{
      const isLong = String(v).length > 40;
      return `<div class="detail-field ${isLong?'full':''}">
        <div class="detail-field-label">${FIELD_LABELS[k]||k}</div>
        <div class="detail-field-value" style="font-family:inherit;font-size:.82rem;white-space:pre-wrap">${escH(String(v))}</div>
      </div>`;
    }).join('');
    body += `<div class="detail-section"><div class="detail-section-title">📋 Autres informations</div><div class="detail-grid">${aHtml}</div></div>`;
  }

  // Photos (toutes, avec libellé individuel — photo_nc incluse dans PHOTO_FIELDS)
  if (Object.keys(photos).length) {
    const pHtml = Object.entries(photos).map(([k,v])=>{
      let url='';
      try { const o=JSON.parse(v); url=o.url||o.thumb_url||o.thumb||''; } catch { url=typeof v==='string'&&v.startsWith('http')?v:''; }
      if (!url) return '';
      const lbl = (typeof PHOTO_LABELS!=='undefined'&&PHOTO_LABELS[k]) ? PHOTO_LABELS[k] : ('📷 '+k);
      const isnc = k==='photo_nc';
      return `<div style="margin-bottom:10px"><div style="font-size:.66rem;font-weight:700;color:${isnc?'#dc2626':'var(--muted)'};margin-bottom:4px">${lbl}</div><img src="${url}" class="detail-photo" onclick="openLightbox('${url}')" loading="lazy" style="${isnc?'border:2px solid #fca5a5;border-radius:10px':''}" onerror="this.style.display='none'"></div>`;
    }).join('');
    if (pHtml) body += `<div class="detail-section"><div class="detail-section-title">📷 Photos</div>${pHtml}</div>`;
  }

  // Signature (ENR30)
  if (d.signature) {
    const sigSrc = d.signature;
    const isBigPng = sigSrc.startsWith('data:image/png') && sigSrc.length > 50000;
    body += `<div class="detail-section"><div class="detail-section-title">✍️ Signature</div>
      ${isBigPng
        ? `<div style="font-size:.75rem;color:#92400e;background:#fffbeb;padding:8px;border-radius:8px">⚠️ Signature volumineuse — nouvelles signatures automatiquement compressées</div>`
        : `<img src="${sigSrc}" style="max-width:260px;max-height:90px;border:1.5px solid var(--border);border-radius:10px;background:#fdf8fd;display:block" onerror="this.style.display='none'">`
      }
    </div>`;
  }

  if (!body) body = '<div style="padding:20px;color:var(--muted);text-align:center">Aucun champ disponible</div>';

  document.getElementById('detail-body').innerHTML = body;
  document.getElementById('detail-overlay').classList.add('open');
}

function closeDetail() {
  document.getElementById('detail-overlay').classList.remove('open');
}

// ════════════════════════════════════════════════════
// ════════════════════════════════════════════════════
// PAGE : PHOTOS & SIGNATURES
// ════════════════════════════════════════════════════
function _parsePhotoUrl(val) {
  if (!val) return '';
  try { var o = JSON.parse(val); return o.url || o.thumb_url || o.thumb || ''; }
  catch(e) { return (typeof val === 'string' && (val.startsWith('http') || val.startsWith('data:'))) ? val : ''; }
}
function _weekKeyFromIso(isoStr){
  const d = new Date(isoStr||Date.now());
  if(Number.isNaN(d.getTime())) return 'Semaine inconnue';
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(),0,1));
  const weekNo = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
  return `${tmp.getUTCFullYear()}-S${String(weekNo).padStart(2,'0')}`;
}
function buildRequestedPhotoItems(){
  const scopedSites = new Set(getScopedSiteCodes());
  const out = [];
  (_tabletAlertsHistory||[]).forEach(a=>{
    if(a.kind!=='photo_request') return;
    const acks = Array.isArray(a.acks) ? a.acks : [];
    acks.forEach(k=>{
      const url = String(k.photo_data_url||'');
      if(!url.startsWith('data:image/') && !url.startsWith('http')) return;
      const siteCode = String(k.site_code || '').toUpperCase();
      if(scopedSites.size && siteCode && !scopedSites.has(siteCode)) return;
      const site = getSiteByCode(siteCode);
      const dtIso = k.acknowledged_at || a.created_at || '';
      const dt = dtIso ? new Date(dtIso) : null;
      out.push({
        url,
        siteCode: siteCode || '—',
        siteName: site?.name || siteCode || '—',
        zone: String(k.zone || a.requested_zone || 'Zone non précisée'),
        periodMode: String(k.period_mode || a.period_mode || 'weekly'),
        shotView: String(k.shot_view || a.shot_view || 'face'),
        dateIso: dtIso,
        dateLabel: dt ? dt.toLocaleString('fr-FR') : '—',
        weekKey: _weekKeyFromIso(dtIso),
        monthKey: dt && !Number.isNaN(dt.getTime()) ? dt.toISOString().slice(0,7) : 'Mois inconnu',
      });
    });
  });
  return out.sort((a,b)=>String(b.dateIso||'').localeCompare(String(a.dateIso||'')));
}
function setPhotoReqFilter(key,val){
  _photoReqFilters = _photoReqFilters || {period:'all',view:'all',zone:'all'};
  _photoReqFilters[key] = val;
  renderPhotos();
}
function renderRequestedPhotosSection(items){
  const zones = [...new Set(items.map(it=>it.zone).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr'));
  const f = _photoReqFilters || {period:'all',view:'all',zone:'all'};
  const filtered = items.filter(it=>{
    if(f.period!=='all' && it.periodMode!==f.period) return false;
    if(f.view!=='all' && it.shotView!==f.view) return false;
    if(f.zone!=='all' && it.zone!==f.zone) return false;
    return true;
  });
  const grouped = {};
  filtered.forEach(it=>{
    const key = `${it.siteCode}::${it.zone}`;
    if(!grouped[key]) grouped[key] = {siteName:it.siteName,siteCode:it.siteCode,zone:it.zone,items:[]};
    grouped[key].items.push(it);
  });
  let html = `<div style="margin-top:24px;padding-top:10px;border-top:2px solid var(--border)">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <div style="font-size:.84rem;font-weight:900;color:#1e3a8a">📷 Photos demandées par le siège (zones cuisine)</div>
      <div style="font-size:.68rem;color:var(--muted)">${filtered.length} photo(s) remontée(s)</div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
      <button onclick="setPhotoReqFilter('period','all')" style="padding:5px 10px;border:none;border-radius:999px;background:${f.period==='all'?'#1e3a8a':'#e2e8f0'};color:${f.period==='all'?'#fff':'#334155'};font-size:.68rem;font-weight:700;cursor:pointer;font-family:var(--font)">Toutes périodes</button>
      <button onclick="setPhotoReqFilter('period','weekly')" style="padding:5px 10px;border:none;border-radius:999px;background:${f.period==='weekly'?'#1e3a8a':'#e2e8f0'};color:${f.period==='weekly'?'#fff':'#334155'};font-size:.68rem;font-weight:700;cursor:pointer;font-family:var(--font)">Hebdomadaire</button>
      <button onclick="setPhotoReqFilter('period','monthly')" style="padding:5px 10px;border:none;border-radius:999px;background:${f.period==='monthly'?'#1e3a8a':'#e2e8f0'};color:${f.period==='monthly'?'#fff':'#334155'};font-size:.68rem;font-weight:700;cursor:pointer;font-family:var(--font)">Mensuelle</button>
      <button onclick="setPhotoReqFilter('view','all')" style="padding:5px 10px;border:none;border-radius:999px;background:${f.view==='all'?'#0f766e':'#e2e8f0'};color:${f.view==='all'?'#fff':'#334155'};font-size:.68rem;font-weight:700;cursor:pointer;font-family:var(--font)">Toutes vues</button>
      <button onclick="setPhotoReqFilter('view','face')" style="padding:5px 10px;border:none;border-radius:999px;background:${f.view==='face'?'#0f766e':'#e2e8f0'};color:${f.view==='face'?'#fff':'#334155'};font-size:.68rem;font-weight:700;cursor:pointer;font-family:var(--font)">De face</button>
      <button onclick="setPhotoReqFilter('view','detail')" style="padding:5px 10px;border:none;border-radius:999px;background:${f.view==='detail'?'#0f766e':'#e2e8f0'};color:${f.view==='detail'?'#fff':'#334155'};font-size:.68rem;font-weight:700;cursor:pointer;font-family:var(--font)">Détail</button>
      <select onchange="setPhotoReqFilter('zone',this.value)" style="padding:6px 10px;border:1.5px solid #cbd5e1;border-radius:999px;font-size:.68rem;background:#fff;color:#334155;font-family:var(--font)">
        <option value="all">Toutes zones</option>
        ${zones.map(z=>`<option value="${escAttr(z)}" ${f.zone===z?'selected':''}>${escH(z)}</option>`).join('')}
      </select>
    </div>`;
  if(!filtered.length){
    html += `<div class="empty"><div class="empty-ico">📭</div>Aucune photo reçue pour ce filtre</div></div>`;
    return html;
  }
  const keys = Object.keys(grouped).sort((a,b)=>grouped[a].siteName.localeCompare(grouped[b].siteName,'fr')||grouped[a].zone.localeCompare(grouped[b].zone,'fr'));
  keys.forEach(key=>{
    const g = grouped[key];
    html += `<div style="background:#fff;border:1px solid #dbeafe;border-radius:12px;padding:10px 12px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;margin-bottom:8px">
        <div>
          <div style="font-size:.78rem;font-weight:800;color:#1e3a8a">🏠 ${escH(g.siteName)} · 📍 ${escH(g.zone)}</div>
          <div style="font-size:.64rem;color:#64748b">${g.items.length} photo(s)</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px">
        ${g.items.map(it=>`<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
          <img src="${escAttr(it.url)}" onclick="openLightbox('${escAttr(it.url)}')" style="width:100%;height:90px;object-fit:cover;cursor:pointer">
          <div style="padding:6px">
            <div style="font-size:.6rem;color:#1f2937;font-weight:700">${it.shotView==='detail'?'🔎 Détail':'🏠 De face'}</div>
            <div style="font-size:.58rem;color:#64748b">${escH(it.periodMode==='monthly' ? it.monthKey : it.weekKey)}</div>
            <div style="font-size:.56rem;color:#94a3b8">${escH(it.dateLabel)}</div>
          </div>
        </div>`).join('')}
      </div>
    </div>`;
  });
  html += `</div>`;
  return html;
}

function renderPhotos() {
  const canLoadRequestedPhotos = ['super_admin','siege','directeur','chef_secteur'].includes(_profile?.role||'');
  if(canLoadRequestedPhotos && !_photoReqAlertsLoaded){
    _photoReqAlertsLoaded = true;
    loadTabletAlertsHistory()
      .then(()=>{ if(_currentPage==='photos') renderPhotos(); })
      .catch(()=>{});
  }

  var recs = filteredRecords().filter(function(r){ return hasPhoto(r); });
  const requestedItems = canLoadRequestedPhotos ? buildRequestedPhotoItems() : [];

  if (recs.length === 0 && requestedItems.length === 0) {
    setContent('<div class="empty"><div class="empty-ico">📷</div>Aucune photo ou signature sur cette période</div>');
    return;
  }

  var allItems = [];
  recs.forEach(function(r) {
    var d = r.data || {};
    var site = _sites.find(function(s){ return s.code === r.site_id; });
    var siteId   = r.site_id || '—';
    var siteName = site ? site.name : siteId;
    var dt = r.recorded_at ? new Date(r.recorded_at) : null;
    var dateKey   = dt ? dt.toISOString().slice(0,10) : 'inconnu';
    var dateLabel = dt ? dt.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'}) : '—';

    var cat = ENR_LABELS[r.enr_type] || (r.enr_type ? r.enr_type.toUpperCase() : '—');
    var catColor = '#3182ce';
    if (r.enr_type==='enr23'){ cat='📦 Réception'; catColor='#2563eb'; }
    else if(r.enr_type==='enr31'){ cat='📋 Traçabilité'; catColor='#7c3aed'; }
    else if(r.enr_type==='enr30'||d.photo_nc){ cat='🚨 Non-conformité'; catColor='#dc2626'; }
    else if(r.enr_type==='enr28'){ cat='🧹 Nettoyage'; catColor='#059669'; }
    else if(r.enr_type==='enr19'){ cat='🌡️ Stockage'; catColor='#0891b2'; }
    else if(r.enr_type==='enr20'){ cat='☀️ Canicule'; catColor='#f59e0b'; }
    else if(r.enr_type==='enr21'){ cat='🌡️ T°C individuel'; catColor='#0891b2'; }

    var produit = d.produit || d.fournisseur || d.plat || d.association || '—';

    PHOTO_FIELDS.forEach(function(field) {
      if (!d[field]) return;
      var url = _parsePhotoUrl(d[field]);
      if (!url) return;
      var lbl = PHOTO_LABELS[field] || ('📷 ' + field);
      allItems.push({ type:'photo', url:url, lbl:lbl, dateKey:dateKey, dateLabel:dateLabel,
        siteId:siteId, siteName:siteName, cat:cat, catColor:catColor, produit:produit, recId:r.id, field:field });
    });

    if (d.signature && d.signature.startsWith('data:image')) {
      allItems.push({ type:'signature', url:d.signature, lbl:'✍️ Signature',
        dateKey:dateKey, dateLabel:dateLabel, siteId:siteId, siteName:siteName,
        cat:cat, catColor:catColor, produit:produit, recId:r.id, field:'signature' });
    }
  });

  var html = '';

  if (allItems.length) {
    var nbPhotos = allItems.filter(function(x){ return x.type==='photo'; }).length;
    var nbSigs   = allItems.filter(function(x){ return x.type==='signature'; }).length;
    var sitesSet = {};
    allItems.forEach(function(p){ sitesSet[p.siteId]=1; });
    var nbSites  = Object.keys(sitesSet).length;

    var bySite = {};
    allItems.forEach(function(p) {
      if (!bySite[p.siteId]) bySite[p.siteId] = { name: p.siteName, byDay: {} };
      var bd = bySite[p.siteId].byDay;
      if (!bd[p.dateKey]) bd[p.dateKey] = { label: p.dateLabel, byCat: {} };
      var bc = bd[p.dateKey].byCat;
      if (!bc[p.cat]) bc[p.cat] = { color: p.catColor, items: [] };
      bc[p.cat].items.push(p);
    });

    html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">'+
      '<div style="background:#f0f4ff;border-radius:10px;padding:7px 13px;font-size:.73rem;font-weight:700;color:#2563eb">📷 '+nbPhotos+' photo(s)</div>'+
      (nbSigs ? '<div style="background:#fdf4ff;border-radius:10px;padding:7px 13px;font-size:.73rem;font-weight:700;color:#7c3aed">✍️ '+nbSigs+' signature(s)</div>' : '')+
      '<div style="background:#f1f5f9;border-radius:10px;padding:7px 13px;font-size:.73rem;font-weight:700;color:var(--muted)">🏠 '+nbSites+' cuisine(s)</div>'+
      '</div>';

    var siteKeys = Object.keys(bySite).sort(function(a,b){ return bySite[a].name.localeCompare(bySite[b].name); });

    siteKeys.forEach(function(siteId) {
      var siteName = bySite[siteId].name;
      var byDay = bySite[siteId].byDay;
      var siteTotal = 0;
      Object.keys(byDay).forEach(function(dk){ Object.keys(byDay[dk].byCat).forEach(function(ck){ siteTotal += byDay[dk].byCat[ck].items.length; }); });

      html += '<div style="margin-bottom:24px;background:var(--card);border:1.5px solid var(--border);border-radius:14px;overflow:hidden">'+
        '<div style="background:var(--navy);color:#fff;padding:10px 16px;display:flex;align-items:center;gap:10px">'+
          '<span style="font-size:.86rem;font-weight:900">🏠 '+escH(siteName)+'</span>'+
          '<span style="font-size:.66rem;background:rgba(255,255,255,.2);padding:2px 8px;border-radius:10px">'+siteTotal+' média(s)</span>'+
        '</div>'+
        '<div style="padding:14px">';

      var dayKeys = Object.keys(byDay).sort().reverse();
      dayKeys.forEach(function(dateKey) {
        var dateLabel = byDay[dateKey].label;
        var byCat = byDay[dateKey].byCat;
        var dayTotal = 0;
        Object.keys(byCat).forEach(function(ck){ dayTotal += byCat[ck].items.length; });

        html += '<div style="margin-bottom:16px">'+
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:9px">'+
            '<span style="font-size:.71rem;font-weight:800;color:var(--navy);text-transform:capitalize">'+dateLabel+'</span>'+
            '<span style="font-size:.62rem;color:var(--muted);background:#f1f5f9;padding:1px 7px;border-radius:8px">'+dayTotal+'</span>'+
            '<div style="flex:1;height:1px;background:var(--border)"></div>'+
          '</div>';

        Object.entries(byCat).forEach(function(entry){
          var cat = entry[0]; var color = entry[1].color; var catItems = entry[1].items;
          html += '<div style="margin-bottom:11px">'+
            '<div style="font-size:.64rem;font-weight:700;color:'+color+';margin-bottom:6px">'+cat+' <span style="color:var(--muted);font-weight:400">'+catItems.length+'</span></div>'+
            '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:8px">';

          catItems.forEach(function(p) {
            var isSig = p.type === 'signature';
            var imgH   = isSig ? '55px' : '96px';
            var bgCard = isSig ? '#fdf4ff' : '#fff';
            var bdCard = isSig ? '#d8b4fe' : 'var(--border)';
            var lblBg  = isSig ? '#7c3aed' : color;
            html +=
              '<div onclick="openDetail(\''+p.recId+'\')"'+ 
              ' style="border-radius:10px;overflow:hidden;background:'+bgCard+';border:1.5px solid '+bdCard+';cursor:pointer;transition:transform .15s,box-shadow .15s"'+ 
              ' onmouseover="this.style.transform=\'translateY(-2px)\';this.style.boxShadow=\'0 4px 12px rgba(0,0,0,.12)\'"'+ 
              ' onmouseout="this.style.transform=\'\';this.style.boxShadow=\'\'">'+ 
              '<div style="position:relative">'+ 
              '<img src="'+p.url+'" style="width:100%;height:'+imgH+';object-fit:'+( isSig?'contain':'cover')+';display:block;background:'+bgCard+'" loading="lazy"'+ 
              ' onerror="this.style.display=\'none\'" onclick="event.stopPropagation();openLightbox(\''+p.url+'\')">'+ 
              '<div style="position:absolute;top:5px;left:5px;background:'+lblBg+';color:#fff;font-size:.54rem;font-weight:800;padding:2px 5px;border-radius:7px">'+p.lbl+'</div>'+ 
              '</div>'+ 
              '<div style="padding:6px">'+ 
              '<div style="font-size:.67rem;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--navy)">'+escH(p.produit)+'</div>'+ 
              '<div style="font-size:.59rem;color:var(--muted)">'+dateLabel.split(' ').slice(1).join(' ')+'</div>'+ 
              '</div>'+ 
              '</div>';
          });

          html += '</div></div>';
        });

        html += '</div>';
      });

      html += '</div></div>';
    });
  }

  if(requestedItems.length){
    html += renderRequestedPhotosSection(requestedItems);
  }

  if(!html){
    html = '<div class="empty"><div class="empty-ico">📷</div>Médias non disponibles (URLs manquantes)</div>';
  }

  setContent(html);
}
// ── Constantes conformité NC (utilisées par renderNC et renderPageENR) ──────
const CONF_LABELS = {
  conf_r:'Refroidissement',conf_rt:'Remise en T°C',conforme:'Conformité générale',
  conf_fin:'T° finale',conf_deb:'T° de départ',conf_t3:'T° départ remise',
  conf1:'T° début',conf2:'T° fin',conf_f:'T° froid',conf_c:'T° chaud',
  conf_cuisson:'Cuisson',conf_glac:'Glacière',conf_prod:'Produit',
  conf_premier:'1er plateau',conf_pre:'Pré-refroid.',conf_test:'Test',
  conf_dern:'Dernier plateau',conf_duree:'Durée',conf_prem:'Premier',
};
const CONF_TEMP_MAP = {
  conf_r:'t_ref_fin',conf_rt:'t_fin',conforme:'tc',conf_fin:'t_fin',
  conf_deb:'t_deb',conf_t3:'t3',conf1:'t1',conf2:'t2',
  conf_f:'t_f',conf_c:'t_c',conf_cuisson:'tc',conf_glac:'t_glac',conf_prod:'t_prod',
};
const ALL_CONF_KEYS=['conf_r','conf_rt','conforme','conf_fin','conf_deb','conf_t3',
  'conf1','conf2','conf_f','conf_c','conf_cuisson','conf_glac','conf_prod',
  'conf_premier','conf_pre','conf_test','conf_dern','conf_duree','conf_prem'];
// ── Variables état Saisies PMS ───────────────────────────────────────────────
let _filterEnr = '';
let _sortField = 'date_desc';

function renderNC() {
  // Inclure EN COURS + CLÔTURÉES (isNC exclut les clôturées → on ajoute isNCCloturee)
  const allNC = filteredRecords().filter(r => isNC(r) || isNCCloturee(r));

  // État filtres locaux à la page NC
  if(!window._ncFilters) window._ncFilters = { status:'open', type:'', enr:'', q:'', sort:'date_desc' };
  const F = window._ncFilters;

  const ncTypeOf = (r) => {
    const d = r.data || {};
    const t = String(d.non_conformity_type||'').toLowerCase();
    if(['temperature','hygiene','storage','autre'].includes(t)) return t;
    // inférer à partir des champs non-conformes
    const keys = ALL_CONF_KEYS.filter(k=>d[k]==='NON');
    if(keys.some(k=>/temp|t_|refroid|cuisson|chaud|froid/i.test(k))) return 'temperature';
    if(keys.some(k=>/hyg|net|propret/i.test(k))) return 'hygiene';
    if(keys.some(k=>/stock|dlc|ddm|fifo/i.test(k))) return 'storage';
    return 'autre';
  };

  // Indexer pour filtres
  const indexed = allNC.map(r => ({
    r,
    closed: isNCCloturee(r),
    enr: r.enr_type || '',
    type: ncTypeOf(r),
    site: r.site_id || '',
    txt: JSON.stringify(r.data||{}).toLowerCase() + ' ' + String(r.site_id||'').toLowerCase(),
    ts: r.recorded_at ? Date.parse(r.recorded_at) : 0
  }));

  const enrOptions = [...new Set(indexed.map(x=>x.enr).filter(Boolean))].sort();
  const typeOptions = ['temperature','hygiene','storage','autre'];
  const TYPE_LABELS = { temperature:'🌡️ Température', hygiene:'🧼 Hygiène', storage:'📦 Stockage/DLC', autre:'📌 Autre' };

  // Appliquer filtres
  let filtered = indexed.filter(x=>{
    if(F.status==='open' && x.closed) return false;
    if(F.status==='closed' && !x.closed) return false;
    if(F.type && x.type !== F.type) return false;
    if(F.enr && x.enr !== F.enr) return false;
    if(F.q){
      const q = F.q.toLowerCase();
      if(!x.txt.includes(q)) return false;
    }
    return true;
  });

  // Tri
  if(F.sort==='date_asc') filtered.sort((a,b)=>a.ts-b.ts);
  else if(F.sort==='site') filtered.sort((a,b)=>String(a.site).localeCompare(String(b.site))||b.ts-a.ts);
  else filtered.sort((a,b)=>b.ts-a.ts); // date_desc default

  // Compteurs
  const totalAll = indexed.length;
  const totalOpen = indexed.filter(x=>!x.closed).length;
  const totalClosed = indexed.filter(x=>x.closed).length;
  const byType = typeOptions.reduce((acc,t)=>{ acc[t] = indexed.filter(x=>x.type===t).length; return acc; }, {});

  // ── Barre de filtres (toujours affichée si on a au moins 1 NC) ──
  const filtersHtml = `
  <div style="background:#fff;border:1px solid var(--border);border-radius:14px;padding:12px;margin-bottom:14px">
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
      <button onclick="setNCFilter('status','open')" style="padding:7px 12px;border-radius:999px;border:1.5px solid ${F.status==='open'?'#dc2626':'#e2e8f0'};background:${F.status==='open'?'#fee2e2':'#fff'};color:${F.status==='open'?'#991b1b':'#475569'};font-size:.72rem;font-weight:800;cursor:pointer;font-family:var(--font)">🔴 En cours (${totalOpen})</button>
      <button onclick="setNCFilter('status','closed')" style="padding:7px 12px;border-radius:999px;border:1.5px solid ${F.status==='closed'?'#16a34a':'#e2e8f0'};background:${F.status==='closed'?'#dcfce7':'#fff'};color:${F.status==='closed'?'#166534':'#475569'};font-size:.72rem;font-weight:800;cursor:pointer;font-family:var(--font)">✅ Clôturées (${totalClosed})</button>
      <button onclick="setNCFilter('status','all')" style="padding:7px 12px;border-radius:999px;border:1.5px solid ${F.status==='all'?'#1e3a8a':'#e2e8f0'};background:${F.status==='all'?'#eff6ff':'#fff'};color:${F.status==='all'?'#1e3a8a':'#475569'};font-size:.72rem;font-weight:800;cursor:pointer;font-family:var(--font)">🗂️ Tout (${totalAll})</button>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
      ${typeOptions.map(t=>`<button onclick="setNCFilter('type','${F.type===t?'':t}')" style="padding:5px 11px;border-radius:999px;border:1.5px solid ${F.type===t?'#1e3a8a':'#e2e8f0'};background:${F.type===t?'#1e3a8a':'#fff'};color:${F.type===t?'#fff':'#475569'};font-size:.7rem;font-weight:700;cursor:pointer;font-family:var(--font)">${TYPE_LABELS[t]} · ${byType[t]||0}</button>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px;align-items:end">
      <div>
        <label style="font-size:.65rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Rechercher (produit, site, description…)</label>
        <input id="nc-search" type="search" value="${escAttr(F.q||'')}" oninput="setNCFilter('q',this.value)" placeholder="Ex: escalope, LOT-42, T°C…" style="width:100%;padding:8px 10px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:.78rem;font-family:var(--font)">
      </div>
      <div>
        <label style="font-size:.65rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Fiche</label>
        <select onchange="setNCFilter('enr',this.value)" style="width:100%;padding:8px 10px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:.75rem;font-family:var(--font);background:#fff">
          <option value="">Toutes</option>
          ${enrOptions.map(e=>`<option value="${escAttr(e)}" ${F.enr===e?'selected':''}>${escH(ENR_LABELS[e]||e)}</option>`).join('')}
        </select>
      </div>
      <div>
        <label style="font-size:.65rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Tri</label>
        <select onchange="setNCFilter('sort',this.value)" style="width:100%;padding:8px 10px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:.75rem;font-family:var(--font);background:#fff">
          <option value="date_desc" ${F.sort==='date_desc'?'selected':''}>📅 Plus récentes</option>
          <option value="date_asc" ${F.sort==='date_asc'?'selected':''}>📅 Plus anciennes</option>
          <option value="site" ${F.sort==='site'?'selected':''}>🏠 Par site</option>
        </select>
      </div>
    </div>
    ${(F.type||F.enr||F.q||F.sort!=='date_desc'||F.status!=='open')?`<div style="margin-top:8px"><button onclick="resetNCFilters()" style="padding:5px 11px;background:#f1f5f9;color:#475569;border:none;border-radius:8px;font-size:.7rem;font-weight:700;cursor:pointer;font-family:var(--font)">↺ Réinitialiser les filtres</button></div>`:''}
  </div>`;

  if (allNC.length === 0) {
    setContent(`<div class="empty"><div class="empty-ico">✅</div><strong>Aucune non-conformité</strong><br>Tout est conforme sur cette période.</div>`);
    return;
  }

  // Séparer en cours / clôturées parmi les résultats filtrés
  const enCours   = filtered.filter(x => !x.closed).map(x=>x.r);
  const cloturees = filtered.filter(x => x.closed).map(x=>x.r);

  let html = filtersHtml;

  // ── Résumé (résultats filtrés) ──
  html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px">
    <div style="background:#fff5f5;border:1.5px solid #fecaca;border-radius:14px;padding:14px;text-align:center">
      <div style="font-size:1.8rem;font-weight:900;color:#dc2626">${enCours.length}</div>
      <div style="font-size:.72rem;font-weight:700;color:#991b1b;text-transform:uppercase">En cours (affichées)</div>
    </div>
    <div style="background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:14px;padding:14px;text-align:center">
      <div style="font-size:1.8rem;font-weight:900;color:#16a34a">${cloturees.length}</div>
      <div style="font-size:.72rem;font-weight:700;color:#166534;text-transform:uppercase">Clôturées (affichées)</div>
    </div>
  </div>`;

  const renderNCCard = (r) => {
    const d = r.data||{};
    const site = _sites.find(s=>s.code===r.site_id);
    const dt = r.recorded_at ? new Date(r.recorded_at) : null;
    const dateStr = dt ? dt.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'}) : '—';
    const timeStr = dt ? dt.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) : '';
    // Titre lisible selon le type
    let produit;
    if (r.enr_type === 'enr30') {
      produit = d.probleme||d.desc||d.description||'Non-conformité';
    } else if (r.enr_type === 'enr28' || d.ref_id) {
      const mat = d.materiel || nettMateriel(d.ref_id||'', r.site_id);
      const zone = d.zone || nettZone(d.ref_id||'', r.site_id);
      produit = mat && zone ? `${mat} — ${zone}` : mat||zone||nettLabel(d.ref_id||'', r.site_id)||'Nettoyage';
    } else if (r.enr_type === 'nuisibles_val') {
      produit = d.zone ? `Nuisibles — ${d.zone}` : 'Nuisibles';
    } else {
      produit = d.produit||d.fournisseur||d.enc_id||d.desc||'—';
    }
    const enrL = ENR_LABELS[r.enr_type]||r.enr_type?.toUpperCase()||'—';
    const cloture = d.cloture === 'OUI';
    const ncFields = ALL_CONF_KEYS.filter(k=>d[k]==='NON');

    // Températures en cause
    const tempsNC = ncFields.map(k=>{
      const tKey = CONF_TEMP_MAP[k];
      const tVal = tKey ? d[tKey] : null;
      const label = CONF_LABELS[k]||k;
      if(tVal) return `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #fecaca">
        <span style="font-size:.75rem;color:#7f1d1d">${label}</span>
        <span style="font-size:.78rem;font-weight:800;color:#dc2626">${tVal}°C</span>
      </div>`;
      return `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #fecaca">
        <span style="font-size:.75rem;color:#7f1d1d">${label}</span>
        <span style="font-size:.78rem;font-weight:800;color:#dc2626">NON</span>
      </div>`;
    }).join('');

    const actionNames = Array.isArray(d.corrective_action_names) ? d.corrective_action_names.filter(Boolean) : [];
    const actionCustom = d.corrective_action_custom || d.action_custom || '';
    const actionSummary = d.action || [...actionNames, ...(actionCustom?[actionCustom]:[])].join(' | ');
    const mainProblem = d.probleme||d.desc||d.description||produit||'';
    const jsArg = (v)=>String(v||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,' ');
    const actionHtml = actionSummary ? `<div style="margin-top:8px;padding:8px;background:#fff;border-radius:8px;border:1px solid #fecaca">
      <div style="font-size:.62rem;font-weight:700;color:#991b1b;margin-bottom:2px">ACTION CORRECTIVE</div>
      <div style="font-size:.78rem;color:#7f1d1d">${escH(actionSummary)}</div>
      ${actionNames.length?`<div style="margin-top:6px;display:flex;gap:5px;flex-wrap:wrap">${actionNames.map(n=>`<span style="background:#fff5f5;color:#991b1b;border:1px solid #fecaca;border-radius:12px;padding:1px 7px;font-size:.62rem;font-weight:700">${escH(n)}</span>`).join('')}</div>`:''}
    </div>` : '';
    const problemActionHtml = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
      <button onclick="event.stopPropagation();addProblemFromNC('${jsArg(mainProblem)}','${jsArg(inferNCTypeForLearning(d))}','${jsArg(r.site_id||'')}')" style="padding:5px 8px;background:#eff6ff;color:#1e3a8a;border:none;border-radius:8px;font-size:.68rem;font-weight:700;cursor:pointer;font-family:var(--font)">📋 Copier problème</button>
      ${actionSummary?`<button onclick="event.stopPropagation();learnActionFromNC('${jsArg(mainProblem)}','${jsArg(actionSummary)}','${jsArg(inferNCTypeForLearning(d))}','${jsArg(r.site_id||'')}')" style="padding:5px 8px;background:#1e3a8a;color:#fff;border:none;border-radius:8px;font-size:.68rem;font-weight:700;cursor:pointer;font-family:var(--font)">🧠 Apprendre cette action</button>`:''}
    </div>`;

    const descHtml = d.desc ? `<div style="font-size:.76rem;color:#991b1b;margin:6px 0;font-style:italic">${escH(d.desc)}</div>` : '';

    return `<div onclick="openDetail('${r.id}')" style="background:${cloture?'#f8fafc':'#fff5f5'};border:1.5px solid ${cloture?'#e2e8f0':'#fecaca'};border-left:4px solid ${cloture?'#16a34a':'#dc2626'};border-radius:14px;margin-bottom:10px;overflow:hidden;cursor:pointer;transition:transform .15s" onmouseover="this.style.transform='translateY(-1px)'" onmouseout="this.style.transform=''">
      <!-- Header -->
      <div style="padding:12px 14px;display:flex;align-items:flex-start;gap:10px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
            <span style="font-size:.68rem;font-weight:800;padding:2px 8px;border-radius:20px;background:${cloture?'#dcfce7':'#fee2e2'};color:${cloture?'#166534':'#991b1b'}">${cloture?'✅ Clôturée':'🔴 En cours'}</span>
            <span class="tag tag-info" style="font-size:.68rem">${enrL}</span>
          </div>
          <div style="font-size:.9rem;font-weight:800;color:${cloture?'var(--text)':'#7f1d1d'}">${escH(produit)}</div>
          <div style="font-size:.72rem;color:var(--muted);margin-top:2px">🏠 ${site?.name||r.site_id} · 📅 ${dateStr} ${timeStr}${d.cuisinier?' · 👤 '+d.cuisinier:''}</div>
        </div>
        <span style="color:var(--muted);font-size:1rem;flex-shrink:0">›</span>
      </div>
      <!-- Détail NC -->
      <div style="padding:0 14px 12px">
        ${descHtml}
        <div style="background:${cloture?'#f1f5f9':'rgba(220,38,38,.06)'};border-radius:8px;padding:8px 10px;margin-bottom:6px">
          ${tempsNC || '<div style="font-size:.75rem;color:var(--muted)">Champs non conformes</div>'}
        </div>
        ${actionHtml}
        ${problemActionHtml}
      </div>
    </div>`;
  };

  if (enCours.length === 0 && cloturees.length === 0) {
    html += `<div class="empty"><div class="empty-ico">🔎</div><strong>Aucune non-conformité ne correspond à ces filtres</strong><br>Ajustez les filtres ou réinitialisez pour tout revoir.</div>`;
  }

  if (enCours.length > 0) {
    html += `<div style="font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:#dc2626;margin-bottom:10px">🔴 Non-conformités en cours (${enCours.length})</div>`;
    enCours.forEach(r => { html += renderNCCard(r); });
  }

  if (cloturees.length > 0) {
    html += `<div style="font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:#16a34a;margin:18px 0 10px">✅ Clôturées (${cloturees.length})</div>`;
    cloturees.forEach(r => { html += renderNCCard(r); });
  }

  setContent(html);

  // Restaurer le focus sur la recherche + curseur en fin de texte (évite la perte de focus au re-render oninput)
  const s = document.getElementById('nc-search');
  if(s && window._ncFilters.q){
    s.focus();
    const v = s.value; s.value = ''; s.value = v;
  }
}

function setNCFilter(key, value){
  if(!window._ncFilters) window._ncFilters = { status:'open', type:'', enr:'', q:'', sort:'date_desc' };
  window._ncFilters[key] = value;
  renderNC();
}

function resetNCFilters(){
  window._ncFilters = { status:'open', type:'', enr:'', q:'', sort:'date_desc' };
  renderNC();
}

// ════════════════════════════════════════════════════
// ════════════════════════════════════════════════════
// GRILLE GMO — AXES & CRITÈRES HACCP
// ════════════════════════════════════════════════════
const GMO_AXES = [
  { key:'locaux', label:'Locaux & Équipements', coeff:10, icon:'🏗️',
    criteres:[
      { key:'marche_avant', label:'Marche en avant respectée (flux propre/souillé)',
        aide:'Vérifiez que le cheminement des denrées va toujours du "sale" vers le "propre" sans croisement : réception → stockage brut → préparation → cuisson → distribution. Les poubelles, déchets et produits souillés ne doivent jamais croiser les produits finis ou propres.',
        ok:'Les zones sont bien séparées physiquement ou dans le temps, les flux ne se croisent pas, les portes de séparation sont fonctionnelles.',
        nc_min:'Un croisement occasionnel constaté ou une porte de séparation défaillante sans risque immédiat.',
        nc_maj:'Croisement direct et régulier cru/cuit ou déchets/produits finis, risque de contamination croisée avéré.' },
      { key:'surfaces', label:'État des surfaces (sols, murs, plans de travail)',
        aide:'Inspectez visuellement les sols, murs, plafonds, plans de travail et équipements. Les surfaces doivent être lisses, imputrescibles, lavables et en bon état. Relevez toute fissure, carrelage décollé, peinture qui s\'écaille ou rouille sur les équipements.',
        ok:'Surfaces propres, lisses, sans fissure ni dégradation. Aucune trace de moisissure ou de dépôt persistant.',
        nc_min:'Dégradation localisée (fissure, joint abîmé) sans risque immédiat mais à corriger. Traces de salissures légères.',
        nc_maj:'Surfaces encrassées, moisissures, rouille active sur équipements en contact alimentaire, infiltrations d\'eau.' },
      { key:'equipements', label:'Équipements fonctionnels, entretenus, propres',
        aide:'Vérifiez l\'état des chambres froides, bain-marie, fours, trancheuses, robots. Les joints de portes de frigo doivent être intacts. Les équipements en contact alimentaire doivent être propres, sans résidu ni corrosion. Vérifiez les carnets de maintenance.',
        ok:'Équipements propres, en bon état, fonctionnels. Joints de frigo intacts. Carnet de maintenance à jour.',
        nc_min:'Équipement encrassé non dangereux, joint légèrement usé, entretien préventif en retard.',
        nc_maj:'Équipement défaillant affectant la sécurité (frigo ne maintenant pas la T°C), joint de frigo très détérioré, équipement rouillé au contact des aliments.' },
      { key:'separation_zones', label:'Séparation zones propres / zones souillées',
        aide:'Vérifiez la séparation physique entre : zone de réception/légumerie (sale), zone de préparation froide, zone de cuisson, zone de distribution. La plonge (zone souillée) doit être séparée de la zone propre. Les vestiaires doivent être accessibles sans traverser la cuisine.',
        ok:'Zones clairement délimitées, séparation physique effective, accès vestiaires corrects.',
        nc_min:'Délimitation insuffisante mais sans croisement constaté, organisation à améliorer.',
        nc_maj:'Absence totale de séparation, zone plonge en contact direct avec zone propre, personnel accédant en tenue de ville à la cuisine.' },
    ]},
  { key:'personnel', label:'Hygiène du personnel', coeff:15, icon:'👨‍🍳',
    criteres:[
      { key:'tenue', label:'Tenue vestimentaire complète, propre, adaptée',
        aide:'Vérifiez que tout le personnel porte : veste/tablier blanc propre, coiffe couvrant entièrement les cheveux, chaussures de sécurité fermées et antidérapantes. Pas de vêtements personnels visibles en cuisine. La tenue doit être changée en cas de souillure.',
        ok:'Tenue complète, propre, coiffe couvrant tous les cheveux, chaussures adaptées pour tout le personnel présent.',
        nc_min:'Un agent sans coiffe ou coiffe incomplète, tablier légèrement souillé, tenue personnelle visible mais limitée.',
        nc_maj:'Personnel en tenue de ville dans la cuisine, absence de coiffe pour plusieurs agents, tenues très sales.' },
      { key:'lavage_mains', label:'Procédure lavage des mains respectée',
        aide:'Vérifiez la présence de lavabos à commande non manuelle (pédale, coude) avec savon bactéricide et essuie-mains à usage unique à proximité des postes de travail. Observez si le personnel se lave les mains aux moments clés : après toilettes, entre cru et cuit, après manipulation de déchets.',
        ok:'Lavabos conformes à chaque poste clé, savon et essuie-mains disponibles, personnel respectant les moments de lavage.',
        nc_min:'Lavabo conforme mais savon ou essuie-mains manquant momentanément, un agent oubliant de se laver les mains.',
        nc_maj:'Absence de lavabo non manuel dans la zone de préparation, personnel ne se lavant pas les mains entre cru et cuit ou après les toilettes.' },
      { key:'comportement', label:'Pas de bijoux, téléphone, alimentation en cuisine',
        aide:'Contrôlez l\'absence de bagues, bracelets, montres, boucles d\'oreilles pendantes (risque de contamination physique et microbien). Le téléphone portable ne doit pas être utilisé en cuisine. Personne ne doit manger, boire (sauf eau en bouteille fermée) ni fumer en zone de production.',
        ok:'Aucun bijou visible, pas d\'utilisation de téléphone observée, pas de nourriture personnelle en cuisine.',
        nc_min:'Port d\'une alliance ou d\'une boucle d\'oreille discrète, téléphone posé sur un plan de travail sans manipulation.',
        nc_maj:'Bagues, bracelets multiples portés lors de la manipulation des aliments, téléphone utilisé pendant la préparation, personnel qui mange en cuisine.' },
      { key:'formation', label:'Personnel formé HACCP — attestations à jour',
        aide:'Demandez à consulter les attestations de formation HACCP du personnel. Tout personnel manipulant des denrées doit avoir suivi une formation hygiène alimentaire (14h minimum recommandées). Vérifiez également la présence du guide de bonnes pratiques d\'hygiène (GBPH) ou du PMS accessible au personnel.',
        ok:'Attestations disponibles pour tout le personnel, PMS accessible et connu des équipes, formations récentes (moins de 3 ans).',
        nc_min:'Attestations présentes mais non consultables immédiatement, un agent sans formation récente identifié.',
        nc_maj:'Absence d\'attestation de formation pour la majorité du personnel, PMS inexistant ou inconnu des équipes.' },
    ]},
  { key:'reception', label:'Réception & Stockage', coeff:15, icon:'📦',
    criteres:[
      { key:'controle_reception', label:'Contrôles à réception effectués (T°C, DLC, emballages)',
        aide:'Vérifiez les fiches de réception : T°C mesurée à réception (frais ≤4°C, surgelés ≤-18°C), intégrité des emballages, DLC/DDM vérifiées, étiquettes fournisseurs conservées. Un thermomètre sonde doit être disponible et étalonné. Les produits non conformes doivent être refusés ou isolés.',
        ok:'Fiches de réception complètes et signées, T°C enregistrées, thermomètre présent et étalonné, procédure de refus documentée.',
        nc_min:'Quelques fiches incomplètes, thermomètre présent mais non étalonné, DLC vérifiées visuellement sans enregistrement.',
        nc_maj:'Absence de contrôle à réception, pas de thermomètre, marchandises acceptées sans vérification, produits périmés en stockage.' },
      { key:'temperatures_stockage', label:'T°C enceintes conformes (froid ≤4°C / congel ≤-18°C)',
        aide:'Relevez les températures affichées ou enregistrées de chaque enceinte froide. Frigo positif : ≤4°C (idéalement 0-3°C pour viandes). Congélateur : ≤-18°C. Vérifiez les enregistrements des 7 derniers jours. En cas de doute, mesurez vous-même avec sonde. Vérifiez aussi la T°C des bain-marie (≥63°C).',
        ok:'T°C conformes sur toutes les enceintes, enregistrements disponibles sur 7 jours, affichage thermomètre fonctionnel.',
        nc_min:'T°C légèrement haute (4-6°C) sur un frigo, enregistrements incomplets sur 1-2 jours.',
        nc_maj:'Frigo à plus de 8°C, congélateur à plus de -15°C, absence d\'enregistrement depuis plus de 3 jours, produits décongelés puis recongelés.' },
      { key:'fifo', label:'Gestion FIFO respectée, DLC/DDM vérifiées',
        aide:'FIFO = First In First Out : les produits les plus anciens doivent être utilisés en premier. Vérifiez que les stocks sont organisés : dates lisibles, produits à DLC courte devant, DLC longue derrière. Recherchez des produits périmés ou dont la DLC est dépassée. Les produits ouverts doivent être datés.',
        ok:'Stockage organisé, produits datés à l\'ouverture, aucun produit périmé trouvé, rotation FIFO appliquée.',
        nc_min:'Organisation peu claire mais aucun produit périmé, quelques produits ouverts non datés.',
        nc_maj:'Produits périmés en stockage actif, produits sans DLC identifiable, stockage aléatoire sans gestion FIFO.' },
      { key:'separation_produits', label:'Séparation cru / cuit / allergènes en stockage',
        aide:'Dans les frigos, vérifiez la séparation physique : produits crus (viandes) en bas, produits cuits ou prêts à consommer en haut. Les allergènes (gluten, noix, etc.) doivent être stockés séparément et clairement identifiés. Pas de viande crue au-dessus de produits finis.',
        ok:'Viandes crues en bas, cuits en haut, allergènes isolés et étiquetés, contenants fermés.',
        nc_min:'Organisation imparfaite mais sans croisement direct, allergènes non étiquetés mais séparés.',
        nc_maj:'Viandes crues stockées au-dessus de produits cuits, allergènes mélangés à des produits standards, contaminations croisées possibles.' },
    ]},
  { key:'ccp', label:'Chaîne du froid / CCP', coeff:20, icon:'❄️',
    criteres:[
      { key:'froid_continu', label:'Chaîne du froid non rompue (pas de décongélation sauvage)',
        aide:'Vérifiez qu\'aucun produit congelé n\'est décongelé à température ambiante. La décongélation doit se faire en frigo positif (≤4°C) ou en eau froide courante ou par cuisson directe. Recherchez des produits partiellement décongelés posés sur plan de travail. Vérifiez aussi qu\'aucun produit chaud n\'est mis directement au frigo.',
        ok:'Aucune décongélation sauvage observée, procédure de décongélation affichée et respectée, produits chauds refroidis avant stockage.',
        nc_min:'Produit en cours de décongélation à température ambiante depuis peu, personnel non informé de la procédure.',
        nc_maj:'Décongélation à température ambiante systématique, produits recongelés après décongélation, produits chauds mis directement en chambre froide.' },
      { key:'enreg_ccp', label:'Enregistrements CCP complétés (frigos, liaison froide)',
        aide:'Vérifiez les cahiers/fiches d\'enregistrement des températures des enceintes froides et de liaison froide. Les relevés doivent être quotidiens, signés, et couvrir les 3 derniers mois minimum. En liaison froide, vérifiez les T°C de sortie de cuisine et d\'arrivée au point de livraison.',
        ok:'Enregistrements quotidiens complets, signés, sur 3 mois. T°C de liaison froide tracées à chaque livraison.',
        nc_min:'Quelques jours manquants (moins de 5% des enregistrements), signatures manquantes sur certaines fiches.',
        nc_maj:'Absence d\'enregistrement sur plus d\'une semaine, fiches vierges ou remplies a posteriori, aucune traçabilité liaison froide.' },
      { key:'alertes_temp', label:'Alertes températures traitées et documentées',
        aide:'Vérifiez si des alertes de dépassement de T°C ont eu lieu et comment elles ont été gérées. Chaque alerte doit faire l\'objet d\'une fiche de non-conformité avec : T°C constatée, durée de dépassement, produits concernés, décision prise (maintien, destruction), signature responsable.',
        ok:'Alertes documentées avec fiches NC complètes, décisions justifiées et tracées, mesures correctives appliquées.',
        nc_min:'Alertes mentionnées verbalement mais non documentées, fiche NC incomplète.',
        nc_maj:'Alertes ignorées, aucune fiche NC, produits maintenus à la consommation sans évaluation du risque.' },
      { key:'dlc_maitrisees', label:'DLC produits cuisinés respectées et étiquetées',
        aide:'Les préparations cuisinées maison doivent être étiquetées avec : nom du produit, date de fabrication, DLC (J+3 en liaison froide, J+5 maxi selon protocole). Vérifiez les étiquettes dans les frigos. Les préparations sans étiquette ou avec DLC dépassée doivent être détruites.',
        ok:'Toutes les préparations étiquetées avec date de fabrication et DLC, aucune DLC dépassée, étiquettes lisibles.',
        nc_min:'Quelques étiquettes manquantes ou illisibles, DLC incertaine sur 1-2 produits.',
        nc_maj:'Préparations sans étiquette, DLC dépassées en stock actif, absence de système d\'étiquetage.' },
    ]},
  { key:'cuisson', label:'Cuisson & Refroidissement', coeff:20, icon:'🔥',
    criteres:[
      { key:'temp_cuisson', label:'T°C à cœur atteinte (≥63°C, ≥75°C selon produit)',
        aide:'Vérifiez les enregistrements de T°C à cœur lors des cuissons. Seuils réglementaires : ≥63°C pour la plupart des plats, ≥75°C pour la volaille et le haché, ≥70°C pour les plats réchauffés. Demandez à observer une prise de T°C avec sonde et vérifiez l\'étalonnage du thermomètre.',
        ok:'Enregistrements complets, T°C conformes sur tous les produits, thermomètre sonde étalonné et disponible.',
        nc_min:'Enregistrements présents mais incomplets, thermomètre non étalonné mais T°C vraisemblables.',
        nc_maj:'Absence d\'enregistrement des T°C de cuisson, pas de thermomètre sonde, cuissons à T°C insuffisante constatée.' },
      { key:'refroidissement', label:'Refroidissement rapide : 63°C → <10°C en moins de 2h',
        aide:'Le refroidissement rapide est un CCP critique. La règle : passer de 63°C à 10°C en moins de 2h (idéalement avec cellule de refroidissement rapide). Vérifiez les enregistrements de refroidissement. En l\'absence de cellule, vérifiez la méthode utilisée (bac d\'eau glacée, portions divisées).',
        ok:'Cellule de refroidissement disponible et utilisée, enregistrements T°C de refroidissement complets, délai <2h respecté.',
        nc_min:'Méthode alternative sans cellule mais délai respecté, enregistrements partiels.',
        nc_maj:'Absence de cellule de refroidissement et pas de méthode alternative, produits refroidis à température ambiante, délai >2h, absence d\'enregistrement.' },
      { key:'remise_temp', label:'Remise en température correcte (≥63°C à cœur)',
        aide:'Pour la remise en température des plats préparés à l\'avance : la T°C à cœur doit atteindre ≥63°C dans un délai ≤1h. La remise en température doit se faire dans un équipement adapté (four, bain-marie). Vérifiez les enregistrements et observez la pratique si possible.',
        ok:'T°C à cœur ≥63°C documentée à chaque remise en température, délai <1h respecté, équipement adapté utilisé.',
        nc_min:'T°C atteinte mais non enregistrée, délai incertain.',
        nc_maj:'Remise en température insuffisante (<63°C), utilisation du bain-marie pour réchauffer (interdit, maintien seulement), absence de contrôle.' },
      { key:'plats_temoins', label:'Plats témoins prélevés et conservés 5 jours minimum',
        aide:'Un plat témoin doit être prélevé à chaque service : 100g minimum de chaque préparation, conservé en frigo à ≤4°C pendant 5 jours dans un contenant fermé et étiqueté (date, service, nom du plat). Vérifiez le registre des plats témoins et leur présence physique en frigo.',
        ok:'Plats témoins présents pour les 5 derniers jours, registre tenu, contenants étiquetés et fermés, conservés à ≤4°C.',
        nc_min:'Plats témoins présents mais registre incomplet ou étiquetage insuffisant.',
        nc_maj:'Absence de plats témoins, conservation inadaptée (T°C trop haute, contenants ouverts), durée de conservation insuffisante.' },
    ]},
  { key:'nettoyage', label:'Nettoyage & Désinfection', coeff:10, icon:'🧹',
    criteres:[
      { key:'plan_nettoyage', label:'Plan de nettoyage affiché, complet et suivi',
        aide:'Vérifiez la présence du plan de nettoyage et désinfection (PND) affiché en cuisine. Il doit indiquer pour chaque zone/équipement : fréquence, produit utilisé, dilution, temps de contact, qui est responsable. Vérifiez les fiches de traçabilité du nettoyage (signatures quotidiennes).',
        ok:'PND affiché, complet, à jour, fiches de traçabilité signées pour les 7 derniers jours.',
        nc_min:'PND présent mais incomplet (manque dilutions ou responsables), fiches de traçabilité avec quelques jours manquants.',
        nc_maj:'Absence de plan de nettoyage, fiches non tenues, personnel ne connaissant pas le protocole.' },
      { key:'produits', label:'Produits conformes, dosages et dilutions corrects',
        aide:'Vérifiez que les produits de nettoyage et désinfection sont homologués contact alimentaire (mention sur étiquette). Les dilutions prescrites par le PND doivent être respectées. Vérifiez la présence de doseurs ou de pictogrammes de dilution. Les produits ne doivent pas être stockés à proximité des denrées.',
        ok:'Produits homologués, doseurs présents, dilutions respectées, stockage séparé des denrées.',
        nc_min:'Produit conforme mais dosage approximatif, absence de doseur mais connaissance verbale du protocole.',
        nc_maj:'Produits non homologués, dosages excessifs (risque résidus chimiques) ou insuffisants (inefficacité), stockage avec les denrées.' },
      { key:'frequences', label:'Fréquences de nettoyage respectées (quotidien/hebdo)',
        aide:'Contrôlez visuellement l\'état de propreté des zones selon leur fréquence : sols/plans de travail quotidien, équipements après chaque utilisation, hottes et filtres hebdomadaire, chambres froides hebdomadaire. Vérifiez les fiches de suivi et l\'état visuel concret.',
        ok:'Propreté visuelle satisfaisante sur toutes les zones, fréquences respectées selon le PND, fiches signées.',
        nc_min:'Quelques zones insuffisamment nettoyées (hotte, dessous d\'équipement), retard dans le nettoyage hebdomadaire.',
        nc_maj:'Sols encrassés, plans de travail souillés entre les services, équipements avec résidus alimentaires, aucun nettoyage visible récent.' },
      { key:'controle_efficacite', label:'Contrôles efficacité réalisés (visuels/analytiques)',
        aide:'Demandez si des autocontrôles d\'efficacité du nettoyage sont réalisés : contrôles visuels documentés, ou analyses bactériologiques de surface (lames de contact, écouvillonnages). Ces contrôles doivent figurer dans le PMS. Idéalement, un laboratoire externe réalise des analyses périodiques.',
        ok:'Contrôles visuels documentés régulièrement, analyses bactériologiques de surface réalisées au moins 2x/an avec résultats conformes.',
        nc_min:'Contrôles visuels non formalisés, pas d\'analyse bactériologique mais propreté visuelle satisfaisante.',
        nc_maj:'Aucun contrôle d\'efficacité réalisé, résultats bactériologiques non conformes sans action corrective.' },
    ]},
  { key:'tracabilite', label:'Traçabilité & Documentation', coeff:10, icon:'📋',
    criteres:[
      { key:'enreg_pms', label:'Enregistrements PMS complétés quotidiennement',
        aide:'Vérifiez que l\'ensemble des fiches PMS (températures frigos, cuissons, réceptions, nettoyage, plats témoins) est complété au quotidien et signé. Les fiches numériques ou papier doivent être à jour. L\'application HACC.PRO doit montrer des saisies régulières.',
        ok:'Toutes les fiches PMS à jour sur les 7 derniers jours, signées, sans jour manquant.',
        nc_min:'Quelques fiches incomplètes (1-2 jours), signatures manquantes sur certaines fiches.',
        nc_maj:'Fiches PMS non tenues depuis plus de 3 jours, saisies manquantes systématiquement, fiches remplies en masse a posteriori.' },
      { key:'etiquettes', label:'Étiquettes fournisseurs conservées — traçabilité lots OK',
        aide:'Vérifiez que les étiquettes des produits réceptionnés (viandes, produits laitiers notamment) sont conservées jusqu\'à la fin de consommation du produit plus 5 jours. En cas d\'alerte sanitaire ou TIAC (Toxi-Infection Alimentaire Collective), il faut pouvoir identifier le lot du produit mis en cause.',
        ok:'Étiquettes conservées dans un classeur ou registre, lots identifiables pour les produits sensibles.',
        nc_min:'Étiquettes conservées mais sans organisation claire, quelques étiquettes manquantes.',
        nc_maj:'Aucune conservation d\'étiquettes, impossible de retracer un lot en cas d\'alerte, traçabilité nulle.' },
      { key:'non_conformites', label:'NC enregistrées avec actions correctives documentées',
        aide:'Vérifiez le registre des non-conformités internes : chaque écart constaté (T°C hors norme, produit refusé, équipement en panne) doit être noté avec la cause, la décision prise et l\'action corrective mise en place. Ce registre prouve à la DDPP que l\'établissement gère ses anomalies.',
        ok:'Registre NC tenu, fiches complètes avec cause, décision et action corrective, suivi de l\'efficacité.',
        nc_min:'NC enregistrées mais sans action corrective documentée, registre incomplet.',
        nc_maj:'Absence totale de registre NC, aucune traçabilité des anomalies rencontrées.' },
      { key:'archives', label:'Archives à jour et accessibles (minimum 3 mois)',
        aide:'L\'ensemble des enregistrements HACCP doit être archivé et consultable rapidement. Durée minimale réglementaire : 3 mois pour les enregistrements courants, jusqu\'à 5 ans pour certains documents (contrats fournisseurs, analyses). Vérifiez l\'organisation et l\'accessibilité des archives en cas de contrôle DDPP.',
        ok:'Archives organisées, 3 mois minimum disponibles, classement chronologique, accessibles en moins de 5 minutes.',
        nc_min:'Archives présentes mais désorganisées, certains documents difficiles à retrouver rapidement.',
        nc_maj:'Archives incomplètes (moins d\'1 mois disponible), documents manquants, impossible de fournir les documents en cas de contrôle.' },
    ]},
];

// Score 0 = NC critique | 1 = NC mineure | 2 = Conforme
function gmoAxeScore(axeKey, critScores) {
  const axe = GMO_AXES.find(a => a.key === axeKey);
  if (!axe) return 0;
  const total = axe.criteres.reduce((sum, c) => sum + (Number(critScores[c.key])||0), 0);
  return Math.round((total / (axe.criteres.length * 2)) * 100);
}

function gmoGlobalScore(critScores) {
  let weighted = 0, totalCoeff = 0;
  GMO_AXES.forEach(axe => {
    const axePct = gmoAxeScore(axe.key, critScores);
    weighted += axePct * axe.coeff;
    totalCoeff += axe.coeff;
  });
  return Math.round(weighted / totalCoeff);
}

function gmoColor(pct) {
  return pct >= 85 ? '#38a169' : pct >= 70 ? '#d69e2e' : '#e53e3e';
}

function gmoLabel(pct) {
  return pct >= 85 ? '✅ Satisfaisant' : pct >= 70 ? '⚠️ À améliorer' : '🔴 Non satisfaisant';
}

// ════════════════════════════════════════════════════
// PAGE : GMO — GRILLE D'AUDIT
// ════════════════════════════════════════════════════
function renderGMO() {
  // ── Filtrer les sites selon le rôle ──────────────────────
  let sitesDisponibles = [];
  if (_profile?.role === 'cuisinier') {
    // Le cuisinier n'a pas accès au GMO
    setContent('<div class="empty"><div class="empty-ico">🔒</div>Accès réservé aux chefs de secteur et supérieurs</div>');
    return;
  } else if (_profile?.role === 'chef_secteur') {
    // Seulement les sites de son secteur
    sitesDisponibles = _sites.filter(s => s.sector_id === _profile.sector_id);
  } else {
    // Siège / Directeur : tous les sites, triés par secteur
    sitesDisponibles = [..._sites].sort((a, b) => {
      const sa = _sectors.find(s => s.id === a.sector_id)?.name || '';
      const sb = _sectors.find(s => s.id === b.sector_id)?.name || '';
      return sa.localeCompare(sb) || a.name.localeCompare(b.name);
    });
  }

  // ── Grouper les sites par secteur pour le sélecteur ──────
  const sitesBySector = {};
  sitesDisponibles.forEach(s => {
    const sect = _sectors.find(x => x.id === s.sector_id);
    const sectLabel = sect?.name || 'Sans secteur';
    if (!sitesBySector[sectLabel]) sitesBySector[sectLabel] = [];
    sitesBySector[sectLabel].push(s);
  });

  // ── Construire les critères ────────────────────────────────
  let scoreSection = GMO_AXES.map(axe => `
  <div class="gmo-axe-block">
    <div class="gmo-axe-title">${axe.icon} ${axe.label} <span class="gmo-coeff">coeff ${axe.coeff}%</span></div>
    ${axe.criteres.map(c => `
    <div class="gmo-critere" id="critere-wrap-${c.key}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
        <div class="gmo-critere-label">${c.label}</div>
        ${c.aide ? `<button class="gmo-aide-btn" onclick="gmoToggleAide('${c.key}')" title="Aide">?</button>` : ''}
      </div>
      ${c.aide ? `
      <div class="gmo-aide-panel" id="aide-${c.key}" style="display:none">
        <div class="gmo-aide-quoi"><strong>🔍 Quoi vérifier</strong><br>${c.aide}</div>
        <div class="gmo-aide-grille">
          <div class="gmo-aide-row ok"><span class="gmo-aide-tag ok">✓ Conforme</span><span>${c.ok||''}</span></div>
          <div class="gmo-aide-row min"><span class="gmo-aide-tag min">△ NC mineure</span><span>${c.nc_min||''}</span></div>
          <div class="gmo-aide-row maj"><span class="gmo-aide-tag maj">✗ NC majeure</span><span>${c.nc_maj||''}</span></div>
        </div>
      </div>` : ''}
      <div class="gmo-critere-btns">
        <button class="gmo-btn gmo-nc-crit" onclick="gmoSetScore('${axe.key}','${c.key}',0,this)">✗ NC critique</button>
        <button class="gmo-btn gmo-nc-min"  onclick="gmoSetScore('${axe.key}','${c.key}',1,this)">△ NC mineure</button>
        <button class="gmo-btn gmo-ok"      onclick="gmoSetScore('${axe.key}','${c.key}',2,this)">✓ Conforme</button>
      </div>
      <div class="gmo-nc-detail" id="nc-detail-${c.key}" style="display:none">
        <div class="gmo-nc-label-row">
          <span class="gmo-nc-tag" id="nc-tag-${c.key}">NC critique</span>
          <span style="font-size:.68rem;color:var(--muted)">Décrivez le constat</span>
        </div>
        ${c.nc_maj ? `<div class="gmo-aide-hint" id="hint-maj-${c.key}" style="display:none;font-size:.68rem;color:#9b2c2c;background:#fff5f5;border-radius:6px;padding:5px 8px;margin-bottom:2px">💡 ${c.nc_maj}</div>` : ''}
        ${c.nc_min ? `<div class="gmo-aide-hint" id="hint-min-${c.key}" style="display:none;font-size:.68rem;color:#b7791f;background:#fffbeb;border-radius:6px;padding:5px 8px;margin-bottom:2px">💡 ${c.nc_min}</div>` : ''}
        <textarea class="gmo-nc-textarea" id="nc-constat-${c.key}"
          placeholder="Constat : décrivez précisément ce qui a été observé…"
          oninput="gmoUpdateBilan()" rows="2"></textarea>
        <textarea class="gmo-nc-textarea gmo-nc-action" id="nc-action-${c.key}"
          placeholder="Action corrective demandée : délai et responsable…"
          oninput="gmoUpdateBilan()" rows="2"></textarea>
      </div>
    </div>`).join('')}
    <div class="gmo-axe-score-row">
      Score axe : <strong id="gmo-axe-score-${axe.key}">—</strong>
    </div>
  </div>`).join('');

  // ── Visites récentes ──────────────────────────────────────
  const recentGMOs = [..._gmos].slice(0, 5);

  let html = `
  <style>
    /* GMO Layout */
    .gmo-grid2 { display:grid; grid-template-columns:1fr min(320px,100%); gap:16px; align-items:start; }
    .gmo-form-cols { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    @media(max-width:480px){ .gmo-form-cols { grid-template-columns:1fr; } }
    @media(max-width:768px){ .gmo-grid2 { grid-template-columns:1fr; } }

    /* Formulaire site + date */
    .gmo-form-header { background:var(--card); border-radius:16px; border:1px solid var(--border); padding:20px; margin-bottom:14px; }
    .gmo-form-header-title { font-size:.95rem; font-weight:900; color:var(--navy); margin-bottom:16px; display:flex; align-items:center; gap:8px; }

    /* Sélecteur de site custom */
    .gmo-site-label { font-size:.68rem; font-weight:800; text-transform:uppercase; letter-spacing:.5px; color:var(--muted); margin-bottom:8px; }
    .gmo-site-selector { display:flex; flex-direction:column; gap:4px; }
    .gmo-site-group-label { font-size:.62rem; font-weight:800; text-transform:uppercase; letter-spacing:.8px; color:var(--muted); padding:6px 0 3px; border-bottom:1px solid var(--border); margin-top:4px; }
    .gmo-site-pill { display:flex; align-items:center; gap:8px; padding:10px 12px; border-radius:10px; border:1.5px solid var(--border); background:#fff; cursor:pointer; transition:all .15s; width:100%; box-sizing:border-box; }
    .gmo-site-pill:hover { border-color:var(--navy); background:#faf6fa; }
    .gmo-site-pill.selected { border-color:var(--navy); background:rgba(15,34,64,.06); }
    .gmo-site-pill .site-dot { width:8px; height:8px; border-radius:50%; background:#cbd5e0; flex-shrink:0; transition:background .15s; }
    .gmo-site-pill.selected .site-dot { background:var(--green); }
    .gmo-site-pill-name { font-size:.82rem; font-weight:700; flex:1; }
    .gmo-site-pill-code { font-size:.68rem; font-family:var(--mono); color:var(--muted); }
    .gmo-site-pill-check { width:18px; height:18px; border-radius:50%; border:2px solid var(--border); display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:all .15s; }
    .gmo-site-pill.selected .gmo-site-pill-check { border-color:var(--navy); background:var(--navy); color:#fff; font-size:.65rem; }

    /* Date picker custom */
    .gmo-date-btn { display:flex; align-items:center; gap:10px; padding:11px 14px; border-radius:10px; border:1.5px solid var(--border); background:#fff; cursor:pointer; transition:all .15s; font-family:var(--font); }
    .gmo-date-btn:hover { border-color:var(--navy); }
    .gmo-date-btn.has-date { border-color:var(--navy); background:rgba(15,34,64,.04); }
    .gmo-date-btn-ico { font-size:1rem; }
    .gmo-date-btn-text { font-size:.85rem; font-weight:700; flex:1; }
    .gmo-date-btn-arrow { color:var(--muted); font-size:.75rem; }

    /* Critères */
    .gmo-axe-block { background:#fff; border:1px solid var(--border); border-radius:14px; padding:14px; margin-bottom:10px; }
    .gmo-axe-title { font-size:.85rem; font-weight:800; color:var(--navy); margin-bottom:10px; display:flex; align-items:center; gap:8px; }
    .gmo-coeff { font-size:.65rem; font-weight:700; background:#ebf8ff; color:#2b6cb0; padding:2px 7px; border-radius:20px; }
    .gmo-critere { display:flex; flex-direction:column; gap:6px; margin-bottom:10px; padding-bottom:10px; border-bottom:1px solid #f1f5f9; }
    .gmo-critere:last-of-type { border-bottom:none; margin-bottom:4px; }
    .gmo-critere-label { font-size:.8rem; color:var(--text); line-height:1.4; font-weight:600; }
    .gmo-critere-btns { display:flex; gap:6px; flex-wrap:wrap; }
    .gmo-btn { padding:8px 14px; border:1.5px solid #e2e8f0; border-radius:12px; font-size:.75rem; font-weight:700; cursor:pointer; background:#faf6fa; color:#4a5568; font-family:var(--font); transition:all .15s; }
    .gmo-btn:hover { transform:translateY(-1px); }
    .gmo-btn.active.gmo-nc-crit { background:#fff5f5; border-color:#e53e3e; color:#c53030; box-shadow:0 2px 8px rgba(229,62,62,.15); }
    .gmo-btn.active.gmo-nc-min  { background:#fffbeb; border-color:#d69e2e; color:#b7791f; box-shadow:0 2px 8px rgba(214,158,46,.15); }
    .gmo-btn.active.gmo-ok      { background:#f0fff4; border-color:#38a169; color:#276749; box-shadow:0 2px 8px rgba(56,161,105,.15); }
    .gmo-nc-detail { background:#fffbeb; border:1.5px solid #fbd38d; border-radius:10px; padding:12px; margin-top:6px; display:flex; flex-direction:column; gap:8px; }
    .gmo-nc-detail.critique { background:#fff5f5; border-color:#feb2b2; }
    .gmo-nc-label-row { display:flex; align-items:center; gap:8px; }
    .gmo-nc-tag { font-size:.65rem; font-weight:800; padding:3px 9px; border-radius:20px; background:#fbd38d; color:#7b4010; }
    .gmo-nc-tag.critique { background:#feb2b2; color:#9b2c2c; }
    .gmo-nc-textarea { width:100%; border:1.5px solid #e2e8f0; border-radius:12px; padding:9px 11px; font-size:.78rem; font-family:var(--font); resize:vertical; color:var(--text); box-sizing:border-box; outline:none; transition:border .15s; }
    .gmo-nc-textarea:focus { border-color:var(--navy); }
    .gmo-nc-action { border-color:#90cdf4; background:#ebf8ff; }
    .gmo-nc-action::placeholder { color:#4299e1; }
    .gmo-aide-btn { width:22px;height:22px;border-radius:50%;background:#e2e8f0;border:none;color:#4a5568;font-size:.72rem;font-weight:900;cursor:pointer;flex-shrink:0;line-height:1;font-family:var(--font); }
    .gmo-aide-panel { background:#f0f9ff;border:1.5px solid #bae6fd;border-radius:10px;padding:12px;margin-bottom:6px; }
    .gmo-aide-quoi { font-size:.72rem;color:#1e40af;line-height:1.5; }
    .gmo-aide-grille { display:flex;flex-direction:column;gap:5px;margin-top:8px; }
    .gmo-aide-row { display:flex;gap:8px;align-items:flex-start;font-size:.68rem;line-height:1.4; }
    .gmo-aide-tag { font-size:.6rem;font-weight:800;padding:2px 7px;border-radius:10px;white-space:nowrap;flex-shrink:0; }
    .gmo-aide-tag.ok  { background:#c6f6d5;color:#276749; }
    .gmo-aide-tag.min { background:#fef3c7;color:#92400e; }
    .gmo-aide-tag.maj { background:#fee2e2;color:#9b2c2c; }
    .gmo-axe-score-row { font-size:.72rem; color:var(--muted); margin-top:8px; text-align:right; }

    /* Observations + Signature */
    .gmo-obs-card { background:#fff; border:1px solid var(--border); border-radius:16px; padding:20px; margin-top:12px; }
    .gmo-obs-label { font-size:.68rem; font-weight:800; text-transform:uppercase; letter-spacing:.5px; color:var(--muted); margin-bottom:8px; }
    .gmo-obs-textarea { width:100%; border:1.5px solid var(--border); border-radius:10px; padding:12px; font-size:.82rem; font-family:var(--font); resize:vertical; min-height:80px; outline:none; transition:border .15s; color:var(--text); box-sizing:border-box; }
    .gmo-obs-textarea:focus { border-color:var(--navy); }
    .gmo-signature-wrap { margin-top:14px; }
    .gmo-signature-label { font-size:.68rem; font-weight:800; text-transform:uppercase; letter-spacing:.5px; color:var(--muted); margin-bottom:8px; display:flex; align-items:center; justify-content:space-between; }
    .gmo-signature-canvas-wrap { border:1.5px solid var(--border); border-radius:10px; overflow:hidden; background:#fafbfc; position:relative; }
    .gmo-signature-canvas { display:block; width:100%; height:100px; touch-action:none; cursor:crosshair; }
    .gmo-signature-placeholder { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:.78rem; color:#cbd5e0; pointer-events:none; }
    .gmo-sig-clear { background:none; border:none; color:var(--muted); font-size:.72rem; cursor:pointer; font-family:var(--font); text-decoration:underline; }

    /* Bouton enregistrer */
    .gmo-save-btn { width:100%; padding:15px; background:linear-gradient(135deg,var(--navy),var(--navy2)); color:#fff; border:none; border-radius:14px; font-size:.92rem; font-weight:900; cursor:pointer; font-family:var(--font); display:flex; align-items:center; justify-content:center; gap:10px; margin-top:16px; transition:all .15s; box-shadow:0 4px 16px rgba(15,34,64,.25); }
    .gmo-save-btn:hover { transform:translateY(-2px); box-shadow:0 6px 20px rgba(15,34,64,.35); }
    .gmo-save-btn:active { transform:translateY(0); }
    .gmo-save-btn:disabled { opacity:.5; pointer-events:none; }

    /* Score live */
    .gmo-summary-card { background:#fff; border:1px solid var(--border); border-radius:16px; padding:16px; position:sticky; top:68px; }
    .gmo-global-score { font-size:3rem; font-weight:900; text-align:center; margin:10px 0 4px; line-height:1; }
    .gmo-global-label { text-align:center; font-size:.82rem; font-weight:700; margin-bottom:16px; }
    .gmo-axe-mini { display:flex; align-items:center; gap:8px; margin-bottom:7px; }
    .gmo-axe-mini-label { font-size:.7rem; color:var(--muted); flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .gmo-axe-mini-bar { flex:2; height:5px; background:#f1f5f9; border-radius:3px; overflow:hidden; }
    .gmo-axe-mini-fill { height:100%; border-radius:3px; transition:width .3s; }
    .gmo-axe-mini-val { font-size:.68rem; font-family:var(--mono); font-weight:700; min-width:32px; text-align:right; }
    .bilan-nc-item { padding:10px 12px; border-radius:10px; margin-bottom:7px; }
    .bilan-nc-item.maj { background:#fff5f5; border-left:3px solid #e53e3e; }
    .bilan-nc-item.min { background:#fffbeb; border-left:3px solid #d69e2e; }
    .bilan-nc-critere { font-size:.75rem; font-weight:800; color:var(--navy); margin-bottom:3px; }
    .bilan-nc-constat { font-size:.72rem; color:var(--text); margin-bottom:3px; }
    .bilan-nc-action { font-size:.72rem; color:#2b6cb0; font-style:italic; }
    .bilan-empty { font-size:.78rem; color:#38a169; text-align:center; padding:12px; font-weight:700; }

    /* Historique */
    .gmo-recent-item { padding:12px 14px; border:1px solid var(--border); border-radius:10px; margin-bottom:8px; cursor:pointer; transition:all .15s; }
    .gmo-recent-item:hover { border-color:var(--navy); background:#faf6fa; }
  </style>

  <div class="gmo-grid2">
    <div>
      <!-- Formulaire principal -->
      <div class="gmo-form-header">
        <div class="gmo-form-header-title">📝 Nouvelle visite GMO</div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:0" class="gmo-form-cols">
          <!-- Sélecteur de site custom -->
          <div>
            <div class="gmo-site-label">🏠 Site visité</div>
            <div class="gmo-site-selector" id="gmo-site-selector">
              ${Object.entries(sitesBySector).map(([sectName, sites]) => `
                ${Object.keys(sitesBySector).length > 1 ? `<div class="gmo-site-group-label">${sectName}</div>` : ''}
                ${sites.map(s => `
                <div class="gmo-site-pill" id="gmo-pill-${s.id}" onclick="gmoSelectSite('${s.id}','${s.name}','${s.code}')">
                  <span class="site-dot"></span>
                  <span class="gmo-site-pill-name">${s.name}</span>
                  <span class="gmo-site-pill-code">${s.code}</span>
                  <span class="gmo-site-pill-check" id="gmo-check-${s.id}"></span>
                </div>`).join('')}
              `).join('')}
              ${sitesDisponibles.length === 0 ? '<div style="font-size:.78rem;color:var(--muted);padding:10px;text-align:center">Aucun site dans votre secteur</div>' : ''}
            </div>
            <input type="hidden" id="gmo-site-id">
          </div>

          <!-- Date picker custom -->
          <div>
            <div class="gmo-site-label">📅 Date de visite</div>
            <div style="position:relative">
              <input type="date" id="gmo-date" 
                value="${new Date().toISOString().slice(0,10)}"
                max="${new Date().toISOString().slice(0,10)}"
                onchange="gmoUpdateDateDisplay(this.value)"
                style="position:absolute;inset:0;opacity:0;cursor:pointer;z-index:2;width:100%;height:100%">
              <div class="gmo-date-btn has-date" id="gmo-date-btn" style="pointer-events:none">
                <span class="gmo-date-btn-ico">📅</span>
                <span class="gmo-date-btn-text" id="gmo-date-display">${new Date().toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</span>
                <span class="gmo-date-btn-arrow">▾</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      ${scoreSection}

      <!-- Observations + Signature -->
      <div class="gmo-obs-card">
        <div class="gmo-obs-label">💬 Observations générales</div>
        <textarea class="gmo-obs-textarea" id="gmo-obs" placeholder="Points forts constatés, axes d'amélioration prioritaires, contexte de la visite…"></textarea>

        <div class="gmo-signature-wrap">
          <div class="gmo-signature-label">
            <span>✍️ Signature du chef de secteur</span>
            <button class="gmo-sig-clear" onclick="gmoClearSignature()">Effacer</button>
          </div>
          <div style="font-size:.72rem;color:var(--muted);margin-bottom:6px">Signez avec le doigt dans le cadre ci-dessous</div>
          <div class="gmo-signature-canvas-wrap">
            <canvas id="gmo-sig-canvas" class="gmo-signature-canvas"></canvas>
            <div class="gmo-signature-placeholder" id="gmo-sig-placeholder">Signez ici…</div>
          </div>
        </div>

        <button class="gmo-save-btn" onclick="saveGMO()" id="gmo-save-btn">
          <span>💾</span>
          <span>Enregistrer la visite GMO</span>
        </button>
      </div>
    </div>

    <!-- Colonne droite : score live + historique -->
    <div>
      <div class="gmo-summary-card">
        <div style="font-size:.75rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px">📊 Score en cours</div>
        <div class="gmo-global-score" id="gmo-live-score" style="color:#cbd5e0">—</div>
        <div class="gmo-global-label" id="gmo-live-label" style="color:#a0aec0">Notez les critères</div>

        <div id="gmo-axes-mini" style="margin-bottom:14px">
          ${GMO_AXES.map(a => `
          <div class="gmo-axe-mini">
            <span style="font-size:.8rem">${a.icon}</span>
            <span class="gmo-axe-mini-label">${a.label}</span>
            <div class="gmo-axe-mini-bar"><div class="gmo-axe-mini-fill" id="gmo-mini-bar-${a.key}" style="width:0%;background:#cbd5e0"></div></div>
            <span class="gmo-axe-mini-val" id="gmo-mini-val-${a.key}" style="color:var(--muted)">—</span>
          </div>`).join('')}
        </div>

        <div style="font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:8px">Bilan NC</div>
        <div id="gmo-bilan-nc"><div class="bilan-empty">✓ Aucune NC pour l'instant</div></div>
      </div>

      <!-- Historique visites -->
      ${recentGMOs.length > 0 ? `
      <div style="margin-top:14px">
        <div style="font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:10px">Visites récentes</div>
        ${recentGMOs.map(g => {
          const site = _sites.find(s => s.id === g.site_id);
          const sc = g.scores || {};
          const glob = sc._global ?? null;
          const dt = g.visit_date ? new Date(g.visit_date+'T12:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'}) : '—';
          const col = glob >= 85 ? '#16a34a' : glob >= 70 ? '#d97706' : '#dc2626';
          return `<div class="gmo-recent-item" onclick="openGMODetail('${g.id}')">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
              <div>
                <div style="font-size:.82rem;font-weight:700">${site?.name || g.site_id}</div>
                <div style="font-size:.68rem;color:var(--muted)">${dt}</div>
              </div>
              ${glob !== null ? `<span style="font-size:1.1rem;font-weight:900;color:${col}">${glob}%</span>` : '<span style="color:var(--muted);font-size:.75rem">—</span>'}
            </div>
          </div>`;
        }).join('')}
      </div>` : ''}
    </div>
  </div>`;

  setContent(html);

  // Initialiser les scores si première fois
  if (!window._gmoScores) window._gmoScores   = {};
  if (!window._gmoConstats) window._gmoConstats = {};
  if (!window._gmoActions) window._gmoActions  = {};

  // Initialiser le canvas signature
  setTimeout(() => {
    gmoInitSignature();
    // Si un seul site dispo, le pré-sélectionner
    if (sitesDisponibles.length === 1) {
      gmoSelectSite(sitesDisponibles[0].id, sitesDisponibles[0].name, sitesDisponibles[0].code);
    }
  }, 50);
}

// ── Sélecteur de site ────────────────────────────────────
let _gmoSiteId = null;

function gmoSelectSite(id, name, code) {
  _gmoSiteId = id;
  document.getElementById('gmo-site-id').value = id;
  // Mettre à jour les pills
  document.querySelectorAll('.gmo-site-pill').forEach(el => {
    el.classList.remove('selected');
    const check = el.querySelector('.gmo-site-pill-check');
    if (check) check.textContent = '';
  });
  const pill = document.getElementById('gmo-pill-' + id);
  if (pill) {
    pill.classList.add('selected');
    const check = document.getElementById('gmo-check-' + id);
    if (check) check.textContent = '✓';
  }
}

// ── Date picker custom pour GMO ──────────────────────────
function gmoUpdateDateDisplay(val) {
  if (!val) return;
  const dt = new Date(val + 'T12:00');
  const label = dt.toLocaleDateString('fr-FR', {weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const el = document.getElementById('gmo-date-display');
  if (el) el.textContent = label;
}

// ── Signature canvas ─────────────────────────────────────
let _gmoSigDrawing = false;
let _gmoSigHasData = false;

function gmoInitSignature() {
  const canvas = document.getElementById('gmo-sig-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * (window.devicePixelRatio || 1);
  canvas.height = rect.height * (window.devicePixelRatio || 1);
  ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
  ctx.strokeStyle = '#0F2240';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  function getPos(e) {
    const r = canvas.getBoundingClientRect();
    const pt = e.touches ? e.touches[0] : e;
    return { x: pt.clientX - r.left, y: pt.clientY - r.top };
  }

  function start(e) {
    e.preventDefault();
    _gmoSigDrawing = true;
    const {x, y} = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    const ph = document.getElementById('gmo-sig-placeholder');
    if (ph) ph.style.display = 'none';
  }
  function draw(e) {
    if (!_gmoSigDrawing) return;
    e.preventDefault();
    const {x, y} = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    _gmoSigHasData = true;
  }
  function stop(e) { _gmoSigDrawing = false; }

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', stop);
  canvas.addEventListener('touchstart', start, {passive:false});
  canvas.addEventListener('touchmove', draw, {passive:false});
  canvas.addEventListener('touchend', stop);
}

function gmoClearSignature() {
  const canvas = document.getElementById('gmo-sig-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  _gmoSigHasData = false;
  const ph = document.getElementById('gmo-sig-placeholder');
  if (ph) ph.style.display = 'flex';
}

function gmoGetSignatureDataURL() {
  const canvas = document.getElementById('gmo-sig-canvas');
  if (!canvas || !_gmoSigHasData) return null;
  return canvas.toDataURL('image/png');
}

// ── saveGMO ──────────────────────────────────────────────
async function saveGMO() {
  const site_id = document.getElementById('gmo-site-id')?.value;
  const date    = document.getElementById('gmo-date')?.value;
  const obs     = document.getElementById('gmo-obs')?.value || '';

  if (!site_id) {
    showToast('⚠️ Sélectionnez un site', 'error');
    // Scroller vers le sélecteur
    document.getElementById('gmo-site-selector')?.scrollIntoView({behavior:'smooth'});
    return;
  }
  if (!date) {
    showToast('⚠️ Sélectionnez une date', 'error');
    return;
  }

  gmoUpdateBilan();

  const cs = window._gmoScores || {};
  const totalCriteres = GMO_AXES.reduce((s,a) => s + a.criteres.length, 0);
  const notesCount = Object.keys(cs).length;

  if (notesCount < totalCriteres) {
    const proceed = await showConfirmModal(
      `${notesCount}/${totalCriteres} critères notés`,
      'Enregistrer quand même ?',
      'Continuer', 'Annuler'
    );
    if (!proceed) return;
  }

  const ncsWithoutConstat = GMO_AXES.flatMap(a => a.criteres)
    .filter(c => (cs[c.key]===0||cs[c.key]===1) && !window._gmoConstats[c.key]?.trim());
  if (ncsWithoutConstat.length > 0) {
    const proceed = await showConfirmModal(
      `${ncsWithoutConstat.length} NC sans constat`,
      'Certaines non-conformités n\'ont pas de constat renseigné. Enregistrer quand même ?',
      'Continuer', 'Annuler'
    );
    if (!proceed) return;
  }

  const bilanNCs = GMO_AXES.flatMap(axe =>
    axe.criteres
      .filter(c => cs[c.key]===0 || cs[c.key]===1)
      .map(c => ({
        axe:     axe.label,
        critere: c.label,
        niveau:  cs[c.key]===0 ? 'NC majeure' : 'NC mineure',
        constat: window._gmoConstats[c.key] || '',
        action:  window._gmoActions[c.key]  || '',
        verifie: false,
      }))
  );

  const scoresAxes = {};
  GMO_AXES.forEach(a => { scoresAxes[a.key] = gmoAxeScore(a.key, cs); });
  const globalScore = gmoGlobalScore(cs);

  // Récupérer la signature
  const signatureDataURL = gmoGetSignatureDataURL();

  const scoresWithDetail = {
    ...scoresAxes,
    _detail:    cs,
    _global:    globalScore,
    _bilan:     bilanNCs,
    _constats:  window._gmoConstats,
    _actions:   window._gmoActions,
    _signature: signatureDataURL || null,
  };

  const btn = document.getElementById('gmo-save-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span>⏳</span><span>Enregistrement…</span>'; }

  try {
    await supa('POST', '/rest/v1/gmo', {
      site_id,
      visit_date:      date,
      periode:         date.slice(0,7),
      scores:          scoresWithDetail,
      observations:    obs,
      chef_secteur_id: _profile?.id        || null,
      sector_id:       _profile?.sector_id || null,
      tenant_id:       _profile?.tenant_id || null,
    });
    window._gmoScores   = {};
    window._gmoConstats = {};
    window._gmoActions  = {};
    _gmoSiteId = null;
    const gmoTf = _profile?.tenant_id ? `&tenant_id=eq.${_profile.tenant_id}` : '';
    _gmos = await supaGet('gmo', `select=*&order=visit_date.desc&limit=200${gmoTf}`);
    renderGMO();
    showToast(`✅ Visite GMO enregistrée — Score global : ${globalScore}% — ${bilanNCs.length} NC documentée${bilanNCs.length>1?'s':''}`, 'success');
  } catch(e) {
    showToast('Erreur : ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<span>💾</span><span>Enregistrer la visite GMO</span>'; }
  }
}

// ── Modal confirm custom (remplace alert/confirm) ─────────
function showConfirmModal(title, message, confirmLabel='Confirmer', cancelLabel='Annuler') {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(20,5,25,.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML = `<div style="background:#fff;border-radius:18px;padding:24px;max-width:360px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="font-size:.95rem;font-weight:800;color:var(--navy);margin-bottom:8px">${title}</div>
      <div style="font-size:.8rem;color:var(--muted);margin-bottom:20px;line-height:1.5">${message}</div>
      <div style="display:flex;gap:10px">
        <button id="conf-cancel" style="flex:1;padding:11px;background:#f1f5f9;color:var(--muted);border:none;border-radius:10px;font-weight:700;cursor:pointer;font-family:var(--font)">${cancelLabel}</button>
        <button id="conf-ok" style="flex:1;padding:11px;background:var(--navy);color:#fff;border:none;border-radius:10px;font-weight:800;cursor:pointer;font-family:var(--font)">${confirmLabel}</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#conf-ok').onclick = () => { overlay.remove(); resolve(true); };
    overlay.querySelector('#conf-cancel').onclick = () => { overlay.remove(); resolve(false); };
  });
}




function gmoToggleAide(critKey) {
  const panel = document.getElementById('aide-' + critKey);
  if (panel) panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
}

function gmoSetScore(axeKey, critKey, val, btn) {
  window._gmoScores[critKey] = val;

  // Highlight bouton actif
  const parent = btn.closest('.gmo-critere-btns');
  parent.querySelectorAll('.gmo-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  // Afficher/masquer zone constat selon NC ou non
  const detail = document.getElementById('nc-detail-' + critKey);
  const tag    = document.getElementById('nc-tag-'    + critKey);
  const hintMaj = document.getElementById('hint-maj-' + critKey);
  const hintMin = document.getElementById('hint-min-' + critKey);
  if (detail) {
    if (val < 2) {
      detail.style.display = 'flex';
      detail.classList.toggle('critique', val === 0);
      if (tag) {
        tag.textContent = val === 0 ? 'NC majeure' : 'NC mineure';
        tag.classList.toggle('critique', val === 0);
      }
      // Afficher l'indice correspondant au niveau sélectionné
      if (hintMaj) hintMaj.style.display = val === 0 ? 'block' : 'none';
      if (hintMin) hintMin.style.display = val === 1 ? 'block' : 'none';
    } else {
      detail.style.display = 'none';
      // Effacer constat si on repasse à conforme
      const ca = document.getElementById('nc-constat-' + critKey);
      const ac = document.getElementById('nc-action-'  + critKey);
      if (ca) ca.value = '';
      if (ac) ac.value = '';
      delete window._gmoConstats[critKey];
      delete window._gmoActions[critKey];
    }
  }

  updateGmoLiveScore();
  gmoUpdateBilan();
}

function gmoUpdateBilan() {
  // Lire tous les constats et actions depuis le DOM
  Object.keys(window._gmoScores).forEach(critKey => {
    const ca = document.getElementById('nc-constat-' + critKey);
    const ac = document.getElementById('nc-action-'  + critKey);
    if (ca) window._gmoConstats[critKey] = ca.value;
    if (ac) window._gmoActions[critKey]  = ac.value;
  });

  const bilanEl  = document.getElementById('gmo-bilan-content');
  const countEl  = document.getElementById('gmo-bilan-counts');
  if (!bilanEl) return;

  const ncs = [];
  GMO_AXES.forEach(axe => {
    axe.criteres.forEach(c => {
      const val = window._gmoScores[c.key];
      if (val === 0 || val === 1) {
        ncs.push({
          axeLabel: axe.label, axeIcon: axe.icon,
          critLabel: c.label, critKey: c.key,
          niveau: val,
          constat: window._gmoConstats[c.key] || '',
          action:  window._gmoActions[c.key]  || '',
        });
      }
    });
  });

  if (ncs.length === 0) {
    bilanEl.innerHTML = '<div class="bilan-empty">✅ Aucune NC pour l\'instant</div>';
    if (countEl) countEl.style.display = 'none';
    return;
  }

  const maj = ncs.filter(n => n.niveau === 0);
  const min = ncs.filter(n => n.niveau === 1);

  bilanEl.innerHTML = [...maj, ...min].map(nc => `
    <div class="bilan-nc-item ${nc.niveau===0?'maj':'min'}">
      <div class="bilan-nc-critere">
        ${nc.axeIcon} ${nc.axeLabel}
        <span style="font-size:.65rem;font-weight:700;padding:1px 6px;border-radius:10px;margin-left:4px;
          background:${nc.niveau===0?'#feb2b2':'#fbd38d'};color:${nc.niveau===0?'#9b2c2c':'#7b4010'}">
          ${nc.niveau===0?'NC majeure':'NC mineure'}
        </span>
      </div>
      <div class="bilan-nc-constat">▸ ${nc.critLabel}</div>
      ${nc.constat ? `<div class="bilan-nc-constat" style="margin-top:3px;color:#4a5568">📝 ${nc.constat}</div>` : '<div class="bilan-nc-constat" style="color:#e53e3e;font-style:italic">⚠️ Constat non renseigné</div>'}
      ${nc.action  ? `<div class="bilan-nc-action">→ ${nc.action}</div>` : '<div class="bilan-nc-action" style="color:#a0aec0;font-style:italic">Action corrective non renseignée</div>'}
    </div>`).join('');

  if (countEl) {
    countEl.style.display = 'block';
    countEl.innerHTML = `
      ${maj.length ? `<span style="color:#c53030;font-weight:800">${maj.length} NC majeure${maj.length>1?'s':''}</span>` : ''}
      ${maj.length && min.length ? ' · ' : ''}
      ${min.length ? `<span style="color:#b7791f;font-weight:800">${min.length} NC mineure${min.length>1?'s':''}</span>` : ''}
      <span style="margin-left:6px">— à revoir lors de la prochaine visite</span>`;
  }
}

function updateGmoLiveScore() {
  const cs = window._gmoScores || {};
  const anyScore = Object.keys(cs).length > 0;

  GMO_AXES.forEach(axe => {
    const hasSome = axe.criteres.some(c => cs[c.key] !== undefined);
    const axePct  = hasSome ? gmoAxeScore(axe.key, cs) : null;
    const axeEl   = document.getElementById('gmo-axe-score-' + axe.key);
    const barEl   = document.getElementById('gmo-mini-bar-'  + axe.key);
    const valEl   = document.getElementById('gmo-mini-val-'  + axe.key);
    if (axeEl) axeEl.innerHTML = axePct !== null ? `<span style="color:${gmoColor(axePct)}">${axePct}%</span>` : '—';
    if (barEl) { barEl.style.width = (axePct||0)+'%'; barEl.style.background = axePct!==null ? gmoColor(axePct) : '#cbd5e0'; }
    if (valEl) valEl.textContent = axePct !== null ? axePct+'%' : '—';
  });

  if (!anyScore) return;
  const global  = gmoGlobalScore(cs);
  const globalEl = document.getElementById('gmo-live-score');
  const labelEl  = document.getElementById('gmo-live-label');
  const dgalEl   = document.getElementById('gmo-dgal-mention');
  if (globalEl) { globalEl.textContent = global+'%'; globalEl.style.color = gmoColor(global); }
  if (labelEl)  { labelEl.textContent = gmoLabel(global); labelEl.style.color = gmoColor(global); }

  // Mention DGAL équivalent
  const maj = Object.values(cs).filter(v=>v===0).length;
  const min = Object.values(cs).filter(v=>v===1).length;
  if (dgalEl) {
    if (maj > 0 || min > 0) {
      dgalEl.style.display = 'block';
      dgalEl.textContent = `${maj} NC majeure${maj>1?'s':''} · ${min} NC mineure${min>1?'s':''}`;
    } else {
      dgalEl.style.display = 'none';
    }
  }
}


function renderCompare() {
  const f = getFilters();
  const moisFilter = f.mois || new Date().toISOString().slice(0,7);

  // Appliquer le filtre site si sélectionné
  const siteFilter = f.site || '';
  const secteurFilter = f.secteur || '';
  const sitesFiltered = _sites.filter(s => {
    if (siteFilter && s.code !== siteFilter) return false;
    if (secteurFilter && s.sector_id !== secteurFilter) return false;
    return true;
  });

  const sitesData = sitesFiltered.map(site => {
    const siteRecs = _records.filter(r =>
      r.site_id === site.code && r.recorded_at?.startsWith(moisFilter)
    );
    const siteGMO = _gmos.find(g =>
      g.site_id === site.id && g.visit_date?.startsWith(moisFilter)
    );
    const nb  = siteRecs.length;
    const nc  = siteRecs.filter(r => isNC(r)).length;
    const pct = nb > 0 ? Math.round((1 - nc / nb) * 100) : null;

    // Score GMO — priorité nouveau format (_global dans scores)
    let gmoAvg = null;
    if (siteGMO) {
      const sc = siteGMO.scores || {};
      if (sc._global != null) {
        gmoAvg = sc._global;
      } else if (sc._detail && Object.keys(sc._detail).length) {
        gmoAvg = gmoGlobalScore(sc._detail);
      } else {
        // Ancien format : moyenne simple des axes
        const vals = Object.entries(sc).filter(([k])=>!k.startsWith('_')).map(([,v])=>Number(v));
        if (vals.length) gmoAvg = Math.round(vals.reduce((a,b)=>a+b,0)/vals.length);
      }
    }
    const axeScores = siteGMO?.scores || null;
    return { site, nb, nc, pct, gmoAvg, axeScores, gmoObs: siteGMO?.observations||'', hasGMO: !!siteGMO };
  }).filter(x => x.nb > 0 || x.hasGMO);

  // KPIs globaux
  const withBoth = sitesData.filter(x => x.pct !== null && x.gmoAvg !== null);
  // avgPMS = même calcul que la vue d'ensemble : pmsWeightedScore sur tous les records du mois
  const allRecsCompare = _records.filter(r => {
    if (siteFilter && r.site_id !== siteFilter) return false;
    if (secteurFilter) { const s=_sites.find(x=>x.code===r.site_id); if(!s||s.sector_id!==secteurFilter) return false; }
    return r.recorded_at?.startsWith(moisFilter);
  });
  const avgPMS  = pmsWeightedScore(allRecsCompare);
  const avgGMO  = withBoth.length ? Math.round(withBoth.reduce((s,x)=>s+x.gmoAvg,0)/withBoth.length) : null;
  const sitesOK = withBoth.filter(x => Math.abs(x.gmoAvg - x.pct) <= 15).length;
  const sitesAlert = withBoth.filter(x => x.gmoAvg < 70 || x.pct < 70).length;

  let html = `
  <style>
    .compare-kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:18px; }
    @media(max-width:700px){ .compare-kpis { grid-template-columns:1fr 1fr; } }
    .compare-kpi { background:#fff; border:1px solid var(--border); border-radius:14px; padding:14px; text-align:center; }
    .compare-kpi-val { font-size:1.6rem; font-weight:900; }
    .compare-kpi-label { font-size:.68rem; color:var(--muted); font-weight:700; margin-top:3px; text-transform:uppercase; letter-spacing:.3px; }
    .compare-axe-bars { display:flex; gap:4px; flex-wrap:wrap; margin-top:5px; }
    .compare-axe-chip { font-size:.6rem; font-weight:700; padding:2px 6px; border-radius:5px; }
  </style>

  <div style="margin-bottom:12px;padding:10px 16px;background:#fff;border-radius:10px;border:1px solid var(--border);font-size:.8rem;color:var(--muted)">
    Période : <strong style="color:var(--text)">${moisFilter}</strong> — Utilisez le filtre mois pour changer la période
  </div>

  <div class="compare-kpis">
    <div class="compare-kpi">
      <div class="compare-kpi-val" style="color:${avgPMS!==null?gmoColor(avgPMS):'#a0aec0'}">${avgPMS!==null?avgPMS+'%':'—'}</div>
      <div class="compare-kpi-label">Conformité PMS moy.</div>
    </div>
    <div class="compare-kpi">
      <div class="compare-kpi-val" style="color:${avgGMO!==null?gmoColor(avgGMO):'#a0aec0'}">${avgGMO!==null?avgGMO+'%':'—'}</div>
      <div class="compare-kpi-label">Score GMO moy.</div>
    </div>
    <div class="compare-kpi">
      <div class="compare-kpi-val" style="color:#38a169">${sitesOK}</div>
      <div class="compare-kpi-label">Sites cohérents (écart ≤15pts)</div>
    </div>
    <div class="compare-kpi">
      <div class="compare-kpi-val" style="color:#e53e3e">${sitesAlert}</div>
      <div class="compare-kpi-label">Sites en alerte (&lt;70%)</div>
    </div>
  </div>

  <div class="table-card"><div class="table-wrap"><table>
  <thead><tr>
    <th>Site</th>
    <th>Secteur</th>
    <th>Saisies</th>
    <th>Conformité PMS</th>
    <th>Score GMO</th>
    <th>Écart</th>
    <th>Axes GMO</th>
  </tr></thead><tbody>`;

  if (sitesData.length === 0) {
    html += `<tr><td colspan="7" style="text-align:center;color:#718096;padding:24px">Aucune donnée sur cette période</td></tr>`;
  }

  sitesData.forEach(({site, nb, pct, gmoAvg, axeScores, gmoObs, hasGMO}) => {
    // Trouver le GMO de ce site pour ce mois (pour le clic)
    const siteGMOObj = _gmos.find(g => g.site_id === site.id && g.visit_date?.startsWith(moisFilter));
    const sect = _sectors.find(s => s.id === site.sector_id);

    const pmsCell = pct !== null
      ? `<div class="score-wrap"><div class="score-bar"><div class="score-fill" style="width:${pct}%;background:${gmoColor(pct)}"></div></div><span class="score-val">${pct}%</span></div>`
      : `<span class="tag tag-warn">Pas de saisies</span>`;

    const gmoCell = gmoAvg !== null
      ? `<div class="score-wrap"><div class="score-bar"><div class="score-fill" style="width:${gmoAvg}%;background:${gmoColor(gmoAvg)}"></div></div><span class="score-val">${gmoAvg}%</span></div>${gmoObs?`<div style="font-size:.62rem;color:var(--muted);margin-top:3px;font-style:italic">${gmoObs.slice(0,50)}${gmoObs.length>50?'…':''}</div>`:''}`
      : `<span class="tag tag-warn">GMO manquant</span>`;

    let ecartCell = '—';
    if (pct !== null && gmoAvg !== null) {
      const diff = gmoAvg - pct;
      const sign = diff > 0 ? '+' : '';
      let ecartCls, ecartTip;
      if (Math.abs(diff) <= 15) { ecartCls='tag-ok'; ecartTip='Cohérent'; }
      else if (diff < -15) { ecartCls='tag-err'; ecartTip='PMS surestimé ?'; }
      else { ecartCls='tag-warn'; ecartTip='GMO surestimé ?'; }
      ecartCell = `<span class="tag ${ecartCls}" title="${ecartTip}">${sign}${diff} pts</span>`;
    }

    // Mini chips par axe GMO (exclure les clés internes _detail, _global etc)
    let axeChips = '';
    if (axeScores) {
      const axeEntries = Object.entries(axeScores).filter(([k,v]) =>
        !k.startsWith('_') && typeof v === 'number' && !isNaN(v)
      );
      if (axeEntries.length > 0) {
        axeChips = `<div class="compare-axe-bars">${
          axeEntries.map(([k,v]) => {
            const axe = GMO_AXES.find(a => a.key === k);
            if (!axe) return '';
            const pct = Math.round(v);
            const col = gmoColor(pct);
            const bg = pct>=85?'#f0fff4':pct>=70?'#fffbeb':'#fff5f5';
            return `<span class="compare-axe-chip" style="background:${bg};color:${col}" title="${axe.label}">${axe.icon} ${pct}%</span>`;
          }).filter(Boolean).join('')
        }</div>`;
      }
    }

    const trClick = siteGMOObj ? `onclick="openGMODetail('${siteGMOObj.id}')" style="cursor:pointer;transition:background .15s" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''"` : '';
    html += `<tr ${trClick}>
      <td><span class="site-badge"><span class="site-dot"></span>${site.name}<br><small style="color:#718096">${site.code}</small></span></td>
      <td style="color:var(--muted);font-size:.8rem">${sect?.name||'—'}</td>
      <td style="font-family:var(--mono)">${nb}</td>
      <td>${pmsCell}</td>
      <td>${gmoCell}</td>
      <td>${ecartCell}</td>
      <td>${axeChips||'—'}</td>
    </tr>`;
  });

  html += `</tbody></table></div></div>
  <div style="margin-top:14px;text-align:right">
    <button onclick="generateComparePDF()" style="padding:11px 20px;background:linear-gradient(135deg,var(--navy),var(--navy2));color:#fff;border:none;border-radius:11px;font-size:.85rem;font-weight:800;cursor:pointer;font-family:var(--font);display:inline-flex;align-items:center;gap:8px;box-shadow:0 4px 14px rgba(15,34,64,.25)">
      📊 Exporter rapport comparatif PDF
    </button>
  </div>`;
  setContent(html);
}

// HELPERS
// ════════════════════════════════════════════════════
function hasPhoto(r) {
  const d = r.data||{};
  const hasPic = PHOTO_FIELDS.some(k => {
    if (!d[k]) return false;
    try { const o=JSON.parse(d[k]); return !!(o.url||o.thumb||o.thumb_url); } catch { return false; }
  });
  if (hasPic) return true;
  // Inclure les signatures canvas
  return !!(d.signature && d.signature.startsWith('data:image'));
}

function openPhotoFromRecord(id) {
  const r = _records.find(x=>x.id===id);
  if (!r) return;
  const d = r.data||{};
  for (const field of PHOTO_FIELDS) {
    if (!d[field]) continue;
    try { const o=JSON.parse(d[field]); const url=o.url||o.thumb_url||o.thumb; if(url){openLightbox(url);return;} } catch {}
  }
}

function openLightbox(url) {
  document.getElementById('lightbox-img').src = url;
  document.getElementById('lightbox').classList.add('open');
}
function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
  document.getElementById('lightbox-img').src='';
}

// ════════════════════════════════════════════════════
// PAGES ENR DÉDIÉES — moteur générique
// ════════════════════════════════════════════════════


// Table de secours ENR28 : ref_id → {zone, materiel, produit}
const NETT_REF_FALLBACK = {
  n01:{zone:'Cuisine chaude',materiel:'Plans de travail',produit:'Dégraissant alimentaire'},
  n02:{zone:'Cuisine chaude',materiel:'Plancha / grill',produit:'Dégraissant haute température'},
  n03:{zone:'Cuisine chaude',materiel:'Fours',produit:'Dégraissant four'},
  n04:{zone:'Cuisine chaude',materiel:'Marmites / casseroles',produit:'Liquide vaisselle'},
  n05:{zone:'Cuisine chaude',materiel:'Sol',produit:'Désinfectant sol'},
  n06:{zone:'Cuisine chaude',materiel:'Hottes / filtres',produit:'Dégraissant'},
  n07:{zone:'Cuisine chaude',materiel:'Murs / carrelage',produit:'Désinfectant surfaces'},
  n08:{zone:'Cuisine froide',materiel:'Plans de travail',produit:'Désinfectant surfaces'},
  n09:{zone:'Cuisine froide',materiel:'Trancheuse',produit:'Désinfectant alimentaire'},
  n10:{zone:'Cuisine froide',materiel:'Couteaux / ustensiles',produit:'Liquide vaisselle + désinfection'},
  n11:{zone:'Cuisine froide',materiel:'Sol',produit:'Désinfectant sol'},
  n12:{zone:'Légumerie',materiel:'Plans de travail',produit:'Désinfectant surfaces'},
  n13:{zone:'Légumerie',materiel:'Éplucheuse',produit:'Désinfectant alimentaire'},
  n14:{zone:'Légumerie',materiel:'Bacs / éviers',produit:'Désinfectant'},
  n15:{zone:'Légumerie',materiel:'Sol',produit:'Désinfectant sol'},
  n16:{zone:'Plonge',materiel:'Lave-vaisselle',produit:'Produit machine'},
  n17:{zone:'Plonge',materiel:'Bacs trempage',produit:'Désinfectant'},
  n18:{zone:'Plonge',materiel:'Sol',produit:'Désinfectant sol'},
  n19:{zone:'Enceintes froides',materiel:'Réfrigérateurs — étagères',produit:'Désinfectant alimentaire'},
  n20:{zone:'Enceintes froides',materiel:'Congélateurs — étagères',produit:'Désinfectant alimentaire'},
  n21:{zone:'Enceintes froides',materiel:'Joints de portes',produit:'Désinfectant'},
  n22:{zone:'Réception',materiel:'Tables / plans de réception',produit:'Désinfectant surfaces'},
  n23:{zone:'Réception',materiel:'Sol',produit:'Désinfectant sol'},
  n24:{zone:'Local déchets',materiel:'Bacs poubelles',produit:'Désinfectant + eau chaude'},
  n25:{zone:'Local déchets',materiel:'Sol',produit:'Désinfectant sol'},
  n26:{zone:'Sanitaires',materiel:'WC / lavabos',produit:'Désinfectant sanitaire'},
  n27:{zone:'Sanitaires',materiel:'Sol',produit:'Désinfectant sol'},
  n28z:{zone:'Distribution',materiel:'Chariots / bacs',produit:'Désinfectant alimentaire'},
  n29:{zone:'Distribution',materiel:'Sol',produit:'Désinfectant sol'},
  n30:{zone:'Général',materiel:'Poignées de portes',produit:'Désinfectant'},
  n31:{zone:'Général',materiel:'Murs / carrelage',produit:'Désinfectant surfaces'},
};
function _siteNettMap(siteCode){
  const map = {...NETT_REF_FALLBACK};
  const site = getSiteByCode(siteCode);
  const cfg = (site && site.config && typeof site.config==='object') ? site.config : {};
  const list = Array.isArray(cfg.nett_ref) ? cfg.nett_ref : [];
  list.forEach(it=>{
    const id = String(it?.id||'').trim();
    if(!id) return;
    map[id] = {
      zone: String(it?.zone||'').trim(),
      materiel: String(it?.materiel||'').trim(),
      produit: String(it?.produit||'').trim(),
    };
  });
  return map;
}
function _nettRefLookup(refId, siteCode){
  if(!refId) return null;
  const map = _siteNettMap(siteCode);
  return map[refId] || null;
}
function nettLabel(refId, siteCode=''){
  const ref=_nettRefLookup(refId, siteCode);
  if(!ref)return refId;
  return ref.zone+' — '+ref.materiel;
}
function nettZone(refId, siteCode=''){return _nettRefLookup(refId, siteCode)?.zone||refId;}
function nettMateriel(refId, siteCode=''){return _nettRefLookup(refId, siteCode)?.materiel||refId;}
function nettProduit(refId, siteCode=''){return _nettRefLookup(refId, siteCode)?.produit||'';}

const PAGE_ENR_CFG = {
  reception: {
    ico:'📦', title:'Réceptions marchandises — ENR23',
    desc:'Contrôle à réception : fournisseur, températures, lots, DLC, photos',
    enrTypes:['enr23'],
    colonnes:[
      {key:'date',        label:'Date',          mono:true},
      {key:'fournisseur', label:'Fournisseur',    bold:true},
      {key:'p1_produit',  label:'Produit 1',      bold:true},
      {key:'p1_tc',       label:'T° P1',          temp:true},
      {key:'p1_lot',      label:'Lot P1'},
      {key:'p1_dlc',      label:'DLC P1',         mono:true},
      {key:'p2_produit',  label:'Produit 2'},
      {key:'p2_tc',       label:'T° P2',          temp:true},
      {key:'p2_lot',      label:'Lot P2'},
      {key:'p2_dlc',      label:'DLC P2',         mono:true},
      {key:'vehicule',    label:'Véhicule'},
      {key:'conforme',    label:'Conforme'},
      {key:'cuisinier',   label:'Agent'},
    ],
    photoFields:['p1_photo','p2_photo'],
    confFields:['conforme'],
    cardTitle: r => r.data?.fournisseur || '—',
    cardSub:   r => {
      const d=r.data||{};
      return [d.p1_produit,d.p2_produit].filter(Boolean).join(' · ') || '';
    },
  },
  tracabilite: {
    ico:'📋', title:'Traçabilité Matières Premières — ENR31',
    desc:'Suivi des matières premières : lots, DLC, estampilles, photos étiquettes',
    enrTypes:['enr31'],
    colonnes:[
      {key:'date',        label:'Date',          mono:true},
      {key:'produit',     label:'Produit',       bold:true},
      {key:'fournisseur', label:'Fournisseur'},
      {key:'lot',         label:'N° Lot',        mono:true},
      {key:'dlc',         label:'DLC/DDM',       mono:true},
      {key:'estampille',  label:'Estampille'},
      {key:'tc',          label:'T° réception',  temp:true},
      {key:'cuisinier',   label:'Agent'},
    ],
    photoFields:['photo','photo2','photo3'],
    confFields:['conforme'],
    cardTitle: r => r.data?.produit || '—',
    cardSub:   r => {
      const d=r.data||{};
      return [d.fournisseur, d.lot?'Lot:'+d.lot:'', d.dlc?'DLC:'+d.dlc:''].filter(Boolean).join(' · ');
    },
  },
  ccp: {
    ico:'❄️', title:'CCP — Refroidissement & Remise en T°C',
    desc:'Points critiques : ENR01 Refroidissement, ENR02 Remise T°C, ENR03 Combiné',
    enrTypes:['enr01','enr02','enr03'],
    colonnes:[
      {key:'date',        label:'Date',             mono:true},
      {key:'produit',     label:'Produit',           bold:true},
      // ENR01 refroidissement
      {key:'h_ref_deb',   label:'H. début refroid.', mono:true},
      {key:'t_ref_deb',   label:'T° début refroid.', temp:true},
      {key:'h_ref_fin',   label:'H. fin refroid.',   mono:true},
      {key:'t_ref_fin',   label:'T° fin refroid.',   temp:true, conf:'conf_r'},
      {key:'duree_r',     label:'Durée refroid.',    mono:true},
      // ENR02 remise
      {key:'h_deb',       label:'H. début remise',   mono:true},
      {key:'t_deb',       label:'T° début remise',   temp:true, conf:'conf_deb'},
      {key:'h_fin',       label:'H. fin remise',     mono:true},
      {key:'t_fin',       label:'T° fin remise',     temp:true, conf:'conforme'},
      // ENR08 BF/TM
      {key:'h1',          label:'H. début',          mono:true},
      {key:'t1',          label:'T° début',          temp:true, conf:'conf1'},
      {key:'h2',          label:'H. fin',            mono:true},
      {key:'t2',          label:'T° fin',            temp:true, conf:'conf2'},
      {key:'cuisinier',   label:'Cuisinier'},
    ],
    photoFields:[],
    confFields:['conf_r','conf_rt','conforme','conf_deb','conf1','conf2'],
    cardTitle: r => r.data?.produit || '—',
    cardSub:   r => {
      const d=r.data||{};
      const enrL = ENR_LABELS[r.enr_type]||r.enr_type?.toUpperCase()||'';
      const temps = [
        d.t_ref_fin && `Refroid.fin:${d.t_ref_fin}°C`,
        d.t_fin     && `Remise:${d.t_fin}°C`,
        d.t2        && `T2:${d.t2}°C`,
      ].filter(Boolean).join(' · ');
      return [enrL, temps].filter(Boolean).join(' — ');
    },
  },
  temperatures: {
    ico:'🌡️', title:'Températures & Stockage',
    desc:'Relevés ENR19 enceintes (quotidien) et ENR27 contrôle afficheurs (hebdo)',
    enrTypes:['enr19','enr20','enr21','enr27','enr26'],
    colonnes:[
      {key:'date',      label:'Date',           mono:true},
      {key:'heure',     label:'Heure',          mono:true},
      // ENR19
      {key:'enc_id',    label:'Enceinte',       bold:true},
      {key:'moment',    label:'Moment'},
      {key:'temp',      label:'Température',    temp:true},
      // ENR27 afficheurs
      {key:'enceinte',  label:'Enceinte',       bold:true},
      {key:'t_ext',     label:'T° afficheur',   temp:true},
      {key:'t_int',     label:'T° thermomètre', temp:true},
      {key:'ecart',     label:'Écart',          mono:true},
      {key:'conf',      label:'Conforme'},
      {key:'cuisinier', label:'Agent'},
    ],
    photoFields:[],
    confFields:['conforme','conf'],
    cardTitle: r => {
      const d=r.data||{};
      return d.enc_id || d.enceinte || d.nom || r.enr_type?.toUpperCase() || '—';
    },
    cardSub: r => {
      const d=r.data||{};
      const moment = d.moment==='ouv'?'🌅 Ouverture':d.moment==='ferm'?'🌙 Fermeture':d.moment==='aprem'?'☀️ Après-midi':d.moment==='midi'?'☀️ Midi':d.moment||'';
      const temp = d.temp?`${d.temp}°C`:d.t_ext?`Aff:${d.t_ext}°C / Therm:${d.t_int||'?'}°C`:'';
      return [moment,temp].filter(Boolean).join(' · ');
    },
  },
  nettoyage: {
    ico:'🧹', title:'Nettoyage & Désinfection — ENR28',
    desc:'Validation journalière du plan de nettoyage par zone',
    enrTypes:['enr28'],
    colonnes:[
      {key:'date',        label:'Date',           mono:true},
      {key:'heure',       label:'Heure',          mono:true},
      {key:'ref_id',      label:'Zone / Matériel', bold:true},
      {key:'conforme',    label:'Résultat'},
      {key:'commentaire', label:'Commentaire'},
      {key:'cuisinier',   label:'Agent'},
    ],
    photoFields:['photo_nc'],
    confFields:['conforme'],
    cardTitle: r => {
      const d=r.data||{};
      const mat = d.materiel || nettMateriel(d.ref_id||'', r.site_id);
      const zone = d.zone || nettZone(d.ref_id||'', r.site_id);
      return mat && zone ? `${mat} — ${zone}` : mat||zone||nettLabel(d.ref_id||'', r.site_id)||'—';
    },
    cardSub: r => r.data?.commentaire || '',
  },
  nuisibles: {
    ico:'🐀', title:'Contrôle Nuisibles',
    desc:'Vérification quotidienne de présence de nuisibles par zone',
    enrTypes:['nuisibles_val'],
    colonnes:[
      {key:'date',      label:'Date',       mono:true},
      {key:'heure',     label:'Heure',      mono:true},
      {key:'zone',      label:'Zone',       bold:true},
      {key:'presence',  label:'Présence'},
      {key:'action',    label:'Action corrective'},
      {key:'cuisinier', label:'Agent'},
    ],
    photoFields:[],
    confFields:['presence'],
    cardTitle: r => r.data?.zone ? `🐀 ${r.data.zone}` : '🐀 Nuisibles',
    cardSub: r => {
      const d=r.data||{};
      if(d.presence==='OUI') return `⚠️ Présence — ${d.action||''}`;
      return d.presence==='NON' ? '✅ Aucun nuisible' : '';
    },
  },
  cuisson: {
    ico:'🥘', title:'Cuisson & Distribution — ENR04 à 18 + T°C Distribution',
    desc:'Contrôles de cuisson, conditionnement chaud/froid, distribution Midi & Soir',
    enrTypes:['enr04','enr05','enr06','enr07','enr08','enr09','enr10',
               'enr11','enr12','enr13','enr14','enr15','enr16','enr17','enr18','enr52',
               'enr_tc_distrib'],  // enr_distrib_* ajoutés dynamiquement dans renderPageENR
    colonnes:[
      {key:'date',              label:'Date',           mono:true},
      {key:'heure',             label:'Heure',          mono:true},
      {key:'produit',           label:'Produit',        bold:true},
      {key:'type',              label:'Type'},
      // ENR cuisson
      {key:'tc',                label:'T° cœur',        temp:true, conf:'conforme'},
      {key:'t1',                label:'T° début',       temp:true, conf:'conf1'},
      {key:'t2',                label:'T° fin',         temp:true, conf:'conf2'},
      {key:'t_ref_deb',         label:'T° ref. début',  temp:true},
      {key:'t_ref_fin',         label:'T° ref. fin',    temp:true, conf:'conf_couple'},
      {key:'t_premier',         label:'T° 1er',         temp:true, conf:'conf_premier'},
      {key:'t_fin',             label:'T° fin',         temp:true, conf:'conf_fin'},
      {key:'t_glac',            label:'T° glacière',    temp:true, conf:'conf_glac'},
      {key:'t_prod',            label:'T° produit',     temp:true, conf:'conf_prod'},
      {key:'t_f',               label:'T° froid',       temp:true, conf:'conf_f'},
      {key:'t_c',               label:'T° chaud',       temp:true, conf:'conf_c'},
      {key:'satellite',         label:'Satellite'},
      // ENR distribution T°C
      {key:'midi_froid_temp',   label:'🌞 Froid Midi',  temp:true},
      {key:'midi_chaud_temp',   label:'🌞 Chaud Midi',  temp:true},
      {key:'soir_froid_temp',   label:'🌙 Froid Soir',  temp:true},
      {key:'soir_chaud_temp',   label:'🌙 Chaud Soir',  temp:true},
      {key:'midi_froid_plat',   label:'Plat froid midi'},
      {key:'midi_chaud_plat',   label:'Plat chaud midi'},
      {key:'soir_froid_plat',   label:'Plat froid soir'},
      {key:'soir_chaud_plat',   label:'Plat chaud soir'},
      {key:'cuisinier',         label:'Cuisinier'},
    ],
    photoFields:[],
    confFields:['conforme','conf1','conf2','conf_couple','conf_premier','conf_fin','conf_f','conf_c','conf_glac','conf_prod',
                'midi_froid_conf','midi_chaud_conf','soir_froid_conf','soir_chaud_conf'],
    cardTitle: r => {
      const d=r.data||{};
      if(r.enr_type==='enr_tc_distrib'||r.enr_type?.startsWith('enr_distrib_')){
        const svc=r.enr_type.replace('enr_distrib_','').replace('enr_tc_distrib','Distribution');
        return svc.charAt(0).toUpperCase()+svc.slice(1);
      }
      return d.produit || d.type || d.satellite || '—';
    },
    cardSub: r => {
      const d=r.data||{};
      if(r.enr_type==='enr_tc_distrib'||r.enr_type?.startsWith('enr_distrib_')){
        const parts=[];
        if(d.midi_froid_temp) parts.push('🌞F:'+d.midi_froid_temp+'°C');
        if(d.midi_chaud_temp) parts.push('🌞C:'+d.midi_chaud_temp+'°C');
        if(d.soir_froid_temp) parts.push('🌙F:'+d.soir_froid_temp+'°C');
        if(d.soir_chaud_temp) parts.push('🌙C:'+d.soir_chaud_temp+'°C');
        return parts.join(' · ') || (d.midi_valide==='OUI'&&d.soir_valide==='OUI'?'✅ Complet':'⏳ En cours');
      }
      return ENR_LABELS[r.enr_type] || r.enr_type?.toUpperCase() || '';
    },
  },
  suivi: {
    ico:'📋', title:'Maintenance, Labo & Allergènes',
    desc:'Plan de maintenance équipements (ENR24), contrôles microbiologiques (ENR25), déclaration allergènes INCO 1169/2011 (ENR-ALG)',
    enrTypes:['enr24','enr25','enr_allergenes'],
    colonnes:[
      {key:'date',          label:'Date',         mono:true},
      {key:'heure',         label:'Heure',        mono:true},
      {key:'equipement',    label:'Équipement',   bold:true},
      {key:'type_maint',    label:'Type maint.'},
      {key:'type_analyse',  label:'Type analyse'},
      {key:'zone_produit',  label:'Zone/Produit', bold:true},
      {key:'plat',          label:'Plat/Menu',    bold:true},
      {key:'laboratoire',   label:'Laboratoire'},
      {key:'intervenant',   label:'Intervenant'},
      {key:'resultats',     label:'Résultats'},
      {key:'observations',  label:'Observations'},
      {key:'conforme',      label:'Conforme'},
      {key:'cuisinier',     label:'Agent'},
    ],
    photoFields:[],
    confFields:['conforme'],
    cardTitle: function(r) {
      var d=r.data||{};
      if(r.enr_type==='enr24') return d.equipement || 'Équipement';
      if(r.enr_type==='enr25') return d.zone_produit || 'Prélèvement';
      if(r.enr_type==='enr_allergenes') return d.plat || 'Fiche allergènes';
      return ENR_LABELS[r.enr_type] || r.enr_type || '—';
    },
    cardSub: function(r) {
      var d=r.data||{};
      if(r.enr_type==='enr24') {
        var parts=[];
        if(d.type_maint) parts.push(d.type_maint);
        if(d.intervenant) parts.push(d.intervenant);
        return parts.join(' · ');
      }
      if(r.enr_type==='enr25') {
        var parts=[];
        if(d.type_analyse) parts.push(d.type_analyse);
        if(d.laboratoire) parts.push(d.laboratoire);
        return parts.join(' · ');
      }
      if(r.enr_type==='enr_allergenes') {
        var ALLERGEN_KEYS=['alg_gluten','alg_crustaces','alg_oeufs','alg_poisson','alg_arachides',
          'alg_soja','alg_lait','alg_fruits_coq','alg_celeri','alg_moutarde','alg_sesame',
          'alg_so2','alg_lupin','alg_mollusques'];
        var nb=ALLERGEN_KEYS.filter(function(k){return d[k]==='Présent';}).length;
        var tr=ALLERGEN_KEYS.filter(function(k){return d[k]==='Traces';}).length;
        if(nb>0) return '⚠️ '+nb+' allergène(s) présent(s)'+(tr>0?' + '+tr+' trace(s)':'');
        if(tr>0) return '〰️ '+tr+' trace(s) seulement';
        return '✅ Aucun allergène déclaré';
      }
      return '';
    },
  },
};


// ════════════════════════════════════════════════════════════════
// MODE CANICULE DASHBOARD
// ════════════════════════════════════════════════════════════════

function printTempPDF(){
  const f=getFilters();
  const mois=f.mois||new Date().toISOString().slice(0,7);
  const siteFilter=f.site||null;
  const [y,m]=mois.split('-').map(Number);
  const now=new Date();
  const isCurrentMonth=(y===now.getFullYear()&&m===now.getMonth()+1);
  const nbDays=isCurrentMonth?now.getDate():new Date(y,m,0).getDate();
  const days=[];
  for(var d=1;d<=nbDays;d++) days.push(String(d).padStart(2,'0'));
  const sitesIds=siteFilter?[siteFilter]:[...new Set(_records.filter(r=>r.enr_type==='enr19').map(r=>r.site_id))];

  // ── Pré-calcul : pour chaque jour, savoir si un relevé "aprem/midi" existe ──
  // Cela permet d'avoir des colonnes dynamiques par jour
  // Un jour est "canicule" si au moins un relevé aprem/midi existe ce jour-là
  function buildDayCanicule(siteRecs){
    var map={};
    siteRecs.forEach(function(r){
      if(r.data&&(r.data.moment==='aprem'||r.data.moment==='midi')){
        map[r.data.date||'']=true;
      }
    });
    return map; // { 'YYYY-MM-DD': true }
  }

  var body='';
  sitesIds.forEach(function(siteId){
    var encConfig=_encConfigs[siteId];
    var enceintes=(encConfig&&encConfig.data)||[];
    if(!enceintes.length){
      var encIds=[...new Set(_records.filter(r=>r.enr_type==='enr19'&&r.site_id===siteId).map(r=>r.data&&r.data.enc_id).filter(Boolean))];
      enceintes=encIds.map(function(id){return{id:id,label:id};});
    }
    if(!enceintes.length)return;
    // Inclure ENR19 + ENR20 pour le PDF (ENR21 = ponctuel, dans rapport séparé)
    var siteRecs=_records.filter(function(r){return (r.enr_type==='enr19'||r.enr_type==='enr20')&&r.site_id===siteId;});
    var siteName=_siteName(siteId)||siteId;

    // Calcul canicule par jour
    var dayCanicule=buildDayCanicule(siteRecs);

    // Légende canicule
    var hasAnyCan=Object.keys(dayCanicule).length>0;

    body+='<h2 style="margin:20px 0 8px;font-size:14px;color:#1a1a2e">'+escH(siteName)+'</h2>';
    if(hasAnyCan){
      body+='<div style="font-size:9px;color:#c2410c;background:#fff7ed;border:1px solid #fed7aa;border-radius:4px;padding:3px 8px;margin-bottom:6px;display:inline-block">☀️ Mode canicule actif certains jours — colonnes à 3 relevés (Ouv. / Midi / Ferm.)</div>';
    }
    body+='<table><thead><tr><th style="min-width:110px">Enceinte</th>';

    // En-têtes colonnes jours — ☀️ si jour canicule
    days.forEach(function(d){
      var date=mois+'-'+d;
      var wd=new Date(date+'T12:00').toLocaleDateString('fr-FR',{weekday:'short'});
      var isCan=!!dayCanicule[date];
      body+='<th style="'+(isCan?'background:#fff7ed;color:#92400e':'')+'">'+wd+'<br><span style="font-weight:400;font-size:9px">'+d+(isCan?'<br>☀️':'')+'</span></th>';
    });
    body+='</tr></thead><tbody>';

    enceintes.forEach(function(enc){
      body+='<tr><td style="font-weight:700;white-space:nowrap">'+escH(enc.label||enc.id)+'</td>';

      days.forEach(function(d){
        var date=mois+'-'+d;
        var isCan=!!dayCanicule[date];
        var ouv=siteRecs.find(function(r){return r.data&&r.data.enc_id===enc.id&&r.data.date===date&&r.data.moment==='ouv';});
        var ferm=siteRecs.find(function(r){return r.data&&r.data.enc_id===enc.id&&r.data.date===date&&r.data.moment==='ferm';});
        var aprem=isCan?siteRecs.find(function(r){return r.data&&r.data.enc_id===enc.id&&r.data.date===date&&(r.data.moment==='aprem'||r.data.moment==='midi');}):null;

        var tO=ouv&&ouv.data&&ouv.data.temp!=null?parseFloat(ouv.data.temp):null;
        var tF=ferm&&ferm.data&&ferm.data.temp!=null?parseFloat(ferm.data.temp):null;
        var tA=aprem&&aprem.data&&aprem.data.temp!=null?parseFloat(aprem.data.temp):null;

        var ncO=ouv?isNC(ouv):false;
        var ncF=ferm?isNC(ferm):false;
        var ncA=aprem?isNC(aprem):false;
        var nc=ncO||ncF||ncA;

        // Complet = tous les relevés attendus sont présents
        var expected=(ouv||ferm)?( isCan ? 3 : 2 ) : 0;
        var got=(tO!==null?1:0)+(tF!==null?1:0)+(isCan&&tA!==null?1:0);
        var missing=!ouv&&!ferm&&(!isCan||!aprem);
        var partial=!missing&&got<(isCan?3:2);

        var bg=nc?'#fee2e2':partial?'#fffbeb':missing?'#f3f4f6':'#f0fdf4';
        var col=nc?'#991b1b':partial?'#92400e':missing?'#9ca3af':'#166534';
        var fmt=function(t){return t!==null?(t>=0?'+':'')+t.toFixed(1):'—';};

        body+='<td style="background:'+bg+';color:'+col+'">';
        body+='<span class="t-row" title="Ouverture">'+fmt(tO)+'</span>';
        if(isCan) body+='<span class="t-row aprem" title="Midi/Après-midi">'+fmt(tA)+'</span>';
        body+='<span class="t-row" title="Fermeture">'+fmt(tF)+'</span>';
        body+='</td>';
      });

      body+='</tr>';
    });

    body+='</tbody></table>';
  });


  const moisLabel=new Date(mois+'-01T12:00').toLocaleDateString('fr-FR',{month:'long',year:'numeric'});
  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8">
  <title>Températures — ${moisLabel}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:Arial,sans-serif;font-size:10px;padding:10px;}
    h1{font-size:14px;color:#1a1a2e;margin-bottom:3px;}
    .sub{font-size:10px;color:#666;margin-bottom:10px;}
    table{border-collapse:collapse;width:100%;margin-bottom:16px;table-layout:fixed;}
    col.enc-col{width:110px;}
    th,td{border:1px solid #ccc;text-align:center;vertical-align:middle;overflow:hidden;}
    th{background:#1a1a2e;color:#fff;font-size:8px;padding:3px 1px;line-height:1.3;}
    th:first-child{text-align:left;padding-left:6px;}
    td{padding:0;font-size:8.5px;font-weight:600;}
    td:first-child{text-align:left;padding:3px 4px;font-size:9px;font-weight:700;background:#f8f8f8;}
    .t-row{display:block;padding:2px 1px;line-height:1.2;}
    .t-row+.t-row{border-top:1px solid rgba(0,0,0,.1);}
    .t-row.aprem{font-style:italic;}
    .legend{display:flex;gap:10px;flex-wrap:wrap;font-size:9px;margin-bottom:8px;align-items:center;}
    .leg{display:flex;align-items:center;gap:3px;}
    .leg-box{width:12px;height:12px;border-radius:2px;border:1px solid rgba(0,0,0,.15);}
    .no-print{margin-bottom:10px;display:flex;gap:8px;}
    h2{font-size:12px;color:#1a1a2e;margin:12px 0 6px;font-weight:900;}
    @media print{
      .no-print{display:none!important;}
      body{padding:4px;}
      @page{size:A4 landscape;margin:8mm 6mm;}
    }
  </style></head><body>
  <div class="no-print">
    <button onclick="window.print()" style="background:#1a1a2e;color:#fff;border:none;padding:9px 18px;border-radius:8px;font-size:13px;cursor:pointer;font-weight:bold">🖨️ Imprimer</button>
    <button onclick="window.close()" style="background:#eee;color:#333;border:1px solid #ccc;padding:9px 18px;border-radius:8px;font-size:13px;cursor:pointer">✕ Fermer</button>
  </div>
  <h1>🌡️ Relevés de températures</h1>
  <div class="sub">${moisLabel}${siteFilter?' — '+escH(_siteName(siteFilter)||siteFilter):''} · Généré le ${new Date().toLocaleDateString('fr-FR')}</div>
  <div class="legend">
    <div class="leg"><div class="leg-box" style="background:#f0fdf4;border:1px solid #86efac"></div> Complet OK</div>
    <div class="leg"><div class="leg-box" style="background:#fffbeb;border:1px solid #fde68a"></div> Partiel</div>
    <div class="leg"><div class="leg-box" style="background:#fee2e2;border:1px solid #fca5a5"></div> NC T°C</div>
    <div class="leg"><div class="leg-box" style="background:#f3f4f6;border:1px solid #d1d5db"></div> Non relevé</div>
  </div>
  <div style="font-size:9px;color:#888;margin-bottom:12px">Ligne du haut = Ouverture · Ligne du bas = Fermeture · <span style="color:#c2410c">☀️ Colonne orange = jour canicule (3 relevés : Ouv. / Midi / Ferm.)</span></div>
  ${body||'<p style="color:#888">Aucune donnée pour cette période.</p>'}
  </body></html>`;

  const w=window.open('','_blank','width=1100,height=750');
  if(w){w.document.write(html);w.document.close();}
  else alert('Autorisez les popups pour imprimer');
}
function renderPageENR(type) {
  const cfg = PAGE_ENR_CFG[type];
  if (!cfg) return;

  const f = getFilters();
  // Pour cuisson : inclure aussi les enr_distrib_* (services distribution dynamiques)
  let recs;
  if (type === 'cuisson') {
    recs = _records.filter(r =>
      cfg.enrTypes.includes(r.enr_type) ||
      (r.enr_type && r.enr_type.startsWith('enr_distrib_'))
    );
  } else {
    recs = _records.filter(r => cfg.enrTypes.includes(r.enr_type));
  }
  if (f.mois) recs = recs.filter(r => r.recorded_at?.startsWith(f.mois));
  if (f.site) recs = recs.filter(r => r.site_id === f.site);
  recs.sort((a,b) => b.recorded_at?.localeCompare(a.recorded_at||'')||0);

  const nb  = recs.length;
  const nc  = recs.filter(r => isNC(r)).length;
  const pct = nb > 0 ? Math.round((1-nc/nb)*100) : 100;
  const col = pct>=90?'#16a34a':pct>=75?'#d97706':'var(--red)';

  let html = `
  <div class="pg-header">
    <div class="pg-header-ico">${cfg.ico}</div>
    <div class="pg-header-info">
      <div class="pg-header-title">${cfg.title}</div>
      <div class="pg-header-sub">${cfg.desc}</div>
    </div>
    <div class="pg-stat">
      <div class="pg-stat-val">${nb}</div>
      <div class="pg-stat-lbl">Saisies</div>
    </div>
    <div class="pg-stat">
      <div class="pg-stat-val" style="color:${col}">${pct}%</div>
      <div class="pg-stat-lbl">Conformité</div>
    </div>
    <div class="pg-stat">
      <div class="pg-stat-val" style="color:var(--red)">${nc}</div>
      <div class="pg-stat-lbl">NC</div>
    </div>
  </div>`;

  // Vue par site si plusieurs
  const sitesPresents = [...new Set(recs.map(r=>r.site_id))];

  if (nb === 0) {
    html += `<div class="empty"><div class="empty-ico">${cfg.ico}</div>Aucune saisie pour cette période / ce site</div>`;
    setContent(html);
    return;
  }

  // Switcher vue cartes / tableau
  html += `
  <div style="display:flex;gap:8px;margin-bottom:14px;align-items:center">
    <span style="font-size:.75rem;font-weight:700;color:var(--muted)">${nb} enregistrement(s)</span>
    <div style="margin-left:auto;display:flex;gap:6px">
      <button onclick="_pgSetView('${type}','cards')" id="pg-btn-cards-${type}"
        style="padding:6px 12px;border-radius:8px;font-size:.75rem;font-weight:700;cursor:pointer;border:1.5px solid var(--navy);background:var(--navy);color:#fff;font-family:var(--font)">
        ⊞ Cartes
      </button>
      <button onclick="_pgSetView('${type}','table')" id="pg-btn-table-${type}"
        style="padding:6px 12px;border-radius:8px;font-size:.75rem;font-weight:700;cursor:pointer;border:1.5px solid var(--border);background:#fff;color:var(--muted);font-family:var(--font)">
        ☰ Tableau
      </button>
    </div>
  </div>
  <div id="pg-content-${type}">`;

  // Rendu cartes (défaut)
  html += _renderCardsForType(type, cfg, recs);
  html += `</div>`;

  setContent(html);
}

function _pgSetView(type, view) {
  const cfg = PAGE_ENR_CFG[type];
  const f = getFilters();
  let recs = _records.filter(r => cfg.enrTypes.includes(r.enr_type));
  if (f.mois) recs = recs.filter(r => r.recorded_at?.startsWith(f.mois));
  if (f.site) recs = recs.filter(r => r.site_id === f.site);
  recs.sort((a,b) => b.recorded_at?.localeCompare(a.recorded_at||'')||0);

  const container = document.getElementById(`pg-content-${type}`);
  if (!container) return;
  container.innerHTML = view==='cards'
    ? _renderCardsForType(type, cfg, recs)
    : _renderTableForType(type, cfg, recs);

  // Mettre à jour les boutons
  const bc = document.getElementById(`pg-btn-cards-${type}`);
  const bt = document.getElementById(`pg-btn-table-${type}`);
  if(bc){bc.style.background=view==='cards'?'var(--navy)':'#fff';bc.style.color=view==='cards'?'#fff':'var(--muted)';bc.style.borderColor=view==='cards'?'var(--navy)':'var(--border)';}
  if(bt){bt.style.background=view==='table'?'var(--navy)':'#fff';bt.style.color=view==='table'?'#fff':'var(--muted)';bt.style.borderColor=view==='table'?'var(--navy)':'var(--border)';}
}

function _renderCardsForType(type, cfg, recs) {
  // ENR19 : affichage spécial groupé par enceinte + jour
  if (type === 'temperatures' && recs.some(r=>r.enr_type==='enr19')) {
    const enr19 = recs.filter(r=>r.enr_type==='enr19');
    const autres = recs.filter(r=>r.enr_type!=='enr19');
    const _mBan=getFilters().mois||new Date().toISOString().slice(0,7);
    const _a=calcEnr19Assiduite(recs, _mBan);
    let html = '';
    // Boutons PDF + toggle canicule
    const _targetCan=getCaniculeScopeTarget();
    const _canStats=getCaniculeScopeStats(_targetCan.siteIds);
    const _siteIdTemp=_targetCan.scope==='site'?(_targetCan.siteIds[0]||null):null;
    const _canActive=_siteIdTemp?isSiteCanicule(_siteIdTemp):false;
    html+=`<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <button onclick="printTempPDF()" style="flex:1;min-width:180px;padding:11px;background:linear-gradient(135deg,var(--navy),#1e3a6e);color:#fff;border:none;border-radius:12px;font-size:.83rem;font-weight:800;cursor:pointer;font-family:var(--font)">
        🖨️ Tableau PDF du mois
      </button>
      ${_siteIdTemp?`<button onclick="toggleCanicule('${_siteIdTemp}',${!_canActive})" style="padding:11px 14px;border-radius:12px;border:2px solid #f59e0b;background:${_canActive?'#f59e0b':'#fff'};color:${_canActive?'#fff':'#92400e'};font-size:.83rem;font-weight:800;cursor:pointer;font-family:var(--font)">
        ☀️ Canicule ${_canActive?'ON':'OFF'}
      </button>`:(_canStats.total>0?`
      <button onclick="setCaniculeBulk(true)" ${_canStats.active===_canStats.total?'disabled':''} style="padding:11px 14px;border-radius:12px;border:2px solid #f59e0b;background:${_canStats.active===_canStats.total?'#fde68a':'#f59e0b'};color:${_canStats.active===_canStats.total?'#92400e':'#fff'};font-size:.83rem;font-weight:800;cursor:${_canStats.active===_canStats.total?'not-allowed':'pointer'};font-family:var(--font);opacity:${_canStats.active===_canStats.total?'.7':'1'}">
        ☀️ Activer (${_canStats.inactive})
      </button>
      <button onclick="setCaniculeBulk(false)" ${_canStats.active===0?'disabled':''} style="padding:11px 14px;border-radius:12px;border:2px solid #d1d5db;background:${_canStats.active===0?'#f3f4f6':'#fff'};color:#374151;font-size:.83rem;font-weight:800;cursor:${_canStats.active===0?'not-allowed':'pointer'};font-family:var(--font);opacity:${_canStats.active===0?'.7':'1'}">
        ❄️ Désactiver (${_canStats.active})
      </button>
      <div style="flex-basis:100%;font-size:.68rem;color:var(--muted);margin-top:-2px">
        Portée: ${escH(_targetCan.label)} · ${_canStats.total} cuisine(s)
      </div>`:'')}
    </div>`;

    if (_a) {
      const cA=_a.assiduite>=90?'#16a34a':_a.assiduite>=70?'#d97706':'#dc2626';
      const bgA=_a.assiduite>=90?'#f0fdf4':_a.assiduite>=70?'#fffbeb':'#fef2f2';
      const lbl=_a.assiduite>=95?'✅ Excellent':_a.assiduite>=80?'⚠️ Acceptable':'🔴 Insuffisant';
      html+=`<div style="background:${bgA};border:1.5px solid ${cA};border-radius:12px;padding:12px 14px;margin-bottom:14px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <span style="font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:${cA}">🌡️ Assiduité des relevés</span>
          <span style="font-size:1.4rem;font-weight:900;color:${cA}">${_a.assiduite}%</span>
        </div>
        <div style="background:rgba(0,0,0,.08);border-radius:8px;height:8px;margin-bottom:10px;overflow:hidden">
          <div style="height:100%;width:${_a.assiduite}%;background:${cA};border-radius:8px"></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;text-align:center;margin-bottom:8px">
          <div style="background:#fff;border-radius:8px;padding:7px">
            <div style="font-weight:900;font-size:1.1rem;color:${cA}">${_a.faits}</div>
            <div style="font-size:.6rem;color:#6b7280">relevés faits</div>
          </div>
          <div style="background:#fff;border-radius:8px;padding:7px">
            <div style="font-weight:900;font-size:1.1rem;color:#9ca3af">${_a.attendus}</div>
            <div style="font-size:.6rem;color:#6b7280">${_a.nbEnc} enc. × ${_a.nbJours}j × 2</div><div style="font-size:.58rem;color:#9ca3af">(depuis le ${_a.firstDate||'...'})</div>
          </div>
          <div style="background:#fff;border-radius:8px;padding:7px">
            <div style="font-weight:900;font-size:1.1rem;color:${_a.oublis>0?'#dc2626':'#16a34a'}">${_a.oublis}</div>
            <div style="font-size:.6rem;color:#6b7280">oubli${_a.oublis>1?'s':''}</div>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;font-size:.65rem">
          <span style="background:#fff;border-radius:6px;padding:3px 8px;font-weight:700;color:${cA}">${lbl}</span>
          <span style="background:#fff;border-radius:6px;padding:3px 8px;color:#6b7280">🌅 Ouv: ${_a.ouv}/${_a.nbEnc*_a.nbJours}</span>
          <span style="background:#fff;border-radius:6px;padding:3px 8px;color:#6b7280">🌙 Ferm: ${_a.ferm}/${_a.nbEnc*_a.nbJours}</span>
          <span style="background:#fff;border-radius:6px;padding:3px 8px;color:${_a.conformite<100?'#dc2626':'#16a34a'}">T°C conf: ${_a.conformite}%</span>
        </div>
      </div>`;
    }

    if (enr19.length > 0) {
      // Grouper par date puis par enc_id
      const byDate = {};
      enr19.forEach(r => {
        const d=r.data||{};
        const dateKey = d.date || r.recorded_at?.slice(0,10) || '—';
        if(!byDate[dateKey]) byDate[dateKey]=[];
        byDate[dateKey].push(r);
      });

      Object.keys(byDate).sort().reverse().forEach(date => {
        const dayRecs = byDate[date];
        const dateLabel = date!=='—'?new Date(date+'T12:00').toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'}):date;
        // Grouper par enceinte
        const byEnc = {};
        dayRecs.forEach(r=>{
          const enc=r.data?.enc_id||'?';
          if(!byEnc[enc]) byEnc[enc]=[];
          byEnc[enc].push(r);
        });

        html+=`<div style="font-size:.72rem;font-weight:800;color:var(--navy);margin:14px 0 8px;text-transform:capitalize">${dateLabel}</div>
        <div class="rec-grid">`;

        Object.entries(byEnc).forEach(([encId, encRecs])=>{
          const ouv = encRecs.find(r=>r.data?.moment==='ouv');
          const ferm = encRecs.find(r=>r.data?.moment==='ferm');
          const tempOuv = ouv?.data?.temp;
          const tempFerm = ferm?.data?.temp;
          const agent = ouv?.data?.cuisinier || ferm?.data?.cuisinier || '—';
          const site = _sites.find(s=>s.code===encRecs[0]?.site_id);
          const apremRec = encRecs.find(r=>r.data&&(r.data.moment==='aprem'||r.data.moment==='midi'));
          const tempAprem = apremRec&&apremRec.data&&apremRec.data.temp;
          const hasCanicule = !!tempAprem;
          const nc = encRecs.some(r=>isNC(r));
          const isComplete = !!tempOuv && !!tempFerm;
          const isPartial  = (!!tempOuv || !!tempFerm) && !isComplete;

          const _apremSlot = hasCanicule
            ? `<div class="rec-field" style="background:#fff7ed;border-radius:8px"><div class="rec-field-lbl" style="color:#f59e0b">☀️ Midi</div><div class="rec-field-val" style="font-size:1.05rem">${tempAprem}°C</div></div>`
            : '';

          html+=`<div class="rec-card ${nc?'nc-border':isPartial?'warn-border':'ok-border'}" onclick="openDetail('${encRecs[0]&&encRecs[0].id||''}')">
            <div class="rec-card-header">
              <div style="flex:1">
                <div class="rec-card-date">🌡️ ${(encRecs[0]&&encRecs[0].enr_type||'enr19').toUpperCase()}${hasCanicule?' ☀️':''}</div>
                <div class="rec-card-title">${escH(encRecs[0]&&encRecs[0].data&&encRecs[0].data.enc_label||encId)}</div>
                <div class="rec-card-site">👤 ${agent}</div>
              </div>
              <span class="tag ${nc?'tag-err':isPartial?'tag-warn':'tag-ok'}">${nc?'✗ NC':isPartial?'⚠ Partiel':'✓ OK'}</span>
            </div>
            <div class="rec-card-body">
              <div class="rec-fields" style="grid-template-columns:repeat(${hasCanicule?3:2},1fr)">
                ${tempOuv?`<div class="rec-field"><div class="rec-field-lbl">🌅 Ouv.</div><div class="rec-field-val" style="font-size:1.05rem">${tempOuv}°C</div></div>`:'<div class="rec-field" style="opacity:.4"><div class="rec-field-lbl">🌅 Ouv.</div><div class="rec-field-val">—</div></div>'}
                ${_apremSlot}
                ${tempFerm?`<div class="rec-field"><div class="rec-field-lbl">🌙 Ferm.</div><div class="rec-field-val" style="font-size:1.05rem">${tempFerm}°C</div></div>`:'<div class="rec-field" style="opacity:.4"><div class="rec-field-lbl">🌙 Ferm.</div><div class="rec-field-val">—</div></div>'}
              </div>
            </div>
            <div class="rec-card-footer">
              <span>🏠 ${site&&site.name||encRecs[0]&&encRecs[0].site_id}</span>
              <span style="margin-left:auto;color:${isPartial?'#d97706':nc?'#dc2626':'#16a34a'};font-weight:700">${nc?'NC':isPartial?'Partiel':'Complet'}</span>
            </div>
          </div>`;
        });
        html+=`</div>`;
      });
    }

    // ENR27 et ENR26 en cartes normales
    if (autres.length > 0) {
      html += '<div style="font-size:.72rem;font-weight:800;color:var(--navy);margin:14px 0 8px">Contrôle afficheurs (ENR27)</div>';
      html += '<div class="rec-grid">';
      html += _renderCardsStandard(cfg, autres);
      html += '</div>';
    }
    return html;
  }

  // ENR28 nettoyage : grouper par jour
  if (type === 'nettoyage') {
    const byDate = {};
    recs.forEach(r=>{
      const d=r.data||{};
      const dk=d.date||r.recorded_at?.slice(0,10)||'—';
      if(!byDate[dk]) byDate[dk]=[];
      byDate[dk].push(r);
    });
    let html='';
    Object.keys(byDate).sort().reverse().forEach(date=>{
      const dayRecs=byDate[date];
      const dateLabel=date!=='—'?new Date(date+'T12:00').toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'}):date;
      const dayOk=dayRecs.every(r=>!isNC(r));
      // Grouper par zone
      const byZone={};
      dayRecs.forEach(r=>{
        const zone=nettZone(r.data?.ref_id||'', r.site_id)||'Autre';
        if(!byZone[zone]) byZone[zone]=[];
        byZone[zone].push(r);
      });

      html+=`<div style="background:var(--card);border-radius:14px;border:1.5px solid ${dayOk?'#bbf7d0':'#fecaca'};margin-bottom:14px;overflow:hidden">
        <div style="padding:12px 16px;background:${dayOk?'#f0fdf4':'#fff5f5'};border-bottom:1px solid ${dayOk?'#bbf7d0':'#fecaca'};display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:.85rem;font-weight:800;text-transform:capitalize">${dateLabel}</div>
            <div style="font-size:.7rem;color:var(--muted)">${dayRecs.length} zone(s) validée(s)</div>
          </div>
          <span class="tag ${dayOk?'tag-ok':'tag-err'}">${dayOk?'✓ Complet':'⚠ NC'}</span>
        </div>`;

      Object.entries(byZone).forEach(([zone, zRecs])=>{
        const zOk=zRecs.every(r=>r.data?.conforme!=='NON');
        html+=`<div style="padding:10px 16px;border-bottom:1px solid #f7fafc">
          <div style="font-size:.75rem;font-weight:700;color:${zOk?'var(--text)':'#dc2626'};margin-bottom:6px">${zone}</div>
          <div style="display:flex;flex-direction:column;gap:4px">`;
        zRecs.forEach(r=>{
          const d=r.data||{};
          const materiel=nettMateriel(d.ref_id||'', r.site_id)||d.ref_id||'—';
          const ok=d.conforme!=='NON';
          const agent=d.cuisinier||'—';
          html+=`<div onclick="openDetail('${r.id}')" style="display:flex;align-items:center;justify-content:space-between;padding:5px 8px;background:${ok?'#f8fafc':'#fff5f5'};border-radius:7px;cursor:pointer">
            <div>
              <div style="font-size:.72rem;font-weight:600">${escH(materiel)}</div>
              <div style="font-size:.65rem;color:var(--muted)">👤 ${agent}${d.heure?' · '+d.heure:''}</div>
            </div>
            <span style="font-size:.75rem;font-weight:700;color:${ok?'#16a34a':'#dc2626'}">${ok?'✓':'✗'}</span>
          </div>`;
        });
        html+=`</div></div>`;
      });
      html+=`</div>`;
    });
    return html;
  }

  // Defaut : cartes groupées par site
  const siteIds=[...new Set(recs.map(r=>r.site_id))];
  let html='';
  siteIds.forEach(siteId=>{
    const siteRecs=recs.filter(r=>r.site_id===siteId);
    const site=_sites.find(s=>s.code===siteId);
    if(siteIds.length>1){
      html+=`<div style="font-size:.75rem;font-weight:800;color:var(--navy);text-transform:uppercase;letter-spacing:.5px;margin:16px 0 10px;padding-bottom:6px;border-bottom:2px solid var(--navy)">
        🏠 ${site?.name||siteId} — ${siteRecs.length} saisie(s)
      </div>`;
    }
    html+='<div class="rec-grid">';
    html+=_renderCardsStandard(cfg, siteRecs);
    html+='</div>';
  });
  return html;
}

function _renderCardsStandard(cfg, recs) {
  let html='';
  recs.forEach(r=>{
    const d=r.data||{};
    const nc=isNC(r);
    const dt=r.recorded_at?new Date(r.recorded_at):null;
    const dateStr=dt?dt.toLocaleDateString('fr-FR'):'—';
    const timeStr=dt?dt.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):'';
    const titre=cfg.cardTitle(r);
    const sous=cfg.cardSub(r);
    const site=_sites.find(s=>s.code===r.site_id);

    let fieldsHtml='<div class="rec-fields">';
    cfg.colonnes.filter(c=>!c.key.startsWith('/')&&d[c.key]&&d[c.key]!=='').forEach(col=>{
      const val=d[col.key];
      let valCls='';
      if(col.temp){const ck=col.conf;valCls=ck?(d[ck]==='OUI'?'temp-ok':d[ck]==='NON'?'temp-nc':''):'';}
      let displayVal=String(val);
      if(col.key==='moment') displayVal=val==='ouv'?'🌅 Ouverture':val==='ferm'?'🌙 Fermeture':val;
      if(col.key==='conforme') displayVal=val==='OUI'?'✅ Conforme':val==='NON'?'❌ Non conforme':val;
      if(col.key==='ref_id') displayVal=nettLabel(val, r.site_id)||val;
      const isFull=['observations','commentaire','action','desc','description'].includes(col.key)||String(val).length>30;
      fieldsHtml+=`<div class="rec-field${isFull?' full':''}">
        <div class="rec-field-lbl">${col.label}</div>
        <div class="rec-field-val${valCls?' '+valCls:''}" style="${col.temp?'font-size:1.05rem':''}">${escH(displayVal)}${col.temp?'°C':''}</div>
      </div>`;
    });
    fieldsHtml+='</div>';

    let photosHtml='';
    const photoUrls=[];
    cfg.photoFields.forEach(pf=>{
      if(!d[pf])return;
      try{const o=JSON.parse(d[pf]);const url=o.url||o.thumb_url||o.thumb||'';if(url)photoUrls.push(url);}
      catch{if(typeof d[pf]==='string'&&d[pf].startsWith('http'))photoUrls.push(d[pf]);}
    });
    if(photoUrls.length){
      photosHtml='<div class="rec-photos">'+photoUrls.map(u=>`<img src="${u}" class="rec-photo-thumb" onclick="event.stopPropagation();openLightbox('${u}')" loading="lazy" onerror="this.style.display='none'">`).join('')+'</div>';
    }

    // Pour nuisibles, la logique est inversée : presence='OUI' = NC, pas 'NON'
    const ncFieldsVisible = r.enr_type === 'nuisibles_val'
      ? cfg.confFields.filter(k=>d[k]==='OUI')
      : cfg.confFields.filter(k=>d[k]==='NON');

    const isDeleted = d._deleted === true;
    html+=`<div class="rec-card ${isDeleted?'':''}${nc?'nc-border':'ok-border'}" style="${isDeleted?'border-left:3px solid #f97316;background:#fff7ed;opacity:.85':''}" onclick="openDetail('${r.id}')">
      <div class="rec-card-header">
        <div style="flex:1">
          <div class="rec-card-date">${dateStr} ${timeStr}</div>
          <div class="rec-card-title">${escH(titre)}</div>
          ${sous?`<div class="rec-card-site">${escH(sous)}</div>`:''}
          ${isDeleted?`<div style="font-size:.65rem;color:#c2410c;font-weight:700;margin-top:2px">🔒 Masqué par la cuisine (${escH(d._deleted_by||'Cuisinier')})</div>`:''}
        </div>
        <div class="rec-card-badge">${isDeleted
          ?'<span class="tag" style="background:#fed7aa;color:#c2410c;font-size:.65rem">🔒 Masqué</span>'
          :`<span class="tag ${nc?'tag-err':'tag-ok'}">${nc?'✗ NC':'✓ OK'}</span>`
        }</div>
      </div>
      <div class="rec-card-body">
        ${fieldsHtml}
        ${photosHtml}
        ${ncFieldsVisible.length?`<div style="margin-top:8px;padding:6px 8px;background:#fff5f5;border-radius:7px;font-size:.72rem;color:#dc2626;font-weight:700">⚠️ ${ncFieldsVisible.map(k=>CONF_LABELS[k]||k).join(' · ')}</div>`:''}
      </div>
      <div class="rec-card-footer">
        <span>🏠 ${site?.name||r.site_id}</span>
        <span style="margin-left:auto">${ENR_LABELS[r.enr_type]||r.enr_type?.toUpperCase()||''}</span>
        ${photoUrls.length?`<span>📷 ${photoUrls.length}</span>`:''}
      </div>
    </div>`;
  });
  return html;
}


function _renderTableForType(type, cfg, recs) {
  const cols = cfg.colonnes.filter(c => !['observations'].includes(c.key));
  let html = `<div class="table-card"><div class="table-wrap"><table>
  <thead><tr>
    <th>Date/Heure</th><th>Site</th>
    ${cols.map(c=>`<th>${c.label}</th>`).join('')}
    <th>Conf.</th><th>📷</th>
  </tr></thead><tbody>`;

  recs.forEach(r => {
    const d = r.data||{};
    const site = _sites.find(s=>s.code===r.site_id);
    const dt = r.recorded_at ? new Date(r.recorded_at) : null;
    const dateStr = dt ? dt.toLocaleDateString('fr-FR') : '—';
    const timeStr = dt ? dt.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) : '';
    const nc = isNC(r);

    const hasPhotoCell = cfg.photoFields.some(pf=>{
      if(!d[pf])return false;
      try{const o=JSON.parse(d[pf]);return!!(o.url||o.thumb_url||o.thumb);}catch{return false;}
    });

    html += `<tr style="cursor:pointer" onclick="openDetail('${r.id}')">
      <td style="font-family:var(--mono);font-size:.75rem;white-space:nowrap">${dateStr}<br><span style="color:var(--muted)">${timeStr}</span></td>
      <td style="font-size:.78rem;font-weight:600">${site?.name||r.site_id}</td>
      ${cols.map(col => {
        const val = d[col.key];
        if (!val) return '<td style="color:#cbd5e0">—</td>';
        let style = '';
        if (col.temp && col.conf) {
          style = d[col.conf]==='NON' ? 'color:var(--red);font-weight:800' : d[col.conf]==='OUI' ? 'color:#16a34a;font-weight:700' : '';
        }
        if (col.bold) style += ';font-weight:700';
        if (col.mono) style += ';font-family:var(--mono)';
        return `<td style="${style}">${escH(String(val))}${col.temp?'°C':''}</td>`;
      }).join('')}
      <td><span class="tag ${nc?'tag-err':'tag-ok'}">${nc?'✗':'✓'}</span></td>
      <td>${hasPhotoCell?'<span style="cursor:pointer" onclick="event.stopPropagation();_openFirstPhoto(\''+r.id+'\',\''+type+'\')">📷</span>':'—'}</td>
    </tr>`;
  });
  html += '</tbody></table></div></div>';
  return html;
}

function _openFirstPhoto(recId, type) {
  const r = _records.find(x=>x.id===recId);
  if (!r) return;
  const cfg = PAGE_ENR_CFG[type];
  const d = r.data||{};
  for (const pf of cfg.photoFields) {
    if (!d[pf]) continue;
    try { const o=JSON.parse(d[pf]); const url=o.url||o.thumb_url||o.thumb; if(url){openLightbox(url);return;} } catch {}
  }
}
function renderRapports() {
  const moisSet = [...new Set(_records.map(r=>r.recorded_at?.slice(0,7)).filter(Boolean))].sort().reverse();
  const curM = new Date().toISOString().slice(0,7);

  let html = `
  <div class="rapport-card">
    <div class="rapport-card-title">📄 Générer un rapport PDF</div>
    <div class="rapport-card-sub">Rapport complet des saisies PMS avec températures, conformités et non-conformités</div>

    <div class="rapport-options">
      <div class="rapport-option">
        <label>📅 Période</label>
        <select id="rpt-mois" onchange="updateRptPreview(this.value,document.getElementById('rpt-site').value)">
          ${moisSet.map(m=>`<option value="${m}" ${m===curM?'selected':''}>${m}</option>`).join('')}
          <option value="all">Toutes les périodes</option>
        </select>
      </div>
      <div class="rapport-option">
        <label>📆 Du</label>
        <input type="date" id="rpt-date-from" style="padding:8px;border:1.5px solid var(--border);border-radius:10px;font-family:var(--font);font-size:.82rem;width:100%"
          onchange="updateRptPreview(document.getElementById('rpt-mois').value,document.getElementById('rpt-site').value)">
      </div>
      <div class="rapport-option">
        <label>📆 Au</label>
        <input type="date" id="rpt-date-to" style="padding:8px;border:1.5px solid var(--border);border-radius:10px;font-family:var(--font);font-size:.82rem;width:100%"
          onchange="updateRptPreview(document.getElementById('rpt-mois').value,document.getElementById('rpt-site').value)">
      </div>
      <div class="rapport-option">
        <label>🏠 Site</label>
        <select id="rpt-site" onchange="updateRptPreview(document.getElementById('rpt-mois').value,this.value)">
          <option value="">Tous les sites</option>
          ${_sites.map(s=>`<option value="${s.code}">${s.name} (${s.code})</option>`).join('')}
        </select>
      </div>
    </div>

    <div style="margin-bottom:12px">
      <label style="font-size:.73rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.3px;display:block;margin-bottom:8px">Sections à inclure</label>
      <div class="rapport-checkboxes">
        <label class="rapport-check"><input type="checkbox" id="rpt-kpi" checked> 📊 Résumé KPI</label>
        <label class="rapport-check"><input type="checkbox" id="rpt-nc" checked> 🚨 Non-conformités</label>
        <label class="rapport-check"><input type="checkbox" id="rpt-ccp" checked> ❄️ CCP (ENR01-03)</label>
        <label class="rapport-check"><input type="checkbox" id="rpt-prpo" checked> 🥘 PrPo (ENR04-18)</label>
        <label class="rapport-check"><input type="checkbox" id="rpt-reception" checked> 📦 Réception (ENR23)</label>
        <label class="rapport-check"><input type="checkbox" id="rpt-nettoyage" checked> 🧹 Nettoyage (ENR28)</label>
        <label class="rapport-check"><input type="checkbox" id="rpt-nuisibles" checked> 🐀 Nuisibles</label>
        <label class="rapport-check"><input type="checkbox" id="rpt-tracabilite" checked> 📋 Traçabilité (ENR31)</label>
        <label class="rapport-check"><input type="checkbox" id="rpt-autres" checked> 📋 Autres fiches</label>
      </div>
    </div>

    <div id="rpt-preview" class="rapport-preview"></div>

    <button class="gen-btn" id="rpt-btn" onclick="generatePDF()">
      <span>📄</span> Générer et télécharger le PDF
    </button>
  </div>`;

  setContent(html);
  setTimeout(() => {
    const mois = document.getElementById('rpt-mois')?.value || '';
    const site = document.getElementById('rpt-site')?.value || '';
    updateRptPreview(mois, site);
  }, 50);
}

function updateRptPreview(mois, site) {
  let recs = _records;
  const dateFrom = document.getElementById('rpt-date-from')?.value;
  const dateTo = document.getElementById('rpt-date-to')?.value;
  if (dateFrom) recs = recs.filter(r => r.recorded_at >= dateFrom);
  else if (mois && mois !== 'all') recs = recs.filter(r => r.recorded_at?.startsWith(mois));
  if (dateTo) recs = recs.filter(r => r.recorded_at <= dateTo + 'T23:59:59');
  if (site) recs = recs.filter(r => r.site_id === site);
  const nc = recs.filter(r => isNC(r)).length;
  const sites = new Set(recs.map(r => r.site_id)).size;
  const el = document.getElementById('rpt-preview');
  const periodeLabel = dateFrom ? `${dateFrom} → ${dateTo||'…'}` : (mois==='all'?'tout':mois);
  if (el) {
    el.style.display = 'block';
    el.innerHTML = `📋 <strong>${recs.length}</strong> saisies · <strong style="color:var(--red)">${nc}</strong> NC · <strong>${sites}</strong> site(s) · période : <strong>${periodeLabel}</strong>`;
  }
}

async function generatePDF() {
  const btn = document.getElementById('rpt-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span>⏳</span> Génération…'; }

  try {
    const mois   = document.getElementById('rpt-mois')?.value || '';
    const site   = document.getElementById('rpt-site')?.value || '';
    const inclKPI   = document.getElementById('rpt-kpi')?.checked;
    const inclNC    = document.getElementById('rpt-nc')?.checked;
    const inclCCP   = document.getElementById('rpt-ccp')?.checked;
    const inclPrPo  = document.getElementById('rpt-prpo')?.checked;
    const inclRec   = document.getElementById('rpt-reception')?.checked;
    const inclNett  = document.getElementById('rpt-nettoyage')?.checked;
    const inclNuis  = document.getElementById('rpt-nuisibles')?.checked;
    const inclTrac  = document.getElementById('rpt-tracabilite')?.checked;
    const inclAutr  = document.getElementById('rpt-autres')?.checked;
    const dateFrom  = document.getElementById('rpt-date-from')?.value || '';
    const dateTo    = document.getElementById('rpt-date-to')?.value || '';

    let recs = _records;
    if (dateFrom) {
      recs = recs.filter(r => r.recorded_at >= dateFrom);
      if (dateTo) recs = recs.filter(r => r.recorded_at <= dateTo + 'T23:59:59');
    } else if (mois && mois !== 'all') {
      recs = recs.filter(r => r.recorded_at?.startsWith(mois));
    }
    if (site) recs = recs.filter(r => r.site_id === site);

    const siteObj    = site ? _sites.find(s => s.code === site) : null;
    const siteName   = siteObj?.name || (site || 'Tous les sites');
    const siteCode   = siteObj?.code || site || '';
    const sectorObj  = siteObj ? _sectors.find(s => s.id === siteObj.sector_id) : null;
    const terrObj    = sectorObj ? _territories.find(t => t.id === sectorObj.territory_id) : null;
    const periodeStr = dateFrom ? `${dateFrom} → ${dateTo||new Date().toISOString().slice(0,10)}` : (mois === 'all' ? 'Toutes périodes' : (mois || 'Toutes périodes'));
    const genDate    = new Date().toLocaleDateString('fr-FR', {day:'2-digit',month:'long',year:'numeric'});
    const genTime    = new Date().toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'});

    const nb  = recs.length;
    const nc  = recs.filter(r => isNC(r)).length;
    const pct = pmsWeightedScore(recs) ?? 100;
    const pctCol = pct >= 90 ? '#16a34a' : pct >= 75 ? '#d97706' : '#dc2626';
    const pctLabel = pct >= 90 ? 'Satisfaisant' : pct >= 75 ? 'À améliorer' : 'Insuffisant';
    const sites_actifs = [...new Set(recs.map(r => r.site_id))];

    // ── Helpers ────────────────────────────────────────────────
    const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const fmtDT = (iso) => {
      if (!iso) return '—';
      const d = new Date(iso);
      return d.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'2-digit'}) + ' ' +
             d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
    };
    const confBadge = (ok) => ok
      ? '<span class="badge-ok">✓ OUI</span>'
      : '<span class="badge-no">✗ NON</span>';

    // ── Section HTML générique par ENR ─────────────────────────
    const ENR_DESCRIPTIONS = {
      'enr01': 'Enregistrement du refroidissement rapide des préparations chaudes (règle HACCP : -63°C à +10°C en moins de 2h)',
      'enr02': 'Remise en température des plats préparés à l\'avance (règle : atteindre +63°C à cœur)',
      'enr03': 'Refroidissement et remise en température combinés',
      'enr04': 'Cuisson des steaks hachés (T° à cœur ≥63°C)',
      'enr05': 'Friture — contrôle T° huile et qualité',
      'enr06': 'Friture avec test huile (teneurs en composés polaires)',
      'enr07': 'Cuisson viandes bien faites (T° à cœur ≥75°C)',
      'enr08': 'Cuisson tendre moelleux / bien fait (T° cœur selon produit)',
      'enr09': 'Conditionnement chaud — contrôle T° de distribution',
      'enr10': 'Conditionnement froid — contrôle T° liaison froide',
      'enr11': 'Plats froids — températures et conformité',
      'enr12': 'Plats chauds — températures et conformité',
      'enr13': 'Départ livraison — T° avant départ véhicule',
      'enr14': 'Distribution en salle — T° service',
      'enr15': 'SAM (Self Autonomous Machine) — températures',
      'enr16': 'Self service — températures',
      'enr17': 'Livraison froide — températures réception',
      'enr18': 'Livraison chaude — températures réception',
      'enr19': 'Températures des enceintes réfrigérées (frigos et congélateurs) — relevés ouverture/fermeture',
      'enr23': 'Réception des marchandises — contrôle T°, DLC, conditionnement, conformité',
      'enr26': 'Étalonnage et vérification des thermomètres',
      'enr27': 'Relevé des températures via afficheurs électroniques',
      'enr28': 'Nettoyage & désinfection — validation des opérations de nettoyage par zone',
      'enr29': 'Sensibilisation et formation du personnel aux bonnes pratiques d\'hygiène',
      'enr30': 'Non-conformités — fiches de signalement et actions correctives',
      'enr31': 'Traçabilité matières premières — enregistrement des lots, fournisseurs, DLC',
      'enr24': 'Plan de maintenance équipements (interventions préventives et correctives)',
      'enr25': 'Plan de contrôle microbiologique (prélèvements surfaces, denrées, eau)',
      'enr_allergenes': 'Déclaration des 14 allergènes majeurs par plat/menu (INCO 1169/2011)',
      'enr32': 'Déclaration TIAC (Toxi-Infection Alimentaire Collective)',
      'enr33': 'Plats témoins — échantillons conservés 5 jours pour traçabilité',
      'enr34': 'Étiquetage produits — contrôle étiquettes et traçabilité',
      'enr35': 'Origine des viandes — traçabilité bovine obligatoire',
      'enr36': 'Gestion des excédents — valorisation ou élimination',
      'enr39': 'Prestations pique-nique — températures et conformité',
      'enr52': 'T°C excédents — températures lors de la gestion des restes',
      'enr53': 'Dons associatifs — traçabilité des dons alimentaires',
    };

    const buildSection = (title, description, enrTypes, emoji) => {
      const filtered = recs.filter(r => enrTypes.includes(r.enr_type));
      if (!filtered.length) return '';

      const ncCount = filtered.filter(r => isNC(r)).length;
      const okCount = filtered.length - ncCount;
      const secPct  = Math.round((okCount / filtered.length) * 100);
      const secCol  = secPct >= 90 ? '#16a34a' : secPct >= 75 ? '#d97706' : '#dc2626';

      const rows = filtered.map(r => {
        const d  = r.data || {};
        const dt = fmtDT(r.recorded_at);
        const siteR = _sites.find(s => s.code === r.site_id);
        const siteDisplay = siteR ? `${siteR.name}<br><small style="color:#6b7280;font-size:9px">${siteR.code}</small>` : (r.site_id || '—');

        // Produit / référence principale
        const produit = d.produit || d.fournisseur || d.plat || d.theme || d.ref_id || d.plat_nom || '—';
        // Cuisinier
        const cuisinier = d.cuisinier || d.agent || d.chef || '—';

        // Températures - collecter tous les champs T°
        const tempPairs = [];
        const tempMap = {
          t_deb:'T° départ', t_fin:'T° fin', tc:'T° cœur',
          t_ref_deb:'T° réf. déb.', t_ref_fin:'T° réf. fin',
          t3:'T° départ remise', t1:'T°1', t2:'T°2', t4:'T°4',
          t_f:'T° froid', t_c:'T° chaud', temp:'T°',
          t_huile:'T° huile', t_arrivee:'T° arrivée',
        };
        Object.entries(tempMap).forEach(([k, label]) => {
          if (d[k] != null && d[k] !== '') {
            tempPairs.push(`<span class="temp-chip">${label}: <strong>${d[k]}°C</strong></span>`);
          }
        });
        // Températures enceintes (enr19)
        if (r.enr_type === 'enr19') {
          const encId = d.enc_id || d.enc || '';
          const moment = d.moment === 'ouv' ? 'Ouv.' : d.moment === 'ferm' ? 'Ferm.' : (d.moment||'');
          const tempEnc = d.temp != null ? `${d.temp}°C` : '—';
          return `<tr class="${isNC(r)?'row-nc':''}">
            <td>${dt}</td>
            <td>${siteDisplay}</td>
            <td><strong>${esc(encId)}</strong>${moment ? ` — ${esc(moment)}` : ''}</td>
            <td>${esc(cuisinier)}</td>
            <td><span class="temp-chip">T°: <strong>${tempEnc}</strong></span></td>
            <td>${confBadge(!isNC(r))}</td>
          </tr>`;
        }
        // ENR28 nettoyage
        if (r.enr_type === 'enr28') {
          const mat = d.materiel || nettMateriel(d.ref_id||'', r.site_id) || d.ref_id || '';
          const zone = d.zone || nettZone(d.ref_id||'', r.site_id) || '';
          const zoneDisplay = mat && zone ? `${mat} — ${zone}` : mat||zone||d.ref_id||'—';
          const comment = d.commentaire || d.obs || '';
          return `<tr class="${isNC(r)?'row-nc':''}">
            <td>${dt}</td>
            <td>${siteDisplay}</td>
            <td><strong>${esc(zoneDisplay)}</strong>${comment?`<br><small style="color:#6b7280">${esc(comment.slice(0,50))}</small>`:''}</td>
            <td>${esc(cuisinier)}</td>
            <td>—</td>
            <td>${confBadge(!isNC(r))}</td>
          </tr>`;
        }
        // ENR31 traçabilité
        if (r.enr_type === 'enr31') {
          const fournisseur = d.fournisseur || '—';
          const lot = d.lot || d.p1_lot || '—';
          const dlc = d.dlc || d.p1_dlc || '—';
          return `<tr class="${isNC(r)?'row-nc':''}">
            <td>${dt}</td>
            <td>${siteDisplay}</td>
            <td><strong>${esc(produit)}</strong><br><small style="color:#6b7280">Fourn: ${esc(fournisseur)} | Lot: ${esc(lot)} | DLC: ${esc(dlc)}</small></td>
            <td>${esc(cuisinier)}</td>
            <td>${tempPairs.join(' ') || '—'}</td>
            <td>${confBadge(!isNC(r))}</td>
          </tr>`;
        }
        // ENR23 réception
        if (r.enr_type === 'enr23') {
          const p1 = d.p1_produit || '';
          const p2 = d.p2_produit || '';
          const prods = [p1,p2].filter(Boolean).join(', ') || produit;
          const fournisseur = d.fournisseur || '—';
          return `<tr class="${isNC(r)?'row-nc':''}">
            <td>${dt}</td>
            <td>${siteDisplay}</td>
            <td><strong>${esc(fournisseur)}</strong><br><small style="color:#6b7280">${esc(prods.slice(0,60))}</small></td>
            <td>${esc(cuisinier)}</td>
            <td>${tempPairs.join(' ') || '—'}</td>
            <td>${confBadge(!isNC(r))}</td>
          </tr>`;
        }
        // Générique
        return `<tr class="${isNC(r)?'row-nc':''}">
          <td>${dt}</td>
          <td>${siteDisplay}</td>
          <td>${esc(produit.slice(0,50))}</td>
          <td>${esc(cuisinier)}</td>
          <td>${tempPairs.join(' ') || '—'}</td>
          <td>${confBadge(!isNC(r))}</td>
        </tr>`;
      }).join('');

      return `<div class="section">
        <div class="section-header">
          <div>
            <div class="section-title">${emoji} ${title}</div>
            <div class="section-desc">${description}</div>
          </div>
          <div class="section-stats">
            <span class="stat-chip">${filtered.length} saisie${filtered.length>1?'s':''}</span>
            ${ncCount > 0 ? `<span class="stat-chip nc">${ncCount} NC</span>` : ''}
            <span class="stat-pct" style="color:${secCol}">${secPct}%</span>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th style="width:14%">Date/Heure</th>
              <th style="width:14%">Site</th>
              <th style="width:30%">Détail</th>
              <th style="width:12%">Cuisinier</th>
              <th style="width:22%">Températures</th>
              <th style="width:8%">Conf.</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    };

    // ── NC détail section ───────────────────────────────────────
    const buildNCSection = () => {
      const ncRecs = recs.filter(r => isNC(r));
      if (!ncRecs.length) return '<div class="section"><div class="section-header"><div><div class="section-title">🚨 Non-conformités détectées</div></div><span class="stat-chip" style="background:#dcfce7;color:#166534">✅ Aucune NC</span></div></div>';

      const rows = ncRecs.map(r => {
        const d = r.data || {};
        const dt = fmtDT(r.recorded_at);
        const siteR = _sites.find(s => s.code === r.site_id);
        const siteDisplay = siteR ? `${siteR.name} (${siteR.code})` : (r.site_id || '—');
        const produit = d.produit || d.fournisseur || d.plat || d.ref_id || '—';
        const enrLabel = ENR_LABELS[r.enr_type] || r.enr_type?.toUpperCase() || '—';
        const ncFields = CONF_FIELDS_ALL.filter(k => d[k] === 'NON');
        const tempInfo = ncFields.map(k => {
          const tKey = {conf_r:'t2',conf_rt:'t4',conforme:'tc',conf_fin:'t_fin',conf_deb:'t_deb',conf_t3:'t3'}[k];
          return tKey && d[tKey] ? `${d[tKey]}°C` : 'NC';
        }).join(', ') || 'NON';
        const action = d.action || d.mesure || d.action_corrective || '';
        return `<tr class="row-nc">
          <td>${dt}</td>
          <td>${esc(siteDisplay)}</td>
          <td>${esc(enrLabel.replace(/[^\w\s.°ÀÂÄÉÈÊËÏÎÔÖÙÛÜàâäéèêëïîôöùûü&-]/g,''))}</td>
          <td>${esc(produit.slice(0,25))}</td>
          <td><strong style="color:#dc2626">${esc(tempInfo)}</strong></td>
          <td style="font-size:10px;color:#6b7280">${esc(action.slice(0,30))}</td>
        </tr>`;
      }).join('');

      return `<div class="section">
        <div class="section-header">
          <div>
            <div class="section-title">🚨 Non-conformités détectées</div>
            <div class="section-desc">Toutes les saisies avec au moins un critère non conforme sur la période</div>
          </div>
          <span class="stat-chip nc">${ncRecs.length} NC</span>
        </div>
        <table>
          <thead>
            <tr>
              <th style="width:14%">Date/Heure</th>
              <th style="width:18%">Site</th>
              <th style="width:18%">Fiche</th>
              <th style="width:18%">Produit</th>
              <th style="width:14%">T° relevée</th>
              <th style="width:18%">Action corrective</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    };

    // ── KPI section ─────────────────────────────────────────────
    const buildKPISection = () => {
      const enrStats = {};
      recs.forEach(r => {
        if (!enrStats[r.enr_type]) enrStats[r.enr_type] = {total:0,nc:0};
        enrStats[r.enr_type].total++;
        if (isNC(r)) enrStats[r.enr_type].nc++;
      });
      const enrRows = Object.entries(enrStats).sort((a,b)=>b[1].total-a[1].total).map(([k,v]) => {
        const p = v.total > 0 ? Math.round((1-v.nc/v.total)*100) : null;
        const col = p>=90?'#16a34a':p>=75?'#d97706':'#dc2626';
        return `<tr>
          <td>${esc((ENR_LABELS[k]||k.toUpperCase()).replace(/[^\w\s.°ÀÂÄÉÈÊËÏÎÔÖÙÛÜàâäéèêëïîôöùûü&-]/g,''))}</td>
          <td style="text-align:center;font-weight:700">${v.total}</td>
          <td style="text-align:center;color:#dc2626;font-weight:700">${v.nc||0}</td>
          <td style="text-align:center">
            <div style="display:flex;align-items:center;gap:6px;justify-content:flex-end">
              <div style="width:60px;height:6px;background:#e5e7eb;border-radius:3px">
                <div style="width:${p}%;height:100%;background:${col};border-radius:3px"></div>
              </div>
              <strong style="color:${col}">${p}%</strong>
            </div>
          </td>
        </tr>`;
      }).join('');

      return `<div class="section">
        <div class="section-header">
          <div>
            <div class="section-title">📊 Indicateurs clés</div>
            <div class="section-desc">Synthèse de conformité pour la période ${periodeStr} — ${siteName}${siteCode?' ('+siteCode+')':''}</div>
          </div>
        </div>
        <div class="kpi-grid">
          <div class="kpi-card" style="border-color:${pctCol}">
            <div class="kpi-val" style="color:${pctCol}">${pct}%</div>
            <div class="kpi-label">Conformité globale</div>
            <div class="kpi-sub">${pctLabel}</div>
          </div>
          <div class="kpi-card" style="border-color:#dc2626">
            <div class="kpi-val" style="color:#dc2626">${nc}</div>
            <div class="kpi-label">Non-conformités</div>
            <div class="kpi-sub">sur ${nb} saisies</div>
          </div>
          <div class="kpi-card" style="border-color:#0f2240">
            <div class="kpi-val" style="color:#0f2240">${nb}</div>
            <div class="kpi-label">Total saisies</div>
            <div class="kpi-sub">${periodeStr}</div>
          </div>
          <div class="kpi-card" style="border-color:#3182ce">
            <div class="kpi-val" style="color:#3182ce">${sites_actifs.length}</div>
            <div class="kpi-label">Site${sites_actifs.length>1?'s':''} actif${sites_actifs.length>1?'s':''}</div>
            <div class="kpi-sub">${sites_actifs.join(', ')}</div>
          </div>
        </div>
        ${Object.keys(enrStats).length > 0 ? `
        <table style="margin-top:14px">
          <thead><tr>
            <th>Type de fiche</th>
            <th style="text-align:center;width:80px">Saisies</th>
            <th style="text-align:center;width:60px">NC</th>
            <th style="width:130px">Conformité</th>
          </tr></thead>
          <tbody>${enrRows}</tbody>
        </table>` : ''}
      </div>`;
    };

    // ── Assemblage HTML ─────────────────────────────────────────
    const sections = [];
    if (inclKPI)  sections.push(buildKPISection());
    if (inclNC)   sections.push(buildNCSection());
    if (inclCCP)  sections.push(buildSection('CCP — Refroidissement & Remise en température', 'Points critiques de contrôle : refroidissement rapide (-63°C à +10°C en <2h) et remise en température (>63°C cœur)', ['enr01','enr02','enr03'], '❄️'));
    if (inclPrPo) sections.push(buildSection('Cuisson & Conditionnement', 'Enregistrements de cuisson des différents types de produits avec contrôle des températures à cœur (steaks, fritures, viandes, plats, livraisons...)', ['enr04','enr05','enr06','enr07','enr08','enr09','enr10','enr11','enr12','enr13','enr14','enr15','enr16','enr17','enr18','enr52'], '🔥'));
    if (inclRec)  sections.push(buildSection('Réception des marchandises', 'Contrôle à réception : températures, DLC, état du conditionnement, conformité fournisseur', ['enr23'], '📦'));
    if (inclNett) sections.push(buildSection('Nettoyage & Désinfection', 'Validation des opérations de nettoyage par zone (plans de nettoyage, produits utilisés, conformité)', ['enr28'], '🧹'));
    if (inclNuis) sections.push(buildSection('Contrôle Nuisibles', 'Vérification quotidienne de présence de nuisibles par zone', ['nuisibles_val'], '🐀'));
    if (inclTrac) sections.push(buildSection('Traçabilité matières premières', 'Enregistrement des lots, fournisseurs et DLC pour assurer la traçabilité de l\'origine des denrées (Règlement CE 178/2002)', ['enr31'], '📋'));
    if (inclAutr) {
      sections.push(buildSection('Températures des enceintes', 'Relevés des températures des chambres froides, frigos et congélateurs (ENR19 mensuel, ENR20 canicule, ENR21 ponctuel)', ['enr19','enr20','enr21','enr27'], '🌡️'));
      sections.push(buildSection('Maintenance & Contrôle labo', 'Plan de maintenance équipements (ENR24), contrôles microbiologiques labo (ENR25), déclaration allergènes INCO (ENR-ALG)', ['enr24','enr25','enr_allergenes'], '🔧'));
      sections.push(buildSection('Autres enregistrements HACCP', 'Plats témoins, sensibilisation du personnel, gestion des excédents, dons, pique-niques, TIAC et autres fiches de suivi', ['enr26','enr29','enr30','enr32','enr33','enr34','enr35','enr36','enr39','enr53'], '📄'));
    }

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Rapport PMS HACCP — ${siteName} — ${periodeStr}</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Segoe UI',Arial,sans-serif; color:#1a202c; font-size:12px; background:#faf6fa; }
  .page { max-width:960px; margin:0 auto; padding:24px; }

  /* Header */
  .header { background:linear-gradient(135deg,#0F2240,#1a3a6a); color:#fff; padding:22px 28px; border-radius:14px; margin-bottom:20px; }
  .header-logo { display:flex; align-items:center; gap:12px; margin-bottom:12px; }
  .header-logo-circles { position:relative; width:32px; height:32px; flex-shrink:0; }
  .c1,.c2,.c3 { position:absolute; border-radius:50%; }
  .c1 { width:22px;height:22px;background:#8DC63F;top:0;left:0; }
  .c2 { width:22px;height:22px;background:#E86048;top:0;right:0; }
  .c3 { width:16px;height:16px;background:#C93A78;bottom:0;left:50%;transform:translateX(-50%); }
  .header-title { font-size:1.2rem; font-weight:900; letter-spacing:-.3px; }
  .header-sub { font-size:11px; opacity:.65; margin-top:2px; }
  .header-body { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; }
  .header-site { }
  .header-site-name { font-size:1.6rem; font-weight:900; line-height:1; }
  .header-site-meta { font-size:12px; opacity:.7; margin-top:4px; display:flex; gap:12px; flex-wrap:wrap; }
  .header-site-meta span { display:flex; align-items:center; gap:4px; }
  .header-code { font-family:monospace; font-size:11px; background:rgba(255,255,255,.15); padding:2px 8px; border-radius:5px; }
  .header-score { text-align:right; }
  .header-pct { font-size:3rem; font-weight:900; line-height:1; }
  .header-pct-label { font-size:11px; opacity:.75; margin-top:3px; }
  .header-divider { height:3px; background:#8DC63F; border-radius:2px; margin-top:14px; opacity:.6; }

  /* KPI grid */
  .kpi-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:16px; }
  .kpi-card { background:#fff; border:2px solid; border-radius:10px; padding:12px; text-align:center; }
  .kpi-val { font-size:1.8rem; font-weight:900; line-height:1; }
  .kpi-label { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; color:#64748b; margin-top:4px; }
  .kpi-sub { font-size:10px; color:#94a3b8; margin-top:2px; }

  /* Sections */
  .section { background:#fff; border-radius:14px; border:1px solid #e2e8f0; margin-bottom:16px; overflow:hidden; break-inside:avoid; }
  .section-header { display:flex; justify-content:space-between; align-items:flex-start; padding:14px 16px; background:#faf6fa; border-bottom:1px solid #e2e8f0; gap:12px; }
  .section-title { font-size:13px; font-weight:800; color:#0F2240; margin-bottom:3px; }
  .section-desc { font-size:10px; color:#64748b; line-height:1.4; max-width:600px; }
  .section-stats { display:flex; align-items:center; gap:6px; flex-shrink:0; }
  .stat-chip { font-size:10px; font-weight:700; padding:3px 8px; border-radius:8px; background:#e2e8f0; color:#475569; white-space:nowrap; }
  .stat-chip.nc { background:#fee2e2; color:#991b1b; }
  .stat-pct { font-size:1.1rem; font-weight:900; }

  /* Table */
  table { width:100%; border-collapse:collapse; }
  thead tr { background:#0F2240; }
  th { padding:7px 10px; font-size:10px; font-weight:700; color:#fff; text-align:left; text-transform:uppercase; letter-spacing:.4px; }
  td { padding:7px 10px; font-size:11px; border-bottom:1px solid #f1f5f9; vertical-align:top; }
  tr:hover td { background:#faf6fa; }
  tr.row-nc td { background:#fff8f8; }
  tr:last-child td { border-bottom:none; }

  /* Badges */
  .badge-ok { display:inline-block; font-size:10px; font-weight:800; padding:2px 7px; border-radius:6px; background:#dcfce7; color:#166534; white-space:nowrap; }
  .badge-no { display:inline-block; font-size:10px; font-weight:800; padding:2px 7px; border-radius:6px; background:#fee2e2; color:#991b1b; white-space:nowrap; }
  .temp-chip { display:inline-block; font-size:10px; padding:1px 5px; background:#f0f9ff; color:#0369a1; border-radius:4px; margin:1px; white-space:nowrap; }

  /* Footer */
  .footer { text-align:center; margin-top:20px; padding-top:12px; border-top:2px solid #e2e8f0; font-size:10px; color:#94a3b8; }

  @media print {
    body { background:#fff; }
    .page { padding:15px; }
    .section { break-inside:avoid; }
    @page { margin:15mm; }
  }
</style>
</head>
<body>
<div class="page">

  <div class="header">
    <div class="header-logo">
      <div class="header-logo-circles">
        <div class="c1"></div><div class="c2"></div><div class="c3"></div>
      </div>
      <div>
        <div class="header-title">PMS HACCP — Rapport de conformité</div>
        <div class="header-sub">Généré le ${genDate} à ${genTime}</div>
      </div>
    </div>
    <div class="header-body">
      <div class="header-site">
        <div class="header-site-name">${esc(siteName)}</div>
        <div class="header-site-meta">
          ${siteCode ? `<span>🏷️ <span class="header-code">${esc(siteCode)}</span></span>` : ''}
          ${sectorObj ? `<span>📍 ${esc(sectorObj.name)}</span>` : ''}
          ${terrObj ? `<span>🗺️ ${esc(terrObj.name)}</span>` : ''}
          <span>📅 Période : ${esc(periodeStr)}</span>
        </div>
      </div>
      <div class="header-score">
        <div class="header-pct" style="color:${pct>=90?'#86efac':pct>=75?'#fcd34d':'#fca5a5'}">${pct}%</div>
        <div class="header-pct-label">${pctLabel}</div>
      </div>
    </div>
    <div class="header-divider"></div>
  </div>

  ${sections.join('')}

  <div class="footer">
    PMS HACCP — Rapport de conformité | ${esc(siteName)}${siteCode ? ' ('+esc(siteCode)+')' : ''} | Période : ${esc(periodeStr)} | Généré le ${genDate} à ${genTime}
  </div>
</div>
</body></html>`;

    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
      setTimeout(() => win.print(), 800);
    }

  } catch(e) {
    alert('Erreur génération PDF : ' + e.message);
    console.error(e);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<span>📄</span> Générer et télécharger le PDF'; }
  }
}


const TEMP_FIELDS_PDF = ['t_deb','t_fin','tc','t_ref_deb','t_ref_fin','t3','t1','t2','t4','t_f','t_c'];
const TEMP_SHORT = {
  t_deb:'Tdeb', t_fin:'Tfin', tc:'Tcoeur',
  t_ref_deb:'Tref_deb', t_ref_fin:'Tref_fin',
  t3:'Tdep_remise', t1:'T1', t2:'T2', t4:'T4',
  t_f:'Tfroid', t_c:'Tchaud',
};

function copyText(txt) {
  // Fallback compatible fichiers locaux (content://)
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(txt).then(()=>showToast('📋 Copié','success')).catch(()=>_copyFallback(txt));
  } else {
    _copyFallback(txt);
  }
}
function _copyFallback(txt) {
  const el = document.createElement('textarea');
  el.value = txt; el.style.position='fixed'; el.style.opacity='0';
  document.body.appendChild(el); el.select();
  try { document.execCommand('copy'); showToast('📋 Copié','success'); }
  catch(e) { showToast('Copiez manuellement : ' + txt, 'info', 6000); }
  document.body.removeChild(el);
}

function escH(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escAttr(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════

// ── Démarrage dashboard — session obligatoire depuis index.html ──
document.body.style.visibility = 'visible';
loadCfg();

(function autoStart() {
  document.body.style.visibility = 'visible';
  try {
    
    if (!_token) {
      var c = JSON.parse(localStorage.getItem(CFG_STORE) || '{}');
      
      if (c.token) {
        _token = c.token;
        _refreshToken = c.refreshToken || '';
        _userId = c.userId || '';
      }
    }
    
    if (_token) {
      bootApp();
    } else {
          setTimeout(function(){ window.location.replace('./'); }, 3000); // délai pour voir le msg
    }
  } catch(e) {
      setTimeout(function(){ window.location.replace('./'); }, 3000);
  }
})();

  // ── Bloquer le retour arrière sur la page de connexion ──────
  window.history.pushState({page:'app'}, '', window.location.href);
  window.addEventListener('popstate', function(e) {
    // Si on est dans l'app (login-screen caché), empêcher le retour au login
    const ls = document.getElementById('login-screen');
    const app = document.getElementById('app');
    if (app && app.style.display !== 'none') {
      // Rester dans l'app
      window.history.pushState({page:'app'}, '', window.location.href);
    }
  });

  // ── Bloquer pull-to-refresh sur mobile ─────────────────────
  let _touchStartY = 0;
  document.addEventListener('touchstart', e => { _touchStartY = e.touches[0].clientY; }, {passive:true});
  document.addEventListener('touchmove', e => {
    const _lsEl = document.getElementById('login-screen');
    const inApp = !_lsEl || _lsEl.style.display === 'none';
    if (inApp && window.scrollY === 0 && e.touches[0].clientY > _touchStartY + 10) {
      e.preventDefault();
    }
  }, {passive:false});





// ════════════════════════════════════════════════════
// PAGE : SUPER ADMIN — Vue plateforme globale
// ════════════════════════════════════════════════════
async function renderSuperAdmin() {
  if (!['super_admin','siege'].includes(_profile?.role)) {
    setContent('<div class="empty"><div class="empty-ico">🔒</div>Accès réservé Super Admin</div>');
    return;
  }

  // ── Sync tenants depuis Supabase ──────────────────────────────
  try {
    const supaCompanies = await supaAdmin('GET', '/rest/v1/tenants?select=id,name,tagline,primary_color,accent_color,logo_url,plan,created_at&order=created_at', null);
    if (supaCompanies && supaCompanies.length > 0) {
      // Fusionner avec les données locales (adminEmail etc.)
      const localCompanies = saGetCompanies();
      const merged = supaCompanies.map(t => {
        const local = localCompanies.find(c => c.id === t.id) || {};
        return {
          id: t.id,
          name: t.name,
          tagline: t.tagline || '',
          colorNavy:  t.primary_color  || '#0F2240',
          colorGreen: t.accent_color || '#8DC63F',
          logo: t.logo_url || local.logo || null,
          plan: t.plan || local.plan || 'pro',
          adminEmail: local.adminEmail || '',
          createdAt: t.created_at || local.createdAt || '',
        };
      });
      // Garder les entreprises locales non encore dans Supabase
      const supaIds = new Set(supaCompanies.map(t => t.id));
      const localOnly = localCompanies.filter(c => !supaIds.has(c.id));
      saSaveCompanies([...merged, ...localOnly]);
    } else {
      // Pas de tenants Supabase → init compte local par défaut si liste vide
      const existingCompanies = saGetCompanies();
      if (existingCompanies.length === 0) {
        const restalliance = {
          id: 'co_restalliance',
          name: localStorage.getItem('sa_tenant_name') || 'Mon Organisation',
          tagline: 'HACC.PRO Platform',
          colorNavy:  localStorage.getItem('sa_color_navy')  || '#0F2240',
          colorGreen: localStorage.getItem('sa_color_green') || '#8DC63F',
          logo: localStorage.getItem('sa_logo') || null,
          plan: 'enterprise',
          adminEmail: '',
          createdAt: new Date().toISOString(),
        };
        saSaveCompanies([restalliance]);
        localStorage.setItem('sa_active_company', 'co_restalliance');
      }
    }
  } catch(e) {
    console.warn('[renderSuperAdmin] tenant sync failed', e);
    // Fallback : init local si vide
    const existingCompanies = saGetCompanies();
    if (existingCompanies.length === 0) {
      saSaveCompanies([{
        id: 'co_restalliance', name: 'Mon Organisation', tagline: 'HACC.PRO Platform',
        colorNavy: '#0F2240', colorGreen: '#8DC63F', logo: null,
        plan: 'enterprise', adminEmail: '', createdAt: new Date().toISOString(),
      }]);
      localStorage.setItem('sa_active_company', 'co_restalliance');
    }
  }

  const tenantName = localStorage.getItem('sa_tenant_name') || 'Mon Organisation';
  const colorNavy  = localStorage.getItem('sa_color_navy')  || '#0F2240';
  const colorGreen = localStorage.getItem('sa_color_green') || '#8DC63F';
  const logoSrc    = localStorage.getItem('sa_logo') || 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFAAAABQCAYAAACOEfKtAAATJklEQVR42u2ceZgU1bXAf7eqeu/pnp6NbWBYZFEQAZVNRdCYaOIeY4zRuMXdGJdEX3CLe4zGxKgxRo0anpr43MW4IRHFgIgiyDoswrAMMAMz0zPT3dVVt877o3oGSDQmLCJf+nxffTPTXV333l+fc8+55547yvM8oSjbLUYRQRFgEWARYBFgUYoAiwCLAIsAi1IEWARYBFgEWJQiwC9RrK9SZzzPwxM/u6aUQqEAEBEE/3VDGRiGKgLcWrT2MAyFaZqY/+b9IoJpGv/dAD3PQymFZfnYFi5dycyPFjK/dhXrNm6irT2LUopkPEp1t0r2G9SXkcMH0a+mR+fnRditGmntTq3rAPfnl6byhycmM332ApwNm8DVYFlgGSAC2vOvgEWsWwUTxg7jvFOP5pgjxgLgunq3aaPaHSl9rTWWZfHJkhVceeMDvPnae5DPk+zTg7H7D2bkfgPpV9OdVDKOeMKm5laWrlzL+3MW8ffZC8iu3QglUb71jbHcdf1FDOrXC8d1sUxzt5iR7IpLay2O60o+70je2XLl7LyIiDz76juS3PtoIba/9B5zqvzygadk5Zr18kWyaNkqmXjHw1I+9AQhfoCUDzlWXp7ynoiI5Oz8Nm3lHUcc1xWtteyqcbJLwDnOv4Tw9OS/iVk9QSgfI2deeYdsaGzqfM919ZbBO644W8HQWnfet2TFavnGaVcJZWMk0Pswef7Vd/5lmx2f39nj3akmrD2v04xsO8+c+UuZs2AZq9ZtpD2TJRwKEg6Hue/x52let5HrJp7HTVecBYDjuJimgVLqCyxG8DyPQMBCa81ZP7mLSU+9QlmXFFee+13SbRnaMxki4RA1PboybJ++7L/vAMLh0C6ZL3cawA6n0Jxu44FJLzLpmTdZNH8ptLSBYYCh/J/JEtCaU797JE/cMxHHdbcrtnO1xjJNlFIMOeIcFixYDulWcDQoBQgoA+IRBu3Tl9NP+joX/uB4UsmSnQpxpwDsgPfq27O47LrfUjt7AZSWMPLAfTlk5BD696mmNBFn4bI6fnnfkySScea98TBV5aV4nodh/GeDERFEwDQNzrz8dh7/38nU9K9h1PBB7L1XL8pTSXK5PCtWr+f9jxYyZ85CSLez14hB/PrGH3H04WN2HsQdnQMcxxURkT88NVnoMV4oHS3HnXOtTP/gE/G8beehaTPnCtER8uMb7++cl7anTdf12zzjil/IoLHfk6df/ps0p9s+c+5zXVfenjFHjjlrolA6Suh2iNz3+AsiIuI47u51Ik5hIM+++o7Q9RBR1RPk148829l5z/Mk7ziSzeXEcV155q/vCLER8tKb73W+t71t/unZ1+Sntz6wDSzHdbd44LwjTuH5HXLXg0+Lqp4gVIyVJ154c6dA3G6Arut7tLq1G6Ry2IlC+Ri559HnOjXLcd1/0piFy1aJ6nGozPp4YeeAt6ftbM6W2XMXdX5Jzmd4WO254uq8aF0AWHDgdz/8jFA+RpJ7HyVLV67p7N+XDrDDdM+f+GshMkxOOP96ERGx858dLrhaiyeejDnhYnnlrRk7BLBDq1xXb9OW9rS42hHt6W00c17DNFnZslhc13/92B9eK0SHyw8uv22H+7FdAN1CPFa3boMkBx8twV7jZfYnS8TzPt8kOrRw2sw5MunZ13fYfNytwWlXXL1t7Lmm7WN5Z8Ntctm0wfKzd46V1nyTOK4jnojMnrdYgjWHSWzgkbJ81drOL2N7+mFtp+PBNAymTP+IltUbGP21UYwY3B8R73M9m2EYiAjjRg0j3da+w9kUs/A8EQ/D8GPPNqeB+U0v82HDUzTkZrOgoRmxB/D4UU8QC8TRnkY8jxFDBjBi+D7MfGsGU977iPN6dccTD4P/fCm4Q378g7lLUHmH0fsNQimF9rx/C34iHtuu9qSQJwSw8w6eaAzDZE37PJ5efim/nHcgk5aew4r0NNY1a9Y1VnDHuBeIBeNoz483dSEDNGrYQJSr+WDu4i8/G2MUBrFmfQNiQHW3SjI5B0PJFy7olVJ4ngcoDEMhIn7ci8LzOn7/rNjPT1tprWlsaiWRCGMaYT5qeIFHlnwfx8sQNkuIGBW4nsG7qzZyy0H30i+1N67nYCqr8wvMZPP07N4FMQ3Wrm/sTNR+iSl9f5R5x+38K5fL09iURimFiD/gz9IgH4S/8sjaeZaurKeuflNnUrVDw+QfoBuGoi2TY3ndBiJhi0gwzNLmGTy06AxELCJmFUIAVxSvL25gXI9T+fbAM3C1g4GJiP+cxqZWMrm8/0UrhePqQhtfogZ2pNdLYlEQqFu3gXAoyLK69UTDYcpK49usGrak6H3aecelsSlNczqDANmWdrI5h4pUCcl4BMsyUVtpXs52aGppo6Gple5dkiTicTZkVnDvJ6dgu5qQGSWrXcIBg5mrsminmpsP/hUigmGYndrV1NLGmvVN7NO/J6vXbQDtURKL+JopgrkdFLcPoCdgwoC+PcAymTlnEdpzsUyDVesaaW5tp6y0hGg42Oko3LxL1s6TsfM4rodpGTieg+toypJJMrkc6xub2dTSRiQUIGBZiAi242LbDrbj0qUiQUVpgoyT5jdzTqUhU08skCLnuAQDwvLNitlrMjx1zENUxbriuA6Ios3Osam5nZbWdr8/4jFr7hIwDPr26r5lTMaXpIEdZjZu5FBuT8SZM6+WjxcspU+vnqxvbKKlNUNTOkOgQ5OUIhwKEo0GyeRyzF9Yx5Spc3julenEEorn/3QLpfEEtm2DgpydJ5fLbzFfBRWlMSrK4iCK++dewMLNs0iGK8k6LgETNrcHmFLbzHEDTuY7g05h/aYmGje1gfIzPaDwRKgqT7Kg9lM++HgxxCOMG7nvDpnwds2BhumHEIeO2o999tmLfDrDLb+dRJfyBAqFoQwClomrPUKhEJZlUbtiNXff/yInnnYz37v0ah59/x4OPfcT2txazrzgTkIhRSBgYZkmwUCAYDBAKBggEDCJhINUlMUxlcWTS27lrdVPETF9eI6GnAPTl2sCupw7xt1KLpdn7frNOK7G1X6Kzdc86FaZ4tb7niTXnGbAoD4cftCIgql/iU5EFdLy4VCQ/7nwFLAs3nh7Njfd8zj77d0b7Qm27RAOBXj+1WmcffktfOf863lw6q/wRv2Vw25YzDcm1lNxyDruelJRu3o2l078PV2qSlHKz7JYpoFpGpimSVkqRtAKMn3Nizy24OeEzQpyroft+HPXvLVB1m9o48Zx17BXqi8t2RyRUARD+ZOo47poLQzduze33/8Ek6fMBMPkqgtOIRaNoLX+wjzkTo8DTdNEa81pJ3yNk0/6Otgut933JFff9gA1PcqpqiglHAyRbssw8+2ZODlF/zHC0JOaMEtcnFyAuYtdlthrePAVg6dfeZHfPPg8PbuXg4jvSAxFsiRMNBRmZctifjH7PFAx8p7C1iBKsWZzgEXLMwztMYYrR1/Em+9+wPW3PsjST+uIhMMErACVZSl6dS/jujsf5qZ7JkE2x/HHH8bZJx+F1hpzB/ZSdigf2OFhc3ae4354PVPe+DsETEYfOJiLzzie4fsOoqa6GxddczdPPP0qwVCU4ZctJrVXGidroAyhNeNy9teq0KsquOBEk9efuIcJBw1lU1MrkXCQklgY281w8dQjWNL0MbFgEu1pDAMcB2YvDNHenmH6pa8xJDmYfY88m9W1qwiXlzJ6xGBuv/pcVtSt5d5Hn2PmrPnguIyfcCAv/fE2YtHwNnP6bkmodswfdt7h8p/fz0NPvYLb0gpBi569uzN8yACaW9p4591ZhCKlRLq2M+wnizEMQbRCi4fpGVx9YjUz31Q8fFN/Ppz8exIlEUxLETAD3DLjAp5b9hCpaBdczwEB0xQWLwlTv7KZ08afxaRT7+XJF9/iyhvupymTxc5kwTSoLEvQUL8JcjZGsoSzv3sUv73pR0TCoc596d2ekRYRf3WiFO/OmsfvHn+JabPm0rA5jZvNEYyGGDKoL/Nrl6Pbg3Q9tJ6Bp63CSVsYJmRtTa9UmKu+Vc2fHstQN+0k/vzA1UTCIZ5b8kd+PuM8UpFKNNrPRAc81q8Osmy+oiyVYP5100iFUyxesQ7HcVm+ci2PP/M6b03/AGUoUok440YN5cLTj2P8mGHbbOp/JYqLlPJDBK01h4wcylP3X8ucvz7IgL7VmJ5m4iWn8dqkX3H42APRXhMNf+/K2hkpiLvkbAhYJrUbszw5czNnnRmnauQLrPk0w6q2Wm59/0rCVil5D1xX4SmhucmkbkEcSWe47sif0jVRxcq1DSiliEfDjB87nMMOHkG+Oc3Afj2Z+/rD/OV3NzB+zDC01jsN3k6tzvKXWwau1riuS5fKMirLkuicjWma2Haem644m779anCdLKuf60NLfQSJCHltEAoGmLqkmfeWt3PGhdDa6xF+MvUCsp4NKoDjebgCeQ1r5iSx63MM73sQl0w4g03NrWSyefaq6Uo4FCDdlmFTUwu4mqqyJFUVKRzXxdUawzB2GrxdUt5mFjooIsSiEdAebZksdt6lsiLFw3dejTI93LYAdU/WkHcVLuCKwsPgL7MbaGiy+M0Hd/Lhhg8Jm0ls7ZF3QJua+nlx0isiKNfkntNvQGFQ39DMgN7diIaDOI6/W2fbDmiPaCRUSFgoTGPnl3/skoKSjoV7aTIOntCetTEtk4bNLUwYM4zrrjiHfHYT9qflrHuxBzrk4TgGShk0tnvc/eZa5nxqEjFi2I7gOgaeAc1rIzR9XI5Ot3Da4d/jkMEHsmFTM316VBGLhrZZp2dtG8SjNBH3NW4XFbDsGoCF3qaSJf5gcnk/2aoUdt7h+h+fzmGHH0w230R6Zg82zUqhI3nsvKAMqG/R5LWH63k4Ghw8bFvRML0cJ+2SSnblF2ddjidCKhkjFg3h+0LpLH3L5vIgkEyUbNOnPQJgR19TiTigyOZsv6JABFf7RZSP3PlTKqvKcb0cmyfX0LI6SD6UJ+d4iPJw8Mjjkfc88gHNxllJnA0xdKaV68+4hO4VleTzDgHTxHFdRDy0FjxPChmcPChFWWkJ/5Qf+8oDLEiyJAoK2jNZP3NhWcQiIUzDoHd1V5596GZc10ZyAZqe6Y9jG3gBjYvgKR84YU12RYzsJ2U4uRaGDjmAS0/+PgDhUBDTNAlYll+caRqYllHQehvAn0b2uPpA1QEw1mnCnic0pduYs2AZ6dY2NmzcTJ+a7tz6s/O55qb7iFJJ63N9SZxai9IKRKECgm4P0Px2F0QbiDZ48Opr2NjQxP+9PAVlmAQCFslEnK6VZXTrUk5zOkdFyvIBGqrThFF7EkC2MuF4hI/m1zLu2xejtUt1lwpG778P+w/pD8DEi7/PzDmLeHnyVCILu9D6RobEN1fjpQOokOfDa4nhtq3n3DN+wOh9h9LWnuHr40eztr6BJStW896sT/h44TKW19WTbstSEo/iaA+iYZKFhKnakzSwozg8mYiBFSCTzXHytyZw7BFjqanuxojBfTrvdRyXx+66ijHL6qhdtgp5p4b2sjwlE+ppmdqN7IJyPNro1XsAd132I7xCeDSwXy8G9uvFYQfvD0BLa4bZ85ayZPlqXpk6g6kzPoJggNKCI9tVCI1dacKliRJAUVVRxs8uOY1hgwcQCYW2uTUQsCgrTfD8QzdTUV6KZzhk3+hN++t9yLxbjaksDNvith9fQjgUxnGczwyEAwGL6u5VHHPEQdx57UVUlqd8L1yYRvYoE+7QwERJDDMcQoC849CcbmNNfQOfLKmlfkMjdWs3Ut+wmcbNzeRsF2VZYAi4Jq2vVqMCGkEIBpJcd8djXHfHo0QjYUriUVKJOOWlCbpUpOjZvZKKshThcISe3aoIh0MoZWCFgsT3SBMu9DYeDWMqSLe2c/lN91G7vI6NjZvJtWf9QnJFoXbQBAWBoO9VBYGQC55/i6c9Vq6u7wzS8bwtl4gfogQswtEIVRUp+vftRWt7BssyiRdSVii1ZzkRESFZEmPkfgOZPu0Dpiyvg5IooViURCrRuVPmiRQqDApBcCFgU96W0E0B4XDQ1+3CAZyOLVClFCgfsp13qFu1jroFyyEYZOyhI0gm4v5SbheNc5dV6fvLOd90p7z7IZPfmsl7s+ezom497ek2cF2fjGn6WmganfvFHRv3HYWmHR30RAoBuQda/GfoAmnLIJqI07emOwcfMIRvThjFEeMOIBwM4MkuU8Bdf8xh6wnfdV1Wrl7PouV1LFq6iqUr17CmvpHGphaa0+20ZbLk7DyOo/E8XTj2pfx9EsMgGLAIh0PEoxESJTEqy5JUd62gf+8eDOrXk733qqFPr25YlvVPWXPYQwGKUCjlkG0G9o+Ss/NkczbZnI2dd3Bd7dexAMrwd/nCwQDhcIhoOEQoFPzcZ7muv425daXDHgvwH2HKVnMeyq+z2Z4cnYhsOZxYMFGljMK8yJcm6qvyz8e2NrXPs7qtwSj11Tix+ZU57ro1EPXVOc26e7Mx/w1SBFgEWARYBFgEWJQiwCLAIsAiwKIUARYBFgEWARalCLAIsAjwv0f+H+9c/YHquC5OAAAAAElFTkSuQmCC';

  const html = `
  <style>
    .sa-tabs { display:flex; gap:6px; margin-bottom:16px; flex-wrap:wrap; }
    .sa-tab { padding:8px 14px; border:1.5px solid var(--border); border-radius:12px; font-size:.78rem; font-weight:700; cursor:pointer; background:#fff; color:var(--muted); font-family:var(--font); transition:all .15s; }
    .sa-tab.active { background:var(--navy); color:#fff; border-color:var(--navy); }
    .sa-card { background:#fff; border:1px solid var(--border); border-radius:14px; padding:18px 20px; margin-bottom:14px; }
    .sa-card-title { font-size:.88rem; font-weight:800; color:var(--navy); margin-bottom:14px; display:flex; align-items:center; gap:8px; }
    .sa-field { margin-bottom:12px; }
    .sa-label { font-size:.68rem; font-weight:800; text-transform:uppercase; letter-spacing:.5px; color:var(--muted); margin-bottom:5px; display:block; }
    .sa-input { width:100%; border:1.5px solid var(--border); border-radius:12px; padding:9px 12px; font-size:.85rem; font-family:var(--font); outline:none; box-sizing:border-box; transition:border .15s; }
    .sa-input:focus { border-color:var(--navy); }
    .sa-btn { padding:10px 18px; border:none; border-radius:10px; font-size:.82rem; font-weight:800; cursor:pointer; font-family:var(--font); }
    .sa-btn-primary { background:var(--navy); color:#fff; }
    .sa-btn-light { background:#f1f5f9; color:var(--muted); }
    .sa-color-row { display:flex; align-items:center; gap:10px; }
    .sa-color-swatch { width:36px; height:36px; border-radius:8px; border:2px solid var(--border); cursor:pointer; flex-shrink:0; }
    .sa-logo-drop { border:2px dashed var(--border); border-radius:10px; padding:14px; text-align:center; background:#fafafa; cursor:pointer; }
    .sa-plan-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
    @media(max-width:600px){ .sa-plan-grid { grid-template-columns:1fr; } }
    .sa-plan-card { border:2px solid var(--border); border-radius:14px; padding:14px; transition:all .15s; }
    .sa-plan-card.sel { border-color:var(--navy); background:rgba(15,34,64,.04); }
    .sa-kpi-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(130px,1fr)); gap:10px; margin-bottom:18px; }
    .sa-kpi { background:#fff; border:1px solid var(--border); border-radius:14px; padding:14px; text-align:center; }
    .sa-kpi-val { font-size:1.8rem; font-weight:900; line-height:1; }
    .sa-kpi-label { font-size:.62rem; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.5px; margin-top:4px; }
  </style>

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#0F2240,#1a3558);border-radius:16px;padding:18px 22px;margin-bottom:18px;color:#fff;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
    <div style="display:flex;align-items:center;gap:14px">
      <img src="${logoSrc}" width="44" height="44" style="border-radius:12px;object-fit:contain;background:rgba(255,255,255,.1)">
      <div>
        <div style="font-size:.6rem;opacity:.5;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:3px">Console Super Admin</div>
        <div style="font-size:1.15rem;font-weight:900">${tenantName}</div>
        <div style="font-size:.7rem;opacity:.55;margin-top:2px">HACC.PRO Platform</div>
      </div>
    </div>
    <div style="display:flex;gap:14px">
      <div style="text-align:center"><div style="font-size:1.5rem;font-weight:900;color:#86efac">${_sites.length}</div><div style="font-size:.58rem;opacity:.5;text-transform:uppercase">Sites</div></div>
      <div style="text-align:center"><div style="font-size:1.5rem;font-weight:900;color:#86efac">${_records.length}</div><div style="font-size:.58rem;opacity:.5;text-transform:uppercase">Saisies</div></div>
      <div style="text-align:center"><div style="font-size:1.5rem;font-weight:900;color:#86efac">${_gmos.length}</div><div style="font-size:.58rem;opacity:.5;text-transform:uppercase">GMOs</div></div>
    </div>
  </div>

  <!-- Tabs -->
  <div class="sa-tabs">
    <button class="sa-tab active" onclick="saSwitchTab('stats',this)">📊 Statistiques</button>
    <button class="sa-tab" onclick="saSwitchTab('entreprises',this)">🏢 Entreprises</button>
    <button class="sa-tab" onclick="saSwitchTab('inscrits',this)">👥 Inscrits</button>
    <button class="sa-tab" onclick="saSwitchTab('plans',this)">💰 Plans & Tarifs</button>
  </div>

  <!-- Stats -->
  <div id="sa-tab-stats">
    <div class="sa-card">
      <div class="sa-card-title">🔍 Voir par entreprise</div>
      <div id="sa-company-selector" style="display:grid;gap:10px">
        ${saGetCompanies().map(c => `
        <div onclick="saLoadCompanyStats('${c.id}')" id="sa-co-card-${c.id}" style="border:1.5px solid var(--border);border-radius:12px;padding:12px 14px;cursor:pointer;display:flex;align-items:center;gap:12px;transition:all .15s" onmouseover="this.style.borderColor=getComputedStyle(document.documentElement).getPropertyValue('--navy')" onmouseout="if(!this.classList.contains('active'))this.style.borderColor=''">
          <div style="width:36px;height:36px;border-radius:8px;background:${c.colorNavy||'#0F2240'};display:flex;align-items:center;justify-content:center;flex-shrink:0">
            ${c.logo ? `<img src="${c.logo}" height="24" style="object-fit:contain;border-radius:4px">` : `<span style="color:#fff;font-size:1rem">🏢</span>`}
          </div>
          <div style="flex:1">
            <div style="font-size:.85rem;font-weight:800">${c.name}</div>
            <div style="font-size:.68rem;color:var(--muted)">${c.tagline||''}</div>
          </div>
          <span style="font-size:.65rem;font-weight:800;padding:2px 8px;border-radius:20px;background:#f3e8f3;color:var(--navy)">${c.plan||'pro'}</span>
        </div>`).join('')}
        ${saGetCompanies().length === 0 ? '<div style="text-align:center;padding:20px;color:var(--muted)">Aucune entreprise — créez-en une dans l\'onglet Entreprises</div>' : ''}
      </div>
    </div>
    <div id="sa-company-stats-panel" style="display:none">
      <div class="sa-card">
        <div class="sa-card-title" style="justify-content:space-between">
          <span id="sa-stats-company-name">—</span>
          <button onclick="saCloseCompanyStats()" style="background:none;border:none;font-size:.75rem;color:var(--muted);cursor:pointer;font-family:var(--font)">✕ Fermer</button>
        </div>
        <div id="sa-stats-content"><div class="loading"><div class="spinner"></div>Chargement…</div></div>
      </div>
    </div>
  </div>

  <!-- Entreprises -->
  <div id="sa-tab-entreprises" style="display:none">
    <div class="sa-card">
      <div class="sa-card-title" style="justify-content:space-between">
        <span>🏢 Entreprises clientes</span>
        <button class="sa-btn sa-btn-primary" style="font-size:.75rem;padding:7px 14px" onclick="saOpenCompanyModal()">➕ Nouvelle entreprise</button>
      </div>
      <div id="sa-companies-list">${saRenderCompaniesHTML()}</div>
    </div>
  </div>

  <!-- Modal Entreprise -->
  <div id="sa-company-modal" style="display:none;position:fixed;inset:0;background:rgba(20,5,25,.78);z-index:9999;align-items:center;justify-content:center;padding:16px">
    <div style="background:#fff;border-radius:18px;width:100%;max-width:480px;max-height:90vh;overflow-y:auto;padding:24px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div style="font-size:1rem;font-weight:900;color:var(--navy)" id="sa-modal-title">🏢 Nouvelle entreprise</div>
        <button onclick="saCloseCompanyModal()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:var(--muted)">✕</button>
      </div>
      <input type="hidden" id="sa-modal-id">

      <!-- Logo -->
      <div class="sa-field">
        <span class="sa-label">Logo</span>
        <div style="display:flex;align-items:center;gap:14px">
          <div class="sa-logo-drop" style="width:80px;height:80px;flex-shrink:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:6px" onclick="document.getElementById('sa-modal-logo-file').click()">
            <img id="sa-modal-logo-preview" src="" height="50" style="object-fit:contain;max-width:65px;display:none">
            <div id="sa-modal-logo-placeholder" style="font-size:1.6rem">🏢</div>
            <div style="font-size:.6rem;color:var(--muted);margin-top:4px">Changer</div>
          </div>
          <input type="file" id="sa-modal-logo-file" accept="image/*" style="display:none" onchange="saModalPreviewLogo(this)">
          <div style="flex:1">
            <div class="sa-field" style="margin-bottom:8px">
              <span class="sa-label">Nom entreprise *</span>
              <input type="text" class="sa-input" id="sa-modal-name" placeholder="Ex: Sodexo, Compass..." oninput="saModalUpdatePreview()">
            </div>
            <div class="sa-field" style="margin-bottom:0">
              <span class="sa-label">Slogan (optionnel)</span>
              <input type="text" class="sa-input" id="sa-modal-tagline" placeholder="Conformité HACCP simplifiée">
            </div>
          </div>
        </div>
      </div>

      <!-- Couleurs — Thèmes prêts à l'emploi -->
      <div class="sa-field">
        <span class="sa-label">Thème de couleurs</span>
        <div id="sa-theme-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px"></div>
        <!-- Couleurs custom (dépliables) -->
        <div style="margin-bottom:10px">
          <button onclick="saToggleCustomColors()" style="background:none;border:none;font-size:.7rem;color:var(--muted);cursor:pointer;font-family:var(--font);padding:0;display:flex;align-items:center;gap:4px">
            <span id="sa-custom-arrow">▶</span> Couleurs personnalisées
          </button>
          <div id="sa-custom-colors" style="display:none;margin-top:10px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <div>
                <span class="sa-label" style="font-size:.6rem">Principale</span>
                <div class="sa-color-row">
                  <input type="color" id="sa-modal-color-navy" value="#0F2240" class="sa-color-swatch" oninput="saModalSyncColor('navy');saModalUpdatePreview();saDeselectThemes()">
                  <input type="text" class="sa-input" id="sa-modal-color-navy-txt" value="#0F2240" maxlength="7" oninput="saModalSyncColor('navy-txt');saModalUpdatePreview();saDeselectThemes()">
                </div>
              </div>
              <div>
                <span class="sa-label" style="font-size:.6rem">Accent</span>
                <div class="sa-color-row">
                  <input type="color" id="sa-modal-color-green" value="#8DC63F" class="sa-color-swatch" oninput="saModalSyncColor('green');saModalUpdatePreview();saDeselectThemes()">
                  <input type="text" class="sa-input" id="sa-modal-color-green-txt" value="#8DC63F" maxlength="7" oninput="saModalSyncColor('green-txt');saModalUpdatePreview();saDeselectThemes()">
                </div>
              </div>
            </div>
          </div>
        </div>
        <!-- Preview bar -->
        <div id="sa-modal-preview-bar" style="border-radius:10px;padding:11px 14px;display:flex;align-items:center;gap:10px;background:#0F2240">
          <img id="sa-modal-preview-logo-bar" src="" height="28" style="border-radius:5px;object-fit:contain;display:none">
          <span id="sa-modal-preview-placeholder-bar" style="font-size:1.1rem">🏢</span>
          <div style="flex:1"><div id="sa-modal-preview-name" style="font-size:.88rem;font-weight:900;color:#fff">Nom entreprise</div></div>
          <div id="sa-modal-preview-dot" style="width:10px;height:10px;border-radius:50%;background:#8DC63F"></div>
        </div>
      </div>

      <!-- Plan -->
      <div class="sa-field">
        <span class="sa-label">Plan tarifaire</span>
        <select class="sa-input" id="sa-modal-plan" style="cursor:pointer">
          <option value="solo">Solo — 29€/mois (1 cuisine)</option>
          <option value="multi" selected>Multi — 49€/mois (jusqu'à 3 cuisines)</option>
          <option value="enterprise">Entreprise — Sur devis (illimité)</option>
        </select>
      </div>

      <!-- Accès admin -->
      <div class="sa-field" style="background:#faf6fa;border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:0">
        <span class="sa-label" style="color:var(--navy)">🔑 Accès administrateur</span>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div>
            <span class="sa-label" style="font-size:.6rem">Email admin</span>
            <input type="email" class="sa-input" id="sa-modal-admin-email" placeholder="admin@entreprise.fr" autocomplete="off">
          </div>
          <div>
            <span class="sa-label" style="font-size:.6rem" id="sa-modal-pass-label">Mot de passe</span>
            <input type="password" class="sa-input" id="sa-modal-admin-pass" placeholder="••••••••" autocomplete="new-password">
          </div>
        </div>
        <div id="sa-modal-pass-hint" style="font-size:.67rem;color:var(--muted);margin-top:5px">Créera le compte Supabase automatiquement si la clé service_role est configurée.</div>
      </div>

      <!-- Actions -->
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
        <button class="sa-btn sa-btn-primary" style="flex:1" onclick="saSaveCompany()">💾 Enregistrer</button>
        <button class="sa-btn" style="background:#fef2f2;color:#dc2626;display:none" id="sa-modal-delete-btn" onclick="saDeleteCompany()">🗑 Supprimer</button>
        <button class="sa-btn sa-btn-light" onclick="saCloseCompanyModal()">Annuler</button>
      </div>
    </div>
  </div>

  <!-- Plans -->
  <div id="sa-tab-plans" style="display:none">
    <div class="sa-card">
      <div class="sa-card-title">💰 Plans tarifaires</div>
      <div class="sa-plan-grid">
        ${[
          {name:'Solo',price:'29€',period:'/mois',sites:'1 cuisine',users:'Toutes options',col:'#0369a1',sel:false},
          {name:'Multi',price:'49€',period:'/mois',sites:'3 cuisines',users:'+19€/cuisine supp.',col:'#7c3aed',sel:true},
          {name:'Entreprise',price:'Sur devis',period:'',sites:'Illimité',users:'Illimité',col:'#0f2240',sel:false},
        ].map(p=>`
        <div class="sa-plan-card ${p.sel?'sel':''}">
          <div style="font-size:.65rem;font-weight:800;text-transform:uppercase;color:${p.col};letter-spacing:.5px;margin-bottom:4px">${p.name}</div>
          <div style="font-size:1.4rem;font-weight:900;color:${p.col}">${p.price}<span style="font-size:.75rem;color:var(--muted);font-weight:400">${p.period}</span></div>
          <div style="font-size:.7rem;color:var(--muted);margin-top:4px">${p.sites} · ${p.users}</div>
        </div>`).join('')}
      </div>
      <div style="margin-top:16px">
        <span class="sa-label">Modifier le plan actuel</span>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input type="number" class="sa-input" id="sa-price" placeholder="Prix €/mois" style="max-width:130px">
          <input type="text" class="sa-input" id="sa-plan-name" placeholder="Nom du plan" style="flex:1">
          <button class="sa-btn sa-btn-primary" onclick="saUpdatePlan()">Enregistrer</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Inscrits -->
  <div id="sa-tab-inscrits" style="display:none">
    <div class="sa-card">
      <div class="sa-card-title" style="justify-content:space-between">
        <span>👥 Nouveaux inscrits</span>
        <button onclick="saLoadInscrits()" style="background:none;border:none;font-size:.75rem;color:var(--muted);cursor:pointer;font-family:var(--font)">🔄 Actualiser</button>
      </div>
      <div id="sa-inscrits-content"><div class="loading"><div class="spinner"></div>Chargement…</div></div>
    </div>
  </div>`;

  setContent(html);
}

// ── Fonctions Super Admin ─────────────────────────────────────
function saSwitchTab(tab, btn) {
  ['stats','entreprises','plans','inscrits'].forEach(t => {
    const el = document.getElementById('sa-tab-'+t);
    if (el) el.style.display = t===tab ? 'block' : 'none';
  });
  document.querySelectorAll('.sa-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (tab === 'inscrits') saLoadInscrits();
}

async function saLoadInscrits() {
  const el = document.getElementById('sa-inscrits-content');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="spinner"></div>Chargement…</div>';
  try {
    const [profiles, tenants] = await Promise.all([
      supaAdmin('GET', '/rest/v1/profiles?select=id,full_name,role,created_at,tenant_id&order=created_at.desc&limit=100', null),
      supaAdmin('GET', '/rest/v1/tenants?select=id,name&limit=500', null).catch(() => [])
    ]);
    if (!profiles || !profiles.length) {
      el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted)">Aucun inscrit pour l\'instant.</div>';
      return;
    }
    const tenantMap = {};
    (tenants || []).forEach(function(t) { tenantMap[t.id] = t.name; });
    const ROLE_LABELS = { directeur:'Directeur', chef_secteur:'Chef de secteur', siege:'Siège', super_admin:'Super Admin', cuisinier:'Cuisinier' };
    const rows = profiles.map(p => {
      const d = p.created_at ? new Date(p.created_at).toLocaleDateString('fr-FR') : '—';
      const tenant = tenantMap[p.tenant_id] || p.tenant_id?.slice(0,8) || '—';
      const role   = ROLE_LABELS[p.role] || p.role || '—';
      return `<div style="display:grid;grid-template-columns:1fr 1fr 1fr 80px;gap:8px;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);font-size:.82rem">
        <div style="font-weight:800;color:var(--navy)">${_esc(p.full_name||'—')}</div>
        <div style="color:var(--muted)">${_esc(tenant)}</div>
        <div><span style="background:#f3e8f3;color:var(--navy);border-radius:6px;padding:2px 8px;font-size:.7rem;font-weight:800">${_esc(role)}</span></div>
        <div style="color:var(--muted);font-size:.72rem">${d}</div>
      </div>`;
    }).join('');
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 80px;gap:8px;padding:6px 0 8px;border-bottom:2px solid var(--border);font-size:.65rem;font-weight:900;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)">
        <div>Nom</div><div>Entreprise</div><div>Rôle</div><div>Inscrit le</div>
      </div>
      ${rows}
      <div style="font-size:.72rem;color:var(--muted);margin-top:10px;text-align:right">${profiles.length} profil(s)</div>`;
  } catch(e) {
    el.innerHTML = '<div style="padding:16px;color:#dc2626;font-size:.82rem">Erreur : ' + _esc(e.message) + '</div>';
  }
}

function _esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Gestion des entreprises (localStorage) ────────────────────
function saGetCompanies() {
  try { return JSON.parse(localStorage.getItem('sa_companies') || '[]'); } catch(e) { return []; }
}
function saSaveCompanies(list) {
  localStorage.setItem('sa_companies', JSON.stringify(list));
}

function saRenderCompaniesHTML() {
  const companies = saGetCompanies();
  if (!companies.length) return `
    <div style="text-align:center;padding:28px 0;color:var(--muted)">
      <div style="font-size:2rem;margin-bottom:8px">🏢</div>
      <div style="font-size:.85rem;font-weight:600">Aucune entreprise</div>
      <div style="font-size:.75rem;margin-top:4px">Créez votre première entreprise cliente</div>
    </div>`;
  const planLabels = { starter:'Starter', pro:'Pro', enterprise:'Enterprise' };
  const planColors = { starter:'#0369a1', pro:'#7c3aed', enterprise:'#0f2240' };
  return companies.map(c => {
    const isActive = (localStorage.getItem('sa_active_company') === c.id);
    const logoHtml = c.logo
      ? `<img src="${c.logo}" height="32" style="object-fit:contain;max-width:48px;border-radius:5px">`
      : `<span style="font-size:1.4rem">🏢</span>`;
    return `
    <div style="border:1.5px solid ${isActive?'var(--green)':'var(--border)'};border-radius:14px;padding:14px;margin-bottom:10px;background:${isActive?'#f0fdf4':'#fff'}">
      <!-- Preview bar -->
      <div style="border-radius:12px;padding:10px 14px;display:flex;align-items:center;gap:10px;margin-bottom:10px;background:${c.colorNavy||'#0F2240'}">
        ${logoHtml}
        <div style="flex:1">
          <div style="font-size:.9rem;font-weight:900;color:#fff">${c.name}</div>
          ${c.tagline?`<div style="font-size:.65rem;color:rgba(255,255,255,.5);margin-top:1px">${c.tagline}</div>`:''}
        </div>
        <div style="width:9px;height:9px;border-radius:50%;background:${c.colorGreen||'#8DC63F'}"></div>
      </div>
      <!-- Infos -->
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:.68rem;font-weight:800;padding:3px 9px;border-radius:20px;background:${planColors[c.plan]||'#64748b'}20;color:${planColors[c.plan]||'#64748b'}">${planLabels[c.plan]||c.plan}</span>
          ${isActive?'<span style="font-size:.68rem;font-weight:800;padding:3px 9px;border-radius:20px;background:#dcfce7;color:#166534">✅ Actif</span>':''}
          <span style="font-size:.7rem;color:var(--muted)">${c.createdAt?new Date(c.createdAt).toLocaleDateString('fr-FR'):''}</span>
        </div>
        <div style="display:flex;gap:6px">
          ${!isActive?`<button class="sa-btn" style="padding:6px 12px;font-size:.72rem;background:#f0fdf4;color:#166534" onclick="saActivateCompany('${c.id}')">Activer</button>`:''}
          ${c.adminEmail?`<button class="sa-btn" style="padding:6px 12px;font-size:.72rem;background:#eff6ff;color:#1d4ed8" onclick="saAccessCompany('${c.id}')">🔓 Accéder</button>`:''}
          <button class="sa-btn sa-btn-light" style="padding:6px 12px;font-size:.72rem" onclick="saOpenCompanyModal('${c.id}')">✏️ Éditer</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function saRefreshCompaniesList() {
  const el = document.getElementById('sa-companies-list');
  if (el) el.innerHTML = saRenderCompaniesHTML();
}

function saOpenCompanyModal(id) {
  const modal = document.getElementById('sa-company-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  window._saModalLogo = null;

  if (id) {
    // Mode édition
    const companies = saGetCompanies();
    const c = companies.find(x => x.id === id);
    if (!c) return;
    document.getElementById('sa-modal-title').textContent = '✏️ Éditer entreprise';
    document.getElementById('sa-modal-id').value = id;
    document.getElementById('sa-modal-name').value = c.name || '';
    document.getElementById('sa-modal-tagline').value = c.tagline || '';
    document.getElementById('sa-modal-color-navy').value = c.colorNavy || '#0F2240';
    document.getElementById('sa-modal-color-navy-txt').value = c.colorNavy || '#0F2240';
    document.getElementById('sa-modal-color-green').value = c.colorGreen || '#8DC63F';
    document.getElementById('sa-modal-color-green-txt').value = c.colorGreen || '#8DC63F';
    document.getElementById('sa-modal-plan').value = c.plan || 'pro';
    document.getElementById('sa-modal-delete-btn').style.display = 'block';
    document.getElementById('sa-modal-admin-email').value = c.adminEmail || '';
    document.getElementById('sa-modal-admin-pass').value = '';
    document.getElementById('sa-modal-admin-pass').placeholder = c.adminEmail ? '(laisser vide = inchangé)' : '••••••••';
    document.getElementById('sa-modal-pass-hint').textContent = c.adminEmail ? 'Laissez le mot de passe vide pour ne pas le modifier.' : 'Créera le compte Supabase automatiquement si la clé service_role est configurée.';
    if (c.logo) {
      const img = document.getElementById('sa-modal-logo-preview');
      img.src = c.logo; img.style.display = 'block';
      document.getElementById('sa-modal-logo-placeholder').style.display = 'none';
      const barImg = document.getElementById('sa-modal-preview-logo-bar');
      barImg.src = c.logo; barImg.style.display = 'block';
      document.getElementById('sa-modal-preview-placeholder-bar').style.display = 'none';
      window._saModalLogo = c.logo;
    } else {
      document.getElementById('sa-modal-logo-preview').style.display = 'none';
      document.getElementById('sa-modal-logo-placeholder').style.display = 'block';
      document.getElementById('sa-modal-preview-logo-bar').style.display = 'none';
      document.getElementById('sa-modal-preview-placeholder-bar').style.display = 'block';
    }
  } else {
    // Mode création
    document.getElementById('sa-modal-title').textContent = '🏢 Nouvelle entreprise';
    document.getElementById('sa-modal-id').value = '';
    document.getElementById('sa-modal-name').value = '';
    document.getElementById('sa-modal-tagline').value = '';
    document.getElementById('sa-modal-color-navy').value = '#0F2240';
    document.getElementById('sa-modal-color-navy-txt').value = '#0F2240';
    document.getElementById('sa-modal-color-green').value = '#8DC63F';
    document.getElementById('sa-modal-color-green-txt').value = '#8DC63F';
    document.getElementById('sa-modal-plan').value = 'pro';
    document.getElementById('sa-modal-delete-btn').style.display = 'none';
    document.getElementById('sa-modal-admin-email').value = '';
    document.getElementById('sa-modal-admin-pass').value = '';
    document.getElementById('sa-modal-admin-pass').placeholder = '••••••••';
    document.getElementById('sa-modal-pass-hint').textContent = 'Créera le compte Supabase automatiquement si la clé service_role est configurée.';
    document.getElementById('sa-modal-logo-preview').style.display = 'none';
    document.getElementById('sa-modal-logo-placeholder').style.display = 'block';
    document.getElementById('sa-modal-preview-logo-bar').style.display = 'none';
    document.getElementById('sa-modal-preview-placeholder-bar').style.display = 'block';
  }
  saModalUpdatePreview();
  saRenderThemes();
}

function saCloseCompanyModal() {
  const modal = document.getElementById('sa-company-modal');
  if (modal) modal.style.display = 'none';
}

function saModalPreviewLogo(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const src = e.target.result;
    window._saModalLogo = src;
    const img = document.getElementById('sa-modal-logo-preview');
    img.src = src; img.style.display = 'block';
    document.getElementById('sa-modal-logo-placeholder').style.display = 'none';
    const barImg = document.getElementById('sa-modal-preview-logo-bar');
    barImg.src = src; barImg.style.display = 'block';
    document.getElementById('sa-modal-preview-placeholder-bar').style.display = 'none';
  };
  reader.readAsDataURL(file);
}

function saModalSyncColor(which) {
  if (which === 'navy') {
    const v = document.getElementById('sa-modal-color-navy').value;
    document.getElementById('sa-modal-color-navy-txt').value = v;
  } else if (which === 'navy-txt') {
    const v = document.getElementById('sa-modal-color-navy-txt').value;
    if (/^#[0-9A-Fa-f]{6}$/.test(v)) document.getElementById('sa-modal-color-navy').value = v;
  } else if (which === 'green') {
    const v = document.getElementById('sa-modal-color-green').value;
    document.getElementById('sa-modal-color-green-txt').value = v;
  } else if (which === 'green-txt') {
    const v = document.getElementById('sa-modal-color-green-txt').value;
    if (/^#[0-9A-Fa-f]{6}$/.test(v)) document.getElementById('sa-modal-color-green').value = v;
  }
}

function saModalUpdatePreview() {
  const navy  = document.getElementById('sa-modal-color-navy')?.value  || '#0F2240';
  const green = document.getElementById('sa-modal-color-green')?.value || '#8DC63F';
  const name  = document.getElementById('sa-modal-name')?.value || 'Nom entreprise';
  const bar = document.getElementById('sa-modal-preview-bar');
  if (bar) bar.style.background = navy;
  const dot = document.getElementById('sa-modal-preview-dot');
  if (dot) dot.style.background = green;
  const nm = document.getElementById('sa-modal-preview-name');
  if (nm) nm.textContent = name || 'Nom entreprise';
}

async function saSaveCompany() {
  const name = document.getElementById('sa-modal-name')?.value?.trim();
  if (!name) { showToast('Le nom est obligatoire', 'warning'); return; }
  const id = document.getElementById('sa-modal-id')?.value;
  const adminEmail = document.getElementById('sa-modal-admin-email')?.value?.trim();
  const adminPass  = document.getElementById('sa-modal-admin-pass')?.value;
  const companies = saGetCompanies();
  const data = {
    name,
    tagline: document.getElementById('sa-modal-tagline')?.value?.trim() || '',
    colorNavy:  document.getElementById('sa-modal-color-navy')?.value  || '#0F2240',
    colorGreen: document.getElementById('sa-modal-color-green')?.value || '#8DC63F',
    plan: document.getElementById('sa-modal-plan')?.value || 'pro',
    logo: window._saModalLogo || null,
    adminEmail: adminEmail || (id ? companies.find(c=>c.id===id)?.adminEmail || '' : ''),
  };

  // Création compte Supabase si email + mdp fournis
  if (adminEmail && adminPass) {
    if (true) {
      try {
        const btn = document.querySelector('#sa-company-modal .sa-btn-primary');
        if (btn) btn.textContent = '⏳ Création compte…';
        // Créer ou récupérer l'utilisateur
        let uid = null;
        try {
          const r = await supaAdmin('POST', '/auth/v1/admin/users', {
            email: adminEmail, password: adminPass, email_confirm: true
          });
          uid = r?.id;
        } catch(e) {
          // User existe peut-être déjà → on met à jour le mdp
          const list = await supaAdmin('GET', `/auth/v1/admin/users?email=${encodeURIComponent(adminEmail)}`, null);
          uid = list?.users?.[0]?.id;
          if (uid && adminPass) {
            await supaAdmin('PUT', `/auth/v1/admin/users/${uid}`, { password: adminPass });
          }
        }
        // Créer/MAJ le profil role=siege
        if (uid) {
          // Résoudre le tenant_id : si id Supabase connu on l'utilise, sinon on cherche par nom
          let tenantId = (id && !id.startsWith('co_')) ? id : null;
          if (!tenantId) {
            try {
              const tRows = await supaGet('tenants', `select=id&name=eq.${encodeURIComponent(name)}&limit=1`);
              tenantId = tRows?.[0]?.id || null;
            } catch(e) {}
          }
          const profileData = { id: uid, full_name: name + ' Admin', role: 'siege', ...(tenantId ? {tenant_id: tenantId} : {}) };
          await supa('POST', '/rest/v1/profiles', profileData).catch(async () => {
            await supa('PATCH', `/rest/v1/profiles?id=eq.${uid}`, { full_name: name + ' Admin', role: 'siege', ...(tenantId ? {tenant_id: tenantId} : {}) });
          });
          showToast('✅ Compte admin créé', 'success');
        }
      } catch(e) {
        showToast('⚠️ Compte non créé : ' + e.message, 'warning');
      }
    }
  }

  if (id) {
    const idx = companies.findIndex(c => c.id === id);
    if (idx >= 0) { companies[idx] = { ...companies[idx], ...data }; }
    // MAJ dans Supabase (tous les tenants avec vrai UUID)
    if (!id.startsWith('co_')) {
      supaAdmin('PATCH',`/rest/v1/tenants?id=eq.${id}`,
        { name: data.name, tagline: data.tagline,
          primary_color: data.colorNavy, accent_color: data.colorGreen },
        {'Prefer':'return=minimal'}
      ).catch(e => console.warn('[tenant PATCH]', e));
    }
  } else {
    data.createdAt = new Date().toISOString();
    // Créer dans Supabase
    try {
      const r_raw = await supaAdmin('POST','/rest/v1/tenants',
        { name: data.name, tagline: data.tagline,
          primary_color: data.colorNavy, accent_color: data.colorGreen,
          plan: data.plan, is_active: true,
          slug: data.name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'') },
        {'Prefer':'return=representation'}
      );
      if (r_raw) {
        const rows = Array.isArray(r_raw) ? r_raw : (r_raw ? [r_raw] : []);
        if (rows?.[0]?.id) data.id = rows[0].id;
      }
    } catch(e) { console.warn('[tenant POST]', e); }
    if (!data.id) data.id = 'co_' + Date.now();
    companies.push(data);
    if (companies.length === 1) {
      localStorage.setItem('sa_active_company', data.id);
      saApplyCompanyBranding(data);
    }
  }
  saSaveCompanies(companies);
  saCloseCompanyModal();
  saRefreshCompaniesList();
  showToast('✅ Entreprise enregistrée', 'success');
}

function saDeleteCompany() {
  const id = document.getElementById('sa-modal-id')?.value;
  if (!id) return;
  if (!confirm('Supprimer cette entreprise ?')) return;
  let companies = saGetCompanies().filter(c => c.id !== id);
  saSaveCompanies(companies);
  if (localStorage.getItem('sa_active_company') === id) {
    localStorage.removeItem('sa_active_company');
    if (companies.length > 0) {
      localStorage.setItem('sa_active_company', companies[0].id);
      saApplyCompanyBranding(companies[0]);
    } else {
      saResetBranding();
    }
  }
  saCloseCompanyModal();
  saRefreshCompaniesList();
  showToast('Entreprise supprimée', 'info');
}

function saAccessCompany(id) {
  const companies = saGetCompanies();
  const c = companies.find(x => x.id === id);
  if (!c || !c.adminEmail) { showToast('Aucun email admin configuré', 'warning'); return; }
  // Appliquer le branding de l'entreprise
  saApplyCompanyBranding(c);
  localStorage.setItem('sa_active_company', id);
  // Se déconnecter et pre-remplir le login
  _token = ''; _profile = null; _records = [];
  document.getElementById('app').style.display = 'none';
  (function(){var _e=document.getElementById('login-screen');if(_e)_e.style.display='flex';})();
  const emailField = document.getElementById('login-email');
  const passField  = document.getElementById('login-pass');
  if (emailField) emailField.value = c.adminEmail;
  if (passField)  { passField.value = ''; passField.focus(); }
  showToast('👤 Connectez-vous en tant que ' + c.name, 'info');
}

// ── Branding depuis Supabase tenants ──────────────────────────
function applyTenantBranding(t) {
  // t = ligne de la table tenants
  const navy  = t.primary_color  || '#0F2240';
  const green = t.accent_color || '#8DC63F';
  const name  = t.name        || 'HACC.PRO';
  document.documentElement.style.setProperty('--navy',  navy);
  document.documentElement.style.setProperty('--navy2', navy);
  document.documentElement.style.setProperty('--green', green);
  const el = document.getElementById('sidebar-tenant-name');
  if (el) el.textContent = name;
  if (t.logo_url) {
    const logoEl = document.querySelector('.sidebar-logo img');
    if (logoEl) logoEl.src = t.logo_url;
  }
}

// ── Thèmes de couleurs ────────────────────────────────────────
const SA_THEMES = [
  { name:'Océan Nuit',   navy:'#0F2240', green:'#8DC63F', emoji:'🌊' },
  { name:'Bordeaux Pro', navy:'#6B1A2A', green:'#E8A838', emoji:'🍷' },
  { name:'Forêt',        navy:'#1A3A2A', green:'#5CB85C', emoji:'🌿' },
  { name:'Ardoise',      navy:'#2D3A4A', green:'#00BCD4', emoji:'🏔️' },
  { name:'Aubergine',    navy:'#3D1A5E', green:'#F06292', emoji:'💜' },
  { name:'Charbon',      navy:'#1A1A2E', green:'#E94560', emoji:'🔥' },
  { name:'Marine Royal', navy:'#1B2A6B', green:'#FFC107', emoji:'👑' },
  { name:'Cèdre',        navy:'#3E2723', green:'#8BC34A', emoji:'🌲' },
  { name:'Minuit Rosé',  navy:'#1A1035', green:'#FF6B9D', emoji:'🌸' },
  { name:'Acier',        navy:'#263238', green:'#26C6DA', emoji:'⚙️' },
  { name:'Olive Chic',   navy:'#33372C', green:'#D4AC0D', emoji:'🫒' },
  { name:'Corail',       navy:'#1C3A5E', green:'#FF6B6B', emoji:'🪸' },
];

function saRenderThemes() {
  const grid = document.getElementById('sa-theme-grid');
  if (!grid) return;
  const currentNavy = document.getElementById('sa-modal-color-navy')?.value || '#0F2240';
  grid.innerHTML = SA_THEMES.map((t,i) => `
    <div onclick="saSelectTheme(${i})" id="sa-theme-${i}" style="
      border:2px solid ${currentNavy===t.navy?'var(--navy)':'var(--border)'};
      border-radius:10px;padding:7px 6px;cursor:pointer;
      background:${currentNavy===t.navy?'rgba(15,34,64,.05)':'#fff'};
      transition:all .15s">
      <div style="border-radius:7px;height:28px;background:${t.navy};display:flex;align-items:center;justify-content:space-between;padding:0 8px;margin-bottom:5px">
        <span style="font-size:.75rem">${t.emoji}</span>
        <div style="width:10px;height:10px;border-radius:50%;background:${t.green}"></div>
      </div>
      <div style="font-size:.58rem;font-weight:700;color:#374151;text-align:center;line-height:1.2">${t.name}</div>
    </div>`).join('');
}

function saSelectTheme(i) {
  const t = SA_THEMES[i];
  if (!t) return;
  document.getElementById('sa-modal-color-navy').value = t.navy;
  document.getElementById('sa-modal-color-navy-txt').value = t.navy;
  document.getElementById('sa-modal-color-green').value = t.green;
  document.getElementById('sa-modal-color-green-txt').value = t.green;
  saModalUpdatePreview();
  saRenderThemes(); // refresh sélection
}

function saDeselectThemes() { saRenderThemes(); }

function saToggleCustomColors() {
  const el = document.getElementById('sa-custom-colors');
  const arrow = document.getElementById('sa-custom-arrow');
  if (!el) return;
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : 'block';
  if (arrow) arrow.textContent = open ? '▶' : '▼';
}

async function saLoadCompanyStats(tenantId) {
  // Highlight carte sélectionnée
  document.querySelectorAll('[id^="sa-co-card-"]').forEach(el => {
    el.style.borderColor = '';
    el.style.background = '#fff';
    el.classList.remove('active');
  });
  const card = document.getElementById('sa-co-card-' + tenantId);
  if (card) {
    card.style.borderColor = 'var(--navy)';
    card.style.background = '#f3e8f3';
    card.classList.add('active');
  }
  const companies = saGetCompanies();
  const co = companies.find(c => c.id === tenantId);
  const panel = document.getElementById('sa-company-stats-panel');
  const nameEl = document.getElementById('sa-stats-company-name');
  const content = document.getElementById('sa-stats-content');
  if (!panel || !content) return;
  if (nameEl) nameEl.textContent = co?.name || 'Entreprise';
  panel.style.display = 'block';
  content.innerHTML = '<div class="loading"><div class="spinner"></div>Chargement…</div>';
  try {
    const [sites, sectors, recs, gmos] = await Promise.all([
      supaAdmin('GET',`/rest/v1/sites?tenant_id=eq.${tenantId}&select=*`,null),
      supaAdmin('GET',`/rest/v1/sectors?tenant_id=eq.${tenantId}&select=*`,null),
      supaAdmin('GET',`/rest/v1/pms_records?tenant_id=eq.${tenantId}&select=id,enr_type,recorded_at&limit=500`,null),
      supaAdmin('GET',`/rest/v1/gmo?tenant_id=eq.${tenantId}&select=id`,null),
    ]);
    content.innerHTML = `
      <div class="sa-kpi-grid" style="grid-template-columns:repeat(2,1fr)">
        <div class="sa-kpi"><div class="sa-kpi-val" style="color:#0369a1">${Array.isArray(sites)?sites.length:0}</div><div class="sa-kpi-label">Sites</div></div>
        <div class="sa-kpi"><div class="sa-kpi-val" style="color:#7c3aed">${Array.isArray(sectors)?sectors.length:0}</div><div class="sa-kpi-label">Secteurs</div></div>
        <div class="sa-kpi"><div class="sa-kpi-val" style="color:#0f2240">${Array.isArray(recs)?recs.length:0}</div><div class="sa-kpi-label">Saisies</div></div>
        <div class="sa-kpi"><div class="sa-kpi-val" style="color:#059669">${Array.isArray(gmos)?gmos.length:0}</div><div class="sa-kpi-label">GMO</div></div>
      </div>
      ${Array.isArray(sites) && sites.length > 0 ? `
      <div style="margin-top:10px">
        <div class="sa-label">Sites</div>
        ${sites.map(s=>`<div style="padding:7px 0;border-bottom:1px solid var(--border);font-size:.82rem;font-weight:700">${s.name} <span style="color:var(--muted);font-weight:400;font-size:.72rem">${s.code}</span></div>`).join('')}
      </div>` : '<div style="color:var(--muted);font-size:.8rem;margin-top:8px">Aucun site créé</div>'}
    `;
  } catch(e) {
    content.innerHTML = `<div style="color:var(--red);font-size:.8rem">Erreur : ${e.message}</div>`;
  }
}

function saCloseCompanyStats() {
  const panel = document.getElementById('sa-company-stats-panel');
  if (panel) panel.style.display = 'none';
  document.querySelectorAll('[id^="sa-co-card-"]').forEach(el => {
    el.style.borderColor = '';
    el.style.background = '#fff';
    el.classList.remove('active');
  });
}

function saActivateCompany(id) {
  const companies = saGetCompanies();
  const c = companies.find(x => x.id === id);
  if (!c) return;
  localStorage.setItem('sa_active_company', id);
  saApplyCompanyBranding(c);
  saRefreshCompaniesList();
  showToast('✅ ' + c.name + ' activée', 'success');
}

function saApplyCompanyBranding(c) {
  document.documentElement.style.setProperty('--navy',  c.colorNavy  || '#0F2240');
  document.documentElement.style.setProperty('--navy2', c.colorNavy  || '#1a3558');
  document.documentElement.style.setProperty('--green', c.colorGreen || '#8DC63F');
  const el = document.getElementById('sidebar-tenant-name');
  if (el) el.textContent = c.name;
  if (c.logo) {
    const logoEl = document.querySelector('.sidebar-logo img');
    if (logoEl) logoEl.src = c.logo;
  }
  localStorage.setItem('sa_tenant_name',  c.name);
  localStorage.setItem('sa_color_navy',   c.colorNavy  || '#0F2240');
  localStorage.setItem('sa_color_green',  c.colorGreen || '#8DC63F');
  if (c.logo) localStorage.setItem('sa_logo', c.logo);
}

function saPreviewLogo(input) {
  // Kept for compatibility
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => { window._saPendingLogo = e.target.result; };
  reader.readAsDataURL(file);
}

function saUpdatePreview() {}

function saApplyBranding() {}

function saResetBranding() {
  localStorage.removeItem('sa_tenant_name');
  localStorage.removeItem('sa_color_navy');
  localStorage.removeItem('sa_color_green');
  localStorage.removeItem('sa_logo');
  localStorage.removeItem('sa_active_company');
  document.documentElement.style.setProperty('--navy', '#0F2240');
  document.documentElement.style.setProperty('--green', '#8DC63F');
  const el = document.getElementById('sidebar-tenant-name');
  if (el) el.textContent = 'Mon Organisation';
  showToast('Réinitialisé', 'info');
  renderSuperAdmin();
}

function restoreBranding() {
  const activeId = localStorage.getItem('sa_active_company');
  if (activeId) {
    const companies = saGetCompanies();
    const c = companies.find(x => x.id === activeId);
    if (c) { saApplyCompanyBranding(c); return; }
  }
  // Fallback legacy
  const navy  = localStorage.getItem('sa_color_navy');
  const green = localStorage.getItem('sa_color_green');
  const name  = localStorage.getItem('sa_tenant_name');
  const logo  = localStorage.getItem('sa_logo');
  if (navy)  document.documentElement.style.setProperty('--navy', navy);
  if (green) document.documentElement.style.setProperty('--green', green);
  if (name)  { const el=document.getElementById('sidebar-tenant-name'); if(el) el.textContent=name; }
  if (logo)  { const el=document.querySelector('.sidebar-logo img'); if(el) el.src=logo; }
}

async function saUpdatePlan() {
  const price = document.getElementById('sa-price')?.value;
  const plan  = document.getElementById('sa-plan-name')?.value;
  if (!price && !plan) { showToast('Renseignez un prix ou un nom', 'warning'); return; }
  if (!_token) { showToast('Session expirée, reconnectez-vous', 'error'); return; }
  try {
    await supaAdmin('PATCH', '/rest/v1/subscriptions?tenant_id=not.is.null', {
      ...(price ? {price_per_month: parseFloat(price)} : {}),
      ...(plan ? {plan} : {}),
    });
    showToast('✅ Plan mis à jour', 'success');
  } catch(e) { showToast('Erreur : ' + e.message, 'error'); }
}

// Fermer modal entreprise si clic sur le fond
document.addEventListener('click', function(e) {
  const modal = document.getElementById('sa-company-modal');
  if (modal && e.target === modal) saCloseCompanyModal();
});

// ════════════════════════════════════════════════════
// MON ABONNEMENT
// ════════════════════════════════════════════════════
async function renderSubscription(){
  setContent('<div style="padding:24px;text-align:center;color:var(--muted);font-size:.85rem">Chargement…</div>');

  const tenantId = _profile?.tenant_id;
  const font = 'font-family:var(--font)';

  let sub = null, sites = [], tenantData = null;

  try {
    if(tenantId){
      const [subs, sitesRes, tenants] = await Promise.all([
        supaGet('subscriptions', `select=plan,status,price_per_month,trial_ends_at&tenant_id=eq.${tenantId}&limit=1`).catch(()=>[]),
        supaGet('sites', `select=id,name,code&tenant_id=eq.${tenantId}&order=name`).catch(()=>[]),
        supaGet('tenants', `select=id,name,primary_color&id=eq.${tenantId}&limit=1`).catch(()=>[])
      ]);
      sub = subs[0] || null;
      sites = Array.isArray(sitesRes) ? sitesRes : [];
      tenantData = tenants[0] || null;
    }
  } catch(e){ console.warn('[renderSubscription]', e); }

  const planLabels = { solo:'Solo', multi:'Multi', enterprise:'Entreprise' };
  const planColors = { solo:'#16a34a', multi:'#0F2240', enterprise:'#7c3aed' };
  const planDesc   = { solo:'1 cuisine', multi:'Jusqu\'à 3 cuisines · +19€/cuisine supp.', enterprise:'Cuisines illimitées · API · SSO' };
  const planPrices = { solo:'29€/mois', multi:'49€/mois', enterprise:'Sur devis' };

  const planKey   = sub?.plan || _profile?.plan || 'multi';
  const planLabel = planLabels[planKey] || planKey;
  const planColor = planColors[planKey] || '#64748b';

  let statusHtml = '';
  if(sub){
    if(sub.status === 'trial' && sub.trial_ends_at){
      const trialDate = new Date(sub.trial_ends_at);
      const today = new Date();
      const daysLeft = Math.max(0, Math.ceil((trialDate - today) / 86400000));
      const trialStr = trialDate.toLocaleDateString('fr-FR', {day:'2-digit',month:'long',year:'numeric'});
      statusHtml = daysLeft > 0
        ? `<span style="background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:20px;font-size:.75rem;font-weight:800">Essai gratuit — ${daysLeft} jour${daysLeft>1?'s':''} restant${daysLeft>1?'s':''} (jusqu'au ${trialStr})</span>`
        : `<span style="background:#fee2e2;color:#991b1b;padding:3px 10px;border-radius:20px;font-size:.75rem;font-weight:800">Essai expiré le ${trialStr}</span>`;
    } else if(sub.status === 'active'){
      statusHtml = `<span style="background:#dcfce7;color:#166534;padding:3px 10px;border-radius:20px;font-size:.75rem;font-weight:800">Abonnement actif</span>`;
    } else {
      statusHtml = `<span style="background:#f1f5f9;color:#64748b;padding:3px 10px;border-radius:20px;font-size:.75rem;font-weight:800">${sub.status||'—'}</span>`;
    }
  }

  const sitesHtml = sites.length
    ? sites.map(s => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#f8fafc;border-radius:10px;margin-bottom:6px">
          <div>
            <div style="font-size:.85rem;font-weight:800;color:var(--text)">${escH(s.name)}</div>
            <div style="font-size:.65rem;color:var(--muted);margin-top:1px">Code : ${escH(s.code||s.id)}</div>
          </div>
          <button onclick="openCuisine('${escH(s.id)}','${escH(s.code)}','${escH(s.name)}')"
            style="padding:5px 12px;background:var(--navy);color:#fff;border:none;border-radius:8px;font-size:.72rem;font-weight:800;cursor:pointer;${font}">
            Ouvrir PMS →
          </button>
        </div>`).join('')
    : '<div style="color:var(--muted);font-size:.82rem;padding:10px 0">Aucune cuisine configurée.</div>';

  const addKitchenHtml = ['multi','enterprise'].includes(planKey)
    ? `<div style="margin-top:8px;padding:14px;background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:12px">
        <div style="font-size:.82rem;font-weight:800;color:#166534;margin-bottom:4px">Ajouter une cuisine</div>
        <div style="font-size:.75rem;color:#166534;margin-bottom:10px">+19€/mois par cuisine supplémentaire</div>
        <a href="mailto:contact@hacc.pro?subject=Ajout%20cuisine%20%E2%80%94%20${encodeURIComponent(tenantData?.name||'')}"
          style="display:inline-block;padding:7px 16px;background:#166534;color:#fff;border-radius:8px;font-size:.78rem;font-weight:800;text-decoration:none">
          Demander l'ajout →
        </a>
      </div>`
    : `<div style="margin-top:8px;padding:14px;background:#f8fafc;border:1.5px solid var(--border);border-radius:12px">
        <div style="font-size:.82rem;font-weight:800;color:var(--text);margin-bottom:4px">Passer en plan Multi</div>
        <div style="font-size:.75rem;color:var(--muted);margin-bottom:10px">Gérez jusqu'à 3 cuisines pour 49€/mois</div>
        <a href="mailto:contact@hacc.pro?subject=Upgrade%20plan%20%E2%80%94%20${encodeURIComponent(tenantData?.name||'')}"
          style="display:inline-block;padding:7px 16px;background:var(--navy);color:#fff;border-radius:8px;font-size:.78rem;font-weight:800;text-decoration:none">
          Upgrader mon plan →
        </a>
      </div>`;

  const html = `
  <div style="max-width:600px;margin:0 auto;padding:24px 16px">
    <div style="font-size:1.05rem;font-weight:900;color:var(--navy);margin-bottom:20px">Mon abonnement</div>

    <!-- Plan actuel -->
    <div style="background:#fff;border:1.5px solid var(--border);border-radius:16px;padding:18px;margin-bottom:16px">
      <div style="font-size:.65rem;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:8px">Plan actuel</div>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="font-size:1.3rem;font-weight:900;color:${planColor}">${escH(planLabel)}</span>
        <span style="font-size:.8rem;font-weight:700;color:var(--muted)">${escH(planPrices[planKey]||'')}</span>
        ${statusHtml}
      </div>
      <div style="font-size:.75rem;color:var(--muted);margin-top:6px">${escH(planDesc[planKey]||'')}</div>
    </div>

    <!-- Mes cuisines -->
    <div style="background:#fff;border:1.5px solid var(--border);border-radius:16px;padding:18px;margin-bottom:16px">
      <div style="font-size:.65rem;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:10px">Mes cuisines (${sites.length})</div>
      ${sitesHtml}
      ${addKitchenHtml}
    </div>

    <!-- Compte -->
    <div style="background:#fff;border:1.5px solid var(--border);border-radius:16px;padding:18px;margin-bottom:16px">
      <div style="font-size:.65rem;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:10px">Mon compte</div>
      <div style="font-size:.85rem;font-weight:700;color:var(--text);margin-bottom:4px">${escH(_profile?.full_name||'—')}</div>
      <div style="font-size:.75rem;color:var(--muted);margin-bottom:12px">${escH(_profile?.email||'')}</div>
      <a href="reset-password.html" style="font-size:.78rem;font-weight:800;color:var(--navy);text-decoration:none">
        Changer mon mot de passe →
      </a>
    </div>

    <!-- Modifier le plan -->
    <div style="background:#fff;border:1.5px solid var(--border);border-radius:16px;padding:18px">
      <div style="font-size:.65rem;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:8px">Modifier mon plan</div>
      <div style="font-size:.78rem;color:var(--muted);margin-bottom:10px">Pour modifier votre abonnement, annuler ou obtenir une facture, contactez-nous.</div>
      <a href="mailto:contact@hacc.pro?subject=Modification%20abonnement%20%E2%80%94%20${encodeURIComponent(tenantData?.name||'')}"
        style="display:inline-block;padding:7px 16px;background:var(--navy);color:#fff;border-radius:8px;font-size:.78rem;font-weight:800;text-decoration:none">
        Contacter le support →
      </a>
    </div>
  </div>`;

  setContent(html);
}



  
