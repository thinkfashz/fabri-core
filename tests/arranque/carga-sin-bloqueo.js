/* ¿Algún script llama al puente nativo DURANTE la carga (nivel superior)?
   Eso bloquea el hilo de JavaScript antes de que se pinte nada y deja la
   pantalla clavada en el loader. Este arnés carga los seis archivos en orden,
   con un DOM mínimo, y registra toda llamada síncrona al puente.

   Las tres llamadas permitidas son de preferencias (no esperan a SQLite):
     chatEstado · localEstado · huellaEstado

   Uso:  node tests/arranque/carga-sin-bloqueo.js */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const WWW = path.resolve(__dirname, "../../android/assets/www");
const archivos = ["diagnostico.js", "app.js", "datos.js", "conexiones.js", "inventario.js", "flujo.js"];
const PERMITIDAS = new Set(["chatEstado", "localEstado", "huellaEstado"]);

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

const html = fs.readFileSync(WWW + "/index.html", "utf8");
const idsHtml = new Set();
let m;
const re = /id="([^"]+)"/g;
while ((m = re.exec(html))) idsHtml.add(m[1]);

const llamadas = [];
const cache = new Map();
const document = {
  hidden: false, readyState: "complete",
  getElementById(id) {
    if (!idsHtml.has(id)) return null;          // fiel al HTML real
    if (!cache.has(id)) cache.set(id, nodo(id));
    return cache.get(id);
  },
  querySelectorAll() { return []; }, querySelector() { return null; },
  addEventListener() {}, removeEventListener() {},
  createElement(t) { return nodo(t); }, createElementNS() { return nodo("ns"); },
  createDocumentFragment() { return nodo("frag"); },
  body: nodo("body"), documentElement: nodo("html"), head: nodo("head")
};

let enCarga = true;
const ctx = {
  console,
  document,
  setTimeout: function () { return 0; },
  clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
  navigator: { userAgent: "node", onLine: true, mediaDevices: null },
  location: { href: "https://appassets.local/index.html", origin: "https://appassets.local", protocol: "https:" },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  requestAnimationFrame() { return 0; }, cancelAnimationFrame() {},
  alert() {}, confirm() { return true; }, prompt() { return null; },
  performance: { now() { return Date.now(); } },
  Image: function () { return nodo("img"); },
  Audio: function () { return nodo("audio"); },
  Blob: function () {}, URL: { createObjectURL() { return ""; }, revokeObjectURL() {} },
  fetch: function () { return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); },
  TextDecoder: function () {}, TextEncoder: function () {},
  matchMedia() { return { matches: false, addEventListener() {}, addListener() {} }; }
};
ctx.window = ctx;
ctx.self = ctx;
ctx.globalThis = ctx;
ctx.addEventListener = function () {};
ctx.removeEventListener = function () {};
ctx.scrollTo = function () {};
ctx.FabrickNative = new Proxy({}, {
  get(_t, prop) {
    return function () {
      if (enCarga) {
        llamadas.push(String(prop) + " · " + new Error().stack.split("\n")[2].trim());
      }
      if (prop === "arranqueBitacora") return "";
      if (prop === "huellaEstado") {
        return JSON.stringify({ ok: true, pinConfigurado: true, huellaActiva: false, huellaDisponible: true, sdk: 33 });
      }
      return JSON.stringify({ ok: true, data: {} });
    };
  }
});

vm.createContext(ctx);

for (const f of archivos) {
  const src = fs.readFileSync(WWW + "/" + f, "utf8");
  try {
    vm.runInContext(src, ctx, { filename: f });
  } catch (e) {
    console.log("FALLA al ejecutar " + f + ": " + e.message);
    process.exitCode = 1;
  }
}
enCarga = false;

const nuevas = llamadas.filter((l) => !PERMITIDAS.has(l.split(" · ")[0]));
console.log("Llamadas síncronas al puente durante la carga: " + llamadas.length);
llamadas.forEach((l) => console.log("  · " + l));
console.log("No permitidas: " + nuevas.length);
console.log("FabriLogin: " + (ctx.FabriLogin ? "definido" : "AUSENTE"));
console.log("__fabriDelegacion: " + ctx.__fabriDelegacion);
console.log("__fabriNucleoListo: " + (typeof ctx.__fabriNucleoListo));
if (nuevas.length || !ctx.FabriLogin) process.exitCode = 1;
