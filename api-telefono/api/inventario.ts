// FABRI-CORE · /api/inventario
// ---------------------------------------------------------------------------
// Puente de inventario entre la APK (SQLite local) y la base en InsForge.
//
// Por qué existe este endpoint y no se usa /api/sync:
//   · /api/sync inserta fila por fila con SQL armado a mano y sin upsert: al
//     reenviar un producto ya sincronizado fallaba por clave duplicada.
//   · La tabla no existía en InsForge, así que la primera subida moría con
//     "relation does not exist".
//   · La web necesitaba lo mismo (subir productos) con la misma forma.
//
// Contrato (siempre JSON):
//   POST { accion: "asegurar" }                      → crea tabla e índice
//   POST { accion: "subir",  productos: [ ... ] }     → upsert por `codigo`
//   POST { accion: "bajar",  limite?, offset? }       → lista desde la nube
//   POST { accion: "resumen" }                        → totales y stock bajo
//   GET  /api/inventario                              → estado del puente
//
// Seguridad: exige `Authorization: Bearer <FABRI_API_TOKEN>`. Sin token no se
// toca la base. Los nombres de columna son fijos (nunca vienen del cliente) y
// los valores van siempre como parámetros de `pg`.
// ---------------------------------------------------------------------------

import type { IncomingMessage, ServerResponse } from 'http';

export const config = { api: { bodyParser: false } };

const TABLA = 'inv_productos';
const MAX_FILAS = 500;
const MAX_TEXTO = 500;

const COLUMNAS = [
  'codigo', 'nombre', 'marca', 'categoria', 'unidad', 'costo', 'precio',
  'stock', 'stock_minimo', 'iva', 'proveedor', 'origen', 'notas', 'ficha',
  'actualizado',
];

type Fila = Record<string, unknown>;

function cors(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function json(res: ServerResponse, data: unknown, status = 200) {
  cors(res);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function leerBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let cuerpo = '';
    let tamano = 0;
    req.on('data', (trozo) => {
      tamano += trozo.length;
      if (tamano > 2_000_000) {
        reject(new Error('cuerpo demasiado grande'));
        req.destroy();
        return;
      }
      cuerpo += trozo;
    });
    req.on('end', () => {
      try {
        const datos = JSON.parse(cuerpo || '{}');
        resolve(datos && typeof datos === 'object' ? datos : {});
      } catch (e) {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

function autorizado(req: IncomingMessage): boolean {
  const esperado = (process.env.FABRI_API_TOKEN || '').trim();
  if (!esperado) return false;
  const cabecera = String(req.headers.authorization || '');
  if (!cabecera.startsWith('Bearer ')) return false;
  return cabecera.slice(7).trim() === esperado;
}

/** Texto acotado: nunca deja pasar objetos ni cadenas gigantes. */
function texto(v: unknown, tope = MAX_TEXTO): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : String(v);
  return s.slice(0, tope);
}

/** Número finito y acotado (evita NaN, Infinity y valores absurdos). */
function numero(v: unknown, tope = 1_000_000_000): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'));
  if (!Number.isFinite(n)) return 0;
  return Math.max(-tope, Math.min(tope, n));
}

function entero(v: unknown, tope = 1_000_000): number {
  return Math.round(numero(v, tope));
}

/** Ficha como objeto JSON seguro (sin claves raras ni tamaño infinito). */
function ficha(v: unknown): Record<string, unknown> {
  let f: unknown = v;
  if (typeof f === 'string') {
    try { f = JSON.parse(f || '{}'); } catch (e) { f = {}; }
  }
  if (!f || typeof f !== 'object' || Array.isArray(f)) return {};
  const crudo = JSON.stringify(f);
  return crudo.length <= 4000 ? (f as Record<string, unknown>) : {};
}

/** Normaliza una fila de la APK o de la web a las columnas reales. */
function normalizar(p: Fila) {
  const codigo = texto(p.codigo, 64).trim();
  const nombre = texto(p.nombre, 200).trim();
  return {
    codigo,
    nombre,
    marca: texto(p.marca, 120).trim(),
    categoria: texto(p.categoria, 40).trim() || 'abarrotes',
    unidad: texto(p.unidad, 40).trim() || 'unidad',
    costo: numero(p.costo),
    precio: numero(p.precio),
    stock: entero(p.stock),
    stock_minimo: entero(p.stock_minimo),
    iva: p.iva === undefined || p.iva === null ? 19 : entero(p.iva, 100),
    proveedor: texto(p.proveedor, 120).trim(),
    origen: texto(p.origen, 60).trim() || 'manual',
    notas: texto(p.notas, 1000),
    ficha: ficha(p.ficha),
    actualizado: entero(p.actualizado) || Math.floor(Date.now() / 1000),
  };
}

async function asegurar(pool: any) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLA} (
      codigo       TEXT PRIMARY KEY,
      nombre       TEXT NOT NULL DEFAULT '',
      marca        TEXT NOT NULL DEFAULT '',
      categoria    TEXT NOT NULL DEFAULT 'abarrotes',
      unidad       TEXT NOT NULL DEFAULT 'unidad',
      costo        NUMERIC NOT NULL DEFAULT 0,
      precio       NUMERIC NOT NULL DEFAULT 0,
      stock        INTEGER NOT NULL DEFAULT 0,
      stock_minimo INTEGER NOT NULL DEFAULT 0,
      iva          INTEGER NOT NULL DEFAULT 19,
      proveedor    TEXT NOT NULL DEFAULT '',
      origen       TEXT NOT NULL DEFAULT 'manual',
      notas        TEXT NOT NULL DEFAULT '',
      ficha        JSONB NOT NULL DEFAULT '{}'::jsonb,
      actualizado  BIGINT NOT NULL DEFAULT 0,
      nube_ts      TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_inv_productos_categoria ON ${TABLA} (categoria)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_inv_productos_actualizado ON ${TABLA} (actualizado)`);
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET') {
    // Diagnóstico público: sólo dice si la tabla existe, NUNCA devuelve filas
    // ni valores de entorno. Sirve para que el panel y la web confirmen la
    // conexión sin necesidad de la clave.
    const url = new URL(String(req.url || '/'), 'https://fabri-api.local');
    let tabla_existe: boolean | null = null;
    let base_detalle = 'no comprobada';
    if (url.searchParams.get('diag') === '1' && process.env.INSFORGE_DATABASE_URL) {
      try {
        const { Pool } = await import('pg');
        const pool = new Pool({
          connectionString: process.env.INSFORGE_DATABASE_URL,
          ssl: { rejectUnauthorized: false },
          connectionTimeoutMillis: 8000,
          max: 1,
        });
        const r = await pool.query("SELECT to_regclass('public." + TABLA + "') AS t");
        tabla_existe = Boolean(r.rows[0] && r.rows[0].t);
        base_detalle = tabla_existe ? 'tabla presente' : 'tabla ausente: usa accion "asegurar"';
        await pool.end();
      } catch (e: any) {
        base_detalle = 'error de conexión: ' + (e?.message || String(e)).slice(0, 120);
      }
    }
    return json(res, {
      ok: true,
      servicio: 'fabri-api',
      endpoint: '/api/inventario',
      tabla: TABLA,
      base_configurada: Boolean(process.env.INSFORGE_DATABASE_URL),
      token_configurado: Boolean(process.env.FABRI_API_TOKEN),
      tabla_existe,
      base_detalle,
      acciones: ['asegurar', 'subir', 'bajar', 'resumen'],
    });
  }

  if (req.method !== 'POST') {
    return json(res, { ok: false, error: 'método no permitido' }, 405);
  }

  // `asegurar` es la única acción que no exige token: sólo ejecuta un
  // CREATE TABLE IF NOT EXISTS con columnas fijas (sin datos del cliente y sin
  // DROP). Así la primera puesta en marcha no depende de que alguien pegue la
  // clave, y repetirla no cambia nada. Todo lo demás sí exige Bearer.
  let accionPedida = '';
  let cuerpo: Record<string, unknown> = {};
  try {
    cuerpo = await leerBody(req);
    accionPedida = texto(cuerpo.accion, 30).trim();
  } catch (e: any) {
    return json(res, { ok: false, error: e?.message || 'cuerpo inválido' }, 400);
  }

  if (accionPedida !== 'asegurar' && !autorizado(req)) {
    return json(res, { ok: false, error: 'no autorizado', codigo: 'SIN_TOKEN' }, 401);
  }

  if (!process.env.INSFORGE_DATABASE_URL) {
    return json(res, {
      ok: false,
      error: 'INSFORGE_DATABASE_URL no configurada en el servidor',
      codigo: 'SIN_BASE',
    }, 503);
  }

  const accion = accionPedida || 'resumen';
  let pool: any = null;

  try {
    const { Pool } = await import('pg');
    pool = new Pool({
      connectionString: process.env.INSFORGE_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
      max: 2,
    });

    await asegurar(pool);

    if (accion === 'asegurar') {
      return json(res, { ok: true, accion, tabla: TABLA, columnas: COLUMNAS });
    }

    if (accion === 'subir') {
      const lista = Array.isArray(cuerpo.productos) ? cuerpo.productos : [];
      if (!lista.length) {
        return json(res, { ok: false, error: 'no hay productos para subir' }, 400);
      }
      if (lista.length > MAX_FILAS) {
        return json(res, { ok: false, error: `máximo ${MAX_FILAS} productos por lote` }, 413);
      }

      let subidos = 0;
      const omitidos: string[] = [];
      const sentencia = `
        INSERT INTO ${TABLA}
          (codigo,nombre,marca,categoria,unidad,costo,precio,stock,stock_minimo,
           iva,proveedor,origen,notas,ficha,actualizado)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)
        ON CONFLICT (codigo) DO UPDATE SET
          nombre = EXCLUDED.nombre, marca = EXCLUDED.marca,
          categoria = EXCLUDED.categoria, unidad = EXCLUDED.unidad,
          costo = EXCLUDED.costo, precio = EXCLUDED.precio,
          stock = EXCLUDED.stock, stock_minimo = EXCLUDED.stock_minimo,
          iva = EXCLUDED.iva, proveedor = EXCLUDED.proveedor,
          origen = EXCLUDED.origen, notas = EXCLUDED.notas,
          ficha = EXCLUDED.ficha, actualizado = EXCLUDED.actualizado,
          nube_ts = now()`;

      for (const crudo of lista) {
        if (!crudo || typeof crudo !== 'object') continue;
        const p = normalizar(crudo as Fila);
        if (!p.codigo || !p.nombre) {
          omitidos.push(p.codigo || '(sin código)');
          continue;
        }
        await pool.query(sentencia, [
          p.codigo, p.nombre, p.marca, p.categoria, p.unidad, p.costo, p.precio,
          p.stock, p.stock_minimo, p.iva, p.proveedor, p.origen, p.notas,
          JSON.stringify(p.ficha), p.actualizado,
        ]);
        subidos++;
      }

      return json(res, {
        ok: true,
        accion,
        subidos,
        omitidos: omitidos.length,
        detalle_omitidos: omitidos.slice(0, 10),
        tabla: TABLA,
      });
    }

    if (accion === 'bajar') {
      const limite = Math.min(500, Math.max(1, entero(cuerpo.limite, 500) || 200));
      const offset = Math.max(0, entero(cuerpo.offset, 1_000_000));
      const r = await pool.query(
        `SELECT codigo,nombre,marca,categoria,unidad,costo,precio,stock,
                stock_minimo,iva,proveedor,origen,notas,ficha,actualizado
           FROM ${TABLA}
          ORDER BY nombre COLLATE "C"
          LIMIT $1 OFFSET $2`,
        [limite, offset]
      );
      return json(res, {
        ok: true,
        accion,
        productos: r.rows,
        total: r.rowCount,
        limite,
        offset,
      });
    }

    if (accion === 'resumen') {
      const r = await pool.query(`
        SELECT COUNT(*)::int                                   AS total,
               COALESCE(SUM(precio * stock), 0)::float          AS valor_venta,
               COALESCE(SUM((precio - costo) * stock), 0)::float AS utilidad,
               COUNT(*) FILTER (WHERE stock <= stock_minimo)::int AS stock_bajo
          FROM ${TABLA}`);
      const cat = await pool.query(
        `SELECT categoria, COUNT(*)::int AS n FROM ${TABLA} GROUP BY categoria ORDER BY n DESC`
      );
      return json(res, {
        ok: true,
        accion,
        resumen: r.rows[0] || { total: 0, valor_venta: 0, utilidad: 0, stock_bajo: 0 },
        categorias: cat.rows,
      });
    }

    return json(res, { ok: false, error: `acción desconocida: ${accion}` }, 400);
  } catch (e: any) {
    return json(res, {
      ok: false,
      error: e?.message || String(e),
      codigo: 'ERROR_BASE',
      accion,
    }, 500);
  } finally {
    if (pool) {
      try { await pool.end(); } catch (e) { /* la conexión ya se cerró */ }
    }
  }
}
