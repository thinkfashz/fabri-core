/* Flujo de datos APK ↔ nube, en canvas 2D.
   --------------------------------------------------------------------------
   Mini-card animada: una retícula tipo matriz, dos nodos (APK y NUBE) y
   paquetes que viajan de ida y vuelta. La velocidad y el color salen del
   estado real (latencia y último resultado); si no hay conexión los paquetes
   se detienen y el marco se pone rojo. No inventa tráfico: sin datos, sólo
   muestra el enlace en reposo.

   Sin WebGL, sin librerías. Respeta prefers-reduced-motion y pausa cuando la
   pestaña está oculta. */

window.MatrizFlujo = function (canvas, opciones) {
  const o = opciones || {};
  const g = canvas.getContext('2d');
  if (!g) return null;

  const reducir = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let raf = 0;
  let t = 0;
  let w = 360, h = 150;
  let estado = { ok: false, ms: 0, productos: 0, sincronizando: false, dispositivos: 0 };
  const paquetes = [];
  const lluvia = [];
  let ultimo = 0;

  function ajustar() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth || 360;
    h = canvas.clientHeight || 150;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!lluvia.length) {
      for (let x = 8; x < w; x += 18) {
        lluvia.push({ x, y: Math.random() * h, v: 12 + Math.random() * 30, a: 0.05 + Math.random() * 0.12 });
      }
    }
  }

  function color() {
    if (!estado.ok) return '#F58C8C';
    if (estado.sincronizando) return '#F5C542';
    return '#B8E86A';
  }

  function nodo(x, y, etiqueta, sub, activo) {
    const an = 54, al = 30;
    g.save();
    g.translate(x - an / 2, y - al / 2);
    g.beginPath();
    if (typeof g.roundRect === 'function') g.roundRect(0, 0, an, al, 7);
    else g.rect(0, 0, an, al);
    g.fillStyle = 'rgba(10,14,10,0.92)';
    g.fill();
    g.lineWidth = 1.4;
    g.strokeStyle = activo ? color() : '#3A4A38';
    g.stroke();
    g.fillStyle = activo ? color() : '#8FA08C';
    g.font = '800 9px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(etiqueta, an / 2, al / 2 - 4);
    g.fillStyle = 'rgba(169,178,170,0.75)';
    g.font = '600 7.5px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.fillText(sub, an / 2, al / 2 + 8);
    g.restore();
  }

  function dibujar() {
    g.clearRect(0, 0, w, h);

    /* Fondo y retícula */
    g.fillStyle = '#070A08';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(200,245,66,0.055)';
    g.lineWidth = 1;
    for (let x = 0; x < w; x += 22) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y < h; y += 22) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }

    /* Lluvia de caracteres muy tenue */
    g.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.textAlign = 'center';
    lluvia.forEach((c) => {
      g.fillStyle = 'rgba(184,232,106,' + c.a + ')';
      g.fillText(Math.random() > 0.5 ? '1' : '0', c.x, c.y);
      if (!reducir) {
        c.y += c.v * 0.016;
        if (c.y > h + 8) { c.y = -8; c.x = 8 + Math.random() * (w - 16); }
      }
    });

    const y = h / 2 + 2;
    const ax = Math.max(38, w * 0.14);
    const nx = Math.min(w - 38, w * 0.86);
    const activo = estado.ok;

    /* Línea de enlace */
    g.save();
    g.setLineDash(estado.ok ? [] : [4, 5]);
    g.lineWidth = 1.2;
    g.strokeStyle = estado.ok ? 'rgba(184,232,106,0.28)' : 'rgba(245,140,140,0.35)';
    g.beginPath();
    g.moveTo(ax + 27, y);
    g.lineTo(nx - 27, y);
    g.stroke();
    g.restore();

    nodo(ax, y, 'APK', estado.dispositivos ? estado.dispositivos + ' disp.' : 'equipo', true);
    nodo(nx, y, 'NUBE', estado.productos ? estado.productos + ' prod.' : 'InsForge', activo);

    /* Paquetes: se generan si hay conexión; si no, se quedan quietos. */
    if (estado.ok && !reducir) {
      const ritmo = estado.sincronizando ? 0.022 : 0.009;
      if (!paquetes.length || Math.random() < ritmo) {
        if (paquetes.length < 8) {
          paquetes.push({ t: 0, dir: Math.random() > 0.45 ? 1 : -1, v: 0.0026 + Math.random() * 0.0022 });
        }
      }
    }
    for (let i = paquetes.length - 1; i >= 0; i--) {
      const p = paquetes[i];
      if (!reducir) p.t += p.v;
      if (p.t >= 1) { paquetes.splice(i, 1); continue; }
      const x0 = p.dir > 0 ? ax + 27 : nx - 27;
      const x1 = p.dir > 0 ? nx - 27 : ax + 27;
      const x = x0 + (x1 - x0) * p.t;
      const alfa = Math.sin(Math.PI * p.t) * 0.9 + 0.1;
      g.fillStyle = color();
      g.globalAlpha = alfa;
      g.fillRect(x - 3, y - 3, 6, 6);
      g.globalAlpha = 1;
      /* Estela */
      g.fillStyle = color();
      g.globalAlpha = alfa * 0.18;
      g.fillRect(x - (p.dir > 0 ? 10 : 0), y - 1, 10, 2);
      g.globalAlpha = 1;
    }

    /* Texto central bajo la línea */
    const etiqueta = !estado.ok
      ? 'SIN CONEXIÓN'
      : (estado.sincronizando ? 'SINCRONIZANDO' : 'EN LÍNEA');
    g.fillStyle = color();
    g.font = '800 8.5px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.textAlign = 'center';
    g.fillText(etiqueta, w / 2, y + 30);
    g.fillStyle = 'rgba(169,178,170,0.85)';
    g.font = '600 8px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.fillText((estado.ms ? estado.ms + ' ms' : '—') + ' · ' + (estado.ok ? 'ida y vuelta' : 'en reposo'), w / 2, y + 41);
  }

  function paso(ms) {
    raf = 0;
    if (document.hidden) return;
    const dt = ultimo ? Math.min(0.05, (ms - ultimo) / 1000) : 0.016;
    ultimo = ms;
    t += dt;
    dibujar();
    raf = requestAnimationFrame(paso);
  }

  function arrancar() {
    ajustar();
    if (reducir) { dibujar(); return; }
    if (!raf) { ultimo = 0; raf = requestAnimationFrame(paso); }
  }

  const enResize = () => { ajustar(); dibujar(); };
  window.addEventListener('resize', enResize);
  const enVis = () => { if (!document.hidden) arrancar(); };
  document.addEventListener('visibilitychange', enVis);

  arrancar();

  return {
    actualizar(nuevo) {
      estado = Object.assign({}, estado, nuevo || {});
      if (reducir) dibujar();
    },
    destruir() {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', enResize);
      document.removeEventListener('visibilitychange', enVis);
    },
  };
};
