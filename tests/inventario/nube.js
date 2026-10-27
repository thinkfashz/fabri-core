#!/usr/bin/env node
/* =============================================================================
   Inventario · las DOS bases (local + nube) y el escáner pro
   -----------------------------------------------------------------------------
   Lo que se comprueba:

     1. `invNubeBuscarCodigo()` pega al endpoint correcto
        (`/api/inventario`), con POST, con `Authorization: Bearer <token>` y con
        el cuerpo `{ accion: "buscar", codigo }`.
     2. Sin token no se llama a la nube: se devuelve `sin token` (nunca se
        inventa un resultado).
     3. `invNubePedir()` no lanza nunca: un 401, un 500 o una red caída vuelven
        como `{ ok: false }`.
     4. `invPoblarDatalist()` rellena el autocompletado de códigos con los
        productos guardados, sin repetir códigos.
     5. El escáner tiene malla en canvas: `invCamaraAbrir` la enciende,
        `invCamaraParar` la apaga, y el marcado (index.html) existe.
     6. El orden de búsqueda es local → nube → bases libres.

   Uso:  node tests/inventario/nube.js
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
    getContext() { return { clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
      fillRect() {}, createLinearGradient() { return { addColorStop() {} }; }, addColorStop() {} }; },
    getBoundingClientRect() { return { width: 320, height: 240, top: 0, left: 0 }; },
    toDataURL() { return ""; }, play() {}, pause() {}
  };
}

/** Sandbox con fetch espiable y localStorage configurable. */
function sandbox(opciones) {
  const o = opciones || {};
  const llamadas = [];
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

  const almacen = o.almacen || {};
  const fetchImpl = function (url, opt) {
    llamadas.push({ url: url, opt: opt || {} });
    return Promise.resolve({
      ok: o.http ? o.http >= 200 && o.http < 300 : true,
      status: o.http || 200,
      json: () => Promise.resolve(o.json === undefined ? { ok: true } : o.json)
    });
  };

  const ctx = {
    console,
    document,
    setTimeout, clearTimeout, setInterval() { return 0; }, clearInterval() {},
    navigator: { userAgent: "node", onLine: o.onLine !== false, mediaDevices: null },
    location: { href: "https://appassets.local/index.html", origin: "https://appassets.local", protocol: "https:" },
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(almacen, k) ? almacen[k] : null; },
      setItem() {}, removeItem() {}
    },
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
    matchMedia() { return { matches: !!o.reducir, addEventListener() {}, addListener() {} }; }
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  ctx.addEventListener = function () {};
  ctx.removeEventListener = function () {};
  ctx.scrollTo = function () {};
  ctx.FabrickNative = new Proxy({}, {
    get(_, prop) {
      if (prop === "nucleoListo") return function () { return JSON.stringify({ listo: true }); };
      return function () { return JSON.stringify({ ok: true, data: {} }); };
    }
  });

  vm.createContext(ctx);
  for (const f of ARCHIVOS) {
    vm.runInContext(fs.readFileSync(WWW + "/" + f, "utf8"), ctx, { filename: f });
  }
  ctx.__llamadas = llamadas;
  return ctx;
}

async function main() {
  console.log("▸ invNubeBuscarCodigo · endpoint, token y cuerpo");
  {
    const ctx = sandbox({
      almacen: { "fabrick.nube.url": "https://fabri-api.vercel.app", "fabrick.nube.token": "tok-123" },
      json: { ok: true, encontrado: true, producto: { codigo: "1", nombre: "Uno" } }
    });
    ctx.invIniciar();
    const r = await ctx.invNubeBuscarCodigo("7801234567890");
    const c = ctx.__llamadas[0];
    if (!c) { mal("no llamó a la nube"); }
    else {
      if (/\/api\/inventario$/.test(c.url)) ok("usa el endpoint /api/inventario");
      else mal("endpoint inesperado: " + c.url);
      if (c.opt.method === "POST") ok("método POST");
      else mal("método inesperado: " + c.opt.method);
      const auth = (c.opt.headers || {})["Authorization"] || "";
      if (auth === "Bearer tok-123") ok("manda el token como Bearer");
      else mal("no manda el token: " + JSON.stringify(c.opt.headers));
      let cuerpo = {};
      try { cuerpo = JSON.parse(c.opt.body); } catch (e) { /* vacío */ }
      if (cuerpo.accion === "buscar" && cuerpo.codigo === "7801234567890") ok("cuerpo {accion:buscar, codigo}");
      else mal("cuerpo inesperado: " + c.opt.body);
    }
    if (r.ok && r.producto && r.producto.nombre === "Uno") ok("devuelve el producto de la nube");
    else mal("no devolvió el producto: " + JSON.stringify(r));
  }

  console.log("▸ sin token · no se llama a la nube");
  {
    const ctx = sandbox({
      almacen: { "fabrick.nube.url": "https://fabri-api.vercel.app" },
      json: { ok: true, encontrado: true, producto: { codigo: "1" } }
    });
    ctx.invIniciar();
    const r = await ctx.invNubeBuscarCodigo("123");
    if (!r.ok && r.motivo === "sin token") ok("devuelve «sin token»");
    else mal("resultado inesperado: " + JSON.stringify(r));
    if (!ctx.__llamadas.length) ok("no hizo ninguna petición");
    else mal("llamó a la nube sin token");
  }

  console.log("▸ invNubePedir · nunca lanza");
  {
    const ctx401 = sandbox({ almacen: { "fabrick.nube.url": "https://api", "fabrick.nube.token": "t" }, http: 401 });
    ctx401.invIniciar();
    const r401 = await ctx401.invNubePedir({ accion: "buscar" }, 1000);
    if (!r401.ok && r401.codigo === "SIN_TOKEN") ok("401 → SIN_TOKEN (no lanza)");
    else mal("401 mal manejado: " + JSON.stringify(r401));

    const ctx500 = sandbox({ almacen: { "fabrick.nube.url": "https://api", "fabrick.nube.token": "t" }, http: 500 });
    ctx500.invIniciar();
    const r500 = await ctx500.invNubePedir({ accion: "buscar" }, 1000);
    if (!r500.ok && /HTTP 500/.test(r500.error)) ok("500 → error controlado");
    else mal("500 mal manejado: " + JSON.stringify(r500));
  }

  console.log("▸ invPoblarDatalist · autocompletado sin repetir códigos");
  {
    const ctx = sandbox();
    ctx.INV.productos = [
      { codigo: "111", nombre: "Alfa", categoria: "bebidas" },
      { codigo: "111", nombre: "Alfa repetido", categoria: "bebidas" },
      { codigo: "222", nombre: "Beta", categoria: "dulces" }
    ];
    ctx.invPoblarDatalist();
    const dl = ctx.document.getElementById("invCodigos");
    const n = (dl.innerHTML.match(/<option/g) || []).length;
    if (n === 2) ok("una opción por código (2), sin duplicar");
    else mal("opciones inesperadas: " + n);
    if (/value="111"/.test(dl.innerHTML) && /Alfa/.test(dl.innerHTML)) ok("incluye código y nombre clasificado");
    else mal("no clasifica la opción: " + dl.innerHTML);
  }

  console.log("▸ escáner pro · la malla se enciende y se apaga");
  {
    const ctx = sandbox();
    let falloAntes = fallos;
    try {
      ctx.invMallaIniciar();
      if (ctx.INV.mallaActiva === true) ok("invMallaIniciar() activa la malla");
      else mal("la malla no quedó activa");
      ctx.invMallaParar();
      if (ctx.INV.mallaActiva === false) ok("invMallaParar() la apaga");
      else mal("la malla no se apagó");
    } catch (e) {
      mal("la malla lanzó: " + e.message);
    }
    if (fallos > falloAntes) { /* ya contado */ }
  }

  console.log("▸ estático · marcado y orden de búsqueda");
  {
    const html = fs.readFileSync(WWW + "/index.html", "utf8");
    if (/id="invMalla"/.test(html)) ok("index.html: canvas de la malla");
    else mal("falta el canvas #invMalla");
    if (/id="invCodigos"/.test(html)) ok("index.html: datalist #invCodigos");
    else mal("falta el datalist #invCodigos");
    if (/id="invMalla"/.test(html) && /list="invCodigos"/.test(html)) ok("el campo de código usa el autocompletado");
    else mal("el campo de código no apunta al datalist");

    const src = fs.readFileSync(WWW + "/inventario.js", "utf8");
    const iLocal = src.indexOf('await invApiTarde("buscar_codigo"');
    const iNube = src.indexOf("await invNubeBuscarCodigo(codigo)");
    const iLibres = src.indexOf("await invConsultarApiLibre(codigo)");
    if (iLocal >= 0 && iNube > iLocal && iLibres > iNube) {
      ok("orden de búsqueda: local → nube → bases libres");
    } else {
      mal("orden inesperado: local=" + iLocal + " nube=" + iNube + " libres=" + iLibres);
    }
    if (/invMallaIniciar\(\);/.test(src) && /invMallaParar\(\);/.test(src)) {
      ok("el escáner enciende/apaga la malla en la cámara");
    } else {
      mal("la cámara no llama a invMallaIniciar/Parar");
    }
  }

  console.log();
  if (fallos === 0) {
    console.log("\u001b[1;32m✔ inventario nube + escáner pro: todo en orden\u001b[0m");
    process.exit(0);
  }
  console.log("\u001b[1;31m✖ " + fallos + " fallo(s)\u001b[0m");
  process.exit(1);
}

main().catch((e) => { console.log("FALLA: " + e.stack); process.exit(1); });
