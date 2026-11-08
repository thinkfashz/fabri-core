/* ============================================================================
   TIENDA 3D · supermercado caminable
   ----------------------------------------------------------------------------
   Local luminoso (paredes y piso claros), cuatro góndolas —una por categoría—,
   un televisor colgado con ofertas, congeladores con puerta de vidrio que se
   corre con el dedo y productos que se agregan al carrito al tocarlos.

   Rendimiento: un InstancedMesh para cientos de productos, sombras sólo de los
   muebles, DPR limitado y niebla. three.js se carga al entrar (MIT).
   ========================================================================== */

window.Tienda3D = (function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const CLAVE_CARRITO = "fcore.mercado.carrito";

  const ANCHO = 18, LARGO = 20, ALTO = 3.2;
  const GONDOLAS = [-7.1, -4.26, -1.42, 1.42, 4.26, 7.1]; // 1,78 m de pasillo y 1,37 m al muro
  const G_ANCHO = 1.06, G_LARGO = 9.0;
  const NIVELES = [0.42, 1.02, 1.62, 2.22];
  const TINTES = {
    Equipos: 0xc8ff00, Insumos: 0xffb020, Accesorios: 0xb48cff,
    Audio: 0x3ddc84, "Protección": 0x5aa9ff
  };

  let T = null;
  let renderer, scene, camera, reloj;
  let vivo = false, listo = false;
  let puertas = [], tv = null, tvTextura = null, tvCanvas = null, tvGrupoRef = null;
  let raycaster, puntero;
  let yaw = 0, pitch = 0;
  const pos = { x: 0, y: 1.66, z: 8.2 };   // altura de los ojos: 1ª persona
  const vel = { x: 0, z: 0 };              // inercia: arranca y frena suave
  /* Campo de visión: 92° da amplitud de supermercado en vertical (en un
     teléfono en retrato son ~54° horizontales, contra ~33° que daba el 62).
     Se mueve entre 50 y 110 desde el panel y queda guardado. La clave de
     guardado cambia a `fov2` para que un valor viejo de 62 no pise el nuevo
     encuadre por defecto. */
  const FOV_DEF = 92;
  let fovBase = FOV_DEF;
  let fovAct = FOV_DEF;
  const teclas = {};
  let joy = { x: 0, y: 0 };
  let joyCam = { x: 0, y: 0 };
  const joyS = { x: 0, y: 0 }, joyCamS = { x: 0, y: 0 };   // versión suavizada
  let corriendo = false;
  let carrito = null, carritoCesta = null, carritoRuedas = [], carritoAnim = 0;
  let cestaItems = [], cestaN = 0;   // lo que ya cayó dentro y se mantiene
  let mirar = null;      // arrastre de cámara
  let puerta = null;     // arrastre de puerta de congelador
  let promos = [], promoIdx = 0, promoReloj = null, promoT0 = 0;
  /* ── catálogo del visor (mapa → tienda) ─────────────────────────────────
     El mapa de MercadoPlacer puede abrir este visor con el catálogo de un
     local: `ponerTienda()` deja el pedido pendiente y `abrir()` reconstruye
     la escena sólo si el catálogo cambió. `tiendaActiva` marca que el botón
     "atrás" debe volver al mapa y no al marketplace. */
  let catPendiente = null, catUsada = null, tiendaActiva = false;
  let escenaOk = false, enganchado = false;
  /* Mallas seleccionables (una por nivel de góndola + las de la nevera):
     cada una guarda su propio `userData.mapa` de productos. */
  let mallasGondola = [], mallasCong = [], mallasProd = [];
  let frescosMallas = 0, refriMallas = 0;   // islas de verdura y refrigerados
  /* Zona fresca adaptable: las pilas se dibujan con `mesh.count` (no se
     destruyen al bajar la calidad) y el resto son piezas que se apagan.
     `decoErr` guarda el fallo del decorado para no perder la tienda entera
     si una pieza nueva sale mal. */
  let frescosPilas = [], tapasGondola = [], luzFresca = null, decoErr = "";
  let senalesMallas = 0;                    // carteles colgantes de pasillo
  let resizeObs = null, resizeListo = false; // ajuste a cualquier pantalla
  /* Grabación del recorrido: se dibuja a 2K y se graba con MediaRecorder. */
  let grabador = null, grabChunks = [], grabIni = 0, grabReloj = 0;
  let grabPrevio = null;
  /* Niveles de grabación. Se mide por el LADO CORTO: 800p en un teléfono en
     retrato son 800 × 1642, que se ve bien, pesa poco y no frena el render
     mientras se graba. 2K queda disponible para quien quiera el archivo
     grande. */
  const CLAVE_GRAB = "fcore.tienda3d.grab";
  const GRAB_NIVELES = {
    "800": { corto: 800, mbps: 3.5, txt: "800p", nota: "800p: liviano y rápido de compartir" },
    "1080": { corto: 1080, mbps: 6, txt: "1080p", nota: "1080p: buen detalle, archivo mediano" },
    "2k": { corto: 1440, mbps: 9, txt: "1440p", nota: "1440p: máxima calidad (≈2K en 16:9), pesa y exige más al teléfono" }
  };
  let grabCalidad = "800";
  let anunciosMallas = 0;                   // anuncios de pared y banderolas
  let vuelos = [];                 // cajas volando hacia el carrito
  let fichaP = null, fichaOrigen = null;   // producto en la ficha abierta
  /* Materiales que reciben textura HD (Poly Haven / ambientCG, CC0).
     Se guardan al construir la escena para pintarlas cuando lleguen. */
  let refs = { piso: null, muro: [], techo: [], metal: [] };
  let luzTV = null, tvReloj = 0;          // resplandor del televisor y su reloj
  /* Iluminación profesional: key con sombra suave, relleno frío que
     levanta las sombras, contra-luz lima que separa los muebles del muro
     negro, y puntos de techo cálidos. El preset define el ambiente. */
  const luces = { amb: null, hemi: null, sol: null, relleno: null, contra: null, puntos: [] };
  const LUCES = {
    /* El ambiente bajo y el key alto son lo que da volumen: con ambiente
       alto todo queda plano y los blancos se queman. La exposición bajó en
       todos los presets para recuperar el detalle del papel y del metal. */
    confort: { amb: 0.36, hemi: 0.40, dir: 1.16, rell: 0.22, color: 0xfff9f2, exp: 0.94,
      desc: "Luz de supermercado: blanca, pareja y con sombras suaves." },
    calido:  { amb: 0.24, hemi: 0.30, dir: 0.94, rell: 0.18, color: 0xffe0b0, exp: 0.88,
      desc: "Luz de tienda de barrio: tono ámbar y sombras marcadas." },
    neutro:  { amb: 0.30, hemi: 0.34, dir: 1.02, rell: 0.20, color: 0xffffff, exp: 0.90,
      desc: "Luz pareja de supermercado: blanco neutro y sombras suaves." },
    frio:    { amb: 0.24, hemi: 0.30, dir: 0.92, rell: 0.24, color: 0xd6e9ff, exp: 0.88,
      desc: "Tono de cámara frigorífica: azulado y limpio." },
    cine:    { amb: 0.17, hemi: 0.20, dir: 1.42, rell: 0.16, color: 0xfff1dc, exp: 0.82,
      desc: "Modo cine: key fuerte y cálido, sombras profundas, blancos sin quemar y reflejo en cada envase." },
    lima:    { amb: 0.26, hemi: 0.30, dir: 0.98, rell: 0.20, color: 0xf2ffe0, exp: 0.90,
      desc: "Resplandor lima FORGE: contra-luz verde sobre muros claros." }
  };
  /* Cine es el modo establecido por defecto: es el que mejor lee el volumen
     de los muebles y el brillo de los envases. */
  let luzActual = "cine", intensidadLuz = 1, orbitaLuz = 20;
  let kelvinLuz = 5000, sombraLuz = 0.65, sensCam = 1;
  let camaras = [], cctv = false;

  /* ── LED por grupos ─────────────────────────────────────────────────────
     Cuatro interruptores independientes en el panel de luces. `techo`,
     `estante` y `decor` son grupos de geometría real de la escena (se ven
     y desaparecen); `ambiental` no es geometría: es la aportación de
     ambient + hemisphere, que `aplicarLuz()` atenúa al apagarlo. Apagar un
     grupo además modula las luces que lo alimentan, para que el cambio se
     note en la escena y no sólo en el panel. */
  const leds = { techo: true, estante: true, ambiental: true, decor: true };
  const grupoLED = { techo: null, estante: null, decor: null };
  let reflejoPiso = null, mallaLedEstante = null, mallaGlowEstante = null;
  let mallasContacto = [];   // sombras de contacto (se apagan en calidad baja)

  /* ── HUD de mundo abierto ────────────────────────────────────────────────
     `catsGondola` es la categoría real de cada góndola (la que reparte
     `construir`): el plano la muestra tal cual. `destino` es el punto que
     eligió el usuario en el plano (marcador en el minimapa). `camSolo` es
     la cámara individual del modo vigilancia; null = las 4 a la vez. */
  let catsGondola = [];
  let destino = null;
  let camSolo = null;
  let mapaT = 0;                  // último repintado del minimapa (ms)

  /* Calidad por dispositivo: el perfil se detecta solo y el usuario puede
     forzar un nivel. Afecta píxeles, tamaño de la sombra y puntos de techo. */
  const CLAVE_CAL = "fcore.tienda3d.calidad";
  const CLAVE_SENS = "fcore.tienda3d.sens";
  const CLAVE_FOV = "fcore.tienda3d.fov2";
  /* `pr` = densidad de píxeles, `sombra` = lado del mapa, `puntos` = luces
     reales, `contacto` = sombras de contacto (overdraw), `sombras` = encender
     el mapa de sombras. En móvil lo caro es el relleno: por eso baja recorta
     densidad, luces y sombras antes que geometría. */
  const NIVELES_CALIDAD = {
    alta:  { pr: 1.35, sombra: 1536, puntos: true,  contacto: true,  sombras: true },
    media: { pr: 1.05, sombra: 1024, puntos: false, contacto: false, sombras: true },
    /* En baja no hay mapa de sombras, pero las sombras de contacto son unos
       pocos planos y son lo único que "apoya" los muebles en el piso. Sin
       ellas el local se ve plano y flotando. */
    baja:  { pr: 0.85, sombra: 512,  puntos: false, contacto: true,  sombras: false }
  };
  let calidad = "auto", perfil = "media";
  /* ¿Se probó WebGL y se detectó la GPU? Se hace una sola vez por sesión:
     repetirlo agotaba los contextos vivos del navegador (ver abrir()). */
  let glOk = null, perfilListo = false;
  /* Último fallo de `abrir()`: queda a la vista en `window.__t3d().err3d`
     para no tener que adivinar por qué la escena no arranca. */
  let ultimoError = "";
  /* Temporizador del intento de recuperar el contexto WebGL (ver abrir()). */
  let restoreTimer = 0;

  function cargarThree() {
    if (window.THREE) return Promise.resolve(window.THREE);
    return new Promise((ok, mal) => {
      const s = document.createElement("script");
      s.src = "./vendor/three.min.js";
      s.onload = () => ok(window.THREE);
      s.onerror = () => mal(new Error("no se pudo cargar three.js"));
      document.head.appendChild(s);
    });
  }

  /* ── texturas generadas ────────────────────────────────────────────────── */
  /* Piso porcelánico: baldosa de 1,12 m en gris muy claro, juntas finas y
     uniformes, veteado apenas perceptible. El brillo NO viene de aquí: el
     reflejo de las luminarias lo aporta `texturaReflejo()` superpuesto, así
     que se controla por separado (y sin efecto espejo). */
  function texturaPiso() {
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const g = c.getContext("2d");
    g.scale(2, 2);            // se dibuja en 256 y se rasteriza a 512
    g.fillStyle = "#f7f8f8"; g.fillRect(0, 0, 256, 256);
    // cerámica blanca: baldosas casi blancas con variación mínima
    g.fillStyle = "#fbfcfc"; g.fillRect(0, 0, 128, 128); g.fillRect(128, 128, 128, 128);
    g.fillStyle = "#f2f4f4"; g.fillRect(128, 0, 128, 128); g.fillRect(0, 128, 128, 128);
    // junta fina y uniforme (2 px ≈ 1 cm a esta escala), más marcada
    g.strokeStyle = "rgba(60,66,70,.22)"; g.lineWidth = 2;
    g.strokeRect(1, 1, 254, 254);
    g.beginPath();
    g.moveTo(128, 0); g.lineTo(128, 256);
    g.moveTo(0, 128); g.lineTo(256, 128);
    g.stroke();
    // veta de porcelanato: dos trazos suaves, casi invisibles
    g.strokeStyle = "rgba(126,138,144,.09)"; g.lineWidth = 3;
    g.beginPath(); g.moveTo(6, 206); g.bezierCurveTo(74, 148, 128, 244, 250, 164); g.stroke();
    g.beginPath(); g.moveTo(60, 10); g.bezierCurveTo(140, 60, 150, 96, 240, 74); g.stroke();
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.set(9, 10);          // 18×20 m → baldosa de ~1 m
    t.anisotropy = 8;
    return t;
  }

  /* Yeso de muro: casi blanco. La foto HD promediaba RGB(142,135,122), un
     gris cálido que dejaba las paredes sucias; esta versión ronda 250 y sólo
     aporta el grano fino del yeso. El relieve lo sigue poniendo el normal map. */
  function texturaMuro() {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    g.fillStyle = "#fcfcfb"; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * 256, y = Math.random() * 256;
      const a = 0.015 + Math.random() * 0.02;
      g.fillStyle = Math.random() > 0.5
        ? "rgba(255,255,255," + a + ")" : "rgba(206,209,206," + a + ")";
      g.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.set(5.5, 1);
    t.anisotropy = 4;
    return t;
  }

  /* Reflejos controlados sobre el porcelanato: manchas alargadas bajo cada
     luminaria de techo y bajo las tiras LED de las góndolas. Un solo plano
     aditivo = 1 draw call, y se apaga junto al grupo «techo». */
  function texturaReflejo() {
    const W = 1024, H = 1138;                 // 18 × 20 m
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    g.fillStyle = "#000000"; g.fillRect(0, 0, W, H);
    const px = (x) => ((x + ANCHO / 2) / ANCHO) * W;
    const pz = (z) => ((z + LARGO / 2) / LARGO) * H;
    const mancha = (x, z, rx, ry, a) => {
      g.save();
      g.translate(px(x), pz(z));
      g.scale(rx, ry);
      const rg = g.createRadialGradient(0, 0, 1, 0, 0, 1);
      rg.addColorStop(0, "rgba(255,247,232," + a + ")");
      rg.addColorStop(0.45, "rgba(255,243,224," + a * 0.42 + ")");
      rg.addColorStop(1, "rgba(255,240,220,0)");
      g.fillStyle = rg;
      g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fill();
      g.restore();
    };
    // luminarias: 4 columnas × 4 filas, alargadas en el eje del pasillo
    [-5, -1.7, 1.7, 5].forEach((z) => {
      [-6, -2, 2, 6].forEach((x) => mancha(x, z, 120, 78, 0.30));
    });
    // tiras LED de las góndolas: rastro tenue a lo largo de cada mueble
    GONDOLAS.forEach((gx) => {
      for (let z = -4; z <= 4; z += 1.6) mancha(gx, z, 34, 52, 0.11);
    });
    // entrada: luz del exterior entrando por el acceso
    mancha(0, 9.2, 240, 90, 0.16);
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    return t;
  }

  /* Bajada de luz de una tira LED: degradado vertical que baja desde el
     filo de la repisa. Va en un plano aditivo de 9 m × 17 cm por lado. */
  function texturaBajadaLED() {
    const c = document.createElement("canvas");
    c.width = 8; c.height = 64;
    const g = c.getContext("2d");
    const rg = g.createLinearGradient(0, 0, 0, 64);
    rg.addColorStop(0, "rgba(255,247,232,.95)");
    rg.addColorStop(0.35, "rgba(255,243,222,.34)");
    rg.addColorStop(1, "rgba(255,240,218,0)");
    g.fillStyle = rg;
    g.fillRect(0, 0, 8, 64);
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    return t;
  }

  /* Halo radial del luminario: mancha de luz suave que simula el
     resplandor de la lámpara sobre el plafón. */
  /* Sombra de contacto: mancha radial oscura que se desvanece. Ancla los
     muebles al piso y es lo que más "asienta" una escena 3D. */
  function texturaContacto() {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    const rg = g.createRadialGradient(64, 64, 6, 64, 64, 64);
    rg.addColorStop(0, "rgba(10,13,15,.62)");
    rg.addColorStop(0.55, "rgba(10,13,15,.26)");
    rg.addColorStop(1, "rgba(10,13,15,0)");
    g.fillStyle = rg;
    g.fillRect(0, 0, 128, 128);
    return new T.CanvasTexture(c);
  }

  function texturaGlow() {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    const rg = g.createRadialGradient(64, 64, 3, 64, 64, 62);
    rg.addColorStop(0, "rgba(255,246,230,1)");
    rg.addColorStop(0.35, "rgba(255,240,214,.40)");
    rg.addColorStop(1, "rgba(255,238,210,0)");
    g.fillStyle = rg;
    g.fillRect(0, 0, 128, 128);
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    return t;
  }

  /* Letrero de pasillo: placa negra con el número en lima, la categoría
     grande y una chevrona de sentido. Se cuelga de dos varillas en los dos
     extremos de la góndola, como en un super de verdad. */
  function texturaCartel(texto, nro) {
    // Lienzo físico 1536×384 con el trazado en coordenadas de 1024×256:
    // el texto queda con 1,5× de resolución (letras más nítidas de cerca)
    // y la proporción del placo no cambia.
    const W = 1024, H = 256, E = 1.5;
    const c = document.createElement("canvas");
    c.width = Math.round(W * E); c.height = Math.round(H * E);
    const g = c.getContext("2d");
    g.setTransform(E, 0, 0, E, 0, 0);
    const de = g.createLinearGradient(0, 0, 0, H);
    de.addColorStop(0, "#14181c"); de.addColorStop(1, "#0b0d0f");
    g.fillStyle = de; g.fillRect(0, 0, W, H);
    g.fillStyle = "#c8ff00"; g.fillRect(0, 0, W, 14); g.fillRect(0, H - 8, W, 8);

    // cuadro del número
    g.fillStyle = "#c8ff00"; g.fillRect(46, 62, 132, 132);
    g.fillStyle = "#0b0d0f";
    g.font = "900 88px -apple-system, Segoe UI, Roboto, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(String(nro), 112, 132);

    // categoría, ajustada al ancho disponible
    const cat = String(texto || "").toUpperCase();
    let fs = 84;
    g.textAlign = "left";
    do {
      g.font = "900 " + fs + "px -apple-system, Segoe UI, Roboto, sans-serif";
      if (g.measureText(cat).width <= W - 224 - 100) break;
      fs -= 4;
    } while (fs > 34);
    g.fillStyle = "#ffffff";
    g.fillText(cat, 224, 116);

    // sub-label
    g.fillStyle = "#c8ff00";
    g.font = "700 30px -apple-system, Segoe UI, Roboto, sans-serif";
    g.fillText("PASILLO " + nro + " · OFERTAS", 226, 186);

    // chevrona de sentido
    g.strokeStyle = "#c8ff00"; g.lineWidth = 16;
    g.lineCap = "round"; g.lineJoin = "round";
    g.beginPath();
    g.moveTo(W - 132, 96); g.lineTo(W - 84, 132); g.lineTo(W - 132, 168);
    g.stroke();
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    t.anisotropy = anisoMax();
    return t;
  }

  /* Wordmark FORGE en el muro del fondo: el nombre en lima sobre el negro
     de la escena. Es rótulo de tienda, no el logo (la F no se toca). */
  function texturaMarca() {
    const W = 2048, H = 512;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    g.clearRect(0, 0, W, H);
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = "#c8ff00";
    g.font = "900 300px -apple-system, Segoe UI, Roboto, sans-serif";
    g.fillText("FORGE", W / 2, 172);
    g.fillRect(430, 336, W - 860, 10);
    g.fillStyle = "#ffffff";
    g.font = "800 86px -apple-system, Segoe UI, Roboto, sans-serif";
    g.fillText("CORE STOCK", W / 2, 428);
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    t.anisotropy = anisoMax();
    return t;
  }

  /* Tira de tablero: el rótulo de precios pegado al filo del estante.
     Fondo crema, nombre chico y precio grande, como en un super real. */
  function texturaTira(items, anchoCanvas, altoCanvas) {
    /* La tira se pinta como en un súper real: etiquetas del mismo tamaño
       repetidas a lo largo del filo, alternando los SKU del estante. Antes,
       con dos SKU, cada uno ocupaba MEDIA tira de 8,86 m y quedaba un solo
       precio gigante con el resto en blanco. */
    const W = anchoCanvas || 2048, H = altoCanvas || 128;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    g.fillStyle = "#efeadd"; g.fillRect(0, 0, W, H);
    const lista = (items && items.length) ? items : [{ nombre: "", precio: 0 }];
    const barra = Math.max(2, Math.round(H * 0.20));
    g.fillStyle = "#c8ff00"; g.fillRect(0, 0, barra, H);

    /* cada etiqueta mide ~3,4 veces su alto, como una de góndola */
    const anchoEt = Math.max(26, Math.round(H * 3.4));
    const celdas = Math.max(1, Math.floor((W - barra) / anchoEt));
    const celda = (W - barra) / celdas;

    for (let i = 0; i < celdas; i++) {
      const p = lista[i % lista.length];
      const x = barra + i * celda;
      g.fillStyle = "#fbfaf5";
      g.fillRect(x + 1, 1, celda - 2, H - 2);
      g.fillStyle = "rgba(200,255,0,.85)";
      g.fillRect(x + 1, 1, Math.max(2, Math.round(celda * 0.035)), H - 2);

      const nombre = String(p.nombre || "");
      const corte = nombre.indexOf("·");
      const titulo = corte > 0 ? nombre.slice(0, corte).trim() : nombre;
      const pres = corte > 0 ? nombre.slice(corte + 1).trim() : "";

      g.textAlign = "left";
      g.textBaseline = "middle";
      g.fillStyle = "#3d3a33";
      g.font = "700 " + Math.round(H * 0.21) + "px -apple-system, Segoe UI, Roboto, sans-serif";
      let nom = titulo;
      while (nom.length > 3 && g.measureText(nom).width > celda * 0.82) nom = nom.slice(0, -1);
      g.fillText(nom, x + celda * 0.08, H * 0.26);

      g.fillStyle = "#101214";
      const precio = "$" + Math.round(p.precio || 0).toLocaleString("es-CL");
      let fp = Math.round(H * 0.42);
      g.font = "900 " + fp + "px -apple-system, Segoe UI, Roboto, sans-serif";
      while (fp > 7 && g.measureText(precio).width > celda * 0.84) {
        fp -= 1;
        g.font = "900 " + fp + "px -apple-system, Segoe UI, Roboto, sans-serif";
      }
      g.fillText(precio, x + celda * 0.08, H * 0.68);

      if (pres && H >= 80) {
        g.fillStyle = "rgba(27,26,20,.55)";
        g.font = "600 " + Math.round(H * 0.14) + "px -apple-system, Segoe UI, Roboto, sans-serif";
        g.fillText(pres, x + celda * 0.08, H * 0.88);
      }
      if (i) {
        g.fillStyle = "rgba(27,26,20,.14)";
        g.fillRect(x, 3, 1, H - 6);
      }
    }

    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    t.anisotropy = 8;
    if (renderer && renderer.capabilities) {
      t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    }
    return t;
  }

  /* ── portadas de producto ────────────────────────────────────────────────
     Envases dibujados a mano en canvas (vector propio, sin licencias):
     tinte de la categoría, banda de marca, pictograma del formato y el
     nombre. Se usan en los estantes, en la nevera y en la ficha. */
  const PALETA = [0xc8ff00, 0xffb020, 0xb48cff, 0x3ddc84, 0x5aa9ff, 0xff8a6b, 0x9fd8ff, 0xff9ec4];

  function hex(n) {
    return "#" + ((n >>> 0) % 0x1000000).toString(16).padStart(6, "0");
  }
  function mezcla(a, b, k) {          // a, b en "#rrggbb"; k = peso de b
    const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
    const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
    return "rgb(" + pa.map((v, i) => Math.round(v + (pb[i] - v) * k)).join(",") + ")";
  }
  /* Color de envase por categoría. Antes cada producto mezclaba su categoría
     con un color de la PALETA al azar: la leche salía verde y la carne lila.
     Un súper real agrupa por familia (lácteos en azul y crema, carnes en
     rojo, limpieza en violeta y turquesa), así que el color se sortea dentro
     de una lista corta y plausible. */
  /* Excepciones por nombre: la cola no puede salir ámbar ni el agua violeta.
     Van antes que la paleta de la categoría, que sigue mandando en el resto. */
  const TINTES_NOMBRE = [
    [/leche|crema\b/, 0xf2f4f6],
    [/yogur|yogurt/, 0xdfe9f2],
    [/queso|mantequilla|manjar/, 0xf0e2b8],
    [/cola\b|cerveza/, 0x8e2a2a],
    [/agua\b/, 0xbfe4f2],
    [/jugo|naranja/, 0xe08a1e],
    [/detergente|cloro|lavaloza/, 0x6f5bd6],
    [/papel|toalla|servilleta/, 0xe8eef4],
    [/marraqueta|hallulla|pan\b/, 0xc98b4a],
    [/carne|pollo|cerdo|molida/, 0xb03a3a],
    [/manzana|frutilla|tomate/, 0xc42a2a],
    [/platano|pl[aá]tano|lim[oó]n/, 0xe8c53a],
    [/lechuga|palta|br[oó]coli/, 0x4f9e3a],
    [/reineta|merluza|salm[oó]n|camar[oó]n/, 0x4a7fa8],
    [/pizza|helado|hielo|congelad/, 0x6aa8c8],
    [/arroz|fideo|harina|az[uú]car/, 0xd8a13a]
  ];

  const TINTES_CAT = {
    "Lácteos": [0xe8eef4, 0xb9d2e8, 0x8fb8dd, 0xf0e6cf, 0xd8e2ec, 0xa9c4d8],
    "Panadería": [0xc98b4a, 0xa86a32, 0xe0b070, 0x8d5a2b, 0xd9a05e],
    "Carnes": [0xb03a3a, 0x8e2a2a, 0xc25a4a, 0x7d2b33, 0xa63a44],
    "Frutas y verduras": [0x4f9e3a, 0xd8342a, 0xe2761f, 0x8fbf3a],
    "Bebidas": [0x2f8fa8, 0xc33a3a, 0x3a6ea8, 0xd8a13a, 0x4a8a52, 0x8a4aa8],
    "Abarrotes": [0xd8a13a, 0xb97a2a, 0xc9a24a, 0x8a6a3a, 0xd9b45a],
    "Limpieza": [0x6f5bd6, 0x3aa8a0, 0x4a8ad8, 0x9b5bd6, 0x2f9e8a],
    "Pescados": [0x4a7fa8, 0x5a94b8, 0x2f6a8a, 0x6a9ab0],
    "Refrigerio": [0xc23a3a, 0xd88a2a, 0x8a5bd6, 0xc94a6a],
    "Congelados": [0x6aa8c8, 0x4a86a8, 0x7ab4d0],
    /* catálogo de la tienda FORGE */
    "Equipos": [0x3a5a6a, 0x2f4a5a, 0x466a7a, 0x24455a],
    "Insumos": [0xe8e2d4, 0xd2cbb8, 0xc0b8a2],
    "Accesorios": [0x3a4a8a, 0x5a5ab8, 0x2f3a7a, 0x4a5aa0],
    "Audio": [0x2a2f36, 0x3a424a, 0x1f242a],
    "Protección": [0x8a2a3a, 0xa83a4a, 0x6d2230]
  };

  /* Acento de la ilustración. El color del envase puede ser casi blanco
     (lácteos) y entonces un dibujo del mismo tono desaparece; el acento es
     la versión saturada de la categoría y siempre contrasta. */
  const ACENTO_CAT = {
    "Lácteos": 0x2f6ea8, "Panadería": 0x8d5a2b, "Carnes": 0x8e2a2a,
    "Frutas y verduras": 0x3f7a2f, "Bebidas": 0x1f6f8a, "Abarrotes": 0x9a6a1e,
    "Limpieza": 0x4a3fa8, "Pescados": 0x2f5f8a, "Congelados": 0x2f6a8a,
    "Refrigerio": 0xa8422a,
    "Equipos": 0x1f6f8a, "Insumos": 0x9a6a1e, "Accesorios": 0x4a4aa8,
    "Audio": 0x2f7a4a, "Protección": 0x8e2a3a
  };
  function acentoDe(cat, tinte) {
    if (ACENTO_CAT[cat]) return ACENTO_CAT[cat];
    // categoría desconocida: se oscurece el tinte del envase hasta que lea
    return mezclaNum(parseInt(String(tinte).slice(1), 16), 0x05070a, 0.45);
  }

  function tinteDe(cat) {
    if (TINTES[cat]) return TINTES[cat];
    const s = String(cat || "");
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return PALETA[h % PALETA.length];
  }
  // formato del envase: se infiere del nombre para que el dibujo cuadre
  function pictoDe(p) {
    const n = String((p && p.nombre) || "").toLowerCase();
    const c = String((p && p.categoria) || "").toLowerCase();
    // Catálogo de la tienda (equipos de punto de venta): el formato manda
    // menos que la familia, así que primero se decide por categoría.
    if (/audio|parlante|sonido/.test(c)) return "audio";
    if (/protecc|seguridad/.test(c)) return "candado";
    if (/equipo|terminal|pos\b/.test(c)) return "equipo";
    if (/insumo|etiqueta|papel/.test(c)) return "rollo";
    if (/accesorio|cargador|cable/.test(c)) return "cable";
    if (/leche|yogur|agua|jugo|kefir|bebible|té frío|te frio|bebida/.test(n)) return "botella";
    if (/helado|copa|paleta|sorbete|flan/.test(n)) return "tubo";
    if (/papa|choclo|coliflor|croissant|muffin|pan|brownie|empanad|galleta/.test(n)) return "bolsa";
    if (/café|cafe|arroz|azúcar|azucar|harina|aceite/.test(n)) return "lata";
    if (/pizza|lasaña|lasana|torta|caja/.test(n)) return "caja";
    return "caja";
  }

  // pictograma del formato, en color plano con un detalle en claro
  function pictograma(g, tipo, cx, cy, s, color) {
    const u = s / 100;
    g.save();
    g.translate(cx, cy);
    g.fillStyle = color;
    g.strokeStyle = color;
    g.lineJoin = "round";
    const claro = "rgba(255,255,255,.34)";
    if (tipo === "botella") {
      g.beginPath();
      g.moveTo(-13 * u, -50 * u); g.lineTo(13 * u, -50 * u); g.lineTo(13 * u, -24 * u);
      g.quadraticCurveTo(33 * u, -6 * u, 33 * u, 14 * u); g.lineTo(33 * u, 44 * u);
      g.quadraticCurveTo(33 * u, 51 * u, 25 * u, 51 * u); g.lineTo(-25 * u, 51 * u);
      g.quadraticCurveTo(-33 * u, 51 * u, -33 * u, 44 * u); g.lineTo(-33 * u, 14 * u);
      g.quadraticCurveTo(-33 * u, -6 * u, -13 * u, -24 * u);
      g.closePath(); g.fill();
      g.fillStyle = claro; g.fillRect(-22 * u, 4 * u, 44 * u, 18 * u);
      g.fillStyle = color; g.fillRect(-13 * u, -56 * u, 26 * u, 8 * u);
    } else if (tipo === "bolsa") {
      g.beginPath();
      g.moveTo(-30 * u, -40 * u); g.lineTo(30 * u, -40 * u);
      g.lineTo(38 * u, 46 * u); g.quadraticCurveTo(0, 54 * u, -38 * u, 46 * u);
      g.closePath(); g.fill();
      g.fillStyle = claro;
      g.fillRect(-30 * u, -26 * u, 60 * u, 6 * u);
      g.fillRect(-24 * u, -4 * u, 48 * u, 22 * u);
    } else if (tipo === "lata") {
      g.beginPath();
      g.ellipse(0, -38 * u, 26 * u, 9 * u, 0, 0, Math.PI * 2);
      g.rect(-26 * u, -38 * u, 52 * u, 82 * u);
      g.ellipse(0, 44 * u, 26 * u, 9 * u, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = claro; g.fillRect(-26 * u, -8 * u, 52 * u, 26 * u);
    } else if (tipo === "tubo") {
      g.beginPath();
      g.moveTo(-32 * u, -30 * u); g.lineTo(32 * u, -30 * u);
      g.lineTo(24 * u, 46 * u); g.quadraticCurveTo(0, 52 * u, -24 * u, 46 * u);
      g.closePath(); g.fill();
      g.fillStyle = color; g.fillRect(-36 * u, -42 * u, 72 * u, 14 * u);
      g.fillStyle = claro; g.fillRect(-26 * u, -6 * u, 52 * u, 24 * u);
    } else if (tipo === "pan") {
      g.beginPath();
      g.moveTo(-42 * u, 20 * u);
      g.quadraticCurveTo(-46 * u, -34 * u, 0, -38 * u);
      g.quadraticCurveTo(46 * u, -34 * u, 42 * u, 20 * u);
      g.quadraticCurveTo(0, 40 * u, -42 * u, 20 * u);
      g.closePath(); g.fill();
      g.strokeStyle = claro; g.lineWidth = 5 * u; g.lineCap = "round";
      [-20, 0, 20].forEach((dx) => {
        g.beginPath(); g.moveTo((dx - 7) * u, -22 * u); g.lineTo((dx + 7) * u, -4 * u); g.stroke();
      });
    } else if (tipo === "equipo") {
      // terminal con pantalla, cuello y base
      g.fillRect(-44 * u, -34 * u, 88 * u, 56 * u);
      g.fillStyle = claro;
      g.fillRect(-37 * u, -27 * u, 74 * u, 42 * u);
      g.fillStyle = color;
      g.fillRect(-8 * u, 22 * u, 16 * u, 12 * u);
      g.fillRect(-26 * u, 34 * u, 52 * u, 8 * u);
    } else if (tipo === "audio") {
      // parlante de estante: caja con dos conos
      g.fillRect(-32 * u, -48 * u, 64 * u, 96 * u);
      g.fillStyle = claro;
      g.beginPath(); g.arc(0, -20 * u, 15 * u, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(0, 20 * u, 22 * u, 0, Math.PI * 2); g.fill();
    } else if (tipo === "rollo") {
      // rollo de etiquetas visto de frente, con la tira saliendo
      g.beginPath(); g.arc(0, 0, 40 * u, 0, Math.PI * 2); g.fill();
      g.fillStyle = claro;
      g.beginPath(); g.arc(0, 0, 15 * u, 0, Math.PI * 2); g.fill();
      g.fillStyle = color;
      g.fillRect(26 * u, -9 * u, 22 * u, 18 * u);
      g.fillStyle = claro;
      g.fillRect(31 * u, -4 * u, 12 * u, 3 * u);
      g.fillRect(31 * u, 3 * u, 9 * u, 3 * u);
    } else if (tipo === "candado") {
      // candado de vitrina: arco, cuerpo y ojo de llave
      g.lineWidth = 10 * u; g.lineCap = "round";
      g.beginPath(); g.arc(0, -14 * u, 22 * u, Math.PI, 0); g.stroke();
      g.fillRect(-32 * u, -12 * u, 64 * u, 56 * u);
      g.fillStyle = claro;
      g.beginPath(); g.arc(0, 12 * u, 7 * u, 0, Math.PI * 2); g.fill();
      g.fillRect(-3 * u, 14 * u, 6 * u, 14 * u);
    } else if (tipo === "cable") {
      // cargador con patas y cable
      g.fillRect(-30 * u, -20 * u, 60 * u, 44 * u);
      g.fillStyle = claro;
      g.fillRect(-20 * u, -12 * u, 40 * u, 28 * u);
      g.fillStyle = color;
      g.fillRect(-18 * u, -34 * u, 8 * u, 14 * u);
      g.fillRect(10 * u, -34 * u, 8 * u, 14 * u);
      g.fillRect(-6 * u, 24 * u, 12 * u, 24 * u);
    } else { // caja
      g.fillRect(-40 * u, -34 * u, 80 * u, 74 * u);
      g.fillStyle = claro;
      g.fillRect(-40 * u, -6 * u, 80 * u, 8 * u);
      g.fillRect(-6 * u, -34 * u, 12 * u, 74 * u);
      g.fillStyle = "rgba(0,0,0,.25)";
      g.fillRect(-40 * u, -34 * u, 80 * u, 7 * u);
    }
    g.restore();
  }

  function envolver(g, texto, maxAncho, maxLineas) {
    const palabras = String(texto || "").split(/\s+/).filter(Boolean);
    const lineas = [];
    let actual = "";
    palabras.forEach((w) => {
      const prueba = actual ? actual + " " + w : w;
      if (g.measureText(prueba).width <= maxAncho || !actual) actual = prueba;
      else { lineas.push(actual); actual = w; }
    });
    if (actual) lineas.push(actual);
    return lineas.slice(0, maxLineas);
  }

  /* Dibuja la portada en cualquier contexto 2D (estantes, ficha, vuelo). */
  function dibuPortada(g, S, o) {
    const tinte = hex(o.tinte != null ? o.tinte : tinteDe(o.cat));
    const oscuro = mezcla(tinte, "#05070a", 0.74);
    const claro = mezcla(tinte, "#ffffff", 0.36);

    const grad = g.createLinearGradient(0, 0, S, S);
    grad.addColorStop(0, claro);
    grad.addColorStop(0.5, tinte);
    grad.addColorStop(1, oscuro);
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);

    // destello diagonal: se lee como plástico del envase
    g.save();
    g.globalAlpha = 0.13;
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.moveTo(0, S * 0.66); g.lineTo(S, S * 0.30); g.lineTo(S, S * 0.44); g.lineTo(0, S * 0.80);
    g.closePath(); g.fill();
    g.restore();

    // banda de marca arriba (la F no se toca: va el wordmark en texto)
    const barra = Math.round(S * 0.15);
    g.fillStyle = "#0a0c0e";
    g.fillRect(0, 0, S, barra);
    g.fillStyle = tinte;
    g.fillRect(0, barra - Math.max(2, Math.round(S * 0.014)), S, Math.max(2, Math.round(S * 0.014)));
    g.textAlign = "left"; g.textBaseline = "middle";
    g.fillStyle = "#ffffff";
    g.font = "800 " + Math.round(S * 0.06) + "px -apple-system, Segoe UI, Roboto, sans-serif";
    g.fillText("CORE STOCK", S * 0.05, barra * 0.5);
    g.fillStyle = tinte;
    g.fillRect(S * 0.84, barra * 0.32, S * 0.11, barra * 0.36);

    // pictograma sobre un disco
    const cy = S * 0.44;
    g.save();
    g.globalAlpha = 0.16;
    g.fillStyle = "#05070a";
    g.beginPath();
    g.arc(S * 0.5, cy, S * 0.3, 0, Math.PI * 2);
    g.fill();
    g.restore();
    pictograma(g, o.picto || "caja", S * 0.5, cy, S * 0.44, "#0a0c0e");

    // placa inferior: categoría en lima y debajo el nombre del producto
    const placaH = S * 0.34;
    const pg = g.createLinearGradient(0, S - placaH, 0, S);
    pg.addColorStop(0, "rgba(5,7,10,0)");
    pg.addColorStop(0.35, "rgba(5,7,10,.88)");
    pg.addColorStop(1, "rgba(5,7,10,.97)");
    g.fillStyle = pg;
    g.fillRect(0, S - placaH, S, placaH);

    g.textAlign = "left"; g.textBaseline = "alphabetic";
    let y = S - placaH + S * 0.085;
    if (o.cat) {
      g.fillStyle = tinte;
      g.font = "800 " + Math.round(S * 0.052) + "px -apple-system, Segoe UI, Roboto, sans-serif";
      g.fillText(String(o.cat).toUpperCase().slice(0, 24), S * 0.06, y);
      y += S * 0.05;
    }
    const titulo = String(o.texto || o.nombre || "");
    if (titulo) {
      let fs = Math.round(S * 0.095);
      let lineas;
      do {
        g.font = "900 " + fs + "px -apple-system, Segoe UI, Roboto, sans-serif";
        lineas = envolver(g, titulo, S * 0.88, 2);
        if (lineas.length < 2 || fs <= Math.round(S * 0.068)) break;
        fs -= Math.max(1, Math.round(S * 0.007));
      } while (fs > Math.round(S * 0.06));
      g.fillStyle = "#ffffff";
      const pasoLinea = fs * 1.04;
      const yBase = y + fs * 0.86;
      lineas.forEach((l, i) => g.fillText(l, S * 0.06, yBase + i * pasoLinea));
    }
  }

  function anisoMax() {
    if (renderer && renderer.capabilities) {
      return Math.min(8, renderer.capabilities.getMaxAnisotropy());
    }
    return 4;
  }

  function texturaPortada(o) {
    const S = (o && o.S) || 256;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d");
    dibuPortada(g, S, o || {});
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    t.anisotropy = anisoMax();
    return t;
  }

  /* ── productos: geometría real por familia ───────────────────────────────
     Cada familia tiene su silueta (botella torneada, lata con rebordes, caja
     de cartón con esquinas suaves, bolsa blanda con pliegues, frasco, vaso).
     La etiqueta va en una malla aparte para que el texto quede derecho y
     mirando al pasillo: antes la misma portada se pegaba en las 6 caras de
     una caja y la cara del pasillo la mostraba girada y espejada. */
  const GEO_FORMA = {};
  const GEO_ETIQUETA = {};

  const TAMANO = {
    botella: { ancho: 0.086, alto: 0.30, fondo: 0.086, fondoGeo: 1.00 },
    vidrio:  { ancho: 0.078, alto: 0.31, fondo: 0.078, fondoGeo: 1.00 },
    lata:    { ancho: 0.066, alto: 0.12, fondo: 0.066, fondoGeo: 1.00 },
    frasco:  { ancho: 0.082, alto: 0.14, fondo: 0.082, fondoGeo: 1.00 },
    yogur:   { ancho: 0.076, alto: 0.11, fondo: 0.076, fondoGeo: 1.00 },
    tetra:   { ancho: 0.095, alto: 0.25, fondo: 0.065, fondoGeo: 0.55 },
    caja:    { ancho: 0.170, alto: 0.26, fondo: 0.070, fondoGeo: 0.70 },
    bolsa:   { ancho: 0.160, alto: 0.27, fondo: 0.090, fondoGeo: 0.46 }
  };

  /* El nombre manda: un súper no tiene 15 cajas iguales. */
  function formaDe(p) {
    const n = String((p && p.nombre) || "").toLowerCase();
    if (/atún|atun|conserva|sardina|cerveza lata|lata de|bebida lata/.test(n)) return "lata";
    if (/vino|cerveza|mermelada|salsa/.test(n)) return "vidrio";
    if (/leche|jugo|néctar|nectar|té frío|te frio|bebida vegetal/.test(n)) return "tetra";
    if (/aceite|bebida|agua|detergente|cloro|limpiador|shampoo|suavizante/.test(n)) return "botella";
    if (/café|cafe|miel|té en|te en|saquitos/.test(n)) return "frasco";
    if (/yogur|helado|flan|postre|crema/.test(n)) return "yogur";
    if (/arroz|harina|azúcar|azucar|sal\b|lentejas|porotos|fideos|pasta|pan de molde|galleta|papas fritas|snack|legumbre/.test(n)) return "bolsa";
    return "caja";
  }

  function redondeado(w, h, r) {
    const sh = new T.Shape();
    const x = -w / 2, y = -h / 2;
    sh.moveTo(x + r, y);
    sh.lineTo(x + w - r, y);
    sh.quadraticCurveTo(x + w, y, x + w, y + r);
    sh.lineTo(x + w, y + h - r);
    sh.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    sh.lineTo(x + r, y + h);
    sh.quadraticCurveTo(x, y + h, x, y + h - r);
    sh.lineTo(x, y + r);
    sh.quadraticCurveTo(x, y, x + r, y);
    return sh;
  }

  function torno(pts, seg) {
    const v = pts.map((q) => new T.Vector2(q[0], q[1]));
    const g = new T.LatheGeometry(v, seg || 24);
    g.translate(0, -0.5, 0);          // centrada en Y: la matriz escala desde el centro
    return g;
  }

  function geoForma(forma) {
    if (GEO_FORMA[forma]) return GEO_FORMA[forma];
    let g;
    if (forma === "botella") {
      g = torno([
        [0.00, 0.00], [0.38, 0.00], [0.47, 0.03], [0.50, 0.10], [0.50, 0.55],
        [0.47, 0.61], [0.39, 0.68], [0.26, 0.76], [0.19, 0.82], [0.18, 0.86],
        [0.21, 0.885], [0.18, 0.91], [0.18, 0.97], [0.20, 1.00], [0.00, 1.00]
      ], 24);
    } else if (forma === "vidrio") {
      g = torno([
        [0.00, 0.00], [0.40, 0.00], [0.47, 0.04], [0.50, 0.10], [0.50, 0.54],
        [0.46, 0.61], [0.30, 0.70], [0.16, 0.79], [0.13, 0.86], [0.15, 0.90],
        [0.13, 0.94], [0.13, 1.00], [0.00, 1.00]
      ], 24);
    } else if (forma === "lata") {
      g = torno([
        [0.00, 0.00], [0.40, 0.00], [0.46, 0.02], [0.50, 0.05], [0.50, 0.95],
        [0.46, 0.98], [0.40, 1.00], [0.00, 1.00]
      ], 24);
    } else if (forma === "frasco") {
      g = torno([
        [0.00, 0.00], [0.42, 0.00], [0.50, 0.04], [0.50, 0.60], [0.46, 0.67],
        [0.34, 0.73], [0.30, 0.79], [0.32, 0.83], [0.30, 0.87], [0.30, 1.00],
        [0.00, 1.00]
      ], 22);
    } else if (forma === "yogur") {
      g = torno([
        [0.00, 0.00], [0.30, 0.00], [0.34, 0.03], [0.44, 0.70], [0.50, 0.88],
        [0.53, 0.93], [0.48, 1.00], [0.00, 1.00]
      ], 22);
    } else if (forma === "tetra") {
      const sh = new T.Shape();
      sh.moveTo(-0.5, -0.5); sh.lineTo(0.5, -0.5); sh.lineTo(0.5, 0.28);
      sh.lineTo(0.0, 0.5); sh.lineTo(-0.5, 0.28); sh.closePath();
      g = new T.ExtrudeGeometry(sh, {
        depth: 0.55, bevelEnabled: true, bevelSize: 0.015,
        bevelThickness: 0.015, bevelSegments: 2, curveSegments: 4
      });
      g.translate(0, 0, -0.275);
    } else if (forma === "bolsa") {
      g = new T.ExtrudeGeometry(redondeado(0.94, 0.98, 0.10), {
        depth: 0.46, bevelEnabled: true, bevelSize: 0.06,
        bevelThickness: 0.06, bevelSegments: 3, curveSegments: 6
      });
      g.translate(0, 0, -0.23);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const onda = Math.sin(y * 9 + x * 5) * 0.012 + Math.sin(x * 13) * 0.008;
        pos.setZ(i, z + (z > 0 ? onda : -onda));
      }
      g.computeVertexNormals();
    } else {
      g = new T.ExtrudeGeometry(redondeado(0.96, 0.96, 0.06), {
        depth: 0.70, bevelEnabled: true, bevelSize: 0.018,
        bevelThickness: 0.018, bevelSegments: 2, curveSegments: 4
      });
      g.translate(0, 0, -0.35);
    }
    GEO_FORMA[forma] = g;
    return g;
  }

  /* Etiqueta: banda curva en envases redondos, plano en cajas y bolsas.
     Va en +Z para que al girar el envase hacia el pasillo el texto quede
     derecho (no espejado ni girado 90°). */
  function geoEtiqueta(forma) {
    if (GEO_ETIQUETA[forma]) return GEO_ETIQUETA[forma];
    const arco = 2.35;
    let g;
    if (forma === "botella" || forma === "vidrio" || forma === "lata" || forma === "frasco") {
      const cfg = {
        botella: [0.42, -0.055], vidrio: [0.38, -0.075],
        lata: [0.72, 0.00], frasco: [0.56, -0.015]
      }[forma];
      g = new T.CylinderGeometry(0.515, 0.515, cfg[0], 26, 1, true, -arco / 2, arco);
      g.translate(0, cfg[1], 0);
    } else if (forma === "tetra") {
      g = new T.PlaneGeometry(0.90, 0.70);
      g.translate(0, -0.06, 0);
    } else if (forma === "bolsa") {
      g = new T.PlaneGeometry(0.86, 0.86);
    } else if (forma === "yogur") {
      g = new T.PlaneGeometry(0.82, 0.62);
      g.translate(0, 0.02, 0);
    } else {
      g = new T.PlaneGeometry(0.94, 0.94);
    }
    GEO_ETIQUETA[forma] = g;
    return g;
  }

  function mezclaNum(a, b, k) {
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    return (Math.round(ar + (br - ar) * k) << 16) |
      (Math.round(ag + (bg - ag) * k) << 8) |
      Math.round(ab + (bb - ab) * k);
  }

  /* Color propio por producto: la categoría da la familia y el nombre
     desplaza el tono, así dos productos de la misma góndola no salen
     idénticos. */
  function colorDe(p) {
    const t = p && p.tinte;
    if (typeof t === "string" && /^#[0-9a-f]{6}$/i.test(t)) return t.toLowerCase();
    if (typeof t === "number") return hex(t);
    const s = String((p && p.nombre) || "");
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 37 + s.charCodeAt(i)) >>> 0;
    const n = s.toLowerCase();
    for (let i = 0; i < TINTES_NOMBRE.length; i++) {
      if (TINTES_NOMBRE[i][0].test(n)) return hex(TINTES_NOMBRE[i][1]);
    }
    const lista = TINTES_CAT[p && p.categoria];
    if (lista) {
      /* ±7 % de valor: dos leches se distinguen sin salirse del pasillo */
      const v = 0.93 + ((h >>> 7) % 15) / 100;
      return hex(mezclaNum(lista[h % lista.length], v < 1 ? 0x000000 : 0xffffff, Math.abs(1 - v) * 0.9));
    }
    const base = tinteDe(p && p.categoria);
    return hex(mezclaNum(base, PALETA[h % PALETA.length], 0.42));
  }

  /* Marcas de la casa: se reparten por hash del nombre, así dos productos
     distintos no comparten etiqueta y se lee como un súper real. */
  const MARCAS = [
    "ANDINA", "CUMBRE", "TRÉBOL", "COSTA", "AURORA",
    "DEL VALLE", "NORTE", "SOLAR", "PRADERA", "VOLCÁN"
  ];
  function marcaDe(p) {
    const s = String((p && p.nombre) || "");
    let h = 7;
    for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
    return MARCAS[h % MARCAS.length];
  }
  const FAMILIA_TXT = {
    botella: "BOTELLA", vidrio: "VIDRIO", lata: "LATA", frasco: "FRASCO",
    yogur: "POTE", tetra: "TETRA", caja: "CAJA", bolsa: "BOLSA"
  };
  const FAMILIA_PICTO = {
    botella: "botella", vidrio: "botella", lata: "lata", frasco: "tubo",
    yogur: "tubo", tetra: "caja", caja: "caja", bolsa: "bolsa"
  };

  function luminancia(c) {
    const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  /* Entorno precalculado (PMREM) con el techo y las paredes del local: es
     lo que hace que una lata o una botella devuelvan un reflejo creíble en
     vez de un plano muerto. Se genera una sola vez por renderer. */
  let entornoMap = null;

  function matForma(forma, p, sinColor) {
    const t = sinColor ? "#ffffff" : colorDe(p);
    /* En calidad baja se ahorra el muestreo del entorno (es lo caro por
       fragmento); el resto de los equipos ven el reflejo, que es lo que
       convierte una caja de cartón en un envase de súper. */
    const conEnv = (m, fuerza) => {
      if (entornoMap && perfil !== "baja") {
        m.envMap = entornoMap;
        m.envMapIntensity = 0.4 + fuerza;
        m.reflectivity = fuerza;
        m.combine = T.MixOperation;
      }
      return m;
    };
    if (forma === "vidrio") {
      const m = new T.MeshStandardMaterial({
        color: new T.Color(t).multiplyScalar(0.55), roughness: 0.12,
        metalness: 0.05, transparent: true, opacity: 0.88
      });
      if (entornoMap) { m.envMap = entornoMap; m.envMapIntensity = 1.15; }
      return m;
    }
    if (forma === "lata") {
      return conEnv(new T.MeshPhongMaterial({
        color: 0xc9ced3, specular: 0xffffff, shininess: 165
      }), 0.92);
    }
    if (forma === "botella") {
      return conEnv(new T.MeshPhongMaterial({
        color: 0xeaf4fb, specular: 0xffffff, shininess: 128,
        transparent: true, opacity: 0.94
      }), 0.72);
    }
    if (forma === "frasco") {
      return conEnv(new T.MeshPhongMaterial({
        color: t, specular: 0xffffff, shininess: 140,
        transparent: true, opacity: 0.9
      }), 0.66);
    }
    if (forma === "yogur") {
      return conEnv(new T.MeshPhongMaterial({
        color: 0xf7f7f3, specular: 0xffffff, shininess: 86
      }), 0.42);
    }
    /* Bolsa y caja: film de polietileno y cartulina plastificada. El
       specular tenue y el entorno son el "lacado" que faltaba. */
    if (forma === "bolsa") {
      return conEnv(new T.MeshPhongMaterial({
        color: t, specular: 0xdfe6ec, shininess: 74
      }), 0.5);
    }
    /* Phong también en calidad baja: el costo sobre Lambert es pequeño y
       sin especular el producto vuelve a verse "de cartón". Lo que se ahorra
       en baja es el muestreo del entorno, no el brillo. */
    return conEnv(new T.MeshPhongMaterial({
      color: t, specular: perfil === "baja" ? 0x8f979e : 0xaab2ba,
      shininess: perfil === "baja" ? 42 : 52
    }), 0.38);
  }

  /* Sala mínima para el PMREM: techo luminoso, pared cálida, pared fría y
     piso oscuro. Cuesta una sola pasada al abrir; después todos los
     materiales reflectantes leen la misma textura. */
  function crearEntorno() {
    if (!T || !renderer || entornoMap) return;
    try {
      const pm = new T.PMREMGenerator(renderer);
      pm.compileCubemapShader();
      const sala = new T.Scene();
      const cara = (w, h, color, x, y, z, rx, ry) => {
        const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: color }));
        m.position.set(x, y, z);
        if (rx) m.rotation.x = rx;
        if (ry) m.rotation.y = ry;
        sala.add(m);
      };
      cara(26, 26, 0x2a2d31, 0, -5.9, 0, -Math.PI / 2, 0);   // piso
      cara(10, 16, 0xfff6e2, 0, 5.85, 0, Math.PI / 2, 0);    // techo encendido
      cara(18, 6, 0xffd9a8, -11.8, 0.6, 0, 0, Math.PI / 2);  // pared cálida
      cara(18, 6, 0xbcd6ff, 11.8, 0.6, 0, 0, -Math.PI / 2);  // pared fría
      cara(26, 12, 0x555b62, 0, 0.6, -11.8, 0, 0);           // fondo
      cara(26, 12, 0x4a5058, 0, 0.6, 11.8, 0, Math.PI);      // frente
      /* Franjas emisivas en el techo: al reflejarse en un envase se ven como
         una raya blanca. Sin ellas el reflejo es una mancha pareja y el
         producto se ve mate, por más que el material tenga brillo. */
      [-6.4, -2.2, 2.2, 6.4].forEach((x) => {
        cara(0.9, 19, 0xffffff, x, 5.78, 0, Math.PI / 2, 0);
      });
      cara(22, 1.1, 0xffd9a8, 0, 4.4, -11.6, 0, 0);          // vitrina cálida
      cara(22, 1.1, 0xbfd8ff, 0, 4.4, 11.6, 0, Math.PI);     // vitrina fría
      // menos desenfoque: las franjas tienen que sobrevivir al PMREM
      const rt = pm.fromScene(sala, 0.012);
      entornoMap = rt.texture;
      pm.dispose();
      sala.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    } catch (e) { entornoMap = null; }
  }

  /* Etiqueta de envase: banda de marca, panel de papel con el nombre,
     presentación y código de barras simulado. Nada de una portada cuadrada
     repetida en todas las caras. */
  /* ── ilustración de portada ──────────────────────────────────────────────
     Cada categoría tiene su dibujo vectorial, hecho aquí con paths: no se
     descarga ni se copia ninguna imagen, así que no hay licencia de terceros
     y se adapta a cualquier tamaño (256 px en el estante, 384 en la ficha).
     El dibujo se hace en un espacio normalizado 0..1 y se escala al recuadro,
     por eso nunca se deforma ni se sale del papel. */
  function arteDe(g, tipo, ax, ay, aw, ah, col, osc, cla, tinta) {
    g.save();
    /* Recuadro centrado y de lado igual: si se escalara por ancho y alto por
       separado, un círculo salía ovalado (el recuadro es 1,8:1). El dibujo se
       hace en un cuadrado y se centra en el recuadro. */
    const lado = Math.min(aw, ah);
    g.beginPath();
    g.rect(ax, ay, aw, ah);
    g.clip();
    g.translate(ax + (aw - lado) / 2, ay + (ah - lado) / 2);
    g.scale(lado, lado);
    const circ = (x, y, r, color) => { g.fillStyle = color; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
    const poly = (pts, color) => {
      g.fillStyle = color;
      g.beginPath();
      pts.forEach((q, k) => (k ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])));
      g.closePath();
      g.fill();
    };
    const caja = (x, y, w, h, r, color) => {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(x + r, y);
      g.lineTo(x + w - r, y);
      g.quadraticCurveTo(x + w, y, x + w, y + r);
      g.lineTo(x + w, y + h - r);
      g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      g.lineTo(x + r, y + h);
      g.quadraticCurveTo(x, y + h, x, y + h - r);
      g.lineTo(x, y + r);
      g.quadraticCurveTo(x, y, x + r, y);
      g.fill();
    };
    const barra = (cx, cy, len, gros, ang, color) => {
      const dx = (Math.cos(ang) * len) / 2, dy = (Math.sin(ang) * len) / 2;
      const nx = (-Math.sin(ang) * gros) / 2, ny = (Math.cos(ang) * gros) / 2;
      poly([[cx - dx + nx, cy - dy + ny], [cx + dx + nx, cy + dy + ny],
            [cx + dx - nx, cy + dy - ny], [cx - dx + nx, cy - dy - ny]], color);
    };
    const elipse = (x, y, rx, ry, rot, color) => {
      g.fillStyle = color;
      g.beginPath();
      g.ellipse(x, y, rx, ry, rot || 0, 0, Math.PI * 2);
      g.fill();
    };

    if (tipo === "lacteos") {
      // caja de leche: cuerpo, techo a dos aguas, tapón, etiqueta y gota
      poly([[0.28, 0.36], [0.72, 0.36], [0.72, 0.90], [0.28, 0.90]], col);
      poly([[0.28, 0.36], [0.72, 0.36], [0.72, 0.52], [0.28, 0.52]], osc);
      poly([[0.24, 0.36], [0.5, 0.12], [0.76, 0.36]], cla);
      caja(0.43, 0.04, 0.14, 0.09, 0.02, tinta);
      caja(0.32, 0.58, 0.36, 0.18, 0.02, "#ffffff");
      barra(0.5, 0.64, 0.28, 0.022, 0, col);
      barra(0.5, 0.69, 0.20, 0.016, 0, osc);
      circ(0.82, 0.78, 0.055, cla);
      poly([[0.82, 0.72], [0.86, 0.78], [0.78, 0.78]], cla);
    } else if (tipo === "panaderia") {
      // hogaza con cortes y una segunda pieza detrás
      elipse(0.40, 0.62, 0.24, 0.17, 0, osc);
      elipse(0.52, 0.56, 0.30, 0.22, 0, col);
      elipse(0.40, 0.44, 0.14, 0.08, -0.4, cla);
      [-0.13, 0, 0.13].forEach((dx) => barra(0.52 + dx, 0.56, 0.14, 0.035, 1.15, tinta));
    } else if (tipo === "carnes") {
      // bistec: grasa exterior, carne y veta
      poly([[0.22, 0.52], [0.32, 0.30], [0.60, 0.24], [0.80, 0.40],
            [0.74, 0.70], [0.50, 0.82], [0.28, 0.72]], cla);
      poly([[0.27, 0.53], [0.35, 0.36], [0.59, 0.31], [0.74, 0.44],
            [0.69, 0.67], [0.50, 0.76], [0.32, 0.68]], col);
      g.strokeStyle = cla; g.lineWidth = 0.030; g.lineCap = "round";
      g.beginPath(); g.moveTo(0.36, 0.58); g.quadraticCurveTo(0.52, 0.46, 0.68, 0.56); g.stroke();
      g.beginPath(); g.moveTo(0.40, 0.66); g.quadraticCurveTo(0.52, 0.60, 0.62, 0.66); g.stroke();
    } else if (tipo === "frutas") {
      // manzana: cuerpo, brillo, hoja y rabito
      elipse(0.46, 0.60, 0.25, 0.23, 0, col);
      elipse(0.60, 0.60, 0.20, 0.20, 0, col);
      elipse(0.42, 0.50, 0.09, 0.05, -0.5, cla);
      barra(0.51, 0.30, 0.14, 0.025, 1.5, tinta);
      elipse(0.63, 0.30, 0.12, 0.06, -0.45, osc);
    } else if (tipo === "bebidas") {
      // botella con etiqueta y burbujas
      poly([[0.40, 0.14], [0.60, 0.14], [0.60, 0.32], [0.68, 0.42], [0.68, 0.88],
            [0.32, 0.88], [0.32, 0.42], [0.40, 0.32]], col);
      poly([[0.32, 0.52], [0.68, 0.52], [0.68, 0.66], [0.32, 0.66]], "#ffffff");
      barra(0.5, 0.59, 0.24, 0.022, 0, osc);
      caja(0.40, 0.06, 0.20, 0.09, 0.02, tinta);
      circ(0.78, 0.30, 0.032, "#ffffff");
      circ(0.85, 0.42, 0.022, "#ffffff");
      circ(0.76, 0.55, 0.018, "#ffffff");
    } else if (tipo === "abarrotes") {
      // saco de granos con ventana
      poly([[0.28, 0.34], [0.72, 0.34], [0.80, 0.88], [0.20, 0.88]], col);
      poly([[0.28, 0.34], [0.72, 0.34], [0.70, 0.26], [0.30, 0.26]], osc);
      caja(0.34, 0.50, 0.32, 0.22, 0.03, "#ffffff");
      circ(0.44, 0.58, 0.045, osc);
      circ(0.53, 0.63, 0.035, col);
      circ(0.60, 0.57, 0.030, osc);
    } else if (tipo === "limpieza") {
      // pulverizador: cuerpo, cuello, gatillo y rocío
      caja(0.30, 0.44, 0.28, 0.46, 0.04, col);
      caja(0.38, 0.34, 0.22, 0.12, 0.02, osc);
      poly([[0.60, 0.34], [0.84, 0.26], [0.84, 0.38], [0.60, 0.44]], col);
      caja(0.34, 0.56, 0.20, 0.20, 0.02, "#ffffff");
      barra(0.44, 0.66, 0.16, 0.020, 0, osc);
      circ(0.90, 0.20, 0.020, cla);
      circ(0.95, 0.30, 0.015, cla);
      circ(0.86, 0.12, 0.013, cla);
    } else if (tipo === "pescados") {
      // pez con cola, aleta y vientre
      elipse(0.48, 0.56, 0.26, 0.16, 0, col);
      poly([[0.72, 0.56], [0.90, 0.38], [0.90, 0.74]], osc);
      poly([[0.46, 0.40], [0.58, 0.44], [0.46, 0.50]], osc);
      elipse(0.46, 0.62, 0.18, 0.06, 0.1, cla);
      circ(0.31, 0.50, 0.022, tinta);
    } else if (tipo === "congelados") {
      // copo de nieve: tres ejes y seis ramas cortas
      barra(0.5, 0.54, 0.56, 0.030, 0, col);
      barra(0.5, 0.54, 0.56, 0.030, Math.PI / 3, col);
      barra(0.5, 0.54, 0.56, 0.030, -Math.PI / 3, col);
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3;
        const bx = 0.5 + Math.cos(a) * 0.18, by = 0.54 + Math.sin(a) * 0.18;
        barra(bx, by, 0.13, 0.024, a + 0.9, cla);
        barra(bx, by, 0.13, 0.024, a - 0.9, cla);
      }
      circ(0.5, 0.54, 0.045, osc);
    } else if (tipo === "refrigerio") {
      // bolsa de snack con borde dentado y ventana
      poly([[0.30, 0.30], [0.34, 0.24], [0.38, 0.30], [0.42, 0.24], [0.46, 0.30],
            [0.50, 0.24], [0.54, 0.30], [0.58, 0.24], [0.62, 0.30], [0.66, 0.24],
            [0.70, 0.30], [0.70, 0.90], [0.30, 0.90]], col);
      elipse(0.50, 0.64, 0.19, 0.15, 0, "#ffffff");
      poly([[0.36, 0.66], [0.46, 0.54], [0.52, 0.66]], osc);
      poly([[0.52, 0.68], [0.62, 0.56], [0.68, 0.68]], osc);
      barra(0.5, 0.38, 0.30, 0.020, 0, tinta);
    } else if (tipo === "equipos") {
      // terminal de venta: cuerpo, pantalla y teclas
      caja(0.20, 0.34, 0.60, 0.40, 0.035, col);
      caja(0.26, 0.40, 0.48, 0.16, 0.02, "#ffffff");
      barra(0.5, 0.24, 0.34, 0.020, 0, osc);
      barra(0.5, 0.30, 0.26, 0.016, 0, osc);
      caja(0.28, 0.74, 0.12, 0.028, 0.012, osc);
      circ(0.40, 0.80, 0.022, cla);
      circ(0.50, 0.80, 0.022, cla);
      circ(0.60, 0.80, 0.022, cla);
    } else if (tipo === "insumos") {
      // rollo de papel térmico con su tira
      caja(0.30, 0.30, 0.40, 0.40, 0.02, col);
      elipse(0.50, 0.30, 0.20, 0.06, 0, osc);
      elipse(0.50, 0.70, 0.20, 0.06, 0, osc);
      caja(0.30, 0.62, 0.40, 0.16, 0.01, "#ffffff");
      poly([[0.62, 0.70], [0.86, 0.78], [0.86, 0.90], [0.62, 0.82]], cla);
    } else if (tipo === "accesorios") {
      // cargador con cable
      caja(0.22, 0.36, 0.40, 0.26, 0.03, col);
      caja(0.30, 0.40, 0.24, 0.22, 0.02, "#ffffff");
      barra(0.50, 0.44, 0.16, 0.020, 0, osc);
      g.strokeStyle = cla; g.lineWidth = 0.045; g.lineCap = "round";
      g.beginPath();
      g.moveTo(0.62, 0.46);
      g.quadraticCurveTo(0.86, 0.56, 0.80, 0.76);
      g.stroke();
      caja(0.76, 0.76, 0.12, 0.05, 0.01, tinta);
    } else if (tipo === "audio") {
      // parlante con rejilla
      caja(0.24, 0.26, 0.52, 0.50, 0.03, col);
      circ(0.50, 0.60, 0.14, osc);
      circ(0.50, 0.60, 0.10, "#ffffff");
      circ(0.50, 0.60, 0.035, col);
      circ(0.50, 0.36, 0.045, "#ffffff");
      for (let k = 0; k < 3; k++) barra(0.5, 0.82 - k * 0.05, 0.34, 0.012, 0, cla);
    } else if (tipo === "camara") {
      // domo / bala: cuerpo, lente y brazo
      caja(0.24, 0.34, 0.44, 0.28, 0.06, col);
      circ(0.61, 0.51, 0.12, osc);
      circ(0.63, 0.51, 0.085, "#ffffff");
      circ(0.65, 0.51, 0.045, tinta);
      caja(0.42, 0.44, 0.16, 0.10, 0.02, cla);
      barra(0.30, 0.72, 0.10, 0.10, 0, osc);
      caja(0.24, 0.76, 0.22, 0.04, 0.01, cla);
    } else if (tipo === "proteccion") {
      // escudo con candado
      poly([[0.50, 0.14], [0.80, 0.28], [0.78, 0.58], [0.50, 0.84], [0.22, 0.58], [0.20, 0.28]], col);
      poly([[0.50, 0.22], [0.73, 0.33], [0.71, 0.56], [0.50, 0.76], [0.29, 0.56], [0.27, 0.33]], "#ffffff");
      caja(0.40, 0.44, 0.20, 0.14, 0.02, osc);
      g.strokeStyle = osc; g.lineWidth = 0.045; g.lineCap = "round";
      g.beginPath();
      g.arc(0.50, 0.44, 0.075, Math.PI, Math.PI * 2);
      g.stroke();
    } else {
      // lata genérica
      caja(0.34, 0.26, 0.32, 0.60, 0.03, col);
      elipse(0.5, 0.26, 0.16, 0.05, 0, osc);
      caja(0.34, 0.44, 0.32, 0.16, 0, "#ffffff");
      barra(0.5, 0.50, 0.22, 0.022, 0, osc);
      barra(0.44, 0.34, 0.36, 0.022, 1.5, cla);
    }
    g.restore();
  }

  /* Algunos nombres piden un dibujo propio dentro de la misma categoría:
     una cámara IP no se parece a una báscula aunque las dos sean «Equipos». */
  const ARTE_NOMBRE = [
    [/c[aá]mara|domo|cctv|vigila/i, "camara"],
    [/cargador|fuente|adaptador/i, "accesorios"],
    [/papel|rollo|t[eé]rmico/i, "insumos"],
    [/altavoz|parlante|audio/i, "audio"]
  ];
  function arteTipoDe(cat, nombre) {
    const n = String(nombre || "");
    for (let i = 0; i < ARTE_NOMBRE.length; i++) {
      if (ARTE_NOMBRE[i][0].test(n)) return ARTE_NOMBRE[i][1];
    }
    return ARTE_CAT[cat] || "otros";
  }

  const ARTE_CAT = {
    "Lácteos": "lacteos", "Panadería": "panaderia", "Carnes": "carnes",
    "Frutas y verduras": "frutas", "Bebidas": "bebidas", "Abarrotes": "abarrotes",
    "Limpieza": "limpieza", "Pescados": "pescados",
    "Congelados": "congelados", "Refrigerio": "refrigerio",
    "Lácteos y huevos": "lacteos",
    "Equipos": "equipos", "Insumos": "insumos", "Accesorios": "accesorios",
    "Audio": "audio", "Protección": "proteccion"
  };

  /* Portada del envase: color de categoría, ilustración, nombre, formato y
     código. Reemplaza la etiqueta de sólo texto: es lo que hace que dos
     productos del mismo estante se distingan de un vistazo. */
  function dibuEtiqueta(g, W, H, o) {
    const tinte = o.tinte || "#8a8f94";
    const oscuro = mezcla(tinte, "#05070a", 0.72);
    const claro = mezcla(tinte, "#ffffff", 0.55);
    const oscura = luminancia(tinte) < 0.62;
    const tinta = oscura ? "#f4f6f7" : "#111417";

    /* fondo del envase: degradado del tinte + brillo radial arriba */
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, claro);
    grad.addColorStop(0.52, tinte);
    grad.addColorStop(1, oscuro);
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    const halo = g.createRadialGradient(W * 0.34, H * 0.16, 0, W * 0.34, H * 0.16, W * 0.85);
    halo.addColorStop(0, "rgba(255,255,255,.30)");
    halo.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = halo;
    g.fillRect(0, 0, W, H);

    /* franja de lacado en diagonal: el film del envase */
    g.save();
    g.globalAlpha = oscura ? 0.16 : 0.20;
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.moveTo(0, H * 0.30);
    g.lineTo(W, H * 0.14);
    g.lineTo(W, H * 0.30);
    g.lineTo(0, H * 0.46);
    g.closePath();
    g.fill();
    g.restore();

    /* banda de marca */
    const bh = Math.round(H * 0.115);
    g.fillStyle = "rgba(6,8,10,.92)";
    g.fillRect(0, 0, W, bh);
    g.fillStyle = tinte;
    g.fillRect(0, bh - Math.max(2, Math.round(H * 0.009)), W, Math.max(2, Math.round(H * 0.009)));

    const marca = String(o.marca || "CORE STOCK");
    const familia = FAMILIA_TXT[o.forma] || "PRODUCTO";
    g.textBaseline = "middle";
    g.textAlign = "left";
    g.fillStyle = "#ffffff";
    let fm = Math.round(bh * 0.44);
    g.font = "800 " + fm + "px -apple-system, Segoe UI, Roboto, sans-serif";
    while (fm > 7 && g.measureText(marca).width > W * 0.58) {
      fm -= 1;
      g.font = "800 " + fm + "px -apple-system, Segoe UI, Roboto, sans-serif";
    }
    g.fillText(marca, W * 0.055, bh * 0.52);
    g.textAlign = "right";
    g.fillStyle = tinte;
    g.font = "800 " + Math.round(bh * 0.28) + "px -apple-system, Segoe UI, Roboto, sans-serif";
    g.fillText(familia, W * 0.945, bh * 0.53);

    /* papel de la carátula */
    const px0 = W * 0.045, pw = W * 0.91;
    const py = H * 0.135, ph = H * 0.645;
    const rad = Math.round(H * 0.028);
    g.fillStyle = "rgba(250,248,241,.97)";
    g.beginPath();
    g.moveTo(px0 + rad, py);
    g.lineTo(px0 + pw - rad, py);
    g.quadraticCurveTo(px0 + pw, py, px0 + pw, py + rad);
    g.lineTo(px0 + pw, py + ph - rad);
    g.quadraticCurveTo(px0 + pw, py + ph, px0 + pw - rad, py + ph);
    g.lineTo(px0 + rad, py + ph);
    g.quadraticCurveTo(px0, py + ph, px0, py + ph - rad);
    g.lineTo(px0, py + rad);
    g.quadraticCurveTo(px0, py, px0 + rad, py);
    g.fill();
    g.fillStyle = tinte;
    g.fillRect(px0, py, pw, Math.max(2, Math.round(H * 0.010)));

    /* recuadro de la ilustración */
    const ax = px0 + pw * 0.055, ay = py + H * 0.022;
    const aw = pw * 0.89, ah = H * 0.30;
    const acHex = hex(acentoDe(o.categoria, tinte));
    const acOsc = mezcla(acHex, "#05070a", 0.55);
    const acCla = mezcla(acHex, "#ffffff", 0.38);
    g.fillStyle = mezcla(acHex, "#ffffff", 0.86);
    const rr2 = (x, y, w, h, r2) => {
      g.beginPath();
      g.moveTo(x + r2, y);
      g.lineTo(x + w - r2, y);
      g.quadraticCurveTo(x + w, y, x + w, y + r2);
      g.lineTo(x + w, y + h - r2);
      g.quadraticCurveTo(x + w, y + h, x + w - r2, y + h);
      g.lineTo(x + r2, y + h);
      g.quadraticCurveTo(x, y + h, x, y + h - r2);
      g.lineTo(x, y + r2);
      g.quadraticCurveTo(x, y, x + r2, y);
      g.fill();
    };
    rr2(ax, ay, aw, ah, Math.round(H * 0.018));
    arteDe(g, arteTipoDe(o.categoria, o.nombre), ax, ay, aw, ah,
      acHex, acOsc, acCla, luminancia(acHex) < 0.45 ? "#f2f5f7" : "#14181c");

    /* nombre y presentación */
    const nombre = String(o.nombre || "");
    const corte = nombre.indexOf("·");
    const titulo = corte > 0 ? nombre.slice(0, corte).trim() : nombre;
    const pres = corte > 0 ? nombre.slice(corte + 1).trim() : "";

    g.textAlign = "center";
    g.textBaseline = "middle";
    /* El nombre vive en una caja reservada: si el formato (chip) existe, la
       caja termina arriba suyo, así una palabra corta y grande («Reineta»)
       no se le monta encima. */
    const chipH = H * 0.072;
    const chipY = py + ph - chipH - H * 0.020;
    const nameTop = py + H * 0.315;
    const nameBot = pres ? chipY - H * 0.014 : py + ph - H * 0.030;
    const avail = Math.max(H * 0.06, nameBot - nameTop);
    const maxW = pw * 0.88;
    let fs = Math.round(Math.min(H * 0.082, avail / 3.1));
    let lineas;
    for (;;) {
      g.font = "900 " + fs + "px -apple-system, Segoe UI, Roboto, sans-serif";
      lineas = envolver(g, titulo, maxW, 3);
      let ancho = 0;
      lineas.forEach((l) => { ancho = Math.max(ancho, g.measureText(l).width); });
      if ((ancho <= maxW && lineas.length * fs * 1.08 <= avail) ||
          fs <= Math.round(H * 0.046)) break;
      fs -= Math.max(1, Math.round(H * 0.004));
    }
    g.fillStyle = "#121416";
    const lh = fs * 1.08;
    const y0 = nameTop + avail / 2 - ((lineas.length - 1) * lh) / 2;
    lineas.forEach((l, i) => g.fillText(l, W * 0.5, y0 + i * lh));

    if (pres) {
      g.font = "700 " + Math.round(H * 0.048) + "px -apple-system, Segoe UI, Roboto, sans-serif";
      const tw = g.measureText(pres).width;
      const bw = Math.min(pw * 0.92, tw + W * 0.10), bh2 = chipH;
      const bx = W * 0.5 - bw / 2, by = chipY;
      g.fillStyle = "#0a0c0e";
      g.beginPath();
      const rr3 = bh2 / 2;
      g.moveTo(bx + rr3, by);
      g.lineTo(bx + bw - rr3, by);
      g.arc(bx + bw - rr3, by + rr3, rr3, -Math.PI / 2, Math.PI / 2);
      g.lineTo(bx + rr3, by + bh2);
      g.arc(bx + rr3, by + rr3, rr3, Math.PI / 2, Math.PI * 1.5);
      g.fill();
      g.fillStyle = "#ffffff";
      g.fillText(pres, W * 0.5, by + bh2 * 0.54);
    }

    /* código de barras */
    const bw2 = W * 0.42, bh3 = H * 0.058;
    const bx2 = W * 0.5 - bw2 / 2, by2 = H * 0.868;
    g.fillStyle = "rgba(250,248,241,.95)";
    g.fillRect(bx2 - W * 0.02, by2 - H * 0.010, bw2 + W * 0.04, bh3 + H * 0.020);
    let xb = bx2, seed = 17;
    while (xb < bx2 + bw2) {
      seed = (seed * 48271) % 2147483647;
      const w = 1 + (seed % 3);
      if (seed % 2) { g.fillStyle = "#0a0c0e"; g.fillRect(xb, by2, w, bh3); }
      xb += w + 1 + (seed % 2);
    }
  }

  /* Caché de carátulas: dos niveles de góndola pueden repetir el SKU y el
     mismo dibujo no se hace dos veces (ni se sube dos veces a la GPU). Se
     vacía en `destruirEscena`, que es donde se liberan los mapas. */
  const CACHE_ETQ = new Map();

  function texturaEtiqueta(p, S) {
    const W = S || 256, H = Math.round(W * 1.5);
    const clave = (p && (p.id || p.nombre)) + "|" + W;
    const hay = CACHE_ETQ.get(clave);
    if (hay) return hay;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    dibuEtiqueta(g, W, H, {
      nombre: p && p.nombre, tinte: colorDe(p),
      marca: marcaDe(p), forma: formaDe(p),
      categoria: p && p.categoria
    });
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    t.anisotropy = anisoMax();
    CACHE_ETQ.set(clave, t);
    return t;
  }


  function crearTV() {
    const c = document.createElement("canvas");
    c.width = 1280; c.height = 720;
    tvCanvas = c;
    tvTextura = new T.CanvasTexture(c);
    tvTextura.minFilter = T.LinearFilter;
    tvTextura.anisotropy = 4;
    return new T.Mesh(
      new T.PlaneGeometry(2.0, 1.125),
      new T.MeshBasicMaterial({ map: tvTextura })
    );
  }

  /* Pantalla 1280×720: promo con chip de categoría, precio grande, barra
     de tiempo, ticker de avisos y brillo de cristal. Se repinta cada
     segundo (reloj) y en cada rotación de promo. */
  function pintarTV() {
    if (!tvCanvas) return;
    const g = tvCanvas.getContext("2d");
    const W = tvCanvas.width, H = tvCanvas.height;
    const de = g.createLinearGradient(0, 0, 0, H);
    de.addColorStop(0, "#12161a"); de.addColorStop(1, "#07080a");
    g.fillStyle = de; g.fillRect(0, 0, W, H);
    g.fillStyle = "#c8ff00"; g.fillRect(0, 0, W, 16);
    g.textBaseline = "middle";

    const p = promos.length ? promos[promoIdx % promos.length] : null;
    if (!p) {                                   // sin promos: reposo
      g.textAlign = "center";
      g.fillStyle = "#9aa3a8";
      g.font = "800 76px -apple-system, Segoe UI, Roboto, sans-serif";
      g.fillText("SIN OFERTAS", W / 2, H / 2 - 20);
      g.font = "600 32px -apple-system, Segoe UI, Roboto, sans-serif";
      g.fillText("Vuelve más tarde", W / 2, H / 2 + 56);
      tvTextura.needsUpdate = true;
      return;
    }

    const ahora = new Date();
    const hh = String(ahora.getHours()).padStart(2, "0");
    const mm = String(ahora.getMinutes()).padStart(2, "0");

    // cabecera: punto en vivo · marca · reloj
    g.fillStyle = "#ff3b30";
    g.beginPath(); g.arc(46, 74, 12, 0, Math.PI * 2); g.fill();
    g.textAlign = "left";
    g.fillStyle = "#ffffff";
    g.font = "800 30px -apple-system, Segoe UI, Roboto, sans-serif";
    g.fillText("EN VIVO", 70, 74);
    g.textAlign = "center";
    g.fillStyle = "#9aa3a8";
    g.font = "700 30px -apple-system, Segoe UI, Roboto, sans-serif";
    g.fillText("FORGE · OFERTA DEL DÍA", W / 2, 74);
    g.textAlign = "right";
    g.fillStyle = "#c8ff00";
    g.font = "800 36px ui-monospace, SFMono-Regular, Menlo, monospace";
    g.fillText(hh + ":" + mm, W - 46, 74);

    // chip de categoría
    const cat = String(p.categoria || "OFERTA").toUpperCase();
    g.textAlign = "left";
    g.font = "800 32px -apple-system, Segoe UI, Roboto, sans-serif";
    const wc = g.measureText(cat).width + 56;
    g.fillStyle = "#c8ff00"; g.fillRect(46, 132, wc, 52);
    g.fillStyle = "#0b0d0f"; g.fillText(cat, 74, 158);

    // nombre, reduciendo el cuerpo hasta que entre completo
    const nombre = String(p.nombre || "").toUpperCase();
    g.textBaseline = "alphabetic";
    let fs = 96;
    do {
      g.font = "900 " + fs + "px -apple-system, Segoe UI, Roboto, sans-serif";
      if (g.measureText(nombre).width <= W - 92) break;
      fs -= 4;
    } while (fs > 44);
    g.fillStyle = "#ffffff";
    g.fillText(nombre, 46, 300);

    // precio + unidad
    const precio = "$" + Math.round(p.precio || 0).toLocaleString("es-CL");
    g.fillStyle = "#c8ff00";
    g.font = "900 150px -apple-system, Segoe UI, Roboto, sans-serif";
    g.fillText(precio, 46, 452);
    const wp = g.measureText(precio).width;
    g.fillStyle = "#9aa3a8";
    g.font = "800 42px -apple-system, Segoe UI, Roboto, sans-serif";
    g.fillText("c/u", 46 + wp + 24, 452);
    g.textBaseline = "middle";

    // barra de tiempo de la promo
    const prog = Math.min(1, Math.max(0, (Date.now() - promoT0) / 4000));
    g.fillStyle = "#1b1f23"; g.fillRect(46, 540, W - 92, 10);
    g.fillStyle = "#c8ff00"; g.fillRect(46, 540, (W - 92) * prog, 10);

    // llamada a la acción
    g.fillStyle = "#c8ff00";
    g.font = "800 34px -apple-system, Segoe UI, Roboto, sans-serif";
    g.fillText("TOCA LA PANTALLA PARA AGREGAR", 46, 596);

    // ticker de avisos legales
    g.save();
    g.beginPath(); g.rect(0, 644, W, H - 644); g.clip();
    g.fillStyle = "#c8ff00"; g.fillRect(0, 644, W, 4);
    g.textAlign = "left";
    g.fillStyle = "#e6e9ec";
    g.font = "700 28px -apple-system, Segoe UI, Roboto, sans-serif";
    const ticks = "PAGOS SIMULADOS · CATÁLOGO REFERENCIAL · PRECIOS EN CLP · FORGE CORE STOCK · ";
    g.fillText(ticks + ticks, W - ((Date.now() / 40) % (W + 900)), 690);
    g.restore();

    // scanlines de cristal
    g.fillStyle = "rgba(255,255,255,.03)";
    for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);

    // brillo diagonal
    const gl = g.createLinearGradient(0, 0, W, H);
    gl.addColorStop(0, "rgba(255,255,255,.10)");
    gl.addColorStop(0.4, "rgba(255,255,255,0)");
    gl.addColorStop(1, "rgba(255,255,255,.05)");
    g.fillStyle = gl; g.fillRect(0, 0, W, H);

    tvTextura.needsUpdate = true;
  }

  /* Avanza a la siguiente promo y reinicia su barra de tiempo. */
  function siguientePromo() {
    promoIdx++;
    promoT0 = Date.now();
    pintarTV();
  }

  /* Carrito de compra: cesta de barandas, manija con agarre lima y cuatro
     ruedas. Camina un metro al frente del jugador y frena si hay un mueble. */
  function crearCarrito() {
    carritoRuedas = [];
    cestaItems = [];
    cestaN = 0;
    const g = new T.Group();
    const malla = new T.MeshLambertMaterial({ color: 0xc3cbd1 });
    refs.metal.push({ mat: malla, rep: [1, 1], nor: 0.4 });
    const ruedaM = new T.MeshLambertMaterial({ color: 0x23272b });
    const lima = new T.MeshLambertMaterial({ color: 0xc8ff00 });
    const caja = (w, h, d, x, y, z, mat) => {
      const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat || malla);
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
      return m;
    };

    caja(0.62, 0.03, 0.44, 0, 0.30, 0);              // piso de la cesta

    [-0.30, 0.30].forEach((x) => {                   // laterales
      caja(0.025, 0.03, 0.46, x, 0.62, 0);
      caja(0.025, 0.03, 0.46, x, 0.33, 0);
      for (let k = 0; k < 5; k++) caja(0.02, 0.30, 0.02, x, 0.47, -0.20 + k * 0.10);
    });
    [[0.23, 6], [-0.23, 5]].forEach(([z, n]) => {     // fondo y frente
      caja(0.62, 0.03, 0.025, 0, 0.62, z);
      caja(0.62, 0.03, 0.025, 0, 0.33, z);
      for (let k = 0; k < n; k++) caja(0.02, 0.30, 0.02, -0.26 + k * (0.52 / (n - 1)), 0.47, z);
    });

    caja(0.035, 0.36, 0.035, -0.28, 0.79, 0.24);      // manija
    caja(0.035, 0.36, 0.035, 0.28, 0.79, 0.24);
    caja(0.62, 0.05, 0.05, 0, 0.97, 0.24);
    caja(0.30, 0.058, 0.058, 0, 0.97, 0.24, lima);    // agarre lima

    const geoR = new T.CylinderGeometry(0.07, 0.07, 0.035, 12);
    [[-0.26, 0.17], [0.26, 0.17], [-0.26, -0.17], [0.26, -0.17]].forEach(([x, z]) => {
      const eje = new T.Group();
      eje.rotation.z = Math.PI / 2;
      const disco = new T.Mesh(geoR, ruedaM);
      eje.add(disco);
      eje.position.set(x, 0.07, z);
      g.add(eje);
      carritoRuedas.push(disco);
    });

    /* Cesta: grupo vacío donde aterrizan los productos. Va dentro del
       carrito, así que se mueven con él y no se despegan al caminar. */
    carritoCesta = new T.Group();
    g.add(carritoCesta);
    return g;
  }

  /* Destino del carrito, por prioridad: delante (sin acercarse a menos de
     1 m, que se mete en la cámara), al costado y por último atrás. Antes,
     cuando el frente estaba tapado —y con la zona fresca en la entrada
     siempre lo está—, el carro se plantaba a 0,5 m de los ojos. */
  function destinoCarrito() {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = -fz, rz = fx;                     // perpendicular derecha
    for (let d = 1.5; d >= 1.0; d -= 0.1) {
      const x = pos.x + fx * d, z = pos.z + fz * d;
      if (!choca(x, z)) return { x: x, z: z };
    }
    for (let i = 0; i < 2; i++) {
      const sg = i ? -1 : 1;
      const x = pos.x + rx * sg * 0.95 + fx * 0.35;
      const z = pos.z + rz * sg * 0.95 + fz * 0.35;
      if (!choca(x, z)) return { x: x, z: z };
    }
    const xb = pos.x - fx * 1.25, zb = pos.z - fz * 1.25;
    if (!choca(xb, zb)) return { x: xb, z: zb };
    return { x: pos.x + fx * 1.1, z: pos.z + fz * 1.1 };
  }

  /* Posición inicial: la misma regla que en marcha (con la zona fresca, el
     punto de siempre (0 · −1,5) caía dentro de la isla central). */
  function huecoCarrito() { return destinoCarrito(); }

  function actualizarCarrito(dt) {
    if (!carrito) return;
    const d0 = destinoCarrito();
    const tx = d0.x, tz = d0.z;
    const k = Math.min(1, dt * 6);
    const dx = tx - carrito.position.x, dz = tz - carrito.position.z;
    const mov = Math.hypot(dx, dz) * k;
    carrito.position.x += dx * k;
    carrito.position.z += dz * k;

    let d = yaw - carrito.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    carrito.rotation.y += d * Math.min(1, dt * 5);
    carritoRuedas.forEach((r) => { r.rotation.y += mov / 0.07; });

    // rebote al agregar algo
    if (carritoAnim > 0) {
      carritoAnim = Math.max(0, carritoAnim - dt * 3.2);
      carrito.position.y = Math.sin(carritoAnim * Math.PI) * 0.06;
    } else if (carrito.position.y) {
      carrito.position.y = 0;
    }
  }

  /* ── zona fresca: mercado de frutas, verduras y refrigerados ─────────────
     Ocupa la mitad de entrada (z > 4,5), el único hueco grande del local:
     tres islas de madera con cajas de producto y dos islas refrigeradas.
     Las pilas se instancian por tipo, así 240 frutas cuestan 12 draw calls.
     Todo es geometría procedural: ni una imagen externa. */
  const FRESCOS = {
    tomate:    { nombre: "Tomate pera",     precio: 1290, color: 0xd8342a, escala: 0.150 },
    lechuga:   { nombre: "Lechuga costina", precio: 990,  color: 0x4f9e3a, escala: 0.235 },
    zanahoria: { nombre: "Zanahoria",       precio: 890,  color: 0xe2761f, escala: 0.160 },
    papa:      { nombre: "Papa lavada",     precio: 1490, color: 0xb98b5a, escala: 0.170 },
    manzana:   { nombre: "Manzana royal",   precio: 1590, color: 0xc42a2a, escala: 0.160 },
    naranja:   { nombre: "Naranja de mesa", precio: 1390, color: 0xf08a1e, escala: 0.150 },
    platano:   { nombre: "Plátano",         precio: 1190, color: 0xf2c53d, escala: 0.215 },
    uva:       { nombre: "Uva negra",       precio: 2290, color: 0x5b2a63, escala: 0.160 },
    cebolla:   { nombre: "Cebolla",         precio: 1090, color: 0xc9a27a, escala: 0.160 },
    pimiento:  { nombre: "Pimiento rojo",   precio: 1490, color: 0xc8302a, escala: 0.160 },
    brocoli:   { nombre: "Brócoli",         precio: 1690, color: 0x3f7a2f, escala: 0.215 },
    limon:     { nombre: "Limón sutil",     precio: 990,  color: 0xd8cf3a, escala: 0.130 }
  };
  const ISLAS_FRESCAS = [
    { x: -4.8, z: 6.4, items: ["tomate", "lechuga", "zanahoria", "papa"] },
    { x: 0,    z: 6.4, items: ["manzana", "naranja", "platano", "uva"] },
    { x: 4.8,  z: 6.4, items: ["cebolla", "pimiento", "brocoli", "limon"] }
  ];
  const REFRIGERADOS = [
    { x: -4.8, z: 9.15, titulo: "REFRIGERIO",
      items: [
        { nombre: "Chocolate · 100 g", precio: 1290, categoria: "Refrigerio" },
        { nombre: "Galleta surtida · 200 g", precio: 1490, categoria: "Refrigerio" },
        { nombre: "Papas fritas · 180 g", precio: 1890, categoria: "Refrigerio" },
        { nombre: "Bebida cola · 1,5 L", precio: 1990, categoria: "Bebidas" },
        { nombre: "Agua mineral · 600 ml", precio: 990, categoria: "Bebidas" },
        { nombre: "Jugo de naranja · 1 L", precio: 2190, categoria: "Bebidas" },
        { nombre: "Maní tostado · 150 g", precio: 1190, categoria: "Refrigerio" },
        { nombre: "Barra cereal · 40 g", precio: 790, categoria: "Refrigerio" },
        { nombre: "Café listo · 250 ml", precio: 1590, categoria: "Bebidas" }
      ] },
    { x: 4.8, z: 9.15, titulo: "REFRIGERADOS",
      items: [
        { nombre: "Leche entera · 1 L", precio: 1790, categoria: "Lácteos" },
        { nombre: "Yogur natural · 1 kg", precio: 2490, categoria: "Lácteos" },
        { nombre: "Queso gauda · 250 g", precio: 3290, categoria: "Lácteos" },
        { nombre: "Mantequilla · 250 g", precio: 2890, categoria: "Lácteos" },
        { nombre: "Postre de leche · 120 g", precio: 990, categoria: "Lácteos" },
        { nombre: "Jugo de piña · 1 L", precio: 2190, categoria: "Bebidas" },
        { nombre: "Yogur bebible · 1 L", precio: 1890, categoria: "Lácteos" },
        { nombre: "Crema · 200 ml", precio: 1690, categoria: "Lácteos" },
        { nombre: "Bebida vegetal · 1 L", precio: 2390, categoria: "Lácteos" }
      ] }
  ];

  /* Tótems de oferta flanqueando la entrada. Van aquí y no dentro de
     crearAnuncios porque `choca()` también los necesita. */
  const TOTEMS = [
    { x: -7.4, z: 8.8, t: "OFERTA", o: "-30%", p: "En verduras del día", c: "#3ddc84" },
    { x: 7.4,  z: 8.8, t: "OFERTA", o: "-20%", p: "En lácteos y bebidas", c: "#5aa9ff" }
  ];

  const GEO_FRESCO = {};
  const GEO_TAPA = {};

  /* Ruido determinista: la misma fruta se ve igual en cada visita (nada de
     Math.random en la geometría, que cambiaría al reconstruir la escena). */
  function azar(i) {
    const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  }

  function ruidoForma(g, amp, freq) {
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const n = Math.sin(x * freq + 1.3) * Math.sin(y * freq * 0.9 + 2.1) *
        Math.sin(z * freq + 1.7);
      const k = 1 + n * amp;
      pos.setXYZ(i, x * k, y * k, z * k);
    }
    g.computeVertexNormals();
    return g;
  }

  function geoFresco(tipo) {
    if (GEO_FRESCO[tipo]) return GEO_FRESCO[tipo];
    const esfera = (seg) => new T.SphereGeometry(0.5, seg || 12, (seg || 12) - 2);
    let g;
    if (tipo === "tomate") {
      g = esfera(14);
      g.scale(1, 0.86, 1);
      ruidoForma(g, 0.025, 7);
    } else if (tipo === "lechuga") {
      g = esfera(12);
      g.scale(1, 0.82, 1);
      ruidoForma(g, 0.20, 8);
    } else if (tipo === "zanahoria") {
      g = new T.CylinderGeometry(0.11, 0.02, 1.7, 10, 1);
      ruidoForma(g, 0.04, 9);
    } else if (tipo === "papa") {
      g = esfera(12);
      g.scale(1, 0.74, 0.86);
      ruidoForma(g, 0.07, 5);
    } else if (tipo === "manzana") {
      g = torno([
        [0.00, 0.00], [0.30, 0.02], [0.46, 0.16], [0.50, 0.42],
        [0.44, 0.72], [0.26, 0.90], [0.10, 0.96], [0.00, 0.94]
      ], 16);
    } else if (tipo === "naranja") {
      g = esfera(12);
      g.scale(1, 0.95, 1);
      ruidoForma(g, 0.012, 11);
    } else if (tipo === "platano") {
      const cv = new T.CatmullRomCurve3([
        new T.Vector3(-0.45, 0.02, 0), new T.Vector3(-0.18, 0.13, 0.03),
        new T.Vector3(0.18, 0.13, 0.03), new T.Vector3(0.45, 0.02, 0)
      ]);
      g = new T.TubeGeometry(cv, 12, 0.10, 8, false);
    } else if (tipo === "uva") {
      g = esfera(10);
      ruidoForma(g, 0.22, 10);
    } else if (tipo === "cebolla") {
      g = torno([
        [0.00, 0.00], [0.32, 0.02], [0.50, 0.20], [0.50, 0.50],
        [0.40, 0.74], [0.18, 0.90], [0.00, 0.99]
      ], 16);
    } else if (tipo === "pimiento") {
      g = esfera(12);
      g.scale(1, 1.18, 0.92);
      ruidoForma(g, 0.05, 6);
    } else if (tipo === "brocoli") {
      g = esfera(10);
      g.scale(1, 0.90, 1);
      ruidoForma(g, 0.22, 9);
    } else {
      g = esfera(12);
      g.scale(1.14, 0.84, 0.84);
    }
    GEO_FRESCO[tipo] = g;
    return g;
  }

  /* Matriz de la etiqueta. En las familias planas (caja, bolsa, tetra, pote)
     el cuerpo está comprimido en profundidad, así que el desplazamiento del
     plano se calcula en el mundo y no en la geometría: con el z horneado el
     plano quedaba DENTRO de la caja y el producto se veía vacío. En las
     redondas la banda curva ya nace por fuera del envase. */
  const FAMILIA_CILINDRO = { botella: 1, vidrio: 1, lata: 1, frasco: 1 };

  function matEtiqueta(forma, m, fondo) {
    if (FAMILIA_CILINDRO[forma]) return m;
    const p = new T.Vector3(), q = new T.Quaternion(), esc = new T.Vector3();
    m.decompose(p, q, esc);
    p.add(new T.Vector3(0, 0, (fondo || 0.07) / 2 + 0.0035).applyQuaternion(q));
    return new T.Matrix4().compose(p, q, esc);
  }

  /* Tapa / rosca de cada familia: es el remate que hace que una botella se
     lea como botella y un pote como pote. */
  function geoTapa(forma) {
    if (GEO_TAPA[forma] !== undefined) return GEO_TAPA[forma];
    let g = null;
    if (forma === "botella") g = new T.CylinderGeometry(0.22, 0.22, 0.10, 14);
    else if (forma === "vidrio") g = new T.CylinderGeometry(0.17, 0.17, 0.09, 14);
    else if (forma === "frasco") g = new T.CylinderGeometry(0.33, 0.33, 0.08, 16);
    else if (forma === "yogur") g = new T.CylinderGeometry(0.53, 0.53, 0.06, 18);
    GEO_TAPA[forma] = g;
    return g;
  }

  /* Cartel de la zona fresca: verde profundo, tipografía blanca y filete
     lima. Se usa colgado de las islas y sobre las neveras abiertas. */
  function texturaFresco(titulo, sub, ancho) {
    const W = ancho || 1024, H = 320;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    const de = g.createLinearGradient(0, 0, W, H);
    de.addColorStop(0, "#12351d"); de.addColorStop(1, "#07130b");
    g.fillStyle = de; g.fillRect(0, 0, W, H);
    g.fillStyle = "#c8ff00";
    g.fillRect(0, 0, W, 12); g.fillRect(0, H - 10, W, 10);
    g.textAlign = "left"; g.textBaseline = "middle";
    let fs = 96;
    g.fillStyle = "#ffffff";
    do {
      g.font = "900 " + fs + "px -apple-system, Segoe UI, Roboto, sans-serif";
      if (g.measureText(titulo).width <= W - 90) break;
      fs -= 4;
    } while (fs > 34);
    g.fillText(String(titulo || "").toUpperCase(), 46, H * 0.42);
    g.fillStyle = "#c8ff00";
    g.font = "700 30px -apple-system, Segoe UI, Roboto, sans-serif";
    g.fillText(String(sub || "").toUpperCase(), 48, H * 0.74);
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    t.anisotropy = anisoMax();
    return t;
  }

  /* Anuncio de pared: fondo oscuro, oferta gigante y color de categoría.
     Es el mismo lenguaje del cartel de pasillo, a otra escala. */
  function texturaAnuncio(titulo, oferta, pie, color) {
    const W = 1024, H = 640;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    const col = color || "#c8ff00";
    const de = g.createLinearGradient(0, 0, W, H);
    de.addColorStop(0, "#11151a"); de.addColorStop(1, "#050708");
    g.fillStyle = de; g.fillRect(0, 0, W, H);
    g.save();
    g.translate(W * 0.5, H * 0.52); g.rotate(-0.20);
    g.globalAlpha = 0.14; g.fillStyle = col;
    g.fillRect(-W, -H * 0.18, W * 2, H * 0.36);
    g.restore();
    g.globalAlpha = 1;
    g.strokeStyle = col; g.lineWidth = 12;
    g.strokeRect(18, 18, W - 36, H - 36);

    g.textAlign = "left"; g.textBaseline = "top";
    g.fillStyle = "#ffffff";
    let fs = 76;
    do {
      g.font = "900 " + fs + "px -apple-system, Segoe UI, Roboto, sans-serif";
      if (g.measureText(titulo).width <= W - 120) break;
      fs -= 3;
    } while (fs > 34);
    g.fillText(String(titulo || "").toUpperCase(), 58, 62);

    g.fillStyle = col;
    g.font = "900 200px -apple-system, Segoe UI, Roboto, sans-serif";
    g.fillText(String(oferta || ""), 54, H - 330);

    g.fillStyle = "rgba(255,255,255,.82)";
    g.font = "700 32px -apple-system, Segoe UI, Roboto, sans-serif";
    g.fillText(String(pie || "").toUpperCase(), 60, H - 108);

    g.fillStyle = col;
    g.fillRect(W - 250, 62, 176, 10);
    g.fillStyle = "#ffffff";
    g.font = "900 26px -apple-system, Segoe UI, Roboto, sans-serif";
    g.textAlign = "right";
    g.fillText("FORGE CORE STOCK", W - 62, 88);

    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    t.anisotropy = anisoMax();
    return t;
  }

  /* Etiqueta de precio de una caja de verdura (no es una tira de estante:
     una sola pieza, con nombre y precio grandes). */
  function texturaPrecioFresco(nombre, precio) {
    const W = 512, H = 128;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    g.fillStyle = "#f6f1df"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#12351d"; g.fillRect(0, 0, W, 8);
    g.textBaseline = "middle"; g.textAlign = "left";
    g.fillStyle = "#1a1d20";
    let fs = 34;
    do {
      g.font = "800 " + fs + "px -apple-system, Segoe UI, Roboto, sans-serif";
      if (g.measureText(nombre).width <= W * 0.58) break;
      fs -= 2;
    } while (fs > 14);
    g.fillText(String(nombre || ""), 14, H * 0.50);
    g.textAlign = "right";
    g.fillStyle = "#0b0d0f";
    g.font = "900 46px -apple-system, Segoe UI, Roboto, sans-serif";
    g.fillText("$" + Math.round(precio || 0).toLocaleString("es-CL"), W - 14, H * 0.52);
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    t.anisotropy = anisoMax();
    return t;
  }

  function crearZonaFresca() {
    if (!ISLAS_FRESCAS.length) return;
    const madera = new T.MeshLambertMaterial({ color: 0x7a5433 });
    const maderaOsc = new T.MeshLambertMaterial({ color: 0x4c3421 });
    const verde = new T.MeshLambertMaterial({ color: 0x1d5a2c });
    const lima = new T.MeshLambertMaterial({ color: 0xc8ff00 });

    const caja = (w, h, d, x, y, z, mat, g) => {
      const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
      return m;
    };

    const pilas = new Map();          // tipo → matrices + producto
    const etiquetas = [];             // etiquetas de precio de las cajas

    ISLAS_FRESCAS.forEach((isla, ii) => {
      const g = new T.Group();
      g.name = "isla-fresca-" + ii;
      g.position.set(isla.x, 0, isla.z);
      // zócalo verde + cuerpo de madera con listones
      caja(2.34, 0.10, 1.20, 0, 0.05, 0, verde, g);
      caja(2.20, 0.44, 1.06, 0, 0.32, 0, madera, g);
      [-0.86, -0.29, 0.29, 0.86].forEach((x) => {
        caja(0.05, 0.44, 1.08, x, 0.32, 0, maderaOsc, g);
      });
      // dos cajas por lado, cada una con su producto
      [-1, 1].forEach((lado) => {
        [-0.56, 0.56].forEach((x, k) => {
          const z = lado * 0.30;
          caja(0.52, 0.16, 0.50, x, 0.62, z, maderaOsc, g);
          caja(0.56, 0.04, 0.54, x, 0.70, z, madera, g);
          const tipo = isla.items[(k + (lado > 0 ? 2 : 0)) % isla.items.length];
          const F = FRESCOS[tipo];
          if (!F) return;                 // tipo mal escrito: se salta la caja
          const prod = {
            id: "fresco-" + tipo + "-" + ii,
            nombre: F.nombre, categoria: "Frutas y verduras",
            precio: F.precio, stock: 25
          };
          const e = pilas.get(tipo) || { mats: [], prod: prod };
          /* Pila de 20 piezas en tres capas (12 + 6 + 2) con desorden
             determinista: la fruta no queda alineada como soldaditos y la
             caja se ve llena, como en un mercado de verdad. */
          const COLS = [-0.173, -0.058, 0.058, 0.173];
          const FILAS = [-0.13, 0, 0.13];
          const CAPAS = [];
          COLS.forEach((cx) => FILAS.forEach((cz) => CAPAS.push([cx, cz, 0])));
          [-0.115, 0, 0.115].forEach((cx) => [-0.065, 0.065].forEach((cz) => CAPAS.push([cx, cz, 1])));
          [-0.058, 0.058].forEach((cx) => CAPAS.push([cx, 0, 2]));
          CAPAS.forEach((o, n) => {
            const jx = (azar(ii * 97 + n * 13 + k * 7) - 0.5) * 0.036;
            const jz = (azar(ii * 57 + n * 29 + k * 11) - 0.5) * 0.036;
            const acostada = tipo === "zanahoria" || tipo === "platano";
            const qq = new T.Quaternion().setFromEuler(new T.Euler(
              (azar(n * 31 + k * 17 + ii) - 0.5) * (acostada ? 2.4 : 0.45),
              azar(n * 11 + k * 23 + ii) * Math.PI * 2,
              (azar(n * 7 + k * 3 + ii) - 0.5) * (acostada ? 2.4 : 0.35)
            ));
            /* o[0] es la columna dentro de la caja: sin él las 20 piezas
               caían todas sobre el mismo eje X y la pila se veía como una
               fila de soldaditos. */
            const m = new T.Matrix4().compose(
              new T.Vector3(isla.x + x + o[0] + jx,
                0.70 + (acostada ? 0.035 : F.escala * 0.42) +
                  o[2] * F.escala * (acostada ? 0.22 : 0.80),
                isla.z + z + o[1] + jz),
              qq, new T.Vector3(F.escala, F.escala, F.escala)
            );
            e.mats.push(m);
          });
          pilas.set(tipo, e);
          /* El precio va pegado a la cara frontal de la caja (0,54–0,70 m):
             antes quedaba 6 cm por delante, flotando en el pasillo. */
          etiquetas.push({
            prod: prod, x: isla.x + x + (x < 0 ? 0 : 0), y: 0.615,
            z: isla.z + z + lado * 0.255, ry: lado > 0 ? 0 : Math.PI
          });
        });
      });
      // cartel colgado sobre la isla
      const cartel = new T.Mesh(
        new T.PlaneGeometry(1.62, 0.52),
        new T.MeshBasicMaterial({
          map: texturaFresco("MERCADO FRESCO",
            isla.items.map((t) => FRESCOS[t].nombre).slice(0, 3).join(" · ")),
          side: T.DoubleSide
        })
      );
      cartel.position.set(0, 1.98, 0);
      g.add(cartel);
      [-0.62, 0.62].forEach((vx) => {
        const v = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, 0.95), lima);
        v.position.set(vx, 2.45, 0);
        g.add(v);
      });
      scene.add(g);
    });

    // pilas: una InstancedMesh por tipo con variación de color por pieza
    const tmpC = new T.Color();
    pilas.forEach((e, tipo) => {
      const mesh = new T.InstancedMesh(
        geoFresco(tipo), new T.MeshLambertMaterial({ color: 0xffffff }), e.mats.length
      );
      const base = new T.Color(FRESCOS[tipo].color);
      e.mats.forEach((m, i) => {
        mesh.setMatrixAt(i, m);
        tmpC.copy(base).multiplyScalar(0.86 + azar(i * 19 + tipo.length) * 0.30);
        mesh.setColorAt(i, tmpC);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.name = "fresco-" + tipo;
      frescosPilas.push({ mesh: mesh, n: e.mats.length });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.userData.mapa = e.mats.map(() => e.prod);
      scene.add(mesh);
      mallasProd.push(mesh);
      frescosMallas++;
    });

    /* Luz de la zona fresca: panel LED sobre cada isla (emisivo, cuelga del
       grupo del techo para que responda al interruptor) y una luz de relleno
       cálida, porque el fondo del local solo tenía puntos en z ±3,35 y la
       fruta quedaba en penumbra justo donde más color importa. */
    const panelLED = new T.MeshBasicMaterial({ color: 0xfff6e2 });
    ISLAS_FRESCAS.forEach((isla) => {
      const pnl = new T.Mesh(new T.BoxGeometry(2.2, 0.05, 1.0), panelLED);
      pnl.position.set(isla.x, 2.99, isla.z);
      if (grupoLED.techo) grupoLED.techo.add(pnl); else scene.add(pnl);
    });
    luzFresca = new T.PointLight(0xfff0d8, 0.6, 15, 0);
    luzFresca.position.set(0, 2.8, 7.2);
    scene.add(luzFresca);

    // etiquetas de precio de cada caja
    etiquetas.forEach((t) => {
      const m = new T.Mesh(
        new T.PlaneGeometry(0.38, 0.105),
        new T.MeshBasicMaterial({
          map: texturaPrecioFresco(t.prod.nombre, t.prod.precio),
          side: T.DoubleSide
        })
      );
      m.position.set(t.x, t.y, t.z);
      m.rotation.y = t.ry;
      scene.add(m);
    });
  }

  /* Isla refrigerada de una cara: tres repisas iluminadas, productos de las
     mismas familias que la góndola y cartel de categoría. */
  function crearIslaRefri(cfg) {
    if (!cfg || !cfg.items || !cfg.items.length) return;
    const g = new T.Group();
    g.name = "isla-refri-" + cfg.titulo;
    g.position.set(cfg.x, 0, cfg.z);
    const marco = new T.MeshLambertMaterial({ color: 0x1e2429 });
    const panel = new T.MeshLambertMaterial({ color: 0x2b333a });
    const led = new T.MeshBasicMaterial({ color: 0xe8f6ff });

    const caja = (w, h, d, x, y, z, mat) => {
      const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
      return m;
    };

    caja(2.50, 0.12, 0.92, 0, 0.06, 0, marco);
    caja(2.50, 0.10, 0.92, 0, 1.58, 0, marco);
    caja(0.08, 1.52, 0.92, -1.21, 0.82, 0, panel);
    caja(0.08, 1.52, 0.92, 1.21, 0.82, 0, panel);
    caja(2.50, 1.52, 0.08, 0, 0.82, -0.42, panel);

    const YS = [0.42, 0.86, 1.30];
    YS.forEach((y) => {
      caja(2.36, 0.05, 0.80, 0, y, 0.02, panel);
      const l = new T.Mesh(new T.BoxGeometry(2.28, 0.02, 0.03), led);
      l.position.set(0, y - 0.05, 0.40);
      g.add(l);
    });

    /* El lienzo de texturaFresco es 3,2:1: el placo tiene que respetar esa
       proporción o el texto sale aplastado a lo ancho. */
    const cartel = new T.Mesh(
      new T.PlaneGeometry(2.44, 0.50),     // 1562×320 = 4,88:1
      new T.MeshBasicMaterial({
        map: texturaFresco(cfg.titulo, "FRESCO TODOS LOS DÍAS", 1562),
        side: T.DoubleSide
      })
    );
    cartel.position.set(0, 2.02, 0);
    g.add(cartel);
    [-1.05, 1.05].forEach((px) => {          // soportes hasta el mueble
      const sop = new T.Mesh(new T.BoxGeometry(0.05, 0.30, 0.05), marco);
      sop.position.set(px, 1.70, 0);
      g.add(sop);
    });

    // productos: 3 por repisa, con su familia y su etiqueta
    const porFam = new Map();
    YS.forEach((y, ni) => {
      for (let c = 0; c < 3; c++) {
        const it = cfg.items[(ni * 3 + c) % cfg.items.length];
        const prod = {
          id: "refri-" + cfg.titulo + "-" + ni + "-" + c,
          nombre: it.nombre, categoria: it.categoria || "Refrigerados",
          precio: it.precio, stock: 18
        };
        const forma = formaDe(prod);
        const tam = TAMANO[forma] || TAMANO.caja;
        const x = -0.82 + c * 0.82;
        /* coordenadas LOCALES del grupo de la isla: sumar cfg.x/cfg.z otra
           vez los sacaba del mueble y los dejaba flotando en el pasillo */
        const m = new T.Matrix4().compose(
          new T.Vector3(x, y + 0.03 + tam.alto / 2, 0.02),
          new T.Quaternion(),
          new T.Vector3(tam.ancho, tam.alto, tam.fondo / tam.fondoGeo)
        );
        const e = porFam.get(forma) || { mats: [], prods: [] };
        e.mats.push(m); e.prods.push(prod);
        porFam.set(forma, e);
      }
    });

    const tmpC = new T.Color();
    porFam.forEach((e, forma) => {
      const mesh = new T.InstancedMesh(
        geoForma(forma), matForma(forma, e.prods[0], true), e.mats.length
      );
      e.mats.forEach((m, i) => {
        mesh.setMatrixAt(i, m);
        tmpC.set(colorDe(e.prods[i]));
        mesh.setColorAt(i, tmpC);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.userData.mapa = e.prods;
      g.add(mesh);
      mallasProd.push(mesh);
      refriMallas++;
    });

    // etiqueta por producto (cada repisa tiene tres SKU distintos)
    porFam.forEach((e) => {
      const forma = formaDe(e.prods[0]);
      e.prods.forEach((prod, i) => {
        const me = new T.InstancedMesh(
          geoEtiqueta(forma),
          new T.MeshLambertMaterial({ map: texturaEtiqueta(prod, 192) }), 1
        );
        me.setMatrixAt(0, matEtiqueta(forma, e.mats[i],
          (TAMANO[forma] || TAMANO.caja).fondo));
        me.instanceMatrix.needsUpdate = true;
        me.frustumCulled = false;
        me.userData.mapa = [prod];
        g.add(me);
      });
    });

    // tira de precios del filo de cada repisa
    YS.forEach((y, ni) => {
      const items = [0, 1, 2].map((c) => {
        const it = cfg.items[(ni * 3 + c) % cfg.items.length];
        return { nombre: it.nombre, precio: it.precio };
      });
      const tira = new T.Mesh(
        new T.PlaneGeometry(2.28, 0.13),
        new T.MeshBasicMaterial({ map: texturaTira(items, 1536, 96), side: T.DoubleSide })
      );
      tira.position.set(0, y - 0.10, 0.44);
      g.add(tira);
    });

    scene.add(g);
  }

  /* Anuncios del local: carteles de pared con marco y barra de luz, dos
     banderolas en la entrada y dos tótems de oferta. Todos comparten el
     mismo lenguaje y quedan alineados a la misma altura, debajo de la
     franja lima del muro (2,66 m) para no cortarla. */
  const ANUNCIOS_PARED = [
    { t: "LÁCTEOS", o: "-20%", p: "Leche, yogur y quesos", c: "#5aa9ff", muro: "izq", z: -2.2 },
    { t: "DESPENSA", o: "2x1", p: "Arroz, aceite y pastas", c: "#ffb020", muro: "izq", z: 2.4 },
    { t: "FRUTAS", o: "-30%", p: "Verduras del día", c: "#3ddc84", muro: "izq", z: 6.5 },
    { t: "BEBIDAS", o: "-25%", p: "Todo el pasillo de líquidos", c: "#4ebecb", muro: "der", z: -2.2 },
    { t: "ASEO", o: "-30%", p: "Detergentes y limpieza", c: "#b48cff", muro: "der", z: 2.4 },
    { t: "CONGELADOS", o: "-15%", p: "Pizza, helados y hielo", c: "#7fd4ff", muro: "der", z: 6.5 }
  ];

  /* Un cartel de pared completo: marco oscuro, cara iluminada y barra LED
     sobre el borde superior. Antes era un plano suelto que "flotaba" en el
     muro; con marco y luz se lee como mobiliario del local. */
  function cartelPared(x, y, z, ry, ancho, alto, tex, conLuz) {
    const g = new T.Group();
    g.position.set(x, y, z);
    g.rotation.y = ry;
    const marco = new T.Mesh(
      new T.BoxGeometry(ancho + 0.10, alto + 0.10, 0.06),
      new T.MeshLambertMaterial({ color: 0x14181c })
    );
    g.add(marco);
    const cara = new T.Mesh(
      new T.PlaneGeometry(ancho, alto),
      new T.MeshBasicMaterial({ map: tex })
    );
    cara.position.z = 0.036;
    g.add(cara);
    if (conLuz !== false) {
      /* La barra va dentro del grupo: hereda giro y posición y apunta al
         pasillo, así el filo queda iluminado en los cuatro muros. */
      const barra = new T.Mesh(
        new T.BoxGeometry(ancho * 0.94, 0.035, 0.045),
        new T.MeshBasicMaterial({ color: 0xfff6e4 })
      );
      barra.position.set(0, alto / 2 + 0.058, 0.05);
      g.add(barra);
    }
    scene.add(g);
    anunciosMallas++;
    return g;
  }

  function crearAnuncios() {
    /* El marco mide 1,82 m de alto: con el centro en 1,70 el borde superior
       queda en 2,61, debajo de la franja lima del muro (2,66). */
    const ANCHO_AD = 2.7, ALTO_AD = 1.72, Y_AD = 1.70;
    ANUNCIOS_PARED.forEach((a) => {
      const der = a.muro === "der";
      const x = (der ? 1 : -1) * (ANCHO / 2 - 0.05);
      const ry = der ? -Math.PI / 2 : Math.PI / 2;
      const g = cartelPared(x, Y_AD, a.z, ry, ANCHO_AD, ALTO_AD,
        texturaAnuncio(a.t, a.o, a.p, a.c));
      g.name = "anuncio-" + a.t;
    });

    /* Banderolas de entrada: a los lados del wordmark, que queda intacto. */
    [
      { x: -5.75, t: "MERCADO FRESCO", o: "HOY", p: "Frutas y verduras del día", c: "#3ddc84" },
      { x: 5.75,  t: "REFRIGERADOS",  o: "4 °C", p: "Lácteos, bebidas y refrigerios", c: "#5aa9ff" }
    ].forEach((a) => {
      const g = cartelPared(a.x, 1.70, LARGO / 2 - 0.05, Math.PI, 2.7, 1.6875,
        texturaAnuncio(a.t, a.o, a.p, a.c));
      g.name = "anuncio-entrada-" + a.t;
    });

    // tótems de oferta flanqueando la entrada
    TOTEMS.forEach((a) => {
      const g = new T.Group();
      g.name = "totem-" + a.t;
      g.position.set(a.x, 0, a.z);
      const pie = new T.Mesh(new T.CylinderGeometry(0.34, 0.42, 0.10, 16),
        new T.MeshLambertMaterial({ color: 0x14171a }));
      pie.position.y = 0.05;
      g.add(pie);
      const poste = new T.Mesh(new T.CylinderGeometry(0.035, 0.035, 1.9, 10),
        new T.MeshLambertMaterial({ color: 0x2a3036 }));
      poste.position.y = 0.95;
      g.add(poste);
      const panel = new T.Mesh(
        new T.PlaneGeometry(1.05, 1.35),
        new T.MeshBasicMaterial({
          map: texturaAnuncio(a.t, a.o, a.p, a.c), side: T.DoubleSide
        })
      );
      panel.position.y = 1.52;
      g.add(panel);
      scene.add(g);
    });
  }

  /* Señalización colgante de pasillo: un cartel por pasillo, a la altura de
     la vista y por encima de los productos, con la categoría real del mueble
     y su número. Es lo que hace que un local se lea como súper desde la
     entrada, y no solo de cerca. Dos caras por cartel (una por sentido de
     marcha) para que el texto nunca se vea espejado. */
  function crearSenalesPasillo() {
    if (!catsGondola.length) return;
    const poste = new T.MeshLambertMaterial({ color: 0x2a3036 });
    const varillas = [];
    for (let i = 0; i < GONDOLAS.length - 1; i++) {
      const x = (GONDOLAS[i] + GONDOLAS[i + 1]) / 2;
      const cat = catsGondola[i] || catsGondola[i + 1] || "Pasillo";
      const mat = new T.MeshBasicMaterial({
        map: texturaCartel(cat, i + 1), side: T.FrontSide
      });
      // 1024×256 = 4:1; el placo conserva esa proporción y cabe en el
      // pasillo (1,78 m entre caras) sin tocar los productos del nivel alto
      [0, Math.PI].forEach((ry, k) => {
        const m = new T.Mesh(new T.PlaneGeometry(1.52, 0.38), mat);
        m.name = "senal-" + cat;
        m.position.set(x, 2.90, k ? -0.012 : 0.012);
        m.rotation.y = ry;
        scene.add(m);
        senalesMallas++;
      });
      [-0.72, 0.72].forEach((dx) => varillas.push([x + dx, 0]));
    }
    if (varillas.length) {
      const im = new T.InstancedMesh(
        new T.BoxGeometry(0.03, 0.11, 0.03), poste, varillas.length
      );
      const m4 = new T.Matrix4();
      varillas.forEach((v, i) => {
        m4.makeTranslation(v[0], 3.145, v[1]);
        im.setMatrixAt(i, m4);
      });
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = false;
      scene.add(im);
    }
  }

  /* ── construcción ──────────────────────────────────────────────────────── */
  function construir(catalogo) {
    scene = new T.Scene();
    scene.background = new T.Color(0x08090a);
    scene.fog = new T.Fog(0xeef1f2, 30, 62);   // bruma clara: da fondo sin ensuciar
    refs = { piso: null, muro: [], techo: [], metal: [] };
    // los grupos LED viven dentro de la escena: al reconstruir quedan en
    // null y los vuelven a crear los bloques de techo, estante y decor
    grupoLED.techo = null; grupoLED.estante = null; grupoLED.decor = null;
    reflejoPiso = null; mallaLedEstante = null; mallaGlowEstante = null;
    mallasContacto = [];
    // si se reconstruye (otro local del mapa), todo lo anterior se descarta
    puertas = [];
    tv = null;
    luzTV = null;
    vuelos = [];
    mallasGondola = [];
    mallasCong = [];
    mallasProd = [];
    frescosMallas = 0;
    refriMallas = 0;
    frescosPilas = [];
    tapasGondola = [];
    luzFresca = null;
    decoErr = "";
    senalesMallas = 0;
    anunciosMallas = 0;

    camera = new T.PerspectiveCamera(fovBase, 1, 0.05, 90);

    /* ── Iluminación profesional ─────────────────────────────────────────
       Tres puntos adaptados al local: key cálida con sombra de contacto,
       relleno frío que levanta las sombras sin aplastarlas, y una
       contra-luz lima que separa los muebles del muro negro. El tono
       fino lo da el control de temperatura (kelvin) del panel. */
    const amb = new T.AmbientLight(0xfff8ef, 0.42);
    scene.add(amb);
    luces.amb = amb;

    const hemi = new T.HemisphereLight(0xfff8ef, 0x9aa0a4, 0.46);
    scene.add(hemi);
    luces.hemi = hemi;

    const sol = new T.DirectionalLight(0xfff8ef, 0.78);
    sol.position.set(6, 11, 8);
    sol.castShadow = true;
    sol.shadow.mapSize.set(2048, 2048);
    /* Ajustada al local (18 × 20 m): el mismo mapa de sombra rinde casi el
       doble de detalle que con el encuadre holgado anterior. */
    sol.shadow.camera.left = -10;
    sol.shadow.camera.right = 10;
    sol.shadow.camera.top = 11;
    sol.shadow.camera.bottom = -11;
    sol.shadow.camera.far = 30;
    sol.shadow.bias = -0.0006;
    sol.shadow.normalBias = 0.022;      // sin acné en las baldosas
    sol.shadow.radius = 2.5;
    scene.add(sol);
    luces.sol = sol;

    const relleno = new T.DirectionalLight(0xcfe0ff, 0.22);
    relleno.position.set(-9, 6, -5);
    scene.add(relleno);
    luces.relleno = relleno;

    const contra = new T.DirectionalLight(0xc8ff00, 0.16);
    contra.position.set(-2, 4.5, -12);
    scene.add(contra);
    luces.contra = contra;

    /* Puntos de techo repartidos en 3 columnas × 2 filas: cobren todo el
       piso sin apagar la key. Bajo cada luminario cae un halo radial y un
       cono de luz apenas visible (aditivo α 0,045): es lo que hace que la
       lámpara se "note" encendida en vez de ser un rectángulo blanco. */
    /* 4 luminarias reales (2×2). Ocho multiplicaban el coste por fragmento de
       todos los materiales sin aportar casi nada: el resto del techo ya lleva
       tiras y placas emisivas. */
    luces.puntos = [-4.5, 4.5].reduce((acc, x) => acc.concat([[x, -3.35], [x, 3.35]]), []).map(([x, z]) => {
      const p = new T.PointLight(0xffe6c4, 0.5, 16, 0);
      p.position.set(x, 2.9, z);
      scene.add(p);
      return p;
    });

    /* ── piso porcelánico + reflejos controlados ─────────────────────────
       Baldosa clara con juntas finas (texturaPiso) y un plano aditivo
       superpuesto que refleja las luminarias y las tiras LED: superficie
       reflectante sin efecto espejo y con un solo draw call más. */
    const piso = new T.Mesh(
      new T.PlaneGeometry(ANCHO, LARGO),
      new T.MeshPhongMaterial({
        color: 0xffffff, map: texturaPiso(), shininess: 64, specular: 0x4a4f54
      })
    );
    piso.rotation.x = -Math.PI / 2;
    piso.receiveShadow = true;
    scene.add(piso);
    refs.piso = piso.material;

    reflejoPiso = new T.Mesh(
      new T.PlaneGeometry(ANCHO, LARGO),
      new T.MeshBasicMaterial({
        map: texturaReflejo(), transparent: true, opacity: 0.22,
        depthWrite: false, blending: T.AdditiveBlending
      })
    );
    reflejoPiso.rotation.x = -Math.PI / 2;
    reflejoPiso.position.y = 0.004;

    /* ── techo industrial ────────────────────────────────────────────────
       Negro mate, perfiles lineales de aluminio a lo largo del local y
       tiras LED bajo cada perfil, junto a las luminarias. Todo lo emisivo
       queda en `grupoLED.techo`: es lo que apaga el interruptor «Techo». */
    const techo = new T.Mesh(
      new T.PlaneGeometry(ANCHO, LARGO),
      new T.MeshLambertMaterial({ color: 0xd6dade })
    );
    techo.rotation.x = Math.PI / 2;
    techo.position.y = ALTO;
    scene.add(techo);
    refs.techo.push({ mat: techo.material, rep: [3, 3.3], nor: 0.5 });

    grupoLED.techo = new T.Group();
    grupoLED.techo.add(reflejoPiso);         // el reflejo del piso sigue a las luces
    scene.add(grupoLED.techo);

    const perfilM = new T.MeshLambertMaterial({ color: 0xb9bec2 });
    const tiraTechoM = new T.MeshBasicMaterial({ color: 0xfff3c4 });
    [-8, -4, 0, 4, 8].forEach((x) => {
      const perfil = new T.Mesh(new T.BoxGeometry(0.12, 0.09, LARGO - 0.8), perfilM);
      perfil.position.set(x, ALTO - 0.1, 0);
      scene.add(perfil);
      const tira = new T.Mesh(new T.BoxGeometry(0.05, 0.02, LARGO - 1.6), tiraTechoM);
      tira.position.set(x, ALTO - 0.155, 0);
      grupoLED.techo.add(tira);
    });

    const panel = new T.MeshBasicMaterial({ color: 0xfff4de });
    const caseton = new T.MeshLambertMaterial({ color: 0xdfe3e5 });
    const geoHalo = new T.PlaneGeometry(2.1, 1.3);
    const glowM = new T.MeshBasicMaterial({
      map: texturaGlow(), transparent: true, opacity: 0.55, depthWrite: false,
      blending: T.AdditiveBlending, color: 0xffeedd
    });
    const geoCono = new T.CylinderGeometry(0.17, 1.2, ALTO - 0.3, 18, 1, true);
    const conoM = new T.MeshBasicMaterial({
      color: 0xffe6c4, transparent: true, opacity: 0.045, depthWrite: false,
      blending: T.AdditiveBlending, side: T.DoubleSide
    });
    [ -5, -1.7, 1.7, 5 ].forEach((z) => {
      [ -6, -2, 2, 6 ].forEach((x) => {
        // carcasa del luminario: estructura, se queda siempre
        const carc = new T.Mesh(new T.BoxGeometry(1.26, 0.12, 0.5), caseton);
        carc.position.set(x, ALTO - 0.06, z);
        scene.add(carc);
        // placa emisiva, resplandor y haz: se apagan con el grupo «techo»
        const l = new T.Mesh(new T.PlaneGeometry(1.1, 0.34), panel);
        l.rotation.x = Math.PI / 2;
        l.position.set(x, ALTO - 0.125, z);
        grupoLED.techo.add(l);
        const halo = new T.Mesh(geoHalo, glowM);
        halo.rotation.x = Math.PI / 2;
        halo.position.set(x, ALTO - 0.15, z);
        grupoLED.techo.add(halo);
        const cono = new T.Mesh(geoCono, conoM);
        cono.position.set(x, (ALTO - 0.3) / 2 + 0.05, z);
        grupoLED.techo.add(cono);
      });
    });

    // vigas negras cruzando el local (sin tocar los luminarios)
    const vigaM = new T.MeshLambertMaterial({ color: 0x0e1013 });
    [ -8, -4, 0, 4, 8 ].forEach((z) => {
      const v = new T.Mesh(new T.BoxGeometry(ANCHO, 0.12, 0.26), vigaM);
      v.position.set(0, ALTO - 0.05, z);
      scene.add(v);
    });

    /* Muros blancos arquitectónicos con paneles negros en las zonas que
       piden contraste: el fondo del wordmark y la cabecera del pasillo
       electrónico. Zócalo oscuro y franja lima (grupo «decor»): la marca
       sigue viva pero el local se ve luminoso, como un super de verdad. */
    /* Blanco roto en vez de blanco puro: con la luz del local, 0xffffff
       llegaba a 1,0 y perdía todo el detalle de las juntas del muro. */
    const pared = new T.MeshLambertMaterial({ color: 0xf4f1ea, map: texturaMuro() });
    const panelNegro = new T.MeshLambertMaterial({ color: 0x0a0b0c });
    const zocalo = new T.MeshLambertMaterial({ color: 0x171a1d });
    const franja = new T.MeshBasicMaterial({ color: 0xc8ff00 });
    grupoLED.decor = new T.Group();
    scene.add(grupoLED.decor);
    const muros = [
      [-ANCHO / 2, 0, Math.PI / 2, LARGO],
      [ ANCHO / 2, 0, -Math.PI / 2, LARGO],
      [0, -LARGO / 2, 0, ANCHO],
      [0,  LARGO / 2, Math.PI, ANCHO]
    ];
    // Un solo material para los cuatro muros: comparten textura y
    // repetición (5,5 × 1) y se ahorran tres cargas de mapa en la GPU.
    const matMuro = pared.clone();
    refs.muro.push({ mat: matMuro, rep: [5.5, 1], nor: 0.55 });
    muros.forEach(([x, z, ry, largo]) => {
      const m = new T.Mesh(new T.PlaneGeometry(largo, ALTO), matMuro);
      m.position.set(x, ALTO / 2, z); m.rotation.y = ry; m.receiveShadow = true; scene.add(m);
      const zk = new T.Mesh(new T.PlaneGeometry(largo, 0.22), zocalo);
      zk.position.set(x, 0.11, z);
      zk.rotation.y = ry;
      zk.translateZ(0.012);
      scene.add(zk);
      // franja luminosa lima a la altura del rótulo (elemento decorativo)
      const fr = new T.Mesh(new T.PlaneGeometry(largo, 0.05), franja);
      fr.position.set(x, 2.66, z);
      fr.rotation.y = ry;
      fr.translateZ(0.014);
      grupoLED.decor.add(fr);
    });

    // Panel negro detrás del wordmark: la marca (lima + blanca) necesita
    // fondo oscuro para leerse a distancia sobre el muro claro.
    const panelFondo = new T.Mesh(new T.PlaneGeometry(7.4, 2.15), panelNegro);
    panelFondo.position.set(0, 1.8, LARGO / 2 - 0.012);
    panelFondo.rotation.y = Math.PI;
    scene.add(panelFondo);

    // Panel negro tras el televisor: cabecera del pasillo electrónico.
    const panelTV = new T.Mesh(new T.PlaneGeometry(4.6, 2.7), panelNegro);
    panelTV.position.set(-ANCHO / 2 + 0.012, 2.05, -6.6);
    panelTV.rotation.y = Math.PI / 2;
    scene.add(panelTV);

    /* wordmark FORGE CORE STOCK sobre el panel del fondo, bajo la franja */
    const marca = new T.Mesh(
      new T.PlaneGeometry(6, 1.5),
      new T.MeshBasicMaterial({ map: texturaMarca(), transparent: true, side: T.DoubleSide })
    );
    marca.position.set(0, 1.85, LARGO / 2 - 0.02);
    marca.rotation.y = Math.PI;
    grupoLED.decor.add(marca);

    /* góndolas: una categoría por mueble */
    const cats = [...new Set(catalogo.map((p) => p.categoria).filter(Boolean))];
    const porGondola = cats.length ? cats.slice(0, GONDOLAS.length) : ["Pasillo"];
    // el plano reparte las mismas categorías que la escena
    catsGondola = porGondola.slice();
    destino = null;
    camSolo = null;
    /* ── góndolas: mobiliario comercial, no cajas geométricas ─────────────
       Repisas y divisiones blancas, testeros (laterales) y zócalo verde
       lima, y tiras LED FÍSICAS bajo el filo frontal de cada repisa, en los
       dos lados, con su halo de difusión: geometría emisiva integrada en el
       mueble, no una línea flotando delante del estante. Las 48 tiras y los
       48 halos van en dos InstancedMesh = 2 draw calls. */
    /* Sombra de contacto (se usa en góndolas y neveras): se declara antes
       del primer uso para no caer en la zona muerta de `const`. */
    const texturaSombra = texturaContacto();
    const contacto = new T.MeshBasicMaterial({
      map: texturaSombra, transparent: true, opacity: 0.85,
      depthWrite: false
    });

    const metal = new T.MeshLambertMaterial({ color: 0xf3f5f6 });    // repisas blancas
    const borde = new T.MeshLambertMaterial({ color: 0xdfe3e5 });    // divisiones
    const testero = new T.MeshLambertMaterial({ color: 0xc8ff00 });  // laterales lima
    const zocaloG = new T.MeshLambertMaterial({ color: 0xc8ff00 });  // zócalo verde
    const riel = new T.MeshLambertMaterial({ color: 0xf7f8f9 });     // filo blanco
    refs.metal.push({ mat: metal, rep: [1.5, 1.5], nor: 0.4 });
    refs.metal.push({ mat: borde, rep: [1.5, 1.5], nor: 0.4 });

    grupoLED.estante = new T.Group();
    scene.add(grupoLED.estante);
    const nLed = GONDOLAS.length * NIVELES.length * 2;
    mallaLedEstante = new T.InstancedMesh(
      new T.BoxGeometry(0.03, 0.014, G_LARGO - 0.12),
      new T.MeshBasicMaterial({ color: 0xfff8ea }), nLed
    );
    mallaGlowEstante = new T.InstancedMesh(
      new T.PlaneGeometry(G_LARGO - 0.12, 0.17),
      new T.MeshBasicMaterial({
        map: texturaBajadaLED(), transparent: true, opacity: 0.62,
        depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide
      }), nLed
    );
    mallaLedEstante.frustumCulled = false;
    mallaGlowEstante.frustumCulled = false;
    grupoLED.estante.add(mallaLedEstante, mallaGlowEstante);

    GONDOLAS.forEach((gx, gi) => {
      const cat = porGondola[gi % porGondola.length];
      const grupo = new T.Group();

      // testeros: los laterales del mueble, en lima
      [-G_LARGO / 2, G_LARGO / 2].forEach((z) => {
        const p = new T.Mesh(new T.BoxGeometry(G_ANCHO, 2.55, 0.06), testero);
        p.position.set(gx, 1.27, z);
        p.castShadow = true;
        grupo.add(p);
        // filete blanco rematando el testero: separa el verde del fondo
        const rem = new T.Mesh(new T.BoxGeometry(G_ANCHO + 0.03, 0.05, 0.08), riel);
        rem.position.set(gx, 2.545, z);
        grupo.add(rem);
      });
      // sombra de contacto bajo el mueble: lo asienta en el porcelanato
      const sombraG = new T.Mesh(
        new T.PlaneGeometry(G_ANCHO + 0.7, G_LARGO + 0.5), contacto
      );
      sombraG.rotation.x = -Math.PI / 2;
      sombraG.position.set(gx, 0.008, 0);
      grupo.add(sombraG);
      mallasContacto.push(sombraG);

      // zócalo verde: el mueble se apoya en el piso con su base de marca
      const base = new T.Mesh(new T.BoxGeometry(G_ANCHO + 0.04, 0.16, G_LARGO + 0.04), zocaloG);
      base.position.set(gx, 0.08, 0);
      base.castShadow = true;
      grupo.add(base);

      NIVELES.forEach((y) => {
        const tabla = new T.Mesh(new T.BoxGeometry(G_ANCHO, 0.05, G_LARGO), metal);
        tabla.position.set(gx, y, 0);
        tabla.castShadow = true;
        tabla.receiveShadow = true;
        grupo.add(tabla);
        const filo = new T.Mesh(new T.BoxGeometry(G_ANCHO, 0.016, G_LARGO), riel);
        filo.position.set(gx, y - 0.03, 0);
        grupo.add(filo);
      });

      // letreros de pasillo colgados en los dos extremos, con sus varillas.
      // Quedan a 1 m del filo para que las varillas no atraviesen las
      // carcasas de luz (que viven en z = ±5 y ±1,7).
      [-1, 1].forEach((sentido) => {
        const cg = new T.Group();
        cg.position.set(gx, 2.78, sentido * (G_LARGO / 2 + 1));
        const cartel = new T.Mesh(
          new T.PlaneGeometry(2.34, 0.58),
          new T.MeshBasicMaterial({ map: texturaCartel(cat, gi + 1), side: T.DoubleSide })
        );
        cg.add(cartel);
        [-0.6, 0.6].forEach((vx) => {           // varillas hasta el techo
          const v = new T.Mesh(new T.CylinderGeometry(0.013, 0.013, 0.2), metal);
          v.position.set(vx, 0.32, 0);
          cg.add(v);
        });
        grupo.add(cg);
      });

      // (la tira de precios se dibuja junto al producto, en el bloque siguiente)

      scene.add(grupo);
    });

    /* Matrices de las tiras LED: una por repisa y por lado, colocadas bajo
       el filo frontal. El halo va en el mismo índice, ligeramente afuera y
       apuntando hacia el pasillo, para que la luz "baje" del estante. */
    {
      const m4l = new T.Matrix4(), ql = new T.Quaternion(), escL = new T.Vector3(1, 1, 1);
      const eu = new T.Euler();
      let li = 0;
      GONDOLAS.forEach((gx) => {
        NIVELES.forEach((y) => {
          [1, -1].forEach((s) => {
            m4l.compose(
              new T.Vector3(gx + s * (G_ANCHO / 2 - 0.03), y - 0.037, 0), ql, escL
            );
            mallaLedEstante.setMatrixAt(li, m4l);

            eu.set(0, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
            ql.setFromEuler(eu);
            m4l.compose(
              new T.Vector3(gx + s * (G_ANCHO / 2 + 0.014), y - 0.062, 0), ql, escL
            );
            mallaGlowEstante.setMatrixAt(li, m4l);
            ql.set(0, 0, 0, 1);
            li++;
          });
        });
      });
      mallaLedEstante.instanceMatrix.needsUpdate = true;
      mallaGlowEstante.instanceMatrix.needsUpdate = true;
    }

    /* ── productos: una portada por nivel de góndola ──────────────────────
       Cada estante almacena un solo SKU (planograma real): las 24 caras
       llevan su propia portada dibujada y una tira con el precio en
       grande. Una InstancedMesh por nivel = 24 dibujados y raycast
       directo contra su `userData.mapa`. */
    /* 0,44 m entre caras: el envase mide 0,17 y quedan 0,27 de aire, así la
       carátula de cada producto se lee sin quedar pegada a la del vecino.
       Antes eran 0,31 (48 productos por nivel); ahora son ~34. */
    const paso = 0.44;
    const porFila = Math.floor(G_LARGO / paso) - 1;
    mallasGondola = [];
    mallasCong = [];

    const m4 = new T.Matrix4();
    const q = new T.Quaternion();
    const esc = new T.Vector3();
    const EJE_Y = new T.Vector3(0, 1, 0);

    GONDOLAS.forEach((gx, gi) => {
      const cat = porGondola[gi % porGondola.length];
      const lista = catalogo.filter((p) => p.categoria === cat);
      const bolsa = (lista.length ? lista : catalogo).length
        ? (lista.length ? lista : catalogo)
        : [{ nombre: "Producto", precio: 0, categoria: cat }];

      NIVELES.forEach((y, ni) => {
        const p = bolsa[(gi * NIVELES.length + ni) % bolsa.length];
        const forma = formaDe(p);
        const tam = TAMANO[forma] || TAMANO.caja;

        const caras = [];
        [1, -1].forEach((lado) => {
          for (let c = 0; c < porFila; c++) {
            if (c % 7 === 6) continue;      // un hueco cada 7: bloques de 6
            caras.push({ lado: lado, c: c });
          }
        });

        /* Dos SKU por estante, siempre de la misma familia: el cuerpo es una
           sola InstancedMesh con color por instancia y cada SKU lleva su
           propia etiqueta. Así la góndola se lee como un súper real y no
           como una pared de cajas repetidas. */
        const mismaFam = bolsa.filter((x) => formaDe(x) === forma);
        const p2 = mismaFam.length > 1
          ? mismaFam[(gi * NIVELES.length + ni + 1) % mismaFam.length] : p;
        const mitad = porFila / 2;
        const esA = (d) => d.c < mitad;

        const filas = caras.map((d, i) => {
          /* Irregularidad de reposición: ±5,6 % de tamaño, alguno metido
             5 cm más adentro (como si lo hubieran devuelto a la repisa) y un
             giro mínimo. Sin esto la repisa es una fila de soldaditos y por
             eso todos los productos "se ven iguales". */
          const var_ = 1 + (((i * 7 + d.c) % 9) - 4) * 0.014;
          const alto = tam.alto * var_;
          const ancho = tam.ancho * (1 + ((i + ni) % 3) * 0.018);
          const fondo = tam.fondo * var_;
          const atras = ((i * 5 + d.c) % 11 === 0) ? 0.05 : 0;
          const x = gx + d.lado * (G_ANCHO / 2 - 0.09 - atras);
          const z = -G_LARGO / 2 + 0.6 + d.c * paso + (((i * 3 + d.c) % 7) - 3) * 0.004;
          const cy = y + alto / 2 + 0.03;
          // el +Z del envase mira al pasillo, con un giro mínimo de reposición
          q.setFromAxisAngle(EJE_Y, (d.lado > 0 ? Math.PI / 2 : -Math.PI / 2) +
            (((i + ni) % 5) - 2) * 0.022);
          const m = new T.Matrix4().compose(
            new T.Vector3(x, cy, z), q, esc.set(ancho, alto, fondo / tam.fondoGeo)
          );
          return { m: m, d: d, cy: cy, alto: alto };
        });

        /* Cuerpo: geometría propia de la familia (botella torneada, lata con
           rebordes, caja de cartón redondeada, bolsa con pliegues…). */
        const mesh = new T.InstancedMesh(
          geoForma(forma), matForma(forma, p, true), Math.max(1, caras.length)
        );
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const tmpCol = new T.Color();
        filas.forEach((it, i) => {
          mesh.setMatrixAt(i, it.m);
          tmpCol.set(colorDe(esA(it.d) ? p : p2));
          mesh.setColorAt(i, tmpCol);
        });
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.count = caras.length;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.userData.mapa = caras.map((d) => (esA(d) ? p : p2));
        scene.add(mesh);
        mallasGondola.push(mesh);

        /* Tapa: el remate de rosca de botellas, frascos y potes. Va en una
           malla aparte porque cambia de color según el envase. */
        const gt = geoTapa(forma);
        if (gt) {
          const tapas = new T.InstancedMesh(gt, new T.MeshPhongMaterial({
            color: 0xffffff, shininess: 80, specular: 0x2a2a2a
          }), Math.max(1, caras.length));
          filas.forEach((it, i) => {
            const mc = it.m.clone();
            mc.elements[13] = it.cy + it.alto * 0.55;
            tapas.setMatrixAt(i, mc);
            tmpCol.set(luminancia(colorDe(esA(it.d) ? p : p2)) > 0.62 ? 0x1d2124 : 0xf2f4f5);
            tapas.setColorAt(i, tmpCol);
          });
          if (tapas.instanceColor) tapas.instanceColor.needsUpdate = true;
          tapas.count = caras.length;
          tapas.instanceMatrix.needsUpdate = true;
          tapas.castShadow = true;
          tapas.userData.mapa = mesh.userData.mapa;
          scene.add(tapas);
          tapasGondola.push(tapas);
        }

        /* Etiqueta: malla aparte, mirando al pasillo. Banda curva en los
           envases redondos y plano en cajas y bolsas. */
        [
          { prod: p, lista: caras.filter(esA) },
          { prod: p2, lista: caras.filter((d) => !esA(d)) }
        ].forEach((sku) => {
          if (!sku.lista.length) return;
          const me = new T.InstancedMesh(
            geoEtiqueta(forma),
            new T.MeshLambertMaterial({ map: texturaEtiqueta(sku.prod, 256) }),
            sku.lista.length
          );
          sku.lista.forEach((d, j) => {
            me.setMatrixAt(j, matEtiqueta(forma, filas[caras.indexOf(d)].m, tam.fondo));
          });
          me.count = sku.lista.length;
          me.instanceMatrix.needsUpdate = true;
          me.castShadow = false;
          me.receiveShadow = false;
          me.userData.mapa = sku.lista.map(() => sku.prod);
          scene.add(me);
        });

        // tira del estante: etiquetas chicas repetidas, como en un súper
        const matTira = new T.MeshBasicMaterial({
          map: texturaTira([p, p2], 3072, 64), side: T.DoubleSide
        });
        [1, -1].forEach((lado) => {
          const tira = new T.Mesh(new T.PlaneGeometry(G_LARGO - 0.14, 0.14), matTira);
          tira.position.set(gx + lado * (G_ANCHO / 2 + 0.013), y - 0.10, 0);
          tira.rotation.y = lado > 0 ? Math.PI / 2 : -Math.PI / 2;
          scene.add(tira);
        });
      });
    });
    mallasProd = mallasGondola.slice();   // se completa al final con las neveras

    /* ── Neveras: 2,45 m, vidrio traslúcido y 4 estantes ──────────────────
       Cada estante tiene su gama de productos y su propia tira de precios;
       el vidrio deja ver el interior iluminado por el LED del techo. */
    const marco = new T.MeshLambertMaterial({ color: 0x23272c });
    const repisa = new T.MeshLambertMaterial({ color: 0x3a424a });
    refs.metal.push({ mat: marco, rep: [1.5, 1.5], nor: 0.5 });
    refs.metal.push({ mat: repisa, rep: [1.5, 1.5], nor: 0.5 });
    const respaldo = new T.MeshLambertMaterial({ color: 0x1a222a, emissive: 0x0d1b24 });
    const ledM = new T.MeshBasicMaterial({ color: 0xe6f7ff });
    const limaM = new T.MeshLambertMaterial({ color: 0xc8ff00 });
    const franjaFreezer = new T.MeshBasicMaterial({ color: 0xc8ff00 });
    const vidrio = new T.MeshPhongMaterial({
      color: 0xd9f1ff, transparent: true, opacity: 0.16,
      shininess: 170, specular: 0xffffff, side: T.DoubleSide, depthWrite: false
    });

    // Cada estante con su serie distinta de productos congelados.
    const CONG_NIVELES = [
      [ // abajo: congelados de cocina
        { nombre: "Pizza familiar", precio: 5990, tipo: "caja" },
        { nombre: "Lasaña 400 g", precio: 4990, tipo: "caja" },
        { nombre: "Empanadas x6", precio: 3490, tipo: "caja" },
        { nombre: "Papas fritas", precio: 2690, tipo: "bolsa" },
        { nombre: "Coliflor 500 g", precio: 1290, tipo: "bolsa" },
        { nombre: "Choclo duro", precio: 1490, tipo: "bolsa" }
      ],
      [ // helados
        { nombre: "Helado 1 L", precio: 4590, tipo: "tubo" },
        { nombre: "Copa vainilla", precio: 2990, tipo: "tubo" },
        { nombre: "Paleta fruta", precio: 990, tipo: "tubo" },
        { nombre: "Torta helada", precio: 8990, tipo: "caja" },
        { nombre: "Sorbete limón", precio: 3890, tipo: "tubo" },
        { nombre: "Chipá helado", precio: 2490, tipo: "tubo" }
      ],
      [ // a la altura de los ojos: bebidas y yogures
        { nombre: "Agua 600 ml", precio: 1290, tipo: "botella" },
        { nombre: "Yogur bebible", precio: 1890, tipo: "botella" },
        { nombre: "Jugo 1 L", precio: 2490, tipo: "botella" },
        { nombre: "Leche 1 L", precio: 1790, tipo: "botella" },
        { nombre: "Té frío 1,5 L", precio: 2190, tipo: "botella" },
        { nombre: "Kéfir 1 L", precio: 2390, tipo: "botella" }
      ],
      [ // arriba: postres
        { nombre: "Tarta manzana", precio: 3990, tipo: "caja" },
        { nombre: "Brownie 300 g", precio: 2890, tipo: "caja" },
        { nombre: "Croissant", precio: 1790, tipo: "bolsa" },
        { nombre: "Muffins x4", precio: 3290, tipo: "caja" },
        { nombre: "Pan masa madre", precio: 1990, tipo: "bolsa" },
        { nombre: "Flan familiar", precio: 2790, tipo: "tubo" }
      ]
    ];
    const NIV_CONG = [0.45, 0.95, 1.45, 1.98];
    const H_CONG = 2.45, W_CONG = 2.4, D_CONG = 1.05;

    // una tira por estante, compartida por las 7 neveras
    const tirasCong = CONG_NIVELES.map((n) => texturaTira(n, 1536, 128));

    const UP = new T.Vector3(0, 1, 0);
    // sombra de contacto: mancha suave bajo el mueble, como en un local real

    function crearCongelador(cx, cz, rotY) {
      const g = new T.Group();
      g.position.set(cx, 0, cz);
      if (rotY) g.rotation.y = rotY;

      const caja = (w, h, d, x, y, z, mat, sinSombra) => {
        const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
        m.position.set(x, y, z);
        m.castShadow = !sinSombra;
        m.receiveShadow = true;
        g.add(m);
        return m;
      };

      // carcasa hueca: trasera, laterales, techo y base (el frente es vidrio)
      caja(W_CONG, H_CONG, 0.07, 0, H_CONG / 2, -D_CONG / 2, marco);
      caja(0.08, H_CONG, D_CONG, -W_CONG / 2 + 0.04, H_CONG / 2, 0, marco);
      caja(0.08, H_CONG, D_CONG,  W_CONG / 2 - 0.04, H_CONG / 2, 0, marco);
      caja(W_CONG, 0.1, D_CONG, 0, H_CONG - 0.05, 0, marco);
      caja(W_CONG, 0.18, D_CONG, 0, 0.09, 0, marco);

      // marco del frente + franja lima de marca
      caja(0.1, H_CONG, 0.09, -W_CONG / 2 + 0.05, H_CONG / 2, D_CONG / 2, marco);
      caja(0.1, H_CONG, 0.09,  W_CONG / 2 - 0.05, H_CONG / 2, D_CONG / 2, marco);
      caja(W_CONG, 0.24, 0.09, 0, H_CONG - 0.12, D_CONG / 2, marco);
      caja(W_CONG, 0.18, 0.09, 0, 0.09, D_CONG / 2, marco);
      caja(W_CONG - 0.16, 0.05, 0.02, 0, H_CONG - 0.27, D_CONG / 2 + 0.046, franjaFreezer, true);

      // interior: respaldo y LED del techo (la nevera está encendida)
      const resp = new T.Mesh(new T.PlaneGeometry(W_CONG - 0.2, H_CONG - 0.34), respaldo);
      resp.position.set(0, H_CONG / 2, -D_CONG / 2 + 0.06);
      g.add(resp);
      const led = new T.Mesh(new T.PlaneGeometry(W_CONG - 0.5, 0.16), ledM);
      led.rotation.x = Math.PI / 2;
      led.position.set(0, H_CONG - 0.18, -0.06);
      g.add(led);

      const sombraPiso = new T.Mesh(
        new T.PlaneGeometry(W_CONG + 0.4, D_CONG + 0.6), contacto
      );
      sombraPiso.rotation.x = -Math.PI / 2;
      sombraPiso.position.set(0, 0.012, 0.12);
      g.add(sombraPiso);
      mallasContacto.push(sombraPiso);

      // 4 estantes: repisa + tira de precios (los productos van aparte,
      // compartidos por las 7 neveras)
      CONG_NIVELES.forEach((items, ni) => {
        const sy = NIV_CONG[ni];
        caja(W_CONG - 0.2, 0.045, D_CONG - 0.16, 0, sy, -0.02, repisa);

        const tira = new T.Mesh(
          new T.PlaneGeometry(W_CONG - 0.24, 0.18),
          new T.MeshBasicMaterial({ map: tirasCong[ni], side: T.DoubleSide })
        );
        tira.position.set(0, sy - 0.075, D_CONG / 2 - 0.08);
        g.add(tira);
      });

      // puertas de vidrio corredizas: una fija y una que corre por delante
      [-0.56, 0.56].forEach((hx, hi) => {
        const hoja = new T.Group();
        const cristal = new T.Mesh(new T.PlaneGeometry(1.14, H_CONG - 0.5), vidrio);
        cristal.position.y = H_CONG / 2;
        hoja.add(cristal);
        [-0.57, 0.57].forEach((bx) => {
          const barra = new T.Mesh(new T.BoxGeometry(0.05, H_CONG - 0.5, 0.045), marco);
          barra.position.set(bx, H_CONG / 2, 0);
          barra.castShadow = true;
          hoja.add(barra);
        });
        const manilla = new T.Mesh(new T.BoxGeometry(0.04, 0.4, 0.05), limaM);
        manilla.position.set(hi === 0 ? 0.5 : -0.5, H_CONG * 0.52, 0.04);
        hoja.add(manilla);
        hoja.position.set(hx, 0, D_CONG / 2 + 0.055);
        // la puerta corre en el eje X delante del mueble
        hoja.userData = { min: -0.56, max: 0.56 };
        g.add(hoja);
        puertas.push(hoja);
      });

      scene.add(g);
      return g;
    }

    // Pasillo largo de congeladores en la pared del fondo (miran a la tienda).
    const CONG_X = [-7.65, -5.1, -2.55, 0, 2.55, 5.1, 7.65];
    CONG_X.forEach((cx) => crearCongelador(cx, -LARGO / 2 + 0.55, 0));

    /* Productos de nevera: misma familia geométrica y misma etiqueta que la
       góndola, pero construidos UNA vez para las 7 neveras con matrices de
       mundo. Así las 84 unidades del nivel cuestan un puñado de draw calls
       en vez de repetir el mueble entero. */
    (function crearProductosCongelados() {
      const cz = -LARGO / 2 + 0.55;
      const cuerpos = new Map();     // forma → matrices + productos
      const etiquetas = new Map();   // nombre → matrices + producto

      CONG_NIVELES.forEach((items, ni) => {
        const sy = NIV_CONG[ni];
        items.forEach((it, k) => {
          const prod = {
            id: "cong-" + ni + "-" + k, nombre: it.nombre,
            categoria: "Congelados", precio: it.precio,
            stock: 8 + ((ni * 7 + k * 5) % 26)
          };
          const forma = formaDe(prod);
          const tam = TAMANO[forma] || TAMANO.caja;
          [0.2, -0.12].forEach((z, fila) => {
            const giro = new T.Quaternion().setFromAxisAngle(UP, (((k + fila) % 3) - 1) * 0.10);
            CONG_X.forEach((cx) => {
              const m = new T.Matrix4().compose(
                new T.Vector3(cx - 0.92 + k * 0.368 + (fila ? 0.05 : 0),
                  sy + 0.03 + tam.alto / 2, cz + z),
                giro,
                new T.Vector3(tam.ancho, tam.alto, tam.fondo / tam.fondoGeo)
              );
              const c = cuerpos.get(forma) || { mats: [], prods: [] };
              c.mats.push(m); c.prods.push(prod);
              cuerpos.set(forma, c);
              const e = etiquetas.get(prod.nombre) || { mats: [], prod: prod };
              e.mats.push(m);
              etiquetas.set(prod.nombre, e);
            });
          });
        });
      });

      const tmpC = new T.Color();
      cuerpos.forEach((c, forma) => {
        const mesh = new T.InstancedMesh(
          geoForma(forma), matForma(forma, c.prods[0], true), c.mats.length
        );
        c.mats.forEach((m, i) => {
          mesh.setMatrixAt(i, m);
          tmpC.set(colorDe(c.prods[i]));
          mesh.setColorAt(i, tmpC);
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        mesh.userData.mapa = c.prods;
        scene.add(mesh);
        mallasCong.push(mesh);
      });

      etiquetas.forEach((e) => {
        const forma = formaDe(e.prod);
        const mesh = new T.InstancedMesh(
          geoEtiqueta(forma),
          new T.MeshLambertMaterial({ map: texturaEtiqueta(e.prod, 192) }),
          e.mats.length
        );
        const f = (TAMANO[forma] || TAMANO.caja).fondo;
        e.mats.forEach((m, i) => mesh.setMatrixAt(i, matEtiqueta(forma, m, f)));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
        mesh.userData.mapa = e.mats.map(() => e.prod);
        scene.add(mesh);
        mallasCong.push(mesh);
      });
    })();

    /* televisor en la esquina del fondo, con su herraje de pared */
    const tvGrupo = new T.Group();
    /* Antes iba girada 0,55 rad y pegada al muro: su mitad de 1,15 m se hundía
       en la pared y la pantalla salía recortada. Ahora se separa 0,50 m del
       muro y gira sólo 0,38 rad, con el brazo apoyado en el muro. La mitad
       más cercana queda a x≈-8,87 (muro en -9): nunca lo atraviesa. */
    tvGrupo.position.set(-ANCHO / 2 + 0.50, 2.22, -6.6);
    tvGrupo.scale.setScalar(1.0);
    tvGrupo.rotation.y = Math.PI / 2 - 0.38;

    tv = crearTV();
    tv.position.set(0.09, 0, 0.06);
    tvGrupo.add(tv);

    const negro = new T.MeshLambertMaterial({ color: 0x14171a });
    const metalTV = new T.MeshLambertMaterial({ color: 0x4a5056 });
    const marcoTV = new T.Mesh(new T.BoxGeometry(2.12, 1.24, 0.07), negro);
    marcoTV.position.set(0.09, 0, 0.02);
    tvGrupo.add(marcoTV);
    // brazo y placa: van hacia -z local, que con este giro apunta al muro
    const brazo = new T.Mesh(new T.BoxGeometry(0.06, 0.06, 0.46), metalTV);
    brazo.position.set(0.09, 0, -0.21);
    tvGrupo.add(brazo);
    const placa = new T.Mesh(new T.BoxGeometry(0.34, 0.34, 0.04), metalTV);
    placa.position.set(0.09, 0, -0.44);
    tvGrupo.add(placa);
    const cable = new T.Mesh(new T.BoxGeometry(0.03, 0.9, 0.03), negro);
    cable.position.set(-0.02, 0.55, -0.2);
    tvGrupo.add(cable);
    scene.add(tvGrupo);
    tvGrupoRef = tvGrupo;

    // resplandor verde del televisor sobre el pasillo
    luzTV = new T.PointLight(0xd9ffa8, 0.55, 5.5, 2);
    luzTV.position.set(-8.05, 2.3, -6.6);
    scene.add(luzTV);

    /* cámaras de seguridad en las esquinas (la del TV no) */
    const camMetal = new T.MeshLambertMaterial({ color: 0xe8ecef });
    const camLente = new T.MeshLambertMaterial({ color: 0x1b1f23 });
    const led = new T.MeshBasicMaterial({ color: 0xff3b30 });
    [[1, -1], [1, 1], [-1, 1]].forEach(([sx, sz]) => {
      const g = new T.Group();
      g.position.set(sx * (ANCHO / 2 - 0.22), 2.92, sz * (LARGO / 2 - 0.22));
      g.rotation.y = Math.atan2(-sx, -sz);
      const cuerpo = new T.Mesh(new T.BoxGeometry(0.16, 0.12, 0.3), camMetal);
      cuerpo.rotation.x = 0.35;
      g.add(cuerpo);
      const lente = new T.Mesh(new T.CylinderGeometry(0.045, 0.045, 0.04, 12), camLente);
      lente.rotation.x = Math.PI / 2 + 0.35;
      lente.position.set(0, -0.03, 0.17);
      g.add(lente);
      const punto = new T.Mesh(new T.SphereGeometry(0.014, 6, 6), led);
      punto.position.set(0.05, 0.04, 0.13);
      g.add(punto);
      scene.add(g);
    });

    promos = catalogo.slice(0, 8);
    promoT0 = Date.now();
    pintarTV();
    clearInterval(promoReloj);
    promoReloj = setInterval(() => {
      if (!vivo) return;
      siguientePromo();
    }, 4000);
    clearInterval(tvReloj);
    tvReloj = setInterval(() => { if (vivo) pintarTV(); }, 1000);

    /* Zona fresca de entrada: islas de verdura, islas refrigeradas y los
       anuncios. Va en su propio try/catch por pieza: si una sale mal, la
       tienda sigue abriendo con góndolas y neveras y el fallo queda en
       `__t3d().decoErr` en vez de dejar la escena a medias. */
    const deco = [crearZonaFresca, crearAnuncios, crearSenalesPasillo]
      .concat(REFRIGERADOS.map((cfg) => () => crearIslaRefri(cfg)));
    deco.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        if (!decoErr) decoErr = String((e && e.message) || e).slice(0, 120);
        if (window.console && console.warn) console.warn("decorado 3D:", e);
      }
    });

    carrito = crearCarrito();
    carrito.scale.setScalar(1.05);
    /* El carrito nace en un hueco libre: antes aparecía dentro de la isla
       central de verduras. */
    const hueco = huecoCarrito();
    carrito.position.set(hueco.x, 0, hueco.z);
    carrito.rotation.y = yaw;
    scene.add(carrito);

    crearCamaras();
    aplicarLEDs();

    mallasProd = mallasGondola.concat(mallasCong, mallasProd);
    ajustarZonaFresca();
    raycaster = new T.Raycaster();
    puntero = new T.Vector2();
    reloj = new T.Clock();
  }

  /* Temperatura de color (aprox. Tanner Helland): 2700 K cálida → 6500 K fría */
  function kelvinRGB(k) {
    const t = Math.max(100, Math.min(40000, k)) / 100;
    let r, g, b;
    if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; }
    else {
      r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
      g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    }
    if (t >= 66) b = 255;
    else if (t <= 19) b = 0;
    else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    const c = (v) => Math.max(0, Math.min(255, v)) / 255;
    return { r: c(r), g: c(g), b: c(b) };
  }

  function aplicarLuz() {
    if (!T || !luces.sol) return;
    const c = LUCES[luzActual] || LUCES.confort;
    const kv = kelvinRGB(kelvinLuz);
    const tinte = new T.Color(kv.r, kv.g, kv.b);
    // sombra 0 % = relleno lleno (plano); sombra 100 % = contraste marcado
    const relleno = 1 - sombraLuz * 0.6;

    /* Los interruptores LED modulan la luz real, no sólo la geometría:
       «Ambiente» atenúa ambient + hemisphere; «Techo» apaga los puntos de
       luminaria y baja la key, que es la que simula la luz del local. */
    const kAmb = leds.ambiental ? 1 : 0.16;
    const kTecho = leds.techo ? 1 : 0.14;

    if (luces.amb) luces.amb.intensity = c.amb * intensidadLuz * (0.55 + 0.45 * relleno) * kAmb;
    if (luces.hemi) luces.hemi.intensity = c.hemi * intensidadLuz * (0.45 + 0.55 * relleno) * kAmb;

    luces.sol.intensity = c.dir * intensidadLuz * (0.5 + 0.5 * kTecho);
    luces.sol.color.setHex(c.color).lerp(tinte, 0.6);
    const a = (orbitaLuz * Math.PI) / 180;
    luces.sol.position.set(Math.cos(a) * 10, 11, Math.sin(a) * 10);
    luces.sol.shadow.normalBias = 0.012 + (1 - sombraLuz) * 0.02;

    if (luces.relleno) {
      luces.relleno.intensity = c.rell * intensidadLuz * (0.4 + 0.6 * relleno) * (0.45 + 0.55 * kAmb);
      luces.relleno.color.setHex(0xcfe0ff).lerp(tinte, 0.35);
    }
    if (luces.contra) {
      luces.contra.intensity = (luzActual === "lima" ? 0.44 : 0.16) * intensidadLuz;
    }
    luces.puntos.forEach((p) => {
      p.intensity = 0.5 * intensidadLuz * (0.6 + 0.4 * relleno) * kTecho;
      p.color.setHex(0xffe6c4).lerp(tinte, 0.55);
    });

    if (luzTV) luzTV.intensity = 0.55 * intensidadLuz * (luzActual === "cine" ? 1.45 : 1);

    if (renderer) {
      renderer.toneMappingExposure = c.exp * (0.9 + intensidadLuz * 0.14) *
        (leds.ambiental ? 1 : 0.86);
    }

    const d = $("t3dLuzDesc");
    if (d) d.textContent = c.desc;
    const iv = $("t3dIntVal"), ov = $("t3dOrbVal"), kv2 = $("t3dKelVal"), sv = $("t3dSomVal");
    if (iv) iv.textContent = Math.round(intensidadLuz * 100) + " %";
    if (ov) ov.textContent = Math.round(orbitaLuz) + "°";
    if (kv2) kv2.textContent = Math.round(kelvinLuz).toLocaleString("es-CL") + " K";
    if (sv) sv.textContent = Math.round(sombraLuz * 100) + " %";
  }

  /* Enciende o apaga los cuatro grupos LED de la escena y refleja el
     estado en el panel (clase `on` + aria-pressed). Se llama al construir
     y desde cada interruptor. */
  function aplicarLEDs() {
    if (grupoLED.techo) grupoLED.techo.visible = leds.techo;
    if (grupoLED.estante) grupoLED.estante.visible = leds.estante;
    if (grupoLED.decor) grupoLED.decor.visible = leds.decor;
    aplicarLuz();
    document.querySelectorAll("#t3dLeds [data-led]").forEach((b) => {
      const on = !!leds[b.dataset.led];
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    });
  }

  /* ── Calidad por dispositivo ─────────────────────────────────────────────
     El perfil se detecta una vez (memoria, núcleos y GPU) y el usuario
     puede forzar un nivel. Afecta píxeles, sombra y puntos de techo. */
  function detectarPerfil() {
    const mem = navigator.deviceMemory || 4;
    const cores = navigator.hardwareConcurrency || 4;
    let gpu = "";
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2") || c.getContext("webgl");
      const dbg = gl && gl.getExtension("WEBGL_debug_renderer_info");
      if (dbg) gpu = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "");
    } catch (e) { /* sin datos */ }
    const movil = /android|iphone|ipad|mobile/i.test(navigator.userAgent || "") ||
      /adreno|mali-|powervr|videocore|apple gpu/i.test(gpu);
    if (mem <= 2 || cores <= 2) return "baja";
    if (!movil && mem >= 8 && cores >= 8) return "alta";
    if (movil && mem >= 8 && /adreno 7|mali-g7|apple gpu/i.test(gpu)) return "alta";
    if (mem <= 3) return "baja";
    return "media";
  }

  function aplicarCalidad() {
    if (!renderer || !luces.sol) return;
    const nivel = calidad === "auto" ? perfil : calidad;
    const q = NIVELES_CALIDAD[nivel] || NIVELES_CALIDAD.media;
    renderer.setPixelRatio(Math.min(q.pr, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = !!q.sombras;
    renderer.shadowMap.needsUpdate = !!q.sombras;
    const sh = luces.sol.shadow;
    if (sh.mapSize.x !== q.sombra) {
      sh.mapSize.set(q.sombra, q.sombra);
      if (sh.map) { sh.map.dispose(); sh.map = null; }   // se regenera al tamaño nuevo
    }
    luces.puntos.forEach((p, i) => { p.visible = q.puntos || i < 1; });
    mallasContacto.forEach((m) => { m.visible = !!q.contacto; });
    ajustar();
    const raizCal = $("t3d");
    if (raizCal) raizCal.classList.toggle("cine-on", nivel === "alta");
    const etq = $("t3dCalNivel");
    if (etq) etq.textContent = nivel;
    document.querySelectorAll("#t3dCal [data-cal]").forEach((b) => {
      b.classList.toggle("on", b.dataset.cal === calidad);
    });
    ajustarZonaFresca();
  }

  /* La zona fresca se adapta al perfil sin reconstruir la escena:
     `InstancedMesh.count` dibuja menos piezas y las tapas se apagan. En
     `baja` la caja se ve igual de llena (8 frutas alcanzan), pero cuesta
     un tercio de los vértices y del overdraw. */
  function ajustarZonaFresca() {
    const nivel = calidad === "auto" ? perfil : calidad;
    const q = NIVELES_CALIDAD[nivel] || NIVELES_CALIDAD.media;
    const tope = { alta: 20, media: 14, baja: 8 }[nivel] || 14;
    frescosPilas.forEach((e) => {
      if (e && e.mesh) e.mesh.count = Math.min(e.n, tope);
    });
    tapasGondola.forEach((m) => { if (m) m.visible = nivel !== "baja"; });
    if (luzFresca) luzFresca.visible = !!q.puntos;
  }

  function crearCamaras() {
    camaras = [
      [-8, 2.75, -8.4], [8, 2.75, -8.4], [8, 2.75, 9.2], [0, 2.95, 9.6]
    ].map(([x, y, z], i) => {
      const c = new T.PerspectiveCamera(66, 1.6, 0.1, 44);
      c.position.set(x, y, z);
      c.userData.i = i;
      c.lookAt(0, 1.15, 0);
      return c;
    });
  }

  /* El FOV vertical que eligió el usuario no sirve igual en todas las
     formas de pantalla: en apaisado 92 abre ~140° horizontales y se ve ojo de
     pez. En vertical se respeta (hasta 100). */
  function fovPantalla() {
    const asp = (camera && camera.aspect) || 1;
    return asp > 1.45 ? Math.min(fovAct, 72) : Math.min(fovAct, 100);
  }

  function ajustar() {
    if (!renderer) return;
    if (grabador) return;              // grabando manda el tamaño 2K
    const caja = $("t3dCanvas");
    const vv = window.visualViewport;
    /* `visualViewport` manda en Android: con la barra del navegador a la
       vista, innerHeight miente y el canvas quedaba estirado. */
    const ancho = Math.round(caja.clientWidth || (vv && vv.width) || window.innerWidth || 390);
    const alto = Math.round(caja.clientHeight || (vv && vv.height) || (window.innerHeight - 64) || 600);
    if (ancho < 2 || alto < 2) return;
    renderer.setSize(ancho, alto, false);
    camera.aspect = ancho / Math.max(1, alto);
    camera.fov = fovPantalla();
    camera.updateProjectionMatrix();
    pintarMapa();
  }

  /* Un solo observador para todos los tamaños: rotación, barra del navegador,
     teclado en pantalla y ventana de escritorio. */
  function engancharResize() {
    const caja = $("t3dCanvas");
    if (!caja) return;
    if (window.ResizeObserver && !resizeObs) {
      resizeObs = new ResizeObserver(() => ajustar());
      resizeObs.observe(caja);
    }
    if (!resizeListo) {
      resizeListo = true;
      if (window.visualViewport) window.visualViewport.addEventListener("resize", ajustar);
      window.addEventListener("orientationchange", () => setTimeout(ajustar, 240));
    }
  }

  /* ── bucle ─────────────────────────────────────────────────────────────── */
  let bob = 0, frames = 0, fpsCuadros = 0, fpsT0 = 0;
  let sombraT = 0, fpsBajos = 0;

  function bucle() {
    if (!vivo) return;
    requestAnimationFrame(bucle);
    /* Sin renderer (o con el contexto suelto) el bucle sigue vivo pero no
       dibuja: así no revienta con «renderer null» mientras la gráfica se
       recupera, y el HUD 2D (minimapa, pedido, fps) sigue respondiendo. */
    let dibujar = !!renderer;
    if (dibujar) {
      try { dibujar = !renderer.getContext().isContextLost(); } catch (e) { dibujar = false; }
    }
    const dt = Math.min(0.1, reloj.getDelta());   // en equipos lentos el paso no se frena
    actualizarVuelos(dt);
    actualizarCesta(dt);

    /* ── Entrada ─────────────────────────────────────────────────────────
       El stick izquierdo SOLO mueve (relativo a la cámara, con strafe) y
       el derecho SOLO mira: antes los dos giraban a la vez y la cámara
       se "desviaba" hacia un lado. Suavizado exponencial independiente
       del frame: rápido en la mirada (sin lag) y más blando en el paso. */
    const kMov = 1 - Math.exp(-dt * 14);    // arranca rápido y frena suave
    const kMir = 1 - Math.exp(-dt * 20);    // la mirada sigue el dedo al tiro
    joyS.x += (joy.x - joyS.x) * kMov;
    joyS.y += (joy.y - joyS.y) * kMov;
    joyCamS.x += (joyCam.x - joyCamS.x) * kMir;
    joyCamS.y += (joyCam.y - joyCamS.y) * kMir;

    // teclado: WASD mueve (igual que el stick izq.), ← → giran la vista
    let avance = (teclas.KeyW || teclas.ArrowUp ? 1 : 0) - (teclas.KeyS || teclas.ArrowDown ? 1 : 0);
    let lateral = (teclas.KeyD ? 1 : 0) - (teclas.KeyA ? 1 : 0);
    let miraX = (teclas.ArrowRight ? 1 : 0) - (teclas.ArrowLeft ? 1 : 0);
    let miraY = 0;
    /* Zona muerta: por debajo de 0,06 el stick no manda nada (el pulgar
       tiembla y antes la imagen "respiraba" sola). Se reescala el resto
       para que el paso arranque igual de fino. */
    const muerto = (v) => {
      const a = Math.abs(v);
      if (a < 0.06) return 0;
      return Math.sign(v) * Math.min(1, (a - 0.06) / 0.94);
    };
    avance += muerto(-joyS.y);
    lateral += muerto(joyS.x);
    miraX += muerto(joyCamS.x);
    miraY += muerto(joyCamS.y);

    // normalizado: en diagonal no se acelera la marcha
    const magIn = Math.hypot(avance, lateral);
    if (magIn > 1) { avance /= magIn; lateral /= magIn; }

    // mirada: velocidad angular pareja con la sensibilidad elegida
    yaw -= miraX * 2.4 * dt * sensCam;
    pitch = Math.max(-0.9, Math.min(0.9, pitch - miraY * 1.6 * dt * sensCam));

    /* ── Cuerpo con inercia ────────────────────────────────────────────
       Velocidades reales: caminar 1,6 m/s y correr 3,2 m/s (antes 3,0 /
       4,8 y se "volaba" el pasillo). La velocidad se acerca al objetivo
       con una exponencial: arranca suave, frena suave, sin tirones. */
    const corriendoAhora = corriendo || teclas.ShiftLeft || teclas.ShiftRight;
    const velMax = corriendoAhora ? 5.6 : 2.9;   // paso firme y carrera real
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);     // adelante
    const dx = Math.cos(yaw), dz = -Math.sin(yaw);      // derecha
    const objX = (fx * avance + dx * lateral) * velMax;
    const objZ = (fz * avance + dz * lateral) * velMax;
    const kAcel = 1 - Math.exp(-dt * (avance || lateral ? 20 : 24));
    vel.x += (objX - vel.x) * kAcel;
    vel.z += (objZ - vel.z) * kAcel;

    /* Avance en micro-pasos de 12 cm como máximo: al rozar un mueble se
       desliza en vez de trabarse, y a 3,2 m/s no se atraviesa nada. */
    const pasoMax = 0.12;
    const dist = Math.hypot(vel.x, vel.z) * dt;
    const trozos = Math.max(1, Math.ceil(dist / pasoMax));
    for (let i = 0; i < trozos; i++) {
      const nx = pos.x + (vel.x * dt) / trozos;
      const nz = pos.z + (vel.z * dt) / trozos;
      if (!choca(nx, pos.z)) pos.x = nx; else vel.x *= 0.4;
      if (!choca(pos.x, nz)) pos.z = nz; else vel.z *= 0.4;
    }

    /* ── Primera persona ───────────────────────────────────────────────
       Ojos a 1,66 m y paso con balanceo proporcional a la velocidad
       real (vertical, lateral y una mínima inclinación de cabeza), más
       un leve agrandar del encuadre al correr. */
    const rapido = Math.hypot(vel.x, vel.z);
    bob += rapido * dt * 3.6;
    const paso = Math.min(1, rapido / 1.6);
    /* La cámara va pegada al cuerpo: sin inercia propia. Esa inercia era la
       que hacía "flotar" la vista al girar y al frenar. El balanceo queda en
       milímetros, sólo como señal de paso. */
    camera.position.set(
      pos.x + Math.sin(bob * 0.5) * 0.004 * paso,
      pos.y + Math.sin(bob) * 0.006 * paso,
      pos.z
    );
    const fovObj = fovBase + (corriendoAhora && rapido > 0.4 ? 2 : 0);
    if (Math.abs(fovObj - fovAct) > 0.02) {
      fovAct += (fovObj - fovAct) * (1 - Math.exp(-dt * 9));
      camera.fov = fovPantalla();
      camera.updateProjectionMatrix();
    }
    camera.rotation.set(0, 0, 0);
    camera.rotateY(yaw);
    camera.rotateX(pitch);
    /* sin rotateZ: inclinar la cabeza con el paso desestabilizaba el
       horizonte (se notaba como "desbalance" al caminar). */

    actualizarCarrito(dt);
    mirarPrecio(performance.now());

    if (dibujar) {
      /* Sombras: el local es casi estático (sólo el carrito se mueve), así
         que se recalculan 2-3 veces por segundo en vez de en cada frame. */
      if (renderer.shadowMap.enabled) {
        const ts = performance.now();
        if (ts - sombraT > 900) { sombraT = ts; renderer.shadowMap.needsUpdate = true; }
      }
      renderer.render(scene, camera);

      if (cctv && camaras.length) {
        const W = renderer.domElement.width, H = renderer.domElement.height;
        const dpr = renderer.getPixelRatio();
        const gap = Math.round(4 * dpr), head = Math.round(56 * dpr);
        const w = Math.floor((W - gap) / 2), h = Math.floor((H - head - gap) / 2);
        const t = performance.now();
        renderer.setScissorTest(true);
        if (camSolo != null && camaras[camSolo]) {
          // una sola cámara en pantalla completa, bajo la barra de la vista
          const cam = camaras[camSolo];
          cam.aspect = W / Math.max(1, H - head);
          cam.updateProjectionMatrix();
          cam.lookAt(
            Math.sin(t / 2600 + camSolo * 1.7) * 2.2,
            1.1,
            Math.cos(t / 3400 + camSolo * 1.3) * 2.2
          );
          renderer.setViewport(0, 0, W, H - head);
          renderer.setScissor(0, 0, W, H - head);
          renderer.render(scene, cam);
        } else {
          camaras.forEach((cam, i) => {
            const col = i % 2, row = Math.floor(i / 2);
            const x = col * (w + gap);
            const y = row === 0 ? h + gap : 0;
            // barrido lento, como una cámara de vigilancia
            cam.lookAt(
              Math.sin(t / 2600 + i * 1.7) * 2.2,
              1.1,
              Math.cos(t / 3400 + i * 1.3) * 2.2
            );
            cam.aspect = w / Math.max(1, h);
            cam.updateProjectionMatrix();
            renderer.setViewport(x, y, w, h);
            renderer.setScissor(x, y, w, h);
            renderer.render(scene, cam);
          });
        }
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, W, H);
        renderer.setScissor(0, 0, W, H);
      }
    }
    frames++;

    // minimapa: a ~12 fps y sólo lo que esté a la vista (pintarMapa decide)
    const tm = performance.now();
    if (tm - mapaT > 80) { mapaT = tm; pintarMapa(); }

    // fps en vivo: así se ve si la calidad elegida le queda grande al equipo
    fpsCuadros++;
    const ahora = performance.now();
    if (!fpsT0) fpsT0 = ahora;
    if (ahora - fpsT0 >= 1000) {
      const fpsHoy = Math.round((fpsCuadros * 1000) / (ahora - fpsT0));
      const el = $("t3dFps");
      if (el) el.textContent = fpsHoy + " fps";
      fpsCuadros = 0; fpsT0 = ahora;

      /* Auto-ajuste: si el recorrido va por debajo de 32 fps dos segundos
         seguidos, se recorta densidad y efectos en vez de dejar que se
         arrastre. Nunca sube sola: eso produce oscilaciones. */
      if (calidad === "auto") {
        if (fpsHoy > 0 && fpsHoy < 32) fpsBajos++; else fpsBajos = 0;
        if (fpsBajos >= 2) {
          fpsBajos = 0;
          if (perfil === "alta") { perfil = "media"; aplicarCalidad(); avisoTexto("Calidad media", "para mantener el recorrido fluido"); }
          else if (perfil === "media") { perfil = "baja"; aplicarCalidad(); avisoTexto("Calidad baja", "el equipo va justo: se prioriza la fluidez"); }
        }
      }
      // el pedido puede cambiar también desde la vista de Mercado
      actualizarCompra();
    }
  }

  function choca(x, z) {
    const m = 0.4;
    if (Math.abs(x) > ANCHO / 2 - m || Math.abs(z) > LARGO / 2 - m) return true;
    for (let i = 0; i < GONDOLAS.length; i++) {
      if (Math.abs(x - GONDOLAS[i]) < G_ANCHO / 2 + m && Math.abs(z) < G_LARGO / 2 + m) return true;
    }
    // fila de congeladores contra la pared del fondo
    if (z < -8.5) return true;
    // islas de verdura y refrigerados de la zona de entrada
    for (let i = 0; i < ISLAS_FRESCAS.length; i++) {
      const isla = ISLAS_FRESCAS[i];
      if (Math.abs(x - isla.x) < 1.17 + m && Math.abs(z - isla.z) < 0.62 + m) return true;
    }
    for (let i = 0; i < REFRIGERADOS.length; i++) {
      const r = REFRIGERADOS[i];
      if (Math.abs(x - r.x) < 1.25 + m && Math.abs(z - r.z) < 0.48 + m) return true;
    }
    // tótems de oferta junto a la entrada
    for (let i = 0; i < TOTEMS.length; i++) {
      if (Math.abs(x - TOTEMS[i].x) < 0.45 + m && Math.abs(z - TOTEMS[i].z) < 0.45 + m) return true;
    }
    return false;
  }

  /* ── interacción ───────────────────────────────────────────────────────── */
  function rayo(clientX, clientY, objetos) {
    const r = $("t3dCanvas").getBoundingClientRect();
    puntero.x = ((clientX - r.left) / r.width) * 2 - 1;
    puntero.y = -((clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(puntero, camera);
    return raycaster.intersectObjects(objetos, true);
  }

  /* Precio bajo la mira: una pancarta translúcida arriba a la izquierda.
     Se consulta 5 veces por segundo, no en cada cuadro. */
  let ultimoPrecio = 0, precioActual = null;

  function rayoCentro(objetos) {
    puntero.set(0, 0);
    raycaster.setFromCamera(puntero, camera);
    return raycaster.intersectObjects(objetos, true);
  }

  let ocultarTimer = null;

  function mostrarPrecio(p, autoOcultar) {
    const caja = $("t3dPrecio");
    if (!caja || !p) return;
    precioActual = p;
    caja.hidden = false;
    $("t3dPrecioCat").textContent = p.categoria || "Producto";
    $("t3dPrecioNom").textContent = p.nombre || "—";
    $("t3dPrecioVal").textContent = "$" + Math.round(p.precio || 0).toLocaleString("es-CL");
    $("t3dPrecioStock").textContent = (p.stock != null ? p.stock + " disp." : "");
    $("t3dPrecioPie").textContent = autoOcultar ? "agregado al carrito" : "toca para agregar";
    clearTimeout(ocultarTimer);
    if (autoOcultar) ocultarTimer = setTimeout(() => { caja.hidden = true; }, 2600);
  }

  // Producto que apunta un golpe de rayo (malla de estante o de nevera).
  function prodDe(hit) {
    if (!hit || hit.instanceId == null) return null;
    const mapa = hit.object && hit.object.userData ? hit.object.userData.mapa : null;
    return (mapa && mapa[hit.instanceId]) || null;
  }

  // Sólo aparece cuando apuntás un producto cercano (no la TV, no de lejos).
  function mirarPrecio(t) {
    if (t - ultimoPrecio < 200) return;
    ultimoPrecio = t;
    const caja = $("t3dPrecio");
    if (!caja || !mallasProd.length) return;
    if (autoOcultado()) return;
    if (fichaP) return;                       // con la ficha abierta no duplica
    const h = rayoCentro(mallasProd);
    if (h.length && h[0].instanceId != null && h[0].distance < 6.5) {
      const p = prodDe(h[0]);
      if (p && p !== precioActual) mostrarPrecio(p, false);
    } else if (precioActual && !ocultarTimer) {
      precioActual = null;
      caja.hidden = true;
    }
  }
  function autoOcultado() { return false; }

  function agregar(p) {
    if (!(window.Mercado && window.Mercado.agregar)) return;
    /* El carrito guarda primero y repinta después: si el repintado de la
       vista de Mercado falla (p. ej. la vista aún no cargó), no debe dejar
       sin contador ni sin aviso al visor 3D. */
    try { window.Mercado.agregar(p); } catch (e) { /* ya quedó en el carrito */ }
    actualizarCompra();
    aviso3d(p);
    carritoAnim = 1;      // el carrito da un salto al recibir algo
  }

  let avisoTimer = null;
  function aviso3d(p) {
    avisoTexto(String(p.nombre), "$" +
      Math.round(p.precio || 0).toLocaleString("es-CL") + " · agregado");
  }

  /* ── ficha del producto ─────────────────────────────────────────────────
     Tocar un estante o la nevera abre su ficha: portada, precio, stock,
     código de barras EAN-13 y el botón que lo manda al carrito. */
  function abrirFicha(p, hit) {
    const f = $("t3dFicha");
    if (!f || !p) return;
    fichaP = p;
    fichaOrigen = hit || null;
    const cat = p.categoria || "Producto";
    const c = $("t3dFichaCat"); if (c) c.textContent = cat;
    const n = $("t3dFichaNom"); if (n) n.textContent = p.nombre || "—";
    const v = $("t3dFichaVal"); if (v) v.textContent = "$" + Math.round(p.precio || 0).toLocaleString("es-CL");
    const s = $("t3dFichaStock");
    if (s) s.textContent = p.stock != null ? p.stock + " disp." : "referencial";

    const img = $("t3dFichaImg");
    if (img && img.getContext) {
      const g = img.getContext("2d");
      g.clearRect(0, 0, img.width, img.height);
      /* La ficha muestra la MISMA etiqueta que el envase del pasillo: marca,
         nombre, presentación y código. Antes dibujaba una portada cuadrada
         distinta y parecía otro producto. */
      const W2 = Math.round(img.width * 0.66), H2 = img.height;
      g.save();
      g.translate(Math.round((img.width - W2) / 2), 0);
      dibuEtiqueta(g, W2, H2, {
        nombre: p.nombre, tinte: colorDe(p), marca: marcaDe(p), forma: formaDe(p),
        categoria: p.categoria
      });
      g.restore();
    }

    const barra = $("t3dFichaBarra");
    if (barra) {
      let html = "";
      if (window.Mercado && window.Mercado.codigoDe && window.Mercado.ean13Svg) {
        try { html = window.Mercado.ean13Svg(window.Mercado.codigoDe(p)); }
        catch (e) { html = ""; }
      }
      if (!html) html = "<span>" + String(p.id || "FABRI").toUpperCase() + "</span>";
      barra.innerHTML = html;
    }
    const add = $("t3dFichaAdd");
    if (add) { add.textContent = "Añadir al carrito"; add.disabled = false; }
    f.hidden = false;
    const caja = $("t3dPrecio");
    if (caja) caja.hidden = true;
    clearTimeout(ocultarTimer);
    ocultarTimer = null;
  }

  function cerrarFicha() {
    const f = $("t3dFicha");
    if (f) f.hidden = true;
    fichaP = null;
    fichaOrigen = null;
  }

  /* ── vuelo al carrito ───────────────────────────────────────────────────
     Al añadir, una caja con la portada sale del estante, describe un arco
     y cae en el carrito: 0,6 s con suavizado y rotación. */
  function volar(p, hit) {
    if (!T || !scene) return;
    const origen = new T.Vector3();
    let conMapa = null;
    if (hit && hit.point) {
      origen.copy(hit.point);
      if (hit.object && hit.object.material) conMapa = hit.object.material.map || null;
    } else if (camera) {
      const dir = new T.Vector3();
      camera.getWorldDirection(dir);
      origen.copy(camera.position).addScaledVector(dir, 1.7);
    } else {
      origen.set(pos.x, 1.3, pos.z);
    }
    const destino = carrito ? carrito.position.clone() : new T.Vector3(pos.x, 0.6, pos.z);
    /* El objeto que vuela es el envase real: misma geometría por familia,
       mismo tinte y su carátula. Antes era una caja con la etiqueta pegada en
       las seis caras, así que no se reconocía el producto. */
    const forma = formaDe(p);
    const tam = TAMANO[forma] || TAMANO.caja;
    const mesh = new T.Group();
    /* El cuerpo va escalado al tamaño real de la familia: la geometría es
       unitaria (un cubo de 1 m si no se escala) y por eso el producto volaba
       y aterrizaba como un cajón gigante. */
    const cuerpo = new T.Mesh(geoForma(forma), matForma(forma, p));
    cuerpo.scale.set(tam.ancho, tam.alto, tam.fondo / tam.fondoGeo);
    cuerpo.castShadow = true;
    mesh.add(cuerpo);
    const et = new T.Mesh(
      geoEtiqueta(forma),
      new T.MeshLambertMaterial({ map: texturaEtiqueta(p, 192) })
    );
    const esc = new T.Vector3(tam.ancho, tam.alto, tam.fondo / tam.fondoGeo);
    const base = new T.Matrix4().compose(new T.Vector3(0, 0, 0), new T.Quaternion(), esc);
    et.applyMatrix4(matEtiqueta(forma, base, tam.fondo));
    mesh.add(et);
    /* Tamaño real: un envase de 17 cm tiene que verse de 17 cm también
       mientras vuela. Antes iba a 1,35 y se veía como un cajón. */
    mesh.scale.setScalar(1);
    mesh.position.copy(origen);
    scene.add(mesh);
    vuelos.push({ mesh: mesh, t: 0, origen: origen, destino: destino, aCesta: true });
  }

  /* El producto ya llegó: se mete en la cesta, cae al hueco y se queda.
     Máximo 12 visibles; el más viejo se retira para no llenar la GPU. */
  /* Libera geometrías y materiales de un mesh o de un grupo (el envase que
     vuela es un grupo: cuerpo + carátula). */
  function disponerObjeto(o) {
    if (!o) return;
    if (o.isMesh) {
      if (o.geometry) o.geometry.dispose();
      const mats = !o.material ? [] : (Array.isArray(o.material) ? o.material : [o.material]);
      mats.forEach((m) => { if (m && m.dispose) m.dispose(); });
    }
    (o.children || []).forEach(disponerObjeto);
  }

  /* Aterrizaje en la cesta con tamaño real y apoyo sobre el piso del
     carrito: 3 columnas × 2 filas (la cesta mide 0,62 × 0,44) y el envase se
     apoya con su propia altura, así una botella no queda enterrada ni una
     lata flotando. Los productos se van llenando del fondo hacia adelante y
     al llenarse sale el más viejo, como en la mano. */
  const CESTA_SLOTS = [];
  for (let f = 0; f < 2; f++) {
    for (let c = 0; c < 3; c++) {
      CESTA_SLOTS.push([-0.185 + c * 0.185, -0.105 + f * 0.185]);
    }
  }

  function soltarEnCesta(mesh) {
    if (!carritoCesta) { scene.remove(mesh); disponerObjeto(mesh); return; }
    scene.remove(mesh);
    const slot = CESTA_SLOTS[cestaN % CESTA_SLOTS.length];
    const vuelta = Math.floor(cestaN / CESTA_SLOTS.length);
    cestaN++;
    mesh.scale.setScalar(1);
    mesh.rotation.set(0, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.10);
    mesh.updateMatrixWorld(true);
    const caja = new T.Box3().setFromObject(mesh);
    const alto = Math.max(0.06, caja.max.y - caja.min.y);
    /* el piso de la cesta está en 0,315; si ya hay una vuelta encima, sube */
    const y = 0.315 + alto / 2 + vuelta * 0.02;
    mesh.position.set(slot[0], y + 0.16, slot[1]);
    carritoCesta.add(mesh);
    cestaItems.push({ mesh: mesh, y: y, t: 0 });
    while (cestaItems.length > 6) {
      const viejo = cestaItems.shift();
      carritoCesta.remove(viejo.mesh);
      disponerObjeto(viejo.mesh);
    }
  }

  function actualizarCesta(dt) {
    if (!cestaItems.length) return;
    for (let k = 0; k < cestaItems.length; k++) {
      const it = cestaItems[k];
      if (it.t >= 1) continue;
      it.t = Math.min(1, it.t + dt / 0.42);
      const e = 1 - Math.pow(1 - it.t, 3);          // frenada al caer
      it.mesh.position.y = it.y + 0.18 * (1 - e);
    }
  }

  function limpiarCesta() {
    if (!carritoCesta) return;
    cestaItems.forEach((it) => {
      carritoCesta.remove(it.mesh);
      disponerObjeto(it.mesh);
    });
    cestaItems = [];
    cestaN = 0;
  }

  function actualizarVuelos(dt) {
    if (!vuelos.length || !scene) return;
    const tmp = new T.Vector3();
    for (let k = vuelos.length - 1; k >= 0; k--) {
      const v = vuelos[k];
      /* el destino se recalcula: el carrito se mueve mientras la caja vuela */
      if (v.aCesta && carrito) {
        carrito.localToWorld(tmp.set(0, 0.5, 0));
        v.destino.copy(tmp);
      }
      v.t = Math.min(1, v.t + dt / 0.6);
      const e = v.t * v.t * (3 - 2 * v.t);              // suavizado
      v.mesh.position.lerpVectors(v.origen, v.destino, e);
      v.mesh.position.y += Math.sin(Math.PI * v.t) * 1.05;   // arco
      v.mesh.rotation.y += dt * 7;
      v.mesh.rotation.x += dt * 3;
      if (v.t >= 1) {
        if (v.aCesta) soltarEnCesta(v.mesh);
        else {
          scene.remove(v.mesh);
          disponerObjeto(v.mesh);
        }
        vuelos.splice(k, 1);
        carritoAnim = 1;                                // el carrito recibe
      }
    }
  }

  function interactuar(clientX, clientY) {
    // TV primero: toque directo = agrega (su cartel lo dice)
    if (tv && promos.length) {
      const h = rayo(clientX, clientY, [tv]);
      if (h.length) {
        const p = promos[promoIdx % promos.length];
        if (p) { agregar(p); mostrarPrecio(p, true); siguientePromo(); }
        return;
      }
    }
    const hits = rayo(clientX, clientY, mallasProd);
    if (hits.length) {
      const p = prodDe(hits[0]);
      if (p) { abrirFicha(p, hits[0]); return; }
    }
    cerrarFicha();                       // toque al vacío: cierra la ficha
  }

  /* ══════════════════════════════════════════════════════════════════════
     HUD DE MUNDO ABIERTO · barra superior, minimapa, pedido y cámaras
     ══════════════════════════════════════════════════════════════════════ */

  const escHTML = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ── sonido del local ─────────────────────────────────────────────────────
     Ambiente y música generados con WebAudio: ruido rosa filtrado (neveras y
     murmullo), acordes suaves y un aviso lejano cada tanto. No se descarga
     ningún archivo, así que no hay licencia de terceros ni consumo de datos,
     y funciona sin internet. */
  const SONIDO = { ctx: null, maestro: null, destino: null, activo: false, timers: [] };

  function sonidoCrear() {
    if (SONIDO.ctx) return SONIDO.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    const maestro = ctx.createGain();
    maestro.gain.value = 0.0001;
    maestro.connect(ctx.destination);
    const destino = ctx.createMediaStreamDestination();
    maestro.connect(destino);

    // cama: ruido rosa por un pasabajos (neveras + murmullo de gente)
    const largo = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, largo, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < largo; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.055;
    }
    const ruido = ctx.createBufferSource();
    ruido.buffer = buf;
    ruido.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 430; lp.Q.value = 0.7;
    const gR = ctx.createGain(); gR.gain.value = 0.5;
    ruido.connect(lp); lp.connect(gR); gR.connect(maestro);
    ruido.start();

    // música: progresión de séptimas con ataque y caída largos
    const prog = [
      [261.63, 329.63, 392.00, 493.88],
      [220.00, 261.63, 329.63, 392.00],
      [174.61, 220.00, 261.63, 329.63],
      [196.00, 246.94, 293.66, 392.00]
    ];
    const lpMus = ctx.createBiquadFilter();
    lpMus.type = "lowpass"; lpMus.frequency.value = 1900;
    lpMus.connect(maestro);
    let idx = 0;
    const acorde = () => {
      if (!SONIDO.activo) return;
      const t = ctx.currentTime + 0.05;
      const notas = prog[idx % prog.length];
      idx++;
      notas.forEach((f, k) => {
        const o = ctx.createOscillator();
        o.type = k === 0 ? "triangle" : "sine";
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.035 / (k + 1.4), t + 1.5);
        g.gain.exponentialRampToValueAtTime(0.0006, t + 5.2);
        o.connect(g); g.connect(lpMus);
        o.start(t); o.stop(t + 5.4);
      });
    };
    // aviso lejano: dos tonos suaves cada ~34 s
    const aviso = () => {
      if (!SONIDO.activo) return;
      [880, 1174].forEach((f, k) => {
        const t = ctx.currentTime + 0.1 + k * 0.45;
        const o = ctx.createOscillator();
        o.type = "sine"; o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.012, t + 0.08);
        g.gain.exponentialRampToValueAtTime(0.0004, t + 1.1);
        o.connect(g); g.connect(maestro);
        o.start(t); o.stop(t + 1.2);
      });
    };

    SONIDO.ctx = ctx;
    SONIDO.maestro = maestro;
    SONIDO.destino = destino;
    SONIDO.timers.push(setInterval(acorde, 4600));
    SONIDO.timers.push(setInterval(aviso, 34000));
    SONIDO.acorde = acorde;
    return ctx;
  }

  function sonidoActivar(on) {
    const ctx = sonidoCrear();
    if (!ctx) return false;
    if (on) {
      ctx.resume();
      SONIDO.activo = true;
      SONIDO.maestro.gain.cancelScheduledValues(ctx.currentTime);
      SONIDO.maestro.gain.setTargetAtTime(0.55, ctx.currentTime, 0.6);
      if (SONIDO.acorde) SONIDO.acorde();
    } else {
      SONIDO.activo = false;
      SONIDO.maestro.gain.cancelScheduledValues(ctx.currentTime);
      SONIDO.maestro.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.25);
    }
    const b = $("t3dSonido");
    if (b) {
      b.classList.toggle("on", !!on);
      b.setAttribute("aria-pressed", String(!!on));
    }
    return true;
  }

  function sonidoAlternar() {
    const ok = sonidoActivar(!SONIDO.activo);
    if (!ok) avisoTexto("Sin audio", "Este navegador no expone WebAudio");
    else avisoTexto(SONIDO.activo ? "Sonido del local" : "Sonido apagado",
      SONIDO.activo ? "Ambiente y música generados en el navegador" : "Podés reactivarlo cuando quieras");
  }

  /* Pista de audio para la grabación (si el sonido está creado). */
  function sonidoPista() {
    if (!SONIDO.destino) return null;
    const pistas = SONIDO.destino.stream.getAudioTracks();
    return pistas.length ? pistas[0] : null;
  }

  /* ── grabación del recorrido ──────────────────────────────────────────────
     Se dibuja a 2K (2560 px del lado largo, con la MISMA proporción de la
     pantalla para que el encuadre no cambie) y se graba con MediaRecorder:
     video VP9/VP8 + el audio del local. Al detener, se descarga el .webm. */
  function grabandoAhora() {
    return !!(grabador && grabador.state === "recording");
  }

  function medirGrabacion() {
    const c = renderer ? renderer.domElement : null;
    const aw = (c && c.clientWidth) || 390;
    const ah = (c && c.clientHeight) || 800;
    const asp = Math.max(0.3, Math.min(3, aw / Math.max(1, ah)));
    const q = GRAB_NIVELES[grabCalidad] || GRAB_NIVELES["800"];
    /* el lado corto manda: la proporción de la pantalla no cambia */
    let w, h;
    if (asp >= 1) { h = q.corto; w = Math.round(q.corto * asp); }
    else { w = q.corto; h = Math.round(q.corto / asp); }
    w -= w % 2; h -= h % 2;
    return { w: Math.max(320, w), h: Math.max(320, h), mbps: q.mbps, txt: q.txt };
  }

  function pintarNivelGrab() {
    document.querySelectorAll("#t3dGrabPresets [data-grab]").forEach((b) => {
      b.classList.toggle("on", b.dataset.grab === grabCalidad);
    });
    const n = $("t3dGrabNota");
    if (n) n.textContent = (GRAB_NIVELES[grabCalidad] || GRAB_NIVELES["800"]).nota;
  }

  function fmtTiempo(seg) {
    const m = Math.floor(seg / 60), s = seg % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function restaurarTamano() {
    const c = renderer ? renderer.domElement : null;
    if (renderer && grabPrevio) {
      renderer.setPixelRatio(grabPrevio.pr || 1);
      renderer.setSize(grabPrevio.sw, grabPrevio.sh, false);
    }
    grabPrevio = null;
    /* se suelta el tamaño fijo que se puso para grabar: vuelve a mandar el CSS.
       Se ajusta en el frame siguiente, cuando el navegador ya recompuso: si se
       mide en el acto, Android todavía devuelve el tamaño viejo. */
    if (c) { c.style.width = ""; c.style.height = ""; }
    requestAnimationFrame(ajustar);
    setTimeout(ajustar, 90);
  }

  function detenerGrabacion() {
    if (!grabandoAhora()) return;
    try { grabador.stop(); } catch (e) { /* ya parado */ }
    clearInterval(grabReloj);
    grabReloj = 0;
    const b = $("t3dGrabar");
    if (b) { b.classList.remove("on"); b.setAttribute("aria-pressed", "false"); }
    const badge = $("t3dRec");
    if (badge) badge.hidden = true;
  }

  function entregarGrabacion(stream) {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    /* el orden importa: `ajustar()` no hace nada mientras `grabador` exista */
    grabador = null;
    restaurarTamano();
    if (!grabChunks.length) { avisoTexto("Grabación vacía", "No se capturó ningún frame"); return; }
    const tipo = grabChunks[0].type || "video/webm";
    const blob = new Blob(grabChunks, { type: tipo });
    grabChunks = [];
    const d = new Date();
    const dos = (n) => (n < 10 ? "0" : "") + n;
    const nombre = "forge-recorrido-" + d.getFullYear() + dos(d.getMonth() + 1) + dos(d.getDate()) +
      "-" + dos(d.getHours()) + dos(d.getMinutes()) + ".webm";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
    const mb = (blob.size / (1024 * 1024)).toFixed(1);
    avisoTexto("Recorrido guardado", nombre + " · " + mb + " MB");
  }

  function empezarGrabacion() {
    if (!renderer) return;
    const canvas = renderer.domElement;
    if (!window.MediaRecorder || !canvas.captureStream) {
      avisoTexto("No disponible", "Este navegador no permite grabar la escena");
      return;
    }
    const t = medirGrabacion();
    grabPrevio = {
      pr: renderer.getPixelRatio(),
      sw: canvas.width, sh: canvas.height
    };
    /* Se fija el tamaño en pantalla con estilo explícito: cambiar el atributo
       width/height del canvas puede disparar el "ajuste" del navegador móvil
       y encoger la página. Así el recuadro visible no se mueve. */
    canvas.style.width = (canvas.clientWidth || 390) + "px";
    canvas.style.height = (canvas.clientHeight || 800) + "px";
    renderer.setPixelRatio(1);
    renderer.setSize(t.w, t.h, false);
    camera.aspect = t.w / t.h;
    camera.fov = fovPantalla();
    camera.updateProjectionMatrix();
    let stream;
    try { stream = canvas.captureStream(30); }
    catch (e) {
      restaurarTamano();
      avisoTexto("No se pudo capturar", "El navegador rechazó el canvas");
      return;
    }
    const pistaAudio = sonidoPista();
    if (pistaAudio) stream.addTrack(pistaAudio);
    const tipos = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
    const mime = tipos.filter((m) => window.MediaRecorder.isTypeSupported(m))[0] || "";
    try {
      grabador = new MediaRecorder(stream, mime
        ? { mimeType: mime, videoBitsPerSecond: Math.round(t.mbps * 1000000) } : undefined);
    } catch (e) {
      restaurarTamano();
      avisoTexto("No se pudo grabar", String((e && e.message) || e).slice(0, 60));
      return;
    }
    grabChunks = [];
    grabador.ondataavailable = (e) => { if (e.data && e.data.size) grabChunks.push(e.data); };
    grabador.onstop = () => entregarGrabacion(stream);
    grabador.start(1000);
    grabIni = Date.now();
    const b = $("t3dGrabar");
    if (b) { b.classList.add("on"); b.setAttribute("aria-pressed", "true"); }
    const badge = $("t3dRec");
    if (badge) {
      badge.hidden = false;
      const tam = $("t3dRecTam");
      if (tam) tam.textContent = t.txt + " · " + t.w + "×" + t.h;
      const tm = $("t3dRecTiempo");
      if (tm) tm.textContent = "0:00";
    }
    clearInterval(grabReloj);
    grabReloj = setInterval(() => {
      const seg = Math.floor((Date.now() - grabIni) / 1000);
      const tm = $("t3dRecTiempo");
      if (tm) tm.textContent = fmtTiempo(seg);
      if (seg >= 180) {                          // tope de 3 min: ~180 MB
        detenerGrabacion();
        avisoTexto("Grabación terminada", "Tope de 3 minutos para no llenar el disco");
      }
    }, 500);
    avisoTexto("Grabando recorrido", t.txt + " · " + t.w + "×" + t.h + " · tocá de nuevo para guardar");
  }

  function alternarGrabacion() {
    if (grabandoAhora()) detenerGrabacion();
    else empezarGrabacion();
  }

  function avisoTexto(a, b) {
    const el = $("t3dAviso");
    if (!el) return;
    el.innerHTML = "<b>" + escHTML(a) + "</b><span>" + escHTML(b) + "</span>";
    el.hidden = false;
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  /* Panel de escena (luces, calidad, cámara) abierto desde la barra */
  function alternarLuces() {
    const p = $("t3dLuces"), b = $("t3dLucesBtn");
    if (!p) return;
    const abrir = p.hidden;
    p.hidden = !abrir;
    if (b) b.setAttribute("aria-expanded", String(abrir));
    // el botón «Config» de la barra es otro disparador del mismo panel
    const nav = document.querySelector('.t3d-nav [data-ir="escena"]');
    if (nav) nav.setAttribute("aria-expanded", String(abrir));
    if (abrir) abrirMapa(false);
  }

  /* Devuelve el cuerpo a la entrada: lo usan «Volver a la entrada», la
     barra «Tienda» y el plano. */
  function aEntrada() {
    pos.x = 0; pos.z = 8.2; yaw = 0; pitch = 0;
    vel.x = 0; vel.z = 0; fovAct = fovBase;
    joy.x = joy.y = joyCam.x = joyCam.y = 0;
    joyS.x = joyS.y = joyCamS.x = joyCamS.y = 0;
    corriendo = false;
    const rc = $("t3dCorrer");
    if (rc) rc.classList.remove("on");
  }

  /* «Tienda» en la barra: cierra lo que esté abierto y deja la vista limpia */
  function aTienda() {
    cerrarFicha();
    const p = $("t3dLuces"), b = $("t3dLucesBtn");
    if (p) p.hidden = true;
    if (b) b.setAttribute("aria-expanded", "false");
    abrirMapa(false);
    ponerCctv(false);
    aEntrada();
  }

  /* ── Minimapa ────────────────────────────────────────────────────────────
     Se dibuja con el MISMO layout que la escena: muro, congeladores del
     fondo, las seis góndolas con su paso real y la entrada. El punto lima
     es la posición del jugador y el cono, su rumbo. No es un mapa aparte. */
  function dibujarMapa(g, W, H, grande) {
    const PX = (x) => ((x + ANCHO / 2) / ANCHO) * W;
    const PZ = (z) => ((z + LARGO / 2) / LARGO) * H;
    const rr = (x, y, w, h, r) => {
      g.beginPath();
      g.moveTo(x + r, y);
      g.arcTo(x + w, y, x + w, y + h, r);
      g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r);
      g.arcTo(x, y, x + w, y, r);
      g.closePath();
    };
    const fin = Math.max(1, W / 300);

    g.fillStyle = "#0a0c0d";
    g.fillRect(0, 0, W, H);
    const m = Math.max(3, W * 0.03);
    g.fillStyle = "#14181b";
    rr(m, m, W - 2 * m, H - 2 * m, grande ? 12 : 8);
    g.fill();

    // congeladores contra la pared del fondo (choca() los bloquea en z < -8,5)
    g.fillStyle = "#1b2730";
    rr(PX(-8.4), PZ(-9.9), PX(8.4) - PX(-8.4), PZ(-8.6) - PZ(-9.9), 4);
    g.fill();
    g.strokeStyle = "rgba(146,216,255,.45)";
    g.lineWidth = fin;
    g.stroke();

    // góndolas
    const anchoG = PX(G_ANCHO / 2) - PX(-G_ANCHO / 2);
    const altoG = PZ(G_LARGO / 2) - PZ(-G_LARGO / 2);
    GONDOLAS.forEach((gx, i) => {
      const sel = destino && destino.gi === i;
      g.fillStyle = sel ? "#c8ff00" : "#2b3136";
      rr(PX(gx - G_ANCHO / 2), PZ(-G_LARGO / 2), anchoG, altoG, 4);
      g.fill();
      if (!sel) {
        g.fillStyle = "rgba(255,255,255,.18)";
        rr(PX(gx - G_ANCHO / 2), PZ(-G_LARGO / 2), anchoG,
           Math.max(2, H * 0.006), 2);
        g.fill();
      }
      if (grande) {
        g.fillStyle = sel ? "#0a0c0d" : "#9aa1a7";
        g.font = "700 " + Math.round(W * 0.03) + "px ui-monospace, monospace";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(String(i + 1), PX(gx), PZ(0));
      }
    });

    // islas de verdura y refrigerados de la zona de entrada
    ISLAS_FRESCAS.forEach((isla) => {
      g.fillStyle = "#1d5a2c";
      rr(PX(isla.x - 1.17), PZ(isla.z - 0.60),
         PX(isla.x + 1.17) - PX(isla.x - 1.17),
         PZ(isla.z + 0.60) - PZ(isla.z - 0.60), 4);
      g.fill();
      g.strokeStyle = "rgba(200,255,0,.55)";
      g.lineWidth = fin;
      g.stroke();
    });
    REFRIGERADOS.forEach((r) => {
      g.fillStyle = "#1b3a4a";
      rr(PX(r.x - 1.25), PZ(r.z - 0.46),
         PX(r.x + 1.25) - PX(r.x - 1.25),
         PZ(r.z + 0.46) - PZ(r.z - 0.46), 4);
      g.fill();
      g.strokeStyle = "rgba(146,216,255,.55)";
      g.lineWidth = fin;
      g.stroke();
    });

    // entrada: franja lima en el muro por donde se entra (z = +LARGO/2)
    const franja = Math.max(3, H * 0.012);
    g.fillStyle = "#c8ff00";
    g.fillRect(PX(-2), PZ(LARGO / 2) - franja, PX(2) - PX(-2), franja);
    if (grande) {
      g.fillStyle = "#c8ff00";
      g.font = "700 " + Math.round(W * 0.024) + "px ui-monospace, monospace";
      g.textAlign = "center";
      g.textBaseline = "alphabetic";
      g.fillText("ENTRADA", PX(0), PZ(LARGO / 2) - franja - 6);
    }

    // destino elegido en el plano
    if (destino) {
      const r = Math.max(7, W * 0.05);
      g.beginPath();
      g.arc(PX(destino.x), PZ(destino.z), r, 0, Math.PI * 2);
      g.fillStyle = "rgba(215,255,53,.22)";
      g.fill();
      g.strokeStyle = "#d7ff35";
      g.lineWidth = Math.max(1.5, W / 170);
      g.stroke();
    }

    // jugador: cono de rumbo + punto
    const R = Math.max(4, W * 0.028);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    g.save();
    g.translate(PX(pos.x), PZ(pos.z));
    g.rotate(Math.atan2(fz, fx));
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(R * 2.5, -R);
    g.lineTo(R * 2.5, R);
    g.closePath();
    g.fillStyle = "rgba(200,255,0,.32)";
    g.fill();
    g.restore();

    g.beginPath();
    g.arc(PX(pos.x), PZ(pos.z), R, 0, Math.PI * 2);
    g.fillStyle = "#c8ff00";
    g.fill();
    g.lineWidth = Math.max(1, W / 260);
    g.strokeStyle = "#0a0c0d";
    g.stroke();
  }

  /* Repinta sólo lo que está a la vista: el minimapa va a ~12 fps (barato)
     y el plano, sólo mientras esté abierto. */
  function pintarMapa() {
    const c = $("t3dMapaC");
    if (c && c.offsetParent !== null) {
      const g = c.getContext("2d");
      if (g) dibujarMapa(g, c.width, c.height, false);
    }
    const b = $("t3dMapaBig");
    if (b && b.offsetParent !== null) {
      const g2 = b.getContext("2d");
      if (g2) dibujarMapa(g2, b.width, b.height, true);
    }
  }

  function pintarLeyenda() {
    const ul = $("t3dMapaLey");
    if (!ul) return;
    ul.innerHTML = GONDOLAS.map((gx, i) => {
      const on = destino && destino.gi === i ? ' class="on"' : "";
      return "<li" + on + ' data-gi="' + i + '">P' + (i + 1) + " · " +
        escHTML(catsGondola[i] || "Pasillo") + "</li>";
    }).join("");
  }

  /* Elige el pasillo más cercano al punto tocado y marca el destino */
  function elegirDestino(wx, wz) {
    let gi = 0, mejor = Infinity;
    GONDOLAS.forEach((gx, i) => {
      const d = Math.abs(wx - gx);
      if (d < mejor) { mejor = d; gi = i; }
    });
    destino = {
      gi: gi, x: GONDOLAS[gi],
      z: Math.max(-G_LARGO / 2, Math.min(G_LARGO / 2, wz))
    };
    const d = $("t3dMapaDato");
    if (d) d.textContent = "Pasillo " + (gi + 1) + " · " +
      (catsGondola[gi] || "Pasillo") + " · destino marcado";
    pintarLeyenda();
    pintarMapa();
  }

  function abrirMapa(on) {
    const f = $("t3dMapaFull"), b = $("t3dMapaBtn");
    if (!f) return;
    const ver = on === undefined ? f.hidden : !!on;
    f.hidden = !ver;
    if (b) b.setAttribute("aria-expanded", String(ver));
    if (ver) {
      ponerCctv(false);                 // el plano manda sobre las cámaras
      const p = $("t3dLuces"), lb = $("t3dLucesBtn");
      if (p && !p.hidden) {
        p.hidden = true;
        if (lb) lb.setAttribute("aria-expanded", "false");
      }
      pintarLeyenda();
      pintarMapa();
    }
  }

  /* ── Pedido en la barra: siempre el carrito comercial ──────────────────── */
  function actualizarCompra() {
    actualizarContador();
    let prod = 0, unid = 0, tot = 0;
    try {
      const M = window.Mercado;
      if (M) {
        if (M.unidades) unid = M.unidades();
        if (M.total) tot = M.total();
        if (M.lineas) prod = Object.keys(M.lineas()).length;
      }
      if (!prod) {
        const c = JSON.parse(localStorage.getItem(CLAVE_CARRITO) || "{}") || {};
        prod = Object.keys(c).length;
      }
    } catch (e) { /* sin carrito o en modo privado */ }
    if (!unid && cestaItems.length) limpiarCesta();
    const p = $("t3dCompProd"), u = $("t3dCompUnid"), t = $("t3dCompTotal");
    if (p) p.textContent = prod;
    if (u) u.textContent = unid;
    if (t) t.textContent = "$" + Math.round(tot).toLocaleString("es-CL");
  }

  /* ── Interactuar (botón flotante): lo mismo que tocar, pero con el rayo
        que sale del centro de la pantalla, para no tener que apuntar con el
        dedo encima del producto. */
  function interactuarCentro() {
    if (!T || !camera || !vivo) return;
    if (tv && promos.length && rayoCentro([tv]).length) {
      const p = promos[promoIdx % promos.length];
      if (p) { agregar(p); mostrarPrecio(p, true); siguientePromo(); }
      return;
    }
    const hits = rayoCentro(mallasProd);
    if (hits.length) {
      const p = prodDe(hits[0]);
      if (p) { abrirFicha(p, hits[0]); return; }
    }
    avisoTexto("No hay nada al frente", "acércate a un estante y volvé a tocar");
  }

  /* ── Cámaras: 4 en cuadrícula o una sola en grande ────────────────────── */
  function ponerCctv(on) {
    cctv = on;
    const raiz = $("t3d");
    if (raiz) raiz.classList.toggle("cctv", on);
    const caps = $("t3dCamsFull");
    if (caps) caps.hidden = !on;
    const btnCams = $("t3dCamsBtn");
    if (btnCams) btnCams.setAttribute("aria-expanded", String(on));
    const p = $("t3dLuces");
    if (p && on) p.hidden = true;
    if (!on) {
      camSolo = null;
      verCamara(null);
      camaras.forEach((c) => c.lookAt(0, 1.15, 0));
      mirar = null;
      puerta = null;
    }
  }

  /* i = null → las 4 a la vez; i = 0..3 → esa cámara en pantalla completa */
  function verCamara(i) {
    camSolo = i;
    const grid = $("t3dCamsGrid"), todas = $("t3dCamsTodas"), nota = $("t3dCamsNota");
    if (grid) {
      grid.classList.toggle("solo", i != null);
      grid.querySelectorAll("[data-cam]").forEach((b) =>
        b.classList.toggle("on", Number(b.dataset.cam) === i));
    }
    if (todas) todas.hidden = i == null;
    if (nota) nota.textContent = i == null
      ? "4 vistas en vivo · tocá una para verla en grande"
      : "Cámara " + (i + 1) + " en vivo · tocá «4 VISTAS» para volver";
  }

  /* ── Cableado del HUD (se une una vez, al cargar el módulo) ───────────── */
  function engancharHUD() {
    // interruptores LED: geometría + luz real del grupo
    document.querySelectorAll("#t3dLeds [data-led]").forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.led;
        if (!(k in leds)) return;
        leds[k] = !leds[k];
        aplicarLEDs();
      };
    });

    // barra superior: menú plegable y navegación por la API real de la app
    const menuBtn = $("t3dMenu"), navCaja = $("t3dNav");
    const cerrarNav = () => {
      if (!navCaja) return;
      navCaja.hidden = true;
      if (menuBtn) menuBtn.setAttribute("aria-expanded", "false");
    };
    if (menuBtn && navCaja) {
      menuBtn.onclick = () => {
        const abrir = navCaja.hidden;
        navCaja.hidden = !abrir;
        menuBtn.setAttribute("aria-expanded", String(abrir));
      };
    }
    document.querySelectorAll(".t3d-nav [data-ir]").forEach((b) => {
      b.onclick = () => {
        const a = b.dataset.ir;
        cerrarNav();
        if (a === "mapa") { abrirMapa(); return; }
        if (a === "escena") { alternarLuces(); return; }
        if (a === "tienda") { aTienda(); return; }
        if (window.Fabri && window.Fabri.go) window.Fabri.go(a);
      };
    });

    // minimapa: tocarlo abre el plano completo
    const mini = $("t3dMapa"), btnMapa = $("t3dMapaBtn");
    if (mini) mini.onclick = () => abrirMapa(true);
    if (btnMapa) btnMapa.onclick = () => abrirMapa();
    const mapaSalir = $("t3dMapaSalir");
    if (mapaSalir) mapaSalir.onclick = () => abrirMapa(false);

    // plano: tocar un pasillo lo identifica y marca el destino
    const big = $("t3dMapaBig");
    if (big) big.onclick = (e) => {
      const r = big.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const wx = ((e.clientX - r.left) / r.width) * ANCHO - ANCHO / 2;
      const wz = ((e.clientY - r.top) / r.height) * LARGO - LARGO / 2;
      elegirDestino(wx, wz);
    };
    const ley = $("t3dMapaLey");
    if (ley) ley.onclick = (e) => {
      const li = e.target.closest("li[data-gi]");
      if (li) elegirDestino(GONDOLAS[Number(li.dataset.gi)], 0);
    };
    const mEntrada = $("t3dMapaEntrada");
    if (mEntrada) mEntrada.onclick = () => { aEntrada(); abrirMapa(false); };
    const mLimp = $("t3dMapaLimp");
    if (mLimp) mLimp.onclick = () => {
      destino = null;
      const d = $("t3dMapaDato");
      if (d) d.textContent = "Tocá un pasillo para ver su categoría";
      pintarLeyenda();
      pintarMapa();
    };
    /* Puente con el mapa de locales: el visor y el mapa son una sola
       experiencia pública, así que se va y se vuelve sin recargar ni login. */
    const mLocales = $("t3dMapaLocales");
    if (mLocales) mLocales.onclick = () => {
      abrirMapa(false);
      if (window.Fabri && Fabri.go) Fabri.go("panel");
    };

    // botón flotante «Interactuar»
    const inter = $("t3dInter");
    if (inter) inter.onclick = interactuarCentro;

    // grabar el recorrido y sonido del local
    const bGrab = $("t3dGrabar");
    if (bGrab) bGrab.onclick = alternarGrabacion;
    const bSon = $("t3dSonido");
    if (bSon) bSon.onclick = sonidoAlternar;

    // nivel de grabación (800p por defecto)
    document.querySelectorAll("#t3dGrabPresets [data-grab]").forEach((b) => {
      b.onclick = () => {
        grabCalidad = GRAB_NIVELES[b.dataset.grab] ? b.dataset.grab : "800";
        pintarNivelGrab();
        try { localStorage.setItem(CLAVE_GRAB, grabCalidad); } catch (e) { /* privado */ }
      };
    });
    pintarNivelGrab();

    // cámaras: una en grande o las cuatro a la vez
    const grid = $("t3dCamsGrid");
    if (grid) grid.onclick = (e) => {
      const b = e.target.closest("button[data-cam]");
      if (b) verCamara(Number(b.dataset.cam));
    };
    const todas = $("t3dCamsTodas");
    if (todas) todas.onclick = () => verCamara(null);
    const btnCams = $("t3dCamsBtn"), btnVolver = $("t3dCamsSalir");
    if (btnCams) btnCams.onclick = () => ponerCctv(!cctv);
    if (btnVolver) btnVolver.onclick = () => ponerCctv(false);
  }

  engancharHUD();

  /* Los toques del canvas viven aparte: si el navegador suelta el contexto
     WebGL hay que cambiar el <canvas> por uno nuevo y volver a cablearlos
     (ver `abrir()` → «la gráfica se reinició»). */
  function engancharCanvas(caja) {
    caja.addEventListener("pointerdown", (e) => {
      caja.setPointerCapture(e.pointerId);
      const h = rayo(e.clientX, e.clientY, puertas);
      if (h.length) {
        let obj = h[0].object;
        while (obj && obj.userData.min === undefined) obj = obj.parent;
        if (obj && obj.userData.min !== undefined) {
          puerta = { grupo: obj, x0: e.clientX, base: obj.position.x, movido: 0, id: e.pointerId };
          return;
        }
      }
      mirar = { x: e.clientX, y: e.clientY, movido: 0, id: e.pointerId };
    });

    caja.addEventListener("pointermove", (e) => {
      if (puerta) {
        if (e.pointerId !== puerta.id) return;
        const dx = (e.clientX - puerta.x0) * 0.006;
        puerta.grupo.position.x = Math.max(puerta.grupo.userData.min,
          Math.min(puerta.grupo.userData.max, puerta.base + dx));
        puerta.movido += Math.abs(e.clientX - puerta.x0);
        return;
      }
      if (!mirar || e.pointerId !== mirar.id) return;
      const dx = e.clientX - mirar.x;
      const dy = e.clientY - mirar.y;
      mirar.movido += Math.abs(dx) + Math.abs(dy);
      yaw -= dx * 0.0062 * sensCam;
      pitch = Math.max(-0.9, Math.min(0.9, pitch - dy * 0.005 * sensCam));
      mirar.x = e.clientX; mirar.y = e.clientY;
    });

    caja.addEventListener("pointerup", (e) => {
      if (puerta) {
        if (e.pointerId !== puerta.id) return;
        // un toque sobre el vidrio (sin arrastrar) también abre la ficha
        const toque = puerta.movido < 10;
        puerta = null;
        if (toque) interactuar(e.clientX, e.clientY);
        return;
      }
      if (!mirar || e.pointerId !== mirar.id) return;
      const toque = mirar.movido < 10;
      mirar = null;
      if (toque) interactuar(e.clientX, e.clientY);
    });
    // si el navegador cancela el puntero (llamada, gesto), no queda mirar ni puerta
    caja.addEventListener("pointercancel", () => { puerta = null; mirar = null; });
    caja.addEventListener("lostpointercapture", () => { puerta = null; mirar = null; });
  }

  function enganchar() {
    engancharCanvas($("t3dCanvas"));
    const joyEl = $("t3dJoy");
    engancharStick(joyEl, joy);
    engancharStick($("t3dJoyCam"), joyCam);

    // Panel de iluminación
    const btnLuz = $("t3dLucesBtn"), panelLuz = $("t3dLuces");
    if (btnLuz && panelLuz) {
      btnLuz.onclick = () => {
        const abrir = panelLuz.hidden;
        panelLuz.hidden = !abrir;
        btnLuz.setAttribute("aria-expanded", String(abrir));
      };
      panelLuz.querySelectorAll("[data-luz]").forEach((b) => {
        b.onclick = () => {
          luzActual = b.dataset.luz;
          panelLuz.querySelectorAll("[data-luz]").forEach((x) => x.classList.toggle("on", x === b));
          aplicarLuz();
        };
      });
    }
    const rangoInt = $("t3dInt");
    if (rangoInt) rangoInt.oninput = () => { intensidadLuz = Number(rangoInt.value) / 100; aplicarLuz(); };
    const rangoOrb = $("t3dOrb");
    if (rangoOrb) rangoOrb.oninput = () => { orbitaLuz = Number(rangoOrb.value); aplicarLuz(); };
    const rangoKel = $("t3dKel");
    if (rangoKel) rangoKel.oninput = () => { kelvinLuz = Number(rangoKel.value); aplicarLuz(); };
    const rangoSom = $("t3dSom");
    if (rangoSom) rangoSom.oninput = () => { sombraLuz = Number(rangoSom.value) / 100; aplicarLuz(); };

    // Sensibilidad de cámara (se guarda en el equipo)
    const rangoFov = $("t3dFov");
    if (rangoFov) {
      rangoFov.value = Math.round(fovBase);
      const out = $("t3dFovVal");
      if (out) out.textContent = Math.round(fovBase) + "°";
      rangoFov.oninput = () => {
        fovBase = Number(rangoFov.value) || FOV_DEF;
        fovAct = fovBase;
        if (camera) { camera.fov = fovBase; camera.updateProjectionMatrix(); }
        if (out) out.textContent = Math.round(fovBase) + "°";
        try { localStorage.setItem(CLAVE_FOV, String(fovBase)); } catch (e) { /* privado */ }
      };
    }

    const rangoSen = $("t3dSen");
    if (rangoSen) {
      rangoSen.value = Math.round(sensCam * 100);
      rangoSen.oninput = () => {
        sensCam = Number(rangoSen.value) / 100;
        const out = $("t3dSenVal");
        if (out) out.textContent = rangoSen.value + " %";
        try { localStorage.setItem(CLAVE_SENS, rangoSen.value); } catch (e) { /* privado */ }
      };
    }

    // Calidad: Auto detecta el equipo, el resto la fuerza a mano
    document.querySelectorAll("#t3dCal [data-cal]").forEach((b) => {
      b.onclick = () => {
        calidad = b.dataset.cal;
        try { localStorage.setItem(CLAVE_CAL, calidad); } catch (e) { /* privado */ }
        aplicarCalidad();
      };
    });

    // Volver a la entrada del local (misma rutina que la barra «Tienda»)
    const btnReset = $("t3dReset");
    if (btnReset) btnReset.onclick = aEntrada;

    // Cerrar el panel
    const cerrarPanel = $("t3dLucesX");
    if (cerrarPanel && btnLuz) cerrarPanel.onclick = () => {
      panelLuz.hidden = true;
      btnLuz.setAttribute("aria-expanded", "false");
    };

    // Cámaras: el cableado vive en engancharHUD() (mismo sitio que el resto
    // del HUD); aquí ya no se registra nada para no pisar los handlers.

    // Tirita lateral: oculta o muestra los botones
    const tira = $("t3dTira");
    if (tira) {
      tira.onclick = () => {
        const raiz = $("t3d");
        const off = raiz.classList.toggle("ui-off");
        tira.textContent = off ? "mostrar" : "ocultar";
        tira.setAttribute("aria-pressed", String(off));
      };
    }

    // Pancita de ayuda: explica el menú
    const ayuda = $("t3dAyuda"), panelAyuda = $("t3dAyudaPanel"), okAyuda = $("t3dAyudaOk");
    const cerrarAyuda = () => { if (panelAyuda) panelAyuda.hidden = true; };
    if (ayuda && panelAyuda) ayuda.onclick = () => { panelAyuda.hidden = !panelAyuda.hidden; };
    if (okAyuda) okAyuda.onclick = cerrarAyuda;

    // Ficha del producto: cerrar o añadir al carrito (el vuelo va antes
    // para que la caja salga del estante con la ficha ya fuera)
    const fichaX = $("t3dFichaX"), fichaAdd = $("t3dFichaAdd");
    if (fichaX) fichaX.onclick = cerrarFicha;
    if (fichaAdd) fichaAdd.onclick = () => {
      if (!fichaP) return;
      const p = fichaP, hit = fichaOrigen;
      cerrarFicha();
      volar(p, hit);
      agregar(p);
    };

    // Correr: mantén pulsado
    const btnCorrer = $("t3dCorrer");
    if (btnCorrer) {
      const prender = (e) => { e.preventDefault(); corriendo = true; btnCorrer.classList.add("on"); };
      const apagar = () => { corriendo = false; btnCorrer.classList.remove("on"); };
      btnCorrer.addEventListener("pointerdown", prender);
      btnCorrer.addEventListener("pointerup", apagar);
      btnCorrer.addEventListener("pointercancel", apagar);
      btnCorrer.addEventListener("pointerleave", apagar);
    }

    window.addEventListener("keydown", (e) => {
      teclas[e.code] = true;
      if (e.key === "Escape") cerrarFicha();
    });
    window.addEventListener("keyup", (e) => { teclas[e.code] = false; });
    window.addEventListener("resize", ajustar);
  }

  /* ── Stick virtual ──────────────────────────────────────────────────────
     En el teléfono el dedo casi nunca cae en el centro exacto del aro. Con
     la posición ABSOLUTA (lo que había antes), apoyar el pulgar un poco
     abajo ya mandaba "atrás" sin que el usuario moviera nada, y si el
     `pointermove` se perdía el valor quedaba clavado: por eso solo se
     sentía el retroceso y no el avance ni los lados.

     Ahora el toque fija un ANCLA y el stick mide el DESPLAZAMIENTO desde
     ahí: apoyar no mueve; subir el dedo avanza, bajarlo retrocede y a los
     lados esquiva/gira. El seguimiento va en `window` y se filtra por
     `pointerId`, así que no se corta si el dedo sale del aro y los dos
     sticks (mover + mirar) funcionan a la vez con dos dedos. */
  function engancharStick(el, destino) {
    if (!el) return;
    const perilla = el.querySelector("span");
    let id = null;                 // puntero que controla ESTE stick
    let ax = 0, ay = 0;            // ancla: dónde apoyó el dedo
    let R = 46;                    // radio de recorrido en px (se mide al tocar)
    const ZONA = 0.10;             // zona muerta (10 % del recorrido)
    const curva = (v) => Math.pow(Math.min(1, Math.abs(v)), 1.25);
    const desdeCentro = (v) => {
      const a = Math.abs(v);
      if (a <= ZONA) return 0;
      // el signo se recupera aquí: sin esto el stick solo apuntaba en +X/+Y
      // (siempre atrás y siempre a la derecha), que era el fallo reportado.
      return Math.sign(v) * curva((a - ZONA) / (1 - ZONA));
    };
    const radio = () => {
      const r = el.getBoundingClientRect();
      return Math.max(34, Math.min(r.width, r.height) * 0.44);
    };
    const pintar = (dx, dy) => {
      if (!perilla) return;
      const px = Math.round(dx * 33), py = Math.round(dy * 33);
      perilla.style.transform =
        "translate(calc(-50% + " + px + "px), calc(-50% + " + py + "px))";
    };
    const aplicar = (e) => {
      let dx = (e.clientX - ax) / R;
      let dy = (e.clientY - ay) / R;
      const mag = Math.hypot(dx, dy);
      if (mag > 1) { dx /= mag; dy /= mag; }        // tope en el borde
      pintar(dx, dy);
      destino.x = desdeCentro(dx);
      destino.y = desdeCentro(dy);
    };
    const cero = () => { destino.x = 0; destino.y = 0; pintar(0, 0); };
    const soltarTodo = () => { cero(); id = null; el.classList.remove("activo"); };
    el._resetStick = soltarTodo;     // `cerrar()` lo limpia al salir de la tienda

    el.addEventListener("pointerdown", (e) => {
      if (id !== null) return;                       // ya hay un dedo aquí
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      id = e.pointerId;
      ax = e.clientX;
      ay = e.clientY;
      R = radio();
      cero();                                        // apoyar no mueve
      el.classList.add("activo");
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* no crítico */ }
    });

    const mover = (e) => {
      if (e.pointerId !== id) return;
      aplicar(e);
    };
    const fin = (e) => {
      if (e.pointerId === id) soltarTodo();
    };
    // en window: el evento sigue llegando aunque el dedo salga del aro
    window.addEventListener("pointermove", mover, { passive: true });
    window.addEventListener("pointerup", fin);
    window.addEventListener("pointercancel", fin);
    el.addEventListener("lostpointercapture", fin);
  }

  function actualizarContador() {
    let n = 0;
    try {
      const c = JSON.parse(localStorage.getItem(CLAVE_CARRITO) || "{}") || {};
      n = Object.values(c).reduce((a, b) => a + b, 0);
    } catch (e) { /* nada */ }
    const el = $("t3dCount");
    if (el) { el.textContent = n; el.hidden = n === 0; }
  }

  /* ── texturas HD (CC0) ──────────────────────────────────────────────────
     Piso cerámico, muro de yeso, techo de hormigón y metal de estante en
     1k con su mapa normal. Si alguna no carga (sin red, primer arranque),
     se queda la textura de canvas de fallback sin avisos. */
  /* Sólo muro y metal llevan textura HD. El piso usa la cerámica blanca
     generada por canvas y el techo va en color plano claro: las fotos
     originales de piso (beige) y techo (oscura) no son las que se quieren. */
  const RUTAS_TEX = {
    muro:  ["./texturas/muro-diff.jpg",  "./texturas/muro-nor.jpg"],
    metal: ["./texturas/metal-diff.jpg", "./texturas/metal-nor.jpg"]
  };

  function aplicarTexturasHD() {
    if (!T || !renderer) return;
    const loader = new T.TextureLoader();
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const cargar = (ruta, srgb) => new Promise((ok) => {
      loader.load(ruta, (t) => {
        t.wrapS = t.wrapT = T.RepeatWrapping;
        t.anisotropy = aniso;
        if (srgb) t.encoding = T.sRGBEncoding;
        ok(t);
      }, undefined, () => ok(null));          // fallo silencioso
    });
    /* Relieve sin difusa: para muros sólo interesa el normal map, porque su
       foto de color es gris y apagaría el blanco. */
    const aplicarNormal = (nor, entradas) => {
      if (!nor) return;
      const cache = new Map();
      entradas.forEach((e) => {
        if (!e || !e.mat) return;
        const clave = e.rep[0] + "x" + e.rep[1];
        let n = cache.get(clave);
        if (!n) {
          n = nor.clone();
          n.needsUpdate = true;
          n.repeat.set(e.rep[0], e.rep[1]);
          cache.set(clave, n);
        }
        e.mat.normalMap = n;
        e.mat.normalScale = new T.Vector2(e.nor, e.nor);
        e.mat.needsUpdate = true;
      });
    };
    const aplicar = (base, entradas) => {
      const [diff, nor] = base;
      if (!diff) return;
      // una textura por repetición: los 4 muros y el metal de todos los
      // muebles comparten mapa (hoy 8 cargas en vez de 16)
      const cache = new Map();
      entradas.forEach((e) => {
        if (!e || !e.mat) return;
        const clave = e.rep[0] + "x" + e.rep[1];
        let pack = cache.get(clave);
        if (!pack) {
          pack = { d: diff.clone(), n: nor ? nor.clone() : null };
          pack.d.needsUpdate = true;
          pack.d.repeat.set(e.rep[0], e.rep[1]);
          if (pack.n) {
            pack.n.needsUpdate = true;
            pack.n.repeat.set(e.rep[0], e.rep[1]);
          }
          cache.set(clave, pack);
        }
        e.mat.map = pack.d;
        if (pack.n) {
          e.mat.normalMap = pack.n;
          e.mat.normalScale = new T.Vector2(e.nor, e.nor);
        }
        e.mat.needsUpdate = true;
      });
    };
    /* Piso y techo NO llevan textura HD: la del piso era beige/marrón y
       teñía la cerámica blanca, y la del techo lo dejaba casi negro. Se
       generan por canvas (texturaPiso) y con color plano, respectivamente.
       Así tampoco se descargan dos pares de JPG que no se usaban. */
    Promise.all([
      cargar(RUTAS_TEX.muro[0], true),  cargar(RUTAS_TEX.muro[1], false),
      cargar(RUTAS_TEX.metal[0], true), cargar(RUTAS_TEX.metal[1], false)
    ]).then((t) => {
      aplicarNormal(t[1], refs.muro);      // sólo relieve: el color es blanco
      aplicar([t[2], t[3]], refs.metal);
    }).catch(() => { /* se queda con las texturas de canvas */ });
  }

  /* ── entrada / salida ──────────────────────────────────────────────────── */

  /* Entrega del mapa: el catálogo del local que se va a visitar. Deja todo
     pendiente; `abrir()` reconstruye sólo si el catálogo cambió. */
  function ponerTienda(catalogo, tienda) {
    catPendiente = (catalogo && catalogo.length) ? catalogo : null;
    tiendaActiva = !!tienda;
  }
  function fueDelMapa() { return tiendaActiva; }

  /* Libera la escena (texturas, geometrías y materiales) sin tocar el
     renderer ni los listeners: sirve para cambiar de local. */
  function destruirEscena() {
    if (promoReloj) { clearInterval(promoReloj); promoReloj = null; }
    if (tvReloj) { clearInterval(tvReloj); tvReloj = 0; }
    if (scene) {
      scene.traverse((o) => {
        if (o.geometry && o.geometry.dispose) o.geometry.dispose();
        const mats = !o.material ? [] : (Array.isArray(o.material) ? o.material : [o.material]);
        mats.forEach((m) => {
          if (!m) return;
          ["map", "normalMap", "emissiveMap", "specularMap"].forEach((k) => {
            if (m[k] && m[k].dispose) m[k].dispose();
          });
          if (m.dispose) m.dispose();
        });
      });
    }
    scene = null;
    escenaOk = false;
    catUsada = null;
    CACHE_ETQ.clear();                 // las texturas ya se liberaron arriba
    refs = { piso: null, muro: [], techo: [], metal: [] };
    mallasGondola = []; mallasCong = []; mallasProd = [];
    frescosMallas = 0; refriMallas = 0; senalesMallas = 0; anunciosMallas = 0;
    frescosPilas = []; tapasGondola = []; luzFresca = null;
    puertas = []; tv = null; tvTextura = null; tvCanvas = null;
    luzTV = null; camaras = []; carrito = null; carritoRuedas = [];
    promos = []; vuelos = [];
    cerrarFicha();
    precioActual = null;
  }

  /* ── Recuperación de la gráfica ───────────────────────────────────────────
     Cuando `forceContextRestore()` no devuelve el contexto (SwiftShader y
     GPUs móviles agotadas), se tira el renderer viejo y se monta uno nuevo
     sobre un <canvas> nuevo con el mismo id. La escena, el catálogo y el
     carrito no se tocan: three.js vuelve a subir texturas y geometrías al
     contexto nuevo al primer render. */
  function reconstruirRenderer() {
    restoreTimer = 0;
    try { if (renderer) renderer.dispose(); } catch (e) { /* ya suelto */ }
    renderer = null;
    listo = false;

    const viejo = $("t3dCanvas");
    if (viejo && viejo.parentNode) {
      const nuevo = document.createElement("canvas");
      nuevo.id = "t3dCanvas";
      nuevo.className = viejo.className;
      nuevo.setAttribute("aria-label",
        viejo.getAttribute("aria-label") || "Escena 3D de la tienda");
      viejo.parentNode.replaceChild(nuevo, viejo);
      engancharCanvas(nuevo);              // los toques van al canvas nuevo
    }
    // la escena sigue montada: al volver a `abrir()` sólo se recrea el renderer
    escenaOk = true;
    abrir().catch(() => { /* el propio abrir() pinta su error */ });
  }

  async function abrir() {
    let caja = $("t3dCanvas");
    if (!caja) return;
    vivo = true;
    document.body.classList.add("en-tienda");   // nav y topbar ocultos
    $("t3dCargando").hidden = false;

    try {
      /* La prueba de WebGL y el perfil se calculan UNA vez: cada `abrir()`
         (p. ej. tras «Reintentar») creaba un contexto de prueba y otro para
         detectar la GPU, y el navegador agota los contextos vivos → a la
         tercera vez devolvía null y la app decía «no tiene WebGL» con la
         tarjeta claramente funcionando. */
      if (glOk === null) {
        const prueba = document.createElement("canvas");
        const gl = prueba.getContext("webgl2") || prueba.getContext("webgl");
        glOk = !!gl;
        if (gl) {
          // se suelta ya: sólo servía para saber si había motor gráfico
          const lose = gl.getExtension("WEBGL_lose_context");
          if (lose) lose.loseContext();
        }
      }
      if (!glOk) throw new Error("WebGL no disponible");
      T = await cargarThree();

      if (!perfilListo) { perfil = detectarPerfil(); perfilListo = true; }

      /* Si el navegador suelta el contexto, primero se pide recuperarlo en el
         mismo <canvas> (`forceContextRestore()`): three.js vuelve a subir las
         texturas y la escena sigue viva. Si en 1,5 s no regresa (pasa en
         SwiftShader y en GPUs móviles agotadas), se reconstruye el renderer
         sobre un <canvas> nuevo con el mismo id: la escena y el catálogo no
         se tocan, sólo se vuelve a crear la superficie de dibujo. */
      let ctxPerdido = false;
      if (renderer) {
        try { ctxPerdido = !!renderer.getContext().isContextLost(); } catch (e) { ctxPerdido = true; }
      }
      if (ctxPerdido) {
        const c = $("t3dCargando");
        if (c) {
          c.hidden = false;
          c.innerHTML = '<div class="t3d-error"><b>Restaurando la gráfica…</b>' +
            "<p>El navegador está devolviendo el contexto de dibujo.</p></div>";
        }
        if (!restoreTimer) {
          try { renderer.forceContextRestore(); } catch (e) { /* sin extensión */ }
          restoreTimer = setTimeout(() => {
            restoreTimer = 0;
            let sigue = false;
            try { sigue = !!(renderer && renderer.getContext().isContextLost()); } catch (e) { sigue = true; }
            if (sigue) reconstruirRenderer(); else {
              const cc = $("t3dCargando");
              if (cc) cc.hidden = true;
            }
          }, 1500);
        }
        return;
      }
      restoreTimer = 0;

      if (!listo || !renderer) {
        renderer = new T.WebGLRenderer({
          canvas: caja, antialias: perfil === "alta", powerPreference: "high-performance"
        });
        renderer.setPixelRatio(Math.min(1.3, window.devicePixelRatio || 1));
        renderer.outputEncoding = T.sRGBEncoding;
        renderer.toneMapping = T.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 0.92;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = T.PCFSoftShadowMap;
        /* La sombra se recalcula por tandas (ver bucle): el local es casi
           estático y recalcularla en cada frame era el gasto más grande. */
        renderer.shadowMap.autoUpdate = false;
        renderer.shadowMap.needsUpdate = true;

        /* Un renderer nuevo (tras perder el contexto) invalida la textura
           del entorno: se vuelve a generar. */
        entornoMap = null;
        crearEntorno();

        caja.addEventListener("webglcontextlost", (e) => {
          e.preventDefault();
          const c = $("t3dCargando");
          if (!c) return;
          c.hidden = false;
          c.innerHTML = '<div class="t3d-error">' +
            "<b>La gráfica se reinició</b>" +
            "<p>El navegador liberó la tarjeta de video. Toca para volver a intentarlo.</p>" +
            '<button type="button" id="t3dReintentar">Reintentar</button></div>';
          const b = $("t3dReintentar");
          if (b) b.onclick = () => { c.hidden = true; abrir(); };
        }, false);
        caja.addEventListener("webglcontextrestored", () => {
          const c = $("t3dCargando");
          if (c) c.hidden = true;
        }, false);

        try {
          const cal = localStorage.getItem(CLAVE_CAL);
          if (cal && (cal === "auto" || NIVELES_CALIDAD[cal])) calidad = cal;
          const se = Number(localStorage.getItem(CLAVE_SENS));
          if (se >= 40 && se <= 180) sensCam = se / 100;
          const gq = localStorage.getItem(CLAVE_GRAB);
          if (gq && GRAB_NIVELES[gq]) grabCalidad = gq;
          pintarNivelGrab();
          const fv = Number(localStorage.getItem(CLAVE_FOV));
          if (fv >= 50 && fv <= 110) { fovBase = fv; fovAct = fv; camera.fov = fv; camera.updateProjectionMatrix(); }
        } catch (e) { /* modo privado */ }
        listo = true;
      }
      /* Catálogo: el que dejó el mapa (local abierto) o el del marketplace.
         Sólo se reconstruye si cambió: entrar dos veces al mismo local no
         vuelve a cargar la escena. */
      const catalogo = catPendiente ||
        ((window.Mercado && window.Mercado.productos) ? window.Mercado.productos() : []) || [];
      if (escenaOk && catUsada !== catalogo) destruirEscena();
      if (!escenaOk) {
        construir(catalogo);
        catUsada = catalogo;
        escenaOk = true;
        aplicarTexturasHD();
        /* Compila los shaders antes del primer frame: sin esto, el teléfono
           se traba justo al entrar (la compilación se reparte en frames). */
        try { renderer.compile(scene, camera); } catch (e) { /* sin soporte */ }
      }
      if (!enganchado) { enganchar(); enganchado = true; }
      aplicarCalidad();
      aplicarLuz();
      engancharResize();
      ajustar();
      requestAnimationFrame(ajustar);
      setTimeout(ajustar, 260);
      $("t3dCargando").hidden = true;
      reloj.start();
      bucle();
      actualizarCompra();
      pintarMapa();
    } catch (e) {
      const cajaErr = $("t3dCargando");
      const msg = String((e && e.message) || e);
      ultimoError = msg;                 // visible en window.__t3d().err3d
      const sinWebgl = /WebGL/i.test(msg);
      cajaErr.hidden = false;
      cajaErr.innerHTML =
        '<div class="t3d-error">' +
          "<b>" + (sinWebgl ? "Tu navegador no tiene WebGL activo" : "No se pudo abrir la tienda 3D") + "</b>" +
          "<p>" + (sinWebgl
            ? "La vista caminable necesita WebGL. Puedes ver el mismo catálogo en estantes."
            : "Detalle: " + msg) + "</p>" +
          '<button type="button" id="t3dFallback">Ver los estantes</button>' +
        "</div>";
      const b = $("t3dFallback");
      if (b) b.onclick = () => { if (window.Fabri) window.Fabri.go("mercado"); };
    }
  }

  function cerrar() {
    vivo = false;
    const nv = $("t3dNav");
    if (nv) nv.hidden = true;
    document.body.classList.remove("en-tienda");  // vuelve la navegación
    puerta = null;
    mirar = null;
    abrirMapa(false);                    // no reaparece el plano al volver
    ponerCctv(false);
    corriendo = false;
    vel.x = vel.z = 0;
    joy.x = joy.y = joyCam.x = joyCam.y = 0;
    joyS.x = joyS.y = joyCamS.x = joyCamS.y = 0;
    // si un dedo quedó sobre un stick, se suelta: al volver no debe estar "pegado"
    ["t3dJoy", "t3dJoyCam"].forEach((id) => {
      const e = $(id);
      if (e && e._resetStick) e._resetStick();
    });
    const btn = $("t3dCorrer");
    if (btn) btn.classList.remove("on");
    const caja = $("t3dPrecio");
    if (caja) caja.hidden = true;
    if (grabandoAhora()) detenerGrabacion();
    if (SONIDO.activo) sonidoActivar(false);
    cerrarFicha();
    if (promoReloj) { clearInterval(promoReloj); promoReloj = null; }
    if (tvReloj) { clearInterval(tvReloj); tvReloj = 0; }
  }

  window.__t3d = () => ({
    ok: !!renderer, hijos: scene ? scene.children.length : 0,
    w: renderer ? renderer.domElement.width : 0, h: renderer ? renderer.domElement.height : 0,
    vivo: vivo, frames: frames,
    puertas: puertas.length, tv: !!tv,
    // materiales con mapa HD compartidos: piso, 1 muro, techo y 5 de metal
    // (los 4 muros comparten textura y el metal de muebles y carrito, otra)
    texHD: [refs.piso]
      .concat(refs.muro.map((e) => e.mat), refs.techo.map((e) => e.mat),
              refs.metal.map((e) => e.mat))
      .filter((m) => m && m.map).length,
    // mallas seleccionables: niveles de góndola + niveles de nevera
    gond: mallasGondola.length, cong: mallasCong.length,
    frescos: frescosMallas, refri: refriMallas,
    frescosN: frescosPilas.reduce((n, e) => n + (e.mesh ? e.mesh.count : 0), 0),
    senales: senalesMallas, anuncios: anunciosMallas,
    cal: calidad === "auto" ? perfil : calidad,
    decoErr: decoErr,
    ficha: !!fichaP, fichaNom: fichaP ? fichaP.nombre : "", vuelos: vuelos.length,
    local: tiendaActiva, cat: !!catPendiente, escena: escenaOk,
    err3d: ultimoError,
    /* Estado real de los materiales de piso y techo y de la luz base:
       sirve para verificar la cerámica blanca sin depender de una captura
       (en headless el contexto WebGL muere a los pocos segundos). */
    mat: {
      piso: refs.piso ? {
        color: "#" + refs.piso.color.getHexString(),
        brillo: refs.piso.shininess,
        especular: "#" + (refs.piso.specular ? refs.piso.specular.getHexString() : ""),
        mapaLienzo: !!(refs.piso.map && refs.piso.map.image && refs.piso.map.image.tagName === "CANVAS"),
        repeticion: refs.piso.map ? [refs.piso.map.repeat.x, refs.piso.map.repeat.y] : null
      } : null,
      techo: refs.techo[0] ? {
        color: "#" + refs.techo[0].mat.color.getHexString(),
        tieneMapa: !!refs.techo[0].mat.map
      } : null,
      muro: refs.muro[0] ? {
        color: "#" + refs.muro[0].mat.color.getHexString(),
        mapaLienzo: !!(refs.muro[0].mat.map && refs.muro[0].mat.map.image
          && refs.muro[0].mat.map.image.tagName === "CANVAS"),
        relieve: !!refs.muro[0].mat.normalMap
      } : null,
      tv: (() => {
        if (!tvGrupoRef || !T) return null;
        const caja = new T.Box3().setFromObject(tvGrupoRef);
        return {
          muroEn: +(-ANCHO / 2).toFixed(3),
          minX: +caja.min.x.toFixed(3),
          maxX: +caja.max.x.toFixed(3),
          atraviesaMuro: caja.min.x < -ANCHO / 2,
          holguraMuro: +(caja.min.x + ANCHO / 2).toFixed(3)
        };
      })(),
      luz: {
        amb: luces.amb ? +luces.amb.intensity.toFixed(3) : null,
        hemi: luces.hemi ? +luces.hemi.intensity.toFixed(3) : null,
        sol: luces.sol ? +luces.sol.intensity.toFixed(3) : null,
        kelvin: kelvinLuz,
        ledTecho: leds.techo
      }
    },
    // diagnóstico del movimiento: los sticks crudos y la pose del jugador
    joy: { x: +joy.x.toFixed(3), y: +joy.y.toFixed(3) },
    jcam: { x: +joyCam.x.toFixed(3), y: +joyCam.y.toFixed(3) },
    pose: { x: +pos.x.toFixed(3), z: +pos.z.toFixed(3), yaw: +yaw.toFixed(3) },
    // HUD: qué hay montado y qué dice el pedido (sale del carrito comercial)
    hud: {
      mapa: !!$("t3dMapaC"),
      plano: !!($("t3dMapaFull") && !$("t3dMapaFull").hidden),
      nav: document.querySelectorAll(".t3d-nav [data-ir]").length,
      leds: document.querySelectorAll("#t3dLeds [data-led]").length,
      led: Object.assign({}, leds),
      // visibilidad REAL de los grupos en la escena (no sólo el botón)
      ledVis: {
        techo: grupoLED.techo ? grupoLED.techo.visible : null,
        estante: grupoLED.estante ? grupoLED.estante.visible : null,
        decor: grupoLED.decor ? grupoLED.decor.visible : null
      },
      cams: document.querySelectorAll("#t3dCamsGrid [data-cam]").length,
      cctv: cctv, camSolo: camSolo,
      prod: $("t3dCompProd") ? $("t3dCompProd").textContent : "",
      unid: $("t3dCompUnid") ? $("t3dCompUnid").textContent : "",
      total: $("t3dCompTotal") ? $("t3dCompTotal").textContent : ""
    },
    fov: camera ? Math.round(camera.fov) : 0,
    fovBase: fovBase,
    perfil: perfil, calidad: calidad,
    cam: camera ? {
      x: +camera.position.x.toFixed(3),
      y: +camera.position.y.toFixed(3),
      z: +camera.position.z.toFixed(3),
      rotZ: +camera.rotation.z.toFixed(4)
    } : null,
    cesta: cestaItems.length,
    cestaPos: cestaItems.map((it) => [
      +it.mesh.position.x.toFixed(2), +it.mesh.position.y.toFixed(2),
      +it.mesh.position.z.toFixed(2), +it.mesh.scale.x.toFixed(2)
    ]),
    rec: grabandoAhora(),
    grabTam: grabPrevio ? [grabPrevio.sw, grabPrevio.sh] : null,
    sonido: SONIDO.activo,
    pantalla: (camera && renderer && renderer.domElement) ? [
      renderer.domElement.width, renderer.domElement.height,
      +camera.aspect.toFixed(3), +camera.fov.toFixed(1)
    ] : null,
    perdido: !!(renderer && renderer.getContext && renderer.getContext().isContextLost()),
    glerr: renderer && renderer.getContext ? renderer.getContext().getError() : -1
  });

  return {
    abrir, cerrar, ponerTienda, fueDelMapa,
    // prueba de la ficha desde la consola: Tienda3D.ficha(0)
    ficha: (i) => {
      const m = mallasProd[Math.max(0, Math.min(mallasProd.length - 1, i || 0))];
      const p = m && m.userData.mapa && m.userData.mapa[0];
      if (p) abrirFicha(p, null);
      return !!p;
    }
  };
})();
