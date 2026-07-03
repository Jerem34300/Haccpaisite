/**
 * verify-license.js — Vérification de clé de licence côté serveur
 *
 * Le secret LIC_SECRET ne doit jamais apparaître dans le code client.
 * Variable d'environnement Netlify : LIC_SECRET
 */

const LIC_SECRET = process.env.LIC_SECRET || 'RSTA2024HACCP_INTERNAL_V1_PMS';
const LIC_B32    = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function fnv32(s) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h ^ s.charCodeAt(i), 0x01000193)) >>> 0;
  return h;
}

function fromB32(s) {
  const bytes = []; let bits = 0, val = 0;
  for (const c of s.toUpperCase()) {
    const idx = LIC_B32.indexOf(c);
    if (idx < 0) continue;
    val = (val << 5) | idx; bits += 5;
    if (bits >= 8) { bytes.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(bytes);
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Méthode non autorisée' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch(e) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'JSON invalide' }) };
  }

  const { key } = payload;
  if (!key) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ valid: false, reason: 'Clé manquante' }) };
  }

  try {
    const clean = key.replace(/^RSTA[-\s]*/i, '').replace(/[^A-Z2-7]/gi, '').toUpperCase();
    if (clean.length < 24) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ valid: false, reason: 'Clé incomplète' }) };
    }
    const bytes = fromB32(clean.slice(0, 24));
    if (bytes.length < 15) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ valid: false, reason: 'Décodage échoué' }) };
    }
    const payStr = Array.from(bytes.slice(0, 10)).join(',');
    const h1 = fnv32(payStr + LIC_SECRET) >>> 0;
    const h2 = fnv32(LIC_SECRET + payStr) >>> 0;
    const sigOk = bytes[10] === ((h1 >> 24) & 0xFF) &&
                  bytes[11] === ((h1 >> 16) & 0xFF) &&
                  bytes[12] === ((h1 >>  8) & 0xFF) &&
                  bytes[13] === (h1 & 0xFF) &&
                  bytes[14] === ((h2 >> 24) & 0xFF);

    if (!sigOk) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ valid: false, reason: 'Signature invalide — clé incorrecte' }) };
    }

    const expCode = (bytes[0] << 8) | bytes[1];
    const year    = 2020 + Math.floor(expCode / 12);
    const month   = (expCode % 12) + 1;
    const seats   = bytes[2];
    const features = bytes[3];
    const siteHash = ((bytes[4] << 24) | (bytes[5] << 16) | (bytes[6] << 8) | bytes[7]) >>> 0;
    const uid      = ((bytes[8] << 8) | bytes[9]).toString(16).toUpperCase().padStart(4, '0');
    const expEnd   = new Date(year, month, 0);
    const now      = new Date();
    const expired  = now > expEnd;
    const daysLeft = Math.ceil((expEnd - now) / 86400000);

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        valid: true, expired, daysLeft,
        exp: `${year}-${String(month).padStart(2, '0')}`,
        expDisplay: `${String(month).padStart(2, '0')}/${year}`,
        seats, features, siteHash, uid
      })
    };
  } catch(e) {
    return { statusCode: 200, headers: cors, body: JSON.stringify({ valid: false, reason: 'Erreur de décodage' }) };
  }
};
