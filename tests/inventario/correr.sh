#!/usr/bin/env bash
# =============================================================================
#  Pruebas del inventario de FABRI-CORE
#  ---------------------------------------------------------------------------
#  Lo que se comprueba:
#   1. Lector de códigos: 404/500 se saltan, mensajes honestos, presupuesto de
#      tiempo y producto real.
#   2. Decodificador EAN-13 / EAN-8 / UPC-A propio (sin BarcodeDetector).
#   3. Las DOS bases: búsqueda en la nube (endpoint, token, cuerpo) + orden de
#      búsqueda local → nube → libres, y el escáner pro (malla en canvas).
#
#  Uso:  bash tests/inventario/correr.sh
# =============================================================================
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fallos=0

ok()  { printf '  \033[1;32m✔\033[0m %s\n' "$*"; }
mal() { printf '  \033[1;31m✖\033[0m %s\n' "$*"; fallos=$((fallos + 1)); }

echo "▸ 1/3 lector de códigos (bases libres)"
if node "$RAIZ/tests/inventario/lector.js" > /tmp/fabri-inv-lector.log 2>&1; then
  ok "el lector distingue «no publicado» de «sin red» y respeta el presupuesto"
else
  mal "fallo el lector de códigos (ver /tmp/fabri-inv-lector.log)"
  tail -8 /tmp/fabri-inv-lector.log
fi

echo "▸ 2/3 decodificador EAN propio"
if node "$RAIZ/tests/inventario/ean.js" > /tmp/fabri-inv-ean.log 2>&1; then
  ok "el decodificador EAN-13/EAN-8/UPC-A valida el dígito de control"
else
  mal "fallo el decodificador EAN (ver /tmp/fabri-inv-ean.log)"
  tail -8 /tmp/fabri-inv-ean.log
fi

echo "▸ 3/3 las 2 bases (local + nube) y el escáner pro"
if node "$RAIZ/tests/inventario/nube.js" > /tmp/fabri-inv-nube.log 2>&1; then
  ok "la búsqueda usa tu nube y la malla del escáner se enciende/apaga"
else
  mal "fallo la prueba de la nube/escáner (ver /tmp/fabri-inv-nube.log)"
  tail -8 /tmp/fabri-inv-nube.log
fi

echo
if [ "$fallos" -eq 0 ]; then
  printf '\033[1;32m✔ inventario: todo en orden\033[0m\n'
  exit 0
fi
printf '\033[1;31m✖ %s fallo(s)\033[0m\n' "$fallos"
exit 1
