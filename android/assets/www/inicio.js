/* ==========================================================================
   FORGE CORE STOCK · portada del inicio
   --------------------------------------------------------------------------
   Todo lo que se ve aquí sale de datos REALES guardados en el SQLite del
   teléfono:

     · panel del inventario → productos, valor, utilidad, stock y márgenes
     · boletas emitidas     → ventas por día, ticket y más vendidos

   Estructura de la pantalla:

     1. portada   → título, subtítulo, chip de estado y fondo SVG animado
     2. KPIs      → cifras con conteo animado y micro-tendencias honestas
     3. ventas    → 14 días en SVG puro (barras + línea), sin librerías
     4. salud     → barra segmentada ok / bajo / agotado y productos a reponer
     5. listas    → categorías, margen y más vendidos con barras proporcionales

   Reglas de la casa:
     · ninguna llamada al puente durante la carga (todo va diferido);
     · si una llamada falla, esa tarjeta se explica sola y el resto sigue;
     · nunca se inventa un dato: sin datos se dice qué hacer para tenerlos;
     · con `prefers-reduced-motion` no hay movimiento, sólo contenido;
     · todo es SVG/CSS propio: ni CDN, ni fuentes, ni imágenes remotas.
   ========================================================================== */

var INICIO = {
  montado: false,
  cargando: false,
  revelado: false,
  panel: null,          // foto del inventario (accion: "panel")
  boletas: null,        // null = la llamada falló; [] = no hay boletas
  calc: null,
  actualizado: 0,
  tsPanel: 0,
  tsBoletas: 0,
  fallo: "",
  esqueleto: false,
  reintento: null,
  intentos: 0,
  reducido: null,
  obs: null
};

var IN_DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/* ── utilidades ─────────────────────────────────────────────────────────── */

/** ¿El sistema pidió menos movimiento? Se pregunta una sola vez. */
function inReducido() {
  if (INICIO.reducido === null) {
    try {
      INICIO.reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {
      INICIO.reducido = false;
    }
  }
  return INICIO.reducido;
}

/** Escape propio: no depende de helpers de app.js para pintar la portada. */
function inEsc(v) {
  return String(v === null || v === undefined ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inNum(n) {
  var v = Number(n);
  return isFinite(v) ? v : 0;
}

function inEntero(n) {
  var v = Math.round(inNum(n));
  try { return v.toLocaleString("es-CL"); } catch (e) { return String(v); }
}

/** Pesos completos con separador de miles chileno. */
function inPeso(n) {
  var v = Math.round(inNum(n));
  var signo = v < 0 ? "-" : "";
  try { return signo + "$" + Math.abs(v).toLocaleString("es-CL"); }
  catch (e) { return signo + "$" + Math.abs(v); }
}

/** Pesos compactos para tarjetas: $2,18 M en vez de $2.180.000. */
function inPesoCorto(n) {
  var v = Math.round(inNum(n));
  var signo = v < 0 ? "-" : "";
  var a = Math.abs(v);
  if (a >= 1e9) return signo + "$" + (a / 1e9).toFixed(2).replace(".", ",") + " MM";
  if (a >= 1e6) return signo + "$" + (a / 1e6).toFixed(2).replace(".", ",") + " M";
  return inPeso(v);
}

/** Para cifras grandes dentro de una tarjeta: evita que se desborde. */
function inPesoKpi(n) {
  return Math.abs(inNum(n)) >= 1e8 ? inPesoCorto(n) : inPeso(n);
}

/** Etiqueta diminuta de los gráficos: $48k / $1,2M. */
function inPesoMin(n) {
  var v = Math.round(inNum(n));
  var a = Math.abs(v);
  var signo = v < 0 ? "-" : "";
  if (a >= 1e6) return signo + "$" + (a / 1e6).toFixed(1).replace(".", ",") + "M";
  if (a >= 1e3) return signo + "$" + Math.round(a / 1e3) + "k";
  return signo + "$" + a;
}

/** Cifras de la portada: compactas para que las tres quepan en una fila. */
function inPesoMini(n) {
  var v = Math.round(inNum(n));
  var a = Math.abs(v);
  var signo = v < 0 ? "-" : "";
  if (a >= 1e6) return signo + "$" + (a / 1e6).toFixed(1).replace(".", ",") + " M";
  if (a >= 1e4) return signo + "$" + Math.round(a / 1e3) + "k";
  return inPeso(v);
}

function inPct(n, dec) {
  var v = inNum(n);
  var d = dec === undefined ? (Math.abs(v) >= 10 ? 0 : 1) : dec;
  var txt = v.toFixed(d);
  if (d > 0) txt = txt.replace(".", ",");
  return txt + "%";
}

function inFmt(tipo, v) {
  if (tipo === "entero") return inEntero(v);
  if (tipo === "pct") return inPct(v);
  if (tipo === "peso-corto") return inPesoCorto(v);
  return inPesoKpi(v);
}

/** Contador que sube desde 0. Si no hay motion, deja el valor final. */
function inContar(nodo, valor, tipo) {
  if (!nodo) return;
  var final = inFmt(tipo, valor);
  nodo.textContent = final;
  if (inReducido() || typeof requestAnimationFrame !== "function" || !isFinite(valor)) return;
  if (typeof cancelAnimationFrame === "function" && nodo._inRaf) cancelAnimationFrame(nodo._inRaf);
  var dur = 780;
  var t0 = null;
  function paso(t) {
    if (t0 === null) t0 = t;
    var p = Math.min(1, (t - t0) / dur);
    var e = 1 - Math.pow(1 - p, 3);
    nodo.textContent = inFmt(tipo, valor * e);
    if (p < 1) {
      nodo._inRaf = requestAnimationFrame(paso);
    } else {
      nodo._inRaf = 0;
      nodo.textContent = final;
    }
  }
  nodo._inRaf = requestAnimationFrame(paso);
}

/* Iconos: se usan los animados de marcas.js si están; si no, un respaldo
   propio con el mismo trazo para que la tarjeta nunca quede vacía. */
var IN_ICONOS_FALLBACK = {
  "chart-column": '<path d="M3 3v18h18"/><path d="M7 17v-4"/><path d="M12 17V7"/><path d="M17 17v-7"/>',
  "coins": '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="M16 8h1v4"/>',
  "receipt": '<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2V2l-3 2-3-2-3 2-3-2z"/><path d="M8 8h8"/><path d="M8 12h6"/>',
  "package-check": '<path d="M12 22V12"/><path d="M21 8v8a2 2 0 0 1-1 1.7l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.7l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z"/><path d="m9 12 2 2 4-4"/>',
  "store": '<path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/>',
  "percent": '<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  "tag": '<path d="M20.6 13.4 12 22 2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.5"/>',
  "shield-check": '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  "layers": '<path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  "shopping-cart": '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2 2h3l2.7 12.4a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 2-1.6L23 6H6"/>',
  "search": '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'
};

function inIcono(nombre, tam) {
  var t = tam || 18;
  var svg = "";
  try {
    if (typeof aniIcono === "function") svg = aniIcono(nombre, t);
  } catch (e) { svg = ""; }
  if (svg) return svg;
  var cuerpo = IN_ICONOS_FALLBACK[nombre] || IN_ICONOS_FALLBACK["package-check"];
  return '<svg viewBox="0 0 24 24" width="' + t + '" height="' + t + '" fill="none" ' +
    'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' + cuerpo + "</svg>";
}

/** Registro de un fallo de lectura, sin poder romper la portada. */
function inRevision(msg, detalle) {
  try {
    if (typeof revision === "function") revision("inicio", "error", msg, detalle || "", 0, "core");
  } catch (e) { /* la bitácora no puede tumbar la portada */ }
}

function inSeguro(fn, donde) {
  try { fn(); } catch (e) {
    try { if (typeof jsError === "function") jsError(e, donde); } catch (x) { /* sin registro */ }
  }
}

/** Llama al inventario en segundo plano (nunca bloquea el hilo de JavaScript). */
function inApi(accion, extra, maxMs) {
  if (typeof apiTarde !== "function") {
    return Promise.resolve({ ok: false, error: "puente no disponible" });
  }
  var payload = Object.assign({ accion: accion }, extra || {});
  try {
    return apiTarde("inventario", payload, { maxMs: maxMs || 15000 }).then(function (r) {
      if (!r.ok && r.codigo !== "LENTO" && r.codigo !== "NUCLEO_OCUPADO") {
        inRevision("inventario." + accion + " falló", String(r.error || ""));
      }
      return r;
    }).catch(function (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    });
  } catch (e) {
    return Promise.resolve({ ok: false, error: String(e) });
  }
}

/** Medianoche local de una fecha en ms (para agrupar ventas por día). */
function inDia0(ms) {
  var d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/* ── montaje de la estructura (todo dentro de #v-inicio) ────────────────── */

function inSvgFondo() {
  return '<svg class="in-fondo-svg" viewBox="0 0 400 320" preserveAspectRatio="xMidYMid slice" ' +
    'aria-hidden="true" focusable="false">' +
    "<defs>" +
      '<radialGradient id="inOrbA" cx="50%" cy="50%" r="50%">' +
        '<stop offset="0%" stop-color="#C8FF00" stop-opacity="0.30"/>' +
        '<stop offset="45%" stop-color="#C8FF00" stop-opacity="0.07"/>' +
        '<stop offset="100%" stop-color="#C8FF00" stop-opacity="0"/>' +
      "</radialGradient>" +
      '<radialGradient id="inOrbB" cx="50%" cy="50%" r="50%">' +
        '<stop offset="0%" stop-color="#8FCC00" stop-opacity="0.22"/>' +
        '<stop offset="55%" stop-color="#8FCC00" stop-opacity="0.04"/>' +
        '<stop offset="100%" stop-color="#8FCC00" stop-opacity="0"/>' +
      "</radialGradient>" +
      '<linearGradient id="inTrazo" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0%" stop-color="#C8FF00" stop-opacity="0"/>' +
        '<stop offset="45%" stop-color="#C8FF00" stop-opacity="0.65"/>' +
        '<stop offset="100%" stop-color="#C8FF00" stop-opacity="0"/>' +
      "</linearGradient>" +
      '<pattern id="inTrama" width="26" height="26" patternUnits="userSpaceOnUse">' +
        '<path d="M26 0H0V26" fill="none" stroke="rgba(255,255,255,0.045)" stroke-width="1"/>' +
      "</pattern>" +
    "</defs>" +
    '<rect width="400" height="320" fill="url(#inTrama)"/>' +
    '<g class="in-fondo-orbes">' +
      '<circle class="in-orbe o1" cx="74" cy="34" r="148" fill="url(#inOrbA)"/>' +
      '<circle class="in-orbe o2" cx="352" cy="262" r="156" fill="url(#inOrbB)"/>' +
    "</g>" +
    '<g class="in-fondo-lineas" fill="none" stroke="url(#inTrazo)" stroke-width="1.1">' +
      '<path class="in-linea l1" d="M-30 252 C 60 208, 128 276, 214 224 S 338 168, 432 198"/>' +
      '<path class="in-linea l2" d="M-30 214 C 70 176, 132 238, 208 190 S 330 132, 432 158"/>' +
      '<path class="in-linea l3" d="M-30 286 C 80 250, 140 306, 226 258 S 344 208, 432 234"/>' +
    "</g>" +
  "</svg>";
}

function inHoyEsqueleto() {
  var h = "";
  for (var i = 0; i < 3; i++) {
    h += '<div class="in-hoy-item"><span class="in-esq in-esq-et"></span>' +
      '<span class="in-esq in-esq-mini"></span></div>';
  }
  return h;
}

function inMontarHero(hero) {
  // 1) fondo SVG: reemplaza al canvas (menos RAM, mismo efecto)
  if (!hero.querySelector(".in-hero-fondo")) {
    var cv = document.getElementById("inHeroCanvas");
    if (cv) { cv.hidden = true; cv.style.display = "none"; }
    var fondo = document.createElement("div");
    fondo.className = "in-hero-fondo";
    fondo.id = "inHeroFondo";
    fondo.setAttribute("aria-hidden", "true");
    fondo.innerHTML = inSvgFondo();
    hero.insertBefore(fondo, hero.firstChild);
  }

  var cont = hero.querySelector(".in-hero-contenido");
  if (!cont) return;

  // 2) chip de estado en la fila de marca
  var marca = cont.querySelector(".in-hero-marca");
  if (marca && !document.getElementById("inChipEstado")) {
    var chip = document.createElement("span");
    chip.id = "inChipEstado";
    chip.className = "in-chip-estado in-chip-estado--espera";
    chip.innerHTML = '<i aria-hidden="true"></i><span>conectando</span>';
    marca.appendChild(chip);
  }

  // 3) portada propia: título grande + subtítulo + tres cifras de hoy
  var tituloLegacy = document.getElementById("heroTitulo");
  if (!document.getElementById("inPortadaIntro")) {
    var intro = document.createElement("div");
    intro.className = "in-portada-intro";
    intro.id = "inPortadaIntro";
    intro.innerHTML =
      '<h2 class="in-portada-titulo">Tu negocio,<br><em>en tiempo real.</em></h2>' +
      '<p class="in-portada-sub">Inventario, ventas y márgenes leídos directo del teléfono. ' +
        "Sin nube obligatoria, sin mensualidad.</p>" +
      '<div class="in-portada-hoy" id="inPortadaHoy">' + inHoyEsqueleto() + "</div>";
    if (tituloLegacy && tituloLegacy.parentNode === cont) {
      cont.insertBefore(intro, tituloLegacy);
    } else {
      var acciones = cont.querySelector(".in-acciones");
      if (acciones) cont.insertBefore(intro, acciones);
      else cont.appendChild(intro);
    }
  }

  // 4) el estado del núcleo (lo escribe app.js) pasa a una franja discreta
  var nucleo = document.getElementById("inNucleo");
  if (!nucleo) {
    nucleo = document.createElement("div");
    nucleo.className = "in-nucleo";
    nucleo.id = "inNucleo";
    if (tituloLegacy && tituloLegacy.parentNode === cont) cont.insertBefore(nucleo, tituloLegacy);
    else cont.appendChild(nucleo);
  }
  ["heroTitulo", "heroTexto", "heroDatos"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el && el.parentNode !== nucleo) nucleo.appendChild(el);
  });
}

function inTarjetaCab(titulo, chipId, chipInicial) {
  return '<div class="in-tarjeta-cab"><h4>' + inEsc(titulo) + "</h4>" +
    (chipId ? '<span class="in-chip-mini" id="' + chipId + '">' + inEsc(chipInicial || "—") + "</span>" : "") +
    "</div>";
}

function inMontarGraficos(v) {
  var graf = v.querySelector(".in-graficos");
  if (!graf) return;

  var elVentas = document.getElementById("inChartVentas");
  var elCat = document.getElementById("inChartCategorias");
  var elTop = document.getElementById("inChartTop");
  if (!elVentas || !elCat || !elTop) return;

  var cardVentas = elVentas.closest(".in-tarjeta");
  var cardCat = elCat.closest(".in-tarjeta");
  var cardTop = elTop.closest(".in-tarjeta");

  if (cardVentas) {
    cardVentas.classList.add("in-grafico-ancho");
    var h4v = cardVentas.querySelector("h4");
    if (h4v && !cardVentas.querySelector(".in-tarjeta-cab")) {
      var cabV = document.createElement("div");
      cabV.className = "in-tarjeta-cab";
      cardVentas.insertBefore(cabV, h4v);
      cabV.appendChild(h4v);
      var trend = document.createElement("span");
      trend.id = "inVentasTrend";
      trend.className = "in-chip-mini";
      cabV.appendChild(trend);
    }
    if (h4v) h4v.textContent = "Ventas por día";
  }

  // Salud del inventario: tarjeta nueva, justo debajo de ventas.
  if (!document.getElementById("inCardSalud")) {
    var salud = document.createElement("article");
    salud.className = "in-tarjeta in-grafico-ancho";
    salud.id = "inCardSalud";
    salud.innerHTML = inTarjetaCab("Salud del inventario", "inSaludChip", "—") +
      '<div class="in-salud" id="inSalud" aria-busy="true"></div>';
    if (cardVentas && cardVentas.parentNode) {
      cardVentas.parentNode.insertBefore(salud, cardVentas.nextSibling);
    } else {
      graf.appendChild(salud);
    }
  }

  if (cardCat) {
    var h4c = cardCat.querySelector("h4");
    if (h4c) h4c.textContent = "Top categorías";
    if (!elCat.classList.contains("in-chart--lista")) elCat.classList.add("in-chart--lista");
  }

  // Top margen: tarjeta nueva, al lado de categorías.
  if (!document.getElementById("inCardMargen")) {
    var margen = document.createElement("article");
    margen.className = "in-tarjeta";
    margen.id = "inCardMargen";
    margen.innerHTML = inTarjetaCab("Top margen", "inMargenChip", "—") +
      '<div class="in-lista" id="inTopMargen" aria-busy="true"></div>' +
      '<p class="in-pie" id="inTopMargenPie"></p>';
    if (cardCat && cardCat.parentNode) {
      cardCat.parentNode.insertBefore(margen, cardCat.nextSibling);
    } else {
      graf.appendChild(margen);
    }
  }

  if (cardTop) {
    cardTop.classList.add("in-grafico-ancho");
    var h4t = cardTop.querySelector("h4");
    if (h4t) h4t.textContent = "Más vendidos · 30 días";
    if (!elTop.classList.contains("in-chart--lista")) elTop.classList.add("in-chart--lista");
  }
}

function inicioMontar() {
  if (INICIO.montado) return;
  var v = document.getElementById("v-inicio");
  if (!v) return;

  var hero = v.querySelector(".in-hero");
  if (hero) inSeguro(function () { inMontarHero(hero); }, "inMontarHero");
  inSeguro(function () { inMontarGraficos(v); }, "inMontarGraficos");

  // Etiquetas de sección: un poco de contexto sin tocar el HTML base.
  var nota = document.getElementById("inDatosNota");
  if (nota) nota.setAttribute("aria-live", "polite");

  INICIO.montado = true;

  // Si nunca ha llegado una lectura, se muestran esqueletos, no un spinner.
  if (!INICIO.actualizado) inicioEsqueleto();
}

/* ── esqueletos de precarga ─────────────────────────────────────────────── */

function inEsqBarras() {
  var alturas = [42, 68, 34, 80, 55, 72, 46, 62, 38, 74, 52, 66, 44, 58];
  var h = "";
  for (var i = 0; i < alturas.length; i++) {
    h += '<span class="in-esq-barra" style="height:' + alturas[i] + '%"></span>';
  }
  return '<div class="in-esq-grafico" aria-hidden="true">' + h + "</div>";
}

function inEsqLista(n) {
  var h = "";
  for (var i = 0; i < (n || 4); i++) {
    h += '<div class="in-esq-fila" aria-hidden="true">' +
      '<span class="in-esq in-esq-linea"></span>' +
      '<span class="in-esq in-esq-barra-larga" style="width:' + (88 - i * 13) + '%"></span></div>';
  }
  return h;
}

function inicioEsqueleto() {
  if (INICIO.esqueleto) return;
  INICIO.esqueleto = true;
  var k = document.getElementById("inKpis");
  if (k) {
    var hk = "";
    for (var i = 0; i < 6; i++) {
      hk += '<article class="in-kpi in-kpi--esq" aria-hidden="true">' +
        '<span class="in-esq in-esq-ico"></span>' +
        '<span class="in-esq in-esq-et"></span>' +
        '<span class="in-esq in-esq-val"></span>' +
        '<span class="in-esq in-esq-sub"></span></article>';
    }
    k.innerHTML = hk;
    k.setAttribute("aria-busy", "true");
  }
  var v = document.getElementById("inChartVentas");
  if (v) { v.innerHTML = inEsqBarras(); v.setAttribute("aria-busy", "true"); }
  var s = document.getElementById("inSalud");
  if (s) {
    s.innerHTML = '<span class="in-esq in-esq-barra"></span>' +
      '<div class="in-esq-leyenda">' +
        '<span class="in-esq in-esq-mini"></span><span class="in-esq in-esq-mini"></span>' +
        '<span class="in-esq in-esq-mini"></span>' +
      "</div>" + inEsqLista(2);
    s.setAttribute("aria-busy", "true");
  }
  var c = document.getElementById("inChartCategorias");
  if (c) { c.innerHTML = inEsqLista(5); c.setAttribute("aria-busy", "true"); }
  var m = document.getElementById("inTopMargen");
  if (m) { m.innerHTML = inEsqLista(5); m.setAttribute("aria-busy", "true"); }
  var t = document.getElementById("inChartTop");
  if (t) { t.innerHTML = inEsqLista(5); t.setAttribute("aria-busy", "true"); }
  var ph = document.getElementById("inPortadaHoy");
  if (ph) ph.innerHTML = inHoyEsqueleto();
}

/* ── carga de datos ─────────────────────────────────────────────────────── */

/** Recarga la portada. Idempotente: se puede llamar cuantas veces haga falta. */
function inicioRefrescar(manual) {
  if (!INICIO.montado) inicioMontar();

  var nota = document.getElementById("inDatosNota");
  if (INICIO.cargando) return Promise.resolve();

  // Con datos frescos no hace falta volver a golpear el núcleo (ni repintar:
  // app.js llama a esto cada vez que cambian los contadores de tokens).
  if (!manual && INICIO.actualizado && Date.now() - INICIO.actualizado < 25000) {
    return Promise.resolve();
  }

  if (typeof nucleoPreparado === "function" && !nucleoPreparado()) {
    INICIO.intentos++;
    inEstado("núcleo abriendo", "espera");
    if (nota) nota.textContent = "El núcleo está abriendo la base de datos: los datos aparecen en un momento.";
    if (!INICIO.actualizado) inicioEsqueleto();
    if (INICIO.intentos < 40) {
      if (!INICIO.reintento) {
        INICIO.reintento = setTimeout(function () {
          INICIO.reintento = null;
          var vista = "inicio";
          try { vista = estadoApp.vista; } catch (e) { /* sin estado */ }
          if (vista === "inicio") inicioRefrescar(manual);
        }, 700);
      }
    } else {
      inEstado("sin datos", "error");
      if (nota) nota.textContent = "El núcleo no terminó de abrir. Revisa «Diagnóstico» y vuelve a intentar.";
    }
    return Promise.resolve();
  }

  INICIO.intentos = 0;
  if (INICIO.reintento) { clearTimeout(INICIO.reintento); INICIO.reintento = null; }
  INICIO.cargando = true;
  inEstado("leyendo datos", "espera");
  if (nota) nota.textContent = "Leyendo el inventario y las boletas guardadas en el teléfono…";
  var boton = document.getElementById("btnInicioRefrescar");
  if (manual && boton) { boton.disabled = true; boton.textContent = "Actualizando…"; }

  var pPanel = inApi("panel", {}, 14000);
  var pBoletas = inApi("boletas", { limite: 60 }, 14000);

  return Promise.all([pPanel, pBoletas]).then(function (res) {
    var rPanel = res[0] || {};
    var rBol = res[1] || {};

    var okPanel = !!(rPanel.ok && rPanel.data && rPanel.data.ok !== false);
    var okBol = !!(rBol.ok && rBol.data && Array.isArray(rBol.data.boletas));

    if (okPanel) { INICIO.panel = rPanel.data; INICIO.tsPanel = Date.now(); }
    if (okBol) { INICIO.boletas = rBol.data.boletas; INICIO.tsBoletas = Date.now(); }
    if (okPanel || okBol) { INICIO.actualizado = Date.now(); INICIO.fallo = ""; }

    if (!okPanel && !okBol) {
      inEstado("sin datos", "error");
      INICIO.fallo = "No se pudo leer el inventario: " +
        (rPanel.error || rBol.error || "el núcleo no respondió") +
        ". Puedes seguir usando la app; vuelve a intentar cuando el núcleo esté libre.";
      if (nota) nota.textContent = INICIO.fallo;
    }

    inicioPintar();

    return { panel: okPanel, boletas: okBol };
  }).catch(function (e) {
    inEstado("sin datos", "error");
    INICIO.fallo = "No se pudieron leer los datos: " +
      (e && e.message ? e.message : "error inesperado") + ".";
    if (nota) nota.textContent = INICIO.fallo;
  }).then(function () {
    INICIO.cargando = false;
    var b2 = document.getElementById("btnInicioRefrescar");
    if (b2) { b2.disabled = false; b2.textContent = "Actualizar"; }
  });
}

/* ── cálculo de las cifras ──────────────────────────────────────────────── */

function inCalcular() {
  var p = INICIO.panel || {};
  var res = p.resumen || {};
  var ven = p.ventas || {};
  var v30 = ven.ultimos_30d || {};
  var bol = INICIO.boletas || [];
  var hoy0 = inDia0(Date.now());

  var dias = [];
  for (var i = 13; i >= 0; i--) {
    var ms = hoy0 - i * 86400000;
    dias.push({ ms: ms, fecha: new Date(ms), total: 0, n: 0, esHoy: i === 0 });
  }

  var hoy = { total: 0, n: 0, unidades: 0 };
  var ayer = { total: 0, n: 0 };
  var d7 = { total: 0, n: 0, unidades: 0 };
  var p7 = { total: 0, n: 0 };
  var d30 = { total: 0, n: 0 };

  (Array.isArray(bol) ? bol : []).forEach(function (b) {
    var t = inNum(b.total);
    var ts = inNum(b.ts) * 1000;
    if (!ts) return;
    var dia = inDia0(ts);
    var dif = Math.round((hoy0 - dia) / 86400000);

    if (dif < 0) return; // fechas futuras: no se grafican ni suman

    if (dif === 0) { hoy.total += t; hoy.n++; }
    if (dif === 1) { ayer.total += t; ayer.n++; }
    if (dif < 7) { d7.total += t; d7.n++; }
    if (dif >= 7 && dif < 14) { p7.total += t; p7.n++; }
    if (dif < 30) { d30.total += t; d30.n++; }

    for (var k = 0; k < dias.length; k++) {
      if (dias[k].ms === dia) { dias[k].total += t; dias[k].n++; break; }
    }
  });

  // Ticket de 30 días: el del panel es exacto; si no llegó, se estima con
  // las boletas leídas (y se dice en la nota cuando corresponde).
  var ticket = 0;
  var ticketN = 0;
  if (inNum(v30.n) > 0) {
    ticket = inNum(v30.total) / inNum(v30.n);
    ticketN = inNum(v30.n);
  } else if (d30.n > 0) {
    ticket = d30.total / d30.n;
    ticketN = d30.n;
  }

  var trendHoy = null;
  if (ayer.total > 0) {
    trendHoy = { pct: ((hoy.total - ayer.total) / ayer.total) * 100, label: "vs ayer" };
  }
  var trend7 = null;
  if (p7.total > 0) {
    trend7 = { pct: ((d7.total - p7.total) / p7.total) * 100, label: "vs sem. ant." };
  }

  // Más vendidos: se prefiere la foto del panel (30 días); si no llegó, se
  // reconstruye con los ítems de las boletas leídas.
  var topProd = [];
  if (Array.isArray(ven.top_productos) && ven.top_productos.length) {
    topProd = ven.top_productos.slice(0, 5).map(function (x) {
      return {
        nombre: String(x.nombre || x.codigo || "sin nombre"),
        unidades: inNum(x.unidades),
        total: inNum(x.total)
      };
    });
  } else {
    var ac = {};
    (Array.isArray(bol) ? bol : []).forEach(function (b) {
      (b.items || []).forEach(function (it) {
        var clave = (it.nombre && String(it.nombre).trim()) || String(it.codigo || "sin nombre");
        if (!ac[clave]) ac[clave] = { nombre: clave, unidades: 0, total: 0 };
        var cant = inNum(it.cantidad);
        ac[clave].unidades += cant;
        ac[clave].total += inNum(it.precio) * cant;
      });
    });
    topProd = Object.keys(ac).map(function (k) { return ac[k]; })
      .sort(function (a, b) { return b.unidades - a.unidades; })
      .slice(0, 5);
  }

  INICIO.calc = {
    dias: dias,
    hoy: hoy,
    ayer: ayer,
    d7: d7,
    p7: p7,
    d30: d30,
    ticket: ticket,
    ticketN: ticketN,
    trendHoy: trendHoy,
    trend7: trend7,
    topProd: topProd
  };
  return INICIO.calc;
}

/* ── pintado: portada, KPIs y tarjetas ──────────────────────────────────── */

function inEstado(texto, tipo) {
  var chip = document.getElementById("inChipEstado");
  if (!chip) return;
  chip.className = "in-chip-estado in-chip-estado--" + (tipo || "espera");
  var span = chip.querySelector("span");
  if (span) span.textContent = texto;
  else chip.textContent = texto;
}

function inTrend(tr) {
  if (!tr || !isFinite(tr.pct)) return "";
  var sube = tr.pct >= 0;
  return '<span class="in-trend ' + (sube ? "in-trend--up" : "in-trend--down") + '" ' +
    'title="' + inEsc(inPct(Math.abs(tr.pct), 1) + " " + tr.label) + '">' +
    '<i aria-hidden="true">' + (sube ? "↑" : "↓") + "</i>" +
    inEsc(inPct(Math.abs(tr.pct))) + '<em>' + inEsc(tr.label) + "</em></span>";
}

function inicioPortada(c) {
  var p = INICIO.panel || {};
  var res = p.resumen || {};
  var margen = inNum(res.margen_promedio);
  var hayVentas = !!INICIO.boletas; // [] es una respuesta válida; null es fallo

  var caja = document.getElementById("inPortadaHoy");
  if (caja) {
    caja.innerHTML =
      '<div class="in-hoy-item"><span>Ventas hoy</span><strong>' +
        (hayVentas ? inEsc(inPesoMini(c.hoy.total)) : "—") + "</strong></div>" +
      '<div class="in-hoy-item"><span>Ventas 7d</span><strong>' +
        (hayVentas ? inEsc(inPesoMini(c.d7.total)) : "—") + "</strong></div>" +
      '<div class="in-hoy-item"><span>Margen</span><strong>' +
        (INICIO.panel && res.margen_promedio !== undefined ? inEsc(inPct(margen)) : "—") +
        "</strong></div>";
  }
}

function inicioKpis(c) {
  var cont = document.getElementById("inKpis");
  if (!cont) return;
  cont.removeAttribute("aria-busy");

  var p = INICIO.panel || null;
  var res = (p && p.resumen) || null;
  var hayBol = !!INICIO.boletas;
  var tarjetas = [];

  tarjetas.push({
    ico: "chart-column", et: "Ventas hoy", val: hayBol ? c.hoy.total : null, fmt: "peso",
    sub: hayBol ? (c.hoy.n ? c.hoy.n + (c.hoy.n === 1 ? " boleta" : " boletas") : "sin boletas hoy")
                : "sin lectura de boletas",
    tr: hayBol ? c.trendHoy : null
  });

  tarjetas.push({
    ico: "coins", et: "Últimos 7 días", val: hayBol ? c.d7.total : null, fmt: "peso",
    sub: hayBol ? (c.d7.n ? c.d7.n + (c.d7.n === 1 ? " boleta" : " boletas") : "sin ventas esta semana")
                : "sin lectura de boletas",
    tr: hayBol ? c.trend7 : null
  });

  tarjetas.push({
    ico: "receipt", et: "Ticket promedio", val: (hayBol || res) ? c.ticket : null, fmt: "peso",
    sub: c.ticketN ? "30 días · " + c.ticketN + (c.ticketN === 1 ? " boleta" : " boletas")
                   : (hayBol ? "sin boletas en 30 días" : "sin lectura de datos"),
    tr: null
  });

  if (res) {
    var total = inNum(res.total);
    var venta = inNum(res.valor_venta);
    var costo = inNum(res.valor_costo);
    var util = inNum(res.utilidad_potencial);
    var bajo = inNum(res.stock_bajo);
    var agot = inNum(res.agotados);
    var margen = inNum(res.margen_promedio);

    tarjetas.push({
      ico: "store", et: "Valor del inventario", val: venta, fmt: "peso",
      sub: inEntero(total) + " productos · costo " + inPesoCorto(costo), tr: null
    });

    tarjetas.push({
      ico: "percent", et: "Utilidad potencial", val: util, fmt: "peso",
      sub: margen ? inPct(margen) + " de margen" : "sin margen calculado", tr: null
    });

    tarjetas.push({
      ico: "tag", et: "Stock en riesgo", val: bajo, fmt: "entero",
      sub: agot ? agot + " agotado(s) · " + inNum(res.sin_precio) + " sin precio"
                : "nada agotado · " + inNum(res.sin_precio) + " sin precio",
      alerta: bajo > 0, tr: null
    });
  }

  cont.innerHTML = tarjetas.map(function (t, i) {
    var valTxt = (t.val === null || t.val === undefined) ? "—" : inFmt(t.fmt, t.val);
    return '<article class="in-kpi' + (t.alerta ? " in-kpi--alerta" : "") + '" style="--i:' + i + '">' +
      '<span class="in-kpi-ico">' + inIcono(t.ico, 16) + "</span>" +
      '<span class="in-kpi-et">' + inEsc(t.et) + "</span>" +
      '<strong class="in-kpi-val" data-in-tipo="' + t.fmt + '">' + inEsc(valTxt) + "</strong>" +
      '<span class="in-kpi-pie">' +
        '<span class="in-kpi-sub">' + inEsc(t.sub) + "</span>" +
        inTrend(t.tr) +
      "</span></article>";
  }).join("");

  // Animación de conteo (sólo cifras, nunca datos inventados).
  Array.prototype.slice.call(cont.querySelectorAll(".in-kpi-val")).forEach(function (el) {
    var hijo = el.parentNode;
    var idx = Array.prototype.indexOf.call(cont.children, hijo);
    var t = idx >= 0 ? tarjetas[idx] : null;
    if (t && typeof t.val === "number") inContar(el, t.val, t.fmt);
  });

  var pend = res ? inNum(res.pendientes_sync) : 0;
  if (pend) {
    var aviso = document.createElement("p");
    aviso.className = "in-nota in-nota--kpi";
    aviso.textContent = pend + " producto(s) esperando sincronizar con la nube.";
    cont.appendChild(aviso);
  }
}

/* ── gráfico de ventas (SVG puro, sin librerías) ────────────────────────── */

function inVacio(cont, titulo, texto, icono) {
  if (!cont) return;
  cont.innerHTML = '<div class="in-vacio">' +
    '<span class="in-vacio-ico">' + inIcono(icono || "chart-column", 22) + "</span>" +
    "<strong>" + inEsc(titulo) + "</strong>" +
    "<p>" + inEsc(texto) + "</p></div>";
}

function inicioVentasChart(c) {
  var cont = document.getElementById("inChartVentas");
  var pie = document.getElementById("inChartVentasPie");
  var chip = document.getElementById("inVentasTrend");
  if (!cont) return;
  cont.removeAttribute("aria-busy");
  if (chip) chip.textContent = "";
  if (pie) pie.textContent = "";

  if (!INICIO.boletas) {
    inVacio(cont, "No se pudieron leer las boletas",
      "El núcleo no respondió a tiempo. Pulsa «Actualizar» para volver a intentarlo.", "receipt");
    return;
  }

  var dias = c.dias || [];
  var totales = dias.map(function (d) { return d.total; });
  var max = Math.max.apply(null, totales.concat([0]));
  var conVentas = dias.filter(function (d) { return d.n > 0; }).length;
  var suma = totales.reduce(function (a, b) { return a + b; }, 0);

  if (!INICIO.boletas.length || !conVentas) {
    if (INICIO.boletas.length) {
      inVacio(cont, "Sin ventas en los últimos 14 días",
        "Hay " + INICIO.boletas.length + " boleta(s) más antigua(s) guardadas. El gráfico se llena con las ventas nuevas.", "chart-column");
      if (pie) pie.textContent = "Ninguna boleta de las últimas dos semanas.";
    } else {
      inVacio(cont, "Sin ventas registradas",
        "Emite la primera boleta y aquí aparece el día, el monto y la tendencia.", "receipt");
      if (pie) pie.textContent = "Aún no hay boletas guardadas en el teléfono.";
    }
    if (chip) chip.textContent = "sin datos";
    return;
  }

  if (chip) {
    chip.textContent = inPesoCorto(suma) + " en 14 días";
  }
  if (pie) {
    pie.textContent = conVentas + " de 14 días con ventas · " +
      (c.trend7 ? inPct(Math.abs(c.trend7.pct), 1) + " " + (c.trend7.pct >= 0 ? "arriba" : "abajo") + " que la semana anterior" : "aún sin semana anterior para comparar") + ".";
  }

  var W = 340, H = 172;
  var padL = 4, padR = 4, padT = 26, padB = 26;
  var base = H - padB;
  var n = dias.length;
  var banda = (W - padL - padR) / n;
  var bw = Math.min(14, banda * 0.54);
  var yMax = max * 1.14 || 1;

  function Y(v) { return base - (v / yMax) * (base - padT); }

  var barras = dias.map(function (d, i) {
    var x = padL + banda * i + (banda - bw) / 2;
    var y = Y(d.total);
    return {
      cx: padL + banda * i + banda / 2,
      x: x, y: y, h: Math.max(2, base - y),
      total: d.total, n: d.n,
      hoy: d.esHoy, fecha: d.fecha
    };
  });

  var svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" ' +
    'aria-label="' + inEsc("Ventas de los últimos 14 días: " + inPeso(suma) + " en " + conVentas + " días") + '">' +
    "<defs>" +
      '<linearGradient id="inBarGrad" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="#DFFF63" stop-opacity="0.95"/>' +
        '<stop offset="100%" stop-color="#8FCC00" stop-opacity="0.55"/>' +
      "</linearGradient>" +
      '<linearGradient id="inAreaGrad" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="#C8FF00" stop-opacity="0.22"/>' +
        '<stop offset="100%" stop-color="#C8FF00" stop-opacity="0"/>' +
      "</linearGradient>" +
      '<linearGradient id="inLineGrad" x1="0" y1="0" x2="1" y2="0">' +
        '<stop offset="0%" stop-color="#C8FF00" stop-opacity="0.45"/>' +
        '<stop offset="55%" stop-color="#E9FF8A" stop-opacity="0.95"/>' +
        '<stop offset="100%" stop-color="#C8FF00" stop-opacity="0.55"/>' +
      "</linearGradient>" +
    "</defs>";

  // rejilla suave
  [0.5, 1].forEach(function (f) {
    var yy = Y(yMax * f);
    svg += '<line class="in-rejilla" x1="' + padL + '" y1="' + yy.toFixed(1) +
      '" x2="' + (W - padR) + '" y2="' + yy.toFixed(1) + '"/>';
  });

  // barras
  barras.forEach(function (b, i) {
    svg += '<rect class="in-barra' + (b.hoy ? " in-barra--hoy" : "") + '" x="' + b.x.toFixed(1) +
      '" y="' + b.y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + b.h.toFixed(1) +
      '" rx="4" fill="url(#inBarGrad)" style="animation-delay:' + (i * 28) + 'ms">' +
      "<title>" + inEsc(IN_DIAS[b.fecha.getDay()] + " " + b.fecha.getDate() + " · " + inPeso(b.total) +
        (b.n ? " · " + b.n + " boleta(s)" : "")) + "</title></rect>";
  });

  // área + línea de tendencia
  var pts = barras.map(function (b) { return b.cx.toFixed(1) + " " + b.y.toFixed(1); });
  var dLinea = "M" + pts.join(" L");
  var dArea = dLinea + " L" + barras[barras.length - 1].cx.toFixed(1) + " " + base.toFixed(1) +
    " L" + barras[0].cx.toFixed(1) + " " + base.toFixed(1) + " Z";

  svg += '<path class="in-area-ventas" d="' + dArea + '" fill="url(#inAreaGrad)"/>';
  svg += '<path class="in-linea-ventas" d="' + dLinea + '" fill="none" stroke="url(#inLineGrad)" ' +
    'stroke-width="2" stroke-linejoin="round" stroke-linecap="round" pathLength="1"/>';

  // etiquetas de día
  barras.forEach(function (b) {
    var et = b.hoy ? "hoy" : String(b.fecha.getDate());
    svg += '<text class="in-eje' + (b.hoy ? " in-eje--hoy" : "") + '" x="' + b.cx.toFixed(1) +
      '" y="' + (H - 8) + '" text-anchor="middle">' + inEsc(et) + "</text>";
  });

  // valor de la barra más alta
  var tope = barras.reduce(function (a, b) { return b.total > a.total ? b : a; }, barras[0]);
  if (tope.total > 0) {
    var tx = Math.min(W - 26, Math.max(26, tope.cx));
    svg += '<text class="in-etiqueta" x="' + tx.toFixed(1) + '" y="' +
      Math.max(12, tope.y - 7).toFixed(1) + '" text-anchor="middle">' +
      inEsc(inPesoMin(tope.total)) + "</text>";
  }

  svg += "</svg>";
  cont.innerHTML = svg;
}

/* ── salud del inventario ───────────────────────────────────────────────── */

function inicioSalud() {
  var cont = document.getElementById("inSalud");
  var chip = document.getElementById("inSaludChip");
  if (!cont) return;
  cont.removeAttribute("aria-busy");

  var p = INICIO.panel;
  if (!p || !p.resumen) {
    if (chip) chip.textContent = "sin datos";
    inVacio(cont, "Inventario no disponible",
      "No llegó la foto del inventario. Pulsa «Actualizar» para intentarlo otra vez.", "package-check");
    return;
  }

  var res = p.resumen;
  var total = Math.max(0, inNum(res.total));
  if (!total) {
    if (chip) chip.textContent = "sin productos";
    inVacio(cont, "Sin productos cargados",
      "Carga el primer producto en «Inventario» y aquí aparece la salud del stock.", "package-check");
    return;
  }

  var agot = Math.max(0, Math.min(inNum(res.agotados), total));
  var bajoTotal = Math.max(0, Math.min(inNum(res.stock_bajo), total));
  var bajo = Math.max(0, bajoTotal - agot);
  var ok = Math.max(0, total - bajoTotal);
  var pct = function (n) { return total ? (n / total) * 100 : 0; };

  if (chip) {
    chip.textContent = agot
      ? agot + " agotado(s)"
      : bajoTotal
        ? bajoTotal + " por reponer"
        : "todo en orden";
  }

  var html = '<div class="in-salud-barra" role="img" aria-label="' +
    inEsc("Inventario: " + ok + " en orden, " + bajo + " con stock bajo y " + agot + " agotados de " + total + " productos") + '">' +
    '<i class="in-salud-seg in-salud-seg--ok" style="width:' + pct(ok).toFixed(2) + '%"></i>' +
    '<i class="in-salud-seg in-salud-seg--bajo" style="width:' + pct(bajo).toFixed(2) + '%"></i>' +
    '<i class="in-salud-seg in-salud-seg--agot" style="width:' + pct(agot).toFixed(2) + '%"></i>' +
  "</div>" +
  '<div class="in-salud-leyenda">' +
    '<div class="in-salud-item"><span class="in-punto in-punto--ok"></span><b>' + inEntero(ok) + "</b>" +
      "<span>en orden · " + inPct(pct(ok)) + "</span></div>" +
    '<div class="in-salud-item"><span class="in-punto in-punto--bajo"></span><b>' + inEntero(bajo) + "</b>" +
      "<span>bajo · " + inPct(pct(bajo)) + "</span></div>" +
    '<div class="in-salud-item"><span class="in-punto in-punto--agot"></span><b>' + inEntero(agot) + "</b>" +
      "<span>agotado · " + inPct(pct(agot)) + "</span></div>" +
  "</div>";

  var unidades = inNum(res.unidades);
  var sinPrecio = inNum(res.sin_precio);
  var sinCosto = inNum(res.sin_costo);
  var nota = inEntero(unidades) + " unidades en bodega";
  if (sinPrecio) nota += " · " + sinPrecio + " sin precio";
  if (sinCosto) nota += " · " + sinCosto + " sin costo";
  html += '<p class="in-salud-nota">' + inEsc(nota) + "</p>";

  // Productos a reponer: sólo si el panel trajo la lista real.
  var lista = Array.isArray(p.stock_bajo) ? p.stock_bajo.slice(0, 3) : [];
  if (lista.length) {
    var filas = lista.map(function (x) {
      var min = inNum(x.stock_minimo);
      return '<li><span class="in-riesgo-nom">' + inEsc(x.nombre || x.codigo || "producto") + "</span>" +
        "<b>" + inEntero(x.stock) + (min ? "/" + inEntero(min) : "") + "</b></li>";
    }).join("");
    html += '<div class="in-riesgo"><span class="in-riesgo-tit">Reponer primero</span>' +
      "<ul>" + filas + "</ul></div>";
  }

  cont.innerHTML = html;
}

/* ── listas compactas con barras ────────────────────────────────────────── */

function inLista(items) {
  return '<ul class="in-lista">' + items.map(function (it, i) {
    return '<li class="in-lista-item" style="--i:' + i + '">' +
      '<div class="in-lista-cab"><span class="in-lista-nom" title="' + inEsc(it.nombre) + '">' +
        inEsc(it.nombre) + "</span>" +
        '<span class="in-lista-val">' + it.valor + "</span></div>" +
      '<div class="in-lista-barra"><i style="width:' + it.w.toFixed(1) + '%"></i></div>' +
    "</li>";
  }).join("") + "</ul>";
}

function inicioCategorias() {
  var cont = document.getElementById("inChartCategorias");
  var pie = document.getElementById("inChartCategoriasPie");
  if (!cont) return;
  cont.removeAttribute("aria-busy");

  var p = INICIO.panel;
  var cats = (p && Array.isArray(p.categorias) ? p.categorias : [])
    .filter(function (c) { return inNum(c.n) > 0; })
    .sort(function (a, b) { return inNum(b.n) - inNum(a.n); });

  if (!cats.length) {
    if (pie) pie.textContent = "";
    inVacio(cont, "Sin categorías",
      p ? "Los productos que cargues se agrupan aquí por categoría."
        : "No llegó la foto del inventario.", "layers");
    return;
  }

  var totalProd = cats.reduce(function (a, c) { return a + inNum(c.n); }, 0);
  var top = cats.slice(0, 5);
  var restoN = cats.slice(5).reduce(function (a, c) { return a + inNum(c.n); }, 0);
  if (restoN > 0) top.push({ categoria: "Otras", n: restoN, valor_venta: 0, otras: true });

  var items = top.map(function (c) {
    var n = inNum(c.n);
    return {
      nombre: c.otras ? "Otras categorías" : String(c.categoria || "sin categoría"),
      valor: inEntero(n) + " · " + inPct(totalProd ? (n / totalProd) * 100 : 0),
      w: totalProd ? (n / totalProd) * 100 : 0
    };
  });

  cont.innerHTML = inLista(items);
  if (pie) {
    pie.textContent = inEntero(totalProd) + " producto(s) en " + cats.length +
      " categoría(s)" + (inNum(INICIO.panel.resumen && INICIO.panel.resumen.sin_precio) ? " · revisa los sin precio" : "") + ".";
  }
}

function inicioMargen() {
  var cont = document.getElementById("inTopMargen");
  var pie = document.getElementById("inTopMargenPie");
  var chip = document.getElementById("inMargenChip");
  if (!cont) return;
  cont.removeAttribute("aria-busy");

  var p = INICIO.panel;
  var lista = (p && Array.isArray(p.top_margen) ? p.top_margen : []).slice(0, 5);

  if (!lista.length) {
    if (chip) chip.textContent = "—";
    if (pie) pie.textContent = "";
    inVacio(cont, "Sin margen calculado",
      p ? "Carga costo y precio en tus productos para ver dónde ganas más."
        : "No llegó la foto del inventario.", "percent");
    return;
  }

  if (chip) chip.textContent = lista.length + " mejores";
  var items = lista.map(function (x) {
    var m = inNum(x.margen_pct);
    return {
      nombre: String(x.nombre || x.codigo || "producto"),
      valor: inPct(m),
      w: Math.max(2, Math.min(100, m))
    };
  });
  cont.innerHTML = inLista(items);
  if (pie) pie.textContent = "Margen sobre precio de venta de los productos mejor ubicados.";
}

function inicioTopProductos(c) {
  var cont = document.getElementById("inChartTop");
  var pie = document.getElementById("inChartTopPie");
  if (!cont) return;
  cont.removeAttribute("aria-busy");

  var cardTop = cont.closest(".in-tarjeta");
  var h4 = cardTop ? cardTop.querySelector("h4") : null;
  if (h4) h4.textContent = INICIO.panel ? "Más vendidos · 30 días" : "Más vendidos";

  var lista = (c.topProd || []).filter(function (x) { return inNum(x.unidades) > 0; });
  if (!lista.length) {
    if (pie) pie.textContent = "";
    if (INICIO.boletas === null) {
      inVacio(cont, "No se pudieron leer las ventas",
        "El núcleo no respondió a tiempo. Pulsa «Actualizar» para volver a intentarlo.", "receipt");
    } else {
      inVacio(cont, "Sin ventas para rankear",
        "Emite boletas y esta lista muestra qué se mueve más.", "shopping-cart");
    }
    return;
  }

  var max = Math.max.apply(null, lista.map(function (x) { return inNum(x.unidades); }));
  var items = lista.map(function (x) {
    var u = inNum(x.unidades);
    return {
      nombre: String(x.nombre || "producto"),
      valor: inEntero(u) + " u",
      w: max ? (u / max) * 100 : 0
    };
  });
  cont.innerHTML = inLista(items);
  if (pie) {
    pie.textContent = INICIO.panel
      ? "Unidades vendidas en los últimos 30 días · " +
        inPesoCorto(lista.reduce(function (a, x) { return a + inNum(x.total); }, 0)) + " facturados."
      : "Unidades sobre las boletas leídas del teléfono · " +
        inPesoCorto(lista.reduce(function (a, x) { return a + inNum(x.total); }, 0)) + " facturados.";
  }
}

/* ── nota de estado y pintado completo ──────────────────────────────────── */

function inNota() {
  var nota = document.getElementById("inDatosNota");
  if (!nota) return;
  var hora = "";
  if (INICIO.actualizado) {
    var f = new Date(INICIO.actualizado);
    hora = ("0" + f.getHours()).slice(-2) + ":" + ("0" + f.getMinutes()).slice(-2);
  }
  var res = INICIO.panel && INICIO.panel.resumen;
  var nProd = res ? inNum(res.total) : 0;
  var nBol = Array.isArray(INICIO.boletas) ? INICIO.boletas.length : 0;

  if (!INICIO.actualizado) {
    nota.textContent = INICIO.fallo || "Sin datos todavía. Revisa el diagnóstico si el núcleo no responde.";
    inEstado("sin datos", "error");
    return;
  }

  if (!INICIO.panel && !nBol) {
    nota.textContent = INICIO.fallo || "No se pudo leer el inventario ni las boletas guardadas.";
    inEstado("sin datos", "error");
    return;
  }

  if (!nProd && !nBol) {
    nota.textContent = "Aún no hay productos ni boletas. Abre «Inventario» para cargar el primero.";
    inEstado("en línea", "ok");
    return;
  }

  var txt = "Actualizado a las " + hora;
  if (INICIO.panel) {
    txt += " · " + inEntero(nProd) + " producto(s)";
  } else {
    txt += " · inventario sin respuesta";
  }
  txt += " · " + inEntero(nBol) + " boleta(s) leídas del teléfono.";

  // Si hay datos viejos y la última lectura falló, se dice sin dramatizar.
  if (INICIO.panel && INICIO.tsPanel && Date.now() - INICIO.tsPanel > 120000) {
    txt += " La última lectura completa tiene más de dos minutos.";
  }
  nota.textContent = txt;

  if (!INICIO.boletas || !INICIO.panel) inEstado("datos parciales", "espera");
  else inEstado("en línea", "ok");
}

function inicioPintar() {
  var c = inCalcular();
  inSeguro(function () { inicioPortada(c); }, "inicioPortada");
  inSeguro(function () { inicioKpis(c); }, "inicioKpis");
  inSeguro(function () { inicioVentasChart(c); }, "inicioVentasChart");
  inSeguro(function () { inicioSalud(); }, "inicioSalud");
  inSeguro(function () { inicioCategorias(); }, "inicioCategorias");
  inSeguro(function () { inicioMargen(); }, "inicioMargen");
  inSeguro(function () { inicioTopProductos(c); }, "inicioTopProductos");
  inSeguro(function () { inNota(); }, "inicioNota");
  inSeguro(function () { aniEnganchar(document.getElementById("v-inicio"), { duracion: 0.9 }); }, "inicioIconos");
}

/* ── contenido estático: fichas y marcas ────────────────────────────────── */

function inicioPintarIconos() {
  Array.prototype.slice.call(document.querySelectorAll("[data-ani-icono]")).forEach(function (caja) {
    var nombre = caja.dataset.aniIcono;
    if (caja.dataset.pintado === "1") return;
    var tam = Number(caja.dataset.aniTam) || 22;
    var svg = inIcono(nombre, tam);
    if (svg) { caja.innerHTML = svg; caja.dataset.pintado = "1"; }
  });

  var tira = document.getElementById("inMarcas");
  if (tira && tira.dataset.pintado !== "1") {
    var claves = String(tira.dataset.marcas || "").split(",").map(function (s) { return s.trim(); })
      .filter(function (s) { return !!s; });
    tira.innerHTML = claves.map(function (k) {
      var svg = "";
      try { if (typeof marcaSvg === "function") svg = marcaSvg(k, 22); } catch (e) { svg = ""; }
      if (!svg) return "";
      var titulo = (typeof MARCAS_TITULOS !== "undefined" && MARCAS_TITULOS[k]) || k.replace(/^(lobe|si)-/, "");
      return '<div class="in-marca" role="img" aria-label="' + inEsc(titulo) + '" title="' + inEsc(titulo) + '">' +
        svg + "</div>";
    }).join("");
    if (tira.innerHTML) tira.dataset.pintado = "1";
  }

  try { if (typeof aniEnganchar === "function") aniEnganchar(document, { duracion: 1 }); } catch (e) { /* sin motion */ }
}

var MARCAS_TITULOS = {
  "si-rust": "Rust · núcleo del sistema",
  "si-sqlite": "SQLite · base de datos local",
  "si-javascript": "JavaScript · interfaz",
  "si-android": "Android · plataforma",
  "si-tauri": "Tauri · integración nativa",
  "lobe-openai": "OpenAI",
  "lobe-claude": "Claude",
  "lobe-gemini": "Gemini",
  "lobe-google": "Google",
  "lobe-ollama": "Ollama · modelos locales",
  "lobe-huggingface": "Hugging Face",
  "lobe-meta": "Meta",
  "lobe-deepseek": "DeepSeek",
  "lobe-qwen": "Qwen"
};

/* ── revelado suave al entrar en pantalla ───────────────────────────────── */

function inicioRevelar() {
  var secciones = Array.prototype.slice.call(document.querySelectorAll("#v-inicio .in-rev"));
  if (!secciones.length) return;
  secciones.forEach(function (s, i) { s.style.setProperty("--i", i); });

  if (inReducido() || !("IntersectionObserver" in window)) {
    secciones.forEach(function (s) { s.classList.add("in-visible"); });
    return;
  }
  if (INICIO.obs) INICIO.obs.disconnect();
  INICIO.obs = new IntersectionObserver(function (entradas) {
    entradas.forEach(function (e) {
      if (e.isIntersecting) {
        e.target.classList.add("in-visible");
        INICIO.obs.unobserve(e.target);
      }
    });
  }, { threshold: 0.06 });
  secciones.forEach(function (s) { INICIO.obs.observe(s); });
}

/* ── arranque de la vista (sin tocar el puente durante la carga) ────────── */

function inicioArrancar() {
  if (INICIO.revelado) return;
  INICIO.revelado = true;

  inSeguro(inicioMontar, "inicioMontar");
  inSeguro(inicioPintarIconos, "inicioPintarIconos");
  inSeguro(inicioRevelar, "inicioRevelar");

  var b = document.getElementById("btnInicioRefrescar");
  if (b && b.dataset.inListo !== "1") {
    b.dataset.inListo = "1";
    b.addEventListener("click", function () { inicioRefrescar(true); });
  }

  // Los datos se piden sólo cuando la vista está a la vista; si el núcleo no
  // está listo, `inicioRefrescar` reintenta solo, sin bloquear nada.
  try {
    if (estadoApp.vista === "inicio") inicioRefrescar();
  } catch (e) {
    inSeguro(function () { inicioRefrescar(); }, "inicioRefrescar");
  }
}

/* El arranque va diferido a propósito: durante la carga no se llama al puente
   (eso dejaba la pantalla en el loader) y el hilo queda libre para pintar. */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", inicioArrancar);
} else {
  setTimeout(inicioArrancar, 30);
}
