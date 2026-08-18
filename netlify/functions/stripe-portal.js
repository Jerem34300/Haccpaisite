/**
 * stripe-portal.js — Crée une session Stripe Customer Portal
 *
 * POST /stripe-portal
 * Body : { tenantId, returnUrl }
 * Headers : Authorization: Bearer <JWT>
 *
 * Permet au client de gérer son abonnement (changer de carte,
 * télécharger factures, annuler) sans passer par notre support.
 *
 * Env vars Netlify :
 *   STRIPE_SECRET_KEY
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY
 */

const Stripe = require('stripe');

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function svcHeaders() {
  return {
    'Content-Type':  'application/json',
    'Accept':        'application/json',
    'apikey':        SERVICE_KEY || '',
    'Authorization': `Bearer ${SERVICE_KEY || ''}`,
  };
}

async function verifyJwt(token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}` },
  });
  if (!r.ok) throw new Error('Token invalide');
  const u = await r.json();
  if (!u.id) throw new Error('Utilisateur introuvable');
  return u;
}

// Vérifie que l'utilisateur authentifié appartient au tenant demandé (sinon il
// pourrait ouvrir le portail de facturation Stripe d'un autre tenant).
async function assertTenantMembership(userId, tenantId) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=tenant_id&limit=1`,
    { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Accept': 'application/json' } }
  );
  if (!r.ok) throw new Error('Profil inaccessible');
  const rows = await r.json();
  if (!rows?.[0] || rows[0].tenant_id !== tenantId) {
    const err = new Error('Accès refusé à ce tenant');
    err.forbidden = true;
    throw err;
  }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Méthode non autorisée' }) };

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey || !SUPABASE_URL || !SERVICE_KEY) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Configuration serveur manquante' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'JSON invalide' }) }; }

  const { tenantId, returnUrl } = payload;
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');

  if (!jwt)      return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Token manquant' }) };
  if (!tenantId) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'tenantId manquant' }) };

  try {
    const user = await verifyJwt(jwt);
    await assertTenantMembership(user.id, tenantId);
  } catch (e) {
    return { statusCode: e.forbidden ? 403 : 401, headers: cors, body: JSON.stringify({ error: e.message }) };
  }

  // Récupérer stripe_customer_id depuis la DB
  let customerId;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/subscriptions?tenant_id=eq.${tenantId}&limit=1&select=stripe_customer_id`,
      { headers: svcHeaders() }
    );
    const rows = await r.json();
    customerId = rows?.[0]?.stripe_customer_id || null;
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Erreur base de données' }) };
  }

  if (!customerId) {
    return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'Aucun abonnement Stripe trouvé. Souscrivez d\'abord un plan.' }) };
  }

  const stripe = Stripe(stripeKey);
  const baseUrl = returnUrl || 'https://hacc.pro/dashboard.html';

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: baseUrl,
    });
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ url: session.url }),
    };
  } catch (e) {
    console.error('[stripe-portal]', e.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
