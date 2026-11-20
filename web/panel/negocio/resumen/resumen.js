/* N01 · Resumen
   Decide el día en diez segundos: ventas del período, pedidos abiertos, stock
   crítico y calificación. Todo sale de `ventas_serie` + `pedidos_listar`; si
   una de las dos falla, se dice y se puede reintentar. */

import { arrancar, llamar, estadoDe } from '../../comun/negocio.js';
import { clp, num, esc } from '../../comun/formato.js';

const $ = (sel, raiz) => (raiz || document).querySelector(sel);

const estado = {
  ctx: null,
  dias: 7,
  cargando: false,
  error: '',
  aviso: '',
  datos: null,
  pedidos: [],
  errorPedidos: '',
};

function hace(ts) {
  const ms = Date.now() - new Date(ts).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const min = Math.round(ms / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return 'hace ' + min + ' min';
  const h = Math.round(min / 60);
  if (h < 24) return 'hace ' + h + ' h';
  return 'hace ' + Math.round(h / 24) + ' d';
}

function barrasSerie(serie) {
  const filas = Array.isArray(serie) ? serie : [];
  const max = Math.max(1, ...filas.map((f) => Number(f.ventas) || 0));
  const n = filas.length;
  const cada = n <= 7 ? 1 : n <= 30 ? 5 : 15;
  return filas.map((f, i) => {
    const ventas = Number(f.ventas) || 0;
    return {
      dia: String(f.dia || ''),
      ventas,
      pedidos: Number(f.pedidos) || 0,
      alto: ventas > 0 ? Math.max(3, Math.round((ventas / max) * 100)) : 2,
      etiqueta: i === 0 || i === n - 1 || i % cada === 0,
      hoy: i === n - 1,
    };
  });
}

function kpi(rotulo, valor, nota, tono) {
  return '<div class="res-kpi' + (tono ? ' res-kpi--' + tono : '') + '">' +
    '<span class="res-kpi__rotulo">' + esc(rotulo) + '</span>' +
    '<strong class="res-kpi__valor">' + valor + '</strong>' +
    (nota ? '<span class="res-kpi__nota">' + nota + '</span>' : '') +
  '</div>';
}

function estadoPill(clave) {
  const e = estadoDe(clave);
  return '<span class="pill ' + e.pill + '">' + esc(e.t) + '</span>';
}

function cabecera(ctx) {
  const abiertos = estado.datos ? Number(estado.datos.totales && estado.datos.totales.abiertos) || 0 : 0;
  return '<header class="neg-cabeza">' +
    '<div>' +
      '<span class="neg-cabeza__kicker">' + esc(ctx.tienda.nombre || 'Mi negocio') + '</span>' +
      '<h1>Resumen</h1>' +
      '<p>Lo que pasó en tu tienda en el período. Los números salen de la base, no de una estimación.</p>' +
    '</div>' +
    '<div class="neg-cabeza__acciones">' +
      '<div class="neg-seg" role="tablist" aria-label="Período">' +
        [7, 30, 90].map((d) => '<button type="button" role="tab" data-dias="' + d + '" aria-selected="' +
          (estado.dias === d ? 'true' : 'false') + '">' + d + ' días</button>').join('') +
      '</div>' +
      '<button class="ds-btn ds-btn--secondary ds-btn--sm" type="button" data-actualizar>Actualizar</button>' +
      '<a class="ds-btn ds-btn--ghost ds-btn--sm" href="/panel/negocio/pedidos/">' +
        (abiertos ? abiertos + ' abierto' + (abiertos === 1 ? '' : 's') : 'Ver pedidos') + '</a>' +
    '</div>' +
  '</header>';
}

function bloqueSerie() {
  const d = estado.datos;
  if (!d) return '';
  const filas = barrasSerie(d.serie);
  const total = filas.reduce((s, f) => s + f.ventas, 0);
  const vacio = total <= 0;
  return '<section class="res-serie neg-tarjeta" aria-labelledby="res-serie-t">' +
    '<div class="res-serie__cabeza">' +
      '<div><h2 id="res-serie-t">Ventas por día</h2>' +
        '<span class="neg-tarjeta__sub">' + esc((d.dias || estado.dias) + ' días') + ' · ' + clp(total) + ' en total</span></div>' +
      '<span class="res-serie__conversion">' +
        (d.conversion != null ? 'Conversión ' + num(d.conversion) + '%' : 'Visitas sin datos') +
      '</span>' +
    '</div>' +
    (vacio
      ? '<div class="neg-vacio"><b>Todavía no hay ventas en este período.</b>' +
        'Cuando entre el primer pedido, la serie se dibuja acá.</div>'
      : '<div class="res-barras" role="img" aria-label="Ventas por día del período">' +
        filas.map((f) => '<div class="res-barra' + (f.hoy ? ' res-barra--hoy' : '') + '" title="' +
          esc(f.dia + ': ' + clp(f.ventas) + ' · ' + f.pedidos + ' pedidos') + '">' +
          '<span class="res-barra__alto" style="height:' + f.alto + '%"></span>' +
          (f.etiqueta ? '<span class="res-barra__dia">' + esc(f.dia.slice(8)) + '</span>' : '') +
        '</div>').join('') +
      '</div>') +
  '</section>';
}

function bloqueCola() {
  if (estado.errorPedidos) {
    return '<section class="neg-tarjeta res-cola" aria-labelledby="res-cola-t">' +
      '<div class="res-cola__cabeza"><h2 id="res-cola-t">Cola de pedidos</h2></div>' +
      '<div class="neg-vacio"><b>No pudimos leer la cola.</b>' + esc(estado.errorPedidos) +
        '<div><button class="ds-btn ds-btn--ghost ds-btn--sm" type="button" data-reintentar-cola>Reintentar</button></div></div>' +
    '</section>';
  }
  const abiertos = estado.pedidos.filter((p) => p.estado !== 'entregado' && p.estado !== 'cancelado');
  const lista = abiertos.slice(0, 6);
  return '<section class="neg-tarjeta res-cola" aria-labelledby="res-cola-t">' +
    '<div class="res-cola__cabeza">' +
      '<div><h2 id="res-cola-t">Cola de pedidos</h2>' +
        '<span class="neg-tarjeta__sub">' + abiertos.length + ' por atender</span></div>' +
      '<a class="sec-head__link" href="/panel/negocio/pedidos/">Abrir la cola</a>' +
    '</div>' +
    (lista.length
      ? '<ul class="res-cola__lista">' + lista.map((p) => {
        const e = estadoDe(p.estado);
        return '<li class="res-cola__item">' +
          '<div class="res-cola__quien"><b>' + esc(p.cliente || 'Cliente') + '</b>' +
            '<span>' + esc(p.codigo || '') + ' · ' + hace(p.creado) + '</span></div>' +
          '<div class="res-cola__fin"><strong>' + clp(p.total) + '</strong>' +
            '<span class="pill ' + e.pill + '">' + esc(e.t) + '</span></div>' +
        '</li>';
      }).join('') + '</ul>'
      : '<div class="neg-vacio"><b>Nada pendiente.</b>No hay pedidos abiertos en este momento.</div>') +
  '</section>';
}

function bloqueTop() {
  const top = (estado.datos && Array.isArray(estado.datos.top)) ? estado.datos.top : [];
  const max = Math.max(1, ...top.map((t) => Number(t.monto) || 0));
  return '<section class="neg-tarjeta res-top" aria-labelledby="res-top-t">' +
    '<div class="res-cola__cabeza"><div><h2 id="res-top-t">Lo que más vendiste</h2>' +
      '<span class="neg-tarjeta__sub">Top 5 por monto</span></div></div>' +
    (top.length
      ? '<ol class="res-top__lista">' + top.slice(0, 5).map((t, i) => {
        const monto = Number(t.monto) || 0;
        return '<li class="res-top__item">' +
          '<span class="res-top__n">' + (i + 1) + '</span>' +
          '<div class="res-top__cuerpo"><div class="res-top__linea"><b>' + esc(t.nombre || 'Producto') + '</b>' +
            '<span>' + clp(monto) + '</span></div>' +
            '<div class="res-top__barra"><span style="width:' + Math.max(4, Math.round((monto / max) * 100)) + '%"></span></div>' +
            '<span class="res-top__unidades">' + num(t.unidades) + ' unidades</span></div>' +
        '</li>';
      }).join('') + '</ol>'
      : '<div class="neg-vacio"><b>Sin ventas todavía.</b>El ranking aparece con el primer pedido.</div>') +
  '</section>';
}

function bloqueStock(ctx) {
  const catalogo = Array.isArray(ctx.tienda.catalogo) ? ctx.tienda.catalogo : [];
  const criticos = catalogo
    .filter((p) => p.stock !== null && p.stock !== undefined && Number(p.stock) <= 5)
    .sort((a, b) => Number(a.stock) - Number(b.stock));
  return '<section class="neg-tarjeta res-stock" aria-labelledby="res-stock-t">' +
    '<div class="res-cola__cabeza"><div><h2 id="res-stock-t">Stock crítico</h2>' +
      '<span class="neg-tarjeta__sub">5 unidades o menos</span></div>' +
      '<a class="sec-head__link" href="/panel/negocio/inventario/">Revisar inventario</a></div>' +
    (criticos.length
      ? '<ul class="res-stock__lista">' + criticos.slice(0, 6).map((p) => {
        const n = Number(p.stock);
        return '<li class="res-stock__item">' +
          '<div class="res-stock__nombre"><b>' + esc(p.nombre || 'Producto') + '</b>' +
            '<span>' + esc(p.sku || '') + ' · ' + esc(p.categoria || 'Sin categoría') + '</span></div>' +
          '<span class="pill ' + (n <= 0 ? 'pill--err' : 'pill--warn') + '">' +
            (n <= 0 ? 'Agotado' : n + ' u') + '</span>' +
        '</li>';
      }).join('') + '</ul>'
      : '<div class="neg-vacio"><b>Sin alertas.</b>Ningún producto está por agotarse.</div>') +
  '</section>';
}

function pantalla(ctx) {
  const d = estado.datos;
  const t = d && d.totales ? d.totales : {};
  const r = d && d.resenas ? d.resenas : {};
  const promedio = Number(r.promedio) || 0;
  return cabecera(ctx) +
    '<div class="neg-aviso" data-aviso aria-live="polite">' + estado.aviso + '</div>' +
    '<div class="res-kpis">' +
      kpi('Ventas del período', clp(t.ventas), (d ? d.dias + ' días' : ''), 'acento') +
      kpi('Pedidos', num(t.pedidos), (t.abiertos ? t.abiertos + ' abiertos' : 'ninguno abierto'), '') +
      kpi('Ticket promedio', clp(t.ticket), 'por pedido', '') +
      kpi('Calificación', promedio > 0 ? promedio.toFixed(1).replace('.', ',') + ' ★' : '—',
        (r.n ? r.n + ' reseña' + (r.n === 1 ? '' : 's') : 'sin reseñas'), '') +
    '</div>' +
    '<div class="res-grilla">' +
      '<div class="res-columna">' + bloqueSerie() + bloqueTop() + '</div>' +
      '<div class="res-columna">' + bloqueCola() + bloqueStock(ctx) + '</div>' +
    '</div>';
}

function esqueleto() {
  return '<div class="res-esqueleto" aria-live="polite">' +
    '<div class="ds-skeleton" style="height:30px;width:220px;margin-bottom:12px"></div>' +
    '<div class="res-kpis">' +
      '<div class="ds-skeleton" style="height:92px"></div>'.repeat(4) +
    '</div>' +
    '<div class="res-grilla">' +
      '<div class="ds-skeleton" style="height:260px"></div>' +
      '<div class="ds-skeleton" style="height:260px"></div>' +
    '</div></div>';
}

function pintar(caja, ctx) {
  caja.innerHTML = pantalla(ctx);
  const cajaAviso = $('[data-aviso]', caja);

  caja.querySelectorAll('[data-dias]').forEach((b) => {
    b.addEventListener('click', () => {
      const d = Number(b.dataset.dias);
      if (!d || d === estado.dias) return;
      estado.dias = d;
      cargar(caja, ctx);
    });
  });
  const act = $('[data-actualizar]', caja);
  if (act) act.addEventListener('click', () => cargar(caja, ctx));
  const reintentar = $('[data-reintentar-cola]', caja);
  if (reintentar) reintentar.addEventListener('click', () => cargar(caja, ctx));

  if (estado.aviso && cajaAviso) cajaAviso.innerHTML = estado.aviso;
}

async function cargar(caja, ctx) {
  if (estado.cargando) return;
  estado.cargando = true;
  estado.error = '';
  estado.aviso = '';
  caja.innerHTML = esqueleto();
  const [serie, pedidos] = await Promise.allSettled([
    llamar('ventas_serie', { local_id: ctx.tienda.id, dias: estado.dias }),
    llamar('pedidos_listar', { local_id: ctx.tienda.id, limite: 12 }),
  ]);

  estado.cargando = false;

  if (serie.status === 'rejected') {
    estado.datos = null;
    estado.pedidos = [];
    caja.innerHTML = '<div class="neg-estado" role="alert">' +
      '<h2>No pudimos leer el resumen</h2>' +
      '<p>' + esc(serie.reason && serie.reason.message ? serie.reason.message : 'La nube no respondió.') + '</p>' +
      '<div class="neg-estado__acciones">' +
        '<button class="ds-btn ds-btn--primary ds-btn--sm" type="button" data-reintentar>Reintentar</button>' +
        '<a class="ds-btn ds-btn--ghost ds-btn--sm" href="/panel/negocio/pedidos/">Ver pedidos</a>' +
      '</div></div>';
    const b = $('[data-reintentar]', caja);
    if (b) b.addEventListener('click', () => cargar(caja, ctx));
    return;
  }

  estado.datos = serie.value;
  estado.errorPedidos = '';
  if (pedidos.status === 'fulfilled') {
    estado.pedidos = Array.isArray(pedidos.value.pedidos) ? pedidos.value.pedidos : [];
  } else {
    estado.pedidos = [];
    estado.errorPedidos = pedidos.reason && pedidos.reason.message
      ? pedidos.reason.message
      : 'La nube no respondió.';
  }
  pintar(caja, ctx);
}

arrancar({
  alListo: (ctx) => {
    estado.ctx = ctx;
    const caja = $('[data-negocio]');
    if (caja) cargar(caja, ctx);
  },
});
