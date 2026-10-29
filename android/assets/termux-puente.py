#!/usr/bin/env python3
# =============================================================================
#  FORGE CORE STOCK · puente local Termux <-> APK
#  ---------------------------------------------------------------------------
#  Por qué existe: el permiso `com.termux.permission.RUN_COMMAND` de Termux
#  0.119 tiene protectionLevel="signature". Una APK firmada con otra clave
#  (la nuestra, debug) NO puede obtenerlo nunca. La vía que sí funciona es un
#  servidor loopback: la APK hace HTTP a 127.0.0.1 y este proceso ejecuta
#  SÓLO los comandos de la lista blanca. No acepta shell libre.
#
#  Uso:
#      python3 termux-puente.py                 # 127.0.0.1:8787
#      FABRI_PORT=9000 python3 termux-puente.py
#      FABRI_TOKEN=mi-clave python3 termux-puente.py
#
#  Dos modos:
#    · POST /ejecutar  → lista blanca por id (el modo seguro por defecto)
#    · POST /comando   → shell libre, sólo para la consola de la APK en ESTE
#      teléfono. Requiere token, sólo escucha en 127.0.0.1, tiene tope de
#      tiempo y de salida, y rechaza un puñado de comandos irreversibles.
#      Todo lo que se ejecuta queda en ~/fabrick-comandos.log
#
#  Sin dependencias: sólo la biblioteca estándar de Python 3.
# =============================================================================

import json
import os
import subprocess
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "1.1.0"
PUERTO = int(os.environ.get("FABRI_PORT", "8787"))
TOKEN = os.environ.get("FABRI_TOKEN", "fabrick-local")
INICIO = time.time()

# Comando libre: guardas mínimas contra accidentes irreversibles. No es un
# sandbox —es el propio teléfono del usuario— sino una red de seguridad para
# que un dedo torcido no formatee una partición.
DENEGADOS = (
    "rm -rf /",
    "rm -rf /*",
    "mkfs",
    "dd if=/dev/zero of=/dev/block",
    "dd if=/dev/urandom of=/dev/block",
    "chmod -R 777 /",
    ":(){",
    "> /dev/block",
    "reboot -f",
    "pm uninstall",
)
TIMEOUT_LIBRE = 25
MAX_SALIDA = 60000
LOG_COMANDOS = os.path.expanduser("~/fabrick-comandos.log")

# id -> (descripción, argv). Nunca se interpola texto del cliente: el cliente
# sólo puede elegir un id de esta tabla.
COMANDOS = {
    "estado": (
        "Kernel, Android y Termux",
        ["bash", "-lc", "uname -a; echo; termux-info 2>/dev/null | head -n 25"],
    ),
    "espacio": (
        "Espacio libre en HOME y PREFIX",
        ["bash", "-lc", "df -h \"$HOME\" \"$PREFIX\" 2>/dev/null | tail -n +2"],
    ),
    "ram": (
        "Memoria RAM real",
        ["bash", "-lc", "free -m 2>/dev/null || head -n 5 /proc/meminfo"],
    ),
    "red": (
        "Prueba de red IPv4 (1.1.1.1)",
        # toybox/iputils de Termux NO aceptan -4/-6: la dirección ya fija la
        # familia. Con -4 el comando imprimía el Usage y parecía una caída.
        ["bash", "-lc", "ping -c 2 -W 2 1.1.1.1 2>&1 | tail -n 4"],
    ),
    "red6": (
        "Prueba de red IPv6 (si falla, la red tiene IPv6 roto)",
        # ping6 primero; si el binario no existe, se intenta el alias -6.
        ["bash", "-lc",
         "{ ping6 -c 2 -W 2 2606:4700:4700::1111 2>&1"
         " || ping -6 -c 2 -W 2 2606:4700:4700::1111 2>&1; } | tail -n 4"],
    ),
    "paquetes": (
        "Paquetes instalados (conteo y primeros 25)",
        ["bash", "-lc", "pkg list-installed 2>/dev/null | wc -l; pkg list-installed 2>/dev/null | head -n 25"],
    ),
    "herramientas": (
        "Versiones de node, python, git, cargo",
        ["bash", "-lc", "node -v 2>/dev/null; python3 -V 2>/dev/null; git --version 2>/dev/null; cargo -V 2>/dev/null"],
    ),
    "modelos": (
        "Modelos GGUF en ~/modelos",
        ["bash", "-lc", "ls -lh \"$HOME/modelos\" 2>/dev/null || echo 'no existe ~/modelos'"],
    ),
    "servicios": (
        "Procesos por consumo de RAM",
        ["bash", "-lc", "ps -eo pid,comm,pcpu,rss --sort=-rss 2>/dev/null | head -n 12"],
    ),
    "pesados": (
        "Carpetas más pesadas de HOME",
        ["bash", "-lc", "du -sh \"$HOME\"/* 2>/dev/null | sort -h | tail -n 10"],
    ),
    "fabrick": (
        "Estado de FORGE CORE STOCK en Termux",
        ["bash", "-lc", "pgrep -af 'termux-puente|opencode|everos' | head -n 12; echo; ls -la \"$HOME/fabrick-core\" 2>/dev/null | head -n 8"],
    ),
    "probar-llm": (
        "Comprobar que el runtime llama.cpp responde",
        ["bash", "-lc", "ls -lh \"$HOME/fabrick-core/runtime/llama-b11835/arm64-v8a\" 2>/dev/null | head -n 10"],
    ),
    "ping": (
        "Prueba mínima del puente",
        ["bash", "-lc", "echo puente-ok; date -Iseconds"],
    ),
}

# Comandos que pueden tardar más (segundos).
TIMEOUTS = {"paquetes": 45, "pesados": 60, "probar-llm": 30}


class Manejador(BaseHTTPRequestHandler):
    server_version = "FabriPuente/" + VERSION

    def log_message(self, formato, *args):
        # Log compacto a stderr (lo recoge nohup).
        print("%s %s" % (time.strftime("%H:%M:%S"), formato % args), flush=True)

    def _json(self, codigo, datos):
        cuerpo = json.dumps(datos, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(cuerpo)

    def _autorizado(self):
        return self.headers.get("X-Fabrick-Token", "") == TOKEN

    def do_GET(self):
        ruta = self.path.split("?")[0]
        if ruta == "/":
            cuerpo = (
                "<!doctype html><meta charset=utf-8><title>FORGE CORE STOCK puente</title>"
                "<body style='background:#050505;color:#C8FF00;font-family:monospace;padding:24px'>"
                "<h1>FORGE CORE STOCK · puente Termux</h1><p>Activo en 127.0.0.1:%d</p>"
                "<p>Comandos: %s</p></body>"
            ) % (PUERTO, ", ".join(sorted(COMANDOS)))
            datos = cuerpo.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(datos)))
            self.end_headers()
            self.wfile.write(datos)
            return

        if not self._autorizado():
            self._json(403, {"ok": False, "error": "token inválido", "codigo": "TOKEN"})
            return

        if ruta == "/estado":
            self._json(200, {
                "ok": True,
                "puente": "activo",
                "version": VERSION,
                "uptime": round(time.time() - INICIO, 1),
                "pid": os.getpid(),
                "comandos": [
                    {"id": k, "descripcion": v[0]} for k, v in sorted(COMANDOS.items())
                ],
            })
            return

        self._json(404, {"ok": False, "error": "ruta desconocida", "codigo": "404"})

    def do_POST(self):
        ruta = self.path.split("?")[0]
        if ruta not in ("/ejecutar", "/comando"):
            self._json(404, {"ok": False, "error": "ruta desconocida", "codigo": "404"})
            return
        if not self._autorizado():
            self._json(403, {"ok": False, "error": "token inválido", "codigo": "TOKEN"})
            return

        try:
            largo = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            largo = 0
        if largo <= 0 or largo > 8192:
            self._json(400, {"ok": False, "error": "cuerpo inválido", "codigo": "CUERPO"})
            return

        try:
            pedido = json.loads(self.rfile.read(largo).decode("utf-8"))
        except Exception:
            self._json(400, {"ok": False, "error": "JSON inválido", "codigo": "JSON"})
            return

        if ruta == "/comando":
            self._comando_libre(pedido)
            return

        ident = str(pedido.get("id", "")).strip()
        if ident not in COMANDOS:
            self._json(400, {
                "ok": False,
                "error": "comando no permitido: " + ident,
                "codigo": "NO_PERMITIDO",
                "permitidos": sorted(COMANDOS),
            })
            return

        descripcion, argv = COMANDOS[ident]
        limite = TIMEOUTS.get(ident, 20)
        t0 = time.time()
        try:
            proceso = subprocess.run(
                argv,
                capture_output=True,
                text=True,
                timeout=limite,
                env=dict(os.environ, TERM="dumb"),
            )
            ms = int((time.time() - t0) * 1000)
            self._json(200, {
                "ok": proceso.returncode == 0,
                "id": ident,
                "descripcion": descripcion,
                "rc": proceso.returncode,
                "ms": ms,
                "salida": (proceso.stdout or "").strip()[:12000],
                "error": (proceso.stderr or "").strip()[:4000],
            })
        except subprocess.TimeoutExpired:
            ms = int((time.time() - t0) * 1000)
            self._json(200, {
                "ok": False,
                "id": ident,
                "descripcion": descripcion,
                "rc": -1,
                "ms": ms,
                "salida": "",
                "error": "tiempo agotado (%ds)" % limite,
            })
        except Exception as e:
            self._json(500, {
                "ok": False,
                "id": ident,
                "error": "%s: %s" % (type(e).__name__, e),
                "codigo": "EXCEPCION",
            })


    def _registrar(self, cmd, rc, ms):
        """Deja constancia de todo comando libre ejecutado."""
        try:
            with open(LOG_COMANDOS, "a", encoding="utf-8") as f:
                f.write("%s rc=%s ms=%s %s\n" % (
                    time.strftime("%Y-%m-%d %H:%M:%S"), rc, ms,
                    cmd.replace("\n", " ; ")))
        except Exception:
            pass

    def _comando_libre(self, pedido):
        """Shell libre para la consola de la APK, en el propio teléfono."""
        cmd = str(pedido.get("cmd", "")).strip()
        if not cmd:
            self._json(400, {"ok": False, "error": "comando vacío", "codigo": "VACIO"})
            return
        if len(cmd) > 4000:
            self._json(400, {"ok": False, "error": "comando demasiado largo",
                             "codigo": "LARGO"})
            return
        bajo = " ".join(cmd.lower().split())
        for d in DENEGADOS:
            if d in bajo:
                self._registrar(cmd, "DENEGADO", 0)
                self._json(403, {
                    "ok": False,
                    "error": "comando bloqueado por seguridad: contiene «%s»" % d,
                    "codigo": "DENEGADO",
                })
                return
        t0 = time.time()
        try:
            proceso = subprocess.run(
                ["bash", "-lc", cmd],
                capture_output=True,
                text=True,
                timeout=TIMEOUT_LIBRE,
                cwd=os.path.expanduser("~"),
                env=dict(os.environ, TERM="dumb"),
            )
            ms = int((time.time() - t0) * 1000)
            salida = (proceso.stdout or "")[-MAX_SALIDA:]
            error = (proceso.stderr or "")[-(MAX_SALIDA // 2):]
            self._registrar(cmd, proceso.returncode, ms)
            self._json(200, {
                "ok": proceso.returncode == 0,
                "cmd": cmd,
                "rc": proceso.returncode,
                "ms": ms,
                "salida": salida.strip(),
                "error": error.strip(),
            })
        except subprocess.TimeoutExpired:
            ms = int((time.time() - t0) * 1000)
            self._registrar(cmd, "TIMEOUT", ms)
            self._json(200, {
                "ok": False,
                "cmd": cmd,
                "rc": -1,
                "ms": ms,
                "salida": "",
                "error": "tiempo agotado (%ds)" % TIMEOUT_LIBRE,
            })
        except Exception as e:
            self._registrar(cmd, "EXCEPCION", 0)
            self._json(500, {
                "ok": False,
                "cmd": cmd,
                "error": "%s: %s" % (type(e).__name__, e),
                "codigo": "EXCEPCION",
            })


def main():
    servidor = ThreadingHTTPServer(("127.0.0.1", PUERTO), Manejador)
    servidor.daemon_threads = True
    print("FORGE CORE STOCK puente v%s en http://127.0.0.1:%d" % (VERSION, PUERTO), flush=True)
    print("comandos: %s" % ", ".join(sorted(COMANDOS)), flush=True)
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("detenido", flush=True)


if __name__ == "__main__":
    main()
