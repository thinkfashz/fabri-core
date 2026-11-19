/* C12 · Reseñas
   Arriba, los pedidos entregados que todavía no tienen opinión; abajo, el
   historial. Calificar siempre exige la prueba de compra (token del pedido o
   código + últimos 4 del teléfono), la misma del seguimiento. Con cuenta, la
   reseña queda ligada al historial (`resenas_mias`); sin cuenta, se guarda en
   este teléfono y se puede publicar igual. */

import { mercadoPost, mensajeDeError } from '../../comun/api.js';
import { leerPedidos, enlaceSeguimiento } from '../../comun/pedidos.js';
import { activa, alCambiar, token, dispositivo } from '../../comun/sesion.js';
import { clp, fechaHora, esc, iniciales } from '../../comun/formato.js';

const $ = (sel) => document.querySelector(sel);
const K_RESENAS = 'fcore.panel.resenas';
const ETIQUETAS = ['', 'Muy malo', 'Malo', 'Regular', 'Bueno', 'Excelente'];

const estado = {
  pendientes: [],
  resenas: [],
  cargando: true,
  nube: false,
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

function leerLocales() {
  try {
    const d = JSON.parse(localStorage.getItem(K_RESENAS) || '[]');
    return Array.isArray(d) ? d : [];
  } catch (_) { return []; }
}

function guardarLocal(r) {
  const lista = leerLocales().filter((x) => x.codigo !== r.codigo);
  lista.unshift(r);
  try { localStorage.setItem(K_RESENAS, JSON.stringify(lista.slice(0, 200))); } catch (_) { /* sin espacio */ }
}

function firma(r) {
  return String(r.local_id || '') + '|' + Number(r.estrellas || 0) + '|' +
    String(r.texto || '').trim().toLowerCase();
}

function deNube(r) {
  return {
    id: r.id,
    local_id: r.local_id || '',
    local_nombre: r.local_nombre || 'Tienda',
    ico: r.local_ico || 'tienda',
    estrellas: Number(r.estrellas) || 0,
    texto: r.texto || '',
    creado: new Date(r.creado).getTime() || 0,
    nube: true,
  };
}

function deLocal(r) {
  return {
    id: r.id || ('local-' + r.codigo),
    local_id: r.local_id || '',
    local_nombre: r.local_nombre || 'Tienda',
    ico: r.ico || 'tienda',
    estrellas: Number(r.estrellas) || 0,
    texto: r.texto || '',
    creado: Number(r.fecha) || 0,
    nube: false,
  };
}

function pendienteNube(p) {
  return {
    codigo: p.codigo || '',
    seguimiento: p.seguimiento || '',
    local_id: p.local_id || '',
    local_nombre: p.local_nombre || 'Tienda',
    ico: p.local_ico || 'tienda',
    total: Number(p.total) || 0,
    items: Array.isArray(p.items) ? p.items : [],
    creado: new Date(p.creado).getTime() || 0,
    telefono: '',
    nube: true,
  };
}

function pendienteLocal(p) {
  return {
    codigo: p.codigo || '',
    seguimiento: p.token || p.seguimiento || '',
    local_id: String(p.local && p.local.id || ''),
    local_nombre: String(p.local && p.local.nombre || 'Tienda'),
    ico: 'tienda',
    total: Number(p.total) || 0,
    items: Array.isArray(p.items) ? p.items : [],
    creado: Number(p.fecha) || 0,
    telefono: String(p.cliente && p.cliente.telefono || ''),
    nube: false,
  };
}

function logo(x) {
  if (x && x.logo) return '<img src="' + esc(x.logo) + '" alt="">';
  return esc(iniciales((x && x.local_nombre) || (x && x.nombre) || 'Tienda'));
}

function estrellasHtml(n) {
  let s = '';
  for (let i = 1; i <= 5; i++) s += i <= n ? '★' : '☆';
  return s;
}

function pendienteHtml(p) {
  return '<article class="res-pendiente" data-pendiente data-codigo="' + esc(p.codigo) + '" data-estrellas="0">' +
    '<div class="res-pendiente__cabeza">' +
      '<span class="res-logo">' + logo(p) + '</span>' +
      '<div class="res-pendiente__id">' +
        '<b>' + esc(p.local_nombre) + '</b>' +
        '<small>Pedido ' + esc(p.codigo) + ' · ' + esc(fechaHora(p.creado)) + '</small>' +
      '</div>' +
      '<b class="res-pendiente__total">' + clp(p.total) + '</b>' +
    '</div>' +
    '<div class="res-estrellas" role="group" aria-label="Estrellas para ' + esc(p.local_nombre) + '">' +
      [1, 2, 3, 4, 5].map((n) =>
        '<button class="res-estrella" type="button" data-estrella="' + n + '" aria-pressed="false" ' +
        'aria-label="' + n + ' estrella' + (n === 1 ? '' : 's') + '">★</button>').join('') +
      '<span class="res-estrellas__texto" data-estrellas-texto>Elige 1 a 5</span>' +
    '</div>' +
    '<textarea class="res-texto" data-texto maxlength="500" placeholder="¿Cómo fue la atención y el producto? (opcional)"></textarea>' +
    '<div class="res-acciones">' +
      '<button class="ds-btn" type="button" data-enviar>Publicar reseña</button>' +
      '<a class="ds-btn ds-btn--ghost" href="' + esc(enlaceSeguimiento({
        token: p.seguimiento,
        codigo: p.codigo,
        cliente: { telefono: p.telefono || '' },
      })) + '">Ver el pedido</a>' +
    '</div>' +
  '</article>';
}

function resenaHtml(r) {
  return '<article class="res-item">' +
    '<span class="res-item__logo">' + logo(r) + '</span>' +
    '<div class="res-item__cuerpo">' +
      '<div class="res-item__cabeza">' +
        '<span class="res-item__local">' + esc(r.local_nombre) + '</span>' +
        (r.nube ? '' : '<span class="pill">sólo en este teléfono</span>') +
        '<span class="res-item__fecha">' + esc(fechaHora(r.creado)) + '</span>' +
      '</div>' +
      '<div class="res-item__estrellas" aria-label="' + r.estrellas + ' de 5 estrellas">' +
        estrellasHtml(r.estrellas) + '</div>' +
      (r.texto
        ? '<p class="res-item__texto">' + esc(r.texto) + '</p>'
        : '<p class="res-item__sin-texto">Sin comentario.</p>') +
    '</div>' +
  '</article>';
}

function pintar() {
  const np = $('[data-n-pendientes]');
  const nr = $('[data-n-resenas]');
  if (np) np.textContent = String(estado.pendientes.length);
  if (nr) nr.textContent = String(estado.resenas.length);

  const pend = $('[data-pendientes]');
  if (pend) {
    if (estado.cargando) {
      pend.innerHTML = '<div class="ds-skeleton" style="height:160px;border-radius:18px"></div>';
    } else if (!estado.pendientes.length) {
      pend.innerHTML = '<div class="ds-empty res-vacio">' +
        '<div class="ds-empty__icon"><svg viewBox="0 0 24 24"><path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.3l6.1-.7L12 3Z"/></svg></div>' +
        '<div class="ds-empty__title">No hay pedidos por calificar</div>' +
        '<p class="ds-empty__text">Cuando un pedido figure como entregado, aparecerá acá para que le pongas estrellas.</p>' +
        '<a class="ds-btn ds-btn--sm" href="/panel/cliente/pedidos/">Ver mis pedidos</a>' +
      '</div>';
    } else {
      pend.innerHTML = estado.pendientes.map(pendienteHtml).join('');
    }
  }

  const hist = $('[data-historial]');
  if (hist) {
    if (estado.cargando) {
      hist.innerHTML = '<div class="ds-skeleton" style="height:92px;border-radius:16px;margin-bottom:9px"></div>' +
        '<div class="ds-skeleton" style="height:92px;border-radius:16px"></div>';
    } else if (!estado.resenas.length) {
      hist.innerHTML = '<div class="ds-empty res-vacio">' +
        '<div class="ds-empty__icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 13h8M9 9h.01M15 9h.01"/></svg></div>' +
        '<div class="ds-empty__title">Todavía no has calificado un pedido</div>' +
        '<p class="ds-empty__text">Tu primera reseña ayuda a que otra persona del barrio compre mejor.</p>' +
      '</div>';
    } else {
      hist.innerHTML = '<div class="res-historial">' + estado.resenas.map(resenaHtml).join('') + '</div>';
    }
  }
}

async function cargar() {
  estado.cargando = true;
  estado.error = '';
  pintar();

  const locales = leerLocales();
  if (activa()) {
    try {
      const d = await mercadoPost('resenas_mias', {}, {
        token: token(), dispositivo: dispositivo(),
      });
      const resenas = (Array.isArray(d.resenas) ? d.resenas : []).map(deNube);
      const firmas = new Set(resenas.map(firma));
      for (const r of locales) {
        if (!firmas.has(firma(r))) resenas.push(deLocal(r));
      }
      estado.resenas = resenas.sort((a, b) => b.creado - a.creado);
      estado.pendientes = (Array.isArray(d.pendientes) ? d.pendientes : []).map(pendienteNube);
      estado.nube = true;
    } catch (e) {
      if (!e || (e.status !== 401 && e.codigo !== 'SIN_RED')) estado.error = mensajeDeError(e);
      caerALocal(locales);
    }
  } else {
    caerALocal(locales);
  }

  estado.cargando = false;
  if (!activa()) {
    aviso('Tus reseñas quedan en este teléfono. <a href="/panel/cliente/cuenta/">Entra a tu cuenta</a> para que viajen con vos.', 'acento');
  } else if (!estado.nube) {
    aviso('No pudimos leer la nube: estás viendo lo guardado en este teléfono.', 'warn');
  } else if (estado.error) {
    aviso(esc(estado.error), 'err');
  } else {
    aviso('');
  }
  pintar();
}

function caerALocal(locales) {
  const revisados = new Set(locales.map((r) => r.codigo));
  estado.resenas = locales.map(deLocal).sort((a, b) => b.creado - a.creado);
  estado.pendientes = leerPedidos()
    .filter((p) => p && p.codigo && p.estado === 'entregado' && !revisados.has(p.codigo))
    .map(pendienteLocal);
  estado.nube = false;
}

function tarjetaDe(nodo) {
  return nodo && nodo.closest ? nodo.closest('[data-pendiente]') : null;
}

async function enviar(boton) {
  const card = tarjetaDe(boton);
  if (!card) return;
  const codigo = card.dataset.codigo;
  const p = estado.pendientes.find((x) => x.codigo === codigo);
  if (!p) return;
  const estrellas = Number(card.dataset.estrellas) || 0;
  const texto = (card.querySelector('[data-texto]') && card.querySelector('[data-texto]').value || '').trim();
  if (!(estrellas >= 1 && estrellas <= 5)) {
    aviso('Elige de 1 a 5 estrellas antes de publicar.', 'err');
    return;
  }

  const cuerpo = { estrellas, texto };
  if (p.seguimiento) {
    cuerpo.token = p.seguimiento;
  } else {
    cuerpo.codigo = p.codigo;
    cuerpo.contacto = String(p.telefono || '').replace(/\D/g, '').slice(-4);
  }

  boton.disabled = true;
  boton.textContent = 'Publicando…';
  try {
    const opts = activa() ? { token: token(), dispositivo: dispositivo() } : {};
    await mercadoPost('resena_crear', cuerpo, opts);
    guardarLocal({
      codigo,
      local_id: p.local_id,
      local_nombre: p.local_nombre,
      ico: p.ico,
      estrellas,
      texto,
      fecha: Date.now(),
    });
    estado.pendientes = estado.pendientes.filter((x) => x.codigo !== codigo);
    estado.resenas.unshift(deLocal({
      codigo, local_id: p.local_id, local_nombre: p.local_nombre,
      ico: p.ico, estrellas, texto, fecha: Date.now(),
    }));
    pintar();
    aviso('Reseña publicada. Gracias por ayudar al barrio.', 'ok');
  } catch (e) {
    boton.disabled = false;
    boton.textContent = 'Publicar reseña';
    if (e && e.codigo === 'YA_OPINO') {
      estado.pendientes = estado.pendientes.filter((x) => x.codigo !== codigo);
      pintar();
      aviso('Ese pedido ya tenía una reseña: no se publicó otra.', 'warn');
    } else if (e && e.codigo === 'NO_ENTREGADO') {
      aviso('El local todavía no marcó ese pedido como entregado. Inténtalo cuando llegue.', 'warn');
    } else if (e && e.codigo === 'BLOQUEADO') {
      aviso('Demasiadas reseñas seguidas desde esta conexión: espera unos minutos.', 'warn');
    } else {
      aviso(esc(mensajeDeError(e)), 'err');
    }
  }
}

document.addEventListener('click', (e) => {
  const estrella = e.target.closest('[data-estrella]');
  if (estrella) {
    const card = tarjetaDe(estrella);
    if (!card) return;
    const n = Number(estrella.dataset.estrella) || 0;
    card.dataset.estrellas = String(n);
    card.querySelectorAll('[data-estrella]').forEach((b) => {
      b.setAttribute('aria-pressed', Number(b.dataset.estrella) <= n ? 'true' : 'false');
    });
    const txt = card.querySelector('[data-estrellas-texto]');
    if (txt) txt.textContent = ETIQUETAS[n] || 'Elige 1 a 5';
    return;
  }
  const enviarBtn = e.target.closest('[data-enviar]');
  if (enviarBtn && !enviarBtn.disabled) enviar(enviarBtn);
});

alCambiar(cargar);
cargar();
