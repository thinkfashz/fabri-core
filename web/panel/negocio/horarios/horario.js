/* Horario semanal del negocio.
   La API guarda `horario` como texto libre de hasta 120 caracteres; el mapa y
   la ficha lo muestran tal cual. Este archivo traduce ese texto a siete días
   editables y de vuelta a un texto corto y legible.

   Sin dependencias: se puede probar en Node y correr en el navegador.

   Formato canónico que escribe `escribir`:
     Lun-Vie 9:00-20:00; Sáb 10:00-14:00; Dom cerrado
   El parser es tolerante: acepta "lunes a viernes de 09:00 a 20:00", guiones
   largos, mayúsculas, "cerrado"/"closed" y separadores ; | o salto de línea. */

export const DIAS = [
  { corto: 'Lun', largo: 'Lunes' },
  { corto: 'Mar', largo: 'Martes' },
  { corto: 'Mié', largo: 'Miércoles' },
  { corto: 'Jue', largo: 'Jueves' },
  { corto: 'Vie', largo: 'Viernes' },
  { corto: 'Sáb', largo: 'Sábado' },
  { corto: 'Dom', largo: 'Domingo' },
];

export const CERRADO = 'cerrado';
export const MAX_TEXTO = 120;

const ALIAS = {
  lun: 0, lunes: 0,
  mar: 1, martes: 1,
  mie: 2, miercoles: 2,
  jue: 3, jueves: 3,
  vie: 4, viernes: 4,
  sab: 5, sabado: 5,
  dom: 6, domingo: 6,
};

function sinAcentos(s) {
  try {
    return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch (_) {
    return String(s);
  }
}

/** '9' · '9:30' · '09:30' → '09:30'. '' si no es una hora válida. */
export function normalizarHora(v) {
  const m = String(v == null ? '' : v).trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return '';
  const h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 24 || min > 59) return '';
  if (h === 24 && min !== 0) return '';
  return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}

/** '09:00' → '9:00': el texto tiene 120 caracteres y cada espacio cuenta. */
function compacta(hhmm) {
  const v = normalizarHora(hhmm);
  if (!v) return '';
  return String(Number(v.slice(0, 2))) + v.slice(2);
}

function diaVacio(i) {
  return { i, abierto: false, desde: '09:00', hasta: '19:00' };
}

/** Copia los siete días con valores usables, sin confiar en el llamador. */
export function normalizarDias(dias) {
  const lista = Array.isArray(dias) ? dias : [];
  return DIAS.map((_, i) => {
    const d = lista[i] || {};
    return {
      i,
      abierto: d.abierto === true,
      desde: normalizarHora(d.desde) || '09:00',
      hasta: normalizarHora(d.hasta) || '19:00',
    };
  });
}

/**
 * Texto guardado → siete días.
 * Devuelve `null` cuando no hay horario publicado (distinto de "todo cerrado").
 */
export function leer(texto) {
  const original = String(texto == null ? '' : texto).trim();
  if (!original) return null;

  const dias = DIAS.map((_, i) => diaVacio(i));
  const plano = sinAcentos(original).toLowerCase();

  // Separa bloques por ; | o salto de línea. La coma NO separa: "Lun, Mié
  // 9:00-14:00" es una lista de días que comparte la misma franja.
  const bloques = plano
    .split(/[;\n|]+/)
    .map((b) => b.trim())
    .filter(Boolean);

  const RE_RANGO = /(\d{1,2}(?::\d{2})?)\s*(?:-|–|—|a|hasta|hs?)\s*(\d{1,2}(?::\d{2})?)/;

  for (const bloque of bloques) {
    const cerrado = /\bcerrad[oa]s?\b/.test(bloque);
    const rango = bloque.match(RE_RANGO);

    // Los días se leen sólo antes de las horas: "de 9:00 a 20:00" no aporta
    // nombres de día y "lunes a viernes" sí.
    const parteDias = rango ? bloque.slice(0, rango.index) : bloque;
    const tokens = parteDias.split(/[\s,/\-–—]+/).filter(Boolean);
    const indices = [];
    for (const t of tokens) {
      const i = ALIAS[t];
      if (i !== undefined && !indices.includes(i)) indices.push(i);
    }
    if (!indices.length) continue;

    const desde = rango ? normalizarHora(rango[1]) : '';
    const hasta = rango ? normalizarHora(rango[2]) : '';
    const abierto = !cerrado && Boolean(desde && hasta);

    // "Lun-Vie" o "lunes a viernes" abarcan el tramo; "Lun, Mié" son días
    // sueltos que comparten la franja. Sin este matiz, una lista de dos días
    // abriría el martes sin que nadie lo haya escrito.
    const enTramo = /(?:^|\s)(?:a|al|hasta)(?:\s|$)|[-–—]/.test(parteDias);
    const objetivo = [];
    if (indices.length > 1 && enTramo) {
      const a = Math.min(indices[0], indices[indices.length - 1]);
      const b = Math.max(indices[0], indices[indices.length - 1]);
      for (let i = a; i <= b; i++) objetivo.push(i);
    } else {
      objetivo.push(...indices);
    }
    for (const i of objetivo) {
      dias[i].abierto = abierto;
      if (abierto) {
        dias[i].desde = desde;
        dias[i].hasta = hasta;
      }
    }
  }

  return dias;
}

/** Sugerencia para una tienda sin horario publicado. No se guarda sola. */
export function sugerencia() {
  return normalizarDias([
    { abierto: true, desde: '09:00', hasta: '19:00' },
    { abierto: true, desde: '09:00', hasta: '19:00' },
    { abierto: true, desde: '09:00', hasta: '19:00' },
    { abierto: true, desde: '09:00', hasta: '19:00' },
    { abierto: true, desde: '09:00', hasta: '19:00' },
    { abierto: true, desde: '10:00', hasta: '14:00' },
    { abierto: false, desde: '09:00', hasta: '19:00' },
  ]);
}

function mismaFranja(a, b) {
  if (a.abierto !== b.abierto) return false;
  if (!a.abierto) return true;
  return a.desde === b.desde && a.hasta === b.hasta;
}

function rotulo(a, b) {
  return a === b ? DIAS[a].corto : DIAS[a].corto + '-' + DIAS[b].corto;
}

/**
 * Siete días → texto canónico de una sola línea (≤120 caracteres).
 * Agrupa días consecutivos con la misma franja: "Lun-Vie 9:00-20:00".
 */
export function escribir(dias) {
  const lista = normalizarDias(dias);
  const partes = [];
  let i = 0;
  while (i < 7) {
    let j = i;
    while (j + 1 < 7 && mismaFranja(lista[j], lista[j + 1])) j++;
    const d = lista[i];
    const franja = d.abierto ? compacta(d.desde) + '-' + compacta(d.hasta) : CERRADO;
    partes.push(rotulo(i, j) + ' ' + franja);
    i = j + 1;
  }
  let texto = partes.join('; ');
  if (texto.length <= MAX_TEXTO) return texto;
  // Sin espacios si hiciera falta: siete franjas distintas caben igual.
  texto = partes.join(', ');
  return texto.length <= MAX_TEXTO ? texto : partes.join(',');
}

/** Qué dice el horario para hoy. `fecha` es inyectable para poder probarlo. */
export function hoy(dias, fecha) {
  const lista = normalizarDias(dias);
  const f = fecha instanceof Date ? fecha : new Date();
  const idx = (f.getDay() + 6) % 7;
  const d = lista[idx];
  if (!d.abierto) return { abierto: false, dia: idx, desde: '', hasta: '', texto: 'Cerrado hoy' };
  return {
    abierto: true,
    dia: idx,
    desde: d.desde,
    hasta: d.hasta,
    texto: d.desde + ' – ' + d.hasta,
  };
}

/** Errores que impiden guardar, con el día que los causa. */
export function validar(dias) {
  const lista = normalizarDias(dias);
  const fallos = [];
  for (const d of lista) {
    if (!d.abierto) continue;
    const desde = normalizarHora(d.desde);
    const hasta = normalizarHora(d.hasta);
    if (!desde || !hasta) {
      fallos.push({ i: d.i, texto: DIAS[d.i].largo + ': falta la hora de apertura o de cierre.' });
      continue;
    }
    if (hasta === '00:00' && desde !== '00:00') {
      fallos.push({ i: d.i, texto: DIAS[d.i].largo + ': usa 24:00 para cerrar a medianoche.' });
      continue;
    }
    if (desde >= hasta) {
      fallos.push({ i: d.i, texto: DIAS[d.i].largo + ': el cierre debe ser después de la apertura.' });
    }
  }
  return fallos;
}
