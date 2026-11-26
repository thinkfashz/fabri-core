/* Mensajes · chat del panel Negocio
   Lee y responde los mensajes que los clientes envían desde MercaFabrick.
   Autenticación: la sesión de la nube (Bearer + x-dispositivo). La API
   autoriza al dueño por `dueno_id`; la clave del local NO se usa acá. */

import { arrancar, llamar } from '../../comun/negocio.js';
import { esc, fechaHora, hace } from '../../comun/formato.js';

const $ = (sel, raiz) => (raiz || document).querySelector(sel);

const estado = {
  ctx: null,
  mensajes: [],
  error: '',
  cargando: false,
  enviando: false,
  timer: null,
};

function burbujas() {
  if (!estado.mensajes.length) {
    return '<p class="msg-vacio">Todavía no hay mensajes. Los clientes que escriban ' +
      'desde la app aparecen acá.</p>';
  }
  return estado.mensajes.map((m) => {
    const mio = m.autor === 'local';
    return '<div class="msg' + (mio ? ' msg--local' : '') + '">' +
      '<small>' + esc(mio ? 'Tú · ' + (m.nombre || 'Local') : (m.nombre || 'Cliente')) + '</small>' +
      '<p>' + esc(m.texto || '') + '</p>' +
      '<time datetime="' + esc(m.creado || '') + '">' + esc(fechaHora(m.creado) || hace(m.creado)) + '</time>' +
      '</div>';
  }).join('');
}

function pintar(caja) {
  const t = estado.ctx.tienda;
  caja.innerHTML =
    '<div class="msg-head">' +
    '<div><h1>Mensajes</h1><p>Chat con los clientes de ' + esc(t.nombre) + '.</p></div>' +
    '<button class="btn" type="button" data-refrescar>Actualizar</button>' +
    '</div>' +
    (estado.error ? '<div class="aviso aviso--err">' + esc(estado.error) + '</div>' : '') +
    '<div class="msg-caja">' +
    '<div class="msg-hilo" id="msgHilo" aria-live="polite">' + burbujas() + '</div>' +
    '<form class="msg-form" id="msgForm" novalidate>' +
    '<input id="msgTxt" type="text" maxlength="1000" placeholder="Responde al cliente…" autocomplete="off" aria-label="Mensaje">' +
    '<button class="btn btn--acento" type="submit"' + (estado.enviando ? ' disabled' : '') + '>Enviar</button>' +
    '</form></div>';

  const b = $('[data-refrescar]', caja);
  if (b) b.onclick = () => cargar(caja, true);

  const f = $('#msgForm', caja);
  if (f) {
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      const inp = $('#msgTxt', caja);
      const txt = inp ? inp.value.trim() : '';
      if (!txt || estado.enviando) return;
      estado.enviando = true;
      if (inp) inp.value = '';
      pintar(caja);
      try {
        await llamar('mensaje_enviar', { local_id: estado.ctx.tienda.id, texto: txt });
        await cargar(caja, true);
      } catch (fallo) {
        estado.error = fallo && fallo.message ? fallo.message : 'No se pudo enviar.';
        estado.enviando = false;
        pintar(caja);
      }
    };
  }

  const hilo = $('#msgHilo', caja);
  if (hilo) hilo.scrollTop = hilo.scrollHeight;
}

async function cargar(caja, callado) {
  if (!estado.ctx) return;
  if (!callado) {
    const hilo = $('#msgHilo', caja);
    if (hilo && !estado.mensajes.length) hilo.innerHTML = '<p class="msg-vacio">Cargando…</p>';
  }
  try {
    const d = await llamar('mensajes_listar', { local_id: estado.ctx.tienda.id, limite: 80 });
    estado.mensajes = Array.isArray(d.mensajes) ? d.mensajes : [];
    estado.error = '';
    estado.enviando = false;
    pintar(caja);
  } catch (fallo) {
    /* Un 401 significa que la sesión venció: el shell ya pide entrar de
       nuevo, así que acá sólo se muestra el motivo sin insistir. */
    estado.error = fallo && fallo.message ? fallo.message : 'La nube no respondió.';
    pintar(caja);
  }
}

arrancar({
  alListo(ctx) {
    estado.ctx = ctx;
    const caja = $('[data-negocio]');
    if (!caja) return;
    cargar(caja);
    if (estado.timer) clearInterval(estado.timer);
    /* Polling cada 5 s mientras la pestaña está visible. */
    estado.timer = setInterval(() => {
      if (document.hidden) return;
      cargar(caja, true);
    }, 5000);
    window.addEventListener('beforeunload', () => {
      if (estado.timer) clearInterval(estado.timer);
    });
  },
});