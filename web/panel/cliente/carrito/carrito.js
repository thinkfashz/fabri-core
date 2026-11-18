/* C06 · Carrito
   Revalida CADA tienda contra `local_ver` (máx. 4 en paralelo) y no deja
   avanzar un grupo que no cumpla el mínimo o tenga un producto agotado.
   Nunca se cobra acá: el precio definitivo lo calcula `pedido_crear`. */

import { mercado, mensajeDeError } from '../../comun/api.js';
import {
  grupos, comparar, aplicarCatalogo, cambiar, quitar, suscribir,
} from '../../comun/carrito.js';
import { clp, esc, iniciales } from '../../comun/formato.js';

const $ = (sel) => document.querySelector(sel);
const estado = {
  grupos: [],
  tiendas: new Map(),   // id → tienda | { error }
  revisado: false,
  aviso: '',
};

const MAX_PARALELO = 4;

function aviso(html, tipo) {
  const caja = $('[data-aviso]');
  if (!caja) return;
  caja.innerHTML = html
    ? '<div class="aviso aviso--' + (tipo || 'warn') + '"><svg viewBox="0 0 24 24">' +
      '<path d="M12 9v4M12 17h.01"/><path d="M10.3 4.2 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/></svg>' +
      '<span>' + html + '</span></div>'
    : '';
}

function logo(g) {
  if (g.logo) return '<span class="logo-tienda"><img src="' + esc(g.logo) + '" alt=""></span>';
  return '<span class="logo-tienda" aria-hidden="true">' + esc(iniciales(g.nombre)) + '</span>';
}

function lineaHtml(g, it) {
  const fuera = it.estado === 'borrado';
  const cambio = it.estado === 'precio' || it.estado === 'stock' || it.estado === 'agotado';
  const precio = it.precioActual != null ? it.precioActual : it.precio;
  const etiquetas = [];
  if (fuera) etiquetas.push('<span class="pill pill--err">ya no está</span>');
  if (it.estado === 'agotado') etiquetas.push('<span class="pill pill--err">agotado</span>');
  if (it.estado === 'stock') etiquetas.push('<span class="pill pill--warn">quedan ' + it.stock + '</span>');
  if (it.estado === 'precio') {
    etiquetas.push('<span class="pill pill--warn">antes ' + clp(it.precio) + '</span>');
  }
  if (it.estado === 'sin-datos') etiquetas.push('<span class="pill">sin verificar</span>');

  return '<div class="linea' + (cambio ? ' linea--cambio' : '') + (fuera ? ' linea--fuera' : '') + '" data-linea="' +
      esc(g.id) + '|' + esc(it.pid) + '">' +
    (it.imagenActual || it.imagen
      ? '<span class="mini"><img src="' + esc(it.imagenActual || it.imagen) + '" alt="" loading="lazy"></span>'
      : '<span class="mini" aria-hidden="true">' + esc(iniciales(it.nombre)) + '</span>') +
    '<div class="linea__cuerpo">' +
      '<div class="linea__nombre">' + esc(it.nombre) + '</div>' +
      '<div class="linea__meta">' +
        (fuera ? '' :
          '<span class="qty" data-qty>' +
            '<button type="button" data-menos aria-label="Quitar uno de ' + esc(it.nombre) + '">−</button>' +
            '<output>' + it.cantidad + '</output>' +
            '<button type="button" data-mas aria-label="Agregar uno de ' + esc(it.nombre) + '">+</button>' +
          '</span>') +
        etiquetas.join(' ') +
      '</div>' +
    '</div>' +
    '<div class="linea__precio">' +
      '<b>' + clp(precio * (fuera ? 1 : it.cantidad)) + '</b>' +
      (it.cantidad > 1 ? '<small>' + clp(precio) + ' c/u</small>' : '') +
    '</div>' +
    '<button class="linea__quitar" type="button" data-quitar aria-label="Quitar ' + esc(it.nombre) + ' del carrito">' +
      '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg></button>' +
  '</div>';
}

function totales(g, lineas) {
  const vivas = lineas.filter((l) => l.estado !== 'borrado');
  const subtotal = vivas.reduce((a, l) => a + (l.precioActual != null ? l.precioActual : l.precio) * l.cantidad, 0);
  const ahorro = vivas.reduce((a, l) => {
    const p = l.precioActual != null ? l.precioActual : l.precio;
    return a + Math.max(0, (Number(l.lista) || p) - p) * l.cantidad;
  }, 0);
  const t = estado.tiendas.get(g.id);
  const tienda = t && !t.error ? t : null;
  const abierta = tienda ? tienda.abierto !== false : g.abierto;
  const minimo = tienda ? Number(tienda.minimo) || 0 : g.minimo;
  const entrega = tienda && Array.isArray(tienda.entrega) ? tienda.entrega : g.entrega;
  const envio = tienda ? Number(tienda.envio) || 0 : g.envio;
  const falta = Math.max(0, minimo - subtotal);
  const conProblema = lineas.some((l) => l.estado === 'borrado' || l.estado === 'agotado');
  const cambió = lineas.some((l) => l.estado === 'precio' || l.estado === 'stock');
  return {
    items: vivas.reduce((a, l) => a + l.cantidad, 0),
    subtotal, ahorro, minimo, entrega, envio, falta, abierta,
    conProblema, cambió,
    puede: abierta && falta <= 0 && !conProblema && !cambió && vivas.length > 0,
    motivo: !tienda
      ? (t && t.error ? t.error : 'no pudimos verificar esta tienda')
      : !abierta ? 'la tienda está cerrada'
      : conProblema ? 'hay productos que ya no están disponibles'
      : cambió ? 'cambió el precio o el stock: actualiza para continuar'
      : falta > 0 ? 'faltan ' + clp(falta) + ' para el mínimo'
      : '',
  };
}

function grupoHtml(g) {
  const t = estado.tiendas.get(g.id);
  const tienda = t && !t.error ? t : null;
  const lineas = comparar(g, tienda);
  const c = totales(g, lineas);
  const enlaceTienda = '/panel/cliente/tienda/?id=' + encodeURIComponent(g.id);

  const avisos = [];
  if (t && t.error) avisos.push('<div class="aviso aviso--err" style="margin:10px 16px"><svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><path d="M10.3 4.2 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/></svg><span>' + esc(t.error) + '</span></div>');
  else if (!c.abierta) avisos.push('<div class="aviso aviso--err" style="margin:10px 16px"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><span>La tienda está cerrada: puedes revisar el carrito, pero no confirmar el pedido.</span></div>');
  if (c.cambió) avisos.push('<div class="aviso aviso--warn" style="margin:10px 16px"><svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><path d="M10.3 4.2 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/></svg><span>El precio o el stock cambiaron desde que agregaste. Revisa y actualiza.</span></div>');
  if (c.falta > 0) avisos.push('<div class="aviso aviso--warn" style="margin:10px 16px"><svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><path d="M10.3 4.2 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/></svg><span>Faltan <b>' + clp(c.falta) + '</b> para el mínimo de ' + clp(c.minimo) + '.</span></div>');

  return '<section class="grupo' + (c.falta > 0 || c.cambió ? ' grupo--alerta' : '') +
      (c.abierta ? '' : ' grupo--cerrada') + '" aria-labelledby="g-' + esc(g.id) + '">' +
    '<header class="grupo__cabeza">' + logo(g) +
      '<div class="grupo__id"><div class="grupo__nombre" id="g-' + esc(g.id) + '">' +
        '<a href="' + enlaceTienda + '">' + esc(g.nombre) + '</a></div>' +
        '<div class="grupo__meta">' + esc(g.rubro || 'Tienda') + ' · ' +
          (c.abierta ? 'abierta' : 'cerrada') + ' · mínimo ' +
          (c.minimo > 0 ? clp(c.minimo) : 'sin mínimo') + '</div></div>' +
      '<a class="ds-btn ds-btn--ghost ds-btn--sm" href="' + enlaceTienda + '">Ver tienda</a>' +
    '</header>' +
    avisos.join('') +
    lineas.map((it) => lineaHtml(g, it)).join('') +
    '<footer class="grupo__pie">' +
      '<div class="grupo__subtotal"><small>Subtotal ' + c.items + ' producto' + (c.items === 1 ? '' : 's') + '</small>' +
        '<b>' + clp(c.subtotal) + '</b></div>' +
      (c.puede
        ? '<a class="ds-btn" href="/panel/cliente/checkout/?local=' + encodeURIComponent(g.id) + '">Continuar</a>'
        : '<span class="grupo__falta">' + esc(c.motivo) + '</span>' +
          (c.cambió
            ? '<button class="ds-btn ds-btn--secondary ds-btn--sm" type="button" data-actualizar="' +
              esc(g.id) + '">Actualizar este pedido</button>'
            : '')) +
    '</footer></section>';
}

function resumenHtml() {
  let subtotal = 0, ahorro = 0, envios = 0, n = 0, minFaltante = 0;
  const detalle = [];
  for (const g of estado.grupos) {
    const t = estado.tiendas.get(g.id);
    const tienda = t && !t.error ? t : null;
    const c = totales(g, comparar(g, tienda));
    subtotal += c.subtotal;
    ahorro += c.ahorro;
    n += c.items;
    if (minFaltante === 0) minFaltante = c.falta;
    const envioGrupo = c.entrega.includes('delivery') ? c.envio : 0;
    envios += envioGrupo;
    detalle.push({ nombre: g.nombre, subtotal: c.subtotal, envio: envioGrupo, puede: c.puede, motivo: c.motivo, id: g.id });
  }
  const total = subtotal + envios;
  const listos = detalle.filter((d) => d.puede);
  const todoListo = estado.grupos.length > 0 && listos.length === estado.grupos.length;

  return '<aside class="resumen" aria-label="Resumen del carrito">' +
    '<div class="resumen__titulo">Resumen</div>' +
    detalle.map((d) => '<div class="resumen__linea"><span>' + esc(d.nombre) + '</span><b>' + clp(d.subtotal) + '</b></div>').join('') +
    '<div class="resumen__linea"><span>Productos</span><b>' + n + '</b></div>' +
    (ahorro > 0 ? '<div class="resumen__linea resumen__linea--ahorro"><span>Ahorro por ofertas</span><b>−' + clp(ahorro) + '</b></div>' : '') +
    '<div class="resumen__linea"><span>Envío estimado</span><b>' + (envios ? clp(envios) : 'por confirmar') + '</b></div>' +
    '<div class="resumen__linea resumen__linea--total"><span>Total estimado</span><b>' + clp(total) + '</b></div>' +
    '<p class="resumen__nota">El envío y el total final los calcula el servidor al crear cada pedido. Si eliges retiro, el envío es $0.</p>' +
    '<div class="resumen__cta">' +
      (todoListo
        ? '<a class="ds-btn ds-btn--lg" href="/panel/cliente/checkout/?local=' + encodeURIComponent(estado.grupos[0].id) + '">Ir al checkout</a>'
        : '<button class="ds-btn ds-btn--lg" type="button" disabled>Ir al checkout</button>') +
      (estado.grupos.length > 1
        ? '<span class="resumen__nota">Tienes ' + estado.grupos.length + ' tiendas: se paga y se entrega una por una.</span>'
        : '') +
    '</div></aside>';
}

function pintar() {
  const caja = $('[data-carrito]');
  const texto = $('[data-resumen-texto]');
  const sincronizar = $('[data-sincronizar]');
  if (!caja) return;
  estado.grupos = grupos();
  if (!estado.grupos.length) {
    if (texto) texto.textContent = 'No hay nada pendiente.';
    if (sincronizar) sincronizar.hidden = true;
    caja.innerHTML = '<div class="vacio">' +
      '<div class="vacio__ico"><svg viewBox="0 0 24 24"><circle cx="9" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/>' +
      '<path d="M3 4h2l2.4 11h11l2-8H6"/></svg></div>' +
      '<h2>Tu carrito está vacío</h2>' +
      '<p>Busca lo que necesitas y compáralo entre las tiendas de tu barrio. Cuando agregues algo, aparecerá acá.</p>' +
      '<a class="ds-btn ds-btn--lg" href="/panel/cliente/buscar/">Buscar productos</a> ' +
      '<a class="ds-btn ds-btn--ghost" href="/panel/cliente/mapa/">Ver tiendas cerca</a></div>';
    aviso('');
    return;
  }
  if (texto) {
    const n = estado.grupos.reduce((a, g) => a + g.unidades, 0);
    texto.textContent = n + ' producto' + (n === 1 ? '' : 's') + ' en ' + estado.grupos.length +
      ' tienda' + (estado.grupos.length === 1 ? '' : 's') + '.';
  }
  if (sincronizar) {
    const cambió = estado.grupos.some((g) => {
      const t = estado.tiendas.get(g.id);
      return t && !t.error && comparar(g, t).some((l) => l.estado === 'precio' || l.estado === 'stock');
    });
    sincronizar.hidden = !cambió;
  }
  caja.innerHTML = '<div class="carrito-marco">' +
    '<div>' + estado.grupos.map(grupoHtml).join('') + '</div>' +
    resumenHtml() + '</div>';
}

async function revalidar() {
  estado.grupos = grupos();
  const ids = estado.grupos.map((g) => g.id);
  if (!ids.length) { pintar(); return; }
  estado.tiendas = new Map();

  for (let i = 0; i < ids.length; i += MAX_PARALELO) {
    const tanda = ids.slice(i, i + MAX_PARALELO);
    const res = await Promise.allSettled(tanda.map((id) => mercado('local_ver', { id })));
    tanda.forEach((id, j) => {
      const r = res[j];
      if (r.status === 'fulfilled' && r.value && r.value.tienda) {
        estado.tiendas.set(id, r.value.tienda);
      } else {
        const e = r.status === 'rejected' ? r.reason : null;
        estado.tiendas.set(id, {
          error: e && e.codigo === 'NO_ENCONTRADO'
            ? 'esta tienda ya no está publicada'
            : 'no pudimos verificar esta tienda (' + mensajeDeError(e) + ')',
        });
      }
    });
    // La primera tanda ya se puede mirar mientras llegan las demás.
    if (i === 0) pintar();
  }
  estado.revisado = true;
  pintar();
}

function actualizarGrupo(id) {
  const t = estado.tiendas.get(id);
  if (!t || t.error) return;
  const r = aplicarCatalogo(id, t);
  const partes = [];
  if (r.cambiadas) partes.push(r.cambiadas + ' precio' + (r.cambiadas === 1 ? '' : 's') + ' al día');
  if (r.quitadas) partes.push(r.quitadas + ' producto' + (r.quitadas === 1 ? '' : 's') + ' fuera');
  aviso(partes.length ? 'Pedido actualizado: ' + partes.join(' y ') + '.' : 'Todo estaba al día.',
    r.quitadas ? 'warn' : 'ok');
  revalidar();
}

document.addEventListener('click', async (e) => {
  const linea = e.target.closest('[data-linea]');
  if (linea) {
    const [localId, pid] = linea.dataset.linea.split('|');
    if (e.target.closest('[data-mas]')) { cambiar(localId, pid, 1); pintar(); return; }
    if (e.target.closest('[data-menos]')) { cambiar(localId, pid, -1); pintar(); return; }
    if (e.target.closest('[data-quitar]')) { quitar(localId, pid); revalidar(); return; }
  }
  const act = e.target.closest('[data-actualizar]');
  if (act) { actualizarGrupo(act.dataset.actualizar); return; }
  const sinc = e.target.closest('[data-sincronizar]');
  if (sinc) {
    let cambiadas = 0, quitadas = 0;
    for (const g of estado.grupos) {
      const t = estado.tiendas.get(g.id);
      if (!t || t.error) continue;
      const r = aplicarCatalogo(g.id, t);
      cambiadas += r.cambiadas || 0;
      quitadas += r.quitadas || 0;
    }
    aviso('Carrito actualizado: ' + cambiadas + ' precio' + (cambiadas === 1 ? '' : 's') +
      ' y ' + quitadas + ' producto' + (quitadas === 1 ? '' : 's') + ' fuera.', 'ok');
    revalidar();
  }
});

suscribir(() => { pintar(); });

revalidar();
