/* branding.js — Charge et applique le branding tenant depuis Supabase */
(function(){

async function loadTenantBranding() {
  try {
    var cfg = {};
    try { cfg = JSON.parse(localStorage.getItem('haccpro_supa_cfg') || '{}'); } catch(e){}
    if (!cfg.token && !cfg.userToken) {
      try { cfg = JSON.parse(localStorage.getItem('haccp_supa_cfg_v1') || '{}'); } catch(e){}
    }

    var token    = cfg.token || cfg.userToken || '';
    var tenantId = cfg.tenantId || '';
    if (!token || !tenantId) return;

    var r = await fetch(
      SUPABASE_URL + '/rest/v1/tenants?id=eq.' + tenantId + '&select=name,primary_color,logo_url',
      { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + token } }
    );
    if (!r.ok) return;

    var data = await r.json();
    if (!data || !data[0]) return;

    var tenant = data[0];

    /* Couleur principale */
    if (tenant.primary_color && typeof applyTheme === 'function') {
      applyTheme(tenant.primary_color);
    } else if (tenant.primary_color) {
      window._brandingPendingTheme = tenant.primary_color;
    }

    /* Nom établissement */
    if (tenant.name) {
      var nomEl = document.getElementById('header-nom');
      if (nomEl) nomEl.textContent = tenant.name;
      var grpEl = document.getElementById('header-groupe');
      if (grpEl) grpEl.textContent = 'MON ÉTABLISSEMENT';
    }

    /* Logo */
    var logoEl = document.getElementById('header-logo-img');
    if (logoEl) {
      if (tenant.logo_url) {
        var img = document.createElement('img');
        img.src   = tenant.logo_url;
        img.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:6px';
        img.alt   = tenant.name || 'Logo';
        logoEl.innerHTML = '';
        logoEl.appendChild(img);
      } else if (tenant.name && tenant.primary_color) {
        var initials = _initiales(tenant.name);
        logoEl.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;' +
          'background:' + _esc(tenant.primary_color) + ';border-radius:6px;color:#fff;' +
          'font-size:.75rem;font-weight:900;letter-spacing:.5px">' + _esc(initials) + '</div>';
      }
    }
  } catch(e) {
    console.warn('[Branding] loadTenantBranding:', e);
  }
}

function _initiales(name) {
  return (name || '').split(/\s+/).slice(0, 2)
    .map(function(w){ return w.charAt(0).toUpperCase(); })
    .join('');
}

function _esc(s) {
  return (s || '').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

window.loadTenantBranding = loadTenantBranding;

/* Appel automatique après chargement complet de la page (app-cuisine.js inclus) */
window.addEventListener('load', function() {
  loadTenantBranding().catch(function(e){
    console.warn('[Branding] auto-load:', e);
  });
});

})();
