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
//   GET  /api/mercado?accion=local_ver&id=<id>  → una tienda activa con su
//                                                catálogo y calificación (público)
//                                                → link de marca, sin cuenta
//   GET  /api/mercado?accion=imagen_ver&local_id=<id>&sku=<sku>&v=<hash>
//                                              → foto del producto (público)
//                                                → URL versionada e inmutable
//   GET  /api/mercado?accion=codigo_buscar&codigo=<ean>
//                                              → qué marcas tienen ese código
//                                                → cruza todos los locales (público)
//   GET  /api/mercado?accion=productos_buscar&q=<texto>&categoria=<c>&precio_max=<n>
//                                              → busca en todas las tiendas, con
//                                                lat/lon para ordenar por cercanía
//                                                (público; también por POST)
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
//                                              → `descuento` 0–90 % y `oferta_hasta`
//                                                (unix s; 0 = sin vencimiento)
//   POST { accion: "producto_borrar", local_id, clave?, skus:[...] }
//                                              → borra productos (DUEÑO · ADMIN)
//   POST { accion: "pedido_crear", local_id, items, cliente... }
//                                              → pedido del comprador (PÚBLICO)
//                                              → precio y descuento del servidor
//                                              → devuelve `seguimiento` (token)
//   POST { accion: "pedido_seguir", token }     → estado del pedido (PÚBLICO)
//   POST { accion: "pedido_seguir", codigo, contacto }
//                                              → igual, con código MP-XXXXX y
//                                                los últimos 4 del teléfono
//   POST { accion: "push_suscribir", token, suscripcion } → avisos push del pedido (PÚBLICO)
//   POST { accion: "push_baja", token, endpoint }         → deja de avisar (PÚBLICO)
//   POST { accion: "push_local_suscribir", local_id, suscripcion } → avisos de la tienda (DUEÑO · ADMIN)
//   POST { accion: "push_local_baja", local_id, endpoint }        → deja de avisar la tienda (DUEÑO · ADMIN)
//   POST { accion: "resenas_listar", local_id } → reseñas visibles + promedio (PÚBLICO)
//   POST { accion: "resena_crear", token, estrellas, texto }
//                                              → califica un pedido entregado (PÚBLICO)
//   POST { accion: "resenas_panel", local_id }  → todas, con las ocultas (DUEÑO · ADMIN)
//   POST { accion: "resena_moderar", ... }      → oculta o muestra una reseña (DUEÑO · ADMIN)
//   POST { accion: "pedidos_listar", local_id, clave?, estado? }
//                                              → pedidos del local (DUEÑO · ADMIN)
//   POST { accion: "pedido_estado", local_id, clave?, pedido_id, estado }
//                                              → avanza el pedido (DUEÑO · ADMIN)
//   POST { accion: "ventas_serie", local_id, clave?, dias? }
//                                              → panel del dueño: serie diaria,
//                                                top de productos, estados y
//                                                visitas (DUEÑO · ADMIN)
//   POST { accion: "resumen" }                  → conteos, stock y ofertas (ADMIN)
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
// @ts-ignore: `_push.js` es JavaScript puro: VAPID y cifrado Web Push sin dependencias.
import { enviar as enviarPush } from './_push.js';

export const config = { api: { bodyParser: false } };

const T_LOCALES = 'mercado_locales';
const T_PRODUCTOS = 'mercado_productos';
const T_PEDIDOS = 'mercado_pedidos';
const T_EVENTOS = 'mercado_pedido_eventos';
const T_RESENAS = 'mercado_resenas';
const T_PUSH = 'mercado_push';
const T_PUSH_LOCAL = 'mercado_push_local';
const T_CUENTAS = 'core_usuarios';
const T_SESIONES = 'core_sesiones';

const MAX_TEXTO = 500;
const MAX_LOCALES = 5000;
const TOPE_PLAN: Record<string, number> = { gratis: 300, pro: 3000 };
const ESTADOS = ['nuevo', 'visto', 'listo', 'entregado', 'cancelado'];
const ENTREGAS = ['retiro', 'delivery'];
/** Tope del descuento de un producto, en porcentaje. */
const DCTO_MAX = 90;
/** Foto de producto: el navegador la achica y la manda como data URL.
 *  220.000 caracteres ≈ 160 KB de imagen, suficiente para una tarjeta. */
const MAX_IMAGEN = 220_000;
const MAX_IMAGEN_BYTES = 160_000;
/** Host canónico de la API: las fotos se sirven desde acá, no desde la web. */
const API_PUBLICA = 'https://fabri-api.vercel.app';
/** Código de barras: mismo largo que acepta el escáner (EAN, UPC, Code 128). */
const MAX_CODIGO = 48;
/** Formas de pago que entiende el pedido. La tarjeta sigue siendo simulada. */
const PAGOS = ['efectivo', 'transferencia', 'tarjeta'];

type Fila = Record<string, unknown>;

/**
 * Descuento que corre AHORA: 0 si la oferta venció. El navegador nunca decide
 * el precio: `productos_subir` guarda el porcentaje y `pedido_crear` cobra con
 * esta misma expresión.
 *
 * `prefijo` es el alias de la tabla cuando la consulta une varias (`p.`).
 */
function dctoVigente(prefijo = ''): string {
  return `(CASE WHEN ${prefijo}descuento > 0 AND (${prefijo}oferta_hasta = 0
    OR ${prefijo}oferta_hasta > extract(epoch from now())::bigint)
    THEN ${prefijo}descuento ELSE 0 END)`;
}

/** Precio que se cobra, redondeado a peso: lista × (100 − dcto) / 100.
 *  Se calcula en SQL para que catálogo, pedido y panel usen el mismo número. */
function precioEfectivo(prefijo = ''): string {
  return `GREATEST(1, round(${prefijo}precio * (100 - ${dctoVigente(prefijo)}) / 100))`;
}

/* ── plomería http ──────────────────────────────────────────────────────── */

function cors(res: ServerResponse) {
  // Sin credenciales de navegador (nada de cookies): la autenticación es un
  // token explícito que el atacante no tiene, así que `*` no debilita nada y
  // deja que la PWA, la APK y el panel lean desde cualquier origen.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Dispositivo');
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

/**
 * Fin de oferta → unix en segundos. 0 = sin vencimiento.
 * Acepta unix (segundos o milisegundos), ISO completo y `YYYY-MM-DD`; una
 * fecha sin hora vale hasta el final de ese día en Chile (UTC−4).
 */
function fechaSegundos(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const crudo = String(v).trim();
  if (/^\d{9,13}$/.test(crudo)) {
    const n = Number(crudo);
    return Math.max(0, Math.round(n > 99_999_999_999 ? n / 1000 : n));
  }
  const soloDia = /^\d{4}-\d{2}-\d{2}$/.test(crudo);
  const ms = Date.parse(soloDia ? crudo + 'T23:59:59-04:00' : crudo);
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : 0;
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

/* Una reseña exige un pedido entregado, así que el abuso ya es bajo; aun así
   se frena un script que cree pedidos en serie: 20 reseñas por IP por hora. */
const resenasPorIp = new Map<string, { n: number; desde: number }>();
const RESENAS_HORA = 20;
const VENTANA_RESENA_MS = 60 * 60 * 1000;

function permitirResena(ip: string): boolean {
  const ahora = Date.now();
  const previo = resenasPorIp.get(ip);
  if (!previo || ahora - previo.desde > VENTANA_RESENA_MS) {
    resenasPorIp.set(ip, { n: 1, desde: ahora });
    return true;
  }
  if (previo.n >= RESENAS_HORA) return false;
  previo.n += 1;
  return true;
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

/** Pedido a partir del enlace (token) o del código + últimos 4 del teléfono. */
async function pedidoPorCredencial(pool: any, cuerpo: Fila) {
  const token = texto(cuerpo.token, 64).trim().toLowerCase();
  if (token) {
    const r = await pool.query(
      `SELECT id, estado, seguimiento FROM ${T_PEDIDOS} WHERE seguimiento = $1 LIMIT 1`, [token]
    );
    return r.rows[0] || null;
  }
  const codigo = codigoComparable(cuerpo.codigo);
  const contacto = ultimos4(cuerpo.contacto);
  if (!codigo || !contacto) return null;
  const r = await pool.query(
    `SELECT id, estado, seguimiento FROM ${T_PEDIDOS}
      WHERE upper(regexp_replace(codigo, '[^A-Za-z0-9]', '', 'g')) = $1
        AND telefono <> ''
        AND right(regexp_replace(telefono, '[^0-9]', '', 'g'), 4) = $2
      ORDER BY creado DESC LIMIT 1`, [codigo, contacto]
  );
  return r.rows[0] || null;
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
      codigo      TEXT NOT NULL DEFAULT '',
      imagen      TEXT NOT NULL DEFAULT '',
      imagen_hash TEXT NOT NULL DEFAULT '',
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
      comuna_entrega TEXT NOT NULL DEFAULT '',
      referencia_entrega TEXT NOT NULL DEFAULT '',
      metodo_pago TEXT NOT NULL DEFAULT '',
      pago_con    BIGINT NOT NULL DEFAULT 0,
      vuelto      BIGINT NOT NULL DEFAULT 0,
      clave_entrega TEXT NOT NULL DEFAULT '',
      nota        TEXT NOT NULL DEFAULT '',
      estado      TEXT NOT NULL DEFAULT 'nuevo',
      creado      TIMESTAMPTZ NOT NULL DEFAULT now(),
      actualizado TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mercado_productos_local ON ${T_PRODUCTOS} (local_id)`);
  // Descuento del producto: lo fija el dueño (0–90 %). `oferta_hasta` es un
  // unix en segundos; 0 = sin vencimiento. El porcentaje que se cobra se
  // calcula en el servidor (`dctoVigente`), nunca en el navegador.
  await pool.query(`ALTER TABLE ${T_PRODUCTOS} ADD COLUMN IF NOT EXISTS descuento SMALLINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE ${T_PRODUCTOS} ADD COLUMN IF NOT EXISTS oferta_hasta BIGINT NOT NULL DEFAULT 0`);
  // Foto del producto: se guarda como data URL comprimida por el navegador.
  // `imagen_hash` es la versión corta que viaja en la URL de la foto; cambia
  // cuando cambia la imagen y así el navegador no muestra la vieja.
  await pool.query(`ALTER TABLE ${T_PRODUCTOS} ADD COLUMN IF NOT EXISTS imagen TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE ${T_PRODUCTOS} ADD COLUMN IF NOT EXISTS imagen_hash TEXT NOT NULL DEFAULT ''`);
  // Código de barras real (EAN-8/UPC-A/EAN-13/GTIN-14 o Code 128/39). Es el
  // puente entre una marca y otra: el comprador escanea y ve quién lo tiene.
  await pool.query(`ALTER TABLE ${T_PRODUCTOS} ADD COLUMN IF NOT EXISTS codigo TEXT NOT NULL DEFAULT ''`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mercado_productos_codigo
                      ON ${T_PRODUCTOS} (codigo) WHERE codigo <> ''`);
  // El tope también vive en la base: aunque alguien llame la API directo, no
  // puede dejar guardado un 300 %.
  try {
    await pool.query(`ALTER TABLE ${T_PRODUCTOS}
      ADD CONSTRAINT chk_mercado_productos_dcto CHECK (descuento BETWEEN 0 AND ${DCTO_MAX})`);
  } catch (e) { /* ya existe: ADD CONSTRAINT no tiene IF NOT EXISTS */ }
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mercado_pedidos_local ON ${T_PEDIDOS} (local_id, creado DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mercado_locales_activo ON ${T_LOCALES} (activo)`);
  // Seguimiento del comprador: un token largo y aleatorio abre el pedido sin
  // cuenta. El código corto (MP-XXXXX) no alcanza solo para mirar un pedido
  // ajeno; el enlace lo lleva, y el formulario pide además los últimos 4
  // dígitos del teléfono.
  await pool.query(`ALTER TABLE ${T_PEDIDOS} ADD COLUMN IF NOT EXISTS seguimiento TEXT NOT NULL DEFAULT ''`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_mercado_pedidos_seguimiento
                      ON ${T_PEDIDOS} (seguimiento) WHERE seguimiento <> ''`);
  // Idempotencia del comprador: si el teléfono reintenta el mismo pedido (doble
  // toque, red que se corta y vuelve), no se crea otro. La clave la genera el
  // cliente y es única por local.
  await pool.query(`ALTER TABLE ${T_PEDIDOS} ADD COLUMN IF NOT EXISTS idempotencia TEXT NOT NULL DEFAULT ''`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_mercado_pedidos_idempotencia
                      ON ${T_PEDIDOS} (local_id, idempotencia) WHERE idempotencia <> ''`);
  // Lo que el comprador ahorró con las ofertas del catálogo. Se guarda al
  // crear el pedido para que el panel del dueño y el resumen del admin no
  // tengan que recalcular el JSON de cada pedido.
  await pool.query(`ALTER TABLE ${T_PEDIDOS} ADD COLUMN IF NOT EXISTS ahorro NUMERIC NOT NULL DEFAULT 0`);
  // Fase 3: dirección completa, efectivo con vuelto y código de entrega.
  // `metodo_pago` es '' en pedidos viejos (no se inventa uno); `pago_con` es
  // lo que entrega el comprador y `vuelto` lo que se le devuelve. El código de
  // 4 dígitos lo muestra el comprador y lo pide el local al entregar.
  await pool.query(`ALTER TABLE ${T_PEDIDOS} ADD COLUMN IF NOT EXISTS comuna_entrega TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE ${T_PEDIDOS} ADD COLUMN IF NOT EXISTS referencia_entrega TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE ${T_PEDIDOS} ADD COLUMN IF NOT EXISTS metodo_pago TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE ${T_PEDIDOS} ADD COLUMN IF NOT EXISTS pago_con BIGINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE ${T_PEDIDOS} ADD COLUMN IF NOT EXISTS vuelto BIGINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE ${T_PEDIDOS} ADD COLUMN IF NOT EXISTS clave_entrega TEXT NOT NULL DEFAULT ''`);
  // El código corto se usa para buscar el pedido: dos pedidos con el mismo
  // código harían ambigua la búsqueda. En una base vieja puede haber repetidos,
  // así que si el índice no entra no se tumba el arranque (la creación igual
  // reintenta con otro código).
  try {
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_mercado_pedidos_codigo
                        ON ${T_PEDIDOS} (codigo) WHERE codigo <> ''`);
  } catch (e) { /* duplicados heredados: se resuelve al crear, no acá */ }
  // Historial de estados: sin esto el comprador sólo ve el estado actual y no
  // sabe desde cuándo. Se llena en `pedido_crear` y en `pedido_estado`.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${T_EVENTOS} (
      pedido_id   TEXT NOT NULL,
      estado      TEXT NOT NULL DEFAULT 'nuevo',
      ts          TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  // Quién movió el pedido y por qué: «comprador» al crear, «dueño» al cambiar
  // de estado, y una nota corta que se ve en la línea de tiempo.
  await pool.query(`ALTER TABLE ${T_EVENTOS} ADD COLUMN IF NOT EXISTS actor TEXT NOT NULL DEFAULT 'sistema'`);
  await pool.query(`ALTER TABLE ${T_EVENTOS} ADD COLUMN IF NOT EXISTS nota TEXT NOT NULL DEFAULT ''`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mercado_eventos_pedido ON ${T_EVENTOS} (pedido_id, ts)`);
  // Reseñas: sólo puede calificar quien compró, y sólo cuando el local marcó
  // el pedido como entregado. `pedido_id` es único: una reseña por pedido.
  // La respuesta pública nunca lleva el nombre ni el teléfono completos: se
  // guarda `autor` ya abreviado («Ana P.») al crear la reseña.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${T_RESENAS} (
      id        TEXT PRIMARY KEY,
      local_id  TEXT NOT NULL,
      pedido_id TEXT NOT NULL,
      autor     TEXT NOT NULL DEFAULT '',
      estrellas SMALLINT NOT NULL DEFAULT 5,
      texto     TEXT NOT NULL DEFAULT '',
      oculta    BOOLEAN NOT NULL DEFAULT false,
      creado    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_mercado_resenas_pedido
                      ON ${T_RESENAS} (pedido_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mercado_resenas_local
                      ON ${T_RESENAS} (local_id, creado DESC)`);
  // Avisos push: una fila por dispositivo suscrito a un pedido. El `endpoint`
  // es una URL de capacidad (quien la tiene puede mandar avisos a ese
  // navegador), así que nunca se devuelve al cliente. La `huella` permite el
  // índice único sin acercarse al límite de una clave btree con URLs largas.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${T_PUSH} (
      id        TEXT PRIMARY KEY,
      pedido_id TEXT NOT NULL,
      huella    TEXT NOT NULL,
      endpoint  TEXT NOT NULL,
      p256dh    TEXT NOT NULL,
      auth      TEXT NOT NULL,
      creado    TIMESTAMPTZ NOT NULL DEFAULT now(),
      ultimo_ok TIMESTAMPTZ
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_mercado_push_pedido
                      ON ${T_PUSH} (pedido_id, huella)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mercado_push_pedido_id
                      ON ${T_PUSH} (pedido_id)`);
  // Avisos al dueño: una fila por navegador suscrito a la tienda. Se separa de
  // la tabla del comprador porque la autorización es distinta (dueño/clave).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${T_PUSH_LOCAL} (
      id        TEXT PRIMARY KEY,
      local_id  TEXT NOT NULL,
      huella    TEXT NOT NULL,
      endpoint  TEXT NOT NULL,
      p256dh    TEXT NOT NULL,
      auth      TEXT NOT NULL,
      creado    TIMESTAMPTZ NOT NULL DEFAULT now(),
      ultimo_ok TIMESTAMPTZ
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_mercado_push_local
                      ON ${T_PUSH_LOCAL} (local_id, huella)`);
  esquemaListo = true;
}

/* ── lecturas ───────────────────────────────────────────────────────────── */

/**
 * Columnas del catálogo con el descuento ya resuelto.
 *   · `precio`            → precio de lista (lo que escribió el dueño)
 *   · `descuento`         → el que fijó el dueño, aunque esté vencido
 *   · `descuento_vigente` → el que corre hoy (0 si la oferta venció)
 *   · `precio_efectivo`   → lo que se cobra
 * El navegador sólo pinta estos números; nunca los inventa.
 */
const camposProducto = (k = '') => `${k}local_id,${k}sku,${k}nombre,${k}precio::float8 AS precio,${k}stock,${k}categoria,${k}unidad,
  ${k}descuento::int AS descuento, ${dctoVigente(k)}::int AS descuento_vigente,
  ${precioEfectivo(k)}::float8 AS precio_efectivo, ${k}oferta_hasta::float8 AS oferta_hasta,
  ${k}codigo,${k}imagen_hash`;

const CAMPOS_PRODUCTO = camposProducto();

/** Fila de `CAMPOS_PRODUCTO` → objeto que viaja al navegador. */
function productoDeFila(f: any) {
  /* La foto no viaja como data URL en el catálogo: sería un JSON enorme. Se
     publica una URL corta y versionada; `imagen_ver` devuelve los bytes. */
  const imagen = f.imagen_hash
    ? API_PUBLICA + '/api/mercado?accion=imagen_ver&local_id=' +
      encodeURIComponent(String(f.local_id || '')) + '&sku=' +
      encodeURIComponent(String(f.sku || '')) + '&v=' +
      encodeURIComponent(String(f.imagen_hash))
    : '';
  return {
    sku: f.sku,
    nombre: f.nombre,
    precio: Number(f.precio) || 0,
    precio_efectivo: Number(f.precio_efectivo) || 0,
    descuento: Number(f.descuento) || 0,
    descuento_vigente: Number(f.descuento_vigente) || 0,
    oferta_hasta: Number(f.oferta_hasta) || 0,
    stock: f.stock,
    categoria: f.categoria || '',
    unidad: f.unidad || '',
    codigo: f.codigo || '',
    imagen,
  };
}

/** Valida la foto que manda el panel: data URL de JPEG/PNG/WebP, ya achicada.
 *  Si el valor no sirve se conserva la foto anterior en vez de borrarla. */
function normalizarImagen(v: unknown): { ok: boolean; valor: string } {
  if (typeof v !== 'string') return { ok: false, valor: '' };
  const s = v.trim();
  if (!s) return { ok: true, valor: '' };
  if (s.length > MAX_IMAGEN) return { ok: false, valor: '' };
  if (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s)) {
    return { ok: false, valor: '' };
  }
  // El data URL no debe decodificar a más bytes de los que `imagen_ver` sirve.
  const b64 = s.slice(s.indexOf(',') + 1);
  if (Math.floor((b64.length * 3) / 4) > MAX_IMAGEN_BYTES) {
    return { ok: false, valor: '' };
  }
  return { ok: true, valor: s };
}

/**
 * Dígito verificador GS1 (EAN-8, UPC-A, EAN-13 y GTIN-14). Mismo cálculo que
 * `core-scan.js`: el servidor no confía en que el navegador ya lo validó.
 */
function digitoGS1Ok(codigo: string): boolean {
  const d = codigo.split('').map(Number);
  if (d.some((n) => Number.isNaN(n))) return false;
  const control = d.pop() as number;
  let suma = 0;
  for (let i = d.length - 1, k = 0; i >= 0; i--, k++) suma += d[i] * (k % 2 === 0 ? 3 : 1);
  return (10 - (suma % 10)) % 10 === control;
}

/**
 * Código de barras de un producto. Acepta EAN-8/UPC-A/EAN-13/GTIN-14 con
 * checksum válido y Code 128/39 alfanumérico (6–48, con al menos un dígito).
 * Devuelve `ok: false` cuando el valor no sirve; el lote lo guarda sin código
 * y avisa, en vez de inventar uno.
 */
function normalizarCodigoBarras(v: unknown): { ok: boolean; valor: string } {
  const c = texto(v, 60).replace(/[\s\-_.]/g, '').toUpperCase();
  if (!c) return { ok: true, valor: '' };
  if (c.length < 6 || c.length > MAX_CODIGO) return { ok: false, valor: '' };
  if (!/^[A-Z0-9]+$/.test(c)) return { ok: false, valor: '' };
  // Un EAN/UPC con checksum roto sería un producto inventado: se rechaza.
  if (/^\d+$/.test(c) && [8, 12, 13, 14].includes(c.length)) {
    return digitoGS1Ok(c) ? { ok: true, valor: c } : { ok: false, valor: '' };
  }
  // Code 128/39 de tienda: alfanumérico y con algún dígito.
  return /\d/.test(c) ? { ok: true, valor: c } : { ok: false, valor: '' };
}

/** Código de entrega de 4 dígitos: lo ve el comprador y lo pide el local al
 *  entregar. Es la verificación de que el pedido llegó a sus manos. */
function claveDeEntrega(): string {
  return String(randomBytes(4).readUInt32BE(0) % 10000).padStart(4, '0');
}

/** Efectivo: cuánto entrega el comprador, cuánto se le devuelve y si falta.
 *  El servidor recalcula el vuelto con el total real; no confía en el cliente. */
function efectivoDe(total: number, con: unknown) {
  const dado = Math.max(0, Math.min(100_000_000, Math.round(Number(con) || 0)));
  return {
    dado,
    vuelto: dado > total ? dado - total : 0,
    faltan: dado > 0 && dado < total ? total - dado : 0,
  };
}

const CAMPOS_LOCAL = `id,nombre,marca,logo,descripcion,rubro,ico,telefono,direccion,comuna,
  lat::float8 AS lat, lon::float8 AS lon, abierto,horario,minimo,
  entrega,envio,demo,activo,plan,actualizado::float8 AS actualizado`;

/**
 * Un local con su catálogo y su calificación. Es lo que sirve el link público
 * de marca (`?accion=local_ver`): el comprador puede abrir el visor 3D de una
 * marca concreta sin pasar por el mapa y sin tener cuenta.
 */
async function traerLocal(pool: any, localId: string) {
  const r = await pool.query(
    `SELECT ${CAMPOS_LOCAL} FROM ${T_LOCALES}
      WHERE id = $1 AND activo = true LIMIT 1`,
    [localId]
  );
  const l = r.rows[0];
  if (!l) return null;

  const cal = await pool.query(
    `SELECT COUNT(*)::int AS n, AVG(estrellas)::float8 AS promedio
       FROM ${T_RESENAS} WHERE local_id = $1 AND oculta = false`,
    [localId]
  );
  l.calificacion = {
    n: Number(cal.rows[0] && cal.rows[0].n) || 0,
    promedio: Math.round((Number(cal.rows[0] && cal.rows[0].promedio) || 0) * 10) / 10,
  };

  const p = await pool.query(
    `SELECT ${CAMPOS_PRODUCTO} FROM ${T_PRODUCTOS}
      WHERE local_id = $1 ORDER BY nombre COLLATE "C"`,
    [localId]
  );
  l.catalogo = p.rows.map(productoDeFila);
  return l;
}

async function traerLocales(pool: any, conCatalogo: boolean) {
  const r = await pool.query(
    `SELECT ${CAMPOS_LOCAL} FROM ${T_LOCALES} WHERE activo = true ORDER BY nombre COLLATE "C"`
  );
  const locales: any[] = r.rows;

  // Calificación de cada local en una sola consulta: la ficha y la lista la
  // muestran sin pedir nada extra. Redondeo a un decimal (4.7, no 4.66666).
  const cal = await pool.query(
    `SELECT local_id, COUNT(*)::int AS n, AVG(estrellas)::float8 AS promedio
       FROM ${T_RESENAS} WHERE oculta = false GROUP BY local_id`
  );
  const calDe: Record<string, any> = {};
  for (const fila of cal.rows) {
    calDe[fila.local_id] = { n: fila.n, promedio: Math.round((Number(fila.promedio) || 0) * 10) / 10 };
  }
  for (const l of locales) l.calificacion = calDe[l.id] || { n: 0, promedio: 0 };

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
    `SELECT ${CAMPOS_PRODUCTO}
       FROM ${T_PRODUCTOS} ORDER BY local_id, nombre COLLATE "C"`
  );
  const porLocal: Record<string, any[]> = {};
  for (const fila of p.rows) {
    (porLocal[fila.local_id] = porLocal[fila.local_id] || []).push(productoDeFila(fila));
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
    /* Todo local que sale de la base es un negocio registrado: tiene ficha y
       catálogo reales. El mapa lo usaba para pintar el pin; el visor y el
       carrito también lo necesitan para respetar mínimo, envío y cierre. */
    forge: true,
    catalogo: Array.isArray(l.catalogo) ? l.catalogo : [],
    calificacion: {
      n: Number(l.calificacion && l.calificacion.n) || 0,
      promedio: Number(l.calificacion && l.calificacion.promedio) || 0,
    },
  };
}

/**
 * Cruza un código de barras con TODOS los locales activos: es la búsqueda
 * entre marcas. Devuelve el producto y la ficha de cada marca que lo tiene,
 * ordenado por precio efectivo (el más barato primero).
 */
async function buscarPorCodigo(pool: any, codigo: string) {
  const p = await pool.query(
    `SELECT ${CAMPOS_PRODUCTO} FROM ${T_PRODUCTOS}
      WHERE codigo = $1
      ORDER BY ${precioEfectivo()} ASC, nombre COLLATE "C"
      LIMIT 50`,
    [codigo]
  );
  if (!p.rows.length) return [];
  const ids = [...new Set(p.rows.map((f: any) => String(f.local_id)))];

  const l = await pool.query(
    `SELECT ${CAMPOS_LOCAL} FROM ${T_LOCALES}
      WHERE id = ANY($1::text[]) AND activo = true`,
    [ids]
  );
  // La tabla de reseñas puede no existir todavía en una base recién creada:
  // la búsqueda por código no debe caerse por eso.
  let cal: any = { rows: [] };
  try {
    cal = await pool.query(
      `SELECT local_id, COUNT(*)::int AS n, AVG(estrellas)::float8 AS promedio
         FROM ${T_RESENAS} WHERE oculta = false AND local_id = ANY($1::text[])
        GROUP BY local_id`,
      [ids]
    );
  } catch (e) { /* sin reseñas */ }
  const calDe: Record<string, any> = {};
  for (const f of cal.rows) {
    calDe[f.local_id] = { n: f.n, promedio: Math.round((Number(f.promedio) || 0) * 10) / 10 };
  }
  const locales = new Map<string, any>();
  for (const fila of l.rows) {
    fila.calificacion = calDe[fila.id] || { n: 0, promedio: 0 };
    locales.set(String(fila.id), fila);
  }

  const resultados: any[] = [];
  for (const fila of p.rows) {
    const local = locales.get(String(fila.local_id));
    if (!local) continue;   // local dado de baja: no se publica
    resultados.push({ tienda: aTienda(local), producto: productoDeFila(fila) });
  }
  return resultados;
}

/**
 * Búsqueda global de productos: texto, categoría, precio y cercanía. Es una
 * lectura pública más de `mercado.ts`; no pide cuenta ni clave y no crea
 * tablas. Devuelve el producto, la tienda en forma liviana (sin catálogo) y
 * la distancia cuando el comprador mandó su ubicación.
 */
type Busqueda = {
  q: string;
  categoria: string;
  precioMax: number;
  lat: number | null;
  lon: number | null;
  orden: string;
  limite: number;
};

/** Texto comparable: minúsculas y sin acentos. El SQL hace lo mismo con
 *  `translate()` sobre la columna; acá se normaliza lo que escribe la gente. */
function plano(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const SQL_PLANO = (col: string) =>
  `translate(lower(${col}), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc')`;

/** Coordenada desde GET o POST. `null` y `''` son «sin ubicación»: no se
 *  pueden convertir a 0, porque el comprador no está en el Golfo de Guinea. */
function coordenada(v: unknown, tope: number): number | null {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && Math.abs(n) <= tope ? n : null;
}

/** Lee y valida la búsqueda desde GET o POST. Devuelve null si no hay nada
 *  que buscar; la acción responde 400 `BUSQUEDA_CORTA`. */
function leerBusqueda(c: Record<string, unknown>): Busqueda | null {
  const q = texto(c.q || c.buscar, 60).trim();
  const categoria = texto(c.categoria, 60).trim();
  const precioMax = entero(c.precio_max || c.precio, 100_000_000) || 0;
  if (q && q.length < 2) return null;
  if (!q && !categoria && !precioMax) return null;

  const lat = coordenada(c.lat, 90), lon = coordenada(c.lon, 180);
  const conCoords = lat !== null && lon !== null;

  let orden = texto(c.orden, 16).trim();
  if (!['cercania', 'precio', 'precio-desc', 'nombre'].includes(orden)) {
    orden = conCoords ? 'cercania' : 'precio';
  }
  if (orden === 'cercania' && !conCoords) orden = 'precio';

  return {
    q, categoria, precioMax,
    lat: conCoords ? lat : null,
    lon: conCoords ? lon : null,
    orden,
    limite: Math.min(60, Math.max(1, entero(c.limite, 60) || 30)),
  };
}

async function buscarProductos(pool: any, op: Busqueda) {
  const base: string[] = ['l.activo = true'];
  const args: unknown[] = [];

  // `%` y `_` se escapan: buscar «100%» no debe comportarse como comodín.
  const qn = plano(op.q).replace(/[\\%_]/g, '\\$&');
  if (qn) {
    args.push(qn);
    const n = '$' + args.length;
    base.push(`(${SQL_PLANO('p.nombre')} LIKE '%' || ${n} || '%'
      OR ${SQL_PLANO('p.categoria')} LIKE '%' || ${n} || '%'
      OR ${SQL_PLANO('p.sku')} LIKE '%' || ${n} || '%'
      OR ${SQL_PLANO('p.codigo')} LIKE '%' || ${n} || '%'
      OR ${SQL_PLANO('l.nombre')} LIKE '%' || ${n} || '%'
      OR ${SQL_PLANO('l.marca')} LIKE '%' || ${n} || '%')`);
  }
  if (op.precioMax > 0) {
    args.push(op.precioMax);
    base.push(`${precioEfectivo('p.')} <= $${args.length}`);
  }

  // Los chips de categoría se calculan sin el filtro de categoría: así se
  // puede cambiar de rubro sin perder el texto ni el precio máximo.
  const cats = await pool.query(
    `SELECT p.categoria AS nombre, COUNT(*)::int AS n
       FROM ${T_PRODUCTOS} p JOIN ${T_LOCALES} l ON l.id = p.local_id
      WHERE ${base.join(' AND ')} AND p.categoria <> ''
      GROUP BY p.categoria ORDER BY n DESC, p.categoria COLLATE "C" LIMIT 8`,
    args
  );

  const where = base.slice();
  const argsFiltro = args.slice();
  if (op.categoria) {
    argsFiltro.push(plano(op.categoria));
    where.push(`${SQL_PLANO('p.categoria')} = $${argsFiltro.length}`);
  }

  const cuenta = await pool.query(
    `SELECT COUNT(*)::int AS n, COUNT(DISTINCT l.id)::int AS tiendas
       FROM ${T_PRODUCTOS} p JOIN ${T_LOCALES} l ON l.id = p.local_id
      WHERE ${where.join(' AND ')}`,
    argsFiltro
  );

  const argsFinal = argsFiltro.slice();
  let dist = 'NULL::float8';
  if (op.lat !== null && op.lon !== null) {
    argsFinal.push(op.lat, op.lon);
    const i = argsFinal.length - 1;
    // Distancia haversine en km, con el dominio de acos acotado a [-1, 1].
    dist = `ROUND((6371 * acos(least(1, greatest(-1, sin(radians($${i}::float8)) * sin(radians(l.lat)) + cos(radians($${i}::float8)) * cos(radians(l.lat)) * cos(radians(l.lon - $${i + 1}::float8))))))::numeric, 1)::float8`;
  }

  // Una tienda cerrada no puede recibir pedidos (`pedido_crear` la rechaza),
  // así que se muestra al final para no tapar a las que sí están atendiendo.
  // La tarjeta del comprador la marca «cerrada».
  const abiertasPrimero = '(l.abierto = false) ASC';
  let ordenSql: string;
  if (op.orden === 'precio') {
    ordenSql = `${abiertasPrimero}, ${precioEfectivo('p.')} ASC, p.nombre COLLATE "C"`;
  } else if (op.orden === 'precio-desc') {
    ordenSql = `${abiertasPrimero}, ${precioEfectivo('p.')} DESC, p.nombre COLLATE "C"`;
  } else if (op.orden === 'nombre') {
    ordenSql = `${abiertasPrimero}, p.nombre COLLATE "C"`;
  } else {
    ordenSql = `${abiertasPrimero}, dist_km ASC NULLS LAST, ${precioEfectivo('p.')} ASC, p.nombre COLLATE "C"`;
  }

  const r = await pool.query(
    `SELECT ${camposProducto('p.')},
            l.nombre AS local_nombre, l.marca AS local_marca, l.logo AS local_logo,
            l.comuna AS local_comuna, l.direccion AS local_direccion,
            l.lat::float8 AS local_lat, l.lon::float8 AS local_lon,
            l.abierto AS local_abierto, l.entrega AS local_entrega,
            l.envio::float8 AS local_envio, l.minimo::float8 AS local_minimo,
            ${dist} AS dist_km
       FROM ${T_PRODUCTOS} p JOIN ${T_LOCALES} l ON l.id = p.local_id
      WHERE ${where.join(' AND ')}
      ORDER BY ${ordenSql}
      LIMIT ${op.limite}`,
    argsFinal
  );

  const tiendaDe = (f: any) => ({
    id: String(f.local_id || ''),
    nombre: f.local_nombre || '',
    marca: f.local_marca || '',
    logo: f.local_logo || '',
    comuna: f.local_comuna || '',
    direccion: f.local_direccion || '',
    lat: Number(f.local_lat) || 0,
    lon: Number(f.local_lon) || 0,
    abierto: f.local_abierto !== false,
    entrega: Array.isArray(f.local_entrega) ? f.local_entrega : ['retiro'],
    envio: Number(f.local_envio) || 0,
    minimo: Number(f.local_minimo) || 0,
  });

  return {
    total: Number(cuenta.rows[0] && cuenta.rows[0].n) || 0,
    tiendas: Number(cuenta.rows[0] && cuenta.rows[0].tiendas) || 0,
    categorias: cats.rows.map((f: any) => ({
      nombre: f.nombre || '',
      n: Number(f.n) || 0,
    })),
    resultados: r.rows.map((f: any) => ({
      tienda: tiendaDe(f),
      producto: productoDeFila(f),
      dist: f.dist_km === null || f.dist_km === undefined
        ? null
        : Math.round(Number(f.dist_km) * 10) / 10,
    })),
  };
}

/** Nombre público de quien opina: «Ana P.». Nunca el nombre ni el teléfono
 *  completos, y sin acentos raros: se muestra tal cual en la ficha. */
function autorPublico(nombre: unknown): string {
  const partes = texto(nombre, 120).trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return 'Cliente';
  const primero = partes[0].slice(0, 24);
  if (partes.length === 1) return primero;
  return primero + ' ' + partes[partes.length - 1].charAt(0).toUpperCase() + '.';
}

/* ── escrituras ─────────────────────────────────────────────────────────── */

/* ── avisos push ────────────────────────────────────────────────────────── */

/**
 * VAPID desde el entorno. Si falta alguna de las dos claves el push queda
 * apagado y la API sigue funcionando: la suscripción responde 503 con un
 * mensaje claro en vez de romper el pedido o el panel.
 */
function vapidConfig() {
  const publica = String(process.env.VAPID_PUBLIC || '').trim();
  const privada = String(process.env.VAPID_PRIVATE || '').trim();
  if (!publica || !privada) return null;
  return {
    publica,
    privada,
    subject: String(process.env.VAPID_SUBJECT || 'mailto:soporte@fabrick.cl').trim(),
  };
}

function sitioPublico(): string {
  return String(process.env.PUBLIC_SITE || 'https://forge-core-stock.vercel.app').replace(/\/+$/, '');
}

/** Aviso corto para la notificación: sin teléfono ni nombre completo. */
function textoAviso(estado: string, pedido: any) {
  const local = texto(pedido.local_nombre, 80).trim() || 'Tu local';
  const delivery = pedido.entrega === 'delivery';
  let cuerpo = 'Recibimos tu pedido.';
  if (estado === 'visto') cuerpo = 'Están preparando tu pedido.';
  else if (estado === 'listo') cuerpo = delivery ? 'Tu pedido va en camino.' : 'Tu pedido está listo para retirar.';
  else if (estado === 'entregado') cuerpo = 'Pedido entregado. Puedes calificarlo.';
  else if (estado === 'cancelado') cuerpo = 'Tu pedido fue cancelado.';
  return {
    titulo: local,
    cuerpo,
    codigo: texto(pedido.codigo, 20),
    url: sitioPublico() + '/seguir.html?t=' + encodeURIComponent(texto(pedido.seguimiento, 64)),
  };
}

/**
 * Manda el aviso a los dispositivos suscritos a ese pedido. Es "mejor
 * esfuerzo": si el servicio de push falla, el cambio de estado ya quedó
 * guardado y el panel no se entera. Una suscripción muerta (404/410) se borra.
 */
async function despachar(pool: any, tabla: string, filas: any[], aviso: string, cfg: any): Promise<number> {
  if (!filas.length) return 0;
  let enviados = 0;
  await Promise.allSettled(filas.map(async (s: any) => {
    try {
      const r = await enviarPush(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        aviso,
        { publica: cfg.publica, privada: cfg.privada, subject: cfg.subject, timeoutMs: 1000 }
      );
      if (r.status === 404 || r.status === 410) {
        await pool.query(`DELETE FROM ${tabla} WHERE id = $1`, [s.id]);
      } else if (r.ok) {
        enviados++;
        await pool.query(`UPDATE ${tabla} SET ultimo_ok = now() WHERE id = $1`, [s.id]);
      }
    } catch (e) { /* sin red o servicio caído: se ignora */ }
  }));
  return enviados;
}

async function avisarCambio(pool: any, pedidoId: string, estado: string): Promise<number> {
  const cfg = vapidConfig();
  if (!cfg) return 0;
  try {
    const p = await pool.query(
      `SELECT p.codigo,p.seguimiento,p.entrega,l.nombre AS local_nombre
         FROM ${T_PEDIDOS} p LEFT JOIN ${T_LOCALES} l ON l.id = p.local_id
        WHERE p.id = $1`, [pedidoId]
    );
    const pedido = p.rows[0];
    if (!pedido || !pedido.seguimiento) return 0;

    // Tres dispositivos por pedido como máximo: el aviso sale rápido y no se
    // come el tiempo de la función.
    const subs = await pool.query(
      `SELECT id,endpoint,p256dh,auth FROM ${T_PUSH} WHERE pedido_id = $1 LIMIT 3`,
      [pedidoId]
    );
    if (!subs.rowCount) return 0;

    return await despachar(pool, T_PUSH, subs.rows, JSON.stringify(textoAviso(estado, pedido)), cfg);
  } catch (e) { /* base o red: el pedido ya está actualizado */ }
  return 0;
}

/**
 * Avisa al dueño que entró un pedido. Va después del commit y con tope corto:
 * el comprador está esperando su confirmación, así que si el push tarda se
 * corta y el pedido ya está guardado igual.
 */
async function avisarLocal(pool: any, localId: string, pedido: any): Promise<number> {
  const cfg = vapidConfig();
  if (!cfg) return 0;
  try {
    const subs = await pool.query(
      `SELECT id,endpoint,p256dh,auth FROM ${T_PUSH_LOCAL} WHERE local_id = $1 LIMIT 3`,
      [localId]
    );
    if (!subs.rowCount) return 0;
    const monto = '$' + Math.round(Number(pedido.total) || 0).toLocaleString('es-CL');
    const quien = texto(pedido.cliente, 40).trim().split(/\s+/)[0] || 'Cliente';
    const aviso = JSON.stringify({
      titulo: 'Nuevo pedido ' + texto(pedido.codigo, 20),
      cuerpo: monto + ' · ' + quien + ' · ' + (pedido.entrega === 'delivery' ? 'delivery' : 'retiro'),
      codigo: texto(pedido.codigo, 20),
      url: sitioPublico() + '/app/#negocio',
    });
    return await despachar(pool, T_PUSH_LOCAL, subs.rows, aviso, cfg);
  } catch (e) { return 0; }
}

/** Nombre comparable: sin acentos, minúsculas y espacios simples. */
function nombreClave(v: unknown): string {
  return texto(v, 160).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Estados terminales: un pedido entregado o cancelado ya no se mueve. Evita
 * que un toque equivocado devuelva a «listo» un pedido que el comprador ya
 * recibió (y que el historial y el stock queden mintiendo).
 */
const ESTADOS_FINALES = ['entregado', 'cancelado'];

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
      codigo: texto(f.codigo, MAX_CODIGO).trim(),
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

    /* Foto de producto: bytes desde la base, con URL versionada e inmutable.
       Público: la foto se muestra en el catálogo, el carrito y el link de
       marca. No pide cuenta ni clave. */
    if (url.searchParams.get('accion') === 'imagen_ver') {
      if (!process.env.INSFORGE_DATABASE_URL) {
        res.writeHead(503, { 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      const localId = idLocal(url.searchParams.get('local_id') || '');
      const sku = texto(url.searchParams.get('sku') || '', 60).trim();
      if (!localId || !sku) {
        res.writeHead(400, { 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      let pool: any = null;
      try {
        const { Pool } = await import('pg');
        pool = new Pool({
          connectionString: process.env.INSFORGE_DATABASE_URL,
          ssl: { rejectUnauthorized: false },
          connectionTimeoutMillis: 15000,
          max: 1,
        });
        const r = await pool.query(
          `SELECT imagen FROM ${T_PRODUCTOS} WHERE local_id = $1 AND sku = $2 LIMIT 1`,
          [localId, sku]
        );
        const data = r.rows[0] && r.rows[0].imagen;
        const m = typeof data === 'string'
          ? /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(data)
          : null;
        if (!m) {
          res.writeHead(404, { 'Cache-Control': 'no-store' });
          res.end();
          return;
        }
        const bytes = Buffer.from(m[2], 'base64');
        if (!bytes.length || bytes.length > MAX_IMAGEN_BYTES) {
          res.writeHead(404, { 'Cache-Control': 'no-store' });
          res.end();
          return;
        }
        res.writeHead(200, {
          'Content-Type': m[1],
          'Content-Length': String(bytes.length),
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(bytes);
      } catch (e) {
        res.writeHead(500, { 'Cache-Control': 'no-store' });
        res.end();
      } finally {
        if (pool) { try { await pool.end(); } catch (e) { /* ya cerrada */ } }
      }
      return;
    }

    /* Búsqueda entre marcas: un mismo código de barras puede estar en varias
       tiendas. Devuelve cada marca con su producto, ordenado por precio. */
    if (url.searchParams.get('accion') === 'codigo_buscar') {
      const cod = normalizarCodigoBarras(url.searchParams.get('codigo') || '');
      if (!cod.ok || !cod.valor) {
        return json(res, { ok: false, error: 'código de barras inválido', codigo: 'CODIGO_INVALIDO' }, 400);
      }
      if (!process.env.INSFORGE_DATABASE_URL) {
        return json(res, { ok: false, error: 'base no configurada', codigo: 'SIN_BASE' }, 503);
      }
      let pool: any = null;
      try {
        const { Pool } = await import('pg');
        pool = new Pool({
          connectionString: process.env.INSFORGE_DATABASE_URL,
          ssl: { rejectUnauthorized: false },
          connectionTimeoutMillis: 15000,
          max: 2,
        });
        // Sin DDL en una lectura pública: el esquema lo asegura el panel al
        // publicar el catálogo. La búsqueda tiene que ser rápida.
        const resultados = await buscarPorCodigo(pool, cod.valor);
        return json(res, {
          ok: true, accion: 'codigo_buscar', codigo: cod.valor,
          total: resultados.length, resultados,
        });
      } catch (e: any) {
        return json(res, { ok: false, error: e?.message || String(e), codigo: 'ERROR_BASE' }, 500);
      } finally {
        if (pool) { try { await pool.end(); } catch (e) { /* ya cerrada */ } }
      }
    }

    /* Búsqueda global de productos: texto, categoría, precio y cercanía.
       Es pública y no crea tablas: sólo lee el catálogo de los locales
       activos. Devuelve la tienda liviana, sin su catálogo completo. */
    if (url.searchParams.get('accion') === 'productos_buscar') {
      const op = leerBusqueda({
        q: url.searchParams.get('q') || url.searchParams.get('buscar') || '',
        categoria: url.searchParams.get('categoria') || '',
        precio_max: url.searchParams.get('precio_max') || url.searchParams.get('precio') || '',
        lat: url.searchParams.get('lat'),
        lon: url.searchParams.get('lon'),
        orden: url.searchParams.get('orden') || '',
        limite: url.searchParams.get('limite') || '',
      });
      if (!op) {
        return json(res, {
          ok: false, codigo: 'BUSQUEDA_CORTA',
          error: 'escribe al menos 2 letras, una categoría o un precio máximo',
        }, 400);
      }
      if (!process.env.INSFORGE_DATABASE_URL) {
        return json(res, { ok: false, error: 'base no configurada', codigo: 'SIN_BASE' }, 503);
      }
      let pool: any = null;
      try {
        const { Pool } = await import('pg');
        pool = new Pool({
          connectionString: process.env.INSFORGE_DATABASE_URL,
          ssl: { rejectUnauthorized: false },
          connectionTimeoutMillis: 15000,
          max: 2,
        });
        const d = await buscarProductos(pool, op);
        return json(res, {
          ok: true, accion: 'productos_buscar',
          q: op.q, categoria: op.categoria, precio_max: op.precioMax, orden: op.orden,
          ...d,
        });
      } catch (e: any) {
        return json(res, { ok: false, error: e?.message || String(e), codigo: 'ERROR_BASE' }, 500);
      } finally {
        if (pool) { try { await pool.end(); } catch (e) { /* ya cerrada */ } }
      }
    }

    /* Link público de marca: una sola tienda, con su catálogo. No pide cuenta
       ni clave; sólo devuelve locales activos. */
    if (url.searchParams.get('accion') === 'local_ver' || url.searchParams.get('accion') === 'local') {
      if (!process.env.INSFORGE_DATABASE_URL) {
        return json(res, { ok: false, error: 'base no configurada', codigo: 'SIN_BASE' }, 503);
      }
      const localId = idLocal(url.searchParams.get('id') || url.searchParams.get('local_id'));
      if (!localId) {
        return json(res, { ok: false, error: 'falta el id de la marca', codigo: 'SIN_ID' }, 400);
      }
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
        const l = await traerLocal(pool, localId);
        if (!l) {
          return json(res, {
            ok: false, error: 'esa marca no existe o ya no está publicada',
            codigo: 'NO_ENCONTRADO',
          }, 404);
        }
        return json(res, { ok: true, v: 2, origen: 'insforge', tienda: aTienda(l) });
      } catch (e: any) {
        return json(res, { ok: false, error: e?.message || String(e), codigo: 'ERROR_BASE' }, 500);
      } finally {
        if (pool) { try { await pool.end(); } catch (e) { /* ya cerrada */ } }
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
        'asegurar', 'locales', 'local_ver', 'local_crear', 'local_mio', 'local_actualizar',
        'local_estado', 'local_borrar', 'productos_subir', 'producto_borrar',
        'imagen_ver', 'codigo_buscar', 'productos_buscar',
        'pedido_crear', 'pedido_seguir', 'push_suscribir', 'push_baja',
        'push_local_suscribir', 'push_local_baja',
        'pedidos_listar', 'pedido_estado',
        'resenas_listar', 'resena_crear', 'resenas_panel', 'resena_moderar',
        'ventas_serie', 'resumen',
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
      return json(res, { ok: true, accion, tablas: [T_LOCALES, T_PRODUCTOS, T_PEDIDOS, T_EVENTOS, T_RESENAS, T_PUSH, T_PUSH_LOCAL] });
    }

    /* Misma lectura pública del link de marca, por POST para la APK. */
    if (accion === 'local_ver' || accion === 'local') {
      const localId = idLocal(cuerpo.local_id || cuerpo.id);
      if (!localId) {
        return json(res, { ok: false, error: 'falta el id de la marca', codigo: 'SIN_ID' }, 400);
      }
      const l = await traerLocal(pool, localId);
      if (!l) {
        return json(res, {
          ok: false, error: 'esa marca no existe o ya no está publicada',
          codigo: 'NO_ENCONTRADO',
        }, 404);
      }
      return json(res, { ok: true, accion: 'local_ver', v: 2, origen: 'insforge', tienda: aTienda(l) });
    }

    /* ── lecturas por POST (mismo contrato para la APK) ── */
    if (accion === 'codigo_buscar') {
      const cod = normalizarCodigoBarras(cuerpo.codigo);
      if (!cod.ok || !cod.valor) {
        return json(res, { ok: false, error: 'código de barras inválido', codigo: 'CODIGO_INVALIDO' }, 400);
      }
      const resultados = await buscarPorCodigo(pool, cod.valor);
      return json(res, {
        ok: true, accion, codigo: cod.valor,
        total: resultados.length, resultados,
      });
    }

    /* Búsqueda global por POST: el mismo contrato para la APK. */
    if (accion === 'productos_buscar') {
      const op = leerBusqueda(cuerpo);
      if (!op) {
        return json(res, {
          ok: false, codigo: 'BUSQUEDA_CORTA',
          error: 'escribe al menos 2 letras, una categoría o un precio máximo',
        }, 400);
      }
      const d = await buscarProductos(pool, op);
      return json(res, {
        ok: true, accion,
        q: op.q, categoria: op.categoria, precio_max: op.precioMax, orden: op.orden,
        ...d,
      });
    }

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
          `SELECT ${CAMPOS_PRODUCTO}
             FROM ${T_PRODUCTOS} WHERE local_id = ANY($1::text[])
            ORDER BY local_id, nombre COLLATE "C"`,
          [ids]
        );
        for (const f of p.rows) {
          (catalogo[f.local_id] = catalogo[f.local_id] || []).push(productoDeFila(f));
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
      // Los avisos cuelgan del pedido: se van antes que los pedidos.
      await pool.query(
        `DELETE FROM ${T_PUSH}
          WHERE pedido_id IN (SELECT id FROM ${T_PEDIDOS} WHERE local_id = $1)`, [localId]
      );
      await pool.query(`DELETE FROM ${T_PEDIDOS} WHERE local_id = $1`, [localId]);
      // Las reseñas cuelgan del local, no del pedido: si no se borran quedan
      // huérfanas y reaparecen si alguien reabre una tienda con el mismo id.
      await pool.query(`DELETE FROM ${T_RESENAS} WHERE local_id = $1`, [localId]);
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
      const codigosInvalidos: Array<{ sku: string; codigo: string }> = [];
      for (let i = 0; i < crudos.length; i++) {
        const f = crudos[i];
        if (!f || typeof f !== 'object') continue;
        const p = f as Fila;
        const nombre = texto(p.nombre, 160).trim();
        const precio = numero(p.precio);
        if (!nombre || precio <= 0) { omitidos.push(nombre || '(sin nombre)'); continue; }
        const sku = texto(p.sku, 60).trim() || ('p' + (i + 1));
        // Descuento: porcentaje entero 0–90. Si el lote NO trae la columna, se
        // conserva el que ya estaba: importar stock no debe borrar una oferta.
        // Si la trae con 0, la oferta se apaga (y su fecha se limpia).
        const tocaOferta = 'descuento' in p || 'oferta_hasta' in p;
        const dcto = tocaOferta ? entero(p.descuento, DCTO_MAX) : 0;
        const hasta = dcto ? fechaSegundos(p.oferta_hasta) : 0;
        /* La foto se guarda como data URL y se publica por `imagen_ver`. Si el
           lote no trae `imagen`, se conserva la que ya estaba: importar stock
           no debe borrar las fotos. */
        const tocaImagen = 'imagen' in p;
        const foto = tocaImagen ? normalizarImagen(p.imagen) : { ok: false, valor: '' };
        const imagen = foto.ok ? foto.valor : '';
        const imagenHash = imagen
          ? createHash('sha256').update(imagen).digest('hex').slice(0, 12)
          : '';
        /* Código de barras real. Si el lote no trae la columna, se conserva el
           que ya estaba (importar stock no debe borrar códigos). Un valor
           inválido se guarda como vacío y se informa: nunca se inventa uno. */
        const tocaCodigo = 'codigo' in p;
        const cod = tocaCodigo ? normalizarCodigoBarras(p.codigo) : { ok: false, valor: '' };
        const codigo = cod.ok ? cod.valor : '';
        if (tocaCodigo && String(p.codigo == null ? '' : p.codigo).trim() && !cod.ok) {
          codigosInvalidos.push({ sku, codigo: texto(p.codigo, 60).trim() });
        }
        await cliente.query(
          `INSERT INTO ${T_PRODUCTOS}
             (local_id,sku,nombre,precio,stock,categoria,unidad,actualizado,descuento,oferta_hasta,imagen,imagen_hash,codigo)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (local_id,sku) DO UPDATE SET
             nombre = EXCLUDED.nombre, precio = EXCLUDED.precio, stock = EXCLUDED.stock,
             categoria = EXCLUDED.categoria, unidad = EXCLUDED.unidad,
             descuento = CASE WHEN $14::boolean THEN EXCLUDED.descuento
                              ELSE ${T_PRODUCTOS}.descuento END,
             oferta_hasta = CASE WHEN $14::boolean THEN EXCLUDED.oferta_hasta
                                 ELSE ${T_PRODUCTOS}.oferta_hasta END,
             imagen = CASE WHEN $15::boolean THEN EXCLUDED.imagen
                           ELSE ${T_PRODUCTOS}.imagen END,
             imagen_hash = CASE WHEN $15::boolean THEN EXCLUDED.imagen_hash
                                ELSE ${T_PRODUCTOS}.imagen_hash END,
             codigo = CASE WHEN $16::boolean THEN EXCLUDED.codigo
                           ELSE ${T_PRODUCTOS}.codigo END,
             actualizado = EXCLUDED.actualizado, nube_ts = now()`,
          [localId, sku, nombre, precio,
            p.stock === null || p.stock === undefined || p.stock === '' ? null : entero(p.stock),
            texto(p.categoria, 40).trim(), texto(p.unidad, 30).trim(), ahora, dcto, hasta,
            imagen, imagenHash, codigo, tocaOferta, foto.ok, cod.ok]
        );
        subidos++;
      }

      const c = await cliente.query(
        `SELECT COUNT(*)::int AS n,
                COUNT(*) FILTER (WHERE ${dctoVigente()} > 0)::int AS ofertas
           FROM ${T_PRODUCTOS} WHERE local_id = $1`, [localId]
      );
      const total = c.rows[0].n;
      const ofertas = c.rows[0].ofertas;
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
      return json(res, {
        ok: true, accion, subidos, omitidos: omitidos.length,
        detalle_omitidos: omitidos.slice(0, 10),
        codigos_invalidos: codigosInvalidos.length,
        detalle_codigos_invalidos: codigosInvalidos.slice(0, 10),
        total, ofertas, tope,
      });
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
      let cliente_pg: any = null;
      const localId = idLocal(cuerpo.local_id);
      const rl = await pool.query(
        `SELECT id,nombre,minimo,abierto,entrega,envio,activo FROM ${T_LOCALES} WHERE id = $1`, [localId]
      );
      const local = rl.rows[0];
      if (!local || !local.activo) return json(res, { ok: false, error: 'local no encontrado' }, 404);
      if (local.abierto === false) {
        return json(res, { ok: false, error: 'el local está cerrado', codigo: 'CERRADO' }, 409);
      }

      // Idempotencia: el mismo intento repetido devuelve el pedido que ya se
      // creó, en vez de duplicarlo. Es lo que pasa con doble toque o cuando la
      // red del teléfono se corta justo después de enviar.
      const idem = texto(cuerpo.idempotencia, 80).replace(/[^A-Za-z0-9_-]/g, '');
      if (idem) {
        const ya = await pool.query(
          `SELECT id,codigo,seguimiento,subtotal::float8 AS subtotal,envio::float8 AS envio,
                  total::float8 AS total,ahorro::float8 AS ahorro,estado,
                  metodo_pago,pago_con::float8 AS pago_con,vuelto::float8 AS vuelto,clave_entrega
             FROM ${T_PEDIDOS} WHERE local_id = $1 AND idempotencia = $2 LIMIT 1`,
          [localId, idem]
        );
        if (ya.rowCount) {
          const p = ya.rows[0];
          return json(res, {
            ok: true, accion, id: p.id, codigo: p.codigo, seguimiento: p.seguimiento,
            subtotal: p.subtotal, envio: p.envio, total: p.total, ahorro: p.ahorro,
            estado: p.estado, repetido: true,
            metodo_pago: p.metodo_pago, pago_con: p.pago_con, vuelto: p.vuelto,
            clave_entrega: p.clave_entrega,
          });
        }
      }

      const crudos = normalizarItems(cuerpo.items);
      if (!crudos.length) return json(res, { ok: false, error: 'el pedido no tiene productos válidos' }, 400);
      if (crudos.length > 100) {
        return json(res, { ok: false, error: 'el pedido tiene demasiadas líneas (máximo 100)' }, 400);
      }

      // Los precios NO se creen al cliente: se buscan en el catálogo del local.
      // Si un producto no está (o cambió de nombre), se rechaza con claridad en
      // vez de cobrar un precio inventado. El descuento también sale de acá:
      // `precio_efectivo` es el único número que se cobra.
      const cat = await pool.query(
        `SELECT ${CAMPOS_PRODUCTO} FROM ${T_PRODUCTOS} WHERE local_id = $1`,
        [localId]
      );
      const porSku = new Map<string, any>();
      const porNombre = new Map<string, any>();
      for (const f of cat.rows) {
        if (f.sku) porSku.set(String(f.sku), f);
        porNombre.set(nombreClave(f.nombre), f);
      }

      const items: any[] = [];
      for (const it of crudos) {
        const enCat = (it.sku && porSku.get(it.sku)) || porNombre.get(nombreClave(it.nombre)) || null;
        if (!enCat) {
          return json(res, {
            ok: false, codigo: 'NO_CATALOGO',
            error: `«${it.nombre}» ya no está en el catálogo del local`,
            producto: it.nombre,
          }, 409);
        }
        const stock = enCat.stock === null || enCat.stock === undefined ? null : Number(enCat.stock);
        if (stock !== null && it.cantidad > stock) {
          return json(res, {
            ok: false, codigo: 'SIN_STOCK',
            error: stock > 0
              ? `sólo quedan ${stock} de «${enCat.nombre}»`
              : `«${enCat.nombre}» está agotado`,
            producto: enCat.nombre, disponible: stock,
          }, 409);
        }
        const lista = Number(enCat.precio) || 0;
        const efectivo = Number(enCat.precio_efectivo) || lista;
        const dcto = Number(enCat.descuento_vigente) || 0;
        items.push({
          sku: enCat.sku,
          codigo: enCat.codigo || '',
          nombre: enCat.nombre,
          precio: efectivo,
          precio_lista: lista,
          descuento: dcto,
          cantidad: it.cantidad,
          categoria: it.categoria,
          unidad: it.unidad,
          imagen: enCat.imagen || '',
          stock,
        });
      }

      const subtotal = items.reduce((a, it) => a + it.precio * it.cantidad, 0);
      // Lo que el comprador dejó de pagar gracias a las ofertas vigentes.
      const ahorro = items.reduce((a, it) => a + (it.precio_lista - it.precio) * it.cantidad, 0);
      if (!subtotal) return json(res, { ok: false, error: 'el pedido suma cero' }, 400);
      if (subtotal > 5_000_000) {
        return json(res, { ok: false, error: 'el pedido supera el máximo permitido' }, 400);
      }
      if (local.minimo > 0 && subtotal < local.minimo) {
        return json(res, {
          ok: false,
          error: `el pedido mínimo es ${local.minimo} y el pedido suma ${subtotal}`,
          codigo: 'BAJO_MINIMO', minimo: local.minimo, subtotal,
        }, 409);
      }

      // El local tiene que poder responder: nombre y teléfono son la única
      // forma de avisar y de que el comprador recupere el pedido sin enlace.
      const nombreCliente = texto(cuerpo.cliente, 120).trim();
      const telefono = texto(cuerpo.telefono, 30).replace(/[^\d+]/g, '');
      if (nombreCliente.length < 2) {
        return json(res, { ok: false, codigo: 'SIN_NOMBRE', error: 'falta el nombre de quien pide' }, 400);
      }
      if (telefono.replace(/\D/g, '').length < 8) {
        return json(res, { ok: false, codigo: 'SIN_TELEFONO', error: 'falta un teléfono válido' }, 400);
      }

      const permitidas: string[] = Array.isArray(local.entrega) ? local.entrega : ['retiro'];
      let entrega = texto(cuerpo.entrega, 20).trim();
      if (!permitidas.includes(entrega)) entrega = permitidas[0] || 'retiro';
      const envio = entrega === 'delivery' ? Number(local.envio) || 0 : 0;
      const total = subtotal + envio;

      /* Fase 3: forma de pago, efectivo y dirección completa. El total ya está
         calculado con el catálogo, así que el vuelto se recalcula acá y no se
         confía en el número que mande el navegador. */
      const metodoPago = texto(cuerpo.metodo_pago, 20).trim().toLowerCase();
      const pago = PAGOS.includes(metodoPago) ? metodoPago : '';
      const efectivo = pago === 'efectivo'
        ? efectivoDe(total, cuerpo.pago_con)
        : { dado: 0, vuelto: 0, faltan: 0 };
      if (efectivo.faltan) {
        return json(res, {
          ok: false, codigo: 'PAGO_CORTO',
          error: `el efectivo no alcanza: faltan ${efectivo.faltan}`,
          faltan: efectivo.faltan, total,
        }, 400);
      }
      const direccion = texto(cuerpo.direccion, 200).trim();
      const comunaEntrega = texto(cuerpo.comuna_entrega, 80).trim();
      const referenciaEntrega = texto(cuerpo.referencia_entrega, 160).trim();
      if (entrega === 'delivery') {
        if (direccion.length < 5) {
          return json(res, { ok: false, codigo: 'SIN_DIRECCION', error: 'falta la calle y el número para el delivery' }, 400);
        }
        if (comunaEntrega.length < 2) {
          return json(res, { ok: false, codigo: 'SIN_COMUNA', error: 'falta la comuna para el delivery' }, 400);
        }
      }
      // Lo muestra el comprador y lo pide el local al entregar. Los pedidos
      // viejos tienen '' y se pueden cerrar como antes.
      const claveEntrega = claveDeEntrega();

      const id = 'ped-' + Date.now().toString(36) + randomBytes(3).toString('hex');
      // El token de seguimiento no se deriva del id ni del código.
      const seguimiento = randomBytes(10).toString('hex');
      const nota = texto(cuerpo.nota, 300).trim();

      // La transacción descuenta stock y crea el pedido como una sola cosa: si
      // el stock no alcanza, no queda un pedido a medias.
      let intento = 0;
      for (;;) {
        intento++;
        const codigo = codigoPedido();
        cliente_pg = await pool.connect();
        try {
          await cliente_pg.query('BEGIN');
          for (const it of items) {
            if (it.stock === null) continue;      // stock null = sin límite
            const descontado = await cliente_pg.query(
              `UPDATE ${T_PRODUCTOS} SET stock = stock - $3
                WHERE local_id = $1 AND sku = $2 AND stock IS NOT NULL AND stock >= $3`,
              [localId, it.sku, it.cantidad]
            );
            if (!descontado.rowCount) {
              await cliente_pg.query('ROLLBACK');
              return json(res, {
                ok: false, codigo: 'SIN_STOCK',
                error: `«${it.nombre}» se agotó mientras armabas el pedido`,
                producto: it.nombre, disponible: 0,
              }, 409);
            }
          }

          await cliente_pg.query(
            `INSERT INTO ${T_PEDIDOS}
               (id,local_id,codigo,cliente,telefono,items,subtotal,envio,total,entrega,
                direccion,nota,estado,seguimiento,idempotencia,ahorro,
                comuna_entrega,referencia_entrega,metodo_pago,pago_con,vuelto,clave_entrega)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,'nuevo',$13,$14,$15,
                     $16,$17,$18,$19,$20,$21)`,
            [id, localId, codigo, nombreCliente, telefono,
              JSON.stringify(items.map((x) => ({
                sku: x.sku, codigo: x.codigo || '', nombre: x.nombre, precio: x.precio,
                precio_lista: x.precio_lista, descuento: x.descuento,
                cantidad: x.cantidad, categoria: x.categoria, unidad: x.unidad,
                imagen: x.imagen || '',
              }))),
              subtotal, envio, total, entrega,
              direccion, nota, seguimiento, idem, ahorro,
              comunaEntrega, referenciaEntrega, pago, efectivo.dado, efectivo.vuelto, claveEntrega]
          );
          await cliente_pg.query(
            `INSERT INTO ${T_EVENTOS} (pedido_id, estado, actor, nota)
             VALUES ($1, 'nuevo', 'comprador', $2)`,
            [id, 'pedido creado' + (entrega === 'delivery' ? ' (delivery)' : ' (retiro)')]
          );
          await cliente_pg.query('COMMIT');
        } catch (e: any) {
          try { await cliente_pg.query('ROLLBACK'); } catch (e2) { /* ya cerrada */ }
          const cons = String(e && e.constraint || '');
          // Otro intento con la misma clave ganó la carrera: se devuelve ese.
          if (cons === 'idx_mercado_pedidos_idempotencia' && idem) {
            const ya = await pool.query(
              `SELECT id,codigo,seguimiento,subtotal::float8 AS subtotal,envio::float8 AS envio,
                      total::float8 AS total,ahorro::float8 AS ahorro,estado,
                      metodo_pago,pago_con::float8 AS pago_con,vuelto::float8 AS vuelto,clave_entrega
                 FROM ${T_PEDIDOS} WHERE local_id = $1 AND idempotencia = $2 LIMIT 1`,
              [localId, idem]
            );
            if (ya.rowCount) {
              const p = ya.rows[0];
              return json(res, {
                ok: true, accion, id: p.id, codigo: p.codigo, seguimiento: p.seguimiento,
                subtotal: p.subtotal, envio: p.envio, total: p.total, ahorro: p.ahorro,
                estado: p.estado, repetido: true,
                metodo_pago: p.metodo_pago, pago_con: p.pago_con, vuelto: p.vuelto,
                clave_entrega: p.clave_entrega,
              });
            }
          }
          // Código repetido (32^5 combinaciones): se prueba con otro.
          if (cons === 'idx_mercado_pedidos_codigo' && intento < 5) continue;
          throw e;
        } finally {
          try { cliente_pg.release(); } catch (e) { /* ya liberado */ }
          cliente_pg = null;
        }
        // Aviso al dueño con el panel cerrado. Va al final: el pedido ya está
        // guardado y, si el push tarda, se corta solo.
        try { await avisarLocal(pool, localId, { codigo, total, cliente: nombreCliente, entrega }); }
        catch (e) { /* el pedido ya está guardado: el aviso es opcional */ }
        return json(res, {
          ok: true, accion, id, codigo, seguimiento, subtotal, envio, total, ahorro, estado: 'nuevo',
          // Fase 3: el comprador necesita ver el vuelto y el código de entrega
          // en el momento; el local recibe el pago y el resumen, sin el código.
          metodo_pago: pago, pago_con: efectivo.dado, vuelto: efectivo.vuelto,
          clave_entrega: claveEntrega,
          comuna_entrega: comunaEntrega, referencia_entrega: referenciaEntrega,
        });
      }
    }

    /* ── seguimiento del comprador (PÚBLICO) ────────────────────────────────
       Dos formas de abrir un pedido sin cuenta:
         · `{ token }`  → el enlace que se le entrega al comprar.
         · `{ codigo, contacto }` → el código MP-XXXXX y los últimos 4 dígitos
           del teléfono con que se hizo el pedido.
       Nunca devuelve el teléfono completo, el token ni el id interno. */
    if (accion === 'pedido_seguir') {
      const ip = ipDe(req);
      const pushCfg = vapidConfig();
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
              p.entrega, p.direccion, p.comuna_entrega, p.referencia_entrega,
              p.metodo_pago, p.pago_con::float8 AS pago_con, p.vuelto::float8 AS vuelto,
              p.clave_entrega, p.nota, p.estado, p.creado, p.actualizado,
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
          comuna_entrega: fila.comuna_entrega || '',
          referencia_entrega: fila.referencia_entrega || '',
          // El comprador es el dueño de este código: lo muestra para que el
          // repartidor o el local lo pidan al entregar.
          metodo_pago: fila.metodo_pago || '',
          pago_con: fila.pago_con || 0,
          vuelto: fila.vuelto || 0,
          clave_entrega: fila.clave_entrega || '',
          nota: fila.nota,
          estado: fila.estado,
          creado: fila.creado,
          actualizado: fila.actualizado,
          eventos: ev.rows,
          // La clave pública de VAPID es pública por definición: el navegador
          // la necesita para suscribirse. Si el push está apagado, no se finge.
          push: pushCfg
            ? { disponible: true, clave: pushCfg.publica }
            : { disponible: false, clave: '' },
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

    /* ── avisos push del comprador (PÚBLICO, con el token del pedido) ──────
       El comprador suscribe su navegador desde la página de seguimiento. El
       pedido se identifica con el mismo token del enlace: no hay cuenta.
       El `endpoint` es una URL de capacidad y nunca se devuelve. */
    if (accion === 'push_suscribir') {
      const cfg = vapidConfig();
      if (!cfg) {
        return json(res, {
          ok: false, codigo: 'SIN_PUSH',
          error: 'las notificaciones no están configuradas en este servidor',
        }, 503);
      }
      const sus = (cuerpo.suscripcion && typeof cuerpo.suscripcion === 'object' ? cuerpo.suscripcion : {}) as Fila;
      const claves = (sus.keys && typeof sus.keys === 'object' ? sus.keys : {}) as Fila;
      const endpoint = texto(sus.endpoint, 1000).trim();
      const p256dh = texto(claves.p256dh, 200).trim();
      const auth = texto(claves.auth, 100).trim();

      if (!endpoint || !p256dh || !auth) {
        return json(res, { ok: false, codigo: 'FALTAN_DATOS', error: 'faltan datos de la suscripción' }, 400);
      }
      if (!/^https:\/\//i.test(endpoint)) {
        return json(res, { ok: false, codigo: 'ENDPOINT', error: 'el endpoint debe ser https' }, 400);
      }
      if (p256dh.length < 40 || auth.length < 10) {
        return json(res, { ok: false, codigo: 'CLAVES', error: 'las claves del navegador no son válidas' }, 400);
      }

      const pedido = await pedidoPorCredencial(pool, cuerpo);
      if (!pedido) {
        return json(res, { ok: false, codigo: 'NO_ENCONTRADO', error: 'no encontramos ese pedido' }, 404);
      }
      if (pedido.estado === 'entregado' || pedido.estado === 'cancelado') {
        return json(res, { ok: false, codigo: 'CERRADO', error: 'ese pedido ya terminó' }, 409);
      }

      // El endpoint es único por pedido: si el navegador vuelve a suscribirse,
      // se actualizan sus claves en vez de duplicar el aviso.
      const huella = sha256hex(endpoint);
      const ya = await pool.query(
        `SELECT id FROM ${T_PUSH} WHERE pedido_id = $1 AND huella = $2`, [pedido.id, huella]
      );
      if (ya.rowCount) {
        await pool.query(
          `UPDATE ${T_PUSH} SET endpoint = $2, p256dh = $3, auth = $4 WHERE id = $1`,
          [ya.rows[0].id, endpoint, p256dh, auth]
        );
        return json(res, { ok: true, accion, avisos: true, actualizado: true });
      }

      const total = await pool.query(
        `SELECT COUNT(*)::int AS n FROM ${T_PUSH} WHERE pedido_id = $1`, [pedido.id]
      );
      if (Number(total.rows[0]?.n) >= 5) {
        return json(res, { ok: false, codigo: 'TOPE', error: 'este pedido ya tiene 5 dispositivos' }, 409);
      }

      await pool.query(
        `INSERT INTO ${T_PUSH} (id,pedido_id,huella,endpoint,p256dh,auth)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        ['push-' + Date.now().toString(36) + randomBytes(4).toString('hex'),
          pedido.id, huella, endpoint, p256dh, auth]
      );
      return json(res, { ok: true, accion, avisos: true });
    }

    if (accion === 'push_baja') {
      const endpoint = texto(cuerpo.endpoint, 1000).trim();
      if (!endpoint) {
        return json(res, { ok: false, codigo: 'FALTAN_DATOS', error: 'falta el endpoint' }, 400);
      }
      const pedido = await pedidoPorCredencial(pool, cuerpo);
      if (!pedido) {
        return json(res, { ok: false, codigo: 'NO_ENCONTRADO', error: 'no encontramos ese pedido' }, 404);
      }
      const r = await pool.query(
        `DELETE FROM ${T_PUSH} WHERE pedido_id = $1 AND huella = $2`,
        [pedido.id, sha256hex(endpoint)]
      );
      return json(res, { ok: true, accion, borrados: r.rowCount });
    }

    /* ── avisos push del dueño (DUEÑO · CLAVE · ADMIN) ─────────────────────
       El navegador del local se suscribe a SU tienda. Se separa del aviso del
       comprador porque la autorización es la del panel, no el token del pedido. */
    if (accion === 'push_local_suscribir') {
      const cfg = vapidConfig();
      if (!cfg) {
        return json(res, {
          ok: false, codigo: 'SIN_PUSH',
          error: 'las notificaciones no están configuradas en este servidor',
        }, 503);
      }
      const localId = idLocal(cuerpo.local_id);
      const { local, motivo } = await autorizarLocal(pool, req, localId, texto(cuerpo.clave, 60));
      if (!local) return json(res, { ok: false, error: 'no autorizado', codigo: motivo }, 401);

      const sus = (cuerpo.suscripcion && typeof cuerpo.suscripcion === 'object' ? cuerpo.suscripcion : {}) as Fila;
      const claves = (sus.keys && typeof sus.keys === 'object' ? sus.keys : {}) as Fila;
      const endpoint = texto(sus.endpoint, 1000).trim();
      const p256dh = texto(claves.p256dh, 200).trim();
      const auth = texto(claves.auth, 100).trim();
      if (!endpoint || !p256dh || !auth) {
        return json(res, { ok: false, codigo: 'FALTAN_DATOS', error: 'faltan datos de la suscripción' }, 400);
      }
      if (!/^https:\/\//i.test(endpoint)) {
        return json(res, { ok: false, codigo: 'ENDPOINT', error: 'el endpoint debe ser https' }, 400);
      }
      if (p256dh.length < 40 || auth.length < 10) {
        return json(res, { ok: false, codigo: 'CLAVES', error: 'las claves del navegador no son válidas' }, 400);
      }

      const huella = sha256hex(endpoint);
      const ya = await pool.query(
        `SELECT id FROM ${T_PUSH_LOCAL} WHERE local_id = $1 AND huella = $2`, [localId, huella]
      );
      if (ya.rowCount) {
        await pool.query(
          `UPDATE ${T_PUSH_LOCAL} SET endpoint = $2, p256dh = $3, auth = $4 WHERE id = $1`,
          [ya.rows[0].id, endpoint, p256dh, auth]
        );
        return json(res, { ok: true, accion, avisos: true, actualizado: true });
      }
      const total = await pool.query(
        `SELECT COUNT(*)::int AS n FROM ${T_PUSH_LOCAL} WHERE local_id = $1`, [localId]
      );
      if (Number(total.rows[0]?.n) >= 5) {
        return json(res, { ok: false, codigo: 'TOPE', error: 'esta tienda ya tiene 5 dispositivos' }, 409);
      }
      await pool.query(
        `INSERT INTO ${T_PUSH_LOCAL} (id,local_id,huella,endpoint,p256dh,auth)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        ['pushl-' + Date.now().toString(36) + randomBytes(4).toString('hex'),
          localId, huella, endpoint, p256dh, auth]
      );
      return json(res, { ok: true, accion, avisos: true });
    }

    if (accion === 'push_local_baja') {
      const localId = idLocal(cuerpo.local_id);
      const { local, motivo } = await autorizarLocal(pool, req, localId, texto(cuerpo.clave, 60));
      if (!local) return json(res, { ok: false, error: 'no autorizado', codigo: motivo }, 401);
      const endpoint = texto(cuerpo.endpoint, 1000).trim();
      if (!endpoint) return json(res, { ok: false, codigo: 'FALTAN_DATOS', error: 'falta el endpoint' }, 400);
      const r = await pool.query(
        `DELETE FROM ${T_PUSH_LOCAL} WHERE local_id = $1 AND huella = $2`,
        [localId, sha256hex(endpoint)]
      );
      return json(res, { ok: true, accion, borrados: r.rowCount });
    }

    /* ── reseñas (público: leer y escribir) ─────────────────────────────────
       Calificar exige el token del pedido y que el local lo haya marcado como
       entregado: no se puede opinar de una compra que no ocurrió. Una reseña
       por pedido (índice único en `pedido_id`). */
    if (accion === 'resenas_listar') {
      const localId = idLocal(cuerpo.local_id);
      const limite = Math.min(30, Math.max(1, entero(cuerpo.limite, 30) || 12));
      const r = await pool.query(
        `SELECT autor, estrellas::int AS estrellas, texto, creado
           FROM ${T_RESENAS}
          WHERE local_id = $1 AND oculta = false
          ORDER BY creado DESC LIMIT $2`, [localId, limite]
      );
      const prom = await pool.query(
        `SELECT COUNT(*)::int AS n, AVG(estrellas)::float8 AS promedio,
                COUNT(*) FILTER (WHERE estrellas = 5)::int AS cinco,
                COUNT(*) FILTER (WHERE estrellas = 4)::int AS cuatro,
                COUNT(*) FILTER (WHERE estrellas = 3)::int AS tres,
                COUNT(*) FILTER (WHERE estrellas = 2)::int AS dos,
                COUNT(*) FILTER (WHERE estrellas = 1)::int AS uno
           FROM ${T_RESENAS} WHERE local_id = $1 AND oculta = false`, [localId]
      );
      const c = prom.rows[0] || {};
      return json(res, {
        ok: true, accion,
        calificacion: {
          n: Number(c.n) || 0,
          promedio: Math.round((Number(c.promedio) || 0) * 10) / 10,
          reparto: {
            5: Number(c.cinco) || 0, 4: Number(c.cuatro) || 0, 3: Number(c.tres) || 0,
            2: Number(c.dos) || 0, 1: Number(c.uno) || 0,
          },
        },
        resenas: r.rows.map((x: any) => ({
          autor: x.autor, estrellas: x.estrellas, texto: x.texto, creado: x.creado,
        })),
      });
    }

    if (accion === 'resena_crear') {
      if (!permitirResena(ipDe(req))) {
        return json(res, {
          ok: false, codigo: 'BLOQUEADO',
          error: 'demasiadas reseñas desde esta conexión: inténtalo más tarde',
        }, 429);
      }
      const token = texto(cuerpo.token, 64).trim().toLowerCase();
      const codigo = codigoComparable(cuerpo.codigo);
      const contacto = ultimos4(cuerpo.contacto);
      const estrellas = entero(cuerpo.estrellas, 5);
      const textoResena = texto(cuerpo.texto, 500).trim();
      // Dos formas de probar que el pedido es tuyo, las mismas del seguimiento:
      // el enlace (token) o el código + los últimos 4 del teléfono.
      if (!token && !(codigo && contacto)) {
        return json(res, {
          ok: false, codigo: 'FALTAN_DATOS',
          error: 'falta el enlace del pedido, o el código y los últimos 4 del teléfono',
        }, 400);
      }
      if (!(estrellas >= 1 && estrellas <= 5)) {
        return json(res, { ok: false, codigo: 'ESTRELLAS', error: 'elige de 1 a 5 estrellas' }, 400);
      }

      const rp = token
        ? await pool.query(
            `SELECT id, local_id, estado, cliente FROM ${T_PEDIDOS}
              WHERE seguimiento = $1 LIMIT 1`, [token]
          )
        : await pool.query(
            `SELECT id, local_id, estado, cliente FROM ${T_PEDIDOS}
              WHERE upper(regexp_replace(codigo, '[^A-Za-z0-9]', '', 'g')) = $1
                AND telefono <> ''
                AND right(regexp_replace(telefono, '[^0-9]', '', 'g'), 4) = $2
              ORDER BY creado DESC LIMIT 1`, [codigo, contacto]
          );
      const pedido = rp.rows[0];
      if (!pedido) {
        return json(res, { ok: false, codigo: 'NO_ENCONTRADO', error: 'no encontramos ese pedido' }, 404);
      }
      if (pedido.estado !== 'entregado') {
        return json(res, {
          ok: false, codigo: 'NO_ENTREGADO',
          error: 'puedes calificar cuando el local marque el pedido como entregado',
        }, 409);
      }

      const id = 'res-' + Date.now().toString(36) + randomBytes(3).toString('hex');
      try {
        await pool.query(
          `INSERT INTO ${T_RESENAS} (id, local_id, pedido_id, autor, estrellas, texto)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, pedido.local_id, pedido.id, autorPublico(pedido.cliente), estrellas, textoResena]
        );
      } catch (e: any) {
        // El índice único en `pedido_id` es el que impide opinar dos veces.
        if (String(e && e.code) === '23505') {
          return json(res, {
            ok: false, codigo: 'YA_OPINO', error: 'ya calificaste este pedido',
          }, 409);
        }
        throw e;
      }

      const prom = await pool.query(
        `SELECT COUNT(*)::int AS n, AVG(estrellas)::float8 AS promedio
           FROM ${T_RESENAS} WHERE local_id = $1 AND oculta = false`, [pedido.local_id]
      );
      const c = prom.rows[0] || {};
      return json(res, {
        ok: true, accion, estrellas,
        calificacion: {
          n: Number(c.n) || 0,
          promedio: Math.round((Number(c.promedio) || 0) * 10) / 10,
        },
      });
    }

    /* ── moderación de reseñas (dueño · clave · admin) ─────────────────────
       El dueño puede ocultar una reseña sin borrarla: deja de contar en el
       promedio y deja de mostrarse, pero queda el registro. */
    if (accion === 'resena_moderar') {
      const localId = idLocal(cuerpo.local_id);
      const { local, motivo } = await autorizarLocal(pool, req, localId, texto(cuerpo.clave, 60));
      if (!local) return json(res, { ok: false, error: 'no autorizado', codigo: motivo }, 401);
      const resenaId = texto(cuerpo.resena_id, 60).trim();
      const oculta = booleano(cuerpo.oculta, true);
      const r = await pool.query(
        `UPDATE ${T_RESENAS} SET oculta = $1 WHERE id = $2 AND local_id = $3`,
        [oculta, resenaId, localId]
      );
      return json(res, { ok: true, accion, cambiados: r.rowCount, oculta });
    }

    /* ── reseñas del panel (dueño ve también las ocultas) ─────────────────── */
    if (accion === 'resenas_panel') {
      const localId = idLocal(cuerpo.local_id);
      const { local, motivo } = await autorizarLocal(pool, req, localId, texto(cuerpo.clave, 60));
      if (!local) return json(res, { ok: false, error: 'no autorizado', codigo: motivo }, 401);
      const r = await pool.query(
        `SELECT id, autor, estrellas::int AS estrellas, texto, oculta, creado
           FROM ${T_RESENAS} WHERE local_id = $1 ORDER BY creado DESC LIMIT 200`, [localId]
      );
      const prom = await pool.query(
        `SELECT COUNT(*)::int AS n, AVG(estrellas)::float8 AS promedio,
                COUNT(*) FILTER (WHERE oculta)::int AS ocultas
           FROM ${T_RESENAS} WHERE local_id = $1 AND oculta = false`, [localId]
      );
      const c = prom.rows[0] || {};
      return json(res, {
        ok: true, accion,
        calificacion: {
          n: Number(c.n) || 0,
          promedio: Math.round((Number(c.promedio) || 0) * 10) / 10,
          ocultas: Number(c.ocultas) || 0,
        },
        resenas: r.rows,
      });
    }

    if (accion === 'pedidos_listar') {
      const localId = idLocal(cuerpo.local_id);
      const { local, motivo } = await autorizarLocal(pool, req, localId, texto(cuerpo.clave, 60));
      if (!local) return json(res, { ok: false, error: 'no autorizado', codigo: motivo }, 401);
      const estado = texto(cuerpo.estado, 20).trim();
      const limite = Math.min(200, Math.max(1, entero(cuerpo.limite, 200) || 50));

      const args: unknown[] = [localId];
      let where = 'p.local_id = $1';
      if (ESTADOS.includes(estado)) { args.push(estado); where += ` AND p.estado = $${args.length}`; }

      // El contador del panel necesita el total de verdad, no el de la página.
      const cuenta = await pool.query(
        `SELECT COUNT(*)::int AS n,
                COUNT(*) FILTER (WHERE p.estado = 'nuevo')::int AS nuevos,
                COUNT(*) FILTER (WHERE p.estado NOT IN ('entregado', 'cancelado'))::int AS abiertos
           FROM ${T_PEDIDOS} p WHERE ${where}`, args
      );
      const c = cuenta.rows[0] || {};

      // El historial viaja con cada pedido: el dueño ve quién hizo qué y
      // cuándo, sin una llamada por pedido.
      const r = await pool.query(
        `SELECT p.id,p.codigo,p.seguimiento,p.cliente,p.telefono,p.items,
                p.subtotal::float8 AS subtotal, p.envio::float8 AS envio, p.total::float8 AS total,
                p.ahorro::float8 AS ahorro,
                p.entrega,p.direccion,p.comuna_entrega,p.referencia_entrega,
                p.metodo_pago,p.pago_con::float8 AS pago_con,p.vuelto::float8 AS vuelto,
                (p.clave_entrega <> '') AS requiere_clave,
                p.nota,p.estado,p.creado,p.actualizado,
                COALESCE((
                  SELECT json_agg(json_build_object(
                           'estado', e.estado, 'ts', e.ts, 'actor', e.actor, 'nota', e.nota
                         ) ORDER BY e.ts)
                    FROM ${T_EVENTOS} e WHERE e.pedido_id = p.id
                ), '[]'::json) AS eventos
           FROM ${T_PEDIDOS} p WHERE ${where}
          ORDER BY p.creado DESC LIMIT $${args.length + 1}`,
        [...args, limite]
      );
      return json(res, {
        ok: true, accion, pedidos: r.rows,
        total: Number(c.n) || 0,
        nuevos: Number(c.nuevos) || 0,
        abiertos: Number(c.abiertos) || 0,
        local: local.nombre,
      });
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

      // La fila se bloquea para que dos toques seguidos no se pisen: el
      // historial y el stock quedan contados una sola vez.
      cliente = await pool.connect();
      await cliente.query('BEGIN');
      const cur = await cliente.query(
        `SELECT estado, items, clave_entrega FROM ${T_PEDIDOS} WHERE id = $1 AND local_id = $2 FOR UPDATE`,
        [pedidoId, localId]
      );
      const fila = cur.rows[0];
      if (!fila) {
        await cliente.query('ROLLBACK');
        return json(res, { ok: false, error: 'pedido no encontrado' }, 404);
      }
      if (ESTADOS_FINALES.includes(fila.estado)) {
        await cliente.query('ROLLBACK');
        return json(res, {
          ok: false, codigo: 'TERMINADO',
          error: fila.estado === 'entregado'
            ? 'ese pedido ya fue entregado: no se puede cambiar'
            : 'ese pedido ya fue cancelado: no se puede cambiar',
          estado: fila.estado,
        }, 409);
      }
      if (fila.estado === estado) {
        await cliente.query('ROLLBACK');
        return json(res, { ok: true, accion, cambiados: 0, estado });
      }

      // Verificación de entrega: si el pedido tiene código, el local debe
      // pedírselo al comprador y escribirlo. Es lo que impide cerrar un pedido
      // que nunca llegó a sus manos.
      const clavePedida = texto(cuerpo.clave_entrega, 8).replace(/\D/g, '');
      if (estado === 'entregado' && String(fila.clave_entrega || '') !== '') {
        if (!clavePedida) {
          await cliente.query('ROLLBACK');
          return json(res, {
            ok: false, codigo: 'CLAVE_ENTREGA',
            error: 'pide el código de entrega de 4 dígitos al comprador',
          }, 409);
        }
        if (clavePedida !== String(fila.clave_entrega)) {
          await cliente.query('ROLLBACK');
          return json(res, {
            ok: false, codigo: 'CLAVE_ENTREGA',
            error: 'el código de entrega no coincide: pídelo de nuevo al comprador',
          }, 409);
        }
      }

      await cliente.query(
        `UPDATE ${T_PEDIDOS} SET estado = $1, actualizado = now() WHERE id = $2`,
        [estado, pedidoId]
      );
      // Rastro: quién lo movió y una nota legible. El dueño con clave o cuenta
      // es «dueño»; el token admin es «sistema».
      const actor = esAdmin(req) ? 'sistema' : 'dueño';
      const ETIQUETA: Record<string, string> = {
        nuevo: 'recibido', visto: 'en preparación', listo: 'listo',
        entregado: 'entregado', cancelado: 'cancelado',
      };
      const nota = texto(cuerpo.nota, 120).trim() || ('marcado como ' + (ETIQUETA[estado] || estado));
      // El rastro de la entrega verificado queda en el historial del pedido.
      const notaEvento = estado === 'entregado' && clavePedida && String(fila.clave_entrega || '') !== ''
        ? nota + ' · código de entrega verificado'
        : nota;

      // Cancelar devuelve al catálogo lo que el pedido había descontado.
      let devueltos = 0;
      if (estado === 'cancelado') {
        for (const it of (Array.isArray(fila.items) ? fila.items : [])) {
          if (!it || !it.sku) continue;
          const r = await cliente.query(
            `UPDATE ${T_PRODUCTOS} SET stock = stock + $3
              WHERE local_id = $1 AND sku = $2 AND stock IS NOT NULL`,
            [localId, String(it.sku), Math.max(1, Number(it.cantidad) || 1)]
          );
          if (r.rowCount) devueltos++;
        }
      }

      await cliente.query(
        `INSERT INTO ${T_EVENTOS} (pedido_id, estado, actor, nota) VALUES ($1, $2, $3, $4)`,
        [pedidoId, estado, actor, devueltos ? notaEvento + ' · stock devuelto' : notaEvento]
      );
      await cliente.query('COMMIT');

      // El aviso push va después del commit: si falla, el pedido ya cambió.
      let avisados = 0;
      try { avisados = await avisarCambio(pool, pedidoId, estado); }
      catch (e) { /* el estado ya está guardado: el aviso es opcional */ }
      return json(res, {
        ok: true, accion, cambiados: 1, estado, avisados,
        ...(devueltos ? { stock_devuelto: devueltos } : {}),
      });
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
                COALESCE(SUM(ahorro), 0)::float8 AS descuento,
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

      // La calificación viaja con el resumen: así la pestaña Reseñas muestra su
      // contador sin una llamada extra al abrir el panel.
      let resenas = { n: 0, promedio: 0 };
      try {
        const rr = await pool.query(
          `SELECT COUNT(*)::int AS n, AVG(estrellas)::float8 AS promedio
             FROM ${T_RESENAS} WHERE local_id = $1 AND oculta = false`, [localId]
        );
        const c = rr.rows[0] || {};
        resenas = {
          n: Number(c.n) || 0,
          promedio: Math.round((Number(c.promedio) || 0) * 10) / 10,
        };
      } catch (e) { /* tabla nueva: si aún no existe, el panel sigue igual */ }

      return json(res, {
        ok: true, accion, dias,
        local: { id: local.id, nombre: local.nombre },
        serie: serie.rows,
        totales: {
          pedidos, ventas,
          ticket: pedidos ? Math.round(ventas / pedidos) : 0,
          abiertos: Number(t0.abiertos) || 0,
          descuento: Number(t0.descuento) || 0,
        },
        top: top.rows,
        estados,
        visitas,
        resenas,
        push: vapidConfig()
          ? { disponible: true, clave: vapidConfig()!.publica }
          : { disponible: false, clave: '' },
        // Pedidos ÷ visitas de la app. Null cuando no hay con qué comparar.
        conversion: totalVisitas ? Number(((pedidos / totalVisitas) * 100).toFixed(1)) : null,
      });
    }

    if (accion === 'resumen') {
      if (!esAdmin(req)) return json(res, { ok: false, error: 'no autorizado', codigo: 'SIN_TOKEN' }, 401);
      const l = await pool.query(`SELECT COUNT(*)::int AS n FROM ${T_LOCALES} WHERE activo = true`);
      const abiertos = await pool.query(`SELECT COUNT(*)::int AS n FROM ${T_LOCALES} WHERE activo = true AND abierto = true`);
      const pd = await pool.query(`SELECT COUNT(*)::int AS n FROM ${T_PEDIDOS}`);
      // Catálogo y stock en una sola pasada: el admin ve cuánto hay en bodega,
      // cuánto está en oferta y qué se está por agotar.
      const p = await pool.query(
        `SELECT COUNT(*)::int AS n,
                COUNT(*) FILTER (WHERE ${dctoVigente()} > 0)::int AS ofertas,
                COUNT(*) FILTER (WHERE stock IS NOT NULL AND stock > 0 AND stock <= 5)::int AS stock_bajo,
                COUNT(*) FILTER (WHERE stock IS NOT NULL AND stock <= 0)::int AS agotados,
                COALESCE(SUM(precio * GREATEST(COALESCE(stock, 0), 0)), 0)::float8 AS valor
           FROM ${T_PRODUCTOS}`
      );
      const pr = p.rows[0] || {};
      // Lo que se ha regalado en descuentos (los cancelados no cuentan).
      const ad = await pool.query(
        `SELECT COALESCE(SUM(ahorro), 0)::float8 AS n FROM ${T_PEDIDOS} WHERE estado <> 'cancelado'`
      );
      // Los casos concretos, para que el admin sepa DÓNDE mirar.
      const criticos = await pool.query(
        `SELECT p.local_id, l.nombre AS local, p.nombre, p.sku, p.stock
           FROM ${T_PRODUCTOS} p LEFT JOIN ${T_LOCALES} l ON l.id = p.local_id
          WHERE p.stock IS NOT NULL AND p.stock <= 5
          ORDER BY p.stock ASC, p.nombre COLLATE "C" LIMIT 8`
      );
      const ofertas = await pool.query(
        `SELECT p.local_id, l.nombre AS local, p.nombre, p.precio::float8 AS precio,
                ${dctoVigente('p.')}::int AS descuento,
                ${precioEfectivo('p.')}::float8 AS precio_efectivo,
                p.oferta_hasta::float8 AS oferta_hasta
           FROM ${T_PRODUCTOS} p LEFT JOIN ${T_LOCALES} l ON l.id = p.local_id
          WHERE ${dctoVigente('p.')} > 0
          ORDER BY descuento DESC, p.nombre COLLATE "C" LIMIT 8`
      );
      return json(res, {
        ok: true, accion,
        resumen: {
          locales: l.rows[0].n,
          locales_abiertos: abiertos.rows[0].n,
          productos: Number(pr.n) || 0,
          pedidos: pd.rows[0].n,
          productos_oferta: Number(pr.ofertas) || 0,
          stock_bajo: Number(pr.stock_bajo) || 0,
          stock_agotado: Number(pr.agotados) || 0,
          valor_inventario: Number(pr.valor) || 0,
          descuento_entregado: Number(ad.rows[0]?.n) || 0,
        },
        stock_critico: criticos.rows,
        ofertas: ofertas.rows,
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
