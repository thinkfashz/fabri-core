/* C10 · Favoritos
   Con cuenta se leen de `favoritos_listar`; sin cuenta, del espejo local.
   El precio que se pinta NO es el que se guardó: se cruza con el catálogo de
   hoy, así «bajó de precio» es un dato real y un producto eliminado se marca
   en vez de romper la página. */

import { API_BASE, mercado, mensajeDeError } from '../../comun/api.js';
import {
  leerLocales, guardarLocales, listarNube, subirLocales, quitar,
} from '../../comun/favoritos.js';
import { productosDe } from '../../comun/catalogo.js';
import { activa } from '../../comun/sesion.js';
import { clp, esc, iniciales } from '../../comun/formato.js';

const $ = (sel) => document.querySelector(sel);

const estado = {
  items: [],
  tab: 'producto',
  cargando: true,
  nube: false,
  extras: 0,
  error: '',
};

function aviso(html, tipo) {
  const caja = $('[data-aviso]');
  if (!caja) return;
  caja.innerHTML = html
    ? '<div class="aviso aviso--' + (tipo || 'warn') + '"><svg viewBox="0 0 24 24">' +
      '<path d="M12 9v4M12 17h.01"/><path d="M10.3 4.2 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/></svg>' +
      '<span>' + html + '</span></div>'
    : '';
}

function nombreClave(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

function clave(x) {
  return [x.tipo, x.localId || x.local_id || '', x.sku || ''].join('|');
}

function deNube(f) {
  const tipo = f.tipo === 'tienda' ? 'tienda' : 'producto';
  const existe = tipo === 'tienda' ? f.local_activo !== false : Boolean(f.sku);
  const precio = Number(f.precio_efectivo) || Number(f.precio) || 0;
  return {
    tipo,
    localId: String(f.favorito_local_id || ''),
    sku: String(f.favorito_sku || ''),
    nombre: String((existe && f.nombre) || f.nombre_guardado || 'Producto'),
    precio: existe ? precio : 0,
    precio_guardado: Number(f.precio_guardado) || 0,
    localNombre: String(f.local_nombre || ''),
    ico: f.local_ico || 'tienda',
    abierto: f.local_abierto !== false,
    activo: f.local_activo !== false,
    stock: f.stock === null || f.stock === undefined ? null : Number(f.stock),
    imagen: '',
    imagen_hash: f.imagen_hash || '',
    existe,
    soloLocal: false,
    creado: new Date(f.creado).getTime() || 0,
  };
}

function deLocal(f) {
  return {
    tipo: f.tipo === 'tienda' ? 'tienda' : 'producto',
    localId: String(f.local_id || ''),
    sku: String(f.sku || ''),
    nombre: String(f.nombre || 'Producto'),
    precio: Number(f.precio) || 0,
    precio_guardado: Number(f.precio) || 0,
    localNombre: String(f.local_nombre || ''),
    ico: f.ico || 'tienda',
    abierto: true,
    activo: true,
    stock: null,
    imagen: '',
    imagen_hash: '',
    existe: true,
    soloLocal: true,
    creado: Number(f.creado) || 0,
  };
}

/** Cruza los favoritos locales con el catálogo vivo, agrupando por tienda
 *  para no hacer una llamada por producto. */
async function refrescarLocales(items) {
  const ids = Array.from(new Set(items.map((x) => x.localId).filter(Boolean))).slice(0, 12);
  const tiendas = new Map();
  await Promise.all(ids.map(async (id) => {
    try {
      const d = await mercado('local_ver', { id });
      if (d && d.tienda) tiendas.set(id, d.tienda);
    } catch (_) { /* esa tienda se marca como no disponible */ }
  }));
  for (const it of items) {
    const t = tiendas.get(it.localId);
    if (!t) { it.existe = false; continue; }
    it.localNombre = t.nombre || it.localNombre;
    it.abierto = t.abierto !== false;
    it.activo = true;
    it.ico = t.ico || it.ico;
    // Una tienda guardada se valida como tienda: no se busca un producto
    // con su nombre dentro del catálogo.
    if (it.tipo === 'tienda') {
      it.existe = true;
      it.nombre = t.nombre || it.nombre;
      continue;
    }
    const catalogo = productosDe(t);
    const prod = catalogo.find((p) => p.sku && p.sku === it.sku) ||
      catalogo.find((p) => nombreClave(p.nombre) === nombreClave(it.nombre));
    if (!prod) { it.existe = false; continue; }
    it.existe = true;
    it.nombre = prod.nombre || it.nombre;
    it.precio = Number(prod.precio) || 0;
    it.stock = prod.stock === null || prod.stock === undefined ? null : Number(prod.stock);
    it.imagen = prod.imagen || '';
    it.imagen_hash = prod.imagen_hash || '';
  }
  return items;
}

function espejo(f) {
  return {
    tipo: f.tipo,
    local_id: f.localId,
    sku: f.sku,
    nombre: f.nombre,
    precio: f.precio_guardado || f.precio,
    local_nombre: f.localNombre,
    ico: f.ico,
    creado: f.creado || Date.now(),
  };
}

function mezclar(previos, nube) {
  const vistos = new Set(nube.map(clave));
  const extra = previos.filter((f) => !vistos.has(clave({ tipo: f.tipo, localId: f.local_id, sku: f.sku })));
  return nube.map(espejo).concat(extra).slice(0, 200);
}

async function cargar() {
  estado.cargando = true;
  estado.error = '';
  pintar();

  const locales = leerLocales();
  let items = [];

  if (activa()) {
    try {
      const d = await listarNube();
      const nube = (Array.isArray(d && d.favoritos) ? d.favoritos : []).map(deNube);
      const clavesNube = new Set(nube.map(clave));
      const extra = locales.filter((f) => !clavesNube.has(clave({ tipo: f.tipo, localId: f.local_id, sku: f.sku })));
      const extras = await refrescarLocales(extra.map(deLocal));
      guardarLocales(mezclar(locales, nube));
      items = nube.concat(extras);
      estado.nube = true;
      estado.extras = extras.length;
    } catch (e) {
      if (!e || (e.status !== 401 && e.codigo !== 'SIN_RED')) estado.error = mensajeDeError(e);
      items = await refrescarLocales(locales.map(deLocal));
      estado.nube = false;
      estado.extras = locales.length;
    }
  } else {
    items = await refrescarLocales(locales.map(deLocal));
    estado.nube = false;
    estado.extras = locales.length;
  }

  estado.items = items.sort((a, b) => b.creado - a.creado);
  estado.cargando = false;
  if (estado.error) aviso(esc(estado.error), 'err');
  else if (!activa()) {
    aviso('Tus favoritos están en este teléfono. <a href="/panel/cliente/cuenta/">Entra a tu cuenta</a> para tenerlos en todos tus dispositivos.', 'acento');
  } else if (estado.extras > 0) {
    aviso('Hay ' + estado.extras + ' favorito' + (estado.extras === 1 ? '' : 's') +
      ' guardado' + (estado.extras === 1 ? '' : 's') + ' sólo en este teléfono. Puedes subirlos a tu cuenta.', 'warn');
  } else {
    aviso('');
  }
  pintar();
}

function fotoProducto(f) {
  if (f.imagen) return '<img src="' + esc(f.imagen) + '" alt="">';
  if (f.imagen_hash && f.localId && f.sku) {
    const url = API_BASE + '/api/mercado?accion=imagen_ver&local_id=' + encodeURIComponent(f.localId) +
      '&sku=' + encodeURIComponent(f.sku) + '&v=' + encodeURIComponent(f.imagen_hash);
    return '<img src="' + esc(url) + '" alt="" loading="lazy">';
  }
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg>';
}

function itemHtml(f) {
  const esTienda = f.tipo === 'tienda';
  const destino = esTienda
    ? '/panel/cliente/tienda/?id=' + encodeURIComponent(f.localId)
    : '/panel/cliente/producto/?local=' + encodeURIComponent(f.localId) + '&sku=' + encodeURIComponent(f.sku);
  const baja = f.existe && f.precio_guardado > 0 && f.precio > 0 && f.precio < f.precio_guardado;
  const diferencia = baja ? f.precio_guardado - f.precio : 0;
  const pct = baja ? Math.round((diferencia / f.precio_guardado) * 100) : 0;

  const foto = esTienda
    ? '<span class="fav-item__foto fav-item__foto--tienda" aria-hidden="true">' + esc(iniciales(f.localNombre || f.nombre)) + '</span>'
    : '<a class="fav-item__foto" href="' + destino + '" aria-hidden="true" tabindex="-1">' + fotoProducto(f) + '</a>';

  const estadoTexto = !f.existe
    ? (esTienda ? 'Tienda no publicada' : 'Ya no está en el catálogo')
    : (esTienda
      ? (f.abierto ? 'Tienda abierta' : 'Tienda cerrada')
      : (f.abierto === false ? 'Tienda cerrada' : (f.stock !== null && f.stock <= 0 ? 'Agotado' : 'Disponible')));

  const nombre = f.existe
    ? '<a class="fav-item__nombre" href="' + destino + '">' + esc(f.nombre) + '</a>'
    : '<span class="fav-item__nombre">' + esc(f.nombre) + '</span>';

  const precio = esTienda
    ? '<b style="font-size:13px;color:' + (f.abierto && f.activo ? 'var(--ds-ok)' : 'var(--ds-text-tertiary)') + '">' +
      (f.activo ? (f.abierto ? 'abierta' : 'cerrada') : 'no publicada') + '</b>'
    : '<b>' + (f.existe ? clp(f.precio) : '—') + '</b>' +
      (f.precio_guardado > 0 && f.existe ? '<small>' + (baja ? 'antes ' + clp(f.precio_guardado) : 'guardado a ' + clp(f.precio_guardado)) + '</small>' : '') +
      (baja ? '<span class="fav-item__baja">−' + clp(diferencia) + ' · −' + pct + '%</span>' : '') +
      (!f.existe ? '<span class="fav-item__muerto">no disponible</span>' : '');

  return '<article class="fav-item' + (f.existe ? '' : ' fav-item--muerto') + '">' +
    foto +
    '<div class="fav-item__cuerpo">' + nombre +
      '<span class="fav-item__meta">' + esc(esTienda ? (estadoTexto) : (f.localNombre || 'Tienda') + ' · ' + estadoTexto) +
        (f.soloLocal ? ' · sólo en este teléfono' : '') + '</span>' +
    '</div>' +
    '<div class="fav-item__precio">' + precio + '</div>' +
    '<button class="fav-item__quitar" type="button" data-quitar data-tipo="' + esc(f.tipo) +
      '" data-local="' + esc(f.localId) + '" data-sku="' + esc(f.sku) +
      '" aria-label="Quitar ' + esc(f.nombre) + ' de favoritos">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20S4 15 4 9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15 12 20 12 20Z"/></svg>' +
    '</button>' +
  '</article>';
}

function listaHtml() {
  if (estado.cargando) {
    return '<div class="ds-skeleton" style="height:82px;border-radius:16px;margin-bottom:9px"></div>' +
      '<div class="ds-skeleton" style="height:82px;border-radius:16px;margin-bottom:9px"></div>' +
      '<div class="ds-skeleton" style="height:82px;border-radius:16px"></div>';
  }
  const lista = estado.items.filter((f) => f.tipo === estado.tab);
  if (!lista.length) {
    return '<div class="ds-empty fav-vacio">' +
      '<div class="ds-empty__icon"><svg viewBox="0 0 24 24"><path d="M12 20S4 15 4 9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15 12 20 12 20Z"/></svg></div>' +
      '<div class="ds-empty__title">' + (estado.tab === 'tienda' ? 'Sin tiendas guardadas' : 'Sin productos guardados') + '</div>' +
      '<p class="ds-empty__text">' + (estado.tab === 'tienda'
        ? 'Cuando una tienda te guste, guárdala para volver sin buscarla otra vez.'
        : 'Toca el corazón en la ficha de un producto y aparecerá acá con su precio de hoy.') + '</p>' +
      '<a class="ds-btn ds-btn--sm" href="/panel/cliente/buscar/">Buscar en el barrio</a>' +
    '</div>';
  }
  return lista.map(itemHtml).join('');
}

function cambiosHtml() {
  const bajas = estado.items
    .filter((f) => f.tipo === 'producto' && f.existe && f.precio_guardado > 0 && f.precio > 0 && f.precio < f.precio_guardado)
    .sort((a, b) => (b.precio_guardado - b.precio) - (a.precio_guardado - a.precio));
  const contador = $('[data-bajas]');
  if (contador) contador.textContent = String(bajas.length);
  if (!bajas.length) {
    return '<p class="fav-cambios__nota">Ninguno de tus productos guardados bajó de precio. ' +
      'El precio se revisa contra el catálogo cada vez que abres esta página.</p>';
  }
  return bajas.map((f) => {
    const dif = f.precio_guardado - f.precio;
    const pct = Math.round((dif / f.precio_guardado) * 100);
    return '<div class="fav-cambio">' +
      '<div class="fav-cambio__nombre">' + esc(f.nombre) +
        '<small>' + esc(f.localNombre || 'Tienda') + '</small></div>' +
      '<div class="fav-cambio__cifra"><b>' + clp(f.precio) + '</b>' +
        '<small>' + clp(f.precio_guardado) + '</small>' +
        '<span class="fav-item__baja">−' + pct + '%</span></div>' +
    '</div>';
  }).join('');
}

function pintar() {
  const lista = $('[data-lista]');
  const cambios = $('[data-cambios]');
  if (lista) lista.innerHTML = listaHtml();
  if (cambios) cambios.innerHTML = cambiosHtml();
  const nProd = estado.items.filter((f) => f.tipo === 'producto').length;
  const nTienda = estado.items.filter((f) => f.tipo === 'tienda').length;
  const a = $('[data-n-producto]');
  const b = $('[data-n-tienda]');
  if (a) a.textContent = String(nProd);
  if (b) b.textContent = String(nTienda);
  const sinc = $('[data-sincronizar]');
  if (sinc) {
    sinc.hidden = !(activa() && estado.nube && estado.extras > 0);
    sinc.disabled = false;
    sinc.textContent = 'Subir los de este teléfono (' + estado.extras + ')';
  }
}

async function quitarFavorito(boton) {
  boton.disabled = true;
  try {
    await quitar(boton.dataset.tipo, boton.dataset.local, boton.dataset.sku);
    estado.items = estado.items.filter((f) =>
      !(f.tipo === boton.dataset.tipo && f.localId === boton.dataset.local && f.sku === boton.dataset.sku));
    aviso('Quitado de favoritos.', 'ok');
    pintar();
  } catch (e) {
    boton.disabled = false;
    aviso(esc(mensajeDeError(e)), 'err');
  }
}

document.addEventListener('click', (e) => {
  const q = e.target.closest('[data-quitar]');
  if (q && !q.disabled) { quitarFavorito(q); return; }

  const tab = e.target.closest('[data-tab]');
  if (tab) {
    estado.tab = tab.dataset.tab;
    document.querySelectorAll('[data-tab]').forEach((b) => {
      b.setAttribute('aria-selected', b === tab ? 'true' : 'false');
    });
    pintar();
    return;
  }

  const sinc = e.target.closest('[data-sincronizar]');
  if (sinc) {
    sinc.disabled = true;
    sinc.textContent = 'Subiendo…';
    subirLocales().then((r) => {
      if (r.fallos) {
        aviso('Subimos ' + r.subidos + ' y fallaron ' + r.fallos + '. Revisa la conexión e inténtalo de nuevo.', 'warn');
        sinc.disabled = false;
        pintar();
      } else {
        aviso('Subimos ' + r.subidos + ' favorito' + (r.subidos === 1 ? '' : 's') + ' a tu cuenta.', 'ok');
        cargar();
      }
    }).catch((err) => {
      aviso(esc(mensajeDeError(err)), 'err');
      sinc.disabled = false;
      pintar();
    });
  }
});

cargar();
