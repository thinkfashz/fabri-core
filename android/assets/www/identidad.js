/* ==========================================================================
   MI IDENTIDAD · ficha del negocio, logo real e ID de cliente
   --------------------------------------------------------------------------
   Todo se guarda en la tabla `perfil` de la SQLite local:
     · nombre        → nombre comercial (es el que ya usaba el login)
     · foto          → foto del operador (no se toca aquí)
     · datos (JSON)  → razón social, RUT, giro, dirección, teléfono, correo,
                       logo y ID de cliente
   Nada sale del teléfono. La página se pinta con lo que hay en la base y, si
   el núcleo todavía está migrando, espera sin bloquear la interfaz.
   ========================================================================== */

const IDENT = {
  datos: {},
  nombre: "",
  indicativo: "",
  foto: "",
  logo: "",
  cargado: false,
  esperas: 0,
  guardando: false,
  sucio: false
};

/* ── caché local de la identidad ────────────────────────────────────────────
   La boleta y el login necesitan el nombre, el RUT y el logo sin abrir esta
   página. Se guarda una copia en localStorage (una sola, ~30 KB con logo) y se
   refresca cuando el núcleo está listo. La verdad sigue estando en SQLite. */

const IDENT_CLAVE = "fabrick.identidad";

function idCachear() {
  try {
    localStorage.setItem(IDENT_CLAVE, JSON.stringify({
      nombre: IDENT.nombre || "",
      datos: IDENT.datos || {}
    }));
  } catch (e) { /* sin espacio: la app sigue usando SQLite */ }
}

function idDeCache() {
  try {
    const crudo = localStorage.getItem(IDENT_CLAVE);
    return crudo ? JSON.parse(crudo) : {};
  } catch (e) {
    return {};
  }
}

/** Copia la ficha de SQLite a la caché, una vez que el núcleo responde. */
function idSincronizarCache() {
  apiTarde("perfil", { accion: "obtener" }, { maxMs: 15000 }).then(function (r) {
    if (!r.ok) return;
    const d = r.data || {};
    IDENT.nombre = d.nombre || "";
    IDENT.indicativo = d.indicativo || "";
    IDENT.foto = d.foto || "";
    IDENT.datos = d.datos || {};
    IDENT.logo = IDENT.datos.logo || "";
    idCachear();
  });
}

/* ── utilidades ─────────────────────────────────────────────────────────── */

function idEl(id) { return document.getElementById(id); }

function idIniciales(texto) {
  const t = String(texto || "").trim();
  if (!t) return "FC";
  const partes = t.split(/\s+/).filter(Boolean);
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[1][0]).toUpperCase();
}

/** ID de cliente legible: FAB-XXXX-XXXX, sin caracteres que se confundan. */
function idClienteNuevo() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin I, O, 0, 1
  const bloque = function () {
    let s = "";
    for (let i = 0; i < 4; i++) {
      s += abc.charAt(Math.floor(Math.random() * abc.length));
    }
    return s;
  };
  return "FAB-" + bloque() + "-" + bloque();
}

function idRutFormateado(valor) {
  const limpio = String(valor || "").replace(/[^0-9kK]/g, "").toUpperCase();
  if (limpio.length < 2) return limpio;
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  const conPuntos = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return conPuntos + "-" + dv;
}

/* ── pintado ────────────────────────────────────────────────────────────── */

function idPintarTarjeta() {
  const nombre = idEl("idNombre").value.trim() || IDENT.nombre || "";
  const razon = idEl("idRazon").value.trim();
  const rut = idEl("idRut").value.trim();
  const cliente = idEl("idCliente").value.trim();

  const tarjeta = idEl("idTarjeta");
  const img = idEl("idLogoImg");
  const ini = idEl("idLogoIniciales");
  const logo = IDENT.logo;

  if (img && ini) {
    if (logo) {
      img.src = logo;
      img.hidden = false;
      ini.hidden = true;
      if (tarjeta) tarjeta.classList.add("con-logo");
    } else {
      img.hidden = true;
      img.removeAttribute("src");
      ini.hidden = false;
      ini.textContent = idIniciales(nombre);
      if (tarjeta) tarjeta.classList.remove("con-logo");
    }
  }

  const n = idEl("idTarjetaNombre");
  const r = idEl("idTarjetaRazon");
  const rt = idEl("idTarjetaRut");
  const cl = idEl("idTarjetaCliente");
  if (n) n.textContent = nombre || "Sin nombre configurado";
  if (r) r.textContent = razon || "Razón social pendiente";
  if (rt) rt.textContent = rut ? "RUT " + rut : "RUT —";
  if (cl) cl.textContent = cliente || "ID —";

  const estado = idEl("idLogoEstado");
  if (estado) {
    estado.textContent = logo
      ? "Logo cargado · se muestra en la tarjeta de acceso."
      : "Sin logo: se muestran las iniciales del nombre.";
  }
}

function idVolcar(datos) {
  const d = datos || {};
  IDENT.datos = d;
  IDENT.logo = d.logo || "";
  const campos = {
    idNombre: IDENT.nombre || d.nombre_comercial || "",
    idRazon: d.razon_social || "",
    idRut: d.rut || "",
    idGiro: d.giro || "",
    idDireccion: d.direccion || "",
    idTelefono: d.telefono || "",
    idEmail: d.email || "",
    idCliente: d.id_cliente || ""
  };
  Object.keys(campos).forEach(function (id) {
    const el = idEl(id);
    if (el) el.value = campos[id];
  });
  // Si nunca hubo ID de cliente se propone uno; no se guarda hasta pulsar
  // «Guardar identidad», para que el usuario pueda cambiarlo.
  if (!idEl("idCliente").value) {
    idEl("idCliente").value = idClienteNuevo();
    IDENT.sucio = true;
  }
  idPintarTarjeta();
}

/* ── carga ──────────────────────────────────────────────────────────────── */

function idIniciar() {
  // El núcleo puede estar migrando: se espera sin congelar la pantalla.
  if (typeof nucleoPreparado === "function" && !nucleoPreparado()) {
    IDENT.esperas = (IDENT.esperas || 0) + 1;
    const estado = idEl("idEstadoGuardado");
    if (estado) estado.textContent = "El núcleo está iniciando: la ficha aparece en un momento.";
    if (IDENT.esperas < 25) {
      setTimeout(function () {
        if (estadoApp.vista === "id") idIniciar();
      }, 700);
    }
    return;
  }
  IDENT.esperas = 0;
  idCargar();
}

function idCargar() {
  if (IDENT.guardando) return;
  apiTarde("perfil", { accion: "obtener" }).then(function (r) {
    if (!r.ok) {
      const estado = idEl("idEstadoGuardado");
      if (estado) estado.textContent = "No se pudo leer la ficha: " + (r.error || "error");
      return;
    }
    const d = r.data || {};
    IDENT.nombre = d.nombre || "";
    IDENT.indicativo = d.indicativo || "";
    IDENT.foto = d.foto || "";
    IDENT.cargado = true;
    IDENT.sucio = false;
    idVolcar(d.datos || {});
    idCachear();
    const estado = idEl("idEstadoGuardado");
    if (estado) {
      estado.textContent = d.actualizado
        ? "Guardado · " + new Date(d.actualizado * 1000).toLocaleString("es-CL")
        : "Todavía sin guardar.";
    }
  });
}

/* ── logo ───────────────────────────────────────────────────────────────── */

/**
 * Reduce la imagen a 256 px de lado mayor y la devuelve como JPEG.
 * Una foto de cámara de 4 MB no tiene por qué entrar en SQLite ni viajar en
 * cada consulta: a 256 px con calidad 0,85 pesa ~30 KB y se ve nítida en la
 * tarjeta y en la boleta.
 */
function idProcesarLogo(archivo) {
  return new Promise(function (resolve, reject) {
    if (!archivo) { reject(new Error("sin archivo")); return; }
    if (!/^image\//.test(archivo.type || "")) {
      reject(new Error("el archivo no es una imagen"));
      return;
    }
    const lector = new FileReader();
    lector.onerror = function () { reject(new Error("no se pudo leer la imagen")); };
    lector.onload = function () {
      const img = new Image();
      img.onerror = function () { reject(new Error("la imagen no se pudo abrir")); };
      img.onload = function () {
        try {
          const lado = 256;
          const escala = Math.min(1, lado / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * escala));
          const h = Math.max(1, Math.round(img.height * escala));
          const lienzo = document.createElement("canvas");
          lienzo.width = w;
          lienzo.height = h;
          const ctx = lienzo.getContext("2d");
          // Fondo blanco: un PNG con transparencia se vería negro sobre la
          // tarjeta oscura al convertirlo a JPEG.
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(lienzo.toDataURL("image/jpeg", 0.85));
        } catch (e) {
          reject(e);
        }
      };
      img.src = String(lector.result || "");
    };
    lector.readAsDataURL(archivo);
  });
}

/* ── guardado ───────────────────────────────────────────────────────────── */

function idRecoger() {
  return {
    razon_social: idEl("idRazon").value.trim().slice(0, 80),
    rut: idRutFormateado(idEl("idRut").value).slice(0, 14),
    giro: idEl("idGiro").value.trim().slice(0, 80),
    direccion: idEl("idDireccion").value.trim().slice(0, 120),
    telefono: idEl("idTelefono").value.trim().slice(0, 24),
    email: idEl("idEmail").value.trim().slice(0, 80),
    id_cliente: idEl("idCliente").value.trim().toUpperCase().slice(0, 32),
    logo: IDENT.logo || ""
  };
}

function idGuardar() {
  if (IDENT.guardando) return;
  const nombre = idEl("idNombre").value.trim().slice(0, 60);
  if (!nombre) {
    toast("El nombre comercial es obligatorio", "error");
    idEl("idNombre").focus();
    return;
  }
  const datos = idRecoger();
  const email = datos.email;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    toast("El correo no parece válido", "error");
    idEl("idEmail").focus();
    return;
  }
  IDENT.guardando = true;
  const estado = idEl("idEstadoGuardado");
  if (estado) estado.textContent = "Guardando en SQLite…";

  // Una sola llamada: nombre comercial + ficha completa. `guardar` conserva
  // la foto del operador y no la pisa con vacío.
  apiTarde("perfil", {
    accion: "guardar",
    nombre: nombre,
    indicativo: IDENT.indicativo || "",
    foto: "",
    datos: datos
  }, { maxMs: 20000 }).then(function (r) {
    IDENT.guardando = false;
    if (!r.ok) {
      if (estado) estado.textContent = "No se pudo guardar: " + (r.error || "error");
      toast("No se pudo guardar la identidad", "error");
      return;
    }
    IDENT.nombre = nombre;
    IDENT.datos = datos;
    IDENT.sucio = false;
    idCachear();
    if (estado) {
      estado.textContent = "Guardado · " + new Date().toLocaleTimeString("es-CL")
        + " · " + (r.data && r.data.bytes_foto ? "" : "");
    }
    idPintarTarjeta();
    idAplicarEnLogin();
    revision("identidad", "info", "identidad del negocio guardada",
      nombre + " · " + (datos.id_cliente || "sin ID"), 0, "perfil");
    toast("Identidad guardada");
  });
}

/** Refresca la tarjeta del login con el nombre y el logo recién guardados. */
function idAplicarEnLogin() {
  try {
    if (window.FabriLogin && typeof window.FabriLogin._perfilCargar === "function") {
      window.FabriLogin._perfilCargar();
    }
  } catch (e) {
    /* el login se repinta solo al abrirse */
  }
}

/* ── eventos ────────────────────────────────────────────────────────────── */

function idConectarEventos() {
  if (IDENT.eventos) return;
  IDENT.eventos = true;

  const archivo = idEl("idArchivoLogo");
  const elegir = idEl("btnIdLogoElegir");
  if (elegir && archivo) {
    elegir.addEventListener("click", function () { archivo.click(); });
    archivo.addEventListener("change", function () {
      const f = (archivo.files || [])[0];
      archivo.value = "";
      if (!f) return;
      idProcesarLogo(f).then(function (dataUrl) {
        if (dataUrl.length > 900000) {
          toast("La imagen queda muy pesada incluso reducida", "error");
          return;
        }
        IDENT.logo = dataUrl;
        IDENT.sucio = true;
        idPintarTarjeta();
        toast("Logo listo · pulsa «Guardar identidad»");
      }).catch(function (e) {
        toast("No se pudo usar la imagen: " + (e && e.message ? e.message : e), "error");
      });
    });
  }

  const quitar = idEl("btnIdLogoQuitar");
  if (quitar) {
    quitar.addEventListener("click", function () {
      IDENT.logo = "";
      IDENT.sucio = true;
      idPintarTarjeta();
      toast("Logo quitado · pulsa «Guardar identidad»");
    });
  }

  const nuevo = idEl("btnIdClienteNuevo");
  if (nuevo) {
    nuevo.addEventListener("click", function () {
      idEl("idCliente").value = idClienteNuevo();
      IDENT.sucio = true;
      idPintarTarjeta();
    });
  }

  const copiarId = idEl("btnIdCopiar");
  if (copiarId) {
    copiarId.addEventListener("click", function () {
      const v = idEl("idCliente").value.trim();
      if (!v) { toast("Todavía no hay ID de cliente", "error"); return; }
      copiar(v, "ID copiado: " + v);
    });
  }

  const guardar = idEl("btnIdGuardar");
  if (guardar) guardar.addEventListener("click", idGuardar);

  const recargar = idEl("btnIdRecargar");
  if (recargar) {
    recargar.addEventListener("click", function () {
      IDENT.sucio = false;
      idCargar();
      toast("Cambios descartados");
    });
  }

  // La tarjeta se actualiza mientras se escribe, sin consultar al núcleo.
  ["idNombre", "idRazon", "idRut", "idCliente"].forEach(function (id) {
    const el = idEl(id);
    if (!el) return;
    el.addEventListener("input", function () {
      IDENT.sucio = true;
      if (id === "idRut") {
        const f = idRutFormateado(el.value);
        if (f !== el.value) el.value = f;
      }
      idPintarTarjeta();
    });
  });
}
