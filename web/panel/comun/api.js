/* Cliente HTTP del panel.
   La API vive en OTRO proyecto de Vercel: la base es absoluta a propósito.
   `/api/auth` relativo pega en la auth vieja de Go y falla sin explicación. */

export const API_BASE = 'https://fabri-api.vercel.app';
export const AUTH_URL = API_BASE + '/api/auth';
export const MERCADO_URL = API_BASE + '/api/mercado';
export const DIAG_URL = API_BASE + '/api/diagnostico';

const ESPERA_MS = 14000;

/* ── puente con el doctor ─────────────────────────────────────────────────
   El doctor de cliente (`/doctor.js`) captura errores del navegador. Aquí se
   le suman los fallos de API con la ubicación exacta del código que llamó:
   `new Error().stack` da el archivo:línea:columna del módulo, no de api.js. */

function rutaDeUrl(u) {
  try { return new URL(u, location.href).pathname; }
  catch (_) { return String(u || '').split('?')[0].slice(0, 160); }
}

function ubicacionLlamador() {
  try {
    const lineas = String(new Error().stack || '').split('\n').slice(1);
    for (const l of lineas) {
      if (l.indexOf('/comun/api.js') >= 0 || /(^|[\\/])api\.js:\d+/.test(l)) continue;
      const abs = l.match(/(https?:\/\/[^\s)]+?):(\d+):(\d+)/);
      if (abs) return { archivo: rutaDeUrl(abs[1]), linea: Number(abs[2]), columna: Number(abs[3]) };
      const rel = l.match(/([\w./@-]+\.(?:js|mjs|ts)):(\d+):(\d+)/);
      if (rel) return { archivo: rel[1].slice(0, 160), linea: Number(rel[2]), columna: Number(rel[3]) };
    }
  } catch (_) { /* sin stack no hay ubicación, no es crítico */ }
  return {};
}

function avisarDoctor(datos) {
  const doctor = globalThis.FCoreDoctor;
  if (!doctor || typeof doctor.apiFallo !== 'function') return;
  try { doctor.apiFallo(datos); } catch (_) { /* el doctor nunca rompe la API */ }
}

function falloApi(metodo, url, status, codigo, ms, mensaje) {
  const ub = ubicacionLlamador();
  avisarDoctor({
    metodo,
    url: rutaDeUrl(url),
    status: status || 0,
    codigo: codigo || '',
    ms: ms || 0,
    mensaje: mensaje || codigo || '',
    archivo: ub.archivo,
    linea: ub.linea,
    columna: ub.columna,
  });
}

export class ErrorApi extends Error {
  constructor(mensaje, opciones) {
    super(mensaje);
    this.name = 'ErrorApi';
    this.codigo = (opciones && opciones.codigo) || 'ERROR';
    this.status = (opciones && opciones.status) || 0;
    this.datos = (opciones && opciones.datos) || null;
  }
}

function leerJson(r) {
  return r.json().catch(() => ({}));
}

async function conTiempo(url, opciones, ms) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const reloj = ctrl ? setTimeout(() => ctrl.abort(), ms || ESPERA_MS) : null;
  try {
    return await fetch(url, Object.assign({}, opciones, { signal: ctrl ? ctrl.signal : undefined }));
  } finally {
    if (reloj) clearTimeout(reloj);
  }
}

/** Traduce un fallo de red a algo que una persona pueda leer y accionar. */
export function mensajeDeError(e) {
  if (!e) return 'algo salió mal: intenta de nuevo';
  if (e.name === 'AbortError') return 'la nube no respondió a tiempo: revisa tu conexión';
  if (e instanceof TypeError) return 'no pudimos conectar con la nube: revisa tu conexión';
  return e.message || 'algo salió mal: intenta de nuevo';
}

/**
 * POST a `/api/auth`.
 * `datos` se envía tal cual; el token va como Bearer, nunca en el cuerpo.
 */
export async function auth(accion, datos, opts) {
  const o = opts || {};
  const cabeceras = { 'Content-Type': 'application/json' };
  if (o.token) cabeceras.Authorization = 'Bearer ' + o.token;
  let r;
  const t0 = Date.now();
  try {
    r = await conTiempo(AUTH_URL, {
      method: 'POST',
      headers: cabeceras,
      body: JSON.stringify(Object.assign({ accion }, datos || {})),
    }, o.ms);
  } catch (e) {
    const err = new ErrorApi(mensajeDeError(e), { codigo: 'SIN_RED' });
    falloApi('POST', AUTH_URL, 0, err.codigo, Date.now() - t0, err.message);
    throw err;
  }
  const d = await leerJson(r);
  if (!r.ok || d.ok === false) {
    const err = new ErrorApi(d.error || ('la nube respondió ' + r.status), {
      codigo: d.codigo || 'HTTP_' + r.status,
      status: r.status,
      datos: d,
    });
    falloApi('POST', AUTH_URL, r.status, err.codigo, Date.now() - t0, err.message);
    throw err;
  }
  return d;
}

/** GET público de `/api/mercado`. Reintenta una vez si se cayó la red. */
export async function mercado(accion, params, opts) {
  const o = opts || {};
  const q = new URLSearchParams(Object.assign({ accion }, params || {}));
  for (const [k, v] of Array.from(q.entries())) {
    if (v === null || v === undefined || v === '') q.delete(k);
  }
  const url = MERCADO_URL + '?' + q.toString();
  const cabeceras = {};
  if (o.token) {
    cabeceras.Authorization = 'Bearer ' + o.token;
    if (o.dispositivo) cabeceras['x-dispositivo'] = o.dispositivo;
  }
  let ultimo = null;
  const t0 = Date.now();
  for (let intento = 0; intento < 2; intento++) {
    try {
      const r = await conTiempo(url, { headers: cabeceras, cache: 'no-store' }, o.ms);
      const d = await leerJson(r);
      if (!r.ok || d.ok === false) {
        const err = new ErrorApi(d.error || ('la nube respondió ' + r.status), {
          codigo: d.codigo || 'HTTP_' + r.status,
          status: r.status,
          datos: d,
        });
        falloApi('GET', url, r.status, err.codigo, Date.now() - t0, err.message);
        throw err;
      }
      return d;
    } catch (e) {
      ultimo = e;
      // Un error del servidor no se reintenta: la respuesta ya es la verdad.
      if (e instanceof ErrorApi) break;
      if (intento === 0) await new Promise((s) => setTimeout(s, 450));
    }
  }
  if (ultimo instanceof ErrorApi) throw ultimo;
  const err = new ErrorApi(mensajeDeError(ultimo), { codigo: 'SIN_RED' });
  falloApi('GET', url, 0, err.codigo, Date.now() - t0, err.message);
  throw err;
}

/** POST a `/api/mercado`. Nunca se reintenta: crear un pedido no es idempotente
 *  salvo que el servidor reciba la misma `idempotencia`. */
export async function mercadoPost(accion, datos, opts) {
  const o = opts || {};
  const cabeceras = { 'Content-Type': 'application/json' };
  if (o.token) {
    cabeceras.Authorization = 'Bearer ' + o.token;
    if (o.dispositivo) cabeceras['x-dispositivo'] = o.dispositivo;
  }
  let r;
  const t0 = Date.now();
  try {
    r = await conTiempo(MERCADO_URL, {
      method: 'POST',
      headers: cabeceras,
      body: JSON.stringify(Object.assign({ accion }, datos || {})),
    }, o.ms);
  } catch (e) {
    const err = new ErrorApi(mensajeDeError(e), { codigo: 'SIN_RED' });
    falloApi('POST', MERCADO_URL, 0, err.codigo, Date.now() - t0, err.message);
    throw err;
  }
  const d = await leerJson(r);
  if (!r.ok || d.ok === false) {
    const err = new ErrorApi(d.error || ('la nube respondió ' + r.status), {
      codigo: d.codigo || 'HTTP_' + r.status,
      status: r.status,
      datos: d,
    });
    falloApi('POST', MERCADO_URL, r.status, err.codigo, Date.now() - t0, err.message);
    throw err;
  }
  return d;
}

/** GET público del doctor. No se instrumenta: reportar el fallo del doctor
 *  al propio doctor sería un bucle. La página muestra el error tal cual. */
export async function diagnostico(params, opts) {
  const o = opts || {};
  const q = new URLSearchParams(Object.assign({ accion: 'doctor' }, params || {}));
  for (const [k, v] of Array.from(q.entries())) {
    if (v === null || v === undefined || v === '') q.delete(k);
  }
  const url = DIAG_URL + '?' + q.toString();
  let r;
  try {
    r = await conTiempo(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    }, o.ms || 20000);
  } catch (e) {
    throw new ErrorApi(mensajeDeError(e), { codigo: 'SIN_RED' });
  }
  const d = await leerJson(r);
  if (!r.ok || d.ok === false) {
    throw new ErrorApi(d.error || ('la nube respondió ' + r.status), {
      codigo: d.codigo || 'HTTP_' + r.status,
      status: r.status,
      datos: d,
    });
  }
  return d;
}

/** Último JSON bueno, para no dejar la pantalla en blanco sin red. */
export function guardarUltimo(clave, datos) {
  try {
    localStorage.setItem('fcore.panel.cache.' + clave, JSON.stringify({
      ts: Date.now(), datos,
    }));
  } catch (_) { /* sin espacio: no es crítico */ }
}

export function leerUltimo(clave, horas) {
  try {
    const crudo = JSON.parse(localStorage.getItem('fcore.panel.cache.' + clave) || 'null');
    if (!crudo || !crudo.datos) return null;
    const vida = (Number(horas) || 24) * 3600 * 1000;
    if (Date.now() - Number(crudo.ts || 0) > vida) return null;
    return crudo;
  } catch (_) { return null; }
}
