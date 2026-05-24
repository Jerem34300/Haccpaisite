/**
 * superadmin-login.js — Vérifie les credentials super_admin côté serveur
 *
 * Le client envoie { email, password } et reçoit { access_token } si le
 * rôle est super_admin. Toute la logique d'auth + vérification de rôle
 * se fait ici avec la service_role key (bypass RLS complet).
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY     = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Méthode non autorisée' }) };
  }

  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    console.error('[superadmin-login] Variables d\'environnement manquantes');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Configuration serveur manquante' }) };
  }

  let email, password;
  try {
    const body = JSON.parse(event.body || '{}');
    email    = (body.email    || '').trim();
    password = (body.password || '');
  } catch(e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Corps JSON invalide' }) };
  }

  if (!email || !password) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email et mot de passe requis' }) };
  }

  // ── 1. Authentifier l'utilisateur ────────────────────────────
  let accessToken, userId;
  try {
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
      body: JSON.stringify({ email, password })
    });
    const authData = await authRes.json();
    if (!authData.access_token) {
      const msg = authData.error_description || authData.error || 'Identifiants incorrects';
      return { statusCode: 401, headers, body: JSON.stringify({ error: msg }) };
    }
    accessToken = authData.access_token;
    userId      = authData.user?.id;
  } catch(e) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Erreur Supabase auth: ' + e.message }) };
  }

  // ── 2. Vérifier le rôle super_admin (service_role — bypass RLS) ─
  try {
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=role&limit=1`,
      { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
    );
    if (!profileRes.ok) throw new Error(`Profil inaccessible (HTTP ${profileRes.status})`);
    const profiles = await profileRes.json();
    const role = profiles?.[0]?.role || '';
    if (role !== 'super_admin') {
      return { statusCode: 403, headers, body: JSON.stringify({ error: `Accès refusé — rôle : ${role || 'inconnu'}` }) };
    }
  } catch(e) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Vérification rôle échouée : ' + e.message }) };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ access_token: accessToken, user_id: userId })
  };
};
