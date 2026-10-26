#!/usr/bin/env node
/* =============================================================================
   Puente del núcleo · comprobaciones estáticas sobre NativeBridge.java
   -----------------------------------------------------------------------------
   El cuelgue de la app tenía cinco causas; tres vivían en este archivo. Esta
   prueba impide que vuelvan:

     1. `call()` NO puede esperar al núcleo (nada de `listo.await`) y su espera
        síncrona debe tener un tope CORTO (≤ 700 ms): las lecturas de pantalla
        van por `callAsync`, que no bloquea.
     2. `ping` lo contesta Java (`pingLocal`), sin entrar en la cola.
     3. La cola del núcleo está ACOTADA y rechaza cuando se llena.
     4. Hay coalescencia (`EN_VUELO`): dos llamadas idénticas no se apilan.
     5. `init`, mantenimiento y registros pasan por el MISMO carril.
     6. `nucleoEstado()` existe para diagnosticar sin adivinar.

   Uso:  node tests/arranque/puente.js
   ========================================================================== */
const fs = require("fs");
const path = require("path");

const RUTA = path.resolve(__dirname, "../../android/java/cl/fabrick/core/NativeBridge.java");
const fuente = fs.readFileSync(RUTA, "utf8");

let fallos = 0;
const ok = (t) => console.log("  \u001b[1;32m✔\u001b[0m " + t);
const mal = (t) => { console.log("  \u001b[1;31m✖\u001b[0m " + t); fallos++; };

/** Devuelve el cuerpo del método `call(String op, String payloadJson)`. */
function cuerpoDeCall() {
  const i = fuente.indexOf("public String call(String op, String payloadJson)");
  if (i < 0) return "";
  // Se corta en el siguiente método público, que es donde termina `call`.
  const fin = fuente.indexOf("\n    @JavascriptInterface", i);
  return fuente.slice(i, fin > i ? fin : i + 6000);
}

console.log("▸ vía síncrona acotada y carril asíncrono");
const call = cuerpoDeCall();
if (!call) {
  mal("no se encontró el método call(String, String)");
} else {
  if (/listo\s*\.\s*await\s*\(/.test(call)) {
    mal("call() vuelve a esperar al núcleo con listo.await()");
  } else {
    ok("call() no espera al núcleo");
  }
  // La vía síncrona puede usar get(tope, unidad) —nunca get() sin tope— y el
  // tope tiene que ser corto: las lecturas de pantalla van por callAsync.
  if (/futuro\s*\.\s*get\s*\(\s*\)/.test(call)) {
    mal("call() bloquea sin tope con futuro.get()");
  } else if (/futuro\s*\.\s*get\s*\(\s*tope\s*,/.test(call)) {
    ok("call() espera con tope acotado");
  } else {
    mal("call() ya no acota la espera");
  }
  const m = fuente.match(/TOPE_CALL_MS\s*=\s*(\d+)L?/);
  if (m && Number(m[1]) <= 700) ok("tope de la vía síncrona ≤ 700 ms (" + m[1] + " ms)");
  else mal("el tope síncrono volvió a ser largo" + (m ? " (" + m[1] + " ms)" : ""));

  if (/public String callAsync\s*\(/.test(fuente)) ok("existe el carril asíncrono (callAsync)");
  else mal("falta callAsync: las lecturas volverían a bloquear");
  if (/__fabriAsync/.test(fuente)) ok("el resultado asíncrono vuelve por __fabriAsync");
  else mal("callAsync no devuelve el resultado a JavaScript");
  if (/pingLocal\s*\(\s*\)/.test(call)) ok("ping lo contesta Java");
  else mal("ping ya no se responde en Java: vuelve a encolarse");
  if (/NUCLEO_OCUPADO/.test(call)) ok("responde NUCLEO_OCUPADO en vez de esperar");
  else mal("no responde NUCLEO_OCUPADO cuando el núcleo no está listo");
  if (/EN_VUELO/.test(call)) ok("coalescencia por operación + payload");
  else mal("falta la coalescencia: los reintentos se apilan");
  if (/RejectedExecutionException/.test(call)) ok("la cola llena se rechaza");
  else mal("no maneja la cola llena");
}

console.log("▸ cola acotada");
if (/ArrayBlockingQueue<Runnable>\(24\)/.test(fuente)) ok("cola de 24 con rechazo");
else mal("la cola del núcleo dejó de estar acotada a 24");
if (/AbortPolicy/.test(fuente)) ok("política de rechazo explícita");
else mal("la cola no rechaza: puede crecer sin límite");

console.log("▸ un solo carril");
if (/nucleo-registro/.test(fuente)) mal("volvió el hilo de registros (compite por el mutex)");
else ok("los registros usan el carril del núcleo");
if (/exec\("init"/.test(fuente) && /EJECUTOR\.submit/.test(fuente)) ok("init pasa por el carril");
else mal("init ya no pasa por el carril único");
if (/exec\("mantenimiento"/.test(fuente)) ok("mantenimiento pasa por el carril");
else mal("mantenimiento desapareció");

console.log("▸ diagnóstico");
if (/public String nucleoEstado\s*\(/.test(fuente)) ok("nucleoEstado() expone cola y última lenta");
else mal("falta nucleoEstado(): no se puede diagnosticar un cuelgue");

console.log();
if (fallos === 0) {
  console.log("\u001b[1;32m✔ puente del núcleo: todo en orden\u001b[0m");
  process.exit(0);
}
console.log("\u001b[1;31m✖ " + fallos + " fallo(s)\u001b[0m");
process.exit(1);
