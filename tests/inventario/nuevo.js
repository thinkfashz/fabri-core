#!/usr/bin/env node
/* =============================================================================
   Inventario · importación, apilador, catálogo y boleta
   -----------------------------------------------------------------------------
   Lo que se comprueba (todo sobre el código real de inventario.js):

     1. `invParseImportacion` entiende CSV con `;`, TSV, JSON y archivos sin
        encabezado, y respeta el formato chileno de números (1.490 / 1.234,56).
     2. `invBarrasSvg` dibuja EAN-13 válido y Code 39 para lo que no lo es.
     3. `invTicketCuerpo` arma la boleta con detalle, totales, código de barras
        del folio y el «¡GRACIAS POR SU COMPRA!».
     4. El apilador deduplica por código y suma cantidad.
     5. El marcado (index.html) tiene los controles nuevos: importar, apilador,
        OCR y los botones de verificación del registro.

   Uso:  node tests/inventario/nuevo.js
   ========================================================================== */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const WWW = path.resolve(__dirname, "../../android/assets/www");
const ARCHIVOS = [
  "diagnostico.js", "app.js", "datos.js", "conexiones.js",
  "inventario.js", "identidad.js", "flujo.js"
];

let fallos = 0;
const ok = (t) => console.log("  \u001b[1;32m✔\u001b[0m " + t);
const mal = (t) => { console.log("  \u001b[1;31m✖\u001b[0m " + t); fallos++; };
const igual = (a, b, etiqueta) => {
  if (a === b) ok(etiqueta + " = " + JSON.stringify(b));
  else mal(etiqueta + ": esperaba " + JSON.stringify(b) + ", llegó " + JSON.stringify(a));
};

function nodo(id) {
  return {
    id: id || "", hidden: false, textContent: "", innerHTML: "", className: "", value: "",
    title: "", style: {}, dataset: {}, disabled: false, children: [], options: [], files: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null; },
    appendChild() {}, insertAdjacentHTML() {}, focus() {}, click() {}, remove() {},
    closest() { return null; }, querySelectorAll() { return []; }, querySelector() { return null; },
    offsetWidth: 1, scrollTop: 0, scrollHeight: 0, childElementCount: 0, tagName: "DIV",
    width: 0, height: 0,
    getContext() { return { clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, arcTo() {},
      stroke() {}, fill() {}, fillRect() {}, save() {}, restore() {}, clip() {}, fillText() {},
      setTransform() {}, createLinearGradient() { return { addColorStop() {} }; } }; },
    getBoundingClientRect() { return { width: 320, height: 240, top: 0, left: 0 }; },
    toDataURL() { return ""; }, play() {}, pause() {}
  };
}

function sandbox() {
  const idsHtml = new Set();
  const html = fs.readFileSync(WWW + "/index.html", "utf8");
  let m; const re = /id="([^"]+)"/g;
  while ((m = re.exec(html))) idsHtml.add(m[1]);

  const cache = new Map();
  const document = {
    hidden: false, readyState: "complete",
    getElementById(id) {
      if (!idsHtml.has(id)) return null;
      if (!cache.has(id)) cache.set(id, nodo(id));
      return cache.get(id);
    },
    querySelectorAll() { return []; }, querySelector() { return null; },
    addEventListener() {}, removeEventListener() {},
    createElement(t) { return nodo(t); }, createElementNS() { return nodo("ns"); },
    createDocumentFragment() { return nodo("frag"); },
    body: nodo("body"), documentElement: nodo("html"), head: nodo("head")
  };

  const ctx = {
    console, document,
    setTimeout, clearTimeout, setInterval() { return 0; }, clearInterval() {},
    navigator: { userAgent: "node", onLine: true, mediaDevices: null },
    location: { href: "https://appassets.local/index.html", origin: "https://appassets.local", protocol: "https:" },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    requestAnimationFrame() { return 0; }, cancelAnimationFrame() {},
    alert() {}, confirm() { return true; }, prompt() { return null; },
    performance: { now() { return Date.now(); } },
    AbortController,
    Image: function () { return nodo("img"); },
    Audio: function () { return nodo("audio"); },
    Blob: function () {}, URL: { createObjectURL() { return ""; }, revokeObjectURL() {} },
    fetch: () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }),
    TextDecoder: function () {}, TextEncoder: function () {},
    matchMedia() { return { matches: false, addEventListener() {}, addListener() {} }; }
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  ctx.addEventListener = function () {};
  ctx.removeEventListener = function () {};
  ctx.scrollTo = function () {};
  ctx.FabrickNative = new Proxy({}, {
    get(_, prop) {
      if (prop === "nucleoListo") return function () { return JSON.stringify({ listo: true }); };
      if (prop === "ocrEstado") {
        return function () { return JSON.stringify({ ok: true, disponible: false, motivo: "prueba" }); };
      }
      return function () { return JSON.stringify({ ok: true, data: {} }); };
    }
  });

  vm.createContext(ctx);
  for (const f of ARCHIVOS) {
    vm.runInContext(fs.readFileSync(WWW + "/" + f, "utf8"), ctx, { filename: f });
  }
  return ctx;
}

/* ── 1 · importación ───────────────────────────────────────────────────── */
function pruebaImportacion(ctx) {
  console.log("▸ invParseImportacion · CSV, TSV, JSON y números chilenos");

  const csv = [
    "Producto;Codigo de barras;Precio;Existencia;Marca;Categoria",
    "Arroz grado 1;7801234567890;1.490;24;Tucapel;Alimentos",
    "Aceite 1L;7809876543210;2.390;8;Chef;Alimentos",
    "Jabón;7801111111111;890;12;Dove;Cosmética"
  ].join("\n");
  const r = ctx.invParseImportacion(csv);
  igual(r.productos.length, 3, "CSV: productos");
  igual(r.formato, "CSV", "CSV: formato");
  igual(r.productos[0].nombre, "Arroz grado 1", "CSV: nombre");
  igual(r.productos[0].precio, 1490, "CSV: precio 1.490");
  igual(r.productos[0].stock, 24, "CSV: stock");
  igual(r.productos[0].categoria, "abarrotes", "CSV: categoría (Alimentos → abarrotes)");
  igual(r.productos[2].categoria, "cosmetica", "CSV: categoría (Cosmética)");

  const tsv = "nombre\tcodigo\tprecio\tstock\nLeche\t7801\t1.290\t6";
  const rt = ctx.invParseImportacion(tsv);
  igual(rt.formato, "TSV", "TSV: formato");
  igual(rt.productos[0].nombre, "Leche", "TSV: nombre");
  igual(rt.productos[0].precio, 1290, "TSV: precio");

  const json = JSON.stringify([
    { descripcion: "Café molido", barcode: "7802222222222", pvp: "3.490", existencia: "5", marca: "Juan Valdez" },
    { name: "Azúcar", codigo: "", precio: "1.234,56", cantidad: 3 }
  ]);
  const rj = ctx.invParseImportacion(json);
  igual(rj.formato, "JSON", "JSON: formato");
  igual(rj.productos.length, 2, "JSON: productos");
  igual(rj.productos[0].nombre, "Café molido", "JSON: alias descripcion/barcode/pvp");
  igual(rj.productos[0].precio, 3490, "JSON: pvp 3.490");
  igual(rj.productos[1].precio, 1234.56, "JSON: precio 1.234,56");
  if (/^IMP-/.test(rj.productos[1].codigo)) ok("JSON: código vacío se autogenera");
  else mal("JSON: código vacío no se autogeneró: " + rj.productos[1].codigo);

  const sinCabecera = "7801;Pan corriente;990;10";
  const rs = ctx.invParseImportacion(sinCabecera);
  igual(rs.productos.length, 1, "sin encabezado: productos");
  igual(rs.productos[0].codigo, "7801", "sin encabezado: código");
  igual(rs.productos[0].nombre, "Pan corriente", "sin encabezado: nombre");

  const vacio = ctx.invParseImportacion("   ");
  igual(vacio.productos.length, 0, "texto vacío: sin productos");

  // Filas sin nombre se omiten y se informan.
  const conError = "nombre;precio\n;100\nBien;200";
  const re2 = ctx.invParseImportacion(conError);
  igual(re2.productos.length, 1, "fila sin nombre omitida");
  igual(re2.errores.length, 1, "fila sin nombre informada");
}

/* ── 2 · código de barras ──────────────────────────────────────────────── */
function pruebaBarras(ctx) {
  console.log("▸ invBarrasSvg · EAN-13 válido y Code 39");

  // 7801234567894 tiene dígito de control válido (se comprueba aquí mismo).
  if (ctx.invEanValido("7801234567894")) ok("EAN de prueba válido");
  else mal("el EAN de prueba no valida");

  const ean = ctx.invBarrasSvg("7801234567894", 26);
  if (ean.indexOf("<svg") === 0) ok("EAN-13 produce SVG");
  else mal("EAN-13 no produce SVG: " + ean.slice(0, 40));
  if (ean.indexOf("viewBox=\"0 0 95 26\"") >= 0) ok("EAN-13 usa 95 módulos");
  else mal("EAN-13 con ancho inesperado: " + (ean.match(/viewBox="[^"]+"/) || [""])[0]);
  if ((ean.match(/<rect/g) || []).length > 20) ok("EAN-13 dibuja barras");
  else mal("EAN-13 sin barras suficientes");

  const c39 = ctx.invBarrasSvg("ABC-123", 20);
  if (c39.indexOf("<svg") === 0 && (c39.match(/<rect/g) || []).length > 10) ok("Code 39 produce barras");
  else mal("Code 39 no produce barras");

  igual(ctx.invBarrasSvg("", 20), "", "código vacío: sin SVG");

  const bits = ctx.invBitsCode39("ab");
  if (/^[01]+$/.test(bits) && bits.indexOf("0") >= 0) ok("Code 39 entrega módulos binarios");
  else mal("Code 39 con módulos inválidos");
}

/* ── 3 · boleta ────────────────────────────────────────────────────────── */
function pruebaTicket(ctx) {
  console.log("▸ invTicketCuerpo · detalle, totales, barras y «gracias»");

  const b = {
    folio: 42, fecha: 1700000000, cliente: "Ana Pérez", rut: "12.345.678-9",
    pago: "débito",
    items: [
      { nombre: "Arroz grado 1", precio: 1490, cantidad: 2 },
      { nombre: "Leche", precio: 1290, cantidad: 1 }
    ],
    neto: 3588, iva: 682, total: 4270
  };
  const h = ctx.invTicketCuerpo(b, {});
  if (h.indexOf("GRACIAS POR SU COMPRA") >= 0) ok("incluye el agradecimiento");
  else mal("falta el agradecimiento");
  if (h.indexOf("Arroz grado 1") >= 0 && h.indexOf("2 × $1.490") >= 0) ok("incluye detalle con cantidad y unitario");
  else mal("falta el detalle del ítem");
  if (h.indexOf("$4.270") >= 0) ok("incluye el total formateado");
  else mal("falta el total: " + h.match(/\$[\d.]+/g));
  if (h.indexOf("<svg") >= 0) ok("incluye código de barras del folio");
  else mal("falta el código de barras");
  if (h.indexOf("Ana Pérez") >= 0 && h.indexOf("N° 42") >= 0) ok("incluye cliente y folio");
  else mal("falta cliente o folio");

  const v = ctx.invTicketCuerpo({ folio: "—", items: [], neto: 0, iva: 0, total: 0 }, { vista: true });
  if (v.indexOf("vista previa") >= 0) ok("la vista previa se distingue de la emitida");
  else mal("la vista previa no se distingue");

  const doc = ctx.invBoletaDocumento(b, "80mm");
  if (doc.indexOf("@page") >= 0 && doc.indexOf("72mm") >= 0) ok("documento de impresión con @page 80mm");
  else mal("documento de impresión sin @page correcto");
  if (doc.indexOf("GRACIAS POR SU COMPRA") >= 0) ok("el documento impreso también agradece");
  else mal("el documento impreso no agradece");
}

/* ── 4 · apilador ──────────────────────────────────────────────────────── */
function pruebaApilador(ctx) {
  console.log("▸ apilador · deduplica y suma cantidad");

  ctx.INV.productos = [{
    codigo: "7801", nombre: "Prueba", marca: "M", precio: 1000,
    categoria: "abarrotes", stock: 1, stock_minimo: 0, ficha: {}
  }];
  ctx.INV.apilador = [];
  ctx.invApiladorAgregar("7801");
  ctx.invApiladorAgregar("7801");
  igual(ctx.INV.apilador.length, 1, "una sola fila por código repetido");
  igual(ctx.INV.apilador[0].cantidad, 2, "cantidad acumulada");
  igual(ctx.INV.apilador[0].nombre, "Prueba", "nombre tomado de la base local");
  igual(ctx.INV.apilador[0].resuelto, true, "marcado como resuelto");

  ctx.invApiladorQuitar(0);
  igual(ctx.INV.apilador.length, 0, "quitar una fila");
  ctx.INV.apilador = [{ codigo: "1" }];
  ctx.invApiladorLimpiar();
  igual(ctx.INV.apilador.length, 0, "vaciar el apilador");

  const card = ctx.invCardHtml(ctx.INV.productos[0]);
  if (card.indexOf("inv-card") >= 0 && card.indexOf("<svg") >= 0 && card.indexOf("7801") >= 0) {
    ok("la tarjeta de catálogo lleva miniatura, barras y código");
  } else mal("la tarjeta de catálogo está incompleta");
}

/* ── 5 · marcado ───────────────────────────────────────────────────────── */
function pruebaMarcado() {
  console.log("▸ index.html · controles nuevos");
  const html = fs.readFileSync(WWW + "/index.html", "utf8");
  const ids = [
    "btnInvImportar", "invImportarPanel", "invImportarTexto", "btnInvImportarEjecutar",
    "btnInvApiladorGuardarLote", "btnInvApiladorLimpiar", "invApiladorLista",
    "btnInvModoNormal", "btnInvModoApilador", "invOcrPanel", "btnInvOcr",
    "btnRevisionVerificar", "btnRevisionLimpiar", "invOcrTexto"
  ];
  const faltan = ids.filter((id) => html.indexOf('id="' + id + '"') < 0);
  if (!faltan.length) ok("están los " + ids.length + " controles nuevos");
  else mal("faltan controles: " + faltan.join(", "));
  if (html.indexOf("🔍") < 0 && html.indexOf("🖨️") < 0) ok("sin emoji en el módulo (iconos SVG)");
  else mal("quedan emoji en el marcado");
}

function main() {
  const ctx = sandbox();
  pruebaImportacion(ctx);
  pruebaBarras(ctx);
  pruebaTicket(ctx);
  pruebaApilador(ctx);
  pruebaMarcado();

  console.log("");
  if (fallos === 0) {
    console.log("\u001b[1;32m✔ importación, apilador, catálogo y boleta: todo en orden\u001b[0m");
    process.exit(0);
  }
  console.log("\u001b[1;31m✖ " + fallos + " fallo(s)\u001b[0m");
  process.exit(1);
}

main();