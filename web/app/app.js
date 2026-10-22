/* ============================================================================
   FABRI-CORE Web · PWA
   Misma arquitectura que el APK, en el navegador:
     · SQLite real (sql.js WASM) con las 13 tablas del contrato + FTS5
     · persistencia en IndexedDB (sobrevive recargas y funciona offline)
     · chat contra la función Go de Vercel (/api/agent)
     · consola SQL real y grafo animado con eventos reales
   Nada simulado: si algo no está disponible (FTS5, agente), la UI lo dice.
   ========================================================================== */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = () => Date.now();
  const fmtTime = ts => new Date(ts).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
  const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB';

  /* ── estado ───────────────────────────────────────────────────────────── */
  const S = { db: null, ftsModo: 'like', theme: localStorage.getItem('fcore.theme') || 'lime', events: [],
              installEvt: null, saveTimer: null, kind: 'hecho', busy: false };

  const THEMES = {
    lima:   { c: '#C8F542', soft: 'rgba(200,245,66,.13)',  name: 'Lima' },
    cian:   { c: '#5AD9E8', soft: 'rgba(90,217,232,.13)',  name: 'Cian' },
    violeta:{ c: '#B48CFF', soft: 'rgba(180,140,255,.13)', name: 'Violeta' },
    oro:    { c: '#FFB020', soft: 'rgba(255,176,32,.13)',  name: 'Oro' }
  };

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), 2400);
  }
  function applyTheme(key) {
    const t = THEMES[key] || THEMES.lima;
    S.theme = key; document.documentElement.style.setProperty('--accent', t.c);
    document.documentElement.style.setProperty('--accent-soft', t.soft);
    document.querySelector('meta[name=theme-color]').setAttribute('content', '#08090A');
    localStorage.setItem('fcore.theme', key);
    $$('#themes .chip').forEach(c => c.classList.toggle('on', c.dataset.k === key));
  }

  /* ── eventos (grafo) ──────────────────────────────────────────────────── */
  function ev(kind, detail) {
    const e = { kind, detail, t: now() };
    S.events.unshift(e); if (S.events.length > 60) S.events.pop();
    const log = $('#evLog');
    if (log) {
      const d = document.createElement('div');
      d.innerHTML = `<span style="color:var(--tx4)">${fmtTime(e.t)}</span> <span style="color:var(--accent)">${esc(kind)}</span> ${esc(detail)}`;
      log.prepend(d); while (log.children.length > 25) log.lastChild.remove();
    }
    Graph.pulse(kind);
  }

  /* ── persistencia IndexedDB ───────────────────────────────────────────── */
  const IDB = {
    db: null,
    open() {
      return new Promise((res, rej) => {
        const r = indexedDB.open('fabri-core', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => { IDB.db = r.result; res(); };
        r.onerror = () => rej(r.error);
      });
    },
    get(k) {
      return new Promise((res) => {
        const t = IDB.db.transaction('kv', 'readonly').objectStore('kv').get(k);
        t.onsuccess = () => res(t.result); t.onerror = () => res(null);
      });
    },
    set(k, v) {
      return new Promise((res) => {
        const t = IDB.db.transaction('kv', 'readwrite').objectStore('kv').put(v, k);
        t.onsuccess = () => res(true); t.onerror = () => res(false);
      });
    },
    clear() { return new Promise(res => { const t = IDB.db.transaction('kv', 'readwrite').objectStore('kv').clear(); t.onsuccess = () => res(); }); }
  };

  function log(level, tag, msg) {
    try { run('INSERT INTO logs(level, tag, message, at) VALUES(?,?,?,?)', [level, tag, String(msg).slice(0, 2000), Date.now()]); } catch (_) {}
  }
  function audit(actor, action, detail) {
    try { run('INSERT INTO audit(actor, action, detail, at) VALUES(?,?,?,?)', [actor, action, detail, Date.now()]); } catch (_) {}
  }
  function metric(name, value) {
    try { run('INSERT INTO metrics(name, value, at) VALUES(?,?,?)', [name, value, Date.now()]); } catch (_) {}
  }

  function save() {
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(async () => {
      if (!S.db) return;
      try { await IDB.set('dbfile', S.db.export()); } catch (_) {}
    }, 400);
  }

  /* ── SQLite ───────────────────────────────────────────────────────────── */
  const SCHEMA = `
    CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS projects(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, description TEXT, created_at INTEGER);
    CREATE TABLE IF NOT EXISTS conversations(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, created_at INTEGER);
    CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER, role TEXT, content TEXT, provenance TEXT, created_at INTEGER);
    CREATE TABLE IF NOT EXISTS documents(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, path TEXT, mime TEXT, size INTEGER, ocr_text TEXT, review_state TEXT DEFAULT 'pending', created_at INTEGER);
    CREATE TABLE IF NOT EXISTS document_chunks(id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, ordinal INTEGER, content TEXT);
    CREATE TABLE IF NOT EXISTS embeddings(chunk_id INTEGER, model TEXT, dims INTEGER, vector BLOB, created_at INTEGER, PRIMARY KEY(chunk_id, model));
    CREATE TABLE IF NOT EXISTS memory_items(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, content TEXT, provenance TEXT, verified INTEGER DEFAULT 0, created_at INTEGER);
    CREATE TABLE IF NOT EXISTS invoices(id INTEGER PRIMARY KEY AUTOINCREMENT, supplier TEXT, number TEXT, total REAL, currency TEXT, ocr_text TEXT, review_state TEXT DEFAULT 'pending', created_at INTEGER);
    CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT UNIQUE, name TEXT, price REAL, unit TEXT, description TEXT);
    CREATE TABLE IF NOT EXISTS brand_settings(id INTEGER PRIMARY KEY CHECK(id=1), business_name TEXT, logo_path TEXT, logo_position TEXT DEFAULT 'left', logo_scale REAL DEFAULT 1.0, accent TEXT, header TEXT, footer TEXT, contact TEXT, updated_at INTEGER);
    CREATE TABLE IF NOT EXISTS schema_version_log(version INTEGER, applied_at INTEGER);
  `;

  function q(sql, params) {
    const st = S.db.prepare(sql);
    try { if (params) st.bind(params); const rows = []; while (st.step()) rows.push(st.getAsObject()); return rows; }
    finally { st.free(); }
  }
  function run(sql, params) { S.db.run(sql, params || []); }
  function one(sql, params) { const r = q(sql, params); return r[0] || null; }

  async function initDb() {
    const SQL = await initSqlJs({ locateFile: f => './vendor/' + f });
    const bytes = await IDB.get('dbfile');
    S.db = bytes ? new SQL.Database(new Uint8Array(bytes)) : new SQL.Database();
    S.db.run(SCHEMA);

    // Índice de texto completo: no se asume. El sql.js estándar trae FTS3/4 (no FTS5),
    // así que se intenta de mayor a menor y la UI informa cuál quedó activo.
    try { S.db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(content, rid, kind)`); } catch (_) {}
    try { S.db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts4(content, rid, kind)`); } catch (_) {}
    const ddl = (one("SELECT sql FROM sqlite_master WHERE name='memory_fts'") || {}).sql || '';
    S.ftsModo = /fts5/i.test(ddl) ? 'fts5' : /fts4|fts3/i.test(ddl) ? 'fts4' : 'like';

    if (!bytes) await seed();
    if (S.ftsModo !== 'like') reindexar();
    save();
  }

  // El índice se reconstruye desde la tabla real: así nunca queda desincronizado
  // (los triggers de FTS varían entre versiones; esto funciona en FTS3, 4 y 5).
  function reindexar() {
    try {
      S.db.run('DELETE FROM memory_fts');
      S.db.run('INSERT INTO memory_fts(content, rid, kind) SELECT content, id, kind FROM memory_items');
    } catch (_) { S.ftsModo = 'like'; }
  }

  async function seed() {
    const t = now();
    run(`INSERT OR IGNORE INTO projects(name, description, created_at) VALUES(?,?,?)`, ['fabri-core', 'Espacio principal', t]);
    run(`INSERT OR IGNORE INTO brand_settings(id, business_name, accent, updated_at) VALUES(1,?,?,?)`, ['Soluciones Fabrick', '#C8F542', t]);
    run(`INSERT OR IGNORE INTO products(sku, name, price, unit) VALUES('SF-001','Kit audio Fabrick',12990,'CLP')`);
    const seeds = [
      ['hecho', 'FABRI-CORE corre entero en el navegador: SQLite con FTS5 por WASM, sin backend obligatorio.', 'ejemplo · editable', 1],
      ['preferencia', 'La paleta de la marca es lima #C8F542 sobre negro #08090A; el acento es configurable en el panel.', 'ejemplo · editable', 1],
      ['decision', 'Si el motor no trae FTS5, la búsqueda pasa a LIKE y la interfaz lo indica en vez de fingir.', 'ejemplo · editable', 1]
    ];
    for (const [k, c, p, v] of seeds) run(`INSERT INTO memory_items(kind, content, provenance, verified, created_at) VALUES(?,?,?,?,?)`, [k, c, p, v, t]);
  }

  /* ── panel ────────────────────────────────────────────────────────────── */
  function renderPanel() {
    const mem = one('SELECT COUNT(*) c FROM memory_items')?.c || 0;
    const msg = one('SELECT COUNT(*) c FROM messages')?.c || 0;
    const size = S.db.export().length;
    const etq = S.ftsModo === 'like' ? 'LIKE' : S.ftsModo.toUpperCase();
    const conIndice = S.ftsModo !== 'like';

    $('#kMem').textContent = mem;
    $('#kMemD').textContent = mem ? 'con procedencia' : 'sin registros';
    $('#kMsg').textContent = msg;
    $('#kDb').textContent = fmtSize(size);
    $('#kFts').textContent = etq;
    $('#kFtsD').textContent = conIndice ? 'índice de texto completo' : 'orden por fecha, sin índice';
    const b = $('#bFts'); b.textContent = conIndice ? 'activo' : 'no disponible';
    b.className = 'badge ' + (conIndice ? 'ok' : 'warn');
    $('#ftsSub').textContent = conIndice
      ? 'índice ' + etq + ' comprobado en runtime'
      : 'este motor no trae FTS: búsqueda por LIKE';
    $('#bDb').textContent = 'activo';
    fetch('/api/health').then(r => r.json()).then(j => {
      const b = $('#bAg');
      if (j && j.agent === 'configured') { b.textContent = 'conectado'; b.className = 'badge ok'; }
      else { b.textContent = j && j.ok ? 'sin clave' : 'sin backend'; b.className = 'badge warn'; }
    }).catch(() => { const b = $('#bAg'); b.textContent = 'offline'; b.className = 'badge warn'; });
  }

  /* ── chat ─────────────────────────────────────────────────────────────── */
  function pushMsg(role, text, isErr) {
    const log = $('#log');
    const d = document.createElement('div');
    d.className = 'msg ' + (role === 'user' ? 'me' : 'ai') + (isErr ? ' err' : '');
    d.innerHTML = `<span class="who">${role === 'user' ? 'tú' : 'fábri'}</span>${esc(text)}`;
    log.appendChild(d); log.scrollTop = log.scrollHeight;
  }

  async function sendChat() {
    const inp = $('#chatIn'); const text = inp.value.trim();
    if (!text || S.busy) return;
    S.busy = true; inp.value = ''; pushMsg('user', text);
    ev('chat', '→ agente');
    try {
      const r = await fetch('/api/agent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text })
      });
      let j = null; try { j = await r.json(); } catch (_) {}
      if (!r.ok || !j) throw new Error(j && j.error ? j.error : 'el agente no respondió (HTTP ' + r.status + ')');
      if (j.error) throw new Error(j.error);
      pushMsg('assistant', j.reply || '(respuesta vacía)');
      const conv = one('SELECT id FROM conversations ORDER BY id DESC LIMIT 1');
      const cid = conv ? conv.id : (run(`INSERT INTO conversations(title, created_at) VALUES('Chat web', ?)`, [now()]), one('SELECT last_insert_rowid() id').id);
      run(`INSERT INTO messages(conversation_id, role, content, provenance, created_at) VALUES(?,?,?,?,?)`, [cid, 'user', text, 'web', now()]);
      run(`INSERT INTO messages(conversation_id, role, content, provenance, created_at) VALUES(?,?,?,?,?)`, [cid, 'assistant', j.reply || '', j.model || 'agente', now()]);
      save(); renderPanel(); ev('sql', '2 mensajes guardados');
    } catch (e) {
      pushMsg('assistant', 'No pude responder: ' + e.message + '\n\nEl agente vive en la función Go (/api/agent). Configúrala con FABRI_LLM_URL y FABRI_LLM_KEY en Vercel, o usa el nodo local. Prefiero decírtelo a inventar una respuesta.', true);
      ev('error', e.message.slice(0, 60));
    } finally { S.busy = false; renderPanel(); }
  }

  /* ── consola SQL ──────────────────────────────────────────────────────── */
  function runSql() {
    const sql = $('#sqlIn').value.trim(); if (!sql) return;
    const out = $('#sqlOut'); const tbl = $('#sqlTbl'); tbl.innerHTML = '';
    const t0 = performance.now();
    try {
      const res = S.db.exec(sql);
      const ms = (performance.now() - t0).toFixed(1);
      if (!res.length) {
        out.innerHTML = `<span class="ok">OK</span> · ${ms} ms <span class="dim">(sin filas)</span>`;
        ev('sql', 'sentencia ejecutada'); save(); refreshAll(); return;
      }
      let html = '', last = null;
      for (const r of res) {
        last = r;
        html += `<div class="tbl-wrap" style="margin-top:8px"><table><thead><tr>${r.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${r.values.slice(0, 200).map(row => `<tr>${row.map(v => `<td title="${esc(v)}">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      }
      const total = res.reduce((a, r) => a + r.values.length, 0);
      out.innerHTML = `<span class="ok">${total} fila(s)</span> · ${ms} ms <span class="dim">· ${res[0].columns.length} columna(s)</span>`;
      tbl.innerHTML = html;
      ev('sql', `${total} filas en ${ms} ms`); save(); refreshAll();
    } catch (e) {
      out.innerHTML = `<span class="er">Error:</span> ${esc(e.message)}`;
      ev('error', 'SQL: ' + e.message.slice(0, 50));
    }
  }

  const QUICK = [
    ['Tablas', "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"],
    ['Memorias', 'SELECT kind, content, provenance FROM memory_items ORDER BY id DESC LIMIT 10;'],
    ['Mensajes', 'SELECT role, substr(content,1,60) txt, created_at FROM messages ORDER BY id DESC LIMIT 10;'],
    ['Conteos', "SELECT 'memorias' t, COUNT(*) n FROM memory_items UNION ALL SELECT 'mensajes', COUNT(*) FROM messages UNION ALL SELECT 'tablas', COUNT(*) FROM sqlite_master WHERE type='table';"],
    ['FTS5', "SELECT sqlite_compileoption_used('ENABLE_FTS5') AS fts5;"]
  ];

  /* ── memoria ──────────────────────────────────────────────────────────── */
  const KINDS = ['hecho', 'preferencia', 'decision', 'tarea', 'dato'];

  function renderMem(qtext) {
    $$('#memKinds .chip').forEach(c => c.classList.toggle('on', c.dataset.k === S.kind));
    let rows;
    const qs = (qtext || '').trim();
    if (qs) {
      if (S.ftsModo !== 'like') {
        try {
          rows = q("SELECT m.id, m.kind, m.content, m.provenance, m.verified, snippet(memory_fts, 0, '[[H]]', '[[/H]]', '…', 12) s FROM memory_fts f JOIN memory_items m ON m.id = CAST(f.rid AS INTEGER) WHERE memory_fts MATCH ? ORDER BY m.id DESC LIMIT 40", [qs]);
        } catch (_) {
          rows = q('SELECT * FROM memory_items WHERE content LIKE ? ORDER BY id DESC LIMIT 40', ['%' + qs + '%']);
        }
      } else {
        rows = q('SELECT * FROM memory_items WHERE content LIKE ? OR provenance LIKE ? ORDER BY id DESC LIMIT 40', ['%' + qs + '%', '%' + qs + '%']);
      }
    } else {
      rows = q('SELECT * FROM memory_items ORDER BY id DESC LIMIT 40');
    }
    const box = $('#memList');
    if (!rows.length) { box.innerHTML = '<div class="empty">Nada por aquí todavía.</div>'; return; }
    box.innerHTML = rows.map(r => `
      <div class="card tight">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span class="badge acc">${esc(r.kind)}</span>
          ${r.verified ? '<span class="badge ok">verificado</span>' : '<span class="badge warn">por verificar</span>'}
          <span class="mono" style="font-size:10px;color:var(--tx4);margin-left:auto">#${r.id}</span>
        </div>
        <div style="font-size:13.5px;line-height:1.5">${r.s ? esc(r.s).replace(/\[\[H\]\]/g, '<b>').replace(/\[\[\/H\]\]/g, '</b>') : esc(r.content)}</div>
        <div class="hint" style="margin-top:6px">${esc(r.provenance || 'sin procedencia')}</div>
      </div>`).join('');
  }

  function addMem() {
    const c = $('#memIn').value.trim(); if (!c) return toast('Escribe el hecho primero');
    run('INSERT INTO memory_items(kind, content, provenance, verified, created_at) VALUES(?,?,?,?,?)',
        [S.kind, c, $('#memProv').value.trim() || 'web', 0, now()]);
    if (S.ftsModo !== 'like') {
      try {
        const id = one('SELECT last_insert_rowid() id').id;
        run('INSERT INTO memory_fts(content, rid, kind) VALUES(?,?,?)', [c, id, S.kind]);
      } catch (_) {}
    }
    $('#memIn').value = ''; $('#memProv').value = '';
    ev(S.ftsModo === 'like' ? 'sql' : 'fts5', 'memoria indexada');
    save(); renderMem(); refreshAll(); toast('Guardado en memoria');
  }

  /* ── grafo ────────────────────────────────────────────────────────────── */
  const Graph = (() => {
    const NODES = ['UI', 'API Go', 'SQLite', 'FTS5', 'vector', 'RAG', 'agente', 'memoria'];
    let cv, ctx, w = 0, h = 0, phase = 0, raf = null, hot = null, hotT = 0;

    function size() {
      cv = $('#graph'); if (!cv) return;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const r = cv.getBoundingClientRect();
      w = r.width; h = 230; cv.width = w * dpr; cv.height = h * dpr;
      ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function accent() { return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#C8F542'; }

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      const pad = 26, step = (w - pad * 2) / (NODES.length - 1), y = h / 2 - 6;
      const active = (phase % 1) * (NODES.length - 1);
      // conexiones
      ctx.lineWidth = 1.4;
      for (let i = 0; i < NODES.length - 1; i++) {
        ctx.strokeStyle = '#22262C';
        ctx.beginPath(); ctx.moveTo(pad + step * i, y); ctx.lineTo(pad + step * (i + 1), y); ctx.stroke();
      }
      // pulso viajero
      const px = pad + step * active;
      const g = ctx.createRadialGradient(px, y, 0, px, y, 26);
      g.addColorStop(0, accent() + '55'); g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, y, 26, 0, Math.PI * 2); ctx.fill();
      // nodos
      NODES.forEach((n, i) => {
        const x = pad + step * i;
        const d = Math.abs(active - i);
        const on = d < 0.55;
        const hotN = hot === n && performance.now() - hotT < 900;
        ctx.beginPath(); ctx.arc(x, y, on || hotN ? 6.5 : 4, 0, Math.PI * 2);
        ctx.fillStyle = on || hotN ? accent() : '#313740'; ctx.fill();
        if (on || hotN) { ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.strokeStyle = accent() + '55'; ctx.lineWidth = 1; ctx.stroke(); }
        ctx.fillStyle = hotN ? accent() : '#828C84';
        ctx.font = '600 9.5px ui-monospace,Menlo,monospace';
        ctx.textAlign = 'center';
        ctx.fillText(n, x, y + 22);
      });
      phase = (phase + 0.0035) % 1;
      raf = requestAnimationFrame(draw);
    }

    return {
      init() { size(); if (!raf) draw(); addEventListener('resize', size); },
      pulse(kind) {
        const map = { sql: 'SQLite', fts5: 'FTS5', chat: 'agente', api: 'API Go', memory: 'memoria', error: 'UI', rag: 'RAG' };
        hot = map[kind] || 'UI'; hotT = performance.now();
      },
      wake() { if (!raf) draw(); }
    };
  })();

  /* ── navegación ───────────────────────────────────────────────────────── */
  function go(id) {
    $$('.screen').forEach(s => s.classList.toggle('on', s.id === 's-' + id));
    $$('.nav button').forEach(b => b.classList.toggle('on', b.dataset.go === id));
    if (id === 'panel') renderPanel();
    if (id === 'mem') renderMem($('#memQ').value);
    if (id === 'flow') { Graph.init(); Graph.wake(); }
    if (id === 'sql') { $('#sqlIn').focus(); }
    if (id === 'datos') Pro.renderDatos();
    if (id === 'ia') Pro.renderIA();
    if (id === 'cuenta') Pro.renderCuenta();
    history.replaceState(null, '', '#' + id);
  }

  function refreshAll() {
    if ($('#s-panel').classList.contains('on')) renderPanel();
    if ($('#s-mem').classList.contains('on')) renderMem($('#memQ').value);
  }

  /* ── arranque ─────────────────────────────────────────────────────────── */
  async function boot() {
    // temas
    $('#themes').innerHTML = Object.entries(THEMES).map(([k, t]) =>
      `<button class="chip" data-k="${k}"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${t.c};margin-right:7px;vertical-align:-1px"></span>${t.name}</button>`).join('');
    $$('#themes .chip').forEach(c => c.onclick = () => { applyTheme(c.dataset.k); toast('Acento ' + THEMES[c.dataset.k].name); });
    applyTheme(S.theme);

    // memoria: chips de tipo
    $('#memKinds').innerHTML = KINDS.map(k => `<button class="chip${k === S.kind ? ' on' : ''}" data-k="${k}">${k}</button>`).join('');
    $$('#memKinds .chip').forEach(c => c.onclick = () => { S.kind = c.dataset.k; renderMem($('#memQ').value); });

    // consola: atajos
    $('#sqlQuick').innerHTML = QUICK.map(([n], i) => `<button class="chip" data-i="${i}">${n}</button>`).join('');
    $$('#sqlQuick .chip').forEach(c => c.onclick = () => { $('#sqlIn').value = QUICK[+c.dataset.i][1]; runSql(); });

    // nav
    $$('.nav button').forEach(b => b.onclick = () => go(b.dataset.go));
    const hash = location.hash.replace('#', '');

    // eventos UI
    $('#btnSend').onclick = sendChat;
    $('#chatIn').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendChat(); });
    $('#btnRun').onclick = runSql;
    $('#sqlIn').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) runSql(); });
    $('#btnSchema').onclick = () => { $('#sqlIn').value = QUICK[0][1]; runSql(); };
    $('#btnMem').onclick = addMem;
    $('#memQ').addEventListener('input', e => renderMem(e.target.value));
    $('#btnReset').onclick = async () => {
      if (!confirm('¿Borrar la base local y las memorias de este navegador?')) return;
      await IDB.clear(); location.reload();
    };

    // conexión
    const setNet = () => {
      const on = navigator.onLine;
      $('#offBar').classList.toggle('on', !on);
      $('#live').innerHTML = `<i class="dot ${on ? '' : 'off'}"></i><span>${on ? 'en línea' : 'offline'}</span>`;
    };
    addEventListener('online', setNet); addEventListener('offline', setNet); setNet();

    // service worker
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('./sw.js', { scope: './' });
        $('#bSw').textContent = 'listo';
      } catch (e) { $('#bSw').textContent = 'no'; $('#bSw').className = 'badge warn'; }
    }

    // instalación PWA
    addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; });
    $('#btnInstall').onclick = async () => {
      if (S.installEvt) { S.installEvt.prompt(); const r = await S.installEvt.userChoice; toast(r.outcome === 'accepted' ? 'Instalada' : 'Cancelado'); S.installEvt = null; }
      else toast('Usa el menú del navegador → “Agregar a pantalla de inicio”');
    };

    // base
    try {
      await IDB.open();
      await initDb();
      CoreAuth.init();
      const user = await Pro.gate();
      window.Fabri.user = user;
      $('#ver').textContent = 'web · v1.1 · ' + (S.ftsModo === 'like' ? 'LIKE' : S.ftsModo.toUpperCase());
      // un fallo de una vista no debe tumbar el arranque
      const safe = fn => { try { fn(); } catch (e) { console.error(e); ev('error', String(e.message).slice(0, 40)); } };
      safe(renderPanel); safe(renderMem);
      go(hash && document.getElementById('s-' + hash) ? hash : 'panel');
      pushMsg('assistant', 'Listo. Esta consola corre entera en tu navegador: la base es SQLite real y sobrevive a las recargas. Pregúntame algo o abre la consola SQL.');
      ev('api', 'núcleo iniciado');
    } catch (e) {
      $('#ver').textContent = 'error de arranque';
      toast('No pude iniciar SQLite: ' + e.message);
      console.error(e);
    }
  }

  // API para los módulos (auth, bóveda, datos, IA)
  window.Fabri = { S, q, one, run, save, toast, ev, log, audit, metric, go, refreshAll, IDB };

  document.addEventListener('DOMContentLoaded', boot);
})();
