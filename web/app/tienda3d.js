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

  const ANCHO = 14, LARGO = 20, ALTO = 3.2;
  const GONDOLAS = [-4.5, -1.5, 1.5, 4.5];
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
  const pos = { x: 0, y: 1.62, z: 8.2 };
  const teclas = {};
  let joy = { x: 0, y: 0 };
  let joyCam = { x: 0, y: 0 };
  const joyS = { x: 0, y: 0 }, joyCamS = { x: 0, y: 0 };   // versión suavizada
  let corriendo = false;
  let carrito = null, carritoRuedas = [], carritoAnim = 0;
  let mirar = null;      // arrastre de cámara
  let puerta = null;     // arrastre de puerta de congelador
  let promos = [], promoIdx = 0, promoReloj = null;
  const luces = { amb: null, sol: null };
  const LUCES = {
    calido: { amb: 0.36, dir: 0.62, color: 0xffe0b0, exp: 1.06, desc: "Luz de tienda de barrio: tono ámbar y sombras suaves." },
    neutro: { amb: 0.42, dir: 0.70, color: 0xffffff, exp: 1.02, desc: "Luz pareja de supermercado: blanco neutro y sombras suaves." },
    frio:   { amb: 0.38, dir: 0.60, color: 0xd6e9ff, exp: 1.04, desc: "Tono de cámara frigorífica: azulado y limpio." },
    cine:   { amb: 0.18, dir: 0.95, color: 0xfff3e0, exp: 0.92, desc: "Contraste cinematográfico: sombras marcadas y foco cálido." }
  };
  let luzActual = "neutro", intensidadLuz = 1, orbitaLuz = 45;
  let camaras = [], cctv = false;

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
    t.repeat.set(12, 17);
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
  function texturaTira(items) {
    const c = document.createElement("canvas");
    c.width = 1024; c.height = 64;
    const g = c.getContext("2d");
    g.fillStyle = "#f6f1df"; g.fillRect(0, 0, 1024, 64);
    g.fillStyle = "#c8ff00"; g.fillRect(0, 0, 8, 64);
    const n = Math.max(1, items.length);
    const ancho = (1024 - 8) / n;
    items.forEach((p, i) => {
      const x = 8 + i * ancho;
      if (i) { g.fillStyle = "rgba(27,26,20,.16)"; g.fillRect(x, 9, 1, 46); }
      g.textAlign = "left"; g.textBaseline = "alphabetic";
      g.fillStyle = "#5a564a";
      g.font = "600 14px -apple-system, Segoe UI, Roboto, sans-serif";
      g.fillText(String(p.nombre || "").slice(0, 20), x + 12, 25);
      g.fillStyle = "#14171a";
      g.font = "bold 26px -apple-system, Segoe UI, Roboto, sans-serif";
      g.fillText("$" + Math.round(p.precio || 0).toLocaleString("es-CL"), x + 12, 55);
    });
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
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
    let dist = 1.18;
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
    scene.background = new T.Color(0xd9dfe3);
    scene.fog = new T.Fog(0xd9dfe3, 16, 36);

    camera = new T.PerspectiveCamera(72, 1, 0.05, 70);

    /* Luces de local: sin quemar la escena. La exposición se controla con
       tone mapping, así el blanco no se come los colores de los productos. */
    scene.add(new T.AmbientLight(0xffffff, 0.32));
    scene.add(new T.HemisphereLight(0xffffff, 0xcfd6da, 0.42));

    const sol = new T.DirectionalLight(0xffffff, 0.68);
    sol.position.set(6, 11, 8);
    sol.castShadow = true;
    sol.shadow.mapSize.set(1024, 1024);
    sol.shadow.camera.left = -12;
    sol.shadow.camera.right = 12;
    sol.shadow.camera.top = 12;
    sol.shadow.camera.bottom = -12;
    sol.shadow.camera.far = 30;
    sol.shadow.bias = -0.0015;
    scene.add(sol);
    luces.sol = sol;
    luces.amb = scene.children.find((c) => c.isAmbientLight);

    [ -4, 0, 4 ].forEach((z) => {
      const p = new T.PointLight(0xfff1d8, 0.22, 14, 2);
      p.position.set(0, 3.0, z);
      scene.add(p);
    });

    /* piso brillante y techo claro */
    const piso = new T.Mesh(
      new T.PlaneGeometry(ANCHO, LARGO),
      new T.MeshPhongMaterial({ color: 0xe4e8ea, map: texturaPiso(), shininess: 60, specular: 0x3a4045 })
    );
    piso.rotation.x = -Math.PI / 2;
    piso.receiveShadow = true;
    scene.add(piso);

    const techo = new T.Mesh(
      new T.PlaneGeometry(ANCHO, LARGO),
      new T.MeshLambertMaterial({ color: 0xeef1f3 })
    );
    techo.rotation.x = Math.PI / 2;
    techo.position.y = ALTO;
    scene.add(techo);

    const panel = new T.MeshBasicMaterial({ color: 0xfffdf4 });
    [ -5, -1.7, 1.7, 5 ].forEach((z) => {
      [ -3, 0, 3 ].forEach((x) => {
        const l = new T.Mesh(new T.PlaneGeometry(1.1, 0.34), panel);
        l.rotation.x = Math.PI / 2;
        l.position.set(x, ALTO - 0.01, z);
        scene.add(l);
      });
    });

    /* paredes blancas */
    const pared = new T.MeshLambertMaterial({ color: 0xf3f5f6 });
    const zocalo = new T.MeshLambertMaterial({ color: 0xd7dbde });
    [[-ANCHO / 2, 0, Math.PI / 2], [ANCHO / 2, 0, -Math.PI / 2]].forEach(([x, z, ry]) => {
      const m = new T.Mesh(new T.PlaneGeometry(LARGO, ALTO), pared);
      m.position.set(x, ALTO / 2, z); m.rotation.y = ry; m.receiveShadow = true; scene.add(m);
      const zk = new T.Mesh(new T.PlaneGeometry(LARGO, 0.22), zocalo);
      zk.position.set(x + (x > 0 ? -0.01 : 0.01), 0.11, z); zk.rotation.y = ry; scene.add(zk);
    });
    [[0, -LARGO / 2], [0, LARGO / 2]].forEach(([x, z]) => {
      const m = new T.Mesh(new T.PlaneGeometry(ANCHO, ALTO), pared);
      m.position.set(x, ALTO / 2, z); m.receiveShadow = true; scene.add(m);
    });

    /* góndolas: una categoría por mueble */
    const cats = [...new Set(catalogo.map((p) => p.categoria).filter(Boolean))];
    const porGondola = cats.length ? cats.slice(0, GONDOLAS.length) : ["Pasillo"];
    const metal = new T.MeshLambertMaterial({ color: 0xc9d0d4 });
    const borde = new T.MeshLambertMaterial({ color: 0x9aa3a8 });
    const riel = new T.MeshLambertMaterial({ color: 0xe9c96a });

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

      // tira de precios en el filo de cada tabla (los dos lados)
      const listaG = catalogo.filter((p) => p.categoria === cat);
      const muestra = (listaG.length ? listaG : catalogo).slice(0, 6);
      if (muestra.length) {
        const texTira = texturaTira(
          Array.from({ length: 6 }, (_, k) => muestra[k % muestra.length])
        );
        const matTira = new T.MeshBasicMaterial({ map: texTira, side: T.DoubleSide });
        NIVELES.forEach((y) => {
          [1, -1].forEach((lado) => {
            const tira = new T.Mesh(new T.PlaneGeometry(G_LARGO - 0.14, 0.10), matTira);
            tira.position.set(gx + lado * (G_ANCHO / 2 + 0.013), y - 0.03, 0);
            tira.rotation.y = lado > 0 ? Math.PI / 2 : -Math.PI / 2;
            grupo.add(tira);
          });
        });
      }

      scene.add(grupo);
    });

    /* productos instanciados, cada góndola con su categoría */
    const geo = new T.BoxGeometry(0.22, 0.28, 0.16);
    const mat = new T.MeshLambertMaterial({ color: 0xdfe4e6 });
    const paso = 0.31;
    const porFila = Math.floor(G_LARGO / paso) - 1;
    const total = GONDOLAS.length * 2 * NIVELES.length * porFila;
    instancias = new T.InstancedMesh(geo, mat, total);
    instancias.castShadow = false;
    instancias.receiveShadow = true;

    const m4 = new T.Matrix4();
    const q = new T.Quaternion();
    const esc = new T.Vector3();
    const color = new T.Color();
    let i = 0;

    GONDOLAS.forEach((gx, gi) => {
      const cat = porGondola[gi % porGondola.length];
      const lista = catalogo.filter((p) => p.categoria === cat);
      const bolsa = lista.length ? lista : catalogo;
      [1, -1].forEach((lado) => {
        NIVELES.forEach((y, ni) => {
          for (let c = 0; c < porFila; c++) {
            const p = bolsa[(i * 7 + c) % bolsa.length];
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

    /* congeladores con puerta de vidrio corrediza */
    const acero = new T.MeshLambertMaterial({ color: 0xe8ecef });
    const vidrio = new T.MeshPhongMaterial({
      color: 0xbfe6f5, transparent: true, opacity: 0.22,
      shininess: 120, specular: 0xffffff, side: T.DoubleSide, depthWrite: false
    });
    const interior = new T.MeshLambertMaterial({ color: 0xdfeff7 });

    const muebles = (catalogo.length ? catalogo : [{ nombre: "Producto", precio: 0 }])
      .slice().sort((a, b) => (a.precio || 0) - (b.precio || 0)).slice(0, 6);

    function crearCongelador(cx, cz, rotY) {
      const g = new T.Group();
      g.position.set(cx, 0, cz);
      if (rotY) g.rotation.y = rotY;

      const cuerpo = new T.Mesh(new T.BoxGeometry(2.4, 1.9, 1.0), acero);
      cuerpo.position.y = 0.95;
      cuerpo.castShadow = true;
      cuerpo.receiveShadow = true;
      g.add(cuerpo);

      const fondo = new T.Mesh(new T.BoxGeometry(2.24, 1.6, 0.9), interior);
      fondo.position.set(0, 0.95, 0.02);
      g.add(fondo);

      // productos dentro
      for (let k = 0; k < 3; k++) {
        for (let n = 0; n < 4; n++) {
          const b = new T.Mesh(new T.BoxGeometry(0.16, 0.22, 0.16),
            new T.MeshLambertMaterial({ color: [0xc8ff00, 0xffb020, 0x5aa9ff, 0x3ddc84][(k + n) % 4] }));
          b.position.set(-0.9 + n * 0.22, 0.35 + k * 0.42, 0.2);
          g.add(b);
        }
      }

      // puerta corrediza
      const hoja = new T.Group();
      const marco = new T.Mesh(new T.BoxGeometry(1.2, 1.5, 0.05), acero);
      marco.position.y = 0.95;
      hoja.add(marco);
      const cristal = new T.Mesh(new T.PlaneGeometry(1.06, 1.36), vidrio);
      cristal.position.set(0, 0.95, 0.031);
      hoja.add(cristal);
      const manilla = new T.Mesh(new T.BoxGeometry(0.05, 0.5, 0.05), acero);
      manilla.position.set(0.5, 0.95, 0.07);
      hoja.add(manilla);

      hoja.position.z = 0.53;
      hoja.position.x = 0;
      // La puerta corre en horizontal (eje X) delante del mueble.
      hoja.userData = { min: -0.58, max: 0.58 };
      g.add(hoja);
      puertas.push(hoja);

      // tira de precios en el canto superior del frente
      if (!crearCongelador.tira) {
        crearCongelador.tira = texturaTira(
          Array.from({ length: 6 }, (_, k) => muebles[k % muebles.length])
        );
      }
      const tiraF = new T.Mesh(
        new T.PlaneGeometry(2.26, 0.11),
        new T.MeshBasicMaterial({ map: crearCongelador.tira, side: T.DoubleSide })
      );
      tiraF.position.set(0, 1.74, 0.51);
      g.add(tiraF);

      scene.add(g);
      return g;
    }

    // Pasillo de congeladores contra la pared izquierda (miran al centro).
    [-5.2, -2.6, 0, 2.6].forEach((cz) => crearCongelador(-ANCHO / 2 + 0.75, cz, Math.PI / 2));

    /* televisor en la esquina del fondo, con su herraje de pared */
    const tvGrupo = new T.Group();
    tvGrupo.position.set(-ANCHO / 2 + 0.14, 2.35, -LARGO / 2 + 2.6);
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
    carrito.position.set(pos.x, 0, pos.z - 1.18);
    carrito.rotation.y = yaw;
    scene.add(carrito);

    crearCamaras();
    aplicarLuz();

    raycaster = new T.Raycaster();
    puntero = new T.Vector2();
    reloj = new T.Clock();
  }

  function aplicarLuz() {
    const c = LUCES[luzActual] || LUCES.neutro;
    if (luces.amb) luces.amb.intensity = c.amb * intensidadLuz;
    if (luces.sol) {
      luces.sol.intensity = c.dir * intensidadLuz;
      luces.sol.color.setHex(c.color);
      const a = (orbitaLuz * Math.PI) / 180;
      luces.sol.position.set(Math.cos(a) * 10, 11, Math.sin(a) * 10);
    }
    if (renderer) renderer.toneMappingExposure = c.exp * (0.92 + intensidadLuz * 0.12);
    const d = $("t3dLuzDesc");
    if (d) d.textContent = c.desc;
    const iv = $("t3dIntVal"), ov = $("t3dOrbVal");
    if (iv) iv.textContent = Math.round(intensidadLuz * 100) + " %";
    if (ov) ov.textContent = Math.round(orbitaLuz) + "°";
  }

  function crearCamaras() {
    camaras = [
      [-6.2, 2.75, -9.2], [6.2, 2.75, -9.2], [6.2, 2.75, 9.2], [0, 2.95, 9.6]
    ].map(([x, y, z]) => {
      const c = new T.PerspectiveCamera(66, 1.6, 0.1, 42);
      c.position.set(x, y, z);
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
  let bob = 0, frames = 0;

  function bucle() {
    if (!vivo) return;
    requestAnimationFrame(bucle);
    const dt = Math.min(0.05, reloj.getDelta());

    // sticks suavizados: sin tirones ni saltos de velocidad
    const ks = Math.min(1, dt * 11);
    joyS.x += (joy.x - joyS.x) * ks;
    joyS.y += (joy.y - joyS.y) * ks;
    joyCamS.x += (joyCam.x - joyCamS.x) * ks;
    joyCamS.y += (joyCam.y - joyCamS.y) * ks;

    let avance = (teclas.KeyW || teclas.ArrowUp ? 1 : 0) - (teclas.KeyS || teclas.ArrowDown ? 1 : 0);
    let giro = (teclas.KeyD || teclas.ArrowRight ? 1 : 0) - (teclas.KeyA || teclas.ArrowLeft ? 1 : 0);
    avance += -joyS.y;
    giro += joyS.x;
    avance = Math.max(-1, Math.min(1, avance));
    giro = Math.max(-1, Math.min(1, giro));
    yaw -= giro * 2.2 * dt;
    // stick derecho: mira
    yaw -= joyCamS.x * 2.2 * dt;
    pitch = Math.max(-0.9, Math.min(0.9, pitch - joyCamS.y * 1.5 * dt));

    const corriendoAhora = corriendo || teclas.ShiftLeft || teclas.ShiftRight;
    const vel = (corriendoAhora ? 4.8 : 3.0) * dt;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const nx = pos.x + fx * avance * vel;
    const nz = pos.z + fz * avance * vel;
    if (!choca(nx, pos.z)) pos.x = nx;
    if (!choca(pos.x, nz)) pos.z = nz;

    bob += Math.abs(avance) * dt * (corriendoAhora ? 13 : 9);
    camera.position.set(pos.x, pos.y + Math.sin(bob) * 0.02, pos.z);
    camera.rotation.set(0, 0, 0);
    camera.rotateY(yaw);
    camera.rotateX(pitch);

    actualizarCarrito(dt);
    mirarPrecio(performance.now());

    renderer.render(scene, camera);

    if (cctv && camaras.length) {
      const W = renderer.domElement.width, H = renderer.domElement.height;
      const dpr = renderer.getPixelRatio();
      const w = Math.floor(W * 0.31), h = Math.floor(w * 0.60);
      const pad = 6 * dpr, gap = 3 * dpr, top = 74 * dpr;
      renderer.setScissorTest(true);
      camaras.forEach((cam, i) => {
        const col = i % 2, row = Math.floor(i / 2);
        const x = W - (2 - col) * (w + gap) - pad;
        const y = H - top - (row + 1) * (h + gap);
        cam.aspect = w / h;
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
  }

  function choca(x, z) {
    const m = 0.4;
    if (Math.abs(x) > ANCHO / 2 - m || Math.abs(z) > LARGO / 2 - m) return true;
    for (let i = 0; i < GONDOLAS.length; i++) {
      if (Math.abs(x - GONDOLAS[i]) < G_ANCHO / 2 + m && Math.abs(z) < G_LARGO / 2 + m) return true;
    }
    // pasillo de congeladores contra la pared izquierda
    if (x < -5.25) return true;
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
      yaw -= dx * 0.0062;
      pitch = Math.max(-0.9, Math.min(0.9, pitch - dy * 0.005));
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

    // Cámaras: 4 vistas en vivo dibujadas en el mismo canvas
    const btnCams = $("t3dCamsBtn"), capaCams = $("t3dCams");
    if (btnCams) {
      btnCams.onclick = () => {
        cctv = !cctv;
        btnCams.setAttribute("aria-expanded", String(cctv));
        if (capaCams) {
          capaCams.hidden = !cctv;
          capaCams.innerHTML = cctv
            ? ["CAM 1", "CAM 2", "CAM 3", "CAM 4"].map((t) => "<span>" + t + "</span>").join("")
            : "";
        }
        if (cctv) {
          const p = $("t3dLuces");
          if (p) p.hidden = true;
        }
      };
    }

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

  function engancharStick(el, destino) {
    if (!el) return;
    const perilla = el.querySelector("span");
    const mover = (e) => {
      const r = el.getBoundingClientRect();
      let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const mag = Math.hypot(dx, dy);
      if (mag < 0.15) { dx = 0; dy = 0; }          // zona muerta: no se arrastra solo
      else if (mag > 1) { dx /= mag; dy /= mag; }
      destino.x = dx; destino.y = dy;
      if (perilla) perilla.style.transform = "translate(calc(-50% + " + dx * 33 + "px), calc(-50% + " + dy * 33 + "px))";
    };
    el.addEventListener("pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      mover(e);
    });
    el.addEventListener("pointermove", (e) => { if (e.buttons !== 0) mover(e); });
    const soltar = () => {
      destino.x = 0; destino.y = 0;
      if (perilla) perilla.style.transform = "translate(-50%,-50%)";
    };
    el.addEventListener("pointerup", soltar);
    el.addEventListener("pointercancel", soltar);
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
    $("t3dCargando").hidden = false;

    try {
      const prueba = document.createElement("canvas");
      const gl = prueba.getContext("webgl2") || prueba.getContext("webgl");
      if (!gl) throw new Error("WebGL no disponible");
      T = await cargarThree();

      if (!listo) {
        renderer = new T.WebGLRenderer({
          canvas: caja, antialias: false, powerPreference: "high-performance",
          preserveDrawingBuffer: true
        });
        renderer.setPixelRatio(Math.min(1.3, window.devicePixelRatio || 1));
        renderer.outputEncoding = T.sRGBEncoding;
        renderer.toneMapping = T.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = T.PCFSoftShadowMap;

        const catalogo = (window.Mercado && window.Mercado.productos) ? window.Mercado.productos() : [];
        construir(catalogo);
        enganchar();
        listo = true;
      }
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
    puerta = null;
    mirar = null;
    corriendo = false;
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
    puertas: puertas.length, tv: !!tv
  });

  return { abrir, cerrar };
})();
