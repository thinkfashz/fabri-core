/*
 * FABRI-CORE · puente JNI del runtime llama.cpp (A1 + A2 + A3)
 * -------------------------------------------------------------------------
 * A1: carga de las bibliotecas y llama_version().
 * A2: inicializa backends desde nativeLibraryDir y carga un GGUF verificado.
 * A3: genera una respuesta corta y libera el modelo.
 *
 * La ruta del modelo llega desde Java, que la confina a filesDir. Este puente
 * no ejecuta binarios ni acepta comandos de shell: sólo texto y una ruta GGUF.
 */
#include <jni.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "llama.h"

/* Implementadas en fabrick_llama.c (mismo .so). */
extern int fc_iniciar_ruta(const char *dir);
extern void *fc_cargar(const char *ruta, int n_ctx, int n_threads, char *err, int errlen);
extern int fc_info(void *handle, char *buf, int buflen);
typedef void (*fc_pieza_cb)(void *ud, const char *texto, int n_bytes, int tokens);
extern int fc_generar(void *handle, const char *prompt, int max_tokens,
                      fc_pieza_cb cb, void *ud,
                      char *out, int outlen,
                      int *n_generados, int *n_prompt,
                      double *ms, double *ms_primer,
                      int *cancelado, int *reutilizados);
extern int fc_configurar(void *handle, float temp, float top_p, int top_k,
                         float repetir, uint32_t semilla);
extern int fc_detener(void *handle);
extern int fc_estado_ctx(void *handle, int *kv_len, int *n_ctx);
extern void fc_liberar(void *handle);

/* ---------------------------------------------------------------------------
 * Puente de streaming: `fc_generar` corre en el hilo "llama-generar" que crea
 * Java, así que el JNIEnv de esa llamada sigue válido durante toda la
 * generación. No hace falta AttachCurrentThread ni guardar referencias
 * globales: el objeto de callback vive en el marco de la llamada.
 * ------------------------------------------------------------------------- */
typedef struct fc_puente {
    JNIEnv   *env;
    jobject   cb;
    jmethodID metodo;
} fc_puente;

static void puente_pieza(void *ud, const char *texto, int n_bytes, int tokens) {
    fc_puente *p = (fc_puente *) ud;
    if (p == NULL || p->cb == NULL || p->metodo == NULL || texto == NULL || n_bytes <= 0) {
        return;
    }
    jbyteArray arreglo = (*p->env)->NewByteArray(p->env, n_bytes);
    if (arreglo == NULL) {
        return; /* OutOfMemory: se pierde el trozo, no la generación */
    }
    (*p->env)->SetByteArrayRegion(p->env, arreglo, 0, n_bytes, (const jbyte *) texto);
    (*p->env)->CallVoidMethod(p->env, p->cb, p->metodo, arreglo, (jint) tokens);
    (*p->env)->DeleteLocalRef(p->env, arreglo);
}

/* Copia `src` a `dst` como contenido de una cadena JSON. */
static void json_escape(const char *src, char *dst, size_t dstlen) {
    size_t j = 0;
    if (dstlen == 0) {
        return;
    }
    for (size_t i = 0; src != NULL && src[i] != '\0' && j + 1 < dstlen; i++) {
        unsigned char c = (unsigned char) src[i];
        const char *rep = NULL;
        char tmp[8];
        switch (c) {
            case '"': rep = "\\\""; break;
            case '\\': rep = "\\\\"; break;
            case '\n': rep = "\\n"; break;
            case '\r': rep = "\\r"; break;
            case '\t': rep = "\\t"; break;
            default:
                if (c < 0x20) {
                    snprintf(tmp, sizeof(tmp), "\\u%04x", c);
                    rep = tmp;
                }
                break;
        }
        if (rep != NULL) {
            size_t n = strlen(rep);
            if (j + n >= dstlen) {
                break;
            }
            memcpy(dst + j, rep, n);
            j += n;
        } else {
            dst[j++] = (char) c;
        }
    }
    dst[j] = '\0';
}

static jstring nuevo_json(JNIEnv *env, const char *texto) {
    return (*env)->NewStringUTF(env, texto != NULL ? texto : "{}");
}

JNIEXPORT jstring JNICALL
Java_cl_fabrick_core_RuntimeNativo_versionNativa(JNIEnv *env, jclass clase) {
    (void) clase;
    const char *version = llama_version();
    return (*env)->NewStringUTF(env, version != NULL ? version : "desconocida");
}

JNIEXPORT jstring JNICALL
Java_cl_fabrick_core_RuntimeNativo_iniciarNativo(JNIEnv *env, jclass clase, jstring dir) {
    (void) clase;
    const char *ruta = dir == NULL ? NULL : (*env)->GetStringUTFChars(env, dir, NULL);
    int rc = fc_iniciar_ruta(ruta);
    if (ruta != NULL) {
        (*env)->ReleaseStringUTFChars(env, dir, ruta);
    }
    char salida[256];
    snprintf(salida, sizeof(salida), "{\"ok\":%s,\"rc\":%d}", rc == 0 ? "true" : "false", rc);
    return nuevo_json(env, salida);
}

JNIEXPORT jstring JNICALL
Java_cl_fabrick_core_RuntimeNativo_cargarNativo(JNIEnv *env, jclass clase,
                                                jstring ruta, jint n_ctx, jint n_threads,
                                                jstring dir) {
    (void) clase;
    const char *r = NULL;
    const char *d = NULL;
    if (ruta != NULL) {
        r = (*env)->GetStringUTFChars(env, ruta, NULL);
    }
    if (dir != NULL) {
        d = (*env)->GetStringUTFChars(env, dir, NULL);
    }

    if (d != NULL) {
        fc_iniciar_ruta(d);
    }

    char err[512];
    err[0] = '\0';
    void *handle = fc_cargar(r, (int) n_ctx, (int) n_threads, err, (int) sizeof(err));

    char salida[1024];
    char error_json[1024];
    json_escape(err, error_json, sizeof(error_json));
    snprintf(salida, sizeof(salida),
             "{\"ok\":%s,\"handle\":%lld,\"error\":\"%s\"}",
             handle != NULL ? "true" : "false",
             (long long) (intptr_t) handle,
             error_json);

    if (r != NULL) {
        (*env)->ReleaseStringUTFChars(env, ruta, r);
    }
    if (d != NULL) {
        (*env)->ReleaseStringUTFChars(env, dir, d);
    }
    return nuevo_json(env, salida);
}

JNIEXPORT jstring JNICALL
Java_cl_fabrick_core_RuntimeNativo_infoNativo(JNIEnv *env, jclass clase, jlong handle) {
    (void) clase;
    char buf[1024];
    buf[0] = '\0';
    int rc = fc_info((void *) (intptr_t) handle, buf, (int) sizeof(buf));
    if (rc != 0) {
        return nuevo_json(env, "{\"ok\":false,\"error\":\"handle nativo inválido\"}");
    }
    /* fc_info ya devuelve un objeto JSON; se le agrega el campo ok. */
    char salida[1200];
    snprintf(salida, sizeof(salida), "{\"ok\":true,%s", buf[0] == '{' ? buf + 1 : buf);
    return nuevo_json(env, salida);
}

JNIEXPORT jstring JNICALL
Java_cl_fabrick_core_RuntimeNativo_generarNativo(JNIEnv *env, jclass clase,
                                                 jlong handle, jstring prompt, jint max_tokens) {
    (void) clase;
    if (prompt == NULL) {
        return nuevo_json(env, "{\"ok\":false,\"error\":\"prompt vacío\"}");
    }
    const char *p = (*env)->GetStringUTFChars(env, prompt, NULL);
    if (p == NULL) {
        return nuevo_json(env, "{\"ok\":false,\"error\":\"no se pudo leer el prompt\"}");
    }

    int max = (int) max_tokens;
    if (max < 1) max = 1;
    if (max > 1024) max = 1024;

    char *out = (char *) malloc(8192);
    if (out == NULL) {
        (*env)->ReleaseStringUTFChars(env, prompt, p);
        return nuevo_json(env, "{\"ok\":false,\"error\":\"sin memoria para la salida\"}");
    }
    out[0] = '\0';
    int generados = 0;
    int n_prompt = 0;
    int cancelado = 0;
    int reutilizados = 0;
    double ms = 0.0;
    double ms_primer = 0.0;
    int rc = fc_generar((void *) (intptr_t) handle, p, max, NULL, NULL, out, 8192,
                        &generados, &n_prompt, &ms, &ms_primer, &cancelado, &reutilizados);

    (*env)->ReleaseStringUTFChars(env, prompt, p);

    if (rc < 0) {
        free(out);
        const char *motivo = "error desconocido";
        switch (rc) {
            case -1: motivo = "modelo o prompt inválido"; break;
            case -2: motivo = "sin memoria para tokenizar"; break;
            case -3: motivo = "no se pudo tokenizar el prompt"; break;
            case -4: motivo = "el prompt quedó vacío"; break;
            case -5: motivo = "prompt + respuesta superan el contexto (sube n_ctx o acorta el mensaje)"; break;
            case -6: motivo = "llama_decode falló (memoria insuficiente)"; break;
            default: break;
        }
        char salida[512];
        snprintf(salida, sizeof(salida),
                 "{\"ok\":false,\"error\":\"%s\",\"codigo\":%d}", motivo, rc);
        return nuevo_json(env, salida);
    }

    size_t n = strlen(out);
    char *escapado = (char *) malloc(n * 2 + 128);
    if (escapado == NULL) {
        free(out);
        return nuevo_json(env, "{\"ok\":false,\"error\":\"sin memoria para escapar la salida\"}");
    }
    json_escape(out, escapado, n * 2 + 128);
    size_t largo = n * 2 + 512;
    char *salida = (char *) malloc(largo);
    if (salida == NULL) {
        free(escapado);
        free(out);
        return nuevo_json(env, "{\"ok\":false,\"error\":\"sin memoria para el JSON\"}");
    }
    snprintf(salida, largo,
             "{\"ok\":true,\"texto\":\"%s\",\"tokens\":%d,\"ms\":%.1f,"
             "\"ms_primer\":%.1f,\"prompt\":%d,\"reutilizados\":%d,\"cancelado\":%s}",
             escapado, generados, ms, ms_primer, n_prompt, reutilizados,
             cancelado ? "true" : "false");
    jstring resultado = nuevo_json(env, salida);
    free(salida);
    free(escapado);
    free(out);
    return resultado;
}

/* Generación con streaming: cada trozo de texto se entrega al objeto Java
 * `callback.pieza(byte[] utf8, int tokens)`. El texto viaja como bytes UTF-8
 * para no depender del "modified UTF-8" de JNI (rompe emojis y algunos
 * caracteres de 4 bytes). */
JNIEXPORT jstring JNICALL
Java_cl_fabrick_core_RuntimeNativo_generarStreamNativo(JNIEnv *env, jclass clase,
                                                       jlong handle, jstring prompt,
                                                       jint max_tokens, jobject callback) {
    (void) clase;
    if (prompt == NULL) {
        return nuevo_json(env, "{\"ok\":false,\"error\":\"prompt vacío\"}");
    }
    const char *p = (*env)->GetStringUTFChars(env, prompt, NULL);
    if (p == NULL) {
        return nuevo_json(env, "{\"ok\":false,\"error\":\"no se pudo leer el prompt\"}");
    }

    int max = (int) max_tokens;
    if (max < 1) max = 1;
    if (max > 1024) max = 1024;

    char *out = (char *) malloc(16384);
    if (out == NULL) {
        (*env)->ReleaseStringUTFChars(env, prompt, p);
        return nuevo_json(env, "{\"ok\":false,\"error\":\"sin memoria para la salida\"}");
    }
    out[0] = '\0';

    fc_puente puente;
    puente.env = env;
    puente.cb = NULL;
    puente.metodo = NULL;
    if (callback != NULL) {
        jclass cls = (*env)->GetObjectClass(env, callback);
        if (cls != NULL) {
            puente.metodo = (*env)->GetMethodID(env, cls, "pieza", "([BI)V");
            (*env)->DeleteLocalRef(env, cls);
        }
        if (puente.metodo != NULL) {
            puente.cb = callback;
        }
    }

    int generados = 0;
    int n_prompt = 0;
    int cancelado = 0;
    int reutilizados = 0;
    double ms = 0.0;
    double ms_primer = 0.0;
    int rc = fc_generar((void *) (intptr_t) handle, p, max,
                        puente.metodo != NULL ? puente_pieza : NULL,
                        puente.metodo != NULL ? (void *) &puente : NULL,
                        out, 16384,
                        &generados, &n_prompt, &ms, &ms_primer,
                        &cancelado, &reutilizados);

    (*env)->ReleaseStringUTFChars(env, prompt, p);

    if (rc < 0) {
        free(out);
        const char *motivo = "error desconocido";
        switch (rc) {
            case -1: motivo = "modelo o prompt inválido"; break;
            case -2: motivo = "sin memoria para tokenizar"; break;
            case -3: motivo = "no se pudo tokenizar el prompt"; break;
            case -4: motivo = "el prompt quedó vacío"; break;
            case -5: motivo = "el prompt ya llena el contexto (acorta la charla)"; break;
            case -6: motivo = "llama_decode falló (memoria insuficiente)"; break;
            case -7: motivo = "no queda espacio para la respuesta (sube n_ctx o acorta la charla)"; break;
            case -8: motivo = "sin memoria para el índice de contexto"; break;
            default: break;
        }
        char salida[512];
        snprintf(salida, sizeof(salida),
                 "{\"ok\":false,\"error\":\"%s\",\"codigo\":%d}", motivo, rc);
        return nuevo_json(env, salida);
    }

    size_t n = strlen(out);
    char *escapado = (char *) malloc(n * 2 + 128);
    if (escapado == NULL) {
        free(out);
        return nuevo_json(env, "{\"ok\":false,\"error\":\"sin memoria para escapar la salida\"}");
    }
    json_escape(out, escapado, n * 2 + 128);
    size_t largo = n * 2 + 512;
    char *salida = (char *) malloc(largo);
    if (salida == NULL) {
        free(escapado);
        free(out);
        return nuevo_json(env, "{\"ok\":false,\"error\":\"sin memoria para el JSON\"}");
    }
    snprintf(salida, largo,
             "{\"ok\":true,\"texto\":\"%s\",\"tokens\":%d,\"ms\":%.1f,"
             "\"ms_primer\":%.1f,\"prompt\":%d,\"reutilizados\":%d,\"cancelado\":%s}",
             escapado, generados, ms, ms_primer, n_prompt, reutilizados,
             cancelado ? "true" : "false");
    jstring resultado = nuevo_json(env, salida);
    free(salida);
    free(escapado);
    free(out);
    return resultado;
}

JNIEXPORT jstring JNICALL
Java_cl_fabrick_core_RuntimeNativo_configurarNativo(JNIEnv *env, jclass clase,
                                                    jlong handle, jfloat temp, jfloat top_p,
                                                    jint top_k, jfloat repetir, jlong semilla) {
    (void) clase;
    int rc = fc_configurar((void *) (intptr_t) handle, (float) temp, (float) top_p,
                           (int) top_k, (float) repetir, (uint32_t) semilla);
    char salida[128];
    snprintf(salida, sizeof(salida), "{\"ok\":%s,\"rc\":%d}", rc == 0 ? "true" : "false", rc);
    return nuevo_json(env, salida);
}

JNIEXPORT jstring JNICALL
Java_cl_fabrick_core_RuntimeNativo_detenerNativo(JNIEnv *env, jclass clase, jlong handle) {
    (void) clase;
    int rc = fc_detener((void *) (intptr_t) handle);
    char salida[128];
    snprintf(salida, sizeof(salida), "{\"ok\":%s,\"rc\":%d}", rc == 0 ? "true" : "false", rc);
    return nuevo_json(env, salida);
}

JNIEXPORT jstring JNICALL
Java_cl_fabrick_core_RuntimeNativo_estadoCtxNativo(JNIEnv *env, jclass clase, jlong handle) {
    (void) clase;
    int kv = 0;
    int n_ctx = 0;
    int rc = fc_estado_ctx((void *) (intptr_t) handle, &kv, &n_ctx);
    char salida[160];
    snprintf(salida, sizeof(salida),
             "{\"ok\":%s,\"kv\":%d,\"n_ctx\":%d}", rc == 0 ? "true" : "false", kv, n_ctx);
    return nuevo_json(env, salida);
}

JNIEXPORT void JNICALL
Java_cl_fabrick_core_RuntimeNativo_liberarNativo(JNIEnv *env, jclass clase, jlong handle) {
    (void) env;
    (void) clase;
    fc_liberar((void *) (intptr_t) handle);
}
