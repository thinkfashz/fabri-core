/* Catálogo y geografía compartidos por los módulos del cliente.
   El panel no inventa datos: adapta lo que ya devuelve `/api/mercado` y usa
   las mismas categorías y la misma forma de producto que `web/app/placer.js`,
   para que el carrito de la PWA y el del panel sean el mismo carrito. */

const CATS = [
  ['Lácteos', /leche|queso|yogur|mantequilla|crema|manjar/i],
  ['Panadería', /pan\b|marraqueta|hallulla|baguette|empanada|torta|kuchen|galleta|dobladita|amasado/i],
  ['Carnes', /pollo|carne|cerdo|lomo|plateada|chorizo|costillar|pechuga|molida|hueso|vacuno/i],
  ['Frutas y verduras', /tomate|papa|cebolla|zanahoria|palta|pl[aá]tano|manzana|lechuga|lim[oó]n|frutilla|pimiento|choclo|naranja|zapallo|poroto|cilantro|verdura/i],
  ['Bebidas', /bebida|agua|jugo|cerveza|vino|pisco|espumante|hielo|t[eé]\b|caf[eé]|ron\b|t[oó]nica/i],
  ['Abarrotes', /arroz|fideo|aceite|harina|az[uú]car|sal\b|at[uú]n|conserva|salsa|lenteja|avena|quinoa|semilla|granola|cacao|miel|fruto|snack|huevo/i],
  ['Limpieza', /detergente|papel|cloro|lavaloza|basura|jab[oó]n|vela/i],
  ['Pescados', /reineta|merluza|salm[oó]n|camar[oó]n|chorito|macha|congrio|jibia/i],
  ['Otros', /.*/],
];

export const CATEGORIAS = CATS.slice(0, -1).map((c) => c[0]);

export const RESPALDO = { lat: -33.4489, lon: -70.6693, nombre: 'Santiago centro', origen: 'respaldo' };

export function categoriaDe(nombre) {
  for (let i = 0; i < CATS.length; i++) if (CATS[i][1].test(String(nombre || ''))) return CATS[i][0];
  return 'Otros';
}

export function unidadDe(nombre) {
  const m = /(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|u|unidades?)\b/i.exec(String(nombre || ''));
  if (!m) return '1 u';
  const n = m[1].replace(',', '.');
  const u = m[2].toLowerCase().replace('unidades', 'u').replace('unidad', 'u');
  return n + ' ' + (u === 'l' ? 'L' : u);
}

/** Catálogo de una tienda → productos con la MISMA forma que usa placer.js.
 *  `id` es estable dentro de la tienda (`local#indice`) y es la llave del
 *  carrito compartido. El único precio que se cobra es `precio`. */
export function productosDe(tienda) {
  const cat = tienda && Array.isArray(tienda.catalogo) ? tienda.catalogo : [];
  return cat.map((it, i) => {
    const nombre = String(it.nombre || 'Producto');
    const lista = Math.max(0, Math.round(Number(it.precio) || 0));
    const crudo = it.descuento_vigente != null ? it.descuento_vigente : it.descuento;
    const descuento = Math.max(0, Math.min(90, Math.round(Number(crudo) || 0)));
    const efectivo = it.precio_efectivo != null
      ? Math.max(0, Math.round(Number(it.precio_efectivo) || 0))
      : (descuento ? Math.max(1, Math.round(lista * (100 - descuento) / 100)) : lista);
    return {
      id: tienda.id + '#' + i,
      sku: it.sku || '',
      codigo: it.codigo || '',
      nombre,
      categoria: it.categoria || categoriaDe(nombre),
      unidad: it.unidad || unidadDe(nombre),
      lista: descuento ? lista : efectivo,
      precio: efectivo,
      descuento,
      stock: it.stock === null || it.stock === undefined ? null : Math.max(0, Number(it.stock) || 0),
      imagen: it.imagen || '',
      oferta_hasta: Number(it.oferta_hasta) || 0,
    };
  });
}

export function porCategoria(productos) {
  const mapa = new Map();
  for (const p of productos) {
    if (!mapa.has(p.categoria)) mapa.set(p.categoria, []);
    mapa.get(p.categoria).push(p);
  }
  return Array.from(mapa.entries());
}

export function buscarEnTienda(tienda, referencia) {
  const productos = productosDe(tienda);
  const ref = String(referencia || '');
  if (!ref) return null;
  return productos.find((p) => p.sku === ref) ||
    productos.find((p) => p.id === ref) ||
    productos.find((p) => p.id.endsWith('#' + ref)) ||
    null;
}

/** Haversine en km. Devuelve null si falta alguna coordenada. */
export function distanciaKm(lat1, lon1, lat2, lon2) {
  const a = Number(lat1), b = Number(lon1), c = Number(lat2), d = Number(lon2);
  if (![a, b, c, d].every(Number.isFinite)) return null;
  if (!a || !b || !c || !d) return null;
  const r = Math.PI / 180;
  const dLat = (c - a) * r;
  const dLon = (d - b) * r;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h))) * 10) / 10;
}

/** Última ubicación conocida (la misma clave que la PWA). */
export function ubicacionGuardada() {
  try {
    const d = JSON.parse(localStorage.getItem('fcore.placer.ubicacion') || 'null');
    if (!d || !Number.isFinite(Number(d.lat)) || !Number.isFinite(Number(d.lon))) return null;
    if (Date.now() - Number(d.t || 0) > 86400000) return null;
    return { lat: Number(d.lat), lon: Number(d.lon), nombre: 'tu última ubicación', origen: 'cache', t: d.t };
  } catch (_) { return null; }
}

/**
 * Pide la ubicación al navegador. Si se niega o no hay GPS, devuelve el
 * respaldo de Santiago con `origen: 'respaldo'` para que la pantalla nunca
 * quede sin coordenadas. No lanza.
 */
export function pedirUbicacion(opciones) {
  const o = opciones || {};
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(RESPALDO);
      return;
    }
    let listo = false;
    const terminar = (v) => { if (!listo) { listo = true; resolve(v); } };
    const reloj = setTimeout(() => terminar(RESPALDO), o.ms || 9000);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(reloj);
        const dato = {
          lat: Number(p.coords.latitude),
          lon: Number(p.coords.longitude),
          precision: Math.round(Number(p.coords.accuracy) || 0),
          nombre: 'tu ubicación',
          origen: 'gps',
          t: Date.now(),
        };
        try { localStorage.setItem('fcore.placer.ubicacion', JSON.stringify({ lat: dato.lat, lon: dato.lon, t: dato.t })); } catch (_) {}
        terminar(dato);
      },
      () => { clearTimeout(reloj); terminar(RESPALDO); },
      { enableHighAccuracy: false, timeout: o.ms || 8000, maximumAge: 300000 }
    );
  });
}
