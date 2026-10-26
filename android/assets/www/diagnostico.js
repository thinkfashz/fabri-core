/* ==========================================================================
   FABRI-CORE · escáner global de errores
   --------------------------------------------------------------------------
   Se carga ANTES que app.js a propósito: así captura también los errores de
   app.js, que son justo los que dejan la pantalla clavada en «Comprobando
   acceso…».

   No depende del núcleo, ni de app.css, ni de app.js: si el puente, la base o
   el motor fallan, el diagnóstico se ve igual y dice el error exacto. Los
   estilos van en línea por la misma razón (si el CSS no carga, esto sigue
   legible).
   ========================================================================== */
(function () {
  "use strict";

  var MAX = 80;
  var eventos = [];
  var panel = null;
  var lista = null;
  var boton = null;
  var insignia = null;
  var abierto = false;
  var sinLeer = 0;

  var C = {
    fondo: "#050505",
    panel: "#0B0B0B",
    borde: "#2A2A2A",
    lima: "#C8FF00",
    texto: "#FFFFFF",
    texto2: "#9A9A9A",
    error: "#F87171",
    aviso: "#FBBF24",
    ok: "#4ADE80",
    info: "#60A5FA"
  };

  function dosDigitos(n) { return (n < 10 ? "0" : "") + n; }

  function hora() {
    var d = new Date();
    return dosDigitos(d.getHours()) + ":" + dosDigitos(d.getMinutes()) + ":" + dosDigitos(d.getSeconds());
  }

  function color(tipo) {
    if (tipo === "error" || tipo === "fallo") return C.error;
    if (tipo === "aviso") return C.aviso;
    if (tipo === "ok") return C.ok;
    if (tipo === "prueba") return C.lima;
    return C.info;
  }

  function crearBoton() {
    if (boton || !document.body) return;
    boton = document.createElement("button");
    boton.type = "button";
    boton.id = "diagBoton";
    boton.setAttribute("aria-label", "Abrir el escáner de errores");
    boton.style.cssText = [
      "position:fixed", "right:12px", "bottom:76px", "z-index:2147483000",
      "display:flex", "align-items:center", "gap:6px",
      "padding:8px 12px", "border-radius:12px",
      "border:1px solid " + C.lima, "background:rgba(5,5,5,0.92)",
      "color:" + C.lima, "font:600 11px/1 ui-monospace,monospace",
      "letter-spacing:0.06em", "cursor:pointer",
      "box-shadow:0 4px 18px rgba(0,0,0,0.6)"
    ].join(";");
    boton.innerHTML = '<span aria-hidden="true">⚠</span><span id="diagInsignia">DIAG</span>';
    insignia = boton.querySelector("#diagInsignia");
    boton.addEventListener("click", function () { alternar(); });
    document.body.appendChild(boton);
  }

  function crearPanel() {
    if (panel || !document.body) return;
    panel = document.createElement("div");
    panel.id = "diagPanel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Escáner de errores de FABRI-CORE");
    panel.style.cssText = [
      "position:fixed", "left:0", "right:0", "bottom:0", "z-index:2147483001",
      "max-height:76vh", "display:none", "flex-direction:column",
      "background:" + C.panel, "border-top:2px solid " + C.lima,
      "box-shadow:0 -12px 40px rgba(0,0,0,0.8)",
      "font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace",
      "color:" + C.texto
    ].join(";");

    var cab = document.createElement("div");
    cab.style.cssText = "display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid " + C.borde + ";flex:0 0 auto";
    cab.innerHTML = '<strong style="color:' + C.lima + ';letter-spacing:0.08em;font-size:11px">ESCÁNER · FABRI-CORE</strong>';

    var sep = document.createElement("span");
    sep.style.cssText = "flex:1";
    cab.appendChild(sep);

    function botonCab(texto, accion, colorBorde) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = texto;
      b.style.cssText = [
        "padding:6px 10px", "border-radius:8px", "cursor:pointer",
        "border:1px solid " + (colorBorde || C.borde),
        "background:transparent",
        "color:" + (colorBorde || C.texto2),
        "font:600 11px/1 ui-monospace,monospace"
      ].join(";");
      b.addEventListener("click", accion);
      cab.appendChild(b);
      return b;
    }

    botonCab("Probar todo", function () { probarTodo(); }, C.lima);
    botonCab("Copiar", function () { copiar(); });
    botonCab("Limpiar", function () { eventos = []; sinLeer = 0; pintar(); });
    botonCab("Cerrar", function () { alternar(false); });

    lista = document.createElement("div");
    lista.style.cssText = "overflow-y:auto;padding:8px 12px 16px;flex:1 1 auto;-webkit-overflow-scrolling:touch";

    panel.appendChild(cab);
    panel.appendChild(lista);
    document.body.appendChild(panel);
    pintar();
  }

  function alternar(estado) {
    crearBoton();
    crearPanel();
    abierto = (typeof estado === "boolean") ? estado : !abierto;
    panel.style.display = abierto ? "flex" : "none";
    if (abierto) {
      sinLeer = 0;
      actualizarInsignia();
    }
  }

  function actualizarInsignia() {
    if (!insignia) return;
    if (sinLeer > 0) {
      insignia.textContent = "DIAG · " + sinLeer;
      insignia.style.color = C.error;
    } else {
      insignia.textContent = "DIAG";
      insignia.style.color = "";
    }
  }

  function esc(t) {
    return String(t == null ? "" : t)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function pintar() {
    if (!lista) return;
    if (!eventos.length) {
      lista.innerHTML = '<p style="color:' + C.texto2 + ';margin:8px 0">'
        + "Sin eventos todavía. Pulsa «Probar todo» para revisar puente, base, motor y terminal."
        + "</p>";
      return;
    }
    lista.innerHTML = eventos.slice().reverse().map(function (e) {
      return '<div style="padding:6px 0;border-bottom:1px solid ' + C.borde + '">'
        + '<div style="display:flex;gap:8px;align-items:baseline">'
        + '<span style="color:' + C.texto2 + ';font-size:10px">' + esc(e.hora) + "</span>"
        + '<span style="color:' + color(e.tipo) + ';font-size:10px;font-weight:700;text-transform:uppercase">' + esc(e.tipo) + "</span>"
        + '<span style="flex:1;word-break:break-word">' + esc(e.mensaje) + "</span>"
        + "</div>"
        + (e.detalle ? '<div style="color:' + C.texto2 + ';font-size:10px;margin-top:2px;word-break:break-word;white-space:pre-wrap">' + esc(e.detalle) + "</div>" : "")
        + "</div>";
    }).join("");
  }

  function anotar(tipo, mensaje, detalle) {
    try {
      eventos.push({
        hora: hora(),
        tipo: String(tipo || "info"),
        mensaje: String(mensaje == null ? "" : mensaje),
        detalle: detalle == null ? "" : String(detalle)
      });
      if (eventos.length > MAX) eventos.shift();
      if (!abierto) { sinLeer++; actualizarInsignia(); }
      pintar();
    } catch (e) {
      // El escáner jamás puede romper la app.
    }
  }

  function textoPlano() {
    return eventos.map(function (e) {
      return e.hora + " [" + e.tipo + "] " + e.mensaje + (e.detalle ? " · " + e.detalle : "");
    }).join("\n");
  }

  function copiar() {
    var texto = textoPlano();
    try {
      if (window.FabrickNative && typeof window.FabrickNative.copiar === "function") {
        var r = JSON.parse(window.FabrickNative.copiar(texto) || "{}");
        anotar(r.ok ? "ok" : "fallo", "copiar al portapapeles", r.ok ? (r.mensaje || "copiado") : (r.error || "error"));
        return;
      }
    } catch (e) {
      anotar("fallo", "copiar con el puente", String(e));
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(texto);
        anotar("ok", "copiar al portapapeles", "navigator.clipboard");
        return;
      }
    } catch (e) {
      anotar("fallo", "copiar con navigator.clipboard", String(e));
    }
    anotar("aviso", "no se pudo copiar", "selecciona el texto a mano");
  }

  /** Resumen corto de una respuesta para no volcar JSON entero. */
  function resumen(d) {
    if (d == null) return "";
    if (typeof d !== "object") return String(d);
    var claves = Object.keys(d);
    if (claves.length > 8) claves = claves.slice(0, 8);
    return claves.map(function (k) {
      var v = d[k];
      if (v && typeof v === "object") {
        return k + "=" + (Array.isArray(v) ? "[" + v.length + "]" : "{…}");
      }
      var s = String(v);
      return k + "=" + (s.length > 40 ? s.slice(0, 40) + "…" : s);
    }).join(" · ");
  }

  function llamar(op, payload) {
    var t0 = Date.now();
    try {
      var crudo = window.FabrickNative.call(op, JSON.stringify(payload || {}));
      var ms = Date.now() - t0;
      if (!crudo) {
        anotar("fallo", op + " · " + ms + " ms", "respuesta vacía del puente");
        return null;
      }
      var r = JSON.parse(crudo);
      if (r && r.ok) {
        anotar("ok", op + " · " + ms + " ms", resumen(r.data));
      } else {
        anotar("fallo", op + " · " + ms + " ms",
          ((r && r.error) || "sin mensaje") + (r && r.codigo ? " [" + r.codigo + "]" : ""));
      }
      return r;
    } catch (e) {
      anotar("fallo", op + " lanzó una excepción", String((e && e.message) || e));
      return null;
    }
  }

  function probarTodo() {
    anotar("prueba", "— comprobación completa —", "");
    try {
      anotar("entorno", "origen: " + (location.origin || "(sin origen)") + " · protocolo: " + location.protocol, location.href);
      anotar("entorno", "user agent", navigator.userAgent);

      var puente = window.FabrickNative;
      if (!puente) {
        anotar("fallo", "el puente nativo NO existe", "window.FabrickNative = " + String(puente));
        return;
      }
      anotar("puente", "presente", "tipo: " + typeof puente);

      var esperados = [
        "call", "initNucleo", "huellaEstado", "huellaVerificarPin", "huellaConfigurarPin",
        "localEstado", "termuxEstado", "redDiagnostico", "apiNubeEstado",
        "descargasEstado", "runtimeInfo", "copiar"
      ];
      var faltan = esperados.filter(function (m) { return typeof puente[m] !== "function"; });
      anotar(faltan.length ? "aviso" : "ok", "métodos del puente",
        faltan.length ? "faltan: " + faltan.join(", ") : "los " + esperados.length + " esperados están");

      // localStorage: si falla, el inventario y la nube no persisten nada.
      try {
        localStorage.setItem("fabri.diag", "1");
        localStorage.removeItem("fabri.diag");
        anotar("ok", "localStorage", "escribe y borra");
      } catch (e) {
        anotar("fallo", "localStorage no disponible", String(e));
      }

      // Estado del acceso por el camino real del login.
      try {
        var h = JSON.parse(puente.huellaEstado() || "{}");
        anotar(h.ok ? "ok" : "fallo", "huellaEstado",
          h.ok ? ("pinConfigurado=" + h.pinConfigurado + " · huellaActiva=" + h.huellaActiva
            + " · disponible=" + h.huellaDisponible + " · sdk=" + h.sdk) : (h.error || "error"));
      } catch (e) {
        anotar("fallo", "huellaEstado lanzó", String(e));
      }

      // Operaciones del núcleo, una por una.
      llamar("ping");
      llamar("sys");
      llamar("perfil", { accion: "obtener" });
      llamar("usuarios", { accion: "listar" });
      llamar("usuarios", { accion: "resumen" });
      llamar("inventario", { accion: "listar", limite: 1 });
      llamar("revision.resumen");
      llamar("manifiestos");

      anotar("prueba", "— fin de la comprobación —", "");
    } catch (e) {
      anotar("fallo", "la propia comprobación falló", String((e && e.message) || e));
    }
  }

  // ------------------------------------------------------------- arranque
  //
  // Respaldo local: si `app.js` no se ejecutó (error de sintaxis, comilla mal
  // puesta, excepción temprana, recurso que no cargó), la pantalla se queda en
  // «Comprobando acceso…» y el usuario no tiene forma de saber por qué. Aquí
  // se detecta y se escribe el error exacto en la propia tarjeta de acceso.

  function primerError() {
    for (var i = 0; i < eventos.length; i++) {
      if (eventos[i].tipo === "error" || eventos[i].tipo === "fallo") return eventos[i];
    }
    return null;
  }

  function escribirEstadoLogin(texto, esError) {
    var el = document.getElementById("loginEstado");
    if (!el) return false;
    el.textContent = texto;
    el.className = "login-estado" + (esError ? " error" : " aviso");
    return true;
  }

  function vigilarArranque() {
    try {
      // La casilla del PIN existe en el HTML sin depender de nadie: si el panel
      // está oculto, es que algo lo ocultó y hay que volver a mostrarlo.
      var panel = document.getElementById("loginEntrar");
      var setup = document.getElementById("loginSetup");
      if (panel && panel.hidden && (!setup || setup.hidden)) panel.hidden = false;

      var vivo = typeof window.FabriLogin !== "undefined"
        && window.FabriLogin
        && typeof window.FabriLogin.iniciar === "function";

      if (!vivo) {
        var e = primerError();
        escribirEstadoLogin(
          "La interfaz no terminó de arrancar. Puedes escribir tu PIN igual; "
          + "si falla, abre DIAG (abajo a la derecha) y pulsa «Probar todo»."
          + (e ? " · Error: " + e.mensaje + (e.detalle ? " (" + e.detalle.split("\n")[0] + ")" : "") : ""),
          true);
        anotar("fallo", "arranque incompleto",
          "window.FabriLogin no está definido: app.js no llegó al final. "
          + "La casilla del PIN se muestra por el HTML, sin JavaScript.");
        return;
      }

      // app.js cargó pero el login no llegó a pintar su estado.
      var estadoEl = document.getElementById("loginEstado");
      if (estadoEl && /Comprobando acceso/i.test(estadoEl.textContent || "")) {
        var e2 = primerError();
        escribirEstadoLogin(
          "El acceso no terminó de comprobarse. Escribe tu PIN; si no responde, "
          + "usa «Restablecer acceso» o el escáner DIAG."
          + (e2 ? " · Error: " + e2.mensaje : ""),
          true);
        anotar("fallo", "el login no actualizó su estado",
          e2 ? (e2.mensaje + " · " + e2.detalle) : "sin error registrado");
      }
    } catch (e) {
      // El vigilante tampoco puede romper la pantalla.
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(vigilarArranque, 5000);
    });
  } else {
    setTimeout(vigilarArranque, 5000);
  }

  // ------------------------------------------------------------- captura

  window.addEventListener("error", function (ev) {
    var objetivo = ev && ev.target;
    if (objetivo && objetivo !== window && objetivo.tagName) {
      // Un recurso que no cargó (script, css, imagen): es la causa típica de
      // que la interfaz quede a medias sin decir nada.
      var url = objetivo.src || objetivo.href || "";
      anotar("error", "no se pudo cargar <" + String(objetivo.tagName).toLowerCase() + ">", url);
      return;
    }
    anotar("error",
      (ev && ev.message) || "error de JavaScript",
      ((ev && ev.filename) || "") + ":" + ((ev && ev.lineno) || 0) + ":" + ((ev && ev.colno) || 0)
        + (ev && ev.error && ev.error.stack ? "\n" + String(ev.error.stack).split("\n").slice(0, 4).join("\n") : ""));
  }, true);

  window.addEventListener("unhandledrejection", function (ev) {
    var r = ev && ev.reason;
    anotar("error", "promesa rechazada sin capturar",
      r && r.stack ? String(r.stack).split("\n").slice(0, 4).join("\n") : String(r));
  });

  var errorOriginal = console.error;
  console.error = function () {
    try {
      anotar("error", "console.error", Array.prototype.slice.call(arguments).map(function (a) {
        return (a && a.message) ? a.message : String(a);
      }).join(" "));
    } catch (e) { /* nada */ }
    if (errorOriginal) errorOriginal.apply(console, arguments);
  };

  // La interfaz pública, para la consola del teléfono y para las pruebas.
  window.FabriDiag = {
    abrir: function () { alternar(true); },
    cerrar: function () { alternar(false); },
    anotar: anotar,
    probar: probarTodo,
    arranque: vigilarArranque,
    texto: textoPlano,
    eventos: function () { return eventos.slice(); },
    // Último error legible, para que la pantalla de acceso pueda decir qué
    // pasó si app.js no llegó a cargar.
    get ultimo() {
      for (var i = eventos.length - 1; i >= 0; i--) {
        if (eventos[i].tipo === "error") {
          return eventos[i].hora + " · " + eventos[i].mensaje;
        }
      }
      return "";
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", crearBoton);
  } else {
    crearBoton();
  }
})();
