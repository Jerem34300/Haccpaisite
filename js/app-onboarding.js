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
    mixes:             false,
    excedents:         false,
    plats_temoins:     true
  },
  services: '1',
  /* Section E */
  nbPersonnes: 2,
  noms:        [],
  responsable: '',
  pin:         ''
};

/* Services de distribution, fournisseurs, poubelles (format attendu par cuisine.html) */
var _svcs = [];        // [{id,label,ico,midi:bool,midi_deb,midi_fin,soir:bool,soir_deb,soir_fin}]
var _fournisseurs = []; // [{id,nom,jours:['Lun',…],heure}]
var _poubelles = [];    // [{id,ico,label,on:bool,jours:[]}]
var _prefilled = {};    // pré-remplissages déjà faits (une seule fois par étape)
var JOURS = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];

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

  /* Pré-sélectionner le type d'établissement choisi lors de l'inscription */
  var signupType = _signupData.type || '';
  var onbType = signupType === 'hotellerie' ? 'autre' : signupType;
  var validOnbTypes = ['restaurant', 'collectivite', 'traiteur', 'boulangerie', 'fast_food', 'autre'];
  if (onbType && validOnbTypes.indexOf(onbType) !== -1 && onbType !== 'restaurant') {
    _data.type = onbType;
    var typeGrid = document.getElementById('a-type-tiles');
    if (typeGrid) {
      typeGrid.querySelectorAll('.tile').forEach(function(t){ t.classList.remove('sel'); });
      var typeTarget = typeGrid.querySelector('[data-val="' + onbType + '"]');
      if (typeTarget) typeTarget.classList.add('sel');
    }
  }

  _maybeResumeKitchenPicker().then(function(shown){
    if (!shown) goStep(1);
  }).catch(function(e){
    console.warn('[Onboarding] reprise:', e);
    goStep(1);
  });
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
    7: 'E — Livraisons & déchets',
    8: 'F — Équipe',
    9: 'G — Récapitulatif'
  };
  var STEP_LABELS = {
    1: '', 2: 'Étape 1 / 2',
    3: 'Section A', 4: 'Section B', 5: 'Section C',
    6: 'Section D', 7: 'Section E', 8: 'Section F', 9: 'Section G'
  };

  var hdTitle = document.getElementById('hd-title');
  var hdStep  = document.getElementById('hd-step');
  var prog    = document.getElementById('progress');
  if (hdTitle) hdTitle.textContent = TITLES[to] || '';
  if (hdStep)  hdStep.textContent  = STEP_LABELS[to] || '';
  if (prog)    prog.style.width    = Math.round((to - 1) / 8 * 100) + '%';

  /* Dots (visibles uniquement pour les sections A-F) */
  var dotsEl = document.getElementById('step-dots');
  if (dotsEl) {
    dotsEl.style.display = (to >= 3) ? 'flex' : 'none';
    for (var i = 1; i <= 7; i++) {
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

  /* Pré-remplissages selon le type d'établissement (modifiables) */
  try {
    if (to === 4) _prefillProduction();
    if (to === 5) _prefillEnceintes();
    if (to === 7) _prefillLivraisons();
    if (to === 8) _renderResponsable();
  } catch(e){ console.warn('[Onboarding] pré-remplissage étape ' + to + ':', e); }

  /* Initialiser le recap */
  if (to === 9) _renderRecap();

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
    _data.processes.mixes           = !!(document.getElementById('proc-mixes') || {}).checked;
    _data.processes.excedents       = !!(document.getElementById('proc-excedents') || {}).checked;
    var hasSoir = _svcs.some(function(v){ return v.soir; });
    _data.services = hasSoir ? '2' : '1';
  }
  if (n === 8) {
    _data.noms = [];
    document.querySelectorAll('.nom-input').forEach(function(inp){
      _data.noms.push(inp.value || '');
    });
    var respEl = document.getElementById('e-responsable');
    _data.responsable = respEl ? (respEl.value || '') : '';
    var p1 = ((document.getElementById('e-pin') || {}).value || '').trim();
    var p2 = ((document.getElementById('e-pin2') || {}).value || '').trim();
    if (!/^\d{4}$/.test(p1)) { _showErr('err-7', 'Choisissez un code administrateur de 4 chiffres.'); return false; }
    if (p1 !== p2) { _showErr('err-7', 'Les deux codes ne sont pas identiques.'); return false; }
    _data.pin = p1;
    _hideErr('err-7');
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

/* ─── Section B — Pré-remplissage + services de distribution ─── */
var SVC_PRESETS = [
  { key:'salle',     ico:'🍽️', label:'Salle à manger' },
  { key:'plateaux',  ico:'🛏️', label:'Plateaux chambres' },
  { key:'self',      ico:'🍴', label:'Self' },
  { key:'livraison', ico:'🚚', label:'Livraison / portage' },
  { key:'up',        ico:'🧠', label:'Unité protégée' },
  { key:'emporter',  ico:'🥡', label:'Vente à emporter' }
];
var SVC_DEFAULT_BY_TYPE = {
  collectivite: [['salle','12:00','13:15','18:30','19:30']],
  restaurant:   [['salle','12:00','14:00','19:00','22:00']],
  traiteur:     [['livraison','11:00','12:30','','']],
  fast_food:    [['emporter','11:30','14:30','18:30','22:00']],
  boulangerie:  [['emporter','11:30','14:00','','']],
  autre:        [['salle','12:00','13:30','','']]
};
var SVC_HOURS = { salle:['12:00','13:15','18:30','19:30'], plateaux:['11:45','12:45','18:15','19:00'], self:['11:30','13:30','18:30','19:30'],
  livraison:['11:00','12:30','17:30','18:30'], up:['12:00','13:00','18:30','19:15'], emporter:['11:30','14:00','18:30','21:00'] };

function _svcId(base) {
  var id = _slug(base).replace(/-/g, '_') || 'service';
  var n = 2, out = id;
  while (_svcs.some(function(v){ return v.id === out; })) { out = id + '_' + n; n++; }
  return out;
}

window.addService = function(key, label, ico) {
  var pr = SVC_PRESETS.filter(function(x){ return x.key === key; })[0];
  if (!label) {
    if (pr) { label = pr.label; ico = pr.ico; }
    else {
      label = (window.prompt('Nom du service (ex : Crèche, Internat…)') || '').trim();
      if (!label) return;
      ico = '🍽️';
    }
  }
  var h = SVC_HOURS[key] || ['12:00','13:30','19:00','20:00'];
  var midiOnly = _data.type === 'traiteur' || _data.type === 'boulangerie';
  _svcs.push({ id:_svcId(pr ? pr.key : label), label:label, ico:ico || '🍽️',
    midi:true, midi_deb:h[0], midi_fin:h[1], soir:!midiOnly, soir_deb:midiOnly ? '' : h[2], soir_fin:midiOnly ? '' : h[3] });
  _renderServices();
};
window.removeService = function(idx) { _svcs.splice(idx, 1); _renderServices(); };
window.updateService = function(idx, field, val) {
  var v = _svcs[idx]; if (!v) return;
  v[field] = val;
  if (field === 'midi' || field === 'soir') _renderServices();
};

function _renderServices() {
  var sug = document.getElementById('svc-sug');
  if (sug) {
    sug.innerHTML = SVC_PRESETS.map(function(p){
      var on = _svcs.some(function(v){ return v.label === p.label; });
      return '<button type="button" class="sug-chip' + (on ? ' on' : '') + '" onclick="addService(\'' + p.key + '\')">' + p.ico + ' ' + _escHtml(p.label) + '</button>';
    }).join('') + '<button type="button" class="sug-chip" onclick="addService(\'autre\')">＋ Autre</button>';
  }
  var list = document.getElementById('svc-list');
  if (!list) return;
  if (!_svcs.length) { list.innerHTML = '<div class="hint">Aucun service : ajoutez-en au moins un.</div>'; return; }
  list.innerHTML = _svcs.map(function(v, idx){
    function slot(k, lbl){
      return '<div class="slot-row"><label style="display:flex;align-items:center;gap:6px;min-width:84px"><input type="checkbox"' + (v[k] ? ' checked' : '') +
        ' onchange="updateService(' + idx + ',\'' + k + '\',this.checked)">' + lbl + '</label>' +
        (v[k] ? 'de <input type="time" value="' + _escAttr(v[k + '_deb']) + '" onchange="updateService(' + idx + ',\'' + k + '_deb\',this.value)">' +
                ' à <input type="time" value="' + _escAttr(v[k + '_fin']) + '" onchange="updateService(' + idx + ',\'' + k + '_fin\',this.value)">' : '') +
      '</div>';
    }
    return '<div class="enc-card">' +
      '<button class="enc-del" onclick="removeService(' + idx + ')" title="Supprimer">✕</button>' +
      '<input class="enc-input" type="text" value="' + _escAttr(v.label) + '" oninput="updateService(' + idx + ',\'label\',this.value)" style="width:calc(100% - 34px)">' +
      slot('midi', '🌞 Midi') + slot('soir', '🌙 Soir') +
    '</div>';
  }).join('');
}

function _prefillProduction() {
  if (!_prefilled.prod) {
    _prefilled.prod = true;
    var t = _data.type;
    var on = {
      collectivite: ['refroidissement','remise-temp','distribution','mixes','plats-temoins'],
      restaurant:   ['refroidissement','remise-temp','plats-temoins'],
      traiteur:     ['refroidissement','remise-temp','livraison','plats-temoins'],
      fast_food:    ['cuisson-steaks','fritures'],
      boulangerie:  ['refroidissement'],
      autre:        ['plats-temoins']
    }[t] || [];
    on.forEach(function(k){ var cb = document.getElementById('proc-' + k); if (cb) cb.checked = true; });
    if (!_svcs.length) {
      (SVC_DEFAULT_BY_TYPE[t] || SVC_DEFAULT_BY_TYPE.autre).forEach(function(d){
        var pr = SVC_PRESETS.filter(function(x){ return x.key === d[0]; })[0];
        _svcs.push({ id:_svcId(pr.key), label:pr.label, ico:pr.ico, midi:!!d[1], midi_deb:d[1], midi_fin:d[2], soir:!!d[3], soir_deb:d[3], soir_fin:d[4] });
      });
    }
  }
  _renderServices();
}

function _prefillEnceintes() {
  if (_prefilled.enc || _enceintes.length) { _prefilled.enc = true; return; }
  _prefilled.enc = true;
  var t = _data.type;
  _enceintes = t === 'boulangerie'
    ? [{nom:'Chambre froide positive', type:'positif'}, {nom:'Congélateur', type:'negatif'}]
    : [{nom:'Chambre froide positive', type:'positif'}, {nom:'Chambre froide fruits & légumes', type:'legumes'},
       {nom:'Chambre froide négative', type:'negatif'}];
  if (_data.processes.plats_temoins || t === 'collectivite' || t === 'restaurant') _enceintes.push({nom:'Frigo plats témoins', type:'positif'});
  _renderEnceintes();
}

/* ─── Section E — Fournisseurs & poubelles ─── */
var FOUR_SUG = ['Transgourmet','Pomona','Metro','Sysco','Brake','Davigel','Promocash','Boulangerie','Boucherie','Crèmerie'];
var POUB_PRESETS = [
  { id:'pb_om',     ico:'🗑️', label:'Ordures ménagères' },
  { id:'pb_tri',    ico:'♻️', label:'Tri sélectif / emballages' },
  { id:'pb_bio',    ico:'🥬', label:'Biodéchets' },
  { id:'pb_carton', ico:'🟫', label:'Cartons' },
  { id:'pb_verre',  ico:'🫙', label:'Verre' },
  { id:'pb_huile',  ico:'🛢️', label:'Huiles usagées' }
];

window.addFournisseur = function(nom) {
  if (!nom) { nom = (window.prompt('Nom du fournisseur') || '').trim(); if (!nom) return; }
  if (_fournisseurs.some(function(f){ return f.nom.toLowerCase() === nom.toLowerCase(); })) return;
  _fournisseurs.push({ id:'f_' + _slug(nom) + '_' + _fournisseurs.length, nom:nom, jours:[], heure:'' });
  _renderLivraisons();
};
window.removeFournisseur = function(idx) { _fournisseurs.splice(idx, 1); _renderLivraisons(); };
window.updateFournisseur = function(idx, field, val) { if (_fournisseurs[idx]) _fournisseurs[idx][field] = val; };
window.toggleJour = function(kind, idx, jour) {
  var o = (kind === 'f' ? _fournisseurs : _poubelles)[idx]; if (!o) return;
  var i = o.jours.indexOf(jour);
  if (i >= 0) o.jours.splice(i, 1); else o.jours.push(jour);
  if (kind === 'p' && o.jours.length) o.on = true;
  _renderLivraisons();
};
window.togglePoubelle = function(idx, on) { if (_poubelles[idx]) _poubelles[idx].on = on; _renderLivraisons(); };

function _dayChips(kind, idx, jours) {
  return '<div class="day-row">' + JOURS.map(function(j){
    return '<button type="button" class="day-chip' + (jours.indexOf(j) >= 0 ? ' on' : '') + '" onclick="toggleJour(\'' + kind + '\',' + idx + ',\'' + j + '\')">' + j + '</button>';
  }).join('') + '</div>';
}

function _renderLivraisons() {
  var sug = document.getElementById('four-sug');
  if (sug) sug.innerHTML = FOUR_SUG.map(function(n){
    var on = _fournisseurs.some(function(f){ return f.nom === n; });
    return '<button type="button" class="sug-chip' + (on ? ' on' : '') + '" onclick="addFournisseur(\'' + n.replace(/'/g, "\\'") + '\')">' + (on ? '✓ ' : '＋ ') + _escHtml(n) + '</button>';
  }).join('');
  var fl = document.getElementById('four-list');
  if (fl) fl.innerHTML = _fournisseurs.map(function(f, idx){
    return '<div class="enc-card">' +
      '<button class="enc-del" onclick="removeFournisseur(' + idx + ')" title="Supprimer">✕</button>' +
      '<input class="enc-input" type="text" value="' + _escAttr(f.nom) + '" oninput="updateFournisseur(' + idx + ',\'nom\',this.value)" style="width:calc(100% - 34px)">' +
      '<div class="mini-lbl">Jours de livraison</div>' + _dayChips('f', idx, f.jours) +
      '<div class="slot-row">🕖 Heure habituelle <input type="time" value="' + _escAttr(f.heure) + '" onchange="updateFournisseur(' + idx + ',\'heure\',this.value)"></div>' +
    '</div>';
  }).join('');
  var pl = document.getElementById('poub-list');
  if (pl) pl.innerHTML = _poubelles.map(function(p, idx){
    return '<div class="enc-card" style="' + (p.on ? '' : 'opacity:.6') + '">' +
      '<label class="slot-row" style="margin-top:0"><input type="checkbox"' + (p.on ? ' checked' : '') + ' onchange="togglePoubelle(' + idx + ',this.checked)"> ' + p.ico + ' ' + _escHtml(p.label) + '</label>' +
      (p.on ? _dayChips('p', idx, p.jours) : '') +
    '</div>';
  }).join('');
}

function _prefillLivraisons() {
  if (!_prefilled.liv) {
    _prefilled.liv = true;
    var defOn = { pb_om:true, pb_tri:true, pb_bio:true, pb_carton:_data.type !== 'boulangerie' };
    _poubelles = POUB_PRESETS.map(function(p){ return { id:p.id, ico:p.ico, label:p.label, on:!!defOn[p.id], jours:[] }; });
  }
  _renderLivraisons();
}

/* ─── Section F — Responsable HACCP ─── */
function _renderResponsable() {
  var sel = document.getElementById('e-responsable');
  if (!sel) return;
  var nl = document.getElementById('noms-list');
  if (nl && !_prefilled.noms) {
    _prefilled.noms = true;
    nl.addEventListener('input', function(){ try { _data.responsable = sel.value; _renderResponsable(); } catch(e){ console.warn('[Onboarding] responsable:', e); } });
    var me0 = ((_signupData.firstName || '') + ' ' + (_signupData.lastName || '')).trim();
    if (me0 && !nl.querySelector('.nom-input')) { addNomInput(); var i0 = nl.querySelector('.nom-input'); if (i0) i0.value = me0; }
  }
  var names = [];
  document.querySelectorAll('.nom-input').forEach(function(inp){ if ((inp.value || '').trim()) names.push(inp.value.trim()); });
  var me = ((_signupData.firstName || '') + ' ' + (_signupData.lastName || '')).trim();
  if (me && names.indexOf(me) < 0) names.unshift(me);
  var cur = _data.responsable || sel.value || me;
  sel.innerHTML = '<option value="">— Choisir —</option>' + names.map(function(n){
    return '<option' + (n === cur ? ' selected' : '') + '>' + _escHtml(n) + '</option>';
  }).join('');
}

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

  var svcsOk = _svcs.filter(function(v){ return (v.label || '').trim(); });
  html += '<div class="recap-block">' +
    '<div class="recap-title">Services (' + svcsOk.length + ')</div>' +
    (svcsOk.length ? svcsOk.map(function(v){
      return li(v.ico || '🍽️', '<strong>' + _escHtml(v.label) + '</strong>' +
        (v.midi ? ' · midi ' + _escHtml(v.midi_deb) + '–' + _escHtml(v.midi_fin) : '') +
        (v.soir ? ' · soir ' + _escHtml(v.soir_deb) + '–' + _escHtml(v.soir_fin) : ''));
    }).join('') : li('—', 'Aucun service')) +
  '</div>';

  var fOk = _fournisseurs.filter(function(f){ return (f.nom || '').trim(); });
  var pOk = _poubelles.filter(function(x){ return x.on; });
  html += '<div class="recap-block">' +
    '<div class="recap-title">Fournisseurs (' + fOk.length + ') · Poubelles (' + pOk.length + ')</div>' +
    fOk.map(function(f){ return li('🚚', '<strong>' + _escHtml(f.nom) + '</strong>' + (f.jours.length ? ' · ' + f.jours.join(', ') : ' · <em>jours à préciser</em>') + (f.heure ? ' · vers ' + _escHtml(f.heure) : '')); }).join('') +
    pOk.map(function(x){ return li(x.ico, _escHtml(x.label) + (x.jours.length ? ' · ' + x.jours.join(', ') : ' · <em>jours à préciser</em>')); }).join('') +
    (!fOk.length && !pOk.length ? li('—', 'Rien de renseigné (modifiable plus tard dans les réglages)') : '') +
  '</div>';

  var nbFiches = _visibleFiches(_data.processes).length;
  html += '<div class="recap-block">' +
    '<div class="recap-title">Tablette</div>' +
    li('✓', nbFiches + ' fiches affichées dans le menu (les autres restent activables dans les réglages)') +
    li('✓', 'Code administrateur défini') +
    (_data.responsable ? li('✓', 'Responsable HACCP : ' + _escHtml(_data.responsable)) : '') +
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
      if (_sess.refreshToken && !cfg.refreshToken) cfg.refreshToken = _sess.refreshToken;
      if (_sess.tenantId && !cfg.tenantId) cfg.tenantId = _sess.tenantId;
    } catch(e){}
  }
  var token  = cfg.token || cfg.userToken || '';
  var userId = cfg.userId || cfg.user_id || '';

  if (!token) {
    _showErr('err-8', 'Session expirée. Veuillez vous reconnecter.');
    btn.disabled = false;
    if (label) label.style.display = 'inline';
    if (spin)  spin.style.display  = 'none';
    if (back)  back.style.display  = '';
    if (skip)  skip.style.display  = '';
    return;
  }

  // Le formulaire d'onboarding peut prendre longtemps à remplir : le token
  // récupéré au chargement de la page a pu expirer entre-temps. On le
  // rafraîchit ici si besoin, juste avant l'appel à provision-tenant.
  try {
    var _b64 = token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
    while (_b64.length % 4) _b64 += '=';
    var _expPayload = JSON.parse(atob(_b64));
    var _msLeft = (_expPayload.exp || 0) * 1000 - Date.now();
    if (_msLeft < 60 * 1000 && cfg.refreshToken) {
      var _rr = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
        body: JSON.stringify({ refresh_token: cfg.refreshToken })
      });
      if (_rr.ok) {
        var _rd = await _rr.json();
        if (_rd.access_token) {
          token = _rd.access_token;
          ['haccpro_supa_cfg', 'haccp_supa_cfg_v1', 'haccpro_session'].forEach(function(k){
            try {
              var raw = localStorage.getItem(k);
              if (!raw) return;
              var obj = JSON.parse(raw);
              if (obj.token)      obj.token      = _rd.access_token;
              if (obj.userToken)  obj.userToken  = _rd.access_token;
              if (obj.refreshToken !== undefined) obj.refreshToken = _rd.refresh_token || cfg.refreshToken;
              localStorage.setItem(k, JSON.stringify(obj));
            } catch(e){}
          });
        }
      }
    }
  } catch(e){ /* décodage/rafraîchissement best-effort — on retente l'appel avec le token existant sinon */ }

  var tenantId   = null;
  var siteIds    = [];
  var siteCodes  = [];
  var validSites = _sites.filter(function(s){ return s && s.trim(); });
  var plan       = _session.plan || _signupData.plan || 'solo';
  var quizKitchen = null;
  try {
    var qst = _readMultiKitchens();
    if (qst && qst.quizKitchen && qst.quizKitchen.code) quizKitchen = qst.quizKitchen;
  } catch (e) { console.warn('[Onboarding] quiz:', e); }
  // Solo → cuisinier (accès direct PMS), autres plans → directeur (accès dashboard)
  var finalRole  = plan === 'solo' ? 'cuisinier' : 'directeur';

  /* 1. Upload logo */
  if (_data.logoFile) {
    try { _data.logoUrl = await _uploadLogo(token, _data.logoFile); } catch(e) {
      console.warn('[Onboarding] logo upload:', e);
    }
  }

  /* 2. Provisionner tenant + site + profil via Netlify Function (service_role).
        Questionnaire d'une cuisine déjà créée : ne pas recréer de site. */
  if (quizKitchen) {
    try {
      var qstate0 = _readMultiKitchens() || {};
      tenantId = qstate0.tenantId || null;
      if (!tenantId) {
        try { tenantId = (JSON.parse(localStorage.getItem('haccp_dash_cfg_v2') || '{}').tenantId) || null; } catch (e2) {}
      }
      if (!tenantId) {
        try { tenantId = (JSON.parse(localStorage.getItem('haccpro_session') || '{}').tenantId) || null; } catch (e3) {}
      }
    } catch (e) { console.warn('[Onboarding] tenant quiz:', e); }
    if (quizKitchen.id) siteIds = [quizKitchen.id];
    siteCodes = [quizKitchen.code];
    validSites = [quizKitchen.name || quizKitchen.code];
    plan = 'multi';
    if (!tenantId) {
      _showErr('err-8', 'Organisation introuvable. Rouvrez le siège, puis configurez le PMS.');
      btn.disabled = false;
      if (label) label.style.display = 'inline';
      if (spin) spin.style.display = 'none';
      if (back) back.style.display = '';
      return;
    }
  } else try {
    var fullName = ((_signupData.firstName || '') + ' ' + (_signupData.lastName || '')).trim()
      || _signupData.company || _data.nom || null;

    var provResp = await fetch('/.netlify/functions/provision-tenant', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({
        companyName: _data.nom || _signupData.company || 'Mon établissement',
        siteName:    validSites[0] || _data.nom || '',
        siteNames:   validSites,
        plan:        plan,
        color:       _data.couleur || '#0F2240',
        type:        _data.type || _signupData.type || 'restaurant',
        siret:       _data.siret || null,
        fullName:    fullName
      })
    });

    var provResult = await provResp.json();
    if (!provResult.ok) throw new Error(provResult.error || 'Erreur lors de la configuration du compte');

    tenantId = provResult.tenant_id;
    // Toutes les cuisines nommées, créées par provision-tenant (service_role).
    // Le code est celui renvoyé (ex: "CAN47"), jamais un slug client.
    var provisioned = [];
    if (provResult.sites && provResult.sites.length) {
      provisioned = provResult.sites;
    } else if (provResult.site_id || provResult.site_code) {
      provisioned = [{
        id: provResult.site_id || null,
        code: provResult.site_code || _slug(validSites[0] || _data.nom || 'cuisine'),
        name: validSites[0] || _data.nom || '',
        created: provResult.existing ? false : true
      }];
    }
    provisioned.forEach(function(s){
      if (!s) return;
      if (s.id) siteIds.push(s.id);
      if (s.code) siteCodes.push(s.code);
    });
    // Mettre à jour le rôle final si la fonction le retourne (idempotence)
    if (provResult.role) finalRole = provResult.role;
    if (plan === 'multi' && siteCodes.length < validSites.length) {
      throw new Error('Toutes les cuisines n\'ont pas pu être créées. Réessayez.');
    }
  } catch(e) {
    console.error('[Onboarding] provision-tenant:', e);
    _showErr('err-8', e.message || 'Erreur lors de la configuration. Réessayez.');
    btn.disabled = false;
    if (label) label.style.display = 'inline';
    if (spin)  spin.style.display  = 'none';
    if (back)  back.style.display  = '';
    if (skip)  skip.style.display  = '';
    return;
  }

  /* 3. Les cuisines supplémentaires sont créées par provision-tenant (plus d'insert client). */

  /* 4. Écrire enceintes dans pms_config (solo / entreprise — le multi le fait cuisine par cuisine) */
  var hdrMin = {
    'Content-Type':  'application/json',
    'apikey':        SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + token,
    'Prefer':        'return=minimal'
  };
  var encData = _enceintes.filter(function(e){ return e.nom.trim(); })
    .map(function(e, idx){ return _encToConfig(e, idx); });
  if (plan !== 'multi' && encData.length && siteIds.length && tenantId) {
    try {
      await fetch(SUPABASE_URL + '/rest/v1/pms_config', {
        method: 'POST', headers: hdrMin,
        body: JSON.stringify({
          site_id:   siteCodes[0] || _slug(validSites[0] || 'cuisine'),
          tenant_id: tenantId,
          type:      'enceintes',
          data:      encData
        })
      });
    } catch(e) { console.warn('[Onboarding] pms_config:', e); }
  }

  /* Valeurs partagées entre l'écriture locale (haccp_v6) et la config cloud (sites.config) */
  var chefsNames = _data.noms.filter(function(n){ return n.trim(); });
  var nettRefData = _nettoyage.filter(function(z){ return z.checked; }).map(function(z) {
    return { id: z.id, zone: z.zone, materiel: z.materiel, freq: z.freq, produit: z.produit };
  });
  // Format cuisine.html : {id,label,ico,midi_deb,midi_fin,soir_deb,soir_fin}
  var distribSvcs = _svcs.filter(function(v){ return (v.label || '').trim() && (v.midi || v.soir); }).map(function(v){
    return { id:v.id, label:v.label.trim(), ico:v.ico || '🍽️',
      midi_deb: v.midi ? (v.midi_deb || '') : '', midi_fin: v.midi ? (v.midi_fin || '') : '',
      soir_deb: v.soir ? (v.soir_deb || '') : '', soir_fin: v.soir ? (v.soir_fin || '') : '' };
  });
  var enrActifsData = _buildEnrActifs(_data.processes);
  var fournData = _fournisseurs.filter(function(f){ return (f.nom || '').trim(); }).map(function(f){
    return { id:f.id, nom:f.nom.trim(), jours:f.jours.slice(), heure:f.heure || '', notes: f.heure ? 'Livraison vers ' + f.heure : '' };
  });
  var poubData = _poubelles.filter(function(x){ return x.on; }).map(function(x){
    return { id:x.id, ico:x.ico, label:x.label, jours:x.jours.slice() };
  });
  var navCfgData = _buildNavCfg(_data.processes);
  var adminPinData = null;
  try { if (_data.pin && window.crypto && crypto.subtle) adminPinData = await _hashPinOnb(_data.pin); }
  catch(e) { console.warn('[Onboarding] hash PIN admin:', e); }

  /* 5. Config PMS (même objet qu'une cuisine solo). Multi : appliquée cuisine par cuisine. */
  var cloudSiteConfig = {
    config: {
      themeColor:      _data.couleur,
      nbServices:      _data.services,
      distribServices: distribSvcs.length ? distribSvcs : undefined, // vide → services par défaut de la tablette
      enrActifs:       enrActifsData,
      chefs:           chefsNames,
      chefs_manuels:   chefsNames,
      etab:            _data.nom || validSites[0] || '',
      poubelles:       poubData,
      responsable:     _data.responsable || '',
      tutoStart:       true // guide « Premiers pas » sur l'accueil de la tablette
    },
    nett_ref:     nettRefData,
    fournisseurs: fournData,
    navCfg:       navCfgData
  };
  if (encData.length) cloudSiteConfig.config.enceintes = encData;
  if (adminPinData) cloudSiteConfig.adminPin = adminPinData;

  /* Cuisine déjà créée : le questionnaire vient d'être rempli. On l'enregistre
     MAINTENANT. pmsDone / pmsPending ne bougent qu'après une ligne sites renvoyée. */
  if (quizKitchen) {
    try {
      var qstate = _readMultiKitchens() || { v: 1, plan: 'multi', kitchens: [] };
      qstate.plan = 'multi';
      qstate.tenantId = tenantId || qstate.tenantId || null;
      qstate.cloudSiteConfig = cloudSiteConfig;
      qstate.encData = encData;
      qstate.snap = {
        chefsNames: chefsNames,
        nettRefData: nettRefData,
        distribSvcs: distribSvcs,
        enrActifsData: enrActifsData,
        fournData: fournData,
        poubData: poubData,
        navCfgData: navCfgData,
        adminPinData: adminPinData,
        headerGroupe: _data.nom || ''
      };
      qstate.kitchens = Array.isArray(qstate.kitchens) ? qstate.kitchens : [];
      var qi = -1;
      qstate.kitchens.forEach(function(k, i){ if (k && k.code === quizKitchen.code) qi = i; });
      if (qi < 0) {
        qstate.kitchens.push({ id: quizKitchen.id || null, code: quizKitchen.code, name: quizKitchen.name || quizKitchen.code, pmsDone: false });
        qi = qstate.kitchens.length - 1;
      } else {
        qstate.kitchens[qi].pmsDone = false;
      }
      qstate.quizKitchen = quizKitchen;
      _writeMultiKitchens(qstate);
      await _applySoloPmsToSite(qstate.kitchens[qi]);
      qstate = _readMultiKitchens() || qstate;
      if (qstate.kitchens && qstate.kitchens[qi]) qstate.kitchens[qi].pmsDone = true;
      qstate.quizKitchen = null;
      _writeMultiKitchens(qstate);
      if (spin) spin.style.display = 'none';
      btn.style.display = 'none';
      try { _showKitchenPicker(); }
      catch (e2) {
        console.warn('[Onboarding] écran cuisines:', e2);
        _showErr('err-8', 'Le PMS est enregistré, mais l\'écran n\'a pas pu s\'afficher. Ouvrez le siège.');
      }
    } catch (e) {
      console.warn('[Onboarding] enregistrement questionnaire:', e);
      _showErr('err-8', (e && e.message) || 'Enregistrement du PMS impossible.');
      btn.disabled = false;
      if (label) label.style.display = 'inline';
      if (spin) spin.style.display = 'none';
      if (back) back.style.display = '';
    }
    return;
  }

  /* Multi : ne pas aller au siège. Les cuisines existent ; « Configurer le PMS »
     ouvre le même questionnaire qu'une cuisine solo, puis seulement l'enregistrement. */
  if (plan === 'multi') {
    try {
      _rememberMultiKitchens(provisioned, tenantId, plan, cloudSiteConfig, encData, {
        chefsNames: chefsNames,
        nettRefData: nettRefData,
        distribSvcs: distribSvcs,
        enrActifsData: enrActifsData,
        fournData: fournData,
        poubData: poubData,
        navCfgData: navCfgData,
        adminPinData: adminPinData,
        headerGroupe: _data.nom || ''
      });
    } catch (e) { console.warn('[Onboarding] mémoire cuisines:', e); }
    try {
      var scM = {};
      try { scM = JSON.parse(localStorage.getItem('haccp_supa_cfg_v1') || '{}'); } catch (e2) {}
      scM.url = SUPABASE_URL;
      scM.anonKey = SUPABASE_ANON_KEY;
      scM.userToken = token;
      scM.token = token;
      scM.userId = userId;
      scM.role = finalRole;
      scM.plan = plan;
      scM.nom = _data.nom || '';
      if (tenantId) scM.tenantId = tenantId;
      localStorage.setItem('haccp_supa_cfg_v1', JSON.stringify(scM));
    } catch (e) { console.warn('[Onboarding] cfg multi:', e); }
    try {
      var sessM = {};
      try { sessM = JSON.parse(localStorage.getItem('haccpro_session') || '{}'); } catch (e2) {}
      sessM.role = finalRole;
      sessM.plan = plan;
      if (tenantId) sessM.tenantId = tenantId;
      localStorage.setItem('haccpro_session', JSON.stringify(sessM));
    } catch (e) { console.warn('[Onboarding] session multi:', e); }
    if (spin) spin.style.display = 'none';
    btn.style.display = 'none';
    try { _showKitchenPicker(); }
    catch (e) {
      console.warn('[Onboarding] écran cuisines:', e);
      _showErr('err-8', 'Les cuisines sont créées, mais l\'écran n\'a pas pu s\'afficher. Ouvrez le siège.');
    }
    return;
  }

  if (siteCodes.length && tenantId) {
    var hdrPatch = {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + token,
      'Prefer':        'return=minimal'
    };
    // Attendre l'écriture avant la redirection : la 1re ouverture de la tablette relit cette config
    await Promise.all(siteCodes.map(function(code){
      return fetch(SUPABASE_URL + '/rest/v1/sites?code=eq.' + encodeURIComponent(code), {
        method: 'PATCH', headers: hdrPatch,
        body: JSON.stringify({ config: cloudSiteConfig })
      }).then(function(r){ if (!r.ok) console.warn('[Onboarding] site config PATCH HTTP ' + r.status); })
        .catch(function(e){ console.warn('[Onboarding] site config PATCH:', e); });
    }));
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
    if (distribSvcs.length) S.config.distribServices = distribSvcs;

    /* ENRs actifs */
    S.config.enrActifs = enrActifsData;

    /* Noms chefs */
    S.config.chefs = chefsNames;
    S.config.chefs_manuels = chefsNames;

    /* Nettoyage */
    S.nett_ref = nettRefData;

    /* Fournisseurs, poubelles, responsable, fiches affichées, code admin */
    S.fournisseurs = fournData;
    S.config.poubelles = poubData;
    S.config.tutoStart = true;
    if (_data.responsable) S.config.responsable = _data.responsable;
    S.navCfg = navCfgData;
    if (adminPinData) S.adminPin = adminPinData;

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
    sc.siteId    = siteCodes.length ? siteCodes[0] : _slug(validSites[0] || 'ma-cuisine');
    sc.siteUUID  = siteIds.length ? siteIds[0] : null;
    sc.siteNom   = validSites[0] || _data.nom || '';
    sc.nom       = _data.nom || '';
    sc.role      = finalRole;
    sc.plan      = plan;
    if (tenantId) sc.tenantId = tenantId;
    localStorage.setItem('haccp_supa_cfg_v1', JSON.stringify(sc));
  } catch(e) { console.warn('[Onboarding] siteId:', e); }

  /* 8. Mettre à jour haccpro_session avec le rôle final et le tenantId */
  try {
    var sess = {};
    try { sess = JSON.parse(localStorage.getItem('haccpro_session') || '{}'); } catch(e2){}
    sess.role = finalRole;
    if (tenantId) sess.tenantId = tenantId;
    localStorage.setItem('haccpro_session', JSON.stringify(sess));
  } catch(e) { console.warn('[Onboarding] session update:', e); }

  /* 9. Afficher succès */
  if (spin)  spin.style.display = 'none';
  btn.style.display = 'none';
  var doneEl = document.getElementById('gen-done');
  if (doneEl) doneEl.style.display = 'block';

  /* 10. Rediriger : solo → cuisine.html, entreprise → dashboard.html (le multi est déjà sorti vers l'écran cuisines) */
  var dest = plan === 'solo' ? 'cuisine.html' : 'dashboard.html';
  setTimeout(function(){ window.location.href = dest; }, 2000);
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

/* ─── Fiches affichées sur la tablette selon les processus ───
   Les ids correspondent à ALL dans app-cuisine.js. Les fiches non listées sont
   masquées via S.navCfg.hidden (réactivables dans Réglages → Fiches). */
var FICHES_TOUJOURS = ['enr19','enr23','enr28','enr30','enr31','enr34','enr_allergenes'];
var FICHES_PAR_PROC = {
  refroidissement: ['enr01','enr03'],
  remise_temp:     ['enr02','enr03'],
  cuisson_steaks:  ['enr04'],
  fritures:        ['enr05'],
  livraison:       ['enr13','enr17','enr18'],
  mixes:           ['enr07','enr08'],
  excedents:       ['enr36','enr52'],
  plats_temoins:   ['enr33']
};
var FICHES_CONNUES = ['enr01','enr02','enr03','enr04','enr05','enr06','enr07','enr08','enr09','enr10','enr11','enr12','enr13',
  'enr14','enr15','enr16','enr17','enr18','enr19','enr20','enr21','enr23','enr24','enr25','enr26','enr27','enr28','enr29',
  'enr30','enr31','enr32','enr33','enr34','enr35','enr36','enr39','enr52','enr53','enr_allergenes','enr_tc_distrib'];
function _visibleFiches(procs) {
  var out = FICHES_TOUJOURS.slice();
  Object.keys(FICHES_PAR_PROC).forEach(function(k){
    if (procs[k]) FICHES_PAR_PROC[k].forEach(function(id){ if (out.indexOf(id) < 0) out.push(id); });
  });
  return out;
}
function _buildNavCfg(procs) {
  var vis = _visibleFiches(procs), hidden = {};
  FICHES_CONNUES.forEach(function(id){ if (vis.indexOf(id) < 0) hidden[id] = true; });
  return { hidden: hidden };
}
async function _hashPinOnb(pin) {
  // Même format que _hashPin() d'app-cuisine.js : SHA-256(sel 16 octets + PIN), base64
  var salt = crypto.getRandomValues(new Uint8Array(16));
  var pb = new TextEncoder().encode(String(pin));
  var all = new Uint8Array(salt.length + pb.length); all.set(salt, 0); all.set(pb, salt.length);
  var dig = new Uint8Array(await crypto.subtle.digest('SHA-256', all));
  var b64 = function(u){ var x = ''; for (var i = 0; i < u.length; i++) x += String.fromCharCode(u[i]); return btoa(x); };
  return { v:1, salt:b64(salt), hash:b64(dig) };
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
  if (procs.mixes)            { enrs.push('ENR07'); enrs.push('ENR08'); }
  if (procs.excedents)        enrs.push('ENR36');
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

/* ─── Multi : écran des cuisines juste après « Générer mon PMS » ─── */
var MULTI_KITCHENS_KEY = 'haccpro_multi_kitchens';

function _rememberMultiKitchens(provisioned, tenantId, plan, cloudSiteConfig, encData, snap) {
  var kitchens = (provisioned || []).filter(function(s){ return s && s.code; }).map(function(s){
    return { id: s.id || null, code: s.code, name: s.name || s.code, pmsDone: false };
  });
  localStorage.setItem(MULTI_KITCHENS_KEY, JSON.stringify({
    v: 1,
    plan: plan,
    tenantId: tenantId || null,
    kitchens: kitchens,
    cloudSiteConfig: cloudSiteConfig || {},
    encData: encData || [],
    snap: snap || {}
  }));
}

function _readMultiKitchens() {
  try { return JSON.parse(localStorage.getItem(MULTI_KITCHENS_KEY) || 'null'); }
  catch (e) { return null; }
}

function _writeMultiKitchens(state) {
  try { localStorage.setItem(MULTI_KITCHENS_KEY, JSON.stringify(state)); }
  catch (e) { console.warn('[Onboarding] save cuisines:', e); }
}

function _jwtExpMs(token) {
  try {
    var b64 = String(token || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    if (!b64) return 0;
    while (b64.length % 4) b64 += '=';
    var payload = JSON.parse(atob(b64));
    return (payload.exp || 0) * 1000;
  } catch (e) { return 0; }
}

/* Le siège rafraîchit le JWT dans haccp_dash_cfg_v2 et retire haccpro_session.
   Lire d'abord cette clé : un userToken périmé dans haccpro_supa_cfg donne HTTP 401
   sur PATCH /rest/v1/sites (JWT expiré, pas un refus d'une autre cuisine). */
function _onbToken() {
  var best = '';
  var bestExp = 0;
  ['haccp_dash_cfg_v2', 'haccpro_session', 'haccp_supa_cfg_v1', 'haccpro_supa_cfg'].forEach(function(k){
    try {
      var o = JSON.parse(localStorage.getItem(k) || '{}');
      var t = o.token || o.userToken || '';
      if (!t || String(t).split('.').length < 3) return;
      var exp = _jwtExpMs(t);
      if (!best || exp > bestExp) { best = t; bestExp = exp; }
    } catch (e) {}
  });
  return best;
}

function _onbRefreshToken() {
  var keys = ['haccp_dash_cfg_v2', 'haccpro_session', 'haccp_supa_cfg_v1', 'haccpro_supa_cfg'];
  for (var i = 0; i < keys.length; i++) {
    try {
      var o = JSON.parse(localStorage.getItem(keys[i]) || '{}');
      if (o.refreshToken) return o.refreshToken;
    } catch (e) {}
  }
  return '';
}

async function _onbFreshToken() {
  var token = _onbToken();
  var refresh = _onbRefreshToken();
  try {
    if (refresh && _jwtExpMs(token) - Date.now() < 60 * 1000) {
      var rr = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
        body: JSON.stringify({ refresh_token: refresh })
      });
      if (rr.ok) {
        var rd = await rr.json();
        if (rd.access_token) {
          token = rd.access_token;
          ['haccp_dash_cfg_v2', 'haccpro_session', 'haccp_supa_cfg_v1', 'haccpro_supa_cfg'].forEach(function(k){
            try {
              var raw = localStorage.getItem(k);
              if (!raw) return;
              var obj = JSON.parse(raw);
              if (obj.token) obj.token = rd.access_token;
              if (obj.userToken) obj.userToken = rd.access_token;
              if (obj.refreshToken) obj.refreshToken = rd.refresh_token || refresh;
              localStorage.setItem(k, JSON.stringify(obj));
            } catch (e) {}
          });
        }
      }
    }
  } catch (e) { console.warn('[Onboarding] refresh token:', e); }
  return token;
}

/** Même écriture PMS qu'une cuisine solo (pms_config + sites.config + brouillon local), pour UN site. */
async function _applySoloPmsToSite(kitchen) {
  var state = _readMultiKitchens();
  if (!state || !state.cloudSiteConfig) throw new Error('Configuration PMS introuvable sur cet appareil.');
  var token = await _onbFreshToken();
  if (!token) throw new Error('Session expirée. Reconnectez-vous, puis rouvrez cet écran.');
  var code = kitchen.code;
  var tenantId = state.tenantId || '';
  var snap = state.snap || {};
  var cloud = state.cloudSiteConfig;
  try { cloud = JSON.parse(JSON.stringify(cloud)); } catch (e) { cloud = state.cloudSiteConfig; }
  cloud.pmsPending = false;
  cloud.pmsConfigured = true;
  var hdrMin = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + token,
    'Prefer': 'return=representation'
  };
  try {
    var curResp = await fetch(SUPABASE_URL + '/rest/v1/sites?code=eq.' + encodeURIComponent(code) + '&select=config&limit=1', {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' }
    });
    if (curResp.ok) {
      var curRows = await curResp.json();
      var curCfg = (curRows && curRows[0] && curRows[0].config) || {};
      var alreadyLive = curCfg.pmsPending !== true && (curCfg.navCfg || (curCfg.config && (curCfg.config.enrActifs || curCfg.config.chefs)));
      if (alreadyLive) {
        throw new Error('Cette cuisine a déjà un PMS. Ouvrez-la depuis le siège, sans repasser par cet écran.');
      }
    }
  } catch (e) {
    if (e && e.message && e.message.indexOf('déjà un PMS') !== -1) throw e;
    console.warn('[Onboarding] lecture config:', e);
  }

  if (state.encData && state.encData.length && tenantId) {
    try {
      var encResp = await fetch(SUPABASE_URL + '/rest/v1/pms_config', {
        method: 'POST', headers: hdrMin,
        body: JSON.stringify({
          site_id: code,
          tenant_id: tenantId,
          type: 'enceintes',
          data: state.encData
        })
      });
      if (!encResp.ok) console.warn('[Onboarding] pms_config HTTP ' + encResp.status);
    } catch (e) { console.warn('[Onboarding] pms_config:', e); }
  }
  /* return=representation : un PATCH filtré par la RLS répond 200/204 avec 0 ligne
     sans écrire. Ne pas prendre ça pour un succès (cuisine vide + « PMS prêt »). */
  var patch = await fetch(SUPABASE_URL + '/rest/v1/sites?code=eq.' + encodeURIComponent(code), {
    method: 'PATCH', headers: hdrMin,
    body: JSON.stringify({ config: cloud })
  });
  var patched = [];
  try { patched = await patch.json(); } catch (e) { patched = []; }
  if (!patch.ok) throw new Error('Enregistrement du PMS impossible (HTTP ' + patch.status + ').');
  if (!Array.isArray(patched) || !patched.length) {
    throw new Error('Enregistrement du PMS impossible : la cuisine n\'a pas été mise à jour.');
  }
  if (patched[0].config && patched[0].config.pmsPending === true) {
    throw new Error('Enregistrement du PMS impossible : le questionnaire n\'a pas été enregistré.');
  }

  try {
    var S = {};
    try { S = JSON.parse(localStorage.getItem('haccp_v6') || '{}'); } catch (e2) {}
    S.config = S.config || {};
    S.config.enceintes = state.encData || [];
    S.config.themeColor = (cloud.config && cloud.config.themeColor) || S.config.themeColor;
    S.config.nbServices = (cloud.config && cloud.config.nbServices) || S.config.nbServices;
    if (snap.distribSvcs && snap.distribSvcs.length) S.config.distribServices = snap.distribSvcs;
    S.config.enrActifs = snap.enrActifsData || S.config.enrActifs;
    S.config.chefs = snap.chefsNames || [];
    S.config.chefs_manuels = snap.chefsNames || [];
    S.nett_ref = snap.nettRefData || [];
    S.fournisseurs = snap.fournData || [];
    S.config.poubelles = snap.poubData || [];
    S.config.tutoStart = true;
    if (cloud.config && cloud.config.responsable) S.config.responsable = cloud.config.responsable;
    S.navCfg = snap.navCfgData || S.navCfg;
    if (snap.adminPinData) S.adminPin = snap.adminPinData;
    S.config.etab = kitchen.name || '';
    S.config.headerGroupe = snap.headerGroupe || S.config.headerGroupe || '';
    S.config.headerNom = kitchen.name || '';
    localStorage.setItem('haccp_v6', JSON.stringify(S));
  } catch (e) { console.warn('[Onboarding] haccp_v6 cuisine:', e); }

  _pointCfgAtKitchen(kitchen, tenantId);
}

function _pointCfgAtKitchen(kitchen, tenantId) {
  try {
    var sc = {};
    try { sc = JSON.parse(localStorage.getItem('haccp_supa_cfg_v1') || '{}'); } catch (e) {}
    var token = _onbToken();
    if (token) { sc.userToken = token; sc.token = token; }
    sc.url = SUPABASE_URL;
    sc.anonKey = SUPABASE_ANON_KEY;
    sc.siteId = kitchen.code;
    sc.siteUUID = kitchen.id || null;
    sc.siteNom = kitchen.name || '';
    if (tenantId) sc.tenantId = tenantId;
    localStorage.setItem('haccp_supa_cfg_v1', JSON.stringify(sc));
    var also = {};
    try { also = JSON.parse(localStorage.getItem('haccpro_supa_cfg') || '{}'); } catch (e2) {}
    also.siteId = kitchen.code;
    also.siteUUID = kitchen.id || null;
    also.siteNom = kitchen.name || '';
    if (token) { also.token = token; also.userToken = token; }
    if (tenantId) also.tenantId = tenantId;
    localStorage.setItem('haccpro_supa_cfg', JSON.stringify(also));
  } catch (e) { console.warn('[Onboarding] pointeur site:', e); }
}

function _showKitchenPicker() {
  document.querySelectorAll('.step').forEach(function(s){ s.classList.remove('active'); });
  var el = document.getElementById('step-10');
  if (el) el.classList.add('active');
  var hdTitle = document.getElementById('hd-title');
  var hdStep = document.getElementById('hd-step');
  var prog = document.getElementById('progress');
  var dots = document.getElementById('step-dots');
  if (hdTitle) hdTitle.textContent = 'Vos cuisines';
  if (hdStep) hdStep.textContent = 'Plan Multi';
  if (prog) prog.style.width = '100%';
  if (dots) dots.style.display = 'none';
  _renderKitchenPicker();
  window.scrollTo(0, 0);
}

function _renderKitchenPicker() {
  var box = document.getElementById('kitchen-picker');
  if (!box) return;
  var state = _readMultiKitchens();
  var kitchens = (state && state.kitchens) || [];
  if (!kitchens.length) {
    box.innerHTML = '<div class="recap-block"><div class="recap-item"><span class="recap-check">—</span><div>Aucune cuisine à configurer.</div></div></div>';
    return;
  }
  box.innerHTML = kitchens.map(function(k, i){
    var done = !!k.pmsDone;
    var code = _escHtml(k.code || '');
    var name = _escHtml(k.name || 'Cuisine');
    var actions = done
      ? '<button type="button" class="btn-primary green" style="margin-top:10px" onclick="enterMultiKitchen(' + i + ')">Entrer dans cette cuisine</button>'
      : '<button type="button" class="btn-primary" style="margin-top:10px" onclick="configureMultiKitchen(' + i + ')">Configurer le PMS</button>';
    return '<div class="recap-block">' +
      '<div class="recap-title">Cuisine ' + (i + 1) + (done ? ' · PMS prêt' : '') + '</div>' +
      '<div class="recap-item"><span class="recap-check">' + (done ? '✓' : '○') + '</span><div><strong>' + name + '</strong></div></div>' +
      '<div class="recap-item"><span class="recap-check">#</span><div>Code site : <strong>' + code + '</strong></div></div>' +
      actions +
    '</div>';
  }).join('');
}

function _startKitchenQuiz(kitchen) {
  if (!kitchen || !kitchen.code) return;
  try {
    var state = _readMultiKitchens() || { v: 1, plan: 'multi', kitchens: [] };
    state.plan = 'multi';
    state.quizKitchen = { id: kitchen.id || null, code: kitchen.code, name: kitchen.name || kitchen.code };
    state.kitchens = Array.isArray(state.kitchens) ? state.kitchens : [];
    var found = false;
    state.kitchens.forEach(function(k){
      if (!k || k.code !== kitchen.code) return;
      found = true;
      k.pmsDone = false;
      k.id = k.id || kitchen.id || null;
      k.name = kitchen.name || k.name;
    });
    if (!found) state.kitchens.push({ id: kitchen.id || null, code: kitchen.code, name: kitchen.name || kitchen.code, pmsDone: false });
    _writeMultiKitchens(state);
  } catch (e) { console.warn('[Onboarding] quiz cuisine:', e); }
  _sites = [kitchen.name || kitchen.code];
  _data.nom = kitchen.name || '';
  try {
    var nomEl = document.getElementById('a-nom');
    if (nomEl && _data.nom) nomEl.value = _data.nom;
    var skip = document.getElementById('btn-gen-skip');
    if (skip) skip.style.display = 'none';
  } catch (e) { console.warn('[Onboarding] préremplissage quiz:', e); }
  goStep(3);
  try {
    var hd = document.getElementById('hd-title');
    if (hd) hd.textContent = 'PMS · ' + (kitchen.name || kitchen.code);
  } catch (e) { console.warn('[Onboarding] titre quiz:', e); }
}

window.configureMultiKitchen = function(idx) {
  _hideErr('err-10');
  var state = _readMultiKitchens();
  var kitchen = state && state.kitchens && state.kitchens[idx];
  if (!kitchen) { _showErr('err-10', 'Cuisine introuvable.'); return; }
  if (kitchen.pmsDone) {
    _showErr('err-10', 'Cette cuisine a déjà un PMS. Entrez dans la cuisine, ou rouvrez-la depuis le siège.');
    return;
  }
  try { _startKitchenQuiz(kitchen); }
  catch (e) {
    console.warn('[Onboarding] ouvrir questionnaire:', e);
    _showErr('err-10', 'Impossible d\'ouvrir le questionnaire. Réessayez.');
  }
};

window.enterMultiKitchen = function(idx) {
  try {
    var state = _readMultiKitchens();
    var kitchen = state && state.kitchens && state.kitchens[idx];
    if (!kitchen || !kitchen.pmsDone) {
      _showErr('err-10', 'Terminez le PMS de cette cuisine avant d\'y entrer.');
      return;
    }
    _pointCfgAtKitchen(kitchen, state.tenantId);
    window.location.href = 'cuisine.html';
  } catch (e) {
    console.warn('[Onboarding] entrer cuisine:', e);
    _showErr('err-10', 'Ouverture de la cuisine impossible.');
  }
};

window.openSiegeDashboard = function() {
  try { window.location.href = 'dashboard.html'; }
  catch (e) { console.warn('[Onboarding] siège:', e); }
};

function _templateFromSiteRow(row) {
  if (!row || !row.config || row.config.pmsPending === true) return null;
  var cloud;
  try { cloud = JSON.parse(JSON.stringify(row.config)); } catch (e) { return null; }
  delete cloud.pmsPending;
  delete cloud.pmsConfigured;
  var cfg = cloud.config || {};
  if (!cloud.navCfg && !cfg.enrActifs && !cfg.chefs && !cfg.enceintes && !cloud.nett_ref) return null;
  return {
    cloud: cloud,
    encData: cfg.enceintes || [],
    snap: {
      chefsNames: cfg.chefs || [],
      nettRefData: cloud.nett_ref || [],
      distribSvcs: cfg.distribServices || [],
      enrActifsData: cfg.enrActifs || [],
      fournData: cloud.fournisseurs || [],
      poubData: cfg.poubelles || [],
      navCfgData: cloud.navCfg || null,
      adminPinData: cloud.adminPin || null,
      headerGroupe: cfg.etab || ''
    }
  };
}

async function _hydratePendingKitchens(state) {
  var token = await _onbFreshToken();
  var tenantId = (state && state.tenantId) || '';
  if (!tenantId) {
    try {
      var sc = JSON.parse(localStorage.getItem('haccp_supa_cfg_v1') || '{}');
      tenantId = sc.tenantId || '';
    } catch (e) {}
  }
  if (!tenantId) {
    try {
      var sess = JSON.parse(localStorage.getItem('haccpro_session') || '{}');
      tenantId = sess.tenantId || '';
    } catch (e2) {}
  }
  if (!token || !tenantId) return state;
  var resp;
  try {
    resp = await fetch(SUPABASE_URL + '/rest/v1/sites?tenant_id=eq.' + encodeURIComponent(tenantId) + '&select=id,name,code,config', {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' }
    });
  } catch (e) {
    console.warn('[Onboarding] cuisines:', e);
    return state;
  }
  if (!resp.ok) return state;
  var rows = [];
  try { rows = await resp.json(); } catch (e3) { return state; }
  if (!Array.isArray(rows)) return state;
  if (!state || typeof state !== 'object') state = { v: 1, plan: 'multi', kitchens: [] };
  state.plan = state.plan || 'multi';
  state.tenantId = state.tenantId || tenantId;
  state.kitchens = Array.isArray(state.kitchens) ? state.kitchens : [];
  if (!state.cloudSiteConfig) {
    var tpl = null;
    rows.forEach(function(row){ if (!tpl) tpl = _templateFromSiteRow(row); });
    if (tpl) {
      state.cloudSiteConfig = tpl.cloud;
      state.encData = tpl.encData;
      if (!state.snap || !state.snap.navCfgData) state.snap = tpl.snap;
    }
  }
  rows.forEach(function(row){
    if (!row || !row.code || !row.config || row.config.pmsPending !== true) return;
    var i = -1;
    state.kitchens.forEach(function(k, idx){ if (k && k.code === row.code) i = idx; });
    /* Tant que le serveur dit pmsPending, le questionnaire n'est pas enregistré.
       Un pmsDone local (PATCH vide pris pour un succès) ne doit pas afficher « PMS prêt ». */
    if (i < 0) state.kitchens.push({ id: row.id || null, code: row.code, name: row.name || row.code, pmsDone: false });
    else {
      state.kitchens[i].pmsDone = false;
      state.kitchens[i].id = state.kitchens[i].id || row.id || null;
      state.kitchens[i].name = row.name || state.kitchens[i].name;
    }
  });
  try { _writeMultiKitchens(state); } catch (e4) { console.warn('[Onboarding] mémoire cuisines:', e4); }
  return state;
}

async function _maybeResumeKitchenPicker() {
  try {
    var qs = new URLSearchParams(window.location.search || '');
    var state = _readMultiKitchens();
    var pending = state && state.plan === 'multi' && (state.kitchens || []).some(function(k){ return k && !k.pmsDone; });
    if (qs.get('cuisines') === '1' || pending || (state && state.quizKitchen)) {
      try { state = await _hydratePendingKitchens(state); }
      catch (e) { console.warn('[Onboarding] cuisines en attente:', e); }
      var quiz = state && state.quizKitchen;
      var quizOpen = false;
      if (quiz && quiz.code && state && state.kitchens) {
        state.kitchens.forEach(function(k){
          if (k && k.code === quiz.code && !k.pmsDone) quizOpen = true;
        });
      }
      if (quiz && quizOpen) {
        try { _startKitchenQuiz(quiz); }
        catch (e) { console.warn('[Onboarding] questionnaire:', e); _showKitchenPicker(); }
        return true;
      }
      if (qs.get('cuisines') === '1' || (state && state.kitchens && state.kitchens.length)) {
        _showKitchenPicker();
        return true;
      }
    }
  } catch (e) { console.warn('[Onboarding] reprise cuisines:', e); }
  return false;
}

window.skipOnboarding = function() {
  try {
    var st = _readMultiKitchens();
    if (st && st.quizKitchen && st.quizKitchen.code) {
      _showErr('err-8', 'Terminez le questionnaire pour enregistrer le PMS de cette cuisine.');
      return;
    }
  } catch (e) { console.warn('[Onboarding] skip:', e); }
  window.location.href = 'cuisine.html';
};

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
