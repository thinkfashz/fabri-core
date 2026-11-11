/* FORGE CORE STOCK · tráfico dibujado en canvas sobre el mapa
 * ============================================================================
 * Autos que circulan por las calles REALES del mapa, en los dos sentidos.
 *
 * Cómo se logra sin inventar calles:
 *   1. Se piden las vías de la zona visible a Overpass (el mismo
 *      OpenStreetMap que ya alimenta las teselas), con su geometría completa.
 *   2. Cada vía se convierte en una polilínea con longitud acumulada en
 *      metros; se descartan las que no sirven (menos de 2 puntos, menos de
 *      40 m, datos rotos).
 *   3. Se reparten autos a lo largo de cada vía, mitad y mitad en cada
 *      sentido. Cada uno avanza a 25–50 km/h y se dibuja desplazado al carril
 *      de su derecha, así los dos sentidos no se pisan.
 *   4. Cada cuadro se proyecta la posición (lat/lon) a píxeles con el mapa:
 *      si el usuario arrastra o hace zoom, los autos siguen sobre la calle
 *      sin recalcular nada.
 *
 * Decisiones que importan:
 *   · Si Overpass no responde o la zona no tiene calles mapeadas, NO se
 *     dibujan calles falsas: no aparece nada y el estado queda dicho en
 *     `canvas.dataset.trafico` (`sin-red`, `sin-calles`, `muy-lejos`).
 *   · Los autos son simbólicos: se exagera su tamaño (6–15 px) porque a
 *     escala real (4,5 m) serían invisibles. No representan tráfico real,
 *     sólo el flujo de la vía.
 *   · Se pausa con la pestaña oculta y con `prefers-reduced-motion`
 *     (en ese caso quedan quietos, sin animación).
 *   · Se pide una sola vez por zona: caché de 15 minutos y como máximo 10
 *     zonas en memoria. El resultado se reusa al volver al mismo lugar.
 * ========================================================================== */

window.MapaTrafico = (function () {
  'use strict';

  const ESPEJOS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass.osm.jp/api/interpreter'
  ];
  const TIPOS = 'motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street';
  const ZOOM_MIN = 14;          // el mapa abre en 14 al encuadrar los locales
  const MAX_LADO_M = 8000;      // más que eso y los autos serían motas
  const MAX_PUNTOS = 3500;
  const MAX_AUTOS = 60;
  const TTL_MS = 15 * 60 * 1000;
  const MAX_CACHE = 10;
  const ESPERA_MS = 700;        // respiro antes de pedir tras mover el mapa
  const FPS = 30;

  // Paleta neutra con un ámbar suelto: se lee sobre calles claras y satélite.
  const COLORES = ['#E9EBE7', '#D3D7D2', '#A9AFB4', '#F0B65A'];

  /* ── geometría ──────────────────────────────────────────────────────────── */

  /** Distancia aproximada en metros entre dos puntos (equirectangular). */
  function metros(a, b) {
    const R = 6371000;
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad;
    const dLon = (b.lon - a.lon) * rad;
    const mLat = ((a.lat + b.lat) / 2) * rad;
    const x = dLon * Math.cos(mLat);
    return Math.sqrt(dLat * dLat + x * x) * R;
  }

  /** Peso de la vía: primero las avenidas, después las calles de barrio. */
  function prioridad(tipo) {
    return ({
      motorway: 9, trunk: 8, primary: 7, secondary: 6,
      tertiary: 5, residential: 3, unclassified: 2, living_street: 1
    })[tipo] || 0;
  }

  /**
   * JSON de Overpass → calles listas para animar.
   * Devuelve `[{ pts: [{lat,lon}], acum: [m], largo: m, tipo }]`.
   */
  function analizar(datos) {
    const elementos = (datos && Array.isArray(datos.elements)) ? datos.elements : [];
    const crudas = [];

    for (let i = 0; i < elementos.length; i++) {
      const w = elementos[i];
      const g = w && w.geometry;
      if (!Array.isArray(g) || g.length < 2) continue;

      const pts = [];
      for (let k = 0; k < g.length; k++) {
        const p = g[k];
        if (!p || !isFinite(p.lat) || !isFinite(p.lon)) continue;
        const prev = pts[pts.length - 1];
        if (prev && prev.lat === p.lat && prev.lon === p.lon) continue;
        pts.push({ lat: Number(p.lat), lon: Number(p.lon) });
      }
      if (pts.length < 2) continue;

      const acum = [0];
      for (let k = 1; k < pts.length; k++) {
        acum.push(acum[k - 1] + metros(pts[k - 1], pts[k]));
      }
      const largo = acum[acum.length - 1];
      if (!(largo >= 40)) continue;

      crudas.push({ pts, acum, largo, tipo: (w.tags && w.tags.highway) || '' });
    }

    crudas.sort((a, b) => prioridad(b.tipo) - prioridad(a.tipo) || b.largo - a.largo);

    const salida = [];
    let puntos = 0;
    for (let i = 0; i < crudas.length; i++) {
      const c = crudas[i];
      if (puntos + c.pts.length > MAX_PUNTOS && salida.length) break;
      salida.push(c);
      puntos += c.pts.length;
    }
    return salida;
  }

  /** Punto a `s` metros del inicio de la calle (da la vuelta al llegar al final). */
  function puntoEn(calle, s) {
    const largo = calle.largo;
    if (!(largo > 0)) return calle.pts[0];
    const d = ((s % largo) + largo) % largo;
    const a = calle.acum;
    let lo = 0;
    let hi = a.length - 1;
    while (lo < hi - 1) {
      const m = (lo + hi) >> 1;
      if (a[m] <= d) lo = m; else hi = m;
    }
    const tramo = a[hi] - a[lo];
    const t = tramo > 0 ? (d - a[lo]) / tramo : 0;
    const p = calle.pts[lo];
    const q = calle.pts[hi];
    return { lat: p.lat + (q.lat - p.lat) * t, lon: p.lon + (q.lon - p.lon) * t };
  }

  /**
   * Reparte autos: uno cada ~220 m (entre 2 y 6 por calle), alternando el
   * sentido para que la vía se vea viva en los dos carriles.
   */
  function repartir(calles, azar, tope) {
    const rnd = typeof azar === 'function' ? azar : Math.random;
    const limite = tope > 0 ? tope : MAX_AUTOS;
    const autos = [];
    for (let i = 0; i < calles.length && autos.length < limite; i++) {
      const c = calles[i];
      const n = Math.max(2, Math.min(6, Math.round(c.largo / 220)));
      for (let k = 0; k < n && autos.length < limite; k++) {
        autos.push({
          calle: i,
          dir: (k % 2 === 0) ? 1 : -1,
          s: (k / n) * c.largo + rnd() * 40,
          v: 7 + rnd() * 7,                       // 25–50 km/h
          color: COLORES[Math.floor(rnd() * COLORES.length)] || COLORES[0]
        });
      }
    }
    return autos;
  }

  /* ── montaje ────────────────────────────────────────────────────────────── */

  /**
   * @param mapa    instancia de Leaflet
   * @param canvas  <canvas> propio (no se comparte con el radar)
   * @param opts    { activo: bool, alEstado: (estado) => void, espera: ms }
   */
  function montar(mapa, canvas, opts) {
    const o = opts || {};
    const alEstado = typeof o.alEstado === 'function' ? o.alEstado : function () {};
    const espera = isFinite(o.espera) ? Math.max(0, Number(o.espera)) : ESPERA_MS;

    const ctx = (canvas && canvas.getContext) ? canvas.getContext('2d') : null;
    const quieto = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    let vivo = true;
    let activo = o.activo !== false;
    let calles = [];
    let autos = [];
    let estado = 'sin-datos';
    let raf = 0;
    let ultimo = 0;
    let turno = 0;          // descarta respuestas de una zona que ya no se ve
    let esperar = 0;        // temporizador del pedido
    const cache = new Map();

    const decir = (nuevo) => {
      if (nuevo === estado) return;
      estado = nuevo;
      if (canvas && canvas.dataset) canvas.dataset.trafico = nuevo;
      try { alEstado(nuevo); } catch (e) { /* la UI no puede romper el mapa */ }
    };

    /* ── pintura ──────────────────────────────────────────────────────────── */

    function pintar() {
      if (!ctx || !mapa || !vivo) return;
      const ancho = canvas.clientWidth || 0;
      const alto = canvas.clientHeight || 0;
      if (!ancho || !alto) return;

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(ancho * dpr) || canvas.height !== Math.round(alto * dpr)) {
        canvas.width = Math.round(ancho * dpr);
        canvas.height = Math.round(alto * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, ancho, alto);
      if (!activo || !autos.length) return;

      const zoom = mapa.getZoom();
      const centro = mapa.getCenter();
      const mpp = 156543.03392 * Math.cos(centro.lat * Math.PI / 180) / Math.pow(2, zoom);
      // Separación de carril: 3,4 m a píxeles, acotada para que no se separen
      // de la vía cuando el mapa está muy cerca.
      const carril = Math.max(1.6, Math.min(6, 3.4 / (mpp || 1)));
      const largo = Math.max(8, Math.min(16, 6 + (zoom - 14) * 2.4));

      for (let i = 0; i < autos.length; i++) {
        const a = autos[i];
        const calle = calles[a.calle];
        if (!calle) continue;

        const p = mapa.latLngToContainerPoint(puntoEn(calle, a.s));
        const q = mapa.latLngToContainerPoint(puntoEn(calle, a.s + Math.max(3, a.v)));
        // El rumbo sigue el sentido de la marcha: el que va hacia atrás apunta
        // al otro lado (si no, la luz trasera quedaría delante).
        let dx = (q.x - p.x) * a.dir;
        let dy = (q.y - p.y) * a.dir;
        const m = Math.sqrt(dx * dx + dy * dy);
        if (!(m > 0.0001)) continue;
        dx /= m; dy /= m;

        // Perpendicular a la derecha del avance (y crece hacia abajo).
        const x = p.x + (-dy) * carril;
        const y = p.y + (dx) * carril;

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.atan2(dy, dx));
        const anchoAuto = Math.max(2.4, largo * 0.44);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(-largo / 2, -anchoAuto / 2, largo, anchoAuto, anchoAuto * 0.45);
        else ctx.rect(-largo / 2, -anchoAuto / 2, largo, anchoAuto);
        ctx.globalAlpha = 0.94;
        ctx.fillStyle = a.color;
        ctx.fill();
        // Borde oscuro: sin él, un auto claro desaparece sobre teselas claras.
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(8,10,12,.9)';
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Luz trasera (roja) y parabrisas: dan el sentido de la marcha.
        ctx.fillStyle = 'rgba(255,92,82,.95)';
        ctx.fillRect(-largo / 2, -anchoAuto / 2, 1.3, anchoAuto);
        if (largo > 8) {
          ctx.fillStyle = 'rgba(12,14,16,.42)';
          ctx.fillRect(largo * 0.04, -anchoAuto / 2 + 0.8, largo * 0.2, anchoAuto - 1.6);
        }
        ctx.restore();
      }
    }

    /* ── datos ────────────────────────────────────────────────────────────── */

    function aplicar(lista) {
      calles = lista;
      // A zoom 14 (el del encuadre inicial) caben más autos: si no, se ven
      // cuatro motas perdidas en media ciudad.
      const tope = (mapa && mapa.getZoom() <= 14.5) ? 90 : MAX_AUTOS;
      autos = repartir(lista, Math.random, tope);
      pintar();
    }

    function limpiar(nuevoEstado) {
      calles = [];
      autos = [];
      decir(nuevoEstado);
      pintar();
    }

    function bboxDe(mapa) {
      const b = mapa.getBounds();
      const sw = b.getSouthWest();
      const ne = b.getNorthEast();
      // Leaflet usa `.lng`; el resto del módulo habla `.lon`. Se normaliza acá
      // y no en cada uso (con `.lon` suelto, la consulta salía con NaN).
      return {
        sw: { lat: sw.lat, lon: sw.lng },
        ne: { lat: ne.lat, lon: ne.lng }
      };
    }

    async function pedir() {
      if (!vivo || !mapa || !canvas) return;

      const zoom = mapa.getZoom();
      if (zoom < ZOOM_MIN) { limpiar('muy-lejos'); return; }

      let caja;
      try { caja = bboxDe(mapa); } catch (e) { return; }
      const anchoM = metros(caja.sw, { lat: caja.sw.lat, lon: caja.ne.lng });
      const altoM = metros(caja.sw, { lat: caja.ne.lat, lon: caja.sw.lon });
      if (anchoM > MAX_LADO_M || altoM > MAX_LADO_M) { limpiar('muy-lejos'); return; }

      const r = (v) => v.toFixed(4);
      const clave = [zoom, r(caja.sw.lat), r(caja.sw.lon), r(caja.ne.lat), r(caja.ne.lon)].join('|');
      const guardado = cache.get(clave);
      if (guardado && Date.now() - guardado.t < TTL_MS) {
        aplicar(guardado.calles);
        decir('ok');
        return;
      }

      const mio = ++turno;
      decir('cargando');

      const bbox = [caja.sw.lat, caja.sw.lon, caja.ne.lat, caja.ne.lon]
        .map((v) => v.toFixed(5)).join(',');
      const consulta = '[out:json][timeout:15];way["highway"~"^(' + TIPOS + ')$"](' +
        bbox + ');out geom 250;';

      let datos = null;
      // Los cuatro espejos a la vez: gana el primero que conteste. En serie,
      // un espejo caído se come el presupuesto de los demás.
      try {
        datos = await Promise.any(ESPEJOS.map((base) => pedirA(base, consulta)));
      } catch (e) {
        datos = null;      // ninguno respondió
      }

      if (!vivo || mio !== turno) return;   // el usuario ya se movió a otra zona
      if (!datos) { limpiar('sin-red'); return; }

      const lista = analizar(datos);
      cache.set(clave, { t: Date.now(), calles: lista });
      if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
      aplicar(lista);
      decir(lista.length ? 'ok' : 'sin-calles');
    }

    /** Una consulta a un espejo de Overpass, con su propio reloj. */
    async function pedirA(base, consulta) {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const reloj = ctrl ? setTimeout(() => ctrl.abort(), 12000) : 0;
      try {
        const res = await fetch(base, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(consulta),
          signal: ctrl ? ctrl.signal : undefined
        });
        if (!res || !res.ok) throw new Error('overpass ' + (res && res.status));
        return await res.json();
      } finally {
        if (reloj) clearTimeout(reloj);
      }
    }

    function programar() {
      if (!vivo) return;
      if (esperar) clearTimeout(esperar);
      esperar = setTimeout(() => { esperar = 0; pedir(); }, espera);
    }

    /* ── animación ────────────────────────────────────────────────────────── */

    function bucle(t) {
      if (!vivo) return;
      raf = requestAnimationFrame(bucle);
      const dt = Math.min(0.1, Math.max(0, (t - (ultimo || t)) / 1000));
      ultimo = t;
      if (document.hidden || !activo || dt <= 0) return;
      if (dt < 1 / FPS - 0.004) return;      // ~30 fps: alcanza y cuida la batería
      for (let i = 0; i < autos.length; i++) autos[i].s += autos[i].v * autos[i].dir * dt;
      pintar();
    }

    /* ── eventos ──────────────────────────────────────────────────────────── */

    const alMover = () => { pintar(); programar(); };
    const alCambiar = () => { pintar(); };

    if (mapa && mapa.on) {
      mapa.on('moveend zoomend', alMover);
      mapa.on('move zoom viewreset resize', alCambiar);
    }

    if (canvas && canvas.dataset) canvas.dataset.trafico = estado;

    if (!quieto && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(bucle);
    // Apagado de entrada: no se pide nada a Overpass hasta que lo enciendan.
    if (activo) pedir();
    else decir('apagado');

    return {
      /** Enciende o apaga la capa (limpia el canvas al apagar). */
      setActivo(on) {
        activo = Boolean(on);
        if (!activo) { ctx && canvas && ctx.clearRect(0, 0, canvas.width, canvas.height); }
        else { pintar(); if (estado !== 'ok') pedir(); }
      },
      activo() { return activo; },
      estado() { return estado; },
      /** Fuerza un repintado (por ejemplo, al cambiar calles ↔ satélite). */
      repintar: pintar,
      /** Vuelve a pedir las calles de la zona visible (ignora la caché). */
      recargar() { cache.clear(); pedir(); },
      parar() {
        vivo = false;
        if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
        if (esperar) clearTimeout(esperar);
        raf = 0; esperar = 0;
        if (mapa && mapa.off) {
          mapa.off('moveend zoomend', alMover);
          mapa.off('move zoom viewreset resize', alCambiar);
        }
        if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
      },
      /** Internos expuestos para las pruebas (no se usan en la app). */
      _: { analizar, puntoEn, repartir, metros, prioridad, COLORES, MAX_AUTOS }
    };
  }

  return { montar, _: { analizar, puntoEn, repartir, metros, prioridad, COLORES, MAX_AUTOS, ZOOM_MIN, MAX_LADO_M, ESPEJOS } };
})();
