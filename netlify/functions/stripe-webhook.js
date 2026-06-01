/**
 * stripe-webhook.js — Reçoit les événements Stripe et met à jour Supabase
 *
 * POST /stripe-webhook (configuré dans le dashboard Stripe)
 *
 * Événements gérés :
 *   checkout.session.completed       → active l'abonnement
 *   invoice.payment_succeeded        → renouvelle la période courante
 *   invoice.payment_failed           → passe en past_due
 *   customer.subscription.deleted    → annule l'abonnement
 *   customer.subscription.updated    → synchronise plan + période
 *
 * Env vars Netlify :
 *   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const Stripe  = require('stripe');
const crypto  = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

function svcHeaders() {
  return {
    'Content-Type':  'application/json',
    'Accept':        'application/json',
    'apikey':        SERVICE_KEY || '',
    'Authorization': `Bearer ${SERVICE_KEY || ''}`,
  };
}

async function patchByStripeSubId(stripeSubId, patch) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/subscriptions?stripe_subscription_id=eq.${stripeSubId}`,
    {
      method: 'PATCH',
      headers: { ...svcHeaders(), 'Prefer': 'return=minimal' },
      body: JSON.stringify(patch),
    }
  );
  return r.ok;
}

async function patchByTenantId(tenantId, patch) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/subscriptions?tenant_id=eq.${tenantId}`,
    {
      method: 'PATCH',
      headers: { ...svcHeaders(), 'Prefer': 'return=minimal' },
      body: JSON.stringify(patch),
    }
  );
  return r.ok;
}

async function patchByCustomerId(customerId, patch) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/subscriptions?stripe_customer_id=eq.${customerId}`,
    {
      method: 'PATCH',
      headers: { ...svcHeaders(), 'Prefer': 'return=minimal' },
      body: JSON.stringify(patch),
    }
  );
  return r.ok;
}

function verifyStripeSignature(rawBody, sigHeader, secret) {
  const parts = sigHeader.split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    acc[k] = v;
    return acc;
  }, {});
  const timestamp = parts['t'];
  const sig = parts['v1'];
  if (!timestamp || !sig) throw new Error('Signature malformée');

  const tolerance = 300; // 5 minutes
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > tolerance) {
    throw new Error('Timestamp trop ancien');
  }

  const payload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  // Comparaison à temps constant (évite les timing attacks)
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(sig, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('Signature invalide');
  }
}

// L'API Stripe récente (Basil 2025+) déplace current_period_end de l'objet
// Subscription vers ses items. On lit les deux pour rester compatible.
function subPeriodEnd(sub) {
  if (!sub) return null;
  const raw = (sub.items && sub.items.data && sub.items.data[0]
              && sub.items.data[0].current_period_end)
              || sub.current_period_end;
  if (!raw) return null;
  const d = new Date(raw * 1000);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const stripeKey   = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeKey || !webhookSecret || !SUPABASE_URL || !SERVICE_KEY) {
    console.error('[stripe-webhook] Variables d\'environnement manquantes');
    return { statusCode: 500, body: 'Configuration manquante' };
  }

  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'] || '';
  const rawBody = event.body;

  try {
    verifyStripeSignature(rawBody, sig, webhookSecret);
  } catch (e) {
    console.error('[stripe-webhook] Signature invalide:', e.message);
    return { statusCode: 400, body: `Webhook Error: ${e.message}` };
  }

  let stripeEvent;
  try {
    stripeEvent = JSON.parse(rawBody);
  } catch (e) {
    return { statusCode: 400, body: 'JSON invalide' };
  }

  const { type, data } = stripeEvent;
  const obj = data.object;

  console.log('[stripe-webhook] Événement reçu:', type);

  try {
    switch (type) {

      // ── Paiement initial validé (après checkout) ──────────────────
      case 'checkout.session.completed': {
        const tenantId  = obj.metadata?.tenant_id;
        const plan      = obj.metadata?.plan || 'multi';
        const subId     = obj.subscription;
        const custId    = obj.customer;

        if (!tenantId || !subId) break;

        const stripe = Stripe(stripeKey);
        const stripeSub = await stripe.subscriptions.retrieve(subId);
        const periodEnd = subPeriodEnd(stripeSub);
        const priceId   = stripeSub.items.data[0]?.price?.id || null;

        const patch = {
          status:                  'active',
          stripe_customer_id:      custId,
          stripe_subscription_id:  subId,
          stripe_price_id:         priceId,
          cancel_at_period_end:    false,
        };
        if (periodEnd) patch.current_period_end = periodEnd;
        await patchByTenantId(tenantId, patch);
        console.log('[stripe-webhook] Abonnement activé pour tenant:', tenantId);
        break;
      }

      // ── Renouvellement mensuel réussi ─────────────────────────────
      case 'invoice.payment_succeeded': {
        const subId   = obj.subscription;
        const custId  = obj.customer;
        if (!subId) break;

        const stripe = Stripe(stripeKey);
        const stripeSub = await stripe.subscriptions.retrieve(subId);
        const periodEnd = subPeriodEnd(stripeSub);

        const patch = { status: 'active' };
        if (periodEnd) patch.current_period_end = periodEnd;
        await patchByStripeSubId(subId, patch);
        break;
      }

      // ── Paiement échoué ───────────────────────────────────────────
      case 'invoice.payment_failed': {
        const subId = obj.subscription;
        if (!subId) break;
        await patchByStripeSubId(subId, { status: 'past_due' });
        console.log('[stripe-webhook] Paiement échoué pour sub:', subId);
        break;
      }

      // ── Abonnement annulé ─────────────────────────────────────────
      case 'customer.subscription.deleted': {
        await patchByStripeSubId(obj.id, { status: 'cancelled' });
        break;
      }

      // ── Abonnement modifié (changement de plan, annulation future) ─
      case 'customer.subscription.updated': {
        const periodEnd = subPeriodEnd(obj);
        const patch = {
          cancel_at_period_end: !!obj.cancel_at_period_end,
          status: obj.status === 'active' ? 'active'
                : obj.status === 'past_due' ? 'past_due'
                : obj.status === 'canceled' ? 'cancelled'
                : obj.status,
        };
        if (periodEnd) patch.current_period_end = periodEnd;
        await patchByStripeSubId(obj.id, patch);
        break;
      }

      default:
        console.log('[stripe-webhook] Événement ignoré:', type);
    }
  } catch (e) {
    console.error('[stripe-webhook] Erreur traitement:', type, e.message);
    return { statusCode: 500, body: 'Erreur interne' };
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
