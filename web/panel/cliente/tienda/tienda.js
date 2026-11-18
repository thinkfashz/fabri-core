/* C04 · Tienda
   El link de una marca: portada, ficha de confianza y catálogo completo.
   Agregar respeta stock y tienda cerrada; el mínimo y el envío se avisan acá
   y se vuelven a validar en el checkout contra el servidor. */

import { mercado, guardarUltimo, leerUltimo, mensajeDeError } from '../../comun/api.js';
import { productosDe, porCategoria, ubicacionGuardada, distanciaKm } from '../../comun/catalogo.js';
import { leer, agregar, cambiar } from '../../comun/carrito.js';
import { clp, km, esc, iniciales, minutos } from '../../comun/formato.js';

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);
const estado = { tienda: null, productos: [], error: '' };

function aviso(html) {
  const caja = $('[data-aviso]');
  if (caja) caja.innerHTML = html;
}

function cantidadDe(pid) {
  const carrito = leer();
  for (const id of Object.keys(carrito)) {
    const it = carrito[id] && carrito[id].items ? carrito[id].items[pid] : null;
    if (it) return Number(it.c || it) || 0;
  }
  return 0;
}

function unidadesDe(tiendaId) {
  const g = leer()[tiendaId];
  if (!g || !g.items) return 0;
  return Object.keys(g.items).reduce((a, pid) => a + (Number(g.items[pid].c || g.items[pid]) || 0), 0);
}

function subtotalDe(tiendaId) {
  const g = leer()[tiendaId];
  if (!g || !g.items) return 0;
  return Object.keys(g.items).reduce((a, pid) => {
    const it = g.items[pid];
    return a + (Number(it.p) || 0) * (Number(it.c || it) || 0);
  }, 0);
}

function logoHtml(t, clase) {
  if (t.logo) return '<span class="logo-tienda ' + clase + '"><img src="' + esc(t.logo) + '" alt=""></span>';
  return '<span class="logo-tienda ' + clase + '" aria-hidden="true">' + esc(iniciales(t.nombre || t.marca)) + '</span>';
}

function estrellas(cal) {
  const n = Number(cal && cal.n) || 0;
  const p = Number(cal && cal.promedio) || 0;
  if (!n) return 'Sin reseñas todavía';
  return '★ ' + p.toFixed(1).replace('.', ',') + ' · ' + n + ' reseña' + (n === 1 ? '' : 's');
}

function ficha(t) {
  const entrega = Array.isArray(t.entrega) ? t.entrega : ['retiro'];
  const datos = [];
  if (t.horario) datos.push(['Horario', esc(t.horario)]);
  datos.push(['Mínimo', t.minimo > 0 ? clp(t.minimo) : 'Sin mínimo']);
  datos.push(['Envío', entrega.includes('delivery')
    ? (t.envio > 0 ? clp(t.envio) : 'Gratis')
    : 'Solo retiro']);
  datos.push(['Entrega', entrega.map((e) => e === 'delivery' ? 'Delivery' : 'Retiro').join(' · ')]);
  datos.push(['Reseñas', estrellas(t.calificacion)]);
  return '<div class="ficha">' + datos.map(([k, v]) =>
    '<div class="ficha__dato"><small>' + k + '</small><b>' + v + '</b></div>'
  ).join('') + '</div>';
}

function control(p) {
  const n = cantidadDe(p.id);
  if (p.stock !== null && p.stock <= 0) {
    return '<button class="producto__agregar" type="button" disabled>Agotado</button>';
  }
  if (!n) {
    return '<button class="producto__agregar" type="button" data-add="' + esc(p.id) + '">Agregar</button>';
  }
  return '<div class="qty">' +
    '<button type="button" data-menos="' + esc(p.id) + '" aria-label="Quitar uno de ' + esc(p.nombre) + '">−</button>' +
    '<output aria-label="Cantidad">' + n + '</output>' +
    '<button type="button" data-mas="' + esc(p.id) + '" aria-label="Agregar uno de ' + esc(p.nombre) + '">+</button>' +
    '</div>';
}

function filaProducto(p) {
  return '<div class="producto">' +
    (p.imagen
      ? '<span class="mini"><img src="' + esc(p.imagen) + '" alt="" loading="lazy"></span>'
      : '<span class="mini" aria-hidden="true">' + esc(iniciales(p.nombre)) + '</span>') +
    '<div class="producto__cuerpo">' +
      '<div class="producto__nombre">' + esc(p.nombre) + '</div>' +
      '<div class="producto__meta">' + esc(p.unidad) +
        (p.stock !== null && p.stock > 0 && p.stock <= 5 ? ' · <span class="ds-badge ds-badge--warn">quedan ' + p.stock + '</span>' : '') +
      '</div>' +
    '</div>' +
    '<div class="producto__precio">' +
      '<b class="precio precio--sm' + (p.descuento ? ' precio--oferta' : '') + '">' + clp(p.precio) + '</b>' +
      (p.descuento ? '<span class="precio-lista">' + clp(p.lista) + '</span>' : '') +
    '</div>' +
    '<div class="producto__control">' + control(p) + '</div>' +
  '</div>';
}

function barra(t) {
  const caja = $('[data-barra]');
  if (!caja) return;
  const n = unidadesDe(t.id);
  if (!n) {
    caja.hidden = true;
    caja.innerHTML = '';
    return;
  }
  const subtotal = subtotalDe(t.id);
  const falta = Math.max(0, (Number(t.minimo) || 0) - subtotal);
  caja.hidden = false;
  caja.innerHTML =
    '<div class="barra-inferior__dato"><small>Tu pedido en ' + esc(t.nombre) + '</small>' +
      '<span>' + n + ' producto' + (n === 1 ? '' : 's') +
      (falta ? ' · faltan <b>' + clp(falta) + '</b> para el mínimo' : '') + '</span></div>' +
    '<div class="barra-inferior__total"><small>Subtotal</small><b>' + clp(subtotal) + '</b></div>' +
    '<a class="ds-btn" href="/panel/cliente/carrito/">Ver carrito</a>';
}

function pintar() {
  const t = estado.tienda;
  const caja = $('[data-tienda]');
  if (!caja) return;
  const abierta = t.abierto !== false;
  const productos = estado.productos;
  const ubi = ubicacionGuardada();
  const dist = ubi ? distanciaKm(ubi.lat, ubi.lon, t.lat, t.lon) : null;
  const grupos = porCategoria(productos);
  const url = location.origin + '/panel/cliente/tienda/?id=' + encodeURIComponent(t.id);

  caja.innerHTML =
    '<nav class="migas" aria-label="Ruta"><a href="/panel/cliente/inicio/">Inicio</a> <span>/</span> ' +
      '<a href="/panel/cliente/buscar/">Buscar</a> <span>/</span> <span aria-current="page">' + esc(t.nombre) + '</span></nav>' +
    '<header class="tienda-hero">' +
      '<div class="tienda-hero__top">' +
        logoHtml(t, 'logo-tienda--lg') +
        '<div class="tienda-hero__id">' +
          '<h1 class="tienda-hero__nombre">' + esc(t.nombre) + '</h1>' +
          '<div class="tienda-hero__meta">' +
            '<span class="pill ' + (abierta ? 'pill--ok' : 'pill--err') + '">' + (abierta ? 'Abierta ahora' : 'Cerrada') + '</span>' +
            '<span>' + esc(t.rubro || 'Tienda') + '</span>' +
            (t.comuna ? '<span>· ' + esc(t.comuna) + '</span>' : '') +
            (dist !== null ? '<span>· a ' + km(dist) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="tienda-hero__acciones">' +
          '<button class="compartir" type="button" data-compartir>' +
            '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.7 6.8-4M8.6 13.3l6.8 4"/></svg>' +
            'Compartir</button>' +
        '</div>' +
      '</div>' +
      (t.descripcion ? '<p class="tienda-hero__desc">' + esc(t.descripcion) + '</p>' : '') +
      (t.direccion ? '<p class="tienda-hero__desc" style="margin-top:8px">' + esc(t.direccion) + (t.comuna ? ', ' + esc(t.comuna) : '') + '</p>' : '') +
      ficha(t) +
    '</header>' +
    (!abierta ? '<div class="cerrada-banda"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>' +
      '<span>La tienda está cerrada. Puedes mirar el catálogo, pero no agregar productos hasta que abra.</span></div>' : '') +
    (productos.length
      ? '<nav class="cat-nav" aria-label="Categorías">' + grupos.map(([cat]) =>
          '<a href="#cat-' + esc(cat.toLowerCase().replace(/[^a-z0-9]+/g, '-')) + '">' + esc(cat) + '</a>').join('') + '</nav>' +
        '<div class="catalogo">' + grupos.map(([cat, lista]) =>
          '<section class="cat-grupo" id="cat-' + esc(cat.toLowerCase().replace(/[^a-z0-9]+/g, '-')) + '">' +
            '<h2 class="cat-titulo">' + esc(cat) + ' <span>' + lista.length + '</span></h2>' +
            lista.map(filaProducto).join('') +
          '</section>').join('') + '</div>'
      : '<div class="ds-empty"><div class="ds-empty__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg></div>' +
        '<div class="ds-empty__title">Catálogo vacío</div>' +
        '<p class="ds-empty__text">Esta tienda todavía no publicó productos. Vuelve más tarde o busca en otras tiendas.</p>' +
        '<a class="ds-btn ds-btn--secondary ds-btn--sm" href="/panel/cliente/buscar/">Buscar en todas</a></div>');

  const compartir = caja.querySelector('[data-compartir]');
  if (compartir) {
    compartir.addEventListener('click', async () => {
      const texto = t.nombre + ' en FORGE CORE STOCK';
      try {
        if (navigator.share) await navigator.share({ title: texto, url });
        else {
          await navigator.clipboard.writeText(url);
          compartir.textContent = 'Enlace copiado';
          setTimeout(() => { compartir.textContent = 'Compartir'; }, 1600);
        }
      } catch (_) { /* el usuario canceló: no es un error */ }
    });
  }
  barra(t);
}

function accion(pid, delta) {
  const t = estado.tienda;
  if (!t) return;
  if (delta > 0) {
    const p = estado.productos.find((x) => x.id === pid);
    if (!p) return;
    try { agregar(t, p, 1); }
    catch (e) { aviso('<div class="aviso aviso--warn"><svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><path d="M10.3 4.2 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/></svg><span>' + esc(e.message) + '</span></div>'); return; }
  } else {
    cambiar(t.id, pid, delta);
  }
  pintar();
}

async function cargar() {
  const id = params.get('id') || '';
  if (!id) {
    error('Falta la tienda', 'El enlace no trae el id de la marca. Abre una tienda desde el mapa o desde la búsqueda.');
    return;
  }
  try {
    const d = await mercado('local_ver', { id });
    estado.tienda = d.tienda;
    estado.productos = productosDe(d.tienda);
    estado.error = '';
    pintar();
  } catch (e) {
    const cache = leerUltimo('tienda:' + id, 72);
    if (cache && cache.datos && cache.datos.tienda) {
      estado.tienda = cache.datos.tienda;
      estado.productos = productosDe(cache.datos.tienda);
      pintar();
      aviso('<div class="aviso aviso--warn"><svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><path d="M10.3 4.2 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/></svg>' +
        '<span>' + esc(mensajeDeError(e)) + '. Mostramos la última versión guardada.</span></div>');
      return;
    }
    error(e && e.codigo === 'NO_ENCONTRADO' ? 'Esa tienda no existe' : 'No pudimos abrir la tienda',
      e && e.codigo === 'NO_ENCONTRADO'
        ? 'El enlace puede estar vencido o la tienda dejó de estar publicada.'
        : mensajeDeError(e));
  }
}

function error(titulo, detalle) {
  const caja = $('[data-tienda]');
  if (!caja) return;
  caja.innerHTML = '<div class="ds-error"><div class="ds-error__title">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 9v4M12 17h.01"/><path d="M10.3 4.2 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/></svg>' +
    esc(titulo) + '</div><div class="ds-error__text">' + esc(detalle) + '</div>' +
    '<div class="ds-error__action"><a class="ds-btn ds-btn--secondary ds-btn--sm" href="/panel/cliente/buscar/">Buscar tiendas</a></div></div>';
}

document.addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]');
  if (add) { accion(add.dataset.add, 1); return; }
  const mas = e.target.closest('[data-mas]');
  if (mas) { accion(mas.dataset.mas, 1); return; }
  const menos = e.target.closest('[data-menos]');
  if (menos) { accion(menos.dataset.menos, -1); }
});

cargar();
