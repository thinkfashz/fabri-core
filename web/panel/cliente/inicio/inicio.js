/* C01 · Inicio
   Hero, tiendas cercanas, pedido activo y precios bajos. Todo lo que se
   muestra viene de `/api/mercado`; si la red falla, se usa el último JSON
   bueno y se dice, en vez de fingir datos. */

import { mercado, guardarUltimo, leerUltimo, mensajeDeError } from '../../comun/api.js';
import { RESPALDO, distanciaKm, ubicacionGuardada, pedirUbicacion } from '../../comun/catalogo.js';
import { clp, km, esc, iniciales, fecha } from '../../comun/formato.js';
import { ultimoActivo, enlaceSeguimiento } from '../../comun/pedidos.js';

const $ = (sel) => document.querySelector(sel);
const estado = {
  ubi: ubicacionGuardada() || RESPALDO,
  tiendas: [],
  ofertas: [],
  sinRed: false,
};

function aviso(html) {
  const caja = $('[data-aviso-inicio]');
  if (caja) caja.innerHTML = html;
}

function pintarUbicacion() {
  const texto = $('[data-ubicacion-texto]');
  if (!texto) return;
  const u = estado.ubi;
  const donde = u.origen === 'gps' ? 'Tu ubicación' : (u.nombre || 'Santiago centro');
  texto.textContent = donde + (u.origen === 'respaldo' ? ' · distancia aproximada' : '');
  const boton = $('[data-usar-ubicacion]');
  if (boton) boton.textContent = u.origen === 'gps' ? 'Actualizar' : 'Usar mi ubicación';
}

function logo(tienda, clase) {
  const c = clase ? ' ' + clase : '';
  const t = tienda || {};
  const nombre = t.nombre || t.marca || '?';
  if (t.logo) {
    return '<span class="logo-tienda' + c + '"><img src="' + esc(t.logo) + '" alt="" loading="lazy"></span>';
  }
  return '<span class="logo-tienda' + c + '" aria-hidden="true">' + esc(iniciales(nombre)) + '</span>';
}

function tarjetaTienda(item) {
  const t = (item && item.tienda) || {};
  const abierta = t.abierto !== false;
  const dist = item.dist;
  return '<a class="tienda' + (abierta ? '' : ' tienda--cerrada') + '" href="/panel/cliente/tienda/?id=' +
    encodeURIComponent(t.id) + '">' +
    '<div class="tienda__top">' + logo(t) +
      '<span class="pill ' + (abierta ? 'pill--ok' : 'pill--err') + '">' + (abierta ? 'Abierta' : 'Cerrada') + '</span>' +
    '</div>' +
    '<div><div class="tienda__nombre">' + esc(t.nombre) + '</div>' +
      '<div class="tienda__meta">' + esc(t.rubro || 'Tienda') +
        (t.comuna ? ' · ' + esc(t.comuna) : '') + '</div></div>' +
    '<div class="tienda__pie">' +
      '<span class="dist">' + (dist === null ? 'sin distancia' : 'a ' + km(dist)) + '</span>' +
      '<span class="tienda__ir">Ver tienda →</span>' +
    '</div></a>';
}

function pintarTiendas() {
  const caja = $('[data-tiendas]');
  const nota = $('[data-tiendas-nota]');
  if (!caja) return;
  const conDist = estado.tiendas.map((t) => ({
    tienda: t,
    dist: distanciaKm(estado.ubi.lat, estado.ubi.lon, t.lat, t.lon),
  })).sort((a, b) => {
    if (a.dist === null && b.dist === null) return a.tienda.nombre.localeCompare(b.tienda.nombre);
    if (a.dist === null) return 1;
    if (b.dist === null) return -1;
    return a.dist - b.dist;
  });

  const cerca = conDist.filter((x) => x.dist !== null && x.dist <= 3);
  const visibles = cerca.length ? cerca : conDist.slice(0, 6);

  // La etiqueta del héroe dice la verdad: si no hay nada en 3 km, muestra la
  // distancia real a la tienda más cercana en vez de prometer un radio vacío.
  const etiquetaDist = $('[data-hero-dist]');
  const etiquetaPie = $('[data-hero-pie]');
  if (etiquetaDist && etiquetaPie) {
    if (cerca.length) {
      etiquetaDist.textContent = '3 km';
      etiquetaPie.textContent = 'a la redonda';
    } else if (conDist.length && conDist[0].dist !== null) {
      etiquetaDist.textContent = km(conDist[0].dist);
      etiquetaPie.textContent = 'la más cercana';
    } else {
      etiquetaDist.textContent = '—';
      etiquetaPie.textContent = 'sin ubicación';
    }
  }

  if (!visibles.length) {
    caja.innerHTML = '<div class="ds-empty"><div class="ds-empty__icon">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 9h16l-1.5 11h-13L4 9Z"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/></svg>' +
      '</div><div class="ds-empty__title">Aún no hay tiendas publicadas</div>' +
      '<p class="ds-empty__text">Cuando una tienda se sume, aparecerá acá con su catálogo.</p>' +
      '<a class="ds-btn ds-btn--secondary ds-btn--sm" href="/panel/cliente/ayuda/">Saber más</a></div>';
    if (nota) nota.textContent = '';
    return;
  }
  caja.innerHTML = visibles.map(tarjetaTienda).join('');
  if (nota) {
    nota.textContent = cerca.length
      ? 'Mostrando ' + visibles.length + ' tienda' + (visibles.length === 1 ? '' : 's') + ' a menos de 3 km.'
      : 'No hay tiendas a menos de 3 km: te mostramos las más cercanas.';
  }
}

function pintarPedido() {
  const seccion = $('[data-pedido-activo]');
  const caja = $('[data-pedido-tarjeta]');
  if (!seccion || !caja) return;
  const p = ultimoActivo(7);
  if (!p) { seccion.hidden = true; caja.innerHTML = ''; return; }
  seccion.hidden = false;
  const estadoTxt = String(p.estado || 'nuevo');
  caja.innerHTML = '<a class="pedido-tarjeta" href="' + esc(enlaceSeguimiento(p)) + '">' +
    '<div><span class="pedido-tarjeta__codigo">' + esc(p.codigo) + '</span>' +
      '<div class="pedido-tarjeta__local">' + esc(p.local && p.local.nombre || 'Tu pedido') + '</div></div>' +
    '<span class="pill pill--acento">' + esc(estadoTxt) + '</span>' +
    '<div class="pedido-tarjeta__dato"><b>' + clp(p.total) + '</b>' +
      fecha(p.fecha) + '</div>' +
    '<span class="tienda__ir">Seguir →</span></a>';
}

function tarjetaOferta(r) {
  const t = r.tienda || {};
  const p = r.producto || {};
  const descuento = Number(p.descuento_vigente) || 0;
  const precio = Number(p.precio_efectivo) || Number(p.precio) || 0;
  const lista = Number(p.precio) || 0;
  const destino = p.sku
    ? '/panel/cliente/producto/?local=' + encodeURIComponent(t.id) + '&sku=' + encodeURIComponent(p.sku)
    : '/panel/cliente/tienda/?id=' + encodeURIComponent(t.id);
  const abierta = t.abierto !== false;
  return '<a class="oferta" href="' + destino + '">' +
    (p.imagen
      ? '<span class="mini"><img src="' + esc(p.imagen) + '" alt="" loading="lazy"></span>'
      : '<span class="mini" aria-hidden="true">' + esc(iniciales(p.nombre)) + '</span>') +
    '<span class="oferta__cuerpo">' +
      (descuento ? '<span class="oferta__sello">-' + descuento + '%</span>' : '<span class="oferta__sello">precio bajo</span>') +
      '<span class="oferta__nombre">' + esc(p.nombre) + '</span>' +
      '<span class="oferta__tienda">' + esc(t.nombre || 'Tienda') +
        (r.dist !== null && r.dist !== undefined ? ' · ' + km(r.dist) : '') +
        (abierta ? '' : ' · cerrada') + '</span>' +
      '<span class="oferta__pie"><b class="precio precio--sm' + (descuento ? ' precio--oferta' : '') + '">' +
        clp(precio) + '</b>' +
        (descuento && lista > precio ? '<span class="precio-lista">' + clp(lista) + '</span>' : '') +
      '</span>' +
    '</span></a>';
}

function pintarOfertas() {
  const caja = $('[data-ofertas]');
  const titulo = $('[data-ofertas-titulo]');
  if (!caja) return;
  const conDescuento = estado.ofertas.filter((r) => Number(r.producto && r.producto.descuento_vigente) > 0);
  const lista = (conDescuento.length ? conDescuento : estado.ofertas).slice(0, 6);
  if (titulo) titulo.textContent = conDescuento.length ? 'Ofertas y precios bajos' : 'Precios bajos';
  if (!lista.length) {
    caja.innerHTML = '<div class="ds-empty" style="grid-column:1/-1"><div class="ds-empty__icon">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11V4h7l11 11-7 7L3 11Z"/><circle cx="7.5" cy="7.5" r="1.2"/></svg>' +
      '</div><div class="ds-empty__title">Hoy no hay ofertas publicadas</div>' +
      '<p class="ds-empty__text">Los locales actualizan sus precios desde su panel. Mientras tanto, puedes comparar el catálogo completo.</p>' +
      '<a class="ds-btn ds-btn--secondary ds-btn--sm" href="/panel/cliente/buscar/">Buscar productos</a></div>';
    return;
  }
  caja.innerHTML = lista.map(tarjetaOferta).join('');
}

async function cargar() {
  const consultas = await Promise.allSettled([
    mercado('locales', { con_catalogo: 0 }),
    mercado('productos_buscar', { precio_max: 25000, orden: 'precio', limite: 24 }),
  ]);

  if (consultas[0].status === 'fulfilled') {
    estado.tiendas = Array.isArray(consultas[0].value.tiendas) ? consultas[0].value.tiendas : [];
    guardarUltimo('locales', estado.tiendas);
  } else {
    const cache = leerUltimo('locales', 72);
    estado.tiendas = cache && Array.isArray(cache.datos) ? cache.datos : [];
    estado.sinRed = true;
    aviso('<div class="aviso aviso--warn"><svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><path d="M10.3 4.2 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/></svg>' +
      '<span>No pudimos leer las tiendas: ' + esc(mensajeDeError(consultas[0].reason)) +
      (cache ? '. Mostramos la última lista guardada.' : '.') + '</span></div>');
  }

  if (consultas[1].status === 'fulfilled') {
    estado.ofertas = Array.isArray(consultas[1].value.resultados) ? consultas[1].value.resultados : [];
    guardarUltimo('ofertas', estado.ofertas);
  } else {
    const cache = leerUltimo('ofertas', 72);
    estado.ofertas = cache && Array.isArray(cache.datos) ? cache.datos : [];
    if (!estado.sinRed) {
      aviso('<div class="aviso aviso--warn"><svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><path d="M10.3 4.2 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/></svg>' +
        '<span>No pudimos leer los precios: ' + esc(mensajeDeError(consultas[1].reason)) + '</span></div>');
    }
  }

  pintarTiendas();
  pintarOfertas();
  pintarPedido();
}

function montarUbicacion() {
  const boton = $('[data-usar-ubicacion]');
  if (!boton) return;
  boton.addEventListener('click', async () => {
    boton.disabled = true;
    boton.textContent = 'Buscando…';
    const u = await pedirUbicacion();
    estado.ubi = u;
    pintarUbicacion();
    pintarTiendas();
    pintarOfertas();
    boton.disabled = false;
  });
}

pintarUbicacion();
montarUbicacion();
pintarPedido();
cargar();
