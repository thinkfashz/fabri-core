/* FORGE CORE STOCK · seguridad en el navegador (auth real + bóveda cifrada).
 *
 * · Contraseñas: PBKDF2-HMAC-SHA256, 120.000 iteraciones, sal única (WebCrypto).
 * · Sesiones: token de 256 bits; en la base solo su SHA-256, con vencimiento.
 * · Claves de IA: AES-256-GCM con una clave del dispositivo guardada en IndexedDB.
 *   Límite honesto: protege el almacenamiento en reposo; no protege contra XSS
 *   mientras la app está abierta (ningún esquema en el navegador puede).
 */
(function () {
  'use strict';

  const F = () => window.Fabri;
  const b64 = buf => btoa(String.fromCharCode.apply(null, new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64 = s => {
    const t = s.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(t + '==='.slice((t.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  const enc = new TextEncoder();

  /* Nube: `core-nube.js` es la única pieza que habla con fabri-api. Si el
     archivo no está (versión vieja cacheada), todo sigue funcionando local. */
  const nube = () => window.CoreNube || null;
  const nubeActiva = () => Boolean(nube() && nube().activa());
  const navegador = () => String((typeof navigator !== 'undefined' && navigator.userAgent) || 'navegador').slice(0, 120);

  async function pbkdf2(pass, salt, iter) {
    const k = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode(salt), iterations: iter || 120000, hash: 'SHA-256' }, k, 256);
    return b64(bits);
  }

  async function sha256(s) {
    return b64(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  }

  function token(n) {
    const b = new Uint8Array(n || 32);
    crypto.getRandomValues(b);
    return b64(b);
  }

  function constEq(a, b) {
    if (a.length !== b.length) return false;
    let r = 0;
    for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
  }

  /* ── Auth ─────────────────────────────────────────────────────────────── */
  const Auth = {
    SCHEMA: `
      CREATE TABLE IF NOT EXISTS users(
        id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, name TEXT,
        pass_hash TEXT NOT NULL, pass_salt TEXT NOT NULL,
        iterations INTEGER NOT NULL DEFAULT 120000, role TEXT NOT NULL DEFAULT 'owner',
        created_at INTEGER NOT NULL, last_login INTEGER);
      CREATE TABLE IF NOT EXISTS sessions(
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL, device TEXT, created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS logs(
        id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT NOT NULL DEFAULT 'info',
        tag TEXT NOT NULL, message TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(
        id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, action TEXT NOT NULL,
        detail TEXT, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS metrics(
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, value REAL NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS consents(perm TEXT PRIMARY KEY, granted INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS files(
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0,
        mime TEXT, kind TEXT, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS api_keys(
        id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL, label TEXT,
        base_url TEXT, model TEXT, cipher TEXT NOT NULL, iv TEXT NOT NULL,
        masked TEXT, active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    `,
    init() {
      const f = F();
      try { f.S.db.run(this.SCHEMA); } catch (e) { console.error(e); }
      try { f.S.db.run('CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash)'); } catch (_) {}
    },
    count() { return Number(F().one('SELECT COUNT(*) c FROM users').c) || 0; },

    /* ── puente con la nube ──────────────────────────────────────────────── */

    /** Crea la sesión local (token + fila) para un usuario ya validado. */
    async _sesionLocal(u) {
      const f = F();
      const t = token(32);
      const exp = Date.now() + 30 * 24 * 3600 * 1000;
      f.run('INSERT INTO sessions(user_id, token_hash, device, created_at, expires_at) VALUES(?,?,?,?,?)',
        [u.id, await sha256(t), navegador(), Date.now(), exp]);
      f.run('UPDATE users SET last_login = ? WHERE id = ?', [Date.now(), u.id]);
      f.save();
      localStorage.setItem('fcore.token', t);
      f.log('info', 'auth', 'sesión iniciada: ' + u.email);
      f.audit(u.email, 'login', 'token emitido');
      return { id: u.id, email: u.email, name: u.name, role: u.role };
    },

    /**
     * Copia local de una cuenta que YA existe en la nube. Se guarda con la
     * misma contraseña (PBKDF2 local) para poder entrar sin red. No es una
     * segunda cuenta: es el espejo que permite trabajar offline.
     */
    async _espejo(email, name, pass, role, enNube) {
      const f = F();
      const e = email.trim().toLowerCase();
      const salt = token(16);
      const hash = await pbkdf2(pass, salt, 120000);
      const previo = f.one('SELECT * FROM users WHERE email = ?', [e]);
      if (previo) {
        f.run('UPDATE users SET name = ?, pass_hash = ?, pass_salt = ?, iterations = ? WHERE id = ?',
          [(name || '').trim() || previo.name || e.split('@')[0], hash, salt, 120000, previo.id]);
      } else {
        const rol = role || (this.count() === 0 ? 'owner' : 'member');
        f.run('INSERT INTO users(email, name, pass_hash, pass_salt, iterations, role, created_at) VALUES(?,?,?,?,?,?,?)',
          [e, (name || '').trim() || e.split('@')[0], hash, salt, 120000, rol, Date.now()]);
      }
      f.save();
      const u = f.one('SELECT * FROM users WHERE email = ?', [e]);
      const ses = await this._sesionLocal(u);
      return Object.assign(ses, { nube: Boolean(enNube) });
    },

    /** Alta sólo en este dispositivo: el camino de siempre, sin red. */
    async _registroLocal(email, name, pass) {
      const f = F();
      const e = email.trim().toLowerCase();
      if (Number(f.one('SELECT COUNT(*) c FROM users WHERE email = ?', [e]).c) > 0)
        throw new Error('Ese correo ya está registrado en este navegador');
      const salt = token(16);
      const hash = await pbkdf2(pass, salt, 120000);
      const role = this.count() === 0 ? 'owner' : 'member';
      f.run('INSERT INTO users(email, name, pass_hash, pass_salt, iterations, role, created_at) VALUES(?,?,?,?,?,?,?)',
        [e, (name || '').trim() || e.split('@')[0], hash, salt, 120000, role, Date.now()]);
      f.save();
      f.log('info', 'auth', 'usuario creado: ' + e);
      const u = f.one('SELECT * FROM users WHERE email = ?', [e]);
      return Object.assign(await this._sesionLocal(u), { nube: false });
    },

    /**
     * Alta de cuenta. Con nube disponible la cuenta vive en InsForge y se
     * espeja acá; si la nube no responde, crea la cuenta local (nunca deja al
     * usuario sin app). `opts.soloLocal` fuerza el camino local.
     */
    async register(email, name, pass, opts) {
      const o = opts || {};
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('El correo no parece válido');
      if (pass.length < 8) throw new Error('La contraseña necesita al menos 8 caracteres');
      const e = email.trim().toLowerCase();
      const n = nube();
      if (n && !o.soloLocal) {
        const r = await n.api('registrar', {
          email: e, nombre: name || '', pass, dispositivo: navegador(),
        });
        if (r.ok) {
          n.guardar(r);
          F().log('info', 'auth', 'cuenta creada en la nube: ' + e);
          return this._espejo(e, (r.usuario && r.usuario.nombre) || name, pass,
            r.usuario && r.usuario.rol, true);
        }
        // Rechazos de regla: no se reintenta en local (sería una cuenta
        // distinta con el mismo correo y confundiría al usuario).
        if (['YA_EXISTE', 'CORREO', 'CLAVE_CORTA', 'INVITACION', 'TOPE', 'BLOQUEADO'].indexOf(r.codigo) >= 0)
          throw new Error(r.error || 'La nube rechazó el registro');
        // SIN_RED / SIN_BASE / ERROR_BASE → se sigue en local.
      }
      return this._registroLocal(e, name, pass);
    },

    /**
     * Entrada. Primero la copia local (rápida y offline); si no existe o la
     * contraseña no coincide, prueba la nube y espeja el resultado. Así una
     * cuenta creada en otro dispositivo entra sin reinstalar nada.
     */
    async login(email, pass, opts) {
      const f = F();
      const e = email.trim().toLowerCase();
      const u = f.one('SELECT * FROM users WHERE email = ?', [e]);
      if (u) {
        const calc = await pbkdf2(pass, u.pass_salt, u.iterations || 120000);
        if (constEq(calc, u.pass_hash)) {
          const ses = await this._sesionLocal(u);
          return Object.assign(ses, { nube: nubeActiva() });
        }
        f.log('warn', 'auth', 'intento fallido: ' + e);
      }
      const n = nube();
      if (n) {
        const r = await n.api('entrar', { email: e, pass, dispositivo: navegador() });
        if (r.ok) {
          n.guardar(r);
          return this._espejo(e, (r.usuario && r.usuario.nombre) || (u && u.name), pass,
            r.usuario && r.usuario.rol, true);
        }
        if (r.codigo === 'CREDENCIALES' || r.codigo === 'BLOQUEADO')
          throw new Error(r.error || 'Correo o contraseña incorrectos');
        if (!u) throw new Error('No existe una cuenta con ese correo en este dispositivo y la nube no respondió');
      }
      if (!u) throw new Error('No existe una cuenta con ese correo en este navegador');
      throw new Error('Contraseña incorrecta');
    },

    /** Datos guardados de la sesión de nube (para la pantalla de cuenta). */
    nubeInfo() {
      const n = nube();
      const d = n && n.leer ? n.leer() : null;
      return {
        activa: Boolean(d && d.token),
        email: d && d.usuario ? d.usuario.email : '',
        nombre: d && d.usuario ? d.usuario.nombre : '',
        rol: d && d.usuario ? d.usuario.rol : '',
        vence: d ? Number(d.exp) || 0 : 0,
        estado: n && n.estado ? n.estado() : null,
      };
    },

    /** Comprueba el token contra InsForge. Devuelve `{ ok }` sin lanzar. */
    async verificarNube() {
      const n = nube();
      if (!n) return { ok: false, codigo: 'SIN_NUBE', error: 'esta versión no trae el módulo de nube' };
      const d = n.leer();
      if (!d || !d.token) return { ok: false, codigo: 'SIN_SESION', error: 'no hay sesión de nube guardada' };
      const r = await n.api('sesion', {}, { token: d.token });
      if (r.ok) {
        n.guardar({ token: d.token, expira: r.expira, usuario: r.usuario });
      } else if (r.codigo === 'SESION') {
        n.limpiar();
      }
      return r;
    },

    async current() {
      const t = localStorage.getItem('fcore.token');
      if (!t) return null;
      try {
        const f = F();
        const h = await sha256(t);
        const r = f.one(`SELECT u.id, u.email, u.name, u.role FROM sessions s
                         JOIN users u ON u.id = s.user_id
                         WHERE s.token_hash = ? AND s.revoked = 0 AND s.expires_at > ? LIMIT 1`,
          [h, Date.now()]);
        if (!r) return null;
        r.nube = nubeActiva();
        return r;
      } catch (_) { return null; }
    },

    async logout() {
      const n = nube();
      const guardado = n && n.leer ? n.leer() : null;
      const t = localStorage.getItem('fcore.token');
      if (t) {
        try { F().run('UPDATE sessions SET revoked = 1 WHERE token_hash = ?', [await sha256(t)]); } catch (_) {}
      }
      localStorage.removeItem('fcore.token');
      if (n && guardado && guardado.token) {
        try { await n.api('salir', {}, { token: guardado.token, ms: 5000 }); } catch (_) {}
        n.limpiar();
      }
    },

    sessions() {
      try {
        return F().q(`SELECT s.id, u.email, s.device, s.created_at, s.expires_at, s.revoked
                      FROM sessions s JOIN users u ON u.id = s.user_id ORDER BY s.id DESC LIMIT 20`);
      } catch (_) { return []; }
    }
  };

  /* ── Bóveda ───────────────────────────────────────────────────────────── */
  const PROVIDERS = [
    { id: 'openai', name: 'OpenAI', kind: 'openai', base: 'https://api.openai.com/v1', models: ['gpt-4o-mini', 'gpt-4o', 'o4-mini'], free: false, docs: 'platform.openai.com/api-keys' },
    { id: 'anthropic', name: 'Anthropic', kind: 'anthropic', base: 'https://api.anthropic.com/v1', models: ['claude-3-5-haiku-latest', 'claude-3-7-sonnet-latest'], free: false, docs: 'console.anthropic.com' },
    { id: 'google', name: 'Google Gemini', kind: 'google', base: 'https://generativelanguage.googleapis.com/v1beta', models: ['gemini-2.0-flash', 'gemini-2.5-flash'], free: true, docs: 'aistudio.google.com/apikey' },
    { id: 'groq', name: 'Groq', kind: 'openai', base: 'https://api.groq.com/openai/v1', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'], free: true, docs: 'console.groq.com/keys' },
    { id: 'openrouter', name: 'OpenRouter', kind: 'openai', base: 'https://openrouter.ai/api/v1', models: ['deepseek/deepseek-chat', 'meta-llama/llama-3.3-70b-instruct:free'], free: true, docs: 'openrouter.ai/keys' },
    { id: 'mistral', name: 'Mistral', kind: 'openai', base: 'https://api.mistral.ai/v1', models: ['mistral-small-latest', 'open-mistral-nemo'], free: false, docs: 'console.mistral.ai' },
    { id: 'deepseek', name: 'DeepSeek', kind: 'openai', base: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'], free: false, docs: 'platform.deepseek.com' },
    { id: 'together', name: 'Together', kind: 'openai', base: 'https://api.together.xyz/v1', models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'], free: false, docs: 'api.together.ai' },
    { id: 'ollama', name: 'Ollama (local)', kind: 'openai', base: 'http://127.0.0.1:11434/v1', models: ['llama3.2'], free: true, docs: 'ollama.com' }
  ];

  const Vault = {
    _key: null,
    async key() {
      if (this._key) return this._key;
      const IDB = window.IDB;
      let raw = await IDB.get('vaultkey');
      if (!raw) {
        const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
        raw = await crypto.subtle.exportKey('raw', k);
        await IDB.set('vaultkey', raw);
      }
      this._key = await crypto.subtle.importKey('raw', new Uint8Array(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
      return this._key;
    },
    async encrypt(text) {
      const k = await this.key();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(text));
      return { c: b64(ct), iv: b64(iv) };
    },
    async decrypt(c, iv) {
      try {
        const k = await this.key();
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, k, unb64(c));
        return new TextDecoder().decode(pt);
      } catch (_) { return null; }
    },
    mask(s) { return s.length <= 8 ? '••••' : s.slice(0, 4) + '••••' + s.slice(-4); },
    async save(provider, secret, baseUrl, model, label) {
      const f = F();
      const { c, iv } = await this.encrypt(secret.trim());
      const now = Date.now();
      f.run(`INSERT INTO api_keys(provider, label, base_url, model, cipher, iv, masked, active, created_at, updated_at)
             VALUES(?,?,?,?,?,?,?,1,?,?)`,
        [provider, label || provider, baseUrl, model, c, iv, this.mask(secret.trim()), now, now]);
      f.save();
      f.log('info', 'vault', 'clave cifrada para ' + provider);
      f.audit(null, 'clave_guardada', provider + ' · ' + this.mask(secret.trim()));
      return true;
    },
    list() {
      try {
        return F().q('SELECT * FROM api_keys WHERE active = 1 ORDER BY provider, id DESC');
      } catch (_) { return []; }
    },
    remove(id) {
      F().run('UPDATE api_keys SET active = 0, updated_at = ? WHERE id = ?', [Date.now(), id]);
      F().save();
      F().audit(null, 'clave_revocada', '#' + id);
    },
    async secret(id) {
      const f = F();
      const r = f.one('SELECT cipher, iv FROM api_keys WHERE id = ? AND active = 1', [id]);
      return r ? await this.decrypt(r.cipher, r.iv) : null;
    },
    provider(id) { return PROVIDERS.find(p => p.id === id) || null; },
    PROVIDERS,

    async ping(providerId, base, key) {
      const p = this.provider(providerId);
      const kind = p ? p.kind : 'openai';
      base = (base || '').replace(/\/+$/, '');
      try {
        if (kind === 'anthropic') {
          const r = await fetch(base + '/messages', {
            method: 'POST',
            headers: {
              'content-type': 'application/json', 'x-api-key': key,
              'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({ model: 'claude-3-5-haiku-latest', max_tokens: 1, messages: [{ role: 'user', content: 'hola' }] })
          });
          const t = await r.text();
          return r.ok ? [true, 'Clave válida (HTTP ' + r.status + ')'] : [false, 'HTTP ' + r.status + ' · ' + t.slice(0, 180)];
        }
        if (kind === 'google') {
          const r = await fetch(base + '/models?key=' + encodeURIComponent(key));
          const t = await r.text();
          return r.ok ? [true, 'Clave válida (HTTP ' + r.status + ')'] : [false, 'HTTP ' + r.status + ' · ' + t.slice(0, 180)];
        }
        const r = await fetch(base + '/models', { headers: { authorization: 'Bearer ' + key } });
        const t = await r.text();
        if (!r.ok) return [false, 'HTTP ' + r.status + ' · ' + t.slice(0, 180)];
        let n = 0;
        try { n = (JSON.parse(t).data || []).length; } catch (_) {}
        return [true, 'Clave válida · ' + n + ' modelo(s) visibles'];
      } catch (e) {
        return [false, e.message + (String(e.message).match(/Failed to fetch/i) ? ' (posible CORS del proveedor)' : '')];
      }
    },

    async ask(providerId, base, model, key, prompt) {
      const p = this.provider(providerId);
      const kind = p ? p.kind : 'openai';
      base = (base || '').replace(/\/+$/, '');
      const t0 = performance.now();
      const SYS = 'Eres FORGE CORE STOCK, consola que corre en el dispositivo del usuario. Respondes en español, breve y concreto. ' +
        'No inventas datos: si algo requiere la base local, dices qué consulta SQL haría falta. No pides credenciales.';
      let res, raw;
      try {
        if (kind === 'anthropic') {
          res = await fetch(base + '/messages', {
            method: 'POST',
            headers: {
              'content-type': 'application/json', 'x-api-key': key,
              'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
              model: model || 'claude-3-5-haiku-latest', max_tokens: 1024, system: SYS,
              messages: [{ role: 'user', content: prompt }]
            })
          });
          raw = await res.text();
          if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + raw.slice(0, 220));
          const j = JSON.parse(raw);
          return { ok: true, text: (j.content && j.content[0] && j.content[0].text) || '(sin texto)', ms: Math.round(performance.now() - t0) };
        }
        if (kind === 'google') {
          const m = model || 'gemini-2.0-flash';
          res = await fetch(base + '/models/' + m + ':generateContent?key=' + encodeURIComponent(key), {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: SYS }] },
              contents: [{ parts: [{ text: prompt }] }]
            })
          });
          raw = await res.text();
          if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + raw.slice(0, 220));
          const j = JSON.parse(raw);
          const t = j.candidates && j.candidates[0] && j.candidates[0].content &&
            j.candidates[0].content.parts && j.candidates[0].content.parts[0] &&
            j.candidates[0].content.parts[0].text;
          return { ok: true, text: t || '(sin texto)', ms: Math.round(performance.now() - t0) };
        }
        res = await fetch(base + '/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
          body: JSON.stringify({
            model: model || 'gpt-4o-mini', temperature: 0.3,
            messages: [{ role: 'system', content: SYS }, { role: 'user', content: prompt }]
          })
        });
        raw = await res.text();
        if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + raw.slice(0, 220));
        const j = JSON.parse(raw);
        return {
          ok: true,
          text: (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '(sin texto)',
          ms: Math.round(performance.now() - t0)
        };
      } catch (e) {
        return { ok: false, text: e.message, ms: Math.round(performance.now() - t0) };
      }
    }
  };

  window.CoreAuth = Auth;
  window.CoreVault = Vault;
})();
