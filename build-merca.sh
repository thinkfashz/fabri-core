#!/usr/bin/env bash
# MercaFabrick · build rápido sin Gradle (mismo pipeline que build-fast.sh).
#   bash build-merca.sh
set -uo pipefail
PROJECT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SRC=$PROJECT/fast/merca
OUT=$PROJECT/fast/merca/out
T0=$(date +%s)
step() { local d=$(( $(date +%s) - T0 )); printf '\033[1;33m[merca]\033[0m %-40s (+%ss)\n' "$1" "$d"; }
say()  { printf '\033[1;33m[merca]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[merca]\033[0m %s\n' "$*" >&2; exit 1; }

if [ -d /data/data/com.termux/files/usr ]; then
  PLAT=termux
  BT=/data/data/com.termux/files/usr/bin
  JAVA=/data/data/com.termux/files/usr/lib/jvm/java-21-openjdk/bin/java
  SDK=${ANDROID_SDK_ROOT:-}
  if [ -z "$SDK" ] || [ ! -d "$SDK/platforms" ]; then
    for c in /root/android-sdk /data/data/com.termux/files/home/android-sdk "$HOME/android-sdk"; do
      [ -d "$c/platforms" ] && SDK=$c && break
    done
  fi
  KS=$SDK/debug.keystore
  [ -f "$KS" ] || KS=/data/data/com.termux/files/home/android-sdk/debug.keystore
else
  PLAT=linux
  SDK=${ANDROID_SDK_ROOT:-${ANDROID_HOME:-/usr/lib/android-sdk}}
  BT=$(ls -d "$SDK"/build-tools/* 2>/dev/null | sort -V | tail -1)
  JAVA=$(command -v java || true)
  KS=$PROJECT/fast/debug.keystore
fi
[ -n "${JAVA:-}" ] || die "no encuentro java"
ANDROID_JAR=$SDK/platforms/android-34/android.jar
[ -f "$ANDROID_JAR" ] || ANDROID_JAR=$(ls "$SDK"/platforms/*/android.jar 2>/dev/null | sort -V | tail -1)
[ -f "$ANDROID_JAR" ] || die "no encuentro android.jar"
say "plataforma: $PLAT · $(basename "$ANDROID_JAR")"

KVER=2.0.21
M=https://repo1.maven.org/maven2
GC=/root/.gradle/caches/modules-2/files-2.1
LIB=$SRC/lib
mkdir -p "$LIB"
get_jar() {
  local hit
  hit=$(find "$GC/$1" -name "$2" 2>/dev/null | head -1)
  if [ -n "$hit" ]; then echo "$hit"; return; fi
  local dest=$LIB/$4
  if [ ! -s "$dest" ]; then curl -sSL --retry 3 -m 240 -o "$dest" "$3" || { rm -f "$dest"; return 1; }; fi
  echo "$dest"
}
KCOMP=$(get_jar org.jetbrains.kotlin/kotlin-compiler-embeddable 'kotlin-compiler-embeddable-*.jar' "$M/org/jetbrains/kotlin/kotlin-compiler-embeddable/$KVER/kotlin-compiler-embeddable-$KVER.jar" kotlin-compiler-embeddable.jar) || die "sin compilador Kotlin"
KSTD=$(get_jar org.jetbrains.kotlin/kotlin-stdlib 'kotlin-stdlib-2.0.21.jar' "$M/org/jetbrains/kotlin/kotlin-stdlib/$KVER/kotlin-stdlib-$KVER.jar" kotlin-stdlib.jar) || die "sin stdlib"
KREF=$(get_jar org.jetbrains.kotlin/kotlin-reflect 'kotlin-reflect-*.jar' "$M/org/jetbrains/kotlin/kotlin-reflect/1.9.23/kotlin-reflect-1.9.23.jar" kotlin-reflect.jar) || true
KSCRIPT=$(get_jar org.jetbrains.kotlin/kotlin-script-runtime '*.jar' "$M/org/jetbrains/kotlin/kotlin-script-runtime/$KVER/kotlin-script-runtime-$KVER.jar" kotlin-script-runtime.jar) || true
KDAEMON=$(get_jar org.jetbrains.kotlin/kotlin-daemon-embeddable '*.jar' "$M/org/jetbrains/kotlin/kotlin-daemon-embeddable/$KVER/kotlin-daemon-embeddable-$KVER.jar" kotlin-daemon-embeddable.jar) || true
KCOR=$(get_jar org.jetbrains.kotlinx/kotlinx-coroutines-core-jvm '*.jar' "$M/org/jetbrains/kotlinx/kotlinx-coroutines-core-jvm/1.8.1/kotlinx-coroutines-core-jvm-1.8.1.jar" kotlinx-coroutines-core-jvm.jar) || true
KTROVE=$(get_jar org.jetbrains.intellij.deps/trove4j '*.jar' "$M/org/jetbrains/intellij/deps/trove4j/1.0.20200330/trove4j-1.0.20200330.jar" trove4j.jar) || true
KANN=$(get_jar org.jetbrains/annotations 'annotations-*.jar' "$M/org/jetbrains/annotations/13.0/annotations-13.0.jar" annotations.jar) || true
KCP="$KCOMP:$KSTD:$KREF:$KSCRIPT:$KDAEMON:$KCOR:$KTROVE:$KANN"

rm -rf "$OUT"; mkdir -p "$OUT/compiled" "$OUT/gen" "$OUT/classes" "$OUT/dex"

step "1/5 recursos (aapt2)"
"$BT/aapt2" compile --dir "$SRC/res" -o "$OUT/compiled/res.zip" || die "aapt2 compile falló"
"$BT/aapt2" link -o "$OUT/base.apk" -I "$ANDROID_JAR" \
  --manifest "$SRC/AndroidManifest.xml" --java "$OUT/gen" \
  --min-sdk-version 26 --target-sdk-version 34 \
  --version-code 1 --version-name 1.0.0 \
  "$OUT/compiled/res.zip" || die "aapt2 link falló"

step "2/5 java + kotlin"
"$JAVA" -Xmx1200m -XX:+UseSerialGC -cp "$KCP" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler \
  -no-stdlib -nowarn -jvm-target 17 -classpath "$ANDROID_JAR:$KSTD" -d "$OUT/classes" \
  "$SRC"/java/cl/fabrick/merca/*.kt "$OUT/gen" 2>&1 | grep -vE "jansi|Failed to load native|WARNING: linker" || true
[ -n "$(find "$OUT/classes" -name '*.class' -print -quit)" ] || die "kotlinc no generó clases"
# Java opcional: sólo si hay fuentes .java (hoy todo es Kotlin).
mapfile -t FUENTES_JAVA < <(find "$SRC/java" -name '*.java' 2>/dev/null)
if [ "${#FUENTES_JAVA[@]}" -gt 0 ]; then
  "$BT/javac" -source 8 -target 8 -bootclasspath "$ANDROID_JAR" -d "$OUT/classes" \
    "${FUENTES_JAVA[@]}" 2>&1 | grep -v "bootstrap class path" || true
fi

step "3/5 dex (d8)"
find "$OUT/classes" -name "*.class" > "$OUT/classlist.txt"
export PATH="$(dirname "$JAVA"):$PATH"
"$BT/d8" --lib "$ANDROID_JAR" --min-api 26 --output "$OUT/dex" @"$OUT/classlist.txt" 2>/dev/null || die "d8 falló"

step "4/5 empaquetado"
cp "$OUT/base.apk" "$OUT/unsigned.apk"
( cd "$OUT/dex" && zip -q -j "$OUT/unsigned.apk" classes*.dex ) || die "zip falló"
# La interfaz va en assets/merca/www/ (así la lee ActivosMerca).
rm -rf "$OUT/assets"; mkdir -p "$OUT/assets/merca"
cp -r "$SRC/www" "$OUT/assets/merca/www"
# `zip` guarda las rutas relativas al directorio actual: hay que pararse en
# $OUT/assets y meter "merca" para que quede como assets/merca/www/... dentro
# del APK (si se pasa la ruta absoluta, guarda "merca/www/..." sin assets/).
# -j no sirve acá (aplana todo): se usa una ruta relativa con "assets/" para
# que dentro del APK quede assets/merca/www/... y ActivosMerca la encuentre.
( cd "$OUT" && zip -q -r unsigned.apk assets ) || die "no se pudo meter la interfaz"
# Verificación: si los assets no quedaron dentro, la APK abriría en blanco.
unzip -l "$OUT/unsigned.apk" | grep -q "assets/merca/www/index.html" \
  || { unzip -l "$OUT/unsigned.apk" | tail -5; die "los assets no quedaron en assets/merca/www/"; }
"$BT/zipalign" -p -f 4 "$OUT/unsigned.apk" "$OUT/aligned.apk" || die "zipalign falló"

step "5/5 firma"
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:android --ks-key-alias debug --key-pass pass:android \
  --out "$OUT/mercafabrick.apk" "$OUT/aligned.apk" 2>/dev/null || die "apksigner falló"
mkdir -p "$PROJECT/out"
cp "$OUT/mercafabrick.apk" "$PROJECT/out/MercaFabrick-1.0.0.apk"
say "APK: out/MercaFabrick-1.0.0.apk ($(du -h "$PROJECT/out/MercaFabrick-1.0.0.apk" | cut -f1)) · $(( $(date +%s) - T0 ))s"
