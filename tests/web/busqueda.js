#!/usr/bin/env node
/* Pruebas de la Fase 4 del marketplace: búsqueda global de productos.
 *
 * Sin navegador ni red: se comprueba el contrato real del código.
 *   · una acción pública cruza todas las tiendas activas;
 *   · filtra por texto (nombre, categoría, SKU, código, marca), categoría y
 *     precio efectivo, y ordena por cercanía, precio o nombre;
 *   · la tienda viaja liviana (sin catálogo) y la distancia se calcula en SQL;
 *   · la hoja del mapa busca, muestra chips y salta a la ficha de la tienda;
 *   · el catálogo vacío ofrece buscar en todas las tiendas.
 *
 * Uso: node tests/web/busqueda.js
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

const api = leer('api-telefono/api/mercado.ts');
const placer = leer('web/app/placer.js');
const placerCss = leer('web/app/placer.css');
const index = leer('web/app/index.html');
const sw = leer('web/app/sw.js');

/* ── 1. servidor · contrato público ─────────────────────────────────────── */
console.log('\nServidor · contrato público');
ok('la acción está documentada en la cabecera',
  /accion=productos_buscar&q=<texto>&categoria=<c>&precio_max=<n>/.test(api));
ok('el tipo Busqueda declara texto, categoría, precio, coordenadas, orden y límite',
  /type Busqueda = \{[\s\S]*?q: string;[\s\S]*?categoria: string;[\s\S]*?precioMax: number;[\s\S]*?lat: number \| null;[\s\S]*?lon: number \| null;[\s\S]*?orden: string;[\s\S]*?limite: number;/.test(api));
ok('el texto se compara en minúsculas y sin acentos',
  /function plano\(s: string\): string/.test(api) &&
  /normalize\('NFD'\)/.test(api) &&
  /toLowerCase\(\)/.test(api));
ok('SQL usa translate() para ignorar acentos en la columna',
  /const SQL_PLANO = \(col: string\) =>/.test(api) &&
  /translate\(lower\(\$\{col\}\), 'áàäâãéèëêíìïîóòöôõúùüûñç'/.test(api));
ok('acepta los alias q/buscar y precio_max/precio',
  /texto\(c\.q \|\| c\.buscar, 60\)/.test(api) &&
  /entero\(c\.precio_max \|\| c\.precio, 100_000_000\)/.test(api));
ok('un texto de una sola letra no se busca', /q && q\.length < 2\) return null/.test(api));
ok('sin texto, categoría ni precio no se busca',
  /!q && !categoria && !precioMax\) return null/.test(api));
ok('valida latitud y longitud y trata null/vacío como sin ubicación',
  /function coordenada\(v: unknown, tope: number\): number \| null/.test(api) &&
  /typeof v !== 'number' && typeof v !== 'string'/.test(api) &&
  /coordenada\(c\.lat, 90\), lon = coordenada\(c\.lon, 180\)/.test(api));
ok('el orden aceptado es cercanía, precio, precio-desc y nombre',
  /\['cercania', 'precio', 'precio-desc', 'nombre'\]\.includes\(orden\)/.test(api));
ok('sin coordenadas cae a orden por precio',
  /orden = conCoords \? 'cercania' : 'precio'/.test(api) &&
  /if \(orden === 'cercania' && !conCoords\) orden = 'precio'/.test(api));
ok('el límite se acota a 60 y por defecto son 30',
  /Math\.min\(60, Math\.max\(1, entero\(c\.limite, 60\) \|\| 30\)\)/.test(api));

/* ── 2. servidor · filtros y orden ─────────────────────────────────────── */
console.log('\nServidor · filtros y orden');
ok('sólo entran locales activos', /const base: string\[\] = \['l\.activo = true'\]/.test(api));
ok('la consulta une productos con su local',
  /FROM \$\{T_PRODUCTOS\} p JOIN \$\{T_LOCALES\} l ON l\.id = p\.local_id/.test(api));
ok('el texto busca nombre, categoría, SKU, código, tienda y marca',
  /SQL_PLANO\('p\.nombre'\)/.test(api) &&
  /SQL_PLANO\('p\.categoria'\)/.test(api) &&
  /SQL_PLANO\('p\.sku'\)/.test(api) &&
  /SQL_PLANO\('p\.codigo'\)/.test(api) &&
  /SQL_PLANO\('l\.nombre'\)/.test(api) &&
  /SQL_PLANO\('l\.marca'\)/.test(api));
ok('los comodines % y _ se escapan',
  /plano\(op\.q\)\.replace\(\/\[\\\\%_\]\/g, '\\\\\$&'\)/.test(api));
ok('el precio máximo usa el precio efectivo con descuento',
  /\$\{precioEfectivo\('p\.'\)\} <= \$/.test(api) &&
  /if \(op\.precioMax > 0\)/.test(api));
ok('los chips de categoría se calculan sin el filtro de categoría',
  api.indexOf('const cats = await pool.query(') <
  api.indexOf("if (op.categoria) {", api.indexOf('const cats = await pool.query(')));
ok('la categoría se compara normalizada y por igualdad',
  /argsFiltro\.push\(plano\(op\.categoria\)\)/.test(api) &&
  /SQL_PLANO\('p\.categoria'\)\} = \$/.test(api));
ok('los chips devuelven hasta 8 categorías por frecuencia',
  /LIMIT 8/.test(api) && /ORDER BY n DESC, p\.categoria COLLATE "C"/.test(api));
ok('se cuentan productos y tiendas distintas',
  /COUNT\(\*\)::int AS n, COUNT\(DISTINCT l\.id\)::int AS tiendas/.test(api));
ok('la distancia es haversine en kilómetros',
  /6371 \* acos\(least\(1, greatest\(-1,/.test(api) &&
  /radians\(l\.lat\)/.test(api) && /radians\(l\.lon -/.test(api));
ok('la distancia se redondea a un decimal',
  /ROUND\(\(6371 \* acos\([\s\S]*?\)::numeric, 1\)::float8/.test(api));
ok('por cercanía ordena por distancia y deja los sin GPS al final',
  /dist_km ASC NULLS LAST/.test(api));
ok('por precio ordena ascendente y por nombre con COLLATE "C"',
  /\$\{precioEfectivo\('p\.'\)\} ASC, p\.nombre COLLATE "C"/.test(api));
ok('el orden descendente de precio también existe',
  /\$\{precioEfectivo\('p\.'\)\} DESC, p\.nombre COLLATE "C"/.test(api));
ok('el nombre como orden usa COLLATE "C"',
  /op\.orden === 'nombre'[\s\S]{0,80}p\.nombre COLLATE "C"/.test(api));
ok('una tienda cerrada se muestra al final del orden',
  /const abiertasPrimero = '\(l\.abierto = false\) ASC'/.test(api) &&
  (api.match(/\$\{abiertasPrimero\},/g) || []).length === 4);
ok('el límite se aplica en SQL', /LIMIT \$\{op\.limite\}/.test(api));
ok('la consulta usa las columnas con prefijo p.',
  /SELECT \$\{camposProducto\('p\.'\)\}/.test(api));

/* ── 3. servidor · respuesta y puertas ─────────────────────────────────── */
console.log('\nServidor · respuesta y puertas');
ok('la respuesta devuelve q, categoría, precio máximo y orden',
  /q: op\.q, categoria: op\.categoria, precio_max: op\.precioMax, orden: op\.orden/.test(api));
ok('la respuesta trae total, tiendas, categorías y resultados',
  /total: Number\(cuenta\.rows\[0\] && cuenta\.rows\[0\]\.n\)/.test(api) &&
  /tiendas: Number\(cuenta\.rows\[0\] && cuenta\.rows\[0\]\.tiendas\)/.test(api) &&
  /categorias: cats\.rows\.map/.test(api) &&
  /resultados: r\.rows\.map/.test(api));
ok('cada resultado lleva tienda, producto y distancia',
  /tienda: tiendaDe\(f\),[\s\S]{0,120}producto: productoDeFila\(f\),[\s\S]{0,120}dist:/.test(api));
const tiendaLiviana = api.slice(
  api.indexOf('const tiendaDe'),
  api.indexOf('return {', api.indexOf('const tiendaDe'))
);
ok('la tienda liviana no repite el catálogo',
  tiendaLiviana.length > 0 && /id: String\(f\.local_id/.test(tiendaLiviana) &&
  !/catalogo/.test(tiendaLiviana));
ok('la distancia nula se devuelve como null y la real con un decimal',
  /f\.dist_km === null \|\| f\.dist_km === undefined[\s\S]{0,60}\? null[\s\S]{0,120}Math\.round\(Number\(f\.dist_km\) \* 10\) \/ 10/.test(api));
ok('GET público responde 400 BUSQUEDA_CORTA',
  /url\.searchParams\.get\('accion'\) === 'productos_buscar'/.test(api) &&
  /codigo: 'BUSQUEDA_CORTA'/.test(api));
ok('GET responde 503 si falta la base',
  /if \(!process\.env\.INSFORGE_DATABASE_URL\)[\s\S]{0,140}codigo: 'SIN_BASE'/.test(api));
ok('POST público usa el mismo contrato para la APK',
  /if \(accion === 'productos_buscar'\) \{[\s\S]{0,700}const d = await buscarProductos\(pool, op\)/.test(api));
const postBusqueda = api.slice(
  api.indexOf("if (accion === 'productos_buscar')"),
  api.indexOf("if (accion === 'locales')")
);
ok('la búsqueda por POST no pasa por cuenta ni admin',
  postBusqueda.length > 0 && !/cuentaDe|esAdmin|autorizado/.test(postBusqueda));
ok('la acción aparece en el diagnóstico',
  /'codigo_buscar', 'productos_buscar'/.test(api));
ok('la búsqueda no crea tablas ni columnas',
  !/CREATE TABLE|ALTER TABLE|ADD COLUMN/.test(
    api.slice(api.indexOf('async function buscarProductos'), api.indexOf('/** Nombre público de quien opina'))
  ));

/* ── 4. web · hoja y menú ──────────────────────────────────────────────── */
console.log('\nWeb · hoja y menú');
ok('el menú del mapa tiene «Buscar productos»',
  /id="mpBuscarProdBtn"[\s\S]{0,220}Buscar productos/.test(index));
ok('la hoja de búsqueda existe y está oculta al inicio',
  /<div class="mp-hoja" id="mpBuscarProd" hidden>/.test(index));
ok('la hoja tiene fondo, cierre y título accesible',
  /id="mpBuscarProdFondo"/.test(index) &&
  /id="mpBuscarProdX"/.test(index) &&
  /aria-labelledby="mpBuscarProdTit"/.test(index));
ok('el formulario tiene texto, precio máximo y botón',
  /id="mpBusForm"/.test(index) && /id="mpBusQ"/.test(index) &&
  /id="mpBusPrecio"/.test(index) && /class="mp-bus-go"/.test(index));
ok('el buscador promete producto, marca y código',
  /placeholder="Producto, marca o código…"/.test(index));
ok('hay chips de orden Cerca, Precio y Nombre',
  /data-orden="cercania"[^>]*>Cerca</.test(index) &&
  /data-orden="precio"[^>]*>Precio</.test(index) &&
  /data-orden="nombre"[^>]*>Nombre</.test(index));
ok('hay contenedores para categorías y resultados',
  /id="mpBusCats"/.test(index) && /id="mpBusRes" aria-live="polite"/.test(index));

/* ── 5. web · consulta y estado ────────────────────────────────────────── */
console.log('\nWeb · consulta y estado');
ok('el estado guarda texto, categoría, precio, orden y sello',
  /bus: \{ q: "", categoria: "", precio: "", orden: "", cargando: false, sello: 0, reloj: null, datos: null, error: "" \}/.test(placer));
ok('abrir la búsqueda cierra las otras hojas',
  /function abrirBusquedaGlobal\(texto\)[\s\S]{0,260}cerrarHoja\(\);[\s\S]{0,120}cerrarCodigos\(\);[\s\S]{0,120}cerrarCarrito\(\);[\s\S]{0,120}cerrarPago\(\);/.test(placer));
ok('la consulta exige 2 letras, categoría o precio',
  /b\.q\.length < 2 && !b\.categoria && !precio/.test(placer));
ok('la consulta usa productos_buscar y límite 60',
  /params\.set\("accion", "productos_buscar"\)/.test(placer) &&
  /params\.set\("limite", "60"\)/.test(placer));
ok('manda texto, categoría, precio y orden cuando existen',
  /if \(b\.q\) params\.set\("q", b\.q\)/.test(placer) &&
  /if \(b\.categoria\) params\.set\("categoria", b\.categoria\)/.test(placer) &&
  /if \(precio\) params\.set\("precio_max", String\(precio\)\)/.test(placer) &&
  /if \(b\.orden\) params\.set\("orden", b\.orden\)/.test(placer));
ok('manda la ubicación del mapa para ordenar por cercanía',
  /const pos = ESTADO\.pos/.test(placer) &&
  /params\.set\("lat", String\(pos\.lat\)\)/.test(placer) &&
  /params\.set\("lon", String\(pos\.lon\)\)/.test(placer));
ok('el estado se lee de los campos y se recorta',
  /ESTADO\.bus\.q = q \? q\.value\.trim\(\) : ""/.test(placer));
ok('un precio vacío o cero no filtra',
  /if \(ESTADO\.bus\.precio === "0"\) ESTADO\.bus\.precio = ""/.test(placer));
ok('hay retardo de 420 ms al escribir',
  /\}, 420\);/.test(placer) && /setTimeout\(\(\) => \{[\s\S]{0,80}consultarBusquedaGlobal/.test(placer));
ok('una respuesta vieja no pisa a la nueva',
  /const sello = \+\+b\.sello/.test(placer) &&
  /if \(sello !== b\.sello\) return/.test(placer));
ok('el orden efectivo que devuelve el servidor se recuerda',
  /if \(d\.orden\) b\.orden = d\.orden/.test(placer));
ok('un error se muestra con botón de reintento',
  /b\.error = \(e && e\.message\)/.test(placer) && /id="mpBusReintentar"/.test(placer));
ok('los chips de categoría se pintan desde el servidor y conservan el resto',
  /d && Array\.isArray\(d\.categorias\) \? d\.categorias : \[\]/.test(placer) &&
  /b\.categoria = c\.dataset\.c \|\| "";[\s\S]{0,80}consultarBusquedaGlobal\(\)/.test(placer));
ok('el chip Cerca se desactiva sin ubicación',
  /c\.disabled = !conPos/.test(placer) &&
  /Activa tu ubicación para ordenar por cercanía/.test(placer));

/* ── 6. web · resultados y salto a la tienda ───────────────────────────── */
console.log('\nWeb · resultados y salto a la tienda');
ok('el resultado muestra producto, tienda y comuna',
  /esc\(p\.nombre \|\| "Producto"\)/.test(placer) &&
  /esc\(t\.nombre \|\| "Marca"\)/.test(placer) &&
  /t\.comuna \? " · " \+ esc\(t\.comuna\)/.test(placer));
ok('el resultado usa el precio efectivo y el descuento vigente',
  /p\.precio_efectivo != null/.test(placer) &&
  /Number\(p\.descuento_vigente\)/.test(placer));
ok('el stock se describe en palabras',
  /Number\(p\.stock\) <= 0 \? "agotado"/.test(placer) &&
  /"quedan " \+ p\.stock/.test(placer));
ok('una tienda cerrada se marca en la tarjeta',
  /t\.abierto === false \? " · <em>cerrada<\/em>"/.test(placer));
ok('la distancia se muestra en metros o kilómetros con coma',
  /function kmTxt\(km\)/.test(placer) &&
  /toFixed\(1\)\.replace\("\.", ","\) \+ " km"/.test(placer) &&
  /Math\.max\(10, Math\.round\(n \* 1000 \/ 10\) \* 10\) \+ " m"/.test(placer));
ok('los resultados se ordenan en una lista con resumen',
  /class="mp-bus-resumen"/.test(placer) && /class="mp-cod-lista"/.test(placer));
ok('si no hay resultados se explica qué cambiar',
  /Ninguna tienda activa tiene eso con ese precio/.test(placer));
ok('si se supera el tope se avisa cuántos se ven',
  /Se muestran los primeros /.test(placer) && /Afina la búsqueda para ver el resto/.test(placer));
ok('cada resultado abre la ficha de su tienda',
  /function abrirTiendaDesdeBusqueda\(r\)/.test(placer) &&
  /abrirTiendaDesdeBusqueda\(lista\[Number\(a\.dataset\.i\)\]\)/.test(placer));
ok('si la tienda no estaba cargada se pide local_ver',
  /accion=local_ver&id=/.test(placer) &&
  /registrarLocal\(d\.tienda\)/.test(placer));
ok('si la red falla se abre con el producto del resultado',
  /Object\.assign\(\{\}, m \|\| t, \{ forge: true, catalogo: \[r\.producto\] \}\)/.test(placer));
ok('al saltar se cierra la búsqueda y se filtra el catálogo por el producto',
  /cerrarBusquedaGlobal\(\);[\s\S]{0,120}abrirHoja\(m\);/.test(placer) &&
  /ESTADO\.cat\.q = nombre/.test(placer));
ok('el catálogo vacío ofrece buscar en todas las tiendas',
  /data-buscar-global>Buscar en todas las tiendas/.test(placer) &&
  /abrirBusquedaGlobal\(ESTADO\.cat\.q\)/.test(placer));
ok('la hoja se cierra con ✕, fondo y Escape',
  /if \(busX\) busX\.onclick = cerrarBusquedaGlobal/.test(placer) &&
  /if \(busFondo\) busFondo\.onclick = cerrarBusquedaGlobal/.test(placer) &&
  /const bus = \$\("mpBuscarProd"\);[\s\S]{0,80}cerrarBusquedaGlobal\(\)/.test(placer));
ok('cerrarTodo también cierra la búsqueda',
  /cerrarTodo: \(\) => \{ cerrarBusquedaGlobal\(\);/.test(placer));

/* ── 7. estilos y caché ────────────────────────────────────────────────── */
console.log('\nEstilos y caché');
ok('el formulario tiene estilos propios',
  /\.mp-bus-form \{/.test(placerCss) &&
  /\.mp-bus-q, \.mp-bus-precio \{/.test(placerCss) &&
  /\.mp-bus-go \{/.test(placerCss));
ok('los chips de orden y su estado deshabilitado están estilados',
  /\.mp-bus-orden \{/.test(placerCss) &&
  /\.mp-bus-orden \.mp-chip:disabled \{/.test(placerCss));
ok('el resumen, la espera y el tope tienen estilos',
  /\.mp-bus-resumen \{/.test(placerCss) &&
  /\.mp-bus-espera \{/.test(placerCss) &&
  /\.mp-bus-punto \{/.test(placerCss) &&
  /\.mp-bus-tope \{/.test(placerCss));
ok('el botón del catálogo vacío tiene estilos',
  /\.mp-vacio-btn \{/.test(placerCss));
ok('la animación de espera respeta movimiento reducido',
  /prefers-reduced-motion: reduce[\s\S]{0,260}\.mp-bus-punto \{ animation: none; \}/.test(placerCss));
ok('el icono de la cabecera se dimensiona dentro de su caja',
  /\.mp-hoja-ico > svg \{ width: 22px; height: 22px;/.test(placerCss));
ok('el service worker subió de versión para limpiar la caché',
  /fcore-v97/.test(sw));

console.log(fallos
  ? '\n\x1b[1;31m✖ ' + fallos + ' fallo(s) de ' + pasos + '\x1b[0m\n'
  : '\n\x1b[1;32m✔ ' + pasos + ' comprobaciones OK\x1b[0m\n');
process.exit(fallos ? 1 : 0);
