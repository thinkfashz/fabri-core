// FORGE CORE STOCK · /api/mercado
// ---------------------------------------------------------------------------
// El backend del marketplace: locales, catálogos y pedidos de barrio sobre la
// misma base InsForge que ya usa el inventario de la APK. Reemplaza al
// registro estático (`web/datos/tiendas.json`), que sigue existiendo como
// respaldo offline si esta API no responde.
//
// Por qué un solo endpoint con `accion`: la web, la APK y el panel del dueño
// piden cosas distintas de las mismas tres tablas; un solo contrato evita tres
// despliegues y tres CORS. Todo va y vuelve en JSON.
//
// Contrato:
//   GET  /api/mercado                          → estado del puente (público)
//   GET  /api/mercado?accion=locales[&con_catalogo=1]
//                                              → locales activos (público)
//   POST { accion: "asegurar" }                 → crea las tablas (público)
//   POST { accion: "locales", con_catalogo }    → igual que el GET (público)
//   POST { accion: "local_crear", local }       → alta (CUENTA · ADMIN)
//                                              → devuelve clave de respaldo
//   POST { accion: "local_mio" }                → mis tiendas + catálogo (CUENTA)
//   POST { accion: "local_actualizar", local_id, clave?, campos }
//                                              → edita (DUEÑO por cuenta/clave · ADMIN)
//   POST { accion: "local_estado", local_id, clave?, abierto }
//                                              → ABIERTO/CERRADO (DUEÑO · ADMIN)
//   POST { accion: "local_borrar", local_id, clave? }
//                                              → baja (DUEÑO · ADMIN)
//   POST { accion: "productos_subir", local_id, clave?, productos:[...] }
//                                              → upsert de catálogo (DUEÑO · ADMIN)
//   POST { accion: "producto_borrar", local_id, clave?, skus:[...] }
//                                              → borra productos (DUEÑO · ADMIN)
//   POST { accion: "pedido_crear", local_id, items, cliente... }
//                                              → pedido del comprador (PÚBLICO)
//                                              → devuelve `seguimiento` (token)
//   POST { accion: "pedido_seguir", token }     → estado del pedido (PÚBLICO)
//   POST { accion: "pedido_seguir", codigo, contacto }
//                                              → igual, con código MP-XXXXX y
//                                                los últimos 4 del teléfono
//   POST { accion: "pedidos_listar", local_id, clave?, estado? }
//                                              → pedidos del local (DUEÑO · ADMIN)
//   POST { accion: "pedido_estado", local_id, clave?, pedido_id, estado }
//                                              → avanza el pedido (DUEÑO · ADMIN)
//   POST { accion: "ventas_serie", local_id, clave?, dias? }
//                                              → panel del dueño: serie diaria,
//                                                top de productos, estados y
//                                                visitas (DUEÑO · ADMIN)
//   POST { accion: "resumen" }                  → conteos (ADMIN)
//
// Seguridad:
//   · Tres formas de autorizar, en este orden: el ADMIN (`FABRI_API_TOKEN`,
//     Bearer), la CUENTA dueña del local (`Authorization: Bearer <token>` de
//     `/api/auth`, que se guarda como SHA-256 en `core_sesiones`) y la `clave`
//     de 8 caracteres del local (respaldo para la APK y para quien ya la
//     tenía). La base nunca tiene la clave en claro y el listado público jamás
//     la devuelve.
//   · La primera cuenta creada en la base es `owner`; cualquier cuenta puede
//     crear SU tienda. El local guarda `dueno_id`, no el correo.
//   · Nombres de tabla y columna son fijos; todos los valores van como
//     parámetros de `pg`. Nada de SQL armado con texto del cliente.
//   · El servidor recalcula precios, subtotal y total del pedido: si el
//     comprador manda números mentirosos, no se guardan. Y rechaza el pedido
//     bajo el mínimo o con el local cerrado, aunque el cliente lo intente.
//   · El catálogo tiene tope por plan (gratis 300, pro 3000) aplicado en una
//     transacción: si el lote se pasa, se revierte entero.
// ---------------------------------------------------------------------------

import type { IncomingMessage, ServerResponse } from 'http';
import { createHash, randomBytes } from 'crypto';
// @ts-ignore: `_auth.js` es JavaScript puro, sin declaraciones de tipos.
import { sha256hex, huellaDispositivo, iguales, dispositivo as normDispositivo } from './_auth.js';

export const config = { api: { bodyParser: false } };

const T_LOCALES = 'mercado_locales';
const T_PRODUCTOS = 'mercado_productos';
const T_PEDIDOS = 'mercado_pedidos';
const T_EVENTOS = 'mercado_pedido_eventos';
const T_CUENTAS = 'core_usuarios';
const T_SESIONES = 'core_sesiones';

const MAX_TEXTO = 500;
const MAX_LOCALES = 5000;
const TOPE_PLAN: Record<string, number> = { gratis: 300, pro: 3000 };
const ESTADOS = ['nuevo', 'visto', 'listo', 'entregado', 'cancelado'];
const ENTREGAS = ['retiro', 'delivery'];

type Fila = Record<string, unknown>;

/* ── plomería http ──────────────────────────────────────────────────────── */

function cors(res: ServerResponse) {
  // Sin credenciales de navegador (nada de cookies): la autenticación es un
  // token explícito que el atacante no tiene, así que `*` no debilita nada y
  // deja que la PWA, la APK y el panel lean desde cualquier origen.
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
      if (tamano > 1_000_000) {
        reject(new Error('cuerpo demasiado grande'));
        req.destroy();
        return;
      }
      cuerpo += trozo;
    });
    req.on('end', () => {
      try {
        const d = JSON.parse(cuerpo || '{}');
        resolve(d && typeof d === 'object' ? d : {});
      } catch (e) {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

function bearer(req: IncomingMessage): string {
  const h = String(req.headers.authorization || '');
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

function esAdmin(req: IncomingMessage): boolean {
  const esperado = (process.env.FABRI_API_TOKEN || '').trim();
  return Boolean(esperado) && bearer(req) === esperado;
}

/* ── saneamiento ────────────────────────────────────────────────────────── */

function texto(v: unknown, tope = MAX_TEXTO): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : String(v);
  return s.slice(0, tope);
}

/** Texto grande (logo en data URI, descripción). No pasa por `texto` porque
 *  el logo se guarda como imagen ya redimensionada en el navegador. */
function textoLargo(v: unknown, tope = 200_000): string {
  return texto(v, tope);
}

function numero(v: unknown, tope = 100_000_000): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(tope, n));
}

function entero(v: unknown, tope = 100_000_000): number {
  return Math.round(numero(v, tope));
}

function booleano(v: unknown, porDefecto = true): boolean {
  if (v === undefined || v === null || v === '') return porDefecto;
  return !(v === false || v === 'false' || v === 0 || v === '0');
}

function lista(v: unknown, permitidos: string[], porDefecto: string[]): string[] {
  const crudo = Array.isArray(v) ? v : [];
  const limpio = crudo.map((x) => texto(x, 20)).filter((x) => permitidos.includes(x));
  return limpio.length ? Array.from(new Set(limpio)) : porDefecto;
}

/** id de local: minúsculas, guiones, sin acentos y acotado. Evita que el
 *  cliente meta rutas o caracteres raros en una clave primaria. */
function idLocal(v: unknown): string {
  return texto(v, 60)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function hashClave(clave: string): string {
  return createHash('sha256').update('mercado:' + clave).digest('hex');
}

/** Clave del dueño: 8 caracteres sin letras ni números que se confundan. */
function nuevaClave(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const bytes = randomBytes(8);
  for (let i = 0; i < 8; i++) s += abc[bytes[i] % abc.length];
  return s;
}

function codigoPedido(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = randomBytes(5);
  let s = '';
  for (let i = 0; i < 5; i++) s += abc[b[i] % abc.length];
  return 'MP-' + s;
}

/* ── límite del seguimiento público ──────────────────────────────────────── */

function ipDe(req: IncomingMessage): string {
  const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return f || String(req.socket?.remoteAddress || '');
}

/**
 * El seguimiento es público y acepta un código corto + 4 dígitos, así que hay
 * que frenar la fuerza bruta. En serverless es "best effort" (cada instancia
 * tiene su mapa), pero corta el script tonto: 30 intentos FALLIDOS por IP cada
 * 10 min. Los aciertos no cuentan: un comprador puede mirar su pedido las veces
 * que quiera.
 */
const intentosSeguir = new Map<string, { n: number; desde: number }>();
const INTENTOS_SEGUIR = 30;
const VENTANA_SEGUIR_MS = 10 * 60 * 1000;

/** La ventana del IP, reiniciándola si ya expiró. */
function ventanaDe(ip: string): { n: number; desde: number } {
  const ahora = Date.now();
  const previo = intentosSeguir.get(ip);
  if (previo && ahora - previo.desde <= VENTANA_SEGUIR_MS) return previo;
  const nueva = { n: 0, desde: ahora };
  intentosSeguir.set(ip, nueva);
  return nueva;
}

/** ¿Ya gastó sus intentos fallidos? Se consulta antes de buscar. */
function seguirBloqueado(ip: string): boolean {
  return ventanaDe(ip).n >= INTENTOS_SEGUIR;
}

/** Se anota sólo cuando la búsqueda no encontró el pedido. */
function anotarFallo(ip: string): void {
  ventanaDe(ip).n += 1;
}

/** Código de pedido comparable: mayúsculas, sin guiones, siempre con `MP`. */
function codigoComparable(v: unknown): string {
  let s = String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s) return '';
  if (s.startsWith('MP')) s = s.slice(2);
  return s ? 'MP' + s.slice(0, 5) : '';
}

/** Últimos 4 dígitos de un teléfono escrito de cualquier forma. */
function ultimos4(v: unknown): string {
  const d = String(v == null ? '' : v).replace(/\D/g, '');
  return d.length >= 4 ? d.slice(-4) : '';
}

/* ── tablas ─────────────────────────────────────────────────────────────── */

/** El esquema se comprueba una vez por instancia: las migraciones
 *  (`ADD COLUMN IF NOT EXISTS`) no necesitan repetirse en cada petición. */
let esquemaListo = false;

async function asegurar(pool: any) {
  if (esquemaListo) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${T_LOCALES} (
      id           TEXT PRIMARY KEY,
      nombre       TEXT NOT NULL DEFAULT '',
      rubro        TEXT NOT NULL DEFAULT 'Local',
      ico          TEXT NOT NULL DEFAULT 'tienda',
      telefono     TEXT NOT NULL DEFAULT '',
      direccion    TEXT NOT NULL DEFAULT '',
      comuna       TEXT NOT NULL DEFAULT '',
      lat          DOUBLE PRECISION NOT NULL DEFAULT 0,
      lon          DOUBLE PRECISION NOT NULL DEFAULT 0,
      abierto      BOOLEAN NOT NULL DEFAULT true,
      horario      TEXT NOT NULL DEFAULT '',
      minimo       INTEGER NOT NULL DEFAULT 0,
      entrega      JSONB NOT NULL DEFAULT '["retiro"]'::jsonb,
      envio        INTEGER NOT NULL DEFAULT 0,
      demo         BOOLEAN NOT NULL DEFAULT false,
      activo       BOOLEAN NOT NULL DEFAULT true,
      plan         TEXT NOT NULL DEFAULT 'gratis',
      clave_hash   TEXT NOT NULL DEFAULT '',
      actualizado  BIGINT NOT NULL DEFAULT 0,
      nube_ts      TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  // Columnas del negocio: se agregan con IF NOT EXISTS para que una base ya
  // creada (con locales del piloto) siga funcionando sin migración manual.
  await pool.query(`ALTER TABLE ${T_LOCALES} ADD COLUMN IF NOT EXISTS marca TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE ${T_LOCALES} ADD COLUMN IF NOT EXISTS logo TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE ${T_LOCALES} ADD COLUMN IF NOT EXISTS descripcion TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE ${T_LOCALES} ADD COLUMN IF NOT EXISTS dueno_id TEXT NOT NULL DEFAULT ''`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mercado_locales_dueno ON ${T_LOCALES} (dueno_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${T_PRODUCTOS} (
      local_id    TEXT NOT NULL,
      sku         TEXT NOT NULL,
      nombre      TEXT NOT NULL DEFAULT '',
      precio      NUMERIC NOT NULL DEFAULT 0,
      stock       INTEGER,
      categoria   TEXT NOT NULL DEFAULT '',
      unidad      TEXT NOT NULL DEFAULT '',
      actualizado BIGINT NOT NULL DEFAULT 0,
      nube_ts     TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (local_id, sku)
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${T_PEDIDOS} (
      id          TEXT PRIMARY KEY,
      local_id    TEXT NOT NULL,
      codigo      TEXT NOT NULL DEFAULT '',
      cliente     TEXT NOT NULL DEFAULT '',
      telefono    TEXT NOT NULL DEFAULT '',
      items       JSONB NOT NULL DEFAULT '[]'::jsonb,
      subtotal    NUMERIC NOT NULL DEFAULT 0,
      envio       NUMERIC NOT NULL DEFAULT 0,
      total       NUMERIC NOT NULL DEFAULT 0,
      entrega     TEXT NOT NULL DEFAULT 'retiro',
      direccion   TEXT NOT NULL DEFAULT '',
      nota        TEXT NOT NULL DEFAULT '',
      estado      TEXT NOT NULL DEFAULT 'nuevo',
      creado      TIMESTAMPTZ NOT NULL DEFAULT now(),
      actualizado TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mercado_productos_local ON ${T_PRODUCTOS} (local_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mercado_pedidos_local ON ${T_PEDIDOS} (local_id, creado DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mercado_locales_activo ON ${T_LOCALES} (activo)`);
  // Seguimiento del comprador: un token largo y aleatorio abre el pedido sin
  // cuenta. El código corto (MP-XXXXX) no alcanza solo para mirar un pedido
  // ajeno; el enlace lo lleva, y el formulario pide además los últimos 4
  // dígitos del teléfono.
  await pool.query(`ALTER TABLE ${T_PEDIDOS} ADD COLUMN IF NOT EXISTS seguimiento TEXT NOT NULL DEFAULT ''`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_mercado_pedidos_seguimiento
                      ON ${T_PEDIDOS} (seguimiento) WHERE seguimiento <> ''`);
  // Historial de estados: sin esto el comprador sólo ve el estado actual y no
  // sabe desde cuándo. Se llena en `pedido_crear` y en `pedido_estado`.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${T_EVENTOS} (
      pedido_id   TEXT NOT NULL,
      estado      TEXT NOT NULL DEFAULT 'nuevo',
      ts          TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mercado_eventos_pedido ON ${T_EVENTOS} (pedido_id, ts)`);
  esquemaListo = true;
}

/* ── lecturas ───────────────────────────────────────────────────────────── */

const CAMPOS_LOCAL = `id,nombre,marca,logo,descripcion,rubro,ico,telefono,direccion,comuna,
  lat::float8 AS lat, lon::float8 AS lon, abierto,horario,minimo,
  entrega,envio,demo,activo,plan,actualizado::float8 AS actualizado`;

async function traerLocales(pool: any, conCatalogo: boolean) {
  const r = await pool.query(
    `SELECT ${CAMPOS_LOCAL} FROM ${T_LOCALES} WHERE activo = true ORDER BY nombre COLLATE "C"`
  );
  const locales: any[] = r.rows;
  if (!conCatalogo) {
    const c = await pool.query(
      `SELECT local_id, COUNT(*)::int AS n FROM ${T_PRODUCTOS} GROUP BY local_id`
    );
    const cuenta: Record<string, number> = {};
    for (const fila of c.rows) cuenta[fila.local_id] = fila.n;
    for (const l of locales) l.productos_n = cuenta[l.id] || 0;
    return locales;
  }
  const p = await pool.query(
    `SELECT local_id,sku,nombre,precio::float8 AS precio,stock,categoria,unidad
       FROM ${T_PRODUCTOS} ORDER BY local_id, nombre COLLATE "C"`
  );
  const porLocal: Record<string, any[]> = {};
  for (const fila of p.rows) {
    (porLocal[fila.local_id] = porLocal[fila.local_id] || []).push({
      sku: fila.sku,
      nombre: fila.nombre,
      precio: fila.precio,
      stock: fila.stock,
      categoria: fila.categoria || '',
      unidad: fila.unidad || '',
    });
  }
  for (const l of locales) l.catalogo = porLocal[l.id] || [];
  return locales;
}

/** Normaliza una fila de la base a la MISMA forma que el registro estático
 *  (`tiendas.json`), para que la web no tenga dos caminos de lectura. */
function aTienda(l: any) {
  return {
    id: l.id,
    nombre: l.nombre,
    marca: l.marca || '',
    logo: l.logo || '',
    descripcion: l.descripcion || '',
    rubro: l.rubro,
    ico: l.ico || 'tienda',
    telefono: l.telefono || '',
    direccion: l.direccion || '',
    comuna: l.comuna || '',
    lat: l.lat,
    lon: l.lon,
    abierto: l.abierto !== false,
    horario: l.horario || '',
    minimo: Number(l.minimo) || 0,
    entrega: Array.isArray(l.entrega) ? l.entrega : ['retiro'],
    envio: Number(l.envio) || 0,
    demo: Boolean(l.demo),
    catalogo: Array.isArray(l.catalogo) ? l.catalogo : [],
  };
}

/* ── escrituras ─────────────────────────────────────────────────────────── */

function normalizarLocal(crudo: Fila) {
  const lat = Number(crudo.lat), lon = Number(crudo.lon);
  return {
    nombre: texto(crudo.nombre, 120).trim(),
    marca: texto(crudo.marca, 60).trim(),
    logo: textoLargo(crudo.logo).trim(),
    descripcion: texto(crudo.descripcion, 600).trim(),
    rubro: texto(crudo.rubro, 60).trim() || 'Local',
    ico: texto(crudo.ico, 30).trim() || 'tienda',
    telefono: texto(crudo.telefono, 30).replace(/[^\d+]/g, ''),
    direccion: texto(crudo.direccion, 160).trim(),
    comuna: texto(crudo.comuna, 80).trim(),
    lat: Number.isFinite(lat) ? Math.max(-56, Math.min(-17, lat)) : 0,
    lon: Number.isFinite(lon) ? Math.max(-76, Math.min(-66, lon)) : 0,
    abierto: booleano(crudo.abierto, true),
    horario: texto(crudo.horario, 120).trim(),
    minimo: Math.min(1_000_000, entero(crudo.minimo)),
    entrega: lista(crudo.entrega, ENTREGAS, ['retiro']),
    envio: Math.min(1_000_000, entero(crudo.envio)),
    demo: booleano(crudo.demo, false),
    actualizado: entero(crudo.actualizado) || Math.floor(Date.now() / 1000),
  };
}

/** Huella del dispositivo que declara el cliente en `X-Dispositivo`.
 *  Debe ser la misma que usó al entrar: si no, la sesión no sirve acá. */
function dispositivoDe(req: IncomingMessage): string {
  const h = req.headers['x-dispositivo'];
  const v = Array.isArray(h) ? h[0] : h;
  return normDispositivo(v);
}

/** Cuenta de la nube detrás del Bearer. Nunca lanza: si las tablas de
 *  cuentas no existen todavía (instalación nueva), la tienda sigue con clave.
 *  Devuelve `{ usuario, motivo }`; el motivo explica el 401 al cliente. */
async function cuentaDe(pool: any, req: IncomingMessage) {
  const token = bearer(req);
  if (!token) return { usuario: null, motivo: 'SIN_CUENTA' as const };
  const hash = sha256hex(token);
  try {
    const r = await pool.query(
      `SELECT u.id, u.email, u.nombre, u.rol, s.dispositivo_hash
         FROM ${T_SESIONES} s
         JOIN ${T_CUENTAS} u ON u.id = s.usuario_id
        WHERE s.token_hash = $1 AND s.revocada = false AND s.expira > now()
        LIMIT 1`,
      [hash]
    );
    const f = r.rows[0];
    if (!f) return { usuario: null, motivo: 'SESION' as const };
    // La huella se recalcula con el dispositivo que declara este request.
    // Sin coincidencia, el token está siendo usado desde otro equipo.
    const huella = huellaDispositivo(dispositivoDe(req), f.id, hash);
    if (!f.dispositivo_hash || !iguales(huella, f.dispositivo_hash)) {
      return { usuario: null, motivo: 'DISPOSITIVO' as const };
    }
    return { usuario: { id: f.id, email: f.email, nombre: f.nombre, rol: f.rol }, motivo: null };
  } catch (e) {
    return { usuario: null, motivo: 'SIN_BASE' as const };
  }
}

/** Texto del 401 según el motivo, para que la app pueda reaccionar distinto. */
function mensajeCuenta(motivo: string | null, siFalta: string): string {
  if (motivo === 'DISPOSITIVO') return 'esta sesión se abrió en otro dispositivo: vuelve a entrar desde este';
  if (motivo === 'SIN_BASE') return 'no pude comprobar tu cuenta en la nube: reintenta en unos segundos';
  return siFalta;
}

/** Dueño (cuenta o clave) o admin. Devuelve la fila del local si pasa, o null. */
async function autorizarLocal(pool: any, req: IncomingMessage, localId: string, clave: string) {
  const r = await pool.query(
    `SELECT id,clave_hash,plan,minimo,abierto,entrega,envio,nombre,dueno_id
       FROM ${T_LOCALES} WHERE id = $1`,
    [localId]
  );
  const local = r.rows[0];
  if (!local) return { local: null, motivo: 'local_inexistente' as const };
  if (esAdmin(req)) return { local, motivo: null };
  // La clave histórica manda si coincide: no gasta una consulta de sesión.
  if (clave && local.clave_hash && hashClave(clave) === local.clave_hash) {
    return { local, motivo: null };
  }
  const acceso = await cuentaDe(pool, req);
  const cuenta = acceso.usuario;
  if (cuenta && local.dueno_id && String(local.dueno_id) === String(cuenta.id)) {
    return { local, motivo: null };
  }
  // Si el token existe pero es de otro dispositivo, decirlo (la app limpia
  // la sesión de nube en vez de reintentar para siempre).
  if (acceso.motivo === 'DISPOSITIVO') return { local: null, motivo: 'DISPOSITIVO' as const };
  return { local: null, motivo: 'clave_mala' as const };
}

/* ── pedidos ────────────────────────────────────────────────────────────── */

function normalizarItems(crudo: unknown) {
  const lista = Array.isArray(crudo) ? crudo.slice(0, 200) : [];
  const items: any[] = [];
  for (const it of lista) {
    if (!it || typeof it !== 'object') continue;
    const f = it as Fila;
    const nombre = texto(f.nombre, 160).trim();
    const precio = numero(f.precio);
    const cantidad = Math.max(1, Math.min(999, entero(f.cantidad, 999)));
    if (!nombre || precio <= 0) continue;
    items.push({
      sku: texto(f.sku, 60).trim(),
      nombre,
      precio,
      cantidad,
      categoria: texto(f.categoria, 40).trim(),
      unidad: texto(f.unidad, 30).trim(),
    });
  }
  return items;
}

/* ── handler ────────────────────────────────────────────────────────────── */

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(String(req.url || '/'), 'https://fabri-api.local');

  // Estado público del puente: nunca devuelve filas ni variables de entorno.
  if (req.method === 'GET') {
    let tablas: Record<string, boolean> | null = null;
    let detalle = 'no comprobado';
    if (url.searchParams.get('diag') === '1' && process.env.INSFORGE_DATABASE_URL) {
      try {
        const { Pool } = await import('pg');
        const pool = new Pool({
          connectionString: process.env.INSFORGE_DATABASE_URL,
          ssl: { rejectUnauthorized: false },
          connectionTimeoutMillis: 8000,
          max: 1,
        });
        const r = await pool.query(
          `SELECT to_regclass('public.${T_LOCALES}') AS a,
                  to_regclass('public.${T_PRODUCTOS}') AS b,
                  to_regclass('public.${T_PEDIDOS}') AS c`
        );
        tablas = { locales: !!r.rows[0].a, productos: !!r.rows[0].b, pedidos: !!r.rows[0].c };
        detalle = tablas.locales && tablas.productos && tablas.pedidos
          ? 'tablas presentes' : 'faltan tablas: usa accion "asegurar"';
        await pool.end();
      } catch (e: any) {
        detalle = 'error de conexión: ' + (e?.message || String(e)).slice(0, 120);
      }
    }

    if (url.searchParams.get('accion') === 'locales' || url.searchParams.get('tiendas') === '1') {
      if (!process.env.INSFORGE_DATABASE_URL) {
        return json(res, { ok: false, error: 'base no configurada', codigo: 'SIN_BASE' }, 503);
      }
      const conCatalogo = url.searchParams.get('con_catalogo') !== '0';
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
        const locales = await traerLocales(pool, conCatalogo);
        return json(res, {
          ok: true,
          v: 2,
          origen: 'insforge',
          actualizado: new Date().toISOString().slice(0, 10),
          tiendas: locales.map(aTienda),
        });
      } catch (e: any) {
        return json(res, { ok: false, error: e?.message || String(e), codigo: 'ERROR_BASE' }, 500);
      } finally {
        if (pool) { try { await pool.end(); } catch (e) { /* ya cerrada */ } }
      }
    }

    return json(res, {
      ok: true,
      servicio: 'fabri-api',
      endpoint: '/api/mercado',
      base_configurada: Boolean(process.env.INSFORGE_DATABASE_URL),
      token_configurado: Boolean(process.env.FABRI_API_TOKEN),
      tablas,
      base_detalle: detalle,
      acciones: [
        'asegurar', 'locales', 'local_crear', 'local_mio', 'local_actualizar',
        'local_estado', 'local_borrar', 'productos_subir', 'producto_borrar',
        'pedido_crear', 'pedido_seguir', 'pedidos_listar', 'pedido_estado', 'ventas_serie', 'resumen',
      ],
    });
  }

  if (req.method !== 'POST') {
    return json(res, { ok: false, error: 'método no permitido' }, 405);
  }

  let cuerpo: Record<string, unknown> = {};
  try {
    cuerpo = await leerBody(req);
  } catch (e: any) {
    return json(res, { ok: false, error: e?.message || 'cuerpo inválido' }, 400);
  }

  const accion = texto(cuerpo.accion, 30).trim();

  if (!process.env.INSFORGE_DATABASE_URL) {
    return json(res, { ok: false, error: 'base no configurada', codigo: 'SIN_BASE' }, 503);
  }

  let pool: any = null;
  let cliente: any = null;

  try {
    const { Pool } = await import('pg');
    pool = new Pool({
      connectionString: process.env.INSFORGE_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
      max: 4,
    });
    await asegurar(pool);

    if (accion === 'asegurar') {
      return json(res, { ok: true, accion, tablas: [T_LOCALES, T_PRODUCTOS, T_PEDIDOS, T_EVENTOS] });
    }

    /* ── lecturas por POST (mismo contrato para la APK) ── */
    if (accion === 'locales') {
      const conCatalogo = cuerpo.con_catalogo !== false && cuerpo.con_catalogo !== 0 && cuerpo.con_catalogo !== '0';
      const locales = await traerLocales(pool, conCatalogo);
      return json(res, {
        ok: true, v: 2, origen: 'insforge',
        actualizado: new Date().toISOString().slice(0, 10),
        tiendas: locales.map(aTienda),
      });
    }

    /* ── alta de local (CUENTA dueña o ADMIN) ── */
    if (accion === 'local_crear') {
      const admin = esAdmin(req);
      const acceso = admin ? { usuario: null, motivo: null } : await cuentaDe(pool, req);
      const cuenta = acceso.usuario;
      if (!admin && !cuenta) {
        return json(res, {
          ok: false, error: mensajeCuenta(acceso.motivo, 'entra a tu cuenta para crear tu tienda'),
          codigo: acceso.motivo || 'SIN_CUENTA',
        }, 401);
      }
      const crudo = (cuerpo.local && typeof cuerpo.local === 'object' ? cuerpo.local : cuerpo) as Fila;
      const l = normalizarLocal(crudo);
      if (l.nombre.length < 2) return json(res, { ok: false, error: 'falta el nombre' }, 400);
      if (!l.lat || !l.lon) return json(res, { ok: false, error: 'faltan coordenadas válidas de Chile' }, 400);

      if (cuenta) {
        const n = await pool.query(
          `SELECT COUNT(*)::int AS n FROM ${T_LOCALES} WHERE dueno_id = $1`,
          [String(cuenta.id)]
        );
        if (Number(n.rows[0]?.n) >= 20) {
          return json(res, { ok: false, error: 'llegaste al máximo de 20 tiendas por cuenta', codigo: 'TOPE_TIENDAS' }, 409);
        }
      }

      let id = idLocal(cuerpo.local_id || cuerpo.id || l.nombre);
      if (!id) id = 'local-' + Date.now().toString(36);
      // Sin repetir id: si ya existe, se sufija.
      const ya = await pool.query(`SELECT id FROM ${T_LOCALES} WHERE id = $1`, [id]);
      if (ya.rowCount) id = id.slice(0, 34) + '-' + randomBytes(2).toString('hex');

      const clave = nuevaClave();
      const dueno = cuenta ? String(cuenta.id) : '';
      await pool.query(
        `INSERT INTO ${T_LOCALES}
           (id,nombre,marca,logo,descripcion,rubro,ico,telefono,direccion,comuna,lat,lon,
            abierto,horario,minimo,entrega,envio,demo,activo,plan,clave_hash,dueno_id,actualizado)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19,$20,$21,$22,$23)`,
        [id, l.nombre, l.marca, l.logo, l.descripcion, l.rubro, l.ico, l.telefono,
          l.direccion, l.comuna, l.lat, l.lon, l.abierto, l.horario, l.minimo,
          JSON.stringify(l.entrega), l.envio, l.demo, true, 'gratis', hashClave(clave), dueno, l.actualizado]
      );
      // `clave` se devuelve UNA sola vez: en la base sólo queda el hash. Sirve
      // para la APK y para el modo de respaldo del panel.
      return json(res, {
        ok: true, accion, id, clave, nombre: l.nombre, marca: l.marca,
        dueno: cuenta ? cuenta.email : 'admin',
      });
    }

    /* ── mis tiendas (CUENTA) ── */
    if (accion === 'local_mio') {
      const acceso = await cuentaDe(pool, req);
      const cuenta = acceso.usuario;
      if (!cuenta) return json(res, {
        ok: false, error: mensajeCuenta(acceso.motivo, 'falta la sesión'),
        codigo: acceso.motivo || 'SESION',
      }, 401);
      const r = await pool.query(
        `SELECT ${CAMPOS_LOCAL} FROM ${T_LOCALES} WHERE dueno_id = $1 ORDER BY nombre COLLATE "C"`,
        [String(cuenta.id)]
      );
      const ids = r.rows.map((l: any) => l.id);
      const catalogo: Record<string, any[]> = {};
      const pendientes: Record<string, number> = {};
      if (ids.length) {
        const p = await pool.query(
          `SELECT local_id,sku,nombre,precio::float8 AS precio,stock,categoria,unidad
             FROM ${T_PRODUCTOS} WHERE local_id = ANY($1::text[])
            ORDER BY local_id, nombre COLLATE "C"`,
          [ids]
        );
        for (const f of p.rows) {
          (catalogo[f.local_id] = catalogo[f.local_id] || []).push({
            sku: f.sku, nombre: f.nombre, precio: f.precio,
            stock: f.stock, categoria: f.categoria || '', unidad: f.unidad || '',
          });
        }
        const pd = await pool.query(
          `SELECT local_id, COUNT(*)::int AS n FROM ${T_PEDIDOS}
            WHERE local_id = ANY($1::text[]) AND estado NOT IN ('entregado','cancelado')
            GROUP BY local_id`,
          [ids]
        );
        for (const f of pd.rows) pendientes[f.local_id] = f.n;
      }
      return json(res, {
        ok: true, accion,
        cuenta: { id: String(cuenta.id), email: cuenta.email, nombre: cuenta.nombre, rol: cuenta.rol },
        tiendas: r.rows.map((l: any) => Object.assign(aTienda(l), {
          catalogo: catalogo[l.id] || [],
          pedidos_pendientes: pendientes[l.id] || 0,
        })),
      });
    }

    /* ── editar local (DUEÑO o ADMIN) ── */
    if (accion === 'local_actualizar') {
      const localId = idLocal(cuerpo.local_id);
      const { local, motivo } = await autorizarLocal(pool, req, localId, texto(cuerpo.clave, 60));
      if (!local) return json(res, { ok: false, error: 'no autorizado', codigo: motivo }, 401);

      const campos = (cuerpo.campos && typeof cuerpo.campos === 'object' ? cuerpo.campos : cuerpo) as Fila;
      const permitidos: Record<string, (v: unknown) => unknown> = {
        nombre: (v) => texto(v, 120).trim(),
        marca: (v) => texto(v, 60).trim(),
        logo: (v) => textoLargo(v).trim(),
        descripcion: (v) => texto(v, 600).trim(),
        rubro: (v) => texto(v, 60).trim(),
        ico: (v) => texto(v, 30).trim(),
        telefono: (v) => texto(v, 30).replace(/[^\d+]/g, ''),
        direccion: (v) => texto(v, 160).trim(),
        comuna: (v) => texto(v, 80).trim(),
        horario: (v) => texto(v, 120).trim(),
        minimo: (v) => Math.min(1_000_000, entero(v)),
        envio: (v) => Math.min(1_000_000, entero(v)),
        entrega: (v) => lista(v, ENTREGAS, ['retiro']),
        abierto: (v) => booleano(v, true),
      };
      const sets: string[] = [];
      const valores: unknown[] = [];
      let n = 1;
      for (const [k, fn] of Object.entries(permitidos)) {
        if (!(k in campos)) continue;
        sets.push(`${k} = $${n}` + (k === 'entrega' ? '::jsonb' : ''));
        valores.push(k === 'entrega' ? JSON.stringify(fn(campos[k])) : fn(campos[k]));
        n++;
      }
      if (!sets.length) return json(res, { ok: false, error: 'sin campos que cambiar' }, 400);
      sets.push(`actualizado = $${n}`, `nube_ts = now()`);
      valores.push(Math.floor(Date.now() / 1000), localId);
      await pool.query(`UPDATE ${T_LOCALES} SET ${sets.join(', ')} WHERE id = $${n + 1}`, valores);
      return json(res, { ok: true, accion, id: localId, cambiados: sets.length - 2 });
    }

    /* ── ABIERTO / CERRADO (DUEÑO o ADMIN) ── */
    if (accion === 'local_estado' || accion === 'local_activo') {
      const localId = idLocal(cuerpo.local_id);
      const { local, motivo } = await autorizarLocal(pool, req, localId, texto(cuerpo.clave, 60));
      if (!local) return json(res, { ok: false, error: 'no autorizado', codigo: motivo }, 401);
      if (accion === 'local_activo') {
        const activo = booleano(cuerpo.activo, true);
        await pool.query(`UPDATE ${T_LOCALES} SET activo = $1, nube_ts = now() WHERE id = $2`, [activo, localId]);
        return json(res, { ok: true, accion, id: localId, activo });
      }
      const abierto = booleano(cuerpo.abierto, true);
      await pool.query(
        `UPDATE ${T_LOCALES} SET abierto = $1, actualizado = $2, nube_ts = now() WHERE id = $3`,
        [abierto, Math.floor(Date.now() / 1000), localId]
      );
      return json(res, { ok: true, accion, id: localId, abierto });
    }

    if (accion === 'local_borrar') {
      const localId = idLocal(cuerpo.local_id);
      const { local, motivo } = await autorizarLocal(pool, req, localId, texto(cuerpo.clave, 60));
      if (!local) return json(res, { ok: false, error: 'no autorizado', codigo: motivo }, 401);
      await pool.query(`DELETE FROM ${T_PRODUCTOS} WHERE local_id = $1`, [localId]);
      await pool.query(`DELETE FROM ${T_PEDIDOS} WHERE local_id = $1`, [localId]);
      const r = await pool.query(`DELETE FROM ${T_LOCALES} WHERE id = $1`, [localId]);
      return json(res, { ok: true, accion, borrado: r.rowCount });
    }

    /* ── catálogo (DUEÑO o ADMIN) con tope por plan, en transacción ── */
    if (accion === 'productos_subir') {
      const localId = idLocal(cuerpo.local_id);
      const { local, motivo } = await autorizarLocal(pool, req, localId, texto(cuerpo.clave, 60));
      if (!local) return json(res, { ok: false, error: 'no autorizado', codigo: motivo }, 401);

      const crudos = Array.isArray(cuerpo.productos) ? cuerpo.productos.slice(0, 500) : [];
      if (!crudos.length) return json(res, { ok: false, error: 'no hay productos' }, 400);

      const tope = TOPE_PLAN[local.plan] || TOPE_PLAN.gratis;
      const ahora = Math.floor(Date.now() / 1000);

      cliente = await pool.connect();
      await cliente.query('BEGIN');
      let subidos = 0;
      const omitidos: string[] = [];
      for (let i = 0; i < crudos.length; i++) {
        const f = crudos[i];
        if (!f || typeof f !== 'object') continue;
        const p = f as Fila;
        const nombre = texto(p.nombre, 160).trim();
        const precio = numero(p.precio);
        if (!nombre || precio <= 0) { omitidos.push(nombre || '(sin nombre)'); continue; }
        const sku = texto(p.sku, 60).trim() || ('p' + (i + 1));
        await cliente.query(
          `INSERT INTO ${T_PRODUCTOS} (local_id,sku,nombre,precio,stock,categoria,unidad,actualizado)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (local_id,sku) DO UPDATE SET
             nombre = EXCLUDED.nombre, precio = EXCLUDED.precio, stock = EXCLUDED.stock,
             categoria = EXCLUDED.categoria, unidad = EXCLUDED.unidad,
             actualizado = EXCLUDED.actualizado, nube_ts = now()`,
          [localId, sku, nombre, precio,
            p.stock === null || p.stock === undefined || p.stock === '' ? null : entero(p.stock),
            texto(p.categoria, 40).trim(), texto(p.unidad, 30).trim(), ahora]
        );
        subidos++;
      }

      const c = await cliente.query(`SELECT COUNT(*)::int AS n FROM ${T_PRODUCTOS} WHERE local_id = $1`, [localId]);
      const total = c.rows[0].n;
      if (total > tope) {
        await cliente.query('ROLLBACK');
        return json(res, {
          ok: false,
          error: `el plan ${local.plan} permite ${tope} productos y este lote llega a ${total}`,
          codigo: 'TOPE_PLAN',
          tope,
          total_intentado: total,
          como_subir: 'Pasa a pro ($20.000 al año) para 3000 productos, o borra productos antes de subir.',
        }, 409);
      }
      await cliente.query('COMMIT');
      return json(res, { ok: true, accion, subidos, omitidos: omitidos.length, detalle_omitidos: omitidos.slice(0, 10), total, tope });
    }

    if (accion === 'producto_borrar') {
      const localId = idLocal(cuerpo.local_id);
      const { local, motivo } = await autorizarLocal(pool, req, localId, texto(cuerpo.clave, 60));
      if (!local) return json(res, { ok: false, error: 'no autorizado', codigo: motivo }, 401);
      const skus = (Array.isArray(cuerpo.skus) ? cuerpo.skus : []).map((s) => texto(s, 60).trim()).filter(Boolean);
      if (!skus.length) return json(res, { ok: false, error: 'no hay skus' }, 400);
      if (skus.length > 200) return json(res, { ok: false, error: 'máximo 200 skus' }, 413);
      const r = await pool.query(
        `DELETE FROM ${T_PRODUCTOS} WHERE local_id = $1 AND sku = ANY($2::text[])`, [localId, skus]
      );
      return json(res, { ok: true, accion, borrados: r.rowCount });
    }

    /* ── pedidos ── */
    if (accion === 'pedido_crear') {
      const localId = idLocal(cuerpo.local_id);
      const rl = await pool.query(
        `SELECT id,nombre,minimo,abierto,entrega,envio,activo FROM ${T_LOCALES} WHERE id = $1`, [localId]
      );
      const local = rl.rows[0];
      if (!local || !local.activo) return json(res, { ok: false, error: 'local no encontrado' }, 404);
      if (local.abierto === false) {
        return json(res, { ok: false, error: 'el local está cerrado', codigo: 'CERRADO' }, 409);
      }

      const items = normalizarItems(cuerpo.items);
      if (!items.length) return json(res, { ok: false, error: 'el pedido no tiene productos válidos' }, 400);

      const subtotal = items.reduce((a, it) => a + it.precio * it.cantidad, 0);
      if (local.minimo > 0 && subtotal < local.minimo) {
        return json(res, {
          ok: false,
          error: `el pedido mínimo es ${local.minimo} y el pedido suma ${subtotal}`,
          codigo: 'BAJO_MINIMO', minimo: local.minimo, subtotal,
        }, 409);
      }

      const permitidas: string[] = Array.isArray(local.entrega) ? local.entrega : ['retiro'];
      let entrega = texto(cuerpo.entrega, 20).trim();
      if (!permitidas.includes(entrega)) entrega = permitidas[0] || 'retiro';
      const envio = entrega === 'delivery' ? Number(local.envio) || 0 : 0;
      const total = subtotal + envio;

      const id = 'ped-' + Date.now().toString(36) + randomBytes(3).toString('hex');
      const codigo = codigoPedido();
      // Token de seguimiento: 20 caracteres aleatorios. No se deriva del id ni
      // del código, así que no se puede adivinar desde fuera.
      const seguimiento = randomBytes(10).toString('hex');
      await pool.query(
        `INSERT INTO ${T_PEDIDOS}
           (id,local_id,codigo,cliente,telefono,items,subtotal,envio,total,entrega,direccion,nota,estado,seguimiento)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,'nuevo',$13)`,
        [id, localId, codigo, texto(cuerpo.cliente, 120).trim(), texto(cuerpo.telefono, 30).replace(/[^\d+]/g, ''),
          JSON.stringify(items), subtotal, envio, total, entrega,
          texto(cuerpo.direccion, 200).trim(), texto(cuerpo.nota, 300).trim(), seguimiento]
      );
      await pool.query(
        `INSERT INTO ${T_EVENTOS} (pedido_id, estado) VALUES ($1, 'nuevo')`, [id]
      );
      return json(res, { ok: true, accion, id, codigo, seguimiento, subtotal, envio, total, estado: 'nuevo' });
    }

    /* ── seguimiento del comprador (PÚBLICO) ────────────────────────────────
       Dos formas de abrir un pedido sin cuenta:
         · `{ token }`  → el enlace que se le entrega al comprar.
         · `{ codigo, contacto }` → el código MP-XXXXX y los últimos 4 dígitos
           del teléfono con que se hizo el pedido.
       Nunca devuelve el teléfono completo, el token ni el id interno. */
    if (accion === 'pedido_seguir') {
      const ip = ipDe(req);
      if (seguirBloqueado(ip)) {
        return json(res, {
          ok: false, codigo: 'BLOQUEADO',
          error: 'demasiados intentos desde esta conexión: espera unos minutos',
        }, 429);
      }

      const token = texto(cuerpo.token, 64).trim().toLowerCase();
      const codigo = codigoComparable(cuerpo.codigo);
      const contacto = ultimos4(cuerpo.contacto);

      if (!token && !(codigo && contacto)) {
        return json(res, {
          ok: false, codigo: 'FALTAN_DATOS',
          error: token === '' && codigo
            ? 'faltan los últimos 4 dígitos del teléfono'
            : 'escribe el código del pedido y los últimos 4 dígitos del teléfono',
        }, 400);
      }

      const columnas = `p.id, p.codigo, p.cliente, p.items,
              p.subtotal::float8 AS subtotal, p.envio::float8 AS envio, p.total::float8 AS total,
              p.entrega, p.direccion, p.nota, p.estado, p.creado, p.actualizado,
              l.nombre AS local_nombre, l.telefono AS local_telefono,
              l.direccion AS local_direccion, l.comuna AS local_comuna,
              l.horario AS local_horario, l.abierto AS local_abierto`;

      let fila: any = null;
      if (token) {
        const r = await pool.query(
          `SELECT ${columnas} FROM ${T_PEDIDOS} p
             LEFT JOIN ${T_LOCALES} l ON l.id = p.local_id
            WHERE p.seguimiento = $1 LIMIT 1`, [token]
        );
        fila = r.rows[0] || null;
      } else {
        const r = await pool.query(
          `SELECT ${columnas} FROM ${T_PEDIDOS} p
             LEFT JOIN ${T_LOCALES} l ON l.id = p.local_id
            WHERE upper(regexp_replace(p.codigo, '[^A-Za-z0-9]', '', 'g')) = $1
              AND p.telefono <> ''
              AND right(regexp_replace(p.telefono, '[^0-9]', '', 'g'), 4) = $2
            ORDER BY p.creado DESC LIMIT 1`, [codigo, contacto]
        );
        fila = r.rows[0] || null;
      }

      if (!fila) {
        anotarFallo(ip);
        return json(res, {
          ok: false, codigo: 'NO_ENCONTRADO',
          error: 'no encontramos ese pedido: revisa el código y el teléfono',
        }, 404);
      }

      const ev = await pool.query(
        `SELECT estado, ts FROM ${T_EVENTOS} WHERE pedido_id = $1 ORDER BY ts ASC`, [fila.id]
      );

      return json(res, {
        ok: true, accion,
        pedido: {
          codigo: fila.codigo,
          cliente: fila.cliente,
          items: fila.items,
          subtotal: fila.subtotal,
          envio: fila.envio,
          total: fila.total,
          entrega: fila.entrega,
          direccion: fila.direccion,
          nota: fila.nota,
          estado: fila.estado,
          creado: fila.creado,
          actualizado: fila.actualizado,
          eventos: ev.rows,
          local: {
            nombre: fila.local_nombre || '',
            telefono: fila.local_telefono || '',
            direccion: fila.local_direccion || '',
            comuna: fila.local_comuna || '',
            horario: fila.local_horario || '',
            abierto: fila.local_abierto !== false,
          },
        },
      });
    }

    if (accion === 'pedidos_listar') {
      const localId = idLocal(cuerpo.local_id);
      const { local, motivo } = await autorizarLocal(pool, req, localId, texto(cuerpo.clave, 60));
      if (!local) return json(res, { ok: false, error: 'no autorizado', codigo: motivo }, 401);
      const estado = texto(cuerpo.estado, 20).trim();
      const limite = Math.min(200, Math.max(1, entero(cuerpo.limite, 200) || 50));
      const args: unknown[] = [localId];
      let where = 'local_id = $1';
      if (ESTADOS.includes(estado)) { args.push(estado); where += ` AND estado = $${args.length}`; }
      args.push(limite);
      const r = await pool.query(
        `SELECT id,codigo,seguimiento,cliente,telefono,items,
                subtotal::float8 AS subtotal, envio::float8 AS envio, total::float8 AS total,
                entrega,direccion,nota,estado,creado,actualizado
           FROM ${T_PEDIDOS} WHERE ${where}
          ORDER BY creado DESC LIMIT $${args.length}`,
        args
      );
      return json(res, { ok: true, accion, pedidos: r.rows, total: r.rowCount, local: local.nombre });
    }

    if (accion === 'pedido_estado') {
      const localId = idLocal(cuerpo.local_id);
      const { local, motivo } = await autorizarLocal(pool, req, localId, texto(cuerpo.clave, 60));
      if (!local) return json(res, { ok: false, error: 'no autorizado', codigo: motivo }, 401);
      const pedidoId = texto(cuerpo.pedido_id, 60).trim();
      const estado = texto(cuerpo.estado, 20).trim();
      if (!ESTADOS.includes(estado)) {
        return json(res, { ok: false, error: 'estado inválido', validos: ESTADOS }, 400);
      }
      const r = await pool.query(
        `UPDATE ${T_PEDIDOS} SET estado = $1, actualizado = now()
          WHERE id = $2 AND local_id = $3 AND estado <> $1`,
        [estado, pedidoId, localId]
      );
      // El historial es lo que ve el comprador: sólo se anota un cambio real.
      if (r.rowCount) {
        await pool.query(
          `INSERT INTO ${T_EVENTOS} (pedido_id, estado) VALUES ($1, $2)`, [pedidoId, estado]
        );
      }
      return json(res, { ok: true, accion, cambiados: r.rowCount, estado });
    }

    /* ── panel del dueño: serie, top, estados y visitas ── */
    if (accion === 'ventas_serie') {
      const localId = idLocal(cuerpo.local_id);
      const { local, motivo } = await autorizarLocal(pool, req, localId, texto(cuerpo.clave, 60));
      if (!local) return json(res, { ok: false, error: 'no autorizado', codigo: motivo }, 401);

      // 90 días es el techo: más que eso no se dibuja en un teléfono.
      const dias = Math.min(90, Math.max(1, entero(cuerpo.dias, 90) || 7));
      // Los días se cortan en hora de Chile, no en UTC: a las 21:00 de acá ya
      // es el día siguiente en UTC y las ventas de la noche caerían mal.
      const TZ = 'America/Santiago';

      const serie = await pool.query(
        `WITH dias AS (
           SELECT (d)::date AS dia
             FROM generate_series(
               ((now() AT TIME ZONE '${TZ}')::date - ($2::int - 1)),
               ((now() AT TIME ZONE '${TZ}')::date),
               interval '1 day') AS d
         )
         SELECT to_char(d.dia, 'YYYY-MM-DD') AS dia,
                COUNT(p.id)::int AS pedidos,
                COALESCE(SUM(p.total), 0)::float8 AS ventas
           FROM dias d
           LEFT JOIN ${T_PEDIDOS} p
             ON p.local_id = $1
            AND p.estado <> 'cancelado'
            AND (p.creado AT TIME ZONE '${TZ}')::date = d.dia
          GROUP BY d.dia
          ORDER BY d.dia`,
        [localId, dias]
      );

      const tot = await pool.query(
        `SELECT COUNT(*)::int AS pedidos,
                COALESCE(SUM(total), 0)::float8 AS ventas,
                COUNT(*) FILTER (WHERE estado IN ('nuevo','visto','listo'))::int AS abiertos
           FROM ${T_PEDIDOS}
          WHERE local_id = $1 AND estado <> 'cancelado'
            AND creado >= now() - make_interval(days => $2::int)`,
        [localId, dias]
      );

      // Top de productos: se desarma el JSON del pedido. Los cancelados no
      // cuentan, y el monto se recalcula con lo que quedó guardado (nunca con
      // lo que mandó el comprador).
      const top = await pool.query(
        `SELECT it->>'nombre' AS nombre,
                SUM((it->>'cantidad')::int)::int AS unidades,
                SUM(((it->>'precio')::numeric) * ((it->>'cantidad')::int))::float8 AS monto
           FROM ${T_PEDIDOS} p
           CROSS JOIN LATERAL jsonb_array_elements(p.items) AS it
          WHERE p.local_id = $1
            AND p.estado <> 'cancelado'
            AND jsonb_typeof(p.items) = 'array'
            AND p.creado >= now() - make_interval(days => $2::int)
          GROUP BY 1
          ORDER BY monto DESC NULLS LAST
          LIMIT 8`,
        [localId, dias]
      );

      const est = await pool.query(
        `SELECT estado, COUNT(*)::int AS n
           FROM ${T_PEDIDOS}
          WHERE local_id = $1 AND creado >= now() - make_interval(days => $2::int)
          GROUP BY estado`,
        [localId, dias]
      );
      const estados: Record<string, number> = {};
      for (const e of ESTADOS) estados[e] = 0;
      for (const f of est.rows) estados[f.estado] = f.n;

      // Visitas: la tabla es de toda la app (no distingue local), así que se
      // devuelve tal cual y el panel lo dice. Si todavía no existe (nadie
      // abrió el visor 3D), se devuelve null en vez de un error.
      let visitas: Record<string, unknown> | null = null;
      try {
        const existe = await pool.query(`SELECT to_regclass('public.visitas') AS v`);
        if (existe.rows[0]?.v) {
          const vd = await pool.query(
            `SELECT to_char((ts AT TIME ZONE '${TZ}')::date, 'YYYY-MM-DD') AS dia,
                    COUNT(*)::int AS n
               FROM visitas
              WHERE ts >= now() - make_interval(days => $1::int)
              GROUP BY 1 ORDER BY 1`,
            [dias]
          );
          const vc = await pool.query(
            `SELECT canal, COUNT(*)::int AS n
               FROM visitas
              WHERE ts >= now() - make_interval(days => $1::int)
              GROUP BY canal ORDER BY n DESC LIMIT 8`,
            [dias]
          );
          const total = vd.rows.reduce((a: number, f: any) => a + Number(f.n), 0);
          visitas = { total, por_dia: vd.rows, por_canal: vc.rows, alcance: 'app' };
        }
      } catch (e) {
        visitas = null;
      }

      const t0 = tot.rows[0] || {};
      const pedidos = Number(t0.pedidos) || 0;
      const ventas = Number(t0.ventas) || 0;
      const totalVisitas = visitas ? Number(visitas.total) || 0 : 0;
      return json(res, {
        ok: true, accion, dias,
        local: { id: local.id, nombre: local.nombre },
        serie: serie.rows,
        totales: {
          pedidos, ventas,
          ticket: pedidos ? Math.round(ventas / pedidos) : 0,
          abiertos: Number(t0.abiertos) || 0,
        },
        top: top.rows,
        estados,
        visitas,
        // Pedidos ÷ visitas de la app. Null cuando no hay con qué comparar.
        conversion: totalVisitas ? Number(((pedidos / totalVisitas) * 100).toFixed(1)) : null,
      });
    }

    if (accion === 'resumen') {
      if (!esAdmin(req)) return json(res, { ok: false, error: 'no autorizado', codigo: 'SIN_TOKEN' }, 401);
      const l = await pool.query(`SELECT COUNT(*)::int AS n FROM ${T_LOCALES} WHERE activo = true`);
      const p = await pool.query(`SELECT COUNT(*)::int AS n FROM ${T_PRODUCTOS}`);
      const pd = await pool.query(`SELECT COUNT(*)::int AS n FROM ${T_PEDIDOS}`);
      const abiertos = await pool.query(`SELECT COUNT(*)::int AS n FROM ${T_LOCALES} WHERE activo = true AND abierto = true`);
      return json(res, {
        ok: true, accion,
        resumen: {
          locales: l.rows[0].n,
          locales_abiertos: abiertos.rows[0].n,
          productos: p.rows[0].n,
          pedidos: pd.rows[0].n,
        },
        tope_plan: TOPE_PLAN,
      });
    }

    return json(res, { ok: false, error: `acción desconocida: ${accion || '(vacía)'}` }, 400);
  } catch (e: any) {
    if (cliente) { try { await cliente.query('ROLLBACK'); } catch (x) { /* ya revertida */ } }
    return json(res, { ok: false, error: e?.message || String(e), codigo: 'ERROR_BASE' }, 500);
  } finally {
    if (cliente) { try { cliente.release(); } catch (e) { /* ya liberado */ } }
    if (pool) { try { await pool.end(); } catch (e) { /* ya cerrada */ } }
  }
}
