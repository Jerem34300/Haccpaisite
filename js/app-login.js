/**
   * app-login.js — Logique de la page de connexion
   *
   * Gère :
   *   - Formulaire de connexion (email/mot de passe)
   *   - Authentification via Supabase Auth
   *   - Récupération du profil utilisateur et du rôle
   *   - Redirection vers Cuisine ou Dashboard selon le rôle
   *   - Réinitialisation de mot de passe
   *
   * Dépend de : supabaseConfig.js (chargé avant via <script src>)
   */

  // ── Config localStorage ─────────────────────────────
const CFG_KEY = 'haccpro_login_cfg';
const _DEFAULT_URL = SUPABASE_URL;
const _DEFAULT_KEY = SUPABASE_ANON_KEY;

function loadCfg() {
  // Pré-remplir avec les clés intégrées
  document.getElementById('cfg-url').value = _DEFAULT_URL;
  document.getElementById('cfg-key').value = _DEFAULT_KEY;
  try {
    const c = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
    if (c.email) document.getElementById('login-email').value = c.email;
  } catch(e) {}
}

function saveCfg(email) {
  const url = document.getElementById('cfg-url').value.trim().replace(/\/$/,'');
  const key = document.getElementById('cfg-key').value.trim();
  localStorage.setItem(CFG_KEY, JSON.stringify({ url, key, email }));
}


// ── Login ───────────────────────────────────────────
async function doLogin() {
  const url   = document.getElementById('cfg-url').value.trim().replace(/\/$/,'');
  const key   = document.getElementById('cfg-key').value.trim();
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-err');
  const btn   = document.getElementById('btn-login');
  const label = document.getElementById('btn-label');
  const spin  = document.getElementById('btn-spinner');

  errEl.style.display = 'none';
  if (!url || !key) { showErr('Configurez l\'URL et la clé Supabase (⚙️ Configuration)'); return; }
  if (!email || !pass) { showErr('Email et mot de passe requis'); return; }

  btn.disabled = true;
  label.style.display = 'none';
  spin.style.display = 'block';

  try {
    // 1. Connexion Supabase
    const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': key },
      body: JSON.stringify({ email, password: pass })
    });
    const data = await r.json();
    if (!data.access_token) {
      const errRaw = [data.error_description, data.msg, data.error, data.error_code].filter(Boolean).join(' ').toLowerCase();
      if(errRaw.includes('email not confirmed') || errRaw.includes('email_not_confirmed')){
        _showEmailNotConfirmedErr(email);
        btn.disabled = false;
        label.style.display = 'inline';
        spin.style.display = 'none';
        return;
      }
      throw new Error(_frErr(data.error_description || data.msg || data.error || ''));
    }

    // 2. Charger le profil pour connaître le rôle
    const pr = await fetch(`${url}/rest/v1/profiles?id=eq.${data.user?.id}&select=role,tenant_id,site_id,full_name&limit=1`, {
      headers: { 'apikey': key, 'Authorization': `Bearer ${data.access_token}`, 'Accept': 'application/json' }
    });
    const profiles = await pr.json();
    const profile  = profiles?.[0] || null;

    // Premier login après confirmation email : profil pas encore créé
    if(!profile){
      let pending = null;
      try { pending = JSON.parse(localStorage.getItem('haccpro_pending_signup') || 'null'); } catch(e){}
      if(pending){
        await _completeSignupSetup(data.access_token, data.refresh_token || '', data.user?.id, pending, url, key);
        return;
      }
      throw new Error('Aucun profil trouvé. Contactez le support.');
    }

    const role = profile.role || 'cuisinier';

    // 3. Si cuisinier, récupérer le CODE du site (pas son UUID)
    let siteCode = '';
    let siteNom = '';
    if (role === 'cuisinier' && profile.site_id) {
      try {
        const sr = await fetch(`${url}/rest/v1/sites?id=eq.${profile.site_id}&select=code,name&limit=1`, {
          headers: { 'apikey': key, 'Authorization': `Bearer ${data.access_token}`, 'Accept': 'application/json' }
        });
        const sites = await sr.json();
        siteCode = sites?.[0]?.code || '';
        siteNom  = sites?.[0]?.name || '';
      } catch(e) {}
    }

    saveCfg(email);

    const ROLES_DASHBOARD = ['super_admin', 'siege', 'directeur', 'chef_secteur'];
    const ROLES_PMS       = ['cuisinier'];

    if (ROLES_DASHBOARD.includes(role)) {
      localStorage.setItem('haccpro_session', JSON.stringify({
        token: data.access_token,
        refreshToken: data.refresh_token || '',
        userId: data.user?.id,
        role, tenantId: profile.tenant_id,
        fullName: profile.full_name,
      }));
      window.location.href = 'dashboard.html';

    } else if (ROLES_PMS.includes(role)) {
      const supaCfg = {
        userToken: data.access_token,
        refreshToken: data.refresh_token || '',
        userEmail: email,
        siteId: siteCode,
        siteNom: siteNom,
        tenantId: profile.tenant_id || '',
        userRole: role,
      };
      localStorage.setItem('haccpro_supa_cfg', JSON.stringify(supaCfg));
      window.location.href = 'cuisine.html';

    } else {
      throw new Error('Rôle inconnu : ' + role);
    }

  } catch(e) {
    showErr(e.message);
    btn.disabled = false;
    label.style.display = 'inline';
    spin.style.display = 'none';
  }
}

function _frErr(msg) {
  var m = (msg || '').toLowerCase();
  if (m.includes('invalid login') || m.includes('invalid email or password') || m.includes('wrong password'))
    return 'Email ou mot de passe incorrect.';
  if (m.includes('email not confirmed'))
    return 'Confirmez votre email avant de vous connecter.';
  if (m.includes('too many requests') || m.includes('rate limit'))
    return 'Trop de tentatives. Attendez quelques minutes.';
  if (m.includes('user not found') || m.includes('no user found'))
    return 'Aucun compte trouvé avec cet email.';
  if (m.includes('network') || m.includes('fetch'))
    return 'Erreur réseau. Vérifiez votre connexion.';
  if (m.includes('account locked') || m.includes('disabled'))
    return 'Ce compte a été désactivé. Contactez le support.';
  return msg || 'Identifiants incorrects.';
}

function showErr(msg) {
  const el = document.getElementById('login-err');
  el.textContent = msg;
  el.style.display = 'block';
}
function togglePwd(inputId, svgId){
  const inp = document.getElementById(inputId);
  const svg = document.getElementById(svgId);
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  svg.innerHTML = show
    ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
    : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
}

async function doForgot() {
  const email = document.getElementById('login-email').value.trim();
  if (!email) { showErr('Entrez votre email d\'abord'); return; }
  const errEl = document.getElementById('login-err');
  errEl.textContent = 'Envoi en cours…';
  errEl.style.display  = 'block';
  errEl.style.color    = '#7A6579';
  errEl.style.background = '#F7F2F7';
  try {
    await fetch('/.netlify/functions/send-email', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ type: 'reset', to: email })
    });
    errEl.textContent  = '📧 Lien envoyé — vérifiez vos emails (et vos spams).';
    errEl.style.color  = '#166534';
    errEl.style.background = '#f0fdf4';
    errEl.style.border = '1px solid #bbf7d0';
  } catch(e) {
    errEl.textContent  = 'Erreur réseau. Réessayez dans quelques instants.';
    errEl.style.color  = '#991b1b';
    errEl.style.background = '#fef2f2';
  }
}

function _showEmailNotConfirmedErr(email) {
  window._pendingResendEmail = email;
  const el = document.getElementById('login-err');
  el.innerHTML = 'Votre compte n\'est pas encore activé. <button onclick="doResendLoginConfirm()" style="background:none;border:none;color:inherit;font-weight:900;cursor:pointer;text-decoration:underline;font-family:inherit;font-size:inherit;padding:0">Renvoyer l\'email →</button>';
  el.style.display = 'block';
}

async function doResendLoginConfirm(){
  const url   = document.getElementById('cfg-url').value.trim().replace(/\/$/,'');
  const key   = document.getElementById('cfg-key').value.trim();
  const email = window._pendingResendEmail || document.getElementById('login-email').value.trim();
  const el    = document.getElementById('login-err');
  el.textContent = 'Envoi en cours…';
  try {
    const r = await fetch(`${url}/auth/v1/resend`, {
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':key},
      body:JSON.stringify({ type:'signup', email })
    });
    const res = await r.json();
    if(res.error) throw new Error(res.error.message || res.error_description || 'Erreur lors du renvoi');
    el.textContent = 'Email renvoyé. Vérifiez vos spams si vous ne le recevez pas.';
    el.style.color      = '#166534';
    el.style.background = '#f0fdf4';
    el.style.border     = '1px solid #bbf7d0';
  } catch(e){
    console.error('doResendLoginConfirm:', e);
    el.textContent = e.message || 'Erreur réseau. Réessayez dans quelques instants.';
  }
}

// ── Finalisation du compte post-inscription ────────────────────
// Appelée depuis doLogin() (profil absent) ou depuis le callback
// hash Supabase (access_token dans l'URL). Crée tenant + profil +
// abonnement puis redirige vers onboarding.
async function _completeSignupSetup(token, refreshToken, userId, sd, url, key){
  const company = sd.company || '';
  const type    = sd.type    || 'restaurant';
  const plan    = sd.plan    || 'multi';

  // Utiliser le proxy Netlify (service_role) pour contourner les RLS Supabase
  // et garantir la création du tenant même pour un nouvel utilisateur sans rôle
  let tenantId = null;
  try {
    const r = await fetch('/.netlify/functions/signup-setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userJwt: token, company, type, plan })
    });
    if(r.ok){
      const d = await r.json();
      tenantId = d.tenantId || null;
    } else {
      console.error('signup-setup proxy:', r.status, await r.text());
    }
  } catch(e){ console.error('signup-setup proxy:', e); }

  // Fallback direct Supabase si le proxy Netlify n'est pas disponible (dev local)
  if(!tenantId){
    try {
      const r = await fetch(`${url}/rest/v1/tenants`, {
        method:'POST',
        headers:{'Content-Type':'application/json','apikey':key,'Authorization':`Bearer ${token}`,'Prefer':'return=representation'},
        body:JSON.stringify({ name:company, type })
      });
      if(r.ok){ const t = await r.json(); tenantId = Array.isArray(t) ? t[0]?.id : t?.id; }
    } catch(e){ console.error('tenant POST direct:', e); }
  }

  // Dernier recours : trouver un tenant existant
  if(!tenantId){
    try {
      const gr = await fetch(`${url}/rest/v1/tenants?select=id&limit=1`, {
        headers:{'apikey':key,'Authorization':`Bearer ${token}`,'Accept':'application/json'}
      });
      if(gr.ok){ const ts = await gr.json(); tenantId = ts?.[0]?.id || null; }
    } catch(e){ console.error('tenant GET:', e); }
  }

  localStorage.setItem('haccpro_session', JSON.stringify({
    token, refreshToken, userId,
    role:'directeur', tenantId, fullName:company, plan
  }));
  localStorage.setItem('haccpro_signup_data', JSON.stringify({
    company, type, sites:sd.sites || 1, plan
  }));
  localStorage.removeItem('haccpro_pending_signup');
  window.location.href = 'onboarding.html';
}

// ── Callback hash Supabase (fallback si token passé dans l'URL) ─
async function _handleEmailConfirmCallback(){
  const hash = window.location.hash.slice(1);
  if(!hash) return;
  const params = new URLSearchParams(hash);
  if(params.get('type') !== 'signup' || !params.get('access_token')) return;

  const token        = params.get('access_token');
  const refreshToken = params.get('refresh_token') || '';
  history.replaceState(null, '', window.location.pathname + window.location.search);

  const statusEl = document.getElementById('login-err');
  if(statusEl){
    statusEl.textContent    = 'Email confirmé — finalisation de votre compte…';
    statusEl.style.display  = 'block';
    statusEl.style.color    = '#166534';
    statusEl.style.background = '#f0fdf4';
    statusEl.style.border   = '1px solid #bbf7d0';
  }
  try {
    const userRes = await fetch(`${_DEFAULT_URL}/auth/v1/user`, {
      headers:{ 'apikey':_DEFAULT_KEY, 'Authorization':`Bearer ${token}` }
    });
    const user = await userRes.json();
    if(!user.id) throw new Error('Utilisateur introuvable');
    let sd = {};
    try { sd = JSON.parse(localStorage.getItem('haccpro_pending_signup') || '{}'); } catch(e){}
    await _completeSignupSetup(token, refreshToken, user.id, sd, _DEFAULT_URL, _DEFAULT_KEY);
  } catch(e){
    console.error('_handleEmailConfirmCallback:', e);
    if(statusEl){
      statusEl.textContent    = 'Erreur lors de la finalisation. Connectez-vous ci-dessous.';
      statusEl.style.color    = '#991b1b';
      statusEl.style.background = '#fef2f2';
      statusEl.style.border   = '1px solid #fecaca';
    }
  }
}

loadCfg();
_handleEmailConfirmCallback();
  