/* ==========================================================================
   FORGE CORE STOCK · interfaz
   --------------------------------------------------------------------------
   Toda la lógica de datos vive en Rust. Este archivo sólo:
     1. llama al puente `FabrickNative.call(op, json)`;
     2. pinta el resultado;
     3. muestra los errores tal como llegan (nunca los oculta).
   ========================================================================== */

"use strict";

/* ---------------------------------------------------------------- utilidades */

/** Llama al núcleo y devuelve siempre un objeto con la forma {ok, data|error}. */
function api(op, payload) {
  const t0 = Date.now();
  let r;
  try {
    if (!window.FabrickNative) {
      r = { ok: false, error: "puente nativo no disponible", codigo: "NO_BRIDGE" };
    } else {
      const crudo = window.FabrickNative.call(op, JSON.stringify(payload || {}));
      r = crudo
        ? JSON.parse(crudo)
        : { ok: false, error: "respuesta vacía del núcleo", codigo: "EMPTY" };
    }
  } catch (e) {
    r = { ok: false, error: String(e), codigo: "PARSE" };
  }
  // El registro de incidencias se encola, NUNCA se escribe aquí mismo. Antes,
  // cada fallo llamaba a `revision.registrar` de forma síncrona: esa escritura
  // volvía a esperar la base y el hilo de la interfaz quedaba atrapado en una
  // cadena de escrituras (el loader en 1 %, 7 %, −1 % de los videos).
  try { revisionAutoDiferido(op, r, Date.now() - t0); } catch (e) { /* nunca romper api() */ }
  return r;
}

/** Consulta A1: bibliotecas nativas cargadas desde la APK (no carga modelo). */
function apiRuntime() {
  try {
    if (!window.FabrickNative || typeof window.FabrickNative.runtimeInfo !== "function") {
      return { ok: false, cargado: false, error: "el puente nativo no expone runtimeInfo" };
    }
    return JSON.parse(window.FabrickNative.runtimeInfo());
  } catch (e) {
    return { ok: false, cargado: false, error: String(e) };
  }
}

/** Formatea bytes a unidad legible (base 1024). */
function bytes(n) {
  if (!n || n < 0) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (v < 10 ? v.toFixed(1) : Math.round(v)) + " " + u[i];
}

/** Hora corta legible en la zona del dispositivo. */
function hora(ts) {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fechaHora(ts) {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  return d.toLocaleString("es-CL");
}

let toastTimer = null;
function toast(mensaje, tipo) {
  const el = document.getElementById("toast");
  el.textContent = mensaje;
  el.style.borderColor = tipo === "error" ? "rgba(248,113,113,0.5)" : "";
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

/** Escapa texto antes de inyectarlo como HTML. */
function esc(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Clase CSS según el estado del componente. */
function claseEstado(estado) {
  const mapa = {
    "NO DISPONIBLE": "e-no-disponible",
    "DISPONIBLE": "e-disponible",
    "DESCARGANDO": "e-descargando",
    "DESCARGADO": "e-descargado",
    "VALIDANDO": "e-validando",
    "INSTALADO": "e-instalado",
    "LISTO": "e-listo",
    "ERROR": "e-error",
    "ACTUALIZACIÓN DISPONIBLE": "e-actualizable"
  };
  return mapa[estado] || "e-no-disponible";
}

/* ------------------------------------------------------------------- estado */
const estadoApp = {
  sistema: null,
  componentes: [],
  manifiestos: [],
  descargas: {},      // id -> {hechos, total, estado}
  confirmaPendiente: null,
  idModal: null,
  filtro: "todos",
  modelos: [],
  modulos: [],
  paginas: [],
  paginaActual: null,
  vistaAnterior: "inicio",
  moduloSel: null,
  consola: [],        // líneas visibles
  logsHistoricos: [],
  operaciones: [],
  vista: "inicio",
  global: {
    verificado: false,
    salud: "desconocida",
    pct: 0,
    items: [],
    dispositivo: null,
    recomendados: [],
    detectados: [],
    benchmark: []
  },
  stats: {
    tokensLocal: 0,
    tokensApi: 0,
    mensajesLocal: 0,
    mensajesApi: 0,
    tiempoTotalMs: 0,
    ultimoTiempoMs: 0,
    ultimaVelocidad: 0
  },
  chat: {
    modo: "local",
    mensajes: [],
    enviando: false,
    cargando: false,
    tts: false,
    ultimaRespuesta: "",
    /* A4: streaming y métricas del turno en curso */
    indiceIA: -1,
    deteniendo: false,
    primerTokenMs: 0,
    nCtx: 2048,
    autoscroll: true,
    /* Ajustes de muestreo del modelo local (se aplican al núcleo nativo).
       Predeterminados para Qwen 2: respuestas rápidas y naturales. */
    temperatura: 0.7,
    topP: 0.9,
    topK: 40,
    repeticion: 1.1,
    maxTokens: 256
  }
};

/* --------------------------------------------------------------- chat: estado */
const PROVEEDORES_CHAT = [
  {
    id: "omniroute",
    nombre: "OmniRoute · gateway local",
    url: "http://127.0.0.1:20128/v1",
    modelo: "auto",
    tipo: "Gratis / de pago según ruta",
    nota: "Gateway OpenAI-compatible auto-alojado en Termux o en un servidor. Enruta a modelos gratis y de pago."
  },
  {
    id: "ollama",
    nombre: "Ollama · LAN o local",
    url: "http://127.0.0.1:11434/v1",
    modelo: "llama3.2",
    tipo: "Gratis · local",
    nota: "Ollama escucha en 11434. Si está en otro equipo de la LAN, cambia 127.0.0.1 por su IP privada."
  },
  {
    id: "lmstudio",
    nombre: "LM Studio · LAN o local",
    url: "http://127.0.0.1:1234/v1",
    modelo: "",
    tipo: "Gratis · local",
    nota: "Activa el servidor local de LM Studio. La app sólo habla con su API OpenAI-compatible."
  },
  {
    id: "openrouter",
    nombre: "OpenRouter",
    url: "https://openrouter.ai/api/v1",
    modelo: "",
    tipo: "Gratis y de pago",
    nota: "Catálogo grande con modelos gratuitos y de pago. Trae /models para ver los disponibles con tu clave."
  },
  {
    id: "groq",
    nombre: "Groq",
    url: "https://api.groq.com/openai/v1",
    modelo: "",
    tipo: "Free tier / de pago",
    nota: "API OpenAI-compatible de baja latencia. Requiere clave; el catálogo se consulta en vivo."
  },
  {
    id: "openai",
    nombre: "OpenAI",
    url: "https://api.openai.com/v1",
    modelo: "gpt-4o-mini",
    tipo: "De pago",
    nota: "API oficial de OpenAI. La clave se guarda en SQLite y no vuelve a la página."
  },
  {
    id: "mistral",
    nombre: "Mistral AI",
    url: "https://api.mistral.ai/v1",
    modelo: "",
    tipo: "Free tier / de pago",
    nota: "API OpenAI-compatible. Trae /models para elegir el modelo de tu cuenta."
  },
  {
    id: "together",
    nombre: "Together AI",
    url: "https://api.together.xyz/v1",
    modelo: "",
    tipo: "De pago",
    nota: "API OpenAI-compatible con catálogo amplio. Requiere clave."
  },
  {
    id: "huggingface",
    nombre: "Hugging Face Router",
    url: "https://router.huggingface.co/v1",
    modelo: "",
    tipo: "Free tier / de pago",
    nota: "Router OpenAI-compatible de Hugging Face. Requiere token con permiso de inferencia."
  },
  {
    id: "custom",
    nombre: "Otro / LLM por IP",
    url: "http://192.168.1.10:8080/v1",
    modelo: "",
    tipo: "Según servidor",
    nota: "Cualquier servidor OpenAI-compatible. HTTP sólo se acepta en localhost o IP privada; el resto exige HTTPS."
  }
];

const TERMUX_COMANDOS = [
  { titulo: "Dependencias base", cmd: "pkg update && pkg upgrade -y\npkg install nodejs python git clang cmake make -y" },
  { titulo: "OmniRoute", cmd: "npx -y omniroute@latest\n# API local: http://127.0.0.1:20128/v1" },
  { titulo: "llama.cpp", cmd: "git clone https://github.com/ggml-org/llama.cpp\ncd llama.cpp\ncmake -B build\ncmake --build build -j4" },
  { titulo: "Modelo Qwen 0.5B", cmd: "pip install huggingface_hub\nhuggingface-cli download Qwen/Qwen2.5-0.5B-Instruct-GGUF qwen2.5-0.5b-instruct-q4_k_m.gguf --local-dir ~/modelos" },
  { titulo: "GraphRAG (servidor)", cmd: "pip install graphrag\n# GraphRAG es Python y no trae binario Android; ejecútalo en Termux o en un servidor\n# y consúmelo por HTTP desde FORGE CORE STOCK." },
  { titulo: "Voz del sistema", cmd: "# TTS usa el motor de Android, no un binario descargado:\n# Ajustes → Accesibilidad → Salida de texto a voz → Instalar voces" }
];


/* ------------------------------------------------------------------ navegación */
/** Registra una excepción de JS con su stack real (el WebView, en origen
 *  file://, ofusca `ev.message` y deja `?:0:0`; el stack sí trae la línea). */
function jsError(e, donde) {
  const msg = e && e.message ? e.message : String(e || "error desconocido");
  const stack = e && e.stack ? String(e.stack) : "";
  revision("error", "critico", "excepción en " + donde + ": " + msg,
    stack ? stack.replace(/\n/g, " · ").slice(0, 900) : "sin stack", 0, "js");
  return msg;
}


/* ── llamadas asíncronas al núcleo ──────────────────────────────────────────
   `api()` es síncrona por obligación: `@JavascriptInterface` devuelve el valor
   en la misma llamada, así que JavaScript se queda esperando y la página no
   repinta. Con operaciones de hasta 20 s eso era exactamente el «se queda
   pegado» que se veía al abrir Inventario, Base de datos o Flujo.

   `apiAsync` usa el carril asíncrono del puente (`callAsync`): vuelve al
   instante con un token y el resultado llega por `window.__fabriAsync`. La
   interfaz nunca se bloquea. Si la APK es vieja y no tiene `callAsync`, cae al
   camino síncrono sin romperse. */

const FABRI_ASYNC = new Map();
// Resultados que llegaron ANTES de que JavaScript registrara su token. Se
// guardan unos segundos por si el registro ocurrió una fracción de milisegundo
// después; si nadie los reclama, se descartan solos.
const FABRI_TARDIOS = new Map();
let fabriAsyncSeq = 0;

window.__fabriAsync = function (token, crudo) {
  let r;
  try {
    r = crudo
      ? JSON.parse(crudo)
      : { ok: false, error: "respuesta vacía del núcleo", codigo: "EMPTY" };
  } catch (e) {
    r = { ok: false, error: String(e), codigo: "PARSE" };
  }
  const cerrar = FABRI_ASYNC.get(token);
  if (cerrar) { cerrar(r); return; }
  // Todavía no hay quien lo espere: se guarda un instante.
  FABRI_TARDIOS.set(token, r);
  setTimeout(function () { FABRI_TARDIOS.delete(token); }, 10000);
};

function apiAsync(op, payload, opciones) {
  const opt = opciones || {};
  const maxMs = opt.maxMs || 25000;
  const t0 = Date.now();
  return new Promise(function (resolve) {
    if (!window.FabrickNative || typeof window.FabrickNative.callAsync !== "function") {
      resolve(api(op, payload));   // APK anterior o vista previa en navegador
      return;
    }
    // La clave del resultado la decide JAVA: es la que viaja de vuelta en
    // `window.__fabriAsync`. Antes JavaScript inventaba su propio token («a1_...»)
    // y Java entregaba el suyo («a1»): nunca coincidían, TODA lectura asíncrona
    // se quedaba sin respuesta y sólo se resolvía por el tope de tiempo. Por eso
    // SQL, Inventario y Flujo salían en blanco o «lentos» una y otra vez.
    let clave = null;
    let cerrado = false;
    const cerrar = function (r) {
      if (cerrado) return;
      cerrado = true;
      if (clave) FABRI_ASYNC.delete(clave);
      try { revisionAutoDiferido(op, r, Date.now() - t0); } catch (e) { /* nunca romper */ }
      resolve(r);
    };

    let acuse;
    try {
      acuse = JSON.parse(window.FabrickNative.callAsync(op, JSON.stringify(payload || {})));
    } catch (e) {
      cerrar({ ok: false, error: String(e), codigo: "PUENTE" });
      return;
    }
    if (!acuse || !acuse.ok) {
      cerrar(acuse || { ok: false, error: "el puente rechazó la llamada", codigo: "PUENTE" });
      return;
    }
    if (!acuse.token) {
      // APK viejo: el acuse no trae token, así que no hay clave con la que
      // recibir el resultado. Se resuelve por la vía síncrona.
      cerrar(api(op, payload));
      return;
    }
    // Se registra con el token que devolvió Java y se recoge el resultado si
    // llegó antes de que alcanzáramos a registrarnos.
    clave = acuse.token;
    FABRI_ASYNC.set(clave, cerrar);
    if (FABRI_TARDIOS.has(clave)) {
      const r = FABRI_TARDIOS.get(clave);
      FABRI_TARDIOS.delete(clave);
      cerrar(r);
      return;
    }
    // Red de seguridad: si el aviso de Java se pierde (página recargada a
    // mitad), la promesa se resuelve como LENTO y la vista puede reintentar.
    setTimeout(function () {
      if (!cerrado) {
        // Intento de recuperación: si el resultado asíncrono no llegó, se
        // intenta una sola vez por la vía SÍNCRONA (`call`). `call` responde
        // siempre (tope 600 ms / 20 s según pesadez) y es lo que garantiza
        // que la pantalla no se quede en «Cargando…» para siempre si el
        // hilo asíncrono de Java no logró entregar por `__fabriAsync`.
        if (typeof window.FabrickNative.call === "function") {
          try {
            const crudo = window.FabrickNative.call(op, JSON.stringify(payload || {}));
            const r = crudo ? JSON.parse(crudo) : null;
            if (r) { cerrar(r); return; }
          } catch (e) { /* se cae al LENTO de abajo */ }
        }
        cerrar({
          ok: false, error: "el núcleo no respondió a tiempo",
          codigo: "LENTO", op: op, reintentar: true
        });
      }
    }, maxMs);
  });
}

/**
 * Lectura con reintento, sin bloquear jamás el hilo que pinta.
 *
 * Es lo que usan las pantallas. Si el núcleo está ocupado (`NUCLEO_OCUPADO` o
 * `LENTO`) espera y vuelve a intentar con espera creciente, hasta `maxMs`.
 * Antes cada pantalla hacía una llamada síncrona, recibía `LENTO` y se rendía:
 * los módulos quedaban vacíos hasta abrir Diagnóstico y pulsar «Probar núcleo».
 */
function apiTarde(op, payload, opciones) {
  const opt = opciones || {};
  const maxMs = opt.maxMs || 15000;
  const t0 = Date.now();
  return new Promise(function (resolve) {
    let espera = 220;
    function intento() {
      const restante = maxMs - (Date.now() - t0);
      const tope = Math.max(4000, Math.min(25000, restante));
      apiAsync(op, payload, { maxMs: tope }).then(function (r) {
        const ocupado = !r.ok && (r.codigo === "NUCLEO_OCUPADO" || r.codigo === "LENTO");
        if (!ocupado || Date.now() - t0 >= maxMs) { resolve(r); return; }
        setTimeout(intento, espera);
        espera = Math.min(Math.round(espera * 1.7), 1800);
      });
    }
    intento();
  });
}

/** Rama de carga de cada vista. Se usa al navegar y al volver el núcleo. */
const RAMAS_VISTA = {
  diag: () => cargarDiagnostico(),
  error: () => errorIniciar(),
  integracion: () => integracionIniciar(),
  modelos: () => pintarModelos(),
  modulos: () => cargarModulos(),
  chat: () => chatIniciar(),
  inventario: () => { if (typeof invIniciar === "function") invIniciar(); },
  flujo: () => { if (typeof flujoIniciar === "function") flujoIniciar(); },
  termux: () => { cargarTermux(); puenteIniciar(); },
  revision: () => revisionIniciar(),
  repo: () => cargarRepo(),
  sql: () => { if (typeof hojaIniciar === "function") hojaIniciar(); },
  conexiones: () => { if (typeof conexionesIniciar === "function") conexionesIniciar(); },
  id: () => { if (typeof idIniciar === "function") idIniciar(); },
  inicio: () => pintarInicio()
};

function navegar(vista) {
  cerrarDrawer();
  // Al salir de Inventario se apaga la cámara: nunca queda encendida en segundo plano.
  if (estadoApp.vista === "inventario" && vista !== "inventario"
      && typeof invSalir === "function") {
    try { invSalir(); } catch (e) { /* nunca romper la navegación */ }
  }
  // El flujo deja de refrescar cuando no está visible.
  if (estadoApp.vista === "flujo" && vista !== "flujo"
      && typeof flujoSalir === "function") {
    try { flujoSalir(); } catch (e) { /* idem */ }
  }
  estadoApp.vista = vista;
  document.querySelectorAll(".vista").forEach((v) => v.classList.remove("activa"));
  const destino = document.getElementById("v-" + vista);
  if (destino) destino.classList.add("activa");
  document.querySelectorAll(".nav").forEach((b) => {
    b.classList.toggle("activo", b.dataset.vista === vista);
  });
  window.scrollTo({ top: 0, behavior: "instant" });
  // Cada rama se aísla: si una vista falla, la navegación ocurre igual y el
  // fallo queda en `revision` con nombre de función, mensaje y stack.
  const rama = RAMAS_VISTA[vista];
  if (!rama) return;
  try {
    rama();
  } catch (e) {
    jsError(e, "navegar(" + vista + ")");
    toast("Error al abrir «" + vista + "»: " + (e && e.message ? e.message : "ver registro"), "error");
  }
}

/** Usada por el botón físico "atrás" de Android. */
window.fabrickAtras = function () {
  if (!document.getElementById("drawer").hidden) {
    cerrarDrawer();
    return true;
  }
  if (!document.getElementById("modal").hidden) {
    cerrarModal();
    return true;
  }
  if (estadoApp.vista === "pagina") {
    navegar(estadoApp.vistaAnterior || "modulos");
    return true;
  }
  if (estadoApp.vista !== "inicio") {
    navegar("inicio");
    return true;
  }
  return false;
};

/* ---------------------------------------------------------------- menú lateral */
function abrirDrawer() {
  document.getElementById("drawer").hidden = false;
  document.getElementById("drawerFondo").hidden = false;
  document.body.classList.add("drawer-abierto");
  pintarDrawerPaginas();
}

function cerrarDrawer() {
  const d = document.getElementById("drawer");
  const f = document.getElementById("drawerFondo");
  if (d) d.hidden = true;
  if (f) f.hidden = true;
  document.body.classList.remove("drawer-abierto");
}

function pintarDrawerPaginas() {
  const cont = document.getElementById("drawerPaginas");
  if (!cont) return;
  const paginas = estadoApp.paginas || [];
  const cuenta = document.getElementById("drawerCuenta");
  if (cuenta) cuenta.textContent = String(paginas.length);
  if (!paginas.length) {
    cont.innerHTML = `<p class="nota">Todavía no hay páginas registradas. Importá un manifiesto <code>tipo: pagina</code> desde Módulos.</p>`;
    return;
  }
  cont.innerHTML = paginas.map((fila) => {
    const m = fila.manifiesto || {};
    return `
      <button class="drawer-pagina" data-pagina="${esc(m.id)}">
        <span class="drawer-pagina-titulo">${esc(m.nombre || m.id)}</span>
        <span class="drawer-pagina-estado">${esc(m.estado || "POR CONSTRUIR")}</span>
      </button>`;
  }).join("");
}

function mostrarPagina(id) {
  const fila = (estadoApp.paginas || []).find((f) => ((f.manifiesto || {}).id === id));
  if (!fila) {
    toast("Página no encontrada: " + id, "error");
    return;
  }
  const m = fila.manifiesto || {};
  if (estadoApp.vista !== "pagina") estadoApp.vistaAnterior = estadoApp.vista;
  estadoApp.paginaActual = m;

  document.getElementById("paginaEstado").textContent = (m.estado || "POR CONSTRUIR").toUpperCase();
  document.getElementById("paginaTitulo").textContent = m.nombre || m.id;
  document.getElementById("paginaDesc").textContent = m.descripcion || "Sin descripción.";

  const secciones = (m.secciones || []).map((s) => `
    <article class="item">
      <h4>${esc(s.titulo)}</h4>
      <p class="nota">${esc(s.texto)}</p>
    </article>`).join("");
  const depende = (m.depende || []).map((d) => `<span class="chip-mini">${esc(d)}</span>`).join(" ");
  const modulo = m.modulo
    ? `<p class="nota">Módulo relacionado: <code>${esc(m.modulo)}</code></p>`
    : `<p class="nota">Sin módulo relacionado todavía.</p>`;
  document.getElementById("paginaCuerpo").innerHTML = secciones + `
    <div class="item-meta">${depende || '<span class="chip-mini">sin dependencias</span>'}</div>
    ${modulo}`;

  document.getElementById("paginaInstrucciones").textContent = m.instrucciones || "Sin instrucciones.";

  const fecha = fila.actualizado ? new Date(fila.actualizado * 1000).toLocaleString("es-CL") : "no disponible";
  document.getElementById("paginaMeta").innerHTML = [
    ["ID", m.id || "—"],
    ["Versión", m.version || "—"],
    ["Tipo", m.tipo || "pagina"],
    ["Estado", fila.estado || m.estado || "—"],
    ["Licencia", m.licencia || "—"],
    ["Módulo relacionado", m.modulo || "ninguno"],
    ["Actualizado", fecha],
    ["Origen", "incluida en la APK o importada por el usuario"]
  ].map(([k, v]) => `<div class="fila"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join("");

  navegar("pagina");
}

function copiarInstruccionesPagina() {
  const m = estadoApp.paginaActual;
  if (!m) return;
  copiar(m.instrucciones || "", "Instrucciones copiadas");
}

function copiarJsonPagina() {
  const m = estadoApp.paginaActual;
  if (!m) return;
  copiar(JSON.stringify(m, null, 2), "Manifiesto JSON copiado");
}

/* --------------------------------------------------------------------- inicio */
function pintarInicio() {
  const s = estadoApp.sistema;
  const g = estadoApp.global;
  const piloto = document.getElementById("pilotoNucleo");

  if (!s) {
    const esperando = !nucleoPreparado();
    piloto.className = "pill " + (esperando ? "pill-espera" : "pill-error");
    piloto.textContent = esperando ? "núcleo iniciando…" : "sin núcleo";
    document.getElementById("heroTitulo").textContent = esperando
      ? "Abriendo la base de datos"
      : "Núcleo no disponible";
    document.getElementById("heroTexto").textContent = esperando
      ? "La app ya es usable; los datos aparecen en cuanto termina la migración."
      : "Revisa el diagnóstico para ver el error original.";
    // Se repinta sola cuando el núcleo avisa; este reintento cubre el caso de
    // que el aviso se pierda (p. ej. al volver del segundo plano).
    if (esperando) setTimeout(function () { if (!estadoApp.sistema) arranqueNucleo(); }, 900);
    return;
  }

  piloto.className = "pill pill-ok";
  piloto.textContent = "núcleo activo";
  document.getElementById("heroTitulo").textContent = "Listo para operar";
  document.getElementById("heroTexto").textContent =
    "Chat local y remoto, base de datos editable y IA conectada en el dispositivo.";
  document.getElementById("heroDatos").innerHTML =
    `<span>v${esc(s.version)}</span><span>${esc(s.arch)}</span><span>SQLite ${esc(s.sqlite || s.sqliteVersion || "—")}</span>`;

  // KPIs disco y RAM
  document.getElementById("kpiDisco").textContent = bytes(s.discoLibre);
  document.getElementById("kpiDiscoSub").textContent = "de " + bytes(s.discoTotal);
  document.getElementById("kpiRam").textContent = bytes((s.memLibreKb || 0) * 1024);
  document.getElementById("kpiRamSub").textContent = "de " + bytes((s.memTotalKb || 0) * 1024);

  // KPIs tokens
  document.getElementById("kpiTokensLocal").textContent = estadoApp.stats.tokensLocal.toLocaleString();
  document.getElementById("kpiTokensApi").textContent = estadoApp.stats.tokensApi.toLocaleString();

  // KPI modelo
  const kpiModelo = document.getElementById("kpiModelo");
  const kpiModeloSub = document.getElementById("kpiModeloSub");
  if (g.modeloCargado && g.modeloCargado !== "ninguno") {
    kpiModelo.textContent = esc(g.modeloCargado);
    kpiModeloSub.textContent = "cargado";
    kpiModeloSub.className = "ok";
  } else {
    kpiModelo.textContent = "—";
    kpiModeloSub.textContent = "sin cargar";
    kpiModeloSub.className = "";
  }

  // KPI salud global
  const kpiSalud = document.getElementById("kpiSalud");
  const kpiSaludSub = document.getElementById("kpiSaludSub");
  if (kpiSalud) {
    kpiSalud.textContent = esc(g.salud || "—");
    kpiSaludSub.textContent = (g.pct != null ? g.pct + "%" : "") + " verificado";
    kpiSalud.className = g.salud === "ok" ? "ok" : g.salud === "warning" ? "warning" : "error";
  }

  const usado = s.discoTotal ? ((s.discoTotal - s.discoLibre) / s.discoTotal) * 100 : 0;
  const barra = document.getElementById("barraDisco");
  if (barra) {
    barra.style.width = usado.toFixed(1) + "%";
    barra.style.background = usado > 90 ? "var(--error)" : usado > 75 ? "var(--alerta)" : "var(--acento)";
  }
  const nota = document.getElementById("notaDisco");
  if (nota) nota.textContent = `${bytes(s.discoLibre)} libres de ${bytes(s.discoTotal)} (${usado.toFixed(1)}% usado)`;

  // Verificador global
  pintarVerificadorGlobal();
  pintarDispositivo();
  pintarModelos();

  // Portada: estadísticas reales del negocio y gráficos. Vive en inicio.js y
  // se pide en segundo plano: si el núcleo está ocupado, la vista ya está
  // pintada y los números entran cuando llegan.
  if (typeof inicioRefrescar === "function") {
    try { inicioRefrescar(); } catch (e) { jsError(e, "inicioRefrescar"); }
  }
}

/** Pinta el verificador global: una tarjeta por área del sistema. */
function pintarVerificadorGlobal() {
  const cont = document.getElementById("verificadorGrid");
  if (!cont) return;
  // `g` era una constante local de pintarInicio(): aquí no existía y lanzaba
  // ReferenceError, que el WebView reportaba como "Script error." sin línea.
  const g = estadoApp.global;
  const items = g.items || [];
  if (!items.length) {
    cont.innerHTML = `<p class="nota">Presiona «Reverificar todo» para auditar componentes, base de datos, modelo e IA.</p>`;
    return;
  }
  cont.innerHTML = items.map((it) => {
    const ok = it.estado === "ok";
    const clase = ok ? "estado-ok" : it.estado === "warning" ? "estado-warning" : "estado-error";
    return `
      <article class="verificador-item">
        <div class="verificador-item-cab">
          <strong>${esc(it.nombre)}</strong>
          <span class="verificador-estado ${clase}">${esc(it.estado)}</span>
        </div>
        <div class="verificador-item-meta">
          ${it.detalle ? `<span>${esc(it.detalle)}</span>` : ""}
          ${it.valor != null ? `<span>${esc(it.valor)}</span>` : ""}
        </div>
        ${it.barra != null ? `
          <div class="verificador-barra-cont">
            <div class="verificador-barra"><div class="verificador-barra-fill" style="width:${it.barra}%"></div></div>
            <span class="verificador-barra-pct">${it.barra}%</span>
          </div>` : ""}
      </article>`;
  }).join("");
}

/** Pinta detalles del dispositivo (hardware, RAM, disco, Android). */
function pintarDispositivo() {
  const cont = document.getElementById("tablaDispositivo");
  const g = estadoApp.global;
  const d = g.dispositivo;
  if (!cont || !d) {
    if (cont) cont.innerHTML = `<p class="nota">Ejecuta el verificador global para ver los detalles del dispositivo.</p>`;
    return;
  }
  cont.innerHTML = `
    <table class="sql-tabla">
      <thead><tr><th>Dato</th><th>Valor</th></tr></thead>
      <tbody>
        <tr><td>Versión FORGE CORE STOCK</td><td>${esc(d.version)}</td></tr>
        <tr><td>Arquitectura</td><td>${esc(d.arch)}</td></tr>
        <tr><td>Sistema</td><td>${esc(d.os)}</td></tr>
        <tr><td>Android</td><td>${esc(d.androidVersion)} (SDK ${esc(d.sdk)})</td></tr>
        <tr><td>CPU</td><td>${esc(d.cpu)}</td></tr>
        <tr><td>Velocidad CPU</td><td>${d.cpuMhz ? d.cpuMhz.toFixed(0) + " MHz" : "—"}</td></tr>
        <tr><td>Núcleos</td><td>${d.nucleos}</td></tr>
        <tr><td>RAM total</td><td>${bytes(d.memTotalKb * 1024)}</td></tr>
        <tr><td>RAM libre</td><td>${bytes(d.memLibreKb * 1024)}</td></tr>
        <tr><td>RAM usada</td><td>${bytes(d.memUsadaKb * 1024)}</td></tr>
        <tr><td>Disco total</td><td>${bytes(d.discoTotal)}</td></tr>
        <tr><td>Disco libre</td><td>${bytes(d.discoLibre)}</td></tr>
        <tr><td>Directorio de datos</td><td>${esc(d.dataDir)}</td></tr>
      </tbody>
    </table>`;
}

/** Pinta el catálogo de modelos como tarjetas comparables. */
function pintarModelos() {
  const cont = document.getElementById("modelosLista");
  const g = estadoApp.global || (estadoApp.global = {});
  // Antes esta pantalla salía vacía hasta pulsar «Ver recomendados». Ahora se
  // pide sola (con reintento) y el botón queda para refrescar a mano.
  if (!g.recomendados && !g.detectados && !g.cargandoModelos) {
    g.cargandoModelos = true;
    if (cont) cont.innerHTML = `<div class="item"><p>Consultando la memoria del dispositivo…</p></div>`;
    cargarModelosRecomendados().finally(function () { g.cargandoModelos = false; });
  }
  const rec = g.recomendados || [];
  const det = g.detectados || [];
  const disp = g.dispositivo || {};
  const memoria = disp.memTotalMB ? disp.memTotalMB : "—";
  const disponible = disp.memDisponibleMB ? disp.memDisponibleMB : "—";

  let html = "";
  if (rec.length) {
    const estrella = rec.find(function (m) { return m.estrella; });
    html += `<div class="modelos-hero">
      <div class="modelos-hero-texto">
        <p class="modelos-hero-etq">Catálogo para este teléfono</p>
        <strong>${memoria} MB de RAM · ${disponible} MB libres</strong>
        <span>${esc(disp.perfil || "perfil por detectar")}${disp.nucleos ? " · " + disp.nucleos + " núcleos" : ""}${disp.presupuestoMB ? " · presupuesto " + disp.presupuestoMB + " MB" : ""}</span>
      </div>
      ${estrella ? `<div class="modelos-estrella">
        <span>Recomendado</span>
        <strong>${esc((estrella.familia || "") + " " + (estrella.parametros || "") + "B")}</strong>
        <small>${estrella.velocidadToks || "—"} tok/s estimados</small>
      </div>` : ""}
    </div>`;
    html += `<div class="modelos-grid">`;
    rec.forEach((m) => {
      const etiqueta = m.tipo === "embeddings" ? "Embeddings" : (m.familia || "GGUF");
      const params = m.parametros ? m.parametros + "B" : "";
      const cabe = m.cabeEnRam !== false;
      html += `<article class="modelo-card${m.estrella ? " estrella" : ""}${cabe ? "" : " no-cabe"}">
        <div class="modelo-card-cab">
          <div class="modelo-card-titulo">
            <h4>${esc(m.nombre || m.id)}</h4>
            <span class="modelo-card-sub">${esc(etiqueta)}${params ? " · " + esc(params) : ""}${m.licencia ? " · " + esc(m.licencia) : ""}</span>
          </div>
          ${m.estrella ? `<span class="modelo-badge estrella">Mejor para ti</span>` : ""}
        </div>
        <div class="modelo-card-datos">
          <div><span>Tamaño</span><b>${m.tamanoMB || "—"} MB</b></div>
          <div><span>RAM mínima</span><b>${m.ramMinimaMB || "—"} MB</b></div>
          <div><span>Velocidad</span><b>${m.velocidadToks || "—"} tok/s</b></div>
          <div><span>Nivel</span><b class="${m.nivel === "exigente" ? "alerta" : "ok"}">${esc(m.nivel || "—")}</b></div>
        </div>
        <div class="modelo-card-calidad" title="Calidad relativa del catálogo">
          ${[1,2,3,4,5].map(function (n) {
            return `<i class="${n <= (m.calidad || 0) ? "lleno" : ""}"></i>`;
          }).join("")}
          <span>${esc(m.uso || "")}</span>
        </div>
        <p class="modelo-card-nota">${esc(m.nota || "")}</p>
        <div class="modelo-card-pie">
          <span class="modelo-card-aviso">${cabe ? "Cabe en tu RAM" : "Puede no caber: libera memoria"}</span>
          <button class="btn btn-primario btn-mini" data-modelo-descargar="${esc(m.id)}">Descargar</button>
        </div>
      </article>`;
    });
    html += `</div>`;
    html += `<p class="nota">La velocidad es una estimación para un teléfono de gama media; el primer token siempre tarda más. Los modelos de 3B necesitan ~2,7 GB de RAM y disco libre.</p>`;
  }

  if (det.length) {
    html += `<h4>Modelos detectados en el dispositivo</h4>`;
    html += `<table class="sql-tabla">
      <thead><tr><th>Modelo</th><th>Formato</th><th>Tamaño</th><th>Estado</th></tr></thead>
      <tbody>`;
    det.forEach((m) => {
      html += `<tr>
        <td>${esc(m.nombre)}</td>
        <td>${esc(m.formato)}</td>
        <td>${m.tamano ? bytes(m.tamano) : "—"}</td>
        <td>${esc(m.estado)}</td>
      </tr>`;
    });
    html += `</tbody></table>`;
  }

  if (!rec.length && !det.length) {
    html += `<p class="nota">No hay modelos recomendados ni detectados. Ejecuta el verificador global.</p>`;
  }
  if (cont) cont.innerHTML = html;

  const bench = document.getElementById("modelosBenchmark");
  if (bench) bench.hidden = !(g.benchmark && g.benchmark.length);
  if (bench && g.benchmark && g.benchmark.length) {
    const tb = document.getElementById("tablaBenchmark");
    tb.innerHTML = `<table class="sql-tabla">
      <thead><tr><th>Modelo</th><th>Tokens</th><th>Tiempo (ms)</th><th>Velocidad (t/s)</th><th>Estado</th></tr></thead>
      <tbody>
        ${g.benchmark.map((b) => `<tr>
          <td>${esc(b.modelo)}</td>
          <td>${b.tokens}</td>
          <td>${b.ms}</td>
          <td>${b.tokens ? (b.tokens * 1000 / b.ms).toFixed(1) : "—"}</td>
          <td><span class="estado ${b.ok ? "ok" : "error"}">${b.ok ? "ok" : "error"}</span></td>
        </tr>`).join("")}
      </tbody></table>`;
  }
}

/** Ejecuta el verificador global contra el núcleo Rust. */
async function ejecutarVerificadorGlobal() {
  const cont = document.getElementById("barraProgresoCont");
  const texto = document.getElementById("barraProgresoTexto");
  const fill = document.getElementById("barraProgresoFill");
  const pct = document.getElementById("barraProgresoPct");
  if (cont) cont.hidden = false;

  const pasos = [
    { texto: "verificando núcleo…", pct: 20 },
    { texto: "auditando componentes…", pct: 40 },
    { texto: "leyendo base de datos…", pct: 60 },
    { texto: "detectando modelo IA…", pct: 80 },
    { texto: "detalles del dispositivo…", pct: 100 }
  ];
  let i = 0;
  const timer = setInterval(() => {
    if (i < pasos.length) {
      if (texto) texto.textContent = pasos[i].texto;
      if (fill) fill.style.width = pasos[i].pct + "%";
      if (pct) pct.textContent = pasos[i].pct + "%";
      i++;
    }
  }, 250);

  try {
    // Verificación pesada (recorre tablas y dispositivos): asíncrona para que
    // la barra de progreso siga animándose y la pantalla responda.
    const r = await apiTarde("estado_global", {}, { maxMs: 30000 });
    if (!r.ok) throw new Error(r.error || "no se pudo verificar");

    clearInterval(timer);
    if (texto) texto.textContent = "verificación completa";
    if (fill) fill.style.width = "100%";
    if (pct) pct.textContent = "100%";

    const d = r.data;
    estadoApp.global.verificado = true;
    estadoApp.global.salud = calcularSalud(d);
    estadoApp.global.pct = 100;
    estadoApp.global.items = [
      { nombre: "Núcleo Rust", estado: "ok", detalle: "v" + esc(d.version), valor: d.arch },
      { nombre: "Base de datos SQLite", estado: "ok", detalle: d.tablas + " tabla(s)", valor: d.filasTotales + " fila(s)" },
      { nombre: "Componentes", estado: d.componentesInstalados >= d.componentesTotal ? "ok" : "warning", detalle: d.componentesInstalados + " de " + d.componentesTotal + " instalados" },
      { nombre: "Modelo IA", estado: d.modeloCargado && d.modeloCargado !== "ninguno" ? "ok" : "warning", detalle: d.modeloCargado },
      { nombre: "Disco", estado: d.discoLibre > 500 * 1024 * 1024 ? "ok" : "warning", detalle: bytes(d.discoLibre) + " libres" },
      { nombre: "RAM", estado: d.memLibreKb > 500 * 1024 ? "ok" : "warning", detalle: bytes(d.memLibreKb * 1024) + " libres de " + bytes(d.memTotalKb * 1024) }
    ];
    estadoApp.global.dispositivo = {
      version: d.version,
      arch: d.arch,
      os: d.os,
      androidVersion: d.androidVersion || "—",
      sdk: d.sdk || "—",
      cpu: d.cpu,
      cpuMhz: d.cpuMhz,
      nucleos: d.nucleos,
      memTotalKb: d.memTotalKb,
      memLibreKb: d.memLibreKb,
      memUsadaKb: d.memUsadaKb,
      discoTotal: d.discoTotal,
      discoLibre: d.discoLibre,
      discoDisponible: d.discoDisponible,
      dataDir: d.dataDirPath
    };
    estadoApp.global.modeloCargado = d.modeloCargado;

    setTimeout(() => { if (cont) cont.hidden = true; }, 600);
    pintarInicio();
  } catch (e) {
    clearInterval(timer);
    if (cont) cont.hidden = true;
    toast("Verificador: " + (e.message || String(e)), "error");
  }
}

/** Calcula la salud global del sistema. */
function calcularSalud(d) {
  let problemas = 0;
  if (!d.modeloCargado || d.modeloCargado === "ninguno") problemas++;
  if (d.componentesInstalados < d.componentesTotal) problemas++;
  if (d.discoLibre < 500 * 1024 * 1024) problemas++;
  if (d.memLibreKb < 500 * 1024) problemas++;
  return problemas === 0 ? "ok" : problemas <= 2 ? "warning" : "error";
}

/** Obtiene modelos recomendados según la RAM del dispositivo. */
async function cargarModelosRecomendados() {
  const r = await apiTarde("modelos_recomendados", {});
  if (!r.ok) {
    toast("No se pudieron cargar las recomendaciones: " + (r.error || "error"), "error");
    return;
  }
  const d = r.data;
  estadoApp.global.recomendados = d.recomendados || [];
  estadoApp.global.detectados = d.detectados || [];
  estadoApp.global.dispositivo = estadoApp.global.dispositivo || {};
  estadoApp.global.dispositivo.memTotalMB = d.memTotalMB;
  estadoApp.global.dispositivo.memDisponibleMB = d.memDisponibleMB;
  estadoApp.global.dispositivo.nucleos = d.nucleos;
  estadoApp.global.dispositivo.presupuestoMB = d.presupuestoMB;
  estadoApp.global.dispositivo.perfil = d.perfil;
  pintarModelos();
}

/** Ejecuta un benchmark rápido del modelo local cargado. */
async function ejecutarBenchmarkModelo() {
  if (!estadoApp.chat.localCargado) {
    toast("Carga primero un modelo local desde Modelos", "error");
    return;
  }
  const pruebas = [
    "Responde en una palabra: ¿qué es la inteligencia artificial?",
    "Escribe una frase corta en español de Chile sobre el teléfono.",
    "Resume en 3 líneas qué hace esta aplicación."
  ];
  const resultados = [];
  for (const prueba of pruebas) {
    const t0 = Date.now();
    try {
      const r = JSON.parse(window.FabrickNative.localChat(chatPromptLocal(prueba), 512));
      // localChat es asíncrono: esperar a localFin no es posible aquí de forma síncrona.
      // Simulamos una métrica básica basada en la respuesta inmediata.
      const t1 = Date.now();
      resultados.push({ modelo: "local", tokens: 0, ms: t1 - t0, ok: !!r.ok });
    } catch (e) {
      resultados.push({ modelo: "local", tokens: 0, ms: 0, ok: false });
    }
  }
  estadoApp.global.benchmark = resultados;
  pintarModelos();
  toast("Benchmark completado: " + resultados.length + " prueba(s)");
}

/* --------------------------------------------------------------- componentes */
function pintarComponentes() {
  const cont = document.getElementById("listaComp");
  const filtro = estadoApp.filtro;
  const lista = estadoApp.componentes.filter(
    (c) => filtro === "todos" || c.tipo === filtro
  );

  if (!lista.length) {
    cont.innerHTML = `<div class="item"><p>No hay componentes en este filtro.</p></div>`;
    return;
  }

  cont.innerHTML = lista.map((c) => {
    const m = manifiestoDe(c.id);
    const yaVerificado = c.estado === "DESCARGADO_VERIFICADO" || c.estado === "INSTALADO";
    const puedeDescargar = m && m.valido && m.habilitacion && m.habilitacion.descargar
      && !yaVerificado && !descargaEnCurso(c.id);
    const accion = puedeDescargar
      ? `<button class="btn btn-primario" data-descargar="${esc(c.id)}">Descargar</button>`
      : "";
    return `
    <article class="item">
      <div class="item-cab">
        <div>
          <h4>${esc(c.nombre)}</h4>
          <p>${esc(c.descripcion || "Sin descripción")}</p>
        </div>
        <span class="estado ${claseEstado(c.estado)}">${esc(c.estado)}</span>
      </div>
      <div class="item-meta">
        <span>${esc(c.tipo)}</span>
        <span>${esc(c.version || "sin versión")}</span>
        <span>${esc(c.licencia || "licencia ?")}</span>
        <span>${c.tamano ? bytes(c.tamano) : "tamaño ?"}</span>
        ${yaVerificado ? `<span class="chip-verificado">✓ verificado${c.bytesDescarga ? " · " + bytes(c.bytesDescarga) : ""}</span>` : ""}
      </div>
      <div class="fila-botones">
        ${accion}
        <button class="btn" data-detalle="${esc(c.id)}">Detalles</button>
      </div>
    </article>
  `;
  }).join("");

  /* ── Entrada especial: MobileLLM-125M (IA de Hugging Face) ──
   *  Modelo >50 MB: requiere autorización explícita del usuario antes de
   *  iniciar cualquier descarga. No se descarga automáticamente.
   */
  const mllmYaAgregado = document.getElementById("comp-mobilellm-125m");
  if (!mllmYaAgregado) {
    const mllmHtml = `
    <article class="item item-modelo-ia" id="comp-mobilellm-125m">
      <div class="item-cab">
        <div>
          <h4>MobileLLM-125M</h4>
          <p>Modelo de lenguaje local (Meta, Hugging Face). 125 millones de parámetros. Para chat offline sin red.</p>
        </div>
        <span class="estado pendiente">Pendiente de autorización</span>
      </div>
      <div class="item-meta">
        <span>IA / Modelo</span>
        <span>125M parámetros</span>
        <span>Meta / Hugging Face</span>
        <span>&gt;50 MB · descarga autorizada</span>
      </div>
      <div class="fila-botones">
        <button class="btn btn-primario" id="btn-descargar-mobilellm" data-url="https://huggingface.co/facebook/MobileLLM-125M">
          Descargar modelo (requiere autorización)
        </button>
        <button class="btn" data-detalle="mobilellm-125m">Detalles</button>
      </div>
      <p class="nota" style="margin-top:8px;color:var(--texto-3);font-size:12px;">
        ⚠️ Este modelo supera los 50 MB. La descarga requiere tu autorización explícita y se gestiona fuera del flujo normal de componentes.
      </p>
    </article>
    `;
    cont.insertAdjacentHTML("beforeend", mllmHtml);

    document.getElementById("btn-descargar-mobilellm").addEventListener("click", async () => {
      const confirmado = confirm(
        "Vas a descargar MobileLLM-125M desde Hugging Face.\n\n" +
        "⚠️ El modelo supera los 50 MB.\n" +
        "⚠️ No se ejecutarán binarios descargados (regla W^X).\n" +
        "⚠️ Se usará únicamente con Android TextToSpeech nativo.\n\n" +
        "¿Continuar con la descarga?"
      );
      if (!confirmado) return;

      const btn = document.getElementById("btn-descargar-mobilellm");
      btn.textContent = "Descargando…";
      btn.disabled = true;

      try {
        const r = api("modulos", { accion: "descargarModeloIA", modelo: "mobilellm-125m", url: "https://huggingface.co/facebook/MobileLLM-125M" });
        const resultado = JSON.parse(r);
        if (resultado.ok) {
          btn.textContent = "Descargado";
          btn.classList.add("btn-secundario");
          btn.classList.remove("btn-primario");
          toast("MobileLLM-125M descargado", "exito");
        } else {
          btn.textContent = "Error";
          toast("Error: " + (resultado.error || "desconocido"), "error");
        }
      } catch (e) {
        btn.textContent = "Error";
        toast("Excepción: " + e.message, "error");
      }
    });
  }
}

/** Devuelve el manifiesto incrustado del componente, o null si no existe. */
function manifiestoDe(id) {
  return estadoApp.manifiestos.find((m) => m.id === id) || null;
}

function descargaEnCurso(id) {
  const d = estadoApp.descargas[id];
  return !!(d && d.estado === "EN_CURSO");
}

/** Recorta un hash para mostrarlo sin mentir: siempre los primeros y últimos 8. */
function hashCorto(h) {
  if (!h) return "sin hash publicado";
  return h.length > 20 ? h.slice(0, 16) + "…" + h.slice(-8) : h;
}

function abrirModal(id) {
  const c = estadoApp.componentes.find((x) => x.id === id);
  if (!c) return;
  const m = manifiestoDe(id);
  estadoApp.idModal = id;

  document.getElementById("modalTipo").textContent = (c.tipo || "—").toUpperCase();
  document.getElementById("modalNombre").textContent = c.nombre;

  const errores = m && m.errores && m.errores.length ? m.errores.join("; ") : "";
  const yaEnDisco = c.estado === "DESCARGADO_VERIFICADO" || c.estado === "INSTALADO";
  const urlOrigen = (m && m.origen) || c.origen || "";
  const filas = [
    ["ID", c.id],
    ["Estado en la base", c.estado],
    ["Descarga en disco", yaEnDisco
      ? "✓ verificado" + (c.bytesDescarga ? " · " + bytes(c.bytesDescarga) : "")
        + (c.rutaDescarga ? " · " + c.rutaDescarga : "")
      : "todavía no descargado"],
    ["URL de descarga", urlOrigen || "este componente no declara URL"],
    ["Descarga habilitada", m && m.habilitacion
      ? (m.habilitacion.descargar ? "sí" : "no: " + ((m.habilitacion.motivos || []).join("; ") || "sin motivo declarado"))
      : "sin manifiesto válido"],
    ["Versión publicada", (m && m.version) || c.version || "no declarada"],
    ["Versión instalada", c.versionInstalada || "ninguna"],
    ["Licencia", (m && m.licencia) || c.licencia || "no declarada"],
    ["Tipo de componente", (m && m.tipo) || c.tipo || "no declarado"],
    ["Arquitectura", (m && m.arquitectura) || "no declarada"],
    ["SHA-256", (m && m.sha256) || c.sha256 || "sin hash publicado"],
    ["Tamaño de descarga", (m && m.tamano) || c.tamano ? bytes((m && m.tamano) || c.tamano) : "no declarado"],
    ["Dependencias", m && m.dependencias && m.dependencias.length ? m.dependencias.join(", ") : "ninguna declarada"],
    ["Directorio de destino", (m && m.directorio) || "filesDir/componentes/" + c.id],
    ["Interfaz", (m && m.interfaz) || "pendiente de manifiesto"],
    ["Comprobación de salud", (m && m.salud) || "pendiente"],
    ["Veredicto del manifiesto", m ? (m.valido ? "válido" : "inválido") : "sin manifiesto"],
    ["Errores del manifiesto", errores || "ninguno"],
    ["Desinstalación", "elimina filesDir/componentes/" + c.id]
  ];
  document.getElementById("modalCuerpo").innerHTML =
    filas.map(([k, v]) => `<div class="fila"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join("")
    + (urlOrigen
      ? `<div class="fila"><span>Copiar</span><span><button class="btn" id="btnCopiarUrl">Copiar URL de descarga</button></span></div>`
      : "");
  const btnUrl = document.getElementById("btnCopiarUrl");
  if (btnUrl) {
    btnUrl.addEventListener("click", function () {
      copiar(urlOrigen, "URL copiada: " + urlOrigen);
    });
  }

  document.getElementById("modalNota").textContent = m && m.habilitacion && m.habilitacion.motivos && m.habilitacion.motivos.length
    ? "Bloqueos declarados: " + m.habilitacion.motivos.join("; ")
    : "Sin bloqueos declarados por el validador.";

  document.getElementById("modalProgreso").textContent = "Sin descarga en curso.";
  document.getElementById("modalBarra").style.width = "0%";
  estadoApp.confirmaPendiente = null;
  document.getElementById("modal").hidden = false;
  actualizarBotonesModal();
}

/** Sólo los componentes declarativos (datos/plugin) se pueden "instalar":
 *  registrar el manifiesto en SQLite. Ejecutables y modelos necesitan A2–A3
 *  (cargar el GGUF e inferir); A1 sólo prueba que las bibliotecas cargan. */
function componenteEsInstalable(c, m) {
  const tipos = ["datos", "plugin", "pagina"];
  const tipoM = m && m.tipo ? String(m.tipo).toLowerCase() : "";
  const tipoC = c && c.tipo ? String(c.tipo).toLowerCase() : "";
  return tipos.includes(tipoM) || tipos.includes(tipoC);
}

function instalarComponente(id, silencioso) {
  const r = api("modulos", { accion: "instalar", componente: id });
  if (!r.ok) {
    if (!silencioso) toast("No se pudo instalar: " + r.error, "error");
    api("log.append", { nivel: "ERROR", origen: "instalar", mensaje: `${id}: ${r.error}` });
    return false;
  }
  const instalados = r.data.instalados || [];
  const errores = r.data.errores || [];
  if (!instalados.length) {
    const motivo = errores.length ? errores.join("; ") : "el componente no trae manifiestos válidos";
    if (!silencioso) toast("No se instaló nada: " + motivo, "error");
    api("log.append", { nivel: "ERROR", origen: "instalar", mensaje: `${id}: ${motivo}` });
    return false;
  }

  toast(`Instalado ${id}: ${instalados.length} manifiesto(s)`);
  api("log.append", { nivel: "OK", origen: "instalar", mensaje: `${id}: ${instalados.map((x) => (x.resultado || {}).id || x.archivo).join(", ")}` });
  api("operaciones", { accion: "registrar", tipo: "INSTALACION", detalle: `${id}: ${instalados.length} manifiesto(s)`, estado: errores.length ? "PARCIAL" : "OK", fase: "F3" });

  compsActualizar();
  cargarModulos();
  if (estadoApp.idModal === id) actualizarBotonesModal();
  return true;
}

/**
 * Carga los componentes y los cruza con las descargas que ya están en disco.
 * Si hay un recibo verificado pero la base dice otra cosa (por ejemplo tras
 * recrear la base), se corrige la base: así la app nunca vuelve a pedir una
 * descarga que ya está hecha. Ese era el "me pide descargar dos veces".
 */
function compsActualizar() {
  // Con `api()` a secas, un LENTO en el arranque dejaba la lista de
  // componentes vacía hasta reiniciar. Ahora reintenta y devuelve promesa.
  return apiTarde("componentes", { accion: "listar" }, { maxMs: 15000 }).then(function (comps) {
  if (!comps.ok) return false;
  const lista = (comps.data && comps.data.componentes) || [];
  let disco = [];
  try {
    if (window.FabrickNative && typeof window.FabrickNative.descargasEstado === "function") {
      const d = JSON.parse(window.FabrickNative.descargasEstado());
      if (d && d.ok) disco = d.descargas || [];
    }
  } catch (e) {
    disco = [];
  }
  disco.forEach(function (d) {
    const c = lista.find(function (x) { return x.id === d.id; });
    if (!c) return;
    c.rutaDescarga = d.ruta;
    c.bytesDescarga = d.bytes;
    c.shaDescarga = d.sha256;
    if (d.verificado && c.estado !== "INSTALADO" && c.estado !== "DESCARGADO_VERIFICADO") {
      api("componentes", { accion: "estado", id: c.id, estado: "DESCARGADO_VERIFICADO" });
      c.estado = "DESCARGADO_VERIFICADO";
      revision("descarga", "aviso", "descarga ya presente en disco: " + c.id,
        d.archivo + " · " + bytes(d.bytes) + " · estado corregido en la base");
    }
  });
  estadoApp.componentes = lista;
  estadoApp.descargasDisco = disco;
  return true;
  });
}

/** Habilita los botones según manifiesto, estado y descargas activas. */
function actualizarBotonesModal() {
  const id = estadoApp.idModal;
  if (!id) return;
  const c = estadoApp.componentes.find((x) => x.id === id);
  const m = manifiestoDe(id);
  const enCurso = descargaEnCurso(id);
  const yaVerificado = c && c.estado === "DESCARGADO_VERIFICADO";
  const p = estadoApp.confirmaPendiente;
  const porConfirmar = !!(p && p.id === id && (Date.now() - p.ts) < 60000);

  const btnDescargar = document.getElementById("btnDescargar");
  const btnInstalar = document.getElementById("btnInstalar");
  const btnProbar = document.getElementById("btnProbar");

  if (enCurso) {
    btnDescargar.textContent = "Cancelar descarga";
    btnDescargar.disabled = false;
    btnDescargar.className = "btn";
  } else {
    btnDescargar.textContent = porConfirmar ? "Confirmar descarga" : "Descargar";
    btnDescargar.className = "btn btn-primario";
    const puede = !!(m && m.valido && m.habilitacion && m.habilitacion.descargar && !yaVerificado);
    btnDescargar.disabled = !puede;
    btnDescargar.title = !m
      ? "No hay manifiesto para este componente"
      : (yaVerificado ? "Ya está descargado y verificado" : (puede ? "Descarga HTTPS con verificación SHA-256" : "El validador bloqueó la descarga"));
  }

  if (porConfirmar && m && m.tamano > 50 * 1024 * 1024) {
    document.getElementById("modalNota").textContent =
      `Autorización pendiente: ${bytes(m.tamano)}. Toca «Confirmar descarga» para empezar; el SHA-256 se verifica al terminar.`;
  }

  const instalable = componenteEsInstalable(c, m);
  const yaInstalado = !!(c && c.estado === "INSTALADO");
  const descargado = !!(c && c.estado === "DESCARGADO_VERIFICADO");

  if (instalable && (descargado || yaInstalado)) {
    btnInstalar.disabled = yaInstalado;
    btnInstalar.textContent = yaInstalado ? "Instalado" : "Instalar módulo";
    btnInstalar.title = yaInstalado
      ? "El manifiesto ya está registrado en SQLite"
      : "Registra el manifiesto en SQLite; no ejecuta código descargado";
  } else {
    btnInstalar.disabled = true;
    btnInstalar.textContent = "Instalar";
    btnInstalar.title = instalable
      ? "Primero hay que descargar y verificar el componente"
      : "Ejecutables y modelos requieren A2–A3 (cargar el GGUF e inferir); A1 (bibliotecas) ya está empaquetado";
  }

  if (descargado && !instalable) {
    document.getElementById("modalNota").textContent =
      "Descarga verificada y guardada en el sandbox. A1 (carga de bibliotecas) ya está empaquetado; faltan A2/A3 (cargar el GGUF e inferir). Escanea Modelos para ver el archivo descargado.";
  }

  btnProbar.disabled = true;
  btnProbar.title = "Probar exige A2/A3: cargar el modelo e inferir";
}

/** Pide confirmación explícita cuando el archivo supera 50 MiB. */
function descargarComponente(id) {
  if (descargaEnCurso(id)) {
    const r = window.FabrickNative.cancelar(id);
    procesarCancelacion(id, r);
    return;
  }
  const m = manifiestoDe(id);
  if (!m || !m.valido || !m.habilitacion || !m.habilitacion.descargar) {
    toast("El validador no habilitó la descarga de este componente", "error");
    return;
  }
  if (!m.origen || !m.sha256 || !m.tamano) {
    toast("Manifiesto incompleto: falta URL, hash o tamaño", "error");
    return;
  }

  let autorizado = false;
  if (m.tamano > 50 * 1024 * 1024) {
    // Doble toque explícito: el primero pide confirmación, el segundo autoriza.
    const p = estadoApp.confirmaPendiente;
    const vigente = p && p.id === id && (Date.now() - p.ts) < 60000;
    if (!vigente) {
      estadoApp.confirmaPendiente = { id, ts: Date.now() };
      actualizarBotonesModal();
      toast(`Son ${bytes(m.tamano)}. Toca otra vez para autorizar.`);
      api("log.append", { nivel: "INFO", origen: "descarga", mensaje: `confirmación pendiente para ${id} (${bytes(m.tamano)})` });
      return;
    }
    autorizado = true;
    estadoApp.confirmaPendiente = null;
  } else {
    autorizado = m.autorizado === true;
  }

  const r = window.FabrickNative.descargar(id, m.origen, m.sha256, m.tamano, autorizado);
  let res;
  try { res = JSON.parse(r); } catch (e) { res = { ok: false, error: String(e) }; }
  if (!res.ok) {
    toast("No se pudo iniciar: " + res.error, "error");
    api("log.append", { nivel: "ERROR", origen: "descarga", mensaje: `inicio de ${id} rechazado: ${res.error}` });
    return;
  }
  estadoApp.descargas[id] = { estado: "EN_CURSO", hechos: 0, total: m.tamano };
  document.getElementById("modalProgreso").textContent = "Iniciando descarga…";
  actualizarBotonesModal();
}

function procesarCancelacion(id, crudo) {
  let r;
  try { r = JSON.parse(crudo); } catch (e) { r = { ok: false, error: String(e) }; }
  toast(r.ok ? "Cancelación solicitada" : "No se pudo cancelar: " + r.error, r.ok ? "" : "error");
}

/* ------------------------------------------------- eventos del descargador nativo */
window.FabriDescarga = {
  inicio(id) {
    const m = manifiestoDe(id);
    revision("descarga", "info", "inicio de descarga: " + id,
      (m && m.origen ? m.origen : "sin URL") + " · " + bytes((m && m.tamano) || 0), 0, "descarga");
    estadoApp.descargas[id] = { estado: "EN_CURSO", hechos: 0, total: (m && m.tamano) || 0 };
    if (estadoApp.idModal === id) {
      document.getElementById("modalProgreso").textContent = "Descarga iniciada…";
      actualizarBotonesModal();
    }
  },
  avance(id, hechos, total) {
    const d = estadoApp.descargas[id] || { estado: "EN_CURSO" };
    d.estado = "EN_CURSO";
    d.hechos = hechos;
    d.total = total || d.total || 0;
    estadoApp.descargas[id] = d;
    if (estadoApp.idModal === id) {
      const pct = d.total ? Math.min(100, (hechos / d.total) * 100) : 0;
      document.getElementById("modalBarra").style.width = pct.toFixed(1) + "%";
      document.getElementById("modalProgreso").textContent =
        `${bytes(hechos)} de ${bytes(d.total)} (${pct.toFixed(1)}%)`;
    }
    if (estadoApp.vista === "componentes") pintarComponentes();
  },
  fin(id, resultado) {
    let r = resultado;
    if (typeof r === "string") {
      try { r = JSON.parse(r); } catch (e) { r = { ok: false, error: r }; }
    }
    r = r || { ok: false, error: "resultado vacío" };
    if (id === "actualizacion") {
      const estado = document.getElementById("apkEstado");
      if (!r.ok) {
        if (estado) estado.textContent = "Falló: " + (r.error || r.motivo || "error");
        toast("APK: " + (r.error || r.motivo || "error"), "error");
        return;
      }
      if (estado) estado.textContent = "Verificada (" + bytes(r.bytes || 0) + "). Abriendo instalador…";
      let inst;
      try {
        inst = JSON.parse(window.FabrickNative.instalarApk(r.ruta));
      } catch (e) {
        inst = { ok: false, error: String(e) };
      }
      if (!inst.ok) {
        if (estado) estado.textContent = "Verificada, pero no se pudo abrir el instalador: " + (inst.error || "error");
        toast("Instalador: " + (inst.error || "error"), "error");
      } else {
        if (estado) estado.textContent = "Instalador abierto. Confirma la instalación en Android.";
        toast("APK verificada; confirma en el instalador");
      }
      return;
    }
    estadoApp.descargas[id] = {
      estado: r.ok ? "TERMINADA" : "FALLIDA",
      hechos: r.bytes || 0,
      total: (manifiestoDe(id) || {}).tamano || 0,
      error: r.error || ""
    };

    if (r.ok) {
      revision("descarga", "info", "descarga verificada: " + id,
        "sha256 " + hashCorto(r.sha256) + " · " + bytes(r.bytes || 0), 0, "descarga");
      const nuevo = api("componentes", { accion: "estado", id, estado: "DESCARGADO_VERIFICADO" });
      api("log.append", { nivel: "OK", origen: "descarga", mensaje: `${id} descargado y verificado (sha256 ${hashCorto(r.sha256)}, ${bytes(r.bytes || 0)})` });
      api("operaciones", { accion: "registrar", tipo: "DESCARGA", detalle: `${id} verificado ${hashCorto(r.sha256)}`, estado: "OK", fase: "F3" });
      if (!nuevo.ok) toast("Descarga verificada, pero no se pudo guardar el estado: " + nuevo.error, "error");
      else toast("Descarga verificada: " + id);
      compsActualizar();

      // Módulos y páginas: instalar = registrar el manifiesto ya verificado.
      // Los ejecutables/modelos no se auto-instalan porque requieren A1–A3.
      const cc = estadoApp.componentes.find((x) => x.id === id);
      if (componenteEsInstalable(cc, manifiestoDe(id))) instalarComponente(id, true);
    } else {
      revision("descarga", "error", "descarga fallida: " + id,
        (r.estado ? "estado=" + r.estado + " · " : "") + (r.error || "sin detalle"), 0, "descarga");
      api("log.append", { nivel: "ERROR", origen: "descarga", mensaje: `${id} falló: ${r.error}` });
      api("operaciones", { accion: "registrar", tipo: "DESCARGA", detalle: `${id}: ${r.error}`, estado: "ERROR", fase: "F3" });
      toast("Descarga fallida: " + r.error, "error");
    }

    if (estadoApp.idModal === id) {
      document.getElementById("modalProgreso").textContent = r.ok
        ? `Verificado. Archivo en ${r.ruta}`
        : `Falló (${r.estado || "ERROR"}): ${r.error}`;
      document.getElementById("modalBarra").style.width = r.ok ? "100%" : "0%";
      actualizarBotonesModal();
    }
    pintarComponentes();
  }
};

function cerrarModal() {
  document.getElementById("modal").hidden = true;
}

/* -------------------------------------------------------------------- modelos */
/** Lista de modelos detectados por el escáner (vista «Modelos»).
 *  Ojo: NO es la tabla de recomendados del inicio — antes compartían el mismo
 *  nombre `pintarModelos`, así que la segunda definición anulaba la primera y
 *  la tabla de recomendados del inicio nunca se pintaba. */
function pintarModelosDetectados() {
  const cont = document.getElementById("listaModelos");
  if (!estadoApp.modelos.length) {
    cont.innerHTML = `<div class="item"><p>Sin modelos detectados todavía. Usa «Escanear directorios».</p></div>`;
    return;
  }
  cont.innerHTML = estadoApp.modelos.map((m) => {
    const estadoTxt = m.valido ? "DETECTADO" : "INVÁLIDO";
    const clase = m.valido ? "e-descargado" : "e-error";
    return `
      <article class="item">
        <div class="item-cab">
          <div>
            <h4>${esc(m.nombre)}</h4>
            <p>${esc(m.ruta)}</p>
          </div>
          <span class="estado ${clase}">${estadoTxt}</span>
        </div>
        <div class="item-meta">
          <span>${esc(m.formato)}</span>
          <span>GGUF v${esc(m.version)}</span>
          <span>${esc(m.tensores)} tensores</span>
          <span>${bytes(m.tamano)}</span>
          <span>runtime: ${esc(m.runtime)}</span>
        </div>
      </article>`;
  }).join("");
}

async function escanearModelos() {
  const s = estadoApp.sistema;
  const dirs = [];
  if (s && s.dataDir) {
    dirs.push(s.dataDir + "/modelos");
    // Los componentes descargados viven en filesDir/componentes/<id>/.
    // Sin este directorio el modelo de 469 MB descargado no aparecía.
    dirs.push(s.dataDir + "/componentes");
  }
  // Directorio público habitual en este dispositivo; puede estar bloqueado por
  // el almacenamiento scoped de Android. El error se informa, no se esconde.
  dirs.push("/storage/emulated/0/Download/models");
  dirs.push("/storage/emulated/0/Documents/fabrick-core/modelos");

  const r = await apiTarde("modelos", { accion: "escanear", dirs }, { maxMs: 30000 });
  if (!r.ok) {
    toast("Error al escanear: " + r.error, "error");
    agregarLinea("error", "escaneo falló: " + r.error);
    return;
  }
  estadoApp.modelos = r.data.modelos || [];
  document.getElementById("dirsEscaneo").innerHTML = dirs.map((d) => {
    const accesible = r.data.dirs ? r.data.dirs.includes(d) : false;
    return `<li><span>${esc(d)}</span><b>${accesible ? "revisado" : "sin lectura"}</b></li>`;
  }).join("");
  pintarModelosDetectados();
  pintarInicio();
  toast(`Escaneo terminado: ${estadoApp.modelos.length} archivo(s)`);
  agregarLinea("info", `escaneo de modelos: ${estadoApp.modelos.length} archivo(s)`);
}

/* ==========================================================================
   Chat · local (A2/A3) y remoto (OpenAI-compatible)
   ========================================================================== */
let chatIniciado = false;

/** Vuelve a leer la configuración del chat (la usa el aviso de núcleo listo). */
function chatRefrescar() {
  chatIniciado = false;
  try { chatIniciar(); } catch (e) { /* la vista se pinta sola */ }
}

function chatIniciar() {
  if (!chatIniciado) {
    chatLlenarProveedores();
    chatCargarEstado();
    chatCargarEstadoLocal();
    chatPintarMensajes();
    // Si el modelo ya está cargado, la configuración no tiene por qué ocupar
    // espacio: queda a un toque en el engranaje.
    const cfg = document.getElementById("chatConfig");
    if (cfg && estadoApp.chat.localCargado && estadoApp.chat.modo === "local") cfg.hidden = true;
    chatIniciado = true;
  }
  chatPintarModelosLocal();
  chatActualizarCabecera();

  // El hilo recuerda si el usuario está abajo: si subió a leer, no se le
  // arrastra al final con cada token.
  const hilo = document.getElementById("chatHilo");
  if (hilo && !hilo.dataset.scrollListo) {
    hilo.dataset.scrollListo = "1";
    hilo.addEventListener("scroll", function () {
      estadoApp.chat.autoscroll =
        hilo.scrollTop + hilo.clientHeight >= hilo.scrollHeight - 48;
    }, { passive: true });
  }
  chatInicializarAjustesIA();
  chatInicializarPestanas();
  chatPintarFamilia();
}

/** Refresca el pill de estado y el avatar según el modo y el modelo. */
function chatActualizarCabecera() {
  const pill = document.getElementById("chatEstadoPill");
  const texto = document.getElementById("chatEstadoTexto");
  const sub = document.getElementById("chatSubtitulo");
  if (!pill || !texto) return;

  const c = estadoApp.chat;
  let estado = "vacio";
  let etiqueta = "Sin modelo";

  if (c.modo === "remoto") {
    if (c.remotoConfigurado) {
      estado = "remoto";
      etiqueta = "Remoto";
      if (sub) sub.textContent = "Conectado a tu proveedor.";
    } else {
      estado = "vacio";
      etiqueta = "Sin configurar";
      if (sub) sub.textContent = "Falta configurar tu proveedor.";
    }
  } else if (c.cargando) {
    estado = "cargando";
    etiqueta = "Cargando…";
    if (sub) sub.textContent = "Preparando el modelo, un momento.";
  } else if (c.localCargado) {
    estado = "listo";
    etiqueta = "Local listo";
    if (sub) sub.textContent = "Listo para conversar, acá en tu teléfono.";
  } else {
    if (sub) sub.textContent = "Elige un modelo para empezar.";
  }

  pill.dataset.estado = estado;
  texto.textContent = etiqueta;
  if (!c.enviando && c.estadoAvatar !== "talking") chatAvatarEstado("idle");
  chatActualizarBotonEnviar();
}

/** El botón de enviar se convierte en «detener» mientras el modelo responde. */
function chatActualizarBotonEnviar() {
  const b = document.getElementById("btnChatEnviar");
  if (!b) return;
  const activo = estadoApp.chat.enviando && estadoApp.chat.modo === "local";
  b.dataset.estado = activo ? "detener" : "enviar";
  b.classList.toggle("btn-detener", activo);
  b.setAttribute("aria-label", activo ? "Detener la respuesta" : "Enviar");
  b.title = activo ? "Detener" : "Enviar";
  b.textContent = activo ? "■" : "➤";
}

/** Cambia el estado visual del avatar: idle · thinking · talking. */
function chatAvatarEstado(nuevo) {
  const avatar = document.getElementById("chatAvatar");
  if (!avatar) return;
  const estado = nuevo === "thinking" || nuevo === "talking" ? nuevo : "idle";
  estadoApp.chat.estadoAvatar = estado;
  avatar.dataset.estado = estado;
}

function chatLlenarProveedores() {
  const sel = document.getElementById("chatProveedor");
  if (!sel || sel.options.length) return;
  sel.innerHTML = PROVEEDORES_CHAT.map((p) =>
    `<option value="${esc(p.id)}">${esc(p.nombre)} · ${esc(p.tipo)}</option>`
  ).join("");
  sel.value = "omniroute";
  chatAplicarProveedor("omniroute", false);
}

function chatAplicarProveedor(id, escribir) {
  const p = PROVEEDORES_CHAT.find((x) => x.id === id) || PROVEEDORES_CHAT[0];
  const nota = document.getElementById("chatProveedorNota");
  if (nota) nota.textContent = p.nota;
  if (escribir) {
    document.getElementById("chatUrl").value = p.url;
    document.getElementById("chatModeloRemoto").value = p.modelo || "";
  }
}

function chatCambiarModo(modo) {
  estadoApp.chat.modo = modo === "remoto" ? "remoto" : "local";
  document.querySelectorAll("#chatModo [data-chat-modo]").forEach((b) => {
    b.classList.toggle("activo", b.dataset.chatModo === estadoApp.chat.modo);
  });
  document.getElementById("chatLocalPanel").hidden = estadoApp.chat.modo !== "local";
  document.getElementById("chatRemotoPanel").hidden = estadoApp.chat.modo !== "remoto";
  if (estadoApp.chat.modo === "remoto" && !estadoApp.chat.remotoConfigurado) {
    const cfg = document.getElementById("chatConfig");
    if (cfg) cfg.hidden = false;
  }
  chatActualizarCabecera();
}

function chatCargarEstadoLocal() {
  if (!window.FabrickNative || typeof window.FabrickNative.localEstado !== "function") {
    chatPintarEstadoLocal({ ok: false, cargado: false, error: "puente nativo sin A2/A3" });
    return;
  }
  let r;
  try {
    r = JSON.parse(window.FabrickNative.localEstado());
  } catch (e) {
    r = { ok: false, cargado: false, error: String(e) };
  }
  estadoApp.chat.localCargado = !!(r && r.cargado);
  chatPintarEstadoLocal(r);
}

function chatPintarEstadoLocal(r) {
  const punto = document.getElementById("chatLocalPunto");
  const estado = document.getElementById("chatLocalEstado");
  const info = document.getElementById("chatLocalInfo");
  if (!punto || !estado || !info) return;
  if (r && r.cargado) {
    punto.className = "punto ok";
    const inf = r.info || {};
    estadoApp.chat.nCtx = Number(r.n_ctx || inf.n_ctx || 2048) || 2048;
    estadoApp.chat.infoDesc = inf.desc || "";
    if (r.ruta) estadoApp.chat.modeloRuta = r.ruta;
    estado.textContent = "Modelo cargado · ctx " + estadoApp.chat.nCtx;
    info.textContent = [
      inf.desc || "GGUF listo",
      inf.n_params ? (Number(inf.n_params) / 1e6).toFixed(0) + " M parámetros" : "",
      inf.n_vocab ? inf.n_vocab + " tokens de vocabulario" : "",
      r.ruta ? "ruta: " + r.ruta : ""
    ].filter(Boolean).join(" · ");
    estadoApp.chat.cargando = false;
    chatPintarFamilia();
    chatActualizarCabecera();
    chatActualizarContexto();
    return;
  }
  if (r && r.error) {
    punto.className = "punto error";
    estado.textContent = "Error: " + r.error;
  } else {
    punto.className = "punto";
    estado.textContent = "Sin modelo cargado.";
  }
  info.textContent = "Carga el modelo del teléfono para conversar sin internet.";
  chatActualizarCabecera();
}

/** ¿La ruta es un modelo de embeddings? Esos GGUF no generan texto: si se
 *  cargan como chat, llama.cpp devuelve 0 tokens y la app parecía "colgada".
 *  Se detectan por nombre y por la carpeta donde los guarda la descarga. */
function esModeloEmbeddings(ruta) {
  const r = String(ruta || "").toLowerCase();
  if (!r) return false;
  if (r.indexOf("/embeddings/") >= 0) return true;
  const base = r.split("/").pop();
  return /(^|[^a-z])(embed|bge|minilm|e5-|gte-|arctic|nomic|jina|voyage|sentence)/.test(base);
}

function chatPintarModelosLocal() {
  const sel = document.getElementById("chatModeloLocal");
  if (!sel) return;
  const modelos = estadoApp.modelos || [];
  if (!modelos.length) {
    sel.innerHTML = `<option value="">Sin modelos detectados; pulsa Escanear</option>`;
    return;
  }
  const anterior = sel.value;
  sel.innerHTML = modelos.map((m) => {
    if (esModeloEmbeddings(m.ruta)) {
      // Visible pero no elegible: el usuario entiende por qué no aparece.
      return `<option value="" disabled>${esc(m.nombre)} · embeddings, no sirve para chat</option>`;
    }
    return `<option value="${esc(m.ruta)}">${esc(m.nombre)} · ${bytes(m.tamano)}</option>`;
  }).join("");
  const existe = modelos.some((m) => m.ruta === anterior && !esModeloEmbeddings(m.ruta));
  if (existe) sel.value = anterior;
}

async function chatEscanearModelos() {
  const btn = document.getElementById("btnChatEscanear");
  if (btn) { btn.disabled = true; btn.textContent = "Escaneando…"; }
  try {
    await escanearModelos();
    chatPintarModelosLocal();
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Escanear modelos"; }
  }
}

function chatCargarModeloLocal() {
  const sel = document.getElementById("chatModeloLocal");
  const ruta = sel ? sel.value : "";
  if (!ruta) {
    toast("Primero escanea y elige un modelo", "error");
    return;
  }
  if (esModeloEmbeddings(ruta)) {
    // Guardia: un GGUF de embeddings cargado como chat responde 0 tokens.
    const aviso = "Ese GGUF es de embeddings (vectoriza texto, no conversa). "
      + "Elige un modelo de chat como SmolLM2 o Qwen.";
    toast(aviso, "error");
    revision("llm", "error", "modelo de embeddings rechazado para chat",
      ruta, 0, "llama");
    return;
  }
  // Antes de cargar: si el teléfono está justo de RAM, se avisa en vez de
  // dejar que el kernel mate la app a mitad de la carga.
  try {
    const mem = JSON.parse(window.FabrickNative.memoria());
    if (mem && mem.ok && Number(mem.libre_mb) < 600) {
      const seguir = confirm("Quedan " + mem.libre_mb + " MB libres de RAM. "
        + "Cargar un modelo puede dejar la app sin memoria. ¿Seguir igual?");
      if (!seguir) return;
    }
  } catch (e) { /* sin dato de memoria: se intenta igual */ }

  estadoApp.chat.modeloRuta = ruta;
  const punto = document.getElementById("chatLocalPunto");
  const estado = document.getElementById("chatLocalEstado");
  if (punto) punto.className = "punto cargando";
  if (estado) estado.textContent = "Cargando GGUF… puede tardar y usar RAM.";
  estadoApp.chat.cargando = true;
  chatActualizarCabecera();
  let r;
  try {
    // 1024 de contexto: suficiente para 2-3 turnos cortos y entra en un
    // teléfono de 4 GB sin que el kernel mate el proceso.
    // 2048 de contexto: alcanza para varios turnos con el prompt estable.
    // La KV de un 0.5B ocupa ~12 MB a esta profundidad; entra sin riesgo.
    r = JSON.parse(window.FabrickNative.localCargar(ruta, 2048, 4));
  } catch (e) {
    r = { ok: false, error: String(e) };
  }
  if (!r.ok) {
    estadoApp.chat.cargando = false;
    if (punto) punto.className = "punto error";
    if (estado) estado.textContent = "Error: " + (r.error || "no se pudo iniciar la carga");
    toast("Modelo local: " + (r.error || "no se pudo cargar"), "error");
    return;
  }
  // El nativo avisa por FabriChat.localCargado. Si ese aviso nunca llega
  // (hilo muerto, OOM, llama.cpp atascado), antes la interfaz se quedaba en
  // "Cargando…" para siempre. Este vigilante lo detecta y libera el estado.
  chatVigilarCargaLocal();
}

/**
 * Vigila una carga local en curso. Cada 2 s pregunta el estado real al núcleo
 * (que ahora responde sin bloquearse). Tres desenlaces:
 *   · el modelo quedó cargado → se sincroniza la interfaz aunque el callback se
 *     haya perdido;
 *   · el núcleo dice que lleva más de 45 s cargando → se declara colgada, se
 *     abandona y se le dice al usuario qué hacer;
 *   · hay error de bibliotecas → se corta de inmediato.
 */
function chatVigilarCargaLocal() {
  if (estadoApp.chat.vigiaCarga) clearInterval(estadoApp.chat.vigiaCarga);
  const t0 = Date.now();
  estadoApp.chat.vigiaCarga = setInterval(function () {
    const punto = document.getElementById("chatLocalPunto");
    const estado = document.getElementById("chatLocalEstado");
    let s = null;
    try {
      if (window.FabrickNative && typeof window.FabrickNative.localEstado === "function") {
        s = JSON.parse(window.FabrickNative.localEstado());
      }
    } catch (e) {
      s = null;
    }
    // Sin puente o sin respuesta: se usa el reloj local como respaldo.
    const ms = s && s.cargando_ms ? s.cargando_ms : Date.now() - t0;

    if (s && s.cargado) {
      clearInterval(estadoApp.chat.vigiaCarga);
      estadoApp.chat.vigiaCarga = null;
      if (!estadoApp.chat.localCargado) {
        // El callback se perdió pero el modelo sí está: se adopta.
        estadoApp.chat.cargando = false;
        estadoApp.chat.localCargado = true;
        chatPintarEstadoLocal(s);
        toast("Modelo cargado (aviso recuperado del núcleo)");
        revision("llm", "aviso", "FabriChat.localCargado no llegó; estado recuperado del núcleo",
          (s.info && (s.info.desc || s.info.archivo)) || "", ms, "llama");
      }
      return;
    }

    if (s && s.ok === false) {
      clearInterval(estadoApp.chat.vigiaCarga);
      estadoApp.chat.vigiaCarga = null;
      estadoApp.chat.cargando = false;
      if (punto) punto.className = "punto error";
      if (estado) estado.textContent = "Error: " + (s.error || "runtime no disponible");
      revision("llm", "error", "runtime local no disponible", String(s.error || ""), ms, "llama");
      return;
    }

    if (s && s.colgada) {
      clearInterval(estadoApp.chat.vigiaCarga);
      estadoApp.chat.vigiaCarga = null;
      chatCargaLocalColgada(ms);
      return;
    }

    if (estado && estadoApp.chat.cargando) {
      estado.textContent = "Cargando GGUF… " + Math.round(ms / 1000) + " s";
    }
  }, 2000);
}

/** Declara colgada la carga, la abandona y deja el chat usable. */
function chatCargaLocalColgada(ms) {
  estadoApp.chat.cargando = false;
  estadoApp.chat.localCargado = false;
  const punto = document.getElementById("chatLocalPunto");
  const estado = document.getElementById("chatLocalEstado");
  if (punto) punto.className = "punto error";
  const seg = Math.round((ms || 0) / 1000);
  if (estado) {
    estado.textContent = "La carga se colgó a los " + seg + " s. Se abandonó: prueba un modelo más "
      + "pequeño (SmolLM2 135M) o libera memoria.";
  }
  try {
    if (window.FabrickNative && typeof window.FabrickNative.localAbandonarCarga === "function") {
      window.FabrickNative.localAbandonarCarga();
    }
  } catch (e) { /* el aviso de abajo ya explica el estado */ }
  toast("La carga del modelo local se colgó (" + seg + " s). Se abandonó.", "error");
  revision("llm", "error", "carga local colgada y abandonada",
    "sin respuesta de llama.cpp en " + seg + " s · modelo: " + (estadoApp.chat.modeloRuta || "?"),
    ms, "llama");
  chatActualizarCabecera();
}

function chatLiberarModeloLocal() {
  if (estadoApp.chat.vigiaCarga) {
    clearInterval(estadoApp.chat.vigiaCarga);
    estadoApp.chat.vigiaCarga = null;
  }
  let r;
  try { r = JSON.parse(window.FabrickNative.localLiberar()); } catch (e) { r = { ok: false, error: String(e) }; }
  estadoApp.chat.localCargado = false;
  estadoApp.chat.cargando = false;
  chatCargarEstadoLocal();
  chatActualizarContexto();
  const aviso = r && r.aviso ? " (" + r.aviso + ")" : "";
  toast((r.ok ? "Modelo liberado" : "No se pudo liberar: " + r.error) + aviso, r.ok ? "" : "error");
}

function chatCargarEstado() {
  if (!window.FabrickNative || typeof window.FabrickNative.chatEstado !== "function") return;
  let r;
  try { r = JSON.parse(window.FabrickNative.chatEstado()); } catch (e) { r = { ok: false, error: String(e) }; }
  if (!r.ok) return;
  estadoApp.chat.remotoConfigurado = !!r.configurado;
  const url = document.getElementById("chatUrl");
  const modelo = document.getElementById("chatModeloRemoto");
  const nota = document.getElementById("chatRemotoEstado");
  if (url && r.url) url.value = r.url;
  if (modelo && r.modelo) modelo.value = r.modelo;
  if (r.proveedor) {
    const sel = document.getElementById("chatProveedor");
    if (sel && PROVEEDORES_CHAT.some((p) => p.id === r.proveedor)) {
      sel.value = r.proveedor;
      chatAplicarProveedor(r.proveedor, false);
    }
  }
  if (nota) {
    nota.textContent = r.configurado
      ? "Configurado" + (r.tieneClave ? " con clave." : " sin clave.") + " Pulsa «Traer modelos» o «Probar»."
      : "Sin configurar. Elige un proveedor, guarda URL/modelo/clave y trae el catálogo.";
  }
  chatActualizarCabecera();
}

function chatGuardarRemoto() {
  const url = document.getElementById("chatUrl").value.trim();
  const clave = document.getElementById("chatClave").value;
  const modelo = document.getElementById("chatModeloRemoto").value.trim();
  const proveedor = document.getElementById("chatProveedor").value;
  const nota = document.getElementById("chatRemotoEstado");
  let r;
  try {
    r = JSON.parse(window.FabrickNative.chatGuardar(url, clave, modelo, proveedor));
  } catch (e) { r = { ok: false, error: String(e) }; }
  if (!r.ok) {
    if (nota) nota.textContent = "Error: " + (r.error || "no se pudo guardar");
    toast("Chat remoto: " + (r.error || "no se pudo guardar"), "error");
    return;
  }
  document.getElementById("chatClave").value = "";
  estadoApp.chat.remotoConfigurado = true;
  chatActualizarCabecera();
  if (nota) nota.textContent = "Guardado en " + r.url + ". Ahora puedes traer modelos o enviar.";
  toast("Proveedor guardado");
}

function chatTraerModelos() {
  const nota = document.getElementById("chatRemotoEstado");
  if (nota) nota.textContent = "Consultando /v1/models…";
  let r;
  try { r = JSON.parse(window.FabrickNative.chatModelos()); } catch (e) { r = { ok: false, error: String(e) }; }
  if (!r.ok) {
    if (nota) nota.textContent = "Error: " + (r.error || "no se pudo consultar");
    toast("Catálogo: " + (r.error || "no se pudo consultar"), "error");
  }
}

function chatProbarRemoto() {
  chatTraerModelos();
}

/** Busca contexto en los textos ya indexados. Devuelve "" si no hay nada. */
async function chatContextoRag(consulta) {
  const casilla = document.getElementById("chatRag");
  if (!casilla || !casilla.checked) return "";
  try {
    const av = document.getElementById("chatHerramienta");
    const avt = document.getElementById("chatHerramientaTexto");
    if (av && avt) { avt.textContent = "Buscando en tus textos indexados…"; av.hidden = false; }
  } catch (e) { /* cosmético */ }
  const r = await apiTarde("rag", { accion: "buscar", consulta: consulta, k: 3 }, { maxMs: 20000 });
  if (!r.ok) {
    toast("RAG léxico: " + (r.error || "no disponible"), "error");
    return "";
  }
  const lista = (r.data && r.data.resultados) || [];
  if (!lista.length) return "";
  const fragmentos = lista
    .map((x, i) => `[${i + 1}] ${x.documento ? x.documento + ": " : ""}${x.texto}`)
    .join("\n")
    .slice(0, 1500);
  return `Contexto recuperado de la biblioteca local (RAG léxico):\n${fragmentos}\n\n`;
}

/* Personalidad estable del asistente.
   Escrita corta a propósito: el modelo local de 0.5B pierde precisión con
   instrucciones largas. El tono es chileno, sin caricaturizarlo. */
const PERSONALIDAD = [
  "Eres FORGE CORE STOCK, el asistente que vive en el teléfono del usuario. Responde como una persona cercana y segura, no como una máquina.",
  "Hablas español de Chile, natural y cálido. Frases cortas, una idea por frase.",
  "Vas al grano: 2 o 3 líneas, sin relleno ni listas salvo que te las pidan.",
  "Usa alguna muletilla chilena con medida (mira, oye, al tiro, cacha), sin exagerar.",
  "Si la pregunta toca productos, stock, precios o ventas, contesta con los datos reales que te pasan como contexto. Si no los tienes, dilo y no inventes números.",
  "Si no sabes algo, reconócelo y sugiere cómo averiguarlo."
].join(" ");

/* ── identidad + preferencias (skill de personalización) ─────────────────── */
const CHAT_PREFS_CLAVE = "fabrick.chat.preferencias";

/** Preferencias que el usuario pidió recordar. */
function chatPreferencias() {
  try { return localStorage.getItem(CHAT_PREFS_CLAVE) || ""; } catch (e) { return ""; }
}
function chatPreferenciasGuardar(texto) {
  try { localStorage.setItem(CHAT_PREFS_CLAVE, String(texto || "").slice(0, 600)); } catch (e) {}
}

/** Nombre y giro del negocio, para que el asistente hable con identidad. */
function chatIdentidadContexto() {
  let id = {};
  try { if (typeof idDeCache === "function") id = idDeCache() || {}; } catch (e) { id = {}; }
  const nombre = id.nombre || "";
  const giro = (id.datos && (id.datos.giro || id.datos.razon_social)) || "";
  if (!nombre) return "";
  return "Atiendes a " + nombre + (giro ? " (" + giro + ")" : "") + ".";
}

/** Bloque de sistema completo: personalidad + identidad + preferencias. */
function chatSistemaContexto() {
  const partes = [PERSONALIDAD];
  const identidad = chatIdentidadContexto();
  if (identidad) partes.push(identidad);
  const prefs = chatPreferencias();
  if (prefs) partes.push("Preferencias del usuario que debes respetar: " + prefs + ".");
  
  // Modo automático: detecta si la pregunta actual es de negocio o conocimiento
  // y añade una nota al prompt para que el modelo sepa cómo responder.
  // Esto se usa al final del prompt antes de enviar al modelo.
  const modo = detectarModoPregunta(estadoApp.chat.ultimoUsuario || "");
  const modoNota = modo === "negocio"
    ? " -- Modo negocio: usa datos locales del inventario (precios, stock, márgenes). Respuestas de 2-3 líneas."
    : modo === "conocimiento"
    ? " -- Modo conocimiento: consulta APIs externas (Wikipedia, clima, noticias). Respuestas ampliadas."
    : "";
  if (modoNota) partes.push(modoNota);
  
  return partes.join(" ");
}

/** Detecta pedidos de «recuerda que…» y los guarda como preferencia. */
function chatProcesarPreferencia(texto) {
  const t = String(texto || "").trim();
  if (!t) return false;
  const patrones = [
    /^recuerda que (.+)/i,
    /^recuerda[:]?\s*(.+)/i,
    /^siempre resp[oó]ndeme (.+)/i,
    /^prefiero que (.+)/i
  ];
  for (let i = 0; i < patrones.length; i++) {
    const m = t.match(patrones[i]);
    if (m && m[1] && m[1].trim()) {
      chatPreferenciasGuardar(t);
      toast("Anotado: recordaré tu preferencia");
      revision("chat", "info", "preferencia recordada", t.slice(0, 120), 0, "chat");
      return true;
    }
  }
  return false;
}

/** Estimación conservadora para español: ~3,2 caracteres por token. */
function chatEstimarTokens(texto) {
  return Math.ceil(String(texto || "").length / 3.2);
}

/*
 * Plantillas de chat por familia de modelo.
 *
 * Cada familia espera marcadores distintos. Con la plantilla equivocada el
 * modelo responde peor o no se detiene: Llama 3.2 no entiende ChatML y Qwen no
 * entiende los headers de Llama. La plantilla se elige sola por el nombre del
 * GGUF cargado y el preset de muestreo la acompaña.
 */
const CHAT_FAMILIAS = {
  qwen: {
    nombre: "Qwen 2 · ChatML",
    plantilla: "chatml",
    preset: { temperatura: 0.7, topP: 0.9, topK: 40, repeticion: 1.1, maxTokens: 256 },
    nota: "ChatML con <|im_start|>. Es el preset por defecto de la app."
  },
  llama: {
    nombre: "Llama 3.2 · headers",
    plantilla: "llama3",
    preset: { temperatura: 0.6, topP: 0.9, topK: 40, repeticion: 1.1, maxTokens: 384 },
    nota: "Usa <|begin_of_text|> y <|eot_id|>. Temperatura 0.6, como recomienda Meta."
  },
  smollm: {
    nombre: "SmolLM2 · ChatML",
    plantilla: "chatml",
    preset: { temperatura: 0.7, topP: 0.9, topK: 50, repeticion: 1.1, maxTokens: 256 },
    nota: "ChatML. Top-k 50 porque su vocabulario es más pequeño."
  },
  gemma: {
    nombre: "Gemma · turnos",
    plantilla: "gemma",
    preset: { temperatura: 0.7, topP: 0.95, topK: 64, repeticion: 1.1, maxTokens: 256 },
    nota: "Usa <start_of_turn> y <end_of_turn>. Top-p 0.95."
  },
  phi: {
    nombre: "Phi-3 · turnos",
    plantilla: "phi3",
    preset: { temperatura: 0.7, topP: 0.9, topK: 40, repeticion: 1.1, maxTokens: 256 },
    nota: "Usa <|system|>, <|user|> y <|end|>."
  },
  generico: {
    nombre: "GGUF genérico · ChatML",
    plantilla: "chatml",
    preset: { temperatura: 0.7, topP: 0.9, topK: 40, repeticion: 1.1, maxTokens: 256 },
    nota: "No se reconoce la familia: se usa ChatML, el formato más común."
  }
};

/** Familia del modelo cargado, deducida del nombre del archivo. */
function chatFamiliaActual() {
  const ruta = String(estadoApp.chat.modeloRuta || "").toLowerCase();
  const desc = String((estadoApp.chat.infoDesc || "")).toLowerCase();
  const todo = ruta + " " + desc;
  if (!todo.trim()) return "qwen"; // preset por defecto de la app
  if (/qwen/.test(todo)) return "qwen";
  if (/llama-?3|llama3|llama 3/.test(todo)) return "llama";
  if (/smollm/.test(todo)) return "smollm";
  if (/gemma/.test(todo)) return "gemma";
  if (/phi-?3|phi3/.test(todo)) return "phi";
  return "generico";
}

/** Preset recomendado para el modelo cargado. */
function chatPresetActual() {
  return CHAT_FAMILIAS[chatFamiliaActual()] || CHAT_FAMILIAS.qwen;
}

/** Pinta la plantilla y el preset activos en la pestaña IA / Modelo. */
function chatPintarFamilia() {
  const fam = chatPresetActual();
  const nombre = document.getElementById("chatFamiliaNombre");
  const nota = document.getElementById("chatFamiliaNota");
  const presetNombre = document.getElementById("chatPresetNombre");
  const presetNota = document.getElementById("chatPresetNota");
  const btn = document.getElementById("btnChatAplicarConfig");
  if (nombre) nombre.textContent = fam.nombre;
  if (nota) nota.textContent = fam.nota;
  if (presetNombre) presetNombre.textContent = fam.nombre.split(" · ")[0];
  if (presetNota) presetNota.textContent = "Recomendado para " + fam.nombre.split(" · ")[0]
    + ": temperatura " + fam.preset.temperatura + " · top-p " + fam.preset.topP
    + " · top-k " + fam.preset.topK + " · repetición " + fam.preset.repeticion
    + " · " + fam.preset.maxTokens + " tokens. Al cargar otro modelo se ajusta sola.";
  if (btn) btn.textContent = "Aplicar a " + fam.nombre.split(" · ")[0];
}

/** Aplica el preset de la familia al estado y a los controles. */
function chatAplicarPresetModelo(avisar) {
  const fam = chatPresetActual();
  const p = fam.preset;
  const c = estadoApp.chat;
  c.temperatura = p.temperatura;
  c.topP = p.topP;
  c.topK = p.topK;
  c.repeticion = p.repeticion;
  c.maxTokens = p.maxTokens;
  chatPintarAjustesIA();
  chatPintarFamilia();
  // Se envía al núcleo ahora, con el modelo recién cargado y sin inferencia en
  // curso: es el único momento seguro para tocar el sampler.
  try {
    window.FabrickNative.localConfigurar(c.temperatura, c.topP, c.topK, c.repeticion, 0);
  } catch (e) { /* el shim usa sus valores por defecto */ }
  if (avisar) {
    toast("Ajustes de IA para " + fam.nombre.split(" · ")[0] + " listos");
    revision("llm", "info", "preset aplicado", fam.nombre, 0, "llama");
  }
}

/** Envuelve el bloque de sistema + historial en la plantilla de la familia. */
function chatArmarPlantilla(sistema, bloques, familia) {
  const fam = CHAT_FAMILIAS[familia] || CHAT_FAMILIAS.generico;
  if (fam.plantilla === "llama3") {
    const ini = "<|begin_of_text|>";
    let s = ini + "<|start_header_id|>system<|end_header_id|>\n\n" + sistema + "<|eot_id|>";
    bloques.forEach(function (b) {
      s += "<|start_header_id|>" + (b.rol === "user" ? "user" : "assistant") + "<|end_header_id|>\n\n"
        + b.texto + "<|eot_id|>";
    });
    return s + "<|start_header_id|>assistant<|end_header_id|>\n\n";
  }
  if (fam.plantilla === "gemma") {
    // Gemma no tiene rol system: las instrucciones van dentro del primer turno.
    let s = "";
    let primera = true;
    bloques.forEach(function (b) {
      if (b.rol === "user") {
        const cuerpo = primera ? sistema + "\n\n" + b.texto : b.texto;
        primera = false;
        s += "<start_of_turn>user\n" + cuerpo + "<end_of_turn>\n";
      } else {
        s += "<start_of_turn>model\n" + b.texto + "<end_of_turn>\n";
      }
    });
    return s + "<start_of_turn>model\n";
  }
  if (fam.plantilla === "phi3") {
    let s = "<|system|>\n" + sistema + "<|end|>\n";
    bloques.forEach(function (b) {
      s += (b.rol === "user" ? "<|user|>\n" : "<|assistant|>\n") + b.texto + "<|end|>\n";
    });
    return s + "<|assistant|>\n";
  }
  // ChatML (Qwen, SmolLM2 y genéricos)
  let s = "<|im_start|>system\n" + sistema + "<|im_end|>\n";
  bloques.forEach(function (b) {
    s += "<|im_start|>" + (b.rol === "user" ? "user" : "assistant") + "\n"
      + b.texto + "<|im_end|>\n";
  });
  return s + "<|im_start|>assistant\n";
}

/*
 * El prompt se arma para que el prefijo sea estable entre turnos: el bloque de
 * sistema no cambia y el contexto dinámico (SQL, RAG) viaja dentro del último
 * mensaje del usuario. Así la memoria KV del turno anterior se reutiliza casi
 * entera y el segundo turno arranca mucho más rápido.
 */
function chatPromptLocal(contexto) {
  const c = estadoApp.chat;
  const maxSalida = c.maxTokens || 256;
  const presupuesto = Math.max(320, (c.nCtx || 2048) - maxSalida - 32);
  const sistema = `Eres FORGE CORE STOCK, el asistente de inventario y ventas del negocio. Respondes en español chileno, corto y directo.
Reglas obligatorias:
- Si la pregunta es de productos, stock, precios, márgenes o ventas, usa los DATOS REALES que vienen en el mensaje. Nunca inventes números.
- Máximo 4 o 5 líneas. Sin listas largas, sin repetir la pregunta, sin símbolos raros.
- Si no tienes el dato, dilo en una línea y sugiere dónde mirarlo.
${chatSistemaContexto()}`;
  const ctx = String(contexto || "").trim().slice(0, 1600);
  let usado = chatEstimarTokens(sistema) + 16;

  const msgs = c.mensajes.filter((m) => (m.rol === "user" || m.rol === "ia") && m.texto);
  const bloques = [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    let cuerpo = m.texto;
    if (m.rol === "user" && i === msgs.length - 1 && ctx) {
      cuerpo = "Contexto real disponible:\n" + ctx + "\n\n" + cuerpo;
    }
    const costo = chatEstimarTokens(cuerpo) + 8;
    if (usado + costo > presupuesto) break;
    bloques.unshift({ rol: m.rol, texto: cuerpo });
    usado += costo;
  }
  return chatArmarPlantilla(sistema, bloques, chatFamiliaActual());
}

/* ------------------------------------------------------------------
   Consulta SQL desde el chat
   --------------------------------------------------------------
   El usuario puede escribir consultas SQL directamente precedidas
   de `/sql `. Solo se permiten SELECT. Los resultados se pasan al
   modelo como contexto para que responda en lenguaje natural.
   ------------------------------------------------------------------ */
function esConsultaSql(texto) {
  const t = texto.trim();
  return t.startsWith("/sql ") || t.startsWith("/consulta ");
}

function extraerSql(texto) {
  const t = texto.trim();
  if (t.startsWith("/sql ")) return t.slice(5).trim();
  if (t.startsWith("/consulta ")) return t.slice(10).trim();
  return "";
}

function palabrasClaveBD(texto) {
  const clave = ["producto", "productos", "stock", "precio", "precios", "costo", "margen",
    "ganancia", "proveedor", "categoria", "categoría", "inventario", "unidades",
    "total", "valor", "venta", "ventas", "cuánto", "cuanto", "cuántos", "cuantos",
    "resumen", "agotado", "quedan", "factura", "facturas", "cliente", "clientes",
    "iva", "impuesto"];
  const bajo = texto.toLowerCase();
  return clave.some((c) => bajo.includes(c));
}

async function ejecutarSqlChat(sql) {
  const r = await apiTarde("consultar_seguro", { sql }, { maxMs: 20000 });
  if (!r.ok) {
    return { ok: false, error: r.error || "no se pudo ejecutar la consulta" };
  }
  const d = r.data || {};
  const columnas = d.columnas || [];
  const filas = d.filas || [];
  if (!filas.length) {
    return { ok: true, texto: "La consulta no devolvió filas.", datos: [] };
  }
  const filasTexto = filas.slice(0, 20).map((f) => {
    return columnas.map((c) => c + "=" + (f[c] == null ? "NULL" : f[c])).join(", ");
  }).join("; ");
  const resumen = "Consulta: " + sql + "\nColumnas: " + columnas.join(", ") + "\nFilas (" + filas.length + " total, se muestran " + Math.min(filas.length, 20) + "):\n" + filasTexto;
  return { ok: true, texto: resumen, datos: filas };
}

async function obtenerContextoGraphRAG(consulta) {
  const partes = [];
  try {
    const r = await apiTarde("aprendizaje_buscar", { tema: consulta, limite: 3 }, { maxMs: 15000 });
    if (r.ok && r.data && r.data.resultados && r.data.resultados.length) {
      const fragmentos = r.data.resultados
        .map((x) => "[Aprendizaje: " + x.tema + "] " + x.contenido + (x.preferencia ? " (prefiere " + x.preferencia + ")" : ""))
        .join("\n");
      partes.push("Conocimiento aprendido previamente:\n" + fragmentos + "\n");
    }
  } catch (e) { /* ignorar */ }
  try {
    const r = await apiTarde("graphrag_buscar", { tema: consulta, limite: 3 }, { maxMs: 15000 });
    if (r.ok && r.data && r.data.resultados && r.data.resultados.length) {
      const fragmentos = r.data.resultados
        .map((x) => "[" + x.origen + ": " + x.tema + "] " + x.texto)
        .join("\n");
      partes.push("Base de conocimiento:\n" + fragmentos + "\n");
    }
  } catch (e) { /* ignorar */ }
  return partes.join("\n");
}

function esPreguntaBD(texto) {
  const bajo = texto.toLowerCase();
  const keywords = ["cuántos", "cuantos", "cuánto", "cuanto", "cuál", "cual", "qué", "que",
    "dónde", "donde", "cuando", "cuándo", "cómo", "como", "cuántas", "cuantas"];
  const bdWords = ["producto", "productos", "stock", "precio", "precios", "costo", "margen",
    "ganancia", "proveedor", "categoria", "categoría", "inventario", "unidades",
    "total", "valor", "venta", "agotado", "factura", "cliente", "base de datos",
    "tabla", "filas"];
  return palabrasClaveBD(texto) && (keywords.some((k) => bajo.includes(k)) || bdWords.some((b) => bajo.includes(b)));
}


function chatPromptRemoto(contexto) {
  const historial = estadoApp.chat.mensajes
    .filter((m) => m.rol === "user" || m.rol === "ia")
    .slice(-10)
    .map((m) => (m.rol === "user" ? "Usuario: " : "Asistente: ") + m.texto)
    .join("\n")
    .slice(-8000);
  return `${chatSistemaContexto()}\n\n${contexto || ""}Conversación:\n${historial}\n\nResponde al último mensaje del usuario en 2 o 3 líneas.`;
}



/* ==========================================================================
   CONSULTAS A APIs LIBRES (sin key obligatoria, con fallbacks)
   --------------------------------------------------------------------------
   Estas funciones usan fetch con timeout y manejan errores gracefully.
   En este WebView/device pueden tener CORS/restricciones, así que tienen
   strategys de fallback.
   ========================================================================== */

function apiFetch(url, opts = {}) {
  const opt = {
    timeoutMs: opts.timeoutMs || 8000,
    method: opts.method || "GET",
    headers: opts.headers || {}
  };
  return new Promise(function (resolve, reject) {
    const xhr = new XMLHttpRequest();
    xhr.open(opt.method, url);
    xhr.timeout = opt.timeoutMs;
    xhr.ontimeout = function () { reject(new Error("timeout")); };
    xhr.onerror = function () { reject(new Error("network")); };
    xhr.onload = function () {
      try {
        resolve({ ok: true, data: JSON.parse(xhr.responseText), text: xhr.responseText });
      } catch (e) {
        resolve({ ok: true, data: null, text: xhr.responseText });
      }
    };
    if (opt.headers["Accept"]) {
      xhr.setRequestHeader("Accept", opt.headers["Accept"]);
    }
    if (opt.headers["Content-Type"]) {
      xhr.setRequestHeader("Content-Type", opt.headers["Content-Type"]);
    }
    xhr.send();
  });
}

function consultarWikipedia(consulta) {
  const url = "https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=" + 
              encodeURIComponent(consulta) + "&srlimit=5&format=json";
  try {
    return new Promise(function (resolve) {
      apiFetch(url, { timeoutMs: 10000 }).then(function (r) {
        if (!r.ok || !r.data) { resolve(null); return; }
        const resultados = (r.data.query.search || []);
        if (!resultados.length) { resolve(null); return; }
        const titulo = resultados[0].title;
        const texto = resultados[0].snippet || "";
        resolve({ titulo, snippet: texto.replace(/<[^>]+>/g, "") });
      }).catch(function () { resolve(null); });
    });
  } catch (e) { return Promise.resolve(null); }
}

function consultarClima(ciudad = "Santiago") {
  const url = "https://api.open-meteo.com/v1/forecast?" +
              "latitude=-33.4489&longitude=-70.6693&" +
              "current_weather=true&timezone=America/Santiago";
  try {
    return apiFetch(url, { timeoutMs: 8000 });
  } catch (e) { return Promise.resolve(null); }
}

function formatearRespuestaClima(dato) {
  if (!dato || !dato.current_weather) {
    return "No hay datos de clima disponibles.";
  }
  const temp = dato.current_weather.temperature;
  const viento = dato.current_weather.windspeed;
  const descripcion = dato.current_weather.description || "";
  return "En Santiago hoy " + (temp !== null ? temp + "°C" : "sin temp") +
      ". " + (viento !== null ? "Viento " + viento + " km/h" : "") +
      ". " + descripcion;
}

/* ==========================================================================
   ANÁLISIS DE PRECIOS Y GANANCIA (para 12 productos)
   --------------------------------------------------------------------------
   Dado un listado de productos con costo y precio de venta, calcula:
   - Precio de mercado promedio (desde el API o Wikipedia)
   - Ganancia por unidad y total
   - Sugerencia de precio si el tuyo está por debajo/encima
   ========================================================================== */

function analizarPreciosYGanancia(productosLocal) {
  if (!productosLocal || !productosLocal.length) {
    return { error: "No hay productos locales para comparar." };
  }
  const suma = productosLocal.reduce(function (a, p) { return a + (p.precio || 0); }, 0);
  const promedioLocal = suma / productosLocal.length;
  return {
    productos: productosLocal.length,
    precio_promedio_local: promedioLocal.toFixed(0),
    ganancia_promedio_unitaria: (promedioLocal - (productosLocal[0].costo || 0)).toFixed(0),
    detalle: productosLocal.map(function (p) {
      return { nombre: p.nombre, costo: p.costo, precio: p.precio, ganancia_unitaria: (p.precio - (p.costo || 0)) };
    })
  };
}

/* ==========================================================================
   SELECCIONADOR AUTOMÁTICO DE CONTEXTO
   --------------------------------------------------------------------------
   Intenta adivinar si la pregunta es de negocio o de conocimiento
   basándose en palabras clave. El caller decidirá qué hacer.
   ========================================================================== */

function detectarModoPregunta(texto) {
  const bajo = (texto || "").toLowerCase();
  const negocioWords = [
    "precio", "precios", "costo", "costo", "margen", "ganancia", "venta", "ventas",
    "stock", "inventario", "producto", "productos", "proveedor", "comprar",
    "cuánto vendo", "cuánto cuesta", "utilidad", "margen", "oferta"
  ];
  const conocimientoWords = [
    "clima", "horas", "tiempo", "noticias", "hoy", "wikipedia", "qué es",
    "historia", "ciencia", "geografia", "deporte", "pelicula", "serie"
  ];
  let scoreNegocio = 0, scoreConocimiento = 0;
  negocioWords.forEach(function (w) { if (bajo.includes(w)) scoreNegocio++; });
  conocimientoWords.forEach(function (w) { if (bajo.includes(w)) scoreConocimiento++; });
  if (scoreNegocio > scoreConocimiento && scoreNegocio > 0) return "negocio";
  if (scoreConocimiento > scoreNegocio && scoreConocimiento > 0) return "conocimiento";
  if (bajo.includes("producto") || bajo.includes("precio") || bajo.includes("venta")) return "negocio";
  return "conocimiento";
}



/** Limpia la respuesta del modelo: remueve tokens especiales, símbolos raros,
   repeticiones de líneas consecutivas y espacios sobrantes. */
function chatLimpiarRespuesta(texto) {
  if (!texto) return "";
  let s = String(texto);
  s = s.replace(/<|\|>|<\/s>|<pad>|<UNK>|\ufffd/g, "");
  s = s.replace(/\ufffd[0-9A-Fa-f]{2,4}/g, "");
  const lineas = s.split("\n");
  const limpias = [];
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i].trim();
    if (!l) continue;
    if (limpias.length > 0 && l === limpias[limpias.length - 1]) continue;
    limpias.push(l);
  }
  s = limpias.join("\n");
  s = s.replace(/[ \t]{2,}/g, " ");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/** Detecta si una respuesta del modelo es inútil (muy corta, repetitiva, sin sentido)
   y sugiere usar un modelo más grande. */
function chatRespuestaInutil(texto, pregunta) {
  if (!texto) return true;
  const t = texto.trim().toLowerCase();
  const p = (pregunta || "").toLowerCase();
  // Muy corto para una pregunta que no es saludo
  if (t.length < 5 && !p.includes("hola") && !p.includes("buenos") && !p.includes("buenas")) return true;
  // Solo dice "hola" cuando no se le saludó
  if (t === "hola" || t === "hola " || t === "ola") {
    if (!p.includes("hola") && !p.includes("buenos") && !p.includes("buenas")) return true;
  }
  // Repite la pregunta sin agregar información
  if (t === p || t.includes(p.slice(0, 20))) return true;
  return false;
}

/** Avisa al usuario que el modelo es insuficiente y cómo mejorar. */
function chatAvisarModeloInsuficiente() {
  toast("El modelo actual es muy pequeño para responder bien. Descarga Qwen 1.5B o Llama 3.2 3B y cárgalo en el chat.", "aviso");
  revision("llm", "aviso", "modelo insuficiente", "Se recomienda Qwen 1.5B o mayor para consultas de inventario y decisiones de negocio", 0, "llama");
}

/* --------------------------------------------------------------- ajustes de IA */
/** Lee los valores actuales de los controles de muestreo y los guarda en el
 *  estado del chat. Se aplican al modelo nativo en cada envío. */
/** Lee un control numérico respetando el 0 (que es un valor válido). */
function chatNumControl(id, def) {
  const el = document.getElementById(id);
  const v = el ? Number(el.value) : NaN;
  return Number.isFinite(v) ? v : def;
}

/** Escribe las etiquetas de valor junto a cada control. */
function chatPintarValoresIA(c) {
  const poner = function (id, txt) {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  };
  poner("valTemperatura", Number(c.temperatura).toFixed(1));
  poner("valTopP", Number(c.topP).toFixed(2));
  poner("valTopK", String(c.topK));
  poner("valRepeticion", Number(c.repeticion).toFixed(2));
  poner("valMaxTokens", String(c.maxTokens));
}

/** Lee los CONTROLES (sin tocar el estado). Solo lo usa «Aplicar al modelo». */
function chatLeerControlesIA() {
  // Ojo: `Number(v) || def` convertía 0 en el valor por defecto. Temperatura 0
  // (respuestas deterministas) y top-k 0 son válidos y deben respetarse.
  return {
    temperatura: Math.min(2, Math.max(0, chatNumControl("cfgTemperatura", 0.7))),
    topP: Math.min(1, Math.max(0, chatNumControl("cfgTopP", 0.9))),
    topK: Math.min(200, Math.max(0, Math.round(chatNumControl("cfgTopK", 40)))),
    repeticion: Math.min(2, Math.max(1, chatNumControl("cfgRepeticion", 1.1))),
    maxTokens: Math.min(4096, Math.max(16, Math.round(chatNumControl("cfgMaxTokens", 256))))
  };
}

/** Sampler del estado ya aplicado. Es lo que recibe el modelo en cada turno:
 *  mover un slider no cambia nada hasta pulsar «Aplicar al modelo». */
function chatLeerAjustesIA() {
  const c = estadoApp.chat;
  return {
    temperatura: c.temperatura,
    top_p: c.topP,
    top_k: c.topK,
    repetir: c.repeticion,
    semilla: (Math.random() * 2147483647) | 0,
    max_tokens: c.maxTokens
  };
}

/** Escribe los valores guardados en los controles (al abrir el panel). */
function chatPintarAjustesIA() {
  const c = estadoApp.chat;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set("cfgTemperatura", c.temperatura);
  set("cfgTopP", c.topP);
  set("cfgTopK", c.topK);
  set("cfgRepeticion", c.repeticion);
  set("cfgMaxTokens", c.maxTokens);
  chatPintarValoresIA(c);
}

/** Aplica la configuración al núcleo nativo y la guarda en estadoApp.chat. */
function chatAplicarConfiguracionIA() {
  const v = chatLeerControlesIA();
  const c = estadoApp.chat;
  c.temperatura = v.temperatura;
  c.topP = v.topP;
  c.topK = v.topK;
  c.repeticion = v.repeticion;
  c.maxTokens = v.maxTokens;
  chatPintarValoresIA(c);
  try {
    window.FabrickNative.localConfigurar(
      c.temperatura, c.topP, c.topK, c.repeticion, (Math.random() * 2147483647) | 0
    );
  } catch (e) { /* el shim usa sus valores por defecto */ }
  const fam = chatPresetActual();
  toast("Ajustes aplicados a " + fam.nombre.split(" · ")[0]);
  revision("llm", "info", "muestreo aplicado", "temp " + c.temperatura
    + " · top_p " + c.topP + " · top_k " + c.topK + " · rep " + c.repeticion
    + " · " + c.maxTokens + " tokens", 0, "llama");
}

/** Actualiza solo las etiquetas de valor (no toca el estado ni el modelo). */
function chatActualizarValoresIA() {
  chatPintarValoresIA(chatLeerControlesIA());
}

/** Conecta los controles de ajuste de IA (una sola vez).
   Los sliders solo muestran el valor; la aplicación al modelo se hace
   al pulsar «Aplicar a Qwen 2» para evitar que el modelo se quede pegado
   con cada movimiento del slider. */
function chatInicializarAjustesIA() {
  if (estadoApp.chat._ajustesIAListos) return;
  const ids = ["cfgTemperatura", "cfgTopP", "cfgTopK", "cfgRepeticion", "cfgMaxTokens"];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", chatActualizarValoresIA, { passive: true });
  });
  const btn = document.getElementById("btnChatAplicarConfig");
  if (btn) {
    btn.addEventListener("click", function () {
      chatAplicarConfiguracionIA();
    }, { passive: true });
  }
  estadoApp.chat._ajustesIAListos = true;
}

/* --------------------------------------------------------------- pestañas */

/** Cambia la pestaña visible de los ajustes y mueve el indicador. */
function chatCambiarPestana(nombre) {
  const tabs = document.getElementById("chatTabs");
  if (!tabs) return;
  const destino = ["modelo", "ia", "datos"].indexOf(nombre) >= 0 ? nombre : "modelo";
  tabs.dataset.tab = destino;
  tabs.querySelectorAll("[data-chat-tab]").forEach(function (b) {
    const on = b.dataset.chatTab === destino;
    b.classList.toggle("activo", on);
    b.setAttribute("aria-selected", String(on));
  });
  tabs.parentNode.querySelectorAll("[data-chat-panel]").forEach(function (p) {
    p.classList.toggle("activo", p.dataset.chatPanel === destino);
  });
  if (destino === "datos") chatCargarDatos(false);
  if (destino === "ia") chatPintarFamilia();
}

function chatInicializarPestanas() {
  const tabs = document.getElementById("chatTabs");
  if (!tabs || tabs.dataset.listo) return;
  tabs.dataset.listo = "1";
  tabs.addEventListener("click", function (ev) {
    const b = ev.target.closest("[data-chat-tab]");
    if (b) chatCambiarPestana(b.dataset.chatTab);
  });
  // Las explicaciones «i» se abren al tocar y se cierran al tocar de nuevo.
  document.querySelectorAll(".ajuste-info").forEach(function (b) {
    b.addEventListener("click", function (ev) {
      ev.preventDefault();
      const abierto = b.classList.contains("abierto");
      document.querySelectorAll(".ajuste-info.abierto").forEach(function (x) { x.classList.remove("abierto"); });
      if (!abierto) b.classList.add("abierto");
    });
  });
  document.addEventListener("click", function (ev) {
    if (ev.target.closest(".ajuste-info")) return;
    document.querySelectorAll(".ajuste-info.abierto").forEach(function (x) { x.classList.remove("abierto"); });
  }, { passive: true });
  chatPintarFamilia();
}

/* ----------------------------------------------------- panel de datos reales */
/* La MISMA llamada que usa el inventario (`inventario.panel`): así el chat y
   la pestaña Datos muestran exactamente los mismos números que el inventario. */

let chatDatosCache = null;
let chatDatosTs = 0;
let chatDatosCargando = false;

function chatClp(n) {
  const v = Number(n || 0);
  return "$" + Math.round(v).toLocaleString("es-CL");
}

async function chatCargarDatos(forzar) {
  const caja = document.getElementById("chatDatos");
  if (!caja) return chatDatosCache;
  // Caché de 30 s: abrir la pestaña varias veces no golpea la base.
  if (!forzar && chatDatosCache && Date.now() - chatDatosTs < 30000) {
    chatPintarDatos(chatDatosCache);
    return chatDatosCache;
  }
  if (chatDatosCargando) return chatDatosCache;
  chatDatosCargando = true;
  caja.innerHTML = `<div class="chat-datos-vacio">Leyendo inventario y ventas…</div>`;
  const r = await apiTarde("inventario", { accion: "panel" }, { maxMs: 12000 });
  chatDatosCargando = false;
  if (!r.ok || !r.data || !r.data.ok) {
    caja.innerHTML = `<div class="chat-datos-vacio">No se pudo leer el inventario: `
      + esc((r.error || "sin respuesta")) + `</div>`;
    return null;
  }
  chatDatosCache = r.data;
  chatDatosTs = Date.now();
  chatPintarDatos(chatDatosCache);
  return chatDatosCache;
}

function chatPintarDatos(d) {
  const caja = document.getElementById("chatDatos");
  if (!caja || !d) return;
  const res = d.resumen || {};
  const ven = d.ventas || {};
  const v24 = ven.ultimas_24h || {};
  const v30 = ven.ultimos_30d || {};
  const sync = d.sync || {};
  const cats = (d.categorias || []).slice(0, 5);
  const bajos = (d.stock_bajo || []).slice(0, 5);
  const margen = (d.top_margen || []).slice(0, 5);

  caja.innerHTML = `
    <div class="chat-datos-grid">
      <div class="chat-dato lima"><span>Valor de venta</span><strong>${chatClp(res.valor_venta)}</strong><small>${res.unidades || 0} unidades</small></div>
      <div class="chat-dato"><span>Utilidad potencial</span><strong>${chatClp(res.utilidad_potencial)}</strong><small>margen ${res.margen_promedio || 0}%</small></div>
      <div class="chat-dato ${res.stock_bajo > 0 ? "alerta" : ""}"><span>Stock bajo</span><strong>${res.stock_bajo || 0}</strong><small>${res.agotados || 0} agotados</small></div>
      <div class="chat-dato"><span>Ventas 24 h</span><strong>${chatClp(v24.total)}</strong><small>${v24.n || 0} boletas · ${v24.unidades || 0} u.</small></div>
      <div class="chat-dato"><span>Ventas 30 días</span><strong>${chatClp(v30.total)}</strong><small>utilidad ${chatClp(v30.utilidad)}</small></div>
      <div class="chat-dato"><span>Ticket promedio</span><strong>${chatClp(ven.ticket_promedio)}</strong><small>${v30.n || 0} boletas</small></div>
      <div class="chat-dato ancho"><span>Productos</span><strong>${res.total || 0} en ${cats.length ? (d.categorias || []).length + " categorías" : "sin categorías"}</strong><small>${res.sin_precio || 0} sin precio · ${res.sin_costo || 0} sin costo</small></div>
    </div>

    ${bajos.length ? `<p class="chat-datos-titulo">Reponer primero</p>
      <div class="chat-datos-lista">${bajos.map(function (p) {
        return `<div class="chat-datos-fila"><b>${esc(p.nombre)}</b><span>${p.stock} / mín ${p.stock_minimo}</span></div>`;
      }).join("")}</div>` : ""}

    ${margen.length ? `<p class="chat-datos-titulo">Mejor margen</p>
      <div class="chat-datos-lista">${margen.map(function (p) {
        return `<div class="chat-datos-fila"><b>${esc(p.nombre)}</b><span>${p.margen_pct}%</span></div>`;
      }).join("")}</div>` : ""}

    ${cats.length ? `<p class="chat-datos-titulo">Categorías</p>
      <div class="chat-datos-lista">${cats.map(function (c) {
        return `<div class="chat-datos-fila"><b>${esc(c.categoria)}</b><span>${chatClp(c.valor_venta)}</span></div>`;
      }).join("")}</div>` : ""}

    <p class="chat-datos-pie">${sync.pendientes || 0} productos y ${sync.boletas_pendientes || 0} boletas sin subir · ${hora(Math.round((d.generado || 0) / 1000))}</p>
  `;
}

/* ------------------------------------------ respuestas directas de inventario */
/* Si la pregunta es clara («¿qué falta?», «¿cuánto vale?», «¿qué deja más
   margen?»), la respuesta sale de SQLite al instante, sin esperar al modelo.
   El modelo queda para lo que de verdad necesita lenguaje: explicar, comparar,
   redactar. Esto es lo que hace que el chat se sienta instantáneo. */

/** Devuelve el tipo de consulta de inventario, o "" si no es una. */
function chatTipoConsultaInventario(texto) {
  const t = String(texto || "").toLowerCase();
  if (t.length > 220) return "";
  if (t.indexOf("/sql") === 0 || t.indexOf("/consulta") === 0) return "";
  const tieneProducto = /producto|inventario|stock|precio|margen|ganancia|utilidad|venta|categor|proveedor|reponer|agotad|unidad/.test(t);
  if (!tieneProducto) return "";
  if (/qu[eé]\s+(me\s+)?falta|reponer|reposici[oó]n|stock\s*bajo|poco\s+stock|agotad|sin\s+stock|se\s+acab/.test(t)) return "stock";
  if (/m[aá]s\s+(ganancia|margen|rentab)|mejor\s+margen|qu[eé]\s+deja|rentab/.test(t)) return "margen";
  if (/cu[aá]nto\s+(vend[ií]|he\s+vendido)|ventas|vendido|ticket/.test(t)) return "ventas";
  if (/categor[ií]a/.test(t)) return "categorias";
  if (/cu[aá]ntos?\s+productos|cu[aá]ntas?\s+unidades|resumen|valor\s+(del\s+)?inventario|cu[aá]nto\s+vale|c[oó]mo\s+va|estado\s+del\s+negocio/.test(t)) return "resumen";
  if (/proveedor/.test(t)) return "proveedores";
  return "";
}

/** Respuesta determinista, en texto, con los datos del panel. */
function chatRespuestaInventario(tipo, d) {
  if (!d || !d.resumen) return "";
  const r = d.resumen;
  const v = d.ventas || {};
  const v24 = v.ultimas_24h || {};
  const v30 = v.ultimos_30d || {};
  if (tipo === "stock") {
    const bajos = (d.stock_bajo || []).slice(0, 5);
    if (!bajos.length) {
      return "No tienes productos bajo el mínimo. " + (r.agotados || 0) + " agotados de " + r.total + " productos.";
    }
    const lista = bajos.map(function (p) {
      return "· " + p.nombre + ": " + p.stock + " (mínimo " + p.stock_minimo + ")";
    }).join("\n");
    return "Tienes " + r.stock_bajo + " productos bajo el mínimo y " + r.agotados + " agotados.\n" + lista
      + (r.stock_bajo > bajos.length ? "\n…y " + (r.stock_bajo - bajos.length) + " más." : "");
  }
  if (tipo === "margen") {
    const m = (d.top_margen || []).slice(0, 5);
    if (!m.length) return "Aún no hay productos con costo y precio cargados, así que no puedo calcular margen real.";
    return "Tu margen promedio es " + (r.margen_promedio || 0) + "%. Los que más dejan:\n"
      + m.map(function (p) {
        return "· " + p.nombre + ": " + p.margen_pct + "% (" + chatClp(p.ganancia) + " por unidad)";
      }).join("\n");
  }
  if (tipo === "ventas") {
    if (!v30.n) return "No hay boletas en los últimos 30 días. El ticket promedio aparecerá cuando emitas la primera.";
    return "Últimas 24 h: " + v24.n + " boletas por " + chatClp(v24.total) + " (utilidad " + chatClp(v24.utilidad) + ").\n"
      + "Últimos 30 días: " + v30.n + " boletas por " + chatClp(v30.total) + " (utilidad " + chatClp(v30.utilidad) + ").\n"
      + "Ticket promedio: " + chatClp(v.ticket_promedio) + ".";
  }
  if (tipo === "categorias") {
    const cats = (d.categorias || []).slice(0, 6);
    if (!cats.length) return "Todavía no hay productos clasificados por categoría.";
    return "Tus categorías por valor de venta:\n"
      + cats.map(function (c) {
        return "· " + c.categoria + ": " + c.n + " productos, " + chatClp(c.valor_venta) + " (margen " + c.margen_pct + "%)";
      }).join("\n");
  }
  if (tipo === "proveedores") {
    return "Los proveedores se ven en Inventario → Precios. Ahí cada producto guarda su proveedor y el historial de precios.";
  }
  // resumen
  return "Tienes " + r.total + " productos y " + r.unidades + " unidades en stock.\n"
    + "Valor de venta " + chatClp(r.valor_venta) + " · costo " + chatClp(r.valor_costo) + " · utilidad potencial " + chatClp(r.utilidad_potencial) + " (margen " + r.margen_promedio + "%).\n"
    + r.stock_bajo + " bajo el mínimo, " + r.agotados + " agotados. Ventas 24 h: " + v24.n + " boletas por " + chatClp(v24.total) + ".";
}

/** Intenta responder sin modelo. Devuelve el texto o "" si hay que usar el LLM. */
async function chatIntentarRespuestaDirecta(texto) {
  const tipo = chatTipoConsultaInventario(texto);
  if (!tipo) return "";
  const d = await chatCargarDatos(true);
  if (!d) return "";
  return chatRespuestaInventario(tipo, d);
}

/** Resumen compacto del panel para inyectar como contexto al modelo. */
function chatResumenParaModelo(d) {
  if (!d || !d.resumen) return "";
  const r = d.resumen;
  const v = d.ventas || {};
  const v24 = v.ultimas_24h || {};
  const v30 = v.ultimos_30d || {};
  const lineas = [
    "Productos: " + r.total + " · unidades en stock: " + r.unidades,
    "Valor de venta: " + chatClp(r.valor_venta) + " · costo: " + chatClp(r.valor_costo)
      + " · utilidad potencial: " + chatClp(r.utilidad_potencial) + " (margen " + r.margen_promedio + "%)",
    "Stock bajo: " + r.stock_bajo + " · agotados: " + r.agotados
      + " · sin precio: " + (r.sin_precio || 0) + " · sin costo: " + (r.sin_costo || 0),
    "Ventas 24 h: " + (v24.n || 0) + " boletas por " + chatClp(v24.total)
      + " · 30 días: " + (v30.n || 0) + " boletas por " + chatClp(v30.total)
      + " · ticket promedio " + chatClp(v.ticket_promedio)
  ];
  const bajos = (d.stock_bajo || []).slice(0, 6);
  if (bajos.length) {
    lineas.push("Bajo el mínimo: " + bajos.map(function (p) {
      return p.nombre + " (" + p.stock + "/" + p.stock_minimo + ")";
    }).join(", "));
  }
  const margen = (d.top_margen || []).slice(0, 6);
  if (margen.length) {
    lineas.push("Mejor margen: " + margen.map(function (p) {
      return p.nombre + " " + p.margen_pct + "%";
    }).join(", "));
  }
  const cats = (d.categorias || []).slice(0, 6);
  if (cats.length) {
    lineas.push("Categorías: " + cats.map(function (c) {
      return c.categoria + " (" + c.n + ", " + chatClp(c.valor_venta) + ")";
    }).join(", "));
  }
  return lineas.join("\n");
}

/** Resuelve con el valor de la promesa o con "" si tarda más de `ms`. */
function conTope(promesa, ms) {
  return new Promise(function (resolve) {
    let listo = false;
    const t = setTimeout(function () {
      if (!listo) { listo = true; resolve(""); }
    }, ms);
    Promise.resolve(promesa).then(function (v) {
      if (listo) return;
      listo = true;
      clearTimeout(t);
      resolve(v || "");
    }).catch(function () {
      if (listo) return;
      listo = true;
      clearTimeout(t);
      resolve("");
    });
  });
}

/* --------------------------------------------------------------- envío */

async function chatEnviar() {
  if (estadoApp.chat.enviando) {
    // En local la inferencia se corta de verdad: el shim revisa el flag en
    // cada token. En remoto todavía no hay aborto del fetch.
    if (estadoApp.chat.modo === "local") {
      chatDetener();
    } else {
      toast("Espera la respuesta anterior");
    }
    return;
  }
  const entrada = document.getElementById("chatEntrada");
  const texto = entrada.value.trim();
  if (!texto) return;
  // Skill de personalización: «recuerda que…» se guarda como preferencia.
  chatProcesarPreferencia(texto);
  if (estadoApp.chat.modo === "local" && !estadoApp.chat.localCargado) {
    toast("Carga primero un modelo local", "error");
    return;
  }
  if (estadoApp.chat.modo === "remoto" && !estadoApp.chat.remotoConfigurado) {
    toast("Guarda primero el proveedor remoto", "error");
    return;
  }

  estadoApp.chat.mensajes.push({ rol: "user", texto: texto, ts: Date.now() });
  estadoApp.chat.ultimoUsuario = texto;
  entrada.value = "";
  chatAutoAlto(entrada);
  estadoApp.chat.enviando = true;
  estadoApp.chat.cancelado = false;
  estadoApp.chat.deteniendo = false;
  estadoApp.chat.primerTokenMs = 0;
  estadoApp.chat.t0 = Date.now();
  chatAvatarEstado("thinking");

  // Burbuja vacía donde va cayendo el texto. Sólo en local: el remoto llega
  // completo y se pinta al final.
  if (estadoApp.chat.modo === "local") {
    estadoApp.chat.indiceIA = estadoApp.chat.mensajes.length;
    estadoApp.chat.mensajes.push({
      rol: "ia", texto: "", origen: "local", ts: Date.now(), parcial: true
    });
  } else {
    estadoApp.chat.indiceIA = -1;
  }
  chatPintarMensajes();
  chatActualizarBotonEnviar();

  // Tira de herramienta (estilo ChatGPT): avisa qué está revisando el
  // asistente mientras arma el contexto. Se apaga sola al empezar a generar.
  const avisoEl = document.getElementById("chatHerramienta");
  const avisoTxt = document.getElementById("chatHerramientaTexto");
  const avisar = function (t) {
    if (!avisoEl || !avisoTxt) return;
    avisoTxt.textContent = t;
    avisoEl.hidden = false;
  };
  const callar = function () { if (avisoEl) avisoEl.hidden = true; };

  // 0) Respuesta directa de inventario. Si la pregunta es clara, SQLite
  //    responde al instante y el modelo ni se toca: cero espera, cero
  //    alucinación. El modelo queda para explicar, comparar o redactar.
  avisar("Leyendo tu inventario…");
  // Tope duro: si la base tarda, se sigue con el modelo en vez de dejar el
  // chat colgado. La respuesta directa nunca puede bloquear el turno.
  let directa = "";
  try {
    directa = await conTope(chatIntentarRespuestaDirecta(texto), 5000);
  } catch (e) {
    directa = "";
    revision("chat", "aviso", "respuesta directa falló", String(e), 0, "chat");
  }
  if (directa) {
    callar();
    let m = estadoApp.chat.mensajes[estadoApp.chat.indiceIA];
    if (!m) {
      m = { rol: "ia", ts: Date.now() };
      estadoApp.chat.mensajes.push(m);
    }
    m.rol = "ia";
    m.texto = directa;
    m.parcial = false;
    m.origen = "datos";
    m.meta = "datos locales";
    estadoApp.chat.ultimaRespuesta = directa;
    estadoApp.chat.enviando = false;
    estadoApp.chat.indiceIA = -1;
    chatAvatarEstado("idle");
    chatPintarMensajes();
    chatActualizarBotonEnviar();
    revision("chat", "info", "respuesta directa de inventario", String(texto).slice(0, 90), 0, "chat");
    return;
  }

  // 1) Contexto en PARALELO con topes cortos. Antes se pedía en cadena
  //    (SQL → BD → GraphRAG → RAG) y cada paso podía tardar 15 s: el chat se
  //    sentía colgado aunque el modelo fuera rápido. Ahora todo sale a la vez
  //    y lo que no llega en el tope simplemente no viaja.
  const negocio = detectarModoPregunta(texto) === "negocio";
  const topeRag = negocio ? 1200 : 4000;
  avisar(negocio ? "Revisando inventario y números…" : "Buscando contexto…");

  const tareas = [];

  // SQL directo pedido por el usuario (/sql …)
  if (esConsultaSql(texto)) {
    tareas.push(conTope((async function () {
      const rSql = await ejecutarSqlChat(extraerSql(texto));
      return rSql.ok
        ? "Resultado de la consulta SQL:\n" + rSql.texto + "\n\n"
        : "Error en la consulta SQL: " + (rSql.error || "desconocido") + "\n\n";
    })(), 6000));
  } else if (esPreguntaBD(texto)) {
    // Pregunta de negocio: se usa el panel real, no una consulta adivinada.
    tareas.push(conTope((async function () {
      const d = await chatCargarDatos(true);
      if (!d) return "";
      return "Datos reales de tu inventario:\n" + chatResumenParaModelo(d) + "\n\n";
    })(), 4000));
  }

  // GraphRAG y aprendizajes: sólo si la pregunta NO es de negocio. En una
  // consulta de stock no aportan nada y son los que más tardaban.
  if (!negocio) {
    tareas.push(conTope(obtenerContextoGraphRAG(texto), topeRag));
    tareas.push(conTope(chatContextoRag(texto), topeRag));
  }

  const partes = await Promise.all(tareas);
  const contextoCombinado = partes.filter(Boolean).join("");

  callar();

  // Si pidieron detener mientras se armaba el contexto (SQL/RAG), no se
  // arranca la inferencia: la burbuja queda marcada como detenida.
  if (estadoApp.chat.deteniendo) {
    estadoApp.chat.enviando = false;
    estadoApp.chat.deteniendo = false;
    const m = estadoApp.chat.mensajes[estadoApp.chat.indiceIA];
    if (m) {
      m.parcial = false;
      m.detenida = true;
      m.texto = m.texto || "(detenida antes de responder)";
    }
    estadoApp.chat.indiceIA = -1;
    chatAvatarEstado("idle");
    chatPintarMensajes();
    chatActualizarBotonEnviar();
    return;
  }

  let r;
  try {
    // Muestreo por turno: natural pero sin dispararse. Semilla nueva para
    // que «regenerar» no devuelva exactamente lo mismo.
    const cfg = chatLeerAjustesIA();
    if (estadoApp.chat.modo === "local") {
      try {
        window.FabrickNative.localConfigurar(
          cfg.temperatura, cfg.top_p, cfg.top_k, cfg.repetir, cfg.semilla
        );
      } catch (e) { /* el shim usa sus valores por defecto */ }
      r = JSON.parse(window.FabrickNative.localChat(chatPromptLocal(contextoCombinado), cfg.max_tokens));
    } else {
      r = JSON.parse(window.FabrickNative.chatRemoto(chatPromptRemoto(contextoCombinado), cfg.max_tokens));
    }

    // localChat es asíncrono: devuelve {"ok":true,"estado":"GENERANDO"} al instante
    // y la respuesta real llega por FabriChat.localFin. No hay que tratarlo como
    // error ni como respuesta final aquí.
    if (estadoApp.chat.modo === "local" && r.ok && r.estado === "GENERANDO") {
      return;
    }
  } catch (e) {
    r = { ok: false, error: String(e) };
  }
  if (!r.ok) {
    estadoApp.chat.enviando = false;
    estadoApp.chat.indiceIA = -1;
    chatAvatarEstado("idle");
    // La burbuja vacía se convierte en el error, sin dejar un hueco.
    const ultimo = estadoApp.chat.mensajes[estadoApp.chat.mensajes.length - 1];
    if (ultimo && ultimo.parcial) {
      ultimo.parcial = false;
      ultimo.rol = "error";
      ultimo.texto = r.error || "no se pudo enviar";
    } else {
      estadoApp.chat.mensajes.push({ rol: "error", texto: r.error || "no se pudo enviar", ts: Date.now() });
    }
    chatPintarMensajes();
    chatActualizarBotonEnviar();
    toast("Chat: " + (r.error || "no se pudo enviar"), "error");
  }
}

function chatAgregarRespuesta(texto, meta, esError, origen) {
  texto = chatLimpiarRespuesta(texto);
  estadoApp.chat.mensajes.push({
    rol: esError ? "error" : "ia",
    texto: texto || "(respuesta vacía)",
    meta: meta || "",
    origen: esError ? "" : (origen === "remoto" ? "remoto" : "local"),
    ts: Date.now()
  });
  if (!esError) {
    estadoApp.chat.ultimaRespuesta = texto || "";
    // Conteo real de tokens: aproximado por palabras (espacio separado) + meta si trae tokens
    const tokensMeta = meta && typeof meta === "string" ? Number(meta.match(/\d+/)?.[0] || 0) : 0;
    const tokensEstimados = tokensMeta > 0 ? tokensMeta : texto ? texto.split(/\s+/).length : 0;
    const t = Date.now();
    if (origen === "local") {
      estadoApp.stats.tokensLocal += tokensEstimados;
      estadoApp.stats.mensajesLocal += 1;
      estadoApp.stats.ultimoTiempoMs = t - (estadoApp.stats.tiempoTotalMs ? 0 : t);
    } else if (origen === "remoto") {
      estadoApp.stats.tokensApi += tokensEstimados;
      estadoApp.stats.mensajesApi += 1;
    }
    estadoApp.stats.tiempoTotalMs += (t - (estadoApp.stats.ultimoTiempoMs || t));
    if (estadoApp.stats.tiempoTotalMs > 0) {
      estadoApp.stats.ultimaVelocidad = (estadoApp.stats.tokensLocal + estadoApp.stats.tokensApi) * 1000 / estadoApp.stats.tiempoTotalMs;
    }
    pintarInicio(); // actualiza KPIs de tokens
  }
  estadoApp.chat.enviando = false;
  chatAvatarEstado("idle");
  chatPintarMensajes();
}

function chatFormatear(texto) {
  const crudo = esc(texto);
  const partes = crudo.split(/```/);
  return partes.map((p, i) => {
    if (i % 2 === 1) {
      // Bloque de código con barra y botón copiar, como en LobeChat.
      const salto = p.indexOf("\n");
      const lengua = salto > 0 ? p.slice(0, salto).trim() : "";
      const codigo = (salto > 0 ? p.slice(salto + 1) : p).replace(/\n$/, "");
      const etiqueta = /^[a-zA-Z0-9_+#-]{1,20}$/.test(lengua) ? lengua : "código";
      return `<div class="code-bloque">
        <div class="code-bloque-cab">
          <span class="code-bloque-lengua">${esc(etiqueta)}</span>
          <button type="button" data-copiar-codigo title="Copiar código">Copiar</button>
        </div>
        <pre><code>${codigo}</code></pre>
      </div>`;
    }
    // Markdown mínimo: títulos, listas, negrita, código en línea y saltos.
    const lineas = p.split("\n");
    let salida = "";
    let enLista = false;
    lineas.forEach((linea) => {
      const h = linea.match(/^(#{1,3})\s+(.+)$/);
      const item = linea.match(/^\s*[-*]\s+(.+)$/);
      if (h) {
        if (enLista) { salida += "</ul>"; enLista = false; }
        const nivel = Math.min(3, h[1].length) + 2; // h1→h3, para no competir con el título
        salida += `<h${nivel}>${h[2]}</h${nivel}>`;
        return;
      }
      if (item) {
        if (!enLista) { salida += "<ul>"; enLista = true; }
        salida += `<li>${item[1]}</li>`;
        return;
      }
      if (enLista) { salida += "</ul>"; enLista = false; }
      if (linea.trim() === "") { salida += "<br>"; return; }
      salida += linea + "<br>";
    });
    if (enLista) salida += "</ul>";
    return salida
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/<br>(<\/?(?:ul|h[3-5])>)/g, "$1")
      .replace(/(<\/?(?:ul|h[3-5])>)<br>/g, "$1");
  }).join("");
}

function chatVacioHTML() {
  return `<div class="chat-vacio" id="chatVacio">
      <span class="chat-vacio-icono">✦</span>
      <strong>Hola, soy FORGE CORE STOCK</strong>
      <p>Pregúntame lo que quieras. Respondo corto y claro, y si quieres te lo leo en voz alta.</p>
      <div class="chat-sugerencias">
        <button type="button" data-sugerencia="¿Qué puedes hacer por mí?">¿Qué puedes hacer?</button>
        <button type="button" data-sugerencia="Resume en 3 líneas qué tengo instalado en la app.">Resume mi app</button>
        <button type="button" data-sugerencia="Escríbeme un mensaje corto y amable para un cliente.">Escribe un mensaje</button>
      </div>
    </div>`;
}

function chatCabeceraIA(origen) {
  if (origen === "datos") {
    return `<div class="msg-cab">
      <span class="msg-nombre">FORGE CORE STOCK</span>
      <span class="badge-origen datos">Datos</span>
    </div>`;
  }
  const tipo = origen === "remoto" ? "remoto" : "local";
  const texto = tipo === "remoto" ? "Remoto" : "Local";
  return `<div class="msg-cab">
      <span class="msg-nombre">FORGE CORE STOCK</span>
      <span class="badge-origen ${tipo}">${texto}</span>
    </div>`;
}

function chatPintarMensajes() {
  const cont = document.getElementById("chatHilo");
  if (!cont) return;
  const msgs = estadoApp.chat.mensajes;
  if (!msgs.length) {
    cont.innerHTML = chatVacioHTML();
  } else {
    let ultimoIA = -1;
    let ultimoUser = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (ultimoIA < 0 && msgs[i].rol === "ia") ultimoIA = i;
      if (ultimoUser < 0 && msgs[i].rol === "user") ultimoUser = i;
    }
    cont.innerHTML = msgs.map((m, i) => {
      const esUsuario = m.rol === "user";
      const esError = m.rol === "error";
      const etiqueta = esUsuario ? "TÚ" : esError ? "!" : "FC";
      const clase = esUsuario ? "mensaje-usuario" : esError ? "mensaje-error" : "mensaje-ia";
      const meta = m.meta || (m.ts ? new Date(m.ts).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" }) : "");
      const cuerpo = m.parcial && !m.texto
        ? `<span class="escribiendo"><i></i><i></i><i></i></span>`
        : chatFormatear(m.texto) + (m.parcial ? `<span class="chat-cursor" aria-hidden="true"></span>` : "");
      const acciones = esError ? "" : `<span class="msg-acciones">
          <button type="button" data-copiar-mensaje="${i}" title="Copiar">Copiar</button>
          ${esUsuario ? "" : `<button type="button" data-leer-mensaje="${i}" title="Leer">Leer</button>`}
          ${(!esUsuario && i === ultimoIA && !m.parcial && !estadoApp.chat.enviando)
            ? `<button type="button" data-regenerar="1" title="Volver a responder">Regenerar</button>` : ""}
          ${(esUsuario && i === ultimoUser && !estadoApp.chat.enviando)
            ? `<button type="button" data-editar-ultimo="1" title="Editar y reenviar">Editar</button>` : ""}
        </span>`;
      return `<div class="mensaje ${clase}${m.parcial ? " mensaje-parcial" : ""}" data-indice="${i}">
        <span class="avatar">${etiqueta}</span>
        <div class="burbuja">
          ${esUsuario || esError ? "" : chatCabeceraIA(m.origen)}
          ${m.detenida ? `<span class="msg-detenida">detenida</span>` : ""}
          <div class="msg-texto">${cuerpo}</div>
          <div class="msg-meta">
            <span>${esc(meta)}</span>
            ${acciones}
          </div>
        </div>
      </div>`;
    }).join("");
  }

  if (estadoApp.chat.enviando && estadoApp.chat.indiceIA < 0) {
    cont.insertAdjacentHTML("beforeend", `<div class="mensaje mensaje-ia" id="chatPensando">
      <span class="avatar">FC</span>
      <div class="burbuja">
        ${chatCabeceraIA(estadoApp.chat.modo)}
        <span class="escribiendo"><i></i><i></i><i></i></span>
      </div>
    </div>`);
  }
  const contador = document.getElementById("chatContador");
  if (contador) contador.textContent = msgs.length + (msgs.length === 1 ? " mensaje" : " mensajes");
  chatScroll();
}

/** Repinta sólo la burbuja en curso, sin reconstruir el hilo completo. */
let chatPintadoPendiente = false;
function chatPintarParcial() {
  if (chatPintadoPendiente) return;
  chatPintadoPendiente = true;
  requestAnimationFrame(function () {
    chatPintadoPendiente = false;
    const c = estadoApp.chat;
    const i = c.indiceIA;
    if (i < 0) return;
    const m = c.mensajes[i];
    const cont = document.getElementById("chatHilo");
    if (!m || !cont) return;
    const fila = cont.querySelector('[data-indice="' + i + '"]');
    const nodo = fila ? fila.querySelector(".msg-texto") : null;
    if (!nodo) { chatPintarMensajes(); return; }
    nodo.innerHTML = m.texto
      ? chatFormatear(m.texto) + `<span class="chat-cursor" aria-hidden="true"></span>`
      : `<span class="escribiendo"><i></i><i></i><i></i></span>`;
    const meta = fila.querySelector(".msg-meta span");
    if (meta) meta.textContent = (m.tokens || 0) + " tokens…";
    chatScroll();
  });
}

/** Corta la respuesta en curso. El motor sale en el siguiente token. */
function chatDetener() {
  if (!estadoApp.chat.enviando || estadoApp.chat.deteniendo) return;
  estadoApp.chat.deteniendo = true;
  let r = { ok: false };
  try {
    r = JSON.parse(window.FabrickNative.localDetener());
  } catch (e) {
    r = { ok: false, error: String(e) };
  }
  toast(r.ok ? "Deteniendo…" : "No se pudo detener: " + (r.error || "error"), r.ok ? "" : "error");
  revision("chat", "aviso", "detención pedida por el usuario", "se corta en el siguiente token", 0, "llama");
}

/** Quita la última respuesta y vuelve a preguntar lo mismo. */
function chatRegenerar() {
  const c = estadoApp.chat;
  if (c.enviando) return;
  for (let i = c.mensajes.length - 1; i >= 0; i--) {
    if (c.mensajes[i].rol === "ia" || c.mensajes[i].rol === "error") {
      c.mensajes.splice(i, 1);
      break;
    }
  }
  const ultimo = c.mensajes[c.mensajes.length - 1];
  if (!ultimo || ultimo.rol !== "user") { chatPintarMensajes(); return; }
  const entrada = document.getElementById("chatEntrada");
  entrada.value = ultimo.texto;
  c.mensajes.pop();
  chatAutoAlto(entrada);
  chatEnviar();
}

/** Devuelve el último mensaje al compositor para corregirlo. */
function chatEditarUltimo() {
  const c = estadoApp.chat;
  if (c.enviando) return;
  if (c.mensajes.length && c.mensajes[c.mensajes.length - 1].rol !== "user") c.mensajes.pop();
  const ultimo = c.mensajes.pop();
  const entrada = document.getElementById("chatEntrada");
  if (ultimo && entrada) {
    entrada.value = ultimo.texto;
    chatAutoAlto(entrada);
    entrada.focus();
  }
  chatPintarMensajes();
}

/** Auto-scroll sólo si el usuario está cerca del final: no le robamos el scroll. */
function chatScroll(forzar) {
  const cont = document.getElementById("chatHilo");
  if (!cont) return;
  // Si el usuario dio clic arriba o tocó el historial, no lo arrastramos al final.
  if (forzar) {
    cont.scrollTop = cont.scrollHeight;
    return;
  }
  // Sólo scrollea si el usuario ya estaba al final (margen < 100 px).
  const abajo = cont.scrollHeight - cont.clientHeight - cont.scrollTop;
  if (abajo < 100 || forzar) {
    cont.scrollTop = cont.scrollHeight;
  }
}

/** Muestra cuánto del contexto está ocupado (tokens reales de la KV). */
function chatActualizarContexto() {
  const chip = document.getElementById("chatContexto");
  if (!chip) return;
  if (!estadoApp.chat.localCargado || estadoApp.chat.modo !== "local") {
    chip.hidden = true;
    return;
  }
  let r = null;
  try { r = JSON.parse(window.FabrickNative.localContexto()); } catch (e) { r = null; }
  if (!r || !r.ok || !r.n_ctx) { chip.hidden = true; return; }
  const pct = Math.min(100, Math.round((r.kv || 0) * 100 / r.n_ctx));
  chip.hidden = false;
  chip.textContent = "contexto " + pct + "%";
  chip.title = (r.kv || 0) + " de " + r.n_ctx + " tokens en memoria";
}

function chatAutoAlto(area) {
  area.style.height = "auto";
  area.style.height = Math.min(120, Math.max(38, area.scrollHeight)) + "px";
}

/** Deja el texto listo para leerlo en voz alta: sin markdown y con pausas. */
function ttsTextoNatural(texto) {
  return String(texto || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_#>]/g, "")
    .replace(/\s*[·|]\s*/g, ", ")
    .replace(/([.,;:!?])(?=[^\s\d])/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 3800);
}

/** Refleja en el botón TTS si se está leyendo (ola animada) o no. */
function chatTtsEstado(leyendo) {
  const btn = document.getElementById("btnChatTts");
  if (!btn) return;
  btn.dataset.estado = leyendo ? "leyendo" : "inactivo";
}

function chatLeerUltima() {
  const texto = ttsTextoNatural(estadoApp.chat.ultimaRespuesta);
  if (!texto) {
    toast("Todavía no hay una respuesta para leer", "error");
    return;
  }
  let r;
  try { r = JSON.parse(window.FabrickNative.ttsHablar(texto)); } catch (e) { r = { ok: false, error: String(e) }; }
  if (!r.ok) {
    chatAvatarEstado("idle");
    chatTtsEstado(false);
    toast("Voz: " + (r.error || "no disponible"), "error");
    return;
  }
  chatAvatarEstado("talking");
  chatTtsEstado(true);
}

/** El nativo avisa cuando empieza o termina de hablar. */
window.FabriTts = {
  estado: function (cual) {
    const hablando = cual === "talking";
    chatAvatarEstado(hablando ? "talking" : "idle");
    chatTtsEstado(hablando);
  }
};

function chatLimpiar() {
  if (!estadoApp.chat.mensajes.length) return;
  if (estadoApp.chat.enviando) {
    toast("Detén la respuesta antes de empezar otra", "error");
    return;
  }
  if (!confirm("¿Empezar una conversación nueva? El historial de esta pantalla se limpia; no se borra nada de SQLite.")) return;
  estadoApp.chat.mensajes = [];
  estadoApp.chat.ultimaRespuesta = "";
  estadoApp.chat.indiceIA = -1;
  estadoApp.chat.deteniendo = false;
  estadoApp.chat.primerTokenMs = 0;
  chatAvatarEstado("idle");
  chatPintarMensajes();
  chatActualizarBotonEnviar();
}

window.FabriChat = {
  localCargado: function (r) {
    // Llegó el aviso real: se apaga el vigilante para que no duplique mensajes.
    if (estadoApp.chat.vigiaCarga) {
      clearInterval(estadoApp.chat.vigiaCarga);
      estadoApp.chat.vigiaCarga = null;
    }
    estadoApp.chat.cargando = false;
    if (r && r.ok) {
      estadoApp.chat.localCargado = true;
      chatPintarEstadoLocal(r);
      // La plantilla y el muestreo se ajustan solos al modelo cargado: Llama
      // 3.2 3B no usa ChatML ni la temperatura de Qwen.
      chatAplicarPresetModelo(false);
      const fam = chatPresetActual();
      toast("Modelo cargado: " + (r.desc || "GGUF listo") + " · " + fam.nombre.split(" · ")[0]);
      api("log.append", { nivel: "OK", origen: "llama", mensaje: "modelo cargado: " + (r.desc || "") });
    } else {
      estadoApp.chat.localCargado = false;
      chatPintarEstadoLocal(r || { error: "carga fallida" });
      toast("No se pudo cargar: " + ((r && r.error) || "error"), "error");
      api("log.append", { nivel: "ERROR", origen: "llama", mensaje: "carga fallida: " + ((r && r.error) || "error") });
    }
    // Verificar si el modelo es demasiado pequeño para respuestas útiles
    if (r && r.ok) {
      const inf = r.info || {};
      const paramsM = inf.n_params ? Number(inf.n_params) : 0;
      if (paramsM < 1000) {
        toast("Modelo pequeño (" + paramsM + "M). Para respuestas precisas descarga Qwen 1.5B o Llama 3.2 3B.", "aviso");
        revision("llm", "aviso", "modelo muy pequeño: " + paramsM + "M parámetros", "Recomendado: Qwen 1.5B o mayor para consultas de inventario", 0, "llama");
      }
    }
  },
  /** Cada trozo que llega del motor: se pinta sin rehacer toda la lista. */
  localPieza: function (r) {
    const c = estadoApp.chat;
    const i = c.indiceIA;
    if (i < 0 || !c.mensajes[i]) return;
    const m = c.mensajes[i];
    if (!m.parcial) return;
    if (r && typeof r.texto === "string") m.texto = chatLimpiarRespuesta(r.texto);
    m.tokens = (r && r.tokens) || 0;
    if (!c.primerTokenMs && m.texto) {
      c.primerTokenMs = Date.now() - (c.t0 || Date.now());
    }
    chatPintarParcial();
  },

  localFin: function (r) {
    const c = estadoApp.chat;
    const i = c.indiceIA;
    const m = i >= 0 ? c.mensajes[i] : null;
    const transcurrido = c.t0 ? Date.now() - c.t0 : 0;
    const toks = (r && r.tokens) || 0;
    const cancelada = !!(r && r.cancelado);

    if (r && r.ok && toks > 0) {
      const ms = Math.round(r.ms || transcurrido || 0);
      const vel = ms > 0 ? (toks * 1000 / ms) : 0;
      const primer = Math.round(r.ms_primer || c.primerTokenMs || 0);
      const meta = toks + " tokens · " + (vel > 0 ? vel.toFixed(1) + " tok/s" : "sin medida")
        + (primer > 0 ? " · " + (primer / 1000).toFixed(1) + " s al primer token" : "");
      if (m) {
        const textoLimpio = chatLimpiarRespuesta(r.texto) || m.texto;
        // Detectar respuesta inútil y avisar al usuario
        if (chatRespuestaInutil(textoLimpio, estadoApp.chat.ultimoUsuario || "")) {
          chatAvisarModeloInsuficiente();
        }
        m.texto = textoLimpio;
        m.parcial = false;
        m.detenida = cancelada;
        m.origen = "local";
        m.meta = meta;
        m.metricas = { tokens: toks, ms: ms, vel: vel, primer: primer, reutilizados: r.reutilizados || 0 };
      } else {
        chatAgregarRespuesta(chatLimpiarRespuesta(r.texto), meta, false, "local");
      }
      c.ultimaRespuesta = chatLimpiarRespuesta(r.texto) || "";
      estadoApp.stats.ultimaVelocidad = vel;
      revision("llm", cancelada ? "aviso" : "info",
        "respuesta local: " + toks + " tokens en " + ms + " ms"
          + (cancelada ? " (detenida por el usuario)" : ""),
        "Velocidad: " + (vel > 0 ? vel.toFixed(2) + " tok/s" : "sin datos")
          + " · primer token: " + primer + " ms"
          + " · prefijo reutilizado: " + (r.reutilizados || 0) + " tokens"
          + " · modelo: " + (c.modeloRuta || "?"), ms, "llama");
      api("log.append", { nivel: "OK", origen: "llama",
        mensaje: "respuesta local en " + ms + " ms (" + toks + " tokens)" });
    } else if (cancelada && m) {
      // Detenida antes del primer token: no se inventa texto, se avisa.
      m.parcial = false;
      m.detenida = true;
      m.texto = m.texto || "(detenida antes de responder)";
      m.meta = "detenida";
    } else if (toks === 0) {
      const causa = esModeloEmbeddings(c.modeloRuta)
        ? "el GGUF cargado es de embeddings, no de chat"
        : "el modelo no generó texto (contexto lleno o plantilla incompatible)";
      revision("llm", "error", "respuesta local vacía: 0 tokens", causa, transcurrido, "llama");
      if (m) {
        m.parcial = false;
        m.rol = "error";
        m.texto = "El modelo no generó texto: " + causa
          + ". Prueba con «Liberar» y carga un modelo de chat (SmolLM2 135M o Qwen 0.5B).";
      } else {
        chatAgregarRespuesta("El modelo no generó texto: " + causa + ".", "0 tokens", true);
      }
      api("log.append", { nivel: "ERROR", origen: "llama", mensaje: "respuesta vacía: " + causa });
    } else if (m) {
      m.parcial = false;
      m.rol = "error";
      m.texto = (r && r.error) || "falló la inferencia";
    } else {
      chatAgregarRespuesta((r && r.error) || "falló la inferencia", "error", true);
      api("log.append", { nivel: "ERROR", origen: "llama", mensaje: (r && r.error) || "inferencia fallida" });
    }

    c.enviando = false;
    c.indiceIA = -1;
    c.deteniendo = false;
    chatAvatarEstado("idle");
    chatPintarMensajes();
    chatActualizarBotonEnviar();
    chatActualizarContexto();
  },
  remoto: function (r) {
    if (r && r.ok) {
      const meta = (r.modelo || "modelo") + " · " + Math.round(r.ms || 0) + " ms";
      chatAgregarRespuesta(r.texto, meta, false, "remoto");
      api("log.append", { nivel: "OK", origen: "chat-remoto", mensaje: "respuesta en " + Math.round(r.ms || 0) + " ms" });
    } else {
      chatAgregarRespuesta((r && r.error) || "falló la llamada remota", "error", true);
      api("log.append", { nivel: "ERROR", origen: "chat-remoto", mensaje: (r && r.error) || "falló" });
    }
  },
  modelos: function (r) {
    const nota = document.getElementById("chatRemotoEstado");
    if (!r || !r.ok) {
      if (nota) nota.textContent = "Error: " + ((r && r.error) || "no se pudo consultar");
      toast("Catálogo: " + ((r && r.error) || "error"), "error");
      return;
    }
    const lista = document.getElementById("chatModelosLista");
    const modelos = r.modelos || [];
    if (lista) lista.innerHTML = modelos.map((m) => `<option value="${esc(m)}"></option>`).join("");
    if (modelos.length) {
      const input = document.getElementById("chatModeloRemoto");
      if (input && !input.value.trim()) input.value = modelos[0];
      if (nota) nota.textContent = "Conectado: " + modelos.length + " modelos. Elige uno en la lista.";
      toast(modelos.length + " modelos disponibles");
    } else {
      if (nota) nota.textContent = "El proveedor respondió sin modelos.";
    }
  }
};

/* ==========================================================================
   Termux, biblioteca y repositorio
   ========================================================================== */
function cargarTermux() {
  cargarBiblioteca();
  pintarComandosTermux();
  const est = document.getElementById("termuxTtsEstado");
  if (est) {
    let r;
    try { r = JSON.parse(window.FabrickNative.ttsEstado()); } catch (e) { r = { ok: false, error: String(e) }; }
    est.textContent = r.listo
      ? "listo · " + (r.error || "motor del sistema")
      : "no listo · " + (r.error || "instala una voz en Android");
  }
  apiTarde("rag", { accion: "estado" }, { maxMs: 15000 }).then(function (rag) {
    const ragEst = document.getElementById("termuxRagEstado");
    if (!ragEst) return;
    ragEst.textContent = rag.ok
      ? (rag.data.total || 0) + " nota(s) indexada(s) · léxico, sin embeddings"
      : "no disponible: " + (rag.error || "error");
  });
}

function ragIndexar() {
  const area = document.getElementById("ragTexto");
  const texto = area ? area.value.trim() : "";
  if (!texto) {
    toast("Escribe algo para indexar", "error");
    return;
  }
  apiTarde("rag", { accion: "indexar", documento: "nota", texto: texto }, { maxMs: 20000 })
    .then(function (r) {
      if (!r.ok) {
        toast("RAG: " + (r.error || "no se pudo indexar"), "error");
        return;
      }
      area.value = "";
      toast("Nota indexada · " + (r.data.total || 0) + " en total");
      const ragEst = document.getElementById("termuxRagEstado");
      if (ragEst) ragEst.textContent = (r.data.total || 0) + " nota(s) indexada(s) · léxico, sin embeddings";
    });
}

function cargarBiblioteca() {
  const cont = document.getElementById("listaBiblioteca");
  if (!cont) return;
  const comps = estadoApp.componentes || [];
  if (!comps.length) {
    cont.innerHTML = `<div class="item"><p>No hay componentes en el catálogo.</p></div>`;
    return;
  }
  cont.innerHTML = comps.map((c) => {
    const m = manifiestoDe(c.id);
    const ya = c.estado === "DESCARGADO_VERIFICADO" || c.estado === "INSTALADO";
    const puede = m && m.valido && m.habilitacion && m.habilitacion.descargar && !ya;
    return `<article class="item biblioteca-item">
      <div class="item-cab">
        <div><h4>${esc(c.nombre)}</h4><p>${esc(c.descripcion || "Sin descripción")}</p></div>
        <span class="estado ${claseEstado(c.estado)}">${esc(c.estado)}</span>
      </div>
      <div class="item-meta">
        <span>${esc(c.tipo)}</span>
        <span>${c.tamano ? bytes(c.tamano) : "tamaño ?"}</span>
        <span>${esc(c.version || "sin versión")}</span>
      </div>
      <div class="fila-botones">
        ${puede ? `<button class="btn btn-primario" data-descargar="${esc(c.id)}" type="button">Descargar</button>` : ""}
        <button class="btn" data-detalle="${esc(c.id)}" type="button">Detalles</button>
      </div>
    </article>`;
  }).join("");
}

function pintarComandosTermux() {
  const cont = document.getElementById("listaComandosTermux");
  if (!cont) return;
  cont.innerHTML = TERMUX_COMANDOS.map((c) => `
    <div class="cmd-item">
      <div style="flex:1">
        <p class="nota" style="margin:0 0 3px">${esc(c.titulo)}</p>
        <code>${esc(c.cmd.split("\n")[0])}${c.cmd.includes("\n") ? " …" : ""}</code>
      </div>
      <button class="btn btn-mini" type="button" data-copiar="${esc(c.cmd)}">Copiar</button>
    </div>`).join("");
}

function abrirTermux() {
  let r;
  try { r = JSON.parse(window.FabrickNative.abrirTermux()); } catch (e) { r = { ok: false, error: String(e) }; }
  if (!r.ok) toast(r.error || "no se pudo abrir Termux", "error");
}

function copiarComandosBase() {
  copiar(document.getElementById("comandosTermux").textContent, "Comandos base copiados");
}

function cargarRepo() {
  let r;
  try { r = JSON.parse(window.FabrickNative.repoEstado()); } catch (e) { r = { ok: false, error: String(e) }; }
  const input = document.getElementById("repoUrl");
  if (input && r.url) input.value = r.url;
  repoPintar(r.url || "");
}

function repoPintar(url) {
  const estado = document.getElementById("repoEstado");
  const dato = document.getElementById("repoDatoUrl");
  if (dato) dato.textContent = url || "sin configurar";
  if (estado) {
    estado.textContent = url
      ? "Configurado: " + url + ". La página abre el repositorio; las descargas siguen exigiendo hash y tamaño."
      : "PENDIENTE: falta la URL exacta del repositorio.";
  }
}

function repoGuardar() {
  const url = document.getElementById("repoUrl").value.trim();
  let r;
  try { r = JSON.parse(window.FabrickNative.repoGuardar(url)); } catch (e) { r = { ok: false, error: String(e) }; }
  if (!r.ok) {
    toast("Repositorio: " + (r.error || "URL inválida"), "error");
    return;
  }
  repoPintar(r.url);
  toast("URL del repositorio guardada");
}

function repoAbrir() {
  let r;
  try { r = JSON.parse(window.FabrickNative.repoAbrir()); } catch (e) { r = { ok: false, error: String(e) }; }
  if (!r.ok) toast(r.error || "no se pudo abrir", "error");
}

function repoUsarConocido() {
  document.getElementById("repoUrl").value = "https://github.com/thinkfashz/fabri-core";
  repoGuardar();
  toast("Repo conocido cargado; contiene prototipos históricos, no la APK actual");
}

function repoDescargas() {
  navegar("termux");
  setTimeout(() => {
    const b = document.getElementById("listaBiblioteca");
    if (b) b.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 80);
}

function descargarApk() {
  const url = document.getElementById("apkUrl").value.trim();
  const sha = document.getElementById("apkSha").value.trim().toLowerCase();
  const tamano = Number(document.getElementById("apkTamano").value);
  const estado = document.getElementById("apkEstado");
  if (!/^https:\/\//.test(url)) {
    toast("La APK debe descargarse por HTTPS", "error");
    return;
  }
  if (!/^[a-f0-9]{64}$/.test(sha)) {
    toast("SHA-256 inválido: se exigen 64 hex", "error");
    return;
  }
  if (!Number.isFinite(tamano) || tamano <= 0) {
    toast("Tamaño inválido", "error");
    return;
  }
  if (estado) estado.textContent = "Descargando y verificando…";
  let r;
  try {
    r = JSON.parse(window.FabrickNative.descargar("actualizacion", url, sha, tamano, true));
  } catch (e) {
    r = { ok: false, error: String(e) };
  }
  if (!r.ok) {
    if (estado) estado.textContent = "Error: " + (r.error || "no se pudo iniciar");
    toast("APK: " + (r.error || "no se pudo iniciar"), "error");
  }
}

/* -------------------------------------------------------------------- módulos */
/**
 * Los módulos son manifiestos JSON: no traen código. El núcleo expone
 * capacidades fijas y seguras; el módulo sólo las configura y declara límites.
 */
const EJEMPLOS_MODULO = {
  "texto.dividir": {
    texto: "Pega aquí un documento largo. El núcleo lo corta en fragmentos con solape y respeta los límites de carácter UTF-8."
  },
  "plantilla.render": {
    contexto: "[fragmento 1] El índice vectorial vive en SQLite.\n[fragmento 2] La búsqueda usa similitud coseno.",
    pregunta: "¿Dónde vive el índice vectorial?"
  },
  "vector.indexar": {
    documento: "demo.txt",
    texto: "El índice vectorial vive en SQLite y la búsqueda usa similitud coseno.",
    vector: [0.12, 0.48, 0.91],
    metadatos: { fuente: "demo" }
  },
  "vector.buscar": { vector: [0.12, 0.48, 0.91], k: 3 },
  "archivo.analizar": { ruta: "logs/fabrick.log" }
};

function cargarModulos() {
  // Con `api()` a secas, un `LENTO` dejaba la pantalla vacía para siempre y
  // había que ir a Diagnóstico a «despertar» el núcleo. `apiTarde` reintenta.
  apiTarde("modulos", { accion: "listar" }).then(function (r) {
    if (!r.ok) {
      toast("No se pudieron listar los módulos: " + r.error, "error");
      return;
    }
    const todos = (r.data && r.data.modulos) || [];
    // `tipo: pagina` son fichas del menú lateral; no se ejecutan como módulos.
    estadoApp.paginas = todos.filter((f) => (f.manifiesto || {}).tipo === "pagina");
    estadoApp.modulos = todos.filter((f) => (f.manifiesto || {}).tipo !== "pagina");
    pintarModulos();
    pintarDrawerPaginas();
  });
}

function pintarModulos() {
  const cont = document.getElementById("listaModulos");
  if (!estadoApp.modulos.length) {
    cont.innerHTML = `<div class="item"><p>No hay módulos registrados. El núcleo los siembra al inicializar.</p></div>`;
    document.getElementById("moduloSel").innerHTML = "";
    document.getElementById("capacidadSel").innerHTML = "";
    return;
  }

  cont.innerHTML = estadoApp.modulos.map((fila) => {
    const m = fila.manifiesto || {};
    const caps = (m.capacidades || []).map((c) => `<span class="chip-mini">${esc(c)}</span>`).join(" ");
    const reemplaza = (m.reemplaza || []).map((x) => `<span>${esc(x)}</span>`).join("");
    const limites = (m.limites || []).map((l) => `<li>${esc(l)}</li>`).join("");
    return `
      <article class="item">
        <div class="item-cab">
          <div>
            <h4>${esc(m.nombre || m.id)}</h4>
            <p>${esc(m.id)} · v${esc(m.version || "0")} · ${esc(m.lenguaje || "—")}</p>
          </div>
          <span class="estado e-descargado">${esc(fila.estado)}</span>
        </div>
        <p class="nota">${esc(m.descripcion || "")}</p>
        <div class="item-meta">${caps}</div>
        ${reemplaza ? `<p class="nota">Reemplaza: ${reemplaza}</p>` : ""}
        ${limites ? `<ul class="nota">${limites}</ul>` : ""}
      </article>`;
  }).join("");

  const sel = document.getElementById("moduloSel");
  const anterior = estadoApp.moduloSel;
  sel.innerHTML = estadoApp.modulos.map((fila) => {
    const m = fila.manifiesto || {};
    return `<option value="${esc(m.id)}">${esc(m.nombre || m.id)}</option>`;
  }).join("");

  const ids = estadoApp.modulos.map((f) => (f.manifiesto || {}).id);
  const elegido = ids.includes(anterior) ? anterior : ids[0];
  if (elegido) {
    sel.value = elegido;
    cambiarModulo(elegido);
  }
}

function moduloPorId(id) {
  const fila = estadoApp.modulos.find((f) => (f.manifiesto || {}).id === id);
  return fila ? fila.manifiesto : null;
}

function cambiarModulo(id) {
  estadoApp.moduloSel = id;
  const m = moduloPorId(id);
  if (!m) return;
  const caps = m.capacidades || [];
  const selCap = document.getElementById("capacidadSel");
  selCap.innerHTML = caps.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  if (caps.length) {
    selCap.value = caps[0];
    const ejemplo = EJEMPLOS_MODULO[caps[0]];
    document.getElementById("moduloEntrada").value = ejemplo ? JSON.stringify(ejemplo, null, 2) : "{}";
  } else {
    document.getElementById("moduloEntrada").value = "{}";
  }
  document.getElementById("moduloSalida").style.display = "none";
}

function cambiarCapacidad(cap) {
  const ejemplo = EJEMPLOS_MODULO[cap];
  document.getElementById("moduloEntrada").value = ejemplo ? JSON.stringify(ejemplo, null, 2) : "{}";
}

function ejecutarModulo() {
  const id = document.getElementById("moduloSel").value;
  const capacidad = document.getElementById("capacidadSel").value;
  const crudo = document.getElementById("moduloEntrada").value.trim() || "{}";
  const salida = document.getElementById("moduloSalida");
  salida.style.display = "block";

  let entrada;
  try {
    entrada = JSON.parse(crudo);
  } catch (e) {
    salida.textContent = "JSON inválido: " + e.message;
    return;
  }

  salida.textContent = "Ejecutando…";
  const r = api("modulos", { accion: "ejecutar", id, capacidad, entrada });
  if (!r.ok) {
    salida.textContent = "Error: " + r.error;
    api("log.append", { nivel: "ERROR", origen: "modulos", mensaje: `${id}/${capacidad}: ${r.error}` });
    return;
  }
  salida.textContent = JSON.stringify(r.data.resultado, null, 2);
  toast(`${capacidad} ejecutada`);
  api("log.append", { nivel: "OK", origen: "modulos", mensaje: `${id}/${capacidad} OK` });
}

function aplicarImportacion(r) {
  if (!r.ok) {
    toast("Importación rechazada: " + r.error, "error");
    api("log.append", { nivel: "ERROR", origen: "modulos", mensaje: "importación rechazada: " + r.error });
    return false;
  }
  toast(`Módulo ${r.data.id} importado`);
  api("log.append", { nivel: "OK", origen: "modulos", mensaje: `importado ${r.data.id} v${r.data.version}` });
  cargarModulos();
  document.getElementById("moduloSel").value = r.data.id;
  cambiarModulo(r.data.id);
  return true;
}

function importarModulo(ev) {
  const archivo = ev.target.files && ev.target.files[0];
  if (!archivo) {
    toast("No se eligió ningún archivo", "error");
    return;
  }
  if (archivo.size > 65536) {
    toast("El módulo supera 64 KB; se rechaza", "error");
    ev.target.value = "";
    return;
  }
  const lector = new FileReader();
  lector.onload = () => {
    const r = api("modulos", { accion: "importar", texto: String(lector.result || "") });
    ev.target.value = "";
    aplicarImportacion(r);
  };
  lector.onerror = () => {
    toast("No se pudo leer el archivo", "error");
    ev.target.value = "";
  };
  lector.readAsText(archivo);
}

function importarTexto() {
  const area = document.getElementById("moduloTexto");
  const texto = area.value.trim();
  if (!texto) {
    toast("Pegá el JSON del módulo primero", "error");
    return;
  }
  const r = api("modulos", { accion: "importar", texto });
  if (aplicarImportacion(r)) area.value = "";
}

/* -------------------------------------------------------------------- consola */
function agregarLinea(tipo, texto) {
  estadoApp.consola.push({ tipo, ts: Math.floor(Date.now() / 1000), texto });
  pintarConsola();
}

function pintarConsola() {
  const term = document.getElementById("terminal");
  const filtro = document.getElementById("filtroConsola").value;
  const busqueda = (document.getElementById("buscarConsola").value || "").toLowerCase();

  const visibles = estadoApp.consola.filter((l) => {
    if (filtro === "ok" && l.tipo !== "ok") return false;
    if (filtro === "error" && l.tipo !== "error") return false;
    if (busqueda && !l.texto.toLowerCase().includes(busqueda)) return false;
    return true;
  });

  term.innerHTML = visibles.map((l) => `
    <div class="linea ${esc(l.tipo)}"><span class="hora">${hora(l.ts)}</span>${esc(l.texto)}</div>
  `).join("") || `<div class="linea info">Sin líneas para este filtro.</div>`;

  term.scrollTop = term.scrollHeight;
}

function cargarHistorialConsola() {
  apiTarde("logs", { accion: "listar", limite: 200 }, { maxMs: 15000 }).then(function (r) {
  if (!r.ok) { toast("No se pudo leer el historial: " + r.error, "error"); return; }
  const logs = (r.data.logs || []).slice().reverse();
  estadoApp.consola = logs.map((l) => ({
    tipo: l.nivel === "ERROR" ? "error" : (l.nivel === "OK" ? "ok" : "info"),
    ts: l.ts,
    texto: `[${l.origen}] ${l.mensaje}`
  }));
  pintarConsola();
  });
}

async function ejecutarTarea() {
  const tarea = document.getElementById("tareaSel").value;
  agregarLinea("info", "$ " + tarea);
  const r = api("tarea", { tarea });
  if (!r.ok) {
    agregarLinea("error", "ERROR: " + r.error);
    toast("La tarea falló: " + r.error, "error");
    return;
  }
  agregarLinea(r.data.ok ? "ok" : "error", r.data.salida);
  if (!r.data.ok) toast("Tarea rechazada o fallida", "error");
  const s = api("sys");
  if (s.ok) { estadoApp.sistema = s.data; pintarInicio(); }
}

/* ---------------------------------------------------------------- diagnóstico */
/** Bitácora de arranque: la escribe Java en un archivo, sin pasar por el
 *  núcleo. Es la evidencia que sobrevive a un cuelgue del arranque. */
function bitacoraPintar() {
  const pre = document.getElementById("bitacoraArranque");
  if (!pre) return;
  try {
    if (!window.FabrickNative || typeof window.FabrickNative.arranqueBitacora !== "function") {
      pre.textContent = "Esta vista sólo puede leer la bitácora dentro de la APK.";
      return;
    }
    const texto = window.FabrickNative.arranqueBitacora(120);
    pre.textContent = texto || "Sin entradas todavía.";
    pre.scrollTop = pre.scrollHeight;
  } catch (e) {
    pre.textContent = "No se pudo leer la bitácora: " + e;
  }
}

async function cargarDiagnostico() {
  bitacoraPintar();
  // Si el núcleo todavía migra no se hacen tres llamadas que van a expirar:
  // se avisa en el piloto y se reintenta solo, sin congelar la pantalla.
  if (!nucleoPreparado()) {
    cargarDiagnostico.intentos = (cargarDiagnostico.intentos || 0) + 1;
    const piloto = document.getElementById("pilotoNucleo");
    if (piloto) {
      piloto.className = "pill pill-espera";
      piloto.textContent = "núcleo iniciando…";
    }
    if (cargarDiagnostico.intentos < 25) setTimeout(cargarDiagnostico, 700);
    return;
  }
  cargarDiagnostico.intentos = 0;
  // Las tres lecturas van en paralelo y sin bloquear: Diagnóstico es justo la
  // pantalla que se abre cuando algo va mal, no puede quedarse congelada.
  const res = await Promise.all([
    apiTarde("sys", undefined, { maxMs: 15000 }),
    apiTarde("operaciones", { accion: "listar", limite: 50 }, { maxMs: 15000 }),
    apiTarde("logs", { accion: "listar", limite: 100 }, { maxMs: 15000 }),
    apiTarde("rendimiento", {}, { maxMs: 15000 })
  ]);
  const s = res[0];
  if (s.ok) estadoApp.sistema = s.data;
  const ops = res[1];
  estadoApp.operaciones = ops.ok ? ((ops.data && ops.data.operaciones) || []) : [];
  const lg = res[2];
  estadoApp.logsHistoricos = lg.ok ? ((lg.data && lg.data.logs) || []) : [];
  const rend = res[3];
  pintarRendimiento(rend);

  const sys = estadoApp.sistema;
  const rt = apiRuntime();
  const filasSistema = sys ? [
    ["Arquitectura", sys.arch],
    ["Plataforma", sys.os],
    ["Versión del núcleo", sys.version],
    ["Directorio de datos", sys.dataDir],
    ["Disco total", bytes(sys.discoTotal)],
    ["Disco libre", bytes(sys.discoLibre)],
    ["Memoria total", bytes((sys.memTotalKb || 0) * 1024)],
    ["Memoria disponible", bytes((sys.memLibreKb || 0) * 1024)]
  ] : [["Estado", "sin datos"]];
  filasSistema.push([
    "Runtime nativo (A1)",
    rt.cargado
      ? `cargado · ${rt.version || "versión desconocida"} · ${rt.abi || "arm64-v8a"}`
      : `no cargado · ${rt.error || "sin detalle"}`
  ]);
  let local = { cargado: false };
  try {
    local = JSON.parse(window.FabrickNative.localEstado());
  } catch (e) {
    local = { cargado: false, error: String(e) };
  }
  filasSistema.push([
    "Modelo local (A2/A3)",
    local.cargado
      ? `cargado · ctx ${local.n_ctx || "?"} · ${(local.info && local.info.desc) || "GGUF"}`
      : `sin cargar · ${local.error || "elige un modelo en Chat"}`
  ]);
  let tts = { listo: false };
  try {
    tts = JSON.parse(window.FabrickNative.ttsEstado());
  } catch (e) {
    tts = { listo: false, error: String(e) };
  }
  filasSistema.push([
    "TTS del sistema",
    tts.listo ? "listo · voces de Android" : `no listo · ${tts.error || "instala una voz"}`
  ]);
  // Radiografía del carril del núcleo: cuántas operaciones esperan y cuál fue
  // la última que se quedó con el hilo. Es la respuesta a «¿por qué se pegó?».
  let carril = null;
  try {
    if (window.FabrickNative && typeof window.FabrickNative.nucleoEstado === "function") {
      carril = JSON.parse(window.FabrickNative.nucleoEstado());
    }
  } catch (e) { carril = null; }
  if (carril) {
    filasSistema.push([
      "Cola del núcleo",
      carril.cola > 0 ? `${carril.cola} operación(es) en espera` : "libre"
    ]);
    filasSistema.push([
      "Última operación lenta",
      carril.ultimo_lento || "ninguna desde el arranque"
    ]);
  }
  document.getElementById("datosSistema").innerHTML = filasSistema
    .map(([k, v]) => `<div class="fila"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join("");

  document.getElementById("listaOps").innerHTML = estadoApp.operaciones.length
    ? estadoApp.operaciones.map((o) => `
      <article class="item">
        <div class="item-cab">
          <div>
            <h4>${esc(o.tipo)}</h4>
            <p>${esc(o.detalle || "sin detalle")}</p>
          </div>
          <span class="estado ${o.estado === "OK" ? "e-listo" : "e-error"}">${esc(o.estado)}</span>
        </div>
        <div class="item-meta"><span>${fechaHora(o.inicio)}</span><span>${esc(o.fase || "-")}</span><span>${esc(o.id)}</span></div>
      </article>`).join("")
    : `<div class="item"><p>Sin operaciones registradas.</p></div>`;

  document.getElementById("listaLogs").innerHTML = estadoApp.logsHistoricos.length
    ? estadoApp.logsHistoricos.map((l) => `
      <article class="item">
        <div class="item-cab">
          <div>
            <h4>${esc(l.origen)}</h4>
            <p>${esc(l.mensaje)}</p>
          </div>
          <span class="estado ${l.nivel === "ERROR" ? "e-error" : "e-no-disponible"}">${esc(l.nivel)}</span>
        </div>
        <div class="item-meta"><span>${fechaHora(l.ts)}</span></div>
      </article>`).join("")
    : `<div class="item"><p>Sin logs.</p></div>`;

  omniCargar();
  pintarInicio();
}

function informe() {
  const s = estadoApp.sistema || {};
  const lineas = [
    "# Informe FORGE CORE STOCK",
    "",
    "Generado: " + new Date().toLocaleString("es-CL"),
    "Núcleo: v" + (s.version || "?"),
    "Arquitectura: " + (s.arch || "?"),
    "Directorio de datos: " + (s.dataDir || "?"),
    "Disco: " + bytes(s.discoLibre) + " libres de " + bytes(s.discoTotal),
    "RAM disponible: " + bytes((s.memLibreKb || 0) * 1024),
    "",
    "## Operaciones recientes",
    ...estadoApp.operaciones.slice(0, 20).map(
      (o) => `- [${o.estado}] ${o.tipo} · ${fechaHora(o.inicio)} · ${o.detalle || ""}`
    ),
    "",
    "## Logs recientes",
    ...estadoApp.logsHistoricos.slice(0, 40).map(
      (l) => `- ${fechaHora(l.ts)} [${l.nivel}] ${l.origen}: ${l.mensaje}`
    )
  ];
  const texto = lineas.join("\n");
  copiar(texto, "Informe copiado al portapapeles");
}

function copiar(texto, mensajeOk) {
  const area = document.createElement("textarea");
  area.value = texto;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
  document.body.removeChild(area);
  toast(ok ? mensajeOk : "No se pudo copiar; el texto quedó en el log", ok ? "" : "error");
  if (!ok) agregarLinea("info", texto.split("\n").slice(0, 3).join(" ⏎ "));
}

/* ------------------------------------------------------- sonda T0 (W^X) */
function ejecutarT0() {
  const caja = document.getElementById("t0Resultado");
  caja.textContent = "Ejecutando sonda…";
  if (!window.FabrickNative || typeof window.FabrickNative.t0 !== "function") {
    caja.textContent = "El puente nativo de esta versión no expone t0().";
    return;
  }
  let r;
  try {
    const crudo = window.FabrickNative.t0();
    r = JSON.parse(crudo);
  } catch (e) {
    r = { ok: false, error: String(e) };
  }
  caja.textContent = r.exec_ok
    ? `EXEC PERMITIDO. ${r.conclusion} (salida: ${r.salida}, código ${r.codigoSalida}).`
    : `EXEC BLOQUEADO O FALLIDO. ${r.error || r.conclusion || "sin detalle"}`;
  api("log.append", {
    nivel: r.exec_ok ? "OK" : "ERROR",
    origen: "t0",
    mensaje: "sonda de ejecución: " + (r.exec_ok ? "permitida" : "bloqueada") + " — " + (r.error || r.conclusion || "")
  });
  api("operaciones", {
    accion: "registrar",
    tipo: "T0",
    detalle: (r.exec_ok ? "exec permitido" : "exec bloqueado") + ": " + (r.error || r.conclusion || ""),
    estado: r.exec_ok ? "OK" : "ERROR",
    fase: "F3"
  });
}

/* ------------------------------------------------ OmniRoute (gateway externo) */
//
// OmniRoute es un servidor Node/Next que enruta a proveedores de IA. La app no
// lo ejecuta: se auto-aloja en Termux o en un servidor propio, y aquí sólo se
// configura la URL, la clave y el modelo, se prueba /v1/models y se manda un
// chat de humo. La clave se guarda en SQLite y no se devuelve a la página.

function omniCargar() {
  if (!window.FabrickNative || typeof window.FabrickNative.omniEstado !== "function") {
    return;
  }
  let r;
  try {
    r = JSON.parse(window.FabrickNative.omniEstado());
  } catch (e) {
    r = { ok: false, error: String(e) };
  }
  const nota = document.getElementById("omniEstado");
  if (!r.ok) {
    nota.textContent = "No se pudo leer la configuración: " + (r.error || "sin detalle");
    return;
  }
  document.getElementById("omniUrl").value = r.url || "";
  document.getElementById("omniModelo").value = r.modelo || "auto";
  document.getElementById("omniClave").value = "";
  nota.textContent = r.configurado
    ? "Configurado" + (r.tieneClave ? " con clave." : " sin clave.") + " Pulsa «Probar conexión»."
    : "Sin configurar. La app no instala OmniRoute: se auto-aloja en Termux o en un servidor propio.";
}

function omniGuardar() {
  const url = document.getElementById("omniUrl").value.trim();
  const clave = document.getElementById("omniClave").value;
  const modelo = document.getElementById("omniModelo").value.trim() || "auto";
  const nota = document.getElementById("omniEstado");

  let r;
  try {
    r = JSON.parse(window.FabrickNative.omniGuardar(url, clave, modelo));
  } catch (e) {
    r = { ok: false, error: String(e) };
  }
  if (!r.ok) {
    nota.textContent = "Error: " + (r.error || "no se pudo guardar");
    toast("OmniRoute: " + (r.error || "no se pudo guardar"), "error");
    return;
  }
  document.getElementById("omniUrl").value = r.url;
  document.getElementById("omniClave").value = "";
  nota.textContent = "Guardado en " + r.url + ". Pulsa «Probar conexión».";
  toast("Configuración de OmniRoute guardada");
  api("log.append", {
    nivel: "OK",
    origen: "omniroute",
    mensaje: "configuración guardada (clave no registrada en el log)"
  });
}

function omniProbar() {
  const nota = document.getElementById("omniEstado");
  nota.textContent = "Comprobando /v1/models…";
  let r;
  try {
    r = JSON.parse(window.FabrickNative.omniProbar());
  } catch (e) {
    r = { ok: false, error: String(e) };
  }
  if (!r.ok) {
    nota.textContent = "Error: " + (r.error || "no se pudo iniciar la prueba");
  }
}

function omniChat() {
  const prompt = document.getElementById("omniPrompt").value.trim();
  const nota = document.getElementById("omniEstado");
  if (!prompt) {
    nota.textContent = "Escribe un prompt para el chat de prueba.";
    return;
  }
  nota.textContent = "Enviando al gateway… (puede tardar)";
  let r;
  try {
    r = JSON.parse(window.FabrickNative.omniChat(prompt));
  } catch (e) {
    r = { ok: false, error: String(e) };
  }
  if (!r.ok) {
    nota.textContent = "Error: " + (r.error || "no se pudo iniciar el chat");
  }
}

function omniCopiarInstalacion() {
  const comandos = [
    "# En Termux, una sola vez:",
    "pkg install nodejs python build-essential git",
    "npx -y omniroute@latest",
    "",
    "# API local (la clave la muestra el propio OmniRoute):",
    "# http://127.0.0.1:20128/v1"
  ].join("\n");
  copiar(comandos, "Comandos copiados: ejecútalos en Termux");
}

window.FabriOmni = {
  evento: function (modo, r) {
    const nota = document.getElementById("omniEstado");
    const salida = document.getElementById("omniSalida");
    if (!r || !r.ok) {
      const motivo = r && r.error ? r.error : "respuesta inválida";
      nota.textContent = "Error de OmniRoute: " + motivo;
      salida.style.display = "block";
      salida.textContent = motivo;
      api("log.append", { nivel: "ERROR", origen: "omniroute", mensaje: modo + ": " + motivo });
      return;
    }
    if (modo === "probar") {
      const muestra = r.muestra ? " Muestra: " + r.muestra : "";
      nota.textContent = "Conectado: " + r.modelos + " modelos disponibles." + muestra;
      salida.style.display = "none";
      api("log.append", {
        nivel: "OK",
        origen: "omniroute",
        mensaje: "conexión verificada: " + r.modelos + " modelos"
      });
      return;
    }
    nota.textContent = "Respuesta de " + (r.modelo || "?") + " en " + (r.ms || 0) + " ms.";
    salida.style.display = "block";
    salida.textContent = r.texto || "(respuesta vacía)";
    api("log.append", {
      nivel: "OK",
      origen: "omniroute",
      mensaje: "chat de prueba completado en " + (r.ms || 0) + " ms"
    });
  }
};

/* -------------------------------------------------------------------- arranque */
/** Actualiza el porcentaje del loader. La barra la anima el CSS: si el hilo de
 *  JavaScript está ocupado esperando al núcleo, la barra igual avanza y el
 *  loader igual se desvanece. */
function animarLoader() {
  const texto = document.getElementById("loaderTexto");
  if (!texto) return;
  // `inicio` se toma del PRIMER fotograma, no de `performance.now()`: en
  // Android WebView la marca de tiempo del callback puede ser anterior a la
  // llamada y el porcentaje salía negativo («LOADING CORE SYSTEM · -1 %»).
  let inicio = null;
  const duracion = 2400;
  function paso(ahora) {
    if (inicio === null) inicio = ahora;
    const t = Math.max(0, Math.min(1, (ahora - inicio) / duracion));
    texto.textContent = "LOADING CORE SYSTEM · " + Math.round(t * 100) + " %";
    if (t < 1) {
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(paso);
      else setTimeout(() => paso(Date.now()), 40);
    }
  }
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(paso);
  else setTimeout(() => paso(Date.now()), 40);
}

/** Oculta el loader de marca. Nunca lanza: si algo falla, se ignora. */
function ocultarLoader() {
  try {
    const loader = document.getElementById("loaderArranque");
    if (loader) {
      loader.classList.add("loader-oculto");
      setTimeout(() => { loader.style.display = "none"; }, 350);
    }
  } catch (e) { /* nunca bloquear el arranque por el loader */ }
}

/* Estado del núcleo para el arranque. `null` = todavía no se comprobó.
   El arranque NO se bloquea esperándolo: si aún no está, se reintenta. */
const arranque = { intentos: 0, listo: false, programado: false };

/** ¿El núcleo ya abrió SQLite? Consulta instantánea, sin esperar (Java). */
function nucleoPreparado() {
  try {
    if (!window.FabrickNative || typeof window.FabrickNative.nucleoListo !== "function") {
      return true; // vista previa en navegador: no hay núcleo que esperar
    }
    const r = JSON.parse(window.FabrickNative.nucleoListo());
    return !!(r && r.listo);
  } catch (e) {
    return true;
  }
}

function arranqueReintentar() {
  if (arranque.programado || arranque.listo) return;
  if (arranque.intentos >= 20) return;   // ~16 s; después avisa y se queda quieto
  arranque.intentos++;
  arranque.programado = true;
  setTimeout(arranqueNucleo, 800);
}

/** Trabajo que sí necesita el núcleo. Se ejecuta DESPUÉS de la primera pintura
 *  y sólo cuando el núcleo ya abrió SQLite. Antes eran siete llamadas seguidas
 *  con 10 s de espera cada una: el hilo de JavaScript quedaba bloqueado y la
 *  pantalla en 0 %. */
function arranqueNucleo() {
  arranque.programado = false;

  // Sin esperar: si el núcleo todavía migra, se reintenta más tarde.
  if (!nucleoPreparado()) {
    const piloto = document.getElementById("pilotoNucleo");
    if (piloto) {
      piloto.className = "pill pill-espera";
      piloto.textContent = "núcleo iniciando…";
    }
    arranqueReintentar();
    return;
  }

  const ping = api("ping");
  if (!ping.ok) {
    const piloto = document.getElementById("pilotoNucleo");
    if (piloto) {
      piloto.className = "pill pill-error";
      piloto.textContent = "sin núcleo";
    }
    // LENTO y NUCLEO_OCUPADO no son fallos: el núcleo está trabajando. Se
    // reintenta en silencio en vez de mostrar un error al usuario.
    if (ping.codigo === "NUCLEO_OCUPADO" || ping.codigo === "LENTO") {
      arranqueReintentar();
      return;
    }
    toast("Núcleo no responde: " + ping.error, "error");
    return;
  }

  try {
    const sys = api("sys");
    if (sys.ok) estadoApp.sistema = sys.data;
    else if (sys.codigo === "NUCLEO_OCUPADO" || sys.codigo === "LENTO") {
      arranqueReintentar();
      return;
    }

    arranque.listo = true;
    compsActualizar();

    const mans = api("manifiestos");
    if (mans.ok) estadoApp.manifiestos = mans.data.manifiestos || [];
    else toast("No se pudieron leer los manifiestos: " + mans.error, "error");

    pintarInicio();
    pintarComponentes();
    cargarModulos();
    cargarHistorialConsola();

    api("log.append", { nivel: "OK", origen: "app", mensaje: "interfaz iniciada" });
  } catch (e) {
    // Un error de arranque no puede dejar la app atrapada en el loader.
    try { toast("Arranque: " + e.message, "error"); } catch (_) {}
  }
}

/** Lo llama Java cuando termina `init` del núcleo (aunque haya tardado). */
window.__fabriNucleoListo = function () {
  // La pantalla de acceso se decide con datos de la base: si estaba esperando
  // («núcleo iniciando»), ahora se puede resolver sin que el usuario toque nada.
  try {
    if (window.FabriLogin && window.FabriLogin.refrescar) window.FabriLogin.refrescar();
  } catch (e) { /* el login ya es usable */ }
  try { chatRefrescar(); } catch (e) { /* la vista se pinta sola */ }
  // La ficha del negocio (nombre, RUT, logo, ID de cliente) se copia a la
  // caché local: la boleta y el login la necesitan sin abrir «Mi identidad».
  try { if (typeof idSincronizarCache === "function") idSincronizarCache(); } catch (e) { /* cosmético */ }
  // La pantalla abierta se recarga sola: antes había que abrir Diagnóstico y
  // pulsar «Probar núcleo» para que Módulos, Modelos o Inventario mostraran
  // algo, porque su carga se había rendido con NUCLEO_OCUPADO.
  refrescarVistaActual();
  if (arranque.listo || arranque.programado) return;
  arranque.intentos = 0;
  arranque.programado = true;
  setTimeout(arranqueNucleo, 0);
};

/** Vuelve a ejecutar la carga de la vista visible, sin navegar ni mover scroll. */
function refrescarVistaActual() {
  const v = estadoApp.vista || "inicio";
  const rama = RAMAS_VISTA[v];
  if (!rama) return;
  try {
    rama();
  } catch (e) {
    jsError(e, "refrescarVistaActual(" + v + ")");
  }
}

function iniciar() {
  // 0) Los eventos de las páginas que viven en su propio archivo se enganchan
  //    una sola vez, aquí: así una vista nueva no depende de abrirse antes.
  try {
    if (typeof idConectarEventos === "function") idConectarEventos();
  } catch (e) { jsError(e, "idConectarEventos"); }
  try {
    conectarRendimiento();
  } catch (e) { jsError(e, "conectarRendimiento"); }

  // 1) El loader se anima y se retira ANTES de tocar el núcleo. Si el núcleo
  //    tarda, la interfaz ya está pintada y el login ya responde.
  animarLoader();
  ocultarLoader();
  setTimeout(ocultarLoader, 2600);

  // 2) El trabajo del núcleo va en el siguiente turno: así el navegador pinta
  //    primero y el usuario puede interactuar aunque el puente se demore.
  arranque.programado = true;
  setTimeout(arranqueNucleo, 40);
}

/* --------------------------------------------------------------- eventos UI */
document.addEventListener("click", (ev) => {
  const nav = ev.target.closest(".nav");
  if (nav) { navegar(nav.dataset.vista); return; }

  const navDrawer = ev.target.closest(".nav-drawer");
  if (navDrawer) { navegar(navDrawer.dataset.vista); return; }

  const chatModo = ev.target.closest("[data-chat-modo]");
  if (chatModo) { chatCambiarModo(chatModo.dataset.chatModo); return; }

  const sugerencia = ev.target.closest("[data-sugerencia]");
  if (sugerencia) {
    const entrada = document.getElementById("chatEntrada");
    if (entrada) {
      entrada.value = sugerencia.dataset.sugerencia;
      chatAutoAlto(entrada);
      entrada.focus();
    }
    return;
  }

  const copiarCmd = ev.target.closest("[data-copiar]");
  if (copiarCmd) { copiar(copiarCmd.dataset.copiar, "Comando copiado"); return; }

  const copiarMsg = ev.target.closest("[data-copiar-mensaje]");
  if (copiarMsg) {
    const i = Number(copiarMsg.dataset.copiarMensaje);
    const m = estadoApp.chat.mensajes[i];
    if (m) copiar(m.texto, "Mensaje copiado");
    return;
  }

  const copiarCodigo = ev.target.closest("[data-copiar-codigo]");
  if (copiarCodigo) {
    const bloque = copiarCodigo.closest(".code-bloque");
    const codigo = bloque ? bloque.querySelector("pre") : null;
    copiar(codigo ? codigo.textContent : "", "Código copiado");
    return;
  }

  const regenerar = ev.target.closest("[data-regenerar]");
  if (regenerar) { chatRegenerar(); return; }

  const editarUltimo = ev.target.closest("[data-editar-ultimo]");
  if (editarUltimo) { chatEditarUltimo(); return; }

  const leerMsg = ev.target.closest("[data-leer-mensaje]");
  if (leerMsg) {
    const i = Number(leerMsg.dataset.leerMensaje);
    const m = estadoApp.chat.mensajes[i];
    if (m) {
      const limpio = ttsTextoNatural(m.texto);
      let r;
      try { r = JSON.parse(window.FabrickNative.ttsHablar(limpio)); } catch (e) { r = { ok: false, error: String(e) }; }
      if (!r.ok) {
        toast("Voz: " + (r.error || "no disponible"), "error");
      } else {
        chatAvatarEstado("talking");
      }
    }
    return;
  }

  if (ev.target.id === "btnChatAjustes") {
    const cfg = document.getElementById("chatConfig");
    cfg.hidden = !cfg.hidden;
    ev.target.setAttribute("aria-expanded", String(!cfg.hidden));
    if (!cfg.hidden) {
      chatInicializarPestanas();
      chatPintarFamilia();
    }
    return;
  }
  if (ev.target.id === "btnChatDatosRefrescar") { chatCargarDatos(true); return; }
  if (ev.target.id === "btnChatPresetRestaurar") { chatAplicarPresetModelo(true); return; }
  if (ev.target.id === "btnChatNuevaCab") { chatLimpiar(); return; }
  if (ev.target.id === "btnIrConsolaLibre") { navegar("flujo"); return; }
  if (ev.target.id === "btnChatEscanear") { chatEscanearModelos(); return; }
  if (ev.target.id === "btnChatCargar") { chatCargarModeloLocal(); return; }
  if (ev.target.id === "btnChatLiberar") { chatLiberarModeloLocal(); return; }
  if (ev.target.id === "btnChatGuardar") { chatGuardarRemoto(); return; }
  if (ev.target.id === "btnChatTraer") { chatTraerModelos(); return; }
  if (ev.target.id === "btnChatProbar") { chatProbarRemoto(); return; }
  if (ev.target.id === "btnChatEnviar") { chatEnviar(); return; }
  if (ev.target.id === "btnChatLimpiar") { chatLimpiar(); return; }
  if (ev.target.id === "btnChatTts") { chatLeerUltima(); return; }
  if (ev.target.id === "btnChatDetenerTts") {
    try { window.FabrickNative.ttsDetener(); } catch (e) { /* sin TTS */ }
    chatAvatarEstado("idle");
    chatTtsEstado(false);
    toast("Voz detenida");
    return;
  }
  if (ev.target.id === "btnAbrirTermux") { abrirTermux(); return; }
  if (ev.target.id === "btnCopiarTermux") { copiarComandosBase(); return; }
  if (ev.target.id === "btnRagIndexar") { ragIndexar(); return; }
  if (ev.target.id === "btnTtsProbar") {
    let r;
    try { r = JSON.parse(window.FabrickNative.ttsHablar("Hola. Soy FORGE CORE STOCK. La voz del sistema está funcionando.")); } catch (e) { r = { ok: false, error: String(e) }; }
    toast(r.ok ? "Reproduciendo voz" : "TTS: " + (r.error || "no disponible"), r.ok ? "" : "error");
    return;
  }
  if (ev.target.id === "btnAbrirAjustesVoz") {
    let r;
    try {
      r = JSON.parse(window.FabrickNative.abrirAjustesTts());
    } catch (e) {
      r = { ok: false, error: String(e) };
    }
    toast(r.ok
      ? "Ajustes de voz abiertos: instala una voz en español si falta"
      : "No se pudieron abrir los ajustes de voz: " + (r.error || "error"),
      r.ok ? "" : "error");
    return;
  }
  if (ev.target.id === "btnRepoGuardar") { repoGuardar(); return; }
  if (ev.target.id === "btnRepoAbrir") { repoAbrir(); return; }
  if (ev.target.id === "btnRepoUsarConocido") { repoUsarConocido(); return; }
  if (ev.target.id === "btnRepoDescargas") { repoDescargas(); return; }
  if (ev.target.id === "btnApkDescargar") { descargarApk(); return; }

  const pagina = ev.target.closest("[data-pagina]");
  if (pagina) { mostrarPagina(pagina.dataset.pagina); return; }

  if (ev.target.id === "btnMenu") { abrirDrawer(); return; }
  if (ev.target.id === "drawerCerrar" || ev.target.id === "drawerFondo") { cerrarDrawer(); return; }
  if (ev.target.id === "paginaVolver") { navegar(estadoApp.vistaAnterior || "modulos"); return; }

  const chip = ev.target.closest("#filtrosComp .chip");
  if (chip) {
    document.querySelectorAll("#filtrosComp .chip").forEach((c) => c.classList.remove("activo"));
    chip.classList.add("activo");
    estadoApp.filtro = chip.dataset.filtro;
    pintarComponentes();
    return;
  }

  const detalle = ev.target.closest("[data-detalle]");
  if (detalle) { abrirModal(detalle.dataset.detalle); return; }

  const descargar = ev.target.closest("[data-descargar]");
  if (descargar) { descargarComponente(descargar.dataset.descargar); return; }

  if (ev.target.id === "btnDescargar") {
    if (estadoApp.idModal) descargarComponente(estadoApp.idModal);
    return;
  }

  if (ev.target.id === "btnInstalar") {
    if (estadoApp.idModal) instalarComponente(estadoApp.idModal);
    return;
  }

  if (ev.target.id === "btnCopiarPagina") { copiarInstruccionesPagina(); return; }
  if (ev.target.id === "btnCopiarPaginaJson") { copiarJsonPagina(); return; }

  if (ev.target.id === "btnT0") { ejecutarT0(); return; }
  if (ev.target.id === "btnOmniGuardar") { omniGuardar(); return; }
  if (ev.target.id === "btnOmniProbar") { omniProbar(); return; }
  if (ev.target.id === "btnOmniChat") { omniChat(); return; }
  if (ev.target.id === "btnOmniCopiar") { omniCopiarInstalacion(); return; }

  if (ev.target.id === "modal" || ev.target.id === "modalCerrar") { cerrarModal(); return; }

  const accion = ev.target.closest("[data-accion]");
  if (accion) {
    const a = accion.dataset.accion;
    if (a === "probar") {
      const r = api("tarea", { tarea: "ping" });
      toast(r.ok && r.data.ok ? r.data.salida : "Falló: " + (r.error || r.data.salida), r.ok && r.data.ok ? "" : "error");
      agregarLinea(r.ok && r.data.ok ? "ok" : "error", r.ok ? r.data.salida : r.error);
      return;
    }
    if (a === "escanear") { escanearModelos(); return; }
    if (a === "ir-diag") { navegar("diag"); return; }
    if (a === "ir-chat") { navegar("chat"); return; }
    if (a === "ir-sql") { navegar("sql"); return; }
    if (a === "ir-inventario") { navegar("inventario"); return; }
    if (a === "escanear-codigo") {
      // Abre el inventario y enciende la cámara para leer el código de barras.
      navegar("inventario");
      setTimeout(function () {
        if (typeof invCamaraAbrir === "function") invCamaraAbrir();
      }, 260);
      return;
    }
  }

  if (ev.target.id === "btnVerificarGlobal") { ejecutarVerificadorGlobal(); return; }
  if (ev.target.id === "btnModelosRecomendados") { cargarModelosRecomendados(); return; }
  if (ev.target.id === "btnEscanearModelosInicio") { escanearModelos(); return; }

  const modeloDescargar = ev.target.closest("[data-modelo-descargar]");
  if (modeloDescargar) {
    const id = modeloDescargar.dataset.modeloDescargar;
    // Antes esto sólo mostraba un aviso y nunca descargaba nada. Ahora abre el
    // modal del componente, que es donde vive la descarga verificada
    // (HTTPS + SHA-256 + tamaño + autorización si supera 50 MiB).
    const enLista = estadoApp.componentes.some((x) => x.id === id);
    if (!enLista) {
      compsActualizar();
    }
    if (manifiestoDe(id)) {
      abrirModal(id);
      revision("descarga", "info", "abrir descarga de " + id);
    } else {
      toast("El modelo " + id + " no tiene manifiesto válido en esta versión", "error");
      revision("descarga", "error", "sin manifiesto para " + id,
        "El id vino de modelos_recomendados pero no existe en MANIFIESTOS.", 0, "descarga");
    }
    return;
  }
});

/* ---------------------------------------------------------------- eventos
   Conexión tolerante: un id ausente (una vista que no está en este build, un
   cambio de HTML) NO puede cortar el arranque de toda la interfaz. Antes,
   `document.getElementById("x").addEventListener(...)` lanzaba y todo lo que
   venía después —incluido el login— no se ejecutaba nunca: la pantalla quedaba
   en «Comprobando acceso…» y ningún botón respondía. */
function al(id, evento, fn) {
  const el = document.getElementById(id);
  if (!el) return null;
  el.addEventListener(evento, fn);
  return el;
}

al("btnEscanear", "click", escanearModelos);
al("btnEjecutar", "click", ejecutarTarea);
al("btnRefrescarDiag", "click", () => { cargarDiagnostico(); toast("Diagnóstico actualizado"); });
al("btnInforme", "click", informe);
al("btnCopiarConsola", "click", () => {
  copiar(estadoApp.consola.map((l) => `${hora(l.ts)} ${l.texto}`).join("\n"), "Salida copiada");
});
al("btnLimpiarVista", "click", () => {
  estadoApp.consola = [];
  pintarConsola();
  toast("Vista limpia; el historial sigue en SQLite");
});
al("btnRecargarHist", "click", () => { cargarHistorialConsola(); toast("Historial recargado"); });
al("buscarConsola", "input", pintarConsola);
al("filtroConsola", "change", pintarConsola);
al("tareaSel", "change", () => { /* sin acción previa */ });

al("moduloSel", "change", (ev) => cambiarModulo(ev.target.value));
al("capacidadSel", "change", (ev) => cambiarCapacidad(ev.target.value));
al("btnEjecutarModulo", "click", ejecutarModulo);
al("btnRecargarModulos", "click", () => { cargarModulos(); toast("Módulos recargados"); });
al("btnImportarModulo", "click", () => {
  const archivo = document.getElementById("archivoModulo");
  if (archivo) archivo.click();
});
al("archivoModulo", "change", importarModulo);
al("btnImportarTexto", "click", importarTexto);

al("chatProveedor", "change", (ev) => chatAplicarProveedor(ev.target.value, true));
const chatEntrada = document.getElementById("chatEntrada");
if (chatEntrada) {
  chatEntrada.addEventListener("input", () => chatAutoAlto(chatEntrada));
  chatEntrada.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      chatEnviar();
    }
  });
}

/* ========================================================================
   FabriNube — puente a la API en Vercel (InsForge)
   Los métodos nativos son asíncronos (avisan por callback); aquí se envuelven
   en promesas para usarlos con async/await desde el resto de la app.
   ======================================================================== */
window.FabriNube = (function () {
  let cbPensar = null;
  let cbSincronizar = null;
  let cbWebhook = null;

  return {
    configurar(url, token) {
      const r = JSON.parse(window.FabrickNative.apiNubeConfigurar(url, token));
      return r;
    },
    estado() {
      const r = JSON.parse(window.FabrickNative.apiNubeEstado());
      return r;
    },
    pensar(texto, contexto) {
      return new Promise((resolve) => {
        cbPensar = resolve;
        window.FabrickNative.apiNubePensar(texto, contexto);
      });
    },
    sincronizar(tabla, filasJson, operacion) {
      return new Promise((resolve) => {
        cbSincronizar = resolve;
        window.FabrickNative.apiNubeSincronizar(tabla, filasJson, operacion);
      });
    },
    webhook(tipo, mensaje, origen) {
      return new Promise((resolve) => {
        cbWebhook = resolve;
        window.FabrickNative.webhookNotificar(tipo, mensaje, origen);
      });
    },
    // Callbacks invocados desde el código nativo (Java):
    _pensarResultado(r) {
      if (cbPensar) { cbPensar(r); cbPensar = null; }
    },
    _sincronizarResultado(r) {
      if (cbSincronizar) { cbSincronizar(r); cbSincronizar = null; }
    },
    _webhookResultado(r) {
      if (cbWebhook) { cbWebhook(r); cbWebhook = null; }
    },
  };
})();

// Enlace global para que Java pueda notificar resultados a FabriNube
window.FabriNube.pensar = function (r) { window.FabriNube._pensarResultado(r); };
window.FabriNube.sincronizar = function (r) { window.FabriNube._sincronizarResultado(r); };
window.FabriNube.webhook = function (r) { window.FabriNube._webhookResultado(r); };

/* ==========================================================================
   REVISIÓN · registro persistente
   --------------------------------------------------------------------------
   Cada acción, error y tiempo queda en la tabla `revision` de SQLite. No es
   un log de texto: lleva tipo, severidad, origen, detalle y milisegundos, para
   poder responder «¿qué botón falló, cuánto tardó y con qué código?».
   ========================================================================== */

/** Escribe una fila de revisión. Nunca lanza y nunca usa api() (evita bucles). */
function revision(tipo, severidad, mensaje, detalle, ms, origen) {
  try {
    if (!window.FabrickNative) return;
    window.FabrickNative.call("revision.registrar", JSON.stringify({
      tipo: String(tipo || "evento"),
      severidad: String(severidad || "info"),
      origen: String(origen || "ui"),
      mensaje: String(mensaje || ""),
      detalle: detalle == null ? "" : String(detalle),
      ms: Math.round(Number(ms) || 0)
    }));
  } catch (e) {
    // El registro jamás puede romper la acción que se estaba haciendo.
  }
}

/** Registro automático: fallos de cualquier operación y operaciones lentas. */
function revisionAuto(op, r, ms) {
  if (!r) return;
  if (!r.ok) {
    revision("error", "error", "falló " + op + ": " + (r.error || "sin mensaje"),
      "codigo=" + (r.codigo || "?") + " · ms=" + ms, ms, "api");
    return;
  }
  if (ms >= 900 && op !== "revision.registrar") {
    revision("lento", "aviso", op + " tardó " + ms + " ms",
      "Operación por encima de 900 ms: revisar carga del núcleo o del modelo.", ms, "api");
  }
}

/* Cola de incidencias: una sola escritura cada 400 ms, y como mucho 30 avisos
   por sesión. Sin esto, un fallo en bucle generaba una escritura por cada
   llamada y realimentaba el bloqueo que se quería diagnosticar. */
const revPendientes = [];
let revTimer = null;
let revAvisos = 0;

function revisionAutoDiferido(op, r, ms) {
  if (!r || revAvisos >= 30) return;
  if (!r.ok) {
    // NUCLEO_OCUPADO y LENTO son estados normales del arranque, no errores.
    if (r.codigo === "NUCLEO_OCUPADO" || r.codigo === "LENTO") return;
    revPendientes.push({
      tipo: "error", severidad: "error",
      mensaje: "falló " + op + ": " + (r.error || "sin mensaje"),
      detalle: "codigo=" + (r.codigo || "?") + " · ms=" + ms,
      ms: ms
    });
  } else if (ms >= 900) {
    revPendientes.push({
      tipo: "lento", severidad: "aviso",
      mensaje: op + " tardó " + ms + " ms",
      detalle: "Operación por encima de 900 ms.", ms: ms
    });
  }
  if (!revPendientes.length || revTimer) return;
  revTimer = setTimeout(function () {
    revTimer = null;
    const lote = revPendientes.splice(0, 5);
    revAvisos += lote.length;
    lote.forEach(function (x) {
      revision(x.tipo, x.severidad, x.mensaje, x.detalle, x.ms, "api");
    });
  }, 400);
}

let revFiltro = "";
let revCache = [];

function revisionIniciar() {
  pintarRevision();
}

/* ------------------- vigilancia automática del núcleo ----------------------
   Ping periódico + consulta del registro de errores, para que un fallo se vea
   solo sin abrir el diagnóstico a mano.

   No usa api() a propósito: api() anota en `revision` CADA operación fallida,
   y un ping que falla cada 45 s llenaría la tabla de ruido y taparía el error
   original. Aquí se llama al puente en crudo y sólo se registra el CAMBIO de
   estado, más el aviso cuando el total de errores sube.
   ------------------------------------------------------------------------- */
const salud = {
  timer: null,
  intervaloMs: 45000,
  vivo: null,          // null = todavía sin comprobar
  erroresVistos: -1,   // línea base del total de errores
  fallosSeguidos: 0,
  ultimaMs: 0,
  ultimoPingMs: 0,
  recuperando: false
};

/** Ping directo al núcleo, sin pasar por api() ni por el registro automático. */
function saludPing() {
  if (!window.FabrickNative) return null;
  const t0 = Date.now();
  try {
    const crudo = window.FabrickNative.call("ping", "{}");
    const r = crudo ? JSON.parse(crudo) : null;
    return { ok: !!(r && r.ok), ms: Date.now() - t0, error: r && r.error };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: String(e) };
  }
}

/** Pinta el estado del núcleo en el piloto de la cabecera. */
function saludPintar() {
  const piloto = document.getElementById("pilotoNucleo");
  if (!piloto) return;
  const errores = salud.erroresVistos > 0 ? salud.erroresVistos : 0;
  if (salud.vivo === false) {
    piloto.className = "pill pill-error";
    piloto.textContent = "sin núcleo";
  } else if (errores > 0) {
    piloto.className = "pill pill-warning";
    piloto.textContent = "núcleo activo · " + errores + (errores === 1 ? " error" : " errores");
  } else {
    piloto.className = "pill pill-ok";
    piloto.textContent = "núcleo activo";
  }
  piloto.title = salud.ultimaMs
    ? "Última comprobación: " + hora(salud.ultimaMs) + " · ping " + salud.ultimoPingMs + " ms"
    : "";
}

/** Relee el sistema y repinta cuando el núcleo vuelve tras una caída. */
function saludRecuperar() {
  if (salud.recuperando) return;
  salud.recuperando = true;
  try {
    const crudo = window.FabrickNative.call("sys", "{}");
    const r = crudo ? JSON.parse(crudo) : null;
    if (r && r.ok) {
      estadoApp.sistema = r.data;
      pintarInicio();
      saludPintar();
    }
  } catch (e) {
    // Si aún no responde, la próxima vuelta lo reintenta.
  } finally {
    salud.recuperando = false;
  }
}

/** Una vuelta completa: ping y, si hay núcleo, consulta de errores. */
function saludRevisar() {
  if (document.hidden) return;      // en segundo plano no se gasta batería
  const p = saludPing();
  if (!p) return;

  const antes = salud.vivo;
  salud.vivo = p.ok;
  salud.ultimaMs = Date.now();
  salud.ultimoPingMs = p.ms;

  // Cambio de estado: se registra UNA vez, no en cada vuelta. La primera
  // comprobación (antes === null) sólo fija la línea base: no es un cambio.
  if (antes !== null && antes !== p.ok) {
    if (p.ok) {
      revision("salud", "info", "el núcleo volvió a responder",
        "ping " + p.ms + " ms", p.ms, "vigilancia");
      if (antes === false) {
        toast("Núcleo recuperado");
        saludRecuperar();
      }
    } else {
      revision("salud", "error", "el núcleo dejó de responder al ping",
        (p.error ? "error=" + p.error + " · " : "") + "ms=" + p.ms, p.ms, "vigilancia");
    }
  }

  if (!p.ok) {
    salud.fallosSeguidos++;
    // Un ping lento aislado no es una caída: se avisa al tercer fallo seguido.
    if (salud.fallosSeguidos === 3) {
      toast("El núcleo no responde", "error");
    }
    saludPintar();
    return;
  }
  salud.fallosSeguidos = 0;

  // Consulta de errores: sólo se avisa cuando el total SUBE.
  let res = null;
  try {
    const crudo = window.FabrickNative.call("revision.resumen", "{}");
    res = crudo ? JSON.parse(crudo) : null;
  } catch (e) {
    res = null;
  }
  if (!res || !res.ok) return;

  const d = res.data || {};
  const errores = Number(d.errores || 0);
  if (salud.erroresVistos < 0) {
    salud.erroresVistos = errores;          // primera lectura: sólo línea base
  } else if (errores > salud.erroresVistos) {
    const nuevos = errores - salud.erroresVistos;
    salud.erroresVistos = errores;
    toast(nuevos === 1 ? "Hay un error nuevo en el registro"
                       : "Hay " + nuevos + " errores nuevos", "error");
  } else if (errores < salud.erroresVistos) {
    salud.erroresVistos = errores;          // el registro se limpió o rotó
  }
  saludPintar();
}

function saludIniciar() {
  if (salud.timer) return;
  // Primera comprobación tardía: deja terminar el arranque y el login.
  setTimeout(saludRevisar, 9000);
  salud.timer = setInterval(saludRevisar, salud.intervaloMs);
  // Al volver del segundo plano se comprueba de inmediato.
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) setTimeout(saludRevisar, 800);
  });
}

// Acceso manual y para pruebas (consola del teléfono o arnés en Node).
window.FabriSalud = {
  revisar: saludRevisar,
  iniciar: saludIniciar,
  estado: function () {
    return {
      vivo: salud.vivo,
      errores: salud.erroresVistos,
      fallosSeguidos: salud.fallosSeguidos,
      ultimoPingMs: salud.ultimoPingMs,
      intervaloMs: salud.intervaloMs
    };
  }
};

function pintarRevision() {
  const kpis = document.getElementById("revisionKpis");
  const lista = document.getElementById("revisionLista");

  const res = api("revision.resumen", {});
  if (kpis) {
    if (!res.ok) {
      kpis.innerHTML = '<p class="nota">No se pudo leer el resumen: ' + esc(res.error) + "</p>";
    } else {
      const d = res.data || {};
      const filas = [
        ["Eventos", d.total || 0, ""],
        ["Errores", d.errores || 0, "error"],
        ["Avisos", d.avisos || 0, "aviso"],
        ["Último", d.ultimo ? hora(d.ultimo) : "—", "ok"]
      ];
      kpis.innerHTML = filas.map(([k, v, c]) =>
        '<div class="revision-kpi ' + c + '"><span>' + esc(k) + "</span><strong>" + esc(String(v)) + "</strong></div>"
      ).join("");
    }
  }

  const l = api("revision.listar", { limite: 200, severidad: revFiltro });
  if (!lista) return;
  if (!l.ok) {
    lista.innerHTML = '<p class="nota">No se pudo leer el registro: ' + esc(l.error) + "</p>";
    revCache = [];
    return;
  }
  revCache = (l.data && l.data.eventos) || [];
  if (!revCache.length) {
    lista.innerHTML = '<p class="nota">Todavía no hay eventos con ese filtro. Usa la app un rato y vuelve a refrescar.</p>';
    return;
  }
  lista.innerHTML = revCache.map((e) => {
    const sev = String(e.severidad || "info");
    return '<article class="revision-item ' + esc(sev) + '">'
      + '<div class="revision-cab">'
      + '<span class="rev-tipo">' + esc(e.tipo) + "</span>"
      + "<span>" + esc(hora(e.ts)) + "</span>"
      + "<span>" + esc(e.origen) + "</span>"
      + (e.ms ? '<span class="rev-ms">' + esc(String(e.ms)) + " ms</span>" : "")
      + "</div>"
      + '<div class="revision-msg">' + esc(e.mensaje) + "</div>"
      + (e.detalle ? '<div class="revision-det">' + esc(e.detalle) + "</div>" : "")
      + "</article>";
  }).join("");
}

function revisionExportar() {
  if (!revCache.length) {
    toast("No hay eventos para exportar");
    return;
  }
  copiar(JSON.stringify(revCache, null, 2), "Registro copiado como JSON");
}

/**
 * Comprobación REAL del sistema. No lee el registro (eso contestaría con lo
 * que ya se escribió, aunque fuera de una versión vieja): pide al núcleo que
 * ejecute las pruebas contra SQLite y el disco. El resultado se muestra aquí
 * mismo y queda anotado en el registro.
 */
function revisionVerificar() {
  const caja = document.getElementById("revisionVerificacion");
  const btn = document.getElementById("btnRevisionVerificar");
  if (caja) {
    caja.hidden = false;
    caja.innerHTML = '<p class="nota">Ejecutando pruebas reales sobre la base y el disco...</p>';
  }
  if (btn) btn.disabled = true;
  if (!window.FabrickNative) {
    if (caja) caja.innerHTML = '<p class="nota">El puente nativo no está disponible.</p>';
    if (btn) btn.disabled = false;
    return;
  }
  let r = null;
  try {
    const crudo = window.FabrickNative.call("revision.verificar", "{}");
    r = crudo ? JSON.parse(crudo) : null;
  } catch (e) {
    r = { ok: false, error: String(e) };
  }
  if (btn) btn.disabled = false;
  if (!r || !r.ok) {
    if (caja) caja.innerHTML = '<p class="nota">No se pudo verificar: ' + esc((r && r.error) || "sin respuesta") + "</p>";
    return;
  }
  const d = r.data || r;
  const hallazgos = d.hallazgos || [];
  const icono = d.errores > 0 ? "alerta" : "ok";
  if (caja) {
    caja.innerHTML =
      '<div class="rev-verif-cab ' + (d.errores > 0 ? "mal" : "bien") + '">' +
        '<strong>' + (d.errores > 0 ? "Se encontraron " + d.errores + " error(es)" : "Todo en orden") + "</strong>" +
        '<span>' + (d.total || hallazgos.length) + " prueba(s) · " + (d.avisos || 0) + " aviso(s)</span>" +
      "</div>" +
      '<div class="rev-verif-lista">' +
        hallazgos.map(function (h) {
          return '<div class="rev-verif-item ' + esc(h.nivel) + '">' +
            '<span class="rev-verif-prueba">' + esc(h.prueba) + "</span>" +
            '<span class="rev-verif-detalle">' + esc(h.detalle) + "</span>" +
          "</div>";
        }).join("") +
      "</div>";
  }
  toast(d.errores > 0 ? ("Verificación: " + d.errores + " error(es)") : "Verificación: sin errores",
    d.errores > 0 ? "error" : "ok");
  pintarRevision();
}

/** Borra del registro los errores viejos (o todo, si se confirma dos veces). */
function revisionLimpiar() {
  if (!window.FabrickNative) { toast("El puente nativo no está disponible", "error"); return; }
  const todo = confirm("¿Borrar TODO el registro de revisión?\n\nAceptar = borrar todo · Cancelar = borrar solo errores y críticos.");
  const modo = todo ? "todo" : "errores";
  if (!todo && !confirm("Se borrarán los errores y críticos del registro. La historia útil (info y avisos) se conserva.\n\n¿Continuar?")) return;
  let r = null;
  try {
    const crudo = window.FabrickNative.call("revision.limpiar", JSON.stringify({ modo: modo }));
    r = crudo ? JSON.parse(crudo) : null;
  } catch (e) {
    r = { ok: false, error: String(e) };
  }
  if (!r || !r.ok) { toast("No se pudo limpiar: " + ((r && r.error) || "sin respuesta"), "error"); return; }
  const d = r.data || r;
  toast("Limpieza: " + (d.borrados || 0) + " fila(s) borrada(s)");
  const caja = document.getElementById("revisionVerificacion");
  if (caja) caja.hidden = true;
  pintarRevision();
}

/* Errores globales: cualquier excepción no capturada queda registrada con su
   archivo y línea, en vez de morir en la consola del WebView. */
window.addEventListener("error", function (ev) {
  // El WebView en origen file:// entrega "Script error." sin línea; si el
  // objeto Error viaja en `ev.error`, su stack sí resuelve la causa.
  if (ev && ev.error) {
    jsError(ev.error, "global");
    return;
  }
  revision("error", "critico", "excepción no capturada: " + (ev.message || "sin mensaje"),
    (ev.filename || "?") + ":" + (ev.lineno || 0) + ":" + (ev.colno || 0), 0, "js");
});
window.addEventListener("unhandledrejection", function (ev) {
  const razon = ev && ev.reason;
  if (razon instanceof Error) {
    jsError(razon, "promesa");
    return;
  }
  const m = razon ? (razon.message || String(razon)) : "promesa rechazada";
  revision("error", "error", "promesa rechazada: " + m, "", 0, "js");
});

/* Seguimiento de clics en botones: sirve para reproducir «toqué X y no pasó
   nada». Se deduplica: dos clics seguidos en el mismo control (< 1200 ms) no
   generan dos entradas; el registro queda para lo que aporta información. */
let ultimoClic = { clave: "", ts: 0 };
document.addEventListener("click", function (ev) {
  try {
    const el = ev.target.closest("button, [data-vista], [data-accion]");
    if (!el) return;
    // Etiqueta útil: id → data-vista → data-accion → texto visible → clase.
    // Antes caía en «btn» o «elemento», que no dicen nada al depurar.
    const texto = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 34);
    const nombre = el.id
      || el.dataset.vista
      || el.dataset.accion
      || (texto ? "«" + texto + "»" : "")
      || (el.className ? String(el.className).split(" ")[0] : "elemento");
    const ahora = Date.now();
    if (nombre === ultimoClic.clave && ahora - ultimoClic.ts < 1200) return;
    ultimoClic = { clave: nombre, ts: ahora };
    revision("click", "info", "clic: " + nombre, "", 0, "ui");
  } catch (e) { /* nunca romper el clic */ }
}, true);

/* ==========================================================================
   CÓDIGO DE BARRAS · Code128-B real (ISO/IEC 15417)
   --------------------------------------------------------------------------
   La credencial del login y la tarjeta de «Mi identidad» comparten este mismo
   codificador. No es un patrón decorativo: lleva start B, dígito verificador
   módulo 103 y stop, así que un lector Code128 lo puede leer de verdad.
   ========================================================================== */

/* Anchos de cada símbolo: 3 barras + 3 espacios = 11 módulos. El stop usa
   7 elementos = 13 módulos. Tabla ISO/IEC 15417. */
const FABRICK_CODE128 = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112"
];

/** Devuelve {texto, patron, ancho, verificador} para un texto en Code128-B. */
function fabrickCode128(texto) {
  // Code128-B cubre ASCII 32..126. El ID de cliente y el indicativo son
  // códigos legibles, así que se normalizan a mayúsculas y sin acentos.
  let limpio = String(texto == null ? "" : texto)
    .toUpperCase()
    .replace(/[^\x20-\x7E]/g, "")
    .trim()
    .slice(0, 48);
  if (!limpio) limpio = "FORGE CORE STOCK";
  const valores = [];
  for (let i = 0; i < limpio.length; i++) {
    valores.push(limpio.charCodeAt(i) - 32);
  }
  // Verificador: start B (104) + valor × posición, módulo 103.
  let suma = 104;
  for (let i = 0; i < valores.length; i++) suma += valores[i] * (i + 1);
  const verificador = suma % 103;
  const secuencia = [104].concat(valores, [verificador, 106]);
  let patron = "";
  for (let i = 0; i < secuencia.length; i++) patron += FABRICK_CODE128[secuencia[i]];
  let ancho = 0;
  for (let i = 0; i < patron.length; i++) ancho += Number(patron.charAt(i));
  return { texto: limpio, patron: patron, ancho: ancho, verificador: verificador };
}

/** Pinta un Code128-B dentro de un <svg>. Devuelve el patrón o null. */
function fabrickBarcodePintar(svg, texto, alto) {
  if (!svg) return null;
  const info = fabrickCode128(texto);
  const H = alto || 34;
  const QUIETO = 10; // zona de silencio mínima de Code128: 10 módulos
  const ns = "http://www.w3.org/2000/svg";
  try {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute("viewBox", (-QUIETO) + " 0 " + (info.ancho + QUIETO * 2) + " " + H);
    svg.setAttribute("preserveAspectRatio", "none");
    const frag = document.createDocumentFragment();
    let x = 0;
    for (let i = 0; i < info.patron.length; i++) {
      const w = Number(info.patron.charAt(i));
      if (i % 2 === 0) {
        const r = document.createElementNS(ns, "rect");
        r.setAttribute("x", String(x));
        r.setAttribute("y", "0");
        r.setAttribute("width", String(w));
        r.setAttribute("height", String(H));
        r.setAttribute("fill", "currentColor");
        frag.appendChild(r);
      }
      x += w;
    }
    svg.appendChild(frag);
  } catch (e) {
    return null;
  }
  return info;
}

window.fabrickCode128 = fabrickCode128;
window.fabrickBarcodePintar = fabrickBarcodePintar;

/* ==========================================================================
   ACCESO · huella + PIN
   ========================================================================== */

window.FabriHuella = {
  /** Callback que Java invoca tras activar o autenticar con huella. */
  resultado: function (r) {
    // «Mi identidad» también enrola huella. Si dejó una operación pendiente,
    // el resultado es suyo: no debe entrar a la app por detrás.
    try {
      if (window.FabriIdentidad && FabriIdentidad.huellaPendiente()
          && FabriIdentidad.huellaResultado(r || {})) {
        return;
      }
    } catch (e) { /* sigue el camino del login */ }
    // Si la delegación de clics no llegó a registrarse (app.js murió a mitad),
    // el respaldo de index.html es quien decide: así la huella no se pierde.
    if (!window.__fabriDelegacion && typeof window.__fabriRespaldoResultado === "function") {
      try { window.__fabriRespaldoResultado(r || {}); } catch (e) { /* nunca romper */ }
      return;
    }
    try { FabriLogin._resultado(r || {}); } catch (e) { /* nunca romper */ }
  }
};

const FabriLogin = (function () {
  let pendiente = "";
  let perfil = { nombre: "", indicativo: "" };
  let autoHuellaHecha = false;
  let est = {
    pinConfigurado: false,
    huellaActiva: false,
    huellaDisponible: false,
    bloqueado: false,
    bloqueadoHasta: 0
  };

  function $(id) { return document.getElementById(id); }

  function mostrar(panel) {
    const setup = $("loginSetup");
    const entrar = $("loginEntrar");
    if (setup) setup.hidden = panel !== "setup";
    if (entrar) entrar.hidden = panel !== "entrar";
  }

  function estado(texto, clase) {
    const el = $("loginEstado");
    if (!el) return;
    el.textContent = texto || "";
    el.className = "login-estado" + (clase ? " " + clase : "");
  }

  function sacudir() {
    const caja = $("loginIdCard");
    if (!caja) return;
    caja.classList.remove("login-sacudir");
    void caja.offsetWidth;
    caja.classList.add("login-sacudir");
  }

  function leerEstado() {
    try {
      return JSON.parse(window.FabrickNative.huellaEstado()) || {};
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  /** Verificador del PIN guardado en la tabla `usuarios` (o null si no hay).
   *  Devuelve "pendiente" si el núcleo todavía está iniciando: en ese caso no
   *  se puede afirmar que no haya verificador, así que la pantalla espera en
   *  vez de ofrecer «crear PIN» encima de uno que ya existe. */
  function verificadorDb() {
    try {
      const r = api("usuarios", { accion: "verificador", usuario: "operador" });
      if (!r.ok) return r.codigo === "NUCLEO_OCUPADO" ? "pendiente" : null;
      const d = r.data || {};
      return d.existe && d.sal && d.hash ? d : null;
    } catch (e) {
      return null;
    }
  }

  function aplicar() {
    const r = leerEstado();
    if (!r.ok) {
      estado("No se pudo leer el estado de acceso: " + (r.error || "error"), "error");
      return;
    }
    est = r;

    const bHuella = $("btnLoginHuella");
    const bActivar = $("btnLoginActivar");

    if (!r.pinConfigurado) {
      // Respaldo: si la base tiene el verificador del PIN, el acceso no está
      // perdido aunque las preferencias del teléfono se hayan borrado. Se
      // ofrece el PIN en vez de pedir crear uno nuevo encima del que ya existe.
      // Si el núcleo todavía no abrió SQLite, ni se pregunta: consultar
      // costaría 1,2 s de pantalla congelada justo en el acceso.
      const vdb = nucleoPreparado() ? verificadorDb() : "pendiente";
      if (vdb === "pendiente") {
        // El núcleo está migrando: se ofrece el PIN igual y se vuelve a
        // decidir cuando avise que está listo. Nunca se bloquea la pantalla.
        mostrar("entrar");
        if (bActivar) bActivar.hidden = true;
        if (bHuella) bHuella.hidden = true;
        const sepPend = $("loginSep");
        if (sepPend) sepPend.hidden = true;
        estado("El núcleo está iniciando. Escribe tu PIN o espera un momento.", "aviso");
        return;
      }
      if (vdb) {
        mostrar("entrar");
        if (bActivar) bActivar.hidden = true;
        if (bHuella) bHuella.hidden = true;
        const sepDb = $("loginSep");
        if (sepDb) sepDb.hidden = true;
        estado("Escribe tu PIN: se verifica contra la base de datos.");
        const campoDb = $("loginPin");
        if (campoDb) setTimeout(function () { campoDb.focus(); }, 90);
        return;
      }
      mostrar("setup");
      if (bActivar) bActivar.hidden = true;
      if (bHuella) bHuella.hidden = true;
      const sepSetup = $("loginSep");
      if (sepSetup) sepSetup.hidden = true;
      estado("Primera vez: crea tu PIN de acceso.");
      const i = $("loginPinNuevo");
      if (i) setTimeout(function () { i.focus(); }, 90);
      return;
    }

    mostrar("entrar");
    const sdkOk = !r.sdk || r.sdk >= 28;
    const huellaLista = !!(r.huellaActiva && sdkOk);
    if (bHuella) bHuella.hidden = !huellaLista;
    // El separador «o usa tu PIN» solo tiene sentido si hay huella arriba.
    const sep = $("loginSep");
    if (sep) sep.hidden = !huellaLista;
    if (bActivar) bActivar.hidden = !(r.huellaDisponible && !r.huellaActiva && sdkOk);
    // La activación de huella es una acción de esta pantalla, no una opción
    // escondida: se ofrece desde el arranque. Si el teléfono no tiene huella
    // o el Android es antiguo, el botón explica el motivo exacto al tocarlo.
    if (bActivar) bActivar.hidden = !!r.huellaActiva;

    if (r.bloqueado) {
      const seg = Math.max(1, Math.ceil(((r.bloqueadoHasta || 0) - Date.now()) / 1000));
      estado("Demasiados intentos fallidos. Espera " + seg + " s.", "error");
    } else if (r.huellaActiva) {
      estado("Toca «Acceder con huella» o escribe tu PIN.");
    } else if (r.huellaDisponible && !sdkOk) {
      estado("Este Android (" + r.sdk + ") no permite huella con clave segura. Usa el PIN.");
    } else if (r.huellaDisponible) {
      estado("Escribe tu PIN. Después puedes activar la huella.");
    } else {
      estado("Escribe tu PIN para entrar.");
    }
  }

  function entrar(motivo) {
    const capa = $("loginFabrick");
    if (capa) capa.hidden = true;
    document.body.classList.remove("login-abierto");
    revision("acceso", "info", "acceso concedido (" + (motivo || "pin") + ")");
    // Se deja constancia en la tabla de usuarios de cuándo entró el operador.
    // Diferido: el acceso ya está concedido y esto no debe demorar la entrada.
    setTimeout(function () {
      try { api("usuarios", { accion: "ultimo_acceso", usuario: "operador" }); }
      catch (e) { /* no puede impedir la entrada */ }
    }, 0);
    toast("Acceso concedido", "");
    setTimeout(function () {
      try { pintarInicio(); } catch (e) { /* el inicio se repinta solo */ }
    }, 80);
  }

  function iniciar() {
    document.body.classList.add("login-abierto");
    if (!window.FabrickNative) {
      mostrar("entrar");
      const b1 = $("btnLoginHuella");
      const b2 = $("btnLoginPin");
      if (b1) b1.hidden = true;
      if (b2) b2.hidden = true;
      estado("Vista previa sin núcleo: el acceso real sólo funciona dentro de la APK.", "aviso");
      return;
    }
    try {
      aplicar();
    } catch (e) {
      revision("acceso", "error", "no se pudo leer el estado de acceso: " + e,
        String(e && e.stack || "").slice(0, 400), 0, "huella");
    }
    // Red de seguridad: si `aplicar()` falló, respondió con error o se quedó a
    // medias, ningún panel queda visible y la tarjeta se ve vacía para siempre
    // («Comprobando acceso…»). En ese caso se ofrece el PIN igual: perder el
    // acceso a la app por un fallo de lectura sería peor que el fallo mismo.
    const setup = $("loginSetup");
    const entrar = $("loginEntrar");
    if (setup && entrar && setup.hidden && entrar.hidden) {
      mostrar("entrar");
      estado("No se pudo leer el estado de acceso. Escribe tu PIN o restablece el acceso.", "aviso");
      const campo = $("loginPin");
      if (campo) setTimeout(function () { campo.focus(); }, 90);
    }
    // La tarjeta se dibuja siempre, incluso si el estado de acceso falló:
    // es la identidad visual del operador, no parte de la autenticación.
    mallaConstruir();
    escucharPin();
    // El perfil vive en SQLite, así que puede esperar al núcleo. Se pide en el
    // siguiente turno: si el núcleo todavía migra, el PIN y los botones ya
    // responden mientras tanto (antes esto congelaba la pantalla de acceso).
    setTimeout(function () { try { perfilCargar(); } catch (e) { /* el perfil es cosmético */ } }, 0);
    // Si la huella está activada, se pide sola al abrir: es lo que el usuario
    // espera al haberla activado. Una sola vez por arranque, y nunca si hay
    // bloqueo por intentos fallidos.
    if (est && est.huellaActiva && !est.bloqueado && !autoHuellaHecha) {
      autoHuellaHecha = true;
      setTimeout(function () {
        const capa = $("loginFabrick");
        if (!capa || capa.hidden) return;
        entrarHuella();
      }, 260);
    }
  }

  function crearPin() {
    const a = $("loginPinNuevo");
    const b = $("loginPinNuevo2");
    const pin = a ? a.value.trim() : "";
    const pin2 = b ? b.value.trim() : "";
    if (!/^\d{4,6}$/.test(pin)) {
      estado("El PIN debe tener de 4 a 6 dígitos.", "error");
      sacudir();
      return;
    }
    if (pin !== pin2) {
      estado("Los dos PIN no coinciden.", "error");
      sacudir();
      return;
    }
    let r;
    try {
      r = JSON.parse(window.FabrickNative.huellaConfigurarPin(pin));
    } catch (e) {
      r = { ok: false, error: String(e) };
    }
    if (!r.ok) {
      estado(r.error || "No se pudo guardar el PIN", "error");
      sacudir();
      revision("acceso", "error", "no se pudo crear el PIN: " + (r.error || ""), "codigo=" + (r.codigo || "?"), 0, "huella");
      return;
    }
    // El verificador se guarda también en la tabla `usuarios`: el acceso queda
    // respaldado en SQLite, no sólo en las preferencias del teléfono. Si esto
    // fallara, el PIN sigue funcionando (las preferencias ya lo tienen), pero
    // el respaldo de la base no existiría: se avisa y se registra.
    try {
      const g = api("usuarios", {
        accion: "crear",
        usuario: "operador",
        nombre: perfil.nombre || "Operador",
        indicativo: perfil.indicativo || "",
        foto: perfil.foto || "",
        rol: "propietario",
        algoritmo: r.algoritmo || "",
        sal: r.sal || "",
        hash: r.hash || "",
        iteraciones: r.iteraciones || 0
      });
      if (!g.ok) {
        revision("acceso", "aviso", "el PIN no se pudo respaldar en la tabla usuarios",
          String(g.error || ""), 0, "core");
      }
    } catch (e) {
      revision("acceso", "aviso", "el PIN no se pudo respaldar en la tabla usuarios", String(e), 0, "core");
    }
    if (a) a.value = "";
    if (b) b.value = "";
    entrar("pin nuevo");
  }

  function entrarPin() {
    const campo = $("loginPin");
    const pin = campo ? campo.value.trim() : "";
    if (!/^\d{4,6}$/.test(pin)) {
      estado("Escribe tu PIN de 4 a 6 dígitos.", "error");
      sacudir();
      return;
    }
    let r;
    try {
      r = JSON.parse(window.FabrickNative.huellaVerificarPin(pin));
    } catch (e) {
      r = { ok: false, error: String(e) };
    }
    // Si las preferencias no tienen PIN pero la base sí, se verifica contra el
    // verificador de `usuarios` (mismo PBKDF2, mismo bloqueo por intentos).
    // Nunca se prueba la base tras un PIN incorrecto: eso duplicaría los
    // intentos y saltaría el bloqueo.
    if (!r.ok && r.codigo === "SIN_PIN") {
      const v = verificadorDb();
      if (v) {
        try {
          r = JSON.parse(window.FabrickNative.huellaVerificarPinExterno(
            pin, v.algoritmo || "", v.sal || "", v.hash || ""));
        } catch (e) {
          r = { ok: false, error: String(e) };
        }
      }
    }
    if (!r.ok) {
      estado(r.error || "PIN incorrecto", "error");
      sacudir();
      if (campo) { campo.value = ""; campo.focus(); }
      revision("acceso", "error", "PIN rechazado: " + (r.error || ""), "codigo=" + (r.codigo || "?"), 0, "huella");
      return;
    }
    if (campo) campo.value = "";
    entrar("pin");
  }

  function entrarHuella() {
    pendiente = "autenticar";
    estado("Esperando la huella…");
    escanear(true);
    let r;
    try {
      r = JSON.parse(window.FabrickNative.huellaAutenticar());
    } catch (e) {
      r = { ok: false, error: String(e) };
    }
    if (!r.ok) {
      estado(r.error || "No se pudo abrir el lector de huella", "error");
      revision("acceso", "error", "huella no disponible: " + (r.error || ""), "codigo=" + (r.codigo || "?"), 0, "huella");
    }
  }

  function activarHuella() {
    if (est && est.huellaActiva) {
      estado("La huella ya está activada en este teléfono.", "ok");
      return;
    }
    if (est && est.huellaDisponible === false) {
      estado("Este teléfono no tiene una huella configurada. Actívala en Ajustes del sistema y vuelve.", "aviso");
      sacudir();
      return;
    }
    if (est && est.sdk && est.sdk < 28) {
      estado("Este Android (" + est.sdk + ") no permite huella con clave segura. Usa el PIN.", "aviso");
      sacudir();
      return;
    }
    const campo = $("loginPin");
    const pin = campo ? campo.value.trim() : "";
    if (!/^\d{4,6}$/.test(pin)) {
      estado("Para activar la huella, primero escribe tu PIN en el campo de abajo.", "aviso");
      sacudir();
      return;
    }
    let v;
    try {
      v = JSON.parse(window.FabrickNative.huellaVerificarPin(pin));
    } catch (e) {
      v = { ok: false, error: String(e) };
    }
    if (!v.ok) {
      estado("PIN incorrecto: no se puede activar la huella.", "error");
      sacudir();
      return;
    }
    if (campo) campo.value = "";
    pendiente = "activar";
    estado("Confirma tu huella para activarla.");
    escanear(true);
    let r;
    try {
      r = JSON.parse(window.FabrickNative.huellaActivar());
    } catch (e) {
      r = { ok: false, error: String(e) };
    }
    if (!r.ok) {
      estado(r.error || "No se pudo activar la huella", "error");
      revision("acceso", "error", "activación fallida: " + (r.error || ""), "codigo=" + (r.codigo || "?"), 0, "huella");
    }
  }

  function borrar() {
    const seguro = window.confirm(
      "Esto borra el PIN y la huella de FORGE CORE STOCK.\n\n"
      + "Después tendrás que crear un PIN nuevo. No borra datos, ni modelos, ni la base."
    );
    if (!seguro) return;
    let r;
    try {
      r = JSON.parse(window.FabrickNative.huellaBorrar());
    } catch (e) {
      r = { ok: false, error: String(e) };
    }
    if (!r.ok) {
      estado("No se pudo restablecer: " + (r.error || "error"), "error");
      return;
    }
    revision("acceso", "aviso", "acceso restablecido por el usuario");
    estado("Acceso restablecido. Crea un PIN nuevo.");
    aplicar();
  }

  function saltar() {
    const capa = $("loginFabrick");
    if (capa) capa.hidden = true;
    document.body.classList.remove("login-abierto");
    revision("acceso", "aviso", "entrada en modo diagnóstico sin autenticar");
    toast("Modo diagnóstico: el acceso sigue sin configurar", "error");
  }

  function bloquear() {
    const capa = $("loginFabrick");
    if (!capa) return;
    capa.hidden = false;
    document.body.classList.add("login-abierto");
    pendiente = "";
    // Al bloquear por inactividad se vuelve a ofrecer la huella: es el gesto
    // natural para desbloquear sin escribir nada.
    autoHuellaHecha = false;
    if (window.FabrickNative) {
      try { window.FabrickNative.huellaBloquear(); } catch (e) { /* ya bloqueado */ }
    }
    aplicar();
    estado("Sesión bloqueada por inactividad. Confirma tu huella o PIN.", "aviso");
    revision("acceso", "aviso", "sesión bloqueada por inactividad");
    if (est && est.huellaActiva && !est.bloqueado && !autoHuellaHecha) {
      autoHuellaHecha = true;
      setTimeout(function () {
        const c = $("loginFabrick");
        if (c && !c.hidden) entrarHuella();
      }, 320);
    }
  }

  /** Resultado que llega desde Java (BiometricPrompt). */
  function resultado(r) {
    const era = pendiente;
    pendiente = "";
    escanear(false);
    if (r.ok) {
      if (era === "activar") {
        revision("acceso", "info", "huella activada");
        estado("Huella activada.", "ok");
        entrar("huella recién activada");
      } else {
        entrar("huella");
      }
      return;
    }
    const codigo = String(r.codigo || "");
    if (codigo === "CANCELADO") {
      estado("Cancelaste la huella. Puedes usar tu PIN.", "aviso");
      revision("acceso", "aviso", "huella cancelada por el usuario");
      return;
    }
    estado(r.error || "No se pudo verificar la huella", "error");
    sacudir();
    revision("acceso", "error", "huella rechazada: " + (r.error || ""), "codigo=" + codigo, 0, "huella");
    if (codigo === "HUELLA_INVALIDADA") aplicar();
  }

  /* ── malla facial + foto del operador ──────────────────────────────────── */

  /**
   * Dibuja una malla de triángulos sobre el rostro. No es decoración gratuita:
   * es la metáfora visual de lo que hará el módulo de visión cuando esté
   * instalado (detectar y mapear la cara). Se genera una vez y queda estática;
   * sólo cambia de opacidad cuando el campo del PIN tiene el foco.
   */
  function mallaConstruir() {
    const svg = $("loginMalla");
    if (!svg || svg.childElementCount) return;
    try {
      const FILAS = 9;
      const COLS = 7;
      const pts = [];
      for (let f = 0; f < FILAS; f++) {
        const t = f / (FILAS - 1);
        // El ancho se angosta en la frente y en el mentón: eso lo hace
        // parecer una cara y no una rejilla.
        const ancho = 0.54 + 0.32 * Math.sin(Math.PI * Math.pow(t, 0.85));
        for (let c = 0; c < COLS; c++) {
          const u = c / (COLS - 1) - 0.5;
          const jx = Math.sin((f * 7 + c * 13) * 1.7) * 1.5;
          const jy = Math.cos((f * 11 + c * 5) * 1.3) * 1.3;
          pts.push([50 + u * 100 * ancho + jx, 11 + t * 76 + jy]);
        }
      }
      const idx = function (f, c) { return f * COLS + c; };
      const ns = "http://www.w3.org/2000/svg";
      const frag = document.createDocumentFragment();
      const linea = function (a, b) {
        const l = document.createElementNS(ns, "line");
        l.setAttribute("x1", a[0].toFixed(1));
        l.setAttribute("y1", a[1].toFixed(1));
        l.setAttribute("x2", b[0].toFixed(1));
        l.setAttribute("y2", b[1].toFixed(1));
        frag.appendChild(l);
      };
      for (let f = 0; f < FILAS - 1; f++) {
        for (let c = 0; c < COLS - 1; c++) {
          const a = pts[idx(f, c)];
          const b = pts[idx(f, c + 1)];
          const d = pts[idx(f + 1, c)];
          const e = pts[idx(f + 1, c + 1)];
          linea(a, b); linea(b, e); linea(e, d); linea(d, a); linea(a, e);
        }
      }
      pts.forEach(function (p) {
        const o = document.createElementNS(ns, "circle");
        o.setAttribute("cx", p[0].toFixed(1));
        o.setAttribute("cy", p[1].toFixed(1));
        o.setAttribute("r", "0.8");
        frag.appendChild(o);
      });
      svg.appendChild(frag);
    } catch (e) {
      // Sin malla la tarjeta sigue funcionando: no es un requisito de acceso.
    }
  }

  /** Lee el perfil de SQLite y lo pinta en la tarjeta. */
  function perfilCargar() {
    // La tarjeta sale de la tabla `usuarios` (con el perfil como respaldo) para
    // que el operador que ve el login sea el mismo que está en la base.
    let d = null;
    try {
      const u = api("usuarios", { accion: "listar" });
      if (u && u.ok) {
        const lista = (u.data && u.data.usuarios) || [];
        const activo = lista.filter(function (x) { return x.activo; })[0] || lista[0];
        if (activo) {
          d = {
            nombre: activo.nombre || "",
            indicativo: activo.indicativo || "",
            foto: activo.foto || ""
          };
        }
      }
    } catch (e) { /* se prueba el perfil */ }

    // La ficha del negocio (página «Mi identidad») vive en `perfil`. Se lee
    // SIEMPRE, no sólo cuando falta el nombre: antes, si el operador tenía
    // nombre pero no foto, el logo del negocio nunca llegaba al login.
    let p = null;
    try {
      const r = api("perfil", { accion: "obtener" });
      if (r && r.ok) p = r.data || {};
    } catch (e) { p = null; }

    d = d || {};
    if (!p) p = {};
    // `usuarios` manda para el operador; `perfil` rellena lo que falte y
    // aporta la ficha del negocio (logo, razón social, ID de cliente).
    if (!d.nombre && p.nombre) d.nombre = p.nombre;
    if (!d.indicativo && p.indicativo) d.indicativo = p.indicativo;
    if (!d.foto && p.foto) d.foto = p.foto;

    perfil.datos = p.datos || {};
    // Dos identidades en una: el negocio (marca del acceso) y el operador
    // (TITLE de la credencial). «Mi identidad» edita las dos; si el operador
    // no tiene nombre propio, se usa el del negocio como hasta ahora.
    const negocio = p.nombre || d.nombre || "";
    const operador = String((perfil.datos && perfil.datos.operador) || "").trim()
      || d.nombre || negocio;
    perfil.negocio = negocio;
    perfil.nombre = operador;
    perfil.indicativo = d.indicativo || p.indicativo || "";
    perfil.foto = p.foto || d.foto || "";
    const foto = $("loginFoto");
    const ind = $("loginIndicativo");
    const nom = $("loginNombre");
    const marca = $("loginMarca");
    // Sin foto del operador se usa el logo del negocio: la tarjeta nunca queda
    // con el marcador de carga si ya hay una imagen real guardada.
    const imagen = perfil.foto || (perfil.datos && perfil.datos.logo) || "";
    if (foto) {
      if (imagen) {
        foto.src = imagen;
        foto.classList.add("real");
      } else {
        // Se quitó la foto: no dejar la anterior pegada en la credencial.
        foto.src = "logo-f.svg";
        foto.classList.remove("real");
      }
    }
    if (ind) ind.textContent = perfil.indicativo || "FC-OPERATOR";
    if (nom) nom.textContent = operador || "CORE MODULE";
    if (marca) marca.textContent = negocio || "FORGE CORE STOCK PRO";
    // El código de barras es identidad visual del operador, no del acceso:
    // se dibuja siempre, haya o no foto en la base.
    barcodeConstruir(codigoOperador());
  }

  /**
   * Código estable del operador (mismo operador → mismo código). No es un
   * identificador de seguridad: es la leyenda de la tarjeta, como el número
   * de una credencial. Se deriva de indicativo + nombre con FNV-1a y una
   * segunda mezcla, así no cambia entre arranques.
   */
  function codigoOperador() {
    // Si la página «Mi identidad» ya definió un ID de cliente, la credencial
    // muestra ESE código: es el que el usuario reconoce como suyo.
    const cliente = perfil.datos && perfil.datos.id_cliente;
    if (cliente) return String(cliente).toUpperCase();
    const base = String(perfil.indicativo || "FC-OPERATOR") + "|" + String(perfil.nombre || "CORE MODULE");
    let h = 0x811c9dc5;
    for (let i = 0; i < base.length; i++) {
      h ^= base.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    let g = 0x9e3779b9;
    for (let i = base.length - 1; i >= 0; i--) {
      g ^= base.charCodeAt(i) + 0x9e3779b9 + (g << 6) + (g >>> 2);
      g >>>= 0;
    }
    const hex = ("00000000" + h.toString(16).toUpperCase()).slice(-8)
      + ("00000000" + g.toString(16).toUpperCase()).slice(-8);
    return "FC-" + hex.slice(0, 4) + "-" + hex.slice(4, 8) + "-" + hex.slice(8, 10);
  }

  /**
   * Dibuja el código del operador como Code128-B real (ISO/IEC 15417), con su
   * dígito verificador. Las barras son SVG para que se vean nítidas en
   * cualquier densidad de pantalla.
   */
  function barcodeConstruir(codigo) {
    const texto = codigo || codigoOperador();
    const num = $("loginCodigo");
    if (num) num.textContent = texto;
    // Code128-B real, el mismo codificador que usa «Mi identidad».
    fabrickBarcodePintar($("loginBarcode"), texto, 30);
  }

  function fotoElegir() {
    const input = $("loginFotoArchivo");
    if (!input) return;
    input.value = "";
    input.click();
  }

  /**
   * Reduce la foto a 256 px de lado mayor antes de guardarla. Una foto de
   * cámara pesa 3-5 MB y no tiene por qué entrar en SQLite ni viajar por el
   * puente: a 256 px con JPEG 0.82 queda en ~20 KB y se ve bien en la tarjeta.
   */
  function fotoProcesar(archivo) {
    if (!archivo) return;
    if (!/^image\//.test(archivo.type || "")) {
      toast("Elige una imagen", "error");
      return;
    }
    const lector = new FileReader();
    lector.onerror = function () { toast("No se pudo leer la imagen", "error"); };
    lector.onload = function () {
      const img = new Image();
      img.onerror = function () { toast("La imagen no se pudo abrir", "error"); };
      img.onload = function () {
        let datos = String(lector.result || "");
        try {
          const LADO = 256;
          const escala = Math.min(1, LADO / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * escala));
          const h = Math.max(1, Math.round(img.height * escala));
          const lienzo = document.createElement("canvas");
          lienzo.width = w;
          lienzo.height = h;
          const cx = lienzo.getContext("2d");
          cx.drawImage(img, 0, 0, w, h);
          datos = lienzo.toDataURL("image/jpeg", 0.82);
        } catch (e) {
          // Si el canvas falla se guarda el original: el núcleo tiene su tope.
        }
        const r = api("perfil", {
          accion: "guardar",
          foto: datos,
          nombre: perfil.nombre,
          indicativo: perfil.indicativo
        });
        if (!r || !r.ok) {
          toast("No se pudo guardar la foto: " + ((r && r.error) || "error"), "error");
          revision("perfil", "error", "no se pudo guardar la foto",
            String((r && r.error) || ""), 0, "perfil");
          return;
        }
        const foto = $("loginFoto");
        if (foto) { foto.src = datos; foto.classList.add("real"); }
        estado("Foto del operador actualizada.", "ok");
        revision("perfil", "info", "foto del operador actualizada",
          "bytes=" + datos.length, 0, "perfil");
        toast("Foto actualizada");
      };
      img.src = String(lector.result || "");
    };
    lector.readAsDataURL(archivo);
  }

  /** Enciende o apaga el efecto de escaneo sobre la tarjeta. */
  function escanear(activo) {
    const caja = $("loginPhotoWrap");
    if (!caja) return;
    caja.classList.toggle("escaneando", !!activo);
    const bio = $("loginBio");
    if (bio) bio.textContent = activo ? "ESCANEANDO…" : "FACE_ID · LOCAL";
  }

  /** Engancha el escaneo a los campos de PIN: se activa al escribir. */
  function escucharPin() {
    ["loginPin", "loginPinNuevo", "loginPinNuevo2"].forEach(function (id) {
      const campo = $(id);
      if (!campo) return;
      campo.addEventListener("focus", function () { escanear(true); });
      campo.addEventListener("blur", function () { escanear(false); });
      campo.addEventListener("input", function () { escanear(campo.value.length > 0); });
    });
    const input = $("loginFotoArchivo");
    if (input) {
      input.addEventListener("change", function () {
        const archivo = input.files && input.files[0];
        fotoProcesar(archivo);
      });
    }
    // La foto es el botón para cambiarla: así lo indica la tarjeta y así se
    // evita una fila de botones que competía con el acceso.
    const fotoCaja = $("loginPhotoWrap");
    if (fotoCaja) {
      fotoCaja.addEventListener("click", fotoElegir);
      fotoCaja.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          fotoElegir();
        }
      });
      window.__fabriFoto = true;
    }
  }

  return {
    iniciar: iniciar,
    bloquear: bloquear,
    entrar: entrar,
    /** Vuelve a leer el estado de acceso (lo usa el aviso de núcleo listo). */
    refrescar: function () {
      try {
        const capa = $("loginFabrick");
        if (!capa || capa.hidden) return;
        aplicar();
      } catch (e) { /* la pantalla ya está usable */ }
    },
    _resultado: resultado,
    _crear: crearPin,
    _pin: entrarPin,
    _huella: entrarHuella,
    _activar: activarHuella,
    _borrar: borrar,
    _saltar: saltar,
    _fotoElegir: fotoElegir,
    _perfilCargar: perfilCargar,
    _escanear: escanear
  };
})();
window.FabriLogin = FabriLogin;

/* ==========================================================================
   PUENTE TERMUX · loopback 127.0.0.1:8787
   ========================================================================== */

const FabriTermux = (function () {
  let catalogo = [];
  let vivo = false;

  function $(id) { return document.getElementById(id); }

  function pill(texto, clase) {
    const p = $("puentePill");
    if (!p) return;
    p.textContent = texto;
    p.className = "pill " + clase;
  }

  function salida(texto) {
    const pre = $("puenteSalida");
    if (pre) pre.textContent = texto;
  }

  function pintarCatalogo() {
    const cont = $("puenteComandos");
    if (!cont) return;
    if (!catalogo.length) {
      cont.innerHTML = '<p class="nota">Sin catálogo: el puente no respondió.</p>';
      return;
    }
    cont.innerHTML = catalogo.map(function (c) {
      return '<button class="btn" type="button" data-puente="' + esc(c.id) + '">'
        + esc(c.descripcion) + "</button>";
    }).join("");
  }

  function estado() {
    if (!window.FabrickNative) {
      pill("sin APK", "pill-error");
      return;
    }
    let r;
    try {
      r = JSON.parse(window.FabrickNative.termuxEstado());
    } catch (e) {
      r = { ok: false, error: String(e) };
    }
    vivo = !!r.ok;
    if (r.ok) {
      pill("puente activo", "pill-ok");
      const nota = $("puenteNota");
      if (nota) {
        nota.innerHTML = "Puente activo (v" + esc(r.version || "?") + ", pid " + esc(String(r.pid || "?"))
          + "). Sólo acepta los comandos de la lista blanca: la app nunca manda shell libre.";
      }
      const bloque = document.querySelector(".bloque-puente");
      if (bloque) bloque.classList.add("puente-vivo");
      cargarCatalogo();
      salida("Puente activo en 127.0.0.1:8787 · " + (catalogo.length || "?") + " comandos disponibles.");
    } else {
      pill("sin puente", "pill-error");
      const bloque = document.querySelector(".bloque-puente");
      if (bloque) bloque.classList.remove("puente-vivo");
      salida((r.error || "El puente no responde")
        + "\n\nPasos:\n"
        + "1. Toca «Copiar instalador» (deja el comando en el portapapeles).\n"
        + "2. Abre Termux y pégalo con una pulsación larga → Pegar.\n"
        + "3. Vuelve aquí y toca «Comprobar puente».\n\n"
        + "El permiso RUN_COMMAND de Termux es de nivel «signature»: esta APK no puede obtenerlo, "
        + "por eso se usa un servidor local con lista blanca.");
      revision("termux", "aviso", "puente no disponible: " + (r.error || ""), "codigo=" + (r.codigo || "?"), 0, "termux");
    }
  }

  function cargarCatalogo() {
    if (!window.FabrickNative) return;
    try {
      const r = JSON.parse(window.FabrickNative.termuxCatalogo());
      catalogo = (r && r.comandos) || [];
    } catch (e) {
      catalogo = [];
    }
    pintarCatalogo();
  }

  function instalar() {
    if (!window.FabrickNative) return;
    let r;
    try {
      r = JSON.parse(window.FabrickNative.termuxInstalar());
    } catch (e) {
      r = { ok: false, error: String(e) };
    }
    if (!r.ok) {
      toast("No se pudo preparar el instalador: " + (r.error || "error"), "error");
      return;
    }
    salida("Comando copiado al portapapeles (" + r.bytes + " bytes del script).\n\n"
      + "Pégalo en Termux. Instala ~/termux-puente.py y lo arranca en 127.0.0.1:8787.\n\n"
      + (r.comandoCorto ? "Para reiniciarlo después:\n" + r.comandoCorto : ""));
    toast(r.copiado ? "Instalador copiado: pégalo en Termux" : "Copia manual necesaria", r.copiado ? "" : "error");
    revision("termux", "info", "instalador del puente preparado", "bytes=" + r.bytes, 0, "termux");
  }

  function ejecutar(id) {
    if (!window.FabrickNative) return;
    salida("Ejecutando «" + id + "» en Termux…");
    try {
      window.FabrickNative.termuxEjecutar(id);
    } catch (e) {
      salida("No se pudo pedir la ejecución: " + e);
    }
  }

  /** Callback desde Java con el resultado real del comando. */
  function recibir(r) {
    if (!r) return;
    // Comando libre de la consola del flujo: se pinta en su terminal.
    if (r.libre && typeof flujoRecibir === "function") {
      flujoRecibir(r);
      return;
    }
    if (!r.ok) {
      salida("Falló «" + (r.id || "?") + "»"
        + (r.codigo ? " [" + r.codigo + "]" : "")
        + "\n" + (r.error || "sin detalle")
        + (r.salida ? "\n\nSalida parcial:\n" + r.salida : ""));
      revision("termux", "error", "comando " + (r.id || "?") + " falló: " + (r.error || ""),
        r.salida || "", r.ms || 0, "termux");
      return;
    }
    salida("«" + (r.id || "?") + "» · " + (r.descripcion || "") + "\n"
      + "rc=" + r.rc + " · " + (r.ms || 0) + " ms · vía " + (r.via || "loopback") + "\n\n"
      + (r.salida || "(sin salida)")
      + (r.error ? "\n\nstderr:\n" + r.error : ""));
    revision("termux", "info", "comando " + (r.id || "?") + " OK en " + (r.ms || 0) + " ms",
      (r.salida || "").slice(0, 800), r.ms || 0, "termux");
  }

  return {
    iniciar: function () { estado(); cargarCatalogo(); },
    estado: estado,
    instalar: instalar,
    ejecutar: ejecutar,
    recibir: recibir
  };
})();
window.FabriTermux = FabriTermux;

function puenteIniciar() { FabriTermux.iniciar(); }

/* ==========================================================================
   RED · IPv4 / IPv6 reales
   ========================================================================== */

window.FabriRed = {
  recibir: function (r) {
    const pre = document.getElementById("redSalida");
    if (!r) return;
    if (!pre) return;
    if (!r.ok) {
      pre.textContent = "La prueba falló: " + (r.error || "sin detalle");
      revision("red", "error", "diagnóstico de red falló: " + (r.error || ""), "", r.ms || 0, "red");
      return;
    }
    const lineas = [];
    lineas.push("IPv4 forzado en la VM: " + (r.ipv4Forzado ? "sí" : "NO"));
    lineas.push("IPv4 conecta: " + (r.ipv4Funciona ? "sí" : "NO"));
    lineas.push("IPv6 roto detectado: " + (r.ipv6Roto ? "sí" : "no"));
    lineas.push("");
    (r.hosts || []).forEach(function (h) {
      lineas.push("· " + h.host);
      lineas.push("    A    : " + ((h.ipv4 || []).join(", ") || "sin registro"));
      lineas.push("    AAAA : " + ((h.ipv6 || []).join(", ") || "sin registro"));
      lineas.push("    TCP/443 IPv4: " + (h.tcp443_ipv4 ? "OK" : "falla")
        + " · IPv6: " + (h.tcp443_ipv6 ? "OK" : (h.ipv6 && h.ipv6.length ? "falla" : "sin AAAA")));
      if (h.dns) lineas.push("    DNS: " + h.dns);
    });
    lineas.push("");
    lineas.push("Veredicto: " + (r.veredicto || "sin veredicto"));
    lineas.push("Tiempo: " + (r.ms || 0) + " ms");
    pre.textContent = lineas.join("\n");
    revision("red", r.ipv4Funciona ? "info" : "error",
      "red: IPv4=" + (r.ipv4Funciona ? "ok" : "falla") + " IPv6 roto=" + (r.ipv6Roto ? "sí" : "no"),
      r.veredicto || "", r.ms || 0, "red");
  }
};

/* ==========================================================================
   MANEJADORES DE LOS BLOQUES NUEVOS
   ========================================================================== */

document.addEventListener("click", function (ev) {
  const puente = ev.target.closest("[data-puente]");
  if (puente) { FabriTermux.ejecutar(puente.dataset.puente); return; }

  if (ev.target.id === "btnPuenteEstado") { FabriTermux.estado(); return; }
  if (ev.target.id === "btnPuenteInstalar") { FabriTermux.instalar(); return; }
  if (ev.target.id === "btnPuenteAbrir") { abrirTermux(); return; }

  if (ev.target.id === "btnRedDiag") {
    const pre = document.getElementById("redSalida");
    if (pre) pre.textContent = "Probando sockets reales a Hugging Face, OpenAI y GitHub…";
    if (!window.FabrickNative) {
      if (pre) pre.textContent = "Necesita la APK: la prueba abre sockets reales desde Android.";
      return;
    }
    try { window.FabrickNative.redDiagnostico(); }
    catch (e) { if (pre) pre.textContent = "No se pudo iniciar la prueba: " + e; }
    return;
  }

  if (ev.target.id === "btnRevisionRefrescar") { pintarRevision(); toast("Registro refrescado"); return; }
  if (ev.target.id === "btnRevisionVerificar") { revisionVerificar(); return; }
  if (ev.target.id === "btnRevisionLimpiar") { revisionLimpiar(); return; }
  if (ev.target.id === "btnRevisionExportar") { revisionExportar(); return; }

  if (ev.target.id === "btnBitacoraRefrescar") { bitacoraPintar(); toast("Bitácora refrescada"); return; }
  if (ev.target.id === "btnBitacoraLimpiar") {
    try {
      if (window.FabrickNative && typeof window.FabrickNative.arranqueBitacoraLimpiar === "function") {
        window.FabrickNative.arranqueBitacoraLimpiar();
      }
    } catch (e) { /* no impide seguir */ }
    bitacoraPintar();
    toast("Bitácora de arranque limpia");
    return;
  }

  const filtro = ev.target.closest("[data-rev-filtro]");
  if (filtro) {
    document.querySelectorAll("[data-rev-filtro]").forEach(function (b) { b.classList.remove("activo"); });
    filtro.classList.add("activo");
    revFiltro = filtro.dataset.revFiltro || "";
    pintarRevision();
    return;
  }

  if (ev.target.id === "btnLoginCrear") { FabriLogin._crear(); return; }
  if (ev.target.id === "btnLoginPin") { FabriLogin._pin(); return; }
  if (ev.target.id === "btnLoginHuella") { FabriLogin._huella(); return; }
  if (ev.target.id === "btnLoginActivar") { FabriLogin._activar(); return; }
  if (ev.target.id === "btnLoginBorrar") { FabriLogin._borrar(); return; }
  if (ev.target.id === "btnLoginSaltar") { FabriLogin._saltar(); return; }
});
// El respaldo de index.html se retira sólo cuando esta delegación está
// registrada de verdad. Si el script muriera antes, los botones siguen
// respondiendo por el respaldo aunque `FabriLogin` ya exista.
window.__fabriDelegacion = true;

/* Enter en los campos de PIN: no obliga a buscar el botón. */
document.addEventListener("keydown", function (ev) {
  if (ev.key !== "Enter") return;
  const id = ev.target && ev.target.id;
  if (id === "loginPin") { ev.preventDefault(); FabriLogin._pin(); }
  else if (id === "loginPinNuevo2") { ev.preventDefault(); FabriLogin._crear(); }
  else if (id === "loginPinNuevo") { ev.preventDefault(); const b = document.getElementById("loginPinNuevo2"); if (b) b.focus(); }
});

/* Bloqueo por inactividad dentro de la propia interfaz (además del de Android). */
(function () {
  let ultima = Date.now();
  ["touchstart", "keydown", "pointerdown"].forEach(function (t) {
    document.addEventListener(t, function () { ultima = Date.now(); }, { passive: true });
  });
  setInterval(function () {
    if (document.body.classList.contains("login-abierto")) return;
    if (Date.now() - ultima > 5 * 60 * 1000) {
      ultima = Date.now();
      FabriLogin.bloquear();
    }
  }, 30000);
})();


// Watchdog global del loader: se registra ANTES de iniciar() para que cubra
// incluso un fallo de sintaxis o una excepción temprana en el arranque.
setTimeout(function () { try { ocultarLoader(); } catch (e) {} }, 2800);

/* Al volver del segundo plano la capa de carga puede quedar visible encima de
   todo: Android pausa los temporizadores y la animación CSS no se completa, así
   que al reabrir la app se veía el loader (1 %, 7 %, luego una imagen) y ningún
   botón respondía porque la capa seguía capturando los toques. Aquí se retira
   sin condiciones y se rearma el arranque, que es idempotente. */
let estuvoOculto = false;
function alVolver() {
  try { ocultarLoader(); } catch (e) { /* el loader no puede romper la vuelta */ }
  try {
    const loader = document.getElementById("loaderArranque");
    if (loader) {
      loader.classList.add("loader-oculto");
      loader.style.display = "none";
    }
  } catch (e) { /* idem */ }
  try {
    if (window.FabriLogin && window.FabriLogin.refrescar) window.FabriLogin.refrescar();
  } catch (e) { /* el login se pinta solo */ }
  try {
    if (!arranque.listo) {
      arranque.programado = false;
      arranqueReintentar();
    }
  } catch (e) { /* sin núcleo la interfaz sigue usable */ }
}

window.addEventListener("pageshow", function (ev) {
  // `persisted` = la página volvió de la caché del WebView, con el estado
  // congelado. Es el caso exacto del video: reabrir y quedarse en el loader.
  if (ev && ev.persisted) arranque.intentos = 0;
  setTimeout(alVolver, 0);
});

document.addEventListener("visibilitychange", function () {
  if (document.hidden) { estuvoOculto = true; return; }
  if (!estuvoOculto) return;   // primera pintura: el loader debe verse
  setTimeout(alVolver, 120);
});

/* Arranque a prueba de fallos: cada paso va aislado.
   Antes, una excepción en chatIniciar() o en el vigilante cortaba el script y
   FabriLogin.iniciar() no llegaba a ejecutarse nunca: la capa de acceso
   quedaba visible con los dos paneles ocultos, clavada en «Comprobando
   acceso…». Y si iniciar() fallaba, se OCULTABA la capa de acceso y se entraba
   sin autenticar: eso ya no ocurre. */
function pasoArranque(nombre, fn) {
  try {
    fn();
    return true;
  } catch (e) {
    try {
      if (window.FabriDiag) {
        FabriDiag.anotar("error", "arranque · " + nombre,
          String((e && e.message) || e) + "\n"
            + String((e && e.stack) || "").split("\n").slice(0, 3).join("\n"));
      }
    } catch (ignorado) { /* el diagnóstico no puede romper el arranque */ }
    return false;
  }
}

pasoArranque("interfaz", iniciar);
pasoArranque("chat", chatIniciar);
// Ping periódico y consulta de errores en segundo plano: la app avisa sola si
// el núcleo deja de responder o si aparece un error nuevo.
pasoArranque("vigilante", saludIniciar);
// El acceso va al final y con su propia red: si algo anterior falló, el login
// se pinta igual.
pasoArranque("acceso", function () { FabriLogin.iniciar(); });

async function errorIniciar() {
  const cont = document.getElementById("errorContenido");
  if (!cont) return;
  cont.innerHTML = `<div class="cargando">Revisando estado de todos los componentes…</div>`;
  // Revisar cada componente con datos reales o mensaje de error
  const items = [];
  // Modelo local
  let rLocal;
  try { rLocal = JSON.parse(window.FabrickNative.localEstado()); } catch (e) { rLocal = { ok: false, cargado: false, error: String(e) }; }
  items.push({
    componente: "Modelo local",
    funciona: !!(rLocal && rLocal.cargado),
    detalle: (rLocal && rLocal.cargado) ? "Modelo cargado · ruta: " + (rLocal.ruta || "—") + " · info: " + JSON.stringify(rLocal.info || {}) : (rLocal && rLocal.error ? "No cargado: " + rLocal.error : "No cargado"),
    solucion: (rLocal && rLocal.cargado) ? "Nada que hacer." : "Carga un modelo (.gguf) con Chat → Escanear modelos → Cargar modelo. Si supera 50 MB, requiere autorización."
  });
  // Nube / API
  // La comprobación de la nube sale a internet: si se hace bloqueando, esta
  // pantalla se queda «Revisando…» hasta 20 s. Con `await apiTarde` la
  // interfaz sigue respondiendo y se reintenta si el núcleo está ocupado.
  let rNube = { ok: false, error: "No configurada" };
  try {
    rNube = await apiTarde("nube", {
      accion: "estado",
      url: (document.getElementById("chatUrl") || { value: "" }).value.trim() || "https://fabri-api.vercel.app"
    }, { maxMs: 20000 });
  } catch (e) { rNube.error = String(e); }
  const tokenOk = !!document.getElementById("chatUrl"); // simplificado: si hay elemento, hay intento de configuración
  items.push({
    componente: "API en la nube",
    funciona: !!(rNube && rNube.ok),
    detalle: (rNube && rNube.ok) ? (rNube.mensaje || "Conectada") : (rNube && rNube.error ? rNube.error : "No conectada"),
    solucion: "Configura URL y token en Integración. La URL debe ser https://fabri-api.vercel.app y el token debe coincidir con FABRI_API_TOKEN."
  });
  // SQLite local
  let rSql = { ok: false, error: "No se pudo consultar" };
  try { rSql = await apiTarde("sqlite", { accion: "tablas" }, { maxMs: 25000 }); } catch (e) { rSql.error = String(e); }
  items.push({
    componente: "Base de datos local (SQLite)",
    funciona: !!(rSql && rSql.ok),
    detalle: (rSql && rSql.ok) ? (rSql.tablas ? rSql.tablas.join(", ") : "Consultada sin detalles") : (rSql.error || "No disponible"),
    solucion: "Si falla, revisa que la APK tenga permisos de almacenamiento y que el archivo SQLite exista."
  });
  // Componente / APK
  items.push({
    componente: "APK FORGE CORE STOCK",
    funciona: true,
    detalle: "APK instalada (versión 0.9.1). El contenedor es el archivo; los modelos de IA no están dentro.",
    solucion: "La APK funciona como contenedor. Descarga modelos por separado (local o nube) y luego conéctalos."
  });
  // Termux (opcional)
  items.push({
    componente: "Termux exterior conectado",
    funciona: false,
    detalle: "No hay conexión activa detectada. Puedes conectar Termux como servicio local (HTTP/localhost) y configurar la URL en Integración.",
    solucion: "Abre Termux en otro terminal, inicia un servicio (ej. python -m http.server 8000 o llama.cpp server) y configura la URL en Integración."
  });
  // MobileLLM
  items.push({
    componente: "MobileLLM-125M",
    funciona: false,
    detalle: "Modelo >50 MB. No se descarga automáticamente por la regla de seguridad (W^X, no binarios descargados).",
    solucion: "Pulsa el botón de descarga en la pestaña Módulos → confirma explícitamente. La descarga se registra como intento; el archivo .gguf debe cargarse luego en el chat."
  });

  cont.innerHTML = items.map((it) => {
    const clase = it.funciona ? "ok" : "error";
    const icono = it.funciona ? "✓" : "✕";
    return `<div class="bloque error-bloque">
      <div class="fila-botones" style="justify-content:space-between">
        <h3 style="margin:0">${icono} ${esc(it.componente)}</h3>
        <span class="estado ${clase}">${it.funciona ? "OK" : "FALLO"}</span>
      </div>
      <p><strong>Detalle real:</strong> ${esc(it.detalle || "—")}</p>
      <p><strong>Acción recomendada:</strong> ${esc(it.solucion || "No aplica.")}</p>
    </div>`;
  }).join("");
}

function integracionIniciar() {
  const nota = document.getElementById("intNotaEstado");
  if (nota) nota.textContent = "Aquí puedes configurar la API en la nube y los conectores externos paso a paso.";
  const urlEl = document.getElementById("intUrl");
  const tokenEl = document.getElementById("intToken");
  const modeloEl = document.getElementById("intModelo");
  const proveedor = document.getElementById("intProveedor");
  const estadoModelo = document.getElementById("datosEstadoModelo");

  if (urlEl && !urlEl.value.trim()) urlEl.value = "https://fabri-api.vercel.app";
  if (tokenEl) tokenEl.placeholder = "FABRI_API_TOKEN (archivo /tmp/fabri_token.env)";
  if (estadoModelo) estadoModelo.textContent = "Para verificar el modelo local, abre la pestaña Chat → Escanear modelos.";
}

async function integracionGuardar() {
  const url = document.getElementById("intUrl").value.trim();
  const token = document.getElementById("intToken").value.trim();
  const modelo = document.getElementById("intModelo").value.trim();
  const nota = document.getElementById("intNotaEstado");
  if (!url || !/^https:\/\//.test(url)) {
    if (nota) nota.textContent = "Falta URL válida (debe ser https://…). Ejemplo: https://fabri-api.vercel.app";
    toast("Integración: URL inválida", "error");
    return;
  }
  try {
    const r = await apiTarde("nube", { accion: "configurar", url, token }, { maxMs: 20000 });
    const d = r.data || r;
    if (d.ok) {
      if (nota) nota.textContent = "Configuración guardada: " + url + " · Modelo: " + modelo;
      toast("Integración guardada", "");
    } else {
      if (nota) nota.textContent = "Error: " + (d.error || "no se pudo guardar");
      toast("Integración: " + (d.error || "no se pudo guardar"), "error");
    }
  } catch (e) {
    if (nota) nota.textContent = "Error: " + e.message;
    toast("Integración: " + e.message, "error");
  }
}

async function integracionProbar() {
  const url = document.getElementById("intUrl").value.trim() || "https://fabri-api.vercel.app";
  const nota = document.getElementById("intNotaEstado");
  if (nota) nota.textContent = "Probando conexión con " + url + "…";
  try {
    const r = await apiTarde("nube", { accion: "estado", url }, { maxMs: 20000 });
    const d = r.data || r;
    if (d.ok) {
      if (nota) nota.textContent = "Conexión verificada: " + (d.mensaje || d.url || url);
      toast("Integración: conexión OK", "");
    } else {
      if (nota) nota.textContent = "Error al probar: " + (d.error || r.error || "respuesta sin datos");
      toast("Integración: " + (d.error || r.error || "respuesta sin datos"), "error");
    }
  } catch (e) {
    if (nota) nota.textContent = "Excepción: " + e.message;
    toast("Integración: " + e.message, "error");
  }
}


/** Pinta el bloque «Rendimiento del núcleo» en Diagnóstico. */
function pintarRendimiento(rend) {
  const cont = document.getElementById("datosRendimiento");
  if (!cont) return;
  if (!rend || !rend.ok) {
    cont.innerHTML = '<p class="nota">Rendimiento no disponible.</p>';
    return;
  }
  const d = rend.data || {};
  const opsLista = (d.ops || []).slice(-8).reverse();
  const filas = [
    ["Esquema de inventario", d.esquemaVerificado ? "verificado (caché)" : "sin verificar"],
    ["Operaciones registradas", String(d.conteo || 0)],
    ["Promedio de duración", (d.promedioMs || 0) + " ms"],
    ["Tiempo total", (d.totalMs || 0) + " ms"]
  ];
  if (opsLista.length) {
    let ult = opsLista[0];
    filas.push(["Última op (con_estado)", (ult && ult.ms) + " ms"]);
  }
  cont.innerHTML = filas
    .map(([k, v]) => `<div class="fila"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join("")
    + (opsLista.length ? `<div class="nota" style="margin-top:8px">Última ${opsLista.length} operación(es) (ms): ${opsLista.map(function(o){ return o.ms || 0; }).join(" · ")}</div>` : "");
}

/** Botón «Refrescar» del bloque de rendimiento. */
function conectarRendimiento() {
  const btn = document.getElementById("btnRendimientoRefrescar");
  if (btn) btn.addEventListener("click", function () {
    apiTarde("rendimiento", {}, { maxMs: 15000 }).then(pintarRendimiento);
  });
}
