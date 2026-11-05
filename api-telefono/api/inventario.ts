// FORGE CORE STOCK · /api/inventario
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
// MULTI-INQUILINO (por qué lleva `local_id`):
//   Cada local tiene SU espacio, aislado del resto. La fila guarda `local_id`
//   y la clave primaria es (local_id, codigo), así dos almacenes pueden tener
//   el mismo código de barras sin pisarse. Todos los espacios viven en la
//   MISMA base de InsForge: el dueño de la plataforma los ve todos.
//
// Credenciales (doble llave, igual que /api/mercado):
//   · ADMIN → `Authorization: Bearer FABRI_API_TOKEN` (el dueño de la
//     plataforma). Ve y escribe en todos los espacios; si manda `local_id`,
//     se limita a ese.
//   · DUEÑO → `local_id` + `clave` (8 caracteres) en el cuerpo. Sólo puede
//     leer y escribir su propio espacio. La clave se compara contra el
//     SHA-256 que quedó en `mercado_locales` al dar de alta el local: una
//     sola credencial sirve para el panel del mercado y para el inventario.
//
// Contrato (siempre JSON):
//   POST { accion: "asegurar" }                      → crea tabla e índice (público)
//   POST { accion: "subir",  productos: [ ... ] }     → upsert por (local_id, codigo)
//   POST { accion: "bajar",  limite?, offset? }       → lista desde la nube
//   POST { accion: "buscar", codigo, q? }             → un producto o una búsqueda
//   POST { accion: "borrar", codigos: [ ... ] }       → elimina por código
//   POST { accion: "subir_boletas", boletas: [...] }  → upsert de ventas por folio
//   POST { accion: "resumen" }                        → totales y stock bajo
//   GET  /api/inventario                              → estado del puente
//
// Seguridad: `asegurar` es público (sólo DDL con columnas fijas, sin datos y
// sin DROP). Todo lo demás exige ADMIN o DUEÑO. Los nombres de columna son
// fijos (nunca vienen del cliente) y los valores van siempre como parámetros
// de `pg`.
// ---------------------------------------------------------------------------

import type { IncomingMessage, ServerResponse } from 'http';
import { createHash } from 'crypto';

export const config = { api: { bodyParser: false } };

const TABLA = 'inv_productos';
const T_BOLETAS = 'inv_boletas';
const T_LOCALES = 'mercado_locales';
const MAX_FILAS = 500;
const MAX_TEXTO = 500;

const COLUMNAS = [
  'local_id', 'codigo', 'nombre', 'marca', 'categoria', 'unidad', 'costo',
  'precio', 'stock', 'stock_minimo', 'iva', 'proveedor', 'origen', 'notas',
  'ficha', 'actualizado',
];

type Fila = Record<string, unknown>;

/* ── plomería http ──────────────────────────────────────────────────────── */

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

/* ── validación ─────────────────────────────────────────────────────────── */

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

/* ── credenciales y alcance ─────────────────────────────────────────────── */

function esAdmin(req: IncomingMessage): boolean {
  const esperado = (process.env.FABRI_API_TOKEN || '').trim();
  if (!esperado) return false;
  const cabecera = String(req.headers.authorization || '');
  if (!cabecera.startsWith('Bearer ')) return false;
  return cabecera.slice(7).trim() === esperado;
}

/** id de local: minúsculas, guiones, sin acentos y acotado (igual que mercado). */
function idLocal(v: unknown): string {
  return texto(v, 60)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

/** Mismo salto que /api/mercado: si no coincide, la clave no es válida. */
function hashClave(clave: string): string {
  return createHash('sha256').update('mercado:' + clave).digest('hex');
}

type Alcance = { admin: boolean; local_id: string };

/**
 * Decide el alcance con las cabeceras y el cuerpo.
 *   · ADMIN  → todos los espacios (o uno solo si manda `local_id`).
 *   · DUEÑO  → sólo su `local_id`, con `clave` válida.
 * Devuelve `alcance: null` cuando no hay autorización, con el motivo.
 */
async function resolverAlcance(
  pool: any, req: IncomingMessage, cuerpo: Fila
): Promise<{ alcance: Alcance | null; motivo?: string }> {
  if (esAdmin(req)) {
    return { alcance: { admin: true, local_id: idLocal(cuerpo.local_id) } };
  }
  const localId = idLocal(cuerpo.local_id);
  const clave = texto(cuerpo.clave, 60).trim();
  if (!localId || !clave) return { alcance: null, motivo: 'SIN_CREDENCIALES' };

  let local: any = null;
  try {
    const r = await pool.query(`SELECT id,clave_hash FROM ${T_LOCALES} WHERE id = $1`, [localId]);
    local = r.rows[0];
  } catch (e) {
    // La tabla de locales todavía no existe: no hay dueños dados de alta.
    return { alcance: null, motivo: 'SIN_LOCALES' };
  }
  if (!local) return { alcance: null, motivo: 'local_inexistente' };
  if (!local.clave_hash || hashClave(clave) !== local.clave_hash) {
    return { alcance: null, motivo: 'clave_mala' };
  }
  return { alcance: { admin: false, local_id: localId } };
}

/** ¿Hay que filtrar por local? Admin sin `local_id` ve y opera todo. */
function acotado(alcance: Alcance): boolean {
  return !(alcance.admin && !alcance.local_id);
}

/* ── esquema ────────────────────────────────────────────────────────────── */

async function asegurar(pool: any) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLA} (
      local_id     TEXT NOT NULL DEFAULT '',
      codigo       TEXT NOT NULL,
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
      nube_ts      TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (local_id, codigo)
    )`);
  // Migración para tablas creadas antes (clave primaria sólo por `codigo`):
  // se agrega `local_id` con '' (el espacio del admin/dueño de la plataforma)
  // y se pasa la clave primaria a (local_id, codigo). Es idempotente.
  await pool.query(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS local_id TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE ${TABLA} DROP CONSTRAINT IF EXISTS ${TABLA}_pkey`);
  await pool.query(`ALTER TABLE ${TABLA} ADD PRIMARY KEY (local_id, codigo)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_inv_productos_local ON ${TABLA} (local_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_inv_productos_categoria ON ${TABLA} (categoria)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_inv_productos_actualizado ON ${TABLA} (actualizado)`);
}

async function asegurarBoletas(pool: any) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${T_BOLETAS} (
      local_id TEXT NOT NULL DEFAULT '',
      folio    BIGINT NOT NULL,
      cliente  TEXT NOT NULL DEFAULT '',
      rut      TEXT NOT NULL DEFAULT '',
      items    JSONB NOT NULL DEFAULT '[]'::jsonb,
      neto     NUMERIC NOT NULL DEFAULT 0,
      iva      NUMERIC NOT NULL DEFAULT 0,
      total    NUMERIC NOT NULL DEFAULT 0,
      pago     TEXT NOT NULL DEFAULT 'efectivo',
      estado   TEXT NOT NULL DEFAULT 'emitida',
      ts       BIGINT NOT NULL DEFAULT 0,
      nube_ts  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (local_id, folio)
    )`);
  await pool.query(`ALTER TABLE ${T_BOLETAS} ADD COLUMN IF NOT EXISTS local_id TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE ${T_BOLETAS} DROP CONSTRAINT IF EXISTS ${T_BOLETAS}_pkey`);
  await pool.query(`ALTER TABLE ${T_BOLETAS} ADD PRIMARY KEY (local_id, folio)`);
}

/* ── handler ────────────────────────────────────────────────────────────── */

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
      multi_inquilino: true,
      base_configurada: Boolean(process.env.INSFORGE_DATABASE_URL),
      token_configurado: Boolean(process.env.FABRI_API_TOKEN),
      tabla_existe,
      base_detalle,
      acciones: ['asegurar', 'subir', 'bajar', 'buscar', 'borrar', 'subir_boletas', 'resumen'],
    });
  }

  if (req.method !== 'POST') {
    return json(res, { ok: false, error: 'método no permitido' }, 405);
  }

  let accionPedida = '';
  let cuerpo: Record<string, unknown> = {};
  try {
    cuerpo = await leerBody(req);
    accionPedida = texto(cuerpo.accion, 30).trim();
  } catch (e: any) {
    return json(res, { ok: false, error: e?.message || 'cuerpo inválido' }, 400);
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

    // `asegurar` es la única acción que no exige credenciales: sólo ejecuta un
    // CREATE TABLE IF NOT EXISTS con columnas fijas (sin datos del cliente y
    // sin DROP). Así la primera puesta en marcha no depende de que alguien
    // pegue la clave, y repetirla no cambia nada.
    if (accion === 'asegurar') {
      return json(res, { ok: true, accion, tabla: TABLA, columnas: COLUMNAS });
    }

    // Todo lo demás sí exige ADMIN o DUEÑO. El alcance decide qué espacio ve.
    const { alcance, motivo } = await resolverAlcance(pool, req, cuerpo);
    if (!alcance) {
      return json(res, { ok: false, error: 'no autorizado', codigo: motivo || 'SIN_TOKEN' }, 401);
    }
    const filtrar = acotado(alcance);
    const localId = alcance.local_id;

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
          (local_id,codigo,nombre,marca,categoria,unidad,costo,precio,stock,
           stock_minimo,iva,proveedor,origen,notas,ficha,actualizado)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16)
        ON CONFLICT (local_id, codigo) DO UPDATE SET
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
          localId, p.codigo, p.nombre, p.marca, p.categoria, p.unidad, p.costo,
          p.precio, p.stock, p.stock_minimo, p.iva, p.proveedor, p.origen,
          p.notas, JSON.stringify(p.ficha), p.actualizado,
        ]);
        subidos++;
      }

      return json(res, {
        ok: true,
        accion,
        local_id: localId,
        subidos,
        omitidos: omitidos.length,
        detalle_omitidos: omitidos.slice(0, 10),
        tabla: TABLA,
      });
    }

    if (accion === 'bajar') {
      const limite = Math.min(500, Math.max(1, entero(cuerpo.limite, 500) || 200));
      const offset = Math.max(0, entero(cuerpo.offset, 1_000_000));
      // NUMERIC vuelve como cadena desde `pg`; se castea para que la web y la
      // APK reciban números y no tengan que adivinar el tipo.
      const columnas = `local_id,codigo,nombre,marca,categoria,unidad,
                costo::float8 AS costo, precio::float8 AS precio, stock,
                stock_minimo,iva,proveedor,origen,notas,ficha,
                actualizado::float8 AS actualizado`;
      const r = filtrar
        ? await pool.query(
            `SELECT ${columnas} FROM ${TABLA}
              WHERE local_id = $3
              ORDER BY nombre COLLATE "C" LIMIT $1 OFFSET $2`,
            [limite, offset, localId]
          )
        : await pool.query(
            `SELECT ${columnas} FROM ${TABLA}
              ORDER BY nombre COLLATE "C" LIMIT $1 OFFSET $2`,
            [limite, offset]
          );
      return json(res, {
        ok: true,
        accion,
        local_id: localId,
        productos: r.rows,
        total: r.rowCount,
        limite,
        offset,
      });
    }

    if (accion === 'buscar') {
      // Dos modos en la misma acción, para que el escáner resuelva de un solo
      // viaje:
      //   · con `codigo`  → devuelve ese producto exacto (o encontrado:false);
      //   · con `q`       → busca por nombre/marca/código (autocompletado).
      const codigo = texto(cuerpo.codigo, 64).trim();
      const q = texto(cuerpo.q, 120).trim();
      const limite = Math.min(50, Math.max(1, entero(cuerpo.limite, 50) || 20));
      const columnas = `local_id,codigo,nombre,marca,categoria,unidad,
                  costo::float8 AS costo, precio::float8 AS precio, stock,
                  stock_minimo,iva,proveedor,origen,notas,ficha,
                  actualizado::float8 AS actualizado`;

      if (codigo) {
        const r = filtrar
          ? await pool.query(
              `SELECT ${columnas} FROM ${TABLA}
                WHERE codigo = $1 AND local_id = $2 LIMIT 1`,
              [codigo, localId]
            )
          : await pool.query(
              `SELECT ${columnas} FROM ${TABLA} WHERE codigo = $1 LIMIT 1`,
              [codigo]
            );
        const p = r.rows[0] || null;
        return json(res, { ok: true, accion, local_id: localId, encontrado: Boolean(p), producto: p });
      }

      if (q) {
        // `%` y `_` del usuario se escapan para que no alteren el LIKE.
        const patron = '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
        const r = filtrar
          ? await pool.query(
              `SELECT ${columnas} FROM ${TABLA}
                WHERE local_id = $3
                  AND (nombre ILIKE $1 ESCAPE '\\'
                    OR marca ILIKE $1 ESCAPE '\\'
                    OR codigo ILIKE $1 ESCAPE '\\')
                ORDER BY nombre COLLATE "C" LIMIT $2`,
              [patron, limite, localId]
            )
          : await pool.query(
              `SELECT ${columnas} FROM ${TABLA}
                WHERE nombre ILIKE $1 ESCAPE '\\'
                   OR marca ILIKE $1 ESCAPE '\\'
                   OR codigo ILIKE $1 ESCAPE '\\'
                ORDER BY nombre COLLATE "C" LIMIT $2`,
              [patron, limite]
            );
        return json(res, { ok: true, accion, local_id: localId, productos: r.rows, total: r.rowCount });
      }

      return json(res, { ok: false, error: 'falta `codigo` o `q`' }, 400);
    }

    if (accion === 'borrar') {
      const codigos = (Array.isArray(cuerpo.codigos) ? cuerpo.codigos : [])
        .map((c) => texto(c, 64).trim())
        .filter(Boolean);
      if (!codigos.length) {
        return json(res, { ok: false, error: 'no hay códigos para borrar' }, 400);
      }
      if (codigos.length > 200) {
        return json(res, { ok: false, error: 'máximo 200 códigos por lote' }, 413);
      }
      const r = filtrar
        ? await pool.query(
            `DELETE FROM ${TABLA} WHERE codigo = ANY($1::text[]) AND local_id = $2`,
            [codigos, localId]
          )
        : await pool.query(
            `DELETE FROM ${TABLA} WHERE codigo = ANY($1::text[])`, [codigos]
          );
      return json(res, { ok: true, accion, local_id: localId, borrados: r.rowCount, codigos });
    }

    if (accion === 'subir_boletas') {
      // Las ventas viajan con la misma credencial que los productos. Tabla
      // propia, upsert por (local_id, folio): reenviar una boleta no la
      // duplica y el histórico de utilidad se conserva con el costo guardado
      // en cada ítem.
      const lista = Array.isArray(cuerpo.boletas) ? cuerpo.boletas : [];
      if (!lista.length) {
        return json(res, { ok: false, error: 'no hay boletas para subir' }, 400);
      }
      if (lista.length > 200) {
        return json(res, { ok: false, error: 'máximo 200 boletas por lote' }, 413);
      }
      await asegurarBoletas(pool);
      let subidas = 0;
      const omitidas: number[] = [];
      for (const crudo of lista) {
        if (!crudo || typeof crudo !== 'object') continue;
        const b = crudo as Fila;
        const folio = entero(b.folio);
        if (!folio) { omitidas.push(0); continue; }
        const items = Array.isArray(b.items) ? b.items.slice(0, 200) : [];
        await pool.query(`
          INSERT INTO ${T_BOLETAS} (local_id,folio,cliente,rut,items,neto,iva,total,pago,estado,ts)
          VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11)
          ON CONFLICT (local_id, folio) DO UPDATE SET
            cliente = EXCLUDED.cliente, rut = EXCLUDED.rut, items = EXCLUDED.items,
            neto = EXCLUDED.neto, iva = EXCLUDED.iva, total = EXCLUDED.total,
            pago = EXCLUDED.pago, estado = EXCLUDED.estado, ts = EXCLUDED.ts,
            nube_ts = now()`,
          [
            localId,
            folio,
            texto(b.cliente, 120).trim(),
            texto(b.rut, 20).trim(),
            JSON.stringify(items),
            numero(b.neto), numero(b.iva), numero(b.total),
            texto(b.pago, 40).trim() || 'efectivo',
            texto(b.estado, 40).trim() || 'emitida',
            entero(b.ts),
          ]
        );
        subidas++;
      }
      return json(res, { ok: true, accion, local_id: localId, subidas, omitidas });
    }

    if (accion === 'resumen') {
      const r = filtrar
        ? await pool.query(`
            SELECT COUNT(*)::int                                   AS total,
                   COALESCE(SUM(precio * stock), 0)::float          AS valor_venta,
                   COALESCE(SUM((precio - costo) * stock), 0)::float AS utilidad,
                   COUNT(*) FILTER (WHERE stock <= stock_minimo)::int AS stock_bajo
              FROM ${TABLA} WHERE local_id = $1`, [localId])
        : await pool.query(`
            SELECT COUNT(*)::int                                   AS total,
                   COALESCE(SUM(precio * stock), 0)::float          AS valor_venta,
                   COALESCE(SUM((precio - costo) * stock), 0)::float AS utilidad,
                   COUNT(*) FILTER (WHERE stock <= stock_minimo)::int AS stock_bajo
              FROM ${TABLA}`);
      const cat = filtrar
        ? await pool.query(
            `SELECT categoria, COUNT(*)::int AS n FROM ${TABLA}
              WHERE local_id = $1 GROUP BY categoria ORDER BY n DESC`, [localId])
        : await pool.query(
            `SELECT categoria, COUNT(*)::int AS n FROM ${TABLA}
              GROUP BY categoria ORDER BY n DESC`);
      return json(res, {
        ok: true,
        accion,
        local_id: localId,
        alcance: alcance.admin ? 'admin' : 'dueno',
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
