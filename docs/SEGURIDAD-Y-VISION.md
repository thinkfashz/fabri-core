# Seguridad del acceso y visión por cámara

Evaluación de tres proyectos que se pidió revisar —**Authelia**, **FairScan** y
**MediaPipe**— y qué se adoptó, qué se descartó y por qué. Cada decisión está
atada a una consecuencia concreta en la APK o en la web, no a una preferencia.

---

## 1 · Authelia

**Qué es.** Portal de *single sign-on* y doble factor escrito en Go
(Apache-2.0, ~29k estrellas). Se pone delante de las aplicaciones web como
**proxy de autenticación** (`forward-auth` con Traefik/nginx/Caddy) o como
**proveedor OpenID Connect** certificado. Aporta TOTP, WebAuthn/passkeys, push,
reglas por dominio y política de sesión.

**¿Sirve en la APK?** No. Authelia autentica **peticiones HTTP a un proxy**: la
APK no pasa por un proxy, habla con SQLite en el propio teléfono. Meter un
servidor de identidad dentro de la app no aporta nada y añade una dependencia
que el usuario tendría que administrar.

**¿Sirve en la nube?** Sí, pero no es la prioridad hoy:

| Escenario | Authelia | Alternativa ya disponible |
|---|---|---|
| Proteger el panel con 2FA y SSO | Encaja: `forward-auth` en Cloudflare Tunnel o Vercel | Vercel Auth (hoy) |
| Varias apps con una sola sesión | Encaja (OIDC) | — |
| Costo | Contenedor + base + configuración | Cero |

**Decisión.** No se instala ahora. La web ya tiene autenticación local
(PBKDF2-SHA256, 120.000 iteraciones, sal única, sesión con token) y el panel
está detrás de Vercel Auth. Authelia se reevalúa si aparece un segundo servicio
que haya que proteger con la misma sesión; en ese momento el camino es
`forward-auth` sobre el túnel, no meterlo en la APK.

**Lo que sí se tomó de su modelo**, aplicado a la app:

| Idea de Authelia | Cómo está en FABRI-CORE |
|---|---|
| Sesión con caducidad | Bloqueo por inactividad a los 5 min dentro de la interfaz, además del bloqueo de Android |
| Verificación en el servidor, no en el cliente | La clave de la nube se valida con `Bearer` en `fabri-api`; el navegador nunca ve credenciales de base |
| Defensa ante fuerza bruta | PIN/contraseña local con PBKDF2; el login web no revela si el correo existe |
| Un secreto, un sitio | `FABRI_API_TOKEN` sólo en Vercel y en la sesión del navegador; nunca en el repositorio |

---

## 2 · FairScan

**Qué es.** App Android **nativa (Kotlin)** para escanear documentos, con
licencia **GPL-3.0**, ~980 estrellas. Sus temas la describen bien: `opencv`,
`tflite`, `segmentation`, `pdf`, `privacy`. Detecta el cuadrilátero del papel,
corrige la perspectiva, mejora la imagen y exporta PDF — todo en el dispositivo,
sin subir nada.

**¿Es una librería?** No: es una **aplicación completa**, no un SDK. No se puede
"importar" en FABRI-CORE. Y su licencia GPL-3.0 es incompatible con copiar
código a un proyecto que no sea GPL.

**Qué sí aporta.** Tres ideas que ya están en la app:

1. **Todo en el dispositivo**: el inventario, la ficha y el escáner funcionan
   sin red. Es el mismo principio que el arranque local-primero.
2. **Procesamiento con visión clásica antes que IA**: detectar el papel con
   contornos y umbral adaptativo es más barato y determinista que un modelo.
   El lector EAN propio sigue esa línea (tramos negro/blanco, no una red).
3. **Una acción, un resultado**: escanear produce un PDF; en FABRI-CORE,
   escanear produce un código y una ficha, sin pasos intermedios.

**Decisión.** No se integra (es una app, no una librería). Si más adelante hace
falta **escanear facturas de proveedor en papel** y guardarlas como imagen en la
boleta, el camino es reimplementar su enfoque con CameraX + OpenCV (Apache-2.0)
dentro de la app, no copiar FairScan.

---

## 3 · MediaPipe

**Qué es.** Framework de Google para visión en dispositivo. Para este caso
interesan tres tareas:

| Tarea | Para qué serviría |
|---|---|
| **Barcode Scanning** | leer EAN/UPC/Code-128 con rotación, desenfoque y poca luz |
| **Object Detection** (EfficientDet) | reconocer el producto por la cámara cuando no hay código |
| **Image Classification** | clasificar categoría (bebida, snack, limpieza) a partir de la foto |

**Estado en la APK.** El runtime nativo está preparado (llama.cpp + shim JNI),
pero **MediaPipe no está integrado**: hoy el escáner es el decodificador EAN
propio, que funciona sin binarios extra y ya pasa 13/13 pruebas.

**¿Local o nube?**

| Opción | Ventaja | Costo |
|---|---|---|
| **Local (Android, Tasks API)** | sin red, sin latencia, sin costo por foto | ~10-20 MB de `.so` + modelo; más superficie nativa |
| **Web (WASM, `@mediapipe/tasks-vision`)** | cero instalación, sirve en la PWA | ~5-10 MB de descarga; rendimiento variable |
| **Servidor (API propia)** | cliente liviano | sube fotos del inventario a un servidor: peor privacidad y costo por uso |

**Decisión.** Para la APK, **MediaPipe Barcode Scanning local** es la mejora
correcta y el decodificador EAN queda como respaldo (y para códigos dañados).
Para la web, **WASM en el navegador**, nunca subir la foto a un servidor: el
inventario de un negocio no tiene por qué salir del dispositivo para leer un
código. El reconocimiento de producto por foto (EfficientDet) se pospone: exige
un modelo entrenado con el catálogo real y sin eso sólo adivina.

**Orden de implementación cuando se retome:**

1. `com.google.mediapipe:tasks-vision` + modelo `barcode_landmarker.task`
   (~2 MB) en `android/libs`, cargado por `NativeBridge` sólo al abrir el paso 1.
2. Interfaz: si MediaPipe está disponible, se usa; si falla, el bucle cae al
   decodificador EAN sin que el usuario note el cambio.
3. Medir: tiempo por fotograma y RAM. El presupuesto del teléfono es ~700 MB
   libres; si el modelo empuja por encima, se queda el EAN.

---

## 4 · Resumen de decisiones

| Proyecto | ¿En la APK? | ¿En la nube? | Por qué |
|---|---|---|---|
| **Authelia** | No | Reevaluar con un segundo servicio | Es un proxy de identidad para HTTP, no una librería |
| **FairScan** | No (es una app, GPL-3.0) | No | Se adoptan sus principios, no su código |
| **MediaPipe** | Sí, siguiente paso (barcode local) | Sí, como WASM en el navegador | Mejor lectura de códigos sin subir fotos |

## 5 · Reglas de seguridad que no se negocian

1. **La app nunca ve credenciales de base.** Sólo un `Bearer` que el usuario
   pega; la conexión a Postgres vive en Vercel.
2. **La clave de la nube no se guarda en disco en la web** (`sessionStorage`) y
   en la APK vive en el almacenamiento de la app, nunca en el repositorio.
3. **`asegurar` es la única acción sin token** de `/api/inventario`: ejecuta un
   `CREATE TABLE IF NOT EXISTS` con columnas fijas, sin datos del cliente y sin
   `DROP`. Todo lo demás exige `Bearer`.
4. **SQL siempre parametrizado** y nombres de columna fijos: el cliente no
   elige tablas ni columnas.
5. **Las fotos no salen del teléfono** para leer un código.
