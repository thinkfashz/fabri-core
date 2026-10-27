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

console.log('\n▸ respaldo ZXing · decodifica un EAN-13 de verdad');

/* 9 · Cargar el respaldo no basta: tiene que leer. Se genera un EAN-13 real
       (patrones L/G/R, guardas y dígito verificador) y se pasa por el mismo
       camino que usa el escáner. Esto cazó que `RGBLuminanceSource` trata un
       Uint8ClampedArray como gris de 1 byte por píxel: el fotograma RGBA iba
       4× desalineado y no decodificaba nunca. */
{
  const Z = require(path.join(__dirname, '..', '..', 'web', 'app', 'vendor', 'zxing.min.js'));

  const L = ['0001101', '0011001', '0010011', '0111101', '0100011',
    '0110001', '0101111', '0111011', '0110111', '0001011'];
  const R = ['1110010', '1100110', '1101100', '1000010', '1011100',
    '1001110', '1010000', '1000100', '1001000', '1110100'];
  const G = R.map(p => p.split('').reverse().join(''));
  const PARIDAD = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
    'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

  const modulos = codigo => {
    const d = String(codigo).split('').map(Number);
    const paridad = PARIDAD[d[0]];
    let bits = '101';
    for (let i = 0; i < 6; i++) bits += paridad[i] === 'L' ? L[d[i + 1]] : G[d[i + 1]];
    bits += '01010';
    for (let i = 7; i < 13; i++) bits += R[d[i]];
    return bits + '101';
  };

  /** Dibuja el código en RGBA, con zona quieta y barras de 3 px. */
  const imagen = codigo => {
    const bits = modulos(codigo);
    const quieta = 12, escala = 3, alto = 120;
    const ancho = (bits.length + quieta * 2) * escala;
    const datos = new Uint8ClampedArray(ancho * alto * 4).fill(255);
    for (let y = 0; y < alto; y++) {
      for (let x = 0; x < ancho; x++) {
        const m = Math.floor(x / escala) - quieta;
        const negro = m >= 0 && m < bits.length && bits[m] === '1';
        const i = (y * ancho + x) * 4;
        const v = negro ? 0 : 255;
        datos[i] = datos[i + 1] = datos[i + 2] = v;
        datos[i + 3] = 255;
      }
    }
    return { datos, ancho, alto };
  };

  const img = imagen('3017620422003');
  ok('el EAN generado mide 95 módulos', modulos('3017620422003').length === 95);

  const lector = new Z.MultiFormatReader();
  const hints = new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13]);
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  lector.setHints(hints);

  // La vista Int32 es la que usa core-scan.js: 4 bytes por elemento.
  const vista = new Int32Array(img.datos.buffer, img.datos.byteOffset, img.ancho * img.alto);
  const fuente = new Z.RGBLuminanceSource(vista, img.ancho, img.alto);
  const bitmap = new Z.BinaryBitmap(new Z.HybridBinarizer(fuente));
  let leido = '';
  try { leido = lector.decode(bitmap).getText(); } catch (e) { leido = 'error: ' + e.message; }
  ok('el respaldo decodifica el código', leido === '3017620422003', leido);

  // Con el RGBA crudo el array se interpreta como gris: no debe decodificar.
  let crudo = '';
  try {
    const f2 = new Z.RGBLuminanceSource(img.datos, img.ancho, img.alto);
    crudo = lector.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(f2))).getText();
  } catch (e) { crudo = ''; }
  ok('el RGBA crudo no decodifica (por eso va la vista Int32)', crudo !== '3017620422003');

  const escaner = require('fs').readFileSync(
    path.join(__dirname, '..', '..', 'web', 'app', 'core-scan.js'), 'utf8');
  ok('core-scan.js usa la vista Int32', /new Int32Array\(img\.data\.buffer/.test(escaner));
}

console.log('');
if (fallos) {
  console.log('\x1b[1;31m✖ escáner y wiki: ' + fallos + ' fallo(s)\x1b[0m');
  process.exit(1);
}
console.log('\x1b[1;32m✔ escáner y wiki: todo en orden\x1b[0m');
