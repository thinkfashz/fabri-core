/* FORGE CORE STOCK · doctor de cliente
   ---------------------------------------------------------------------------
   Mide lo que de verdad le pasa a la página en el navegador:
     · errores de JavaScript (con archivo:línea:columna y stack acotado);
     · promesas rechazadas;
     · recursos que no cargan (JS, CSS, imágenes);
     · fallos de API que le pasa el cliente HTTP del panel;
     · esqueletos que siguen visibles a los 15 s (pantalla atascada);
     · páginas lentas (> 4 s de carga).

   Economía:
     · máximo 12 eventos por carga y 3 repeticiones del mismo problema;
     · un latido por página y día (localStorage);
     · el cuerpo se manda en un solo POST, con keepalive/sendBeacon;
     · nunca se manda correo, token, hash largo ni la URL con query.

   Se carga como script clásico en la PWA (antes de app.js) y como módulo
   desde el panel (`import('/doctor.js')`). Por eso no usa export ni import:
   funciona igual en los dos mundos. Expone `window.FCoreDoctor`.
   --------------------------------------------------------------------------- */
(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__fcoreDoctorCargado) return;
  window.__fcoreDoctorCargado = true;
  if (window.FCoreDoctorDesactivado) return;

  var API = 'https://fabri-api.vercel.app/api/diagnostico';
  var VERSION = 1;
  var MAX_EVENTOS = 12;
  var MAX_REPETICIONES = 3;
  var MAX_TEXTO = 700;

  var LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) ||
    location.protocol === 'file:' ||
    Boolean(navigator.webdriver);

  var cola = [];
  var enviados = {};
  var temporizador = null;
  var enviando = false;

  /* ── almacenamiento seguro (modo privado puede lanzar) ────────────────── */

  function leer(clave) {
    try { return localStorage.getItem(clave); } catch (_) { return null; }
  }

  function guardar(clave, valor) {
    try { localStorage.setItem(clave, valor); } catch (_) { /* sin espacio */ }
  }

  function fecha() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function pagina() {
    var p = location.pathname.replace(/\/index\.html$/, '/');
    if (p.length > 1) p = p.replace(/\/+$/, '');
    return p || '/';
  }

  /* ── limpieza: el doctor no puede ser una fuga de datos ───────────────── */

  function limpiar(v, max) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/eyJ[A-Za-z0-9._-]{10,}/g, '‹token›')
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '‹correo›')
      .replace(/\b[a-f0-9]{32,}\b/gi, '‹hash›')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max || MAX_TEXTO);
  }

  function numero(v, min, max) {
    var n = Number(v);
    if (!isFinite(n)) return 0;
    return Math.max(min, Math.min(max, Math.round(n)));
  }

  /** Solo mismo origen o la API: nada de extensiones ni CDNs de terceros. */
  function ruta(u) {
    if (!u) return '';
    var s = String(u);
    if (/^(chrome-extension|moz-extension|safari-extension|data|blob|about):/i.test(s)) return '';
    try {
      var url = new URL(s, location.href);
      if (url.origin !== location.origin && url.hostname !== 'fabri-api.vercel.app') return '';
      return url.pathname.slice(0, 160);
    } catch (_) { return ''; }
  }

  function ubicacionStack(stack) {
    var lineas = String(stack || '').split('\n').slice(0, 10);
    for (var i = 0; i < lineas.length; i++) {
      var l = lineas[i];
      // Se salta el propio doctor compartido, no la página /panel/doctor/.
      if (l.indexOf('/panel/doctor/doctor.js') < 0 && l.indexOf('doctor.js') >= 0) continue;
      var abs = l.match(/(https?:\/\/[^\s)]+?):(\d+):(\d+)/);
      if (abs) return { a: ruta(abs[1]), l: Number(abs[2]), c: Number(abs[3]) };
      var rel = l.match(/([\w./@-]+\.(?:js|mjs|ts)):(\d+):(\d+)/);
      if (rel) return { a: limpiar(rel[1], 160), l: Number(rel[2]), c: Number(rel[3]) };
    }
    return {};
  }

  /* ── cola y envío ─────────────────────────────────────────────────────── */

  function meta() {
    var ancho = (window.screen && window.screen.width) || window.innerWidth || 0;
    var alto = (window.screen && window.screen.height) || window.innerHeight || 0;
    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return {
      v: VERSION,
      pantalla: ancho + 'x' + alto,
      conexion: (c && c.effectiveType) || '',
      idioma: limpiar(navigator.language, 12),
    };
  }

  function programar() {
    if (temporizador) return;
    temporizador = setTimeout(function () { flush(false); }, 1500);
  }

  function flush(alSalir) {
    if (temporizador) { clearTimeout(temporizador); temporizador = null; }
    if (!cola.length) return;
    if (enviando && !alSalir) return;

    var lote = cola.splice(0, cola.length);
    var json;
    try {
      json = JSON.stringify({ accion: 'reporte', pagina: pagina(), eventos: lote, meta: meta() });
    } catch (_) { return; }

    // El servidor acepta 8 KB. Se recorta el stack y, si hace falta, el lote.
    while (json.length > 7800 && lote.length > 1) {
      lote.pop();
      json = JSON.stringify({ accion: 'reporte', pagina: pagina(), eventos: lote, meta: meta() });
    }
    if (json.length > 7800 && lote[0] && lote[0].s) {
      lote[0].s = '';
      json = JSON.stringify({ accion: 'reporte', pagina: pagina(), eventos: lote, meta: meta() });
    }
    if (json.length > 7800) return;

    // Al salir, sendBeacon es lo único que el navegador garantiza.
    if (alSalir && navigator.sendBeacon) {
      try {
        var blob = new Blob([json], { type: 'text/plain;charset=UTF-8' });
        if (navigator.sendBeacon(API, blob)) return;
      } catch (_) { /* cae a fetch keepalive */ }
    }

    enviando = true;
    try {
      fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json,
        keepalive: true,
        mode: 'cors',
        credentials: 'omit',
      }).catch(function () { /* el doctor nunca reintenta en bucle */ })
        .then(function () { enviando = false; });
    } catch (_) { enviando = false; }
  }

  function evento(datos) {
    if (!datos) return;
    if (LOCAL) {
      try { console.info('[doctor]', datos.t, datos.m || datos.u || ''); } catch (_) { /* nada */ }
      return;
    }

    var t = limpiar(datos.t || 'error', 20).toLowerCase();
    var m = limpiar(datos.m, 400);
    var a = limpiar(datos.a, 160);
    var u = limpiar(datos.u, 160);
    var l = numero(datos.l, 0, 9_999_999);
    var c = numero(datos.c, 0, 9_999);
    var fp = [t, m, a, l, u].join('|');
    var n = (enviados[fp] || 0) + 1;
    if (n > MAX_REPETICIONES) return;
    enviados[fp] = n;
    if (cola.length >= MAX_EVENTOS) return;

    var e = { t: t, p: pagina() };
    if (m) e.m = m;
    if (a) e.a = a;
    if (l) e.l = l;
    if (c) e.c = c;
    if (u) e.u = u;
    if (datos.s) e.s = limpiar(datos.s, 500);
    if (datos.ms) e.ms = numero(datos.ms, 0, 600_000);
    if (datos.st) e.st = numero(datos.st, 0, 599);
    if (datos.me) e.me = String(datos.me).toUpperCase() === 'POST' ? 'POST' : 'GET';
    cola.push(e);
    programar();
  }

  /* ── capturas ─────────────────────────────────────────────────────────── */

  window.addEventListener('error', function (ev) {
    var objetivo = ev.target;
    if (objetivo && objetivo !== window && (objetivo.src || objetivo.href)) {
      var destino = ruta(objetivo.src || objetivo.href);
      if (!destino) return;
      evento({
        t: 'recurso',
        m: 'No cargó ' + String(objetivo.tagName || 'recurso').toLowerCase(),
        a: destino,
        u: destino,
      });
      return;
    }
    var err = ev.error;
    var ub = ubicacionStack(err && err.stack);
    evento({
      t: 'error',
      m: ev.message || (err && err.message) || 'Error de JavaScript',
      a: ub.a || ruta(ev.filename),
      l: ub.l || ev.lineno || 0,
      c: ub.c || ev.colno || 0,
      s: err && err.stack,
    });
  }, true);

  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev.reason;
    var mensaje = r && (r.message || r.msg);
    if (!mensaje && typeof r === 'string') mensaje = r;
    var ub = ubicacionStack(r && r.stack);
    evento({
      t: 'promesa',
      m: mensaje || 'Promesa rechazada sin mensaje',
      a: ub.a,
      l: ub.l,
      c: ub.c,
      s: r && r.stack,
    });
  });

  /* ── latido, página lenta y esqueletos atascados ──────────────────────── */

  function latido() {
    var clave = 'fcore.doctor.visto.' + fecha() + '.' + pagina().replace(/\//g, '_');
    if (leer(clave)) return;
    guardar(clave, '1');
    evento({ t: 'visto', u: pagina() });
  }

  function revisarCarga() {
    try {
      var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
      var ms = nav && (nav.duration || (nav.loadEventEnd - nav.startTime)) || 0;
      if (ms > 4000) evento({ t: 'lento', ms: Math.round(ms), u: pagina() });
    } catch (_) { /* sin Navigation Timing no se inventa */ }
  }

  function vigilarEsqueletos() {
    setTimeout(function () {
      var nodos = document.querySelectorAll('.ds-skeleton');
      var visibles = [];
      for (var i = 0; i < nodos.length; i++) {
        var n = nodos[i];
        if (n.offsetParent === null) continue;
        var sec = n.closest ? n.closest('section, article, main') : null;
        var nombre = (sec && (sec.id || sec.getAttribute('aria-labelledby'))) || n.className || 'sección';
        visibles.push(String(nombre).split(' ')[0].slice(0, 60));
      }
      if (visibles.length) {
        evento({
          t: 'skeleton',
          m: visibles.length + ' esqueleto(s) sin resolver a los 15 s',
          a: 'DOM',
          u: visibles.slice(0, 3).join(','),
        });
      }
    }, 15_000);
  }

  /* ── API pública para el cliente HTTP y para la página del doctor ─────── */

  function apiFallo(d) {
    if (!d) return;
    evento({
      t: 'api',
      me: d.metodo || 'GET',
      u: ruta(d.url) || d.url || '/api',
      st: d.status || 0,
      ms: d.ms || 0,
      m: d.mensaje || d.codigo || ('HTTP ' + (d.status || 0)),
      a: d.archivo || '',
      l: d.linea || 0,
      c: d.columna || 0,
    });
  }

  window.FCoreDoctor = {
    version: VERSION,
    pagina: pagina,
    evento: evento,
    apiFallo: apiFallo,
    flush: flush,
  };

  latido();
  if (document.readyState === 'complete') revisarCarga();
  else window.addEventListener('load', revisarCarga, { once: true });
  vigilarEsqueletos();

  window.addEventListener('pagehide', function () { flush(true); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush(true);
  });
  // Red de seguridad: si la página sigue abierta, no se acumula para siempre.
  setTimeout(function () { flush(false); }, 8000);
})();
