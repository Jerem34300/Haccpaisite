# Audit complet HACC.PRO — feuille de route correctifs

> Audit en lecture seule réalisé sur la branche `claude/repo-codebase-analysis-YdjJk`.
> Couverture : cuisine (`app-cuisine.js`), dashboard, réseau/sync, PMS/onboarding/login,
> traçabilité/menu/impression, Netlify Functions + SQL/RLS, `superadmin.html`,
> + passe dédiée « seuils de température par ENR ». Recoupé avec un audit sécurité externe.
>
> ⚙️ Correctifs en cours d'application sur cette branche (voir les ✅ ci-dessous).

## Légende gravité
- 🔴 Critique — sécurité, perte de données, revenus, conformité réglementaire.
- 🟠 Important — bug fonctionnel, calcul faux, fragilité forte.
- 🟡 Mineur — robustesse, code mort, UX.

---

## 0. Le constat central — la chaîne de remontée des fiches ENR est rompue

Une fiche peut être saisie, afficher « ✅ enregistré », et ne jamais remonter, sans signal :

```
provision-tenant.js:191-201  → ✅ CORRIGÉ : INSERT sites n'utilise plus que les colonnes réelles (name/code/tenant_id/address/config) ; extras (type/siret/couleur) dans config ; anti-collision (3 lettres + 4 base36, retry sur 409) ; échec désormais BLOQUANT
signup-setup.js:99-141       → ✅ CORRIGÉ : rôle retourné cohérent (solo→cuisinier) ; le site est créé à l'onboarding via provision-tenant
app-onboarding.js:603        → ✅ CORRIGÉ : sites supplémentaires sans colonne fantôme `nom`
app-login.js:98-133          → siteId désormais peuplé (profile.site_id lié par provision-tenant)
supabaseservice.js:267       → enqueue SKIP : déjà signalé par toast ; non bloquant une fois site_id présent
supabaseservice.js:356       → ✅ CORRIGÉ : retries illimités (backoff capé 5 min) → fiche jamais abandonnée
supabaseservice.js:304-310   → ✅ CORRIGÉ : dédup par _uuid (plus de collision _ts) + purge locale par qid
```

**Maillon racine réparé : un client nouvellement onboardé obtient bien un site (code unique) lié à son profil, et la file de sync ne perd plus de fiches (dédup _uuid, retries illimités, verrou try/finally). Les fiches remontent.**

---

## 1. 🔴 CRITIQUES

### Sécurité multi-tenant
- ✅ **CORRIGÉ — `admin-proxy.js`** — Isolation tenant rétablie : injection forcée de `tenant_id`/`id` sur GET/PATCH/DELETE, forçage du tenant dans le corps des POST, refus par défaut (fail-closed) des tables non classées, contrôle d'escalade de rôle (rang), `subscriptions`/`tenants` en lecture seule, et comptes Auth (`/auth/v1/admin/users`) bornés au tenant (vérif du compte ciblé + post-filtrage des listes). Le super_admin conserve l'accès cross-tenant. Couvert par 26 tests. *(corrigé)*
- ✅ **CORRIGÉ — `admin-proxy.js`** — En-têtes : seuls les en-têtes sûrs (`SAFE_HEADER_KEYS`) sont relayés, `apikey`/`Authorization` posés **après** → plus d'écrasement possible côté client. *(corrigé)*
- ✅ **CORRIGÉ — `admin-proxy.js`** — Whitelist de chemins + garde « filtre requis » sur DELETE/PATCH REST ; création/suppression de `tenants` réservées au super_admin → `DELETE /rest/v1/tenants` global bloqué. *(corrigé)*
- ✅ **CORRIGÉ — `superadmin.html`** — XSS stocké via `onclick` : `_esc()` échappe désormais `'` et `` ` `` ; le seul `onclick` interpolé (bouton « Voir les cuisines ») passe en `data-*` + handler délégué (`viewTenantDataEl`). *(corrigé)*
- ✅ **CORRIGÉ — `superadmin.html`** — couleur tenant injectée dans `style=` : nouvel `_safeColor()` (whitelist hex/rgb/hsl/var/nom) appliqué aux deux points d'injection (avatar liste + en-tête). *(corrigé)*
- 🟠 **PARTIEL — `superadmin.html`** — token super_admin en `localStorage` : les vecteurs XSS qui permettaient son exfiltration sont fermés ; le stockage lui-même (vs cookie httpOnly) reste à revoir dans une passe auth dédiée. *(mitigé)*
- ✅ **CORRIGÉ — `app-dashboard.js`** — XSS stocké via `<option>`/divs/`onclick` : tous les `name/code/email/tagline` non-fiables passent par `escH` (texte), `escAttr` (attribut) ou le nouvel `jsArg` (argument JS d'un `on*` inline — sûr en double contexte HTML→JS, prouvé par 20 tests). Les 3 `onclick` à arguments libres bruts (pastille GMO, carte site, viewTenant) refactorés en `data-*`. *(corrigé)*
- ✅ **CORRIGÉ — `haccp-hub.mjs`** — un compte sans tenant est rejeté (403) au lieu de retomber sur `tenant_id=is.null` ; `tenantFilter` sans tenant cible une valeur impossible (fail-closed) → fin du pot commun cross-comptes.
- ✅ **CORRIGÉ (migration `menu_feature_rls_fix.sql` à jouer)** — `menu_coverage()` et `plat_tracability()` repassées en `security invoker` → la RLS de `pms_records` s'applique, plus de fuite cross-tenant.
- ✅ **CORRIGÉ — `send-email.js`** — reset : réponse générique `{ok:true}` quel que soit l'existence de l'email (plus d'oracle d'énumération) ; `confirmUrl` validé (HTTPS hacc.pro uniquement, anti-phishing) et toutes les URL échappées dans les `href`.
- ✅ **CORRIGÉ — `stripe-checkout.js` / `stripe-portal.js`** — l'appartenance de l'utilisateur au `tenantId` est désormais vérifiée (403 sinon) → impossible d'ouvrir le portail Stripe ou d'agir sur l'abonnement d'un autre tenant.
- 🟠 **CORRECTIF FOURNI (migration `photos_bucket_rls_fix.sql` à jouer)** — INSERT/UPDATE/DELETE du bucket `pms-photos` scopés au tenant (via le code site du chemin) → fin de l'écrasement cross-tenant. La privatisation de la lecture (RGPD) est fournie en section optionnelle (nécessite des URL signées côté client).

### Revenus
- ✅ **CORRIGÉ (commit antérieur 0500957)** — `stripe-webhook.js` lit `current_period_end` depuis `items.data[0]` (API Stripe récente) avec fallback → l'abonnement payé s'active. *(apiVersion non figée : amélioration mineure restante ; la signature utilise la lib Stripe officielle, comparaison constant-time native.)*

### Perte / corruption de fiches ENR
- ✅ **CORRIGÉ — Déduplication par `_uuid`** (`supabaseservice.js`) — le `client_id` déterministe est désormais basé sur `_uuid` (unique par fiche) et la purge locale se fait par `qid` : deux fiches distinctes au même instant (lot ENR33, tablettes simultanées) ne s'écrasent plus. *(Reste à vérifier que les générateurs côté `app-cuisine.js` posent bien un `_uuid` par fiche.)*
- 🟠 **AMÉLIORÉ — `app-cuisine.js` `save()`** — la récupération sur `QuotaExceededError` compresse désormais TOUTE image base64 volumineuse (toutes sections/champs), au lieu de seulement `enr23/enr31` → bien plus de chances de tenir. *(La compression reste asynchrone — limite intrinsèque de localStorage ; les données structurées restent dans `S`.)*
- ✅ **CORRIGÉ — `app-cuisine.js` ENR02→ENR03** — la branche auto enfile désormais explicitement les DEUX fiches (ENR02 courant + ENR03 auto-créée) avant le `return`.
- ✅ **CORRIGÉ — `app-cuisine.js` lots e33/e34** — `e33PrintBatch`/`e34PrintBatch` ne ré-insèrent plus les lignes déjà persistées+enfilées par `AddBatch` → fin des doublons dans l'historique local (l'impression lit le lot, pas l'historique).
- ✅ **CORRIGÉ — `supabaseservice.js` flush** — le verrou `_flushing` est désormais relâché dans un `finally` → plus de gel définitif de la sync sur exception.
- **`supabaseservice.js:433-440`** — 409 + PATCH échoué marqué `synced` → perte de données confirmée.
- ✅ **CORRIGÉ — `supabaseservice.js` photos** — la pleine résolution (`_fullPhotos`) n'est effacée que si TOUTES les photos sont uploadées (sinon conservée pour réessai) → plus de perte de preuve sur upload partiel.
- ✅ **CORRIGÉ — `supabaseservice.js` queue** — une queue corrompue est sauvegardée dans une clé `_corrupt_<ts>` avant reset (plus de perte silencieuse) ; `setQueue` loggue désormais les échecs de persistance (quota) au lieu de les avaler.

### PWA / déploiement
- ✅ **CORRIGÉ — `sw.js`** — JS/CSS repassés en Cache-First lié à `CACHE_NAME` (version bumpée v388) → tous les assets proviennent de la même génération, plus de mélange « app neuf + utils périmé » qui crashait le JS. Rafraîchissement atomique au bump de version.
- ✅ **CORRIGÉ — Icônes PWA** — `favicon-32.png`, `icon-192.png`, `icon-512.png` (maskable) et `apple-touch-icon.png` générées aux couleurs de la marque (navy + pastille verte) → PWA installable sur tablette. *(Icônes simples : à remplacer par le logo définitif quand disponible.)*

### Conformité température (passe dédiée)
- ✅ **CORRIGÉ — ENR23 réception par type** — seuils câblés au sélecteur frais/surgelé : **frais ≤ +3°C / surgelé ≤ −18°C** (constantes `RECEP_FRAIS_MAX`/`RECEP_SURGEL_MAX` + helper `recepTcConf`, virgule décimale gérée). Alignés sur les 5 emplacements (conformité active `r23ConfGlobal`, legacy `AR.enr23`, widget de saisie, et 3 affichages d'historique/export). Un surgelé à −5°C est désormais **NON conforme** (12 tests OK). Cuisson (≥63/65°C) et distribution (chaud ≥63°C / froid ≤10°C service) déjà conformes au standard FR → inchangés.
- ✅ **CORRIGÉ — virgule décimale** (`app-cuisine.js`) — helper `_num()` (gère `,`→`.`) appliqué à la saisie (`onTS`, `onTM`, `onEncTS`, `distribDirect`, `validateTemperature`) ET à l'accesseur de conformité `gtv` → « 8,5 » n'est plus tronqué en 8. (8 tests OK.)

### Modules cassés
- ✅ **SUPPRIMÉ — `app-pms.js` + `pms-setup.html`** — page cassée (tables `enceintes`/`points_controle` inexistantes, token dans une mauvaise clé, faux succès, pas d'authguard) et redondante avec l'onboarding (`provision-tenant`). Retirée + référence de précache `sw.js` nettoyée (décision : suppression).
- ✅ **CORRIGÉ — `tenants.plan` CHECK** — `provision-tenant.js` mappe désormais le plan commercial (solo/multi/enterprise) vers la valeur attendue par le CHECK (starter/pro/enterprise) avant l'INSERT tenant.
- ✅ **CORRIGÉ — `schema.sql` subscriptions** — les colonnes `status/trial_ends_at/stripe_*/current_period_end/cancel_at_period_end` sont désormais incluses dans le `create table` canonique (+ index) → une installation neuve fonctionne sans dépendre de `stripe-migration.sql`.

---

## 2. 🟠 IMPORTANTS

### Dashboard / remontée
- ✅ **CORRIGÉ — Troncature 1000 lignes** : chargement des `pms_records` paginé par offset (pages de 1000 jusqu'à épuisement) → conformité/compteurs justes. Le plafond d'affichage 300 de `renderSaisies` est désormais signalé à l'utilisateur (« 300 affichées »).
- ✅ **CORRIGÉ — Timeout** : passé de 5 s à 20 s (`supa` GET + `supaAdmin`), conforme au commentaire et aux cold starts Supabase → plus d'`AbortError` prématuré.
- Timezone UTC vs local FR dans regroupements/filtres (`:966,7696` ; `app-menu-dashboard.js:207`).
- ✅ **CORRIGÉ — Score 100 % sans saisie** : la conformité vaut désormais 0 % (et non 100 %) quand aucun relevé n'est fait → un site non documenté n'apparaît plus « conforme ».
- Conformité calculée 2 façons (brut vs pondéré) qui se contredisent ; assiduité ENR19 surévaluée et fausse en multi-sites (`:1322-1326`).
- ✅ **CORRIGÉ — Vue Tableau↔Cartes** : `_pgSetView` inclut désormais les services de distribution dynamiques (`enr_distrib_*`) comme `renderPageENR` → les fiches de distribution ne disparaissent plus au basculement de vue.
- ✅ **CORRIGÉ — hint `service_role`** retiré (il invitait à coller la clé service_role dans le navigateur → bypass total de la RLS). La création de comptes passe par `admin-proxy` côté serveur. *(Le plomberie client `SUPA_SERVICE_KEY` résiduelle, défaut vide, pourra être nettoyée au lot 7.)*

### Sync / session
- ✅ **CORRIGÉ (partiel) — clés de session** : `branding.js` lit désormais la clé canonique `haccp_supa_cfg_v1` en PREMIER (legacy en repli) ; le refresh partagé propage le token à toutes les clés connues, ce qui réduit les divergences entre gardes.
- ✅ **CORRIGÉ — refresh token concurrent** : helper partagé `window.__haccpSharedRefresh` (single-flight : 1 requête à la fois, résultat réutilisé) propageant le nouveau `refresh_token` à toutes les clés de session. authguard et supabaseservice y délèguent → plus de réutilisation d'un refresh_token déjà tourné → fin des déconnexions intempestives. 5 tests.
- ✅ **CORRIGÉ — subscriptionguard** : on ne fait plus confiance au cache NÉGATIF (re-vérification live → un paiement récent débloque immédiatement, plus d'attente 1 h) ; `fetchSubscription` ajoute `order=created_at.desc` → choix déterministe du dernier abonnement (fini le faux paywall sur un vieux trial).

### RLS / SQL
- ✅ **CORRIGÉ (migration `rls_roles_fix.sql`)** — chef_secteur borné à son secteur en lecture pms_records (filtre sur les sites de son `sector_id`).
- ✅ **CORRIGÉ (migration `rls_roles_fix.sql`)** — l'UPDATE `pms_records` par code site exige désormais aussi le bon `tenant_id` (défense en profondeur ; les codes sont déjà globalement uniques).
- ✅ **CORRIGÉ (migration `rls_roles_fix.sql`)** — `pms_config` : lecture tenant-wide réservée aux admins, le cuisinier ne lit que la config de son propre site ; `gmo` : lecture réservée aux directeur/siège/super_admin.
- ✅ **CORRIGÉ — ENR figées après N jours** : `delRow` refuse la suppression (soft-delete) par le cuisinier d'une fiche de plus de `ENR_EDIT_LOCK_DAYS` (3 j, ajustable) → intégrité de la preuve. *(Les responsables corrigent côté dashboard.)*
- ✅ **CORRIGÉ — Générateur de code site** (`provision-tenant.js`) : 3 lettres + 4 base36 (~1,7M combinaisons) + retry sur collision 409.

### Conformité cuisine (température + logique)
- ✅ **CORRIGÉ — Dépassement de durée = non-conforme** : `tdiff` ne renvoie plus `null` quand `maxH` est dépassé → une durée trop longue (chaîne du froid/chaud rompue) est calculée et évaluée NON conforme par `cv()` au lieu d'être masquée en « non évalué » (ENR07/08).
- ✅ **CORRIGÉ — Cuisson** : ENR07 (BF cuit) déjà à ≥75°C ; ENR04 passé de ≥65°C à ≥63°C → cohérent avec la décision (tout sauf ENR07 = ≥63°C).
- ✅ **CORRIGÉ — Distribution froide** : ENR13/14/16 passés de ≤10°C à ≤3°C (cohérents avec ENR15) ET la constante `DISTRIB_FROID_MAX` du tab « distribution service » passée de 10 à 3 (décision validée). Livraison/conditionnement/pique-nique inchangés.
- ✅ **CORRIGÉ — Alerte CCP en veille** : recalcul des minuteries CCP au réveil de la tablette (`visibilitychange` → `ccpTimerRefreshAll` + réarmement de l'interval). L'état est déjà persisté ; l'alerte de seuil ratée pendant le sommeil s'affiche dès le retour à l'écran.
- ✅ **CORRIGÉ — clamp T° / enceintes chaudes** : `qtempConfirm` enregistre la valeur réellement saisie (plus de clamp silencieux qui masquait une T° hors plage) ; `encConforme` gère désormais les consignes « ≥ X » (enceintes chaudes) en plus de « ≤ X » et « X à Y ». *(`validateTemperature` reste non câblé — mineur.)*
- ✅ **CORRIGÉ — Profil de plat** : exceptions froides prioritaires ajoutées en tête de liste → « saumon/truite fumé(e) » et « salade de poulet/thon/composée… » détectés BF_CRU (et non plus BF_CUIT). Correction aussi du `\b` final après lettre accentuée qui cassait le match. 10 tests OK. *(le badge reste cliquable pour corriger une détection)*
- ✅ **CORRIGÉ — Variante / plat témoin** : génération désormais INCRÉMENTALE (par plat + variante) → cocher une variante après une 1re génération crée juste son témoin, sans dupliquer les autres ni l'oublier (fini le « tout ou rien » destructif). Les témoins soft-deletés restent régénérables.
- ✅ **CORRIGÉ — `_deleted_by`** : `S.config.chefs` étant un tableau de noms (chaînes), l'attribution prend désormais la session active (`getActiveSession`) au lieu d'un `find(c=>c.pin===…)` qui ne matchait jamais.
- ✅ **CORRIGÉ (partiel) — Parser dictée vocale** : suppression de l'usage de `.test()` sur la regex globale `/gi` (lastIndex stateful → résultats erratiques) ; filtrage des items « mot-clé seul » via `.replace().trim()` déterministe. *(limite 80 car : comportement conservé)*

### Impression
- 🟠 **PARTIEL — Étiquettes** : nom de produit désormais échappé (`escH`) dans le sélecteur d'étiquettes (`Pâté d'Auvergne` ne casse plus le HTML). *(reste : garde DLC si auto-calcul échoue, marges/parité A4, impression menu iOS via Blob URL.)*

### Provisioning
- Double création tenant (signup-setup échoue sur le profil → tenant orphelin → re-création au login).
- Enceintes jamais persistées si le site a échoué (perdues au changement d'appareil).

### superadmin.html
- Pas d'expiration/refresh token → UI figée après ~1h. Impersonation collante (sessionStorage sans TTL) ; cassée pour les plans solo (`cuisine.html` ne lit pas `sa_view_tenant`).
- KPI faux : limites 1000/500, MRR sous-évalué si `price_per_month` non peuplé.
- ✅ **CORRIGÉ (partiel) — Suppression utilisateur** : garde anti auto-suppression ajoutée (un admin ne peut plus supprimer son propre compte → plus de verrouillage). *(l'ordre profil/auth en cas d'échec partiel reste à durcir — mineur.)*

---

## 3. 🟡 MINEURS

- ~90 `catch {}` muets (dont ~30 autour de `enqueue`) → échecs silencieux + toast de succès trompeur.
- Code mort : `index.js` + `haccp.js` (prototype OpenAI orphelin) ; système de licence (`parseLicKey`, `isRO`…) ; `_compressB64` synchrone cassé (image blanche) ; refs DOM `#lic-*` ; `_authUsersLoaded` ; sélecteur `.sb-item` inexistant (`superadmin.html:1041`).
- Croissance illimitée localStorage : `haccp_patterns_v1` jamais purgé, `_alertsFired`, lifecycle.
- `plat_id = newUUID().slice(0,8)` (32 bits) → collisions possibles ; `_plat_id` non propagé sur liaisons cloud.
- Cache traçabilité 30 min (commentaire dit 5 min) + regex accents littérale `/[̀-ͯ]/`.
- 3 listes d'ENR différentes pour la « couverture » → pourcentages incohérents.
- `closeSP` toast « Configuration enregistrée » même si la sauvegarde cloud a échoué.
- CORS `*` sur tous les endpoints ; signup direct force `directeur`.
- **Pas de CSP** dans `netlify.toml` (amplifie les XSS). *(vérifié)*
- Bilinguisme FR/EN annoncé mais FR en pratique ; pas de tests / CI / monitoring d'erreurs.

---

## 4. Rétention / conformité documentaire
- Purge locale `cutoff6m = 186 j` (`supabaseservice.js:461` ; `app-cuisine.js:10088`) + dashboard limité à `_loadMonths` → **aucune fiche > 6 mois consultable/exportable**, même si conservée en base. À confronter à l'obligation de mise à disposition des preuves (CE 178/2002, rétention pluriannuelle).

---

## 5. Plan de correction proposé (étape par étape)

| Lot | Contenu | Pourquoi d'abord |
|-----|---------|------------------|
| **1 — Sécurité bloquante** | admin-proxy ✅ (tenant_id forcé + whitelist méthode + siège/directeur bornés à leur tenant, super_admin seul en cross-tenant) · XSS dashboard + superadmin (escH/escAttr partout, data-* au lieu d'onclick) · CSP · retrait hint service_role `:2275` · webhook Stripe (`items.data[0].current_period_end` + constructEvent) | Fuite de données de tous les clients + revenus non encaissés |
| **2 — Remontée des fiches** | provision-tenant (colonnes `sites` réelles) · garantir `site_id`/`tenant_id` · bloquer/alerter si `siteId` vide au login · dédup par `_uuid` · lock flush try/finally · réarmer retries | Sans ça un nouveau client ne fait rien remonter |
| **3 — PWA / déploiement** | générer les icônes manquantes · SW versionné cohérent (un seul bump, purge proactive) | Installabilité tablette + éviter crash JS |
| **4 — Dashboard fiabilité** | pagination (count exact) · timeout 20 s · timezone · score si rien saisi · vue distribution | Justesse des chiffres de supervision |
| **5 — Conformité cuisine** | virgule décimale · réception par type de produit · durée dépassée = NC · seuils cuisson/distribution (validation expert) · alertes CCP veille · profils de plats · plats témoins variantes | Justesse réglementaire |
| **6 — Paywall / provisioning** | dédup tenant/abo (`on conflict`) · `order` sur fetch abo · période de grâce post-paiement | Facturation cohérente |
| **7 — Nettoyage** | supprimer `app-pms.js`/`pms-setup.html`, licence, `index.js`/`haccp.js` · vider les `catch {}` muets (logs) | Réduire la surface de bugs |

> **Décisions d'expert (lot 5) — VALIDÉES :**
> - Cuisson : **ENR07 (BF cuit) ≥75°C** · tout le reste (dont ENR04 steaks hachés) **≥63°C**.
> - Distribution froide : **≤3°C — distribution uniquement** (ENR13/14/16 ; ENR15 déjà ≤3). Livraison/conditionnement/pique-nique inchangés.
> - Réception : **≤3°C (frais) / ≤−18°C (surgelés)** via le sélecteur de type déjà présent sur les fiches réception.
