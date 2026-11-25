#!/usr/bin/env node
/* Pruebas de fotos de producto (Fase 1 del marketplace).
 *
 * Sin navegador ni red: se comprueba el contrato del código real.
 *   · la API guarda la foto como data URL y publica una URL versionada;
 *   · `productos_subir` conserva la foto si el lote no la trae;
 *   · `imagen_ver` responde binario, inmutable y con CORS;
 *   · el panel achica la foto a 640 px y sólo manda `imagen` si se tocó;
 *   · el catálogo, el carrito y la ficha 3D muestran la foto;
 *   · el service worker sube de versión para no servir CSS viejo.
 *
 * Uso: node tests/web/fotos.js
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
  Fabri: { q: () => [], toast: () => {}, go: () => {} },
  location: { origin: 'https://forge-core-stock.vercel.app' },
  addEventListener: () => {},
  matchMedia: () => ({ matches: false }),
  setTimeout: (fn) => { /* sin temporizadores en la prueba */ }
};

require(path.join(RAIZ, 'web', 'app', 'negocio.js'));
require(path.join(RAIZ, 'web', 'app', 'placer.js'));
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
console.log('\nAPI · foto de producto');
ok('columna imagen en la tabla', /imagen\s+TEXT NOT NULL DEFAULT ''/.test(API));
ok('columna imagen_hash en la tabla', /imagen_hash\s+TEXT NOT NULL DEFAULT ''/.test(API));
ok('ALTER para bases ya creadas',
  /ALTER TABLE \$\{T_PRODUCTOS\} ADD COLUMN IF NOT EXISTS imagen TEXT/.test(API) &&
  /ADD COLUMN IF NOT EXISTS imagen_hash TEXT/.test(API));
ok('tope de caracteres', /MAX_IMAGEN = 220_000/.test(API));
ok('tope de bytes servidos', /MAX_IMAGEN_BYTES = 160_000/.test(API));
ok('acepta JPEG, PNG y WebP',
  /image\\\/\(\?:jpeg\|png\|webp\)/.test(API));
ok('normaliza y rechaza data URL inválidos', /function normalizarImagen/.test(API));
ok('verifica el peso decodificado',
  /b64\.length \* 3\) \/ 4\) > MAX_IMAGEN_BYTES/.test(API));
ok('hash corto de 12 hex', /digest\('hex'\)\.slice\(0, 12\)/.test(API));

console.log('\nAPI · catálogo con URL versionada');
ok('la consulta trae imagen_hash', /imagen_hash`/.test(API));
ok('productoDeFila arma la URL de imagen', /accion=imagen_ver&local_id=/.test(API));
ok('la URL lleva el hash de versión', /'&v=' \+[\s\S]{0,80}imagen_hash/.test(API));
ok('el catálogo no manda el data URL', !/imagen: f\.imagen\b/.test(API));

console.log('\nAPI · alta que conserva la foto');
ok('detecta si el lote trae imagen', /'imagen' in p/.test(API));
ok('guarda imagen, hash, galería y destacado en el INSERT',
  /\(local_id,sku,nombre,precio,stock,categoria,unidad,actualizado,descuento,oferta_hasta,imagen,imagen_hash,codigo,imagenes,destacado\)/.test(API) &&
  /imagenes = CASE WHEN \(\$3::jsonb->>'toca_imagenes'\)::boolean THEN EXCLUDED\.imagenes/.test(API) &&
  /destacado = CASE WHEN \(\$3::jsonb->>'toca_destacado'\)::boolean THEN EXCLUDED\.destacado/.test(API));
ok('conserva la foto cuando no se toca',
  /imagen = CASE WHEN \(\$3::jsonb->>'toca_imagen'\)::boolean THEN EXCLUDED\.imagen[\s\S]{0,80}ELSE \$\{T_PRODUCTOS\}\.imagen END/.test(API));
ok('conserva el hash cuando no se toca',
  /imagen_hash = CASE WHEN \(\$3::jsonb->>'toca_imagen'\)::boolean THEN EXCLUDED\.imagen_hash[\s\S]{0,100}ELSE \$\{T_PRODUCTOS\}\.imagen_hash END/.test(API));

console.log('\nAPI · imagen_ver');
ok('acción pública en GET', /searchParams\.get\('accion'\) === 'imagen_ver'/.test(API));
ok('responde el Content-Type real', /'Content-Type': m\[1\]/.test(API));
ok('cache inmutable', /public, max-age=31536000, immutable/.test(API));
ok('no permite adivinar el tipo', /'X-Content-Type-Options': 'nosniff'/.test(API));
ok('CORS para la web', /'Access-Control-Allow-Origin': '\*'/.test(API));
ok('404 cuando no hay foto', /if \(!m\) \{[\s\S]{0,120}404/.test(API));

console.log('\nAPI · pedido con foto');
ok('el ítem del pedido lleva imagen', /imagen: enCat\.imagen \|\| ''/.test(API));
ok('el snapshot del pedido conserva la foto',
  /imagen: x\.imagen \|\| ''/.test(API));

/* ── 2. panel del vendedor ───────────────────────────────────────────────── */
console.log('\nPanel · compresión y formulario');
ok('existe achicarFoto', /function achicarFoto\(file\)/.test(NEG));
ok('lado máximo de 640 px', /FOTO_PX = 640/.test(NEG));
ok('JPEG 0.7 y respaldo 0.5',
  /toDataURL\("image\/jpeg", 0\.7\)/.test(NEG) && /toDataURL\("image\/jpeg", 0\.5\)/.test(NEG));
ok('tope del navegador bajo el de la API', /MAX_FOTO = 200 \* 1024/.test(NEG));
ok('estado de la foto con tres significados', /prodImagen: undefined/.test(NEG));
ok('sólo manda imagen si se tocó', /if \(EST\.prodImagen !== undefined\) producto\.imagen = EST\.prodImagen/.test(NEG));
ok('editar conserva la foto guardada', /EST\.prodImagen = undefined;\s+\/\/ conserva/.test(NEG));
ok('quitar deja la foto vacía', /EST\.prodImagen = ""/.test(NEG));
ok('input de foto en el HTML', /id="negProdFotoFile"/.test(HTML));
ok('vista previa en el HTML', /id="negProdFotoPrev"/.test(HTML));
ok('botón quitar en el HTML', /id="negProdFotoQuitar"/.test(HTML));
ok('miniatura en la lista del panel', /class="neg-prod-foto"/.test(NEG));
ok('la miniatura usa la URL del servidor', /<img src="' \+ esc\(p\.imagen\)/.test(NEG));
ok('el pedido del panel muestra la miniatura', /class="neg-ped-foto"/.test(NEG));
ok('CSS de la miniatura del pedido', /\.neg-ped-foto \{/.test(CSS));
ok('la lista reserva la columna de la foto', /grid-template-columns: auto 1fr auto auto/.test(CSS));

/* ── 3. catálogo del comprador ───────────────────────────────────────────── */
console.log('\nComprador · catálogo y carrito');
ok('productos() expone la imagen', /imagen: it\.imagen \|\| ""/.test(PL));
ok('la tarjeta pinta la foto', /class="mp-prod-foto"/.test(PL));
ok('la foto reemplaza la letra', /p\.imagen\s+\? '<img class="mp-prod-foto"/.test(PL));
ok('CSS de la foto en la tarjeta', /\.mp-prod-ico\.con-foto/.test(PCSS) && /\.mp-prod-foto \{/.test(PCSS));
ok('el carrito guarda la foto', /i: prod\.imagen \|\| \(enCatalogo && enCatalogo\.imagen\) \|\| ""/.test(PL));
ok('itemsDe devuelve la foto', /imagen: it\.i \|\| \(enCat && enCat\.imagen\) \|\| ""/.test(PL));
ok('carritos viejos completan la foto', /const enCat = it\.i \? null : productos\(m\)\.find/.test(PL));
ok('el carrito pinta la miniatura', /class="mp-car-foto"/.test(PL));
ok('CSS de la miniatura del carrito', /\.mp-car-foto \{/.test(PCSS));
ok('el visor pasa la foto al carrito', /imagen: \(enCat && enCat\.imagen\) \|\| p\.imagen \|\| ""/.test(PL));

console.log('\nVisor 3D · ficha con foto');
ok('la ficha tiene un img', /id="t3dFichaFoto"/.test(HTML));
ok('la ficha muestra la foto', /foto\.src = p\.imagen/.test(T3D));
ok('sin foto dibuja la etiqueta', /img\.getContext && !p\.imagen/.test(T3D));
ok('CSS de la foto en la ficha',
  /\.t3d-ficha-img img \{/.test(CSS) && /img\[hidden\], \.t3d-ficha-img canvas\[hidden\]/.test(CSS));

/* ── 4. prueba funcional del catálogo ────────────────────────────────────── */
console.log('\nFuncional · catálogo normalizado');
const FOTO = 'https://fabri-api.vercel.app/api/mercado?accion=imagen_ver&local_id=local-1&sku=SKU-1&v=abc123';
const prods = P._test.productos({
  id: 'local-1', nombre: 'Local 1', catalogo: [
    { sku: 'SKU-1', nombre: 'Café', precio: 2990, precio_efectivo: 2990, stock: 5, imagen: FOTO },
    { sku: 'SKU-2', nombre: 'Té', precio: 1990, precio_efectivo: 1990, stock: 3 }
  ]
});
igual('la foto viaja al producto', prods[0].imagen, FOTO);
igual('sin foto queda vacío', prods[1].imagen, '');
igual('el precio no se altera', prods[0].precio, 2990);

/* ── 5. caché ────────────────────────────────────────────────────────────── */
console.log('\nCaché · versión del service worker');
const version = Number((SW.match(/fcore-v(\d+)/) || [])[1] || 0);
ok('versión de la Fase 1 o posterior', version >= 92, 'fcore-v' + version);

/* ── 6. compresión rechaza lo que no es imagen ───────────────────────────── */
(async () => {
  console.log('\nPanel · achicarFoto rechaza archivos que no son imagen');
  let mensaje = '';
  try {
    await N._test.achicarFoto({ type: 'text/plain' });
  } catch (e) {
    mensaje = e.message;
  }
  ok('rechaza texto plano', /foto/i.test(mensaje), mensaje);
  ok('achicarFoto está exportada', typeof N._test.achicarFoto === 'function');

  console.log('\n' + (fallos ? '\x1b[1;31m' : '\x1b[1;32m') +
    (fallos ? '✖ ' + fallos + ' fallo(s)' : '✔ ' + pasos + ' comprobaciones OK') +
    '\x1b[0m\n');
  process.exit(fallos ? 1 : 0);
})();
