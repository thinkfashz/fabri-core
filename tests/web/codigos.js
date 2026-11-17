#!/usr/bin/env node
/* Pruebas del código de barras real (Fase 2 del marketplace).
 *
 * Sin navegador ni red: se comprueba el contrato del código real.
 *   · la API guarda `codigo`, valida GS1 y conserva el anterior si no se toca;
 *   · un código inválido se informa y no borra el que ya estaba;
 *   · `codigo_buscar` cruza todas las marcas activas y ordena por precio;
 *   · el panel escanea, valida y muestra códigos inválidos;
 *   · el CSV distingue «Código de barras» (EAN) de «Código» (SKU);
 *   · el comprador busca por código y abre la marca con su catálogo filtrado;
 *   · la ficha 3D usa el código real y no inventa uno;
 *   · el service worker sube de versión para no servir JS viejo.
 *
 * Uso: node tests/web/codigos.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

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
  readyState: 'complete'
};
global.window = {
  CoreNube: { leer: () => null },
  Fabri: { q: () => [], one: () => null, toast: () => {}, go: () => {} },
  location: { origin: 'https://forge-core-stock.vercel.app' },
  addEventListener: () => {},
  matchMedia: () => ({ matches: false }),
  setTimeout: () => { /* sin temporizadores en la prueba */ }
};

require(path.join(RAIZ, 'web', 'app', 'core-scan.js'));
require(path.join(RAIZ, 'web', 'app', 'negocio.js'));
require(path.join(RAIZ, 'web', 'app', 'placer.js'));
const Scan = global.window.Scan;
const N = global.window.Negocio;
const P = global.window.Placer;

/* ── utilidades ──────────────────────────────────────────────────────────── */
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

const API = leer('api-telefono/api/mercado.ts');
const NEG = leer('web/app/negocio.js');
const PL = leer('web/app/placer.js');
const T3D = leer('web/app/tienda3d.js');
const HTML = leer('web/app/index.html');
const CSS = leer('web/app/styles.css');
const PCSS = leer('web/app/placer.css');
const SW = leer('web/app/sw.js');

/* ── 1. base de datos y API ──────────────────────────────────────────────── */
console.log('\nAPI · columna y validación');
ok('tope de código de 48 caracteres', /const MAX_CODIGO = 48;/.test(API));
ok('columna codigo en la tabla', /codigo\s+TEXT NOT NULL DEFAULT ''/.test(API));
ok('ALTER para bases ya creadas',
  /ADD COLUMN IF NOT EXISTS codigo TEXT NOT NULL DEFAULT ''/.test(API));
ok('índice parcial sólo de los que tienen código',
  /CREATE INDEX IF NOT EXISTS idx_mercado_productos_codigo[\s\S]{0,140}WHERE codigo <> ''/.test(API));
ok('valida el dígito GS1 en el servidor', /function digitoGS1Ok/.test(API));
ok('normaliza y rechaza códigos inválidos', /function normalizarCodigoBarras/.test(API));
ok('acepta EAN-8, UPC-A, EAN-13 y GTIN-14',
  /\[8, 12, 13, 14\]\.includes\(c\.length\)/.test(API));
ok('exige al menos un dígito en Code 128/39', /\\d\/\.test\(c\)/.test(API));

console.log('\nAPI · catálogo y alta');
ok('CAMPOS_PRODUCTO trae el código', /codigo,imagen_hash`/.test(API));
ok('productoDeFila expone el código', /codigo: f\.codigo \|\| ''/.test(API));
ok('el INSERT guarda el código',
  /\(local_id,sku,nombre,precio,stock,categoria,unidad,actualizado,descuento,oferta_hasta,imagen,imagen_hash,codigo\)/.test(API));
ok('conserva el código cuando el lote no lo trae',
  /codigo = CASE WHEN \$16::boolean THEN EXCLUDED\.codigo[\s\S]{0,90}ELSE \$\{T_PRODUCTOS\}\.codigo END/.test(API));
ok('un código inválido no borra el anterior',
  /imagen, imagenHash, codigo, tocaOferta, foto\.ok, cod\.ok\]/.test(API));
ok('informa códigos inválidos',
  /codigos_invalidos: codigosInvalidos\.length/.test(API) &&
  /detalle_codigos_invalidos/.test(API));

console.log('\nAPI · búsqueda entre marcas');
ok('acción pública por GET',
  /searchParams\.get\('accion'\) === 'codigo_buscar'/.test(API));
ok('mismo contrato por POST', /if \(accion === 'codigo_buscar'\)/.test(API));
ok('cruza todos los locales', /async function buscarPorCodigo/.test(API) &&
  /WHERE codigo = \$1/.test(API));
ok('sólo locales activos', /WHERE id = ANY\(\$1::text\[\]\) AND activo = true/.test(API));
ok('ordena por precio efectivo', /ORDER BY \$\{precioEfectivo\(\)\} ASC/.test(API));
ok('tope de 50 resultados', /LIMIT 50/.test(API));
ok('acción listada en el diagnóstico', /'imagen_ver', 'codigo_buscar'/.test(API));
ok('el pedido guarda el código del producto', /codigo: enCat\.codigo \|\| ''/.test(API));
ok('el snapshot JSONB del pedido guarda el código',
  /sku: x\.sku, codigo: x\.codigo \|\| ''/.test(API));
ok('los ítems del pedido normalizan el código',
  /codigo: texto\(f\.codigo, MAX_CODIGO\)/.test(API));

/* ── 2. panel del vendedor ───────────────────────────────────────────────── */
console.log('\nPanel · campo, escaneo y validación');
ok('input de código en el HTML', /id="negProdCodigo"/.test(HTML));
ok('botón de escaneo en el HTML', /id="negProdCodigoScan"/.test(HTML));
ok('aviso del código en el HTML', /id="negProdCodigoAviso"/.test(HTML));
ok('el botón abre el escáner', /scanCodigo[\s\S]{0,700}window\.Scan\.abrir/.test(NEG));
ok('valida antes de guardar', /!window\.Scan\.pareceCodigo\(codigo\)/.test(NEG));
ok('manda el código al servidor', /codigo: codigo/.test(NEG));
ok('al editar rellena el código', /poner\("negProdCodigo", p\.codigo\)/.test(NEG));
ok('la lista muestra el código', /class="neg-prod-cod"/.test(NEG));
ok('CSS del código en la lista', /\.neg-prod \.neg-prod-cod \{/.test(CSS));
ok('avisa los códigos inválidos del lote',
  /Number\(d\.codigos_invalidos\)/.test(NEG) &&
  /código inválido/.test(NEG));

console.log('\nPanel · CSV distingue EAN de SKU');
ok('sinónimos de código de barras', /codigo_barras[\s\S]{0,120}barcode/.test(NEG));
ok('«codigo» sigue siendo SKU', /sku: \["sku", "codigo", "code"\]/.test(NEG));

const pBarras = N._test.parseProductos(
  'Producto;Precio;Codigo de barras;Codigo\nLeche 1 L;1290;4006381333931;L-2\n'
)[0];
igual('código de barras va a codigo', pBarras.codigo, '4006381333931');
igual('«Codigo» sigue siendo el SKU', pBarras.sku, 'L-2');

const soloSku = N._test.parseProductos('nombre,precio,codigo\nTé,1990,L-9\n')[0];
igual('una planilla vieja sigue leyendo el SKU', soloSku.sku, 'L-9');
ok('sin columna de barras no inventa código', soloSku.codigo === undefined);

const pEan = N._test.aProducto({ nombre: 'Café', precio: 2990, codigo_barras: '7801234567894' });
igual('JSON con codigo_barras guarda el EAN', pEan.codigo, '7801234567894');
ok('JSON sin código no lo inventa', N._test.aProducto({ nombre: 'Café', precio: 2990 }).codigo === undefined);

/* ── 3. comprador ────────────────────────────────────────────────────────── */
console.log('\nComprador · catálogo y búsqueda real');
ok('productos() expone el código', /codigo: it\.codigo \|\| ""/.test(PL));
ok('el buscador filtra por código', /p\.codigo && String\(p\.codigo\)\.toLowerCase\(\)\.includes\(q\)/.test(PL));
ok('consulta codigo_buscar', /accion=codigo_buscar&codigo=/.test(PL));
ok('ya no inventa una referencia del local', !/código no registrado · referencia/.test(PL));
ok('hoja de resultados del código', /function abrirResultadosCodigo/.test(PL));
ok('abre la marca con su catálogo', /function abrirMarcaDeResultado/.test(PL) &&
  /accion=local_ver&id=/.test(PL) && /registrarLocal\(d\.tienda\)/.test(PL));
ok('deja el catálogo filtrado por el código', /ESTADO\.cat\.q = String\(codigo \|\| ""\)/.test(PL));
ok('la hoja existe en el HTML',
  /id="mpCodigos"/.test(HTML) && /id="mpCodigosCuerpo"/.test(HTML) &&
  /id="mpCodigosX"/.test(HTML) && /id="mpCodigosFondo"/.test(HTML));
ok('el menú dice «Escanear código»', /id="mpScan"[\s\S]{0,420}Escanear código/.test(HTML));
ok('CSS de los resultados', /\.mp-cod-res \{/.test(PCSS) && /\.mp-cod-ver \{/.test(PCSS));

const conCodigo = P._test.productos({
  id: 'local-1', nombre: 'Local 1', catalogo: [
    { sku: 'SKU-1', codigo: '4006381333931', nombre: 'Café', precio: 2990, precio_efectivo: 2990, stock: 5 }
  ]
});
igual('el código viaja al producto del catálogo', conCodigo[0].codigo, '4006381333931');
igual('sin código queda vacío', P._test.productos({
  id: 'local-2', nombre: 'Local 2', catalogo: [{ sku: 'S', nombre: 'Té', precio: 1990 }]
})[0].codigo, '');

/* ── 4. visor 3D ─────────────────────────────────────────────────────────── */
console.log('\nVisor 3D · código real');
ok('la ficha lee p.codigo', /String\(p\.codigo \|\| ""\)\.trim\(\)/.test(T3D));
ok('dibuja EAN-13 sólo si tiene 13 dígitos', /\^\\d\{13\}\$\/\.test\(codigo\)/.test(T3D));
ok('dejó de inventar códigos', !/Mercado\.codigoDe\(p\)/.test(T3D));
ok('CSS del código textual', /\.t3d-ficha-barra \.t3d-ficha-cod \{/.test(CSS));

/* ── 5. validación GS1 compartida ────────────────────────────────────────── */
console.log('\nEscáner · mismas reglas que el servidor');
igual('EAN-13 válido', Scan.eanValido('4006381333931'), true);
igual('EAN-13 con checksum roto', Scan.eanValido('4006381333932'), false);
igual('EAN-8 válido', Scan.eanValido('96385074'), true);
igual('UPC-A válido', Scan.eanValido('036000291452'), true);
igual('normaliza espacios y guiones', Scan.normalizarCodigo('4006 3813-3393 1'), '4006381333931');
igual('Code 128 con dígitos', Scan.pareceCodigo('ABC123'), true);
igual('texto sin dígitos no es código', Scan.pareceCodigo('ABCDEF'), false);
igual('un EAN-13 roto no se acepta', Scan.pareceCodigo('4006381333932'), false);

/* ── 6. caché ────────────────────────────────────────────────────────────── */
console.log('\nCaché · versión del service worker');
const version = Number((SW.match(/fcore-v(\d+)/) || [])[1] || 0);
ok('versión de la Fase 2 o posterior', version >= 94, 'fcore-v' + version);

console.log('\n' + (fallos ? '\x1b[1;31m' : '\x1b[1;32m') +
  (fallos ? '✖ ' + fallos + ' fallo(s)' : '✔ ' + pasos + ' comprobaciones OK') +
  '\x1b[0m\n');
process.exit(fallos ? 1 : 0);
