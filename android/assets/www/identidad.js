/* ==========================================================================
   MI IDENTIDAD · credencial del operador, negocio, código real y acceso
   --------------------------------------------------------------------------
   Todo vive en la tabla `perfil` de la SQLite local:
     · nombre        → nombre del negocio (marca del acceso y de la boleta)
     · indicativo    → CALL SIGN de la credencial
     · foto          → foto del operador (galería/archivos, reducida en el celu)
     · datos (JSON)  → operador, razón social, RUT, giro, dirección, teléfono,
                       correo, logo e ID de cliente (código de barras Code128)
   La huella no se guarda acá: se enrola con Android Keystore y su token queda
   cifrado en el teléfono. El PIN sigue siendo el respaldo.
   Nada sale del teléfono.
   ========================================================================== */

const IDENT = {
  datos: {},
  nombre: "",
  operador: "",
  indicativo: "",
  foto: "",
  logo: "",
  cargado: false,
  esperas: 0,
  guardando: false,
  sucio: false,
  pinModo: "",
  huellaPendiente: "",
  eventos: false
};

const IDENT_CLAVE = "fabrick.identidad";

/* ── caché local de la identidad ────────────────────────────────────────────
   La boleta y el chat necesitan el nombre y el giro sin abrir esta página.
   La verdad sigue estando en SQLite; esto es sólo una copia para arrancar. */

function idCachear() {
  try {
    localStorage.setItem(IDENT_CLAVE, JSON.stringify({
      nombre: IDENT.nombre || "",
      operador: IDENT.operador || "",
      indicativo: IDENT.indicativo || "",
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
    IDENT.operador = IDENT.datos.operador || "";
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
  // Nombre y apellido: «Fabricio Edmundo Martínez» → FM, no FE.
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/** ID de cliente legible: FAB-XXXX-XXXX, sin caracteres que se confundan. */
function idClienteNuevo() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin I, O, 0, 1
  const bloque = function () {
    const bytes = new Uint8Array(4);
    if (window.crypto && crypto.getRandomValues) {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 4; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    let s = "";
    for (let i = 0; i < 4; i++) s += abc.charAt(bytes[i] % abc.length);
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

function idPintarFoto() {
  const img = idEl("idFotoImg");
  const ini = idEl("idFotoIniciales");
  const estado = idEl("idFotoEstado");
  if (!img || !ini) return;
  if (IDENT.foto) {
    img.src = IDENT.foto;
    img.hidden = false;
    ini.hidden = true;
  } else {
    img.hidden = true;
    img.removeAttribute("src");
    ini.hidden = false;
    const operador = (idEl("idOperador") && idEl("idOperador").value) || IDENT.operador || IDENT.nombre;
    ini.textContent = idIniciales(operador);
  }
  if (estado) {
    estado.textContent = IDENT.foto
      ? "Foto cargada · se reduce en el teléfono antes de guardarse."
      : "Sin foto: se muestran tus iniciales. Puedes subir una de la galería o de Archivos.";
  }
}

function idPintarCredencial() {
  const nombre = ((idEl("idOperador") && idEl("idOperador").value) || IDENT.operador || "").trim()
    || ((idEl("idNombre") && idEl("idNombre").value) || IDENT.nombre || "").trim();
  const indicativo = ((idEl("idIndicativo") && idEl("idIndicativo").value) || IDENT.indicativo || "").trim();
  const rut = ((idEl("idRut") && idEl("idRut").value) || "").trim();
  const cliente = ((idEl("idCliente") && idEl("idCliente").value) || "").trim().toUpperCase();

  const n = idEl("idCredNombre");
  const ind = idEl("idCredIndicativo");
  const rt = idEl("idCredRut");
  const cl = idEl("idCredCliente");
  if (n) n.textContent = nombre || "Sin nombre configurado";
  if (ind) ind.textContent = indicativo || "FC-OPERATOR";
  if (rt) rt.textContent = rut ? "RUT " + rut : "RUT —";
  if (cl) cl.textContent = cliente || "FAB-0000-0000";

  const num = idEl("idBarcodeNum");
  if (num) num.textContent = cliente || "FAB-0000-0000";
  if (window.fabrickBarcodePintar) {
    window.fabrickBarcodePintar(idEl("idBarcode"), cliente || "FORGE CORE STOCK", 34);
  }
  idPintarFoto();
}

function idVolcar(datos) {
  const d = datos || {};
  IDENT.datos = d;
  IDENT.logo = d.logo || "";
  const campos = {
    idNombre: IDENT.nombre || d.nombre_comercial || "",
    idOperador: IDENT.operador || "",
    idIndicativo: IDENT.indicativo || "",
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
  idPintarCredencial();
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
    IDENT.datos = d.datos || {};
    IDENT.operador = IDENT.datos.operador || "";
    IDENT.cargado = true;
    IDENT.sucio = false;
    idVolcar(IDENT.datos);
    idCachear();
    const estado = idEl("idEstadoGuardado");
    if (estado) {
      estado.textContent = d.actualizado
        ? "Guardado · " + new Date(d.actualizado * 1000).toLocaleString("es-CL")
        : "Todavía sin guardar.";
    }
    idPintarSeguridad();
  });
}

/* ── imágenes ───────────────────────────────────────────────────────────── */

/**
 * Reduce una imagen en el teléfono antes de guardarla. Una foto de cámara de
 * 4 MB no tiene por qué entrar en SQLite ni viajar por el puente: a 360 px
 * cuadrados con JPEG 0.84 pesa ~30 KB y se ve nítida en la credencial.
 */
function idProcesarImagen(archivo, opciones) {
  return new Promise(function (resolve, reject) {
    if (!archivo) { reject(new Error("sin archivo")); return; }
    if (!/^image\//.test(archivo.type || "")) {
      reject(new Error("el archivo no es una imagen"));
      return;
    }
    const opt = opciones || {};
    const lado = opt.lado || 320;
    const calidad = opt.calidad || 0.84;
    const cuadrado = !!opt.cuadrado;
    const fondo = opt.fondo || null;
    const lector = new FileReader();
    lector.onerror = function () { reject(new Error("no se pudo leer la imagen")); };
    lector.onload = function () {
      const img = new Image();
      img.onerror = function () { reject(new Error("la imagen no se pudo abrir")); };
      img.onload = function () {
        try {
          let sx = 0;
          let sy = 0;
          let sw = img.width;
          let sh = img.height;
          if (cuadrado) {
            const m = Math.min(img.width, img.height);
            sx = (img.width - m) / 2;
            sy = (img.height - m) / 2;
            sw = m;
            sh = m;
          }
          const escala = Math.min(1, lado / Math.max(sw, sh));
          const w = Math.max(1, Math.round(sw * escala));
          const h = Math.max(1, Math.round(sh * escala));
          const lienzo = document.createElement("canvas");
          lienzo.width = w;
          lienzo.height = h;
          const ctx = lienzo.getContext("2d");
          // Fondo blanco para el logo: un PNG con transparencia se vería
          // negro sobre la tarjeta oscura al convertirlo a JPEG.
          if (fondo) {
            ctx.fillStyle = fondo;
            ctx.fillRect(0, 0, w, h);
          }
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
          resolve(lienzo.toDataURL("image/jpeg", calidad));
        } catch (e) {
          reject(e);
        }
      };
      img.src = String(lector.result || "");
    };
    lector.readAsDataURL(archivo);
  });
}

function idProcesarLogo(archivo) {
  return idProcesarImagen(archivo, { lado: 256, calidad: 0.85, cuadrado: false, fondo: "#ffffff" });
}

function idProcesarFoto(archivo) {
  return idProcesarImagen(archivo, { lado: 360, calidad: 0.84, cuadrado: true });
}

/* ── guardado ───────────────────────────────────────────────────────────── */

function idRecoger() {
  return {
    operador: idEl("idOperador").value.trim().slice(0, 60),
    nombre_comercial: idEl("idNombre").value.trim().slice(0, 60),
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
  if (!IDENT.cargado) {
    toast("La ficha todavía está cargando: espera un momento", "aviso");
    return;
  }
  const nombre = idEl("idNombre").value.trim().slice(0, 60);
  if (!nombre) {
    toast("El nombre del negocio es obligatorio", "error");
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
  const indicativo = idEl("idIndicativo").value.trim().slice(0, 24);
  IDENT.guardando = true;
  const estado = idEl("idEstadoGuardado");
  if (estado) estado.textContent = "Guardando en SQLite…";

  // Una sola llamada: nombre del negocio + ficha completa + foto. La foto va
  // en `perfil.foto`; `borrar_foto` permite quitarla de verdad (sin eso, el
  // núcleo conserva la anterior cuando llega vacío).
  apiTarde("perfil", {
    accion: "guardar",
    nombre: nombre,
    indicativo: indicativo,
    foto: IDENT.foto || "",
    borrar_foto: !IDENT.foto,
    datos: datos
  }, { maxMs: 20000 }).then(function (r) {
    IDENT.guardando = false;
    if (!r.ok) {
      if (estado) estado.textContent = "No se pudo guardar: " + (r.error || "error");
      toast("No se pudo guardar la identidad", "error");
      return;
    }
    IDENT.nombre = nombre;
    IDENT.operador = datos.operador;
    IDENT.indicativo = indicativo;
    IDENT.datos = datos;
    IDENT.sucio = false;
    idCachear();
    if (estado) {
      estado.textContent = "Guardado · " + new Date().toLocaleTimeString("es-CL")
        + " · " + (r.data && r.data.bytes_foto ? Math.round(r.data.bytes_foto / 1024) + " KB de foto" : "sin foto");
    }
    idPintarCredencial();
    idAplicarEnLogin();
    revision("identidad", "info", "identidad del negocio guardada",
      (datos.operador || nombre) + " · " + (datos.id_cliente || "sin ID"), 0, "perfil");
    toast("Identidad guardada");
  });
}

/** Refresca la tarjeta del login con la foto, el nombre y el código nuevos. */
function idAplicarEnLogin() {
  try {
    if (window.FabriLogin && typeof window.FabriLogin._perfilCargar === "function") {
      window.FabriLogin._perfilCargar();
    }
  } catch (e) {
    /* el login se repinta solo al abrirse */
  }
}

/* ── seguridad: PIN + huella ────────────────────────────────────────────── */

function idLeerHuella() {
  try {
    if (!window.FabrickNative || typeof window.FabrickNative.huellaEstado !== "function") {
      return { ok: false, error: "sin APK" };
    }
    return JSON.parse(window.FabrickNative.huellaEstado()) || {};
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Verificador del PIN guardado en SQLite (respaldo si se borraron prefs). */
function idVerificadorDb() {
  if (typeof nucleoPreparado === "function" && !nucleoPreparado()) return null;
  try {
    const r = api("usuarios", { accion: "verificador", usuario: "operador" });
    if (!r.ok) return null;
    const d = r.data || {};
    return d.existe && d.sal && d.hash ? d : null;
  } catch (e) {
    return null;
  }
}

/** Verifica el PIN actual contra las prefs y, si no hay, contra SQLite. */
function idVerificarPinActual(pin) {
  let r;
  try {
    r = JSON.parse(window.FabrickNative.huellaVerificarPin(pin));
  } catch (e) {
    r = { ok: false, error: String(e) };
  }
  if (!r.ok && r.codigo === "SIN_PIN") {
    const v = idVerificadorDb();
    if (v) {
      try {
        r = JSON.parse(window.FabrickNative.huellaVerificarPinExterno(
          pin, v.algoritmo || "", v.sal || "", v.hash || ""));
      } catch (e) {
        r = { ok: false, error: String(e) };
      }
    }
  }
  return r;
}

function idPintarSeguridad() {
  const chip = idEl("idSegChip");
  const pinTexto = idEl("idSegPinTexto");
  const huellaTexto = idEl("idSegHuellaTexto");
  const pinIcono = idEl("idSegPinIcono");
  const huellaIcono = idEl("idSegHuellaIcono");
  const btnPin = idEl("btnIdCambiarPin");
  const btnActivar = idEl("btnIdActivarHuella");
  const btnDesactivar = idEl("btnIdDesactivarHuella");
  const nota = idEl("idSegNota");
  if (!pinTexto || !huellaTexto) return;

  const st = idLeerHuella();
  if (!st.ok) {
    if (chip) { chip.textContent = "NO DISPONIBLE"; chip.className = "id-seg-chip apagado"; }
    pinTexto.textContent = "El acceso seguro sólo funciona dentro de la APK.";
    huellaTexto.textContent = "Sin puente con Android.";
    if (btnPin) btnPin.hidden = true;
    if (btnActivar) btnActivar.hidden = true;
    if (btnDesactivar) btnDesactivar.hidden = true;
    if (nota) nota.textContent = st.error || "";
    return;
  }

  const sdkOk = !st.sdk || st.sdk >= 28;
  const dbVerif = !st.pinConfigurado ? idVerificadorDb() : null;
  const pinOk = !!st.pinConfigurado || !!dbVerif;
  const activa = !!st.huellaActiva;

  if (pinIcono) pinIcono.textContent = pinOk ? "••••" : "＋";
  if (huellaIcono) huellaIcono.textContent = activa ? "◉" : "○";

  pinTexto.textContent = pinOk
    ? (st.pinConfigurado
      ? "Configurado · es el respaldo si la huella falla."
      : "Configurado en la base · escribe el actual para reconfigurarlo.")
    : "Sin PIN: créalo para proteger el acceso y habilitar la huella.";

  if (activa) {
    huellaTexto.textContent = "Activa · token cifrado en el Android Keystore.";
  } else if (!st.huellaDisponible) {
    huellaTexto.textContent = "Este teléfono no tiene una huella enrolada en el sistema.";
  } else if (!sdkOk) {
    huellaTexto.textContent = "Este Android (" + st.sdk + ") no permite huella con clave segura.";
  } else if (!pinOk) {
    huellaTexto.textContent = "Disponible: primero crea el PIN.";
  } else {
    huellaTexto.textContent = "Disponible: actívala confirmando tu huella.";
  }

  if (chip) {
    chip.textContent = activa ? "HUELLA ACTIVA" : (pinOk ? "PIN ACTIVO" : "SIN PROTECCIÓN");
    chip.className = "id-seg-chip" + (activa ? " activo" : (pinOk ? "" : " apagado"));
  }
  if (btnPin) {
    btnPin.hidden = false;
    btnPin.textContent = pinOk ? "Cambiar PIN" : "Crear PIN";
  }
  if (btnActivar) btnActivar.hidden = !(pinOk && st.huellaDisponible && sdkOk && !activa);
  if (btnDesactivar) btnDesactivar.hidden = !activa;
  if (nota) {
    nota.textContent = activa
      ? "Si enrolas una huella nueva en el sistema, la clave se invalida: vuelve a activarla acá."
      : "La huella desbloquea una llave AES del Keystore; no se guarda ninguna imagen de tu huella.";
  }
}

function idAbrirFormPin(modo) {
  IDENT.pinModo = modo === "cambiar" ? "cambiar" : "crear";
  const form = idEl("idSegFormPin");
  const titulo = idEl("idSegFormPinTitulo");
  const actual = idEl("idPinActual");
  const nuevo = idEl("idPinNuevo");
  const nuevo2 = idEl("idPinNuevo2");
  if (titulo) {
    titulo.textContent = IDENT.pinModo === "cambiar" ? "Cambiar el PIN de acceso" : "Crear el PIN de acceso";
  }
  if (actual) {
    actual.hidden = IDENT.pinModo !== "cambiar";
    actual.value = "";
  }
  if (nuevo) nuevo.value = "";
  if (nuevo2) nuevo2.value = "";
  if (form) form.hidden = false;
  if (actual && IDENT.pinModo === "cambiar") {
    setTimeout(function () { actual.focus(); }, 80);
  } else if (nuevo) {
    setTimeout(function () { nuevo.focus(); }, 80);
  }
}

function idCerrarFormPin() {
  const form = idEl("idSegFormPin");
  if (form) form.hidden = true;
  const actual = idEl("idPinActual");
  const nuevo = idEl("idPinNuevo");
  const nuevo2 = idEl("idPinNuevo2");
  if (actual) actual.value = "";
  if (nuevo) nuevo.value = "";
  if (nuevo2) nuevo2.value = "";
  IDENT.pinModo = "";
}

function idGuardarPin() {
  if (!window.FabrickNative) {
    toast("El PIN sólo se configura dentro de la APK", "error");
    return;
  }
  const nuevo = idEl("idPinNuevo").value.trim();
  const nuevo2 = idEl("idPinNuevo2").value.trim();
  if (!/^\d{4,6}$/.test(nuevo)) {
    toast("El PIN debe tener de 4 a 6 dígitos", "error");
    idEl("idPinNuevo").focus();
    return;
  }
  if (nuevo !== nuevo2) {
    toast("Los dos PIN no coinciden", "error");
    idEl("idPinNuevo2").focus();
    return;
  }
  if (IDENT.pinModo === "cambiar") {
    const actual = idEl("idPinActual").value.trim();
    if (!/^\d{4,6}$/.test(actual)) {
      toast("Escribe tu PIN actual", "error");
      idEl("idPinActual").focus();
      return;
    }
    const v = idVerificarPinActual(actual);
    if (!v.ok) {
      toast(v.error || "PIN actual incorrecto", "error");
      idEl("idPinActual").value = "";
      idEl("idPinActual").focus();
      revision("identidad", "error", "PIN actual rechazado al cambiarlo",
        "codigo=" + (v.codigo || "?"), 0, "huella");
      return;
    }
  }

  let r;
  try {
    r = JSON.parse(window.FabrickNative.huellaConfigurarPin(nuevo));
  } catch (e) {
    r = { ok: false, error: String(e) };
  }
  if (!r.ok) {
    toast(r.error || "No se pudo guardar el PIN", "error");
    revision("identidad", "error", "no se pudo configurar el PIN",
      "codigo=" + (r.codigo || "?"), 0, "huella");
    return;
  }

  // Respaldo en SQLite: el mismo verificador PBKDF2 que usa el login. Si el
  // núcleo está ocupado, el PIN igual quedó en las preferencias del teléfono.
  try {
    const g = api("usuarios", {
      accion: "crear",
      usuario: "operador",
      nombre: IDENT.operador || IDENT.nombre || "Operador",
      indicativo: IDENT.indicativo || "",
      foto: IDENT.foto || "",
      rol: "propietario",
      algoritmo: r.algoritmo || "",
      sal: r.sal || "",
      hash: r.hash || "",
      iteraciones: r.iteraciones || 0
    });
    if (!g.ok) {
      revision("identidad", "aviso", "el PIN no se pudo respaldar en usuarios",
        String(g.error || ""), 0, "core");
    }
  } catch (e) {
    revision("identidad", "aviso", "el PIN no se pudo respaldar en usuarios", String(e), 0, "core");
  }

  const eraCreacion = IDENT.pinModo === "crear";
  idCerrarFormPin();
  idPintarSeguridad();
  idAplicarEnLogin();
  toast(eraCreacion ? "PIN creado" : "PIN actualizado");
  revision("identidad", "info", "PIN de acceso configurado desde Mi identidad");
}

function idActivarHuella() {
  if (!window.FabrickNative) {
    toast("La huella sólo se activa dentro de la APK", "error");
    return;
  }
  const st = idLeerHuella();
  if (!st.ok) {
    toast(st.error || "No se pudo leer el estado de la huella", "error");
    return;
  }
  if (!st.pinConfigurado) {
    // `Huella.activar` exige el PIN en las preferencias del teléfono. Si sólo
    // está en SQLite, se pide el actual y se reconfigura; si no hay ninguno,
    // se crea primero.
    toast("Primero configura el PIN: es el respaldo de la huella", "aviso");
    idAbrirFormPin(idVerificadorDb() ? "cambiar" : "crear");
    return;
  }
  if (!st.huellaDisponible) {
    toast("Este teléfono no tiene una huella enrolada. Actívala en Ajustes del sistema.", "aviso");
    return;
  }
  if (st.sdk && st.sdk < 28) {
    toast("Este Android (" + st.sdk + ") no permite huella con clave segura", "aviso");
    return;
  }
  IDENT.huellaPendiente = "activar";
  const nota = idEl("idSegNota");
  if (nota) nota.textContent = "Confirma tu huella en el lector para activar el acceso…";
  let r;
  try {
    r = JSON.parse(window.FabrickNative.huellaActivar());
  } catch (e) {
    r = { ok: false, error: String(e) };
  }
  if (!r.ok) {
    IDENT.huellaPendiente = "";
    idPintarSeguridad();
    toast(r.error || "No se pudo activar la huella", "error");
    revision("identidad", "error", "activación de huella fallida",
      "codigo=" + (r.codigo || "?"), 0, "huella");
  }
}

function idDesactivarHuella() {
  if (!window.FabrickNative) return;
  if (typeof window.FabrickNative.huellaDesactivar !== "function") {
    toast("Esta versión de la APK no permite desactivar sólo la huella", "error");
    return;
  }
  const seguro = window.confirm(
    "¿Desactivar la huella de FORGE CORE STOCK?\n\n"
    + "El PIN sigue funcionando y no se borra ningún dato. "
    + "Para volver a usarla tendrás que activarla otra vez."
  );
  if (!seguro) return;
  let r;
  try {
    r = JSON.parse(window.FabrickNative.huellaDesactivar());
  } catch (e) {
    r = { ok: false, error: String(e) };
  }
  if (!r.ok) {
    toast(r.error || "No se pudo desactivar la huella", "error");
    return;
  }
  idPintarSeguridad();
  idAplicarEnLogin();
  toast("Huella desactivada · el PIN sigue activo");
  revision("identidad", "aviso", "huella desactivada desde Mi identidad");
}

/** Resultado que llega desde Java. Devuelve true si era una operación de ID. */
function idHuellaResultado(r) {
  if (!IDENT.huellaPendiente) return false;
  const era = IDENT.huellaPendiente;
  IDENT.huellaPendiente = "";
  if (r && r.ok) {
    toast(era === "activar" ? "Huella activada" : "Huella verificada");
    revision("identidad", "info",
      era === "activar" ? "huella activada desde Mi identidad" : "huella verificada",
      "", 0, "huella");
  } else {
    toast((r && r.error) || "No se pudo completar la huella", "error");
    revision("identidad", "error", "huella: " + ((r && r.error) || ""),
      "codigo=" + ((r && r.codigo) || "?"), 0, "huella");
  }
  idPintarSeguridad();
  idAplicarEnLogin();
  return true;
}

/* ── eventos ────────────────────────────────────────────────────────────── */

function idConectarEventos() {
  if (IDENT.eventos) return;

  /* Foto del operador */
  const archivoFoto = idEl("idArchivoFoto");
  const elegirFoto = idEl("btnIdFotoElegir");
  const quitarFoto = idEl("btnIdFotoQuitar");
  const cajaFoto = idEl("idFotoCaja");
  function abrirFoto() {
    if (!archivoFoto) return;
    archivoFoto.value = "";
    archivoFoto.click();
  }
  if (elegirFoto) elegirFoto.addEventListener("click", abrirFoto);
  if (cajaFoto) {
    cajaFoto.addEventListener("click", function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest("button")) return;
      abrirFoto();
    });
    cajaFoto.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        abrirFoto();
      }
    });
  }
  if (archivoFoto) {
    archivoFoto.addEventListener("change", function () {
      const f = (archivoFoto.files || [])[0];
      archivoFoto.value = "";
      if (!f) return;
      idProcesarFoto(f).then(function (dataUrl) {
        if (dataUrl.length > 900000) {
          toast("La foto queda muy pesada incluso reducida", "error");
          return;
        }
        IDENT.foto = dataUrl;
        IDENT.sucio = true;
        idPintarCredencial();
        toast("Foto lista · pulsa «Guardar identidad»");
      }).catch(function (e) {
        toast("No se pudo usar la foto: " + (e && e.message ? e.message : e), "error");
      });
    });
  }
  if (quitarFoto) {
    quitarFoto.addEventListener("click", function () {
      if (!IDENT.foto) { toast("No hay foto cargada", "aviso"); return; }
      IDENT.foto = "";
      IDENT.sucio = true;
      idPintarCredencial();
      toast("Foto quitada · pulsa «Guardar identidad»");
    });
  }

  /* Logo del negocio */
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
        idPintarCredencial();
        const estado = idEl("idLogoEstado");
        if (estado) estado.textContent = "Logo listo · pulsa «Guardar identidad».";
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
      const estado = idEl("idLogoEstado");
      if (estado) estado.textContent = "Logo quitado · pulsa «Guardar identidad».";
      toast("Logo quitado · pulsa «Guardar identidad»");
    });
  }

  /* ID de cliente / código de barras */
  const nuevo = idEl("btnIdClienteNuevo");
  if (nuevo) {
    nuevo.addEventListener("click", function () {
      idEl("idCliente").value = idClienteNuevo();
      IDENT.sucio = true;
      idPintarCredencial();
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

  /* Guardar / descartar */
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

  /* Seguridad */
  const btnPin = idEl("btnIdCambiarPin");
  if (btnPin) {
    btnPin.addEventListener("click", function () {
      const st = idLeerHuella();
      const pinOk = !!st.pinConfigurado || !!idVerificadorDb();
      idAbrirFormPin(pinOk ? "cambiar" : "crear");
    });
  }
  const btnPinGuardar = idEl("btnIdPinGuardar");
  if (btnPinGuardar) btnPinGuardar.addEventListener("click", idGuardarPin);
  const btnPinCancelar = idEl("btnIdPinCancelar");
  if (btnPinCancelar) btnPinCancelar.addEventListener("click", idCerrarFormPin);
  const btnActivar = idEl("btnIdActivarHuella");
  if (btnActivar) btnActivar.addEventListener("click", idActivarHuella);
  const btnDesactivar = idEl("btnIdDesactivarHuella");
  if (btnDesactivar) btnDesactivar.addEventListener("click", idDesactivarHuella);

  /* La credencial se actualiza mientras se escribe, sin consultar al núcleo. */
  ["idNombre", "idOperador", "idIndicativo", "idRazon", "idRut", "idCliente"].forEach(function (id) {
    const el = idEl(id);
    if (!el) return;
    el.addEventListener("input", function () {
      IDENT.sucio = true;
      if (id === "idRut") {
        const f = idRutFormateado(el.value);
        if (f !== el.value) el.value = f;
      }
      if (id === "idCliente") {
        const v = el.value.toUpperCase();
        if (v !== el.value) el.value = v;
      }
      idPintarCredencial();
    });
  });

  // Sólo se marca como conectado al final: si algo faltara a mitad de camino,
  // una segunda llamada puede terminar de enganchar lo que quedó pendiente.
  IDENT.eventos = true;
}

/* app.js intenta conectar estos eventos durante su propio arranque, cuando
   `identidad.js` todavía no se ha evaluado: sin esta llamada la página se
   pinta pero ningún botón responde. El script va al final del <body>, así que
   el DOM de la vista ya existe. */
try {
  idConectarEventos();
} catch (e) {
  // La vista se pinta igual; `idIniciar` reintenta al abrirla.
}

window.FabriIdentidad = {
  huellaPendiente: function () { return !!IDENT.huellaPendiente; },
  huellaResultado: idHuellaResultado,
  recargar: idCargar,
  pintar: idPintarCredencial
};
