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
      if (existing?.[0]?.tenant_id && existing?.[0]?.site_id) {
        // Tenant ET site déjà créés : idempotence complète
        let existingSiteCode = null;
        try {
          const siteCheck = await fetch(
            `${SUPABASE_URL}/rest/v1/sites?id=eq.${existing[0].site_id}&select=code&limit=1`,
            { headers: svcHeaders }
          );
          if (siteCheck.ok) {
            const sites = await siteCheck.json();
            existingSiteCode = sites?.[0]?.code || null;
          }
        } catch(e) { /* ignore */ }
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            ok: true,
            tenant_id: existing[0].tenant_id,
            site_id:   existing[0].site_id,
            site_code: existingSiteCode,
            role:      existing[0].role || (plan === 'solo' ? 'cuisinier' : 'directeur'),
            existing:  true
          })
        };
      }
      // Tenant existe mais pas de site (créé par signup-setup) → réutiliser le tenant
      if (existing?.[0]?.tenant_id) {
        tenantId = existing[0].tenant_id;
      }
    }
  } catch(e) { /* on continue */ }

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

  // ── 6. Créer le site principal ────────────────────────────────
  const finalSiteName = siteName || companyName;
  // Code site : 3 premières lettres du nom + 2 chiffres aléatoires (ex: LAJ47)
  const _siteLetters = (finalSiteName || companyName || 'SIT')
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 3)
    .padEnd(3, 'X');
  const siteCode = _siteLetters + String(Math.floor(Math.random() * 89 + 10));

  let siteId = null;
  try {
    const siteResp = await fetch(`${SUPABASE_URL}/rest/v1/sites`, {
      method:  'POST',
      headers: { ...svcHeaders, 'Prefer': 'return=representation' },
      body:    JSON.stringify({
        tenant_id: tenantId,
        name:      finalSiteName,
        code:      siteCode,
        primary_color: color
      })
    });
    if (siteResp.ok) {
      const sites = await siteResp.json();
      siteId = Array.isArray(sites) ? sites[0]?.id : sites?.id;
    } else {
      console.error('[provision-tenant] site POST:', siteResp.status, await siteResp.text());
    }
  } catch(e) { console.error('[provision-tenant] site:', e.message); }

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
    body:       JSON.stringify({ ok: true, tenant_id: tenantId, site_id: siteId, site_code: siteCode, role: profileRole })
  };
};
