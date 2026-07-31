# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**HACC.PRO** is an offline-first HACCP (Hazard Analysis Critical Control Points) management PWA for commercial kitchens. It handles regulatory food-safety record entry on tablets, multi-tenant supervision dashboards, and sanitary control plan generation. The app is bilingual (FR/EN) but code and comments are written in French.

## Running Locally

There is **no build step**. HTML/CSS/JS are served as-is. Netlify Functions use esbuild (managed by Netlify on deploy).

```bash
# Install the only dependency (Netlify Functions)
npm install

# Serve locally (any static server works)
npx netlify dev        # preferred — proxies Netlify Functions at /.netlify/functions/*
# OR
python3 -m http.server 8080
```

Supabase credentials are hardcoded in `js/supabaseconfig.js` (anon key — intentionally public; security enforced by RLS policies). Netlify Functions require these env vars set in Netlify UI or `.env` for local dev:
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`
- `RESEND_API_KEY`, Stripe keys (`stripe-checkout.js`, `stripe-portal.js`, `stripe-webhook.js`)

**Deployment:** Push to git → Netlify auto-deploys. No CI pipeline. To test on a tablet, clear browser cache fully (cookies + cache + site data) after each deploy. `sw.js` cache name (`CACHE_NAME = 'haccpro-v388'`, `sw.js:11`) must be bumped manually on every deploy that changes cached assets, or tablets keep serving stale JS/CSS.

---

## ⚠️ Règles absolues (à respecter avant toute modification)

Ce projet est un monolithe front-end sans tests automatisés, sans bundler, et à très forte densité fonctionnelle (`app-cuisine.js` fait **16 600 lignes**, `app-dashboard.js` **9 968 lignes**). Une régression n'est détectée qu'en prod, sur tablette, en cuisine. En conséquence :

1. **Ne jamais renommer, déplacer ou changer la signature de `sd()`, `r23s()` ou `renderNav()`.**
   - `sd(id, val, sec)` (`js/app-cuisine.js:126`) écrit dans le brouillon `S[sec].draft[id]` et appelle `save()`. C'est le setter générique utilisé par la quasi-totalité des formulaires ENR.
   - `r23s(id, val)` (`js/app-cuisine.js:7752`) est l'équivalent spécifique à ENR23 (liaison froide).
   - `renderNav()` (`js/app-cuisine.js:688`) reconstruit le menu de navigation principal (`#main-nav`) à partir de `navOrder()`/`ALL` et des badges de NC (`navBadge()`). Toute page cuisine dépend de son bon fonctionnement pour rester navigable.
   - Ces trois fonctions sont appelées depuis des dizaines/centaines de sites d'appel dispersés dans tout `app-cuisine.js` — une modification de signature casse silencieusement des écrans entiers sans erreur JS visible avant test manuel.

2. **`WG_VER` (widgets d'accueil) : ne jamais décrémenter, ne jamais réutiliser un numéro déjà passé.**
   - Valeur actuelle réelle constatée dans le code : **`WG_VER = 5`** (`js/app-cuisine.js:16094`). *(Note : la demande d'audit mentionnait `WG_VER=4` — ce n'est plus la valeur en vigueur ; ne pas la restaurer.)*
   - `wgGet()` (`js/app-cuisine.js:16095-16129`) compare `S.config.homeWidgetsVer` à `WG_VER` pour décider s'il régénère la disposition par défaut des widgets d'accueil ou respecte la personnalisation utilisateur. Incrémenter ce compteur force une migration pour tous les utilisateurs (à faire uniquement si la structure des widgets change) ; le décrémenter ou réutiliser un ancien numéro ferait perdre le mécanisme anti-doublon.

3. **Try/catch partout, y compris autour de code qui « ne peut pas échouer ».**
   - Convention du projet (117 `try{` / 125 `catch` rien que dans `app-cuisine.js`) : chaque accès à `localStorage`, `history.pushState`, parsing JSON, ou API navigateur optionnelle (vibration, audio, dictée vocale) est enveloppé individuellement, souvent avec un fallback silencieux (`catch(e){}`). C'est nécessaire car l'app tourne offline, sur des navigateurs tablette hétérogènes (Chrome Android, Safari iOS, Samsung Internet), et une exception non rattrapée bloque toute la SPA (pas de router qui isole les erreurs). Ne pas retirer ces `try/catch` sous prétexte de « code plus propre ».
   - Attention : ce style produit aussi des échecs avalés silencieusement qui masquent de vrais bugs (voir ex. `superadmin.html` fallback couleur ci-dessous — l'ancien exemple `app-signup.js:302` a été corrigé, voir Audit Bugs §6) — ne pas ajouter de nouveaux `catch` vides sans au moins un `console.warn`.

4. **Modifications minimales, jamais de réécriture large.**
   - Aucun test automatisé, aucun typage, aucun CI. La seule protection contre les régressions est la revue manuelle du diff. Un correctif doit toucher le minimum de lignes nécessaires — ne pas « profiter » d'un correctif pour refactoriser une fonction adjacente, renommer des variables, ou réorganiser un fichier.
   - Respecter l'ordre de chargement des scripts (voir plus bas) — aucun bundler ne le vérifie, une erreur d'ordre casse la page sans message clair.
   - Le `localStorage` est la source de vérité offline (`S`, clé `haccp_v6`) ; toute modification doit rester compatible avec des données existantes déjà stockées chez des utilisateurs réels (pas de migration destructive sans garde de version).

---

## Architecture

### No Framework — Page-Per-App Pattern

Each HTML page is a self-contained SPA with its own JS module loaded via `<script src>`. There is no bundler, no module system, no shared component library.

| Page | JS Module | Purpose |
|------|-----------|---------|
| `cuisine.html` | `app-cuisine.js` + `app-menu-cuisine.js` | Kitchen tablet — HACCP record entry |
| `dashboard.html` | `app-dashboard.js` + `app-menu-dashboard.js` | Admin supervision & reporting (also embeds a legacy superadmin view, see below) |
| `superadmin.html` | inline `<script>` in the page | Standalone superadmin console (tenants, sites, users, subscriptions) |
| `pms-setup.html` | `app-pms.js` | Sanitary control plan (PMS) generation |
| `onboarding.html` | `app-onboarding.js` | Tenant/site setup wizard |
| `login.html` / `signup.html` | `app-login.js` / `app-signup.js` | Auth flows |
| `paywall.html` | inline `<script>` | Subscription paywall / Stripe Checkout entry point |
| `reset-password.html` | inline `<script>` | Password reset flow |
| `mentions-legales.html`, `cgu.html`, `politique-confidentialite.html` | static | Legal pages |
| `faq/index.html`, `guides/*.html` | static | SEO/support content |
| `index.html`, `landing.html` | static | Public marketing pages |

There are **three separate, inconsistent tenant-creation code paths** (see Audit §Bugs 6) — be aware when touching signup/onboarding that `app-signup.js`, `app-login.js`, and `app-onboarding.js` each independently call into tenant/profile creation.

### Global State Pattern

Every app page uses a single global object `S` backed by `localStorage`:

```js
const SK = 'haccp_v6';
let S = JSON.parse(localStorage.getItem(SK) || '{}');

// After any mutation:
save(); // persists to localStorage + debounces cloud sync (10 sec)
```

`save()` in `app-cuisine.js` (`js/app-cuisine.js:29`) handles `QuotaExceededError` by async-compressing embedded base64 photos. Always call `save()` after mutating `S`.

### Offline-First Sync (`supabaseservice.js`)

Records are never written directly to Supabase. They go through a local queue:

```
User action → enqueue(record) → scheduleFlush() → [10 sec debounce] → POST to Supabase REST API
```

- Queue key: `haccp_supa_queue_v1` in localStorage
- Force flush: `supaFlushNow()`
- Records use `_uuid` (via `stampEntry()`) for server-side deduplication (`ON CONFLICT DO NOTHING`)
- Photos are compressed async then uploaded to Supabase Storage separately, to the `pms-photos` bucket (⚠️ this bucket is currently **public**, see Audit §Sécurité 2)

### Authentication (`authguard.js`)

Every protected page calls `runAuthGuard({ sessionKey, onSuccess })` before rendering. The guard:
1. Reads JWT from `localStorage` (key: `haccp_supa_cfg_v1` — the canonical session key)
2. Decodes expiry without a library
3. Refreshes silently 5 min before expiry via `POST /auth/v1/token?grant_type=refresh_token`
4. Redirects to `login.html` on failure

**Session key hierarchy:** `haccp_supa_cfg_v1` (canonical) ← migrated from legacy `haccpro_supa_cfg`. Never use the legacy key for new code.

`js/subscriptionguard.js` runs after `authguard.js` on `cuisine.html`/`dashboard.html` and enforces the subscription paywall — see Audit §Sécurité 4 for its known fail-open design.

### Script Load Order (required)

Pages must load scripts in this order (no module bundler enforces this):
1. `supabaseconfig.js` — defines `SUPABASE_URL`, `SUPABASE_ANON_KEY`
2. `authguard.js` — depends on supabaseconfig globals
3. `utils.js` — shared helpers (`escH`, `newUUID`, `stampEntry`, `fmtDateFr`, `today`, `nowT`, `nowDT`)
4. `subscriptionguard.js` — paywall check (protected pages only)
5. `supabaseservice.js` — depends on supabaseconfig + utils
6. `app-*.js` — page-specific app logic

`escH()` (`js/utils.js:9`) is the only sanctioned HTML-escaping helper and correctly escapes `& < > " '`. Any DOM injection of DB-sourced text (names, colors, labels) **must** go through it — several call sites currently don't (see Audit §Sécurité 3).

### Netlify Functions (`netlify/functions/`)

All functions receive `Authorization: Bearer <JWT>` from the client and validate it against Supabase.

| Function | Trigger | Key behavior |
|----------|---------|-------------|
| `signup-setup.js` | POST `/signup-setup` | Creates tenant/profile/subscription (no site) using service role |
| `provision-tenant.js` | called from `app-onboarding.js` | Idempotent — creates/reuses tenant, creates site, upserts profile with plan-based role |
| `send-email.js` | POST `/send-email` | Sends transactional emails via Resend |
| `haccp-hub.mjs` | GET/POST/DELETE `/haccp-hub` | Alert hub CRUD (dashboard → tablet one-way alerts + ack) |
| `admin-proxy.js` | POST `/admin-proxy` | Proxied queries using the Supabase **service role** key — ⚠️ allowed for `super_admin`, `siege`, AND `directeur`, with no tenant/site filtering (see Audit §Sécurité 1) |
| `superadmin-login.js` | POST | Superadmin auth |
| `stripe-checkout.js` / `stripe-portal.js` / `stripe-webhook.js` | Stripe integration | Checkout session, billing portal, webhook → writes `subscriptions.status` |
| `contact.js` | POST `/contact` | Public contact form → Resend |

### Database (Supabase / PostgreSQL)

Schemas in `netlify/sql/`:
- `schema.sql` — core tables: `tenants`, `territories`, `sectors`, `sites`, `profiles`, `subscriptions`, `pms_records`, `pms_config`, `gmo`, `alert_hub`, `photos_storage`, `storage.buckets`/`storage.objects` policies
- `fix-pms-records-rls-site-id.sql` — a standalone RLS tightening patch for `pms_records` INSERT, **not merged into `schema.sql`** — its actual applied state in the live DB cannot be verified from the repo alone
- `menu_feature.sql` — `menu`, `menu_dishes`, `menu_variants`
- `corrective_actions.sql` — corrective action records, actively used (see Audit §Fonctionnalités 6)
- `stripe-migration.sql` — subscription/Stripe columns

**Tenant isolation:** All tables have RLS policies filtering by `site_id` or `tenant_id` extracted from the JWT. Never bypass RLS in client code. **`netlify/functions/admin-proxy.js` bypasses RLS server-side with the service role key and is currently under-restricted — see Audit §Sécurité 1 before touching it.**

**Role hierarchy:** `super_admin` > `siege` (HQ) > `directeur` > `chef_secteur` > `cuisinier` — stored in `profiles.role`.

**Column-naming pitfall (live bug, see Audit §Bugs 7):** `sites` table has a `name` column, but several `superadmin.html` queries request `nom` and `tenants`/`sites` `.color` (PostgREST 400s silently swallowed by `.catch()`). The real columns are `sites.name` and `tenants.primary_color`. Check `schema.sql` column names before writing new queries against these tables — don't assume the French/English naming matches what other buggy call sites use.

## HACCP Domain Concepts

### ENR Records (Enregistrements)

The core data model. ENR01–ENR36+ are numbered regulatory forms:
- **ENR01** — Cooling (refroidissement) — has a real history view, `renderENR01Histo()` (`js/app-cuisine.js:3163`)
- **ENR03/07** — Temperature monitoring
- **ENR08** — Reception / raw product (BF Cru)
- **ENR14/15/16** — Legacy distribution fiches (plateaux/SAM/Self), kept for backward compatibility alongside the newer unified per-service distribution system (`enr_distrib_{svcId}`, `js/app-cuisine.js:7031-7130`)
- **ENR19** — Cold storage (enceintes) temperature — stored generically in `pms_records` with `enr_type='enr19'`, no dedicated table
- **ENR20** — Cold storage, "canicule" (heatwave) mode — real toggle, see Audit §Fonctionnalités 3
- **ENR23** — Frozen liaison
- **ENR30** — Corrective actions / NC (non-conformité) register
- **ENR33** — Witness plate sampling (plat témoin) — each dish requires one
- **ENR34** — Labeling (étiquette)
- **ENR36** — Excédents (leftovers)

Each ENR line is stamped with `_uuid`, `_created`, `_ts`, and optionally linked to a menu dish via `_plat_id`, `_menu_id`, `_plat_nom`, `_plat_profil`.

### HACCP Dish Profiles (Auto-detected from name)

| Profile | Code | Trigger keywords |
|---------|------|-----------------|
| Cooked prep | `BF_CUIT` | bourguignon, saumon, soupe, gratin, carottes braisées/Vichy |
| Raw prep | `BF_CRU` | salade, tomate, concombre, carotte (without cooking modifier) |
| Reheated | `REMISE_TC` | surgelé, raviolis en boîte |
| Direct service | `SORTIE_DIRECTE` | yaourt, fruit, camembert |
| Made-to-order | `PREPARE_MINUTE` | sandwich, wrap, croque |

Tap the profile badge in the UI to cycle between profiles if auto-detection is wrong. Profile determines which ENR records are required for traceability.

### Traceability Engine (`tracabilite.js`)

Links all ENR records to a dish to reconstruct a complete HACCP timeline (reception → cooking → cooling → distribution → witness plate). Uses `_plat_id` UUID linking across ENR types, with time-window heuristics for auto-suggestions. Learned patterns are stored in `haccp_patterns_v1` and `haccp_lifecycle_v1` in localStorage.

### Menu System (`app-menu-cuisine.js`)

Daily menus are organized by category: potages, entrées, plats, garnitures, fromages, desserts, pains. Each dish can have variants (Mixé, Sans sel, HP). "Générer plats témoins" auto-creates ENR33 entries for every dish + checked variants. "Imprimer étiquettes" opens a printable A4 label sheet. Menu history is stored in `S.menu_history` and synced to Supabase.

**Note:** the menu system (`app-menu-cuisine.js`/`app-menu-dashboard.js`) and the PMS generator (`app-pms.js`/`pms-setup.html`) are **completely disjoint** — see Audit §Fonctionnalités 8.

### Non-conformité (NC) / Corrective Actions Workflow

`autoCreateNC()` (`js/app-cuisine.js:2639`) is called from ~10 sites across the ENR forms (ENR19/20/21/28/30/36, distribution, nettoyage) whenever a reading is out of spec. It only shows a `toast()` — it does **not** trigger `appBeep()`/`appVibrate()` (see Audit §Bugs 5). NCs are then resolved through a catalog of corrective actions loaded from the `corrective_actions`/`nc_action_mapping` SQL tables, assigned via `S.corrective_actions_catalog`, and closed via `nc30cf()` (`js/app-cuisine.js:5354`). Dashboard side: `renderNC()` (`js/app-dashboard.js:5650`).

### Voice Dictation

Supported on Chrome (Android/Desktop), Edge, Samsung Internet. Each category has its own mic button. Parser uses all keyword positions as delimiters (max 80 chars/dish). Not supported on Firefox; partial on Safari iOS.

## Key localStorage Keys

| Key | Contents |
|-----|---------|
| `haccp_v6` | Global app state `S` (cuisine page) |
| `haccp_supa_cfg_v1` | Auth session: JWT, refresh token, siteId, role, tenantId |
| `haccp_supa_queue_v1` | Offline sync queue (array of pending records) |
| `haccp_patterns_v1` | Learned dish-to-ENR linking patterns |
| `haccp_lifecycle_v1` | Dish HACCP timeline history |
| `haccp_sub_cache_v1` (name approx., see `subscriptionguard.js`) | 1h cache of subscription check result — client-controlled, part of the paywall fail-open design |

## PWA / Service Worker (`sw.js`)

Cache-first strategy for all JS/CSS assets. Network-first for API calls. `CACHE_NAME`/`CDN_CACHE_NAME` currently `'haccpro-v388'`/`'haccpro-cdn-v388'` (`sw.js:11-12`). After deploying, users must clear full browser cache (cookies + cache + site data) or the SW will serve stale assets. The SW version is bumped manually in `sw.js` to force cache invalidation.

---

## 📋 État de l'audit (vérifié dans le code réel — juillet 2026)

Chaque point a été vérifié directement dans le code (fichier + ligne), pas supposé. Statuts : **FAIT** / **PARTIEL** / **À FAIRE**.

### Bugs

1. **RLS 403 sur enr19 — À FAIRE (non confirmé)**
   `enr19` n'est pas une table dédiée : c'est `pms_records` avec `enr_type='enr19'` (`js/supabaseservice.js:330-334,390`). Les policies RLS de `pms_records` (`netlify/sql/schema.sql:347-395`, `netlify/sql/fix-pms-records-rls-site-id.sql`) sont génériques à tous les `enr_type` — rien ne cible `enr19` spécifiquement, aucun TODO/workaround trouvé. Un indice périphérique existe : `resyncEnr19()` (`js/app-cuisine.js:3686-3705`) permet de "resynchroniser les températures vers le cloud" pour des relevés faits "via le widget accueil avant la v10" — ça sent un bug de queue non vidée historique, pas un 403 RLS. `fix-pms-records-rls-site-id.sql` n'est pas fusionné dans `schema.sql`, donc son application réelle en base n'est pas vérifiable depuis le repo seul. **Aucune preuve d'un 403 actif** — à reproduire/tracer en prod avant de coder un correctif.

2. **Pages `tarifs.html` / `account.html` — n'existent pas dans le repo (constat, pas un bug de lien cassé)**
   `find` ne trouve ni l'un ni l'autre. Toutes les occurrences de "tarifs" sont des ancres `#pricing` (`index.html`, `landing.html`, `mode-emploi.html`). La gestion de compte/abonnement vit dans `dashboard.html` (`js/app-dashboard.js:9879-9906`, bloc "Mon abonnement"/"Mon compte"), et le paywall est `paywall.html`, piloté par `js/subscriptionguard.js:70`. Aucun lien mort trouvé vers ces deux noms de fichiers.

3. **Export Excel vide — PARTIEL (bug réel identifié)**
   `doExportXLSX()` (`js/app-cuisine.js:13501`, via SheetJS). Le garde-fou initial (`:13516-13519`) teste s'il existe des données **toutes périodes confondues**, mais le remplissage réel des feuilles filtre ensuite par période sélectionnée via `_pFilter` (`:13802-13803`). Si la période active (par défaut le mois courant) ne contient aucune saisie alors que des données existent ailleurs, l'export démarre mais produit un classeur quasi vide (seule la feuille "Tableau de bord" à zéro), sans message d'erreur. *(Aucun export Excel équivalent n'existe côté `app-dashboard.js`/`app-menu-dashboard.js` — seul `exportAlertResponses()` en CSV y existe et fonctionne.)*

4. **Widget Midi — FAIT**
   Catalogue dans `wgGetCatalog()` (`js/app-cuisine.js:16072`), rendu par `_wgRenderOne()` (`:16287-16369`), versionné par `WG_VER=5` avec migration/dédoublonnage automatique (`wgGet()`, `:16095-16129`). Historique git montre des correctifs déjà mergés (`22894a4`, `528b3d7`, `1f1ecda`). Aucun bug ouvert identifié.

5. **Alertes audio NC — PARTIEL**
   `appBeep()` (`js/app-cuisine.js:1444-1461`) est fonctionnel et respecte le toggle `S.config.soundOn`. Mais il n'est câblé qu'à 2 cas de dépassement de minuterie CCP (`:14381`, `:14605`) — **pas** à `autoCreateNC()` (`:2639`), qui est le point central de création de NC appelé à ~10 endroits (ENR19/20/21/28/30/36, distribution, nettoyage) et ne fait qu'un `toast()` (`:2678`). La grande majorité des NC créées (température hors seuil, réception, nettoyage, nuisibles) ne déclenchent **aucune** alerte sonore.

6. **Onboarding wizard vs `provision-tenant.js` — FAIT (corrigé)**
   Trois chemins de création tenant/profil coexistaient, désormais unifiés :
   - `js/app-login.js:257` (`_completeSignupSetup`) → `signup-setup.js` (tenant + profil, sans site) — inchangé.
   - `js/app-onboarding.js:589` (`generatePMS`) → `provision-tenant.js` (idempotent, crée le site, upsert du profil selon le plan) — inchangé, reste le chemin final commun.
   - `js/app-signup.js` : l'ancienne insertion cliente directe sur `/rest/v1/tenants` (bloquée par la RLS `tenants_admin_write`, échec avalé, rôle `'directeur'` codé en dur) a été **remplacée par un appel à `/.netlify/functions/signup-setup`** — la même fonction service_role qu'`app-login.js`, qui assigne le rôle selon le plan (`solo→cuisinier`, sinon `→siege`) au lieu de `'directeur'` en dur.
   - `js/app-login.js:83` : la condition de déclenchement de la finalisation de compte teste désormais `!profile || !profile.tenant_id` (au lieu de `!profile` seul), pour couvrir le profil orphelin créé par le trigger `handle_new_user()` (`role='cuisinier'`, `tenant_id=NULL`, `schema.sql:482-497`). Si aucune donnée d'inscription n'est en attente en `localStorage` (autre appareil, cache vidé), l'utilisateur est redirigé vers `onboarding.html` (qui dégrade proprement sur des champs vides) au lieu d'atterrir sur `cuisine.html`/`dashboard.html` avec un `tenantId`/`siteId` vides.
   Les deux chemins convergent maintenant vers `onboarding.html` → `provision-tenant.js`, qui applique déjà correctement la règle produit (`app-onboarding.js:785-787`) : plan solo → rôle `cuisinier` + `cuisine.html` ; plan multi/entreprise → rôle `siege` + `dashboard.html`.

7. **Dashboard superadmin — PARTIEL**
   - **Color pickers** : présents et câblés (`superadmin.html:797,941`) mais écrivent sur des colonnes **inexistantes** (`tenants.color`, `sites.color` — le schéma définit `tenants.primary_color` et pas de colonne couleur sur `sites`, `schema.sql:29,64-73`). Un fallback masque l'échec PostgREST et affiche quand même "Entreprise mise à jour ✓". `js/branding.js:17,28` lit `primary_color`, donc même en cas de succès la couleur ne serait jamais utilisée pour le thème réel.
   - **site_id** : la liaison `profiles.site_id → sites.id` fonctionne, mais les requêtes de résolution de nom utilisent `select=id,nom` alors que la colonne réelle est `sites.name` (`superadmin.html:584,727,883-884` vs `schema.sql:68`). Erreurs PostgREST avalées par `.catch(()=>[])` → colonne "Site" toujours à `—`, menu déroulant d'assignation de site toujours vide dans le modal d'ajout d'utilisateur.
   - **Statut abonnement** : correctement branché, cohérent avec `stripe-webhook.js:141,163,173,180,191-194`. Seule lacune (pas un bug) : pas d'action superadmin pour forcer manuellement un statut, seulement `extendTrial()` (`superadmin.html:1248-1275`).

8. **Branding "Restalliance" en dur — À FAIRE**
   Seule occurrence dans tout le repo : `js/app-dashboard.js:8889-8914`, vue superadmin **legacy** dupliquée dans `dashboard.html` (`renderSuperAdmin()`, distincte de `superadmin.html`). L'identifiant technique `co_restalliance` (variable `restalliance`) est utilisé comme tenant de secours quand Supabase ne renvoie rien — résidu client réel codé en dur, à généraliser (`co_default` ou UUID) et idéalement à fusionner avec `superadmin.html`.

9. **Mur post-inscription (paywall) — FAIT, avec réserve connue**
   `js/subscriptionguard.js` chargé après `authguard.js` sur `cuisine.html:33`/`dashboard.html:29`, redirige vers `paywall.html?reason=...` si `checkStatus()` (`:73-84`) refuse. Mécanisme complet et fonctionnel côté UI, mais **volontairement fail-open** (pas de tenantId/token → passe, pas de ligne subscriptions → passe, erreur réseau → passe, `:107,122-126,140-143`) — cohérent avec l'offline-first mais voir Audit §Sécurité 4 pour l'absence de filet serveur.

### Sécurité

1. **Isolation multi-tenant du proxy admin — FAIT (corrigé)**
   `netlify/functions/admin-proxy.js` autorise toujours `ALLOWED_ROLES = ['super_admin','siege','directeur']` (`:24`, `/auth/v1/admin/users` reste accessible aux 3 rôles — nécessaire à `createUser()`/`createTabletAccount()`, pas de colonne tenant à cloisonner côté Supabase Auth Admin API). Mais pour toute table cloisonnée (`profiles`, `sites`, `sectors`, `territories`, `subscriptions`, `pms_records`, `gmo`, `tenants`), le proxy force désormais côté serveur la colonne de cloisonnement (`tenant_id`, ou `id` pour `tenants`) à la valeur réelle du JWT de l'appelant — en lecture (query string réécrite) et en écriture (body, y compris insert groupé) — quel que soit ce que le client envoie. La création de nouveaux tenants (POST `/rest/v1/tenants`) est bloquée pour `siege`/`directeur`, cohérent avec la RLS `tenants_admin_write` existante. `super_admin` conserve un accès global inchangé. `corrective_actions`/`nc_action_mapping` restent hors cloisonnement (catalogues globaux, déjà protégés par leur propre RLS).

2. **Bucket `pms-photos` public — FAIT (corrigé)**
   `netlify/sql/schema.sql` déclare maintenant le bucket `public = false` avec une policy de lecture `to authenticated` uniquement (`fix-pms-photos-private.sql` pour les bases déjà déployées). Les points d'upload (`js/supabaseservice.js:_uploadToStorage`, `js/app-cuisine.js`, `js/app-dashboard.js:sendTabletAlert`, `netlify/functions/haccp-hub.mjs:uploadToStorage`) stockent désormais le chemin de stockage brut au lieu d'une URL publique. L'affichage passe par `SupaEngine.getSignedPhotoUrl()` (nouveau, `js/supabaseservice.js`), qui génère une URL signée temporaire à la demande et reconnaît aussi bien le nouveau format (chemin brut) que l'ancien (URL publique historique déjà stockée en base) — les photos synchronisées avant la migration restent donc affichables. Tous les points de rendu existants (galeries alertes, détail NC, lightbox, photo ENR30) ont été basculés sur ce mécanisme.

3. **XSS noms admin — FAIT (corrigé aux emplacements identifiés)**
   - `superadmin.html:505` — `co.color` et `initials` passent maintenant par `_esc()`.
   - `_esc()` local (`superadmin.html:1031-1033`) échappe désormais aussi l'apostrophe, aligné sur `escH()` de `js/utils.js:9` — corrige la XSS stockée exploitable via `co.name` dans l'attribut `onclick` de `viewTenantData()` (`:511`).
   - `js/app-dashboard.js` (anciennement lignes 901,906,936,949,951,1034,1042,1054) — toutes les options de `<select>` (territoires/secteurs/sites) passent désormais par `escH()`.
   *(Périmètre limité aux emplacements identifiés par l'audit — pas une revue XSS exhaustive de tout le repo.)*

4. **Paywall contournable via `localStorage` — FAIT (filet serveur ajouté)**
   `js/subscriptionguard.js` reste un contrôle client fail-open par conception pour les cas offline-first (pas de tenantId/token, pas de ligne subscriptions, erreur réseau — inchangé, assumé). Nouveau : `public.tenant_subscription_active(tenant_id)` (`schema.sql`, section 8 — helpers RLS) est maintenant exigée par les policies `pms_records_insert`/`pms_records_update` (`schema.sql:392-427`, `fix-paywall-rls-subscription.sql` pour les bases déjà déployées) — un tenant dont l'abonnement n'est plus `active`/`trial` valide ne peut plus écrire de nouvelles données HACCP via l'API Supabase REST directe, même avec un JWT valide contournant l'UI du paywall (`super_admin` exempté). Le filet ne couvre que `pms_records` (le point d'écriture central des saisies) — pas les autres tables ; fail-open uniquement si aucune ligne `subscriptions` n'existe pour le tenant (onboarding non terminé), pas sur un statut expiré/annulé connu.

### Légal

1. **Mentions légales complètes — À FAIRE**
   `mentions-legales.html` (72 lignes) : **SIRET/SIREN absent**, **adresse postale de l'éditeur absente**, **directeur de publication absent**, **forme juridique/capital social absents** (`:48`, "Raison sociale : HACC.PRO" seul). Hébergeur **présent et correct** (`:54`, Netlify + Supabase). Contact **présent** (`contact@hacc.pro`, `:49,60,69`). Aucun placeholder visible type "[À compléter]" — les champs sont simplement absents, ce qui ne satisfait pas l'art. 6-III LCEN.

2. **Rétention 30 jours vs 5 ans — PARTIEL**
   Pas de contradiction textuelle directe "30 jours" vs "5 ans" entre `cgu.html:79` et `politique-confidentialite.html:110,215` — les deux s'accordent sur **30 jours** après résiliation pour les données HACCP métier (facturation → 10 ans, analytics → 2 ans, exceptions cohérentes). **Incohérence réelle trouvée ailleurs** : `faq/index.html:485` affirme que HACC.PRO "archive automatiquement toutes les données pendant au moins **3 ans**", ce qui contredit frontalement la suppression à 30 jours des CGU/Polconf. Par ailleurs, **aucun des deux documents légaux ne mentionne la durée réglementaire de conservation des registres HACCP** (les propres guides du site citent 5 ans pour les produits secs, `guides/tracabilite-alimentaire.html:47,285,352`) ni comment l'utilisateur doit archiver ses données avant suppression à J+30 pour rester conforme à ses propres obligations.

3. **DPA — À FAIRE**
   Aucun document DPA/accord de sous-traitance dans le repo, ni en pièce jointe ni en lien référencé. `politique-confidentialite.html:143-173` liste bien les sous-traitants (Supabase, Netlify, Stripe, Resend) et affirme ligne 175 que "des contrats de sous-traitance conformes au RGPD sont conclus" — mais c'est une déclaration non sourcée, aucun document n'est produit ni accessible.

### Fonctionnalités

1. **Purge guidée — PARTIEL**
   Fonctionnalité réelle (export JSON conforme CE 178/2002, purge miniatures >6 mois, alerte proactive `purgeCheckAlerte()` `:15687`) mais **pas un wizard séquencé** : panneau de 4 boutons indépendants (`purgeCheckStatus()` `:15600`, `purgeExportJSON()` `:15628`, `purgeMiniatures()` `:15658`, + `resetCompleteLocal()` séparé), actionnables dans n'importe quel ordre.

2. **Fiche température distribution unifiée — FAIT** (avec coexistence legacy)
   Système unifié réel et paramétrable par service (`enr_distrib_{svcId}`, `js/app-cuisine.js:7031-7130`, `getDistribServices()` `:6727`). Les anciennes fiches ENR14/15/16 restent en parallèle pour rétro-compatibilité (`:3442-3459`, `:8644`).

3. **Toggle canicule — FAIT**
   Toggle réel des deux côtés : dashboard (`toggleCanicule()` `js/app-dashboard.js:1285`, bulk `setCaniculeBulk()` `:1248`) et cuisine (`caniculeActive()` `js/app-cuisine.js:3662`, poll 10 min `checkCaniculeMode()` `:3664`), avec bascule UI réelle 2↔3 relevés obligatoires (`renderENR20()` `:3971-4046`) et NC auto si hors seuil.

4. **Messagerie tablette — PARTIEL**
   Pas de chat libre bidirectionnel. Système d'alertes broadcast à sens unique avec accusé de réception structuré : `haccp-hub.mjs` (types `ALERT`/`ACK`, `:280-698`) pousse une alerte, la tablette répond via boutons prédéfinis (`showTabletRecallModal`, `js/app-cuisine.js:354-385`) + `acknowledgeTabletAlert()` (`:152`).

5. **Historique refroidissement (ENR01) — FAIT**
   `renderENR01Histo()` (`js/app-cuisine.js:3163-3188`) affiche l'historique complet trié/groupé avec badges de statut et de liaison traçabilité. Côté dashboard, filtrable via `renderSaisies()`/`_setEnrFilter()` (`js/app-dashboard.js:5083,5157`).

6. **Workflow NC / actions correctives — FAIT**
   Bout en bout, pas un schéma mort : création auto (`autoCreateNC()` `:2639`), catalogue chargé depuis `corrective_actions`/`nc_action_mapping` SQL, assignation (`:2308-2309,5374-5378`), clôture (`nc30cf()` `:5354`). Dashboard : gestion catalogue (`loadAdminCorrectiveData()` `js/app-dashboard.js:2005`) + vue filtrable (`renderNC()` `:5650-5739`).

7. **Import Excel/CSV utilisateurs — À FAIRE (absent)**
   Aucune fonction `importUsers`/`importCsv`/`importExcel` n'existe. Les seuls `FileReader` du dashboard/onboarding servent à des aperçus d'image (logo, photo d'alerte). Aucune fonction Netlify d'import en masse. Création de comptes uniquement un par un via formulaire (`js/app-dashboard.js:3386`).

8. **Menus PMS dashboard — À FAIRE (systèmes disjoints)**
   Zéro résultat pour "menu" dans `app-pms.js`/`pms-setup.html`, et zéro lien fonctionnel réciproque (seule mention isolée de `pms_records` comme source de données générique, `js/app-menu-dashboard.js:14`). Le système de menus et la génération PMS sont deux systèmes complètement séparés.

---

## 🎯 Chantiers restants, classés par priorité

**✅ Corrigés (ex-P0 Sécurité + P1 §5 inscription) :**
1. ~~Isolation multi-tenant `admin-proxy.js`~~ — cloisonnement serveur par `tenant_id` pour `siege`/`directeur` (Audit Sécurité §1).
2. ~~Bucket `pms-photos` public~~ — bucket privé + URLs signées (Audit Sécurité §2).
3. ~~XSS `superadmin.html`/`app-dashboard.js`~~ — corrigées aux emplacements identifiés par l'audit (Audit Sécurité §3, pas une revue exhaustive).
4. ~~Paywall sans filet serveur~~ — RLS `tenant_subscription_active()` sur `pms_records` insert/update (Audit Sécurité §4, périmètre limité à cette table).
5. ~~3 chemins de création tenant incohérents~~ — unifiés sur `signup-setup.js`/`provision-tenant.js` (Audit Bugs §6).

**P0 — Sécurité résiduelle :**
- Le filet paywall (point 4 ci-dessus) ne couvre que `pms_records` — évaluer si d'autres tables écrites directement par le client (`sites.config`, `pms_config`) doivent aussi être cloisonnées par abonnement.
- Le fallback "dev local" de `_completeSignupSetup()` dans `app-login.js` (insert direct `/rest/v1/tenants` si le proxy Netlify Functions est indisponible) a la même faiblesse RLS que l'ancien code d'`app-signup.js` — sans impact en production (Netlify Functions toujours disponibles), à surveiller si ce fallback est un jour exercé en prod.

**P1 — Bugs qui cassent des parcours utilisateurs réels :**
6. Corriger les color pickers et la résolution de nom de site dans `superadmin.html` (colonnes `color`/`nom` inexistantes vs `primary_color`/`name` réelles) — actuellement un no-op silencieux qui affiche un faux succès (Audit Bugs §7).
7. Câbler `appBeep()`/vibration sur `autoCreateNC()` pour toutes les NC, pas seulement les 2 cas de dépassement de minuterie (Audit Bugs §5).
8. Corriger le garde-fou de `doExportXLSX()` pour qu'il vérifie les données de la période sélectionnée, pas "toutes périodes confondues" (Audit Bugs §3).
9. Retirer l'identifiant en dur `co_restalliance` de la vue superadmin legacy dans `app-dashboard.js:8889-8914` (Audit Bugs §8).
10. Investiguer/reproduire le 403 RLS sur enr19 en prod (non reproductible depuis le code seul) — vérifier si `fix-pms-records-rls-site-id.sql` est réellement appliqué en base (Audit Bugs §1).

**P2 — Conformité légale (risque juridique, pas de deadline technique) :**
11. Compléter `mentions-legales.html` : SIRET, adresse, directeur de publication, forme juridique/capital (Audit Légal §1).
12. Résoudre l'incohérence 30 jours (CGU/Polconf) vs 3 ans (FAQ) sur la rétention des données, et documenter la durée réglementaire de conservation HACCP + le parcours d'export avant suppression (Audit Légal §2).
13. Rédiger et publier un DPA réel, référencé depuis la politique de confidentialité (Audit Légal §3).

**P3 — Fonctionnalités incomplètes ou manquantes (roadmap produit) :**
14. Import Excel/CSV en masse des utilisateurs (absent, Audit Fonctionnalités §7).
15. Intégration menus ↔ PMS dashboard (actuellement disjoints, Audit Fonctionnalités §8).
16. Purge guidée sous forme de wizard séquencé plutôt que boutons indépendants (Audit Fonctionnalités §1).
17. Vraie messagerie bidirectionnelle tablette ↔ dashboard, au-delà du système d'alertes à sens unique actuel (Audit Fonctionnalités §4).

## 📦 Migrations SQL à appliquer en production (après ce correctif)

Ces fichiers doivent être exécutés dans Supabase SQL Editor sur la base de prod existante (schema.sql seul ne suffit pas — il ne s'auto-applique pas) :
1. `netlify/sql/fix-pms-photos-private.sql` — bucket `pms-photos` privé.
2. `netlify/sql/fix-paywall-rls-subscription.sql` — filet RLS paywall sur `pms_records`.
3. Si `netlify/sql/fix-pms-records-rls-site-id.sql` a déjà été appliqué sur cette base, le ré-exécuter après le point 2 (il recrée `pms_records_insert` et inclut désormais aussi le filet paywall).
