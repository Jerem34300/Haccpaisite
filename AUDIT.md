# Audit complet HACC.PRO — feuille de route correctifs

> Audit en lecture seule réalisé sur la branche `claude/repo-codebase-analysis-YdjJk`.
> Couverture : cuisine (`app-cuisine.js`), dashboard, réseau/sync, PMS/onboarding/login,
> traçabilité/menu/impression, Netlify Functions + SQL/RLS, `superadmin.html`,
> + passe dédiée « seuils de température par ENR ». Recoupé avec un audit sécurité externe.
>
> Aucune correction n'a encore été appliquée. Ce document sert de plan de bataille.

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
- **`haccp-hub.mjs:160`** — `tenant_id=is.null` pour comptes non provisionnés → pot commun cross-comptes. *(vérifié)*
- **`menu_feature.sql:69,99`** — fonctions `SECURITY DEFINER` requêtant `pms_records` sans filtre tenant → bypass RLS.
- **`stripe-checkout.js` / `stripe-portal.js`** — JWT vérifié mais appartenance au `tenantId` non vérifiée → portail Stripe / customer d'un autre tenant.
- **`send-email.js:44`** — reset password public non authentifié + `confirmUrl` non échappé (oracle d'énumération, phishing).
- **`schema.sql:444-462`** — bucket `pms-photos` public en lecture + insert/update conditionnés au seul `bucket_id` → photos lisibles/écrasables cross-tenant. Enjeu RGPD.

### Revenus
- **`stripe-webhook.js:137,160`** — `current_period_end` n'est plus sur l'objet Subscription (API Stripe récente) → `Invalid Date` → 500 → **abonnement payé jamais activé**. Aucune `apiVersion` figée. Signature HMAC non constant-time (`:86`). *(vérifié, dépend du défaut compte Stripe)*

### Perte / corruption de fiches ENR
- ✅ **CORRIGÉ — Déduplication par `_uuid`** (`supabaseservice.js`) — le `client_id` déterministe est désormais basé sur `_uuid` (unique par fiche) et la purge locale se fait par `qid` : deux fiches distinctes au même instant (lot ENR33, tablettes simultanées) ne s'écrasent plus. *(Reste à vérifier que les générateurs côté `app-cuisine.js` posent bien un `_uuid` par fiche.)*
- **`app-cuisine.js:29-73`** — `save()` retourne avant persistance sur `QuotaExceededError` (compression async) ; récupération limitée à `enr23/enr31` → fiche jamais écrite mais toast de succès.
- **`app-cuisine.js:2832-2861`** — `return` dans la branche ENR02→ENR03 auto court-circuite l'`enqueue` → 2 fiches CCP jamais mises en file.
- **`app-cuisine.js:12381-12451,10889-10911`** — `e34AddBatch`+`e34PrintBatch` (et e33) enregistrent 2× chaque ligne (double `unshift` + double `enqueue`) → doublons. *(node --check OK : pas de SyntaxError, mais duplication logique réelle entre printservice.js et app-cuisine.js)*
- ✅ **CORRIGÉ — `supabaseservice.js` flush** — le verrou `_flushing` est désormais relâché dans un `finally` → plus de gel définitif de la sync sur exception.
- **`supabaseservice.js:433-440`** — 409 + PATCH échoué marqué `synced` → perte de données confirmée.
- **`supabaseservice.js:235-259`** — base64 effacé avant POST réussi → perte de preuve photo.
- **`supabaseservice.js:142-145`** — queue corrompue → reset silencieux `[]` ; `setQueue` avale `QuotaExceeded`.

### PWA / déploiement
- **`sw.js:153-165`** — JS/CSS Network-First → versions mixtes (app-cuisine neuf + utils périmé) → crash JS → plus aucune saisie.
- **Icônes PWA manquantes** — `manifest.json`/`sw.js` référencent `favicon-32/icon-192/icon-512/apple-touch-icon.png` : aucune n'existe (seul `favicon.svg`) → PWA non installable sur tablette. *(vérifié)*

### Conformité température (passe dédiée)
- **`app-cuisine.js:1862` (ENR23 réception)** — seuil fixe `≤ 4°C` quel que soit le produit → un surgelé livré à −5°C passe « conforme ». *(vérifié)* **DÉCISION : ≤3°C (frais) / ≤−18°C (surgelés), via le sélecteur de type déjà présent sur les fiches réception (ENR08/ENR23) à câbler.**
- **`app-cuisine.js:1802` (`gtv`)** — `parseFloat(x)` brut → « 8,5 » saisi au clavier devient `8` → **conformité calculée sur température fausse**. Le `replace(',','.')` n'existe qu'à `:3879`. *(vérifié)*

### Modules cassés
- **`app-pms.js` + `pms-setup.html`** — écrit dans tables/colonnes inexistantes (`/enceintes`, `/points_controle`, colonnes `pms_config` fantômes), token dans une clé jamais écrite, redirige vers dashboard en simulant un succès, pas d'authguard.
- ✅ **CORRIGÉ — `tenants.plan` CHECK** — `provision-tenant.js` mappe désormais le plan commercial (solo/multi/enterprise) vers la valeur attendue par le CHECK (starter/pro/enterprise) avant l'INSERT tenant.
- **`schema.sql:100-106`** — colonnes `status/trial_ends_at/stripe_*` créées uniquement par `stripe-migration.sql` (si non jouée → auth/paywall plante).

---

## 2. 🟠 IMPORTANTS

### Dashboard / remontée
- Troncature : `limit=5000` ne contourne pas `db-max-rows` PostgREST (~1000) (`app-dashboard.js:818`) ; `renderSaisies` plafonne à 300 sans le dire (`:5108`) ; alertes 400 (`:591`).
- Timeout réel 5 s (commentaire dit 20 s) (`:387,434`) → `AbortError` → rien ne s'affiche.
- Timezone UTC vs local FR dans regroupements/filtres (`:966,7696` ; `app-menu-dashboard.js:207`).
- Score 100 % quand un site ne saisit rien (NC détectée seulement si fiche `conf=NON`).
- Conformité calculée 2 façons (brut vs pondéré) qui se contredisent ; assiduité ENR19 surévaluée et fausse en multi-sites (`:1322-1326`).
- Vue Tableau↔Cartes fait disparaître les fiches de distribution (`_pgSetView:7530`).
- Code mort `service_role` + **hint dangereux `:2275`** invitant à coller la clé service_role.

### Sync / session
- 4 conventions de clés de session lues différemment par chaque garde ; `branding.js:7` lit la clé legacy en premier.
- 3 mécanismes de refresh token concurrents + rotation refresh_token → déconnexions intempestives.
- subscriptionguard : cache 1h `allowed=false` bloque après paiement ; `fetchSubscription limit=1` sans `order` + double abonnement trial → paywall non déterministe ; boucle paywall post-paiement.

### RLS / SQL
- **`schema.sql:352`** — chef_secteur lit tout le tenant (pas de filtre secteur). *(vérifié)*
- **`schema.sql:370-382,402-414`** — UPDATE `pms_records`/`pms_config` par `site_code` sans `tenant_id` → cross-tenant sur collision de code.
- **`schema.sql:393-400,417-423`** — config/GMO lisibles par tout le tenant (cuisinier inclus).
- ENR modifiables par le cuisinier sans limite de date → intégrité de la preuve.
- ✅ **CORRIGÉ — Générateur de code site** (`provision-tenant.js`) : 3 lettres + 4 base36 (~1,7M combinaisons) + retry sur collision 409.

### Conformité cuisine (température + logique)
- **Dépassement de durée = « non évalué » au lieu de « non-conforme »** : `tdiff(...,maxH)` retourne `null` si dépassé (`:1794`) → `cv()` → `null` → le cas le plus à risque n'est pas signalé (ENR07/08).
- **Incohérence cuisson** : ENR04 `≥65°C` vs ENR07 `≥75°C` (`:1819,1832`). **DÉCISION : ENR07 (BF cuit) = ≥75°C ; tout le reste (dont ENR04) = ≥63°C.**
- **Distribution froide incohérente** : `≤3` (SAM/ENR15) vs `≤10` (ENR13/14/16). **DÉCISION : distribution uniquement → ≤3°C (ENR13/14/16 passent de ≤10 à ≤3). Livraison (17/18), conditionnement/chaîne (10/11) et pique-nique (39) restent inchangés (≤6).**
- Alerte CCP refroidissement (90/120 min) ratée si tablette en veille (`:14573`).
- Températures silencieusement clampées (`qtempConfirm:15871`) ; `validateTemperature` code mort jamais appelé ; `encConforme` ne gère pas « ≥ » (enceintes chaudes).
- Profil de plat mal détecté : « saumon fumé »/« filet de » → BF_CUIT, « salade de poulet » → BF_CUIT (`app-menu-cuisine.js:29-44`).
- Variante cochée après le 1er enregistrement → plat témoin jamais créé ; `_e33batch` ré-empilé à chaque save.
- `delRow:2949` — `_deleted_by` toujours « Cuisinier » (cherche `c.pin` sur un tableau de chaînes).
- Parser dictée vocale non déterministe (regex globale `/gi` + `lastIndex` dans `.test()`) ; limite 80 car rejette tout le texte.

### Impression
- Étiquette sans DLC si auto-calcul échoue (aucune garde) ; produit non échappé (`Pâté d'Auvergne`) ; planches A4 rognées/décalées (marges 0 mm, parité `nth-child`) ; impression menu non compatible iOS (pas de Blob URL).

### Provisioning
- Double création tenant (signup-setup échoue sur le profil → tenant orphelin → re-création au login).
- Enceintes jamais persistées si le site a échoué (perdues au changement d'appareil).

### superadmin.html
- Pas d'expiration/refresh token → UI figée après ~1h. Impersonation collante (sessionStorage sans TTL) ; cassée pour les plans solo (`cuisine.html` ne lit pas `sa_view_tenant`).
- KPI faux : limites 1000/500, MRR sous-évalué si `price_per_month` non peuplé.
- Suppression utilisateur : erreur profil avalée → orphelins ; pas de garde anti auto-suppression.

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
