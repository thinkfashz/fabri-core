/* MercaFabrick · auth.js
   --------------------------------------------------------------------------
   Login y registro contra https://fabri-api.vercel.app/api/auth.
   La sesión se comparte con el panel web en localStorage["fcore.nube"] y el
   dispositivo en localStorage["fcore.dispositivo"].
   Vanilla JS, sin dependencias.

   Expone window.MercaAuth con:
     montar(contenedor, opciones)   pinta el formulario y arranca el canvas
     sesion()                       sesión guardada o null
     salir()                        borra la sesión y vuelve al login
     canvas()                       animación de fondo
   -------------------------------------------------------------------------- */

(function () {
  "use strict";

  var API_AUTH = "https://fabri-api.vercel.app/api/auth";
  var LS_SESION = "fcore.nube";
  var LS_DISPOSITIVO = "fcore.dispositivo";
  var CONTENEDOR_ID = "mfAuth";
  var CANVAS_ID = "mfAuthCanvas";
  var STYLE_ID = "mf-auth-styles";
  var TIEMPO_ESPERA_MS = 15000;

  var C = {
    lima: "#C8FF00",
    limaOscuro: "#A8E000",
    tinta: "#0A1000",
    texto: "#FFFFFF",
    texto2: "rgba(235,235,245,0.62)",
    texto3: "rgba(235,235,245,0.38)",
    linea: "rgba(255,255,255,0.10)",
    tarjeta: "#0D0D12",
    rojo: "#FF453A",
  };

  /* ── Estado ───────────────────────────────────────────────────────── */
  var modo = "entrar";
  var cargando = false;
  var optsActual = {};
  var animId = null;
  var ctx = null;
  var particles = [];
  var visible = true;
  var reducido = false;

  /* ── Helpers ──────────────────────────────────────────────────────── */
  function sesion() {
    try {
      var d = JSON.parse(localStorage.getItem(LS_SESION) || "null");
      return d && d.token && d.exp && Number(d.exp) > Date.now() ? d : null;
    } catch (e) { return null; }
  }

  function guardarSesion(token, exp, usuario) {
    try {
      localStorage.setItem(LS_SESION, JSON.stringify({
        token: token,
        exp: Number(exp),
        usuario: usuario || {},
        guardado: Date.now(),
      }));
    } catch (e) {}
  }

  function borrarSesion() {
    try { localStorage.removeItem(LS_SESION); } catch (e) {}
  }

  function dispositivoId() {
    try {
      var v = localStorage.getItem(LS_DISPOSITIVO);
      if (v && /^[A-Za-z0-9_-]{16,64}$/.test(v)) return v;
    } catch (e) {}
    var alfa = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
    var b = new Uint8Array(32);
    var id = "";
    var i;
    if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
    for (i = 0; i < 32; i++) id += alfa[b[i] % alfa.length];
    try { localStorage.setItem(LS_DISPOSITIVO, id); } catch (e) {}
    return id;
  }

  function apiAuth(cuerpo) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIEMPO_ESPERA_MS);
    return fetch(API_AUTH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
      signal: ctrl ? ctrl.signal : undefined,
    }).then(function (resp) {
      return resp.json().catch(function () { return {}; }).then(function (d) {
        return { ok: resp.ok && d.ok !== false, status: resp.status, d: d || {} };
      });
    }).catch(function (e) {
      return { ok: false, status: 0, d: { codigo: "SIN_RED", error: e.message || "Sin conexión." } };
    }).then(function (r) { clearTimeout(t); return r; });
  }

  /* ── Capa de login: se muestra y se retira ─────────────────────────── */
  var mostrarPantalla = function () {
    var cont = document.getElementById(CONTENEDOR_ID);
    var lienzo = document.getElementById(CANVAS_ID);
    if (cont) cont.classList.add("mf-auth--visible");
    if (lienzo) lienzo.classList.add("mf-auth--visible");
    document.body.classList.add("mf-auth-bloqueado");
  };

  var cerrarPantalla = function () {
    var cont = document.getElementById(CONTENEDOR_ID);
    var lienzo = document.getElementById(CANVAS_ID);
    if (cont) {
      cont.classList.remove("mf-auth--visible");
      cont.innerHTML = "";
    }
    if (lienzo) {
      lienzo.classList.remove("mf-auth--visible");
      var c2 = lienzo.getContext("2d");
      if (c2) c2.clearRect(0, 0, lienzo.width, lienzo.height);
    }
    document.body.classList.remove("mf-auth-bloqueado");
  };

  /* ── Estilos del formulario ───────────────────────────────────────── */
  function inyectarEstilos() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = [
      ".mfa-panel{width:100%;max-width:400px;margin:0 auto;}",
      ".mfa-marca{display:flex;align-items:center;gap:12px;margin:0 0 26px;}",
      ".mfa-marca__ico{width:52px;height:52px;border-radius:16px;background:" + C.lima +
        ";color:" + C.tinta + ";display:grid;place-items:center;font-size:26px;font-weight:800;" +
        "letter-spacing:-0.05em;box-shadow:0 10px 30px rgba(200,255,0,0.25);}",
      ".mfa-marca__txt b{display:block;font-size:15px;font-weight:700;letter-spacing:-0.01em;}",
      ".mfa-marca__txt small{color:" + C.texto3 + ";font-size:12px;}",
      ".mfa-titulo{margin:0 0 6px;font-size:32px;line-height:1.1;font-weight:800;letter-spacing:-0.03em;color:" + C.texto + ";}",
      ".mfa-sub{margin:0 0 22px;font-size:15px;line-height:1.5;color:" + C.texto2 + ";}",
      ".mfa-seg{display:flex;gap:2px;padding:3px;background:rgba(255,255,255,0.08);border-radius:14px;margin:0 0 20px;}",
      ".mfa-seg button{flex:1 1 0;height:42px;border:0;border-radius:11px;background:transparent;color:" +
        C.texto2 + ";font-size:14.5px;font-weight:600;font-family:inherit;cursor:pointer;transition:background .2s,color .2s;}",
      ".mfa-seg button[aria-pressed='true']{background:#1C1C22;color:" + C.texto + ";box-shadow:0 2px 10px rgba(0,0,0,0.4);}",
      ".mfa-grupo{background:" + C.tarjeta + ";border:1px solid " + C.linea + ";border-radius:18px;padding:4px 16px;margin:0 0 18px;}",
      ".mfa-campo{padding:12px 0;border-bottom:1px solid " + C.linea + ";}",
      ".mfa-campo:last-child{border-bottom:0;}",
      ".mfa-etiqueta{display:block;font-size:11.5px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:" +
        C.texto3 + ";margin:0 0 2px;}",
      "input.mfa-input{width:100%;height:38px;border:0;background:transparent;color:" + C.texto +
        ";font-size:16px;font-family:inherit;outline:none;padding:0;}",
      "input.mfa-input::placeholder{color:" + C.texto3 + ";}",
      ".mfa-check{display:flex;align-items:flex-start;gap:10px;margin:0 0 18px;font-size:13.5px;color:" + C.texto2 + ";line-height:1.4;}",
      ".mfa-check input{width:18px;height:18px;margin-top:1px;accent-color:" + C.lima + ";flex:0 0 auto;}",
      ".mfa-check a{color:" + C.lima + ";text-decoration:none;}",
      "button.mfa-boton{width:100%;height:52px;border:0;border-radius:16px;background:" + C.lima +
        ";color:" + C.tinta + ";font-size:16px;font-weight:700;font-family:inherit;cursor:pointer;" +
        "box-shadow:0 12px 34px rgba(200,255,0,0.20);transition:transform .16s,background .2s;}",
      "button.mfa-boton:active{transform:scale(0.985);background:" + C.limaOscuro + ";}",
      "button.mfa-boton:disabled{opacity:0.5;cursor:not-allowed;}",
      "#mf-error{margin:14px 0 0;padding:12px 14px;background:rgba(255,69,58,0.12);border:1px solid rgba(255,69,58,0.35);" +
        "border-radius:14px;color:#FFD9D6;font-size:14px;line-height:1.4;display:none;}",
      "#mf-estado{margin:10px 0 0;font-size:14px;color:" + C.texto2 + ";min-height:20px;}",
      ".mfa-version{margin:26px 0 0;text-align:center;font-size:11px;letter-spacing:0.08em;color:" + C.texto3 + ";}",
      ".mfa-oculto{display:none !important;}",
      "@media (max-width:360px){.mfa-titulo{font-size:28px;}.mfa-marca{margin-bottom:20px;}}",
    ].join("\n");
    document.head.appendChild(s);
  }

  /* ── Retroalimentación ────────────────────────────────────────────── */
  var mostrarError = function (msg) {
    var el = document.getElementById("mf-error");
    if (!el) return;
    el.textContent = msg;
    el.style.display = "block";
  };
  var ocultarError = function () {
    var el = document.getElementById("mf-error");
    if (el) { el.style.display = "none"; el.textContent = ""; }
  };
  var mostrarEstado = function (msg) {
    var el = document.getElementById("mf-estado");
    if (el) el.textContent = msg || "";
  };

  /* ── Render del formulario ────────────────────────────────────────── */
  var render = function (contenedor) {
    contenedor.innerHTML = "";
    var esReg = modo === "registrar";

    var panel = document.createElement("div");
    panel.className = "mfa-panel";
    panel.setAttribute("role", "form");
    panel.setAttribute("aria-label", esReg ? "Crear cuenta en MercaFabrick" : "Iniciar sesión en MercaFabrick");

    var html = "";
    html += '<div class="mfa-marca">' +
      '<span class="mfa-marca__ico" aria-hidden="true">M</span>' +
      '<span class="mfa-marca__txt"><b>MercaFabrick</b><small>tu barrio, en stock</small></span>' +
      "</div>";

    html += '<h1 class="mfa-titulo">' + (esReg ? "Crea tu cuenta" : "Bienvenido") + "</h1>";
    html += '<p class="mfa-sub">' +
      (esReg ? "Compra en los locales de tu comuna y paga al retirar o recibir."
             : "Entra para guardar tus pedidos y comprar en tu barrio.") + "</p>";

    html += '<div class="mfa-seg" role="tablist" aria-label="Acceso">' +
      '<button type="button" data-modo="entrar" aria-pressed="' + (!esReg ? "true" : "false") + '">Entrar</button>' +
      '<button type="button" data-modo="registrar" aria-pressed="' + (esReg ? "true" : "false") + '">Crear cuenta</button>' +
      "</div>";

    html += '<form id="mfa-form" novalidate autocomplete="on">';
    html += '<div class="mfa-grupo">';
    if (esReg) {
      html += '<div class="mfa-campo"><label class="mfa-etiqueta" for="mfa-nombre">Nombre</label>' +
        '<input id="mfa-nombre" class="mfa-input" type="text" autocomplete="name" placeholder="Juan Pérez" required></div>';
    }
    html += '<div class="mfa-campo"><label class="mfa-etiqueta" for="mfa-email">Correo</label>' +
      '<input id="mfa-email" class="mfa-input" type="email" inputmode="email" autocomplete="username" placeholder="tucorreo@ejemplo.cl" required></div>';
    html += '<div class="mfa-campo"><label class="mfa-etiqueta" for="mfa-pass">Contraseña</label>' +
      '<input id="mfa-pass" class="mfa-input" type="password" autocomplete="' + (esReg ? "new-password" : "current-password") +
      '" placeholder="mínimo 6 caracteres" required></div>';
    html += "</div>";

    if (esReg) {
      html += '<label class="mfa-check" for="mfa-terminos">' +
        '<input type="checkbox" id="mfa-terminos" required>' +
        "<span>Acepto los <a href=\"#\" class=\"mfa-link\">términos y condiciones</a>.</span></label>";
    }

    html += '<button id="mfa-boton" class="mfa-boton" type="submit">' +
      (esReg ? "Crear cuenta" : "Entrar") + "</button>";
    html += "</form>";

    html += '<div id="mf-error" role="alert" aria-live="polite"></div>';
    html += '<div id="mf-estado" aria-live="polite"></div>';
    html += '<p class="mfa-version">MercaFabrick v' + (window.MF_VERSION || "1.2.0") + "</p>";

    panel.innerHTML = html;
    contenedor.appendChild(panel);
    engancharEventos(panel);
  };

  var engancharEventos = function (panel) {
    var form = panel.querySelector("#mfa-form");

    panel.querySelectorAll("[data-modo]").forEach(function (b) {
      b.onclick = function () {
        var m = b.dataset.modo;
        if (m === modo) return;
        modo = m;
        ocultarError();
        mostrarEstado("");
        render(panel.parentElement);
      };
    });

    form.onsubmit = function (e) {
      e.preventDefault();
      if (cargando) return;

      var elNombre = document.getElementById("mfa-nombre");
      var elEmail = document.getElementById("mfa-email");
      var elPass = document.getElementById("mfa-pass");
      var elTerminos = document.getElementById("mfa-terminos");
      var esReg = modo === "registrar";

      var cuerpo = {
        accion: modo,
        email: (elEmail ? elEmail.value : "").trim(),
        pass: elPass ? elPass.value : "",
        dispositivo: dispositivoId(),
      };
      if (esReg) {
        cuerpo.nombre = elNombre ? elNombre.value.trim() : "";
        cuerpo.acepta_terminos = elTerminos ? elTerminos.checked : false;
        if (!cuerpo.nombre) { mostrarError("Ingresa tu nombre."); return; }
        if (!cuerpo.acepta_terminos) { mostrarError("Debes aceptar los términos para crear tu cuenta."); return; }
      }
      if (!cuerpo.email) { mostrarError("Ingresa tu correo."); return; }
      if (!cuerpo.pass || cuerpo.pass.length < 6) { mostrarError("La contraseña debe tener al menos 6 caracteres."); return; }

      iniciarCarga(true);
      apiAuth(cuerpo).then(function (r) {
        iniciarCarga(false);
        if (!r.ok) {
          var msg = (r.d && r.d.error) ? r.d.error : "";
          if (r.status === 401 || /credencial|contraseña|usuario|correo|email/i.test(msg || "")) {
            msg = "Correo o contraseña incorrectos.";
          }
          if (r.status === 0 || (r.d && r.d.codigo === "SIN_RED")) msg = "Sin conexión. Revisa tu internet.";
          mostrarError(msg || "La nube respondió un error. Intenta de nuevo.");
          return;
        }
        var d = r.d || {};
        if (!d.token) { mostrarError("La respuesta de la nube no incluye sesión."); return; }
        var exp = d.expira ? Number(d.expira) : Date.now() + 30 * 24 * 60 * 60 * 1000;
        guardarSesion(d.token, exp, d.usuario || {});
        mostrarEstado("Sesión iniciada.");
        /* Primero se retira la capa de login y recién después se pinta la app. */
        detenerCanvas();
        cerrarPantalla();
        if (optsActual && optsActual.alEntrar) optsActual.alEntrar(d.usuario || {});
      }).catch(function () {
        iniciarCarga(false);
        mostrarError("Sin conexión. Revisa tu internet.");
      });
    };
  };

  var iniciarCarga = function (on) {
    cargando = on;
    var b = document.getElementById("mfa-boton");
    if (!b) return;
    b.disabled = on;
    b.textContent = on ? "Un momento…" : (modo === "registrar" ? "Crear cuenta" : "Entrar");
  };

  /* ── Canvas: red de barrio ────────────────────────────────────────── */
  var crearParticulas = function (w, h) {
    var n = Math.floor((w * h) / 11000);
    if (n < 14) n = 14;
    if (n > 42) n = 42;
    var arr = [];
    for (var i = 0; i < n; i++) {
      arr.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        r: 1 + Math.random() * 1.8,
      });
    }
    return arr;
  };

  var dibujar = function () {
    if (!ctx || reducido) return;
    var c = ctx.canvas;
    var w = c.width;
    var h = c.height;
    ctx.clearRect(0, 0, w, h);

    var i, j, p, q, dx, dy, d;
    ctx.strokeStyle = "rgba(200,255,0,0.10)";
    ctx.lineWidth = 1;
    ctx.fillStyle = "rgba(255,255,255,0.55)";

    for (i = 0; i < particles.length; i++) {
      p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();

      for (j = i + 1; j < particles.length; j++) {
        q = particles[j];
        dx = p.x - q.x;
        dy = p.y - q.y;
        d = Math.sqrt(dx * dx + dy * dy);
        if (d < 150) {
          ctx.globalAlpha = 0.10 * (1 - d / 150);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }
    animId = requestAnimationFrame(dibujar);
  };

  var detenerCanvas = function () {
    if (animId) { cancelAnimationFrame(animId); animId = null; }
    ctx = null;
    particles = [];
    var el = document.getElementById(CANVAS_ID);
    if (el) {
      var c2 = el.getContext("2d");
      if (c2) c2.clearRect(0, 0, el.width, el.height);
    }
  };

  var canvas = function () {
    detenerCanvas();
    var el = document.getElementById(CANVAS_ID);
    if (!el) return;

    reducido = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);

    var resize = function () {
      el.width = Math.floor(window.innerWidth * dpr);
      el.height = Math.floor(window.innerHeight * dpr);
      el.style.width = window.innerWidth + "px";
      el.style.height = window.innerHeight + "px";
      ctx = el.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      particles = crearParticulas(window.innerWidth, window.innerHeight);
      if (!reducido && visible && animId === null) dibujar();
    };

    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);
    document.addEventListener("visibilitychange", function () {
      visible = !document.hidden;
      if (visible && !reducido && animId === null) dibujar();
    });

    resize();
    if (!reducido) dibujar();
  };

  /* ── API pública ──────────────────────────────────────────────────── */
  var montar = function (contenedor, opciones) {
    if (!contenedor) return;
    optsActual = opciones || {};

    var s = sesion();
    if (s && optsActual.alEntrar) {
      detenerCanvas();
      cerrarPantalla();
      optsActual.alEntrar(s.usuario || {});
      return;
    }

    inyectarEstilos();
    mostrarPantalla();
    render(contenedor);
    canvas();
  };

  var salir = function () {
    borrarSesion();
    detenerCanvas();
    modo = "entrar";
    cargando = false;
    var cont = document.getElementById(CONTENEDOR_ID);
    inyectarEstilos();
    mostrarPantalla();
    if (cont) render(cont);
    canvas();
  };

  window.MercaAuth = {
    montar: montar,
    sesion: sesion,
    salir: salir,
    canvas: canvas,
  };
})();