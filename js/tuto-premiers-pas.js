/* tuto-premiers-pas.js — Guide « Premiers pas » sur l'accueil de la tablette (oct. 2026)
   Affiché après l'inscription (S.config.tutoStart posé par app-onboarding.js) ou sur un compte
   encore vierge. Chaque étape se coche toute seule dès que la saisie correspondante existe.
   « Masquer le guide » → S.config.tutoDone = true (synchronisé avec la config du site). */
(function(){

function _visible(id){
  try { return typeof navOrder !== 'function' || navOrder().indexOf(id) >= 0; } catch(e){ return true; }
}
function _lignes(sec){
  try { return ((S[sec] || {}).lignes || []).filter(function(r){ return !r._deleted; }); } catch(e){ return []; }
}
function _hasMenu(){
  try {
    var m = S.menus || {};
    return Object.keys(m).some(function(k){
      var c = (m[k] && m[k].categories) || {};
      return Object.keys(c).some(function(cat){ return (c[cat] || []).length > 0; });
    });
  } catch(e){ return false; }
}
function _hasEnc(){
  try { return (((S.enr19 || {}).saisies) || []).length > 0; } catch(e){ return false; }
}

var STEPS = [
  { id:'profil', ico:'👤', titre:'Choisis ton profil',
    aide:'Touche le rond en haut à droite et choisis ton prénom : chaque saisie sera signée à ton nom.',
    btn:'Choisir mon profil', go:function(){ try { openSessModal(); } catch(e){ console.warn('[tuto] profil:', e); } },
    done:function(){ try { return !!getActiveSession(); } catch(e){ return false; } } },
  { id:'enceintes', ico:'🌡️', titre:'Relève tes enceintes froides',
    aide:'À l\'ouverture, touche chaque enceinte et note sa température. Si elle est hors consigne, l\'app te demande une action corrective et crée la non-conformité.',
    btn:'Relever les températures', go:function(){
      try {
        var el = document.querySelector('.qenc-tile');
        if (el) el.scrollIntoView({ behavior:'smooth', block:'center' }); else goTo('enr19');
      } catch(e){ console.warn('[tuto] enceintes:', e); }
    },
    done:_hasEnc, page:'enr19' },
  { id:'menu', ico:'🍽️', titre:'Enregistre le menu du jour',
    aide:'Ajoute les plats du midi et du soir (ou dicte-les avec 🎤). Coche « Mixé » si besoin : les fiches à remplir pour chaque plat apparaîtront ensuite sur l\'accueil.',
    btn:'Saisir le menu', go:function(){ try { goTo('menu_jour'); } catch(e){ console.warn('[tuto] menu:', e); } },
    done:_hasMenu },
  { id:'reception', ico:'📦', titre:'Contrôle une livraison',
    aide:'À chaque livraison : fournisseur et n° de BL, puis pour chaque produit la température, le lot et la DLC. Un produit non conforme crée une fiche de non-conformité.',
    btn:'Contrôler une réception', go:function(){ try { goTo('enr23'); } catch(e){ console.warn('[tuto] réception:', e); } },
    done:function(){ return _lignes('enr23').length > 0; }, page:'enr23' },
  { id:'mp', ico:'📋', titre:'Trace tes matières premières',
    aide:'Quand tu ouvres un produit, garde la trace de son lot : photo ou saisie de l\'étiquette (produit, lot, DLC, estampille).',
    btn:'Tracer un produit', go:function(){ try { goTo('enr31'); } catch(e){ console.warn('[tuto] traça MP:', e); } },
    done:function(){ return _lignes('enr31').length > 0; }, page:'enr31' },
  { id:'plats', ico:'🍱', titre:'Remplis les fiches de tes plats',
    aide:'Sur la page Menu, « Générer plats témoins » crée un témoin par plat. Sur l\'accueil, chaque plat a ses pastilles (témoin, remise T°C, mixé) : touche-les pour remplir la fiche, elles se cochent toutes seules.',
    btn:'Ouvrir le menu', go:function(){ try { goTo('menu_jour'); } catch(e){ console.warn('[tuto] plats:', e); } },
    done:function(){ return _lignes('enr33').length > 0; }, page:'enr33' },
  { id:'nettoyage', ico:'🧹', titre:'Valide un nettoyage',
    aide:'Le plan de nettoyage te montre ce qui est à faire maintenant. Une tâche faite = « ✓ Fait », en un geste.',
    btn:'Voir le nettoyage', go:function(){ try { goTo('enr28'); } catch(e){ console.warn('[tuto] nettoyage:', e); } },
    done:function(){ try { return (S.nett_val || []).length > 0; } catch(e){ return false; } }, page:'enr28' }
];

function _steps(){
  return STEPS.filter(function(st){ return !st.page || _visible(st.page); });
}

function _actif(){
  try {
    var c = S.config || {};
    if (c.tutoDone) return false;
    if (c.tutoStart) return true;
    // Compte encore vierge (créé avant le guide) : on le propose aussi
    return !_hasEnc() && _lignes('enr23').length === 0 && !_hasMenu();
  } catch(e){ return false; }
}

window.tutoGo = function(id){
  var st = STEPS.filter(function(s){ return s.id === id; })[0];
  if (st) st.go();
};
window.tutoMasquer = function(){
  try {
    S.config = S.config || {};
    S.config.tutoDone = true;
    save();
    try { if (typeof _saveConfigToSupabase === 'function') _saveConfigToSupabase(); } catch(e){ console.warn('[tuto] sync config:', e); }
    renderMain();
  } catch(e){ console.warn('[tuto] masquer:', e); }
};
window.tutoRelancer = function(){
  try {
    S.config = S.config || {};
    S.config.tutoDone = false;
    S.config.tutoStart = true;
    save();
    try { if (typeof _saveConfigToSupabase === 'function') _saveConfigToSupabase(); } catch(e){ console.warn('[tuto] sync config:', e); }
    goTo('accueil');
  } catch(e){ console.warn('[tuto] relancer:', e); }
};

window.renderPremiersPas = function(){
  try {
    if (!_actif()) return '';
    var steps = _steps();
    var etats = steps.map(function(st){ var d = false; try { d = !!st.done(); } catch(e){} return d; });
    var nbOk = etats.filter(Boolean).length;
    var cur = etats.indexOf(false);
    var pct = Math.round(nbOk * 100 / steps.length);
    var fini = cur < 0;

    var items = steps.map(function(st, i){
      var ok = etats[i], isCur = i === cur;
      var head = '<div style="display:flex;align-items:center;gap:8px">'
        + '<span style="flex:none;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:900;'
        + (ok ? 'background:#16a34a;color:#fff">✓' : (isCur ? 'background:#5C1E5A;color:#fff">' + (i + 1) : 'background:#f1e6f1;color:#7A6579">' + (i + 1)))
        + '</span>'
        + '<span style="font-size:.86rem;font-weight:' + (isCur ? '900' : '800') + ';color:' + (ok ? '#166534' : '#3b1e3b') + (ok ? ';text-decoration:line-through;text-decoration-color:#86efac' : '') + '">'
        + st.ico + ' ' + st.titre + '</span>'
        + (!ok && !isCur ? '<button type="button" onclick="tutoGo(\'' + st.id + '\')" style="margin-left:auto;background:none;border:none;color:#7A6579;font-size:.75rem;font-weight:800;cursor:pointer;font-family:inherit">Ouvrir ›</button>' : '')
        + '</div>';
      var body = isCur
        ? '<div style="margin:6px 0 2px 32px">'
          + '<div style="font-size:.78rem;color:#4a3a4a;line-height:1.45;margin-bottom:8px">' + st.aide + '</div>'
          + '<button type="button" onclick="tutoGo(\'' + st.id + '\')" style="background:#5C1E5A;color:#fff;border:none;border-radius:10px;padding:9px 14px;font-size:.82rem;font-weight:900;cursor:pointer;font-family:inherit;touch-action:manipulation">' + st.btn + ' →</button>'
          + '</div>'
        : '';
      return '<div style="padding:7px 0;border-bottom:1px dashed #ecdcec">' + head + body + '</div>';
    }).join('');

    return '<div class="card" style="border:2px solid #d8b4d8;background:linear-gradient(135deg,#fdf4fd,#fff);margin-bottom:12px">'
      + '<div style="display:flex;align-items:center;gap:10px">'
      + '<span style="font-size:1.5rem">' + (fini ? '🎉' : '🚀') + '</span>'
      + '<div style="flex:1;min-width:0">'
      + '<div style="font-size:.95rem;font-weight:900;color:#5C1E5A">' + (fini ? 'Bravo, ta cuisine est lancée !' : 'Premiers pas avec HACC.PRO') + '</div>'
      + '<div style="font-size:.7rem;font-weight:700;color:#7A6579">' + (fini ? 'Tu connais tous les gestes du quotidien.' : 'Les gestes du quotidien, dans l\'ordre de la journée') + ' · ' + nbOk + '/' + steps.length + '</div>'
      + '</div></div>'
      + '<div style="height:7px;background:#f1e6f1;border-radius:999px;overflow:hidden;margin:9px 0 4px"><div style="height:100%;width:' + pct + '%;background:' + (fini ? '#16a34a' : '#5C1E5A') + ';border-radius:999px"></div></div>'
      + items
      + '<div style="display:flex;justify-content:flex-end;margin-top:8px">'
      + '<button type="button" onclick="tutoMasquer()" style="background:' + (fini ? '#16a34a' : 'none') + ';color:' + (fini ? '#fff' : '#7A6579') + ';border:' + (fini ? 'none' : '1px solid #d8b4d8') + ';border-radius:9px;padding:7px 12px;font-size:.75rem;font-weight:800;cursor:pointer;font-family:inherit">'
      + (fini ? 'Terminer le guide ✓' : 'Masquer le guide') + '</button>'
      + '</div>'
      + '</div>';
  } catch(e){
    console.warn('[tuto] renderPremiersPas:', e);
    return '';
  }
};

})();
