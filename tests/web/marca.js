#!/usr/bin/env node
/* Pruebas del link público de marca y de la cuenta del vendedor (Fase 11).
 *
 * Sin navegador ni red: se comprueba el contrato del código real.
 *   · el panel arma un link estable `?marca=<id>#tienda` y no arrastra
 *     `lat/lon/demo` de la visita;
 *   · el arranque lee ese link, pide la marca pública y abre SU visor;
 *   · la marca queda registrada en el carrito aunque no venga del mapa;
 *   · el pago conserva mínimo, envío, entrega y cierre del local;
 *   · la API sirve una sola tienda activa por id (`local_ver`);
 *   · el panel muestra nombre, correo, rol y marca con lo que sí está
 *     protegido y lo que es público.
 *
 * Uso: node tests/web/marca.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

/* ── entorno mínimo para cargar negocio.js ───────────────────────────────── */
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
  readyState: 'complete'
};
global.window = {
  CoreNube: { leer: () => null },
  Fabri: { q: () => [], toast: () => {}, go: () => {} },
  location: { origin: 'https://forge-core-stock.vercel.app', pathname: '/app/' }
};

require(path.join(RAIZ, 'web', 'app', 'negocio.js'));
const N = global.window.Negocio;

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

/* ── 1. el link de marca ─────────────────────────────────────────────────── */
console.log('\nLink de marca · armado');
const enlace = N._test && N._test.enlaceMarca;
ok('el panel expone enlaceMarca para pruebas', typeof enlace === 'function');
igual('link con id',
  enlace('almacen-dona-rosa'),
  'https://forge-core-stock.vercel.app/app/?marca=almacen-dona-rosa#tienda');
igual('link con objeto',
  enlace({ id: 'tienda-prueba', nombre: 'Prueba' }),
  'https://forge-core-stock.vercel.app/app/?marca=tienda-prueba#tienda');
igual('sin id no inventa link', enlace(''), '');
igual('sin local tampoco', enlace(null), '');
ok('el link no arrastra lat/lon/demo',
  enlace('x').indexOf('lat=') === -1 && enlace('x').indexOf('demo=') === -1);

/* ── 2. el arranque lee el link y abre el visor ──────────────────────────── */
console.log('\nLink de marca · arranque del visor');
const APP = leer('web/app/app.js');
ok('lee el parámetro marca', /URLSearchParams\(location\.search\)\.get\("marca"\)/.test(APP));
ok('pide la marca pública', /accion=local_ver&id=/.test(APP));
ok('usa cargarMarca()', /async function cargarMarca/.test(APP));
ok('registra el local en el carrito', /Placer\.registrarLocal\(marcaTienda\)/.test(APP));
ok('abre el visor con origen marca',
  /ponerTienda\(cat, marcaTienda, "marca"\)/.test(APP));
ok('el visor recibe precio efectivo', /Placer\.productosDe\(marcaTienda\)/.test(APP));

const T3D = leer('web/app/tienda3d.js');
ok('una marca sin catálogo no cae en el escaparate legacy',
  /const SIN_PRODUCTOS = \[\]/.test(T3D) && /\(tienda \? SIN_PRODUCTOS : null\)/.test(T3D));
ok('el destino es el visor', /const destino = marcaTienda \? "tienda"/.test(APP));
ok('sin cuenta no pide login', /const pedida = marcaTienda \? "tienda"/.test(APP));
ok('una marca inexistente va al mapa', /u\.hash = "panel"/.test(APP));
ok('el destino relee el hash limpio',
  /const h = String\(location\.hash \|\| ""\)\.replace\("#", ""\)/.test(APP));

/* ── 3. la marca viaja con el carrito ────────────────────────────────────── */
console.log('\nCarrito · metadatos del local');
const PL = leer('web/app/placer.js');
ok('registrarLocal() existe', /function registrarLocal\(m\)/.test(PL));
ok('registrarLocal() se exporta', /registrarLocal,/.test(PL));
ok('el carrito guarda si es negocio registrado', /c\.forge = !!m\.forge/.test(PL));
ok('el carrito guarda el mínimo', /c\.minimo =/.test(PL));
ok('el carrito guarda el envío', /c\.envio =/.test(PL));
ok('el carrito guarda la entrega', /c\.entrega = m\.entrega\.slice\(\)/.test(PL));
ok('el carrito guarda el cierre', /c\.abierto = m\.abierto !== false/.test(PL));
ok('el respaldo del carrito conserva el mínimo', /minimo: guardado\.minimo \|\| 0/.test(PL));
ok('agregar desde el visor registra el local', /function agregarDesdeVisor[\s\S]{0,200}registrarLocal\(m\)/.test(PL));
ok('productosDe(null) no revienta', /productosDe: \(m\) => \(m \? productos\(m\) : \[\]\)/.test(PL));

/* ── 4. la API pública de una marca ──────────────────────────────────────── */
console.log('\nAPI · local_ver');
const API = leer('api-telefono/api/mercado.ts');
ok('acción local_ver en GET y POST',
  /searchParams\.get\('accion'\) === 'local_ver'/.test(API) &&
  /accion === 'local_ver'/.test(API));
ok('traerLocal() dedicado', /async function traerLocal\(pool: any, localId: string\)/.test(API));
ok('sólo locales activos', /WHERE id = \$1 AND activo = true/.test(API));
ok('devuelve catálogo', /l\.catalogo = p\.rows\.map\(productoDeFila\)/.test(API));
ok('devuelve calificación', /l\.calificacion =/.test(API));
ok('marca no encontrada responde 404', /codigo: 'NO_ENCONTRADO'/.test(API));
ok('local_ver aparece en las acciones', /'local_ver'/.test(API));
ok('todo local de la base es forge', /forge: true/.test(API));

/* ── 5. el panel comparte y muestra la cuenta ────────────────────────────── */
console.log('\nPanel · compartir y cuenta');
const NEG = leer('web/app/negocio.js');
const HTML = leer('web/app/index.html');
ok('el panel arma el link', /function enlaceMarca/.test(NEG));
ok('el panel comparte con la hoja nativa', /navigator\.share/.test(NEG));
ok('el panel copia el link', /function copiarUrl/.test(NEG));
ok('el panel pinta el link', /function pintarMarca/.test(NEG));
ok('el panel pinta la seguridad', /function pintarSeguridad/.test(NEG));
ok('el panel abre el visor con precio efectivo', /Placer\.productosDe\(EST\.sel\)/.test(NEG));
ok('muestra nombre', /fila\("Nombre"/.test(NEG));
ok('muestra correo', /fila\("Correo"/.test(NEG));
ok('muestra rol', /fila\("Rol"/.test(NEG));
ok('muestra marca', /fila\("Marca"/.test(NEG));
ok('explica el hash de la contraseña', /PBKDF2-SHA256/.test(NEG));
ok('explica el token en la nube', /SHA-256 del token/.test(NEG));
ok('dice qué es público', /Público en tu link de marca/.test(NEG));
ok('la cuenta local también se muestra',
  /window\.Fabri && window\.Fabri\.user/.test(NEG));
ok('no promete cifrado de datos', !/datos cifrados|cifrado de datos/i.test(NEG));
ok('botón de compartir en la cabecera', /id="negCompartir"/.test(HTML));
ok('campo del link en Ajustes', /id="negLinkMarca"/.test(HTML));
ok('botón copiar', /id="negLinkCopiar"/.test(HTML));
ok('salida por WhatsApp', /id="negLinkWa"/.test(HTML));
ok('abrir el visor propio', /id="negLinkAbrir"/.test(HTML));
ok('tarjeta de seguridad', /id="negSeguridad"/.test(HTML));

/* ── 6. salidas del visor de marca ───────────────────────────────────────── */
console.log('\nVisor · salida al mapa global');
const MER = leer('web/app/mercado.js');
ok('atrás reconoce el origen marca', /origen === "marca"/.test(MER));
ok('quita ?marca de la URL', /function limpiarMarcaUrl|const limpiarMarcaUrl/.test(MER));
ok('vuelve al mapa', /origen === "marca" \? "panel"/.test(MER));
ok('abre la ficha del local en el mapa', /irATienda\(local\.id\)/.test(MER));

/* ── 7. caché ────────────────────────────────────────────────────────────── */
console.log('\nCaché · versión del service worker');
const SW = leer('web/app/sw.js');
ok('versión de la Fase 11 o posterior',
  Number((SW.match(/fcore-v(\d+)/) || [])[1] || 0) >= 86,
  (SW.match(/fcore-v(\d+)/) || [])[0]);

/* ── cierre ──────────────────────────────────────────────────────────────── */
console.log('\n' + (fallos ? '\x1b[1;31m' : '\x1b[1;32m') +
  (fallos ? '✖ ' + fallos + ' fallo(s)' : '✔ ' + pasos + ' comprobaciones OK') +
  '\x1b[0m\n');
process.exit(fallos ? 1 : 0);
