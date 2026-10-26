/* ¿app.js sobrevive a un DOM incompleto?
   Simula el peor caso: falta UN elemento cualquiera. Si el script muere antes
   del arranque, la pantalla queda clavada y ningún botón responde.

   Uso:  node tests/arranque/dom-hostil.js
   Sale con código 1 si algún id ausente rompe app.js. */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const WWW = path.resolve(__dirname, "../../android/assets/www");
const appJs = fs.readFileSync(WWW + "/app.js", "utf8");

function nodo(id) {
  return {
    id: id || "", hidden: false, textContent: "", innerHTML: "", className: "",
    title: "", style: {}, dataset: {}, value: "", disabled: false, children: [], options: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null; },
    appendChild() {}, insertAdjacentHTML() {}, focus() {}, click() {}, remove() {},
    closest() { return null; }, querySelectorAll() { return []; }, querySelector() { return null; },
    offsetWidth: 1, scrollTop: 0, scrollHeight: 0, childElementCount: 0
  };
}

/* Lista de ids que el HTML de verdad tiene. Se obtiene del propio index.html
   para que la prueba no invente: si el HTML no lo tiene, aquí tampoco. */
const html = fs.readFileSync(WWW + "/index.html", "utf8");
const idsHtml = new Set();
const re = /id="([^"]+)"/g;
let m;
while ((m = re.exec(html))) idsHtml.add(m[1]);

console.log("ids declarados en index.html: " + idsHtml.size);

/* Elementos que el HTML no declara pero app.js usa: se detectan ejecutando. */
function ejecutar(faltantes) {
  const cache = new Map();
  const document = {
    hidden: false,
    readyState: "complete",
    getElementById(id) {
      if (faltantes.has(id)) return null;          // el elemento NO existe
      if (!cache.has(id)) cache.set(id, nodo(id));
      return cache.get(id);
    },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    addEventListener() {},
    createElement(t) { return nodo(t); },
    createDocumentFragment() { return nodo("frag"); },
    createElementNS() { return nodo("ns"); },
    body: nodo("body"),
    documentElement: nodo("html")
  };
  const ctx = {
    console, document,
    setTimeout: function (f) { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    navigator: { userAgent: "node", onLine: true },
    location: { href: "https://appassets.local/index.html", origin: "https://appassets.local", protocol: "https:" },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    requestAnimationFrame() { return 0; }, alert() {}, confirm() { return true; }
  };
  ctx.window = ctx;
  ctx.window.addEventListener = function () {};
  ctx.window.scrollTo = function () {};
  ctx.window.FabrickNative = { call: () => JSON.stringify({ ok: true, data: {} }) };
  vm.createContext(ctx);
  try {
    vm.runInContext(appJs, ctx, { filename: "app.js" });
    return { ok: true, ctx };
  } catch (e) {
    return { ok: false, error: e.message, stack: String(e.stack || "").split("\n").slice(0, 3).join(" | ") };
  }
}

/* 1 · DOM completo (todo inventado): debe cargar. */
const completo = ejecutar(new Set());
console.log("\nDOM completo: " + (completo.ok ? "carga" : "FALLA -> " + completo.error));

/* 2 · Falta cada id declarado en el HTML, uno por uno. */
const rotos = [];
for (const id of idsHtml) {
  const r = ejecutar(new Set([id]));
  if (!r.ok) rotos.push(id + " -> " + r.error);
}

console.log("\nElementos cuya ausencia rompe app.js: " + rotos.length);
rotos.forEach(function (r) { console.log("  · " + r); });

/* 3 · ¿Llegó a definirse FabriLogin en el caso completo? */
if (completo.ok) {
  console.log("\nFabriLogin definido: " + (typeof completo.ctx.FabriLogin === "object" && completo.ctx.FabriLogin !== null));
}

process.exitCode = rotos.length === 0 ? 0 : 1;
