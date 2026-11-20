/* N07 · Horarios y entrega
   La semana en siete filas y las reglas de entrega en una tarjeta. Se guarda
   con `local_actualizar`: `horario` es el texto que ve el comprador y la API
   lo limita a 120 caracteres, así que el formulario serializa las franjas
   agrupando días iguales antes de enviar. */

import { arrancar, llamar } from '../../comun/negocio.js';
import { clp, esc } from '../../comun/formato.js';
import { leer, escribir, sugerencia, hoy, validar, MAX_TEXTO } from './horario.js';

const $ = (sel, raiz) => (raiz || document).querySelector(sel);
const $$ = (sel, raiz) => Array.from((raiz || document).querySelectorAll(sel));

const estado = {
  ctx: null,
  aviso: '',
  guardando: false,
  sinHorario: false,
};

function fichaUrl(t) {
  return location.origin + '/panel/cliente/tienda/?id=' + encodeURIComponent(t.id);
}

/* ── filas de la semana ──────────────────────────────────────────────────── */

function filaHtml(d, i, conHoy) {
  const esHoy = conHoy === i;
  const abierto = d.abierto !== false;
  return '<div class="hor-dia' + (abierto ? '' : ' hor-dia--cerrado') +
      (esHoy ? ' hor-dia--hoy' : '') + '" data-fila="' + i + '">' +
    '<div class="hor-dia__nombre"><b>' + esc(hoyNombre(i)) + '</b>' +
      (esHoy ? '<span class="hor-dia__hoy">Hoy</span>' : '') + '</div>' +
    '<label class="hor-switch">' +
      '<input type="checkbox" data-abierto="' + i + '"' + (abierto ? ' checked' : '') +
        ' aria-label="Abrir el ' + esc(hoyNombre(i).toLowerCase()) + '">' +
      '<span class="hor-switch__pista" aria-hidden="true"></span>' +
      '<span class="sr-only">' + (abierto ? 'Abierto' : 'Cerrado') + '</span>' +
    '</label>' +
    '<div class="hor-horas">' +
      '<label class="hor-hora"><span>Desde</span>' +
        '<input type="time" data-desde="' + i + '" value="' + esc(d.desde) +
        '" aria-label="Apertura del ' + esc(hoyNombre(i).toLowerCase()) + '"' +
        (abierto ? '' : ' disabled') + '></label>' +
      '<span class="hor-guion" aria-hidden="true">a</span>' +
      '<label class="hor-hora"><span>Hasta</span>' +
        '<input type="time" data-hasta="' + i + '" value="' + esc(d.hasta) +
        '" aria-label="Cierre del ' + esc(hoyNombre(i).toLowerCase()) + '"' +
        (abierto ? '' : ' disabled') + '></label>' +
    '</div>' +
    '<span class="hor-dia__estado">' + (abierto ? 'Abierto' : 'Cerrado') + '</span>' +
  '</div>';
}

function hoyNombre(i) {
  return ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][i];
}

/* ── lectura del formulario ──────────────────────────────────────────────── */

function leerFormulario(caja) {
  const dias = [];
  for (let i = 0; i < 7; i++) {
    const check = $('[data-abierto="' + i + '"]', caja);
    dias.push({
      i,
      abierto: Boolean(check && check.checked),
      desde: ($('[data-desde="' + i + '"]', caja) || {}).value || '09:00',
      hasta: ($('[data-hasta="' + i + '"]', caja) || {}).value || '19:00',
    });
  }
  const entrega = $$('[data-entrega]:checked', caja).map((c) => c.value);
  const numero = (sel) => {
    const el = $(sel, caja);
    return Math.max(0, Math.round(Number(String(el ? el.value : '').replace(/[^\d]/g, '')) || 0));
  };
  return { dias, entrega, envio: numero('[data-envio]'), minimo: numero('[data-minimo]') };
}

/* ── resumen lateral ─────────────────────────────────────────────────────── */

function resumenHtml(datos, abierto, sinHorario) {
  const h = hoy(datos.dias);
  const texto = escribir(datos.dias);
  const excede = texto.length > MAX_TEXTO;
  return '<div class="hor-resumen__cabeza">' +
      '<span class="hor-resumen__rotulo">Hoy</span>' +
      '<span class="pill ' + (abierto ? 'pill--ok' : 'pill--err') + '">' +
        (abierto ? 'Tienda abierta' : 'Tienda cerrada') + '</span>' +
    '</div>' +
    '<strong class="hor-hoy' + (h.abierto ? '' : ' hor-hoy--cerrado') + '">' + esc(h.texto) + '</strong>' +
    '<p class="hor-resumen__nota">' + (h.abierto
      ? 'Así se lee la ficha hoy.'
      : 'La ficha muestra que hoy está cerrado.') + '</p>' +
    (sinHorario
      ? '<div class="aviso aviso--warn hor-resumen__aviso">Todavía no hay horario publicado. ' +
        'La semana de abajo es una propuesta: guárdala si te sirve.</div>'
      : '') +
    '<div class="hor-lista">' +
      datos.dias.map((d) => '<div class="hor-lista__fila' +
        (d.i === h.dia ? ' hor-lista__fila--hoy' : '') + '">' +
        '<span>' + esc(hoyNombre(d.i).slice(0, 3)) + '</span>' +
        '<b>' + (d.abierto ? esc(d.desde + '–' + d.hasta) : 'Cerrado') + '</b>' +
      '</div>').join('') +
    '</div>' +
    '<div class="hor-texto">' +
      '<span>Texto que ve el comprador</span>' +
      '<p data-texto>' + esc(texto || '—') + '</p>' +
      '<small class="' + (excede ? 'hor-texto--mal' : '') + '" data-largo>' +
        texto.length + '/' + MAX_TEXTO + ' caracteres' +
        (excede ? ' · demasiado largo, acorta las franjas' : '') + '</small>' +
    '</div>' +
    (datos.entrega.length
      ? '<p class="hor-resumen__nota hor-resumen__entrega">' +
        datos.entrega.map((x) => x === 'delivery' ? 'Delivery' : 'Retiro').join(' · ') +
        (datos.entrega.includes('delivery') && datos.envio
          ? ' · envío ' + clp(datos.envio)
          : '') +
        (datos.minimo ? ' · mínimo ' + clp(datos.minimo) : '') + '</p>'
      : '<p class="hor-resumen__nota hor-resumen__entrega hor-texto--mal">Sin forma de entrega: el checkout no deja comprar.</p>');
}

function pintarResumen(caja, abierto, sinHorario) {
  const cajaResumen = $('[data-resumen]', caja);
  if (!cajaResumen) return;
  cajaResumen.innerHTML = resumenHtml(leerFormulario(caja), abierto, sinHorario);
}

/* ── pantalla ────────────────────────────────────────────────────────────── */

function pantalla(ctx) {
  const t = ctx.tienda;
  const dias = leer(t.horario) || sugerencia();
  const sinHorario = !leer(t.horario);
  const entrega = Array.isArray(t.entrega) && t.entrega.length ? t.entrega : ['retiro'];
  const abierto = t.abierto !== false;
  const conHoy = (new Date().getDay() + 6) % 7;
  const datos = { dias, entrega, envio: Number(t.envio) || 0, minimo: Number(t.minimo) || 0 };

  return '<header class="neg-cabeza">' +
      '<div><span class="neg-cabeza__kicker">Cuándo y cómo</span>' +
        '<h1>Horarios y entrega</h1>' +
        '<p>La semana que se publica en tu ficha y las reglas con las que el ' +
          'comprador puede pedir. Se guarda en la nube, no en este navegador.</p></div>' +
      '<div class="neg-cabeza__acciones">' +
        '<button class="ds-btn ds-btn--ghost ds-btn--sm" type="button" data-estado>' +
          (abierto ? 'Cerrar ahora' : 'Abrir ahora') + '</button>' +
        '<a class="ds-btn ds-btn--ghost ds-btn--sm" target="_blank" rel="noopener" href="' +
          esc(fichaUrl(t)) + '">Ver ficha</a>' +
      '</div>' +
    '</header>' +
    '<div class="neg-aviso" data-aviso aria-live="polite">' + estado.aviso + '</div>' +
    '<form data-form novalidate>' +
      '<div class="hor-grilla">' +
        '<section class="neg-tarjeta hor-semana" aria-labelledby="hor-semana-t">' +
          '<div class="hor-bloque__cabeza">' +
            '<div><h2 id="hor-semana-t">La semana</h2>' +
              '<span class="neg-tarjeta__sub">Una franja por día · ' +
                (abierto ? 'tienda abierta' : 'tienda cerrada') + '</span></div>' +
            '<div class="hor-atajos">' +
              '<button class="ds-btn ds-btn--ghost ds-btn--sm" type="button" data-copiar>Copiar lunes al resto</button>' +
              '<button class="ds-btn ds-btn--ghost ds-btn--sm" type="button" data-cerrar-todo>Cerrar todos</button>' +
            '</div>' +
          '</div>' +
          '<div class="hor-dias">' + dias.map((d, i) => filaHtml(d, i, conHoy)).join('') + '</div>' +
          '<p class="hor-nota">El interruptor de arriba (Abierto/Cerrado) es el que ' +
            'habilita la compra. El horario se informa en la ficha y en el mapa; ' +
            'no cierra la tienda por sí solo.</p>' +
        '</section>' +
        '<aside class="neg-tarjeta hor-resumen" data-resumen aria-label="Resumen del horario">' +
          resumenHtml(datos, abierto, sinHorario) +
        '</aside>' +
      '</div>' +
      '<section class="neg-tarjeta hor-entrega" aria-labelledby="hor-entrega-t">' +
        '<div class="hor-bloque__cabeza">' +
          '<div><h2 id="hor-entrega-t">Entrega y mínimos</h2>' +
            '<span class="neg-tarjeta__sub">Lo que el checkout respeta antes de crear el pedido</span></div>' +
        '</div>' +
        '<div class="hor-entrega__grilla">' +
          '<fieldset class="hor-formas">' +
            '<legend>Formas de entrega</legend>' +
            '<label class="hor-check"><input type="checkbox" value="retiro" data-entrega' +
              (entrega.includes('retiro') ? ' checked' : '') + '>' +
              '<span><b>Retiro en el local</b><small>El comprador pasa a buscarlo.</small></span></label>' +
            '<label class="hor-check"><input type="checkbox" value="delivery" data-entrega' +
              (entrega.includes('delivery') ? ' checked' : '') + '>' +
              '<span><b>Delivery</b><small>Se entrega en la dirección que indique.</small></span></label>' +
          '</fieldset>' +
          '<div class="hor-campos">' +
            '<label class="campo"><span>Mínimo de compra (CLP)</span>' +
              '<input type="number" min="0" step="100" inputmode="numeric" data-minimo value="' +
                (Number(t.minimo) || 0) + '" placeholder="0">' +
              '<small>0 significa sin mínimo.</small></label>' +
            '<label class="campo" data-envio-campo><span>Costo de envío (CLP)</span>' +
              '<input type="number" min="0" step="100" inputmode="numeric" data-envio value="' +
                (Number(t.envio) || 0) + '" placeholder="0">' +
              '<small>Se cobra en los pedidos con delivery.</small></label>' +
          '</div>' +
        '</div>' +
      '</section>' +
      '<div class="hor-pie">' +
        '<button class="ds-btn ds-btn--primary" type="submit"' + (estado.guardando ? ' disabled' : '') + '>' +
          (estado.guardando ? 'Guardando…' : 'Guardar horario y entrega') + '</button>' +
        '<button class="ds-btn ds-btn--ghost" type="button" data-descartar>Descartar cambios</button>' +
        '<span class="hor-pie__nota">Los cambios se publican al guardar.</span>' +
      '</div>' +
    '</form>';
}

function avisar(caja, html) {
  estado.aviso = html;
  const cajaAviso = $('[data-aviso]', caja);
  if (cajaAviso) cajaAviso.innerHTML = html;
}

function sincronizarFilas(caja) {
  for (let i = 0; i < 7; i++) {
    const check = $('[data-abierto="' + i + '"]', caja);
    const fila = $('[data-fila="' + i + '"]', caja);
    const desde = $('[data-desde="' + i + '"]', caja);
    const hasta = $('[data-hasta="' + i + '"]', caja);
    if (!check || !fila) continue;
    fila.classList.toggle('hor-dia--cerrado', !check.checked);
    const etiqueta = $('.hor-dia__estado', fila);
    if (etiqueta) etiqueta.textContent = check.checked ? 'Abierto' : 'Cerrado';
    if (desde) desde.disabled = !check.checked;
    if (hasta) hasta.disabled = !check.checked;
  }
}

function sincronizarEnvio(caja) {
  const delivery = $$('[data-entrega]', caja).some((c) => c.value === 'delivery' && c.checked);
  const campo = $('[data-envio-campo]', caja);
  const input = $('[data-envio]', caja);
  if (campo) campo.classList.toggle('hor-campo--apagado', !delivery);
  if (input) input.disabled = !delivery;
}

/* ── guardar ─────────────────────────────────────────────────────────────── */

async function guardar(caja, ctx) {
  if (estado.guardando) return;
  const datos = leerFormulario(caja);

  const errores = validar(datos.dias);
  if (errores.length) {
    avisar(caja, '<div class="aviso aviso--err">' + errores.map((e) => esc(e.texto)).join('<br>') + '</div>');
    const primero = $('[data-fila="' + errores[0].i + '"]', caja);
    if (primero) primero.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  if (!datos.entrega.length) {
    avisar(caja, '<div class="aviso aviso--warn">Elige al menos una forma de entrega: retiro o delivery.</div>');
    return;
  }

  const horario = escribir(datos.dias);
  if (horario.length > MAX_TEXTO) {
    avisar(caja, '<div class="aviso aviso--err">El horario queda en ' + horario.length +
      ' caracteres y el máximo es ' + MAX_TEXTO + '. Acorta las franjas.</div>');
    return;
  }

  const campos = {
    horario,
    entrega: datos.entrega,
    minimo: datos.minimo,
    // Sin delivery no hay envío que cobrar: se guarda en 0 para que el
    // checkout no muestre un costo que nadie puede usar.
    envio: datos.entrega.includes('delivery') ? datos.envio : 0,
  };

  estado.guardando = true;
  const boton = $('button[type="submit"]', caja);
  if (boton) { boton.disabled = true; boton.textContent = 'Guardando…'; }

  try {
    await llamar('local_actualizar', { local_id: ctx.tienda.id, campos });
    estado.guardando = false;
    estado.sinHorario = false;
    ctx.fijar(campos);
    if (boton) { boton.disabled = false; boton.textContent = 'Guardar horario y entrega'; }
    if ($('[data-envio]', caja)) $('[data-envio]', caja).value = String(campos.envio);
    pintarResumen(caja, ctx.tienda.abierto !== false, false);
    avisar(caja, '<div class="aviso aviso--ok">Horario y entrega guardados. La ficha ya los muestra.</div>');
  } catch (fallo) {
    estado.guardando = false;
    if (boton) { boton.disabled = false; boton.textContent = 'Guardar horario y entrega'; }
    avisar(caja, '<div class="aviso aviso--err">' +
      esc(fallo && fallo.message ? fallo.message : 'No se pudo guardar. Revisa la conexión y reintenta.') + '</div>');
  }
}

async function cambiarEstado(caja, ctx) {
  const abierta = ctx.tienda.abierto !== false;
  const boton = $('[data-estado]', caja);
  if (boton) boton.disabled = true;
  try {
    const r = await llamar('local_estado', { local_id: ctx.tienda.id, abierto: !abierta });
    const nuevo = r.abierto !== false;
    ctx.fijar({ abierto: nuevo });
    if (boton) { boton.textContent = nuevo ? 'Cerrar ahora' : 'Abrir ahora'; boton.disabled = false; }
    pintarResumen(caja, nuevo, estado.sinHorario);
    avisar(caja, '<div class="aviso aviso--ok">' +
      (nuevo ? 'La tienda quedó abierta al público.' : 'La tienda quedó cerrada: el checkout no deja comprar.') + '</div>');
  } catch (fallo) {
    if (boton) boton.disabled = false;
    avisar(caja, '<div class="aviso aviso--err">' +
      esc(fallo && fallo.message ? fallo.message : 'No se pudo cambiar el estado de la tienda.') + '</div>');
  }
}

/* ── enganches ───────────────────────────────────────────────────────────── */

function enganchar(caja, ctx) {
  const form = $('[data-form]', caja);
  if (!form) return;

  form.addEventListener('input', (e) => {
    if (e.target && e.target.matches('[data-entrega]')) sincronizarEnvio(caja);
    if (e.target && e.target.matches('[data-abierto]')) sincronizarFilas(caja);
    pintarResumen(caja, ctx.tienda.abierto !== false, estado.sinHorario);
  });
  form.addEventListener('change', (e) => {
    if (e.target && e.target.matches('[data-entrega]')) sincronizarEnvio(caja);
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); guardar(caja, ctx); });

  $('[data-copiar]', caja)?.addEventListener('click', () => {
    const lunes = leerFormulario(caja).dias[0];
    for (let i = 1; i < 7; i++) {
      const check = $('[data-abierto="' + i + '"]', caja);
      const desde = $('[data-desde="' + i + '"]', caja);
      const hasta = $('[data-hasta="' + i + '"]', caja);
      if (check) check.checked = lunes.abierto;
      if (desde) desde.value = lunes.desde;
      if (hasta) hasta.value = lunes.hasta;
    }
    sincronizarFilas(caja);
    pintarResumen(caja, ctx.tienda.abierto !== false, estado.sinHorario);
    avisar(caja, '<div class="aviso aviso--acento">Se copió el lunes a los siete días. Revisa y guarda.</div>');
  });

  $('[data-cerrar-todo]', caja)?.addEventListener('click', () => {
    $$('[data-abierto]', caja).forEach((c) => { c.checked = false; });
    sincronizarFilas(caja);
    pintarResumen(caja, ctx.tienda.abierto !== false, estado.sinHorario);
    avisar(caja, '<div class="aviso aviso--warn">Quedaron los siete días cerrados. Guarda si es lo que quieres publicar.</div>');
  });

  $('[data-descartar]', caja)?.addEventListener('click', () => {
    estado.aviso = '';
    pintar(caja, ctx);
  });

  $('[data-estado]', caja)?.addEventListener('click', () => cambiarEstado(caja, ctx));

  sincronizarEnvio(caja);
  sincronizarFilas(caja);
}

function pintar(caja, ctx) {
  caja.innerHTML = pantalla(ctx);
  enganchar(caja, ctx);
}

arrancar({
  alListo(ctx) {
    estado.ctx = ctx;
    const caja = $('[data-negocio]');
    if (caja) pintar(caja, ctx);
  },
});
