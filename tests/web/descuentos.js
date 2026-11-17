#!/usr/bin/env node
/* Pruebas del descuento y del stock (Fase 9).
 *
 * Sin navegador ni red: se comprueba el contrato del código real.
 *   · el descuento lo fija el vendedor y lo cobra el servidor, no el navegador;
 *   · el precio efectivo sale de una sola expresión SQL (catálogo = pedido);
 *   · una oferta vencida deja de rebajar sin borrar el porcentaje;
 *   · importar stock sin la columna no apaga la oferta que ya existía;
 *   · el carrito del comprador topa con el stock y muestra el ahorro;
 *   · el dueño ve ofertas, stock crítico y ahorro en sus pedidos;
 *   · el admin ve ofertas, stock crítico y valor del inventario.
 *
 * Uso: node tests/web/descuentos.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');

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
  location: { origin: 'https://forge-core-stock.vercel.app' }
};

require(path.join(RAIZ, 'web', 'app', 'negocio.js'));
const N = global.window.Negocio;

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
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

const api = leer('api-telefono/api/mercado.ts');
const placer = leer('web/app/placer.js');
const negocio = leer('web/app/negocio.js');
const plataforma = leer('web/app/plataforma.js');
const html = leer('web/app/index.html');
const css = leer('web/app/styles.css');
const placerCss = leer('web/app/placer.css');
const sw = leer('web/app/sw.js');

/* ── 1. el descuento en el vendedor ──────────────────────────────────────── */
console.log('\nVendedor · cálculo y formulario');
const oferta = N._test.ofertaDe({ precio: 1000, descuento: 20 });
igual('20 % sobre $1.000 deja el precio en $800', oferta, { lista: 1000, descuento: 20, efectivo: 800 });
igual('una oferta vencida no rebaja',
  N._test.ofertaDe({ precio: 1000, descuento: 20, descuento_vigente: 0 }).efectivo, 1000);
igual('manda el precio efectivo del servidor',
  N._test.ofertaDe({ precio: 1000, descuento_vigente: 20, precio_efectivo: 799 }).efectivo, 799);
igual('nunca queda un producto en $0', N._test.ofertaDe({ precio: 1, descuento: 90 }).efectivo, 1);
igual('sin fecha, el campo queda vacío', N._test.fechaInput(0), '');
ok('unix → fecha del formulario',
  /^\d{4}-\d{2}-\d{2}$/.test(N._test.fechaInput(Date.UTC(2026, 11, 31, 12) / 1000)));

const conDcto = N._test.aProducto({ nombre: 'Pan', precio: '1.990', dcto: '15', vence: '2026-12-31' });
igual('sinónimo dcto → descuento', conDcto.descuento, 15);
igual('sinónimo vence → oferta_hasta', conDcto.oferta_hasta, '2026-12-31');
ok('sin columna de oferta, no se toca la que existe',
  !('descuento' in N._test.aProducto({ nombre: 'Pan', precio: 1990 })));
ok('un descuento mayor a 90 se recorta',
  N._test.aProducto({ nombre: 'Pan', precio: 1990, descuento: 300 }).descuento === 90);

const csvOferta = 'nombre,precio,descuento,oferta_hasta\nPan,1990,20,2026-12-31\n';
const pOferta = N._test.parseProductos(csvOferta)[0];
igual('CSV: la columna descuento viaja', pOferta.descuento, 20);
igual('CSV: la fecha de fin viaja', pOferta.oferta_hasta, '2026-12-31');
ok('CSV sin descuento no apaga la oferta',
  !('descuento' in N._test.parseProductos('nombre,precio\nPan,1990\n')[0]));

ok('el formulario tiene descuento y fecha',
  /id="negProdDescuento"/.test(html) && /id="negProdOfertaHasta"/.test(html));
ok('el panel lee los dos campos',
  /negProdDescuento/.test(negocio) && /negProdOfertaHasta/.test(negocio));
ok('los sinónimos cubren dcto y vencimiento',
  /descuento: \["descuento", "dcto"/.test(negocio) &&
  /oferta_hasta: \["oferta_hasta", "hasta"/.test(negocio));
ok('el catálogo muestra precio de antes y −%',
  /neg-prod-off/.test(negocio) && /neg-prod-precio/.test(negocio));
ok('el stock bajo y agotado se destacan',
  /neg-stock-err/.test(negocio) && /neg-stock-warn/.test(negocio));
ok('editar devuelve la oferta al formulario', /fechaInput\(p\.oferta_hasta\)/.test(negocio));
ok('el KPI de productos cuenta las ofertas', /en oferta/.test(negocio));
ok('el pedido muestra lo que ahorró el comprador', /ahorró " \+ clp\(p\.ahorro\)/.test(negocio));

/* ── 2. el descuento en el servidor ──────────────────────────────────────── */
console.log('\nServidor · esquema y un solo precio');
ok('el producto guarda descuento y fin de oferta',
  /ADD COLUMN IF NOT EXISTS descuento SMALLINT NOT NULL DEFAULT 0/.test(api) &&
  /ADD COLUMN IF NOT EXISTS oferta_hasta BIGINT NOT NULL DEFAULT 0/.test(api));
ok('el tope del descuento vive en la base',
  /chk_mercado_productos_dcto CHECK \(descuento BETWEEN 0 AND \$\{DCTO_MAX\}\)/.test(api));
ok('el pedido guarda el ahorro',
  /ADD COLUMN IF NOT EXISTS ahorro NUMERIC NOT NULL DEFAULT 0/.test(api));
ok('el tope es 90 %', /const DCTO_MAX = 90/.test(api));
ok('la vigencia se resuelve en SQL',
  /oferta_hasta = 0[\s\S]{0,90}oferta_hasta > extract\(epoch from now\(\)\)::bigint/.test(api));
ok('el precio efectivo nunca queda en cero',
  /GREATEST\(1, round\(\$\{prefijo\}precio \* \(100 - \$\{dctoVigente\(prefijo\)\}\) \/ 100\)\)/.test(api));
ok('el catálogo devuelve los cinco números',
  /descuento::int AS descuento[\s\S]{0,180}descuento_vigente[\s\S]{0,180}precio_efectivo[\s\S]{0,90}oferta_hasta/.test(api));
ok('catálogo, tienda y pedido usan las mismas columnas',
  (api.match(/CAMPOS_PRODUCTO/g) || []).length >= 4);

console.log('\nServidor · oferta del vendedor');
ok('un lote sin columna conserva la oferta',
  /const tocaOferta = 'descuento' in p \|\| 'oferta_hasta' in p/.test(api) &&
  /CASE WHEN \$13::boolean THEN EXCLUDED\.descuento/.test(api));
ok('el descuento se acota al tope', /entero\(p\.descuento, DCTO_MAX\)/.test(api));
ok('una fecha suelta vale hasta fin de día en Chile', /T23:59:59-04:00/.test(api));
ok('la subida devuelve cuántos quedaron en oferta', /total, ofertas, tope/.test(api));

console.log('\nServidor · pedido y paneles');
ok('el pedido cobra el precio efectivo',
  /const efectivo = Number\(enCat\.precio_efectivo\) \|\| lista/.test(api) &&
  /precio: efectivo/.test(api));
ok('cada ítem guarda precio de lista y descuento',
  /precio_lista: x\.precio_lista, descuento: x\.descuento/.test(api));
ok('el ahorro se guarda y se devuelve',
  /const ahorro = items\.reduce/.test(api) && /ahorro, estado: 'nuevo'/.test(api) &&
  /ahorro: p\.ahorro/.test(api));
ok('el listado del dueño trae el ahorro', /p\.ahorro::float8 AS ahorro/.test(api));
ok('la serie suma los descuentos del periodo',
  /COALESCE\(SUM\(ahorro\), 0\)::float8 AS descuento/.test(api) &&
  /descuento: Number\(t0\.descuento\) \|\| 0/.test(api));
ok('el resumen cuenta ofertas y stock',
  /productos_oferta:/.test(api) && /stock_bajo:/.test(api) && /stock_agotado:/.test(api));
ok('el resumen valora el inventario y los descuentos',
  /valor_inventario:/.test(api) && /descuento_entregado:/.test(api));
ok('el resumen lista los casos concretos',
  /stock_critico: criticos\.rows/.test(api) && /ofertas: ofertas\.rows/.test(api));

/* ── 3. el comprador ─────────────────────────────────────────────────────── */
console.log('\nComprador · sin ofertas inventadas');
ok('el catálogo real usa el descuento del servidor',
  /it\.descuento_vigente != null \? it\.descuento_vigente : it\.descuento/.test(placer) &&
  /it\.precio_efectivo != null/.test(placer));
ok('ya no se sortea un descuento en el navegador',
  !/conOferta = azar/.test(placer) && !/\[10, 15, 20, 25\]/.test(placer));
ok('un local sin catálogo no inventa rebajas', /descuento: 0,/.test(placer));
ok('el carrito topa con el stock del catálogo',
  /if \(delta > 0 && tope !== null && cant > tope\)/.test(placer) &&
  /está agotado/.test(placer));
ok('el producto agotado no deja agregar',
  /agotado \? '<div class="mp-prod-acc mp-prod-off-msg">sin stock<\/div>'/.test(placer));
ok('el botón se apaga al llegar al stock', /\(lleno \? " disabled" : ""\)/.test(placer));
ok('el pedido manda el SKU', /sku: x\.sku \|\| undefined/.test(placer));
ok('el carrito y el pago muestran el ahorro',
  /mp-car-ahorro/.test(placer) && /mp-pago-ahorro/.test(placer));
ok('el pago sigue usando el total del servidor', /totalServidor/.test(placer));

/* ── 4. el admin ─────────────────────────────────────────────────────────── */
console.log('\nAdmin · catálogo de la plataforma');
ok('hay tarjetas de ofertas, stock e inventario',
  /id="platOfertas"/.test(html) && /id="platStock"/.test(html) && /id="platInventario"/.test(html));
ok('el panel las pinta desde el resumen',
  /function pintarCatalogo/.test(plataforma) && /EST\.resumen\.ofertas/.test(plataforma) &&
  /EST\.resumen\.stock_critico/.test(plataforma));
ok('se engancha al pintado general', /pintarKpis\(\);[\s\S]{0,40}pintarCatalogo\(\);/.test(plataforma));
ok('los KPIs hablan de oferta y stock crítico',
  /en oferta/.test(plataforma) && /"Stock crítico"/.test(plataforma));
ok('el inventario usa el valor del servidor', /valor_inventario/.test(plataforma));

/* ── 5. estilos y caché ──────────────────────────────────────────────────── */
console.log('\nEstilos y caché');
ok('el precio de antes y el −% tienen estilo',
  /\.mp-prod-antes/.test(placerCss) && /\.mp-prod-off \{/.test(placerCss));
ok('el ahorro tiene estilo en carrito y pago',
  /\.mp-car-ahorro/.test(placerCss) && /\.mp-pago-ahorro/.test(placerCss));
ok('el agotado apaga el botón', /\.mp-mas\[disabled\]/.test(placerCss));
ok('la oferta del vendedor tiene estilo', /\.neg-prod-precio em/.test(css) && /\.neg-item-off/.test(css));
ok('el catálogo del admin tiene estilo', /\.plat-catalogo-fila/.test(css));
const v = (sw.match(/const V = 'fcore-v(\d+)'/) || [])[1];
ok('la caché cambió de versión', Number(v) >= 84, 'V = fcore-v' + v);

console.log(fallos
  ? '\n\x1b[1;31m✖ ' + fallos + ' fallo(s) de ' + pasos + '\x1b[0m\n'
  : '\n\x1b[1;32m✔ ' + pasos + ' comprobaciones OK\x1b[0m\n');
process.exit(fallos ? 1 : 0);
