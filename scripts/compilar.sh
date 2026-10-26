#!/usr/bin/env bash
# =============================================================================
#  FABRI-CORE · compilación de la APK sin Gradle
#  ---------------------------------------------------------------------------
#  Pipeline: Rust → javac → d8 → aapt2 → zip → zipalign → apksigner
#
#  Por qué sin Gradle: el dispositivo ya tiene aapt2, d8, zipalign y apksigner
#  del paquete Termux, y el pipeline offline ya está probado en fabrickSpa.
#  Evita descargar AGP/Kotlin (cientos de MB) y funciona sin red.
#
#  Uso:  bash scripts/compilar.sh
# =============================================================================
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK="${SDK:-/data/data/com.termux/files/home/android-sdk}"
BT="$SDK/build-tools/34.0.0"
ANDROID_JAR="$SDK/platforms/android-34/android.jar"
KS="$SDK/debug.keystore"
CACHE_CARGO="${CACHE_CARGO:-/data/data/com.termux/files/home/.cargo}"

B="$RAIZ/build"
DIST="$RAIZ/dist"
NOMBRE="FABRI-CORE-0.9.12"

# La versión vive en tres sitios y aapt2 la sobreescribe si no coinciden. Se
# leen del manifiesto para que `--version-code` nunca quede atrás (un APK con
# el mismo versionCode que el anterior NO se instala encima).
VCODE=$(grep -o 'android:versionCode="[0-9]*"' android/AndroidManifest.xml | grep -o '[0-9]*')
VNAME=$(grep -o 'android:versionName="[^"]*"' android/AndroidManifest.xml | sed 's/.*="//; s/"//')
[ -n "$VCODE" ] && [ -n "$VNAME" ] || { echo "no pude leer la versión del manifiesto" >&2; exit 1; }

log() { printf '\n\033[1;32m▸ %s\033[0m\n' "$*"; }
fallo() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

# --- 0. Comprobaciones previas -----------------------------------------------
log "0/7 comprobando herramientas"
for t in cargo javac d8 aapt2 zipalign apksigner zip; do
  command -v "$t" >/dev/null 2>&1 || fallo "falta la herramienta: $t"
done
[ -f "$ANDROID_JAR" ] || fallo "no existe android.jar en $ANDROID_JAR"
[ -f "$KS" ] || fallo "no existe el keystore de depuración en $KS"

# Aviso de espacio: no se compila con menos de 1 GB libre.
LIBRE_KB=$(df -Pk "$RAIZ" | awk 'NR==2 {print $4}')
[ "$LIBRE_KB" -gt 1048576 ] || fallo "espacio insuficiente: $((LIBRE_KB/1024)) MB libres (mínimo 1 GB)"

rm -rf "$B"
mkdir -p "$B/classes" "$B/dex" "$B/res" "$B/lib/arm64-v8a" "$DIST"

# --- 1. Núcleo Rust ----------------------------------------------------------
log "1/7 compilando el núcleo Rust (aarch64-linux-android)"
cd "$RAIZ/src-tauri"
CARGO_HOME="$CACHE_CARGO" \
CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}" \
CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER=clang \
CC_aarch64_linux_android="$RAIZ/scripts/cc-android24.sh" \
AR_aarch64_linux_android=llvm-ar \
CFLAGS_aarch64_linux_android="-fPIC -D__ANDROID_API__=24" \
cargo build --target aarch64-linux-android --release

SO="$RAIZ/src-tauri/target/aarch64-linux-android/release/libfabrick_core.so"
[ -f "$SO" ] || fallo "no se generó libfabrick_core.so"
cp "$SO" "$B/lib/arm64-v8a/"
log "   .so: $(stat -c %s "$SO") bytes"

# --- 1b. Runtime nativo A1 ----------------------------------------------------
# W^X impide ejecutar binarios desde filesDir, pero Android sí permite cargar
# bibliotecas .so empaquetadas en la APK. Se copian las 5 bibliotecas de
# llama.cpp y se compila un shim JNI mínimo que sólo consulta llama_version().
log "1b/7 empaquetando runtime nativo A1 (llama.cpp b11835)"
RUNTIME="$RAIZ/runtime/llama-b11835"
[ -d "$RUNTIME/arm64-v8a" ] || fallo "falta runtime/llama-b11835/arm64-v8a"
JAVA_HOME="${JAVA_HOME:-$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")}"
[ -f "$JAVA_HOME/include/jni.h" ] || fallo "no se encontró jni.h en $JAVA_HOME/include"
cp "$RUNTIME"/arm64-v8a/*.so "$B/lib/arm64-v8a/"
clang --target=aarch64-linux-android24 -shared -fPIC \
  -I "$RUNTIME/include" \
  -I "$JAVA_HOME/include" \
  -I "$JAVA_HOME/include/linux" \
  "$RUNTIME/shim/fabrick_llama.c" \
  "$RUNTIME/shim/jni_runtime.c" \
  -L "$RUNTIME/arm64-v8a" -lllama \
  -o "$B/lib/arm64-v8a/libfabrick_llama.so"
log "   runtime: $(find "$B/lib/arm64-v8a" -name '*.so' | wc -l) bibliotecas"

# --- 2. Java -----------------------------------------------------------------
log "2/7 compilando el contenedor Java"
cd "$RAIZ"
mapfile -t FUENTES < <(find android/java -name '*.java')
javac -source 1.8 -target 1.8 -Xlint:-options \
  -bootclasspath "$ANDROID_JAR" \
  -d "$B/classes" \
  "${FUENTES[@]}"

# --- 3. DEX ------------------------------------------------------------------
log "3/7 convirtiendo a DEX"
mapfile -t CLASES < <(find "$B/classes" -name '*.class')
d8 --lib "$ANDROID_JAR" --min-api 24 --release \
  --output "$B/dex" "${CLASES[@]}"
[ -f "$B/dex/classes.dex" ] || fallo "d8 no generó classes.dex"

# --- 4. Recursos con aapt2 ---------------------------------------------------
log "4/7 compilando recursos y empaquetando"
# El instalador del puente Termux se empaqueta como asset para que la app pueda
# dejarlo en el portapapeles sin depender de la red ni de un archivo externo.
cp "$RAIZ/scripts/termux-puente.py" android/assets/termux-puente.py

aapt2 compile --dir android/res -o "$B/res/recursos.zip"
aapt2 link \
  -o "$B/base.apk" \
  -I "$ANDROID_JAR" \
  --manifest android/AndroidManifest.xml \
  -R "$B/res/recursos.zip" \
  -A android/assets \
  --min-sdk-version 24 \
  --target-sdk-version 34 \
  --version-code "$VCODE" \
  --version-name "$VNAME" \
  --auto-add-overlay

# --- 5. DEX + biblioteca nativa dentro del APK -------------------------------
log "5/7 insertando dex y biblioteca nativa"
cd "$B"
cp base.apk sin-firmar.apk
zip -q -j sin-firmar.apk dex/classes.dex
zip -q sin-firmar.apk lib/arm64-v8a/*.so

# --- 6. Alineado y firma -----------------------------------------------------
log "6/7 alineando y firmando"
zipalign -f -p 4 sin-firmar.apk alineado.apk

ALIAS=$(keytool -list -keystore "$KS" -storepass android 2>/dev/null \
        | grep -o '^[a-zA-Z0-9_-]*,' | head -1 | tr -d ',' || true)
[ -n "${ALIAS:-}" ] || fallo "no se pudo leer el alias del keystore"

apksigner sign \
  --ks "$KS" --ks-pass pass:android --key-pass pass:android \
  --ks-key-alias "$ALIAS" \
  --min-sdk-version 24 \
  --out "$DIST/$NOMBRE.apk" alineado.apk

# --- 7. Verificación ---------------------------------------------------------
log "7/7 verificando la APK"
# La versión que quedó dentro de la APK tiene que ser la del manifiesto.
DENTRO=$(aapt2 dump badging "$DIST/$NOMBRE.apk" | head -1 | grep -o "versionCode='[0-9]*'" | grep -o '[0-9]*')
[ "$DENTRO" = "$VCODE" ] || fallo "versionCode dentro de la APK ($DENTRO) != manifiesto ($VCODE)"
"$BT/apksigner" verify --print-certs "$DIST/$NOMBRE.apk" | head -6
TAM=$(stat -c %s "$DIST/$NOMBRE.apk")
log "APK lista: $DIST/$NOMBRE.apk · $((TAM/1024)) KB"
aapt2 dump badging "$DIST/$NOMBRE.apk" | head -4
