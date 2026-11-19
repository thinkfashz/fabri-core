#!/usr/bin/env node
/* FORGE CORE STOCK · doctor nativo
 *
 * Qué se comprueba, y por qué importa:
 *   · el doctor mide páginas y APIs reales, sin inventar estados;
 *   · los reportes se guardan UNA fila por día, con topes y retención, para
 *     no llenar la base ni la nube;
 *   · el cliente captura errores, promesas, recursos y fallos de API, con
 *     archivo:línea:columna, deduplica y no manda datos personales;
 *   · la página muestra estado vivo, KPIs, periodo, gráfico, tablas y un
 *     resumen copiable para IA, con estados vacíos honestos;
 *   · el doctor está enlazado desde el panel, la ayuda y la PWA.
 *
 * Además de la estructura, ejecuta `web/doctor.js` en un navegador simulado:
 * así se comprueba el cuerpo real que se enviaría, no solo que el archivo
 * contenga ciertas palabras.
 *
 * Uso: node tests/web/doctor.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');
const WEB = path.join(RAIZ, 'web');
const API = path.join(RAIZ, 'api-telefono', 'api');
const PANEL = path.join(WEB, 'panel');
const DOCTOR = path.join(PANEL, 'doctor');

const leer = (p) => fs.readFileSync(p, 'utf8');
const existe = (p) => fs.existsSync(p);

let fallos = 0;
const ok = (nombre, cond, detalle) => {
  if (cond) console.log('  \x1b[1;32m✔\x1b[0m ' + nombre);
  else { fallos++; console.log('  \x1b[1;31m✖\x1b[0m ' + nombre + (detalle ? ' → ' + detalle : '')); }
};

/* ── 1 · servidor ───────────────────────────────────────────────────────── */

console.log('\n▸ doctor · servidor y almacenamiento');

const servidor = leer(path.join(API, 'diagnostico.ts'));

ok('el doctor vive en diagnostico.ts (no gasta una función nueva)',
  existe(path.join(API, 'diagnostico.ts')));
ok('la rama pública es GET ?accion=doctor',
  /accion === 'doctor'/.test(servidor) && /return await doctor\(req, res\)/.test(servidor));
ok('el reporte público se reconoce por accion:"reporte"',
  /accion.*=== 'reporte'/.test(servidor) && /recibirReporte\(req, res, cuerpo\)/.test(servidor));
ok('el informe legacy sigue exigiendo Bearer',
  /function informeLegacy/.test(servidor) && /autorizado\(req\)/.test(servidor) &&
  /requiere Authorization: Bearer/.test(servidor));

ok('CORS abierto para el doctor y el reporte',
  /Access-Control-Allow-Origin/.test(servidor) &&
  /Access-Control-Allow-Methods/.test(servidor) &&
  /req.method === 'OPTIONS'/.test(servidor));

ok('una fila por día con clave primaria DATE',
  new RegExp("CREATE TABLE IF NOT EXISTS \\$\\{TABLA\\} \\([\\s\\S]{0,200}dia DATE PRIMARY KEY").test(servidor));
ok('la retención es de 30 días',
  /RETENCION_DIAS = 30/.test(servidor) && /DELETE FROM \$\{TABLA\} WHERE dia < current_date/.test(servidor));
ok('topes por página, error y API',
  /TOPE_PAGINAS = 25/.test(servidor) && /TOPE_ERRORES = 20/.test(servidor) && /TOPE_APIS = 15/.test(servidor));
ok('tope de fila de 48 KB y recorte de stack',
  /TOPE_FILA = 48 \* 1024/.test(servidor) && /recortarHasta/.test(servidor) && /x\.s = ''/.test(servidor));
ok('el cuerpo del reporte se limita a 8 KB y 20 eventos',
  /MAX_CUERPO = 8_000/.test(servidor) && /MAX_EVENTOS = 20/.test(servidor));

ok('el servidor limpia token, correo y hash antes de guardar',
  /‹token›/.test(servidor) && /‹correo›/.test(servidor) && /‹hash›/.test(servidor));
ok('el sondeo de páginas comprueba el marcador real de cada módulo',
  /data-modulo="inicio"/.test(servidor) && /falta el marcador/.test(servidor));
ok('el sondeo de APIs distingue 200 de 401 esperado',
  /espera: 401/.test(servidor) && /exige token del dueño/.test(servidor));
ok('el sondeo se cachea 45 s para no castigar el despliegue',
  /CACHE_SONDEO_MS = 45_000/.test(servidor));

ok('el resumen legible por IA se genera en el servidor',
  /resumen_ia/.test(servidor) && /function resumenIA/.test(servidor) &&
  /DOCTOR FORGE CORE/.test(servidor));
ok('los descubrimientos salen de los datos, no de una plantilla fija',
  /function descubrir/.test(servidor) && /La página más lenta/.test(servidor) &&
  /La API con más fallos/.test(servidor) && /El error más repetido/.test(servidor));

ok('si el almacén falla, el sondeo sigue respondiendo',
  /almacen\.error/.test(servidor) && /guardado: false/.test(servidor));
ok('la limpieza manual de un día exige token del dueño',
  /function limpiarDia/.test(servidor) &&
  /accion.*=== 'limpiar'/.test(servidor) &&
  /function limpiarDia[\s\S]{0,300}autorizado\(req\)/.test(servidor));

/* ── 2 · archivos de la página ──────────────────────────────────────────── */

console.log('\n▸ doctor · página de estadísticas');

for (const f of ['index.html', 'doctor.css', 'doctor.js']) {
  ok('web/panel/doctor/' + f + ' existe', existe(path.join(DOCTOR, f)));
}

const html = leer(path.join(DOCTOR, 'index.html'));
const css = leer(path.join(DOCTOR, 'doctor.css'));
const js = leer(path.join(DOCTOR, 'doctor.js'));

ok('la página se identifica con data-doctor="1"', /data-doctor="1"/.test(html));
ok('carga components.css, shell.css y su CSS propio',
  /href="\/components\.css"/.test(html) &&
  /href="\/panel\/comun\/shell\.css"/.test(html) &&
  /href="\.\/doctor\.css"/.test(html));
ok('carga el doctor compartido antes del módulo de la página',
  /<script src="\/doctor\.js"><\/script>/.test(html) &&
  /<script type="module" src="\.\/doctor\.js"><\/script>/.test(html));
ok('no depende de CDNs ni fuentes remotas',
  !/fonts\.googleapis|cdn\.jsdelivr|unpkg\.com|cdnjs\.cloudflare|https?:\/\/[^\s"]+\.css/.test(html));

ok('la cabecera tiene estado vivo y hora real',
  /data-live/.test(html) && /data-live-txt/.test(html) && /en vivo/.test(js));
ok('los KPIs cubren páginas, APIs, errores, fallos, reportes y almacenamiento',
  ['paginas', 'apis', 'errores', 'fallos', 'reportes', 'kb']
    .every((k) => new RegExp('data-kpi="' + k + '"').test(html)));
ok('el periodo ofrece 1, 7, 14 y 30 días',
  ['1', '7', '14', '30'].every((d) => new RegExp('data-dias="' + d + '"').test(html)));
ok('hay un solo gráfico protagonista', (html.match(/data-grafico(?=[\s>])/g) || []).length === 1);
ok('el gráfico se alimenta de errores + fallos de API',
  /x\.errores\) \+ num\(x\.api_fallos\)/.test(js));
ok('las tablas cubren páginas, APIs y errores',
  /data-paginas/.test(html) && /data-apis/.test(html) && /data-errores/.test(html));
ok('los errores muestran archivo:línea:columna',
  /doc-codigo/.test(js) && /e\.archivo/.test(js) && /e\.linea/.test(js) && /e\.columna/.test(js));
ok('el stack se abre en un details acotado',
  /<details class="doc-detalle">/.test(js) && /doc-stack/.test(css));
ok('hay un resumen copiable para IA y un JSON completo',
  /data-copiar/.test(html) && /data-copiar-json/.test(html) && /resumen_ia/.test(js));
ok('el resumen se pinta como texto, no como HTML',
  /pre\.textContent = d\.resumen_ia/.test(js));
ok('la página se actualiza sola cada 30 s',
  /REFRESCO_MS = 30_000/.test(js) && /setInterval\(/.test(js));
ok('la última lectura queda en caché y se marca como stale',
  /fcore\.doctor\.cache/.test(js) && /'stale'/.test(js));
ok('los estados vacíos son honestos (sin datos ≠ cero inventado)',
  /Sin fallos en el periodo/.test(js) && /Sin errores de navegador/.test(js) &&
  /Sin páginas medidas/.test(js) && /ds-empty/.test(js));
ok('la página llama a la API por el cliente común, no por /api relativo',
  /from '\.\.\/comun\/api\.js'/.test(js) && !/fetch\(\s*['"`]\/api\//.test(js));

ok('el CSS usa los tokens del sistema, no hex sueltos',
  /var\(--ds-/.test(css) && !/#[0-9a-f]{3,8}\b/i.test(css.replace(/\/\*[\s\S]*?\*\//g, '')));
ok('el CSS no mete scroll horizontal en móvil',
  /\.doc-tabla \.ds-table \{ min-width: 620px/.test(css) &&
  /@media \(max-width: 559px\)[\s\S]{0,300}\.doc-tabla \.ds-table \{ min-width: 0/.test(css));
ok('la página respeta prefers-reduced-motion',
  /@media \(prefers-reduced-motion: reduce\)/.test(css));

/* ── 3 · doctor compartido: ejecución real en navegador simulado ────────── */

console.log('\n▸ doctor · captura real (navegador simulado)');

const compartido = leer(path.join(WEB, 'doctor.js'));
ok('el doctor compartido existe y no usa import/export (sirve en PWA y panel)',
  existe(path.join(WEB, 'doctor.js')) &&
  !/^\s*(import|export)\s/m.test(compartido));
ok('la API del doctor es absoluta',
  /var API = 'https:\/\/fabri-api\.vercel\.app\/api\/diagnostico'/.test(compartido));
ok('captura error, unhandledrejection y recursos',
  /addEventListener\('error'/.test(compartido) &&
  /addEventListener\('unhandledrejection'/.test(compartido) &&
  /objetivo\.src \|\| objetivo\.href/.test(compartido));
ok('deduplica y limita a 12 eventos y 3 repeticiones',
  /MAX_EVENTOS = 12/.test(compartido) && /MAX_REPETICIONES = 3/.test(compartido));
ok('manda un latido por página y día',
  /fcore\.doctor\.visto\./.test(compartido) && /function latido/.test(compartido));
ok('vigila esqueletos a los 15 s y páginas lentas a los 4 s',
  /15_000/.test(compartido) && /ms > 4000/.test(compartido));
ok('usa keepalive y sendBeacon al salir',
  /keepalive: true/.test(compartido) && /navigator\.sendBeacon/.test(compartido));

/* Entorno mínimo para ejecutar el archivo real. */
const manejadores = { window: {}, document: {} };
const guardado = new Map();
const timeouts = new Map();
let idTimeout = 0;
const llamadas = [];

function fakeWindow() {
  return {
    screen: { width: 390, height: 844 },
    innerWidth: 390,
    innerHeight: 844,
    addEventListener(tipo, fn) { (manejadores.window[tipo] = manejadores.window[tipo] || []).push(fn); },
    removeEventListener() {},
  };
}

const win = fakeWindow();
Object.defineProperty(globalThis, 'window', { value: win, configurable: true });
Object.defineProperty(globalThis, 'document', {
  value: {
    readyState: 'loading',
    visibilityState: 'visible',
    addEventListener(tipo, fn) { (manejadores.document[tipo] = manejadores.document[tipo] || []).push(fn); },
    querySelectorAll() { return []; },
    createElement() { return { style: {}, setAttribute() {}, select() {}, remove() {} }; },
    body: { appendChild() {} },
  },
  configurable: true,
});
Object.defineProperty(globalThis, 'location', {
  value: {
    origin: 'https://forge-core-stock.vercel.app',
    hostname: 'forge-core-stock.vercel.app',
    protocol: 'https:',
    href: 'https://forge-core-stock.vercel.app/panel/cliente/inicio/',
    pathname: '/panel/cliente/inicio/',
  },
  configurable: true,
});
Object.defineProperty(globalThis, 'navigator', {
  value: {
    userAgent: 'Mozilla/5.0 (Linux; Android 14)',
    language: 'es-CL',
    webdriver: false,
    connection: { effectiveType: '4g' },
  },
  configurable: true,
});
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem(k) { return guardado.has(k) ? guardado.get(k) : null; },
    setItem(k, v) { guardado.set(k, String(v)); },
    removeItem(k) { guardado.delete(k); },
  },
  configurable: true,
});
Object.defineProperty(globalThis, 'performance', {
  value: { getEntriesByType() { return [{ duration: 6200, loadEventEnd: 6200, startTime: 0 }]; } },
  configurable: true,
});
globalThis.setTimeout = (fn, ms) => {
  const id = ++idTimeout;
  timeouts.set(id, { fn, ms });
  return id;
};
globalThis.clearTimeout = (id) => { timeouts.delete(id); };
globalThis.fetch = async (url, opciones) => {
  llamadas.push({ url, opciones, cuerpo: JSON.parse(opciones.body) });
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

require(path.join(WEB, 'doctor.js'));
const D = win.FCoreDoctor;

ok('el doctor se expone en window.FCoreDoctor', Boolean(D) && typeof D.apiFallo === 'function');
ok('el latido se guarda una vez por página y día',
  [...guardado.keys()].some((k) => k.startsWith('fcore.doctor.visto.')));

D.apiFallo({
  metodo: 'POST',
  url: 'https://fabri-api.vercel.app/api/mercado?accion=pedido_crear',
  status: 500,
  ms: 820,
  mensaje: 'no se pudo crear el pedido',
  archivo: '/panel/cliente/checkout/checkout.js',
  linea: 88,
  columna: 12,
});

const errorFalso = new Error('No se pudo leer el carrito de eduardo@ejemplo.cl');
errorFalso.stack = 'Error: fallo\n    at cargar (https://forge-core-stock.vercel.app/panel/cliente/inicio/inicio.js:42:9)';
manejadores.window.error[0]({
  target: win,
  message: errorFalso.message,
  filename: 'https://forge-core-stock.vercel.app/panel/cliente/inicio/inicio.js',
  lineno: 42,
  colno: 9,
  error: errorFalso,
});

manejadores.window.error[0]({
  target: { tagName: 'SCRIPT', src: 'https://forge-core-stock.vercel.app/panel/comun/roto.js' },
});

manejadores.window.unhandledrejection[0]({
  reason: new Error('promesa rota con token eyJhbGciOiJIUzI1NiJ9.secreto.largo'),
});

// La misma huella 5 veces: solo deben quedar 3.
for (let i = 0; i < 5; i++) {
  D.evento({ t: 'error', m: 'repetido', a: '/panel/cliente/inicio/inicio.js', l: 42, c: 9 });
}

D.flush(true);

const ultima = llamadas[llamadas.length - 1];
const eventos = (ultima && ultima.cuerpo && ultima.cuerpo.eventos) || [];
const textos = JSON.stringify(eventos);

ok('el reporte se envía a la API absoluta',
  Boolean(ultima) && ultima.url === 'https://fabri-api.vercel.app/api/diagnostico');
ok('el cuerpo lleva accion:"reporte" y la página',
  ultima && ultima.cuerpo.accion === 'reporte' &&
  ultima.cuerpo.pagina === '/panel/cliente/inicio');
ok('el fallo de API viaja como evento api con status',
  eventos.some((e) => e.t === 'api' && e.st === 500 && e.u === '/api/mercado'));
ok('el error de JavaScript conserva archivo, línea y columna',
  eventos.some((e) => e.t === 'error' && e.a === '/panel/cliente/inicio/inicio.js' && e.l === 42 && e.c === 9));
ok('el recurso roto se reporta como recurso',
  eventos.some((e) => e.t === 'recurso' && e.u === '/panel/comun/roto.js'));
ok('la promesa rechazada se reporta como promesa',
  eventos.some((e) => e.t === 'promesa'));
ok('el correo y el token se limpian antes de salir',
  /‹correo›/.test(textos) && /‹token›/.test(textos) && !/eduardo@ejemplo\.cl/.test(textos));
ok('la misma huella no se repite más de 3 veces',
  eventos.filter((e) => e.m === 'repetido').length === 3,
  String(eventos.filter((e) => e.m === 'repetido').length));
ok('el latido viaja como visto', eventos.some((e) => e.t === 'visto'));

/* ── 4 · integración con panel, ayuda, PWA y límite de funciones ────────── */

console.log('\n▸ doctor · integración');

const shell = leer(path.join(PANEL, 'comun', 'shell.js'));
ok('el shell carga el doctor sin poder tumbar la página',
  /import\('\/doctor\.js'\)\.catch/.test(shell));
ok('el pie del panel enlaza al doctor', /href="\/panel\/doctor\/"/.test(shell));

const ayuda = leer(path.join(PANEL, 'cliente', 'ayuda', 'index.html'));
ok('la ayuda enlaza al diagnóstico completo', /href="\/panel\/doctor\/"/.test(ayuda));

const app = leer(path.join(WEB, 'app', 'index.html'));
ok('la PWA carga el doctor antes que app.js',
  app.indexOf('<script src="/doctor.js"></script>') >= 0 &&
  app.indexOf('<script src="/doctor.js"></script>') < app.indexOf('<script src="./app.js"></script>'));

const sw = leer(path.join(WEB, 'app', 'sw.js'));
ok('el service worker precachea ../doctor.js',
  /'\.\.\/doctor\.js'/.test(sw));
ok('el service worker subió a fcore-v99', /fcore-v99/.test(sw));

const funciones = fs.readdirSync(API).filter((f) => f.endsWith('.ts')).length;
ok('la API sigue con 12 funciones .ts o menos', funciones <= 12, String(funciones));

/* ── cierre ─────────────────────────────────────────────────────────────── */

console.log(fallos === 0
  ? '\n\x1b[1;32m✔ doctor: mide, limpia, comprime y se puede leer desde la nube\x1b[0m\n'
  : '\n\x1b[1;31m✖ doctor: ' + fallos + ' fallo(s)\x1b[0m\n');
process.exit(fallos === 0 ? 0 : 1);
