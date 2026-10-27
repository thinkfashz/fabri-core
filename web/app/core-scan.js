/* ============================================================================
   Escáner de códigos de barras de la nube
   ----------------------------------------------------------------------------
   Tres capas, en orden de coste:

   1. `BarcodeDetector` nativo (Chrome/Android). Sin descargas, decodifica en el
      propio motor del navegador y entiende EAN-13/8, UPC-A/E, Code 128/39,
      ITF, Codabar, QR y Data Matrix.
   2. ZXing vendorizado (`vendor/zxing.min.js`, 336 KB, Apache-2.0) cargado
      **sólo si** el navegador no trae detector. Se decodifica un fotograma
      recortado cada ~160 ms con `MultiFormatReader`, que es síncrono y no
      pelea con el bucle de la cámara.
   3. Entrada manual: siempre disponible, también sin cámara ni permisos.

   El escáner no sabe qué es un producto: entrega un código normalizado. Quien
   lo abre decide qué hacer con él (`onCodigo` o la promesa que devuelve).
   ========================================================================== */
(() => {
  'use strict';

  /* Formatos que interesan en una tienda. Se piden al detector nativo y se
     intersectan con los que el navegador declare soportar. */
  const FORMATOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'codabar', 'qr_code', 'data_matrix'];

  /* ZXing usa sus propias constantes; se resuelven al cargar el respaldo. */
  const FORMATOS_ZX = ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39', 'ITF', 'QR_CODE'];

  const $ = (sel, raiz) => (raiz || document).querySelector(sel);
  const $$ = (sel, raiz) => [...(raiz || document).querySelectorAll(sel)];

  /* ── helpers puros (probados en tests/web/escaneo.js) ─────────────────── */

  /** Quita espacios, guiones y puntos; deja el código tal como se teclea. */
  function normalizarCodigo(txt) {
    return String(txt || '').replace(/[\s\-_.]/g, '').toUpperCase();
  }

  /**
   * Dígito verificador GS1. Los códigos de 8, 12, 13 y 14 dígitos lo llevan;
   * comprobarlo evita mandar a la API un código mal tecleado (una tecla de
   * más en un EAN-13 casi siempre rompe el checksum).
   */
  function digitoGS1(codigo) {
    const d = String(codigo).split('').map(Number);
    if (d.some(n => Number.isNaN(n))) return null;
    const control = d.pop();
    let suma = 0;
    // Desde la derecha, pesos 3 y 1 alternados.
    for (let i = d.length - 1, k = 0; i >= 0; i--, k++) suma += d[i] * (k % 2 === 0 ? 3 : 1);
    return (10 - (suma % 10)) % 10 === control;
  }

  function eanValido(codigo) {
    const c = normalizarCodigo(codigo);
    if (!/^\d+$/.test(c)) return false;
    if ([8, 12, 13, 14].includes(c.length)) return digitoGS1(c) === true;
    // Code 128 / 39 alfanuméricos: no hay checksum que valga, sólo longitud.
    return c.length >= 6 && c.length <= 48;
  }

  function pareceCodigo(codigo) {
    const c = normalizarCodigo(codigo);
    if (c.length < 6 || c.length > 48) return false;
    if (!/^[A-Z0-9]+$/.test(c)) return false;
    // Un EAN/UPC con checksum roto no se acepta: sería un producto inventado.
    if (/^\d+$/.test(c) && [8, 12, 13, 14].includes(c.length)) return digitoGS1(c) === true;
    // Un Code 128/39 de tienda lleva dígitos; «HOLAMUNDO» es texto, no código.
    return /\d/.test(c);
  }

  /* ── estado de la sesión de escaneo ───────────────────────────────────── */
  let ui = null;          // nodos del overlay (se crean una vez)
  let sesion = null;      // { stream, track, detector, lector, raf, ... }
  let resolver = null;    // promesa pendiente de abrir()

  const soportado = () =>
    !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) &&
    (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');

  /* ── overlay ──────────────────────────────────────────────────────────── */

  function montarUI() {
    if (ui) return ui;
    const caja = document.createElement('div');
    caja.className = 'scan';
    caja.id = 'scan';
    caja.setAttribute('role', 'dialog');
    caja.setAttribute('aria-modal', 'true');
    caja.setAttribute('aria-label', 'Escáner de códigos de barras');
    caja.innerHTML = `
      <video class="scan-video" id="scanVideo" playsinline muted autoplay></video>
      <div class="scan-velo" aria-hidden="true"></div>
      <div class="scan-marco" aria-hidden="true">
        <i></i><i></i><i></i><i></i><span class="scan-laser"></span>
      </div>
      <header class="scan-top">
        <div class="scan-tit"><b>Escanear</b><span id="scanSub">acerca el código al marco</span></div>
        <button class="scan-x" id="scanX" type="button" aria-label="Cerrar escáner">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </header>
      <div class="scan-pie">
        <div class="scan-acciones">
          <button class="scan-tool" id="scanTorch" type="button" aria-label="Linterna" hidden>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 2h6l-1 6 3 4v10H7V12l3-4-1-6Z"/></svg>
          </button>
          <button class="scan-tool" id="scanCam" type="button" aria-label="Cambiar cámara" hidden>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-2h6l2 2h3v11H4Z"/><circle cx="12" cy="13" r="3.2"/></svg>
          </button>
          <button class="scan-tool" id="scanManual" type="button" aria-label="Escribir el código">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7V5h16v2M4 17v2h16v-2M8 5v14M12 5v14M16 5v14"/></svg>
          </button>
        </div>
        <div class="scan-estado" id="scanEstado" role="status">encendiendo la cámara…</div>
      </div>
      <div class="scan-hit" id="scanHit" hidden>
        <div class="scan-hit-cod mono" id="scanCodigo"></div>
        <div class="scan-hit-txt" id="scanHitTxt">código detectado</div>
        <div class="scan-hit-botones">
          <button class="btn ghost" id="scanSeguir" type="button">Seguir</button>
          <button class="btn primary" id="scanUsar" type="button">Usar</button>
        </div>
      </div>
      <form class="scan-manual" id="scanManualBox" hidden>
        <input class="field" id="scanInput" inputmode="numeric" autocomplete="off"
               placeholder="Escribe el código de barras">
        <button class="btn primary" type="submit">Usar</button>
      </form>
      <div class="scan-error" id="scanError" hidden></div>`;
    document.body.appendChild(caja);

    ui = {
      caja,
      video: $('#scanVideo', caja),
      sub: $('#scanSub', caja),
      estado: $('#scanEstado', caja),
      hit: $('#scanHit', caja),
      codigo: $('#scanCodigo', caja),
      hitTxt: $('#scanHitTxt', caja),
      usar: $('#scanUsar', caja),
      seguir: $('#scanSeguir', caja),
      manual: $('#scanManualBox', caja),
      input: $('#scanInput', caja),
      error: $('#scanError', caja),
      torch: $('#scanTorch', caja),
      cam: $('#scanCam', caja),
    };

    $('#scanX', caja).onclick = () => cerrar(null);
    $('#scanManual', caja).onclick = () => {
      ui.manual.hidden = !ui.manual.hidden;
      if (!ui.manual.hidden) { ui.input.value = ''; ui.input.focus(); }
    };
    ui.seguir.onclick = () => reanudar();
    ui.manual.onsubmit = ev => {
      ev.preventDefault();
      const c = normalizarCodigo(ui.input.value);
      if (!pareceCodigo(c)) { avisar('Ese código no parece válido: revisa los dígitos.', true); return; }
      aceptar(c);
    };
    ui.torch.onclick = () => linterna();
    ui.cam.onclick = () => cambiarCamara();

    document.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && sesion) cerrar(null);
    });
    document.addEventListener('visibilitychange', () => {
      if (!sesion) return;
      // Con la pestaña oculta el navegador congela el vídeo: seguir pidiendo
      // fotogramas sólo gasta batería y devuelve negro.
      if (document.hidden) pausar();
      else if (ui.hit.hidden) reanudar();
    });
    return ui;
  }

  /* ── cámara ───────────────────────────────────────────────────────────── */

  async function encender(dispositivo) {
    const video = ui.video;
    const base = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
    const pedir = d => navigator.mediaDevices.getUserMedia({
      audio: false,
      video: d ? Object.assign({ deviceId: { exact: d } }, base)
        : Object.assign({ facingMode: { ideal: 'environment' } }, base),
    });

    let stream;
    try {
      stream = await pedir(dispositivo);
    } catch (e) {
      // Cámara trasera inexistente o restricciones no soportadas: se pide
      // cualquier cámara antes de rendirse, que en escritorio es la webcam.
      if (e && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } else { throw e; }
    }

    const track = stream.getVideoTracks()[0];
    sesion.stream = stream;
    sesion.track = track;
    video.srcObject = stream;
    await video.play().catch(() => {});

    // Enfoque continuo: sin esto, un EAN pequeño a 15 cm sale borroso.
    try {
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      if (caps.focusMode && caps.focusMode.includes('continuous')) {
        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      }
      if (caps.torch) ui.torch.hidden = false;
    } catch (_) { /* el navegador puede exponer las capacidades y negarse igual */ }

    const cams = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    ui.cam.hidden = cams.filter(c => c.kind === 'videoinput').length < 2;
    return track;
  }

  async function linterna() {
    if (!sesion || !sesion.track) return;
    const encendida = sesion.torch === true;
    try {
      await sesion.track.applyConstraints({ advanced: [{ torch: !encendida }] });
      sesion.torch = !encendida;
      ui.torch.classList.toggle('on', sesion.torch);
    } catch (e) {
      avisar('Esta cámara no deja encender la linterna.', true);
    }
  }

  async function cambiarCamara() {
    if (!sesion) return;
    const cams = (await navigator.mediaDevices.enumerateDevices().catch(() => []))
      .filter(c => c.kind === 'videoinput');
    if (cams.length < 2) return;
    const actual = sesion.track && sesion.track.getSettings().deviceId;
    const i = Math.max(0, cams.findIndex(c => c.deviceId === actual));
    const siguiente = cams[(i + 1) % cams.length];
    detenerMedios();
    try {
      await encender(siguiente.deviceId);
      ui.estado.textContent = 'cámara ' + ((i + 2 > cams.length) ? 1 : i + 2) + ' de ' + cams.length;
      arrancarBucle();
    } catch (e) {
      avisar('No pude abrir la otra cámara.', true);
    }
  }

  function detenerMedios() {
    if (sesion && sesion.stream) sesion.stream.getTracks().forEach(t => t.stop());
    if (sesion) { sesion.stream = null; sesion.track = null; sesion.torch = false; }
    if (ui) ui.video.srcObject = null;
  }

  /* ── detección ────────────────────────────────────────────────────────── */

  async function prepararDetector() {
    if (!('BarcodeDetector' in window)) return null;
    try {
      const soportados = await window.BarcodeDetector.getSupportedFormats();
      const usar = FORMATOS.filter(f => soportados.includes(f));
      if (!usar.length) return null;
      return new window.BarcodeDetector({ formats: usar });
    } catch (_) { return null; }
  }

  async function cargarZXing() {
    if (window.ZXing) return window.ZXing;
    await new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = './vendor/zxing.min.js';
      s.async = true;
      s.onload = ok;
      s.onerror = () => mal(new Error('no se pudo cargar el decodificador'));
      document.head.appendChild(s);
    });
    return window.ZXing;
  }

  async function prepararZXing() {
    const Z = await cargarZXing();
    const hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS,
      FORMATOS_ZX.map(n => Z.BarcodeFormat[n]).filter(Boolean));
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    const lector = new Z.MultiFormatReader();
    lector.setHints(hints);
    return { Z, lector };
  }

  function arrancarBucle() {
    if (!sesion) return;
    cancelAnimationFrame(sesion.raf);
    const paso = () => {
      if (!sesion || sesion.pausado) return;
      sesion.raf = requestAnimationFrame(paso);
      const ahora = performance.now();
      if (ahora - sesion.ultimo < (sesion.detector ? 90 : 160)) return;
      sesion.ultimo = ahora;
      detectar();
    };
    sesion.pausado = false;
    sesion.raf = requestAnimationFrame(paso);
  }

  function pausar() {
    if (!sesion) return;
    sesion.pausado = true;
    cancelAnimationFrame(sesion.raf);
  }

  async function detectar() {
    if (!sesion || sesion.ocupado || sesion.pausado) return;
    const v = ui.video;
    if (!v.videoWidth || v.readyState < 2) return;
    sesion.ocupado = true;

    try {
      if (sesion.detector) {
        const codigos = await sesion.detector.detect(v);
        const hit = codigos.find(c => pareceCodigo(c.rawValue));
        if (hit) { sesion.ocupado = false; return aceptar(hit.rawValue, hit.format); }
      } else if (sesion.zx) {
        const c = recortar();
        if (c) {
          const img = c.ctx.getImageData(0, 0, c.canvas.width, c.canvas.height);
          const fuente = new sesion.zx.Z.RGBLuminanceSource(img.data, c.canvas.width, c.canvas.height);
          const bitmap = new sesion.zx.Z.BinaryBitmap(new sesion.zx.Z.HybridBinarizer(fuente));
          try {
            const r = sesion.zx.lector.decode(bitmap);
            if (r && pareceCodigo(r.getText())) { sesion.ocupado = false; return aceptar(r.getText(), r.getBarcodeFormat()); }
          } catch (_) { /* NotFoundException: el caso normal entre fotogramas */ }
        }
      }
    } catch (e) {
      // Un detector roto no debe dejar la cámara encendida sin explicación.
      if (e && e.name && e.name !== 'NotFoundException') console.warn('[scan]', e);
    } finally {
      sesion.ocupado = false;
    }
  }

  /** Recorta el centro del vídeo: menos píxeles, más aciertos y menos batería. */
  function recortar() {
    const v = ui.video;
    if (!v.videoWidth) return null;
    const ancho = 640;
    const alto = Math.round(ancho * (v.videoHeight / v.videoWidth));
    const sx = Math.round(v.videoWidth * 0.08);
    const sy = Math.round(v.videoHeight * 0.2);
    const sw = Math.round(v.videoWidth * 0.84);
    const sh = Math.round(v.videoHeight * 0.6);
    const canvas = sesion.canvas || (sesion.canvas = document.createElement('canvas'));
    if (canvas.width !== ancho) { canvas.width = ancho; canvas.height = alto; }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, ancho, alto);
    return { canvas, ctx };
  }

  /* ── confirmación y cierre ────────────────────────────────────────────── */

  function aceptar(codigo, formato) {
    const c = normalizarCodigo(codigo);
    if (!pareceCodigo(c)) { avisar('El código leído no es válido. Prueba de nuevo.', true); return; }
    pausar();
    pitar();
    if (navigator.vibrate) navigator.vibrate(28);
    ui.codigo.textContent = c;
    ui.hitTxt.textContent = formato ? 'leído como ' + String(formato).replace(/_/g, '-') : 'código detectado';
    ui.hit.hidden = false;
    ui.usar.focus();
    // La promesa se resuelve recién cuando el usuario confirma: un falso
    // positivo no debe escribir un código en el inventario sin querer.
    ui.usar.dataset.codigo = c;
    ui.usar.onclick = () => cerrar(c);
  }

  function reanudar() {
    ui.hit.hidden = true;
    ui.error.hidden = true;
    arrancarBucle();
  }

  function avisar(txt, esError) {
    ui.estado.textContent = txt;
    if (esError) { ui.error.textContent = txt; ui.error.hidden = false; }
  }

  function pitar() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = sesion && sesion.audio ? sesion.audio : (sesion.audio = new AC());
      const osc = ctx.createOscillator();
      const gan = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 1180;
      gan.gain.setValueAtTime(0.0001, ctx.currentTime);
      gan.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + 0.012);
      gan.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.13);
      osc.connect(gan).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.14);
    } catch (_) { /* sin audio: el aviso visual alcanza */ }
  }

  function cerrar(resultado) {
    if (!sesion) return;
    pausar();
    detenerMedios();
    if (sesion.audio && sesion.audio.close) sesion.audio.close().catch(() => {});
    sesion = null;
    ui.caja.classList.remove('abierto');
    ui.hit.hidden = true;
    ui.error.hidden = true;
    ui.manual.hidden = true;
    document.body.classList.remove('con-scan');
    const r = resolver;
    resolver = null;
    if (r) r(resultado || null);
  }

  /* ── apertura ─────────────────────────────────────────────────────────── */

  async function abrir(opciones) {
    opciones = opciones || {};
    montarUI();

    // Una apertura nueva cierra la anterior sin dejar la cámara tomada.
    if (sesion) cerrar(null);

    ui.sub.textContent = opciones.subtitulo || 'acerca el código al marco';
    ui.estado.textContent = 'encendiendo la cámara…';
    ui.error.hidden = true;
    ui.hit.hidden = true;
    ui.manual.hidden = false;
    ui.input.value = '';
    ui.caja.classList.add('abierto');
    document.body.classList.add('con-scan');
    sesion = { raf: 0, ultimo: 0, ocupado: false, pausado: false };

    const promesa = new Promise(r => { resolver = r; });

    if (!soportado()) {
      avisar('La cámara necesita HTTPS y un navegador con getUserMedia. Escribe el código abajo.', true);
      ui.input.focus();
      return promesa;
    }

    try {
      await encender(opciones.dispositivo);
      sesion.detector = await prepararDetector();
      if (!sesion.detector) {
        avisar('Sin detector nativo: cargando decodificador…');
        try {
          sesion.zx = await prepararZXing();
        } catch (e) {
          sesion.zx = null;
        }
      }
      if (!sesion.detector && !sesion.zx) {
        avisar('Este navegador no puede decodificar solo. Escribe el código abajo.', true);
        ui.input.focus();
        return promesa;
      }
      ui.estado.textContent = sesion.detector
        ? 'detector del navegador · apunta al código'
        : 'decodificador ZXing · apunta al código';
      arrancarBucle();
    } catch (e) {
      const nombre = (e && e.name) || '';
      const txt = nombre === 'NotAllowedError'
        ? 'Permiso de cámara denegado. Puedes habilitarlo en el candado de la barra de direcciones.'
        : nombre === 'NotFoundError'
          ? 'No encontré ninguna cámara en este dispositivo.'
          : nombre === 'NotReadableError'
            ? 'Otra aplicación está usando la cámara.'
            : 'No pude abrir la cámara: ' + (e && e.message ? e.message : nombre);
      avisar(txt, true);
      ui.manual.hidden = false;
      ui.input.focus();
    }
    return promesa;
  }

  window.Scan = {
    abrir, cerrar,
    // Superficie pura para pruebas: sin DOM y sin cámara.
    normalizarCodigo, eanValido, pareceCodigo, digitoGS1,
    FORMATOS,
  };
})();
