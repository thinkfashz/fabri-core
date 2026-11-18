/* C14 · Ayuda
   Las respuestas describen lo que el panel HACE hoy: precios revalidados por
   el servidor, un pedido por tienda, pago coordinado con el local y avisos
   push reales. No se promete sincronización ni cancelación que no existan.
   El estado del servicio se lee de `GET /api/health`, que es público. */

import { API_BASE, mensajeDeError } from '../../comun/api.js';
import { esc } from '../../comun/formato.js';

const $ = (sel) => document.querySelector(sel);

const PREGUNTAS = [
  {
    tema: 'Pedidos',
    q: '¿Necesito una cuenta para comprar?',
    a: '<p>No. Puedes mirar tiendas, comparar precios, armar el carrito y confirmar un pedido sin crear cuenta. ' +
       'La cuenta sirve para identificarte y para recuperar el acceso si cambias de teléfono.</p>' +
       '<p>Ojo: el historial de pedidos se guarda <b>en este navegador</b>. La sincronización entre dispositivos todavía no está disponible.</p>',
  },
  {
    tema: 'Pedidos',
    q: '¿Cómo sé que el precio que veo es el que voy a pagar?',
    a: '<p>Cuando confirmas, el servidor vuelve a leer el catálogo de la tienda y recalcula precio, envío y vuelto. ' +
       'Si el precio cambió o falta stock, <b>rechaza el pedido y no descuenta nada</b>: te avisa qué producto falló.</p>' +
       '<p>Por eso el carrito se revalida al abrirlo y otra vez en el checkout.</p>',
  },
  {
    tema: 'Pedidos',
    q: '¿Puedo comprar en varias tiendas a la vez?',
    a: '<p>Sí, pero cada tienda es un pedido distinto: tiene su mínimo, su envío y su forma de entregar. ' +
       'El carrito agrupa los productos por tienda y te deja avanzar sólo con los grupos que estén completos.</p>',
  },
  {
    tema: 'Pedidos',
    q: '¿Por qué no me deja confirmar si ya tengo productos?',
    a: '<p>Revisa los avisos del grupo. Las causas habituales son:</p>' +
       '<ul><li>No llegas al <b>mínimo de compra</b> de esa tienda.</li>' +
       '<li>La tienda está <b>cerrada</b> en este momento.</li>' +
       '<li>Un producto se <b>agotó</b> o salió del catálogo.</li>' +
       '<li>Cambió un precio y falta pulsar <b>«Actualizar este pedido»</b>.</li></ul>',
  },
  {
    tema: 'Pedidos',
    q: '¿Cómo sigo mi pedido?',
    a: '<p>Al confirmar recibes un <b>código</b> y un enlace de seguimiento. Con el enlace entras directo; si lo perdiste, ' +
       'abre <a href="/panel/cliente/pedido/">Buscar un pedido</a> y usa el código más los <b>últimos 4 dígitos</b> del teléfono con que compraste.</p>' +
       '<p>La página se actualiza sola cada 30 segundos mientras el pedido esté en curso.</p>',
  },
  {
    tema: 'Pedidos',
    q: '¿Puedo cancelar un pedido?',
    a: '<p>La cancelación la registra el local desde su panel. Escríbeles por WhatsApp desde el seguimiento con tu código: ' +
       'si todavía no lo prepararon, lo cancelan y el stock vuelve a la tienda.</p>' +
       '<p>Si ya lo entregaron, el pedido queda cerrado y no se puede anular.</p>',
  },
  {
    tema: 'Pedidos',
    q: 'Perdí el código y el enlace del pedido',
    a: '<p>Si compraste en este mismo navegador, abre <a href="/panel/cliente/inicio/">Inicio</a>: el pedido activo aparece arriba. ' +
       'Si cambiaste de dispositivo, necesitas el código y los últimos 4 dígitos del teléfono; sin esos datos no se puede consultar.</p>',
  },
  {
    tema: 'Pedidos',
    q: 'Me equivoqué en el teléfono o en la dirección',
    a: '<p>El pedido viaja al local con los datos que escribiste. Si te equivocaste, abre el seguimiento y escríbeles por WhatsApp ' +
       'antes de que lo preparen. Si aún no lo confirmaste, vuelve al checkout y corrige el campo: los datos se recuerdan para la próxima compra.</p>',
  },

  {
    tema: 'Pagos',
    q: '¿Qué medios de pago puedo usar?',
    a: '<p>Cada tienda publica los suyos. En el checkout verás:</p>' +
       '<ul><li><b>Efectivo:</b> indicas con cuánto pagas y el servidor calcula el vuelto.</li>' +
       '<li><b>Transferencia:</b> el local te pasa sus datos al confirmar el pedido.</li>' +
       '<li><b>Tarjeta (demo):</b> es una simulación, no se cobra ni se envían datos reales.</li></ul>',
  },
  {
    tema: 'Pagos',
    q: '¿Quién cobra el envío?',
    a: '<p>Lo fija la tienda. Se suma al total sólo si eliges delivery; con retiro en el local no se cobra envío. ' +
       'El servidor recalcula el monto al crear el pedido, así que el total final manda sobre el estimado del carrito.</p>',
  },
  {
    tema: 'Pagos',
    q: 'El efectivo no me alcanza, ¿qué hago?',
    a: '<p>El checkout te muestra el vuelto o cuánto falta en rojo. Si el monto no alcanza para el total, el servidor responde ' +
       '<code>PAGO_CORTO</code> y no crea el pedido. Ajusta el monto, elige transferencia o quita productos.</p>',
  },
  {
    tema: 'Pagos',
    q: 'Pagué por transferencia y no veo el pedido confirmado',
    a: '<p>La transferencia la confirma el local cuando la recibe, no la plataforma. Envíales el comprobante por WhatsApp ' +
       'con tu código de pedido y pídeles que marquen el avance. Mientras no la confirmen, el estado sigue en «Recibido».</p>',
  },
  {
    tema: 'Pagos',
    q: '¿Me cobraron dos veces?',
    a: '<p>El checkout usa una clave de idempotencia: si tocas dos veces o la red se corta después de confirmar, ' +
       'el servidor devuelve <b>el mismo pedido</b> en vez de crear otro. Revisa tu historial en <a href="/panel/cliente/inicio/">Inicio</a> ' +
       'y compáralo con los movimientos del local.</p>' +
       '<p>Si aun así ves dos cargos, escríbenos a <a href="mailto:soporte@fabrick.cl">soporte@fabrick.cl</a> con ambos códigos.</p>',
  },

  {
    tema: 'Entrega',
    q: '¿Cómo sé si la tienda hace delivery o sólo retiro?',
    a: '<p>La ficha de cada producto y el checkout muestran las opciones reales de esa tienda. Si sólo hace retiro, ' +
       'la opción de delivery aparece desactivada y verás la dirección del local.</p>',
  },
  {
    tema: 'Entrega',
    q: '¿Qué es la clave de entrega?',
    a: '<p>Es un código corto que el local genera para tu pedido. El repartidor o el encargado te lo pide al entregar, ' +
       'así se confirma que el pedido llega a la persona correcta. La ves en el seguimiento mientras el pedido esté abierto.</p>',
  },
  {
    tema: 'Entrega',
    q: 'El pedido dice «Listo» pero no ha llegado',
    a: '<p>«Listo» significa que el local terminó de prepararlo. Si elegiste delivery, está esperando al repartidor; ' +
       'si elegiste retiro, puedes pasar a buscarlo. Escríbeles por WhatsApp desde el seguimiento para coordinar.</p>',
  },
  {
    tema: 'Entrega',
    q: '¿La tienda entrega fuera de mi comuna?',
    a: '<p>Depende de cada local: el checkout valida la comuna de entrega y rechaza el pedido si no corresponde. ' +
       'Si tu comuna no aparece, prueba con retiro o busca otra tienda en el <a href="/panel/cliente/mapa/">mapa</a>.</p>',
  },

  {
    tema: 'Cuenta',
    q: 'Olvidé mi contraseña',
    a: '<p>Entra a <a href="/panel/cliente/cuenta/">Cuenta</a>, elige «Recuperar» y escribe tu correo. Te llega un ' +
       '<b>código de 6 dígitos</b> que vence en 5 minutos. Con ese código fijas una clave nueva y quedas con la sesión abierta.</p>' +
       '<p>Si el código no llega, revisa spam y vuelve a pedirlo. El mensaje es el mismo exista o no la cuenta, por seguridad.</p>',
  },
  {
    tema: 'Cuenta',
    q: '¿Cuánto dura la sesión?',
    a: '<p>30 días desde el último ingreso. Se renueva sola mientras uses el panel. Cambiar la contraseña cierra las demás sesiones: ' +
       'tendrás que volver a entrar en los otros dispositivos.</p>',
  },
  {
    tema: 'Cuenta',
    q: '¿Puedo cambiar mi nombre o mi teléfono?',
    a: '<p>La edición del perfil todavía no está disponible. El nombre de la cuenta se fija al registrarte y el teléfono se toma ' +
       'del último checkout. Si necesitas corregir el correo, escríbenos a <a href="mailto:soporte@fabrick.cl">soporte@fabrick.cl</a>.</p>',
  },
  {
    tema: 'Cuenta',
    q: '¿Cómo elimino mi cuenta?',
    a: '<p>En <a href="/panel/cliente/cuenta/">Cuenta</a>, baja hasta «Zona de peligro». Se pide tu contraseña y escribir ' +
       '<b>ELIMINAR</b> en mayúsculas. La cuenta se borra en la plataforma y en el servicio de autenticación, y se cierra la sesión.</p>' +
       '<p>Los pedidos ya entregados quedan en el registro del local por obligación tributaria.</p>',
  },
  {
    tema: 'Cuenta',
    q: '¿Dónde veo todos mis pedidos?',
    a: '<p>Hoy el historial vive en este navegador y aparece en <a href="/panel/cliente/inicio/">Inicio</a>. ' +
       'La página «Mis pedidos» está en preparación; mientras tanto, el seguimiento funciona con el código de cada pedido.</p>',
  },

  {
    tema: 'Avisos',
    q: '¿Cómo activo las notificaciones del pedido?',
    a: '<p>Abre el seguimiento y pulsa «Activar avisos». El navegador te pedirá permiso. Cuando el local marque el pedido como ' +
       'visto, listo o entregado, llegará una notificación aunque tengas la página cerrada.</p>' +
       '<p>El contenido va cifrado de extremo a extremo: el servicio de notificaciones no puede leerlo.</p>',
  },
  {
    tema: 'Avisos',
    q: 'No me llegan las notificaciones',
    a: '<p>Revisa tres cosas: que el permiso del sitio esté en «Permitir», que el teléfono no tenga el ahorro de batería ' +
       'bloqueando el navegador y que hayas pulsado «Activar avisos» en ese mismo pedido.</p>' +
       '<p>Puedes desactivarlas cuando quieras desde el seguimiento con «Dejar de avisar».</p>',
  },

  {
    tema: 'Tiendas',
    q: '¿Cómo aparecen las tiendas en el panel?',
    a: '<p>Son locales registrados en FORGE CORE STOCK con su catálogo publicado. El mapa y la búsqueda muestran sólo tiendas reales; ' +
       'no hay catálogos de ejemplo.</p>',
  },
  {
    tema: 'Tiendas',
    q: '¿De dónde sale la distancia que veo?',
    a: '<p>Se calcula en tu navegador con la ubicación que autorizas y las coordenadas públicas de la tienda. ' +
       'Si no das ubicación, el panel no filtra por radio y ordena por nombre. Tu ubicación no se envía a la nube.</p>',
  },
  {
    tema: 'Tiendas',
    q: 'No encuentro una tienda que conozco',
    a: '<p>Puede estar cerrada o no haber publicado catálogo. En el <a href="/panel/cliente/mapa/">mapa</a>, sube el radio a ' +
       '«Todo Chile» y limpia los filtros. Si la tienda no aparece, todavía no está registrada en la plataforma.</p>',
  },
  {
    tema: 'Tiendas',
    q: 'Quiero vender en FORGE CORE STOCK',
    a: '<p>El panel de negocio está en construcción. La plataforma ya registra locales, catálogo, pedidos y boletas; ' +
       'cuando el panel esté abierto vas a poder cargar productos y operar la cola de pedidos desde el teléfono.</p>',
  },
];

const estado = { q: '', tema: '', salud: null };

/** Sin tildes y en minúsculas: «pago» encuentra «pagó» y «dirección». */
function normalizar(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function temas() {
  return Array.from(new Set(PREGUNTAS.map((p) => p.tema)));
}

function filtrar() {
  const q = normalizar(estado.q);
  return PREGUNTAS.map((p, i) => ({ p, i })).filter(({ p }) => {
    if (estado.tema && p.tema !== estado.tema) return false;
    if (!q) return true;
    return normalizar(p.q + ' ' + p.tema + ' ' + p.a.replace(/<[^>]+>/g, ' ')).includes(q);
  });
}

function pintarTemas() {
  const caja = $('[data-temas]');
  if (!caja) return;
  caja.innerHTML = '<button class="ds-chip" type="button" data-tema="" aria-pressed="' +
    (estado.tema ? 'false' : 'true') + '">Todos</button>' +
    temas().map((t) => '<button class="ds-chip" type="button" data-tema="' + esc(t) + '" aria-pressed="' +
      (estado.tema === t ? 'true' : 'false') + '">' + esc(t) + '</button>').join('');
  caja.querySelectorAll('[data-tema]').forEach((b) => {
    b.addEventListener('click', () => {
      estado.tema = b.dataset.tema || '';
      pintarTemas();
      pintarLista();
    });
  });
}

function pintarLista() {
  const caja = $('[data-lista]');
  const cuenta = $('[data-cuenta]');
  const limpiar = $('[data-limpiar]');
  if (!caja) return;
  const lista = filtrar();
  if (limpiar) limpiar.hidden = !estado.q;

  const total = PREGUNTAS.length;
  if (cuenta) {
    cuenta.textContent = estado.q || estado.tema
      ? lista.length + ' de ' + total + ' preguntas'
      : total + ' preguntas en ' + temas().length + ' temas';
  }

  if (!lista.length) {
    caja.innerHTML = '<div class="vacio-ayuda">' +
      '<h2>Nada con esas palabras</h2>' +
      '<p>Prueba con «pedido», «pago», «entrega», «clave» o «avisos». Si tu caso es puntual, el local o soporte te responden abajo.</p>' +
      '<button class="ds-btn ds-btn--secondary ds-btn--sm" type="button" data-limpiar-todo>Ver todas las preguntas</button>' +
      '</div>';
    const b = caja.querySelector('[data-limpiar-todo]');
    if (b) b.addEventListener('click', limpiarTodo);
    return;
  }

  // Al buscar, las respuestas se abren solas: el comprador vino por el texto.
  const abrir = Boolean(estado.q);
  caja.innerHTML = lista.map(({ p }) =>
    '<details class="tema"' + (abrir ? ' open' : '') + '>' +
      '<summary><span class="tema__tema">' + esc(p.tema) + '</span>' + esc(p.q) + '</summary>' +
      '<div class="tema__cuerpo">' + p.a + '</div>' +
    '</details>').join('');
}

function limpiarTodo() {
  estado.q = '';
  estado.tema = '';
  const input = $('[data-q]');
  if (input) input.value = '';
  pintarTemas();
  pintarLista();
  if (input) input.focus();
}

/* ── estado del servicio ──────────────────────────────────────────────── */

function pill(html, tipo) {
  const el = $('[data-estado-pill]');
  if (!el) return;
  el.className = 'pill' + (tipo ? ' pill--' + tipo : '');
  el.textContent = html;
}

function fila(k, v, code) {
  return '<div class="servicio__fila"><span>' + esc(k) + '</span><b>' +
    (code ? '<code>' + esc(v) + '</code>' : esc(v)) + '</b></div>';
}

async function consultarSalud() {
  const caja = $('[data-servicio]');
  const boton = $('[data-revisar]');
  if (boton) boton.disabled = true;
  pill('consultando…', '');
  if (caja) caja.innerHTML = '<div class="ds-skeleton ds-skeleton--text" style="width:100%"></div>';

  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const reloj = ctrl ? setTimeout(() => ctrl.abort(), 9000) : null;
  try {
    const r = await fetch(API_BASE + '/api/health', {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (!r.ok) throw new Error('la API respondió ' + r.status);
    const d = await r.json();
    estado.salud = d;
    const deps = Array.isArray(d.dependencias) ? d.dependencias : [];
    const listas = deps.filter((x) => x && x.ok).length;
    const todo = d.ok && deps.every((x) => x.ok || x.critica === false);
    pill(todo ? 'operativo' : 'con avisos', todo ? 'ok' : 'warn');
    if (caja) {
      caja.innerHTML =
        (todo ? '' : ('<div class="aviso aviso--warn" style="margin-bottom:10px"><svg viewBox="0 0 24 24">' +
          '<path d="M12 9v4M12 17h.01"/><path d="M10.3 4.2 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/></svg>' +
          '<span>Una dependencia del servicio no está configurada. Los pedidos pueden fallar hasta que se restablezca.</span></div>')) +
        fila('Servicio', d.servicio || 'fabri-api') +
        fila('Versión', d.version || '—') +
        fila('Consultado', d.hora ? new Date(d.hora).toLocaleString('es-CL') : 'ahora') +
        fila('Dependencias', listas + ' de ' + deps.length + ' listas') +
        deps.map((x) => fila(x.nombre || 'dependencia', (x.ok ? 'lista' : 'falta') + ' · ' + (x.detalle || ''))).join('');
    }
  } catch (e) {
    pill('sin conexión', 'err');
    if (caja) {
      caja.innerHTML = '<div class="aviso aviso--warn" style="margin:0">' +
        '<svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><path d="M10.3 4.2 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/></svg>' +
        '<span>No pudimos consultar el estado: ' + esc(mensajeDeError(e)) + '. La página que ya cargaste sigue funcionando; ' +
        'los pedidos necesitan conexión para confirmarse.</span></div>';
    }
  } finally {
    if (reloj) clearTimeout(reloj);
    if (boton) boton.disabled = false;
  }
}

/* ── arranque ─────────────────────────────────────────────────────────── */

function montar() {
  const input = $('[data-q]');
  let reloj = null;
  if (input) {
    input.addEventListener('input', () => {
      clearTimeout(reloj);
      reloj = setTimeout(() => {
        estado.q = input.value;
        pintarLista();
      }, 160);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && input.value) {
        e.preventDefault();
        limpiarTodo();
      }
    });
  }
  const limpiar = $('[data-limpiar]');
  if (limpiar) limpiar.addEventListener('click', limpiarTodo);
  const revisar = $('[data-revisar]');
  if (revisar) revisar.addEventListener('click', consultarSalud);
  window.addEventListener('online', consultarSalud);
  window.addEventListener('offline', () => pill('sin conexión', 'err'));
}

pintarTemas();
pintarLista();
montar();
consultarSalud();
