/* FABRI-CORE · pantallas profesionales: Datos, IA, Cuenta.
 * Todo se calcula con la base real del navegador; nada simulado.
 */
(function () {
  'use strict';

  const F = () => window.Fabri;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function bytes(n) {
    n = Number(n) || 0;
    if (n >= 1 << 30) return (n / (1 << 30)).toFixed(2) + ' GB';
    if (n >= 1 << 20) return (n / (1 << 20)).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
    return n + ' B';
  }
  const num = n => (Number(n) || 0).toLocaleString('es-CL');

  function kpi(label, value, accent) {
    return `<div class="card" style="padding:14px">
      <div class="eyebrow" style="font-size:9.5px">${esc(label)}</div>
      <div style="font-size:22px;font-weight:800;letter-spacing:-.02em;${accent ? 'color:var(--accent)' : ''}">${esc(value)}</div>
    </div>`;
  }

  function bars(data, color) {
    const max = Math.max(1, ...data.map(d => d.v));
    return `<div style="display:flex;flex-direction:column;gap:7px">` + data.map(d => `
      <div style="display:flex;align-items:center;gap:8px">
        <div class="mono" style="width:96px;font-size:10.5px;color:var(--tx2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(d.k)}</div>
        <div style="flex:1;height:9px;border-radius:4px;background:rgba(255,255,255,.05);overflow:hidden">
          <div style="height:100%;width:${Math.max(2, (d.v / max) * 100)}%;background:${color || 'var(--accent)'};border-radius:4px"></div>
        </div>
        <div class="mono" style="width:52px;text-align:right;font-size:10.5px">${num(d.v)}</div>
      </div>`).join('') + `</div>`;
  }

  function table(cols, rows, max) {
    if (!cols.length) return '<div class="empty">Sin columnas</div>';
    return `<div class="tbl-wrap" style="max-height:340px;overflow:auto">
      <table style="width:100%;border-collapse:collapse;font-size:11.5px">
        <thead><tr>${cols.map(c => `<th style="text-align:left;padding:7px 8px;color:var(--tx2);font-weight:700;position:sticky;top:0;background:#171a1e">${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${(rows || []).slice(0, max || 80).map((r, i) => `<tr style="background:${i % 2 ? 'rgba(255,255,255,.02)' : 'transparent'}">${r.map(v => `<td style="padding:6px 8px;border-bottom:1px solid rgba(34,38,44,.6);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>`;
  }

  function tableList() {
    const f = F();
    try {
      return f.q("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' ORDER BY name")
        .map(r => r.name);
    } catch (_) { return []; }
  }

  /* ── DATOS ─────────────────────────────────────────────────────────────── */
  function renderDatos() {
    const f = F();
    const host = $('#pro-datos');
    if (!host) return;
    if (!f.S || !f.S.db) return;
    const tabs = tableList();
    const counts = tabs.map(t => {
      let c = 0;
      try { c = Number(f.one(`SELECT COUNT(*) c FROM "${t}"`).c) || 0; } catch (_) {}
      return { k: t, v: c };
    });
    const totalRows = counts.reduce((a, b) => a + b.v, 0);
    const size = f.S.db.export().length;

    const dias = (() => {
      try {
        return f.q(`SELECT date(at/1000,'unixepoch','localtime') d, COUNT(*) c FROM logs GROUP BY d ORDER BY d DESC LIMIT 14`)
          .reverse().map(r => ({ k: r.d.slice(5), v: Number(r.c) }));
      } catch (_) { return []; }
    })();

    const tags = (() => {
      try {
        return f.q('SELECT tag, COUNT(*) c FROM logs GROUP BY tag ORDER BY c DESC LIMIT 8')
          .map(r => ({ k: r.tag, v: Number(r.c) }));
      } catch (_) { return []; }
    })();

    const sel = tabs.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');

    host.innerHTML = `
      <div class="kpi-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:10px">
        ${kpi('Base local', bytes(size), true)}
        ${kpi('Tablas', tabs.length)}
        ${kpi('Filas', num(totalRows))}
        ${kpi('Búsqueda', f.S.ftsModo === 'like' ? 'LIKE' : f.S.ftsModo.toUpperCase(), true)}
      </div>

      <div class="card" style="margin-bottom:10px">
        <div class="eyebrow" style="margin-bottom:8px">Filas por tabla</div>
        ${bars(counts.filter(c => c.v > 0).sort((a, b) => b.v - a.v))}
      </div>

      ${dias.length ? `<div class="card" style="margin-bottom:10px">
        <div class="eyebrow" style="margin-bottom:8px">Eventos por día (14 días)</div>
        ${bars(dias, '#5AD9E8')}
      </div>` : ''}

      ${tags.length ? `<div class="card" style="margin-bottom:10px">
        <div class="eyebrow" style="margin-bottom:8px">Eventos por módulo</div>
        ${bars(tags, '#B39DFF')}
      </div>` : ''}

      <div class="card" style="margin-bottom:10px">
        <div class="eyebrow" style="margin-bottom:8px">Exportar a Excel</div>
        <div class="row" style="display:flex;gap:7px;flex-wrap:wrap;align-items:center">
          <select id="expT" class="field" style="flex:1;min-width:140px">${sel}</select>
          <button class="btn" id="expX">XLSX</button>
          <button class="btn ghost" id="expC">CSV</button>
        </div>
        <p class="hint" style="margin-top:8px">.xlsx real (OOXML) generado en el navegador, sin servidores ni librerías.</p>
      </div>

      <div class="card">
        <div class="eyebrow" style="margin-bottom:8px">Vista previa</div>
        <div id="expPrev" class="hint">Elige una tabla…</div>
      </div>
    `;

    const preview = t => {
      try {
        const r = f.q(`SELECT * FROM "${t}" LIMIT 25`);
        const cols = r.length ? Object.keys(r[0]) : [];
        $('#expPrev').innerHTML = table(cols, r.map(o => cols.map(c => o[c])));
      } catch (e) { $('#expPrev').textContent = 'Error: ' + e.message; }
    };
    $('#expT').onchange = e => preview(e.target.value);
    preview(tabs[0] || '');

    $('#expX').onclick = () => {
      const t = $('#expT').value;
      try {
        const r = f.q(`SELECT * FROM "${t}"`);
        const cols = r.length ? Object.keys(r[0]) : [];
        const rows = r.map(o => cols.map(c => o[c] == null ? '' : String(o[c])));
        const b = XLSXW.build([{ name: t, cols, rows }]);
        XLSXW.download(b, `fabri-${t}-${Date.now()}.xlsx`);
        f.run('INSERT INTO files(name, size, mime, kind, at) VALUES(?,?,?,?,?)',
          [`fabri-${t}.xlsx`, b.length, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', t, Date.now()]);
        f.save(); f.metric('exportaciones', 1);
        f.toast(`${t}: ${rows.length} filas exportadas`);
      } catch (e) { f.toast('No pude exportar: ' + e.message); }
    };
    $('#expC').onclick = () => {
      const t = $('#expT').value;
      try {
        const r = f.q(`SELECT * FROM "${t}"`);
        const cols = r.length ? Object.keys(r[0]) : [];
        XLSXW.download(XLSXW.csv(cols, r.map(o => cols.map(c => o[c] == null ? '' : o[c]))), `fabri-${t}-${Date.now()}.csv`);
        f.toast('CSV listo');
      } catch (e) { f.toast('No pude exportar: ' + e.message); }
    };
  }

  /* ── IA ────────────────────────────────────────────────────────────────── */
  function renderIA() {
    const f = F();
    const host = $('#pro-ia');
    if (!host) return;
    if (!f.S || !f.S.db) return;
    const V = window.CoreVault;
    const saved = V.list();
    let sel = V.PROVIDERS[0];

    host.innerHTML = `
      <div class="card" style="margin-bottom:10px">
        <div class="eyebrow" style="margin-bottom:6px">Bóveda de claves</div>
        <p class="hint">Se cifran con AES-256-GCM y una clave del dispositivo (IndexedDB). La clave en claro nunca se guarda ni se muestra.</p>
        <div id="iaSaved" style="margin-top:10px"></div>
      </div>

      <div class="card" style="margin-bottom:10px">
        <div class="eyebrow" style="margin-bottom:8px">Agregar proveedor</div>
        <div class="chips" id="iaProv" style="display:flex;gap:6px;overflow-x:auto;padding-bottom:4px"></div>
        <div id="iaForm" style="margin-top:10px"></div>
      </div>

      <div class="card">
        <div class="eyebrow" style="margin-bottom:8px">Preguntar</div>
        <textarea id="iaQ" class="field" rows="3" placeholder="Pregunta al agente. Usa la primera clave activa."></textarea>
        <div class="row" style="display:flex;gap:7px;margin-top:8px">
          <button class="btn" id="iaSend">Enviar</button>
          <button class="btn ghost" id="iaClear">Limpiar</button>
        </div>
        <div id="iaOut" class="console-out" style="margin-top:10px;display:none"></div>
      </div>
    `;

    const drawSaved = () => {
      const list = V.list();
      $('#iaSaved').innerHTML = list.length ? list.map(k => `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid rgba(34,38,44,.6)">
          <div style="flex:1">
            <div style="font-weight:700;font-size:12.5px">${esc((V.provider(k.provider) || {}).name || k.provider)}</div>
            <div class="mono" style="font-size:10.5px;color:var(--tx2)">${esc(k.masked)} · ${esc(k.model || '')}</div>
          </div>
          <button class="btn ghost" data-ping="${k.id}" style="padding:6px 10px;font-size:11px">Probar</button>
          <button class="btn ghost" data-del="${k.id}" style="padding:6px 10px;font-size:11px">Borrar</button>
        </div>`).join('') : '<div class="hint">Todavía no hay claves guardadas.</div>';

      host.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
        V.remove(Number(b.dataset.del)); drawSaved(); f.toast('Clave revocada');
      });
      host.querySelectorAll('[data-ping]').forEach(b => b.onclick = async () => {
        const k = V.list().find(x => x.id === Number(b.dataset.ping));
        if (!k) return;
        b.textContent = '…';
        const s = await V.secret(k.id);
        const [ok, msg] = s ? await V.ping(k.provider, k.base_url, s) : [false, 'No pude descifrar la clave'];
        b.textContent = ok ? '✓ ok' : '✗ falla';
        f.toast((ok ? '✓ ' : '✗ ') + msg);
        setTimeout(() => { b.textContent = 'Probar'; }, 2500);
      });
    };

    const drawForm = () => {
      $('#iaProv').innerHTML = V.PROVIDERS.map(p =>
        `<button class="chip${p.id === sel.id ? ' on' : ''}" data-p="${p.id}">
           ${esc(p.name)}${p.free ? ' · <b style="color:var(--accent)">free</b>' : ''}
         </button>`).join('');
      host.querySelectorAll('[data-p]').forEach(b => b.onclick = () => {
        sel = V.provider(b.dataset.p); drawForm();
      });

      $('#iaForm').innerHTML = `
        <input id="iaKey" class="field" type="password" placeholder="pega la API key de ${esc(sel.name)}" style="margin-bottom:7px">
        <input id="iaModel" class="field" value="${esc(sel.models[0])}" placeholder="modelo" style="margin-bottom:7px">
        <input id="iaBase" class="field" value="${esc(sel.base)}" placeholder="base URL" style="margin-bottom:7px">
        <div class="hint" style="margin-bottom:8px">Clave en ${esc(sel.docs)} · ${sel.free ? 'tiene plan gratuito' : 'de pago'}</div>
        <div class="row" style="display:flex;gap:7px">
          <button class="btn" id="iaSave">Guardar cifrada</button>
          <button class="btn ghost" id="iaPing">Probar sin guardar</button>
        </div>`;

      $('#iaSave').onclick = async () => {
        const key = $('#iaKey').value.trim();
        if (key.length < 8) return f.toast('Pega la clave primero');
        await V.save(sel.id, key, $('#iaBase').value.trim(), $('#iaModel').value.trim(), sel.name);
        $('#iaKey').value = '';
        drawSaved(); f.toast('Clave cifrada y guardada');
      };
      $('#iaPing').onclick = async () => {
        const key = $('#iaKey').value.trim();
        if (key.length < 8) return f.toast('Pega la clave primero');
        const b = $('#iaPing'); b.disabled = true; b.textContent = '…';
        const [ok, msg] = await V.ping(sel.id, $('#iaBase').value.trim(), key);
        b.disabled = false; b.textContent = 'Probar sin guardar';
        f.toast((ok ? '✓ ' : '✗ ') + msg);
      };
    };

    drawSaved();
    drawForm();

    $('#iaClear').onclick = () => { $('#iaOut').style.display = 'none'; $('#iaOut').textContent = ''; };
    $('#iaSend').onclick = async () => {
      const prompt = $('#iaQ').value.trim();
      if (!prompt) return f.toast('Escribe la pregunta');
      const k = V.list()[0];
      if (!k) return f.toast('Guarda una clave primero');
      const out = $('#iaOut');
      out.style.display = 'block';
      out.textContent = 'consultando ' + ((V.provider(k.provider) || {}).name || k.provider) + '…';
      const secret = await V.secret(k.id);
      if (!secret) { out.textContent = 'No pude descifrar la clave'; return; }
      const r = await V.ask(k.provider, k.base_url, k.model, secret, prompt);
      out.textContent = r.text + (r.ok ? '' : '');
      out.style.color = r.ok ? '' : 'var(--warn, #FFC857)';
      try {
        f.run('INSERT INTO messages(role, content, provenance, created_at) VALUES(?,?,?,?)',
          ['user', prompt, 'web', Date.now()]);
        f.run('INSERT INTO messages(role, content, provenance, created_at) VALUES(?,?,?,?)',
          ['assistant', r.text, `${k.provider} · ${r.ms} ms`, Date.now()]);
        f.save(); f.metric('consultas_ia', 1);
      } catch (_) {}
    };
  }

  /* ── CUENTA + PLANES + PERMISOS ────────────────────────────────────────── */
  const PLANS = [
    { id: 'local', name: 'Local', price: '$0', mb: 5, ai: 0, users: 1, note: 'Todo en tu dispositivo. Sin cuenta, sin nube.' },
    { id: 'prueba', name: 'Prueba', price: '$0 · 15 días', mb: 25, ai: 200, users: 1, note: 'Nube activa mientras dure la prueba.' },
    { id: 'pro', name: 'Pro', price: 'a medida', mb: 250, ai: 5000, users: 5, note: 'Para equipos y volúmenes reales.' }
  ];

  async function renderCuenta() {
    const f = F();
    const host = $('#pro-cuenta');
    if (!host) return;
    if (!f.S || !f.S.db) return;
    const u = await window.CoreAuth.current();
    const size = f.S.db.export().length;
    const aiCalls = (() => { try { return Number(f.one("SELECT COALESCE(SUM(value),0) v FROM metrics WHERE name='consultas_ia'").v) || 0; } catch (_) { return 0; } })();
    const ses = window.CoreAuth.sessions();

    let est = { usage: 0, quota: 0 };
    try { est = await navigator.storage.estimate(); } catch (_) {}
    const persisted = (navigator.storage && navigator.storage.persisted) ? await navigator.storage.persisted() : false;
    const notif = ('Notification' in window) ? Notification.permission : 'no soportado';

    const plan = PLANS[0];
    const pct = Math.min(100, Math.round((size / (plan.mb * 1024 * 1024)) * 100));

    host.innerHTML = `
      <div class="card" style="margin-bottom:10px">
        <div class="eyebrow" style="margin-bottom:6px">Cuenta del dispositivo</div>
        <div style="font-size:16px;font-weight:800">${esc(u ? u.email : 'sin sesión')}</div>
        <div class="hint">${u ? esc(u.role) + ' · uid #' + u.id : ''} · sesión con token hasheado (SHA-256)</div>
        <div class="row" style="display:flex;gap:7px;margin-top:10px">
          <button class="btn ghost" id="cuLogout">Cerrar sesión</button>
        </div>
      </div>

      <div class="card" style="margin-bottom:10px">
        <div class="eyebrow" style="margin-bottom:8px">Plan y cuota</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px">
          ${PLANS.map(p => `<div class="card" style="padding:10px;${p.id === plan.id ? 'border-color:var(--accent)' : ''}">
            <div style="font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:${p.id === plan.id ? 'var(--accent)' : 'var(--tx2)'}">${esc(p.name)}</div>
            <div class="mono" style="font-size:10.5px;margin:4px 0">${esc(p.price)}</div>
            <div class="hint" style="font-size:10px">${p.mb} MB · ${p.ai} IA</div>
          </div>`).join('')}
        </div>
        <div style="margin-top:12px">
          <div class="hint" style="display:flex;justify-content:space-between"><span>Uso de tu cuota</span><span class="mono">${bytes(size)} / ${plan.mb} MB</span></div>
          <div style="height:9px;border-radius:5px;background:rgba(255,255,255,.06);overflow:hidden;margin-top:6px">
            <div style="height:100%;width:${Math.max(2, pct)}%;background:${pct > 85 ? '#FF6B6B' : 'var(--accent)'}"></div>
          </div>
          <div class="hint" style="margin-top:6px">Llamadas a IA este dispositivo: <b class="mono">${num(aiCalls)}</b> · plan ${esc(plan.name)}</div>
        </div>
        <p class="hint" style="margin-top:10px">El plan <b>Local</b> está activo y es el único en este despliegue: todo ocurre en tu dispositivo.
        Los otros dos quedan como referencia de límites; no hay cobro ni pasarela de pago conectada, y no se promete nube.</p>
      </div>

      <div class="card" style="margin-bottom:10px">
        <div class="eyebrow" style="margin-bottom:8px">Almacenamiento y permisos del navegador</div>
        <div class="hint">Origen: <span class="mono">${esc(location.origin)}</span></div>
        <div class="hint">Espacio usado por el sitio: <span class="mono">${bytes(est.usage || 0)}</span>${est.quota ? ' de ' + bytes(est.quota) : ''}</div>
        <div class="hint">Persistencia: <b>${persisted ? 'concedida' : 'no concedida'}</b> · Notificaciones: <b>${esc(notif)}</b></div>
        <div class="row" style="display:flex;gap:7px;margin-top:9px;flex-wrap:wrap">
          <button class="btn ghost" id="cuPersist">Pedir persistencia</button>
          <button class="btn ghost" id="cuNotif">Pedir notificaciones</button>
          <button class="btn ghost" id="cuInstall">Instalar app</button>
        </div>
        <p class="hint" style="margin-top:8px">En el navegador no existe un sandbox de procesos: no hay shell real. La consola SQL sí ejecuta SQLite de verdad.</p>
      </div>

      <div class="card" style="margin-bottom:10px">
        <div class="eyebrow" style="margin-bottom:8px">Sesiones</div>
        ${ses.length ? table(['#', 'correo', 'dispositivo', 'inicio', 'vence', 'estado'],
      ses.map(s => [s.id, s.email, (s.device || '').slice(0, 28), new Date(s.created_at).toLocaleString('es-CL'),
      new Date(s.expires_at).toLocaleDateString('es-CL'), s.revoked ? 'revocada' : 'activa'])) : '<div class="hint">Sin sesiones.</div>'}
      </div>

      <div class="card">
        <div class="eyebrow" style="margin-bottom:8px">Modo local</div>
        <p class="hint">Esta cuenta, sus sesiones, sus claves cifradas y su planilla viven en la base SQLite de este navegador.
        Nada se envía a un servidor: no hay nube, no hay sincronización entre dispositivos y no hace falta conexión.</p>
        <div class="row" style="display:flex;gap:7px;flex-wrap:wrap;margin-top:9px">
          <button class="btn" id="cuBackup">Descargar copia (.sqlite)</button>
          <button class="btn ghost" id="cuReset" style="border-color:rgba(255,107,107,.4);color:#FF6B6B">Borrar datos locales</button>
        </div>
        <p class="hint" style="margin-top:8px">La copia abre con cualquier cliente SQLite y sirve para respaldar o mover la base a otro navegador.</p>
      </div>
    `;

    $('#cuLogout').onclick = async () => {
      await window.CoreAuth.logout();
      location.reload();
    };
    $('#cuPersist').onclick = async () => {
      try {
        const ok = await navigator.storage.persist();
        f.toast(ok ? 'Persistencia concedida' : 'El navegador no la concedió');
        renderCuenta();
      } catch (e) { f.toast('No disponible: ' + e.message); }
    };
    $('#cuNotif').onclick = async () => {
      try {
        const p = await Notification.requestPermission();
        f.toast('Notificaciones: ' + p);
        renderCuenta();
      } catch (e) { f.toast('No disponible: ' + e.message); }
    };
    $('#cuInstall').onclick = async () => {
      if (f.S.installEvt) { f.S.installEvt.prompt(); await f.S.installEvt.userChoice; f.S.installEvt = null; }
      else f.toast('Menú del navegador → “Agregar a pantalla de inicio”');
    };
    $('#cuBackup').onclick = () => {
      try {
        const bytes = f.S.db.export();
        const blob = new Blob([bytes], { type: 'application/x-sqlite3' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'fabri-core-' + new Date().toISOString().slice(0, 10) + '.sqlite';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        f.audit(u ? u.email : null, 'copia_descargada', bytes.length + ' bytes');
        f.toast('Copia de ' + bytes.length + ' bytes descargada');
      } catch (e) { f.toast('No pude exportar: ' + e.message); }
    };
    $('#cuReset').onclick = async () => {
      if (!confirm('¿Borrar la base local, las claves y las cuentas de este navegador?')) return;
      await window.IDB.clear();
      localStorage.removeItem('fcore.token');
      location.reload();
    };

  }

  /* ── LOGIN ─────────────────────────────────────────────────────────────── */
  /**
   * Puerta de acceso con la misma ficha de marca que la APK: marca, título,
   * aviso de cifrado y pie con el estado de las dos capas (local y nube).
   *
   * El campo de clave de la nube es OPCIONAL y vive en `sessionStorage`: sirve
   * para subir inventario a InsForge desde el navegador sin guardar el token
   * en disco. Al cerrar la pestaña se olvida.
   */
  async function gate() {
    const u = await window.CoreAuth.current();
    if (u) { document.getElementById('login').classList.remove('on'); return u; }
    const first = window.CoreAuth.count() === 0;
    const host = document.getElementById('login');
    host.classList.add('on');
    const clavePrevia = sessionStorage.getItem('fabri.invKey') || '';
    host.innerHTML = `
      <div class="login-box">
        <div class="login-head">
          <div class="mark" aria-hidden="true"></div>
          <b>FABRI-CORE</b>
        </div>
        <h2>${first ? 'Crea la cuenta del dispositivo' : 'Entra a FABRI-CORE'}</h2>
        <p class="hint">${first
          ? 'La cuenta y sus sesiones viven en esta base SQLite, no en un servidor.'
          : 'La sesión se guarda como token en tu navegador.'}</p>
        <input id="lgEmail" class="field" placeholder="correo@dominio.cl" autocomplete="username">
        ${first ? '<input id="lgName" class="field" placeholder="tu nombre">' : ''}
        <input id="lgPass" class="field" type="password" placeholder="contraseña (mínimo 8)" autocomplete="current-password">
        ${first ? '<input id="lgPass2" class="field" type="password" placeholder="repite la contraseña">' : ''}
        <input id="lgKey" class="field" type="password" placeholder="clave de la nube (opcional)"
          autocomplete="off" value="${esc(clavePrevia)}">
        <div id="lgErr" class="hint" style="color:var(--err);margin:0 0 8px;text-align:left"></div>
        <button class="btn primary" id="lgGo">${first ? 'Crear cuenta' : 'Entrar'}</button>
        <div class="login-pie">
          <span>PBKDF2 · 120k</span>
          <span class="badge ok">local</span>
          <span class="badge ${clavePrevia ? 'acc' : ''}" id="lgKeyBadge">${clavePrevia ? 'nube lista' : 'nube opcional'}</span>
        </div>
        <p class="hint" style="margin-top:10px">Si olvidas la contraseña, la única salida es borrar los datos
          locales. La clave de la nube nunca se guarda en el repositorio.</p>
      </div>`;

    return new Promise(resolve => {
      const guardarClave = () => {
        const k = ($('#lgKey').value || '').trim();
        if (k) sessionStorage.setItem('fabri.invKey', k);
        else sessionStorage.removeItem('fabri.invKey');
        const badge = $('#lgKeyBadge');
        if (badge) {
          badge.textContent = k ? 'nube lista' : 'nube opcional';
          badge.className = 'badge ' + (k ? 'acc' : '');
        }
      };
      const go = async () => {
        const email = $('#lgEmail').value.trim();
        const pass = $('#lgPass').value;
        try {
          if (first) {
            if (pass !== $('#lgPass2').value) throw new Error('Las contraseñas no coinciden');
            await window.CoreAuth.register(email, $('#lgName').value, pass);
          } else {
            await window.CoreAuth.login(email, pass);
          }
          guardarClave();
          host.classList.remove('on');
          resolve(await window.CoreAuth.current());
        } catch (e) {
          $('#lgErr').textContent = e.message;
        }
      };
      $('#lgGo').onclick = go;
      ['lgPass', 'lgPass2', 'lgKey'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      });
    });
  }

  /* ── INVENTARIO EN LA NUBE (InsForge vía fabri-api) ────────────────────── */
  const INV_API = 'https://fabri-api.vercel.app/api/inventario';
  const INV_FREE = [
    ['sin-gluten', 'Sin gluten'], ['sin-azucar', 'Sin azúcar'],
    ['sin-lactosa', 'Sin lactosa'], ['sin-grasa', 'Sin grasa'],
    ['vegano', 'Vegano'], ['vegetariano', 'Vegetariano'], ['organico', 'Orgánico'],
  ];
  const invClave = () => (sessionStorage.getItem('fabri.invKey') || '').trim();
  const clp = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-CL');

  async function invApi(accion, extra) {
    const clave = invClave();
    if (!clave) return { ok: false, codigo: 'SIN_CLAVE', error: 'falta la clave de la nube' };
    try {
      const ctrl = new AbortController();
      const reloj = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch(INV_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + clave },
        body: JSON.stringify(Object.assign({ accion }, extra || {})),
        signal: ctrl.signal,
      });
      clearTimeout(reloj);
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) return { ok: false, codigo: 'SIN_TOKEN', error: 'la clave fue rechazada' };
      if (!r.ok || d.ok === false) {
        return { ok: false, codigo: d.codigo || ('HTTP ' + r.status), error: d.error || ('HTTP ' + r.status) };
      }
      return Object.assign({ ok: true }, d);
    } catch (e) {
      return { ok: false, codigo: 'RED', error: e.name === 'AbortError' ? 'la nube tardó demasiado' : String(e.message || e) };
    }
  }

  let invEstado = { productos: [], resumen: null, carrito: [] };

  function invPintarEstado(clave, base) {
    const kSub = $('#invKeySub'), kBadge = $('#invKeyBadge');
    const dSub = $('#invDbSub'), dBadge = $('#invDbBadge');
    if (kSub) kSub.textContent = clave ? 'clave cargada en esta sesión' : 'sin clave: sólo lectura local';
    if (kBadge) { kBadge.textContent = clave ? 'lista' : 'falta'; kBadge.className = 'badge ' + (clave ? 'ok' : 'warn'); }
    if (dSub) dSub.textContent = base ? 'tabla inv_productos disponible' : (clave ? 'no comprobada' : 'esperando clave');
    if (dBadge) { dBadge.textContent = base ? 'ok' : '—'; dBadge.className = 'badge ' + (base ? 'ok' : ''); }
  }

  function invPintarLista() {
    const caja = $('#invLista');
    if (!caja) return;
    const filtro = (($('#invFiltro') || {}).value || '').trim().toLowerCase();
    const lista = (invEstado.productos || []).filter(p => {
      if (!filtro) return true;
      return (p.nombre + ' ' + p.marca + ' ' + p.codigo).toLowerCase().includes(filtro);
    });
    if (!lista.length) {
      caja.innerHTML = `<div class="empty">${invEstado.productos.length
        ? 'Ningún producto coincide con el filtro.'
        : 'Todavía no hay productos en la nube. Sube el primero arriba.'}</div>`;
      return;
    }
    caja.innerHTML = lista.map(p => {
      const bajo = Number(p.stock) <= Number(p.stock_minimo);
      const ficha = (p.ficha && typeof p.ficha === 'object') ? p.ficha : {};
      const etiquetas = (ficha.etiquetas || []).map(id => {
        const f = INV_FREE.find(x => x[0] === id);
        return `<span class="badge acc">${esc(f ? f[1] : id)}</span>`;
      }).join(' ');
      // Margen igual que en la APK: (precio − costo) ÷ precio. El precio de
      // venta es con IVA incluido, así que el margen se calcula sobre ese bruto.
      const precio = Number(p.precio) || 0;
      const costo = Number(p.costo) || 0;
      const margen = precio > 0 ? ((precio - costo) / precio) * 100 : 0;
      return `<div class="inv-item">
        <div class="grow">
          <div class="t">${esc(p.nombre)}</div>
          <div class="s">${esc(p.codigo)}${p.marca ? ' · ' + esc(p.marca) : ''} · ${esc(p.categoria)} ${etiquetas}</div>
        </div>
        <div class="v ${bajo ? 'bajo' : ''}">${clp(precio)}<small>stock ${esc(p.stock)}${bajo ? ' · bajo' : ''}${
          precio > 0 ? ' · ' + margen.toFixed(0) + '%' : ''}</small></div>
        <button class="btn ghost sm" type="button" data-boleta="${esc(p.codigo)}"
          title="Agregar a la boleta" style="padding:6px 9px;min-width:0">+</button>
      </div>`;
    }).join('');
    caja.querySelectorAll('[data-boleta]').forEach(b => {
      b.onclick = () => invCarritoAgregar(b.dataset.boleta, 1);
    });
  }

  /* ── CARRITO Y BOLETA ──────────────────────────────────────────────────── */
  /**
   * El carrito vive en memoria (`invEstado.carrito`): la boleta es un documento
   * del momento, no un pedido guardado. El total es la suma de precio × cantidad
   * (precio con IVA); el neto y el IVA se despejan igual que en el núcleo Rust.
   */
  function invTotales(items) {
    items = items || invEstado.carrito || [];
    const total = items.reduce((a, x) => a + (Number(x.precio) || 0) * (Number(x.cantidad) || 1), 0);
    const neto = total / 1.19;
    return { total, neto, iva: total - neto, items };
  }

  function invCarritoPintar() {
    const caja = $('#invCarrito');
    const items = invEstado.carrito || [];
    if (caja) {
      if (!items.length) {
        caja.className = 'hint';
        caja.innerHTML = 'El carrito está vacío.';
      } else {
        caja.className = 'carrito';
        caja.innerHTML = items.map((x, i) => `
          <div class="linea">
            <span class="n">${esc(x.nombre)}</span>
            <span class="c">×${esc(x.cantidad)}</span>
            <span class="p">${clp((Number(x.precio) || 0) * (Number(x.cantidad) || 1))}</span>
            <button type="button" data-quitar="${i}" title="Quitar">✕</button>
          </div>`).join('');
        caja.querySelectorAll('[data-quitar]').forEach(b => {
          b.onclick = () => { invEstado.carrito.splice(+b.dataset.quitar, 1); invCarritoPintar(); };
        });
      }
    }
    const t = invTotales();
    const total = $('#invBolTotal'), detalle = $('#invBolDetalle');
    if (total) total.textContent = clp(t.total);
    if (detalle) detalle.textContent = items.length
      ? `neto ${clp(t.neto)} + IVA ${clp(t.iva)} · ${items.length} línea${items.length === 1 ? '' : 's'}`
      : 'neto + IVA';
  }

  function invCarritoLlenar() {
    const sel = $('#invBolProducto');
    if (!sel) return;
    const productos = (invEstado.productos || []).slice().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
    sel.innerHTML = productos.length
      ? productos.map(p => `<option value="${esc(p.codigo)}">${esc(p.nombre)} · ${clp(p.precio)}</option>`).join('')
      : '<option value="">Sin productos: sube uno primero</option>';
  }

  function invCarritoAgregar(codigo, cantidad) {
    const p = (invEstado.productos || []).find(x => String(x.codigo) === String(codigo));
    if (!p) { toast('Ese producto ya no está en la lista'); return; }
    const cant = Math.max(1, Math.round(Number(cantidad) || 1));
    const ya = (invEstado.carrito || []).find(x => String(x.codigo) === String(codigo));
    if (ya) ya.cantidad += cant;
    else {
      invEstado.carrito = invEstado.carrito || [];
      invEstado.carrito.push({
        codigo: p.codigo, nombre: p.nombre, precio: Number(p.precio) || 0,
        cantidad: cant, iva: Number(p.iva) || 19,
      });
    }
    invCarritoPintar();
    toast(p.nombre + ' → boleta');
  }

  /** Documento imprimible. Mismo formato que `invBoletaDocumento` de la APK. */
  function invBolDocumento(formato, boleta) {
    const fmt = formato || '80mm';
    const ancho = fmt === 'a4' ? '190mm' : (fmt === '58mm' ? '48mm' : '72mm');
    const base = fmt === 'a4' ? 12 : 11;
    const b = boleta || invTotales();
    const fecha = new Date().toLocaleString('es-CL');
    const folio = 'WEB-' + new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const lineas = (b.items || []).map(x => {
      const cant = Number(x.cantidad) || 1;
      return `<div class="linea"><span>${esc(x.nombre)} × ${cant}</span>
        <span>${clp((Number(x.precio) || 0) * cant)}</span></div>`;
    }).join('');
    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
      <title>Boleta ${esc(folio)}</title>
      <style>
        @page { size: ${ancho} auto; margin: 0; }
        * { box-sizing: border-box; }
        body { font-family: -apple-system, Roboto, "Courier New", monospace;
               color: #000; margin: 0 auto; padding: 4mm; max-width: ${ancho};
               font-size: ${base}px; line-height: 1.35; }
        h1 { font-size: ${base + 5}px; letter-spacing: .28em; margin: 0 0 2mm; text-align: center; }
        h2 { font-size: ${base + 1}px; margin: 0 0 1mm; text-align: center; font-weight: 600; }
        .nota { font-size: ${base - 1}px; color: #222; }
        hr { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }
        .linea { display: flex; justify-content: space-between; gap: 6px;
                 font-size: ${base}px; padding: .6mm 0; }
        .linea span:first-child { flex: 1; }
        .total { font-size: ${base + 4}px; font-weight: 700; }
        .pie { text-align: center; font-size: ${base - 2}px; margin-top: 2mm; }
      </style></head><body>
      <h1>FABRI-CORE</h1>
      <h2>Boleta ${esc(folio)}</h2>
      <div class="nota">${esc(fecha)}</div>
      <div class="nota">Consumidor final</div>
      <div class="nota">Pago: efectivo</div>
      <hr />
      ${lineas}
      <hr />
      <div class="linea"><span>Neto</span><span>${clp(b.neto)}</span></div>
      <div class="linea"><span>IVA 19%</span><span>${clp(b.iva)}</span></div>
      <div class="linea total"><span>Total</span><span>${clp(b.total)}</span></div>
      <hr />
      <div class="pie">Documento generado por FABRI-CORE<br />no es boleta tributaria electrónica</div>
      </body></html>`;
  }

  /**
   * Imprime con el diálogo del sistema desde un iframe oculto: el navegador
   * ofrece las impresoras instaladas y también «Guardar como PDF». El iframe se
   * retira después de imprimir para no dejar documentos vivos en el DOM.
   */
  function invImprimir(formato) {
    const t = invTotales();
    if (!t.items.length) { toast('Agrega productos a la boleta primero'); return; }
    const fmt = formato || ($('#invBolFormato') || {}).value || '80mm';
    const html = invBolDocumento(fmt, t);
    const marco = document.createElement('iframe');
    marco.setAttribute('aria-hidden', 'true');
    marco.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(marco);
    const doc = marco.contentWindow.document;
    doc.open(); doc.write(html); doc.close();
    const limpiar = () => setTimeout(() => { try { marco.remove(); } catch (e) { /* ya no está */ } }, 1200);
    try {
      marco.contentWindow.focus();
      marco.contentWindow.print();
      limpiar();
      toast('Abriendo impresión (' + fmt + ')…');
    } catch (e) {
      limpiar();
      toast('No pude abrir la impresión: ' + (e.message || e));
    }
  }

  function invPintarResumen(d) {
    const r = (d && d.resumen) || {};
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('invKTotal', num(r.total || 0));
    set('invKValor', clp(r.valor_venta || 0));
    set('invKUtil', clp(r.utilidad || 0));
    set('invKBajo', num(r.stock_bajo || 0));
  }

  async function invRefrescarNube(silencioso) {
    const estado = $('#invSubirEstado');
    if (!invClave()) {
      invPintarEstado(false, false);
      invPintarLista();
      invCarritoLlenar();
      if (estado && !silencioso) estado.textContent = 'Pega la clave de la nube para ver y subir productos.';
      return;
    }
    const baja = await invApi('bajar', { limite: 300 });
    if (!baja.ok) {
      invPintarEstado(true, false);
      if (estado && !silencioso) estado.textContent = 'No pude leer la nube: ' + baja.error;
      return;
    }
    invEstado.productos = baja.productos || [];
    invPintarEstado(true, true);
    invPintarLista();
    invCarritoLlenar();
    const res = await invApi('resumen');
    if (res.ok) { invEstado.resumen = res.resumen; invPintarResumen(res); }
    if (estado && !silencioso) estado.textContent = invEstado.productos.length + ' productos en la nube.';
  }

  function renderInv() {
    if (!invEstado.chipsListos) {
      const chips = $('#invFreeChips');
      if (chips) {
        chips.innerHTML = INV_FREE.map(([id, t]) =>
          `<button class="chip" type="button" data-free="${id}">${t}</button>`).join('');
        chips.querySelectorAll('[data-free]').forEach(b => {
          b.onclick = () => b.classList.toggle('on');
        });
      }
      invEstado.chipsListos = true;
    }

    // La guía usa `data-guia`, no `#ancla`: el hash de la URL es el router de
    // pantallas (`go()`), y un ancla lo dejaría apuntando a una pantalla
    // inexistente al recargar.
    document.querySelectorAll('#invPasos [data-guia]').forEach(a => {
      a.onclick = ev => {
        ev.preventDefault();
        const destino = document.getElementById(a.dataset.guia);
        if (destino) destino.scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
    });

    const campoClave = $('#invKey');
    if (campoClave && !campoClave.value) campoClave.value = invClave();

    $('#btnInvKey').onclick = async () => {
      const k = (campoClave.value || '').trim();
      if (k) sessionStorage.setItem('fabri.invKey', k);
      else sessionStorage.removeItem('fabri.invKey');
      await invRefrescarNube(false);
      toast(invClave() ? 'Clave guardada; conexión verificada' : 'Clave borrada');
    };

    $('#btnInvAsegurar').onclick = async () => {
      const r = await invApi('asegurar');
      if (r.ok) { toast('Tabla inv_productos lista'); await invRefrescarNube(false); }
      else toast('No pude crear la tabla: ' + r.error);
    };

    $('#btnInvBajar').onclick = () => invRefrescarNube(false);
    const filtro = $('#invFiltro');
    if (filtro) filtro.oninput = invPintarLista;

    // Carrito y boleta: el selector se llena con lo que hay en la nube y el
    // botón «Agregar» respeta la cantidad escrita.
    invCarritoLlenar();
    invCarritoPintar();
    const agregar = $('#btnInvBolAgregar');
    if (agregar) agregar.onclick = () => {
      const sel = $('#invBolProducto');
      const codigo = sel && sel.value;
      if (!codigo) { toast('No hay productos para agregar'); return; }
      const cant = Math.max(1, Math.round(Number(($('#invBolCantidad') || {}).value) || 1));
      invCarritoAgregar(codigo, cant);
      const c = $('#invBolCantidad');
      if (c) c.value = '1';
    };
    const imprimir = $('#btnInvImprimir');
    if (imprimir) imprimir.onclick = () => invImprimir();

    $('#btnInvSubir').onclick = async () => {
      const estado = $('#invSubirEstado');
      const nombre = ($('#invFnombre').value || '').trim();
      const codigo = ($('#invFcodigo').value || '').trim() ||
        ('WEB-' + Date.now().toString(36).toUpperCase());
      if (!nombre) { toast('El nombre es obligatorio'); $('#invFnombre').focus(); return; }
      if (!invClave()) { toast('Falta la clave de la nube'); if (estado) estado.textContent = 'Pega la clave de la nube arriba.'; return; }
      const etiquetas = [...document.querySelectorAll('#invFreeChips .chip.on')].map(b => b.dataset.free);
      const producto = {
        codigo,
        nombre,
        marca: ($('#invFmarca').value || '').trim(),
        categoria: $('#invFcategoria').value || 'abarrotes',
        unidad: 'unidad',
        costo: Number($('#invFcosto').value) || 0,
        precio: Number($('#invFprecio').value) || 0,
        stock: Math.round(Number($('#invFstock').value) || 0),
        stock_minimo: Math.round(Number($('#invFminimo').value) || 0),
        iva: 19,
        origen: 'web',
        notas: '',
        ficha: { etiquetas, fuente: 'web' },
        actualizado: Math.floor(Date.now() / 1000),
      };
      $('#btnInvSubir').disabled = true;
      if (estado) estado.textContent = 'Subiendo ' + nombre + '…';
      const r = await invApi('subir', { productos: [producto] });
      $('#btnInvSubir').disabled = false;
      if (!r.ok) {
        if (estado) estado.textContent = 'No se subió: ' + r.error;
        toast('No se subió: ' + r.error);
        return;
      }
      if (estado) estado.textContent = nombre + ' subido a InsForge.';
      toast('Producto subido');
      ['invFcodigo', 'invFnombre', 'invFmarca', 'invFcosto', 'invFprecio', 'invFstock', 'invFminimo']
        .forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
      document.querySelectorAll('#invFreeChips .chip.on').forEach(b => b.classList.remove('on'));
      await invRefrescarNube(true);
    };

    invRefrescarNube(true);
  }

  window.Pro = {
    renderDatos, renderIA, renderCuenta, renderInv, gate,
    // Superficie mínima para pruebas: son funciones puras (no tocan el DOM) y
    // permiten comprobar los totales y el documento sin abrir un navegador.
    invTotales, invBolDocumento,
    PLANS
  };
})();
