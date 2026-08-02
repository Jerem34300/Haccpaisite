/**
 * beta-offer-status.js — Statut public de l'offre de lancement (code HACCBETA)
 *
 * GET /beta-offer-status
 * Réponse : { active: boolean, remaining: number|null }
 *
 * Lit le coupon Stripe derrière le code promo HACCBETA et déduit s'il reste
 * des rédemptions disponibles (max_redemptions - times_redeemed). Utilisé
 * par la landing page pour masquer automatiquement le bandeau et les prix
 * promotionnels une fois les 20 places prises — sans ça, la page statique
 * continuerait à afficher l'offre indéfiniment.
 *
 * Fail-open : en cas d'erreur, de clé manquante, ou de code pas encore créé
 * dans Stripe, on renvoie active:true pour ne jamais masquer une offre par
 * erreur (le pire cas reste l'état actuel : l'offre reste visible).
 *
 * Env vars Netlify :
 *   STRIPE_SECRET_KEY
 *   BETA_PROMO_CODE (optionnel, défaut "HACCBETA")
 */

const Stripe = require('stripe');

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=300', // 5 min : évite de spammer l'API Stripe à chaque chargement de page
};

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const code = process.env.BETA_PROMO_CODE || 'HACCBETA';

  if (!stripeKey) {
    return { statusCode: 200, headers: cors, body: JSON.stringify({ active: true, remaining: null }) };
  }

  try {
    const stripe = Stripe(stripeKey);
    const list = await stripe.promotionCodes.list({ code, limit: 1 });
    const promo = list?.data?.[0];

    if (!promo) {
      // Code pas encore créé côté Stripe : on n'a rien à masquer.
      return { statusCode: 200, headers: cors, body: JSON.stringify({ active: true, remaining: null }) };
    }

    if (!promo.active) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ active: false, remaining: 0 }) };
    }

    const couponId = typeof promo.coupon === 'string' ? promo.coupon : promo.coupon?.id;
    const coupon = couponId ? await stripe.coupons.retrieve(couponId) : promo.coupon;

    const maxRedemptions = coupon?.max_redemptions ?? null;
    const timesRedeemed  = coupon?.times_redeemed ?? 0;

    if (maxRedemptions == null) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ active: true, remaining: null }) };
    }

    const remaining = Math.max(0, maxRedemptions - timesRedeemed);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ active: remaining > 0, remaining }) };
  } catch (e) {
    console.error('[beta-offer-status]', e.message);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ active: true, remaining: null }) };
  }
};
