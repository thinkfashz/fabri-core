#!/usr/bin/env node
/* FORGE CORE STOCK · horario del negocio (N07)
 *
 * El horario viaja como texto libre de hasta 120 caracteres. Esta prueba
 * comprueba el contrato del parser y del serializador que usan N07 y la ficha:
 *   · el texto canónico se lee sin perder días ni franjas;
 *   · el parser tolera acentos, mayúsculas, "a"/"hasta" y separadores;
 *   · agrupa días consecutivos iguales y nunca supera los 120 caracteres;
 *   · un día cerrado no se confunde con "sin horario publicado";
 *   · las horas inválidas se detectan antes de mandar nada a la nube.
 *
 * Uso: node tests/web/horario-negocio.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');
const ARCHIVO = path.join(RAIZ, 'web', 'panel', 'negocio', 'horarios', 'horario.js');

let fallos = 0;
let pasos = 0;
const ok = (nombre, cond, detalle) => {
  pasos++;
  if (cond) console.log('  \x1b[1;32m✔\x1b[0m ' + nombre);
  else {
    fallos++;
    console.log('  \x1b[1;31m✖\x1b[0m ' + nombre + (detalle ? ' → ' + detalle : ''));
  }
};

/* horario.js es un módulo ES sin imports: se carga transformando los `export`
   para probar el MISMO código que corre el navegador, sin duplicarlo. */
const fuente = fs.readFileSync(ARCHIVO, 'utf8').replace(/^export /gm, '');
const H = new Function(fuente + '\nreturn { DIAS, leer, escribir, hoy, validar, normalizarHora, sugerencia, MAX_TEXTO };')();

const CANONICO = 'Lun-Vie 9:00-20:00; Sáb 10:00-14:00; Dom cerrado';

console.log('\n▸ horario del negocio · lectura tolerante');

{
  const dias = H.leer(CANONICO);
  ok('el texto canónico devuelve siete días', Array.isArray(dias) && dias.length === 7);
  ok('lunes a viernes quedan 09:00–20:00',
    [0, 1, 2, 3, 4].every((i) => dias[i].abierto && dias[i].desde === '09:00' && dias[i].hasta === '20:00'));
  ok('el sábado conserva su franja',
    dias[5].abierto && dias[5].desde === '10:00' && dias[5].hasta === '14:00');
  ok('el domingo queda cerrado', dias[6].abierto === false);
}

{
  const dias = H.leer('LUNES A VIERNES DE 9:00 A 19:30; sábado de 10 a 14; domingo cerrado');
  ok('tolera mayúsculas, acentos y "a" como separador',
    dias[0].abierto && dias[0].desde === '09:00' && dias[0].hasta === '19:30');
  ok('acepta horas sin minutos y las normaliza',
    dias[5].desde === '10:00' && dias[5].hasta === '14:00');
  ok('acepta "cerrado" en minúsculas', dias[6].abierto === false);
}

{
  const dias = H.leer('Lun, Mié 09:00-14:00; Jue 15:00-20:00');
  ok('agrupa días separados por coma', dias[0].abierto && dias[2].abierto && dias[2].desde === '09:00');
  ok('los días no mencionados quedan cerrados', dias[1].abierto === false && dias[6].abierto === false);
}

{
  ok('sin texto devuelve null (no "todo cerrado")', H.leer('') === null && H.leer('   ') === null);
}

console.log('\n▸ horario del negocio · escritura compacta');

{
  const dias = H.leer(CANONICO);
  const texto = H.escribir(dias);
  ok('vuelve al mismo texto canónico', texto === CANONICO, texto);
  ok('no supera el máximo de la API', texto.length <= H.MAX_TEXTO, texto.length + ' caracteres');
}

{
  const dias = H.leer(CANONICO);
  dias.forEach((d, i) => {
    d.abierto = true;
    d.desde = String(9 + i).padStart(2, '0') + ':00';
    d.hasta = String(10 + i).padStart(2, '0') + ':30';
  });
  const texto = H.escribir(dias);
  ok('siete franjas distintas caben en 120 caracteres', texto.length <= H.MAX_TEXTO, texto.length + ': ' + texto);
  const vuelta = H.leer(texto);
  ok('siete franjas distintas sobreviven la ida y vuelta',
    vuelta.every((d, i) => d.abierto && d.desde === dias[i].desde && d.hasta === dias[i].hasta));
}

{
  const todos = H.leer(CANONICO).map((d) => Object.assign({}, d, { abierto: false }));
  ok('todo cerrado se escribe en una sola frase', H.escribir(todos) === 'Lun-Dom cerrado', H.escribir(todos));
}

console.log('\n▸ horario del negocio · hoy y validación');

{
  const lunes = new Date(2026, 10, 16, 12, 0, 0);
  const h = H.hoy(H.leer(CANONICO), lunes);
  ok('el lunes muestra la franja del lunes', h.abierto && h.texto === '09:00 – 20:00', h.texto);
  const domingo = new Date(2026, 10, 22, 12, 0, 0);
  ok('el domingo se informa cerrado', H.hoy(H.leer(CANONICO), domingo).abierto === false);
}

{
  const dias = H.sugerencia();
  ok('la sugerencia parte con los siete días usables', dias.length === 7 && dias[0].abierto && !dias[6].abierto);
  ok('la sugerencia no tiene errores', H.validar(dias).length === 0);
  dias[0].desde = '20:00';
  dias[0].hasta = '09:00';
  ok('detecta un cierre anterior a la apertura', H.validar(dias).length === 1, JSON.stringify(H.validar(dias)));
}

{
  ok('normaliza 9 → 09:00', H.normalizarHora('9') === '09:00');
  ok('acepta 24:00 como medianoche', H.normalizarHora('24:00') === '24:00');
  ok('rechaza 25:00', H.normalizarHora('25:00') === '');
  const dias = H.leer('Lun 20:00-00:00');
  ok('no acepta medianoche como 00:00 al cerrar', H.validar(dias).length === 1);
}

console.log('\n' + (fallos ? '\x1b[1;31m' : '\x1b[1;32m') +
  (fallos ? '✖ horario-negocio: ' + fallos + ' fallo(s)' : '✔ horario-negocio: ' + pasos + ' comprobaciones OK') +
  '\x1b[0m\n');
process.exit(fallos ? 1 : 0);
