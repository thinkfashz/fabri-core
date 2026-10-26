package cl.fabrick.core;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * Cola de mensajes de consola de la WebView.
 *
 * <p>Existe por una razón concreta: {@code onConsoleMessage} se ejecuta en el
 * hilo de interfaz y {@code NativeBridge.call()} es síncrono. Llamarlo desde
 * ahí significaba que un solo mensaje de consola podía congelar la pantalla
 * mientras el núcleo arrancaba. Aquí se encola (sin esperar) y un hilo de
 * fondo escribe en el núcleo.
 *
 * <p>La cola es acotada a propósito: si el núcleo no responde, se descartan
 * mensajes en vez de acumular memoria sin límite.
 */
final class ColaConsola {

    private static final ArrayBlockingQueue<String> COLA = new ArrayBlockingQueue<String>(64);
    private static volatile boolean hiloIniciado = false;

    private ColaConsola() {
    }

    static void encolar(final NativeBridge puente, String mensaje) {
        if (puente == null) return;
        if (!hiloIniciado) {
            synchronized (ColaConsola.class) {
                if (!hiloIniciado) {
                    hiloIniciado = true;
                    Thread hilo = new Thread(new Runnable() {
                        @Override
                        public void run() {
                            drenar(puente);
                        }
                    }, "consola-webview");
                    hilo.setDaemon(true);
                    hilo.start();
                }
            }
        }
        // offer(): nunca bloquea. Si la cola está llena, el mensaje se descarta
        // (ya quedó en la bitácora de arranque, que es lo que importa).
        COLA.offer(mensaje);
    }

    private static void drenar(NativeBridge puente) {
        while (true) {
            try {
                String msj = COLA.poll(60, TimeUnit.SECONDS);
                if (msj == null) continue;
                // La bitácora se escribe aquí, en el hilo de fondo: el hilo de
                // interfaz no toca el disco ni el puente.
                Bitacora.anotar("consola", msj);
                String limpio = msj.replace("\\", "\\\\")
                        .replace("\"", "\\\"")
                        .replace("\n", " ")
                        .replace("\r", " ");
                if (limpio.length() > 400) {
                    limpio = limpio.substring(0, 400) + "…";
                }
                puente.call("log.append",
                        "{\"nivel\":\"JS\",\"origen\":\"webview\",\"mensaje\":\"" + limpio + "\"}");
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            } catch (Throwable ignorado) {
                // Un mensaje que no se pudo guardar no puede detener la cola.
            }
        }
    }
}
