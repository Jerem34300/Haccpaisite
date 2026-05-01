/**
 * admin-proxy.js — Netlify Function : proxy sécurisé pour les opérations admin Supabase
 *
 * La clé service_role ne vit QUE dans les variables d'environnement Netlify.
 * Elle n'est JAMAIS envoyée au navigateur.
 *
 * Flux :
 *   1. Le dashboard envoie { method, path, body } + header Authorization: Bearer <jwt_user>
 *   2. Cette fonction vérifie le JWT via Supabase /auth/v1/user
 *   3. Elle vérifie que l'utilisateur a un rôle admin (super_admin, siege, directeur)
 *   4. Elle exécute la requête Supabase avec la service_role key
 *   5. Elle retourne le résultat au dashboard
 *
 * Variables d'environnement Netlify à configurer :
 *   SUPABASE_URL            = https://lthxpucxjcwzphshdhmp.supabase.co
 *   SUPABASE_ANON_KEY       = (clé anon publique)
 *   SUPABASE_SERVICE_KEY    = (clé service_role — JAMAIS dans le code)
 */

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY       = process.env.SUPABASE_SERVICE_KEY;

const ALLOWED_ROLES = ['super_admin', 'siege', 'directeur'];

// Chemins autorisés (whitelist stricte)
const ALLOWED_PATH_PREFIXES = [
  '/auth/v1/admin/users',
  '/rest/v1/profiles',
  '/rest/v1/tenants',
  '/rest/v1/sites',
  '/rest/v1/sectors',
  '/rest/v1/territories',
  '/rest/v1/subscriptions',
  '/rest/v1/pms_records',
  '/rest/v1/corrective_actions',
  '/rest/v1/nc_action_mapping',
  '/rest/v1/gmo',
];

exports.handler = async function(event) {
  // CORS preflight
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Méthode non autorisée' }) };
  }

  // ── 1. Vérifier variables d'environnement ────────────────
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('[admin-proxy] Variables d\'environnement manquantes');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Configuration serveur manquante' }) };
  }

  // ── 2. Extraire le JWT utilisateur ───────────────────────
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  const userJwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!userJwt) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token manquant' }) };
  }

  // ── 3. Vérifier le JWT via Supabase ──────────────────────
  let userId = null;
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${userJwt}` }
    });
    if (!userRes.ok) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token invalide ou expiré' }) };
    }
    const userData = await userRes.json();
    userId = userData.id;
  } catch(e) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Erreur vérification token' }) };
  }

  // ── 4. Vérifier le rôle admin dans profiles ───────────────
  try {
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=role&limit=1`,
      { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${userJwt}` } }
    );
    if (!profileRes.ok) throw new Error('Profil inaccessible');
    const profiles = await profileRes.json();
    const role = profiles?.[0]?.role || '';
    if (!ALLOWED_ROLES.includes(role)) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: `Rôle insuffisant : ${role}` }) };
    }
  } catch(e) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Vérification rôle échouée' }) };
  }

  // ── 5. Parser la requête ──────────────────────────────────
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch(e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Corps JSON invalide' }) };
  }

  const { method = 'GET', path = '', body: reqBody = null, extraHeaders = {} } = payload;

  // ── 6. Whitelist des chemins ──────────────────────────────
  const pathOk = ALLOWED_PATH_PREFIXES.some(p => path.startsWith(p));
  if (!pathOk) {
    console.warn('[admin-proxy] Chemin refusé :', path);
    return { statusCode: 403, headers, body: JSON.stringify({ error: `Chemin non autorisé : ${path}` }) };
  }

  // ── 7. Exécuter la requête Supabase avec service_role ─────
  try {
    const supaHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      ...extraHeaders,
    };

    const opts = { method, headers: supaHeaders };
    if (reqBody && method !== 'GET') opts.body = JSON.stringify(reqBody);

    const supaRes = await fetch(`${SUPABASE_URL}${path}`, opts);
    const ct = supaRes.headers.get('content-type') || '';
    const responseBody = ct.includes('json') ? await supaRes.json() : await supaRes.text();

    if (!supaRes.ok) {
      const errText = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
      return {
        statusCode: supaRes.status,
        headers,
        body: JSON.stringify({ error: `Supabase HTTP ${supaRes.status}`, detail: errText.slice(0, 300) })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody)
    };

  } catch(e) {
    console.error('[admin-proxy] Erreur requête Supabase :', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur proxy : ' + e.message }) };
  }
};
