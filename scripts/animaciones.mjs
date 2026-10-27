#!/usr/bin/env node
/* ============================================================================
   Generador de animaciones Lottie de la nube FABRI-CORE
   ----------------------------------------------------------------------------
   La APK no lleva lottie (250 KB de runtime): allí las animaciones son CSS.
   La nube sí puede permitírselo, así que estas piezas se generan como JSON
   Bodymovin y se sirven desde /app/anim/ (caché inmutable en Vercel).

   Escribir Lottie a mano es frágil: un `ty` mal puesto deja la animación en
   blanco sin error visible. Por eso todo se arma con estos ayudantes y cada
   archivo se valida al final (capas, formas y keyframes monótonos).

   Uso:  node scripts/animaciones.mjs
   Salida: web/app/anim/{core,sync,scan,check,empty}.json
   ========================================================================== */
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = join(RAIZ, 'web/app/anim');

/* Paleta de la nube (la misma de styles.css). Lottie usa 0..1, no 0..255. */
const C = {
  iris: [0.549, 0.549, 1, 1],      // #8C8CFF
  aqua: [0.247, 0.878, 0.788, 1],  // #3FE0C9
  lima: [0.784, 0.961, 0.259, 1],  // #C8F542
  texto: [0.957, 0.969, 1, 1],     // #F4F7FF
  tenue: [0.478, 0.514, 0.604, 1]  // #7A839A
};

const k = v => ({ a: 0, k: v });
const col = c => ({ a: 0, k: c });
const esAnim = v => !!v && typeof v === 'object' && !Array.isArray(v) && v.a === 1 && 'k' in v;

/* Easing de entrada/salida suave; el último keyframe no lleva easing. */
const SUAVE = { i: { x: [0.42], y: [0] }, o: { x: [0.58], y: [1] } };
const LINEAL = { i: { x: [0.25], y: [0.25] }, o: { x: [0.75], y: [0.75] } };

/** Convierte [[t, [v]], ...] en keyframes de Lottie. */
function curva(pares, easing = SUAVE) {
  return pares.map(([t, s], i) =>
    i < pares.length - 1 ? { ...easing, t, s } : { t, s });
}

/* ── piezas ────────────────────────────────────────────────────────────── */
const tr = () => ({
  ty: 'tr', p: k([0, 0]), a: k([0, 0]), s: k([100, 100]),
  r: k(0), o: k(100), sk: k(0), sa: k(0), nm: 'tr'
});

function grupo(items, nombre = 'g') {
  return { ty: 'gr', it: [...items, tr()], nm: nombre, np: items.length, cix: 2, bm: 0 };
}
function elipse(d, pos = [0, 0]) {
  return { ty: 'el', d: 1, s: k([d, d]), p: k(pos), nm: 'elipse' };
}
function rectRedondo(w, h, r, pos = [0, 0]) {
  return { ty: 'rc', d: 1, s: k([w, h]), p: k(pos), r: k(r), nm: 'rect' };
}
function trazo(color, w = 2, dash) {
  const st = { ty: 'st', c: col(color), o: k(100), w: k(w), lc: 2, lj: 1, bm: 0, nm: 'trazo' };
  if (dash) st.d = [{ n: 'd', v: k(dash[0]) }, { n: 'g', v: k(dash[1]) }, { n: 'o', v: k(0) }];
  return st;
}
function relleno(color, opacidad = 100) {
  return { ty: 'fl', c: col(color), o: k(opacidad), r: 1, bm: 0, nm: 'relleno' };
}
function recorte(desde, hasta) {
  return { ty: 'tm', s: k(desde), e: k(hasta), o: k(0), m: 1, nm: 'recorte' };
}
function camino(puntos, cerrado = false) {
  const ceros = puntos.map(() => [0, 0]);
  return {
    ty: 'sh',
    ks: { a: 0, k: { i: ceros, o: ceros.map(() => [0, 0]), v: puntos, c: cerrado } },
    nm: 'camino'
  };
}
/* Un solo keyframe de recorte animado (para dibujar trazos). */
function recorteAnimado(pares, easing = SUAVE) {
  return { ty: 'tm', s: k(0), e: { a: 1, k: curva(pares, easing) }, o: k(0), m: 1, nm: 'trazo' };
}

function capaForma(nombre, ind, items, opciones = {}) {
  const { entrada = 0, salida = 180, opacidad = 100, escala } = opciones;
  const pos = opciones.pos ?? [0, 0];
  const rot = opciones.rot ?? 0;
  const ks = {
    o: esAnim(opacidad) ? opacidad : k(opacidad),
    r: esAnim(rot) ? rot : k(rot),
    p: esAnim(pos) ? pos : k([pos[0] || 0, pos[1] || 0, 0]),
    a: k([0, 0, 0]),
    s: esAnim(escala) ? escala : k([100, 100, 100])
  };
  return {
    ddd: 0, ind, ty: 4, nm: nombre, sr: 1, ks, ao: 0,
    shapes: items, ip: entrada, op: salida, st: 0, bm: 0
  };
}

function doc(nombre, w, h, op, capas, fr = 60) {
  return {
    v: '5.7.4', fr, ip: 0, op, w, h, nm: nombre, ddd: 0,
    assets: [], layers: capas, markers: []
  };
}

/* ── 1 · core · órbitas del núcleo (cargador y héroe del panel) ────────── */
function core() {
  const OP = 180;
  const girar = (de, a) => curva([[0, [de]], [OP, [a]]], LINEAL);

  const anilloExterno = capaForma('anillo externo', 1, [
    grupo([elipse(176), recorte(0, 92), trazo(C.iris, 1.5, [3, 9])], 'a1')
  ], { rot: girar(0, 360), opacidad: 55, salida: OP });

  const anilloMedio = capaForma('anillo medio', 2, [
    grupo([elipse(124), recorte(0, 64), trazo(C.aqua, 2, [2, 7])], 'a2')
  ], { rot: girar(360, 0), opacidad: 70, salida: OP });

  const anilloInterior = capaForma('anillo interior', 3, [
    grupo([elipse(84), trazo(C.iris, 1)], 'a3')
  ], { rot: girar(0, -360), opacidad: 28, salida: OP });

  const satelites = capaForma('satelites', 4, [
    grupo([
      elipse(9, [0, -88]), relleno(C.aqua),
      elipse(6, [0, 88]), relleno(C.iris),
      elipse(7, [76, 0]), relleno(C.lima)
    ], 'sats')
  ], { rot: girar(0, 360), salida: OP });

  const pulso = capaForma('pulso', 5, [
    grupo([elipse(30), relleno(C.iris, 26)], 'halo'),
    grupo([elipse(11), relleno(C.texto)], 'nucleo')
  ], {
    escala: {
      a: 1, k: curva([
        [0, [88, 88, 100]], [45, [108, 108, 100]], [90, [88, 88, 100]],
        [135, [108, 108, 100]], [180, [88, 88, 100]]
      ])
    },
    salida: OP
  });

  const halo = capaForma('halo lejano', 6, [
    grupo([elipse(232), relleno(C.iris, 7)], 'luz')
  ], { salida: OP });

  return doc('core', 240, 240, OP, [halo, anilloExterno, anilloMedio, anilloInterior, satelites, pulso]);
}

/* ── 2 · sync · dos arcos girando alrededor del núcleo ─────────────────── */
function sync() {
  const OP = 150;
  const girar = (de, a) => curva([[0, [de]], [OP, [a]]], LINEAL);

  const halo = capaForma('halo', 1, [
    grupo([elipse(190), relleno(C.iris, 6)], 'luz')
  ], { salida: OP });

  const externo = capaForma('arco externo', 2, [
    grupo([elipse(146), recorte(6, 54), trazo(C.iris, 3)], 'arco')
  ], { rot: girar(0, 360), salida: OP });

  const interno = capaForma('arco interno', 3, [
    grupo([elipse(100), recorte(28, 82), trazo(C.aqua, 2.5)], 'arco2')
  ], { rot: girar(360, 0), salida: OP });

  const centro = capaForma('nucleo', 4, [
    grupo([rectRedondo(46, 46, 14), trazo(C.texto, 1.6), relleno(C.iris, 12)], 'caja'),
    grupo([elipse(7), relleno(C.lima)], 'punto')
  ], {
    escala: { a: 1, k: curva([[0, [96, 96, 100]], [75, [104, 104, 100]], [150, [96, 96, 100]]]) },
    salida: OP
  });

  return doc('sync', 200, 200, OP, [halo, externo, interno, centro]);
}

/* ── 3 · scan · marco de escaneo con línea que barre ───────────────────── */
function scan() {
  const OP = 120;
  const barrido = curva([[0, [-44, 0, 0]], [60, [44, 0, 0]], [120, [-44, 0, 0]]], LINEAL);

  const marco = capaForma('marco', 1, [
    grupo([camino([[-62, -40], [-62, -62], [-40, -62]]), trazo(C.aqua, 2.5)], 'esq1'),
    grupo([camino([[40, -62], [62, -62], [62, -40]]), trazo(C.aqua, 2.5)], 'esq2'),
    grupo([camino([[-62, 40], [-62, 62], [-40, 62]]), trazo(C.aqua, 2.5)], 'esq3'),
    grupo([camino([[40, 62], [62, 62], [62, 40]]), trazo(C.aqua, 2.5)], 'esq4')
  ], { salida: OP });

  const codigo = capaForma('codigo', 2, [
    grupo([rectRedondo(6, 54, 2, [-26, 0]), relleno(C.tenue, 70)], 'b1'),
    grupo([rectRedondo(4, 62, 2, [-14, 0]), relleno(C.tenue, 55)], 'b2'),
    grupo([rectRedondo(7, 44, 2, [-2, 0]), relleno(C.tenue, 75)], 'b3'),
    grupo([rectRedondo(4, 58, 2, [9, 0]), relleno(C.tenue, 55)], 'b4'),
    grupo([rectRedondo(6, 50, 2, [21, 0]), relleno(C.tenue, 70)], 'b5'),
    grupo([rectRedondo(3, 60, 2, [31, 0]), relleno(C.tenue, 45)], 'b6')
  ], { opacidad: 60, salida: OP });

  const brilloLinea = capaForma('brillo del barrido', 3, [
    grupo([camino([[-58, 0], [58, 0]]), trazo(C.lima, 9)], 'glow')
  ], {
    pos: barrido,
    opacidad: 22,
    escala: [100, 100],
    salida: OP
  });

  const linea = capaForma('linea de barrido', 4, [
    grupo([camino([[-58, 0], [58, 0]]), trazo(C.lima, 2)], 'linea')
  ], {
    pos: barrido,
    opacidad: { a: 1, k: curva([[0, [70]], [10, [100]], [110, [100]], [120, [70]]]) },
    salida: OP
  });

  return doc('scan', 200, 200, OP, [codigo, marco, brilloLinea, linea]);
}

/* ── 4 · check · confirmación (se reproduce una vez) ───────────────────── */
function check() {
  const OP = 72;
  const circulo = capaForma('circulo', 1, [
    grupo([elipse(92), recorteAnimado([[6, [0]], [34, [100]]]), trazo(C.lima, 3)], 'c')
  ], { rot: k(-90), salida: OP });

  const tilde = capaForma('tilde', 2, [
    grupo([
      camino([[-16, 0], [-5, 11], [17, -12]]),
      recorteAnimado([[26, [0]], [58, [100]]]),
      trazo(C.lima, 4)
    ], 't')
  ], { salida: OP });

  const brillo = capaForma('destello', 3, [
    grupo([elipse(96), relleno(C.lima, 10)], 'halo')
  ], {
    escala: { a: 1, k: curva([[0, [40, 40, 100]], [40, [100, 100, 100]], [72, [124, 124, 100]]]) },
    opacidad: { a: 1, k: curva([[0, [0]], [18, [70]], [72, [0]]]) },
    salida: OP
  });

  return doc('check', 120, 120, OP, [brillo, circulo, tilde]);
}

/* ── 5 · empty · tres puntos respirando (estados vacíos) ───────────────── */
function empty() {
  const OP = 120;
  const punto = (x, desfase) => capaForma('punto', x + 2, [
    grupo([elipse(14), relleno(C.tenue, 90)], 'p')
  ], {
    pos: [x, 0],
    escala: {
      a: 1, k: [
        { ...SUAVE, t: 0, s: [80, 80, 100] },
        { ...SUAVE, t: desfase, s: [80, 80, 100] },
        { ...SUAVE, t: desfase + 24, s: [122, 122, 100] },
        { ...SUAVE, t: desfase + 48, s: [80, 80, 100] },
        { t: OP, s: [80, 80, 100] }
      ]
    },
    salida: OP
  });

  return doc('empty', 160, 120, OP, [punto(-26, 0), punto(0, 14), punto(26, 28)]);
}

/* ── validación ───────────────────────────────────────────────────────── */
const TIPOS = new Set(['gr', 'el', 'rc', 'sh', 'st', 'fl', 'tm', 'tr']);
function validar(a) {
  const errores = [];
  if (a.v !== '5.7.4') errores.push('versión Bodymovin inesperada');
  if (!(a.w > 0 && a.h > 0)) errores.push('lienzo inválido');
  if (!(a.op > 0)) errores.push('duración inválida');
  if (!Array.isArray(a.layers) || !a.layers.length) errores.push('sin capas');
  (a.layers || []).forEach((c, i) => {
    for (const campo of ['ind', 'ty', 'nm', 'ks', 'ip', 'op']) {
      if (c[campo] === undefined) errores.push(`capa ${i} sin ${campo}`);
    }
    if (c.ty !== 4) errores.push(`capa ${i} no es de forma (ty=${c.ty})`);
    if (c.op > a.op) errores.push(`capa ${i} termina después del documento`);
    (c.shapes || []).forEach(g => {
      if (g.ty !== 'gr') errores.push(`capa ${i}: forma raíz ${g.ty}`);
      (g.it || []).forEach(it => {
        if (!TIPOS.has(it.ty)) errores.push(`capa ${i}: tipo ${it.ty} desconocido`);
        if (it.ty === 'tr' && !it.p) errores.push(`capa ${i}: transformación sin posición`);
      });
    });
    [c.ks.o, c.ks.r, c.ks.p, c.ks.s].forEach(pr => {
      if (pr && pr.a === 1 && Array.isArray(pr.k)) {
        const ks = pr.k;
        for (let j = 1; j < ks.length; j++) {
          if (ks[j].t < ks[j - 1].t) errores.push(`capa ${i}: keyframes fuera de orden`);
        }
        if (ks.some(x => x.s === undefined)) errores.push(`capa ${i}: keyframe sin valor`);
      }
    });
  });
  return errores;
}

/* ── escribir ─────────────────────────────────────────────────────────── */
const piezas = { core: core(), sync: sync(), scan: scan(), check: check(), empty: empty() };
mkdirSync(SALIDA, { recursive: true });

let fallos = 0;
for (const [nombre, datos] of Object.entries(piezas)) {
  const errores = validar(datos);
  const ruta = join(SALIDA, nombre + '.json');
  writeFileSync(ruta, JSON.stringify(datos));
  const kb = (statSync(ruta).size / 1024).toFixed(1);
  if (errores.length) {
    fallos++;
    console.error(`  x ${nombre}.json · ${kb} KB`);
    errores.slice(0, 8).forEach(e => console.error('      · ' + e));
  } else {
    console.log(`  ok ${nombre}.json · ${kb} KB · ${datos.layers.length} capas · ${datos.op / datos.fr}s`);
  }
}

console.log(fallos
  ? `\n${fallos} animacion(es) con errores`
  : '\nok · animaciones Lottie listas en web/app/anim/');
process.exit(fallos ? 1 : 0);