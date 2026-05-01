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
    if (!data.access_token) throw new Error(data.error_description || data.msg || 'Identifiants incorrects');

    // 2. Charger le profil pour connaître le rôle
    const pr = await fetch(`${url}/rest/v1/profiles?id=eq.${data.user?.id}&select=role,tenant_id,site_id,full_name&limit=1`, {
      headers: { 'apikey': key, 'Authorization': `Bearer ${data.access_token}`, 'Accept': 'application/json' }
    });
    const profiles = await pr.json();
    const profile = profiles?.[0] || {};
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

function showErr(msg) {
  const el = document.getElementById('login-err');
  el.textContent = msg;
  el.style.display = 'block';
}

async function doForgot() {
  const url = document.getElementById('cfg-url').value.trim().replace(/\/$/,'');
  const key = document.getElementById('cfg-key').value.trim();
  const email = document.getElementById('login-email').value.trim();
  if (!url || !key) { showErr('Configurez Supabase d\'abord'); return; }
  if (!email) { showErr('Entrez votre email d\'abord'); return; }
  try {
    await fetch(`${url}/auth/v1/recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': key },
      body: JSON.stringify({ email })
    });
    showErr('📧 Email de réinitialisation envoyé !');
    document.getElementById('login-err').style.color = '#166534';
    document.getElementById('login-err').style.background = '#f0fdf4';
  } catch(e) { showErr('Erreur : ' + e.message); }
}

loadCfg();
// Masquer la config si déjà renseignée
// Note: cfg-box retiré du DOM — plus de panneau de configuration avancée visible
// La configuration Supabase est embarquée directement dans le code
  