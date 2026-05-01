const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const ADMIN_ROLES = ['super_admin', 'siege', 'directeur', 'chef_secteur'];
const MAX_ALERT_HISTORY = 80;
const MAX_IMAGE_DATA_URL_LEN = 2_500_000;

const HUB_TYPES = {
  KNOWLEDGE_PROBLEM: 'hub_knowledge_problem',
  KNOWLEDGE_RECOMMENDATION: 'hub_knowledge_recommendation',
  ALERT: 'hub_alert',
  ACK: 'hub_alert_ack',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

function jsonResponse(statusCode, payload) {
  return new Response(JSON.stringify(payload), {
    status: statusCode,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function uid(prefix) {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeNCType(v) {
  const t = String(v || '').trim().toLowerCase();
  if (t === 'temperature' || t === 'hygiene' || t === 'storage' || t === 'autre') return t;
  return 'autre';
}

function normalizeSiteCodes(input) {
  if (!Array.isArray(input)) return [];
  const uniq = new Set(
    input
      .map((v) => String(v || '').trim().toUpperCase())
      .filter(Boolean)
  );
  return [...uniq].slice(0, 2000);
}

function sanitizeText(v, max = 500) {
  return String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function pickRandom(arr) {
  if (!Array.isArray(arr) || !arr.length) return '';
  const idx = Math.floor(Math.random() * arr.length);
  return String(arr[idx] || '');
}

function normalizePhotoPeriod(v) {
  const t = String(v || '').trim().toLowerCase();
  if (t === 'weekly' || t === 'monthly') return t;
  return 'weekly';
}

function normalizePhotoView(v) {
  const t = String(v || '').trim().toLowerCase();
  if (t === 'face' || t === 'detail') return t;
  return 'face';
}

function toIsoOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

async function supaReq({ token, method = 'GET', path, body = null, prefer = '', allow404 = false }) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('missing_env');

  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };

  if (body !== null) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;

  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    if (allow404 && res.status === 404) return null;
    const text = await res.text().catch(() => '');
    const err = new Error(text || `Supabase HTTP ${res.status}`);
    err.statusCode = res.status;
    throw err;
  }

  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return null;
  return await res.json();
}

async function getAuthContext(req) {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new Error('missing_token');

  const user = await supaReq({ token, path: '/auth/v1/user' });
  const userId = user?.id;
  if (!userId) throw new Error('invalid_token');

  const rows = await supaReq({
    token,
    path: `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,role,tenant_id,site_id,full_name&limit=1`,
  });
  const profile = rows?.[0] || null;
  if (!profile?.id) throw new Error('profile_missing');

  return { token, user, profile };
}

function ensureAdmin(profile) {
  if (!ADMIN_ROLES.includes(profile?.role || '')) {
    const err = new Error('forbidden');
    err.statusCode = 403;
    throw err;
  }
}

async function parseBody(req) {
  const raw = await req.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (_) {
    const err = new Error('bad_json');
    err.statusCode = 400;
    throw err;
  }
}

function normalizeAckResponse(v) {
  const t = String(v || '').trim().toLowerCase();
  if (t === 'removed' || t === 'not_in_stock' || t === 'ok' || t === 'other') return t;
  return 'ok';
}

function tenantFilter(tenantId) {
  return tenantId ? `tenant_id=eq.${encodeURIComponent(tenantId)}` : 'tenant_id=is.null';
}

function siteFilter(siteId) {
  return `site_id=eq.${encodeURIComponent(siteId)}`;
}

async function listHubRows(token, { type, tenantId, siteId = '', limit = 1000 }) {
  let q = `select=id,site_id,tenant_id,enr_type,client_id,recorded_at,data,created_at&enr_type=eq.${encodeURIComponent(type)}&${tenantFilter(tenantId)}&order=recorded_at.desc&limit=${Math.max(1, Math.min(limit, 5000))}`;
  if (siteId) q += `&${siteFilter(siteId)}`;
  const rows = await supaReq({ token, path: `/rest/v1/pms_records?${q}` });
  return Array.isArray(rows) ? rows : [];
}

async function insertHubRows(token, rows) {
  if (!rows.length) return [];
  const out = await supaReq({
    token,
    method: 'POST',
    path: '/rest/v1/pms_records?select=id,site_id,tenant_id,enr_type,client_id,recorded_at,data,created_at',
    body: rows,
    prefer: 'return=representation',
  });
  return Array.isArray(out) ? out : [];
}

async function patchHubRowByClientId(token, clientId, patchData) {
  const q = `client_id=eq.${encodeURIComponent(clientId)}&select=id,site_id,tenant_id,enr_type,client_id,recorded_at,data,created_at`;
  const out = await supaReq({
    token,
    method: 'PATCH',
    path: `/rest/v1/pms_records?${q}`,
    body: patchData,
    prefer: 'return=representation',
  });
  return Array.isArray(out) ? out : [];
}

async function deleteHubRowByClientId(token, type, clientId, tenantId) {
  const q = `enr_type=eq.${encodeURIComponent(type)}&client_id=eq.${encodeURIComponent(clientId)}&${tenantFilter(tenantId)}`;
  await supaReq({ token, method: 'DELETE', path: `/rest/v1/pms_records?${q}`, prefer: 'return=minimal' });
}

async function upsertAckRow(token, row) {
  try {
    await insertHubRows(token, [row]);
  } catch (e) {
    if (e.statusCode !== 409) throw e;
    await patchHubRowByClientId(token, row.client_id, {
      recorded_at: row.recorded_at,
      data: row.data,
      tenant_id: row.tenant_id,
      site_id: row.site_id,
    });
  }
}

function fromKnowledgeRows(problemRows, recommendationRows) {
  const problems = problemRows
    .map((r) => (r?.data && typeof r.data === 'object' ? r.data : null))
    .filter(Boolean)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  const recommendations = recommendationRows
    .map((r) => (r?.data && typeof r.data === 'object' ? r.data : null))
    .filter(Boolean)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  const updatedAt = [
    ...problems.map((v) => String(v.created_at || '')),
    ...recommendations.map((v) => String(v.created_at || '')),
  ]
    .filter(Boolean)
    .sort()
    .pop() || null;

  return { problems, recommendations, updated_at: updatedAt };
}

function mergeAlerts(rows) {
  const byId = new Map();

  for (const row of rows) {
    const data = row?.data && typeof row.data === 'object' ? row.data : null;
    if (!data) continue;
    const alertId = sanitizeText(data.id || '', 120);
    if (!alertId) continue;

    const dispatchSite = sanitizeText(row.site_id || data.dispatch_site_code || '', 60).toUpperCase();
    const fullSiteCodes = normalizeSiteCodes([...(Array.isArray(data.site_codes) ? data.site_codes : []), dispatchSite]);

    const existing = byId.get(alertId);
    if (!existing) {
      byId.set(alertId, {
        ...data,
        id: alertId,
        site_codes: fullSiteCodes,
        _client_ids: [String(row.client_id || '')],
      });
      continue;
    }

    const mergedSites = new Set([...(existing.site_codes || []), ...fullSiteCodes]);
    existing.site_codes = normalizeSiteCodes([...mergedSites]);
    existing._client_ids.push(String(row.client_id || ''));
    if (String(data.created_at || '') > String(existing.created_at || '')) {
      Object.assign(existing, { ...data, id: alertId, site_codes: existing.site_codes, _client_ids: existing._client_ids });
    }
  }

  return [...byId.values()]
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, MAX_ALERT_HISTORY);
}

function ackClientId(alertId, userId) {
  return `ack:${alertId}:${userId}`;
}

async function listAcksForTenant(token, tenantId) {
  const rows = await listHubRows(token, { type: HUB_TYPES.ACK, tenantId, limit: 5000 });
  const acks = rows
    .map((r) => (r?.data && typeof r.data === 'object' ? r.data : null))
    .filter(Boolean)
    .sort((a, b) => String(b.acknowledged_at || '').localeCompare(String(a.acknowledged_at || '')));
  return acks;
}

async function isAcked(token, tenantId, alertId, userId) {
  const cid = ackClientId(alertId, userId);
  const q = `select=client_id&enr_type=eq.${encodeURIComponent(HUB_TYPES.ACK)}&${tenantFilter(tenantId)}&client_id=eq.${encodeURIComponent(cid)}&limit=1`;
  const rows = await supaReq({ token, path: `/rest/v1/pms_records?${q}` });
  return Array.isArray(rows) && rows.length > 0;
}


async function uploadToStorage(token, { bucket, path, dataUrl }) {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return null;
  try {
    const [meta, b64] = dataUrl.split(',');
    const mimeMatch = meta.match(/data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const ext = mime === 'image/png' ? 'png' : 'jpg';
    const fullPath = `${path}.${ext}`;
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${fullPath}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': mime,
        'x-upsert': 'true',
      },
      body: bytes,
    });
    if (!res.ok) return null;
    return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${fullPath}`;
  } catch (_) { return null; }
}

export default async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse(200, { ok: true });

  let auth;
  try {
    auth = await getAuthContext(req);
  } catch (e) {
    const status = e.message === 'missing_env' ? 500 : 401;
    const message =
      e.message === 'missing_env'
        ? 'Configuration serveur manquante'
        : e.message === 'missing_token'
          ? 'Token manquant'
          : 'Authentification invalide';
    return jsonResponse(status, { error: message });
  }

  const { profile, token } = auth;
  const tenantId = profile.tenant_id || null;

  try {
    const url = new URL(req.url);
    const query = Object.fromEntries(url.searchParams.entries());
    const method = req.method;

    if (method === 'GET') {
      const op = String(query.op || '').trim();

      if (op === 'knowledge') {
        const [problemRows, recommendationRows] = await Promise.all([
          listHubRows(token, { type: HUB_TYPES.KNOWLEDGE_PROBLEM, tenantId, limit: 1200 }),
          listHubRows(token, { type: HUB_TYPES.KNOWLEDGE_RECOMMENDATION, tenantId, limit: 3200 }),
        ]);
        return jsonResponse(200, fromKnowledgeRows(problemRows, recommendationRows));
      }

      if (op === 'alerts_admin') {
        ensureAdmin(profile);
        const alertRows = await listHubRows(token, { type: HUB_TYPES.ALERT, tenantId, limit: 4000 });
        const alerts = mergeAlerts(alertRows);
        const acks = await listAcksForTenant(token, tenantId);
        const byAlertId = new Map();
        for (const ack of acks) {
          const aId = sanitizeText(ack.alert_id || '', 120);
          if (!aId) continue;
          if (!byAlertId.has(aId)) byAlertId.set(aId, []);
          byAlertId.get(aId).push(ack);
        }
        const enriched = alerts.map((alert) => ({ ...alert, acks: byAlertId.get(alert.id) || [] }));
        return jsonResponse(200, { alerts: enriched });
      }

      if (op === 'alerts_tablet') {
        const siteCode = sanitizeText(query.site_code || '', 60).toUpperCase();
        if (!siteCode) return jsonResponse(400, { error: 'site_code requis' });

        const rows = await listHubRows(token, { type: HUB_TYPES.ALERT, tenantId, siteId: siteCode, limit: 500 });
        const alerts = mergeAlerts(rows);

        const now = Date.now();
        const visible = [];
        for (const alert of alerts) {
          if (alert.closed_at) continue;
          const target = normalizeSiteCodes(alert.site_codes || []);
          if (target.length && !target.includes(siteCode)) continue;
          if (alert.expires_at && Date.parse(alert.expires_at) < now) continue;
          const acked = await isAcked(token, tenantId, alert.id, profile.id);
          visible.push({ ...alert, acked });
        }
        return jsonResponse(200, { alerts: visible.slice(0, 30) });
      }

      return jsonResponse(400, { error: 'op inconnue' });
    }

    if (method === 'DELETE') {
      ensureAdmin(profile);
      const op = String(query.op || '').trim();
      if (op !== 'knowledge_delete') return jsonResponse(400, { error: 'op inconnue' });

      const id = sanitizeText(query.id || '', 120);
      const kind = sanitizeText(query.kind || '', 30);
      if (!id || !kind) return jsonResponse(400, { error: 'id/kind requis' });

      let type = '';
      if (kind === 'problem') type = HUB_TYPES.KNOWLEDGE_PROBLEM;
      if (kind === 'recommendation') type = HUB_TYPES.KNOWLEDGE_RECOMMENDATION;
      if (!type) return jsonResponse(400, { error: 'kind invalide' });

      await deleteHubRowByClientId(token, type, id, tenantId);

      const [problemRows, recommendationRows] = await Promise.all([
        listHubRows(token, { type: HUB_TYPES.KNOWLEDGE_PROBLEM, tenantId, limit: 1200 }),
        listHubRows(token, { type: HUB_TYPES.KNOWLEDGE_RECOMMENDATION, tenantId, limit: 3200 }),
      ]);
      return jsonResponse(200, fromKnowledgeRows(problemRows, recommendationRows));
    }

    if (method === 'POST') {
      const body = await parseBody(req);
      const op = String(body.op || '').trim();

      if (op === 'knowledge_add_problem') {
        ensureAdmin(profile);
        const problem = sanitizeText(body.problem, 500);
        if (!problem) return jsonResponse(400, { error: 'problem requis' });

        const item = {
          id: uid('problem'),
          problem,
          nc_type: normalizeNCType(body.nc_type),
          created_at: nowIso(),
          created_by: profile.id,
          created_by_name: sanitizeText(profile.full_name || '', 120),
          source_site_code: sanitizeText(body.source_site_code || '', 60).toUpperCase(),
        };

        await insertHubRows(token, [
          {
            site_id: 'HUB',
            tenant_id: tenantId,
            enr_type: HUB_TYPES.KNOWLEDGE_PROBLEM,
            client_id: item.id,
            recorded_at: item.created_at,
            data: item,
          },
        ]);

        const [problemRows, recommendationRows] = await Promise.all([
          listHubRows(token, { type: HUB_TYPES.KNOWLEDGE_PROBLEM, tenantId, limit: 1200 }),
          listHubRows(token, { type: HUB_TYPES.KNOWLEDGE_RECOMMENDATION, tenantId, limit: 3200 }),
        ]);
        return jsonResponse(200, { ok: true, item, knowledge: fromKnowledgeRows(problemRows, recommendationRows) });
      }

      if (op === 'knowledge_add_recommendation') {
        ensureAdmin(profile);
        const problem = sanitizeText(body.problem, 500);
        const action = sanitizeText(body.action, 500);
        if (!problem || !action) return jsonResponse(400, { error: 'problem et action requis' });

        const item = {
          id: uid('reco'),
          problem,
          action,
          nc_type: normalizeNCType(body.nc_type),
          created_at: nowIso(),
          created_by: profile.id,
          created_by_name: sanitizeText(profile.full_name || '', 120),
          source_site_code: sanitizeText(body.source_site_code || '', 60).toUpperCase(),
          uses: 0,
        };

        await insertHubRows(token, [
          {
            site_id: 'HUB',
            tenant_id: tenantId,
            enr_type: HUB_TYPES.KNOWLEDGE_RECOMMENDATION,
            client_id: item.id,
            recorded_at: item.created_at,
            data: item,
          },
        ]);

        const [problemRows, recommendationRows] = await Promise.all([
          listHubRows(token, { type: HUB_TYPES.KNOWLEDGE_PROBLEM, tenantId, limit: 1200 }),
          listHubRows(token, { type: HUB_TYPES.KNOWLEDGE_RECOMMENDATION, tenantId, limit: 3200 }),
        ]);
        return jsonResponse(200, { ok: true, item, knowledge: fromKnowledgeRows(problemRows, recommendationRows) });
      }

      if (op === 'alerts_send') {
        ensureAdmin(profile);
        const siteCodes = normalizeSiteCodes(body.site_codes);
        if (!siteCodes.length) return jsonResponse(400, { error: 'Aucun site cible' });

        const title = sanitizeText(body.title || 'Alerte retrait de lot', 160);
        const message = sanitizeText(body.message, 2500);
        if (!message) return jsonResponse(400, { error: 'Message requis' });

        const imageDataUrl = String(body.image_data_url || '');
        if (imageDataUrl && (!imageDataUrl.startsWith('data:image/') || imageDataUrl.length > MAX_IMAGE_DATA_URL_LEN)) {
          return jsonResponse(400, { error: 'Image invalide ou trop volumineuse' });
        }

        const alertId = uid('alert');

        // Upload image vers Storage au lieu de stocker le base64 en DB
        let imageUrl = '';
        if (imageDataUrl) {
          const uploaded = await uploadToStorage(token, {
            bucket: 'pms-photos',
            path: `alerts/${tenantId}/${alertId}`,
            dataUrl: imageDataUrl,
          });
          imageUrl = uploaded || '';
          // Si l'upload échoue, on continue sans image plutôt que de bloquer l'alerte
        }

        const alert = {
          id: alertId,
          tenant_id: tenantId,
          title,
          message,
          product_name: sanitizeText(body.product_name || '', 180),
          lot_number: sanitizeText(body.lot_number || '', 120),
          product_dlc: sanitizeText(body.product_dlc || '', 40),
          image_url: imageUrl,
          site_codes: siteCodes,
          created_at: nowIso(),
          created_by: profile.id,
          created_by_name: sanitizeText(profile.full_name || '', 120),
          expires_at: body.expires_at ? new Date(body.expires_at).toISOString() : null,
          severity: sanitizeText(body.severity || 'critical', 20),
          kind: 'product_recall',
          closed_at: null,
          closed_by: null,
          closed_by_name: '',
        };

        const rows = siteCodes.map((siteCode) => ({
          site_id: siteCode,
          tenant_id: tenantId,
          enr_type: HUB_TYPES.ALERT,
          client_id: `${alert.id}:${siteCode}`,
          recorded_at: alert.created_at,
          data: { ...alert, dispatch_site_code: siteCode },
        }));
        await insertHubRows(token, rows);
        return jsonResponse(200, { ok: true, alert });
      }

      if (op === 'photo_request_send') {
        ensureAdmin(profile);
        const siteCodes = normalizeSiteCodes(body.site_codes);
        if (!siteCodes.length) return jsonResponse(400, { error: 'Aucun site cible' });

        const requestMode = String(body.request_mode || '').trim().toLowerCase() === 'random' ? 'random' : 'manual';
        const normalizedZones = Array.isArray(body.available_zones)
          ? body.available_zones.map((z) => sanitizeText(z, 180)).filter(Boolean).slice(0, 500)
          : [];
        const requestedZoneManual = sanitizeText(body.zone || '', 180);
        const requestedZone = requestMode === 'random'
          ? pickRandom(normalizedZones) || requestedZoneManual
          : requestedZoneManual || pickRandom(normalizedZones);
        if (!requestedZone) return jsonResponse(400, { error: 'Zone requise' });

        const periodMode = normalizePhotoPeriod(body.period_mode);
        const shotView = normalizePhotoView(body.shot_view);
        const dueAt = toIsoOrNull(body.due_at);

        const defaultTitle = `Demande photo hygiène — ${requestedZone}`;
        const defaultMessage = `Merci de prendre une photo ${shotView === 'face' ? 'de face' : 'détail'} de la zone "${requestedZone}" pour le suivi ${periodMode === 'monthly' ? 'mensuel' : 'hebdomadaire'} de propreté.`;
        const title = sanitizeText(body.title || defaultTitle, 180) || defaultTitle;
        const message = sanitizeText(body.message || defaultMessage, 2500) || defaultMessage;

        const photoReqAlertId = uid('alert');
        const alert = {
          id: photoReqAlertId,
          tenant_id: tenantId,
          title,
          message,
          site_codes: siteCodes,
          created_at: nowIso(),
          created_by: profile.id,
          created_by_name: sanitizeText(profile.full_name || '', 120),
          expires_at: toIsoOrNull(body.expires_at),
          severity: sanitizeText(body.severity || 'info', 20),
          kind: 'photo_request',
          closed_at: null,
          closed_by: null,
          closed_by_name: '',
          request_mode: requestMode,
          requested_zone: requestedZone,
          available_zones: normalizedZones,
          period_mode: periodMode,
          shot_view: shotView,
          due_at: dueAt,
        };

        const rows = siteCodes.map((siteCode) => ({
          site_id: siteCode,
          tenant_id: tenantId,
          enr_type: HUB_TYPES.ALERT,
          client_id: `${alert.id}:${siteCode}`,
          recorded_at: alert.created_at,
          data: { ...alert, dispatch_site_code: siteCode },
        }));
        await insertHubRows(token, rows);
        return jsonResponse(200, { ok: true, alert });
      }

      if (op === 'alerts_close') {
        ensureAdmin(profile);
        const alertId = sanitizeText(body.alert_id, 120);
        if (!alertId) return jsonResponse(400, { error: 'alert_id requis' });

        const alertRows = await listHubRows(token, { type: HUB_TYPES.ALERT, tenantId, limit: 4000 });
        const toClose = alertRows.filter((r) => sanitizeText(r?.data?.id || '', 120) === alertId);
        if (!toClose.length) return jsonResponse(404, { error: 'Alerte introuvable' });

        const closedAt = nowIso();
        const closedByName = sanitizeText(profile.full_name || '', 120);

        for (const row of toClose) {
          const current = row?.data && typeof row.data === 'object' ? row.data : {};
          const nextData = {
            ...current,
            closed_at: closedAt,
            closed_by: profile.id,
            closed_by_name: closedByName,
          };
          await patchHubRowByClientId(token, String(row.client_id || ''), { data: nextData });
        }

        const alert = {
          ...(toClose[0]?.data || {}),
          closed_at: closedAt,
          closed_by: profile.id,
          closed_by_name: closedByName,
        };
        return jsonResponse(200, { ok: true, alert });
      }

      if (op === 'alerts_ack') {
        const alertId = sanitizeText(body.alert_id, 120);
        if (!alertId) return jsonResponse(400, { error: 'alert_id requis' });

        const siteCode = sanitizeText(body.site_code || '', 60).toUpperCase();
        if (!siteCode) return jsonResponse(400, { error: 'site_code requis' });

        const siteAlertRows = await listHubRows(token, { type: HUB_TYPES.ALERT, tenantId, siteId: siteCode, limit: 500 });
        const alerts = mergeAlerts(siteAlertRows);
        const alert = alerts.find((a) => String(a.id || '') === alertId) || null;
        if (!alert) return jsonResponse(404, { error: 'Alerte introuvable' });

        const targets = normalizeSiteCodes(alert.site_codes || []);
        if (targets.length && !targets.includes(siteCode)) {
          return jsonResponse(403, { error: 'Site non concerné par cette alerte' });
        }

        const photoDataUrl = String(body.photo_data_url || '');
        if (photoDataUrl && (!photoDataUrl.startsWith('data:image/') || photoDataUrl.length > MAX_IMAGE_DATA_URL_LEN)) {
          return jsonResponse(400, { error: 'Photo invalide ou trop volumineuse' });
        }

        const ackId = ackClientId(alertId, profile.id);

        // Upload photo vers Storage au lieu de stocker le base64 en DB
        let photoUrl = '';
        if (photoDataUrl) {
          const uploaded = await uploadToStorage(token, {
            bucket: 'pms-photos',
            path: `acks/${tenantId}/${siteCode}/${ackId.replace(/:/g, '_')}`,
            dataUrl: photoDataUrl,
          });
          photoUrl = uploaded || '';
        }

        const ack = {
          alert_id: alertId,
          user_id: profile.id,
          user_name: sanitizeText(profile.full_name || '', 120),
          site_code: siteCode,
          acknowledged_at: nowIso(),
          response: normalizeAckResponse(body.response),
          note: sanitizeText(body.note || '', 500),
          zone: sanitizeText(body.zone || alert.requested_zone || '', 180),
          period_mode: normalizePhotoPeriod(body.period_mode || alert.period_mode || 'weekly'),
          shot_view: normalizePhotoView(body.shot_view || alert.shot_view || 'face'),
          photo_url: photoUrl,
        };

        await upsertAckRow(token, {
          site_id: siteCode,
          tenant_id: tenantId,
          enr_type: HUB_TYPES.ACK,
          client_id: ackClientId(alertId, profile.id),
          recorded_at: ack.acknowledged_at,
          data: ack,
        });

        return jsonResponse(200, { ok: true, ack });
      }

      return jsonResponse(400, { error: 'op inconnue' });
    }

    return jsonResponse(405, { error: 'Méthode non autorisée' });
  } catch (e) {
    const statusCode = e.statusCode || 500;
    const message = statusCode === 403 ? 'Accès refusé' : e.message || 'Erreur serveur';
    return jsonResponse(statusCode, { error: message });
  }
};

export const config = {
  path: '/.netlify/functions/haccp-hub',
};
