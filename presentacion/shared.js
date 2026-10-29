/* ============================================================
   FORGE CORE STOCK · shared.js
   Barra de progreso de scroll + spotlight de tarjetas.
   Sin dependencias. Si GSAP no carga, revela el contenido.
   ============================================================ */
(function () {
  'use strict';

  var root = document.documentElement;

  /* ---------- Barra de progreso ---------- */
  if (document.body) {
    var bar = document.createElement('div');
    bar.className = 'scroll-progress';
    bar.setAttribute('aria-hidden', 'true');
    var fill = document.createElement('span');
    bar.appendChild(fill);
    document.body.appendChild(bar);

    var ticking = false;
    var update = function () {
      var doc = document.documentElement;
      var max = doc.scrollHeight - doc.clientHeight;
      var p = max > 0 ? Math.min(1, Math.max(0, doc.scrollTop / max)) : 0;
      fill.style.transform = 'scaleX(' + p.toFixed(4) + ')';
      ticking = false;
    };

    window.addEventListener('scroll', function () {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    }, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  /* ---------- Spotlight de las tarjetas ---------- */
  document.querySelectorAll('.launcher-card').forEach(function (card) {
    card.addEventListener('pointermove', function (e) {
      var r = card.getBoundingClientRect();
      card.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(2) + '%');
      card.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(2) + '%');
    });
    card.addEventListener('pointerleave', function () {
      card.style.removeProperty('--mx');
      card.style.removeProperty('--my');
    });
  });

  /* ---------- Fallback sin GSAP ---------- */
  if (!window.gsap) {
    root.classList.add('no-gsap');
    window.setTimeout(function () {
      document.querySelectorAll('.launcher-card, .motion-reveal, .motion-scale, .motion-slide-left, .motion-slide-right').forEach(function (el) {
        el.style.opacity = '1';
        el.style.transform = 'none';
      });
    }, 80);
  }
})();
