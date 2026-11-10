// FORGE CORE STOCK · /api/auth
// ---------------------------------------------------------------------------
// Cuentas de la app guardadas en InsForge (Postgres), servidas por `fabri-api`.
// Es la pieza que faltaba: hasta ahora el login vivía SOLO en el SQLite del
// navegador, así que la cuenta no viajaba entre dispositivos y no se podía
// recuperar si se borraban los datos del sitio.
//
// Contrato (siempre JSON):
//   GET  /api/auth                        → estado del puente (público)
//   GET  /api/auth?diag=1                 → además dice si las tablas existen
//   POST { accion: "asegurar" }           → crea tablas e índices (público)
//   POST { accion: "registrar", email, nombre, pass, codigo?, dispositivo? }
//   POST { accion: "entrar",    email, pass, dispositivo? }
//   POST { accion: "sesion" }             → valida `Authorization: Bearer <token>`
//   POST { accion: "salir" }              → revoca el token del Bearer
//   POST { accion: "usuarios" }           → lista (sólo ADMIN)
//   POST { accion: "borrar", email, pass } → borra la propia cuenta
//
// Credenciales:
//   · El USUARIO se autentica con su token de sesión (Bearer) o con
//     correo + contraseña. Nunca ve el token de administración.
//   · El ADMIN (`FABRI_API_TOKEN`) sólo se usa para listar cuentas.
//
// Variables de entorno:
//   INSFORGE_DATABASE_URL   cadena de Postgres (la misma del inventario)
//   FABRI_API_TOKEN         token de administración (opcional para `usuarios`)
//   CORE_INVITE             si está, el registro exige ese código
//   CORE_MAX_CUENTAS        tope de cuentas (200 por defecto)
//
// Las reglas (hash, bloqueo, tokens) viven en `_auth.js`, que no toca SQL ni
// HTTP. Este archivo sólo pone el transporte y el repositorio de Postgres.
// ---------------------------------------------------------------------------

import type { IncomingMessage, ServerResponse } from 'http';
// @ts-ignore: `_auth.js` es JavaScript puro, sin declaraciones de tipos.
import { crearServicio, MAX_CUENTAS } from './_auth.js';

export const config = { api: { bodyParser: false } };

const T_USUARIOS = 'core_usuarios';
const T_SESIONES = 'core_sesiones';

/* ── plomería http ──────────────────────────────────────────────────────── */

function cors(res: ServerResponse) {
  // Sin cookies ni credenciales de navegador: la autenticación es un token
  // explícito. `*` deja que la PWA y la APK llamen desde cualquier origen.
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
      if (tamano > 100_000) {
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

function ipDe(req: IncomingMessage): string {
  const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return f || String(req.socket?.remoteAddress || '');
}

/**
 * Límite de registros por IP en memoria. En serverless es "best effort": cada
 * instancia tiene su propio mapa y se reinicia en frío. Sirve para frenar un
 * script tonto, no para un ataque distribuido; el tope real es
 * `CORE_MAX_CUENTAS` y, si se configura, el código de invitación.
 */
const registrosPorIp = new Map<string, { n: number; desde: number }>();
const REGISTROS_HORA = 8;
const VENTANA_MS = 3600 * 1000;

function permitirRegistro(ip: string): boolean {
  const ahora = Date.now();
  const previo = registrosPorIp.get(ip);
  if (!previo || ahora - previo.desde > VENTANA_MS) {
    registrosPorIp.set(ip, { n: 1, desde: ahora });
    return true;
  }
  if (previo.n >= REGISTROS_HORA) return false;
  previo.n += 1;
  return true;
}

/* ── tablas ─────────────────────────────────────────────────────────────── */

async function asegurar(pool: any) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${T_USUARIOS} (
      id              BIGSERIAL PRIMARY KEY,
      email           TEXT UNIQUE NOT NULL,
      nombre          TEXT NOT NULL DEFAULT '',
      pass_hash       TEXT NOT NULL,
      pass_salt       TEXT NOT NULL,
      iter            INTEGER NOT NULL DEFAULT 120000,
      rol             TEXT NOT NULL DEFAULT 'member',
      creado          TIMESTAMPTZ NOT NULL DEFAULT now(),
      ultimo_login    TIMESTAMPTZ,
      intentos        INTEGER NOT NULL DEFAULT 0,
      bloqueado_hasta TIMESTAMPTZ
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${T_SESIONES} (
      id          BIGSERIAL PRIMARY KEY,
      usuario_id  BIGINT NOT NULL REFERENCES ${T_USUARIOS}(id) ON DELETE CASCADE,
      token_hash  TEXT UNIQUE NOT NULL,
      dispositivo TEXT NOT NULL DEFAULT '',
      creado      TIMESTAMPTZ NOT NULL DEFAULT now(),
      expira      TIMESTAMPTZ NOT NULL,
      revocada    BOOLEAN NOT NULL DEFAULT false
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_core_sesiones_usuario ON ${T_SESIONES} (usuario_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_core_sesiones_expira ON ${T_SESIONES} (expira)`);
  // Limpieza barata: las sesiones vencidas hace más de una semana no sirven
  // para nada y no deben crecer sin fin.
  await pool.query(`DELETE FROM ${T_SESIONES} WHERE expira < now() - interval '7 days'`);
}

/* ── repositorio Postgres ───────────────────────────────────────────────── */

function ms(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  // pg devuelve BIGINT como cadena ("1762..."). `new Date("1762...")` sería
  // inválido, así que los milisegundos se convierten a número directamente.
  const s = String(v);
  const n = /^\d+$/.test(s) ? Number(s) : new Date(v as any).getTime();
  return Number.isFinite(n) ? n : null;
}

function crearRepo(pool: any) {
  return {
    async crearTablas() { await asegurar(pool); },

    async contarUsuarios() {
      const r = await pool.query(`SELECT COUNT(*)::int AS n FROM ${T_USUARIOS}`);
      return Number(r.rows[0]?.n) || 0;
    },

    async buscarPorEmail(email: string) {
      const r = await pool.query(
        `SELECT id, email, nombre, rol, pass_hash, pass_salt, iter,
                intentos,
                (EXTRACT(EPOCH FROM bloqueado_hasta) * 1000)::bigint AS bloqueado_hasta,
                (EXTRACT(EPOCH FROM ultimo_login) * 1000)::bigint AS ultimo_login
           FROM ${T_USUARIOS} WHERE email = $1 LIMIT 1`, [email]);
      const f = r.rows[0];
      if (!f) return null;
      return {
        id: f.id, email: f.email, nombre: f.nombre, rol: f.rol,
        pass_hash: f.pass_hash, pass_salt: f.pass_salt, iter: Number(f.iter) || 120000,
        intentos: Number(f.intentos) || 0,
        bloqueado_hasta: ms(f.bloqueado_hasta),
        ultimo_login: ms(f.ultimo_login),
      };
    },

    async crearUsuario(u: any) {
      const r = await pool.query(
        `INSERT INTO ${T_USUARIOS} (email, nombre, pass_hash, pass_salt, iter, rol)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, email, nombre, rol`,
        [u.email, u.nombre, u.pass_hash, u.pass_salt, u.iter, u.rol]);
      return r.rows[0];
    },

    async guardarIntento(id: unknown, c: any) {
      await pool.query(
        `UPDATE ${T_USUARIOS}
            SET intentos = $2,
                bloqueado_hasta = CASE WHEN $3::bigint IS NULL THEN NULL
                                       ELSE to_timestamp($3::bigint / 1000.0) END,
                ultimo_login = CASE WHEN $4::bigint IS NULL THEN ultimo_login
                                    ELSE to_timestamp($4::bigint / 1000.0) END
          WHERE id = $1`,
        [id, c.intentos, c.bloqueado_hasta ?? null, c.ultimo_login ?? null]);
    },

    async crearSesion(s: any) {
      await pool.query(
        `INSERT INTO ${T_SESIONES} (usuario_id, token_hash, dispositivo, expira)
         VALUES ($1,$2,$3, to_timestamp($4::bigint / 1000.0))`,
        [s.usuario_id, s.token_hash, s.dispositivo, s.expira_ms]);
    },

    async sesionPorHash(hash: string) {
      const r = await pool.query(
        `SELECT u.id, u.email, u.nombre, u.rol,
                (EXTRACT(EPOCH FROM s.expira) * 1000)::bigint AS expira_ms,
                s.revocada
           FROM ${T_SESIONES} s
           JOIN ${T_USUARIOS} u ON u.id = s.usuario_id
          WHERE s.token_hash = $1 LIMIT 1`, [hash]);
      const f = r.rows[0];
      if (!f) return null;
      return {
        id: f.id, email: f.email, nombre: f.nombre, rol: f.rol,
        expira_ms: Number(f.expira_ms) || 0,
        revocada: Boolean(f.revocada),
      };
    },

    async revocarSesion(hash: string) {
      await pool.query(`UPDATE ${T_SESIONES} SET revocada = true WHERE token_hash = $1`, [hash]);
    },

    async listarUsuarios() {
      const r = await pool.query(
        `SELECT id, email, nombre, rol,
                (EXTRACT(EPOCH FROM creado) * 1000)::bigint AS creado,
                (EXTRACT(EPOCH FROM ultimo_login) * 1000)::bigint AS ultimo_login
           FROM ${T_USUARIOS} ORDER BY id ASC LIMIT 500`);
      return r.rows.map((f: any) => ({
        id: String(f.id), email: f.email, nombre: f.nombre, rol: f.rol,
        creado: ms(f.creado), ultimo_login: ms(f.ultimo_login),
      }));
    },

    async borrarUsuario(id: unknown) {
      await pool.query(`DELETE FROM ${T_USUARIOS} WHERE id = $1`, [id]);
    },
  };
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
  const base = Boolean(process.env.INSFORGE_DATABASE_URL);

  if (req.method === 'GET') {
    let tablas: Record<string, boolean> | null = null;
    let detalle = 'no comprobado';
    if (url.searchParams.get('diag') === '1' && base) {
      try {
        const { Pool } = await import('pg');
        const pool = new Pool({
          connectionString: process.env.INSFORGE_DATABASE_URL,
          ssl: { rejectUnauthorized: false },
          connectionTimeoutMillis: 8000,
          max: 1,
        });
        const r = await pool.query(
          `SELECT to_regclass('public.${T_USUARIOS}') AS u,
                  to_regclass('public.${T_SESIONES}') AS s`);
        tablas = { usuarios: !!r.rows[0]?.u, sesiones: !!r.rows[0]?.s };
        detalle = tablas.usuarios && tablas.sesiones
          ? 'tablas presentes' : 'faltan tablas: usa accion "asegurar"';
        await pool.end();
      } catch (e: any) {
        detalle = 'error de conexión: ' + (e?.message || String(e)).slice(0, 120);
      }
    }
    return json(res, {
      ok: true,
      servicio: 'fabri-api',
      endpoint: '/api/auth',
      nube: 'insforge',
      base_configurada: base,
      admin_configurado: Boolean(process.env.FABRI_API_TOKEN),
      invitacion: Boolean(String(process.env.CORE_INVITE || '').trim()),
      max_cuentas: Number(process.env.CORE_MAX_CUENTAS) > 0 ? Number(process.env.CORE_MAX_CUENTAS) : MAX_CUENTAS,
      tablas,
      base_detalle: detalle,
      acciones: ['asegurar', 'registrar', 'entrar', 'sesion', 'salir', 'usuarios', 'borrar'],
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

  const accion = String(cuerpo.accion ?? '').trim().slice(0, 20);

  if (!base) {
    return json(res, {
      ok: false,
      error: 'INSFORGE_DATABASE_URL no configurada en el servidor',
      codigo: 'SIN_BASE',
    }, 503);
  }

  if (accion === 'registrar' && !permitirRegistro(ipDe(req))) {
    return json(res, {
      ok: false, codigo: 'BLOQUEADO',
      error: 'demasiadas cuentas creadas desde esta conexión: espera una hora',
    }, 429);
  }

  let pool: any = null;
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
      return json(res, { ok: true, accion, tablas: [T_USUARIOS, T_SESIONES] });
    }

    const servicio = crearServicio(crearRepo(pool), {
      invitar: String(process.env.CORE_INVITE || '').trim(),
      maxCuentas: Number(process.env.CORE_MAX_CUENTAS) || MAX_CUENTAS,
    });

    const token = bearer(req);
    let salida: { status: number; body: any };
    switch (accion) {
      case 'registrar': salida = await servicio.registrar(cuerpo); break;
      case 'entrar': salida = await servicio.entrar(cuerpo); break;
      case 'sesion': salida = await servicio.sesion(cuerpo, token); break;
      case 'salir': salida = await servicio.salir(cuerpo, token); break;
      case 'usuarios': salida = await servicio.usuarios(esAdmin(req)); break;
      case 'borrar': salida = await servicio.borrar(cuerpo); break;
      default:
        return json(res, {
          ok: false, error: 'acción desconocida', codigo: 'ACCION',
          acciones: ['asegurar', 'registrar', 'entrar', 'sesion', 'salir', 'usuarios', 'borrar'],
        }, 400);
    }
    return json(res, salida.body, salida.status);
  } catch (e: any) {
    return json(res, {
      ok: false,
      error: (e?.message || String(e)).slice(0, 200),
      codigo: 'ERROR_BASE',
    }, 500);
  } finally {
    if (pool) { try { await pool.end(); } catch (e) { /* ya cerrada */ } }
  }
}
