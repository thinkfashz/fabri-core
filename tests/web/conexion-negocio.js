#!/usr/bin/env node
/* FORGE CORE STOCK · conexión APK / dispositivos (N18)
 *
 * La página conecta la app/APK con la tienda usando la MISMA clave de 8
 * caracteres que ya usaba /api/inventario. Esta prueba cuida que:
 *   · la clave no se pueda leer después de generada (sólo se muestra una vez);
 *   · el estado y los dispositivos salgan de la base, no de una lista fingida;
 *   · el verificador llame a la API real y distinga clave mala, red y 503;
 *   · el canvas sea 2D (funciona sin GPU), responsive y con movimiento reducido;
 *   · el panel exija sesión de dueño y no exponga datos sensibles.
 *
 * Uso: node tests/web/conexion-negocio.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');
const WEB = path.join(RAIZ, 'web');
const N18 = path.join(WEB, 'panel', 'negocio', 'conexion');
const INVENTARIO = path.join(RAIZ, 'api-telefono', 'api', 'inventario.ts');
const MERCADO = path.join(RAIZ, 'api-telefono', 'api', 'mercado.ts');

const leer = (p) => fs.readFileSync(p, 'utf8');
const existe = (p) => fs.existsSync(p);

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

console.log('\n▸ conexión · página y contrato');

{
  const html = leer(path.join(N18, 'index.html'));
  ok('N18 tiene index.html, .css y .js',
    ['index.html', 'conexion.css', 'conexion.js'].every((f) => existe(path.join(N18, f))));
  ok('declara el panel negocio y su módulo',
    /data-panel="negocio"/.test(html) && /data-modulo="conexion"/.test(html));
  ok('no se indexa', /name="robots" content="noindex/.test(html));
  ok('carga el shell y su propio JS', /comun\/shell\.js/.test(html) && /conexion\.js/.test(html));
}

/* 2 · La página está en el menú y no promete módulos inexistentes. */
{
  const nav = leer(path.join(WEB, 'panel', 'comun', 'nav-negocio.js'));
  ok('el menú del negocio enlaza Conexión', /\/panel\/negocio\/conexion\//.test(nav));
  ok('Conexión no está marcada como «pronto»',
    /conexion\/', texto: 'Conexión'[^}]*\}/.test(nav) &&
    !/conexion\/'[^}]*pronto/.test(nav));
}

/* 3 · Verificador: API real, estados honestos, sin guardar la clave. */
{
  const js = leer(path.join(N18, 'conexion.js'));
  ok('el verificador usa el puente de inventario con la clave',
    /inventarioPost\('verificar'/.test(js) &&
    /local_id: ctx\.tienda\.id/.test(js) && /clave/.test(js));
  ok('distingue clave mala, sin red y 503',
    /clave_mala/.test(js) && /SIN_RED/.test(js) && /status === 503/.test(js));
  ok('el puente vive en el cliente HTTP común (sin fetch suelto)',
    /export async function inventarioPost/.test(leer(path.join(WEB, 'panel', 'comun', 'api.js'))) &&
    !/fetch\(/.test(js));
  ok('mide la latencia real de la respuesta', /Date\.now\(\) - t0/.test(js));
  ok('la clave escrita no se guarda en localStorage',
    !/setItem[^;]*clave/i.test(js) && !/localStorage[^;]*clave/i.test(js));
  ok('la clave nueva vive sólo en memoria', /clave: '',/.test(js));
}

/* 4 · Estado y dispositivos: de la base, no inventados. */
{
  const js = leer(path.join(N18, 'conexion.js'));
  ok('pide el estado con la sesión del dueño', /llamar\('conexion_estado'/.test(js));
  ok('sin dispositivos muestra el vacío honesto', /Ningún dispositivo conectado todavía/.test(js));
  ok('el estado del dispositivo se calcula por su última conexión',
    /function estadoDe/.test(js) && /min <= 10/.test(js));
  ok('muestra los fallos reportados por la API', /estado\.errores/.test(js) && /Fallos recientes/.test(js));
  ok('no muestra correo ni hash de la clave',
    !/correo|email|clave_hash/.test(js));
}

/* 5 · Rotar clave: confirma, muestra una vez y desconecta. */
{
  const js = leer(path.join(N18, 'conexion.js'));
  ok('rotar exige confirmación explícita', /window\.confirm/.test(js) && /confirmar: true/.test(js));
  ok('avisa que los dispositivos anteriores quedan fuera',
    /dejarán de sincronizar|dejaron de sincronizar/.test(js));
  ok('permite copiar la clave nueva', /navigator\.clipboard\.writeText/.test(js));
}

/* 6 · Canvas 2D: sin GPU, responsive y con movimiento reducido. */
{
  const js = leer(path.join(N18, 'conexion.js'));
  ok('dibuja con canvas 2D (no depende de WebGL)', /getContext\('2d'\)/.test(js) && !/WebGLRenderer/.test(js));
  ok('se adapta al ancho y al DPR', /canvas\.clientWidth/.test(js) && /devicePixelRatio/.test(js));
  ok('cambia de disposición en pantallas angostas', /const vertical = w < 420/.test(js));
  ok('respeta prefers-reduced-motion', /prefers-reduced-motion/.test(js));
  ok('pausa con la pestaña oculta', /document\.hidden/.test(js));
  ok('libera la animación al salir', /cancelAnimationFrame/.test(js) && /destruir/.test(js));
  const css = leer(path.join(N18, 'conexion.css'));
  ok('el canvas tiene alto propio y media query',
    /#cnCanvas/.test(css) && /@media \(min-width: 860px\)/.test(css));
}

/* 7 · Backend: clave, estado y dispositivos. */
{
  const inv = leer(INVENTARIO);
  ok('el puente exige la clave de la tienda',
    /hashClave\(clave\) !== local\.clave_hash/.test(inv));
  ok('crea la tabla de conexiones', /CREATE TABLE IF NOT EXISTS \$\{T_CONEX\}/.test(inv) &&
    /inv_conexiones/.test(inv));
  ok('registra el dispositivo al sincronizar', /anotarDispositivo/.test(inv));
  ok('verifica sin registrar y estado registrando',
    /accion === 'verificar' \|\| accion === 'estado'/.test(inv));
  ok('guarda los fallos del dispositivo', /accion === 'error'/.test(inv) && /ultimo_error/.test(inv));
  ok('permite bajar un respaldo real del catálogo', /accion === 'respaldo'/.test(inv));
  ok('el respaldo no incluye la clave ni correo',
    !/clave_hash/.test(inv.slice(inv.indexOf("accion === 'respaldo'"), inv.indexOf("accion === 'resumen'"))));

  const mer = leer(MERCADO);
  ok('el dueño puede ver el estado por sesión', /accion === 'conexion_estado'/.test(mer) &&
    /autorizarLocal\(pool, req, localId/.test(mer));
  ok('rotar genera clave nueva y guarda sólo el hash',
    /accion === 'conexion_rotar'/.test(mer) && /clave_hash = \$2/.test(mer) &&
    /hashClave\(clave\)/.test(mer));
  ok('rotar limpia los dispositivos anteriores',
    /DELETE FROM inv_conexiones WHERE local_id/.test(mer));
  ok('rotar exige confirmar', /cuerpo\.confirmar !== true/.test(mer));
  ok('el estado no devuelve el hash ni el correo',
    !/clave_hash:/.test(mer) && !/dueno_id:/.test(mer));
}

/* 8 · La APK y la web comparten el mismo contrato. */
{
  const inv = leer(INVENTARIO);
  ok('el puente sigue siendo multi-inquilino por local_id',
    /PRIMARY KEY \(local_id, codigo\)/.test(inv) && /local_id, codigo/.test(inv));
  ok('la clave es la misma del mercado (no hay una segunda llave)',
    /createHash\('sha256'\)\.update\('mercado:' \+ clave\)/.test(inv));
  ok('las acciones nuevas están en el GET del puente',
    /'verificar', 'estado', 'error', 'desconectar', 'respaldo'/.test(inv));
}

console.log('\n' + (fallos ? '\x1b[1;31m' : '\x1b[1;32m') +
  (fallos ? '✖ conexion-negocio: ' + fallos + ' fallo(s)' : '✔ conexion-negocio: ' + pasos + ' comprobaciones OK') +
  '\x1b[0m\n');
process.exit(fallos ? 1 : 0);
