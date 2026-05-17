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
- `RESEND_API_KEY`

**Deployment:** Push to git → Netlify auto-deploys. No CI pipeline. To test on a tablet, clear browser cache fully (cookies + cache + site data) after each deploy.

## Architecture

### No Framework — Page-Per-App Pattern

Each HTML page is a self-contained SPA with its own JS module loaded via `<script src>`. There is no bundler, no module system, no shared component library.

| Page | JS Module | Purpose |
|------|-----------|---------|
| `cuisine.html` | `app-cuisine.js` + `app-menu-cuisine.js` | Kitchen tablet — HACCP record entry |
| `dashboard.html` | `app-dashboard.js` + `app-menu-dashboard.js` | Admin supervision & reporting |
| `pms-setup.html` | `app-pms.js` | Sanitary control plan (PMS) generation |
| `onboarding.html` | `app-onboarding.js` | Tenant/site setup wizard |
| `login.html` / `signup.html` | `app-login.js` / `app-signup.js` | Auth flows |

### Global State Pattern

Every app page uses a single global object `S` backed by `localStorage`:

```js
const SK = 'haccp_v6';
let S = JSON.parse(localStorage.getItem(SK) || '{}');

// After any mutation:
save(); // persists to localStorage + debounces cloud sync (10 sec)
```

`save()` in `app-cuisine.js` handles `QuotaExceededError` by async-compressing embedded base64 photos. Always call `save()` after mutating `S`.

### Offline-First Sync (`supabaseservice.js`)

Records are never written directly to Supabase. They go through a local queue:

```
User action → enqueue(record) → scheduleFlush() → [10 sec debounce] → POST to Supabase REST API
```

- Queue key: `haccp_supa_queue_v1` in localStorage
- Force flush: `supaFlushNow()`
- Records use `_uuid` (via `stampEntry()`) for server-side deduplication (`ON CONFLICT DO NOTHING`)
- Photos are compressed async then uploaded to Supabase Storage separately

### Authentication (`authguard.js`)

Every protected page calls `runAuthGuard({ sessionKey, onSuccess })` before rendering. The guard:
1. Reads JWT from `localStorage` (key: `haccp_supa_cfg_v1` — the canonical session key)
2. Decodes expiry without a library
3. Refreshes silently 5 min before expiry via `POST /auth/v1/token?grant_type=refresh_token`
4. Redirects to `login.html` on failure

**Session key hierarchy:** `haccp_supa_cfg_v1` (canonical) ← migrated from legacy `haccpro_supa_cfg`. Never use the legacy key for new code.

### Script Load Order (required)

Pages must load scripts in this order (no module bundler enforces this):
1. `supabaseconfig.js` — defines `SUPABASE_URL`, `SUPABASE_ANON_KEY`
2. `authguard.js` — depends on supabaseconfig globals
3. `utils.js` — shared helpers (`escH`, `newUUID`, `stampEntry`, `fmtDateFr`, `today`, `nowT`, `nowDT`)
4. `supabaseservice.js` — depends on supabaseconfig + utils
5. `app-*.js` — page-specific app logic

### Netlify Functions (`netlify/functions/`)

All functions receive `Authorization: Bearer <JWT>` from the client and validate it against Supabase.

| Function | Trigger | Key behavior |
|----------|---------|-------------|
| `signup-setup.js` | POST `/signup-setup` | Creates tenant/site/profile/subscription using service role |
| `send-email.js` | POST `/send-email` | Sends transactional emails via Resend |
| `haccp-hub.mjs` | GET/POST/DELETE `/haccp-hub` | Alert hub CRUD |
| `admin-proxy.js` | POST `/admin-proxy` | Superadmin-only proxied queries |
| `contact.js` | POST `/contact` | Public contact form → Resend |

### Database (Supabase / PostgreSQL)

Schemas in `netlify/sql/`:
- `schema.sql` — core tables: `tenants`, `territories`, `sectors`, `sites`, `profiles`, `subscriptions`, `pms_records`, `pms_config`, `gmo`, `alert_hub`, `photos_storage`
- `menu_feature.sql` — `menu`, `menu_dishes`, `menu_variants`
- `corrective_actions.sql` — corrective action records

**Tenant isolation:** All tables have RLS policies filtering by `site_id` or `tenant_id` extracted from the JWT. Never bypass RLS in client code.

**Role hierarchy:** `super_admin` > `siege` (HQ) > `directeur` > `chef_secteur` > `cuisinier` — stored in `profiles.role`.

## HACCP Domain Concepts

### ENR Records (Enregistrements)

The core data model. ENR01–ENR34 are numbered regulatory forms:
- **ENR01** — Cooling (refroidissement)
- **ENR03/07** — Temperature monitoring
- **ENR08** — Reception / raw product (BF Cru)
- **ENR23** — Frozen liaison
- **ENR33** — Witness plate sampling (plat témoin) — each dish requires one
- **ENR34** — Labeling (étiquette)

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

## PWA / Service Worker (`sw.js`)

Cache-first strategy for all JS/CSS assets. Network-first for API calls. After deploying, users must clear full browser cache (cookies + cache + site data) or the SW will serve stale assets. The SW version is bumped manually in `sw.js` to force cache invalidation.
