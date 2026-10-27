#!/usr/bin/env node
/* Pruebas del escáner y de la wiki de productos.
 *
 * Se carga el código real (no una copia) con un `window` mínimo: los dos
 * módulos exponen sus funciones puras justamente para poder probarlas sin
 * cámara y sin red. Lo que se comprueba aquí es lo que rompe en silencio:
 *
 *   · un checksum GS1 mal calculado (el escáner aceptaría cualquier número);
 *   · una categoría de Open Food Facts que no cae en el inventario;
 *   · un nombre con HTML que se cuela en la ficha (XSS);
 *   · un producto sin campos que revienta el normalizador.
 *
 * Uso: node tests/web/escaneo.js
 */
'use strict';

const path = require('path');

global.window = {};
global.document = {
  querySelector: () => null,
  getElementById: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }),
  addEventListener() {},
  head: { appendChild() {} },
  body: { appendChild() {}, classList: { add() {}, remove() {} } },
};
// Node 22+ ya trae `navigator` como getter de sólo lectura: hay que redefinirlo.
Object.defineProperty(global, 'navigator', {
  value: { mediaDevices: null }, configurable: true, writable: true,
});
global.location = { protocol: 'https:', hostname: 'fabri-core-web.vercel.app' };

require(path.join(__dirname, '..', '..', 'web', 'app', 'core-scan.js'));
require(path.join(__dirname, '..', '..', 'web', 'app', 'core-wiki.js'));

const Scan = global.window.Scan;
const Wiki = global.window.Wiki;

let fallos = 0;
const ok = (nombre, cond, detalle) => {
  if (cond) console.log('  \x1b[1;32m✔\x1b[0m ' + nombre);
  else { fallos++; console.log('  \x1b[1;31m✖\x1b[0m ' + nombre + (detalle ? ' → ' + detalle : '')); }
};

console.log('\n▸ escáner · códigos');

/* 1 · Dígito verificador GS1: EAN-8, UPC-A y EAN-13 reales. */
{
  const validos = ['3017620422003', '7790895000997', '96385074', '036000291452'];
  const invalidos = ['3017620422004', '12345678', '7801610001015', '1234567890123'];
  const malos = validos.filter(c => !Scan.eanValido(c));
  const colados = invalidos.filter(c => Scan.eanValido(c));
  ok('acepta los ' + validos.length + ' códigos GS1 válidos', malos.length === 0, malos.join(', '));
  ok('rechaza los ' + invalidos.length + ' con checksum roto', colados.length === 0, colados.join(', '));
  ok('un código mal tecleado no llega a la API', Scan.eanValido('7801610001015') === false);
}

/* 2 · Normalización de lo que se teclea o se pega. */
{
  ok('quita espacios, guiones y puntos', Scan.normalizarCodigo(' 3017-620 422.003 ') === '3017620422003',
    Scan.normalizarCodigo(' 3017-620 422.003 '));
  ok('pasa a mayúsculas un Code 128', Scan.normalizarCodigo('abc-123') === 'ABC123',
    Scan.normalizarCodigo('abc-123'));
}

/* 3 · `pareceCodigo` es el portero: ni basura ni códigos de 2 dígitos. */
{
  ok('rechaza un texto cualquiera', Scan.pareceCodigo('hola mundo') === false);
  ok('rechaza demasiado corto', Scan.pareceCodigo('123') === false);
  ok('acepta un Code 128 alfanumérico', Scan.pareceCodigo('AB-123456') === true);
  ok('rechaza un EAN-13 con checksum roto', Scan.pareceCodigo('3017620422004') === false);
  ok('acepta el EAN-13 correcto', Scan.pareceCodigo('3017620422003') === true);
}

console.log('\n▸ wiki · ficha de producto');

const OFF = {
  code: '3017620422003',
  product_name: 'Nutella',
  brands: 'Ferrero, Nutella',
  quantity: '400 g',
  categories_tags: ['en:spreads', 'en:sweet-spreads', 'en:chocolate-spreads'],
  image_front_small_url: 'https://images.openfoodfacts.org/images/products/301/762/042/2003/front_es.400.jpg',
  nutriscore_grade: 'e',
  nova_group: 4,
  ingredients_text_es: 'Azúcar, aceite de palma, avellanas 13%, cacao desgrasado en polvo.',
  allergens_tags: ['en:milk', 'en:nuts'],
  labels_tags: ['en:no-gluten', 'en:vegetarian'],
};

/* 4 · El normalizador deja el producto con la forma de la app. */
{
  const p = Wiki.normalizar(OFF, { id: 'food', nombre: 'Open Food Facts', url: 'https://world.openfoodfacts.org' });
  ok('toma el nombre', p.nombre === 'Nutella', p.nombre);
  ok('toma la primera marca', p.marca === 'Ferrero', p.marca);
  ok('conserva la cantidad', p.cantidad === '400 g', p.cantidad);
  ok('traduce la categoría al inventario', p.categoria === 'dulces', p.categoria);
  ok('normaliza el Nutri-Score', p.nutri === 'e', p.nutri);
  ok('normaliza NOVA', p.nova === 4, String(p.nova));
  ok('limpia los alérgenos', p.alergenos.join(',') === 'milk,nuts', p.alergenos.join(','));
  ok('arma la URL de la ficha original', /openfoodfacts\.org\/product\/3017620422003/.test(p.url), p.url);
  ok('guarda de qué fuente vino', p.fuente === 'food', p.fuente);
}

/* 5 · Categorías: el filtro de la app depende de esto. */
{
  const cat = (tags, nombre) => Wiki.categoriaInv({ categories_tags: tags, product_name: nombre });
  ok('una bebida cae en bebidas', cat(['en:beverages', 'en:sodas'], 'Coca-Cola') === 'bebidas');
  ok('un yogur cae en lácteos', cat(['en:dairies', 'en:yogurts'], 'Yogur natural') === 'lacteos');
  ok('un detergente cae en limpieza', cat(['en:cleaning-products'], 'Detergente') === 'limpieza');
  ok('una cerveza cae en alcohol', cat(['en:beers'], 'Cerveza') === 'alcohol');
  ok('lo desconocido cae en otros', cat([], 'Cosa rara') === 'otros');
}

/* 6 · Grados y NOVA: valores fuera de rango se descartan, no se pintan. */
{
  ok('Nutri-Score válido', Wiki.grado('B') === 'b');
  ok('Nutri-Score «unknown» se descarta', Wiki.grado('unknown') === '');
  ok('NOVA válido', Wiki.nova('3') === 3);
  ok('NOVA 9 se descarta', Wiki.nova(9) === 0);
  ok('NOVA vacío se descarta', Wiki.nova(null) === 0);
}

/* 7 · Un producto incompleto no puede reventar la ficha. */
{
  const p = Wiki.normalizar({ code: '12345670' }, { id: 'food', nombre: 'Open Food Facts', url: 'https://world.openfoodfacts.org' });
  ok('sin nombre usa un texto de respaldo', p && p.nombre === 'Producto sin nombre', p && p.nombre);
  ok('sin imagen deja cadena vacía', p && p.imagen === '');
  ok('sin categorías cae en otros', p && p.categoria === 'otros');
  ok('sin producto devuelve null', Wiki.normalizar(null) === null);
}

/* 8 · La ficha escapa el HTML: un nombre con etiquetas no debe ejecutarse. */
{
  const p = Wiki.normalizar({ code: '12345670', product_name: '<img src=x onerror=alert(1)>' });
  const html = Wiki.ficha(p);
  ok('el nombre no inyecta HTML', !/<img src=x/.test(html) && /&lt;img/.test(html));
  ok('la ficha muestra el código', html.includes('12345670'));
  ok('la ficha tiene botón para usar en inventario', html.includes('data-wiki-usar="12345670"'));
}

console.log('');
if (fallos) {
  console.log('\x1b[1;31m✖ escáner y wiki: ' + fallos + ' fallo(s)\x1b[0m');
  process.exit(1);
}
console.log('\x1b[1;32m✔ escáner y wiki: todo en orden\x1b[0m');
