/* Favoritos del panel.
   La misma lista vive en dos sitios: `fcore.panel.favoritos` en este
   navegador (para invitados y para pintar sin red) y `mercado_favoritos` en
   la nube cuando hay cuenta. Cada entrada local es un snapshot mínimo; el
   precio que se muestra en la página siempre sale del catálogo vivo. */

import { mercadoPost, ErrorApi } from './api.js';
import { activa, token, dispositivo } from './sesion.js';

const KEY = 'fcore.panel.favoritos';
const TOPE = 200;

export function clave(tipo, localId, sku) {
  return [tipo || 'producto', localId || '', sku || ''].join('|');
}

export function leerLocales() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(d) ? d.filter((x) => x && x.local_id) : [];
  } catch (_) { return []; }
}

export function guardarLocales(lista) {
  try {
    localStorage.setItem(KEY, JSON.stringify((Array.isArray(lista) ? lista : []).slice(0, TOPE)));
  } catch (_) { /* modo privado o sin espacio */ }
}

export function esFavorito(tipo, localId, sku) {
  const k = clave(tipo, localId, sku);
  return leerLocales().some((x) => clave(x.tipo, x.local_id, x.sku) === k);
}

function fijarLocal(tipo, localId, sku, datos, favorito) {
  const k = clave(tipo, localId, sku);
  const lista = leerLocales().filter((x) => clave(x.tipo, x.local_id, x.sku) !== k);
  if (favorito) {
    const d = datos || {};
    lista.unshift({
      tipo: tipo || 'producto',
      local_id: localId || '',
      sku: sku || '',
      nombre: String(d.nombre || ''),
      precio: Math.max(0, Math.round(Number(d.precio) || 0)),
      local_nombre: String(d.local_nombre || ''),
      ico: d.ico || 'tienda',
      creado: Date.now(),
    });
  }
  guardarLocales(lista);
  return favorito;
}

/** Corazón: alterna en la nube si hay cuenta y siempre deja el espejo local.
 *  Si la nube falla por red, el favorito igual queda en este teléfono; la
 *  página que llama decide si muestra el aviso. */
export async function alternar(tipo, localId, sku, datos) {
  const antes = esFavorito(tipo, localId, sku);
  if (activa()) {
    try {
      const d = await mercadoPost('favorito_alternar', {
        tipo: tipo || 'producto',
        local_id: localId || '',
        sku: sku || '',
      }, { token: token(), dispositivo: dispositivo() });
      fijarLocal(tipo, localId, sku, datos, d.favorito);
      return { favorito: Boolean(d.favorito), nube: true };
    } catch (e) {
      // Sesión vencida o red: se sigue con el espejo local.
      if (!(e instanceof ErrorApi) || (e.status !== 401 && e.codigo !== 'SIN_RED')) throw e;
    }
  }
  return { favorito: fijarLocal(tipo, localId, sku, datos, !antes), nube: false };
}

/** Quita sin alternar (la página de favoritos no debe volver a agregarlo). */
export async function quitar(tipo, localId, sku) {
  if (esFavorito(tipo, localId, sku)) return alternar(tipo, localId, sku, null);
  return { favorito: false, nube: false };
}

export async function listarNube() {
  if (!activa()) return null;
  return mercadoPost('favoritos_listar', {}, {
    token: token(), dispositivo: dispositivo(),
  });
}

/** Sube los favoritos de este teléfono que la cuenta todavía no tiene.
 *  Primero lee la nube para no alternar (y borrar) los que ya están. */
export async function subirLocales() {
  if (!activa()) return { subidos: 0, fallos: 0, total: 0 };
  const locales = leerLocales();
  if (!locales.length) return { subidos: 0, fallos: 0, total: 0 };
  let nube = [];
  try {
    const d = await listarNube();
    nube = Array.isArray(d && d.favoritos) ? d.favoritos : [];
  } catch (_) { return { subidos: 0, fallos: locales.length, total: locales.length }; }

  const ya = new Set(nube.map((f) => clave(f.tipo, f.favorito_local_id, f.favorito_sku)));
  let subidos = 0;
  let fallos = 0;
  for (const f of locales.slice(0, 100)) {
    if (ya.has(clave(f.tipo, f.local_id, f.sku))) continue;
    try {
      await mercadoPost('favorito_alternar', {
        tipo: f.tipo, local_id: f.local_id, sku: f.sku || '',
      }, { token: token(), dispositivo: dispositivo() });
      subidos++;
    } catch (_) { fallos++; }
  }
  return { subidos, fallos, total: locales.length };
}
