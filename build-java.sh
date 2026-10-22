#!/usr/bin/env bash
# FABRI-CORE · build en Java puro (sin Kotlin).
# aapt2 link → javac → d8 → zip/zipalign → apksigner, midiendo cada paso.
set -euo pipefail

PROJECT=$(cd "$(dirname "$0")" && pwd)
SRC=$PROJECT/fast/java/src
MAN=$PROJECT/fast/java/AndroidManifest.xml
OUT=$PROJECT/fast/java/out
BT=${BT:-}
if [ -z "$BT" ]; then
  # En este teléfono (ARM) los binarios del SDK son x86-64: se usan los de Termux.
  if [ "$(uname -m)" != "x86_64" ] && [ -x /data/data/com.termux/files/usr/bin/aapt2 ]; then
    BT=/data/data/com.termux/files/usr/bin
  else
    BT=/root/android-sdk/build-tools/34.0.0
  fi
fi
SDK=${ANDROID_SDK_ROOT:-/root/android-sdk}
ANDROID_JAR=$SDK/platforms/android-34/android.jar
[ -f "$ANDROID_JAR" ] || ANDROID_JAR=$(ls "$SDK"/platforms/*/android.jar 2>/dev/null | sort -V | tail -1)
KS=$PROJECT/fast/debug.keystore
APK=$OUT/fabri-core-java.apk
T0=$(date +%s)

# ── comprobación de dependencias locales (--check) ───────────────────────────
MISSING=0
dep() {
  local name=$1 path=$2 what=$3
  if [ -x "$path" ] || command -v "$path" >/dev/null 2>&1; then
    printf "  ✓ %-10s %s\n" "$name" "$(command -v "$path" 2>/dev/null || echo "$path")"
  else
    printf "  ✗ %-10s FALTA · %s\n" "$name" "$what"
    MISSING=1
  fi
}
check_deps() {
  echo "Dependencias del build Java"
  dep javac javac "pkg install openjdk-21"
  dep keytool keytool "pkg install openjdk-21"
  dep aapt2 "$BT/aapt2" "pkg install aapt2"
  dep d8 "$BT/d8" "pkg install d8"
  dep apksigner "$BT/apksigner" "pkg install apksigner"
  dep zipalign "$BT/zipalign" "pkg install aapt"
  dep zip zip "pkg install zip"
  if [ -f "$ANDROID_JAR" ]; then
    printf "  ✓ %-10s %s\n" "android.jar" "$ANDROID_JAR"
  else
    printf "  ✗ %-10s FALTA · platforms/android-34/android.jar del SDK\n" "android.jar"
    MISSING=1
  fi
  [ "$MISSING" = "0" ] && echo "Todo listo." || echo "Falta algo: ver fast/java/DEPS.md"
  return "$MISSING"
}
if [ "${1:-}" = "--check" ]; then check_deps; exit $?; fi
check_deps >/dev/null || { check_deps; exit 1; }

ms() { echo $(( ($(date +%s%N) - $1) / 1000000 )); }
step() { echo "· $*"; }

rm -rf "$OUT"; mkdir -p "$OUT/classes" "$OUT/dex"

step "1/5 recursos (aapt2 link)"
T=$(date +%s%N)
"$BT/aapt2" link -o "$OUT/base.apk" --manifest "$MAN" -I "$ANDROID_JAR" \
  --min-sdk-version 23 --target-sdk-version 34 \
  --version-code 2 --version-name 2.0-java >/dev/null
echo "  $(ms "$T") ms"

step "2/5 compilar Java (javac)"
T=$(date +%s%N)
find "$SRC" -name '*.java' > "$OUT/sources.txt"
javac -source 11 -target 11 -Xlint:-options -cp "$ANDROID_JAR" \
  -d "$OUT/classes" @"$OUT/sources.txt" 2>&1 | grep -v 'bootstrap class path' || true
[ -n "$(find "$OUT/classes" -name '*.class' -print -quit)" ] || { echo "javac no generó clases"; exit 1; }
echo "  $(ms "$T") ms · $(find "$OUT/classes" -name '*.class' | wc -l) clases"

step "3/5 dex (d8)"
T=$(date +%s%N)
find "$OUT/classes" -name '*.class' > "$OUT/classlist.txt"
"$BT/d8" --lib "$ANDROID_JAR" --min-api 23 --output "$OUT/dex" @"$OUT/classlist.txt" 2>/dev/null \
  || { echo "d8 falló"; exit 1; }
echo "  $(ms "$T") ms"

step "4/5 empaquetar y alinear"
T=$(date +%s%N)
cp "$OUT/base.apk" "$OUT/unsigned.apk"
( cd "$OUT/dex" && zip -q -j "$OUT/unsigned.apk" classes.dex )
"$BT/zipalign" -p -f 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
echo "  $(ms "$T") ms"

step "5/5 firmar (v2+v3)"
T=$(date +%s%N)
if [ ! -f "$KS" ]; then
  keytool -genkeypair -v -keystore "$KS" -storepass android -keypass android \
    -alias debug -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=FABRI-CORE Debug,O=Fabrick,C=CL" >/dev/null 2>&1
fi
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:android --ks-key-alias debug \
  --key-pass pass:android --out "$APK" "$OUT/aligned.apk" 2>/dev/null
"$BT/apksigner" verify --verbose "$APK" | head -3
echo "  $(ms "$T") ms"

mkdir -p "$PROJECT/out"
cp "$APK" "$PROJECT/out/fabri-core-java.apk"
TOTAL=$(( $(date +%s) - T0 ))
echo "APK: $PROJECT/out/fabri-core-java.apk · $(du -h "$PROJECT/out/fabri-core-java.apk" | cut -f1) · total ${TOTAL}s"
