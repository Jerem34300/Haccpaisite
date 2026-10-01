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

    async function tryRefresh(url, anonKey, refreshToken) {
      try {
        var r = await fetch(url + '/auth/v1/token?grant_type=refresh_token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': anonKey },
          body: JSON.stringify({ refresh_token: refreshToken })
        });
        if (!r.ok) return { _fail: r.status };
        var data = await r.json();
        if (!data.access_token) return { _fail: r.status || 401 };
        return { access_token: data.access_token, refresh_token: data.refresh_token || refreshToken };
      } catch(e) { return null; }
    }

    try {
      var fresh  = JSON.parse(localStorage.getItem(sessionKey) || '{}');
      var stable = stableKey ? JSON.parse(localStorage.getItem(stableKey) || '{}') : {};

      var token        = fresh.token       || fresh.userToken       || stable.token       || stable.userToken       || '';
      var refreshToken = fresh.refreshToken                         || stable.refreshToken                          || '';
      var url          = stable.url        || SUPABASE_URL;
      var anonKey      = stable.key        || stable.anonKey        || SUPABASE_ANON_KEY;

      // Refresh 400/401/403 : retirer le JWT mort pour ne pas rebondir cuisine↔accueil.
      // Ne jamais supprimer haccp_supa_queue_v1 (logout / changement de site seulement).
      function _purgeKitchenDeadSession(status) {
        try {
          if (status !== 400 && status !== 401 && status !== 403) return;
          if (sessionKey !== 'haccpro_supa_cfg' && stableKey !== 'haccp_supa_cfg_v1') return;
          function strip(obj, key) {
            if (!key || !obj) return;
            obj.userToken = '';
            obj.token = '';
            obj.refreshToken = '';
            try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) { console.warn('[HACCPro] authGuard purge', e); }
          }
          strip(fresh, sessionKey);
          if (stableKey) strip(stable, stableKey);
          try { localStorage.removeItem('sb-lthxpucxjcwzphshdhmp-auth-token'); } catch (e) { console.warn('[HACCPro] authGuard sdk', e); }
        } catch (e) { console.warn('[HACCPro] authGuard purge', e); }
      }

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
          if (refreshed && refreshed.access_token) {
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
      if (!refreshed || !refreshed.access_token) {
        if (refreshed && refreshed._fail) _purgeKitchenDeadSession(refreshed._fail);
        goLogin();
        return;
      }

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
  