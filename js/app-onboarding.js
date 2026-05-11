/* app-onboarding.js — Wizard post-inscription v2 */
(function(){

var _session    = {};
var _signupData = {};

var PLAN_MAX_SITES = { solo: 1, multi: 3, enterprise: Infinity };

/* État de l'onboarding */
var _sites    = [];   // noms des cuisines (étape 2)
var _enceintes = [];  // [{nom, type}]
var _nettoyage = [];  // [{id, zone, materiel, freq, produit, checked}]

var _data = {
  /* Section A */
  nom:      '',
  type:     'restaurant',
  couverts: '50-150',
  siret:    '',
  couleur:  '#5C1E5A',
  logoFile: null,
  logoUrl:  '',
  /* Section B */
  processes: {
    refroidissement:   false,
    remise_temp:       false,
    cuisson_steaks:    false,
    fritures:          false,
    livraison:         false,
    distribution:      false,
    plats_temoins:     true
  },
  services: '1',
  /* Section E */
  nbPersonnes: 2,
  noms:        []
};

/* ─── Init ─── */
document.addEventListener('DOMContentLoaded', function(){
  try { _session    = JSON.parse(localStorage.getItem('haccpro_session')    || '{}'); } catch(e){}
  try { _signupData = JSON.parse(localStorage.getItem('haccpro_signup_data') || '{}'); } catch(e){}

  var plan   = _session.plan || _signupData.plan || '';
  var planEl = document.getElementById('welcome-plan');
  if (planEl) {
    if      (plan === 'solo')       planEl.textContent = '🎁 Plan Solo activé — essai 14 jours';
    else if (plan === 'multi')      planEl.textContent = '⭐ Plan Multi activé — essai 14 jours';
    else if (plan === 'enterprise') planEl.textContent = '🏢 Plan Entreprise activé — essai 14 jours';
    else                            planEl.textContent = '🎁 Essai gratuit 14 jours activé';
  }

  var maxSites = PLAN_MAX_SITES[plan] || Infinity;
  var subEl    = document.getElementById('step2-sub');
  if (subEl) {
    if (maxSites === 1) {
      subEl.textContent = 'Votre plan Solo inclut 1 cuisine.';
    } else if (isFinite(maxSites)) {
      subEl.textContent = 'Votre plan Multi inclut jusqu\'à ' + maxSites + ' cuisines.';
    }
  }

  if (maxSites === 1) {
    var btnAdd = document.getElementById('btn-add-site');
    if (btnAdd) btnAdd.style.display = 'none';
  }

  var companyName = _signupData.company || '';
  addSite(companyName);

  if (companyName) {
    var nomEl = document.getElementById('a-nom');
    if (nomEl) nomEl.value = companyName;
    _data.nom = companyName;
  }

  /* Pré-sélectionner la couleur choisie lors de l'inscription */
  if (_signupData.couleur) {
    _data.couleur = _signupData.couleur;
    document.querySelectorAll('.color-swatch').forEach(function(s){
      var isActive = s.dataset.color === _signupData.couleur;
      s.classList.toggle('active', isActive);
    });
  }

  goStep(1);
});

/* ─── Navigation ─── */
window.goStep = function(to) {
  /* Valider avant d'avancer */
  if (to > _currentStep && !_validateStep(_currentStep)) return;

  document.querySelectorAll('.step').forEach(function(s){ s.classList.remove('active'); });
  var el = document.getElementById('step-' + to);
  if (el) el.classList.add('active');
  _currentStep = to;

  var TITLES = {
    1: 'Bienvenue !',
    2: 'Vos cuisines',
    3: 'A — Établissement',
    4: 'B — Production',
    5: 'C — Enceintes froides',
    6: 'D — Plan de nettoyage',
    7: 'E — Équipe',
    8: 'F — Récapitulatif'
  };
  var STEP_LABELS = {
    1: '', 2: 'Étape 1 / 2',
    3: 'Section A', 4: 'Section B', 5: 'Section C',
    6: 'Section D', 7: 'Section E', 8: 'Section F'
  };

  var hdTitle = document.getElementById('hd-title');
  var hdStep  = document.getElementById('hd-step');
  var prog    = document.getElementById('progress');
  if (hdTitle) hdTitle.textContent = TITLES[to] || '';
  if (hdStep)  hdStep.textContent  = STEP_LABELS[to] || '';
  if (prog)    prog.style.width    = Math.round((to - 1) / 7 * 100) + '%';

  /* Dots (visibles uniquement pour les sections A-F) */
  var dotsEl = document.getElementById('step-dots');
  if (dotsEl) {
    dotsEl.style.display = (to >= 3) ? 'flex' : 'none';
    for (var i = 1; i <= 6; i++) {
      var d = document.getElementById('dot-' + i);
      if (!d) continue;
      var secIdx = to - 2; /* step 3 = section 1, etc. */
      d.className = 'dot' + (i < secIdx ? ' done' : i === secIdx ? ' active' : '');
    }
  }

  /* Initialiser section D au premier accès */
  if (to === 6 && _nettoyage.length === 0) {
    _initNettoyage(_data.type);
    _renderNettoyage();
  }

  /* Initialiser le recap */
  if (to === 8) _renderRecap();

  window.scrollTo(0, 0);
};

var _currentStep = 1;

/* ─── Validation étape ─── */
function _validateStep(n) {
  if (n === 2) {
    var sites = _sites.filter(function(s){ return s && s.trim(); });
    if (!sites.length) { _showErr('err-2', 'Ajoutez au moins une cuisine.'); return false; }
    _hideErr('err-2');
  }
  if (n === 3) {
    var nom = (document.getElementById('a-nom').value || '').trim();
    if (!nom) { _showErr('err-3', 'Veuillez saisir le nom de votre établissement.'); return false; }
    _data.nom     = nom;
    _data.couverts = document.getElementById('a-couverts').value;
    _data.siret   = (document.getElementById('a-siret').value || '').trim();
    _hideErr('err-3');
  }
  if (n === 4) {
    _data.processes.refroidissement = document.getElementById('proc-refroidissement').checked;
    _data.processes.remise_temp     = document.getElementById('proc-remise-temp').checked;
    _data.processes.cuisson_steaks  = document.getElementById('proc-cuisson-steaks').checked;
    _data.processes.fritures        = document.getElementById('proc-fritures').checked;
    _data.processes.livraison       = document.getElementById('proc-livraison').checked;
    _data.processes.distribution    = document.getElementById('proc-distribution').checked;
    _data.processes.plats_temoins   = document.getElementById('proc-plats-temoins').checked;
  }
  if (n === 7) {
    _data.noms = [];
    document.querySelectorAll('.nom-input').forEach(function(inp){
      _data.noms.push(inp.value || '');
    });
  }
  return true;
}

/* ─── Étape 2 — Sites ─── */
window.addSite = function(defaultVal) {
  var plan     = _session.plan || _signupData.plan || '';
  var maxSites = PLAN_MAX_SITES[plan] || Infinity;
  var current  = _sites.filter(function(s){ return s !== null; }).length;

  if (current >= maxSites) {
    _showErr('err-2', 'Votre plan est limité à ' + maxSites + ' cuisine' + (maxSites > 1 ? 's' : '') + '.');
    return;
  }

  var idx  = _sites.length;
  _sites.push(defaultVal || '');

  var list = document.getElementById('sites-list');
  if (!list) return;
  var row  = document.createElement('div');
  row.className   = 'item-row';
  row.dataset.idx = idx;

  var showDel = isFinite(maxSites) ? maxSites > 1 : true;
  row.innerHTML =
    '<input class="item-input" type="text" placeholder="Ex : Cuisine centrale, Brasserie du Vieux-Port…"' +
    ' value="' + _escAttr(defaultVal || '') + '"' +
    ' oninput="updateSite(' + idx + ',this.value)">' +
    (showDel ? '<button class="item-del" onclick="removeSite(' + idx + ',this)" title="Supprimer">✕</button>' : '');

  list.appendChild(row);
  if (!defaultVal) row.querySelector('input').focus();

  var newCount = _sites.filter(function(s){ return s !== null; }).length;
  if (newCount >= maxSites) {
    var btnAdd = document.getElementById('btn-add-site');
    if (btnAdd) btnAdd.style.display = 'none';
  }
};

window.updateSite = function(idx, val) { _sites[idx] = val; };

window.removeSite = function(idx, btn) {
  _sites[idx] = null;
  var row = btn.closest('.item-row');
  if (row) row.remove();

  var plan     = _session.plan || _signupData.plan || '';
  var maxSites = PLAN_MAX_SITES[plan] || Infinity;
  var current  = _sites.filter(function(s){ return s !== null; }).length;
  if (current < maxSites) {
    var btnAdd = document.getElementById('btn-add-site');
    if (btnAdd) btnAdd.style.display = '';
  }
};

/* ─── Section A — Couleur & Logo ─── */
window.pickColor = function(hex, btn) {
  _data.couleur = hex;
  document.querySelectorAll('.color-swatch').forEach(function(s){ s.classList.remove('active'); });
  btn.classList.add('active');
};

window.onLogoSelected = function(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  _data.logoFile = file;
  var fnEl = document.getElementById('logo-filename');
  if (fnEl) fnEl.textContent = file.name;
  var prev = document.getElementById('logo-preview');
  if (prev) {
    var reader = new FileReader();
    reader.onload = function(e) {
      prev.src   = e.target.result;
      prev.style.display = 'block';
    };
    reader.readAsDataURL(file);
  }
};

/* ─── Section A — Tiles ─── */
window.selectTile = function(group, val, el) {
  var parent = el.closest('.tile-grid') || el.parentElement;
  parent.querySelectorAll('.tile').forEach(function(t){ t.classList.remove('sel'); });
  el.classList.add('sel');

  if      (group === 'a-type')     { _data.type     = val; _nettoyage = []; }
  else if (group === 'b-services') { _data.services  = val; }
};

/* ─── Section C — Enceintes ─── */
window.addEnceinte = function() {
  var idx = _enceintes.length;
  _enceintes.push({ nom: '', type: 'positif' });
  _renderEnceintes();
  var inputs = document.querySelectorAll('.enc-nom-inp');
  if (inputs.length) inputs[inputs.length - 1].focus();
};

window.removeEnceinte = function(idx) {
  _enceintes.splice(idx, 1);
  _renderEnceintes();
};

window.updateEnceinte = function(idx, field, val) {
  if (_enceintes[idx]) _enceintes[idx][field] = val;
};

function _renderEnceintes() {
  var list = document.getElementById('enc-list');
  if (!list) return;
  list.innerHTML = _enceintes.map(function(e, idx) {
    return '<div class="enc-card">' +
      '<button class="enc-del" onclick="removeEnceinte(' + idx + ')" title="Supprimer">✕</button>' +
      '<div class="enc-row">' +
        '<div>' +
          '<label class="field-lbl">Nom de l\'enceinte</label>' +
          '<input class="enc-input enc-nom-inp" type="text" placeholder="Ex : Chambre froide viandes"' +
          ' value="' + _escAttr(e.nom) + '"' +
          ' oninput="updateEnceinte(' + idx + ',\'nom\',this.value)">' +
        '</div>' +
        '<div>' +
          '<label class="field-lbl">Type</label>' +
          '<select class="enc-select" onchange="updateEnceinte(' + idx + ',\'type\',this.value)">' +
            '<option value="positif"' + (e.type==='positif'?' selected':'')   + '>❄️ Positif (0°C à +3°C)</option>' +
            '<option value="negatif"' + (e.type==='negatif'?' selected':'')   + '>🧊 Négatif (≤ −18°C)</option>' +
            '<option value="legumes"' + (e.type==='legumes'?' selected':'')   + '>🥦 Légumes (4°C à 8°C)</option>' +
            '<option value="produits_finis"' + (e.type==='produits_finis'?' selected':'') + '>🍱 Produits finis (0°C à +3°C)</option>' +
          '</select>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

/* ─── Section D — Nettoyage ─── */
var _NETT_DEFAULT = [
  { id:'nett-01', zone:'Cuisine chaude',  materiel:'Plans de travail',      defaultOn: true  },
  { id:'nett-02', zone:'Cuisine chaude',  materiel:'Fourneaux / Plaques',    defaultOn: true  },
  { id:'nett-03', zone:'Cuisine chaude',  materiel:'Hottes / Filtres',       defaultOn: true  },
  { id:'nett-04', zone:'Cuisine chaude',  materiel:'Sol',                    defaultOn: true  },
  { id:'nett-05', zone:'Chambre froide',  materiel:'Étagères / Clayettes',   defaultOn: true  },
  { id:'nett-06', zone:'Chambre froide',  materiel:'Joints de portes',       defaultOn: true  },
  { id:'nett-07', zone:'Chambre froide',  materiel:'Sol',                    defaultOn: true  },
  { id:'nett-08', zone:'Plonge',          materiel:'Bacs plonge',            defaultOn: true  },
  { id:'nett-09', zone:'Plonge',          materiel:'Égouttoirs',             defaultOn: true  },
  { id:'nett-10', zone:'Légumerie',       materiel:'Plans de travail',       defaultOn: true  },
  { id:'nett-11', zone:'Sanitaires',      materiel:'WC / Lavabos',           defaultOn: true  },
  { id:'nett-12', zone:'Office de distribution', materiel:'',               defaultOn: false },
  { id:'nett-13', zone:'Vestiaires',      materiel:'',                       defaultOn: false }
];

function _initNettoyage(type) {
  var precheck = (type === 'restaurant' || type === 'collectivite');
  _nettoyage = _NETT_DEFAULT.map(function(z) {
    return {
      id:       z.id,
      zone:     z.zone,
      materiel: z.materiel,
      freq:     'quotidien',
      produit:  '',
      checked:  precheck ? z.defaultOn : false
    };
  });
}

function _renderNettoyage() {
  var list = document.getElementById('nett-list');
  if (!list) return;
  list.innerHTML = _nettoyage.map(function(z, idx) {
    var label = z.materiel ? z.zone + ' — ' + z.materiel : z.zone;
    return '<label class="check-item">' +
      '<input type="checkbox"' + (z.checked ? ' checked' : '') +
      ' onchange="_toggleNett(' + idx + ',this.checked)">' +
      '<label>' + _escHtml(label) + '</label>' +
    '</label>';
  }).join('');
}

window._toggleNett = function(idx, val) {
  if (_nettoyage[idx]) _nettoyage[idx].checked = val;
};

window.addCustomNettoyage = function() {
  var inp = document.getElementById('nett-custom-inp');
  if (!inp) return;
  var val = (inp.value || '').trim();
  if (!val) return;

  var id = 'nett-c' + Date.now();
  _nettoyage.push({ id: id, zone: val, materiel: '', freq: 'quotidien', produit: '', checked: true });
  inp.value = '';
  _renderNettoyage();
};

/* ─── Section E — Équipe ─── */
window.changeNbPersonnes = function(delta) {
  _data.nbPersonnes = Math.max(1, _data.nbPersonnes + delta);
  var el = document.getElementById('nb-personnes-val');
  if (el) el.textContent = _data.nbPersonnes;
};

window.addNomInput = function() {
  var list = document.getElementById('noms-list');
  if (!list) return;
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:7px;align-items:center';
  var inp = document.createElement('input');
  inp.type        = 'text';
  inp.placeholder = 'Prénom NOM';
  inp.className   = 'item-input nom-input';
  inp.style.flex  = '1';
  var del = document.createElement('button');
  del.className   = 'item-del';
  del.textContent = '✕';
  del.onclick     = function(){ row.remove(); };
  row.appendChild(inp);
  row.appendChild(del);
  list.appendChild(row);
  inp.focus();
};

/* ─── Section F — Récapitulatif ─── */
var TYPE_LABELS = {
  restaurant:'Restaurant traditionnel', collectivite:'Restauration collective',
  traiteur:'Traiteur / événementiel',   boulangerie:'Boulangerie / pâtisserie',
  fast_food:'Restauration rapide',      autre:'Autre'
};
var PROC_LABELS = {
  refroidissement: 'Refroidissement rapide',
  remise_temp:     'Remise en température',
  cuisson_steaks:  'Cuisson steaks hachés',
  fritures:        'Fritures',
  livraison:       'Livraison chaude/froide',
  distribution:    'Distribution self/SAM',
  plats_temoins:   'Plats témoins'
};
var ENC_TYPE_LABELS = {
  positif:        'Positif (0°C à +3°C)',
  negatif:        'Négatif (≤ −18°C)',
  legumes:        'Légumes (4°C à 8°C)',
  produits_finis: 'Produits finis (0°C à +3°C)'
};

function _renderRecap() {
  /* Collecter noms avant recap */
  _data.noms = [];
  document.querySelectorAll('.nom-input').forEach(function(inp){ _data.noms.push(inp.value || ''); });

  var sites = _sites.filter(function(s){ return s && s.trim(); });
  var procs = Object.keys(_data.processes).filter(function(k){ return _data.processes[k]; });
  var nettActifs = _nettoyage.filter(function(z){ return z.checked; });
  var noms = _data.noms.filter(function(n){ return n.trim(); });

  function li(icon, html) {
    return '<div class="recap-item"><span class="recap-check">' + icon + '</span><div>' + html + '</div></div>';
  }

  var html = '<div class="recap-block">' +
    '<div class="recap-title">Établissement</div>' +
    li('✓', '<strong>' + _escHtml(_data.nom || '—') + '</strong> · ' + (TYPE_LABELS[_data.type] || _data.type)) +
    li('✓', 'Couverts : ' + _data.couverts + ((_data.siret) ? ' · SIRET : ' + _escHtml(_data.siret) : '')) +
    li('✓', '<span style="display:inline-flex;align-items:center;gap:6px">Couleur : <span style="width:16px;height:16px;border-radius:50%;background:' + _escAttr(_data.couleur) + ';display:inline-block;border:1.5px solid rgba(0,0,0,.15)"></span> ' + _escHtml(_data.couleur) + '</span>' +
           (_data.logoFile ? ' · Logo : ' + _escHtml(_data.logoFile.name) : '')) +
  '</div>';

  html += '<div class="recap-block">' +
    '<div class="recap-title">Cuisines (' + sites.length + ')</div>' +
    sites.map(function(s){ return li('✓', _escHtml(s)); }).join('') +
  '</div>';

  html += '<div class="recap-block">' +
    '<div class="recap-title">Processus · ' + _data.services + ' service' + (_data.services !== '1' ? 's' : '') + '/jour</div>' +
    (procs.length ? procs.map(function(k){ return li('✓', PROC_LABELS[k] || k); }).join('') : li('—', 'Aucun processus sélectionné')) +
  '</div>';

  if (_enceintes.length) {
    html += '<div class="recap-block">' +
      '<div class="recap-title">Enceintes froides (' + _enceintes.length + ')</div>' +
      _enceintes.map(function(e){ return li('❄️', (_escHtml(e.nom) || '<em>sans nom</em>') + ' · ' + (ENC_TYPE_LABELS[e.type] || e.type)); }).join('') +
    '</div>';
  }

  html += '<div class="recap-block">' +
    '<div class="recap-title">Nettoyage (' + nettActifs.length + ' zones)</div>' +
    (nettActifs.length ?
      nettActifs.slice(0,5).map(function(z){ return li('✓', _escHtml(z.materiel ? z.zone + ' — ' + z.materiel : z.zone)); }).join('') +
      (nettActifs.length > 5 ? '<div class="recap-muted">… et ' + (nettActifs.length - 5) + ' autre(s)</div>' : '')
      : li('—', 'Aucune zone sélectionnée')) +
  '</div>';

  html += '<div class="recap-block">' +
    '<div class="recap-title">Équipe</div>' +
    li('✓', _data.nbPersonnes + ' personne' + (_data.nbPersonnes > 1 ? 's' : '') + ' en cuisine' +
           (noms.length ? ' · ' + noms.join(', ') : '')) +
  '</div>';

  var el = document.getElementById('recap-content');
  if (el) el.innerHTML = html;
}

/* ─── Génération finale ─── */
window.generatePMS = async function() {
  var btn   = document.getElementById('btn-generate');
  var label = document.getElementById('btn-gen-label');
  var spin  = document.getElementById('btn-gen-spin');
  var back  = document.getElementById('btn-gen-back');
  var skip  = document.getElementById('btn-gen-skip');

  btn.disabled = true;
  if (label) label.style.display = 'none';
  if (spin)  spin.style.display  = 'block';
  if (back)  back.style.display  = 'none';
  if (skip)  skip.style.display  = 'none';
  _hideErr('err-8');

  /* Récupérer token — chercher dans tous les endroits possibles */
  var cfg = {};
  try { cfg = JSON.parse(localStorage.getItem('haccpro_supa_cfg') || '{}'); } catch(e){}
  if (!cfg.token && !cfg.userToken) {
    try { cfg = JSON.parse(localStorage.getItem('haccp_supa_cfg_v1') || '{}'); } catch(e){}
  }
  if (!cfg.token && !cfg.userToken) {
    try {
      var _sess = JSON.parse(localStorage.getItem('haccpro_session') || '{}');
      if (_sess.token) { cfg.token = _sess.token; cfg.userId = _sess.userId || ''; }
      if (_sess.tenantId && !cfg.tenantId) cfg.tenantId = _sess.tenantId;
    } catch(e){}
  }
  var token  = cfg.token || cfg.userToken || '';
  var userId = cfg.userId || cfg.user_id || '';

  var hdrRep = {
    'Content-Type':  'application/json',
    'apikey':        SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + token,
    'Prefer':        'return=representation'
  };
  var hdrMin = Object.assign({}, hdrRep, { 'Prefer': 'return=minimal' });

  var tenantId = null;
  var siteIds  = [];
  var validSites = _sites.filter(function(s){ return s && s.trim(); });

  /* 1. Upload logo */
  if (_data.logoFile) {
    try { _data.logoUrl = await _uploadLogo(token, _data.logoFile); } catch(e) {
      console.warn('[Onboarding] logo upload:', e);
    }
  }

  /* 2. Créer tenant */
  try {
    var r = await fetch(SUPABASE_URL + '/rest/v1/tenants', {
      method: 'POST', headers: hdrRep,
      body: JSON.stringify({ name: _data.nom, primary_color: _data.couleur, logo_url: _data.logoUrl || null })
    });
    if (r.ok) {
      var tenants = await r.json();
      if (tenants && tenants[0]) tenantId = tenants[0].id || null;
    } else {
      console.warn('[Onboarding] tenant:', r.status, await r.text());
    }
  } catch(e) { console.warn('[Onboarding] tenant:', e); }

  /* 3. Créer sites */
  if (validSites.length && token) {
    try {
      var rows = validSites.map(function(nom) {
        var row = { name: nom.trim(), code: _slug(nom) };
        if (tenantId) row.tenant_id = tenantId;
        return row;
      });
      var r2 = await fetch(SUPABASE_URL + '/rest/v1/sites', {
        method: 'POST', headers: hdrRep, body: JSON.stringify(rows)
      });
      if (r2.ok) {
        var created = await r2.json();
        if (created && created.length) siteIds = created.map(function(s){ return s.id; });
      } else {
        console.warn('[Onboarding] sites:', r2.status, await r2.text());
      }
    } catch(e) { console.warn('[Onboarding] sites:', e); }
  }

  /* 4. Lier profile */
  var plan = _session.plan || _signupData.plan || '';
  var finalRole = plan === 'solo' ? 'cuisinier' : 'siege';
  if (userId && token && tenantId) {
    try {
      await fetch(SUPABASE_URL + '/rest/v1/profiles?id=eq.' + userId, {
        method: 'PATCH', headers: hdrMin,
        body: JSON.stringify({ tenant_id: tenantId, site_id: siteIds[0] || null, role: finalRole })
      });
    } catch(e) { console.warn('[Onboarding] profile:', e); }
  }

  /* 5. Écrire enceintes dans pms_config */
  var encData = _enceintes.filter(function(e){ return e.nom.trim(); })
    .map(function(e, idx){ return _encToConfig(e, idx); });
  if (encData.length && siteIds.length && tenantId) {
    try {
      await fetch(SUPABASE_URL + '/rest/v1/pms_config', {
        method: 'POST', headers: hdrMin,
        body: JSON.stringify({
          site_id:   siteIds[0],
          tenant_id: tenantId,
          type:      'enceintes',
          data:      encData
        })
      });
    } catch(e) { console.warn('[Onboarding] pms_config:', e); }
  }

  /* 6. Écrire haccp_v6 */
  try {
    var S = {};
    try { S = JSON.parse(localStorage.getItem('haccp_v6') || '{}'); } catch(e2){}
    S.config = S.config || {};

    S.config.enceintes = _enceintes.filter(function(e){ return e.nom.trim(); })
      .map(function(e, idx){ return _encToConfig(e, idx); });
    S.config.themeColor = _data.couleur;
    S.config.nbServices = _data.services;

    /* Distribution services */
    var distribSvcs = [{ id:'midi', label:'Midi', heure:'12:30' }];
    if (_data.services === '2' || _data.services === '3+') {
      distribSvcs.push({ id:'soir', label:'Soir', heure:'19:30' });
    }
    if (_data.services === '3+') {
      distribSvcs.push({ id:'matin', label:'Matin', heure:'08:00' });
    }
    S.config.distribServices = distribSvcs;

    /* ENRs actifs */
    S.config.enrActifs = _buildEnrActifs(_data.processes);

    /* Noms chefs */
    S.config.chefs = _data.noms.filter(function(n){ return n.trim(); });

    /* Nettoyage */
    S.nettoyage = _nettoyage.filter(function(z){ return z.checked; }).map(function(z) {
      return { id: z.id, zone: z.zone, materiel: z.materiel, freq: z.freq, produit: z.produit };
    });

    /* Nom établissement pour l'en-tête */
    S.config.etab        = _data.nom || validSites[0] || '';
    S.config.headerGroupe = _data.nom || '';
    S.config.headerNom   = validSites[0] || _data.nom || '';

    localStorage.setItem('haccp_v6', JSON.stringify(S));
  } catch(e) { console.warn('[Onboarding] haccp_v6:', e); }

  /* 7. Écrire la config Supabase complète dans haccp_supa_cfg_v1 */
  try {
    var sc = {};
    try { sc = JSON.parse(localStorage.getItem('haccp_supa_cfg_v1') || '{}'); } catch(e2){}
    sc.url       = SUPABASE_URL;
    sc.anonKey   = SUPABASE_ANON_KEY;
    sc.userToken = token;
    sc.token     = token;
    sc.userId    = userId;
    sc.siteId    = siteIds.length ? siteIds[0] : _slug(validSites[0] || 'ma-cuisine');
    sc.siteNom   = validSites[0] || _data.nom || '';
    sc.nom       = _data.nom || '';
    if (tenantId) sc.tenantId = tenantId;
    localStorage.setItem('haccp_supa_cfg_v1', JSON.stringify(sc));
  } catch(e) { console.warn('[Onboarding] siteId:', e); }

  /* 8. Mettre à jour haccpro_session.role si admin (siège) */
  if (finalRole !== 'cuisinier') {
    try {
      var sess = {};
      try { sess = JSON.parse(localStorage.getItem('haccpro_session') || '{}'); } catch(e2){}
      sess.role = finalRole;
      if (tenantId) sess.tenantId = tenantId;
      localStorage.setItem('haccpro_session', JSON.stringify(sess));
    } catch(e) { console.warn('[Onboarding] session update:', e); }
  }

  /* 9. Afficher succès */
  if (spin)  spin.style.display = 'none';
  btn.style.display = 'none';
  var doneEl = document.getElementById('gen-done');
  if (doneEl) doneEl.style.display = 'block';

  /* 10. Rediriger après 2 s selon le plan */
  var redirect = finalRole !== 'cuisinier' ? 'dashboard.html' : 'cuisine.html';
  setTimeout(function(){ window.location.href = redirect; }, 2000);
};

/* ─── Logo upload ─── */
async function _uploadLogo(token, file) {
  var resized = await _resizeImg(file, 256);

  /* Tenter le Storage Supabase */
  try {
    var filename = 'logo-' + Date.now() + '.jpg';
    var blob     = _dataUrlToBlob(resized);
    var ru = await fetch(SUPABASE_URL + '/storage/v1/object/logos/' + filename, {
      method: 'POST',
      headers: {
        'apikey':         SUPABASE_ANON_KEY,
        'Authorization':  'Bearer ' + token,
        'Content-Type':   'image/jpeg',
        'Cache-Control':  '3600'
      },
      body: blob
    });
    if (ru.ok) return SUPABASE_URL + '/storage/v1/object/public/logos/' + filename;
  } catch(e) {}

  /* Fallback : data URL base64 */
  return resized;
}

function _resizeImg(file, maxSize) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) {
      var img = new Image();
      img.onload = function() {
        var scale  = Math.min(maxSize / img.width, maxSize / img.height, 1);
        var canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function _dataUrlToBlob(dataUrl) {
  var parts = dataUrl.split(';base64,');
  var type  = parts[0].split(':')[1];
  var raw   = atob(parts[1]);
  var buf   = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return new Blob([buf], { type: type });
}

/* ─── ENR activés selon processus ─── */
function _buildEnrActifs(procs) {
  var enrs = [];
  if (procs.refroidissement)  enrs.push('ENR01');
  if (procs.remise_temp)      enrs.push('ENR02');
  if (procs.cuisson_steaks)   enrs.push('ENR04');
  if (procs.fritures)         enrs.push('ENR05');
  if (procs.livraison)        { enrs.push('ENR17'); enrs.push('ENR18'); }
  if (procs.distribution)     { enrs.push('ENR15'); enrs.push('ENR16'); }
  if (procs.plats_temoins)    enrs.push('ENR33');
  return enrs;
}

/* ─── Conversion format onboarding → format cuisine.html ─── */
function _encToConfig(e, idx) {
  var CONSIGNE = {
    positif:        '0°C à +3°C',
    negatif:        '≤ −18°C',
    legumes:        '+4°C à +8°C',
    produits_finis: '0°C à +3°C'
  };
  return {
    id:       'enc_onb_' + idx,
    label:    e.nom,
    type:     e.type === 'negatif' ? 'congelateur' : 'frigo',
    consigne: CONSIGNE[e.type] || '0°C à +3°C'
  };
}

/* ─── Slug code pour site ─── */
function _slug(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 20) || 'cuisine';
}

/* ─── Helpers ─── */
function _showErr(id, msg) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent  = msg;
  el.style.display = 'block';
}

function _hideErr(id) {
  var el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

function _escAttr(s) {
  return (s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _escHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

})();
