/**
 * bl-ocr.js — Netlify Function : lecture d'un bon de livraison (BL) multi-pages.
 *
 * POST body JSON:
 *   { images: ["data:image/jpeg;base64,...", ...] }   (1 à 6 pages, DANS L'ORDRE)
 *   ou { image: "data:image/..." } (1 page)
 *
 * Réponse 200:
 *   { mode:"bl", fournisseur, numero, date:"YYYY-MM-DD", pages:N,
 *     lignes:[{ produit, conditionnement, qte, unite, colis, unites, lot, dlc, dlc_type }] }
 *
 * Env: OPENAI_API_KEY | MENU_OCR_API_KEY. Stub clair (503) si clé absente.
 * Coût : modèle par défaut gpt-4o-mini, surchargeable par BL_OCR_MODEL (ex. BL_OCR_MODEL=gpt-4o si la
 * lecture des BL denses est insuffisante). Résolution image : BL_OCR_DETAIL = high (défaut) | low | auto.
 * Basé sur label-ocr.js / _ocrShared.js — aucun secret côté client.
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

const MAX_PAGES = 6;
const MAX_TOTAL_CHARS = 9_000_000;

const SYSTEM_BL = `Tu lis des BONS DE LIVRAISON (BL) de fournisseurs alimentaires pour une cuisine de restauration collective (France).
Tu reçois 1 ou plusieurs PHOTOS = les pages d'UN MÊME BL, dans l'ordre (page 1, page 2…).
Tu renvoies UNIQUEMENT un JSON valide (pas de markdown).

Schéma strict:
{
  "fournisseur": "raison sociale du fournisseur (en-tête émetteur, pas le client)",
  "numero": "n° du bon de livraison tel qu'imprimé",
  "date": "date de livraison JJ/MM/AAAA",
  "lignes": [
    {
      "produit": "désignation telle qu'imprimée",
      "conditionnement": "ex: sac 2,5 kg / colis 6 × 1 L",
      "qte_texte": "colonne quantité telle qu'imprimée, ex: 2 colis (12 bt)",
      "colis": nombre de colis/sacs/cartons livrés (entier),
      "unites": nombre d'unités individuelles si indiqué entre parenthèses ou déductible, sinon null,
      "lot": "n° de lot ou \\"\\" si absent (— = absent)",
      "dlc": "date JJ/MM/AAAA ou \\"\\"",
      "dlc_type": "DLC" | "DDM" | ""
    }
  ]
}

Règles:
1) Une entrée par ligne produit, toutes pages confondues, dans l'ordre. Ignore les lignes de rubrique (ex: "SURGELÉS (−18 °C)"), totaux, signatures, filigranes.
2) Ne jamais inventer lot ni DLC : vide si absent, "—" ou illisible.
3) Ne pas dupliquer une ligne répétée en en-tête de page suivante. Mais si un même produit figure sur 2 lignes réelles, garder les 2.
4) Le poids net n'est PAS la quantité. Pas de kg comme quantité.
5) Max 80 lignes.
6) Vocabulaire français : "colis", "carton", "sac", "bt"/"bouteille", "pce"/"pièce", "bq"/"barquette", "UVC". "colis" = nombre de colis livrés.
7) Conditionnement multiple "N × P" (ex: "20×250 g", "6 x 1 L", "colis de 12") : "unites" = N × nombre de colis (ex: 1 colis de 20×250 g → unites = 20). Ne jamais renvoyer 1 unité pour un colis de N pièces.
8) Dates : toujours l'ANNÉE COMPLÈTE sur 4 chiffres (JJ/MM/AAAA). Si l'année imprimée a 2 chiffres, la convertir en 20AA. Ne jamais confondre date de livraison et DLC.
9) "dlc_type" : "DLC" si "à consommer jusqu'au" / DLC ; "DDM" si "à consommer de préférence avant" / DDM / DLUO / BBD.
10) Lot : recopier EXACTEMENT les caractères imprimés (lettres, chiffres, tirets, espaces), sans corriger ni compléter ; ne pas confondre avec un code article, un EAN ou une date.`;

function toInt(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && isFinite(v)) return Math.round(v);
  const m = String(v).replace(/\s/g, '').match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/** "2 colis (12 bt)" → {colis:2, unites:12, unite:'bt'} ; "4 sacs" → {colis:4, unites:null, unite:'sacs'} */
function parseQteTexte(txt) {
  const s = cleanStr(txt, 60);
  const out = { colis: null, unites: null, unite: '' };
  if (!s || /^[—–-]$/.test(s)) return out;
  const m = s.match(/^(\d+)\s*([^\d(]*)/);
  if (m) { out.colis = parseInt(m[1], 10); out.unite = cleanStr(m[2], 20); }
  const p = s.match(/\((\d+)\s*([^)]*)\)/);
  if (p) out.unites = parseInt(p[1], 10);
  return out;
}

/** "20×250 g" / "6 x 1 L" → 20 / 6 (unités par colis) */
function perColis(txt) {
  const m = String(txt || '').match(/(\d+)\s*[x×*]\s*\d/i);
  return m ? parseInt(m[1], 10) : null;
}
function normDlc(raw) {
  let s = cleanStr(raw, 30);
  let type = '';
  const t = s.match(/\b(DLC|DDM|DLUO)\b/i);
  if (t) { type = t[1].toUpperCase() === 'DLC' ? 'DLC' : 'DDM'; s = s.replace(t[0], '').trim(); }
  if (/^[—–-]+$/.test(s)) s = '';
  return { dlc: normalizeDateFr(s) || '', type: type };
}

function normalizeBlDoc(raw, pages) {
  const o = raw && typeof raw === 'object' ? raw : {};
  let lines = Array.isArray(o.lignes) ? o.lignes : (Array.isArray(o.lines) ? o.lines : []);
  const out = [];
  lines.forEach(function (row) {
    try {
      const r = row && typeof row === 'object' ? row : {};
      const produit = cleanStr(r.produit || r.designation || r.product || r.nom, 100);
      if (!produit) return;
      const q = parseQteTexte(r.qte_texte || r.quantite || r.qte || '');
      const colis = toInt(r.colis) != null ? toInt(r.colis) : q.colis;
      let unites = toInt(r.unites) != null ? toInt(r.unites) : q.unites;
      const per = perColis((r.conditionnement || r.cond || '') + ' ' + (r.qte_texte || r.quantite || ''));
      if (per && per > 1 && (unites == null || unites < per)) unites = per * Math.max(1, colis || 1);
      let lot = cleanStr(r.lot || r.lot_number || r.batch, 60);
      if (/^[—–-]+$/.test(lot)) lot = '';
      const d = normDlc(r.dlc || r.ddm || r.dluo || '');
      let dlcType = String(r.dlc_type || d.type || '').toUpperCase();
      if (!dlcType && /pr[ée]f[ée]rence|DDM|DLUO|BBD/i.test(String(r.dlc || '') + ' ' + String(r.ddm || r.dluo ? 'DDM' : ''))) dlcType = 'DDM';
      if (dlcType === 'DLUO') dlcType = 'DDM';
      if (dlcType !== 'DLC' && dlcType !== 'DDM') dlcType = '';
      out.push({
        produit: produit,
        conditionnement: cleanStr(r.conditionnement || r.cond || '', 60),
        qte_texte: cleanStr(r.qte_texte || r.quantite || '', 60),
        colis: colis,
        unites: unites,
        // Stock en UNITÉS (jamais en kg) : unités si connues, sinon nb de colis/sacs
        qte: (unites != null && unites > 0) ? unites : ((colis != null && colis > 0) ? colis : 1),
        unite: q.unite || '',
        lot: lot,
        dlc: d.dlc,
        dlc_type: d.dlc ? dlcType : '',
      });
    } catch (e) { /* ligne ignorée */ }
  });
  return {
    mode: 'bl',
    fournisseur: cleanStr(o.fournisseur || o.supplier || '', 80),
    numero: cleanStr(o.numero || o.numero_bl || o.bl || o.n_bl || '', 40),
    date: normalizeDateFr(cleanStr(o.date || o.date_livraison || '', 20)) || '',
    pages: pages || 1,
    lignes: out.slice(0, 80),
  };
}

function collectImages(payload) {
  const list = [];
  try {
    if (Array.isArray(payload.images)) {
      payload.images.forEach(function (im) {
        const u = extractDataUrl(typeof im === 'string' ? { image: im } : im);
        if (u && u.startsWith('data:image/')) list.push(u);
      });
    }
    if (!list.length) {
      const u = extractDataUrl(payload);
      if (u && u.startsWith('data:image/')) list.push(u);
    }
  } catch (e) { /* vide */ }
  return list;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  const apiKey = process.env.OPENAI_API_KEY || process.env.MENU_OCR_API_KEY || '';
  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'JSON invalide' }); }

  if (!apiKey) {
    return json(503, { error: 'Lecture du BL non configurée', stub: true,
      hint: 'Définir OPENAI_API_KEY (ou MENU_OCR_API_KEY) dans les variables Netlify.' });
  }
  const images = collectImages(payload || {});
  if (!images.length) return json(400, { error: 'Image manquante' });
  if (images.length > MAX_PAGES) return json(413, { error: 'Trop de pages (max ' + MAX_PAGES + ')' });
  let total = 0;
  for (const u of images) {
    if (u.length > MAX_IMAGE_CHARS) return json(413, { error: 'Page trop volumineuse' });
    total += u.length;
  }
  if (total > MAX_TOTAL_CHARS) return json(413, { error: 'BL trop volumineux' });

  const DETAIL = ['low', 'high', 'auto'].indexOf(String(process.env.BL_OCR_DETAIL || '').toLowerCase()) >= 0 ? String(process.env.BL_OCR_DETAIL).toLowerCase() : 'high';
  const content = [{ type: 'text', text: 'Voici ' + images.length + ' page(s) du même bon de livraison, dans l\'ordre. JSON uniquement.' }];
  images.forEach(function (u, i) {
    content.push({ type: 'text', text: 'Page ' + (i + 1) + '/' + images.length });
    content.push({ type: 'image_url', image_url: { url: u, detail: DETAIL } });
  });
  const body = {
    model: process.env.BL_OCR_MODEL || 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: SYSTEM_BL }, { role: 'user', content: content }],
  };

  let resp, data;
  try {
    resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify(body),
    });
  } catch (e) { return json(502, { error: 'Service de lecture injoignable' }); }
  try { data = await resp.json(); } catch (e) { return json(502, { error: 'Réponse illisible' }); }
  if (!resp.ok) {
    return json(502, { error: 'Lecture du BL en erreur', detail: (data && data.error && data.error.message) || ('HTTP ' + resp.status) });
  }
  const txt = data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
  let parsed;
  try { parsed = JSON.parse(stripJsonFence(txt)); } catch (e) { return json(502, { error: 'Réponse non exploitable' }); }
  const result = normalizeBlDoc(parsed, images.length);
  if (!result.lignes.length) return json(422, { error: 'Aucune ligne produit lue sur le BL', result: result });
  return json(200, result);
};

exports._test = { normalizeBlDoc, parseQteTexte, normDlc, collectImages };
