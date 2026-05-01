/**
 * supabaseClientInit.js — Initialisation du client SDK Supabase v2
 *
 * Initialise window._supaClient pour l'application Cuisine.
 * Ce client gère le rafraîchissement automatique du token JWT
 * via le SDK officiel Supabase, ce qui complète le mécanisme
 * de refresh manuel implémenté dans authGuard.js.
 *
 * Doit être chargé APRÈS le SDK Supabase (CDN) et supabaseConfig.js.
 * SUPABASE_URL et SUPABASE_ANON_KEY sont définis dans supabaseConfig.js.
 */

(function(){
  try {
    if (typeof supabase !== 'undefined' && supabase.createClient) {
      window._supaClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false
        }
      });
      window._supaClient.auth.onAuthStateChange(function(event, session) {
        if (event === 'TOKEN_REFRESHED' && session) {
          try {
            var cfg = JSON.parse(localStorage.getItem('haccp_supa_cfg_v1') || '{}');
            cfg.userToken = session.access_token;
            cfg.refreshToken = session.refresh_token;
            localStorage.setItem('haccp_supa_cfg_v1', JSON.stringify(cfg));
          } catch(e) {}
        }
      });
    }
  } catch(e) {
    console.warn('[HACCPro] Supabase SDK:', e.message);
  }
})();
