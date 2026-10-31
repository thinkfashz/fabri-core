// FORGE CORE STOCK · /api/catalogo
// Marketplace en la nube: catálogo público de productos de la tienda.
//
// Cada producto lleva: id, nombre, categoria, clasificacion, descripcion,
// precio (CLP), stock y un tinte de color para la tarjeta. Filtros por query:
//   q=<texto>          búsqueda en nombre + descripción + categoría
//   categoria=<id>      filtro por categoría
//   clasificacion=<id>  filtro por clasificación
//   max_precio=<numero>  precio de venta máximo
//
// Público y de solo lectura: no guarda nada ni pide token. Incluye CORS para
// que la PWA (fabri-core-web) lo consuma desde otro origen.
export const config = { api: { bodyParser: false } };

const CATALOGO = [
  { id: 'eq-001', nombre: 'Caja registradora táctil', categoria: 'Equipos', clasificacion: 'Gama alta', descripcion: 'Pantalla de 15,6" con Android integrado, impresora térmica de 80 mm y batería de respaldo.', precio: 489990, moneda: 'CLP', stock: 12, tinte: '#c8f542' },
  { id: 'eq-002', nombre: 'Lector de códigos láser', categoria: 'Equipos', clasificacion: 'Gama media', descripcion: 'Escáner de mano ergonómico, lee EAN-13, Code128 y QR a 30 cm.', precio: 45990, moneda: 'CLP', stock: 40, tinte: '#8c8cff' },
  { id: 'eq-003', nombre: 'Báscula de mostrador', categoria: 'Equipos', clasificacion: 'Economico', descripcion: 'Capacidad 30 kg, precisión de 5 g, cabezal orientable con teclado.', precio: 74990, moneda: 'CLP', stock: 8, tinte: '#3fe0c9' },
  { id: 'eq-004', nombre: 'Terminal de punto de venta', categoria: 'Equipos', clasificacion: 'Gama alta', descripcion: 'Procesador dual-core, doble pantalla, soporte VESA y 4 GB de RAM.', precio: 359990, moneda: 'CLP', stock: 5, tinte: '#c8f542' },
  { id: 'ac-001', nombre: 'Papel térmico 80 mm', categoria: 'Insumos', clasificacion: 'Gama media', descripcion: 'Rollos de 50 mm de diámetro, calidad industrial, por caja de 50 unidades.', precio: 18990, moneda: 'CLP', stock: 120, tinte: '#5aa9ff' },
  { id: 'ac-002', nombre: 'Cinta para medir stock', categoria: 'Insumos', clasificacion: 'Economico', descripcion: 'Rollo de 300 etiquetas por caja, resistente a agua y frío.', precio: 8990, moneda: 'CLP', stock: 86, tinte: '#3fe0c9' },
  { id: 'ac-003', nombre: 'Cargador de sobremesa', categoria: 'Accesorios', clasificacion: 'Gama media', descripcion: 'Fuente de 12 V / 3 A con cable de 1,5 m, ideal para terminales POS.', precio: 12990, moneda: 'CLP', stock: 34, tinte: '#ffc24b' },
  { id: 'ac-004', nombre: 'Soporte metálico para display', categoria: 'Accesorios', clasificacion: 'Economico', descripcion: 'Base orientable 360° con brazo ajustable en altura.', precio: 15990, moneda: 'CLP', stock: 22, tinte: '#8c8cff' },
  { id: 'au-001', nombre: 'Altavoz de mostrador', categoria: 'Audio', clasificacion: 'Gama media', descripcion: '5 W, plug 3,5 mm, carcasa de aluminio.', precio: 19990, moneda: 'CLP', stock: 18, tinte: '#c8f542' },
  { id: 'au-002', nombre: 'Torre de sonido para local', categoria: 'Audio', clasificacion: 'Gama alta', descripcion: '2×50 W, Bluetooth, entrada USB y control remoto.', precio: 129990, moneda: 'CLP', stock: 6, tinte: '#ff7a8a' },
  { id: 'pr-001', nombre: 'Lámina anti-robo para vitrina', categoria: 'Protección', clasificacion: 'Premium', descripcion: 'Lámina de seguridad de 0,22 mm con adhesivo de alta sujeción.', precio: 34990, moneda: 'CLP', stock: 4, tinte: '#5aa9ff' },
  { id: 'pr-002', nombre: 'Candado de vitrina', categoria: 'Protección', clasificacion: 'Gama media', descripcion: 'Cuerpo de acero, llave doble y cierre reforzado.', precio: 11990, moneda: 'CLP', stock: 15, tinte: '#3fe0c9' },
];

function json(res: any, data: unknown, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data, null, 2));
}

function unico(selector: (p: any) => string): string[] {
  const vis = new Set<string>();
  const salida: string[] = [];
  for (const p of CATALOGO) {
    const v = selector(p);
    if (v && !vis.has(v)) { vis.add(v); salida.push(v); }
  }
  return salida.sort();
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    return json(res, { ok: true });
  }
  if (req.method !== 'GET') {
    return json(res, { error: 'Method not allowed' }, 405);
  }

  const url = new URL(req.url, 'http://localhost');
  const q = (url.searchParams.get('q') || '').toLowerCase().trim();
  const categoria = (url.searchParams.get('categoria') || '').toLowerCase().trim();
  const clasificacion = (url.searchParams.get('clasificacion') || '').toLowerCase().trim();
  let maxPrecio = -1;
  const maxRaw = (url.searchParams.get('max_precio') || '').trim();
  if (maxRaw) {
    const n = Number(maxRaw);
    if (Number.isFinite(n) && n > 0) maxPrecio = n;
  }

  const filtrados = CATALOGO.filter((p) => {
    if (categoria && p.categoria.toLowerCase() !== categoria) return false;
    if (clasificacion && p.clasificacion.toLowerCase() !== clasificacion) return false;
    if (maxPrecio >= 0 && p.precio > maxPrecio) return false;
    if (q) {
      const texto = (p.nombre + ' ' + p.descripcion + ' ' + p.categoria + ' ' + p.clasificacion).toLowerCase();
      if (!texto.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => a.precio - b.precio);

  return json(res, {
    ok: true,
    servicio: 'fabri-api',
    catalogo: 'forge-core-stock',
    total: filtrados.length,
    productos: filtrados,
    categorias: unico((p) => p.categoria),
    clasificaciones: unico((p) => p.clasificacion),
    filtros: { q, categoria, clasificacion, max_precio: maxPrecio },
  });
}
