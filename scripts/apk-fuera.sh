#!/usr/bin/env bash
# =============================================================================
#  FORGE CORE STOCK · deja la APK SIEMPRE fuera del repo, en rutas fijas
#  ---------------------------------------------------------------------------
#  El build (scripts/compilar.sh, paso 8/8) lo llama al terminar. También se
#  puede correr a mano para refrescar las copias sin recompilar:
#
#      bash scripts/apk-fuera.sh
#
#  Destinos (los dos, siempre):
#   1. /storage/emulated/0/Download/FORGE-CORE-STOCK.apk
#      Fuera del repo, en el teléfono: es la que se instala desde el gestor
#      de archivos. El nombre NO lleva versión, así el atajo viejo siempre
#      apunta a la última build. `dist/` queda sólo como respaldo.
#   2. web/descargas/FORGE-CORE-STOCK.apk
#      La que sirve el sitio (botón «Descargar APK»); va versionada en git a
#      propósito (ver .gitignore: `!web/descargas/*.apk`).
#
#  Variables: FORGE_FUERA_DIR (destino 1) y FORGE_DIST (origen).
# =============================================================================
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="${FORGE_DIST:-$RAIZ/dist}"
FUERA_DIR="${FORGE_FUERA_DIR:-/storage/emulated/0/Download}"
SITIO_DIR="$RAIZ/web/descargas"

# La más reciente de dist/ (excluye .idsig y los .apk sueltos de pruebas).
ORIGEN="${1:-}"
if [ -z "$ORIGEN" ]; then
  ORIGEN="$(ls -t "$DIST"/*.apk 2>/dev/null | head -1 || true)"
fi
[ -n "$ORIGEN" ] && [ -f "$ORIGEN" ] || { echo "no hay APK en $DIST" >&2; exit 1; }

ORIGEN="$(cd "$(dirname "$ORIGEN")" && pwd)/$(basename "$ORIGEN")"
TAM_ORIGEN=$(stat -c %s "$ORIGEN")
SHA_ORIGEN=$(sha256sum "$ORIGEN" | cut -d' ' -f1)

# copia <destino> — idéntica byte a byte, o aviso (no rompe el build)
copia() {
  local dest="$1" dir
  dir="$(dirname "$dest")"
  mkdir -p "$dir" 2>/dev/null || { echo "aviso: no existe $dir" >&2; return 1; }
  if ! cp -f "$ORIGEN" "$dest" 2>/dev/null; then
    echo "aviso: no pude escribir $dest" >&2
    return 1
  fi
  if ! cmp -s "$ORIGEN" "$dest"; then
    echo "aviso: $dest no coincide con el origen" >&2
    return 1
  fi
  echo "✔ $dest · $(stat -c %s "$dest") bytes"
}

echo "origen: $ORIGEN ($((TAM_ORIGEN / 1024)) KB · sha256 ${SHA_ORIGEN:0:16}…)"
copia "$FUERA_DIR/FORGE-CORE-STOCK.apk" || echo "  la APK quedó en $ORIGEN" >&2
copia "$SITIO_DIR/FORGE-CORE-STOCK.apk" || true
echo "INSTALA DESDE: $FUERA_DIR/FORGE-CORE-STOCK.apk"
