/* N16 · Ajustes
   Cierra la configuración del negocio: cuenta, plan, contacto, exportación y
   las acciones irreversibles. Todo lo que se muestra existe: el plan viene de
   `local_mio`, las exportaciones se arman en el navegador (la API no tiene un
   endpoint de reportes) y el borrado se bloquea si hay pedidos abiertos. */

import { arrancar, llamar, estadoDe } from '../../comun/negocio.js';
import { esc, iniciales, num } from '../../comun/formato.js';

const $ = (sel, raiz) => (raiz || document).querySelector(sel);

const TOPES = { gratis: 300, pro: 3000 };

const estado = {
  ctx: null,
  aviso: '',
  guardando: false,
  pausando: false,
  exportando: '',
  pedidos: null,
  errorPedidos: '',
  borrando: false,
};

function planDe(t) {
  const clave = String((t && t.plan) || 'gratis').toLowerCase();
  const nombre = clave === 'pro' ? 'Pro' : clave === 'gratis' ? 'Gratis' : (clave || 'Gratis');
  return { clave, nombre, tope: TOPES[clave] || TOPES.gratis };
}

function rolTexto(rol) {
  const r = String(rol || '').toLowerCase();
  if (r === 'owner' || r === 'dueno' || r === 'dueño') return 'Dueño';
  if (r === 'admin' || r === 'administrador') return 'Administrador';
  if (r === 'member' || r === 'miembro') return 'Miembro';
  return rol ? String(rol) : 'Cuenta';
}

/* ── pantalla ────────────────────────────────────────────────────────────── */

function pantalla(ctx) {
  const t = ctx.tienda;
  const c = ctx.cuenta || {};
  const plan = planDe(t);
  const catalogo = Array.isArray(t.catalogo) ? t.catalogo : [];
  const usados = catalogo.length;
  const porcentaje = Math.max(2, Math.min(100, Math.round((usados / plan.tope) * 100)));
  const activa = t.activo !== false;
  const abiertos = Number(t.pedidos_pendientes) || 0;
  const nombre = String(t.nombre || 'Mi tienda');

  return '<header class="neg-cabeza">' +
      '<div><span class="neg-cabeza__kicker">Cierre y datos</span>' +
        '<h1>Ajustes</h1>' +
        '<p>La cuenta que administra, el plan de la tienda, tus datos de contacto ' +
          'y las acciones que no se pueden deshacer.</p></div>' +
      '<div class="neg-cabeza__acciones">' +
        '<a class="ds-btn ds-btn--ghost ds-btn--sm" href="/panel/negocio/tienda/">Editar ficha</a>' +
      '</div>' +
    '</header>' +
    '<div class="neg-aviso" data-aviso aria-live="polite">' + estado.aviso + '</div>' +
    '<div class="aju-pila">' +

      '<section class="neg-tarjeta aju-bloque" aria-labelledby="aju-cuenta-t">' +
        '<div class="aju-bloque__cabeza"><div><h2 id="aju-cuenta-t">Cuenta</h2>' +
          '<span class="neg-tarjeta__sub">La misma sesión de la app y del panel Cliente</span></div></div>' +
        '<div class="aju-cuenta">' +
          '<span class="aju-avatar" aria-hidden="true">' + esc(iniciales(c.nombre || c.email || '?')) + '</span>' +
          '<div class="aju-cuenta__id">' +
            '<b>' + esc(c.nombre || 'Tu cuenta') + '</b>' +
            '<span>' + esc(c.email || '') + '</span>' +
            '<span class="pill">' + esc(rolTexto(c.rol)) + '</span>' +
          '</div>' +
          '<button class="ds-btn ds-btn--secondary ds-btn--sm" type="button" data-salir>Cerrar sesión</button>' +
        '</div>' +
        '<p class="aju-nota">Cerrar sesión acá también la cierra en la app y en el panel ' +
          'Cliente de este navegador. La tienda y los pedidos quedan en la nube.</p>' +
      '</section>' +

      '<section class="neg-tarjeta aju-bloque" aria-labelledby="aju-plan-t">' +
        '<div class="aju-bloque__cabeza"><div><h2 id="aju-plan-t">Plan y publicación</h2>' +
          '<span class="neg-tarjeta__sub">Lo que la plataforma tiene registrado para esta tienda</span></div>' +
          '<span class="pill pill--acento">' + esc(plan.nombre) + '</span></div>' +
        '<div class="aju-plan">' +
          '<div class="aju-plan__linea"><span>Productos en el catálogo</span>' +
            '<b>' + num(usados) + ' / ' + num(plan.tope) + '</b></div>' +
          '<div class="aju-barra" role="img" aria-label="' + usados + ' de ' + plan.tope + ' productos del plan">' +
            '<span style="width:' + porcentaje + '%"></span></div>' +
          '<p class="aju-nota">El plan se asigna desde la plataforma; acá sólo se muestra. ' +
            'Si el catálogo llega al tope, la nube rechaza productos nuevos hasta subir de plan.</p>' +
        '</div>' +
        '<div class="aju-fila">' +
          '<div class="aju-fila__txt">' +
            '<b>Tienda publicada</b>' +
            '<span data-activo-texto>' + (activa
              ? 'Aparece en el mapa y el checkout deja comprar.'
              : 'Pausada: no aparece en el mapa ni acepta pedidos. Nada se borró.') + '</span>' +
          '</div>' +
          '<span class="pill ' + (activa ? 'pill--ok' : 'pill--warn') + '" data-activo-pill>' +
            (activa ? 'Publicada' : 'Pausada') + '</span>' +
          '<button class="ds-btn ds-btn--' + (activa ? 'ghost' : 'primary') + ' ds-btn--sm" type="button" data-activo>' +
            (activa ? 'Pausar tienda' : 'Publicar tienda') + '</button>' +
        '</div>' +
      '</section>' +

      '<section class="neg-tarjeta aju-bloque" aria-labelledby="aju-contacto-t">' +
        '<div class="aju-bloque__cabeza"><div><h2 id="aju-contacto-t">Contacto del negocio</h2>' +
          '<span class="neg-tarjeta__sub">Lo que ve el comprador cuando ya tiene tu pedido</span></div>' +
          '<a class="sec-head__link" href="/panel/negocio/tienda/">Nombre, logo y mapa</a></div>' +
        '<form class="aju-form" data-contacto novalidate>' +
          '<div class="aju-campos">' +
            '<label class="campo"><span>Teléfono</span>' +
              '<input name="telefono" type="tel" inputmode="tel" maxlength="30" value="' +
                esc(t.telefono || '') + '" placeholder="9 1234 5678"></label>' +
            '<label class="campo"><span>Comuna</span>' +
              '<input name="comuna" maxlength="80" value="' + esc(t.comuna || '') + '"></label>' +
            '<label class="campo campo--ancho"><span>Dirección</span>' +
              '<input name="direccion" maxlength="160" value="' + esc(t.direccion || '') + '"></label>' +
          '</div>' +
          '<div class="aju-form__pie">' +
            '<button class="ds-btn ds-btn--primary ds-btn--sm" type="submit"' +
              (estado.guardando ? ' disabled' : '') + '>' +
              (estado.guardando ? 'Guardando…' : 'Guardar contacto') + '</button>' +
            '<span class="aju-nota">El nombre, la marca, el logo, el rubro y el pin se editan en Mi tienda.</span>' +
          '</div>' +
        '</form>' +
        '<p class="aju-nota aju-nota--borde">La ficha no guarda RUT ni razón social: ' +
          'el comprador ve el nombre, la marca, el teléfono y la dirección del local.</p>' +
      '</section>' +

      '<section class="neg-tarjeta aju-bloque" aria-labelledby="aju-export-t">' +
        '<div class="aju-bloque__cabeza"><div><h2 id="aju-export-t">Exportar</h2>' +
          '<span class="neg-tarjeta__sub">Archivos que se arman en este navegador</span></div></div>' +
        '<div class="aju-export">' +
          '<div class="aju-export__item">' +
            '<b>Catálogo</b>' +
            '<span>' + num(usados) + ' producto' + (usados === 1 ? '' : 's') +
              ' con precio, oferta y stock.</span>' +
            '<div class="aju-export__acciones">' +
              '<button class="ds-btn ds-btn--secondary ds-btn--sm" type="button" data-export="catalogo-csv">CSV</button>' +
              '<button class="ds-btn ds-btn--ghost ds-btn--sm" type="button" data-export="catalogo-json">JSON</button>' +
            '</div>' +
          '</div>' +
          '<div class="aju-export__item">' +
            '<b>Pedidos</b>' +
            '<span>Hasta 200 pedidos con ítems, estado y totales.</span>' +
            '<div class="aju-export__acciones">' +
              '<button class="ds-btn ds-btn--secondary ds-btn--sm" type="button" data-export="pedidos-csv">CSV</button>' +
              '<button class="ds-btn ds-btn--ghost ds-btn--sm" type="button" data-export="pedidos-json">JSON</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<p class="aju-nota">La API no tiene un endpoint de reportes: la descarga se genera ' +
          'acá con los datos que el panel ya puede leer. Si cierras la pestaña, el archivo no se pierde.</p>' +
      '</section>' +

      '<section class="neg-tarjeta aju-peligro" aria-labelledby="aju-peligro-t">' +
        '<div class="aju-bloque__cabeza"><div><h2 id="aju-peligro-t">Eliminar la tienda</h2>' +
          '<span class="neg-tarjeta__sub">No se puede deshacer</span></div></div>' +
        '<p class="aju-nota">Se borran el catálogo, los pedidos, las reseñas y los avisos de ' +
          'esta tienda. La cuenta de usuario sigue existiendo y puedes publicar otra tienda después.</p>' +
        (abiertos
          ? '<div class="aviso aviso--warn aju-bloqueo">Hay ' + abiertos + ' pedido' +
            (abiertos === 1 ? '' : 's') + ' sin entregar ni cancelar. Para eliminar la tienda, ' +
            'primero ciérralos en la cola.' +
            '<div class="aju-bloqueo__acciones"><a class="ds-btn ds-btn--ghost ds-btn--sm" ' +
              'href="/panel/negocio/pedidos/">Ir a pedidos</a></div></div>'
          : '') +
        '<div class="aju-borrar"' + (abiertos ? ' hidden' : '') + '>' +
          '<label class="campo"><span>Escribe <b>' + esc(nombre) + '</b> para confirmar</span>' +
            '<input type="text" data-nombre-tienda autocomplete="off" spellcheck="false" ' +
              'placeholder="' + esc(nombre) + '"></label>' +
          '<button class="ds-btn ds-btn--danger" type="button" data-borrar disabled' +
            (estado.borrando ? ' aria-busy="true"' : '') + '>' +
            (estado.borrando ? 'Eliminando…' : 'Eliminar esta tienda') + '</button>' +
        '</div>' +
      '</section>' +

    '</div>';
}

/* ── avisos ──────────────────────────────────────────────────────────────── */

function avisar(html) {
  estado.aviso = html;
  const caja = $('[data-aviso]');
  if (caja) caja.innerHTML = html;
}

/* ── acciones ────────────────────────────────────────────────────────────── */

async function guardarContacto(caja, ctx) {
  if (estado.guardando) return;
  const form = $('[data-contacto]', caja);
  if (!form) return;
  const campos = {
    telefono: String(form.telefono.value || '').replace(/[^\d+]/g, ''),
    direccion: String(form.direccion.value || '').trim(),
    comuna: String(form.comuna.value || '').trim(),
  };
  estado.guardando = true;
  const boton = form.querySelector('button[type="submit"]');
  if (boton) { boton.disabled = true; boton.textContent = 'Guardando…'; }
  try {
    await llamar('local_actualizar', { local_id: ctx.tienda.id, campos });
    ctx.fijar(campos);
    estado.guardando = false;
    if (boton) { boton.disabled = false; boton.textContent = 'Guardar contacto'; }
    avisar('<div class="aviso aviso--ok">Contacto guardado. La ficha y el seguimiento ya lo muestran.</div>');
  } catch (fallo) {
    estado.guardando = false;
    if (boton) { boton.disabled = false; boton.textContent = 'Guardar contacto'; }
    avisar('<div class="aviso aviso--err">' +
      esc(fallo && fallo.message ? fallo.message : 'No se pudo guardar el contacto.') + '</div>');
  }
}

async function cambiarActivo(caja, ctx) {
  if (estado.pausando) return;
  const activa = ctx.tienda.activo !== false;
  estado.pausando = true;
  const boton = $('[data-activo]', caja);
  if (boton) boton.disabled = true;
  try {
    const r = await llamar('local_activo', { local_id: ctx.tienda.id, activo: !activa });
    const nuevo = r.activo !== false;
    ctx.fijar({ activo: nuevo });
    estado.pausando = false;
    if (boton) {
      boton.disabled = false;
      boton.textContent = nuevo ? 'Pausar tienda' : 'Publicar tienda';
      boton.className = 'ds-btn ds-btn--' + (nuevo ? 'ghost' : 'primary') + ' ds-btn--sm';
    }
    const pill = $('[data-activo-pill]', caja);
    if (pill) {
      pill.className = 'pill ' + (nuevo ? 'pill--ok' : 'pill--warn');
      pill.textContent = nuevo ? 'Publicada' : 'Pausada';
    }
    const texto = $('[data-activo-texto]', caja);
    if (texto) {
      texto.textContent = nuevo
        ? 'Aparece en el mapa y el checkout deja comprar.'
        : 'Pausada: no aparece en el mapa ni acepta pedidos. Nada se borró.';
    }
    avisar('<div class="aviso aviso--ok">' + (nuevo
      ? 'La tienda volvió a publicarse en el mapa.'
      : 'La tienda quedó pausada. No se borró nada.') + '</div>');
  } catch (fallo) {
    estado.pausando = false;
    if (boton) boton.disabled = false;
    avisar('<div class="aviso aviso--err">' +
      esc(fallo && fallo.message ? fallo.message : 'No se pudo cambiar la publicación.') + '</div>');
  }
}

/* ── exportación ─────────────────────────────────────────────────────────── */

function celda(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function csv(filas) {
  // BOM para que Excel en Windows respete los acentos; separador ; (es-CL).
  return '\ufeff' + filas.map((f) => f.map(celda).join(';')).join('\r\n');
}

function descargar(nombre, contenido, tipo) {
  const blob = new Blob([contenido], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function slug(s) {
  const base = String(s || 'tienda').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (base || 'tienda').slice(0, 40);
}

function fechaArchivo() {
  return new Date().toISOString().slice(0, 10);
}

function itemsTexto(items) {
  if (!Array.isArray(items)) return '';
  return items.map((i) => {
    const n = Number(i.cantidad) || 1;
    return n + '× ' + String(i.nombre || i.sku || 'Producto');
  }).join(' | ');
}

async function exportar(caja, ctx, tipo) {
  if (estado.exportando) return;
  const [familia, formato] = tipo.split('-');
  const boton = $('[data-export="' + tipo + '"]', caja);
  estado.exportando = tipo;
  if (boton) { boton.disabled = true; boton.textContent = 'Preparando…'; }

  try {
    const t = ctx.tienda;
    const catalogo = Array.isArray(t.catalogo) ? t.catalogo : [];
    const sello = fechaArchivo();
    let nombre = '';
    let contenido = '';
    let mime = '';

    if (familia === 'catalogo') {
      if (!catalogo.length) throw new Error('El catálogo está vacío: no hay nada que exportar.');
      if (formato === 'csv') {
        const filas = [[
          'SKU', 'Producto', 'Categoría', 'Unidad', 'Código de barras',
          'Precio CLP', 'Precio efectivo CLP', 'Descuento %', 'Stock',
        ]];
        for (const p of catalogo) {
          filas.push([
            p.sku || '', p.nombre || '', p.categoria || '', p.unidad || '', p.codigo || '',
            Number(p.precio) || 0, Number(p.precio_efectivo) || 0,
            Number(p.descuento_vigente || p.descuento) || 0,
            p.stock === null || p.stock === undefined ? '' : p.stock,
          ]);
        }
        contenido = csv(filas);
        mime = 'text/csv;charset=utf-8';
        nombre = 'catalogo-' + slug(t.nombre) + '-' + sello + '.csv';
      } else {
        contenido = JSON.stringify({
          tienda: { id: t.id, nombre: t.nombre, plan: planDe(t).clave },
          generado: new Date().toISOString(),
          catalogo,
        }, null, 2);
        mime = 'application/json;charset=utf-8';
        nombre = 'catalogo-' + slug(t.nombre) + '-' + sello + '.json';
      }
    } else {
      if (estado.pedidos === null) {
        try {
          const d = await llamar('pedidos_listar', { local_id: t.id, limite: 200 });
          estado.pedidos = Array.isArray(d.pedidos) ? d.pedidos : [];
          estado.errorPedidos = '';
        } catch (fallo) {
          estado.errorPedidos = fallo && fallo.message ? fallo.message : 'La nube no respondió.';
          throw new Error('No pudimos leer los pedidos: ' + estado.errorPedidos);
        }
      }
      if (!estado.pedidos.length) throw new Error('Todavía no hay pedidos para exportar.');
      if (formato === 'csv') {
        const filas = [[
          'Código', 'Fecha', 'Cliente', 'Teléfono', 'Estado', 'Entrega',
          'Comuna', 'Dirección', 'Referencia', 'Subtotal CLP', 'Envío CLP',
          'Total CLP', 'Ahorro CLP', 'Productos',
        ]];
        for (const p of estado.pedidos) {
          filas.push([
            p.codigo || '',
            p.creado ? new Date(p.creado).toLocaleString('es-CL') : '',
            p.cliente || '',
            p.telefono || '',
            estadoDe(p.estado).t,
            p.entrega === 'delivery' ? 'Delivery' : 'Retiro',
            p.comuna_entrega || '',
            p.direccion || '',
            p.referencia_entrega || '',
            Number(p.subtotal) || 0,
            Number(p.envio) || 0,
            Number(p.total) || 0,
            Number(p.ahorro) || 0,
            itemsTexto(p.items),
          ]);
        }
        contenido = csv(filas);
        mime = 'text/csv;charset=utf-8';
        nombre = 'pedidos-' + slug(t.nombre) + '-' + sello + '.csv';
      } else {
        contenido = JSON.stringify({
          tienda: { id: t.id, nombre: t.nombre },
          generado: new Date().toISOString(),
          pedidos: estado.pedidos,
        }, null, 2);
        mime = 'application/json;charset=utf-8';
        nombre = 'pedidos-' + slug(t.nombre) + '-' + sello + '.json';
      }
    }

    descargar(nombre, contenido, mime);
    estado.exportando = '';
    if (boton) { boton.disabled = false; boton.textContent = formato === 'csv' ? 'CSV' : 'JSON'; }
    avisar('<div class="aviso aviso--ok">Descargado <b>' + esc(nombre) + '</b> (' +
      Math.max(1, Math.round(contenido.length / 1024)) + ' KB).</div>');
  } catch (fallo) {
    estado.exportando = '';
    if (boton) { boton.disabled = false; boton.textContent = formato === 'csv' ? 'CSV' : 'JSON'; }
    avisar('<div class="aviso aviso--err">' +
      esc(fallo && fallo.message ? fallo.message : 'No se pudo preparar la descarga.') + '</div>');
  }
}

/* ── borrado ─────────────────────────────────────────────────────────────── */

async function borrarTienda(caja, ctx) {
  if (estado.borrando) return;
  const nombre = String(ctx.tienda.nombre || 'Mi tienda').trim();
  const input = $('[data-nombre-tienda]', caja);
  const escrito = String(input ? input.value : '').trim();
  if (escrito.toLocaleLowerCase('es-CL') !== nombre.toLocaleLowerCase('es-CL')) {
    avisar('<div class="aviso aviso--warn">Escribe el nombre exacto de la tienda para confirmar.</div>');
    if (input) input.focus();
    return;
  }
  const abiertos = Number(ctx.tienda.pedidos_pendientes) || 0;
  if (abiertos) {
    avisar('<div class="aviso aviso--err">No se puede eliminar: hay ' + abiertos +
      ' pedido' + (abiertos === 1 ? '' : 's') + ' sin cerrar.</div>');
    return;
  }

  estado.borrando = true;
  const boton = $('[data-borrar]', caja);
  if (boton) { boton.disabled = true; boton.textContent = 'Eliminando…'; }
  if (input) input.disabled = true;
  try {
    await llamar('local_borrar', { local_id: ctx.tienda.id });
    estado.borrando = false;
    estado.pedidos = null;
    ctx.recargar();
  } catch (fallo) {
    estado.borrando = false;
    if (boton) { boton.disabled = false; boton.textContent = 'Eliminar esta tienda'; }
    if (input) input.disabled = false;
    avisar('<div class="aviso aviso--err">' +
      esc(fallo && fallo.message ? fallo.message : 'No se pudo eliminar la tienda.') + '</div>');
  }
}

/* ── enganches ───────────────────────────────────────────────────────────── */

function enganchar(caja, ctx) {
  $('[data-salir]', caja)?.addEventListener('click', () => ctx.salirSesion());
  $('[data-activo]', caja)?.addEventListener('click', () => cambiarActivo(caja, ctx));
  $('[data-contacto]', caja)?.addEventListener('submit', (e) => {
    e.preventDefault();
    guardarContacto(caja, ctx);
  });
  caja.querySelectorAll('[data-export]').forEach((b) => {
    b.addEventListener('click', () => exportar(caja, ctx, b.dataset.export));
  });

  const input = $('[data-nombre-tienda]', caja);
  const borrar = $('[data-borrar]', caja);
  if (input && borrar) {
    const nombre = String(ctx.tienda.nombre || 'Mi tienda').trim().toLocaleLowerCase('es-CL');
    const revisar = () => {
      borrar.disabled = String(input.value || '').trim().toLocaleLowerCase('es-CL') !== nombre;
    };
    input.addEventListener('input', revisar);
    borrar.addEventListener('click', () => borrarTienda(caja, ctx));
    revisar();
  }
}

function pintar(caja, ctx) {
  caja.innerHTML = pantalla(ctx);
  enganchar(caja, ctx);
}

arrancar({
  alListo(ctx) {
    estado.ctx = ctx;
    estado.pedidos = null;
    estado.errorPedidos = '';
    estado.guardando = false;
    estado.exportando = '';
    estado.borrando = false;
    const caja = $('[data-negocio]');
    if (caja) pintar(caja, ctx);
  },
});
