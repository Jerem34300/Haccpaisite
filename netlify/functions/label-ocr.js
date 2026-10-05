/**
 * label-ocr.js — Netlify Function : OCR étiquette produit / bon de livraison (BL)
 *
 * POST body JSON:
 *   { image: "data:image/jpeg;base64,...", mode: "label" | "bl" }
 *
 * Réponses:
 *   mode=label → { mode:"label", produit, lot, dlc, estampille }
 *   mode=bl    → { mode:"bl", lines: [{ produit, lot, dlc, estampille }, ...] }
 *
 * Env: OPENAI_API_KEY | MENU_OCR_API_KEY (même clé que menu-ocr).
 * Stub clair si clé absente — aucun secret inventé.
 */
const {
  MAX_IMAGE_CHARS,
  CORS,
  json,
  extractDataUrl,
  stripJsonFence,
  normalizeDateFr,
  cleanStr,
} = require('./_ocrShared');

const SYSTEM_LABEL = `Tu es un OCR spécialisé étiquettes alimentaires HACCP (France).
Tu analyses une PHOTO d'étiquette produit (1 seul produit) et tu renvoies UNIQUEMENT un JSON valide (pas de markdown).

Schéma strict:
{
  "produit": "nom du produit tel qu'imprimé",
  "lot": "numéro de lot (L..., LOT..., etc.)",
  "dlc": "YYYY-MM-DD ou JJ/MM/AAAA si c'est ce qui est visible",
  "estampille": "estampille sanitaire type FR XX XXX XXX CE si visible, sinon chaîne vide"
}

Règles:
1) Un seul produit. Ne jamais inventer lot ni DLC — si illisible, chaîne vide.
2) DLC / DDM / DLUO → champ "dlc" uniquement (pas de champ séparé).
3) Ignore annotations manuscrites, ratures, stickers prix hors étiquette.
4) Estampille : ovale sanitaire FR…CE si présent, sinon "".
5) Noms nettoyés (trim). Pas de texte inventé.`;

const SYSTEM_BL = `Tu es un OCR spécialisé bons de livraison (BL) restauration collective France.
Tu analyses une PHOTO de BL / bon de livraison et tu renvoies UNIQUEMENT un JSON valide (pas de markdown).

Schéma strict:
{
  "lines": [
    {
      "produit": "désignation ligne",
      "lot": "n° lot si présent",
      "dlc": "date DLC/DDM si présente (YYYY-MM-DD ou JJ/MM/AAAA)",
      "estampille": "estampille si présente sinon \"\""
    }
  ]
}

Règles:
1) Une entrée par ligne produit du BL. Max 40 lignes.
2) Ne jamais inventer lot ni DLC — vide si absent / illisible.
3) Ignore en-tête fournisseur, totaux, signatures, annotations manuscrites.
4) Pas de collage multi-produits dans un seul objet : une ligne = un produit.`;

function normalizeLabel(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    mode: 'label',
    produit: cleanStr(o.produit || o.product || o.nom, 80),
    lot: cleanStr(o.lot || o.lot_number || o.batch, 60),
    dlc: normalizeDateFr(o.dlc || o.dluo || o.ddm || o.expiry || '') || cleanStr(o.dlc || '', 16),
    estampille: cleanStr(o.estampille || o.estampille_sanitaire || o.mark, 40),
  };
}

function normalizeBl(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  let lines = Array.isArray(o.lines) ? o.lines : (Array.isArray(o.lignes) ? o.lignes : []);
  if (!lines.length && (o.produit || o.product)) lines = [o];
  const out = lines.map(function (row) {
    const r = row && typeof row === 'object' ? row : {};
    return {
      produit: cleanStr(r.produit || r.product || r.nom || r.designation, 80),
      lot: cleanStr(r.lot || r.lot_number || r.batch, 60),
      dlc: normalizeDateFr(r.dlc || r.dluo || r.ddm || r.expiry || '') || cleanStr(r.dlc || '', 16),
      estampille: cleanStr(r.estampille || r.estampille_sanitaire || r.mark, 40),
    };
  }).filter(function (r) {
    return !!(r.produit || r.lot || r.dlc || r.estampille);
  }).slice(0, 40);
  return { mode: 'bl', lines: out };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY || process.env.MENU_OCR_API_KEY || '';

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'JSON invalide' });
  }

  const mode = String(payload.mode || 'label').toLowerCase() === 'bl' ? 'bl' : 'label';

  if (!apiKey) {
    return json(503, {
      error: 'OPENAI_API_KEY manquante',
      hint: 'Définir OPENAI_API_KEY (ou MENU_OCR_API_KEY) dans les variables d\'environnement Netlify.',
      stub: true,
      mode: mode,
      example: mode === 'bl'
        ? {
            mode: 'bl',
            lines: [
              { produit: 'Saumon fumé', lot: 'L240915A', dlc: '2026-10-20', estampille: '' },
              { produit: 'Beurre doux', lot: 'B77821', dlc: '2026-11-02', estampille: '' },
            ],
          }
        : {
            mode: 'label',
            produit: 'Saumon fumé',
            lot: 'L240915A',
            dlc: '2026-10-20',
            estampille: 'FR 29 232 001 CE',
          },
    });
  }

  const dataUrl = extractDataUrl(payload);
  if (!dataUrl || !dataUrl.startsWith('data:image/')) {
    return json(400, { error: 'Image manquante (image data URL ou imageBase64 requis)' });
  }
  if (dataUrl.length > MAX_IMAGE_CHARS) {
    return json(413, { error: 'Image trop volumineuse (max ~2 Mo encodés)' });
  }

  const system = mode === 'bl' ? SYSTEM_BL : SYSTEM_LABEL;
  const userText = String(payload.hint || payload.prompt || '').trim().slice(0, 500)
    || (mode === 'bl'
      ? 'Extrais les lignes produits de ce bon de livraison. JSON uniquement.'
      : 'Extrais produit, lot, DLC/DDM et estampille de cette étiquette. JSON uniquement.');

  const body = {
    model: process.env.LABEL_OCR_MODEL || process.env.MENU_OCR_MODEL || 'gpt-4o',
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
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
    return json(502, { error: 'OCR fournisseur en erreur', detail: msg });
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

  if (mode === 'bl') {
    const result = normalizeBl(parsed);
    if (!result.lines.length) {
      return json(422, { error: 'Aucune ligne produit détectée sur le BL', result: result });
    }
    return json(200, result);
  }

  const result = normalizeLabel(parsed);
  if (!result.produit && !result.lot && !result.dlc && !result.estampille) {
    return json(422, { error: 'Aucun champ lisible sur l\'étiquette', result: result });
  }
  return json(200, result);
};
