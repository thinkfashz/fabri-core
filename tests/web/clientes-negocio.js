#!/usr/bin/env node
/* FORGE CORE STOCK · CRM de clientes (N09)
 *
 * El CRM no tiene tabla propia: el cliente es quien compró. Esta prueba cuida
 * que:
 *   · la página exista, sea del panel Negocio y no se indexe;
 *   · use el cliente HTTP común (nada de fetch suelto) y la acción real;
 *   · nunca pida ni muestre el teléfono completo ni el correo del comprador;
 *   · la API agrupe por cuenta o por teléfono y devuelva un id opaco;
 *   · los estados vacíos sean honestos y el CSV se genere en el navegador.
 *
 * Uso: node tests/web/clientes-negocio.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');
const WEB = path.join(RAIZ, 'web');
const N09 = path.join(WEB, 'panel', 'negocio', 'clientes');
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

console.log('\n▸ CRM de clientes · página');

{
  const html = leer(path.join(N09, 'index.html'));
  ok('tiene index.html, .css y .js',
    ['index.html', 'clientes.css', 'clientes.js'].every((f) => existe(path.join(N09, f))));
  ok('declara el panel negocio y su módulo',
    /data-panel="negocio"/.test(html) && /data-modulo="clientes"/.test(html));
  ok('no se indexa', /name="robots" content="noindex/.test(html));
  ok('carga el shell y su propio JS',
    /comun\/shell\.js/.test(html) && /clientes\.js/.test(html));

  const nav = leer(path.join(WEB, 'panel', 'comun', 'nav-negocio.js'));
  ok('el menú enlaza Clientes sin «pronto»',
    /\/panel\/negocio\/clientes\//.test(nav) &&
    !/clientes\/'[^}]*pronto/.test(nav));
}

console.log('\n▸ CRM de clientes · contrato de la UI');

{
  const js = leer(path.join(N09, 'clientes.js'));
  ok('usa el cliente HTTP del panel (sin fetch suelto)',
    !/fetch\(/.test(js) && /llamar\('clientes_listar'/.test(js));
  ok('pide la tienda de la sesión', /local_id: ctx\.tienda\.id/.test(js));
  ok('busca y filtra por segmento', /segmento/.test(js) && /q:/.test(js));
  ok('muestra KPIs del resumen', /kpisHtml\(estado\.resumen\)/.test(js) && /gastado/.test(js));
  ok('la ficha muestra los últimos pedidos', /ultimos/.test(js));
  ok('los estados vacíos son honestos',
    /Todavía no hay clientes|aparecen cuando entra el primer pedido/.test(js));
  ok('exporta CSV en el navegador',
    /Blob/.test(js) && /createObjectURL/.test(js) && /revokeObjectURL/.test(js));
  ok('refresca sin duplicar intervalos', /clearInterval/.test(js) && /60000|60 \* 1000/.test(js));
  ok('no pide el teléfono completo ni el correo',
    !/telefonoVisible/.test(js) && !/\.correo|email/.test(js));
}

console.log('\n▸ CRM de clientes · API');

{
  const api = leer(MERCADO);
  const ini = api.indexOf("if (accion === 'clientes_listar')");
  ok('existe la acción clientes_listar', ini > 0);
  const bloque = api.slice(ini, ini + 4200);

  ok('exige dueño, clave o admin',
    /autorizarLocal\(pool, req, localId/.test(bloque));
  ok('agrupa por cuenta o por los últimos 8 del teléfono',
    /COALESCE\(NULLIF\(cliente_id, ''\), 'tel:'/.test(bloque) &&
    /right\(regexp_replace\(telefono, '\[\^0-9\]', '', 'g'\), 8\)/.test(bloque));
  ok('enmascara el teléfono (sólo últimos 4)',
    /'\*\*\*\* ' \+ tel\.slice\(-4\)/.test(bloque) || /'\*\*\*\* ' \+ tel\.slice\(-4\)/.test(api));
  ok('el id es opaco (hash), no el cliente_id',
    /createHash\('sha256'\)\.update\('cliente:' \+ r\.clave\)/.test(bloque));
  ok('no devuelve cliente_id, correo ni dueno_id',
    !/cliente_id:/.test(bloque) && !/email:/.test(bloque) && !/dueno_id:/.test(bloque));
  ok('calcula segmento y ticket',
    /'recurrente'/.test(bloque) && /'inactivo'/.test(bloque) && /ticket:/.test(bloque));
  ok('devuelve los últimos tres pedidos',
    /ROW_NUMBER\(\) OVER \(PARTITION BY/.test(bloque) && /rn <= 3/.test(bloque));
  const acciones = (api.match(/acciones:\s*\[([\s\S]*?)\]/) || [])[1] || '';
  ok('la acción está en la lista pública del GET', acciones.includes("'clientes_listar'"));
}

console.log('\n' + (fallos ? '\x1b[1;31m' : '\x1b[1;32m') +
  (fallos ? '✖ clientes-negocio: ' + fallos + ' fallo(s)' : '✔ clientes-negocio: ' + pasos + ' comprobaciones OK') +
  '\x1b[0m\n');
process.exit(fallos ? 1 : 0);
