# Fixtures OCR étiquettes / BL (tests manuels)

Appeler `POST /.netlify/functions/label-ocr` avec :

```json
{ "image": "data:image/jpeg;base64,...", "mode": "label" }
```

ou `"mode": "bl"` pour un bon de livraison (plusieurs lignes → le cuisinier en choisit une côté client).

Variable d’env Netlify : `OPENAI_API_KEY` (ou `MENU_OCR_API_KEY`) — déjà utilisée par `menu-ocr`.

Sans clé : réponse 503 `{ stub: true, example: ... }` — aucun secret inventé.
