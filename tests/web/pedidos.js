#!/usr/bin/env node
/* Pruebas del pedido endurecido y del contador del panel (Fase 7).
 *
 * Sin navegador ni red: se comprueba el contrato del código real.
 *   · el precio y el stock los fija el catálogo del servidor, no el cliente;
 *   · la idempotencia evita pedidos duplicados;
 *   · la transacción descuenta stock y no deja pedidos a medias;
 *   · los estados terminales se bloquean y cancelar devuelve el stock;
 *   · el historial guarda quién movió el pedido y con qué nota;
 *   · el panel usa el total real del servidor y muestra el historial.
 *
 * Uso: node tests/web/pedidos.js
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
const negocio = leer('web/app/negocio.js');
const html = leer('web/app/index.html');

/* ── 1. esquema ──────────────────────────────────────────────────────────── */
console.log('\nEsquema · lo que impide duplicados');
ok('el pedido guarda su clave de idempotencia',
  /ALTER TABLE \$\{T_PEDIDOS\} ADD COLUMN IF NOT EXISTS idempotencia/.test(api));
ok('la clave es única por local',
  /idx_mercado_pedidos_idempotencia[\s\S]{0,80}\(local_id, idempotencia\) WHERE idempotencia <> ''/.test(api));
ok('el código corto es único (índice protegido)',
  /idx_mercado_pedidos_codigo[\s\S]{0,90}WHERE codigo <> ''/.test(api) &&
  /try \{[\s\S]{0,200}idx_mercado_pedidos_codigo/.test(api));
ok('el historial gana actor y nota',
  /idx_mercado_eventos_pedido|ALTER TABLE \$\{T_EVENTOS\} ADD COLUMN IF NOT EXISTS actor/.test(api) &&
  /ADD COLUMN IF NOT EXISTS actor TEXT NOT NULL DEFAULT 'sistema'/.test(api) &&
  /ADD COLUMN IF NOT EXISTS nota TEXT NOT NULL DEFAULT ''/.test(api));

/* ── 2. creación del pedido ──────────────────────────────────────────────── */
console.log('\nPedido · el servidor manda');
ok('los precios salen del catálogo, no del cliente',
  /SELECT \$\{CAMPOS_PRODUCTO\} FROM \$\{T_PRODUCTOS\} WHERE local_id = \$1/.test(api) &&
  /const efectivo = Number\(enCat\.precio_efectivo\) \|\| lista/.test(api));
ok('el descuento y el ahorro salen del mismo catálogo',
  /const dcto = Number\(enCat\.descuento_vigente\) \|\| 0/.test(api) &&
  /precio_lista: lista/.test(api) && /descuento: dcto/.test(api) &&
  /const ahorro = items\.reduce/.test(api));
ok('el pedido guarda el ahorro',
  /ADD COLUMN IF NOT EXISTS ahorro NUMERIC NOT NULL DEFAULT 0/.test(api) &&
  /idempotencia,ahorro\)/.test(api));
ok('el comparador de nombres está definido', /function nombreClave\(v: unknown\)/.test(api));
ok('busca por SKU y, si no, por nombre comparable',
  /porSku\.get\(it\.sku\)\) \|\| porNombre\.get\(nombreClave\(it\.nombre\)\)/.test(api) &&
  /function nombreClave/.test(api));
ok('un producto fuera del catálogo se rechaza',
  /codigo: 'NO_CATALOGO'/.test(api));
ok('no se puede pedir más que el stock',
  /it\.cantidad > stock[\s\S]{0,200}codigo: 'SIN_STOCK'/.test(api));
ok('el stock se descuenta con condición atómica',
  /UPDATE \$\{T_PRODUCTOS\} SET stock = stock - \$3[\s\S]{0,140}stock >= \$3/.test(api));
ok('todo va en una transacción con rollback',
  /query\('BEGIN'\)/.test(api) && /query\('ROLLBACK'\)/.test(api) && /query\('COMMIT'\)/.test(api));
ok('exige nombre y teléfono utilizables',
  /codigo: 'SIN_NOMBRE'/.test(api) && /codigo: 'SIN_TELEFONO'/.test(api) &&
  /telefono\.replace\(\/\\D\/g, ''\)\.length < 8/.test(api));
ok('pone topes de líneas y de monto',
  /crudos\.length > 100/.test(api) && /subtotal > 5_000_000/.test(api));

console.log('\nPedido · idempotencia');
ok('si la clave ya existe devuelve el mismo pedido',
  /WHERE local_id = \$1 AND idempotencia = \$2 LIMIT 1/.test(api) && /repetido: true/.test(api));
ok('la carrera de dos envíos también devuelve el ganador',
  /idx_mercado_pedidos_idempotencia' && idem/.test(api));
ok('un código repetido se reintenta con otro',
  /idx_mercado_pedidos_codigo' && intento < 5/.test(api));

/* ── 3. cambio de estado ─────────────────────────────────────────────────── */
console.log('\nEstado · sin retrocesos ni stock perdido');
ok('los estados terminales están definidos', /const ESTADOS_FINALES = \['entregado', 'cancelado'\]/.test(api));
ok('los estados terminales están bloqueados',
  /const ESTADOS_FINALES = \['entregado', 'cancelado'\]/.test(api) &&
  /if \(ESTADOS_FINALES\.includes\(fila\.estado\)\)/.test(api));
ok('el rechazo explica el motivo', /codigo: 'TERMINADO'/.test(api));
ok('la fila se bloquea para dos toques seguidos',
  /FOR UPDATE/.test(api));
ok('el historial dice quién lo movió',
  /const actor = esAdmin\(req\) \? 'sistema' : 'dueño'/.test(api));
ok('cancelar devuelve el stock al catálogo',
  /estado === 'cancelado'[\s\S]{0,400}SET stock = stock \+ \$3/.test(api) &&
  /stock devuelto/.test(api));
ok('el aviso push sale después del commit',
  /query\('COMMIT'\);[\s\S]{0,220}avisarCambio/.test(api));

/* ── 4. listado y contador del panel ─────────────────────────────────────── */
console.log('\nPanel · contador y rastro');
ok('el listado devuelve el total real, no el de la página',
  /SELECT COUNT\(\*\)::int AS n,[\s\S]{0,220}FROM \$\{T_PEDIDOS\} p WHERE \$\{where\}/.test(api) &&
  /total: Number\(c\.n\) \|\| 0/.test(api));
ok('separa nuevos y por atender', /nuevos: Number\(c\.nuevos\)/.test(api) && /abiertos: Number\(c\.abiertos\)/.test(api));
ok('cada pedido lleva su historial', /AS eventos/.test(api) && /json_agg\(json_build_object/.test(api));

ok('el panel guarda los contadores del servidor',
  /EST\.pedidosTotal = Number\(d\.total\)/.test(negocio) &&
  /EST\.pedidosNuevos = Number\(d\.nuevos\)/.test(negocio) &&
  /EST\.pedidosAbiertos = Number\(d\.abiertos\)/.test(negocio));
ok('sin conexión cuenta lo del teléfono y lo dice',
  /function contarPedidos/.test(negocio) && /origen: "local"/.test(negocio) &&
  /" · local"/.test(negocio));
ok('la pestaña y la tarjeta usan el mismo número',
  /if \(pc\) pc\.textContent = cuenta\.total/.test(negocio) &&
  /pt\.textContent = cuenta\.total/.test(negocio));
ok('hay un chip de «por atender»', /id="negPedPend"/.test(html) && /negPedPend/.test(negocio));
ok('el panel pinta el historial del pedido',
  /function historialPedido/.test(negocio) && /Historial · /.test(negocio) &&
  /e\.actor && e\.actor !== "sistema"/.test(negocio));
ok('el historial tiene estilos', /\.neg-ped-hist/.test(leer('web/app/styles.css')));
ok('aLocal conserva el historial', /eventos: Array\.isArray\(p\.eventos\)/.test(negocio));

/* ── 5. checkout ─────────────────────────────────────────────────────────── */
console.log('\nCheckout · un pedido, una clave');
ok('la clave se crea al abrir el pago', /idempotencia: "pc-" \+ Date\.now\(\)/.test(placer));
ok('la clave viaja en el pedido', /idempotencia: ESTADO\.pago\.idempotencia/.test(placer));
ok("se reintenta una vez con la misma clave", /const enviar = function \(intento\)/.test(placer) && /intento < 2/.test(placer));
ok('el total que se muestra es el del servidor',
  /ESTADO\.pago\.totalServidor = Number\(d\.total\)/.test(placer) &&
  /ESTADO\.pago\.estado === "listo" && ESTADO\.pago\.totalServidor/.test(placer));
ok('si el local rechaza, se avisa sin romper el pago',
  /window\.Fabri\.toast\(d\.error \|\| "El local no pudo recibir el pedido"\)/.test(placer));

console.log(fallos
  ? '\n\x1b[1;31m✖ ' + fallos + ' fallo(s) de ' + pasos + '\x1b[0m\n'
  : '\n\x1b[1;32m✔ ' + pasos + ' comprobaciones OK\x1b[0m\n');
process.exit(fallos ? 1 : 0);