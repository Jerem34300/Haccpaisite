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
