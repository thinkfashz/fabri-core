/* FORGE CORE STOCK · OfflineMapa
 * ============================================================================
 * Caché OFFLINE de las teselas del mapa (Leaflet/OSM).
 *
 * POR QUÉ existe este archivo (y por qué no toca sw.js):
 *   El service worker (sw.js) sólo intercepta peticiones del MISMO ORIGEN
 *   (`url.origin !== location.origin` → return). Las teselas vienen de
 *   `tile.openstreetmap.org`, que es OTRO origen, así que el SW nunca las
 *   cachea. Para que el mapa funcione sin red hace falta una caché propia y
 *   controlada desde la app: ésta. Usa una clave de Cache Storage separada
 *   (`offline-mapa-v1`) para no chocar ni con el shell (`fcore-vNNN`) ni con
 *   el visor (`offline-visor-v1`).
 *
 * NO descarga nada al abrir la app: sólo cuando el código llame a
 * `OfflineMapa.cachear(...)`. El que conecta el botón/UI es otro agente.
 *
 * API pública (window.OfflineMapa):
 *   cachear(bounds, zoomMin, zoomMax, progreso?) -> Promise<resumen>
 *   cubierto(bounds, zoom)                       -> Promise<{faltan,total,pct}>
 *   estado()                                     -> Promise<{teselas,bytes,ultima,cobertura}>
 *   limpiar()                                    -> Promise<void>
 *   urlTesela(x, y, z)                           -> string
 *   config({ plantilla?, maxTiles?, maxBytes?, maxConcurrent? }) -> void
 * ========================================================================== */
window.OfflineMapa = (function () {
  'use strict';

  // Misma plantilla que usa el mapa real (placer.js → CAPAS.calles[0]).
  // Se deja configurable por si se quiere cachear la capa satélite.
  const PLANTILLA_DEFECTO = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const CACHE = 'offline-mapa-v1';
  const META = 'offline-mapa-meta';   // localStorage: última marca y cobertura

  // Topes de seguridad: sin esto, un rectángulo grande a zoom alto dispara
  // miles de teselas y revienta el almacenamiento del teléfono.
  const MAX_TILES = 400;              // tope de teselas por tanda
  const MAX_BYTES = 40 * 1024 * 1024; // 40 MB de presupuesto
  const MAX_CONCURRENT = 4;           // no saturar la red ni la WebView

  let plantilla = PLANTILLA_DEFECTO;
  let maxTiles = MAX_TILES;
  let maxBytes = MAX_BYTES;
  let maxConcurrent = MAX_CONCURRENT;
  let ultima = leerMeta().ultima || null;
  let ultimaCobertura = leerMeta().cobertura || null;

  /* ── utilidades de teselas (slippy map estándar) ───────────────────────── */

  // Longitud → fracción de tesela en X (0..2^z).
  function lon2x(lon, z) { return (lon + 180) / 360 * Math.pow(2, z); }
  // Latitud → fracción de tesela en Y (proyección Mercator).
  function lat2y(lat, z) {
    const s = Math.sin(lat * Math.PI / 180);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * Math.pow(2, z);
  }

  // Acepta varias formas de "bounds" para no acoplar al que llama:
  //   · objeto Leaflet (getSouth/getWest/... o getSouthWest/getNorthEast)
  //   · {south,west,north,east}  (o abreviado {s,w,n,e})
  //   · [[south,west],[north,east]]  (esquina SO, esquina NE, estilo Leaflet)
  function normalizarBounds(b) {
    if (!b) throw new Error('OfflineMapa: falta bounds');
    if (typeof b.getSouth === 'function' && typeof b.getWest === 'function') {
      return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
    }
    if (typeof b.getSouthWest === 'function') {
      const sw = b.getSouthWest(), ne = b.getNorthEast();
      return { south: sw.lat, west: sw.lng, north: ne.lat, east: ne.lng };
    }
    if (Array.isArray(b) && Array.isArray(b[0])) {
      return { south: b[0][0], west: b[0][1], north: b[1][0], east: b[1][1] };
    }
    if (b.south != null && b.west != null) {
      return { south: b.south, west: b.west, north: b.north, east: b.east };
    }
    if (b.s != null && b.w != null) {
      return { south: b.s, west: b.w, north: b.n, east: b.e };
    }
    throw new Error('OfflineMapa: bounds no reconocido');
  }

  // Lista de teselas {x,y,z,url} que cubren el rectángulo a un zoom dado.
  function teselasDe(bounds, z) {
    const b = normalizarBounds(bounds);
    const n = Math.pow(2, z);
    let x0 = Math.floor(lon2x(b.west, z));
    let x1 = Math.floor(lon2x(b.east, z));
    let y0 = Math.floor(lat2y(b.north, z)); // norte = arriba = y menor
    let y1 = Math.floor(lat2y(b.south, z));
    // Ajuste de bordes: si el rectángulo cruza el antimeridiano o se pasa.
    if (x1 < x0) { const t = x0; x0 = x1; x1 = t; }
    if (y1 < y0) { const t = y0; y0 = y1; y1 = t; }
    x0 = Math.max(0, Math.min(n - 1, x0)); x1 = Math.max(0, Math.min(n - 1, x1));
    y0 = Math.max(0, Math.min(n - 1, y0)); y1 = Math.max(0, Math.min(n - 1, y1));
    const lista = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) lista.push({ x: x, y: y, z: z, url: urlTesela(x, y, z) });
    }
    return lista;
  }

  /* ── API pública ───────────────────────────────────────────────────────── */

  // Misma plantilla que el mapa real. {z}/{x}/{y} se sustituyen por los valores.
  function urlTesela(x, y, z) {
    return plantilla
      .replace('{z}', z).replace('{x}', x).replace('{y}', y);
  }

  // Ajustes en caliente (plantilla satélite, topes). Opcional.
  function config(opts) {
    opts = opts || {};
    if (opts.plantilla) plantilla = opts.plantilla;
    if (opts.maxTiles != null) maxTiles = opts.maxTiles;
    if (opts.maxBytes != null) maxBytes = opts.maxBytes;
    if (opts.maxConcurrent != null) maxConcurrent = Math.max(1, opts.maxConcurrent);
  }

  /**
   * Descarga y guarda en caché todas las teselas del rectángulo entre
   * zoomMin y zoomMax. Respeta tope de teselas y presupuesto de bytes; si se
   * pasa, avisa por `progreso` (campo `cortado`) y corta sin seguir.
   * `progreso({hechos,total,pct,bytes,cortado})` se llama por cada tesela.
   */
  async function cachear(bounds, zoomMin, zoomMax, progreso) {
    if (!('caches' in window)) {
      // Sin Cache Storage no hay dónde guardar teselas binarias. Se avisa y
      // no se finge éxito: el mapa offline no es posible en este entorno.
      const err = new Error('OfflineMapa: Cache Storage no disponible; el mapa offline no se puede cachear.');
      if (progreso) progreso({ hechos: 0, total: 0, pct: 0, bytes: 0, cortado: 'sin-caches', error: err.message });
      throw err;
    }
    const zMin = Math.max(0, zoomMin | 0);
    const zMax = Math.max(zMin, zoomMax | 0);

    // Arma la lista total y aplica el tope de teselas.
    let lista = [];
    for (let z = zMin; z <= zMax; z++) lista = lista.concat(teselasDe(bounds, z));
    const planificado = lista.length;
    let cortado = planificado > maxTiles ? 'tope-teselas' : null;
    if (cortado) lista = lista.slice(0, maxTiles);
    const total = lista.length;

    const cache = await caches.open(CACHE);
    let hechos = 0, bytes = 0, i = 0;

    // Pool de workers: `maxConcurrent` descargas en paralelo como mucho.
    async function worker() {
      while (true) {
        if (cortado && cortado !== 'tope-teselas') return; // ya se cortó por bytes
        const idx = i++;
        if (idx >= lista.length) return;
        const t = lista[idx];
        try {
          const res = await fetch(t.url, { mode: 'cors' });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const copia = res.clone();          // clonar antes de leer el body
          const blob = await res.blob();      // para medir bytes reales
          if (bytes + blob.size > maxBytes) {  // presupuesto agotado: no cachear
            cortado = 'presupuesto-bytes';
            return;
          }
          await cache.put(t.url, copia);
          bytes += blob.size;
          hechos++;
        } catch (e) {
          // Tesela fallida (red, 404, CORS): se salta y se sigue. No rompe la tanda.
        }
        if (progreso) progreso({ hechos: hechos, total: total, pct: total ? Math.round(hechos / total * 100) : 100, bytes: bytes, cortado: cortado });
      }
    }
    await Promise.all(Array.from({ length: Math.min(maxConcurrent, total || 1) }, worker));

    ultima = Date.now();
    const cobertura = { faltan: Math.max(0, total - hechos), total: total, pct: total ? Math.round(hechos / total * 100) : 100 };
    ultimaCobertura = cobertura;
    guardarMeta();
    return { hechos: hechos, total: total, planificado: planificado, bytes: bytes, cortado: cortado, cobertura: cobertura };
  }

  /** Cobertura de un rectángulo a un zoom: cuántas teselas faltan en caché. */
  async function cubierto(bounds, zoom) {
    if (!('caches' in window)) return { faltan: 0, total: 0, pct: 100 };
    const lista = teselasDe(bounds, zoom);
    const cache = await caches.open(CACHE);
    let faltan = 0;
    await Promise.all(lista.map(async (t) => {
      const hit = await cache.match(t.url);
      if (!hit) faltan++;
    }));
    const total = lista.length;
    return { faltan: faltan, total: total, pct: total ? Math.round((total - faltan) / total * 100) : 100 };
  }

  /** Estado agregado de la caché del mapa. */
  async function estado() {
    if (!('caches' in window)) return { teselas: 0, bytes: 0, ultima: ultima, cobertura: ultimaCobertura };
    const cache = await caches.open(CACHE);
    const reqs = await cache.keys();
    let bytes = 0;
    // Medir bytes reales suma el body de cada tesela; se hace una por una para
    // no reventar memoria en teléfonos justos.
    for (let k = 0; k < reqs.length; k++) {
      try { const r = await cache.match(reqs[k]); if (r) bytes += (await r.blob()).size; } catch (e) { /* seguir */ }
    }
    return { teselas: reqs.length, bytes: bytes, ultima: ultima, cobertura: ultimaCobertura };
  }

  /** Borra SOLO esta caché (no toca el shell ni la del visor). */
  async function limpiar() {
    if ('caches' in window) await caches.delete(CACHE);
    ultima = null; ultimaCobertura = null;
    try { localStorage.removeItem(META); } catch (e) { /* sin localStorage */ }
  }

  /* ── metadatos persistentes (última marca + cobertura) ─────────────────── */
  function leerMeta() {
    try { return JSON.parse(localStorage.getItem(META) || '{}'); } catch (e) { return {}; }
  }
  function guardarMeta() {
    try { localStorage.setItem(META, JSON.stringify({ ultima: ultima, cobertura: ultimaCobertura })); } catch (e) { /* cuota */ }
  }

  return {
    cachear: cachear,
    cubierto: cubierto,
    estado: estado,
    limpiar: limpiar,
    urlTesela: urlTesela,
    config: config,
    // Expuestos por comodidad para la UI de estado.
    CACHE: CACHE,
    MAX_TILES: MAX_TILES,
    MAX_BYTES: MAX_BYTES
  };
})();