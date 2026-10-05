/**
 * menu-ocr.js — Netlify Function : OCR photo menu (jour ou trame semaine)
 *
 * POST body JSON: { image: "data:image/jpeg;base64,..." } ou { imageBase64, mimeType }
 * Réponse: { type: 'jour'|'semaine', days: [{ date, services: { midi:[], gouter:[], soir:[] } }] }
 *
 * Env: OPENAI_API_KEY (déjà utilisée par haccp.js / éventuel hub IA).
 * Aucune clé inventée — si absente, 503 + message clair.
 */
const MAX_IMAGE_CHARS = 2_500_000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const SYSTEM_PROMPT = `Tu es un OCR spécialisé menus de restauration collective française.
Tu analyses une PHOTO de menu imprimé et tu renvoies UNIQUEMENT un JSON valide (pas de markdown).

Schéma strict:
{
  "type": "jour" | "semaine",
  "days": [
    {
      "date": "YYYY-MM-DD",
      "services": {
        "midi": ["plat1", "plat2"],
        "gouter": ["..."],
        "soir": ["..."]
      }
    }
  ]
}

Règles de mapping:
1) Menu du jour (une seule date, bannières Déjeuner / Dîner):
   - Déjeuner → services.midi
   - Dîner → services.soir
   - gouter vide sauf si mentionné explicitement
2) Trame semaine (colonnes par jour, lignes séparées par des pointillés):
   - Au-dessus des pointillés → midi
   - ENTRE les deux lignes de pointillés → gouter
   - En dessous des pointillés → soir
3) IGNORE absolument: coches manuscrites, croix, ratures, griffonnages, annotations à la main.
4) Ne garde que le texte imprimé des plats. Pas de titres de section (Déjeuner, Dîner, Midi…).
5) dates au format ISO YYYY-MM-DD. Si l'année manque, déduire depuis le contexte visible.
6) Si un service est vide, renvoyer [].
7) Pas de doublons inutiles. Noms de plats nettoyés (trim).`;

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

function normalizeOcrResult(raw) {
  const out = { type: 'jour', days: [] };
  if (!raw || typeof raw !== 'object') return out;
  out.type = raw.type === 'semaine' ? 'semaine' : 'jour';
  const days = Array.isArray(raw.days) ? raw.days : [];
  out.days = days.map(function (d) {
    const services = (d && d.services) || {};
    function list(v) {
      if (!Array.isArray(v)) return [];
      return v
        .map(function (x) { return String(x || '').replace(/\s+/g, ' ').trim(); })
        .filter(Boolean)
        .slice(0, 40);
    }
    return {
      date: String((d && d.date) || '').slice(0, 10),
      services: {
        midi: list(services.midi),
        gouter: list(services.gouter || services.goûter),
        soir: list(services.soir),
      },
    };
  }).filter(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d.date); });
  return out;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY || process.env.MENU_OCR_API_KEY || '';
  if (!apiKey) {
    return json(503, {
      error: 'OPENAI_API_KEY manquante',
      hint: 'Définir OPENAI_API_KEY (ou MENU_OCR_API_KEY) dans les variables d\'environnement Netlify. Clé déjà référencée dans haccp.js — ne pas committer de secret.',
      stub: true,
      example: {
        type: 'jour',
        days: [{
          date: '2026-10-05',
          services: {
            midi: ['Céleri vinaigrette', 'Jambon braisé'],
            gouter: [],
            soir: ['Potage au chou vert'],
          },
        }],
      },
    });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'JSON invalide' });
  }

  const dataUrl = extractDataUrl(payload);
  if (!dataUrl || !dataUrl.startsWith('data:image/')) {
    return json(400, { error: 'Image manquante (image data URL ou imageBase64 requis)' });
  }
  if (dataUrl.length > MAX_IMAGE_CHARS) {
    return json(413, { error: 'Image trop volumineuse (max ~2 Mo encodés)' });
  }

  const userText = String(payload.hint || payload.prompt || '').trim().slice(0, 500)
    || 'Extrais le menu de cette photo selon les règles système. JSON uniquement.';

  const body = {
    model: process.env.MENU_OCR_MODEL || 'gpt-4o',
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: userText },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
        ],
      },
    ],
  };

  let resp;
  try {
    resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return json(502, { error: 'Appel OpenAI échoué', detail: String(e && e.message || e) });
  }

  let data;
  try {
    data = await resp.json();
  } catch (e) {
    return json(502, { error: 'Réponse OpenAI illisible' });
  }

  if (!resp.ok) {
    const msg = (data && data.error && data.error.message) || ('HTTP ' + resp.status);
    return json(resp.status === 401 ? 502 : 502, {
      error: 'OCR fournisseur en erreur',
      detail: msg,
    });
  }

  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '';
  let parsed;
  try {
    parsed = JSON.parse(stripJsonFence(content));
  } catch (e) {
    return json(502, { error: 'JSON OCR invalide', raw: String(content).slice(0, 800) });
  }

  const result = normalizeOcrResult(parsed);
  if (!result.days.length) {
    return json(422, { error: 'Aucun jour détecté', result: result });
  }
  return json(200, result);
};
