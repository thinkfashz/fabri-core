#!/usr/bin/env bash
# =============================================================================
#  FABRI-CORE · pruebas de seguridad del descargador (Fase 3)
#  ---------------------------------------------------------------------------
#  Todo corre contra 127.0.0.1: no toca GitHub, Hugging Face ni el dispositivo.
#  Usa la MISMA clase Descargador.java que se empaqueta en la APK.
#
#  Uso: bash tests/seguridad/correr.sh
# =============================================================================
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="${TMPDIR:-/tmp/opencode}/fabri-t3"
PUERTO="${PUERTO:-8931}"
PUERTO_MUERTO="${PUERTO_MUERTO:-8932}"
CLASES="$TMP/clases"
SITIO="$TMP/sitio"
SALIDA="$TMP/descargas"
ARCHIVO="$SITIO/artefacto.bin"
TAM=$((20 * 1024 * 1024))

VERDE=$'\033[1;32m'; ROJO=$'\033[1;31m'; GRIS=$'\033[0;90m'; FIN=$'\033[0m'
FALLOS=0
PASOS=0

ok()   { PASOS=$((PASOS+1)); printf '  %s✔%s %s\n' "$VERDE" "$FIN" "$1"; }
mal()  { PASOS=$((PASOS+1)); FALLOS=$((FALLOS+1)); printf '  %s✖%s %s\n' "$ROJO" "$FIN" "$1"; printf '     %s%s%s\n' "$GRIS" "${2:-}" "$FIN"; }
nota() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

limpiar() {
  [ -n "${SERVIDOR_PID:-}" ] && kill "$SERVIDOR_PID" 2>/dev/null
  return 0
}
trap limpiar EXIT

esperar_campo() { # json expresion descripcion
  if printf '%s' "$1" | jq -e "$2" >/dev/null 2>&1; then ok "$3"; else mal "$3" "$1"; fi
}

# ---------------------------------------------------------------- preparación
nota "0/3 preparando entorno"
rm -rf "$TMP"
mkdir -p "$CLASES" "$SITIO" "$SALIDA"

javac -d "$CLASES" "$RAIZ/android/java/cl/fabrick/core/Descargador.java" "$RAIZ/tests/seguridad/DescargadorCli.java" \
  || { echo "no se pudo compilar Descargador"; exit 1; }
ok "Descargador.java compila con javac (sin Android)"

head -c "$TAM" /dev/urandom > "$ARCHIVO"
SHA=$(sha256sum "$ARCHIVO" | cut -d' ' -f1)
ok "fixture de 20 MiB generado · sha256 ${SHA:0:16}…"

python3 "$RAIZ/tests/seguridad/servidor.py" "$SITIO" "$PUERTO" 0.004 &
SERVIDOR_PID=$!
sleep 1
curl -s -o /dev/null "http://127.0.0.1:$PUERTO/artefacto.bin" || true
ok "servidor local en 127.0.0.1:$PUERTO"

CLI=(java -cp "$CLASES" DescargadorCli)

# ------------------------------------------------------------------- pruebas
nota "1/3 descarga y verificación"

R=$("${CLI[@]}" descargar "http://127.0.0.1:$PUERTO/artefacto.bin" "$SALIDA/artefacto.bin" "$TAM" "$SHA" 0 0 2>/dev/null)
esperar_campo "$R" '.ok == true' "T1 descarga completa"
esperar_campo "$R" '.estado == "DESCARGADO"' "T1 estado DESCARGADO"
[ -f "$SALIDA/artefacto.bin.recibo.json" ] && ok "T1 recibo escrito" || mal "T1 recibo escrito"
esperar_campo "$(cat "$SALIDA/artefacto.bin.recibo.json" 2>/dev/null || echo '{}')" '.verificado == true' "T1 recibo declara verificado"
[ "$(sha256sum "$SALIDA/artefacto.bin" | cut -d' ' -f1)" = "$SHA" ] && ok "T1 hash del archivo coincide" || mal "T1 hash del archivo coincide"

R=$("${CLI[@]}" verificar "$SALIDA/artefacto.bin" "$TAM" "$SHA")
esperar_campo "$R" '.ok == true and .estado == "VERIFICADO"' "T2 verificación posterior del archivo"

nota "2/3 rechazos"

SHA_MALO="${SHA%?}0"
[ "$SHA_MALO" = "$SHA" ] && SHA_MALO="${SHA%?}1"
rm -f "$SALIDA/malo.bin" "$SALIDA/malo.bin.parcial"
R=$("${CLI[@]}" descargar "http://127.0.0.1:$PUERTO/artefacto.bin" "$SALIDA/malo.bin" "$TAM" "$SHA_MALO" 0 0 2>/dev/null)
esperar_campo "$R" '.ok == false' "T3 hash incorrecto se rechaza"
esperar_campo "$R" '.motivo | test("SHA-256")' "T3 motivo menciona SHA-256"
[ ! -f "$SALIDA/malo.bin" ] && ok "T3 no queda archivo instalado" || mal "T3 no queda archivo instalado"
[ ! -f "$SALIDA/malo.bin.parcial" ] && ok "T3 no queda parcial" || mal "T3 no queda parcial"

rm -f "$SALIDA/tam.bin" "$SALIDA/tam.bin.parcial"
R=$("${CLI[@]}" descargar "http://127.0.0.1:$PUERTO/artefacto.bin" "$SALIDA/tam.bin" "$((TAM+1))" "$SHA" 0 0 2>/dev/null)
esperar_campo "$R" '.ok == false' "T4 tamaño distinto se rechaza"
[ ! -f "$SALIDA/tam.bin" ] && ok "T4 no queda archivo" || mal "T4 no queda archivo"

R=$("${CLI[@]}" descargar "http://127.0.0.1:$PUERTO/artefacto.bin" "$SALIDA/caro.bin" "$((60*1024*1024))" "$SHA" 0 0 2>/dev/null)
esperar_campo "$R" '.estado == "RECHAZADO"' "T9 >50 MiB sin autorización se rechaza"

R=$("${CLI[@]}" descargar "http://example.org/x.bin" "$SALIDA/http.bin" 100 "$SHA" 0 0 2>/dev/null)
esperar_campo "$R" '.estado == "RECHAZADO"' "T11 http:// fuera de loopback se rechaza"

R=$("${CLI[@]}" descargar "http://127.0.0.1:$PUERTO_MUERTO/artefacto.bin" "$SALIDA/red.bin" "$TAM" "$SHA" 0 2 2>/dev/null)
esperar_campo "$R" '.ok == false and (.motivo | test("3 intento"))' "T5 reintentos acotados y error final"
[ ! -f "$SALIDA/red.bin.parcial" ] && ok "T5 no queda parcial tras fallar" || mal "T5 no queda parcial tras fallar"

nota "3/3 cancelación y recuperación"

mkdir -p "$SALIDA"
echo "basura previa" > "$SALIDA/parcial.bin.parcial"
R=$("${CLI[@]}" descargar "http://127.0.0.1:$PUERTO/artefacto.bin" "$SALIDA/parcial.bin" "$TAM" "$SHA" 0 0 2>/dev/null)
esperar_campo "$R" '.ok == true' "T6 parcial corrupto se descarta y se rebaja limpio"
[ "$(sha256sum "$SALIDA/parcial.bin" | cut -d' ' -f1)" = "$SHA" ] && ok "T6 archivo final íntegro" || mal "T6 archivo final íntegro"

R=$("${CLI[@]}" descargar "http://127.0.0.1:$PUERTO/artefacto.bin" "$SALIDA/cancel.bin" "$TAM" "$SHA" 0 0 250 2>/dev/null)
esperar_campo "$R" '.estado == "CANCELADO"' "T10 cancelación a mitad"
[ ! -f "$SALIDA/cancel.bin" ] && [ ! -f "$SALIDA/cancel.bin.parcial" ] && ok "T10 no deja archivos tras cancelar" || mal "T10 no deja archivos tras cancelar"

# ------------------------------------------------------------------- resumen
printf '\n'
if [ "$FALLOS" -eq 0 ]; then
  printf '%s✔ %d comprobaciones, 0 fallos%s\n' "$VERDE" "$PASOS" "$FIN"
  exit 0
else
  printf '%s✖ %d comprobaciones, %d fallos%s\n' "$ROJO" "$PASOS" "$FALLOS" "$FIN"
  exit 1
fi
