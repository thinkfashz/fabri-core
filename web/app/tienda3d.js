/* ============================================================================
   TIENDA 3D · supermercado caminable
   ----------------------------------------------------------------------------
   Un pasillo real en WebGL con three.js (MIT, vendorizado y cargado sólo al
   entrar). Cuatro góndolas, cuatro niveles, productos instanciados y cámara en
   primera persona: joystick para caminar, arrastrar para mirar y toque en un
   producto para abrir su ficha.

   Rendimiento (teléfono): sin sombras, niebla para recortar el fondo, un solo
   InstancedMesh para cientos de productos y DPR limitado a 1.25.
   ========================================================================== */

window.Tienda3D = (function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const CLAVE_CARRITO = "fcore.mercado.carrito";

  const ANCHO = 12, LARGO = 18, ALTO = 3.1;
  const GONDOLAS = [-3.7, 0, 3.7];
  const G_ANCHO = 1.05, G_LARGO = 8.2, NIVELES = [0.42, 1.02, 1.62, 2.22];
  const TINTES = {
    Equipos: 0xc8ff00, Insumos: 0xffb020, Accesorios: 0xb48cff,
    Audio: 0x3ddc84, "Protección": 0x5aa9ff
  };

  let T = null;            // THREE
  let renderer, scene, camera, reloj;
  let vivo = false, listo = false;
  let instancias = null, mapa = [];
  let raycaster, puntero;
  let yaw = 0, pitch = 0;
  const pos = { x: 1.85, y: 1.62, z: 7.4 };
  const teclas = {};
  let joy = { activo: false, x: 0, y: 0, id: null };
  let arrastre = { activo: false, x: 0, y: 0, movido: 0, id: null };

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

  /* ── construcción ──────────────────────────────────────────────────────── */
  function texturaPiso() {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    g.fillStyle = "#111214"; g.fillRect(0, 0, 128, 128);
    g.fillStyle = "#0c0d0f"; g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64);
    g.strokeStyle = "rgba(200,255,0,.05)"; g.lineWidth = 1;
    g.strokeRect(.5, .5, 127, 127);
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.set(10, 15);
    return t;
  }

  function texturaCartel(texto) {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 128;
    const g = c.getContext("2d");
    g.fillStyle = "#0b0c0e"; g.fillRect(0, 0, 512, 128);
    g.fillStyle = "#c8ff00"; g.fillRect(0, 112, 512, 6);
    g.font = "bold 54px -apple-system, Segoe UI, Roboto, sans-serif";
    g.fillStyle = "#f2f5f0";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(texto.toUpperCase(), 256, 58);
    const t = new T.CanvasTexture(c);
    t.anisotropy = 2;
    return t;
  }

  function construir(catalogo) {
    scene = new T.Scene();
    scene.background = new T.Color(0x050505);
    scene.fog = new T.Fog(0x050505, 7, 24);

    camera = new T.PerspectiveCamera(72, 1, 0.05, 60);

    // luces baratas: ambiente + hemisférica + dos puntos
    scene.add(new T.AmbientLight(0xffffff, 0.55));
    scene.add(new T.HemisphereLight(0xffffff, 0x10120c, 0.5));
    const l1 = new T.PointLight(0xfff6d8, 0.7, 18, 2); l1.position.set(0, 3.0, -4); scene.add(l1);
    const l2 = new T.PointLight(0xfff6d8, 0.7, 18, 2); l2.position.set(0, 3.0, 4); scene.add(l2);

    // piso y techo
    const piso = new T.Mesh(
      new T.PlaneGeometry(ANCHO, LARGO),
      new T.MeshLambertMaterial({ map: texturaPiso() })
    );
    piso.rotation.x = -Math.PI / 2;
    scene.add(piso);

    const techo = new T.Mesh(
      new T.PlaneGeometry(ANCHO, LARGO),
      new T.MeshLambertMaterial({ color: 0x0a0b0d })
    );
    techo.rotation.x = Math.PI / 2;
    techo.position.y = ALTO;
    scene.add(techo);

    // tiras de luz en el techo
    const luzMat = new T.MeshBasicMaterial({ color: 0xfff9e6 });
    [-3.7, 0, 3.7].forEach((x) => {
      const tira = new T.Mesh(new T.PlaneGeometry(0.22, 7.2), luzMat);
      tira.rotation.x = Math.PI / 2;
      tira.position.set(x, ALTO - 0.02, 0);
      scene.add(tira);
    });

    // paredes
    const paredMat = new T.MeshLambertMaterial({ color: 0x0d0e10 });
    [[-ANCHO / 2, 0, Math.PI / 2], [ANCHO / 2, 0, -Math.PI / 2]].forEach(([x, z, ry]) => {
      const p = new T.Mesh(new T.PlaneGeometry(LARGO, ALTO), paredMat);
      p.position.set(x, ALTO / 2, z);
      p.rotation.y = ry;
      scene.add(p);
    });
    [[0, -LARGO / 2], [0, LARGO / 2]].forEach(([x, z]) => {
      const p = new T.Mesh(new T.PlaneGeometry(ANCHO, ALTO), paredMat);
      p.position.set(x, ALTO / 2, z);
      scene.add(p);
    });

    // góndolas
    const metal = new T.MeshLambertMaterial({ color: 0x2a2f35 });
    const borde = new T.MeshLambertMaterial({ color: 0xc8ff00, emissive: 0x1c2400 });
    const canales = catalogo.length ? catalogo : [{ nombre: "Producto", categoria: "Equipos", precio: 0 }];

    GONDOLAS.forEach((gx, gi) => {
      [-G_LARGO / 2, G_LARGO / 2].forEach((z) => {
        const panel = new T.Mesh(new T.BoxGeometry(G_ANCHO, 2.55, 0.06), metal);
        panel.position.set(gx, 1.27, z);
        scene.add(panel);
      });
      const base = new T.Mesh(new T.BoxGeometry(G_ANCHO, 0.14, G_LARGO), metal);
      base.position.set(gx, 0.07, 0);
      scene.add(base);

      NIVELES.forEach((y) => {
        const tabla = new T.Mesh(new T.BoxGeometry(G_ANCHO, 0.05, G_LARGO), metal);
        tabla.position.set(gx, y, 0);
        scene.add(tabla);
        const filo = new T.Mesh(new T.BoxGeometry(G_ANCHO, 0.012, G_LARGO), borde);
        filo.position.set(gx, y - 0.028, 0);
        scene.add(filo);
      });

      // cartel del pasillo
      const cartel = new T.Mesh(
        new T.PlaneGeometry(1.5, 0.38),
        new T.MeshBasicMaterial({ map: texturaCartel(canales[gi % canales.length].categoria || "Pasillo") })
      );
      cartel.position.set(gx, 2.72, -G_LARGO / 2 - 0.05);
      scene.add(cartel);
    });

    // productos instanciados
    const geo = new T.BoxGeometry(0.22, 0.28, 0.16);
    const mat = new T.MeshLambertMaterial({});
    const paso = 0.31;
    const porFila = Math.floor(G_LARGO / paso) - 1;
    const total = GONDOLAS.length * 2 * NIVELES.length * porFila;
    instancias = new T.InstancedMesh(geo, mat, total);
    instancias.instanceMatrix.setUsage(T.StaticDrawUsage);

    const m4 = new T.Matrix4();
    const color = new T.Color();
    let i = 0, k = 0;
    GONDOLAS.forEach((gx) => {
      [1, -1].forEach((lado) => {
        NIVELES.forEach((y) => {
          for (let c = 0; c < porFila; c++) {
            const p = canales[k % canales.length]; k++;
            const x = gx + lado * (G_ANCHO / 2 - 0.12);
            const z = -G_LARGO / 2 + 0.6 + c * paso;
            m4.makeTranslation(x, y + 0.16, z);
            instancias.setMatrixAt(i, m4);
            color.setHex(TINTES[p.categoria] || 0xc8ff00);
            color.offsetHSL(0, 0, ((i % 5) - 2) * 0.035);
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

    raycaster = new T.Raycaster();
    puntero = new T.Vector2();
    reloj = new T.Clock();
  }

  function ajustar() {
    if (!renderer) return;
    const caja = $("t3dCanvas");
    // Si el lienzo aún no tiene layout (pantalla recién mostrada), se usa la
    // ventana: un canvas de 0×0 deja la escena en blanco.
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

    // movimiento
    let avance = (teclas.KeyW || teclas.ArrowUp ? 1 : 0) - (teclas.KeyS || teclas.ArrowDown ? 1 : 0);
    let giro = (teclas.KeyD || teclas.ArrowRight ? 1 : 0) - (teclas.KeyA || teclas.ArrowLeft ? 1 : 0);
    avance += -joy.y;
    giro += joy.x;
    yaw -= giro * 1.9 * dt;

    const vel = 2.5 * dt;
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
    const m = 0.38;
    if (Math.abs(x) > ANCHO / 2 - m || Math.abs(z) > LARGO / 2 - m) return true;
    for (let i = 0; i < GONDOLAS.length; i++) {
      if (Math.abs(x - GONDOLAS[i]) < G_ANCHO / 2 + m && Math.abs(z) < G_LARGO / 2 + m) return true;
    }
    return false;
  }

  /* ── interacción ───────────────────────────────────────────────────────── */
  function tocarProducto(clientX, clientY) {
    if (!instancias) return;
    const r = $("t3dCanvas").getBoundingClientRect();
    puntero.x = ((clientX - r.left) / r.width) * 2 - 1;
    puntero.y = -((clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(puntero, camera);
    const hits = raycaster.intersectObject(instancias, false);
    if (hits.length && hits[0].instanceId != null) {
      const p = mapa[hits[0].instanceId];
      if (p && window.Mercado && window.Mercado.abrirDetalle) {
        window.Mercado.abrirDetalle(p);
        actualizarContador();
      }
    }
  }

  function enganchar() {
    const caja = $("t3dCanvas");
    const joyEl = $("t3dJoy");

    // mirar: arrastrar sobre el lienzo
    caja.addEventListener("pointerdown", (e) => {
      arrastre = { activo: true, x: e.clientX, y: e.clientY, movido: 0, id: e.pointerId };
      caja.setPointerCapture(e.pointerId);
    });
    caja.addEventListener("pointermove", (e) => {
      if (!arrastre.activo || e.pointerId !== arrastre.id) return;
      const dx = e.clientX - arrastre.x;
      const dy = e.clientY - arrastre.y;
      arrastre.movido += Math.abs(dx) + Math.abs(dy);
      yaw -= dx * 0.005;
      pitch = Math.max(-0.9, Math.min(0.9, pitch - dy * 0.004));
      arrastre.x = e.clientX; arrastre.y = e.clientY;
    });
    caja.addEventListener("pointerup", (e) => {
      if (arrastre.movido < 8) tocarProducto(e.clientX, e.clientY);
      arrastre.activo = false;
    });

    // joystick
    joyEl.addEventListener("pointerdown", (e) => {
      joy.activo = true; joy.id = e.pointerId;
      joyEl.setPointerCapture(e.pointerId);
      moverJoy(e);
    });
    joyEl.addEventListener("pointermove", (e) => { if (joy.activo) moverJoy(e); });
    joyEl.addEventListener("pointerup", () => {
      joy = { activo: false, x: 0, y: 0, id: null };
      const perilla = joyEl.querySelector("span");
      if (perilla) perilla.style.transform = "translate(-50%,-50%)";
    });

    function moverJoy(e) {
      const r = joyEl.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let dx = (e.clientX - cx) / (r.width / 2);
      let dy = (e.clientY - cy) / (r.height / 2);
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
    if (el) {
      el.textContent = n;
      el.hidden = n === 0;
    }
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
        renderer = new T.WebGLRenderer({ canvas: caja, antialias: false, powerPreference: "high-performance", preserveDrawingBuffer: true });
        renderer.setPixelRatio(Math.min(1.25, window.devicePixelRatio || 1));
        renderer.outputEncoding = T.sRGBEncoding;

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
      const caja = $("t3dCargando");
      const msg = String((e && e.message) || e);
      const sinWebgl = /WebGL/i.test(msg);
      caja.hidden = false;
      caja.innerHTML =
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

  // Diagnóstico mínimo para pruebas (no afecta la escena).
  window.__t3d = () => ({
    ok: !!renderer,
    hijos: scene ? scene.children.length : 0,
    w: renderer ? renderer.domElement.width : 0,
    h: renderer ? renderer.domElement.height : 0,
    perdido: renderer ? renderer.getContext().isContextLost() : true,
    vivo: vivo,
    frames: frames,
    cw: (document.getElementById("t3dCanvas") || {}).clientWidth,
    ch: (document.getElementById("t3dCanvas") || {}).clientHeight
  });

  return { abrir, cerrar };
})();
