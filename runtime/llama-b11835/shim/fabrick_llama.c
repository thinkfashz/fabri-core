/*
 * FABRI-CORE · shim C sobre la API de llama.cpp (b11835)
 * -------------------------------------------------------------------------
 * Por qué existe: el núcleo Rust no puede replicar a mano las estructuras
 * `llama_model_params` / `llama_context_params` sin arriesgar un ABI distinto.
 * Este shim incluye el `llama.h` exacto del release y expone funciones simples
 * (punteros opacos + buffers de texto) que Rust llama por `dlopen`/`dlsym`.
 *
 * No ejecuta nada del manifiesto: los únicos insumos son una ruta a un GGUF ya
 * verificado y un prompt de texto. Sin shell, sin argumentos de línea de comandos.
 */
#include "llama.h"

#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

typedef struct fc_estado {
    struct llama_model   *modelo;
    struct llama_context *ctx;
    const struct llama_vocab *vocab;
    struct llama_sampler *sampler;
} fc_estado;

static pthread_mutex_t fc_lock = PTHREAD_MUTEX_INITIALIZER;
static int fc_iniciado = 0;

const char *fc_version(void) {
    return llama_version();
}

const char *fc_sistema(void) {
    return llama_print_system_info();
}

/*
 * A2: además de inicializar llama.cpp hay que registrar los backends GGML.
 * En esta APK los backends CPU viven en `nativeLibraryDir`, no en el directorio
 * de trabajo. Sin cargarlos, llama_model_load_from_file falla con
 * "no backends are loaded". La ruta la pasa Java desde ApplicationInfo.
 */
int fc_iniciar_ruta(const char *dir) {
    pthread_mutex_lock(&fc_lock);
    if (!fc_iniciado) {
        llama_backend_init();
        if (dir != NULL && dir[0] != '\0') {
            ggml_backend_load_all_from_path(dir);
        } else {
            ggml_backend_load_all();
        }
        fc_iniciado = 1;
    }
    pthread_mutex_unlock(&fc_lock);
    return 0;
}

int fc_iniciar(void) {
    return fc_iniciar_ruta(NULL);
}

static void fc_error(char *err, int errlen, const char *texto) {
    if (err != NULL && errlen > 0) {
        snprintf(err, (size_t) errlen, "%s", texto != NULL ? texto : "error desconocido");
    }
}

void *fc_cargar(const char *ruta, int n_ctx, int n_threads, char *err, int errlen) {
    if (ruta == NULL || ruta[0] == '\0') {
        fc_error(err, errlen, "ruta vacía");
        return NULL;
    }
    if (n_ctx < 128) {
        n_ctx = 512;
    }
    if (n_threads < 1) {
        n_threads = 2;
    }

    /* Si Java no llamó fc_iniciar_ruta, al menos intenta el descubrimiento
     * automático. La ruta explícita se prefiere porque en Android el cwd no es
     * el directorio nativo de la APK. */
    fc_iniciar_ruta(NULL);

    pthread_mutex_lock(&fc_lock);

    struct llama_model_params mp = llama_model_default_params();
    mp.n_gpu_layers = 0;          /* sólo CPU: no hay GPU expuesta por el NDK */
    mp.use_extra_bufts = false;   /* sin repacking extra: menos memoria */

    struct llama_model *modelo = llama_model_load_from_file(ruta, mp);
    if (modelo == NULL) {
        pthread_mutex_unlock(&fc_lock);
        fc_error(err, errlen, "llama_model_load_from_file devolvió NULL (archivo ilegible, formato o memoria)");
        return NULL;
    }

    struct llama_context_params cp = llama_context_default_params();
    cp.n_ctx = (uint32_t) n_ctx;
    cp.n_batch = 256;
    /* n_ubatch no puede superar n_batch; el default de llama.cpp es 512 y
     * con n_batch=256 algunas versiones rechazan el contexto. */
    cp.n_ubatch = 256;
    cp.n_threads = n_threads;
    cp.n_threads_batch = n_threads;

    struct llama_context *ctx = llama_init_from_model(modelo, cp);
    if (ctx == NULL) {
        llama_model_free(modelo);
        pthread_mutex_unlock(&fc_lock);
        fc_error(err, errlen, "llama_init_from_model devolvió NULL (memoria insuficiente o contexto inválido)");
        return NULL;
    }

    fc_estado *est = (fc_estado *) calloc(1, sizeof(fc_estado));
    if (est == NULL) {
        llama_free(ctx);
        llama_model_free(modelo);
        pthread_mutex_unlock(&fc_lock);
        fc_error(err, errlen, "sin memoria para el estado del runtime");
        return NULL;
    }

    est->modelo = modelo;
    est->ctx = ctx;
    est->vocab = llama_model_get_vocab(modelo);

    struct llama_sampler_chain_params sp = llama_sampler_chain_default_params();
    sp.no_perf = true;
    est->sampler = llama_sampler_chain_init(sp);
    llama_sampler_chain_add(est->sampler, llama_sampler_init_greedy());

    pthread_mutex_unlock(&fc_lock);
    return est;
}

int fc_info(void *handle, char *buf, int buflen) {
    fc_estado *est = (fc_estado *) handle;
    if (est == NULL || est->modelo == NULL || buf == NULL || buflen <= 0) {
        return -1;
    }
    char desc[256];
    desc[0] = '\0';
    llama_model_desc(est->modelo, desc, sizeof(desc));
    for (size_t i = 0; desc[i] != '\0'; i++) {
        if (desc[i] == '"' || desc[i] == '\\' || desc[i] == '\n' || desc[i] == '\r') {
            desc[i] = ' ';
        }
    }
    snprintf(buf, (size_t) buflen,
             "{\"n_params\":%llu,\"n_vocab\":%d,\"n_ctx\":%u,\"desc\":\"%s\"}",
             (unsigned long long) llama_model_n_params(est->modelo),
             (int) llama_vocab_n_tokens(est->vocab),
             (unsigned) llama_n_ctx(est->ctx),
             desc);
    return 0;
}

int fc_generar(void *handle, const char *prompt, int max_tokens,
               char *out, int outlen, int *n_generados, double *ms) {
    fc_estado *est = (fc_estado *) handle;
    if (est == NULL || est->ctx == NULL || prompt == NULL || out == NULL || outlen <= 1) {
        return -1;
    }
    if (max_tokens < 1) {
        max_tokens = 1;
    }

    pthread_mutex_lock(&fc_lock);

    /* A3: cada turno parte de una memoria KV limpia. Si no se limpia, el
     * contexto se llena tras dos o tres mensajes y llama_decode falla. */
    llama_memory_t memoria = llama_get_memory(est->ctx);
    if (memoria != NULL) {
        llama_memory_clear(memoria, true);
    }

    int32_t n_max = (int32_t) strlen(prompt) + 16;
    llama_token *tokens = (llama_token *) malloc(sizeof(llama_token) * (size_t) n_max);
    if (tokens == NULL) {
        pthread_mutex_unlock(&fc_lock);
        return -2;
    }
    int32_t n_tok = llama_tokenize(est->vocab, prompt, (int32_t) strlen(prompt),
                                   tokens, n_max, false, true);
    if (n_tok < 0) {
        free(tokens);
        pthread_mutex_unlock(&fc_lock);
        return -3;
    }
    if (n_tok == 0) {
        free(tokens);
        pthread_mutex_unlock(&fc_lock);
        return -4;
    }

    uint32_t n_ctx = llama_n_ctx(est->ctx);
    if ((uint32_t) n_tok + (uint32_t) max_tokens + 4 > n_ctx) {
        free(tokens);
        pthread_mutex_unlock(&fc_lock);
        return -5;
    }

    /* Decodifica el prompt en trozos del tamaño de batch del contexto. */
    uint32_t n_batch = llama_n_batch(est->ctx);
    int32_t i = 0;
    while (i < n_tok) {
        int32_t n = (n_tok - i) < (int32_t) n_batch ? (n_tok - i) : (int32_t) n_batch;
        struct llama_batch lote = llama_batch_get_one(tokens + i, n);
        int32_t rc = llama_decode(est->ctx, lote);
        if (rc != 0) {
            free(tokens);
            pthread_mutex_unlock(&fc_lock);
            return -6;
        }
        i += n;
    }

    struct timespec t0, t1;
    clock_gettime(CLOCK_MONOTONIC, &t0);

    int usados = 0;
    int generados = 0;
    char pieza[256];

    while (generados < max_tokens && usados < outlen - 1) {
        llama_token id = llama_sampler_sample(est->sampler, est->ctx, -1);
        if (llama_vocab_is_eog(est->vocab, id)) {
            break;
        }
        llama_sampler_accept(est->sampler, id);

        int32_t n = llama_token_to_piece(est->vocab, id, pieza, (int32_t) sizeof(pieza), 0, true);
        if (n > 0) {
            int copiar = n;
            if (usados + copiar > outlen - 1) {
                copiar = outlen - 1 - usados;
            }
            memcpy(out + usados, pieza, (size_t) copiar);
            usados += copiar;
        }

        struct llama_batch lote = llama_batch_get_one(&id, 1);
        int32_t rc = llama_decode(est->ctx, lote);
        if (rc != 0) {
            break;
        }
        generados++;

        if (n > 0) {
            /* corta si el texto ya contiene el fin de turno de ChatML.
             * Los marcadores miden 10 y 13 bytes; no se recortan a mano:
             * RuntimeNativo también los limpia al recibir el texto. */
            if (usados >= 10 && memcmp(out + usados - 10, "<|im_end|>", 10) == 0) {
                usados -= 10;
                break;
            }
            if (usados >= 13 && memcmp(out + usados - 13, "<|endoftext|>", 13) == 0) {
                usados -= 13;
                break;
            }
        }
    }

    out[usados] = '\0';
    clock_gettime(CLOCK_MONOTONIC, &t1);
    double transcurrido = (double) (t1.tv_sec - t0.tv_sec) * 1000.0
                        + (double) (t1.tv_nsec - t0.tv_nsec) / 1000000.0;
    if (n_generados != NULL) {
        *n_generados = generados;
    }
    if (ms != NULL) {
        *ms = transcurrido;
    }

    free(tokens);
    pthread_mutex_unlock(&fc_lock);
    return usados;
}

void fc_liberar(void *handle) {
    fc_estado *est = (fc_estado *) handle;
    if (est == NULL) {
        return;
    }
    pthread_mutex_lock(&fc_lock);
    if (est->sampler != NULL) {
        llama_sampler_free(est->sampler);
        est->sampler = NULL;
    }
    if (est->ctx != NULL) {
        llama_free(est->ctx);
        est->ctx = NULL;
    }
    if (est->modelo != NULL) {
        llama_model_free(est->modelo);
        est->modelo = NULL;
    }
    pthread_mutex_unlock(&fc_lock);
    free(est);
}
