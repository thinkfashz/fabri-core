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
  let mirar = null;      // arrastre de cámara
  let puerta = null;     // arrastre de puerta de congelador
  let promos = [], promoIdx = 0, promoReloj = null;

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

  /* ── construcción ──────────────────────────────────────────────────────── */
  function construir(catalogo) {
    scene = new T.Scene();
    scene.background = new T.Color(0xf3f4f5);
    scene.fog = new T.Fog(0xf0f2f3, 14, 38);

    camera = new T.PerspectiveCamera(72, 1, 0.05, 70);

    /* luces de local: ambiente alta, hemisférica y una direccional con sombra */
    scene.add(new T.AmbientLight(0xffffff, 0.82));
    scene.add(new T.HemisphereLight(0xffffff, 0xe6eaec, 0.55));

    const sol = new T.DirectionalLight(0xfffdf5, 0.85);
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

    [ -4, 0, 4 ].forEach((z) => {
      const p = new T.PointLight(0xfff6e0, 0.45, 16, 2);
      p.position.set(0, 3.0, z);
      scene.add(p);
    });

    /* piso brillante y techo claro */
    const piso = new T.Mesh(
      new T.PlaneGeometry(ANCHO, LARGO),
      new T.MeshPhongMaterial({ color: 0xffffff, map: texturaPiso(), shininess: 80, specular: 0x555a5e })
    );
    piso.rotation.x = -Math.PI / 2;
    piso.receiveShadow = true;
    scene.add(piso);

    const techo = new T.Mesh(
      new T.PlaneGeometry(ANCHO, LARGO),
      new T.MeshLambertMaterial({ color: 0xfbfcfc })
    );
    techo.rotation.x = Math.PI / 2;
    techo.position.y = ALTO;
    scene.add(techo);

    const panel = new T.MeshBasicMaterial({ color: 0xffffff });
    [ -5, -1.7, 1.7, 5 ].forEach((z) => {
      [ -3, 0, 3 ].forEach((x) => {
        const l = new T.Mesh(new T.PlaneGeometry(1.1, 0.34), panel);
        l.rotation.x = Math.PI / 2;
        l.position.set(x, ALTO - 0.01, z);
        scene.add(l);
      });
    });

    /* paredes blancas */
    const pared = new T.MeshLambertMaterial({ color: 0xffffff });
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
    const metal = new T.MeshLambertMaterial({ color: 0xdfe3e6 });
    const borde = new T.MeshLambertMaterial({ color: 0xb9c0c5 });
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

      scene.add(grupo);
    });

    /* productos instanciados, cada góndola con su categoría */
    const geo = new T.BoxGeometry(0.22, 0.28, 0.16);
    const mat = new T.MeshLambertMaterial({});
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

    [-3.2, 0, 3.2].forEach((cx, idx) => {
      const g = new T.Group();
      g.position.set(cx, 0, -LARGO / 2 + 1.2);

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

      scene.add(g);
    });

    /* televisor colgado */
    tv = crearTV();
    tv.position.set(0, 2.72, -1.2);
    tv.rotation.y = 0;
    scene.add(tv);
    const marcoTV = new T.Mesh(new T.BoxGeometry(2.12, 1.24, 0.06), new T.MeshLambertMaterial({ color: 0x14171a }));
    marcoTV.position.set(0, 2.72, -1.24);
    scene.add(marcoTV);
    const cable = new T.Mesh(new T.BoxGeometry(0.03, 0.5, 0.03), new T.MeshLambertMaterial({ color: 0x2a2f33 }));
    cable.position.set(0, 3.05, -1.24);
    scene.add(cable);

    promos = catalogo.slice(0, 8);
    pintarTV();
    clearInterval(promoReloj);
    promoReloj = setInterval(() => {
      if (!vivo) return;
      promoIdx++;
      pintarTV();
    }, 4000);

    raycaster = new T.Raycaster();
    puntero = new T.Vector2();
    reloj = new T.Clock();
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

    let avance = (teclas.KeyW || teclas.ArrowUp ? 1 : 0) - (teclas.KeyS || teclas.ArrowDown ? 1 : 0);
    let giro = (teclas.KeyD || teclas.ArrowRight ? 1 : 0) - (teclas.KeyA || teclas.ArrowLeft ? 1 : 0);
    avance += -joy.y;
    giro += joy.x;
    yaw -= giro * 1.9 * dt;

    const vel = 2.6 * dt;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const nx = pos.x + fx * avance * vel;
    const nz = pos.z + fz * avance * vel;
    if (!choca(nx, pos.z)) pos.x = nx;
    if (!choca(pos.x, nz)) pos.z = nz;

    bob += Math.abs(avance) * dt * 9;
    camera.position.set(pos.x, pos.y + Math.sin(bob) * 0.02, pos.z);
    camera.rotation.set(0, 0, 0);
    camera.rotateY(yaw);
    camera.rotateX(pitch);

    renderer.render(scene, camera);
    frames++;
  }

  function choca(x, z) {
    const m = 0.4;
    if (Math.abs(x) > ANCHO / 2 - m || Math.abs(z) > LARGO / 2 - m) return true;
    for (let i = 0; i < GONDOLAS.length; i++) {
      if (Math.abs(x - GONDOLAS[i]) < G_ANCHO / 2 + m && Math.abs(z) < G_LARGO / 2 + m) return true;
    }
    // congeladores del fondo
    if (z < -LARGO / 2 + 2.1 && Math.abs(x) < 4.6) return true;
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

  function agregar(p) {
    if (window.Mercado && window.Mercado.agregar) {
      window.Mercado.agregar(p);
      actualizarContador();
      aviso3d(p);
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
        if (p) { agregar(p); promoIdx++; pintarTV(); }
        return;
      }
    }
    const hits = rayo(clientX, clientY, [instancias]);
    if (hits.length && hits[0].instanceId != null) {
      const p = mapa[hits[0].instanceId];
      if (p) agregar(p);
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
      yaw -= dx * 0.005;
      pitch = Math.max(-0.9, Math.min(0.9, pitch - dy * 0.004));
      mirar.x = e.clientX; mirar.y = e.clientY;
    });

    caja.addEventListener("pointerup", (e) => {
      if (puerta) { puerta = null; return; }
      if (mirar && mirar.movido < 8) interactuar(e.clientX, e.clientY);
      mirar = null;
    });

    joyEl.addEventListener("pointerdown", (e) => {
      joyEl.setPointerCapture(e.pointerId);
      moverJoy(e);
    });
    joyEl.addEventListener("pointermove", (e) => { if (e.buttons !== 0) moverJoy(e); });
    joyEl.addEventListener("pointerup", () => {
      joy = { x: 0, y: 0 };
      const perilla = joyEl.querySelector("span");
      if (perilla) perilla.style.transform = "translate(-50%,-50%)";
    });

    function moverJoy(e) {
      const r = joyEl.getBoundingClientRect();
      let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const mag = Math.hypot(dx, dy);
      if (mag > 1) { dx /= mag; dy /= mag; }
      joy.x = dx; joy.y = dy;
      const perilla = joyEl.querySelector("span");
      if (perilla) perilla.style.transform = "translate(calc(-50% + " + dx * 26 + "px), calc(-50% + " + dy * 26 + "px))";
    }

    window.addEventListener("keydown", (e) => { teclas[e.code] = true; });
    window.addEventListener("keyup", (e) => { teclas[e.code] = false; });
    window.addEventListener("resize", ajustar);
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
  }

  window.__t3d = () => ({
    ok: !!renderer, hijos: scene ? scene.children.length : 0,
    w: renderer ? renderer.domElement.width : 0, h: renderer ? renderer.domElement.height : 0,
    vivo: vivo, frames: frames,
    puertas: puertas.length, tv: !!tv
  });

  return { abrir, cerrar };
})();
