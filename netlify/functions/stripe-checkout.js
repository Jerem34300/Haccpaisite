/**
 * stripe-checkout.js — Crée une session Stripe Checkout
 *
 * POST /stripe-checkout
 * Body : { plan: 'solo'|'multi', customerEmail, tenantId, returnUrl }
 * Headers : Authorization: Bearer <JWT>
 *
 * Flux :
 *  1. Vérifier JWT → userId
 *  2. Récupérer ou créer le customer Stripe
 *  3. Créer la session Checkout (paiement récurrent)
 *  4. Retourner { url }
 *
 * Env vars Netlify :
 *   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
 *   STRIPE_PRICE_SOLO, STRIPE_PRICE_MULTI
 *   STRIPE_PRICE_SOLO_ANNUAL, STRIPE_PRICE_MULTI_ANNUAL
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY
 */

const Stripe = require('stripe');

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;

const PLAN_PRICES = {
  solo:         process.env.STRIPE_PRICE_SOLO,
  multi:        process.env.STRIPE_PRICE_MULTI,
  solo_annual:  process.env.STRIPE_PRICE_SOLO_ANNUAL,
  multi_annual: process.env.STRIPE_PRICE_MULTI_ANNUAL,
};

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

// Vérifie que l'utilisateur authentifié appartient bien au tenant demandé
// (sinon un tenant pourrait agir sur l'abonnement Stripe d'un autre).
async function assertTenantMembership(userId, tenantId) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=tenant_id&limit=1`,
    { headers: svcHeaders() }
  );
  if (!r.ok) throw new Error('Profil inaccessible');
  const rows = await r.json();
  if (!rows?.[0] || rows[0].tenant_id !== tenantId) {
    const err = new Error('Accès refusé à ce tenant');
    err.forbidden = true;
    throw err;
  }
}

async function getSubscription(tenantId) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/subscriptions?tenant_id=eq.${tenantId}&limit=1&select=*`,
    { headers: svcHeaders() }
  );
  const rows = await r.json();
  return rows?.[0] || null;
}

async function updateSubscription(tenantId, patch) {
  await fetch(
    `${SUPABASE_URL}/rest/v1/subscriptions?tenant_id=eq.${tenantId}`,
    {
      method: 'PATCH',
      headers: { ...svcHeaders(), 'Prefer': 'return=minimal' },
      body: JSON.stringify(patch),
    }
  );
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

  const { plan, period, customerEmail, tenantId, returnUrl } = payload;
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');

  if (!jwt) return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Token manquant' }) };
  if (!tenantId) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'tenantId manquant' }) };
  if (!plan || !['solo','multi'].includes(plan)) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Plan invalide' }) };

  const priceKey = (period === 'annual') ? `${plan}_annual` : plan;
  if (!PLAN_PRICES[priceKey]) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: `Price ID manquant pour ${priceKey} — vérifiez les variables d'environnement Netlify` }) };

  try {
    const user = await verifyJwt(jwt);
    await assertTenantMembership(user.id, tenantId);
  } catch (e) {
    return { statusCode: e.forbidden ? 403 : 401, headers: cors, body: JSON.stringify({ error: e.message }) };
  }

  const stripe = Stripe(stripeKey);
  const priceId = PLAN_PRICES[priceKey];
  const baseUrl = returnUrl || 'https://hacc.pro';

  try {
    const sub = await getSubscription(tenantId);
    let customerId = sub?.stripe_customer_id || null;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: customerEmail || undefined,
        metadata: { tenant_id: tenantId, plan },
      });
      customerId = customer.id;
      await updateSubscription(tenantId, { stripe_customer_id: customerId });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/dashboard.html?payment=success`,
      cancel_url:  `${baseUrl}/paywall.html?cancelled=1`,
      metadata: { tenant_id: tenantId, plan, period: period || 'monthly' },
      subscription_data: {
        metadata: { tenant_id: tenantId, plan, period: period || 'monthly' },
      },
      allow_promotion_codes: true,
      locale: 'fr',
    });

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ url: session.url }),
    };
  } catch (e) {
    console.error('[stripe-checkout]', e.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
