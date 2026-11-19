/* C07 · Checkout
   Un solo pedido por tienda. El navegador manda la intención; el servidor
   vuelve a leer el catálogo, recalcula precio, envío y vuelto, y descuenta
   stock en una transacción. La `idempotencia` evita el pedido doble cuando
   la red se corta justo después de confirmar. */

import { mercado, mercadoPost, mensajeDeError } from '../../comun/api.js';
import { grupos, vaciarTienda, aplicarCatalogo } from '../../comun/carrito.js';
import { guardarPedido } from '../../comun/pedidos.js';
import { leerLocales as leerDirecciones, listar as listarDirecciones } from '../../comun/direcciones.js';
import { clp, esc, iniciales } from '../../comun/formato.js';
import { leer as leerSesion, token, dispositivo } from '../../comun/sesion.js';

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);
const CLAVE_CLIENTE = 'fcore.placer.cliente';

const estado = {
  grupo: null,
  tienda: null,
  enviando: false,
  listo: false,
  idem: '',
  entrega: 'retiro',
  pago: 'efectivo',
  error: '',
  dirs: [],
};

function leerCliente() {
  try {
    const d = JSON.parse(localStorage.getItem(CLAVE_CLIENTE) || 'null');
    return d && typeof d === 'object' ? d : {};
  } catch (_) { return {}; }
}

function guardarCliente(datos) {
  try { localStorage.setItem(CLAVE_CLIENTE, JSON.stringify(datos)); } catch (_) { /* modo privado */ }
}

function idempotencia(localId) {
  const clave = 'fcore.panel.idem.' + localId;
  try {
    const previa = sessionStorage.getItem(clave);
    if (previa && /^[A-Za-z0-9_-]{8,80}$/.test(previa)) return previa;
    const nueva = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID().replace(/-/g, '')
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
    sessionStorage.setItem(clave, nueva);
    return nueva;
  } catch (_) {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }
}

function olvidarIdempotencia(localId) {
  try { sessionStorage.removeItem('fcore.panel.idem.' + localId); } catch (_) { /* nada */ }
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

function logo(t) {
  if (t.logo) return '<span class="logo-tienda"><img src="' + esc(t.logo) + '" alt=""></span>';
  return '<span class="logo-tienda" aria-hidden="true">' + esc(iniciales(t.nombre)) + '</span>';
}

function botonesDirecciones(lista) {
  const l = Array.isArray(lista) ? lista.slice(0, 6) : [];
  if (!l.length) return '';
  return '<span class="dirs-guardadas__rotulo">Usar una guardada</span>' +
    '<div class="dirs-guardadas__lista">' +
      l.map((d) => '<button class="ds-chip" type="button" data-dir-guardada="' + esc(d.id) + '">' +
        esc(d.alias || 'Dirección') + ' · ' + esc(d.direccion || '') + '</button>').join('') +
    '</div>';
}

async function cargarDireccionesGuardadas() {
  estado.dirs = leerDirecciones();
  const caja = $('[data-dirs]');
  if (caja) caja.innerHTML = botonesDirecciones(estado.dirs);
  try {
    const r = await listarDirecciones();
    estado.dirs = r.direcciones || estado.dirs;
    const actual = $('[data-dirs]');
    if (actual) actual.innerHTML = botonesDirecciones(estado.dirs);
  } catch (_) { /* sin nube quedan las locales */ }
}

function subtotal() {
  return estado.grupo.items.reduce((a, it) => a + it.precio * it.cantidad, 0);
}

function envio() {
  if (!estado.tienda) return 0;
  return estado.entrega === 'delivery' ? Number(estado.tienda.envio) || 0 : 0;
}

function total() {
  return subtotal() + envio();
}

function ahorro() {
  return estado.grupo.items.reduce((a, it) => a + Math.max(0, (Number(it.lista) || it.precio) - it.precio) * it.cantidad, 0);
}

function soloRetiro() {
  const e = estado.tienda && Array.isArray(estado.tienda.entrega) ? estado.tienda.entrega : ['retiro'];
  return !e.includes('delivery');
}

function pasosHtml() {
  const t = estado.tienda;
  const cli = leerCliente();
  const usuario = leerSesion();
  const nombre = cli.nombre || (usuario && usuario.usuario && usuario.usuario.nombre) || '';
  const telefono = cli.telefono || '';
  const direccion = cli.direccion || '';
  const comuna = cli.comuna || t.comuna || '';
  const referencia = cli.referencia || '';
  const nota = cli.nota || '';
  const retiro = soloRetiro();
  const entrega = estado.entrega;
  const pago = estado.pago;

  return '<div class="checkout">' +
    '<form class="pasos" novalidate data-form>' +

      // ── 1. contacto ───────────────────────────────────────────────────
      '<section class="paso" data-activo="true" aria-labelledby="paso1">' +
        '<span class="paso__num" aria-hidden="true">1</span>' +
        '<h2 class="paso__titulo" id="paso1">¿Quién recibe?</h2>' +
        '<p class="paso__nota">El local usa estos datos para preparar y avisar el pedido. No se muestran en público.</p>' +
        '<div class="campos">' +
          '<div class="campo campo--ancho"><label for="f-nombre">Nombre</label>' +
            '<input id="f-nombre" name="nombre" type="text" autocomplete="name" value="' + esc(nombre) + '" required minlength="2" placeholder="Nombre y apellido"></div>' +
          '<div class="campo"><label for="f-tel">Teléfono</label>' +
            '<input id="f-tel" name="telefono" type="tel" inputmode="tel" autocomplete="tel" value="' + esc(telefono) + '" required placeholder="9 1234 5678"></div>' +
          '<div class="campo"><label for="f-nota">Nota para el local <span style="font-weight:400;text-transform:none;letter-spacing:0">(opcional)</span></label>' +
            '<input id="f-nota" name="nota" type="text" maxlength="300" value="' + esc(nota) + '" placeholder="Ej: tocar el timbre dos veces"></div>' +
        '</div>' +
      '</section>' +

      // ── 2. entrega ────────────────────────────────────────────────────
      '<section class="paso" aria-labelledby="paso2">' +
        '<span class="paso__num" aria-hidden="true">2</span>' +
        '<h2 class="paso__titulo" id="paso2">¿Cómo lo recibes?</h2>' +
        '<p class="paso__nota">' + (retiro
          ? 'Esta tienda sólo ofrece retiro en el local.'
          : 'El costo de envío lo fija la tienda y se suma al total.') + '</p>' +
        '<div class="opciones">' +
          '<label class="opcion"><input type="radio" name="entrega" value="retiro"' + (entrega === 'retiro' ? ' checked' : '') + '>' +
            '<span class="opcion__cuerpo"><b>Retiro en la tienda</b><small>' + esc(t.direccion || t.comuna || 'Dirección del local') + '</small></span></label>' +
          '<label class="opcion"' + (retiro ? ' style="opacity:.55"' : '') + '><input type="radio" name="entrega" value="delivery"' +
            (entrega === 'delivery' ? ' checked' : '') + (retiro ? ' disabled' : '') + '>' +
            '<span class="opcion__cuerpo"><b>Delivery</b><small>' +
              (retiro ? 'no disponible en esta tienda' : (Number(t.envio) > 0 ? clp(t.envio) + ' de envío' : 'envío gratis')) +
            '</small></span></label>' +
        '</div>' +
        '<div class="pago-detalle" data-dir' + (entrega === 'delivery' ? '' : ' hidden') + '>' +
          '<div class="dirs-guardadas" data-dirs></div>' +
          '<div class="campos">' +
            '<div class="campo campo--ancho"><label for="f-dir">Calle y número</label>' +
              '<input id="f-dir" name="direccion" type="text" autocomplete="street-address" value="' + esc(direccion) + '" placeholder="Ej: Av. Condell 1234, depto 5"></div>' +
            '<div class="campo"><label for="f-comuna">Comuna</label>' +
              '<input id="f-comuna" name="comuna" type="text" autocomplete="address-level2" value="' + esc(comuna) + '" placeholder="Rengo"></div>' +
            '<div class="campo"><label for="f-ref">Referencia</label>' +
              '<input id="f-ref" name="referencia" type="text" maxlength="160" value="' + esc(referencia) + '" placeholder="Frente a la plaza"></div>' +
          '</div>' +
        '</div>' +
      '</section>' +

      // ── 3. pago ───────────────────────────────────────────────────────
      '<section class="paso" aria-labelledby="paso3">' +
        '<span class="paso__num" aria-hidden="true">3</span>' +
        '<h2 class="paso__titulo" id="paso3">¿Cómo pagas?</h2>' +
        '<p class="paso__nota">El pago se coordina al recibir. Tarjeta es demostrativa: no mueve dinero real.</p>' +
        '<div class="opciones opciones--pago">' +
          '<label class="opcion"><input type="radio" name="pago" value="efectivo"' + (pago === 'efectivo' ? ' checked' : '') + '>' +
            '<span class="opcion__cuerpo"><b>Efectivo</b><small>con vuelto</small></span></label>' +
          '<label class="opcion"><input type="radio" name="pago" value="transferencia"' + (pago === 'transferencia' ? ' checked' : '') + '>' +
            '<span class="opcion__cuerpo"><b>Transferencia</b><small>datos del local</small></span></label>' +
          '<label class="opcion"><input type="radio" name="pago" value="tarjeta"' + (pago === 'tarjeta' ? ' checked' : '') + '>' +
            '<span class="opcion__cuerpo"><b>Tarjeta <span class="pill">demo</span></b><small>sin cobro real</small></span></label>' +
        '</div>' +
        '<div class="pago-detalle" data-efectivo' + (pago === 'efectivo' ? '' : ' hidden') + '>' +
          '<div class="campo"><label for="f-pago">¿Con cuánto pagas?</label>' +
            '<input id="f-pago" name="pago_con" type="number" inputmode="numeric" min="0" step="100" value="' + esc(cli.pago_con || '') + '" placeholder="' + Math.ceil(total() / 100) * 100 + '"></div>' +
          '<div class="vuelto" data-vuelto><span>Vuelto</span><b>' + clp(0) + '</b></div>' +
        '</div>' +
      '</section>' +

      '<p class="resumen__legal" style="padding:0 4px">Al confirmar aceptas los <a href="/terminos.html">términos</a> y que el local te contacte por el pedido. El precio final lo calcula el servidor con el catálogo vigente.</p>' +
    '</form>' +

    '<aside class="resumen" aria-label="Resumen del pedido">' +
      '<div class="resumen__cabeza">' + logo(t) +
        '<div class="crece"><b>' + esc(t.nombre) + '</b><small>' + esc(t.rubro || 'Tienda') + ' · ' +
          (t.abierto !== false ? 'abierta' : 'cerrada') + '</small></div></div>' +
      '<div class="resumen__items">' + estado.grupo.items.map((it) =>
        '<div class="resumen__item"><span class="resumen__cant">' + it.cantidad + '</span>' +
          '<span>' + esc(it.nombre) + '</span><b>' + clp(it.precio * it.cantidad) + '</b></div>').join('') +
      '</div>' +
      '<div class="resumen__totales">' +
        '<div class="resumen__linea"><span>Subtotal</span><b>' + clp(subtotal()) + '</b></div>' +
        (ahorro() > 0 ? '<div class="resumen__linea resumen__linea--ahorro"><span>Ahorro</span><b>−' + clp(ahorro()) + '</b></div>' : '') +
        '<div class="resumen__linea"><span>Envío</span><b>' + (envio() ? clp(envio()) : 'retiro') + '</b></div>' +
        '<div class="resumen__linea resumen__linea--total"><span>Total</span><b data-total>' + clp(total()) + '</b></div>' +
      '</div>' +
      '<div class="resumen__cta">' +
        '<button class="ds-btn ds-btn--lg" type="button" data-confirmar' + (estado.enviando ? ' disabled' : '') + '>' +
          (estado.enviando ? 'Enviando…' : 'Confirmar pedido · ' + clp(total())) + '</button>' +
        '<a class="ds-btn ds-btn--ghost" href="/panel/cliente/carrito/">Volver al carrito</a>' +
      '</div>' +
      '<p class="resumen__legal">Si el local está cerrado o falta stock, el servidor rechaza el pedido y no se descuenta nada.</p>' +
    '</aside></div>';
}

function refrescarResumen() {
  const t = $('[data-total]');
  if (t) t.textContent = clp(total());
  const b = $('[data-confirmar]');
  if (b && !estado.enviando) b.textContent = 'Confirmar pedido · ' + clp(total());
}

function refrescarVuelto() {
  const caja = $('[data-vuelto]');
  if (!caja) return;
  const input = $('#f-pago');
  const dado = Number(input && input.value) || 0;
  // Sin monto escrito no hay nada que reclamar: el recuadro aparece al
  // escribir. Si no, la primera pantalla parecía un error del comprador.
  caja.hidden = dado <= 0;
  if (dado <= 0) {
    caja.classList.remove('vuelto--mal');
    return;
  }
  const falta = total() - dado;
  const b = caja.querySelector('b');
  if (falta > 0) {
    caja.classList.add('vuelto--mal');
    caja.firstElementChild.textContent = 'Falta';
    b.textContent = clp(falta);
  } else {
    caja.classList.remove('vuelto--mal');
    caja.firstElementChild.textContent = 'Vuelto';
    b.textContent = clp(dado - total());
  }
}

function marcarError(campo, mensaje) {
  if (!campo) return;
  campo.setAttribute('aria-invalid', 'true');
  campo.style.borderColor = 'var(--ds-err)';
  const previo = campo.parentElement.querySelector('.error-campo');
  if (previo) previo.remove();
  const p = document.createElement('small');
  p.className = 'error-campo';
  p.textContent = mensaje;
  campo.parentElement.appendChild(p);
}

function limpiarErrores() {
  document.querySelectorAll('[aria-invalid]').forEach((el) => {
    el.removeAttribute('aria-invalid');
    el.style.borderColor = '';
  });
  document.querySelectorAll('.error-campo').forEach((el) => el.remove());
}

function validar() {
  limpiarErrores();
  const nombre = $('#f-nombre');
  const tel = $('#f-tel');
  let primero = null;
  const fallo = (campo, msg) => { marcarError(campo, msg); if (!primero) primero = campo; };

  if (!nombre || nombre.value.trim().length < 2) fallo(nombre, 'Escribe tu nombre.');
  const digitos = String(tel && tel.value || '').replace(/\D/g, '');
  if (digitos.length < 8) fallo(tel, 'Necesitamos un teléfono para avisarte del pedido.');

  if (estado.entrega === 'delivery') {
    const dir = $('#f-dir');
    const comuna = $('#f-comuna');
    if (!dir || dir.value.trim().length < 5) fallo(dir, 'Falta la calle y el número.');
    if (!comuna || comuna.value.trim().length < 2) fallo(comuna, 'Falta la comuna.');
  }

  if (estado.pago === 'efectivo') {
    const pago = $('#f-pago');
    if ((Number(pago && pago.value) || 0) < total()) {
      fallo(pago, 'El efectivo no alcanza para el total (' + clp(total()) + ').');
    }
  }

  if (primero) {
    primero.focus({ preventScroll: true });
    primero.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  return !primero;
}

async function confirmar() {
  if (estado.enviando) return;
  if (!validar()) {
    aviso('Revisa los campos marcados antes de confirmar.', 'warn');
    return;
  }
  aviso('');
  estado.enviando = true;
  const boton = $('[data-confirmar]');
  if (boton) { boton.disabled = true; boton.textContent = 'Enviando…'; }

  const nombre = $('#f-nombre').value.trim();
  const telefono = $('#f-tel').value.trim();
  const nota = $('#f-nota') ? $('#f-nota').value.trim() : '';
  const direccion = estado.entrega === 'delivery' && $('#f-dir') ? $('#f-dir').value.trim() : '';
  const comuna = estado.entrega === 'delivery' && $('#f-comuna') ? $('#f-comuna').value.trim() : '';
  const referencia = estado.entrega === 'delivery' && $('#f-ref') ? $('#f-ref').value.trim() : '';
  const pagoCon = estado.pago === 'efectivo' ? (Number($('#f-pago').value) || 0) : 0;

  // Los datos se recuerdan para la próxima compra; si el pedido falla, el
  // comprador no tiene que reescribirlos.
  guardarCliente(Object.assign(leerCliente(), {
    nombre, telefono, nota,
    direccion: direccion || (leerCliente().direccion || ''),
    comuna: comuna || (leerCliente().comuna || ''),
    referencia: referencia || (leerCliente().referencia || ''),
    pago: estado.pago,
    modo: estado.entrega,
    pago_con: pagoCon,
  }));

  const cuerpo = {
    local_id: estado.grupo.id,
    idempotencia: estado.idem,
    cliente: nombre,
    telefono,
    entrega: estado.entrega,
    metodo_pago: estado.pago,
    pago_con: pagoCon,
    nota,
    items: estado.grupo.items.map((it) => ({
      sku: it.sku,
      nombre: it.nombre,
      precio: it.precio,
      cantidad: it.cantidad,
      categoria: '',
      unidad: '',
    })),
  };
  if (estado.entrega === 'delivery') {
    cuerpo.direccion = direccion;
    cuerpo.comuna_entrega = comuna;
    cuerpo.referencia_entrega = referencia;
  }

  try {
    // Con cuenta, el pedido queda ligado a ella para «Mis pedidos»; sin
    // cuenta el servidor lo crea igual y se abre con el enlace de siempre.
    const d = await mercadoPost('pedido_crear', cuerpo, {
      ms: 22000,
      token: token(),
      dispositivo: dispositivo(),
    });
    estado.listo = true;
    olvidarIdempotencia(estado.grupo.id);
    guardarPedido({
      codigo: d.codigo,
      fecha: Date.now(),
      local: { id: estado.grupo.id, nombre: estado.grupo.nombre },
      items: estado.grupo.items.map((x) => ({ nombre: x.nombre, precio: x.precio, cantidad: x.cantidad })),
      subtotal: d.subtotal,
      envio: d.envio,
      total: d.total,
      metodo: d.metodo_pago || estado.pago,
      pago_con: d.pago_con || pagoCon,
      vuelto: d.vuelto || 0,
      entrega: estado.entrega,
      direccion, comuna, referencia,
      cliente: { nombre, telefono },
      estado: d.estado || 'nuevo',
      seguimiento: d.seguimiento || '',
      token: d.seguimiento || '',
    });
    vaciarTienda(estado.grupo.id);
    exito(d);
  } catch (e) {
    estado.enviando = false;
    if (boton) { boton.disabled = false; boton.textContent = 'Confirmar pedido · ' + clp(total()); }
    const codigo = (e && e.codigo) || '';
    const datos = (e && e.datos) || {};
    let mensaje = e.message || mensajeDeError(e);
    let tipo = 'err';
    let extra = '';

    if (codigo === 'BAJO_MINIMO') {
      mensaje = 'El pedido no llega al mínimo de ' + clp(datos.minimo || 0) + ': suma ' + clp(datos.subtotal || subtotal()) + '.';
      extra = '<a href="/panel/cliente/tienda/?id=' + encodeURIComponent(estado.grupo.id) + '" style="color:inherit;text-decoration:underline">Agregar más productos</a>';
    } else if (codigo === 'CERRADO') {
      mensaje = 'La tienda cerró mientras armabas el pedido. No se creó nada: vuelve cuando abra.';
    } else if (codigo === 'PAGO_CORTO') {
      mensaje = 'El efectivo no alcanza: faltan ' + clp(datos.faltan || 0) + '. Ajusta el monto o elige otro medio.';
      const pago = $('#f-pago');
      if (pago) { pago.focus(); pago.select(); }
    } else if (codigo === 'SIN_STOCK') {
      mensaje = datos.error || 'Un producto se agotó mientras confirmabas.';
      extra = '<a href="/panel/cliente/carrito/" style="color:inherit;text-decoration:underline">Revisar el carrito</a>';
      aplicarCatalogo(estado.grupo.id, estado.tienda);
    } else if (codigo === 'SIN_DIRECCION' || codigo === 'SIN_COMUNA') {
      estado.entrega = 'delivery';
      mensaje = datos.error || 'Falta la dirección de entrega.';
    } else if (codigo === 'SIN_NOMBRE' || codigo === 'SIN_TELEFONO') {
      mensaje = datos.error || 'Faltan tus datos de contacto.';
    } else if (codigo === 'NO_CATALOGO' || codigo === 'NO_ENCONTRADO') {
      mensaje = 'La tienda o su catálogo cambiaron. Vuelve al carrito para revisar.';
      extra = '<a href="/panel/cliente/carrito/" style="color:inherit;text-decoration:underline">Volver al carrito</a>';
    } else if (codigo === 'SIN_RED') {
      mensaje = 'No pudimos confirmar si el pedido se creó. Vuelve a intentar: la misma clave evita duplicarlo.';
      tipo = 'warn';
    }
    aviso(esc(mensaje) + (extra ? ' ' + extra : ''), tipo);
  }
}

function exito(d) {
  const caja = $('[data-checkout]');
  if (!caja) return;
  aviso('');
  caja.innerHTML = '<div class="exito">' +
    '<div class="exito__ico"><svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg></div>' +
    '<h1>Pedido enviado</h1>' +
    '<p>' + esc(estado.grupo.nombre) + ' ya recibió tu pedido. Guárdalo con este código:</p>' +
    '<div class="exito__codigo">' + esc(d.codigo) + '</div>' +
    (d.vuelto > 0 ? '<p>Prepara <b>' + clp(d.vuelto) + '</b> de vuelto.</p>' : '') +
    (d.clave_entrega ? '<p>Clave de entrega: <b>' + esc(d.clave_entrega) + '</b></p>' : '') +
    '<div class="exito__acciones">' +
      (d.seguimiento
        ? '<a class="ds-btn ds-btn--lg" href="/panel/cliente/pedido/?token=' + encodeURIComponent(d.seguimiento) + '">Seguir el pedido</a>'
        : '<a class="ds-btn ds-btn--lg" href="/panel/cliente/pedido/?codigo=' + encodeURIComponent(d.codigo) + '">Ver el pedido</a>') +
      '<a class="ds-btn ds-btn--ghost" href="/panel/cliente/inicio/">Volver al inicio</a>' +
    '</div>' +
    '<p style="margin-top:16px;font-size:11px">También lo guardamos en este navegador y te avisaremos si activas las notificaciones en el seguimiento.</p>' +
  '</div>';
}

function errorFatal(titulo, detalle, accion) {
  const caja = $('[data-checkout]');
  if (!caja) return;
  caja.innerHTML = '<div class="ds-error">' +
    '<div class="ds-error__title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">' +
    '<path d="M12 9v4M12 17h.01"/><path d="M10.3 4.2 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/></svg>' +
    esc(titulo) + '</div><div class="ds-error__text">' + esc(detalle) + '</div>' +
    '<div class="ds-error__action">' + accion + '</div></div>';
}

function montar() {
  const form = $('[data-form]');
  if (!form) return;

  form.addEventListener('change', (e) => {
    if (e.target.name === 'entrega') {
      estado.entrega = e.target.value;
      const dir = $('[data-dir]');
      if (dir) dir.hidden = estado.entrega !== 'delivery';
      refrescarResumen();
      refrescarVuelto();
    }
    if (e.target.name === 'pago') {
      estado.pago = e.target.value;
      const caja = $('[data-efectivo]');
      if (caja) caja.hidden = estado.pago !== 'efectivo';
      refrescarVuelto();
    }
  });

  form.addEventListener('input', (e) => {
    if (e.target.name === 'pago_con') refrescarVuelto();
  });

  // Una dirección guardada rellena los tres campos; el comprador puede
  // corregirla antes de confirmar y no se guarda nada nuevo sin pedirlo.
  form.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-dir-guardada]');
    if (!chip) return;
    const d = (estado.dirs || []).find((x) => x.id === chip.dataset.dirGuardada);
    if (!d) return;
    const dir = $('#f-dir');
    const comuna = $('#f-comuna');
    const ref = $('#f-ref');
    if (dir) dir.value = d.direccion || '';
    if (comuna) comuna.value = d.comuna || '';
    if (ref) ref.value = d.referencia || '';
    form.querySelectorAll('[data-dir-guardada]').forEach((b) => {
      b.classList.toggle('is-active', b === chip);
      b.setAttribute('aria-pressed', b === chip ? 'true' : 'false');
    });
    const primera = $('#f-dir');
    if (primera) primera.focus();
  });

  form.addEventListener('submit', (e) => { e.preventDefault(); confirmar(); });
  const b = $('[data-confirmar]');
  if (b) b.addEventListener('click', confirmar);
}

async function cargar() {
  const localId = params.get('local') || '';
  const lista = grupos();
  if (!lista.length) {
    errorFatal('No hay nada que pagar', 'Tu carrito está vacío: agrega productos antes de confirmar un pedido.',
      '<a class="ds-btn ds-btn--sm" href="/panel/cliente/buscar/">Buscar productos</a>');
    return;
  }
  const grupo = lista.find((g) => g.id === localId) || lista[0];
  estado.grupo = grupo;
  estado.idem = idempotencia(grupo.id);

  try {
    const d = await mercado('local_ver', { id: grupo.id });
    estado.tienda = d.tienda;
    // Si el carrito quedó viejo, se corrige antes de mostrar totales.
    const r = aplicarCatalogo(grupo.id, d.tienda);
    if (r.cambiadas || r.quitadas) {
      aviso('Actualizamos tu carrito con el catálogo vigente: ' +
        (r.cambiadas || 0) + ' precio(s) y ' + (r.quitadas || 0) + ' producto(s) fuera.', 'warn');
      const nuevo = grupos().find((g) => g.id === grupo.id);
      if (!nuevo) {
        errorFatal('Tu carrito quedó vacío', 'Los productos de esta tienda ya no están disponibles.',
          '<a class="ds-btn ds-btn--sm" href="/panel/cliente/carrito/">Volver al carrito</a>');
        return;
      }
      estado.grupo = nuevo;
    }
    if (d.tienda.abierto === false) {
      errorFatal('La tienda está cerrada', 'Puedes revisar el carrito, pero no confirmar el pedido hasta que abra.',
        '<a class="ds-btn ds-btn--sm" href="/panel/cliente/carrito/">Volver al carrito</a>');
      return;
    }
    estado.entrega = soloRetiro() ? 'retiro' : 'retiro';
    if (!soloRetiro() && leerCliente().modo === 'delivery') estado.entrega = 'delivery';
    estado.pago = leerCliente().pago === 'transferencia' || leerCliente().pago === 'tarjeta'
      ? leerCliente().pago
      : 'efectivo';
    const caja = $('[data-checkout]');
    caja.innerHTML = pasosHtml();
    montar();
    refrescarVuelto();
    refrescarResumen();
    // Primero el espejo local (instantáneo) y después la nube si hay cuenta.
    cargarDireccionesGuardadas();
  } catch (e) {
    errorFatal('No pudimos abrir el checkout',
      e && e.codigo === 'NO_ENCONTRADO'
        ? 'La tienda dejó de estar publicada. Vuelve al carrito para revisar.'
        : mensajeDeError(e),
      '<a class="ds-btn ds-btn--sm" href="/panel/cliente/carrito/">Volver al carrito</a>');
  }
}

cargar();
