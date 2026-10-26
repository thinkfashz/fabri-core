#!/usr/bin/env python3
"""Servidor HTTP local para las pruebas de seguridad de Fase 3.

Sirve un directorio por loopback y limita la velocidad para que la cancelación
y el progreso sean observables. Sólo para pruebas: no se usa en producción.
"""
import os
import sys
import time
from http.server import HTTPServer, SimpleHTTPRequestHandler


class Lento(SimpleHTTPRequestHandler):
    retardo = 0.004  # segundos por bloque de 64 KiB

    def log_message(self, formato, *args):
        pass

    def copyfile(self, origen, destino):
        buf = 64 * 1024
        try:
            while True:
                datos = origen.read(buf)
                if not datos:
                    break
                destino.write(datos)
                destino.flush()
                time.sleep(Lento.retardo)
        except (BrokenPipeError, ConnectionResetError):
            # El cliente canceló: es exactamente lo que prueba T10.
            pass


def main():
    directorio = sys.argv[1]
    puerto = int(sys.argv[2])
    if len(sys.argv) > 3:
        Lento.retardo = float(sys.argv[3])
    os.chdir(directorio)
    servidor = HTTPServer(("127.0.0.1", puerto), Lento)
    servidor.serve_forever()


if __name__ == "__main__":
    main()
