#!/usr/bin/env node
/* Pruebas de los avisos push (Fase 6).
 *
 * Sin navegador ni red:
 *   · ida y vuelta REAL del cifrado: `_push.js` cifra como el servidor y acá se
 *     descifra como lo haría el navegador (ECDH + HKDF + AES-128-GCM);
 *   · el JWT de VAPID se verifica con la clave pública;
 *   · contrato de la API: tabla, acciones, token o código, secreto que no sale;
 *   · el service worker no cachea nada y reusa la pestaña del seguimiento;
 *   · la página pide permiso sólo al tocar el botón y nunca ve la clave privada.
 *
 * Uso: node tests/web/push.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { pathToFileURL } = require('url');

const RAIZ = path.join(__dirname, '..', '..');
const API = path.join(RAIZ, 'api-telefono', 'api');
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
const igual = (nombre, a, b) => ok(nombre, JSON.stringify(a) === JSON.stringify(b),
  'esperaba ' + JSON.stringify(b) + ', llegó ' + JSON.stringify(a));

(async () => {
  const P = await import(pathToFileURL(path.join(API, '_push.js')).href);

  /* ── 1. claves y JWT ─────────────────────────────────────────────────── */
  console.log('\nVAPID');
  const vapid = P.clavesVapid();
  ok('la clave pública es un punto P-256 sin comprimir (87 chars)',
    vapid.publica.length === 87 && Buffer.from(vapid.publica, 'base64url')[0] === 4, vapid.publica.length);
  ok('la privada son 32 bytes (43 chars)', vapid.privada.length === 43, vapid.privada.length);
  ok('dos pares distintos', P.clavesVapid().privada !== vapid.privada);

  const endpoint = 'https://fcm.googleapis.com/wp/prueba';
  const jwt = P.vapidJwt(endpoint, vapid.publica, vapid.privada, 'mailto:prueba@fabrick.cl');
  const partes = jwt.split('.');
  igual('el JWT tiene tres partes', partes.length, 3);
  const cab = JSON.parse(Buffer.from(partes[0], 'base64url').toString());
  const claims = JSON.parse(Buffer.from(partes[1], 'base64url').toString());
  igual('algoritmo ES256', cab.alg, 'ES256');
  igual('aud es el origen del servicio, no la URL', claims.aud, 'https://fcm.googleapis.com');
  igual('subject se respeta', claims.sub, 'mailto:prueba@fabrick.cl');
  const vidaHoras = (claims.exp - Math.floor(Date.now() / 1000)) / 3600;
  ok('la expiración no pasa de 24 h', vidaHoras > 11 && vidaHoras <= 24, vidaHoras.toFixed(1) + ' h');

  const pub = Buffer.from(vapid.publica, 'base64url');
  const llavePub = crypto.createPublicKey({
    key: {
      kty: 'EC', crv: 'P-256',
      x: pub.subarray(1, 33).toString('base64url'),
      y: pub.subarray(33, 65).toString('base64url'),
    },
    format: 'jwk',
  });
  ok('la firma del JWT verifica con la clave pública',
    crypto.verify('sha256', Buffer.from(partes[0] + '.' + partes[1]),
      { key: llavePub, dsaEncoding: 'ieee-p1363' }, Buffer.from(partes[2], 'base64url')));

  /* ── 2. ida y vuelta del cifrado ─────────────────────────────────────── */
  console.log('\nCifrado aes128gcm (servidor → navegador)');
  const nav = crypto.createECDH('prime256v1');
  nav.generateKeys();
  const auth = crypto.randomBytes(16);
  const sus = {
    endpoint,
    keys: { p256dh: nav.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
  };
  const texto = JSON.stringify({
    titulo: 'Almacén Doña Rosa',
    cuerpo: 'Tu pedido está listo para retirar.',
    codigo: 'MP-ABCDE',
    url: 'https://forge-core-stock.vercel.app/seguir.html?t=abc123',
  });

  const cuerpo = P.cifrar(sus, texto);
  const salt = cuerpo.subarray(0, 16);
  const rs = cuerpo.readUInt32BE(16);
  const idlen = cuerpo.readUInt8(20);
  const asPub = cuerpo.subarray(21, 21 + idlen);
  const datos = cuerpo.subarray(21 + idlen);
  igual('un solo registro de 4096', rs, 4096);
  igual('la cabecera lleva la clave efímera', idlen, 65);
  ok('la etiqueta GCM ocupa los últimos 16 bytes', datos.length > 16);

  const secreto = nav.computeSecret(asPub);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secreto, auth,
    Buffer.concat([Buffer.from('WebPush: info\0'), nav.getPublicKey(), asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAAD(cuerpo.subarray(0, 21 + idlen));
  d.setAuthTag(datos.subarray(datos.length - 16));
  const claro = Buffer.concat([d.update(datos.subarray(0, datos.length - 16)), d.final()]);
  igual('el delimitador del último registro es 0x02', claro[claro.length - 1], 2);
  igual('el texto descifrado es idéntico', claro.subarray(0, claro.length - 1).toString(), texto);

  const otro = P.cifrar(sus, texto);
  ok('cada envío usa sal y clave efímera nuevas', !otro.equals(cuerpo));
  ok('el texto no viaja en claro', cuerpo.indexOf(Buffer.from('MP-ABCDE')) < 0);

  let fallo = '';
  try { P.cifrar({ endpoint, keys: { p256dh: 'AAAA', auth: 'AAAA' } }, 'x'); } catch (e) { fallo = e.message; }
  ok('una suscripción inválida se rechaza', /p256dh|auth/.test(fallo), fallo);

  /* ── 2b. envío real a un endpoint HTTP ────────────────────────────────── */
  console.log('\nEnvío real (servidor de push falso)');
  let recibido = null;
  const servidor = http.createServer((req, res) => {
    const trozos = [];
    req.on('data', (t) => trozos.push(t));
    req.on('end', () => {
      recibido = { metodo: req.method, cabeceras: req.headers, cuerpo: Buffer.concat(trozos) };
      res.writeHead(201, { 'Content-Type': 'text/plain' });
      res.end('created');
    });
  });
  await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
  const puerto = servidor.address().port;
  const susLocal = Object.assign({}, sus, { endpoint: 'http://127.0.0.1:' + puerto + '/push/abc' });

  const respuesta = await P.enviar(susLocal, texto, {
    publica: vapid.publica, privada: vapid.privada, subject: 'mailto:prueba@fabrick.cl', ttl: 3600,
    // En producción el tope es 2,5 s; contra el servidor falso de este test se
    // da margen porque el contenedor del teléfono a veces arranca lento y este
    // test mide el formato del envío, no la latencia.
    timeoutMs: 15000,
  });
  servidor.close();

  igual('el servicio responde 201', respuesta.status, 201);
  ok('el envío se marca como correcto', respuesta.ok === true);
  ok('sale como POST', recibido && recibido.metodo === 'POST');
  igual('declara el cifrado aes128gcm', recibido.cabeceras['content-encoding'], 'aes128gcm');
  igual('el TTL se respeta', recibido.cabeceras.ttl, '3600');
  ok('la autorización es VAPID con la clave pública',
    recibido.cabeceras.authorization.indexOf('vapid t=') === 0 &&
    recibido.cabeceras.authorization.indexOf('k=' + vapid.publica) > 0);
  ok('el cuerpo no lleva el texto en claro', recibido && recibido.cuerpo.indexOf(Buffer.from('MP-ABCDE')) < 0);

  // Descifrar lo que llegó de verdad al endpoint.
  const b = recibido.cuerpo;
  const salt2 = b.subarray(0, 16);
  const idlen2 = b.readUInt8(20);
  const asPub2 = b.subarray(21, 21 + idlen2);
  const datos2 = b.subarray(21 + idlen2);
  const secreto2 = nav.computeSecret(asPub2);
  const ikm2 = Buffer.from(crypto.hkdfSync('sha256', secreto2, auth,
    Buffer.concat([Buffer.from('WebPush: info\0'), nav.getPublicKey(), asPub2]), 32));
  const cek2 = Buffer.from(crypto.hkdfSync('sha256', ikm2, salt2, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce2 = Buffer.from(crypto.hkdfSync('sha256', ikm2, salt2, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d2 = crypto.createDecipheriv('aes-128-gcm', cek2, nonce2);
  d2.setAAD(b.subarray(0, 21 + idlen2));
  d2.setAuthTag(datos2.subarray(datos2.length - 16));
  const claro2 = Buffer.concat([d2.update(datos2.subarray(0, datos2.length - 16)), d2.final()]);
  igual('lo que llegó se descifra con la clave del navegador',
    claro2.subarray(0, claro2.length - 1).toString(), texto);

  /* ── 3. contrato de la API ───────────────────────────────────────────── */
  console.log('\nContrato · /api/mercado');
  const api = leer('api-telefono/api/mercado.ts');
  ok('existe la tabla de suscripciones', /const T_PUSH = 'mercado_push'/.test(api));
  ok('la tabla se crea con sus columnas',
    /CREATE TABLE IF NOT EXISTS \$\{T_PUSH\}[\s\S]*?endpoint\s+TEXT NOT NULL[\s\S]*?p256dh/.test(api));
  ok('un endpoint por pedido (índice único con huella)',
    /idx_mercado_push_pedido\s+ON \$\{T_PUSH\} \(pedido_id, huella\)/.test(api));
  ok('la tabla entra en asegurar', /T_RESENAS,[\s\S]{0,160}T_PUSH/.test(api));
  ok('existe push_suscribir', /accion === 'push_suscribir'/.test(api));
  ok('existe push_baja', /accion === 'push_baja'/.test(api));
  ok('las dos están en la lista del GET', /'push_suscribir', 'push_baja'/.test(api));

  ok('sin VAPID responde 503 y no rompe', /codigo: 'SIN_PUSH'[\s\S]{0,120}503/.test(api));
  ok('exige https en el endpoint', /\/\^https:\\\/\\\/\/i\.test\(endpoint\)/.test(api));
  ok('acepta el token del enlace o código + teléfono',
    /async function pedidoPorCredencial/.test(api) &&
    /function ultimos4/.test(api) && /function codigoComparable/.test(api));
  ok('limita a 5 dispositivos por pedido', />= 5[\s\S]{0,200}5 dispositivos/.test(api));
  ok('no suscribe pedidos terminados', /estado === 'entregado' \|\| pedido\.estado === 'cancelado'/.test(api));
  ok('el endpoint nunca se devuelve al cliente',
    /return json\(res, \{ ok: true, accion, avisos: true \}\)/.test(api) &&
    /return json\(res, \{ ok: true, accion, avisos: true, actualizado: true \}\)/.test(api) &&
    !/avisos: true[^}]*endpoint/.test(api));
  ok('la suscripción viaja como JSON al navegador',
    /cuerpo\.suscripcion = suscripcion/.test(leer('web/tienda-seguir.js')));

  console.log('\nAviso al cambiar el estado');
  ok('se avisa después de guardar el cambio', /avisados = await avisarCambio\(pool, pedidoId, estado\)/.test(api));
  ok('un fallo del aviso no tumba el cambio',
    /try \{ avisados = await avisarCambio[\s\S]{0,160}catch \(e\) \{ \/\* el estado ya está guardado/.test(api));
  ok('el aviso es mejor esfuerzo (no tumba el cambio)',
    /async function avisarCambio[\s\S]*?catch \(e\) \{ \/\* base o red/.test(api));
  ok('una suscripción muerta se borra', /r\.status === 404 \|\| r\.status === 410/.test(api));
  ok('el aviso no lleva teléfono ni nombre completo',
    /function textoAviso[\s\S]*?return \{[\s\S]*?titulo: local/.test(api) &&
    !/telefono: pedido\.telefono/.test(api));
  ok('el aviso lleva el enlace de seguimiento', /seguir\.html\?t=/.test(api));
  ok('se apaga solo si no hay VAPID', /if \(!cfg\) return 0/.test(api));
  ok('la clave pública viaja en pedido_seguir', /push: pushCfg[\s\S]{0,120}clave: pushCfg\.publica/.test(api));
  ok('sin VAPID no se finge disponibilidad', /disponible: false, clave: ''/.test(api));
  ok('borrar la tienda borra sus avisos', /DELETE FROM \$\{T_PUSH\}[\s\S]*?local_id = \$1/.test(api));

  /* ── 3b. avisos al dueño ─────────────────────────────────────────────── */
  console.log('\nAvisos al dueño (pedido nuevo)');
  ok('existe la tabla de suscripciones del local', /const T_PUSH_LOCAL = 'mercado_push_local'/.test(api));
  ok('la tabla se crea y es única por local',
    /CREATE TABLE IF NOT EXISTS \$\{T_PUSH_LOCAL\}/.test(api) &&
    /idx_mercado_push_local[\s\S]{0,90}\(local_id, huella\)/.test(api));
  ok('la tabla entra en asegurar', /T_PUSH,\s*T_PUSH_LOCAL\]/.test(api));
  ok('existen push_local_suscribir y push_local_baja',
    /accion === 'push_local_suscribir'/.test(api) && /accion === 'push_local_baja'/.test(api));
  ok('las dos están en la lista del GET', /'push_local_suscribir', 'push_local_baja'/.test(api));
  ok('suscribir exige dueño o clave',
    /accion === 'push_local_suscribir'[\s\S]{0,700}autorizarLocal/.test(api));
  ok('limita a 5 dispositivos por tienda', />= 5[\s\S]{0,120}5 dispositivos/.test(api));
  ok('el aviso del dueño no espera al comprador (tope corto)',
    /async function despachar[\s\S]{0,700}timeoutMs: 1000/.test(api) &&
    /async function avisarLocal[\s\S]{0,1200}LIMIT 3/.test(api));
  ok('se avisa al dueño recién cuando el pedido está guardado',
    /await avisarLocal\(pool, localId/.test(api) &&
    api.indexOf('avisarLocal(pool, localId') > api.indexOf("query('COMMIT')"));
  ok('el aviso lleva código, monto y local',
    /titulo: 'Nuevo pedido ' \+ texto\(pedido\.codigo/.test(api) &&
    /url: sitioPublico\(\) \+ '\/app\/#negocio'/.test(api));
  ok('el resumen del panel publica la clave pública',
    /resenas,[\s\S]{0,120}push: vapidConfig\(\)/.test(api));
  ok('borrar la tienda borra sus avisos',
    /DELETE FROM \$\{T_PUSH_LOCAL\}|DELETE FROM \$\{T_PUSH\}/.test(api));

  /* ── 4. service worker ───────────────────────────────────────────────── */
  console.log('\nService worker de avisos (raíz)');
  const sw = leer('web/sw-push.js');
  ok('escucha push', /addEventListener\('push'/.test(sw));
  ok('muestra la notificación', /showNotification\(titulo/.test(sw));
  ok('usa una etiqueta por pedido (no apila)', /tag: codigo \? 'pedido-'/.test(sw));
  ok('al tocarla abre el seguimiento', /addEventListener\('notificationclick'/.test(sw) && /openWindow\(url\)/.test(sw));
  ok('reusa la pestaña abierta', /clients\.matchAll/.test(sw) && /focus\(\)/.test(sw));
  ok('no cachea ni intercepta pedidos', !/addEventListener\('fetch'/.test(sw) && !/caches\./.test(sw));
  ok('el aviso sin JSON no rompe', /catch \(err\)/.test(sw));

  console.log('\nService worker de la app (dueño)');
  const swApp = leer('web/app/sw.js');
  ok('la app también escucha push', /addEventListener\('push'/.test(swApp));
  ok('abre el panel al tocar el aviso', /d\.url \|\| '\/app\/#negocio'/.test(swApp));
  ok('reusa la pestaña del panel', /clients\.matchAll/.test(swApp) && /focus\(\)/.test(swApp));
  ok('sigue sin interceptar de más (un solo fetch)', (swApp.match(/addEventListener\('fetch'/g) || []).length === 1);

  /* ── 5. página de seguimiento ────────────────────────────────────────── */
  console.log('\nPágina de seguimiento');
  const js = leer('web/tienda-seguir.js');
  ok('el bloque sólo aparece si el servidor lo habilita', /pedido\.push\.disponible/.test(js));
  ok('no aparece con el pedido terminado',
    /pedido\.estado === "entregado" \|\| pedido\.estado === "cancelado"\) return ""/.test(js));
  ok('exige soporte del navegador', /function soportaAvisos/.test(js) && /"PushManager" in window/.test(js));
  ok('pide permiso recién al tocar el botón', /btn\.onclick = function/.test(js) &&
    /Notification\.requestPermission\(\)/.test(js));
  ok('registra el service worker de la raíz', /serviceWorker\.register\(SW_AVISOS\)/.test(js) && /SW_AVISOS = "\/sw-push\.js"/.test(js));
  ok('se suscribe con la clave pública del servidor', /applicationServerKey: claveToUint8\(pedido\.push\.clave\)/.test(js));
  ok('convierte base64url a bytes', /function claveToUint8/.test(js) && /atob\(s\)/.test(js));
  ok('avisa al servidor la suscripción', /accion: accion/.test(js) && /push_suscribir/.test(js));
  ok('guarda el endpoint para no repetir', /function guardarAviso/.test(js));
  ok('se puede dejar de avisar', /push_baja/.test(js) && /unsubscribe\(\)/.test(js));
  ok('si el permiso está bloqueado lo explica', /bloqueadas las notificaciones/.test(js));
  ok('la web nunca ve la clave privada', !/VAPID_PRIVATE|privada/.test(js) &&
    !/VAPID_PRIVATE/.test(leer('web/sw-push.js')));
  ok('el CSS del bloque existe', /\.sg-avisos/.test(leer('web/tienda.css')));

  console.log('\nPanel del dueño · activar avisos');
  const neg = leer('web/app/negocio.js');
  const htmlApp = leer('web/app/index.html');
  ok('hay tarjeta de avisos en Ajustes', /id="negAvisosCard"/.test(htmlApp) &&
    /id="negAvisosBtn"/.test(htmlApp) && /id="negAvisosQuitar"/.test(htmlApp));
  ok('se suscribe a la tienda', /accion: "push_local_suscribir"/.test(neg) &&
    /local_id: EST\.sel\.id/.test(neg));
  ok('usa la clave pública del resumen', /applicationServerKey: claveToUint8\(push\.clave\)/.test(neg));
  ok('pide permiso al tocar el botón', /Notification\.requestPermission\(\)/.test(neg) &&
    /btn\.onclick = activarAvisosDueno/.test(neg));
  ok('se puede dejar de avisar', /accion: "push_local_baja"/.test(neg) && /unsubscribe\(\)/.test(neg));
  ok('muestra el estado real del navegador', /getSubscription\(\)\.then/.test(neg) &&
    /pintarAvisosDueno\(Boolean\(s\)/.test(neg));
  ok('avisa si el servidor no tiene push', /El servidor no tiene los avisos configurados/.test(neg));

  console.log(fallos
    ? '\n\x1b[1;31m✖ ' + fallos + ' fallo(s) de ' + pasos + '\x1b[0m\n'
    : '\n\x1b[1;32m✔ ' + pasos + ' comprobaciones OK\x1b[0m\n');
  process.exit(fallos ? 1 : 0);
})();