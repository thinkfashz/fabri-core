#!/usr/bin/env node
/* FORGE CORE STOCK · verificación de envío (/verificar.html)
 *
 * La página muestra el estado REAL del pedido y un recorrido 3D. Esta prueba
 * cuida lo que no puede fallar:
 *   · el código único se normaliza y se muestra igual en todas las pantallas;
 *   · el recorrido NO inventa estados: cada parada sale del estado real;
 *   · la API busca por `verificacion` y completa pedidos viejos sin migración;
 *   · el código viaja en el alta, en el seguimiento, en el panel y en la PWA;
 *   · si no hay WebGL se muestra un aviso honesto y el texto sigue completo.
 *
 * Uso: node tests/web/verificar-negocio.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');
const WEB = path.join(RAIZ, 'web');
const MERCADO = path.join(RAIZ, 'api-telefono', 'api', 'mercado.ts');

const leer = (p) => fs.readFileSync(p, 'utf8');
let fallos = 0;
let pasos = 0;
const ok = (nombre, cond, detalle) => {
  pasos++;
  if (cond) console.log('  \x1b[1;32m✔\x1b[0m ' + nombre);
  else {
    fallos++;
    console.log('  \x1b[1;31m✖\x1b[0m ' + nombre + (detalle ? ' → ' + detalle : ''));
  }
};

console.log('\n▸ verificación de envío · archivos y contrato');

/* 1 · La página es completa y no depende de la app para funcionar. */
{
  const html = leer(path.join(WEB, 'verificar.html'));
  ok('verificar.html carga components.css y tienda.css',
    /components\.css/.test(html) && /tienda\.css/.test(html));
  ok('verificar.html carga su propio verificar.css', /verificar\.css/.test(html));
  ok('verificar.html tiene formulario con el campo de verificación',
    /id="vfForm"/.test(html) && /id="vfCodigo"/.test(html));
  ok('verificar.html tiene canvas y respaldo textual',
    /id="vfCanvas"/.test(html) && /id="vfFallback"/.test(html));
  ok('verificar.html carga verificar.js', /verificar\.js/.test(html));
  ok('verificar.html no exige sesión ni cuenta',
    !/fcore\.nube/.test(html) && !/Iniciar sesión|Entrar<\/button>/.test(html));
  ok('existe verificar.css', fs.existsSync(path.join(WEB, 'verificar.css')));
  ok('existe verificar.js', fs.existsSync(path.join(WEB, 'verificar.js')));
}

/* 2 · Funciones puras: se ejecuta el mismo archivo del navegador con stubs. */
console.log('\n▸ verificación de envío · lógica pura');

const fuente = leer(path.join(WEB, 'verificar.js'));
let V = null;
try {
  const ventana = { matchMedia: () => ({ matches: false }) };
  const documento = {
    readyState: 'loading',
    addEventListener: () => {},
    getElementById: () => null,
    createElement: () => ({ getContext: () => null, style: {} }),
  };
  const almacen = { getItem: () => '', setItem: () => {} };
  const fabrica = new Function(
    'window', 'document', 'localStorage', 'fetch', 'location',
    'setTimeout', 'clearTimeout', 'Promise', 'URLSearchParams',
    fuente + '\nreturn window.Verificar ? window.Verificar._test : null;'
  );
  V = fabrica(ventana, documento, almacen,
    () => Promise.resolve({ json: () => Promise.resolve({}) }),
    { search: '' }, setTimeout, clearTimeout, Promise, URLSearchParams);
} catch (e) {
  ok('verificar.js se puede cargar sin navegador', false, e.message);
}

if (V) {
  ok('normaliza el código con o sin prefijo y separadores',
    V.normalizarCodigo('v-7k2m-9q4p') === 'V7K2M9Q4P' &&
    V.normalizarCodigo('7K2M9Q4P') === 'V7K2M9Q4P');
  ok('el código mostrado siempre es V-XXXX-XXXX',
    V.mostrarCodigo('V7K2M9Q4P') === 'V-7K2M-9Q4P' &&
    V.mostrarCodigo('') === '');
  ok('un código más largo no crece: se corta en 9',
    V.normalizarCodigo('V7K2M9Q4PXXXX').length === 9);

  const camino = V.estadoInfo('listo', 'delivery');
  ok('delivery listo se lee «En camino»',
    camino.chip === 'En camino' && /va en camino/.test(camino.titulo));
  const retiro = V.estadoInfo('listo', 'retiro');
  ok('retiro listo se lee «Listo para retirar»',
    retiro.chip === 'Listo' && /listo para retirar/.test(retiro.titulo));
  ok('entregado en retiro se lee «Pedido retirado»',
    V.estadoInfo('entregado', 'retiro').titulo === 'Pedido retirado');
  ok('cancelado tiene su propio estado', V.estadoInfo('cancelado', 'delivery').chip === 'Cancelado');

  const paradas = V.paradasDe({ entrega: 'delivery' });
  ok('hay cuatro paradas y la última es la casa',
    paradas.length === 4 && paradas[3].titulo === 'Entregado en tu casa');
  ok('el retiro termina en el local',
    V.paradasDe({ entrega: 'retiro' })[3].titulo === 'Retirado');

  ok('el índice del estado real avanza en orden',
    V.indiceDe('nuevo') === 0 && V.indiceDe('visto') === 1 &&
    V.indiceDe('listo') === 2 && V.indiceDe('entregado') === 3);
  ok('cancelado no tiene índice de avance', V.indiceDe('cancelado') === -1);

  const horas = V.eventosPorEstado([{ estado: 'listo', ts: '2026-11-24T10:00:00Z' }], '2026-11-24T09:00:00Z');
  ok('la hora real del estado manda sobre la de creación',
    horas.nuevo === '2026-11-24T09:00:00Z' && horas.listo === '2026-11-24T10:00:00Z');

  const pos = ['nuevo', 'visto', 'listo', 'entregado'].map(V.posicionDe);
  ok('el auto avanza con el estado y no retrocede',
    pos[0] < pos[1] && pos[1] < pos[2] && pos[2] < pos[3]);
  ok('cancelado estaciona al inicio', V.posicionDe('cancelado') <= pos[0]);
}

/* 3 · La escena es 3D real y respeta movimiento reducido. */
console.log('\n▸ verificación de envío · escena 3D');
{
  const js = fuente;
  ok('usa Three.js (WebGL) y no un dibujo falso',
    /new T\.WebGLRenderer/.test(js) && /new T\.OrthographicCamera/.test(js));
  ok('carga Three.js desde el vendor del repo',
    /\.\/app\/vendor\/three\.min\.js/.test(js));
  ok('sin WebGL muestra respaldo honesto', /hayWebGL\(\)/.test(js) && /vfFallback/.test(js));
  ok('respeta prefers-reduced-motion', /prefers-reduced-motion/.test(js));
  ok('pausa el render con la pestaña oculta', /document\.hidden/.test(js) && /visibilitychange/.test(js));
  ok('libera geometrías y materiales al salir', /\.dispose\(\)/.test(js) && /destruir: function/.test(js));
  ok('el auto no se mueve a la casa si el pedido no está entregado',
    /listo: 0\.58/.test(js) && /entregado: 0\.95/.test(js));
  ok('si se pierde el contexto WebGL se avisa, no se deja un cuadro vacío',
    /webglcontextlost/.test(js) && /alPerderContexto/.test(js));
  ok('expone la posición del auto para diagnóstico', /posicion: function \(\)/.test(js));
}

/* 4 · La escena sigue al estado real. Se ejecuta `crearEscena` con un THREE
   simulado: es el mismo código del navegador, sin depender de la GPU. */
console.log('\n▸ verificación de envío · escena sigue al estado');
if (V && V.crearEscena) {
  /* THREE mínimo: lo justo para que la escena se construya y se mueva. */
  const crearTHREE = () => {
    class Vector3 {
      constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
      set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    }
    class Obj {
      constructor() {
        this.position = new Vector3();
        this.rotation = { x: 0, y: 0, z: 0 };
        this.scale = { set: () => {}, setScalar: () => {} };
        this.children = [];
      }
      add(o) { this.children.push(o); return this; }
      traverse(f) { f(this); this.children.forEach((c) => c.traverse && c.traverse(f)); }
    }
    class Mesh extends Obj {
      constructor(geo, mat) { super(); this.geometry = geo; this.material = mat; }
    }
    const Geo = class { dispose() {} };
    /* La curva devuelve puntos distintos según t, como la real. */
    class Curva {
      getPointAt(t) { return new Vector3(-8.2 + 16.4 * t, 0, 0.9); }
      getTangentAt() { return new Vector3(1, 0, 0); }
    }
    class Material {
      constructor(opciones) {
        const o = opciones || {};
        this.color = { setHex() {}, setScalar() {} };
        this.map = o.map || null;
        this.opacity = o.opacity == null ? 1 : o.opacity;
        this.transparent = Boolean(o.transparent);
        this.side = o.side;
      }
      dispose() {}
    }
    const T = {
      Vector3, Group: Obj, Mesh, Curve: Curva,
      BoxGeometry: Geo, PlaneGeometry: Geo, CylinderGeometry: Geo, ConeGeometry: Geo,
      SphereGeometry: Geo, CircleGeometry: Geo, RingGeometry: Geo,
      CatmullRomCurve3: Curva,
      Scene: class extends Obj { constructor() { super(); this.fog = null; } },
      Fog: class {},
      HemisphereLight: Obj, DirectionalLight: Obj,
      OrthographicCamera: class extends Obj {
        constructor() { super(); }
        lookAt() {}
        updateProjectionMatrix() {}
      },
      WebGLRenderer: class {
        constructor() { this.dpr = 1; }
        setClearColor() {}
        setPixelRatio(v) { this.dpr = v; }
        setSize() {}
        render() { this.pintados = (this.pintados || 0) + 1; }
        dispose() {}
      },
      MeshLambertMaterial: Material, MeshBasicMaterial: Material,
      CanvasTexture: class { constructor() {} dispose() {} },
      DoubleSide: 2,
    };
    return T;
  };

  const lienzo = {
    clientWidth: 360, clientHeight: 260, hidden: false,
    addEventListener: () => {}, removeEventListener: () => {},
    getContext: () => null,
  };
  const ctx2d = {
    fillRect() {}, fillText() {}, fillStyle: '', font: '', textAlign: '', textBaseline: '',
  };
  const doc = {
    readyState: 'loading',
    addEventListener: () => {}, removeEventListener: () => {},
    getElementById: () => null,
    createElement: (t) => (t === 'canvas'
      ? { width: 0, height: 0, getContext: () => ctx2d, style: {} }
      : { style: {} }),
    head: { appendChild: () => {} },
  };
  const ventana = {
    THREE: crearTHREE(),
    matchMedia: () => ({ matches: true }),   // movimiento reducido: sin rAF
    devicePixelRatio: 2,
    addEventListener: () => {}, removeEventListener: () => {},
    console: { warn: () => {} },
  };
  const fabricaEscena = new Function(
    'window', 'document', 'localStorage', 'fetch', 'location',
    'setTimeout', 'clearTimeout', 'Promise', 'URLSearchParams', 'requestAnimationFrame',
    'cancelAnimationFrame', 'performance',
    fuente + '\nreturn window.Verificar ? window.Verificar._test : null;'
  );
  let E = null;
  try {
    E = fabricaEscena(ventana, doc, { getItem: () => '', setItem: () => {} },
      () => Promise.resolve({ json: () => Promise.resolve({}) }), { search: '' },
      setTimeout, clearTimeout, Promise, URLSearchParams,
      () => 1, () => {}, { now: () => Date.now() });
  } catch (e) {
    ok('la escena se puede construir sin GPU', false, e.message);
  }

  if (E && E.crearEscena) {
    try {
      const escena = E.crearEscena(lienzo, { estado: 'nuevo', entrega: 'delivery' });
      ok('la escena se construye y reporta posición', Boolean(escena && escena.posicion));
      ok('arranca en el distribuidor cuando el pedido es nuevo',
        escena.posicion().t === E.posicionDe('nuevo'));

      escena.actualizar({ estado: 'listo', entrega: 'delivery' });
      ok('en «listo» el destino es la mitad de la ruta',
        escena.posicion().destino === 0.58, String(escena.posicion().destino));

      escena.actualizar({ estado: 'entregado', entrega: 'delivery' });
      ok('entregado lleva el auto a la casa',
        escena.posicion().destino === 0.95, String(escena.posicion().destino));
      ok('con movimiento reducido el auto llega sin animación',
        escena.posicion().t === 0.95, String(escena.posicion().t));

      escena.actualizar({ estado: 'cancelado', entrega: 'delivery' });
      ok('cancelado devuelve el auto al origen',
        escena.posicion().destino <= E.posicionDe('nuevo'));

      let falloDestruir = '';
      ok('destruir no lanza y libera la escena', (() => {
        try { escena.destruir(); return true; } catch (e) { falloDestruir = e.message; return false; }
      })(), falloDestruir);
    } catch (e) {
      ok('la escena se construye sin GPU', false, e.message);
    }
  }
}

/* 5 · La API entrega y busca el código único. */
console.log('\n▸ verificación de envío · API');
{
  const api = leer(MERCADO);
  ok('existe la columna `verificacion` y su índice único',
    /ADD COLUMN IF NOT EXISTS verificacion/.test(api) &&
    /idx_mercado_pedidos_verificacion/.test(api));
  ok('el alto del pedido genera un código único',
    /function codigoVerificacion/.test(api) && /let verificacion = codigoVerificacion\(\)/.test(api));
  ok('el INSERT guarda la verificación', /cliente_id,verificacion\)/.test(api) && /clienteId, verificacion\]/.test(api));
  ok('el alta devuelve el código al comprador', /clave_entrega: claveEntrega, verificacion/.test(api));
  ok('pedido_seguir busca por verificación',
    /verificacionComparable\(cuerpo\.verificacion\)/.test(api) &&
    /WHERE p\.verificacion = \$1/.test(api));
  ok('los pedidos viejos se completan al abrirse, sin migración pesada',
    /WHERE id = \$1 AND verificacion = '' RETURNING verificacion/.test(api));
  ok('el seguimiento devuelve la verificación', /verificacion: fila\.verificacion \|\| ''/.test(api));
  ok('el panel del dueño recibe la verificación',
    /p\.codigo,p\.seguimiento,p\.verificacion,p\.cliente/.test(api));
  ok('las reseñas pendientes pueden abrir el recorrido',
    /p\.codigo, p\.seguimiento, p\.verificacion, p\.local_id/.test(api));
}

/* 5 · El código aparece en el ciclo completo. */
console.log('\n▸ verificación de envío · integración con el ciclo');
{
  const seguir = leer(path.join(WEB, 'tienda-seguir.js'));
  ok('el seguimiento muestra el código y el enlace 3D',
    /bloqueVerificacion/.test(seguir) && /\/verificar\.html\?v=/.test(seguir));
  const pedidos = leer(path.join(WEB, 'panel', 'negocio', 'pedidos', 'pedidos.js'));
  ok('N02 muestra el código para compartirlo',
    /data-copiar/.test(pedidos) && /\/verificar\.html\?v=/.test(pedidos));
  ok('N02 usa la hora real del evento (ts)', /ev\.ts \|\| ev\.creado/.test(pedidos));
  const placer = leer(path.join(WEB, 'app', 'placer.js'));
  ok('la compra guarda el código que devuelve la API',
    /ESTADO\.pago\.verificacion = d\.verificacion/.test(placer));
  ok('la compra ofrece el recorrido 3D', /\/verificar\.html\?v=/.test(placer));
  const resenas = leer(path.join(WEB, 'panel', 'cliente', 'resenas', 'resenas.js'));
  ok('C12 enlaza el recorrido del pedido entregado',
    /verificacion: p\.verificacion/.test(resenas) && /Recorrido 3D/.test(resenas));
}

console.log('\n' + (fallos ? '\x1b[1;31m' : '\x1b[1;32m') +
  (fallos ? '✖ verificar-negocio: ' + fallos + ' fallo(s)' : '✔ verificar-negocio: ' + pasos + ' comprobaciones OK') +
  '\x1b[0m\n');
process.exit(fallos ? 1 : 0);
