/* N14 · Notificaciones
   Los avisos son de ESTE navegador, no de la cuenta: la API guarda una fila
   por dispositivo en `mercado_push_local` y no expone un listado. Por eso la
   pantalla no finge una lista de equipos: muestra el estado real de la
   suscripción local y deja registrar/desactivar/probar.

   La clave pública VAPID viaja en `ventas_serie.push`; si el servidor no la
   tiene configurada, se dice y no se intenta suscribir. */

import { arrancar, llamar } from '../../comun/negocio.js';
import { esc } from '../../comun/formato.js';

const $ = (sel, raiz) => (raiz || document).querySelector(sel);

const estado = {
  ctx: null,
  cargando: true,
  errorCarga: '',
  soportado: false,
  disponible: false,
  clave: '',
  permiso: 'default',
  suscrito: false,
  ocupado: '',
  aviso: '',
};

function soporte() {
  return typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window;
}

function claveToUint8(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registroPush() {
  if (!estado.soportado) return null;
  try { return await navigator.serviceWorker.getRegistration('/sw-push.js'); } catch (_) { return null; }
}

async function suscripcionActual() {
  const reg = await registroPush();
  if (!reg) return { reg: null, sub: null };
  try { return { reg, sub: await reg.pushManager.getSubscription() }; } catch (_) { return { reg, sub: null }; }
}

function avisar(html) {
  estado.aviso = html;
  const caja = $('[data-aviso]');
  if (caja) caja.innerHTML = html;
}

/* ── estado visible ──────────────────────────────────────────────────────── */

function tono() {
  if (!estado.soportado) return { pill: 'pill--err', t: 'Sin soporte', tono: 'err' };
  if (estado.permiso === 'denied') return { pill: 'pill--err', t: 'Bloqueado', tono: 'err' };
  if (!estado.disponible) return { pill: 'pill--warn', t: 'Servidor sin claves', tono: 'warn' };
  if (estado.suscrito) return { pill: 'pill--ok', t: 'Activado', tono: 'ok' };
  return { pill: 'pill--warn', t: 'Desactivado', tono: 'warn' };
}

function detalle() {
  if (!estado.soportado) {
    return 'Este navegador no implementa notificaciones push. Abre el panel en Chrome, Edge ' +
      'o Firefox actualizado, o instala la app en el teléfono.';
  }
  if (estado.permiso === 'denied') {
    return 'Bloqueaste las notificaciones para este sitio. El navegador no permite volver a ' +
      'pedir permiso desde la página: hay que habilitarlo en los ajustes del sitio y recargar.';
  }
  if (!estado.disponible) {
    return 'La API no tiene configuradas las claves VAPID, así que ningún dispositivo puede ' +
      'suscribirse todavía. Los avisos se activan cuando el servidor tenga las claves.';
  }
  if (estado.suscrito) {
    return 'Este navegador está suscrito y recibirá un aviso cuando entre un pedido nuevo ' +
      'a la tienda seleccionada. La prueba se muestra al instante.';
  }
  return 'Activa los avisos para enterarte de un pedido nuevo aunque el panel esté cerrado. ' +
    'El navegador pedirá permiso una sola vez.';
}

function botones() {
  const b = [];
  if (!estado.soportado || estado.permiso === 'denied' || !estado.disponible) {
    b.push('<button class="ds-btn ds-btn--primary" type="button" disabled>Activar avisos</button>');
  } else if (!estado.suscrito) {
    b.push('<button class="ds-btn ds-btn--primary" type="button" data-activar' +
      (estado.ocupado ? ' disabled' : '') + '>' +
      (estado.ocupado === 'activar' ? 'Activando…' : 'Activar avisos') + '</button>');
  } else {
    b.push('<button class="ds-btn ds-btn--primary" type="button" data-probar' +
      (estado.ocupado ? ' disabled' : '') + '>' +
      (estado.ocupado === 'probar' ? 'Enviando…' : 'Enviar aviso de prueba') + '</button>');
    b.push('<button class="ds-btn ds-btn--secondary" type="button" data-registrar' +
      (estado.ocupado ? ' disabled' : '') + '>' +
      (estado.ocupado === 'registrar' ? 'Registrando…' : 'Registrar en esta tienda') + '</button>');
    b.push('<button class="ds-btn ds-btn--ghost" type="button" data-desactivar' +
      (estado.ocupado ? ' disabled' : '') + '>' +
      (estado.ocupado === 'desactivar' ? 'Desactivando…' : 'Desactivar en este navegador') + '</button>');
  }
  return b.join('');
}

function pantalla(ctx) {
  const e = tono();
  return '<header class="neg-cabeza">' +
      '<div><span class="neg-cabeza__kicker">Sin sorpresas</span>' +
        '<h1>Notificaciones</h1>' +
        '<p>Un aviso cuando entra un pedido, con el monto y el nombre del cliente. ' +
          'Se activa navegador por navegador.</p></div>' +
      '<div class="neg-cabeza__acciones">' +
        '<button class="ds-btn ds-btn--secondary ds-btn--sm" type="button" data-actualizar>Revisar estado</button>' +
        '<a class="ds-btn ds-btn--ghost ds-btn--sm" href="/panel/negocio/pedidos/">Ver pedidos</a>' +
      '</div>' +
    '</header>' +
    '<div class="neg-aviso" data-aviso aria-live="polite">' + estado.aviso + '</div>' +
    (estado.errorCarga
      ? '<div class="aviso aviso--warn not-carga">No pudimos consultar la configuración de ' +
        'avisos en la nube: ' + esc(estado.errorCarga) + ' Igual puedes revisar el permiso del navegador.</div>'
      : '') +
    '<div class="not-grilla">' +
      '<section class="neg-tarjeta not-estado not-estado--' + e.tono + '" aria-labelledby="not-estado-t">' +
        '<div class="not-estado__ico" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>' +
        '</div>' +
        '<div class="not-estado__cabeza">' +
          '<h2 id="not-estado-t">Avisos en este navegador</h2>' +
          '<span class="pill ' + e.pill + '">' + esc(e.t) + '</span>' +
        '</div>' +
        '<p class="not-estado__texto">' + esc(detalle()) + '</p>' +
        '<dl class="not-estado__datos">' +
          '<div><dt>Permiso</dt><dd>' + esc(permisoTexto(estado.permiso)) + '</dd></div>' +
          '<div><dt>Servidor</dt><dd>' + (estado.disponible ? 'claves VAPID listas' : 'sin claves VAPID') + '</dd></div>' +
          '<div><dt>Suscripción</dt><dd>' + (estado.suscrito ? 'en este navegador' : 'ninguna') + '</dd></div>' +
          '<div><dt>Tienda</dt><dd>' + esc(ctx.tienda.nombre || ctx.tienda.id) + '</dd></div>' +
        '</dl>' +
        '<div class="not-estado__acciones">' + botones() + '</div>' +
      '</section>' +
      '<aside class="not-lado">' +
        '<section class="neg-tarjeta not-info" aria-labelledby="not-info-t">' +
          '<h2 id="not-info-t">Qué se avisa</h2>' +
          '<ul class="not-info__lista">' +
            '<li><b>Pedido nuevo</b><span>Código, total, primer nombre del cliente y si es retiro o delivery.</span></li>' +
            '<li><b>Al tocar el aviso</b><span>Se abre el panel del negocio, en la cola de pedidos.</span></li>' +
            '<li><b>Sin datos de más</b><span>No viaja el teléfono ni la dirección en la notificación.</span></li>' +
          '</ul>' +
          '<p class="not-info__nota">Los cambios de estado del pedido se avisan al comprador ' +
            'en sus propios dispositivos, no acá.</p>' +
        '</section>' +
        '<section class="neg-tarjeta not-pasos" aria-labelledby="not-pasos-t">' +
          '<h2 id="not-pasos-t">Cómo cubrir otro equipo</h2>' +
          '<ol class="not-pasos__lista">' +
            '<li><span class="not-paso__n">1</span><div><b>Abre este panel en ese equipo</b>' +
              '<small>Con la misma cuenta o con la clave de la tienda.</small></div></li>' +
            '<li><span class="not-paso__n">2</span><div><b>Activa los avisos</b>' +
              '<small>Cada navegador pide su propio permiso.</small></div></li>' +
            '<li><span class="not-paso__n">3</span><div><b>Repite en cada uno</b>' +
              '<small>La API acepta hasta 5 dispositivos por tienda.</small></div></li>' +
          '</ol>' +
          '<p class="not-info__nota">La API no expone la lista de dispositivos suscritos: ' +
            'esta pantalla no inventa equipos que no puede ver.</p>' +
        '</section>' +
      '</aside>' +
    '</div>';
}

function permisoTexto(p) {
  if (p === 'granted') return 'concedido';
  if (p === 'denied') return 'bloqueado';
  return 'sin decidir';
}

function pintar(caja, ctx) {
  caja.innerHTML = pantalla(ctx);
  $('[data-actualizar]', caja)?.addEventListener('click', () => {
    estado.aviso = '';
    cargar(caja, ctx, false);
  });
  $('[data-activar]', caja)?.addEventListener('click', () => activar(caja, ctx));
  $('[data-registrar]', caja)?.addEventListener('click', () => registrar(caja, ctx));
  $('[data-desactivar]', caja)?.addEventListener('click', () => desactivar(caja, ctx));
  $('[data-probar]', caja)?.addEventListener('click', () => probar(caja, ctx));
}

/* ── acciones ────────────────────────────────────────────────────────────── */

async function activar(caja, ctx) {
  if (estado.ocupado) return;
  estado.ocupado = 'activar';
  avisar('');
  pintar(caja, ctx);
  try {
    if (!estado.disponible || !estado.clave) throw new Error('El servidor no tiene las claves de avisos configuradas.');
    const permiso = await Notification.requestPermission();
    estado.permiso = permiso;
    if (permiso !== 'granted') {
      throw new Error(permiso === 'denied'
        ? 'El navegador bloqueó las notificaciones. Habilítalas en los ajustes del sitio.'
        : 'No se concedió permiso: sin aceptar la notificación el navegador no entrega avisos.');
    }
    const reg = await navigator.serviceWorker.register('/sw-push.js');
    const actual = await reg.pushManager.getSubscription();
    const sub = actual || await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: claveToUint8(estado.clave),
    });
    await llamar('push_local_suscribir', { local_id: ctx.tienda.id, suscripcion: sub.toJSON() });
    estado.suscrito = true;
    estado.ocupado = '';
    avisar('<div class="aviso aviso--ok">Avisos activados. Este navegador recibirá los pedidos nuevos de ' +
      esc(ctx.tienda.nombre || 'la tienda') + '.</div>');
    pintar(caja, ctx);
  } catch (fallo) {
    estado.ocupado = '';
    // La suscripción puede haber quedado creada aunque falle el registro:
    // se relee para no mentir con el estado.
    const ahora = await suscripcionActual();
    estado.suscrito = Boolean(ahora.sub);
    avisar('<div class="aviso aviso--err">' +
      esc(fallo && fallo.message ? fallo.message : 'No se pudieron activar los avisos.') + '</div>');
    pintar(caja, ctx);
  }
}

async function registrar(caja, ctx) {
  if (estado.ocupado) return;
  estado.ocupado = 'registrar';
  pintar(caja, ctx);
  try {
    const { sub } = await suscripcionActual();
    if (!sub) throw new Error('Este navegador ya no tiene una suscripción activa. Vuelve a activar los avisos.');
    await llamar('push_local_suscribir', { local_id: ctx.tienda.id, suscripcion: sub.toJSON() });
    estado.ocupado = '';
    avisar('<div class="aviso aviso--ok">Este navegador quedó registrado para ' +
      esc(ctx.tienda.nombre || 'la tienda') + '.</div>');
    pintar(caja, ctx);
  } catch (fallo) {
    estado.ocupado = '';
    avisar('<div class="aviso aviso--err">' +
      esc(fallo && fallo.message ? fallo.message : 'No se pudo registrar el navegador.') + '</div>');
    pintar(caja, ctx);
  }
}

async function desactivar(caja, ctx) {
  if (estado.ocupado) return;
  estado.ocupado = 'desactivar';
  pintar(caja, ctx);
  const { sub } = await suscripcionActual();
  if (!sub) {
    estado.suscrito = false;
    estado.ocupado = '';
    avisar('<div class="aviso aviso--warn">Este navegador no tenía una suscripción activa.</div>');
    pintar(caja, ctx);
    return;
  }
  let apiOk = true;
  try {
    await llamar('push_local_baja', { local_id: ctx.tienda.id, endpoint: sub.endpoint });
  } catch (_) { apiOk = false; }
  let localOk = true;
  try { await sub.unsubscribe(); } catch (_) { localOk = false; }
  estado.suscrito = false;
  estado.ocupado = '';
  avisar(apiOk && localOk
    ? '<div class="aviso aviso--ok">Avisos desactivados en este navegador.</div>'
    : '<div class="aviso aviso--warn">Este navegador dejó de recibir avisos, pero la nube no ' +
      'confirmó la baja. Si vuelves a activar, se corrige solo.</div>');
  pintar(caja, ctx);
}

async function probar(caja, ctx) {
  if (estado.ocupado) return;
  estado.ocupado = 'probar';
  pintar(caja, ctx);
  try {
    if (Notification.permission !== 'granted') throw new Error('El navegador no tiene permiso para mostrar avisos.');
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification('Nuevo pedido de prueba', {
      body: '$12.450 · Camila · retiro · así se verá el aviso real',
      icon: '/app/icons/icon-192.png',
      badge: '/app/icons/icon-192.png',
      tag: 'pedido-prueba',
      data: { url: '/panel/negocio/pedidos/' },
    });
    estado.ocupado = '';
    avisar('<div class="aviso aviso--ok">Aviso enviado. Si no lo ves, revisa que el sistema ' +
      'no tenga silenciado el navegador.</div>');
  } catch (fallo) {
    estado.ocupado = '';
    avisar('<div class="aviso aviso--err">' +
      esc(fallo && fallo.message ? fallo.message : 'No se pudo mostrar el aviso de prueba.') + '</div>');
  }
  pintar(caja, ctx);
}

/* ── carga ───────────────────────────────────────────────────────────────── */

async function cargar(caja, ctx, conEsqueleto) {
  estado.cargando = true;
  estado.errorCarga = '';
  if (conEsqueleto !== false) {
    caja.innerHTML = '<div class="not-esqueleto" aria-live="polite">' +
      '<div class="ds-skeleton" style="height:32px;width:260px;margin-bottom:14px"></div>' +
      '<div class="not-grilla">' +
        '<div class="ds-skeleton" style="height:280px"></div>' +
        '<div class="ds-skeleton" style="height:280px"></div>' +
      '</div></div>';
  }

  estado.soportado = soporte();
  estado.permiso = estado.soportado ? Notification.permission : 'default';

  const config = await llamar('ventas_serie', { local_id: ctx.tienda.id, dias: 1 })
    .then((d) => ({ ok: true, push: d && d.push }))
    .catch((e) => ({ ok: false, error: e && e.message ? e.message : 'La nube no respondió.' }));

  if (config.ok && config.push) {
    estado.disponible = Boolean(config.push.disponible && config.push.clave);
    estado.clave = config.push.clave || '';
  } else {
    estado.disponible = false;
    estado.clave = '';
    estado.errorCarga = config.error || '';
  }

  const { sub } = await suscripcionActual();
  estado.suscrito = Boolean(sub);
  estado.cargando = false;
  estado.ocupado = '';
  pintar(caja, ctx);
}

arrancar({
  alListo(ctx) {
    estado.ctx = ctx;
    estado.aviso = '';
    const caja = $('[data-negocio]');
    if (caja) cargar(caja, ctx);
  },
});
