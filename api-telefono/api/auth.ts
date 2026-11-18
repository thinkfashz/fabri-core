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
//   POST { accion: "registrar", email, nombre, pass, codigo?, dispositivo?, acepta_terminos }
//   POST { accion: "entrar",    email, pass, dispositivo? }
//   POST { accion: "sesion" }             → valida `Authorization: Bearer <token>`
//   POST { accion: "aceptar_terminos" }   → acepta la versión vigente (Bearer)
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
//   CORE_ROOT_EMAIL         correo que siempre entra como `owner` (root)
//
// Las reglas (hash, bloqueo, tokens) viven en `_auth.js`, que no toca SQL ni
// HTTP. Este archivo sólo pone el transporte y el repositorio de Postgres.
// ---------------------------------------------------------------------------

import type { IncomingMessage, ServerResponse } from 'http';
// @ts-ignore: `_auth.js` es JavaScript puro, sin declaraciones de tipos.
import {
  crearServicio, MAX_CUENTAS, TERMINOS_VERSION,
  normalizarEmail, normalizarNombre, validarPass, hashPass, nuevoSalt, ITER,
} from './_auth.js';
// @ts-ignore: helper HTTP de InsForge, sin tipos (JavaScript puro).
import * as insforge from './_auth_insforge.js';

export const config = { api: { bodyParser: false } };

const T_USUARIOS = 'core_usuarios';
const T_SESIONES = 'core_sesiones';
const T_LATIDO = 'core_latido';

const ACCIONES = [
  'asegurar', 'registrar', 'entrar', 'sesion', 'salir', 'aceptar_terminos',
  'usuarios', 'borrar', 'recuperar', 'recuperar_codigo',
];

/* ── plomería http ──────────────────────────────────────────────────────── */

function cors(res: ServerResponse) {
  // Sin cookies ni credenciales de navegador: la autenticación es un token
  // explícito. `*` deja que la PWA y la APK llamen desde cualquier origen.
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
      bloqueado_hasta TIMESTAMPTZ,
      terminos_version TEXT NOT NULL DEFAULT '',
      terminos_ts     TIMESTAMPTZ
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${T_SESIONES} (
      id          BIGSERIAL PRIMARY KEY,
      usuario_id  BIGINT NOT NULL REFERENCES ${T_USUARIOS}(id) ON DELETE CASCADE,
      token_hash  TEXT UNIQUE NOT NULL,
      dispositivo TEXT NOT NULL DEFAULT '',
      dispositivo_hash TEXT NOT NULL DEFAULT '',
      creado      TIMESTAMPTZ NOT NULL DEFAULT now(),
      expira      TIMESTAMPTZ NOT NULL,
      revocada    BOOLEAN NOT NULL DEFAULT false
    )`);
  // Migración para bases que ya existían (instalación anterior a los términos
  // y a la huella del dispositivo). ADD COLUMN IF NOT EXISTS es idempotente.
  await pool.query(`ALTER TABLE ${T_USUARIOS} ADD COLUMN IF NOT EXISTS terminos_version TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE ${T_USUARIOS} ADD COLUMN IF NOT EXISTS terminos_ts TIMESTAMPTZ`);
  // InsForge Auth (18-11-2026). `insforge_id` es el UUID de auth.users; la
  // contraseña local se conserva como respaldo para poder volver a `legacy`
  // sin dejar a nadie afuera.
  await pool.query(`ALTER TABLE ${T_USUARIOS} ADD COLUMN IF NOT EXISTS insforge_id TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE ${T_USUARIOS} ADD COLUMN IF NOT EXISTS auth_origen TEXT NOT NULL DEFAULT 'legacy'`);
  await pool.query(`ALTER TABLE ${T_USUARIOS} ADD COLUMN IF NOT EXISTS migrado_ts TIMESTAMPTZ`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_core_usuarios_insforge ON ${T_USUARIOS} (insforge_id) WHERE insforge_id <> ''`);
  await pool.query(`ALTER TABLE ${T_SESIONES} ADD COLUMN IF NOT EXISTS dispositivo_hash TEXT NOT NULL DEFAULT ''`);
  // Las sesiones heredadas no tienen huella y no se pueden atar a un equipo:
  // se revocan una vez. Quien las tuviera vuelve a entrar (30 días de sesión
  // no justifican dejar un token sin atar).
  await pool.query(`UPDATE ${T_SESIONES} SET revocada = true WHERE dispositivo_hash = '' AND revocada = false`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_core_sesiones_usuario ON ${T_SESIONES} (usuario_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_core_sesiones_expira ON ${T_SESIONES} (expira)`);
  // Limpieza barata: las sesiones vencidas hace más de una semana no sirven
  // para nada y no deben crecer sin fin.
  await pool.query(`DELETE FROM ${T_SESIONES} WHERE expira < now() - interval '7 days'`);
  // Bitácora del latido diario (mantiene la base despierta y deja constancia).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${T_LATIDO} (
      id      BIGSERIAL PRIMARY KEY,
      ts      TIMESTAMPTZ NOT NULL DEFAULT now(),
      ok      BOOLEAN NOT NULL,
      ms      INTEGER NOT NULL DEFAULT 0,
      detalle TEXT NOT NULL DEFAULT ''
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_core_latido_ts ON ${T_LATIDO} (ts)`);
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
                insforge_id, auth_origen,
                (EXTRACT(EPOCH FROM migrado_ts) * 1000)::bigint AS migrado_ts,
                intentos,
                (EXTRACT(EPOCH FROM bloqueado_hasta) * 1000)::bigint AS bloqueado_hasta,
                (EXTRACT(EPOCH FROM ultimo_login) * 1000)::bigint AS ultimo_login,
                terminos_version,
                (EXTRACT(EPOCH FROM terminos_ts) * 1000)::bigint AS terminos_ts
           FROM ${T_USUARIOS} WHERE email = $1 LIMIT 1`, [email]);
      const f = r.rows[0];
      if (!f) return null;
      return {
        id: f.id, email: f.email, nombre: f.nombre, rol: f.rol,
        pass_hash: f.pass_hash, pass_salt: f.pass_salt, iter: Number(f.iter) || 120000,
        insforge_id: f.insforge_id || '',
        auth_origen: f.auth_origen || 'legacy',
        migrado_ts: ms(f.migrado_ts),
        intentos: Number(f.intentos) || 0,
        bloqueado_hasta: ms(f.bloqueado_hasta),
        ultimo_login: ms(f.ultimo_login),
        terminos_version: f.terminos_version || '',
        terminos_ts: ms(f.terminos_ts),
      };
    },

    async crearUsuario(u: any) {
      const r = await pool.query(
        `INSERT INTO ${T_USUARIOS} (email, nombre, pass_hash, pass_salt, iter, rol, insforge_id, auth_origen, migrado_ts)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN $7::text = '' THEN NULL ELSE now() END)
         RETURNING id, email, nombre, rol, insforge_id, auth_origen, terminos_version,
                   (EXTRACT(EPOCH FROM terminos_ts) * 1000)::bigint AS terminos_ts`,
        [u.email, u.nombre, u.pass_hash, u.pass_salt, u.iter, u.rol,
         u.insforge_id || '', u.auth_origen || 'legacy']);
      const f = r.rows[0];
      return { ...f, terminos_ts: ms(f.terminos_ts) };
    },

    /** Vincula (o re-vincula) la fila local con su cuenta de InsForge. */
    async vincularInsforge(id: unknown, insforgeId: string, origen = 'insforge') {
      await pool.query(
        `UPDATE ${T_USUARIOS}
            SET insforge_id = $2, auth_origen = $3, migrado_ts = now()
          WHERE id = $1`, [id, String(insforgeId || ''), origen]);
    },

    /** Fija la contraseña local (respaldo) y limpia bloqueo e intentos. */
    async guardarClave(id: unknown, hash: string, salt: string, iter: number) {
      await pool.query(
        `UPDATE ${T_USUARIOS}
            SET pass_hash = $2, pass_salt = $3, iter = $4,
                intentos = 0, bloqueado_hasta = NULL
          WHERE id = $1`, [id, hash, salt, iter]);
    },

    /** Tras un reset, todas las sesiones abiertas dejan de valer. */
    async revocarSesionesDe(usuarioId: unknown) {
      await pool.query(
        `UPDATE ${T_SESIONES} SET revocada = true WHERE usuario_id = $1 AND revocada = false`,
        [usuarioId]);
    },

    async guardarTerminos(id: unknown, version: string, tsMs: number) {
      await pool.query(
        `UPDATE ${T_USUARIOS}
            SET terminos_version = $2, terminos_ts = to_timestamp($3::bigint / 1000.0)
          WHERE id = $1`,
        [id, version, tsMs]);
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

    async guardarRol(id: unknown, rol: string) {
      await pool.query(`UPDATE ${T_USUARIOS} SET rol = $1 WHERE id = $2`, [rol, id]);
    },

    async crearSesion(s: any) {
      await pool.query(
        `INSERT INTO ${T_SESIONES} (usuario_id, token_hash, dispositivo, dispositivo_hash, expira)
         VALUES ($1,$2,$3,$4, to_timestamp($5::bigint / 1000.0))`,
        [s.usuario_id, s.token_hash, s.dispositivo, s.dispositivo_hash || '', s.expira_ms]);
    },

    /** Tope de sesiones activas: revoca las más viejas y deja las `max` nuevas. */
    async limitarSesiones(usuarioId: unknown, max: number) {
      await pool.query(
        `UPDATE ${T_SESIONES} SET revocada = true
          WHERE usuario_id = $1 AND revocada = false AND expira > now()
            AND id NOT IN (
              SELECT id FROM ${T_SESIONES}
               WHERE usuario_id = $1 AND revocada = false AND expira > now()
               ORDER BY creado DESC, id DESC
               LIMIT $2)`,
        [usuarioId, Math.max(1, Number(max) || 12)]);
    },

    async sesionPorHash(hash: string) {
      const r = await pool.query(
        `SELECT u.id, u.email, u.nombre, u.rol,
                (EXTRACT(EPOCH FROM s.expira) * 1000)::bigint AS expira_ms,
                s.revocada, s.dispositivo_hash
           FROM ${T_SESIONES} s
           JOIN ${T_USUARIOS} u ON u.id = s.usuario_id
          WHERE s.token_hash = $1 LIMIT 1`, [hash]);
      const f = r.rows[0];
      if (!f) return null;
      return {
        id: f.id, email: f.email, nombre: f.nombre, rol: f.rol,
        expira_ms: Number(f.expira_ms) || 0,
        revocada: Boolean(f.revocada),
        dispositivo_hash: f.dispositivo_hash || '',
      };
    },

    async revocarSesion(hash: string) {
      await pool.query(`UPDATE ${T_SESIONES} SET revocada = true WHERE token_hash = $1`, [hash]);
    },

    async listarUsuarios() {
      const r = await pool.query(
        `SELECT id, email, nombre, rol, terminos_version, insforge_id, auth_origen,
                (EXTRACT(EPOCH FROM creado) * 1000)::bigint AS creado,
                (EXTRACT(EPOCH FROM ultimo_login) * 1000)::bigint AS ultimo_login,
                (EXTRACT(EPOCH FROM terminos_ts) * 1000)::bigint AS terminos_ts
           FROM ${T_USUARIOS} ORDER BY id ASC LIMIT 500`);
      return r.rows.map((f: any) => ({
        id: String(f.id), email: f.email, nombre: f.nombre, rol: f.rol,
        creado: ms(f.creado), ultimo_login: ms(f.ultimo_login),
        terminos_version: f.terminos_version || '',
        terminos_ts: ms(f.terminos_ts),
        auth_origen: f.auth_origen || 'legacy',
        insforge: Boolean(f.insforge_id),
      }));
    },

    async borrarUsuario(id: unknown) {
      await pool.query(`DELETE FROM ${T_USUARIOS} WHERE id = $1`, [id]);
    },
  };
}

/* ── InsForge Auth (patrón BFF) ─────────────────────────────────────────── */

/**
 * Puente entre `core_usuarios` y `auth.users` de InsForge. InsForge decide la
 * contraseña; la sesión de 30 días la sigue emitiendo `core_sesiones`.
 *
 * Devuelve `null` en modo `legacy` (o si faltan claves): así `_auth.js`
 * trabaja exactamente como antes y el código nuevo queda inerte.
 */
function crearPuente(repo: any) {
  const modo = insforge.modo();
  if (modo === 'legacy' || !insforge.configurado()) return null;

  return {
    async verificar(u: any, pass: string) {
      // Sólo una cuenta ya migrada puede dejar que InsForge diga "no".
      if (!u || !u.insforge_id) return 'salta';
      const r = await insforge.entrar({ email: u.email, password: pass });
      if (r.ok) return 'ok';
      if (r.codigo === 'CREDENCIALES') {
        return u.auth_origen === 'insforge' ? 'clave' : 'salta';
      }
      return modo === 'insforge' ? 'nube' : 'salta';
    },

    async sincronizar(u: any, pass: string) {
      if (!u) return;
      if (u.insforge_id && u.auth_origen === 'insforge') return;
      const nombre = String(u.nombre || '').trim().slice(0, 80) || undefined;
      let r = await insforge.registrar({ email: u.email, password: pass, name: nombre });
      if (!r.ok && r.codigo === 'YA_EXISTE') {
        // Existe en InsForge con otra clave (la aleatoria de un reset que
        // nunca se completó, por ejemplo). El usuario acaba de demostrar la
        // suya contra el hash local: se recrea para que queden iguales.
        const previo = u.insforge_id
          ? { ok: true, usuario: { id: u.insforge_id } }
          : await insforge.buscarPorEmail(u.email);
        const idPrevio = previo && previo.ok && previo.usuario ? previo.usuario.id : '';
        if (idPrevio) {
          const del = await insforge.borrar(idPrevio);
          if (del.ok) r = await insforge.registrar({ email: u.email, password: pass, name: nombre });
        }
      }
      const id = r.ok ? (insforge.usuarioDe(r) || {}).id : '';
      if (id) await repo.vincularInsforge(u.id, id, 'insforge');
    },

    async crear(cuenta: any) {
      const r = await insforge.registrar({
        email: cuenta.email, password: cuenta.pass, name: cuenta.nombre,
      });
      const u = r.ok ? insforge.usuarioDe(r) : null;
      return { ok: Boolean(u && u.id), id: (u && u.id) || '', codigo: r.codigo, error: r.error };
    },

    async borrar(u: any) {
      if (!u || !u.insforge_id) return { ok: true };
      return insforge.borrar(u.insforge_id);
    },
  };
}

/**
 * Códigos de recuperación por IP. Igual que el tope de registros: en
 * serverless es "best effort", pero evita que un script haga que InsForge
 * mande cien correos. InsForge tiene su propio límite detrás.
 */
const recuperacionesPorIp = new Map<string, { n: number; desde: number }>();
const RECUPERACIONES_HORA = 5;

function permitirRecuperacion(ip: string): boolean {
  const ahora = Date.now();
  const previo = recuperacionesPorIp.get(ip);
  if (!previo || ahora - previo.desde > VENTANA_MS) {
    recuperacionesPorIp.set(ip, { n: 1, desde: ahora });
    return true;
  }
  if (previo.n >= RECUPERACIONES_HORA) return false;
  previo.n += 1;
  return true;
}

/**
 * Paso 1: pedir el código. Responde lo mismo exista o no la cuenta (así no
 * se puede usar para averiguar quién está registrado). Si la cuenta es
 * legacy, primero se crea en InsForge con una clave aleatoria: sin eso
 * InsForge no tiene a quién mandarle el código.
 */
async function accionRecuperar(repo: any, cuerpo: Record<string, unknown>, ip: string) {
  const email = normalizarEmail(cuerpo.email);
  if (!email) {
    return { status: 400, body: { ok: false, codigo: 'CORREO', error: 'El correo no parece válido' } };
  }
  if (!insforge.configurado()) {
    return { status: 503, body: { ok: false, codigo: 'SIN_NUBE', error: 'La recuperación no está disponible en este servidor' } };
  }
  if (!permitirRecuperacion(ip)) {
    return { status: 429, body: { ok: false, codigo: 'LIMITE', error: 'Demasiados códigos pedidos: espera unos minutos' } };
  }

  const generico = {
    ok: true, accion: 'recuperar', enviado: true,
    mensaje: 'Si el correo tiene cuenta, te enviamos un código de 6 dígitos. Vence en 5 minutos.',
  };

  const u = await repo.buscarPorEmail(email);
  if (u && !u.insforge_id) {
    const r = await insforge.registrar({
      email,
      password: insforge.claveRandom(),
      name: String(u.nombre || '').trim().slice(0, 80) || undefined,
    });
    const id = r.ok ? (insforge.usuarioDe(r) || {}).id : '';
    if (id) await repo.vincularInsforge(u.id, id, 'legacy');
  }

  const envio = await insforge.solicitarReset(email);
  if (!envio.ok) {
    if (envio.codigo === 'LIMITE') {
      return { status: 429, body: { ok: false, codigo: 'LIMITE', error: 'Demasiados pedidos seguidos: espera un minuto' } };
    }
    if (envio.codigo === 'NUBE' || envio.codigo === 'RED' || envio.codigo === 'TIEMPO') {
      return { status: 503, body: { ok: false, codigo: 'NUBE', error: 'No pudimos enviar el código ahora: intenta en un minuto' } };
    }
  }
  return { status: 200, body: generico };
}

/**
 * Paso 2: canjear el código y fijar la contraseña nueva. Se actualiza la
 * copia local (respaldo), se revocan TODAS las sesiones anteriores y se
 * devuelve una sesión nueva, para que el usuario quede adentro.
 */
async function accionRecuperarCodigo(repo: any, servicio: any, cuerpo: Record<string, unknown>) {
  const email = normalizarEmail(cuerpo.email);
  const codigo = String(cuerpo.codigo ?? cuerpo.code ?? '').replace(/\D/g, '').slice(0, 6);
  const pass = String(cuerpo.pass ?? '');
  if (!email) {
    return { status: 400, body: { ok: false, codigo: 'CORREO', error: 'El correo no parece válido' } };
  }
  if (!/^\d{6}$/.test(codigo)) {
    return { status: 400, body: { ok: false, codigo: 'CODIGO', error: 'El código son 6 dígitos' } };
  }
  const falla = validarPass(pass);
  if (falla) {
    return { status: 400, body: { ok: false, codigo: 'CLAVE_CORTA', error: falla } };
  }
  if (!insforge.configurado()) {
    return { status: 503, body: { ok: false, codigo: 'SIN_NUBE', error: 'La recuperación no está disponible en este servidor' } };
  }

  const canje = await insforge.canjearCodigo(email, codigo);
  if (!canje.ok) {
    if (canje.codigo === 'CODIGO' || canje.codigo === 'DATOS') {
      return { status: 401, body: { ok: false, codigo: 'CODIGO', error: 'El código no sirve o venció: pide uno nuevo' } };
    }
    return { status: 503, body: { ok: false, codigo: 'NUBE', error: 'La nube no respondió: intenta en un minuto' } };
  }
  const pase = String((canje.datos && canje.datos.token) || '');
  if (!pase) {
    return { status: 503, body: { ok: false, codigo: 'NUBE', error: 'La nube no devolvió el pase de recuperación' } };
  }

  const reset = await insforge.resetConClave(pase, pass);
  if (!reset.ok) {
    if (reset.codigo === 'CODIGO' || reset.codigo === 'DATOS') {
      return { status: 401, body: { ok: false, codigo: 'CODIGO', error: 'El código no sirve o venció: pide uno nuevo' } };
    }
    return { status: 503, body: { ok: false, codigo: 'NUBE', error: 'La nube no pudo cambiar la contraseña: intenta en un minuto' } };
  }

  // Confirmación real: el login con la clave nueva devuelve el UUID y prueba
  // que InsForge quedó con la contraseña que el usuario escribió.
  const login = await insforge.entrar({ email, password: pass });
  const insId = login.ok ? (insforge.usuarioDe(login) || {}).id : '';

  const salt = nuevoSalt();
  const hash = await hashPass(pass, salt, ITER);
  let u = await repo.buscarPorEmail(email);
  if (u) {
    await repo.guardarClave(u.id, hash, salt, ITER);
    await repo.revocarSesionesDe(u.id);
    if (insId) await repo.vincularInsforge(u.id, insId, 'insforge');
    u = await repo.buscarPorEmail(email);
  } else {
    const total = await repo.contarUsuarios();
    u = await repo.crearUsuario({
      email,
      nombre: normalizarNombre(cuerpo.nombre, email),
      pass_hash: hash, pass_salt: salt, iter: ITER,
      rol: total === 0 ? 'owner' : 'member',
      insforge_id: insId,
      auth_origen: insId ? 'insforge' : 'legacy',
    });
  }
  return servicio.abrirSesion({ ...cuerpo, accion: 'recuperar_codigo' }, u);
}

/* ── latido diario (keep-alive) ─────────────────────────────────────────── */

/**
 * Aviso opcional por Telegram. Si no hay `TELEGRAM_BOT_TOKEN` en el entorno
 * no hace nada (y no falla): la alerta se activa sola el día que se agregue.
 */
async function avisarTelegram(texto: string) {
  const tk = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!tk) return false;
  const chat = String(process.env.TELEGRAM_CHAT_ID || '8210503546').trim();
  try {
    const r = await fetch(`https://api.telegram.org/bot${tk}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: texto, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(6000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Latido: despierta la base, comprueba las tres tablas, limpia sesiones
 * vencidas y deja la corrida anotada en `core_latido`.
 *
 * Es idempotente: se puede invocar dos veces el mismo día sin efectos raros.
 * Si algo falla, devuelve `ok:false` con el motivo y (si hay token) avisa por
 * Telegram. Nunca lanza: el cron debe terminar siempre.
 */
async function latidoDiario(pool: any) {
  const t0 = Date.now();
  const salida: Record<string, unknown> = {
    ts: new Date().toISOString(), ok: false, ms: 0, tablas: null, limpiadas: 0, aviso: false,
  };
  try {
    // Auto-reparación: si esta es la primera corrida (o alguien borró las
    // tablas), `asegurar` las deja listas. El DDL es idempotente.
    await asegurar(pool);
    const r = await pool.query(
      `SELECT to_regclass('public.${T_USUARIOS}') AS u,
              to_regclass('public.${T_SESIONES}') AS s,
              to_regclass('public.${T_LATIDO}') AS l`);
    const tablas = {
      usuarios: Boolean(r.rows[0]?.u),
      sesiones: Boolean(r.rows[0]?.s),
      latido: Boolean(r.rows[0]?.l),
    };
    salida.tablas = tablas;
    salida.ok = tablas.usuarios && tablas.sesiones;

    const lim = await pool.query(
      `DELETE FROM ${T_SESIONES} WHERE expira < now() - interval '7 days'`);
    salida.limpiadas = Number(lim.rowCount) || 0;
    // La bitácora no crece sin fin: 90 días alcanzan para ver la salud.
    await pool.query(`DELETE FROM ${T_LATIDO} WHERE ts < now() - interval '90 days'`);
    salida.ms = Date.now() - t0;
    await pool.query(
      `INSERT INTO ${T_LATIDO} (ok, ms, detalle) VALUES ($1, $2, $3)`,
      [salida.ok, salida.ms, JSON.stringify(tablas)]);
    return salida;
  } catch (e: any) {
    salida.ms = Date.now() - t0;
    const detalle = String(e?.message || e).slice(0, 300);
    salida.detalle = detalle;
    try {
      await pool.query(
        `INSERT INTO ${T_LATIDO} (ok, ms, detalle) VALUES (false, $1, $2)`,
        [salida.ms, detalle]);
    } catch { /* si la base no responde, no hay dónde anotarlo */ }
    salida.aviso = await avisarTelegram(
      'FORGE CORE STOCK · el latido diario falló.\n' + detalle);
    return salida;
  }
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
  // El cron de Vercel pega a `/api/latido` (ruta mapeada en vercel.json a este
  // mismo archivo, para no gastar una función). `?latido=1` sirve para
  // dispararlo a mano desde el navegador o con curl.
  const esLatido = url.pathname === '/api/latido' || url.searchParams.get('latido') === '1';

  if (req.method === 'GET' && esLatido) {
    if (!base) {
      return json(res, {
        ok: false, codigo: 'SIN_BASE',
        error: 'INSFORGE_DATABASE_URL no configurada en el servidor',
      }, 503);
    }
    const { Pool } = await import('pg');
    const pool = new Pool({
      connectionString: process.env.INSFORGE_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
      max: 1,
    });
    try {
      const latido = await latidoDiario(pool);
      return json(res, {
        ok: Boolean(latido.ok),
        servicio: 'fabri-api',
        accion: 'latido',
        latido,
      }, latido.ok ? 200 : 500);
    } finally {
      try { await pool.end(); } catch { /* nada */ }
    }
  }

  if (req.method === 'GET') {
    let tablas: Record<string, boolean> | null = null;
    let detalle = 'no comprobado';
    let ultimoLatido: Record<string, unknown> | null = null;
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
                  to_regclass('public.${T_SESIONES}') AS s,
                  to_regclass('public.${T_LATIDO}') AS l`);
        tablas = {
          usuarios: !!r.rows[0]?.u,
          sesiones: !!r.rows[0]?.s,
          latido: !!r.rows[0]?.l,
        };
        detalle = tablas.usuarios && tablas.sesiones
          ? 'tablas presentes' : 'faltan tablas: usa accion "asegurar"';
        if (tablas.latido) {
          try {
            const l = await pool.query(
              `SELECT (EXTRACT(EPOCH FROM ts) * 1000)::bigint AS ts, ok, ms, detalle
                 FROM ${T_LATIDO} ORDER BY id DESC LIMIT 1`);
            const f = l.rows[0];
            if (f) ultimoLatido = {
              ts: Number(f.ts) || null, ok: Boolean(f.ok),
              ms: Number(f.ms) || 0, detalle: f.detalle || '',
            };
          } catch { /* la bitácora es opcional */ }
        }
        await pool.end();
      } catch (e: any) {
        detalle = 'error de conexión: ' + (e?.message || String(e)).slice(0, 120);
      }
    }
    // Diagnóstico de la política de auth de InsForge (sólo con ?diag=1).
    let publicConfig: Record<string, unknown> | null = null;
    if (url.searchParams.get('diag') === '1' && insforge.configurado()) {
      const pc = await insforge.publicConfig();
      publicConfig = pc.ok ? pc.datos : { error: pc.error };
    }
    return json(res, {
      ok: true,
      servicio: 'fabri-api',
      endpoint: '/api/auth',
      nube: 'insforge',
      auth: {
        modo: insforge.modo(),
        insforge_configurado: insforge.configurado(),
        insforge_host: insforge.host(),
        recuperacion: insforge.configurado(),
        migracion_perezosa: true,
      },
      public_config: publicConfig,
      base_configurada: base,
      admin_configurado: Boolean(process.env.FABRI_API_TOKEN),
      invitacion: Boolean(String(process.env.CORE_INVITE || '').trim()),
      max_cuentas: Number(process.env.CORE_MAX_CUENTAS) > 0 ? Number(process.env.CORE_MAX_CUENTAS) : MAX_CUENTAS,
      root_configurado: Boolean(String(process.env.CORE_ROOT_EMAIL || '').trim()),
      terminos_version: TERMINOS_VERSION,
      tablas,
      base_detalle: detalle,
      ultimo_latido: ultimoLatido,
      latido: '/api/latido',
      acciones: ACCIONES,
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

    const repo = crearRepo(pool);
    const servicio = crearServicio(repo, {
      invitar: String(process.env.CORE_INVITE || '').trim(),
      maxCuentas: Number(process.env.CORE_MAX_CUENTAS) || MAX_CUENTAS,
      rootEmail: String(process.env.CORE_ROOT_EMAIL || '').trim(),
      modo: insforge.modo(),
      externo: crearPuente(repo),
    });

    const token = bearer(req);
    let salida: { status: number; body: any };
    switch (accion) {
      case 'registrar': salida = await servicio.registrar(cuerpo); break;
      case 'entrar': salida = await servicio.entrar(cuerpo); break;
      case 'sesion': salida = await servicio.sesion(cuerpo, token); break;
      case 'aceptar_terminos': salida = await servicio.aceptarTerminos(cuerpo, token); break;
      case 'salir': salida = await servicio.salir(cuerpo, token); break;
      case 'usuarios': salida = await servicio.usuarios(esAdmin(req)); break;
      case 'borrar': salida = await servicio.borrar(cuerpo); break;
      case 'recuperar': salida = await accionRecuperar(repo, cuerpo, ipDe(req)); break;
      case 'recuperar_codigo': salida = await accionRecuperarCodigo(repo, servicio, cuerpo); break;
      default:
        return json(res, {
          ok: false, error: 'acción desconocida', codigo: 'ACCION',
          acciones: ACCIONES,
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
