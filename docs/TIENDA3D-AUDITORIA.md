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
