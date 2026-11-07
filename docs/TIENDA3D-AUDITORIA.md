# FORGE CORE STOCK · Experiencia 3D — auditoría y plan

> FASE 1 · 2026-11-05 · lectura completa del visor antes de tocar una línea.
> Regla rectora: **modificar lo existente, no destruirlo**. Este documento es
> la base de las fases 2 a 9 del prompt maestro.

## 1 · Qué existe hoy

Todo vive en **un solo módulo**: `web/app/tienda3d.js` (2.354 líneas, IIFE
`window.Tienda3D`), con el HUD declarado en `web/app/index.html` (70 ids
`t3d*`) y sus estilos en `web/app/styles.css` (121 reglas `t3d`).
`three.js` (MIT, `vendor/three.min.js`, 608 kB) se carga **bajo demanda** al
entrar a la tienda (`cargarThree()`), no en la shell.

### 1.1 Inventario de componentes reutilizables

| Área | Qué hay | Estado |
|---|---|---|
| **Escena** | local 18 × 20 × 3,2 m; `construir(cat)` reconstruye todo al cambiar de local | completo |
| **Piso** | `texturaPiso()` (canvas 256², baldosa clara) + HD CC0 `texturas/piso-{diff,nor}.jpg`, MeshPhong `shininess:70` | funciona, **no porcelánico ni reflectante** |
| **Techo** | placa `0x15171a` + casetones + 16 luminarios con halo y haz + 5 vigas | funciona, **no es techo industrial** |
| **Muros** | 4 planos negros + zócalo + franja lima + wordmark `texturaMarca()` | funciona, **no hay claros ni paneles negros estratégicos** |
| **Góndolas** | 6 en `GONDOLAS`, 4 niveles `NIVELES`, laterales/repisa/filo, letreros de pasillo con varillas | completo |
| **Productos** | 1 `InstancedMesh` por nivel (≈24 caras), portada canvas `texturaPortada()`, `userData.mapa` para raycast, hueco cada 7 | completo pero **geometría única (caja)** |
| **Neveras** | 4 niveles, vidrio corredera, LED interior, **geometría caja/cilindro diferenciada por `tipo`** | completo (aquí sí hay variedad) |
| **Precios** | `texturaTira()` por estante + ficha flotante `t3dPrecio` + EAN-13 en `t3dFichaBarra` | completo |
| **Iluminación** | ambient + hemi + key con sombra + relleno + contra lima + 6 puntos de techo; presets `confort/calido/neutro/lima/cine`; kelvin, intensidad, órbita, sombra; `aplicarLuz()`; **ACES + PCF soft** | profesional, **sin grupos LED independientes** |
| **Cámaras** | 4 fijas (`crearCamaras`) + panel `t3dCamsFull` con rejilla de etiquetas | completo |
| **Movimiento** | 1ª persona, `teclas` WASD, `choca()` colisión, inercia `vel`, cabeceo `bob`, correr, FOV dinámico | completo |
| **Controles** | 2 joysticks con **Pointer Events** + captura de puntero (`engancharStick`), arrastre de cámara, arrastre de puerta, sensibilidad guardada | completo |
| **Carrito 3D** | `crearCarrito()` metal + manilla lima + ruedas, sigue al jugador sin atravesar el piso, rebote al agregar | completo |
| **Carrito comercial** | **compartido**: `CLAVE_CARRITO = "fcore.mercado.carrito"` y `window.Mercado.agregar()`; `Mercado.total()` / `Mercado.unidades()` | **no hay segundo carrito** ✅ |
| **Ficha** | portada, categoría, precio CLP, stock, EAN-13, botón añadir | completo |
| **Animación** | `volar()` cajas hacia el carrito + `aviso3d()` + `carritoAnim` | completo |
| **Calidad** | `detectarPerfil()` (baja/media/alta por RAM, cores y GPU) + `aplicarCalidad()` con 4 botones y fps | completo |
| **Resiliencia** | `webglcontextlost` manejado, fallback `t3dFallback`, texturas HD con respaldo canvas | completo |
| **Catálogo** | `ponerTienda(cat, tienda)` desde MercadoPlacer; reconstruye sólo si cambió | completo |

### 1.2 Contratos que NO se pueden romper

1. `window.Mercado.agregar(p)` es el **único** escritor del carrito comercial
   (`fcore.mercado.carrito`). El visor sólo lo lee para pintar.
2. `ponerTienda(cat, tienda)` + `fueDelMapa()` son la puerta de MercadoPlacer.
3. `userData.mapa` en cada `InstancedMesh` es lo que el Raycaster devuelve.
4. `tests/web/diseno.js` castiga: clases del HTML **sin regla en CSS**, `<link>`
   o `<script>` remoto, y JS que no parsea. Todo HTML nuevo necesita CSS propio.
5. `web/app/sw.js` → `SHELL` precachea todo: un archivo nuevo que no entre ahí
   rompe el modo offline (y hay que subir `V`).
6. `window.__t3d()` es la sonda de diagnóstico usada por las pruebas.

## 2 · Huecos respecto al prompt (por prioridad)

| # | Pedido | Hoy |
|---|---|---|
| 1 | **Minimapa real** ligado a la posición del jugador, tocable y expandible | **no existe** |
| 2 | **Barra superior** con logo F, navegación (Inicio/Tienda/Productos/Mapa/Config) y total CLP | sólo `←`, marca y contador de unidades |
| 3 | **Panel de compra** (productos · unidades · total) | sólo `t3dCount` (unidades) |
| 4 | **Tiras LED integradas en las góndolas** | hay filo lima; **no hay LED** (sólo en la nevera) |
| 5 | **Interruptores LED independientes** (estante / techo / ambiental / decorativo) | no existen |
| 6 | **Techo industrial** (perfiles lineales, paneles luminosos, LED longitudinal) | casetones + vigas |
| 7 | **Muros claros + paneles negros estratégicos** | 4 muros negros |
| 8 | **Piso porcelánico reflectante** | baldosa clara con `shininess:70`, sin reflejos |
| 9 | **Geometrías diferenciadas en góndola** (botella, lata, bolsa, caja) | sólo caja (la nevera sí varía) |
| 10 | **Navegación asistida** catálogo → pasillo → guía y resaltado | no existe |
| 11 | **Botones flotantes** (interactuar, carrito, cámara, luz, mapa) | sólo *Correr* + Luz + Cámaras |
| 12 | **Bloom** moderado sobre los LED | no hay postproceso (sólo materiales emissive) |
| 13 | Perfiles BAJA/MEDIA/ALTA/**AUTO** + FPS | existe (verificar rótulos) |

## 3 · Plan por fases (adaptado a la estructura real)

| Fase | Dónde se toca | Qué se entrega |
|---|---|---|
| **2 · Escenario** | `texturaPiso()`, material del piso, bloque de muros, bloque de techo, `GONDOLAS.forEach` de `construir()` | piso porcelánico, muros claros con paneles negros, techo industrial, góndolas blancas/lima con **LED integrado** |
| **3 · Productos** | `geo` + `NIVELES.forEach` | geometría por categoría (caja/botella/lata/bolsa) manteniendo portadas, precios e `userData.mapa` |
| **4 · Iluminación** | grupos nuevos + `aplicarLuz()` + panel `t3dLuces` | interruptores LED que apagan geometría **y** luz real, con estado visible |
| **5 · HUD** | `index.html` + `styles.css` + bloque nuevo en `tienda3d.js` | barra superior, **minimapa real**, panel de compra, botones flotantes |
| **6 · Movimiento y carrito** | `engancharStick()`, `actualizarCarrito()` | sticks con respuesta visual, botones al alcance del pulgar |
| **7 · Integración comercial** | nuevo `navegarA()` + `Mercado.total/unidades` | navegación guiada desde el catálogo y total real en el HUD |
| **8 · Optimización** | `NIVELES_CALIDAD`, `aplicarCalidad()` | LEDs sin luz dinámica extra, 4 perfiles, FPS visibles |
| **9 · Pruebas** | `tests/web/*`, capturas con `masterlib/bin/shot.sh`, deploy | suites en verde + capturas + despliegue |

## 4 · Restricciones técnicas heredadas (de este entorno)

- **Vercel Hobby**: el sitio es estático; no se agregan funciones.
- **RAM del teléfono**: el build de video/capturas va por `shot.sh`
  (headless shell), nunca el Chromium completo.
- **sw v37 → v38** al tocar la shell de la app.
- Las suites existentes (`tests/web/diseno.js`, `boleta.js`) son la puerta:
  si algo no parsea o una clase se queda sin CSS, no se publica.

## Verificación ejecutada (HUD de mundo abierto)

Entorno: Termux/proot, headless shell de Chromium (sin GPU), WebGL por SwiftShader,
viewport móvil 360×640, calidad BAJA, servidor estático local.

### Probado de punta a punta (lógica y DOM reales)
- Interruptor LED «Techo»: el botón, `leds.techo` y la visibilidad real del grupo en
  la escena cambian juntos (encendido → apagado → encendido).
- Pedido: añadir desde la ficha sube el contador de la barra, el total en CLP
  ($489.990 con 1 unidad) y coincide con `Mercado.total()` / `Mercado.unidades()`.
- Plano del local: el minimapa abre el plano; tocar un pasillo lo identifica
  («Pasillo 1 · Equipos») y marca el destino; la leyenda lista los 6 pasillos.
- Cámaras: modo 4 vistas; tocar «CAM 3» la muestra en grande; «4 VISTAS» vuelve.
- Barra «Mercado»: navega fuera de la tienda 3D y limpia `en-tienda`.
- Desbordamiento horizontal móvil corregido (`#s-tienda` medía 392 px en 360 px).

### Corregido durante la verificación
- `pintarLeyenda()` y `avisoTexto()` llamaban a `esc()`, renombrado a `escHTML()`:
  la leyenda del plano quedaba vacía y el aviso «agregado» lanzaba excepción.
- `abrir()` creaba un contexto WebGL de prueba en cada entrada: tras varios
  reintentos el navegador devolvía null y la app decía «no tiene WebGL».
  Ahora la prueba y el perfil se calculan una vez por sesión.
- «Reintentar» tras la pérdida de contexto: primero `forceContextRestore()`;
  si no vuelve en 1,5 s, se reconstruye el renderer sobre un canvas nuevo.
- El bucle de render ya no llama a un renderer nulo (sigue vivo el HUD 2D).

### NO verificado (límite del entorno)
- **Render 3D real**: SwiftShader pierde el contexto a los ~10–25 s y, tras la
  primera pérdida, no permite crear otro. Sin GPU real no se puede certificar
  iluminación, LED ni fps. Las capturas `t3d-*.png` de este entorno no sirven
  como evidencia visual de la escena.
- Dispositivo Android físico (adb): no disponible.
- Rendimiento (30–60 fps en cada perfil): no medido en GPU real.

### Pruebas de contrato que siguen en verde
`tests/web/diseno.js` (48 comprobaciones), `tests/web/boleta.js` (15),
`tests/arranque/correr.sh` (9/9), `tests/inventario/correr.sh` (6/6),
`tests/seguridad/correr.sh` (23/23). `web/app/sw.js` sube a `fcore-v38`.

## Piso de cerámica blanca y luz de supermercado

Cambio pedido contra la imagen de referencia (pasillo de supermercado con
porcelanato blanco brillante y techo claro con franjas LED).

### Qué se cambió
- **Piso**: se dejó de aplicar `texturas/piso-diff.jpg` (beige/marrón), que
  teñía la cerámica. Ahora manda `texturaPiso()`: base `#ffffff`, baldosas casi
  blancas con junta gris visible, `shininess 64` y especular `#4a4f54` para el
  brillo de porcelanato. Escala corregida a `repeat 9×10` → baldosa de ~1 m
  (antes 0,56 m).
- **Techo**: fuera `texturas/techo-diff.jpg` (oscura). Plano `#e4e7e9`,
  perfiles de aluminio `#b9bec2` y carcasas de luminaria `#dfe3e5`. Las tiras
  LED pasan a blanco cálido `#fff3c4`, que rinde amarillo como la referencia.
- **Luz**: `sol` 0.50 → 0.62 → **0.74**; ambiente y hemisférica más altas; la
  temperatura por defecto sube de 4000 K a 5000 K (blanco neutro de súper).
  El reflejo del piso baja a opacidad 0.34 para que no lave la cerámica.
- Se dejan de descargar `piso-*.jpg` y `techo-*.jpg` (ya no se usan).

### Verificación
Consultado en vivo vía `window.__t3d().mat` (no por captura: en headless
SwiftShader pierde el contexto WebGL a los pocos segundos):

```
piso  : #ffffff, brillo 64, mapa de canvas, repeat 9×10
techo : #e4e7e9, sin mapa
luz   : amb 0.346, hemi 0.361, sol 0.78, kelvin 5000
```

Suites en verde: diseño, boleta, arranque 9/9, inventario 6/6, seguridad 23/23.
`sw.js` → `fcore-v39`.

**Sigue sin verificar el aspecto final en GPU real**: hay que abrirlo en el
teléfono para juzgar brillo, reflejos y tono.

## Paredes blancas, TV sin recortes y controles reordenados

### Paredes
La causa de las paredes grises era la foto `muro-diff.jpg`: promedia
RGB(142,135,122), un gris cálido que multiplicaba al material. Ahora el muro
usa `texturaMuro()`, un yeso generado casi blanco (#fcfcfb con grano), y de la
foto HD se conserva **sólo el normal map** (relieve). Color del material:
`#ffffff`.

### Televisor
Estaba girado 0,55 rad y pegado al muro: su mitad de 1,15 m se hundía en la
pared y la pantalla salía recortada. Ahora se separa 0,50 m, gira 0,38 rad,
escala 1,0 y el brazo/placa van hacia el muro. Verificado con la caja real
(`Box3`) del grupo:

```
muro en x = -9.000
TV     minX = -8.957  →  holgura 43 mm, atraviesaMuro = false
```

### Controles
- Herramientas (Luz, Cámaras, Interactuar, Mapa) pasan de la izquierda —donde
  tapaban el pasillo y la pantalla de ofertas— a la derecha, colgando del
  minimapa, en rejilla 2×2 de 52 px.
- Minimapa más chico (110 px en móvil) y pegado al borde, debajo de la barra.
- Panel desplegable de luces: más ancho (272 px), ocupa el alto útil, con
  scroll; al abrirse oculta minimapa, herramientas y «Correr».
- «Ocultar» pasa al borde izquierdo (a la derecha chocaba con las herramientas).
- El botón «Config» de la barra ahora también expone `aria-expanded`.

### Logo
Centrado respecto de la pantalla en móvil (`position:absolute; left:50%`), que
es donde los botones lo empujaban a la izquierda.

### Medido (sin captura: headless pierde el contexto WebGL)
Cajas reales a 360×640, 360×780, 412×915 y 1280×800: **0 solapamientos** entre
barra, logo, minimapa, herramientas, «Correr», sticks y pestaña «Ocultar»;
logo centrado en las tres medidas móviles. Panel abierto siempre dentro de
pantalla y con scroll.

Suites en verde: diseño, boleta, arranque 9/9, inventario 6/6, seguridad 23/23.
`sw.js` → `fcore-v40`.

## Acceso libre, metadatos y conteo de visitas por canal

### Acceso libre al visor y al mapa
- La puerta de acceso tiene ahora **«Entrar al visor 3D sin cuenta»**, que
  resuelve sin usuario y deja la app en **modo visitante**.
- Con `#tienda` o `#mercado` se entra directo, sin login.
- En modo visitante solo son públicas `tienda` (visor + minimapa + plano) y
  `mercado`. Cualquier otra pantalla (SQL, inventario, boletas, cuenta,
  consola) abre la cuenta en vez de mostrar datos; al autenticarse se retoma
  el destino pedido. Verificado: `sql` abre el login y no se muestra.

### Metadatos
- `<title>`: «FORGE CORE STOCK · Tienda 3D con recorrido».
- `description`: «Llevamos la experiencia del supermercado a la palma de tus
  manos…», más `keywords`, `robots`, `canonical`, Open Graph y Twitter Card.
- JSON-LD: se añade un `WebApplication` «Tienda 3D con recorrido» con
  `isAccessibleForFree: true` y `featureList` (recorrido, minimapa, catálogo,
  pedido). El JSON se validó con `JSON.parse`.
- `manifest.webmanifest`: nombre y descripción nuevos, y atajo «Visor 3D»
  (`./#tienda`).

### Conteo de visitas (canal de origen)
- Endpoint nuevo: **`POST/GET /api/visitas`** en `fabri-api` (misma base
  Postgres ya configurada; tabla `visitas` creada con `IF NOT EXISTS`).
- El **servidor** clasifica el canal: `utm_source`, navegador interno de la app
  (Instagram/Facebook/WhatsApp no mandan referrer) y dominio del referrer.
  Canales: instagram, facebook, whatsapp, google, tiktok, buscador, x,
  linkedin, qr, directo, otro.
- **Privacidad**: sin cookies de terceros; sólo un hash SHA-256 (IP + UA + sal)
  para contar únicos. Se respeta Do Not Track y `?noTrack=1`; los bots se
  descartan por user-agent; en localhost no se envía nada.
- Cliente: `web/app/visitas.js`, una visita por sesión (`sendBeacon`).
- Panel del dueño (`#s-nucleo`): tarjeta con total, hoy, ayer, únicos 30 d y
  barras por canal. Lee con la **clave de la nube** que ya se usa para el
  inventario; si falta, la pide (no inventa cifras). Caché de 60 s.

### Probado de verdad
Con `curl` contra producción:

```
POST UA "Instagram 300.0"            → canal "instagram"
POST utm_source=google               → canal "google"
POST UA "WhatsApp/2.23"              → canal "whatsapp"
POST UA "FBAN/FBIOS"                 → canal "facebook"
POST sin referrer ni utm             → canal "directo"
POST ref "l.instagram.com"           → canal "instagram"
GET  sin token                       → 401
GET  con token                       → total 6 · únicos 5 · CL, por canal y ruta
```

En el navegador (con clave real en `sessionStorage`), el panel mostró:
total 6 · hoy 6 · ayer 0 · únicos 5 · Instagram 2 (100 %), Directo/Facebook/
Google/WhatsApp 1 cada uno, y la nota con porcentajes. Sin errores de página.

### Corrección CORS del beacon (encontrada en producción)
La primera versión mandaba el beacon como `application/json`: el navegador
disparaba un preflight `OPTIONS` y el envío moría con `net::ERR_FAILED`. Se vio
en la consola de producción («blocked by CORS policy»). Ahora va como
`text/plain;charset=UTF-8`, que es tipo seguro para CORS y no requiere
preflight; el servidor parsea el cuerpo igual.

Verificación en producción (puppeteer con UA de Instagram contra
`https://fabri-core-web.vercel.app/app/#tienda`):

```
antes:   total 7 · instagram 3
después: total 8 · instagram 4     ← subió y con el canal correcto
pantalla: visitante=true, s-tienda=on, escena=true (143 objetos)
```

### Borrado del historial
`DELETE /api/visitas?antes=<ISO 8601>` (sólo con token del dueño) borra las
visitas anteriores a esa fecha. Se usó para limpiar las 8 visitas de prueba:
el contador quedó en **0**.

## Campo de visión, recorrido suave, carrito con caída y luz cinematográfica

### Por qué seguimos con Three.js
Se evaluó meter otro motor (PlayCanvas, Babylon, Filament). Se descartó: la app
ya usa **Three.js (MIT, gratis)** vendorizado, y añadir un segundo motor
duplicaría el peso, el arranque y el consumo de RAM en un teléfono que ya va
justo. Lo que hacía falta no era otro motor, sino exprimir el que hay.

### Cámara y recorrido
- **Campo de visión ajustable** en el panel (*Cámara → Campo de visión*),
  50–85°, por defecto **62°** (encuadre de cine, no ojo de pez). Se guarda en
  `fcore.tienda3d.fov`. Verificado: al mover el control a 70, la cámara pasa a
  70 y queda guardado.
- **Zona muerta** de 0,06 en los sticks: el pulgar ya no mueve la cámara con
  temblores.
- **Micro-pasos de 12 cm** en la colisión: al rozar un mueble se desliza en vez
  de trabarse y no se atraviesa nada a 3,2 m/s.
- **Cámara con inercia propia** (persigue la pose del cuerpo): quita el
  micro-temblor del paso sin retrasar la mirada. Balanceo reducido.

### Carrito: el producto cae y se queda
- Al añadir, la caja vuela en arco **hacia la cesta viva del carrito** (el
  destino se recalcula cada frame, así que sirve aunque el carrito se mueva).
- Al llegar, entra en la cesta, cae con desaceleración a una rejilla de 3×3×2
  y **queda visible**. Máximo 12 piezas para no castigar la GPU.
- Si el carrito comercial queda vacío, la cesta 3D se limpia sola.

### Iluminación y nitidez
- Presets **más claros** (ambiente, hemisférica y key suben ~20 %); el de
  confort pasa a ser luz de supermercado.
- **Sombra más nítida**: la cámara de sombra se ajusta al local (±10 × ±11 m)
  en vez del encuadre holgado; el mismo mapa rinde casi el doble de detalle.
- **8 luminarias** de techo en vez de 6, con más alcance.
- **Niebla clara** (`0xeef1f2`, 30–62 m): da profundidad sin oscurecer el fondo.
- **Sombras de contacto** con degradado radial bajo góndolas y neveras: anclan
  los muebles al porcelanato (antes eran rectángulos negros duros).
- **Piso a 512 px** con anisotropía 8: juntas más finas en perspectiva.
- **Graduación de color** por CSS sobre el canvas (saturación 1,07 · contraste
  1,05 · brillo 1,015), sin post-proceso WebGL. Se apaga sola en calidad BAJA
  (clase `cine-off`).

### Verificado en la escena (sonda `__t3d()`)
```
fov 62 · fovBase 62 → slider a 70 → fov 70, guardado "70"
luz: amb 0.412 · hemi 0.44 · sol 0.88 (antes 0.346 / 0.361 / 0.78)
muro: #ffffff con textura de lienzo y relieve · hijos 145 · err3d ""
añadir 1 producto → cesta 1 · añadir otro → cesta 2
```

Suites: diseño, boleta, arranque 9/9, inventario 6/6, seguridad 23/23.
`sw.js` → `fcore-v44`.

**Sin verificar visualmente**: el contexto WebGL muere en headless a los pocos
segundos, así que el juicio de brillo, reflejos y "look" final hay que hacerlo
en el teléfono.

## Fluidez y estabilidad de cámara (tras probarlo en el teléfono)

El recorrido se sentía pesado y la vista "flotaba". Medido sobre el video del
dispositivo (720 × 1594, dpr 2) y sobre la escena, las causas eran tres:

### Qué costaba
1. **Filtro CSS a pantalla completa** (`saturate/contrast` sobre el canvas):
   se paga en cada frame. Ahora sólo se aplica en calidad ALTA.
2. **8 luces puntuales + sombra a 2048 recalculada en cada frame**: el gasto
   más grande en un móvil. Ahora son **4 luces**, sombra de 1024 en media y
   **la sombra se recalcula cada 0,4 s** (el local es estático; sólo el carrito
   se mueve).
3. **Sombras de contacto** grandes y transparentes (overdraw) en todas las
   góndolas: se redujeron y se apagan en calidad BAJA.

### Cámara estable
- **Fuera la inclinación de cabeza** (`rotateZ` con el paso): era el
  "desbalance" del horizonte.
- **Fuera la inercia propia de la cámara**: la posición se copia del cuerpo.
  Esa inercia era la que hacía flotar la vista al girar y frenar. Verificado:
  `cam.z == pose.z` y `cam.rotZ == 0`.
- Balanceo reducido a 4–6 mm.
- El zoom al correr baja de 4° a 2° y entra más rápido (no parece "zoom").

### Más rápido y natural
- Paso 1,6 → **2,0 m/s**; correr 3,2 → **4,2 m/s**.
- Aceleración y frenada más rápidas (16/20 en vez de 9/13).
- Stick con respuesta más viva (14 en vez de 9).
- `dt` máximo 0,1 s: en equipos lentos el paso ya no se ralentiza.

### Auto-ajuste
Si en modo Auto el recorrido baja de **32 fps dos segundos seguidos**, se
recorta a media y luego a baja, con aviso. Nunca sube sola (eso oscila).

### Verificado
```
metros en 1 s caminando: 2,12  (objetivo 2,0)
cámara: cam.z == pose.z · rotZ = 0 · err3d ""
sin errores de página
```
Suites: diseño, boleta, arranque 9/9, inventario 6/6, seguridad 23/23.
`sw.js` → `fcore-v45`.

**Sin verificar en GPU real**: los fps y el aspecto final se juzgan en el
teléfono; aquí la métrica fiable es la pose, la cámara y la ausencia de errores.

---

## Productos con envase propio (v46)

### Qué estaba mal
En las capturas del teléfono los productos eran **el mismo prisma de 22 cm**
con una **portada cuadrada pegada en las seis caras**: la caja mostraba el
dibujo repetido en todos los lados, y la cara que miraba al pasillo salía
**girada y espejada**. El precio del estante era **un cartel único de 9 m**
con un número gigante, algo que no existe en ningún supermercado.

### Qué se cambió (`web/app/tienda3d.js`)
1. **Geometría por familia de producto**, no una caja para todo:
   - `LatheGeometry` torneada: `botella`, `vidrio`, `lata`, `frasco`, `yogur`
     (cada una con su silueta: hombro, cuello, rebordes de lata, boca ancha).
   - `ExtrudeGeometry` con esquinas redondeadas: `caja`, `bolsa` (con pliegues
     por desplazamiento de vértices) y `tetra` (envase de leche/jugo con
     piñón superior).
   - La familia se decide **por el nombre** (`formaDe`), porque el visor usa el
     catálogo de supermercado de `placer.js` y no el POS de `mercado.js`.
2. **Etiqueta en malla aparte**, siempre orientada al pasillo:
   - banda curva (`CylinderGeometry` de 135°) en los envases redondos;
   - plano en cajas, bolsas y tetra.
   El texto ya no se repite en las seis caras ni sale espejado.
3. **Materiales diferenciados**: vidrio `MeshStandardMaterial` (PBR:
   rugosidad 0,12 y metalness 0,05, translúcido), lata y botella
   `MeshPhongMaterial` con brillo alto, frasco translúcido, caja
   `MeshLambertMaterial` mate. Se descartó `MeshPhysicalMaterial` para el
   vidrio: en el rasterizador por software del headless no compila
   (`Shader Error 1282`, `VALIDATE_STATUS false`) y en móvil cuesta más por
   fragmento; `MeshStandardMaterial` da el mismo PBR sin ese riesgo.
4. **Color propio por producto** (`colorDe`): el tinte de la categoría se
   mezcla con un color de `PALETA` derivado del hash del nombre, así dos
   productos de la misma góndola no salen idénticos.
5. **Etiqueta dibujada** (`dibuEtiqueta`): banda de marca, panel de papel con
   el nombre, presentación en pastilla y código de barras simulado. El tamaño
   de letra se elige **midiendo el ancho real** de la línea (una palabra sola
   como «Detergente» se salía del papel).
6. **Tira de precios real**: etiquetas chicas repetidas cada ~3,4 veces su
   alto (plano de 0,14 m en vez de 0,27 m), con nombre, precio y presentación.
7. **Rendimiento intacto**: sigue habiendo **una `InstancedMesh` de cuerpos y
   otra de etiquetas por nivel**; el raycast usa sólo los cuerpos, así que
   tocar un producto sigue abriendo su ficha y agregándolo al carrito.

### Verificado (sonda `window.__t3d()` en headless)
```
err3d ""  ·  hijos 165  ·  góndola 24 niveles  ·  neveras 28 niveles
geometrías: LatheGeometry, ExtrudeGeometry, CylinderGeometry, PlaneGeometry
materiales: MeshPhongMaterial, MeshStandardMaterial, MeshLambertMaterial
0 errores de shader en consola (con MeshPhysicalMaterial salían 5)
24 etiquetas con mapa · 0 errores de página
```
Texturas revisadas como PNG (generadas directamente del canvas 2D):
`etq0`–`etq5` y `tira.png`. Colores medidos: Arroz `#d7aba9`,
Aceite `#e8bb3e`, Leche `#77eb4d`, Café `#ff8a6b`, Detergente `#9fa4e6`,
Bebida `#4ebecb`.

Suites: `diseno` 48, `boleta` 15, `arranque` 9/9, `inventario` 6/6,
`seguridad` 23/23. `sw.js` → `fcore-v47`.

**No verificado aquí**: el aspecto final en GPU real. En headless
(SwiftShader) el contexto WebGL muere a los 10–25 s, así que la captura no es
fiable; además Chrome vacía el canvas de una `CanvasTexture` después de subirla
a la GPU. La comprobación es por sonda y por las texturas 2D, no por captura.
