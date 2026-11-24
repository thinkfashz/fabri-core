/* N09 · Clientes (CRM)
   Listado de clientes de la tienda con ficha individual y exportación CSV.
   Todo se lee de `clientes_listar` con la sesión del dueño: se usa `llamar`
   de negocio.js, nunca `fetch` directo (hay un test que lo prohíbe fuera de
   panel/comun/api.js). Nunca se inventan clientes ni teléfonos: si la API no
   devuelve nada se muestra el vacío, y si falla se dice con reintentar. */

import { arrancar, llamar, estadoDe } from '../../comun/negocio.js';
import { esc, iniciales, fechaHora, fecha, hace, clp, num } from '../../comun/formato.js';

const $ = (sel, raiz) => (raiz || document).querySelector(sel);
const $$ = (sel, raiz) => Array.from((raiz || document).querySelectorAll(sel));

/* Segmentos que envía la API: recurrente / nuevo / inactivo. «Con cuenta» no
   es un segmento de la API, así que se filtra en el cliente cuando la marca
   está activa; no se envía ningún parámetro de segmento en ese caso. */
const SEGMENTOS = [
  { clave: null, t: 'Todos' },
  { clave: 'recurrente', t: 'Recurrentes' },
  { clave: 'nuevo', t: 'Nuevos' },
  { clave: 'inactivo', t: 'Inactivos' },
  { clave: 'cuenta', t: 'Con cuenta' },
];

function pastillaSegmento(clave) {
  return { recurrente: 'pill--ok', nuevo: 'pill--acento', inactivo: 'pill--warn' }[clave] || '';
}
function textoSegmento(clave) {
  return { recurrente: 'Recurrente', nuevo: 'Nuevo', inactivo: 'Inactivo' }[clave] || '';
}

const estado = {
  ctx: null,
  clientes: [],
  resumen: {},
  q: '',
  segmento: null,        // null = Todos; 'recurrente' | 'nuevo' | 'inactivo'
  cuentaSolo: false,     // filtro 'Con cuenta', hecho en el cliente
  cargando: false,
  error: '',
  aviso: '',             // aviso temporal: se muestra una vez y se limpia
  clienteId: null,       // cliente cuya ficha está abierta
  timer: null,           // refresco automático cada 60 s
  buscaTimer: null,      // debounce del buscador (250 ms)
  esMovil: window.innerWidth <= 900,
};

/* ── filtros de la lista ─────────────────────────────────────────────── */

function visibles() {
  let lista = estado.clientes;
  if (estado.cuentaSolo) {
    lista = lista.filter((c) => c.con_cuenta === true);
  } else if (estado.segmento) {
    lista = lista.filter((c) => c.segmento === estado.segmento);
  }
  if (estado.q) {
    const q = String(estado.q).toLowerCase();
    lista = lista.filter((c) =>
      String(c.nombre || '').toLowerCase().includes(q) ||
      String(c.telefono || '').includes(q)
    );
  }
  return lista;
}

/* ── esqueleto de carga ──────────────────────────────────────────────── */

function esqueleto() {
  return '<div class="cli-esqueleto" aria-live="polite">' +
    '<div class="ds-skeleton" style="height:92px;width:min(320px,100%)"></div>' +
    '<div class="ds-skeleton" style="height:16px;width:200px;margin-top:10px"></div>' +
    '<div class="cli-grilla-esqueleto">' +
      '<div class="ds-skeleton" style="height:100px"></div>' +
      '<div class="ds-skeleton" style="height:100px"></div>' +
      '<div class="ds-skeleton" style="height:100px"></div>' +
    '</div></div>';
}

/* ── KPIs del resumen ────────────────────────────────────────────────── */

function kpisHtml(r) {
  return '<div class="cli-kpis">' +
    '<div class="ds-stat">' +
      '<span class="ds-stat__label">Clientes totales</span>' +
      '<span class="ds-stat__value ds-tabular">' + num(r.total || 0) + '</span>' +
      '<span class="ds-stat__meta">de la tienda</span>' +
    '</div>' +
    '<div class="ds-stat">' +
      '<span class="ds-stat__label">Con cuenta</span>' +
      '<span class="ds-stat__value ds-stat__value--ok ds-tabular">' + num(r.con_cuenta || 0) + '</span>' +
      '<span class="ds-stat__meta">se identificaron al comprar</span>' +
    '</div>' +
    '<div class="ds-stat">' +
      '<span class="ds-stat__label">Recurrentes</span>' +
      '<span class="ds-stat__value ds-stat__value--acento ds-tabular">' + num(r.recurrentes || 0) + '</span>' +
      '<span class="ds-stat__meta">más de un pedido</span>' +
    '</div>' +
    '<div class="ds-stat">' +
      '<span class="ds-stat__label">Gasto acumulado</span>' +
      '<span class="ds-stat__value ds-tabular">' + clp(r.gastado || 0) + '</span>' +
      '<span class="ds-stat__meta">en todos los pedidos</span>' +
    '</div>' +
  '</div>';
}

/* ── buscador y filtros ──────────────────────────────────────────────── */

function barraHtml() {
  return '<div class="cli-barra">' +
    '<label class="cli-label" for="cli-buscar">Buscar cliente</label>' +
    '<input type="search" id="cli-buscar" data-buscar autocomplete="off" ' +
      'placeholder="Nombre o teléfono" ' +
      'aria-label="Buscar clientes por nombre o número de teléfono" ' +
      'value="' + esc(estado.q) + '">' +
    '<span class="cli-contador" data-contador aria-live="polite"></span>' +
  '</div>';
}

function filtrosHtml() {
  const items = SEGMENTOS.map((s) => {
    let activo = false;
    if (s.clave === null) activo = estado.segmento === null && !estado.cuentaSolo;
    else if (s.clave === 'cuenta') activo = estado.cuentaSolo === true;
    else activo = estado.segmento === s.clave;
    return '<button type="button" role="tab" data-seg="' + (s.clave == null ? 'todos' : s.clave) + '" aria-selected="' + activo + '">' +
      esc(s.t) + '</button>';
  }).join('');
  return '<div class="neg-seg cli-filtros" role="tablist" aria-label="Filtrar clientes">' + items + '</div>';
}

/* ── listado ─────────────────────────────────────────────────────────── */

function filaHtml(c) {
  const id = esc(c.id || '');
  const nombre = String(c.nombre || 'Cliente sin nombre');
  const telefono = String(c.telefono || '—');
  return '<tr data-cliente="' + id + '">' +
    '<td data-label="Cliente">' +
      '<div class="cli-contacto">' +
        '<span class="ds-avatar">' + esc(iniciales(nombre)) + '</span>' +
        '<div class="cli-contacto__texto">' +
          '<b class="cli-contacto__nombre">' + esc(nombre) + '</b>' +
          '<span class="pill ' + pastillaSegmento(c.segmento) + '">' + esc(textoSegmento(c.segmento)) + '</span>' +
        '</div>' +
      '</div>' +
    '</td>' +
    '<td data-label="Teléfono" class="cli-tel">' + esc(telefono) + '</td>' +
    '<td data-label="Pedidos" class="ds-num cli-num">' + num(c.pedidos || 0) + '</td>' +
    '<td data-label="Gastado" class="ds-num cli-num">' + clp(c.gastado || 0) + '</td>' +
    '<td data-label="Última compra">' + (c.ultimo ? esc(hace(c.ultimo)) : '—') + '</td>' +
    '<td data-label="Acción"><button class="ds-btn ds-btn--ghost ds-btn--sm" type="button" data-ver="' + id + '">Ver ficha</button></td>' +
  '</tr>';
}

function listadoHtml(lista) {
  const filas = lista.map(filaHtml).join('');
  return '<table class="ds-table cli-tabla ds-table--stack" aria-label="Listado de clientes">' +
    '<caption class="sr-only">Clientes del negocio</caption>' +
    '<thead><tr>' +
      '<th scope="col">Cliente</th>' +
      '<th scope="col">Teléfono</th>' +
      '<th scope="col" class="ds-num">Pedidos</th>' +
      '<th scope="col" class="ds-num">Gastado</th>' +
      '<th scope="col">Última compra</th>' +
      '<th scope="col"></th>' +
    '</tr></thead>' +
    '<tbody>' + filas + '</tbody>' +
  '</table>';
}

/* ── ficha del cliente ───────────────────────────────────────────────── */

function kpisFichaHtml(c) {
  return '<div class="ds-stat"><span class="ds-stat__label">Pedidos</span><span class="ds-stat__value ds-tabular">' +
    num(c.pedidos || 0) + '</span></div>' +
    '<div class="ds-stat"><span class="ds-stat__label">Gastado total</span><span class="ds-stat__value ds-tabular">' +
    clp(c.gastado || 0) + '</span></div>' +
    '<div class="ds-stat"><span class="ds-stat__label">Ticket promedio</span><span class="ds-stat__value ds-tabular">' +
    clp(c.ticket || 0) + '</span></div>' +
    '<div class="ds-stat"><span class="ds-stat__label">Teléfono</span><span class="ds-stat__value ds-tabular">' +
    esc(String(c.telefono || '—')) + '</span></div>';
}

function fichaHtml(c) {
  const id = esc(c.id || '');
  const nombre = String(c.nombre || 'Cliente sin nombre');
  const telefono = String(c.telefono || '—');
  const ult = c.ultimo ? new Date(c.ultimo) : null;
  const pri = c.primera ? new Date(c.primera) : null;
  const pedidos = Array.isArray(c.ultimos) ? c.ultimos : [];
  const filasPedidos = pedidos.map((p) => {
    const es = estadoDe(p.estado);
    return '<tr>' +
      '<td data-label="Pedido" class="cli-pedido__codigo">' + esc(p.codigo || '—') + '</td>' +
      '<td data-label="Total" class="ds-num cli-num">' + clp(p.total || 0) + '</td>' +
      '<td data-label="Estado"><span class="pill ' + (es.pill || '') + '">' + esc(es.t) + '</span></td>' +
      '<td data-label="Fecha">' + (p.creado ? esc(fechaHora(p.creado)) : '—') + '</td>' +
      '<td data-label="Entrega">' + (p.entrega ? esc(fechaHora(p.entrega)) : '—') + '</td>' +
    '</tr>';
  }).join('');
  return '<section class="cli-ficha" data-ficha aria-labelledby="cli-ficha-titulo">' +
    '<div class="cli-ficha__barra">' +
      '<button class="cli-ficha__cerrar cli-ficha__cerrar-movil" type="button" data-cerrar-ficha aria-label="Cerrar ficha de ' + esc(nombre) + '">Cerrar</button>' +
      '<h2 id="cli-ficha-titulo">' + esc(nombre) + '</h2>' +
      '<button class="cli-ficha__cerrar cli-ficha__cerrar-escritorio" type="button" data-cerrar-ficha>Cerrar ficha</button>' +
    '</div>' +
    '<div class="cli-ficha__cuerpo">' +
      '<div class="cli-ficha__cabeza">' +
        '<span class="ds-avatar cli-ficha__avatar">' + esc(iniciales(nombre)) + '</span>' +
        '<div>' +
          '<b>' + esc(nombre) + '</b>' +
          '<div class="cli-ficha__etiquetas">' +
            '<span class="pill ' + pastillaSegmento(c.segmento) + '">' + esc(textoSegmento(c.segmento)) + '</span>' +
            (c.con_cuenta ? '<span class="pill pill--acento">Con cuenta</span>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="cli-ficha__datos">' + kpisFichaHtml(c) + '</div>' +
      '<div class="cli-ficha__fechas">' +
        '<div class="ds-row"><span class="ds-row__key">Primera compra</span><span class="ds-row__value">' + (pri ? esc(fecha(pri)) : '—') + '</span></div>' +
        '<div class="ds-row"><span class="ds-row__key">Última compra</span><span class="ds-row__value">' + (ult ? esc(fechaHora(ult)) : '—') + '</span></div>' +
      '</div>' +
      '<section class="cli-ficha__pedidos">' +
        '<h3 class="cli-ficha__sub">Últimos pedidos</h3>' +
        (pedidos.length
          ? '<table class="ds-table"><caption class="sr-only">Últimos pedidos de ' + esc(nombre) + '</caption>' +
            '<thead><tr><th scope="col">Pedido</th><th scope="col" class="ds-num">Total</th><th scope="col">Estado</th><th scope="col">Fecha</th><th scope="col">Entrega</th></tr></thead>' +
            '<tbody>' + filasPedidos + '</tbody></table>'
          : '<p class="cli-sin-pedidos">Sin pedidos registrados todavía.</p>') +
      '</section>' +
    '</div>' +
  '</section>';
}

function fichaHtmlDe(id) {
  if (!id) return '';
  const c = estado.clientes.find((x) => x.id === id);
  return c ? fichaHtml(c) : '';
}

/* ── pantalla completa ───────────────────────────────────────────────── */

function pantalla(ctx, lista) {
  const vacio = !lista.length;
  const mensajeVacio = estado.q
    ? 'No se encontraron clientes con «' + esc(estado.q) + '». Prueba con otro nombre o número de teléfono.'
    : 'Todavía no hay clientes en tu tienda. Aparecen cuando entra el primer pedido.';
  return '<header class="neg-cabeza">' +
      '<div><span class="neg-cabeza__kicker">Clientes del negocio</span>' +
        '<h1>Clientes</h1>' +
        '<p>Personas que han comprado en tu tienda, con lo que gastan y cuándo compraron por última vez.</p></div>' +
      '<div class="neg-cabeza__acciones">' +
        '<button class="ds-btn ds-btn--secondary ds-btn--sm" type="button" data-actualizar>Actualizar</button>' +
        '<button class="ds-btn ds-btn--ghost ds-btn--sm" type="button" data-exportar>Exportar CSV</button>' +
      '</div>' +
    '</header>' +
    '<div class="neg-aviso" data-aviso aria-live="polite"></div>' +
    kpisHtml(estado.resumen) +
    barraHtml() +
    filtrosHtml() +
    '<div class="cli-contenido' + (estado.clienteId ? ' cli-con--ficha' : '') + '">' +
      '<div class="cli-cuerpo" id="cli-cuerpo">' +
        (estado.cargando && !estado.clientes.length ? esqueleto() :
         vacio
          ? '<div class="neg-vacio cli-vacio"><b>' +
            (estado.q ? 'No se encontraron clientes' : 'Todavía no hay clientes') +
            '</b><p>' + esc(mensajeVacio) + '</p>' +
            (estado.q ? '<button class="ds-btn ds-btn--ghost ds-btn--sm" type="button" data-limpiar-buscar>Limpiar búsqueda</button>' : '') +
            '</div>'
          : '<div class="cli-wrap">' + listadoHtml(lista) + '</div>') +
      '</div>' +
      fichaHtmlDe(estado.clienteId) +
    '</div>';
}

/* ── acciones de ficha ───────────────────────────────────────────────── */

function abrirFicha(id) {
  const c = estado.clientes.find((x) => x.id === id);
  if (!c) return;
  estado.clienteId = id;
  pintar($('[data-negocio]'), estado.ctx);
  if (estado.esMovil) {
    const ficha = $('[data-ficha]');
    if (ficha) ficha.classList.add('cli-ficha--abierto');
    const backdrop = $('.cli-backdrop');
    if (backdrop) backdrop.classList.add('cli-backdrop--on');
    document.body.style.overflow = 'hidden';
    const b = $('[data-cerrar-ficha]', $('[data-ficha]'));
    if (b) b.focus();
  }
}

function cerrarFicha() {
  estado.clienteId = null;
  const caja = $('[data-negocio]');
  const ficha = $('[data-ficha]');
  const cuerpo = $('.cli-contenido');
  if (ficha) ficha.classList.remove('cli-ficha--abierto');
  if (cuerpo) cuerpo.classList.remove('cli-con--ficha');
  const backdrop = $('.cli-backdrop');
  if (backdrop) backdrop.classList.remove('cli-backdrop--on');
  document.body.style.overflow = '';
  pintar(caja, estado.ctx);
}

function sincronizarFicha() {
  const movil = window.innerWidth <= 900;
  estado.esMovil = movil;
  const ficha = $('[data-ficha]');
  const cuerpo = $('.cli-contenido');
  const abierto = !!estado.clienteId;
  if (movil) {
    if (ficha) ficha.classList.toggle('cli-ficha--abierto', abierto);
    if (cuerpo) cuerpo.classList.remove('cli-con--ficha');
  } else {
    if (ficha) ficha.classList.remove('cli-ficha--abierto');
    if (cuerpo) cuerpo.classList.toggle('cli-con--ficha', abierto);
    const backdrop = $('.cli-backdrop');
    if (backdrop) backdrop.classList.remove('cli-backdrop--on');
    document.body.style.overflow = '';
  }
}

/* ── exportar CSV (solo navegador, sin endpoint) ─────────────────────── */

function escCsv(v) {
  const s = String(v == null ? '' : v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function exportarCSV(lista) {
  const filas = ['Nombre,Teléfono,Pedidos,Gastado,Última compra'];
  for (const c of lista) {
    const ult = c.ultimo ? new Date(c.ultimo).toLocaleDateString('es-CL') : '';
    filas.push([
      escCsv(c.nombre),
      escCsv(c.telefono),
      c.pedidos || 0,
      clp(c.gastado || 0),
      ult,
    ].join(','));
  }
  const texto = filas.join('\r\n');
  const blob = new Blob([texto], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'clientes-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  estado.aviso = '<span class="aviso aviso--ok" role="status">CSV exportado: ' +
    lista.length + ' cliente' + (lista.length === 1 ? '' : 's') + '.</span>';
  pintar($('[data-negocio]'), estado.ctx);
}

/* ── carga de datos ──────────────────────────────────────────────────── */

async function cargar(caja, ctx, callado) {
  if (estado.cargando) return;
  if (!navigator.onLine) {
    estado.error = 'Sin conexión a internet. Revisa el Wi-Fi o los datos móviles y vuelve a intentar.';
    pintar(caja, ctx);
    return;
  }
  estado.cargando = true;
  estado.error = '';
  if (!callado) caja.innerHTML = esqueleto();
  try {
    const cuerpo = { local_id: ctx.tienda.id };
    if (estado.q) cuerpo.q = estado.q;
    if (estado.segmento) cuerpo.segmento = estado.segmento;
    const d = await llamar('clientes_listar', cuerpo);
    estado.clientes = Array.isArray(d.clientes) ? d.clientes : [];
    estado.resumen = d.resumen || {};
    estado.cargando = false;
    if (estado.clienteId && !estado.clientes.some((c) => c.id === estado.clienteId)) {
      cerrarFicha();
      return;
    }
    pintar(caja, ctx);
  } catch (fallo) {
    estado.cargando = false;
    estado.error = fallo && fallo.message ? fallo.message : 'La nube no respondió.';
    pintar(caja, ctx);
  }
}

function iniciarRefresco() {
  if (estado.timer) clearInterval(estado.timer);
  estado.timer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      cargar($('[data-negocio]'), estado.ctx, true);
    }
  }, 60000);
}

/* ── pintado y eventos ───────────────────────────────────────────────── */

function pintar(caja, ctx) {
  if (estado.error) {
    caja.innerHTML = '<div class="neg-estado" role="alert">' +
      '<h2>No se pudieron cargar los clientes</h2>' +
      '<p>' + esc(estado.error) + '</p>' +
      '<div class="neg-estado__acciones">' +
        '<button class="ds-btn ds-btn--primary ds-btn--sm" type="button" data-reintentar>Reintentar</button>' +
        '<button class="ds-btn ds-btn--ghost ds-btn--sm" type="button" data-limpiar-error>Descartar</button>' +
      '</div>' +
    '</div>';
    $('[data-reintentar]', caja)?.addEventListener('click', () => cargar(caja, ctx));
    $('[data-limpiar-error]', caja)?.addEventListener('click', () => {
      estado.error = '';
      pintar(caja, ctx);
    });
    return;
  }

  const lista = visibles();
  caja.innerHTML = pantalla(ctx, lista);

  const aviso = $('[data-aviso]', caja);
  if (aviso) {
    aviso.innerHTML = estado.aviso;
    estado.aviso = '';
  }

  $$('[data-seg]', caja).forEach((b) => {
    b.addEventListener('click', () => {
      const raw = b.dataset.seg || '';
      const clave = raw === 'todos' ? null : raw;
      if (clave === 'cuenta') {
        estado.cuentaSolo = !estado.cuentaSolo;
        if (estado.cuentaSolo) estado.segmento = null;
      } else {
        estado.cuentaSolo = false;
        estado.segmento = estado.segmento === clave ? null : clave;
      }
      pintar(caja, ctx);
      if (clave !== 'cuenta') cargar(caja, ctx);
    });
  });

  const buscar = $('[data-buscar]', caja);
  if (buscar) {
    buscar.addEventListener('input', (e) => {
      estado.q = e.target.value;
      clearTimeout(estado.buscaTimer);
      estado.buscaTimer = setTimeout(() => cargar(caja, ctx), 250);
    });
  }

  $('[data-actualizar]', caja)?.addEventListener('click', () => {
    estado.aviso = '<span class="aviso aviso--acento" role="status">Actualizando…</span>';
    pintar(caja, ctx);
    cargar(caja, ctx);
  });

  $('[data-exportar]', caja)?.addEventListener('click', () => {
    if (!lista.length) {
      estado.aviso = '<span class="aviso aviso--warn" role="status">No hay clientes para exportar.</span>';
      pintar(caja, ctx);
      return;
    }
    exportarCSV(lista);
  });

  $$('[data-ver]', caja).forEach((b) => {
    b.addEventListener('click', () => abrirFicha(b.dataset.ver));
  });

  $('[data-cerrar-ficha]', caja)?.addEventListener('click', cerrarFicha);

  $('[data-limpiar-buscar]', caja)?.addEventListener('click', () => {
    estado.q = '';
    const input = $('[data-buscar]', caja);
    if (input) input.value = '';
    cargar(caja, ctx);
  });

  const contador = $('[data-contador]', caja);
  if (contador) {
    contador.textContent = lista.length + ' de ' + estado.clientes.length + ' cliente' +
      (estado.clientes.length === 1 ? '' : 's');
  }
}

arrancar({
  alListo(ctx) {
    estado.ctx = ctx;
    const caja = $('[data-negocio]');
    if (!caja) return;
    cargar(caja, ctx);
    iniciarRefresco();
    sincronizarFicha();
    window.addEventListener('resize', sincronizarFicha);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && estado.esMovil && estado.clienteId) cerrarFicha();
    });
    window.addEventListener('online', () => {
      if (!estado.ctx) return;
      cargar($('[data-negocio]'), estado.ctx);
    });
    window.addEventListener('pagehide', () => {
      if (estado.timer) { clearInterval(estado.timer); estado.timer = null; }
    });
  },
});
