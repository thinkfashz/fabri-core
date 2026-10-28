#!/usr/bin/env node
/* =============================================================================
   Inventario · equipos del local (impresora WiFi, lector, base de la SD)
   -----------------------------------------------------------------------------
   Lo que se comprueba sobre el código real:

     1. Impresora ESC/POS: CP1252, ancho de 58 mm, comandos de inicio, corte y
        código de barras. `imprimirPrueba` manda bytes por WiFi y NO abre el
        diálogo de Android.
     2. Tarjeta «Equipos del local»: guardar refleja IP, puerto y chip.
     3. Lector: deduplicación de 1,2 s, acción buscar/apilador, servidor TCP y
        apagado.
     4. Importación nativa: XLSX y SQLite llegan a la vista previa reutilizando
        los alias de columnas; el texto sigue funcionando.
     5. Guía de InsForge: sin configurar avisa, con nube responde el resumen.
     6. Marcado y estilos: están los controles, los scripts y las clases.

   Uso:  node tests/inventario/equipos.js
   ========================================================================== */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const WWW = path.resolve(__dirname, "../../android/assets/www");
const ARCHIVOS = [
  "inventario.js", "impresora.js", "lector-red.js", "importar-base.js",
  "insforge.js"
];

let fallos = 0;
const ok = (t) => console.log("  \u001b[1;32m✔\u001b[0m " + t);
const mal = (t) => { console.log("  \u001b[1;31m✖\u001b[0m " + t); fallos++; };
const igual = (a, b, etiqueta) => {
  if (a === b) ok(etiqueta + " = " + JSON.stringify(b));
  else mal(etiqueta + ": esperaba " + JSON.stringify(b) + ", llegó " + JSON.stringify(a));
};
const cierto = (v, etiqueta) => { if (v) ok(etiqueta); else mal(etiqueta); };

function nodo(id) {
  return {
    id: id || "", hidden: false, textContent: "", innerHTML: "", className: "", value: "",
    title: "", style: {}, dataset: {}, disabled: false, children: [], options: [], files: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null; },
    appendChild() {}, removeChild() {}, insertAdjacentHTML() {}, focus() {}, click() {}, remove() {},
    closest() { return null; }, querySelectorAll() { return []; }, querySelector() { return null; },
    select() {}, offsetWidth: 1, scrollTop: 0, scrollHeight: 0, childElementCount: 0,
    tagName: "DIV", width: 0, height: 0,
    getContext() { return { clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, arcTo() {},
      stroke() {}, fill() {}, fillRect() {}, save() {}, restore() {}, clip() {}, fillText() {},
      setTransform() {}, createLinearGradient() { return { addColorStop() {} }; } }; },
    getBoundingClientRect() { return { width: 320, height: 240, top: 0, left: 0 }; },
    toDataURL() { return ""; }, play() {}, pause() {}, scrollIntoView() {}
  };
}

function sandbox() {
  const idsHtml = new Set();
  const html = fs.readFileSync(WWW + "/index.html", "utf8");
  let m; const re = /id="([^"]+)"/g;
  while ((m = re.exec(html))) idsHtml.add(m[1]);

  const cache = new Map();
  const almacen = new Map();
  const llamadas = [];
  const toasts = [];

  const document = {
    hidden: false, readyState: "complete",
    getElementById(id) {
      if (!idsHtml.has(id)) return null;
      if (!cache.has(id)) cache.set(id, nodo(id));
      return cache.get(id);
    },
    querySelectorAll(sel) {
      if (sel === "[data-copiar]") return [];
      return [];
    },
    querySelector() { return null; },
    addEventListener() {}, removeEventListener() {},
    createElement(t) { return nodo(t); }, createElementNS() { return nodo("ns"); },
    createDocumentFragment() { return nodo("frag"); },
    execCommand() { return true; },
    body: nodo("body"), documentElement: nodo("html"), head: nodo("head")
  };

  const ctx = {
    console, document,
    setTimeout, clearTimeout, setInterval() { return 0; }, clearInterval() {},
    navigator: { userAgent: "node", onLine: true, mediaDevices: null, vibrate() {} },
    location: { href: "https://appassets.local/index.html", origin: "https://appassets.local", protocol: "https:" },
    localStorage: {
      getItem(k) { return almacen.has(k) ? almacen.get(k) : null; },
      setItem(k, v) { almacen.set(k, String(v)); },
      removeItem(k) { almacen.delete(k); }
    },
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
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    matchMedia() { return { matches: false, addEventListener() {}, addListener() {} }; }
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  ctx.addEventListener = function () {};
  ctx.removeEventListener = function () {};
  ctx.scrollTo = function () {};

  ctx.toast = function (texto, tipo) { toasts.push({ texto: texto, tipo: tipo || "" }); };
  ctx.revision = function () {};
  ctx.esc = function (s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  };

  ctx.FabrickNative = new Proxy({}, {
    get(_, prop) {
      if (prop === "nucleoListo") return function () { return JSON.stringify({ listo: true }); };
      if (prop === "ocrEstado") {
        return function () { return JSON.stringify({ ok: true, disponible: false, motivo: "prueba" }); };
      }
      if (prop === "ipLocal") {
        return function () { return JSON.stringify({ ok: true, ip: "192.168.1.77" }); };
      }
      if (prop === "imprimirWifi") {
        return function (host, puerto, b64, ms) {
          llamadas.push({ metodo: prop, args: [host, puerto, b64, ms] });
          return JSON.stringify({ ok: true, bytes: Buffer.from(b64, "base64").length, ms: 42 });
        };
      }
      if (prop === "probarImpresora") {
        return function (host, puerto) {
          llamadas.push({ metodo: prop, args: [host, puerto] });
          return JSON.stringify({ ok: true, ms: 12, responde_estado: true, estado: "en línea" });
        };
      }
      if (prop === "buscarImpresoras") {
        return function () {
          llamadas.push({ metodo: prop, args: [] });
          return JSON.stringify({ ok: true, red: "192.168.1.0/24", encontradas: [{ host: "192.168.1.50" }] });
        };
      }
      if (prop === "lectorIniciar") {
        return function (modo, host, puerto) {
          llamadas.push({ metodo: prop, args: [modo, host, puerto] });
          return JSON.stringify({ ok: true, modo: modo, ip_local: "192.168.1.77", instruccion: "escuchando" });
        };
      }
      if (prop === "lectorDetener") {
        return function () { llamadas.push({ metodo: prop, args: [] }); return JSON.stringify({ ok: true }); };
      }
      if (prop === "lectorEstado") {
        return function () {
          return JSON.stringify({ ok: true, ip_local: "192.168.1.77", servidor_activo: false, cliente_activo: false, lineas: 0 });
        };
      }
      if (prop === "leerTablaBase") {
        return function (tabla, limite) {
          llamadas.push({ metodo: prop, args: [tabla, limite] });
          return JSON.stringify({
            ok: true, tabla: tabla, total: 2, truncado: false,
            filas: [
              { nombre: "Arroz grado 1", codigo: "7801234567890", precio: 1490, stock: 24 },
              { nombre: "Aceite 1 L", codigo: "7809876543210", precio: 3290, stock: 8 }
            ]
          });
        };
      }
      return function () { return JSON.stringify({ ok: true, data: {} }); };
    }
  });

  vm.createContext(ctx);
  for (const f of ARCHIVOS) {
    vm.runInContext(fs.readFileSync(WWW + "/" + f, "utf8"), ctx, { filename: f });
  }
  ctx.__llamadas = llamadas;
  ctx.__toasts = toasts;
  ctx.__almacen = almacen;
  ctx.__ids = idsHtml;
  return ctx;
}

/* ── 1 · impresora ─────────────────────────────────────────────────────── */
function pruebaImpresora(ctx) {
  console.log("▸ impresora ESC/POS · CP1252, ancho y comandos");

  const cfg = ctx.FabriImpresora.config();
  igual(cfg.host, "", "config: sin IP por defecto");
  igual(cfg.puerto, 9100, "config: puerto 9100");
  igual(cfg.formato, "58mm", "config: 58 mm");
  igual(cfg.ancho, 32, "config: 32 caracteres");
  igual(cfg.corte, true, "config: corte activo");

  const acentos = ctx.FabriImpresora.bytesTexto("Electrónico Ñ €", false);
  cierto(acentos.indexOf(0xF3) >= 0, "CP1252: ó = 0xF3");
  cierto(acentos.indexOf(0xD1) >= 0, "CP1252: Ñ = 0xD1");
  cierto(acentos.indexOf(0x80) >= 0, "CP1252: € = 0x80");
  const plano = ctx.FabriImpresora.bytesTexto("Electrónico Ñ", true);
  cierto(plano.indexOf(0xF3) < 0 && plano.indexOf(0xD1) < 0, "ASCII: sin bytes altos");

  const lineas = ctx.FabriImpresora.envolver(
    "Arroz grado 1 con bolsa familiar de 1 kilogramo y algo más para pasar el ancho", 32);
  cierto(lineas.every((l) => l.length <= 32), "envolver: ninguna línea pasa de 32");

  const bytes = ctx.FabriImpresora.ticketBoleta({
    folio: 42, fecha: 1700000000, cliente: "Ana Pérez", rut: "12.345.678-9",
    pago: "débito", items: [{ nombre: "Arroz grado 1", precio: 1490, cantidad: 2 }],
    neto: 2504, iva: 476, total: 2980
  }, { nombre: "Almacén Doña Rosa", rut: "76.543.210-K" }, { ancho: 32, corte: true });

  cierto(bytes[0] === 0x1B && bytes[1] === 0x40, "ticket: inicia con ESC @");
  cierto(bytes[2] === 0x1B && bytes[3] === 0x74 && bytes[4] === 16, "ticket: selecciona WPC1252");
  const cola = bytes.slice(-4);
  cierto(cola[0] === 0x1D && cola[1] === 0x56 && cola[2] === 0x42 && cola[3] === 0x00,
    "ticket: corta con GS V 66 0");
  let hayBarras = false;
  for (let i = 0; i < bytes.length - 2; i++) {
    if (bytes[i] === 0x1D && bytes[i + 1] === 0x6B && bytes[i + 2] === 0x49) hayBarras = true;
  }
  cierto(hayBarras, "ticket: código de barras CODE128 (GS k 73)");
  cierto(bytes.indexOf(0xF3) >= 0 || bytes.indexOf(0xE9) >= 0, "ticket: acentos en un solo byte");

  // Guardar desde la UI refleja la tarjeta.
  ctx.document.getElementById("invImpHost").value = "192.168.1.50";
  ctx.document.getElementById("invImpPuerto").value = "9100";
  ctx.document.getElementById("invImpAncho").value = "58mm";
  ctx.document.getElementById("invImpCorte").value = "1";
  ctx.document.getElementById("invImpCodepage").value = "16";
  ctx.document.getElementById("invImpDestino").value = "wifi";
  igual(ctx.FabriImpresora.guardar(), true, "guardar: acepta IP privada");
  const tarjeta = ctx.document.getElementById("invEquipoImpresora").textContent;
  cierto(tarjeta.indexOf("192.168.1.50:9100") === 0, "tarjeta: muestra IP y puerto");
  igual(ctx.document.getElementById("invEquipoImpresoraChip").textContent, "WiFi", "tarjeta: chip WiFi");

  // Prueba real por WiFi: usa el puente, no el diálogo.
  const antes = ctx.__llamadas.length;
  const r = ctx.FabriImpresora.imprimirPrueba({ nombre: "Almacén Doña Rosa" });
  igual(r.ok, true, "imprimirPrueba: responde ok");
  const llamada = ctx.__llamadas.slice(antes).filter((x) => x.metodo === "imprimirWifi")[0];
  cierto(!!llamada, "imprimirPrueba: llama a imprimirWifi");
  if (llamada) {
    igual(llamada.args[0], "192.168.1.50", "imprimirPrueba: host");
    igual(llamada.args[1], 9100, "imprimirPrueba: puerto");
    const enviado = Buffer.from(llamada.args[2], "base64");
    cierto(enviado[0] === 0x1B && enviado[1] === 0x40, "imprimirPrueba: bytes ESC/POS");
    cierto(enviado.slice(-4).join(",") === "29,86,66,0", "imprimirPrueba: incluye corte");
  }

  const probar = ctx.FabriImpresora.probar();
  igual(probar.ok, true, "probar: conexión");
  const probarLlamada = ctx.__llamadas.filter((x) => x.metodo === "probarImpresora").pop();
  igual(probarLlamada.args[0], "192.168.1.50", "probar: usa la IP guardada");

  const buscar = ctx.FabriImpresora.buscar();
  igual(buscar.encontradas.length, 1, "buscar: una impresora");
  ctx.FabriImpresora.descubiertas(buscar);
  const salida = ctx.document.getElementById("invImpSalida").innerHTML;
  cierto(salida.indexOf("192.168.1.50") >= 0, "descubiertas: pinta la IP encontrada");
}

/* ── 2 · lector ────────────────────────────────────────────────────────── */
function pruebaLector(ctx) {
  console.log("▸ lector 2D · deduplicación, acciones y TCP");

  const cfg = ctx.FabriLector.config();
  igual(cfg.modo, "servidor", "lector: modo servidor por defecto");
  igual(cfg.puerto, 9101, "lector: puerto 9101");
  igual(cfg.accion, "buscar", "lector: acción buscar");

  const buscados = [];
  ctx.invBuscarCodigo = function (codigo) { buscados.push(codigo); };

  const r1 = ctx.FabriLector.procesar("7801234567890", "red 192.168.1.60");
  igual(r1.ok, true, "procesar: acepta el código");
  igual(buscados.length, 1, "procesar: busca el producto");
  igual(buscados[0], "7801234567890", "procesar: mismo código");

  const r2 = ctx.FabriLector.procesar("7801234567890", "red");
  igual(r2.duplicado, true, "procesar: deduplica en menos de 1,2 s");
  igual(buscados.length, 1, "procesar: no vuelve a buscar");

  ctx.FabriLector.procesar("7809876543210", "red");
  igual(buscados.length, 2, "procesar: otro código sí pasa");

  // Apilador
  ctx.INV.modoApilador = false;
  ctx.INV.apilador = [];
  ctx.invApiladorAgregar = function (codigo) { ctx.INV.apilador.push({ codigo: codigo }); };
  ctx.localStorage.setItem("fabrick.lector.accion", "apilador");
  ctx.FabriLector.procesar("7801111111111", "red");
  igual(ctx.INV.modoApilador, true, "apilador: activa el modo");
  igual(ctx.INV.apilador.length, 1, "apilador: suma la lectura");
  ctx.localStorage.setItem("fabrick.lector.accion", "buscar");

  // Servidor TCP
  const antes = ctx.__llamadas.length;
  ctx.document.getElementById("invLectorModo").value = "servidor";
  ctx.document.getElementById("invLectorPuerto").value = "9101";
  const ini = ctx.FabriLector.iniciar();
  igual(ini.ok, true, "iniciar: servidor encendido");
  const llamada = ctx.__llamadas.slice(antes).filter((x) => x.metodo === "lectorIniciar")[0];
  igual(llamada.args[0], "servidor", "iniciar: modo servidor");
  igual(llamada.args[2], 9101, "iniciar: puerto 9101");
  igual(ctx.document.getElementById("invEquipoLectorChip").textContent, "activo", "tarjeta: chip activo");

  const det = ctx.FabriLector.detener();
  igual(det.ok, true, "detener: apaga");
  igual(ctx.document.getElementById("invEquipoLectorChip").textContent, "—", "tarjeta: chip apagado");

  // Cliente sin IP no inventa una conexión.
  ctx.document.getElementById("invLectorModo").value = "cliente";
  ctx.document.getElementById("invLectorHost").value = "";
  const malo = ctx.FabriLector.iniciar();
  igual(malo.ok, false, "cliente sin IP: rechaza");

  // Callback del motor nativo.
  const antesLinea = buscados.length;
  ctx.FabriLector.linea({ codigo: "7802222222222", origen: "servidor", ip: "192.168.1.60" });
  igual(buscados.length, antesLinea + 1, "linea: procesa la lectura nativa");
  igual(buscados[buscados.length - 1], "7802222222222", "linea: código correcto");
}

/* ── 3 · importación nativa ────────────────────────────────────────────── */
async function pruebaImportar(ctx) {
  console.log("▸ importación nativa · XLSX, SQLite y texto");

  const r = ctx.invImportarFilas(
    ["Descripción", "EAN", "Precio", "Existencia"],
    [["Arroz grado 1", "7801234567890", "1.490", "24"]],
    "prueba");
  igual(r.productos.length, 1, "invImportarFilas: un producto");
  igual(r.productos[0].nombre, "Arroz grado 1", "invImportarFilas: alias Descripción");
  igual(r.productos[0].codigo, "7801234567890", "invImportarFilas: alias EAN");
  igual(r.productos[0].precio, 1490, "invImportarFilas: precio chileno");

  ctx.FabriImportar.base({
    ok: true, tipo: "xlsx", archivo: "productos.xlsx", bytes: 4096,
    hojas: [{
      nombre: "Productos", total: 2, truncada: false,
      filas: [
        ["Nombre", "Código", "Precio", "Stock"],
        ["Arroz grado 1", "7801234567890", "1490", "24"]
      ]
    }],
    recomendada: "Productos"
  });
  await new Promise((res) => setTimeout(res, 120));
  igual(ctx.INV.importarNativo, true, "xlsx: marca importación nativa");
  igual(ctx.INV.importar.productos.length, 1, "xlsx: un producto mapeado");
  igual(ctx.INV.importar.productos[0].nombre, "Arroz grado 1", "xlsx: nombre");
  igual(ctx.INV.importar.productos[0].precio, 1490, "xlsx: precio");
  cierto(ctx.document.getElementById("invBaseMuestra").innerHTML.indexOf("inv-tabla") >= 0,
    "xlsx: pinta la muestra");
  cierto(ctx.document.getElementById("invBaseSelector").hidden === false,
    "xlsx: muestra el selector de hoja");

  ctx.FabriImportar.base({
    ok: true, tipo: "sqlite", archivo: "eleventa.db", bytes: 8192,
    tablas: [{
      nombre: "productos", filas: 2, columnas: ["nombre", "codigo", "precio", "stock"],
      muestra: []
    }],
    recomendada: "productos"
  });
  await new Promise((res) => setTimeout(res, 150));
  igual(ctx.INV.importar.productos.length, 2, "sqlite: lee las filas paginadas");
  igual(ctx.INV.importar.productos[0].nombre, "Arroz grado 1", "sqlite: nombre");
  const leida = ctx.__llamadas.filter((x) => x.metodo === "leerTablaBase").pop();
  igual(leida.args[0], "productos", "sqlite: tabla elegida");

  ctx.FabriImportar.base({
    ok: true, tipo: "texto", archivo: "lista.csv", extension: "csv",
    bytes: 40, texto: "nombre;precio;stock\nPan corriente;990;10"
  });
  await new Promise((res) => setTimeout(res, 60));
  const textoPan = ctx.document.getElementById("invImportarTexto").value;
  cierto(textoPan.indexOf("Pan corriente") >= 0, "texto: llena el cuadro");
  igual(ctx.INV.importar.productos[0].nombre, "Pan corriente", "texto: mapea la vista previa");

  ctx.FabriImportar.cancelado();
  cierto(ctx.document.getElementById("invBaseEstado").textContent.indexOf("cancelada") >= 0,
    "cancelar: lo informa sin borrar la base");

  ctx.FabriImportar.base({ ok: false, error: "permiso denegado" });
  cierto(ctx.document.getElementById("invBaseEstado").textContent.indexOf("permiso denegado") >= 0,
    "error: muestra el motivo real");
}

/* ── 4 · guía de InsForge ──────────────────────────────────────────────── */
async function pruebaInsforge(ctx) {
  console.log("▸ guía de InsForge · probar la nube y copiar");

  ctx.__almacen.delete("fabrick.nube.url");
  ctx.__almacen.delete("fabrick.nube.token");
  const sin = await ctx.FabriInsforge.probar();
  igual(sin.ok, false, "sin configurar: no finge éxito");
  cierto(ctx.document.getElementById("invGuiaEstado").textContent.indexOf("Falta configurar") >= 0,
    "sin configurar: explica qué falta");

  ctx.__almacen.set("fabrick.nube.url", "https://fabri-api.vercel.app");
  ctx.__almacen.set("fabrick.nube.token", "token-de-prueba");
  ctx.invNubeResumen = async function () {
    return { ok: true, resumen: { total: 12, stock_bajo: 3 } };
  };
  const con = await ctx.FabriInsforge.probar();
  igual(con.ok, true, "con nube: responde ok");
  const texto = ctx.document.getElementById("invGuiaEstado").textContent;
  cierto(texto.indexOf("12 producto") >= 0 && texto.indexOf("3 con stock bajo") >= 0,
    "con nube: muestra totales reales");

  igual(ctx.FabriInsforge.copiar("hola"), true, "copiar: usa el portapapeles");
}

/* ── 5 · marcado y estilos ─────────────────────────────────────────────── */
function pruebaMarcado(ctx) {
  console.log("▸ index.html e inventario.css · equipos y guía");

  const ids = [
    "invEquipos", "invEquipoImpresora", "invEquipoImpresoraChip",
    "invEquipoLector", "invEquipoLectorChip", "invEquipoBase", "invEquipoBaseChip",
    "invEquipoPanelImpresora", "invEquipoPanelLector",
    "invImpHost", "invImpPuerto", "invImpAncho", "invImpCorte", "invImpCodepage",
    "invImpDestino", "btnInvImpGuardar", "btnInvImpProbar", "btnInvImpBuscar",
    "btnInvImpTest", "invImpSalida",
    "invLectorModo", "invLectorHost", "invLectorPuerto", "invLectorAccion",
    "invLectorIp", "btnInvLectorIniciar", "btnInvLectorDetener", "invLectorEstado",
    "invLectorUltimos",
    "btnInvBaseElegir", "invBaseEstado", "invBaseSelector", "invBaseTabla",
    "invBaseLimite", "invBaseMuestra",
    "invGuiaInsforge", "btnInvGuiaProbar", "btnInvGuiaCompleta", "invGuiaCompleta",
    "invGuiaEstado", "invGuiaSql", "invGuiaEnv", "invGuiaRest"
  ];
  const faltan = ids.filter((id) => !ctx.__ids.has(id));
  if (!faltan.length) ok("están los " + ids.length + " controles de equipos");
  else mal("faltan controles: " + faltan.join(", "));

  const html = fs.readFileSync(WWW + "/index.html", "utf8");
  if (html.indexOf('id="invImpresoraPanel"') < 0) ok("el panel viejo de impresora ya no está");
  else mal("quedó el panel viejo invImpresoraPanel");

  const scripts = ["impresora.js", "lector-red.js", "importar-base.js", "insforge.js"];
  const sinScript = scripts.filter((s) => html.indexOf('src="' + s + '"') < 0);
  if (!sinScript.length) ok("los 4 módulos nuevos están enlazados");
  else mal("faltan scripts: " + sinScript.join(", "));

  if (html.indexOf("docs/INSFORGE.md") >= 0) ok("la guía enlaza docs/INSFORGE.md");
  else mal("la guía no enlaza docs/INSFORGE.md");

  const css = fs.readFileSync(WWW + "/inventario.css", "utf8");
  const clases = [".inv-equipos", ".inv-equipo-panel", ".inv-base", ".inv-guia",
    ".inv-lector-linea", ".inv-importar-o"];
  const sinClase = clases.filter((c) => css.indexOf(c) < 0);
  if (!sinClase.length) ok("los estilos de equipos están definidos");
  else mal("faltan estilos: " + sinClase.join(", "));

  const desde = html.indexOf('id="invEquipos"');
  const hasta = html.indexOf('id="invImportarPanel"');
  const bloque = desde >= 0 && hasta > desde ? html.slice(desde, hasta) : "";
  if (bloque && !/[\u{1F300}-\u{1FAFF}]/u.test(bloque)) {
    ok("sin emoji en los equipos (iconos SVG)");
  } else mal("quedan emoji en los equipos");
}

async function main() {
  const ctx = sandbox();
  pruebaImpresora(ctx);
  pruebaLector(ctx);
  await pruebaImportar(ctx);
  await pruebaInsforge(ctx);
  pruebaMarcado(ctx);

  console.log("");
  if (fallos === 0) {
    console.log("\u001b[1;32m✔ equipos del local: todo en orden\u001b[0m");
    process.exit(0);
  }
  console.log("\u001b[1;31m✖ " + fallos + " fallo(s)\u001b[0m");
  process.exit(1);
}

main();
