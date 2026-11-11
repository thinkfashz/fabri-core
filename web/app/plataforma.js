/* ============================================================================
   PLATAFORMA · panel de administración
   ----------------------------------------------------------------------------
   Lo que el dueño de FORGE CORE STOCK necesita ver de TODA la plataforma:
   cuántas cuentas hay, cuántas tiendas, cuántos pedidos, cuánta gente entra y
   de dónde llega, y si la base está sana.

   De dónde salen los datos (no hay endpoint nuevo: se reusan los existentes)

     GET  /api/auth?diag=1          → tablas + último latido (público)
     POST /api/mercado {resumen}    → tiendas, productos, pedidos (token admin)
     POST /api/auth   {usuarios}    → cuentas (token admin)
     GET  /api/visitas?dias=N       → tráfico por día, canal, ruta y país

   El token de administración (FABRI_API_TOKEN) NO está en este archivo ni en
   ningún otro del sitio: lo pega el dueño una vez. Se guarda en
   `sessionStorage` (muere al cerrar la pestaña) y sólo pasa a `localStorage`
   si marca «Recordar en este equipo». Nunca se muestra de vuelta en pantalla.
   ========================================================================== */
(function () {
  "use strict";

  const API = "https://fabri-api.vercel.app/api";
  const K_SESION = "fcore.plataforma.token";   // vive lo que la pestaña
  const K_EQUIPO = "fcore.plataforma.equipo";  // sólo con «recordar»
  const FRESCO_MS = 60 * 1000;                 // menos de un minuto = «en vivo»

  const EST = {
    token: "",
    dias: 7,
    cargando: false,
    salud: null,      // /api/auth?diag=1
    resumen: null,    // mercado · resumen
    cuentas: [],      // auth · usuarios
    visitas: null,    // /api/visitas
    error: "",
    ts: 0,
    buscar: ""
  };

  /* ── utilidades ─────────────────────────────────────────────────────────── */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function toast(txt) {
    try { if (window.Fabri && window.Fabri.toast) window.Fabri.toast(txt); } catch (e) { /* opcional */ }
  }

  /** Número con separador de miles chileno. */
  function num(n) {
    const v = Number(n);
    if (!isFinite(v)) return "—";
    return v.toLocaleString("es-CL");
  }

  function normalizar(s) {
    return String(s == null ? "" : s).toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ").trim();
  }

  /** «hace 3 min» / «hace 2 h» / «hace 4 d» / «nunca». */
  function haceCuanto(ms, ahoraMs) {
    const t = Number(ms) || 0;
    if (!t) return "nunca";
    const ahora = Number(ahoraMs) || Date.now();
    const seg = Math.max(0, Math.round((ahora - t) / 1000));
    if (seg < 45) return "recién";
    const min = Math.round(seg / 60);
    if (min < 60) return "hace " + min + " min";
    const h = Math.round(min / 60);
    if (h < 24) return "hace " + h + " h";
    const d = Math.round(h / 24);
    if (d < 30) return "hace " + d + " d";
    return new Date(t).toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric" });
  }

  /** Cuentas que coinciden con el texto (correo, nombre o rol). */
  function filtrarCuentas(cuentas, q) {
    const t = normalizar(q);
    const lista = Array.isArray(cuentas) ? cuentas : [];
    if (!t) return lista.slice();
    return lista.filter((c) => normalizar([c.email, c.nombre, c.rol].filter(Boolean).join(" ")).indexOf(t) >= 0);
  }

  /**
   * Tráfico por día listo para dibujar: rellena con cero los días que la API no
   * devuelve (nadie entró) y calcula el alto relativo y las etiquetas.
   * Los días se cortan en UTC porque la API agrupa con `date_trunc` en UTC.
   */
  function barrasVisitas(porDia, dias, hoyMs) {
    const mapa = new Map();
    (Array.isArray(porDia) ? porDia : []).forEach((d) => {
      mapa.set(String(d.dia || ""), Number(d.n) || 0);
    });
    const total = Math.max(1, Number(dias) || 1);
    const base = Number(hoyMs) || Date.now();
    const lista = [];
    for (let i = total - 1; i >= 0; i--) {
      const clave = new Date(base - i * 86400000).toISOString().slice(0, 10);
      lista.push({ dia: clave, n: mapa.get(clave) || 0 });
    }
    const max = Math.max(1, ...lista.map((d) => d.n));
    const cada = lista.length <= 10 ? 1 : 5;
    return lista.map((d, i) => ({
      dia: d.dia,
      n: d.n,
      alto: Math.max(2, Math.round((d.n / max) * 100)),
      etiqueta: (i % cada === 0 || i === lista.length - 1) ? d.dia.slice(8, 10) : "",
      hoy: i === lista.length - 1
    }));
  }

  /** «300 gratis · 3.000 pro» a partir del tope de plan que publica la API. */
  function textoPlan(tope) {
    if (!tope || typeof tope !== "object") return "—";
    const partes = [];
    if (tope.gratis != null) partes.push(num(tope.gratis) + " gratis");
    if (tope.pro != null) partes.push(num(tope.pro) + " pro");
    return partes.length ? "productos: " + partes.join(" · ") : "—";
  }

  /* ── token ──────────────────────────────────────────────────────────────── */

  function leerToken() {
    try {
      const s = sessionStorage.getItem(K_SESION);
      if (s) return s;
    } catch (e) { /* modo privado sin storage */ }
    try { return localStorage.getItem(K_EQUIPO) || ""; } catch (e) { return ""; }
  }

  function guardarToken(t, recordar) {
    try { sessionStorage.setItem(K_SESION, t); } catch (e) { /* nada */ }
    try {
      if (recordar) localStorage.setItem(K_EQUIPO, t);
      else localStorage.removeItem(K_EQUIPO);
    } catch (e) { /* nada */ }
  }

  function borrarToken() {
    try { sessionStorage.removeItem(K_SESION); } catch (e) { /* nada */ }
    try { localStorage.removeItem(K_EQUIPO); } catch (e) { /* nada */ }
  }

  function recordarActivo() {
    try { return Boolean(localStorage.getItem(K_EQUIPO)); } catch (e) { return false; }
  }

  /* ── red ────────────────────────────────────────────────────────────────── */

  /** Una llamada a la API con el token puesto. Devuelve `{ status, d }`. */
  async function pedir(ruta, cuerpo) {
    const opt = {
      method: cuerpo ? "POST" : "GET",
      headers: { "Content-Type": "application/json" }
    };
    if (EST.token) opt.headers.Authorization = "Bearer " + EST.token;
    if (cuerpo) opt.body = JSON.stringify(cuerpo);
    const r = await fetch(API + ruta, opt);
    const d = await r.json().catch(() => ({}));
    return { status: r.status, d };
  }

  /** Trae todo lo del panel en paralelo. Una caída no tumba las otras. */
  async function cargar() {
    if (!EST.token || EST.cargando) return;
    EST.cargando = true;
    EST.error = "";
    pintarEstado();

    const [salud, resumen, cuentas, visitas] = await Promise.allSettled([
      pedir("/auth?diag=1"),
      pedir("/mercado", { accion: "resumen" }),
      pedir("/auth", { accion: "usuarios" }),
      pedir("/visitas?dias=" + EST.dias)
    ]);

    const dato = (r) => (r.status === "fulfilled" ? r.value : { status: 0, d: {} });

    const s = dato(salud);
    EST.salud = s.d && s.d.ok ? s.d : null;

    const m = dato(resumen);
    const a = dato(cuentas);
    const v = dato(visitas);

    // 401 en cualquiera de las tres con token = el token no sirve.
    const sinPermiso = [m, a, v].some((r) => r.status === 401);
    if (sinPermiso) {
      EST.error = "el token no sirve o venció";
      EST.resumen = null;
      EST.cuentas = [];
      EST.visitas = null;
    } else {
      EST.resumen = m.d && m.d.ok ? m.d : null;
      EST.cuentas = a.d && a.d.ok && Array.isArray(a.d.usuarios) ? a.d.usuarios : [];
      EST.visitas = v.d && v.d.ok ? v.d : null;
      if (!EST.resumen && !EST.visitas) EST.error = "la API no respondió";
    }

    EST.ts = Date.now();
    EST.cargando = false;
    pintar();
  }

  /* ── pintado ────────────────────────────────────────────────────────────── */

  function pintar() {
    pintarCandado();
    pintarEstado();
    pintarKpis();
    pintarVisitas();
    pintarCanales();
    pintarRutas();
    pintarCuentas();
    pintarSalud();
  }

  function pintarCandado() {
    const candado = $("platCandado");
    const panel = $("platPanel");
    const chip = $("platCandadoChip");
    const abierto = Boolean(EST.token);
    if (candado) candado.hidden = abierto;
    if (panel) panel.hidden = !abierto;
    if (chip) {
      chip.textContent = abierto ? "abierto" : "bloqueado";
      chip.className = "badge " + (abierto ? "ok" : "");
    }
    const rec = $("platRecordar");
    if (rec && !rec.dataset.listo) { rec.dataset.listo = "1"; rec.checked = recordarActivo(); }
  }

  /** «en vivo» sólo si la última lectura es de hace menos de un minuto. */
  function pintarEstado() {
    const el = $("platLive");
    if (!el) return;
    const txt = $("platEstado");
    if (EST.error) {
      el.className = "neg-live stale";
      el.innerHTML = "<i></i><b>sin datos</b>";
      if (txt) txt.textContent = EST.error;
      return;
    }
    if (EST.cargando) {
      el.className = "neg-live stale";
      el.innerHTML = "<i></i><b>leyendo</b>";
      if (txt) txt.textContent = "Consultando la plataforma…";
      return;
    }
    const hace = EST.ts ? Date.now() - EST.ts : 0;
    const vivo = EST.ts > 0 && hace < FRESCO_MS;
    el.className = "neg-live" + (vivo ? "" : " stale");
    el.innerHTML = "<i></i><b>" + (vivo ? "en vivo" : "hace " + haceCuanto(EST.ts, Date.now()).replace("hace ", "")) + "</b>";
    if (txt) {
      const n = EST.cuentas.length;
      txt.textContent = EST.ts
        ? "actualizado " + haceCuanto(EST.ts, Date.now()) + " · " + n + (n === 1 ? " cuenta" : " cuentas")
        : "Sin leer todavía";
    }
  }

  function kpi(k, v, d, tono) {
    return '<div class="kpi' + (tono ? " " + tono : "") + '">' +
      "<span>" + esc(k) + "</span><b>" + esc(v) + "</b><small>" + esc(d) + "</small></div>";
  }

  function pintarKpis() {
    const caja = $("platKpis");
    if (!caja) return;
    const r = (EST.resumen && EST.resumen.resumen) || {};
    const v = EST.visitas || {};
    const cuentas = EST.cuentas || [];
    const owners = cuentas.filter((c) => c.rol === "owner").length;
    const conTerminos = cuentas.filter((c) => c.terminos_version).length;

    caja.innerHTML =
      kpi("Tiendas activas", EST.resumen ? num(r.locales) : "—",
        (r.locales_abiertos != null ? r.locales_abiertos + " abiertas ahora" : "sin datos"), "oro") +
      kpi("Productos", EST.resumen ? num(r.productos) : "—", "en todos los catálogos", "") +
      kpi("Pedidos", EST.resumen ? num(r.pedidos) : "—", "histórico completo", "") +
      kpi("Cuentas", EST.resumen || EST.cuentas.length ? num(cuentas.length) : "—",
        owners + " owner · " + conTerminos + " con términos", "") +
      kpi("Visitas · " + EST.dias + " días", EST.visitas ? num(v.total) : "—",
        EST.visitas ? num(v.unicos) + " únicos" : "sin datos", "") +
      kpi("Hoy", EST.visitas ? num(v.hoy) : "—",
        EST.visitas ? "ayer " + num(v.ayer) : "sin datos", "");
  }

  function pintarVisitas() {
    const caja = $("platVisitas");
    if (!caja) return;
    const sub = $("platVisitasSub");
    const chip = $("platVisitasChip");
    const v = EST.visitas;
    if (!v) {
      caja.innerHTML = '<div class="neg-vacio"><b>Sin tráfico que mostrar</b>' +
        "<p>La API no devolvió visitas para el periodo.</p></div>";
      if (sub) sub.textContent = "Sin datos del periodo";
      if (chip) { chip.textContent = "sin datos"; chip.className = "badge warn"; }
      return;
    }
    const barras = barrasVisitas(v.porDia, EST.dias, Date.now());
    if (sub) sub.textContent = "Últimos " + EST.dias + " días · " + num(v.total) + " visitas";
    if (chip) { chip.textContent = EST.dias + " días"; chip.className = "badge"; }
    caja.innerHTML = barras.map((b) =>
      '<div class="barras-dia' + (b.n ? "" : " vacia") + (b.hoy ? " hoy" : "") + '"' +
        ' title="' + esc(b.dia + " · " + b.n + " visita(s)") + '">' +
        '<span class="barras-col" style="height:' + b.alto + '%"></span>' +
        "<small>" + esc(b.etiqueta) + "</small>" +
      "</div>").join("");
  }

  function pintarCanales() {
    const caja = $("platCanales");
    if (!caja) return;
    const total = $("platCanalesTotal");
    const canales = (EST.visitas && EST.visitas.canales) || [];
    if (total) total.textContent = canales.length ? canales.length + " canales" : "—";
    if (!canales.length) {
      caja.innerHTML = '<div class="neg-vacio"><b>Sin canales</b><p>No hay visitas en el periodo.</p></div>';
      return;
    }
    caja.innerHTML = canales.map((c) =>
      '<div class="plat-canal">' +
        "<span>" + esc(c.canal || "directo") + "</span>" +
        '<div class="plat-canal-barra"><i style="width:' + Math.max(2, Math.min(100, Number(c.pct) || 0)) + '%"></i></div>' +
        "<b>" + num(c.n) + "</b>" +
      "</div>").join("");
  }

  function pintarRutas() {
    const caja = $("platRutas");
    if (!caja) return;
    const chip = $("platRutasChip");
    const v = EST.visitas || {};
    const rutas = v.rutas || [];
    const paises = v.paises || [];
    if (chip) chip.textContent = rutas.length ? rutas.length + " rutas" : "—";
    if (!rutas.length && !paises.length) {
      caja.innerHTML = '<div class="neg-vacio"><b>Sin rutas</b><p>No hay visitas en el periodo.</p></div>';
      return;
    }
    caja.innerHTML =
      (rutas.length
        ? rutas.map((r) =>
            '<div class="plat-salud-fila"><span class="mono">' + esc(r.ruta || "/") + "</span><b>" + num(r.n) + "</b></div>").join("")
        : "") +
      (paises.length
        ? '<div class="neg-canales">' + paises.map((p) =>
            '<span class="neg-canal">' + esc(p.pais || "??") + " · " + num(p.n) + "</span>").join("") + "</div>"
        : "");
  }

  function pintarCuentas() {
    const caja = $("platCuentas");
    if (!caja) return;
    const chip = $("platCuentasN");
    const lista = filtrarCuentas(EST.cuentas, EST.buscar);
    if (chip) chip.textContent = lista.length === EST.cuentas.length
      ? EST.cuentas.length
      : lista.length + " de " + EST.cuentas.length;

    if (!lista.length) {
      caja.innerHTML = EST.cuentas.length
        ? '<div class="neg-vacio"><b>Ninguna cuenta coincide</b><p>Prueba con otro correo o nombre.</p></div>'
        : '<div class="neg-vacio"><b>Todavía no hay cuentas</b><p>La primera que se registre queda owner.</p></div>';
      return;
    }
    caja.innerHTML = lista.slice(0, 100).map((c) => {
      const owner = c.rol === "owner";
      const terminos = c.terminos_version ? "términos v" + c.terminos_version : "sin términos";
      return '<div class="plat-cuenta">' +
        '<div class="plat-cuenta-txt">' +
          "<b>" + esc(c.email || "(sin correo)") + "</b>" +
          "<small>" + esc(c.nombre || "sin nombre") + " · " + esc(terminos) + "</small>" +
        "</div>" +
        '<span class="badge ' + (owner ? "acc" : "") + '">' + esc(c.rol || "member") + "</span>" +
        '<small class="hint">' + esc(haceCuanto(c.ultimo_login, Date.now())) + "</small>" +
      "</div>";
    }).join("");
  }

  function pintarSalud() {
    const caja = $("platSalud");
    if (!caja) return;
    const chip = $("platSaludChip");
    const s = EST.salud || {};
    const t = s.tablas || null;
    const latido = s.ultimo_latido || null;
    const plan = EST.resumen && EST.resumen.tope_plan;

    if (chip) {
      const sano = Boolean(t && t.usuarios && t.sesiones);
      chip.textContent = sano ? "sana" : "revisar";
      chip.className = "badge " + (sano ? "ok" : "warn");
    }

    const fila = (k, v, tono) =>
      '<div class="plat-salud-fila"><span>' + esc(k) + "</span>" +
      '<b class="' + (tono || "") + '">' + v + "</b></div>";

    const marca = (ok) => ok
      ? '<span class="badge ok">ok</span>'
      : '<span class="badge err">falta</span>';

    const lista = t ? [t.usuarios, t.sesiones, t.latido] : [];
    const bien = lista.filter(Boolean).length;
    const chips = t
      ? '<div class="plat-tablas">' +
          '<span class="badge ' + (t.usuarios ? "ok" : "err") + '">cuentas</span>' +
          '<span class="badge ' + (t.sesiones ? "ok" : "err") + '">sesiones</span>' +
          '<span class="badge ' + (t.latido ? "ok" : "err") + '">latido</span>' +
        "</div>"
      : "";

    caja.innerHTML =
      fila("Tablas", t
        ? bien + " de 3"
        : '<span class="badge warn">sin comprobar</span>') +
      chips +
      fila("Último latido", latido
        ? '<span class="badge ' + (latido.ok ? "ok" : "err") + '">' + (latido.ok ? "ok" : "falló") + "</span> " +
          esc(haceCuanto(latido.ts, Date.now())) + (latido.ms ? " · " + num(latido.ms) + " ms" : "")
        : '<span class="badge warn">sin registro</span>') +
      fila("Plan", textoPlan(plan)) +
      fila("Token", EST.token ? '<span class="badge ok">activo en este equipo</span>' : '<span class="badge">sin token</span>');
  }

  /* ── acciones ───────────────────────────────────────────────────────────── */

  async function entrar() {
    const input = $("platToken");
    const t = (input ? input.value : "").trim();
    if (!t) { toast("Pega el token de administración"); return; }
    const rec = $("platRecordar");
    EST.token = t;
    EST.error = "";
    EST.ts = 0;
    guardarToken(t, Boolean(rec && rec.checked));
    if (input) input.value = "";
    pintarCandado();
    await cargar();
    if (EST.error) toast(EST.error);
    else toast("Panel abierto");
  }

  function salir() {
    borrarToken();
    EST.token = "";
    EST.salud = null; EST.resumen = null; EST.cuentas = []; EST.visitas = null;
    EST.ts = 0; EST.error = "";
    pintar();
    toast("Token borrado de este equipo");
  }

  /* ── montaje ────────────────────────────────────────────────────────────── */

  let montado = false;

  function montar() {
    if (montado) return;
    montado = true;

    const entrarBtn = $("platEntrar");
    if (entrarBtn) entrarBtn.onclick = entrar;
    const input = $("platToken");
    if (input) {
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); entrar(); }
      });
    }
    const salirBtn = $("platSalir");
    if (salirBtn) salirBtn.onclick = salir;

    const rango = $("platRango");
    if (rango) {
      rango.addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-dias]");
        if (!b) return;
        const n = Number(b.dataset.dias) || 7;
        if (n === EST.dias) return;
        EST.dias = n;
        rango.querySelectorAll("[data-dias]").forEach((x) => {
          const on = Number(x.dataset.dias) === n;
          x.classList.toggle("on", on);
          x.setAttribute("aria-pressed", on ? "true" : "false");
        });
        pintar();
        cargar();
      });
    }

    const buscar = $("platCuentasBuscar");
    if (buscar) buscar.addEventListener("input", () => {
      EST.buscar = buscar.value;
      pintarCuentas();
    });
  }

  function render() {
    const sec = $("s-plataforma");
    if (!sec) return;
    montar();
    EST.token = EST.token || leerToken();
    pintar();
    // Relee al entrar si lo que hay ya tiene más de un minuto.
    if (EST.token && (!EST.ts || Date.now() - EST.ts > FRESCO_MS)) cargar();
  }

  window.Plataforma = {
    render,
    cargar,
    _test: { haceCuanto, filtrarCuentas, barrasVisitas, normalizar, num, textoPlan }
  };
})();
