/**
   * authGuard.js — Garde de session partagée entre toutes les pages
   *
   * Vérifie qu'une session valide existe au chargement de la page.
   * Si le token JWT est expiré, tente un rafraîchissement automatique.
   * Redirige vers la page de connexion si la session est invalide.
   *
   * Dépend de : supabaseConfig.js (doit être chargé avant)
   *
   * Usage :
   *   authGuard({ sessionKey: 'haccpro_session', onSuccess: () => {} });
   */

  /**
   * Lance la garde de session.
   * @param {object} options
   * @param {string} options.sessionKey     - Clé localStorage de la session principale
   * @param {string} [options.stableKey]    - Clé localStorage de la session stable (fallback)
   * @param {string} [options.loginUrl]     - URL de redirection si session invalide (défaut: '/')
   * @param {Function} [options.onSuccess]  - Callback appelé si la session est valide
   */
  // Rafraîchissement de token PARTAGÉ et « single-flight » : une seule requête de
  // refresh à la fois, dont le résultat est réutilisé par tous les appelants
  // (authguard, supabaseservice, dashboard…). Les refresh_token Supabase tournent
  // (usage unique) : sans coordination, un 2e mécanisme réutilisait l'ancien token
  // déjà invalidé → échec → déconnexion intempestive. On propage aussi le nouveau
  // token à TOUTES les clés de session connues pour qu'aucun lecteur ne reste périmé.
  if (!window.__haccpSharedRefresh) {
    window.__haccpSharedRefresh = function(url, anonKey, refreshToken) {
      if (window.__haccpRefreshPromise) return window.__haccpRefreshPromise;
      if (!refreshToken) return Promise.resolve(null);
      window.__haccpRefreshPromise = (async function() {
        try {
          var r = await fetch(url + '/auth/v1/token?grant_type=refresh_token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': anonKey },
            body: JSON.stringify({ refresh_token: refreshToken })
          });
          if (!r.ok) return null;
          var d = await r.json();
          if (!d.access_token) return null;
          var out = { access_token: d.access_token, refresh_token: d.refresh_token || refreshToken };
          ['haccp_supa_cfg_v1', 'haccpro_supa_cfg', 'haccpro_session', 'haccp_dash_cfg_v2'].forEach(function(k) {
            try {
              var s = JSON.parse(localStorage.getItem(k) || 'null');
              if (s && (s.token || s.userToken)) {
                if (s.token) s.token = out.access_token;
                if (s.userToken) s.userToken = out.access_token;
                s.refreshToken = out.refresh_token;
                localStorage.setItem(k, JSON.stringify(s));
              }
            } catch (e) { /* ignore */ }
          });
          return out;
        } catch (e) { return null; }
        finally {
          // Libère le verrou un peu après résolution : les refresh quasi-simultanés
          // partagent le résultat, les suivants (bien plus tard) repartent à neuf.
          setTimeout(function() { window.__haccpRefreshPromise = null; }, 3000);
        }
      })();
      return window.__haccpRefreshPromise;
    };
  }

  async function runAuthGuard(options) {
    const sessionKey = options.sessionKey;
    const stableKey  = options.stableKey || null;
    const loginUrl   = options.loginUrl  || 'login.html';
    const onSuccess  = options.onSuccess  || null;

    function allowRender() {
      var s = document.getElementById('__auth_guard_css__');
      if (s && s.parentNode) s.parentNode.removeChild(s);
      if (typeof onSuccess === 'function') onSuccess();
    }

    function goLogin() {
      window.location.replace(loginUrl);
    }

    function decodeJwtExp(token) {
      try {
        var payload = token.split('.')[1];
        payload = payload.replace(/-/g, '+').replace(/_/g, '/');
        while (payload.length % 4) payload += '=';
        var decoded = JSON.parse(atob(payload));
        return (decoded.exp || 0) * 1000;
      } catch(e) { return 0; }
    }

    // Délègue au refresh partagé single-flight (évite les courses de rotation).
    async function tryRefresh(url, anonKey, refreshToken) {
      return window.__haccpSharedRefresh(url, anonKey, refreshToken);
    }

    try {
      var fresh  = JSON.parse(localStorage.getItem(sessionKey) || '{}');
      var stable = stableKey ? JSON.parse(localStorage.getItem(stableKey) || '{}') : {};

      var token        = fresh.token       || fresh.userToken       || stable.token       || stable.userToken       || '';
      var refreshToken = fresh.refreshToken                         || stable.refreshToken                          || '';
      var url          = stable.url        || SUPABASE_URL;
      var anonKey      = stable.key        || stable.anonKey        || SUPABASE_ANON_KEY;

      if (!token) { goLogin(); return; }

      var expMs     = decodeJwtExp(token);
      var msLeft    = expMs > 0 ? expMs - Date.now() : Infinity;
      var isExpired = msLeft < 60 * 1000;

      function _saveRefreshed(refreshed) {
        if (fresh.token || fresh.userToken) {
          if (fresh.token)     fresh.token     = refreshed.access_token;
          if (fresh.userToken) fresh.userToken = refreshed.access_token;
          fresh.refreshToken   = refreshed.refresh_token;
          try { localStorage.setItem(sessionKey, JSON.stringify(fresh)); } catch(e){}
        }
        if (stableKey && (stable.token || stable.userToken)) {
          if (stable.token)     stable.token     = refreshed.access_token;
          if (stable.userToken) stable.userToken = refreshed.access_token;
          stable.refreshToken   = refreshed.refresh_token;
          try { localStorage.setItem(stableKey, JSON.stringify(stable)); } catch(e){}
        }
      }

      // Planifier un refresh silencieux 5 min avant expiration
      function _scheduleProactiveRefresh(msUntilExpiry) {
        var refreshIn = msUntilExpiry - 5 * 60 * 1000;
        if (refreshIn < 0) refreshIn = 0;
        setTimeout(async function() {
          if (!refreshToken) return;
          var refreshed = await tryRefresh(url, anonKey, refreshToken);
          if (refreshed) {
            _saveRefreshed(refreshed);
            // Recalculer et replanifier pour le nouveau token
            var newExp = decodeJwtExp(refreshed.access_token);
            var newLeft = newExp > 0 ? newExp - Date.now() : 3600 * 1000;
            refreshToken = refreshed.refresh_token;
            _scheduleProactiveRefresh(newLeft);
            console.log('[HACCPro] authGuard: token rafraîchi silencieusement');
          } else {
            // Refresh échoué → avertir l'utilisateur à 2 min restantes
            var warnIn = (msUntilExpiry - 2 * 60 * 1000) - refreshIn;
            if (warnIn < 0) warnIn = 0;
            setTimeout(function() {
              if (typeof toast === 'function') {
                toast('⚠️ Session expire bientôt — enregistrez votre travail', 'warning');
              }
            }, warnIn);
          }
        }, refreshIn);
      }

      if (!isExpired) {
        allowRender();
        _scheduleProactiveRefresh(msLeft);
        return;
      }

      if (!refreshToken) { goLogin(); return; }
      var refreshed = await tryRefresh(url, anonKey, refreshToken);
      if (!refreshed) { goLogin(); return; }

      _saveRefreshed(refreshed);
      console.log('[HACCPro] authGuard: token rafraîchi automatiquement');
      allowRender();
      var newExpMs = decodeJwtExp(refreshed.access_token);
      var newLeft  = newExpMs > 0 ? newExpMs - Date.now() : 3600 * 1000;
      refreshToken = refreshed.refresh_token;
      _scheduleProactiveRefresh(newLeft);
    } catch(e) {
      console.warn('[HACCPro] authGuard:', e);
      allowRender();
    }
  }
  