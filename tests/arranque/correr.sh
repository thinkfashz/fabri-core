#!/usr/bin/env bash
# =============================================================================
#  Pruebas del arranque y del acceso de FABRI-CORE
#  ---------------------------------------------------------------------------
#  Lo que se comprueba (ver docs/ARRANQUE-Y-ACCESO.md):
#   1. Ningún id ausente del HTML puede cortar app.js.
#   2. Ningún script llama al puente durante la carga (bloquearía la pantalla).
#   3. El loader no depende de JavaScript para desaparecer.
#   4. El logo no tiene ningún relleno oscuro (el «cuadro negro» de la F).
#   5. El puente no vuelve a bloquear el hilo de JavaScript.
#
#  Uso:  bash tests/arranque/correr.sh
# =============================================================================
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WWW="$RAIZ/android/assets/www"
fallos=0

ok()   { printf '  \033[1;32m✔\033[0m %s\n' "$*"; }
mal()  { printf '  \033[1;31m✖\033[0m %s\n' "$*"; fallos=$((fallos + 1)); }

echo "▸ 1/4 sintaxis de los scripts"
for f in app.js datos.js conexiones.js inventario.js identidad.js flujo.js diagnostico.js; do
  if node --check "$WWW/$f" 2>/dev/null; then ok "$f"; else mal "$f no compila"; fi
done

echo "▸ 2/4 DOM hostil (falta cada id, uno por uno)"
if node "$RAIZ/tests/arranque/dom-hostil.js" > /tmp/fabri-dom-hostil.log 2>&1; then
  ok "0 roturas"
else
  mal "algún id ausente rompe app.js (ver /tmp/fabri-dom-hostil.log)"
  tail -5 /tmp/fabri-dom-hostil.log
fi

echo "▸ 3/4 carga sin bloqueo del puente"
if node "$RAIZ/tests/arranque/carga-sin-bloqueo.js" > /tmp/fabri-carga.log 2>&1; then
  ok "sin llamadas bloqueantes en la carga"
else
  mal "hay llamadas al puente durante la carga (ver /tmp/fabri-carga.log)"
  tail -8 /tmp/fabri-carga.log
fi

echo "▸ 4/6 loader sin JavaScript y logo sin relleno oscuro"
if grep -q "animation: loader-salida" "$WWW/app.css" \
   && grep -q "pointer-events: none" "$WWW/app.css"; then
  ok "el loader se desvanece por CSS y no captura toques"
else
  mal "el loader volvió a depender de JavaScript"
fi
if grep -q 'fill="#050505"' "$WWW/logo-loader.svg" "$WWW/logo-f.svg" 2>/dev/null; then
  mal "el logo tiene un relleno #050505 (vuelve el cuadro negro)"
else
  ok "el logo no tiene rellenos oscuros"
fi

echo "▸ 5/6 puente del núcleo (ping local, cola acotada, sin espera bloqueante)"
if node "$RAIZ/tests/arranque/puente.js" > /tmp/fabri-puente.log 2>&1; then
  ok "el puente no bloquea el hilo de JavaScript"
else
  mal "el puente volvió a bloquear (ver /tmp/fabri-puente.log)"
  tail -8 /tmp/fabri-puente.log
fi

echo "▸ 6/6 identidad del negocio (ID de cliente, RUT, caché)"
if node "$RAIZ/tests/arranque/identidad.js" > /tmp/fabri-identidad.log 2>&1; then
  ok "la ficha de identidad calcula bien ID, RUT y caché"
else
  mal "fallo en la ficha de identidad (ver /tmp/fabri-identidad.log)"
  tail -8 /tmp/fabri-identidad.log
fi

echo
if [ "$fallos" -eq 0 ]; then
  printf '\033[1;32m✔ arranque y acceso: todo en orden\033[0m\n'
  exit 0
fi
printf '\033[1;31m✖ %d fallo(s)\033[0m\n' "$fallos"
exit 1
