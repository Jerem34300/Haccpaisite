/* HACC.PRO — animation de la jauge "live" du hero
   Démarre quand le hero est visible (IntersectionObserver), respecte reduce-motion. */
(function(){
  'use strict';
  var ARC = 289;            // longueur de l'arc (demi-cercle r=92)
  var MIN = -10, MAX = 15;  // plage de température affichée
  var FROM = 11, TARGET = 3;// on plonge d'une valeur "chaude" vers le vert conforme (0–4°C)

  function pct(t){ return (t - MIN) / (MAX - MIN); }   // 0..1

  function init(){
    var fill  = document.getElementById('gaugeFill');
    var val   = document.getElementById('gaugeVal');
    var stamp = document.getElementById('gaugeStamp');
    if(!fill || !val) return;

    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function setFill(t){ fill.style.strokeDashoffset = ARC - pct(t)*ARC; }

    if(reduce){
      setFill(TARGET); val.textContent = TARGET;
      if(stamp) stamp.classList.add('on');
      return;
    }

    var started = false;
    function run(){
      if(started) return; started = true;
      fill.style.transition = 'none';
      setFill(FROM);
      val.textContent = FROM;
      void fill.getBoundingClientRect();
      requestAnimationFrame(function(){
        fill.style.transition = '';
        setFill(TARGET);
        var dur = 2100, t0 = null;
        (function tick(ts){
          if(t0===null) t0 = ts;
          var k = Math.min((ts - t0)/dur, 1);
          var eased = 1 - Math.pow(1-k, 3);
          var cur = FROM + (TARGET - FROM)*eased;
          val.textContent = (Math.round(cur*10)/10).toString().replace('.', ',');
          if(k < 1) requestAnimationFrame(tick);
          else { val.textContent = TARGET; if(stamp) stamp.classList.add('on'); }
        })(performance.now());
      });
    }

    var hero = document.querySelector('.hero');
    if('IntersectionObserver' in window && hero){
      var io = new IntersectionObserver(function(es){
        es.forEach(function(e){ if(e.isIntersecting){ run(); io.disconnect(); } });
      }, {threshold:.3});
      io.observe(hero);
    } else { run(); }
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* Offre de lancement (code HACCBETA) — masque automatiquement le bandeau et
   les prix promo une fois les 20 rédemptions Stripe épuisées. Le HTML est
   déjà rendu en état "offre active" par défaut : si l'appel échoue ou est
   lent, rien ne change (fail-open), pas de flash de contenu. */
(function(){
  'use strict';
  try{
    function apply(active){
      document.querySelectorAll('.beta-offer').forEach(function(el){
        el.style.display = active ? '' : 'none';
      });
      document.querySelectorAll('.beta-fallback').forEach(function(el){
        el.style.display = active ? 'none' : 'flex';
      });
    }
    fetch('/.netlify/functions/beta-offer-status')
      .then(function(r){ return r.ok ? r.json() : { active: true }; })
      .then(function(data){ apply(!data || data.active !== false); })
      .catch(function(){ /* offline / erreur réseau : on garde l'affichage par défaut */ });
  }catch(e){}
})();

/* Apparition progressive des blocs au scroll — dégrade en gracieux si
   IntersectionObserver est absent ou si l'utilisateur préfère moins d'animations. */
(function(){
  'use strict';
  try{
    function init(){
      var els = document.querySelectorAll('.feature-card,.problem-card,.price-card,.testi-card,.how-step,.stat-card,.section-header');
      if(!els.length) return;
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      els.forEach(function(el, i){
        el.classList.add('reveal-init');
        el.style.transitionDelay = (Math.min(i % 4, 3) * 80) + 'ms';
      });
      if(reduce || !('IntersectionObserver' in window)){
        els.forEach(function(el){ el.classList.add('is-visible'); });
        return;
      }
      var io = new IntersectionObserver(function(entries){
        entries.forEach(function(entry){
          if(entry.isIntersecting){ entry.target.classList.add('is-visible'); io.unobserve(entry.target); }
        });
      }, { threshold:.15, rootMargin:'0px 0px -40px 0px' });
      els.forEach(function(el){ io.observe(el); });
    }
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }catch(e){}
})();
