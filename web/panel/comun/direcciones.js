/* Direcciones del comprador.
   Con cuenta viven en `mercado_direcciones`; sin cuenta, en
   `fcore.panel.direcciones` de este navegador. En ambos casos se deja un
   espejo local con la misma forma para que el checkout las ofrezca sin
   esperar a la red. `lat`/`lon` en 0 significan «sin pin», no una ubicación
   inventada. */

import { mercadoPost, ErrorApi } from './api.js';
import { activa, token, dispositivo } from './sesion.js';

const KEY = 'fcore.panel.direcciones';
const TOPE = 20;

export function leerLocales() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(d) ? d.filter((x) => x && x.id) : [];
  } catch (_) { return []; }
}

export function guardarLocales(lista) {
  try {
    localStorage.setItem(KEY, JSON.stringify((Array.isArray(lista) ? lista : []).slice(0, TOPE)));
  } catch (_) { /* modo privado */ }
}

export function predeterminada(lista) {
  const l = Array.isArray(lista) ? lista : leerLocales();
  return l.find((x) => x.predeterminada) || l[0] || null;
}

function normalizar(f) {
  return {
    id: String(f.id || ''),
    alias: String(f.alias || 'Dirección'),
    direccion: String(f.direccion || ''),
    comuna: String(f.comuna || ''),
    referencia: String(f.referencia || ''),
    lat: Number(f.lat) || 0,
    lon: Number(f.lon) || 0,
    predeterminada: Boolean(f.predeterminada),
  };
}

function ordenar(lista) {
  return lista.slice().sort((a, b) => {
    if (a.predeterminada !== b.predeterminada) return a.predeterminada ? -1 : 1;
    return 0;
  });
}

function espejo(fila) {
  const n = normalizar(fila);
  const lista = leerLocales().filter((x) => x.id !== n.id);
  if (n.predeterminada) for (const x of lista) x.predeterminada = false;
  lista.unshift(n);
  guardarLocales(ordenar(lista));
  return n;
}

/** Lista para pintar y para el checkout. Si la nube falla por red, devuelve
 *  el espejo local en vez de dejar la página vacía. */
export async function listar() {
  if (activa()) {
    try {
      const d = await mercadoPost('direcciones_listar', {}, {
        token: token(), dispositivo: dispositivo(),
      });
      const lista = (Array.isArray(d.direcciones) ? d.direcciones : []).map(normalizar);
      guardarLocales(ordenar(lista));
      return { direcciones: lista, nube: true };
    } catch (e) {
      if (!(e instanceof ErrorApi) || (e.status !== 401 && e.codigo !== 'SIN_RED')) throw e;
    }
  }
  return { direcciones: leerLocales(), nube: false };
}

/** Crea o edita. Devuelve `{ direccion, nube }`. */
export async function guardar(datos) {
  const d = datos || {};
  if (activa()) {
    try {
      const r = await mercadoPost('direccion_guardar', {
        id: d.id || '',
        alias: d.alias || '',
        direccion: d.direccion || '',
        comuna: d.comuna || '',
        referencia: d.referencia || '',
        lat: Number(d.lat) || 0,
        lon: Number(d.lon) || 0,
        predeterminada: Boolean(d.predeterminada),
      }, { token: token(), dispositivo: dispositivo() });
      return { direccion: espejo(r.direccion), nube: true };
    } catch (e) {
      if (!(e instanceof ErrorApi) || (e.status !== 401 && e.codigo !== 'SIN_RED')) throw e;
    }
  }

  const lista = leerLocales();
  const id = d.id || ('local-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  const fila = normalizar({
    id,
    alias: d.alias || 'Dirección',
    direccion: d.direccion,
    comuna: d.comuna,
    referencia: d.referencia,
    lat: d.lat,
    lon: d.lon,
    predeterminada: Boolean(d.predeterminada) || lista.length === 0,
  });
  const sinVieja = lista.filter((x) => x.id !== id);
  if (fila.predeterminada) for (const x of sinVieja) x.predeterminada = false;
  sinVieja.unshift(fila);
  guardarLocales(ordenar(sinVieja));
  return { direccion: fila, nube: false };
}

/** Borra y, si cayó la predeterminada, deja la primera que quede. */
export async function borrar(id) {
  if (activa()) {
    try {
      await mercadoPost('direccion_borrar', { id }, {
        token: token(), dispositivo: dispositivo(),
      });
    } catch (e) {
      if (!(e instanceof ErrorApi) || (e.status !== 401 && e.codigo !== 'SIN_RED')) throw e;
    }
  }
  const lista = leerLocales().filter((x) => x.id !== id);
  if (lista.length && !lista.some((x) => x.predeterminada)) lista[0].predeterminada = true;
  guardarLocales(ordenar(lista));
  return { borrada: true };
}
