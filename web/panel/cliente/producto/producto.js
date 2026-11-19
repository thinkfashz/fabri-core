/* C05 · Producto
   Una sola ficha, con la verdad del catálogo: precio efectivo, stock y
   estado de la tienda. La comparación «también en» usa la misma búsqueda
   pública (`productos_buscar`) y no inventa ofertas ni disponibilidad. */

import { mercado, guardarUltimo, leerUltimo, mensajeDeError } from '../../comun/api.js';
import { productosDe, buscarEnTienda, distanciaKm, ubicacionGuardada } from '../../comun/catalogo.js';
import { leer, agregar, cambiar, quitar } from '../../comun/carrito.js';
import { esFavorito, alternar as alternarFavorito } from '../../comun/favoritos.js';
import { clp, km, esc, iniciales, fecha } from '../../comun/formato.js';

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);
const estado = { tienda: null, producto: null, otros: [], error: '' };

function aviso(html, tipo) {
  const caja = $('[data-aviso]');
  if (!caja) return;
  caja.innerHTML = html
    ? '<div class="aviso aviso--' + (tipo || 'warn') + '"><svg viewBox="0 0 24 24">' +
      '<path d="M12 9v4M12 17h.01"/><path d="M10.3 4.2 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/></svg>' +
      '<span>' + html + '</span></div>'
    : '';
}

/** Oferta vigente: el servidor ya manda el descuento efectivo, pero si la
 *  fecha venció no se pinta el sello ni el precio tachado. */
function ofertaVigente(p) {
  if (!p.descuento) return false;
  if (!p.oferta_hasta) return true;
  return p.oferta_hasta * 1000 > Date.now();
}

function cantidadDe(pid) {
  const g = estado.tienda && leer()[estado.tienda.id];
  if (!g || !g.items) return 0;
  const it = g.items[pid];
  return it ? Number(it.c || it) || 0 : 0;
}

function logoMini(t, clase) {
  if (t.logo) return '<span class="logo-tienda ' + (clase || '') + '"><img src="' + esc(t.logo) + '" alt=""></span>';
  return '<span class="logo-tienda ' + (clase || '') + '" aria-hidden="true">' +
    esc(iniciales(t.nombre || t.marca)) + '</span>';
}

function bloqueCompra() {
  const t = estado.tienda;
  const p = estado.producto;
  const abierta = t.abierto !== false;
  const oferta = ofertaVigente(p);
  const stock = p.stock;
  const agotado = stock !== null && stock <= 0;
  const pocas = stock !== null && stock > 0 && stock <= 5;
  const n = cantidadDe(p.id);
  const ubi = ubicacionGuardada();
  const dist = ubi ? distanciaKm(ubi.lat, ubi.lon, t.lat, t.lon) : null;
  const entrega = Array.isArray(t.entrega) ? t.entrega : ['retiro'];
  const maximo = stock === null ? 999 : Math.min(999, stock);
  const fav = esFavorito('producto', t.id, p.sku);

  const bloqueado = agotado || !abierta;
  const motivo = agotado ? 'Producto agotado' : (!abierta ? 'Tienda cerrada' : 'Agregar al carrito');

  return '<section class="compra' + (oferta ? ' compra--oferta' : '') + '" aria-labelledby="productoTitulo">' +
    '<a class="compra__tienda" href="/panel/cliente/tienda/?id=' + encodeURIComponent(t.id) + '">' +
      logoMini(t) +
      '<span class="crece"><b>' + esc(t.nombre) + '</b>' +
        '<small>' + esc(t.rubro || 'Tienda') + (dist !== null ? ' · a ' + km(dist) : '') +
        ' · ' + (abierta ? 'abierta' : 'cerrada') + '</small></span>' +
      '<span aria-hidden="true">→</span></a>' +

    '<div>' +
      '<h1 class="compra__nombre" id="productoTitulo">' + esc(p.nombre) + '</h1>' +
      '<div class="compra__meta" style="margin-top:6px;font-size:var(--ds-text-xs);color:var(--ds-text-tertiary)">' +
        esc(p.unidad) + (p.categoria ? ' · ' + esc(p.categoria) : '') +
        (p.sku ? ' · SKU ' + esc(p.sku) : '') + '</div>' +
    '</div>' +

    '<div>' +
      '<div class="compra__precios">' +
        '<b class="precio precio--lg' + (oferta ? ' precio--oferta' : '') + '">' + clp(p.precio) + '</b>' +
        (oferta && p.lista > p.precio ? '<span class="precio-lista">' + clp(p.lista) + '</span>' : '') +
        (oferta ? '<span class="compra__ahorro">ahorras ' + clp((p.lista - p.precio)) + '</span>' : '') +
      '</div>' +
      (oferta && p.oferta_hasta
        ? '<div class="compra__vigencia">Oferta válida hasta el ' + esc(fecha(p.oferta_hasta * 1000)) + '.</div>'
        : '') +
      '<div class="compra__vigencia" style="margin-top:4px">Precio efectivo en CLP. El local confirma el stock al preparar.</div>' +
    '</div>' +

    '<div class="compra__cifras">' +
      '<div class="compra__cifra"><small>Stock</small><b>' +
        (stock === null ? 'sin límite informado' : (agotado ? 'agotado' : stock + ' disponible' + (stock === 1 ? '' : 's'))) +
        '</b></div>' +
      '<div class="compra__cifra"><small>Mínimo de compra</small><b>' +
        (t.minimo > 0 ? clp(t.minimo) : 'sin mínimo') + '</b></div>' +
      '<div class="compra__cifra"><small>Entrega</small><b>' +
        entrega.map((e) => e === 'delivery' ? 'Delivery' : 'Retiro').join(' · ') + '</b></div>' +
      '<div class="compra__cifra"><small>Envío</small><b>' +
        (entrega.includes('delivery') ? (t.envio > 0 ? clp(t.envio) : 'gratis') : 'solo retiro') + '</b></div>' +
    '</div>' +

    (pocas ? '<div class="aviso aviso--warn" style="margin:0"><svg viewBox="0 0 24 24">' +
      '<path d="M12 9v4M12 17h.01"/><path d="M10.3 4.2 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/></svg>' +
      '<span>Quedan sólo ' + stock + ': si lo quieres, agrégalo ahora.</span></div>' : '') +
    (!abierta ? '<div class="aviso aviso--err" style="margin:0"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>' +
      '<span>La tienda está cerrada. Puedes volver cuando abra' + (t.horario ? ' (' + esc(t.horario) + ')' : '') + '.</span></div>' : '') +

    '<div class="compra__acciones">' +
      '<button class="ds-btn ds-btn--ghost compra__fav" type="button" data-favorito aria-pressed="' +
        (fav ? 'true' : 'false') + '">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20S4 15 4 9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15 12 20 12 20Z"/></svg>' +
        '<span>' + (fav ? 'Guardado en favoritos' : 'Guardar en favoritos') + '</span></button>' +
      '<div class="compra__fila">' +
        '<div class="qty" aria-label="Cantidad">' +
          '<button type="button" data-menos aria-label="Quitar uno"' + (n <= 0 ? ' disabled' : '') + '>−</button>' +
          '<output aria-live="polite">' + (n || 1) + '</output>' +
          '<button type="button" data-mas aria-label="Agregar uno"' +
            (bloqueado || (n || 0) >= maximo ? ' disabled' : '') + '>+</button>' +
        '</div>' +
        '<button class="ds-btn ds-btn--lg" type="button" data-agregar' + (bloqueado ? ' disabled' : '') + '>' +
          (bloqueado ? esc(motivo) : 'Agregar · ' + clp(p.precio * (n || 1))) +
        '</button>' +
      '</div>' +
      (n > 0
        ? '<a class="ds-btn ds-btn--secondary" href="/panel/cliente/carrito/">Ver el carrito (' +
          unidadesDe(t.id) + ')</a>'
        : '<a class="ds-btn ds-btn--ghost" href="/panel/cliente/tienda/?id=' + encodeURIComponent(t.id) +
          '">Ver todo el catálogo</a>') +
    '</div>' +

    '<p class="compra__nota">Al agregar no se cobra nada: el pedido se confirma en el checkout, con el stock validado otra vez contra el catálogo.</p>' +
  '</section>';
}

function unidadesDe(tiendaId) {
  const g = leer()[tiendaId];
  if (!g || !g.items) return 0;
  return Object.keys(g.items).reduce((a, pid) => a + (Number(g.items[pid].c || g.items[pid]) || 0), 0);
}

function galeria() {
  const t = estado.tienda;
  const p = estado.producto;
  const oferta = ofertaVigente(p);
  return '<nav class="migas" aria-label="Ruta">' +
      '<a href="/panel/cliente/inicio/">Inicio</a> <span>/</span> ' +
      '<a href="/panel/cliente/buscar/">Buscar</a> <span>/</span> ' +
      '<a href="/panel/cliente/tienda/?id=' + encodeURIComponent(t.id) + '">' + esc(t.nombre) + '</a> ' +
      '<span>/</span> <span aria-current="page">' + esc(p.nombre) + '</span></nav>' +
    '<section class="galeria" aria-label="Imagen del producto">' +
      '<div class="galeria__lienzo">' +
        (oferta ? '<span class="galeria__sello">-' + p.descuento + '%</span>' : '') +
        (p.imagen
          ? '<img src="' + esc(p.imagen) + '" alt="' + esc(p.nombre) + '">'
          : '<span class="galeria__inicial" aria-hidden="true">' + esc(iniciales(p.nombre)) + '</span>') +
      '</div>' +
      '<div class="galeria__pie">' +
        '<span>' + esc(t.nombre) + ' · ' + esc(t.comuna || 'Chile') + '</span>' +
        '<span>El precio y el stock los publica la tienda.</span>' +
      '</div>' +
    '</section>';
}

function filaOtro(r) {
  const t = r.tienda || {};
  const p = r.producto || {};
  const precio = Number(p.precio_efectivo) || Number(p.precio) || 0;
  const desc = Number(p.descuento_vigente) || 0;
  const stock = p.stock === null || p.stock === undefined ? null : Number(p.stock);
  const abierta = t.abierto !== false;
  const destino = p.sku
    ? '/panel/cliente/producto/?local=' + encodeURIComponent(t.id) + '&sku=' + encodeURIComponent(p.sku)
    : '/panel/cliente/tienda/?id=' + encodeURIComponent(t.id);
  return '<a class="fila-marca" href="' + destino + '">' +
    logoMini(t) +
    '<span class="fila-marca__cuerpo">' +
      '<span class="fila-marca__nombre">' + esc(t.nombre || 'Tienda') + '</span>' +
      '<span class="fila-marca__meta">' + esc(t.comuna || '') +
        (r.dist !== null && r.dist !== undefined ? ' · a ' + km(r.dist) : '') +
        ' · ' + (abierta ? 'abierta' : 'cerrada') +
        (stock === null ? '' : stock > 0 ? ' · ' + stock + ' disponibles' : ' · agotado') +
      '</span>' +
    '</span>' +
    '<span class="fila-marca__precio">' +
      '<b class="precio precio--sm' + (desc ? ' precio--oferta' : '') + '">' + clp(precio) + '</b>' +
      (desc ? '<br><span class="pill pill--acento">-' + desc + '%</span>' : '') +
    '</span>' +
    '<span class="fila-marca__ir">ver →</span></a>';
}

function comparacion() {
  const lista = estado.otros;
  const t = estado.tienda;
  const p = estado.producto;
  const cabecera = '<summary>También en otras tiendas <small>' +
    (lista.length ? lista.length + ' marca' + (lista.length === 1 ? '' : 's') : 'sin coincidencias') +
    '</small></summary>';
  if (!lista.length) {
    return '<section class="comparar"><details class="acordeon">' + cabecera +
      '<div class="acordeon__cuerpo"><p style="font-size:var(--ds-text-sm);color:var(--ds-text-tertiary);margin:0">' +
      'Ninguna otra tienda publicada tiene «' + esc(p.nombre) + '» con ese nombre exacto. ' +
      'Puedes <a href="/panel/cliente/buscar/?q=' + encodeURIComponent(p.nombre) + '">buscar parecidos</a>.</p></div>' +
      '</details></section>';
  }
  // La más barata primero; la tienda actual queda marcada si aparece.
  const orden = lista.slice().sort((a, b) => {
    const pa = Number(a.producto && (a.producto.precio_efectivo || a.producto.precio)) || 0;
    const pb = Number(b.producto && (b.producto.precio_efectivo || b.producto.precio)) || 0;
    return pa - pb;
  });
  return '<section class="comparar"><details class="acordeon" open>' + cabecera +
    '<div class="acordeon__cuerpo">' +
      // La ficha actual, para comparar contra sí misma.
      '<div class="fila-marca fila-marca--aqui">' + logoMini(t) +
        '<span class="fila-marca__cuerpo"><span class="fila-marca__nombre">' + esc(t.nombre) + ' · esta ficha</span>' +
          '<span class="fila-marca__meta">' + (t.abierto !== false ? 'abierta' : 'cerrada') + '</span></span>' +
        '<span class="fila-marca__precio"><b class="precio precio--sm">' + clp(p.precio) + '</b></span>' +
        '<span class="fila-marca__ir">aquí</span></div>' +
      orden.map(filaOtro).join('') +
    '</div></details></section>';
}

function pintar() {
  const marco = $('[data-marco]');
  if (!marco) return;
  marco.innerHTML = galeria() + bloqueCompra() + comparacion() + '<div data-aviso aria-live="polite" style="grid-column:1/-1"></div>';
}

async function compararEnOtras() {
  const t = estado.tienda;
  const p = estado.producto;
  try {
    const d = await mercado('productos_buscar', { q: p.nombre, orden: 'precio', limite: 20 });
    const ubi = ubicacionGuardada();
    estado.otros = (Array.isArray(d.resultados) ? d.resultados : []).filter((r) => {
      const otro = r.tienda && r.tienda.id;
      if (!otro || otro === t.id) return false;
      const nom = String(r.producto && r.producto.nombre || '').toLowerCase();
      return nom === p.nombre.toLowerCase();
    }).map((r) => {
      if (r.dist !== null && r.dist !== undefined) return r;
      if (!ubi) return r;
      return Object.assign({}, r, { dist: distanciaKm(ubi.lat, ubi.lon, r.tienda.lat, r.tienda.lon) });
    });
  } catch (_) {
    // Sin comparación no se rompe la ficha: el bloque queda «sin coincidencias».
    estado.otros = [];
  }
}

function accion(delta) {
  const t = estado.tienda;
  const p = estado.producto;
  if (!t || !p) return;
  if (delta > 0) {
    const n = cantidadDe(p.id);
    if (p.stock !== null && n >= p.stock) {
      aviso('Sólo quedan ' + p.stock + ' de este producto.', 'warn');
      return;
    }
    try { agregar(t, p, 1); }
    catch (e) { aviso(esc(e.message), 'err'); return; }
  } else {
    cambiar(t.id, p.id, -1);
  }
  pintar();
}

async function guardarFavorito(boton) {
  const t = estado.tienda;
  const p = estado.producto;
  if (!t || !p) return;
  boton.disabled = true;
  try {
    const r = await alternarFavorito('producto', t.id, p.sku, {
      nombre: p.nombre,
      precio: p.precio,
      local_nombre: t.nombre,
      ico: t.ico,
    });
    pintar();
    aviso(r.favorito
      ? 'Guardado en favoritos' + (r.nube ? '.' : ' en este teléfono. Entra a tu cuenta para llevarlo contigo.')
      : 'Quitado de favoritos.', r.nube ? 'ok' : 'acento');
  } catch (e) {
    boton.disabled = false;
    aviso(esc(mensajeDeError(e)), 'err');
  }
}

function error(titulo, detalle, accionHtml) {
  const marco = $('[data-marco]');
  if (!marco) return;
  marco.innerHTML = '<div class="ds-error" style="grid-column:1/-1">' +
    '<div class="ds-error__title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">' +
    '<path d="M12 9v4M12 17h.01"/><path d="M10.3 4.2 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/></svg>' +
    esc(titulo) + '</div><div class="ds-error__text">' + esc(detalle) + '</div>' +
    '<div class="ds-error__action">' + (accionHtml || '<a class="ds-btn ds-btn--secondary ds-btn--sm" href="/panel/cliente/buscar/">Buscar productos</a>') +
    '</div></div>';
}

async function cargar() {
  const localId = params.get('local') || params.get('id') || '';
  const ref = params.get('sku') || params.get('p') || '';
  if (!localId || !ref) {
    error('Falta el producto', 'El enlace debe traer la tienda y el SKU. Abre un producto desde la búsqueda o desde el catálogo de una tienda.');
    return;
  }
  try {
    const d = await mercado('local_ver', { id: localId });
    const tienda = d.tienda;
    const producto = buscarEnTienda(tienda, ref);
    if (!producto) {
      error('Ese producto ya no está', 'La tienda lo sacó del catálogo o cambió su SKU. Mira lo que tiene disponible ahora.',
        '<a class="ds-btn ds-btn--sm" href="/panel/cliente/tienda/?id=' + encodeURIComponent(localId) + '">Ver la tienda</a>');
      return;
    }
    estado.tienda = tienda;
    estado.producto = producto;
    guardarUltimo('producto:' + localId + ':' + producto.sku, { tienda, producto, ts: Date.now() });
    pintar();
    await compararEnOtras();
    pintar();
  } catch (e) {
    const cache = leerUltimo('producto:' + localId + ':' + ref, 72);
    if (cache && cache.datos && cache.datos.tienda && cache.datos.producto) {
      estado.tienda = cache.datos.tienda;
      estado.producto = cache.datos.producto;
      pintar();
      aviso(esc(mensajeDeError(e)) + '. Mostramos la última versión guardada.', 'warn');
      return;
    }
    error(e && e.codigo === 'NO_ENCONTRADO' ? 'Esa tienda no existe' : 'No pudimos abrir el producto',
      e && e.codigo === 'NO_ENCONTRADO'
        ? 'El enlace puede estar vencido o la tienda dejó de estar publicada.'
        : mensajeDeError(e));
  }
}

document.addEventListener('click', (e) => {
  const fav = e.target.closest('[data-favorito]');
  if (fav && !fav.disabled) { guardarFavorito(fav); return; }
  if (e.target.closest('[data-mas]')) { accion(1); return; }
  if (e.target.closest('[data-menos]')) { accion(-1); return; }
  const b = e.target.closest('[data-agregar]');
  if (!b || b.disabled) return;
  const t = estado.tienda;
  const p = estado.producto;
  if (!t || !p) return;
  const n = Math.max(1, cantidadDe(p.id));
  try {
    agregar(t, p, n);
    b.textContent = 'Agregado ✓';
    b.disabled = true;
    setTimeout(() => { pintar(); }, 700);
  } catch (err) {
    aviso(esc(err.message), 'err');
  }
});

cargar();
