/* ============================================================================
   Wiki de productos de la nube
   ----------------------------------------------------------------------------
   Qué hace
     · Busca un código de barras en Open Food Facts, Open Beauty Facts y
       Open Products Facts —las tres libres, sin clave y con CORS abierto—.
     · Guarda lo encontrado en la SQLite del navegador (`product_wiki`), así
       el segundo escaneo es instantáneo y funciona sin conexión.
     · Cuando ninguna base conoce el código, deja completar la ficha a mano:
       esa ficha también queda en la wiki local. Es lo que pasa con la mayor
       parte del catálogo chileno, que las bases abiertas todavía no cubren.

   Licencia de los datos: Open Database License (ODbL). La atribución es
   obligatoria y va visible en la pantalla, no escondida en un comentario.
   ========================================================================== */
(() => {
  'use strict';

  const FUENTES = [
    { id: 'food', nombre: 'Open Food Facts', url: 'https://world.openfoodfacts.org' },
    { id: 'beauty', nombre: 'Open Beauty Facts', url: 'https://world.openbeautyfacts.org' },
    { id: 'products', nombre: 'Open Products Facts', url: 'https://world.openproductsfacts.org' },
  ];

  const CAMPOS = [
    'code', 'product_name', 'product_name_es', 'brands', 'quantity', 'categories',
    'categories_tags', 'image_front_small_url', 'image_front_url', 'nutriscore_grade',
    'nutrition_grades', 'nova_group', 'ingredients_text_es', 'ingredients_text',
    'allergens_tags', 'labels_tags', 'countries_tags', 'stores', 'origins',
  ].join(',');

  const $ = (sel, raiz) => (raiz || document).querySelector(sel);
  const $$ = (sel, raiz) => [...(raiz || document).querySelectorAll(sel)];
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const F = () => window.Fabri || null;
  const ahora = () => Math.floor(Date.now() / 1000);

  /* ── helpers puros (probados en tests/web/escaneo.js) ─────────────────── */

  const titulo = t => String(t || '').trim().replace(/\s+/g, ' ');

  /** «400 g e»: la «e» final es la marca de cantidad estimada, no una unidad. */
  function cantidadLimpia(q) {
    const t = titulo(q);
    return /\d/.test(t) ? t.replace(/\s+e$/i, '') : t;
  }

  /** Normaliza el grado Nutri-Score: OFF devuelve 'a'…'e' o 'unknown'. */
  function grado(v) {
    const g = String(v || '').trim().toLowerCase();
    return ['a', 'b', 'c', 'd', 'e'].includes(g) ? g : '';
  }

  /** NOVA 1–4; cualquier otra cosa se descarta antes de pintarla. */
  function nova(v) {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 4 ? n : 0;
  }

  /**
   * Traduce las categorías de Open Food Facts a las del inventario. Sin esto,
   * un yogur entraría como «abarrotes» y el filtro de la app no serviría.
   */
  function categoriaInv(p) {
    const tags = (p.categories_tags || []).join(' ').toLowerCase() + ' ' +
      String(p.categories || '').toLowerCase() + ' ' + String(p.product_name || '').toLowerCase();
    const reglas = [
      ['bebidas', /bebida|drink|agua|water|jugo|juice|refresco|soda|gaseosa|caf[eé]|\bt[eé]\b|energizante|isot[oó]nica/],
      ['alcohol', /cerveza|beer|vino|wine|licor|spirit|whisk|vodka|pisco|ron\b|gin\b/],
      ['lacteos', /l[aá]cteo|dairy|leche|milk|yogur|yoghurt|queso|cheese|mantequilla|butter|crema/],
      ['dulces', /dulce|sweet|candy|chocolate|galleta|biscuit|cookie|caramelo|postre|dessert|helado|ice cream/],
      ['congelados', /congelad|frozen/],
      ['mascotas', /mascota|pet food|perro|gato|dog\b|cat\b/],
      ['limpieza', /limpieza|clean|detergente|detergent|jab[oó]n|soap|lavaloza|desinfect|cloro|lej[ií]a/],
      ['cosmetica', /cosm[eé]tic|cosmetic|shampoo|champ[uú]|crema facial|perfume|desodorante|maquillaje/],
      ['abarrotes', /arroz|rice|pasta|harina|flour|aceite|oil|az[uú]car|sugar|sal\b|salsa|conserva|legumbre|at[uú]n|tuna|snack|papas fritas|chip/],
    ];
    for (const [cat, re] of reglas) if (re.test(tags)) return cat;
    return 'otros';
  }

  /** OFF entrega el producto crudo; aquí queda con la forma de la app. */
  function normalizar(p, fuente) {
    if (!p || !p.code) return null;
    const f = fuente || FUENTES[0];
    const nombre = titulo(p.product_name_es || p.product_name);
    const marca = titulo(String(p.brands || '').split(',')[0]);
    const etiquetas = (p.labels_tags || [])
      .map(t => String(t).replace(/^[a-z]{2}:/, '').replace(/-/g, ' '))
      .filter(Boolean).slice(0, 6);
    const alergenos = (p.allergens_tags || [])
      .map(t => String(t).replace(/^[a-z]{2}:/, '').replace(/-/g, ' '))
      .filter(Boolean).slice(0, 8);
    return {
      codigo: String(p.code),
      nombre: nombre || marca || 'Producto sin nombre',
      marca,
      cantidad: cantidadLimpia(p.quantity),
      categoria: categoriaInv(p),
      imagen: p.image_front_small_url || p.image_front_url || '',
      nutri: grado(p.nutriscore_grade || p.nutrition_grades),
      nova: nova(p.nova_group),
      etiquetas,
      alergenos,
      ingredientes: titulo(p.ingredients_text_es || p.ingredients_text),
      fuente: f.id,
      fuenteNombre: f.nombre,
      url: f.url + '/product/' + encodeURIComponent(p.code),
      actualizado: ahora(),
    };
  }

  /* ── almacenamiento local ─────────────────────────────────────────────── */

  let tablaLista = false;
  function asegurarTabla() {
    if (tablaLista) return true;
    const fab = F();
    if (!fab || !fab.S || !fab.S.db) return false;
    try {
      fab.run(`CREATE TABLE IF NOT EXISTS product_wiki(
        codigo TEXT PRIMARY KEY, nombre TEXT, marca TEXT, categoria TEXT, cantidad TEXT,
        imagen TEXT, nutri TEXT, nova INTEGER, etiquetas TEXT, alergenos TEXT,
        ingredientes TEXT, fuente TEXT, url TEXT, actualizado INTEGER)`);
      tablaLista = true;
    } catch (e) { console.warn('[wiki] no pude crear la tabla', e); }
    return tablaLista;
  }

  function guardar(p) {
    if (!p || !p.codigo || !asegurarTabla()) return false;
    try {
      F().run(`INSERT INTO product_wiki
        (codigo,nombre,marca,categoria,cantidad,imagen,nutri,nova,etiquetas,alergenos,ingredientes,fuente,url,actualizado)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(codigo) DO UPDATE SET nombre=excluded.nombre,marca=excluded.marca,
          categoria=excluded.categoria,cantidad=excluded.cantidad,imagen=excluded.imagen,
          nutri=excluded.nutri,nova=excluded.nova,etiquetas=excluded.etiquetas,
          alergenos=excluded.alergenos,ingredientes=excluded.ingredientes,
          fuente=excluded.fuente,url=excluded.url,actualizado=excluded.actualizado`,
      [p.codigo, p.nombre, p.marca, p.categoria, p.cantidad, p.imagen, p.nutri, p.nova,
        JSON.stringify(p.etiquetas || []), JSON.stringify(p.alergenos || []),
        p.ingredientes, p.fuente, p.url, p.actualizado || ahora()]);
      // La escritura es directa: sin este save() la ficha vive en memoria y se
      // pierde al recargar, que es justo lo que la wiki viene a evitar.
      if (F().save) F().save();
      return true;
    } catch (e) { console.warn('[wiki] no pude guardar', e); return false; }
  }

  function leer(codigo) {
    if (!asegurarTabla()) return null;
    try {
      const r = F().one('SELECT * FROM product_wiki WHERE codigo=?', [codigo]);
      if (!r) return null;
      return Object.assign({}, r, {
        etiquetas: JSON.parse(r.etiquetas || '[]'),
        alergenos: JSON.parse(r.alergenos || '[]'),
        fuenteNombre: (FUENTES.find(f => f.id === r.fuente) || {}).nombre || 'ficha local',
        deCache: true,
      });
    } catch (_) { return null; }
  }

  function listar(filtro) {
    if (!asegurarTabla()) return [];
    try {
      const q = String(filtro || '').trim();
      const sql = q
        ? `SELECT * FROM product_wiki WHERE nombre LIKE ? OR marca LIKE ? OR codigo LIKE ?
           ORDER BY actualizado DESC LIMIT 60`
        : 'SELECT * FROM product_wiki ORDER BY actualizado DESC LIMIT 60';
      const filas = q ? F().q(sql, ['%' + q + '%', '%' + q + '%', '%' + q + '%']) : F().q(sql);
      return filas.map(r => Object.assign({}, r, {
        etiquetas: JSON.parse(r.etiquetas || '[]'),
        alergenos: JSON.parse(r.alergenos || '[]'),
        deCache: true,
      }));
    } catch (_) { return []; }
  }

  /* ── red ──────────────────────────────────────────────────────────────── */

  async function pedir(fuente, codigo) {
    const ctrl = new AbortController();
    const reloj = setTimeout(() => ctrl.abort(), 9000);
    try {
      const r = await fetch(fuente.url + '/api/v2/product/' + encodeURIComponent(codigo) + '.json?fields=' + CAMPOS,
        { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      if (!r.ok) return null;
      const j = await r.json();
      if (j && j.status === 1 && j.product) return normalizar(j.product, fuente);
      return null;
    } catch (_) {
      return null;
    } finally { clearTimeout(reloj); }
  }

  /**
   * Cascada: comida → cosmética → productos. Si la red falla y hay una ficha
   * guardada, se devuelve la guardada marcada como `deCache` en vez de un
   * error: en la góndola, una ficha vieja sirve más que ninguna.
   */
  async function consultar(codigo) {
    const c = String(codigo || '').trim();
    if (!c) return { ok: false, motivo: 'sin codigo' };
    const guardada = leer(c);
    if (guardada && (ahora() - (guardada.actualizado || 0)) < 60 * 60 * 24 * 30) {
      return { ok: true, producto: guardada, fuente: guardada.fuenteNombre, deCache: true };
    }
    // Presupuesto total, no por fuente: tres esperas de 9 s dejarían al
    // usuario 27 s mirando un spinner en la góndola.
    const limite = Date.now() + 12000;
    for (const f of FUENTES) {
      if (Date.now() > limite) break;
      const p = await pedir(f, c);
      if (p) { guardar(p); return { ok: true, producto: p, fuente: f.nombre }; }
    }
    if (guardada) return { ok: true, producto: guardada, fuente: guardada.fuenteNombre, deCache: true, vencida: true };
    return { ok: false, motivo: 'no encontrado' };
  }

  /* ── ficha ────────────────────────────────────────────────────────────── */

  function selloNutri(g) {
    return g ? `<span class="wiki-nutri n-${g}" title="Nutri-Score">Nutri-Score ${g.toUpperCase()}</span>` : '';
  }

  function selloNova(n) {
    return n ? `<span class="wiki-nova" title="Nivel de procesamiento NOVA">NOVA ${n}</span>` : '';
  }

  function ficha(p) {
    if (!p) return '';
    const img = p.imagen
      ? `<img class="wiki-img" src="${esc(p.imagen)}" alt="${esc(p.nombre)}" loading="lazy" decoding="async"
             onerror="this.closest('.wiki-foto').classList.add('sin-foto');this.remove()">`
      : '';
    const etiquetas = (p.etiquetas || []).slice(0, 5)
      .map(t => `<span class="wiki-chip">${esc(t)}</span>`).join('');
    const alergenos = (p.alergenos || []).length
      ? `<div class="wiki-alerg"><b>Alérgenos</b> ${esc(p.alergenos.join(', '))}</div>` : '';
    return `<article class="wiki-ficha">
      <div class="wiki-foto${p.imagen ? '' : ' sin-foto'}">
        ${img}
        <span class="wiki-marca-agua">${esc((p.fuenteNombre || 'local').replace('Open ', ''))}</span>
      </div>
      <div class="wiki-cuerpo">
        ${p.marca ? `<div class="wiki-marca">${esc(p.marca)}</div>` : ''}
        <h2 class="wiki-nombre">${esc(p.nombre)}</h2>
        <div class="wiki-linea">
          ${p.cantidad ? `<span class="wiki-cant">${esc(p.cantidad)}</span>` : ''}
          ${selloNutri(p.nutri)}${selloNova(p.nova)}
        </div>
        <div class="wiki-datos">
          <div class="wiki-dato"><b>Código</b><span class="mono">${esc(p.codigo)}</span></div>
          <div class="wiki-dato"><b>Categoría</b><span>${esc(p.categoria)}</span></div>
          ${p.fuenteNombre ? `<div class="wiki-dato"><b>Fuente</b><span>${esc(p.fuenteNombre)}</span></div>` : ''}
          ${p.deCache ? `<div class="wiki-dato"><b>Guardado</b><span>en este navegador</span></div>` : ''}
        </div>
        ${etiquetas ? `<div class="wiki-chips">${etiquetas}</div>` : ''}
        ${alergenos}
        ${p.ingredientes ? `<p class="wiki-ing">${esc(p.ingredientes)}</p>` : ''}
        <div class="wiki-acciones">
          <button class="btn primary" type="button" data-wiki-usar="${esc(p.codigo)}">Usar en el inventario</button>
          ${p.url ? `<a class="btn ghost" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Ficha original</a>` : ''}
        </div>
      </div>
    </article>`;
  }

  function itemLista(p) {
    return `<button class="wiki-item" type="button" data-wiki-abrir="${esc(p.codigo)}">
      <span class="wiki-item-foto">${p.imagen
        ? `<img src="${esc(p.imagen)}" alt="" loading="lazy" decoding="async">` : ''}</span>
      <span class="grow">
        <span class="t">${esc(p.nombre)}</span>
        <span class="s mono">${esc(p.codigo)}${p.marca ? ' · ' + esc(p.marca) : ''}</span>
      </span>
      ${p.nutri ? `<span class="wiki-nutri n-${p.nutri}">${p.nutri.toUpperCase()}</span>` : ''}
    </button>`;
  }

  /** Versión de una línea para el alta de inventario, donde no cabe la ficha. */
  function miniFicha(p) {
    if (!p) return '';
    const meta = [p.marca, p.cantidad, p.nutri ? 'Nutri-Score ' + p.nutri.toUpperCase() : '']
      .filter(Boolean).map(esc).join(' · ');
    return `<div class="inv-ficha">
      <span class="inv-ficha-foto">${p.imagen
        ? `<img src="${esc(p.imagen)}" alt="" loading="lazy" decoding="async">` : ''}</span>
      <span class="grow">
        <span class="t">${esc(p.nombre)}</span>
        <span class="s">${meta || esc(p.codigo)}</span>
      </span>
      <button class="btn ghost sm" type="button" data-inv-usar="${esc(p.codigo)}">Usar</button>
    </div>`;
  }

  /* ── pantalla ─────────────────────────────────────────────────────────── */

  let listo = false;

  function estado(txt, malo) {
    const n = $('#wikiEstado');
    if (!n) return;
    n.textContent = txt;
    n.className = malo ? 'hint wiki-aviso' : 'hint';
  }

  function pintarLista(filtro) {
    const caja = $('#wikiLista');
    if (!caja) return;
    const filas = listar(filtro);
    caja.innerHTML = filas.length
      ? filas.map(itemLista).join('')
      : `<div class="empty">${filtro
        ? 'Ningún producto guardado coincide con «' + esc(filtro) + '».'
        : 'La wiki está vacía. Escanea un código y quedará guardado aquí.'}</div>`;
    $$('[data-wiki-abrir]', caja).forEach(b => {
      b.onclick = () => {
        const p = leer(b.dataset.wikiAbrir);
        if (p) mostrar(p);
      };
    });
  }

  function mostrar(p, extra) {
    const caja = $('#wikiFicha');
    if (!caja) return;
    caja.innerHTML = ficha(p);
    const usar = $('[data-wiki-usar]', caja);
    if (usar) usar.onclick = () => usarEnInventario(p);
    if (extra) estado(extra, false);
    caja.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /** Rellena el alta de inventario con lo que la wiki sabe del producto. */
  function usarEnInventario(p) {
    if (!p) return;
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v == null ? '' : v; };
    set('invFcodigo', p.codigo);
    set('invFnombre', p.nombre);
    set('invFmarca', p.marca);
    const sel = document.getElementById('invFcategoria');
    if (sel && p.categoria) {
      const existe = [...sel.options].some(o => o.value === p.categoria);
      sel.value = existe ? p.categoria : 'otros';
    }
    if (window.Fabri && window.Fabri.go) window.Fabri.go('inv');
    if (window.Fabri && window.Fabri.toast) window.Fabri.toast('Ficha de ' + p.nombre + ' lista para completar');
    // El foco en el precio ahorra el paso más repetido al dar de alta.
    setTimeout(() => { const e = document.getElementById('invFprecio'); if (e) e.focus(); }, 420);
  }

  /** Busca por código o filtra la wiki local por texto. */
  async function buscar(consulta, opciones) {
    opciones = opciones || {};
    const q = String(consulta || '').trim();
    if (!q) { pintarLista(''); return null; }
    const esCodigo = /^[A-Za-z0-9]{6,48}$/.test(q);

    if (!esCodigo) {
      pintarLista(q);
      estado('Filtrando la wiki local por «' + q + '».', false);
      return null;
    }

    const codigo = q.replace(/[\s-_.]/g, '');
    if (window.Scan && !window.Scan.pareceCodigo(codigo)) {
      estado('Ese código no pasa la verificación GS1. Revisa los dígitos.', true);
      return null;
    }

    estado('Buscando ' + codigo + ' en las bases abiertas…', false);
    const r = await consultar(codigo);

    if (r.ok) {
      mostrar(r.producto, (r.deCache ? 'Ficha guardada en este navegador' : 'Encontrado en ' + r.fuente) +
        (r.vencida ? ' · sin conexión, puede estar desactualizada' : ''));
      pintarLista('');
      if (!opciones.silencioso && window.Fabri) window.Fabri.toast('Ficha encontrada: ' + r.producto.nombre);
      return r.producto;
    }

    estado('Ninguna base abierta conoce ' + codigo + '. Puedes completar la ficha a mano.', true);
    const caja = $('#wikiFicha');
    if (caja) {
      caja.innerHTML = `<div class="card wiki-vacio">
        <div class="eyebrow">Sin ficha</div>
        <h3>${esc(codigo)} no está en las bases abiertas</h3>
        <p class="hint">Es lo normal con el catálogo chileno. Escribe el nombre y quedará
          guardado en la wiki de este navegador para la próxima vez.</p>
        <div class="inv-form">
          <input class="field" id="wikiNuevoNombre" placeholder="Nombre del producto *">
          <input class="field" id="wikiNuevoMarca" placeholder="Marca">
          <select class="field ancho" id="wikiNuevoCat">
            <option value="abarrotes">Alimentos</option><option value="bebidas">Bebidas</option>
            <option value="alcohol">Alcohol</option><option value="dulces">Dulces</option>
            <option value="lacteos">Lácteos</option><option value="cosmetica">Cosmética</option>
            <option value="limpieza">Limpieza</option><option value="congelados">Congelados</option>
            <option value="mascotas">Mascotas</option><option value="otros">Otros</option>
          </select>
        </div>
        <button class="btn primary block" id="wikiNuevoGuardar" type="button">Guardar en la wiki</button>
      </div>`;
      $('#wikiNuevoGuardar').onclick = () => {
        const nombre = ($('#wikiNuevoNombre').value || '').trim();
        if (!nombre) { window.Fabri.toast('El nombre es obligatorio'); $('#wikiNuevoNombre').focus(); return; }
        const p = {
          codigo, nombre, marca: ($('#wikiNuevoMarca').value || '').trim(),
          categoria: $('#wikiNuevoCat').value, cantidad: '', imagen: '',
          nutri: '', nova: 0, etiquetas: [], alergenos: [], ingredientes: '',
          fuente: 'local', fuenteNombre: 'Wiki local', url: '', actualizado: ahora(),
        };
        guardar(p);
        mostrar(p, 'Guardado en la wiki local');
        pintarLista('');
      };
    }
    return null;
  }

  function render() {
    asegurarTabla();
    if (!listo) {
      const campo = $('#wikiQ');
      const btn = $('#btnWikiScan');
      if (campo) {
        campo.oninput = () => {
          const v = campo.value.trim();
          // Filtra al teclear, busca en la red sólo al pulsar Enter: no se
          // golpea la API en cada letra.
          if (!/^[A-Za-z0-9]{6,48}$/.test(v)) pintarLista(v);
        };
        campo.onkeydown = ev => {
          if (ev.key === 'Enter') { ev.preventDefault(); buscar(campo.value); }
        };
      }
      if (btn) btn.onclick = async () => {
        if (!window.Scan) { estado('El escáner no está cargado en esta versión.', true); return; }
        const c = await window.Scan.abrir({ subtitulo: 'apunta al código del producto' });
        if (!c) return;
        if (campo) campo.value = c;
        buscar(c);
      };
      const vaciar = $('#btnWikiLimpiar');
      if (vaciar) vaciar.onclick = () => {
        const f = $('#wikiFicha'); if (f) f.innerHTML = '';
        const c = $('#wikiQ'); if (c) c.value = '';
        pintarLista('');
        estado('Wiki local · datos de Open Food Facts, Open Beauty Facts y Open Products Facts (ODbL).');
      };
      listo = true;
    }
    pintarLista('');
    estado('Wiki local · datos de Open Food Facts, Open Beauty Facts y Open Products Facts (ODbL).');
  }

  window.Wiki = {
    render, buscar, consultar, normalizar, categoriaInv, grado, nova,
    guardar, leer, listar, usarEnInventario, ficha, miniFicha,
  };
})();
