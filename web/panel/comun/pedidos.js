/* Historial local de pedidos.
   Reutiliza `fcore.placer.pedidos` (la misma lista que la PWA) y conserva su
   forma: código, fecha, local, items, totales, entrega y contacto. */

const KEY = 'fcore.placer.pedidos';

export function leerPedidos() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(d) ? d : [];
  } catch (_) { return []; }
}

export function guardarPedido(registro) {
  const lista = leerPedidos();
  const nuevo = {
    codigo: String(registro.codigo || ''),
    fecha: Number(registro.fecha) || Date.now(),
    local: {
      id: String(registro.local && registro.local.id || ''),
      nombre: String(registro.local && registro.local.nombre || ''),
    },
    items: Array.isArray(registro.items) ? registro.items : [],
    subtotal: Number(registro.subtotal) || 0,
    envio: Number(registro.envio) || 0,
    total: Number(registro.total) || 0,
    metodo: registro.metodo || '',
    pago_con: Number(registro.pago_con) || 0,
    vuelto: Number(registro.vuelto) || 0,
    entrega: registro.entrega || 'retiro',
    direccion: registro.direccion || '',
    comuna: registro.comuna || '',
    referencia: registro.referencia || '',
    cliente: {
      nombre: String(registro.cliente && registro.cliente.nombre || ''),
      telefono: String(registro.cliente && registro.cliente.telefono || ''),
    },
    estado: registro.estado || 'nuevo',
    seguimiento: String(registro.seguimiento || ''),
    token: String(registro.token || registro.seguimiento || ''),
  };
  const sinRepetir = lista.filter((p) => p && p.codigo !== nuevo.codigo);
  sinRepetir.unshift(nuevo);
  try { localStorage.setItem(KEY, JSON.stringify(sinRepetir.slice(0, 300))); } catch (_) { /* sin espacio */ }
  return nuevo;
}

/** El pedido más reciente que todavía tiene sentido seguir. */
export function ultimoActivo(dias) {
  const limite = Date.now() - (Number(dias) || 7) * 86400000;
  return leerPedidos().find((p) => {
    if (!p || !p.codigo) return false;
    if (Number(p.fecha) < limite) return false;
    return p.estado !== 'entregado' && p.estado !== 'cancelado';
  }) || null;
}

export function buscarPorCodigo(codigo) {
  const c = String(codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return leerPedidos().find((p) => String(p.codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === c) || null;
}

/** Últimos 4 dígitos del teléfono con que se hizo el pedido. */
export function contactoDe(pedido) {
  const d = String(pedido && pedido.cliente && pedido.cliente.telefono || '').replace(/\D/g, '');
  return d.length >= 4 ? d.slice(-4) : '';
}

/** Enlace interno al seguimiento, con token si existe o código + contacto. */
export function enlaceSeguimiento(pedido) {
  if (!pedido) return '/panel/cliente/pedido/';
  if (pedido.token || pedido.seguimiento) {
    return '/panel/cliente/pedido/?token=' + encodeURIComponent(pedido.token || pedido.seguimiento);
  }
  const q = new URLSearchParams({ codigo: pedido.codigo || '' });
  const c = contactoDe(pedido);
  if (c) q.set('contacto', c);
  return '/panel/cliente/pedido/?' + q.toString();
}
