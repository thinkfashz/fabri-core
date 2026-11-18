/* C08 · Pedido
   El seguimiento es público: se abre con el token del pedido o con el código
   más los últimos 4 dígitos del teléfono. Nunca se muestra el teléfono
   completo ni el token. Si la red falla, se muestra el último estado guardado
   y se dice que está sin conexión. */

import { mercadoPost, mensajeDeError } from '../../comun/api.js';
import { clp, fechaHora, hora, esc, iniciales, whatsapp, telefonoVisible } from '../../comun/formato.js';
import { leerPedidos } from '../../comun/pedidos.js';

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);
const K_AVISOS = 'fcore.panel.avisos';
const K_ULTIMO = 'fcore.panel.pedido.ultimo';

const ETAPAS = [
  { k: 'nuevo', t: 'Pedido recibido', d: 'El local ya tiene tu pedido.' },
  { k: 'visto', t: 'En preparación', d: 'El local lo vio y está armando tu compra.' },
  { k: 'listo', t: 'Listo', d: 'Puedes retirarlo o esperar el delivery.' },
  { k: 'entregado', t: 'Entregado', d: 'Pedido cerrado. ¡Gracias por comprar en el barrio!' },
];

const estado = {
  cred: null,
  pedido: null,
  sinRed: false,
  reloj: null,
  avisos: false,
};

function credencial() {
  const token = params.get('token') || params.get('seguimiento') || '';
  if (token) return { token };
  const codigo = params.get('codigo') || '';
  const contacto = params.get('contacto') || '';
  if (codigo) return { codigo, contacto };
  return null;
}

function claveCred(c) {
  if (!c) return '';
  if (c.token) return 't:' + c.token;
  return 'c:' + String(c.codigo || '').toUpperCase() + ':' + String(c.contacto || '');
}

function aviso(html, tipo) {
  const caja = $('[data-aviso]');
  if (!caja) return;
  caja.innerHTML = html
    ? '<div class="aviso aviso--' + (tipo || 'warn') + '"><svg viewBox="0 0 24 24">' +
      '<path d="M12 9v4M12 17h.01"/><path d="M10.3 4.2 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/></svg>' +
      '<span>' + html + '</span></div>'
    : '';
}

/* ── avisos push (mismo service worker que la PWA) ───────────────────── */

function soportaAvisos() {
  return typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function claveToUint8(b64) {
  const s = String(b64 || '').replace(/-/g, '+').replace(/_/g, '/');
  let relleno = s;
  while (relleno.length % 4) relleno += '=';
  const raw = atob(relleno);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function avisosActivos(cred) {
  try {
    const d = JSON.parse(localStorage.getItem(K_AVISOS) || '{}') || {};
    return d[claveCred(cred)] || '';
  } catch (_) { return ''; }
}

function guardarAviso(cred, endpoint) {
  try {
    const d = JSON.parse(localStorage.getItem(K_AVISOS) || '{}') || {};
    d[claveCred(cred)] = endpoint;
    localStorage.setItem(K_AVISOS, JSON.stringify(d));
  } catch (_) { /* modo privado */ }
}

function borrarAviso(cred) {
  try {
    const d = JSON.parse(localStorage.getItem(K_AVISOS) || '{}') || {};
    delete d[claveCred(cred)];
    localStorage.setItem(K_AVISOS, JSON.stringify(d));
  } catch (_) { /* nada */ }
}

function cuerpoAviso(accion, suscripcion) {
  const c = estado.cred;
  const cuerpo = { accion };
  if (c.token) cuerpo.token = c.token;
  else { cuerpo.codigo = c.codigo; cuerpo.contacto = c.contacto; }
  if (suscripcion) cuerpo.suscripcion = suscripcion;
  return cuerpo;
}

function bloqueAvisos(p) {
  if (!p || !p.push || !p.push.disponible) return '';
  if (p.estado === 'entregado' || p.estado === 'cancelado') return '';
  if (!soportaAvisos()) return '';
  const activo = estado.avisos || Boolean(avisosActivos(estado.cred));
  return '<section class="bloque avisos" aria-labelledby="avisosTitulo">' +
    '<div class="bloque__cabeza"><h2 id="avisosTitulo">Avisarme cuando cambie</h2>' +
      (activo ? '<span class="pill pill--ok">activado</span>' : '') + '</div>' +
    '<div class="bloque__cuerpo">' +
      '<h3>' + (activo ? 'Te avisaremos en este teléfono' : 'Una notificación, sin abrir la página') + '</h3>' +
      '<p>' + (activo
        ? 'Cuando el local reciba, prepare o entregue tu pedido, llegará un aviso a este navegador.'
        : 'Actívalas y te avisamos cuando el local mueva tu pedido. El contenido va cifrado: el servicio de notificaciones no lo lee.') + '</p>' +
      (activo
        ? '<button class="avisos__quitar" type="button" data-quitar-avisos>Dejar de avisar</button>'
        : '<button class="ds-btn ds-btn--secondary" type="button" data-activar-avisos>Activar avisos</button>') +
      '<p class="avisos__error" data-error-avisos hidden></p>' +
    '</div></section>';
}

function errorAvisos(txt) {
  const el = $('[data-error-avisos]');
  if (!el) return;
  el.hidden = !txt;
  el.textContent = txt || '';
}

async function activarAvisos() {
  const btn = $('[data-activar-avisos]');
  if (btn) { btn.disabled = true; btn.textContent = 'Activando…'; }
  errorAvisos('');
  try {
    if (Notification.permission === 'denied') {
      throw new Error('permiso');
    }
    const permiso = Notification.permission === 'granted'
      ? 'granted' : await Notification.requestPermission();
    if (permiso !== 'granted') throw new Error('permiso');
    const reg = await navigator.serviceWorker.register('/sw-push.js');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: claveToUint8(estado.pedido.push.clave),
      });
    }
    const json = sub.toJSON ? sub.toJSON() : null;
    if (!json || !json.endpoint) throw new Error('suscripcion');
    await mercadoPost('push_suscribir',
      Object.assign(cuerpoAviso('push_suscribir'), { suscripcion: json }), { ms: 16000 });
    estado.avisos = true;
    guardarAviso(estado.cred, json.endpoint);
    pintar(false);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Activar avisos'; }
    if (e && e.message === 'permiso') {
      errorAvisos('El navegador tiene bloqueadas las notificaciones para este sitio. Actívalas en los ajustes y vuelve a intentar.');
    } else {
      errorAvisos('No pudimos activar los avisos en este navegador. Revisa los permisos del sitio.');
    }
  }
}

async function quitarAvisos() {
  const btn = $('[data-quitar-avisos]');
  if (btn) { btn.disabled = true; btn.textContent = 'Quitando…'; }
  const endpoint = avisosActivos(estado.cred);
  try {
    if (endpoint) await mercadoPost('push_baja', Object.assign(cuerpoAviso('push_baja'), { endpoint }), { ms: 12000 });
  } catch (_) { /* aunque falle la red, localmente se apaga */ }
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw-push.js');
    if (reg) {
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
    }
  } catch (_) { /* nada */ }
  borrarAviso(estado.cred);
  estado.avisos = false;
  pintar(false);
}

/* ── pintura ──────────────────────────────────────────────────────────── */

function mapaEstados(p) {
  const mapa = new Map();
  for (const ev of (Array.isArray(p.eventos) ? p.eventos : [])) {
    if (!ev || !ev.estado) continue;
    const ts = new Date(ev.ts).getTime();
    if (!Number.isFinite(ts)) continue;
    if (!mapa.has(ev.estado) || ts > mapa.get(ev.estado)) mapa.set(ev.estado, ts);
  }
  return mapa;
}

function lineaTiempo(p) {
  if (p.estado === 'cancelado') {
    return '<div class="cancelado"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8">' +
      '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></svg>' +
      '<div><b>Pedido cancelado</b><br>El local canceló este pedido. Si no sabes por qué, escríbeles por WhatsApp.</div></div>';
  }
  const tiempos = mapaEstados(p);
  const actual = Math.max(0, ETAPAS.findIndex((e) => e.k === p.estado));
  return '<ol class="linea-tiempo">' + ETAPAS.map((e, i) => {
    const hecho = i < actual || (p.estado === 'entregado' && i <= actual);
    const ahora = i === actual && p.estado !== 'entregado';
    const ts = tiempos.get(e.k) || (ahora && p.creado ? new Date(p.creado).getTime() : 0);
    return '<li class="paso-t' + (hecho ? ' paso-t--hecho' : '') + (ahora ? ' paso-t--ahora' : '') + '">' +
      '<span class="paso-t__punto" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg></span>' +
      '<div class="paso-t__cuerpo"><div class="paso-t__titulo">' + e.t + '</div>' +
        '<div class="paso-t__nota">' + e.d + '</div></div>' +
      (ts ? '<span class="paso-t__hora">' + esc(fechaHora(ts)) + '</span>' : '') +
    '</li>';
  }).join('') + '</ol>';
}

function datosEntrega(p) {
  const local = p.local || {};
  const esDelivery = p.entrega === 'delivery';
  const filas = [];
  filas.push(['Entrega', esDelivery ? 'Delivery' : 'Retiro en la tienda']);
  filas.push(['Local', esc(local.nombre || '')]);
  if (esDelivery) {
    filas.push(['Dirección', esc((p.direccion || '') + (p.comuna_entrega ? ', ' + p.comuna_entrega : ''))]);
    if (p.referencia_entrega) filas.push(['Referencia', esc(p.referencia_entrega)]);
  } else {
    filas.push(['Dirección', esc((local.direccion || '') + (local.comuna ? ', ' + local.comuna : ''))]);
    if (local.horario) filas.push(['Horario', esc(local.horario)]);
  }
  filas.push(['Pago', esc(nombrePago(p.metodo_pago)) +
    (p.metodo_pago === 'efectivo' && p.pago_con ? ' · pagas con ' + clp(p.pago_con) : '')]);
  if (p.metodo_pago === 'efectivo' && p.vuelto > 0) filas.push(['Vuelto', clp(p.vuelto)]);
  if (p.cliente) filas.push(['A nombre de', esc(p.cliente)]);
  if (p.nota) filas.push(['Nota', esc(p.nota)]);

  return '<section class="bloque" aria-labelledby="entregaTitulo">' +
    '<div class="bloque__cabeza"><h2 id="entregaTitulo">Entrega y pago</h2>' +
      (esDelivery ? '<a class="sec-head__link" href="' + esc(mapaUrl(p)) + '" target="_blank" rel="noopener">Ver en el mapa</a>' : '') +
    '</div>' +
    '<div class="bloque__cuerpo"><div class="datos">' + filas.map(([k, v], i) =>
      '<div class="dato' + (v && v.length > 42 ? ' dato--ancho' : '') + '"' + (i === 0 ? '' : '') + '>' +
        '<small>' + k + '</small><span>' + v + '</span></div>').join('') +
    '</div></div></section>';
}

function mapaUrl(p) {
  const q = [p.direccion, p.comuna_entrega].filter(Boolean).join(', ');
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q || p.local && p.local.direccion || '');
}

function nombrePago(m) {
  if (m === 'efectivo') return 'Efectivo';
  if (m === 'transferencia') return 'Transferencia';
  if (m === 'tarjeta') return 'Tarjeta (demo, sin cobro real)';
  return 'Por coordinar con el local';
}

function bloqueClave(p) {
  if (!p.clave_entrega || p.estado === 'entregado' || p.estado === 'cancelado') return '';
  return '<section class="bloque" aria-labelledby="claveTitulo">' +
    '<div class="bloque__cabeza"><h2 id="claveTitulo">Clave de entrega</h2></div>' +
    '<div class="bloque__cuerpo"><div class="clave">' +
      '<div><small>Dísela al repartidor al recibir</small><b>' + esc(p.clave_entrega) + '</b></div>' +
      '<button class="clave__copiar" type="button" data-copiar-clave>Copiar</button>' +
    '</div></div></section>';
}

function bloqueItems(p) {
  const items = Array.isArray(p.items) ? p.items : [];
  return '<section class="bloque" aria-labelledby="itemsTitulo">' +
    '<div class="bloque__cabeza"><h2 id="itemsTitulo">Tu pedido</h2>' +
      '<span class="pill">' + items.reduce((a, x) => a + (Number(x.cantidad) || 0), 0) + ' productos</span></div>' +
    '<div class="bloque__cuerpo"><div class="items">' + items.map((it) =>
      '<div class="item"><span class="item__cant">' + (Number(it.cantidad) || 1) + '</span>' +
        '<span class="item__nombre">' + esc(it.nombre || 'Producto') + '</span>' +
        '<span class="item__precio">' + clp((Number(it.precio) || 0) * (Number(it.cantidad) || 1)) + '</span></div>').join('') +
    '</div><div class="totales">' +
      '<div class="totales__linea"><span>Subtotal</span><b>' + clp(p.subtotal) + '</b></div>' +
      (p.ahorro > 0 ? '<div class="totales__linea"><span>Ahorro por ofertas</span><b>−' + clp(p.ahorro) + '</b></div>' : '') +
      '<div class="totales__linea"><span>Envío</span><b>' + (p.envio > 0 ? clp(p.envio) : 'retiro') + '</b></div>' +
      '<div class="totales__linea totales__linea--total"><span>Total</span><b>' + clp(p.total) + '</b></div>' +
    '</div></div></section>';
}

function bloqueLocal(p) {
  const local = p.local || {};
  const texto = 'Hola, consulto por mi pedido ' + (p.codigo || '') + '.';
  const wa = whatsapp(local.telefono, texto);
  return '<section class="bloque" aria-labelledby="localTitulo">' +
    '<div class="bloque__cabeza"><h2 id="localTitulo">Hablar con el local</h2></div>' +
    '<div class="bloque__cuerpo ayuda-local">' +
      (wa ? '<a class="ds-btn ds-btn--secondary" href="' + esc(wa) + '" target="_blank" rel="noopener">Escribir por WhatsApp</a>' : '') +
      (local.telefono ? '<a class="ds-btn ds-btn--ghost" href="tel:' + esc(String(local.telefono).replace(/[^\d+]/g, '')) + '">Llamar · ' +
        esc(telefonoVisible(local.telefono)) + '</a>' : '') +
      '<p class="pista">El local es quien prepara y entrega. FORGE CORE STOCK sólo muestra el estado que ellos registran.</p>' +
    '</div></section>';
}

function pintar(conAviso) {
  const p = estado.pedido;
  const caja = $('[data-pedido]');
  if (!caja || !p) return;
  const activo = p.estado !== 'entregado' && p.estado !== 'cancelado';
  caja.innerHTML =
    '<header class="pedido-cabeza">' +
      '<div class="pedido-cabeza__id">' +
        '<span class="pedido-cabeza__kicker">Código del pedido</span>' +
        '<div class="pedido-cabeza__codigo">' + esc(p.codigo) + '</div>' +
        '<div class="pedido-cabeza__local">' + esc((p.local && p.local.nombre) || 'Tu pedido') +
          (p.creado ? ' · ' + esc(fechaHora(p.creado)) : '') + '</div>' +
      '</div>' +
      '<div class="pedido-cabeza__estado">' +
        '<small>Estado</small>' +
        '<b>' + esc(nombreEstado(p.estado)) + '</b>' +
        (activo ? '<span class="pedido-cabeza__refresco"><span class="punto-vivo"></span>' +
          (estado.sinRed ? 'sin conexión' : 'se actualiza solo') + '</span>' : '') +
      '</div>' +
    '</header>' +
    '<div class="pedido-marco">' +
      '<div>' +
        '<section class="bloque" aria-labelledby="tiempoTitulo">' +
          '<div class="bloque__cabeza"><h2 id="tiempoTitulo">En qué va</h2>' +
            '<button class="ds-btn ds-btn--ghost ds-btn--sm" type="button" data-refrescar>Actualizar</button></div>' +
          '<div class="bloque__cuerpo">' + lineaTiempo(p) + '</div>' +
        '</section>' +
        datosEntrega(p) +
        bloqueItems(p) +
      '</div>' +
      '<aside>' +
        bloqueClave(p) +
        bloqueAvisos(p) +
        bloqueLocal(p) +
        '<p class="pista" style="padding:0 4px">¿Perdiste el enlace? Búscalo con el código y los últimos 4 dígitos de tu teléfono: ' +
          '<a href="/panel/cliente/pedido/">buscar pedido</a>.</p>' +
      '</aside>' +
    '</div>';

  if (conAviso) aviso('');
  document.querySelectorAll('[data-activar-avisos]').forEach((b) => b.addEventListener('click', activarAvisos));
  document.querySelectorAll('[data-quitar-avisos]').forEach((b) => b.addEventListener('click', quitarAvisos));
  document.querySelectorAll('[data-refrescar]').forEach((b) => b.addEventListener('click', () => cargar(true)));
  document.querySelectorAll('[data-copiar-clave]').forEach((b) => {
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(p.clave_entrega || '');
        b.textContent = 'Copiada';
        setTimeout(() => { b.textContent = 'Copiar'; }, 1500);
      } catch (_) { b.textContent = p.clave_entrega || ''; }
    });
  });
}

function nombreEstado(e) {
  if (e === 'nuevo') return 'Recibido';
  if (e === 'visto') return 'En preparación';
  if (e === 'listo') return 'Listo';
  if (e === 'entregado') return 'Entregado';
  if (e === 'cancelado') return 'Cancelado';
  return 'En curso';
}

function buscarFormulario() {
  const caja = $('[data-pedido]');
  if (!caja) return;
  caja.innerHTML = '<div class="exito" style="max-width:520px">' +
    '<div class="exito__ico" style="background:var(--ds-bg-elevated);color:var(--ds-accent)">' +
      '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg></div>' +
    '<h1 style="font-size:26px">Buscar un pedido</h1>' +
    '<p>Escribe el código <b>MP-XXXXX</b> que te dio la tienda y los últimos 4 dígitos del teléfono con que lo hiciste.</p>' +
    '<form data-buscar style="display:grid;gap:10px;text-align:left;margin-top:18px">' +
      '<div class="campo"><label for="b-codigo">Código del pedido</label>' +
        '<input id="b-codigo" name="codigo" type="text" placeholder="MP-12345" autocomplete="off" required></div>' +
      '<div class="campo"><label for="b-contacto">Últimos 4 dígitos del teléfono</label>' +
        '<input id="b-contacto" name="contacto" type="text" inputmode="numeric" maxlength="4" placeholder="5678" required></div>' +
      '<button class="ds-btn ds-btn--lg" type="submit">Ver el pedido</button>' +
    '</form>' +
    '<p style="margin-top:14px;font-size:11px">Si compraste en este navegador, también puedes abrir tus ' +
      '<a href="/panel/cliente/inicio/">pedidos recientes</a>.</p>' +
  '</div>';
  const form = $('[data-buscar]');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const codigo = (form.codigo.value || '').trim();
      const contacto = (form.contacto.value || '').replace(/\D/g, '').slice(-4);
      if (!codigo || contacto.length < 4) return;
      const q = new URLSearchParams({ codigo, contacto });
      history.replaceState(null, '', location.pathname + '?' + q.toString());
      estado.cred = { codigo, contacto };
      cargar(false);
    });
  }
}

function errorFatal(titulo, detalle, accion) {
  const caja = $('[data-pedido]');
  if (!caja) return;
  caja.innerHTML = '<div class="ds-error">' +
    '<div class="ds-error__title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">' +
    '<path d="M12 9v4M12 17h.01"/><path d="M10.3 4.2 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/></svg>' +
    esc(titulo) + '</div><div class="ds-error__text">' + esc(detalle) + '</div>' +
    '<div class="ds-error__action">' + (accion ||
      '<a class="ds-btn ds-btn--sm" href="/panel/cliente/pedido/">Buscar otro pedido</a>') + '</div></div>';
}

function guardarUltimo(p) {
  try {
    localStorage.setItem(K_ULTIMO, JSON.stringify({ clave: claveCred(estado.cred), pedido: p, ts: Date.now() }));
  } catch (_) { /* sin espacio */ }
}

function leerUltimo() {
  try {
    const d = JSON.parse(localStorage.getItem(K_ULTIMO) || 'null');
    if (!d || !d.pedido || d.clave !== claveCred(estado.cred)) return null;
    return d.pedido;
  } catch (_) { return null; }
}

async function cargar(manual) {
  if (!estado.cred) { buscarFormulario(); return; }
  const caja = $('[data-pedido]');
  if (manual && caja) {
    const b = document.querySelector('[data-refrescar]');
    if (b) { b.disabled = true; b.textContent = 'Actualizando…'; }
  }
  try {
    const d = await mercadoPost('pedido_seguir', estado.cred, { ms: 16000 });
    estado.pedido = d.pedido;
    estado.sinRed = false;
    guardarUltimo(d.pedido);
    pintar(true);
    programar();
  } catch (e) {
    const guardado = leerUltimo();
    if (guardado) {
      estado.pedido = guardado;
      estado.sinRed = true;
      pintar(true);
      aviso(esc(mensajeDeError(e)) + '. Mostramos el último estado guardado en este teléfono.', 'warn');
      programar();
      return;
    }
    if (e && e.codigo === 'NO_ENCONTRADO') {
      errorFatal('No encontramos ese pedido',
        'Revisa el código y los últimos 4 dígitos. Si el pedido es de otra persona, pídele el enlace completo.',
        '<a class="ds-btn ds-btn--sm" href="/panel/cliente/pedido/">Intentar de nuevo</a>');
    } else if (e && e.codigo === 'BLOQUEADO') {
      errorFatal('Demasiados intentos', 'Por seguridad, espera unos minutos antes de volver a buscar el pedido.');
    } else {
      errorFatal('No pudimos consultar el pedido', mensajeDeError(e),
        '<button class="ds-btn ds-btn--sm" type="button" id="reintentar">Reintentar</button>');
      const b = document.getElementById('reintentar');
      if (b) b.addEventListener('click', () => cargar(false));
    }
  }
}

function programar() {
  if (estado.reloj) clearTimeout(estado.reloj);
  const p = estado.pedido;
  if (!p || p.estado === 'entregado' || p.estado === 'cancelado') return;
  if (document.hidden) return;
  estado.reloj = setTimeout(() => cargar(false), 30000);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && estado.cred) cargar(false);
});

// Si el pedido se creó en este navegador, el código alcanza para encontrarlo.
(function arranque() {
  estado.cred = credencial();
  if (!estado.cred) {
    const ultimos = leerPedidos();
    const reciente = ultimos.find((p) => p && p.codigo);
    if (reciente) {
      const token = reciente.token || reciente.seguimiento || '';
      if (token) {
        history.replaceState(null, '', location.pathname + '?token=' + encodeURIComponent(token));
        estado.cred = { token };
      } else {
        const digitos = String(reciente.cliente && reciente.cliente.telefono || '').replace(/\D/g, '');
        if (digitos.length >= 4) {
          const q = new URLSearchParams({ codigo: reciente.codigo, contacto: digitos.slice(-4) });
          history.replaceState(null, '', location.pathname + '?' + q.toString());
          estado.cred = { codigo: reciente.codigo, contacto: digitos.slice(-4) };
        }
      }
    }
  }
  if (!estado.cred) { buscarFormulario(); return; }
  cargar(false);
})();
