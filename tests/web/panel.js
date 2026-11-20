#!/usr/bin/env node
/* FORGE CORE STOCK · panel Cliente (fase 1)
 *
 * Qué se comprueba, y por qué importa:
 *   · cada módulo tiene su HTML, su CSS y su JS propios (el shell no impone
 *     diseño y una página no queda a medias);
 *   · todos los enlaces internos del panel resuelven a un archivo real (nada
 *     de 404 por rutas inventadas);
 *   · la API se llama SIEMPRE por la base absoluta (una ruta `/api` relativa
 *     pega en el proyecto equivocado y falla sin decir por qué);
 *   · el carrito y la sesión usan las MISMAS claves y la misma forma de item
 *     que la PWA (si cambian, el comprador pierde lo que tenía guardado);
 *   · términos, ayuda y redirecciones existen y están enlazados.
 *
 * No hay navegador headless en este entorno: se verifica el contrato que se
 * rompe en silencio, no píxeles.
 *
 * Uso: node tests/web/panel.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');
const WEB = path.join(RAIZ, 'web');
const PANEL = path.join(WEB, 'panel');

const leer = (p) => fs.readFileSync(p, 'utf8');
const existe = (p) => fs.existsSync(p);

let fallos = 0;
const ok = (nombre, cond, detalle) => {
  if (cond) console.log('  \x1b[1;32m✔\x1b[0m ' + nombre);
  else { fallos++; console.log('  \x1b[1;31m✖\x1b[0m ' + nombre + (detalle ? ' → ' + detalle : '')); }
};

const MODULOS = ['inicio', 'mapa', 'buscar', 'tienda', 'producto', 'carrito', 'checkout', 'pedido', 'pedidos', 'favoritos', 'direcciones', 'resenas', 'cuenta', 'ayuda'];

console.log('\n▸ panel · estructura de los módulos');

/* 1 · Cada módulo es una página completa con sus tres archivos. */
for (const m of MODULOS) {
  const dir = path.join(PANEL, 'cliente', m);
  const html = path.join(dir, 'index.html');
  const css = path.join(dir, m + '.css');
  const js = path.join(dir, m + '.js');
  ok('C ' + m + ' tiene index.html, ' + m + '.css y ' + m + '.js',
    existe(html) && existe(css) && existe(js),
    [!existe(html) && 'falta html', !existe(css) && 'falta css', !existe(js) && 'falta js'].filter(Boolean).join(', '));
}

/* 2 · Contrato del shell en cada HTML. */
{
  const problemas = [];
  for (const m of MODULOS) {
    const p = path.join(PANEL, 'cliente', m, 'index.html');
    if (!existe(p)) continue;
    const h = leer(p);
    const falta = [];
    if (!/data-panel="cliente"/.test(h)) falta.push('data-panel');
    if (!new RegExp('data-modulo="' + m + '"').test(h)) falta.push('data-modulo');
    if (!/class="sidebar" id="sidebar"/.test(h)) falta.push('sidebar');
    if (!/class="topbar"/.test(h)) falta.push('topbar');
    if (!/id="contenido"/.test(h)) falta.push('main#contenido');
    if (!/href="\/components\.css"/.test(h)) falta.push('/components.css');
    if (!/href="\/panel\/comun\/shell\.css"/.test(h)) falta.push('shell.css');
    if (!new RegExp('href="\\./' + m + '\\.css"').test(h)) falta.push('css propio');
    if (!/src="\/panel\/comun\/shell\.js"/.test(h)) falta.push('shell.js');
    if (!new RegExp('src="\\./' + m + '\\.js"').test(h)) falta.push('js propio');
    if (/fonts\.googleapis|cdn\.jsdelivr|unpkg\.com|cdnjs\.cloudflare|https?:\/\/[^\s"]+\.css/.test(h)) falta.push('dependencia remota');
    if (falta.length) problemas.push(m + ': ' + falta.join(', '));
  }
  ok('los ' + MODULOS.length + ' módulos cumplen el contrato del shell', problemas.length === 0, problemas.join(' | '));
}

console.log('\n▸ panel · rutas y enlaces');

/* 3 · Todo enlace/ruta interna `/panel/...` resuelve a un archivo real.
       Se excluyen los marcados `pronto` en el manifiesto de navegación. */
{
  const nav = leer(path.join(PANEL, 'comun', 'nav-cliente.js'));
  const pronto = new Set();
  for (const m of nav.matchAll(/ruta:\s*'([^']+)'[^}]*pronto:\s*true/g)) pronto.add(m[1]);
  const navTodas = [...nav.matchAll(/ruta:\s*'([^']+)'/g)].map((m) => m[1]);
  for (const r of navTodas) {
    if (pronto.has(r)) continue;
    const f = path.join(WEB, r, 'index.html');
    ok('el menú apunta a ' + r + ' (existe)', existe(f));
  }
  ok('los módulos «pronto» del menú no tienen página todavía (no hay 404)',
    [...pronto].every((r) => !existe(path.join(WEB, r, 'index.html'))),
    [...pronto].join(', '));

  const rutas = new Set();
  const archivos = [];
  for (const m of MODULOS) {
    for (const ext of ['html', 'js']) {
      const p = path.join(PANEL, 'cliente', m, m + '.' + ext);
      if (existe(p)) archivos.push(p);
    }
  }
  for (const p of [...archivos, path.join(PANEL, 'comun', 'shell.js')]) {
    const txt = leer(p);
    for (const m of txt.matchAll(/["'](\/panel\/[a-z0-9\/_.-]*)/g)) {
      let r = m[1];
      if (!/\.[a-z]+$/.test(r) && !r.endsWith('/')) r += '/';
      if (r === '/panel/' || pronto.has(r)) continue;
      rutas.add(r);
    }
  }
  const rotas = [...rutas].filter((r) => {
    const rel = r.replace(/^\//, '').replace(/\/$/, '');
    return !existe(path.join(WEB, rel, 'index.html')) && !existe(path.join(WEB, rel));
  });
  ok('las ' + rutas.size + ' rutas internas del panel existen', rotas.length === 0, rotas.join(', '));
}

/* 4 · Todos los assets absolutos de los HTML del panel existen en `web/`. */
{
  const rotos = [];
  for (const m of MODULOS) {
    const p = path.join(PANEL, 'cliente', m, 'index.html');
    if (!existe(p)) continue;
    const h = leer(p);
    for (const mm of h.matchAll(/(?:href|src)="(\/[^"#?]+)"/g)) {
      const ruta = mm[1];
      if (ruta.startsWith('//')) continue;
      const rel = ruta.replace(/^\//, '');
      const candidatos = [path.join(WEB, rel), path.join(WEB, rel, 'index.html')];
      if (!candidatos.some(existe)) rotos.push(m + ' → ' + ruta);
    }
  }
  ok('los assets absolutos de los módulos existen', rotos.length === 0, rotos.join(', '));
}

console.log('\n▸ panel · API y almacenamiento compartido');

/* 5 · La API vive en otro Vercel: base absoluta, nunca `/api` relativo. */{
  const api = leer(path.join(PANEL, 'comun', 'api.js'));
  ok('API_BASE es HTTPS absoluta', /export const API_BASE = 'https:\/\/[^']+';/.test(api));
  ok('AUTH_URL y MERCADO_URL derivan de la base', /AUTH_URL = API_BASE \+ '\/api\/auth'/.test(api) &&
    /MERCADO_URL = API_BASE \+ '\/api\/mercado'/.test(api));

  const relativas = [];
  const fetchDirectos = [];
  const recorrer = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { recorrer(p); continue; }
      if (!e.name.endsWith('.js')) continue;
      const txt = leer(p);
      for (const m of txt.matchAll(/fetch\(\s*['"`]\/api\//g)) relativas.push(path.relative(PANEL, p));
      for (const m of txt.matchAll(/fetch\(/g)) fetchDirectos.push(path.relative(PANEL, p));
    }
  };
  recorrer(PANEL);
  ok('ningún archivo del panel llama a /api relativo', relativas.length === 0, [...new Set(relativas)].join(', '));
  const directosUnicos = [...new Set(fetchDirectos)].sort();
  ok('sólo el cliente HTTP común y la ayuda usan fetch directo',
    directosUnicos.length === 2 &&
    directosUnicos[0] === path.join('cliente', 'ayuda', 'ayuda.js') &&
    directosUnicos[1] === path.join('comun', 'api.js'),
    directosUnicos.join(', '));
}

/* 5b · Cada import relativo resuelve a un archivo real.
       Un `../comun/` de más deja la página en skeleton sin error visible. */
{
  const rotos = [];
  let total = 0;
  const revisar = (p) => {
    const txt = leer(p);
    const dir = path.dirname(p);
    for (const m of txt.matchAll(/(?:^|\n)\s*(?:import|export)[^'"]*from\s*['"](\.[^'"]+)['"]/g)) {
      total++;
      if (!existe(path.resolve(dir, m[1]))) {
        rotos.push(path.relative(PANEL, p) + ' → ' + m[1]);
      }
    }
  };
  for (const m of MODULOS) {
    const p = path.join(PANEL, 'cliente', m, m + '.js');
    if (existe(p)) revisar(p);
  }
  for (const f of fs.readdirSync(path.join(PANEL, 'comun'))) {
    if (f.endsWith('.js')) revisar(path.join(PANEL, 'comun', f));
  }
  ok('los ' + total + ' imports relativos del panel resuelven', rotos.length === 0, rotos.join(', '));
}

/* 5c · Una clase que usa un módulo no puede estar definida SÓLO en el CSS de
       otro módulo. Pasó con `.exito`: vivía en checkout.css y dejaba el
       buscador de pedido con un icono de 520 px. */
{
  const clases = (txt) => new Set([...txt.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
  const compartidas = new Set([
    ...clases(leer(path.join(WEB, 'components.css'))),
    ...clases(leer(path.join(PANEL, 'comun', 'shell.css'))),
  ]);
  const porModulo = {};
  for (const m of MODULOS) {
    const p = path.join(PANEL, 'cliente', m, m + '.css');
    porModulo[m] = existe(p) ? clases(leer(p)) : new Set();
  }
  const fugas = [];
  for (const m of MODULOS) {
    const usadas = new Set();
    for (const ext of ['html', 'js']) {
      const p = path.join(PANEL, 'cliente', m, m + '.' + ext);
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
  ok('ningún módulo depende del CSS de otro módulo', fugas.length === 0, fugas.join(' | '));
  ok('la tarjeta de éxito es compartida (shell.css)', clases(leer(path.join(PANEL, 'comun', 'shell.css'))).has('exito'));
}

/* 6 · Carrito compatible con la PWA: misma clave y misma forma de item. */
{
  const carrito = leer(path.join(PANEL, 'comun', 'carrito.js'));
  const placer = leer(path.join(WEB, 'app', 'placer.js'));
  ok('el carrito usa la clave de la PWA', /const KEY = 'fcore\.placer\.carrito'/.test(carrito));
  ok('la PWA usa esa misma clave', /fcore\.placer\.carrito/.test(placer));
  ok('el item del carrito conserva n,p,c,s,l,d,i',
    /n:\s*String/.test(carrito) && /\bp:/.test(carrito) && /\bc:/.test(carrito) &&
    /\bs:/.test(carrito) && /\bl:/.test(carrito) && /\bd:/.test(carrito) && /\bi:/.test(carrito));
  ok('el carrito guarda meta de la tienda (nombre, mínimo, envío)',
    /metaDe/.test(carrito) && /minimo/.test(carrito) && /envio/.test(carrito));
  ok('el carrito no mezcla tiendas (clave por localId)', /carrito\[localId\]/.test(carrito));
}

/* 7 · Sesión y ubicación reutilizan las claves de la PWA. */
{
  const sesion = leer(path.join(PANEL, 'comun', 'sesion.js'));
  const catalogo = leer(path.join(PANEL, 'comun', 'catalogo.js'));
  const pedidos = leer(path.join(PANEL, 'comun', 'pedidos.js'));
  ok('la sesión usa fcore.nube y fcore.dispositivo',
    /const KEY = 'fcore\.nube'/.test(sesion) && /const DISP = 'fcore\.dispositivo'/.test(sesion));
  ok('la ubicación usa fcore.placer.ubicacion', /fcore\.placer\.ubicacion/.test(catalogo));
  ok('el historial usa fcore.placer.pedidos', /const KEY = 'fcore\.placer\.pedidos'/.test(pedidos));
  ok('la sesión ofrece recuperación por código',
    /export async function recuperar\(/.test(sesion) && /export async function recuperarCodigo\(/.test(sesion) &&
    /recuperar_codigo/.test(sesion));
}

console.log('\n▸ panel · módulos con contrato propio');

/* 8 · El checkout mapea los errores reales del servidor y evita el doble pedido. */
{
  const co = leer(path.join(PANEL, 'cliente', 'checkout', 'checkout.js'));
  const faltan = ['BAJO_MINIMO', 'CERRADO', 'PAGO_CORTO', 'SIN_STOCK', 'SIN_DIRECCION', 'SIN_COMUNA',
    'SIN_NOMBRE', 'SIN_TELEFONO', 'NO_CATALOGO', 'SIN_RED'].filter((c) => !co.includes(c));
  ok('el checkout reconoce los rechazos del servidor', faltan.length === 0, faltan.join(', '));
  ok('el checkout usa idempotencia en sessionStorage', /sessionStorage[\s\S]{0,80}idem|fcore\.panel\.idem/.test(co));
  ok('el checkout no deja confirmar una tienda cerrada', /abierto === false/.test(co));
  ok('el vuelto no parece un error antes de escribir el monto', /caja\.hidden = dado <= 0/.test(co));
  const coCss = leer(path.join(PANEL, 'cliente', 'checkout', 'checkout.css'));
  ok('en móvil el formulario va antes que el resumen', !/\.resumen[^}]*order:\s*-1/.test(coCss));
}

/* 8b · El héroe de Inicio no promete un radio que no se cumple. */
{
  const h = leer(path.join(PANEL, 'cliente', 'inicio', 'index.html'));
  const js = leer(path.join(PANEL, 'cliente', 'inicio', 'inicio.js'));
  ok('la etiqueta del héroe es dinámica', /data-hero-dist/.test(h) && /data-hero-dist/.test(js));
  ok('sin tiendas cerca muestra la distancia real', /la más cercana/.test(js));
}

/* 9 · El seguimiento acepta token o código + contacto y usa push real. */
{
  const pe = leer(path.join(PANEL, 'cliente', 'pedido', 'pedido.js'));
  ok('el seguimiento acepta token o código/contacto',
    /get\('token'\)/.test(pe) && /get\('codigo'\)/.test(pe) && /get\('contacto'\)/.test(pe));
  ok('el seguimiento usa push_suscribir y push_baja',
    /push_suscribir/.test(pe) && /push_baja/.test(pe));
  ok('el seguimiento registra /sw-push.js', /\/sw-push\.js/.test(pe) && existe(path.join(WEB, 'sw-push.js')));
}

/* 10 · El mapa usa Leaflet local, no CDN. */
{
  const h = leer(path.join(PANEL, 'cliente', 'mapa', 'index.html'));
  const js = leer(path.join(PANEL, 'cliente', 'mapa', 'mapa.js'));
  ok('el mapa carga Leaflet desde /app/vendor', /src="\/app\/vendor\/leaflet\.js"/.test(h));
  ok('el mapa no carga Leaflet de CDN', !/unpkg|cdn\.jsdelivr|cdnjs/.test(h));
  ok('el mapa calcula la distancia en el cliente (locales no acepta lat/lon)',
    /distanciaKm/.test(js) && /mercado\('locales'/.test(js));
  ok('el mapa permite acercarse más que el teselado nativo',
    /maxZoom:\s*20/.test(js) && /maxNativeZoom:\s*19/.test(js));
  ok('el mapa dibuja la ubicación y su precisión en canvas',
    /createElement\('canvas'\)/.test(js) && /mapa-ubicacion-canvas/.test(js) &&
    /latLngToContainerPoint/.test(js) && /precision/.test(js));
  ok('el mapa dibuja el radio de búsqueda en el canvas',
    /setLineDash/.test(js) && /estado\.radio/.test(js));
  ok('el respaldo de Santiago no se pinta como ubicación propia',
    /origen === 'gps'/.test(js) && /estado\.ubi = previa/.test(js) &&
    !/L\.marker\(\[estado\.ubi\.lat/.test(js));
}

/* 11 · La ayuda es buscable, tiene temas y consulta la salud real. */
{
  const h = leer(path.join(PANEL, 'cliente', 'ayuda', 'index.html'));
  const js = leer(path.join(PANEL, 'cliente', 'ayuda', 'ayuda.js'));
  const preguntas = (js.match(/tema:\s*'/g) || []).length;
  const temas = new Set([...js.matchAll(/tema:\s*'([^']+)'/g)].map((m) => m[1]));
  ok('la ayuda tiene al menos 20 preguntas', preguntas >= 20, 'hay ' + preguntas);
  ok('la ayuda agrupa en al menos 5 temas', temas.size >= 5, [...temas].join(', '));
  ok('la ayuda busca sin tildes', /normalize\('NFD'\)/.test(js));
  ok('la ayuda consulta /api/health por la base absoluta', /API_BASE \+ '\/api\/health'/.test(js));
  ok('la ayuda tiene estado sin resultados', /vacio-ayuda/.test(js) && /Nada con esas palabras/.test(js));
  ok('la ayuda enlaza a los términos', /href="\/terminos\.html"/.test(h));
}

console.log('\n▸ sitio · términos y redirecciones');

/* 12 · Términos existe, tiene contenido real y está enlazado desde el panel. */
{
  const t = path.join(WEB, 'terminos.html');
  ok('web/terminos.html existe', existe(t));
  if (existe(t)) {
    const h = leer(t);
    const secciones = (h.match(/<section id="/g) || []).length;
    ok('los términos tienen al menos 12 secciones', secciones >= 12, 'hay ' + secciones);
    ok('los términos nombran al responsable y el RUT',
      /Soluciones Fabrick SpA/.test(h) && /76\.095\.190-3/.test(h));
    ok('los términos explican la tarjeta demo', /demostrativa/i.test(h) && /no se cobra/i.test(h));
    ok('los términos citan la Ley 19\.496 y la Ley 19\.628',
      /19\.496/.test(h) && /19\.628/.test(h));
    ok('los términos enlazan a soporte', /mailto:soporte@fabrick\.cl/.test(h));
    ok('los términos cargan components.css y su hoja propia',
      /href="\/components\.css"/.test(h) && /href="\/terminos\.css"/.test(h));
    ok('web/terminos.css existe', existe(path.join(WEB, 'terminos.css')));
  }
  const co = leer(path.join(PANEL, 'cliente', 'checkout', 'checkout.js'));
  const cu = leer(path.join(PANEL, 'cliente', 'cuenta', 'cuenta.js'));
  ok('checkout y cuenta enlazan a /terminos.html',
    /\/terminos\.html/.test(co) && /\/terminos\.html/.test(cu));
}

/* 13 · Redirecciones del panel: archivo real + regla en Vercel. */
{
  for (const rel of ['panel/index.html', 'panel/cliente/index.html']) {
    const p = path.join(WEB, rel);
    ok(rel + ' redirige al inicio', existe(p) && /\/panel\/cliente\/inicio\//.test(leer(p)));
  }
  const v = JSON.parse(leer(path.join(WEB, 'vercel.json')));
  const destinos = (v.redirects || []).map((r) => r.source + ' → ' + r.destination);
  ok('Vercel redirige /panel y /panel/cliente al inicio',
    destinos.some((d) => d.startsWith('/panel ') && d.endsWith('/panel/cliente/inicio/')) &&
    destinos.some((d) => d.startsWith('/panel/cliente ') && d.endsWith('/panel/cliente/inicio/')),
    destinos.join(' | '));
  ok('panel/negocio/index.html redirige al resumen',
    existe(path.join(WEB, 'panel', 'negocio', 'index.html')) &&
    /\/panel\/negocio\/resumen\//.test(leer(path.join(WEB, 'panel', 'negocio', 'index.html'))));
  ok('Vercel redirige /panel/negocio al resumen',
    destinos.some((d) => d.startsWith('/panel/negocio ') && d.endsWith('/panel/negocio/resumen/')),
    destinos.join(' | '));
}

/* 14 · La navegación no promete páginas a medias: cada enlace del menú abre
       un módulo real y la fase 2 ya no tiene «pronto» pendientes. */
{
  const nav = leer(path.join(PANEL, 'comun', 'nav-cliente.js'));
  ok('el manifiesto no deja módulos «pronto»',
    !/pronto:\s*true/.test(nav), nav.match(/pronto:\s*true[^}]*/g)?.join(' | ') || '');

  const todos = [];
  for (const m of MODULOS) {
    const p = path.join(PANEL, 'cliente', m, m + '.js');
    if (!existe(p)) continue;
    const txt = leer(p);
    // Los cuatro módulos de la fase 2 existen y se enlazan entre ellos.
    if (/\/panel\/cliente\/(pedidos|favoritos|direcciones|resenas)\//.test(txt)) todos.push(m);
  }
  ok('los módulos enlazan a la fase 2 sólo porque ya existe',
    todos.length > 0 && todos.every((m) => MODULOS.includes(m)), todos.join(', '));

  for (const m of ['pedidos', 'favoritos', 'direcciones', 'resenas']) {
    ok('«' + m + '» está en el menú del cliente',
      new RegExp("ruta: '/panel/cliente/" + m + "/'").test(nav));
  }
  const shell = leer(path.join(PANEL, 'comun', 'shell.js'));
  ok('el shell conserva el estilo para un «pronto» futuro', /nav-item--pronto/.test(shell));
}

console.log('\n▸ panel · fase 2 (pedidos, favoritos, direcciones, reseñas)');

/* 15 · La API nueva es la misma base y no agrega funciones serverless. */
{
  const ts = fs.readdirSync(path.join(RAIZ, 'api-telefono', 'api'))
    .filter((f) => f.endsWith('.ts'));
  ok('la API sigue con 12 funciones .ts (tope de Vercel)', ts.length === 12, ts.join(', '));

  const api = leer(path.join(RAIZ, 'api-telefono', 'api', 'mercado.ts'));
  const acciones = ['mis_pedidos', 'favoritos_listar', 'favorito_alternar',
    'direcciones_listar', 'direccion_guardar', 'direccion_borrar', 'resenas_mias'];
  const faltan = acciones.filter((a) => !new RegExp("accion === '" + a + "'").test(api));
  ok('mercado.ts despacha las 7 acciones nuevas', faltan.length === 0, faltan.join(', '));
  // La lista del GET (la que anuncia el endpoint) también debe nombrarlas.
  const bloque = (api.match(/acciones:\s*\[([\s\S]*?)\]/) || [])[1] || '';
  const enLista = acciones.filter((a) => !bloque.includes("'" + a + "'"));
  ok('las acciones nuevas están en la lista pública del GET', enLista.length === 0, enLista.join(', '));

  ok('el pedido recuerda la cuenta (cliente_id)',
    /cliente_id TEXT NOT NULL DEFAULT ''/.test(api) &&
    /INSERT INTO \$\{T_PEDIDOS\}[\s\S]{0,400}cliente_id\)/.test(api));
  ok('la reseña recuerda la cuenta (usuario_id)',
    /usuario_id TEXT NOT NULL DEFAULT ''/.test(api) &&
    /INSERT INTO \$\{T_RESENAS\} \(id, local_id, pedido_id, autor, estrellas, texto, usuario_id\)/.test(api));
  ok('favoritos y direcciones tienen tabla propia',
    /mercado_favoritos/.test(api) && /mercado_direcciones/.test(api));
  ok('las direcciones tienen tope de 20 y una predeterminada',
    />= 20/.test(api) && /predeterminada = false/.test(api));
  ok('un favorito inexistente responde NO_EXISTE, no inventa precio',
    /codigo: 'NO_EXISTE'/.test(api));
  ok('mis_pedidos filtra por cliente_id de la sesión', /WHERE p\.cliente_id = \$1/.test(api));
  ok('resenas_mias devuelve pendientes sin reseña', /NOT EXISTS \(SELECT 1 FROM \$\{T_RESENAS\}/.test(api));
}

/* 16 · El frontend de la fase 2 usa el espejo local honesto y la nube. */
{
  const fav = leer(path.join(PANEL, 'comun', 'favoritos.js'));
  const dir = leer(path.join(PANEL, 'comun', 'direcciones.js'));
  const c09 = leer(path.join(PANEL, 'cliente', 'pedidos', 'pedidos.js'));
  const c10 = leer(path.join(PANEL, 'cliente', 'favoritos', 'favoritos.js'));
  const c11 = leer(path.join(PANEL, 'cliente', 'direcciones', 'direcciones.js'));
  const c12 = leer(path.join(PANEL, 'cliente', 'resenas', 'resenas.js'));
  const co = leer(path.join(PANEL, 'cliente', 'checkout', 'checkout.js'));
  const cu = leer(path.join(PANEL, 'cliente', 'cuenta', 'cuenta.js'));

  ok('favoritos usa la clave local fcore.panel.favoritos',
    /const KEY = 'fcore\.panel\.favoritos'/.test(fav));
  ok('favoritos alterna en la nube y deja espejo local',
    /favorito_alternar/.test(fav) && /fijarLocal/.test(fav));
  ok('direcciones usa fcore.panel.direcciones y tope 20',
    /const KEY = 'fcore\.panel\.direcciones'/.test(dir) && /const TOPE = 20/.test(dir));
  ok('direcciones distingue «sin pin» de una coordenada falsa',
    /lat: Number\(f\.lat\) \|\| 0/.test(dir) && /lon: Number\(f\.lon\) \|\| 0/.test(dir));

  ok('C09 lee el historial local y el remoto',
    /leerPedidos\(\)/.test(c09) && /mis_pedidos/.test(c09));
  ok('C09 «volver a pedir» usa el catálogo actual',
    /data-repetir/.test(c09) && /buscarEnTienda/.test(c09) && /local_ver/.test(c09));
  ok('C09 no muestra un pedido de invitado como si fuera de la cuenta',
    /soloLocal/.test(c09) && /sólo en este teléfono/.test(c09));

  ok('C10 cruza el precio guardado con el catálogo vivo',
    /precio_guardado/.test(c10) && /local_ver/.test(c10));
  ok('C10 marca el producto eliminado sin romper la página',
    /it\.existe = false|existe: false/.test(c10) && /no disponible/.test(c10));

  ok('C11 usa el Leaflet local, no un CDN',
    /href="\/app\/vendor\/leaflet\.css"/.test(leer(path.join(PANEL, 'cliente', 'direcciones', 'index.html'))) &&
    /src="\/app\/vendor\/leaflet\.js"/.test(leer(path.join(PANEL, 'cliente', 'direcciones', 'index.html'))));
  ok('C11 no inventa geocodificación: se mueve el pin',
    /data-mapa/.test(c11) && /fijarPin/.test(c11) && /No hay buscador de calles/.test(
      leer(path.join(PANEL, 'cliente', 'direcciones', 'index.html'))));

  ok('C12 exige prueba de compra para calificar',
    /resena_crear/.test(c12) && /cuerpo\.token/.test(c12) && /cuerpo\.contacto/.test(c12));
  ok('C12 cuenta la reseña en el historial de la cuenta',
    /resenas_mias/.test(c12) && /usuario_id/.test(
      leer(path.join(RAIZ, 'api-telefono', 'api', 'mercado.ts'))));

  ok('el checkout ofrece direcciones guardadas',
    /data-dirs/.test(co) && /listarDirecciones/.test(co) && /data-dir-guardada/.test(co));
  ok('el checkout manda el Bearer para ligar el pedido a la cuenta',
    /mercadoPost\('pedido_crear', cuerpo, \{[\s\S]{0,90}token: token\(\)/.test(co));
  ok('la PWA también liga pedidos y reseñas a la cuenta cuando hay sesión',
    /CoreNube\.activa[\s\S]{0,220}Authorization = "Bearer "/.test(
      leer(path.join(WEB, 'app', 'placer.js'))) &&
    /fcore\.nube[\s\S]{0,200}Authorization = "Bearer "/.test(
      leer(path.join(WEB, 'tienda-seguir.js'))));

  ok('C13 resume pedidos, favoritos, direcciones y reseñas de InsForge',
    /mis_pedidos/.test(cu) && /favoritos_listar/.test(cu) &&
    /direcciones_listar/.test(cu) && /resenas_mias/.test(cu) &&
    /nube-resumen/.test(cu));
  ok('C13 ya no dice que el historial vive sólo en el navegador',
    !/El historial vive en este navegador/.test(cu) && /cualquier dispositivo/.test(cu));
}

console.log(fallos === 0
  ? '\n\x1b[1;32m✔ panel: módulos, rutas, API compartida y legales en orden\x1b[0m\n'
  : '\n\x1b[1;31m✖ panel: ' + fallos + ' fallo(s)\x1b[0m\n');
process.exit(fallos === 0 ? 0 : 1);
