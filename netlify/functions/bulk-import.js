/**
 * bulk-import.js — Import en masse de sites/secteurs/territoires + cuisiniers
 *
 * Appelée depuis superadmin.html après parsing côté client d'un fichier Excel.
 * Requiert le rôle super_admin (JWT vérifié).
 *
 * Body : { tenantId, rows: [{territoire, secteur, siteNom, siteCode, email, nomCuisinier}] }
 * Réponse : { created, credentials, errors }
 */

const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_ANON  = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_KEY;

const svcH = {
  'Content-Type': 'application/json',
  'Accept':       'application/json',
  'apikey':       SERVICE_KEY || '',
  'Authorization': `Bearer ${SERVICE_KEY || ''}`,
};

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function slug(s, suffix = '') {
  const base = String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  return suffix ? base + '-' + suffix : base;
}

function randPass(code) {
  const r = Math.random().toString(36).slice(2, 8);
  return (code || 'site').toLowerCase().replace(/[^a-z0-9]/g, '') + '-' + r;
}

async function supa(method, path, body) {
  const opts = { method, headers: svcH };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${SUPABASE_URL}${path}`, opts);
  if (r.status === 204) return null;
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

async function findOrCreate(table, matchField, matchVal, insertData) {
  const existing = await supa('GET', `/rest/v1/${table}?${matchField}=eq.${encodeURIComponent(matchVal)}&limit=1`);
  if (Array.isArray(existing) && existing[0]) return existing[0];
  const created = await supa('POST', `/rest/v1/${table}`, insertData);
  return Array.isArray(created) ? created[0] : created;
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Méthode non autorisée' }) };
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Configuration serveur manquante' }) };
  }

  // ── 1. Vérifier le JWT ────────────────────────────────────
  const auth = (event.headers['authorization'] || event.headers['Authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  if (!auth) return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Token manquant' }) };

  let userId;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${auth}` }
    });
    if (!r.ok) throw new Error('Token invalide');
    const u = await r.json();
    userId = u.id;
  } catch(e) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Token invalide ou expiré' }) };
  }

  // ── 2. Vérifier que l'appelant est super_admin ────────────
  try {
    const profiles = await supa('GET', `/rest/v1/profiles?id=eq.${userId}&select=role&limit=1`);
    const role = profiles?.[0]?.role || '';
    if (role !== 'super_admin') {
      return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'Réservé au super_admin' }) };
    }
  } catch(e) {
    return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'Vérification rôle échouée' }) };
  }

  // ── 3. Parser le payload ──────────────────────────────────
  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch(e) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'JSON invalide' }) };
  }

  const { tenantId, rows } = payload;
  if (!tenantId || !Array.isArray(rows) || rows.length === 0) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'tenantId et rows requis' }) };
  }
  if (rows.length > 1000) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Maximum 1000 lignes par import' }) };
  }

  // ── 4. Import ─────────────────────────────────────────────
  const stats   = { territories: 0, sectors: 0, sites: 0, users: 0 };
  const errors  = [];
  const credentials = [];

  // Cache pour éviter les doublons d'appels
  const terCache  = {};  // nom → {id}
  const secCache  = {};  // "nom|terId" → {id}
  const siteCache = {};  // code → true

  // Charger les données existantes pour ce tenant
  try {
    const [existTer, existSec, existSites] = await Promise.all([
      supa('GET', `/rest/v1/territories?tenant_id=eq.${tenantId}&select=id,name`),
      supa('GET', `/rest/v1/sectors?tenant_id=eq.${tenantId}&select=id,name,territory_id`),
      supa('GET', `/rest/v1/sites?tenant_id=eq.${tenantId}&select=id,code`),
    ]);
    (existTer  || []).forEach(t  => { terCache[t.name.toLowerCase()]                  = t; });
    (existSec  || []).forEach(s  => { secCache[s.name.toLowerCase()+'|'+s.territory_id] = s; });
    (existSites|| []).forEach(s  => { siteCache[s.code.toLowerCase()]                 = s.id; });
  } catch(e) {
    console.warn('[bulk-import] prefetch:', e.message);
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // +2 car ligne 1 = en-têtes Excel
    try {
      const terNom  = String(row.territoire  || '').trim();
      const secNom  = String(row.secteur     || '').trim();
      const siteNom = String(row.siteNom     || '').trim();
      const siteCode= String(row.siteCode    || '').trim().toUpperCase() || slug(siteNom, String(i)).toUpperCase().slice(0,10);
      const email   = String(row.email       || '').trim().toLowerCase();
      const nomCuis = String(row.nomCuisinier|| '').trim();

      if (!siteNom) { errors.push(`Ligne ${rowNum} : nom de site manquant`); continue; }

      // ── Territoire ──
      let terId = null;
      if (terNom) {
        const key = terNom.toLowerCase();
        if (terCache[key]) {
          terId = terCache[key].id;
        } else {
          const t = await supa('POST', '/rest/v1/territories',
            { tenant_id: tenantId, name: terNom, code: slug(terNom).toUpperCase().slice(0,10) }
          );
          const created = Array.isArray(t) ? t[0] : t;
          terCache[key] = created;
          terId = created?.id;
          stats.territories++;
        }
      }

      // ── Secteur ──
      let secId = null;
      if (secNom) {
        const key = secNom.toLowerCase() + '|' + (terId || '');
        if (secCache[key]) {
          secId = secCache[key].id;
        } else {
          const s = await supa('POST', '/rest/v1/sectors',
            { tenant_id: tenantId, name: secNom, code: slug(secNom).toUpperCase().slice(0,10), territory_id: terId || null }
          );
          const created = Array.isArray(s) ? s[0] : s;
          secCache[key] = created;
          secId = created?.id;
          stats.sectors++;
        }
      }

      // ── Site ──
      let siteId = siteCache[siteCode.toLowerCase()];
      if (!siteId) {
        const site = await supa('POST', '/rest/v1/sites',
          { tenant_id: tenantId, name: siteNom, code: siteCode, sector_id: secId || null }
        );
        const created = Array.isArray(site) ? site[0] : site;
        siteId = created?.id;
        siteCache[siteCode.toLowerCase()] = siteId;
        stats.sites++;
      }

      // ── Cuisinier ──
      if (email && siteId) {
        const pass = randPass(siteCode);
        let uid = null;

        // Vérifier si le compte existe
        try {
          const existing = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, { headers: svcH });
          if (existing.ok) {
            const eu = await existing.json();
            uid = (eu.users || eu)?.[0]?.id || null;
          }
        } catch(e) { /* ignore */ }

        if (!uid) {
          // Créer le compte auth
          const authR = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
            method: 'POST', headers: svcH,
            body: JSON.stringify({ email, password: pass, email_confirm: true })
          });
          if (authR.ok) {
            const authData = await authR.json();
            uid = authData.id;
            stats.users++;
            credentials.push({ siteCode, siteNom, email, password: pass, nomCuisinier: nomCuis });
          } else {
            const err = await authR.text();
            errors.push(`Ligne ${rowNum} : compte cuisinier (${email}) : ${err.slice(0,120)}`);
          }
        } else {
          credentials.push({ siteCode, siteNom, email, password: '(compte existant)', nomCuisinier: nomCuis });
        }

        // Créer/mettre à jour le profil cuisinier
        if (uid) {
          await supa('POST', '/rest/v1/profiles', {
            id: uid, tenant_id: tenantId, site_id: siteId, role: 'cuisinier', full_name: nomCuis || email
          }).catch(e => {
            // Si déjà existant, mettre à jour le site
            return supa('PATCH', `/rest/v1/profiles?id=eq.${uid}`, { site_id: siteId, tenant_id: tenantId });
          });
        }
      }

    } catch(e) {
      errors.push(`Ligne ${rowNum} : ${e.message.slice(0,150)}`);
    }
  }

  return {
    statusCode: 200,
    headers: cors,
    body: JSON.stringify({ created: stats, credentials, errors })
  };
};
