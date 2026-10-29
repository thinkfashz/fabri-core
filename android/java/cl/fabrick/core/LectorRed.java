package cl.fabrick.core;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.util.ArrayList;
import java.util.List;

/**
 * FORGE CORE STOCK · lector de códigos por red.
 *
 * <p>Los lectores 2D de escritorio (HBAPO y similares) no tienen un protocolo
 * único: algunos se conectan al host y le mandan la lectura por TCP, otros
 * escuchan y hay que consultarlos, y los más simples se comportan como teclado
 * (HID). Este lector cubre los dos caminos de red y deja el HID a la interfaz.
 *
 * <p>Modo servidor: la app abre un puerto (9101 por defecto) y el lector se
 * configura para apuntar a la IP del teléfono. Es el modo recomendado porque
 * funciona con cualquier lector que permita elegir "servidor TCP".
 *
 * <p>Modo cliente: la app se conecta a la IP:puerto del lector y lee lo que
 * mande. Sirve para los modelos que abren ellos el puerto.
 *
 * <p>El corte de trama no se adivina: se acepta CR, LF, CRLF o TAB, y si el
 * lector no manda terminador se cierra la lectura tras 180 ms de silencio.
 */
final class LectorRed {

    interface Oyente {
        void linea(String codigo, String origen, String ip, int puerto, int bytes, String hex);
    }

    private static final int MAX_BUFFER = 8192;
    private static final int SILENCIO_MS = 180;

    private static ServerSocket servidor;
    private static Thread hiloServidor;
    private static volatile int puertoServidor = 0;
    private static final List<Socket> clientesServidor = new ArrayList<Socket>();

    private static Socket cliente;
    private static Thread hiloCliente;
    private static volatile boolean clienteActivo = false;
    private static volatile String hostCliente = "";
    private static volatile int puertoCliente = 0;

    private static volatile long ultimaLinea = 0L;
    private static volatile int totalLineas = 0;
    private static volatile String ultimoCodigo = "";
    private static volatile String ultimoOrigen = "";
    private static volatile String ultimoHex = "";

    private LectorRed() {
    }

    /** Abre el puerto de escucha. Devuelve JSON con la IP que hay que configurar. */
    static synchronized JSONObject iniciarServidor(int puerto, Oyente oyente) {
        JSONObject r = new JSONObject();
        try {
            detenerServidor();
            int p = puerto <= 0 ? 9101 : puerto;
            if (p < 1 || p > 65535) {
                throw new IllegalArgumentException("puerto fuera de rango");
            }
            final ServerSocket ss = new ServerSocket();
            ss.setReuseAddress(true);
            ss.bind(new InetSocketAddress(p));
            servidor = ss;
            puertoServidor = p;
            final Oyente o = oyente;

            hiloServidor = new Thread(new Runnable() {
                @Override
                public void run() {
                    while (!ss.isClosed()) {
                        Socket s = null;
                        try {
                            s = ss.accept();
                            s.setTcpNoDelay(true);
                            s.setSoTimeout(SILENCIO_MS);
                            synchronized (clientesServidor) {
                                clientesServidor.add(s);
                            }
                            String ipCliente = s.getInetAddress() == null
                                    ? "" : s.getInetAddress().getHostAddress();
                            lanzarLector(s, "servidor", ipCliente, p, o);
                        } catch (Throwable t) {
                            if (!ss.isClosed()) {
                                Bitacora.anotar("lector", "accept falló: " + t);
                            }
                            cerrar(s);
                        }
                    }
                }
            }, "lector-servidor");
            hiloServidor.setDaemon(true);
            hiloServidor.start();

            String ip = Red.ipLocal();
            r.put("ok", true);
            r.put("modo", "servidor");
            r.put("puerto", p);
            r.put("ip_local", ip);
            r.put("instruccion", ip.isEmpty()
                    ? "Conectá el WiFi y volvé a encender el lector."
                    : "En el lector, configurá servidor TCP " + ip + ":" + p);
            Bitacora.anotar("lector", "servidor escuchando en " + p + " · IP " + ip);
        } catch (Throwable t) {
            try {
                r.put("ok", false);
                r.put("error", mensaje(t));
                r.put("codigo", t instanceof IOException ? "PUERTO" : "ERROR");
            } catch (Throwable ignorado) {
                // sin más.
            }
        }
        return r;
    }

    /** Se conecta al lector y se queda leyendo. Reconecta si se cae. */
    static synchronized JSONObject conectar(String host, int puerto, Oyente oyente) {
        JSONObject r = new JSONObject();
        try {
            desconectar();
            if (host == null || host.trim().isEmpty()) {
                throw new IllegalArgumentException("falta la IP del lector");
            }
            int p = puerto <= 0 ? 9101 : puerto;
            if (p < 1 || p > 65535) {
                throw new IllegalArgumentException("puerto fuera de rango");
            }
            hostCliente = host.trim();
            puertoCliente = p;
            clienteActivo = true;
            final Oyente o = oyente;
            final String h = hostCliente;
            final int pp = puertoCliente;

            hiloCliente = new Thread(new Runnable() {
                @Override
                public void run() {
                    while (clienteActivo) {
                        Socket s = null;
                        try {
                            s = new Socket();
                            s.setTcpNoDelay(true);
                            s.connect(new InetSocketAddress(h, pp), 4000);
                            s.setSoTimeout(SILENCIO_MS);
                            synchronized (LectorRed.class) {
                                cliente = s;
                            }
                            leer(s, "cliente", h, pp, o);
                        } catch (Throwable t) {
                            if (clienteActivo) {
                                Bitacora.anotar("lector", "conexión con " + h + ":" + pp
                                        + " se cayó: " + mensaje(t));
                            }
                        } finally {
                            cerrar(s);
                        }
                        if (clienteActivo) {
                            dormir(2500);
                        }
                    }
                }
            }, "lector-cliente");
            hiloCliente.setDaemon(true);
            hiloCliente.start();

            r.put("ok", true);
            r.put("modo", "cliente");
            r.put("host", hostCliente);
            r.put("puerto", puertoCliente);
            Bitacora.anotar("lector", "cliente hacia " + hostCliente + ":" + puertoCliente);
        } catch (Throwable t) {
            try {
                r.put("ok", false);
                r.put("error", mensaje(t));
            } catch (Throwable ignorado) {
                // sin más.
            }
        }
        return r;
    }

    static synchronized JSONObject detenerServidor() {
        JSONObject r = new JSONObject();
        try {
            if (servidor != null) {
                cerrar(servidor);
                servidor = null;
            }
            synchronized (clientesServidor) {
                for (Socket s : clientesServidor) {
                    cerrar(s);
                }
                clientesServidor.clear();
            }
            puertoServidor = 0;
            r.put("ok", true);
            r.put("estado", "servidor apagado");
        } catch (Throwable t) {
            try {
                r.put("ok", false);
                r.put("error", mensaje(t));
            } catch (Throwable ignorado) {
                // sin más.
            }
        }
        return r;
    }

    static synchronized JSONObject desconectar() {
        JSONObject r = new JSONObject();
        try {
            clienteActivo = false;
            if (cliente != null) {
                cerrar(cliente);
                cliente = null;
            }
            r.put("ok", true);
            r.put("estado", "cliente apagado");
        } catch (Throwable t) {
            try {
                r.put("ok", false);
                r.put("error", mensaje(t));
            } catch (Throwable ignorado) {
                // sin más.
            }
        }
        return r;
    }

    static JSONObject estado() {
        JSONObject r = new JSONObject();
        try {
            r.put("ok", true);
            r.put("servidor_activo", servidor != null && !servidor.isClosed());
            r.put("servidor_puerto", puertoServidor);
            r.put("cliente_activo", clienteActivo);
            r.put("cliente_host", hostCliente);
            r.put("cliente_puerto", puertoCliente);
            r.put("ip_local", Red.ipLocal());
            r.put("lineas", totalLineas);
            r.put("ultimo_codigo", ultimoCodigo);
            r.put("ultimo_origen", ultimoOrigen);
            r.put("ultimo_hex", ultimoHex);
            r.put("ultima_linea", ultimaLinea);
        } catch (Throwable t) {
            try {
                r.put("ok", false);
                r.put("error", mensaje(t));
            } catch (Throwable ignorado) {
                // sin más.
            }
        }
        return r;
    }

    /** Un hilo por conexión; lee hasta que el lector o la red cierren. */
    private static void lanzarLector(final Socket s, final String origen,
                                     final String ip, final int puerto,
                                     final Oyente oyente) {
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    leer(s, origen, ip, puerto, oyente);
                } finally {
                    cerrar(s);
                    synchronized (clientesServidor) {
                        clientesServidor.remove(s);
                    }
                }
            }
        }, "lector-linea");
        t.setDaemon(true);
        t.start();
    }

    /**
     * Bucle de lectura. Acumula bytes y emite una línea al ver CR/LF/TAB o al
     * detectar 180 ms de silencio (lectores que no mandan terminador).
     */
    private static void leer(Socket s, String origen, String ip, int puerto,
                             Oyente oyente) {
        byte[] buffer = new byte[1024];
        StringBuilder acumulado = new StringBuilder();
        String hex = "";
        long ultimoByte = 0L;

        while (s != null && !s.isClosed()) {
            int leidos;
            try {
                leidos = s.getInputStream().read(buffer);
            } catch (SocketTimeoutException e) {
                if (acumulado.length() > 0
                        && System.currentTimeMillis() - ultimoByte >= SILENCIO_MS) {
                    emitir(acumulado.toString(), origen, ip, puerto, hex, oyente);
                    acumulado.setLength(0);
                    hex = "";
                }
                continue;
            } catch (Throwable t) {
                break;
            }
            if (leidos < 0) {
                break;
            }
            if (leidos == 0) {
                continue;
            }
            ultimoByte = System.currentTimeMillis();
            for (int i = 0; i < leidos; i++) {
                int b = buffer[i] & 0xFF;
                if (b == '\r' || b == '\n' || b == '\t') {
                    if (acumulado.length() > 0) {
                        emitir(acumulado.toString(), origen, ip, puerto, hex, oyente);
                        acumulado.setLength(0);
                        hex = "";
                    }
                    continue;
                }
                // Sólo texto imprimible. Los bytes de control de algunos
                // lectores (prefijos/sufijos) se ignoran en el código pero
                // quedan en el hex para diagnosticar.
                if (b >= 0x20 && b != 0x7F) {
                    if (acumulado.length() < MAX_BUFFER) {
                        acumulado.append((char) b);
                    }
                }
                if (hex.length() < 160) {
                    hex = hex + String.format("%02X", b);
                }
            }
        }

        if (acumulado.length() > 0) {
            emitir(acumulado.toString(), origen, ip, puerto, hex, oyente);
        }
    }

    private static void emitir(String crudo, String origen, String ip, int puerto,
                               String hex, Oyente oyente) {
        String codigo = normalizar(crudo);
        if (codigo.isEmpty() || codigo.length() > 256) {
            return;
        }
        // Descarta ecos de configuración que no son códigos.
        if (codigo.length() < 3) {
            return;
        }
        totalLineas++;
        ultimaLinea = System.currentTimeMillis();
        ultimoCodigo = codigo;
        ultimoOrigen = origen;
        ultimoHex = hex;
        try {
            if (oyente != null) {
                oyente.linea(codigo, origen, ip, puerto, codigo.length(), hex);
            }
        } catch (Throwable t) {
            Bitacora.anotar("lector", "no se pudo avisar la línea: " + mensaje(t));
        }
    }

    private static String normalizar(String s) {
        if (s == null) {
            return "";
        }
        StringBuilder out = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c >= 0x20 && c != 0x7F) {
                out.append(c);
            }
        }
        return out.toString().trim();
    }

    private static void dormir(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static void cerrar(java.io.Closeable c) {
        if (c == null) {
            return;
        }
        try {
            c.close();
        } catch (Throwable ignorado) {
            // sin más.
        }
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
}
