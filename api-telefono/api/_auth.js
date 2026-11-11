// FORGE CORE STOCK · núcleo de cuentas en la nube (InsForge)
// ---------------------------------------------------------------------------
// Este archivo NO habla HTTP y NO escribe SQL: son las reglas de la cuenta.
// `auth.ts` pone el transporte (Vercel) y el repositorio (Postgres/InsForge).
// La separación no es decorativa: permite probar con `node` el registro, el
// login, el bloqueo por intentos y la revocación de sesiones sin base y sin
// red (ver `tests/web/auth-nube.js`).
//
// Decisiones de seguridad (y su límite honesto):
//   · Contraseñas: PBKDF2-HMAC-SHA256, 120.000 iteraciones, sal única por
//     cuenta. La misma receta que usa el navegador (`core-sec.js`), así el
//     espejo local y la nube no divergen.
//   · Sesiones: token de 256 bits; en la base queda SOLO su SHA-256. Si
//     alguien lee la tabla, no puede reusar los tokens.
//   · Fuerza bruta: 8 intentos fallidos bloquean la cuenta 10 minutos. El
//     contador vive en la fila (`intentos`, `bloqueado_hasta`), así sobrevive
//     a los reinicios de la función serverless.
//   · Enumeración: un correo inexistente y una contraseña mala devuelven el
//     MISMO código (`CREDENCIALES`) y tardan lo mismo (se hashea igual).
//   · El rol `owner` es la primera cuenta creada en la base. No es un permiso
//     de datos: el inventario y el mercado siguen con `local_id` + `clave`.
// ---------------------------------------------------------------------------

'use strict';

// CommonJS a propósito: `@vercel/node` compila `auth.ts` a CJS y `require()`
// de un `.mjs` revienta con ERR_REQUIRE_ESM. Con `.js` + `module.exports` el
// paquete viaja junto a la función sin sorpresas.
const { randomBytes, createHash, pbkdf2: pbkdf2cb, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');

const pbkdf2 = promisify(pbkdf2cb);

const ITER = 120000;
const DIAS_SESION = 30;
const MAX_INTENTOS = 8;
const BLOQUEO_MIN = 10;
const MAX_CUENTAS = 200;

const MAX_EMAIL = 160;
const MAX_NOMBRE = 80;
const MAX_PASS = 200;
const MAX_DISPOSITIVO = 120;

/* ── utilidades puras ───────────────────────────────────────────────────── */

/** Correo canónico o cadena vacía si no parece un correo. */
function normalizarEmail(v) {
  const s = String(v ?? '').trim().toLowerCase().slice(0, MAX_EMAIL);
  return /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(s) ? s : '';
}

/** Mensaje de error de la contraseña, o cadena vacía si es aceptable. */
function validarPass(pass) {
  const p = String(pass ?? '');
  if (p.length < 8) return 'La contraseña necesita al menos 8 caracteres';
  if (p.length > MAX_PASS) return 'La contraseña es demasiado larga';
  return '';
}

/** Nombre visible acotado; si viene vacío se usa la parte local del correo. */
function normalizarNombre(v, email) {
  const s = String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, MAX_NOMBRE);
  if (s) return s;
  return String(email || '').split('@')[0].slice(0, MAX_NOMBRE) || 'cuenta';
}

function sha256hex(s) {
  return createHash('sha256').update(String(s)).digest('hex');
}

/** 32 bytes aleatorios en base64url: 43 caracteres, sin signos raros. */
function nuevoToken() {
  return randomBytes(32).toString('base64url');
}

function nuevoSalt() {
  return randomBytes(16).toString('base64url');
}

/**
 * PBKDF2-HMAC-SHA256 con la sal como texto UTF-8, igual que WebCrypto en el
 * navegador. Devuelve hex (32 bytes).
 */
async function hashPass(pass, salt, iter = ITER) {
  const bits = await pbkdf2(String(pass), String(salt), Number(iter) || ITER, 32, 'sha256');
  return bits.toString('hex');
}

/** Comparación de tiempo constante entre dos cadenas hex. */
function iguales(a, b) {
  const x = Buffer.from(String(a ?? ''), 'utf8');
  const y = Buffer.from(String(b ?? ''), 'utf8');
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/** Hash de relleno: mantiene el mismo costo cuando el correo no existe. */
const RELLENO = { salt: 'relleno-fcore-2026' };
async function gastarTiempo(pass) {
  await hashPass(pass, RELLENO.salt, ITER);
  return false;
}

function dispositivo(v) {
  return String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, MAX_DISPOSITIVO) || 'navegador';
}

/* ── servicio ───────────────────────────────────────────────────────────── */

/**
 * Crea el servicio de cuentas sobre un repositorio.
 *
 * El repositorio debe implementar (todas async):
 *   crearTablas()
 *   contarUsuarios() -> number
 *   buscarPorEmail(email) -> fila | null
 *       fila: { id, email, nombre, rol, pass_hash, pass_salt, iter,
 *               intentos, bloqueado_hasta (ms|null), ultimo_login (ms|null) }
 *   crearUsuario({ email, nombre, pass_hash, pass_salt, iter, rol }) -> { id, email, nombre, rol }
 *   guardarIntento(id, { intentos, bloqueado_hasta, ultimo_login })
 *   crearSesion({ usuario_id, token_hash, dispositivo, expira_ms })
 *   sesionPorHash(token_hash) -> { id, email, nombre, rol, expira_ms, revocada } | null
 *   revocarSesion(token_hash)
 *   listarUsuarios() -> filas sin hash
 *   borrarUsuario(id)
 *
 * `opciones`:
 *   ahora       () => ms          (inyectable en pruebas)
 *   invitar     código opcional; si está, el registro lo exige
 *   maxCuentas  tope duro de cuentas (por defecto MAX_CUENTAS)
 *   rootEmail   correo que SIEMPRE tiene rol `owner` (CORE_ROOT_EMAIL)
 */
function crearServicio(repo, opciones = {}) {
  const ahora = typeof opciones.ahora === 'function' ? opciones.ahora : () => Date.now();
  const invitar = String(opciones.invitar ?? '').trim();
  const maxCuentas = Number(opciones.maxCuentas) > 0 ? Number(opciones.maxCuentas) : MAX_CUENTAS;
  const rootEmail = normalizarEmail(opciones.rootEmail);

  const mal = (status, codigo, error) => ({ status, body: { ok: false, codigo, error } });

  async function sesionNueva(usuario, disp) {
    const token = nuevoToken();
    const expira = ahora() + DIAS_SESION * 24 * 3600 * 1000;
    await repo.crearSesion({
      usuario_id: usuario.id,
      token_hash: sha256hex(token),
      dispositivo: disp,
      expira_ms: expira,
    });
    return { token, expira };
  }

  return {
    async registrar(cuerpo = {}) {
      const email = normalizarEmail(cuerpo.email);
      if (!email) return mal(400, 'CORREO', 'El correo no parece válido');
      const falla = validarPass(cuerpo.pass);
      if (falla) return mal(400, 'CLAVE_CORTA', falla);
      if (invitar && String(cuerpo.codigo ?? '').trim() !== invitar) {
        return mal(403, 'INVITACION', 'Este servidor pide un código de invitación para crear cuentas');
      }

      const total = Number(await repo.contarUsuarios()) || 0;
      if (total >= maxCuentas) {
        return mal(429, 'TOPE', 'El servidor alcanzó el máximo de cuentas: pide al dueño que amplíe el tope');
      }

      const previo = await repo.buscarPorEmail(email);
      if (previo) return mal(409, 'YA_EXISTE', 'Ese correo ya tiene cuenta en la nube: entra con tu contraseña');

      const salt = nuevoSalt();
      const hash = await hashPass(cuerpo.pass, salt, ITER);
      const nombre = normalizarNombre(cuerpo.nombre, email);
      // `owner` = la primera cuenta de la base o el correo declarado en
      // CORE_ROOT_EMAIL. El rol no da permisos sobre los locales: eso se
      // resuelve por `dueno_id`.
      const rol = total === 0 || (rootEmail && email === rootEmail) ? 'owner' : 'member';
      let usuario;
      try {
        usuario = await repo.crearUsuario({
          email, nombre, pass_hash: hash, pass_salt: salt, iter: ITER, rol,
        });
      } catch (e) {
        // Carrera entre dos registros del mismo correo: el UNIQUE de Postgres
        // gana y se responde igual que si se hubiera detectado antes.
        if (String(e && e.code) === '23505') {
          return mal(409, 'YA_EXISTE', 'Ese correo ya tiene cuenta en la nube: entra con tu contraseña');
        }
        throw e;
      }
      const s = await sesionNueva(usuario, dispositivo(cuerpo.dispositivo));
      return {
        status: 201,
        body: {
          ok: true, accion: 'registrar', nube: 'insforge',
          usuario: { id: String(usuario.id), email: usuario.email, nombre: usuario.nombre, rol: usuario.rol },
          token: s.token, expira: s.expira,
        },
      };
    },

    async entrar(cuerpo = {}) {
      const email = normalizarEmail(cuerpo.email);
      const pass = String(cuerpo.pass ?? '');
      if (!email || !pass) return mal(401, 'CREDENCIALES', 'Correo o contraseña incorrectos');

      const u = await repo.buscarPorEmail(email);
      if (!u) {
        await gastarTiempo(pass);
        return mal(401, 'CREDENCIALES', 'Correo o contraseña incorrectos');
      }

      const bloqueo = Number(u.bloqueado_hasta) || 0;
      if (bloqueo > ahora()) {
        const faltan = Math.ceil((bloqueo - ahora()) / 1000);
        return mal(429, 'BLOQUEADO', `Demasiados intentos: vuelve a probar en ${Math.ceil(faltan / 60)} minuto(s)`);
      }

      const calc = await hashPass(pass, u.pass_salt, u.iter || ITER);
      if (!iguales(calc, u.pass_hash)) {
        const intentos = (Number(u.intentos) || 0) + 1;
        const bloquear = intentos >= MAX_INTENTOS;
        await repo.guardarIntento(u.id, {
          intentos: bloquear ? 0 : intentos,
          bloqueado_hasta: bloquear ? ahora() + BLOQUEO_MIN * 60 * 1000 : null,
          ultimo_login: u.ultimo_login || null,
        });
        if (bloquear) {
          return mal(429, 'BLOQUEADO', `Demasiados intentos: la cuenta queda bloqueada ${BLOQUEO_MIN} minutos`);
        }
        return mal(401, 'CREDENCIALES', 'Correo o contraseña incorrectos');
      }

      await repo.guardarIntento(u.id, {
        intentos: 0, bloqueado_hasta: null, ultimo_login: ahora(),
      });
      // CORE_ROOT_EMAIL manda: si esa cuenta ya existía como member, se
      // promueve al entrar (una sola escritura, sólo cuando hace falta).
      let rol = u.rol;
      if (rootEmail && email === rootEmail && rol !== 'owner') {
        rol = 'owner';
        if (typeof repo.guardarRol === 'function') await repo.guardarRol(u.id, 'owner');
        u.rol = rol;
      }
      const s = await sesionNueva(u, dispositivo(cuerpo.dispositivo));
      return {
        status: 200,
        body: {
          ok: true, accion: 'entrar', nube: 'insforge',
          usuario: { id: String(u.id), email: u.email, nombre: u.nombre, rol },
          token: s.token, expira: s.expira,
        },
      };
    },

    async sesion(cuerpo = {}, token = '') {
      const t = String(token || cuerpo.token || '').trim();
      if (!t) return mal(401, 'SESION', 'Falta el token de sesión');
      const s = await repo.sesionPorHash(sha256hex(t));
      if (!s || s.revocada) return mal(401, 'SESION', 'La sesión no existe o fue cerrada');
      if ((Number(s.expira_ms) || 0) <= ahora()) return mal(401, 'SESION', 'La sesión venció: vuelve a entrar');
      let rol = s.rol;
      if (rootEmail && s.email === rootEmail && rol !== 'owner') {
        rol = 'owner';
        if (typeof repo.guardarRol === 'function') await repo.guardarRol(s.id, 'owner');
      }
      return {
        status: 200,
        body: {
          ok: true, accion: 'sesion', nube: 'insforge',
          usuario: { id: String(s.id), email: s.email, nombre: s.nombre, rol },
          expira: Number(s.expira_ms),
        },
      };
    },

    async salir(cuerpo = {}, token = '') {
      const t = String(token || cuerpo.token || '').trim();
      if (t) await repo.revocarSesion(sha256hex(t));
      return { status: 200, body: { ok: true, accion: 'salir' } };
    },

    async usuarios(esAdmin) {
      if (!esAdmin) return mal(401, 'NO_AUTORIZADO', 'Sólo el administrador puede listar las cuentas');
      const filas = await repo.listarUsuarios();
      return { status: 200, body: { ok: true, accion: 'usuarios', usuarios: filas } };
    },

    async borrar(cuerpo = {}) {
      const email = normalizarEmail(cuerpo.email);
      const pass = String(cuerpo.pass ?? '');
      if (!email || !pass) return mal(401, 'CREDENCIALES', 'Correo o contraseña incorrectos');
      const u = await repo.buscarPorEmail(email);
      if (!u) {
        await gastarTiempo(pass);
        return mal(401, 'CREDENCIALES', 'Correo o contraseña incorrectos');
      }
      const calc = await hashPass(pass, u.pass_salt, u.iter || ITER);
      if (!iguales(calc, u.pass_hash)) return mal(401, 'CREDENCIALES', 'Correo o contraseña incorrectos');
      await repo.borrarUsuario(u.id);
      return { status: 200, body: { ok: true, accion: 'borrar', borrado: u.email } };
    },
  };
}

module.exports = {
  ITER, DIAS_SESION, MAX_INTENTOS, BLOQUEO_MIN, MAX_CUENTAS,
  normalizarEmail, validarPass, normalizarNombre,
  sha256hex, nuevoToken, nuevoSalt, hashPass, iguales, gastarTiempo,
  crearServicio,
};
