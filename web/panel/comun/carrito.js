/* Carrito compartido con la PWA.
   Misma clave (`fcore.placer.carrito`) y misma forma de item que
   `web/app/placer.js`: si alguien arma el carrito en el panel, lo termina en
   la PWA, y al revés. El panel no cobra: solo guarda la intención. */

const KEY = 'fcore.placer.carrito';
const EVENTO = 'fcore:carrito';

function avisar() {
  try { window.dispatchEvent(new CustomEvent(EVENTO)); } catch (_) { /* sin window */ }
}

export function leer() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || '{}');
    return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  } catch (_) { return {}; }
}

export function guardar(carrito) {
  try { localStorage.setItem(KEY, JSON.stringify(carrito || {})); } catch (_) { /* modo privado */ }
  avisar();
}

/** Metadatos de la tienda que el carrito necesita para sobrevivir a la recarga. */
export function metaDe(tienda) {
  const t = tienda || {};
  return {
    nombre: String(t.nombre || 'Tienda'),
    ico: t.ico || 'tienda',
    rubro: t.rubro || '',
    logo: t.logo || '',
    minimo: Math.max(0, Number(t.minimo) || 0),
    envio: Math.max(0, Number(t.envio) || 0),
    entrega: Array.isArray(t.entrega) && t.entrega.length ? t.entrega.slice(0, 4) : ['retiro'],
    telefono: t.telefono || '',
    abierto: t.abierto !== false,
    lat: Number(t.lat) || 0,
    lon: Number(t.lon) || 0,
  };
}

function grupoNuevo(tienda) {
  return Object.assign({ items: {} }, metaDe(tienda));
}

/** Agrega (o suma) un producto. `producto` viene de `catalogo.productosDe()`.
 *  Devuelve la cantidad final o lanza con un motivo legible. */
export function agregar(tienda, producto, cantidad) {
  if (!tienda || !producto) throw new Error('falta la tienda o el producto');
  if (tienda.abierto === false) throw new Error('la tienda está cerrada: no se puede agregar');
  const suma = Math.max(1, Math.min(999, Math.round(Number(cantidad) || 1)));
  const carrito = leer();
  const g = carrito[tienda.id] || grupoNuevo(tienda);
  const actual = g.items[producto.id];
  const antes = actual ? Number(actual.c || actual) || 0 : 0;
  const total = antes + suma;
  const stock = producto.stock === null || producto.stock === undefined ? null : Number(producto.stock);
  if (stock !== null && total > stock) {
    throw new Error(stock > 0
      ? 'sólo quedan ' + stock + ' de ' + producto.nombre
      : producto.nombre + ' está agotado');
  }
  g.items[producto.id] = {
    n: producto.nombre,
    p: Math.max(0, Math.round(Number(producto.precio) || 0)),
    c: total,
    s: producto.sku || '',
    l: producto.lista != null ? producto.lista : producto.precio,
    d: Number(producto.descuento) || 0,
    i: producto.imagen || '',
  };
  // Los metadatos se refrescan en cada visita: si cambió el mínimo o el
  // envío, el carrito no sigue creyendo la versión vieja.
  Object.assign(g, metaDe(tienda));
  carrito[tienda.id] = g;
  guardar(carrito);
  return total;
}

export function cambiar(localId, pid, delta) {
  const carrito = leer();
  const g = carrito[localId];
  if (!g || !g.items[pid]) return 0;
  const actual = g.items[pid];
  const antes = Number(actual.c || actual) || 0;
  const cantidad = Math.max(0, Math.min(999, antes + Math.round(Number(delta) || 0)));
  if (cantidad <= 0) delete g.items[pid];
  else actual.c = cantidad;
  if (!Object.keys(g.items).length) delete carrito[localId];
  guardar(carrito);
  return cantidad;
}

export function fijar(localId, pid, cantidad) {
  const carrito = leer();
  const g = carrito[localId];
  if (!g || !g.items[pid]) return 0;
  const n = Math.max(0, Math.min(999, Math.round(Number(cantidad) || 0)));
  if (n <= 0) delete g.items[pid];
  else g.items[pid].c = n;
  if (!Object.keys(g.items).length) delete carrito[localId];
  guardar(carrito);
  return n;
}

export function quitar(localId, pid) {
  const carrito = leer();
  const g = carrito[localId];
  if (!g) return;
  delete g.items[pid];
  if (!Object.keys(g.items).length) delete carrito[localId];
  guardar(carrito);
}

export function vaciarTienda(localId) {
  const carrito = leer();
  delete carrito[localId];
  guardar(carrito);
}

export function vaciar() {
  guardar({});
}

export function unidades() {
  const carrito = leer();
  let n = 0;
  for (const id of Object.keys(carrito)) {
    const items = carrito[id] && carrito[id].items ? carrito[id].items : {};
    for (const pid of Object.keys(items)) n += Number(items[pid] && items[pid].c || items[pid]) || 0;
  }
  return n;
}

/** Carrito normalizado, agrupado por tienda y listo para pintar.
 *  Tolera items del formato viejo (solo cantidad). */
export function grupos() {
  const carrito = leer();
  const lista = [];
  for (const id of Object.keys(carrito)) {
    const g = carrito[id] || {};
    const items = [];
    const crudos = g.items && typeof g.items === 'object' ? g.items : {};
    for (const pid of Object.keys(crudos)) {
      const it = crudos[pid];
      if (it === null || it === undefined) continue;
      const cantidad = Number(typeof it === 'object' ? it.c : it) || 0;
      if (cantidad <= 0) continue;
      items.push({
        pid,
        nombre: typeof it === 'object' ? String(it.n || 'Producto') : 'Producto',
        precio: Math.max(0, Math.round(Number(typeof it === 'object' ? it.p : 0) || 0)),
        lista: Math.max(0, Math.round(Number(typeof it === 'object' && it.l != null ? it.l : (it && it.p)) || 0)),
        descuento: Number(typeof it === 'object' ? it.d : 0) || 0,
        imagen: typeof it === 'object' ? String(it.i || '') : '',
        sku: typeof it === 'object' ? String(it.s || '') : '',
        cantidad,
      });
    }
    if (!items.length) continue;
    const unidadesGrupo = items.reduce((a, x) => a + x.cantidad, 0);
    const subtotal = items.reduce((a, x) => a + x.precio * x.cantidad, 0);
    lista.push({
      id,
      nombre: String(g.nombre || 'Tienda'),
      ico: g.ico || 'tienda',
      rubro: g.rubro || '',
      logo: g.logo || '',
      minimo: Math.max(0, Number(g.minimo) || 0),
      envio: Math.max(0, Number(g.envio) || 0),
      entrega: Array.isArray(g.entrega) ? g.entrega : ['retiro'],
      telefono: g.telefono || '',
      abierto: g.abierto !== false,
      lat: Number(g.lat) || 0,
      lon: Number(g.lon) || 0,
      items,
      unidades: unidadesGrupo,
      subtotal,
    });
  }
  return lista;
}

export function total() {
  return grupos().reduce((a, g) => a + g.subtotal, 0);
}

/** Aplica el catálogo actual a un grupo: devuelve las líneas con las
 *  diferencias visibles (precio, stock, producto eliminado). */
export function comparar(grupo, tienda) {
  const productos = tienda && Array.isArray(tienda.catalogo) ? tienda.catalogo : null;
  if (!productos) return grupo.items.map((it) => Object.assign({}, it, { estado: 'sin-datos' }));
  const porSku = new Map();
  const porNombre = new Map();
  productos.forEach((p, i) => {
    if (p.sku) porSku.set(String(p.sku), { p, i });
    porNombre.set(String(p.nombre || '').trim().toLowerCase(), { p, i });
  });
  return grupo.items.map((it) => {
    const encontrado = (it.sku && porSku.get(it.sku)) ||
      porNombre.get(it.nombre.trim().toLowerCase()) || null;
    if (!encontrado) return Object.assign({}, it, { estado: 'borrado' });
    const p = encontrado.p;
    const precio = Math.max(0, Math.round(Number(p.precio_efectivo != null ? p.precio_efectivo : p.precio) || 0));
    const stock = p.stock === null || p.stock === undefined ? null : Math.max(0, Number(p.stock) || 0);
    let estado = 'ok';
    if (stock !== null && stock < it.cantidad) estado = stock === 0 ? 'agotado' : 'stock';
    else if (precio !== it.precio) estado = 'precio';
    return Object.assign({}, it, {
      estado,
      precioActual: precio,
      stock,
      pidActual: tienda.id + '#' + encontrado.i,
      imagenActual: p.imagen || it.imagen,
    });
  });
}

/**
 * Deja el grupo como el catálogo vigente: actualiza precios, recorta
 * cantidades al stock real y quita lo que la tienda ya no tiene.
 * Devuelve cuántas líneas cambiaron y cuántas se fueron.
 */
export function aplicarCatalogo(localId, tienda) {
  const carrito = leer();
  const g = carrito[localId];
  if (!g || !tienda) return { cambiadas: 0, quitadas: 0 };
  const productos = Array.isArray(tienda.catalogo) ? tienda.catalogo : [];
  const porSku = new Map();
  const porNombre = new Map();
  productos.forEach((p, i) => {
    if (p.sku) porSku.set(String(p.sku), { p, i });
    porNombre.set(String(p.nombre || '').trim().toLowerCase(), { p, i });
  });

  let cambiadas = 0;
  let quitadas = 0;
  const nuevos = {};
  for (const pid of Object.keys(g.items || {})) {
    const it = g.items[pid];
    if (!it) continue;
    const nombre = String(typeof it === 'object' ? it.n || '' : '').trim();
    const sku = String(typeof it === 'object' ? it.s || '' : '');
    const encontrado = (sku && porSku.get(sku)) ||
      (nombre && porNombre.get(nombre.toLowerCase())) || null;
    if (!encontrado) { quitadas++; continue; }

    const p = encontrado.p;
    const precio = Math.max(0, Math.round(Number(
      p.precio_efectivo != null ? p.precio_efectivo : p.precio
    ) || 0));
    const lista = Math.max(precio, Math.round(Number(p.precio) || 0));
    const descuento = Math.max(0, Math.min(90, Math.round(Number(
      p.descuento_vigente != null ? p.descuento_vigente : p.descuento
    ) || 0)));
    const stock = p.stock === null || p.stock === undefined ? null : Math.max(0, Number(p.stock) || 0);
    let cantidad = Number(typeof it === 'object' ? it.c : it) || 0;
    if (stock !== null && cantidad > stock) cantidad = stock;
    if (cantidad <= 0) { quitadas++; continue; }

    const antes = Number(typeof it === 'object' ? it.p : 0) || 0;
    if (antes !== precio) cambiadas++;
    nuevos[tienda.id + '#' + encontrado.i] = {
      n: String(p.nombre || nombre || 'Producto'),
      p: precio,
      c: cantidad,
      s: p.sku || sku || '',
      l: descuento ? lista : precio,
      d: descuento,
      i: p.imagen || (typeof it === 'object' ? it.i : '') || '',
    };
  }

  g.items = nuevos;
  Object.assign(g, metaDe(tienda));
  if (!Object.keys(nuevos).length) delete carrito[localId];
  guardar(carrito);
  return { cambiadas, quitadas };
}

export function suscribir(fn) {
  window.addEventListener(EVENTO, fn);
  return () => window.removeEventListener(EVENTO, fn);
}
