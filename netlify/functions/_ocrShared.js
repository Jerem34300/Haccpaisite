/**
 * Helpers partagés OCR (menu-ocr / label-ocr).
 * Pas de secret — clés uniquement via env Netlify.
 */
const MAX_IMAGE_CHARS = 2_500_000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function json(status, body) {
  return { statusCode: status, headers: CORS, body: JSON.stringify(body) };
}

function extractDataUrl(payload) {
  if (!payload || typeof payload !== 'object') return null;
  let raw = payload.image || payload.image_data_url || payload.dataUrl || '';
  if (typeof raw !== 'string') raw = '';
  raw = raw.trim();
  if (raw.startsWith('data:image/')) return raw;
  const b64 = (payload.imageBase64 || payload.base64 || '').trim();
  if (!b64) return null;
  const mime = String(payload.mimeType || payload.mime || 'image/jpeg').replace(/[^\w/+.-]/g, '') || 'image/jpeg';
  return 'data:' + mime + ';base64,' + b64.replace(/^data:[^;]+;base64,/, '');
}

function stripJsonFence(text) {
  let t = String(text || '').trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  return t;
}

/** Normalise une date lue (JJ/MM/AAAA, JJ-MM-AAAA, AAAA-MM-JJ…) → YYYY-MM-DD ou ''. */
function normalizeDateFr(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  let m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (m) {
    const d = m[1].padStart(2, '0');
    const mo = m[2].padStart(2, '0');
    return m[3] + '-' + mo + '-' + d;
  }
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2})$/);
  if (m) {
    const d = m[1].padStart(2, '0');
    const mo = m[2].padStart(2, '0');
    const yy = parseInt(m[3], 10);
    const yyyy = yy >= 70 ? 1900 + yy : 2000 + yy;
    return yyyy + '-' + mo + '-' + d;
  }
  return '';
}

function cleanStr(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 120);
}

module.exports = {
  MAX_IMAGE_CHARS,
  CORS,
  json,
  extractDataUrl,
  stripJsonFence,
  normalizeDateFr,
  cleanStr,
};
