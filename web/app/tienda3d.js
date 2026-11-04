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
  const GONDOLAS = [-7.65, -4.59, -1.53, 1.53, 4.59, 7.65];
  const G_ANCHO = 1.06, G_LARGO = 9.0;
  const NIVELES = [0.42, 1.02, 1.62, 2.22];
  const TINTES = {
    Equipos: 0xc8ff00, Insumos: 0xffb020, Accesorios: 0xb48cff,
    Audio: 0x3ddc84, "Protección": 0x5aa9ff
  };

  let T = null;
  let renderer, scene, camera, reloj;
  let vivo = false, listo = false;
  let instancias = null, mapa = [], puertas = [], tv = null, tvTextura = null, tvCanvas = null;
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
  let promos = [], promoIdx = 0, promoReloj = null;
  /* Iluminación profesional: key con sombra suave, relleno frío que
     levanta las sombras, contra-luz lima que separa los muebles del muro
     negro, y puntos de techo cálidos. El preset define el ambiente. */
  const luces = { amb: null, hemi: null, sol: null, relleno: null, contra: null, puntos: [] };
  const LUCES = {
    confort: { amb: 0.30, hemi: 0.34, dir: 0.62, rell: 0.22, color: 0xffe9cf, exp: 1.00,
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
  let kelvinLuz = 4000, sombraLuz = 0.65, sensCam = 1;
  let camaras = [], cctv = false;

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
  function texturaPiso() {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    g.fillStyle = "#f4f5f6"; g.fillRect(0, 0, 256, 256);
    g.fillStyle = "#eceef0"; g.fillRect(0, 0, 128, 128); g.fillRect(128, 128, 128, 128);
    g.strokeStyle = "rgba(0,0,0,.06)"; g.lineWidth = 2;
    g.strokeRect(1, 1, 254, 254);
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.set(16, 17);
    t.anisotropy = 4;
    return t;
  }

  function texturaCartel(texto) {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 128;
    const g = c.getContext("2d");
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, 512, 128);
    g.fillStyle = "#c8ff00"; g.fillRect(0, 0, 512, 12);
    g.font = "bold 46px -apple-system, Segoe UI, Roboto, sans-serif";
    g.fillStyle = "#14171a";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(texto.toUpperCase().slice(0, 18), 256, 70);
    return new T.CanvasTexture(c);
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
    const maxNom = Math.max(6, Math.floor((celda - 26 * e) / (9.6 * e)));
    items.forEach((p, i) => {
      const x = barra + i * celda;
      if (i) { g.fillStyle = "rgba(27,26,20,.16)"; g.fillRect(x, 12 * e, 1, H - 24 * e); }
      g.textAlign = "left"; g.textBaseline = "alphabetic";
      g.fillStyle = "#4d4a41";
      g.font = "600 " + Math.round(18 * e) + "px -apple-system, Segoe UI, Roboto, sans-serif";
      g.fillText(String(p.nombre || "").slice(0, maxNom), x + 13 * e, 40 * e);
      g.fillStyle = "#101214";
      g.font = "bold " + Math.round(34 * e) + "px -apple-system, Segoe UI, Roboto, sans-serif";
      g.fillText("$" + Math.round(p.precio || 0).toLocaleString("es-CL"), x + 13 * e, 94 * e);
      if (H >= 100) {
        g.fillStyle = "rgba(27,26,20,.5)";
        g.font = Math.round(13 * e) + "px -apple-system, Segoe UI, Roboto, sans-serif";
        g.fillText("c/u", x + 13 * e, 116 * e);
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

  function crearTV() {
    const c = document.createElement("canvas");
    c.width = 640; c.height = 360;
    tvCanvas = c;
    tvTextura = new T.CanvasTexture(c);
    tvTextura.minFilter = T.LinearFilter;
    return new T.Mesh(
      new T.PlaneGeometry(2.0, 1.12),
      new T.MeshBasicMaterial({ map: tvTextura })
    );
  }

  function pintarTV() {
    if (!tvCanvas || !promos.length) return;
    const p = promos[promoIdx % promos.length];
    const g = tvCanvas.getContext("2d");
    g.fillStyle = "#0b0d0f"; g.fillRect(0, 0, 640, 360);
    g.fillStyle = "#c8ff00"; g.fillRect(0, 0, 640, 10);
    g.fillStyle = "#c8ff00";
    g.font = "bold 26px -apple-system, Segoe UI, Roboto, sans-serif";
    g.fillText("OFERTA DEL PASILLO", 40, 64);
    g.fillStyle = "#ffffff";
    g.font = "bold 54px -apple-system, Segoe UI, Roboto, sans-serif";
    const nombre = String(p.nombre || "").slice(0, 22);
    g.fillText(nombre, 40, 140);
    g.fillStyle = "#9aa3a8";
    g.font = "24px -apple-system, Segoe UI, Roboto, sans-serif";
    g.fillText(String(p.categoria || ""), 40, 182);
    g.fillStyle = "#e8c87a";
    g.font = "bold 68px -apple-system, Segoe UI, Roboto, sans-serif";
    g.fillText("$" + Math.round(p.precio || 0).toLocaleString("es-CL"), 40, 268);
    g.fillStyle = "#c8ff00";
    g.font = "bold 20px -apple-system, Segoe UI, Roboto, sans-serif";
    g.fillText("TOCA LA PANTALLA PARA AGREGAR", 40, 326);
    tvTextura.needsUpdate = true;
  }

  /* Carrito de compra: cesta de barandas, manija con agarre lima y cuatro
     ruedas. Camina un metro al frente del jugador y frena si hay un mueble. */
  function crearCarrito() {
    carritoRuedas = [];
    const g = new T.Group();
    const malla = new T.MeshLambertMaterial({ color: 0xc3cbd1 });
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

    camera = new T.PerspectiveCamera(FOV_BASE, 1, 0.05, 70);

    /* ── Iluminación profesional ─────────────────────────────────────────
       Tres puntos adaptados al local: key cálida con sombra de contacto,
       relleno frío que levanta las sombras sin aplastarlas, y una
       contra-luz lima que separa los muebles del muro negro. El tono
       fino lo da el control de temperatura (kelvin) del panel. */
    const amb = new T.AmbientLight(0xfff4e6, 0.30);
    scene.add(amb);
    luces.amb = amb;

    const hemi = new T.HemisphereLight(0xfff2df, 0x14161a, 0.34);
    scene.add(hemi);
    luces.hemi = hemi;

    const sol = new T.DirectionalLight(0xffe9cf, 0.62);
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

    luces.puntos = [[ -4.5, -3 ], [ 4.5, -3 ], [ -4.5, 3 ], [ 4.5, 3 ]].map(([x, z]) => {
      const p = new T.PointLight(0xffe6c4, 0.42, 13, 2);
      p.position.set(x, 3.0, z);
      scene.add(p);
      return p;
    });

    /* piso brillante y techo claro */
    const piso = new T.Mesh(
      new T.PlaneGeometry(ANCHO, LARGO),
      new T.MeshPhongMaterial({ color: 0xf1ebe0, map: texturaPiso(), shininess: 70, specular: 0x403a32 })
    );
    piso.rotation.x = -Math.PI / 2;
    piso.receiveShadow = true;
    scene.add(piso);

    const techo = new T.Mesh(
      new T.PlaneGeometry(ANCHO, LARGO),
      new T.MeshLambertMaterial({ color: 0x15171a })
    );
    techo.rotation.x = Math.PI / 2;
    techo.position.y = ALTO;
    scene.add(techo);

    const panel = new T.MeshBasicMaterial({ color: 0xfff4de });
    [ -5, -1.7, 1.7, 5 ].forEach((z) => {
      [ -6, -2, 2, 6 ].forEach((x) => {
        const l = new T.Mesh(new T.PlaneGeometry(1.1, 0.34), panel);
        l.rotation.x = Math.PI / 2;
        l.position.set(x, ALTO - 0.01, z);
        scene.add(l);
      });
    });

    /* Muros negros FORGE con franja lima: la marca vive en la escena y
       la luz cálida de techo hace que el negro no se sienta frío. */
    const pared = new T.MeshLambertMaterial({ color: 0x0a0b0c });
    const zocalo = new T.MeshLambertMaterial({ color: 0x171a1d });
    const franja = new T.MeshBasicMaterial({ color: 0xc8ff00 });
    const muros = [
      [-ANCHO / 2, 0, Math.PI / 2, LARGO],
      [ ANCHO / 2, 0, -Math.PI / 2, LARGO],
      [0, -LARGO / 2, 0, ANCHO],
      [0,  LARGO / 2, Math.PI, ANCHO]
    ];
    muros.forEach(([x, z, ry, largo]) => {
      const m = new T.Mesh(new T.PlaneGeometry(largo, ALTO), pared);
      m.position.set(x, ALTO / 2, z); m.rotation.y = ry; m.receiveShadow = true; scene.add(m);
      const zk = new T.Mesh(new T.PlaneGeometry(largo, 0.22), zocalo);
      zk.position.set(x, 0.11, z);
      zk.rotation.y = ry;
      zk.translateZ(0.012);
      scene.add(zk);
      // franja luminosa lima a la altura del rótulo
      const fr = new T.Mesh(new T.PlaneGeometry(largo, 0.05), franja);
      fr.position.set(x, 2.66, z);
      fr.rotation.y = ry;
      fr.translateZ(0.014);
      scene.add(fr);
    });

    /* góndolas: una categoría por mueble */
    const cats = [...new Set(catalogo.map((p) => p.categoria).filter(Boolean))];
    const porGondola = cats.length ? cats.slice(0, GONDOLAS.length) : ["Pasillo"];
    const metal = new T.MeshLambertMaterial({ color: 0xc9d0d4 });
    const borde = new T.MeshLambertMaterial({ color: 0x9aa3a8 });
    const riel = new T.MeshLambertMaterial({ color: 0xc8ff00 });

    GONDOLAS.forEach((gx, gi) => {
      const cat = porGondola[gi % porGondola.length];
      const grupo = new T.Group();

      [-G_LARGO / 2, G_LARGO / 2].forEach((z) => {
        const p = new T.Mesh(new T.BoxGeometry(G_ANCHO, 2.55, 0.06), metal);
        p.position.set(gx, 1.27, z);
        p.castShadow = true;
        grupo.add(p);
      });
      const base = new T.Mesh(new T.BoxGeometry(G_ANCHO, 0.16, G_LARGO), metal);
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

      // cartel colgante de la góndola
      const cartel = new T.Mesh(
        new T.PlaneGeometry(1.7, 0.42),
        new T.MeshBasicMaterial({ map: texturaCartel(cat), side: T.DoubleSide })
      );
      cartel.position.set(gx, 2.86, -G_LARGO / 2 - 0.06);
      grupo.add(cartel);

      // Tira de precios: un rótulo distinto por estante, con los productos
      // que realmente están en ese nivel (lienzo 2048×64 = proporción del
      // tablero, así el texto no sale estirado).
      const listaG = catalogo.filter((p) => p.categoria === cat);
      const baseG = (listaG.length ? listaG : catalogo).length
        ? (listaG.length ? listaG : catalogo)
        : [{ nombre: "Producto", precio: 0 }];
      const tirasG = NIVELES.map((_, ni) => texturaTira(
        Array.from({ length: 6 }, (_, k) => baseG[(ni * 6 + k) % baseG.length]), 2048, 64
      ));
      const matsTira = tirasG.map((t) => new T.MeshBasicMaterial({ map: t, side: T.DoubleSide }));
      NIVELES.forEach((y, ni) => {
        [1, -1].forEach((lado) => {
          const tira = new T.Mesh(new T.PlaneGeometry(G_LARGO - 0.14, 0.27), matsTira[ni]);
          tira.position.set(gx + lado * (G_ANCHO / 2 + 0.013), y - 0.095, 0);
          tira.rotation.y = lado > 0 ? Math.PI / 2 : -Math.PI / 2;
          grupo.add(tira);
        });
      });

      scene.add(grupo);
    });

    /* productos instanciados, cada góndola con su categoría */
    const geo = new T.BoxGeometry(0.22, 0.28, 0.16);
    const mat = new T.MeshLambertMaterial({ color: 0xdfe4e6 });
    const paso = 0.31;
    const porFila = Math.floor(G_LARGO / paso) - 1;
    const total = GONDOLAS.length * 2 * NIVELES.length * porFila;
    instancias = new T.InstancedMesh(geo, mat, total);
    instancias.castShadow = true;        // sombra de cada caja sobre el estante
    instancias.receiveShadow = true;

    const m4 = new T.Matrix4();
    const q = new T.Quaternion();
    const esc = new T.Vector3();
    const color = new T.Color();
    let i = 0;

    GONDOLAS.forEach((gx, gi) => {
      const cat = porGondola[gi % porGondola.length];
      const lista = catalogo.filter((p) => p.categoria === cat);
      const bolsa = (lista.length ? lista : catalogo).length
        ? (lista.length ? lista : catalogo)
        : [{ nombre: "Producto", precio: 0 }];
      [1, -1].forEach((lado) => {
        NIVELES.forEach((y, ni) => {
          for (let c = 0; c < porFila; c++) {
            // mismo orden que el rótulo del estante: lo que se ve es lo que cuesta
            const p = bolsa[(ni * 6 + c) % bolsa.length];
            const x = gx + lado * (G_ANCHO / 2 - 0.12);
            const z = -G_LARGO / 2 + 0.6 + c * paso;
            // tamaño variable: botellas altas, cajas anchas
            const alto = 0.24 + ((i + c) % 3) * 0.05;
            const ancho = 0.19 + ((i + ni) % 3) * 0.03;
            m4.compose(
              new T.Vector3(x, y + alto / 2 + 0.03, z),
              q,
              esc.set(ancho / 0.22, alto / 0.28, 1)
            );
            instancias.setMatrixAt(i, m4);
            color.setHex(TINTES[p.categoria] || 0xc8ff00);
            color.offsetHSL(0, 0, ((i % 6) - 3) * 0.03);
            instancias.setColorAt(i, color);
            mapa[i] = p;
            i++;
          }
        });
      });
    });
    instancias.count = i;
    instancias.instanceMatrix.needsUpdate = true;
    if (instancias.instanceColor) instancias.instanceColor.needsUpdate = true;
    scene.add(instancias);

    /* ── Neveras: 2,45 m, vidrio traslúcido y 4 estantes ──────────────────
       Cada estante tiene su gama de productos y su propia tira de precios;
       el vidrio deja ver el interior iluminado por el LED del techo. */
    const marco = new T.MeshLambertMaterial({ color: 0x23272c });
    const repisa = new T.MeshLambertMaterial({ color: 0x3a424a });
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

      const bufer = { caja: [], cil: [] };

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
            bufer[esCaja ? "caja" : "cil"].push({
              m: m, color: COLS[it.tipo][(k + fila) % 4]
            });
          });
        });
      });

      const tmpC = new T.Color();
      ["caja", "cil"].forEach((tk) => {
        const arr = bufer[tk];
        if (!arr.length) return;
        const mesh = new T.InstancedMesh(
          tk === "caja" ? geoCajaC : geoCilC, matProd, arr.length
        );
        arr.forEach((d, k) => {
          mesh.setMatrixAt(k, d.m);
          tmpC.setHex(d.color);
          mesh.setColorAt(k, tmpC);
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        g.add(mesh);
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
    pintarTV();
    clearInterval(promoReloj);
    promoReloj = setInterval(() => {
      if (!vivo) return;
      promoIdx++;
      pintarTV();
    }, 4000);

    carrito = crearCarrito();
    carrito.scale.setScalar(1.05);
    carrito.position.set(pos.x, 0, pos.z - 1.5);
    carrito.rotation.y = yaw;
    scene.add(carrito);

    crearCamaras();
    aplicarLuz();

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

    if (luces.amb) luces.amb.intensity = c.amb * intensidadLuz * (0.55 + 0.45 * relleno);
    if (luces.hemi) luces.hemi.intensity = c.hemi * intensidadLuz * (0.45 + 0.55 * relleno);

    luces.sol.intensity = c.dir * intensidadLuz;
    luces.sol.color.setHex(c.color).lerp(tinte, 0.6);
    const a = (orbitaLuz * Math.PI) / 180;
    luces.sol.position.set(Math.cos(a) * 10, 11, Math.sin(a) * 10);
    luces.sol.shadow.normalBias = 0.012 + (1 - sombraLuz) * 0.02;

    if (luces.relleno) {
      luces.relleno.intensity = c.rell * intensidadLuz * (0.4 + 0.6 * relleno);
      luces.relleno.color.setHex(0xcfe0ff).lerp(tinte, 0.35);
    }
    if (luces.contra) {
      luces.contra.intensity = (luzActual === "lima" ? 0.44 : 0.16) * intensidadLuz;
    }
    luces.puntos.forEach((p) => {
      p.intensity = 0.42 * intensidadLuz * (0.6 + 0.4 * relleno);
      p.color.setHex(0xffe6c4).lerp(tinte, 0.55);
    });

    if (renderer) renderer.toneMappingExposure = c.exp * (0.9 + intensidadLuz * 0.14);

    const d = $("t3dLuzDesc");
    if (d) d.textContent = c.desc;
    const iv = $("t3dIntVal"), ov = $("t3dOrbVal"), kv2 = $("t3dKelVal"), sv = $("t3dSomVal");
    if (iv) iv.textContent = Math.round(intensidadLuz * 100) + " %";
    if (ov) ov.textContent = Math.round(orbitaLuz) + "°";
    if (kv2) kv2.textContent = Math.round(kelvinLuz).toLocaleString("es-CL") + " K";
    if (sv) sv.textContent = Math.round(sombraLuz * 100) + " %";
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
    const dt = Math.min(0.05, reloj.getDelta());

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

    renderer.render(scene, camera);

    if (cctv && camaras.length) {
      const W = renderer.domElement.width, H = renderer.domElement.height;
      const dpr = renderer.getPixelRatio();
      const gap = Math.round(4 * dpr), head = Math.round(56 * dpr);
      const w = Math.floor((W - gap) / 2), h = Math.floor((H - head - gap) / 2);
      const t = performance.now();
      renderer.setScissorTest(true);
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
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, W, H);
      renderer.setScissor(0, 0, W, H);
    }
    frames++;

    // fps en vivo: así se ve si la calidad elegida le queda grande al equipo
    fpsCuadros++;
    const ahora = performance.now();
    if (!fpsT0) fpsT0 = ahora;
    if (ahora - fpsT0 >= 1000) {
      const el = $("t3dFps");
      if (el) el.textContent = Math.round((fpsCuadros * 1000) / (ahora - fpsT0)) + " fps";
      fpsCuadros = 0; fpsT0 = ahora;
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

  // Sólo aparece cuando apuntás un producto cercano (no la TV, no de lejos).
  function mirarPrecio(t) {
    if (t - ultimoPrecio < 200) return;
    ultimoPrecio = t;
    const caja = $("t3dPrecio");
    if (!caja || !instancias) return;
    if (autoOcultado()) return;
    const h = rayoCentro([instancias]);
    if (h.length && h[0].instanceId != null && h[0].distance < 6.5) {
      const p = mapa[h[0].instanceId];
      if (p && p !== precioActual) mostrarPrecio(p, false);
    } else if (precioActual && !ocultarTimer) {
      precioActual = null;
      caja.hidden = true;
    }
  }
  function autoOcultado() { return false; }

  function agregar(p) {
    if (window.Mercado && window.Mercado.agregar) {
      window.Mercado.agregar(p);
      actualizarContador();
      aviso3d(p);
      carritoAnim = 1;      // el carrito da un salto al recibir algo
    }
  }

  let avisoTimer = null;
  function aviso3d(p) {
    const el = $("t3dAviso");
    if (!el) return;
    el.innerHTML = '<b>' + String(p.nombre) + "</b><span>$" +
      Math.round(p.precio || 0).toLocaleString("es-CL") + " · agregado</span>";
    el.hidden = false;
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  function interactuar(clientX, clientY) {
    // TV primero
    if (tv && promos.length) {
      const h = rayo(clientX, clientY, [tv]);
      if (h.length) {
        const p = promos[promoIdx % promos.length];
        if (p) { agregar(p); mostrarPrecio(p, true); promoIdx++; pintarTV(); }
        return;
      }
    }
    const hits = rayo(clientX, clientY, [instancias]);
    if (hits.length && hits[0].instanceId != null) {
      const p = mapa[hits[0].instanceId];
      if (p) { agregar(p); mostrarPrecio(p, true); }
    }
  }

  function enganchar() {
    const caja = $("t3dCanvas");
    const joyEl = $("t3dJoy");

    caja.addEventListener("pointerdown", (e) => {
      caja.setPointerCapture(e.pointerId);
      const h = rayo(e.clientX, e.clientY, puertas);
      if (h.length) {
        let obj = h[0].object;
        while (obj && obj.userData.min === undefined) obj = obj.parent;
        if (obj && obj.userData.min !== undefined) {
          puerta = { grupo: obj, x0: e.clientX, base: obj.position.x, movido: 0 };
          return;
        }
      }
      mirar = { x: e.clientX, y: e.clientY, movido: 0, id: e.pointerId };
    });

    caja.addEventListener("pointermove", (e) => {
      if (puerta) {
        const dx = (e.clientX - puerta.x0) * 0.006;
        puerta.grupo.position.x = Math.max(puerta.grupo.userData.min,
          Math.min(puerta.grupo.userData.max, puerta.base + dx));
        puerta.movido += Math.abs(e.clientX - puerta.x0);
        return;
      }
      if (!mirar) return;
      const dx = e.clientX - mirar.x;
      const dy = e.clientY - mirar.y;
      mirar.movido += Math.abs(dx) + Math.abs(dy);
      yaw -= dx * 0.0062 * sensCam;
      pitch = Math.max(-0.9, Math.min(0.9, pitch - dy * 0.005 * sensCam));
      mirar.x = e.clientX; mirar.y = e.clientY;
    });

    caja.addEventListener("pointerup", (e) => {
      if (puerta) { puerta = null; return; }
      if (mirar && mirar.movido < 8) interactuar(e.clientX, e.clientY);
      mirar = null;
    });

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

    // Volver a la entrada del local
    const btnReset = $("t3dReset");
    if (btnReset) {
      btnReset.onclick = () => {
        pos.x = 0; pos.z = 8.2; yaw = 0; pitch = 0;
        vel.x = 0; vel.z = 0; fovAct = FOV_BASE;
        corriendo = false;
        const rc = $("t3dCorrer");
        if (rc) rc.classList.remove("on");
      };
    }

    // Cerrar el panel
    const cerrarPanel = $("t3dLucesX");
    if (cerrarPanel && btnLuz) cerrarPanel.onclick = () => {
      panelLuz.hidden = true;
      btnLuz.setAttribute("aria-expanded", "false");
    };

    // Cámaras: 4 vistas en vivo a pantalla completa, con botón de volver
    const btnCams = $("t3dCamsBtn");
    const btnVolver = $("t3dCamsSalir");
    function ponerCctv(on) {
      cctv = on;
      const raiz = $("t3d");
      if (raiz) raiz.classList.toggle("cctv", on);
      const caps = $("t3dCamsFull");
      if (caps) caps.hidden = !on;
      if (btnCams) btnCams.setAttribute("aria-expanded", String(on));
      const p = $("t3dLuces");
      if (p && on) p.hidden = true;
      if (!on) {
        camaras.forEach((c) => c.lookAt(0, 1.15, 0));
        mirar = null;
        puerta = null;
      }
    }
    if (btnCams) btnCams.onclick = () => ponerCctv(!cctv);
    if (btnVolver) btnVolver.onclick = () => ponerCctv(false);

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

    window.addEventListener("keydown", (e) => { teclas[e.code] = true; });
    window.addEventListener("keyup", (e) => { teclas[e.code] = false; });
    window.addEventListener("resize", ajustar);
  }

  /* ── Stick virtual (el "driver" de los mandos) ──────────────────────────
     Tres cosas que antes hacían que se sintiera duro o raro:
     1. `activo` en vez de `e.buttons`: en algunos navegadores móviles el
        botón llega en 0 y el stick dejaba de seguir al dedo a mitad de
        recorrido (y "se tiraba solo" al soltar).
     2. Zona muerta con rampa: no hay salto de 0 a 0,15 al entrar; el
        valor crece parejo desde el centro.
     3. Curva de precisión (exponente 1,35): cerca del centro hay mando
        fino para girar despacio, y al fondo llega la velocidad completa.
     La perilla sigue al dedo tal cual (control visual directo). */
  function engancharStick(el, destino) {
    if (!el) return;
    const perilla = el.querySelector("span");
    let activo = false;
    const ZONA = 0.12;
    const curva = (v) => Math.sign(v) * Math.pow(Math.min(1, Math.abs(v)), 1.35);
    const desdeCentro = (v) => {
      const a = Math.abs(v);
      if (a <= ZONA) return 0;
      return curva((a - ZONA) / (1 - ZONA));
    };
    const mover = (e) => {
      const r = el.getBoundingClientRect();
      let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const mag = Math.hypot(dx, dy);
      if (mag > 1) { dx /= mag; dy /= mag; }        // tope en el borde
      if (perilla) perilla.style.transform =
        "translate(calc(-50% + " + dx * 33 + "px), calc(-50% + " + dy * 33 + "px))";
      destino.x = desdeCentro(dx);
      destino.y = desdeCentro(dy);
    };
    const soltar = () => {
      if (!activo) return;
      activo = false;
      destino.x = 0; destino.y = 0;
      if (perilla) perilla.style.transform = "translate(-50%,-50%)";
    };
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      activo = true;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* ya capturado */ }
      mover(e);
    });
    el.addEventListener("pointermove", (e) => { if (activo) mover(e); });
    el.addEventListener("pointerup", soltar);
    el.addEventListener("pointercancel", soltar);
    el.addEventListener("lostpointercapture", soltar);
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

  /* ── entrada / salida ──────────────────────────────────────────────────── */
  async function abrir() {
    const caja = $("t3dCanvas");
    if (!caja) return;
    vivo = true;
    document.body.classList.add("en-tienda");   // nav y topbar ocultos
    $("t3dCargando").hidden = false;

    try {
      const prueba = document.createElement("canvas");
      const gl = prueba.getContext("webgl2") || prueba.getContext("webgl");
      if (!gl) throw new Error("WebGL no disponible");
      T = await cargarThree();

      perfil = detectarPerfil();
      if (!listo) {
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

        const catalogo = (window.Mercado && window.Mercado.productos) ? window.Mercado.productos() : [];
        try {
          const cal = localStorage.getItem(CLAVE_CAL);
          if (cal && (cal === "auto" || NIVELES_CALIDAD[cal])) calidad = cal;
          const se = Number(localStorage.getItem(CLAVE_SENS));
          if (se >= 40 && se <= 180) sensCam = se / 100;
        } catch (e) { /* modo privado */ }
        construir(catalogo);
        enganchar();
        listo = true;
      }
      aplicarCalidad();
      aplicarLuz();
      ajustar();
      requestAnimationFrame(ajustar);
      setTimeout(ajustar, 260);
      $("t3dCargando").hidden = true;
      reloj.start();
      bucle();
      actualizarContador();
    } catch (e) {
      const cajaErr = $("t3dCargando");
      const msg = String((e && e.message) || e);
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
    corriendo = false;
    vel.x = vel.z = 0;
    joy.x = joy.y = joyCam.x = joyCam.y = 0;
    const btn = $("t3dCorrer");
    if (btn) btn.classList.remove("on");
    const caja = $("t3dPrecio");
    if (caja) caja.hidden = true;
    if (promoReloj) { clearInterval(promoReloj); promoReloj = null; }
  }

  window.__t3d = () => ({
    ok: !!renderer, hijos: scene ? scene.children.length : 0,
    w: renderer ? renderer.domElement.width : 0, h: renderer ? renderer.domElement.height : 0,
    vivo: vivo, frames: frames,
    puertas: puertas.length, tv: !!tv,
    fov: camera ? Math.round(camera.fov) : 0,
    perdido: !!(renderer && renderer.getContext && renderer.getContext().isContextLost()),
    glerr: renderer && renderer.getContext ? renderer.getContext().getError() : -1
  });

  return { abrir, cerrar };
})();
