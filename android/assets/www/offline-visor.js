/* FORGE CORE STOCK · OfflineVisor
 * ============================================================================
 * Caché OFFLINE de los datos del visor 3D (tienda3d.js).
 *
 * QUÉ pide el visor por URL (revisado en tienda3d.js):
 *   El visor es 100% PROCEDURAL: las cajas, carátulas de producto, estantes y
 *   el local se dibujan con geometría y canvas; NO carga modelos (.gltf/.obj)
 *   ni fotos de producto por URL. Sus ÚNICOS recursos externos son 4 texturas
 *   HD CC0 en `./texturas/` (muro/metal, difusa + normal). Por eso `cachear`
 *   guarda esas texturas y, además, un JSON con la lista de productos que el
 *   que llama quiera dejar precargados (para que la UI sepa qué hay offline).
 *
 * POR QUÉ una caché propia y no sw.js:
 *   sw.js cachea el shell del MISMO ORIGEN con la clave `fcore-vNNN`. Aquí se
 *   usa `offline-visor-v1`, separada, para no chocar con el shell ni con el
 *   mapa (`offline-mapa-v1`). No se edita sw.js.
 *
 * DEGRADACIÓN:
 *   Si `caches` (Cache Storage) no existe, se degrada a localStorage con un
 *   JSON (lista de productos + urls) y se avisa por `progreso`/`estado.aviso`.
 *   En ese modo NO se guardan binarios (localStorage no sirve para imágenes):
 *   se conserva el inventario de recursos como referencia, no los bytes.
 *
 * NO descarga nada al abrir la app: sólo al llamar `OfflineVisor.cachear(...)`.
 *
 * API pública (window.OfflineVisor):
 *   cachear(productos, progreso?) -> Promise<resumen>
 *   estado()                      -> Promise<{productos,recursos,bytes,fallos,ultima,aviso?}>
 *   cubierto(codigo)              -> Promise<bool>
 *   limpiar()                     -> Promise<void>
 * ========================================================================== */
window.OfflineVisor = (function () {
  'use strict';

  const CACHE = 'offline-visor-v1';
  const LS = 'offline-visor-v1';          // respaldo JSON si no hay Cache Storage
  const CLAVE_MANIFIESTO = '__manifesto__'; // entrada especial con el JSON de la lista
  const MAX_CONCURRENT = 4;

  // Texturas HD reales del visor (tienda3d.js → RUTAS_TEX). Se resuelven contra
  // el baseURI de la página; se cachean siempre porque el visor las necesita.
  const TEXTURAS = [
    './texturas/muro-diff.jpg', './texturas/muro-nor.jpg',
    './texturas/metal-diff.jpg', './texturas/metal-nor.jpg'
  ];

  let ultima = null;

  /* ── helpers ───────────────────────────────────────────────────────────── */

  // Normaliza un producto a {codigo, recursos:[url...]}. Acepta varias formas:
  //   · {codigo, recursos:[...]}  · {codigo, imagen:'url'}  · {codigo, texturas:[...]}
  //   · string (se toma como codigo, sin recursos propios)
  function normalizarProducto(p) {
    if (p == null) return { codigo: null, recursos: [] };
    if (typeof p === 'string') return { codigo: p, recursos: [] };
    const codigo = p.codigo != null ? String(p.codigo) : (p.id != null ? String(p.id) : null);
    const recursos = [];
    if (Array.isArray(p.recursos)) recursos.push.apply(recursos, p.recursos);
    if (Array.isArray(p.texturas)) recursos.push.apply(recursos, p.texturas);
    if (typeof p.imagen === 'string') recursos.push(p.imagen);
    if (typeof p.textura === 'string') recursos.push(p.textura);
    return { codigo: codigo, recursos: recursos };
  }

  // URL absoluta a partir de una ruta relativa (./texturas/... , /x, http...).
  function abs(u) {
    try { return new URL(u, document.baseURI).href; } catch (e) { return String(u); }
  }

  // Recursos de un producto (absolutos y sin duplicados), + texturas base.
  function recursosProducto(p) {
    const set = [];
    const ver = (u) => { const a = abs(u); if (set.indexOf(a) < 0) set.push(a); };
    TEXTURAS.forEach(ver);
    p.recursos.forEach(ver);
    return set;
  }

  /* ── API pública ───────────────────────────────────────────────────────── */

  /**
   * Guarda en caché los recursos del visor (texturas HD + lo que traiga cada
   * producto) y un JSON con la lista. Si un recurso falla, se registra en
   * `fallos` y se sigue con el resto (no se aborta la tanda).
   * `progreso({hechos,total,pct,bytes,fallos,cortado?})` por cada recurso.
   */
  async function cachear(productos, progreso) {
    const lista = (Array.isArray(productos) ? productos : []).map(normalizarProducto);

    // Junta todos los recursos únicos a descargar (texturas + por producto).
    const recursos = [];
    const ver = (u) => { if (recursos.indexOf(u) < 0) recursos.push(u); };
    TEXTURAS.forEach(function (t) { ver(abs(t)); });
    lista.forEach(function (p) { recursosProducto(p).forEach(ver); });

    const total = recursos.length;
    const fallos = [];
    const bytesPorRecurso = {};   // para el estado, sin re-medir bodies
    let hechos = 0, bytes = 0, i = 0;

    // Sin Cache Storage: degradar a localStorage con el JSON (sin binarios).
    if (!('caches' in window)) {
      const aviso = 'Cache Storage no disponible: se guarda sólo el inventario JSON en localStorage (los binarios no se cachean).';
      // Se guarda la lista de CÓDIGOS (no los objetos) para que `cubierto()`
      // y `estado()` hablen el mismo idioma que la ruta con Cache Storage.
      const codigos = lista.map(function (p) { return p.codigo; }).filter(function (c) { return c != null; });
      const json = { productos: codigos, recursos: recursos, bytes: 0, fallos: [], ultima: Date.now(), aviso: aviso };
      try { localStorage.setItem(LS, JSON.stringify(json)); } catch (e) { /* cuota */ }
      ultima = json.ultima;
      if (progreso) progreso({ hechos: 0, total: total, pct: 100, bytes: 0, fallos: fallos, aviso: aviso });
      return { productos: lista.length, recursos: total, bytes: 0, fallos: fallos, aviso: aviso, degradado: true };
    }

    const cache = await caches.open(CACHE);

    async function worker() {
      while (true) {
        const idx = i++;
        if (idx >= recursos.length) return;
        const url = recursos[idx];
        try {
          const res = await fetch(url, { mode: 'cors' });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const copia = res.clone();
          const blob = await res.blob();
          await cache.put(url, copia);
          bytes += blob.size;
          bytesPorRecurso[url] = blob.size;
          hechos++;
        } catch (e) {
          // Recurso fallido: se registra y se sigue con el resto.
          fallos.push({ url: url, error: String(e && e.message || e) });
        }
        if (progreso) progreso({ hechos: hechos, total: total, pct: total ? Math.round(hechos / total * 100) : 100, bytes: bytes, fallos: fallos });
      }
    }
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, total || 1) }, worker));

    // JSON con la lista de productos cubiertos (sólo los que quedaron completos).
    const cubiertos = lista.filter(function (p) {
      return recursosProducto(p).every(function (u) { return bytesPorRecurso[abs(u)] != null; });
    }).map(function (p) { return p.codigo; });

    const manifiesto = { productos: cubiertos, recursos: recursos, bytes: bytes, fallos: fallos, ultima: Date.now() };
    try {
      await cache.put(CLAVE_MANIFIESTO, new Response(JSON.stringify(manifiesto), {
        headers: { 'Content-Type': 'application/json' }
      }));
    } catch (e) { /* cuota: el manifiesto es opcional, los recursos ya están */ }

    ultima = manifiesto.ultima;
    return { productos: cubiertos.length, recursos: total, bytes: bytes, fallos: fallos, ultima: ultima, degradado: false };
  }

  /** Estado agregado: cuenta recursos cacheados, bytes y fallos del manifiesto. */
  async function estado() {
    if (!('caches' in window)) {
      let json = null;
      try { json = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) { json = null; }
      return {
        productos: json ? (json.productos ? json.productos.length : 0) : 0,
        recursos: json && json.recursos ? json.recursos.length : 0,
        bytes: 0,
        fallos: json && json.fallos ? json.fallos.length : 0,
        ultima: json ? json.ultima : ultima,
        aviso: json ? json.aviso : 'Sin Cache Storage y sin datos previos.'
      };
    }
    const cache = await caches.open(CACHE);
    const reqs = await cache.keys();
    let bytes = 0, fallos = 0, ultimaMs = ultima, productos = 0;
    for (let k = 0; k < reqs.length; k++) {
      const url = reqs[k].url;
      if (url.indexOf(CLAVE_MANIFIESTO) >= 0 || /__manifesto__$/.test(url)) {
        try {
          const m = await (await cache.match(reqs[k])).json();
          productos = m.productos ? m.productos.length : 0;
          fallos = m.fallos ? m.fallos.length : 0;
          ultimaMs = m.ultima || ultimaMs;
          bytes += m.bytes || 0;
        } catch (e) { /* manifiesto roto: se ignora */ }
        continue;
      }
      try { const r = await cache.match(reqs[k]); if (r) bytes += (await r.blob()).size; } catch (e) { /* seguir */ }
    }
    // Si no hay manifiesto, los "recursos" son las entradas reales de la caché
    // (descontando la entrada del propio manifiesto).
    return {
      productos: productos,
      recursos: Math.max(0, reqs.length - countManifest(reqs)),
      bytes: bytes,
      fallos: fallos,
      ultima: ultimaMs
    };
  }

  function countManifest(reqs) {
    let n = 0;
    for (let k = 0; k < reqs.length; k++) if (/__manifesto__$/.test(reqs[k].url)) n++;
    return n;
  }

  /** ¿El producto (código) está cubierto por la caché? */
  async function cubierto(codigo) {
    if (codigo == null) return false;
    const clave = String(codigo);
    if (!('caches' in window)) {
      try {
        const json = JSON.parse(localStorage.getItem(LS) || 'null');
        return !!(json && json.productos && json.productos.indexOf(clave) >= 0);
      } catch (e) { return false; }
    }
    const cache = await caches.open(CACHE);
    const m = await cache.match(CLAVE_MANIFIESTO);
    if (!m) return false;
    try {
      const man = await m.json();
      return !!(man.productos && man.productos.indexOf(clave) >= 0);
    } catch (e) { return false; }
  }

  /** Borra SOLO esta caché (no toca el shell ni la del mapa). */
  async function limpiar() {
    if ('caches' in window) await caches.delete(CACHE);
    try { localStorage.removeItem(LS); } catch (e) { /* sin localStorage */ }
    ultima = null;
  }

  return {
    cachear: cachear,
    estado: estado,
    cubierto: cubierto,
    limpiar: limpiar,
    CACHE: CACHE,
    TEXTURAS: TEXTURAS.slice()
  };
})();