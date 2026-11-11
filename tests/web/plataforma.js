#!/usr/bin/env node
/* Pruebas del panel de plataforma (plataforma.js).
 *
 * No abre navegador ni toca la red:
 *   · carga `web/app/plataforma.js` con un DOM mínimo y prueba las funciones
 *     puras (filtro de cuentas, barras de tráfico, fechas relativas);
 *   · comprueba que `index.html` tenga los ids que el módulo usa;
 *   · comprueba que el token NO esté escrito en ningún archivo del sitio y que
 *     sólo se guarde en sessionStorage/localStorage;
 *   · comprueba que reusa los endpoints existentes (resumen, usuarios, visitas,
 *     diag) y que el service worker lo precachee.
 *
 * Uso: node tests/web/plataforma.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');

/* ── entorno mínimo para cargar el módulo ────────────────────────────────── */
const sesion = new Map();
const equipo = new Map();
const almacen = (mapa) => ({
  getItem: (k) => (mapa.has(k) ? mapa.get(k) : null),
  setItem: (k, v) => { mapa.set(k, String(v)); },
  removeItem: (k) => { mapa.delete(k); }
});
global.sessionStorage = almacen(sesion);
global.localStorage = almacen(equipo);
global.document = {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  createElement: () => ({ getContext: () => null }),
  readyState: 'complete'
};
global.window = {
  Fabri: { q: () => [], toast: () => {}, go: () => {} }
};

require(path.join(RAIZ, 'web', 'app', 'plataforma.js'));
const P = global.window.Plataforma;

/* ── utilidades de la prueba ─────────────────────────────────────────────── */
let fallos = 0;
let pasos = 0;
const ok = (nombre, condicion, detalle) => {
  pasos++;
  if (condicion) {
    console.log('  \x1b[1;32m✔\x1b[0m ' + nombre);
  } else {
    fallos++;
    console.log('  \x1b[1;31m✖\x1b[0m ' + nombre + (detalle ? ' → ' + detalle : ''));
  }
};
const igual = (nombre, a, b) => ok(nombre, JSON.stringify(a) === JSON.stringify(b),
  'esperaba ' + JSON.stringify(b) + ', llegó ' + JSON.stringify(a));
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

/* ── 1. módulo cargado ───────────────────────────────────────────────────── */
console.log('\nMódulo');
ok('Plataforma expone render', P && typeof P.render === 'function');
ok('Plataforma expone cargar', P && typeof P.cargar === 'function');
ok('las funciones puras están disponibles', P && P._test &&
  typeof P._test.barrasVisitas === 'function' &&
  typeof P._test.filtrarCuentas === 'function' &&
  typeof P._test.haceCuanto === 'function');

/* ── 2. cuentas ──────────────────────────────────────────────────────────── */
console.log('\nCuentas · búsqueda sin acentos');
const CUENTAS = [
  { id: '1', email: 'F.eduardomicolta@gmail.com', nombre: 'Fabricio', rol: 'owner', terminos_version: '1' },
  { id: '2', email: 'ana.perez@local.cl', nombre: 'Ana Pérez', rol: 'member', terminos_version: '' },
  { id: '3', email: 'rosa@almacen.cl', nombre: 'Rosa Díaz', rol: 'member', terminos_version: '1' }
];
igual('sin texto devuelve todas', P._test.filtrarCuentas(CUENTAS, '').length, 3);
igual('busca por correo', P._test.filtrarCuentas(CUENTAS, 'ana.perez').length, 1);
igual('busca por nombre sin acentos', P._test.filtrarCuentas(CUENTAS, 'perez').length, 1);
igual('busca «diaz» sin tilde', P._test.filtrarCuentas(CUENTAS, 'diaz').length, 1);
igual('busca por rol', P._test.filtrarCuentas(CUENTAS, 'owner').length, 1);
igual('no inventa resultados', P._test.filtrarCuentas(CUENTAS, 'zzz').length, 0);
ok('no devuelve el arreglo original', P._test.filtrarCuentas(CUENTAS, '') !== CUENTAS);
ok('tolera basura', P._test.filtrarCuentas(null, 'x').length === 0);

/* ── 3. tráfico ──────────────────────────────────────────────────────────── */
console.log('\nTráfico · barras por día');
const HOY = Date.UTC(2026, 10, 11, 15);
const barras = P._test.barrasVisitas([
  { dia: '2026-11-09', n: 4 },
  { dia: '2026-11-11', n: 12 }
], 7, HOY);
igual('una barra por día del periodo', barras.length, 7);
igual('el último día es hoy', barras[6].hoy, true);
igual('el día sin visitas queda en cero', barras[5].n, 0);
igual('la más alta ocupa 100 %', barras[6].alto, 100);
igual('un día vacío conserva 2 %', barras[5].alto, 2);
igual('la etiqueta es el día del mes', barras[6].etiqueta, '11');
igual('el día con datos conserva su número', barras[4].n, 4);
const b30 = P._test.barrasVisitas([], 30, HOY);
igual('30 días sin datos igual dibuja 30', b30.length, 30);
igual('con 30 días se rotula cada 5 y el último', b30.filter((b) => b.etiqueta).length, 7);
igual('sin datos todo queda en cero', b30.every((b) => b.n === 0), true);

/* ── 4. fechas y números ─────────────────────────────────────────────────── */
console.log('\nFormato');
igual('sin fecha dice nunca', P._test.haceCuanto(0, HOY), 'nunca');
igual('hace menos de un minuto', P._test.haceCuanto(HOY - 10 * 1000, HOY), 'recién');
igual('minutos', P._test.haceCuanto(HOY - 3 * 60 * 1000, HOY), 'hace 3 min');
igual('horas', P._test.haceCuanto(HOY - 5 * 3600 * 1000, HOY), 'hace 5 h');
igual('días', P._test.haceCuanto(HOY - 4 * 86400 * 1000, HOY), 'hace 4 d');
ok('más de 30 días pasa a fecha', /2026/.test(P._test.haceCuanto(HOY - 60 * 86400 * 1000, HOY)));
igual('miles con punto chileno', P._test.num(12345), '12.345');
igual('cero se muestra', P._test.num(0), '0');
igual('basura no rompe', P._test.num('x'), '—');
igual('el plan se lee del objeto de la API', P._test.textoPlan({ gratis: 300, pro: 3000 }),
  'productos: 300 gratis · 3.000 pro');
igual('sin plan no inventa', P._test.textoPlan(null), '—');
igual('un plan suelto no rompe', P._test.textoPlan(300), '—');

/* ── 5. contrato del HTML ────────────────────────────────────────────────── */
console.log('\nContrato · index.html');
const html = leer('web/app/index.html');
const ids = [
  'platCandado', 'platToken', 'platEntrar', 'platRecordar', 'platCandadoAviso', 'platCandadoChip',
  'platPanel', 'platLive', 'platEstado', 'platSalir', 'platRango',
  'platKpis', 'platVisitas', 'platVisitasSub', 'platVisitasChip',
  'platCanales', 'platCanalesTotal', 'platRutas', 'platRutasChip',
  'platCuentas', 'platCuentasN', 'platCuentasBuscar', 'platSalud', 'platSaludChip'
];
const faltan = ids.filter((id) => !new RegExp('id="' + id + '"').test(html));
ok('todos los ids que usa plataforma.js existen', faltan.length === 0, 'faltan: ' + faltan.join(', '));
ok('la pantalla existe', /id="s-plataforma"/.test(html));
ok('el panel arranca oculto', /id="platPanel" hidden/.test(html));
ok('el token se pide como contraseña', /id="platToken"[^>]*type="password"/.test(html));
ok('la pantalla carga su módulo', /plataforma\.js/.test(html));

/* ── 6. seguridad del token ──────────────────────────────────────────────── */
console.log('\nSeguridad · el token no vive en el sitio');
const js = leer('web/app/plataforma.js');
ok('no hay un token escrito en el módulo', !/Bearer\s+[A-Za-z0-9._-]{20,}/.test(js));
ok('no hay JWT ni hash largo incrustado', !/eyJ[A-Za-z0-9_-]{10,}/.test(js));
ok('no lee variables de entorno', !/FABRI_API_TOKEN\s*=/.test(js));
ok('guarda en sessionStorage', /sessionStorage\.setItem/.test(js));
ok('«recordar» usa localStorage', /localStorage\.setItem/.test(js));
ok('puede borrar el token', /removeItem/.test(js));
ok('nunca pinta el token en pantalla',
  !/(textContent|innerHTML)\s*=[^\n]*EST\.token/.test(js));
ok('el campo se limpia después de entrar', /input\.value\s*=\s*""/.test(js));
ok('el token viaja como Bearer', /Authorization.*Bearer/.test(js));

/* ── 7. endpoints reusados ───────────────────────────────────────────────── */
console.log('\nContrato · API existente');
ok('usa mercado · resumen', /\/mercado["'][\s\S]{0,80}resumen/.test(js));
ok('usa auth · usuarios', /\/auth["'][\s\S]{0,80}usuarios/.test(js));
ok('usa visitas con días', /\/visitas\?dias=/.test(js));
ok('usa el diagnóstico del latido', /\/auth\?diag=1/.test(js));
const rutas = [...js.matchAll(/pedir\(\s*"([^"]+)"/g)].map((m) => m[1]);
ok('sólo llama a las rutas existentes',
  rutas.length === 4 && rutas.every((r) => /^\/(auth\?diag=1|mercado|auth|visitas\?dias=)$/.test(r)),
  rutas.join(', '));
ok('trata el 401 como token inválido', /401/.test(js));

/* ── 8. arranque y precache ──────────────────────────────────────────────── */
console.log('\nArranque · precache y navegación');
const sw = leer('web/app/sw.js');
ok('el service worker precachea plataforma.js', /'\.\/plataforma\.js'/.test(sw));
const app = leer('web/app/app.js');
ok('go() monta la pantalla', /plataforma' && window\.Plataforma/.test(app));
ok('la pantalla no es pública', !/PUBLICAS\s*=\s*\{[^}]*plataforma/.test(app));
const pro = leer('web/app/core-pro.js');
ok('el owner tiene la entrada desde Cuenta', /cuPlataforma/.test(pro) && /rol === 'owner'/.test(pro));

/* ── cierre ─────────────────────────────────────────────────────────────── */
console.log(fallos
  ? '\n\x1b[1;31m✖ ' + fallos + ' fallo(s) de ' + pasos + '\x1b[0m\n'
  : '\n\x1b[1;32m✔ ' + pasos + ' comprobaciones OK\x1b[0m\n');
process.exit(fallos ? 1 : 0);
