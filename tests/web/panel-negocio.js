#!/usr/bin/env node
/* FORGE CORE STOCK · panel Negocio (N01–N08, N14, N16)
 *
 * Qué se comprueba, y por qué importa:
 *   · cada módulo es una página completa con su HTML, su CSS y su JS;
 *   · el contrato del shell es el mismo del panel Cliente (sidebar, topbar,
 *     main, hojas y scripts), así el negocio no queda a medias;
 *   · el manifiesto de navegación sólo promete rutas que existen y marca
 *     `pronto` los módulos que todavía no se construyen (nada de 404);
 *   · los enlaces internos y los assets absolutos resuelven a archivos reales;
 *   · la base de la API es la absoluta de `fabri-api`, nunca `/api` relativo;
 *   · los imports relativos de `comun/negocio.js` y de cada módulo existen.
 *
 * Uso: node tests/web/panel-negocio.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');
const WEB = path.join(RAIZ, 'web');
const PANEL = path.join(WEB, 'panel');
const NEG = path.join(PANEL, 'negocio');

const leer = (p) => fs.readFileSync(p, 'utf8');
const existe = (p) => fs.existsSync(p);

let fallos = 0;
let pasos = 0;
const ok = (nombre, cond, detalle) => {
  pasos++;
  if (cond) console.log('  \x1b[1;32m✔\x1b[0m ' + nombre);
  else {
    fallos++;
    console.log('  \x1b[1;31m✖\x1b[0m ' + nombre + (detalle ? ' → ' + detalle : ''));
  }
};

/* Los módulos de la fase 2 del negocio que ya tienen página. */
const MODULOS = ['resumen', 'pedidos', 'productos', 'inventario', 'tienda',
  'horarios', 'resenas', 'notificaciones', 'ajustes', 'conexion', 'clientes'];

console.log('\n▸ panel Negocio · estructura de los módulos');

/* 1 · Cada módulo es una página completa. */
for (const m of MODULOS) {
  const dir = path.join(NEG, m);
  const html = path.join(dir, 'index.html');
  const css = path.join(dir, m + '.css');
  const js = path.join(dir, m + '.js');
  ok('N ' + m + ' tiene index.html, ' + m + '.css y ' + m + '.js',
    existe(html) && existe(css) && existe(js),
    [!existe(html) && 'falta html', !existe(css) && 'falta css', !existe(js) && 'falta js'].filter(Boolean).join(', '));
}

/* 2 · Contrato del shell en cada HTML. */
{
  const problemas = [];
  for (const m of MODULOS) {
    const p = path.join(NEG, m, 'index.html');
    if (!existe(p)) continue;
    const h = leer(p);
    const falta = [];
    if (!/data-panel="negocio"/.test(h)) falta.push('data-panel');
    if (!new RegExp('data-modulo="' + m + '"').test(h)) falta.push('data-modulo');
    if (!/class="sidebar" id="sidebar"/.test(h)) falta.push('sidebar');
    if (!/class="topbar"/.test(h)) falta.push('topbar');
    if (!/id="contenido"/.test(h)) falta.push('main#contenido');
    if (!/href="\/components\.css"/.test(h)) falta.push('/components.css');
    if (!/href="\/panel\/comun\/shell\.css"/.test(h)) falta.push('shell.css');
    if (!/href="\/panel\/comun\/negocio\.css"/.test(h)) falta.push('negocio.css');
    if (!new RegExp('href="\\./' + m + '\\.css"').test(h)) falta.push('css propio');
    if (!/src="\/panel\/comun\/shell\.js"/.test(h)) falta.push('shell.js');
    if (!new RegExp('src="\\./' + m + '\\.js"').test(h)) falta.push('js propio');
    if (/\/panel\/comun\/negocio\.js/.test(h)) falta.push('negocio.js debe ir en JS, no en HTML');
    if (/fonts\.googleapis|cdn\.jsdelivr|unpkg\.com|cdnjs\.cloudflare|https?:\/\/[^\s"]+\.css/.test(h)) {
      falta.push('dependencia remota');
    }
    if (falta.length) problemas.push(m + ': ' + falta.join(', '));
  }
  ok('los ' + MODULOS.length + ' módulos cumplen el contrato del shell', problemas.length === 0, problemas.join(' | '));
}

/* 3 · Cada módulo pinta su contenido en [data-negocio] y usa el arranque. */
{
  const faltan = [];
  for (const m of MODULOS) {
    const js = path.join(NEG, m, m + '.js');
    if (!existe(js)) continue;
    const txt = leer(js);
    if (!/import \{[^}]*\} from '\.\.\/\.\.\/comun\/negocio\.js'/.test(txt)) faltan.push(m + ': no importa la base');
    if (!/arrancar\(/.test(txt)) faltan.push(m + ': no arranca');
    if (!/data-negocio/.test(txt)) faltan.push(m + ': no apunta al contenedor');
  }
  ok('los módulos usan la base común y arrancan', faltan.length === 0, faltan.join(' | '));
}

/* 3b · Al quedarse sin tienda, el chip de la barra no puede quedar pegado. */
{
  const base = leer(path.join(PANEL, 'comun', 'negocio.js'));
  ok('el chip de tienda se limpia al no haber tienda',
    /if \(!tiendas\.length\) \{\s*limpiarSlot\(\);/.test(base));
  ok('el chip también se limpia sin sesión', /enAcceso = true;\s*limpiarSlot\(\);/.test(base));
}

console.log('\n▸ panel Negocio · navegación y rutas');

/* 4 · El manifiesto promete rutas reales y marca `pronto` el resto. */
{
  const nav = leer(path.join(PANEL, 'comun', 'nav-negocio.js'));
  const rutas = [...nav.matchAll(/ruta:\s*'([^']+)'/g)].map((m) => m[1]);
  const pronto = new Set();
  for (const m of nav.matchAll(/ruta:\s*'([^']+)'[^}]*pronto:\s*true/g)) pronto.add(m[1]);

  const rotas = rutas.filter((r) => !pronto.has(r) && !existe(path.join(WEB, r.replace(/^\//, ''), 'index.html')));
  ok('el menú negocio apunta sólo a módulos que existen (' + rutas.filter((r) => !pronto.has(r)).length + ')',
    rotas.length === 0, rotas.join(', '));

  const colgadas = [...pronto].filter((r) => existe(path.join(WEB, r.replace(/^\//, ''), 'index.html')));
  ok('los módulos «pronto» no tienen página todavía', colgadas.length === 0, colgadas.join(', '));

  for (const m of MODULOS) {
    ok('«' + m + '» está en el menú del negocio',
      new RegExp("ruta: '/panel/negocio/" + m + "/'").test(nav));
  }

  const shell = leer(path.join(PANEL, 'comun', 'shell.js'));
  ok('el shell elige nav-negocio según data-panel',
    /panel === 'negocio'[\s\S]{0,120}nav-negocio\.js/.test(shell));
  ok('el shell manda la marca del negocio al resumen',
    /panel === 'negocio'[\s\S]{0,80}\/panel\/negocio\/resumen\//.test(shell));
}

/* 5 · Los enlaces internos y los assets absolutos resuelven. */
{
  const rotos = [];
  const vistos = new Set();
  const archivos = [];
  for (const m of MODULOS) {
    for (const ext of ['html', 'js']) {
      const p = path.join(NEG, m, m + '.' + ext);
      if (existe(p)) archivos.push(p);
    }
  }
  for (const p of archivos) {
    const txt = leer(p);
    for (const mm of txt.matchAll(/["'](\/panel\/[a-z0-9\/_.-]*)/g)) {
      let r = mm[1];
      if (!/\.[a-z]+$/.test(r) && !r.endsWith('/')) r += '/';
      if (r === '/panel/') continue;
      if (!existe(path.join(WEB, r.replace(/^\//, ''), 'index.html')) &&
          !existe(path.join(WEB, r.replace(/^\//, '')))) {
        rotos.push(path.relative(PANEL, p) + ' → ' + r);
      }
      vistos.add(r);
    }
    for (const mm of txt.matchAll(/(?:href|src)="(\/[^"#?]+)"/g)) {
      const rel = mm[1].replace(/^\//, '');
      if (!existe(path.join(WEB, rel)) && !existe(path.join(WEB, rel, 'index.html'))) {
        rotos.push(path.relative(PANEL, p) + ' → ' + mm[1]);
      }
    }
  }
  ok('las ' + vistos.size + ' rutas internas y assets del negocio existen', rotos.length === 0, rotos.join(' | '));
}

/* 6 · La API se llama por la base absoluta y no con fetch directo. */
{
  const relativas = [];
  const directos = [];
  const recorrer = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { recorrer(p); continue; }
      if (!e.name.endsWith('.js')) continue;
      const txt = leer(p);
      for (const m of txt.matchAll(/fetch\(\s*['"`]\/api\//g)) relativas.push(path.relative(PANEL, p));
      for (const m of txt.matchAll(/fetch\(/g)) directos.push(path.relative(PANEL, p));
    }
  };
  recorrer(NEG);
  recorrer(path.join(PANEL, 'comun'));
  ok('ningún archivo del panel llama a /api relativo', relativas.length === 0, [...new Set(relativas)].join(', '));
  const unicos = [...new Set(directos)].sort();
  ok('sólo el cliente HTTP común usa fetch directo',
    unicos.length === 1 && unicos[0] === path.join('comun', 'api.js'),
    unicos.join(', '));

  const neg = leer(path.join(PANEL, 'comun', 'negocio.js'));
  ok('la base negocio envía token y dispositivo', /token:\s*o\.token \|\| token\(\)/.test(neg) &&
    /dispositivo:\s*o\.dispositivo \|\| dispositivo\(\)/.test(neg));
  ok('la base negocio resuelve la tienda con local_mio', /accion === 'local_mio'|\b'llamar\('local_mio'\)/.test(neg) ||
    /llamar\('local_mio'\)/.test(neg));
  ok('la base negocio comparte la sesión de la PWA', /fcore\.nube/.test(leer(path.join(PANEL, 'comun', 'sesion.js'))));
}

/* 7 · Imports relativos del negocio resuelven. */
{
  const rotos = [];
  let total = 0;
  const revisar = (p) => {
    const txt = leer(p);
    const dir = path.dirname(p);
    for (const m of txt.matchAll(/(?:^|\n)\s*(?:import|export)[^'"]*from\s*['"](\.[^'"]+)['"]/g)) {
      total++;
      if (!existe(path.resolve(dir, m[1]))) rotos.push(path.relative(PANEL, p) + ' → ' + m[1]);
    }
  };
  for (const m of MODULOS) {
    const p = path.join(NEG, m, m + '.js');
    if (existe(p)) revisar(p);
  }
  for (const f of fs.readdirSync(path.join(PANEL, 'comun'))) {
    if (f.endsWith('.js')) revisar(path.join(PANEL, 'comun', f));
  }
  ok('los ' + total + ' imports relativos del negocio resuelven', rotos.length === 0, rotos.join(' | '));
}

/* 8 · Una clase de un módulo no depende del CSS de otro módulo. */
{
  const clases = (txt) => new Set([...txt.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
  const compartidas = new Set([
    ...clases(leer(path.join(WEB, 'components.css'))),
    ...clases(leer(path.join(PANEL, 'comun', 'shell.css'))),
    ...clases(leer(path.join(PANEL, 'comun', 'negocio.css'))),
  ]);
  const porModulo = {};
  for (const m of MODULOS) {
    const p = path.join(NEG, m, m + '.css');
    porModulo[m] = existe(p) ? clases(leer(p)) : new Set();
  }
  const fugas = [];
  for (const m of MODULOS) {
    const usadas = new Set();
    for (const ext of ['html', 'js']) {
      const p = path.join(NEG, m, m + '.' + ext);
      if (!existe(p)) continue;
      for (const mm of leer(p).matchAll(/class="([^"]+)"/g)) {
        for (const c of mm[1].split(/\s+/)) if (c) usadas.add(c);
      }
    }
    for (const c of usadas) {
      if (compartidas.has(c) || porModulo[m].has(c)) continue;
      const dueno = MODULOS.find((o) => o !== m && porModulo[o].has(c));
      if (dueno) fugas.push(m + ': .' + c + ' sólo en ' + dueno + '.css');
    }
  }
  ok('ningún módulo del negocio depende del CSS de otro módulo', fugas.length === 0, fugas.join(' | '));
}

/* 9 · Los datos que pinta cada módulo salen de las acciones reales. */
{
  const esperadas = {
    resumen: ['ventas_serie', 'pedidos_listar'],
    pedidos: ['pedidos_listar', 'pedido_estado'],
    productos: ['productos_subir', 'producto_borrar'],
    inventario: ['productos_subir'],
    tienda: ['local_actualizar', 'local_estado'],
    horarios: ['local_actualizar', 'local_estado'],
    resenas: ['resenas_panel', 'resena_moderar'],
    notificaciones: ['ventas_serie', 'push_local_suscribir', 'push_local_baja'],
    ajustes: ['local_actualizar', 'local_borrar', 'local_activo', 'pedidos_listar'],
  };
  const faltan = [];
  for (const [m, acciones] of Object.entries(esperadas)) {
    const js = path.join(NEG, m, m + '.js');
    if (!existe(js)) continue;
    const txt = leer(js);
    for (const a of acciones) {
      if (!txt.includes("'" + a + "'")) faltan.push(m + ': ' + a);
    }
  }
  ok('cada módulo llama las acciones que le corresponden', faltan.length === 0, faltan.join(', '));

  const base = leer(path.join(PANEL, 'comun', 'negocio.js'));
  ok('la base comparte la tienda entre módulos (elegir/recargar)',
    /elegir\(/.test(base) && /recargar\(/.test(base) && /fijar\(/.test(base));
  ok('sin tienda la base no inventa datos: manda a publicarla',
    /sinTiendaHtml/.test(base) && /Publicar mi tienda/.test(base));
}

/* 10 · El backend acepta el pin del negocio (N06) con límites de Chile. */
{
  const api = leer(path.join(RAIZ, 'api-telefono', 'api', 'mercado.ts'));
  ok('local_actualizar acepta lat/lon',
    /campos\.lat != null/.test(api) && /campos\.lon != null/.test(api));
  ok('el pin se valida dentro de Chile', /lat >= -56/.test(api) && /lon >= -76/.test(api));
}

/* 11 · El panel de Ajustes ve el plan y la publicación, sin filtrarlos al mapa. */
{
  const api = leer(path.join(RAIZ, 'api-telefono', 'api', 'mercado.ts'));
  ok('local_mio expone plan y activo',
    /plan: l\.plan \|\| 'gratis'/.test(api) && /activo: l\.activo !== false/.test(api));
  ok('resenas_panel cuenta las ocultas sobre todas las filas',
    /COUNT\(\*\) FILTER \(WHERE oculta = false\)/.test(api) &&
    /COUNT\(\*\) FILTER \(WHERE oculta\)/.test(api));

  const iniTienda = api.indexOf('function aTienda');
  const finTienda = api.indexOf('function ', iniTienda + 10);
  ok('aTienda público no expone el plan del dueño',
    iniTienda > 0 && finTienda > iniTienda && !/plan:/.test(api.slice(iniTienda, finTienda)));
}

console.log('\n' + (fallos ? '\x1b[1;31m' : '\x1b[1;32m') +
  (fallos ? '✖ panel-negocio: ' + fallos + ' fallo(s)' : '✔ panel-negocio: ' + pasos + ' comprobaciones OK') +
  '\x1b[0m\n');
process.exit(fallos ? 1 : 0);
