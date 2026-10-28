/* ==========================================================================
   FABRI-CORE · Impresora térmica WiFi (ESC/POS)
   --------------------------------------------------------------------------
   La Xprinter XP-58LLH y casi todas las térmicas con WiFi escuchan en el
   puerto 9100 y entienden ESC/POS crudo. Este módulo arma el ticket en bytes
   (sin diálogo de Android) y lo manda por el puente nativo.

   Reglas:
   - 58 mm = 384 puntos = 32 caracteres con Font A.
   - 80 mm = 576 puntos = 48 caracteres con Font A.
   - Los acentos van en Windows-1252 (ESC t 16). Si la impresora los imprime
     mal, se puede elegir «solo ASCII» y se transliteran.
   - Nada se envía si no hay IP configurada: el usuario ve el error real.
   ========================================================================== */

(function () {
  "use strict";

  var ANCHOS = { "58mm": 32, "80mm": 48 };

  /* Windows-1252: los 27 caracteres que no están en Latin-1. */
  var CP1252 = {
    "\u20AC": 0x80, "\u201A": 0x82, "\u0192": 0x83, "\u201E": 0x84,
    "\u2026": 0x85, "\u2020": 0x86, "\u2021": 0x87, "\u02C6": 0x88,
    "\u2030": 0x89, "\u0160": 0x8A, "\u2039": 0x8B, "\u0152": 0x8C,
    "\u017D": 0x8E, "\u2018": 0x91, "\u2019": 0x92, "\u201C": 0x93,
    "\u201D": 0x94, "\u2022": 0x95, "\u2013": 0x96, "\u2014": 0x97,
    "\u02DC": 0x98, "\u2122": 0x99, "\u0161": 0x9A, "\u203A": 0x9B,
    "\u0153": 0x9C, "\u017E": 0x9E, "\u0178": 0x9F
  };

  /** Texto → bytes. Con `ascii` se quitan tildes y símbolos raros. */
  function bytesTexto(texto, ascii) {
    var s = String(texto == null ? "" : texto);
    var salida = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      var codigo = s.charCodeAt(i);
      if (codigo === 10) { salida.push(0x0A); continue; }
      if (codigo === 13) { continue; }
      if (ascii) {
        var plano = c.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (plano === "\u00B0") plano = "o";
        if (plano === "\u00BF") plano = "?";
        if (plano === "\u00A1") plano = "!";
        if (plano === "\u20AC") plano = "EUR";
        var pc = plano.charCodeAt(0);
        salida.push(pc >= 0x20 && pc <= 0x7E ? pc : 0x3F);
        continue;
      }
      if (codigo >= 0x20 && codigo <= 0x7E) {
        salida.push(codigo);
      } else if (codigo >= 0xA0 && codigo <= 0xFF) {
        salida.push(codigo);
      } else if (CP1252[c] != null) {
        salida.push(CP1252[c]);
      } else {
        // Fuera de Windows-1252: se intenta sin tilde y, si no, «?».
        var base = c.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        var bc = base.charCodeAt(0);
        salida.push(bc >= 0x20 && bc <= 0x7E ? bc : 0x3F);
      }
    }
    return salida;
  }

  function repetir(c, n) {
    var s = "";
    for (var i = 0; i < n; i++) s += c;
    return s;
  }

  function partirLarga(palabra, ancho) {
    var trozos = [];
    while (palabra.length > ancho) {
      trozos.push(palabra.slice(0, ancho));
      palabra = palabra.slice(ancho);
    }
    if (palabra) trozos.push(palabra);
    return trozos;
  }

  /** Ajusta un texto al ancho, respetando palabras y saltos de línea. */
  function envolver(texto, ancho) {
    var salida = [];
    var lineas = String(texto == null ? "" : texto).split(/\r?\n/);
    lineas.forEach(function (linea) {
      if (!linea) { salida.push(""); return; }
      var palabras = linea.split(/\s+/);
      var actual = "";
      palabras.forEach(function (p) {
        if (!p) return;
        var trozos = p.length > ancho ? partirLarga(p, ancho) : [p];
        trozos.forEach(function (t) {
          if (!actual) {
            actual = t;
          } else if ((actual + " " + t).length <= ancho) {
            actual += " " + t;
          } else {
            salida.push(actual);
            actual = t;
          }
        });
      });
      if (actual) salida.push(actual);
    });
    return salida.length ? salida : [""];
  }

  function centrar(texto, ancho) {
    return envolver(texto, ancho).map(function (l) {
      var hueco = Math.max(0, ancho - l.length);
      var izq = Math.floor(hueco / 2);
      return repetir(" ", izq) + l;
    });
  }

  function clp(n) {
    var v = Math.round(Number(n) || 0);
    try {
      return "$" + v.toLocaleString("es-CL");
    } catch (e) {
      return "$" + String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    }
  }

  /* ── constructor de bytes ─────────────────────────────────────────────── */

  function Ticket(ancho, opciones) {
    this.ancho = ancho || 32;
    this.opciones = opciones || {};
    this.partes = [];
  }

  Ticket.prototype.raw = function (bytes) {
    for (var i = 0; i < bytes.length; i++) {
      this.partes.push(bytes[i] & 0xFF);
    }
    return this;
  };

  Ticket.prototype.cmd = function () {
    return this.raw(Array.prototype.slice.call(arguments));
  };

  Ticket.prototype.texto = function (s) {
    return this.raw(bytesTexto(s, this.opciones.ascii));
  };

  Ticket.prototype.linea = function (s) {
    this.texto(s == null ? "" : s);
    this.partes.push(0x0A);
    return this;
  };

  Ticket.prototype.lineas = function (lista) {
    var self = this;
    (lista || []).forEach(function (l) { self.linea(l); });
    return this;
  };

  Ticket.prototype.centrado = function (s) {
    var self = this;
    centrar(s, this.ancho).forEach(function (l) { self.linea(l); });
    return this;
  };

  Ticket.prototype.separador = function (c) {
    return this.linea(repetir(c || "-", this.ancho));
  };

  Ticket.prototype.alinear = function (n) {
    return this.cmd(0x1B, 0x61, n);
  };

  Ticket.prototype.negrita = function (on) {
    return this.cmd(0x1B, 0x45, on ? 1 : 0);
  };

  Ticket.prototype.tamano = function (ancho, alto) {
    var a = Math.max(1, Math.min(8, ancho || 1));
    var h = Math.max(1, Math.min(8, alto || 1));
    return this.cmd(0x1D, 0x21, ((a - 1) << 4) | (h - 1));
  };

  Ticket.prototype.reset = function () {
    return this.cmd(0x1B, 0x61, 0).cmd(0x1B, 0x45, 0).cmd(0x1D, 0x21, 0);
  };

  /**
   * Fila de dos columnas. Si no cabe, la izquierda se envuelve y el valor
   * queda alineado a la derecha en la última línea.
   */
  Ticket.prototype.fila = function (izq, der) {
    var a = String(izq == null ? "" : izq);
    var b = String(der == null ? "" : der);
    var ancho = this.ancho;
    if (!b) { return this.linea(a); }
    if (!a) {
      return this.linea(repetir(" ", Math.max(0, ancho - b.length)) + b);
    }
    if (a.length + 1 + b.length <= ancho) {
      return this.linea(a + repetir(" ", ancho - a.length - b.length) + b);
    }
    var disponible = Math.max(6, ancho - b.length - 1);
    var lineas = envolver(a, disponible);
    var self = this;
    lineas.forEach(function (l, i) {
      if (i === lineas.length - 1) {
        self.linea(l + repetir(" ", Math.max(1, ancho - l.length - b.length)) + b);
      } else {
        self.linea(l);
      }
    });
    return this;
  };

  Ticket.prototype.barras = function (dato, alto) {
    var limpio = String(dato == null ? "" : dato).replace(/[^\x20-\x7E]/g, "").slice(0, 60);
    if (!limpio) return this;
    var n = limpio.length + 2;
    // GS h (alto), GS w (módulo), GS H 2 (texto abajo), GS k 73 (CODE128-B)
    this.cmd(0x1D, 0x68, alto || 60);
    this.cmd(0x1D, 0x77, 2);
    this.cmd(0x1D, 0x48, 2);
    this.cmd(0x1D, 0x6B, 0x49, n, 0x7B, 0x42);
    this.raw(bytesTexto(limpio, true));
    this.cmd(0x0A);
    return this;
  };

  Ticket.prototype.bytes = function () {
    return this.partes.slice();
  };

  /* ── ticket de boleta ─────────────────────────────────────────────────── */

  function fechaCorta(b) {
    var ts = Number(b.fecha || b.ts || Math.floor(Date.now() / 1000));
    var d = new Date(ts * 1000);
    function dos(n) { return n < 10 ? "0" + n : String(n); }
    return dos(d.getDate()) + "/" + dos(d.getMonth() + 1) + "/" + d.getFullYear()
      + " " + dos(d.getHours()) + ":" + dos(d.getMinutes());
  }

  function normalizarNegocio(n) {
    var x = n || {};
    return {
      nombre: x.nombre || "FABRI-CORE",
      razon: x.razon || "",
      rut: x.rut || "",
      giro: x.giro || "",
      direccion: x.direccion || "",
      telefono: x.telefono || "",
      email: x.email || ""
    };
  }

  /**
   * Arma el ticket completo. `opciones`:
   *   ancho: 32 (58 mm) o 48 (80 mm)
   *   ascii: true para transliterar acentos
   *   corte: true para GS V (corte parcial)
   *   copia: "CLIENTE" | "CAJA" | "" (etiqueta extra)
   */
  function ticketBoleta(boleta, negocio, opciones) {
    var o = opciones || {};
    var ancho = o.ancho || ANCHOS[o.formato] || 32;
    var n = normalizarNegocio(negocio);
    var t = new Ticket(ancho, o);

    t.cmd(0x1B, 0x40);            // ESC @ inicializa
    t.cmd(0x1B, 0x74, o.codepage == null ? 16 : o.codepage); // WPC1252
    t.alinear(1);

    // Cabecera: nombre del negocio en altura doble; ancho doble sólo si cabe.
    t.negrita(true);
    if (n.nombre.length <= Math.floor(ancho / 2)) {
      t.tamano(2, 2);
      t.centrado(n.nombre);
      t.tamano(1, 1);
    } else {
      t.tamano(1, 2);
      t.centrado(n.nombre);
      t.tamano(1, 1);
    }
    t.negrita(false);

    var datos = [
      n.razon && n.razon !== n.nombre ? n.razon : "",
      n.rut ? "RUT " + n.rut : "",
      n.giro || "",
      n.direccion || "",
      n.telefono ? "Tel. " + n.telefono : "",
      n.email || ""
    ].filter(Boolean);
    datos.forEach(function (d) { t.centrado(d); });

    t.alinear(0);
    t.separador("-");

    t.negrita(true);
    t.fila("BOLETA", "N\u00B0 " + (boleta.folio == null ? "-" : boleta.folio));
    t.negrita(false);
    t.fila(fechaCorta(boleta), String(boleta.pago || "efectivo").toUpperCase());
    t.fila(boleta.cliente || "Consumidor final", boleta.rut || "");
    if (o.copia) {
      t.centrado("*** " + o.copia + " ***");
    }
    t.separador("-");

    t.negrita(true);
    t.fila("DETALLE", "SUBTOTAL");
    t.negrita(false);

    var items = boleta.items || [];
    var total = Number(boleta.total || 0);
    if (!items.length) {
      t.linea("Sin productos");
    }
    items.forEach(function (x) {
      var cant = Number(x.cantidad || 1);
      var precio = Number(x.precio || 0);
      t.negrita(true);
      envolver(x.nombre || x.codigo || "Producto", ancho).forEach(function (l) {
        t.linea(l);
      });
      t.negrita(false);
      t.fila("  " + cant + " x " + clp(precio), clp(precio * cant));
    });

    var neto = boleta.neto != null ? Number(boleta.neto) : total / 1.19;
    var iva = boleta.iva != null ? Number(boleta.iva) : total - neto;
    t.separador("-");
    t.fila("NETO", clp(neto));
    t.fila("IVA 19%", clp(iva));
    t.negrita(true);
    t.tamano(1, 2);
    t.fila("TOTAL", clp(total));
    t.tamano(1, 1);
    t.negrita(false);
    t.separador("-");

    if (!o.vista && boleta.folio != null) {
      t.alinear(1);
      t.barras(boleta.folio, 64);
      t.alinear(0);
      t.centrado("Folio " + boleta.folio);
    }

    t.alinear(1);
    t.negrita(true);
    t.linea("\u00A1GRACIAS POR SU COMPRA!");
    t.negrita(false);
    t.linea("Documento generado por FABRI-CORE");
    t.linea("no es boleta tributaria electronica");

    t.cmd(0x1B, 0x64, 3);          // avanza 3 líneas
    if (o.corte !== false) {
      t.cmd(0x1D, 0x56, 0x42, 0x00); // GS V 66 0: corte parcial con avance
    }
    return t.bytes();
  }

  /** Ticket de prueba para verificar la conexión sin emitir una boleta. */
  function ticketPrueba(negocio, opciones) {
    var n = normalizarNegocio(negocio);
    return ticketBoleta({
      folio: "PRUEBA",
      fecha: Math.floor(Date.now() / 1000),
      cliente: "Ticket de prueba",
      pago: "efectivo",
      items: [
        { nombre: "Impresora WiFi", cantidad: 1, precio: 0 },
        { nombre: "Conexion ESC/POS", cantidad: 1, precio: 0 }
      ],
      neto: 0,
      iva: 0,
      total: 0
    }, n, Object.assign({}, opciones, { vista: true, corte: true }));
  }

  function base64(bytes) {
    var bin = "";
    var bloque = 0x8000;
    for (var i = 0; i < bytes.length; i += bloque) {
      bin += String.fromCharCode.apply(null, bytes.slice(i, i + bloque));
    }
    try {
      return btoa(bin);
    } catch (e) {
      return "";
    }
  }

  /* ── configuración ────────────────────────────────────────────────────── */

  var CLAVES = {
    host: "fabrick.impresora.host",
    puerto: "fabrick.impresora.puerto",
    ancho: "fabrick.impresora.ancho",
    corte: "fabrick.impresora.corte",
    destino: "fabrick.impresora.destino",
    codepage: "fabrick.impresora.codepage"
  };

  function leer(clave, respaldo) {
    try {
      var v = localStorage.getItem(clave);
      return v == null || v === "" ? respaldo : v;
    } catch (e) {
      return respaldo;
    }
  }

  function guardar(clave, valor) {
    try {
      localStorage.setItem(clave, String(valor));
    } catch (e) {
      // sin almacenamiento: se usa sólo en memoria.
    }
  }

  function config() {
    var formato = leer(CLAVES.ancho, "58mm");
    return {
      host: leer(CLAVES.host, ""),
      puerto: Number(leer(CLAVES.puerto, "9100")) || 9100,
      formato: formato,
      ancho: ANCHOS[formato] || 32,
      corte: leer(CLAVES.corte, "1") === "1",
      destino: leer(CLAVES.destino, "wifi"),
      codepage: Number(leer(CLAVES.codepage, "16"))
    };
  }

  function configurada() {
    return !!config().host;
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
    if (typeof window.toast === "function") {
      window.toast(texto, tipo || "");
    } else if (typeof window.invAviso === "function") {
      window.invAviso(texto, tipo);
    }
  }

  function registrar(tipo, mensaje, detalle) {
    try {
      if (typeof window.revision === "function") {
        window.revision("inventario", tipo, mensaje, detalle || "", 0, "impresora");
      }
    } catch (e) {
      // sin más.
    }
  }

  /**
   * Manda bytes ESC/POS ya armados. Centraliza el base64, el puente y los
   * avisos para que la boleta y el ticket de prueba usen el mismo camino.
   */
  function enviarBytes(bytes, etiqueta, opciones) {
    var o = opciones || {};
    var cfg = config();
    if (!cfg.host) {
      return { ok: false, error: "configurá la IP de la impresora WiFi" };
    }
    var b64 = base64(bytes);
    if (!b64) {
      return { ok: false, error: "no se pudo codificar el ticket" };
    }
    if (!o.silencioso) aviso("Enviando ticket a " + cfg.host + ":" + cfg.puerto + "…");
    var r = nativo("imprimirWifi", [cfg.host, cfg.puerto, b64, o.timeoutMs || 6000]);
    if (r && r.ok) {
      if (!o.silencioso) aviso("Ticket enviado · " + r.bytes + " bytes · " + r.ms + " ms");
      registrar("info", "ticket WiFi enviado",
        (etiqueta || "prueba") + " · " + cfg.host + ":" + cfg.puerto + " · " + r.bytes + " B");
    } else {
      var msg = (r && r.error) || "no se pudo imprimir";
      if (!o.silencioso) aviso("Impresora WiFi: " + msg, "error");
      registrar("error", "falló la impresión WiFi", msg + " · " + cfg.host + ":" + cfg.puerto);
    }
    return r;
  }

  /**
   * Imprime una boleta por WiFi. Devuelve el resultado del puente.
   * `boleta` es el objeto que devuelve `boleta_crear` (o el pseudo-carrito).
   */
  function imprimir(boleta, opciones) {
    var o = opciones || {};
    var cfg = config();
    if (!cfg.host) {
      return { ok: false, error: "configurá la IP de la impresora WiFi" };
    }
    var bytes = ticketBoleta(boleta, o.negocio || {}, {
      ancho: o.ancho || cfg.ancho,
      ascii: o.ascii || cfg.codepage === 0,
      codepage: o.codepage == null ? cfg.codepage : o.codepage,
      corte: o.corte == null ? cfg.corte : o.corte,
      vista: o.vista,
      copia: o.copia
    });
    return enviarBytes(bytes, boleta.folio == null ? "prueba" : "folio " + boleta.folio, o);
  }

  function probar(host, puerto) {
    var cfg = config();
    return nativo("probarImpresora", [
      host || cfg.host,
      Number(puerto || cfg.puerto) || 9100,
      4000
    ]);
  }

  function buscar() {
    return nativo("buscarImpresoras", [260]);
  }

  /**
   * Ticket de prueba: arma los bytes con el mismo codificador y los manda
   * por el mismo camino que una boleta (`enviarBytes`), sin pasar por
   * `imprimir` (que espera una boleta y volvería a codificar).
   */
  function imprimirPrueba(negocio) {
    var cfg = config();
    var bytes = ticketPrueba(negocio || {}, {
      ancho: cfg.ancho,
      ascii: cfg.codepage === 0,
      codepage: cfg.codepage,
      corte: cfg.corte
    });
    return enviarBytes(bytes, "prueba");
  }

  /* ── interfaz ─────────────────────────────────────────────────────────── */

  function $(id) {
    return typeof document === "undefined" ? null : document.getElementById(id);
  }

  function pintarEstado() {
    var cfg = config();
    // Tarjeta «Equipos del local»: texto y chip.
    var texto = $("invEquipoImpresora");
    var chip = $("invEquipoImpresoraChip");
    if (texto) {
      texto.textContent = cfg.host
        ? cfg.host + ":" + cfg.puerto + " · " + cfg.formato
        : "sin configurar";
    }
    if (chip) {
      if (cfg.host && cfg.destino === "wifi") {
        chip.textContent = "WiFi";
        chip.className = "inv-chip lima";
      } else if (cfg.host) {
        chip.textContent = "sistema";
        chip.className = "inv-chip";
      } else {
        chip.textContent = "—";
        chip.className = "inv-chip";
      }
    }
    var destino = $("invImpDestino");
    if (destino) destino.value = cfg.destino;
  }

  function volcarCampos() {
    var cfg = config();
    if ($("invImpHost")) $("invImpHost").value = cfg.host;
    if ($("invImpPuerto")) $("invImpPuerto").value = cfg.puerto;
    if ($("invImpAncho")) $("invImpAncho").value = cfg.formato;
    if ($("invImpCorte")) $("invImpCorte").value = cfg.corte ? "1" : "0";
    if ($("invImpCodepage")) $("invImpCodepage").value = String(cfg.codepage);
    if ($("invImpDestino")) $("invImpDestino").value = cfg.destino;
    pintarEstado();
  }

  function guardarCampos() {
    var host = ($("invImpHost") || {}).value || "";
    var puerto = Number(($("invImpPuerto") || {}).value || 9100);
    var ancho = ($("invImpAncho") || {}).value || "58mm";
    var corte = ($("invImpCorte") || {}).value || "1";
    var codepage = ($("invImpCodepage") || {}).value || "16";
    var destino = ($("invImpDestino") || {}).value || "wifi";
    host = String(host).trim();
    if (host && !/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && host.indexOf(".") < 0 && host.indexOf(".local") < 0) {
      aviso("Usá la IP de la impresora (ej. 192.168.1.50)", "error");
      return false;
    }
    if (!(puerto >= 1 && puerto <= 65535)) {
      aviso("Puerto inválido", "error");
      return false;
    }
    guardar(CLAVES.host, host);
    guardar(CLAVES.puerto, puerto);
    guardar(CLAVES.ancho, ancho);
    guardar(CLAVES.corte, corte);
    guardar(CLAVES.codepage, codepage);
    guardar(CLAVES.destino, destino);
    pintarEstado();
    aviso("Impresora guardada");
    return true;
  }

  function salida(texto, error) {
    var caja = $("invImpSalida");
    if (!caja) return;
    caja.textContent = texto || "";
    caja.className = "inv-ayuda" + (error ? " inv-error" : "");
  }

  function probarUi() {
    var cfg = config();
    var host = ($("invImpHost") || {}).value || cfg.host;
    var puerto = Number(($("invImpPuerto") || {}).value || cfg.puerto);
    if (!host) { aviso("Escribí la IP de la impresora", "error"); return; }
    salida("Probando " + host + ":" + puerto + "…");
    var r = probar(host, puerto);
    if (r && r.ok) {
      salida("Conectada · " + host + ":" + puerto + " · " + r.ms + " ms"
        + (r.responde_estado ? " · estado: " + (r.estado || "responde") : " · sin respuesta de estado"));
      aviso("Impresora conectada");
    } else {
      salida("No se pudo conectar: " + ((r && r.error) || "error"), true);
      aviso("Sin conexión con la impresora", "error");
    }
  }

  function buscarUi() {
    salida("Buscando impresoras en tu red (puerto 9100)…");
    var r = buscar();
    if (!r.ok) {
      salida("No se pudo iniciar la búsqueda: " + (r.error || "error"), true);
    }
  }

  function descubiertas(r) {
    if (!r || !r.ok) {
      salida("Búsqueda fallida: " + ((r && r.error) || "error"), true);
      return;
    }
    var lista = r.encontradas || [];
    if (!lista.length) {
      salida("No apareció ninguna impresora en " + (r.red || "la red") + ". "
        + "Revisá que la impresora esté encendida y en la misma WiFi.", true);
      return;
    }
    var html = lista.map(function (x) {
      return '<button type="button" class="btn btn-mini" data-imp-ip="' + x.host + '">'
        + x.host + "</button>";
    }).join(" ");
    var caja = $("invImpSalida");
    if (caja) {
      caja.className = "inv-ayuda";
      caja.innerHTML = "Encontradas en " + (r.red || "la red") + ": " + html
        + '<p class="inv-ayuda">Tocá una para usarla.</p>';
      caja.querySelectorAll("[data-imp-ip]").forEach(function (b) {
        b.addEventListener("click", function () {
          if ($("invImpHost")) $("invImpHost").value = b.getAttribute("data-imp-ip");
          guardarCampos();
          probarUi();
        });
      });
    }
    aviso(lista.length + " impresora(s) encontrada(s)");
  }

  function iniciar() {
    volcarCampos();
    if ($("btnInvImpGuardar")) $("btnInvImpGuardar").addEventListener("click", guardarCampos);
    if ($("btnInvImpProbar")) $("btnInvImpProbar").addEventListener("click", probarUi);
    if ($("btnInvImpBuscar")) $("btnInvImpBuscar").addEventListener("click", buscarUi);
    if ($("btnInvImpTest")) $("btnInvImpTest").addEventListener("click", function () {
      if (!guardarCampos()) return;
      var negocio = {};
      try { negocio = (typeof invNegocio === "function") ? invNegocio() : {}; } catch (e) {}
      imprimirPrueba(negocio);
    });
    if ($("invImpDestino")) $("invImpDestino").addEventListener("change", guardarCampos);
    if ($("invImpAncho")) $("invImpAncho").addEventListener("change", guardarCampos);
  }

  window.FabriImpresora = {
    ANCHOS: ANCHOS,
    config: config,
    configurada: configurada,
    bytesTexto: bytesTexto,
    envolver: envolver,
    ticketBoleta: ticketBoleta,
    ticketPrueba: ticketPrueba,
    base64: base64,
    imprimir: imprimir,
    imprimirPrueba: imprimirPrueba,
    probar: probar,
    buscar: buscar,
    descubiertas: descubiertas,
    guardar: guardarCampos,
    iniciar: iniciar
  };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", iniciar);
    } else {
      iniciar();
    }
  }
})();
