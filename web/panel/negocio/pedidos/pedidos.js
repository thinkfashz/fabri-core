/* N02 · Pedidos
   La cola real del negocio: cuatro columnas por estado, detalle dentro de la
   tarjeta y acciones que mueven el pedido en la nube. El código de entrega se
   pide cuando el pedido lo exige; sin él, el servidor rechaza la entrega. */

import { arrancar, llamar, estadoDe } from '../../comun/negocio.js';
import { clp, esc, telefonoVisible } from '../../comun/formato.js';

const $ = (sel, raiz) => (raiz || document).querySelector(sel);
const $$ = (sel, raiz) => Array.from((raiz || document).querySelectorAll(sel));

const COLUMNAS = [
  { clave: 'nuevo', t: 'Nuevos' },
  { clave: 'visto', t: 'En preparación' },
  { clave: 'listo', t: 'Listos' },
  { clave: 'entregado', t: 'Entregados' },
];

const estado = {
  ctx: null,
  pedidos: [],
  filtro: 'abiertos',
  q: '',
  abierto: '',
  cargando: false,
  error: '',
  aviso: '',
  push: { soportado: false, activo: false, error: '' },
  reloj: null,
};

function hace(ts) {
  const ms = Date.now() - new Date(ts).getTime();
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 1) return 'recién';
  if (min < 60) return 'hace ' + min + ' min';
  const h = Math.round(min / 60);
  if (h < 24) return 'hace ' + h + ' h';
  return 'hace ' + Math.round(h / 24) + ' d';
}

function aviso(html, tipo) {
  estado.aviso = html
    ? '<div class="aviso ' + (tipo === 'err' ? 'aviso--err' : tipo === 'warn' ? 'aviso--warn' : 'aviso--ok') + '">' + html + '</div>'
    : '';
}

function filtrados() {
  const q = estado.q.trim().toLowerCase();
  return estado.pedidos.filter((p) => {
    if (estado.filtro === 'abiertos' && (p.estado === 'entregado' || p.estado === 'cancelado')) return false;
    if (estado.filtro === 'cancelados' && p.estado !== 'cancelado') return false;
    if (estado.filtro === 'todos') return coincide(p, q);
    if (['nuevo', 'visto', 'listo', 'entregado'].includes(estado.filtro)) {
      if (p.estado !== estado.filtro) return false;
    }
    return coincide(p, q);
  });
}

function coincide(p, q) {
  if (!q) return true;
  const texto = [p.codigo, p.cliente, p.telefono, p.direccion].join(' ').toLowerCase();
  return texto.indexOf(q) >= 0;
}

function tarjeta(p) {
  const e = estadoDe(p.estado);
  const abierta = estado.abierto === p.id;
  const items = Array.isArray(p.items) ? p.items : [];
  const unidades = items.reduce((s, it) => s + (Number(it.cantidad) || 0), 0);
  const entrega = p.entrega === 'delivery' ? 'Delivery' : 'Retiro';
  const clave = p.requiere_clave ? ' · con código' : '';
  const acciones = [];
  if (p.estado === 'nuevo') acciones.push('<button class="ds-btn ds-btn--primary ds-btn--sm" type="button" data-accion="visto" data-id="' + esc(p.id) + '">Empezar</button>');
  if (p.estado === 'visto') acciones.push('<button class="ds-btn ds-btn--primary ds-btn--sm" type="button" data-accion="listo" data-id="' + esc(p.id) + '">Marcar listo</button>');
  if (p.estado === 'listo') acciones.push('<button class="ds-btn ds-btn--primary ds-btn--sm" type="button" data-accion="entregado" data-id="' + esc(p.id) + '">Entregar</button>');
  if (p.estado === 'entregado' && p.telefono) {
    acciones.push('<a class="ds-btn ds-btn--ghost ds-btn--sm" target="_blank" rel="noopener" href="https://wa.me/' +
      esc(String(p.telefono).replace(/\D/g, '')) + '">Avisar</a>');
  }
  if (p.estado !== 'entregado' && p.estado !== 'cancelado') {
    acciones.push('<button class="ds-btn ds-btn--ghost ds-btn--sm" type="button" data-accion="cancelado" data-id="' + esc(p.id) + '">Cancelar</button>');
  }

  const detalle = abierta
    ? '<div class="ped-detalle">' +
        '<div class="ped-detalle__bloque"><span class="ped-detalle__rotulo">Productos</span>' +
          '<ul class="ped-detalle__items">' + items.map((it) =>
            '<li><span>' + esc(it.cantidad) + '× ' + esc(it.nombre) + '</span><b>' + clp(it.precio) + '</b></li>'
          ).join('') + '</ul>' +
        '</div>' +
        '<div class="ped-detalle__bloque"><span class="ped-detalle__rotulo">Contacto</span>' +
          '<p>' + esc(p.cliente || 'Cliente') + '</p>' +
          '<p class="ped-detalle__tenue">' + esc(telefonoVisible(p.telefono) || 'Sin teléfono') + '</p>' +
          (p.entrega === 'delivery'
            ? '<p class="ped-detalle__tenue">' + esc([p.direccion, p.comuna_entrega, p.referencia_entrega].filter(Boolean).join(' · ')) + '</p>'
            : '<p class="ped-detalle__tenue">Retiro en el local</p>') +
        '</div>' +
        (p.nota ? '<div class="ped-detalle__bloque"><span class="ped-detalle__rotulo">Nota</span><p>' + esc(p.nota) + '</p></div>' : '') +
        '<div class="ped-detalle__bloque"><span class="ped-detalle__rotulo">Historial</span>' +
          '<ul class="ped-detalle__eventos">' + (Array.isArray(p.eventos) && p.eventos.length
            ? p.eventos.map((ev) => '<li><b>' + esc(estadoDe(ev.estado).t) + '</b> · ' +
              esc(new Date(ev.creado || ev.fecha || ev.creado_en || 0).toLocaleString('es-CL')) + '</li>').join('')
            : '<li class="ped-detalle__tenue">Sin eventos registrados.</li>') + '</ul>' +
        '</div>' +
      '</div>'
    : '';

  return '<article class="ped-card" data-tarjeta="' + esc(p.id) + '">' +
    '<header class="ped-card__cabeza">' +
      '<span class="ped-card__codigo">' + esc(p.codigo || '—') + '</span>' +
      '<span class="pill ' + e.pill + '">' + esc(e.t) + '</span>' +
      '<span class="ped-card__hora">' + hace(p.creado) + '</span>' +
    '</header>' +
    '<div class="ped-card__quien"><b>' + esc(p.cliente || 'Cliente') + '</b>' +
      '<span>' + unidades + ' u · ' + esc(entrega) + esc(clave) + '</span></div>' +
    '<div class="ped-card__total"><strong>' + clp(p.total) + '</strong>' +
      '<span>' + esc(p.metodo_pago || 'efectivo') + '</span></div>' +
    '<div class="ped-card__acciones">' + acciones.join('') +
      '<button class="ped-card__ver" type="button" data-detalle="' + esc(p.id) + '" aria-expanded="' + (abierta ? 'true' : 'false') + '">' +
        (abierta ? 'Ocultar detalle' : 'Ver detalle') + '</button>' +
    '</div>' +
    detalle +
  '</article>';
}

function columna(clave) {
  const lista = filtrados().filter((p) => p.estado === clave);
  const titulo = COLUMNAS.find((c) => c.clave === clave);
  return '<section class="ped-columna" data-col="' + clave + '">' +
    '<header class="ped-columna__cabeza"><h2>' + esc(titulo ? titulo.t : clave) + '</h2>' +
      '<span class="ped-columna__n">' + lista.length + '</span></header>' +
    '<div class="ped-columna__cuerpo">' +
      (lista.length ? lista.map(tarjeta).join('') : '<div class="ped-vacio">Nada por acá.</div>') +
    '</div></section>';
}

function pantalla(ctx) {
  const abiertos = estado.pedidos.filter((p) => p.estado !== 'entregado' && p.estado !== 'cancelado').length;
  const cancelados = estado.pedidos.filter((p) => p.estado === 'cancelado');
  const filtros = [
    ['abiertos', 'Abiertos'], ['todos', 'Todos'], ['nuevo', 'Nuevos'],
    ['visto', 'Preparando'], ['listo', 'Listos'], ['entregado', 'Entregados'],
    ['cancelados', 'Cancelados'],
  ];
  return '<header class="neg-cabeza">' +
      '<div><span class="neg-cabeza__kicker">' + esc(ctx.tienda.nombre) + '</span>' +
        '<h1>Pedidos</h1>' +
        '<p>' + abiertos + ' por atender. Cada acción se guarda en la nube y el comprador ve el cambio.</p></div>' +
      '<div class="neg-cabeza__acciones">' +
        '<button class="ds-btn ds-btn--secondary ds-btn--sm" type="button" data-actualizar>Actualizar</button>' +
        '<button class="ds-btn ds-btn--ghost ds-btn--sm" type="button" data-push>' +
          (estado.push.activo ? 'Avisos activos' : 'Activar avisos') + '</button>' +
      '</div>' +
    '</header>' +
    '<div class="neg-aviso" data-aviso aria-live="polite">' + estado.aviso + '</div>' +
    '<div class="ped-barra">' +
      '<div class="neg-seg" role="tablist" aria-label="Filtrar pedidos">' +
        filtros.map(([k, t]) => '<button type="button" role="tab" data-filtro="' + k + '" aria-selected="' +
          (estado.filtro === k ? 'true' : 'false') + '">' + t + '</button>').join('') +
      '</div>' +
      '<label class="ped-buscar"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
        '<input type="search" data-q value="' + esc(estado.q) + '" placeholder="Código, cliente o dirección" aria-label="Buscar pedido"></label>' +
    '</div>' +
    (estado.push.error ? '<div class="aviso aviso--warn">' + esc(estado.push.error) + '</div>' : '') +
    '<div class="ped-kanban">' + COLUMNAS.map((c) => columna(c.clave)).join('') + '</div>' +
    (cancelados.length && estado.filtro !== 'abiertos'
      ? '<section class="ped-cancelados"><h2>Cancelados</h2>' +
        '<div class="ped-cancelados__lista">' + cancelados.map(tarjeta).join('') + '</div></section>'
      : '');
}

function pintar(caja, ctx) {
  caja.innerHTML = pantalla(ctx);
  $$('[data-filtro]', caja).forEach((b) => b.addEventListener('click', () => {
    estado.filtro = b.dataset.filtro;
    pintar(caja, ctx);
  }));
  const buscador = $('[data-q]', caja);
  if (buscador) {
    let reloj = null;
    buscador.addEventListener('input', () => {
      clearTimeout(reloj);
      reloj = setTimeout(() => {
        estado.q = buscador.value;
        const foco = document.activeElement === buscador;
        pintar(caja, ctx);
        if (foco) {
          const nuevo = $('[data-q]', caja);
          if (nuevo) { nuevo.focus(); nuevo.setSelectionRange(nuevo.value.length, nuevo.value.length); }
        }
      }, 220);
    });
  }
  const act = $('[data-actualizar]', caja);
  if (act) act.addEventListener('click', () => cargar(caja, ctx, true));
  const push = $('[data-push]', caja);
  if (push) push.addEventListener('click', () => activarAvisos(caja, ctx));
  $$('[data-detalle]', caja).forEach((b) => b.addEventListener('click', () => {
    estado.abierto = estado.abierto === b.dataset.detalle ? '' : b.dataset.detalle;
    pintar(caja, ctx);
  }));
  $$('[data-accion]', caja).forEach((b) => b.addEventListener('click', () => mover(caja, ctx, b.dataset.id, b.dataset.accion)));
}

async function mover(caja, ctx, id, nuevo) {
  const p = estado.pedidos.find((x) => x.id === id);
  if (!p) return;
  let clave = '';
  if (nuevo === 'entregado' && p.requiere_clave) {
    clave = window.prompt('Código de entrega de 4 dígitos que dio el comprador:');
    if (clave == null) return;
    clave = String(clave).replace(/\D/g, '').slice(0, 4);
    if (clave.length !== 4) { aviso('El código de entrega tiene 4 dígitos.', 'warn'); pintar(caja, ctx); return; }
  }
  if (nuevo === 'cancelado' && !window.confirm('¿Cancelar el pedido ' + (p.codigo || '') + '? No se puede deshacer.')) return;
  try {
    await llamar('pedido_estado', {
      local_id: ctx.tienda.id, pedido_id: id, estado: nuevo,
      ...(clave ? { clave_entrega: clave } : {}),
    });
    aviso('', '');
    estado.abierto = '';
    await cargar(caja, ctx, false);
  } catch (e) {
    aviso(esc(e && e.message ? e.message : 'No se pudo mover el pedido.'), 'err');
    pintar(caja, ctx);
  }
}

function claveToUint8(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function activarAvisos(caja, ctx) {
  if (estado.push.activo) {
    aviso('Los avisos ya están activos en este dispositivo.', 'ok');
    pintar(caja, ctx);
    return;
  }
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    estado.push.error = 'Este navegador no soporta avisos push.';
    pintar(caja, ctx);
    return;
  }
  try {
    const cfg = await llamar('ventas_serie', { local_id: ctx.tienda.id, dias: 1 });
    if (!cfg.push || !cfg.push.disponible || !cfg.push.clave) {
      estado.push.error = 'El servidor no tiene las claves de avisos configuradas.';
      pintar(caja, ctx);
      return;
    }
    const permiso = await Notification.requestPermission();
    if (permiso !== 'granted') {
      estado.push.error = 'Diste permiso de avisos sólo si aceptas la notificación del navegador.';
      pintar(caja, ctx);
      return;
    }
    const reg = await navigator.serviceWorker.register('/sw-push.js');
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: claveToUint8(cfg.push.clave),
    });
    await llamar('push_local_suscribir', { local_id: ctx.tienda.id, suscripcion: sub.toJSON() });
    estado.push.activo = true;
    estado.push.error = '';
    aviso('Avisos activados. Este dispositivo recibirá los pedidos nuevos.', 'ok');
    pintar(caja, ctx);
  } catch (e) {
    estado.push.error = e && e.message ? e.message : 'No se pudieron activar los avisos.';
    pintar(caja, ctx);
  }
}

async function cargar(caja, ctx, mostrarCarga) {
  if (estado.cargando) return;
  estado.cargando = true;
  if (mostrarCarga) {
    caja.innerHTML = '<div class="ped-esqueleto" aria-live="polite">' +
      '<div class="ds-skeleton" style="height:28px;width:220px;margin-bottom:14px"></div>' +
      '<div class="ds-skeleton" style="height:300px"></div></div>';
  }
  try {
    const d = await llamar('pedidos_listar', { local_id: ctx.tienda.id, limite: 100 });
    estado.pedidos = Array.isArray(d.pedidos) ? d.pedidos : [];
    estado.error = '';
    if (mostrarCarga) aviso('', '');
  } catch (e) {
    estado.error = e && e.message ? e.message : 'No se pudo leer la cola.';
    if (mostrarCarga) {
      caja.innerHTML = '<div class="neg-estado" role="alert"><h2>No pudimos leer los pedidos</h2>' +
        '<p>' + esc(estado.error) + '</p>' +
        '<div class="neg-estado__acciones"><button class="ds-btn ds-btn--primary ds-btn--sm" type="button" data-reintentar>Reintentar</button></div></div>';
      const b = $('[data-reintentar]', caja);
      if (b) b.addEventListener('click', () => cargar(caja, ctx, true));
      estado.cargando = false;
      return;
    }
  }
  estado.cargando = false;
  pintar(caja, ctx);
}

arrancar({
  alListo: (ctx) => {
    estado.ctx = ctx;
    const caja = $('[data-negocio]');
    if (!caja) return;
    cargar(caja, ctx, true);
    if (estado.reloj) clearInterval(estado.reloj);
    estado.reloj = setInterval(() => {
      if (document.visibilityState === 'visible' && !estado.cargando) cargar(caja, ctx, false);
    }, 60000);
  },
});
