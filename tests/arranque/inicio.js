/* Pantalla de inicio: ¿está completa y pinta con datos reales?
   ---------------------------------------------------------------------------
   Comprueba, sobre el código que se empaqueta en la APK:
     1. Todos los ids que la portada necesita existen en index.html.
     2. Cada `data-ani-icono` referencia un icono que existe en marcas.js.
     3. Cada marca de la tira existe en MARCAS.
     4. El bloque técnico sigue intacto (nada se perdió al plegarlo).
     5. Con datos falsos, los KPIs y los tres gráficos d3 se pintan de verdad.
     6. Sin categorías ni boletas no se inventa nada: sale el estado vacío.

   Uso:  node tests/arranque/inicio.js   (código 1 si algo falla) */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const WWW = path.resolve(__dirname, "../../android/assets/www");
const html = fs.readFileSync(WWW + "/index.html", "utf8");

let fallos = 0;
function ok(t) { console.log("  \u001b[1;32m✔\u001b[0m " + t); }
function mal(t) { console.log("  \u001b[1;31m✖\u001b[0m " + t); fallos++; }

/* ── ids declarados en el HTML ─────────────────────────────────────────── */
const idsHtml = new Set();
{ const re = /id="([^"]+)"/g; let m; while ((m = re.exec(html))) idsHtml.add(m[1]); }

const IDS_PORTADA = [
  "v-inicio", "heroTitulo", "heroTexto", "heroDatos", "inHeroCanvas",
  "inDatosNota", "inKpis", "btnInicioRefrescar",
  "inChartVentas", "inChartVentasPie", "inChartCategorias", "inChartCategoriasPie",
  "inChartTop", "inChartTopPie", "inMarcas", "inTecnico"
];
const IDS_TECNICOS = [
  "kpiDisco", "kpiDiscoSub", "kpiRam", "kpiRamSub", "kpiTokensLocal", "kpiTokensApi",
  "kpiModelo", "kpiModeloSub", "kpiSalud", "kpiSaludSub", "btnVerificarGlobal",
  "verificadorGrid", "barraProgresoCont", "barraProgresoTexto", "barraProgresoFill",
  "barraProgresoPct", "tablaDispositivo", "modelosLista", "modelosBenchmark",
  "tablaBenchmark", "btnModelosRecomendados", "btnEscanearModelosInicio"
];

let faltan = IDS_PORTADA.filter((id) => !idsHtml.has(id));
if (faltan.length) mal("ids de la portada ausentes: " + faltan.join(", "));
else ok("los " + IDS_PORTADA.length + " ids de la portada están en index.html");

faltan = IDS_TECNICOS.filter((id) => !idsHtml.has(id));
if (faltan.length) mal("ids del bloque técnico ausentes: " + faltan.join(", "));
else ok("el bloque técnico conserva sus " + IDS_TECNICOS.length + " ids");

/* ── marcado de la portada ─────────────────────────────────────────────── */
const inicio = html.slice(html.indexOf('id="v-inicio"'), html.indexOf("MI IDENTIDAD"));
if (/<details[^>]*id="inTecnico"/.test(inicio)) ok("el estado técnico va plegado en <details>");
else mal("el estado técnico ya no está plegado");

for (const accion of ["ir-inventario", "escanear-codigo", "ir-chat"]) {
  if (inicio.includes('data-accion="' + accion + '"')) ok("acción «" + accion + "» presente en la portada");
  else mal("falta la acción «" + accion + "»");
}

const usados = (inicio.match(/data-ani-icono="([^"]+)"/g) || [])
  .map((s) => s.replace(/.*"([^"]+)".*/, "$1"));
if (usados.length >= 5) ok(usados.length + " fichas usan iconos animados");
else mal("muy pocas fichas con icono animado (" + usados.length + ")");

/* ── contexto mínimo para cargar marcas.js y d3-mini.js ────────────────── */
function Nodo(tag) {
  this.tagName = (tag || "div").toUpperCase();
  this._tag = tag || "div";
  this._attrs = {};
  this._hijos = [];
  this.id = ""; this.className = ""; this.textContent = ""; this.innerHTML = "";
  this.hidden = false; this.disabled = false; this.style = {}; this.dataset = {};
  this.children = this._hijos;
  this.classList = { add() {}, remove() {}, toggle() {}, contains() { return true; } };
  this.getBoundingClientRect = () => ({ width: 320, height: 160, top: 0, bottom: 160, left: 0, right: 320 });
}
Nodo.prototype.setAttribute = function (k, v) { this._attrs[k] = String(v); };
Nodo.prototype.removeAttribute = function (k) { delete this._attrs[k]; };
Nodo.prototype.hasAttribute = function (k) { return this._attrs[k] != null; };
Nodo.prototype.toggleAttribute = function (k, on) {
  if (on === undefined) on = this._attrs[k] == null;
  if (on) this._attrs[k] = ""; else delete this._attrs[k];
  return !!on;
};
Nodo.prototype.getAttribute = function (k) { return this._attrs[k] != null ? this._attrs[k] : null; };
Nodo.prototype.appendChild = function (h) { this._hijos.push(h); return h; };
Nodo.prototype.addEventListener = function () {};
Nodo.prototype.removeEventListener = function () {};
Nodo.prototype.querySelectorAll = function () { return []; };
Nodo.prototype.querySelector = function () { return null; };
Nodo.prototype.closest = function () { return null; };
Nodo.prototype.focus = function () {};
Nodo.prototype.getContext = function () { return null; };
Object.defineProperty(Nodo.prototype, "outerHTML", {
  get() {
    const attrs = Object.keys(this._attrs).map((k) => ' ' + k + '="' + this._attrs[k] + '"').join("");
    const hijos = this._hijos.map((h) => h.outerHTML || "").join("");
    return "<" + this._tag + attrs + ">" + (hijos || this.innerHTML) + "</" + this._tag + ">";
  }
});

const cache = new Map();
function nodoDe(id) {
  if (!cache.has(id)) { const n = new Nodo("div"); n.id = id; cache.set(id, n); }
  return cache.get(id);
}
// Huecos de iconos declarados en el HTML de la portada.
const huecos = (inicio.match(/data-ani-icono="([^"]+)"/g) || []).map((s, i) => {
  const n = new Nodo("span");
  n.dataset.aniIcono = s.replace(/.*"([^"]+)".*/, "$1");
  n.dataset.aniTam = "22";
  return n;
});

const document = {
  hidden: false, readyState: "complete",
  getElementById: (id) => (idsHtml.has(id) ? nodoDe(id) : null),
  createElement: (t) => new Nodo(t),
  createElementNS: (_ns, t) => new Nodo(t),
  createDocumentFragment: () => new Nodo("frag"),
  querySelectorAll(sel) {
    if (sel === "[data-ani-icono]") return huecos;
    return [];
  },
  querySelector() { return null; },
  addEventListener() {}, removeEventListener() {},
  body: new Nodo("body"), documentElement: new Nodo("html"), head: new Nodo("head")
};

const temporizadores = [];
const ctx = {
  console, document,
  setTimeout: (f) => { temporizadores.push(f); return temporizadores.length; },
  clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
  requestAnimationFrame() { return 0; }, cancelAnimationFrame() {},
  navigator: { userAgent: "node", onLine: true },
  location: { href: "https://appassets.local/index.html", origin: "https://appassets.local" },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  performance: { now: () => Date.now() },
  // El puente de la app (lo mínimo que usa la portada).
  esc: (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])),
  bytes: (n) => Math.round((Number(n) || 0) / 1048576) + " MB",
  revision: () => {},
  toast: () => {},
  jsError: () => {},
  nucleoPreparado: () => true,
  estadoApp: { vista: "inicio", sistema: null, global: {}, stats: { tokensLocal: 0, tokensApi: 0 } },
  apiTarde: () => Promise.resolve({ ok: true, data: {} }),
  FabrickNative: new Proxy({}, { get: () => () => JSON.stringify({ ok: true, data: {} }) })
};
ctx.window = ctx;
ctx.self = ctx;
ctx.globalThis = ctx;
ctx.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });

vm.createContext(ctx);
for (const f of ["d3-mini.js", "marcas.js", "inicio.js"]) {
  try {
    vm.runInContext(fs.readFileSync(WWW + "/" + f, "utf8"), ctx, { filename: f });
  } catch (e) {
    mal(f + " no carga: " + e.message);
  }
}

/* ── 1 · iconos y marcas referenciados ─────────────────────────────────── */
const ANI = ctx.ANI_ICONOS || {};
const MAR = ctx.MARCAS || {};
if (ctx.d3s && typeof ctx.d3s.sum === "function" && typeof ctx.d3s.pie === "function") ok("d3 expone sum/pie/arc/scaleBand/scaleLinear");
else mal("d3-mini.js no expone las funciones que usa la portada");

const iconosMalos = usados.filter((n) => !ANI[n]);
if (iconosMalos.length) mal("iconos animados inexistentes: " + iconosMalos.join(", "));
else ok("los " + usados.length + " iconos animados de las fichas existen en marcas.js");

const clavesMarcas = (inicio.match(/data-marcas="([^"]+)"/) || ["", ""])[1]
  .split(",").map((s) => s.trim()).filter(Boolean);
const marcasMalas = clavesMarcas.filter((k) => !MAR[k]);
if (marcasMalas.length) mal("marcas inexistentes en la tira: " + marcasMalas.join(", "));
else ok("las " + clavesMarcas.length + " marcas de la tira existen en MARCAS");

if (typeof ctx.aniIcono === "function" && ctx.aniIcono("barcode", 16).includes("data-ani=\"barcode\"")) ok("aniIcono() dibuja el SVG en línea");
else mal("aniIcono() no devuelve un SVG utilizable");

/* ── 2 · el arranque diferido no tocó el puente ────────────────────────── */
if (temporizadores.length) ok("el arranque de la portada queda diferido (" + temporizadores.length + " temporizador)");
else mal("la portada arrancó durante la carga");

/* ── 3 · pintado con datos reales ──────────────────────────────────────── */
const INICIO = ctx.INICIO;
// El contrato real es `INICIO.panel`: lo devuelve
// `apiTarde("inventario", { accion: "panel" })` (arm "panel" de op_inventario
// en Rust). Hasta 0.9.60 esto se llamaba `INICIO.datos`; desde 53bd551 la
// portada lee `panel.resumen` / `panel.categorias` / `panel.ventas`, así que
// con el campo viejo los KPIs salían en cero y los gráficos no se dibujaban.
INICIO.panel = {
  ok: true,
  generado: Math.floor(Date.now() / 1000),
  resumen: {
    total: 128, unidades: 310,
    valor_costo: 1450000, valor_venta: 2180000,
    utilidad_potencial: 730000, margen_promedio: 33.5,
    stock_bajo: 7, agotados: 3, sin_precio: 2, sin_costo: 1,
    pendientes_sync: 3
  },
  categorias: [{ categoria: "Bebidas", n: 40 }, { categoria: "Snacks", n: 33 },
    { categoria: "Aseo", n: 22 }, { categoria: "Lácteos", n: 20 }, { categoria: "Pan", n: 8 }, { categoria: "Otros", n: 5 }],
  ventas: {
    ultimas_24h: { n: 4, total: 31400, utilidad: 9700, unidades: 11 },
    ultimos_30d: { n: 62, total: 486300, utilidad: 151200, unidades: 178 },
    ticket_promedio: 7843.55,
    top_productos: [], historial: []
  },
  sync: { pendientes: 3, boletas_pendientes: 0, ultimo_ts: 0 }
};
const hoy = Math.floor(Date.now() / 1000);
INICIO.boletas = [
  { folio: 12, ts: hoy, total: 8500, items: [
    { codigo: "1", nombre: "Pan corriente", precio: 1500, cantidad: 3 },
    { codigo: "2", nombre: "Bebida 1.5L", precio: 2000, cantidad: 2 }] },
  { folio: 11, ts: hoy - 86400, total: 6200, items: [
    { codigo: "2", nombre: "Bebida 1.5L", precio: 2000, cantidad: 1 },
    { codigo: "3", nombre: "Papas fritas", precio: 1200, cantidad: 2 }] },
  { folio: 10, ts: hoy - 3 * 86400, total: 5100, items: [
    { codigo: "1", nombre: "Pan corriente", precio: 1500, cantidad: 2 }] }
];
INICIO.actualizado = Date.now();

try { ctx.inicioPintar(true, true); } catch (e) { mal("inicioPintar lanzó: " + e.message); }

const kpis = nodoDe("inKpis").innerHTML;
// Desde el rediseño de 0.9.60 (53bd551) los KPI cambian de rótulo: ya no
// dicen «Productos» ni «Stock bajo», dicen «Valor del inventario» y
// «Stock en riesgo». El dato real sí tiene que aparecer: 128 productos y 7
// en riesgo marcado con la clase de alerta.
if (/Valor del inventario/.test(kpis) && /128 productos/.test(kpis)) ok("los KPIs se pintan con el resumen real");
else mal("los KPIs salieron vacíos");
if (/Utilidad potencial/.test(kpis) && /\$730\.000/.test(kpis)) ok("la utilidad se formatea en pesos");
else mal("la utilidad no se formateó");
if (/Stock en riesgo/.test(kpis) && /in-kpi--alerta/.test(kpis)) ok("el stock bajo se destaca");
else mal("el stock bajo no se destaca");

const chVentas = nodoDe("inChartVentas").innerHTML;
if (/<svg/.test(chVentas) && /in-barra/.test(chVentas) && /lun|mar|mié|jue|vie|sáb|dom/.test(chVentas)) ok("el gráfico de ventas es SVG con barras y sus 14 días");
else mal("el gráfico de ventas no se dibujó");

const chCat = nodoDe("inChartCategorias").innerHTML;
const pieCat = nodoDe("inChartCategoriasPie").textContent || nodoDe("inChartCategoriasPie").innerHTML;
if (/in-lista-item/.test(chCat) && /in-lista-barra/.test(chCat) && /Bebidas/.test(chCat) && /6 categoría/.test(pieCat)) ok("categorías: lista con barras proporcionales y su pie");
else mal("las categorías no se dibujaron: " + pieCat.slice(0, 80));

const chTop = nodoDe("inChartTop").innerHTML;
if (/in-lista-item/.test(chTop) && /Pan corriente/.test(chTop) && /5 u/.test(chTop)) ok("los más vendidos agrupan los ítems de las boletas");
else mal("la tabla de más vendidos no se pintó");

const nota = nodoDe("inDatosNota").textContent;
if (/128 producto/.test(nota) && /3 boleta/.test(nota)) ok("la nota declara cuántos datos leyó");
else mal("la nota de estado no informa los datos leídos: " + nota);

/* ── 4 · estado vacío honesto ──────────────────────────────────────────── */
INICIO.panel = {
  ok: true,
  resumen: { total: 0, unidades: 0, valor_costo: 0, valor_venta: 0,
    utilidad_potencial: 0, margen_promedio: 0, stock_bajo: 0, agotados: 0,
    sin_precio: 0, sin_costo: 0, pendientes_sync: 0 },
  categorias: [],
  ventas: { ultimas_24h: { n: 0, total: 0, utilidad: 0, unidades: 0 },
    ultimos_30d: { n: 0, total: 0, utilidad: 0, unidades: 0 },
    ticket_promedio: 0, top_productos: [], historial: [] }
};
INICIO.boletas = [];
try { ctx.inicioPintar(true, true); } catch (e) { mal("inicioPintar sin datos lanzó: " + e.message); }
const vacio = nodoDe("inChartVentas").innerHTML + nodoDe("inChartCategorias").innerHTML + nodoDe("inChartTop").innerHTML;
// `in-barra` es la clase real de las barras desde 0.9.60; comprobar una clase
// que ya no existe («d3-barra») dejó esta comprobación sin dientes.
if (/Sin ventas aún|Sin categorías|Sin ventas/.test(vacio) && !/class="in-barra"/.test(vacio)) ok("sin datos muestra el estado vacío, sin inventar cifras");
else mal("sin datos no se muestra un estado vacío claro");
if (/Aún no hay productos/.test(nodoDe("inDatosNota").textContent)) ok("sin datos se invita a abrir Inventario");
else mal("no se guía al usuario cuando no hay datos");

console.log();
if (fallos === 0) { console.log("\u001b[1;32m✔ portada de inicio: todo en orden\u001b[0m"); process.exitCode = 0; }
else { console.log("\u001b[1;31m✖ " + fallos + " fallo(s) en la portada\u001b[0m"); process.exitCode = 1; }
