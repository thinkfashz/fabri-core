#!/usr/bin/env node
/* =============================================================================
   Candado del núcleo · impide el auto-bloqueo de `con_estado`
   -----------------------------------------------------------------------------
   El cuelgue «todo dice núcleo ocupado» tenía una causa: `dir_datos()` tomaba
   `ESTADO.lock()` (bloqueante) y se llamaba desde DENTRO de un `con_estado`.
   El mismo hilo se esperaba a sí mismo para siempre. Esta prueba estática lo
   impide que vuelva:

     1. `dir_datos()` usa su propio candado (`DIR_DATOS`) y no toca `ESTADO`.
     2. `con_estado()` detecta reentrancia (`EN_ESTADO`) y responde error en
        vez de colgarse.
     3. `con_estado()` espera con `try_lock` acotado.
     4. Suelta el carril antes de tocar el anillo de rendimiento (sin inversión
        de candados).
     5. El único `ESTADO.lock()` bloqueante permitido es el de `init`.

   Uso:  node tests/arranque/candado.js
   ========================================================================== */
const fs = require("fs");
const path = require("path");

const RUTA = path.resolve(__dirname, "../../src-tauri/src/lib.rs");
const fuente = fs.readFileSync(RUTA, "utf8");

let fallos = 0;
const ok = (t) => console.log("  \u001b[1;32m✔\u001b[0m " + t);
const mal = (t) => { console.log("  \u001b[1;31m✖\u001b[0m " + t); fallos++; };

/** Devuelve el cuerpo completo de `fn <nombre>` (con llaves balanceadas). */
function cuerpo(nombre) {
  const i = fuente.indexOf("fn " + nombre);
  if (i < 0) return "";
  const llave = fuente.indexOf("{", i);
  if (llave < 0) return "";
  let prof = 0;
  for (let j = llave; j < fuente.length; j++) {
    if (fuente[j] === "{") prof++;
    else if (fuente[j] === "}") {
      prof--;
      if (prof === 0) return fuente.slice(i, j + 1);
    }
  }
  return fuente.slice(i);
}

console.log("▸ candado del núcleo (con_estado)");

const dd = cuerpo("dir_datos");
if (!dd) {
  mal("no se encontró dir_datos()");
} else {
  if (/DIR_DATOS/.test(dd)) ok("dir_datos() usa su propio candado (DIR_DATOS)");
  else mal("dir_datos() no usa DIR_DATOS");
  if (/ESTADO\s*\.\s*(lock|try_lock)/.test(dd)) {
    mal("dir_datos() vuelve a tomar ESTADO (auto-bloqueo garantizado)");
  } else {
    ok("dir_datos() no toca ESTADO");
  }
}

const ce = cuerpo("con_estado");
if (!ce) {
  mal("no se encontró con_estado()");
} else {
  if (/EN_ESTADO/.test(ce) && /replace\(\s*true\s*\)/.test(ce)) {
    ok("con_estado() detecta reentrancia (no se espera a sí mismo)");
  } else {
    mal("con_estado() no detecta reentrancia: puede auto-bloquearse");
  }
  if (/ESTADO\s*\.\s*try_lock/.test(ce)) ok("con_estado() espera con try_lock acotado");
  else mal("con_estado() ya no acota la espera");
  const iDrop = ce.indexOf("drop(g)");
  const iOps = ce.search(/ULTIMAS_OPS\s*\.\s*lock/);
  if (iDrop >= 0 && iOps > iDrop) ok("suelta el carril antes del anillo de rendimiento");
  else mal("toma ULTIMAS_OPS con el carril tomado (riesgo de inversión)");
}

// Solo cuentan las líneas de código (no los comentarios).
const codigo = fuente
  .split("\n")
  .filter((l) => !l.trim().startsWith("//"))
  .join("\n");
const bloqueantes = (codigo.match(/ESTADO\s*\.\s*lock\s*\(/g) || []).length;
if (bloqueantes <= 1) ok("a lo sumo un ESTADO.lock() bloqueante (init)");
else mal("hay " + bloqueantes + " ESTADO.lock() bloqueantes: riesgo de cuelgue");

console.log();
if (fallos === 0) {
  console.log("\u001b[1;32m✔ candado del núcleo: todo en orden\u001b[0m");
  process.exit(0);
}
console.log("\u001b[1;31m✖ " + fallos + " fallo(s)\u001b[0m");
process.exit(1);
