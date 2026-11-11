#!/usr/bin/env node
/* Pruebas del tráfico del mapa: geometría, reparto en ambos sentidos,
 * animación sobre las calles reales, caché y pausas.
 *
 * No abre navegador. Se carga `web/app/mapa-trafico.js` (el archivo real, no
 * una copia) con un `window`, un canvas y un mapa falsos: el canvas anota cada
 * `translate`/`rotate`, así se comprueba que los autos se mueven, que lo hacen
 * en los dos sentidos y que dan la vuelta al final de la calle.
 *
 * Uso: node tests/web/trafico.js
 */
'use strict';

const path = require('path');

/* ── entorno mínimo ──────────────────────────────────────────────────────── */

let rafPendiente = null;
let rafPedidos = 0;
let rafId = 0;
let tCuadro = 1000;   // reloj de los cuadros simulados (ms)

global.window = {
  devicePixelRatio: 2,
  matchMedia: () => ({ matches: false })
};
global.document = { hidden: false };
global.requestAnimationFrame = (fn) => { rafPendiente = fn; rafPedidos++; return ++rafId; };
global.cancelAnimationFrame = () => { rafPendiente = null; };

require(path.join(__dirname, '..', '..', 'web', 'app', 'mapa-trafico.js'));
const T = global.window.MapaTrafico;

/* ── utilidades de la prueba ─────────────────────────────────────────────── */

let fallos = 0;
const ok = (nombre, condicion, detalle) => {
  if (condicion) {
    console.log('  \x1b[1;32m✔\x1b[0m ' + nombre);
  } else {
    fallos++;
    console.log('  \x1b[1;31m✖\x1b[0m ' + nombre + (detalle ? ' → ' + detalle : ''));
  }
};
const cerca = (a, b, margen) => Math.abs(a - b) <= (margen == null ? 0.5 : margen);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function lienzoFalso(ancho, alto) {
  const marcas = [];
  const ctx = {
    marcas,
    setTransform() {},
    clearRect() { marcas.push({ tipo: 'clear' }); },
    save() {},
    restore() {},
    translate(x, y) { marcas.push({ tipo: 'translate', x, y }); },
    rotate(a) { marcas.push({ tipo: 'rotate', a }); },
    beginPath() {},
    rect() {},
    roundRect() {},
    fill() { marcas.push({ tipo: 'fill' }); },
    stroke() { marcas.push({ tipo: 'stroke' }); },
    fillRect() {},
    set fillStyle(v) {},
    set globalAlpha(v) {}
  };
  return {
    clientWidth: ancho, clientHeight: alto, width: 0, height: 0,
    dataset: {}, ctx, marcas,
    getContext: () => ctx
  };
}

/* Mapa falso: proyección local con píxeles por metro fijos, así la posición
   de cada auto se puede calcular a mano. */
function mapaFalso(opts) {
  const o = opts || {};
  const centro = { lat: o.lat != null ? o.lat : -33.4489, lng: o.lon != null ? o.lon : -70.6693 };
  const mpp = o.mpp != null ? o.mpp : 0.5;
  let zoom = o.zoom != null ? o.zoom : 16;
  const caja = o.caja || {
    sw: { lat: centro.lat - 0.004, lng: centro.lng - 0.004 },
    ne: { lat: centro.lat + 0.004, lng: centro.lng + 0.004 }
  };
  const oyentes = new Map();
  const poner = (ev, fn) => {
    ev.split(' ').forEach((e) => {
      if (!oyentes.has(e)) oyentes.set(e, []);
      if (!oyentes.get(e).includes(fn)) oyentes.get(e).push(fn);
    });
  };
  return {
    oyentes,
    getZoom: () => zoom,
    getCenter: () => ({ lat: centro.lat, lng: centro.lng }),
    getBounds: () => ({
      getSouthWest: () => ({ lat: caja.sw.lat, lng: caja.sw.lng }),
      getNorthEast: () => ({ lat: caja.ne.lat, lng: caja.ne.lng })
    }),
    setZoom(z) { zoom = z; },
    latLngToContainerPoint(ll) {
      const lat = ll.lat != null ? ll.lat : ll[0];
      const lon = ll.lon != null ? ll.lon : (ll.lng != null ? ll.lng : ll[1]);
      const mLat = 110574 * mpp;
      const mLon = 111320 * Math.cos(centro.lat * Math.PI / 180) * mpp;
      return {
        x: 200 + (lon - centro.lng) * mLon,
        y: 400 - (lat - centro.lat) * mLat
      };
    },
    on: poner,
    off(ev, fn) {
      ev.split(' ').forEach((e) => {
        const a = oyentes.get(e) || [];
        oyentes.set(e, a.filter((f) => f !== fn));
      });
    },
    disparar(ev) { (oyentes.get(ev) || []).slice().forEach((f) => f()); }
  };
}

/* Calle recta horizontal (este-oeste) de `largoM` metros, en el centro. */
function calleRecta(largoM, lat, lon, tipo) {
  const grados = largoM / 2 / (111320 * Math.cos(lat * Math.PI / 180));
  return {
    type: 'way',
    tags: { highway: tipo || 'primary' },
    geometry: [
      { lat, lon: lon - grados },
      { lat, lon },
      { lat, lon: lon + grados }
    ]
  };
}

/* Respuesta de Overpass con las calles dadas. */
function overpass(calles) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ elements: calles })
  });
}

function avanzar(veces) {
  for (let i = 0; i < veces; i++) {
    tCuadro += 33;
    const fn = rafPendiente;
    rafPendiente = null;
    if (fn) fn(tCuadro);
  }
}

const posiciones = (lienzo) => lienzo.marcas.filter((m) => m.tipo === 'translate');

/* ── pruebas ─────────────────────────────────────────────────────────────── */

(async function main() {
  console.log('\n▸ tráfico del mapa');

  /* 1 · Geometría ---------------------------------------------------------- */
  {
    const a = { lat: -33.4489, lon: -70.6693 };
    const b = { lat: -33.4479, lon: -70.6693 };   // 0,001° de latitud
    ok('metros: 0,001° de latitud ≈ 111 m', cerca(T._.metros(a, b), 111, 2),
      String(T._.metros(a, b)));
    ok('metros: mismo punto = 0', T._.metros(a, a) === 0);
    ok('prioridad: avenida pesa más que pasaje',
      T._.prioridad('primary') > T._.prioridad('residential') &&
      T._.prioridad('residential') > T._.prioridad('living_street'));
    ok('prioridad: tipo desconocido = 0', T._.prioridad('no-existe') === 0);
  }

  /* 2 · analizar: qué calles sirven --------------------------------------- */
  {
    const datos = {
      elements: [
        calleRecta(300, -33.4489, -70.6693, 'residential'),
        calleRecta(400, -33.4479, -70.6693, 'primary'),
        { type: 'way', tags: { highway: 'primary' }, geometry: [{ lat: -33.45, lon: -70.67 }] },
        { type: 'way', tags: { highway: 'primary' }, geometry: null },
        { type: 'node', id: 1 },
        // 30 m: demasiado corta para que valga la pena
        calleRecta(30, -33.4499, -70.6693, 'tertiary'),
        // Puntos repetidos seguidos: se colapsan
        {
          type: 'way', tags: { highway: 'secondary' },
          geometry: [
            { lat: -33.4489, lon: -70.6693 },
            { lat: -33.4489, lon: -70.6693 },
            { lat: -33.4489, lon: -70.6703 }
          ]
        },
        // Punto roto: se ignora, la vía sigue con los buenos
        {
          type: 'way', tags: { highway: 'secondary' },
          geometry: [
            { lat: -33.4489, lon: -70.6693 },
            { lat: null, lon: -70.6693 },
            { lat: -33.4489, lon: -70.6703 }
          ]
        }
      ]
    };
    const calles = T._.analizar(datos);
    ok('descarta vías sin geometría o de un solo punto', calles.length === 4,
      calles.length + ' calles');
    ok('la avenida va primero (se pinta y se llena antes)',
      calles[0].tipo === 'primary', calles[0].tipo);
    ok('descarta vías de menos de 40 m',
      calles.every((c) => c.largo >= 40), calles.map((c) => Math.round(c.largo)).join(','));
    ok('colapsa puntos repetidos seguidos',
      calles.every((c) => c.pts.length === c.acum.length), 'largo distinto');
    ok('acumulado arranca en 0 y termina en el largo',
      calles.every((c) => c.acum[0] === 0 && cerca(c.acum[c.acum.length - 1], c.largo, 0.01)));
    ok('sin elementos devuelve lista vacía', T._.analizar({}).length === 0);
    ok('datos basura no rompen', T._.analizar(null).length === 0);
  }

  /* 3 · analizar: tope de puntos ------------------------------------------ */
  {
    const muchas = [];
    for (let i = 0; i < 20; i++) {
      const g = [];
      for (let k = 0; k < 400; k++) g.push({ lat: -33.44 - i * 0.001, lon: -70.67 + k * 0.00001 });
      muchas.push({ type: 'way', tags: { highway: 'residential' }, geometry: g });
    }
    const calles = T._.analizar({ elements: muchas });
    const total = calles.reduce((s, c) => s + c.pts.length, 0);
    ok('respeta el tope de puntos de vía', total <= 3500, total + ' puntos');
    ok('con el tope igual devuelve calles', calles.length >= 1, String(calles.length));
  }

  /* 4 · puntoEn: interpolación y vuelta ----------------------------------- */
  {
    const calle = T._.analizar({ elements: [calleRecta(100, -33.4489, -70.6693, 'primary')] })[0];
    const inicio = T._.puntoEn(calle, 0);
    const mitad = T._.puntoEn(calle, calle.largo / 2);
    ok('s=0 es el primer punto', cerca(inicio.lat, calle.pts[0].lat, 1e-9) &&
      cerca(inicio.lon, calle.pts[0].lon, 1e-9));
    ok('la mitad cae en el medio de la calle', cerca(mitad.lon, -70.6693, 1e-6),
      String(mitad.lon));
    const vuelta = T._.puntoEn(calle, calle.largo + 5);
    const cinco = T._.puntoEn(calle, 5);
    ok('pasado el final vuelve al principio', cerca(vuelta.lon, cinco.lon, 1e-9),
      vuelta.lon + ' != ' + cinco.lon);
    const negativo = T._.puntoEn(calle, -5);
    const casiFinal = T._.puntoEn(calle, calle.largo - 5);
    ok('s negativo entra por el final', cerca(negativo.lon, casiFinal.lon, 1e-9),
      negativo.lon + ' != ' + casiFinal.lon);
  }

  /* 5 · repartir: los dos sentidos ---------------------------------------- */
  {
    const calles = T._.analizar({
      elements: [
        calleRecta(1000, -33.4489, -70.6693, 'primary'),
        calleRecta(500, -33.4500, -70.6693, 'residential')
      ]
    });
    const autos = T._.repartir(calles, () => 0.5);
    ok('reparte autos en todas las calles', new Set(autos.map((a) => a.calle)).size === calles.length);
    ok('hay autos en ambos sentidos',
      autos.some((a) => a.dir === 1) && autos.some((a) => a.dir === -1));
    ok('alterna el sentido dentro de cada calle',
      calles.every((c, i) => {
        const deCalle = autos.filter((a) => a.calle === i);
        return deCalle.length < 2 || deCalle[0].dir !== deCalle[1].dir;
      }));
    ok('no pasa del máximo de autos', autos.length <= T._.MAX_AUTOS, String(autos.length));
    ok('cada auto arranca dentro de su calle',
      autos.every((a) => a.s >= 0 && a.s <= calles[a.calle].largo + 40));
    ok('velocidad entre 25 y 50 km/h',
      autos.every((a) => a.v >= 7 && a.v <= 14), JSON.stringify(autos.map((a) => a.v)));
    ok('usa la paleta declarada',
      autos.every((a) => T._.COLORES.includes(a.color)), autos.map((a) => a.color).join(','));
    const otra = T._.repartir(calles, () => 0.5);
    ok('con la misma semilla reparte igual',
      JSON.stringify(otra) === JSON.stringify(autos));
    const densa = T._.repartir(calles, () => 0.5, 90);
    ok('a zoom 14 admite un tope mayor de autos', densa.length >= autos.length &&
      densa.length <= 90, autos.length + ' → ' + densa.length);
  }

  /* 6 · montar: lejos no se pide nada ------------------------------------- */
  {
    let pedidos = 0;
    global.fetch = () => { pedidos++; return overpass([]); };
    const mapa = mapaFalso({ zoom: 12 });
    const lienzo = lienzoFalso(400, 800);
    const estados = [];
    const ctl = T.montar(mapa, lienzo, { alEstado: (e) => estados.push(e), espera: 0 });
    await esperar(20);
    ok('con zoom lejano no se pide a Overpass', pedidos === 0, pedidos + ' pedidos');
    ok('deja dicho por qué no hay autos', lienzo.dataset.trafico === 'muy-lejos',
      lienzo.dataset.trafico);
    ok('avisa el estado a la interfaz', estados.includes('muy-lejos'), estados.join(','));
    ok('no dibuja autos', posiciones(lienzo).length === 0);

    // El mapa abre en zoom 14 al encuadrar los locales: ahí SÍ debe pedir.
    mapa.setZoom(14);
    mapa.disparar('moveend');
    await esperar(40);
    ok('a zoom 14 (el del encuadre inicial) sí se pide', pedidos > 0, pedidos + ' pedidos');
    ok('sin calles en la respuesta lo dice', lienzo.dataset.trafico === 'sin-calles',
      lienzo.dataset.trafico);
    ctl.parar();
  }

  /* 7 · montar: sin red --------------------------------------------------- */
  {
    let pedidos = 0;
    global.fetch = () => { pedidos++; return Promise.reject(new Error('sin red')); };
    const mapa = mapaFalso({ zoom: 16 });
    const lienzo = lienzoFalso(400, 800);
    const ctl = T.montar(mapa, lienzo, { espera: 0 });
    await esperar(40);
    ok('prueba todos los espejos antes de rendirse', pedidos === T._.ESPEJOS.length,
      pedidos + ' de ' + T._.ESPEJOS.length);
    ok('sin red no inventa calles', lienzo.dataset.trafico === 'sin-red',
      lienzo.dataset.trafico);
    ok('sin red no dibuja autos', posiciones(lienzo).length === 0);
    ctl.parar();
  }

  /* 7 bis · un espejo caído no deja el mapa sin autos --------------------- */
  {
    const sanos = [];
    global.fetch = (url) => {
      if (url === T._.ESPEJOS[0]) return Promise.reject(new Error('406'));
      sanos.push(url);
      return overpass([calleRecta(200, -33.4489, -70.6693, 'primary')]);
    };
    const mapa = mapaFalso({ zoom: 16 });
    const lienzo = lienzoFalso(400, 800);
    const ctl = T.montar(mapa, lienzo, { espera: 0 });
    await esperar(40);
    ok('con un espejo caído el tráfico igual carga', lienzo.dataset.trafico === 'ok',
      lienzo.dataset.trafico);
    ok('se consultaron los cuatro espejos a la vez',
      sanos.length === T._.ESPEJOS.length - 1, sanos.length + ' sanos');
    ctl.parar();
  }

  /* 8 · montar: autos que avanzan en ambos sentidos y dan la vuelta ------- */
  {
    const calle = calleRecta(60, -33.4489, -70.6693, 'primary');
    let pedidos = 0;
    global.fetch = () => { pedidos++; return overpass([calle]); };
    // Semilla fija: los dos autos quedan en posiciones conocidas.
    const azarReal = Math.random;
    let semilla = 0;
    Math.random = () => { semilla = (semilla + 0.37) % 1; return semilla; };

    const mapa = mapaFalso({ zoom: 17 });
    const lienzo = lienzoFalso(400, 800);
    const ctl = T.montar(mapa, lienzo, { espera: 0 });
    await esperar(30);

    ok('con calles reales el estado es ok', lienzo.dataset.trafico === 'ok',
      lienzo.dataset.trafico);
    ok('pidió la zona una sola vez (a los cuatro espejos)',
      pedidos === T._.ESPEJOS.length, pedidos + ' pedidos');
    ok('arrancó el bucle de animación', rafPedidos > 0);

    avanzar(2);
    const primeros = posiciones(lienzo).slice(-2);
    ok('dibuja un auto por cada uno del reparto', primeros.length === 2,
      primeros.length + ' dibujados');

    avanzar(30);
    const despues = posiciones(lienzo).slice(-2);
    ok('el auto del sentido +1 avanza hacia el este',
      despues[0].x > primeros[0].x, primeros[0].x + ' → ' + despues[0].x);
    ok('el auto del sentido −1 avanza hacia el oeste',
      despues[1].x < primeros[1].x, primeros[1].x + ' → ' + despues[1].x);
    ok('cada sentido va por su carril (uno a cada lado de la calle)',
      (despues[0].y - 400) * (despues[1].y - 400) < 0,
      despues[0].y + ' / ' + despues[1].y);
    ok('la calle es horizontal: el giro es 0 o π',
      lienzo.marcas.filter((m) => m.tipo === 'rotate')
        .every((m) => cerca(Math.abs(m.a), 0, 0.01) || cerca(Math.abs(m.a), Math.PI, 0.01)));

    // 60 m a 25–50 km/h: en ~4 s de animación ya dio la vuelta alguna vez.
    let vueltas = 0;
    let anterior = posiciones(lienzo).slice(-2)[0].x;
    for (let i = 0; i < 200; i++) {
      avanzar(1);
      const x = posiciones(lienzo).slice(-2)[0].x;
      if (x < anterior - 20) vueltas++;
      anterior = x;
    }
    ok('al llegar al final de la calle el auto vuelve a entrar', vueltas > 0,
      vueltas + ' vueltas');

    /* 9 · caché: la misma zona no se vuelve a pedir ---------------------- */
    const antes = pedidos;
    mapa.disparar('moveend');
    await esperar(30);
    ok('la misma zona sale de la caché (sin otra petición)', pedidos === antes,
      antes + ' → ' + pedidos);
    ok('la caché no deja el canvas vacío', posiciones(lienzo).length > 0);

    /* 10 · alejarse limpia los autos ------------------------------------ */
    mapa.setZoom(11);
    mapa.disparar('moveend');
    await esperar(30);
    ok('al alejarse se apagan los autos', lienzo.dataset.trafico === 'muy-lejos',
      lienzo.dataset.trafico);

    /* 11 · apagar y encender -------------------------------------------- */
    mapa.setZoom(17);
    mapa.disparar('moveend');
    await esperar(30);
    const marcasAntes = lienzo.marcas.length;
    ctl.setActivo(false);
    ok('apagado limpia el canvas',
      lienzo.marcas.slice(marcasAntes).some((m) => m.tipo === 'clear'));
    const quieto = lienzo.marcas.length;
    avanzar(10);
    ok('apagado no dibuja aunque corra el bucle', lienzo.marcas.length === quieto,
      (lienzo.marcas.length - quieto) + ' marcas nuevas');
    ok('el estado del controlador lo refleja', ctl.activo() === false);
    ctl.setActivo(true);
    ok('al encender vuelve a dibujar', posiciones(lienzo).length > 0);

    /* 12 · parar: se va sin dejar timers ni oyentes --------------------- */
    const oyentesAntes = mapa.oyentes.get('moveend').length;
    const marcasParar = lienzo.marcas.length;
    ctl.parar();
    ok('parar quita los oyentes del mapa', mapa.oyentes.get('moveend').length < oyentesAntes,
      oyentesAntes + ' → ' + mapa.oyentes.get('moveend').length);
    ok('parar cancela el bucle', rafPendiente === null);
    ok('parar limpia el canvas',
      lienzo.marcas.slice(marcasParar).some((m) => m.tipo === 'clear'));
    const marcasParado = lienzo.marcas.length;
    avanzar(5);
    ok('parado no dibuja', lienzo.marcas.length === marcasParado);

    Math.random = azarReal;
  }

  /* 13 · movimiento reducido: autos quietos, sin bucle -------------------- */
  {
    global.fetch = () => overpass([calleRecta(200, -33.4489, -70.6693, 'primary')]);
    const mapa = mapaFalso({ zoom: 16 });
    const lienzo = lienzoFalso(400, 800);
    window.matchMedia = () => ({ matches: true });
    const rafAntes = rafPedidos;
    const ctl = T.montar(mapa, lienzo, { espera: 0 });
    await esperar(30);
    ok('con movimiento reducido no se pide animación', rafPedidos === rafAntes,
      (rafPedidos - rafAntes) + ' rAF');
    const quietos = posiciones(lienzo).length;
    ok('aun así dibuja los autos una vez', quietos > 0, String(quietos));
    mapa.disparar('move');
    ok('y los redibuja al mover el mapa (sin bucle)',
      posiciones(lienzo).length > quietos, posiciones(lienzo).length + ' vs ' + quietos);
    window.matchMedia = () => ({ matches: false });
    ctl.parar();
  }

  /* 13 bis · arrancar apagado no gasta red ------------------------------- */
  {
    let pedidos = 0;
    global.fetch = () => { pedidos++; return overpass([calleRecta(200, -33.4489, -70.6693, 'primary')]); };
    const mapa = mapaFalso({ zoom: 16 });
    const lienzo = lienzoFalso(400, 800);
    const ctl = T.montar(mapa, lienzo, { activo: false, espera: 0 });
    await esperar(40);
    ok('apagado de entrada no pide calles', pedidos === 0, pedidos + ' pedidos');
    ok('lo deja dicho en el canvas', lienzo.dataset.trafico === 'apagado',
      lienzo.dataset.trafico);
    ok('apagado de entrada no dibuja', posiciones(lienzo).length === 0);
    ctl.setActivo(true);
    await esperar(40);
    ok('al encenderlo sí pide y dibuja', pedidos > 0 && posiciones(lienzo).length > 0,
      pedidos + ' pedidos, ' + posiciones(lienzo).length + ' autos');
    ctl.parar();
  }

  /* 14 · una respuesta vieja no pisa la zona nueva ----------------------- */
  {
    const pendientes = [];
    global.fetch = () => new Promise((r) => { pendientes.push(r); });
    const mapa = mapaFalso({ zoom: 16 });
    const lienzo = lienzoFalso(400, 800);
    const ctl = T.montar(mapa, lienzo, { espera: 0 });
    await esperar(10);
    // El usuario se va a otra zona antes de que llegue la respuesta.
    mapa.setZoom(16.5);
    mapa.disparar('moveend');
    await esperar(10);
    ok('hay dos lotes en vuelo (uno por zona)',
      pendientes.length === T._.ESPEJOS.length * 2, String(pendientes.length));

    // Llega la de la zona abandonada: no debe pintar autos ni dar por bueno
    // el estado (los autos serían de una zona que ya no se ve).
    const loteViejo = pendientes.slice(0, T._.ESPEJOS.length);
    const loteActual = pendientes.slice(T._.ESPEJOS.length);
    loteViejo.forEach((r) => r({
      ok: true,
      json: () => Promise.resolve({ elements: [calleRecta(300, -33.4489, -70.6693, 'primary')] })
    }));
    await esperar(30);
    ok('la respuesta de la zona abandonada se descarta',
      lienzo.dataset.trafico === 'cargando', lienzo.dataset.trafico);
    ok('y no dibuja autos de la zona vieja', posiciones(lienzo).length === 0,
      posiciones(lienzo).length + ' autos');

    // La de la zona actual sí vale.
    loteActual.forEach((r) => r({
      ok: true,
      json: () => Promise.resolve({ elements: [calleRecta(300, -33.4489, -70.6693, 'primary')] })
    }));
    await esperar(30);
    ok('la respuesta de la zona actual sí se aplica', lienzo.dataset.trafico === 'ok',
      lienzo.dataset.trafico);
    ok('y dibuja sus autos', posiciones(lienzo).length > 0);
    ctl.parar();
  }

  console.log(fallos === 0
    ? '\n\x1b[1;32m✔ tráfico web: todo en orden\x1b[0m\n'
    : '\n\x1b[1;31m✖ tráfico web: ' + fallos + ' fallo(s)\x1b[0m\n');
  process.exit(fallos === 0 ? 0 : 1);
})();
