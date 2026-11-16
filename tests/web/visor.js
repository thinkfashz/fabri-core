#!/usr/bin/env node
/* Pruebas del visor 3D con local (Fase 10).
 *
 * Sin navegador ni red: se comprueba el contrato del código real.
 *   · el visor guarda el local y de dónde se abrió (mapa o panel del dueño);
 *   · el rótulo del muro es la marca y el nombre del local, no FORGE;
 *   · con local abierto, el estante compra en el carrito de MercadoPlacer
 *     (mismo carrito que cobra `pedido_crear`), no en el del escaparate;
 *   · el producto tocado se resuelve por sku → id → nombre y se cobra el
 *     precio y el stock del servidor, no lo que pinte la escena;
 *   · el contador del visor es el del carrito de ese local;
 *   · el dueño abre su visor desde el panel y «atrás» vuelve al panel;
 *   · sin local, todo sigue funcionando como el escaparate de la casa.
 *
 * Uso: node tests/web/visor.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..', '..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

/* ── entorno mínimo para cargar placer.js ────────────────────────────────── */
const almacen = new Map();
/* Carrito viejo (sólo cantidad) de una visita anterior: `resumenDeLocal`
   tiene que contarlo en unidades sin inventarle precio. */
almacen.set('fcore.placer.carrito', JSON.stringify({
  'local-viejo': { nombre: 'Local viejo', ico: 'tienda', rubro: '', items: { 'x#0': 2 } }
}));
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
const avisos = [];
global.window = {
  Fabri: { q: () => [], toast: (t) => avisos.push(String(t)), go: () => {} },
  addEventListener: () => {},
  location: { origin: 'https://forge-core-stock.vercel.app' }
};

require(path.join(RAIZ, 'web', 'app', 'placer.js'));
const P = global.window.Placer;

/* ── utilidades ──────────────────────────────────────────────────────────── */
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
const carritoGuardado = () => JSON.parse(almacen.get('fcore.placer.carrito') || '{}');

/* Local de prueba con el catálogo tal como lo sirve /api/mercado:
   precio de lista, precio efectivo y descuento vigente ya calculados. */
const LOCAL = {
  id: 'tienda-prueba',
  nombre: 'Almacén Doña Rosa',
  marca: 'ROSA',
  ico: 'almacen',
  rubro: 'Almacén',
  catalogo: [
    { sku: 'ARR-001', nombre: 'Arroz 1 kg', categoria: 'Insumos', unidad: 'kg', precio: 1200, stock: 5, descuento: 0, descuento_vigente: 0, precio_efectivo: 1200 },
    { sku: 'ACE-002', nombre: 'Aceite 1 L', categoria: 'Insumos', unidad: 'L', precio: 2000, stock: 2, descuento: 25, descuento_vigente: 25, precio_efectivo: 1500 },
    { sku: '', nombre: 'Pan amasado', categoria: 'Panadería', unidad: 'un', precio: 500, stock: null, descuento: 0, descuento_vigente: 0, precio_efectivo: 500 }
  ]
};

/* ── 1. sintaxis de los cuatro archivos tocados ──────────────────────────── */
console.log('\nSintaxis · los archivos se compilan');
['web/app/tienda3d.js', 'web/app/placer.js', 'web/app/negocio.js', 'web/app/mercado.js'].forEach((rel) => {
  let bien = true, err = '';
  try { new vm.Script(leer(rel), { filename: rel }); } catch (e) { bien = false; err = e.message; }
  ok(rel + ' compila', bien, err);
});

/* ── 2. el visor guarda el local, el origen y la marca ───────────────────── */
console.log('\nVisor · identidad del local');
const T3 = leer('web/app/tienda3d.js');
ok('ponerTienda recibe catálogo, local y origen',
  /function ponerTienda\(catalogo, tienda, origen\)/.test(T3));
ok('guarda el local abierto', /tiendaLocal = nuevo;/.test(T3));
ok('recuerda de dónde se abrió', /origenVisor = origen \|\| "";/.test(T3));
ok('cambiar de local rehace la escena', /if \(cambiaLocal\) catUsada = null;/.test(T3));
ok('expone el local activo', /localActivo: \(\) => tiendaLocal/.test(T3));
ok('expone el origen', /origenDe: \(\) => origenVisor/.test(T3));
ok('el rótulo usa la marca del local', /t && \(t\.marca \|\| t\.nombre\)/.test(T3));
ok('sin local el rótulo sigue siendo FORGE', /"FORGE"/.test(T3) && /"CORE STOCK"/.test(T3));
ok('con local sin nombre de marca usa el nombre', /nombre && nombre !== principal \? nombre : "MERCADO EN LÍNEA"/.test(T3));
ok('el rótulo se achica para nombres largos', /measureText\(txt\)\.width <= ancho/.test(T3));
ok('sin local, el botón «atrás» no cree venir del mapa',
  /function fueDelMapa\(\) \{ return tiendaActiva; \}/.test(T3));

/* ── 3. con local, el estante compra en el carrito del marketplace ───────── */
console.log('\nVisor · carrito compartido');
ok('con local delega en MercadoPlacer',
  /window\.Placer\.agregarDesdeVisor\(p, tiendaLocal\)/.test(T3));
ok('sin local sigue usando el escaparate de la casa',
  /window\.Mercado\.agregar\(p\)/.test(T3));
ok('el contador del visor lee el carrito del local',
  /resumenDeLocal\(tiendaLocal\.id\)/.test(T3));
ok('el contador no mezcla el carrito viejo con local',
  /if \(tiendaLocal && window\.Placer && window\.Placer\.resumenDeLocal\)/.test(T3));
ok('el carrito de la casa conserva su clave',
  /const CLAVE_CARRITO = "fcore\.mercado\.carrito";/.test(T3));

/* ── 4. el carrito real: agregarDesdeVisor y resumenDeLocal ──────────────── */
console.log('\nCarrito · agregarDesdeVisor');
ok('el marketplace expone agregarDesdeVisor', typeof P.agregarDesdeVisor === 'function');
ok('el marketplace expone resumenDeLocal', typeof P.resumenDeLocal === 'function');
ok('el marketplace expone abrirCarrito', typeof P.abrirCarrito === 'function');
igual('sin producto no agrega', P.agregarDesdeVisor(null, LOCAL), false);
igual('sin local no agrega', P.agregarDesdeVisor({ nombre: 'Arroz' }, null), false);

/* El visor manda el SKU; el precio que traiga la escena se ignora. */
P.agregarDesdeVisor({ sku: 'ACE-002', nombre: 'Aceite', precio: 999, stock: 9 }, LOCAL);
const g1 = carritoGuardado()['tienda-prueba'];
ok('el carrito se guarda por local', !!g1, JSON.stringify(g1));
ok('guarda el nombre del local', g1 && g1.nombre === 'Almacén Doña Rosa');
igual('el ítem lleva el SKU del catálogo', g1 && g1.items['tienda-prueba#1'].s, 'ACE-002');
igual('cobra el precio efectivo del servidor', g1 && g1.items['tienda-prueba#1'].p, 1500);
igual('guarda la lista para mostrar el ahorro', g1 && g1.items['tienda-prueba#1'].l, 2000);
igual('guarda el descuento vigente', g1 && g1.items['tienda-prueba#1'].d, 25);
igual('una unidad la primera vez', g1 && g1.items['tienda-prueba#1'].c, 1);

P.agregarDesdeVisor({ sku: 'ACE-002' }, LOCAL);
igual('repetir el producto suma cantidad',
  carritoGuardado()['tienda-prueba'].items['tienda-prueba#1'].c, 2);
P.agregarDesdeVisor({ sku: 'ACE-002' }, LOCAL);
igual('el stock topa el carrito', carritoGuardado()['tienda-prueba'].items['tienda-prueba#1'].c, 2);
ok('el tope avisa al comprador', avisos.some((t) => /Sólo quedan 2/.test(t)), JSON.stringify(avisos));

/* Producto del estante que no vino por SKU: se resuelve por nombre. */
P.agregarDesdeVisor({ nombre: 'Arroz 1 kg', precio: 1 }, LOCAL);
const arroz = carritoGuardado()['tienda-prueba'].items['tienda-prueba#0'];
igual('resuelve por nombre y cobra el catálogo', arroz && arroz.p, 1200);
igual('el ítem por nombre también lleva SKU', arroz && arroz.s, 'ARR-001');

/* Producto que no está en el catálogo (dato viejo en la escena): no se pierde. */
P.agregarDesdeVisor({ nombre: 'Queso fresco', precio: 700 }, LOCAL);
const queso = carritoGuardado()['tienda-prueba'].items['tienda-prueba#Queso fresco'];
igual('un producto fuera de catálogo conserva su precio', queso && queso.p, 700);

igual('el carrito viejo no se toca', almacen.get('fcore.mercado.carrito') || null, null);

console.log('\nCarrito · resumenDeLocal');
const r = P.resumenDeLocal('tienda-prueba');
igual('tres líneas', r.lineas, 3);
igual('cuatro unidades', r.unidades, 4);
igual('total del local', r.total, 1500 * 2 + 1200 + 700);
igual('un local sin carrito da cero', P.resumenDeLocal('no-existe'), { lineas: 0, unidades: 0, total: 0 });
igual('el carrito viejo cuenta unidades sin precio', P.resumenDeLocal('local-viejo'), { lineas: 1, unidades: 2, total: 0 });

/* ── 5. el catálogo manda: descuento vigente, no el inventado ────────────── */
console.log('\nCatálogo · precio y descuento del servidor');
const prods = P._test.productos(LOCAL);
igual('tres productos', prods.length, 3);
igual('el precio de lista se respeta', prods[1].lista, 2000);
igual('el precio efectivo viene del servidor', prods[1].precio, 1500);
igual('el descuento vigente viene del servidor', prods[1].descuento, 25);
const vencido = P._test.productos({
  id: 'x', nombre: 'X', catalogo: [
    { nombre: 'Oferta vieja', precio: 1000, descuento: 40, descuento_vigente: 0, precio_efectivo: 1000 }
  ]
});
igual('una oferta vencida no rebaja', vencido[0].descuento, 0);
igual('una oferta vencida cobra la lista', vencido[0].precio, 1000);

/* ── 6. el dueño abre su visor desde el panel ────────────────────────────── */
console.log('\nPanel · «Ver en 3D»');
const NEG = leer('web/app/negocio.js');
const HTML = leer('web/app/index.html');
ok('el panel tiene el botón', /id="negVer3d"/.test(HTML));
ok('el botón está en la cabecera del panel',
  /id="negNubeEstado"[\s\S]{0,220}id="negVer3d"/.test(HTML));
ok('abre con el catálogo y el local del dueño',
  /ponerTienda\(cat, EST\.sel, "negocio"\)/.test(NEG) &&
  /productosDe\(EST\.sel\)/.test(NEG));
ok('el botón se conecta al abrir el panel', /if \(v3\) v3\.onclick = verTienda3d;/.test(NEG));
ok('el botón se muestra con el panel', /const v3 = \$\("negVer3d"\);\n    if \(v3\) \{\n      v3\.hidden = false;/.test(NEG));
ok('avisa cuando la tienda no tiene productos', /Ver en 3D \(sin productos\)/.test(NEG));
ok('no se rompió el botón de abrir/cerrar', /const ab = \$\("negAbiertoBtn"\)/.test(NEG));

/* ── 7. la ficha pública entra al visor con el local ─────────────────────── */
console.log('\nMapa · «Entrar al local»');
ok('la ficha pasa el local y el origen',
  /ponerTienda\(productos\(m\), m, "mapa"\)/.test(leer('web/app/placer.js')));
ok('el escaparate de la casa sigue entrando sin local',
  /Tienda3D\.ponerTienda\(null, null\)/.test(leer('web/app/mercado.js')));

/* ── 8. salidas: atrás y carrito ─────────────────────────────────────────── */
console.log('\nSalidas · atrás y carrito');
const MER = leer('web/app/mercado.js');
ok('atrás pregunta el origen', /Tienda3D\.origenDe \? Tienda3D\.origenDe\(\)/.test(MER));
ok('desde el panel del dueño vuelve al panel', /origen === "negocio" \? "negocio"/.test(MER));
ok('desde el mapa vuelve a la ficha', /alMapa \? "panel" : "mercado"/.test(MER));
ok('el carrito con local abre el de MercadoPlacer', /window\.Placer\.abrirCarrito/.test(MER));
ok('primero sale del visor y después abre el carrito',
  /Fabri\.go\("panel"\)[\s\S]{0,120}setTimeout\(\(\) => window\.Placer\.abrirCarrito\(\), 80\)/.test(MER));
ok('sin local el carrito sigue siendo el del escaparate', /\n      abrirCarrito\(\);/.test(MER));

/* ── 9. la PWA no queda con la versión vieja ─────────────────────────────── */
console.log('\nCaché · versión del service worker');
const SW = leer('web/app/sw.js');
ok('sw.js declara una versión', /const V = 'fcore-v\d+'/.test(SW));
ok('la versión es la de la Fase 10 o posterior', Number((SW.match(/fcore-v(\d+)/) || [])[1] || 0) >= 85,
  (SW.match(/fcore-v(\d+)/) || [])[0]);

console.log(fallos
  ? '\n\x1b[1;31m✖ ' + fallos + ' fallo(s) de ' + pasos + '\x1b[0m\n'
  : '\n\x1b[1;32m✔ ' + pasos + ' comprobaciones OK\x1b[0m\n');
process.exit(fallos ? 1 : 0);
