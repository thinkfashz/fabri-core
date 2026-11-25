/* MercaFabrick · auth.js
   --------------------------------------------------------------------------
   Login y registro de MercaFabrick contra https://fabri-api.vercel.app/api/auth.
   La sesión se comparte con el panel web en localStorage["fcore.nube"].
   El dispositivo se identifica en localStorage["fcore.dispositivo"].
   Vanilla JS, sin dependencias. Comentarios en español.

   Expone window.MercaAuth con:
     montar(contenedor, opciones)   pinta el formulario y arranca el canvas
     sesion()                       devuelve la sesión guardada o null
     salir()                        borra la sesión y libera el canvas
     canvas()                       animación de fondo (red de barrio)
*/

(function () {
  "use strict";

  /* ── Constantes y tokens del sistema de diseño (FORGE CORE STOCK PRO) ── */
  var API_AUTH = "https://fabri-api.vercel.app/api/auth";
  var LS_SESION = "fcore.nube";
  var LS_DISPOSITIVO = "fcore.dispositivo";
  var CONTENEDOR_ID = "mfAuth";
  var CANVAS_ID = "mfAuthCanvas";
  var STYLE_ID = "mf-auth-styles";
  var TIEMPO_ESPERA_MS = 15000;

  var C = {
    fondo: "#050505",
    superficie: "#0B0B0B",
    texto: "#FFFFFF",
    textoSec: "#B7FF32",
    borde: "#1A1A1A",
    lima: "#C8FF00",
    textoLima: "#050505",
    bordeFoco: "#C8FF00",
    alerta: "#FF3B30",
    exito: "#34C759",
    sombra: "rgba(0, 0, 0, 0.4)",
  };

  /* ── Estado del módulo ── */
  var modo = "entrar";          // "entrar" | "registrar"
  var cargando = false;
  var optsActual = {};
  var animId = null;
  var ctx = null;
  var particles = [];
  var visible = true;
  var reducido = false;

  /* ── Helpers DOM ── */
  var $ = function (s, raiz) { return (raiz || document).querySelector(s); };
  var esc = function (t) {
    var d = document.createElement("div");
    d.textContent = t;
    return d.innerHTML;
  };

  /* ── Sesión y dispositivo (misma clave que el panel web) ── */
  function dispositivoId() {
    try {
      var v = localStorage.getItem(LS_DISPOSITIVO);
      if (v && /^[A-Za-z0-9_-]{16,64}$/.test(v)) return v;
    } catch (e) {}
    var alfa = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
    var lon = 32;
    var b = new Uint8Array(lon);
    var id = "";
    var i;
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      crypto.getRandomValues(b);
      for (i = 0; i < lon; i++) id += alfa[b[i] % alfa.length];
    } else {
      for (i = 0; i < lon; i++) id += alfa[Math.floor(Math.random() * alfa.length)];
    }
    try { localStorage.setItem(LS_DISPOSITIVO, id); } catch (e) {}
    return id;
  }

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
        guardado: Date.now()
      }));
    } catch (e) {}
  }

  function borrarSesion() {
    try { localStorage.removeItem(LS_SESION); } catch (e) {}
  }

  /* ── Llamada a la API de autenticación ── */
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

  /* ── Estilos inyectados (no se toca merca.css) ── */
  function inyectarEstilos() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = [
      /* La posición de #mfAuth y #mfAuthCanvas la define merca.css; aquí sólo
         el formulario. Antes este bloque ponía el canvas fijo encima de la
         app y la dejaba en negro al entrar. */
      ".mfa-panel{background:" + C.superficie + ";border:1px solid " + C.borde + ";border-radius:12px;padding:24px 20px;box-shadow:" + C.sombra + ";}",
      ".mfa-titulo{margin:0 0 8px;font-size:24px;line-height:1.2;color:" + C.texto + ";font-weight:600;letter-spacing:-0.02em;}",
      ".mfa-sub{margin:0 0 20px;font-size:14px;line-height:1.5;color:" + C.textoSec + ";}",
      ".mfa-campo{margin:0 0 14px;}",
      ".mfa-etiqueta{display:block;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:" + C.textoSec + ";margin:0 0 6px;font-weight:500;}",
      "input.mfa-input{width:100%;min-height:44px;padding:10px 14px;background:" + C.fondo + ";border:1px solid " + C.borde + ";border-radius:12px;color:" + C.texto + ";font-family:Inter,-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;font-size:16px;box-sizing:border-box;}",
      "input.mfa-input:focus{outline:none;border-color:" + C.bordeFoco + ";box-shadow:0 0 0 2px rgba(200,255,0,0.1);}",
      ".mfa-check{display:flex;align-items:center;gap:10px;margin:10px 0 18px;font-size:14px;color:" + C.texto + ";}",
      ".mfa-check input{width:18px;height:18px;accent-color:" + C.lima + ";}",
      "button.mfa-boton{width:100%;min-height:48px;background:" + C.lima + ";color:" + C.textoLima + ";border:none;border-radius:12px;font-family:Inter,-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;font-size:14px;font-weight:500;cursor:pointer;}",
      "button.mfa-boton:disabled{opacity:0.55;cursor:not-allowed;}",
      "button.mfa-boton:focus-visible{outline:2px solid " + C.bordeFoco + ";outline-offset:2px;}",
      "button.mfa-cambiar{margin-top:14px;background:transparent;border:none;color:" + C.texto + ";font-family:inherit;font-size:14px;cursor:pointer;text-align:left;width:100%;padding:0;}",
      "button.mfa-cambiar:focus-visible{outline:2px solid " + C.bordeFoco + ";outline-offset:2px;}",
      "button.mfa-cambiar:hover{color:" + C.lima + ";}",
      "#mf-error{margin:12px 0 0;padding:10px 14px;background:rgba(255,59,48,0.1);border:1px solid " + C.alerta + ";border-radius:8px;color:" + C.alerta + ";font-size:14px;line-height:1.4;display:none;}",
      "#mf-estado{margin:8px 0 0;font-size:14px;color:" + C.textoSec + ";min-height:20px;}",
      ".mfa-oculto{display:none !important;}",
      "@media (max-width:360px){.mfa-panel{padding:18px 14px;} .mfa-titulo{font-size:22px;}}"
    ].join("\n");
    document.head.appendChild(s);
  }

  /* ── Retroalimentación al usuario ── */
  var mostrarError = function (msg) {
    var el = document.getElementById("mf-error");
    if (el) { el.textContent = esc(msg); el.style.display = "block"; }
  };
  var ocultarError = function () {
    var el = document.getElementById("mf-error");
    if (el) el.style.display = "none";
  };
  var mostrarEstado = function (msg) {
    var el = document.getElementById("mf-estado");
    if (el) el.textContent = msg;
  };

  var iniciarCarga = function (activa) {
    cargando = activa;
    var btn = document.getElementById("mfa-boton");
    var estado = document.getElementById("mf-estado");
    if (btn) {
      btn.disabled = activa;
      btn.textContent = activa ? (modo === "registrar" ? "Creando cuenta…" : "Entrando…") : (modo === "registrar" ? "Crear cuenta" : "Entrar");
    }
    if (estado) estado.textContent = activa ? "Conectando con la nube…" : "";
    if (activa) ocultarError();
  };

  /* ── Capa de login: se muestra y se retira ─────────────────────────────
     Es la pieza que faltaba: al entrar con éxito hay que quitar el canvas y
     el formulario, o quedan tapando la app (pantalla negra). */
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

  /* ── Render del formulario ── */
  var render = function (contenedor) {
    contenedor.innerHTML = "";
    var esReg = modo === "registrar";
    var panel = document.createElement("div");
    panel.className = "mfa-panel";
    panel.setAttribute("role", "form");
    panel.setAttribute("aria-label", esReg ? "Crear cuenta en MercaFabrick" : "Iniciar sesión en MercaFabrick");

    var html = "";
    html += "<h2 class=\"mfa-titulo\">" + (esReg ? "Crear cuenta" : "Entrar a MercaFabrick") + "</h2>";
    html += "<p class=\"mfa-sub\">" + (esReg ? "Únete al mercado de tu barrio." : "Bienvenido de vuelta.") + "</p>";
    html += "<form id=\"mfa-form\" novalidate>";
    if (esReg) {
      html += "<div class=\"mfa-campo\"><label class=\"mfa-etiqueta\">Nombre completo</label><input id=\"mfa-nombre\" class=\"mfa-input\" type=\"text\" autocomplete=\"name\" placeholder=\"Juan Pérez\" required></div>";
    }
    html += "<div class=\"mfa-campo\"><label class=\"mfa-etiqueta\">Correo electrónico</label><input id=\"mfa-email\" class=\"mfa-input\" type=\"email\" autocomplete=\"username\" placeholder=\"tucorreo@ejemplo.cl\" required></div>";
    html += "<div class=\"mfa-campo\"><label class=\"mfa-etiqueta\">Contraseña</label><input id=\"mfa-pass\" class=\"mfa-input\" type=\"password\" autocomplete=\"current-password\" placeholder=\"••••••••\" required></div>";
    if (esReg) {
      html += "<div class=\"mfa-check\"><input type=\"checkbox\" id=\"mfa-terminos\" required><label for=\"mfa-terminos\">Acepto los <a href=\"#\" class=\"mfa-link\">términos y condiciones</a></label></div>";
    }
    html += "<button id=\"mfa-boton\" class=\"mfa-boton\" type=\"submit\">" + (esReg ? "Crear cuenta" : "Entrar") + "</button>";
    html += "</form>";
    html += "<button id=\"mfa-cambiar\" class=\"mfa-cambiar\" type=\"button\">" + (esReg ? "¿Ya tienes cuenta? Entrar" : "¿No tienes cuenta? Crear cuenta") + "</button>";
    html += "<div id=\"mf-error\" role=\"alert\" aria-live=\"polite\"></div>";
    html += "<div id=\"mf-estado\" aria-live=\"polite\"></div>";

    panel.innerHTML = html;
    contenedor.appendChild(panel);
    engancharEventos(panel);
  };

  var engancharEventos = function (panel) {
    var form = panel.querySelector("#mfa-form");
    var cambiar = panel.querySelector("#mfa-cambiar");

    form.onsubmit = function (e) {
      e.preventDefault();
      if (cargando) return;

      var elNombre = document.getElementById("mfa-nombre");
      var elEmail = document.getElementById("mfa-email");
      var elPass = document.getElementById("mfa-pass");
      var elTerminos = document.getElementById("mfa-terminos");
      var esReg = modo === "registrar";

      var cuerpo = { accion: modo, email: (elEmail ? elEmail.value : "").trim(), pass: elPass ? elPass.value : "" };
      if (esReg) {
        cuerpo.nombre = elNombre ? elNombre.value.trim() : "";
        cuerpo.acepta_terminos = elTerminos ? elTerminos.checked : false;
        if (!cuerpo.nombre) { mostrarError("Ingresa tu nombre completo."); return; }
        if (!cuerpo.acepta_terminos) { mostrarError("Debes aceptar los términos y condiciones para crear tu cuenta."); return; }
      }
      if (!cuerpo.email) { mostrarError("Ingresa tu correo electrónico."); return; }
      if (!cuerpo.pass || cuerpo.pass.length < 6) { mostrarError("La contraseña debe tener al menos 6 caracteres."); return; }

      iniciarCarga(true);
      apiAuth(cuerpo).then(function (r) {
        iniciarCarga(false);
        if (!r.ok) {
          var msg = (r.d && r.d.error) ? r.d.error : "";
          if (r.status === 401 || /credencial|contraseña|usuario|correo|email/i.test(msg || "")) {
            msg = "Correo o contraseña incorrectos.";
          }
          if (r.status === 0 || (r.d && r.d.codigo === "SIN_RED")) {
            msg = "Sin conexión. Revisa tu internet.";
          }
          mostrarError(msg || "La nube respondió un error. Intenta nuevamente.");
          return;
        }
        var d = r.d || {};
        if (!d.token) { mostrarError("La respuesta de la nube no incluye sesión."); return; }
        var exp = d.expira ? Number(d.expira) : Date.now() + 30 * 24 * 60 * 60 * 1000;
        guardarSesion(d.token, exp, d.usuario || {});
        mostrarEstado("Sesión iniciada.");
        /* Primero se retira la capa de login y recién después se pinta la
           app: si se pinta antes, el canvas tapa todo y parece que no cargó. */
        detenerCanvas();
        cerrarPantalla();
        if (optsActual && optsActual.alEntrar) optsActual.alEntrar(d.usuario || {});
      }).catch(function () {
        iniciarCarga(false);
        mostrarError("Sin conexión. Revisa tu internet.");
      });
    };

    cambiar.onclick = function () {
      modo = modo === "entrar" ? "registrar" : "entrar";
      ocultarError();
      mostrarEstado("");
      render(panel.parentElement);
    };
  };

  /* ── Canvas: red de barrio (partículas conectadas) ── */
  var crearParticulas = function (w, h) {
    var n = Math.floor((w * h) / 9000);
    if (n < 12) n = 12;
    if (n > 40) n = 40;
    var arr = [];
    var i;
    for (i = 0; i < n; i++) {
      arr.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r: 1 + Math.random() * 2
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
    ctx.strokeStyle = "rgba(200,255,0,0.08)";
    ctx.lineWidth = 1;
    ctx.fillStyle = "rgba(255,255,255,0.6)";

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
        if (d < 160) {
          ctx.globalAlpha = 0.08 * (1 - d / 160);
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

  /* ── API pública ── */
  var montar = function (contenedor, opciones) {
    if (!contenedor) return;
    optsActual = opciones || {};

    // Si ya hay sesión válida, la app se pinta directo y el login no aparece.
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
    // Al cerrar sesión se vuelve al login, no a una app sin cuenta.
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
    canvas: canvas
  };
})();
