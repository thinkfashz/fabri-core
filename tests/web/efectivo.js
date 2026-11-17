#!/usr/bin/env node
/* Pruebas de la Fase 3 del marketplace: dirección completa, efectivo con
 * vuelto y código de entrega.
 *
 * Sin navegador ni red: se comprueba el contrato real del código.
 *   · el servidor recalcula el vuelto con el total del catálogo;
 *   · el delivery exige calle y número, y comuna;
 *   · todo pedido nuevo nace con un código de entrega de 4 dígitos;
 *   · el comprador lo ve (checkout y seguimiento) y el local lo pide;
 *   · el listado del local no filtra el código, sólo si hace falta;
 *   · el panel del vendedor no puede marcar entregado sin el código.
 *
 * Uso: node tests/web/efectivo.js
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
const negocio = leer('web/app/negocio.js');
const styles = leer('web/app/styles.css');
const seguir = leer('web/tienda-seguir.js');
const tiendaCss = leer('web/tienda.css');
const sw = leer('web/app/sw.js');

/* ── 1. esquema y reglas del servidor ───────────────────────────────────── */
console.log('\nServidor · columnas y reglas');
ok('las columnas nuevas existen en CREATE TABLE',
  /comuna_entrega TEXT/.test(api) && /referencia_entrega TEXT/.test(api) &&
  /metodo_pago TEXT/.test(api) && /pago_con\s+BIGINT/.test(api) &&
  /vuelto\s+BIGINT/.test(api) && /clave_entrega TEXT/.test(api));
ok('la migración es idempotente para las seis columnas',
  ['comuna_entrega', 'referencia_entrega', 'metodo_pago', 'pago_con', 'vuelto', 'clave_entrega']
    .every((c) => new RegExp('ADD COLUMN IF NOT EXISTS ' + c).test(api)));
ok('los métodos de pago aceptados están declarados',
  /const PAGOS = \['efectivo', 'transferencia', 'tarjeta'\]/.test(api));
ok('el código de entrega es de 4 dígitos', /% 10000\)\.padStart\(4, '0'\)/.test(api));
ok('el vuelto se recalcula en el servidor',
  /function efectivoDe\(total: number, con: unknown\)/.test(api) &&
  /vuelto: dado > total \? dado - total : 0/.test(api) &&
  /faltan: dado > 0 && dado < total \? total - dado : 0/.test(api));
ok('el efectivo corto se rechaza con PAGO_CORTO',
  /codigo: 'PAGO_CORTO'/.test(api) && /faltan: efectivo\.faltan, total/.test(api));
ok('el delivery exige calle y número', /codigo: 'SIN_DIRECCION'/.test(api) && /direccion\.length < 5/.test(api));
ok('el delivery exige comuna', /codigo: 'SIN_COMUNA'/.test(api) && /comunaEntrega\.length < 2/.test(api));
ok('el pedido guarda método, efectivo, vuelto y código',
  /metodo_pago,pago_con,vuelto,clave_entrega\)/.test(api) &&
  /comunaEntrega, referenciaEntrega, pago, efectivo\.dado, efectivo\.vuelto, claveEntrega/.test(api));
ok('la respuesta del pedido devuelve el código al comprador',
  /clave_entrega: claveEntrega/.test(api) &&
  /metodo_pago: pago, pago_con: efectivo\.dado, vuelto: efectivo\.vuelto/.test(api));
ok('la idempotencia devuelve los mismos datos de pago',
  /metodo_pago,pago_con::float8 AS pago_con,vuelto::float8 AS vuelto,clave_entrega/.test(api) &&
  /metodo_pago: p\.metodo_pago, pago_con: p\.pago_con, vuelto: p\.vuelto/.test(api));

/* ── 2. seguimiento y listado ───────────────────────────────────────────── */
console.log('\nServidor · quién puede ver el código');
ok('el seguimiento público devuelve el código',
  /p\.clave_entrega/.test(api) && /clave_entrega: fila\.clave_entrega \|\| ''/.test(api));
ok('el seguimiento devuelve el pago y el vuelto',
  /metodo_pago: fila\.metodo_pago \|\| ''/.test(api) &&
  /pago_con: fila\.pago_con \|\| 0/.test(api) && /vuelto: fila\.vuelto \|\| 0/.test(api));
ok('el seguimiento devuelve comuna y referencia',
  /comuna_entrega: fila\.comuna_entrega \|\| ''/.test(api) &&
  /referencia_entrega: fila\.referencia_entrega \|\| ''/.test(api));
const listadoLocal = (api.match(/SELECT p\.id,p\.codigo,p\.seguimiento[\s\S]*?ORDER BY p\.creado DESC LIMIT/) || [''])[0];
ok('el listado del local no devuelve la clave de entrega',
  Boolean(listadoLocal) && !/AS clave_entrega\b/.test(listadoLocal) && !/p\.clave_entrega,/.test(listadoLocal));
ok('el listado sí dice si el pedido la requiere',
  /\(p\.clave_entrega <> ''\) AS requiere_clave/.test(api));

/* ── 3. verificación al entregar ────────────────────────────────────────── */
console.log('\nServidor · entregar con código');
ok('la fila bloqueada trae el código', /SELECT estado, items, clave_entrega FROM \$\{T_PEDIDOS\}/.test(api));
ok('sin código no se puede entregar', /codigo: 'CLAVE_ENTREGA'/.test(api) &&
  /pide el código de entrega de 4 dígitos al comprador/.test(api));
ok('un código distinto se rechaza', /el código de entrega no coincide/.test(api));
ok('los pedidos viejos (sin código) se pueden cerrar',
  /String\(fila\.clave_entrega \|\| ''\) !== ''/.test(api));
ok('el historial anota la verificación',
  /código de entrega verificado/.test(api));

/* ── 4. checkout del comprador ──────────────────────────────────────────── */
console.log('\nComprador · efectivo y dirección');
ok('el efectivo es el método por defecto', /metodo: ESTADO\.pedido\.pago \|\| "efectivo"/.test(placer));
ok('la hoja ofrece los tres métodos',
  /data-m="efectivo"/.test(placer) && /data-m="transferencia"/.test(placer) && /data-m="tarjeta"/.test(placer));
ok('hay campo de efectivo y atajos de monto',
  /id="mpPagoCon"/.test(placer) && /class="mp-montos"/.test(placer) && /data-con="' \+ v/.test(placer));
ok('el vuelto se muestra en vivo', /id="mpVuelto"/.test(placer) && /textoVuelto\(v\)/.test(placer));
ok('el delivery pide comuna', /id="mpPagoComuna"/.test(placer) && /e\.comuna = "Escribe la comuna de entrega\."/.test(placer));
ok('el delivery acepta una referencia', /id="mpPagoRef"/.test(placer) && /ESTADO\.pago\.referencia = ref\.value/.test(placer));
ok('el teléfono es obligatorio en la UI',
  /Teléfono \(obligatorio\)/.test(placer) &&
  /\(p\.telefono \|\| ""\)\.replace\(\/\\D\/g, ""\)\.length < 8/.test(placer));
ok('el efectivo corto se avisa antes de enviar',
  /e\.pagoCon = "Con " \+ clp\(v\.con\) \+ " faltan "/.test(placer));
ok('el pedido a la nube lleva los campos nuevos',
  /comuna_entrega: ESTADO\.pago\.comuna \|\| ""/.test(placer) &&
  /referencia_entrega: ESTADO\.pago\.referencia \|\| ""/.test(placer) &&
  /metodo_pago: ESTADO\.pago\.metodo \|\| "efectivo"/.test(placer) &&
  /pago_con: ESTADO\.pago\.metodo === "efectivo"/.test(placer));
ok('el comprador guarda el código que devuelve la nube',
  /ESTADO\.pago\.claveEntrega = d\.clave_entrega \|\| ""/.test(placer));
ok('la pantalla de éxito muestra el código de entrega',
  /class="mp-clave"/.test(placer) && /esc\(ESTADO\.pago\.claveEntrega\)/.test(placer));
ok('si el efectivo no alcanza, vuelve al formulario',
  /d\.codigo === "PAGO_CORTO"[\s\S]{0,180}ESTADO\.pago\.estado = "form"/.test(placer));
ok('el total del pago sale de una sola función', /function totalPago\(\)/.test(placer) && /const total = totalPago\(\)/.test(placer));
ok('el vuelto del WhatsApp sale del servidor',
  /ESTADO\.pago\.vueltoServidor \|\| \(con > total \? con - total : 0\)/.test(placer) &&
  /Código de entrega: " \+ ESTADO\.pago\.claveEntrega/.test(placer));
const textoWa = (placer.match(/function textoPedido\(m, total, envio\) \{[\s\S]*?\n  \}/) || [''])[0];
ok('el WhatsApp usa los ítems guardados, no el carrito vacío',
  /const items = ESTADO\.pago\.items \|\| \[\];/.test(textoWa) &&
  !/const items = itemsDe\(m\)/.test(textoWa));
ok('los estilos de efectivo y código existen',
  /\.mp-efectivo \{/.test(placerCss) && /\.mp-vuelto \{/.test(placerCss) && /\.mp-clave \{/.test(placerCss));

/* ── 5. panel del vendedor ──────────────────────────────────────────────── */
console.log('\nVendedor · verificación de entrega');
ok('aLocal conserva pago y dirección completa',
  /comuna: p\.comuna_entrega \|\| ""/.test(negocio) &&
  /metodo: p\.metodo_pago \|\| ""/.test(negocio) &&
  /pagoCon: Number\(p\.pago_con\) \|\| 0/.test(negocio) &&
  /vuelto: Number\(p\.vuelto\) \|\| 0/.test(negocio) &&
  /requiereClave: p\.requiere_clave === true/.test(negocio));
ok('la tarjeta del pedido muestra el pago', /class="neg-ped-pago"/.test(negocio));
ok('la dirección incluye comuna y referencia',
  /\(p\.comuna \? ", " \+ esc\(p\.comuna\) : ""\)/.test(negocio) &&
  /\(p\.referencia \? " · " \+ esc\(p\.referencia\) : ""\)/.test(negocio));
ok('hay caja de verificación con código',
  /class="neg-verif"/.test(negocio) && /data-verificar=/.test(negocio) && /class="neg-verif-clave"/.test(negocio));
ok('el código se envía en pedido_estado', /clave_entrega: claveEntrega \|\| ""/.test(negocio));
ok('un código malo deja la caja abierta',
  /d\.codigo === "CLAVE_ENTREGA"[\s\S]{0,160}EST\.errorVerif/.test(negocio));
ok('entregar exige el código si el pedido lo tiene',
  /s\.value === "entregado" && p && p\.requiereClave/.test(negocio));
ok('los enganches no pisan la verificación',
  /function engancharPedidos\(raiz\)/.test(negocio) && /engancharPedidos\(document\)/.test(negocio));
ok('los estilos de la verificación existen',
  /\.neg-verif \{/.test(styles) && /\.neg-verif-clave \{/.test(styles) && /\.neg-ped-pago \{/.test(styles));

/* ── 6. seguimiento público ─────────────────────────────────────────────── */
console.log('\nSeguimiento · el comprador ve su código');
ok('la página muestra el pago', /function pagoTexto\(p\)/.test(seguir) && /<b>Pago:<\/b>/.test(seguir));
ok('la página muestra comuna y referencia',
  /pedido\.comuna_entrega/.test(seguir) && /pedido\.referencia_entrega/.test(seguir));
ok('la página muestra el código mientras no se entrega',
  /class="sg-clave"/.test(seguir) && /pedido\.estado !== "entregado"/.test(seguir));
ok('el código tiene estilos propios', /\.sg-clave \{/.test(tiendaCss));
ok('el service worker subió de versión para limpiar la caché',
  Number((sw.match(/fcore-v(\d+)/) || [])[1] || 0) >= 95);

console.log(fallos
  ? '\n\x1b[1;31m✖ ' + fallos + ' fallo(s) de ' + pasos + '\x1b[0m\n'
  : '\n\x1b[1;32m✔ ' + pasos + ' comprobaciones OK\x1b[0m\n');
process.exit(fallos ? 1 : 0);
