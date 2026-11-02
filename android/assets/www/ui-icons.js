/* ==========================================================================
   FORGE CORE STOCK · Iconos de navegación y barra flotante
   --------------------------------------------------------------------------
   Reemplaza los glifos de texto (◉ ▦ ✦) por SVG reales estilo Lucide
   (24×24, trazo 1.7, currentColor). No toca la lógica: sólo pinta dentro de
   los mismos botones `data-vista`, así la navegación sigue igual.
   ========================================================================== */

const UI_ICONOS = {
  inicio: '<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 21v-9h6v9"/>',
  id: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M15 9h4M15 13h4M7 16h10"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  inventario: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  impuestos: '<path d="M19 5 5 19"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
  contabilidad: '<path d="M4 21V7l8-4 8 4v14"/><path d="M9 21v-6h6v6"/><path d="M8 11h.01M12 11h.01M16 11h.01"/>',
  catalogo: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  flujo: '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
  modulos: '<path d="m12 2 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  consola: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
  revision: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
  diag: '<path d="M3 12h3l2-6 4 12 2-6h7"/>',
  integracion: '<path d="M9 7V3M15 7V3"/><path d="M7 7h10v3a5 5 0 0 1-10 0z"/><path d="M12 15v6"/>',
  modelos: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  termux: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m6 9 3 3-3 3M13 15h5"/>',
  repo: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 8.5v7M8.5 18h5a4 4 0 0 0 4-4V10.5"/>',
  sql: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/>',
  conexiones: '<path d="M9 15l6-6"/><path d="M11 6l1-1a4 4 0 0 1 6 6l-1 1"/><path d="M13 18l-1 1a4 4 0 0 1-6-6l1-1"/>',
  componentes: '<path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/>',
  error: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="3" y1="12" x2="21" y2="12"/>'
};

function uiIcono(nombre, tam) {
  const d = UI_ICONOS[nombre] || UI_ICONOS.componentes;
  const t = tam || 22;
  return '<svg viewBox="0 0 24 24" width="' + t + '" height="' + t +
    '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
}

/** Sustituye el glifo del botón por el SVG que corresponde a su vista. */
function uiPintarNav() {
  document.querySelectorAll(".nav-drawer[data-vista]").forEach(function (b) {
    const ico = b.querySelector("span");
    const vista = b.dataset.vista;
    if (!ico || ico.dataset.svg) return;
    ico.innerHTML = uiIcono(vista, 20);
    ico.dataset.svg = "1";
    ico.classList.add("nav-ico");
  });
  document.querySelectorAll(".bottomnav .nav[data-vista]").forEach(function (b) {
    const ico = b.querySelector(".nav-ico");
    if (ico && !ico.dataset.svg) {
      ico.innerHTML = uiIcono(b.dataset.vista, 22);
      ico.dataset.svg = "1";
    }
  });
  const fab = document.querySelector("#btnNavFab .nav-fab-ico");
  if (fab && !fab.dataset.svg) {
    fab.innerHTML = uiIcono("scan", 26);
    fab.dataset.svg = "1";
  }
}

/* ── barra flotante: el botón central abre el escáner ──────────────────── */
function uiFabAccion() {
  if (typeof navegar !== "function") return;
  navegar("inventario");
  setTimeout(function () {
    try { if (typeof invPaso === "function") invPaso(2); } catch (e) {}
    const barra = document.getElementById("invScanBarCodigo");
    if (barra) setTimeout(function () { barra.focus(); }, 420);
  }, 320);
}

(function uiMontar() {
  document.addEventListener("click", function (ev) {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    if (t.closest("#btnNavFab")) {
      ev.preventDefault();
      uiFabAccion();
    }
  });

  // Con el menú abierto, la barra inferior se difumina y se corre.
  const drawer = document.getElementById("drawer");
  if (!document.querySelector(".drawer-luz")) {
    const luz = document.createElement("div");
    luz.className = "drawer-luz";
    luz.setAttribute("aria-hidden", "true");
    // Fuera del drawer: dentro lo recortaba su padding/scroll.
    document.body.appendChild(luz);
  }
  if (drawer && window.MutationObserver) {
    new MutationObserver(function () {
      document.body.classList.toggle("menu-abierto", !drawer.hidden);
    }).observe(drawer, { attributes: true, attributeFilter: ["hidden"] });
  }

  const arrancar = function () { uiPintarNav(); };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", arrancar);
  } else {
    arrancar();
  }
  setTimeout(arrancar, 600);
})();
