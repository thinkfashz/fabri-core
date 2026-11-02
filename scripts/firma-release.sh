#!/usr/bin/env bash
# Inspecciona o crea la firma de release de FORGE CORE STOCK.
# La clave NUNCA va al repositorio: vive en ~/.config/opencode/secrets.
set -euo pipefail
SECRETOS="${FORGE_SECRETOS:-$HOME/.config/opencode/secrets}"
KS="$SECRETOS/forge-release.jks"
PASSF="$SECRETOS/forge-release.pass"

accion="${1:-estado}"

case "$accion" in
  crear)
    mkdir -p "$SECRETOS"
    [ -f "$KS" ] && { echo "ya existe $KS"; exit 0; }
    PASS=$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 24)
    printf '%s' "$PASS" > "$PASSF"
    chmod 600 "$PASSF"
    keytool -genkeypair -v -keystore "$KS" -alias forge \
      -keyalg RSA -keysize 4096 -validity 10000 \
      -storepass "$PASS" -keypass "$PASS" \
      -dname "CN=FORGE CORE STOCK, OU=Movil, O=Soluciones Fabrick, L=Santiago, ST=Region Metropolitana, C=CL" >/dev/null
    chmod 600 "$KS"
    echo "creada: $KS"
    ;;
  exportar)
    # Deja una copia para respaldo (¡sin ella no se pueden publicar updates!)
    [ -f "$KS" ] || { echo "no existe $KS" >&2; exit 1; }
    cp "$KS" "$HOME/forge-release-$(date +%Y%m%d).jks"
    echo "copia en $HOME/forge-release-$(date +%Y%m%d).jks"
    echo "guarda también la clave de $PASSF"
    ;;
  estado|*)
    if [ -f "$KS" ]; then
      keytool -list -v -keystore "$KS" -storepass "$(cat "$PASSF")" 2>/dev/null \
        | grep -E "Alias|Owner|Valid|SHA256" | head -5
    else
      echo "sin firma de release (se usa la de depuración)"
    fi
    ;;
esac
