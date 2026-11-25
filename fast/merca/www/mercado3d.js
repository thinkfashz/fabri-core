/* MercaFabrick · visor 3D del mercado (mercado3d.js)
   --------------------------------------------------------------------------
   Supermercado en 3D construido con Three.js: piso, góndolas, productos con
   el color de su categoría, letrero con el nombre del local y caja.
   Se puede girar con el dedo, acercar con pinch y tocar un producto para
   agregarlo al carrito.

   API:
     Merca3D.montar(contenedor, {
       tienda: {nombre, catalogo:[...]},
       alElegir: fn(producto)
     }) -> { destruir }

   Si el equipo no tiene WebGL, muestra un aviso en vez de quedar en negro.
   -------------------------------------------------------------------------- */

(function () {
  "use strict";

  var COLORS = [0xc8ff00, 0x5ad9e8, 0xff9f0a, 0xff6b6b, 0x30d158, 0xbf5af2, 0xffd60a, 0x64d2ff];

  function colorDe(categoria) {
    var s = String(categoria || "");
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973;
    return COLORS[h % COLORS.length];
  }

  function montar(contenedor, opts) {
    if (!contenedor || typeof THREE === "undefined") return null;
    opts = opts || {};

    var productos = Array.isArray(opts.tienda && opts.tienda.catalogo)
      ? opts.tienda.catalogo
      : [];
    var nombre = (opts.tienda && opts.tienda.nombre) || "Mercado";

    function avisarSin3D(motivo) {
      contenedor.innerHTML =
        '<div class="mf-vacio"><h2>Sin 3D en este equipo</h2>' +
        "<p>" + (motivo || "La lista de productos sigue disponible en la vista Lista.") + "</p>" +
        '<button class="mf-btn mf-btn--pri mf-btn--sm" type="button" style="margin-top:14px">Ver lista</button></div>';
      var b = contenedor.querySelector("button");
      if (b && typeof opts.alFallback === "function") b.onclick = opts.alFallback;
      else if (b) b.onclick = function () { contenedor.innerHTML = ""; };
    }

    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      if (!renderer || !renderer.getContext()) throw new Error("sin contexto");
    } catch (e) {
      avisarSin3D();
      return null;
    }

    /* Si el teléfono pierde el contexto gráfico (RAM, otra app), no se deja
       un rectángulo negro: se explica y se ofrece volver a la lista. */
    renderer.domElement.addEventListener("webglcontextlost", function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      avisarSin3D("El visor 3D se quedó sin memoria gráfica. La lista sigue funcionando.");
    }, false);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(contenedor.clientWidth || 320, contenedor.clientHeight || 360, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    contenedor.appendChild(renderer.domElement);

    var escena = new THREE.Scene();
    escena.background = new THREE.Color(0x050507);
    escena.fog = new THREE.Fog(0x050507, 16, 34);

    var camara = new THREE.PerspectiveCamera(52, 16 / 9, 0.1, 120);
    var cam = { az: 0.62, pol: 0.92, dist: 15, objetivo: new THREE.Vector3(0, 1.1, 0) };

    function colocarCamara() {
      var x = cam.dist * Math.sin(cam.pol) * Math.sin(cam.az);
      var y = cam.dist * Math.cos(cam.pol);
      var z = cam.dist * Math.sin(cam.pol) * Math.cos(cam.az);
      camara.position.set(x, y + 1.2, z);
      camara.lookAt(cam.objetivo);
    }

    /* ── luces ──────────────────────────────────────────────────────── */
    escena.add(new THREE.HemisphereLight(0xdfe8ff, 0x0a0a12, 1.05));
    var sol = new THREE.DirectionalLight(0xffffff, 1.15);
    sol.position.set(6, 12, 8);
    escena.add(sol);
    var lima = new THREE.PointLight(0xc8ff00, 0.55, 22);
    lima.position.set(-6, 4.5, -4);
    escena.add(lima);

    /* ── piso ───────────────────────────────────────────────────────── */
    var piso = new THREE.Mesh(
      new THREE.PlaneGeometry(26, 20),
      new THREE.MeshStandardMaterial({ color: 0x0d0d13, roughness: 0.92, metalness: 0.05 })
    );
    piso.rotation.x = -Math.PI / 2;
    escena.add(piso);

    var cuadricula = new THREE.GridHelper(26, 26, 0x1c1c26, 0x14141c);
    cuadricula.position.y = 0.002;
    escena.add(cuadricula);

    /* ── paredes del fondo ──────────────────────────────────────────── */
    var pared = new THREE.Mesh(
      new THREE.BoxGeometry(26, 6, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x101018, roughness: 0.95 })
    );
    pared.position.set(0, 3, -9.8);
    escena.add(pared);

    /* Letrero con el nombre del local (una sola textura). */
    try {
      var cv = document.createElement("canvas");
      cv.width = 512; cv.height = 128;
      var c2 = cv.getContext("2d");
      c2.fillStyle = "#0b0b10";
      c2.fillRect(0, 0, 512, 128);
      c2.fillStyle = "#C8FF00";
      c2.font = "700 46px -apple-system, system-ui, sans-serif";
      c2.textAlign = "center";
      c2.textBaseline = "middle";
      c2.fillText(nombre.slice(0, 22).toUpperCase(), 256, 66);
      var tex = new THREE.CanvasTexture(cv);
      var letrero = new THREE.Mesh(
        new THREE.PlaneGeometry(7.2, 1.8),
        new THREE.MeshBasicMaterial({ map: tex })
      );
      letrero.position.set(0, 4.6, -9.6);
      escena.add(letrero);
    } catch (e) {}

    /* ── góndolas y productos ───────────────────────────────────────── */
    var mallas = [];
    var grupo = new THREE.Group();
    escena.add(grupo);

    var gondolas = [-5.4, -1.8, 1.8, 5.4];
    var indice = 0;
    var materialBase = new THREE.MeshStandardMaterial({ color: 0x1a1a24, roughness: 0.8, metalness: 0.15 });
    var materialRepisa = new THREE.MeshStandardMaterial({ color: 0x232330, roughness: 0.7, metalness: 0.2 });

    gondolas.forEach(function (gx) {
      var ancho = 3.1;
      var cuerpo = new THREE.Mesh(new THREE.BoxGeometry(ancho, 1.75, 0.95), materialBase);
      cuerpo.position.set(gx, 0.9, 0);
      grupo.add(cuerpo);

      for (var s = 0; s < 3; s++) {
        var y = 0.42 + s * 0.52;
        var repisa = new THREE.Mesh(new THREE.BoxGeometry(ancho + 0.08, 0.05, 1.0), materialRepisa);
        repisa.position.set(gx, y, 0);
        grupo.add(repisa);

        var porRepisa = 7;
        for (var k = 0; k < porRepisa; k++) {
          var prod = productos[indice % Math.max(1, productos.length)];
          indice++;
          if (!prod || prod.stock === 0) continue;
          var col = colorDe(prod.categoria);
          var mat = new THREE.MeshStandardMaterial({
            color: col,
            roughness: 0.55,
            metalness: 0.05,
            emissive: col,
            emissiveIntensity: 0.06,
          });
          var caja = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.4, 0.34), mat);
          var px = gx - ancho / 2 + 0.32 + k * ((ancho - 0.5) / (porRepisa - 1));
          caja.position.set(px, y + 0.23, 0.28);
          caja.rotation.y = (k % 2 ? 0.12 : -0.1);
          caja.userData.producto = prod;
          grupo.add(caja);
          mallas.push(caja);
        }
      }
    });

    /* Caja de pago al frente. */
    var caja = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 1.05, 1.1),
      new THREE.MeshStandardMaterial({ color: 0x14141d, roughness: 0.7, metalness: 0.2 })
    );
    caja.position.set(0, 0.53, 6.4);
    escena.add(caja);
    var lector = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.3, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xc8ff00, emissive: 0xc8ff00, emissiveIntensity: 0.35 })
    );
    lector.position.set(0.7, 1.2, 6.3);
    escena.add(lector);

    /* ── interacción ────────────────────────────────────────────────── */
    var ray = new THREE.Raycaster();
    var puntero = new THREE.Vector2();
    var arrastrando = false;
    var movido = false;
    var x0 = 0, y0 = 0, x1 = 0, y1 = 0, t0 = 0;
    var pinch = null;
    var dedos = {};

    function alBajar(ev) {
      arrastrando = true;
      movido = false;
      x0 = x1 = ev.clientX;
      y0 = y1 = ev.clientY;
      t0 = Date.now();
      if (renderer.domElement.setPointerCapture) {
        try { renderer.domElement.setPointerCapture(ev.pointerId); } catch (e) {}
      }
      if (ev.pointerType === "touch") dedos[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      if (Object.keys(dedos).length === 2) {
        var ids = Object.keys(dedos);
        pinch = Math.hypot(dedos[ids[0]].x - dedos[ids[1]].x, dedos[ids[0]].y - dedos[ids[1]].y);
        arrastrando = false;
      }
    }

    function alMover(ev) {
      if (ev.pointerType === "touch" && dedos[ev.pointerId]) {
        dedos[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
        var ids = Object.keys(dedos);
        if (ids.length === 2 && pinch) {
          var d = Math.hypot(dedos[ids[0]].x - dedos[ids[1]].x, dedos[ids[0]].y - dedos[ids[1]].y);
          if (Math.abs(d - pinch) > 20) {
            cam.dist = Math.max(7, Math.min(24, cam.dist * (pinch / d)));
            pinch = d;
            colocarCamara();
          }
          return;
        }
      }
      if (!arrastrando) return;
      var dx = ev.clientX - x1;
      var dy = ev.clientY - y1;
      if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) > 6) movido = true;
      if (!movido) return;
      cam.az -= dx * 0.006;
      cam.pol = Math.max(0.28, Math.min(1.35, cam.pol - dy * 0.005));
      x1 = ev.clientX;
      y1 = ev.clientY;
      colocarCamara();
    }

    function alSoltar(ev) {
      arrastrando = false;
      delete dedos[ev.pointerId];
      if (Object.keys(dedos).length < 2) pinch = null;
      if (movido || Date.now() - t0 > 500) return;
      var r = renderer.domElement.getBoundingClientRect();
      puntero.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
      puntero.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(puntero, camara);
      var golpes = ray.intersectObjects(mallas, false);
      if (golpes.length && typeof opts.alElegir === "function") {
        opts.alElegir(golpes[0].object.userData.producto);
      }
    }

    function alRueda(ev) {
      ev.preventDefault();
      cam.dist = Math.max(7, Math.min(24, cam.dist + (ev.deltaY > 0 ? 0.8 : -0.8)));
      colocarCamara();
    }

    var el = renderer.domElement;
    el.addEventListener("pointerdown", alBajar);
    el.addEventListener("pointermove", alMover);
    el.addEventListener("pointerup", alSoltar);
    el.addEventListener("pointercancel", alSoltar);
    el.addEventListener("wheel", alRueda, { passive: false });

    /* ── ciclo de dibujo ────────────────────────────────────────────── */
    var vivo = true;
    var raf = 0;
    var ultima = 0;
    var inactivo = 0;

    function latir(ahora) {
      if (!vivo) return;
      raf = requestAnimationFrame(latir);
      if (ahora - ultima < 32) return;
      ultima = ahora;
      if (!arrastrando && !movido) {
        inactivo += 32;
        if (inactivo > 5000) cam.az += 0.0022;
      } else {
        inactivo = 0;
      }
      colocarCamara();
      renderer.render(escena, camara);
    }

    function redimensionar() {
      var w = contenedor.clientWidth || 320;
      var h = contenedor.clientHeight || 360;
      renderer.setSize(w, h, false);
      camara.aspect = w / h;
      camara.updateProjectionMatrix();
    }

    window.addEventListener("resize", redimensionar);
    redimensionar();
    colocarCamara();
    raf = requestAnimationFrame(latir);

    return {
      destruir: function () {
        vivo = false;
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", redimensionar);
        try {
          renderer.dispose();
          if (renderer.domElement && renderer.domElement.parentNode) {
            renderer.domElement.parentNode.removeChild(renderer.domElement);
          }
        } catch (e) {}
      },
    };
  }

  window.Merca3D = { montar: montar };
})();