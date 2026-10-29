/* ============================================================================
   FORGE CORE STOCK · cargador de Lottie (nube)
   ----------------------------------------------------------------------------
   Un solo montador para la app y para la landing. Resuelve cuatro cosas que
   `lottie.loadAnimation` no resuelve sola:

     1. el JSON se pide UNA vez y queda en memoria (varias instancias del mismo
        archivo no repiten la descarga);
     2. si no hay `lottie` o el archivo falla, el hueco queda con una marca
        estática en vez de un rectángulo vacío;
     3. con `prefers-reduced-motion` se detiene en un fotograma fijo;
     4. lo que está fuera de pantalla no se dibuja (IntersectionObserver), que
        en un teléfono es la diferencia entre 4 animaciones y 1.

   No depende de nada más. Se usa desde `data-lottie="ruta.json"`.
   ========================================================================== */
(() => {
  'use strict';

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cache = new Map();
  const vivos = new Set();
  let visor = null;

  function pedir(ruta) {
    if (cache.has(ruta)) return cache.get(ruta);
    const p = fetch(ruta, { cache: 'force-cache' }).then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
    cache.set(ruta, p);
    // Si falla, no se memoriza el error: un reintento puede funcionar.
    p.catch(() => cache.delete(ruta));
    return p;
  }

  function fallo(nodo) {
    nodo.classList.add('fallo');
    if (!nodo.querySelector('.lot-fallback')) {
      const marca = document.createElement('span');
      marca.className = 'lot-fallback';
      marca.setAttribute('aria-hidden', 'true');
      marca.textContent = '◍';
      nodo.appendChild(marca);
    }
  }

  function montar(nodo) {
    if (!nodo || nodo.dataset.lot === 'on') return;
    nodo.dataset.lot = 'on';
    const ruta = nodo.dataset.lottie;
    if (!ruta) return fallo(nodo);
    if (!window.lottie) return fallo(nodo);

    pedir(ruta).then(datos => {
      if (!nodo.isConnected) return;
      const anim = window.lottie.loadAnimation({
        container: nodo,
        renderer: 'svg',
        loop: nodo.dataset.loop === '1',
        autoplay: !reduce,
        animationData: datos,
        rendererSettings: { progressiveLoad: true, hideOnTransparent: true }
      });
      nodo._lot = anim;
      vivos.add(anim);
      anim.addEventListener('DOMLoaded', () => {
        nodo.classList.add('listo');
        if (reduce) anim.goToAndStop(Math.round(anim.totalFrames * 0.33), true);
      });
      // Datos corruptos: lottie avisa por acá en algunas versiones.
      anim.addEventListener('data_failed', () => fallo(nodo));
      if (visor) visor.observe(nodo);
    }).catch(() => fallo(nodo));
  }

  function montarTodos(raiz = document) {
    raiz.querySelectorAll('[data-lottie]').forEach(montar);
  }

  if ('IntersectionObserver' in window) {
    visor = new IntersectionObserver(entradas => {
      entradas.forEach(e => {
        const anim = e.target._lot;
        if (!anim) return;
        if (e.isIntersecting) { if (!reduce) anim.play(); }
        else anim.pause();
      });
    }, { rootMargin: '80px 0px' });
  }

  document.addEventListener('visibilitychange', () => {
    vivos.forEach(a => { try { document.hidden ? a.pause() : (reduce ? null : a.play()); } catch (_) {} });
  });

  window.FabriLottie = { montar, montarTodos };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => montarTodos());
  } else {
    montarTodos();
  }
})();