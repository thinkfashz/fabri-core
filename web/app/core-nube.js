/* FORGE CORE STOCK · cuentas en la nube (InsForge vía fabri-api).
 *
 * Este archivo es SOLO la capa de red y el guardado del token. No toca la
 * base local ni la UI: `core-sec.js` lo usa para registrar/entrar y para
 * espejar la cuenta en el SQLite del navegador.
 *
 * Reglas:
 *   · `api()` NUNCA lanza: devuelve `{ ok:false, codigo, error }`. Un login
 *     no puede tumbar la app por un timeout.
 *   · El token de sesión se guarda en `localStorage` bajo `fcore.nube`. En la
 *     base de InsForge sólo queda su SHA-256.
 *   · Si la nube no responde, `estado().ultimo` lo dice con honestidad
 *     (`sin-red`, `sin-base`, `error`) para que la puerta de acceso no finja
 *     que la cuenta quedó en la nube cuando en realidad quedó en el equipo.
 */
(function () {
  'use strict';

  const API = 'https://fabri-api.vercel.app/api/auth';
  const KEY = 'fcore.nube';
  const ESPERA_MS = 9000;

  // Último resultado de red. La UI lo lee para mostrar el estado real.
  const EST = { ultimo: 'sin-comprobar', detalle: '', ms: 0, http: 0 };

  function leer() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      return d && d.token ? d : null;
    } catch (_) { return null; }
  }

  function guardar(res) {
    if (!res || !res.token) return null;
    const previo = leer() || {};
    const dato = {
      token: res.token,
      exp: Number(res.expira) || Number(res.exp) || 0,
      usuario: res.usuario || previo.usuario || null,
      guardado: Date.now(),
    };
    try { localStorage.setItem(KEY, JSON.stringify(dato)); } catch (_) {}
    return dato;
  }

  function limpiar() {
    try { localStorage.removeItem(KEY); } catch (_) {}
  }

  /** ¿Hay token guardado y no vencido? (No comprueba contra el servidor.) */
  function activa() {
    const d = leer();
    if (!d || !d.token) return false;
    return !d.exp || d.exp > Date.now();
  }

  function vence() {
    const d = leer();
    return d ? Number(d.exp) || 0 : 0;
  }

  function estado() {
    const d = leer();
    return {
      ultimo: EST.ultimo,
      detalle: EST.detalle,
      ms: EST.ms,
      http: EST.http,
      sesion: Boolean(d && d.token),
      activa: activa(),
      email: d && d.usuario ? d.usuario.email : '',
      vence: d ? Number(d.exp) || 0 : 0,
    };
  }

  /**
   * POST al puente de cuentas. Nunca lanza.
   * opts: { token, ms }
   */
  async function api(accion, datos, opts) {
    const o = opts || {};
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const reloj = ctrl ? setTimeout(() => ctrl.abort(), o.ms || ESPERA_MS) : null;
    const t0 = Date.now();
    const cabeceras = { 'Content-Type': 'application/json' };
    if (o.token) cabeceras.Authorization = 'Bearer ' + o.token;
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: cabeceras,
        body: JSON.stringify(Object.assign({ accion }, datos || {})),
        signal: ctrl ? ctrl.signal : undefined,
      });
      const d = await r.json().catch(() => ({}));
      EST.ms = Date.now() - t0;
      EST.http = r.status;
      if (!r.ok || d.ok === false) {
        EST.ultimo = d.codigo === 'SIN_BASE' ? 'sin-base' : 'error';
        EST.detalle = d.error || ('HTTP ' + r.status);
        return Object.assign({ ok: false }, d, { http: r.status });
      }
      EST.ultimo = 'nube';
      EST.detalle = '';
      return Object.assign({ ok: true }, d);
    } catch (e) {
      EST.ms = Date.now() - t0;
      EST.http = 0;
      EST.ultimo = 'sin-red';
      EST.detalle = (e && e.name === 'AbortError')
        ? 'la nube no respondió a tiempo'
        : 'no se pudo conectar con la nube';
      return { ok: false, codigo: 'SIN_RED', error: EST.detalle };
    } finally {
      if (reloj) clearTimeout(reloj);
    }
  }

  window.CoreNube = {
    API, KEY,
    api, leer, guardar, limpiar, activa, vence, estado,
    /** Marca el estado desde fuera (por ejemplo, tras un error local). */
    marcar(ultimo, detalle) { EST.ultimo = ultimo || 'sin-comprobar'; EST.detalle = detalle || ''; },
  };
})();
