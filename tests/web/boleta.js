#!/usr/bin/env node
/* Pruebas de la boleta de la web: totales y documento imprimible.
 *
 * No abre navegador: `core-pro.js` expone `invTotales` e `invBolDocumento`
 * porque son funciones puras. Se carga el archivo real (no una copia) con un
 * `window` mínimo, así la prueba falla si alguien rompe la aritmética.
 *
 * Uso: node tests/web/boleta.js
 */
'use strict';

const path = require('path');

// Entorno mínimo: core-pro.js sólo usa el DOM dentro de sus funciones de UI.
global.window = {};
global.document = { querySelector: () => null, getElementById: () => null, querySelectorAll: () => [] };

require(path.join(__dirname, '..', '..', 'web', 'app', 'core-pro.js'));
const Pro = global.window.Pro;

let fallos = 0;
const ok = (nombre, condicion, detalle) => {
  if (condicion) {
    console.log('  \x1b[1;32m✔\x1b[0m ' + nombre);
  } else {
    fallos++;
    console.log('  \x1b[1;31m✖\x1b[0m ' + nombre + (detalle ? ' → ' + detalle : ''));
  }
};
const casi = (a, b) => Math.abs(a - b) < 0.005;

console.log('\n▸ boleta de la web');

// 1 · Aritmética: el precio de venta es con IVA, así que el neto se despeja.
{
  const t = Pro.invTotales([
    { nombre: 'Bebida', precio: 1190, cantidad: 3 },
    { nombre: 'Pan', precio: 990, cantidad: 1 },
  ]);
  const bruto = 1190 * 3 + 990;
  ok('total = suma de precio × cantidad', casi(t.total, bruto), t.total + ' != ' + bruto);
  ok('neto = total ÷ 1,19', casi(t.neto, bruto / 1.19), t.neto + ' != ' + (bruto / 1.19));
  ok('iva = total − neto', casi(t.iva, bruto - bruto / 1.19), String(t.iva));
  ok('neto + iva vuelve al total', casi(t.neto + t.iva, t.total), String(t.neto + t.iva));
}

// 2 · Carrito vacío: cero, sin NaN ni división por cero.
{
  const t = Pro.invTotales([]);
  ok('carrito vacío da 0 y no NaN', t.total === 0 && t.iva === 0 && Number.isFinite(t.neto),
    JSON.stringify(t));
}

// 3 · Cantidades ausentes o basura no rompen la cuenta.
{
  const t = Pro.invTotales([
    { nombre: 'Suelto', precio: 500 },
    { nombre: 'Raro', precio: '1000', cantidad: '2' },
  ]);
  ok('cantidad ausente cuenta como 1', casi(t.total, 500 + 2000), String(t.total));
}

// 4 · El documento lleva los datos que la impresora necesita.
{
  const t = Pro.invTotales([{ nombre: 'Café <molido>', precio: 2500, cantidad: 2 }]);
  const html = Pro.invBolDocumento('80mm', t);
  ok('declara el ancho del papel', html.includes('size: 72mm auto'), 'sin @page 72mm');
  ok('incluye la línea del producto', html.includes('Café &lt;molido&gt; × 2'), 'sin línea');
  ok('escapa el HTML del nombre', !html.includes('Café <molido>'), 'nombre sin escapar');
  ok('muestra neto, IVA y total', /Neto/.test(html) && /IVA 19%/.test(html) && /Total/.test(html));
  ok('avisa que no es boleta tributaria', html.includes('no es boleta tributaria electrónica'));
}

// 5 · Los tres formatos cambian el ancho, no el contenido.
{
  const t = Pro.invTotales([{ nombre: 'X', precio: 1000, cantidad: 1 }]);
  const a = Pro.invBolDocumento('58mm', t);
  const b = Pro.invBolDocumento('a4', t);
  ok('58 mm usa 48 mm de ancho', a.includes('size: 48mm auto'), 'sin 48mm');
  ok('A4 usa 190 mm de ancho', b.includes('size: 190mm auto'), 'sin 190mm');
  ok('A4 no pierde el total', b.includes('$1.000'), 'sin total');
}

console.log(fallos === 0
  ? '\n\x1b[1;32m✔ boleta web: todo en orden\x1b[0m\n'
  : '\n\x1b[1;31m✖ boleta web: ' + fallos + ' fallo(s)\x1b[0m\n');
process.exit(fallos === 0 ? 0 : 1);
