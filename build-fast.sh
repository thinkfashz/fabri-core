#!/usr/bin/env bash
# =============================================================================
# FABRI-CORE · build RÁPIDO sin Gradle (solo herramientas del SDK).
#
# Por qué: en este teléfono el build con Gradle+Compose se eterniza (configuración
# de 20+ min) y el kernel mata el daemon. Este pipeline no descarga nada, no
# levanta daemon y arma la APK en pocos minutos:
#
#   1) aapt2 compile/link   → recursos + AndroidManifest → base.apk + R.java
#   2) kotlinc (embebido)  → .class
#   3) d8                   → classes.dex
#   4) zip + zipalign       → APK alineada
#   5) apksigner            → APK firmada (debug.keystore del SDK)
#
# Uso: bash build-fast.sh
# =============================================================================
set -uo pipefail

SDK=/root/android-sdk
# Las herramientas del SDK de /root/android-sdk son binarios x86-64: NO corren en ARM.
# Las de Termux son ARM (INTERP /system/bin/linker64) y sí funcionan en este teléfono.
BT=/data/data/com.termux/files/usr/bin
ANDROID_JAR=$SDK/platforms/android-34/android.jar
KS_TERMUX=/data/data/com.termux/files/home/android-sdk/debug.keystore
JAVA=/data/data/com.termux/files/usr/lib/jvm/java-21-openjdk/bin/java
GRADLE_CACHE=/root/.gradle/caches/modules-2/files-2.1
PROJECT=/root/fabri-core
OUT=$PROJECT/fast/out
RES=$PROJECT/fast/res

T0=$(date +%s)
step() { local n=$1; shift; local d=$(( $(date +%s) - T0 )); printf "\033[1;33m[fabrick]\033[0m %-42s (+%ss)\n" "$n" "$d"; }
say() { printf "\033[1;33m[fabrick]\033[0m %s\n" "$*"; }
die() { printf "\033[1;31m[fabrick]\033[0m %s\n" "$*" >&2; exit 1; }

# --- compilador Kotlin embebido (ya está en la caché de Gradle: no descargas) ---
KCOMP=$(find "$GRADLE_CACHE/org.jetbrains.kotlin/kotlin-compiler-embeddable" -name "kotlin-compiler-embeddable-*.jar" 2>/dev/null | head -1)
# stdlib 2.0.21 (el que hay en la caché de Gradle es 1.9.23: no sirve con este compilador)
KSTD=$PROJECT/fast/lib/kotlin-stdlib-2.0.21.jar
[ -f "$KSTD" ] || KSTD=$(find "$GRADLE_CACHE/org.jetbrains.kotlin/kotlin-stdlib" -name "kotlin-stdlib-*.jar" 2>/dev/null | head -1)
KREF=$(find "$GRADLE_CACHE/org.jetbrains.kotlin/kotlin-reflect" -name "kotlin-reflect-*.jar" 2>/dev/null | head -1)
KSCRIPT=$(find "$GRADLE_CACHE/org.jetbrains.kotlin/kotlin-script-runtime" -name "*.jar" 2>/dev/null | head -1)
KDAEMON=$(find "$GRADLE_CACHE/org.jetbrains.kotlin/kotlin-daemon-embeddable" -name "*.jar" 2>/dev/null | head -1)
KCOR=$(find "$GRADLE_CACHE/org.jetbrains.kotlinx/kotlinx-coroutines-core-jvm" -name "*.jar" 2>/dev/null | head -1)
KTROVE=$(find "$GRADLE_CACHE/org.jetbrains.intellij.deps/trove4j" -name "*.jar" 2>/dev/null | head -1)
KANN=$(find "$GRADLE_CACHE/org.jetbrains/annotations" -name "annotations-*.jar" 2>/dev/null | head -1)
[ -n "$KCOMP" ] || die "no encuentro kotlin-compiler-embeddable en la caché de Gradle"

rm -rf "$OUT"; mkdir -p "$OUT/compiled" "$OUT/gen" "$OUT/classes" "$OUT/dex"

step "1/5 recursos (aapt2)"
"$BT/aapt2" compile --dir "$RES" -o "$OUT/compiled/res.zip" || die "aapt2 compile falló"
"$BT/aapt2" link \
  -o "$OUT/base.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$PROJECT/fast/AndroidManifest.xml" \
  --java "$OUT/gen" \
  --min-sdk-version 26 --target-sdk-version 34 \
  --version-code 1 --version-name 1.0.0-lite \
  "$OUT/compiled/res.zip" || die "aapt2 link falló"

step "2/5 kotlin (compilador embebido, sin daemon)"
"$JAVA" -Xmx1200m -cp "$KCOMP:$KSTD:$KREF:$KSCRIPT:$KDAEMON:$KCOR:$KTROVE:$KANN" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler \
  -no-stdlib -nowarn \
  -jvm-target 17 \
  -classpath "$ANDROID_JAR:$KSTD:$KANN" \
  -d "$OUT/classes" \
  "$PROJECT/fast/lite/LiteActivity.kt" \
  "$OUT/gen" || die "kotlinc falló"

step "3/5 dex (d8)"
find "$OUT/classes" -name "*.class" > "$OUT/classlist.txt"
# d8 del SDK (34.0.0): es un script que invoca Java, así que corre en ARM.
# El d8 de Termux es de API 16 y tardaba 177 s; este tarda ~26 s.
export PATH="$(dirname "$JAVA"):$PATH"
"$SDK/build-tools/34.0.0/d8" --lib "$ANDROID_JAR" --min-api 26 --output "$OUT/dex" @"$OUT/classlist.txt" 2>/dev/null || die "d8 falló"

step "4/5 empaquetado y alineado"
cp "$OUT/base.apk" "$OUT/unsigned.apk"
(cd "$OUT/dex" && zip -q -j "$OUT/unsigned.apk" classes*.dex) || die "zip falló"
"$BT/zipalign" -p -f 4 "$OUT/unsigned.apk" "$OUT/aligned.apk" || die "zipalign falló"

step "5/5 firma (debug.keystore del SDK)"
KS="$KS_TERMUX"
[ -f "$KS" ] || KS="$SDK/debug.keystore"
[ -f "$KS" ] || die "no encuentro debug.keystore"
"$BT/apksigner" sign \
  --ks "$KS" --ks-pass pass:android --ks-key-alias debug --key-pass pass:android \
  --out "$OUT/fabri-core-lite.apk" "$OUT/aligned.apk" || die "apksigner falló"
# la verificación cuesta ~35 s (arranque de JVM): se deja opcional
[ "${VERIFY:-0}" = "1" ] && "$BT/apksigner" verify --verbose "$OUT/fabri-core-lite.apk" | head -3

mkdir -p "$PROJECT/out"
cp "$OUT/fabri-core-lite.apk" "$PROJECT/out/fabri-core-lite.apk"
say "APK lista: $PROJECT/out/fabri-core-lite.apk ($(du -h "$PROJECT/out/fabri-core-lite.apk" | cut -f1)) · total $(( $(date +%s) - T0 ))s"
say "instalar en este mismo dispositivo: pm install -r $PROJECT/out/fabri-core-lite.apk"
