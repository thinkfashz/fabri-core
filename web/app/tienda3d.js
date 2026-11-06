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
  let puertas = [], tv = null, tvTextura = null, tvCanvas = null;
  let raycaster, puntero;
  let yaw = 0, pitch = 0;
  const pos = { x: 0, y: 1.66, z: 8.2 };   // altura de los ojos: 1ª persona
  const vel = { x: 0, z: 0 };              // inercia: arranca y frena suave
  const FOV_BASE = 68;                     // encuadre humano, no pezón
  let fovAct = FOV_BASE;
  const teclas = {};
  let joy = { x: 0, y: 0 };
  let joyCam = { x: 0, y: 0 };
  const joyS = { x: 0, y: 0 }, joyCamS = { x: 0, y: 0 };   // versión suavizada
  let corriendo = false;
  let carrito = null, carritoRuedas = [], carritoAnim = 0;
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
    confort: { amb: 0.42, hemi: 0.46, dir: 0.78, rell: 0.26, color: 0xfff8ef, exp: 1.00,
      desc: "Espacio cálido y confortable: luz ámbar suave con sombras de contacto." },
    calido:  { amb: 0.27, hemi: 0.30, dir: 0.56, rell: 0.18, color: 0xffe0b0, exp: 0.97,
      desc: "Luz de tienda de barrio: tono ámbar y sombras marcadas." },
    neutro:  { amb: 0.31, hemi: 0.35, dir: 0.58, rell: 0.24, color: 0xffffff, exp: 0.95,
      desc: "Luz pareja de supermercado: blanco neutro y sombras suaves." },
    frio:    { amb: 0.28, hemi: 0.32, dir: 0.52, rell: 0.28, color: 0xd6e9ff, exp: 0.95,
      desc: "Tono de cámara frigorífica: azulado y limpio." },
    cine:    { amb: 0.15, hemi: 0.16, dir: 0.92, rell: 0.10, color: 0xfff3e0, exp: 0.88,
      desc: "Contraste cinematográfico: sombras profundas y foco cálido." },
    lima:    { amb: 0.25, hemi: 0.30, dir: 0.56, rell: 0.20, color: 0xf2ffe0, exp: 0.97,
      desc: "Resplandor lima FORGE: contra-luz verde sobre muros negros." }
  };
  let luzActual = "confort", intensidadLuz = 1, orbitaLuz = 20;
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
  const NIVELES_CALIDAD = {
    alta:  { pr: 1.45, sombra: 2048, puntos: true },
    media: { pr: 1.15, sombra: 1024, puntos: true },
    baja:  { pr: 1.0,  sombra: 512,  puntos: false }
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
    c.width = c.height = 256;
    const g = c.getContext("2d");
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
    // El lienzo sigue la proporción del tablero (si no, el texto sale
    // estirado). `altoCanvas` permite usar la misma tira en estantes de
    // 8,86 m o en las neveras de 2,16 m sin perder nítidez.
    const W = anchoCanvas || 4096, H = altoCanvas || 128;
    const e = H / 128;                       // escala tipográfica
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    g.fillStyle = "#f6f1df"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#c8ff00"; g.fillRect(0, 0, Math.round(W * 0.012), H);
    const barra = Math.round(W * 0.012);
    const n = Math.max(1, items.length);
    const celda = (W - barra) / n;

    /* Un producto por estante (como en un súper de verdad): nombre a la
       izquierda y precio a la derecha, ambos en tamaño grande. Con96 px de
       alto mapeando los 0,27 m del placo, un precio de 60 px son ~17 cm:
       se lee desde el otro extremo del pasillo. */
    if (n === 1) {
      const p = items[0] || {};
      const m = Math.round(W * 0.022);
      g.textBaseline = "middle";
      g.textAlign = "left";
      let fs = Math.round(H * 0.46);
      const nom = String(p.nombre || "");
      do {
        g.font = "800 " + fs + "px -apple-system, Segoe UI, Roboto, sans-serif";
        if (g.measureText(nom).width <= W * 0.55) break;
        fs -= Math.max(2, Math.round(H * 0.04));
      } while (fs > Math.round(H * 0.24));
      g.fillStyle = "#101214";
      g.fillText(nom, barra + m, H * 0.52);

      const txt = "$" + Math.round(p.precio || 0).toLocaleString("es-CL");
      let fp = Math.round(H * 0.62);
      do {
        g.font = "900 " + fp + "px -apple-system, Segoe UI, Roboto, sans-serif";
        if (g.measureText(txt).width <= W * 0.32) break;
        fp -= Math.max(2, Math.round(H * 0.04));
      } while (fp > Math.round(H * 0.32));
      const anchoPrecio = g.measureText(txt).width;
      g.textAlign = "right";
      g.fillStyle = "#101214";
      g.fillText(txt, W - m, H * 0.52);
      g.font = "700 " + Math.round(H * 0.18) + "px -apple-system, Segoe UI, Roboto, sans-serif";
      g.fillStyle = "rgba(27,26,20,.55)";
      g.fillText("c/u", W - m - anchoPrecio - Math.round(H * 0.16), H * 0.58);

      const t1 = new T.CanvasTexture(c);
      t1.encoding = T.sRGBEncoding;
      t1.anisotropy = anisoMax();
      return t1;
    }

    const maxNom = Math.max(6, Math.floor((celda - 30 * e) / (12.6 * e)));
    items.forEach((p, i) => {
      const x = barra + i * celda;
      if (i) { g.fillStyle = "rgba(27,26,20,.16)"; g.fillRect(x, 12 * e, 1, H - 24 * e); }
      g.textAlign = "left"; g.textBaseline = "alphabetic";
      g.fillStyle = "#3d3a33";
      g.font = "700 " + Math.round(24 * e) + "px -apple-system, Segoe UI, Roboto, sans-serif";
      g.fillText(String(p.nombre || "").slice(0, maxNom), x + 13 * e, 42 * e);
      g.fillStyle = "#101214";
      g.font = "900 " + Math.round(44 * e) + "px -apple-system, Segoe UI, Roboto, sans-serif";
      g.fillText("$" + Math.round(p.precio || 0).toLocaleString("es-CL"), x + 13 * e, 100 * e);
      if (H >= 100) {
        g.fillStyle = "rgba(27,26,20,.55)";
        g.font = Math.round(15 * e) + "px -apple-system, Segoe UI, Roboto, sans-serif";
        g.fillText("c/u", x + 13 * e, 120 * e);
      }
    });
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
    return g;
  }

  function actualizarCarrito(dt) {
    if (!carrito) return;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let dist = 1.5;
    while (dist > 0.5 && choca(pos.x + fx * dist, pos.z + fz * dist)) dist -= 0.14;
    const tx = pos.x + fx * dist, tz = pos.z + fz * dist;
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

  /* ── construcción ──────────────────────────────────────────────────────── */
  function construir(catalogo) {
    scene = new T.Scene();
    scene.background = new T.Color(0x08090a);
    scene.fog = new T.Fog(0x0c0e10, 20, 46);
    refs = { piso: null, muro: [], techo: [], metal: [] };
    // los grupos LED viven dentro de la escena: al reconstruir quedan en
    // null y los vuelven a crear los bloques de techo, estante y decor
    grupoLED.techo = null; grupoLED.estante = null; grupoLED.decor = null;
    reflejoPiso = null; mallaLedEstante = null; mallaGlowEstante = null;
    // si se reconstruye (otro local del mapa), todo lo anterior se descarta
    puertas = [];
    tv = null;
    luzTV = null;
    vuelos = [];
    mallasGondola = [];
    mallasCong = [];
    mallasProd = [];

    camera = new T.PerspectiveCamera(FOV_BASE, 1, 0.05, 70);

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
    sol.shadow.camera.left = -14;
    sol.shadow.camera.right = 14;
    sol.shadow.camera.top = 13;
    sol.shadow.camera.bottom = -13;
    sol.shadow.camera.far = 32;
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
    luces.puntos = [-6, 0, 6].reduce((acc, x) => acc.concat([[x, -3.35], [x, 3.35]]), []).map(([x, z]) => {
      const p = new T.PointLight(0xffe6c4, 0.36, 12, 2);
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
        map: texturaReflejo(), transparent: true, opacity: 0.34,
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
      new T.MeshLambertMaterial({ color: 0xe4e7e9 })
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
    const pared = new T.MeshLambertMaterial({ color: 0xe6e7e3 });
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
    panelTV.position.set(-ANCHO / 2 + 0.012, 1.85, -7);
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
          new T.PlaneGeometry(1.7, 0.42),
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
    const geo = new T.BoxGeometry(0.22, 0.28, 0.16);
    const paso = 0.31;
    const porFila = Math.floor(G_LARGO / paso) - 1;
    mallasGondola = [];
    mallasCong = [];

    const m4 = new T.Matrix4();
    const q = new T.Quaternion();
    const esc = new T.Vector3();
    const color = new T.Color();

    GONDOLAS.forEach((gx, gi) => {
      const cat = porGondola[gi % porGondola.length];
      const lista = catalogo.filter((p) => p.categoria === cat);
      const bolsa = (lista.length ? lista : catalogo).length
        ? (lista.length ? lista : catalogo)
        : [{ nombre: "Producto", precio: 0, categoria: cat }];

      NIVELES.forEach((y, ni) => {
        const p = bolsa[(gi * NIVELES.length + ni) % bolsa.length];
        // portada del envase: canvas vectorial propio, 256² ≈ 260 kB
        const portada = texturaPortada({
          cat: p.categoria || cat, nombre: p.nombre, texto: p.nombre,
          picto: pictoDe(p), conNombre: true, S: 256
        });
        const mat = new T.MeshLambertMaterial({ color: 0xffffff, map: portada });

        const caras = [];
        [1, -1].forEach((lado) => {
          for (let c = 0; c < porFila; c++) {
            if (c % 7 === 6) continue;      // un hueco cada 7: bloques de 6
            caras.push({ lado: lado, c: c });
          }
        });

        const mesh = new T.InstancedMesh(geo, mat, Math.max(1, caras.length));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        caras.forEach((d, i) => {
          const alto = 0.24 + ((i + d.c) % 3) * 0.05;
          const ancho = 0.19 + ((i + ni) % 3) * 0.03;
          const x = gx + d.lado * (G_ANCHO / 2 - 0.12);
          const z = -G_LARGO / 2 + 0.6 + d.c * paso;
          m4.compose(
            new T.Vector3(x, y + alto / 2 + 0.03, z),
            q,
            esc.set(ancho / 0.22, alto / 0.28, 1)
          );
          mesh.setMatrixAt(i, m4);
          // la portada manda: sólo variación de brillo entre unidades
          const brillo = 0.94 + ((i % 5) - 2) * 0.03;
          color.setRGB(brillo, brillo, brillo);
          mesh.setColorAt(i, color);
        });
        mesh.count = caras.length;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.userData.mapa = caras.map(() => p);
        scene.add(mesh);
        mallasGondola.push(mesh);

        // tira del estante: el producto del nivel, precio en grande
        const matTira = new T.MeshBasicMaterial({
          map: texturaTira([p], 3072, 96), side: T.DoubleSide
        });
        [1, -1].forEach((lado) => {
          const tira = new T.Mesh(new T.PlaneGeometry(G_LARGO - 0.14, 0.27), matTira);
          tira.position.set(gx + lado * (G_ANCHO / 2 + 0.013), y - 0.095, 0);
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

    // Portada por estante de congelados (una por nivel, compartida por las
    // 7 neveras): cajas y bolsas llevan envase dibujado; botellas y tubos
    // conservan el color del plástico.
    const TIT_CONG = ["Cocina", "Helados", "Bebidas", "Postres"];
    const PICTO_CONG = ["caja", "tubo", "botella", "bolsa"];
    const matCajaCong = CONG_NIVELES.map((items, ni) => new T.MeshLambertMaterial({
      color: 0xffffff,
      map: texturaPortada({ cat: "Congelados", texto: TIT_CONG[ni], picto: PICTO_CONG[ni], S: 256 })
    }));

    // una tira por estante, compartida por las 7 neveras
    const tirasCong = CONG_NIVELES.map((n) => texturaTira(n, 1536, 128));

    // productos instanciados: 2 draw calls por nevera en vez de 60 sueltos
    const geoCajaC = new T.BoxGeometry(1, 1, 1);
    const geoCilC = new T.CylinderGeometry(0.5, 0.5, 1, 10);
    const matProd = new T.MeshLambertMaterial({ color: 0xffffff });
    const COLS = {
      caja: [0xff8a3d, 0xe8c87a, 0xd98a3d, 0xffb020],
      bolsa: [0x6fbf73, 0x3ddc84, 0x9fd88f, 0xc8f542],
      tubo: [0xff9ec4, 0xb48cff, 0xffd6e7, 0xc8b6ff],
      botella: [0x9fd8ff, 0xffffff, 0xcfe9ff, 0xffe3ef]
    };
    const UP = new T.Vector3(0, 1, 0);
    // sombra de contacto: mancha suave bajo el mueble, como en un local real
    const contacto = new T.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false
    });

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
        new T.PlaneGeometry(W_CONG + 0.5, D_CONG + 0.75), contacto
      );
      sombraPiso.rotation.x = -Math.PI / 2;
      sombraPiso.position.set(0, 0.012, 0.12);
      g.add(sombraPiso);

      const bufer = { caja: [[], [], [], []], cil: [] };

      // 4 estantes: repisa + tira de precios + dos filas de productos
      CONG_NIVELES.forEach((items, ni) => {
        const sy = NIV_CONG[ni];
        caja(W_CONG - 0.2, 0.045, D_CONG - 0.16, 0, sy, -0.02, repisa);

        const tira = new T.Mesh(
          new T.PlaneGeometry(W_CONG - 0.24, 0.18),
          new T.MeshBasicMaterial({ map: tirasCong[ni], side: T.DoubleSide })
        );
        tira.position.set(0, sy - 0.075, D_CONG / 2 - 0.08);
        g.add(tira);

        [0.2, -0.12].forEach((z, fila) => {
          items.forEach((it, k) => {
            const alto = it.tipo === "botella" ? 0.26 : it.tipo === "tubo" ? 0.14
              : it.tipo === "bolsa" ? 0.26 : 0.2;
            const ancho = it.tipo === "botella" ? 0.1 : it.tipo === "tubo" ? 0.17
              : it.tipo === "bolsa" ? 0.24 : 0.3;
            const fondo = it.tipo === "bolsa" ? 0.12 : it.tipo === "caja" ? 0.2 : 0.1;
            const m = new T.Matrix4();
            m.compose(
              new T.Vector3(-0.92 + k * 0.368 + (fila ? 0.05 : 0),
                            sy + 0.025 + alto / 2, z),
              new T.Quaternion().setFromAxisAngle(UP, (((k + fila) % 3) - 1) * 0.12),
              new T.Vector3(ancho, alto, fondo)
            );
            const esCaja = it.tipo === "caja" || it.tipo === "bolsa";
            const prod = {
              id: "cong-" + ni + "-" + k, nombre: it.nombre,
              categoria: "Congelados", precio: it.precio, tipo: it.tipo,
              stock: 8 + ((ni * 7 + k * 5) % 26)
            };
            const d = { m: m, color: COLS[it.tipo][(k + fila) % 4], p: prod };
            if (esCaja) bufer.caja[ni].push(d); else bufer.cil.push(d);
          });
        });
      });

      const tmpC = new T.Color();
      // una malla por nivel (caja/bolsa con portada) y otra por las redondas
      const armar = (arr, geo, mat) => {
        if (!arr || !arr.length) return;
        const mesh = new T.InstancedMesh(geo, mat, arr.length);
        const conMapa = !!(mat && mat.map);
        arr.forEach((d, k) => {
          mesh.setMatrixAt(k, d.m);
          if (conMapa) tmpC.setRGB(0.95, 0.95, 0.95);   // la portada manda
          else tmpC.setHex(d.color);
          mesh.setColorAt(k, tmpC);
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.mapa = arr.map((d) => d.p);
        g.add(mesh);
        mallasCong.push(mesh);
      };
      bufer.caja.forEach((arr, ni) => armar(arr, geoCajaC, matCajaCong[ni]));
      armar(bufer.cil, geoCilC, matProd);

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
    [-7.65, -5.1, -2.55, 0, 2.55, 5.1, 7.65].forEach((cx) => crearCongelador(cx, -LARGO / 2 + 0.55, 0));

    /* televisor en la esquina del fondo, con su herraje de pared */
    const tvGrupo = new T.Group();
    tvGrupo.position.set(-ANCHO / 2 + 0.14, 2.35, -LARGO / 2 + 2.6);
    tvGrupo.scale.setScalar(1.15);
    tvGrupo.rotation.y = Math.PI / 2 - 0.55;

    tv = crearTV();
    tv.position.set(0.09, 0, 0.30);
    tvGrupo.add(tv);

    const negro = new T.MeshLambertMaterial({ color: 0x14171a });
    const metalTV = new T.MeshLambertMaterial({ color: 0x4a5056 });
    const marcoTV = new T.Mesh(new T.BoxGeometry(2.12, 1.24, 0.07), negro);
    marcoTV.position.set(0.09, 0, 0.26);
    tvGrupo.add(marcoTV);
    // brazo y placa contra la pared
    const brazo = new T.Mesh(new T.BoxGeometry(0.5, 0.06, 0.06), metalTV);
    brazo.position.set(0.09, 0, 0.02);
    tvGrupo.add(brazo);
    const placa = new T.Mesh(new T.BoxGeometry(0.34, 0.34, 0.04), metalTV);
    placa.position.set(0.09, 0, -0.2);
    tvGrupo.add(placa);
    const cable = new T.Mesh(new T.BoxGeometry(0.03, 0.9, 0.03), negro);
    cable.position.set(-0.1, 0.55, 0.02);
    tvGrupo.add(cable);
    scene.add(tvGrupo);

    // resplandor verde del televisor sobre el pasillo
    luzTV = new T.PointLight(0xd9ffa8, 0.55, 5.5, 2);
    luzTV.position.set(-8.04, 2.4, -7.02);
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

    carrito = crearCarrito();
    carrito.scale.setScalar(1.05);
    carrito.position.set(pos.x, 0, pos.z - 1.5);
    carrito.rotation.y = yaw;
    scene.add(carrito);

    crearCamaras();
    aplicarLEDs();

    mallasProd = mallasGondola.concat(mallasCong);
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
      p.intensity = 0.36 * intensidadLuz * (0.6 + 0.4 * relleno) * kTecho;
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
    renderer.shadowMap.enabled = true;
    const sh = luces.sol.shadow;
    if (sh.mapSize.x !== q.sombra) {
      sh.mapSize.set(q.sombra, q.sombra);
      if (sh.map) { sh.map.dispose(); sh.map = null; }   // se regenera al tamaño nuevo
    }
    luces.puntos.forEach((p, i) => { p.visible = q.puntos || i < 2; });
    ajustar();
    const etq = $("t3dCalNivel");
    if (etq) etq.textContent = nivel;
    document.querySelectorAll("#t3dCal [data-cal]").forEach((b) => {
      b.classList.toggle("on", b.dataset.cal === calidad);
    });
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

  function ajustar() {
    if (!renderer) return;
    const caja = $("t3dCanvas");
    const ancho = caja.clientWidth || window.innerWidth || 390;
    const alto = caja.clientHeight || (window.innerHeight - 64) || 600;
    renderer.setSize(ancho, alto, false);
    camera.aspect = ancho / Math.max(1, alto);
    camera.updateProjectionMatrix();
  }

  /* ── bucle ─────────────────────────────────────────────────────────────── */
  let bob = 0, frames = 0, fpsCuadros = 0, fpsT0 = 0;

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
    const dt = Math.min(0.05, reloj.getDelta());
    actualizarVuelos(dt);

    /* ── Entrada ─────────────────────────────────────────────────────────
       El stick izquierdo SOLO mueve (relativo a la cámara, con strafe) y
       el derecho SOLO mira: antes los dos giraban a la vez y la cámara
       se "desviaba" hacia un lado. Suavizado exponencial independiente
       del frame: rápido en la mirada (sin lag) y más blando en el paso. */
    const kMov = 1 - Math.exp(-dt * 9);     // el cuerpo arranca y frena suave
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
    avance += -joyS.y;
    lateral += joyS.x;
    miraX += joyCamS.x;
    miraY += joyCamS.y;

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
    const velMax = corriendoAhora ? 3.2 : 1.6;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);     // adelante
    const dx = Math.cos(yaw), dz = -Math.sin(yaw);      // derecha
    const objX = (fx * avance + dx * lateral) * velMax;
    const objZ = (fz * avance + dz * lateral) * velMax;
    const kAcel = 1 - Math.exp(-dt * (avance || lateral ? 9 : 13));
    vel.x += (objX - vel.x) * kAcel;
    vel.z += (objZ - vel.z) * kAcel;

    const nx = pos.x + vel.x * dt;
    const nz = pos.z + vel.z * dt;
    if (!choca(nx, pos.z)) pos.x = nx; else vel.x = 0;
    if (!choca(pos.x, nz)) pos.z = nz; else vel.z = 0;

    /* ── Primera persona ───────────────────────────────────────────────
       Ojos a 1,66 m y paso con balanceo proporcional a la velocidad
       real (vertical, lateral y una mínima inclinación de cabeza), más
       un leve agrandar del encuadre al correr. */
    const rapido = Math.hypot(vel.x, vel.z);
    bob += rapido * dt * 4.0;
    const paso = Math.min(1, rapido / 1.6);
    camera.position.set(
      pos.x + Math.sin(bob * 0.5) * 0.012 * paso,
      pos.y + Math.sin(bob) * 0.017 * paso,
      pos.z
    );
    const fovObj = FOV_BASE + (corriendoAhora && rapido > 0.4 ? 5 : 0);
    if (Math.abs(fovObj - fovAct) > 0.02) {
      fovAct += (fovObj - fovAct) * (1 - Math.exp(-dt * 5));
      camera.fov = fovAct;
      camera.updateProjectionMatrix();
    }
    camera.rotation.set(0, 0, 0);
    camera.rotateY(yaw);
    camera.rotateX(pitch);
    camera.rotateZ(Math.sin(bob) * 0.006 * paso);

    actualizarCarrito(dt);
    mirarPrecio(performance.now());

    if (dibujar) {
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
      const el = $("t3dFps");
      if (el) el.textContent = Math.round((fpsCuadros * 1000) / (ahora - fpsT0)) + " fps";
      fpsCuadros = 0; fpsT0 = ahora;
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
      dibuPortada(g, img.width, {
        cat: cat, nombre: p.nombre, texto: p.nombre,
        picto: pictoDe(p), conNombre: true
      });
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
    const mat = conMapa
      ? new T.MeshBasicMaterial({ map: conMapa })
      : new T.MeshBasicMaterial({ color: TINTES[p && p.categoria] || 0xc8ff00 });
    const mesh = new T.Mesh(new T.BoxGeometry(0.22, 0.28, 0.16), mat);
    mesh.position.copy(origen);
    scene.add(mesh);
    vuelos.push({ mesh: mesh, t: 0, origen: origen, destino: destino });
  }

  function actualizarVuelos(dt) {
    if (!vuelos.length || !scene) return;
    for (let k = vuelos.length - 1; k >= 0; k--) {
      const v = vuelos[k];
      v.t = Math.min(1, v.t + dt / 0.6);
      const e = v.t * v.t * (3 - 2 * v.t);              // suavizado
      v.mesh.position.lerpVectors(v.origen, v.destino, e);
      v.mesh.position.y += Math.sin(Math.PI * v.t) * 1.05;   // arco
      v.mesh.rotation.y += dt * 7;
      v.mesh.rotation.x += dt * 3;
      if (v.t >= 1) {
        scene.remove(v.mesh);
        v.mesh.geometry.dispose();
        if (v.mesh.material && v.mesh.material.dispose) v.mesh.material.dispose();
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
    if (abrir) abrirMapa(false);
  }

  /* Devuelve el cuerpo a la entrada: lo usan «Volver a la entrada», la
     barra «Tienda» y el plano. */
  function aEntrada() {
    pos.x = 0; pos.z = 8.2; yaw = 0; pitch = 0;
    vel.x = 0; vel.z = 0; fovAct = FOV_BASE;
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

    // barra superior: la navegación va por la API real de la app
    document.querySelectorAll(".t3d-nav [data-ir]").forEach((b) => {
      b.onclick = () => {
        const a = b.dataset.ir;
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

    // botón flotante «Interactuar»
    const inter = $("t3dInter");
    if (inter) inter.onclick = interactuarCentro;

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
      aplicar([t[0], t[1]], refs.muro);
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
    refs = { piso: null, muro: [], techo: [], metal: [] };
    mallasGondola = []; mallasCong = []; mallasProd = [];
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
      }
      if (!enganchado) { enganchar(); enganchado = true; }
      aplicarCalidad();
      aplicarLuz();
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
