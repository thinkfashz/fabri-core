/* C09 · Mis pedidos
   El historial real de la cuenta (`mis_pedidos`) más lo que quedó guardado
   en este teléfono (`fcore.placer.pedidos`). Los pedidos de invitado no se
   pueden reclamar después: se muestran marcados y se abren con su enlace.
   «Volver a pedir» rearma el carrito con el catálogo y los precios de HOY. */

import { mercado, mercadoPost, mensajeDeError } from '../../comun/api.js';
import { leerPedidos, enlaceSeguimiento } from '../../comun/pedidos.js';
import { buscarEnTienda, productosDe } from '../../comun/catalogo.js';
import { agregar } from '../../comun/carrito.js';
import { activa, alCambiar, token, dispositivo } from '../../comun/sesion.js';
import { clp, fechaHora, esc, iniciales } from '../../comun/formato.js';

const $ = (sel) => document.querySelector(sel);

const ESTADOS = {
  nuevo: { t: 'Recibido', pill: 'pill--acento' },
  visto: { t: 'En preparación', pill: 'pill--warn' },
  listo: { t: 'Listo', pill: 'pill--ok' },
  entregado: { t: 'Entregado', pill: 'pill--ok' },
  cancelado: { t: 'Cancelado', pill: 'pill--err' },
};

const estadoPagina = {
  pedidos: [],
  cargando: true,
  error: '',
  filtro: 'todos',
  q: '',
  sel: '',
  abierto: false,
  remoto: false,
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

function logo(local) {
  const ico = local && local.ico;
  if (local && local.logo) {
    return '<img src="' + esc(local.logo) + '" alt="">';
  }
  if (ico && /^https?:\/\//.test(ico)) {
    return '<img src="' + esc(ico) + '" alt="">';
  }
  return esc(iniciales((local && local.nombre) || 'Tienda'));
}

function deRemoto(p) {
  return {
    codigo: String(p.codigo || ''),
    fecha: new Date(p.creado).getTime() || Date.now(),
    estado: String(p.estado || 'nuevo'),
    subtotal: Number(p.subtotal) || 0,
    envio: Number(p.envio) || 0,
    total: Number(p.total) || 0,
    ahorro: Number(p.ahorro) || 0,
    entrega: p.entrega || 'retiro',
    direccion: p.direccion || '',
    comuna: p.comuna_entrega || '',
    referencia: p.referencia_entrega || '',
    nota: p.nota || '',
    items: Array.isArray(p.items) ? p.items : [],
    seguimiento: p.seguimiento || '',
    resenado: Boolean(p.resenado),
    local: {
      id: p.local_id || '',
      nombre: p.local_nombre || 'Tienda',
      ico: p.local_ico || 'tienda',
      abierto: p.local_abierto !== false,
    },
    soloLocal: false,
  };
}

function deLocal(p) {
  return {
    codigo: String(p.codigo || ''),
    fecha: Number(p.fecha) || Date.now(),
    estado: String(p.estado || 'nuevo'),
    subtotal: Number(p.subtotal) || 0,
    envio: Number(p.envio) || 0,
    total: Number(p.total) || 0,
    ahorro: 0,
    entrega: p.entrega || 'retiro',
    direccion: p.direccion || '',
    comuna: p.comuna || '',
    referencia: p.referencia || '',
    nota: '',
    items: Array.isArray(p.items) ? p.items : [],
    seguimiento: p.token || p.seguimiento || '',
    resenado: false,
    local: {
      id: String(p.local && p.local.id || ''),
      nombre: String(p.local && p.local.nombre || 'Tienda'),
      ico: 'tienda',
      abierto: true,
    },
    soloLocal: true,
  };
}

function filtrados() {
  const q = estadoPagina.q.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return estadoPagina.pedidos.filter((p) => {
    if (estadoPagina.filtro === 'curso' && !['nuevo', 'visto', 'listo'].includes(p.estado)) return false;
    if (estadoPagina.filtro === 'entregado' && p.estado !== 'entregado') return false;
    if (estadoPagina.filtro === 'cancelado' && p.estado !== 'cancelado') return false;
    if (!q) return true;
    const texto = (p.codigo + ' ' + (p.local.nombre || '')).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return texto.includes(q);
  });
}

function mesDe(ts) {
  const t = new Date(ts).toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function fila(p) {
  const e = ESTADOS[p.estado] || ESTADOS.nuevo;
  return '<button class="pedido-fila" type="button" data-codigo="' + esc(p.codigo) + '"' +
      (p.codigo === estadoPagina.sel ? ' aria-current="true"' : '') + '>' +
    '<span class="pedido-fila__logo">' + logo(p.local) + '</span>' +
    '<span class="pedido-fila__cuerpo">' +
      '<b class="pedido-fila__codigo">' + esc(p.codigo || 'Sin código') + '</b>' +
      '<span class="pedido-fila__local">' + esc(p.local.nombre || 'Tienda') + '</span>' +
      '<small class="pedido-fila__meta">' + esc(fechaHora(p.fecha)) +
        (p.soloLocal ? ' · sólo en este teléfono' : '') + '</small>' +
    '</span>' +
    '<span class="pedido-fila__der">' +
      '<span class="pill ' + e.pill + '">' + e.t + '</span>' +
      '<b class="pedido-fila__total">' + clp(p.total) + '</b>' +
    '</span>' +
  '</button>';
}

function listaHtml() {
  if (estadoPagina.cargando) {
    return '<div class="ds-skeleton" style="height:74px;border-radius:16px;margin-bottom:10px"></div>' +
      '<div class="ds-skeleton" style="height:74px;border-radius:16px;margin-bottom:10px"></div>' +
      '<div class="ds-skeleton" style="height:74px;border-radius:16px"></div>';
  }
  const lista = filtrados();
  if (!lista.length) {
    const hayHistorial = estadoPagina.pedidos.length > 0;
    return '<div class="ds-empty historial-vacio">' +
      '<div class="ds-empty__icon"><svg viewBox="0 0 24 24"><path d="M7 3h10l3 4v14H4V7l3-4Z"/><path d="M4 8h16M9 12h6M9 16h4"/></svg></div>' +
      '<div class="ds-empty__title">' + (hayHistorial ? 'Nada con ese filtro' : 'Todavía no hay pedidos') + '</div>' +
      '<p class="ds-empty__text">' + (hayHistorial
        ? 'Prueba con otro estado o borra la búsqueda.'
        : 'Cuando compres en una tienda del barrio, el pedido aparece acá con su estado y su enlace de seguimiento.') + '</p>' +
      (hayHistorial ? '' : '<a class="ds-btn ds-btn--sm" href="/panel/cliente/buscar/">Buscar una tienda</a>') +
    '</div>';
  }

  const grupos = [];
  for (const p of lista) {
    const clave = mesDe(p.fecha);
    let g = grupos[grupos.length - 1];
    if (!g || g.mes !== clave) { g = { mes: clave, pedidos: [] }; grupos.push(g); }
    g.pedidos.push(p);
  }
  return grupos.map((g) =>
    '<section class="historial-mes"><h2>' + esc(g.mes) + '</h2>' +
      g.pedidos.map(fila).join('') + '</section>'
  ).join('');
}

function dato(etiqueta, valor) {
  return '<div class="detalle-dato"><small>' + esc(etiqueta) + '</small><b>' + esc(valor) + '</b></div>';
}

function detalleHtml() {
  const p = estadoPagina.pedidos.find((x) => x.codigo === estadoPagina.sel);
  if (!p) {
    return '<div class="detalle-vacio ds-empty">' +
      '<div class="ds-empty__icon"><svg viewBox="0 0 24 24"><path d="M7 3h10l3 4v14H4V7l3-4Z"/><path d="M4 8h16M9 12h6M9 16h4"/></svg></div>' +
      '<div class="ds-empty__title">Elige un pedido</div>' +
      '<p class="ds-empty__text">A la izquierda están todos, ordenados por mes. Toca uno para ver sus productos, el total y el seguimiento.</p>' +
    '</div>';
  }
  const e = ESTADOS[p.estado] || ESTADOS.nuevo;
  const entrega = p.entrega === 'delivery'
    ? 'Delivery · ' + (p.direccion || 'sin dirección') + (p.comuna ? ', ' + p.comuna : '')
    : 'Retiro en la tienda';
  const items = p.items.map((it) =>
    '<div class="detalle-item">' +
      '<span class="detalle-item__cant">' + (Number(it.cantidad) || 1) + '×</span>' +
      '<span class="detalle-item__nombre">' + esc(it.nombre || 'Producto') + '</span>' +
      '<b>' + clp((Number(it.precio) || 0) * (Number(it.cantidad) || 1)) + '</b>' +
    '</div>'
  ).join('');

  const acciones = [];
  if (p.codigo) {
    acciones.push('<a class="ds-btn ds-btn--lg" href="' + esc(enlaceSeguimiento({
      token: p.seguimiento,
      codigo: p.codigo,
      cliente: { telefono: '' },
    })) + '">Ver seguimiento</a>');
  }
  if (p.local.id) {
    acciones.push('<button class="ds-btn ds-btn--secondary" type="button" data-repetir="' + esc(p.codigo) + '">Volver a pedir</button>');
  }
  if (p.estado === 'entregado') {
    acciones.push(p.resenado
      ? '<a class="ds-btn ds-btn--ghost" href="/panel/cliente/resenas/">Ver mi reseña</a>'
      : '<a class="ds-btn ds-btn--ghost" href="/panel/cliente/resenas/">Calificar este pedido</a>');
  }

  return '<button class="detalle-volver" type="button" data-volver>← Volver a la lista</button>' +
    '<div class="detalle-cabeza">' +
      '<span class="detalle-cabeza__logo">' + logo(p.local) + '</span>' +
      '<div class="detalle-cabeza__cuerpo">' +
        '<b class="detalle-cabeza__tienda">' + esc(p.local.nombre || 'Tienda') + '</b>' +
        '<span class="detalle-cabeza__codigo">' + esc(p.codigo || 'Sin código') + '</span>' +
        '<span class="detalle-cabeza__fecha">' + esc(fechaHora(p.fecha)) + '</span>' +
      '</div>' +
      '<span class="detalle-cabeza__estado pill ' + e.pill + '">' + e.t + '</span>' +
    '</div>' +
    '<div class="detalle-cuerpo">' +
      '<div class="detalle-datos">' +
        dato('Entrega', entrega) +
        dato('Productos', String(p.items.reduce((a, it) => a + (Number(it.cantidad) || 1), 0))) +
        (p.referencia ? dato('Referencia', p.referencia) : '') +
        (p.nota ? dato('Nota', p.nota) : '') +
      '</div>' +
      '<div class="detalle-items">' + (items || '<p class="ds-empty__text">Sin detalle de productos.</p>') + '</div>' +
      '<div class="detalle-totales">' +
        '<div><span>Subtotal</span><b>' + clp(p.subtotal) + '</b></div>' +
        (p.ahorro > 0 ? '<div><span>Ahorro</span><b>−' + clp(p.ahorro) + '</b></div>' : '') +
        '<div><span>Envío</span><b>' + (p.envio ? clp(p.envio) : 'retiro') + '</b></div>' +
        '<div class="detalle-total"><span>Total</span><b>' + clp(p.total) + '</b></div>' +
      '</div>' +
    '</div>' +
    '<div class="detalle-acciones">' + acciones.join('') + '</div>' +
    (p.soloLocal
      ? '<p class="detalle-nota">Este pedido se hizo sin cuenta: vive en este teléfono. Guárdalo con su enlace o entra antes de comprar para verlo en todos tus dispositivos.</p>'
      : '<p class="detalle-nota">El estado lo actualiza la tienda. El seguimiento se abre con el enlace de este pedido, sin necesidad de contraseña.</p>');
}

function pintar() {
  const lista = $('[data-lista]');
  const detalle = $('.pedido-detalle');
  if (lista) lista.innerHTML = listaHtml();
  if (detalle) detalle.innerHTML = detalleHtml();
  document.body.dataset.detalle = estadoPagina.abierto ? '1' : '0';
}

async function cargar() {
  estadoPagina.cargando = true;
  estadoPagina.error = '';
  pintar();

  const locales = leerPedidos().map(deLocal);
  let remotos = [];
  let remoto = false;
  let falloRed = false;

  if (activa()) {
    try {
      const d = await mercadoPost('mis_pedidos', {}, {
        token: token(), dispositivo: dispositivo(),
      });
      remotos = (Array.isArray(d.pedidos) ? d.pedidos : []).map(deRemoto);
      remoto = true;
    } catch (e) {
      // 401 = la sesión venció: se sigue con el historial local, sin drama.
      if (!e || (e.status !== 401 && e.codigo !== 'SIN_RED')) {
        estadoPagina.error = mensajeDeError(e);
      }
      falloRed = !e || e.codigo === 'SIN_RED';
    }
  }

  const vistos = new Set(remotos.map((p) => p.codigo));
  const soloLocal = locales.filter((p) => !vistos.has(p.codigo));
  estadoPagina.pedidos = remotos.concat(soloLocal).sort((a, b) => b.fecha - a.fecha);
  estadoPagina.remoto = remoto;
  estadoPagina.cargando = false;

  if (estadoPagina.sel && !estadoPagina.pedidos.some((p) => p.codigo === estadoPagina.sel)) {
    estadoPagina.sel = '';
    estadoPagina.abierto = false;
  }
  // En escritorio se abre el más reciente; en móvil se respeta la lista y el
  // detalle sólo aparece cuando el comprador toca un pedido.
  if (!estadoPagina.sel && estadoPagina.pedidos.length &&
      window.matchMedia('(min-width: 901px)').matches) {
    estadoPagina.sel = estadoPagina.pedidos[0].codigo;
  }

  if (falloRed) {
    aviso('No pudimos conectar con la nube: estás viendo el historial guardado en este teléfono. ' +
      'Cuando vuelva la conexión, se completa con tu cuenta.', 'warn');
  } else if (!activa()) {
    aviso('Estás viendo el historial de este teléfono. ' +
      '<a href="/panel/cliente/cuenta/">Entra a tu cuenta</a> para verlo también en otros dispositivos.', 'acento');
  } else if (estadoPagina.error) {
    aviso(esc(estadoPagina.error), 'err');
  } else {
    aviso('');
  }
  pintar();
}

function nombreClave(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

async function repetir(codigo) {
  const p = estadoPagina.pedidos.find((x) => x.codigo === codigo);
  if (!p || !p.local.id) return;
  aviso('');
  try {
    const d = await mercado('local_ver', { id: p.local.id });
    const t = d.tienda;
    if (!t) throw new Error('La tienda ya no está publicada.');
    if (t.abierto === false) throw new Error('La tienda está cerrada ahora: vuelve cuando abra.');
    const catalogo = productosDe(t);
    let puestos = 0;
    let faltan = 0;
    for (const it of p.items) {
      const prod = buscarEnTienda(t, it.sku || '') ||
        catalogo.find((x) => nombreClave(x.nombre) === nombreClave(it.nombre));
      if (!prod) { faltan++; continue; }
      try {
        agregar(t, prod, Math.max(1, Number(it.cantidad) || 1));
        puestos++;
      } catch (_) { faltan++; }
    }
    if (!puestos) throw new Error('Ninguno de esos productos sigue disponible en la tienda.');
    aviso('Agregamos ' + puestos + ' producto' + (puestos === 1 ? '' : 's') + ' al carrito' +
      (faltan ? ' (' + faltan + ' ya no está' + (faltan === 1 ? '' : 'n') + ')' : '') +
      '. Revisa el precio de hoy antes de confirmar.', faltan ? 'warn' : 'ok');
    setTimeout(() => { location.href = '/panel/cliente/carrito/'; }, 900);
  } catch (e) {
    aviso(esc(e && e.message ? e.message : mensajeDeError(e)), 'err');
  }
}

document.addEventListener('click', (e) => {
  const filaBtn = e.target.closest('[data-codigo]');
  if (filaBtn) {
    estadoPagina.sel = filaBtn.dataset.codigo;
    estadoPagina.abierto = !window.matchMedia('(min-width: 901px)').matches;
    pintar();
    if (estadoPagina.abierto) window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  if (e.target.closest('[data-volver]')) {
    estadoPagina.sel = '';
    estadoPagina.abierto = false;
    pintar();
    return;
  }
  const rep = e.target.closest('[data-repetir]');
  if (rep) { repetir(rep.dataset.repetir); return; }

  const chip = e.target.closest('[data-filtro]');
  if (chip) {
    estadoPagina.filtro = chip.dataset.filtro;
    document.querySelectorAll('[data-filtro]').forEach((b) => {
      b.classList.toggle('is-active', b === chip);
      b.setAttribute('aria-pressed', b === chip ? 'true' : 'false');
    });
    pintar();
  }
});

document.addEventListener('input', (e) => {
  if (!e.target.matches('[data-q]')) return;
  estadoPagina.q = e.target.value;
  pintar();
});

alCambiar(cargar);
cargar();
