/* ==========================================================================
   FORGE CORE STOCK · Inventario · Buscador intuitivo (inv-buscar.js)
   --------------------------------------------------------------------------
   Archivo NUEVO y auto-contenido. NO toca inventario.js ni index.html: expone
   `window.InvBuscar` para que el hilo principal lo conecte cuando quiera.

   Qué hace:
     - Campo de búsqueda con icono + filtros rápidos (chips) + orden + paginación.
     - `buscar(texto)` resuelve {items,total,pagina,paginas}. Usa la API del
       núcleo (`invApiTarde("listar", {texto,limite,offset})`) si existe; si no,
       filtra el array `INV.productos`.
     - Debounce de 250 ms, normalización sin acentos, resaltado de la coincidencia
       y estado vacío con explicación.
     - Accesible: `aria-live` en el contador, `<label>` en el campo y foco visible.

   Dependencias: ninguna. Vanilla JS. Los estilos viven en inv-buscar.css.
   ========================================================================== */
(function () {
  "use strict";

  /* ── utilidades ─────────────────────────────────────────────────────────── */

  // Normaliza texto: minúsculas y sin tildes/acentos. `NFD` separa la letra
  // base del signo diacrítico; luego se quitan los signos (rango U+0300–036F).
  // Sirve para que "Café" y "cafe" se encuentren igual.
  function norm(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  // Escapa HTML para inyectar texto del usuario sin abrir la puerta a XSS.
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Formatea pesos chilenos sin decimales: 1990 -> "$1.990".
  function clp(n) {
    var v = Number(n) || 0;
    return "$" + v.toLocaleString("es-CL", { maximumFractionDigits: 0 });
  }

  // Resalta la coincidencia envolviéndola en <mark>. La longitud normalizada
  // coincide con la original para el alfabeto latino (á -> a mide 1), así que
  // los índices sirven para cortar el texto original. Si no coinciden (alfabetos
  // exóticos), devuelve el texto escapado sin resaltar: es preferible no marcar
  // a marcar mal.
  function resaltar(texto, q) {
    var orig = String(texto == null ? "" : texto);
    if (!q) return esc(orig);
    var no = norm(orig);
    var nq = norm(q);
    if (!nq || no.length !== orig.length) return esc(orig);
    var out = "";
    var i = 0;
    var idx;
    while ((idx = no.indexOf(nq, i)) >= 0) {
      out += esc(orig.slice(i, idx));
      out += "<mark>" + esc(orig.slice(idx, idx + nq.length)) + "</mark>";
      i = idx + nq.length;
    }
    out += esc(orig.slice(i));
    return out;
  }

  // Lee la ficha guardada del producto (objeto o JSON en texto) sin romperse.
  function fichaDe(p) {
    if (!p) return {};
    if (p.ficha && typeof p.ficha === "object") return p.ficha;
    try {
      var f = JSON.parse(p.ficha || "{}");
      return f && typeof f === "object" ? f : {};
    } catch (e) {
      return {};
    }
  }

  // ¿El producto está en oferta? No hay un campo único en el núcleo, así que se
  // reconoce por varias señales: bandera directa, ficha.oferta, etiqueta
  // "oferta" o un precio por debajo del sugerido.
  function esOferta(p) {
    if (!p) return false;
    if (p.oferta || p.en_oferta) return true;
    var f = fichaDe(p);
    if (f && f.oferta) return true;
    var etq = (f && f.etiquetas) || [];
    if (etq.indexOf && etq.indexOf("oferta") >= 0) return true;
    var sugerido = Number(f.precio_sugerido || p.precio_sugerido || 0);
    if (sugerido > 0 && Number(p.precio || 0) < sugerido) return true;
    return false;
  }

  var SVG_BUSCAR =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';

  var FILTROS = [
    { id: "todos", etiqueta: "Todos" },
    { id: "bajo", etiqueta: "Stock bajo" },
    { id: "sin", etiqueta: "Sin stock" },
    { id: "margen", etiqueta: "Con margen bajo" },
    { id: "oferta", etiqueta: "Oferta" }
  ];

  var ORDENES = [
    { id: "nombre", etiqueta: "Nombre" },
    { id: "precio_asc", etiqueta: "Precio: menor a mayor" },
    { id: "precio_desc", etiqueta: "Precio: mayor a menor" },
    { id: "stock", etiqueta: "Stock" },
    { id: "margen", etiqueta: "Margen" }
  ];

  /* ── controlador ────────────────────────────────────────────────────────── */

  // Crea un controlador de búsqueda con su propio estado. `montar` lo usa para
  // la UI; `InvBuscar.buscar` usa uno oculto por defecto.
  function crear(opciones) {
    opciones = opciones || {};

    var ctrl = {
      pagina: 0,
      paginaTam: Number(opciones.paginaTam) > 0 ? Number(opciones.paginaTam) : 20,
      limiteMax: Number(opciones.limiteMax) > 0 ? Number(opciones.limiteMax) : 500,
      margenBajo: Number(opciones.margenBajo) >= 0 ? Number(opciones.margenBajo) : 20,
      texto: "",
      filtro: "todos",
      orden: "nombre",
      raiz: null,
      _uid: "invb" + Math.random().toString(36).slice(2, 8),
      _timer: null,
      _vec: 0, // versión: descarta respuestas de búsquedas viejas
      _alSeleccionar: typeof opciones.alSeleccionar === "function" ? opciones.alSeleccionar : null,
      _productos: Array.isArray(opciones.productos) ? opciones.productos : null
    };

    // Fuente de datos por defecto: el array global del inventario.
    ctrl._fuente = function () {
      if (typeof opciones.fuente === "function") return opciones.fuente() || [];
      if (ctrl._productos) return ctrl._productos;
      if (window.INV && Array.isArray(window.INV.productos)) return window.INV.productos;
      return [];
    };

    // Texto de un producto para la búsqueda local (nombre + marca + código + categoría).
    ctrl._baseLocal = function (t) {
      var lista = ctrl._fuente();
      if (!t) return Promise.resolve(lista.slice());
      var out = [];
      for (var i = 0; i < lista.length; i++) {
        var p = lista[i];
        var heno =
          norm(p.nombre) + " " + norm(p.marca) + " " + norm(p.codigo) + " " + norm(p.categoria);
        if (heno.indexOf(t) >= 0) out.push(p);
      }
      return Promise.resolve(out);
    };

    // Base de candidatos ya filtrada por el texto. Si el núcleo expone
    // `invApiTarde`, se le pide la lista con `texto/limite/offset` (offset 0: se
    // trae una ventana amplia y la paginación se hace en cliente, que es lo
    // correcto para una base local de cientos de productos). Si la API falla o
    // no existe, se filtra `INV.productos` en el propio teléfono.
    ctrl._base = function (texto) {
      var t = norm(texto);
      var api = typeof window.invApiTarde === "function" ? window.invApiTarde : null;
      if (!api) return ctrl._baseLocal(t);
      return api("listar", { texto: texto || "", limite: ctrl.limiteMax, offset: 0 })
        .then(function (r) {
          if (r && r.ok && r.data && Array.isArray(r.data.productos)) {
            return r.data.productos;
          }
          return ctrl._baseLocal(t);
        })
        .catch(function () {
          return ctrl._baseLocal(t);
        });
    };

    // ¿Pasa el filtro rápido (chip) activo?
    ctrl._pasaFiltro = function (p) {
      switch (ctrl.filtro) {
        case "bajo":
          return Number(p.stock) > 0 && Number(p.stock) <= Number(p.stock_minimo);
        case "sin":
          return Number(p.stock) <= 0;
        case "margen":
          return (Number(p.margen) || 0) < ctrl.margenBajo;
        case "oferta":
          return esOferta(p);
        default:
          return true;
      }
    };

    // Ordena una copia (no muta el original) según el criterio elegido.
    ctrl._ordenar = function (arr) {
      var n = function (v) { return Number(v) || 0; };
      var o = ctrl.orden;
      return arr.slice().sort(function (a, b) {
        switch (o) {
          case "precio_asc": return n(a.precio) - n(b.precio);
          case "precio_desc": return n(b.precio) - n(a.precio);
          case "stock": return n(b.stock) - n(a.stock);
          case "margen": return n(b.margen) - n(a.margen);
          default: return String(a.nombre || "").localeCompare(String(b.nombre || ""), "es");
        }
      });
    };

    // Búsqueda principal. Devuelve la promesa con {items,total,pagina,paginas}.
    // `pagina` es 0-based (la UI la muestra +1).
    ctrl.buscar = function (texto) {
      if (typeof texto === "string") ctrl.texto = texto;
      var pagina = ctrl.pagina;
      var tam = ctrl.paginaTam;
      var ver = ++ctrl._vec; // invalidar la búsqueda anterior si llega desordenada

      return ctrl._base(ctrl.texto).then(function (base) {
        var filtrada = base.filter(ctrl._pasaFiltro);
        var total = filtrada.length;
        var ordenada = ctrl._ordenar(filtrada);
        var paginas = Math.max(1, Math.ceil(total / tam));
        if (pagina > paginas - 1) pagina = paginas - 1;
        if (pagina < 0) pagina = 0;
        ctrl.pagina = pagina;
        var desde = pagina * tam;
        var items = ordenada.slice(desde, desde + tam);

        var resultado = { items: items, total: total, pagina: pagina, paginas: paginas };
        // Solo la búsqueda vigente pinta la UI (evita parpadeos con debounce).
        if (ver === ctrl._vec && ctrl.raiz) ctrl._pintar(resultado);
        return resultado;
      });
    };

    /* ── pintado (solo si se montó la UI) ───────────────────────────────── */

    ctrl._pintar = function (r) {
      var q = ctrl.texto;
      var contador = ctrl.raiz.querySelector(".invb-contador");
      var caja = ctrl.raiz.querySelector(".invb-resultados");
      var pag = ctrl.raiz.querySelector(".invb-paginacion");
      if (!caja) return;

      // Contador accesible (aria-live lo anuncia).
      if (contador) {
        if (r.total === 0) {
          contador.textContent = "0 resultados";
        } else {
          var d1 = r.pagina * ctrl.paginaTam + 1;
          var d2 = Math.min(r.total, (r.pagina + 1) * ctrl.paginaTam);
          contador.textContent = "Mostrando " + d1 + "–" + d2 + " de " + r.total;
        }
      }

      // Estado vacío con explicación y pista de recuperación.
      if (!r.items.length) {
        if (q && q.trim()) {
          caja.innerHTML =
            '<div class="invb-vacio">' +
            "<b>No encontramos “" + esc(q.trim()) + "”.</b>" +
            "<span>Prueba con el nombre o el código de barras.</span></div>";
        } else if (ctrl.filtro !== "todos") {
          caja.innerHTML =
            '<div class="invb-vacio"><b>Nada con este filtro.</b>' +
            "<span>Cambia el filtro o escribe otra parte del nombre.</span></div>";
        } else {
          caja.innerHTML =
            '<div class="invb-vacio"><b>Todavía no hay productos.</b>' +
            "<span>Escanea un código, impórtalos o crea uno nuevo.</span></div>";
        }
        if (pag) pag.innerHTML = "";
        return;
      }

      caja.innerHTML = r.items.map(function (p) {
        return ctrl._card(p, q);
      }).join("");

      // Paginación 20 en 20.
      if (pag) {
        if (r.paginas <= 1) {
          pag.innerHTML = "";
        } else {
          pag.innerHTML =
            '<button type="button" class="invb-pag-btn" data-invb-pag="-1"' +
            (r.pagina <= 0 ? " disabled" : "") + " aria-label=\"Página anterior\">‹</button>" +
            '<span class="invb-pag-estado">Página ' + (r.pagina + 1) + " de " + r.paginas + "</span>" +
            '<button type="button" class="invb-pag-btn" data-invb-pag="1"' +
            (r.pagina >= r.paginas - 1 ? " disabled" : "") + " aria-label=\"Página siguiente\">›</button>";
        }
      }
    };

    // Tarjeta de un producto (nombre resaltado + precio + chips + código).
    ctrl._card = function (p, q) {
      var bajo = Number(p.stock) <= Number(p.stock_minimo);
      var cat = (window.INV_CATEGORIAS && window.INV_CATEGORIAS[p.categoria]) || p.categoria || "";
      var chips =
        '<span class="invb-tag' + (Number(p.stock) <= 0 ? " invb-tag-baja" : "") + '">stock ' +
        esc(p.stock != null ? p.stock : 0) + (bajo && Number(p.stock) > 0 ? " · bajo" : "") + "</span>" +
        '<span class="invb-tag">margen ' + esc(p.margen != null ? p.margen : 0) + "%</span>" +
        (esOferta(p) ? '<span class="invb-tag invb-tag-oferta">oferta</span>' : "") +
        '<span class="invb-cod">' + esc(p.codigo) + "</span>";
      return (
        '<article class="invb-card" role="button" tabindex="0" data-invb-cod="' + esc(p.codigo) + '">' +
        '<div class="invb-card-top">' +
        '<h4 class="invb-nombre">' + resaltar(p.nombre, q) + "</h4>" +
        '<strong class="invb-precio">' + clp(p.precio) + "</strong>" +
        "</div>" +
        (p.marca || cat ? '<p class="invb-meta">' + (p.marca ? esc(p.marca) + " · " : "") + esc(cat) + "</p>" : "") +
        '<div class="invb-chips">' + chips + "</div>" +
        "</article>"
      );
    };

    // Conecta la UI: renderiza el esqueleto y engancha los eventos.
    ctrl.montar = function (contenedor) {
      var cont = typeof contenedor === "string" ? document.querySelector(contenedor) : contenedor;
      if (!cont) throw new Error("InvBuscar.montar: contenedor no encontrado");
      ctrl.raiz = cont;
      var uid = ctrl._uid;

      cont.innerHTML =
        '<div class="invb">' +
        '<div class="invb-cab">' +
        '<label class="invb-buscar" for="' + uid + '-input">' +
        '<span class="invb-ico">' + SVG_BUSCAR + "</span>" +
        '<input id="' + uid + '-input" class="invb-input" type="search" autocomplete="off" ' +
        'spellcheck="false" placeholder="Busca por nombre o código de barras…" ' +
        'aria-label="Buscar productos por nombre o código de barras" />' +
        "</label>" +
        '<div class="invb-filtros" role="group" aria-label="Filtros rápidos">' +
        FILTROS.map(function (f) {
          return '<button type="button" class="invb-chip' + (f.id === "todos" ? " activo" : "") +
            '" data-invb-filtro="' + f.id + '" aria-pressed="' + (f.id === "todos") + '">' +
            esc(f.etiqueta) + "</button>";
        }).join("") +
        "</div>" +
        '<div class="invb-orden">' +
        '<label class="invb-orden-label" for="' + uid + '-orden">Orden</label>' +
        '<select id="' + uid + '-orden" class="invb-select">' +
        ORDENES.map(function (o) {
          return '<option value="' + o.id + '"' + (o.id === ctrl.orden ? " selected" : "") + ">" +
            esc(o.etiqueta) + "</option>";
        }).join("") +
        "</select></div>" +
        "</div>" +
        '<p class="invb-contador" aria-live="polite"></p>' +
        '<div class="invb-resultados"></div>' +
        '<div class="invb-paginacion"></div>' +
        '<p class="invb-consejo">Consejo: escanea el código o escribe parte del nombre. ' +
        "Los filtros se combinan con la búsqueda.</p>" +
        "</div>";

      var input = cont.querySelector(".invb-input");
      var sel = cont.querySelector(".invb-select");

      // Debounce de 250 ms: escribir no dispara una búsqueda por tecla.
      input.addEventListener("input", function () {
        clearTimeout(ctrl._timer);
        ctrl._timer = setTimeout(function () {
          ctrl.texto = input.value;
          ctrl.pagina = 0;
          ctrl.buscar();
        }, 250);
      });

      sel.addEventListener("change", function () {
        ctrl.orden = sel.value;
        ctrl.pagina = 0;
        ctrl.buscar();
      });

      // Filtros (chips) por delegación: un solo listener para los cinco.
      cont.querySelector(".invb-filtros").addEventListener("click", function (e) {
        var b = e.target.closest("[data-invb-filtro]");
        if (!b) return;
        ctrl.filtro = b.getAttribute("data-invb-filtro");
        cont.querySelectorAll("[data-invb-filtro]").forEach(function (x) {
          var on = x === b;
          x.classList.toggle("activo", on);
          x.setAttribute("aria-pressed", String(on));
        });
        ctrl.pagina = 0;
        ctrl.buscar();
      });

      // Paginación por delegación.
      var pag = cont.querySelector(".invb-paginacion");
      pag.addEventListener("click", function (e) {
        var b = e.target.closest("[data-invb-pag]");
        if (!b || b.disabled) return;
        ctrl.pagina += Number(b.getAttribute("data-invb-pag"));
        if (ctrl.pagina < 0) ctrl.pagina = 0;
        ctrl.buscar();
      });

      // Selección de tarjeta (clic o Enter/Espacio por accesibilidad).
      var caja = cont.querySelector(".invb-resultados");
      function elegir(cod) {
        if (typeof ctrl._alSeleccionar === "function") {
          var p = null;
          var lista = ctrl._fuente();
          for (var i = 0; i < lista.length; i++) {
            if (String(lista[i].codigo) === String(cod)) { p = lista[i]; break; }
          }
          ctrl._alSeleccionar(p || { codigo: cod });
        }
        // Evento genérico por si el hilo principal prefiere escucharlo.
        cont.dispatchEvent(new CustomEvent("invb:elegir", { bubbles: true, detail: { codigo: cod } }));
      }
      caja.addEventListener("click", function (e) {
        var card = e.target.closest("[data-invb-cod]");
        if (card) elegir(card.getAttribute("data-invb-cod"));
      });
      caja.addEventListener("keydown", function (e) {
        if (e.key !== "Enter" && e.key !== " ") return;
        var card = e.target.closest("[data-invb-cod]");
        if (card) { e.preventDefault(); elegir(card.getAttribute("data-invb-cod")); }
      });

      // Primera carga.
      ctrl.buscar();
      return ctrl;
    };

    // Accesos de conveniencia.
    ctrl.refrescar = function () { return ctrl.buscar(); };
    ctrl.enfocar = function () {
      var i = ctrl.raiz && ctrl.raiz.querySelector(".invb-input");
      if (i) i.focus();
    };
    ctrl.fijarTexto = function (t) {
      ctrl.texto = String(t == null ? "" : t);
      ctrl.pagina = 0;
      var i = ctrl.raiz && ctrl.raiz.querySelector(".invb-input");
      if (i) i.value = ctrl.texto;
      return ctrl.buscar();
    };
    ctrl.destruir = function () {
      clearTimeout(ctrl._timer);
      if (ctrl.raiz) ctrl.raiz.innerHTML = "";
      ctrl.raiz = null;
    };

    return ctrl;
  }

  /* ── API pública ────────────────────────────────────────────────────────── */

  var defecto = null; // controlador oculto para InvBuscar.buscar sin montar UI

  window.InvBuscar = {
    // Renderiza el buscador dentro de `contenedor` y devuelve el controlador.
    // opciones: { paginaTam, limiteMax, margenBajo, productos, fuente,
    //             alSeleccionar(producto) }
    montar: function (contenedor, opciones) {
      return crear(opciones).montar(contenedor);
    },

    // Búsqueda sin UI (usa un controlador oculto). Devuelve la promesa
    // {items,total,pagina,paginas}. `opciones` se aplica solo la primera vez.
    buscar: function (texto, opciones) {
      if (!defecto) defecto = crear(opciones);
      if (typeof texto === "string") defecto.texto = texto;
      return defecto.buscar(texto);
    },

    // Utilidades expuestas por si el hilo principal quiere reutilizarlas.
    _norm: norm,
    _resaltar: resaltar,
    _esOferta: esOferta
  };
})();