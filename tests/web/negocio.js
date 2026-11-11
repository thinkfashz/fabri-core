#!/usr/bin/env node
/* Pruebas del panel multi-tienda (negocio.js) y de su contrato con la API.
 *
 * No abre navegador ni toca la red:
 *   · carga `web/app/negocio.js` con un DOM mínimo y prueba los parsers de
 *     importación (CSV con coma/punto y coma, comillas, JSON y sinónimos);
 *   · comprueba que `index.html` tenga todos los ids que el panel usa;
 *   · comprueba que `mercado.ts` conserve las piezas del flujo (local_mio,
 *     dueño por cuenta, columnas de marca/logo y autorización).
 *
 * Uso: node tests/web/negocio.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');

/* ── entorno mínimo para cargar el módulo ────────────────────────────────── */
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
  Fabri: { q: () => [], toast: () => {}, go: () => {} }
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

const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

/* ── 1. módulo cargado ───────────────────────────────────────────────────── */
console.log('\nPanel del negocio · módulo');
ok('expone render()', typeof N.render === 'function');
ok('expone refrescar()', typeof N.refrescar === 'function');
ok('expone parsers para pruebas', N._test && typeof N._test.parseProductos === 'function');

/* ── 2. CSV ──────────────────────────────────────────────────────────────── */
console.log('\nImportación · CSV');
const csvComa = 'nombre,precio,sku,stock,categoria\nArroz 1 kg,1690,A-1,12,Despensa\nAceite 900 ml,2450,A-2,,Aceites\n';
igual('coma: dos productos', N._test.parseProductos(csvComa).length, 2);
const p1 = N._test.parseProductos(csvComa)[0];
igual('coma: nombre', p1.nombre, 'Arroz 1 kg');
igual('coma: precio numérico', p1.precio, 1690);
igual('coma: sku', p1.sku, 'A-1');
igual('coma: stock', p1.stock, 12);
igual('coma: categoría', p1.categoria, 'Despensa');
igual('stock vacío queda null', N._test.parseProductos(csvComa)[1].stock, null);

const csvPuntoYComa = 'Nombre;Precio;SKU;Stock\n"Pan de molde; grande";2190;PAN-1;5\n';
const p2 = N._test.parseProductos(csvPuntoYComa)[0];
igual('punto y coma: detecta separador', p2.nombre, 'Pan de molde; grande');
igual('punto y coma: precio', p2.precio, 2190);

const csvComillas = 'nombre,precio\n"Harina ""selecta"" 1 kg",1190\n';
igual('comillas escapadas', N._test.parseProductos(csvComillas)[0].nombre, 'Harina "selecta" 1 kg');

const csvSinonimos = 'Producto;Valor;Codigo;Existencias;Rubro;Medida\nLeche 1 L;1290;L-1;8;Lácteos;1 L\n';
const p3 = N._test.parseProductos(csvSinonimos)[0];
igual('sinónimos: producto → nombre', p3.nombre, 'Leche 1 L');
igual('sinónimos: valor → precio', p3.precio, 1290);
igual('sinónimos: codigo → sku', p3.sku, 'L-1');
igual('sinónimos: existencias → stock', p3.stock, 8);
igual('sinónimos: rubro → categoría', p3.categoria, 'Lácteos');
igual('sinónimos: medida → unidad', p3.unidad, '1 L');

const csvMalo = 'nombre,precio\nSin precio,\n,1234\nBien,999\n';
igual('descarta filas sin nombre o precio', N._test.parseProductos(csvMalo).length, 1);

const csvLargo = 'Nombre del producto;Precio CLP;Stock disponible;Categoría\nYerba 500 g;3990;4;Infusiones\n';
const p4 = N._test.parseProductos(csvLargo)[0];
igual('encabezados con sufijo: nombre', p4.nombre, 'Yerba 500 g');
igual('encabezados con sufijo: precio', p4.precio, 3990);
igual('encabezados con sufijo: stock', p4.stock, 4);

/* ── 3. JSON ─────────────────────────────────────────────────────────────── */
console.log('\nImportación · JSON');
const jsonArr = JSON.stringify([
  { sku: 'J-1', nombre: 'Café 170 g', precio: 3790, stock: 3, categoria: 'Despensa' },
  { name: 'Té 20 u', price: 1690 }
]);
igual('array JSON: dos productos', N._test.parseProductos(jsonArr).length, 2);
igual('array JSON: nombre en inglés', N._test.parseProductos(jsonArr)[1].nombre, 'Té 20 u');
igual('array JSON: precio en inglés', N._test.parseProductos(jsonArr)[1].precio, 1690);

const jsonEnv = JSON.stringify({ productos: [{ nombre: 'Azúcar 1 kg', precio: '1490' }] });
igual('objeto {productos}', N._test.parseProductos(jsonEnv)[0].precio, 1490);

let lanzo = false;
try { N._test.parseProductos('{roto'); } catch (e) { lanzo = /JSON/.test(e.message); }
ok('JSON inválido avisa con claridad', lanzo);

/* ── 4. saneamiento ──────────────────────────────────────────────────────── */
console.log('\nImportación · saneamiento');
igual('precio con puntos y $', N._test.aProducto({ nombre: 'X', precio: '$1.690' }).precio, 1690);
igual('precio con coma decimal', N._test.aProducto({ nombre: 'X', precio: '1690,5' }).precio, 1691);
igual('stock negativo se acota a 0', N._test.aProducto({ nombre: 'X', precio: 10, stock: -5 }).stock, 0);
ok('sin nombre devuelve null', N._test.aProducto({ precio: 100 }) === null);
ok('sin precio devuelve null', N._test.aProducto({ nombre: 'X', precio: 0 }) === null);
igual('normClave quita acentos y signos', N._test.normClave('Categoría / Tipo'), 'categoria_tipo');

/* ── 5. contrato del HTML ────────────────────────────────────────────────── */
console.log('\nContrato · index.html');
const html = leer('web/app/index.html');
const ids = [
  'negCuenta', 'negCuentaChip', 'negCuentaMail', 'negCuentaIr', 'negCuentaEstado',
  'negTiendas', 'negFormTienda', 'ntNombre', 'ntMarca', 'ntRubro', 'ntDireccion',
  'ntComuna', 'ntLat', 'ntLon', 'ntGps', 'ntLogoFile', 'ntLogoPrev', 'ntDesc',
  'ntTel', 'ntAviso', 'ntCancelar', 'negPanel', 'negTiendaCab', 'negKpis',
  'negPedidos', 'negPedCount', 'negProductos', 'negProdCount', 'negFormProd',
  'negProdNombre', 'negProdPrecio', 'negProdStock', 'negProdSku', 'negProdCategoria',
  'negCategorias', 'negImportFile', 'negImportStock', 'negImportAviso',
  'neNombre', 'neMarca', 'neRubro', 'neTelefono', 'neDireccion', 'neComuna',
  'neHorario', 'neMinimo', 'neEnvio', 'neLogoFile', 'neLogoPrev', 'neDesc',
  'neRetiro', 'neDelivery', 'neGuardar', 'neBorrar', 'neAviso',
  'negAbiertoBtn', 'negNubeEstado',
  'negNubeLocal', 'negNubeClave', 'negNubeBtn', 'negNubeClaveEstado'
];
const faltan = ids.filter((id) => !new RegExp('id="' + id + '"').test(html));
ok('todos los ids que usa negocio.js existen', faltan.length === 0, 'faltan: ' + faltan.join(', '));
ok('la sección conserva id s-negocio', /id="s-negocio"/.test(html));
ok('el respaldo por clave sigue presente', /negNubeBtn/.test(html) && /Conectar con ID y clave/.test(html));

/* ── 6. contrato del backend ─────────────────────────────────────────────── */
console.log('\nContrato · api/mercado.ts');
const api = leer('api-telefono/api/mercado.ts');
ok('acción local_mio', /accion === 'local_mio'/.test(api));
ok('columna dueno_id', /dueno_id/.test(api));
ok('migración idempotente de marca', /ADD COLUMN IF NOT EXISTS marca/.test(api));
ok('migración idempotente de logo', /ADD COLUMN IF NOT EXISTS logo/.test(api));
ok('migración idempotente de descripción', /ADD COLUMN IF NOT EXISTS descripcion/.test(api));
ok('autoriza por cuenta (cuentaDe)', /function cuentaDe/.test(api));
ok('sesiones de /api/auth', /core_sesiones/.test(api));
ok('la cuenta dueña entra en autorizarLocal', /local\.dueno_id/.test(api));
ok('aTienda devuelve marca', /marca: l\.marca \|\| ''/.test(api));
ok('aTienda devuelve logo', /logo: l\.logo \|\| ''/.test(api));
ok('local_crear acepta cuenta', /cuentaDe\(pool, req\)/.test(api));
ok('borrar tienda ya no es sólo admin', /accion === 'local_borrar'[\s\S]{0,220}autorizarLocal/.test(api));

/* ── 7. contrato del mapa ────────────────────────────────────────────────── */
console.log('\nContrato · placer.js');
const placer = leer('web/app/placer.js');
ok('el mapa lee la marca', /marca: t\.marca \|\| ""/.test(placer));
ok('el mapa lee el logo', /logo: t\.logo \|\| ""/.test(placer));
ok('el pin usa el logo propio', /mp-pin-logo/.test(placer));
ok('lista y ficha eligen logo O icono (no se apilan)', /function iconoDe/.test(placer) && !/icono\(m\.ico, 20\) \+ logoDe/.test(placer));
ok('las tiendas registradas no se agrupan (su logo siempre se ve)', /if \(m\.forge\) \{ sueltos\.push/.test(placer));
ok('la ficha muestra la marca', /\[m\.marca, m\.rubro/.test(placer));
ok('expone irATienda()', /irATienda,/.test(placer) && /function irATienda/.test(placer));

/* ── cierre ──────────────────────────────────────────────────────────────── */
console.log('\n' + (fallos ? '\x1b[1;31m' : '\x1b[1;32m') +
  (fallos ? '✖ ' + fallos + ' fallo(s)' : '✔ ' + pasos + ' comprobaciones OK') +
  '\x1b[0m\n');
process.exit(fallos ? 1 : 0);
