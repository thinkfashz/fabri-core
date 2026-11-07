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
   vidrio: añade funciones (IOR, `specularIntensity`) que cuestan más por
   fragmento en móvil y en el rasterizador por software del headless no
   compilan. `MeshStandardMaterial` da PBR de verdad (rugosidad/metalness)
   con el shader estándar.
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
24 etiquetas con mapa · 0 errores de página
```
Texturas revisadas como PNG (generadas directamente del canvas 2D):
`etq0`–`etq5` y `tira.png`. Colores medidos: Arroz `#d7aba9`,
Aceite `#e8bb3e`, Leche `#77eb4d`, Café `#ff8a6b`, Detergente `#9fa4e6`,
Bebida `#4ebecb`.

Suites: `diseno` 48, `boleta` 15, `arranque` 9/9, `inventario` 6/6,
`seguridad` 23/23. `sw.js` → `fcore-v47`.

**Sobre los `Shader Error 1282` de la consola**: al abrir la tienda directo
(`#tienda`) el headless los emite con cualquier material; la versión anterior
(`5de01c5`) emite 7 en el mismo flujo, así que no vienen del rediseño. No
aparecen al entrar desde `#mercado` y no hay errores de página en ningún caso.

**No verificado aquí**: el aspecto final en GPU real. En headless
(SwiftShader) el contexto WebGL muere a los 10–25 s, así que la captura no es
fiable; además Chrome vacía el canvas de una `CanvasTexture` después de subirla
a la GPU. La comprobación es por sonda y por las texturas 2D, no por captura.

---

## Ronda 2 · velocidad, brillo de producción, envases con marca y caché

Objetivo pedido: que el visor se sienta rápido, que la luz se vea "de video",
que la barra superior y los controles dejen de estorbar, que los envases se
distingan entre sí y que al abrir la app no cargue la versión anterior.

### Velocidad
- **Perfil de calidad más barato** (`NIVELES_CALIDAD`): `pr` 1.35 / 1.05 /
  0.85, sombra 1536 / 1024 / 512. En `media` se apagan las 4 luces puntuales
  y las sombras de contacto; en `baja` también el mapa de sombras. El relleno
  por fragmento era el gasto dominante en móvil.
- **Velocidad de marcha**: `velMax` 2.9 m/s caminando y 5.6 m/s corriendo
  (antes 2.0 / 4.2) y aceleración 20 / 24 (antes 16 / 20). La sensación de
  "lag" era en gran parte la inercia, no los FPS.
- **Sombras cada 900 ms** en vez de 400 ms: el local es estático.
- **`renderer.compile(scene, camera)`** tras construir: los shaders se
  compilan antes del primer frame en vez de repartirse en tirones al entrar.

### Iluminación y brillo
- **Exposición ACES más alta** en los seis presets (`confort` 1.16, `neutro`
  1.12, `frio` 1.10, `calido` 1.10, `lima` 1.10, `cine` 1.04) y ambiente,
  hemisférica y direccional subidas en la misma proporción. El objetivo es
  color vivo sin quemar blancos.
- **Entorno PMREM procedural** (`crearEntorno`): sala mínima con techo
  encendido, pared cálida, pared fría y piso oscuro; se genera una sola vez
  por renderer y se aplica como `envMap` a lata, botella, frasco y vidrio.
  Es lo que hace que un envase devuelva un reflejo creíble en vez de un plano
  muerto. Se regenera si el renderer se reconstruye tras perder el contexto.
- `MeshPhysicalMaterial` para vidrio quedó descartado: en el rasterizador por
  software del headless y en algunos móviles viejos no compila.

### Envases: marca y familia
- **Marca por producto** (`MARCAS` + `marcaDe`, hash del nombre): diez marcas
  de la casa repartidas de forma estable. Dos productos distintos ya no
  comparten etiqueta.
- **Familia visible** en la banda superior (`FAMILIA_TXT`): BOTELLA, LATA,
  CAJA, BOLSA, FRASCO, POTE, TETRA, VIDRIO. Se distingue el formato antes de
  leer el nombre.
- **Neveras rehechas**: antes eran cilindros blancos y cajas con la misma
  portada repetida en las 7 puertas. Ahora comparten **las mismas familias
  geométricas y la misma etiqueta que la góndola**, construidas una sola vez
  en espacio de mundo para las 7 neveras (cuerpos por familia + etiquetas por
  producto). `cong` pasó de 28 a 29 mallas con 194 hijos totales.
- Se descartó un pictograma tenue de fondo en la etiqueta: se veía como una
  mancha, no como arte de envase.

### Interfaz
- **Barra superior de una línea**: la fila permanente de cinco pestañas pasó a
  un **menú plegable** (`#t3dMenu` → `#t3dNav`), hoja bajo la barra. El pedido
  se compactó a una línea (`$total` + `n ped · n u`).
- **Herramientas laterales** de rejilla 2×2 a **columna de iconos de 44 px**.
- `--t3d-barra` bajó de **106 px a 56 px** en móvil; minimapa 96 px y panel de
  precios a 152 px. La media query `max-width: 760px` ya no fuerza la rejilla
  2×2 ni la fila de pestañas.

### Caché y actualización
- El service worker ya hacía `skipWaiting` + `clients.claim` y borraba cachés
  viejas. Se añadió:
  - **recarga única en `controllerchange`** (sólo si ya había un controlador,
    para no recargar en la primera instalación);
  - `reg.update()` al volver `online`, al volver a la pestaña y cada 30 min;
  - botón **«Limpiar caché y actualizar»** (`#btnCache`) en Config, que
    desregistra el SW, borra todas las cachés y recarga.
- `sw.js` → **`fcore-v48`**.

### Verificado
Sonda `window.__t3d()` en headless, con el service worker desregistrado:
```
err3d ""  ·  góndola 24  ·  neveras 29  ·  hijos 194  ·  0 errores de página
--t3d-barra 56px  ·  .t3d-tools grid-template-columns 44px  ·  .t3d-nav absolute
```
Menú: `document.getElementById('t3dMenu').click()` abre la hoja (370×237 bajo
la barra) y el segundo clic la cierra. Con `p.click()` la prueba falla **sólo**
porque en SwiftShader el contexto WebGL se pierde y la capa
«La gráfica se reinició» tapa el HUD en ese instante; comprobado con
`document.elementFromPoint` (`DIV.t3d-cargando`).

Etiquetas revisadas como PNG: `fin0`–`fin3` (Arroz/DEL VALLE/BOLSA,
Aceite/DEL VALLE/BOTELLA, Cerveza/ANDINA/LATA, Leche/COSTA/TETRA).

Suites: `diseno` (48 comprobaciones, 253 clases del HTML con estilo),
`boleta` 15, `arranque` 9/9, `inventario` 6/6, `seguridad` 23/23.

**No verificado aquí**: FPS y aspecto en GPU real. En headless el contexto
WebGL muere a los 10–25 s y la captura no es fiable; la comprobación es por
sonda, por medidas de layout y por las texturas 2D.

## Ronda 3 · zona fresca, anuncios grandes y productos distintos (v49)

Objetivo pedido: que el interior se lea como un supermercado real — verduras
en islas centrales, zona de refrigerio y refrigerados, anuncios más grandes y
repartidos, y que los productos de góndola dejen de verse todos iguales.
La geometría se construyó con el enfoque de la skill **`img2threejs`**
(procedural por código, cero assets externos), aplicado al bloque nuevo de
`tienda3d.js` y no a una pieza suelta.

### Zona fresca (mitad de entrada, `z > 4,5`)
- **3 islas de verdura** en `z = 6,4` (`x = −4,8 / 0 / 4,8`): zócalo verde,
  cuerpo de madera con listones, 4 cajas por isla (una por producto) y cartel
  colgado «MERCADO FRESCO» con los nombres de la isla.
- **12 tipos** en `FRESCOS` con geometría propia: esfera deformada (tomate,
  papa, naranja, pimiento, brócoli, uva), `LatheGeometry` (manzana, cebolla),
  `CylinderGeometry` (zanahoria) y `TubeGeometry` sobre `CatmullRomCurve3`
  (plátano). El ruido de forma es determinista (`azar(i)`), no `Math.random`:
  la misma fruta se ve igual en cada visita.
- **Pila de 20 piezas por caja** en tres capas (12 + 6 + 2), instanciada por
  tipo: 12 `InstancedMesh` para 240 frutas. Color por instancia (±15 % de
  valor) y giro/posición con desorden fijo.
- **2 islas refrigeradas** en `z = 8,9` (`x = −4,8` «REFRIGERIO»,
  `x = 4,8` «REFRIGERADOS»): tres repisas con LED en el filo, 9 productos
  por isla con las **mismas familias geométricas y la misma etiqueta que la
  góndola**, tira de precios por repisa y cartel de categoría.
- **Luz propia**: panel LED sobre cada isla de verdura (dentro de
  `grupoLED.techo`, responde al interruptor) y una luz puntual cálida en
  `(0 · 2,8 · 7,2)`. Antes los puntos de techo llegaban sólo a `z = ±3,35` y
  la fruta quedaba en penumbra.
- **Colisión y minimapa**: `choca()` bloquea las 3 islas, las 2 neveras y los
  2 tótems; `dibujarMapa()` los dibuja con su color de zona.

### Productos: dos SKU por estante y remate de envase
- Cada nivel de góndola muestra **dos SKU de la misma familia**: un solo
  `InstancedMesh` de cuerpo con `setColorAt` por instancia y **una etiqueta
  por SKU** (antes una sola etiqueta repetida en las 48 caras).
- **Tapas y roscas** (`geoTapa`): botella, vidrio, frasco y pote llevan su
  remate en una malla aparte, tintado por luminancia del envase.
- **Irregularidad de reposición**: ±5,6 % de tamaño, alguno metido 5 cm más
  adentro y giro de ±0,044 rad. Era la causa de que la repisa se viera como
  una fila de soldaditos idénticos.

### Anuncios
- **4 carteles de pared** de 2,7 × 1,72 m (LÁCTEOS −20 %, DESPENSA 2×1,
  BEBIDAS −25 %, ASEO −30 %), con proporción 1,6:1 igual al lienzo.
- **2 banderolas en la entrada** (2,7 × 1,69 m) a los lados del wordmark, para
  no tapar el panel de la marca.
- **2 tótems de oferta** junto a la entrada, con colisión.
- Carteles de pasillo de 1,7 × 0,42 m → **2,34 × 0,58 m**.

### Errores corregidos en esta ronda
| Síntoma | Causa | Arreglo |
|---|---|---|
| Productos de la nevera flotando en el pasillo | `crearIslaRefri` sumaba `cfg.x/cfg.z` dentro de un grupo ya posicionado | coordenadas locales |
| La pila de fruta era una fila sobre el eje X | `o[0]` (columna) nunca se usaba al componer la matriz | `x + o[0] + jx` |
| Texto de los carteles aplastado | placo con proporción distinta al lienzo de la textura | placo derivado del lienzo |
| Etiqueta de precio 6 cm por delante de la caja | offset `0,29` sobre un filo en `0,255` | pegado a la cara de la caja |

### Verificado
```
node --check web/app/tienda3d.js            → OK
sonda __t3d()  err3d ""  gond 24  cong 29  frescos 12  refri 8  hijos 256
0 errores de página · 0 errores de consola
```
Bounding boxes (matrices de instancia leídas de `instanceMatrix.array` y
pasadas por `matrixWorld`, porque `Box3.setFromObject` ignora las instancias):

| Isla | x | y | z |
|---|---|---|---|
| verdura 0/1/2 | ±1,17 y ±0,62 alrededor de cada centro | 0 – 2,92 | 5,80 – 7,00 |
| refrigerada | ±1,25 | 0,06 – 2,27 | 8,40 – 9,41 |
| pila de fruta (20 uds) | 0,36 de ancho | 0,74 – 1,17 | 0,28 de fondo |

Colisión medida caminando: desde `(0 · 8,2)` avanzando 3 s se detiene en
`z = 7,423` (isla de verdura); desplazándose a `x = 3,123` atraviesa el pasillo
entre islas hasta `z = −0,283`.

Texturas nuevas revisadas como PNG: `ad-lacteos`, `ad-bebidas`, `ad-banda`,
`ad-fresco`, `ad-precio`.

Suites: `diseno` ✔ · `boleta` 15 ✔ · `arranque` 9/9 ✔ · `inventario` 6/6 ✔ ·
`seguridad` 23/23 ✔.

`sw.js` → **`fcore-v49`**.

**No verificado aquí**: aspecto en GPU real. En este headless (SwiftShader) el
contexto WebGL se pierde a los pocos segundos y la captura sale negra o con
«La gráfica se reinició»; por eso la comprobación es por sonda, por geometría
medida y por las texturas 2D, no por captura de la escena.

## Ronda 4 · robustez del visor y señalización colgante (v50)

Objetivo: que la tienda aguante fallos y equipos flojos sin quedarse a medias,
y que el local se lea como súper desde la puerta.

### Red de seguridad del decorado
- La zona fresca, las neveras de isla, los anuncios y la señalización se
  construyen **cada uno en su `try/catch`**. Un fallo ya no aborta `construir()`
  (antes una excepción en el decorado dejaba la escena sin góndolas ni carrito).
- El mensaje queda en `__t3d().decoErr` y se avisa por consola.
- **Probado de verdad**: se inyectó `throw new Error("fallo inyectado a
  proposito")` al inicio de `crearAnuncios()` y la tienda abrió igual —
  `gond 24 · cong 29 · frescos 12 · refri 8 · senales 10 · err3d ""`,
  `decoErr "fallo inyectado a proposito"` y un `console.warn` «decorado 3D».
  El error se retiró después y `node --check` quedó en verde.

### Zona fresca adaptativa (sin reconstruir la escena)
- Las pilas de fruta se dibujan con `InstancedMesh.count`: bajar la calidad
  **recorta piezas en caliente**, no destruye ni reconstruye nada.
- `ajustarZonaFresca()` se llama al construir y en cada cambio de calidad.
- Tope por caja: **alta 20 · media 14 · baja 8** (240 / 168 / 96 piezas en total,
  medido en la sonda como `frescosN`).
- Las tapas se apagan en `baja` y la luz puntual de la zona sigue el perfil.
- `__t3d()` ahora informa `frescosN`, `senales`, `cal` y `decoErr`.

### Carrito
- **No nace dentro de la isla**: nace en un hueco libre (0,95 · 7,85 junto al
  jugador, antes (0 · 6,7) dentro de la isla central de verduras).
- **Destino por prioridad**: delante (sin acercarse a menos de 1 m), costados y
  por último atrás. Antes, con el frente tapado, el carro se plantaba a 0,5 m de
  la cámara. Medido: caminando hasta la isla el carro queda a **1,25 m** detrás.

### Guardas de datos
- `crearZonaFresca` sale limpio si no hay islas; un tipo mal escrito en
  `FRESCOS` se salta sin romper la caja; `crearIslaRefri` ignora una isla sin
  productos. `destruirEscena` y `construir` reinician todos los contadores de la
  zona fresca.

### Pasillo: 1,7 m entre isla y nevera
Las islas refrigeradas pasaron de `z = 8,9` a `z = 9,15`: el hueco hasta las
islas de verdura (tope en 7,0) queda en 1,7 m y se puede pasar con el margen de
colisión de 0,4 m.

### Señalización colgante de pasillo
- Un cartel por pasillo (5) con la **categoría real** del mueble y su número,
  dos caras por cartel para que el texto no se lea espejado: 10 placas, 5
  materiales (la textura se comparte entre ambas caras).
- Placo de **1,52 × 0,38 m** (4:1, igual que el lienzo de `texturaCartel`) a
  `y = 2,90`, dentro del pasillo de 1,78 m: `4,92 – 6,44` en el pasillo de 5,68.
- Varillas de 0,11 m en **un solo `InstancedMesh`** (20 piezas, 1 draw call).
- Holgura medida: producto más alto a **2,53 m** (centro 2,39 + media altura),
  cartel desde **2,71** → 18 cm libres; techo a 3,20.

### Verificado
```
node --check web/app/tienda3d.js → OK
__t3d()  err3d "" · gond 24 · cong 29 · frescos 12 · refri 8
         frescosN 168 (media) · senales 10 · decoErr "" · hijos 267
calidad alta → frescosN 240 · baja → 96      (en caliente, sin recargar)
0 errores de página · 0 errores de consola propios
```
Cajas medidas con `instanceMatrix` + `matrixWorld`: isla de verdura
`y 0 – 2,92`, nevera `y 0,06 – 2,27`, pilas dentro de su caja.
Carrito: nace en `(0,95 · 7,85)`, tras caminar queda a 1,25 m del jugador.

Suites: `diseno` ✔ · `boleta` 15 ✔ · `arranque` 9/9 ✔ · `inventario` 6/6 ✔ ·
`seguridad` 23/23 ✔. `sw.js` → **`fcore-v50`**.

**No verificado aquí**: aspecto en GPU real y FPS. Este headless (SwiftShader)
pierde el contexto WebGL a los pocos segundos —de ahí los
«WebGL context could not be created» al cambiar de calidad— así que todo se
comprueba por sonda, geometría medida y texturas 2D.

## Ronda 5 · encuadre amplio, modo cine y carátulas (v51)

Pedido: más calidad y color, modo cine como referencia de iluminación, menos
brillo plano, brillo de envase ("lacado"), carátulas reales en los productos,
más amplitud de cámara (95–100 en vez de 85) y mejor ubicación de los carteles.

### Encuadre
- **FOV por defecto 92°** (antes 62) y rango **50–110** (antes 50–85). En un
  teléfono en retrato son ~54° horizontales contra ~33° de antes: el pasillo se
  ve entero en vez de un tubo.
- La clave de guardado pasó a `fcore.tienda3d.fov2`: un valor viejo de 62 no
  pisa el encuadre nuevo. El panel muestra `92°` y el slider llega a 110.

### Iluminación
- **Modo cine establecido por defecto** (`luzActual = "cine"`, botón activo en
  el panel) y reescrito: `amb 0.24 · hemi 0.28 · dir 1.30 · rell 0.20 · exp 0.94`
  contra `0.26 / 0.28 / 1.02 / 0.16 / 1.04`. Más key y menos ambiente es lo que
  da volumen; la exposición bajó para no quemar los blancos.
- **Todos los ambientes recalibrados** con la misma lógica: menos ambiente,
  más direccional y exposición 0,94–1,04 (antes 1,04–1,16). Se nota sobre todo
  en el papel de las etiquetas y en el metal.
- **Entorno PMREM con franjas**: cuatro tiras emisivas en el techo de la sala
  procedural y dos vitrinas (cálida y fría) en las paredes. Con `sigma` 0.012
  las franjas sobreviven al desenfoque y aparecen como una **raya de luz** en
  cada envase. Antes el reflejo era una mancha pareja y el producto se veía mate.

### Materiales (el "lacado")
- Caja, bolsa y tetra pasan de `MeshLambertMaterial` a **`MeshPhongMaterial`
  con specular y `envMap`**: film de polietileno y cartulina plastificada.
- Lata 150→165 de brillo y reflectividad 0,85→0,92; botella 110→128 y 0,55→0,72;
  frasco 130→140 y 0,5→0,66; pote 45→86 de brillo.
- En **calidad baja** se mantiene Phong (se apaga sólo el muestreo del entorno):
  bajar a Lambert devolvía el aspecto "de cartón" que se quería quitar.

### Carátulas de producto
Cada envase lleva una portada dibujada en canvas, **sin imágenes de terceros**
(todo son paths propios: cero licencias, cero descargas, funciona offline).

| Pieza | Qué hace |
|---|---|
| `TINTES_CAT` | paleta plausible por categoría: lácteos en blanco/azul, carnes en rojo, limpieza en violeta/turquesa, abarrotes en ocre… Antes la leche salía verde. |
| `TINTES_NOMBRE` | 16 excepciones por nombre: cola → rojo profundo, agua → celeste, detergente → violeta, marraqueta → trigo. |
| `ACENTO_CAT` | acento saturado para el dibujo: sobre un envase casi blanco el icono igual contrasta. |
| `arteDe` | 11 ilustraciones vectoriales (cartón de leche, hogaza, bistec, manzana, botella, saco, pulverizador, pez, copo de nieve, bolsa de snack, lata). |
| `dibuEtiqueta` | fondo degradado + brillo radial + franja de lacado diagonal, banda de marca, ventana con la ilustración, nombre, formato y código. |

Tres errores encontrados y corregidos mirando las portadas renderizadas:
- el nombre grande se montaba sobre el chip del formato («Reineta» sobre «1 kg»):
  ahora vive en una **caja reservada** entre la ilustración y el formato;
- los iconos salían **aplastados** (el recuadro es 1,8:1 y se escalaba por ancho y
  alto por separado): se dibujan en un cuadrado centrado;
- los iconos **desaparecían** sobre envases claros: se dibujan con el acento de
  la categoría, no con el tinte del envase.

`texturaEtiqueta` cachea por `id|tamaño`: dos estantes con el mismo SKU no
generan (ni suben a la GPU) la carátula dos veces. La caché se vacía en
`destruirEscena`.

### Carteles
- **6 carteles de pared** (antes 4): se sumaron FRUTAS y CONGELADOS en el muro
  de la entrada, que estaba vacío justo donde ahora está la zona fresca.
- Cada uno lleva **marco oscuro y barra LED** sobre el borde; antes era un plano
  suelto que parecía flotar.
- Todos alineados a **y = 1,70** con marco de 1,82 m: borde superior en 2,61,
  **5 cm debajo de la franja lima** del muro (2,66), así no la cortan.
- Las dos banderolas de la entrada usan el mismo marco y la marca queda intacta.

### Verificado
```
__t3d()  err3d "" · gond 24 · cong 29 · frescos 12 · refri 8
         senales 10 · anuncios 8 · hijos 269 · fov 92 · decoErr ""
panel    cine activo por defecto · «92°» · slider max 110
0 errores de página
```
- Las 10 portadas se renderizaron a PNG desde el propio canvas y se revisaron
  como hoja de contacto (leche, cola, arroz, detergente, pan, carne, manzana,
  pizza, reineta, papas): legibles, con color plausible y sin solapes.
- Un bug real durante la revisión: `mezcla()` recibía números en vez de
  `#rrggbb` y lanzaba `a.slice is not a function`; se corrigió a `hex()` y se
  volvió a renderizar (0 errores de página).

Suites: `diseno` ✔ · `boleta` 15 ✔ · `arranque` 9/9 ✔ · `inventario` 6/6 ✔ ·
`seguridad` 23/23 ✔. `sw.js` → **`fcore-v51`**.

**No verificado aquí**: aspecto y FPS en GPU real. Este headless pierde el
contexto WebGL a los pocos segundos, así que la comprobación es por sonda, por
las texturas renderizadas a PNG y por geometría medida. El FOV más amplio
muestra más objetos por frame: si en el teléfono baja el ritmo, el panel de
calidad ya recorta fruta, tapas y luces.

## Ronda 6 · productos vacíos, tiras de precio, densidad y mapa público (v52)

Todo esto sale de las capturas del teléfono, no de la sonda: el visor abría
pero los envases se veían como **cuadrados vacíos**, la tira tenía **un solo
precio gigante**, había **demasiados productos por estante**, el local se veía
**blanco y sin sombras**, y el envase que vuela al carrito era **una caja
genérica**.

### Por qué los productos salían vacíos
La carátula es un plano que se monta sobre la cara del envase. Su posición en
profundidad estaba horneada en la geometría (`z = 0.365`) y esa geometría se
escala con el envase. En las familias planas el cuerpo está comprimido en
profundidad (`fondo / fondoGeo` ≈ 0,1), así que el plano quedaba en
`0,365 × 0,1 = 3,65 cm` del centro: **dentro** de la caja, cuyo medio fondo es
3,5 cm. Resultado: caja de color liso, sin carátula.

- La geometría de la etiqueta quedó en `z = 0` y el desplazamiento se calcula
  en el mundo con `matEtiqueta(forma, matriz, fondo)`:
  `fondo / 2 + 3,5 mm` a lo largo del eje del envase. Vale para cualquier
  tamaño de caja.
- Se aplicó en los tres sitios: góndola, nevera de isla y congeladores.
- Medido: cuerpo en `x = −6,710` y su etiqueta en `x = −6,672` → **3,8 cm**
  hacia el pasillo, es decir 3,5 mm por delante de la cara.

### Tira de precios
Con dos SKU por estante el dibujo repartía el lienzo de 3072 px en **dos
celdas**, así que cada precio ocupaba media tira de 8,86 m y el resto quedaba
en blanco. Ahora pinta etiquetas de igual tamaño a lo largo de todo el filo y
**alterna los SKU** (`items[i % n]`): 18 etiquetas por estante en la góndola.
Alto del lienzo 48 → 64 px para que el precio tenga más cuerpo.
Revisado como PNG: `$74.990 / $29.990` alternados, nombre, formato y filete.

### Densidad
- Paso entre productos **0,31 → 0,44 m**: de ~48 caras por nivel a ~34, con
  27 cm de aire entre carátulas. Cada producto se lee por separado.

### Luz y sombras
- Todos los ambientes bajaron exposición y ambiente: **cine 0,82** (antes 0,94)
  con key 1,42 y ambiente 0,17; confort 0,94; neutro 0,90; frío y cálido 0,88.
  Menos velo blanco y más modelado.
- Muro `0xffffff → 0xf4f1ea` y techo `0xe4e7e9 → 0xd6dade`: el blanco puro
  llegaba a 1,0 y se comía las juntas.
- Reflejo del piso 0,34 → 0,22.
- **Sombras de contacto también en calidad baja**: son unos pocos planos y
  son lo único que apoya los muebles cuando no hay mapa de sombras.

### El envase que vuela al carrito
Era `BoxGeometry` con la etiqueta pegada en las seis caras. Ahora es el envase
real: `geoForma(forma)` con su tinte + carátula montada con `matEtiqueta`, y se
guarda como grupo. `disponerObjeto()` libera geometrías y materiales de un mesh
o de un grupo (la cesta y los vuelos usaban `mesh.geometry.dispose()` directo).

### Carátulas del catálogo de la tienda
El visor abre con el catálogo FORGE (Equipos, Insumos, Accesorios, Audio,
Protección) y esas cinco categorías caían en el dibujo genérico. Se agregaron
ilustraciones propias (terminal de venta, rollo de papel, cargador, parlante,
escudo con candado, cámara), su acento y su paleta, más un selector por nombre
para que una cámara IP no se dibuje como una báscula.

### Mapa y visor: una sola experiencia pública
- `PUBLICAS` pasó de `{tienda, mercado}` a **`{panel, tienda, mercado}`**: el
  mapa abre sin cuenta, igual que el visor.
- Desde el mapa, la hoja de cada local ya ofrecía «Ver tienda en 3D»; ahora el
  camino de vuelta también existe: en el plano del local, botón **«Mapa de
  locales»** (`#t3dMapaLocales`) que cierra el plano y abre `#panel`.
- Verificado: `#panel` abre sin login (`s-panel`, sin `#login.on`), y `#inv`
  sigue levantando la puerta de cuenta.

### Verificado
```
__t3d()  err3d "" · gond 24 · cong 29 · frescos 12 · refri 8
         senales 10 · anuncios 8 · 269 hijos · fov 92 · decoErr ""
etiqueta vs cuerpo  −6,672 vs −6,710  → 3,8 cm hacia el pasillo
tira 3072×64 → 18 etiquetas alternando dos SKU (PNG revisado)
portadas del catálogo FORGE renderizadas y revisadas (PNG)
suites: diseno ✔ · boleta 15 ✔ · arranque 9/9 ✔ · inventario 6/6 ✔ · seguridad 23/23 ✔
sw.js → fcore-v52
```

**No verificado aquí**: aspecto final y FPS en GPU real (el headless pierde
WebGL). Las capturas que originaron esta ronda sí son de GPU real: por eso los
arreglos se midieron contra lo que se veía en pantalla, no contra la sonda.
