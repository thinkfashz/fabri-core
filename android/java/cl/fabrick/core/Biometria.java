package cl.fabrick.core;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.content.pm.PackageManager;
import android.hardware.fingerprint.FingerprintManager;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONObject;

import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * FORGE CORE STOCK · autenticación con huella del dispositivo.
 *
 * Diseño:
 *   · API 28+ usa `android.hardware.biometrics.BiometricPrompt`: el diálogo lo
 *     dibuja Android, no la app, así que la página HTML no puede suplantarlo.
 *   · API 24-27 usa `FingerprintManager` (deprecado) más un diálogo propio,
 *     porque en esas versiones el sistema no pone ninguno.
 *   · No usa AndroidX. El proyecto se compila con javac + d8 y no arrastra
 *     `androidx.biometric`; el paquete del framework alcanza.
 *   · No guarda nada ni compara huellas: sólo pregunta «¿es el dueño?» y avisa
 *     por `Callback`. Quien necesite criptografía atada a la huella (un testigo
 *     cifrado con el AndroidKeyStore) debe seguir usando `Huella`, que ya lo hace.
 *
 * Aislamiento por versión:
 *   Las clases que tocan APIs nuevas viven en clases anidadas (`Veintiocho`,
 *   `Veintinueve`). Cada una se compila a su propio archivo .class y sólo se
 *   carga cuando el SDK alcanza; un Android 7 que abre la app nunca resuelve
 *   `android.hardware.biometrics.BiometricPrompt`, que allí no existe.
 *
 * Hilos:
 *   Todo se abre en el hilo de UI. El resultado también llega en el hilo de UI,
 *   venga de `BiometricPrompt` (por el `Executor` de un solo hilo principal) o
 *   de `FingerprintManager` (por el `Handler` del looper principal).
 */
public final class Biometria {

    /** Resultado de un intento. `metodo` dice por qué carril llegó o falló. */
    public interface Callback {
        /**
         * @param ok     true sólo si la huella se verificó.
         * @param error  motivo legible cuando `ok` es false; null si hubo éxito.
         * @param metodo "biometric" | "fingerprint" | "cancelado" | "error".
         */
        void resultado(boolean ok, String error, String metodo);
    }

    // Carriles. La interfaz los usa para saber qué mostrar; no son códigos de error.
    private static final String METODO_BIOMETRIC = "biometric";
    private static final String METODO_FINGERPRINT = "fingerprint";
    private static final String METODO_CANCELADO = "cancelado";
    private static final String METODO_ERROR = "error";

    /**
     * Códigos del framework copiados como enteros a propósito. Algunos stubs de
     * `android.jar` no traen todas las constantes con nombre (ya pasó con
     * ERROR_NEGATIVE_BUTTON en `HuellaBiometrica`), y estos valores son
     * estables desde API 23. `BiometricPrompt` y `FingerprintManager` usan los
     * mismos números para los mismos casos, así que un solo mapeo sirve.
     */
    private static final int CODIGO_OK = 0;
    private static final int ERR_HW_UNAVAILABLE = 1;
    private static final int ERR_UNABLE_TO_PROCESS = 2;
    private static final int ERR_TIMEOUT = 3;
    private static final int ERR_NO_SPACE = 4;
    private static final int ERR_CANCELED = 5;
    private static final int ERR_LOCKOUT = 7;
    private static final int ERR_VENDOR = 8;
    private static final int ERR_LOCKOUT_PERMANENT = 9;
    private static final int ERR_USER_CANCELED = 10;
    private static final int ERR_NONE_ENROLLED = 11;
    private static final int ERR_NO_HARDWARE = 12;
    private static final int ERR_NEGATIVE_BUTTON = 13;
    private static final int ERR_NO_DEVICE_CREDENTIAL = 14;
    private static final int ERR_SECURITY_UPDATE = 15;

    private static final String PERMISO_HUELLA = "android.permission.USE_FINGERPRINT";
    private static final String PERMISO_BIOMETRICO = "android.permission.USE_BIOMETRIC";

    /** El intento en curso. Sólo hay uno: abrir otro cierra el anterior. */
    private static volatile Intento actual;

    private Biometria() {
    }

    // ------------------------------------------------------------------ estado

    /**
     * true sólo si hay sensor y al menos una huella enrolada. Un teléfono con
     * sensor pero sin huellas devuelve false: no hay nada que verificar.
     */
    public static boolean disponible(Context ctx) {
        if (ctx == null) {
            return false;
        }
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                // Desde Android 10 `BiometricManager` es la fuente fiable:
                // distingue «no hay sensor» de «hay sensor y nada enrolado», y
                // también cubre los equipos donde la biometría es la cara.
                return Veintinueve.canAuthenticate(ctx) == CODIGO_OK;
            }
            if (!tienePermiso(ctx, PERMISO_HUELLA)) {
                // Sin USE_FINGERPRINT este carril no puede preguntar nada. En
                // API 28 el carril real es BiometricPrompt (que usa
                // USE_BIOMETRIC), así que se responde que sí y el diálogo del
                // sistema dirá la verdad; bloquear aquí daría un falso negativo.
                return Build.VERSION.SDK_INT >= 28
                        && ctx.getPackageManager().hasSystemFeature(PackageManager.FEATURE_FINGERPRINT)
                        && tienePermiso(ctx, PERMISO_BIOMETRICO);
            }
            FingerprintManager fm = huella(ctx);
            return fm != null && fm.isHardwareDetected() && fm.hasEnrolledFingerprints();
        } catch (Throwable t) {
            // Un sensor que lanza excepción no está utilizable, punto.
            return false;
        }
    }

    /**
     * Estado en JSON: {"ok","hardware","enrolado","api"} más dos ayudas para la
     * interfaz ("metodo" y "motivo"). `ok` es el mismo booleano que `disponible`.
     */
    public static String estado(Context ctx) {
        JSONObject o = new JSONObject();
        boolean hardware = false;
        boolean enrolado = false;
        boolean permiso = true;
        String motivo;
        int api = Build.VERSION.SDK_INT;

        try {
            if (ctx == null) {
                motivo = "sin contexto: no puedo consultar el sensor";
            } else if (api >= 29) {
                int codigo = Veintinueve.canAuthenticate(ctx);
                hardware = codigo != ERR_NO_HARDWARE;
                enrolado = codigo == CODIGO_OK;
                permiso = tienePermiso(ctx, PERMISO_BIOMETRICO);
                motivo = textoCodigo(codigo);
            } else {
                // API 28 dibuja el diálogo del sistema (USE_BIOMETRIC) pero la
                // consulta de hardware y enrolamiento sigue siendo de
                // FingerprintManager (USE_FINGERPRINT). En 24-27 sólo existe
                // ese segundo camino.
                permiso = tienePermiso(ctx, PERMISO_HUELLA);
                FingerprintManager fm = huella(ctx);
                if (!permiso) {
                    // Sin el permiso declarado, Android ni siquiera deja
                    // preguntar si hay huellas: la llamada lanza SecurityException.
                    hardware = api >= 28
                            && ctx.getPackageManager().hasSystemFeature(PackageManager.FEATURE_FINGERPRINT);
                    motivo = api >= 28
                            ? "falta el permiso USE_FINGERPRINT en el manifiesto: sin él la app no puede consultar el sensor"
                            : "falta el permiso USE_FINGERPRINT en el manifiesto";
                } else if (fm == null) {
                    motivo = "el sistema no expone FingerprintManager";
                } else {
                    hardware = fm.isHardwareDetected();
                    enrolado = fm.hasEnrolledFingerprints();
                    motivo = !hardware ? "el dispositivo no tiene sensor de huella"
                            : !enrolado ? "hay sensor pero ninguna huella enrolada: se enrola en Ajustes > Seguridad"
                            : "listo para autenticar";
                }
            }
            o.put("ok", hardware && enrolado);
            o.put("hardware", hardware);
            o.put("enrolado", enrolado);
            o.put("api", api);
            o.put("metodo", api >= 28 ? METODO_BIOMETRIC : METODO_FINGERPRINT);
            o.put("permiso", permiso);
            o.put("motivo", motivo);
        } catch (Throwable t) {
            return falloJson("no se pudo consultar el sensor: " + tipo(t), "BIOMETRIA_ESTADO");
        }
        return o.toString();
    }

    // ------------------------------------------------------------------ pedir

    /**
     * Abre el diálogo biométrico y entrega el resultado por `cb`.
     *
     * No lanza excepciones y siempre llama al callback una sola vez: el éxito,
     * el botón negativo, la tecla atrás, el bloqueo del sensor y la falta de
     * hardware terminan todos en la misma puerta.
     */
    public static void pedir(final Activity act,
                             final String titulo,
                             final String subtitulo,
                             final String negativo,
                             final Callback cb) {
        if (act == null) {
            avisar(cb, false, "la biometría necesita una actividad en primer plano", METODO_ERROR);
            return;
        }
        if (Build.VERSION.SDK_INT < 23) {
            // minSdk es 24; esto sólo protege a quien reutilice la clase.
            avisar(cb, false, "este Android no soporta huella digital", METODO_ERROR);
            return;
        }
        if (act.isFinishing() || act.isDestroyed()) {
            avisar(cb, false, "la actividad se está cerrando", METODO_ERROR);
            return;
        }
        if (Build.VERSION.SDK_INT < 28 && !tienePermiso(act, PERMISO_HUELLA)) {
            // Con el permiso ausente, FingerprintManager lanza SecurityException.
            // Se avisa antes de mostrar un diálogo que no va a servir.
            avisar(cb, false,
                    "falta el permiso USE_FINGERPRINT en el manifiesto: sin él Android 7/8 no deja usar la huella",
                    METODO_ERROR);
            return;
        }
        if (!disponible(act)) {
            // El motivo ya está redactado en `estado`; no se duplica aquí.
            avisar(cb, false, motivoDe(act), METODO_ERROR);
            return;
        }

        final Intento intento = new Intento(act, cb);
        Runnable cuerpo = new Runnable() {
            @Override
            public void run() {
                // Un diálogo a la vez: si había otro abierto, ese recibe
                // "cancelado" antes de que éste aparezca.
                cancelar();
                actual = intento;
                try {
                    if (Build.VERSION.SDK_INT >= 28) {
                        Veintiocho.pedir(act, titulo, subtitulo, negativo, intento);
                    } else {
                        antiguo(act, titulo, subtitulo, negativo, intento);
                    }
                } catch (SecurityException e) {
                    // API 28+ exige USE_BIOMETRIC declarado; el framework lanza
                    // aquí, no en estado(), porque el diálogo vive en SystemUI.
                    intento.entregar(false,
                            "Android exige el permiso USE_BIOMETRIC declarado en el manifiesto para mostrar el diálogo",
                            METODO_ERROR);
                } catch (Throwable t) {
                    intento.entregar(false, "no se pudo abrir el diálogo: " + tipo(t), METODO_ERROR);
                }
            }
        };
        if (Looper.myLooper() == Looper.getMainLooper()) {
            cuerpo.run();
        } else {
            act.runOnUiThread(cuerpo);
        }
    }

    /**
     * Cierra el diálogo en curso. Su callback recibe ("cancelado"). Es seguro
     * llamarlo cuando no hay nada abierto.
     */
    public static void cancelar() {
        Runnable cuerpo = new Runnable() {
            @Override
            public void run() {
                Intento i = actual;
                actual = null;
                if (i != null) {
                    i.entregar(false, "autenticación cancelada", METODO_CANCELADO);
                }
            }
        };
        if (Looper.myLooper() == Looper.getMainLooper()) {
            cuerpo.run();
        } else {
            new Handler(Looper.getMainLooper()).post(cuerpo);
        }
    }

    // ------------------------------------------------- API 24-27 · huella

    /**
     * Carril viejo. `FingerprintManager` no dibuja nada, así que se arma un
     * `AlertDialog` mínimo con el mismo título, subtítulo y botón negativo.
     * Sin ese diálogo el usuario no vería más que el sensor encendido.
     */
    private static void antiguo(Activity act,
                                String titulo,
                                String subtitulo,
                                String negativo,
                                final Intento intento) {
        try {
            FingerprintManager fm = huella(act);
            if (fm == null || !fm.isHardwareDetected()) {
                intento.entregar(false, "este dispositivo no tiene sensor de huella", METODO_ERROR);
                return;
            }
            if (!fm.hasEnrolledFingerprints()) {
                intento.entregar(false,
                        "no hay ninguna huella enrolada: se enrola en Ajustes > Seguridad",
                        METODO_ERROR);
                return;
            }

            AlertDialog dialogo = new AlertDialog.Builder(act)
                    .setTitle(limpio(titulo, "Confirmar identidad"))
                    .setMessage(limpio(subtitulo, "Toca el sensor de huella"))
                    .setNegativeButton(limpio(negativo, "Cancelar"), new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface d, int boton) {
                            intento.entregar(false, "autenticación cancelada", METODO_CANCELADO);
                        }
                    })
                    .setOnCancelListener(new DialogInterface.OnCancelListener() {
                        @Override
                        public void onCancel(DialogInterface d) {
                            intento.entregar(false, "autenticación cancelada", METODO_CANCELADO);
                        }
                    })
                    .create();

            // Atrás, toque fuera o cierre programático pasan todos por aquí.
            // `entregar` es idempotente, así que no hay doble aviso.
            dialogo.setOnDismissListener(new DialogInterface.OnDismissListener() {
                @Override
                public void onDismiss(DialogInterface d) {
                    intento.entregar(false, "autenticación cancelada", METODO_CANCELADO);
                }
            });

            intento.dialogo = dialogo;
            dialogo.show();

            CancellationSignal senal = new CancellationSignal();
            intento.senal = senal;

            // CryptoObject null: aquí sólo se pregunta presencia. La huella que
            // desbloquea una clave del Keystore es asunto de `Huella`.
            fm.authenticate(null, senal, 0, new FingerprintManager.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(FingerprintManager.AuthenticationResult resultado) {
                    intento.entregar(true, null, METODO_FINGERPRINT);
                }

                @Override
                public void onAuthenticationFailed() {
                    // Huella no reconocida: el sistema deja reintentar sin cerrar.
                }

                @Override
                public void onAuthenticationHelp(int ayuda, CharSequence texto) {
                    // Sensor sucio o dedo movido: se ignora, el sistema reintenta solo.
                }

                @Override
                public void onAuthenticationError(int codigo, CharSequence mensaje) {
                    if (esCancelacion(codigo)) {
                        intento.entregar(false, "autenticación cancelada", METODO_CANCELADO);
                    } else {
                        intento.entregar(false, mensajeError(codigo, mensaje), METODO_ERROR);
                    }
                }
            }, new Handler(Looper.getMainLooper()));
        } catch (SecurityException e) {
            intento.entregar(false,
                    "Android no deja usar la huella: falta el permiso USE_FINGERPRINT en el manifiesto",
                    METODO_ERROR);
        } catch (Throwable t) {
            intento.entregar(false, "no se pudo iniciar la huella: " + tipo(t), METODO_ERROR);
        }
    }

    // ------------------------------------------------- API 28+ · BiometricPrompt

    /**
     * Carril moderno, aislado en su propia clase para que API 24-27 nunca
     * resuelva `BiometricPrompt`.
     */
    private static final class Veintiocho {

        private Veintiocho() {
        }

        static void pedir(final Activity act,
                          String titulo,
                          String subtitulo,
                          String negativo,
                          final Intento intento) {
            // El callback del framework llega por este ejecutor: un solo hilo,
            // el principal. Así la interfaz puede tocar vistas sin cerrojos.
            final Executor ejecutor = new Executor() {
                private final Handler ui = new Handler(Looper.getMainLooper());

                @Override
                public void execute(Runnable r) {
                    ui.post(r);
                }
            };

            // BiometricPrompt exige título, botón negativo y subtítulo (o
            // descripción): si falta uno, build() lanza IllegalArgumentException.
            String tituloOk = limpio(titulo, "Confirmar identidad");
            String subtituloOk = limpio(subtitulo, "Toca el sensor de huella");
            String negativoOk = limpio(negativo, "Cancelar");

            android.hardware.biometrics.BiometricPrompt.Builder constructor =
                    new android.hardware.biometrics.BiometricPrompt.Builder(act)
                            .setTitle(tituloOk)
                            .setSubtitle(subtituloOk)
                            .setConfirmationRequired(false)
                            .setNegativeButton(negativoOk, ejecutor,
                                    new DialogInterface.OnClickListener() {
                                        @Override
                                        public void onClick(DialogInterface d, int boton) {
                                            intento.entregar(false, "autenticación cancelada",
                                                    METODO_CANCELADO);
                                        }
                                    });

            android.hardware.biometrics.BiometricPrompt prompt = constructor.build();

            CancellationSignal senal = new CancellationSignal();
            intento.senal = senal;

            prompt.authenticate(senal, ejecutor,
                    new android.hardware.biometrics.BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(
                                android.hardware.biometrics.BiometricPrompt.AuthenticationResult r) {
                            intento.entregar(true, null, METODO_BIOMETRIC);
                        }

                        @Override
                        public void onAuthenticationFailed() {
                            // El sistema deja reintentar con el diálogo abierto.
                        }

                        @Override
                        public void onAuthenticationHelp(int ayuda, CharSequence texto) {
                            // No se cierra nada: es informativo.
                        }

                        @Override
                        public void onAuthenticationError(int codigo, CharSequence mensaje) {
                            if (esCancelacion(codigo)) {
                                intento.entregar(false, "autenticación cancelada", METODO_CANCELADO);
                            } else {
                                intento.entregar(false, mensajeError(codigo, mensaje), METODO_ERROR);
                            }
                        }
                    });
        }
    }

    // ------------------------------------------------- API 29+ · BiometricManager

    /** `BiometricManager` sólo existe desde Android 10. */
    private static final class Veintinueve {

        private Veintinueve() {
        }

        static int canAuthenticate(Context ctx) {
            Object servicio = ctx.getSystemService(Context.BIOMETRIC_SERVICE);
            if (!(servicio instanceof android.hardware.biometrics.BiometricManager)) {
                return ERR_NO_HARDWARE;
            }
            android.hardware.biometrics.BiometricManager bm =
                    (android.hardware.biometrics.BiometricManager) servicio;
            return bm.canAuthenticate();
        }
    }

    // ---------------------------------------------------------------- intento

    /**
     * Un intento concreto. `entregado` es la garantía de un solo aviso: entre
     * el botón negativo, el cierre del diálogo, el error del sistema y el
     * éxito, el primero que llegue gana y los demás se descartan.
     */
    private static final class Intento {

        private final Activity actividad;
        private final Callback callback;
        private final AtomicBoolean entregado = new AtomicBoolean(false);

        volatile CancellationSignal senal;
        volatile AlertDialog dialogo;

        Intento(Activity actividad, Callback callback) {
            this.actividad = actividad;
            this.callback = callback;
        }

        void entregar(final boolean ok, final String error, final String metodo) {
            if (!entregado.compareAndSet(false, true)) {
                return;
            }
            cerrar();
            if (actual == this) {
                actual = null;
            }
            if (callback == null) {
                return;
            }
            // Ya se está en el hilo de UI en casi todos los caminos; runOnUiThread
            // no vuelve a encolar cuando se llama desde el hilo principal.
            if (actividad != null && !actividad.isFinishing() && !actividad.isDestroyed()) {
                actividad.runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            callback.resultado(ok, error, metodo);
                        } catch (Throwable ignorado) {
                            // Un callback roto no puede tumbar la actividad.
                        }
                    }
                });
            } else {
                avisar(callback, ok, error, metodo);
            }
        }

        /** Suelta diálogo y señal. No entrega nada: eso ya lo hizo `entregar`. */
        void cerrar() {
            CancellationSignal s = senal;
            senal = null;
            if (s != null) {
                try {
                    s.cancel();
                } catch (Throwable ignorado) {
                    // Ya estaba cancelada.
                }
            }
            AlertDialog d = dialogo;
            dialogo = null;
            if (d != null) {
                try {
                    if (d.isShowing()) {
                        d.dismiss();
                    }
                } catch (Throwable ignorado) {
                    // La ventana ya no existía.
                }
            }
        }
    }

    // -------------------------------------------------------------- utilidades

    private static FingerprintManager huella(Context ctx) {
        Object servicio = ctx.getSystemService(Context.FINGERPRINT_SERVICE);
        return servicio instanceof FingerprintManager ? (FingerprintManager) servicio : null;
    }

    private static boolean tienePermiso(Context ctx, String permiso) {
        try {
            return ctx.checkSelfPermission(permiso) == PackageManager.PERMISSION_GRANTED;
        } catch (Throwable t) {
            return false;
        }
    }

    /** Cancelar de verdad: el botón negativo, la tecla atrás y la señal propia. */
    private static boolean esCancelacion(int codigo) {
        return codigo == ERR_CANCELED
                || codigo == ERR_USER_CANCELED
                || codigo == ERR_NEGATIVE_BUTTON;
    }

    /** Traduce el código del framework a algo que el usuario pueda accionar. */
    private static String mensajeError(int codigo, CharSequence delSistema) {
        switch (codigo) {
            case ERR_HW_UNAVAILABLE:
                return "el sensor no está disponible en este momento; prueba en unos segundos";
            case ERR_UNABLE_TO_PROCESS:
                return "el sensor no pudo leer la huella; limpia el lector e intenta de nuevo";
            case ERR_TIMEOUT:
                return "se agotó el tiempo de espera; vuelve a intentarlo";
            case ERR_NO_SPACE:
                return "el almacenamiento seguro del sensor está lleno";
            case ERR_LOCKOUT:
                return "demasiados intentos fallidos: espera unos 30 segundos antes de reintentar";
            case ERR_VENDOR:
                return "el sensor reportó un error del fabricante" + detalle(delSistema);
            case ERR_LOCKOUT_PERMANENT:
                return "la huella quedó bloqueada por demasiados intentos: desbloquea el teléfono con PIN o patrón";
            case ERR_NONE_ENROLLED:
                return "no hay ninguna huella enrolada en el sistema";
            case ERR_NO_HARDWARE:
                return "este dispositivo no tiene sensor de huella";
            case ERR_NO_DEVICE_CREDENTIAL:
                return "el teléfono no tiene PIN, patrón ni contraseña configurados";
            case ERR_SECURITY_UPDATE:
                return "Android exige una actualización de seguridad del sensor antes de usarlo";
            default:
                return "el sensor rechazó la autenticación (código " + codigo + ")" + detalle(delSistema);
        }
    }

    /** Texto corto para `estado`, a partir del código de BiometricManager. */
    private static String textoCodigo(int codigo) {
        switch (codigo) {
            case CODIGO_OK:
                return "listo para autenticar";
            case ERR_NONE_ENROLLED:
                return "hay sensor pero ninguna huella enrolada: se enrola en Ajustes > Seguridad";
            case ERR_NO_HARDWARE:
                return "el dispositivo no tiene sensor biométrico";
            case ERR_HW_UNAVAILABLE:
                return "el sensor está ocupado o desactivado en este momento";
            case ERR_SECURITY_UPDATE:
                return "Android exige una actualización de seguridad del sensor";
            default:
                return "el sistema no informa un estado utilizable (código " + codigo + ")";
        }
    }

    private static String motivoDe(Context ctx) {
        String motivo = "no hay huella disponible en este dispositivo";
        try {
            JSONObject o = new JSONObject(estado(ctx));
            String leido = o.optString("motivo", "");
            if (leido != null && !leido.isEmpty()) {
                motivo = leido;
            }
        } catch (Throwable ignorado) {
            // Si el JSON falla, queda el motivo genérico.
        }
        return motivo;
    }

    private static String detalle(CharSequence delSistema) {
        if (delSistema == null) {
            return "";
        }
        String texto = delSistema.toString().trim();
        return texto.isEmpty() ? "" : ": " + texto;
    }

    private static String limpio(String texto, String defecto) {
        return texto == null || texto.trim().isEmpty() ? defecto : texto.trim();
    }

    private static String tipo(Throwable t) {
        String m = t.getMessage();
        return t.getClass().getSimpleName() + (m == null || m.isEmpty() ? "" : ": " + m);
    }

    private static String falloJson(String motivo, String codigo) {
        JSONObject o = new JSONObject();
        try {
            o.put("ok", false);
            o.put("hardware", false);
            o.put("enrolado", false);
            o.put("api", Build.VERSION.SDK_INT);
            o.put("motivo", motivo);
            o.put("codigo", codigo);
        } catch (Throwable ignorado) {
            return "{\"ok\":false,\"hardware\":false,\"enrolado\":false,\"api\":"
                    + Build.VERSION.SDK_INT + ",\"codigo\":\"" + codigo + "\"}";
        }
        return o.toString();
    }

    /** Entrega fuera de un `Intento` (errores previos, callback sin actividad). */
    private static void avisar(final Callback cb, final boolean ok,
                              final String error, final String metodo) {
        if (cb == null) {
            return;
        }
        Runnable cuerpo = new Runnable() {
            @Override
            public void run() {
                try {
                    cb.resultado(ok, error, metodo);
                } catch (Throwable ignorado) {
                    // Un callback roto no puede tumbar la actividad.
                }
            }
        };
        if (Looper.myLooper() == Looper.getMainLooper()) {
            cuerpo.run();
        } else {
            new Handler(Looper.getMainLooper()).post(cuerpo);
        }
    }
}
