#!/usr/bin/env bash
# Build de FABRI-CORE en el teléfono.
export ANDROID_SDK_ROOT=/root/android-sdk
export ANDROID_HOME=$ANDROID_SDK_ROOT
export JAVA_HOME=/data/data/com.termux/files/usr/lib/jvm/java-21-openjdk
export PATH=$JAVA_HOME/bin:/data/data/com.termux/files/usr/bin:/usr/bin:/bin
export GRADLE_USER_HOME=/root/.gradle
export GRADLE_OPTS="-Xmx1024m -XX:MaxMetaspaceSize=512m -Dfile.encoding=UTF-8"
cd /root/fabri-core
/opt/gradle-8.9/bin/gradle --no-daemon --max-workers=1 --console=plain "$@"
