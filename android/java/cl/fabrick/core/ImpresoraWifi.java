package cl.fabrick.core;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/**
 * FABRI-CORE · impresora térmica por WiFi (ESC/POS sobre TCP).
 *
 * <p>La Xprinter XP-58LLH, como casi toda térmica con WiFi, escucha en el
 * puerto 9100 y acepta el flujo ESC/POS crudo. Eso es distinto del diálogo de
 * impresión de Android: aquí no hay controlador ni vista previa, la app manda
 * los bytes y la impresora los interpreta. Es el único camino para que el
 * ticket salga sin elegir impresora cada vez.
 *
 * <p>Seguridad: sólo se aceptan destinos de la red local (IPv4 privada,
 * loopback o nombre sin dominio). No se puede usar esto como escáner de
 * puertos hacia Internet.
 */
final class ImpresoraWifi {

    /** Tope de bytes por trabajo: un ticket de 58 mm no llega ni a 20 KB. */
    private static final int MAX_BYTES = 512 * 1024;

    /** Puerto estándar de impresión raw (JetDirect). */
    static final int PUERTO_ESTANDAR = 9100;

    private ImpresoraWifi() {
    }

    /**
     * Abre el socket, manda el trabajo y espera un instante la respuesta de
     * estado. Devuelve siempre JSON: nunca lanza hacia el puente.
     */
    static JSONObject enviar(String host, int puerto, byte[] datos, int timeoutMs) {
        JSONObject r = new JSONObject();
        long t0 = System.currentTimeMillis();
        Socket socket = null;
        try {
            validarDestino(host);
            if (datos == null || datos.length == 0) {
                throw new IllegalArgumentException("el ticket está vacío");
            }
            if (datos.length > MAX_BYTES) {
                throw new IllegalArgumentException("el ticket supera " + (MAX_BYTES / 1024) + " KB");
            }
            int puertoOk = validarPuerto(puerto);
            int tope = timeoutMs <= 0 ? 5000 : Math.min(Math.max(timeoutMs, 1000), 20000);

            socket = new Socket();
            socket.setTcpNoDelay(true);
            socket.connect(new InetSocketAddress(host.trim(), puertoOk), tope);
            socket.setSoTimeout(Math.min(tope, 4000));

            OutputStream salida = socket.getOutputStream();
            salida.write(datos);
            salida.flush();

            // Muchas térmicas no contestan nada. Se intenta leer el estado
            // sin bloquear el trabajo: si no hay respuesta, el ticket igual
            // se envió y se informa "sin respuesta de estado".
            byte[] estado = leerEstado(socket, 900);

            r.put("ok", true);
            r.put("bytes", datos.length);
            r.put("ms", System.currentTimeMillis() - t0);
            r.put("host", host.trim());
            r.put("puerto", puertoOk);
            if (estado.length > 0) {
                r.put("estado_hex", hex(estado));
            }
            Bitacora.anotar("impresora", "ticket WiFi enviado · " + datos.length
                    + " B · " + host.trim() + ":" + puertoOk);
        } catch (Throwable t) {
            try {
                r.put("ok", false);
                r.put("error", mensaje(t));
                r.put("codigo", codigo(t));
                r.put("ms", System.currentTimeMillis() - t0);
                if (host != null) {
                    r.put("host", host.trim());
                }
                r.put("puerto", puerto);
            } catch (Throwable ignorado) {
                // sin más.
            }
            Bitacora.anotar("impresora", "falló el envío WiFi: " + mensaje(t));
        } finally {
            cerrar(socket);
        }
        return r;
    }

    /**
     * Prueba de conexión real: conecta, manda DLE EOT 1 (estado de la
     * impresora) y lee lo que haya. Si el puerto abre pero no contesta, se
     * considera conectada: hay impresoras que no implementan el estado.
     */
    static JSONObject probar(String host, int puerto, int timeoutMs) {
        JSONObject r = new JSONObject();
        long t0 = System.currentTimeMillis();
        Socket socket = null;
        try {
            validarDestino(host);
            int puertoOk = validarPuerto(puerto);
            int tope = timeoutMs <= 0 ? 4000 : Math.min(Math.max(timeoutMs, 800), 15000);

            socket = new Socket();
            socket.setTcpNoDelay(true);
            socket.connect(new InetSocketAddress(host.trim(), puertoOk), tope);
            socket.setSoTimeout(1200);

            OutputStream salida = socket.getOutputStream();
            // DLE EOT 1: "estado de la impresora". Es de sólo lectura.
            salida.write(new byte[]{0x10, 0x04, 0x01});
            salida.flush();
            byte[] estado = leerEstado(socket, 1200);

            r.put("ok", true);
            r.put("conectada", true);
            r.put("responde_estado", estado.length > 0);
            if (estado.length > 0) {
                r.put("estado_hex", hex(estado));
                r.put("estado", interpretarEstado(estado));
            }
            r.put("ms", System.currentTimeMillis() - t0);
            r.put("host", host.trim());
            r.put("puerto", puertoOk);
            Bitacora.anotar("impresora", "prueba WiFi OK · " + host.trim() + ":" + puertoOk);
        } catch (Throwable t) {
            try {
                r.put("ok", false);
                r.put("error", mensaje(t));
                r.put("codigo", codigo(t));
                r.put("ms", System.currentTimeMillis() - t0);
            } catch (Throwable ignorado) {
                // sin más.
            }
        } finally {
            cerrar(socket);
        }
        return r;
    }

    /**
     * Busca impresoras en la misma /24. Es un connect() de 220 ms a 254
     * direcciones en el puerto 9100, con 48 hilos: no manda ni un byte, sólo
     * comprueba quién acepta la conexión. Se limita a la red local.
     */
    static JSONObject descubrir(int timeoutMs) {
        JSONObject r = new JSONObject();
        long t0 = System.currentTimeMillis();
        ExecutorService pool = null;
        try {
            String ip = Red.ipLocal();
            if (ip == null || ip.isEmpty()) {
                throw new IllegalStateException("no hay una IP local: revisa que el WiFi esté conectado");
            }
            String base = ip.substring(0, ip.lastIndexOf('.') + 1);
            int espera = timeoutMs <= 0 ? 220 : Math.min(Math.max(timeoutMs, 120), 600);

            final int puerto = PUERTO_ESTANDAR;
            final int tope = espera;
            List<Callable<String>> tareas = new ArrayList<Callable<String>>();
            for (int i = 1; i <= 254; i++) {
                final String candidata = base + i;
                if (candidata.equals(ip)) {
                    continue;
                }
                tareas.add(new Callable<String>() {
                    @Override
                    public String call() {
                        Socket s = new Socket();
                        try {
                            s.connect(new InetSocketAddress(candidata, puerto), tope);
                            return candidata;
                        } catch (Throwable ignorado) {
                            return null;
                        } finally {
                            cerrar(s);
                        }
                    }
                });
            }

            pool = Executors.newFixedThreadPool(48);
            List<Future<String>> resultados = pool.invokeAll(tareas, 12, TimeUnit.SECONDS);
            List<String> encontradas = new ArrayList<String>();
            for (Future<String> f : resultados) {
                try {
                    if (f.isDone() && !f.isCancelled()) {
                        String valor = f.get();
                        if (valor != null) {
                            encontradas.add(valor);
                        }
                    }
                } catch (Throwable ignorado) {
                    // una dirección que falla no invalida el barrido.
                }
            }
            Collections.sort(encontradas);

            JSONArray lista = new JSONArray();
            for (String e : encontradas) {
                JSONObject o = new JSONObject();
                o.put("host", e);
                o.put("puerto", puerto);
                lista.put(o);
            }
            r.put("ok", true);
            r.put("red", base + "0/24");
            r.put("ip_local", ip);
            r.put("puerto", puerto);
            r.put("encontradas", lista);
            r.put("total", encontradas.size());
            r.put("ms", System.currentTimeMillis() - t0);
            Bitacora.anotar("impresora", "barrido " + base + "0/24 · "
                    + encontradas.size() + " candidata(s) en 9100");
        } catch (Throwable t) {
            try {
                r.put("ok", false);
                r.put("error", mensaje(t));
                r.put("codigo", codigo(t));
                r.put("ms", System.currentTimeMillis() - t0);
            } catch (Throwable ignorado) {
                // sin más.
            }
        } finally {
            if (pool != null) {
                pool.shutdownNow();
            }
        }
        return r;
    }

    /** Lee hasta 32 bytes de estado; vacío si la impresora no contesta. */
    private static byte[] leerEstado(Socket socket, int esperaMs) {
        InputStream entrada = null;
        try {
            socket.setSoTimeout(esperaMs);
            entrada = socket.getInputStream();
            byte[] buffer = new byte[32];
            int leidos = entrada.read(buffer);
            if (leidos <= 0) {
                return new byte[0];
            }
            byte[] salida = new byte[leidos];
            System.arraycopy(buffer, 0, salida, 0, leidos);
            return salida;
        } catch (SocketTimeoutException e) {
            return new byte[0];
        } catch (Throwable t) {
            return new byte[0];
        }
    }

    /** Traduce el byte de estado de ESC/POS a algo legible. */
    private static String interpretarEstado(byte[] estado) {
        if (estado == null || estado.length == 0) {
            return "sin respuesta";
        }
        int b = estado[0] & 0xFF;
        StringBuilder s = new StringBuilder();
        // Bit 5: papel presente (0 = hay papel). Bit 2: cubierta cerrada.
        if ((b & 0x20) != 0) {
            s.append("sin papel");
        } else {
            s.append("con papel");
        }
        if ((b & 0x04) != 0) {
            s.append(" · cubierta abierta");
        }
        return s.toString();
    }

    /**
     * Sólo red local. Una IP pública o un dominio de Internet se rechazan:
     * el puente no debe servir para escanear puertos ajenos.
     */
    private static void validarDestino(String host) throws Exception {
        if (host == null || host.trim().isEmpty()) {
            throw new IllegalArgumentException("falta la IP de la impresora");
        }
        String h = host.trim();
        if (h.equalsIgnoreCase("localhost")) {
            return;
        }
        if (h.matches("\\d{1,3}(\\.\\d{1,3}){3}")) {
            InetAddress a = InetAddress.getByName(h);
            if (!(a instanceof Inet4Address)) {
                throw new IllegalArgumentException("la impresora debe tener IPv4");
            }
            if (!a.isSiteLocalAddress() && !a.isLoopbackAddress()) {
                throw new IllegalArgumentException("sólo se permite una IP de tu red local (192.168.x.x, 10.x.x.x, 172.16-31.x.x)");
            }
            return;
        }
        // Nombre mDNS (.local) o nombre simple de la LAN. Un dominio con
        // puntos podría resolver a Internet, así que se rechaza.
        if (h.toLowerCase().endsWith(".local") || h.indexOf('.') < 0) {
            return;
        }
        throw new IllegalArgumentException("usa la IP de la impresora o un nombre .local");
    }

    private static int validarPuerto(int puerto) {
        if (puerto < 1 || puerto > 65535) {
            throw new IllegalArgumentException("puerto fuera de rango");
        }
        return puerto;
    }

    private static String codigo(Throwable t) {
        if (t instanceof SocketTimeoutException) {
            return "TIEMPO";
        }
        String m = mensaje(t).toLowerCase();
        if (m.contains("refused") || m.contains("rechaz")) {
            return "RECHAZADA";
        }
        if (m.contains("unreachable") || m.contains("inalcanz")) {
            return "SIN_RUTA";
        }
        if (m.contains("network") || m.contains("red")) {
            return "SIN_RED";
        }
        if (t instanceof IllegalArgumentException) {
            return "DESTINO";
        }
        return "ERROR";
    }

    private static String mensaje(Throwable t) {
        if (t == null) {
            return "error desconocido";
        }
        String m = t.getMessage();
        if (m == null || m.trim().isEmpty()) {
            m = t.getClass().getSimpleName();
        }
        return m;
    }

    private static String hex(byte[] datos) {
        if (datos == null || datos.length == 0) {
            return "";
        }
        StringBuilder s = new StringBuilder(datos.length * 2);
        for (byte b : datos) {
            s.append(String.format("%02X", b & 0xFF));
        }
        return s.toString();
    }

    private static void cerrar(Socket s) {
        if (s == null) {
            return;
        }
        try {
            s.close();
        } catch (Throwable ignorado) {
            // sin más.
        }
    }
}
