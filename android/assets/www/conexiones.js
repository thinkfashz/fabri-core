/* ==========================================================================
   FORGE CORE STOCK · conexiones (Criotokey)
   --------------------------------------------------------------------------
   Tres caminos, todos reales:
     1. Token pegado por el usuario  → se prueba contra la API del proveedor.
     2. OAuth con PKCE               → navegador + Client ID propio del usuario.
     3. Respaldo de la base local    → JSON en Descargas, con autorización.

   Lo que NO se hace: inventar client IDs, endpoints, scopes ni credenciales.
   Los tokens viven cifrados en Android Keystore y nunca vuelven completos a
   esta página.
   ========================================================================== */

"use strict";

const conexiones = {
  proveedores: [],
  guardadas: [],
  seleccion: null,
  codigoActual: "",
  oauthPendiente: null,
  ultimoOauth: null,
  googleTimer: null
};

const AYUDA_PROVEEDOR = {
  github: "Token en github.com/settings/tokens. Para repos privados marca el permiso «repo».",
  vercel: "Token en vercel.com/account/tokens. La prueba consulta /v2/user.",
  cloudflare: "API Token en dash.cloudflare.com/profile/api-tokens. Se verifica contra /user/tokens/verify.",
  supabase: "Pega la URL de tu proyecto y una clave (service_role o publishable). Si dejas la URL vacía se prueba la API de administración.",
  firebase: "Necesita la URL de la Realtime Database (https://tu-proyecto.firebaseio.com) y el secreto o un ID token.",
  meta: "Token de usuario desde el Explorador de Graph API. Para publicar en una Page hace falta pages_manage_posts.",
  google: "Token OAuth de Google (por ejemplo del OAuth Playground) con permiso de lectura del perfil.",
  neon: "API key de la consola de Neon. La prueba lista tus proyectos.",
  insforge: "Pega la URL base del servicio y el token que te entregó InsForge.",
  mcp: "URL del servidor MCP (suele terminar en /mcp) y su token. La prueba hace el handshake «initialize» y muestra el nombre y la versión del servidor.",
  custom: "Cualquier API HTTPS que use «Authorization: Bearer …». Escribe su URL."
};

/* ------------------------------------------------------------------ arranque */

function conexionesIniciar() {
  conexionesCargarCatalogo();
  conexionesCargarLista();
  conexionesPintarEstado();
  conexionesRevisarOauth();
}

function conexionesCargarCatalogo() {
  const sel = document.getElementById("conxProveedor");
  if (!sel) return;
  let r;
  try {
    r = JSON.parse(window.FabrickNative.conexionesCatalogo());
  } catch (e) {
    r = { proveedores: [] };
  }
  conexiones.proveedores = r.proveedores || [];
  if (!conexiones.proveedores.length) {
    sel.innerHTML = `<option value="custom">Otro servicio HTTPS</option>`;
    return;
  }
  sel.innerHTML = conexiones.proveedores
    .map((p) => `<option value="${esc(p.id)}">${esc(p.nombre)} · ${esc(p.grupo)}</option>`)
    .join("");
  conexionesActualizarAyuda();
}

function conexionesActualizarAyuda() {
  const sel = document.getElementById("conxProveedor");
  const ayuda = document.getElementById("conxAyuda");
  const campoUrl = document.getElementById("conxUrlCampo");
  const url = document.getElementById("conxUrl");
  if (!sel) return;
  const p = conexiones.proveedores.find((x) => x.id === sel.value) || {};
  if (ayuda) ayuda.textContent = AYUDA_PROVEEDOR[sel.value] || "Elige un servicio para ver qué necesita.";
  if (campoUrl) campoUrl.hidden = !p.pideUrl;
  if (url) url.placeholder = p.pideUrl ? "https://…" : "opcional";
  const nombre = document.getElementById("conxNombre");
  if (nombre && !nombre.value) nombre.placeholder = p.nombre ? `Mi cuenta de ${p.nombre}` : "Mi cuenta";
}

function conexionesPintarEstado() {
  const cont = document.getElementById("conxEstado");
  if (!cont) return;
  let e = {};
  try {
    e = JSON.parse(window.FabrickNative.conexionesEstado());
  } catch (err) {
    e = { ok: false, error: String(err) };
  }
  const abierta = e.ok !== false;
  cont.innerHTML = `
    <div class="sql-dato">
      <span class="sql-dato-etq">Bóveda</span>
      <strong>${abierta ? "cifrada" : "con problemas"}</strong>
    </div>
    <div class="sql-dato">
      <span class="sql-dato-etq">Cuentas</span>
      <strong>${e.total == null ? "—" : e.total}</strong>
    </div>
    <div class="sql-dato">
      <span class="sql-dato-etq">Archivo</span>
      <strong>${e.bytes == null ? "—" : bytes(e.bytes)}</strong>
    </div>
    <div class="sql-dato destacado">
      <span class="sql-dato-etq">Retorno OAuth</span>
      <strong>${esc(e.redireccion || "fabrickcore://oauth")}</strong>
    </div>`;
}

/* --------------------------------------------------------------------- lista */

function conexionesCargarLista() {
  const cont = document.getElementById("conxLista");
  const cuenta = document.getElementById("conxCuenta");
  let r;
  try {
    r = JSON.parse(window.FabrickNative.conexionesListar());
  } catch (e) {
    r = { ok: false, error: String(e) };
  }
  if (!r.ok) {
    if (cont) cont.innerHTML = `<div class="sql-error">${esc(r.error || "no se pudo abrir la bóveda")}</div>`;
    return;
  }
  conexiones.guardadas = r.conexiones || [];
  if (cuenta) cuenta.textContent = String(conexiones.guardadas.length);
  conexionesPintarLista();
  conexionesPintarSelectorCodigo();
}

function conexionesPintarLista() {
  const cont = document.getElementById("conxLista");
  if (!cont) return;
  if (!conexiones.guardadas.length) {
    cont.innerHTML = `<p class="nota">Todavía no hay conexiones. Conecta la primera arriba.</p>`;
    return;
  }
  cont.innerHTML = conexiones.guardadas.map((c) => {
    const proveedor = conexiones.proveedores.find((p) => p.id === c.proveedor);
    const nombre = c.nombre || (proveedor ? proveedor.nombre : c.proveedor);
    const sub = [
      proveedor ? proveedor.nombre : c.proveedor,
      c.url || "",
      c.actualizado ? "guardada " + fechaHora(c.actualizado) : ""
    ].filter(Boolean).join(" · ");
    return `
      <article class="conx-item" data-conx="${esc(c.id)}">
        <div class="conx-item-cab">
          <div>
            <div class="conx-item-nombre">${esc(nombre)}</div>
            <div class="conx-item-sub">${esc(sub)}</div>
          </div>
          <span class="conx-pill" data-pill="${esc(c.id)}">${c.tieneToken ? "guardada" : "sin token"}</span>
        </div>
        ${c.cuenta ? `<div class="conx-item-sub">Cuenta: ${esc(c.cuenta)}</div>` : ""}
        <div class="conx-token">${esc(c.token || "sin token")}</div>
        <div class="conx-item-acciones">
          <button class="btn" type="button" data-probar="${esc(c.id)}">Probar</button>
          <button class="btn" type="button" data-codigo="${esc(c.id)}">Código</button>
          <button class="btn btn-peligro" type="button" data-borrar="${esc(c.id)}">Borrar</button>
        </div>
        <div class="conx-detalle" data-detalle="${esc(c.id)}" hidden></div>
      </article>`;
  }).join("");
}

function conexionesPintarSelectorCodigo() {
  const sel = document.getElementById("conxCodigoSel");
  if (!sel) return;
  if (!conexiones.guardadas.length) {
    sel.innerHTML = `<option value="">— sin conexiones —</option>`;
    return;
  }
  sel.innerHTML = conexiones.guardadas.map((c) => {
    const p = conexiones.proveedores.find((x) => x.id === c.proveedor);
    return `<option value="${esc(c.id)}">${esc(c.nombre || (p ? p.nombre : c.proveedor))}</option>`;
  }).join("");
}

/* ------------------------------------------------------------------- guardar */

function conexionGuardar() {
  const proveedor = document.getElementById("conxProveedor").value;
  const nombre = document.getElementById("conxNombre").value.trim();
  const token = document.getElementById("conxToken").value.trim();
  const url = document.getElementById("conxUrl").value.trim();
  const mensaje = document.getElementById("conxMensaje");
  const p = conexiones.proveedores.find((x) => x.id === proveedor) || {};

  if (!token) {
    if (mensaje) mensaje.textContent = "Pega el token del servicio para poder probarlo.";
    toast("Falta el token", "error");
    return;
  }
  if (p.pideUrl && !url) {
    if (mensaje) mensaje.textContent = "Este servicio necesita su URL (https://…).";
    toast("Falta la URL del servicio", "error");
    return;
  }
  if (url && !/^https:\/\//i.test(url)) {
    if (mensaje) mensaje.textContent = "La URL tiene que empezar con https://";
    toast("URL no permitida", "error");
    return;
  }

  let r;
  try {
    r = JSON.parse(window.FabrickNative.conexionGuardar(proveedor, nombre, token, url));
  } catch (e) {
    r = { ok: false, error: String(e) };
  }
  if (!r.ok) {
    if (mensaje) mensaje.textContent = r.error || "no se pudo guardar";
    toast("No se guardó: " + (r.error || "error"), "error");
    return;
  }

  document.getElementById("conxToken").value = "";
  if (mensaje) {
    mensaje.textContent = `Guardada cifrada. Probando la conexión…`;
  }
  toast("Conexión guardada");
  conexionesCargarLista();
  conexionesPintarEstado();
  if (r.id) conexionesProbar(r.id);
}

/* -------------------------------------------------------------------- probar */

function conexionesProbar(id) {
  const detalle = document.querySelector(`[data-detalle="${id}"]`);
  const pill = document.querySelector(`[data-pill="${id}"]`);
  if (detalle) {
    detalle.hidden = false;
    detalle.className = "conx-detalle";
    detalle.textContent = "Probando contra el proveedor…";
  }
  if (pill) {
    pill.className = "conx-pill probando";
    pill.textContent = "probando";
  }
  let r;
  try {
    r = JSON.parse(window.FabrickNative.conexionProbar(id));
  } catch (e) {
    r = { ok: false, error: String(e) };
  }
  if (!r.ok) {
    if (detalle) {
      detalle.className = "conx-detalle malo";
      detalle.textContent = r.error || "no se pudo probar";
    }
    if (pill) {
      pill.className = "conx-pill malo";
      pill.textContent = "error";
    }
  }
}

function conexionesPintarPrueba(r) {
  const id = r.id;
  const detalle = document.querySelector(`[data-detalle="${id}"]`);
  const pill = document.querySelector(`[data-pill="${id}"]`);
  const ok = !!r.ok;
  if (pill) {
    pill.className = "conx-pill " + (ok ? "ok" : "malo");
    pill.textContent = ok ? "conectada" : "sin conexión";
  }
  if (detalle) {
    detalle.hidden = false;
    detalle.className = "conx-detalle " + (ok ? "ok" : "malo");
    const partes = [];
    if (r.estado) partes.push(r.estado);
    if (r.http) partes.push("HTTP " + r.http);
    if (r.ms) partes.push(r.ms + " ms");
    const cabecera = partes.join(" · ");
    detalle.innerHTML = `<strong>${esc(cabecera)}</strong><br>${esc(r.detalle || "")}`
      + (r.cuenta ? `<br>Cuenta: ${esc(r.cuenta)}` : "");
  }
  if (ok) {
    toast("Conexión verificada" + (r.cuenta ? ": " + r.cuenta : ""));
    const mensaje = document.getElementById("conxMensaje");
    if (mensaje) mensaje.textContent = "Listo: el proveedor respondió. La conexión quedó guardada.";
    conexionesCargarLista();
  } else {
    toast("El proveedor rechazó la prueba: " + (r.detalle || r.estado || "error"), "error");
  }
}

/* -------------------------------------------------------------------- código */

function conexionesVerCodigo() {
  const sel = document.getElementById("conxCodigoSel");
  const salida = document.getElementById("conxCodigoSalida");
  const boton = document.getElementById("btnConxCopiarCodigo");
  if (!sel || !sel.value) {
    toast("No hay conexiones guardadas", "error");
    return;
  }
  let r;
  try {
    r = JSON.parse(window.FabrickNative.conexionCodigo(sel.value));
  } catch (e) {
    r = { ok: false, error: String(e) };
  }
  if (!r.ok) {
    toast("No se pudo generar: " + (r.error || "error"), "error");
    return;
  }
  conexiones.codigoActual = (r.javascript || "") + "\n# equivalente en curl\n" + (r.curl || "");
  if (salida) {
    salida.hidden = false;
    salida.textContent = conexiones.codigoActual;
  }
  if (boton) boton.disabled = false;
}

/* --------------------------------------------------------------------- OAuth */

function conexionesOauth() {
  const proveedor = document.getElementById("conxOauthProveedor").value;
  const clientId = document.getElementById("conxOauthClientId").value.trim();
  const mensaje = document.getElementById("conxOauthMensaje");
  if (!clientId) {
    if (mensaje) mensaje.textContent = "Falta el Client ID de tu app en " + proveedor + ".";
    toast("Falta el Client ID", "error");
    return;
  }
  let r;
  try {
    r = JSON.parse(window.FabrickNative.conexionOauthIniciar(proveedor, clientId));
  } catch (e) {
    r = { ok: false, error: String(e) };
  }
  if (!r.ok) {
    if (mensaje) mensaje.textContent = r.error || "no se pudo iniciar";
    toast("OAuth: " + (r.error || "error"), "error");
    return;
  }
  conexiones.oauthPendiente = proveedor;
  if (mensaje) {
    mensaje.textContent = "Se abrió el navegador. Autoriza la cuenta y vuelve a la app: "
      + "la conexión se guarda sola.";
  }
  toast("Esperando la autorización en el navegador");
}

function conexionesRevisarOauth() {
  let pend;
  try {
    pend = JSON.parse(window.FabrickNative.conexionOauthPendiente());
  } catch (e) {
    pend = { activo: false };
  }
  const mensaje = document.getElementById("conxOauthMensaje");
  if (pend.activo && mensaje) {
    mensaje.textContent = "Hay una autorización pendiente para " + pend.proveedor
      + ". Termina en el navegador y vuelve a la app.";
    const sel = document.getElementById("conxOauthProveedor");
    if (sel && pend.proveedor) sel.value = pend.proveedor;
    const campo = document.getElementById("conxOauthClientId");
    if (campo && pend.clientId) campo.value = pend.clientId;
  }
  let ultimo;
  try {
    ultimo = JSON.parse(window.FabrickNative.conexionOauthUltimo());
  } catch (e) {
    ultimo = { vacio: true };
  }
  if (ultimo && !ultimo.vacio && !conexiones.ultimoOauth) {
    conexiones.ultimoOauth = ultimo;
    conexionesPintarOauth(ultimo);
  }
}

/* --------------------------------------------------- Google sin redirect */

function conexionesGoogleDevice() {
  const clientId = document.getElementById("conxOauthClientId").value.trim();
  const mensaje = document.getElementById("conxGoogleMensaje");
  if (!clientId) {
    if (mensaje) mensaje.textContent = "Pega el Client ID de un cliente OAuth de tipo «TVs and Limited Input devices».";
    toast("Falta el Client ID", "error");
    return;
  }
  let r;
  try {
    r = JSON.parse(window.FabrickNative.conexionGoogleDeviceIniciar(clientId));
  } catch (e) {
    r = { ok: false, error: String(e) };
  }
  if (!r.ok) {
    if (mensaje) mensaje.textContent = r.error || "no se pudo iniciar";
    toast("Google: " + (r.error || "error"), "error");
    return;
  }
  if (mensaje) {
    mensaje.textContent = `Escribe el código ${r.userCode} en ${r.url} y autoriza. `
      + "Esta pantalla lo detecta sola cuando termines.";
  }
  toast("Código de Google: " + r.userCode);
  conexionesDetenerGoogle();
  const intervalo = Math.max(5, r.intervalo || 5) * 1000;
  const limite = Date.now() + (r.expira || 1800) * 1000;
  conexiones.googleTimer = setInterval(() => conexionesGoogleConsultar(limite), intervalo);
}

function conexionesGoogleConsultar(limite) {
  const mensaje = document.getElementById("conxGoogleMensaje");
  if (Date.now() > limite) {
    conexionesDetenerGoogle();
    if (mensaje) mensaje.textContent = "El código venció. Genera uno nuevo.";
    toast("El código de Google venció", "error");
    return;
  }
  let r;
  try {
    r = JSON.parse(window.FabrickNative.conexionGoogleDeviceConsultar());
  } catch (e) {
    r = { ok: false, error: String(e) };
  }
  if (r.pendiente) {
    if (mensaje) mensaje.textContent = "Esperando que autorices en el navegador…";
    return;
  }
  conexionesDetenerGoogle();
  if (!r.ok) {
    if (mensaje) mensaje.textContent = r.error || "no se completó";
    toast("Google: " + (r.error || "error"), "error");
    return;
  }
  if (mensaje) {
    mensaje.textContent = "Listo: cuenta de Google conectada"
      + (r.cuenta ? " (" + r.cuenta + ")" : "") + ". Quedó guardada cifrada.";
  }
  toast("Google conectado" + (r.cuenta ? ": " + r.cuenta : ""));
  conexionesCargarLista();
  conexionesPintarEstado();
}

function conexionesDetenerGoogle() {
  if (conexiones.googleTimer) {
    clearInterval(conexiones.googleTimer);
    conexiones.googleTimer = null;
  }
}

function conexionesCancelarGoogle() {
  conexionesDetenerGoogle();
  try { window.FabrickNative.conexionGoogleDeviceCancelar(); } catch (e) { /* nada */ }
  const mensaje = document.getElementById("conxGoogleMensaje");
  if (mensaje) mensaje.textContent = "Autorización de Google detenida.";
}

function conexionesPintarOauth(r) {
  const mensaje = document.getElementById("conxOauthMensaje");
  if (r.ok) {
    if (mensaje) {
      mensaje.textContent = "Cuenta conectada"
        + (r.cuenta ? ": " + r.cuenta : "")
        + ". La sesión quedó guardada cifrada.";
    }
    toast("Cuenta conectada" + (r.cuenta ? ": " + r.cuenta : ""));
    conexionesCargarLista();
    conexionesPintarEstado();
  } else {
    if (mensaje) mensaje.textContent = "No se completó: " + (r.error || "error");
    toast("OAuth: " + (r.error || "error"), "error");
  }
}

/* ------------------------------------------------------------------- respaldo */

async function conexionesRespaldarDatos() {
  if (!window.confirm("¿Guardar un respaldo de toda tu base local en Descargas?\n\n"
      + "El archivo queda dentro de la carpeta privada de la app y no sale del teléfono.")) {
    return;
  }
  const rt = await apiTarde("sqlite", { accion: "tablas" }, { maxMs: 20000 });
  if (!rt.ok) {
    toast("No se pudo leer la base: " + (rt.error || "error"), "error");
    return;
  }
  const tablas = (rt.data && rt.data.tablas) || [];
  const doc = {
    tipo: "fabrick-respaldo",
    version: 1,
    generado: Math.floor(Date.now() / 1000),
    sqlite: rt.data.version,
    tablas: {}
  };
  let filas = 0;
  for (const t of tablas) {
    const r = await apiTarde("sqlite", { accion: "exportar", tabla: t.nombre }, { maxMs: 25000 });
    if (r.ok) {
      doc.tablas[t.nombre] = {
        columnas: (r.data.columnas || []).filter((c) => c !== "_fila"),
        filas: (r.data.filas || []).map((f) => {
          const copia = {};
          Object.keys(f).forEach((k) => { if (k !== "_fila") copia[k] = f[k]; });
          return copia;
        }),
        truncado: !!r.data.truncado
      };
      filas += (r.data.filas || []).length;
    }
  }
  hojaGuardarArchivo(`fabrick-respaldo-${hojaSello()}.json`,
    JSON.stringify(doc, null, 2), `${tablas.length} tabla(s), ${filas} fila(s)`);
}

function conexionesRespaldarConexiones() {
  if (!window.confirm("¿Guardar un respaldo de tus conexiones?\n\n"
      + "Lleva nombres, fechas y el token enmascarado: las claves no pueden salir del "
      + "llavero del teléfono, así que este archivo sirve como registro, no para restaurar.")) {
    return;
  }
  let texto;
  try {
    texto = window.FabrickNative.conexionesRespaldo("0");
  } catch (e) {
    texto = "";
  }
  let doc;
  try {
    doc = JSON.parse(texto);
  } catch (e) {
    toast("No se pudo generar el respaldo", "error");
    return;
  }
  hojaGuardarArchivo(`fabrick-conexiones-${hojaSello()}.json`,
    JSON.stringify(doc, null, 2), `${(doc.conexiones || []).length} conexión(es)`);
}

/* -------------------------------------------------------------------- borrar */

function conexionBorrar(id) {
  const c = conexiones.guardadas.find((x) => x.id === id);
  const nombre = c ? (c.nombre || c.proveedor) : id;
  if (!window.confirm(`¿Borrar la conexión «${nombre}»?\n\nEl token se elimina de la bóveda.`)) {
    return;
  }
  let r;
  try {
    r = JSON.parse(window.FabrickNative.conexionBorrar(id));
  } catch (e) {
    r = { ok: false, error: String(e) };
  }
  if (!r.ok) {
    toast("No se borró: " + (r.error || "error"), "error");
    return;
  }
  toast("Conexión borrada");
  conexionesCargarLista();
  conexionesPintarEstado();
}

/* --------------------------------------------------- eventos de la página */

document.addEventListener("click", (ev) => {
  const probar = ev.target.closest("[data-probar]");
  if (probar) { conexionesProbar(probar.dataset.probar); return; }

  const codigo = ev.target.closest("[data-codigo]");
  if (codigo) {
    const sel = document.getElementById("conxCodigoSel");
    if (sel) sel.value = codigo.dataset.codigo;
    conexionesVerCodigo();
    return;
  }

  const borrar = ev.target.closest("[data-borrar]");
  if (borrar) { conexionBorrar(borrar.dataset.borrar); return; }
});

document.addEventListener("change", (ev) => {
  if (ev.target.id === "conxProveedor") conexionesActualizarAyuda();
});

document.addEventListener("DOMContentLoaded", () => {
  const mapa = {
    btnConxRefrescar: () => { conexionesIniciar(); toast("Conexiones actualizadas"); },
    btnConxGuardar: conexionGuardar,
    btnConxAbrirToken: () => {
      const sel = document.getElementById("conxProveedor");
      const p = conexiones.proveedores.find((x) => x.id === (sel ? sel.value : ""));
      const url = p && p.tokenEn ? p.tokenEn : "";
      if (!url) {
        toast("Este servicio no tiene una página de tokens: revisa su documentación", "error");
        return;
      }
      let r;
      try {
        r = JSON.parse(window.FabrickNative.abrirNavegadorSeguro(url));
      } catch (e) {
        r = { ok: false, error: String(e) };
      }
      toast(r.ok ? "Abriendo el navegador" : "No se pudo abrir: " + (r.error || "error"),
        r.ok ? "" : "error");
    },
    btnConxOauth: conexionesOauth,
    btnConxGoogleDevice: conexionesGoogleDevice,
    btnConxGoogleDeviceCancelar: conexionesCancelarGoogle,
    btnConxOauthCancelar: () => {
      try { window.FabrickNative.conexionOauthCancelar(); } catch (e) { /* nada */ }
      const mensaje = document.getElementById("conxOauthMensaje");
      if (mensaje) mensaje.textContent = "Autorización cancelada. No se guardó nada.";
      conexiones.oauthPendiente = null;
    },
    btnConxCodigo: conexionesVerCodigo,
    btnConxCopiarCodigo: () => {
      if (!conexiones.codigoActual) return;
      copiar(conexiones.codigoActual, "Código copiado");
    },
    btnConxRespaldoDatos: conexionesRespaldarDatos,
    btnConxRespaldoConexiones: conexionesRespaldarConexiones
  };
  Object.keys(mapa).forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", mapa[id]);
  });
});

/* Callbacks que llegan desde Java (siempre por `window.FabriConexiones`). */
window.FabriConexiones = {
  pruebaInicio: function (id) {
    const detalle = document.querySelector(`[data-detalle="${id}"]`);
    const pill = document.querySelector(`[data-pill="${id}"]`);
    if (detalle) {
      detalle.hidden = false;
      detalle.className = "conx-detalle";
      detalle.textContent = "Probando contra el proveedor…";
    }
    if (pill) {
      pill.className = "conx-pill probando";
      pill.textContent = "probando";
    }
  },
  prueba: function (crudo) {
    let r;
    try {
      r = typeof crudo === "string" ? JSON.parse(crudo) : crudo;
    } catch (e) {
      r = { ok: false, error: String(e) };
    }
    conexionesPintarPrueba(r);
  },
  oauth: function (crudo) {
    let r;
    try {
      r = typeof crudo === "string" ? JSON.parse(crudo) : crudo;
    } catch (e) {
      r = { ok: false, error: String(e) };
    }
    conexiones.ultimoOauth = r;
    conexionesPintarOauth(r);
  }
};
