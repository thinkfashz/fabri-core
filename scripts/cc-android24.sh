#!/usr/bin/env bash
# -----------------------------------------------------------------------------
#  Wrapper de clang para compilar C dentro de una APK Android.
#
#  Problema: el cc-rs de Rust pasa "--target=aarch64-linux-android" sin versión
#  de API, y las cabeceras de Termux lo rechazan:
#      /usr/include/sys/cdefs.h:365:2: error: Unversioned target triples are not supported!
#
#  Solución: descartar cualquier --target recibido y fijar el triple versionado.
# -----------------------------------------------------------------------------
set -euo pipefail

ARGS=()
for a in "$@"; do
  case "$a" in
    --target=*) continue ;;   # se ignora el triple sin versión
  esac
  ARGS+=("$a")
done

exec clang --target=aarch64-linux-android24 "${ARGS[@]}"
