#!/usr/bin/env node
/* FORGE CORE STOCK · motor de márgenes del inventario (APK)
 *
 * Un solo cálculo para la ficha, la tabla y el chat. Se comprueba:
 *   · margen sobre venta y markup sobre costo son cosas distintas;
 *   · sin costo el markup es «no calculable» (-1), no un 0 % falso;
 *   · el semáforo (malo/justo/bueno) es coherente con el margen;
 *   · el precio con IVA y la utilidad por stock salen del mismo motor;
 *   · el precio sugerido para un objetivo no divide por cero.
 *
 * Uso: node tests/web/margenes.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..', '..');
const src = fs.readFileSync(path.join(RAIZ, 'android/assets/www/inventario.js'), 'utf8');

let fallos = 0, pasos = 0;
const ok = (n, c, d) => { pasos++; if (c) console.log('  \x1b[1;32m✔\x1b[0m ' + n); else { fallos++; console.log('  \x1b[1;31m✖\x1b[0m ' + n + (d ? ' → ' + d : '')); } };

const ini = src.indexOf('function invMargenDe(p)');
const fin = src.indexOf('/** Precio sugerido', ini);
const bloque = src.slice(ini, fin);
const invClp = (n) => '$' + Math.round(Number(n) || 0);
const margen = new Function('invClp', bloque + '; return invMargenDe;')(invClp);

const objIni = src.indexOf('function invPrecioObjetivo(');
const objFin = src.indexOf('/** Explicación', objIni);
const objetivo = new Function(src.slice(objIni, objFin) + '; return invPrecioObjetivo;')();

console.log('\n▸ margen sobre venta vs markup');
const a = margen({ costo: 1000, precio: 1500, iva: 19, stock: 10 });
ok('margen sobre venta = 33,3 %', a.margen === 33.3, String(a.margen));
ok('markup sobre costo = 50 %', a.markup === 50, String(a.markup));
ok('no son el mismo número', a.margen !== a.markup);
ok('precio con IVA 19 % = 1.785', a.precio_con_iva === 1785, String(a.precio_con_iva));
ok('utilidad por 10 unidades = 5.000', a.utilidad === 5000, String(a.utilidad));

console.log('\n▸ casos límite');
const sinPrecio = margen({ costo: 1000, precio: 0, iva: 19, stock: 5 });
ok('sin precio el margen es 0 y el nivel malo', sinPrecio.margen === 0 && sinPrecio.nivel === 'malo');
const sinCosto = margen({ costo: 0, precio: 1000, iva: 19, stock: 1 });
ok('sin costo el markup es -1 (no calculable)', sinCosto.markup === -1, String(sinCosto.markup));
const perdida = margen({ costo: 2000, precio: 1500, iva: 19, stock: 3 });
ok('vender bajo costo da margen negativo', perdida.margen < 0 && perdida.nivel === 'malo');
ok('la pérdida por unidad es -500', perdida.ganancia === -500, String(perdida.ganancia));

console.log('\n▸ semáforo');
ok('margen 10 % es malo', margen({ costo: 900, precio: 1000 }).nivel === 'malo');
ok('margen 20 % es justo', margen({ costo: 800, precio: 1000 }).nivel === 'justo');
ok('margen 40 % es bueno', margen({ costo: 600, precio: 1000 }).nivel === 'bueno');

console.log('\n▸ precio sugerido');
ok('objetivo 30 % sobre costo 1.000 = 1.429', objetivo(1000, 30, 19) === 1429, String(objetivo(1000, 30, 19)));
ok('costo 0 no divide por cero', objetivo(0, 30, 19) === 0);
ok('objetivo 95 % o más se rechaza', objetivo(1000, 95, 19) === 0);

console.log('\n' + (fallos ? '\x1b[1;31m' : '\x1b[1;32m') +
  (fallos ? '✖ margenes: ' + fallos + ' fallo(s)' : '✔ margenes: ' + pasos + ' comprobaciones OK') + '\x1b[0m\n');
process.exit(fallos ? 1 : 0);
