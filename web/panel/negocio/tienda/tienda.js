/* N06 · Mi tienda
   Edita la ficha pública con vista previa en vivo. El logo se achica en el
   navegador; el pin se puede tomar del GPS. Abrir/cerrar usa `local_estado`
   para que el cambio se vea al instante en el mapa y en el checkout. */

import { arrancar, llamar, comprimirImagen } from '../../comun/negocio.js';
import { clp, esc, iniciales } from '../../comun/formato.js';

const $ = (sel, raiz) => (raiz || document).querySelector(sel);

const estado = {
  ctx: null,
  logo: '',
  logoTocada: false,
  guardando: false,
  aviso: '',
};

function logoHtml(t, clase) {
  const logo = estado.logoTocada ? estado.logo : (t.logo || '');
  if (logo) return '<span class="' + clase + '"><img src="' + esc(logo) + '" alt=""></span>';
  return '<span class="' + clase + '" aria-hidden="true">' + esc(iniciales(t.nombre || t.marca || '?')) + '</span>';
}

function pantalla(ctx) {
  const t = ctx.tienda;
  const abierta = t.abierto !== false;
  const enlace = location.origin + '/panel/cliente/tienda/?id=' + encodeURIComponent(t.id);
  return '<header class="neg-cabeza">' +
      '<div><span class="neg-cabeza__kicker">Ficha pública</span>' +
        '<h1>Mi tienda</h1>' +
        '<p>Lo que ve el comprador en el mapa y en la ficha. Los cambios se publican al guardar.</p></div>' +
      '<div class="neg-cabeza__acciones">' +
        '<button class="ds-btn ds-btn--ghost ds-btn--sm" type="button" data-estado>' +
          (abierta ? 'Cerrar ahora' : 'Abrir ahora') + '</button>' +
        '<a class="ds-btn ds-btn--ghost ds-btn--sm" target="_blank" rel="noopener" href="' + esc(enlace) + '">Ver ficha</a>' +
      '</div>' +
    '</header>' +
    '<div class="neg-aviso" data-aviso>' + estado.aviso + '</div>' +
    '<div class="mie-grilla">' +
      '<form class="mie-form" data-form novalidate>' +
        '<section class="mie-bloque">' +
          '<h2>Identidad</h2>' +
          '<div class="mie-logo">' +
            '<div class="mie-logo-preview" data-logo-preview>' + logoHtml(t, 'mie-logo-caja') + '</div>' +
            '<div class="mie-logo-acciones">' +
              '<label class="ds-btn ds-btn--secondary ds-btn--sm">Cambiar logo' +
                '<input type="file" accept="image/*" data-logo hidden></label>' +
              '<button class="ds-btn ds-btn--ghost ds-btn--sm" type="button" data-quitar-logo>Quitar</button>' +
              '<span class="mie-nota">PNG, JPG o WebP. Se achica a 192 px y 120 KB.</span>' +
            '</div>' +
          '</div>' +
          '<div class="mie-campos">' +
            '<label class="campo campo--ancho"><span>Nombre del negocio</span><input name="nombre" maxlength="120" required value="' + esc(t.nombre || '') + '"></label>' +
            '<label class="campo"><span>Marca</span><input name="marca" maxlength="60" value="' + esc(t.marca || '') + '" placeholder="Ej: Almacén Doña Rosa"></label>' +
            '<label class="campo"><span>Rubro</span><input name="rubro" maxlength="60" value="' + esc(t.rubro || '') + '" placeholder="Ej: Almacén"></label>' +
            '<label class="campo campo--ancho"><span>Descripción</span><textarea name="descripcion" maxlength="600" rows="3" placeholder="Qué vendes, desde cuándo, qué te hace distinto.">' + esc(t.descripcion || '') + '</textarea></label>' +
          '</div>' +
        '</section>' +
        '<section class="mie-bloque">' +
          '<h2>Contacto y ubicación</h2>' +
          '<div class="mie-campos">' +
            '<label class="campo"><span>Teléfono</span><input name="telefono" type="tel" inputmode="tel" value="' + esc(t.telefono || '') + '" placeholder="9 1234 5678"></label>' +
            '<label class="campo"><span>Comuna</span><input name="comuna" maxlength="80" value="' + esc(t.comuna || '') + '"></label>' +
            '<label class="campo campo--ancho"><span>Dirección</span><input name="direccion" maxlength="160" value="' + esc(t.direccion || '') + '" placeholder="Calle, número, local"></label>' +
            '<div class="campo campo--ancho mie-pin">' +
              '<span>Pin en el mapa</span>' +
              '<div class="mie-pin-fila">' +
                '<input name="lat" type="number" step="0.000001" min="-56" max="-17" value="' + (Number(t.lat) || '') + '" placeholder="Latitud" aria-label="Latitud">' +
                '<input name="lon" type="number" step="0.000001" min="-76" max="-66" value="' + (Number(t.lon) || '') + '" placeholder="Longitud" aria-label="Longitud">' +
                '<button class="ds-btn ds-btn--secondary ds-btn--sm" type="button" data-gps>Usar mi ubicación</button>' +
              '</div>' +
              '<small class="mie-nota">El pin se mueve con coordenadas. Si el negocio todavía no tiene uno, no aparece en el mapa.</small>' +
            '</div>' +
          '</div>' +
        '</section>' +
        '<div class="mie-pie">' +
          '<button class="ds-btn ds-btn--primary" type="submit"' + (estado.guardando ? ' disabled' : '') + '>' +
            (estado.guardando ? 'Guardando…' : 'Guardar cambios') + '</button>' +
          '<button class="ds-btn ds-btn--ghost" type="button" data-copiar>Copiar enlace</button>' +
        '</div>' +
      '</form>' +
      '<aside class="mie-preview" aria-label="Vista previa de la ficha">' +
        '<p class="mie-preview-rotulo">Vista previa</p>' +
        '<article class="mie-ficha" data-preview>' +
          '<div class="mie-ficha-top">' + logoHtml(t, 'mie-ficha-logo') +
            '<div><h3 data-p-nombre>' + esc(t.nombre || 'Tu negocio') + '</h3>' +
              '<p data-p-marca>' + esc(t.marca || t.rubro || '') + '</p></div>' +
          '</div>' +
          '<p class="mie-ficha-desc" data-p-desc>' + esc(t.descripcion || 'Una tienda de barrio.') + '</p>' +
          '<dl class="mie-ficha-datos">' +
            '<div><dt>Rubro</dt><dd data-p-rubro>' + esc(t.rubro || '—') + '</dd></div>' +
            '<div><dt>Dirección</dt><dd data-p-dir>' + esc([t.direccion, t.comuna].filter(Boolean).join(', ') || '—') + '</dd></div>' +
            '<div><dt>Teléfono</dt><dd data-p-tel>' + esc(t.telefono || '—') + '</dd></div>' +
            '<div><dt>Entrega</dt><dd data-p-entrega>' + esc(entregaTexto(t)) + '</dd></div>' +
          '</dl>' +
          '<div class="mie-ficha-pie"><span class="pill ' + (abierta ? 'pill--ok' : 'pill--err') + '" data-p-estado>' +
            (abierta ? 'Abierta' : 'Cerrada') + '</span>' +
            '<span class="mie-nota">Mínimo ' + esc(t.minimo ? clp(t.minimo) : 'sin mínimo') + '</span></div>' +
        '</article>' +
      '</aside>' +
    '</div>';
}

function entregaTexto(t) {
  const lista = Array.isArray(t.entrega) ? t.entrega : ['retiro'];
  const nombres = { retiro: 'Retiro en el local', delivery: 'Delivery' };
  return lista.map((x) => nombres[x] || x).join(' · ') || 'Retiro';
}

function actualizarPreview(caja) {
  const form = $('[data-form]', caja);
  if (!form) return;
  const v = (n) => (form[n] ? form[n].value : '');
  const set = (sel, texto) => { const el = $(sel, caja); if (el) el.textContent = texto; };
  set('[data-p-nombre]', v('nombre') || 'Tu negocio');
  set('[data-p-marca]', v('marca') || v('rubro') || '');
  set('[data-p-desc]', v('descripcion') || 'Una tienda de barrio.');
  set('[data-p-rubro]', v('rubro') || '—');
  set('[data-p-dir]', [v('direccion'), v('comuna')].filter(Boolean).join(', ') || '—');
  set('[data-p-tel]', v('telefono') || '—');
  // Si la ficha no tiene logo, las iniciales siguen al nombre mientras se
  // escribe. Con logo cargado no se toca la imagen.
  const logoEl = $('[data-preview] .mie-ficha-logo', caja);
  if (logoEl && !logoEl.querySelector('img')) {
    logoEl.textContent = iniciales(v('nombre') || '?');
  }
}

function pintar(caja, ctx) {
  caja.innerHTML = pantalla(ctx);
  enganchar(caja, ctx);
}

function enganchar(caja, ctx) {
  const form = $('[data-form]', caja);
  if (!form) return;
  form.addEventListener('input', () => actualizarPreview(caja));
  form.addEventListener('submit', (e) => { e.preventDefault(); guardar(caja, ctx); });

  const logo = $('[data-logo]', caja);
  if (logo) logo.addEventListener('change', () => cambiarLogo(caja, ctx, logo));
  $('[data-quitar-logo]', caja)?.addEventListener('click', () => {
    estado.logo = '';
    estado.logoTocada = true;
    const prev = $('[data-logo-preview]', caja);
    if (prev) prev.innerHTML = logoHtml(ctx.tienda, 'mie-logo-caja');
    const ficha = $('[data-preview] .mie-ficha-logo', caja);
    if (ficha) ficha.outerHTML = logoHtml(ctx.tienda, 'mie-ficha-logo');
  });

  $('[data-estado]', caja)?.addEventListener('click', () => cambiarEstado(caja, ctx));
  $('[data-gps]', caja)?.addEventListener('click', () => usarGps(caja));
  $('[data-copiar]', caja)?.addEventListener('click', () => copiarEnlace(caja, ctx));
}

async function cambiarLogo(caja, ctx, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    const uri = await comprimirImagen(file, { maxPx: 192, maxBytes: 120 * 1024, calidad: 0.82 });
    estado.logo = uri;
    estado.logoTocada = true;
    const prev = $('[data-logo-preview]', caja);
    if (prev) prev.innerHTML = logoHtml(ctx.tienda, 'mie-logo-caja');
    const ficha = $('[data-preview] .mie-ficha-logo', caja);
    if (ficha) ficha.outerHTML = logoHtml(ctx.tienda, 'mie-ficha-logo');
    estado.aviso = '';
    const cajaAviso = $('[data-aviso]', caja);
    if (cajaAviso) cajaAviso.innerHTML = '';
  } catch (fallo) {
    estado.aviso = '<div class="aviso aviso--err">' + esc(fallo && fallo.message ? fallo.message : 'No se pudo procesar el logo.') + '</div>';
    const cajaAviso = $('[data-aviso]', caja);
    if (cajaAviso) cajaAviso.innerHTML = estado.aviso;
  }
}

async function guardar(caja, ctx) {
  if (estado.guardando) return;
  const form = $('[data-form]', caja);
  if (!form) return;
  const nombre = form.nombre.value.trim();
  if (nombre.length < 2) {
    estado.aviso = '<div class="aviso aviso--warn">El nombre del negocio es obligatorio.</div>';
    const cajaAviso = $('[data-aviso]', caja);
    if (cajaAviso) cajaAviso.innerHTML = estado.aviso;
    return;
  }
  const campos = {
    nombre,
    marca: form.marca.value.trim(),
    rubro: form.rubro.value.trim(),
    descripcion: form.descripcion.value.trim(),
    telefono: form.telefono.value.replace(/[^\d+]/g, ''),
    direccion: form.direccion.value.trim(),
    comuna: form.comuna.value.trim(),
  };
  const lat = Number(form.lat.value);
  const lon = Number(form.lon.value);
  if (form.lat.value !== '' && Number.isFinite(lat)) campos.lat = lat;
  if (form.lon.value !== '' && Number.isFinite(lon)) campos.lon = lon;
  if (estado.logoTocada) campos.logo = estado.logo || '';

  estado.guardando = true;
  const boton = form.querySelector('button[type="submit"]');
  if (boton) { boton.disabled = true; boton.textContent = 'Guardando…'; }
  try {
    await llamar('local_actualizar', { local_id: ctx.tienda.id, campos });
    estado.guardando = false;
    estado.logoTocada = false;
    estado.aviso = '<div class="aviso aviso--ok">Ficha guardada. El mapa y el checkout ya la muestran.</div>';
    ctx.fijar(campos);
    const cajaAviso = $('[data-aviso]', caja);
    if (cajaAviso) cajaAviso.innerHTML = estado.aviso;
    if (boton) { boton.disabled = false; boton.textContent = 'Guardar cambios'; }
  } catch (fallo) {
    estado.guardando = false;
    estado.aviso = '<div class="aviso aviso--err">' + esc(fallo && fallo.message ? fallo.message : 'No se pudo guardar la ficha.') + '</div>';
    const cajaAviso = $('[data-aviso]', caja);
    if (cajaAviso) cajaAviso.innerHTML = estado.aviso;
    if (boton) { boton.disabled = false; boton.textContent = 'Guardar cambios'; }
  }
}

async function cambiarEstado(caja, ctx) {
  const abierta = ctx.tienda.abierto !== false;
  const boton = $('[data-estado]', caja);
  if (boton) boton.disabled = true;
  try {
    const r = await llamar('local_estado', { local_id: ctx.tienda.id, abierto: !abierta });
    const nuevo = r.abierto !== false;
    ctx.fijar({ abierto: nuevo });
    // Se actualiza en el sitio: repintar el formulario borraría lo que el
    // dueño esté escribiendo en ese momento.
    if (boton) { boton.textContent = nuevo ? 'Cerrar ahora' : 'Abrir ahora'; boton.disabled = false; }
    const pill = $('[data-p-estado]', caja);
    if (pill) {
      pill.className = 'pill ' + (nuevo ? 'pill--ok' : 'pill--err');
      pill.textContent = nuevo ? 'Abierta' : 'Cerrada';
    }
    estado.aviso = '<div class="aviso aviso--ok">' + (nuevo ? 'La tienda quedó abierta.' : 'La tienda quedó cerrada.') + '</div>';
    const cajaAviso = $('[data-aviso]', caja);
    if (cajaAviso) cajaAviso.innerHTML = estado.aviso;
  } catch (fallo) {
    if (boton) boton.disabled = false;
    estado.aviso = '<div class="aviso aviso--err">' + esc(fallo && fallo.message ? fallo.message : 'No se pudo cambiar el estado.') + '</div>';
    const cajaAviso = $('[data-aviso]', caja);
    if (cajaAviso) cajaAviso.innerHTML = estado.aviso;
  }
}

function usarGps(caja) {
  const form = $('[data-form]', caja);
  if (!form) return;
  const boton = $('[data-gps]', caja);
  if (boton) { boton.disabled = true; boton.textContent = 'Buscando…'; }
  if (!navigator.geolocation) {
    estado.aviso = '<div class="aviso aviso--warn">Este navegador no expone la ubicación.</div>';
    const cajaAviso = $('[data-aviso]', caja);
    if (cajaAviso) cajaAviso.innerHTML = estado.aviso;
    if (boton) { boton.disabled = false; boton.textContent = 'Usar mi ubicación'; }
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      form.lat.value = pos.coords.latitude.toFixed(6);
      form.lon.value = pos.coords.longitude.toFixed(6);
      if (boton) { boton.disabled = false; boton.textContent = 'Usar mi ubicación'; }
      estado.aviso = '<div class="aviso aviso--ok">Pin puesto en tu ubicación. Revisa la dirección antes de guardar.</div>';
      const cajaAviso = $('[data-aviso]', caja);
      if (cajaAviso) cajaAviso.innerHTML = estado.aviso;
    },
    () => {
      if (boton) { boton.disabled = false; boton.textContent = 'Usar mi ubicación'; }
      estado.aviso = '<div class="aviso aviso--warn">No pudimos leer tu ubicación. Escribe las coordenadas a mano.</div>';
      const cajaAviso = $('[data-aviso]', caja);
      if (cajaAviso) cajaAviso.innerHTML = estado.aviso;
    },
    { enableHighAccuracy: true, timeout: 9000, maximumAge: 60000 }
  );
}

async function copiarEnlace(caja, ctx) {
  const enlace = location.origin + '/panel/cliente/tienda/?id=' + encodeURIComponent(ctx.tienda.id);
  try {
    await navigator.clipboard.writeText(enlace);
    estado.aviso = '<div class="aviso aviso--ok">Enlace copiado: ' + esc(enlace) + '</div>';
  } catch (_) {
    estado.aviso = '<div class="aviso aviso--warn">Copia este enlace: ' + esc(enlace) + '</div>';
  }
  const cajaAviso = $('[data-aviso]', caja);
  if (cajaAviso) cajaAviso.innerHTML = estado.aviso;
}

arrancar({
  alListo(ctx) {
    estado.ctx = ctx;
    estado.logo = '';
    estado.logoTocada = false;
    const caja = $('[data-negocio]');
    if (caja) pintar(caja, ctx);
  },
});
