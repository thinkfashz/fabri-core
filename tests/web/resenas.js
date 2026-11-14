#!/usr/bin/env node
/* Pruebas de reseñas y calificación (Fase 5).
 *
 * Sin navegador ni red:
 *   · contrato de la API: tabla, acciones, una reseña por pedido, sólo
 *     entregado, autor abreviado, nunca teléfono ni nombre completo;
 *   · puras de la ficha pública (estrellas, promedio, reparto, antigüedad);
 *   · puras del panel (estrellas, estado de la lista);
 *   · contrato del HTML (pestaña Reseñas) y del formulario en seguir.html.
 *
 * Uso: node tests/web/resenas.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

let fallos = 0;
let pasos = 0;
const ok = (nombre, condicion, detalle) => {
  pasos++;
  if (condicion) console.log('  \x1b[1;32m✔\x1b[0m ' + nombre);
  else {
    fallos++;
    console.log('  \x1b[1;31m✖\x1b[0m ' + nombre + (detalle ? ' → ' + detalle : ''));
  }
};
const igual = (nombre, a, b) => ok(nombre, JSON.stringify(a) === JSON.stringify(b),
  'esperaba ' + JSON.stringify(b) + ', llegó ' + JSON.stringify(a));

/* ── entorno mínimo para cargar los módulos del navegador ────────────────── */
const almacen = new Map();
global.localStorage = {
  getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => { almacen.set(k, String(v)); },
  removeItem: (k) => { almacen.delete(k); }
};
global.document = {
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  addEventListener: () => {}, createElement: () => ({ getContext: () => null }),
  readyState: 'loading'
};
global.window = {
  CoreNube: { leer: () => null },
  Fabri: { q: () => [], toast: () => {}, go: () => {} },
  location: { origin: 'https://forge-core-stock.vercel.app' },
  addEventListener: () => {},
  matchMedia: () => ({ matches: false }),
  setTimeout: (fn) => { /* sin temporizadores en la prueba */ }
};

require(path.join(RAIZ, 'web', 'app', 'negocio.js'));
require(path.join(RAIZ, 'web', 'tienda-seguir.js'));
const N = global.window.Negocio;
const S = global.window.Seguir;

/* ── 1. API ──────────────────────────────────────────────────────────────── */
console.log('\nContrato · /api/mercado');
const api = leer('api-telefono/api/mercado.ts');
ok('existe la tabla de reseñas', /const T_RESENAS = 'mercado_resenas'/.test(api));
ok('la tabla se crea con sus columnas', /CREATE TABLE IF NOT EXISTS \$\{T_RESENAS\}[\s\S]*?estrellas SMALLINT/.test(api));
ok('una reseña por pedido', /CREATE UNIQUE INDEX IF NOT EXISTS idx_mercado_resenas_pedido[\s\S]*?\(pedido_id\)/.test(api));
ok('índice por local y fecha', /idx_mercado_resenas_local[\s\S]*?\(local_id, creado DESC\)/.test(api));

ok('existe resenas_listar', /accion === 'resenas_listar'/.test(api));
ok('existe resena_crear', /accion === 'resena_crear'/.test(api));
ok('existe resenas_panel', /accion === 'resenas_panel'/.test(api));
ok('existe resena_moderar', /accion === 'resena_moderar'/.test(api));
ok('las cinco acciones están en la lista del GET',
  /'resenas_listar', 'resena_crear', 'resenas_panel', 'resena_moderar'/.test(api));
ok('la tabla aparece en asegurar', /T_PEDIDOS, T_EVENTOS, T_RESENAS/.test(api));

ok('calificar exige el pedido entregado', /pedido\.estado !== 'entregado'/.test(api));
ok('rechaza dos reseñas del mismo pedido', /codigo: 'YA_OPINO'/.test(api));
ok('valida las estrellas', /estrellas >= 1 && estrellas <= 5/.test(api));
ok('acepta el enlace o el código + teléfono',
  /if \(!token && !\(codigo && contacto\)\)/.test(api) &&
  /WHERE seguimiento = \$1/.test(api) &&
  /right\(regexp_replace\(telefono, '\[\^0-9\]', '', 'g'\), 4\) = \$2/.test(api));
ok('frena la creación en serie', /permitirResena\(ipDe\(req\)\)/.test(api) && /RESENAS_HORA = 20/.test(api));
ok('guardar la reseña usa el autor abreviado', /autorPublico\(pedido\.cliente\)/.test(api));
ok('el autor abreviado corta el apellido', /partes\[partes\.length - 1\]\.charAt\(0\)[\s\S]*?'\.'/.test(api));
ok('la respuesta pública no expone el pedido', !/pedido_id: x\.pedido_id/.test(api));
ok('moderar exige dueño o clave', /accion === 'resena_moderar'[\s\S]{0,300}autorizarLocal/.test(api));
ok('moderar es reversible (UPDATE en resena_moderar)',
  /if \(accion === 'resena_moderar'\)[\s\S]{0,400}UPDATE \$\{T_RESENAS\} SET oculta/.test(api));
ok('sólo se borran al borrar la tienda', (api.match(/DELETE FROM \$\{T_RESENAS\}/g) || []).length === 1);
ok('el listado público filtra las ocultas', /WHERE local_id = \$1 AND oculta = false/.test(api));
ok('el listado público ordena por fecha', /ORDER BY creado DESC LIMIT \$2/.test(api));
ok('el promedio viene redondeado a un decimal', /Math\.round\(\(Number\(c\.promedio\) \|\| 0\) \* 10\) \/ 10/.test(api));
ok('el listado de locales trae la calificación', /l\.calificacion = calDe\[l\.id\]/.test(api));
ok('la tienda pública incluye calificacion', /calificacion: \{[\s\S]*?n: Number\(l\.calificacion && l\.calificacion\.n\) \|\| 0/.test(api));
ok('borrar la tienda borra sus reseñas', /DELETE FROM \$\{T_RESENAS\} WHERE local_id = \$1/.test(api));
ok('el resumen trae la calificación (sin llamada extra)', /resenas = \{ n: 0, promedio: 0 \}/.test(api) &&
  /FROM \$\{T_RESENAS\} WHERE local_id = \$1 AND oculta = false/.test(api));
ok('si la tabla no existe el resumen no rompe', /catch \(e\) \{ \/\* tabla nueva/.test(api));

/* ── 2. puras de la ficha pública ────────────────────────────────────────── */
console.log('\nFicha pública · estrellas y antigüedad');
const placer = leer('web/app/placer.js');
ok('la ficha pública pinta estrellas', /function estrellas\(promedio, tam\)/.test(placer));
ok('la lista muestra el chip de calificación', /function resumenCalificacion/.test(placer) && /mp-cal-chip/.test(placer));
ok('la ficha pide las reseñas al abrir', /if \(m\.forge\) cargarResenas\(m\)/.test(placer));
ok('la ficha usa resenas_listar', /accion: "resenas_listar"/.test(placer));
ok('la ficha pinta el reparto 5→1', /\[5, 4, 3, 2, 1\]\.map/.test(placer));
ok('sin reseñas muestra un vacío, no un cero', /Todavía nadie calificó este local/.test(placer));
ok('el promedio se escribe con coma', /replace\("\."\s*,\s*","\)/.test(placer));
ok('la ficha no muestra el teléfono del comprador', !/r\.telefono/.test(placer));

/* ── 2b. puras de la ficha pública (con los módulos reales) ──────────────── */
console.log('\nFicha pública · puras');
require(path.join(RAIZ, 'web', 'app', 'placer.js'));
const P = global.window.Placer;

const FAKE = {
  calificacion: {
    n: 7, promedio: 4.6,
    reparto: { 5: 5, 4: 1, 3: 1, 2: 0, 1: 0 }
  },
  resenas: [
    { autor: 'Ana P.', estrellas: 5, texto: 'Llegó rápido y todo fresco.', creado: new Date(Date.now() - 86400e3 * 2).toISOString() },
    { autor: 'Luis S.', estrellas: 4, texto: '', creado: new Date(Date.now() - 86400e3 * 40).toISOString() }
  ]
};
const bloque = P._test.bloqueResenas(FAKE);
ok('pinta el promedio con coma', bloque.indexOf('4,6') > 0);
ok('dice cuántos compradores', /7 compradores/.test(bloque));
ok('pinta las dos reseñas', /Ana P\./.test(bloque) && /Luis S\./.test(bloque));
ok('una reseña sin texto no rompe', /Luis S\./.test(bloque));
ok('el reparto suma las filas 5→1', (bloque.match(/mp-reparto-fila/g) || []).length === 5);
ok('la barra del 5 llena el 71 %', /width:71%/.test(bloque), (bloque.match(/width:\d+%/g) || []).join(','));
ok('escapa el texto del comprador', P._test.bloqueResenas({
  calificacion: { n: 1, promedio: 5, reparto: { 5: 1 } },
  resenas: [{ autor: '<b>X</b>', estrellas: 5, texto: '<script>alert(1)</script>', creado: new Date().toISOString() }]
}).indexOf('<script>') < 0);
ok('sin reseñas explica cómo calificar', /Todavía nadie calificó/.test(P._test.bloqueResenas({ calificacion: { n: 0, promedio: 0 } })));
igual('antigüedad: hoy', P._test.haceDias(Date.now()), 'hoy');
igual('antigüedad: ayer', P._test.haceDias(Date.now() - 86400e3), 'ayer');
igual('antigüedad: días', P._test.haceDias(Date.now() - 3 * 86400e3), 'hace 3 días');
igual('antigüedad: meses', P._test.haceDias(Date.now() - 70 * 86400e3), 'hace 2 meses');
ok('una fecha basura no rompe', P._test.haceDias('x') === '');

/* ── 3. formulario en la página de seguimiento ───────────────────────────── */
console.log('\nSeguir.html · calificar el pedido entregado');
const seg = leer('web/tienda-seguir.js');
ok('sólo aparece con el pedido entregado', /pedido\.estado !== "entregado"\) return ""/.test(seg));
ok('sólo con credencial (token o código)', /if \(!claveCred\(cred\)\) return ""/.test(seg));
ok('arma cinco estrellas', /function estrellas\(n, tam\)/.test(seg));
ok('no repite el formulario si ya calificó', /function yaResenado/.test(seg));
ok('manda el token cuando lo tiene', /if \(cred && cred\.token\) cuerpo\.token = cred\.token/.test(seg));
ok('si no, manda código y teléfono', /cuerpo\.codigo = cred\.codigo; cuerpo\.contacto = cred\.contacto/.test(seg));
ok('la reseña viaja como resena_crear', /accion: "resena_crear"/.test(seg));
ok('muestra el error del servidor', /No pudimos publicar la reseña/.test(seg));
ok('el texto se limita a 500', /maxlength="500"/.test(seg));
ok('guarda que ya calificó en este equipo', /marcarResenado\(cred\)/.test(seg));

/* ── 4. panel del dueño ──────────────────────────────────────────────────── */
console.log('\nPanel · pestaña Reseñas y moderación');
const html = leer('web/app/index.html');
ok('existe la pestaña Reseñas', /data-tab="resenas"/.test(html));
ok('existe el panel de reseñas', /id="negTabResenas"/.test(html));
ok('el panel tiene resumen y lista', /id="negResResumen"/.test(html) && /id="negResLista"/.test(html));
ok('la pestaña muestra el conteo', /id="negResCount"/.test(html));
ok('la pestaña está en las pestañas del panel', /const TABS = \["resumen", "pedidos", "catalogo", "resenas", "ajustes"\]/.test(N && leer('web/app/negocio.js')));
ok('al abrir la pestaña se releen', /EST\.tab === "resenas" && EST\.sel\) cargarResenas\(\)/.test(leer('web/app/negocio.js')));
ok('usa resenas_panel', /accion: "resenas_panel"/.test(leer('web/app/negocio.js')));
ok('ocultar usa resena_moderar', /accion: "resena_moderar"/.test(leer('web/app/negocio.js')));
ok('la lista marca las ocultas', /\.oculta/.test(leer('web/app/styles.css')));
ok('el CSV no cambia (no se toca lo anterior)', /csvPedidos/.test(leer('web/app/negocio.js')));

/* ── 5. puras del módulo (sin DOM) ───────────────────────────────────────── */
console.log('\nPuras · estrellas y credencial');
const E = S._test.estrellas;
ok('cinco estrellas siempre', (E(0, 12).match(/<path d=/g) || []).length === 5);
ok('llenas el promedio redondeado', (E(4.6, 12).match(/fill="currentColor"/g) || []).length === 5);
ok('un promedio bajo deja estrellas vacías', (E(2, 12).match(/fill="currentColor"/g) || []).length === 2);
ok('no se sale de 5', (E(9, 12).match(/fill="currentColor"/g) || []).length === 5);
ok('no se sale de 0', (E(-3, 12).match(/fill="currentColor"/g) || []).length === 0);

const K = S._test.claveCred;
igual('con token usa el token', K({ token: 'abc', codigo: '' }), 'abc');
igual('sin token usa el código', K({ token: '', codigo: 'MP-ABCDE' }), 'c:MP-ABCDE');
igual('sin credencial no hay clave', K({}), '');

/* El bloque de reseña respeta el estado y la credencial */
const B = S._test.bloqueResena;
const cred = { token: 'tok1', codigo: '', contacto: '' };
ok('pedido entregado muestra el formulario', B({ estado: 'entregado' }, cred).indexOf('sgResena') > 0);
ok('pedido listo no lo muestra', B({ estado: 'listo' }, cred) === '');
ok('sin credencial no lo muestra', B({ estado: 'entregado' }, {}) === '');
/* Con el pedido ya calificado en este equipo, no se repite el formulario. */
almacen.set('fcs.seguir.resenado', JSON.stringify(['tok1']));
const hecho = B({ estado: 'entregado' }, cred);
ok('ya calificado muestra agradecimiento', hecho.indexOf('Gracias por calificar') > 0, hecho.slice(0, 80));
ok('ya calificado no vuelve a pedir estrellas', hecho.indexOf('sgResenaEnviar') < 0);
almacen.delete('fcs.seguir.resenado');

console.log(fallos
  ? '\n\x1b[1;31m✖ ' + fallos + ' fallo(s) de ' + pasos + '\x1b[0m\n'
  : '\n\x1b[1;32m✔ ' + pasos + ' comprobaciones OK\x1b[0m\n');
process.exit(fallos ? 1 : 0);