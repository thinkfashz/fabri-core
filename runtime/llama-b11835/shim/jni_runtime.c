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
extern int fc_generar(void *handle, const char *prompt, int max_tokens,
                      char *out, int outlen, int *n_generados, double *ms);
extern void fc_liberar(void *handle);

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
    if (max > 512) max = 512;

    char *out = (char *) malloc(8192);
    if (out == NULL) {
        (*env)->ReleaseStringUTFChars(env, prompt, p);
        return nuevo_json(env, "{\"ok\":false,\"error\":\"sin memoria para la salida\"}");
    }
    out[0] = '\0';
    int generados = 0;
    double ms = 0.0;
    int rc = fc_generar((void *) (intptr_t) handle, p, max, out, 8192, &generados, &ms);

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
             "{\"ok\":true,\"texto\":\"%s\",\"tokens\":%d,\"ms\":%.1f}",
             escapado, generados, ms);
    jstring resultado = nuevo_json(env, salida);
    free(salida);
    free(escapado);
    free(out);
    return resultado;
}

JNIEXPORT void JNICALL
Java_cl_fabrick_core_RuntimeNativo_liberarNativo(JNIEnv *env, jclass clase, jlong handle) {
    (void) env;
    (void) clase;
    fc_liberar((void *) (intptr_t) handle);
}
