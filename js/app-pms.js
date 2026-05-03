/* app-pms.js — Questionnaire PMS & génération automatique */
(function(){

var _session = {};
var _data = {
  // Section A
  nom: '', type: 'restaurant', couverts: '50-150', siret: '',
  // Section B
  activities: ['reception','stockage_froid','cuisson','plats_temoins'],
  services: '1',
  // Section C
  encs: { frigo_positif: 1, frigo_negatif: 0, vitrine: 0, bain_marie: 0, autre: 0 },
  sonde: 'non',
  // Section D
  staff: 2, resp: 'oui', protocoles: []
};

var SECTIONS = 5;
var _current = 1;

var ENC_TYPES = [
  { key: 'frigo_positif', label: 'Chambre froide positive',   icon: '❄️',  min: 0,   max: 4  },
  { key: 'frigo_negatif', label: 'Congélateur / CF négative', icon: '🧊',  min: -25, max: -18 },
  { key: 'vitrine',       label: 'Vitrine réfrigérée',        icon: '🪟',  min: 0,   max: 4  },
  { key: 'bain_marie',    label: 'Bain-marie / chaud',        icon: '♨️',  min: 63,  max: 90 },
  { key: 'autre',         label: 'Autre enceinte',            icon: '📦',  min: 0,   max: 10 }
];

/* ─── Init ─── */
document.addEventListener('DOMContentLoaded', function(){
  try { _session = JSON.parse(localStorage.getItem('haccpro_session') || '{}'); } catch(e){}

  // Pré-remplir section A depuis les données d'inscription
  try {
    var sd = JSON.parse(localStorage.getItem('haccpro_signup_data') || '{}');
    if (sd.company) {
      _data.nom = sd.company;
      var nomEl = document.getElementById('a-nom');
      if (nomEl) nomEl.value = sd.company;
    }
    if (sd.type) {
      _data.type = sd.type;
      // Sélectionner la tuile correspondante
      var tiles = document.querySelectorAll('#a-type-tiles .tile');
      tiles.forEach(function(t) {
        t.classList.toggle('selected', t.dataset.val === sd.type);
      });
    }
  } catch(e) {}

  _renderEncSection();
  _updateDots();
});

/* ─── Navigation ─── */
window.goSec = function(to) {
  if (to > _current && !_validate(_current)) return;
  document.getElementById('sec-' + _current).classList.remove('active');

  _current = to;
  if (to === 5) _renderRecap();

  var el = document.getElementById('sec-' + to);
  if (el) el.classList.add('active');

  var titles = ['','A — Établissement','B — Production','C — Enceintes','D — Équipe','E — Récapitulatif'];
  document.getElementById('hd-title').textContent = titles[to] || 'Génération PMS';
  document.getElementById('hd-step').textContent  = 'Section ' + to + ' / ' + SECTIONS;
  document.getElementById('progress').style.width  = (to / SECTIONS * 100) + '%';
  _updateDots();
  window.scrollTo(0, 0);
};

function _updateDots() {
  for (var i = 1; i <= SECTIONS; i++) {
    var d = document.getElementById('dot-' + i);
    if (!d) continue;
    d.className = 'dot' + (i < _current ? ' done' : i === _current ? ' active' : '');
  }
}

/* ─── Tiles (radio) ─── */
window.selectTile = function(group, val, el) {
  var parent = el.parentElement;
  parent.querySelectorAll('.tile').forEach(function(t){ t.classList.remove('selected'); });
  el.classList.add('selected');

  if      (group === 'a-type')     _data.type     = val;
  else if (group === 'b-services') _data.services = val;
  else if (group === 'c-sonde')    _data.sonde    = val;
  else if (group === 'd-resp')     _data.resp     = val;
};

/* ─── Num picker ─── */
window.changeNum = function(id, delta) {
  _data.staff = Math.max(1, _data.staff + delta);
  var el = document.getElementById(id + '-val');
  if (el) el.textContent = _data.staff;
};

/* ─── Enceinte counters ─── */
function _renderEncSection() {
  var list = document.getElementById('c-enc-list');
  if (!list) return;
  list.innerHTML = ENC_TYPES.map(function(t) {
    var n = _data.encs[t.key] || 0;
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--bg);border-radius:12px;margin-bottom:8px;">' +
      '<div style="display:flex;align-items:center;gap:10px;font-size:.88rem;font-weight:800;color:var(--text)">' +
      t.icon + ' ' + t.label + '</div>' +
      '<div class="num-row">' +
      '<button class="num-btn" onclick="changeEnc(\'' + t.key + '\',-1)">−</button>' +
      '<span class="num-val" id="enc-val-' + t.key + '">' + n + '</span>' +
      '<button class="num-btn" onclick="changeEnc(\'' + t.key + '\',+1)">+</button>' +
      '</div></div>';
  }).join('');
}

window.changeEnc = function(key, delta) {
  _data.encs[key] = Math.max(0, (_data.encs[key] || 0) + delta);
  var el = document.getElementById('enc-val-' + key);
  if (el) el.textContent = _data.encs[key];
};

/* ─── Validation ─── */
function _validate(n) {
  var errId = 'err-' + n;
  _hideErr(errId);

  if (n === 1) {
    var nom = document.getElementById('a-nom').value.trim();
    _data.nom     = nom;
    _data.couverts = document.getElementById('a-couverts').value;
    _data.siret   = (document.getElementById('a-siret').value || '').trim();
    if (!nom) { _showErr(errId, 'Veuillez saisir le nom de votre établissement.'); return false; }
  }

  if (n === 2) {
    _data.activities = [];
    document.querySelectorAll('#b-activities input:checked').forEach(function(cb){
      _data.activities.push(cb.value);
    });
  }

  if (n === 4) {
    _data.protocoles = [];
    document.querySelectorAll('#d-protocoles input:checked').forEach(function(cb){
      _data.protocoles.push(cb.value);
    });
  }

  return true;
}

/* ─── Récapitulatif ─── */
var ACT_LABELS = {
  reception: 'Réception MP', stockage_froid: 'Stockage froid', decongelation: 'Décongélation',
  preparation_froide: 'Préparation froide', cuisson: 'Cuisson', refroidissement: 'Refroidissement rapide',
  remise_en_temp: 'Remise en temp.', plats_temoins: 'Plats témoins', livraison: 'Livraison',
  produits_allergenes: 'Gestion allergènes'
};
var TYPE_LABELS = {
  restaurant:'Restaurant', collectivite:'Restauration collective', traiteur:'Traiteur',
  boulangerie:'Boulangerie/pâtisserie', fast_food:'Restauration rapide', autre:'Autre'
};

function _renderRecap() {
  var b = document.getElementById('recap-block');
  if (!b) return;

  var nbEncs = ENC_TYPES.reduce(function(acc, t){ return acc + (_data.encs[t.key] || 0); }, 0);
  var acts = _data.activities.map(function(k){ return ACT_LABELS[k] || k; });

  b.innerHTML =
    '<div class="summary-title">Récapitulatif de votre configuration</div>' +

    '<div class="summary-item"><span class="summary-check">✓</span>' +
    '<div><strong>' + (_data.nom || '—') + '</strong> · ' + (TYPE_LABELS[_data.type] || _data.type) + '</div></div>' +

    '<div class="summary-item"><span class="summary-check">✓</span>' +
    '<div>Activités : <em>' + acts.join(', ') + '</em></div></div>' +

    '<div class="summary-item"><span class="summary-check">✓</span>' +
    '<div>' + nbEncs + ' enceinte' + (nbEncs !== 1 ? 's' : '') + ' · relevé ' + (_data.sonde === 'oui' ? 'automatique' : 'manuel') +
    '</div></div>' +

    '<div class="summary-item"><span class="summary-check">✓</span>' +
    '<div>' + _data.staff + ' personne' + (_data.staff > 1 ? 's' : '') + ' en cuisine · ' + _data.services + ' service' + (_data.services !== '1' ? 's' : '') + '/jour</div></div>';
}

/* ─── Génération PMS ─── */
window.generatePMS = async function() {
  if (!_validate(5)) return;

  var btn   = document.getElementById('btn-generate');
  var label = document.getElementById('btn-gen-label');
  var spin  = document.getElementById('btn-gen-spin');
  btn.disabled = true;
  label.style.display = 'none';
  spin.style.display  = 'block';

  try {
    var token    = _session.token || _session.userToken || '';
    var tenantId = _session.tenantId || '';
    var url      = SUPABASE_URL;
    var anonKey  = SUPABASE_ANON_KEY;

    var headers = {
      'Content-Type':  'application/json',
      'apikey':        anonKey,
      'Authorization': 'Bearer ' + token,
      'Prefer':        'return=minimal'
    };

    // 1. Upsert profil PMS
    await fetch(url + '/rest/v1/pms_config', {
      method: 'POST',
      headers: Object.assign({}, headers, {'Prefer':'resolution=merge-duplicates'}),
      body: JSON.stringify({
        tenant_id:    tenantId,
        etab_nom:     _data.nom,
        etab_type:    _data.type,
        couverts:     _data.couverts,
        siret:        _data.siret,
        services_par_jour: _data.services === '3+' ? 3 : parseInt(_data.services),
        sonde_auto:   _data.sonde === 'oui',
        nb_staff:     _data.staff,
        resp_haccp:   _data.resp === 'oui',
        activities:   _data.activities,
        protocoles:   _data.protocoles
      })
    });

    // 2. Créer les enceintes manquantes
    var encsToCreate = [];
    ENC_TYPES.forEach(function(t) {
      var n = _data.encs[t.key] || 0;
      for (var i = 1; i <= n; i++) {
        encsToCreate.push({
          tenant_id: tenantId,
          nom:       t.label + (n > 1 ? ' ' + i : ''),
          type:      t.key,
          temp_min:  t.min,
          temp_max:  t.max
        });
      }
    });

    if (encsToCreate.length) {
      await fetch(url + '/rest/v1/enceintes', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(encsToCreate)
      });
    }

    // 3. Créer points de contrôle HACCP selon les activités
    var ccp = _buildCCP(tenantId);
    if (ccp.length) {
      await fetch(url + '/rest/v1/points_controle', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(ccp)
      });
    }

    // 4. Afficher l'écran de succès
    var nbEncs  = encsToCreate.length;
    var nbCCP   = ccp.length;
    var nbDocs  = _countDocs();

    document.getElementById('stat-enc').textContent    = nbEncs;
    document.getElementById('stat-points').textContent = nbCCP;
    document.getElementById('stat-docs').textContent   = nbDocs;

    document.getElementById('sec-5').classList.remove('active');
    document.getElementById('sec-done').classList.add('active');
    document.getElementById('hd-title').textContent = 'PMS généré !';
    document.getElementById('hd-step').textContent  = '';
    document.getElementById('progress').style.width = '100%';

  } catch(err) {
    console.error('[PMS] generatePMS:', err);
    // En cas d'erreur, on redirige quand même
    window.location.href = 'dashboard.html';
  } finally {
    btn.disabled = false;
    label.style.display = '';
    spin.style.display  = 'none';
  }
};

function _buildCCP(tenantId) {
  var ccp = [];
  var acts = _data.activities;

  var CCP_TEMPLATES = [
    { activity: 'reception',         code: 'CCP-REC-01',  libelle: 'Contrôle réception matières premières', type: 'reception',        freq: 'A chaque livraison' },
    { activity: 'stockage_froid',    code: 'CCP-STOCK-01',libelle: 'Relevé de température enceintes froides', type: 'temperature',     freq: '2x/jour' },
    { activity: 'decongelation',     code: 'CCP-DECONG-01',libelle:'Contrôle décongélation (T° + durée)',    type: 'tracabilite',       freq: 'A chaque décongélation' },
    { activity: 'preparation_froide',code: 'CCP-PREP-01',  libelle:'Temp. zone préparation froide',          type: 'temperature',       freq: '1x/service' },
    { activity: 'cuisson',           code: 'CCP-CUIS-01',  libelle:'Contrôle température à cœur cuisson',   type: 'temperature_coeur', freq: 'A chaque cuisson' },
    { activity: 'refroidissement',   code: 'CCP-REF-01',   libelle:'Temps refroidissement rapide (63°→10°)', type: 'tracabilite',      freq: 'A chaque refroidissement' },
    { activity: 'remise_en_temp',    code: 'CCP-REC-01',   libelle:'Température remise en chauffe (>63°C)', type: 'temperature_coeur',  freq: 'A chaque service' },
    { activity: 'plats_temoins',     code: 'CCP-PT-01',    libelle:'Prélèvement plats témoins',              type: 'plat_temoin',       freq: 'A chaque service' },
    { activity: 'livraison',         code: 'CCP-LIV-01',   libelle:'Température livraison (< 10°C ou > 63°)', type: 'temperature',     freq: 'A chaque livraison' },
    { activity: 'produits_allergenes',code:'CCP-ALL-01',   libelle:'Vérification composition allergènes',    type: 'allergenes',        freq: 'A chaque préparation' }
  ];

  CCP_TEMPLATES.forEach(function(tpl) {
    if (acts.indexOf(tpl.activity) !== -1) {
      ccp.push({ tenant_id: tenantId, code: tpl.code, libelle: tpl.libelle, type: tpl.type, frequence: tpl.freq });
    }
  });

  return ccp;
}

function _countDocs() {
  // Estimation du nombre de documents générés
  var base = 3; // registre HACCP, plan nettoyage, fiches températures
  if (_data.activities.indexOf('plats_temoins') !== -1) base++;
  if (_data.activities.indexOf('produits_allergenes') !== -1) base++;
  if (_data.activities.indexOf('livraison') !== -1) base++;
  return base;
}

/* ─── Helpers ─── */
function _showErr(id, msg) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}

function _hideErr(id) {
  var el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

})();
