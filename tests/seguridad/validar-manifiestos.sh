#!/usr/bin/env bash
# =============================================================================
#  FABRI-CORE · pruebas del validador de manifiestos (Fase 3)
#  ---------------------------------------------------------------------------
#  Compila tools/validador (misma fuente que el núcleo) y comprueba que acepta
#  el manifiesto correcto y rechaza cada variante peligrosa.
#
#  Uso: bash tests/seguridad/validar-manifiestos.sh
# =============================================================================
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="${TMPDIR:-/tmp/opencode}/fabri-t3-manifiestos"
BIN="$RAIZ/tools/validador/target/release/validador"

VERDE=$'\033[1;32m'; ROJO=$'\033[1;31m'; GRIS=$'\033[0;90m'; FIN=$'\033[0m'
FALLOS=0
PASOS=0

ok()  { PASOS=$((PASOS+1)); printf '  %s✔%s %s\n' "$VERDE" "$FIN" "$1"; }
mal() { PASOS=$((PASOS+1)); FALLOS=$((FALLOS+1)); printf '  %s✖%s %s\n' "$ROJO" "$FIN" "$1"; printf '     %s%s%s\n' "$GRIS" "${2:-}" "$FIN"; }

printf '\n\033[1m▸ compilando validador (sólo serde_json, sin red)\033[0m\n'
if ! cargo build --release --quiet --manifest-path "$RAIZ/tools/validador/Cargo.toml" 2>"$TMP.log"; then
  tail -20 "$TMP.log"
  echo "no se pudo compilar el validador"
  exit 1
fi
ok "validador compilado"

rm -rf "$TMP"; mkdir -p "$TMP"

base() {
  cat <<'JSON'
{
  "id": "runtime-llama",
  "nombre": "llama.cpp arm64",
  "tipo": "ejecutable",
  "version": "b11835",
  "descripcion": "prueba",
  "origen": "https://github.com/ggml-org/llama.cpp/releases/download/b11835/x.tar.gz",
  "origen_tipo": "github-release",
  "sha256": "0b0aff44980d4b7f243fc13aedb0dad378133773307988c7b590d59535976124",
  "tamano": 76728827,
  "autorizado": true,
  "licencia": "MIT",
  "plataforma": "android",
  "arquitectura": "arm64-v8a",
  "directorio": "filesDir/componentes/runtime-llama/",
  "comando": ["llama-cli", "-m", "modelo.gguf", "-p", "hola"],
  "salud": "llama-cli --version",
  "actualizacion": "manual",
  "desinstalacion": "borrar el directorio",
  "contenido_verificado": true
}
JSON
}

probar() { # nombre expectativa(0 valido|1 invalido) fragmento json
  local nombre="$1" esperado="$2" frag="$3" archivo="$TMP/$1.json"
  printf '%s\n' "$frag" > "$archivo"
  local salida
  salida=$("$BIN" "$archivo" 2>&1)
  local codigo=$?
  if [ "$esperado" = "0" ]; then
    if [ "$codigo" -eq 0 ] && printf '%s' "$salida" | jq -e '.valido == true' >/dev/null 2>&1; then
      ok "$nombre se acepta"
    else
      mal "$nombre se acepta" "$salida"
    fi
  else
    if [ "$codigo" -eq 1 ] && printf '%s' "$salida" | jq -e '.valido == false' >/dev/null 2>&1; then
      ok "$nombre se rechaza"
    else
      mal "$nombre se rechaza" "$salida"
    fi
  fi
}

printf '\n\033[1m▸ casos\033[0m\n'
probar "V1-valido" 0 "$(base)"

probar "V2-hash-mayusculas" 1 "$(base | jq '.sha256 = ("A" * 64)')"
probar "V3-origen-http" 1 "$(base | jq '.origen = "http://example.org/x.tar.gz"')"
probar "V4-comando-shell" 1 "$(base | jq '.comando = ["llama-cli;id"]')"
probar "V5-comando-absoluto" 1 "$(base | jq '.comando = ["/system/bin/sh","-c","id"]')"
probar "V6-campo-desconocido" 1 "$(base | jq '.shell = "rm -rf /"')"
probar "V7-sin-autorizacion" 1 "$(base | jq 'del(.autorizado) | .tamano = 62914560')"
probar "V8-tipo-desconocido" 1 "$(base | jq '.tipo = "binario"')"
probar "V9-sin-comando" 1 "$(base | jq 'del(.comando)')"
probar "V10-modelo-con-comando" 1 "$(base | jq '.tipo = "modelo" | .arquitectura = "agnostica-al-runtime"')"
probar "V11-json-roto" 1 "{ esto no es json "
probar "V12-tamano-cero" 1 "$(base | jq '.tamano = 0')"

# Manifiestos reales del proyecto.
if [ -d "$RAIZ/manifiestos" ]; then
  printf '\n\033[1m▸ manifiestos reales (manifiestos/**/*.json)\033[0m\n'
  while IFS= read -r archivo; do
    id=$(jq -r '.id // "?"' "$archivo" 2>/dev/null)
    salida=$("$BIN" "$archivo" 2>&1)
    case "$id" in
      runtime-llama)
        # Ya tiene comando y salud verificados en el equipo (b11835 ejecuta y
        # responde "--version"), así que ahora DEBE aceptarse. El caso de un
        # ejecutable sin comando se sigue probando en V9.
        if printf '%s' "$salida" | jq -e '.valido == true' >/dev/null 2>&1; then
          ok "manifiesto válido · runtime-llama (comando y salud verificados)"
        else
          mal "manifiesto válido · runtime-llama" "$salida"
        fi
        ;;
      *)
        if printf '%s' "$salida" | jq -e '.valido == true' >/dev/null 2>&1; then
          ok "manifiesto válido · $id"
        else
          mal "manifiesto válido · $id" "$salida"
        fi
        ;;
    esac
  done < <(find "$RAIZ/manifiestos" -name '*.json' | sort)
fi

printf '\n'
if [ "$FALLOS" -eq 0 ]; then
  printf '%s✔ %d comprobaciones, 0 fallos%s\n' "$VERDE" "$PASOS" "$FIN"
  exit 0
else
  printf '%s✖ %d comprobaciones, %d fallos%s\n' "$ROJO" "$PASOS" "$FALLOS" "$FIN"
  exit 1
fi
