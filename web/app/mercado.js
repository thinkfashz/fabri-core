/* ==========================================================================
   MERCADO · catálogo en la nube (FORGE CORE STOCK)
   --------------------------------------------------------------------------
   Consulta /api/catalogo de fabri-api. Si no hay red o el endpoint no está
   desplegado, cae al seed local espejo (mismo formato) para que la superficie
   nunca quede vacía. Filtros: búsqueda, categoría, clasificación y precio máx.
   ========================================================================== */

window.Mercado = (function () {
  const API = "https://fabri-api.vercel.app/api/catalogo";

  // Espejo del catálogo del backend (para offline / antes del deploy).
  const SEED = [
    { id: "eq-001", nombre: "Caja registradora táctil", categoria: "Equipos", clasificacion: "Gama alta", descripcion: "Pantalla de 15,6\" con Android integrado, impresora térmica de 80 mm y batería de respaldo.", precio: 489990, moneda: "CLP", stock: 12, tinte: "#c8f542" },
    { id: "eq-002", nombre: "Lector de códigos láser", categoria: "Equipos", clasificacion: "Gama media", descripcion: "Escáner de mano ergonómico, lee EAN-13, Code128 y QR a 30 cm.", precio: 45990, moneda: "CLP", stock: 40, tinte: "#8c8cff" },
    { id: "eq-003", nombre: "Báscula de mostrador", categoria: "Equipos", clasificacion: "Economico", descripcion: "Capacidad 30 kg, precisión de 5 g, cabezal orientable con teclado.", precio: 74990, moneda: "CLP", stock: 8, tinte: "#3fe0c9" },
    { id: "eq-004", nombre: "Terminal de punto de venta", categoria: "Equipos", clasificacion: "Gama alta", descripcion: "Procesador dual-core, doble pantalla, soporte VESA y 4 GB de RAM.", precio: 359990, moneda: "CLP", stock: 5, tinte: "#c8f542" },
    { id: "ac-001", nombre: "Papel térmico 80 mm", categoria: "Insumos", clasificacion: "Gama media", descripcion: "Rollos de 50 mm de diámetro, calidad industrial, por caja de 50 unidades.", precio: 18990, moneda: "CLP", stock: 120, tinte: "#5aa9ff" },
    { id: "ac-002", nombre: "Cinta para medir stock", categoria: "Insumos", clasificacion: "Economico", descripcion: "Rollo de 300 etiquetas por caja, resistente a agua y frío.", precio: 8990, moneda: "CLP", stock: 86, tinte: "#3fe0c9" },
    { id: "ac-003", nombre: "Cargador de sobremesa", categoria: "Accesorios", clasificacion: "Gama media", descripcion: "Fuente de 12 V / 3 A con cable de 1,5 m, ideal para terminales POS.", precio: 12990, moneda: "CLP", stock: 34, tinte: "#ffc24b" },
    { id: "ac-004", nombre: "Soporte metálico para display", categoria: "Accesorios", clasificacion: "Economico", descripcion: "Base orientable 360° con brazo ajustable en altura.", precio: 15990, moneda: "CLP", stock: 22, tinte: "#8c8cff" },
    { id: "au-001", nombre: "Altavoz de mostrador", categoria: "Audio", clasificacion: "Gama media", descripcion: "5 W, plug 3,5 mm, carcasa de aluminio.", precio: 19990, moneda: "CLP", stock: 18, tinte: "#c8f542" },
    { id: "au-002", nombre: "Torre de sonido para local", categoria: "Audio", clasificacion: "Gama alta", descripcion: "2×50 W, Bluetooth, entrada USB y control remoto.", precio: 129990, moneda: "CLP", stock: 6, tinte: "#ff7a8a" },
    { id: "pr-001", nombre: "Lámina anti-robo para vitrina", categoria: "Protección", clasificacion: "Premium", descripcion: "Lámina de seguridad de 0,22 mm con adhesivo de alta sujeción.", precio: 34990, moneda: "CLP", stock: 4, tinte: "#5aa9ff" },
    { id: "pr-002", nombre: "Candado de vitrina", categoria: "Protección", clasificacion: "Gama media", descripcion: "Cuerpo de acero, llave doble y cierre reforzado.", precio: 11990, moneda: "CLP", stock: 15, tinte: "#3fe0c9" }
  ];

  let datos = null;          // catálogo cargado {productos, categorias, clasificaciones}
  let origen = "nube";       // "nube" | "local"
  let estado = { q: "", categoria: "", clasificacion: "", max: -1 };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmtCLP(n) {
    try {
      return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n);
    } catch (e) {
      return "$" + Math.round(n).toLocaleString("es-CL");
    }
  }

  async function cargar() {
    try {
      const ctrl = new AbortController();
      const reloj = setTimeout(() => ctrl.abort(), 7000);
      const r = await fetch(API, { signal: ctrl.signal, cache: "no-store" });
      clearTimeout(reloj);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      if (d && d.ok && Array.isArray(d.productos)) {
        datos = d;
        origen = "nube";
        return di;
      }
    } catch (e) { /* offline o endpoint aún no desplegado */ }
    datos = { ok: true, total: SEED.length, productos: SEED, origen: "local" };
    origen = "local";
    return datos;
  }

  function categorias() {
    const v = [];
    const sel = new Set();
    (datos.productos || []).forEach(p => { if (p.categoria && !sel.has(p.categoria)) { sel.add(p.categoria); v.push(p.categoria); } });
    return v.sort();
  }
  function clasificaciones() {
    const v = [];
    const sel = new Set();
    (datos.productos || []).forEach(p => { if (p.clasificacion && !sel.has(p.clasificacion)) { sel.add(p.clasificacion); v.push(p.clasificacion); } });
    return v.sort();
  }

  function filtrados() {
    const q = estado.q.toLowerCase();
    return (datos.productos || []).filter(p => {
      if (estado.categoria && p.categoria !== estado.categoria) return false;
      if (estado.clasificacion && p.clasificacion !== estado.clasificacion) return false;
      if (estado.max >= 0 && p.precio > estado.max) return false;
      if (q) {
        const texto = (p.nombre + " " + p.descripcion + " " + p.categoria + " " + p.clasificacion).toLowerCase();
        if (!texto.includes(q)) return false;
      }
      return true;
    });
  }

  function pintarChips(cont, lista, sel, fn) {
    cont.innerHTML = lista.map(c => {
      const activa = c === sel;
      return `<button class="chip${activa ? " on" : ""}" data-k="${esc(c)}" type="button">${esc(c)}</button>`;
    }).join("");
    cont.querySelectorAll(".chip").forEach(ch => {
      ch.onclick = () => fn(ch.dataset.k === sel ? "" : ch.dataset.k);
    });
  }

  function renderGrid(lista) {
    const grid = $("mercGrid");
    const count = $("mercCount");
    if (count) {
      count.textContent = lista.length + " producto" + (lista.length === 1 ? "" : "s") + " · " + origen;
      count.className = "badge " + (lista.length ? "acc" : "warn");
    }
    if (!lista.length) {
      grid.innerHTML = `<div class="merc-vacio"><b>Sin coincidencias</b>Prueba con otro filtro o busca otra cosa.</div>`;
      return;
    }
    grid.innerHTML = lista.map(p => {
      const tinte = p.tinte || "#c8f542";
      const cubo = Array.from({ length: 6 }, () => "<i></i>").join("");
      return `<article class="merc-card">
        <div class="merc-tint" style="--tinte:${tinte}">
          <span class="merc-cat">${esc(p.categoria)}</span>
          <div class="merc-cube">${cubo}</div>
        </div>
        <div class="merc-body">
          <div class="merc-nombre">${esc(p.nombre)}</div>
          <div class="merc-badges">
            <span class="merc-badge cat">${esc(p.categoria)}</span>
            <span class="merc-badge">${esc(p.clasificacion)}</span>
          </div>
          <p class="merc-desc">${esc(p.descripcion)}</p>
          <div class="merc-precio">
            <b>${fmtCLP(p.precio)}</b>
            <small>${esc(p.moneda || "CLP")}</small>
            <span class="merc-stock" style="margin-left:auto">${p.stock} un.</span>
          </div>
        </div>
      </article>`;
    }).join("");
  }

  async function render() {
    if (!datos) await cargar();

    const cats = $("mercCats");
    const clas = $("mercClas");
    pintarChips(cats, categorias(), estado.categoria, v => { estado.categoria = v; renderGrid(filtrados()); });
    pintarChips(clas, clasificaciones(), estado.clasificacion, v => { estado.clasificacion = v; renderGrid(filtrados()); });

    const q = $("mercQ");
    if (q && q.value !== estado.q) q.value = estado.q;

    const max = $("mercMax");
    const maxVal = $("mercMaxVal");
    if (max && maxVal) {
      const tope = 500000;
      max.max = tope;
      max.value = estado.max < 0 ? tope : estado.max;
      maxVal.textContent = fmtCLP(estado.max < 0 ? tope : estado.max);
    }

    const nota = $("mercNota");
    if (nota) {
      nota.textContent = origen === "nube"
        ? "Catálogo servido por fabri-api · /api/catalogo."
        : "Sin red o API aún no desplegada: mostrando catálogo local de respaldo.";
    }

    renderGrid(filtrados());
  }

  function init() {
    const q = $("mercQ");
    if (q) q.addEventListener("input", function () { estado.q = q.value; renderGrid(filtrados()); });
    const max = $("mercMax");
    const maxVal = $("mercMaxVal");
    if (max && maxVal) {
      max.addEventListener("input", function () {
        const tope = Number(max.max) || 500000;
        estado.max = Number(max.value) >= tope ? -1 : Number(max.value);
        maxVal.textContent = fmtCLP(Number(max.value));
        renderGrid(filtrados());
      });
    }
  }

  (function enganchar() {
    if (document.readyState !== "loading") init();
    else document.addEventListener("DOMContentLoaded", init);
  })();

  return { render: render };
})();
