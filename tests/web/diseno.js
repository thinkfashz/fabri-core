#!/usr/bin/env node
/* Pruebas de la nube: contrato del shell, del sistema visual y del offline.
 *
 * No hay navegador headless en este entorno, así que se verifica lo que de
 * verdad se rompe en silencio:
 *   · un id que app.js busca y el HTML ya no tiene (botón muerto);
 *   · una clase usada en el markup y ausente en styles.css (bloque sin estilo);
 *   · un asset del precache que no existe (service worker que nunca instala);
 *   · un Lottie mal formado (hueco en blanco sin error visible);
 *   · una dependencia remota (la PWA deja de arrancar sin red).
 *
 * Uso: node tests/web/diseno.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..', '..');
const WEB = path.join(RAIZ, 'web');
const APP = path.join(WEB, 'app');

const leer = p => fs.readFileSync(p, 'utf8');
const existe = p => fs.existsSync(p);

let fallos = 0;
const ok = (nombre, cond, detalle) => {
  if (cond) console.log('  \x1b[1;32m✔\x1b[0m ' + nombre);
  else { fallos++; console.log('  \x1b[1;31m✖\x1b[0m ' + nombre + (detalle ? ' → ' + detalle : '')); }
};

const appHtml = leer(path.join(APP, 'index.html'));
const appJs = leer(path.join(APP, 'app.js'));
const css = leer(path.join(APP, 'styles.css'));
const sw = leer(path.join(APP, 'sw.js'));
const landing = leer(path.join(WEB, 'index.html'));

console.log('\n▸ nube · contrato del shell');

/* 1 · Toda referencia `$('#id')` de app.js debe existir en el HTML estático.
       app.js sólo toca nodos del shell; los módulos crean los suyos. */
{
  const ids = new Set();
  for (const m of appJs.matchAll(/\$\('#([A-Za-z][\w-]*)'/g)) ids.add(m[1]);
  for (const m of appJs.matchAll(/getElementById\('([A-Za-z][\w-]*)'\)/g)) ids.add(m[1]);

  const faltan = [...ids].filter(id => !new RegExp('id="' + id + '"').test(appHtml));
  ok('app.js encuentra sus ' + ids.size + ' ids en el HTML', faltan.length === 0,
    'faltan: ' + faltan.join(', '));
}

/* 2 · El contrato de inventario y las pantallas generadas por los módulos. */
{
  const requeridos = [
    'invPasos', 'inv-guia-1', 'inv-guia-2', 'inv-guia-3', 'inv-guia-4', 'inv-guia-5',
    'invKey', 'invKeySub', 'invKeyBadge', 'invDbSub', 'invDbBadge',
    'btnInvKey', 'btnInvAsegurar', 'btnInvBajar',
    'invKpis', 'invKTotal', 'invKValor', 'invKUtil', 'invKBajo',
    'invFcodigo', 'invFnombre', 'invFmarca', 'invFcategoria', 'invFcosto', 'invFprecio',
    'invFstock', 'invFminimo', 'invFreeChips', 'btnInvSubir', 'invSubirEstado',
    'invFiltro', 'invLista',
    'invBolProducto', 'invBolCantidad', 'btnInvBolAgregar', 'invCarrito',
    'invBolDetalle', 'invBolTotal', 'invBolFormato', 'btnInvImprimir',
    'pro-datos', 'pro-ia', 'pro-hoja', 'pro-cuenta', 'login'
  ];
  const faltan = requeridos.filter(id => !new RegExp('id="' + id + '"').test(appHtml));
  ok('el contrato de inventario está completo (' + requeridos.length + ' ids)', faltan.length === 0,
    'faltan: ' + faltan.join(', '));
}

/* 3 · Cada botón de navegación apunta a una pantalla que existe. */
{
  const destinos = [...appHtml.matchAll(/data-go="([a-z]+)"/g)].map(m => m[1]);
  const unicos = [...new Set(destinos)];
  const sinPantalla = unicos.filter(d => !new RegExp('id="s-' + d + '"').test(appHtml));
  ok('los ' + unicos.length + ' destinos del nav tienen pantalla', sinPantalla.length === 0,
    sinPantalla.join(', '));
  const sinBoton = ['panel', 'chat', 'sql', 'mem', 'inv', 'wiki', 'flow', 'datos', 'ia', 'hoja', 'cuenta']
    .filter(d => !unicos.includes(d));
  ok('las 11 pantallas son alcanzables desde el nav', sinBoton.length === 0, sinBoton.join(', '));
}

/* 4 · La barra inferior no puede quedar con más de 5 destinos + «Más». */
{
  // El botón «Panel» lleva `class="on"` antes de data-go, así que hay que leer
  // la etiqueta completa y recién después descartar las secundarias.
  const principal = [...appHtml.matchAll(/<button\b[^>]*data-go="([a-z]+)"[^>]*>/g)]
    .filter(m => !/data-mas/.test(m[0]))
    .map(m => m[1]);
  ok('la barra móvil muestra 5 secciones + hoja «más»', principal.length === 5,
    'visibles: ' + principal.join(', '));
  ok('el disparador «Más» no es un <button> (app.js enlaza todos)', /<div class="nav-more" id="navMore"/.test(appHtml));
  ok('el disparador «Más» se ve en móvil', /\.nav-more\{display:flex/.test(css));
}

console.log('\n▸ nube · sistema visual');

/* 5 · Toda clase usada en el HTML debe tener regla en styles.css. */
{
  const clases = new Set();
  for (const m of appHtml.matchAll(/class="([^"]+)"/g)) {
    m[1].split(/\s+/).filter(Boolean).forEach(c => clases.add(c));
  }
  const ignorar = new Set(['on', 'listo', 'fallo', 'in']); // estados que agrega JS/CSS
  const sinEstilo = [...clases].filter(c => !ignorar.has(c) &&
    !new RegExp('\\.' + c.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&') + '(?![\\w-])').test(css));
  ok('las ' + clases.size + ' clases del HTML tienen estilo', sinEstilo.length === 0,
    sinEstilo.join(', '));
}

/* 6 · Toda clase de una plantilla de los módulos debe tener regla, en
       styles.css o en la hoja propia del documento que la usa. La boleta
       impresa se abre en un iframe con su <style> aislado: sus clases
       (.nota, .total, .pie) no tienen por qué existir en la app, pero sí en
       su propio documento. Antes se comparaban todas contra styles.css y
       esas tres salían como error. */
{
  const escapar = c => c.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
  const tieneRegla = (fuente, c) =>
    new RegExp('\\.' + escapar(c) + '(?![\\w-])').test(fuente);

  // Estados que sólo marcan un nodo para el JS; no pintan nada.
  const marcadores = new Set(['listo', 'in']);
  const sinEstilo = [];
  let total = 0;

  for (const archivo of ['app.js', 'core-pro.js', 'core-sheet.js', 'cloud.js', 'core-scan.js', 'core-wiki.js']) {
    const fuente = leer(path.join(APP, archivo));
    const propias = [...fuente.matchAll(/<style>([\s\S]*?)<\/style>/g)]
      .map(m => m[1]).join('\n');
    // Las interpolaciones se vacían: `class="badge ${x}"` deja de ser un
    // nombre de clase inventado y pasa a ser `badge`. Y las concatenaciones
    // (`class="item ' + (cond ? ' sel' : '') + '"`) se colapsan a su texto.
    const markup = fuente
      .replace(/\$\{[^}]*\}/g, '')
      .replace(/'\s*\+\s*[\s\S]*?\+\s*'/g, ' ');
    const clases = new Set();
    for (const m of markup.matchAll(/class="([^"]+)"/g)) {
      m[1].split(/\s+/).filter(c => /^[A-Za-z][\w-]*$/.test(c)).forEach(c => clases.add(c));
    }
    for (const c of clases) {
      if (marcadores.has(c)) continue;
      total++;
      if (!tieneRegla(css, c) && !tieneRegla(propias, c)) sinEstilo.push(archivo + ' · ' + c);
    }
  }

  ok('las ' + total + ' clases de las plantillas tienen regla', sinEstilo.length === 0,
    sinEstilo.join(', '));

  // La boleta no puede depender de styles.css: si un día deja de traer su
  // propia hoja, se imprimiría sin estilos y sin aviso.
  const boleta = leer(path.join(APP, 'core-pro.js'));
  const suHoja = (boleta.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
  const suyas = ['nota', 'linea', 'total', 'pie'];
  const faltan = suyas.filter(c => !tieneRegla(suHoja, c));
  ok('la boleta impresa lleva su propia hoja', faltan.length === 0, faltan.join(', '));
}

/* 7 · Tokens que app.js escribe y el CSS debe declarar. */
{
  const tokens = ['--accent', '--accent-soft', '--accent-2', '--tx', '--bg', '--line', '--r-md'];
  const faltan = tokens.filter(t => !css.includes(t + ':'));
  ok('el CSS declara los tokens que app.js usa', faltan.length === 0, faltan.join(', '));
  ok('el tema por defecto es Aurora', /theme:\s*localStorage\.getItem\('fcore\.theme'\)\s*\|\|\s*'aurora'/.test(appJs));
}

/* 7b · Los tokens que usan los módulos también deben existir: un `var(--bd)`
       sin declarar deja el borde en currentColor y nadie lo nota hasta verlo. */
{
  const definidos = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));
  const usados = new Set();
  for (const f of ['index.html', 'core-pro.js', 'core-sec.js', 'core-sheet.js', 'app.js', 'cloud.js']) {
    for (const m of leer(path.join(APP, f)).matchAll(/var\((--[a-z0-9-]+)/g)) usados.add(m[1]);
  }
  const faltan = [...usados].filter(t => !definidos.has(t));
  ok('los ' + usados.size + ' tokens usados por los módulos existen', faltan.length === 0, faltan.join(', '));
}

/* 8 · El modo reducido y la impresión no pueden faltar. */
ok('respeta prefers-reduced-motion', /prefers-reduced-motion:reduce/.test(css));
ok('tiene hoja de impresión aislada', /@media print/.test(css));

console.log('\n▸ nube · animaciones Lottie');

/* 9 · Cada JSON es Bodymovin válido y las capas tienen formas. */
{
  const anim = path.join(APP, 'anim');
  const archivos = existe(anim) ? fs.readdirSync(anim).filter(f => f.endsWith('.json')) : [];
  ok('existen las 5 animaciones', archivos.length === 5, archivos.join(', '));
  for (const f of archivos) {
    let j = null;
    try { j = JSON.parse(leer(path.join(anim, f))); } catch (e) { ok(f + ' parsea', false, e.message); continue; }
    const capas = Array.isArray(j.layers) ? j.layers : [];
    const formas = capas.every(l => l.ty === 4 && Array.isArray(l.shapes) && l.shapes.length);
    ok(f, j.v === '5.7.4' && j.op > 0 && capas.length > 0 && formas,
      'v=' + j.v + ' capas=' + capas.length);
  }
}

/* 10 · Todo `data-lottie` resuelve a un archivo real (app y landing). */
{
  const refs = [];
  for (const [doc, base] of [[appHtml, APP], [landing, WEB]]) {
    for (const m of doc.matchAll(/data-lottie="([^"]+)"/g)) refs.push({ ruta: m[1], base });
  }
  const rotas = refs.filter(r => !existe(path.resolve(r.base, r.ruta)));
  ok(refs.length + ' referencias Lottie resuelven', rotas.length === 0,
    rotas.map(r => r.ruta).join(', '));
  ok('lottie-web está vendorizado', existe(path.join(APP, 'vendor', 'lottie.min.js')));
  ok('el cargador compartido existe', existe(path.join(APP, 'lottie-mount.js')));
}

console.log('\n▸ nube · offline y arranque');

/* 11 · El precache del service worker debe apuntar a archivos existentes. */
{
  const bloque = (sw.match(/const SHELL = \[([\s\S]*?)\];/) || [])[1] || '';
  const rutas = [...bloque.matchAll(/'([^']+)'/g)].map(m => m[1]);
  const faltan = rutas.filter(r => {
    if (r === './') return !existe(APP);
    return !existe(path.resolve(APP, r));
  });
  ok('el precache lista ' + rutas.length + ' archivos y todos existen', faltan.length === 0,
    faltan.join(', '));
  ok('el service worker versiona la caché', /const V = 'fcore-v\d+'/.test(sw));
  ok('cloud.js y lottie-mount.js se precachean', rutas.includes('./cloud.js') && rutas.includes('./lottie-mount.js'));
  ok('las animaciones se precachean', rutas.some(r => r.startsWith('./anim/')));
}

/* 12 · Nada remoto: sin CDN, la app tiene que arrancar sin red. */
{
  const remotos = [];
  for (const [doc, nombre] of [[appHtml, 'app'], [landing, 'landing']]) {
    for (const m of doc.matchAll(/<script[^>]+src="([^"]+)"/g)) {
      if (/^https?:|^\/\//.test(m[1])) remotos.push(nombre + ': ' + m[1]);
    }
    for (const m of doc.matchAll(/<link[^>]+href="([^"]+)"/g)) {
      if (/^https?:|^\/\//.test(m[1])) remotos.push(nombre + ': ' + m[1]);
    }
  }
  ok('no hay scripts ni hojas remotas', remotos.length === 0, remotos.join(', '));
  ok('la app carga sus scripts en orden', /vendor\/lottie\.min\.js[\s\S]*app\.js[\s\S]*cloud\.js/.test(appHtml));
  ok('la app carga el cargador Lottie compartido', /lottie-mount\.js/.test(appHtml));
  ok('el escáner y la wiki cargan antes de app.js',
    /core-scan\.js[\s\S]*core-wiki\.js[\s\S]*app\.js/.test(appHtml));
  ok('el decodificador de respaldo no se precachea (se carga sólo si hace falta)',
    !/zxing\.min\.js/.test(sw) && existe(path.join(APP, 'vendor', 'zxing.min.js')));
}

/* 12b · El overlay del escáner no puede compartir clase con el hueco Lottie:
       `.lot.scan` mide 170×130 y una regla `.scan{position:fixed}` lo
       convertía en un panel a pantalla completa que además lo ocultaba. */
{
  const css = leer(path.join(APP, 'styles.css'));
  ok('el overlay del escáner tiene clase propia', /^\.scanui\{/m.test(css) && !/^\.scan\{/m.test(css));
  ok('la clase del overlay no se usa en el HTML', !/class="[^"]*\bscanui\b/.test(appHtml));
  ok('el hueco Lottie conserva su medida', /\.lot\.scan\{[^}]*height:130px/.test(css));
}

/* 12c · Los ids que usa la wiki existen: en el HTML estático o en una
       plantilla de la propia wiki (el formulario de «completar ficha» se
       inyecta sólo cuando la búsqueda no encuentra nada). */
{
  const wiki = leer(path.join(APP, 'core-wiki.js'));
  const ids = new Set();
  for (const m of wiki.matchAll(/\$\('#([A-Za-z][\w-]*)'/g)) ids.add(m[1]);
  const existeId = id => new RegExp('id="' + id + '"').test(appHtml) ||
    new RegExp('id="' + id + '"').test(wiki);
  const faltan = [...ids].filter(id => !existeId(id));
  ok('la wiki encuentra sus ' + ids.size + ' ids (HTML o plantilla propia)', faltan.length === 0,
    faltan.join(', '));
}

/* 13 · Sintaxis de todos los JS de la web. */
{
  const js = ['app.js', 'cloud.js', 'lottie-mount.js', 'core-pro.js', 'core-sec.js', 'core-sheet.js',
    'core-xlsx.js', 'core-scan.js', 'core-wiki.js']
    .filter(f => existe(path.join(APP, f)));
  const malos = [];
  for (const f of js) {
    try { new vm.Script(leer(path.join(APP, f)), { filename: f }); }
    catch (e) { malos.push(f + ': ' + e.message); }
  }
  ok('los ' + js.length + ' scripts parsean', malos.length === 0, malos.join(' | '));
}

/* 14 · Manifest y cabeceras de caché. */
{
  const m = JSON.parse(leer(path.join(APP, 'manifest.webmanifest')));
  ok('el manifest mantiene el modo app', m.display === 'standalone' && m.start_url === './');
  ok('el manifest usa el azul noche de la nube', /^#04060d$/i.test(m.theme_color), m.theme_color);

  // Los iconos se regeneran con scripts/iconos-nube.py: si alguien cambia el
  // manifest o borra un PNG, el icono de la PWA queda roto sin aviso.
  const iconos = Array.isArray(m.icons) ? m.icons : [];
  const iconosMalos = iconos.filter(ic => {
    const p = path.resolve(APP, ic.src);
    if (!existe(p)) return true;
    const b = fs.readFileSync(p);
    if (b.length < 24 || b.toString('ascii', 1, 4) !== 'PNG') return true;
    return (ic.sizes || '') !== (b.readUInt32BE(16) + 'x' + b.readUInt32BE(20));
  });
  ok('los ' + iconos.length + ' iconos del manifest existen y miden lo declarado',
    iconos.length > 0 && iconosMalos.length === 0, iconosMalos.map(i => i.src).join(', '));

  const v = JSON.parse(leer(path.join(WEB, 'vercel.json')));
  const fuentes = v.headers.map(h => h.source);
  ok('Vercel cachea vendor y anim como inmutable',
    fuentes.includes('/app/vendor/(.*)') && fuentes.includes('/app/anim/(.*)'));
  ok('el service worker no se cachea', fuentes.includes('/app/sw.js'));
}

/* 15 · La landing apunta a la consola y conserva la malla real. */
{
  ok('la landing enlaza a ./app/', /href="\.\/app\/"/.test(landing));
  ok('la landing consulta /api/estado', /fetch\("\/api\/estado"/.test(landing));
  ok('la landing usa el cargador Lottie compartido', /lottie-mount\.js/.test(landing));
  ok('la landing no promete FTS5 sin comprobar', /FTS5[\s\S]{0,120}comprob/.test(landing) || /comprob[\s\S]{0,120}FTS5/.test(landing));
}

console.log(fallos === 0
  ? '\n\x1b[1;32m✔ nube: contrato, sistema visual y offline en orden\x1b[0m\n'
  : '\n\x1b[1;31m✖ nube: ' + fallos + ' fallo(s)\x1b[0m\n');
process.exit(fallos === 0 ? 0 : 1);