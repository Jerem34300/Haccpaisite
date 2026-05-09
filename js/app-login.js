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
    if (!data.access_token) throw new Error(_frErr(data.error_description || data.msg || data.error || ''));

    // 2. Charger le profil pour connaître le rôle
    const pr = await fetch(`${url}/rest/v1/profiles?id=eq.${data.user?.id}&select=role,tenant_id,site_id,full_name&limit=1`, {
      headers: { 'apikey': key, 'Authorization': `Bearer ${data.access_token}`, 'Accept': 'application/json' }
    });
    const profiles = await pr.json();
    const profile = profiles?.[0] || {};

    saveCfg(email);

    // Aucun profil ou rôle = nouvel utilisateur → onboarding
    if (!profiles?.[0] || !profile.role) {
      localStorage.setItem('haccpro_session', JSON.stringify({
        token: data.access_token,
        refreshToken: data.refresh_token || '',
        userId: data.user?.id,
        role: 'directeur',
        tenantId: null,
        fullName: '',
      }));
      window.location.href = 'onboarding.html';
      return;
    }

    const role = profile.role;

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
      // Directeur sans tenant configuré → onboarding
      if (!profile.tenant_id) {
        window.location.href = 'onboarding.html';
      } else {
        window.location.href = 'dashboard.html';
      }

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

loadCfg();

// ── Callback email confirmation ─────────────────────────
// Supabase redirige vers login.html#access_token=...&type=signup après confirmation
(function checkEmailConfirmCallback() {
  var hash = window.location.hash;
  if (!hash || !hash.includes('access_token')) return;

  var params = new URLSearchParams(hash.slice(1));
  var accessToken  = params.get('access_token');
  var refreshToken = params.get('refresh_token') || '';
  var type         = params.get('type');

  if (!accessToken || type !== 'signup') return;

  // Nettoyer le hash de l'URL
  history.replaceState(null, '', window.location.pathname);

  // Afficher un message de chargement
  var errEl = document.getElementById('login-err');
  if (errEl) {
    errEl.textContent  = '✅ Email confirmé ! Connexion en cours…';
    errEl.style.display    = 'block';
    errEl.style.color      = '#166534';
    errEl.style.background = '#f0fdf4';
    errEl.style.border     = '1px solid #bbf7d0';
  }

  _handleEmailCallback(accessToken, refreshToken);
})();

function _parseJwtSub(token) {
  try {
    var payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4) payload += '=';
    return JSON.parse(atob(payload)).sub || '';
  } catch(e) { return ''; }
}

async function _handleEmailCallback(accessToken, refreshToken) {
  var url = document.getElementById('cfg-url').value.trim().replace(/\/$/,'');
  var key = document.getElementById('cfg-key').value.trim();
  var userId = _parseJwtSub(accessToken);

  try {
    var pr = await fetch(`${url}/rest/v1/profiles?id=eq.${userId}&select=role,tenant_id,full_name&limit=1`, {
      headers: { 'apikey': key, 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' }
    });
    var profiles = await pr.json();
    var profile  = profiles?.[0] || {};

    localStorage.setItem('haccpro_session', JSON.stringify({
      token: accessToken,
      refreshToken: refreshToken,
      userId: userId,
      role: profile.role || 'directeur',
      tenantId: profile.tenant_id || null,
      fullName: profile.full_name || '',
    }));

    // Pas de profil complet → onboarding
    if (!profile.role || !profile.tenant_id) {
      window.location.href = 'onboarding.html';
      return;
    }

    var ROLES_DASHBOARD = ['super_admin', 'siege', 'directeur', 'chef_secteur'];
    window.location.href = ROLES_DASHBOARD.includes(profile.role) ? 'dashboard.html' : 'cuisine.html';

  } catch(e) {
    // En cas d'erreur réseau, aller sur onboarding quand même
    localStorage.setItem('haccpro_session', JSON.stringify({
      token: accessToken, refreshToken: refreshToken,
      userId: userId, role: 'directeur', tenantId: null, fullName: '',
    }));
    window.location.href = 'onboarding.html';
  }
}
  