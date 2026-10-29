package cl.fabrick.core;

import android.app.Activity;
import android.content.DialogInterface;
import android.hardware.biometrics.BiometricPrompt;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;

import java.util.concurrent.Executor;

import javax.crypto.Cipher;

/**
 * FORGE CORE STOCK · diálogo biométrico del sistema (Android 9+).
 *
 * Vive en su propia clase a propósito: `android.hardware.biometrics.BiometricPrompt`
 * existe desde API 28. Al aislarlo, un teléfono con Android 7/8 puede cargar
 * `Huella` sin que el verificador intente resolver esa clase.
 */
final class HuellaBiometrica {

    interface Callback {
        void exito();

        void error(String mensaje, String codigo);
    }

    private HuellaBiometrica() {
    }

    static void prompt(Activity actividad,
                       String titulo,
                       String subtitulo,
                       Cipher cifrado,
                       final Callback callback) {
        final Handler handler = new Handler(Looper.getMainLooper());
        final Executor ejecutor = new Executor() {
            @Override
            public void execute(Runnable r) {
                handler.post(r);
            }
        };

        BiometricPrompt prompt = new BiometricPrompt.Builder(actividad)
                .setTitle(titulo)
                .setSubtitle(subtitulo)
                .setDescription("La huella se verifica en el chip del teléfono; no se envía a ninguna parte.")
                .setConfirmationRequired(false)
                .setNegativeButton("Usar PIN", ejecutor, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialogo, int boton) {
                        callback.error("Autenticación cancelada", "CANCELADO");
                    }
                })
                .build();

        prompt.authenticate(new BiometricPrompt.CryptoObject(cifrado),
                new CancellationSignal(), ejecutor,
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult resultado) {
                        callback.exito();
                    }

                    @Override
                    public void onAuthenticationError(int codigo, CharSequence mensaje) {
                        // 13 = ERROR_NEGATIVE_BUTTON (constante pública del framework,
                        // ausente en algunos stubs de android.jar).
                        if (codigo == 13) {
                            callback.error("Autenticación cancelada", "CANCELADO");
                            return;
                        }
                        String texto = mensaje == null ? "error biométrico " + codigo : mensaje.toString();
                        callback.error(texto, "HUELLA_ERROR_" + codigo);
                    }

                    @Override
                    public void onAuthenticationFailed() {
                        // El sistema permite reintentar sin cerrar el diálogo.
                    }
                });
    }
}
