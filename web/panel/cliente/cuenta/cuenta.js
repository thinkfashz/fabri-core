/* C13 · Cuenta
   Una sola página para identidad, acceso y seguridad. La sesión es la misma
   de la PWA (30 días, token Bearer contra `fabri-api`); entrar acá vale
   también en `/app/`. No hay endpoints de perfil ni de dispositivos todavía:
   lo que no existe se dice, no se finge. */

import {
  leer, activa, refrescar, entrar, registrar, salir, borrar,
  recuperar, recuperarCodigo, dispositivo, token, alCambiar,
} from '../../comun/sesion.js';
import { ErrorApi, mercadoPost } from '../../comun/api.js';
import { iniciales, esc, fechaHora } from '../../comun/formato.js';

const $ = (sel) => document.querySelector(sel);
const estado = {
  modo: 'entrar',
  enviando: false,
  aviso: '',
  error: '',
  ok: '',
  correo: '',
  nube: null,
  nubeError: '',
  cargandoNube: false,
  /* Tiendas que administra ESTA cuenta. Es el único puente entre la vista del
     cliente y la del negocio: si está vacío, no se muestra nada del negocio. */
  tiendas: [],
  leyendoTiendas: false,
};

function aviso(html, tipo) {
  const caja = $('[data-aviso]');
  if (!caja) return;
  caja.innerHTML = html
    ? '<div class="aviso aviso--' + (tipo || 'info') + '"><svg viewBox="0 0 24 24">' +
      '<path d="M12 9v4M12 17h.01"/><path d="M10.3 4.2 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/></svg>' +
      '<span>' + html + '</span></div>'
    : '';
}

function mensaje(e) {
  if (e instanceof ErrorApi) {
    if (e.codigo === 'SIN_RED') return 'No pudimos conectar con la nube: revisa tu conexión.';
    if (e.codigo === 'LIMITE') return 'Demasiados intentos seguidos: espera un minuto.';
    if (e.codigo === 'NUBE' || e.codigo === 'SIN_NUBE') return 'La nube de cuentas no está disponible ahora: intenta en un minuto.';
    return e.message || 'No pudimos completar la operación.';
  }
  return (e && e.message) || 'Algo salió mal: intenta de nuevo.';
}

function pantallaAcceso() {
  const modo = estado.modo;
  const esEntrar = modo === 'entrar';
  const esCrear = modo === 'crear';
  const esRecuperar = modo === 'recuperar';

  return '<div class="acceso">' +
    '<div class="acceso__cabecera">' +
      '<div class="acceso__ico"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg></div>' +
      '<h1>' + (esEntrar ? 'Entra a tu cuenta' : esCrear ? 'Crea tu cuenta' : 'Recupera tu clave') + '</h1>' +
      '<p class="acceso__sub">' + (esEntrar
        ? 'Para recuperar tu acceso y dejar tu nombre en los pedidos. Tus compras, favoritos, direcciones y reseñas quedan en tu cuenta y se ven en cualquier dispositivo.'
        : esCrear
          ? 'Gratis. Sólo necesitas un correo y una clave de 8 caracteres o más.'
          : 'Te enviamos un código de 6 dígitos al correo. Vence en 5 minutos.') + '</p>' +
    '</div>' +

    '<div class="segmento" role="tablist" aria-label="Acceso a la cuenta">' +
      '<button type="button" role="tab" data-modo="entrar" aria-selected="' + (esEntrar ? 'true' : 'false') + '">Entrar</button>' +
      '<button type="button" role="tab" data-modo="crear" aria-selected="' + (esCrear ? 'true' : 'false') + '">Crear cuenta</button>' +
      '<button type="button" role="tab" data-modo="recuperar" aria-selected="' + (esRecuperar ? 'true' : 'false') + '">Recuperar</button>' +
    '</div>' +

    (estado.error ? '<div class="acceso__error" role="alert">' + esc(estado.error) + '</div>' : '') +
    (estado.ok ? '<div class="acceso__ok" role="status">' + esc(estado.ok) + '</div>' : '') +

    (esEntrar ? formularioEntrar() : esCrear ? formularioCrear() : formularioRecuperar()) +

    '<p class="acceso__pie">Al continuar aceptas los <a href="/terminos.html">términos de uso</a>. ' +
      'Puedes comprar sin cuenta: la cuenta guarda tus pedidos, favoritos, direcciones y reseñas en la nube.</p>' +
  '</div>';
}

function formularioEntrar() {
  return '<form data-form="entrar" novalidate>' +
    '<div class="campo"><label for="e-email">Correo</label>' +
      '<input id="e-email" name="email" type="email" autocomplete="email" required placeholder="tu@correo.cl" value="' + esc(estado.correo) + '"></div>' +
    '<div class="campo"><label for="e-pass">Contraseña</label>' +
      '<input id="e-pass" name="pass" type="password" autocomplete="current-password" required minlength="8" placeholder="Tu contraseña"></div>' +
    '<button class="ds-btn ds-btn--lg" type="submit"' + (estado.enviando ? ' disabled' : '') + '>' +
      (estado.enviando ? 'Entrando…' : 'Entrar') + '</button>' +
    '<button class="acceso__volver" type="button" data-modo="recuperar">Olvidé mi contraseña</button>' +
  '</form>';
}

function formularioCrear() {
  return '<form data-form="crear" novalidate>' +
    '<div class="campo"><label for="c-nombre">Nombre</label>' +
      '<input id="c-nombre" name="nombre" type="text" autocomplete="name" required minlength="2" placeholder="Cómo te llamas"></div>' +
    '<div class="campo"><label for="c-email">Correo</label>' +
      '<input id="c-email" name="email" type="email" autocomplete="email" required placeholder="tu@correo.cl" value="' + esc(estado.correo) + '"></div>' +
    '<div class="campo"><label for="c-pass">Contraseña</label>' +
      '<input id="c-pass" name="pass" type="password" autocomplete="new-password" required minlength="8" placeholder="8 caracteres o más">' +
      '<small>Mínimo 8 caracteres. No uses la misma clave de tu banco.</small></div>' +
    '<div class="campo"><label for="c-pass2">Repite la contraseña</label>' +
      '<input id="c-pass2" name="pass2" type="password" autocomplete="new-password" required minlength="8" placeholder="Otra vez"></div>' +
    '<label class="check"><input type="checkbox" name="acepta" required>' +
      '<span>Acepto los <a href="/terminos.html">términos de uso</a> y el tratamiento de mis datos para gestionar pedidos.</span></label>' +
    '<button class="ds-btn ds-btn--lg" type="submit"' + (estado.enviando ? ' disabled' : '') + '>' +
      (estado.enviando ? 'Creando…' : 'Crear cuenta') + '</button>' +
  '</form>';
}

function formularioRecuperar() {
  // Dos pasos en el mismo formulario: el segundo sólo aparece con el correo.
  const paso2 = Boolean(estado.correo);
  return '<form data-form="recuperar" novalidate>' +
    '<div class="campo"><label for="r-email">Correo de la cuenta</label>' +
      '<input id="r-email" name="email" type="email" autocomplete="email" required placeholder="tu@correo.cl" value="' + esc(estado.correo) + '"></div>' +
    (paso2 ? '<div class="campo"><label for="r-codigo">Código de 6 dígitos</label>' +
      '<input id="r-codigo" name="codigo" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="000000"></div>' +
      '<div class="campo"><label for="r-pass">Contraseña nueva</label>' +
      '<input id="r-pass" name="pass" type="password" autocomplete="new-password" required minlength="8" placeholder="8 caracteres o más"></div>' +
      '<button class="ds-btn ds-btn--lg" type="submit"' + (estado.enviando ? ' disabled' : '') + '>' +
        (estado.enviando ? 'Cambiando…' : 'Cambiar la contraseña') + '</button>' +
      '<button class="acceso__volver" type="button" data-reenviar>Enviar otro código</button>'
      : '<button class="ds-btn ds-btn--lg" type="submit"' + (estado.enviando ? ' disabled' : '') + '>' +
        (estado.enviando ? 'Enviando…' : 'Enviar el código') + '</button>') +
  '</form>';
}

function bloqueNube() {
  if (estado.nubeError) {
    return '<section class="bloque-cuenta" aria-labelledby="nubeTitulo">' +
      '<div class="bloque-cuenta__cabeza"><h2 id="nubeTitulo">En la nube</h2>' +
        '<span class="pill pill--err">sin respuesta</span></div>' +
      '<div class="bloque-cuenta__cuerpo">' +
        '<p class="nube-nota">No pudimos leer tus datos de InsForge: ' + esc(estado.nubeError) + '</p>' +
        '<button class="ds-btn ds-btn--secondary ds-btn--sm" type="button" data-nube-reintentar>Reintentar</button>' +
      '</div>' +
    '</section>';
  }

  if (!estado.nube) {
    return '<section class="bloque-cuenta" aria-labelledby="nubeTitulo">' +
      '<div class="bloque-cuenta__cabeza"><h2 id="nubeTitulo">En la nube</h2>' +
        '<span class="pill">leyendo…</span></div>' +
      '<div class="bloque-cuenta__cuerpo">' +
        '<div class="nube-resumen nube-resumen--cargando" aria-hidden="true">' +
          '<span></span><span></span><span></span><span></span>' +
        '</div>' +
        '<p class="nube-nota">Consultando tu cuenta en InsForge.</p>' +
      '</div>' +
    '</section>';
  }

  const n = estado.nube;
  const dato = (ruta, valor, etiqueta) =>
    '<a class="nube-dato" href="' + ruta + '"><b>' + valor + '</b><span>' + etiqueta + '</span></a>';
  return '<section class="bloque-cuenta" aria-labelledby="nubeTitulo">' +
    '<div class="bloque-cuenta__cabeza"><h2 id="nubeTitulo">En la nube</h2>' +
      '<span class="pill pill--ok">InsForge</span></div>' +
    '<div class="bloque-cuenta__cuerpo">' +
      '<div class="nube-resumen">' +
        dato('/panel/cliente/pedidos/', String(n.pedidos), 'pedidos') +
        dato('/panel/cliente/favoritos/', String(n.favoritos), 'favoritos') +
        dato('/panel/cliente/direcciones/', String(n.direcciones), 'direcciones') +
        dato('/panel/cliente/resenas/', String(n.resenas), 'reseñas') +
      '</div>' +
      '<p class="nube-nota">' +
        (n.pendientes > 0
          ? 'Tienes ' + n.pendientes + ' pedido' + (n.pendientes === 1 ? '' : 's') +
            ' entregado' + (n.pendientes === 1 ? '' : 's') + ' por calificar. '
          : '') +
        'Estos datos están en tu cuenta y se ven en cualquier dispositivo donde entres.' +
      '</p>' +
    '</div>' +
  '</section>';
}

/* Bloque «Tu negocio»: aparece SOLO si esta cuenta administra una tienda. Es
   un enlace de salida hacia /panel/negocio/, no un panel dentro del Cliente:
   las dos vistas siguen separadas y ninguna hereda datos de la otra. */
function bloqueNegocio() {
  if (!estado.tiendas.length) return '';
  const nombres = estado.tiendas.map((t) => t.nombre).filter(Boolean);
  const lista = nombres.length === 1
    ? esc(nombres[0])
    : esc(nombres.slice(0, 2).join(', ')) + (nombres.length > 2 ? ' y ' + (nombres.length - 2) + ' más' : '');
  return '<section class="bloque-cuenta" aria-labelledby="negocioTitulo">' +
    '<div class="bloque-cuenta__cabeza"><h2 id="negocioTitulo">Tu negocio</h2>' +
      '<span class="pill pill--ok">' + estado.tiendas.length + '</span></div>' +
    '<div class="bloque-cuenta__cuerpo">' +
      '<p class="nube-nota">Esta cuenta administra ' + lista + '. El panel del negocio es aparte: ' +
        'pedidos, catálogo, stock, horarios y ajustes.</p>' +
      '<a class="ds-btn ds-btn--secondary ds-btn--sm" href="/panel/negocio/resumen/">Ir al panel del negocio</a>' +
    '</div>' +
  '</section>';
}

function pantallaCuenta() {
  const d = leer() || {};
  const u = d.usuario || {};
  const exp = Number(d.exp) || 0;
  const disp = dispositivo();
  const inicial = iniciales(u.nombre || u.email);

  return '<div class="cuenta-marco">' +
    '<div>' +
      '<section class="identidad">' +
        '<span class="identidad__ini" aria-hidden="true">' + esc(inicial) + '</span>' +
        '<div class="identidad__cuerpo">' +
          '<h1 class="identidad__nombre">' + esc(u.nombre || 'Tu cuenta') + '</h1>' +
          '<div class="identidad__correo">' + esc(u.email || '') + '</div>' +
          '<div class="identidad__desde">Sesión iniciada' +
            (d.guardado ? ' el ' + esc(fechaHora(d.guardado)) : '') + '</div>' +
        '</div>' +
        '<a class="ds-btn ds-btn--ghost ds-btn--sm" href="/app/">Abrir la app</a>' +
      '</section>' +

      bloqueNube() +

      bloqueNegocio() +

      '<section class="bloque-cuenta" aria-labelledby="seguridadTitulo">' +
        '<div class="bloque-cuenta__cabeza"><h2 id="seguridadTitulo">Seguridad</h2>' +
          '<span class="pill pill--ok">activa</span></div>' +
        '<div class="bloque-cuenta__cuerpo">' +
          '<p style="font-size:12px;line-height:1.55;color:var(--ds-text-secondary);margin-bottom:6px">' +
            'La sesión dura 30 días y se renueva sola mientras uses el panel. Cambiar la contraseña cierra las demás sesiones.</p>' +
          '<button class="ds-btn ds-btn--secondary" type="button" data-cambiar-clave>Cambiar la contraseña</button>' +
          '<button class="ds-btn ds-btn--ghost" type="button" data-salir>Cerrar sesión</button>' +
        '</div>' +
      '</section>' +

      '<section class="bloque-cuenta" aria-labelledby="datosTitulo">' +
        '<div class="bloque-cuenta__cabeza"><h2 id="datosTitulo">Datos de la cuenta</h2></div>' +
        '<div class="bloque-cuenta__cuerpo">' +
          '<div class="dato-cuenta"><span>Nombre</span><b>' + esc(u.nombre || '—') + '</b></div>' +
          '<div class="dato-cuenta"><span>Correo</span><b>' + esc(u.email || '—') + '</b></div>' +
          '<div class="dato-cuenta"><span>Rol</span><b>' + esc(u.rol || 'cliente') + '</b></div>' +
          '<p style="margin-top:10px;font-size:11px;line-height:1.5;color:var(--ds-text-tertiary)">' +
            'El nombre sale de tu cuenta. El teléfono se toma del último checkout y queda guardado con cada pedido en InsForge. La edición del perfil llega en la próxima actualización.</p>' +
        '</div>' +
      '</section>' +

      '<section class="bloque-cuenta" aria-labelledby="sesionTitulo">' +
        '<div class="bloque-cuenta__cabeza"><h2 id="sesionTitulo">Esta sesión</h2></div>' +
        '<div class="bloque-cuenta__cuerpo">' +
          '<div class="dato-cuenta"><span>Vence</span><b>' + (exp ? esc(fechaHora(exp)) : 'sin fecha') + '</b></div>' +
          '<div class="dato-cuenta"><span>Dispositivo</span><b><code>' + esc(disp.slice(0, 12)) + '…</code></b></div>' +
          '<p style="margin-top:10px;font-size:11px;line-height:1.5;color:var(--ds-text-tertiary)">' +
            'El listado de dispositivos todavía no está disponible: por ahora ves el identificador de este navegador.</p>' +
        '</div>' +
      '</section>' +

      '<section class="peligro" aria-labelledby="peligroTitulo">' +
        '<h2 id="peligroTitulo">Zona de peligro</h2>' +
        '<p>Eliminar la cuenta borra el acceso y cierra la sesión en todos los dispositivos. Los pedidos ya entregados quedan en el historial del local por obligación tributaria.</p>' +
        '<button class="ds-btn ds-btn--danger" type="button" data-eliminar>Eliminar mi cuenta</button>' +
      '</section>' +
    '</div>' +

    '<aside>' +
      '<section class="bloque-cuenta" style="margin-top:0" aria-labelledby="ayudaCuenta">' +
        '<div class="bloque-cuenta__cabeza"><h2 id="ayudaCuenta">¿Necesitas ayuda?</h2></div>' +
        '<div class="bloque-cuenta__cuerpo">' +
          '<a class="ds-btn ds-btn--secondary ds-btn--sm" href="/panel/cliente/ayuda/">Preguntas frecuentes</a>' +
          '<a class="ds-btn ds-btn--ghost ds-btn--sm" href="/panel/cliente/pedido/">Buscar un pedido</a>' +
          '<a class="ds-btn ds-btn--ghost ds-btn--sm" href="/terminos.html">Términos de uso</a>' +
        '</div>' +
      '</section>' +
    '</aside>' +
  '</div>';
}

function pintar() {
  const caja = $('[data-cuenta]');
  if (!caja) return;
  if (activa()) caja.innerHTML = pantallaCuenta();
  else caja.innerHTML = pantallaAcceso();
  montar();
  if (activa()) cargarNube();
}

/* Lee en paralelo lo que la cuenta tiene guardado en InsForge. Son las mismas
   cuatro acciones privadas que usan los módulos; no hay endpoint nuevo. */
async function cargarNube() {
  if (!activa() || estado.cargandoNube || estado.nube || estado.nubeError) return;
  estado.cargandoNube = true;
  const opts = { token: token(), dispositivo: dispositivo() };
  /* `local_mio` sólo dice si esta cuenta tiene tienda; nunca se pinta nada de
     otra cuenta ni datos del dueño en esta pantalla. */
  estado.leyendoTiendas = true;
  mercadoPost('local_mio', {}, opts).then((m) => {
    estado.tiendas = Array.isArray(m && m.tiendas) ? m.tiendas : [];
  }).catch(() => {
    estado.tiendas = [];
  }).finally(() => {
    estado.leyendoTiendas = false;
    if (activa() && estado.nube) pintar();
  });
  try {
    const [p, f, d, r] = await Promise.all([
      mercadoPost('mis_pedidos', {}, opts),
      mercadoPost('favoritos_listar', {}, opts),
      mercadoPost('direcciones_listar', {}, opts),
      mercadoPost('resenas_mias', {}, opts),
    ]);
    estado.nube = {
      pedidos: Array.isArray(p.pedidos) ? p.pedidos.length : 0,
      favoritos: Array.isArray(f.favoritos) ? f.favoritos.length : 0,
      direcciones: Array.isArray(d.direcciones) ? d.direcciones.length : 0,
      resenas: Array.isArray(r.resenas) ? r.resenas.length : 0,
      pendientes: Array.isArray(r.pendientes) ? r.pendientes.length : 0,
    };
    estado.nubeError = '';
  } catch (e) {
    estado.nubeError = mensaje(e);
  } finally {
    estado.cargandoNube = false;
    if (activa()) pintar();
  }
}

function modo(nuevo) {
  estado.modo = nuevo;
  estado.error = '';
  estado.ok = '';
  if (nuevo !== 'recuperar') estado.correo = '';
  aviso('');
  pintar();
}

function cargando(texto) {
  estado.enviando = true;
  pintar();
}

function montar() {
  document.querySelectorAll('[data-modo]').forEach((b) => {
    b.addEventListener('click', () => modo(b.dataset.modo));
  });

  const form = document.querySelector('[data-form]');
  if (!form) {
    engancharCuenta();
    return;
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (estado.enviando) return;
    const tipo = form.dataset.form;
    if (tipo === 'entrar') hacerEntrar(form);
    else if (tipo === 'crear') hacerCrear(form);
    else hacerRecuperar(form);
  });
  const reenviar = form.querySelector('[data-reenviar]');
  if (reenviar) {
    reenviar.addEventListener('click', () => {
      estado.correo = '';
      estado.error = '';
      estado.ok = '';
      pintar();
    });
  }
}

function engancharCuenta() {
  const reintentar = document.querySelector('[data-nube-reintentar]');
  if (reintentar) {
    reintentar.addEventListener('click', () => {
      estado.nube = null;
      estado.nubeError = '';
      pintar();
    });
  }
  const salirBtn = document.querySelector('[data-salir]');
  if (salirBtn) {
    salirBtn.addEventListener('click', async () => {
      salirBtn.disabled = true;
      salirBtn.textContent = 'Cerrando…';
      await salir();
      estado.modo = 'entrar';
      estado.ok = 'Sesión cerrada.';
      pintar();
    });
  }
  const cambiar = document.querySelector('[data-cambiar-clave]');
  if (cambiar) {
    cambiar.addEventListener('click', () => {
      const u = (leer() || {}).usuario || {};
      estado.correo = u.email || '';
      estado.modo = 'recuperar';
      estado.ok = '';
      estado.error = '';
      pintar();
    });
  }
  const eliminar = document.querySelector('[data-eliminar]');
  if (eliminar) {
    eliminar.addEventListener('click', async () => {
      const u = (leer() || {}).usuario || {};
      const correo = u.email || '';
      const clave = prompt('Esto elimina tu cuenta y no se puede deshacer.\n\nEscribe tu contraseña para confirmar:');
      if (!clave) return;
      const palabra = prompt('Escribe ELIMINAR (en mayúsculas) para confirmar la baja definitiva:');
      if (String(palabra || '').trim() !== 'ELIMINAR') {
        aviso('No se eliminó nada: la confirmación no coincidió.', 'warn');
        return;
      }
      eliminar.disabled = true;
      eliminar.textContent = 'Eliminando…';
      try {
        await borrar(correo, clave);
        estado.modo = 'entrar';
        estado.ok = 'Tu cuenta se eliminó. Gracias por haber usado FORGE CORE STOCK.';
        pintar();
      } catch (e) {
        eliminar.disabled = false;
        eliminar.textContent = 'Eliminar mi cuenta';
        aviso(esc(mensaje(e)), 'err');
      }
    });
  }
}

async function hacerEntrar(form) {
  const email = form.email.value.trim();
  const pass = form.pass.value;
  if (!email || pass.length < 8) {
    estado.error = 'Revisa el correo y una contraseña de al menos 8 caracteres.';
    pintar();
    return;
  }
  estado.error = '';
  cargando();
  try {
    await entrar(email, pass);
    estado.ok = '';
    pintar();
    aviso('Sesión iniciada.', 'ok');
  } catch (e) {
    estado.enviando = false;
    estado.error = mensaje(e);
    estado.correo = email;
    pintar();
  }
}

async function hacerCrear(form) {
  const nombre = form.nombre.value.trim();
  const email = form.email.value.trim();
  const pass = form.pass.value;
  const pass2 = form.pass2.value;
  const acepta = form.acepta.checked;
  if (nombre.length < 2) { estado.error = 'Escribe tu nombre.'; pintar(); return; }
  if (pass.length < 8) { estado.error = 'La contraseña necesita al menos 8 caracteres.'; pintar(); return; }
  if (pass !== pass2) { estado.error = 'Las contraseñas no coinciden.'; pintar(); return; }
  if (!acepta) { estado.error = 'Tienes que aceptar los términos para crear la cuenta.'; pintar(); return; }
  estado.error = '';
  cargando();
  try {
    await registrar({ nombre, email, pass });
    pintar();
    aviso('Cuenta creada. Ya puedes comprar con tu historial.', 'ok');
  } catch (e) {
    estado.enviando = false;
    estado.error = mensaje(e);
    estado.correo = email;
    pintar();
  }
}

async function hacerRecuperar(form) {
  const email = form.email.value.trim();
  if (!email) { estado.error = 'Escribe el correo de la cuenta.'; pintar(); return; }

  // Paso 1: pedir el código.
  if (!estado.correo) {
    estado.error = '';
    cargando();
    try {
      const d = await recuperar(email);
      estado.enviando = false;
      estado.correo = email;
      estado.ok = (d && d.mensaje) || 'Si el correo tiene cuenta, te enviamos un código de 6 dígitos.';
      pintar();
      const codigo = document.getElementById('r-codigo');
      if (codigo) codigo.focus();
    } catch (e) {
      estado.enviando = false;
      estado.error = mensaje(e);
      pintar();
    }
    return;
  }

  // Paso 2: canjear código y fijar la clave.
  const codigo = String(form.codigo.value || '').replace(/\D/g, '');
  const pass = form.pass.value;
  if (!/^\d{6}$/.test(codigo)) { estado.error = 'El código son 6 dígitos.'; pintar(); return; }
  if (pass.length < 8) { estado.error = 'La contraseña nueva necesita al menos 8 caracteres.'; pintar(); return; }
  estado.error = '';
  cargando();
  try {
    await recuperarCodigo({ email, codigo, pass });
    estado.correo = '';
    estado.ok = '';
    pintar();
    aviso('Contraseña cambiada y sesión iniciada en este dispositivo.', 'ok');
  } catch (e) {
    estado.enviando = false;
    estado.error = mensaje(e);
    pintar();
  }
}

alCambiar(() => {
  estado.nube = null;
  estado.nubeError = '';
  if (!estado.enviando) pintar();
});

refrescar().finally(() => pintar());
