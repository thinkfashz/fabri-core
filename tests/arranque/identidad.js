#!/usr/bin/env node
/* =============================================================================
   Página «Mi identidad» · utilidades de la ficha del negocio
   -----------------------------------------------------------------------------
   Comprueba la parte que no depende del núcleo ni del DOM:
     1. El ID de cliente tiene el formato FAB-XXXX-XXXX y no usa caracteres que
        se confunden (I, O, 0, 1).
     2. El RUT se formatea con puntos y guion (76.543.210-8).
     3. Las iniciales de la tarjeta salen del nombre (soluciones fabrick → SF).
     4. La caché local guarda y devuelve la identidad (la boleta la usa).

   Uso:  node tests/arranque/identidad.js
   ========================================================================== */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const WWW = path.resolve(__dirname, "../../android/assets/www");

let fallos = 0;
const ok = (t) => console.log("  \u001b[1;32m✔\u001b[0m " + t);
const mal = (t) => { console.log("  \u001b[1;31m✖\u001b[0m " + t); fallos++; };

function nodo(id) {
  return {
    id: id || "", hidden: false, textContent: "", innerHTML: "", className: "", value: "",
    style: {}, dataset: {}, hidden: false, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
    appendChild() {}, focus() {}, click() {}, closest() { return null; },
    querySelectorAll() { return []; }, querySelector() { return null; },
    getContext() { return null; }, toDataURL() { return ""; }
  };
}

const almacen = {};
const ctx = {
  console,
  document: {
    getElementById() { return null; },
    querySelectorAll() { return []; }, querySelector() { return null; },
    addEventListener() {}, createElement(t) { return nodo(t); }
  },
  setTimeout() { return 0; }, clearTimeout() {},
  setInterval() { return 0; }, clearInterval() {},
  navigator: { userAgent: "node", onLine: true },
  localStorage: {
    getItem(k) { return Object.prototype.hasOwnProperty.call(almacen, k) ? almacen[k] : null; },
    setItem(k, v) { almacen[k] = String(v); },
    removeItem(k) { delete almacen[k]; }
  },
  sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  performance: { now() { return Date.now(); } },
  Image: function () { return nodo("img"); },
  FileReader: function () {},
  fetch() { return Promise.resolve({ ok: false, status: 404 }); },
  AbortController
};
ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;

vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW + "/identidad.js", "utf8"), ctx, { filename: "identidad.js" });

const g = (n) => vm.runInContext(n, ctx);

console.log("▸ ID de cliente");
{
  const visto = new Set();
  for (let i = 0; i < 200; i++) {
    const id = g('idClienteNuevo()');
    visto.add(id);
    if (!/^FAB-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(id)) { mal("formato raro: " + id); break; }
  }
  if (fallos === 0) ok("200 IDs con formato FAB-XXXX-XXXX");
  if (![...visto].some((x) => /[IO01]/.test(x))) ok("sin caracteres que se confunden (I, O, 0, 1)");
  else mal("algún ID trae I/O/0/1");
  if (visto.size > 190) ok("no se repite (aleatorio real)");
  else mal("se repite demasiado: " + (200 - visto.size) + " repetidos");
}

console.log("▸ RUT formateado");
{
  if (g('idRutFormateado("765432108")') === "76.543.210-8") ok("765432108 → 76.543.210-8");
  else mal("no formatea el RUT: " + g('idRutFormateado("765432108")'));
  if (g('idRutFormateado("12345678K")') === "12.345.678-K") ok("respeta la K");
  else mal("no respeta la K");
  if (g('idRutFormateado("123")') === "12-3") ok("RUT corto sin romper");
  else mal("RUT corto mal: " + g('idRutFormateado("123")'));
}

console.log("▸ iniciales de la tarjeta");
{
  if (g('idIniciales("Soluciones Fabrick")') === "SF") ok("«Soluciones Fabrick» → SF");
  else mal("iniciales mal");
  if (g('idIniciales("")') === "FC") ok("sin nombre → FC");
  else mal("sin nombre no cae a FC");
  if (g('idIniciales("tienda")') === "TI") ok("una palabra → dos letras");
  else mal("una palabra mal");
}

console.log("▸ caché de la identidad");
{
  g('IDENT.nombre = "Mi Tienda"; IDENT.datos = {rut: "1-9", logo: "data:image/jpeg;base64,AAAA"}; idCachear();');
  const c = g('idDeCache()');
  if (c && c.nombre === "Mi Tienda") ok("guarda el nombre");
  else mal("no guarda el nombre");
  if (c && c.datos && c.datos.rut === "1-9") ok("guarda los datos de la ficha");
  else mal("no guarda la ficha");
  if (c && c.datos && c.datos.logo) ok("guarda el logo");
  else mal("no guarda el logo");
}

console.log();
if (fallos === 0) {
  console.log("\u001b[1;32m✔ identidad del negocio: todo en orden\u001b[0m");
  process.exit(0);
}
console.log("\u001b[1;31m✖ " + fallos + " fallo(s)\u001b[0m");
process.exit(1);