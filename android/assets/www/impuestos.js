/* ==========================================================================
   FORGE CORE STOCK · Módulo Impuestos · F29
   --------------------------------------------------------------------------
   Estimación del Formulario 29 (IVA mensual) a partir del inventario y de los
   cierres de caja del mes:

     · Ventas del período  = suma de boletas emitidas (o stock si no hay)
     · IVA débito          = ventas × 19/119
     · IVA crédito         = costo del stock × 19/119 (compras con factura)
     · IVA determinado     = débito − crédito − remanente anterior
     · PPM                 = ventas × tasa del régimen
     · Total a pagar       = IVA determinado + PPM

   Autocompleta razón social, RUT, giro y dirección desde «Mi identidad».
   Genera un borrador del F29 y un comprobante para imprimir o guardar en PDF.
   La declaración oficial se hace en sii.cl y el pago en tgr.cl.
   ========================================================================== */

const IMP = {
  activo: false,
  panel: null,
  perfil: null,
  boletas: [],
  periodo: "",
  modo: "auto",          // auto | stock | manual
  tasaPpm: 0.2,
  remanente: 0,
  datos: null,
  cargado: false
};

const IMP_FUENTES = [
  { titulo: "SII · Formulario 29", detalle: "Declaración mensual y pago simultáneo (IVA, PPM y retenciones).", url: "https://www.sii.cl/destacados/f29/" },
  { titulo: "SII · Regímenes tributarios", detalle: "Pro Pyme Transparente (14 D N°8) y General (14 D N°3): obligaciones y PPM.", url: "https://www.sii.cl/portales/regimen_tributario/" },
  { titulo: "SII · Servicios online", detalle: "Declarar y pagar el F29 con clave tributaria.", url: "https://www.sii.cl/servicios_online/" },
  { titulo: "Tesorería General de la República", detalle: "Pago de giros, convenios y comprobantes.", url: "https://www.tgr.cl/" },
  { titulo: "ChileAtiende · Impuestos", detalle: "Guías paso a paso y requisitos oficiales.", url: "https://www.chileatiende.gob.cl/" }
];

/* ── contenido educativo (lenguaje simple) ────────────────────────────── */
const IMP_EDU = [
  {
    icono: "documento",
    titulo: "¿Qué es el F29?",
    texto: "Es la declaración mensual de IVA. Se presenta al SII entre el día 1 y el 20 del mes siguiente, " +
      "aunque el sitio abre antes. Declara lo que vendiste, el IVA que cobraste y el que pagaste en compras."
  },
  {
    icono: "iva",
    titulo: "IVA débito y crédito",
    texto: "Débito es el IVA que cobras al vender. Crédito es el IVA que pagaste al comprar con factura. " +
      "Al SII le pagas la diferencia: débito menos crédito. Si el crédito es mayor, no pagas y queda a favor."
  },
  {
    icono: "sello",
    titulo: "Remanente de crédito",
    texto: "Si tu crédito supera al débito, esa diferencia no se pierde: se arrastra al mes siguiente. " +
      "En este módulo aparece como «remanente» y se descuenta solo."
  },
  {
    icono: "calendario",
    titulo: "PPM (pago provisional)",
    texto: "Es un adelanto mensual del impuesto a la renta. En Pro Pyme suele ser 0,2 % de las ventas. " +
      "Se declara junto al F29 y se descuenta después en la renta anual (F22)."
  },
  {
    icono: "libro",
    titulo: "¿Por qué importan tus boletas?",
    texto: "Cada boleta que emites en la app es una venta declarada. El módulo las suma por mes para " +
      "calcular el débito real, no una estimación."
  },
  {
    icono: "banco",
    titulo: "Cómo se paga",
    texto: "El F29 se paga en línea en el SII con clave tributaria, o con el giro en Tesorería o en un banco. " +
      "Guarda siempre el comprobante: es tu respaldo por 6 años."
  }
];

/* Formularios reales del SII (enlaces verificados) */
const IMP_FORMULARIOS = [
  {
    nombre: "F29 · IVA mensual",
    que: "Ventas, compras, IVA determinado, PPM y retenciones del mes.",
    cuando: "Todos los meses, hasta el día 20 del mes siguiente.",
    url: "https://www.sii.cl/servicios_online/1042-3264.html"
  },
  {
    nombre: "F50 · Declaración mensual",
    que: "Para contribuyentes de segunda categoría y rentas sin IVA.",
    cuando: "Mensual, según el calendario del SII.",
    url: "https://www.sii.cl/servicios_online/1042-3265.html"
  },
  {
    nombre: "F22 · Renta anual",
    que: "Resumen del año: rentas, gastos, PPM y créditos. Aquí se devuelve o se paga la diferencia.",
    cuando: "Una vez al año, en abril.",
    url: "https://www2.sii.cl/navegacionf22/"
  },
  {
    nombre: "F24 · Timbres y estampillas",
    que: "Impuesto a documentos y créditos (por ejemplo, cheques o pagarés).",
    cuando: "Mensual, cuando corresponda.",
    url: "https://www.sii.cl/servicios_online/1042-3744.html"
  },
  {
    nombre: "Boletas electrónicas",
    que: "Emisión y validación de boletas de ventas y servicios.",
    cuando: "En cada venta al público.",
    url: "https://www.sii.cl/servicios_online/3532-.html"
  },
  {
    nombre: "Registro de compras y ventas",
    que: "Detalle de documentos que respaldan el débito y el crédito fiscal.",
    cuando: "Mensual, antes de declarar el F29.",
    url: "https://www.sii.cl/servicios_online/1039-3256.html"
  }
];

const IMP_RUTA = [
  { t: "Cierra la caja de cada día", d: "Cada boleta emitida en Inventario queda como cierre del día; aquí se suman por mes." },
  { t: "Revisa compras con factura", d: "Sólo el IVA de compras con factura a tu RUT es crédito fiscal." },
  { t: "Confirma las cifras", d: "Usa los cierres reales o la proyección de stock; el módulo recalcula al instante." },
  { t: "Descarga el borrador", d: "Genera el F29 con tus datos y guárdalo en PDF desde el diálogo de impresión." },
  { t: "Declara en el SII", d: "Antes del día 20 del mes siguiente (o el plazo que fije el SII)." },
  { t: "Paga y archiva", d: "Paga en TGR o banco y guarda F29 + comprobante por 6 años." }
];

/* ── utilidades ───────────────────────────────────────────────────────── */
const IMP_ICO = {
  documento: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h6"/>',
  iva: '<path d="M12 2v20"/><path d="M17 6.5a4.5 4.5 0 0 0-4.5-2.5h-1a4 4 0 0 0 0 8h1a4 4 0 0 1 0 8h-1A4.5 4.5 0 0 1 7 17.5"/>',
  sello: '<circle cx="12" cy="9" r="6"/><path d="m9 14-1 8 4-2 4 2-1-8"/>',
  calendario: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/>',
  libro: '<path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z"/><path d="M8 7h8M8 11h8"/>',
  banco: '<path d="m3 10 9-6 9 6"/><path d="M5 10v9h14v-9"/><path d="M3 21h18"/>',
  calculo: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 7h8"/><path d="M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>',
  enlace: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>'
};

function impIcono(nombre, tam) {
  const d = IMP_ICO[nombre] || IMP_ICO.documento;
  const t = tam || 20;
  return '<svg viewBox="0 0 24 24" width="' + t + '" height="' + t +
    '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
}

function impClp(n) {
  const v = Math.round(Number(n || 0));
  return "$" + v.toLocaleString("es-CL");
}

function impPeriodoActual() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

function impPeriodoLindo(p) {
  const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
                 "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const [a, m] = String(p || "").split("-").map(Number);
  return (meses[m - 1] || "—") + " " + (a || "");
}

function impFechaLimite(periodo) {
  const [a, m] = String(periodo || "").split("-").map(Number);
  if (!a || !m) return "";
  const sig = m === 12 ? { a: a + 1, m: 1 } : { a: a, m: m + 1 };
  return "20/" + String(sig.m).padStart(2, "0") + "/" + sig.a;
}

function impDiasRestantes(periodo) {
  const [a, m] = String(periodo || "").split("-").map(Number);
  if (!a || !m) return null;
  const limite = new Date(a, m, 20);
  return Math.ceil((limite - new Date()) / 86400000);
}

function impMesDe(ts) {
  const t = Number(ts || 0);
  const ms = t > 1e12 ? t : t * 1000;         // algunos registros vienen en segundos
  const d = new Date(ms);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

function impFecha(ts) {
  const t = Number(ts || 0);
  const ms = t > 1e12 ? t : t * 1000;
  const d = new Date(ms);
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit" });
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
  const creditoUsado = Math.min(debito, creditoDisponible);

  return {
    ventas, costos, debito, credito, remanente, creditoDisponible,
    determinado, nuevoRemanente, ppm, total, creditoUsado,
    proporcionUsada: debito > 0 ? Math.min(1, creditoDisponible / debito) : 0,
    tasaPpm: Number(d.tasaPpm || 0),
    neto: Math.round(ventas / 1.19),
    utilidad: ventas - costos
  };
}

/* ── carga ────────────────────────────────────────────────────────────── */
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
  impPintarEducacion();
  impPintarFormularios();
  impCalculadora(0);
  impCargarTodo();
}

function impSalir() { IMP.activo = false; }

function impCargarTodo() {
  impCargarPerfil();
  impCargarBoletas();
  impCargarPanel();
}

function impAviso(msg) {
  const el = document.getElementById("impAviso");
  if (el) el.textContent = msg || "";
}

/** Relleno automático con los datos de «Mi identidad» (razón social, RUT…). */
function impCargarPerfil() {
  const caché = (function () {
    try { return JSON.parse(localStorage.getItem("fabrick.identidad") || "{}"); }
    catch (e) { return {}; }
  })();
  const pintar = function (p) {
    const d = (p && p.datos) || {};
    IMP.perfil = p || {};
    const set = function (id, v) {
      const el = document.getElementById(id);
      if (el && !el.value && v) el.value = v;
    };
    set("impRazon", d.nombre_comercial || (p && p.nombre) || "");
    set("impRut", d.rut || "");
    set("impGiro", d.giro || "");
    set("impDireccion", d.direccion || "");
  };
  pintar(caché);
  if (typeof apiTarde === "function") {
    apiTarde("perfil", { accion: "obtener" }, { maxMs: 12000 }).then(function (r) {
      if (r.ok && r.data) pintar(r.data);
    }).catch(function () {});
  }
}

/** Cierres de caja (boletas) para el resumen mensual. */
function impCargarBoletas() {
  if (typeof invApiTarde !== "function") return;
  invApiTarde("boletas", { limite: 200 }, { maxMs: 15000 }).then(function (r) {
    if (!r.ok || !r.data) return;
    IMP.boletas = r.data.boletas || [];
    impRecalcular();
  }).catch(function () {});
}

function impCargarPanel() {
  if (typeof invApiTarde !== "function") return;
  invApiTarde("panel", {}, { maxMs: 12000 }).then(function (r) {
    if (!r.ok || !r.data || !r.data.ok) {
      impAviso("No pude leer el inventario: " + (r.error || "error"));
      return;
    }
    IMP.panel = r.data;
    IMP.cargado = true;
    impRecalcular();
  });
}

/* ── recálculo ────────────────────────────────────────────────────────── */
function impVentasDelMes(periodo) {
  const del = (IMP.boletas || []).filter(function (b) {
    return impMesDe(b.ts) === periodo && String(b.estado || "emitida") !== "anulada";
  });
  const total = del.reduce(function (a, b) { return a + Number(b.total || 0); }, 0);
  const iva = del.reduce(function (a, b) { return a + Number(b.iva || 0); }, 0);
  const neto = del.reduce(function (a, b) { return a + Number(b.neto || 0); }, 0);
  return { lista: del, total: total, iva: iva, neto: neto, n: del.length };
}

function impRecalcular() {
  const r = (IMP.panel && IMP.panel.resumen) || {};
  const perEl = document.getElementById("impPeriodo");
  IMP.periodo = perEl && perEl.value ? perEl.value : (IMP.periodo || impPeriodoActual());

  const delMes = impVentasDelMes(IMP.periodo);
  const manual = document.getElementById("impVentasManual");
  const valorManual = manual && String(manual.value).trim() !== ""
    ? Number(String(manual.value).replace(/[^\d]/g, ""))
    : null;

  let ventas, fuente;
  if (valorManual != null) {
    ventas = valorManual;
    fuente = "manual";
  } else if (IMP.modo === "stock" || !delMes.n) {
    ventas = Number(r.valor_venta || 0);
    fuente = delMes.n ? "stock" : "stock (sin cierres del mes)";
  } else {
    ventas = delMes.total;
    fuente = delMes.n + " cierres de caja";
  }

  const tasaEl = document.getElementById("impTasaPpm");
  const remEl = document.getElementById("impRemanente");

  IMP.datos = impCalcular({
    ventas: ventas,
    costos: Number(r.valor_costo || 0),
    remanente: remEl ? Number(String(remEl.value).replace(/[^\d]/g, "")) || 0 : 0,
    tasaPpm: tasaEl ? Number(tasaEl.value) || 0 : IMP.tasaPpm
  });
  IMP.fuente = fuente;

  impPintar(IMP.datos, delMes);
}

/* ── pintado ──────────────────────────────────────────────────────────── */
function impPintar(d, delMes) {
  const caja = document.getElementById("impKpis");
  if (caja) {
    caja.innerHTML =
      '<div class="imp-kpi"><span>IVA débito</span><b>' + impClp(d.debito) + '</b><small>ventas del giro</small></div>' +
      '<div class="imp-kpi ok"><span>IVA crédito</span><b>' + impClp(d.credito) + '</b><small>compras con factura</small></div>' +
      '<div class="imp-kpi ' + (d.determinado > 0 ? "alerta" : "ok") + '"><span>IVA determinado</span><b>' + impClp(d.determinado) + '</b><small>' +
        (d.determinado > 0 ? "a pagar" : "sin impuesto") + '</small></div>' +
      '<div class="imp-kpi"><span>PPM</span><b>' + impClp(d.ppm) + '</b><small>' + d.tasaPpm + ' % de ventas</small></div>' +
      '<div class="imp-kpi total"><span>Total estimado</span><b>' + impClp(d.total) + '</b><small>' +
        esc(IMP.fuente || "") + '</small></div>';
  }

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

  const resumen = document.getElementById("impResumen");
  if (resumen) {
    resumen.innerHTML =
      '<div class="imp-linea"><span>Ventas del período (con IVA)</span><b>' + impClp(d.ventas) + '</b></div>' +
      '<div class="imp-linea"><span>Neto (sin IVA)</span><b>' + impClp(d.neto) + '</b></div>' +
      '<div class="imp-linea"><span>Costo del stock (con IVA)</span><b>' + impClp(d.costos) + '</b></div>' +
      '<div class="imp-linea"><span>Remanente anterior</span><b>' + impClp(d.remanente) + '</b></div>' +
      '<div class="imp-linea"><span>Crédito disponible</span><b>' + impClp(d.creditoDisponible) + '</b></div>' +
      '<div class="imp-linea grande"><span>Total a pagar estimado</span><b>' + impClp(d.total) + '</b></div>';
  }

  impPintarBarra(d);
  impPintarPlazo();
  impPintarCierres(delMes);
  impPintarFormulario(d);
  const monto = document.getElementById("impComprobanteMonto");
  if (monto) monto.textContent = impClp(d.total);
}

function impPintarBarra(d) {
  const svg = document.getElementById("impBarraSvg");
  if (!svg) return;
  const total = Math.max(1, d.debito);
  const pCredito = Math.min(100, (d.creditoUsado / total) * 100);
  const pPagar = Math.min(100, (d.determinado / total) * 100);
  const segCredito = svg.querySelector("#impSegCredito");
  const segPagar = svg.querySelector("#impSegPagar");
  const set = function (id, v) { const el = document.getElementById(id); if (el) el.textContent = impClp(v); };
  set("impEtqCredito", d.creditoUsado);
  set("impEtqPagar", d.determinado);
  set("impEtqRemanente", d.nuevoRemanente);
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

/** Tabla de cierres de caja del mes + total mensual. */
function impPintarCierres(delMes) {
  const caja = document.getElementById("impCierres");
  if (!caja) return;
  const lista = (delMes && delMes.lista) || [];
  if (!lista.length) {
    caja.innerHTML = '<div class="imp-vacio">Este mes no tiene boletas emitidas. ' +
      'Puedes usar la proyección de stock o escribir las ventas reales.</div>';
    return;
  }
  const filas = lista.slice(0, 40).map(function (b) {
    return '<tr>' +
      '<td>' + impFecha(b.ts) + '</td>' +
      '<td class="num">' + esc(String(b.folio || "")) + '</td>' +
      '<td class="num">' + impClp(b.neto) + '</td>' +
      '<td class="num">' + impClp(b.iva) + '</td>' +
      '<td class="num">' + impClp(b.total) + '</td>' +
      '</tr>';
  }).join("");
  caja.innerHTML =
    '<div class="imp-tabla-scroll"><table class="imp-tabla">' +
      '<thead><tr><th>Fecha</th><th class="num">Folio</th><th class="num">Neto</th><th class="num">IVA</th><th class="num">Total</th></tr></thead>' +
      '<tbody>' + filas + '</tbody>' +
    '</table></div>' +
    '<div class="imp-cierres-totales">' +
      '<span>' + lista.length + ' cierres</span>' +
      '<span>Neto <b>' + impClp(delMes.neto) + '</b></span>' +
      '<span>IVA <b>' + impClp(delMes.iva) + '</b></span>' +
      '<span>Total <b>' + impClp(delMes.total) + '</b></span>' +
    '</div>';
}

/** Borrador del F29 con los datos cargados. */
function impPintarFormulario(d) {
  const caja = document.getElementById("impFormulario");
  if (!caja) return;
  const razon = (document.getElementById("impRazon") || {}).value || "—";
  const rut = (document.getElementById("impRut") || {}).value || "—";
  const giro = (document.getElementById("impGiro") || {}).value || "—";
  const dir = (document.getElementById("impDireccion") || {}).value || "—";
  const fila = function (etq, valor, clase) {
    return '<div class="imp-fila-form ' + (clase || "") + '"><span>' + esc(etq) + '</span><b>' +
      (typeof valor === "number" ? impClp(valor) : esc(valor)) + '</b></div>';
  };
  caja.innerHTML =
    '<div class="imp-form-cab">' +
      '<div><small>Servicio de Impuestos Internos</small><b>Formulario 29 · borrador</b></div>' +
      '<span class="imp-form-per">' + esc(impPeriodoLindo(IMP.periodo)).toUpperCase() + '</span>' +
    '</div>' +
    '<div class="imp-form-datos">' +
      fila("Razón social", razon) +
      fila("RUT", rut) +
      fila("Giro", giro) +
      fila("Domicilio", dir) +
    '</div>' +
    '<div class="imp-form-cuerpo">' +
      '<h4>IVA débito fiscal</h4>' +
      fila("Ventas netas del giro", d.neto) +
      fila("IVA débito fiscal (19 %)", d.debito) +
      '<h4>IVA crédito fiscal</h4>' +
      fila("Compras con factura (con IVA)", d.costos) +
      fila("IVA crédito fiscal", d.credito) +
      fila("Remanente del período anterior", d.remanente) +
      '<h4>Determinación</h4>' +
      fila("IVA determinado", d.determinado, "destacada") +
      fila("Remanente para el próximo período", d.nuevoRemanente) +
      '<h4>Otros impuestos</h4>' +
      fila("PPM (" + d.tasaPpm + " %)", d.ppm) +
      '<div class="imp-form-total"><span>TOTAL A PAGAR</span><b>' + impClp(d.total) + '</b></div>' +
    '</div>' +
    '<p class="imp-form-nota">Borrador generado con tus datos y tus cierres de caja. ' +
      'Los códigos y casillas definitivos los asigna el F29 del SII al declarar.</p>';
}

function impPintarEducacion() {
  const caja = document.getElementById("impEdu");
  if (!caja || caja.dataset.listo) return;
  caja.dataset.listo = "1";
  caja.innerHTML = IMP_EDU.map(function (e) {
    return '<article class="imp-edu">' +
      '<span class="imp-edu-ico">' + impIcono(e.icono, 20) + '</span>' +
      '<b>' + esc(e.titulo) + '</b>' +
      '<p>' + esc(e.texto) + '</p></article>';
  }).join("");
}

function impPintarFormularios() {
  const caja = document.getElementById("impFormularios");
  if (!caja || caja.dataset.listo) return;
  caja.dataset.listo = "1";
  caja.innerHTML = IMP_FORMULARIOS.map(function (f) {
    return '<button class="imp-form-item" type="button" data-url="' + esc(f.url) + '">' +
      '<span class="imp-form-ico">' + impIcono("documento", 18) + '</span>' +
      '<span class="imp-form-txt">' +
        '<b>' + esc(f.nombre) + '</b>' +
        '<small>' + esc(f.que) + '</small>' +
        '<em>' + esc(f.cuando) + '</em>' +
      '</span>' +
      '<span class="imp-form-flecha">↗</span></button>';
  }).join("");
  caja.querySelectorAll("[data-url]").forEach(function (b) {
    b.addEventListener("click", function () { impAbrir(b.dataset.url); });
  });
}

/** Calculadora rápida con el mismo motor: monto con IVA → neto + IVA. */
function impCalculadora(valor) {
  const v = Math.max(0, Number(String(valor || "").replace(/[^\d]/g, "")) || 0);
  const neto = Math.round(v / 1.19);
  const iva = v - neto;
  const set = function (id, txt) { const el = document.getElementById(id); if (el) el.textContent = txt; };
  set("impCalcNeto", impClp(neto));
  set("impCalcIva", impClp(iva));
  set("impCalcTotal", impClp(v));
}

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

/* ── documentos ───────────────────────────────────────────────────────── */
function impDatosCabecera() {
  return {
    razon: (document.getElementById("impRazon") || {}).value || "",
    rut: (document.getElementById("impRut") || {}).value || "",
    giro: (document.getElementById("impGiro") || {}).value || "",
    dir: (document.getElementById("impDireccion") || {}).value || "",
    banco: (document.getElementById("impBanco") || {}).value || "",
    folio: (document.getElementById("impFolio") || {}).value || ""
  };
}

function impEstilosDocumento() {
  return '<style>' +
    'body{font-family:Helvetica,Arial,sans-serif;padding:22px;font-size:11.5px;color:#111}' +
    'h1{font-size:16px;margin:0}' +
    '.sub{font-size:9.5px;color:#666;margin:2px 0 14px}' +
    '.cab{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:12px}' +
    '.per{font-size:13px;font-weight:bold}' +
    'table{width:100%;border-collapse:collapse}' +
    'td,th{padding:5px 4px;border-bottom:1px solid #ddd;text-align:left}' +
    'th{font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#555}' +
    '.num{text-align:right;font-variant-numeric:tabular-nums}' +
    'h4{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#666;margin:14px 0 4px}' +
    '.dst{font-weight:bold}' +
    '.tot{margin-top:14px;border-top:2px solid #111;padding-top:8px;display:flex;justify-content:space-between;font-size:15px;font-weight:bold}' +
    '.nota{margin-top:14px;font-size:9px;color:#666;line-height:1.5}' +
    '</style>';
}

/** Descarga el borrador del F29 (diálogo de impresión → Guardar como PDF). */
function impDescargarFormulario() {
  const d = IMP.datos || impCalcular({});
  const c = impDatosCabecera();
  const fila = function (e, v, cls) {
    return '<tr class="' + (cls || "") + '"><td>' + esc(e) + '</td><td class="num">' + impClp(v) + '</td></tr>';
  };
  const html = '<!doctype html><html><head><meta charset="utf-8">' + impEstilosDocumento() + '</head><body>' +
    '<div class="cab"><div><h1>Formulario 29 · borrador</h1>' +
      '<div class="sub">Declaración mensual y pago simultáneo de impuestos</div></div>' +
      '<div class="per">' + esc(impPeriodoLindo(IMP.periodo)).toUpperCase() + '</div></div>' +
    '<table>' +
      '<tr><td>Razón social</td><td class="num">' + esc(c.razon || "—") + '</td></tr>' +
      '<tr><td>RUT</td><td class="num">' + esc(c.rut || "—") + '</td></tr>' +
      '<tr><td>Giro</td><td class="num">' + esc(c.giro || "—") + '</td></tr>' +
      '<tr><td>Domicilio</td><td class="num">' + esc(c.dir || "—") + '</td></tr>' +
    '</table>' +
    '<h4>IVA débito fiscal</h4><table>' +
      fila("Ventas netas del giro", d.neto) +
      fila("IVA débito fiscal (19 %)", d.debito) +
    '</table>' +
    '<h4>IVA crédito fiscal</h4><table>' +
      fila("Compras con factura (con IVA)", d.costos) +
      fila("IVA crédito fiscal", d.credito) +
      fila("Remanente del período anterior", d.remanente) +
    '</table>' +
    '<h4>Determinación</h4><table>' +
      fila("IVA determinado", d.determinado, "dst") +
      fila("Remanente para el próximo período", d.nuevoRemanente) +
    '</table>' +
    '<h4>Otros impuestos</h4><table>' +
      fila("PPM (" + d.tasaPpm + " %)", d.ppm) +
    '</table>' +
    '<div class="tot"><span>TOTAL A PAGAR</span><span>' + impClp(d.total) + '</span></div>' +
    '<div class="nota">Borrador generado por FORGE CORE STOCK con el inventario y los cierres de caja del teléfono. ' +
      'No es un documento del SII: la declaración oficial se presenta en sii.cl y el pago en tgr.cl. ' +
      'Verifica los montos y la tasa de PPM según tu régimen (Pro Pyme 14 D N°8 o N°3).</div>' +
    '</body></html>';
  impImprimirHtml(html);
}

function impImprimir() {
  const d = IMP.datos || impCalcular({});
  const c = impDatosCabecera();
  const html = '<!doctype html><html><head><meta charset="utf-8">' + impEstilosDocumento() + '</head><body>' +
    '<div class="cab"><div><h1>Comprobante de pago · F29 (estimado)</h1>' +
      '<div class="sub">FORGE CORE STOCK · respaldo interno del pago</div></div>' +
      '<div class="per">' + esc(impPeriodoLindo(IMP.periodo)).toUpperCase() + '</div></div>' +
    '<table>' +
      '<tr><td>Razón social</td><td class="num">' + esc(c.razon || "—") + '</td></tr>' +
      '<tr><td>RUT</td><td class="num">' + esc(c.rut || "—") + '</td></tr>' +
      '<tr><td>Folio interno</td><td class="num">' + esc(c.folio || "—") + '</td></tr>' +
      '<tr><td>Banco / medio</td><td class="num">' + esc(c.banco || "—") + '</td></tr>' +
    '</table>' +
    '<table>' +
      '<tr><td>IVA débito</td><td class="num">' + impClp(d.debito) + '</td></tr>' +
      '<tr><td>IVA crédito</td><td class="num">' + impClp(d.credito) + '</td></tr>' +
      '<tr><td>IVA determinado</td><td class="num">' + impClp(d.determinado) + '</td></tr>' +
      '<tr><td>PPM</td><td class="num">' + impClp(d.ppm) + '</td></tr>' +
    '</table>' +
    '<div class="tot"><span>TOTAL PAGADO</span><span>' + impClp(d.total) + '</span></div>' +
    '<div class="nota">Comprobante interno. El comprobante oficial lo emite el SII/TGR.</div>' +
    '</body></html>';
  impImprimirHtml(html);
}

function impImprimirHtml(html) {
  if (window.FabrickNative && typeof window.FabrickNative.imprimir === "function") {
    try {
      const r = JSON.parse(window.FabrickNative.imprimir(html, "a4"));
      if (r && r.ok) {
        if (typeof toast === "function") toast("Listo: elige «Guardar como PDF» o tu impresora");
        return;
      }
    } catch (e) { /* sin impresora */ }
  }
  if (typeof toast === "function") toast("No hay impresora disponible en este dispositivo.", "error");
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

/* ── eventos ──────────────────────────────────────────────────────────── */
(function impMontar() {
  document.addEventListener("click", function (ev) {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    if (t.closest("#btnImpPagar")) { impAbrir("https://www.sii.cl/destacados/f29/"); return; }
    if (t.closest("#btnImpDescargar")) { impDescargarFormulario(); return; }
    if (t.closest("#btnImpImprimir")) { impImprimir(); return; }
    if (t.closest("#btnImpTgr")) { impAbrir("https://www.tgr.cl/"); return; }
    if (t.closest("#btnImpActualizar")) { impCargarTodo(); return; }
    const modo = t.closest("[data-imp-modo]");
    if (modo) {
      IMP.modo = modo.dataset.impModo;
      document.querySelectorAll("[data-imp-modo]").forEach(function (b) {
        b.classList.toggle("activo", b.dataset.impModo === IMP.modo);
      });
      const manual = document.getElementById("impVentasManual");
      if (manual && IMP.modo !== "manual") manual.value = "";
      impRecalcular();
      return;
    }
  });
  document.addEventListener("input", function (ev) {
    const id = ev.target && ev.target.id;
    if (id === "impPeriodo") IMP.periodo = ev.target.value;
    if (id === "impCalcMonto") impCalculadora(ev.target.value);
    if (["impVentasManual", "impRemanente", "impTasaPpm", "impPeriodo",
         "impRazon", "impRut", "impGiro", "impDireccion"].indexOf(id) >= 0) {
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
