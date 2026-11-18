/* Cliente HTTP del panel.
   La API vive en OTRO proyecto de Vercel: la base es absoluta a propósito.
   `/api/auth` relativo pega en la auth vieja de Go y falla sin explicación. */

export const API_BASE = 'https://fabri-api.vercel.app';
export const AUTH_URL = API_BASE + '/api/auth';
export const MERCADO_URL = API_BASE + '/api/mercado';

const ESPERA_MS = 14000;

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
  try {
    r = await conTiempo(AUTH_URL, {
      method: 'POST',
      headers: cabeceras,
      body: JSON.stringify(Object.assign({ accion }, datos || {})),
    }, o.ms);
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
  for (let intento = 0; intento < 2; intento++) {
    try {
      const r = await conTiempo(url, { headers: cabeceras, cache: 'no-store' }, o.ms);
      const d = await leerJson(r);
      if (!r.ok || d.ok === false) {
        throw new ErrorApi(d.error || ('la nube respondió ' + r.status), {
          codigo: d.codigo || 'HTTP_' + r.status,
          status: r.status,
          datos: d,
        });
      }
      return d;
    } catch (e) {
      ultimo = e;
      // Un error del servidor no se reintenta: la respuesta ya es la verdad.
      if (e instanceof ErrorApi) break;
      if (intento === 0) await new Promise((s) => setTimeout(s, 450));
    }
  }
  throw ultimo instanceof ErrorApi
    ? ultimo
    : new ErrorApi(mensajeDeError(ultimo), { codigo: 'SIN_RED' });
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
  try {
    r = await conTiempo(MERCADO_URL, {
      method: 'POST',
      headers: cabeceras,
      body: JSON.stringify(Object.assign({ accion }, datos || {})),
    }, o.ms);
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
