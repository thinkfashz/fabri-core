#!/usr/bin/env node
/* =============================================================================
   Lector de códigos · lógica de consulta a las bases libres
   -----------------------------------------------------------------------------
   El caso que rompía la guía de inventario:

     código 7791293043791
       Open Food Facts     → HTTP 404
       Open Beauty Facts   → HTTP 404
       Open Products Facts → HTTP 500
     y la app mostraba «Open Products Facts: HTTP 500», como si fuese su fallo.

   Lo que comprueba esta prueba:
     1. 404 y 500 se SALTAN (no son errores de la app).
     2. El mensaje final dice la verdad: «no está publicado en las bases libres».
     3. Un fallo de red se distingue de «no está publicado».
     4. Hay presupuesto total: tres hosts que no responden no pueden tener la
        pantalla esperando 27 s (9 s × 3).
     5. Un producto real (HTTP 200) sí se devuelve, con su fuente.

   Uso:  node tests/inventario/lector.js
   ========================================================================== */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const WWW = path.resolve(__dirname, "../../android/assets/www");
const ARCHIVOS = ["diagnostico.js", "app.js", "datos.js", "conexiones.js", "inventario.js", "identidad.js", "flujo.js"];

let fallos = 0;
const ok = (t) => console.log("  \u001b[1;32m✔\u001b[0m " + t);
const mal = (t) => { console.log("  \u001b[1;31m✖\u001b[0m " + t); fallos++; };

function nodo(id) {
  return {
    id: id || "", hidden: false, textContent: "", innerHTML: "", className: "", value: "",
    title: "", style: {}, dataset: {}, disabled: false, children: [], options: [], files: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null; },
    appendChild() {}, insertAdjacentHTML() {}, focus() {}, click() {}, remove() {},
    closest() { return null; }, querySelectorAll() { return []; }, querySelector() { return null; },
    offsetWidth: 1, scrollTop: 0, scrollHeight: 0, childElementCount: 0, tagName: "DIV",
    getContext() { return null; }, toDataURL() { return ""; }, play() {}, pause() {}
  };
}

/** Construye un contexto con un `fetch` programable y devuelve el sandbox. */
function sandbox(fetchImpl, opts) {
  const o = opts || {};
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
    console,
    document,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout, setInterval() { return 0; }, clearInterval() {},
    navigator: { userAgent: "node", onLine: o.onLine !== false, mediaDevices: null },
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
    fetch: fetchImpl,
    TextDecoder: function () {}, TextEncoder: function () {},
    matchMedia() { return { matches: false, addEventListener() {}, addListener() {} }; }
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  ctx.addEventListener = function () {};
  ctx.removeEventListener = function () {};
  ctx.scrollTo = function () {};
  ctx.FabrickNative = new Proxy({}, {
    get() { return function () { return JSON.stringify({ ok: true, data: {} }); }; }
  });

  vm.createContext(ctx);
  for (const f of ARCHIVOS) {
    let src = fs.readFileSync(WWW + "/" + f, "utf8");
    // En las pruebas de tiempo se acortan los topes para no tardar 12 s.
    if (o.rapido) {
      src = src.replace("INV_API_POR_HOST_MS = 4500", "INV_API_POR_HOST_MS = 60")
               .replace("INV_API_TOTAL_MS = 12000", "INV_API_TOTAL_MS = 300");
    }
    vm.runInContext(src, ctx, { filename: f });
  }
  return ctx;
}

const PRODUCTO = {
  status: 1,
  product: {
    product_name: "Galletas de prueba",
    brands: "Marca X",
    quantity: "200 g",
    categories_tags: ["en:snacks", "en:sweet-snacks"],
    labels_tags: ["en:no-gluten"],
    allergens_tags: ["en:milk"],
    nutriscore_grade: "c",
    nova_group: 4,
    countries_tags: ["en:chile"],
    image_front_small_url: "https://img/1.jpg"
  }
};

function respuesta(http) {
  return Promise.resolve({
    ok: http >= 200 && http < 300,
    status: http,
    json: () => Promise.resolve(http === 200 ? PRODUCTO : { status: 0 })
  });
}

async function main() {
  console.log("▸ 404/404/500 · el caso 7791293043791");
  {
    const cola = [404, 404, 500];
    const ctx = sandbox(() => respuesta(cola.shift()));
    const r = await ctx.invConsultarApiLibre("7791293043791");
    if (!r.ok) ok("no lo da por encontrado");
    else mal("devolvió encontrado un código que no está");
    if (/no está publicado/.test(r.error || "")) ok("mensaje honesto: «no está publicado en las bases libres»");
    else mal("mensaje confuso: " + JSON.stringify(r.error));
    if (!/HTTP 500/.test(r.error || "")) ok("no filtra el HTTP 500 de la base caída");
    else mal("sigue mostrando «HTTP 500» como si fuera un error de la app");
  }

  console.log("▸ producto real (HTTP 200)");
  {
    const ctx = sandbox(() => respuesta(200));
    const r = await ctx.invConsultarApiLibre("1234567890123");
    if (r.ok && r.producto) {
      ok("devuelve el producto");
      if (r.producto.fuente === "Open Food Facts") ok("fuente correcta");
      else mal("fuente inesperada: " + r.producto.fuente);
      if (r.producto.ficha && r.producto.ficha.nutriscore === "c") ok("trae la ficha (Nutri-Score)");
      else mal("no trae la ficha");
    } else {
      mal("no devolvió el producto con HTTP 200");
    }
  }

  console.log("▸ sin red (fetch lanza TypeError)");
  {
    const ctx = sandbox(() => Promise.reject(new TypeError("network error")));
    const r = await ctx.invConsultarApiLibre("7791293043791");
    if (!r.ok && r.motivo === "sin red") ok("distingue el fallo de red");
    else mal("no distingue el fallo de red: " + JSON.stringify(r));
    if (/Sin conexión/.test(r.error || "")) ok("lo dice claro al usuario");
    else mal("mensaje poco claro: " + JSON.stringify(r.error));
  }

  console.log("▸ sin conexión declarada (navigator.onLine === false)");
  {
    const ctx = sandbox(() => respuesta(200), { onLine: false });
    const r = await ctx.invConsultarApiLibre("7791293043791");
    if (!r.ok && r.motivo === "sin conexión") ok("no intenta consultar sin conexión");
    else mal("consultó igual sin conexión: " + JSON.stringify(r));
  }

  console.log("▸ presupuesto total (hosts que no responden)");
  {
    // fetch que sólo falla cuando el AbortController lo aborta.
    const ctx = sandbox((url, opt) => new Promise((_res, rej) => {
      const s = setTimeout(() => {
        const e = new Error("abort");
        e.name = "AbortError";
        rej(e);
      }, 400);
      if (opt && opt.signal) opt.signal.addEventListener("abort", () => { clearTimeout(s); const e = new Error("abort"); e.name = "AbortError"; rej(e); });
    }), { rapido: true });
    const t0 = Date.now();
    const r = await ctx.invConsultarApiLibre("7791293043791");
    const ms = Date.now() - t0;
    if (!r.ok && r.motivo === "bases libres sin respuesta") ok("avisa que las bases no respondieron");
    else mal("resultado inesperado: " + JSON.stringify(r));
    if (ms < 2000) ok("respeta el presupuesto total (" + ms + " ms, tope 300 ms en prueba)");
    else mal("se pasó del presupuesto: " + ms + " ms");
  }

  console.log();
  if (fallos === 0) {
    console.log("\u001b[1;32m✔ lector de códigos: todo en orden\u001b[0m");
    process.exit(0);
  }
  console.log("\u001b[1;31m✖ " + fallos + " fallo(s)\u001b[0m");
  process.exit(1);
}

main().catch((e) => { console.log("FALLA: " + e.stack); process.exit(1); });