#!/usr/bin/env bash
# =============================================================================
# FABRI-CORE · build RÁPIDO sin Gradle.
#
# Por qué: en el teléfono, Gradle+Compose se eterniza (fase de configuración de
# 20+ min) y el kernel mata el daemon. Este pipeline no levanta daemon, no resuelve
# dependencias y arma la APK en minutos:
#
#   1) aapt2 compile/link  → recursos + AndroidManifest → base.apk + R.java
#   2) kotlinc (embebido) → .class
#   3) d8                 → classes.dex
#   4) zip + zipalign     → APK alineada
#   5) apksigner          → APK firmada (keystore de debug)
#
# Funciona igual en dos mundos:
#   · Termux/proot (ARM): usa las herramientas ARM de Termux y la caché de Gradle.
#   · Linux/CI (x86-64):  usa el build-tools del SDK y baja los jars de Maven.
#
# Uso:  bash build-fast.sh          · un intento
#       VERIFY=1 bash build-fast.sh · además verifica la firma (~35 s más)
# =============================================================================
set -uo pipefail

PROJECT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
OUT=$PROJECT/fast/out
RES=$PROJECT/fast/res
LIB=$PROJECT/fast/lib
T0=$(date +%s)

step() { local d=$(( $(date +%s) - T0 )); printf '\033[1;33m[fabrick]\033[0m %-42s (+%ss)\n' "$1" "$d"; }
say()  { printf '\033[1;33m[fabrick]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[fabrick]\033[0m %s\n' "$*" >&2; exit 1; }

# ── plataforma ────────────────────────────────────────────────────────────────
if [ -d /data/data/com.termux/files/usr ]; then
  PLAT=termux
  BT=/data/data/com.termux/files/usr/bin        # binarios ARM (los del SDK son x86-64)
  JAVA=/data/data/com.termux/files/usr/lib/jvm/java-21-openjdk/bin/java
  SDK=${ANDROID_SDK_ROOT:-/root/android-sdk}
  KS=/data/data/com.termux/files/home/android-sdk/debug.keystore
  [ -f "$KS" ] || KS=/root/android-sdk/debug.keystore
else
  PLAT=linux
  SDK=${ANDROID_SDK_ROOT:-${ANDROID_HOME:-/usr/lib/android-sdk}}
  BT=$(ls -d "$SDK"/build-tools/* 2>/dev/null | sort -V | tail -1)
  JAVA=$(command -v java || true)
  [ -n "$BT" ] || die "no encuentro build-tools en $SDK"
  KS=$PROJECT/fast/debug.keystore
fi
[ -n "${JAVA:-}" ] || die "no encuentro java"
ANDROID_JAR=$SDK/platforms/android-34/android.jar
[ -f "$ANDROID_JAR" ] || ANDROID_JAR=$(ls "$SDK"/platforms/*/android.jar 2>/dev/null | sort -V | tail -1)
[ -f "$ANDROID_JAR" ] || die "no encuentro android.jar en $SDK/platforms"
say "plataforma: $PLAT · build-tools: $(basename "$BT") · $(basename "$ANDROID_JAR")"

# ── Kotlin: caché de Gradle si está; si no, Maven Central ─────────────────────
KVER=2.0.21
M=https://repo1.maven.org/maven2
GC=/root/.gradle/caches/modules-2/files-2.1
mkdir -p "$LIB"

get_jar() { # get_jar <ruta-en-cache> <patrón> <url> <nombre-local>
  local hit
  hit=$(find "$GC/$1" -name "$2" 2>/dev/null | head -1)
  if [ -n "$hit" ]; then echo "$hit"; return; fi
  local dest=$LIB/$4
  if [ ! -s "$dest" ]; then
    curl -sSL --retry 3 -m 240 -o "$dest" "$3" || { rm -f "$dest"; return 1; }
  fi
  echo "$dest"
}

KCOMP=$(get_jar org.jetbrains.kotlin/kotlin-compiler-embeddable 'kotlin-compiler-embeddable-*.jar' \
        "$M/org/jetbrains/kotlin/kotlin-compiler-embeddable/$KVER/kotlin-compiler-embeddable-$KVER.jar" kotlin-compiler-embeddable.jar) \
  || die "no pude obtener el compilador Kotlin"
KSTD=$(get_jar org.jetbrains.kotlin/kotlin-stdlib 'kotlin-stdlib-2.0.21.jar' \
        "$M/org/jetbrains/kotlin/kotlin-stdlib/$KVER/kotlin-stdlib-$KVER.jar" kotlin-stdlib.jar) \
  || die "no pude obtener kotlin-stdlib"
KREF=$(get_jar org.jetbrains.kotlin/kotlin-reflect 'kotlin-reflect-*.jar' \
        "$M/org/jetbrains/kotlin/kotlin-reflect/1.9.23/kotlin-reflect-1.9.23.jar" kotlin-reflect.jar) || true
KSCRIPT=$(get_jar org.jetbrains.kotlin/kotlin-script-runtime '*.jar' \
        "$M/org/jetbrains/kotlin/kotlin-script-runtime/$KVER/kotlin-script-runtime-$KVER.jar" kotlin-script-runtime.jar) || true
KDAEMON=$(get_jar org.jetbrains.kotlin/kotlin-daemon-embeddable '*.jar' \
        "$M/org/jetbrains/kotlin/kotlin-daemon-embeddable/$KVER/kotlin-daemon-embeddable-$KVER.jar" kotlin-daemon-embeddable.jar) || true
KCOR=$(get_jar org.jetbrains.kotlinx/kotlinx-coroutines-core-jvm '*.jar' \
        "$M/org/jetbrains/kotlinx/kotlinx-coroutines-core-jvm/1.8.1/kotlinx-coroutines-core-jvm-1.8.1.jar" kotlinx-coroutines-core-jvm.jar) || true
KTROVE=$(get_jar org.jetbrains.intellij.deps/trove4j '*.jar' \
        "$M/org/jetbrains/intellij/deps/trove4j/1.0.20200330/trove4j-1.0.20200330.jar" trove4j.jar) || true
KANN=$(get_jar org.jetbrains/annotations 'annotations-*.jar' \
        "$M/org/jetbrains/annotations/13.0/annotations-13.0.jar" annotations.jar) || true

KCP="$KCOMP:$KSTD:$KREF:$KSCRIPT:$KDAEMON:$KCOR:$KTROVE:$KANN"

rm -rf "$OUT"; mkdir -p "$OUT/compiled" "$OUT/gen" "$OUT/classes" "$OUT/dex"

# ── 1/5 recursos ─────────────────────────────────────────────────────────────
step "1/5 recursos (aapt2)"
"$BT/aapt2" compile --dir "$RES" -o "$OUT/compiled/res.zip" || die "aapt2 compile falló"
"$BT/aapt2" link \
  -o "$OUT/base.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$PROJECT/fast/AndroidManifest.xml" \
  --java "$OUT/gen" \
  --min-sdk-version 26 --target-sdk-version 34 \
  --version-code 1 --version-name 1.1.0-lite \
  "$OUT/compiled/res.zip" || die "aapt2 link falló"

# ── 2/5 kotlin ───────────────────────────────────────────────────────────────
step "2/5 kotlin (compilador embebido, sin daemon)"
"$JAVA" -Xmx1200m -XX:+UseSerialGC -cp "$KCP" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler \
  -no-stdlib -nowarn -jvm-target 17 \
  -classpath "$ANDROID_JAR:$KSTD:$KANN" \
  -d "$OUT/classes" \
  "$PROJECT"/fast/lite/*.kt \
  "$OUT/gen" 2>&1 | grep -vE "jansi|Failed to load native|WARNING: linker" || true
[ -n "$(find "$OUT/classes" -name '*.class' -print -quit)" ] || die "kotlinc no generó clases"

# ── 3/5 dex ──────────────────────────────────────────────────────────────────
step "3/5 dex (d8)"
find "$OUT/classes" -name "*.class" > "$OUT/classlist.txt"
export PATH="$(dirname "$JAVA"):$PATH"
"$BT/d8" --lib "$ANDROID_JAR" --min-api 26 --output "$OUT/dex" @"$OUT/classlist.txt" 2>/dev/null \
  || die "d8 falló"

# ── 4/5 empaquetado ──────────────────────────────────────────────────────────
step "4/5 empaquetado y alineado"
cp "$OUT/base.apk" "$OUT/unsigned.apk"
( cd "$OUT/dex" && zip -q -j "$OUT/unsigned.apk" classes*.dex ) || die "zip falló"
"$BT/zipalign" -p -f 4 "$OUT/unsigned.apk" "$OUT/aligned.apk" || die "zipalign falló"

# ── 5/5 firma ────────────────────────────────────────────────────────────────
step "5/5 firma"
if [ ! -f "$KS" ]; then
  # En CI no hay keystore: se genera uno de debug (no es un secreto, no sirve para Play)
  keytool -genkeypair -v -keystore "$KS" -storepass android -keypass android \
    -alias debug -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=FABRI-CORE Debug,O=Fabrick,C=CL" >/dev/null 2>&1 \
    || die "no pude crear el keystore de debug"
fi
"$BT/apksigner" sign \
  --ks "$KS" --ks-pass pass:android --ks-key-alias debug --key-pass pass:android \
  --out "$OUT/fabri-core-lite.apk" "$OUT/aligned.apk" 2>/dev/null || die "apksigner falló"
[ "${VERIFY:-0}" = "1" ] && "$BT/apksigner" verify --verbose "$OUT/fabri-core-lite.apk" | head -4

mkdir -p "$PROJECT/out"
cp "$OUT/fabri-core-lite.apk" "$PROJECT/out/fabri-core-lite.apk"
say "APK lista: $PROJECT/out/fabri-core-lite.apk ($(du -h "$PROJECT/out/fabri-core-lite.apk" | cut -f1)) · total $(( $(date +%s) - T0 ))s"
