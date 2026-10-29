/* ==========================================================================
   FORGE CORE STOCK · Lector de códigos por red (HBAPO y compatibles)
   --------------------------------------------------------------------------
   Los lectores 2D de escritorio no comparten un protocolo. Este módulo cubre
   los tres caminos reales:

   1. Servidor TCP: la app abre el puerto 9101 y el lector se configura para
      apuntar a la IP del teléfono. Es el modo recomendado.
   2. Cliente TCP: la app se conecta a la IP:puerto del lector.
   3. HID: el lector se comporta como teclado USB/Bluetooth y "escribe" el
      código. Se detecta por la velocidad de las teclas, no por el foco.

   El motor nativo (LectorRed.java) hace el trabajo de red y avisa por
   `FabriLector.linea(...)`. Aquí sólo se decide qué hacer con el código.
   ========================================================================== */

(function () {
  "use strict";

  var CLAVES = {
    modo: "fabrick.lector.modo",
    host: "fabrick.lector.host",
    puerto: "fabrick.lector.puerto",
    accion: "fabrick.lector.accion"
  };

  var ESTADO = {
    activo: false,
    modo: "servidor",
    timer: null,
    ultimaLectura: "",
    ultimaVez: 0,
    hidBuffer: "",
    hidUltimaTecla: 0,
    hidTimer: null,
    historial: []
  };

  /* ── almacenamiento ───────────────────────────────────────────────────── */

  function leer(clave, respaldo) {
    try {
      var v = localStorage.getItem(clave);
      return v == null || v === "" ? respaldo : v;
    } catch (e) {
      return respaldo;
    }
  }

  function guardar(clave, valor) {
    try { localStorage.setItem(clave, String(valor)); } catch (e) {}
  }

  function config() {
    var modo = leer(CLAVES.modo, "servidor");
    if (["servidor", "cliente", "hid"].indexOf(modo) < 0) modo = "servidor";
    return {
      modo: modo,
      host: leer(CLAVES.host, ""),
      puerto: Number(leer(CLAVES.puerto, "9101")) || 9101,
      accion: leer(CLAVES.accion, "buscar") === "apilador" ? "apilador" : "buscar"
    };
  }

  /* ── puente nativo ────────────────────────────────────────────────────── */

  function nativo(metodo, args) {
    try {
      if (!window.FabrickNative || typeof window.FabrickNative[metodo] !== "function") {
        return { ok: false, error: "el puente nativo no está disponible" };
      }
      var crudo = window.FabrickNative[metodo].apply(window.FabrickNative, args || []);
      if (!crudo) return { ok: false, error: "respuesta vacía del puente" };
      return JSON.parse(crudo);
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  }

  function aviso(texto, tipo) {
    if (typeof window.toast === "function") window.toast(texto, tipo || "");
    else if (typeof window.invAviso === "function") window.invAviso(texto, tipo);
  }

  function $(id) {
    return typeof document === "undefined" ? null : document.getElementById(id);
  }

  /* ── interfaz ─────────────────────────────────────────────────────────── */

  function pintarConfig() {
    var cfg = config();
    if ($("invLectorModo")) $("invLectorModo").value = cfg.modo;
    if ($("invLectorHost")) $("invLectorHost").value = cfg.host;
    if ($("invLectorPuerto")) $("invLectorPuerto").value = cfg.puerto;
    if ($("invLectorAccion")) $("invLectorAccion").value = cfg.accion;
    var host = $("invLectorHost");
    if (host) {
      host.disabled = cfg.modo !== "cliente";
      var campoHost = host.closest ? host.closest(".campo") : null;
      if (campoHost) campoHost.style.opacity = cfg.modo === "cliente" ? "1" : "0.45";
    }
    var puerto = $("invLectorPuerto");
    if (puerto) puerto.disabled = cfg.modo === "hid";
    pintarChip();
  }

  function pintarChip() {
    var chip = $("invEquipoLectorChip");
    var texto = $("invEquipoLector");
    var cfg = config();
    if (!chip) return;
    if (ESTADO.activo) {
      chip.textContent = "activo";
      chip.className = "inv-chip lima";
      if (texto) {
        texto.textContent = cfg.modo === "hid"
          ? "teclado listo"
          : (cfg.modo === "servidor" ? "escuchando :" + cfg.puerto : cfg.host + ":" + cfg.puerto);
      }
    } else {
      chip.textContent = "—";
      chip.className = "inv-chip";
      if (texto) texto.textContent = cfg.modo === "hid" ? "teclado sin activar" : "apagado";
    }
  }

  function estadoTexto(t) {
    var caja = $("invLectorEstado");
    if (caja) caja.textContent = t;
  }

  function pintarIp(ip) {
    var caja = $("invLectorIp");
    if (caja) {
      caja.textContent = ip
        ? "IP del teléfono: " + ip + " · configurá esa IP y el puerto en el lector."
        : "IP del teléfono: sin WiFi. Conectate a la misma red que el lector.";
    }
    var chip = $("invEquiposIp");
    if (chip) {
      chip.textContent = ip ? "IP " + ip : "IP —";
      chip.className = "inv-chip" + (ip ? " lima" : "");
    }
  }

  function pintarHistorial() {
    var caja = $("invLectorUltimos");
    if (!caja) return;
    if (!ESTADO.historial.length) {
      caja.innerHTML = "";
      return;
    }
    caja.innerHTML = ESTADO.historial.map(function (h) {
      return '<div class="inv-lector-linea"><span>' + esc(h.codigo) + "</span><span>"
        + esc(h.origen) + " · " + h.hora + "</span></div>";
    }).join("");
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function hora() {
    var d = new Date();
    function dos(n) { return n < 10 ? "0" + n : String(n); }
    return dos(d.getHours()) + ":" + dos(d.getMinutes()) + ":" + dos(d.getSeconds());
  }

  /* ── qué hacer con un código ──────────────────────────────────────────── */

  /**
   * Punto único de entrada: red, HID o prueba manual. Deduplica lecturas
   * repetidas del mismo código en menos de 1,2 s (el lector puede mandar el
   * código dos veces si el gatillo rebota).
   */
  function procesar(codigoCrudo, origen) {
    var codigo = String(codigoCrudo == null ? "" : codigoCrudo)
      .replace(/[\u0000-\u001F\u007F]/g, "").trim();
    if (!codigo) return { ok: false, error: "código vacío" };
    var ahora = Date.now();
    if (codigo === ESTADO.ultimaLectura && ahora - ESTADO.ultimaVez < 1200) {
      return { ok: true, duplicado: true, codigo: codigo };
    }
    ESTADO.ultimaLectura = codigo;
    ESTADO.ultimaVez = ahora;
    ESTADO.historial.unshift({ codigo: codigo, origen: origen || "red", hora: hora() });
    ESTADO.historial = ESTADO.historial.slice(0, 6);
    pintarHistorial();

    try { if (typeof window.sonidoBeep === "function") window.sonidoBeep(1180, 0.05); } catch (e) {}
    try { if (navigator.vibrate) navigator.vibrate(28); } catch (e) {}

    var cfg = config();
    var campo = $("invCodigo");
    if (campo) campo.value = codigo;

    if (cfg.accion === "apilador" && typeof window.invApiladorAgregar === "function") {
      if (window.INV) window.INV.modoApilador = true;
      var caja = $("invApiladorCaja");
      if (caja) caja.hidden = false;
      window.invApiladorAgregar(codigo);
      aviso("Sumado al apilador: " + codigo);
      return { ok: true, codigo: codigo, accion: "apilador" };
    }

    aviso("Código leído: " + codigo);
    if (typeof window.invBuscarCodigo === "function") {
      window.invBuscarCodigo(codigo);
    }
    return { ok: true, codigo: codigo, accion: "buscar" };
  }

  /** Callback que llama el motor nativo desde el hilo de red. */
  function linea(ev) {
    if (!ev || !ev.codigo) return;
    var origen = ev.origen === "cliente" ? "lector " + (ev.ip || "") : "red " + (ev.ip || "");
    procesar(ev.codigo, origen);
    estadoTexto("Última lectura: " + ev.codigo + " · " + hora());
  }

  /* ── HID: teclado USB / Bluetooth ─────────────────────────────────────── */

  function esCampo(el) {
    if (!el) return false;
    var t = (el.tagName || "").toUpperCase();
    return t === "INPUT" || t === "TEXTAREA" || t === "SELECT" || el.isContentEditable;
  }

  function flushHid() {
    if (ESTADO.hidTimer) {
      clearTimeout(ESTADO.hidTimer);
      ESTADO.hidTimer = null;
    }
    var codigo = ESTADO.hidBuffer;
    ESTADO.hidBuffer = "";
    if (codigo.length >= 3) procesar(codigo, "teclado USB");
  }

  function alTeclear(e) {
    if (!ESTADO.activo || config().modo !== "hid") return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    var activo = document.activeElement;
    // Si el usuario está escribiendo en un campo, no se le secuestra el
    // teclado. En `invCodigo` el Enter ya dispara la búsqueda normal.
    if (esCampo(activo)) return;

    var ahora = Date.now();
    if (ahora - ESTADO.hidUltimaTecla > 140) ESTADO.hidBuffer = "";
    ESTADO.hidUltimaTecla = ahora;

    if (e.key === "Enter" || e.key === "Tab") {
      if (ESTADO.hidBuffer.length >= 3) {
        e.preventDefault();
        flushHid();
      }
      return;
    }
    if (e.key && e.key.length === 1) {
      ESTADO.hidBuffer += e.key;
      if (ESTADO.hidTimer) clearTimeout(ESTADO.hidTimer);
      // Los lectores mandan Enter; este respaldo cubre a los que no.
      ESTADO.hidTimer = setTimeout(function () {
        if (ESTADO.hidBuffer.length >= 6) flushHid();
        else ESTADO.hidBuffer = "";
      }, 260);
    }
  }

  /* ── encendido / apagado ──────────────────────────────────────────────── */

  /** La UI manda: si hay campos en pantalla, eso es lo que se enciende. */
  function leerCampos() {
    var modo = ($("invLectorModo") || {}).value;
    if (["servidor", "cliente", "hid"].indexOf(modo) >= 0) guardar(CLAVES.modo, modo);
    var host = ($("invLectorHost") || {}).value;
    if (host != null) guardar(CLAVES.host, String(host).trim());
    var puerto = Number(($("invLectorPuerto") || {}).value);
    if (puerto >= 1 && puerto <= 65535) guardar(CLAVES.puerto, puerto);
    var accion = ($("invLectorAccion") || {}).value;
    if (accion === "buscar" || accion === "apilador") guardar(CLAVES.accion, accion);
  }

  function iniciar() {
    leerCampos();
    var cfg = config();
    guardar(CLAVES.modo, cfg.modo);
    guardar(CLAVES.host, cfg.host);
    guardar(CLAVES.puerto, cfg.puerto);
    guardar(CLAVES.accion, cfg.accion);

    if (cfg.modo === "hid") {
      ESTADO.activo = true;
      ESTADO.modo = "hid";
      pintarChip();
      estadoTexto("Teclado activo: apuntá el lector y dispará. No escribas en un campo.");
      aviso("Lector USB/Bluetooth activo");
      return { ok: true, modo: "hid" };
    }

    if (cfg.modo === "cliente" && !cfg.host) {
      aviso("Escribí la IP del lector para conectarte", "error");
      estadoTexto("Falta la IP del lector.");
      return { ok: false, error: "falta la IP del lector" };
    }

    estadoTexto(cfg.modo === "servidor"
      ? "Abriendo el puerto " + cfg.puerto + "…"
      : "Conectando a " + cfg.host + ":" + cfg.puerto + "…");

    var r = nativo("lectorIniciar", [cfg.modo, cfg.host, cfg.puerto]);
    if (!r || !r.ok) {
      var msg = (r && r.error) || "no se pudo encender el lector";
      estadoTexto("No se pudo encender: " + msg);
      aviso("Lector: " + msg, "error");
      return r || { ok: false, error: msg };
    }

    ESTADO.activo = true;
    ESTADO.modo = cfg.modo;
    pintarIp(r.ip_local || "");
    pintarChip();
    estadoTexto(r.instruccion || (cfg.modo === "servidor"
      ? "Escuchando en el puerto " + cfg.puerto + "."
      : "Conectado a " + cfg.host + ":" + cfg.puerto + "."));
    aviso(cfg.modo === "servidor"
      ? "Lector escuchando en " + (r.ip_local || "la IP del teléfono") + ":" + cfg.puerto
      : "Lector conectado a " + cfg.host + ":" + cfg.puerto);
    try {
      if (typeof window.revision === "function") {
        window.revision("inventario", "info", "lector de red encendido",
          cfg.modo + " · " + (cfg.modo === "servidor" ? ":" + cfg.puerto : cfg.host + ":" + cfg.puerto));
      }
    } catch (e) {}

    if (ESTADO.timer) clearInterval(ESTADO.timer);
    ESTADO.timer = setInterval(actualizarEstado, 5000);
    return r;
  }

  function detener() {
    var r = nativo("lectorDetener", ["todo"]);
    ESTADO.activo = false;
    if (ESTADO.timer) {
      clearInterval(ESTADO.timer);
      ESTADO.timer = null;
    }
    if (ESTADO.hidTimer) {
      clearTimeout(ESTADO.hidTimer);
      ESTADO.hidTimer = null;
    }
    ESTADO.hidBuffer = "";
    pintarChip();
    estadoTexto("Apagado.");
    aviso("Lector apagado");
    return r || { ok: true };
  }

  function actualizarEstado() {
    var r = nativo("lectorEstado", []);
    if (!r || !r.ok) return r;
    pintarIp(r.ip_local || "");
    var activo = !!(r.servidor_activo || r.cliente_activo) || (ESTADO.activo && config().modo === "hid");
    if (activo !== ESTADO.activo) {
      ESTADO.activo = activo;
      pintarChip();
    }
    if (r.servidor_activo) {
      estadoTexto("Escuchando en " + (r.ip_local || "la IP del teléfono") + ":" + r.servidor_puerto
        + " · " + (r.lineas || 0) + " lectura(s).");
    } else if (r.cliente_activo) {
      estadoTexto("Conectado a " + r.cliente_host + ":" + r.cliente_puerto
        + " · " + (r.lineas || 0) + " lectura(s).");
    } else if (!ESTADO.activo) {
      estadoTexto("Apagado.");
    }
    return r;
  }

  function probarCodigo() {
    return procesar("7801234567890", "prueba");
  }

  /* ── arranque ─────────────────────────────────────────────────────────── */

  function iniciarUi() {
    pintarConfig();
    var cfg = config();

    if ($("invLectorModo")) $("invLectorModo").addEventListener("change", function () {
      guardar(CLAVES.modo, this.value);
      pintarConfig();
      if (ESTADO.activo) {
        detener();
        estadoTexto("Modo cambiado: encendé el lector otra vez.");
      }
    });
    if ($("invLectorHost")) $("invLectorHost").addEventListener("change", function () {
      guardar(CLAVES.host, this.value.trim());
    });
    if ($("invLectorPuerto")) $("invLectorPuerto").addEventListener("change", function () {
      var p = Number(this.value) || 9101;
      if (p < 1 || p > 65535) { aviso("Puerto inválido", "error"); this.value = 9101; p = 9101; }
      guardar(CLAVES.puerto, p);
    });
    if ($("invLectorAccion")) $("invLectorAccion").addEventListener("change", function () {
      guardar(CLAVES.accion, this.value);
    });
    if ($("btnInvLectorIniciar")) $("btnInvLectorIniciar").addEventListener("click", iniciar);
    if ($("btnInvLectorDetener")) $("btnInvLectorDetener").addEventListener("click", detener);

    document.addEventListener("keydown", alTeclear, true);

    // Si el servicio quedó encendido de una sesión anterior, se refleja.
    var r = nativo("lectorEstado", []);
    if (r && r.ok) {
      pintarIp(r.ip_local || "");
      if (r.servidor_activo || r.cliente_activo) {
        ESTADO.activo = true;
        pintarChip();
        estadoTexto(r.servidor_activo
          ? "Escuchando en el puerto " + r.servidor_puerto + "."
          : "Conectado a " + r.cliente_host + ":" + r.cliente_puerto + ".");
        ESTADO.timer = setInterval(actualizarEstado, 5000);
      }
    }
    if (cfg.modo === "hid" && !ESTADO.activo) {
      // El HID no ocupa red: se puede dejar armado desde el arranque.
      ESTADO.activo = true;
      ESTADO.modo = "hid";
      pintarChip();
      estadoTexto("Teclado listo. Apuntá el lector y dispará.");
    }
  }

  window.FabriLector = {
    config: config,
    iniciar: iniciar,
    detener: detener,
    estado: actualizarEstado,
    linea: linea,
    procesar: procesar,
    probar: probarCodigo,
    iniciarUi: iniciarUi,
    _estado: ESTADO
  };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", iniciarUi);
    } else {
      iniciarUi();
    }
  }
})();
