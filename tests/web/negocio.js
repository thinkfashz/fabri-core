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
  Fabri: { q: () => [], toast: () => {}, go: () => {} },
  location: { origin: 'https://forge-core-stock.vercel.app' }
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

/* ── 4 bis. panel · filtros, CSV y gráfico ───────────────────────────────── */
console.log('\nPanel · filtros, CSV y gráfico');
const PEDIDOS = [
  { codigo: 'P-1', fecha: Date.UTC(2026, 10, 10, 12), cliente: { nombre: 'Ana Pérez', telefono: '+5691' },
    items: [{ nombre: 'Tomate 1 kg', cantidad: 2, precio: 1390 }], subtotal: 2780, envio: 0,
    total: 2780, entrega: 'retiro', direccion: '', estado: 'nuevo', nube: true, pedido_id: 'x1' },
  { codigo: 'P-2', fecha: Date.UTC(2026, 10, 10, 13), cliente: { nombre: 'Luis Soto', telefono: '+5692' },
    items: [{ nombre: 'Pan marraqueta', cantidad: 1, precio: 1200 }], subtotal: 1200, envio: 0,
    total: 1200, entrega: 'delivery', direccion: 'Av. Siempre Viva 742', estado: 'entregado' },
  { codigo: 'P-3', fecha: Date.UTC(2026, 10, 11, 9), cliente: { nombre: 'Rosa Díaz' },
    items: [{ nombre: 'Leche 1 L', cantidad: 1, precio: 1290 }], subtotal: 1290, envio: 0,
    total: 1290, entrega: 'retiro', estado: 'cancelado' }
];
igual('sin filtro devuelve todo', N._test.filtrarPedidos(PEDIDOS, '', '').length, 3);
igual('«abiertos» deja fuera entregado y cancelado', N._test.filtrarPedidos(PEDIDOS, '', 'abiertos').length, 1);
igual('filtro por estado exacto', N._test.filtrarPedidos(PEDIDOS, '', 'entregado').length, 1);
igual('busca por cliente sin acentos', N._test.filtrarPedidos(PEDIDOS, 'ana perez', '').length, 1);
igual('busca por producto', N._test.filtrarPedidos(PEDIDOS, 'tomate', '').length, 1);
igual('busca por código en minúscula', N._test.filtrarPedidos(PEDIDOS, 'p-2', '').length, 1);
igual('texto sin coincidencias', N._test.filtrarPedidos(PEDIDOS, 'zzz', '').length, 0);
igual('filtro + texto se combinan', N._test.filtrarPedidos(PEDIDOS, 'ana', 'entregado').length, 0);

const csvUno = N._test.csvPedidos([PEDIDOS[0]]);
ok('CSV trae cabecera', csvUno.split('\r\n')[0].startsWith('codigo;fecha;cliente'));
ok('CSV incluye totales', /;2780;0;2780;/.test(csvUno));
ok('CSV arma los productos con cantidad', /2x Tomate 1 kg/.test(csvUno));
ok('CSV escapa el separador', N._test.csvPedidos([{ codigo: 'A;B', items: [], estado: 'nuevo' }]).indexOf('"A;B"') > 0);

const barras = N._test.barrasSerie([
  { dia: '2026-11-09', pedidos: 1, ventas: 1000 },
  { dia: '2026-11-10', pedidos: 0, ventas: 0 },
  { dia: '2026-11-11', pedidos: 2, ventas: 3000 }
]);
igual('una barra por día', barras.length, 3);
igual('la más alta ocupa 100 %', barras[2].alto, 100);
igual('el día sin ventas conserva 2 %', barras[1].alto, 2);
ok('el último día se marca como hoy', barras[2].hoy === true);
igual('con pocos días se rotula cada uno', barras.map((b) => b.etiqueta).join(','), '09,10,11');
const barras30 = N._test.barrasSerie(Array.from({ length: 30 }, (_, i) =>
  ({ dia: '2026-11-' + String(i + 1).padStart(2, '0'), pedidos: 0, ventas: 0 })));
igual('con 30 días se rotula cada 5 y el último', barras30.filter((b) => b.etiqueta).length, 7);

/* El enlace de seguimiento se arma en el panel del dueño para reenviarlo. */
igual('el enlace de seguimiento usa el origen del sitio',
  N._test.enlaceSeguimiento('abc123'), 'https://forge-core-stock.vercel.app/seguir.html?t=abc123');
igual('sin token no hay enlace', N._test.enlaceSeguimiento(''), '');
ok('el token va escapado', N._test.enlaceSeguimiento('a b&c').indexOf('a%20b%26c') > 0);

/* ── aviso al cliente por WhatsApp ───────────────────────────────────────── */

const NU = N._test.numeroWa;
igual('número chileno con +56 y espacios', NU('+56 9 1234 5678'), '56912345678');
igual('número chileno sin código de país', NU('9 1234 5678'), '56912345678');
igual('celular escrito con 0 inicial', NU('09 1234 5678'), '56912345678');
igual('con puntos y guiones', NU('9.1234.5678'), '56912345678');
igual('número de otro país se respeta', NU('+54 11 4321 8765'), '541143218765');
igual('sin teléfono no hay número', NU(''), '');
igual('un teléfono muy corto no sirve', NU('12345'), '');
ok('tolera nulos', NU(null) === '');

const FR = N._test.fraseEstado;
igual('recibido', FR({ estado: 'nuevo' }), 'lo recibimos');
igual('preparando', FR({ estado: 'visto' }), 'está en preparación');
igual('listo para retirar', FR({ estado: 'listo', entrega: 'retiro' }), 'está listo para retirar');
igual('listo con delivery va en camino', FR({ estado: 'listo', entrega: 'delivery' }), 'va en camino');
igual('entregado', FR({ estado: 'entregado' }), 'fue entregado');
igual('cancelado', FR({ estado: 'cancelado' }), 'fue cancelado');

const MSG = N._test.mensajePedido;
const ped = {
  codigo: 'MP-7K2QX', estado: 'listo', entrega: 'retiro',
  seguimiento: 'abc123', cliente: { nombre: 'Ana Pérez', telefono: '+56912345678' }
};
const msg = MSG(ped, 'Almacén Doña Rosa');
ok('saluda por el nombre de pila', msg.indexOf('Hola Ana,') === 0, msg);
ok('dice el código del pedido', msg.indexOf('MP-7K2QX') > 0, msg);
ok('dice el local', msg.indexOf('Almacén Doña Rosa') > 0, msg);
ok('dice el estado en palabras del cliente', msg.indexOf('está listo para retirar') > 0, msg);
ok('lleva el enlace de seguimiento', msg.indexOf('seguir.html?t=abc123') > 0, msg);
ok('sin cliente no inventa nombre', MSG({ codigo: 'MP-1', estado: 'nuevo' }, 'X').indexOf('Hola,') === 0);
ok('sin seguimiento igual hay mensaje',
  MSG({ codigo: 'MP-1', estado: 'nuevo' }, 'X').indexOf('seguir.html') < 0);
ok('un nombre compuesto usa el primero', MSG(Object.assign({}, ped, { cliente: { nombre: 'María José Soto' } }), 'X')
  .indexOf('Hola María,') === 0);

const EW = N._test.enlaceWa;
const wa = EW(ped, 'Almacén Doña Rosa');
ok('el enlace de WhatsApp usa wa.me', wa.indexOf('https://wa.me/56912345678?text=') === 0, wa);
ok('el texto va escapado', EW(ped, 'X').indexOf(' ') < 0);
igual('sin teléfono no hay enlace', EW({ codigo: 'MP-1', cliente: {} }, 'X'), '');
igual('el pedido sin cliente no rompe', EW({ codigo: 'MP-1' }, 'X'), '');

const panel = leer('web/app/negocio.js');
ok('la lista pinta el botón Avisar', /data-wa=/.test(panel) && /button\.wa/.test(leer('web/app/styles.css')));
ok('el botón abre WhatsApp en otra pestaña', /function abrirWa/.test(panel) && /window\.open\(url, "_blank"/.test(panel));
ok('el dueño puede mover el pedido de estado', /data-estado=/.test(panel) && /accion: "pedido_estado"/.test(panel));
ok('el selector no se muestra en pedidos ya cerrados', /hecho \|\| cancel \? "" : \(p\.nube/.test(panel));


/* ── 5. contrato del HTML ────────────────────────────────────────────────── */
console.log('\nContrato · index.html');
const html = leer('web/app/index.html');
const ids = [
  'negCuenta', 'negCuentaChip', 'negCuentaMail', 'negCuentaIr', 'negCuentaEstado',
  'negTiendas', 'negFormTienda', 'ntNombre', 'ntMarca', 'ntRubro', 'ntDireccion',
  'ntComuna', 'ntLat', 'ntLon', 'ntGps', 'ntLogoFile', 'ntLogoPrev', 'ntDesc',
  'ntTel', 'ntAviso', 'ntCancelar', 'negPanel', 'negKpis',
  'negPedidos', 'negPedCount', 'negProductos', 'negProdCount', 'negFormProd',
  'negProdNombre', 'negProdPrecio', 'negProdStock', 'negProdSku', 'negProdCategoria',
  'negCategorias', 'negImportFile', 'negImportStock', 'negImportAviso',
  'neNombre', 'neMarca', 'neRubro', 'neTelefono', 'neDireccion', 'neComuna',
  'neHorario', 'neMinimo', 'neEnvio', 'neLogoFile', 'neLogoPrev', 'neDesc',
  'neRetiro', 'neDelivery', 'neGuardar', 'neBorrar', 'neAviso',
  'negAbiertoBtn', 'negNubeEstado',
  'negNubeLocal', 'negNubeClave', 'negNubeBtn', 'negNubeClaveEstado',
  'negLive', 'negTabs', 'negTabResumen', 'negTabPedidos', 'negTabCatalogo', 'negTabAjustes',
  'negRango', 'negSerie', 'negSerieSub', 'negSerieChip', 'negTop', 'negTopRango',
  'negEstados', 'negEstCount', 'negVisitas', 'negPedTotal', 'negProdTotal',
  'negPedBuscar', 'negPedFiltro', 'negPedExport'
];
const faltan = ids.filter((id) => !new RegExp('id="' + id + '"').test(html));
ok('todos los ids que usa negocio.js existen', faltan.length === 0, 'faltan: ' + faltan.join(', '));
ok('la sección conserva id s-negocio', /id="s-negocio"/.test(html));
ok('el respaldo por clave sigue presente', /negNubeBtn/.test(html) && /Conectar con ID y clave/.test(html));
ok('la tienda abierta no se repite como cabecera aparte', !/negTiendaCab/.test(html));
ok('la tienda abierta ofrece verla en el mapa', /data-mapa/.test(leer('web/app/negocio.js')));

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

/* ── 6 bis. contrato del resumen (panel del dueño) ───────────────────────── */
console.log('\nContrato · resumen del panel');
ok('acción ventas_serie', /accion === 'ventas_serie'/.test(api));
ok('ventas_serie autoriza con autorizarLocal',
  /accion === 'ventas_serie'[\s\S]{0,260}autorizarLocal/.test(api));
ok('la serie se corta en hora de Chile', /America\/Santiago/.test(api));
ok('la serie rellena los días sin ventas', /generate_series/.test(api));
ok('top de productos desde el JSON del pedido', /jsonb_array_elements/.test(api));
ok('los cancelados no suman', /estado <> 'cancelado'/.test(api));
ok('las visitas no rompen si la tabla no existe', /to_regclass\('public\.visitas'\)/.test(api));
ok('la conversión se devuelve calculada', /conversion:/.test(api));
ok('ventas_serie aparece en el listado de acciones', /'ventas_serie'/.test(api));

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
