/**
 * recette-ia.mjs — Netlify Function : analyse IA d'un plat via Claude Haiku
 *
 * POST body : { platNom: string, service?: string }
 * Retourne  : { ingredients, profil_plat, enr_chain, commentaire_haccp }
 */

import Anthropic from '@anthropic-ai/sdk';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export default async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST')    return json(405, { error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY manquante — configurez la variable Netlify' });

  let platNom, service;
  try {
    ({ platNom, service } = await request.json());
    if (!platNom || typeof platNom !== 'string' || platNom.length > 200) {
      return json(400, { error: 'platNom invalide ou manquant' });
    }
  } catch {
    return json(400, { error: 'JSON invalide' });
  }

  const client = new Anthropic({ apiKey });

  const prompt = `Tu es un expert HACCP en restauration collective française.

Analyse le plat "${platNom.trim()}" (service : ${(service || 'restauration collective').slice(0, 80)}).

Retourne UNIQUEMENT ce JSON valide, sans texte autour :
{
  "ingredients": [
    {
      "nom": "nom précis de l'ingrédient",
      "categorie": "viande|poisson|oeuf|laitage|legume_cru|legume_cuit|feculent|sauce|condiment|autre",
      "profil_haccp": "BF_CUIT|BF_CRU|SORTIE_DIRECTE|REMISE_TC|PREPARE_MINUTE",
      "dlc_type": "frais|dluo|surgele|conserve"
    }
  ],
  "profil_plat": "BF_CUIT|BF_CRU|SORTIE_DIRECTE|REMISE_TC|PREPARE_MINUTE",
  "enr_chain": ["liste des types ENR dans l'ordre : enr08, enr23, enr01, enr07, enr33, enr34, enr_tc_distrib"],
  "commentaire_haccp": "1 phrase expliquant le profil HACCP de ce plat"
}

Règles HACCP obligatoires :
- BF_CUIT = préparation nécessitant cuisson puis refroidissement rapide (viandes, gratins, potages, œufs durs...)
- BF_CRU = aliment frais servi sans cuisson (salades, crudités, charcuterie, fromage frais...)
- SORTIE_DIRECTE = produit emballé servi intact (yaourt, fruit entier, biscuit industriel...)
- REMISE_TC = plat précuit réchauffé au moment du service (surgelés, conserves...)
- PREPARE_MINUTE = préparé et servi immédiatement sans stockage (sandwich, crêpe, omelette servie chaude...)

La chaîne ENR typique :
- BF_CUIT  → enr08 (réception MP) → enr01 (refroidissement) → enr07 (remise T°) → enr33 (plat témoin) → enr_tc_distrib
- BF_CRU   → enr08 (réception) → enr33 (plat témoin)
- REMISE_TC → enr08 (réception) → enr07 (remise T°) → enr_tc_distrib → enr33
- SORTIE_DIRECTE → enr08 → enr33

Inclus max 8 ingrédients principaux. Retourne le JSON uniquement.`;

  try {
    const message = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages:   [{ role: 'user', content: prompt }],
    });

    const text = message.content?.[0]?.text || '';
    // Extraire le JSON même si Claude ajoute du texte autour
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return json(500, { error: 'Réponse IA non parseable' });

    const parsed = JSON.parse(match[0]);
    parsed.platNom      = platNom;
    parsed.ia_generated = true;

    return json(200, parsed);
  } catch(e) {
    console.error('[recette-ia]', e.message);
    if (e instanceof SyntaxError) return json(500, { error: 'JSON IA invalide' });
    return json(500, { error: e.message?.slice(0, 120) || 'Erreur IA' });
  }
};
