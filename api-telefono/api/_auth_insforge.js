// FORGE CORE STOCK · puente con InsForge Auth
// ---------------------------------------------------------------------------
// InsForge es la autoridad de la CONTRASEÑA; `fabri-api` sigue siendo la
// autoridad de la SESIÓN (core_sesiones, 30 días, atada al dispositivo).
//
// Este archivo sólo habla HTTP con InsForge. No toca SQL, no toca `res` y no
// conoce el contrato de la app: devuelve siempre la misma forma para que
// `auth.ts` decida.
//
//   { ok:true,  status, datos }
//   { ok:false, status, codigo, error, datos? }
//
// Códigos normalizados (los usa la UI, nunca el texto de InsForge):
//   SIN_CONFIG   faltan INSFORGE_URL / claves en el servidor
//   CREDENCIALES contraseña incorrecta (401)
//   CODIGO       código de recuperación inválido o vencido
//   SIN_VERIFICAR el correo no está verificado (403)
//   YA_EXISTE    el correo ya tiene cuenta en InsForge (409)
//   LIMITE       demasiados intentos / correos seguidos (429)
//   DATOS        payload rechazado (400)
//   NO_EXISTE    el recurso no está (404)
//   PROHIBIDO    la clave no autoriza esa operación (403)
//   NUBE         error del servidor de InsForge (5xx)
//   TIEMPO       no respondió en 8 s
//   RED          no se pudo conectar
//
// Las claves viven SOLO en Vercel. No se imprimen, no se registran y no
// viajan nunca al navegador.
// ---------------------------------------------------------------------------
'use strict';

const { randomBytes } = require('crypto');

const ESPERA_MS = 8000;

const RUTAS = {
  publicConfig: '/api/auth/public-config',
  registrar: '/api/auth/users?client_type=server',
  entrar: '/api/auth/sessions?client_type=server',
  usuarios: '/api/auth/users',
  enviarReset: '/api/auth/email/send-reset-password',
  canjear: '/api/auth/email/exchange-reset-password-token',
  reset: '/api/auth/email/reset-password',
  config: '/api/auth/config',
};

function urlBase() {
  return String(process.env.INSFORGE_URL || '').trim().replace(/\/+$/, '');
}

function claveAnon() {
  return String(process.env.INSFORGE_ANON_KEY || '').trim();
}

function claveAdmin() {
  return String(process.env.INSFORGE_ADMIN_KEY || '').trim();
}

/**
 * Interruptor de despliegue. Cualquier valor raro cae en `legacy`: el código
 * nuevo nunca se activa solo por un error de tipeo en una variable.
 */
function modo() {
  const m = String(process.env.AUTH_MODO || '').trim().toLowerCase();
  return m === 'dual' || m === 'insforge' ? m : 'legacy';
}

function configurado() {
  return Boolean(urlBase() && claveAnon());
}

/** Solo el host, para el diagnóstico: nunca la URL con credenciales. */
function host() {
  try { return new URL(urlBase()).host; } catch (_) { return ''; }
}

function codigoDe(status, datos) {
  const bruto = String((datos && (datos.error || datos.code || datos.codigo)) || '').toUpperCase();
  if (status === 401) return 'CREDENCIALES';
  if (status === 403) return bruto.indexOf('VERIF') >= 0 ? 'SIN_VERIFICAR' : 'PROHIBIDO';
  if (status === 404) return 'NO_EXISTE';
  if (status === 409) return 'YA_EXISTE';
  if (status === 429) return 'LIMITE';
  if (status === 400) return 'DATOS';
  if (status >= 500) return 'NUBE';
  return bruto || 'ERROR';
}

function mensajeDe(datos, status) {
  const m = datos && (datos.message || datos.error || datos.detalle);
  if (m && typeof m === 'string') return m.slice(0, 200);
  if (status >= 500) return 'InsForge devolvió un error interno';
  return 'InsForge rechazó la operación';
}

/**
 * Una llamada. `clave` elige anónima (registro/login/reset) o admin
 * (listar/borrar/configurar).
 */
async function pedir(ruta, opciones) {
  const o = opciones || {};
  const base = urlBase();
  if (!base) {
    return { ok: false, status: 0, codigo: 'SIN_CONFIG', error: 'InsForge no está configurado en el servidor' };
  }
  const clave = o.clave === 'admin' ? claveAdmin() : claveAnon();
  if (!clave) {
    return {
      ok: false, status: 0, codigo: 'SIN_CONFIG',
      error: o.clave === 'admin'
        ? 'Falta la clave de administración de InsForge en el servidor'
        : 'Falta la clave anónima de InsForge en el servidor',
    };
  }

  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const reloj = ctrl ? setTimeout(() => ctrl.abort(), Math.max(1000, Number(o.ms) || ESPERA_MS)) : null;
  try {
    const r = await fetch(base + ruta, {
      method: o.metodo || 'GET',
      headers: {
        Authorization: 'Bearer ' + clave,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: o.cuerpo === undefined ? undefined : JSON.stringify(o.cuerpo),
      signal: ctrl ? ctrl.signal : undefined,
    });
    const texto = await r.text();
    let datos = null;
    if (texto) {
      try { datos = JSON.parse(texto); } catch (_) { datos = { texto: texto.slice(0, 300) }; }
    }
    if (r.ok) return { ok: true, status: r.status, datos };
    return {
      ok: false, status: r.status, datos,
      codigo: o.codigoError && o.codigoError[r.status] ? o.codigoError[r.status] : codigoDe(r.status, datos),
      error: mensajeDe(datos, r.status),
    };
  } catch (e) {
    const abortado = Boolean(e && (e.name === 'AbortError' || /abort/i.test(String(e.message || ''))));
    return {
      ok: false, status: 0,
      codigo: abortado ? 'TIEMPO' : 'RED',
      error: abortado
        ? 'InsForge no respondió a tiempo: intenta en un momento'
        : 'No se pudo conectar con InsForge',
    };
  } finally {
    if (reloj) clearTimeout(reloj);
  }
}

/* ── cuenta ─────────────────────────────────────────────────────────────── */

/** Clave aleatoria de 32 bytes: sólo se usa para cuentas que van a resetear. */
function claveRandom() {
  return randomBytes(32).toString('base64url');
}

/** `{ id, email, verificado }` de la respuesta de InsForge (o null). */
function usuarioDe(res) {
  const u = res && res.datos && res.datos.user;
  if (!u || !u.id) return null;
  return {
    id: String(u.id),
    email: String(u.email || ''),
    verificado: Boolean(u.emailVerified),
    nombre: String((u.profile && u.profile.name) || ''),
  };
}

/** Crea la cuenta con correo + contraseña. 200 = creada. */
async function registrar(cuenta) {
  const c = cuenta || {};
  const cuerpo = { email: c.email, password: c.password };
  const nombre = String(c.name || '').trim();
  if (nombre) cuerpo.name = nombre.slice(0, 80);
  return pedir(RUTAS.registrar, { metodo: 'POST', cuerpo, clave: 'anon' });
}

/** Login por contraseña. 200 = credenciales correctas. */
async function entrar(cuenta) {
  const c = cuenta || {};
  return pedir(RUTAS.entrar, {
    metodo: 'POST',
    cuerpo: { method: 'password', email: c.email, password: c.password },
    clave: 'anon',
  });
}

async function listar(opciones) {
  const o = opciones || {};
  const q = new URLSearchParams({
    offset: String(Number(o.offset) || 0),
    limit: String(Math.min(500, Math.max(1, Number(o.limit) || 200))),
  });
  const busca = String(o.search || '').trim();
  if (busca) q.set('search', busca.slice(0, 120));
  return pedir(RUTAS.usuarios + '?' + q.toString(), { clave: 'admin' });
}

/** Busca una cuenta por correo exacto usando la lista de administración. */
async function buscarPorEmail(email) {
  const busca = String(email || '').trim().toLowerCase();
  if (!busca) return { ok: true, status: 200, usuario: null };
  const r = await listar({ limit: 50, search: busca });
  if (!r.ok) return { ok: false, status: r.status, codigo: r.codigo, error: r.error };
  const filas = (r.datos && r.datos.data) || [];
  const u = filas.find((f) => String(f.email || '').toLowerCase() === busca);
  return { ok: true, status: 200, usuario: u ? usuarioDe({ datos: { user: u } }) : null };
}

/** Borra una cuenta de InsForge. Necesita sí o sí la clave de admin. */
async function borrar(userId) {
  const id = String(userId || '').trim();
  if (!id) return { ok: true, status: 200, borrados: 0 };
  const r = await pedir(RUTAS.usuarios, { metodo: 'DELETE', cuerpo: { userIds: [id] }, clave: 'admin' });
  if (!r.ok) return r;
  return { ok: true, status: r.status, borrados: Number(r.datos && r.datos.deletedCount) || 0 };
}

/* ── recuperación de contraseña (código de 6 dígitos) ───────────────────── */

/**
 * Pide a InsForge que mande el código. Responde 202 exista o no la cuenta
 * (anti-enumeración): el llamador NO debe deducir nada de la respuesta.
 */
async function solicitarReset(email) {
  return pedir(RUTAS.enviarReset, {
    metodo: 'POST',
    cuerpo: { email: String(email || '').trim().toLowerCase() },
    clave: 'anon',
    ms: 12000,
  });
}

/** Cambia el código por un token de un solo uso. 400 = código inválido. */
async function canjearCodigo(email, codigo) {
  return pedir(RUTAS.canjear, {
    metodo: 'POST',
    cuerpo: { email: String(email || '').trim().toLowerCase(), code: String(codigo || '').trim() },
    clave: 'anon',
    codigoError: { 400: 'CODIGO', 401: 'CODIGO' },
  });
}

/** Con el token del canje, fija la contraseña nueva. */
async function resetConClave(token, password) {
  return pedir(RUTAS.reset, {
    metodo: 'POST',
    cuerpo: { otp: String(token || ''), newPassword: String(password || '') },
    clave: 'anon',
    codigoError: { 400: 'CODIGO', 401: 'CODIGO' },
  });
}

/* ── plataforma ─────────────────────────────────────────────────────────── */

async function publicConfig() {
  return pedir(RUTAS.publicConfig, { clave: 'anon', ms: 6000 });
}

async function configurar(patch) {
  return pedir(RUTAS.config, { metodo: 'PUT', cuerpo: patch || {}, clave: 'admin' });
}

module.exports = {
  ESPERA_MS,
  modo, configurado, host,
  claveRandom, usuarioDe,
  publicConfig, configurar,
  registrar, entrar, listar, buscarPorEmail, borrar,
  solicitarReset, canjearCodigo, resetConClave,
  _pedir: pedir,
};
