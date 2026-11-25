/* FORGE CORE STOCK · vista «Tienda y CRM» (APK)
   --------------------------------------------------------------------------
   Usa la MISMA clave de 8 caracteres de la tienda que el panel del negocio.
   No hay token nuevo: `/api/inventario` y `/api/mercado` ya la aceptan.

   Qué se puede hacer desde aquí:
     · conectar / probar / desconectar la tienda,
     · crear las tablas que falten en la nube,
     · subir el catálogo del equipo y bajar el publicado,
     · editar nombre, precio y stock de un producto y guardarlo en la nube,
     · ver clientes (CRM) y el estado de la conexión con sus fallos.

   Nada se inventa: si la nube no responde, se dice y el fallo queda listado.
   No usa diálogos del WebView (alert/prompt): todo se edita en la tarjeta. */
(function () {
  "use strict";

  var INV = "https://fabri-api.vercel.app/api/inventario";
  var MER = "https://fabri-api.vercel.app/api/mercado";
  var K = {
    local: "fcore.tienda.local",
    clave: "fcore.tienda.clave",
    fallos: "fcore.tienda.fallos",
    catalogo: "fcore.tienda.catalogo",
    ultimo: "fcore.tienda.ultimo",
  };
  var TD = {
    sec: "conexion",
    msg: "",
    tipo: "",
    ocupado: false,
    ok: false,
    datos: null,
    disps: [],
    errores: [],
    productos: [],
    clientes: null,
    resumen: null,
  };

  var $ = function (sel) { return document.querySelector(sel); };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function clp(n) {
    var v = Math.round(Number(n) || 0);
    try { return "$" + new Intl.NumberFormat("es-CL").format(v); }
    catch (e) { return "$" + v; }
  }

  function leer(k, def) {
    try { var v = localStorage.getItem(k); return v == null ? def : v; }
    catch (e) { return def; }
  }
  function guardar(k, v) {
    try { localStorage.setItem(k, v); } catch (e) { /* modo privado */ }
  }

  function cfg() {
    var local = String(leer(K.local, "") || "").trim();
    var clave = String(leer(K.clave, "") || "").trim();
    return local && clave ? { local: local, clave: clave } : null;
  }

  function fallos() {
    try {
      var d = JSON.parse(leer(K.fallos, "[]"));
      return Array.isArray(d) ? d : [];
    } catch (e) { return []; }
  }

  function anotarFallo(txt) {
    var lista = fallos();
    lista.unshift({ ts: Date.now(), texto: String(txt || "fallo sin detalle").slice(0, 220) });
    guardar(K.fallos, JSON.stringify(lista.slice(0, 10)));
  }

  function hace(ts) {
    if (!ts) return "—";
    var min = Math.max(0, Math.round((Date.now() - Number(ts)) / 60000));
    if (min < 1) return "ahora";
    if (min < 60) return "hace " + min + " min";
    var h = Math.round(min / 60);
    if (h < 24) return "hace " + h + " h";
    return "hace " + Math.round(h / 24) + " d";
  }

  function fecha(ts) {
    if (!ts) return "—";
    var d = new Date(ts);
    if (isNaN(d.getTime())) return "—";
    try {
      return new Intl.DateTimeFormat("es-CL", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
      }).format(d);
    } catch (e) { return d.toLocaleString(); }
  }

  /** POST con tiempo límite. Devuelve { ok, status, d } sin lanzar. */
  function api(url, cuerpo) {
    var control = typeof AbortController !== "undefined" ? new AbortController() : null;
    var reloj = setTimeout(function () { if (control) control.abort(); }, 15000);
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
      cache: "no-store",
      signal: control ? control.signal : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        return { ok: r.ok && d && d.ok !== false, status: r.status, d: d || {} };
      });
    }).catch(function () {
      return { ok: false, status: 0, d: { codigo: "SIN_RED" } };
    }).then(function (res) {
      clearTimeout(reloj);
      return res;
    });
  }

  function motivo(res) {
    var d = res.d || {};
    if (res.status === 0 || d.codigo === "SIN_RED") return "Sin conexión con la nube. Revisa tu red.";
    if (d.codigo === "clave_mala" || res.status === 401) return "La clave no abre esta tienda.";
    if (d.codigo === "local_inexistente") return "Esa tienda no existe en la nube.";
    if (d.codigo === "SIN_BASE") return "La nube no tiene la base configurada.";
    if (d.codigo === "FALTA_CONFIRMAR") return "Confirma la acción.";
    return d.error || ("La nube respondió " + res.status + ".");
  }

  /* ── acciones ─────────────────────────────────────────────────────────── */

  function trabajo(texto, tarea) {
    if (TD.ocupado) return;
    TD.ocupado = true;
    TD.msg = texto;
    TD.tipo = "";
    pintar();
    Promise.resolve().then(tarea).then(function (r) {
      TD.ocupado = false;
      if (r && r.ok) {
        TD.ok = true;
        TD.msg = r.texto || "Listo.";
        TD.tipo = "ok";
        guardar(K.ultimo, String(Date.now()));
      } else {
        TD.ok = false;
        TD.msg = (r && r.texto) || "No se pudo completar.";
        TD.tipo = "mal";
        anotarFallo(TD.msg);
      }
      pintar();
    }).catch(function (e) {
      TD.ocupado = false;
      TD.ok = false;
      TD.msg = (e && e.message) || "Error inesperado.";
      TD.tipo = "mal";
      anotarFallo(TD.msg);
      pintar();
    });
  }

  function conectar() {
    var local = String(($("#tdLocal") || {}).value || "").trim().toLowerCase();
    var clave = String(($("#tdClave") || {}).value || "").trim().toUpperCase();
    if (!local) { TD.msg = "Escribe el identificador de la tienda."; TD.tipo = "mal"; pintar(); return; }
    if (clave.length !== 8) { TD.msg = "La clave tiene 8 caracteres."; TD.tipo = "mal"; pintar(); return; }
    trabajo("Probando la conexión…", function () {
      return api(INV, { accion: "verificar", local_id: local, clave: clave }).then(function (r) {
        if (!r.ok) return { ok: false, texto: motivo(r) };
        guardar(K.local, local);
        guardar(K.clave, clave);
        guardar(K.ultimo, String(Date.now()));
        return api(INV, { accion: "asegurar" }).then(function (a) {
          return api(MER, { accion: "asegurar" }).then(function (m) {
            var c = (r.d.conexion || {});
            return {
              ok: true,
              texto: "Conectada: " + (c.tienda || local) + " · " + (Number(c.productos) || 0) +
                " productos" + (a.ok && m.ok ? " · tablas listas" : " · revisa las tablas"),
            };
          });
        });
      });
    });
  }

  function probar() {
    var c = cfg();
    if (!c) return;
    trabajo("Probando…", function () {
      return api(INV, { accion: "verificar", local_id: c.local, clave: c.clave }).then(function (r) {
        if (!r.ok) return { ok: false, texto: motivo(r) };
        var d = r.d.conexion || {};
        TD.datos = d;
        return { ok: true, texto: "Enlace OK · " + (d.tienda || c.local) + " · " + (Number(d.productos) || 0) + " productos" };
      });
    });
  }

  function asegurar() {
    var c = cfg();
    if (!c) return;
    trabajo("Creando tablas en la nube…", function () {
      return api(INV, { accion: "asegurar" }).then(function (a) {
        return api(MER, { accion: "asegurar" }).then(function (m) {
          if (!a.ok || !m.ok) return { ok: false, texto: "No se pudieron crear todas las tablas." };
          return { ok: true, texto: "Tablas listas en inventario y mercado." };
        });
      });
    });
  }

  function estado() {
    var c = cfg();
    if (!c) return;
    trabajo("Leyendo el estado de la nube…", function () {
      return api(MER, { accion: "conexion_estado", local_id: c.local, clave: c.clave }).then(function (r) {
        if (!r.ok) return { ok: false, texto: motivo(r) };
        TD.datos = r.d.conexion || null;
        TD.disps = Array.isArray(r.d.dispositivos) ? r.d.dispositivos : [];
        TD.errores = Array.isArray(r.d.errores) ? r.d.errores : [];
        return { ok: true, texto: "Estado actualizado." };
      });
    });
  }

  function subir() {
    var c = cfg();
    if (!c) return;
    trabajo("Subiendo el catálogo del equipo…", function () {
      return api(INV, { accion: "subir", local_id: c.local, clave: c.clave, etiqueta: "APK FORGE CORE STOCK", plataforma: "android", version: "0.9.69" })
        .then(function (r) {
          if (!r.ok) return { ok: false, texto: motivo(r) };
          return { ok: true, texto: "Subidos " + (Number(r.d.subidos) || 0) + " productos." };
        });
    });
  }

  function bajar() {
    var c = cfg();
    if (!c) return;
    trabajo("Bajando el catálogo publicado…", function () {
      return api(INV, { accion: "bajar", local_id: c.local, clave: c.clave, limite: 500 }).then(function (r) {
        if (!r.ok) return { ok: false, texto: motivo(r) };
        var lista = Array.isArray(r.d.productos) ? r.d.productos : [];
        TD.productos = lista.map(function (p) {
          return {
            sku: p.codigo || p.sku || "",
            nombre: p.nombre || "",
            precio: Number(p.precio) || 0,
            stock: Number(p.stock) || 0,
            unidad: p.unidad || "unidad",
          };
        });
        guardar(K.catalogo, JSON.stringify(TD.productos.slice(0, 500)));
        return { ok: true, texto: "Bajados " + TD.productos.length + " productos." };
      });
    });
  }

  function cargarCatalogo() {
    var c = cfg();
    if (!c) return;
    trabajo("Leyendo el catálogo publicado…", function () {
      return api(MER, { accion: "local_ver", local_id: c.local }).then(function (r) {
        if (!r.ok) return { ok: false, texto: motivo(r) };
        var lista = (r.d.tienda && Array.isArray(r.d.tienda.catalogo)) ? r.d.tienda.catalogo : [];
        TD.productos = lista.map(function (p) {
          return {
            sku: p.sku || p.codigo || "",
            nombre: p.nombre || "",
            precio: Number(p.precio) || 0,
            stock: Number(p.stock) || 0,
            unidad: p.unidad || "unidad",
          };
        });
        guardar(K.catalogo, JSON.stringify(TD.productos.slice(0, 500)));
        return { ok: true, texto: TD.productos.length + " productos publicados." };
      });
    });
  }

  function guardarProducto(sku) {
    var c = cfg();
    if (!c) return;
    var caja = document.querySelector('[data-prod="' + sku + '"]');
    if (!caja) return;
    var nombre = String((caja.querySelector("[data-nombre]") || {}).value || "").trim();
    var precio = Number(String((caja.querySelector("[data-precio]") || {}).value || "0").replace(",", ".")) || 0;
    var stock = parseInt(String((caja.querySelector("[data-stock]") || {}).value || "0"), 10) || 0;
    if (nombre.length < 2) { TD.msg = "El nombre necesita al menos 2 caracteres."; TD.tipo = "mal"; pintar(); return; }
    trabajo("Guardando " + sku + " en la nube…", function () {
      return api(MER, {
        accion: "productos_subir",
        local_id: c.local,
        clave: c.clave,
        productos: [{ sku: sku, nombre: nombre, precio: precio, stock: stock, unidad: "unidad", categoria: "general" }],
      }).then(function (r) {
        if (!r.ok) return { ok: false, texto: motivo(r) };
        TD.productos = TD.productos.map(function (p) {
          return p.sku === sku ? { sku: sku, nombre: nombre, precio: precio, stock: stock, unidad: p.unidad } : p;
        });
        guardar(K.catalogo, JSON.stringify(TD.productos.slice(0, 500)));
        return { ok: true, texto: "Producto " + sku + " guardado." };
      });
    });
  }

  function cargarClientes() {
    var c = cfg();
    if (!c) return;
    trabajo("Leyendo los clientes…", function () {
      return api(MER, { accion: "clientes_listar", local_id: c.local, clave: c.clave }).then(function (r) {
        if (!r.ok) return { ok: false, texto: motivo(r) };
        TD.clientes = Array.isArray(r.d.clientes) ? r.d.clientes : [];
        TD.resumen = r.d.resumen || null;
        return { ok: true, texto: TD.clientes.length + " clientes." };
      });
    });
  }

  function desconectar() {
    guardar(K.local, "");
    guardar(K.clave, "");
    TD.datos = null; TD.disps = []; TD.errores = [];
    TD.productos = []; TD.clientes = null; TD.resumen = null;
    TD.msg = "Tienda desconectada en este equipo. El catálogo local se conserva.";
    TD.tipo = "";
    TD.ok = false;
    pintar();
  }

  /* ── pintado ──────────────────────────────────────────────────────────── */

  function aviso() {
    if (!TD.msg) return "";
    return '<p class="td-msg" data-tipo="' + esc(TD.tipo) + '" role="status">' + esc(TD.msg) + "</p>";
  }

  function cardConexion() {
    var c = cfg();
    if (!c) {
      return '<div class="td-card">' +
        "<h3>Conectar con mi tienda</h3>" +
        '<p class="td-nota">El identificador y la clave están en el panel del negocio → Conexión. ' +
          "La clave se guarda solo en este equipo.</p>" +
        '<label class="td-campo"><span>Identificador</span>' +
          '<input id="tdLocal" type="text" autocomplete="off" spellcheck="false" placeholder="mi-tienda"></label>' +
        '<label class="td-campo"><span>Clave (8 caracteres)</span>' +
          '<input id="tdClave" type="password" autocomplete="off" maxlength="8" placeholder="ABCD1234"></label>' +
        '<div class="td-fila"><button class="td-btn td-btn--pri" data-acc="conectar"' +
          (TD.ocupado ? " disabled" : "") + ">Conectar y probar</button></div>" +
        aviso() +
      "</div>";
    }
    var d = TD.datos || {};
    var filas = [
      ["Tienda", esc(d.tienda || c.local)],
      ["Identificador", esc(c.local)],
      ["Publicada", d.activo === false ? "no" : "sí"],
      ["Plan", esc(d.plan || "—")],
      ["Productos en la nube", String(Number(d.productos) || 0)],
      ["Última sincronización", d.ultima_nube ? esc(fecha(d.ultima_nube)) : "—"],
      ["Dispositivos", String(TD.disps.length)],
    ];
    var listaFallos = fallos().slice(0, 3).map(function (f) {
      return '<li class="td-fallo">' + esc(hace(f.ts)) + " · " + esc(f.texto) + "</li>";
    }).join("");
    return '<div class="td-card">' +
      "<h3>Conexión</h3>" +
      '<div class="td-datos">' + filas.map(function (f) {
        return '<div class="td-dato"><span>' + f[0] + "</span><b>" + f[1] + "</b></div>";
      }).join("") + "</div>" +
      '<div class="td-fila">' +
        '<button class="td-btn" data-acc="probar"' + (TD.ocupado ? " disabled" : "") + ">Probar</button>" +
        '<button class="td-btn" data-acc="estado"' + (TD.ocupado ? " disabled" : "") + ">Estado</button>" +
        '<button class="td-btn" data-acc="asegurar"' + (TD.ocupado ? " disabled" : "") + ">Asegurar tablas</button>" +
        '<button class="td-btn" data-acc="subir"' + (TD.ocupado ? " disabled" : "") + ">Subir catálogo</button>" +
        '<button class="td-btn" data-acc="bajar"' + (TD.ocupado ? " disabled" : "") + ">Bajar catálogo</button>" +
        '<button class="td-btn" data-acc="desconectar"' + (TD.ocupado ? " disabled" : "") + ">Desconectar</button>" +
      "</div>" +
      aviso() +
      (listaFallos ? '<p class="td-nota">Últimos fallos</p><ul class="td-fallos">' + listaFallos + "</ul>" : "") +
      '<p class="td-nota">La misma clave de 8 caracteres del panel. Si la pierdes, genera una nueva allí ' +
        "y vuelve a conectar este equipo.</p>" +
    "</div>";
  }

  function cardProductos() {
    if (!cfg()) return "";
    var lista = TD.productos.length
      ? '<div class="td-lista">' + TD.productos.map(function (p) {
          return '<div class="td-item" data-prod="' + esc(p.sku) + '">' +
            '<div class="td-item__cab"><span class="td-item__nombre">' + esc(p.nombre) + "</span>" +
              '<span class="td-item__meta">' + esc(p.sku) + "</span></div>" +
            '<div class="td-item__editar">' +
              '<label class="td-campo"><span>Nombre</span><input data-nombre type="text" value="' + esc(p.nombre) + '"></label>' +
              '<label class="td-campo"><span>Precio (CLP)</span><input data-precio type="number" inputmode="numeric" value="' + esc(p.precio) + '"></label>' +
              '<label class="td-campo"><span>Stock</span><input data-stock type="number" inputmode="numeric" value="' + esc(p.stock) + '"></label>' +
              '<div class="td-fila"><button class="td-btn td-btn--pri" data-acc="guardar" data-sku="' + esc(p.sku) + '"' +
                (TD.ocupado ? " disabled" : "") + ">Guardar en la nube</button></div>" +
            "</div>" +
          "</div>";
        }).join("") + "</div>"
      : '<div class="td-vacio"><b>Sin productos cargados</b><br>Pulsa «Leer catálogo» para bajar el que está publicado.</div>';
    return '<div class="td-card">' +
      "<h3>Productos publicados</h3>" +
      '<div class="td-fila">' +
        '<button class="td-btn td-btn--pri" data-acc="catalogo"' + (TD.ocupado ? " disabled" : "") + ">Leer catálogo</button>" +
        '<button class="td-btn" data-acc="bajar"' + (TD.ocupado ? " disabled" : "") + ">Bajar al equipo</button>" +
      "</div>" +
      aviso() +
      lista +
      '<p class="td-nota">Lo que guardes aquí es lo que ve el comprador en la tienda. El stock 0 marca agotado.</p>' +
    "</div>";
  }

  function cardClientes() {
    if (!cfg()) return "";
    var r = TD.resumen || null;
    var kpis = r
      ? '<div class="td-kpis">' +
          '<div class="td-kpi"><span>Clientes</span><b>' + (Number(r.total) || 0) + "</b></div>" +
          '<div class="td-kpi"><span>Recurrentes</span><b>' + (Number(r.recurrentes) || 0) + "</b></div>" +
          '<div class="td-kpi"><span>Con cuenta</span><b>' + (Number(r.con_cuenta) || 0) + "</b></div>" +
          '<div class="td-kpi"><span>Gasto</span><b>' + clp(r.gastado) + "</b></div>" +
        "</div>"
      : "";
    var lista = (TD.clientes && TD.clientes.length)
      ? '<div class="td-lista">' + TD.clientes.map(function (c) {
          return '<div class="td-item">' +
            '<div class="td-item__cab"><span class="td-item__nombre">' + esc(c.nombre) + "</span>" +
              '<span class="td-item__etq" data-seg="' + esc(c.segmento) + '">' + esc(c.segmento || "—") + "</span></div>" +
            '<span class="td-item__meta">' + esc(c.telefono || "sin teléfono") + " · " +
              (Number(c.pedidos) || 0) + " pedidos · " + clp(c.gastado) + " · " + esc(hace(c.ultimo)) + "</span>" +
          "</div>";
        }).join("") + "</div>"
      : '<div class="td-vacio" style="margin-top:10px"><b>Todavía no hay clientes</b><br>Aparecen cuando entra el primer pedido.</div>';
    return '<div class="td-card">' +
      "<h3>Clientes</h3>" +
      '<div class="td-fila"><button class="td-btn td-btn--pri" data-acc="clientes"' +
        (TD.ocupado ? " disabled" : "") + ">Actualizar clientes</button></div>" +
      aviso() + kpis + lista +
      '<p class="td-nota">Datos de la nube: el teléfono llega enmascarado y no se puede ver completo desde aquí.</p>' +
    "</div>";
  }

  function pintar() {
    var caja = $("#tdApp");
    if (!caja) return;
    var c = cfg();
    var ok = c && TD.ok;
    var est = !c ? "sin tienda" : (ok ? "conectado" : "revisar");
    var html =
      '<div class="td-cab">' +
        "<div><h2>Tienda y CRM</h2>" +
          "<p>Conecta esta app con tu tienda, sincroniza el catálogo y mira tus clientes.</p></div>" +
        '<span class="td-estado" data-ok="' + (ok ? "si" : (c ? "no" : "")) + '">' + esc(est) + "</span>" +
      "</div>";
    if (c) {
      html += '<div class="td-tabs" role="tablist">' +
        ["conexion", "productos", "clientes"].map(function (s) {
          var t = s === "conexion" ? "Conexión" : (s === "productos" ? "Productos" : "Clientes");
          return '<button class="td-tab" role="tab" data-sec="' + s + '" aria-selected="' +
            (TD.sec === s ? "true" : "false") + '">' + t + "</button>";
        }).join("") + "</div>";
      html += TD.sec === "productos" ? cardProductos() : (TD.sec === "clientes" ? cardClientes() : cardConexion());
    } else {
      html += cardConexion();
    }
    caja.innerHTML = html;
  }

  /* ── eventos ──────────────────────────────────────────────────────────── */

  function enganchar() {
    var caja = $("#tdApp");
    if (!caja || caja.dataset.listo === "1") return;
    caja.dataset.listo = "1";
    caja.addEventListener("click", function (e) {
      var tab = e.target.closest ? e.target.closest("[data-sec]") : null;
      if (tab) { TD.sec = tab.dataset.sec; pintar(); return; }
      var b = e.target.closest ? e.target.closest("[data-acc]") : null;
      if (!b || b.disabled) return;
      var acc = b.dataset.acc;
      if (acc === "conectar") conectar();
      else if (acc === "probar") probar();
      else if (acc === "estado") estado();
      else if (acc === "asegurar") asegurar();
      else if (acc === "subir") subir();
      else if (acc === "bajar") bajar();
      else if (acc === "catalogo") cargarCatalogo();
      else if (acc === "clientes") cargarClientes();
      else if (acc === "desconectar") desconectar();
      else if (acc === "guardar") guardarProducto(b.dataset.sku);
    });
  }

  /* Carga inicial: si el equipo ya tiene catálogo guardado, se muestra al
     entrar a Productos sin volver a pedirlo. */
  window.tiendaIniciar = function () {
    if (!TD.productos.length) {
      try {
        var g = JSON.parse(leer(K.catalogo, "[]"));
        if (Array.isArray(g)) TD.productos = g;
      } catch (e) { /* sin respaldo */ }
    }
    pintar();
    enganchar();
    if (cfg()) estado();
  };
})();
