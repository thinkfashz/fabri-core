package cl.fabrick.core;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.hardware.fingerprint.FingerprintManager;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONObject;

import java.security.KeyStore;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;

/**
 * FORGE CORE STOCK · acceso local con huella + PIN.
 *
 * Diseño:
 *   · El PIN se guarda como PBKDF2-SHA256 con sal aleatoria (nunca en claro).
 *   · La huella no "compara" nada: desbloquea una clave AES del AndroidKeyStore
 *     creada con setUserAuthenticationRequired(true). Sin autenticación
 *     biométrica el keystore se niega a descifrar. Eso es una verificación real,
 *     no un booleano en JavaScript.
 *   · Si el usuario enrola una huella nueva, la clave se invalida (por diseño de
 *     Android). La app lo detecta y pide reactivar con el PIN.
 *   · El PIN siempre funciona como respaldo: nadie queda fuera de su propia app.
 */
final class Huella {

    private static final String PREFS = "fabrick_acceso";
    private static final String ALIAS = "fabrick_huella_v1";

    private static final String K_PIN_HASH = "pin_hash";
    private static final String K_PIN_SALT = "pin_salt";
    private static final String K_PIN_OK = "pin_configurado";
    /** Algoritmo usado al crear el PIN: en SDK < 26 el Keystore no ofrece SHA-256. */
    private static final String K_PIN_ALGO = "pin_algo";
    private static final String K_ACTIVA = "huella_activa";
    private static final String K_IV = "huella_iv";
    private static final String K_CT = "huella_ct";
    private static final String K_INTENTOS = "intentos_fallidos";
    private static final String K_BLOQUEO = "bloqueado_hasta";

    private static final int ITERACIONES = 80000;
    private static final int MAX_INTENTOS = 8;
    private static final long BLOQUEO_MS = 60L * 1000L;

    private static volatile boolean desbloqueado = false;
    private static volatile long ultimoDesbloqueo = 0L;

    private Huella() {
    }

    // ------------------------------------------------------------------ estado

    static String estado(Context ctx) {
        JSONObject o = new JSONObject();
        try {
            SharedPreferences p = prefs(ctx);
            boolean pin = p.getBoolean(K_PIN_OK, false);
            boolean activa = p.getBoolean(K_ACTIVA, false) && p.contains(K_CT);
            boolean hw = hardwareHuella(ctx);
            long bloqueadoHasta = p.getLong(K_BLOQUEO, 0L);
            o.put("ok", true);
            o.put("pinConfigurado", pin);
            o.put("huellaActiva", activa);
            // El testigo cifrado es lo que realmente permite desbloquear: si
            // falta, la huella no está operativa aunque la preferencia diga sí.
            o.put("tokenGuardado", p.contains(K_IV) && p.contains(K_CT));
            o.put("huellaDisponible", hw);
            o.put("desbloqueado", desbloqueado);
            o.put("bloqueado", bloqueadoHasta > System.currentTimeMillis());
            o.put("bloqueadoHasta", bloqueadoHasta);
            o.put("intentosFallidos", p.getInt(K_INTENTOS, 0));
            o.put("maxIntentos", MAX_INTENTOS);
            o.put("sdk", Build.VERSION.SDK_INT);
            o.put("biometricoNativo", Build.VERSION.SDK_INT >= 28);
            o.put("motivo", !hw ? "El dispositivo no reporta huella enrolada"
                    : !activa ? "La huella todavía no está activada: activála con tu PIN"
                    : "Listo para autenticar");
        } catch (Throwable t) {
            return TermuxPuente.error(TermuxPuente.tipo(t), "EXCEPCION");
        }
        return o.toString();
    }

    static String sesion() {
        return "{\"ok\":true,\"desbloqueado\":" + desbloqueado
                + ",\"haceMs\":" + (desbloqueado ? System.currentTimeMillis() - ultimoDesbloqueo : -1) + "}";
    }

    static String bloquear() {
        desbloqueado = false;
        ultimoDesbloqueo = 0L;
        return "{\"ok\":true,\"desbloqueado\":false}";
    }

    /** Borra PIN y huella. Se usa para recuperar un acceso perdido. */
    static String borrar(Context ctx) {
        try {
            prefs(ctx).edit().clear().apply();
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            if (ks.containsAlias(ALIAS)) {
                ks.deleteEntry(ALIAS);
            }
            desbloqueado = false;
            return "{\"ok\":true,\"borrado\":true}";
        } catch (Throwable t) {
            return TermuxPuente.error(TermuxPuente.tipo(t), "EXCEPCION");
        }
    }

    /**
     * Desactiva sólo la huella: borra el testigo cifrado y la clave del
     * Keystore, pero conserva el PIN. Es distinto de `borrar`, que restablece
     * todo el acceso. El usuario puede seguir entrando con su PIN y volver a
     * activar la huella cuando quiera.
     */
    static String desactivar(Context ctx) {
        try {
            SharedPreferences p = prefs(ctx);
            p.edit().remove(K_ACTIVA).remove(K_IV).remove(K_CT).apply();
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            if (ks.containsAlias(ALIAS)) {
                ks.deleteEntry(ALIAS);
            }
            // No se toca `desbloqueado`: el usuario ya está dentro de la app.
            return "{\"ok\":true,\"huellaActiva\":false,\"pinConfigurado\":"
                    + p.getBoolean(K_PIN_OK, false) + "}";
        } catch (Throwable t) {
            return TermuxPuente.error(TermuxPuente.tipo(t), "EXCEPCION");
        }
    }

    // --------------------------------------------------------------------- PIN

    static String configurarPin(Context ctx, String pin) {
        if (!pinValido(pin)) {
            return TermuxPuente.error("El PIN debe tener de 4 a 6 dígitos", "PIN_FORMATO");
        }
        try {
            byte[] sal = new byte[16];
            new SecureRandom().nextBytes(sal);
            String algoritmo = algoritmoPin();
            byte[] hash = hashPin(pin, sal, algoritmo);
            prefs(ctx).edit()
                    .putString(K_PIN_SALT, b64(sal))
                    .putString(K_PIN_HASH, b64(hash))
                    .putString(K_PIN_ALGO, algoritmo)
                    .putBoolean(K_PIN_OK, true)
                    .putInt(K_INTENTOS, 0)
                    .putLong(K_BLOQUEO, 0L)
                    .apply();
            desbloqueado = true;
            ultimoDesbloqueo = System.currentTimeMillis();
            // Se devuelve también el verificador para que la interfaz lo guarde
            // en la tabla `usuarios` de SQLite: el login queda respaldado en la
            // base y no sólo en las preferencias del teléfono. El PIN en claro
            // nunca sale de aquí.
            return "{\"ok\":true,\"pinConfigurado\":true"
                    + ",\"algoritmo\":\"" + algoritmo + "\""
                    + ",\"iteraciones\":" + ITERACIONES
                    + ",\"sal\":\"" + b64(sal) + "\""
                    + ",\"hash\":\"" + b64(hash) + "\""
                    + ",\"sesion\":\"" + tokenNuevo() + "\"}";
        } catch (Throwable t) {
            return TermuxPuente.error(TermuxPuente.tipo(t), "EXCEPCION");
        }
    }

    static String verificarPin(Context ctx, String pin) {
        SharedPreferences p = prefs(ctx);
        if (!p.getBoolean(K_PIN_OK, false)) {
            return TermuxPuente.error("Todavía no hay un PIN configurado", "SIN_PIN");
        }
        return verificarCon(ctx, pin,
                p.getString(K_PIN_ALGO, algoritmoPin()),
                p.getString(K_PIN_SALT, ""),
                p.getString(K_PIN_HASH, ""));
    }

    /**
     * Verifica el PIN contra un verificador explícito (el de la tabla `usuarios`).
     * El control de intentos y el bloqueo son los mismos que en `verificarPin`:
     * dos caminos de verificación no pueden duplicar los intentos de prueba.
     */
    static String verificarPinExterno(Context ctx, String pin, String algoritmo, String salB64, String hashB64) {
        if (salB64 == null || salB64.isEmpty() || hashB64 == null || hashB64.isEmpty()) {
            return TermuxPuente.error("No hay un verificador guardado para este usuario", "SIN_VERIFICADOR");
        }
        String algo = (algoritmo == null || algoritmo.isEmpty()) ? algoritmoPin() : algoritmo;
        return verificarCon(ctx, pin, algo, salB64, hashB64);
    }

    private static String verificarCon(Context ctx, String pin, String algoritmo, String salB64, String hashB64) {
        SharedPreferences p = prefs(ctx);
        long hasta = p.getLong(K_BLOQUEO, 0L);
        long ahora = System.currentTimeMillis();
        if (hasta > ahora) {
            long seg = (hasta - ahora) / 1000L + 1;
            return TermuxPuente.error("Demasiados intentos. Espera " + seg + " s.", "BLOQUEADO");
        }
        if (!pinValido(pin)) {
            return TermuxPuente.error("El PIN debe tener de 4 a 6 dígitos", "PIN_FORMATO");
        }
        try {
            byte[] sal = Base64.decode(salB64, Base64.NO_WRAP);
            byte[] esperado = Base64.decode(hashB64, Base64.NO_WRAP);
            byte[] real = hashPin(pin, sal, algoritmo);
            if (!iguales(esperado, real)) {
                int fallos = p.getInt(K_INTENTOS, 0) + 1;
                SharedPreferences.Editor e = p.edit().putInt(K_INTENTOS, fallos);
                if (fallos >= MAX_INTENTOS) {
                    e.putLong(K_BLOQUEO, ahora + BLOQUEO_MS).putInt(K_INTENTOS, 0);
                }
                e.apply();
                int restantes = MAX_INTENTOS - fallos;
                return TermuxPuente.error(restantes > 0
                        ? "PIN incorrecto. Te quedan " + restantes + " intento(s)."
                        : "PIN incorrecto. Acceso bloqueado 60 s.", "PIN_INCORRECTO");
            }
            p.edit().putInt(K_INTENTOS, 0).putLong(K_BLOQUEO, 0L).apply();
            desbloqueado = true;
            ultimoDesbloqueo = ahora;
            return "{\"ok\":true,\"desbloqueado\":true,\"sesion\":\"" + tokenNuevo() + "\"}";
        } catch (Throwable t) {
            return TermuxPuente.error(TermuxPuente.tipo(t), "EXCEPCION");
        }
    }

    /** Algoritmo disponible en este SDK para derivar el PIN. */
    private static String algoritmoPin() {
        return Build.VERSION.SDK_INT >= 26 ? "PBKDF2WithHmacSHA256" : "PBKDF2WithHmacSHA1";
    }

    // ------------------------------------------------------------------ huella

    /** Activa la huella: cifra un testigo con una clave que exige biometría. */
    static String activar(Activity actividad, NativeBridge.Notificador notificador) {
        SharedPreferences p = prefs(actividad);
        if (!p.getBoolean(K_PIN_OK, false)) {
            return TermuxPuente.error("Configura primero el PIN: es el respaldo si la huella falla", "SIN_PIN");
        }
        if (!hardwareHuella(actividad)) {
            return TermuxPuente.error("No hay huella enrolada en este dispositivo", "SIN_HUELLA");
        }
        if (Build.VERSION.SDK_INT < 28) {
            return TermuxPuente.error("La huella con clave segura requiere Android 9 o superior", "SDK_BAJO");
        }
        try {
            Cipher cifrado = Cipher.getInstance("AES/GCM/NoPadding");
            cifrado.init(Cipher.ENCRYPT_MODE, clave());
            final Cipher finalCifrado = cifrado;
            final SharedPreferences finalPrefs = p;
            final NativeBridge.Notificador finalNoti = notificador;
            autenticarBiometrico(actividad, "Activar huella",
                    "Confirma tu huella para proteger el acceso",
                    new Resultado() {
                        @Override
                        public void ok(String detalle) {
                            try {
                                byte[] testigo = tokenBytes();
                                byte[] ct = finalCifrado.doFinal(testigo);
                                byte[] iv = finalCifrado.getIV();
                                finalPrefs.edit()
                                        .putBoolean(K_ACTIVA, true)
                                        .putString(K_IV, b64(iv))
                                        .putString(K_CT, b64(ct))
                                        .apply();
                                desbloqueado = true;
                                ultimoDesbloqueo = System.currentTimeMillis();
                                avisar(finalNoti, "{\"ok\":true,\"activada\":true,"
                                        + "\"sesion\":\"" + b64(testigo) + "\"}");
                            } catch (Throwable t) {
                                avisar(finalNoti, TermuxPuente.error(
                                        "No se pudo guardar la huella: " + TermuxPuente.tipo(t), "KEYSTORE"));
                            }
                        }

                        @Override
                        public void fallo(String json) {
                            avisar(finalNoti, json);
                        }
                    }, finalCifrado);
            return "{\"ok\":true,\"estado\":\"ESPERANDO_HUELLA\"}";
        } catch (KeyPermanentlyInvalidatedException e) {
            return TermuxPuente.error("La clave de huella quedó inválida. Vuelve a activarla.", "HUELLA_INVALIDADA");
        } catch (Throwable t) {
            return TermuxPuente.error(TermuxPuente.tipo(t), "KEYSTORE");
        }
    }

    /** Autentica con huella y devuelve el testigo descifrado. */
    static String autenticar(Activity actividad, NativeBridge.Notificador notificador) {
        SharedPreferences p = prefs(actividad);
        if (!p.getBoolean(K_ACTIVA, false) || !p.contains(K_CT)) {
            return TermuxPuente.error("La huella no está activada. Entra con PIN y actívala.", "HUELLA_NO_ACTIVADA");
        }
        if (Build.VERSION.SDK_INT < 28) {
            return TermuxPuente.error("La huella con clave segura requiere Android 9 o superior", "SDK_BAJO");
        }
        try {
            byte[] iv = Base64.decode(p.getString(K_IV, ""), Base64.NO_WRAP);
            final byte[] ct = Base64.decode(p.getString(K_CT, ""), Base64.NO_WRAP);
            Cipher descifrado = Cipher.getInstance("AES/GCM/NoPadding");
            descifrado.init(Cipher.DECRYPT_MODE, clave(), new GCMParameterSpec(128, iv));
            final Cipher finalDescifrado = descifrado;
            final NativeBridge.Notificador finalNoti = notificador;
            autenticarBiometrico(actividad, "FORGE CORE STOCK",
                    "Confirma tu huella para entrar",
                    new Resultado() {
                        @Override
                        public void ok(String detalle) {
                            try {
                                byte[] testigo = finalDescifrado.doFinal(ct);
                                desbloqueado = true;
                                ultimoDesbloqueo = System.currentTimeMillis();
                                avisar(finalNoti, "{\"ok\":true,\"desbloqueado\":true,"
                                        + "\"sesion\":\"" + b64(testigo) + "\"}");
                            } catch (Throwable t) {
                                avisar(finalNoti, TermuxPuente.error(
                                        "La huella se validó pero la clave no descifra: "
                                                + TermuxPuente.tipo(t) + ". Reactiva la huella con tu PIN.",
                                        "HUELLA_INVALIDADA"));
                            }
                        }

                        @Override
                        public void fallo(String json) {
                            avisar(finalNoti, json);
                        }
                    }, finalDescifrado);
            return "{\"ok\":true,\"estado\":\"ESPERANDO_HUELLA\"}";
        } catch (KeyPermanentlyInvalidatedException e) {
            p.edit().putBoolean(K_ACTIVA, false).apply();
            return TermuxPuente.error("La huella cambió en el sistema. Reactívala con tu PIN.", "HUELLA_INVALIDADA");
        } catch (Throwable t) {
            return TermuxPuente.error(TermuxPuente.tipo(t), "KEYSTORE");
        }
    }

    // ------------------------------------------------------------- biométrico

    interface Resultado {
        void ok(String detalle);

        void fallo(String json);
    }

    private static void autenticarBiometrico(Activity actividad,
                                             String titulo,
                                             String subtitulo,
                                             final Resultado resultado,
                                             final Cipher cifrado) {
        // La clase que toca BiometricPrompt vive aparte y sólo se carga en API 28+.
        HuellaBiometrica.prompt(actividad, titulo, subtitulo, cifrado, new HuellaBiometrica.Callback() {
            @Override
            public void exito() {
                resultado.ok("huella");
            }

            @Override
            public void error(String mensaje, String codigo) {
                resultado.fallo(TermuxPuente.error(mensaje, codigo));
            }
        });
    }

    // --------------------------------------------------------------- keystore

    private static SecretKey clave() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(ALIAS)) {
            return ((KeyStore.SecretKeyEntry) ks.getEntry(ALIAS, null)).getSecretKey();
        }
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(
                ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(true)
                .setInvalidatedByBiometricEnrollment(true);
        if (Build.VERSION.SDK_INT >= 30) {
            b.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        } else {
            b.setUserAuthenticationValidityDurationSeconds(-1);
        }
        kg.init(b.build());
        return kg.generateKey();
    }

    // -------------------------------------------------------------- utilidades

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static boolean hardwareHuella(Context ctx) {
        try {
            FingerprintManager fm = (FingerprintManager) ctx.getSystemService(Context.FINGERPRINT_SERVICE);
            return fm != null && fm.isHardwareDetected() && fm.hasEnrolledFingerprints();
        } catch (Throwable t) {
            return false;
        }
    }

    private static boolean pinValido(String pin) {
        if (pin == null) {
            return false;
        }
        String limpio = pin.trim();
        if (limpio.length() < 4 || limpio.length() > 6) {
            return false;
        }
        for (int i = 0; i < limpio.length(); i++) {
            if (limpio.charAt(i) < '0' || limpio.charAt(i) > '9') {
                return false;
            }
        }
        return true;
    }

    private static byte[] hashPin(String pin, byte[] sal, String algoritmo) throws Exception {
        SecretKeyFactory f = SecretKeyFactory.getInstance(algoritmo);
        PBEKeySpec spec = new PBEKeySpec(pin.toCharArray(), sal, ITERACIONES, 256);
        return f.generateSecret(spec).getEncoded();
    }

    private static boolean iguales(byte[] a, byte[] b) {
        if (a == null || b == null || a.length != b.length) {
            return false;
        }
        int dif = 0;
        for (int i = 0; i < a.length; i++) {
            dif |= a[i] ^ b[i];
        }
        return dif == 0;
    }

    private static byte[] tokenBytes() {
        byte[] t = new byte[24];
        new SecureRandom().nextBytes(t);
        return t;
    }

    private static String tokenNuevo() {
        return b64(tokenBytes());
    }

    private static String b64(byte[] datos) {
        return Base64.encodeToString(datos, Base64.NO_WRAP);
    }

    private static void avisar(NativeBridge.Notificador n, String json) {
        if (n != null) {
            n.js("window.FabriHuella && FabriHuella.resultado(" + json + ");");
        }
    }
}
