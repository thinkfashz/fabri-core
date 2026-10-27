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

/* ── paso 2 · productos ─────────────────────────────────────────────────── */

function invPintarProductos() {
  const caja = document.getElementById("invLista");
  if (!caja) return;
  const texto = (document.getElementById("invBuscar") || {}).value || "";
  const categoria = (document.getElementById("invFiltroCategoria") || {}).value || "";
  const free = (document.getElementById("invFiltroFree") || {}).value || "";
  const bajo = (document.getElementById("invSoloBajo") || {}).checked ? 1 : 0;

  const t = texto.trim().toLowerCase();
  let lista = INV.productos.filter(function (p) {
    if (categoria && p.categoria !== categoria) return false;
    if (free && (invFichaDe(p).etiquetas || []).indexOf(free) < 0) return false;
    if (bajo && !(p.stock <= p.stock_minimo)) return false;
    if (!t) return true;
    return (p.nombre + " " + p.marca + " " + p.codigo + " " + p.categoria).toLowerCase().indexOf(t) >= 0;
  });

  if (!lista.length) {
    caja.innerHTML = `<div class="inv-vacio">${INV.productos.length
      ? "Ningún producto coincide con el filtro."
      : "Todavía no hay productos. Escanea un código o crea uno con «Nuevo producto»."}</div>`;
    return;
  }

  caja.innerHTML = lista.map(function (p) {
    const bajoStock = p.stock <= p.stock_minimo;
    return `
      <article class="inv-item">
        <div class="inv-item-cab">
          <div>
            <h4>${esc(p.nombre)}</h4>
            <p>${esc(p.codigo)}${p.marca ? " · " + esc(p.marca) : ""}</p>
          </div>
          <span class="inv-precio">${invClp(p.precio)}</span>
        </div>
        <div class="inv-item-meta">
          <span class="inv-chip">${esc(INV_CATEGORIAS[p.categoria] || p.categoria)}</span>
          <span class="inv-chip ${bajoStock ? "lima" : ""}">stock ${p.stock}${bajoStock ? " · bajo" : ""}</span>
          <span class="inv-chip">costo ${invClp(p.costo)}</span>
          <span class="inv-chip">margen ${p.margen}%</span>
          ${(invFichaDe(p).etiquetas || []).map(function (id) {
            return `<span class="inv-chip lima">${esc(invFreeEtiqueta(id))}</span>`;
          }).join("")}
          ${invFichaDe(p).nutriscore
            ? `<span class="inv-chip">Nutri-Score ${esc(String(invFichaDe(p).nutriscore).toUpperCase())}</span>`
            : ""}
          ${p.pendiente_sync ? `<span class="inv-chip">sin sync</span>` : ""}
        </div>
        <div class="inv-item-acciones">
          <button class="btn" data-inv-editar="${esc(p.codigo)}">Editar</button>
          <button class="btn" data-inv-precios="${esc(p.codigo)}">Precios</button>
          <button class="btn" data-inv-mas="${esc(p.codigo)}">+1</button>
          <button class="btn" data-inv-menos="${esc(p.codigo)}">−1</button>
          <button class="btn" data-inv-carrito="${esc(p.codigo)}">A boleta</button>
          <button class="btn" data-inv-borrar="${esc(p.codigo)}">Borrar</button>
        </div>
      </article>`;
  }).join("");

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
    if (vista) vista.innerHTML = `<p class="inv-ayuda">El carrito está vacío.</p>`;
    return;
  }
  caja.innerHTML = INV.carrito.map(function (x, i) {
    return `<div class="inv-carrito-item">
      <span>${esc(x.nombre)} × ${x.cantidad}</span>
      <span>${invClp(x.precio * x.cantidad)} <button data-inv-quitar="${i}" aria-label="Quitar">×</button></span>
    </div>`;
  }).join("");
  caja.querySelectorAll("[data-inv-quitar]").forEach(function (b) {
    b.addEventListener("click", function () {
      INV.carrito.splice(Number(b.dataset.invQuitar), 1);
      invPintarCarrito();
    });
  });

  const total = INV.carrito.reduce(function (a, x) { return a + x.precio * x.cantidad; }, 0);
  const iva = total - total / 1.19;
  if (vista) {
    vista.innerHTML = `
      <h3>FABRI-CORE</h3>
      <div class="nota">Boleta pendiente de emitir</div>
      <hr />
      ${INV.carrito.map(function (x) {
        return `<div class="linea"><span>${esc(x.nombre)} × ${x.cantidad}</span><span>${invClp(x.precio * x.cantidad)}</span></div>`;
      }).join("")}
      <hr />
      <div class="linea"><span>Neto</span><span>${invClp(total / 1.19)}</span></div>
      <div class="linea"><span>IVA 19%</span><span>${invClp(iva)}</span></div>
      <div class="linea total"><span>Total</span><span>${invClp(total)}</span></div>`;
  }
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
    const vista = document.getElementById("invBoletaVista");
    if (vista) vista.innerHTML = invBoletaHtml(r.data, true);
    INV.carrito = [];
    invPintarCarrito();
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

function invBoletaHtml(b, imprimible) {
  const fecha = new Date((b.fecha || Math.floor(Date.now() / 1000)) * 1000)
    .toLocaleString("es-CL");
  const items = (b.items || []).map(function (x) {
    const cant = Number(x.cantidad || 1);
    return `<div class="linea"><span>${esc(x.nombre || x.codigo)} × ${cant}</span>
      <span>${invClp(Number(x.precio || 0) * cant)}</span></div>`;
  }).join("");
  const n = invNegocio();
  const logo = n.logo
    ? `<img src="${esc(n.logo)}" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:12px;display:block;margin:0 auto 6px" />`
    : "";
  const lineasNegocio = [
    n.razon ? esc(n.razon) : "",
    n.rut ? "RUT " + esc(n.rut) : "",
    n.giro ? esc(n.giro) : "",
    n.direccion ? esc(n.direccion) : "",
    n.telefono ? "Tel. " + esc(n.telefono) : "",
    n.email ? esc(n.email) : ""
  ].filter(Boolean).map(function (x) { return `<div class="nota">${x}</div>`; }).join("");
  return `
    ${logo}
    <h3>${esc(n.nombre)}</h3>
    ${lineasNegocio}
    ${n.cliente ? `<div class="nota">ID cliente: ${esc(n.cliente)}</div>` : ""}
    <hr />
    <div class="nota">Boleta N° ${esc(b.folio)} · ${esc(fecha)}</div>
    <div class="nota">${esc(b.cliente || "Consumidor final")}${b.rut ? " · " + esc(b.rut) : ""}</div>
    <div class="nota">Pago: ${esc(b.pago || "efectivo")}</div>
    <hr />
    ${items}
    <hr />
    <div class="linea"><span>Neto</span><span>${invClp(b.neto)}</span></div>
    <div class="linea"><span>IVA</span><span>${invClp(b.iva)}</span></div>
    <div class="linea total"><span>Total</span><span>${invClp(b.total)}</span></div>
    ${imprimible ? `<hr /><div class="nota">Documento generado por FABRI-CORE · no es boleta tributaria electrónica</div>` : ""}`;
}

/** Documento completo listo para imprimir (rollo térmico o A4). */
function invBoletaDocumento(b, formato) {
  const fmt = formato || "80mm";
  const ancho = fmt === "a4" ? "190mm" : (fmt === "58mm" ? "48mm" : "72mm");
  const base = fmt === "a4" ? 12 : 11;
  const fecha = new Date((b.fecha || b.ts || Math.floor(Date.now() / 1000)) * 1000)
    .toLocaleString("es-CL");
  const items = (b.items || []).map(function (x) {
    const cant = Number(x.cantidad || 1);
    return `<div class="linea"><span>${esc(x.nombre || x.codigo)} × ${cant}</span>
      <span>${invClp(Number(x.precio || 0) * cant)}</span></div>`;
  }).join("");
  const n = invNegocio();
  const logoDoc = n.logo
    ? `<img src="${esc(n.logo)}" alt="" style="width:22mm;height:22mm;object-fit:contain;display:block;margin:0 auto 2mm" />`
    : "";
  const lineasDoc = [
    n.razon ? esc(n.razon) : "",
    n.rut ? "RUT " + esc(n.rut) : "",
    n.giro ? esc(n.giro) : "",
    n.direccion ? esc(n.direccion) : "",
    n.telefono ? "Tel. " + esc(n.telefono) : "",
    n.email ? esc(n.email) : ""
  ].filter(Boolean).map(function (x) { return `<div class="nota">${x}</div>`; }).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
    <title>Boleta ${esc(b.folio)}</title>
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
    ${logoDoc}
    <h1>${esc(n.nombre)}</h1>
    ${lineasDoc}
    ${n.cliente ? `<div class="nota">ID cliente: ${esc(n.cliente)}</div>` : ""}
    <hr />
    <h2>Boleta N° ${esc(b.folio)}</h2>
    <div class="nota">${esc(fecha)}</div>
    <div class="nota">${esc(b.cliente || "Consumidor final")}${b.rut ? " · " + esc(b.rut) : ""}</div>
    <div class="nota">Pago: ${esc(b.pago || "efectivo")}</div>
    <hr />
    ${items}
    <hr />
    <div class="linea"><span>Neto</span><span>${invClp(b.neto)}</span></div>
    <div class="linea"><span>IVA</span><span>${invClp(b.iva)}</span></div>
    <div class="linea total"><span>Total</span><span>${invClp(b.total)}</span></div>
    <hr />
    <div class="pie">Documento generado por FABRI-CORE<br />no es boleta tributaria electrónica</div>
    </body></html>`;
}

function invImprimir(formato, boleta) {
  const b = boleta || INV.boleta;
  if (!b) { toast("Emite una boleta primero", "error"); return; }
  const sel = document.getElementById("invFormatoImpresion");
  const fmt = formato || (sel && sel.value) || "80mm";
  const html = invBoletaDocumento(b, fmt);
  // Animación del botón: spinner → check.
  const btnImprimir = document.getElementById("btnInvImprimir");
  if (btnImprimir) {
    btnImprimir.classList.add("btn-imprimiendo");
    btnImprimir.classList.remove("btn-listo");
  }
  const finalizarAnimacion = function (ok) {
    if (!btnImprimir) return;
    btnImprimir.classList.remove("btn-imprimiendo");
    if (ok) {
      btnImprimir.classList.add("btn-listo");
      setTimeout(function () { btnImprimir.classList.remove("btn-listo"); }, 1600);
    }
  };
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
