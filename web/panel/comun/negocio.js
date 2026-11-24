/* Base del panel Negocio.
   Reutiliza la MISMA sesión que el panel Cliente y la PWA (`fcore.nube`):
   entrar en cualquiera de los tres vale para todos. Sobre esa sesión resuelve
   la tienda activa con `local_mio` y entrega un contexto uniforme a cada
   módulo. Ningún módulo habla con la API por su cuenta. */

import { mercadoPost, mensajeDeError } from './api.js';
import { activa, leer as leerSesion, token, dispositivo, entrar, alCambiar } from './sesion.js';
import { esc, iniciales } from './formato.js';

const CLAVE_TIENDA = 'fcore.panel.negocio.tienda';
const $ = (sel, raiz) => (raiz || document).querySelector(sel);

export const ESTADOS = {
  nuevo: { t: 'Nuevo', pill: 'pill--acento' },
  visto: { t: 'En preparación', pill: 'pill--warn' },
  listo: { t: 'Listo', pill: 'pill--ok' },
  entregado: { t: 'Entregado', pill: 'pill--ok' },
  cancelado: { t: 'Cancelado', pill: 'pill--err' },
};

export function estadoDe(clave) {
  return ESTADOS[clave] || { t: clave || '—', pill: '' };
}

/* ── API ─────────────────────────────────────────────────────────────────── */

export function llamar(accion, cuerpo, opciones) {
  const o = opciones || {};
  return mercadoPost(accion, cuerpo || {}, {
    token: o.token || token(),
    dispositivo: o.dispositivo || dispositivo(),
    ms: o.ms,
  });
}

export async function misTiendas() {
  const d = await llamar('local_mio');
  return {
    cuenta: d.cuenta || null,
    tiendas: Array.isArray(d.tiendas) ? d.tiendas : [],
  };
}

/* ── tienda activa ───────────────────────────────────────────────────────── */

export function tiendaGuardada() {
  try { return localStorage.getItem(CLAVE_TIENDA) || ''; } catch (_) { return ''; }
}

export function guardarTienda(id) {
  try { localStorage.setItem(CLAVE_TIENDA, String(id || '')); } catch (_) { /* modo privado */ }
}

/* ── piezas de interfaz ──────────────────────────────────────────────────── */

const ICO_ACCESO = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M4 10h16v10H4z"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v2"/></svg>';

export function accesoHtml(mensaje) {
  return '<section class="neg-acceso" aria-labelledby="neg-acceso-titulo">' +
    '<div class="neg-acceso__ico">' + ICO_ACCESO + '</div>' +
    '<p class="neg-acceso__kicker">Panel Negocio</p>' +
    '<h1 id="neg-acceso-titulo">Entra a tu negocio</h1>' +
    '<p class="neg-acceso__sub">Usa la misma cuenta que en la app. Aquí administras ' +
      'tu tienda, los pedidos y el catálogo.</p>' +
    (mensaje ? '<div class="aviso aviso--err" role="alert">' + esc(mensaje) + '</div>' : '') +
    '<form class="neg-acceso__form" data-acceso novalidate>' +
      '<label class="campo"><span>Correo</span>' +
        '<input type="email" name="email" autocomplete="email" required placeholder="tu@correo.cl"></label>' +
      '<label class="campo"><span>Contraseña</span>' +
        '<input type="password" name="pass" autocomplete="current-password" required minlength="6" placeholder="Tu contraseña"></label>' +
      '<div class="neg-acceso__error" data-error role="alert" hidden></div>' +
      '<button class="ds-btn ds-btn--primary ds-btn--block" type="submit" data-entrar>Entrar</button>' +
    '</form>' +
    '<p class="neg-acceso__pie">¿Todavía no tienes cuenta? ' +
      '<a href="/panel/cliente/cuenta/">Créala en tu cuenta de cliente</a> y vuelve aquí. ' +
      'La sesión se comparte entre los dos paneles.</p>' +
  '</section>';
}

export function montarAcceso(caja, alEntrar) {
  const form = $('[data-acceso]', caja);
  if (!form) return;
  const error = $('[data-error]', caja);
  const boton = $('[data-entrar]', caja);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (boton.disabled) return;
    const email = String(form.email.value || '').trim();
    const pass = String(form.pass.value || '');
    if (!email || !pass) {
      if (error) { error.textContent = 'Escribe tu correo y tu contraseña.'; error.hidden = false; }
      return;
    }
    boton.disabled = true;
    boton.textContent = 'Entrando…';
    if (error) error.hidden = true;
    try {
      await entrar(email, pass);
      if (alEntrar) alEntrar();
    } catch (fallo) {
      if (error) {
        error.textContent = mensajeDeError(fallo);
        error.hidden = false;
      }
      boton.disabled = false;
      boton.textContent = 'Entrar';
    }
  });
}

function cargandoHtml() {
  return '<div class="neg-cargando" aria-live="polite">' +
    '<div class="ds-skeleton neg-cargando__barra"></div>' +
    '<div class="ds-skeleton neg-cargando__bloque"></div>' +
    '<div class="ds-skeleton neg-cargando__bloque"></div>' +
    '<span class="sr-only">Cargando tu negocio…</span></div>';
}

function errorHtml(mensaje) {
  return '<div class="neg-estado" role="alert">' +
    '<h2>No pudimos abrir tu negocio</h2>' +
    '<p>' + esc(mensaje) + '</p>' +
    '<button class="ds-btn ds-btn--secondary" type="button" data-reintentar>Reintentar</button>' +
  '</div>';
}

function sinTiendaHtml(cuenta) {
  const nombre = cuenta && cuenta.nombre ? cuenta.nombre : '';
  return '<div class="neg-estado">' +
    '<h2>Tu cuenta no tiene una tienda publicada</h2>' +
    '<p>' + (nombre ? 'Hola, ' + esc(nombre) + '. ' : '') +
      'Para administrar un negocio primero hay que publicarlo. Se hace una vez ' +
      'desde el panel del dueño en la app y queda ligado a esta cuenta.</p>' +
    '<div class="neg-estado__acciones">' +
      '<a class="ds-btn ds-btn--primary" href="/app/">Publicar mi tienda</a>' +
      '<a class="ds-btn ds-btn--ghost" href="/panel/cliente/cuenta/">Ver mi cuenta</a>' +
    '</div>' +
  '</div>';
}

function tiendaChip(t) {
  const abierta = t.abierto !== false;
  return '<span class="neg-tienda__logo" aria-hidden="true">' +
      (t.logo ? '<img src="' + esc(t.logo) + '" alt="">' : esc(iniciales(t.nombre || '?'))) +
    '</span>' +
    '<span class="neg-tienda__txt"><b>' + esc(t.nombre || 'Mi tienda') + '</b>' +
      '<small><span class="neg-punto' + (abierta ? ' neg-punto--ok' : '') + '"></span>' +
      (abierta ? 'Abierta' : 'Cerrada') + '</small></span>';
}

/* Al cerrar sesión o borrar la última tienda hay que vaciar el chip de la
   barra: el DOM del shell sobrevive al repintado del módulo, así que si no se
   limpia queda el nombre de una tienda que ya no existe. */
function limpiarSlot() {
  const slot = $('[data-tienda-slot]');
  if (slot) slot.innerHTML = '';
}

function pintarSlot(ctx, alElegir) {
  const slot = $('[data-tienda-slot]');
  if (!slot) return;
  const t = ctx.tienda;
  if (!t) { slot.innerHTML = ''; return; }
  if (ctx.tiendas.length <= 1) {
    slot.innerHTML = '<span class="neg-tienda">' + tiendaChip(t) + '</span>';
    return;
  }
  slot.innerHTML = '<label class="neg-tienda neg-tienda--sel">' + tiendaChip(t) +
    '<select data-tienda-sel aria-label="Elegir tienda">' +
      ctx.tiendas.map((x) => '<option value="' + esc(x.id) + '"' +
        (x.id === t.id ? ' selected' : '') + '>' + esc(x.nombre || x.id) + '</option>').join('') +
    '</select></label>';
  const sel = $('[data-tienda-sel]', slot);
  if (sel) sel.addEventListener('change', () => alElegir(sel.value));
}

/* ── arranque ────────────────────────────────────────────────────────────── */

let enAcceso = false;
let escuchando = false;

function escucharSesion(o) {
  if (escuchando) return;
  escuchando = true;
  alCambiar(() => {
    if (!activa()) {
      enAcceso = true;
      arrancar(o);
    } else if (enAcceso) {
      arrancar(o);
    }
  });
}

/**
 * Punto de entrada de cada módulo. Resuelve sesión + tienda y llama a
 * `alListo(ctx)`. Si no hay sesión pinta el acceso; si no hay tienda, un
 * estado honesto con el camino para publicarla.
 */
export async function arrancar(opciones) {
  const o = opciones || {};
  const caja = o.caja || $('[data-negocio]');
  if (!caja) return null;

  escucharSesion(o);

  if (!activa()) {
    enAcceso = true;
    limpiarSlot();
    caja.innerHTML = accesoHtml(o.mensaje);
    montarAcceso(caja, () => arrancar(o));
    return null;
  }
  enAcceso = false;

  caja.innerHTML = cargandoHtml();
  let datos;
  try {
    /* Si la nube tarda, no se dejan tres esqueletos para siempre: a los 12 s
       se muestra un error con «Reintentar» y el dueño sabe qué pasó. */
    datos = await Promise.race([
      misTiendas(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('la nube tardó demasiado')), 12000)),
    ]);
  } catch (fallo) {
    if (fallo && fallo.status === 401) {
      enAcceso = true;
      limpiarSlot();
      caja.innerHTML = accesoHtml(mensajeDeError(fallo));
      montarAcceso(caja, () => arrancar(o));
      return null;
    }
    limpiarSlot();
    caja.innerHTML = errorHtml(mensajeDeError(fallo));
    const b = $('[data-reintentar]', caja);
    if (b) b.addEventListener('click', () => arrancar(o));
    return null;
  }

  const tiendas = datos.tiendas;
  if (!tiendas.length) {
    limpiarSlot();
    caja.innerHTML = sinTiendaHtml(datos.cuenta);
    return null;
  }

  const guardada = tiendaGuardada();
  let actual = tiendas.find((t) => t.id === guardada) || tiendas[0];
  guardarTienda(actual.id);

  function repintar() { pintarSlot(ctx, (id) => ctx.elegir(id)); }

  const ctx = {
    cuenta: datos.cuenta,
    tiendas,
    get tienda() { return actual; },
    elegir(id) {
      const t = tiendas.find((x) => x.id === id);
      if (!t) return;
      actual = t;
      guardarTienda(t.id);
      repintar();
      if (o.alListo) o.alListo(ctx);
    },
    /* Cambia un campo local de la tienda (por ejemplo `abierto`) sin volver
       a pedir todo a la nube. El módulo que lo usa ya sabe que el cambio se
       guardó. */
    fijar(parcial) {
      actual = Object.assign({}, actual, parcial);
      repintar();
    },
    recargar() { return arrancar(o); },
    llamar,
    salirSesion: async () => {
      const s = await import('./sesion.js');
      await s.salir();
      arrancar(o);
    },
  };

  repintar();
  if (o.alListo) o.alListo(ctx);
  return ctx;
}

export { leerSesion, token, dispositivo };

/* ── imágenes ──────────────────────────────────────────────────────────────
   El catálogo guarda la foto como data URL y publica una URL corta. Para no
   viajar con imágenes de 4 MB, se achican en el navegador antes de subirlas. */

export function comprimirImagen(file, opciones) {
  const o = opciones || {};
  const maxPx = o.maxPx || 640;
  const maxBytes = o.maxBytes || 200 * 1024;
  const calidad = o.calidad || 0.7;
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type || '')) {
      reject(new Error('Elige una imagen JPG, PNG o WebP.'));
      return;
    }
    const lector = new FileReader();
    lector.onerror = () => reject(new Error('No pudimos leer la imagen.'));
    lector.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('La imagen no se pudo abrir.'));
      img.onload = () => {
        const lado = Math.max(img.width || 1, img.height || 1);
        const k = Math.min(1, maxPx / lado);
        const w = Math.max(1, Math.round((img.width || 1) * k));
        const h = Math.max(1, Math.round((img.height || 1) * k));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        if (!ctx) { reject(new Error('Este navegador no puede procesar la imagen.')); return; }
        // Fondo blanco: un PNG con transparencia no debe quedar negro.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        let uri = c.toDataURL('image/jpeg', calidad);
        if (uri.length > maxBytes) uri = c.toDataURL('image/jpeg', 0.5);
        if (uri.length > maxBytes) {
          reject(new Error('La imagen queda muy pesada. Usa una más simple.'));
          return;
        }
        resolve(uri);
      };
      img.src = String(lector.result);
    };
    lector.readAsDataURL(file);
  });
}
