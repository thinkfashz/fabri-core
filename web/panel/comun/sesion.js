/* Sesión del panel.
   Usa EXACTAMENTE las mismas claves que `web/app/core-nube.js`, para que
   entrar en la PWA valga acá y al revés:
     fcore.nube       → { token, exp, usuario, guardado }
     fcore.dispositivo → id aleatorio del navegador
   La API es la misma (`fabri-api`), no una copia. */

import { auth, ErrorApi } from './api.js';

const KEY = 'fcore.nube';
const DISP = 'fcore.dispositivo';
const EVENTO = 'fcore:sesion';

function avisar() {
  try { window.dispatchEvent(new CustomEvent(EVENTO)); } catch (_) { /* sin window */ }
}

export function dispositivo() {
  try {
    const previo = localStorage.getItem(DISP);
    if (previo && /^[A-Za-z0-9_-]{16,64}$/.test(previo)) return previo;
    const b = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
    const id = Array.prototype.map.call(b, (x) => ('0' + x.toString(16)).slice(-2)).join('');
    localStorage.setItem(DISP, id);
    return id;
  } catch (_) { return 'navegador'; }
}

export function leer() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    return d && d.token ? d : null;
  } catch (_) { return null; }
}

export function activa() {
  const d = leer();
  return Boolean(d && d.token && (!d.exp || d.exp > Date.now()));
}

export function token() {
  const d = leer();
  return d ? d.token : '';
}

export function usuario() {
  const d = leer();
  return d && d.usuario ? d.usuario : null;
}

function guardar(res) {
  if (!res || !res.token) return null;
  const previo = leer() || {};
  const dato = {
    token: res.token,
    exp: Number(res.expira) || Number(res.exp) || 0,
    usuario: res.usuario || previo.usuario || null,
    guardado: Date.now(),
  };
  try { localStorage.setItem(KEY, JSON.stringify(dato)); } catch (_) { /* modo privado */ }
  avisar();
  return dato;
}

export function limpiar() {
  try { localStorage.removeItem(KEY); } catch (_) { /* nada */ }
  avisar();
}

/** Entrar con correo y contraseña. Devuelve el usuario o lanza ErrorApi. */
export async function entrar(email, pass) {
  const d = await auth('entrar', {
    email: String(email || '').trim().toLowerCase(),
    pass: String(pass || ''),
    dispositivo: dispositivo(),
  });
  guardar(d);
  return d.usuario;
}

/** Crear cuenta. `acepta_terminos` es obligatorio en el servidor. */
export async function registrar(opciones) {
  const o = opciones || {};
  const d = await auth('registrar', {
    email: String(o.email || '').trim().toLowerCase(),
    nombre: String(o.nombre || '').trim(),
    pass: String(o.pass || ''),
    acepta_terminos: true,
    dispositivo: dispositivo(),
  });
  guardar(d);
  return d.usuario;
}

/** Revalidar el token contra la nube. Si venció o lo revocaron, limpia. */
export async function refrescar() {
  const d = leer();
  if (!d || !d.token) return null;
  try {
    const r = await auth('sesion', { dispositivo: dispositivo() }, { token: d.token });
    const actual = leer() || d;
    actual.usuario = r.usuario || actual.usuario;
    actual.exp = Number(r.expira) || actual.exp;
    try { localStorage.setItem(KEY, JSON.stringify(actual)); } catch (_) { /* nada */ }
    avisar();
    return actual.usuario;
  } catch (e) {
    if (e instanceof ErrorApi && (e.status === 401 || e.status === 403)) limpiar();
    return null;
  }
}

export async function salir() {
  const d = leer();
  if (d && d.token) {
    try { await auth('salir', { dispositivo: dispositivo() }, { token: d.token }); }
    catch (_) { /* aunque falle, la sesión local se cierra igual */ }
  }
  limpiar();
}

/** Baja de la propia cuenta: exige correo y contraseña otra vez. */
export async function borrar(email, pass) {
  const d = await auth('borrar', {
    email: String(email || '').trim().toLowerCase(),
    pass: String(pass || ''),
  });
  limpiar();
  return d;
}

/** Paso 1 de la recuperación: pide el código de 6 dígitos al correo. */
export async function recuperar(email) {
  return auth('recuperar', { email: String(email || '').trim().toLowerCase() });
}

/** Paso 2: canjea el código y deja la sesión abierta con la clave nueva. */
export async function recuperarCodigo(datos) {
  const d = datos || {};
  const r = await auth('recuperar_codigo', {
    email: String(d.email || '').trim().toLowerCase(),
    codigo: String(d.codigo || '').replace(/\D/g, '').slice(0, 6),
    pass: String(d.pass || ''),
    nombre: String(d.nombre || '').trim(),
    dispositivo: dispositivo(),
  });
  guardar(r);
  return r.usuario;
}

export function alCambiar(fn) {
  window.addEventListener(EVENTO, fn);
  return () => window.removeEventListener(EVENTO, fn);
}
