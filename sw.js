/**
 * sw.js — Service Worker HACCPro
 *
 * Stratégie : Cache-First pour les assets statiques (JS/CSS/HTML/images),
 * Network-First pour les appels API Supabase et Netlify Functions.
 *
 * Garantit que l'appli reste utilisable hors-ligne (formulaires ENR locaux)
 * même si le réseau tablette est instable.
 */

const CACHE_NAME = 'haccpro-v385';
const CDN_CACHE_NAME = 'haccpro-cdn-v385';

// Assets à mettre en cache dès l'installation
// ⚠ NE PAS pré-cacher les pages HTML : elles utilisent Network-First
//   pour toujours servir la version la plus récente.
const PRECACHE_ASSETS = [
  '/manifest.json',
  '/favicon.ico',
  '/favicon-32.png',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/css/login.css',
  '/css/cuisine.css',
  '/css/dashboard.css',
  '/css/landing.css',
  '/css/guide.css',
  '/js/utils.js',
  '/js/supabaseconfig.js',
  '/js/supabaseclientinit.js',
  '/js/authguard.js',
  '/js/supabaseservice.js',
  '/js/printservice.js',
  '/js/app-login.js',
  '/js/app-cuisine.js',
  '/js/app-dashboard.js',
  '/js/app-menu-cuisine.js',
  '/js/app-menu-dashboard.js',
  '/js/app-signup.js',
  '/js/app-onboarding.js',
  '/js/app-pms.js',
];

// Patterns à NE PAS mettre en cache (réseau uniquement)
const NETWORK_ONLY_PATTERNS = [
  /supabase\.co/,
  /\.netlify\/functions\//,
  /auth\/v1\//,
  /rest\/v1\//,
  /storage\/v1\//,
];

function isNetworkOnly(url) {
  return NETWORK_ONLY_PATTERNS.some((re) => re.test(url));
}


// CDN externes — mis en cache au premier chargement
const CDN_PATTERNS = [
  /cdn\.jsdelivr\.net/,
  /cdnjs\.cloudflare\.com/,
];

function isCDN(url) {
  return CDN_PATTERNS.some((re) => re.test(url));
}

// ── Installation : pré-cache des assets ──────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // On ne bloque pas l'install si un asset échoue (tablette hors-ligne)
      return Promise.allSettled(
        PRECACHE_ASSETS.map((url) =>
          cache.add(url).catch(() => { /* ignore */ })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ── Activation : nettoyage des anciens caches ─────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== CDN_CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch : Cache-First statique / Network-Only API ───────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // GET seulement — les POST/PATCH/DELETE passent toujours par le réseau
  if (request.method !== 'GET') return;

  const url = request.url;

  // Appels API : réseau uniquement, pas de fallback cache
  if (isNetworkOnly(url)) {
    event.respondWith(fetch(request));
    return;
  }

  // CDN externes : Cache-First (Supabase SDK, jszip, xlsx)
  if (isCDN(url)) {
    event.respondWith(
      caches.open(CDN_CACHE_NAME).then((cache) =>
        cache.match(request).then((cached) => {
          if (cached) return cached;
          return fetch(request).then((response) => {
            if (response && response.status === 200) {
              cache.put(request, response.clone());
            }
            return response;
          });
        })
      )
    );
    return;
  }

  // Pages HTML : Network-First (toujours la dernière version déployée)
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => {
        // Hors-ligne : fallback cache
        return caches.match(request).then((cached) => {
          if (cached) return cached;
          const u = new URL(request.url);
          if (u.pathname.includes('dashboard')) return caches.match('/dashboard.html');
          if (u.pathname.includes('cuisine'))   return caches.match('/cuisine.html');
          return caches.match('/landing.html');
        });
      })
    );
    return;
  }

  // Assets statiques (JS/CSS/images) : Cache-First avec fallback réseau
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});

// ── Message : forcer la mise à jour du cache ─────────────────
self.addEventListener('message', (event) => {
  if (event.data?.action === 'skipWaiting') {
    self.skipWaiting();
  }
});
