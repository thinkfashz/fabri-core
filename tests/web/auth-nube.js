#!/usr/bin/env node
/* FORGE CORE STOCK · cuentas en la nube (InsForge vía fabri-api)
 *
 * Qué se comprueba, y por qué importa:
 *
 *   A) El NÚCLEO del servidor (`api-telefono/api/_auth.js`) contra un
 *      repositorio en memoria: registro, rol de la primera cuenta, correo
 *      repetido, bloqueo por intentos, sesión, revocación, vencimiento,
 *      borrado, tope e invitación. Y que la contraseña NUNCA quede guardada.
 *
 *   B) El CLIENTE (`core-nube.js` + `core-sec.js`) contra el MISMO núcleo y
 *      con SQLite de verdad (el `sql-wasm.js` del repo): la cuenta se crea en
 *      la nube, se espeja en el navegador, sobrevive a recargas, entra sin red
 *      y no deja al usuario afuera si la nube se cae.
 *
 * Uso: node tests/web/auth-nube.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

const RAIZ = path.join(__dirname, '..', '..');
const API = path.join(RAIZ, 'api-telefono', 'api');

let fallos = 0;
const ok = (t, cond, detalle) => {
  if (cond) console.log('  \x1b[1;32m✔\x1b[0m ' + t);
  else { fallos++; console.log('  \x1b[1;31m✖\x1b[0m ' + t + (detalle ? ' → ' + detalle : '')); }
};
const igual = (t, a, b) => ok(t, a === b, 'esperado ' + JSON.stringify(b) + ', llegó ' + JSON.stringify(a));

/* ── repositorio en memoria (misma forma que el de Postgres) ─────────────── */

function repoMemoria() {
  const usuarios = [];
  const sesiones = [];
  let nid = 0;
  return {
    usuarios, sesiones,
    async crearTablas() {},
    async contarUsuarios() { return usuarios.length; },
    async buscarPorEmail(email) { return usuarios.find((u) => u.email === email) || null; },
    async crearUsuario(u) {
      const fila = Object.assign({
        id: ++nid, intentos: 0, bloqueado_hasta: null, ultimo_login: null,
      }, u);
      usuarios.push(fila);
      return { id: fila.id, email: fila.email, nombre: fila.nombre, rol: fila.rol };
    },
    async guardarIntento(id, c) {
      const u = usuarios.find((x) => String(x.id) === String(id));
      if (!u) return;
      u.intentos = c.intentos;
      u.bloqueado_hasta = c.bloqueado_hasta;
      if (c.ultimo_login) u.ultimo_login = c.ultimo_login;
    },
    async crearSesion(s) {
      sesiones.push(Object.assign({ revocada: false }, s));
    },
    async sesionPorHash(hash) {
      const s = sesiones.find((x) => x.token_hash === hash);
      if (!s) return null;
      const u = usuarios.find((x) => x.id === s.usuario_id);
      if (!u) return null;
      return {
        id: u.id, email: u.email, nombre: u.nombre, rol: u.rol,
        expira_ms: s.expira_ms, revocada: s.revocada,
      };
    },
    async revocarSesion(hash) {
      const s = sesiones.find((x) => x.token_hash === hash);
      if (s) s.revocada = true;
    },
    async listarUsuarios() {
      return usuarios.map((u) => ({ id: String(u.id), email: u.email, nombre: u.nombre, rol: u.rol }));
    },
    async borrarUsuario(id) {
      const i = usuarios.findIndex((x) => String(x.id) === String(id));
      if (i >= 0) usuarios.splice(i, 1);
    },
  };
}

/* ── A · núcleo del servidor ─────────────────────────────────────────────── */

async function probarNucleo() {
  const mod = await import(pathToFileURL(path.join(API, '_auth.js')).href);
  const A = mod.default || mod;
  const { crearServicio, sha256hex } = A;

  console.log('\n▸ núcleo · cuentas en InsForge');

  let reloj = Date.UTC(2026, 10, 10, 12, 0, 0);
  const repo = repoMemoria();
  const svc = crearServicio(repo, { ahora: () => reloj, maxCuentas: 3 });

  const r1 = await svc.registrar({ email: ' Duena@Local.CL ', nombre: '', pass: 'clave-segura-1' });
  igual('registrar devuelve 201', r1.status, 201);
  igual('la primera cuenta es owner', r1.body.usuario.rol, 'owner');
  igual('el correo se normaliza', r1.body.usuario.email, 'duena@local.cl');
  igual('el nombre vacío cae en la parte local del correo', r1.body.usuario.nombre, 'duena');
  ok('el token tiene 43 caracteres (32 bytes base64url)', r1.body.token.length === 43, r1.body.token.length);
  ok('la respuesta NO trae hash ni sal',
    !('pass_hash' in r1.body) && !('pass_salt' in r1.body) && !JSON.stringify(r1.body).includes('clave-segura-1'));
  const fila = repo.usuarios[0];
  ok('la base guarda el hash, no la contraseña',
    fila.pass_hash.length === 64 && !fila.pass_hash.includes('clave-segura-1'));
  igual('la sesión se guarda como SHA-256 del token', repo.sesiones[0].token_hash, sha256hex(r1.body.token));
  ok('el token en claro no queda en la tabla de sesiones', repo.sesiones[0].token_hash !== r1.body.token);

  const r2 = await svc.registrar({ email: 'empleado@local.cl', nombre: 'Empleado', pass: 'otra-clave-22' });
  igual('la segunda cuenta es member', r2.body.usuario.rol, 'member');
  ok('dos cuentas con distinta sal no comparten hash',
    repo.usuarios[0].pass_salt !== repo.usuarios[1].pass_salt &&
    repo.usuarios[0].pass_hash !== repo.usuarios[1].pass_hash);

  igual('correo repetido → 409', (await svc.registrar({ email: 'duena@local.cl', pass: 'clave-segura-1' })).status, 409);
  igual('correo inválido → 400', (await svc.registrar({ email: 'sin-arroba', pass: 'clave-segura-1' })).body.codigo, 'CORREO');
  igual('contraseña corta → 400', (await svc.registrar({ email: 'x@y.cl', pass: '123' })).body.codigo, 'CLAVE_CORTA');

  /* Tope de cuentas: servicio aparte para no ensuciar el conteo de arriba. */
  const repoTope = repoMemoria();
  const svcTope = crearServicio(repoTope, { ahora: () => reloj, maxCuentas: 2 });
  await svcTope.registrar({ email: 'uno@local.cl', pass: 'clave-segura-1' });
  await svcTope.registrar({ email: 'dos@local.cl', pass: 'clave-segura-2' });
  igual('tope de cuentas → 429',
    (await svcTope.registrar({ email: 'tres@local.cl', pass: 'clave-segura-3' })).status, 429);

  /* Contraseña mala: mismo código y contador que sube. */
  const mala = await svc.entrar({ email: 'duena@local.cl', pass: 'no-es-la-clave' });
  igual('contraseña mala → 401', mala.status, 401);
  igual('contraseña mala y correo inexistente comparten código',
    (await svc.entrar({ email: 'nadie@local.cl', pass: 'x' })).body.codigo, mala.body.codigo);
  igual('el intento fallido se cuenta', repo.usuarios[0].intentos, 1);

  let bloqueo = null;
  for (let i = 0; i < 10; i++) {
    const r = await svc.entrar({ email: 'duena@local.cl', pass: 'no-es-la-clave' });
    if (r.status === 429) { bloqueo = r; break; }
  }
  igual('tras 8 fallos la cuenta se bloquea', bloqueo && bloqueo.body.codigo, 'BLOQUEADO');
  igual('bloqueada, ni la clave buena entra', (await svc.entrar({ email: 'duena@local.cl', pass: 'clave-segura-1' })).status, 429);
  reloj += 11 * 60 * 1000;
  const buena = await svc.entrar({ email: 'duena@local.cl', pass: 'clave-segura-1' });
  igual('pasados 10 minutos vuelve a entrar', buena.status, 200);
  igual('entrar bien limpia los intentos', repo.usuarios[0].intentos, 0);

  const ses = await svc.sesion({}, buena.body.token);
  igual('la sesión válida devuelve el usuario', ses.body.usuario.email, 'duena@local.cl');
  igual('un token inventado no pasa', (await svc.sesion({}, 'token-falso')).status, 401);
  await svc.salir({}, buena.body.token);
  igual('salir revoca la sesión', (await svc.sesion({}, buena.body.token)).status, 401);

  const otra = await svc.entrar({ email: 'duena@local.cl', pass: 'clave-segura-1' });
  reloj += 31 * 24 * 3600 * 1000;
  igual('a los 31 días la sesión vence', (await svc.sesion({}, otra.body.token)).status, 401);

  igual('listar cuentas sin admin → 401', (await svc.usuarios(false)).status, 401);
  const lista = await svc.usuarios(true);
  ok('el listado no trae hashes', lista.body.usuarios.every((u) => !('pass_hash' in u)));
  igual('el listado trae las dos cuentas', lista.body.usuarios.length, 2);

  igual('borrar sin la contraseña correcta → 401',
    (await svc.borrar({ email: 'empleado@local.cl', pass: 'mala' })).status, 401);
  igual('borrar con la contraseña correcta → 200',
    (await svc.borrar({ email: 'empleado@local.cl', pass: 'otra-clave-22' })).status, 200);
  igual('la cuenta borrada ya no entra',
    (await svc.entrar({ email: 'empleado@local.cl', pass: 'otra-clave-22' })).status, 401);

  /* Invitación: con `CORE_INVITE` puesto, sin código no se crea nada. */
  const repoInv = repoMemoria();
  const svcInv = crearServicio(repoInv, { invitar: 'FORGE-2026' });
  igual('registro sin código → 403', (await svcInv.registrar({ email: 'a@b.cl', pass: 'clave-larga' })).body.codigo, 'INVITACION');
  igual('registro con código → 201',
    (await svcInv.registrar({ email: 'a@b.cl', pass: 'clave-larga', codigo: 'FORGE-2026' })).status, 201);
}

/* ── B · cliente real con SQLite ─────────────────────────────────────────── */

function almacen() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] || null,
  };
}

async function probarCliente() {
  const initSqlJs = require(path.join(RAIZ, 'web', 'app', 'vendor', 'sql-wasm.js'));
  const SQL = await initSqlJs({ locateFile: (f) => path.join(RAIZ, 'web', 'app', 'vendor', f) });
  const mod2 = await import(pathToFileURL(path.join(API, '_auth.js')).href);
  const A = mod2.default || mod2;
  const { crearServicio, sha256hex } = A;

  const coreNube = fs.readFileSync(path.join(RAIZ, 'web', 'app', 'core-nube.js'), 'utf8');
  const coreSec = fs.readFileSync(path.join(RAIZ, 'web', 'app', 'core-sec.js'), 'utf8');

  /**
   * Monta un "mundo": base SQLite nueva, almacenamiento nuevo y un servidor
   * falso que usa el MISMO núcleo que producción. `enLinea=false` simula que
   * la nube no responde (fetch lanza, como un móvil sin datos).
   */
  async function mundo(compartida) {
    const db = new SQL.Database();
    const q = (sql, p) => {
      const st = db.prepare(sql);
      try {
        if (p && p.length) st.bind(p.map((v) => (v === undefined ? null : v)));
        const out = [];
        while (st.step()) out.push(st.getAsObject());
        return out;
      } finally { st.free(); }
    };
    const run = (sql, p) => {
      if (p && p.length) db.run(sql, p.map((v) => (v === undefined ? null : v)));
      else db.run(sql);
    };
    const one = (sql, p) => q(sql, p)[0] || null;

    const entorno = compartida || {
      enLinea: true,
      llamadas: [],
      repo: repoMemoria(),
      reloj: Date.UTC(2026, 10, 10, 12, 0, 0),
    };
    if (!entorno.svc) entorno.svc = crearServicio(entorno.repo, { ahora: () => entorno.reloj });

    const despachar = async (cuerpo, token) => {
      const a = cuerpo.accion;
      if (a === 'registrar') return entorno.svc.registrar(cuerpo);
      if (a === 'entrar') return entorno.svc.entrar(cuerpo);
      if (a === 'sesion') return entorno.svc.sesion(cuerpo, token);
      if (a === 'salir') return entorno.svc.salir(cuerpo, token);
      if (a === 'usuarios') return entorno.svc.usuarios(true);
      return { status: 400, body: { ok: false, codigo: 'ACCION', error: 'acción desconocida' } };
    };

    const fetchFalso = async (url, opts) => {
      const cuerpo = JSON.parse(opts.body);
      entorno.llamadas.push({
        url, accion: cuerpo.accion, cuerpo,
        token: (opts.headers.Authorization || '').replace('Bearer ', ''),
      });
      if (!entorno.enLinea) throw new TypeError('Failed to fetch');
      const token = (opts.headers.Authorization || '').replace('Bearer ', '');
      const r = await despachar(cuerpo, token);
      return {
        ok: r.status < 400,
        status: r.status,
        json: async () => JSON.parse(JSON.stringify(r.body)),
      };
    };

    /* Contexto global que ven los dos archivos del cliente. */
    global.window = {};
    global.localStorage = almacen();
    global.sessionStorage = almacen();
    global.fetch = fetchFalso;
    global.document = { querySelector: () => null, getElementById: () => null, addEventListener() {} };

    const Fabri = {
      S: { db },
      q, one, run,
      save() {}, log() {}, audit() {}, metric() {}, toast() {},
    };
    global.window.Fabri = Fabri;

    vm.runInThisContext(coreNube, { filename: 'core-nube.js' });
    vm.runInThisContext(coreSec, { filename: 'core-sec.js' });
    const Auth = global.window.CoreAuth;
    const Nube = global.window.CoreNube;
    Auth.init();
    return { Auth, Nube, entorno, db, Fabri };
  }

  console.log('\n▸ cliente · cuenta en la nube espejada en SQLite');

  /* Una sola "nube" compartida por todos los dispositivos de la prueba. */
  const nube = {
    enLinea: true, llamadas: [], repo: repoMemoria(),
    reloj: Date.UTC(2026, 10, 10, 12, 0, 0),
  };

  /* 1 · Alta con nube: la cuenta nace en InsForge y se copia al navegador. */
  const m1 = await mundo(nube);
  const alta = await m1.Auth.register('Duena@Local.CL', 'Dueña', 'clave-segura-1');
  igual('register devuelve la cuenta de la nube', alta.nube, true);
  igual('register usa la acción "registrar"', nube.llamadas[0].accion, 'registrar');
  igual('la nube guardó una cuenta', nube.repo.usuarios.length, 1);
  igual('el espejo local guardó la misma cuenta',
    m1.Fabri.one('SELECT COUNT(*) c FROM users').c, 1);
  ok('hay token de nube guardado', Boolean(m1.Nube.leer() && m1.Nube.leer().token));
  ok('hay token de sesión local', Boolean(global.localStorage.getItem('fcore.token')));
  igual('current() devuelve la cuenta', (await m1.Auth.current()).email, 'duena@local.cl');
  igual('nubeInfo() muestra el correo', m1.Auth.nubeInfo().email, 'duena@local.cl');

  /* 2 · La sesión sobrevive a una recarga (misma base y almacenamiento). */
  igual('current() sigue válido tras "recargar"', (await m1.Auth.current()).email, 'duena@local.cl');

  /* 3 · Sin red: la copia local entra con la misma contraseña. */
  nube.enLinea = false;
  await m1.Auth.logout();
  igual('logout borra el token local', global.localStorage.getItem('fcore.token'), null);
  igual('logout borra el token de nube', global.localStorage.getItem('fcore.nube'), null);
  const sinRed = await m1.Auth.login('duena@local.cl', 'clave-segura-1');
  igual('sin red entra con la copia local', sinRed.email, 'duena@local.cl');
  igual('sin red NO dice que la cuenta está en la nube', sinRed.nube, false);

  /* 4 · Otro dispositivo: no hay copia local, entra por la nube. */
  nube.enLinea = true;
  const m2 = await mundo(nube);
  const nuevo = await m2.Auth.login('duena@local.cl', 'clave-segura-1');
  igual('otro dispositivo entra con la cuenta de la nube', nuevo.nube, true);
  igual('el otro dispositivo creó su espejo local',
    m2.Fabri.one('SELECT COUNT(*) c FROM users').c, 1);
  igual('el otro dispositivo guardó el token de nube', m2.Nube.estado().activa, true);

  /* 5 · Contraseña mala en la nube: error claro y sin espejo. */
  const m3 = await mundo(nube);
  let error = '';
  try { await m3.Auth.login('duena@local.cl', 'no-es-la-clave'); } catch (e) { error = e.message; }
  ok('contraseña mala da un mensaje de credenciales', /Correo o contraseña|incorrect/i.test(error), error);
  igual('no se creó espejo con una contraseña mala', m3.Fabri.one('SELECT COUNT(*) c FROM users').c, 0);

  /* 6 · Nube caída y cuenta nueva: se crea local y se avisa (nunca bloquea). */
  const m4 = await mundo();
  m4.entorno.enLinea = false;
  const local = await m4.Auth.register('nueva@local.cl', 'Nueva', 'clave-segura-9');
  igual('sin nube, el alta sigue funcionando en local', local.email, 'nueva@local.cl');
  igual('el alta local se marca como tal', local.nube, false);
  igual('la nube no recibió el alta', m4.entorno.repo.usuarios.length, 0);

  /* 7 · Casilla "sólo en este dispositivo": no llama a la nube. */
  const m5 = await mundo();
  const solo = await m5.Auth.register('solo@local.cl', 'Solo', 'clave-segura-8', { soloLocal: true });
  igual('soloLocal no llama a la nube', m5.entorno.llamadas.length, 0);
  igual('soloLocal crea la cuenta local', solo.nube, false);

  /* 8 · Verificar la sesión de nube y detectar que fue revocada. */
  const m6 = await mundo();
  await m6.Auth.register('verifica@local.cl', 'Verifica', 'clave-segura-7');
  const tokenNube = m6.Nube.leer().token;
  const v1 = await m6.Auth.verificarNube();
  igual('verificarNube() confirma la sesión', v1.ok, true);
  await m6.entorno.svc.salir({}, tokenNube);
  const v2 = await m6.Auth.verificarNube();
  igual('si el servidor la revocó, la nube se limpia', v2.ok, false);
  igual('el token de nube se borró', m6.Nube.leer(), null);

  /* 9 · El espejo local usa PBKDF2 real: el hash no es la contraseña. */
  const filaLocal = m1.Fabri.one('SELECT pass_hash, pass_salt, iterations FROM users LIMIT 1');
  ok('el espejo local guarda hash PBKDF2 base64url (43)', /^[A-Za-z0-9_-]{43}$/.test(filaLocal.pass_hash), filaLocal.pass_hash.length);
  igual('el espejo local usa 120.000 iteraciones', Number(filaLocal.iterations), 120000);
  ok('el espejo local no guarda la contraseña', !JSON.stringify(filaLocal).includes('clave-segura-1'));

  /* 10 · Contrato de red: POST JSON al endpoint de cuentas, token en cabecera. */
  const llamada = nube.llamadas[0];
  igual('el cliente apunta a /api/auth', llamada.url, 'https://fabri-api.vercel.app/api/auth');
  ok('el token de nube viaja como Bearer, nunca en el cuerpo', (() => {
    const conToken = nube.llamadas.find((l) => l.token);
    return conToken && !JSON.stringify(conToken.cuerpo).includes(conToken.token);
  })());
  igual('el cuerpo de "entrar" no lleva el token', Object.keys(
    nube.llamadas.find((l) => l.accion === 'entrar').cuerpo).includes('token'), false);

  /* 11 · Capas separadas: el token local no es el de la nube. */
  ok('el servidor guarda SHA-256 del token de nube',
    m6.entorno.repo.sesiones.some((s) => s.token_hash === sha256hex(tokenNube)));
  ok('el token en claro no quedó en ninguna tabla',
    m6.entorno.repo.sesiones.every((s) => s.token_hash !== tokenNube));
}

(async () => {
  try {
    await probarNucleo();
    await probarCliente();
  } catch (e) {
    fallos++;
    console.log('\n\x1b[1;31m✖ excepción:\x1b[0m ' + (e && e.stack ? e.stack : e));
  }
  console.log('');
  if (fallos) {
    console.log('\x1b[1;31m' + fallos + ' fallo(s)\x1b[0m');
    process.exit(1);
  }
  console.log('\x1b[1;32mtodo en verde\x1b[0m');
})();
