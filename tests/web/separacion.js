#!/usr/bin/env node
/* FORGE CORE STOCK · separación Cliente ↔ Negocio
 *
 * Las dos superficies comparten sesión y backend, pero no se mezclan:
 *   · el panel Cliente no ofrece opciones de administración ni enlaces al
 *     panel del negocio;
 *   · el panel Negocio no se pinta sin sesión ni sin tienda;
 *   · la app pública no muestra el botón del panel del dueño a un comprador;
 *   · las acciones públicas de la API no devuelven datos del dueño, teléfonos
 *     completos, tokens ni identificadores internos;
 *   · ningún panel se puede indexar en buscadores.
 *
 * Uso: node tests/web/separacion.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');
const WEB = path.join(RAIZ, 'web');
const PANEL = path.join(WEB, 'panel');
const MERCADO = path.join(RAIZ, 'api-telefono', 'api', 'mercado.ts');

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

console.log('\n▸ separación · navegación de los paneles');

{
  const navCliente = leer(path.join(PANEL, 'comun', 'nav-cliente.js'));
  const navNegocio = leer(path.join(PANEL, 'comun', 'nav-negocio.js'));

  ok('el menú del Cliente no enlaza al panel del Negocio',
    !/panel\/negocio/.test(navCliente));
  ok('el menú del Cliente no ofrece módulos de administración',
    !/ofertas|inventario|cupones|reportes|clientes|equipo|auditoria|integraciones/i.test(navCliente));
  ok('el menú del Negocio no enlaza módulos del Cliente',
    !/panel\/cliente/.test(navNegocio));
  ok('los dos menús se declaran con su propio panel',
    /export const PANEL = 'cliente'/.test(navCliente) &&
    /export const PANEL = 'negocio'/.test(navNegocio));
}

/* 2 · Cada HTML de panel es su propio contexto y no se indexa. */
console.log('\n▸ separación · contexto de cada pantalla');

{
  const htmls = [];
  for (const area of ['cliente', 'negocio']) {
    const base = path.join(PANEL, area);
    for (const m of fs.readdirSync(base)) {
      const f = path.join(base, m, 'index.html');
      if (existe(f)) htmls.push({ area, f });
    }
  }
  const cruzados = htmls.filter(({ area, f }) => {
    const s = leer(f);
    const esperado = 'data-panel="' + area + '"';
    return !s.includes(esperado);
  });
  ok('cada página declara el panel al que pertenece', cruzados.length === 0,
    cruzados.map((x) => x.f).join(', '));

  const sinNoindex = htmls.filter(({ f }) => !/name="robots" content="noindex/.test(leer(f)));
  ok('ningún panel se puede indexar en buscadores', sinNoindex.length === 0,
    sinNoindex.map((x) => x.f).join(', '));

  const negocioConCliente = htmls.filter(({ area, f }) => area === 'negocio' &&
    /nav-cliente|panel\/cliente\/inicio/.test(leer(f)));
  ok('el panel Negocio no hereda el menú del Cliente', negocioConCliente.length === 0);
}

/* 3 · La app pública no muestra el panel del dueño a un comprador. */
console.log('\n▸ separación · panel del dueño dentro de la app');
{
  const html = leer(path.join(WEB, 'app', 'index.html'));
  const guard = path.join(WEB, 'app', 'negocio-acceso.js');

  ok('el botón «Negocio» nace oculto',
    /data-go="negocio"[^>]*hidden/.test(html));
  ok('existe el guard de acceso al negocio', existe(guard));
  ok('la app carga el guard antes de arrancar',
    html.indexOf('negocio-acceso.js') > 0 &&
    html.indexOf('negocio-acceso.js') < html.indexOf('./app.js'));
  ok('la app no se indexa', /name="robots" content="noindex/.test(html));

  if (existe(guard)) {
    const g = leer(guard);
    ok('el guard pregunta si la cuenta administra una tienda',
      /accion: "local_mio"/.test(g));
    ok('el guard exige tienda propia o rol admin',
      /tiendas\.length > 0 \|\| rol === "admin"/.test(g));
    ok('sin sesión no se muestra administración', /sin-sesion/.test(g));
    ok('si la nube falla, el botón queda oculto', /sin-red/.test(g) && /aplicar\(false/.test(g));
    ok('un enlace viejo a #negocio se corrige', /location\.replace/.test(g) && /#panel/.test(g));
    ok('reacciona al cambio de sesión', /fcore:sesion/.test(g));
    ok('vigila el hash para no dejar #negocio abierto', /hashchange/.test(g));
    ok('el guard no guarda secretos ni los imprime',
      !/setItem/.test(g) && !/console\.(log|info)\([^)]*token/.test(g) &&
      !/innerHTML\s*=.*token/.test(g));
  }
}

/* 4 · El panel Negocio no se pinta sin sesión ni sin tienda. */
console.log('\n▸ separación · el negocio exige cuenta y tienda');
{
  const base = leer(path.join(PANEL, 'comun', 'negocio.js'));
  ok('sin sesión muestra el acceso, no datos', /if \(!activa\(\)\) \{/.test(base) &&
    /accesoHtml/.test(base));
  ok('sin tienda muestra el estado honesto, no datos',
    /primero hay que publicarlo/.test(base) && /Publicar mi tienda/.test(base));
  ok('una sesión inválida (401) vuelve al acceso', /fallo\.status === 401/.test(base));
  ok('el panel no pide la clave: usa la sesión',
    /token: o\.token \|\| token\(\)/.test(base) && !/cuerpo\.clave/.test(base));
}

/* 5 · Puente explícito: sólo si la cuenta administra una tienda. */
console.log('\n▸ separación · puente entre las dos vistas');
{
  const cuenta = leer(path.join(PANEL, 'cliente', 'cuenta', 'cuenta.js'));
  ok('la cuenta del cliente consulta si administra una tienda',
    /mercadoPost\('local_mio'/.test(cuenta));
  ok('el bloque «Tu negocio» no aparece sin tiendas',
    /if \(!estado\.tiendas\.length\) return ''/.test(cuenta));
  ok('el puente es un enlace de salida al panel del negocio',
    /href="\/panel\/negocio\/resumen\/"/.test(cuenta));
  ok('la cuenta no muestra pedidos ni datos de otros clientes',
    !/pedidos_listar|resenas_panel|clientes_/.test(cuenta));

  const shell = leer(path.join(PANEL, 'comun', 'shell.js'));
  ok('el texto del acceso depende del panel',
    /para administrar tu negocio/.test(shell) && /para comprar y seguir tus pedidos/.test(shell));
  ok('el diagnóstico técnico sólo se ofrece en el panel del negocio',
    /panel === 'negocio'\s*\n?\s*\? '<a href="\/panel\/doctor\/">/.test(shell));
  ok('el comprador no recibe enlaces a herramientas internas',
    !/panel\/cliente[\s\S]{0,40}panel\/doctor/.test(shell));
}

/* 6 · La API pública no devuelve datos del dueño ni secretos. */
console.log('\n▸ separación · datos que viajan al público');
{
  const api = leer(MERCADO);

  const ini = api.indexOf('function aTienda');
  const fin = api.indexOf('function ', ini + 10);
  const tienda = api.slice(ini, fin);
  ok('la ficha pública no expone dueño, plan ni clave',
    !/dueno_id/.test(tienda) && !/plan:/.test(tienda) && !/clave/.test(tienda) &&
    !/activo:/.test(tienda) && !/email/.test(tienda));
  ok('la ficha pública sí entrega lo que el comprador necesita',
    /telefono:/.test(tienda) && /horario:/.test(tienda) && /catalogo:/.test(tienda));

  const seg = api.slice(api.indexOf("if (accion === 'pedido_seguir')"),
    api.indexOf("if (accion === 'push_suscribir')"));
  ok('el seguimiento no devuelve el token ni el id interno',
    !/seguimiento: fila\.seguimiento/.test(seg) && !/\bid: fila\.id/.test(seg));
  ok('el seguimiento no devuelve el teléfono completo del comprador',
    !/telefono: fila\.telefono/.test(seg));
  ok('el seguimiento no devuelve la cuenta del comprador',
    !/cliente_id/.test(seg));
  ok('la ficha del local en el seguimiento es sólo lo público',
    !/dueno_id|plan:/.test(seg));

  const res = api.slice(api.indexOf("if (accion === 'resenas_listar')"),
    api.indexOf("if (accion === 'resena_crear')"));
  ok('las reseñas públicas no incluyen usuario_id ni correo',
    !/usuario_id/.test(res) && !/email/.test(res));

  ok('las acciones del dueño existen separadas de las públicas',
    /if \(accion === 'resenas_panel'\)/.test(api) &&
    /if \(accion === 'pedidos_listar'\)/.test(api) &&
    /if \(accion === 'pedido_estado'\)/.test(api));
  ok('las acciones del dueño se autorizan por cuenta o clave',
    /autorizarLocal\(pool, req, localId/.test(api));
}

/* 7 · Ninguna pantalla de compra usa acciones de administración. */
console.log('\n▸ separación · el cliente no llama acciones del dueño');

{
  const prohibidas = ['pedidos_listar', 'resenas_panel', 'resena_moderar',
    'local_actualizar', 'local_borrar', 'productos_subir', 'producto_borrar',
    'ventas_serie', 'local_activo'];
  const archivos = [];
  const recorrer = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) recorrer(f);
      else if (/\.js$/.test(e.name)) archivos.push(f);
    }
  };
  recorrer(path.join(PANEL, 'cliente'));

  const hallados = [];
  for (const f of archivos) {
    const s = leer(f);
    for (const a of prohibidas) {
      if (new RegExp("mercadoPost\\('" + a + "'").test(s)) {
        hallados.push(path.relative(RAIZ, f) + ' → ' + a);
      }
    }
  }
  ok('ningún módulo del Cliente llama acciones de administración',
    hallados.length === 0, hallados.join(', '));

  const seguir = leer(path.join(WEB, 'tienda-seguir.js'));
  ok('la página pública de seguimiento no pide acciones del dueño',
    !/pedidos_listar|resenas_panel/.test(seguir));
  const verificar = leer(path.join(WEB, 'verificar.js'));
  ok('la verificación pública sólo usa pedido_seguir',
    /accion: "pedido_seguir"/.test(verificar) &&
    !/pedidos_listar|resenas_panel|local_mio/.test(verificar));
  ok('la verificación no pide sesión ni rol',
    !/fcore\.nube|Authorization/.test(verificar));
}

console.log('\n' + (fallos ? '\x1b[1;31m' : '\x1b[1;32m') +
  (fallos ? '✖ separacion: ' + fallos + ' fallo(s)' : '✔ separacion: ' + pasos + ' comprobaciones OK') +
  '\x1b[0m\n');
process.exit(fallos ? 1 : 0);
