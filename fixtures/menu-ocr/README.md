# Fixtures OCR menu (tests manuels)

Photos d’exemple (hors repo — pièces jointes agent) :

- `trame-semaine` — grille semaine Alliage Care (Midi / Goûter entre pointillés / Soir)
- `menu-jour-5-oct` — menu du jour Déjeuner + Dîner (5 octobre)
- `menu-jour-6-oct` — menu du jour (6 octobre)

Appeler `POST /.netlify/functions/menu-ocr` avec `{ "image": "data:image/jpeg;base64,..." }`.

Variable d’env Netlify requise : `OPENAI_API_KEY` (déjà référencée dans `haccp.js`).
