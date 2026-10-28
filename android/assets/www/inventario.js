/* ==========================================================================
   FABRI-CORE · Inventario
   --------------------------------------------------------------------------
   Flujo guiado en 5 pasos sobre la SQLite local (op `inventario` del núcleo):
     1 Escanear   → cámara / código manual → Open Food Facts / Beauty / Products
     2 Productos  → alta, edición, stock, borrado, sincronización
     3 Precios    → comparativa por proveedor, mejor precio y ahorro
     4 Márgenes   → calculadora, tabla con margen y exportación a Excel (CSV)
     5 Boleta     → carrito, totales con IVA, emisión e impresión

   Reglas:
   - Nada de recursos externos salvo las APIs libres de códigos de barras.
   - La cámara se apaga siempre al salir del paso 1 o de la vista.
   - Ningún fallo se silencia: todo queda en `revision` y se muestra en pantalla.
   ========================================================================== */

/* ── Efectos sonoros nativos vía Web Audio API (cero dependencias) ── */function sonidoBeep(freq, dur) {
  try {
    const f = freq || 880;
    const d = dur || 0.08;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(f, ctx.currentTime);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + d);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + d);
  } catch (e) {}
}

function sonidoImpresion() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const bufferSize = ctx.sampleRate * 0.45;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.35));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1100;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.14, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start();
  } catch (e) {}
}

const INV = {
  paso: 1,
  productos: [],
  resumen: null,
  sel: "",              // código del producto elegido en el paso 3
  carrito: [],
  boleta: null,         // última boleta emitida
  camara: null,         // MediaStream
  detector: null,       // BarcodeDetector (si el WebView lo trae)
  lienzo: null,         // canvas reutilizado por el lector propio
  timerScan: null,
  iniciado: false,
  modoApilador: false,
  apilador: [],
  ultimoEscaneo: 0,
  ultimoCodigo: "",
  importar: null,
  importarNativo: false,
  importarOrigen: "",
  sync: {
    timer: null,
    enCurso: false,
    fallos: 0,
    ultimoIntento: 0,
    esperaBaseMs: 60000,     // primer reintento: 1 min
    esperaMaxMs: 30 * 60000  // tope: 30 min
  },
  nube: {
    url: "https://fabri-api.vercel.app",
    token: ""
  }
};
// Copia accesible desde la consola del teléfono (diagnóstico) y las pruebas.
window.INV = INV;

const INV_CATEGORIAS = {
  abarrotes: "Alimentos",
  bebidas: "Bebidas",
  alcohol: "Alcohol",
  dulces: "Dulces",
  lacteos: "Lácteos",
  congelados: "Congelados",
  cosmetica: "Cosmética",
  limpieza: "Limpieza",
  mascotas: "Mascotas",
  otros: "Otros"
};

/* ── iconos ───────────────────────────────────────────────────────────────
   Iconos dibujados aquí mismo (24×24, trazo), no emoji ni fuentes externas.
   Se pintan con el color del texto (`currentColor`) para que sigan al botón y
   a los temas. Motivos libres estilo Lucide/Feather, reescritos a mano para
   que el módulo funcione sin red ni recursos fuera del APK. */
const INV_SVG = {
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="3" y1="12" x2="21" y2="12"/>',
  apilar: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  camara: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3.5"/>',
  buscar: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  nuevo: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  refrescar: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/>',
  nube: '<path d="M17.5 19a4.5 4.5 0 0 0 .5-8.97A6 6 0 0 0 6.2 9.2 4.5 4.5 0 0 0 6.5 19h11Z"/>',
  sync: '<path d="M12 3v3m0 12v3M3 12h3m12 0h3M6.3 6.3l2.1 2.1m7.2 7.2 2.1 2.1m0-11.4-2.1 2.1M8.4 15.6l-2.1 2.1"/>',
  importar: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 9 12 4 17 9"/><line x1="12" y1="4" x2="12" y2="16"/>',
  imprimir: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
  compartir: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.5" x2="15.4" y2="6.5"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/>',
  editar: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  etiqueta: '<path d="M20.6 13.4 12 22l-9-9V4a1 1 0 0 1 1-1h9l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.3"/>',
  mas: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
  menos: '<circle cx="12" cy="12" r="9"/><line x1="8" y1="12" x2="16" y2="12"/>',
  carrito: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h2.2l2.2 12.2a1.6 1.6 0 0 0 1.6 1.3h8.9a1.6 1.6 0 0 0 1.6-1.3L21 7H5"/>',
  borrar: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  ok: '<polyline points="20 6 9 17 4 12"/>',
  barras: '<path d="M4 5v14M7 5v14M10 5v9M13 5v14M16 5v9M19 5v14"/>',
  caja: '<path d="m12 2 9 4.5v11L12 22l-9-4.5v-11L12 2Z"/><path d="M3.3 6.7 12 11l8.7-4.3M12 11v11"/>',
  cerrar: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
  texto: '<path d="M4 6h10M4 11h16M4 16h12"/><path d="M18 15l3 3-3 3"/>',
  limpiar: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  verificar: '<path d="M22 11.5V12a10 10 0 1 1-5.9-9.1"/><polyline points="22 4 12 14.01 9 11.01"/>',
  alerta: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
  cable: '<path d="M4 9V5a1 1 0 0 1 1-1h3v5"/><path d="M9 3h6v6a4 4 0 0 1-4 4H9Z"/><path d="M12 13v4a3 3 0 0 0 3 3h1"/><rect x="18" y="18" width="3" height="4" rx="1"/>',
  guia: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/><line x1="9" y1="7" x2="15" y2="7"/><line x1="9" y1="11" x2="15" y2="11"/>'
};

/** Icono SVG en línea. `nombre` existe en INV_SVG; si no, devuelve "". */
function ico(nombre, tam) {
  const d = INV_SVG[nombre];
  if (!d) return "";
  const t = tam || 16;
  return '<svg class="inv-ico" viewBox="0 0 24 24" width="' + t + '" height="' + t +
    '" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' + d + "</svg>";
}

/** Pinta todos los huecos `<span data-ico="...">` del documento una sola vez. */
function invPintarIconos() {
  document.querySelectorAll("[data-ico]").forEach(function (el) {
    if (el.dataset.pintado) return;
    el.innerHTML = ico(el.dataset.ico, Number(el.dataset.icoTam || 16));
    el.dataset.pintado = "1";
  });
}

/* Etiquetas «free» que se leen de las bases libres (Open Food Facts). Se
   guardan en la ficha del producto para poder filtrar sin volver a consultar
   internet: sin gluten, sin azúcar, sin lactosa, vegano, etc. */
const INV_FREE = [
  { id: "sin-gluten", etiqueta: "Sin gluten", patron: /gluten-free|no-gluten|sin-gluten|sin-tacc/ },
  { id: "sin-azucar", etiqueta: "Sin azúcar", patron: /no-sugar|sugar-free|sin-azucar|zero-sugar/ },
  { id: "sin-lactosa", etiqueta: "Sin lactosa", patron: /lactose-free|no-lactose|sin-lactosa/ },
  { id: "sin-grasa", etiqueta: "Sin grasa", patron: /fat-free|no-fat|low-fat|sin-grasa/ },
  { id: "vegano", etiqueta: "Vegano", patron: /vegan|vegano/ },
  { id: "vegetariano", etiqueta: "Vegetariano", patron: /vegetarian|vegetariano/ },
  { id: "organico", etiqueta: "Orgánico", patron: /organic|organico|ecologico/ }
];

/** Devuelve los ids «free» que declara un producto de la API libre. */
function invFreeDesdeTags(tags) {
  const texto = (tags || []).join(" ").toLowerCase();
  return INV_FREE.filter(function (f) { return f.patron.test(texto); })
    .map(function (f) { return f.id; });
}

/** Etiqueta legible de un id «free». */
function invFreeEtiqueta(id) {
  for (let i = 0; i < INV_FREE.length; i++) {
    if (INV_FREE[i].id === id) return INV_FREE[i].etiqueta;
  }
  return id;
}

/** Lee la ficha guardada en la fila (JSON) sin romperse si viene vacía. */
function invFichaDe(p) {
  if (!p) return {};
  if (p.ficha && typeof p.ficha === "object") return p.ficha;
  try {
    const f = JSON.parse(p.ficha || "{}");
    return f && typeof f === "object" ? f : {};
  } catch (e) {
    return {};
  }
}

/* ── utilidades ─────────────────────────────────────────────────────────── */

function invClp(n) {
  const v = Number(n || 0);
  return "$" + v.toLocaleString("es-CL", { maximumFractionDigits: 0 });
}

function invNum(valor) {
  if (typeof valor === "number") return isFinite(valor) ? valor : 0;
  const limpio = String(valor == null ? "" : valor).replace(/[^\d,.-]/g, "").replace(",", ".");
  const n = Number(limpio);
  return isFinite(n) ? n : 0;
}

function invApi(accion, extra) {
  const payload = Object.assign({ accion: accion }, extra || {});
  const r = api("inventario", payload);
  // `LENTO` y `NUCLEO_OCUPADO` son estados del núcleo, no fallos del usuario:
  // registrarlos llenaba `revision` de ruido y tapaba el error real.
  if (!r.ok && r.codigo !== "LENTO" && r.codigo !== "NUCLEO_OCUPADO") {
    revision("inventario", "error", "inventario." + accion + " falló", String(r.error || ""), 0, "core");
  }
  return r;
}

/** Igual que invApi, pero reintenta en segundo plano si el núcleo está ocupado. */
function invApiTarde(accion, extra, opciones) {
  const payload = Object.assign({ accion: accion }, extra || {});
  return apiTarde("inventario", payload, opciones).then(function (r) {
    if (!r.ok && r.codigo !== "LENTO" && r.codigo !== "NUCLEO_OCUPADO") {
      revision("inventario", "error", "inventario." + accion + " falló", String(r.error || ""), 0, "core");
    }
    return r;
  });
}

function invAviso(texto, tipo) {
  const caja = document.getElementById("invGuardadoEstado");
  if (!caja) { toast(texto, tipo); return; }
  caja.textContent = texto;
  caja.className = "inv-guardado" + (tipo === "error" ? " error" : "");
  clearTimeout(INV.avisoTimer);
  INV.avisoTimer = setTimeout(function () {
    if (caja.textContent === texto) caja.textContent = "";
  }, 6000);
}

/* ── entrada de la vista ────────────────────────────────────────────────── */

function invIniciar() {
  INV.nube.url = localStorage.getItem("fabrick.nube.url") || "https://fabri-api.vercel.app";
  INV.nube.token = localStorage.getItem("fabrick.nube.token") || "";
  invPaso(INV.paso || 1);
  // Si el núcleo todavía migra, la guía se pinta y los datos llegan solos: no
  // se hacen llamadas que van a expirar ni se deja la pantalla en blanco.
  if (!nucleoPreparado()) {
    INV.esperas = (INV.esperas || 0) + 1;
    invAviso("El núcleo está iniciando: los datos aparecen en un momento.", "");
    if (INV.esperas < 25) setTimeout(function () { if (estadoApp.vista === "inventario") invIniciar(); }, 700);
    return;
  }
  INV.esperas = 0;
  invRefrescar();
  invSyncIniciar();
  if (!INV.iniciado) {
    INV.iniciado = true;
    invConectarEventos();
    invOcrIniciar();
    revision("inventario", "info", "módulo inventario abierto");
  }
}

/** Se llama al salir de la vista: apaga la cámara. */
function invSalir() {
  invCamaraParar();
}

function invConectarEventos() {
  const $ = function (id) { return document.getElementById(id); };

  document.querySelectorAll("[data-inv-paso]").forEach(function (b) {
    b.addEventListener("click", function () {
      invPaso(Number(b.dataset.invPaso));
    });
  });

  if ($("btnInvCamara")) $("btnInvCamara").addEventListener("click", invCamaraAbrir);
  if ($("btnInvCamaraParar")) $("btnInvCamaraParar").addEventListener("click", invCamaraParar);
  if ($("btnInvModoNormal")) $("btnInvModoNormal").addEventListener("click", function () { invModoApilador(false); });
  if ($("btnInvModoApilador")) $("btnInvModoApilador").addEventListener("click", function () { invModoApilador(true); });
  if ($("btnInvApiladorGuardarLote")) $("btnInvApiladorGuardarLote").addEventListener("click", invApiladorGuardarLote);
  if ($("btnInvApiladorLimpiar")) $("btnInvApiladorLimpiar").addEventListener("click", invApiladorLimpiar);
  if ($("btnInvBuscarCodigo")) $("btnInvBuscarCodigo").addEventListener("click", function () {
    invBuscarCodigo($("invCodigo").value);
  });
  if ($("invCodigo")) $("invCodigo").addEventListener("keydown", function (e) {
    if (e.key === "Enter") invBuscarCodigo($("invCodigo").value);
  });

  if ($("btnInvNuevo")) $("btnInvNuevo").addEventListener("click", function () { invFormulario(null); });
  if ($("btnInvRefrescar")) $("btnInvRefrescar").addEventListener("click", invRefrescar);
  if ($("btnInvGuardar")) $("btnInvGuardar").addEventListener("click", invGuardar);
  if ($("btnInvCancelar")) $("btnInvCancelar").addEventListener("click", invFormularioCerrar);
  if ($("btnInvSincronizar")) $("btnInvSincronizar").addEventListener("click", invSincronizar);
  if ($("btnInvNubeResumen")) $("btnInvNubeResumen").addEventListener("click", invNubeResumenPintar);

  ["invBuscar", "invFiltroCategoria", "invFiltroFree", "invSoloBajo"].forEach(function (id) {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", invPintarProductos);
    el.addEventListener("change", invPintarProductos);
  });

  if ($("invPrecioProducto")) $("invPrecioProducto").addEventListener("change", function () {
    INV.sel = $("invPrecioProducto").value;
    invPintarPrecios();
  });
  if ($("btnInvPrecioAgregar")) $("btnInvPrecioAgregar").addEventListener("click", invPrecioAgregar);

  ["invMcosto", "invMprecio", "invMobjetivo", "invMiva"].forEach(function (id) {
    const el = $(id);
    if (el) el.addEventListener("input", invCalcularMargen);
  });
  if ($("btnInvExportar")) $("btnInvExportar").addEventListener("click", invExportar);
  if ($("btnInvPreguntarIA")) $("btnInvPreguntarIA").addEventListener("click", invPreguntarIA);

  if ($("btnInvBoletaAgregar")) $("btnInvBoletaAgregar").addEventListener("click", invCarritoAgregar);
  if ($("btnInvEmitir")) $("btnInvEmitir").addEventListener("click", invEmitirBoleta);
  if ($("btnInvImprimir")) $("btnInvImprimir").addEventListener("click", invImprimir);

  // Importación masiva (otra base: Eleventa, Excel, CSV/TSV/JSON).
  if ($("btnInvImportar")) $("btnInvImportar").addEventListener("click", invImportarPanel);
  if ($("btnInvImportarCerrar")) $("btnInvImportarCerrar").addEventListener("click", invImportarCerrar);
  if ($("btnInvImportarEjecutar")) $("btnInvImportarEjecutar").addEventListener("click", invImportarEjecutar);
  if ($("invImportarArchivo")) $("invImportarArchivo").addEventListener("change", invImportarArchivo);
  if ($("invImportarTexto")) $("invImportarTexto").addEventListener("input", invImportarPrevia);

  // OCR (sólo aparece si el proceso tiene motor).
  if ($("btnInvOcr")) $("btnInvOcr").addEventListener("click", function () { invOcrPanel(true); });
  if ($("btnInvOcrCerrar")) $("btnInvOcrCerrar").addEventListener("click", function () { invOcrPanel(false); });
  if ($("invOcrImagen")) $("invOcrImagen").addEventListener("change", invOcrImagen);
  if ($("btnInvOcrNombre")) $("btnInvOcrNombre").addEventListener("click", invOcrUsarNombre);
  if ($("btnInvOcrCopiar")) $("btnInvOcrCopiar").addEventListener("click", function () {
    const t = (document.getElementById("invOcrTexto") || {}).value || "";
    if (t) copiar(t, "Texto copiado");
  });

  invPintarIconos();
  invEquiposIniciar();
}

/** Tarjetas de equipos: abren un panel a la vez y cierran al tocar de nuevo. */
/** Cierra todos los paneles de equipos menos el indicado (null = todos). */
function invCerrarPanelesEquipo(excepto) {
  document.querySelectorAll(".inv-equipo-panel").forEach(function (p) {
    if (p.id !== excepto) p.hidden = true;
  });
  const panelBase = document.getElementById("invImportarPanel");
  if (panelBase && excepto !== "invImportarPanel") panelBase.hidden = true;
  document.querySelectorAll("[data-equipo]").forEach(function (x) {
    const tipo = x.dataset.equipo;
    let id = "invImportarPanel";
    if (tipo !== "base") id = "invEquipoPanel" + tipo.charAt(0).toUpperCase() + tipo.slice(1);
    x.setAttribute("aria-expanded", id === excepto ? "true" : "false");
  });
}

function invEquiposIniciar() {
  const tarjetas = document.querySelectorAll("[data-equipo]");
  tarjetas.forEach(function (b) {
    b.addEventListener("click", function () {
      const tipo = b.dataset.equipo;
      if (tipo === "base") {
        const panelBase = document.getElementById("invImportarPanel");
        const abierto = panelBase && !panelBase.hidden;
        invCerrarPanelesEquipo(abierto ? null : "invImportarPanel");
        if (abierto) return;
        invImportarPanel();
        return;
      }
      const id = "invEquipoPanel" + tipo.charAt(0).toUpperCase() + tipo.slice(1);
      const panel = document.getElementById(id);
      const abierto = panel && !panel.hidden;
      invCerrarPanelesEquipo(abierto ? null : id);
      if (panel && !abierto) {
        panel.hidden = false;
        b.setAttribute("aria-expanded", "true");
        if (panel.scrollIntoView) {
          setTimeout(function () { panel.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, 60);
        }
      }
    });
  });
  document.querySelectorAll("[data-equipo-cerrar]").forEach(function (b) {
    b.addEventListener("click", function () {
      invCerrarPanelesEquipo(null);
    });
  });
}

function invPaso(n) {
  INV.paso = n;
  if (n !== 1) invCamaraParar();
  document.querySelectorAll(".inv-panel").forEach(function (p) {
    p.classList.toggle("activo", p.id === "invPaso" + n);
  });
  document.querySelectorAll("[data-inv-paso]").forEach(function (b) {
    const paso = Number(b.dataset.invPaso);
    b.classList.toggle("activo", paso === n);
    b.classList.toggle("hecho", paso < n);
  });
  if (n === 3) invPintarPrecios();
  if (n === 4) { invCalcularMargen(); invPintarMargenes(); }
  if (n === 5) { invPintarCarrito(); invBoletasHistorial(); }
  window.scrollTo({ top: 0, behavior: "instant" });
}

/* ── carga y resumen ────────────────────────────────────────────────────── */

/**
 * Lee productos y resumen. Antes eran dos llamadas BLOQUEANTES seguidas (hasta
 * 1,8 s con el hilo de la interfaz parado) y se repetían en cada refresco.
 * Ahora van encadenadas en segundo plano y sin solaparse.
 */
function invRefrescar() {
  if (INV.cargando) return;
  INV.cargando = true;
  invApiTarde("listar", { limite: 500 }).then(function (r) {
    INV.cargando = false;
    if (r.ok) {
      INV.productos = (r.data && r.data.productos) || [];
      invPintarProductos();
      invPintarSelectores();
      invPintarMargenes();
      invPoblarDatalist();
    } else if (!INV.productos.length) {
      invAviso("No pude leer el inventario: " + (r.error || "error"), "error");
    }
    return invApiTarde("resumen").then(function (rr) {
      if (rr.ok) { INV.resumen = rr.data; invPintarResumen(rr.data); }
    });
  });
}

/** Rellena el autocompletado de códigos con los productos ya guardados.
 *  Así, al escribir un par de dígitos, aparecen los códigos conocidos y se
 *  evita dar de alta dos veces el mismo producto. Los códigos quedan
 *  «clasificados»: cada opción muestra el nombre y la categoría. */
function invPoblarDatalist() {
  const dl = document.getElementById("invCodigos");
  if (!dl) return;
  const vistos = {};
  dl.innerHTML = (INV.productos || []).map(function (p) {
    if (!p.codigo || vistos[p.codigo]) return "";
    vistos[p.codigo] = 1;
    const cat = INV_CATEGORIAS[p.categoria] || p.categoria || "";
    const etiqueta = p.codigo + " — " + (p.nombre || "") + (cat ? " · " + cat : "");
    return `<option value="${esc(p.codigo)}" label="${esc(etiqueta)}"></option>`;
  }).join("");
}

function invPintarResumen(datos) {
  const caja = document.getElementById("invKpis");
  const d = datos || INV.resumen;
  if (!d) {
    if (caja) caja.innerHTML = `<div class="inv-kpi"><span>Estado</span><strong>cargando…</strong></div>`;
    return;
  }
  if (!caja) return;
  caja.innerHTML = [
    `<div class="inv-kpi"><span>Productos</span><strong>${d.total || 0}</strong></div>`,
    `<div class="inv-kpi ok"><span>Valor venta</span><strong>${invClp(d.valor_venta)}</strong></div>`,
    `<div class="inv-kpi"><span>Utilidad</span><strong>${invClp(d.utilidad_potencial)}</strong></div>`,
    `<div class="inv-kpi ${d.stock_bajo > 0 ? "alerta" : ""}"><span>Stock bajo</span><strong>${d.stock_bajo || 0}</strong></div>`,
    `<div class="inv-kpi ${d.pendientes_sync > 0 ? "alerta" : "ok"}"><span>Sin sincronizar</span><strong>${d.pendientes_sync || 0}</strong></div>`
  ].join("");
}

/* ── paso 1 · escanear ──────────────────────────────────────────────────── */

async function invCamaraAbrir() {
  const caja = document.getElementById("invCamaraCaja");
  const video = document.getElementById("invVideo");
  const nota = document.getElementById("invCamaraNota");
  const btnParar = document.getElementById("btnInvCamaraParar");
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("este WebView no expone la cámara");
    }
    INV.camara = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
      audio: false
    });
    video.srcObject = INV.camara;
    await video.play();
    caja.classList.add("activa");
    caja.classList.add("mira");
    if (btnParar) btnParar.hidden = false;
    invMallaIniciar();

    if (typeof window.BarcodeDetector === "function") {
      INV.detector = new window.BarcodeDetector({
        formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"]
      });
      if (nota) nota.textContent = "Buscando código…";
    } else {
      // El WebView de Android no trae BarcodeDetector. En vez de rendirse y
      // pedir el código a mano, se usa el lector propio (EAN-13/EAN-8/UPC-A)
      // sobre los fotogramas de la propia cámara: sin internet ni binarios.
      INV.detector = null;
      if (nota) nota.textContent = "Lector EAN activo · apunta al código";
      revision("inventario", "info", "lector EAN propio activo (sin BarcodeDetector)");
    }
    invBucleEscaneo();
    revision("inventario", "info", "cámara del inventario abierta");
  } catch (e) {
    invCamaraParar();
    const msg = e && e.message ? e.message : String(e);
    revision("inventario", "error", "no se pudo abrir la cámara", msg, 0, "camara");
    toast("Cámara: " + msg, "error");
    if (nota) nota.textContent = "Sin acceso a la cámara. Usa el código manual.";
  }
}

function invCamaraParar() {
  if (INV.timerScan) { clearTimeout(INV.timerScan); INV.timerScan = null; }
  invMallaParar();
  if (INV.camara) {
    INV.camara.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
    INV.camara = null;
  }
  const video = document.getElementById("invVideo");
  if (video) video.srcObject = null;
  const caja = document.getElementById("invCamaraCaja");
  if (caja) caja.classList.remove("activa", "mira", "leyo");
  const btnParar = document.getElementById("btnInvCamaraParar");
  if (btnParar) btnParar.hidden = true;
  INV.detector = null;
}

/* ── malla de escaneo (canvas) ──────────────────────────────────────────────
   Encima del vídeo se dibuja una malla con un barrido vertical, esquinas de
   encuadre y un destello al leer. Es solo presentación: el barrido muestra
   dónde está mirando el lector y el destello confirma la lectura. Se dibuja en
   `requestAnimationFrame` mientras la cámara está activa y se apaga al cerrar.
   Con «reducir movimiento» activo se pinta un fotograma fijo. */

function invMallaAjustar() {
  const cv = document.getElementById("invMalla");
  const caja = document.getElementById("invCamaraCaja");
  if (!cv || !caja) return;
  const r = caja.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round((r.width || 320) * dpr));
  const h = Math.max(1, Math.round((r.height || 240) * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
}

function invMallaIniciar() {
  const cv = document.getElementById("invMalla");
  if (!cv) return;
  INV.mallaActiva = true;
  INV.mallaT0 = Date.now();
  invMallaAjustar();
  const reducir = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducir) {
    invMallaDibujar(cv, 0);
    return;
  }
  if (!INV.mallaResize) {
    INV.mallaResize = function () { invMallaAjustar(); };
    window.addEventListener("resize", INV.mallaResize);
  }
  const paso = function () {
    if (!INV.mallaActiva) return;
    invMallaDibujar(cv, (Date.now() - INV.mallaT0) / 1000);
    INV.mallaRaf = requestAnimationFrame(paso);
  };
  INV.mallaRaf = requestAnimationFrame(paso);
}

function invMallaParar() {
  INV.mallaActiva = false;
  if (INV.mallaRaf) { cancelAnimationFrame(INV.mallaRaf); INV.mallaRaf = null; }
  const cv = document.getElementById("invMalla");
  if (cv) {
    const ctx = cv.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, cv.width, cv.height);
  }
}

/** Pinta un fotograma de la malla. `t` en segundos (0 = fotograma fijo). */
function invMallaDibujar(cv, t) {
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const w = cv.width, h = cv.height;
  const lima = "200,255,0";
  ctx.clearRect(0, 0, w, h);

  // 1) Malla: grilla sutil que da la sensación de «barrido por malla».
  const paso = Math.max(34, Math.round(w / 14));
  ctx.lineWidth = Math.max(1, Math.round(w / 900));
  ctx.strokeStyle = "rgba(" + lima + ",0.10)";
  ctx.beginPath();
  for (let x = paso; x < w; x += paso) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let y = paso; y < h; y += paso) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();

  // 2) Barrido vertical (ida y vuelta) con degradado.
  const yB = t <= 0 ? h * 0.5 : ((Math.sin(t * 1.6) + 1) / 2) * h;
  const banda = h * 0.5;
  const grad = ctx.createLinearGradient(0, yB - banda / 2, 0, yB + banda / 2);
  grad.addColorStop(0, "rgba(" + lima + ",0)");
  grad.addColorStop(0.5, "rgba(" + lima + ",0.22)");
  grad.addColorStop(1, "rgba(" + lima + ",0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, yB - banda / 2, w, banda);
  ctx.strokeStyle = "rgba(" + lima + ",0.7)";
  ctx.lineWidth = Math.max(1.5, w / 320);
  ctx.beginPath();
  ctx.moveTo(0, yB); ctx.lineTo(w, yB);
  ctx.stroke();

  // 3) Esquinas de encuadre.
  const m = Math.round(w * 0.09), l = Math.round(w * 0.055);
  ctx.strokeStyle = "rgba(" + lima + ",0.9)";
  ctx.lineWidth = Math.max(2, w / 220);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(m, m + l); ctx.lineTo(m, m); ctx.lineTo(m + l, m);
  ctx.moveTo(w - m - l, m); ctx.lineTo(w - m, m); ctx.lineTo(w - m, m + l);
  ctx.moveTo(m, h - m - l); ctx.lineTo(m, h - m); ctx.lineTo(m + l, h - m);
  ctx.moveTo(w - m - l, h - m); ctx.lineTo(w - m, h - m); ctx.lineTo(w - m, h - m - l);
  ctx.stroke();

  // 4) Destello al leer un código.
  if (INV.mallaFlash) {
    const e = Date.now() - INV.mallaFlash;
    if (e < 450) {
      const a = (1 - e / 450) * 0.3;
      ctx.fillStyle = "rgba(" + lima + "," + a + ")";
      ctx.fillRect(0, 0, w, h);
    }
  }
}

function invBucleEscaneo() {
  const video = document.getElementById("invVideo");
  if (!video || !INV.camara) return;
  INV.timerScan = setTimeout(async function () {
    try {
      let valor = "";
      if (INV.detector) {
        const codigos = await INV.detector.detect(video);
        if (codigos && codigos.length) valor = codigos[0].rawValue || "";
      } else {
        valor = invEscanearCuadro();
      }
      if (valor) {
        // Modo Apilador: no se cierra la cámara; se apila el código y se sigue.
        // El freno evita que el mismo código entre dos veces seguidas mientras
        // el producto todavía está delante del lente.
        if (INV.modoApilador) {
          const ahora = Date.now();
          if (valor === INV.ultimoCodigo && ahora - INV.ultimoEscaneo < 1600) {
            if (INV.camara) invBucleEscaneo();
            return;
          }
          INV.ultimoCodigo = valor;
          INV.ultimoEscaneo = ahora;
          INV.mallaFlash = Date.now();
          invApiladorAgregar(valor);
          if (INV.camara) invBucleEscaneo();
          return;
        }
        // Modo individual: confirma, cierra la cámara y muestra la ficha.
        INV.mallaFlash = Date.now();
        const caja = document.getElementById("invCamaraCaja");
        if (caja) caja.classList.remove("mira");
        if (caja) caja.classList.add("leyo");
        setTimeout(function () { invCamaraParar(); }, 220);
        const campo = document.getElementById("invCodigo");
        if (campo) campo.value = valor;
        toast("Código leído: " + valor);
        invBuscarCodigo(valor);
        return;
      }
    } catch (e) {
      // Un fallo de un frame no debe cortar el escaneo.
    }
    if (INV.camara) invBucleEscaneo();
  }, INV.detector ? 420 : 550);
}

/* ── apilador continuo ──────────────────────────────────────────────────────
   Modo de trabajo para cargar una compra entera sin tocar la pantalla: cada
   código que entra se apila con su nombre, su precio y una miniatura. Los
   repetidos suman cantidad en vez de duplicarse. Al terminar, el lote completo
   entra a la base de una sola escritura (acción `importar`). El nombre se
   resuelve en segundo plano: base local → tu nube → bases libres. */

function invModoApilador(activar) {
  INV.modoApilador = !!activar;
  const caja = document.getElementById("invApiladorCaja");
  if (caja) caja.hidden = !INV.modoApilador;
  const bNormal = document.getElementById("btnInvModoNormal");
  const bApila = document.getElementById("btnInvModoApilador");
  if (bNormal) bNormal.classList.toggle("btn-primario", !INV.modoApilador);
  if (bApila) bApila.classList.toggle("btn-primario", INV.modoApilador);
  const help = document.getElementById("invCamaraNota");
  if (INV.modoApilador) {
    if (help) help.textContent = "Apilador activo · apunta a cada producto sin parar";
    invApiladorPintar();
    if (!INV.camara) invCamaraAbrir();
  }
}

/** Tono de confirmación del apilador. */
const NVAP = { freq: 1046 };

/** Sonido + vibración de confirmación. Nunca rompe si el WebView no vibra. */
function invApiladorAviso() {
  try { sonidoBeep(NVAP.freq, 0.06); } catch (e) {}
  try { if (navigator.vibrate) navigator.vibrate(35); } catch (e) {}
}

/** Añade un código al apilador (dedupe por código; sube la cantidad). */
function invApiladorAgregar(codigoCrudo) {
  const codigo = String(codigoCrudo || "").replace(/\s/g, "");
  if (!codigo) return;
  const existente = INV.apilador.find(function (x) { return x.codigo === codigo; });
  if (existente) {
    existente.cantidad = (existente.cantidad || 1) + 1;
    existente.nuevo = false;
    invApiladorPintar();
    invApiladorAviso();
    return;
  }
  const local = invPorCodigo(codigo);
  const item = {
    codigo: codigo,
    nombre: local ? local.nombre : "",
    marca: local ? local.marca : "",
    precio: local ? Number(local.precio || 0) : 0,
    categoria: local ? local.categoria : "",
    ficha: local ? invFichaDe(local) : {},
    cantidad: 1,
    origen: local ? "local" : "",
    resuelto: !!local
  };
  INV.apilador.unshift(item);
  invApiladorPintar(true);
  invApiladorAviso();
  if (!local) invApiladorResolver(item);
}

/** Resuelve nombre/precio de un código apilado: local → nube → bases libres. */
async function invApiladorResolver(item) {
  try {
    const local = await invApiTarde("buscar_codigo", { codigo: item.codigo }, { maxMs: 6000 });
    if (local.ok && local.data && local.data.encontrado) {
      invApiladorCompletar(item, local.data.producto, "local");
      return;
    }
  } catch (e) {}
  try {
    const nube = await invNubeBuscarCodigo(item.codigo);
    if (nube.ok && nube.producto) {
      invApiladorCompletar(item, nube.producto, "nube");
      return;
    }
  } catch (e) {}
  try {
    const api = await invConsultarApiLibre(item.codigo);
    if (api.ok && api.producto) {
      invApiladorCompletar(item, api.producto, api.producto.fuente || "libre");
    }
  } catch (e) {}
}

/** Copia los datos resueltos a un item del apilador y repinta su fila. */
function invApiladorCompletar(item, p, origen) {
  if (!p) return;
  item.nombre = p.nombre || item.nombre;
  item.marca = p.marca || item.marca || "";
  item.precio = Number(p.precio || item.precio || 0);
  item.categoria = p.categoria || item.categoria || "";
  if (p.ficha) item.ficha = p.ficha;
  item.origen = origen;
  item.resuelto = true;
  invApiladorPintar();
}

/** Miniatura del producto para el apilador y el catálogo. */
function invMiniaturaHtml(p, tam) {
  const f = invFichaDe(p);
  if (f.imagen) {
    return `<img class="inv-mini" src="${esc(f.imagen)}" alt="" loading="lazy" ` +
      `style="width:${tam}px;height:${tam}px" onerror="this.style.display='none'" />`;
  }
  const cat = (p && p.categoria) || "otros";
  return `<span class="inv-mini inv-mini-icono cat-${esc(cat)}" style="width:${tam}px;height:${tam}px">` +
    ico("caja", Math.round(tam * 0.52)) + "</span>";
}

function invApiladorPintar(pop) {
  const caja = document.getElementById("invApiladorLista");
  const contador = document.getElementById("invApiladorContador");
  if (contador) contador.textContent = INV.apilador.length;
  if (!caja) return;
  if (!INV.apilador.length) {
    caja.innerHTML = `<div class="inv-vacio">Apunta la cámara a un código: se apila aquí solo.</div>`;
    return;
  }
  caja.innerHTML = INV.apilador.map(function (x, i) {
    const nombre = x.nombre || "Producto nuevo";
    const sinNombre = x.nombre ? "" : " inv-apilador-sinnombre";
    return `<div class="inv-apilador-card${pop && i === 0 ? " entra" : ""}">
      ${invMiniaturaHtml(x, 38)}
      <div class="inv-apilador-card-info">
        <strong class="${sinNombre.trim()}">${esc(nombre)}${x.cantidad > 1 ? " × " + x.cantidad : ""}</strong>
        <span>${esc(x.codigo)}${x.origen ? " · " + esc(x.origen) : ""}</span>
      </div>
      <div class="inv-apilador-card-precio">${x.precio > 0 ? invClp(x.precio) : "—"}</div>
      <button class="btn btn-mini" data-inv-apilador-quitar="${i}" title="Quitar" aria-label="Quitar">${ico("cerrar", 14)}</button>
    </div>`;
  }).join("");
  caja.querySelectorAll("[data-inv-apilador-quitar]").forEach(function (b) {
    b.addEventListener("click", function () { invApiladorQuitar(Number(b.dataset.invApiladorQuitar)); });
  });
}

function invApiladorQuitar(i) {
  INV.apilador.splice(i, 1);
  invApiladorPintar();
}

function invApiladorLimpiar() {
  INV.apilador = [];
  INV.ultimoCodigo = "";
  invApiladorPintar();
  invAviso("Apilador vaciado");
}

/** Guarda el lote completo en la base con UNA sola escritura. */
function invApiladorGuardarLote() {
  if (!INV.apilador.length) { toast("El apilador está vacío", "error"); return; }
  const productos = INV.apilador.map(function (x) {
    return {
      codigo: x.codigo,
      nombre: x.nombre || ("Producto " + x.codigo),
      marca: x.marca || "",
      categoria: x.categoria || "abarrotes",
      unidad: "unidad",
      precio: Number(x.precio || 0),
      stock: Number(x.cantidad || 1),
      stock_minimo: 0,
      iva: 19,
      origen: "apilador",
      ficha: x.ficha || {}
    };
  });
  const btn = document.getElementById("btnInvApiladorGuardarLote");
  if (btn) { btn.disabled = true; }
  invAviso("Guardando " + productos.length + " producto(s)...");
  invApiTarde("importar", { productos: productos, origen: "apilador" }, { maxMs: 30000 })
    .then(function (r) {
      if (btn) btn.disabled = false;
      if (!r.ok) { invAviso("No se pudo guardar el lote: " + (r.error || "error"), "error"); return; }
      const d = r.data || {};
      revision("inventario", "info", "lote del apilador guardado",
        (d.nuevos || 0) + " nuevos · " + (d.actualizados || 0) + " actualizados");
      invAviso("Lote guardado · " + (d.nuevos || 0) + " nuevos · " + (d.actualizados || 0) + " actualizados");
      invSello("Lote en la base");
      INV.apilador = [];
      INV.ultimoCodigo = "";
      invApiladorPintar();
      invRefrescar();
    });
}


/* ── tu nube (fabri-api → InsForge) ────────────────────────────────────────
   La segunda base del inventario. Se consulta con el MISMO contrato que usa la
   sincronización (`/api/inventario` + `Authorization: Bearer <token>`), pero
   con la acción `buscar`. Sin URL o sin token se devuelve «sin nube» y el
   escáner sigue con las bases libres: nunca se inventa un resultado. */

/** URL final del endpoint de inventario, tolerando que ya venga con /api/inventario. */
function invNubeDestino() {
  const base = String(INV.nube.url || "").replace(/\/+$/, "");
  if (!base) return "";
  return /\/api\/inventario$/.test(base) ? base : base + "/api/inventario";
}

/** Una petición a la nube, con tope de tiempo y sin lanzar nunca. */
async function invNubePedir(cuerpo, maxMs) {
  const destino = invNubeDestino();
  if (!destino) return { ok: false, error: "sin nube configurada", codigo: "SIN_NUBE" };
  const ctrl = new AbortController();
  const t = setTimeout(function () { ctrl.abort(); }, maxMs || 8000);
  try {
    const resp = await fetch(destino, {
      method: "POST",
      headers: Object.assign(
        { "Content-Type": "application/json" },
        INV.nube.token ? { "Authorization": "Bearer " + INV.nube.token } : {}
      ),
      body: JSON.stringify(cuerpo),
      signal: ctrl.signal
    });
    if (resp.status === 401) return { ok: false, error: "token de la nube rechazado", codigo: "SIN_TOKEN" };
    if (!resp.ok) return { ok: false, error: "HTTP " + resp.status, codigo: "NUBE" };
    const datos = await resp.json().catch(function () { return {}; });
    if (datos && datos.ok === false) {
      return { ok: false, error: datos.error || "la nube rechazó la consulta", codigo: datos.codigo || "NUBE" };
    }
    return { ok: true, data: datos };
  } catch (e) {
    const msg = (e && e.name === "AbortError")
      ? "la nube tardó demasiado"
      : (e && e.message ? e.message : String(e));
    return { ok: false, error: msg, codigo: "NUBE" };
  } finally {
    clearTimeout(t);
  }
}

/** Busca UN código en la nube. Devuelve {ok, producto} o {ok:false, motivo}. */
async function invNubeBuscarCodigo(codigo) {
  if (!INV.nube.url) return { ok: false, motivo: "sin nube" };
  if (!INV.nube.token) return { ok: false, motivo: "sin token" };
  const r = await invNubePedir({ accion: "buscar", codigo: codigo }, 7000);
  if (r.ok && r.data && r.data.encontrado && r.data.producto) {
    return { ok: true, producto: r.data.producto };
  }
  return { ok: false, motivo: r.error || "no está en tu nube" };
}

/** Busca por texto en la nube (para el autocompletado de códigos). */
async function invNubeBuscarTexto(q, limite) {
  if (!INV.nube.url || !INV.nube.token) return { ok: false, productos: [] };
  const r = await invNubePedir({ accion: "buscar", q: q, limite: limite || 20 }, 7000);
  if (r.ok && r.data && Array.isArray(r.data.productos)) {
    return { ok: true, productos: r.data.productos };
  }
  return { ok: false, productos: [] };
}

/** Resumen de la nube (totales y stock bajo, calculados en InsForge). */
async function invNubeResumen() {
  const r = await invNubePedir({ accion: "resumen" }, 12000);
  if (r.ok && r.data) return { ok: true, resumen: r.data.resumen, categorias: r.data.categorias };
  return { ok: false, error: r.error || "sin respuesta" };
}

/** Pinta el resumen de la nube dentro del paso 2. */
async function invNubeResumenPintar() {
  const caja = document.getElementById("invNubeResumen");
  if (!caja) return;
  if (!INV.nube.url) {
    caja.innerHTML = `<p class="inv-ayuda">Sin nube configurada: ve a Integración y define la URL y el token.</p>`;
    return;
  }
  caja.innerHTML = `<p class="inv-ayuda">Consultando tu nube…</p>`;
  const r = await invNubeResumen();
  if (!r.ok) {
    caja.innerHTML = `<p class="inv-ayuda">Nube: ${esc(r.error)}. Si no configuraste el token, ve a Integración.</p>`;
    return;
  }
  const d = r.resumen || {};
  const cats = (r.categorias || []).slice(0, 6).map(function (c) {
    return `<span class="inv-chip">${esc(INV_CATEGORIAS[c.categoria] || c.categoria)} ${c.n}</span>`;
  }).join("");
  caja.innerHTML = `
    <div class="inv-kpis">
      <div class="inv-kpi"><span>En tu nube</span><strong>${d.total || 0}</strong></div>
      <div class="inv-kpi ok"><span>Valor venta</span><strong>${invClp(d.valor_venta)}</strong></div>
      <div class="inv-kpi"><span>Utilidad</span><strong>${invClp(d.utilidad)}</strong></div>
      <div class="inv-kpi ${d.stock_bajo > 0 ? "alerta" : ""}"><span>Stock bajo</span><strong>${d.stock_bajo || 0}</strong></div>
    </div>
    ${cats ? `<div class="inv-meta" style="margin-top:8px">${cats}</div>` : ""}`;
}

/** Busca primero en la base local y, si no está, en las APIs libres. */
async function invBuscarCodigo(codigoCrudo) {
  const codigo = String(codigoCrudo || "").replace(/\s/g, "");
  if (!codigo) { toast("Escribe o escanea un código", "error"); return; }
  const caja = document.getElementById("invResultadoApi");
  if (caja) {
    caja.innerHTML = `<div class="inv-card-api"><p class="inv-ayuda">Buscando ${esc(codigo)}…</p></div>`;
  }

  // 1) Base local, sin bloquear el hilo que pinta.
  const local = await invApiTarde("buscar_codigo", { codigo: codigo }, { maxMs: 6000 });
  if (local.ok && local.data && local.data.encontrado) {
    invMostrarLocal(local.data.producto, caja);
    return;
  }

  // 2) Tu nube (fabri-api → InsForge). Es la otra mitad de «mis 2 bases»: si el
  //    producto ya se sincronizó desde otro dispositivo, aparece aquí aunque
  //    todavía no esté en este teléfono.
  const nube = await invNubeBuscarCodigo(codigo);
  if (nube.ok) {
    invMostrarNube(nube.producto, caja);
    revision("inventario", "info", "código encontrado en tu nube", codigo, 0, "inventario");
    return;
  }

  // 3) Bases libres. Si ninguna responde, se dice tal cual: no es un error de
  //    la app ni del código, simplemente ese producto no está publicado.
  const api = await invConsultarApiLibre(codigo);
  if (api.ok) {
    invMostrarApi(api.producto, caja);
    revision("inventario", "info", "código encontrado en base libre",
      codigo + " · " + api.producto.fuente, 0, "inventario");
    return;
  }

  if (caja) {
    caja.innerHTML = `
      <div class="inv-card-api">
        <h3>Código ${esc(codigo)}</h3>
        <p class="inv-ayuda">${esc(api.error)}</p>
        <p class="inv-ayuda">Puedes darlo de alta a mano: el código queda guardado y no
          volverá a consultarse.</p>
        <div class="inv-item-acciones">
          <button class="btn btn-primario" id="btnInvCrearDesdeCodigo">Añadirlo como producto nuevo</button>
        </div>
      </div>`;
    const b = document.getElementById("btnInvCrearDesdeCodigo");
    if (b) b.addEventListener("click", function () {
      invFormulario({ codigo: codigo, origen: "manual" });
    });
  }
  revision("inventario", "aviso", "código no encontrado en bases libres",
    codigo + " · " + api.motivo, 0, "inventario");
}

function invMostrarLocal(p, caja) {
  if (!caja) return;
  caja.innerHTML = `
    <div class="inv-card-api">
      <h3>${esc(p.nombre)}</h3>
      <div class="inv-meta">
        <span class="inv-chip lima">ya está en tu base</span>
        <span class="inv-chip">${esc(p.codigo)}</span>
        <span class="inv-chip">${esc(INV_CATEGORIAS[p.categoria] || p.categoria)}</span>
        <span class="inv-chip">stock ${p.stock}</span>
        <span class="inv-chip">${invClp(p.precio)}</span>
      </div>
      <div class="inv-item-acciones">
        <button class="btn btn-primario" id="btnInvEditarEncontrado">Editar</button>
        <button class="btn" id="btnInvPreciosEncontrado">Ver precios</button>
        <button class="btn" id="btnInvCarritoEncontrado">Agregar a boleta</button>
      </div>
    </div>`;
  const ed = document.getElementById("btnInvEditarEncontrado");
  if (ed) ed.addEventListener("click", function () { invFormulario(p); });
  const pr = document.getElementById("btnInvPreciosEncontrado");
  if (pr) pr.addEventListener("click", function () { INV.sel = p.codigo; invPaso(3); });
  const ca = document.getElementById("btnInvCarritoEncontrado");
  if (ca) ca.addEventListener("click", function () { INV.sel = p.codigo; invCarritoAgregar(); });
}

/** Tarjeta cuando el código aparece en TU nube (fabri-api → InsForge). */
function invMostrarNube(p, caja) {
  if (!caja) return;
  caja.innerHTML = `
    <div class="inv-card-api">
      <h3>${esc(p.nombre)}</h3>
      <div class="inv-meta">
        <span class="inv-chip nube">ya está en tu nube</span>
        <span class="inv-chip">${esc(p.codigo)}</span>
        ${p.marca ? `<span class="inv-chip">${esc(p.marca)}</span>` : ""}
        <span class="inv-chip">${esc(INV_CATEGORIAS[p.categoria] || p.categoria)}</span>
        <span class="inv-chip">stock ${p.stock != null ? p.stock : 0}</span>
        <span class="inv-chip">${invClp(p.precio)}</span>
      </div>
      <p class="inv-ayuda">Vino de la nube (sincronizado desde otro dispositivo).
        Guárdalo aquí para tenerlo sin conexión.</p>
      <div class="inv-item-acciones">
        <button class="btn btn-primario" id="btnInvGuardarNube">Guardar en este teléfono</button>
        <button class="btn" id="btnInvDescartarNube">Descartar</button>
      </div>
    </div>`;
  const g = document.getElementById("btnInvGuardarNube");
  if (g) g.addEventListener("click", function () {
    invFormulario({
      codigo: p.codigo, nombre: p.nombre, marca: p.marca, categoria: p.categoria,
      unidad: p.unidad || "unidad", costo: p.costo, precio: p.precio,
      stock: p.stock, stock_minimo: p.stock_minimo, iva: p.iva,
      proveedor: p.proveedor, origen: "nube", notas: p.notas,
      ficha: (p.ficha && typeof p.ficha === "object") ? p.ficha : {}
    });
  });
  const d = document.getElementById("btnInvDescartarNube");
  if (d) d.addEventListener("click", function () { caja.innerHTML = ""; });
}

function invMostrarApi(p, caja) {
  if (!caja) return;
  const f = p.ficha || {};
  const img = p.imagen ? `<img src="${esc(p.imagen)}" alt="" loading="lazy" />` : "";
  const free = (f.etiquetas || []).map(function (id) {
    return `<span class="inv-chip lima">${esc(invFreeEtiqueta(id))}</span>`;
  }).join("");
  const nutri = f.nutriscore
    ? `<span class="inv-chip nutriscore-${esc(String(f.nutriscore).toLowerCase())}">Nutri-Score ${esc(String(f.nutriscore).toUpperCase())}</span>`
    : "";
  const nova = f.nova ? `<span class="inv-chip">NOVA ${esc(String(f.nova))}</span>` : "";
  const alergenos = (f.alergenos || []).length
    ? `<p class="inv-ayuda">Alérgenos: ${esc(f.alergenos.join(", "))}</p>`
    : "";
  caja.innerHTML = `
    <div class="inv-card-api">
      <h3>${esc(p.nombre)}</h3>
      <div class="inv-meta">
        <span class="inv-chip lima">encontrado en ${esc(p.fuente)}</span>
        <span class="inv-chip">${esc(p.codigo)}</span>
        ${p.marca ? `<span class="inv-chip">${esc(p.marca)}</span>` : ""}
        ${p.cantidad ? `<span class="inv-chip">${esc(p.cantidad)}</span>` : ""}
        <span class="inv-chip">${esc(INV_CATEGORIAS[p.categoria] || p.categoria)}</span>
        ${nutri}${nova}${free}
      </div>
      ${img}
      ${alergenos}
      <div id="invExtra"></div>
      <p class="inv-ayuda">No está en tu base. Revísalo y guárdalo con tu costo y precio.</p>
      <div class="inv-item-acciones">
        <button class="btn btn-primario" id="btnInvGuardarApi">Añadir a mi inventario</button>
        <button class="btn" id="btnInvDescartarApi">Descartar</button>
      </div>
    </div>`;
  // Enriquecimiento en segundo plano: no bloquea el pintado de la tarjeta.
  invEnriquecerLibre(p.codigo, p.nombre);
  const g = document.getElementById("btnInvGuardarApi");
  if (g) g.addEventListener("click", function () {
    invFormulario({
      codigo: p.codigo, nombre: p.nombre, marca: p.marca, categoria: p.categoria,
      unidad: p.cantidad || "unidad", origen: p.fuente, notas: p.descripcion || "",
      ficha: f
    });
  });
  const d = document.getElementById("btnInvDescartarApi");
  if (d) d.addEventListener("click", function () { caja.innerHTML = ""; });
}

/**
 * Consulta Open Food Facts → Beauty → Products (todas libres y sin clave).
 *
 * Tres cosas que antes estaban mal y colgaban la guía:
 *   · el timeout era de 9 s POR HOST, así que un código ausente podía tener la
 *     pantalla 27 s esperando;
 *   · un 404 o un 500 se mostraba como «HTTP 500», que el usuario lee como
 *     fallo de la app (el 500 de Open Products Facts es suyo, no nuestro);
 *   · no se distinguía «no está en las bases» de «no hay internet».
 *
 * Ahora: 4,5 s por host, 12 s de presupuesto total, los 404/500 se saltan en
 * silencio y el mensaje final dice la verdad.
 */
const INV_API_POR_HOST_MS = 4500;
const INV_API_TOTAL_MS = 12000;

async function invConsultarApiLibre(codigo) {
  const hosts = [
    { host: "https://world.openfoodfacts.org", fuente: "Open Food Facts", tipo: "alimento" },
    { host: "https://world.openbeautyfacts.org", fuente: "Open Beauty Facts", tipo: "cosmetica" },
    { host: "https://world.openproductsfacts.org", fuente: "Open Products Facts", tipo: "otros" }
  ];
  const campos = [
    "product_name", "brands", "categories", "categories_tags", "quantity",
    "image_small_url", "image_front_small_url", "generic_name", "labels_tags",
    "allergens_tags", "nutriscore_grade", "nutriscore_score", "nova_group",
    "countries_tags", "ingredients_text_es", "ingredients_text", "serving_size"
  ].join(",");

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return {
      ok: false, motivo: "sin conexión",
      error: "Sin conexión: el producto puede existir, pero ahora no se puede consultar."
    };
  }

  const t0 = Date.now();
  let respondioAlguno = false;
  let sinRed = false;

  for (const h of hosts) {
    const restante = INV_API_TOTAL_MS - (Date.now() - t0);
    if (restante < 600) break;
    const url = h.host + "/api/v2/product/" + encodeURIComponent(codigo) + ".json?fields=" + campos;
    try {
      const ctrl = new AbortController();
      const tope = Math.min(INV_API_POR_HOST_MS, restante);
      const t = setTimeout(function () { ctrl.abort(); }, tope);
      let resp;
      try {
        resp = await fetch(url, { signal: ctrl.signal, headers: { "Accept": "application/json" } });
      } finally {
        clearTimeout(t);
      }
      // La base RESPONDIÓ: eso ya lo distingue de «no hubo respuesta». 404 = no
      // está en esa base; 5xx = la base está caída. En ambos casos se pasa a la
      // siguiente sin gritar: no es un fallo de esta app.
      respondioAlguno = true;
      if (!resp.ok) continue;
      const datos = await resp.json();
      if (datos && datos.status === 1 && datos.product) {
        const p = datos.product;
        const ficha = {
          etiquetas: invFreeDesdeTags(p.labels_tags),
          etiquetas_todas: (p.labels_tags || []).map(function (x) {
            return String(x).replace(/^[a-z]{2}:/, "");
          }).slice(0, 20),
          alergenos: (p.allergens_tags || []).map(function (x) {
            return String(x).replace(/^[a-z]{2}:/, "");
          }).slice(0, 20),
          nutriscore: p.nutriscore_grade || "",
          nutriscore_score: p.nutriscore_score != null ? p.nutriscore_score : null,
          nova: p.nova_group || null,
          paises: (p.countries_tags || []).map(function (x) {
            return String(x).replace(/^[a-z]{2}:/, "");
          }).slice(0, 5),
          imagen: p.image_front_small_url || p.image_small_url || "",
          ingredientes: (p.ingredients_text_es || p.ingredients_text || "").slice(0, 600),
          porcion: p.serving_size || "",
          fuente: h.fuente
        };
        return {
          ok: true,
          producto: {
            codigo: codigo,
            nombre: p.product_name || p.generic_name || ("Producto " + codigo),
            marca: p.brands || "",
            cantidad: p.quantity || "",
            imagen: ficha.imagen,
            descripcion: (p.generic_name || "").slice(0, 160),
            categoria: invCategoriaDesdeTags(p.categories_tags, h.tipo),
            fuente: h.fuente,
            ficha: ficha
          }
        };
      }
      respondioAlguno = true;
    } catch (e) {
      // AbortError = se agotó el tiempo de ese host. TypeError = sin red.
      if (e && e.name === "TypeError") sinRed = true;
    }
  }

  if (!respondioAlguno) {
    return {
      ok: false, motivo: sinRed ? "sin red" : "bases libres sin respuesta",
      error: sinRed
        ? "Sin conexión a internet: no se pudo consultar el código."
        : "Las bases libres no respondieron a tiempo. Puedes intentarlo otra vez o darlo de alta a mano."
    };
  }
  return {
    ok: false, motivo: "no publicado en bases libres",
    error: "Ese código no está publicado en las bases libres (Open Food/Beauty/Products Facts). No es un error de la app."
  };
}

/* ── enriquecimiento con más fuentes libres ────────────────────────────────
   Dos fuentes que suman información que Open Food/Beauty/Products no dan:
     · Open Prices (OFF): precios reales que otras personas reportaron para ese
       mismo código de barras. Útil para el paso 3 (comparativa) y para sugerir
       un precio de venta.
     · Wikipedia/Wikidata (vía es.wikipedia.org): una descripción breve del
       producto por su NOMBRE (no por código, que casi nunca existe).
   Ambas son opcionales: si fallan, la tarjeta se muestra igual. */

/** Precios reportados en Open Prices para un código. */
async function invOpenPrices(codigo) {
  const url = "https://prices.openfoodfacts.org/api/v1/prices?product_code=" +
    encodeURIComponent(codigo) + "&order_by=-date&size=5";
  const ctrl = new AbortController();
  const t = setTimeout(function () { ctrl.abort(); }, 4500);
  try {
    const resp = await fetch(url, { signal: ctrl.signal, headers: { "Accept": "application/json" } });
    if (!resp.ok) return [];
    const datos = await resp.json();
    const items = (datos && datos.items) || [];
    return items.map(function (x) {
      const loc = x.location || {};
      return {
        precio: Number(x.price) || 0,
        moneda: x.currency || "EUR",
        tienda: loc.osm_address_city || loc.osm_display_name || "",
        fecha: x.date || ""
      };
    }).filter(function (x) { return x.precio > 0; });
  } catch (e) {
    return [];
  } finally {
    clearTimeout(t);
  }
}

/** Descripción breve de Wikipedia (es) para un nombre de producto. */
async function invWikiDescripcion(nombre) {
  const busca = String(nombre || "").trim();
  if (busca.length < 3) return null;
  const b = "https://es.wikipedia.org/w/api.php?format=json&origin=*";
  const ctrl = new AbortController();
  const t = setTimeout(function () { ctrl.abort(); }, 4500);
  try {
    const r1 = await fetch(b + "&action=query&list=search&srlimit=1&srsearch=" + encodeURIComponent(busca),
      { signal: ctrl.signal, headers: { "Accept": "application/json" } });
    if (!r1.ok) return null;
    const d1 = await r1.json();
    const hit = (((d1 || {}).query || {}).search || [])[0];
    if (!hit || !hit.title) return null;
    const r2 = await fetch(b + "&action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&titles=" +
      encodeURIComponent(hit.title), { signal: ctrl.signal, headers: { "Accept": "application/json" } });
    if (!r2.ok) return null;
    const d2 = await r2.json();
    const paginas = ((d2 || {}).query || {}).pages || {};
    const pid = Object.keys(paginas)[0];
    const texto = pid && paginas[pid] && paginas[pid].extract ? String(paginas[pid].extract) : "";
    if (!texto) return null;
    return {
      titulo: hit.title,
      texto: texto.replace(/\s+/g, " ").slice(0, 260),
      url: "https://es.wikipedia.org/wiki/" + encodeURIComponent(hit.title)
    };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Enriquecimiento de la tarjeta de una base libre: precios y descripción. */
async function invEnriquecerLibre(codigo, nombre) {
  const caja = document.getElementById("invExtra");
  if (!caja) return;
  let precio = `<span class="inv-chip">Open Prices: sin datos</span>`;
  let wiki = "";
  const [precios, desc] = await Promise.all([
    invOpenPrices(codigo),
    invWikiDescripcion(nombre)
  ]);
  if (precios && precios.length) {
    const p0 = precios[0];
    const otros = precios.slice(1, 4).map(function (x) {
      return `<span class="inv-chip">${esc(x.moneda)} ${invNum(x.precio)}${x.tienda ? " · " + esc(x.tienda) : ""}</span>`;
    }).join("");
    precio = `<span class="inv-chip lima">Open Prices ${esc(p0.moneda)} ${invNum(p0.precio)}` +
      (p0.tienda ? " · " + esc(p0.tienda) : "") + `</span>` + otros;
  }
  if (desc) {
    wiki = `<p class="inv-ayuda"><b>${esc(desc.titulo)}</b> (Wikipedia): ${esc(desc.texto)}…</p>`;
  }
  caja.innerHTML = `
    <div class="inv-meta" style="margin-top:8px">${precio}</div>
    ${wiki}`;
}

function invCategoriaDesdeTags(tags, porDefecto) {
  const t = (tags || []).join(" ").toLowerCase();
  // El orden importa: alcohol y bebidas antes que «food», y dulces antes que
  // «snack» para que un chocolate no caiga en abarrotes.
  if (/beer|wine|spirit|alcohol|licor|cerveza|vino|pisco|whisk|aperitif/.test(t)) return "alcohol";
  if (/water|juice|soda|drink|bebida|agua|jugo|energizante|refresco|isotonic/.test(t)) return "bebidas";
  if (/candy|chocolate|sweet|dulce|galleta|cookie|confite|mermelada/.test(t)) return "dulces";
  if (/dairy|milk|cheese|yogurt|lacteo|leche|queso|yoghurt/.test(t)) return "lacteos";
  if (/frozen|congelado|ice-cream|helado/.test(t)) return "congelados";
  if (/pet-food|mascota|dog-food|cat-food|alimento-para-perro/.test(t)) return "mascotas";
  if (/cosmetic|shampoo|soap|cream|perfume|jabon|deodorant/.test(t)) return "cosmetica";
  if (/clean|detergent|limpieza|lavaloza|bleach/.test(t)) return "limpieza";
  if (/food|beverage|alimento|grocery|abarrote|snack|cereal|pasta|rice|arroz|conserva/.test(t)) return "abarrotes";
  return porDefecto || "otros";
}

/* ── importación masiva ────────────────────────────────────────────────────
   Trae productos de otra base sin darlos de alta uno por uno. Acepta lo que
   exportan Eleventa, Excel y casi cualquier sistema: CSV o TSV con encabezado,
   o un JSON con la lista. El encabezado se reconoce por alias («Producto»,
   «Descripción», «Código de barras», «Precio»...), así que no hay que renombrar
   columnas ni reordenarlas. Todo se revisa en una vista previa antes de tocar
   la base. */

function invImportarPanel() {
  const caja = document.getElementById("invImportarPanel");
  if (caja) { caja.hidden = false; caja.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  const tarjeta = document.querySelector('[data-equipo="base"]');
  if (tarjeta) tarjeta.setAttribute("aria-expanded", "true");
  const t = document.getElementById("invImportarTexto");
  if (t) setTimeout(function () { t.focus(); }, 120);
  invImportarPrevia();
}

function invImportarCerrar() {
  const caja = document.getElementById("invImportarPanel");
  if (caja) caja.hidden = true;
  const tarjeta = document.querySelector('[data-equipo="base"]');
  if (tarjeta) tarjeta.setAttribute("aria-expanded", "false");
}

/** Lee el archivo elegido y lo vuelca al cuadro de texto para revisarlo. */
function invImportarArchivo(ev) {
  const input = ev && ev.target ? ev.target : document.getElementById("invImportarArchivo");
  const f = input && input.files && input.files[0];
  if (!f) return;
  const lector = new FileReader();
  lector.onload = function () {
    const t = document.getElementById("invImportarTexto");
    if (t) t.value = String(lector.result || "");
    invImportarPrevia();
    invAviso("Archivo cargado: " + f.name);
  };
  lector.onerror = function () { invAviso("No se pudo leer el archivo", "error"); };
  lector.readAsText(f, "utf-8");
}

/** Número tolerante a formato chileno (1.234,56) y anglosajón (1,234.56). */
function invNumImport(valor) {
  if (typeof valor === "number") return isFinite(valor) ? valor : 0;
  let s = String(valor == null ? "" : valor).replace(/[^\d.,-]/g, "").trim();
  if (!s) return 0;
  const tienePunto = s.indexOf(".") >= 0;
  const tieneComa = s.indexOf(",") >= 0;
  if (tienePunto && tieneComa) {
    // El último separador es el decimal.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (tieneComa) {
    s = s.replace(",", ".");
  } else if (tienePunto) {
    const partes = s.split(".");
    if (partes.length > 2 || (partes[1] && partes[1].length === 3 && partes[0].length <= 3)) {
      s = s.replace(/\./g, "");
    }
  }
  const n = Number(s);
  return isFinite(n) ? n : 0;
}

/** Separa una línea respetando comillas dobles (CSV real, no un split). */
function invSepararLinea(linea, delim) {
  const salida = [];
  let actual = "";
  let entreComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (entreComillas) {
      if (c === '"') {
        if (linea[i + 1] === '"') { actual += '"'; i++; }
        else entreComillas = false;
      } else actual += c;
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === delim) {
      salida.push(actual);
      actual = "";
    } else {
      actual += c;
    }
  }
  salida.push(actual);
  return salida.map(function (x) { return x.trim(); });
}

/** Delimitador más probable en las primeras líneas. */
function invDetectarDelimitador(texto) {
  const lineas = texto.split(/\r?\n/).filter(function (l) { return l.trim(); }).slice(0, 6);
  const cand = ["\t", ";", "|", ","];
  let mejor = ",";
  let mejorPuntaje = -1;
  cand.forEach(function (d) {
    let media = 0;
    let consistente = true;
    let base = -1;
    lineas.forEach(function (l) {
      const n = invSepararLinea(l, d).length;
      media += n;
      if (base < 0) base = n;
      else if (n !== base) consistente = false;
    });
    const puntaje = media / Math.max(1, lineas.length) + (consistente ? 2 : 0);
    if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejor = d; }
  });
  return mejor;
}

/** Normaliza un encabezado: minúsculas, sin tildes ni signos. */
function invClaveCampo(s) {
  return String(s || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** Alias de encabezado → campo del producto. */
const INV_ALIAS = {
  nombre: ["nombre", "producto", "descripcion", "description", "name", "articulo", "detalle", "item"],
  codigo: ["codigo", "codigo_barras", "codigo_de_barras", "barcode", "barra", "ean", "ean13", "upc", "sku", "clave", "cod"],
  precio: ["precio", "precio_venta", "precio_de_venta", "pvp", "price", "venta", "precio_publico"],
  costo: ["costo", "precio_costo", "precio_compra", "cost", "compra", "costo_neto"],
  stock: ["stock", "existencia", "existencias", "cantidad", "qty", "quantity", "inventario", "saldo"],
  stock_minimo: ["stock_minimo", "minimo", "min", "stock_min", "punto_de_pedido"],
  marca: ["marca", "brand", "fabricante", "laboratorio"],
  categoria: ["categoria", "category", "rubro", "familia", "linea", "grupo"],
  unidad: ["unidad", "unidad_de_medida", "um", "unit", "medida", "presentacion"],
  iva: ["iva", "impuesto", "tax"],
  proveedor: ["proveedor", "supplier", "distribuidor"],
  notas: ["notas", "observaciones", "comentario", "nota", "descripcion_larga"]
};

function invCampoImport(clave) {
  const k = invClaveCampo(clave);
  for (const campo in INV_ALIAS) {
    if (INV_ALIAS[campo].indexOf(k) >= 0) return campo;
  }
  // Coincidencia parcial: "precio_final", "cod_barra", "nom_producto".
  for (const campo in INV_ALIAS) {
    const alias = INV_ALIAS[campo];
    for (let i = 0; i < alias.length; i++) {
      if (alias[i].length >= 4 && k.indexOf(alias[i]) >= 0) return campo;
    }
  }
  return "";
}

/** Convierte una fila (objeto ya mapeado) en un producto del núcleo. */
function invProductoImport(fila, i) {
  const nombre = String(fila.nombre || "").trim();
  let codigo = String(fila.codigo || "").replace(/\s/g, "");
  if (!codigo) codigo = "IMP-" + Date.now().toString(36).toUpperCase() + "-" + (i + 1);
  const cat = invClaveCampo(fila.categoria || "");
  const categoria = Object.keys(INV_CATEGORIAS).indexOf(cat) >= 0
    ? cat
    : invCategoriaDesdeTags([cat], "abarrotes");
  return {
    codigo: codigo,
    nombre: nombre,
    marca: String(fila.marca || "").trim(),
    categoria: categoria,
    unidad: String(fila.unidad || "unidad").trim() || "unidad",
    costo: invNumImport(fila.costo),
    precio: invNumImport(fila.precio),
    stock: Math.round(invNumImport(fila.stock)),
    stock_minimo: Math.round(invNumImport(fila.stock_minimo)),
    iva: fila.iva != null && String(fila.iva).trim() !== "" ? Math.round(invNumImport(fila.iva)) : 19,
    proveedor: String(fila.proveedor || "").trim(),
    notas: String(fila.notas || "").trim(),
    origen: "importado",
    ficha: {}
  };
}

/** Devuelve { productos, errores, formato } desde el texto pegado/elegido. */
function invParseImportacion(textoCrudo) {
  const texto = String(textoCrudo || "").replace(/^\uFEFF/, "").trim();
  const vacio = { productos: [], errores: [], formato: "" };
  if (!texto) return vacio;

  // 1) JSON: lista de objetos o {productos:[...]} / {items:[...]}.
  if (texto[0] === "[" || texto[0] === "{") {
    try {
      const d = JSON.parse(texto);
      let lista = [];
      if (Array.isArray(d)) lista = d;
      else if (d && Array.isArray(d.productos)) lista = d.productos;
      else if (d && Array.isArray(d.items)) lista = d.items;
      else if (d && Array.isArray(d.data)) lista = d.data;
      const productos = [];
      const errores = [];
      lista.forEach(function (o, i) {
        if (!o || typeof o !== "object") { errores.push({ fila: i + 1, error: "no es un objeto" }); return; }
        const fila = {};
        Object.keys(o).forEach(function (k) {
          const campo = invCampoImport(k);
          if (campo && (fila[campo] == null || fila[campo] === "")) fila[campo] = o[k];
        });
        // JSON ya puede venir con los nombres del núcleo.
        ["nombre", "codigo", "precio", "costo", "stock", "stock_minimo", "marca", "categoria", "unidad", "iva", "proveedor", "notas"].forEach(function (c) {
          if (fila[c] == null && o[c] != null) fila[c] = o[c];
        });
        if (!String(fila.nombre || "").trim()) { errores.push({ fila: i + 1, error: "sin nombre" }); return; }
        productos.push(invProductoImport(fila, i));
      });
      return { productos: productos, errores: errores, formato: "JSON" };
    } catch (e) {
      // Si el JSON está mal, se intenta como tabla: puede ser un CSV que
      // empieza con una llave en el primer campo.
    }
  }

  // 2) Tabla CSV/TSV.
  const delim = invDetectarDelimitador(texto);
  const lineas = texto.split(/\r?\n/).filter(function (l) { return l.trim(); });
  if (!lineas.length) return vacio;

  let encabezados = invSepararLinea(lineas[0], delim);
  let mapeados = encabezados.map(invCampoImport);
  let desde = 1;
  const sinMapeo = mapeados.filter(function (m) { return !!m; }).length;
  // Sin encabezado reconocible: se asume el orden clásico
  // código, nombre, precio, stock.
  if (sinMapeo === 0) {
    encabezados = ["codigo", "nombre", "precio", "stock", "costo", "stock_minimo", "marca", "categoria", "unidad"];
    mapeados = encabezados.slice();
    desde = 0;
  }

  const productos = [];
  const errores = [];
  for (let i = desde; i < lineas.length; i++) {
    const celdas = invSepararLinea(lineas[i], delim);
    if (!celdas.length || (celdas.length === 1 && !celdas[0])) continue;
    const fila = {};
    mapeados.forEach(function (campo, j) {
      if (campo && celdas[j] != null && fila[campo] == null) fila[campo] = celdas[j];
    });
    if (!String(fila.nombre || "").trim()) { errores.push({ fila: i + 1, error: "sin nombre" }); continue; }
    productos.push(invProductoImport(fila, productos.length));
  }
  return { productos: productos, errores: errores, formato: delim === "\t" ? "TSV" : "CSV" };
}

/** Pinta una importación ya mapeada (texto o base nativa). No escribe nada. */
function invPintarImportacion(r, origen) {
  const caja = document.getElementById("invImportarPrevia");
  const btn = document.getElementById("btnInvImportarEjecutar");
  if (!caja) return;
  if (!r || !r.productos || !r.productos.length) {
    caja.innerHTML = `<p class="inv-ayuda">Pega los datos o elige el archivo exportado de la otra base.</p>`;
    if (btn) btn.disabled = true;
    return;
  }
  const muestra = r.productos.slice(0, 6).map(function (p) {
    return `<tr><td>${esc(p.codigo)}</td><td>${esc(p.nombre)}</td><td class="num">${invClp(p.precio)}</td><td class="num">${p.stock}</td></tr>`;
  }).join("");
  caja.innerHTML = `
    <div class="inv-meta">
      <span class="inv-chip lima">${esc(r.formato || "?")}</span>
      ${origen ? `<span class="inv-chip">${esc(origen)}</span>` : ""}
      <span class="inv-chip">${r.productos.length} producto(s) válidos</span>
      ${r.errores.length ? `<span class="inv-chip baja">${r.errores.length} fila(s) con problema</span>` : ""}
    </div>
    <div class="inv-tabla-scroll">
      <table class="inv-tabla">
        <thead><tr><th>Código</th><th>Nombre</th><th class="num">Precio</th><th class="num">Stock</th></tr></thead>
        <tbody>${muestra || `<tr><td colspan="4">Nada reconocible todavía.</td></tr>`}</tbody>
      </table>
    </div>
    ${r.errores.length ? `<p class="inv-ayuda">Se omitirán ${r.errores.length} fila(s) sin nombre (fila ${r.errores.slice(0, 5).map(function (e) { return e.fila; }).join(", ")}).</p>` : ""}
    ${r.aviso ? `<p class="inv-ayuda inv-error">${esc(r.aviso)}</p>` : ""}`;
  if (btn) btn.disabled = false;
}

/**
 * Mapea filas ya extraídas de SQLite o Excel. `encabezados` son los nombres
 * originales de la tabla/hoja; `filas` son arrays en el mismo orden. Se
 * reutilizan los alias de `invCampoImport`, así que «Descripción», «EAN» o
 * «Existencia» se reconocen igual que en un CSV.
 */
function invImportarFilas(encabezados, filas, etiqueta) {
  const cabecera = (encabezados || []).map(function (x) { return String(x == null ? "" : x); });
  let mapeados = cabecera.map(invCampoImport);
  let aviso = "";
  // Sin una columna de nombre reconocible no se adivina: se usa el orden
  // clásico (código, nombre, precio, stock) y se avisa en la vista previa.
  if (mapeados.indexOf("nombre") < 0) {
    mapeados = ["codigo", "nombre", "precio", "stock", "costo", "stock_minimo", "marca", "categoria", "unidad"];
    aviso = "No se reconoció la columna de nombre: se leyó en el orden código, nombre, precio, stock.";
  }
  const productos = [];
  const errores = [];
  (filas || []).forEach(function (celdas, i) {
    const fila = {};
    mapeados.forEach(function (campo, j) {
      if (campo && celdas && celdas[j] != null && String(celdas[j]).trim() !== "" && fila[campo] == null) {
        fila[campo] = celdas[j];
      }
    });
    if (!String(fila.nombre || "").trim()) { errores.push({ fila: i + 1, error: "sin nombre" }); return; }
    productos.push(invProductoImport(fila, productos.length));
  });
  const r = { productos: productos, errores: errores, formato: etiqueta || "base", aviso: aviso };
  INV.importar = r;
  INV.importarNativo = true;
  INV.importarOrigen = etiqueta || "base";
  invPintarImportacion(r, etiqueta);
  return r;
}

/** Vista previa antes de importar. No escribe nada en la base. */
function invImportarPrevia() {
  const texto = (document.getElementById("invImportarTexto") || {}).value || "";
  if (!texto.trim()) {
    // Una base nativa (SQLite/Excel) ya mapeada no se borra porque el cuadro
    // de texto esté vacío: se conserva hasta que el usuario elija otra cosa.
    if (INV.importarNativo && INV.importar && INV.importar.productos && INV.importar.productos.length) {
      invPintarImportacion(INV.importar, INV.importarOrigen);
      return;
    }
    INV.importar = null;
    invPintarImportacion(null);
    return;
  }
  const r = invParseImportacion(texto);
  INV.importar = r;
  INV.importarNativo = false;
  INV.importarOrigen = "";
  invPintarImportacion(r, "");
}

/** Envía el lote a la base en una sola operación. */
function invImportarEjecutar() {
  const r = INV.importar || invParseImportacion((document.getElementById("invImportarTexto") || {}).value || "");
  if (!r || !r.productos.length) { invAviso("No hay productos válidos para importar", "error"); return; }
  const btn = document.getElementById("btnInvImportarEjecutar");
  if (btn) btn.disabled = true;
  invAviso("Importando " + r.productos.length + " producto(s)...");
  invApiTarde("importar", { productos: r.productos, origen: "importado" }, { maxMs: 60000 })
    .then(function (res) {
      if (btn) btn.disabled = false;
      if (!res.ok) { invAviso("Importación fallida: " + (res.error || "error"), "error"); return; }
      const d = res.data || {};
      revision("inventario", "info", "importación masiva completada",
        (d.nuevos || 0) + " nuevos · " + (d.actualizados || 0) + " actualizados · " +
        (d.con_error || 0) + " con error", 0, "inventario");
      invAviso("Importado · " + (d.nuevos || 0) + " nuevos · " + (d.actualizados || 0) + " actualizados" +
        ((d.con_error || 0) ? " · " + d.con_error + " con error" : ""));
      invSello("Importación lista");
      const t = document.getElementById("invImportarTexto");
      if (t) t.value = "";
      INV.importar = null;
      INV.importarNativo = false;
      INV.importarOrigen = "";
      invImportarPrevia();
      invRefrescar();
    });
}

/* ── dibujo: miniatura y código de barras ──────────────────────────────────
   La miniatura se dibuja en canvas a partir del código del producto (color
   estable por producto + iniciales), así que no dependen de internet ni de
   archivos. Si la ficha trae una imagen real de las bases libres, esa manda.
   El código de barras se dibuja como SVG en línea (EAN-13 si el dígito de
   control es válido, Code 39 si no), sin librerías. */

const EAN_L_BITS = ["0001101", "0011001", "0010011", "0111101", "0100011",
  "0110001", "0101111", "0111011", "0110111", "0001011"];
const EAN_G_BITS = ["0100111", "0110011", "0011011", "0100001", "0011101",
  "0111001", "0000101", "0010001", "0001001", "0010111"];
const EAN_R_BITS = ["1110010", "1100110", "1101100", "1000010", "1011100",
  "1001110", "1010000", "1000100", "1001000", "1110100"];

/** Módulos (0/1) de un EAN-13 válido, o "" si no lo es. */
function invBitsEan13(codigo) {
  const c = String(codigo || "");
  if (!/^\d{13}$/.test(c) || !invEanValido(c)) return "";
  const paridad = EAN_PARIDAD[Number(c[0])] || "LLLLLL";
  let bits = "101";
  for (let i = 1; i <= 6; i++) {
    const d = Number(c[i]);
    bits += paridad[i - 1] === "G" ? EAN_G_BITS[d] : EAN_L_BITS[d];
  }
  bits += "01010";
  for (let i = 7; i <= 12; i++) bits += EAN_R_BITS[Number(c[i])];
  bits += "101";
  return bits;
}

/* Code 39: 9 elementos por carácter (5 barras + 4 espacios), 3 anchos. */
const CODE39_BITS = {
  "0": "101001101101", "1": "110100101011", "2": "101100101011",
  "3": "110110010101", "4": "101001101011", "5": "110100110101",
  "6": "101100110101", "7": "101001011011", "8": "110100101101",
  "9": "101100101101", "A": "110101001011", "B": "101101001011",
  "C": "110110100101", "D": "101011001011", "E": "110101100101",
  "F": "101101100101", "G": "101010011011", "H": "110101001101",
  "I": "101101001101", "J": "101011001101", "K": "110101010011",
  "L": "101101010011", "M": "110110101001", "N": "101011010011",
  "O": "110101101001", "P": "101101101001", "Q": "101010110011",
  "R": "110101011001", "S": "101101011001", "T": "101011011001",
  "U": "110010101011", "V": "100110101011", "W": "110011010101",
  "X": "100101101011", "Y": "110010110101", "Z": "100110110101",
  "-": "100101011011", ".": "110010101101", " ": "100110101101",
  "$": "100100100101", "/": "100100101001", "+": "100101001001",
  "%": "101001001001", "*": "100101101101"
};

/** Módulos (0/1) de un Code 39, o "" si no queda ningún carácter válido. */
function invBitsCode39(texto) {
  const limpio = String(texto || "").toUpperCase().replace(/[^0-9A-Z\-. $/+%]/g, "");
  if (!limpio) return "";
  const cadena = ("*" + limpio + "*").split("");
  const partes = [];
  for (let i = 0; i < cadena.length; i++) {
    const b = CODE39_BITS[cadena[i]];
    if (b) partes.push(b);
  }
  return partes.join("0");
}

/** SVG en línea del código de barras (vacío si no hay nada que dibujar). */
function invBarrasSvg(codigo, alto) {
  const txt = String(codigo || "").replace(/\s/g, "");
  if (!txt) return "";
  let bits = invBitsEan13(txt);
  if (!bits) bits = invBitsCode39(txt);
  if (!bits) return "";
  const h = alto || 30;
  let x = 0;
  let rects = "";
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] !== "1") { x++; continue; }
    let w = 1;
    while (i + w < bits.length && bits[i + w] === "1") w++;
    rects += `<rect x="${x}" y="0" width="${w}" height="${h}"/>`;
    x += w;
    i += w - 1;
  }
  return `<svg class="inv-barras" viewBox="0 0 ${bits.length} ${h}" ` +
    `preserveAspectRatio="none" role="img" aria-label="código ${esc(txt)}" ` +
    `fill="currentColor" shape-rendering="crispEdges">${rects}</svg>`;
}

/** Hash estable de una cadena (para el color de la miniatura). */
function invHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Dibuja la miniatura de un producto en su canvas (sin red, determinista). */
function invDibujarMiniatura(cv, p) {
  if (!cv || !p) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const lado = 64;
  const w = Math.round(lado * dpr);
  if (cv.width !== w || cv.height !== w) { cv.width = w; cv.height = w; }
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, w);

  const h = invHash(String(p.codigo || p.nombre || "?"));
  const tono = h % 360;
  const grad = ctx.createLinearGradient(0, 0, w, w);
  grad.addColorStop(0, "hsl(" + tono + ", 62%, 42%)");
  grad.addColorStop(1, "hsl(" + ((tono + 42) % 360) + ", 58%, 26%)");
  // Fondo redondeado.
  const r = Math.round(w * 0.24);
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(w, 0, w, w, r);
  ctx.arcTo(w, w, 0, w, r);
  ctx.arcTo(0, w, 0, 0, r);
  ctx.arcTo(0, 0, w, 0, r);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Brillo diagonal sutil.
  ctx.save();
  ctx.clip();
  ctx.globalAlpha = 0.10;
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = Math.max(2, w * 0.06);
  for (let k = -w; k < w * 2; k += Math.max(10, w * 0.22)) {
    ctx.beginPath();
    ctx.moveTo(k, 0);
    ctx.lineTo(k - w, w);
    ctx.stroke();
  }
  ctx.restore();

  // Iniciales (o inicial del nombre).
  const nombre = String(p.nombre || p.codigo || "?").trim();
  const partes = nombre.split(/\s+/).filter(Boolean);
  const ini = (partes.length > 1
    ? (partes[0][0] || "") + (partes[1][0] || "")
    : nombre.slice(0, 2)).toUpperCase();
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.font = "700 " + Math.round(w * 0.40) + "px -apple-system, Roboto, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(ini, w / 2, w * 0.54);
}

/**
 * OCR: comprueba si el proceso tiene un motor de reconocimiento y, sólo en ese
 * caso, muestra el botón. Un botón que siempre dice «no disponible» es peor que
 * no tenerlo; así la función se enciende sola cuando el build lo incluya.
 */
function invOcrIniciar() {
  if (INV.ocrComprobado) return;
  INV.ocrComprobado = true;
  let st = null;
  try {
    if (window.FabrickNative && typeof window.FabrickNative.ocrEstado === "function") {
      st = JSON.parse(window.FabrickNative.ocrEstado());
    }
  } catch (e) { st = null; }
  INV.ocr = st || { disponible: false, motivo: "sin puente nativo" };
  const btn = document.getElementById("btnInvOcr");
  if (btn) btn.hidden = !INV.ocr.disponible;
  if (INV.ocr.disponible) {
    revision("inventario", "info", "OCR disponible", String(INV.ocr.motor || ""), 0, "ocr");
  }
}

function invOcrPanel(abrir) {
  const caja = document.getElementById("invOcrPanel");
  if (!caja) return;
  caja.hidden = !abrir;
  if (abrir) {
    const estado = document.getElementById("invOcrEstado");
    if (estado) estado.textContent = "Motor: " + (INV.ocr && INV.ocr.motor ? INV.ocr.motor : "—") +
      " · la imagen no sale del teléfono.";
  }
}

/** Lee la foto elegida y pide el texto al motor nativo. */
function invOcrImagen(ev) {
  const input = ev && ev.target ? ev.target : document.getElementById("invOcrImagen");
  const f = input && input.files && input.files[0];
  if (!f) return;
  const estado = document.getElementById("invOcrEstado");
  const salida = document.getElementById("invOcrTexto");
  if (estado) estado.textContent = "Reconociendo el texto de la foto...";
  if (salida) salida.value = "";
  const lector = new FileReader();
  lector.onload = function () {
    const dataUrl = String(lector.result || "");
    // Se cede un cuadro para que el aviso se pinte antes de la llamada.
    setTimeout(function () {
      let r = null;
      const t0 = Date.now();
      try {
        r = JSON.parse(window.FabrickNative.ocr(dataUrl));
      } catch (e) {
        r = { ok: false, error: String(e) };
      }
      const ms = Date.now() - t0;
      if (!r || !r.ok) {
        if (estado) estado.textContent = "OCR: " + ((r && (r.error || r.motivo)) || "sin respuesta");
        revision("inventario", "aviso", "OCR sin resultado", String((r && (r.error || r.motivo)) || ""), ms, "ocr");
        return;
      }
      if (salida) salida.value = r.texto || "";
      if (estado) estado.textContent = (r.texto ? "Texto reconocido" : "No se encontró texto legible") +
        " · " + ms + " ms";
      revision("inventario", "info", "OCR completado", (r.texto || "").slice(0, 60), ms, "ocr");
    }, 40);
  };
  lector.onerror = function () { if (estado) estado.textContent = "No se pudo leer la imagen."; };
  lector.readAsDataURL(f);
}

/** Usa la primera línea reconocida como nombre del producto nuevo. */
function invOcrUsarNombre() {
  const texto = ((document.getElementById("invOcrTexto") || {}).value || "").trim();
  if (!texto) { toast("No hay texto reconocido", "error"); return; }
  const nombre = texto.split(/\r?\n/).map(function (x) { return x.trim(); })
    .filter(Boolean).slice(0, 2).join(" ").slice(0, 90);
  invOcrPanel(false);
  invFormulario({ nombre: nombre, origen: "ocr" });
}

/* ── paso 2 · productos ─────────────────────────────────────────────────── */

const INV_CAT_LOTE = 80;

function invPintarProductos() {
  const caja = document.getElementById("invLista");
  if (!caja) return;
  const texto = (document.getElementById("invBuscar") || {}).value || "";
  const categoria = (document.getElementById("invFiltroCategoria") || {}).value || "";
  const free = (document.getElementById("invFiltroFree") || {}).value || "";
  const bajo = (document.getElementById("invSoloBajo") || {}).checked ? 1 : 0;

  const t = texto.trim().toLowerCase();
  const lista = INV.productos.filter(function (p) {
    if (categoria && p.categoria !== categoria) return false;
    if (free && (invFichaDe(p).etiquetas || []).indexOf(free) < 0) return false;
    if (bajo && !(p.stock <= p.stock_minimo)) return false;
    if (!t) return true;
    return (p.nombre + " " + p.marca + " " + p.codigo + " " + p.categoria).toLowerCase().indexOf(t) >= 0;
  });

  INV._catLista = lista;
  INV._catMostrar = INV_CAT_LOTE;
  invPintarCatalogo();
}

/** Pinta el catálogo en tarjetas (miniatura + código de barras + acciones). */
function invPintarCatalogo() {
  const caja = document.getElementById("invLista");
  if (!caja) return;
  const lista = INV._catLista || [];
  if (!lista.length) {
    caja.innerHTML = `<div class="inv-vacio">${INV.productos.length
      ? "Ningún producto coincide con el filtro."
      : "Todavía no hay productos. Escanea un código, impórtalos o crea uno con «Nuevo producto»."}</div>`;
    return;
  }
  const hasta = Math.min(lista.length, INV._catMostrar || INV_CAT_LOTE);
  const restantes = lista.length - hasta;
  caja.innerHTML = `<div class="inv-catalogo">` +
    lista.slice(0, hasta).map(invCardHtml).join("") + `</div>` +
    (restantes > 0
      ? `<button class="btn inv-cat-mas" id="invCatMas" type="button">${ico("mas", 15)} Ver ${restantes} más</button>`
      : "");

  // Miniaturas: se dibujan en el siguiente cuadro para no bloquear el toque.
  requestAnimationFrame(function () {
    caja.querySelectorAll("canvas[data-inv-mini]").forEach(function (cv) {
      invDibujarMiniatura(cv, invPorCodigo(cv.dataset.invMini));
    });
  });

  const mas = document.getElementById("invCatMas");
  if (mas) mas.addEventListener("click", function () {
    INV._catMostrar = (INV._catMostrar || INV_CAT_LOTE) + INV_CAT_LOTE;
    invPintarCatalogo();
  });

  caja.querySelectorAll("[data-inv-editar]").forEach(function (b) {
    b.addEventListener("click", function () { invFormulario(invPorCodigo(b.dataset.invEditar)); });
  });
  caja.querySelectorAll("[data-inv-precios]").forEach(function (b) {
    b.addEventListener("click", function () { INV.sel = b.dataset.invPrecios; invPaso(3); });
  });
  caja.querySelectorAll("[data-inv-mas]").forEach(function (b) {
    b.addEventListener("click", function () { invMovimiento(b.dataset.invMas, "entrada", 1); });
  });
  caja.querySelectorAll("[data-inv-menos]").forEach(function (b) {
    b.addEventListener("click", function () { invMovimiento(b.dataset.invMenos, "salida", 1); });
  });
  caja.querySelectorAll("[data-inv-carrito]").forEach(function (b) {
    b.addEventListener("click", function () { INV.sel = b.dataset.invCarrito; invCarritoAgregar(); });
  });
  caja.querySelectorAll("[data-inv-borrar]").forEach(function (b) {
    b.addEventListener("click", function () { invBorrar(b.dataset.invBorrar); });
  });
}

/** Tarjeta de catálogo de un producto. */
function invCardHtml(p) {
  const bajoStock = Number(p.stock) <= Number(p.stock_minimo);
  const f = invFichaDe(p);
  const cat = INV_CATEGORIAS[p.categoria] || p.categoria || "Otros";
  const mini = f.imagen
    ? `<img src="${esc(f.imagen)}" alt="" loading="lazy" onerror="this.parentNode.classList.add('sin-img');this.remove()" />`
    : `<canvas data-inv-mini="${esc(p.codigo)}" width="64" height="64" aria-hidden="true"></canvas>`;
  const chips = [
    `<span class="inv-chip">${esc(cat)}</span>`,
    `<span class="inv-chip ${bajoStock ? "baja" : ""}">stock ${p.stock}${bajoStock ? " · bajo" : ""}</span>`,
    `<span class="inv-chip">costo ${invClp(p.costo)}</span>`
  ];
  (f.etiquetas || []).slice(0, 2).forEach(function (id) {
    chips.push(`<span class="inv-chip lima">${esc(invFreeEtiqueta(id))}</span>`);
  });
  if (f.nutriscore) chips.push(`<span class="inv-chip">Nutri-Score ${esc(String(f.nutriscore).toUpperCase())}</span>`);
  if (p.pendiente_sync) chips.push(`<span class="inv-chip">sin sync</span>`);

  return `<article class="inv-card${bajoStock ? " bajo" : ""}">
    <div class="inv-card-cab">
      <div class="inv-card-mini">${mini}</div>
      <div class="inv-card-id">
        <h4>${esc(p.nombre)}</h4>
        <p>${p.marca ? esc(p.marca) + " · " : ""}${esc(cat)}</p>
        <div class="inv-card-cod">
          ${invBarrasSvg(p.codigo, 26)}
          <span>${esc(p.codigo)}</span>
        </div>
      </div>
      <div class="inv-card-precio">
        <strong>${invClp(p.precio)}</strong>
        <span>margen ${p.margen != null ? p.margen : 0}%</span>
      </div>
    </div>
    <div class="inv-item-meta">${chips.join("")}</div>
    <div class="inv-item-acciones">
      <button class="btn" data-inv-editar="${esc(p.codigo)}" title="Editar">${ico("editar", 14)} Editar</button>
      <button class="btn" data-inv-precios="${esc(p.codigo)}" title="Precios">${ico("etiqueta", 14)} Precios</button>
      <button class="btn" data-inv-mas="${esc(p.codigo)}" title="Sumar 1 al stock">${ico("mas", 14)} 1</button>
      <button class="btn" data-inv-menos="${esc(p.codigo)}" title="Restar 1 al stock">${ico("menos", 14)} 1</button>
      <button class="btn" data-inv-carrito="${esc(p.codigo)}" title="Agregar a la boleta">${ico("carrito", 14)} A boleta</button>
      <button class="btn" data-inv-borrar="${esc(p.codigo)}" title="Borrar">${ico("borrar", 14)}</button>
    </div>
  </article>`;
}

function invPorCodigo(codigo) {
  for (let i = 0; i < INV.productos.length; i++) {
    if (INV.productos[i].codigo === codigo) return INV.productos[i];
  }
  return null;
}

function invFormulario(p) {
  const caja = document.getElementById("invFormulario");
  if (!caja) return;
  caja.hidden = false;
  document.getElementById("invFormTitulo").textContent = p && p.codigo ? "Editar producto" : "Nuevo producto";
  document.getElementById("invFcodigo").value = p && p.codigo ? p.codigo : "";
  document.getElementById("invFnombre").value = p && p.nombre ? p.nombre : "";
  document.getElementById("invFmarca").value = p && p.marca ? p.marca : "";
  document.getElementById("invFcategoria").value = (p && p.categoria) || "abarrotes";
  document.getElementById("invFunidad").value = (p && p.unidad) || "unidad";
  document.getElementById("invFcosto").value = p && p.costo != null ? p.costo : "";
  document.getElementById("invFprecio").value = p && p.precio != null ? p.precio : "";
  document.getElementById("invFstock").value = p && p.stock != null ? p.stock : 0;
  document.getElementById("invFminimo").value = p && p.stock_minimo != null ? p.stock_minimo : 0;
  document.getElementById("invFiva").value = p && p.iva != null ? p.iva : 19;
  document.getElementById("invFproveedor").value = (p && p.proveedor) || "";
  document.getElementById("invFnotas").value = (p && p.notas) || "";
  invFichaPintar(p && p.ficha ? p.ficha : {});
  caja.dataset.origen = (p && p.origen) || "manual";
  caja.scrollIntoView({ behavior: "smooth", block: "start" });
  const nombre = document.getElementById("invFnombre");
  if (nombre) setTimeout(function () { nombre.focus(); }, 120);
}

function invFormularioCerrar() {
  const caja = document.getElementById("invFormulario");
  if (caja) caja.hidden = true;
}

/** Muestra y guarda la ficha ampliada (Nutri-Score, NOVA, «free», alérgenos). */
function invFichaPintar(ficha) {
  const campo = document.getElementById("invFficha");
  const vista = document.getElementById("invFfichaVista");
  let f = ficha;
  if (typeof f === "string") {
    try { f = JSON.parse(f || "{}"); } catch (e) { f = {}; }
  }
  f = f && typeof f === "object" ? f : {};
  if (campo) campo.value = JSON.stringify(f);
  if (!vista) return;
  const chips = [];
  if (f.nutriscore) {
    chips.push(`<span class="inv-chip">Nutri-Score ${esc(String(f.nutriscore).toUpperCase())}</span>`);
  }
  if (f.nova) chips.push(`<span class="inv-chip">NOVA ${esc(String(f.nova))}</span>`);
  (f.etiquetas || []).forEach(function (id) {
    chips.push(`<span class="inv-chip lima">${esc(invFreeEtiqueta(id))}</span>`);
  });
  if ((f.alergenos || []).length) {
    chips.push(`<span class="inv-chip">alérgenos: ${esc(f.alergenos.join(", "))}</span>`);
  }
  vista.innerHTML = chips.join("");
}

/** Guarda con animación de envío a la base y confirmación visible. */
function invGuardar() {
  const producto = {
    codigo: document.getElementById("invFcodigo").value.trim(),
    nombre: document.getElementById("invFnombre").value.trim(),
    marca: document.getElementById("invFmarca").value.trim(),
    categoria: document.getElementById("invFcategoria").value,
    unidad: document.getElementById("invFunidad").value.trim() || "unidad",
    costo: invNum(document.getElementById("invFcosto").value),
    precio: invNum(document.getElementById("invFprecio").value),
    stock: Math.round(invNum(document.getElementById("invFstock").value)),
    stock_minimo: Math.round(invNum(document.getElementById("invFminimo").value)),
    iva: Math.round(invNum(document.getElementById("invFiva").value)),
    proveedor: document.getElementById("invFproveedor").value.trim(),
    notas: document.getElementById("invFnotas").value.trim(),
    ficha: (document.getElementById("invFficha") || {}).value || "{}",
    origen: (document.getElementById("invFormulario").dataset.origen || "manual")
  };
  if (!producto.nombre) {
    invAviso("El nombre es obligatorio", "error");
    document.getElementById("invFnombre").focus();
    return;
  }
  invAviso("Guardando en SQLite…");
  // Sin bloquear: si el núcleo está ocupado, el guardado espera solo y la
  // pantalla sigue respondiendo (antes se perdía el producto y salía «LENTO»).
  invApiTarde("guardar", { producto: producto }, { maxMs: 20000 }).then(function (r) {
    if (!r.ok) { invAviso("No se pudo guardar: " + (r.error || "error"), "error"); return; }
    const p = (r.data && r.data.producto) || {};
    invAviso("Guardado · " + (p.nombre || producto.nombre) + " · " + (p.codigo || producto.codigo));
    revision("inventario", "info", "producto guardado: " + (p.nombre || producto.nombre),
      (p.codigo || producto.codigo) + " · stock " + (p.stock || 0), 0, "core");
    invFormularioCerrar();
    invRefrescar();
    invSello("Guardado en la base");
  });
}

function invSello(texto) {
  const caja = document.getElementById("invGuardadoEstado");
  if (!caja) return;
  const sello = document.createElement("span");
  sello.className = "inv-sello";
  sello.textContent = "✓ " + texto;
  caja.textContent = "";
  caja.appendChild(sello);
  setTimeout(function () { if (sello.parentNode) sello.parentNode.removeChild(sello); }, 3200);
}

function invBorrar(codigo) {
  const p = invPorCodigo(codigo);
  if (!confirm("¿Borrar " + (p ? p.nombre : codigo) + " de tu inventario?")) return;
  invApiTarde("borrar", { codigo: codigo }).then(function (r) {
    if (!r.ok) { toast("No se pudo borrar: " + r.error, "error"); return; }
    revision("inventario", "aviso", "producto borrado", codigo);
    invRefrescar();
  });
}

function invMovimiento(codigo, tipo, cantidad) {
  invApiTarde("movimiento", { codigo: codigo, tipo: tipo, cantidad: cantidad, motivo: "ajuste rápido" })
    .then(function (r) {
      if (!r.ok) { toast("Stock: " + (r.error || "error"), "error"); return; }
      invRefrescar();
    });
}

/* ── paso 3 · precios ───────────────────────────────────────────────────── */

function invPintarSelectores() {
  ["invPrecioProducto", "invBoletaProducto"].forEach(function (id) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const anterior = sel.value;
    sel.innerHTML = INV.productos.length
      ? INV.productos.map(function (p) {
          return `<option value="${esc(p.codigo)}">${esc(p.nombre)} · ${invClp(p.precio)}</option>`;
        }).join("")
      : `<option value="">Sin productos</option>`;
    if (anterior && INV.productos.some(function (p) { return p.codigo === anterior; })) {
      sel.value = anterior;
    }
    if (!INV.sel && INV.productos.length) INV.sel = INV.productos[0].codigo;
    if (INV.sel && INV.productos.some(function (p) { return p.codigo === INV.sel; })) {
      sel.value = INV.sel;
    }
  });
}

function invPintarPrecios() {
  const caja = document.getElementById("invComparativa");
  if (!caja) return;
  const codigo = INV.sel || (document.getElementById("invPrecioProducto") || {}).value || "";
  if (!codigo) { caja.innerHTML = `<div class="inv-vacio">Elige un producto.</div>`; return; }
  caja.innerHTML = `<div class="inv-vacio">Leyendo precios…</div>`;
  invApiTarde("precios", { codigo: codigo }).then(function (r) {
    if (!r.ok) {
      caja.innerHTML = `<div class="inv-vacio">No se pudieron leer los precios.</div>`;
      return;
    }
    invPintarPreciosCon(codigo, r.data);
  });
}

/** Pinta la comparativa ya leída. Separado para no bloquear al pedirla. */
function invPintarPreciosCon(codigo, d) {
  const caja = document.getElementById("invComparativa");
  if (!caja) return;
  const p = invPorCodigo(codigo);
  const lista = d.precios || [];
  const filas = lista.length ? lista.map(function (x) {
    const mejor = d.mejor > 0 && x.precio === d.mejor;
    return `<tr class="${mejor ? "mejor" : ""}">
      <td>${esc(x.proveedor || "sin nombre")}</td>
      <td class="num">${invClp(x.precio)}</td>
      <td class="num">${mejor ? "mejor" : (d.mejor > 0 ? "+" + invClp(x.precio - d.mejor) : "—")}</td>
      <td>${esc(x.nota || "")}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="4">Sin precios registrados todavía.</td></tr>`;

  caja.innerHTML = `
    <div class="inv-comp-resumen">
      <div class="inv-comp-caja mejor"><span>Mejor precio</span><strong>${invClp(d.mejor)}</strong></div>
      <div class="inv-comp-caja"><span>Promedio</span><strong>${invClp(d.promedio)}</strong></div>
      <div class="inv-comp-caja"><span>Peor precio</span><strong>${invClp(d.peor)}</strong></div>
      <div class="inv-comp-caja"><span>Ahorro posible</span><strong>${invClp(d.ahorro)}</strong></div>
    </div>
    ${p ? `<p class="inv-ayuda">Tu costo actual en la base: ${invClp(p.costo)} · precio de venta ${invClp(p.precio)} · margen ${p.margen}%</p>` : ""}
    <div class="inv-tabla-scroll">
      <table class="inv-tabla">
        <thead><tr><th>Proveedor</th><th class="num">Precio</th><th class="num">Diferencia</th><th>Nota</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
}

function invPrecioAgregar() {
  const codigo = INV.sel || (document.getElementById("invPrecioProducto") || {}).value || "";
  const proveedor = document.getElementById("invPproveedor").value.trim();
  const precio = invNum(document.getElementById("invPprecio").value);
  const nota = document.getElementById("invPnota").value.trim();
  if (!codigo) { toast("Elige un producto", "error"); return; }
  if (precio <= 0) { toast("El precio debe ser mayor que 0", "error"); return; }
  invApiTarde("precio_agregar", { codigo: codigo, proveedor: proveedor, precio: precio, nota: nota })
    .then(function (r) {
      if (!r.ok) { toast("No se pudo guardar: " + r.error, "error"); return; }
      document.getElementById("invPprecio").value = "";
      document.getElementById("invPnota").value = "";
      invPintarPrecios();
      invSello("Precio agregado");
      revision("inventario", "info", "precio agregado", codigo + " · " + invClp(precio) + " · " + proveedor);
    });
}

/* ── paso 4 · márgenes y Excel ──────────────────────────────────────────── */

function invCalcularMargen() {
  const caja = document.getElementById("invCalcSalida");
  if (!caja) return;
  // Cada tecla disparaba una llamada BLOQUEANTE al núcleo: escribir un precio
  // de cuatro cifras congelaba la pantalla cuatro veces. Ahora hay un freno de
  // 140 ms y la respuesta llega en segundo plano.
  clearTimeout(INV.calcTimer);
  INV.calcTimer = setTimeout(function () {
    const costo = invNum(document.getElementById("invMcosto").value);
    const precio = invNum(document.getElementById("invMprecio").value);
    const objetivo = invNum(document.getElementById("invMobjetivo").value);
    const iva = invNum(document.getElementById("invMiva").value);
    invApiTarde("margen", { costo: costo, precio: precio, objetivo: objetivo, iva: iva }).then(function (r) {
      if (!r.ok) { caja.innerHTML = ""; return; }
      const d = r.data;
      caja.innerHTML = [
        `<div class="inv-comp-caja ${d.rentable ? "mejor" : ""}"><span>Utilidad</span><strong>${invClp(d.utilidad)}</strong></div>`,
        `<div class="inv-comp-caja"><span>Margen s/ venta</span><strong>${d.margen_venta}%</strong></div>`,
        `<div class="inv-comp-caja"><span>Markup s/ costo</span><strong>${d.markup}%</strong></div>`,
        `<div class="inv-comp-caja"><span>Precio con IVA</span><strong>${invClp(d.precio_con_iva)}</strong></div>`,
        objetivo > 0 ? `<div class="inv-comp-caja mejor"><span>Para ${objetivo}%</span><strong>${invClp(d.precio_sugerido)}</strong></div>` : ""
      ].join("");
    });
  }, 140);
}

function invPintarMargenes() {
  const caja = document.getElementById("invMargenesTabla");
  if (!caja) return;
  if (!INV.productos.length) {
    caja.innerHTML = `<div class="inv-vacio">Sin productos para calcular.</div>`;
    return;
  }
  const filas = INV.productos.map(function (p) {
    const alerta = p.precio <= 0 || p.margen < 15;
    return `<tr class="${alerta ? "mejor" : ""}">
      <td>${esc(p.nombre)}</td>
      <td class="num">${invClp(p.costo)}</td>
      <td class="num">${invClp(p.precio)}</td>
      <td class="num">${p.margen}%</td>
      <td class="num">${p.stock}</td>
      <td class="num">${invClp(p.costo * p.stock)}</td>
      <td class="num">${invClp(p.precio * p.stock)}</td>
    </tr>`;
  }).join("");
  caja.innerHTML = `
    <div class="inv-tabla-scroll">
      <table class="inv-tabla">
        <thead><tr>
          <th>Producto</th><th class="num">Costo</th><th class="num">Precio</th>
          <th class="num">Margen</th><th class="num">Stock</th>
          <th class="num">Valor costo</th><th class="num">Valor venta</th>
        </tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
}

function invExportar() {
  invApiTarde("exportar", {}, { maxMs: 20000 }).then(invExportarCon);
}

function invExportarCon(r) {
  if (!r.ok) { toast("No se pudo exportar: " + r.error, "error"); return; }
  const csv = "\uFEFF" + r.data.csv;   // BOM: Excel abre los acentos bien
  const nombre = "inventario-" + new Date().toISOString().slice(0, 10) + ".csv";
  let destino = "";
  try {
    if (window.FabrickNative && typeof window.FabrickNative.guardarArchivo === "function") {
      const g = JSON.parse(window.FabrickNative.guardarArchivo(nombre, csv));
      if (g && g.ok) destino = g.ruta || g.rutaCompleta || "";
    }
  } catch (e) {
    revision("inventario", "error", "no se pudo guardar el CSV", String(e));
  }
  if (!destino) {
    copiar(csv, "CSV copiado al portapapeles");
  } else {
    toast("Excel guardado: " + destino);
  }
  revision("inventario", "info", "inventario exportado", r.data.filas + " filas · " + destino);
}

/** Manda el contexto del inventario al chat (local o remoto, el que esté activo). */
function invPreguntarIA() {
  const d = INV.resumen || {};
  const bajos = INV.productos.filter(function (p) { return p.stock <= p.stock_minimo; });
  const sinPrecio = INV.productos.filter(function (p) { return p.precio <= 0; });
  const lineas = [
    "Contexto de mi inventario (no inventes datos que no estén aquí):",
    "Productos: " + (d.total || 0) + " · valor costo " + invClp(d.valor_costo) +
      " · valor venta " + invClp(d.valor_venta) + " · utilidad potencial " + invClp(d.utilidad_potencial),
    "Stock bajo (" + bajos.length + "): " + (bajos.slice(0, 8).map(function (p) {
      return p.nombre + " (" + p.stock + "/" + p.stock_minimo + ")";
    }).join(", ") || "ninguno"),
    "Sin precio (" + sinPrecio.length + "): " + (sinPrecio.slice(0, 8).map(function (p) { return p.nombre; }).join(", ") || "ninguno"),
    "Dime 3 acciones concretas para esta semana y qué producto me conviene reponer primero."
  ];
  const entrada = document.getElementById("chatEntrada");
  if (!entrada) { toast("El chat no está disponible", "error"); return; }
  entrada.value = lineas.join("\n");
  navegar("chat");
  toast("Contexto cargado en el chat; revisa y envía");
  revision("inventario", "info", "contexto enviado al chat", (d.total || 0) + " productos");
}

/* ── paso 5 · boleta ────────────────────────────────────────────────────── */

function invCarritoAgregar() {
  const sel = document.getElementById("invBoletaProducto");
  const codigo = (sel && sel.value) || INV.sel;
  const p = invPorCodigo(codigo);
  if (!p) { toast("Elige un producto", "error"); return; }
  const cant = Math.max(1, Math.round(invNum((document.getElementById("invBoletaCantidad") || {}).value || 1)));
  const existente = INV.carrito.find(function (x) { return x.codigo === p.codigo; });
  if (existente) existente.cantidad += cant;
  else INV.carrito.push({ codigo: p.codigo, nombre: p.nombre, precio: p.precio, cantidad: cant });
  invPintarCarrito();
  toast(p.nombre + " agregado");
}

function invPintarCarrito() {
  const caja = document.getElementById("invCarrito");
  const vista = document.getElementById("invBoletaVista");
  if (!caja) return;
  if (!INV.carrito.length) {
    caja.innerHTML = `<div class="inv-vacio">Carrito vacío.</div>`;
    if (vista) vista.innerHTML = `<div class="tk-vacio">${ico("carrito", 30)}<p>El carrito está vacío.<br>Agrega un producto para ver la boleta.</p></div>`;
    return;
  }
  caja.innerHTML = INV.carrito.map(function (x, i) {
    return `<div class="inv-carrito-item">
      <div class="inv-carrito-nom">
        <strong>${esc(x.nombre)}</strong>
        <span>${x.cantidad} × ${invClp(x.precio)}</span>
      </div>
      <span class="inv-carrito-sub">${invClp(x.precio * x.cantidad)}</span>
      <button class="inv-carrito-quitar" data-inv-quitar="${i}" aria-label="Quitar" title="Quitar">${ico("cerrar", 14)}</button>
    </div>`;
  }).join("");
  caja.querySelectorAll("[data-inv-quitar]").forEach(function (b) {
    b.addEventListener("click", function () {
      INV.carrito.splice(Number(b.dataset.invQuitar), 1);
      invPintarCarrito();
    });
  });

  const total = INV.carrito.reduce(function (a, x) { return a + x.precio * x.cantidad; }, 0);
  if (vista) {
    const pseudo = {
      folio: "—",
      fecha: Math.floor(Date.now() / 1000),
      cliente: (document.getElementById("invCliente") || {}).value || "",
      rut: (document.getElementById("invRut") || {}).value || "",
      pago: (document.getElementById("invPago") || {}).value || "efectivo",
      items: INV.carrito,
      neto: total - total / 1.19,
      iva: total - total / 1.19,
      total: total
    };
    vista.innerHTML = invTicketCuerpo(pseudo, { vista: true });
  }
}

/**
 * Cuerpo del ticket, compartido por la vista en pantalla y el documento de
 * impresión. Lleva identidad del negocio, folio, cliente, detalle con cantidad
 * y precio unitario, totales, código de barras del folio y «¡GRACIAS!».
 */
function invTicketCuerpo(b, opts) {
  const o = opts || {};
  const n = invNegocio();
  const fecha = new Date(((b.fecha || b.ts || Math.floor(Date.now() / 1000))) * 1000)
    .toLocaleString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const items = (b.items || []).map(function (x) {
    const cant = Number(x.cantidad || 1);
    const precio = Number(x.precio || 0);
    return `<div class="tk-item">
      <div class="tk-item-nom">${esc(x.nombre || x.codigo)}</div>
      <div class="tk-item-calc"><span>${cant} × ${invClp(precio)}</span><span>${invClp(precio * cant)}</span></div>
    </div>`;
  }).join("");
  const total = Number(b.total || 0);
  const neto = b.neto != null ? Number(b.neto) : total / 1.19;
  const iva = b.iva != null ? Number(b.iva) : total - neto;
  const logo = n.logo
    ? `<img class="tk-logo-img" src="${esc(n.logo)}" alt="" />`
    : `<div class="tk-logo">${esc((n.nombre || "F").slice(0, 1).toUpperCase())}</div>`;
  const lineas = [
    n.razon && n.razon !== n.nombre ? n.razon : "",
    n.rut ? "RUT " + n.rut : "",
    n.giro || "",
    n.direccion || "",
    n.telefono ? "Tel. " + n.telefono : "",
    n.email || ""
  ].filter(Boolean);

  return `<div class="tk">
    <div class="tk-cab">
      ${logo}
      <h3 class="tk-nombre">${esc(n.nombre)}</h3>
      ${lineas.map(function (x) { return `<p class="tk-dato">${esc(x)}</p>`; }).join("")}
    </div>
    <div class="tk-sep"></div>
    <div class="tk-fila tk-fuerte"><span>BOLETA</span><span>N° ${esc(b.folio)}</span></div>
    <div class="tk-fila"><span>${esc(fecha)}</span><span>${esc(b.pago || "efectivo")}</span></div>
    <div class="tk-fila"><span>${esc(b.cliente || "Consumidor final")}</span>${b.rut ? `<span>${esc(b.rut)}</span>` : ""}</div>
    <div class="tk-sep"></div>
    <div class="tk-cabecera-items"><span>Detalle</span><span>Subtotal</span></div>
    <div class="tk-items">${items || `<div class="tk-fila"><span>Sin productos</span><span>—</span></div>`}</div>
    <div class="tk-sep"></div>
    <div class="tk-fila"><span>Neto</span><span>${invClp(neto)}</span></div>
    <div class="tk-fila"><span>IVA 19%</span><span>${invClp(iva)}</span></div>
    <div class="tk-total"><span>TOTAL</span><span>${invClp(total)}</span></div>
    <div class="tk-sep"></div>
    <div class="tk-barras">${invBarrasSvg(o.vista ? "PREVIA" : b.folio, 34)}</div>
    <p class="tk-folio">${o.vista ? "vista previa · sin emitir" : "Folio " + esc(b.folio)}</p>
    <div class="tk-gracias">¡GRACIAS POR SU COMPRA!</div>
    <p class="tk-pie">Documento generado por FABRI-CORE<br />no es boleta tributaria electrónica</p>
  </div>`;
}

function invEmitirBoleta() {
  if (!INV.carrito.length) { toast("Agrega productos al carrito", "error"); return; }
  const payload = {
    cliente: (document.getElementById("invCliente") || {}).value || "",
    rut: (document.getElementById("invRut") || {}).value || "",
    pago: (document.getElementById("invPago") || {}).value || "efectivo",
    items: INV.carrito
  };
  invApiTarde("boleta_crear", payload, { maxMs: 20000 }).then(function (r) {
    if (!r.ok) { toast("No se pudo emitir: " + (r.error || "error"), "error"); return; }
    INV.boleta = r.data;
    revision("inventario", "info", "boleta emitida", "folio " + r.data.folio + " · " + invClp(r.data.total));
    // El carrito se vacía primero y la boleta se pinta después: si no, el
    // pintado del carrito vacío tapaba el ticket recién emitido.
    INV.carrito = [];
    invPintarCarrito();
    const vista = document.getElementById("invBoletaVista");
    if (vista) {
      vista.innerHTML = invTicketCuerpo(r.data, {});
      vista.classList.remove("imprimiendo");
      void vista.offsetWidth;
      vista.classList.add("imprimiendo");
    }
    try { sonidoImpresion(); } catch (e) {}
    invRefrescar();
    invBoletasHistorial();
    invSello("Boleta " + r.data.folio + " emitida");
  });
}

/**
 * Identidad del negocio para la boleta. Sale de la caché que mantiene la
 * página «Mi identidad»; si todavía no hay ficha, cae a FABRI-CORE para que
 * la boleta nunca salga en blanco.
 */
function invNegocio() {
  let c = {};
  try {
    c = (typeof idDeCache === "function") ? idDeCache() : {};
  } catch (e) { c = {}; }
  const d = c.datos || {};
  return {
    nombre: c.nombre || "FABRI-CORE",
    razon: d.razon_social || "",
    rut: d.rut || "",
    giro: d.giro || "",
    direccion: d.direccion || "",
    telefono: d.telefono || "",
    email: d.email || "",
    cliente: d.id_cliente || "",
    logo: d.logo || ""
  };
}

/** Documento completo listo para imprimir (rollo térmico o A4). */
function invBoletaDocumento(b, formato) {
  const fmt = formato || "80mm";
  const ancho = fmt === "a4" ? "190mm" : (fmt === "58mm" ? "50mm" : "72mm");
  const base = fmt === "a4" ? 13 : 11;
  const cuerpo = invTicketCuerpo(b, {});
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Boleta ${esc(b.folio)}</title>
    <style>
      @page { size: ${ancho} auto; margin: 0; }
      * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      html, body { margin: 0; padding: 0; background: #fff; color: #000; }
      body { font-family: "Courier New", ui-monospace, Menlo, monospace;
             font-size: ${base}px; line-height: 1.34; max-width: ${ancho};
             margin: 0 auto; padding: ${fmt === "a4" ? "12mm" : "3mm"}; }
      .tk { display: block; }
      .tk-cab { text-align: center; }
      .tk-logo { display: none; }
      .tk-logo-img { width: 14mm; height: 14mm; object-fit: contain;
                     display: block; margin: 0 auto 1mm; }
      .tk-nombre { font-size: ${base + 5}px; font-weight: 800; margin: 0 0 1mm;
                   letter-spacing: -0.01em; text-transform: uppercase; }
      .tk-dato { margin: 0; font-size: ${base - 1}px; color: #222; }
      .tk-sep { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }
      .tk-fila { display: flex; justify-content: space-between; gap: 4mm;
                 font-size: ${base}px; padding: 0.3mm 0; }
      .tk-fuerte { font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
      .tk-cabecera-items { display: flex; justify-content: space-between;
                 font-size: ${base - 1}px; text-transform: uppercase;
                 letter-spacing: 0.08em; color: #333; margin-bottom: 0.6mm; }
      .tk-items { display: block; }
      .tk-item { padding: 0.5mm 0; }
      .tk-item-nom { font-weight: 600; font-size: ${base}px; word-break: break-word; }
      .tk-item-calc { display: flex; justify-content: space-between; gap: 4mm;
                      font-size: ${base - 1}px; color: #333; }
      .tk-total { display: flex; justify-content: space-between; align-items: baseline;
                  font-size: ${base + 4}px; font-weight: 800;
                  border-top: 2px solid #000; border-bottom: 2px solid #000;
                  padding: 1mm 0; margin: 1mm 0; }
      .tk-barras { margin: 2.5mm auto 0; width: 78%; height: 10mm; }
      .tk-barras svg { width: 100%; height: 10mm; display: block; }
      .tk-folio { text-align: center; font-size: ${base - 1}px; letter-spacing: 0.14em;
                  margin: 1mm 0 0; text-transform: uppercase; }
      .tk-gracias { text-align: center; font-weight: 800; font-size: ${base + 2}px;
                    letter-spacing: 0.10em; margin: 2.5mm 0 1mm; }
      .tk-pie { text-align: center; font-size: ${base - 2}px; color: #333;
                margin: 1mm 0 0; line-height: 1.3; }
      .tk-vacio { display: none; }
    </style></head><body>${cuerpo}</body></html>`;
}

function invImprimir(formato, boleta) {
  const b = boleta || INV.boleta;
  if (!b) { toast("Emite una boleta primero", "error"); return; }
  const sel = document.getElementById("invFormatoImpresion");
  const fmt = formato || (sel && sel.value) || "80mm";
  // Animación del botón: spinner → check.
  const btnImprimir = document.getElementById("btnInvImprimir");
  if (btnImprimir) {
    btnImprimir.classList.add("btn-imprimiendo");
    btnImprimir.classList.remove("btn-listo");
  }
  try { sonidoImpresion(); } catch (e) {}
  const vista = document.getElementById("invBoletaVista");
  if (vista && vista.firstElementChild) {
    vista.classList.remove("imprimiendo");
    void vista.offsetWidth;
    vista.classList.add("imprimiendo");
  }
  const finalizarAnimacion = function (ok) {
    if (!btnImprimir) return;
    btnImprimir.classList.remove("btn-imprimiendo");
    if (ok) {
      btnImprimir.classList.add("btn-listo");
      setTimeout(function () { btnImprimir.classList.remove("btn-listo"); }, 1600);
    }
  };

  // 1) Impresora WiFi configurada: ESC/POS crudo, sin diálogo de Android.
  //    Sólo para rollo; A4 siempre va por el sistema.
  let imp = null;
  let cfgImp = null;
  try {
    imp = window.FabriImpresora || null;
    cfgImp = imp && typeof imp.config === "function" ? imp.config() : null;
  } catch (e) { imp = null; }
  if (imp && cfgImp && cfgImp.host && cfgImp.destino === "wifi" && fmt !== "a4") {
    try {
      const r = imp.imprimir(b, {
        negocio: invNegocio(),
        formato: fmt,
        ancho: fmt === "58mm" ? 32 : 48,
        corte: cfgImp.corte,
        silencioso: true
      });
      if (r && r.ok) {
        finalizarAnimacion(true);
        toast("Ticket enviado · " + r.bytes + " bytes · " + r.ms + " ms");
        revision("inventario", "info", "boleta impresa por WiFi",
          "folio " + b.folio + " · " + cfgImp.host + ":" + cfgImp.puerto + " · " + fmt);
        return;
      }
      const motivo = (r && r.error) || "no se pudo conectar";
      toast("WiFi: " + motivo + ". Abriendo el diálogo de Android…", "error");
      revision("inventario", "aviso", "impresión WiFi falló; se usa el diálogo",
        motivo + " · " + cfgImp.host + ":" + cfgImp.puerto);
    } catch (e) {
      revision("inventario", "error", "error al imprimir por WiFi", String(e));
    }
  }

  // 2) Diálogo de impresión de Android (o vista previa en navegador).
  const html = invBoletaDocumento(b, fmt);
  try {
    if (window.FabrickNative && typeof window.FabrickNative.imprimir === "function") {
      const r = JSON.parse(window.FabrickNative.imprimir(html, fmt));
      if (r && r.ok) {
        finalizarAnimacion(true);
        toast("Abriendo impresión (" + fmt + ")…");
        revision("inventario", "info", "boleta enviada a imprimir",
          "folio " + b.folio + " · " + fmt);
        return;
      }
      toast("Impresión: " + ((r && r.error) || "no disponible"), "error");
      return;
    }
  } catch (e) {
    revision("inventario", "error", "no se pudo abrir la impresión", String(e));
  }
  // Sin puente nativo (vista previa en navegador): se ofrece el HTML.
  copiar(html, "HTML de la boleta copiado");
}

function invBoletasHistorial() {
  const caja = document.getElementById("invBoletasHist");
  if (!caja) return;
  invApiTarde("boletas", { limite: 20 }).then(function (r) {
    if (!r.ok) { caja.innerHTML = ""; return; }
    invPintarBoletas((r.data && r.data.boletas) || []);
  });
}

function invPintarBoletas(lista) {
  const caja = document.getElementById("invBoletasHist");
  if (!caja) return;
  if (!lista.length) { caja.innerHTML = `<div class="inv-vacio">Sin boletas emitidas.</div>`; return; }
  caja.innerHTML = lista.map(function (b) {
    const fecha = new Date((b.ts || 0) * 1000).toLocaleString("es-CL");
    return `<article class="inv-item">
      <div class="inv-item-cab">
        <div><h4>Boleta N° ${esc(b.folio)}</h4><p>${esc(fecha)} · ${esc(b.cliente || "Consumidor final")}</p></div>
        <span class="inv-precio">${invClp(b.total)}</span>
      </div>
      <div class="inv-item-meta"><span class="inv-chip">${esc(b.estado)}</span>${b.rut ? `<span class="inv-chip">${esc(b.rut)}</span>` : ""}</div>
      <div class="inv-item-acciones">
        <button class="btn" data-inv-reimprimir="${esc(b.folio)}">Reimprimir</button>
      </div>
    </article>`;
  }).join("");
  caja.querySelectorAll("[data-inv-reimprimir]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const folio = Number(btn.dataset.invReimprimir);
      const b = lista.filter(function (x) { return Number(x.folio) === folio; })[0];
      if (b) invImprimir(null, b);
    });
  });
}

/* ── sincronización ─────────────────────────────────────────────────────── */

/**
 * Llama al inventario. En modo silencioso (reintento de fondo) no pasa por
 * `api()`: `api()` anota en `revision` cada fallo y un reintento sin red cada
 * minuto llenaría el registro y taparía el error original.
 */
function invCore(accion, extra, registrar) {
  if (registrar) return invApi(accion, extra);
  try {
    if (!window.FabrickNative) return { ok: false, error: "puente nativo no disponible" };
    const crudo = window.FabrickNative.call("inventario", JSON.stringify(Object.assign({ accion: accion }, extra || {})));
    return crudo ? JSON.parse(crudo) : { ok: false, error: "respuesta vacía del núcleo" };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/**
 * Envía los cambios pendientes a la nube. Devuelve {ok, enviados, motivo}.
 * `silencioso` evita los avisos de éxito y el ruido en el registro: lo usa el
 * reintento automático, que no debe interrumpir al usuario cada minuto.
 */
async function invSyncCorrer(silencioso) {
  const q = invCore("sync_pendientes", {}, !silencioso);
  if (!q.ok) {
    if (!silencioso) toast("Sync: " + (q.error || "error"), "error");
    return { ok: false, enviados: 0, motivo: q.error || "error" };
  }
  const pendientes = (q.data && q.data.productos) || [];
  if (!pendientes.length) {
    if (!silencioso) toast("Todo sincronizado: no hay cambios pendientes");
    return { ok: true, enviados: 0, motivo: "sin pendientes" };
  }
  if (!INV.nube.url) {
    // Sin nube configurada no se finge éxito: se exporta el lote y se explica.
    if (silencioso) return { ok: false, enviados: 0, motivo: "sin nube" };
    const nombre = "inventario-pendientes-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".json";
    let ruta = "";
    try {
      const g = JSON.parse(window.FabrickNative.guardarArchivo(nombre, JSON.stringify({ tabla: "inv_productos", productos: pendientes }, null, 2)));
      if (g && g.ok) ruta = g.ruta || g.rutaCompleta || "";
    } catch (e) { /* queda el aviso de abajo */ }
    toast(pendientes.length + " pendientes exportados" + (ruta ? ": " + ruta : "") + ". Configura la nube en Integración.");
    revision("inventario", "aviso", "sincronización sin nube: lote exportado", pendientes.length + " productos · " + ruta);
    return { ok: false, enviados: 0, motivo: "sin nube" };
  }
  try {
    // Contrato real de la nube: /api/inventario con `accion: "subir"` y
    // upsert por código. El endpoint viejo (`/inventario`) insertaba sin
    // actualizar y fallaba con la clave duplicada al reenviar.
    const base = INV.nube.url.replace(/\/+$/, "");
    const destino = /\/api\/inventario$/.test(base) ? base : base + "/api/inventario";
    const resp = await fetch(destino, {
      method: "POST",
      headers: Object.assign(
        { "Content-Type": "application/json" },
        INV.nube.token ? { "Authorization": "Bearer " + INV.nube.token } : {}
      ),
      body: JSON.stringify({ accion: "subir", productos: pendientes })
    });
    if (resp.status === 401) {
      throw new Error("el token de la nube fue rechazado (revisa Integración)");
    }
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const salida = await resp.json().catch(function () { return {}; });
    if (salida && salida.ok === false) {
      throw new Error(salida.error || "la nube rechazó el lote");
    }
    const codigos = pendientes.map(function (p) { return p.codigo; });
    const m = invCore("sync_marcar", { codigos: codigos }, !silencioso);
    if (!m.ok) throw new Error("no se pudieron marcar como sincronizados: " + (m.error || "error"));
    if (!silencioso) {
      toast(pendientes.length + " productos sincronizados");
      revision("inventario", "info", "sincronización con la nube", pendientes.length + " productos");
      invRefrescar();
    }
    return { ok: true, enviados: pendientes.length, motivo: "enviado" };
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    if (!silencioso) {
      toast("No se pudo sincronizar: " + msg, "error");
      revision("inventario", "error", "falló la sincronización", msg);
    }
    return { ok: false, enviados: 0, motivo: msg };
  }
}

/** Botón «Sincronizar»: camino visible, con sus avisos. */
function invSincronizar() {
  return invSyncCorrer(false);
}

/** Espera creciente entre reintentos automáticos (1, 2, 4… hasta 30 min). */
function invSyncEspera() {
  const s = INV.sync;
  if (s.fallos <= 0) return s.esperaBaseMs;
  return Math.min(s.esperaMaxMs, s.esperaBaseMs * Math.pow(2, s.fallos));
}

/** Un intento de fondo, sin solaparse con otro ni gastar batería en segundo plano. */
function invSyncAutomatica() {
  const s = INV.sync;
  if (s.enCurso) return;
  if (!INV.nube.url) return;          // sin nube no hay a dónde reintentar
  if (document.hidden) return;        // en segundo plano no se gasta red
  if (Date.now() - s.ultimoIntento < invSyncEspera()) return;

  s.enCurso = true;
  s.ultimoIntento = Date.now();
  invSyncCorrer(true).then(function (r) {
    if (r.ok) {
      const fallosAntes = s.fallos;
      s.fallos = 0;
      if (r.enviados) {
        invAviso(r.enviados + (r.enviados === 1 ? " cambio sincronizado" : " cambios sincronizados"), "");
        // Se registra la recuperación una sola vez, no en cada envío.
        if (fallosAntes > 0) {
          revision("inventario", "info", "sincronización recuperada",
            r.enviados + " productos tras " + fallosAntes + " intento(s) fallido(s)");
        }
        invRefrescar();
      }
    } else {
      s.fallos = Math.min(s.fallos + 1, 10);
    }
  }).catch(function (e) {
    s.fallos = Math.min(s.fallos + 1, 10);
    revision("inventario", "aviso", "reintento de sincronización falló", String(e));
  }).then(function () {
    s.enCurso = false;
  });
}

/** Arranca el reintento periódico una sola vez por sesión de página. */
function invSyncIniciar() {
  const s = INV.sync;
  if (s.timer) return;
  s.timer = setInterval(invSyncAutomatica, 60000);
  window.addEventListener("online", function () {
    s.ultimoIntento = 0;
    setTimeout(invSyncAutomatica, 1500);
  });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
      s.ultimoIntento = 0;
      setTimeout(invSyncAutomatica, 1200);
    }
  });
  // Primer intento al abrir el módulo, sin esperar al primer minuto.
  setTimeout(invSyncAutomatica, 2500);
}

/* ── lector de código de barras propio (EAN-13 · EAN-8 · UPC-A) ────────────
   El WebView de Android NO expone `BarcodeDetector` (es API del navegador
   Chrome, no del WebView). Sin lector, la cámara del inventario quedaba
   inservible y todo dependía de escribir el código a mano.

   Este decodificador trabaja sobre un fotograma de la propia cámara:
     1. dibuja el vídeo en un canvas reducido (640 px de ancho);
     2. pasa la banda central a escala de grises;
     3. recorre 18 líneas horizontales buscando tramos negro/blanco;
     4. localiza la guarda de inicio (1:1:1), decodifica 6 dígitos izquierdos
        (L o G según la paridad), la guarda central (01010) y 6 derechos;
     5. valida el dígito de control antes de devolver nada.

   Sin internet, sin binarios y sin permisos extra. Si no hay contraste o el
   código está borroso, devuelve cadena vacía y se sigue intentando.
   ───────────────────────────────────────────────────────────────────────── */

/* Patrones de 7 módulos (anchos de los 4 tramos). L y R comparten anchos;
   G es el juego «par» que codifica el primer dígito del EAN-13. */
const EAN_L = {
  "3211": 0, "2221": 1, "2122": 2, "1411": 3, "1132": 4,
  "1231": 5, "1114": 6, "1312": 7, "1213": 8, "3112": 9
};
const EAN_G = {
  "1123": 0, "1222": 1, "2212": 2, "1141": 3, "2311": 4,
  "1321": 5, "4111": 6, "2131": 7, "3121": 8, "2113": 9
};
/* Paridad de los 6 dígitos izquierdos según el primer dígito (0-9). */
const EAN_PARIDAD = [
  "LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG",
  "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"
];

/** Tramos (negro/blanco) de una línea de píxeles ya en gris. */
function invRunsDeFila(fila, ancho, umbral) {
  const runs = [];
  let negro = fila[0] < umbral ? 1 : 0;
  let largo = 0;
  for (let x = 0; x < ancho; x++) {
    const n = fila[x] < umbral ? 1 : 0;
    if (n === negro) {
      largo++;
    } else {
      runs.push({ negro: negro, largo: largo });
      negro = n;
      largo = 1;
    }
  }
  runs.push({ negro: negro, largo: largo });
  return runs;
}

/** Lee un dígito (4 tramos) y devuelve { digito, siguiente } o null. */
function invLeerDigito(runs, i, tabla, modulo) {
  if (i + 3 >= runs.length) return null;
  const anchos = [];
  let suma = 0;
  for (let k = 0; k < 4; k++) {
    const n = Math.round(runs[i + k].largo / modulo);
    if (n < 1 || n > 4) return null;
    anchos.push(n);
    suma += n;
  }
  if (suma !== 7) return null;
  const clave = anchos.join("");
  if (!Object.prototype.hasOwnProperty.call(tabla, clave)) return null;
  return { digito: tabla[clave], siguiente: i + 4 };
}

/** ¿Los próximos `n` tramos son una guarda de ~1 módulo cada uno? */
function invEsGuarda(runs, j, n, modulo) {
  if (j + n > runs.length) return false;
  for (let k = 0; k < n; k++) {
    if (Math.abs(runs[j + k].largo - modulo) > modulo * 0.8) return false;
  }
  return true;
}

/** Dígito de control EAN/UPC (pesos 3 y 1 desde la derecha). */
function invEanValido(codigo) {
  if (!/^(?:\d{8}|\d{12,13})$/.test(codigo)) return false;
  const d = codigo.split("").map(Number);
  const control = d.pop();
  let suma = 0;
  let peso = 3;
  for (let i = d.length - 1; i >= 0; i--) {
    suma += d[i] * peso;
    peso = peso === 3 ? 1 : 3;
  }
  return (10 - (suma % 10)) % 10 === control;
}

/** Intenta EAN-13 desde el primer dígito izquierdo. */
function invIntentarEan13(runs, j, modulo) {
  const izq = [];
  let paridad = "";
  for (let d = 0; d < 6; d++) {
    if (runs[j] && runs[j].negro) return "";
    const l = invLeerDigito(runs, j, EAN_L, modulo);
    if (l) { izq.push(l.digito); paridad += "L"; j = l.siguiente; continue; }
    const g = invLeerDigito(runs, j, EAN_G, modulo);
    if (g) { izq.push(g.digito); paridad += "G"; j = g.siguiente; continue; }
    return "";
  }
  if (!invEsGuarda(runs, j, 5, modulo)) return "";
  j += 5;
  const der = [];
  for (let d = 0; d < 6; d++) {
    if (!runs[j] || !runs[j].negro) return "";
    const r = invLeerDigito(runs, j, EAN_L, modulo);
    if (!r) return "";
    der.push(r.digito);
    j = r.siguiente;
  }
  if (!invEsGuarda(runs, j, 3, modulo)) return "";
  const primero = EAN_PARIDAD.indexOf(paridad);
  if (primero < 0) return "";
  const codigo = String(primero) + izq.join("") + der.join("");
  return invEanValido(codigo) ? codigo : "";
}

/** Intenta EAN-8 (4 + 4 dígitos, sin paridad). */
function invIntentarEan8(runs, j, modulo) {
  const izq = [];
  for (let d = 0; d < 4; d++) {
    if (runs[j] && runs[j].negro) return "";
    const l = invLeerDigito(runs, j, EAN_L, modulo);
    if (!l) return "";
    izq.push(l.digito);
    j = l.siguiente;
  }
  if (!invEsGuarda(runs, j, 5, modulo)) return "";
  j += 5;
  const der = [];
  for (let d = 0; d < 4; d++) {
    if (!runs[j] || !runs[j].negro) return "";
    const r = invLeerDigito(runs, j, EAN_L, modulo);
    if (!r) return "";
    der.push(r.digito);
    j = r.siguiente;
  }
  if (!invEsGuarda(runs, j, 3, modulo)) return "";
  const codigo = izq.join("") + der.join("");
  return invEanValido(codigo) ? codigo : "";
}

/** Busca un código en una línea: prueba cada posible guarda de inicio. */
function invEanDesdeRuns(runs) {
  for (let i = 0; i + 3 < runs.length; i++) {
    if (!runs[i].negro) continue;
    if (runs[i + 1].negro) continue;
    if (!runs[i + 2].negro) continue;
    const modulo = (runs[i].largo + runs[i + 1].largo + runs[i + 2].largo) / 3;
    if (modulo < 0.8) continue;
    // La guarda de inicio es 1:1:1: si los tres tramos no se parecen, no es.
    if (Math.abs(runs[i].largo - modulo) > modulo * 0.7) continue;
    if (Math.abs(runs[i + 1].largo - modulo) > modulo * 0.7) continue;
    if (Math.abs(runs[i + 2].largo - modulo) > modulo * 0.7) continue;
    const e13 = invIntentarEan13(runs, i + 3, modulo);
    if (e13) return e13;
    const e8 = invIntentarEan8(runs, i + 3, modulo);
    if (e8) return e8;
  }
  return "";
}

/** Toma un fotograma del vídeo y busca un código de barras en él. */
function invEscanearCuadro() {
  const video = document.getElementById("invVideo");
  if (!video || !video.videoWidth || !video.videoHeight) return "";
  const ancho = 640;
  const alto = Math.max(1, Math.round(video.videoHeight * ancho / video.videoWidth));
  let lienzo = INV.lienzo;
  if (!lienzo) {
    lienzo = document.createElement("canvas");
    INV.lienzo = lienzo;
  }
  lienzo.width = ancho;
  lienzo.height = alto;
  const ctx = lienzo.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "";
  ctx.drawImage(video, 0, 0, ancho, alto);

  // Banda central: es donde el usuario coloca el código dentro de la mira.
  const desde = Math.floor(alto * 0.22);
  const hasta = Math.floor(alto * 0.78);
  const altoBanda = Math.max(1, hasta - desde);
  const datos = ctx.getImageData(0, desde, ancho, altoBanda).data;

  const gris = new Uint8ClampedArray(ancho * altoBanda);
  for (let i = 0, p = 0; i < datos.length; i += 4, p++) {
    gris[p] = (datos[i] * 299 + datos[i + 1] * 587 + datos[i + 2] * 114) / 1000;
  }

  const lineas = 18;
  for (let k = 0; k < lineas; k++) {
    const y = Math.floor((k + 0.5) * altoBanda / lineas);
    const fila = gris.subarray(y * ancho, y * ancho + ancho);
    let min = 255;
    let max = 0;
    for (let x = 0; x < ancho; x++) {
      const v = fila[x];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (max - min < 45) continue;   // sin contraste no hay código que leer
    const umbral = (min + max) / 2;
    const codigo = invEanDesdeRuns(invRunsDeFila(fila, ancho, umbral));
    if (codigo) return codigo;
  }
  return "";
}

/* Prueba manual del decodificador (consola del teléfono o arnés en Node):
   `FabriEan.desdeRuns(FabriEan.runsDeCodigo("7801234567890"))`. */
window.FabriEan = {
  desdeRuns: invEanDesdeRuns,
  valido: invEanValido,
  runsDeCodigo: function (codigo) {
    // Genera los tramos de un código válido, útil para probar sin cámara.
    const L = { 0: "3211", 1: "2221", 2: "2122", 3: "1411", 4: "1132",
                5: "1231", 6: "1114", 7: "1312", 8: "1213", 9: "3112" };
    const G = { 0: "1123", 1: "1222", 2: "2212", 3: "1141", 4: "2311",
                5: "1321", 6: "4111", 7: "2131", 8: "3121", 9: "2113" };
    const modulos = [];
    function push(negro, n) { for (let i = 0; i < n; i++) modulos.push(negro); }
    function digitos(anchos, empiezaNegro) {
      for (let k = 0; k < 4; k++) push(empiezaNegro ? (k % 2 === 0 ? 1 : 0) : (k % 2 === 0 ? 0 : 1), anchos[k]);
    }
    let c = String(codigo).replace(/\D/g, "");
    if (c.length === 12) c = "0" + c;          // UPC-A se lee como EAN-13
    push(0, 9);                                 // zona de silencio
    push(1, 1); push(0, 1); push(1, 1);         // guarda de inicio 101
    if (c.length === 13) {
      const d = c.split("").map(Number);
      const paridad = EAN_PARIDAD[d[0]];
      for (let i = 0; i < 6; i++) {
        digitos(((paridad[i] === "L" ? L : G)[d[i + 1]]).split("").map(Number), false);
      }
      push(0, 1); push(1, 1); push(0, 1); push(1, 1); push(0, 1);
      for (let i = 7; i < 13; i++) digitos(L[d[i]].split("").map(Number), true);
    } else if (c.length === 8) {
      const d = c.split("").map(Number);
      for (let i = 0; i < 4; i++) digitos(L[d[i]].split("").map(Number), false);
      push(0, 1); push(1, 1); push(0, 1); push(1, 1); push(0, 1);
      for (let i = 4; i < 8; i++) digitos(L[d[i]].split("").map(Number), true);
    } else {
      return [];
    }
    push(1, 1); push(0, 1); push(1, 1);         // guarda de fin 101
    push(0, 9);
    const runs = [];
    let negro = modulos[0];
    let largo = 0;
    for (let i = 0; i < modulos.length; i++) {
      if (modulos[i] === negro) largo++;
      else { runs.push({ negro: negro, largo: largo }); negro = modulos[i]; largo = 1; }
    }
    runs.push({ negro: negro, largo: largo });
    return runs;
  }
};
