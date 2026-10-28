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
#   4. Importación masiva, apilador, catálogo y boleta.
#   5. Equipos del local: impresora ESC/POS por WiFi, lector de red/HID,
#      importación desde la SD y guía de InsForge.
#   6. LectorXlsx en Java puro: dos hojas, shared strings, inline, fórmula
#      cacheada y archivo inválido.
#
#  Uso:  bash tests/inventario/correr.sh
# =============================================================================
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fallos=0

ok()  { printf '  \033[1;32m✔\033[0m %s\n' "$*"; }
mal() { printf '  \033[1;31m✖\033[0m %s\n' "$*"; fallos=$((fallos + 1)); }

echo "▸ 1/6 lector de códigos (bases libres)"
if node "$RAIZ/tests/inventario/lector.js" > /tmp/fabri-inv-lector.log 2>&1; then
  ok "el lector distingue «no publicado» de «sin red» y respeta el presupuesto"
else
  mal "fallo el lector de códigos (ver /tmp/fabri-inv-lector.log)"
  tail -8 /tmp/fabri-inv-lector.log
fi

echo "▸ 2/6 decodificador EAN propio"
if node "$RAIZ/tests/inventario/ean.js" > /tmp/fabri-inv-ean.log 2>&1; then
  ok "el decodificador EAN-13/EAN-8/UPC-A valida el dígito de control"
else
  mal "fallo el decodificador EAN (ver /tmp/fabri-inv-ean.log)"
  tail -8 /tmp/fabri-inv-ean.log
fi

echo "▸ 3/6 las 2 bases (local + nube) y el escáner pro"
if node "$RAIZ/tests/inventario/nube.js" > /tmp/fabri-inv-nube.log 2>&1; then
  ok "la búsqueda usa tu nube y la malla del escáner se enciende/apaga"
else
  mal "fallo la prueba de la nube/escáner (ver /tmp/fabri-inv-nube.log)"
  tail -8 /tmp/fabri-inv-nube.log
fi

echo "▸ 4/6 importación masiva, apilador, catálogo y boleta"
if node "$RAIZ/tests/inventario/nuevo.js" > /tmp/fabri-inv-nuevo.log 2>&1; then
  ok "CSV/TSV/JSON, barras, apilador y ticket imprimible"
else
  mal "fallo la prueba de importación/apilador/boleta (ver /tmp/fabri-inv-nuevo.log)"
  tail -10 /tmp/fabri-inv-nuevo.log
fi

echo "▸ 5/6 equipos del local (impresora, lector, base y guía)"
if node "$RAIZ/tests/inventario/equipos.js" > /tmp/fabri-inv-equipos.log 2>&1; then
  ok "ESC/POS por WiFi, lector de red, importación nativa y guía de InsForge"
else
  mal "fallo la prueba de equipos (ver /tmp/fabri-inv-equipos.log)"
  tail -12 /tmp/fabri-inv-equipos.log
fi

echo "▸ 6/6 LectorXlsx en Java puro"
CLASES=/tmp/fabri-xlsx-clases
rm -rf "$CLASES" && mkdir -p "$CLASES"
if javac -encoding UTF-8 -d "$CLASES" \
     "$RAIZ/android/java/cl/fabrick/core/LectorXlsx.java" \
     "$RAIZ/tests/inventario/LectorXlsxPrueba.java" > /tmp/fabri-inv-xlsx.log 2>&1 \
   && java -cp "$CLASES" cl.fabrick.core.LectorXlsxPrueba >> /tmp/fabri-inv-xlsx.log 2>&1; then
  ok "el lector XLSX entiende dos hojas, rich text y fórmulas cacheadas"
else
  mal "fallo la prueba de LectorXlsx (ver /tmp/fabri-inv-xlsx.log)"
  tail -10 /tmp/fabri-inv-xlsx.log
fi

echo
if [ "$fallos" -eq 0 ]; then
  printf '\033[1;32m✔ inventario: todo en orden\033[0m\n'
  exit 0
fi
printf '\033[1;31m✖ %s fallo(s)\033[0m\n' "$fallos"
exit 1
