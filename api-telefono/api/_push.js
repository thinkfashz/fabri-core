// FORGE CORE STOCK · Web Push sin dependencias
// ---------------------------------------------------------------------------
// Implementa lo mínimo para mandar una notificación a un navegador:
//
//   · VAPID (RFC 8292): el JWT ES256 que identifica al servidor ante el
//     servicio de push (FCM, Mozilla, Apple). No necesita librerías: `crypto`
//     firma P-256 con `dsaEncoding: 'ieee-p1363'`, que es justo el formato que
//     pide JWS (r || s, 64 bytes).
//   · Cifrado del contenido (RFC 8291, `aes128gcm`): ECDH con la clave del
//     navegador, HKDF-SHA256 y AES-128-GCM. El servicio de push sólo ve bytes:
//     ni el texto ni el enlace del pedido pasan en claro por él.
//
// Este archivo NO es un endpoint: `vercel.json` sólo compila `api/*.ts`, así
// que un `.js` acá es una dependencia más (igual que `_auth.js`). Se prueba en
// `tests/web/push.js`, que cifra y vuelve a descifrar con las mismas reglas.
'use strict';

const crypto = require('crypto');

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const deB64u = (s) => Buffer.from(String(s), 'base64url');

const TIPO = Buffer.from('WebPush: info\0');
const INFO_CEK = Buffer.from('Content-Encoding: aes128gcm\0');
const INFO_NONCE = Buffer.from('Content-Encoding: nonce\0');
const RS = 4096;                       // tamaño de registro (un solo bloque)
const SALT_BYTES = 16;
const AUTH_BYTES = 16;

/** Punto P-256 sin comprimir (0x04 || x || y) desde un JWK. */
function punto(jwk) {
  return Buffer.concat([Buffer.from([4]), deB64u(jwk.x), deB64u(jwk.y)]);
}

/**
 * Genera un par VAPID nuevo. Se usa una vez y se guarda en el entorno:
 * `VAPID_PUBLIC` (87 caracteres) y `VAPID_PRIVATE` (43). La privada NUNCA va
 * al navegador; la pública es pública por definición.
 */
function clavesVapid() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' });
  const priv = privateKey.export({ format: 'jwk' });
  return { publica: b64u(punto(pub)), privada: priv.d };
}

/** Reconstruye la clave privada desde la pública (x,y) y el secreto `d`. */
function clavePrivada(publicaB64u, privadaB64u) {
  const p = deB64u(publicaB64u);
  if (p.length !== 65 || p[0] !== 4) throw new Error('clave pública VAPID inválida');
  return crypto.createPrivateKey({
    key: {
      kty: 'EC', crv: 'P-256',
      x: b64u(p.subarray(1, 33)), y: b64u(p.subarray(33, 65)),
      d: String(privadaB64u),
    },
    format: 'jwk',
  });
}

/**
 * JWT de VAPID para este endpoint. `aud` es el origen del servicio de push
 * (no la URL completa) y `exp` no puede pasar de 24 h; usamos 12.
 */
function vapidJwt(endpoint, publica, privada, subject, ahora = Date.now()) {
  const aud = new URL(endpoint).origin;
  const cabecera = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const cuerpo = b64u(JSON.stringify({
    aud,
    exp: Math.floor(ahora / 1000) + 12 * 3600,
    sub: subject || 'mailto:soporte@fabrick.cl',
  }));
  const firma = crypto.sign('sha256', Buffer.from(cabecera + '.' + cuerpo), {
    key: clavePrivada(publica, privada),
    dsaEncoding: 'ieee-p1363',
  });
  return cabecera + '.' + cuerpo + '.' + b64u(firma);
}

/**
 * Cifra un texto para una suscripción concreta y devuelve el cuerpo HTTP listo:
 * cabecera (salt · rs · largo · clave efímera) + AES-128-GCM + etiqueta.
 */
function cifrar(suscripcion, texto) {
  const claves = (suscripcion && suscripcion.keys) || {};
  const p256dh = deB64u(claves.p256dh || '');
  const auth = deB64u(claves.auth || '');
  if (p256dh.length !== 65 || p256dh[0] !== 4) throw new Error('p256dh inválido');
  if (auth.length !== AUTH_BYTES) throw new Error('auth inválido');

  // Par efímero del servidor + secreto compartido con el navegador.
  const efimera = crypto.createECDH('prime256v1');
  efimera.generateKeys();
  const asPublica = efimera.getPublicKey();          // 65 bytes, sin comprimir
  const secreto = efimera.computeSecret(p256dh);

  // IKM: la sal es el `auth` del navegador y el info lleva las dos claves.
  const ikm = Buffer.from(crypto.hkdfSync(
    'sha256', secreto, auth, Buffer.concat([TIPO, p256dh, asPublica]), 32
  ));
  const salt = crypto.randomBytes(SALT_BYTES);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, INFO_CEK, 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, INFO_NONCE, 12));

  const cabecera = Buffer.alloc(SALT_BYTES + 4 + 1 + 65);
  salt.copy(cabecera, 0);
  cabecera.writeUInt32BE(RS, SALT_BYTES);
  cabecera.writeUInt8(65, SALT_BYTES + 4);
  asPublica.copy(cabecera, SALT_BYTES + 5);

  // El 0x02 marca el último (y único) registro; de ahí en adelante no hay relleno.
  const claro = Buffer.concat([Buffer.from(String(texto), 'utf8'), Buffer.from([2])]);
  const cifrador = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  cifrador.setAAD(cabecera);
  const cifrado = Buffer.concat([cifrador.update(claro), cifrador.final()]);

  return Buffer.concat([cabecera, cifrado, cifrador.getAuthTag()]);
}

/**
 * Manda el aviso. Devuelve `{ status, ok }`; el que llama decide qué hacer con
 * un 404/410 (la suscripción murió) o con un error de red.
 */
async function enviar(suscripcion, texto, opciones = {}) {
  const publica = opciones.publica;
  const privada = opciones.privada;
  if (!publica || !privada) throw new Error('VAPID sin configurar');
  if (!suscripcion || !suscripcion.endpoint) throw new Error('suscripción inválida');

  const cuerpo = cifrar(suscripcion, texto);
  const jwt = vapidJwt(suscripcion.endpoint, publica, privada, opciones.subject);

  const r = await fetch(suscripcion.endpoint, {
    method: 'POST',
    headers: {
      Authorization: 'vapid t=' + jwt + ', k=' + publica,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(opciones.ttl || 86400),
      Urgency: opciones.urgencia || 'normal',
    },
    body: cuerpo,
    signal: AbortSignal.timeout(opciones.timeoutMs || 2500),
  });

  // El cuerpo de una respuesta de error ayuda a diagnosticar, pero no se
  // propaga al cliente: puede traer datos del servicio de push.
  let detalle = '';
  try { detalle = (await r.text()).slice(0, 200); } catch (e) { /* sin cuerpo */ }
  return { status: r.status, ok: r.ok, detalle };
}

module.exports = { clavesVapid, vapidJwt, cifrar, enviar, b64u, deB64u, RS };
