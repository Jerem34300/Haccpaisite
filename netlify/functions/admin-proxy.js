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

// Tables REST scopées par la colonne tenant_id (isolation injectée pour les non-super_admin)
const TENANT_SCOPED_TABLES = ['profiles', 'sites', 'sectors', 'territories', 'subscriptions', 'pms_records', 'gmo'];
// Référentiels globaux partagés (pas de tenant_id) : lecture seule pour les non-super_admin
const GLOBAL_TABLES = ['corrective_actions', 'nc_action_mapping'];
// En-têtes que le client peut transmettre (jamais apikey / Authorization)
const SAFE_HEADER_KEYS = ['prefer', 'range', 'range-unit', 'content-profile', 'accept-profile'];

// Renvoie le nom de table d'un chemin /rest/v1/<table>?... (ou null)
function restTable(path) {
  const m = path.match(/^\/rest\/v1\/([a-z_]+)/i);
  return m ? m[1].toLowerCase() : null;
}

// Ajoute un filtre PostgREST à un chemin (gère ? vs &)
function appendFilter(path, filter) {
  return path + (path.includes('?') ? '&' : '?') + filter;
}

// Renvoie le tenant_id du profil d'un compte (ou undefined si introuvable)
async function profileTenantOf(uid) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}&select=tenant_id&limit=1`,
      { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
    );
    if (!r.ok) return undefined;
    const rows = await r.json();
    return rows && rows[0] ? (rows[0].tenant_id ?? null) : undefined;
  } catch (e) { return undefined; }
}

// Force tenant_id = <tenant> sur un corps d'insertion (objet ou tableau)
function forceTenantOnBody(body, tenant) {
  if (Array.isArray(body)) return body.map(o => ({ ...o, tenant_id: tenant }));
  if (body && typeof body === 'object') return { ...body, tenant_id: tenant };
  return body;
}

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

  // ── 4. Vérifier le rôle admin + récupérer le tenant ───────
  // Utilise la service_role key pour bypasser les politiques RLS
  // (nécessaire pour les super_admin qui n'ont pas de tenant_id dans leur JWT)
  let callerRole = '';
  let callerTenant = null;
  try {
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=role,tenant_id&limit=1`,
      { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
    );
    if (!profileRes.ok) throw new Error('Profil inaccessible');
    const profiles = await profileRes.json();
    callerRole   = profiles?.[0]?.role || '';
    callerTenant = profiles?.[0]?.tenant_id || null;
    if (!ALLOWED_ROLES.includes(callerRole)) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: `Rôle insuffisant : ${callerRole}` }) };
    }
  } catch(e) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Vérification rôle échouée' }) };
  }
  const isSuperAdmin = callerRole === 'super_admin';

  // ── 5. Parser la requête ──────────────────────────────────
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch(e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Corps JSON invalide' }) };
  }

  const { method: rawMethod = 'GET', body: reqBody = null, extraHeaders = {} } = payload;
  let path = payload.path || '';
  const method = String(rawMethod).toUpperCase();

  // ── 6. Whitelist des chemins ──────────────────────────────
  const pathOk = ALLOWED_PATH_PREFIXES.some(p => path.startsWith(p));
  if (!pathOk) {
    console.warn('[admin-proxy] Chemin refusé :', path);
    return { statusCode: 403, headers, body: JSON.stringify({ error: `Chemin non autorisé : ${path}` }) };
  }

  // ── 6b. Garde écritures : un DELETE/PATCH REST doit être filtré ──
  // (empêche un DELETE /rest/v1/tenants qui viderait toute la table)
  const isRest = path.startsWith('/rest/v1/');
  if (isRest && (method === 'DELETE' || method === 'PATCH')) {
    const qs = path.split('?')[1] || '';
    if (!/=/.test(qs)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Opération non bornée refusée (filtre requis)' }) };
    }
  }

  // ── 6c. Isolation tenant pour les non-super_admin ──────────
  // Le super_admin garde l'accès cross-tenant (console + impersonation).
  // Les siège/directeur sont strictement bornés à leur propre tenant.
  let bodyToSend = reqBody;
  let scopeAuthUsersGet = false; // post-filtrage d'un GET /auth/v1/admin/users
  if (!isSuperAdmin) {
    if (isRest) {
      const table = restTable(path);
      if (GLOBAL_TABLES.includes(table)) {
        // Référentiels globaux partagés (sans tenant_id) : lecture pour tous,
        // écriture réservée à siege/directeur/super_admin (aligné sur la RLS du catalogue).
        if (method !== 'GET' && !['siege', 'directeur'].includes(callerRole)) {
          return { statusCode: 403, headers, body: JSON.stringify({ error: 'Modification du référentiel global non autorisée pour ce rôle' }) };
        }
      } else if (table === 'tenants') {
        if (!callerTenant) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Tenant appelant introuvable' }) };
        // Création/suppression d'un tenant réservées au super_admin
        if (method === 'POST' || method === 'DELETE') {
          return { statusCode: 403, headers, body: JSON.stringify({ error: 'Création/suppression de tenant réservée au super_admin' }) };
        }
        path = appendFilter(path, `id=eq.${callerTenant}`);
      } else if (TENANT_SCOPED_TABLES.includes(table)) {
        if (!callerTenant) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Tenant appelant introuvable' }) };
        if (method === 'POST') {
          // Une insertion ne peut être filtrée par query → on force tenant_id dans le corps
          bodyToSend = forceTenantOnBody(bodyToSend, callerTenant);
          // Empêche un non-super_admin de créer/élever un super_admin
          const rows = Array.isArray(bodyToSend) ? bodyToSend : [bodyToSend];
          if (table === 'profiles' && rows.some(o => o && o.role === 'super_admin')) {
            return { statusCode: 403, headers, body: JSON.stringify({ error: 'Attribution du rôle super_admin interdite' }) };
          }
        } else {
          // GET/PATCH/DELETE : injection du filtre tenant (PostgREST combine en ET)
          path = appendFilter(path, `tenant_id=eq.${callerTenant}`);
        }
        // Un PATCH ne doit pas réassigner le tenant via le corps
        if (method === 'PATCH' && bodyToSend && typeof bodyToSend === 'object' && 'tenant_id' in bodyToSend) {
          bodyToSend = { ...bodyToSend, tenant_id: callerTenant };
        }
      } else {
        // Refus par défaut : toute table non explicitement classée est inaccessible
        // à un non-super_admin (fail-closed → pas de fuite cross-tenant possible).
        return { statusCode: 403, headers, body: JSON.stringify({ error: `Table non autorisée pour ce rôle : ${table || '(inconnue)'}` }) };
      }
    } else if (path.startsWith('/auth/v1/admin/users')) {
      if (!callerTenant) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Tenant appelant introuvable' }) };
      const m = path.match(/\/auth\/v1\/admin\/users\/([^/?]+)/);
      if (method === 'DELETE' || method === 'PUT' || method === 'PATCH') {
        // Modification/suppression : le compte ciblé doit appartenir au tenant de l'appelant
        if (!m) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Identifiant de compte requis' }) };
        const targetTenant = await profileTenantOf(m[1]);
        if (targetTenant === undefined || targetTenant === null || targetTenant !== callerTenant) {
          return { statusCode: 403, headers, body: JSON.stringify({ error: 'Compte hors de votre périmètre' }) };
        }
      } else if (method === 'GET') {
        // Liste/recherche : on post-filtrera la réponse aux comptes du tenant
        scopeAuthUsersGet = true;
      }
      // POST (création) : autorisé ; le profil associé sera forcé au tenant (table profiles ci-dessus)
    }
  }

  // ── 7. Exécuter la requête Supabase avec service_role ─────
  try {
    // En-têtes : on n'autorise QUE des en-têtes sûrs côté client (jamais apikey/Authorization)
    const safeExtra = {};
    for (const k of Object.keys(extraHeaders || {})) {
      if (SAFE_HEADER_KEYS.includes(k.toLowerCase())) safeExtra[k] = extraHeaders[k];
    }
    const supaHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...safeExtra,
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
    };

    const opts = { method, headers: supaHeaders };
    if (bodyToSend && method !== 'GET') opts.body = JSON.stringify(bodyToSend);

    const supaRes = await fetch(`${SUPABASE_URL}${path}`, opts);

    // 204 No Content (PATCH/DELETE avec Prefer: return=minimal) → corps vide
    if (supaRes.status === 204) {
      return { statusCode: 200, headers, body: '[]' };
    }

    const ct = supaRes.headers.get('content-type') || '';
    let responseBody = ct.includes('json') ? await supaRes.json() : await supaRes.text();

    if (!supaRes.ok) {
      const errText = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
      return {
        statusCode: supaRes.status,
        headers,
        body: JSON.stringify({ error: `Supabase HTTP ${supaRes.status}`, detail: errText.slice(0, 300) })
      };
    }

    // Post-filtrage : un siège/directeur ne voit que les comptes de son tenant
    if (scopeAuthUsersGet && responseBody && typeof responseBody === 'object') {
      const users = Array.isArray(responseBody.users) ? responseBody.users
                  : (Array.isArray(responseBody) ? responseBody : null);
      if (users && users.length) {
        const ids = users.map(u => u && u.id).filter(Boolean);
        const allowed = new Set();
        if (ids.length) {
          try {
            const pr = await fetch(
              `${SUPABASE_URL}/rest/v1/profiles?id=in.(${ids.join(',')})&select=id&tenant_id=eq.${callerTenant}`,
              { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
            );
            if (pr.ok) (await pr.json()).forEach(p => allowed.add(p.id));
          } catch (e) { /* en cas d'échec : on ne révèle rien */ }
        }
        const filtered = users.filter(u => u && allowed.has(u.id));
        responseBody = Array.isArray(responseBody) ? filtered : { ...responseBody, users: filtered };
      }
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
