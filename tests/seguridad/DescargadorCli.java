import cl.fabrick.core.Descargador;

/**
 * Arnés de prueba por línea de comandos del Descargador.
 * Usa exactamente la misma clase que se empaqueta en la APK.
 *
 * Uso:
 *   java DescargadorCli descargar <url> <destino> <bytes> <sha256> <autorizado 0|1> <reintentos> <cancelarMs>
 *   java DescargadorCli verificar <archivo> <bytes> <sha256>
 */
public class DescargadorCli {

    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            System.out.println("{\"ok\":false,\"motivo\":\"argumentos insuficientes\"}");
            System.exit(2);
        }

        if (args[0].equals("verificar")) {
            long tam = Long.parseLong(args[2]);
            Descargador.Resultado r = Descargador.verificar(new java.io.File(args[1]), tam, args[3]);
            System.out.println(r.toString());
            System.exit(r.ok ? 0 : 1);
        }

        String url = args[1];
        String destino = args[2];
        long tam = Long.parseLong(args[3]);
        String sha = args[4];
        boolean autorizado = args[5].equals("1");
        int reintentos = Integer.parseInt(args[6]);
        long cancelarMs = args.length > 7 ? Long.parseLong(args[7]) : -1;

        final Descargador.Control control = new Descargador.Control();

        if (cancelarMs > 0) {
            Thread hilo = new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Thread.sleep(cancelarMs);
                    } catch (InterruptedException e) {
                        return;
                    }
                    control.cancelar();
                }
            });
            hilo.setDaemon(true);
            hilo.start();
        }

        Descargador.Progreso progreso = new Descargador.Progreso() {
            private long ultimo = -1;

            @Override
            public void avance(long hechos, long total) {
                long pct = total > 0 ? (hechos * 100 / total) : -1;
                if (pct != ultimo) {
                    ultimo = pct;
                    System.err.println("progreso " + pct + "%");
                }
            }
        };

        Descargador.Resultado r = Descargador.descargar(url, destino, tam, sha, autorizado, reintentos, progreso, control);
        System.out.println(r.toString());
        System.exit(r.ok ? 0 : 1);
    }
}
