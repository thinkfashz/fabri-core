# Arranque y acceso · cómo se rompen y cómo se arreglan

> Documento de referencia para el fallo más caro que tuvo esta APK:
> **la app se quedaba en «LOADING CORE SYSTEM · 0 %»** y, al reabrir, el login
> aparecía pero **ni el campo del PIN ni ningún botón respondían**.
> Escrito después de corregirlo en la **0.9.11 (versionCode 26)**.

## 1 · Los dos síntomas, una sola causa

| Síntoma | Lo que se veía | Lo que pasaba |
|---|---|---|
| A | Pantalla de carga clavada en `0 %` para siempre | El hilo de JavaScript estaba esperando al núcleo. Sin hilo libre no corren los `setTimeout`, ni `requestAnimationFrame`, ni los manejadores de toques. |
| B | El login aparece pero está «muerto» | El mismo bloqueo, pero ya en `FabriLogin.iniciar()`: la tarjeta se pinta (la pinta el motor gráfico) y el hilo de JavaScript sigue esperando a SQLite. |

Los dos son el **mismo error de arquitectura**: la interfaz llamaba al puente
nativo de forma **síncrona** y el puente podía esperar **10 s por operación**.
Con siete operaciones seguidas en el arranque, eso son más de 70 s de pantalla
congelada; si el núcleo además tarda en migrar SQLite, es un cuelgue perpetuo.

### Cadena exacta del fallo

1. `MainActivity.onCreate()` lanza `puente.initNucleo()` en el hilo
   `nucleo-init`. Ese hilo abre SQLite y migra el esquema.
2. La WebView carga `index.html`. `app.js` llama `iniciar()`, que hacía
   `api("ping")` → `FabrickNative.call("ping")`.
3. `call()` ejecutaba `esperarNucleo()`: hasta **10 s** esperando el
   `CountDownLatch` de la migración. Después `api("sys")`, `compsActualizar()`,
   `api("manifiestos")`, `pintarInicio()`, `cargarModulos()`,
   `cargarHistorialConsola()`: **cada una con su propia espera de 10 s**.
4. `setTimeout(ocultarLoader, 2600)` estaba programado, pero **no puede correr**:
   el hilo está ocupado dentro de la llamada nativa.
5. `FabriLogin.iniciar()` (el último paso) llamaba a `perfilCargar()`, que hace
   `api("usuarios")` + `api("perfil")`: dos esperas más. La tarjeta ya está
   pintada, así que el usuario ve el login, pero el hilo sigue bloqueado.

### Agravantes que se encontraron en el camino

- `onConsoleMessage` corre en el **hilo de interfaz** y llamaba al puente de
  forma síncrona. Un solo mensaje de consola congelaba la pantalla hasta 10 s
  (y con un error en bucle, para siempre).
- `onReceivedError` hacía lo mismo.
- `leerConfig()` (que usa `chatEstado()`, cuatro veces por arranque) llamaba a
  `call("config")`, otra espera de 10 s cada una.
- `logs` y `revision` crecían sin límite: cada mensaje de consola de la WebView
  se guardaba en SQLite. La migración del arranque se volvía más lenta con el
  tiempo. El archivo `logs/fabrick.log` tampoco rotaba.
- El loader era **100 % dependiente de JavaScript**: su barra la movía
  `requestAnimationFrame` y su desaparición, un `setTimeout`. Si el hilo se
  bloqueaba, se quedaba en 0 % para siempre.

## 2 · Las reglas que ahora se cumplen

Estas son invariantes del proyecto. **Si un cambio las rompe, el fallo vuelve.**

1. **La primera pintura no espera al núcleo.** `iniciar()` anima el loader, lo
   retira y recién en el siguiente turno (`setTimeout(..., 40)`) toca el núcleo.
2. **Ninguna llamada al puente espera más de 900 ms.** `NativeBridge.call()`
   espera como máximo `TOPE_MS`; si el núcleo no está, devuelve
   `{"ok":false,"codigo":"NUCLEO_OCUPADO","reintentar":true}` en vez de bloquear.
   Sólo las operaciones pesadas que el usuario pidió (exportar, sync, respaldo)
   usan `TOPE_PESADA_MS` = 20 s. `LENTO` es un estado normal, no un error.
3. **`ping` no espera nunca.** No necesita SQLite: responde desde la primera
   instrucción de Rust.
4. **Los registros (`log.append`, `revision.registrar`) no esperan ni fallan.**
   Si el núcleo no está, devuelven `{"ok":true,"registrado":false}`. Así el
   escáner de errores no se realimenta con sus propios errores.
5. **El hilo de interfaz no llama al puente.** `onConsoleMessage` encola en
   `ColaConsola` (hilo de fondo, cola acotada a 64); `onPageFinished` y
   `onReceivedError` también usan hilo de fondo o bitácora.
6. **El loader no depende de JavaScript.** Su barra y su desvanecido son
   animaciones CSS sobre `transform` y `opacity` (se componen en el hilo
   gráfico). Además lleva `pointer-events: none` desde el primer instante:
   aunque quedara visible, **nunca se come un toque del login**.
7. **El acceso no depende del núcleo.** El PIN se verifica contra
   `SharedPreferences` (`huellaVerificarPin`, PBKDF2 en Java). La tabla
   `usuarios` es el **respaldo**, no el camino principal.
8. **Lo cosmético va diferido.** `perfilCargar()` (foto, nombre, código de
   barras desde SQLite) corre en el turno siguiente: si el núcleo tarda, la
   tarjeta se ve con los valores por defecto y el PIN ya responde.
9. **Todo lo que se puede recuperar, se recupera solo.** Cuando el núcleo
   termina, `NativeBridge` evalúa `window.__fabriNucleoListo()`, que repinta el
   arranque, refresca el chat y vuelve a decidir la pantalla de acceso.
10. **Al volver del segundo plano el loader se retira sin condiciones.**
    `pageshow` (con `persisted`) y `visibilitychange` llaman a `alVolver()`, que
    oculta la capa, la saca del flujo (`display:none`) y rearma el arranque.
    Android pausa las animaciones CSS: la de salida no se completa y la capa
    sigue encima del login capturando toques.
11. **`.loader-oculto` desactiva la animación.** `animation: none` +
    `visibility: hidden` + `pointer-events: none`. Sin `animation: none`, la
    animación `loader-salida` **vuelve a pintar** la capa al retirar la clase.

## 3 · Arquitectura del arranque (0.9.11)

```
onCreate
  ├─ Bitacora.iniciar()                    archivo, no depende de nada
  ├─ new NativeBridge()                    System.loadLibrary("fabrick_core")
  ├─ WebView + ActivosWeb (https://appassets.local)
  ├─ web.loadUrl(index.html)               primera pintura
  └─ hilo "nucleo-init" → initNucleo()     SQLite + migración + poda

index.html
  ├─ login visible en el HTML (sin `hidden`)
  ├─ loader con animación CSS (2,4 s barra / 2,9 s salida)
  ├─ script de respaldo del login        (antes de app.js)
  ├─ script de respaldo del loader      (3,2 s y 6 s)
  ├─ diagnostico.js                      escáner de errores
  └─ app.js
       ├─ iniciar()      → anima y retira el loader; núcleo en el turno siguiente
       ├─ chatIniciar()  → sólo prefs/nativo, sin esperar SQLite
       ├─ saludIniciar() → ping cada 45 s (primero a los 9 s)
       └─ FabriLogin.iniciar()
            ├─ aplicar()       huellaEstado() (prefs, instantáneo)
            ├─ malla + PIN + escucha de teclado
            └─ perfilCargar()  diferido, puede esperar al núcleo
```

## 4 · Cómo diagnosticar en el teléfono (sin cables)

### 4.1 Bitácora de arranque

`Bitacora` escribe `filesDir/arranque.log` desde el primer instante, **sin pasar
por el núcleo ni por SQLite**. Se lee desde **Menú ☰ → Diagnóstico → Bitácora de
arranque** (botones *Refrescar* y *Limpiar*).

Formato: `+000123 ms  etiqueta  detalle`. Etiquetas que importan:

| Etiqueta | Qué dice |
|---|---|
| `onCreate` | arrancó la actividad |
| `puente` | se creó el puente y se cargó la `.so` |
| `webview` | se pidió `index.html` |
| `pagina` | `onPageFinished` (la página cargó) |
| `scripts` | `login=object/undefined`, `diag=object`, último error |
| `estado-5s` | a los 5 s: `loader=`, `login=`, `delegacion=`, `nucleo=` |
| `nucleo` | inicio y fin de `init`, con milisegundos |
| `nucleo-ocupado` | una operación llegó antes de que el núcleo estuviera listo |
| `lento` | una operación tardó ≥ 700 ms (síntoma de núcleo atascado) |
| `consola` | mensajes de la WebView (errores de JavaScript incluidos) |
| `recurso` | un recurso no cargó (URL exacta) |
| `renderer` | Android mató el renderer por memoria |

**Lectura rápida:**

- `estado-5s` con `loader=1` → el loader no se retiró (revisar CSS y bloqueo).
- `estado-5s` con `delegacion=false` → `app.js` no terminó de ejecutarse.
- `scripts` con `login=undefined` → `app.js` murió antes del final.
- `nucleo` sin línea de fin → `init` se colgó (SQLite/WAL).
- Muchas líneas `nucleo-ocupado` → la interfaz está pidiendo antes de tiempo.

### 4.2 Escáner de errores (en pantalla)

Botón flotante **⚠ DIAG** (abajo a la derecha) o **Menú → Diagnóstico**.
`FabriDiag.ultimo` da el último error con hora; el panel permite **Copiar** el
texto completo para pegarlo en un informe.

### 4.3 Lo que **no** hay que hacer para diagnosticar

- No reiniciar OpenCode desde la sesión (mata la sesión).
- No usar `pm2` (el daemon se come la RAM y el kernel mata OpenCode).
- No capturar con el Chromium completo: usar el headless shell.
- No pedir `am start` ni `dumpsys package`: este teléfono no lo permite.

## 5 · Checklist antes de tocar el arranque o el login

1. `node --check` de los seis `.js`.
2. `node dom-hostil.js` → **0 roturas** (ningún id ausente puede cortar `app.js`).
3. `node carga-sin-bloqueo.js` → **0 llamadas nuevas al puente durante la carga**
   (las tres permitidas son `chatEstado`, `localEstado`, `huellaEstado`, todas
   de preferencias, sin SQLite).
4. `bash tests/seguridad/correr.sh` → 23/23.
5. `bash tests/seguridad/validar-manifiestos.sh` → 23/23.
6. Compilar, firmar e instalar **encima** (no desinstalar: se perdería el
   modelo local del sandbox).
7. Abrir la app y mirar `estado-5s` en la bitácora.

### Prohibiciones concretas

- **No** agregar `api("…")` en el nivel superior de un script.
- **No** llamar `FabrickNative.call(...)` desde un callback del hilo de interfaz
  (`onConsoleMessage`, `onReceivedError`, `onPageFinished`).
- **No** subir `ESPERA_NUCLEO_MS` por encima de ~1,5 s.
- **No** hacer que el loader dependa de `setTimeout` para desaparecer.
- **No** poner un elemento opaco encima del login (el loader ya no lo es).
- **No** retirar el loader sólo con `opacity`: hay que desactivar su animación
  y sacarlo del flujo, o reaparece al volver del segundo plano.
- **No** tocar `--version-code` a mano en `compilar.sh`: se lee del manifiesto y
  se verifica dentro del APK (un `versionCode` repetido no instala encima).

## 6 · Logo del loader: el «cuadro negro» de la F

El SVG original tenía un corte entre el asta y el brazo de la F relleno con
`<path fill="#050505" opacity="0.94">`. Sobre el halo verde, ese rectángulo
tapaba el brillo y se veía como **un cuadro negro distinto al fondo**.

Corrección (0.9.11): la F es **una sola silueta sólida** — el brazo nace en el
asta (`M88 135 H210 L180 195 H88 Z`) y **no hay ningún relleno oscuro ni
máscara**. Aplica a `logo-loader.svg` (pantalla de carga) y `logo-f.svg`
(cabecera).

## 7 · Versiones

| Versión | versionCode | Cambio |
|---|---|---|
| 0.9.10 | 25 | `al()` contra ids ausentes, respaldo del login, tarjeta del operador |
| 0.9.11 | 26 | Arranque sin bloqueo, loader CSS, bitácora, F sólida, poda de registros |
| **0.9.12** | **27** | Loader retirado al volver del segundo plano, `LENTO` como estado normal, ficha del producto, lector EAN propio, impresión 80/58/A4, sync `/api/inventario` |
