/* Formato de datos del panel: CLP, fechas, distancias y texto seguro. */

const CLP = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
});

const NUM = new Intl.NumberFormat('es-CL');

export function clp(n) {
  return CLP.format(Math.round(Number(n) || 0));
}

export function num(n) {
  return NUM.format(Number(n) || 0);
}

/** 1,2 km · 850 m · '' si no hay dato. */
export function km(valor) {
  if (valor === null || valor === undefined || !Number.isFinite(Number(valor))) return '';
  const v = Number(valor);
  if (v < 1) return Math.max(10, Math.round(v * 1000 / 10) * 10) + ' m';
  return v.toFixed(1).replace('.', ',') + ' km';
}

export function fecha(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fechaHora(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short' }) + ' · ' +
    d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}

export function hora(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}

export function hace(ts) {
  const ms = Date.now() - new Date(ts).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return 'hace ' + min + ' min';
  const h = Math.floor(min / 60);
  if (h < 24) return 'hace ' + h + ' h';
  const d = Math.floor(h / 24);
  if (d === 1) return 'ayer';
  if (d < 30) return 'hace ' + d + ' días';
  return fecha(ts);
}

/** Escapa texto que viene de la nube antes de meterlo en innerHTML. */
export function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function iniciales(nombre) {
  const partes = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  const primera = partes[0].charAt(0);
  const segunda = partes.length > 1 ? partes[partes.length - 1].charAt(0) : '';
  return (primera + segunda).toUpperCase();
}

export function telefonoVisible(tel) {
  const d = String(tel || '').replace(/\D/g, '');
  if (d.length === 9 && d.startsWith('9')) return '+56 9 ' + d.slice(1, 5) + ' ' + d.slice(5);
  if (d.length === 11 && d.startsWith('56')) return '+56 9 ' + d.slice(3, 7) + ' ' + d.slice(7);
  return String(tel || '');
}

/** Enlace de WhatsApp chileno a partir de un teléfono escrito de cualquier forma. */
export function whatsapp(tel, texto) {
  let d = String(tel || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 9 && d.startsWith('9')) d = '56' + d;
  if (!d.startsWith('56')) d = '56' + d;
  return 'https://wa.me/' + d + (texto ? '?text=' + encodeURIComponent(texto) : '');
}

/** Minutos legibles: 5 min, 1 h 20 min. */
export function minutos(n) {
  const m = Math.max(0, Math.round(Number(n) || 0));
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h + ' h' + (r ? ' ' + r + ' min' : '');
}
