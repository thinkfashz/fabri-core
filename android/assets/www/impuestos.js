/* ==========================================================================
   FORGE CORE STOCK · Módulo Impuestos · F29
   --------------------------------------------------------------------------
   Estimación del Formulario 29 (IVA mensual) a partir del inventario:

     · Venta estimada  = valor de venta del stock (con IVA)
     · IVA débito      = ventas × 19/119
     · IVA crédito     = costo del stock × 19/119 (compras con factura)
     · IVA determinado = débito − crédito − remanente anterior
     · PPM             = ingresos brutos × tasa del régimen
     · Total a pagar   = IVA determinado + PPM

   Todo es una ESTIMACIÓN referencial para planificar caja. La declaración
   oficial se hace en sii.cl y el pago en tgr.cl. Los enlaces y la hoja de
   ruta están dentro del módulo.
   ========================================================================== */

const IMP = {
  activo: false,
  panel: null,
  periodo: "",
  ventasManual: null,
  tasaPpm: 0.2,
  remanente: 0,
  datos: null,
  animado: false
};

const IMP_FUENTES = [
  {
    titulo: "SII · Formulario 29",
    detalle: "Declaración mensual y pago simultáneo de impuestos (IVA, PPM y retenciones).",
    url: "https://www.sii.cl/destacados/f29/"
  },
  {
    titulo: "SII · Regímenes tributarios",
    detalle: "Pro Pyme Transparente (14 D N°8) y Pro Pyme General (14 D N°3): tasa de PPM y obligaciones.",
    url: "https://www.sii.cl/portales/regimen_tributario/"
  },
  {
    titulo: "SII · Servicios online",
    detalle: "Declarar y pagar el F29 con clave tributaria.",
    url: "https://www.sii.cl/servicios_online/"
  },
  {
    titulo: "Tesorería General de la República",
    detalle: "Pago de giros, convenios y comprobantes de pago.",
    url: "https://www.tgr.cl/"
  },
  {
    titulo: "ChileAtiende · Impuestos",
    detalle: "Guías oficiales paso a paso y requisitos.",
    url: "https://www.chileatiende.gob.cl/"
  }
];

const IMP_RUTA = [
  { t: "Cierra el mes de ventas", d: "Revisa boletas y facturas emitidas del período. En la app: Inventario → Boleta." },
  { t: "Junta las compras con factura", d: "Solo el IVA de compras con factura a tu RUT es crédito fiscal." },
  { t: "Calcula débito y crédito", d: "El módulo lo hace con tu stock; puedes reemplazar por tus ventas reales." },
  { t: "Declara el F29 en el SII", d: "Con clave tributaria, antes del día 20 del mes siguiente (o el plazo que fije el SII)." },
  { t: "Paga en Tesorería o banco", d: "Usa el comprobante que genera este módulo como respaldo del monto." },
  { t: "Guarda el respaldo", d: "Archiva el F29 y el comprobante de pago por al menos 6 años." }
];

/* ── utilidades ───────────────────────────────────────────────────────── */
function impClp(n) {
  const v = Math.round(Number(n || 0));
  return "$" + v.toLocaleString("es-CL");
}

function impPeriodoActual() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return d.getFullYear() + "-" + mm;
}

function impPeriodoLindo(p) {
  const partes = String(p || "").split("-");
  const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
                 "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const m = Number(partes[1]) - 1;
  return (meses[m] || "—") + " " + (partes[0] || "");
}

/** Día límite referencial del F29: 20 del mes siguiente. */
function impFechaLimite(periodo) {
  const [a, m] = String(periodo || "").split("-").map(Number);
  if (!a || !m) return "";
  const siguiente = m === 12 ? { a: a + 1, m: 1 } : { a: a, m: m + 1 };
  return "20/" + String(siguiente.m).padStart(2, "0") + "/" + siguiente.a;
}

/** Días que faltan para el vencimiento referencial. */
function impDiasRestantes(periodo) {
  const [a, m] = String(periodo || "").split("-").map(Number);
  if (!a || !m) return null;
  const limite = new Date(a, m, 20);   // mes siguiente (m es 0-based +1)
  const hoy = new Date();
  return Math.ceil((limite - hoy) / 86400000);
}

/* ── motor de cálculo ─────────────────────────────────────────────────── */
function impCalcular(d) {
  const iva = 0.19;
  const ventas = Math.max(0, Number(d.ventas || 0));
  const costos = Math.max(0, Number(d.costos || 0));
  const remanente = Math.max(0, Number(d.remanente || 0));
  const tasa = Math.max(0, Number(d.tasaPpm || 0)) / 100;

  const debito = Math.round(ventas * iva / (1 + iva));
  const credito = Math.round(costos * iva / (1 + iva));
  const creditoDisponible = credito + remanente;
  const determinado = Math.max(0, debito - creditoDisponible);
  const nuevoRemanente = Math.max(0, creditoDisponible - debito);
  const ppm = Math.round(ventas * tasa);
  const total = determinado + ppm;

  // Beneficio tributario aplicado: cuánto del crédito se usó en este período.
  const creditoUsado = Math.min(debito, creditoDisponible);
  const alivio = creditoUsado;
  const proporcionUsada = debito > 0 ? Math.min(1, creditoDisponible / debito) : 0;

  return {
    ventas, costos, debito, credito, remanente, creditoDisponible,
    determinado, nuevoRemanente, ppm, total, creditoUsado, alivio,
    proporcionUsada, tasaPpm: Number(d.tasaPpm || 0),
    utilidad: ventas - costos
  };
}

/* ── ciclo de vida ────────────────────────────────────────────────────── */
function impIniciar() {
  IMP.activo = true;
  if (!IMP.periodo) IMP.periodo = impPeriodoActual();
  const campo = document.getElementById("impPeriodo");
  if (campo && !campo.value) campo.value = IMP.periodo;
  const tasa = document.getElementById("impTasaPpm");
  if (tasa && !tasa.value) tasa.value = String(IMP.tasaPpm);
  const rem = document.getElementById("impRemanente");
  if (rem && !rem.value) rem.value = "0";
  impPintarRuta();
  impPintarFuentes();
  impCargar();
}

function impSalir() { IMP.activo = false; }

function impCargar() {
  if (typeof invApiTarde !== "function") return;
  invApiTarde("panel", {}, { maxMs: 12000 }).then(function (r) {
    if (!r.ok || !r.data || !r.data.ok) {
      impAviso("No pude leer el inventario: " + (r.error || "error"));
      return;
    }
    IMP.panel = r.data;
    impRecalcular();
  });
}

function impAviso(msg) {
  const el = document.getElementById("impAviso");
  if (el) el.textContent = msg || "";
}

/** Lee los campos, calcula y pinta todo. */
function impRecalcular() {
  const r = (IMP.panel && IMP.panel.resumen) || {};
  const manual = document.getElementById("impVentasManual");
  const valorManual = manual && String(manual.value).trim() !== ""
    ? Number(String(manual.value).replace(/[^\d]/g, ""))
    : null;

  const tasaEl = document.getElementById("impTasaPpm");
  const remEl = document.getElementById("impRemanente");
  const perEl = document.getElementById("impPeriodo");

  const ventas = valorManual != null ? valorManual : Number(r.valor_venta || 0);
  const costos = Number(r.valor_costo || 0);

  IMP.datos = impCalcular({
    ventas: ventas,
    costos: costos,
    remanente: remEl ? Number(String(remEl.value).replace(/[^\d]/g, "")) || 0 : 0,
    tasaPpm: tasaEl ? Number(tasaEl.value) || 0 : IMP.tasaPpm
  });
  IMP.periodo = perEl && perEl.value ? perEl.value : impPeriodoActual();

  impPintar(IMP.datos);
}

/* ── pintado ──────────────────────────────────────────────────────────── */
function impPintar(d) {
  const caja = document.getElementById("impKpis");
  if (caja) {
    caja.innerHTML =
      '<div class="imp-kpi"><span>IVA débito</span><b>' + impClp(d.debito) + '</b><small>ventas del giro</small></div>' +
      '<div class="imp-kpi ok"><span>IVA crédito</span><b>' + impClp(d.credito) + '</b><small>compras con factura</small></div>' +
      '<div class="imp-kpi ' + (d.determinado > 0 ? "alerta" : "ok") + '"><span>IVA determinado</span><b>' + impClp(d.determinado) + '</b><small>' +
        (d.determinado > 0 ? "a pagar" : "sin impuesto") + '</small></div>' +
      '<div class="imp-kpi"><span>PPM</span><b>' + impClp(d.ppm) + '</b><small>' + d.tasaPpm + ' % de ventas</small></div>' +
      '<div class="imp-kpi total"><span>Total estimado</span><b>' + impClp(d.total) + '</b><small>F29 del período</small></div>';
  }

  const resumen = document.getElementById("impResumen");
  if (resumen) {
    resumen.innerHTML =
      '<div class="imp-linea"><span>Ventas estimadas (con IVA)</span><b>' + impClp(d.ventas) + '</b></div>' +
      '<div class="imp-linea"><span>Costo del stock (con IVA)</span><b>' + impClp(d.costos) + '</b></div>' +
      '<div class="imp-linea"><span>Remanente anterior</span><b>' + impClp(d.remanente) + '</b></div>' +
      '<div class="imp-linea"><span>Crédito disponible</span><b>' + impClp(d.creditoDisponible) + '</b></div>' +
      '<div class="imp-linea grande"><span>Total a pagar estimado</span><b>' + impClp(d.total) + '</b></div>';
  }

  // Estado tipo semáforo
  const estado = document.getElementById("impEstado");
  if (estado) {
    let clase = "ok", texto = "Sin impuesto a pagar";
    if (d.total > 0 && d.total < 50000) { clase = "aviso"; texto = "Pago menor"; }
    else if (d.total >= 50000) { clase = "alerta"; texto = "Pago relevante"; }
    if (d.nuevoRemanente > 0) { clase = "ok"; texto = "Queda remanente a favor"; }
    estado.className = "imp-estado " + clase;
    estado.innerHTML = '<i></i><b>' + texto + '</b><small>Período ' + impPeriodoLindo(IMP.periodo) +
      ' · vence ' + impFechaLimite(IMP.periodo) + '</small>';
  }

  impPintarBarra(d);
  impPintarPlazo();
  impPintarComprobante(d);
}

/* Barra SVG de beneficios tributarios, animada. */
function impPintarBarra(d) {
  const svg = document.getElementById("impBarraSvg");
  if (!svg) return;
  const total = Math.max(1, d.debito);
  const pCredito = Math.min(100, (d.creditoUsado / total) * 100);
  const pPagar = Math.min(100, (d.determinado / total) * 100);

  const segCredito = svg.querySelector("#impSegCredito");
  const segPagar = svg.querySelector("#impSegPagar");
  const etqCredito = document.getElementById("impEtqCredito");
  const etqPagar = document.getElementById("impEtqPagar");
  const etqRem = document.getElementById("impEtqRemanente");

  if (etqCredito) etqCredito.textContent = impClp(d.creditoUsado);
  if (etqPagar) etqPagar.textContent = impClp(d.determinado);
  if (etqRem) etqRem.textContent = impClp(d.nuevoRemanente);

  // Se anima en el siguiente cuadro para que la transición CSS se vea.
  requestAnimationFrame(function () {
    if (segCredito) segCredito.setAttribute("width", String((pCredito / 100) * 300));
    if (segPagar) {
      segPagar.setAttribute("x", String((pCredito / 100) * 300));
      segPagar.setAttribute("width", String((pPagar / 100) * 300));
    }
  });

  const pct = document.getElementById("impBarraPct");
  if (pct) pct.textContent = Math.round(pCredito) + "% cubierto por crédito";
}

function impPintarPlazo() {
  const dias = impDiasRestantes(IMP.periodo);
  const el = document.getElementById("impPlazo");
  if (!el) return;
  if (dias == null) { el.textContent = ""; return; }
  if (dias < 0) el.innerHTML = "Plazo referencial vencido hace <b>" + Math.abs(dias) + "</b> días";
  else if (dias === 0) el.innerHTML = "Vence <b>hoy</b> (plazo referencial)";
  else el.innerHTML = "Faltan <b>" + dias + "</b> días para el plazo referencial";
}

/* Comprobante de pago estimado */
function impPintarComprobante(d) {
  const caja = document.getElementById("impComprobanteMonto");
  if (caja) caja.textContent = impClp(d.total);
}

function impComprobanteHtml() {
  const d = IMP.datos || impCalcular({});
  const rut = (document.getElementById("impRut") || {}).value || "";
  const nombre = (document.getElementById("impRazon") || {}).value || "";
  const banco = (document.getElementById("impBanco") || {}).value || "";
  const folio = (document.getElementById("impFolio") || {}).value || "";
  const per = impPeriodoLindo(IMP.periodo);
  return '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'body{font-family:monospace;padding:16px;font-size:12px;color:#111}' +
    'h1{font-size:15px;letter-spacing:1px;margin:0 0 4px}' +
    '.sub{font-size:10px;color:#555;margin-bottom:10px}' +
    'table{width:100%;border-collapse:collapse;margin-top:8px}' +
    'td{padding:3px 0;vertical-align:top}' +
    'td.r{text-align:right;font-weight:bold}' +
    '.tot{margin-top:10px;border-top:1px dashed #000;padding-top:6px;font-size:14px;font-weight:bold;display:flex;justify-content:space-between}' +
    '.pie{margin-top:12px;font-size:9px;color:#555;line-height:1.4}' +
    '</style></head><body>' +
    '<h1>COMPROBANTE DE PAGO · F29 (ESTIMADO)</h1>' +
    '<div class="sub">FORGE CORE STOCK · no es un documento del SII</div>' +
    '<table>' +
    '<tr><td>Razón social</td><td class="r">' + esc(nombre || "—") + '</td></tr>' +
    '<tr><td>RUT</td><td class="r">' + esc(rut || "—") + '</td></tr>' +
    '<tr><td>Período</td><td class="r">' + esc(per) + '</td></tr>' +
    '<tr><td>Folio interno</td><td class="r">' + esc(folio || "—") + '</td></tr>' +
    '<tr><td>Banco / medio</td><td class="r">' + esc(banco || "—") + '</td></tr>' +
    '</table>' +
    '<table>' +
    '<tr><td>IVA débito fiscal</td><td class="r">' + impClp(d.debito) + '</td></tr>' +
    '<tr><td>IVA crédito fiscal</td><td class="r">' + impClp(d.credito) + '</td></tr>' +
    '<tr><td>Remanente anterior</td><td class="r">' + impClp(d.remanente) + '</td></tr>' +
    '<tr><td>IVA determinado</td><td class="r">' + impClp(d.determinado) + '</td></tr>' +
    '<tr><td>PPM (' + d.tasaPpm + '%)</td><td class="r">' + impClp(d.ppm) + '</td></tr>' +
    '<tr><td>Remanente para el próximo mes</td><td class="r">' + impClp(d.nuevoRemanente) + '</td></tr>' +
    '</table>' +
    '<div class="tot"><span>TOTAL A PAGAR</span><span>' + impClp(d.total) + '</span></div>' +
    '<div class="pie">Estimación generada con el inventario de este teléfono. ' +
    'La declaración oficial se presenta en sii.cl y el pago se realiza en tgr.cl ' +
    'o en el banco autorizado. Verifica siempre los montos en el F29 oficial.</div>' +
    '</body></html>';
}

function impImprimir() {
  const html = impComprobanteHtml();
  if (window.FabrickNative && typeof window.FabrickNative.imprimir === "function") {
    try {
      const r = JSON.parse(window.FabrickNative.imprimir(html, "a4"));
      if (r && r.ok) { if (typeof toast === "function") toast("Comprobante enviado a imprimir"); return; }
    } catch (e) { /* sigue con el respaldo */ }
  }
  if (typeof toast === "function") toast("No hay impresora disponible: usa «Compartir».");
}

function impAbrir(url) {
  try {
    if (window.FabrickNative && typeof window.FabrickNative.abrirUrl === "function") {
      const r = JSON.parse(window.FabrickNative.abrirUrl(url));
      if (r && r.ok) return;
    }
  } catch (e) { /* sin puente */ }
  try { window.open(url, "_blank"); } catch (e) {
    if (typeof toast === "function") toast("No se pudo abrir el enlace.");
  }
}

/* ── pintado estático (hoja de ruta y fuentes) ────────────────────────── */
function impPintarRuta() {
  const caja = document.getElementById("impRuta");
  if (!caja || caja.dataset.listo) return;
  caja.dataset.listo = "1";
  caja.innerHTML = IMP_RUTA.map(function (p, i) {
    return '<li class="imp-paso"><span class="imp-paso-n">' + (i + 1) + '</span>' +
      '<div><b>' + esc(p.t) + '</b><p>' + esc(p.d) + '</p></div></li>';
  }).join("");
}

function impPintarFuentes() {
  const caja = document.getElementById("impFuentes");
  if (!caja || caja.dataset.listo) return;
  caja.dataset.listo = "1";
  caja.innerHTML = IMP_FUENTES.map(function (f) {
    return '<button class="imp-fuente" type="button" data-url="' + esc(f.url) + '">' +
      '<span class="imp-fuente-txt"><b>' + esc(f.titulo) + '</b><small>' + esc(f.detalle) + '</small></span>' +
      '<span class="imp-fuente-flecha">↗</span></button>';
  }).join("");
  caja.querySelectorAll("[data-url]").forEach(function (b) {
    b.addEventListener("click", function () { impAbrir(b.dataset.url); });
  });
}

/* ── eventos ──────────────────────────────────────────────────────────── */
(function impMontar() {
  document.addEventListener("click", function (ev) {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    if (t.closest("#btnImpImprimir")) { impImprimir(); return; }
    if (t.closest("#btnImpActualizar")) { impCargar(); return; }
    if (t.closest("#btnImpSii")) { impAbrir("https://www.sii.cl/destacados/f29/"); return; }
    if (t.closest("#btnImpTgr")) { impAbrir("https://www.tgr.cl/"); return; }
  });
  document.addEventListener("input", function (ev) {
    const id = ev.target && ev.target.id;
    if (id === "impVentasManual" || id === "impRemanente" || id === "impTasaPpm" ||
        id === "impPeriodo") {
      if (id === "impPeriodo") IMP.periodo = ev.target.value;
      impRecalcular();
    }
  });
  document.addEventListener("change", function (ev) {
    if (ev.target && ev.target.id === "impPeriodo") {
      IMP.periodo = ev.target.value;
      impRecalcular();
    }
  });
})();
