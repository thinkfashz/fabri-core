#!/usr/bin/env node
/* Pruebas del seguimiento de pedido (seguir.html + tienda-seguir.js).
 *
 * No abre navegador ni toca la red:
 *   · carga `web/tienda-seguir.js` con un DOM mínimo y prueba las funciones
 *     puras (código, teléfono, estados, línea de tiempo, fechas);
 *   · comprueba que `seguir.html` tenga los ids que el módulo usa;
 *   · comprueba el contrato de la API (`pedido_seguir` público, token de
 *     seguimiento al crear, historial de estados, sin teléfono completo);
 *   · comprueba que el checkout guarde el enlace y que el panel del dueño
 *     pueda copiarlo.
 *
 * Uso: node tests/web/seguimiento.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');

/* ── entorno mínimo ──────────────────────────────────────────────────────── */
const almacen = new Map();
global.localStorage = {
  getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => { almacen.set(k, String(v)); },
  removeItem: (k) => { almacen.delete(k); }
};
global.document = {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  createElement: () => ({ getContext: () => null }),
  readyState: 'loading'
};
global.window = { FCS: undefined };

require(path.join(RAIZ, 'web', 'tienda-seguir.js'));
const S = global.window.Seguir;

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

/* ── 1. módulo ───────────────────────────────────────────────────────────── */
console.log('\nMódulo');
ok('Seguir expone render', S && typeof S.render === 'function');
ok('las puras están disponibles', S && S._test &&
  typeof S._test.normalizarCodigo === 'function' &&
  typeof S._test.pasos === 'function' &&
  typeof S._test.fechaCorta === 'function');

/* ── 2. código del pedido ────────────────────────────────────────────────── */
console.log('\nCódigo · se acepta como lo escribe la gente');
const N = S._test.normalizarCodigo;
igual('ya formateado', N('MP-ABCDE'), 'MP-ABCDE');
igual('en minúsculas', N('mp-abcde'), 'MP-ABCDE');
igual('sin guion', N('MPABCDE'), 'MP-ABCDE');
igual('con espacios', N(' MP ABCDE '), 'MP-ABCDE');
igual('sólo las 5 letras', N('ABCDE'), 'MP-ABCDE');
igual('con puntos', N('m.p.a.b.c.d.e'), 'MP-ABCDE');
igual('vacío no inventa', N(''), '');
igual('sólo el prefijo no inventa', N('MP-'), '');
igual('basura se recorta a 5', N('ABCDEFGH'), 'MP-ABCDE');
ok('tolera nulos', N(null) === '');

/* ── 3. teléfono ─────────────────────────────────────────────────────────── */
console.log('\nTeléfono · últimos 4');
const T = S._test.telefono4;
igual('número chileno con +56', T('+56 9 1234 5678'), '5678');
igual('con guiones', T('9-1234-5678'), '5678');
igual('sólo dígitos', T('912345678'), '5678');
igual('menos de 4 no sirve', T('123'), '');
igual('vacío', T(''), '');
ok('tolera nulos', T(null) === '');

/* ── 4. estados ──────────────────────────────────────────────────────────── */
console.log('\nEstados · lo que lee el comprador');
igual('recibido', S._test.estadoInfo('nuevo').chip, 'Recibido');
igual('preparando', S._test.estadoInfo('visto').chip, 'Preparando');
igual('listo para retirar', S._test.estadoInfo('listo', 'retiro').chip, 'Listo');
igual('listo con delivery es «en camino»', S._test.estadoInfo('listo', 'delivery').chip, 'En camino');
igual('entregado', S._test.estadoInfo('entregado').chip, 'Entregado');
igual('cancelado', S._test.estadoInfo('cancelado').chip, 'Cancelado');
igual('un estado raro no rompe', S._test.estadoInfo('zzz').chip, 'Recibido');

/* ── 5. línea de tiempo ──────────────────────────────────────────────────── */
console.log('\nLínea de tiempo');
const PAS = S._test.pasos;
const ahora = Date.UTC(2026, 10, 11, 15);
const ev = [
  { estado: 'nuevo', ts: ahora - 3600e3 },
  { estado: 'visto', ts: ahora - 1800e3 }
];
const p1 = PAS('visto', ev, ahora - 3600e3);
igual('cuatro pasos en total', p1.length, 4);
igual('el actual es «en preparación»', p1[1].actual, true);
igual('los dos primeros están hechos', p1.slice(0, 2).every((x) => x.hecho), true);
igual('los dos últimos no', p1.slice(2).every((x) => !x.hecho), true);
igual('el paso actual conserva su hora', p1[1].ts, ahora - 1800e3);
ok('el paso futuro no tiene hora', p1[2].ts === 0);

const p2 = PAS('entregado', [], ahora - 86400e3);
igual('sin historial, todos hechos hasta el final', p2.every((x) => x.hecho), true);
igual('sin historial, el primero usa la fecha de creación', p2[0].ts, ahora - 86400e3);

const p3 = PAS('cancelado', [
  { estado: 'nuevo', ts: ahora - 3600e3 },
  { estado: 'cancelado', ts: ahora - 600e3 }
], ahora - 3600e3);
igual('cancelado agrega un paso', p3.length, 5);
igual('el último es el cancelado', p3[4].clave, 'cancelado');
igual('el cancelado está actual', p3[4].actual, true);
ok('ningún paso normal queda actual', p3.slice(0, 4).every((x) => !x.actual));

/* ── 6. fechas ───────────────────────────────────────────────────────────── */
console.log('\nFechas en hora de Chile');
const F = S._test.fechaCorta;
igual('sin fecha no pinta nada', F(0, ahora), '');
ok('hoy', /^hoy \d{2}:\d{2}$/.test(F(ahora - 2 * 3600e3, ahora)), F(ahora - 2 * 3600e3, ahora));
ok('ayer', /^ayer \d{2}:\d{2}$/.test(F(ahora - 30 * 3600e3, ahora)), F(ahora - 30 * 3600e3, ahora));
ok('más atrás lleva el día', /^\d{1,2} \w+ \d{2}:\d{2}$/.test(F(ahora - 6 * 86400e3, ahora)),
  F(ahora - 6 * 86400e3, ahora));
/* La API devuelve `ts` como texto ISO (JSON no tiene fechas): si no se
   aceptara, la línea de tiempo saldría sin horas. */
ok('acepta la fecha ISO que manda la API',
  /^hoy \d{2}:\d{2}$/.test(F(new Date(ahora - 3600e3).toISOString(), ahora)),
  F(new Date(ahora - 3600e3).toISOString(), ahora));
ok('acepta un objeto Date', /^hoy /.test(F(new Date(ahora - 600e3), ahora)));
igual('una fecha basura no rompe', F('no-es-fecha', ahora), '');
igual('pesos chilenos', S._test.clp(12990), '$12.990');

/* ── 7. contrato del HTML ────────────────────────────────────────────────── */
console.log('\nContrato · seguir.html');
const html = leer('web/seguir.html');
const ids = ['sgForm', 'sgCodigo', 'sgTel', 'sgBuscar', 'sgError', 'sgResultado', 'sgPie', 'sgSub'];
const faltan = ids.filter((id) => !new RegExp('id="' + id + '"').test(html));
ok('todos los ids que usa el módulo existen', faltan.length === 0, 'faltan: ' + faltan.join(', '));
ok('la página carga el núcleo y su módulo', /tienda-nucleo\.js[\s\S]*tienda-seguir\.js/.test(html));
ok('usa el sistema de diseño de la tienda', /components\.css[\s\S]*tienda\.css/.test(html));
ok('no se indexa (es un pedido, no una página pública)', /name="robots"[^>]*noindex/.test(html));
ok('el código se pide en mayúsculas', /id="sgCodigo"[^>]*autocapitalize="characters"/.test(html));
ok('el teléfono se pide numérico', /id="sgTel"[^>]*inputmode="numeric"/.test(html));

/* ── 8. contrato de la API ───────────────────────────────────────────────── */
console.log('\nContrato · /api/mercado');
const api = leer('api-telefono/api/mercado.ts');
ok('existe la acción pública pedido_seguir', /accion === 'pedido_seguir'/.test(api));
ok('pedido_crear devuelve el token de seguimiento', /const seguimiento = randomBytes\(10\)/.test(api) &&
  /codigo, seguimiento, subtotal/.test(api));
ok('guarda el historial al crear', /INSERT INTO \$\{T_EVENTOS\} \(pedido_id, estado\) VALUES \(\$1, 'nuevo'\)/.test(api));
ok('guarda el historial al cambiar de estado', /INSERT INTO \$\{T_EVENTOS\} \(pedido_id, estado\) VALUES \(\$1, \$2\)/.test(api));
ok('sólo anota cambios reales', /estado <> \$1/.test(api));
ok('el seguimiento se limita por IP', /seguirBloqueado\(ip\)/.test(api) && /429/.test(api));
/* Los aciertos no gastan el límite: si no, un comprador que mira su pedido 30
   veces en 10 minutos queda bloqueado. */
ok('sólo los fallos gastan el límite', /function anotarFallo/.test(api) &&
  /if \(!fila\) \{\s*anotarFallo\(ip\);/.test(api));
ok('abre por token largo', /p\.seguimiento = \$1/.test(api));
ok('abre por código + últimos 4', /right\(regexp_replace\(p\.telefono, '\[\^0-9\]', '', 'g'\), 4\) = \$2/.test(api));
ok('el código se compara con o sin prefijo MP', /s\.startsWith\('MP'\)/.test(api) && /'MP' \+ s\.slice\(0, 5\)/.test(api));
ok('no devuelve el teléfono del comprador', !/telefono: fila\.telefono/.test(api));
ok('no devuelve el token en la respuesta', !/seguimiento: fila\.seguimiento/.test(api));
ok('el listado del dueño sí trae el enlace', /SELECT id,codigo,seguimiento,cliente/.test(api));

/* ── 9. checkout y panel del dueño ───────────────────────────────────────── */
console.log('\nCheckout y panel del dueño');
const placer = leer('web/app/placer.js');
ok('el pago guarda el token de seguimiento', /ESTADO\.pago\.seguimiento = d\.seguimiento/.test(placer));
ok('la pantalla de éxito tiene el bloque', /id="mpSeguir"/.test(placer));
ok('el enlace apunta a seguir.html', /seguir\.html\?t=/.test(placer));
const negocio = leer('web/app/negocio.js');
ok('el panel arma el enlace del pedido', /function enlaceSeguimiento/.test(negocio) && /\/seguir\.html\?t=/.test(negocio));
ok('el botón de enlace existe en la lista', /data-enlace=/.test(negocio));
ok('aLocal conserva el seguimiento', /seguimiento: p\.seguimiento \|\| ""/.test(negocio));

/* ── cierre ─────────────────────────────────────────────────────────────── */
console.log(fallos
  ? '\n\x1b[1;31m✖ ' + fallos + ' fallo(s) de ' + pasos + '\x1b[0m\n'
  : '\n\x1b[1;32m✔ ' + pasos + ' comprobaciones OK\x1b[0m\n');
process.exit(fallos ? 1 : 0);
