/* ==========================================================================
   PÁGINA: Verificación de envío (verificar.html)
   --------------------------------------------------------------------------
   El comprador escribe el código único del pedido (V-XXXX-XXXX) y ve:
     · el estado real que el local marcó (pedido_seguir),
     · las paradas con su hora real (eventos),
     · un recorrido 3D de reparto: distribuidor → carretera → casa/local.

   La escena NO inventa progreso: el auto se estaciona en la parada que
   corresponde al estado real. Si la red falla, se conserva el último estado
   verificado y se avisa con la hora de esa comprobación.

   Las funciones puras quedan en `Verificar._test` para probarlas sin
   navegador.
   ========================================================================== */

(function () {
  "use strict";

  var MERCADO = "https://fabri-api.vercel.app/api/mercado";
  var K_ULTIMO = "fcs.verificar.ultimo"; // último código verificado en este equipo
  var ESPERA_MS = 20000;                 // refresco del estado real
  var F = window.FCS || {};

  /* ── utilidades puras ─────────────────────────────────────────────────── */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function clp(n) {
    var v = Number(n) || 0;
    try {
      return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(v);
    } catch (e) { return "$" + Math.round(v); }
  }

  /** Código compacto y en mayúsculas: `V7K2M9Q4P`. */
  function normalizarCodigo(v) {
    var s = String(v == null ? "" : v).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!s) return "";
    if (s.charAt(0) !== "V") s = "V" + s;
    return s.slice(0, 9);
  }

  /** Cómo se muestra: `V-7K2M-9Q4P`. */
  function mostrarCodigo(v) {
    var s = normalizarCodigo(v);
    return s.length === 9 ? "V-" + s.slice(1, 5) + "-" + s.slice(5, 9) : "";
  }

  function fechaHora(ts) {
    if (!ts) return "";
    var d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    try {
      return new Intl.DateTimeFormat("es-CL", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
      }).format(d);
    } catch (e) { return d.toLocaleString(); }
  }

  function hora(ts) {
    if (!ts) return "";
    var d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    try {
      return new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(d);
    } catch (e) { return d.toLocaleTimeString(); }
  }

  /** Título, chip y clase visual para cada estado real. */
  function estadoInfo(estado, entrega) {
    var delivery = entrega === "delivery";
    var tabla = {
      nuevo: { chip: "Recibido", titulo: "El local recibió tu pedido", clase: "nuevo" },
      visto: { chip: "En preparación", titulo: "Están preparando tu pedido", clase: "visto" },
      listo: delivery
        ? { chip: "En camino", titulo: "Tu pedido va en camino", clase: "listo" }
        : { chip: "Listo", titulo: "Tu pedido está listo para retirar", clase: "listo" },
      entregado: delivery
        ? { chip: "Entregado", titulo: "Tu pedido llegó a tu casa", clase: "entregado" }
        : { chip: "Retirado", titulo: "Pedido retirado", clase: "entregado" },
      cancelado: { chip: "Cancelado", titulo: "El pedido fue cancelado", clase: "cancelado" },
    };
    return tabla[estado] || tabla.nuevo;
  }

  /** Las cuatro paradas del ciclo, con nombres según retiro o delivery. */
  function paradasDe(pedido) {
    var delivery = pedido && pedido.entrega === "delivery";
    return [
      { id: "nuevo", titulo: "Pedido recibido", detalle: "El local recibió el pedido." },
      { id: "visto", titulo: "En preparación", detalle: "Están armando el pedido." },
      delivery
        ? { id: "listo", titulo: "En camino", detalle: "Salió del local hacia tu dirección." }
        : { id: "listo", titulo: "Listo para retirar", detalle: "Puedes retirarlo en el local." },
      delivery
        ? { id: "entregado", titulo: "Entregado en tu casa", detalle: "Llegó a la dirección del pedido." }
        : { id: "entregado", titulo: "Retirado", detalle: "El pedido se entregó en el local." },
    ];
  }

  function indiceDe(estado) {
    var i = { nuevo: 0, visto: 1, listo: 2, entregado: 3 }[estado];
    return typeof i === "number" ? i : -1;
  }

  /** Hora real de cada estado (la última que registró el local). */
  function eventosPorEstado(eventos, creado) {
    var out = {};
    if (creado) out.nuevo = creado;
    if (Array.isArray(eventos)) {
      eventos.forEach(function (e) {
        if (e && e.estado && e.ts) out[e.estado] = e.ts;
      });
    }
    return out;
  }

  /**
   * Dónde se estaciona el auto (0 = distribuidor, 1 = casa/local).
   * Son anclas, no un porcentaje de avance: el pedido no "va por 60 %".
   */
  function posicionDe(estado) {
    var p = { nuevo: 0.03, visto: 0.08, listo: 0.58, entregado: 0.95, cancelado: 0.02 }[estado];
    return typeof p === "number" ? p : 0.03;
  }

  /* ── estado de la página ──────────────────────────────────────────────── */

  var ESTADO = {
    pedido: null,
    escena: null,
    timer: null,
    ultimoOk: 0,
    errorRed: "",
    cargando: false,
  };

  function $(id) { return document.getElementById(id); }

  function leerUltimo() {
    try { return localStorage.getItem(K_ULTIMO) || ""; } catch (e) { return ""; }
  }

  function guardarUltimo(codigo) {
    try { localStorage.setItem(K_ULTIMO, codigo); } catch (e) { /* modo privado */ }
  }

  /* ── API ──────────────────────────────────────────────────────────────── */

  function pedir(codigo) {
    return fetch(MERCADO, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ accion: "pedido_seguir", verificacion: codigo }),
    }).then(function (r) {
      return r.json().then(function (d) {
        d.__status = r.status;
        return d;
      });
    });
  }

  /* ── escena 3D ────────────────────────────────────────────────────────── */

  function hayWebGL() {
    try {
      var c = document.createElement("canvas");
      return Boolean(window.WebGLRenderingContext &&
        (c.getContext("webgl") || c.getContext("experimental-webgl")));
    } catch (e) { return false; }
  }

  function cargarThree() {
    return new Promise(function (resolver, rechazar) {
      if (window.THREE) { resolver(window.THREE); return; }
      var s = document.createElement("script");
      s.src = "./app/vendor/three.min.js";
      s.async = true;
      /* Si el archivo no llega (red cortada, caché rota), no se deja el canvas
         vacío para siempre: se cae al detalle textual. */
      var reloj = setTimeout(function () { rechazar(new Error("THREE tardó demasiado")); }, 8000);
      s.onload = function () {
        clearTimeout(reloj);
        if (window.THREE) resolver(window.THREE);
        else rechazar(new Error("THREE no quedó disponible"));
      };
      s.onerror = function () { clearTimeout(reloj); rechazar(new Error("no se pudo cargar THREE")); };
      document.head.appendChild(s);
    });
  }

  function textoRotulo(texto, color) {
    var T = window.THREE;
    var c = document.createElement("canvas");
    c.width = 512; c.height = 96;
    var g = c.getContext("2d");
    g.fillStyle = "#0B0E11";
    g.fillRect(0, 0, 512, 96);
    g.fillStyle = color;
    g.font = "800 50px system-ui, -apple-system, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(texto, 256, 52);
    var tex = new T.CanvasTexture(c);
    if (T.sRGBEncoding !== undefined) tex.encoding = T.sRGBEncoding;
    return new T.MeshBasicMaterial({ map: tex, transparent: true });
  }

  /**
   * Crea la escena. Devuelve `{ actualizar(pedido), destruir() }`.
   * Sin texturas externas: todo geometría y un rótulo dibujado en canvas.
   */
  function crearEscena(canvas, pedido) {
    var T = window.THREE;
    var reducir = Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

    var renderer = new T.WebGLRenderer({
      canvas: canvas, antialias: true, alpha: true, powerPreference: "low-power",
    });
    renderer.setClearColor(0x000000, 0);

    var escena = new T.Scene();
    escena.fog = new T.Fog(0x08090A, 30, 58);

    var camara = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 140);
    camara.position.set(-7, 11, 19);
    camara.lookAt(0, 0.5, 0);

    escena.add(new T.HemisphereLight(0xDCEAD8, 0x0A0F0B, 0.95));
    var sol = new T.DirectionalLight(0xFFFFFF, 1.1);
    sol.position.set(-8, 16, 12);
    escena.add(sol);
    var relleno = new T.DirectionalLight(0xC8F542, 0.22);
    relleno.position.set(10, 6, -8);
    escena.add(relleno);

    var mat = function (color, opciones) {
      var o = opciones || {};
      return new T.MeshLambertMaterial({
        color: color,
        emissive: o.emissive || 0x000000,
        emissiveIntensity: o.emissiveIntensity == null ? 1 : o.emissiveIntensity,
        transparent: Boolean(o.transparent),
        opacity: o.opacity == null ? 1 : o.opacity,
      });
    };

    function caja(w, h, d, material, x, y, z) {
      var m = new T.Mesh(new T.BoxGeometry(w, h, d), material);
      m.position.set(x || 0, y || 0, z || 0);
      escena.add(m);
      return m;
    }

    /* Suelo y carretera */
    var suelo = new T.Mesh(new T.PlaneGeometry(80, 50), mat(0x0C1510));
    suelo.rotation.x = -Math.PI / 2;
    suelo.position.y = -0.02;
    escena.add(suelo);

    var calzada = new T.Mesh(new T.PlaneGeometry(24, 5), mat(0x191C20));
    calzada.rotation.x = -Math.PI / 2;
    calzada.position.y = 0.01;
    escena.add(calzada);

    var veredaMat = mat(0x262B30);
    var veredaA = caja(24, 0.1, 0.5, veredaMat, 0, 0.06, 2.75);
    var veredaB = caja(24, 0.1, 0.5, veredaMat, 0, 0.06, -2.75);

    var guiaMat = mat(0x8C9498, { emissive: 0x30373A });
    for (var dx = -10; dx <= 10; dx += 2.4) caja(1.1, 0.02, 0.16, guiaMat, dx, 0.03, 0);

    /* Distribuidor */
    caja(4.8, 3, 4.2, mat(0x2C3842), -10.8, 1.5, 0);
    caja(5.2, 0.28, 4.6, mat(0x3A4854), -10.8, 3.14, 0);
    caja(1.9, 2.1, 0.14, mat(0x0D1114), -10.8, 1.05, 2.12);
    var franja = caja(2.2, 0.12, 0.1, mat(0x556E21, { emissive: 0xC8F542, emissiveIntensity: 0.85 }), -10.8, 2.36, 2.17);
    var rotulo = new T.Mesh(new T.PlaneGeometry(3.3, 0.62), textoRotulo("DISTRIBUIDOR", "#C8F542"));
    rotulo.position.set(-10.8, 3.62, 0.06);
    escena.add(rotulo);
    /* Paquetes junto al portón */
    caja(0.7, 0.7, 0.7, mat(0x9A7B4F), -9.35, 0.35, 1.55);
    caja(0.55, 0.55, 0.55, mat(0x7E6338), -9.35, 0.98, 1.55);
    caja(0.6, 0.5, 0.6, mat(0x8A6F45), -8.7, 0.25, 1.75);

    /* Casa (o local, si el pedido es retiro) */
    var retiro = pedido && pedido.entrega !== "delivery";
    if (retiro) {
      caja(4.6, 2.6, 4, mat(0x33433A), 10.8, 1.3, 0);
      caja(4.9, 0.3, 4.3, mat(0x44584C), 10.8, 2.75, 0);
      caja(1.6, 2.1, 0.14, mat(0x101714), 10.8, 1.05, 2.12);
      var rotulo2 = new T.Mesh(new T.PlaneGeometry(3.3, 0.62), textoRotulo("RETIRO", "#5AD9E8"));
      rotulo2.position.set(10.8, 3.2, 0.06);
      escena.add(rotulo2);
    } else {
      caja(4.6, 2.5, 4, mat(0x3A3229), 10.8, 1.25, 0);
      var techo = new T.Mesh(new T.ConeGeometry(3.6, 1.7, 4), mat(0x5A4436));
      techo.rotation.y = Math.PI / 4;
      techo.position.set(10.8, 3.35, 0);
      escena.add(techo);
      caja(0.95, 1.65, 0.12, mat(0x6B4E2E), 10.8, 0.83, 2.07);
      var ventana = mat(0x2A1E12, { emissive: 0xFFC66B, emissiveIntensity: 0.9 });
      caja(0.85, 0.7, 0.09, ventana, 9.35, 1.6, 2.07);
      caja(0.85, 0.7, 0.09, ventana, 12.25, 1.6, 2.07);
      caja(0.55, 1.1, 0.55, mat(0x4A3B32), 11.9, 3.6, -0.9);
      /* Buzón y árbol */
      caja(0.16, 0.7, 0.16, mat(0x555C63), 8.65, 0.35, 2.2);
      caja(0.5, 0.34, 0.3, mat(0x556E21, { emissive: 0xC8F542, emissiveIntensity: 0.35 }), 8.65, 0.82, 2.2);
      var tronco = new T.Mesh(new T.CylinderGeometry(0.12, 0.16, 1.2, 6), mat(0x4A3524));
      tronco.position.set(13.1, 0.6, 1.6);
      escena.add(tronco);
      var copa = new T.Mesh(new T.SphereGeometry(0.95, 8, 6), mat(0x2F6B3A));
      copa.position.set(13.1, 1.95, 1.6);
      escena.add(copa);
    }

    /* Poste de luz en la mitad del recorrido */
    var poste = new T.Mesh(new T.CylinderGeometry(0.07, 0.09, 2.6, 6), mat(0x3B4248));
    poste.position.set(0.4, 1.3, -2.4);
    escena.add(poste);
    caja(0.9, 0.08, 0.16, mat(0x3B4248), 0.85, 2.55, -2.4);
    caja(0.5, 0.12, 0.24, mat(0x5A5F45, { emissive: 0xFFE9A8, emissiveIntensity: 0.8 }), 1.15, 2.46, -2.4);

    /* Anillos de parada */
    var anillos = [];
    [-8.2, 0, 8.2].forEach(function (x) {
      var a = new T.Mesh(
        new T.RingGeometry(0.55, 0.72, 28),
        new T.MeshBasicMaterial({ color: 0x455046, transparent: true, opacity: 0.75, side: T.DoubleSide })
      );
      a.rotation.x = -Math.PI / 2;
      a.position.set(x, 0.04, 0.9);
      escena.add(a);
      anillos.push(a);
    });

    /* Auto de reparto */
    var auto = new T.Group();
    var blanco = mat(0xEDEFE8);
    var cuerpo = new T.Mesh(new T.BoxGeometry(2.0, 0.82, 1.02), blanco);
    cuerpo.position.y = 0.64;
    auto.add(cuerpo);
    var cabina = new T.Mesh(new T.BoxGeometry(1.0, 0.6, 0.96), mat(0x26333D));
    cabina.position.set(-0.18, 1.3, 0);
    auto.add(cabina);
    var techoAuto = new T.Mesh(new T.BoxGeometry(1.06, 0.1, 1.0), blanco);
    techoAuto.position.set(-0.18, 1.64, 0);
    auto.add(techoAuto);
    var franjaAuto = new T.Mesh(new T.BoxGeometry(1.8, 0.14, 1.04), mat(0x556E21, { emissive: 0xC8F542, emissiveIntensity: 0.5 }));
    franjaAuto.position.set(0.05, 0.74, 0);
    auto.add(franjaAuto);

    var geoRueda = new T.CylinderGeometry(0.27, 0.27, 0.16, 12);
    var matRueda = mat(0x121416);
    var ruedas = [];
    [[0.62, 0.52], [0.62, -0.52], [-0.62, 0.52], [-0.62, -0.52]].forEach(function (p) {
      var g = new T.Group();
      g.position.set(p[0], 0.28, p[1]);
      g.rotation.x = Math.PI / 2;
      var w = new T.Mesh(geoRueda, matRueda);
      g.add(w);
      auto.add(g);
      ruedas.push(w);
    });

    var faroMat = new T.MeshBasicMaterial({ color: 0xFFF3B0 });
    [0.32, -0.32].forEach(function (z) {
      var f = new T.Mesh(new T.SphereGeometry(0.09, 8, 6), faroMat);
      f.position.set(1.0, 0.62, z);
      auto.add(f);
    });
    var rojoMat = new T.MeshBasicMaterial({ color: 0xF25555 });
    [0.32, -0.32].forEach(function (z) {
      var f = new T.Mesh(new T.SphereGeometry(0.07, 8, 6), rojoMat);
      f.position.set(-1.0, 0.62, z);
      auto.add(f);
    });

    var sombra = new T.Mesh(
      new T.CircleGeometry(1.15, 20),
      new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.34 })
    );
    sombra.rotation.x = -Math.PI / 2;
    sombra.scale.set(1, 0.45, 1);
    sombra.position.y = 0.03;
    auto.add(sombra);

    escena.add(auto);

    var curva = new T.CatmullRomCurve3([
      new T.Vector3(-8.2, 0, 0.9),
      new T.Vector3(-4.4, 0, 1.3),
      new T.Vector3(0, 0, 0.9),
      new T.Vector3(4.4, 0, 0.5),
      new T.Vector3(8.2, 0, 0.9),
    ]);

    var actual = { t: posicionDe(pedido && pedido.estado), destino: posicionDe(pedido && pedido.estado), estado: pedido && pedido.estado };
    var raf = 0;
    var ultimo = 0;

    function ajustar() {
      var w = canvas.clientWidth || 360;
      var h = canvas.clientHeight || 260;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      var aspecto = w / h;
      var vista = 25;
      camara.left = -vista / 2;
      camara.right = vista / 2;
      camara.top = vista / (2 * aspecto);
      camara.bottom = -vista / (2 * aspecto);
      camara.updateProjectionMatrix();
      renderer.render(escena, camara);
    }

    function colocar(girando) {
      var t = Math.max(0, Math.min(1, actual.t));
      var punto = curva.getPointAt(t);
      var tang = curva.getTangentAt(t);
      auto.position.set(punto.x, 0.02, punto.z);
      auto.rotation.y = Math.atan2(-tang.z, tang.x);
      if (girando) {
        var giro = 0.28;
        ruedas.forEach(function (w) { w.rotation.y += giro; });
        auto.position.y = 0.02 + Math.sin(performance.now() / 90) * 0.012;
      }
    }

    function pintarAnillos(estado) {
      var idx = indiceDe(estado);
      var colores = {
        nuevo: 0xC8F542, visto: 0xF5C542, listo: 0x5AD9E8,
        entregado: 0xC8F542, cancelado: 0xF25555,
      };
      anillos.forEach(function (a, i) {
        var activo = estado === "cancelado" ? i === 0 : i === Math.min(idx, 2);
        var hecho = estado !== "cancelado" && i < Math.min(idx, 2);
        a.material.color.setHex(activo ? (colores[estado] || 0xC8F542) : (hecho ? 0x3E5A2A : 0x455046));
        a.material.opacity = activo ? 1 : (hecho ? 0.8 : 0.45);
        a.scale.setScalar(activo ? 1.12 : 1);
      });
    }

    function paso(ms) {
      raf = 0;
      if (document.hidden) return;
      var dt = ultimo ? Math.min(0.05, (ms - ultimo) / 1000) : 0.016;
      ultimo = ms;
      var delta = actual.destino - actual.t;
      var moviendo = Math.abs(delta) > 0.0015;
      if (moviendo) actual.t += delta * Math.min(1, dt * 1.7);
      else actual.t = actual.destino;
      colocar(moviendo);
      renderer.render(escena, camara);
      if (!reducir) raf = requestAnimationFrame(paso);
    }

    function arrancar() {
      if (reducir) { colocar(false); renderer.render(escena, camara); return; }
      if (!raf) { ultimo = 0; raf = requestAnimationFrame(paso); }
    }

    function actualizar(nuevo) {
      var e = nuevo && nuevo.estado;
      var destino = posicionDe(e);
      if (e === "cancelado") destino = 0.02;
      // Si es la primera pintura, el auto aparece en la parada real; no simula
      // un viaje que ya ocurrió.
      if (!actual.estado) { actual.t = destino; }
      actual.destino = destino;
      actual.estado = e;
      pintarAnillos(e);
      if (reducir) { actual.t = destino; colocar(false); renderer.render(escena, camara); }
      else arrancar();
    }

    var enRedimension = function () { ajustar(); };
    window.addEventListener("resize", enRedimension);
    var enVisibilidad = function () { if (!document.hidden) arrancar(); };
    document.addEventListener("visibilitychange", enVisibilidad);

    /* Si el sistema se lleva el contexto (memoria justa, GPU reiniciada), la
       escena queda en blanco: se avisa con el respaldo honesto en vez de
       mostrar un cuadro vacío como si el pedido no tuviera recorrido. */
    var alPerderContexto = function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      canvas.hidden = true;
      var fb = document.getElementById("vfFallback");
      if (fb) fb.hidden = false;
      if (window.console && console.warn) console.warn("[verificar] contexto WebGL perdido: se usa el detalle textual");
    };
    canvas.addEventListener("webglcontextlost", alPerderContexto, false);

    ajustar();
    pintarAnillos(actual.estado);
    arrancar();

    return {
      actualizar: actualizar,
      /* Posición real del auto en la ruta (0 = distribuidor, 1 = casa/local).
         La usa el diagnóstico para comprobar que la escena sigue al estado. */
      posicion: function () { return { t: actual.t, destino: actual.destino, estado: actual.estado }; },
      destruir: function () {
        if (raf) cancelAnimationFrame(raf);
        window.removeEventListener("resize", enRedimension);
        document.removeEventListener("visibilitychange", enVisibilidad);
        canvas.removeEventListener("webglcontextlost", alPerderContexto);
        escena.traverse(function (o) {
          if (o.geometry && o.geometry.dispose) o.geometry.dispose();
          if (o.material) {
            (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) {
              if (m.map && m.map.dispose) m.map.dispose();
              if (m.dispose) m.dispose();
            });
          }
        });
        renderer.dispose();
      },
    };
  }

  /* ── pintado ──────────────────────────────────────────────────────────── */

  function pintarEstado(p) {
    var est = estadoInfo(p.estado, p.entrega);
    var caja = $("vfEstado");
    if (!caja) return;
    var html =
      '<div class="vf-estado__fila">' +
        '<span class="vf-chip vf-chip--' + est.clase + '">' + esc(est.chip) + "</span>" +
        '<span class="vf-chip vf-chip--verificado">Verificado</span>' +
      "</div>" +
      '<b class="vf-estado__titulo">' + esc(est.titulo) + "</b>" +
      '<span class="vf-estado__meta">Pedido ' + esc(p.codigo) + " · código " +
        esc(mostrarCodigo(p.verificacion) || p.verificacion || "") +
        " · actualizado " + esc(fechaHora(p.actualizado) || "—") +
        " · comprobado " + esc(hora(ESTADO.ultimoOk)) +
      "</span>";
    if (ESTADO.errorRed) {
      html += '<p class="vf-aviso-red">' + esc(ESTADO.errorRed) + "</p>";
    }
    caja.innerHTML = html;
  }

  function pintarHud(p) {
    var cont = $("vfHud");
    if (!cont) return;
    var delivery = p.entrega === "delivery";
    var idx = indiceDe(p.estado);
    var estados = ["", "", ""];
    if (p.estado === "cancelado") {
      estados[0] = "hecha";
    } else if (idx >= 0) {
      var paradaEscena = idx <= 1 ? 0 : (idx === 2 ? 1 : 2);
      for (var i = 0; i < 3; i++) {
        if (i < paradaEscena) estados[i] = "hecha";
        else if (i === paradaEscena) estados[i] = "activa";
      }
    }
    var etiquetas = ["Distribuidor", "En ruta", delivery ? "Tu casa" : "El local"];
    cont.innerHTML = etiquetas.map(function (t, i) {
      return '<span class="vf-hud__parada" data-estado="' + estados[i] + '">' + esc(t) + "</span>";
    }).join("");
  }

  function pintarParadas(p) {
    var cont = $("vfParadas");
    if (!cont) return;
    var paradas = paradasDe(p);
    var idx = indiceDe(p.estado);
    var horas = eventosPorEstado(p.eventos, p.creado);
    cont.innerHTML = paradas.map(function (par, i) {
      var est;
      if (p.estado === "cancelado") est = horas[par.id] ? "hecha" : "no";
      else if (p.estado === "entregado") est = "hecha";
      else est = i < idx ? "hecha" : (i === idx ? "activa" : "no");
      var cuando = horas[par.id]
        ? fechaHora(horas[par.id])
        : (est === "activa" ? "en curso" : (est === "no" ? "pendiente" : "—"));
      return '<li class="vf-parada" data-estado="' + est + '">' +
        '<span class="vf-parada__punto">' + (est === "hecha" ? "✓" : String(i + 1)) + "</span>" +
        '<div class="vf-parada__cuerpo">' +
          '<span class="vf-parada__titulo">' + esc(par.titulo) + "</span>" +
          '<span class="vf-parada__hora">' + esc(cuando) + "</span>" +
          '<span class="vf-parada__detalle">' + esc(par.detalle) + "</span>" +
        "</div>" +
      "</li>";
    }).join("");
  }

  function pintarDatos(p) {
    var cont = $("vfDatos");
    if (!cont) return;
    var filas = [];
    var local = p.local || {};
    var pago = "";
    if (p.metodo_pago === "efectivo" && Number(p.pago_con) > 0) {
      pago = "Efectivo · paga con " + clp(p.pago_con) + " · vuelto " + clp(p.vuelto);
      if (Number(p.vuelto) <= 0) pago = "Efectivo · paga con " + clp(p.pago_con);
    } else if (p.metodo_pago) {
      pago = p.metodo_pago === "transferencia" ? "Transferencia" : p.metodo_pago;
    }
    filas.push('<div class="vf-datos__fila"><span class="vf-datos__rot">Tienda</span>' +
      '<span class="vf-datos__val">' + esc(local.nombre || "—") +
      (local.abierto === false ? " · cerrada" : (local.abierto ? " · abierta" : "")) + "</span></div>");
    if (local.direccion || local.comuna) {
      filas.push('<div class="vf-datos__fila"><span class="vf-datos__rot">Local</span>' +
        '<span class="vf-datos__val">' + esc([local.direccion, local.comuna].filter(Boolean).join(", ")) + "</span></div>");
    }
    if (local.telefono) {
      filas.push('<div class="vf-datos__fila"><span class="vf-datos__rot">Contacto</span>' +
        '<span class="vf-datos__val"><a class="vf-datos__tel" href="tel:' + esc(String(local.telefono).replace(/[^\d+]/g, "")) + '">' +
        esc(local.telefono) + "</a></span></div>");
    }
    var entrega = p.entrega === "delivery"
      ? "Delivery" + (p.direccion ? " · " + [p.direccion, p.comuna_entrega].filter(Boolean).join(", ") : "")
      : "Retiro en el local";
    filas.push('<div class="vf-datos__fila"><span class="vf-datos__rot">Entrega</span>' +
      '<span class="vf-datos__val">' + esc(entrega) + "</span></div>");
    if (p.referencia_entrega) {
      filas.push('<div class="vf-datos__fila"><span class="vf-datos__rot">Referencia</span>' +
        '<span class="vf-datos__val">' + esc(p.referencia_entrega) + "</span></div>");
    }
    filas.push('<div class="vf-datos__fila"><span class="vf-datos__rot">Total</span>' +
      '<span class="vf-datos__val">' + clp(p.total) + (pago ? " · " + esc(pago) : "") + "</span></div>");
    var items = Array.isArray(p.items) ? p.items.length : 0;
    if (items) {
      filas.push('<div class="vf-datos__fila"><span class="vf-datos__rot">Productos</span>' +
        '<span class="vf-datos__val">' + items + (items === 1 ? " línea" : " líneas") + "</span></div>");
    }
    if (p.clave_entrega && p.estado !== "entregado" && p.estado !== "cancelado") {
      filas.push('<div class="vf-datos__bloque"><span class="vf-datos__rot">Código de entrega (lo pide el repartidor)</span>' +
        '<span class="vf-clave">' + esc(p.clave_entrega) + "</span></div>");
    }
    cont.innerHTML = filas.join("");
  }

  function montarEscena(p) {
    var canvas = $("vfCanvas");
    var fallback = $("vfFallback");
    if (!canvas) return;
    if (!hayWebGL()) {
      canvas.hidden = true;
      if (fallback) fallback.hidden = false;
      return;
    }
    if (ESTADO.escena) {
      ESTADO.escena.actualizar(p);
      return;
    }
    cargarThree().then(function () {
      if (ESTADO.escena) { ESTADO.escena.actualizar(p); return; }
      try {
        ESTADO.escena = crearEscena(canvas, p);
      } catch (e) {
        canvas.hidden = true;
        if (fallback) fallback.hidden = false;
      }
    }).catch(function () {
      canvas.hidden = true;
      if (fallback) fallback.hidden = false;
    });
  }

  function pintar(p) {
    ESTADO.pedido = p;
    var res = $("vfResultado");
    var form = $("vfForm");
    if (res) res.hidden = false;
    if (form) form.hidden = true;
    var sub = $("vfSub");
    if (sub) sub.textContent = "Este es el estado real de tu envío. Se actualiza solo cada pocos segundos.";
    pintarEstado(p);
    pintarHud(p);
    pintarParadas(p);
    pintarDatos(p);
    montarEscena(p);
    F.titulo && F.titulo("Verificar envío");
  }

  function error(txt) {
    var el = $("vfError");
    if (!el) return;
    el.textContent = txt || "";
    el.hidden = !txt;
  }

  function cargando(si) {
    ESTADO.cargando = si;
    var b = $("vfBuscar");
    if (b) { b.disabled = si; b.textContent = si ? "Verificando…" : "Verificar envío"; }
  }

  /* ── flujo ────────────────────────────────────────────────────────────── */

  function programar() {
    if (ESTADO.timer) clearTimeout(ESTADO.timer);
    ESTADO.timer = setTimeout(function () {
      if (!ESTADO.pedido) return;
      if (document.hidden) { programar(); return; }
      verificar(ESTADO.pedido.verificacion, { silencioso: true });
    }, ESPERA_MS);
  }

  function falloRed() {
    var horaTexto = hora(ESTADO.ultimoOk) || hora(Date.now());
    ESTADO.errorRed = "Sin conexión con la nube. Se muestra el último estado verificado a las " + horaTexto +
      (/m\.?$/.test(horaTexto) ? "" : ".");
    if (ESTADO.pedido) pintarEstado(ESTADO.pedido);
  }

  /**
   * `opciones.silencioso` evita spinners y errores de formulario: es el
   * refresco automático. Si falla, conserva el pedido y avisa en la tarjeta.
   */
  function verificar(codigo, opciones) {
    var o = opciones || {};
    var limpio = normalizarCodigo(codigo);
    if (limpio.length !== 9) {
      if (!o.silencioso) error("El código tiene 9 caracteres: una V y 8 más. Revísalo.");
      return Promise.resolve();
    }
    if (!o.silencioso) { error(""); cargando(true); }
    return pedir(limpio).then(function (d) {
      if (!o.silencioso) cargando(false);
      if (d && d.ok && d.pedido) {
        ESTADO.ultimoOk = Date.now();
        ESTADO.errorRed = "";
        guardarUltimo(limpio);
        pintar(d.pedido);
        programar();
        return;
      }
      var msg = (d && d.error) || "No pudimos verificar ese código.";
      if (o.silencioso && ESTADO.pedido) { falloRed(); programar(); return; }
      if (!o.silencioso) {
        error(d && d.codigo === "BLOQUEADO"
          ? "Demasiados intentos desde esta conexión. Espera unos minutos y vuelve a probar."
          : msg);
      }
    }).catch(function () {
      if (!o.silencioso) cargando(false);
      if (ESTADO.pedido) { falloRed(); programar(); }
      else if (!o.silencioso) error("No hay conexión. Revisa tu internet e inténtalo de nuevo.");
    });
  }

  function mostrarFormulario() {
    var res = $("vfResultado");
    var form = $("vfForm");
    if (res) res.hidden = true;
    if (form) form.hidden = false;
    var input = $("vfCodigo");
    if (input) { input.value = ""; input.focus(); }
    error("");
    if (ESTADO.timer) { clearTimeout(ESTADO.timer); ESTADO.timer = null; }
    ESTADO.pedido = null;
    if (ESTADO.escena) { ESTADO.escena.destruir(); ESTADO.escena = null; }
    var canvas = $("vfCanvas");
    if (canvas) canvas.hidden = false;
    var fb = $("vfFallback");
    if (fb) fb.hidden = true;
  }

  function montar() {
    if (F.montaNav) F.montaNav();

    var form = $("vfForm");
    var input = $("vfCodigo");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var codigo = normalizarCodigo(input && input.value);
        if (codigo.length !== 9) { error("El código tiene 9 caracteres: una V y 8 más. Revísalo."); return; }
        if (input) input.value = mostrarCodigo(codigo);
        verificar(codigo);
        if (input) input.blur();
      });
    }
    if (input) {
      input.addEventListener("input", function () {
        var pos = input.selectionStart;
        var formateado = mostrarCodigo(input.value);
        if (formateado) {
          input.value = formateado;
          try { input.setSelectionRange(pos, pos); } catch (e) { /* sin foco */ }
        }
      });
    }
    var refrescar = $("vfRefrescar");
    if (refrescar) refrescar.addEventListener("click", function () {
      if (ESTADO.pedido) verificar(ESTADO.pedido.verificacion, { silencioso: false });
    });
    var otra = $("vfOtra");
    if (otra) otra.addEventListener("click", mostrarFormulario);

    var q = "";
    try { q = new URLSearchParams(location.search).get("v") || ""; } catch (e) { q = ""; }
    var inicio = normalizarCodigo(q || leerUltimo());
    if (inicio.length === 9) {
      if (input) input.value = mostrarCodigo(inicio);
      verificar(inicio);
    }
  }

  window.Verificar = {
    verificar: verificar,
    /* Diagnóstico: posición del auto en la ruta y por qué estado está parado.
       Devuelve null si la escena no existe (sin WebGL o sin pedido). */
    posicionAuto: function () {
      return ESTADO.escena && ESTADO.escena.posicion ? ESTADO.escena.posicion() : null;
    },
    pedidoActual: function () {
      return ESTADO.pedido ? {
        codigo: ESTADO.pedido.codigo,
        estado: ESTADO.pedido.estado,
        verificacion: ESTADO.pedido.verificacion,
        comprobado: ESTADO.ultimoOk,
        errorRed: ESTADO.errorRed,
      } : null;
    },
    _test: {
      normalizarCodigo: normalizarCodigo,
      mostrarCodigo: mostrarCodigo,
      estadoInfo: estadoInfo,
      paradasDe: paradasDe,
      indiceDe: indiceDe,
      eventosPorEstado: eventosPorEstado,
      posicionDe: posicionDe,
      fechaHora: fechaHora,
      /* La escena también se prueba sin GPU: con un THREE simulado se
         comprueba que el auto sigue al estado real. */
      crearEscena: crearEscena,
      hayWebGL: hayWebGL,
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", montar);
  } else {
    montar();
  }
})();
