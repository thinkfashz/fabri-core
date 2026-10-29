/* ==========================================================================
   FORGE CORE STOCK · pantalla de inicio
   --------------------------------------------------------------------------
   Portada del producto. Todo lo que muestra sale de datos REALES guardados en
   el SQLite del teléfono:

     · resumen del inventario  → productos, valor, utilidad, stock bajo
     · boletas emitidas        → ventas de los últimos 7 días y más vendidos
     · categorías              → reparto del catálogo

   Los gráficos los dibuja d3 (paquete mínimo vendorizado en `d3-mini.js`, que
   expone `window.d3s`). Los iconos animados vienen de `marcas.js` (datos de
   animateicons + marcas de lobe-icons y simple-icons), y el lienzo del héroe es
   un canvas propio: nada se descarga en tiempo de ejecución.

   Reglas que se respetan aquí:
     · ninguna llamada al puente durante la carga (todo va diferido);
     · el núcleo puede tardar: la vista se pinta igual y los datos llegan solos;
     · si el sistema pide menos movimiento, no hay lienzo ni animación;
     · nunca se inventa un dato: sin datos, se explica cómo conseguirlos.
   ========================================================================== */

var INICIO = {
  cargando: false,
  datos: null,
  boletas: [],
  actualizado: 0,
  intentos: 0,
  lienzoId: null,
  revelado: false
};

/* ── utilidades ─────────────────────────────────────────────────────────── */

/** Llama al inventario en segundo plano (nunca bloquea el hilo de JavaScript). */
function inApi(accion, extra, maxMs) {
  var payload = Object.assign({ accion: accion }, extra || {});
  return apiTarde("inventario", payload, { maxMs: maxMs || 20000 }).then(function (r) {
    if (!r.ok && r.codigo !== "LENTO" && r.codigo !== "NUCLEO_OCUPADO") {
      try {
        revision("inicio", "error", "inventario." + accion + " falló", String(r.error || ""), 0, "core");
      } catch (e) { /* el registro no puede romper la portada */ }
    }
    return r;
  });
}

function inPeso(n) {
  try {
    return "$" + Math.round(Number(n) || 0).toLocaleString("es-CL");
  } catch (e) {
    return "$" + Math.round(Number(n) || 0);
  }
}

/** Pesos compactos para las tarjetas: $2,18 M en vez de $2.180.000. */
function inPesoCorto(n) {
  var v = Math.round(Number(n) || 0);
  if (Math.abs(v) >= 1e6) {
    return "$" + (v / 1e6).toFixed(2).replace(".", ",") + " M";
  }
  return inPeso(v);
}

/** Fecha corta «lun 27» a partir de segundos Unix. */
var IN_DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
function inDiaCorto(ms) {
  var d = new Date(ms);
  return IN_DIAS[d.getDay()] + " " + d.getDate();
}

/* ── carga de datos y pintado principal ─────────────────────────────────── */

/** Recarga las estadísticas de la portada. Es idempotente y se puede repetir. */
function inicioRefrescar(manual) {
  var nota = document.getElementById("inDatosNota");
  if (INICIO.cargando) return Promise.resolve();
  // Al volver a la vista no hace falta golpear el núcleo otra vez: si lo leído
  // tiene pocos segundos se repinta de la caché y listo.
  if (!manual && INICIO.datos && Date.now() - INICIO.actualizado < 20000) {
    inicioPintar(true, true);
    return Promise.resolve();
  }

  if (typeof nucleoPreparado === "function" && !nucleoPreparado()) {
    INICIO.intentos++;
    if (nota) nota.textContent = "El núcleo está abriendo la base de datos: los datos aparecen en un momento.";
    // Se reintenta en silencio mientras la vista siga abierta (máx. ~24 s).
    if (INICIO.intentos < 30) {
      setTimeout(function () {
        if (estadoApp.vista === "inicio") inicioRefrescar(manual);
      }, 800);
    }
    return Promise.resolve();
  }
  INICIO.intentos = 0;
  INICIO.cargando = true;
  if (nota) nota.textContent = "Leyendo el inventario y las boletas guardadas en el teléfono…";
  if (manual) {
    var b = document.getElementById("btnInicioRefrescar");
    if (b) { b.disabled = true; b.textContent = "Actualizando…"; }
  }

  return Promise.all([
    inApi("resumen", {}, 20000),
    inApi("boletas", { limite: 200 }, 20000)
  ]).then(function (res) {
    var rRes = res[0], rBol = res[1];
    INICIO.datos = rRes.ok ? rRes.data : null;
    INICIO.boletas = rBol.ok ? (rBol.data.boletas || []) : [];
    INICIO.actualizado = Date.now();
    inicioPintar(rRes.ok, rBol.ok);
  }).catch(function (e) {
    if (nota) nota.textContent = "No se pudieron leer los datos: " + (e && e.message ? e.message : "error");
  }).then(function () {
    INICIO.cargando = false;
    var b2 = document.getElementById("btnInicioRefrescar");
    if (b2) { b2.disabled = false; b2.textContent = "Actualizar"; }
  });
}

/** Pinta KPIs, gráficos y la nota de estado a partir de lo que ya está en INICIO. */
function inicioPintar(resumenOk, boletasOk) {
  var d = INICIO.datos || {};
  var nota = document.getElementById("inDatosNota");
  var hora = new Date(INICIO.actualizado).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });

  if (!resumenOk && !boletasOk) {
    if (nota) nota.textContent = "Sin datos todavía. Revisa el diagnóstico si el núcleo no responde.";
    inPintarKpis(null);
    inChartVentas([]);
    inChartCategorias([]);
    inChartTop([]);
    return;
  }

  var total = Number(d.total) || 0;
  if (nota) {
    if (!total && !INICIO.boletas.length) {
      nota.textContent = "Aún no hay productos ni boletas. Abre «Inventario» para cargar el primero.";
    } else {
      nota.textContent = "Actualizado a las " + hora + " · " + total.toLocaleString("es-CL") +
        " producto(s) y " + INICIO.boletas.length.toLocaleString("es-CL") + " boleta(s) leídas del teléfono.";
    }
  }

  inPintarKpis(total ? d : null);
  inChartVentas(INICIO.boletas);
  inChartCategorias((d.categorias || []));
  inChartTop(INICIO.boletas);
}

/* ── KPIs del negocio ───────────────────────────────────────────────────── */

function inPintarKpis(d) {
  var cont = document.getElementById("inKpis");
  if (!cont) return;
  if (!d) {
    cont.innerHTML = '<p class="in-nota">Sin productos cargados todavía.</p>';
    return;
  }
  var total = Number(d.total) || 0;
  var venta = Number(d.valor_venta) || 0;
  var costo = Number(d.valor_costo) || 0;
  var utilidad = Number(d.utilidad_potencial) || 0;
  var bajo = Number(d.stock_bajo) || 0;
  var margen = venta > 0 ? (utilidad / venta) * 100 : 0;
  var pendientes = Number(d.pendientes_sync) || 0;

  var tarjetas = [
    { icono: "package-check", et: "Productos", val: total.toLocaleString("es-CL"),
      sub: bajo ? bajo + " con stock bajo" : "todo con stock" },
    { icono: "coins", et: "Valor de venta", val: inPesoCorto(venta),
      sub: "invertido " + inPesoCorto(costo) },
    { icono: "percent", et: "Utilidad potencial", val: inPesoCorto(utilidad),
      sub: margen ? margen.toFixed(0) + "% de margen" : "sin margen calculado" },
    { icono: "tag", et: "Stock bajo", val: bajo.toLocaleString("es-CL"),
      sub: bajo ? "conviene reponer" : "nada por reponer", alerta: bajo > 0 }
  ];

  cont.innerHTML = tarjetas.map(function (t) {
    return '<article class="in-kpi' + (t.alerta ? " alerta" : "") + '">' +
      '<div class="in-kpi-fila">' + aniIcono(t.icono, 16) +
      '<span class="in-kpi-et">' + esc(t.et) + "</span></div>" +
      "<strong>" + esc(t.val) + "</strong>" +
      "<small>" + esc(t.sub) + "</small></article>";
  }).join("") +
    (pendientes ? '<p class="in-nota" style="grid-column:1/-1;margin:2px 0 0">' +
      pendientes + " producto(s) esperando sincronizar con la nube.</p>" : "");

  aniEnganchar(cont, { duracion: 0.9 });
}

/* ── gráficos con d3 ────────────────────────────────────────────────────── */

function inD3() { return (typeof window !== "undefined" && window.d3s) || null; }

/** Mensaje dentro del recuadro cuando no hay nada que graficar. */
function inSvgVacio(id, texto) {
  var el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '<svg viewBox="0 0 320 120" role="img" aria-label="' + esc(texto) + '">' +
    '<text class="d3-vacio" x="160" y="62">' + esc(texto) + "</text></svg>";
}

/** Ventas de los últimos 7 días (barras) a partir de las boletas emitidas. */
function inChartVentas(boletas) {
  var d3 = inD3();
  var cont = document.getElementById("inChartVentas");
  var pie = document.getElementById("inChartVentasPie");
  if (!cont) return;
  if (!d3) { inSvgVacio("inChartVentas", "Gráficos no disponibles"); return; }

  // Se agrupa por día natural (la boleta guarda su fecha en segundos Unix).
  var hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  var dias = [];
  for (var i = 6; i >= 0; i--) {
    var ms = hoy.getTime() - i * 86400000;
    dias.push({ ms: ms, clave: inDiaCorto(ms), total: 0, n: 0 });
  }
  var fuera = 0;
  (boletas || []).forEach(function (b) {
    var ms = (Number(b.ts) || 0) * 1000;
    if (!ms) return;
    var dia = new Date(ms); dia.setHours(0, 0, 0, 0);
    var idx = 6 - Math.round((hoy.getTime() - dia.getTime()) / 86400000);
    if (idx >= 0 && idx < 7) { dias[idx].total += Number(b.total) || 0; dias[idx].n++; }
    else if (idx < 0 || idx > 6) fuera++;
  });

  var suma = d3.sum(dias, function (x) { return x.total; });
  var conVentas = dias.filter(function (x) { return x.n > 0; }).length;

  if (pie) {
    pie.textContent = conVentas
      ? "Total " + inPeso(suma) + " en " + conVentas + " día(s) con ventas." +
        (fuera ? " Hay boletas más antiguas fuera de la semana." : "")
      : "Todavía no hay ventas registradas en los últimos 7 días.";
  }

  var W = 320, H = 132, m = { arriba: 12, abajo: 22, izq: 6, der: 6 };
  var x = d3.scaleBand().domain(dias.map(function (d) { return d.clave; }))
    .range([m.izq, W - m.der]).padding(0.32);
  var maxV = d3.max(dias, function (d) { return d.total; }) || 0;
  var y = d3.scaleLinear().domain([0, maxV || 1]).nice().range([H - m.abajo, m.arriba]);
  var media = d3.mean(dias, function (d) { return d.total; }) || 0;

  var barras = dias.map(function (d) {
    var alto = Math.max(0, (H - m.abajo) - y(d.total));
    var tenue = d.total < media;
    return {
      clave: d.clave, total: d.total,
      x: x(d.clave), ancho: x.bandwidth(),
      y: H - m.abajo - alto, alto: alto, tenue: tenue
    };
  });

  var svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Ventas de los últimos 7 días">';
  // rejilla base
  svg += '<line class="d3-rejilla" x1="' + m.izq + '" y1="' + (H - m.abajo) + '" x2="' + (W - m.der) + '" y2="' + (H - m.abajo) + '"/>';
  barras.forEach(function (b) {
    if (b.alto > 0) {
      svg += '<rect class="' + (b.tenue ? "d3-barra-tenue" : "d3-barra") + '" x="' + b.x.toFixed(1) +
        '" y="' + b.y.toFixed(1) + '" width="' + Math.max(2, b.ancho).toFixed(1) +
        '" height="' + b.alto.toFixed(1) + '" rx="4"><title>' + esc(b.clave + " · " + inPeso(b.total)) + "</title></rect>";
    } else {
      svg += '<rect class="d3-barra-tenue" x="' + b.x.toFixed(1) + '" y="' + (H - m.abajo - 2) +
        '" width="' + Math.max(2, b.ancho).toFixed(1) + '" height="2" rx="1"/>';
    }
    svg += '<text class="d3-eje" x="' + (b.x + b.ancho / 2).toFixed(1) + '" y="' + (H - 7) +
      '" text-anchor="middle">' + esc(b.clave) + "</text>";
  });
  // la barra más alta se rotula con su valor
  var tope = barras.reduce(function (a, b) { return b.total > a.total ? b : a; }, { total: 0, x: 0, ancho: 0, y: 0 });
  if (tope.total > 0) {
    svg += '<text class="d3-etiqueta" x="' + (tope.x + tope.ancho / 2).toFixed(1) +
      '" y="' + Math.max(11, tope.y - 4).toFixed(1) + '" text-anchor="middle">' +
      esc(inPeso(tope.total)) + "</text>";
  }
  svg += "</svg>";
  cont.innerHTML = svg;
}

/** Reparto del catálogo por categoría (anillo con leyenda). */
function inChartCategorias(categorias) {
  var d3 = inD3();
  var cont = document.getElementById("inChartCategorias");
  var pie = document.getElementById("inChartCategoriasPie");
  if (!cont) return;
  if (!d3) { inSvgVacio("inChartCategorias", "Gráficos no disponibles"); return; }
  var datos = (categorias || []).filter(function (c) { return Number(c.n) > 0; });
  if (!datos.length) {
    if (pie) pie.textContent = "Carga productos con su categoría para ver el reparto.";
    inSvgVacio("inChartCategorias", "Sin categorías");
    return;
  }
  // Si hay muchísimas categorías, el resto se agrupa para que el anillo se lea.
  var top = datos.slice(0, 5);
  var resto = datos.slice(5).reduce(function (a, c) { return a + (Number(c.n) || 0); }, 0);
  if (resto > 0) top.push({ categoria: "Otras", n: resto, otras: true });

  var W = 150, H = 150, R = 62, r = 40;
  var colores = ["#C8FF00", "#8FCC00", "#5F9E00", "#B7FF32", "#E4FF7A", "#3A5A00"];
  var arco = d3.arc().innerRadius(r).outerRadius(R).cornerRadius(3);
  var trozos = d3.pie().value(function (d) { return Number(d.n) || 0; }).sort(null)(top);
  var total = d3.sum(top, function (d) { return Number(d.n) || 0; });

  var svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Productos por categoría">';
  trozos.forEach(function (t, i) {
    var c = colores[i % colores.length];
    svg += '<path d="' + arco(t) + '" transform="translate(' + (W / 2) + "," + (H / 2) + ')" fill="' + c + '">' +
      "<title>" + esc(t.data.categoria + ": " + t.data.n) + "</title></path>";
  });
  svg += '<text x="' + (W / 2) + '" y="' + (H / 2 - 2) + '" text-anchor="middle" fill="#fff" ' +
    'font-size="20" font-weight="700">' + total.toLocaleString("es-CL") + "</text>";
  svg += '<text x="' + (W / 2) + '" y="' + (H / 2 + 14) + '" text-anchor="middle" ' +
    'class="d3-eje">productos</text></svg>';
  cont.innerHTML = svg;

  if (pie) {
    pie.innerHTML = '<div class="in-leyenda">' + top.map(function (t, i) {
      return '<span class="in-leyenda-item"><i style="background:' + colores[i % colores.length] + '"></i>' +
        esc(t.categoria) + " · " + t.n + "</span>";
    }).join("") + "</div>";
  }
}

/** Productos más vendidos (según los ítems de las boletas registradas). */
function inChartTop(boletas) {
  var d3 = inD3();
  var cont = document.getElementById("inChartTop");
  var pie = document.getElementById("inChartTopPie");
  if (!cont) return;
  if (!d3) { inSvgVacio("inChartTop", "Gráficos no disponibles"); return; }

  var acumulado = {};
  (boletas || []).forEach(function (b) {
    (b.items || []).forEach(function (it) {
      var clave = (it.nombre && String(it.nombre).trim()) || (it.codigo ? String(it.codigo) : "sin nombre");
      if (!acumulado[clave]) acumulado[clave] = { nombre: clave, unidades: 0, monto: 0 };
      acumulado[clave].unidades += Number(it.cantidad) || 0;
      acumulado[clave].monto += (Number(it.precio) || 0) * (Number(it.cantidad) || 0);
    });
  });
  var lista = Object.keys(acumulado).map(function (k) { return acumulado[k]; })
    .sort(function (a, b) { return b.unidades - a.unidades; }).slice(0, 5);

  if (!lista.length) {
    if (pie) pie.textContent = "Emitir boletas llena esta tabla sola.";
    inSvgVacio("inChartTop", "Sin ventas aún");
    return;
  }
  if (pie) pie.textContent = "Medido en unidades, sobre las boletas guardadas en el teléfono.";

  var W = 320, fila = 26, H = lista.length * fila + 8, etiquetaW = 108;
  var x = d3.scaleLinear().domain([0, d3.max(lista, function (d) { return d.unidades; }) || 1])
    .range([0, W - etiquetaW - 34]);
  var y = d3.scaleBand().domain(lista.map(function (d) { return d.nombre; }))
    .range([4, H - 4]).padding(0.34);

  var svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Productos más vendidos">';
  lista.forEach(function (d) {
    var yy = y(d.nombre), h = Math.max(6, y.bandwidth());
    var nombre = d.nombre.length > 15 ? d.nombre.slice(0, 14) + "…" : d.nombre;
    svg += '<text class="d3-eje" x="0" y="' + (yy + h / 2 + 3.5).toFixed(1) + '">' + esc(nombre) + "</text>";
    svg += '<rect class="d3-barra-tenue" x="' + etiquetaW + '" y="' + yy.toFixed(1) + '" width="' +
      (W - etiquetaW - 34) + '" height="' + h.toFixed(1) + '" rx="4"/>';
    svg += '<rect class="d3-barra" x="' + etiquetaW + '" y="' + yy.toFixed(1) + '" width="' +
      Math.max(3, x(d.unidades)).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="4">' +
      "<title>" + esc(d.nombre + " · " + d.unidades + " u · " + inPeso(d.monto)) + "</title></rect>";
    svg += '<text class="d3-etiqueta" x="' + (W - 2) + '" y="' + (yy + h / 2 + 3.5).toFixed(1) +
      '" text-anchor="end">' + d.unidades + "</text>";
  });
  svg += "</svg>";
  cont.innerHTML = svg;
}

/* ── contenido estático: fichas y marcas ────────────────────────────────── */

/** Rellena los huecos `[data-ani-icono]` y la tira de marcas. */
function inicioPintarIconos() {
  Array.prototype.slice.call(document.querySelectorAll("[data-ani-icono]")).forEach(function (caja) {
    var nombre = caja.dataset.aniIcono;
    if (caja.dataset.pintado === "1") return;
    var tam = Number(caja.dataset.aniTam) || 22;
    var svg = aniIcono(nombre, tam);
    if (svg) { caja.innerHTML = svg; caja.dataset.pintado = "1"; }
  });

  var tira = document.getElementById("inMarcas");
  if (tira && tira.dataset.pintado !== "1") {
    var claves = String(tira.dataset.marcas || "").split(",").map(function (s) { return s.trim(); })
      .filter(function (s) { return !!s; });
    tira.innerHTML = claves.map(function (k) {
      var svg = marcaSvg(k, 22);
      if (!svg) return "";
      var titulo = MARCAS_TITULOS[k] || k.replace(/^(lobe|si)-/, "");
      return '<div class="in-marca" role="img" aria-label="' + esc(titulo) + '" title="' + esc(titulo) + '">' +
        svg + "</div>";
    }).join("");
    if (tira.innerHTML) tira.dataset.pintado = "1";
  }

  aniEnganchar(document, { duracion: 1 });
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

/* ── lienzo del héroe (canvas propio, muy liviano) ──────────────────────── */

function inicioLienzo() {
  var cv = document.getElementById("inHeroCanvas");
  if (!cv || typeof cv.getContext !== "function") return;
  var ctx = cv.getContext("2d");
  if (!ctx) return;
  if (INICIO.lienzoId) return;

  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var ancho = 0, alto = 0, columnas = 26, fase = 0;

  function medir() {
    var r = cv.getBoundingClientRect();
    ancho = Math.max(1, Math.round(r.width));
    alto = Math.max(1, Math.round(r.height));
    cv.width = Math.round(ancho * dpr);
    cv.height = Math.round(alto * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  medir();
  if (typeof window.addEventListener === "function") window.addEventListener("resize", medir);

  function visible() {
    if (document.hidden) return false;
    // Con el acceso abierto la portada está tapada: no se dibuja nada.
    try {
      if (document.body && document.body.classList
          && document.body.classList.contains("login-abierto")) return false;
    } catch (e) { /* sin dato, se dibuja */ }
    var v = document.getElementById("v-inicio");
    return !v || v.classList.contains("activa");
  }

  function paso() {
    INICIO.lienzoId = requestAnimationFrame(paso);
    if (!visible()) return;
    ctx.clearRect(0, 0, ancho, alto);
    fase += 0.02;
    var anchoBarra = ancho / columnas;
    for (var i = 0; i < columnas; i++) {
      var onda = 0.32 + 0.24 * Math.sin(fase + i * 0.42) + 0.12 * Math.sin(fase * 1.7 + i);
      var h = Math.max(4, alto * onda);
      var x = i * anchoBarra;
      // «código de barras» tenue: la identidad de la app, hecha de líneas.
      ctx.fillStyle = i % 4 === 0 ? "rgba(200,255,0,0.30)" : "rgba(200,255,0,0.13)";
      ctx.fillRect(x + anchoBarra * 0.22, alto - h, Math.max(1.5, anchoBarra * 0.36), h);
    }
    // línea de escaneo que recorre el lienzo
    var sx = (fase * 26) % ancho;
    var grad = ctx.createLinearGradient(sx - 30, 0, sx + 30, 0);
    grad.addColorStop(0, "rgba(200,255,0,0)");
    grad.addColorStop(0.5, "rgba(200,255,0,0.35)");
    grad.addColorStop(1, "rgba(200,255,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(sx - 30, 0, 60, alto);
  }

  if (typeof requestAnimationFrame === "function") {
    INICIO.lienzoId = requestAnimationFrame(paso);
  }
}

/* ── arranque de la vista (sin tocar el puente durante la carga) ────────── */

function inicioRevelar() {
  var secciones = Array.prototype.slice.call(document.querySelectorAll("#v-inicio .in-rev"));
  if (!secciones.length) return;
  var quieto = false;
  try { quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { /* sin dato */ }
  if (quieto || !("IntersectionObserver" in window)) {
    secciones.forEach(function (s) { s.classList.add("in-visible"); });
    return;
  }
  var obs = new IntersectionObserver(function (entradas) {
    entradas.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add("in-visible"); obs.unobserve(e.target); }
    });
  }, { threshold: 0.08 });
  secciones.forEach(function (s) { obs.observe(s); });
}

function inicioArrancar() {
  if (INICIO.revelado) return;
  INICIO.revelado = true;
  try { inicioPintarIconos(); } catch (e) { jsError(e, "inicioPintarIconos"); }
  try { inicioLienzo(); } catch (e) { jsError(e, "inicioLienzo"); }
  try { inicioRevelar(); } catch (e) { jsError(e, "inicioRevelar"); }
  var b = document.getElementById("btnInicioRefrescar");
  if (b) b.addEventListener("click", function () { inicioRefrescar(true); });
  // Los datos se piden sólo cuando el núcleo está listo; si ya lo está, esto
  // pinta de inmediato sin esperar a que el usuario navegue.
  try {
    if (estadoApp.vista === "inicio") inicioRefrescar();
  } catch (e) { jsError(e, "inicioRefrescar"); }
}

/* El arranque va diferido a propósito: durante la carga no se llama al puente
   (eso dejaba la pantalla en el loader) y el hilo queda libre para pintar. */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", inicioArrancar);
} else {
  setTimeout(inicioArrancar, 30);
}
