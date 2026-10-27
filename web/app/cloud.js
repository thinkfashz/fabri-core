/* ============================================================================
   FABRI-CORE · nube · capa de interfaz
   ----------------------------------------------------------------------------
   Todo lo que la APK no puede permitirse y aquí sí:
     · gráficos d3 con datos REALES de la SQLite del navegador;
     · paleta de comandos (⌘K / Ctrl+K);
     · hoja «más» para la barra inferior;
     · contadores que suben, reloj, migas de pan y un hito de instalación.

   Regla: esta capa NO reemplaza funciones de app.js ni de los módulos. Trabaja
   contra la superficie pública `window.Fabri` (q/one/run/S) y contra el DOM ya
   existente. Si algo falta, se queda quieta y no rompe el arranque.
   ========================================================================== */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const F = () => window.Fabri || null;

  /* ══════════════════════════════════════════════════════════════════════
     1 · GRÁFICOS · d3-mini (window.d3s), datos de la base real
     ══════════════════════════════════════════════════════════════════════ */
  const NS = 'http://www.w3.org/2000/svg';

  function tonos() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n, alt) => (cs.getPropertyValue(n).trim() || alt);
    return {
      acento: v('--accent', '#8c8cff'),
      aqua: v('--accent-2', '#3fe0c9'),
      lima: v('--lime', '#c8f542'),
      warn: v('--warn', '#ffc24b'),
      info: v('--info', '#5aa9ff'),
      err: v('--err', '#ff7a8a'),
      tenue: v('--tx4', '#59617a'),
      linea: v('rgba(255,255,255,.1)', 'rgba(255,255,255,.1)')
    };
  }

  function lienzo(host, alto) {
    const ancho = Math.max(220, Math.round(host.clientWidth || host.parentElement.clientWidth || 320));
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + ancho + ' ' + alto);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('role', 'img');
    host.textContent = '';
    host.appendChild(svg);
    return { svg, ancho, alto };
  }

  const el = (nombre, attrs = {}) => {
    const n = document.createElementNS(NS, nombre);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };

  function sinDatos(host, texto, alto) {
    const { svg, ancho } = lienzo(host, alto);
    const t = tonos();
    svg.appendChild(el('circle', {
      cx: ancho / 2, cy: alto / 2, r: 30, fill: 'none',
      stroke: t.linea, 'stroke-width': 1, 'stroke-dasharray': '3 6'
    }));
    const txt = el('text', {
      x: ancho / 2, y: alto / 2 + 4, 'text-anchor': 'middle',
      fill: t.tenue, 'font-size': 10.5, 'font-family': 'ui-monospace,monospace'
    });
    txt.textContent = texto;
    svg.appendChild(txt);
  }

  /* ── 1.1 · memoria por tipo (anillo) ─────────────────────────────────── */
  function pintarMemoria() {
    const fab = F();
    const host = document.getElementById('chartMemoria');
    if (!host || !fab || !fab.S || !fab.S.db) return;

    let filas = [];
    try {
      filas = fab.q('SELECT kind, COUNT(*) n FROM memory_items GROUP BY kind ORDER BY n DESC') || [];
    } catch (_) { filas = []; }

    const total = filas.reduce((a, r) => a + Number(r.n || 0), 0);
    const alto = Math.max(140, Math.round(host.clientHeight || 168));
    const fmt = n => Number(n).toLocaleString('es-CL');

    const titulo = document.getElementById('chartMemV');
    if (titulo) titulo.textContent = total
      ? fmt(total) + (total === 1 ? ' hecho' : ' hechos')
      : 'sin memorias';
    const badge = document.getElementById('chartMemB');
    if (badge) badge.textContent = (fab.S.ftsModo === 'like' ? 'LIKE' : (fab.S.ftsModo || 'FTS')).toUpperCase();

    const t = tonos();
    const colores = [t.acento, t.aqua, t.lima, t.warn, t.info, t.err];

    const leyenda = document.getElementById('chartMemLeyenda');
    if (leyenda) {
      leyenda.innerHTML = filas.map((r, i) =>
        '<span style="color:' + colores[i % colores.length] + '"><i></i>' +
        String(r.kind || 'otros') + ' · ' + fmt(r.n) + '</span>').join('');
    }

    if (!total) return sinDatos(host, 'sin memorias', alto);
    if (!window.d3s) return sinDatos(host, 'd3 no disponible', alto);

    const { svg, ancho } = lienzo(host, alto);
    const r1 = Math.min(ancho, alto) / 2 - 8;
    const r0 = r1 * 0.62;
    const cx = ancho / 2, cy = alto / 2;

    let arco;
    try {
      arco = window.d3s.arc().innerRadius(r0).outerRadius(r1).padAngle(0.014).cornerRadius(3);
    } catch (_) {
      arco = window.d3s.arc().innerRadius(r0).outerRadius(r1);
    }
    const pastel = window.d3s.pie().value(d => d.n).sort(null);
    const g = el('g', { transform: 'translate(' + cx + ',' + cy + ')' });

    pastel(filas).forEach((seg, i) => {
      const p = el('path', {
        d: arco(seg),
        fill: colores[i % colores.length],
        opacity: 0.92
      });
      g.appendChild(p);
    });
    svg.appendChild(g);

    const etiqueta = el('text', {
      x: cx, y: cy - 2, 'text-anchor': 'middle', fill: t.acento,
      'font-size': Math.round(r0 * 0.62), 'font-weight': 750,
      'font-family': 'ui-sans-serif,system-ui,sans-serif', 'letter-spacing': '-1'
    });
    etiqueta.textContent = fmt(total);
    svg.appendChild(etiqueta);

    const pie = el('text', {
      x: cx, y: cy + 15, 'text-anchor': 'middle', fill: t.tenue,
      'font-size': 9, 'letter-spacing': '1.6', 'font-family': 'ui-monospace,monospace'
    });
    pie.textContent = 'REGISTROS';
    svg.appendChild(pie);
  }

  /* ── 1.2 · tablas con filas (barras) ─────────────────────────────────── */
  function pintarTablas() {
    const fab = F();
    const host = document.getElementById('chartTablas');
    if (!host || !fab || !fab.S || !fab.S.db) return;

    let nombres = [];
    try {
      nombres = (fab.q("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name") || [])
        .map(r => r.name)
        .filter(n => n && !/^sqlite_/i.test(n) && !/fts/i.test(n));
    } catch (_) { nombres = []; }

    const filas = [];
    nombres.forEach(nombre => {
      try {
        const r = fab.one('SELECT COUNT(*) c FROM "' + String(nombre).replace(/"/g, '""') + '"');
        const c = Number(r && r.c) || 0;
        if (c > 0) filas.push({ nombre, c });
      } catch (_) { /* tabla virtual o cerrada: se ignora */ }
    });
    filas.sort((a, b) => b.c - a.c);
    const top = filas.slice(0, 7);
    const alto = Math.max(140, Math.round(host.clientHeight || 168));
    const fmt = n => Number(n).toLocaleString('es-CL');

    const titulo = document.getElementById('chartTabV');
    if (titulo) titulo.textContent = filas.length
      ? filas.length + (filas.length === 1 ? ' tabla con datos' : ' tablas con datos')
      : 'base vacía';
    const badge = document.getElementById('chartTabB');
    if (badge) {
      badge.textContent = nombres.length + ' tablas';
      badge.className = 'badge' + (filas.length ? ' ok' : '');
    }

    if (!top.length) return sinDatos(host, 'sin filas todavía', alto);
    if (!window.d3s) return sinDatos(host, 'd3 no disponible', alto);

    const { svg, ancho } = lienzo(host, alto);
    const t = tonos();
    const etiquetaW = Math.min(112, Math.round(ancho * 0.32));
    const valorW = 46;
    const max = Math.max(...top.map(r => r.c));

    const y = window.d3s.scaleBand()
      .domain(top.map(r => r.nombre))
      .range([6, alto - 6])
      .padding(0.34);
    const x = window.d3s.scaleLinear()
      .domain([0, max])
      .range([0, Math.max(24, ancho - etiquetaW - valorW)]);

    // línea base
    svg.appendChild(el('line', {
      x1: etiquetaW, y1: 4, x2: etiquetaW, y2: alto - 4,
      stroke: t.linea, 'stroke-width': 1
    }));

    top.forEach((r, i) => {
      const yb = y(r.nombre) + y.bandwidth() / 2;

      const nom = el('text', {
        x: etiquetaW - 9, y: yb + 3.4, 'text-anchor': 'end',
        fill: t.tenue, 'font-size': 9.6, 'font-family': 'ui-monospace,monospace'
      });
      nom.textContent = r.nombre.length > 15 ? r.nombre.slice(0, 14) + '…' : r.nombre;
      svg.appendChild(nom);

      const anchoBarra = Math.max(3, x(r.c));
      const rect = el('rect', {
        class: 'barra',
        x: etiquetaW + 1, y: y(r.nombre),
        width: 0, height: y.bandwidth(), rx: 3,
        fill: i === 0 ? t.acento : (i === 1 ? t.aqua : t.acento),
        opacity: i === 0 ? 0.95 : Math.max(0.28, 0.66 - i * 0.07)
      });
      svg.appendChild(rect);
      if (!reduce) {
        rect.style.transition = 'width .5s cubic-bezier(.16,1,.3,1)';
        requestAnimationFrame(() => { rect.setAttribute('width', anchoBarra); });
      } else {
        rect.setAttribute('width', anchoBarra);
      }

      const val = el('text', {
        x: etiquetaW + anchoBarra + 8, y: yb + 3.4,
        fill: i === 0 ? t.acento : t.tenue,
        'font-size': 10, 'font-family': 'ui-monospace,monospace', 'font-weight': 700
      });
      val.textContent = fmt(r.c);
      svg.appendChild(val);
    });
  }

  /* ── 1.3 · refresco con firma (sin repintar si nada cambió) ──────────── */
  let firma = '';
  function firmaActual() {
    const fab = F();
    if (!fab || !fab.S || !fab.S.db) return '';
    try {
      const m = fab.one('SELECT COUNT(*) c FROM memory_items');
      const g = fab.one('SELECT COUNT(*) c FROM messages');
      return [m && m.c, g && g.c, fab.S.ftsModo, tonos().acento].join('|');
    } catch (_) { return ''; }
  }

  function refrescar() {
    const fab = F();
    const panel = document.getElementById('s-panel');
    if (!fab || !fab.S || !fab.S.db || !panel || !panel.classList.contains('on')) return;
    const f = firmaActual();
    if (!f || f === firma) return;
    firma = f;
    pintarMemoria();
    pintarTablas();
  }

  function invalidar() { firma = ''; setTimeout(refrescar, 60); }

  /* ══════════════════════════════════════════════════════════════════════
     2 · CONTADORES · solo enteros limpios (no toca "1,2 KB" ni "$1.990")
     ══════════════════════════════════════════════════════════════════════ */
  function contar(id) {
    const nodo = document.getElementById(id);
    if (!nodo) return;
    let previo = 0;
    let ultimo = null;          // lo último que escribió esta capa

    const escribir = v => { ultimo = v; nodo.textContent = v; };

    new MutationObserver(() => {
      const txt = (nodo.textContent || '').trim();
      // El observer también ve nuestras propias escrituras: si no se filtran,
      // cada fotograma de la animación dispara otra animación desde el valor
      // intermedio y el contador nunca llega.
      if (txt === ultimo) return;
      if (!/^\d{1,7}$/.test(txt)) return;

      const fin = Number(txt);
      const formateado = fin.toLocaleString('es-CL');
      if (fin === previo) {
        // app.js volvió a escribir el mismo número sin formato: se normaliza.
        if (txt !== formateado) escribir(formateado);
        return;
      }

      const ini = previo;
      previo = fin;
      if (reduce || ini === 0) { escribir(formateado); return; }

      const t0 = performance.now(), dur = 520;
      const paso = ahora => {
        const p = Math.min(1, (ahora - t0) / dur);
        const e = 1 - Math.pow(1 - p, 3);
        if (p < 1) {
          escribir(Math.round(ini + (fin - ini) * e).toLocaleString('es-CL'));
          requestAnimationFrame(paso);
        } else {
          escribir(formateado);
        }
      };
      requestAnimationFrame(paso);
    }).observe(nodo, { childList: true, characterData: true, subtree: true });
  }

  /* ══════════════════════════════════════════════════════════════════════
     3 · NAVEGACIÓN · migas, hoja «más», atajos
     ══════════════════════════════════════════════════════════════════════ */
  const secciones = () => $$('.nav button[data-go]').map(b => ({
    id: b.dataset.go,
    nombre: (b.querySelector('span') || {}).textContent || b.dataset.go,
    grupo: ((b.closest('.nav-group') || {}).querySelector
      ? b.closest('.nav-group').querySelector('.nav-lbl').textContent
      : 'Ir a'),
    icono: (b.querySelector('svg') || {}).outerHTML || '',
    boton: b,
    secundaria: b.hasAttribute('data-mas')
  }));

  function migas(id) {
    const it = secciones().find(s => s.id === id);
    const nodo = document.getElementById('crumbNow');
    if (nodo && it) nodo.textContent = it.nombre;
  }

  function abrirDestino(id) {
    const it = secciones().find(s => s.id === id);
    if (it && it.boton) { it.boton.click(); migas(id); }
  }

  /* ── hoja «más» ──────────────────────────────────────────────────────── */
  function montarHoja() {
    const grid = document.getElementById('sheetGrid');
    const hoja = document.getElementById('sheet');
    const disparador = document.getElementById('navMore');
    if (!grid || !hoja || !disparador) return;

    grid.innerHTML = secciones().filter(s => s.secundaria).map(s =>
      '<button class="sheet-item" type="button" data-destino="' + s.id + '">' +
      s.icono + '<span>' + s.nombre + '</span></button>').join('');

    $$('.sheet-item', grid).forEach(b => {
      b.onclick = () => { cerrarHoja(); abrirDestino(b.dataset.destino); };
    });

    const abrir = () => {
      hoja.classList.add('on'); hoja.setAttribute('aria-hidden', 'false');
      disparador.classList.add('abierto');
    };
    const cerrar = () => {
      hoja.classList.remove('on'); hoja.setAttribute('aria-hidden', 'true');
      disparador.classList.remove('abierto');
    };
    window.FabriCerrarHoja = cerrar;
    function cerrarHoja() { cerrar(); }

    disparador.onclick = () => hoja.classList.contains('on') ? cerrar() : abrir();
    disparador.onkeydown = e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); }
    };
    $$('[data-cerrar]', hoja).forEach(n => n.onclick = cerrar);
    addEventListener('keydown', e => { if (e.key === 'Escape') cerrar(); });
  }

  /* ── paleta de comandos ──────────────────────────────────────────────── */
  function montarPaleta() {
    const caja = document.getElementById('cmdk');
    const entrada = document.getElementById('cmdkIn');
    const lista = document.getElementById('cmdkList');
    if (!caja || !entrada || !lista) return;

    let filtrados = [];
    let seleccion = 0;

    function pintar() {
      const q = entrada.value.trim().toLowerCase();
      filtrados = secciones().filter(s =>
        !q || (s.nombre + ' ' + s.id + ' ' + s.grupo).toLowerCase().includes(q));
      seleccion = Math.min(seleccion, Math.max(0, filtrados.length - 1));

      lista.innerHTML = filtrados.length
        ? filtrados.map((s, i) =>
          '<button class="cmdk-item' + (i === seleccion ? ' sel' : '') + '" type="button" data-destino="' +
          s.id + '">' + s.icono + '<span class="g">' + s.nombre + '<small>' + s.grupo + '</small></span></button>').join('')
        : '<div class="empty">Nada coincide con «' + q.replace(/[<>&]/g, '') + '».</div>';

      $$('.cmdk-item', lista).forEach(b => {
        b.onmouseenter = () => { seleccion = filtrados.findIndex(s => s.id === b.dataset.destino); pintarSeleccion(); };
        b.onclick = () => elegir(b.dataset.destino);
      });
    }

    function pintarSeleccion() {
      $$('.cmdk-item', lista).forEach((b, i) => b.classList.toggle('sel', i === seleccion));
    }

    function elegir(id) {
      cerrar();
      abrirDestino(id);
    }

    function abrir() {
      caja.classList.add('on');
      caja.setAttribute('aria-hidden', 'false');
      entrada.value = '';
      seleccion = 0;
      pintar();
      setTimeout(() => entrada.focus(), 20);
    }
    function cerrar() {
      caja.classList.remove('on');
      caja.setAttribute('aria-hidden', 'true');
    }

    ['cmdkOpen', 'cmdkOpen2'].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.onclick = abrir;
    });

    entrada.addEventListener('input', () => { seleccion = 0; pintar(); });
    entrada.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (filtrados.length) { seleccion = (seleccion + 1) % filtrados.length; pintarSeleccion(); }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (filtrados.length) { seleccion = (seleccion - 1 + filtrados.length) % filtrados.length; pintarSeleccion(); }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filtrados[seleccion]) elegir(filtrados[seleccion].id);
      } else if (e.key === 'Escape') {
        cerrar();
      }
    });

    $$('[data-cerrar]', caja).forEach(n => n.onclick = cerrar);

    addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === 'k') { e.preventDefault(); caja.classList.contains('on') ? cerrar() : abrir(); }
      else if (k === 'escape' && caja.classList.contains('on')) cerrar();
    });

    window.FabriAbrirPaleta = abrir;
  }

  /* ══════════════════════════════════════════════════════════════════════
     4 · DETALLES · reloj, espejo de FTS, hito de instalación
     ══════════════════════════════════════════════════════════════════════ */
  function reloj() {
    const nodo = document.getElementById('heroHora');
    if (!nodo) return;
    const pintar = () => {
      nodo.textContent = new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
    };
    pintar();
    setInterval(pintar, 20000);
  }

  function espejoFts() {
    const origen = document.getElementById('kFts');
    const destino = document.getElementById('heroFts');
    if (!origen || !destino) return;
    const sincronizar = () => {
      const t = (origen.textContent || '').trim();
      destino.innerHTML = '<b>SQLite</b> ' + (t === 'LIKE' ? 'LIKE' : t || 'FTS');
    };
    new MutationObserver(sincronizar).observe(origen, { childList: true, characterData: true, subtree: true });
    sincronizar();
  }

  function hito(texto) {
    let caja = document.getElementById('hito');
    if (!caja) {
      caja = document.createElement('div');
      caja.id = 'hito';
      caja.className = 'hito';
      caja.innerHTML = '<div class="lot" data-lottie="./anim/check.json"></div><span></span>';
      document.body.appendChild(caja);
    }
    const etiqueta = caja.querySelector('span');
    if (etiqueta) etiqueta.textContent = texto;
    caja.classList.add('on');
    if (window.FabriLottie) window.FabriLottie.montar(caja.querySelector('[data-lottie]'));
    clearTimeout(caja._t);
    caja._t = setTimeout(() => caja.classList.remove('on'), 3200);
  }

  function instalar() {
    addEventListener('appinstalled', () => hito('Instalada en el dispositivo'));
  }

  /* ══════════════════════════════════════════════════════════════════════
     5 · ARRANQUE
     ══════════════════════════════════════════════════════════════════════ */
  function iniciar() {
    contar('kMem');
    contar('kMsg');
    reloj();
    espejoFts();
    montarHoja();
    montarPaleta();
    instalar();

    // migas al navegar (captura: app.js ya tiene su propio listener)
    const nav = document.querySelector('.nav');
    if (nav) nav.addEventListener('click', e => {
      const b = e.target.closest('button[data-go]');
      if (b) migas(b.dataset.go);
    });

    // el panel se repinta al entrar y cuando cambian los datos
    setInterval(refrescar, 3500);
    document.addEventListener('click', e => {
      if (e.target.closest('.nav button[data-go="panel"]')) invalidar();
    });
    const temas = document.getElementById('themes');
    if (temas) temas.addEventListener('click', invalidar);

    let temporizador = null;
    addEventListener('resize', () => {
      clearTimeout(temporizador);
      temporizador = setTimeout(invalidar, 180);
    });

    // primer repintado cuando la base ya existe (boot es asíncrono)
    let intentos = 0;
    const esperarBase = setInterval(() => {
      const fab = F();
      intentos++;
      if (fab && fab.S && fab.S.db) {
        clearInterval(esperarBase);
        invalidar();
      } else if (intentos > 120) {
        clearInterval(esperarBase);
      }
    }, 250);

    // el cargador de arranque se elimina: su Lottie también debe morir.
    const boot = document.getElementById('boot');
    if (boot) {
      const vigia = new MutationObserver(() => {
        if (boot.isConnected) return;
        const anim = boot.querySelector('[data-lottie]');
        if (anim && anim._lot) { try { anim._lot.destroy(); } catch (_) {} }
        vigia.disconnect();
      });
      vigia.observe(document.body, { childList: true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();

  window.FabriCloud = { refrescar: invalidar, pintarMemoria, pintarTablas, hito };
})();