/**
 * signup-setup.js — Netlify Function : finalisation du compte post-inscription
 *
 * Appelée depuis _completeSignupSetup() (app-login.js) après confirmation email.
 * Utilise la clé service_role pour contourner les RLS Supabase et garantir
 * la création du tenant, du profil et de l'abonnement.
 *
 * Flux :
 *   1. Le client envoie { userJwt, company, type, plan, sites }
 *   2. On vérifie le JWT via /auth/v1/user (l'utilisateur est authentifié)
 *   3. On vérifie qu'il n'a pas déjà un tenant (idempotence)
 *   4. On crée tenant + profil + abonnement avec service_role
 *   5. On retourne { tenantId, role }
 *
 * Variables d'environnement Netlify :
 *   SUPABASE_URL         = https://lthxpucxjcwzphshdhmp.supabase.co
 *   SUPABASE_ANON_KEY    = (clé anon publique)
 *   SUPABASE_SERVICE_KEY = (clé service_role — jamais dans le code)
 */

const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_ANON  = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_KEY;

const svcHeaders = {
  'Content-Type': 'application/json',
  'Accept':       'application/json',
  'apikey':       SERVICE_KEY || '',
  'Authorization': `Bearer ${SERVICE_KEY || ''}`,
};

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Méthode non autorisée' }) };
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('[signup-setup] Variables d\'environnement manquantes');
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Configuration serveur manquante' }) };
  }

  // ── 1. Parser le body ────────────────────────────────────────
  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch(e) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'JSON invalide' }) };
  }

  const { userJwt, company = '', type = 'restaurant', plan = 'multi', sites = 1 } = payload;
  if (!userJwt) {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Token manquant' }) };
  }

  // ── 2. Vérifier le JWT → récupérer l'userId ──────────────────
  let userId;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${userJwt}` }
    });
    if (!r.ok) throw new Error('Token invalide');
    const u = await r.json();
    if (!u.id) throw new Error('Utilisateur introuvable');
    userId = u.id;
  } catch(e) {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: e.message }) };
  }

  // ── 3. Vérifier si un profil/tenant existe déjà (idempotence) ─
  let existingTenantId = null;
  try {
    const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=tenant_id&limit=1`, {
      headers: svcHeaders
    });
    if (pr.ok) {
      const profiles = await pr.json();
      existingTenantId = profiles?.[0]?.tenant_id || null;
    }
  } catch(e) { /* ignore */ }

  if (existingTenantId) {
    // Déjà configuré → retourner l'existant
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ tenantId: existingTenantId, role: 'directeur', existing: true })
    };
  }

  // ── 4. Créer le tenant ────────────────────────────────────────
  // Générer un slug unique à partir du nom de l'entreprise
  const slug = company.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
    + '-' + Math.random().toString(36).slice(2, 7);

  let tenantId = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/tenants`, {
      method: 'POST',
      headers: { ...svcHeaders, 'Prefer': 'return=representation' },
      body: JSON.stringify({ name: company, slug })
    });
    if (r.ok) {
      const t = await r.json();
      tenantId = Array.isArray(t) ? t[0]?.id : t?.id;
    } else {
      const err = await r.text();
      console.error('[signup-setup] tenant POST:', r.status, err);
    }
  } catch(e) { console.error('[signup-setup] tenant:', e.message); }

  if (!tenantId) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Impossible de créer l\'organisation' }) };
  }

  // ── 5. Créer le profil ────────────────────────────────────────
  try {
    const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
      method: 'POST',
      headers: { ...svcHeaders, 'Prefer': 'return=minimal,resolution=merge-duplicates' },
      body: JSON.stringify({ id: userId, tenant_id: tenantId, role: 'siege', full_name: company })
    });
    if (!profRes.ok) {
      const profErr = await profRes.text();
      console.error('[signup-setup] profile POST failed:', profRes.status, profErr);
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Compte créé mais profil non initialisé. Contactez le support.' }) };
    }
  } catch(e) {
    console.error('[signup-setup] profile:', e.message);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Erreur réseau lors de la création du profil.' }) };
  }

  // ── 6. Créer l'abonnement (essai 14 jours) ───────────────────
  try {
    const planPrices = { solo: 29, multi: 49, enterprise: 0 };
    const trialEnd   = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    await fetch(`${SUPABASE_URL}/rest/v1/subscriptions`, {
      method: 'POST',
      headers: { ...svcHeaders, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        tenant_id: tenantId, plan, status: 'trial', trial_ends_at: trialEnd,
        price_per_month: planPrices[plan] ?? 49
      })
    });
  } catch(e) { console.error('[signup-setup] subscription:', e.message); }

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({ tenantId, role: 'directeur' })
  };
};
