/* Prueba del lector de código de barras propio (EAN-13 · EAN-8 · UPC-A).
   ---------------------------------------------------------------------------
   No usa cámara ni red: genera los tramos exactos de un código válido y los
   vuelve a decodificar, a varias escalas (como si la foto tuviera más o menos
   resolución) y con ruido de zona de silencio.

   Uso:  node tests/inventario/ean.js  */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const WWW = path.resolve(__dirname, "../../android/assets/www");

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
ctx.FabrickNative = new Proxy({}, { get() { return function () { return JSON.stringify({ ok: true, data: {} }); }; } });

vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW + "/inventario.js", "utf8"), ctx, { filename: "inventario.js" });

const Ean = ctx.FabriEan;
if (!Ean) {
  console.log("✖ inventario.js no expuso FabriEan");
  process.exit(1);
}

let fallos = 0;
function ok(t) { console.log("  ✔ " + t); }
function mal(t) { console.log("  ✖ " + t); fallos++; }

/** Dígito de control con la misma regla que el lector. */
function conControl(prefijo) {
  const d = prefijo.split("").map(Number);
  let suma = 0;
  let peso = 3;
  for (let i = d.length - 1; i >= 0; i--) {
    suma += d[i] * peso;
    peso = peso === 3 ? 1 : 3;
  }
  return prefijo + String((10 - (suma % 10)) % 10);
}

/** Multiplica los anchos de los tramos (simula otra resolución de cámara). */
function escalar(runs, factor) {
  return runs.map(function (r) { return { negro: r.negro, largo: Math.max(1, Math.round(r.largo * factor)) }; });
}

console.log("▸ EAN-13");
[
  conControl("780123456789"),   // prefijo chileno
  conControl("590123412345"),   // Polonia
  conControl("400638133393"),   // Alemania
  conControl("978020137962")    // ISBN
].forEach(function (codigo) {
  const runs = Ean.runsDeCodigo(codigo);
  const leido = Ean.desdeRuns(runs);
  if (leido === codigo) ok(codigo);
  else mal(codigo + " → " + (leido || "(nada)"));
});

console.log("▸ EAN-8");
[conControl("9638507"), conControl("1234567")].forEach(function (codigo) {
  const leido = Ean.desdeRuns(Ean.runsDeCodigo(codigo));
  if (leido === codigo) ok(codigo);
  else mal(codigo + " → " + (leido || "(nada)"));
});

console.log("▸ UPC-A (se lee como EAN-13 con 0 delante)");
[conControl("03600029145"), conControl("01234567890")].forEach(function (upc) {
  const leido = Ean.desdeRuns(Ean.runsDeCodigo(upc));
  const esperado = "0" + upc;
  if (leido === esperado) ok(upc + " → " + leido);
  else mal(upc + " → " + (leido || "(nada)"));
});

console.log("▸ Escalas de cámara (1 px, 2 px y 3 px por módulo)");
[1, 2, 3].forEach(function (factor) {
  const codigo = conControl("780987654321");
  const leido = Ean.desdeRuns(escalar(Ean.runsDeCodigo(codigo), factor));
  if (leido === codigo) ok("módulo ×" + factor);
  else mal("módulo ×" + factor + " → " + (leido || "(nada)"));
});

console.log("▸ Rechazos");
(function () {
  const bueno = conControl("780111111111");
  const malo = bueno.slice(0, 6) + (Number(bueno[6]) + 1) % 10 + bueno.slice(7);
  const leido = Ean.desdeRuns(Ean.runsDeCodigo(malo));
  if (leido === "") ok("dígito de control incorrecto rechazado");
  else mal("aceptó un código con control incorrecto: " + leido);
})();
(function () {
  const leido = Ean.desdeRuns([{ negro: 0, largo: 100 }, { negro: 1, largo: 3 }, { negro: 0, largo: 3 }]);
  if (leido === "") ok("basura sin guarda rechazada");
  else mal("aceptó basura: " + leido);
})();

if (fallos) {
  console.log("\n✖ lector EAN: " + fallos + " fallo(s)");
  process.exit(1);
}
console.log("\n✔ lector EAN: todo en orden");
