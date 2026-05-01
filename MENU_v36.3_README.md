# HACC.PRO v36.3 — Menu refondu

## 🔥 Tout ce qui a été corrigé / ajouté

### 🐛 Bugs critiques

**1. Dictée vocale "tout le menu" — entrées corrompues**
- Avant : "entrée betterave entrée betterave..." → 1 plat avec tout le texte
- Après : nouveau parser qui utilise **TOUTES** les positions de mots-clés comme délimiteurs
- → "entrée betterave entrée carotte plat poulet" crée maintenant 3 plats correctement

**2. "Carotte" / "Betterave" en BF Cuit (rouge)**
- Maintenant détecté en BF Cru par défaut, sauf si "braisée/sautée/cuite/Vichy/au beurre"

**3. Widget Menu invisible sur l'accueil**
- Approche **bulletproof** : patch de 5 fonctions du système widget (`wgGet`, `wgRemove`, `wgCatalogAdd`, `_wgRenderOne`, catalogue)
- Auto-injection en haut de la liste avec respect du flag "supprimé par l'utilisateur"
- Re-tentative à 500ms / 1500ms / 3000ms (au cas où le timing est capricieux)

**4. Garde-fou bugs dictée**
- Maximum 80 caractères par plat — empêche le bug "entrée entrée entrée..." de s'enregistrer comme un plat

### ✨ Nouvelles fonctionnalités demandées

**1. Suppression des boutons "Normal/Mixé/HP/Sans sel" en haut**
→ Remplacés par des **checkboxes par plat**

**2. Checkboxes Mixé / Sans sel / HP par plat**
À côté de chaque plat dans le menu :
- 🥄 Mixé
- 🚫 Sans sel
- 💪 HP

**3. 🧪 Bouton "Générer plats témoins"**
- 1 clic → crée automatiquement les ENR33 pour chaque plat du menu
- Plat normal + variantes cochées (un plat témoin séparé pour chaque)
- Date prélèvement = date du menu, opérateur = chef de la session active
- DLC = +7 jours
- Liaison `_plat_id` / `_menu_id` automatique pour la traçabilité contrôle

**4. 🖨️ Bouton "Imprimer étiquettes du jour"**
- Ouvre une page A4 avec **toutes** les étiquettes du menu
- 2 colonnes par page (page-break-inside avoid → pas de coupure)
- Versions normales + mixé/sans sel/HP cochés
- Format : Logo établissement, "PLAT TÉMOIN", service, nom du plat, badge variante (rouge), date prélèvement, opérateur, conservation 0/+3°C, date à détruire
- `window.print()` automatique à l'ouverture

**5. 📚 Historique des menus sous les boutons**
- Liste des 30 derniers menus enregistrés
- Tri par date décroissante
- Affiche : date, service (badge violet), nb plats, résumé par catégorie
- Tap sur un menu → propose de le copier sur la date courante
- Persistant dans `S.menu_history` (sauvegardé cloud Supabase)

**6. Saisie multi-plats par catégorie**
- Pas de "casse" / boîtes séparées : tu peux ajouter autant de plats que tu veux dans chaque catégorie (potages, entrées, plats, garnitures, fromages, desserts, pains)
- Chaque catégorie a son propre input + son propre bouton micro

### 🔗 Liaison ENR (inchangé v36.1+)
- Bandeau violet en haut de chaque ENR (01, 03, 07, 08, 23, 33, 34, etc.)
- Tap sur 🔗 Choisir → sélectionne un plat du menu
- Préremplissage automatique du nom du plat (vrais IDs DOM : `ac-produit-{section}`)
- Lors de la sauvegarde de la ligne ENR → stamp avec `_plat_id`, `_menu_id`, `_plat_nom`, `_plat_profil`
- Tableau de bord siège peut reconstruire la timeline HACCP complète d'un plat

## 📋 Profils HACCP auto-détectés

| Plat exemple | Profil détecté | Couleur |
|---|---|---|
| Carotte / Betterave | 🥗 BF Cru | vert |
| Salade / Concombre / Tomate | 🥗 BF Cru | vert |
| Bourguignon / Rôti / Saumon | 🥘 BF Cuit | rouge |
| Soupe / Velouté / Gratin | 🥘 BF Cuit | rouge |
| Carottes braisées / Vichy | 🥘 BF Cuit | rouge |
| Raviolis en boîte / Surgelé | 🔥 Remise T°C | orange |
| Yaourt / Fruit / Camembert | 📦 Sortie directe | bleu |
| Sandwich / Wrap / Croque | ⚡ Préparé minute | violet |

Tap sur le badge profil pour cycler entre les 5 profils si la détection est fausse.

## 🚀 Déploiement

1. **Glisser `haccpro_v36.3.zip` sur Netlify**

2. **Sur la tablette** : vider le cache complètement
   - Chrome → ⋮ → Paramètres → Confidentialité → **Effacer données navigation**
   - Cocher : Cookies + Cache + Données du site
   - **Recharger** la page

3. **Test :**
   - L'accueil doit afficher le widget violet "🍽️ Menu du jour" en haut
   - Si pas visible : tap "+ Ajouter un widget" → "Menu du jour"
   - Aller dans onglet **Menu** : saisir 3-4 plats à la voix
   - Cocher Mixé sur 1 plat
   - Tap **🧪 Générer plats témoins** → vérifier dans ENR33 que les entrées sont créées (avec un doublon mixé)
   - Tap **🖨️ Imprimer étiquettes** → vérifier l'aperçu
   - Tap **💾 Enregistrer le menu** → tu dois voir le menu apparaître dans l'historique en bas

## 🎯 Compatibilité dictée vocale

| Navigateur | Support fr-FR |
|---|---|
| Chrome (Android/Desktop) | ✅ |
| Edge | ✅ |
| Samsung Internet | ✅ |
| Safari iOS | ⚠️ partiel |
| Firefox | ❌ |

Si la dictée ne marche pas, vérifier que la tablette autorise le micro pour le site `hacc.pro`.

## 📊 Pour le contrôle / audit

Tous les ENR (refroidissement, T°C, plats témoins, étiquettes, etc.) liés à un plat du menu portent maintenant ces métadonnées :
- `_plat_id` (UUID stable du plat)
- `_plat_nom` (nom littéral)
- `_menu_id` (UUID du menu)
- `_plat_profil` (BF_CUIT, BF_CRU, etc.)

Le tableau de bord siège (`dashboard.html`) → onglet **🍽️ Menus & Plats** → tap sur un plat → affiche la timeline HACCP complète (réception → cuisson → refroidissement → distribution → plat témoin) en cas de contrôle DGCCRF.
