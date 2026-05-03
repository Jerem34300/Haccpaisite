/* app-onboarding.js — Wizard post-inscription */
(function(){

var _session    = {};
var _signupData = {};
var _sites      = [];

var PLAN_MAX_SITES = { solo: 1, multi: 3, enterprise: Infinity };

/* ─── Init ─── */
document.addEventListener('DOMContentLoaded', function(){
  try { _session    = JSON.parse(localStorage.getItem('haccpro_session')    || '{}'); } catch(e){}
  try { _signupData = JSON.parse(localStorage.getItem('haccpro_signup_data') || '{}'); } catch(e){}

  // Badge plan
  var plan   = _session.plan || _signupData.plan || '';
  var planEl = document.getElementById('welcome-plan');
  if (planEl) {
    if      (plan === 'solo')       planEl.textContent = '🎁 Plan Solo activé — essai 14 jours';
    else if (plan === 'multi')      planEl.textContent = '⭐ Plan Multi activé — essai 14 jours';
    else if (plan === 'enterprise') planEl.textContent = '🏢 Plan Entreprise activé — essai 14 jours';
    else                            planEl.textContent = '🎁 Essai gratuit 14 jours activé';
  }

  // Sous-titre step 2 : afficher la limite selon le plan
  var maxSites = PLAN_MAX_SITES[plan] || Infinity;
  var subEl = document.getElementById('step2-sub');
  if (subEl) {
    if (maxSites === 1) {
      subEl.textContent = 'Votre plan Solo inclut 1 cuisine. Saisissez son nom ci-dessous.';
    } else if (isFinite(maxSites)) {
      subEl.textContent = 'Votre plan Multi inclut jusqu\'à ' + maxSites + ' cuisines. Vous pourrez en ajouter d\'autres plus tard depuis le dashboard.';
    } else {
      subEl.textContent = 'Ajoutez le nom de chaque cuisine ou site que vous gérez. Vous pourrez en ajouter d\'autres plus tard.';
    }
  }

  // Masquer bouton "Ajouter" si Solo
  if (maxSites === 1) {
    var btnAdd = document.getElementById('btn-add-site');
    if (btnAdd) btnAdd.style.display = 'none';
  }

  // Pré-ajouter un site avec le nom de l'entreprise si connu
  var companyName = _signupData.company || '';
  addSite(companyName);
});

/* ─── Navigation ─── */
window.goStep = function(to) {
  document.querySelectorAll('.step').forEach(function(s){ s.classList.remove('active'); });
  var el = document.getElementById('step-' + to);
  if (el) el.classList.add('active');

  var titles  = ['', 'Bienvenue !', 'Vos cuisines', 'Cuisines enregistrées !'];
  var progPct = [0, 33, 66, 100];

  var hdTitle = document.getElementById('hd-title');
  var hdStep  = document.getElementById('hd-step');
  var prog    = document.getElementById('progress');

  if (hdTitle) hdTitle.textContent = titles[to] || '';
  if (hdStep)  hdStep.textContent  = to < 3 ? ('Étape ' + to + '/3') : '';
  if (prog)    prog.style.width    = progPct[to] + '%';

  window.scrollTo(0, 0);
};

/* ─── Sites ─── */
window.addSite = function(defaultVal) {
  var plan     = _session.plan || _signupData.plan || '';
  var maxSites = PLAN_MAX_SITES[plan] || Infinity;
  var current  = _sites.filter(function(s){ return s !== null; }).length;

  if (current >= maxSites) {
    showErr('err-2', 'Votre plan ' + (plan || '') + ' est limité à ' + maxSites + ' cuisine' + (maxSites > 1 ? 's' : '') + '.');
    return;
  }

  var idx = _sites.length;
  _sites.push(defaultVal || '');

  var list = document.getElementById('sites-list');
  var row  = document.createElement('div');
  row.className = 'item-row';
  row.dataset.idx = idx;

  var showDel = isFinite(maxSites) ? maxSites > 1 : true;
  row.innerHTML =
    '<input class="item-input" type="text" placeholder="Ex : Cuisine centrale, Brasserie du Vieux-Port…"' +
    ' value="' + _escAttr(defaultVal || '') + '"' +
    ' oninput="updateSite(' + idx + ',this.value)">' +
    (showDel ? '<button class="item-del" onclick="removeSite(' + idx + ',this)" title="Supprimer">✕</button>' : '');

  list.appendChild(row);
  if (!defaultVal) row.querySelector('input').focus();

  // Masquer le bouton "Ajouter" si on a atteint la limite
  var newCount = _sites.filter(function(s){ return s !== null; }).length;
  if (newCount >= maxSites) {
    var btnAdd = document.getElementById('btn-add-site');
    if (btnAdd) btnAdd.style.display = 'none';
  }
};

window.updateSite = function(idx, val) {
  _sites[idx] = val;
};

window.removeSite = function(idx, btn) {
  _sites[idx] = null;
  var row = btn.closest('.item-row');
  if (row) row.remove();

  // Réafficher le bouton "Ajouter" si on est sous la limite
  var plan     = _session.plan || _signupData.plan || '';
  var maxSites = PLAN_MAX_SITES[plan] || Infinity;
  var current  = _sites.filter(function(s){ return s !== null; }).length;
  if (current < maxSites) {
    var btnAdd = document.getElementById('btn-add-site');
    if (btnAdd) btnAdd.style.display = '';
  }
};

/* ─── Sauvegarde ─── */
window.saveAndContinue = function() {
  // Chercher le bouton par tous les IDs possibles (compatibilité cache SW)
  var btn   = document.getElementById('btn-continue-2') || document.getElementById('btn-save');
  var label = document.getElementById('btn-continue-label') || document.getElementById('btn-save-label');
  var spin  = document.getElementById('btn-continue-spin')  || document.getElementById('btn-save-spin');

  hideErr('err-2');

  // Validation : au moins une cuisine nommée
  var sitesToInsert = _sites.filter(function(s){ return s && s.trim(); })
                            .map(function(nom){ return nom.trim(); });

  if (!sitesToInsert.length) {
    showErr('err-2', 'Ajoutez au moins une cuisine.');
    return;
  }

  // Désactiver visuellement le bouton
  if (btn)   btn.disabled = true;
  if (label) label.style.display = 'none';
  if (spin)  spin.style.display  = 'block';

  // Sauvegarder les noms en localStorage immédiatement (pas de blocage réseau)
  try {
    var sd = JSON.parse(localStorage.getItem('haccpro_signup_data') || '{}');
    sd.siteNames = sitesToInsert;
    localStorage.setItem('haccpro_signup_data', JSON.stringify(sd));
  } catch(e) {}

  // Avancer IMMÉDIATEMENT à l'étape suivante — pas d'attente Supabase
  var nb = sitesToInsert.length;
  var sumEl = document.getElementById('done-summary');
  if (sumEl) {
    sumEl.textContent = nb + ' cuisine' + (nb > 1 ? 's' : '') +
      ' enregistrée' + (nb > 1 ? 's' : '') +
      '. Répondez maintenant au questionnaire HACCP pour générer automatiquement votre Plan de Maîtrise Sanitaire.';
  }
  goStep(3);

  // Envoyer à Supabase en arrière-plan (non bloquant)
  _saveSitesBackground(sitesToInsert);
};

function _saveSitesBackground(siteNames) {
  var token    = _session.token || _session.userToken || '';
  var tenantId = _session.tenantId || '';
  if (!token || !tenantId) return;

  var rows = siteNames.map(function(nom){ return { tenant_id: tenantId, nom: nom }; });
  var ctrl = new AbortController();
  setTimeout(function(){ ctrl.abort(); }, 8000);

  fetch(SUPABASE_URL + '/rest/v1/sites', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + token,
      'Prefer':        'return=representation'
    },
    body:   JSON.stringify(rows),
    signal: ctrl.signal
  }).then(function(r) {
    if (!r.ok) { console.warn('[Onboarding] sites insert:', r.status); return; }
    return r.json();
  }).then(function(created) {
    if (!created || !created.length) return;
    var sd = JSON.parse(localStorage.getItem('haccpro_signup_data') || '{}');
    sd.siteIds       = created.map(function(s){ return s.id; });
    sd.primarySiteId = created[0] && created[0].id;
    localStorage.setItem('haccpro_signup_data', JSON.stringify(sd));
  }).catch(function(e){ console.warn('[Onboarding] bg insert failed:', e.message); });
};

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

function _escAttr(s) {
  return (s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

})();
