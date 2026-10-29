#!/usr/bin/env node
/* =============================================================================
   Credencial · Code128-B real (ISO/IEC 15417)
   -----------------------------------------------------------------------------
   Comprueba el codificador que comparten el login y «Mi identidad»:
     1. La tabla tiene 107 símbolos y cada uno mide 11 módulos (el stop, 13).
     2. El dígito verificador coincide con dos casos calculados a mano
        (start B): «1234» → 88 y «PJJ123C» → 55.
     3. El ancho total en módulos es el de la norma (11 por símbolo + 13).
     4. El SVG recibe una barra por cada elemento impar del patrón y una zona
        de silencio de 10 módulos a cada lado.
     5. Login e ID usan el mismo codificador.

   Uso:  node tests/arranque/barcode.js
   ========================================================================== */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const WWW = path.resolve(__dirname, "../../android/assets/www");
const app = fs.readFileSync(WWW + "/app.js", "utf8");

let fallos = 0;
const ok = (t) => console.log("  \u001b[1;32m✔\u001b[0m " + t);
const mal = (t) => { console.log("  \u001b[1;31m✖\u001b[0m " + t); fallos++; };
const igual = (a, b, t) => { if (a === b) ok(t); else mal(t + " (esperado " + b + ", llegó " + a + ")"); };

/* Se extrae el bloque del codificador de app.js para probarlo aislado, sin
   arrastrar todo el DOM de la aplicación. */
const desde = app.indexOf("const FABRICK_CODE128");
const hasta = app.indexOf("window.fabrickCode128 = fabrickCode128;");
if (desde < 0 || hasta < 0 || hasta <= desde) {
  mal("no se encontró el bloque Code128 en app.js");
  process.exit(1);
}
const bloque = app.slice(desde, hasta);

const ctx = {
  console,
  document: {
    createElementNS() {
      return {
        attrs: {},
        setAttribute(k, v) { this.attrs[k] = v; },
        appendChild() {}
      };
    },
    createDocumentFragment() {
      return { hijos: [], appendChild(n) { this.hijos.push(n); } };
    }
  }
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(bloque, ctx);

const g = (n) => vm.runInContext(n, ctx);

console.log("▸ Tabla Code128");
{
  const tabla = g("FABRICK_CODE128");
  igual(tabla.length, 107, "107 símbolos");
  let malos = 0;
  tabla.forEach((p, i) => {
    const esperado = i === 106 ? 13 : 11;
    const suma = [...p].reduce((a, d) => a + Number(d), 0);
    if (suma !== esperado) malos++;
  });
  igual(malos, 0, "todos los símbolos suman 11 módulos (stop 13)");
}

console.log("▸ Dígito verificador");
{
  const a = g('fabrickCode128("1234")');
  igual(a.verificador, 88, "«1234» → 88 (start B)");
  igual(a.ancho, 79, "«1234» mide 79 módulos");
  igual(a.patron.length, 43, "«1234» usa 43 elementos de ancho");

  const b = g('fabrickCode128("PJJ123C")');
  igual(b.verificador, 55, "«PJJ123C» → 55 (start B)");
  igual(b.ancho, 112, "«PJJ123C» mide 112 módulos");
}

console.log("▸ Texto normalizado");
{
  const c = g('fabrickCode128("fab-abcd-1234")');
  igual(c.texto, "FAB-ABCD-1234", "se normaliza a mayúsculas");
  const d = g('fabrickCode128("  ")');
  igual(d.texto, "FABRI-CORE", "un texto vacío no rompe la credencial");
}

console.log("▸ SVG");
{
  const svg = {
    firstChild: null,
    attrs: {},
    removeChild() {},
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(n) { this.hijo = n; }
  };
  ctx.__svg = svg;
  const info = g('fabrickBarcodePintar(__svg, "FAB-ABCD-1234", 34)');
  igual(info.ancho, 178, "«FAB-ABCD-1234» mide 178 módulos");
  igual(svg.attrs.viewBox, "-10 0 198 34", "viewBox con 10 módulos de silencio por lado");
  const barras = Math.ceil(info.patron.length / 2);
  igual(svg.hijo.hijos.length, barras, "una barra por cada elemento impar");
  igual(svg.hijo.hijos[0].attrs.height, "34", "las barras llenan el alto");
}

console.log("▸ Uso compartido");
{
  const login = app.includes('fabrickBarcodePintar($("loginBarcode"), texto, 30)');
  const ident = fs.readFileSync(WWW + "/identidad.js", "utf8")
    .includes('window.fabrickBarcodePintar(idEl("idBarcode"), cliente || "FABRI-CORE", 34)');
  if (login) ok("el login pinta Code128 real");
  else mal("el login no usa el codificador compartido");
  if (ident) ok("«Mi identidad» pinta el mismo Code128");
  else mal("«Mi identidad» no usa el codificador compartido");
}

console.log();
if (fallos === 0) {
  console.log("\u001b[1;32m✔ código de barras: todo en orden\u001b[0m");
  process.exit(0);
}
console.log("\u001b[1;31m✖ " + fallos + " fallo(s)\u001b[0m");
process.exit(1);
