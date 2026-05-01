/* app-onboarding.js — Wizard post-inscription */
(function(){

var _session = {};
var _sites   = [];
var _encs    = [];

var ENC_DEFAULTS = {
  'frigo_positif':  { min: 0,   max: 4  },
  'frigo_negatif':  { min: -25, max: -18 },
  'vitrine':        { min: 0,   max: 4  },
  'bain_marie':     { min: 63,  max: 90 },
  'autre':          { min: 0,   max: 10 }
};

var ENC_LABELS = {
  'frigo_positif': 'Chambre froide positive',
  'frigo_negatif': 'Congélateur / CF négative',
  'vitrine':       'Vitrine réfrigérée',
  'bain_marie':    'Bain-marie / maintien chaud',
  'autre':         'Autre enceinte'
};

/* ─── Init ─── */
document.addEventListener('DOMContentLoaded', function(){
  try { _session = JSON.parse(localStorage.getItem('haccpro_session') || '{}'); } catch(e){}

  // Affiche le plan activé
  var plan = _session.plan || '';
  var planEl = document.getElementById('welcome-plan');
  if (planEl) {
    if (plan === 'pro')        planEl.textContent = '⭐ Plan Pro activé — essai 14 jours';
    else if (plan === 'starter') planEl.textContent = '🎁 Plan Starter — essai gratuit 14 jours';
    else                        planEl.textContent = '🎁 Essai gratuit 14 jours activé';
  }

  // Pré-ajouter un site vide
  addSite();
});

/* ─── Navigation entre steps ─── */
window.goStep = function(to) {
  var current = document.querySelector('.step.active');
  var currentId = current ? parseInt(current.id.replace('step-','')) : 1;

  if (to > currentId && !validateStep(currentId)) return;

  document.querySelectorAll('.step').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('step-' + to).classList.add('active');

  var titles  = ['', 'Bienvenue !', 'Vos cuisines', 'Vos enceintes', 'Configuration enregistrée !'];
  var progPct = [0, 25, 50, 75, 100];

  var hdTitle = document.getElementById('hd-title');
  var hdStep  = document.getElementById('hd-step');
  var prog    = document.getElementById('progress');

  if (hdTitle) hdTitle.textContent = titles[to] || '';
  if (hdStep)  hdStep.textContent  = to < 4 ? ('Étape ' + to + '/4') : '';
  if (prog)    prog.style.width    = progPct[to] + '%';

  window.scrollTo(0, 0);
};

/* ─── Validation par étape ─── */
function validateStep(n) {
  hideErr('err-' + n);

  if (n === 2) {
    var inputs = document.querySelectorAll('#sites-list .item-input');
    var hasOne = false;
    inputs.forEach(function(inp){ if (inp.value.trim()) hasOne = true; });
    if (!hasOne) { showErr('err-2', 'Ajoutez au moins une cuisine.'); return false; }
  }
  return true;
}

/* ─── Sites ─── */
window.addSite = function() {
  var idx = _sites.length;
  _sites.push('');

  var list = document.getElementById('sites-list');
  var row  = document.createElement('div');
  row.className = 'item-row';
  row.dataset.idx = idx;
  row.innerHTML =
    '<input class="item-input" type="text" placeholder="Ex : Cuisine centrale, Brasserie du Vieux-Port…"' +
    ' oninput="updateSite(' + idx + ',this.value)">' +
    '<button class="item-del" onclick="removeSite(' + idx + ',this)" title="Supprimer">✕</button>';

  list.appendChild(row);
  row.querySelector('input').focus();
};

window.updateSite = function(idx, val) {
  _sites[idx] = val;
};

window.removeSite = function(idx, btn) {
  _sites[idx] = null;
  var row = btn.closest('.item-row');
  if (row) row.remove();
};

/* ─── Enceintes ─── */
window.addEnceinte = function() {
  var idx = _encs.length;
  _encs.push({ type: 'frigo_positif', nom: '', min: 0, max: 4 });

  var list = document.getElementById('enc-list');
  var card = document.createElement('div');
  card.className = 'enc-card';
  card.dataset.idx = idx;
  card.innerHTML = _renderEncCard(idx);
  list.appendChild(card);
  card.querySelector('.enc-input').focus();
};

function _renderEncCard(idx) {
  var enc = _encs[idx];
  var opts = Object.keys(ENC_LABELS).map(function(k){
    return '<option value="' + k + '"' + (enc.type === k ? ' selected' : '') + '>' + ENC_LABELS[k] + '</option>';
  }).join('');

  return '<button class="enc-del" onclick="removeEnceinte(' + idx + ',this)" title="Supprimer">✕</button>' +
    '<div class="enc-row">' +
    '  <div><label class="field-lbl">Nom</label>' +
    '  <input class="enc-input" type="text" placeholder="Ex: Frigo 1, Cave vins…"' +
    '    value="' + (enc.nom||'') + '" oninput="updateEnc(' + idx + ',\'nom\',this.value)"></div>' +
    '  <div><label class="field-lbl">Type</label>' +
    '  <select class="enc-select" onchange="changeEncType(' + idx + ',this.value)">' + opts + '</select></div>' +
    '</div>' +
    '<div><label class="field-lbl">Températures de référence</label>' +
    '<div class="enc-temps">' +
    '  <div><div class="enc-temp-label">Min (°C)</div>' +
    '  <input class="enc-temp-input" type="number" value="' + enc.min + '"' +
    '    oninput="updateEnc(' + idx + ',\'min\',+this.value)"></div>' +
    '  <div><div class="enc-temp-label">Max (°C)</div>' +
    '  <input class="enc-temp-input" type="number" value="' + enc.max + '"' +
    '    oninput="updateEnc(' + idx + ',\'max\',+this.value)"></div>' +
    '</div></div>';
}

window.changeEncType = function(idx, type) {
  _encs[idx].type = type;
  var def = ENC_DEFAULTS[type] || { min: 0, max: 10 };
  _encs[idx].min = def.min;
  _encs[idx].max = def.max;
  // Mettre à jour les inputs temp
  var card = document.querySelector('.enc-card[data-idx="' + idx + '"]');
  if (!card) return;
  var temps = card.querySelectorAll('.enc-temp-input');
  if (temps[0]) temps[0].value = def.min;
  if (temps[1]) temps[1].value = def.max;
};

window.updateEnc = function(idx, field, val) {
  _encs[idx][field] = val;
};

window.removeEnceinte = function(idx, btn) {
  _encs[idx] = null;
  var card = btn.closest('.enc-card');
  if (card) card.remove();
};

/* ─── Sauvegarde & redirection ─── */
window.saveAndContinue = async function() {
  var btn   = document.getElementById('btn-save');
  var label = document.getElementById('btn-save-label');
  var spin  = document.getElementById('btn-save-spin');

  btn.disabled = true;
  if (label) label.style.display = 'none';
  if (spin)  spin.style.display  = 'block';

  var errEl = document.getElementById('err-4') || null;

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

    // 1. Insérer les sites
    var sitesToInsert = _sites.filter(function(s){ return s && s.trim(); }).map(function(nom){
      return { tenant_id: tenantId, nom: nom.trim() };
    });

    if (sitesToInsert.length) {
      var rSites = await fetch(url + '/rest/v1/sites', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(sitesToInsert)
      });
      if (!rSites.ok) {
        // Non bloquant si la table n'existe pas encore
        console.warn('[Onboarding] sites insert:', rSites.status);
      }
    }

    // 2. Insérer les enceintes
    var encsToInsert = _encs.filter(function(e){ return e && e.nom && e.nom.trim(); }).map(function(e){
      return {
        tenant_id:   tenantId,
        nom:         e.nom.trim(),
        type:        e.type,
        temp_min:    e.min,
        temp_max:    e.max
      };
    });

    if (encsToInsert.length) {
      var rEncs = await fetch(url + '/rest/v1/enceintes', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(encsToInsert)
      });
      if (!rEncs.ok) {
        console.warn('[Onboarding] enceintes insert:', rEncs.status);
      }
    }

    // 3. Mettre à jour le sommaire
    var nbSites = sitesToInsert.length;
    var nbEncs  = encsToInsert.length;
    var sumEl   = document.getElementById('done-summary');
    if (sumEl) {
      var parts = [];
      if (nbSites) parts.push(nbSites + ' cuisine' + (nbSites > 1 ? 's' : ''));
      if (nbEncs)  parts.push(nbEncs  + ' enceinte' + (nbEncs  > 1 ? 's' : ''));
      var txt = parts.length
        ? (parts.join(' et ') + ' créée' + (nbSites + nbEncs > 1 ? 's' : '') + '.')
        : 'Configuration prête.';
      sumEl.textContent = txt + ' Répondez au questionnaire HACCP pour générer automatiquement votre Plan de Maîtrise Sanitaire.';
    }

    goStep(4);

  } catch(err) {
    console.error('[Onboarding] saveAndContinue:', err);
    goStep(4); // On avance quand même, les données seront saisissables dans l'app
  } finally {
    btn.disabled = false;
    if (label) label.style.display = '';
    if (spin)  spin.style.display  = 'none';
  }
};

/* Bouton "Générer mon PMS" sur step 4 */
document.addEventListener('DOMContentLoaded', function(){
  var btnSave = document.getElementById('btn-save');
  if (btnSave) btnSave.onclick = function(){ window.location.href = 'pms-setup.html'; };
});

/* ─── Helpers ─── */
function showErr(id, msg) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}

function hideErr(id) {
  var el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

})();
