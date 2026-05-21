/**
 * subscriptionguard.js — Vérifie l'abonnement après authentification
 *
 * Doit être chargé APRÈS authguard.js sur cuisine.html et dashboard.html.
 * Cache le résultat 1 heure dans localStorage pour ne pas bloquer le chargement.
 *
 * Si le trial est expiré ou l'abonnement annulé → redirige vers paywall.html.
 * Si super_admin → passe toujours.
 */

(function () {
  const CACHE_KEY = 'haccp_sub_cache_v1';
  const CACHE_TTL = 60 * 60 * 1000; // 1 heure

  function getSession() {
    const keys = ['haccp_supa_cfg_v1', 'haccpro_session', 'haccp_dash_cfg_v2', 'haccpro_supa_cfg'];
    for (const k of keys) {
      try {
        const s = JSON.parse(localStorage.getItem(k) || '{}');
        if (s.token || s.userToken) return s;
      } catch (e) { /* ignore */ }
    }
    return {};
  }

  function getToken() {
    const s = getSession();
    return s.token || s.userToken || '';
  }

  function getTenantId() {
    const keys = ['haccp_supa_cfg_v1', 'haccpro_session', 'haccp_dash_cfg_v2'];
    for (const k of keys) {
      try {
        const s = JSON.parse(localStorage.getItem(k) || '{}');
        if (s.tenantId) return s.tenantId;
        if (s.tenant_id) return s.tenant_id;
      } catch (e) { /* ignore */ }
    }
    return null;
  }

  function isSuperAdmin() {
    const keys = ['haccp_supa_cfg_v1', 'haccpro_session', 'haccp_dash_cfg_v2'];
    for (const k of keys) {
      try {
        const s = JSON.parse(localStorage.getItem(k) || '{}');
        if (s.role === 'super_admin') return true;
      } catch (e) { /* ignore */ }
    }
    return false;
  }

  function getCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      if (c.ts && Date.now() - c.ts < CACHE_TTL) return c;
    } catch (e) { /* ignore */ }
    return null;
  }

  function setCache(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ...data, ts: Date.now() }));
    } catch (e) { /* ignore */ }
  }

  function goPaywall(reason) {
    const current = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace('paywall.html?reason=' + reason + '&from=' + current);
  }

  function checkStatus(status, trialEndsAt, cancelAtPeriodEnd, periodEnd) {
    if (status === 'active') {
      // Annulation programmée → on laisse passer jusqu'à la fin de période
      return true;
    }
    if (status === 'trial') {
      if (!trialEndsAt) return true;
      return new Date(trialEndsAt) > new Date();
    }
    // past_due, cancelled, expired → bloqué
    return false;
  }

  async function fetchSubscription(tenantId, token) {
    const url = (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '')
      + `/rest/v1/subscriptions?tenant_id=eq.${tenantId}&limit=1`
      + `&select=status,trial_ends_at,current_period_end,cancel_at_period_end,plan`;
    const anonKey = typeof SUPABASE_ANON_KEY !== 'undefined' ? SUPABASE_ANON_KEY : '';
    const r = await fetch(url, {
      headers: { 'apikey': anonKey, 'Authorization': `Bearer ${token}` },
    });
    if (!r.ok) throw new Error('Fetch subscription failed');
    const rows = await r.json();
    return rows?.[0] || null;
  }

  async function run() {
    // Super admin → toujours autorisé
    if (isSuperAdmin()) return;

    const tenantId = getTenantId();
    const token    = getToken();

    // Pas de tenantId → laisser passer (l'onboarding gère ce cas)
    if (!tenantId || !token) return;

    // Vérifier le cache d'abord
    const cached = getCache();
    if (cached && cached.tenantId === tenantId) {
      if (!cached.allowed) {
        goPaywall(cached.reason || 'expired');
      }
      return;
    }

    // Fetcher depuis Supabase (fail-open : si erreur réseau, on laisse passer)
    try {
      const sub = await fetchSubscription(tenantId, token);

      if (!sub) {
        // Pas d'abonnement en DB → autoriser (l'onboarding n'a peut-être pas fini)
        setCache({ tenantId, allowed: true });
        return;
      }

      const allowed = checkStatus(sub.status, sub.trial_ends_at, sub.cancel_at_period_end, sub.current_period_end);

      let reason = 'expired';
      if (sub.status === 'trial') reason = 'trial_expired';
      if (sub.status === 'past_due') reason = 'past_due';
      if (sub.status === 'cancelled') reason = 'cancelled';

      setCache({ tenantId, allowed, reason, plan: sub.plan, status: sub.status, trialEndsAt: sub.trial_ends_at });

      if (!allowed) {
        goPaywall(reason);
      }
    } catch (e) {
      // Fail-open : erreur réseau → on laisse l'utilisateur accéder
      console.warn('[subscriptionguard] Erreur vérification abonnement (fail-open):', e.message);
    }
  }

  // Invalider le cache + sélection si retour depuis Stripe (paiement réussi)
  if (new URLSearchParams(window.location.search).get('payment') === 'success') {
    try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* ignore */ }
    try { localStorage.removeItem('haccp_paywall_selection'); } catch (e) { /* ignore */ }
  }

  run();
})();
