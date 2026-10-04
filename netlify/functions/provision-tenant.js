/**
 * provision-tenant.js — Netlify Function : provisionnement complet post-onboarding
 *
 * Appelée depuis generatePMS() (app-onboarding.js) pour créer atomiquement
 * le tenant, site, profil et abonnement avec la service_role_key, contournant
 * les RLS qui bloquent les inserts directs par l'utilisateur normal.
 *
 * Flux :
 *   1. Vérifier le JWT via /auth/v1/user
 *   2. Idempotence — si le profil a déjà un tenant_id, retourner l'existant
 *   3. Créer tenant
 *   4. Créer subscription trial 14 jours
 *   5. Créer le site principal
 *   6. Créer ou mettre à jour le profil utilisateur
 *
 * Variables d'environnement Netlify :
 *   SUPABASE_URL         = https://…supabase.co
 *   SUPABASE_ANON_KEY    = (clé anon publique)
 *   SUPABASE_SERVICE_KEY = (clé service_role — jamais dans le code client)
 */

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

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

function _normSiteName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function _planMaxSites(plan) {
  if (plan === 'solo') return 1;
  if (plan === 'enterprise') return 50;
  return 3; // multi
}

/** Noms demandés, dédoublonnés, plafonnés au plan. Solo : une seule cuisine. */
function _requestedSiteNames(body) {
  const out = [];
  const seen = new Set();
  function add(n) {
    const t = String(n || '').trim();
    const k = _normSiteName(t);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(t);
  }
  if (Array.isArray(body.siteNames)) body.siteNames.forEach(add);
  if (!out.length) add(body.siteName);
  return out.slice(0, _planMaxSites(body.plan || 'solo'));
}

function _siteCodeFromName(name) {
  const letters = String(name || 'SIT')
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 3)
    .padEnd(3, 'X');
  return letters + String(Math.floor(Math.random() * 89 + 10));
}

async function _listTenantSites(tenantId) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/sites?tenant_id=eq.${tenantId}&select=id,name,code`,
      { headers: svcHeaders }
    );
    if (!r.ok) return [];
    const rows = await r.json();
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.error('[provision-tenant] list sites:', e.message);
    return [];
  }
}

/** Même insert que le site principal (service_role). Retry si le code est déjà pris. */
async function _insertSite(tenantId, name, extras) {
  const plan = extras.plan || 'solo';
  for (let attempt = 0; attempt < 5; attempt++) {
    const siteCode = _siteCodeFromName(name);
    const row = {
      tenant_id: tenantId,
      name:      name,
      code:      siteCode,
      type:      extras.type || 'restaurant',
      siret:     extras.siret || null,
      color:     extras.color || '#0F2240',
    };
    // Multi : le PMS de cette cuisine n'est pas encore appliqué (écran de choix).
    // Solo / entreprise : config vide, écrite ensuite par le client comme avant.
    if (plan === 'multi') row.config = { pmsPending: true };
    try {
      const siteResp = await fetch(`${SUPABASE_URL}/rest/v1/sites`, {
        method:  'POST',
        headers: { ...svcHeaders, 'Prefer': 'return=representation' },
        body:    JSON.stringify(row),
      });
      if (siteResp.ok) {
        const sites = await siteResp.json();
        const siteId = Array.isArray(sites) ? sites[0]?.id : sites?.id;
        return { id: siteId || null, code: siteCode, name, created: true };
      }
      const errTxt = await siteResp.text();
      const dup = siteResp.status === 409 || /duplicate|unique/i.test(errTxt);
      if (dup) continue;
      console.error('[provision-tenant] site POST:', siteResp.status, errTxt);
      return null;
    } catch (e) {
      console.error('[provision-tenant] site:', e.message);
      return null;
    }
  }
  console.error('[provision-tenant] site: code unique introuvable pour', name);
  return null;
}

/**
 * Crée les cuisines manquantes du tenant (noms demandés).
 * Ne touche pas une cuisine déjà présente (même nom) : created:false.
 */
async function _ensureNamedSites(tenantId, names, extras) {
  const existing = await _listTenantSites(tenantId);
  const max = _planMaxSites(extras.plan || 'solo');
  const out = [];
  let count = existing.length;
  let capped = false;
  for (const name of names) {
    const found = existing.find(s => _normSiteName(s.name) === _normSiteName(name))
      || out.find(s => _normSiteName(s.name) === _normSiteName(name));
    if (found) {
      out.push({ id: found.id, code: found.code, name: found.name || name, created: false });
      continue;
    }
    if (count >= max) { capped = true; continue; }
    const created = await _insertSite(tenantId, name, extras);
    if (created) {
      out.push(created);
      count += 1;
    }
  }
  return { sites: out, capped };
}


const EXTRA_KITCHEN_LOOKUP = 'haccpro_extra_kitchen_19';

async function _extraKitchenPriceId(stripe) {
  const fromEnv = process.env.STRIPE_PRICE_EXTRA_KITCHEN;
  if (fromEnv) return fromEnv;
  const listed = await stripe.prices.list({ lookup_keys: [EXTRA_KITCHEN_LOOKUP], limit: 1 });
  if (listed.data && listed.data[0] && listed.data[0].id) return listed.data[0].id;
  try {
    const price = await stripe.prices.create({
      currency: 'eur',
      unit_amount: 1900,
      recurring: { interval: 'month' },
      lookup_key: EXTRA_KITCHEN_LOOKUP,
      nickname: 'Cuisine supplémentaire',
      product_data: { name: 'Cuisine supplémentaire' },
      metadata: { kind: 'extra_kitchen' },
    });
    return price.id;
  } catch (e) {
    const again = await stripe.prices.list({ lookup_keys: [EXTRA_KITCHEN_LOOKUP], limit: 1 });
    if (again.data && again.data[0] && again.data[0].id) return again.data[0].id;
    throw e;
  }
}

/** quantity = nombre de cuisines au-delà des 3 incluses. 0 retire la ligne. */
async function _setExtraKitchenQuantity(tenantId, quantity) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    const err = new Error('STRIPE_SECRET_KEY manquante sur Netlify : le supplément de 19 €/mois ne peut pas être ajouté.');
    err.code = 'stripe_config';
    throw err;
  }
  const subResp = await fetch(
    `${SUPABASE_URL}/rest/v1/subscriptions?tenant_id=eq.${tenantId}&select=stripe_subscription_id&limit=1`,
    { headers: svcHeaders }
  );
  const subs = subResp.ok ? await subResp.json() : [];
  const subId = subs?.[0]?.stripe_subscription_id || '';
  if (!subId) {
    const err = new Error('Aucun abonnement Stripe. Souscrivez le pack Multi avant d\'ajouter une cuisine à 19 €/mois.');
    err.code = 'no_subscription';
    throw err;
  }
  const stripe = require('stripe')(stripeKey);
  const priceId = await _extraKitchenPriceId(stripe);
  const stripeSub = await stripe.subscriptions.retrieve(subId);
  const items = (stripeSub.items && stripeSub.items.data) || [];
  const item = items.find(it => it.price && (it.price.id === priceId || it.price.lookup_key === EXTRA_KITCHEN_LOOKUP));
  const pay = { proration_behavior: 'always_invoice', payment_behavior: 'error_if_incomplete' };
  if (quantity <= 0) {
    if (item) await stripe.subscriptionItems.del(item.id, { proration_behavior: 'create_prorations' });
    return priceId;
  }
  if (item) await stripe.subscriptionItems.update(item.id, Object.assign({ quantity }, pay));
  else await stripe.subscriptionItems.create(Object.assign({ subscription: subId, price: priceId, quantity }, pay));
  return priceId;
}

/**
 * Cuisines 1 à 3 : créées sans facturation.
 * À partir de la 4e : la ligne Stripe 19 €/mois (quantité = cuisines au-delà de 3)
 * est mise à jour avant l'insert. Si Stripe refuse, la cuisine n'est pas créée.
 */
async function _addMultiKitchens(tenantId, names, extras) {
  const existing = await _listTenantSites(tenantId);
  const out = [];
  const known = existing.slice();
  let count = existing.length;
  for (const name of names) {
    const found = known.find(s => _normSiteName(s.name) === _normSiteName(name))
      || out.find(s => _normSiteName(s.name) === _normSiteName(name));
    if (found) {
      out.push({ id: found.id, code: found.code, name: found.name || name, created: false });
      continue;
    }
    let billedQty = 0;
    if (count >= 3) {
      billedQty = count + 1 - 3;
      await _setExtraKitchenQuantity(tenantId, billedQty);
    }
    const created = await _insertSite(tenantId, name, Object.assign({}, extras, { plan: 'multi' }));
    if (!created) {
      if (billedQty > 0) {
        try { await _setExtraKitchenQuantity(tenantId, billedQty - 1); }
        catch (e) { console.error('[provision-tenant] revert extra kitchen:', e.message); }
      }
      continue;
    }
    out.push(created);
    count += 1;
    known.push(created);
  }
  return out;
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Méthode non autorisée' }) };
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('[provision-tenant] Variables d\'environnement manquantes');
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Configuration serveur manquante' }) };
  }

  // ── 1. Parser le body ──────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch(e) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'JSON invalide' }) };
  }

  const userToken = (event.headers.authorization || event.headers.Authorization || '').replace('Bearer ', '');
  if (!userToken) {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Token manquant' }) };
  }

  // body attendu : { companyName, plan, color, siteName, siret, type, fullName }
  const {
    companyName = 'Mon entreprise',
    plan        = 'solo',
    color       = '#0F2240',
    siteName,
    siret       = null,
    type        = 'restaurant',
    fullName    = null,
  } = body;

  // ── 2. Vérifier le JWT → récupérer l'userId ───────────────────
  let userId;
  try {
    const meResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_ANON || SERVICE_KEY, 'Authorization': `Bearer ${userToken}` }
    });
    if (!meResp.ok) throw new Error('Token invalide');
    const me = await meResp.json();
    if (!me.id) throw new Error('Utilisateur introuvable');
    userId = me.id;
  } catch(e) {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: e.message }) };
  }

  // ── 3. Idempotence — vérifier l'état du profil existant ────────
  let tenantId;
  try {
    const existCheck = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=tenant_id,site_id,role&limit=1`,
      { headers: svcHeaders }
    );
    if (existCheck.ok) {
      const existing = await existCheck.json();
      if (body.addKitchen) {
        const tid = existing?.[0]?.tenant_id;
        if (!tid) {
          return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Organisation introuvable' }) };
        }
        let billedPlan = plan;
        try {
          const subResp = await fetch(
            `${SUPABASE_URL}/rest/v1/subscriptions?tenant_id=eq.${tid}&select=plan&limit=1`,
            { headers: svcHeaders }
          );
          if (subResp.ok) {
            const subs = await subResp.json();
            if (subs?.[0]?.plan) billedPlan = subs[0].plan;
          }
        } catch (e) { console.warn('[provision-tenant] plan:', e.message); }
        if (billedPlan !== 'multi') {
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ ok: true, capped: true, plan: billedPlan, sites: [], tenant_id: tid })
          };
        }
        const requestedAdd = _requestedSiteNames({ ...body, plan: 'multi' });
        let addedSites = [];
        try {
          addedSites = await _addMultiKitchens(tid, requestedAdd, { type, siret, color, plan: 'multi' });
        } catch (e) {
          console.error('[provision-tenant] addKitchen:', e.message);
          const code = e.code === 'stripe_config' || e.code === 'no_subscription' ? 402 : 500;
          return { statusCode: code, headers: corsHeaders, body: JSON.stringify({ ok: false, capped: true, error: e.message || 'Création de la cuisine impossible' }) };
        }
        const didCreate = (addedSites || []).some(s => s && s.created);
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            ok: true,
            capped: false,
            plan: 'multi',
            tenant_id: tid,
            sites: addedSites || [],
            created: didCreate
          })
        };
      }
      if (existing?.[0]?.tenant_id && existing?.[0]?.site_id) {
        // Tenant ET site déjà créés : idempotence complète.
        // Multi : si l'appel redemande des noms, créer seulement les cuisines absentes
        // (sans réécrire les sites déjà là — Jean Jaurès, Centrale Lyon, etc.).
        let existingSiteCode = null;
        let existingSiteName = null;
        try {
          const siteCheck = await fetch(
            `${SUPABASE_URL}/rest/v1/sites?id=eq.${existing[0].site_id}&select=code,name&limit=1`,
            { headers: svcHeaders }
          );
          if (siteCheck.ok) {
            const sites = await siteCheck.json();
            existingSiteCode = sites?.[0]?.code || null;
            existingSiteName = sites?.[0]?.name || null;
          }
        } catch(e) { /* ignore */ }
        let sitesOut = [];
        try {
          const requested = _requestedSiteNames(body);
          if (plan === 'solo') {
            sitesOut = [{
              id: existing[0].site_id,
              code: existingSiteCode,
              name: existingSiteName || requested[0] || siteName || '',
              created: false
            }];
          } else if (requested.length) {
            const ensured = await _ensureNamedSites(existing[0].tenant_id, requested, { type, siret, color, plan });
            sitesOut = ensured.sites || [];
          }
        } catch (e) {
          console.error('[provision-tenant] ensure sites:', e.message);
        }
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            ok: true,
            tenant_id: existing[0].tenant_id,
            site_id:   existing[0].site_id,
            site_code: existingSiteCode,
            role:      existing[0].role || (plan === 'solo' ? 'cuisinier' : 'directeur'),
            existing:  true,
            sites:     sitesOut
          })
        };
      }
      // Tenant existe mais pas de site (créé par signup-setup) → réutiliser le tenant
      if (existing?.[0]?.tenant_id) {
        tenantId = existing[0].tenant_id;
      }
    }
  } catch(e) { /* on continue */ }

  if (body.addKitchen) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Organisation introuvable' }) };
  }

  // ── 4. Créer le tenant (si pas encore existant) ───────────────
  if (!tenantId) {
    const slug = (companyName || 'tenant')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
      + '-' + Math.random().toString(36).slice(2, 7);

    try {
      const tenantResp = await fetch(`${SUPABASE_URL}/rest/v1/tenants`, {
        method:  'POST',
        headers: { ...svcHeaders, 'Prefer': 'return=representation' },
        body:    JSON.stringify({ name: companyName, plan, slug, primary_color: color })
      });
      if (!tenantResp.ok) {
        const err = await tenantResp.text();
        console.error('[provision-tenant] tenant POST:', tenantResp.status, err);
        throw new Error('Création tenant échouée : ' + err);
      }
      const tenants = await tenantResp.json();
      tenantId = Array.isArray(tenants) ? tenants[0]?.id : tenants?.id;
      if (!tenantId) throw new Error('ID tenant manquant dans la réponse');
    } catch(e) {
      console.error('[provision-tenant] tenant:', e.message);
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: e.message }) };
    }
  }

  // ── 5. Créer la subscription trial 14 jours ───────────────────
  try {
    const planPrices  = { solo: 29, multi: 49, enterprise: 0 };
    const trialEndsAt = new Date(Date.now() + 14 * 864e5).toISOString();
    await fetch(`${SUPABASE_URL}/rest/v1/subscriptions`, {
      method:  'POST',
      headers: { ...svcHeaders, 'Prefer': 'return=minimal' },
      body:    JSON.stringify({
        tenant_id:       tenantId,
        plan,
        status:          'trial',
        trial_ends_at:   trialEndsAt,
        price_per_month: planPrices[plan] ?? 49
      })
    });
  } catch(e) { console.warn('[provision-tenant] subscription:', e.message); }

  // ── 6. Créer le site principal + les cuisines nommées (même chemin service_role) ──
  const requestedNames = _requestedSiteNames({ ...body, siteName: siteName || companyName, plan });
  const finalSiteName = requestedNames[0] || siteName || companyName;
  let createdSites = [];
  try {
    const ensured = await _ensureNamedSites(tenantId, requestedNames.length ? requestedNames : [finalSiteName], {
      type, siret, color, plan
    });
    createdSites = ensured.sites || [];
  } catch (e) {
    console.error('[provision-tenant] ensure sites:', e.message);
  }
  const primary = createdSites[0] || null;
  const siteId = primary?.id || null;
  const siteCode = primary?.code || null;

  // ── 7. Créer ou mettre à jour le profil utilisateur ───────────
  // Solo plan → cuisinier (accès direct PMS), sinon siege (pilotage dashboard multi-cuisines)
  const profileRole = plan === 'solo' ? 'cuisinier' : 'siege';
  try {
    const profResp = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
      method:  'POST',
      headers: { ...svcHeaders, 'Prefer': 'return=minimal,resolution=merge-duplicates' },
      body:    JSON.stringify({
        id:        userId,
        tenant_id: tenantId,
        site_id:   siteId || null,
        role:      profileRole,
        full_name: fullName || companyName
      })
    });
    if (!profResp.ok) {
      const profErr = await profResp.text();
      console.error('[provision-tenant] profile POST:', profResp.status, profErr);
    }
  } catch(e) { console.error('[provision-tenant] profile:', e.message); }

  return {
    statusCode: 200,
    headers:    corsHeaders,
    body:       JSON.stringify({
      ok: true,
      tenant_id: tenantId,
      site_id: siteId,
      site_code: siteCode,
      role: profileRole,
      sites: createdSites
    })
  };
};
