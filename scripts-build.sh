#!/usr/bin/env bash
# Build de FABRI-CORE en el teléfono.
#   scripts-build.sh assembleDebug        → un intento
#   scripts-build.sh --loop              → reintenta hasta que exista la APK
#                (el contenedor se reinicia a menudo y se lleva el daemon)
export ANDROID_SDK_ROOT=/root/android-sdk
export ANDROID_HOME=$ANDROID_SDK_ROOT
export JAVA_HOME=/data/data/com.termux/files/usr/lib/jvm/java-21-openjdk
export PATH=$JAVA_HOME/bin:/data/data/com.termux/files/usr/bin:/usr/bin:/bin
export GRADLE_USER_HOME=/root/.gradle
export GRADLE_OPTS="-Xmx900m -XX:MaxMetaspaceSize=384m -Dfile.encoding=UTF-8"
cd /root/fabri-core

APK=app/build/outputs/apk/debug/app-debug.apk
LOOP=0
[ "${1:-}" = "--loop" ] && { LOOP=1; shift; }
TASK="${1:-assembleDebug}"

OFFLINE=""
if [ "${FABRI_OFFLINE:-1}" = "1" ] && [ -d /root/.gradle/caches/modules-2 ]; then OFFLINE="--offline"; fi

for intento in $(seq 1 12); do
  echo "=== build $TASK · intento $intento · $(date -u +%H:%M:%S) ==="
  /opt/gradle-8.9/bin/gradle --no-daemon --max-workers=1 --console=plain $OFFLINE "$TASK"
  if [ -f "$APK" ]; then
    echo "=== APK lista: $APK ($(stat -c%s "$APK") bytes) ==="
    exit 0
  fi
  [ "$LOOP" = "1" ] || break
  sleep 10
done
echo "=== build NO completado ==="
exit 1
