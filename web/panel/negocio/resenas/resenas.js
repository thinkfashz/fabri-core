/* N08 · Reseñas
   El promedio y la distribución salen de `resenas_panel`, que devuelve todas
   las reseñas de la tienda —también las ocultas— para que el dueño modere.
   El promedio público que muestra la ficha excluye las ocultas: acá se dice
   explícitamente para no confundir la cuenta. */

import { arrancar, llamar } from '../../comun/negocio.js';
import { esc, iniciales, fechaHora } from '../../comun/formato.js';

const $ = (sel, raiz) => (raiz || document).querySelector(sel);
const $$ = (sel, raiz) => Array.from((raiz || document).querySelectorAll(sel));

const estado = {
  ctx: null,
  datos: null,
  error: '',
  cargando: false,
  filtro: 'todas',
  confirmar: '',
  ocultar: true,
  moderando: '',
  aviso: '',
};

function estrellas(n) {
  const v = Math.max(0, Math.min(5, Number(n) || 0));
  let s = '';
  for (let i = 1; i <= 5; i++) {
    s += '<span class="rev-estrella' + (i <= v ? ' rev-estrella--on' : '') + '" aria-hidden="true">' +
      (i <= v ? '★' : '☆') + '</span>';
  }
  return '<span class="rev-estrellas" role="img" aria-label="' + v + ' de 5 estrellas">' + s + '</span>';
}

function distribucion(resenas) {
  const visibles = resenas.filter((r) => !r.oculta);
  return [5, 4, 3, 2, 1].map((n) => ({
    n,
    cuenta: visibles.filter((r) => Number(r.estrellas) === n).length,
  }));
}

function filtradas() {
  const resenas = estado.datos && Array.isArray(estado.datos.resenas) ? estado.datos.resenas : [];
  const f = estado.filtro;
  if (f === 'todas') return resenas;
  if (f === 'ocultas') return resenas.filter((r) => r.oculta);
  const n = Number(f);
  return resenas.filter((r) => !r.oculta && Number(r.estrellas) === n);
}

function resumenHtml() {
  const c = (estado.datos && estado.datos.calificacion) || {};
  const resenas = (estado.datos && estado.datos.resenas) || [];
  const n = Number(c.n) || 0;
  const promedio = Number(c.promedio) || 0;
  const ocultas = Number(c.ocultas) || 0;
  const dist = distribucion(resenas);
  const max = Math.max(1, ...dist.map((d) => d.cuenta));
  const todos = resenas.length;

  return '<div class="rev-resumen__nota">' +
      '<span>Promedio público</span>' +
      '<span class="pill ' + (n ? 'pill--ok' : 'pill--err') + '">' +
        (n ? 'visible' : 'sin reseñas visibles') + '</span>' +
    '</div>' +
    '<div class="rev-promedio">' +
      '<strong>' + (promedio > 0 ? promedio.toFixed(1).replace('.', ',') : '—') + '</strong>' +
      '<div class="rev-promedio__lado">' + estrellas(Math.round(promedio)) +
        '<small>' + n + ' reseña' + (n === 1 ? '' : 's') + ' visible' + (n === 1 ? '' : 's') + '</small>' +
      '</div>' +
    '</div>' +
    (ocultas
      ? '<p class="rev-resumen__alerta">' + ocultas + ' oculta' + (ocultas === 1 ? '' : 's') +
        ' no cuenta' + (ocultas === 1 ? '' : 'n') + ' para el promedio.</p>'
      : '') +
    '<div class="rev-dist">' +
      dist.map((d) => '<div class="rev-dist__fila">' +
        '<span class="rev-dist__n">' + d.n + ' <span aria-hidden="true">★</span></span>' +
        '<span class="rev-dist__barra"><span style="width:' +
          (d.cuenta ? Math.max(4, Math.round((d.cuenta / max) * 100)) : 0) + '%"></span></span>' +
        '<b>' + d.cuenta + '</b>' +
      '</div>').join('') +
    '</div>' +
    '<p class="rev-resumen__pie">' + (todos
      ? (todos === n
        ? 'Todas las reseñas están visibles.'
        : 'El comprador sólo ve las reseñas visibles y su promedio.')
      : 'Cuando un pedido se entregue, el comprador podrá dejar su reseña desde la app.') + '</p>';
}

function filtrosHtml() {
  const resenas = (estado.datos && estado.datos.resenas) || [];
  const ocultas = resenas.filter((r) => r.oculta).length;
  const items = [{ v: 'todas', t: 'Todas', n: resenas.length }];
  for (const n of [5, 4, 3, 2, 1]) {
    items.push({ v: String(n), t: n + ' ★', n: resenas.filter((r) => !r.oculta && Number(r.estrellas) === n).length });
  }
  items.push({ v: 'ocultas', t: 'Ocultas', n: ocultas });
  return '<div class="neg-seg rev-filtros" role="tablist" aria-label="Filtrar reseñas">' +
    items.map((i) => '<button type="button" role="tab" data-filtro="' + i.v + '" aria-selected="' +
      (estado.filtro === i.v ? 'true' : 'false') + '">' + esc(i.t) +
      '<span class="rev-filtros__n">' + i.n + '</span></button>').join('') +
  '</div>';
}

function itemHtml(r) {
  const id = esc(r.id || '');
  const autor = String(r.autor || '').trim() || 'Cliente';
  const detalle = esc(fechaHora(r.creado));
  const abriendo = estado.confirmar === r.id;
  const boton = estado.moderando === r.id
    ? '<span class="rev-item__ocupado">Guardando…</span>'
    : (abriendo
      ? '<div class="rev-confirmar">' +
        '<p>' + (estado.ocultar
          ? 'Dejará de aparecer en la ficha y no contará para el promedio.'
          : 'Volverá a la ficha y contará para el promedio.') + '</p>' +
        '<div class="rev-confirmar__acciones">' +
          '<button class="ds-btn ds-btn--' + (estado.ocultar ? 'danger' : 'primary') + ' ds-btn--sm" type="button" data-confirmar="' + id + '">' +
            (estado.ocultar ? 'Sí, ocultar' : 'Sí, mostrar') + '</button>' +
          '<button class="ds-btn ds-btn--ghost ds-btn--sm" type="button" data-cancelar>Cancelar</button>' +
        '</div>' +
      '</div>'
      : '<button class="ds-btn ds-btn--ghost ds-btn--sm" type="button" data-moderar="' + id + '" data-ocultar="' +
        (r.oculta ? '0' : '1') + '">' + (r.oculta ? 'Volver a mostrar' : 'Ocultar del público') + '</button>');

  return '<article class="rev-item' + (r.oculta ? ' rev-item--oculta' : '') + '" data-resena="' + id + '">' +
    '<div class="rev-item__cabeza">' +
      '<span class="rev-avatar" aria-hidden="true">' + esc(iniciales(autor)) + '</span>' +
      '<div class="rev-item__quien"><b>' + esc(autor) + '</b>' +
        '<small>' + detalle + '</small></div>' +
      '<div class="rev-item__lado">' + estrellas(r.estrellas) +
        (r.oculta ? '<span class="pill pill--warn">Oculta</span>' : '') + '</div>' +
    '</div>' +
    (String(r.texto || '').trim()
      ? '<p class="rev-item__texto">' + esc(String(r.texto).trim()) + '</p>'
      : '<p class="rev-item__texto rev-item__texto--vacio">Sin comentario: sólo dejó las estrellas.</p>') +
    '<div class="rev-item__pie">' + boton + '</div>' +
  '</article>';
}

function bandejaHtml() {
  const lista = filtradas();
  const resenas = (estado.datos && estado.datos.resenas) || [];
  const ocultas = resenas.filter((r) => r.oculta).length;
  const visibles = resenas.length - ocultas;

  let cuerpo;
  if (!resenas.length) {
    cuerpo = '<div class="neg-vacio rev-vacio"><b>Todavía no tienes reseñas.</b>' +
      'Se habilitan cuando un pedido queda entregado: el comprador califica desde ' +
      'su cuenta y la reseña aparece acá.' +
      '<div class="rev-vacio__acciones">' +
        '<a class="ds-btn ds-btn--ghost ds-btn--sm" href="/panel/negocio/pedidos/">Ver pedidos</a>' +
      '</div></div>';
  } else if (!lista.length) {
    cuerpo = '<div class="neg-vacio rev-vacio"><b>No hay reseñas con ese filtro.</b>' +
      'Prueba con «Todas» o con «Ocultas».</div>';
  } else {
    cuerpo = '<div class="rev-lista">' + lista.map(itemHtml).join('') + '</div>';
  }

  return '<div class="rev-bandeja__cabeza">' +
      '<div><h2>Bandeja</h2>' +
        '<span class="neg-tarjeta__sub">' + lista.length + ' de ' + resenas.length +
          ' · ' + visibles + ' visible' + (visibles === 1 ? '' : 's') + '</span></div>' +
      filtrosHtml() +
    '</div>' +
    (resenas.length && !visibles
      ? '<div class="aviso aviso--warn rev-aviso">Todas las reseñas están ocultas: ' +
        'la ficha muestra el promedio vacío hasta que vuelvas a mostrar alguna.</div>'
      : '') +
    cuerpo;
}

function esqueleto() {
  return '<div class="rev-esqueleto" aria-live="polite">' +
    '<div class="ds-skeleton" style="height:34px;width:240px;margin-bottom:14px"></div>' +
    '<div class="rev-grilla">' +
      '<div class="ds-skeleton" style="height:300px"></div>' +
      '<div class="ds-skeleton" style="height:300px"></div>' +
    '</div></div>';
}

function pantalla(ctx) {
  return '<header class="neg-cabeza">' +
      '<div><span class="neg-cabeza__kicker">Lo que dicen</span>' +
        '<h1>Reseñas</h1>' +
        '<p>El promedio real de tu tienda y la bandeja para moderar. ' +
          'Ocultar una reseña no la borra: deja de mostrarse y de contar.</p></div>' +
      '<div class="neg-cabeza__acciones">' +
        '<button class="ds-btn ds-btn--secondary ds-btn--sm" type="button" data-actualizar>Actualizar</button>' +
        '<a class="ds-btn ds-btn--ghost ds-btn--sm" target="_blank" rel="noopener" href="' +
          esc(location.origin + '/panel/cliente/tienda/?id=' + encodeURIComponent(ctx.tienda.id)) +
          '">Ver ficha</a>' +
      '</div>' +
    '</header>' +
    '<div class="neg-aviso" data-aviso aria-live="polite">' + estado.aviso + '</div>' +
    '<div class="rev-grilla">' +
      '<aside class="neg-tarjeta rev-resumen" aria-label="Calificación de la tienda">' +
        resumenHtml() +
      '</aside>' +
      '<section class="neg-tarjeta rev-bandeja" aria-labelledby="rev-bandeja-t">' +
        '<h2 id="rev-bandeja-t" class="sr-only">Reseñas recibidas</h2>' +
        bandejaHtml() +
      '</section>' +
    '</div>';
}

function pintar(caja, ctx) {
  if (estado.error) {
    caja.innerHTML = '<div class="neg-estado" role="alert">' +
      '<h2>No pudimos leer las reseñas</h2>' +
      '<p>' + esc(estado.error) + '</p>' +
      '<div class="neg-estado__acciones">' +
        '<button class="ds-btn ds-btn--primary ds-btn--sm" type="button" data-reintentar>Reintentar</button>' +
        '<a class="ds-btn ds-btn--ghost ds-btn--sm" href="/panel/negocio/resumen/">Volver al resumen</a>' +
      '</div></div>';
    $('[data-reintentar]', caja)?.addEventListener('click', () => cargar(caja, ctx));
    return;
  }

  caja.innerHTML = pantalla(ctx);

  $$('[data-filtro]', caja).forEach((b) => {
    b.addEventListener('click', () => {
      if (estado.filtro === b.dataset.filtro) return;
      estado.filtro = b.dataset.filtro;
      estado.confirmar = '';
      pintar(caja, ctx);
    });
  });

  $('[data-actualizar]', caja)?.addEventListener('click', () => {
    estado.aviso = '';
    cargar(caja, ctx);
  });

  $$('[data-moderar]', caja).forEach((b) => {
    b.addEventListener('click', () => {
      estado.confirmar = b.dataset.moderar;
      estado.ocultar = b.dataset.ocultar === '1';
      pintar(caja, ctx);
    });
  });

  $('[data-cancelar]', caja)?.addEventListener('click', () => {
    estado.confirmar = '';
    pintar(caja, ctx);
  });

  $('[data-confirmar]', caja)?.addEventListener('click', (e) => {
    moderar(caja, ctx, e.currentTarget.dataset.confirmar, estado.ocultar);
  });
}

async function moderar(caja, ctx, id, oculta) {
  if (estado.moderando) return;
  estado.moderando = id;
  estado.aviso = '';
  pintar(caja, ctx);
  try {
    await llamar('resena_moderar', { local_id: ctx.tienda.id, resena_id: id, oculta });
    estado.moderando = '';
    estado.confirmar = '';
    estado.aviso = '<div class="aviso aviso--ok">' +
      (oculta ? 'La reseña quedó oculta del público.' : 'La reseña volvió a mostrarse.') + '</div>';
    await cargar(caja, ctx, true);
  } catch (fallo) {
    estado.moderando = '';
    estado.confirmar = '';
    estado.aviso = '<div class="aviso aviso--err">' +
      esc(fallo && fallo.message ? fallo.message : 'No se pudo moderar la reseña.') + '</div>';
    pintar(caja, ctx);
  }
}

async function cargar(caja, ctx, callado) {
  if (estado.cargando) return;
  estado.cargando = true;
  estado.error = '';
  if (!callado) caja.innerHTML = esqueleto();
  try {
    const d = await llamar('resenas_panel', { local_id: ctx.tienda.id });
    estado.datos = {
      calificacion: d.calificacion || { n: 0, promedio: 0, ocultas: 0 },
      resenas: Array.isArray(d.resenas) ? d.resenas : [],
    };
    estado.cargando = false;
    pintar(caja, ctx);
  } catch (fallo) {
    estado.cargando = false;
    estado.datos = null;
    estado.error = fallo && fallo.message ? fallo.message : 'La nube no respondió.';
    pintar(caja, ctx);
  }
}

arrancar({
  alListo(ctx) {
    estado.ctx = ctx;
    estado.filtro = 'todas';
    estado.confirmar = '';
    const caja = $('[data-negocio]');
    if (caja) cargar(caja, ctx);
  },
});
