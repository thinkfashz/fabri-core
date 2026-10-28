package cl.fabrick.core;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.util.Enumeration;

/**
 * FABRI-CORE · diagnóstico de red y forzado de IPv4.
 *
 * En esta red el IPv6 es un agujero negro: resuelve, pero no conecta. Java
 * intenta las direcciones AAAA primero y se queda esperando hasta el timeout.
 * Eso explica que una descarga de Hugging Face "no avance" y que un proveedor
 * LLM tarde minutos o no responda.
 *
 * `forzarIPv4()` se llama al arrancar la actividad, antes de cualquier socket.
 */
final class Red {

    private static final String[] HOSTS = {
            "huggingface.co",
            "cdn-lfs.hf.co",
            "api.openai.com",
            "github.com"
    };

    private Red() {
    }

    /** Debe ejecutarse antes de abrir el primer socket del proceso. */
    static void forzarIPv4() {
        try {
            System.setProperty("java.net.preferIPv4Stack", "true");
            System.setProperty("java.net.preferIPv6Addresses", "false");
        } catch (Throwable ignorado) {
            // Si la VM no lo acepta, el diagnóstico lo reportará igual.
        }
    }

    static boolean ipv4Forzado() {
        try {
            return Boolean.parseBoolean(System.getProperty("java.net.preferIPv4Stack", "false"));
        } catch (Throwable t) {
            return false;
        }
    }

    /**
     * IPv4 privada de este teléfono en la WiFi/LAN. La usan la impresora y el
     * lector para decirle al usuario a qué IP apuntar. Se prefiere wlan0 y se
     * descartan las interfaces de datos móviles y las virtuales.
     */
    static String ipLocal() {
        String respaldo = "";
        try {
            Enumeration<NetworkInterface> redes = NetworkInterface.getNetworkInterfaces();
            while (redes != null && redes.hasMoreElements()) {
                NetworkInterface red = redes.nextElement();
                try {
                    if (!red.isUp() || red.isLoopback()) {
                        continue;
                    }
                    String nombre = red.getName() == null ? "" : red.getName().toLowerCase();
                    if (nombre.startsWith("rmnet") || nombre.startsWith("dummy")
                            || nombre.startsWith("tun") || nombre.startsWith("ppp")) {
                        continue;
                    }
                    Enumeration<InetAddress> direcciones = red.getInetAddresses();
                    while (direcciones.hasMoreElements()) {
                        InetAddress a = direcciones.nextElement();
                        if (a instanceof Inet4Address && !a.isLoopbackAddress()
                                && a.isSiteLocalAddress()) {
                            String ip = a.getHostAddress();
                            if (ip == null || ip.isEmpty()) {
                                continue;
                            }
                            if (nombre.startsWith("wlan") || nombre.startsWith("ap")) {
                                return ip;
                            }
                            if (respaldo.isEmpty()) {
                                respaldo = ip;
                            }
                        }
                    }
                } catch (Throwable ignorado) {
                    // una interfaz rara no invalida las demás.
                }
            }
        } catch (Throwable ignorado) {
            // sin red disponible.
        }
        return respaldo;
    }

    /** Diagnóstico completo en segundo plano; el resultado llega a FabriRed.recibir. */
    static String diagnostico(final NativeBridge.Notificador notificador) {
        Thread hilo = new Thread(new Runnable() {
            @Override
            public void run() {
                JSONObject salida = new JSONObject();
                long t0 = System.currentTimeMillis();
                try {
                    JSONArray hosts = new JSONArray();
                    boolean ipv6Roto = false;
                    boolean ipv4Ok = false;

                    for (String host : HOSTS) {
                        JSONObject h = new JSONObject();
                        h.put("host", host);
                        JSONArray v4 = new JSONArray();
                        JSONArray v6 = new JSONArray();
                        try {
                            InetAddress[] todas = InetAddress.getAllByName(host);
                            for (InetAddress a : todas) {
                                if (a instanceof Inet4Address) {
                                    v4.put(a.getHostAddress());
                                } else if (a instanceof Inet6Address) {
                                    v6.put(a.getHostAddress());
                                }
                            }
                        } catch (Throwable e) {
                            h.put("dns", TermuxPuente.tipo(e));
                        }
                        h.put("ipv4", v4);
                        h.put("ipv6", v6);

                        // Prueba real de conexión TCP/443 por familia.
                        boolean ok4 = probar(v4, 443);
                        boolean ok6 = probar(v6, 443);
                        h.put("tcp443_ipv4", ok4);
                        h.put("tcp443_ipv6", ok6);
                        if (ok4) {
                            ipv4Ok = true;
                        }
                        if (v6.length() > 0 && !ok6) {
                            ipv6Roto = true;
                        }
                        hosts.put(h);
                    }

                    salida.put("hosts", hosts);
                    salida.put("ipv4Forzado", ipv4Forzado());
                    salida.put("ipv4Funciona", ipv4Ok);
                    salida.put("ipv6Roto", ipv6Roto);
                    if (ipv6Roto && ipv4Ok) {
                        salida.put("veredicto",
                                "IPv6 roto en esta red: resuelve pero no conecta. La app ya fuerza IPv4 "
                                        + "(java.net.preferIPv4Stack=true). Si una descarga falla, revisa "
                                        + "primero el tamaño/hash del manifiesto y luego la URL.");
                    } else if (!ipv4Ok) {
                        salida.put("veredicto",
                                "Sin salida IPv4 a los hosts de prueba: el problema es la red o el DNS, "
                                        + "no el manifiesto ni el modelo.");
                    } else {
                        salida.put("veredicto", "Red IPv4 operativa hacia los hosts de prueba.");
                    }
                    salida.put("ok", true);
                } catch (Throwable t) {
                    try {
                        salida.put("ok", false);
                        salida.put("error", TermuxPuente.tipo(t));
                    } catch (Throwable ignorado) {
                        // sin más.
                    }
                }
                try {
                    salida.put("ms", System.currentTimeMillis() - t0);
                } catch (Throwable ignorado) {
                    // sin más.
                }
                if (notificador != null) {
                    notificador.js("window.FabriRed && FabriRed.recibir(" + salida.toString() + ");");
                }
            }
        }, "red-diagnostico");
        hilo.setDaemon(true);
        hilo.start();
        return "{\"ok\":true,\"estado\":\"DIAGNOSTICANDO\"}";
    }

    private static boolean probar(JSONArray direcciones, int puerto) {
        for (int i = 0; i < direcciones.length(); i++) {
            Socket s = new Socket();
            try {
                String ip = direcciones.optString(i, "");
                if (ip.isEmpty()) {
                    continue;
                }
                s.connect(new InetSocketAddress(InetAddress.getByName(ip), puerto), 2500);
                return true;
            } catch (Throwable ignorado) {
                // se prueba la siguiente dirección de la misma familia.
            } finally {
                try {
                    s.close();
                } catch (Throwable ignorado) {
                    // sin más.
                }
            }
        }
        return false;
    }
}
