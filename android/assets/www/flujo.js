/* ==========================================================================
   FABRI-CORE · Flujo en tiempo real
   --------------------------------------------------------------------------
   Esta vista no inventa estados: cada nodo del mapa se pinta con lo que
   responde el núcleo en ese momento (ping, sqlite, inventario, revision,
   runtime local, chat remoto, puente de Termux). Si algo no se puede
   comprobar, el nodo lo dice en vez de mostrarse verde.

   El terminal de abajo manda comandos al puente de Termux por loopback
   (`FabrickNative.termuxComando`). El puente limita tiempo y salida, rechaza
   comandos irreversibles y registra todo.
   ========================================================================== */

const FLUJO = {
  modulo: "",
  timer: null,
  auto: true,
  iniciado: false,
  ocupado: false,
  historial: [],
  hIdx: -1,
  ultimoRefresco: 0
};

/* ── entrada y salida de la vista ───────────────────────────────────────── */

function flujoIniciar() {
  if (!FLUJO.iniciado) {
    FLUJO.iniciado = true;
    flujoConectar();
    flujoBienvenida();
    revision("flujo", "info", "vista de flujo abierta");
  }
  flujoRefrescar();
  if (FLUJO.timer) clearInterval(FLUJO.timer);
  FLUJO.timer = setInterval(function () {
    if (FLUJO.auto) flujoRefrescar();
  }, 5000);
}

function flujoSalir() {
  if (FLUJO.timer) {
    clearInterval(FLUJO.timer);
    FLUJO.timer = null;
  }
}

function flujoConectar() {
  const $ = function (id) { return document.getElementById(id); };

  if ($("flujoAuto")) {
    $("flujoAuto").addEventListener("change", function () {
      FLUJO.auto = $("flujoAuto").checked;
      toast(FLUJO.auto ? "Actualización automática activa" : "Actualización automática en pausa");
    });
  }
  if ($("btnFlujoLimpiarFallos")) {
    $("btnFlujoLimpiarFallos").addEventListener("click", flujoRefrescar);
  }
  // Selector de módulo instalado: se rellena desde el propio núcleo.
  flujoCargarModulos();
  const selMod = $("flujoModulo");
  if (selMod) {
    selMod.addEventListener("change", function () {
      FLUJO.modulo = selMod.value || "";
      flujoRefrescar();
    });
  }
  if ($("btnFlujoEjecutar")) {
    $("btnFlujoEjecutar").addEventListener("click", function () { flujoEjecutar(); });
  }
  if ($("flujoCmd")) {
    $("flujoCmd").addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        flujoEjecutar();
        return;
      }
      // Historial con flechas, como cualquier terminal.
      if (e.key === "ArrowUp") {
        if (!FLUJO.historial.length) return;
        e.preventDefault();
        FLUJO.hIdx = FLUJO.hIdx <= 0 ? FLUJO.historial.length - 1 : FLUJO.hIdx - 1;
        $("flujoCmd").value = FLUJO.historial[FLUJO.hIdx] || "";
        return;
      }
      if (e.key === "ArrowDown") {
        if (!FLUJO.historial.length) return;
        e.preventDefault();
        FLUJO.hIdx = FLUJO.hIdx >= FLUJO.historial.length - 1 ? 0 : FLUJO.hIdx + 1;
        $("flujoCmd").value = FLUJO.historial[FLUJO.hIdx] || "";
      }
    });
  }
  if ($("btnFlujoLimpiarTerm")) {
    $("btnFlujoLimpiarTerm").addEventListener("click", function () {
      const t = document.getElementById("flujoTerminal");
      if (t) t.innerHTML = "";
      flujoBienvenida();
    });
  }
  document.querySelectorAll("[data-flujo-cmd]").forEach(function (b) {
    b.addEventListener("click", function () {
      const campo = document.getElementById("flujoCmd");
      if (campo) campo.value = b.dataset.flujoCmd;
      flujoEjecutar();
    });
  });
}

/* ── recolección de estado real ─────────────────────────────────────────── */

/**
 * Recolecta el estado real del sistema.
 *
 * Antes eran cinco llamadas BLOQUEANTES seguidas —una de ellas `sqlite`, con
 * tope de 20 s— en el hilo que pinta: al abrir «Flujo en tiempo real» la
 * pantalla se congelaba y, si el núcleo estaba ocupado, los nodos salían todos
 * en error. Ahora van en paralelo y con reintento; el refresco periódico no se
 * solapa consigo mismo.
 */
function flujoRefrescar() {
  if (FLUJO.consultando) return;
  FLUJO.consultando = true;
  const t0 = Date.now();
  // Un solo viaje: `panel` devuelve SQLite, Inventario y Revisión juntos, con un
  // único candado del núcleo. El `ping` va aparte porque lo contesta Java al
  // instante. Antes eran cinco llamadas serializadas por el carril.
  const tl = { maxMs: 6000 };
  Promise.allSettled([
    apiTarde("ping", undefined, tl),
    apiTarde("panel", { limite: 80 }, tl)
  ]).then(function (res) {
    FLUJO.consultando = false;
    const ping = res[0].status === "fulfilled" ? res[0].value
      : { ok: false, error: "carga cancelada" };
    const p = res[1].status === "fulfilled" ? res[1].value
      : { ok: false, error: "carga cancelada" };
    if (p && p.ok) {
      const d = p.data || {};
      const rev = d.revision || {};
      flujoPintarCon(
        ping,
        { ok: true, data: d.sqlite || {} },
        { ok: true, data: d.inventario || {} },
        { ok: true, data: rev.resumen || {} },
        { ok: true, data: { eventos: (rev.lista && rev.lista.eventos) || [] } },
        t0
      );
      return;
    }
    // Respaldo: si la APK es anterior y no trae `panel`, se usan las llamadas
    // sueltas de siempre para no romper nada.
    if (p && p.codigo === "CORE_ERROR" && /desconocida/i.test(p.error || "")) {
      flujoRefrescarIndividual(ping, t0);
      return;
    }
    const e = (p && p.error) || "el núcleo no respondió";
    flujoPintarCon(ping, { ok: false, error: e }, { ok: false, error: e },
      { ok: false, error: e }, { ok: false, error: e }, t0);
  }).catch(function () {
    FLUJO.consultando = false;
  });
}

/** Camino anterior (APK sin la op `panel`): cuatro llamadas por separado. */
function flujoRefrescarIndividual(ping, t0) {
  const tl = { maxMs: 6000 };
  Promise.allSettled([
    apiTarde("sqlite", { accion: "tablas" }, tl),
    apiTarde("inventario", { accion: "resumen" }, tl),
    apiTarde("revision.resumen", undefined, tl),
    apiTarde("revision.listar", { limite: 80 }, tl)
  ]).then(function (res) {
    const r = res.map(function (x) {
      return x.status === "fulfilled" ? x.value : { ok: false, error: "carga cancelada" };
    });
    flujoPintarCon(ping, r[0], r[1], r[2], r[3], t0);
  });
}

function flujoPintarCon(ping, tablas, inv, rev, eventos, t0) {

  // Seguridad: si `callAsync` no llegó, cada valor viene como fallo y la vista
  // debe pintar «caído / error» — NUNCA lanzar al acceder a `.ok`.
  ping = (ping && typeof ping === "object") ? ping : { ok: false, error: "sin respuesta del núcleo" };
  tablas = (tablas && typeof tablas === "object") ? tablas : { ok: false, error: "SQLite no respondió" };
  inv = (inv && typeof inv === "object") ? inv : { ok: false, error: "inventario no respondió" };
  rev = (rev && typeof rev === "object") ? rev : { ok: false, error: "revisión no respondió" };
  eventos = (eventos && typeof eventos === "object") ? eventos : { ok: false, error: "sin registro de fallos" };

  let local = null;
  try {
    if (window.FabrickNative && typeof window.FabrickNative.localEstado === "function") {
      local = JSON.parse(window.FabrickNative.localEstado());
    }
  } catch (e) { local = null; }

  let chat = null;
  try {
    if (window.FabrickNative && typeof window.FabrickNative.chatEstado === "function") {
      chat = JSON.parse(window.FabrickNative.chatEstado());
    }
  } catch (e) { chat = null; }

  let termux = null;
  try {
    if (window.FabrickNative && typeof window.FabrickNative.termuxEstado === "function") {
      termux = JSON.parse(window.FabrickNative.termuxEstado());
    }
  } catch (e) { termux = null; }

  const nubeUrl = localStorage.getItem("fabrick.nube.url") || "";
  const impresion = !!(window.FabrickNative && typeof window.FabrickNative.imprimir === "function");
  const descargas = estadoApp.descargasDisco || [];

  const nodos = [
    {
      id: "core",
      icono: "◈",
      titulo: "Núcleo Rust",
      estado: ping.ok ? "ok" : "error",
      chip: ping.ok ? "activo" : "caído",
      detalle: ping.ok
        ? "v" + (ping.data.version || "?") + " · " + (ping.data.abi || "abi ?")
        : (ping.error || "sin respuesta")
    },
    {
      id: "sqlite",
      icono: "▤",
      titulo: "SQLite local",
      estado: tablas.ok ? "ok" : "error",
      chip: tablas.ok ? "abierta" : "error",
      detalle: tablas.ok
        ? ((tablas.data.tablas || []).length + " tablas · fabrick.db")
        : (tablas.error || "no se pudo leer el esquema")
    },
    {
      id: "inventario",
      icono: "▦",
      titulo: "Inventario",
      estado: inv.ok ? ((inv.data.pendientes_sync || 0) > 0 ? "aviso" : "ok") : "error",
      chip: inv.ok ? ((inv.data.pendientes_sync || 0) > 0 ? "sin sync" : "al día") : "error",
      detalle: inv.ok
        ? (inv.data.total || 0) + " productos · " + (inv.data.stock_bajo || 0) + " con stock bajo · "
          + (inv.data.pendientes_sync || 0) + " sin sincronizar"
        : (inv.error || "el módulo no respondió")
    },
    {
      id: "apis",
      icono: "☁",
      titulo: "APIs libres de códigos",
      estado: "inactivo",
      chip: "bajo demanda",
      detalle: "Open Food Facts · Beauty · Products — se consultan al escanear, no en segundo plano"
    },
    {
      id: "ia-local",
      icono: "✦",
      titulo: "IA local · llama.cpp",
      estado: local && local.cargado ? "ok" : (local && local.cargando ? "aviso" : (local && local.ok === false ? "error" : "inactivo")),
      chip: local && local.cargado ? "modelo cargado" : (local && local.cargando ? "cargando" : "sin modelo"),
      detalle: local
        ? (local.cargado
            ? "ctx " + (local.n_ctx || 0) + " · " + ((local.info && (local.info.desc || local.info.archivo)) || "GGUF listo")
            : (local.cargando
                ? "cargando hace " + Math.round((local.cargando_ms || 0) / 1000) + " s"
                : (local.error || "ningún modelo cargado")))
        : "puente nativo no disponible"
    },
    {
      id: "ia-remota",
      icono: "⇄",
      titulo: "IA remota · proveedor",
      estado: chat && chat.configurado ? "ok" : "inactivo",
      chip: chat && chat.configurado ? "configurada" : "sin configurar",
      detalle: chat && chat.configurado
        ? ((chat.modelo || "modelo ?") + " · " + (chat.proveedor || "proveedor ?"))
        : "se configura en Chat → Remoto"
    },
    {
      id: "nube",
      icono: "☁",
      titulo: "Nube / sincronización",
      estado: nubeUrl ? "ok" : "inactivo",
      chip: nubeUrl ? "configurada" : "local",
      detalle: nubeUrl
        ? ("destino: " + nubeUrl)
        : "sin URL de nube: el inventario se exporta a archivo cuando sincronizas"
    },
    {
      id: "termux",
      icono: "⌘",
      titulo: "Puente Termux",
      estado: termux && termux.ok ? "ok" : "error",
      chip: termux && termux.ok ? "conectado" : "sin puente",
      detalle: termux && termux.ok
        ? ("127.0.0.1:8787 · v" + (termux.version || "?") + " · " + (termux.comandos || []).length + " comandos")
        : (termux && termux.error) || "el puente no responde"
    },
    {
      id: "impresion",
      icono: "⎙",
      titulo: "Impresión / PDF",
      estado: impresion ? "ok" : "inactivo",
      chip: impresion ? "disponible" : "sin puente",
      detalle: impresion
        ? "PrintManager del sistema · boletas del inventario"
        : "requiere la APK (no funciona en el navegador)"
    }
  ];

  flujoPintarResumen(rev, eventos, nodos, descargas);
  flujoPintarMapa(nodos);
  flujoPintarFallos(eventos);
  flujoPintarPuente(termux);

  FLUJO.ultimoRefresco = Date.now();
  const ms = FLUJO.ultimoRefresco - t0;
  if (ms > 1200) {
    revision("flujo", "aviso", "refresco del flujo lento", ms + " ms", ms, "flujo");
  }
}

/* ── pintado ────────────────────────────────────────────────────────────── */

function flujoPintarResumen(rev, eventos, nodos, descargas) {
  const caja = document.getElementById("flujoResumen");
  if (!caja) return;
  const d = rev.ok ? (rev.data || {}) : {};
  const errores = Number(d.errores || 0);
  const avisos = Number(d.avisos || 0);
  const okNodos = nodos.filter(function (n) { return n.estado === "ok"; }).length;
  const verificados = (descargas || []).length;
  caja.innerHTML = [
    '<div class="flujo-kpi ' + (okNodos >= 6 ? "ok" : "alerta") + '"><span>Nodos activos</span><strong>'
      + okNodos + "/" + nodos.length + "</strong></div>",
    '<div class="flujo-kpi ' + (errores > 0 ? "error" : "ok") + '"><span>Errores</span><strong>'
      + errores + "</strong></div>",
    '<div class="flujo-kpi ' + (avisos > 0 ? "alerta" : "") + '"><span>Avisos</span><strong>'
      + avisos + "</strong></div>",
    '<div class="flujo-kpi ok"><span>Descargas verificadas</span><strong>' + verificados + "</strong></div>"
  ].join("");
}

function flujoPintarMapa(nodos) {
  const caja = document.getElementById("flujoMapa");
  if (!caja) return;
  caja.innerHTML = nodos.map(function (n) {
    return '<article class="flujo-nodo" data-estado="' + esc(n.estado) + '" data-nodo="' + esc(n.id) + '">'
      + '<span class="flujo-icono" aria-hidden="true">' + esc(n.icono) + "</span>"
      + '<div class="flujo-texto"><h4>' + esc(n.titulo) + "</h4><p>" + esc(n.detalle) + "</p></div>"
      + '<span class="flujo-chip">' + esc(n.chip) + "</span>"
      + "</article>";
  }).join("");
}

function flujoPintarFallos(eventos) {
  const caja = document.getElementById("flujoFallos");
  if (!caja) return;
  if (!eventos.ok) {
    caja.innerHTML = '<div class="flujo-vacio">No se pudo leer el registro: '
      + esc(eventos.error || "error") + "</div>";
    return;
  }
  const lista = (eventos.data.eventos || []).filter(function (e) {
    return e.severidad === "error" || e.severidad === "critico" || e.severidad === "aviso";
  }).slice(0, 14);

  if (!lista.length) {
    caja.innerHTML = '<div class="flujo-vacio">Sin fallos registrados. Todo lo que falle aparece acá con su detalle.</div>';
    return;
  }
  caja.innerHTML = lista.map(function (e) {
    const sev = e.severidad === "aviso" ? "aviso" : "error";
    return '<div class="flujo-fallo ' + sev + '">'
      + '<div class="flujo-fallo-cab">'
      + "<span>" + esc(hora(e.ts)) + "</span>"
      + "<span>" + esc(e.tipo || "?") + "</span>"
      + "<span>" + esc(e.origen || "?") + "</span>"
      + (e.ms ? "<span>" + esc(String(e.ms)) + " ms</span>" : "")
      + "</div>"
      + '<div class="flujo-fallo-msg">' + esc(e.mensaje || "") + "</div>"
      + (e.detalle ? '<div class="flujo-fallo-det">' + esc(e.detalle) + "</div>" : "")
      + "</div>";
  }).join("");
}

function flujoPintarPuente(termux) {
  const caja = document.getElementById("flujoPuenteEstado");
  if (!caja) return;
  caja.textContent = termux && termux.ok
    ? "puente activo · " + (termux.comandos || []).length + " comandos"
    : "puente sin respuesta";
  caja.className = "nota " + (termux && termux.ok ? "" : "inv-bajo");
}

/* ── terminal ───────────────────────────────────────────────────────────── */

function flujoBienvenida() {
  const t = document.getElementById("flujoTerminal");
  if (!t || t.childElementCount) return;
  flujoLinea("meta", "Consola conectada al puente de Termux. Escribe un comando o usa un atajo.");
  flujoLinea("meta", "Historial: ↑ ↓ · el puente corta a los 25 s y guarda todo en ~/fabrick-comandos.log");
}

function flujoLinea(clase, texto) {
  const t = document.getElementById("flujoTerminal");
  if (!t) return;
  const div = document.createElement("div");
  div.className = "t-bloque t-" + clase;
  div.textContent = texto;
  t.appendChild(div);
  t.scrollTop = t.scrollHeight;
}

function flujoEjecutar() {
  const campo = document.getElementById("flujoCmd");
  if (!campo) return;
  const cmd = campo.value.trim();
  if (!cmd) return;
  if (FLUJO.ocupado) {
    toast("Espera el comando anterior", "error");
    return;
  }
  if (!window.FabrickNative || typeof window.FabrickNative.termuxComando !== "function") {
    flujoLinea("error", "Esta versión no expone el comando libre; actualiza la APK.");
    return;
  }
  FLUJO.historial.push(cmd);
  if (FLUJO.historial.length > 60) FLUJO.historial.shift();
  FLUJO.hIdx = FLUJO.historial.length;

  flujoLinea("cmd", "$ " + cmd);
  FLUJO.ocupado = true;
  campo.value = "";
  try {
    const r = JSON.parse(window.FabrickNative.termuxComando(cmd));
    if (!r.ok) {
      FLUJO.ocupado = false;
      flujoLinea("error", r.error || "no se pudo enviar el comando");
    }
  } catch (e) {
    FLUJO.ocupado = false;
    flujoLinea("error", "no se pudo enviar: " + e);
  }
}

/** Lo llama FabriTermux.recibir cuando el resultado es de un comando libre. */
function flujoRecibir(r) {
  if (!r) return;
  FLUJO.ocupado = false;
  const meta = "rc=" + (r.rc === undefined ? "?" : r.rc)
    + " · " + (r.ms || r.total_ms || 0) + " ms";
  if (r.salida) flujoLinea("", r.salida);
  if (r.error) flujoLinea("error", r.error);
  if (!r.salida && !r.error) flujoLinea("meta", "(sin salida)");
  flujoLinea(r.ok ? "ok" : "error", (r.ok ? "✓ " : "✕ ") + meta);

  revision("flujo", r.ok ? "info" : "error",
    "comando libre: " + (r.cmd || "").slice(0, 120),
    meta + (r.error ? " · " + r.error : ""), r.ms || 0, "termux");
}


/** Rellena el selector de módulo instalado desde el propio núcleo. */
async function flujoCargarModulos() {
  const sel = document.getElementById("flujoModulo");
  const estado = document.getElementById("flujoModuloEstado");
  if (!sel) return;
  try {
    const r = await apiTarde("modulos", { accion: "listar" }, { maxMs: 15000 });
    if (!r.ok || !r.data || !Array.isArray(r.data.modulos)) {
      if (estado) estado.textContent = "Módulos no disponibles: " + ((r && r.error) || "?");
      return;
    }
    const modulos = r.data.modulos.filter(function (m) {
      return m && m.manifiesto && (m.manifiesto.id || m.manifiesto.nombre);
    });
    if (estado) estado.textContent = modulos.length + " módulo(s) instalado(s)";
    sel.innerHTML = '<option value="">— todos —</option>';
    modulos.forEach(function (m) {
      const id = m.manifiesto.id || m.manifiesto.nombre || "";
      const nombre = m.manifiesto.nombre || id;
      const estadoMod = m.estado || "";
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = nombre + " · " + estadoMod;
      sel.appendChild(opt);
    });
    if (FLUJO.modulo) sel.value = FLUJO.modulo;
  } catch (e) {
    if (estado) estado.textContent = "No se pudo leer módulos: " + String(e && e.message || e);
  }
}
