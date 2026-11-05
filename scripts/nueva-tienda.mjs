#!/usr/bin/env node
/* ============================================================================
   Alta de un local en el registro del piloto FORGE CORE STOCK
   ----------------------------------------------------------------------------
   El registro (`web/datos/tiendas.json`) es la fuente de verdad de los locales
   que salen en el mapa con catálogo real. Se sirve por CDN: el mismo archivo
   que ves en tu teléfono lo ve cualquier comprador. Sin base de datos y sin
   servidor propio, publicar un local es editar este JSON y subirlo.

   Este script hace el trabajo aburrido y evita el error caro: un local con la
   latitud mal puesta aparece en el mar, y un catálogo con un precio en 0 deja
   el pago roto. Valida, normaliza, comprueba duplicados y recién ahí escribe.

   Uso:
     node scripts/nueva-tienda.mjs plantilla            # JSON de ejemplo
     node scripts/nueva-tienda.mjs alta.json            # agrega desde archivo
     node scripts/nueva-tienda.mjs --json '{...}'       # agrega desde el shell
     node scripts/nueva-tienda.mjs listar               # locales publicados
     node scripts/nueva-tienda.mjs borrar <id>          # quita un local

   Opciones:
     --publicar    además deja el archivo listo: git add + commit (no sube).
   ========================================================================== */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRO = join(RAIZ, 'web/datos/tiendas.json');

/* Rubro → icono del mapa. Si el rubro no está, el local entra igual pero
   queda con el icono genérico de tienda. */
const ICONOS = {
  supermercado: 'supermercado', almacen: 'almacen', almacén: 'almacen',
  verduleria: 'verduleria', verdulería: 'verduleria', feria: 'feria',
  carniceria: 'carniceria', carnicería: 'carniceria', panaderia: 'panaderia',
  panadería: 'panaderia', pescaderia: 'pescaderia', pescadería: 'pescaderia',
  botilleria: 'botilleria', botillería: 'botilleria', fiambreria: 'fiambreria',
  fiambrería: 'fiambreria', dietetica: 'dietetica', dietética: 'dietetica',
  granja: 'granja', tienda: 'tienda', minimarket: 'almacen', mercado: 'feria'
};

const slug = (s) =>
  String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'local';

const leerRegistro = () => {
  try { return JSON.parse(readFileSync(REGISTRO, 'utf8')); }
  catch (e) { console.error('No pude leer ' + REGISTRO + ': ' + e.message); process.exit(1); }
};

function normalizar(t) {
  const errores = [];
  const nombre = String(t.nombre || '').trim();
  if (nombre.length < 2) errores.push('falta el nombre del local');

  const telefono = String(t.telefono || '').replace(/[^\d+]/g, '');
  if (telefono.replace(/\D/g, '').length < 8)
    errores.push('el teléfono (WhatsApp) parece incompleto: ' + (t.telefono || '(vacío)'));

  const lat = Number(t.lat), lon = Number(t.lon);
  if (!isFinite(lat) || !isFinite(lon)) errores.push('faltan las coordenadas lat/lon');
  else if (lat > -17 || lat < -56 || lon > -66 || lon < -76)
    errores.push('las coordenadas (' + lat + ', ' + lon + ') no caen en Chile');

  const rubro = String(t.rubro || 'Local').trim();
  const ico = t.ico || ICONOS[slug(rubro)] || ICONOS[rubro.toLowerCase()] || 'tienda';

  const minimo = Math.max(0, Math.round(Number(t.minimo) || 0));
  const entrega = Array.isArray(t.entrega) && t.entrega.length
    ? t.entrega.filter((x) => x === 'retiro' || x === 'delivery')
    : ['retiro'];
  if (!entrega.length) errores.push('la entrega debe ser "retiro" y/o "delivery"');

  const envio = Math.max(0, Math.round(Number(t.envio) || 0));
  if (entrega.includes('delivery') && envio === 0)
    console.warn('  ⚠️  ofrece delivery pero envío=0 (el comprador lo verá como "Retiro o delivery" sin costo).');

  const catalogo = (Array.isArray(t.catalogo) ? t.catalogo : []).map((it, i) => {
    const nom = String((it && (it.nombre || it.n)) || '').trim();
    const precio = Math.max(0, Math.round(Number(it && it.precio) || 0));
    if (!nom) errores.push('producto ' + (i + 1) + ' sin nombre');
    if (precio <= 0) errores.push('producto «' + (nom || i + 1) + '» sin precio válido');
    const o = { nombre: nom, precio };
    if (it && it.stock != null) o.stock = Math.max(0, Math.round(Number(it.stock)));
    if (it && it.categoria) o.categoria = String(it.categoria);
    if (it && it.unidad) o.unidad = String(it.unidad);
    return o;
  });
  if (!catalogo.length) errores.push('el catálogo no puede venir vacío (mínimo 1 producto)');

  const abierto = t.abierto !== false;
  const horario = String(t.horario || '').trim();

  return {
    errores,
    local: {
      id: String(t.id || '').trim() || ('t-' + slug(t.comuna || 'cl').slice(0, 3) + '-' + slug(nombre).slice(0, 6)),
      nombre, rubro, ico, telefono,
      direccion: String(t.direccion || '').trim(),
      comuna: String(t.comuna || '').trim(),
      lat, lon, abierto, horario, minimo, entrega, envio,
      demo: !!t.demo,
      catalogo
    }
  };
}

function duplicado(reg, local) {
  return reg.tiendas.find((x) =>
    (x.telefono && x.telefono === local.telefono) ||
    (x.nombre.toLowerCase() === local.nombre.toLowerCase() &&
      Math.abs((x.lat || 0) - local.lat) < 0.002 && Math.abs((x.lon || 0) - local.lon) < 0.002));
}

function idUnico(reg, base) {
  if (!reg.tiendas.some((x) => x.id === base)) return base;
  let n = 2;
  while (reg.tiendas.some((x) => x.id === base + '-' + n)) n++;
  return base + '-' + n;
}

function guardar(reg) {
  reg.v = reg.v || 1;
  reg.actualizado = new Date().toISOString().slice(0, 10);
  writeFileSync(REGISTRO, JSON.stringify(reg, null, 2) + '\n');
}

const PLANTILLA = {
  nombre: 'Almacén Los Aromos',
  rubro: 'Almacén',
  telefono: '+56912345678',
  direccion: 'Calle Ejemplo 123',
  comuna: 'Rengo',
  lat: -34.4061,
  lon: -70.8638,
  abierto: true,
  horario: 'Lun a Sáb 9:00-21:00',
  minimo: 5000,
  entrega: ['retiro', 'delivery'],
  envio: 1500,
  catalogo: [
    { nombre: 'Pan marraqueta 1 kg', precio: 1400, stock: 30 },
    { nombre: 'Leche entera 1 L', precio: 1150, stock: 24 }
  ]
};

function main() {
  const args = process.argv.slice(2);
  const accion = args[0];
  const publicar = args.includes('--publicar');
  const reg = leerRegistro();

  if (!accion || accion === 'listar') {
    if (!reg.tiendas.length) { console.log('El registro está vacío.'); return; }
    console.log('\nLocales en el registro (' + reg.tiendas.length + ') · actualizado ' + reg.actualizado + '\n');
    for (const t of reg.tiendas) {
      console.log('  ' + (t.id + '                     ').slice(0, 22) +
        (t.abierto === false ? '🔴 cerrado' : '🟢 abierto') + '  ' +
        (t.nombre + '                         ').slice(0, 26) +
        (t.minimo ? '$' + t.minimo.toLocaleString('es-CL') + ' mín' : 'sin mín') +
        '  · ' + t.catalogo.length + ' producto' + (t.catalogo.length === 1 ? '' : 's') +
        (t.demo ? '  [demo]' : ''));
    }
    console.log('');
    return;
  }

  if (accion === 'plantilla') {
    console.log(JSON.stringify(PLANTILLA, null, 2));
    console.log('\n// Rellena esto y guarda como alta.json; luego: node scripts/nueva-tienda.mjs alta.json');
    return;
  }

  if (accion === 'borrar') {
    const id = args[1];
    const i = reg.tiendas.findIndex((x) => x.id === id);
    if (i < 0) { console.error('No existe el local ' + id); process.exit(1); }
    const [fuera] = reg.tiendas.splice(i, 1);
    guardar(reg);
    console.log('Quitado: ' + fuera.nombre + ' (' + id + ')');
    return;
  }

  let crudo;
  if (accion === '--json') {
    try { crudo = JSON.parse(args[1]); }
    catch (e) { console.error('El JSON del argumento no parsea: ' + e.message); process.exit(1); }
  } else {
    try { crudo = JSON.parse(readFileSync(accion, 'utf8')); }
    catch (e) { console.error('No pude leer el archivo ' + accion + ': ' + e.message); process.exit(1); }
  }
  const lista = Array.isArray(crudo) ? crudo : [crudo];

  let agregados = 0;
  for (const item of lista) {
    const { errores, local } = normalizar(item);
    if (errores.length) {
      console.error('\n✖ «' + (item.nombre || '?') + '» no pasó la validación:');
      errores.forEach((e) => console.error('   · ' + e));
      process.exit(1);
    }
    const ya = duplicado(reg, local);
    if (ya) {
      console.warn('  ⚠️  «' + local.nombre + '» ya está en el registro como ' + ya.id + ' — lo salto.');
      continue;
    }
    local.id = idUnico(reg, local.id);
    reg.tiendas.push(local);
    agregados++;
    console.log('  ✓ ' + local.id + '  ' + local.nombre + '  (' +
      local.catalogo.length + ' producto' + (local.catalogo.length === 1 ? '' : 's') +
      (local.minimo ? ', mín $' + local.minimo.toLocaleString('es-CL') : '') + ')');
  }

  if (!agregados) { console.log('Nada nuevo para agregar.'); return; }
  guardar(reg);
  console.log('\nRegistro actualizado: ' + reg.tiendas.length + ' locales · ' + REGISTRO);

  if (publicar) {
    try {
      execFileSync('git', ['add', 'web/datos/tiendas.json', 'web/app/placer.js', 'web/app/placer.css', 'web/app/sw.js'], { cwd: RAIZ });
      execFileSync('git', ['commit', '-m', 'MercadoPlacer: locales del piloto (' + agregados + ' nuevo' + (agregados === 1 ? '' : 's') + ')'], { cwd: RAIZ });
      console.log('Commit hecho. Falta subir: git push  y  cd web && vercel --prod');
    } catch (e) {
      console.error('El commit falló: ' + (e.stderr ? e.stderr.toString() : e.message));
      process.exit(1);
    }
  } else {
    console.log('Para publicar: git add web/datos/tiendas.json && git commit && git push');
    console.log('               (luego, si Vercel no auto-despliega: cd web && vercel --prod)');
  }
}

main();
