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
 *
 * A4 (chat rápido):
 *   · la memoria KV ya NO se borra en cada turno: se conserva el prefijo común
 *     y sólo se decodifica lo nuevo. En una charla de 3 turnos eso ahorra
 *     segundos de "prefill" en el teléfono;
 *   · el muestreo deja de ser greedy: temperatura, top-p, top-k y penalización
 *     de repetición configurables (greedy queda como caso temp = 0);
 *   · la generación avisa token a token por callback, así la interfaz escribe
 *     mientras el modelo piensa en vez de esperar el texto completo;
 *   · `fc_detener` corta en el siguiente token sin esperar al candado.
 */
#include "llama.h"

#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

/* Largo del marcador de fin más largo que se reconoce. Se retienen estos
 * bytes antes de pintar para que un marcador partido en dos tokens nunca
 * llegue a la pantalla. */
#define FC_RETENIDO 13

typedef void (*fc_pieza_cb)(void *ud, const char *texto, int n_bytes, int tokens);

typedef struct fc_estado {
    struct llama_model   *modelo;
    struct llama_context *ctx;
    const struct llama_vocab *vocab;
    struct llama_sampler *sampler;

    /* Tokens que ya viven en la memoria KV. Permite reusar el prefijo. */
    llama_token *kv;
    int32_t      kv_len;
    int32_t      kv_cap;

    /* Muestreo por turno. */
    float    temp;
    float    top_p;
    float    repetir;
    int32_t  top_k;
    uint32_t semilla;

    volatile int cancelar;
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

/* Cadena de muestreo: penalización → top-k → top-p → temperatura → distribución.
 * Con temp <= 0 se usa greedy y se ignora el resto, igual que llama.cpp. */
static struct llama_sampler *fc_sampler_nuevo(fc_estado *est) {
    struct llama_sampler_chain_params sp = llama_sampler_chain_default_params();
    sp.no_perf = true;
    struct llama_sampler *cadena = llama_sampler_chain_init(sp);
    if (cadena == NULL) {
        return NULL;
    }
    if (est->repetir > 1.0f) {
        llama_sampler_chain_add(cadena, llama_sampler_init_penalties(
            llama_vocab_n_tokens(est->vocab), 64, est->repetir, 0.0f, 0.0f));
    }
    if (est->temp <= 0.0f) {
        llama_sampler_chain_add(cadena, llama_sampler_init_greedy());
        return cadena;
    }
    if (est->top_k > 0) {
        llama_sampler_chain_add(cadena, llama_sampler_init_top_k(est->top_k));
    }
    if (est->top_p > 0.0f && est->top_p < 1.0f) {
        llama_sampler_chain_add(cadena, llama_sampler_init_top_p(est->top_p, 1));
    }
    llama_sampler_chain_add(cadena, llama_sampler_init_temp(est->temp));
    llama_sampler_chain_add(cadena, llama_sampler_init_dist(est->semilla));
    return cadena;
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
    est->kv_cap = (int32_t) llama_n_ctx(ctx);
    est->kv = (llama_token *) calloc((size_t) est->kv_cap, sizeof(llama_token));
    if (est->kv == NULL) {
        llama_free(ctx);
        llama_model_free(modelo);
        free(est);
        pthread_mutex_unlock(&fc_lock);
        fc_error(err, errlen, "sin memoria para el índice de contexto");
        return NULL;
    }
    est->kv_len = 0;

    /* Valores de arranque: charla natural sin dispararse. */
    est->temp = 0.5f;
    est->top_p = 0.9f;
    est->top_k = 10;
    est->repetir = 1.1f;
    est->semilla = LLAMA_DEFAULT_SEED;
    est->cancelar = 0;

    pthread_mutex_unlock(&fc_lock);
    return est;
}

/* La interfaz ajusta el muestreo por turno. No toma el candado: sólo escribe
 * campos que `fc_generar` lee al empezar, cuando ya tiene el candado. */
int fc_configurar(void *handle, float temp, float top_p, int top_k,
                  float repetir, uint32_t semilla) {
    fc_estado *est = (fc_estado *) handle;
    if (est == NULL) {
        return -1;
    }
    if (temp < 0.0f) temp = 0.0f;
    if (temp > 2.0f) temp = 2.0f;
    if (top_p <= 0.0f || top_p > 1.0f) top_p = 0.95f;
    if (top_k < 0) top_k = 0;
    if (top_k > 200) top_k = 200;
    if (repetir < 1.0f) repetir = 1.0f;
    if (repetir > 2.0f) repetir = 2.0f;
    est->temp = temp;
    est->top_p = top_p;
    est->top_k = top_k;
    est->repetir = repetir;
    est->semilla = semilla;
    return 0;
}

/* Corta la generación en curso. Se llama desde otro hilo: sólo toca un flag. */
int fc_detener(void *handle) {
    fc_estado *est = (fc_estado *) handle;
    if (est == NULL) {
        return -1;
    }
    est->cancelar = 1;
    return 0;
}

int fc_estado_ctx(void *handle, int *kv_len, int *n_ctx) {
    fc_estado *est = (fc_estado *) handle;
    if (est == NULL || est->ctx == NULL) {
        return -1;
    }
    if (kv_len != NULL) *kv_len = est->kv_len;
    if (n_ctx != NULL) *n_ctx = (int) llama_n_ctx(est->ctx);
    return 0;
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

/* Devuelve el largo del marcador de fin que cierra el texto, o 0. */
static int fc_marcador_final(const char *out, int usados) {
    static const char *marcadores[] = {
        "<|im_end|>", "<|endoftext|>", "<|eot_id|>", "<|end|>"
    };
    for (size_t m = 0; m < sizeof(marcadores) / sizeof(marcadores[0]); m++) {
        int largo = (int) strlen(marcadores[m]);
        if (usados >= largo && memcmp(out + usados - largo, marcadores[m], (size_t) largo) == 0) {
            return largo;
        }
    }
    return 0;
}

/*
 * Genera texto con streaming.
 *
 * Devuelve el largo escrito en `out` o un código negativo:
 *   -1 handle/prompt inválido   -2 sin memoria para tokenizar
 *   -3 no se pudo tokenizar     -4 prompt vacío
 *   -5 no cabe en el contexto   -6 llama_decode falló
 *   -7 contexto lleno           -8 sin memoria para el índice KV
 *
 * `reutilizados` informa cuántos tokens del prompt ya estaban en la KV: es la
 * métrica que explica por qué el segundo turno responde más rápido.
 */
int fc_generar(void *handle, const char *prompt, int max_tokens,
               fc_pieza_cb cb, void *ud,
               char *out, int outlen,
               int *n_generados, int *n_prompt,
               double *ms, double *ms_primer,
               int *cancelado, int *reutilizados) {
    fc_estado *est = (fc_estado *) handle;
    if (est == NULL || est->ctx == NULL || prompt == NULL || out == NULL || outlen <= 1) {
        return -1;
    }
    if (max_tokens < 1) {
        max_tokens = 1;
    }

    pthread_mutex_lock(&fc_lock);
    est->cancelar = 0;

    int32_t n_max = (int32_t) strlen(prompt) + 32;
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

    /* El cupo real lo manda el contexto, no el número que pide la interfaz. */
    int32_t n_ctx = (int32_t) llama_n_ctx(est->ctx);
    if (n_tok >= n_ctx - 8) {
        free(tokens);
        pthread_mutex_unlock(&fc_lock);
        return -5;
    }
    int cupo = n_ctx - n_tok - 4;
    if (max_tokens > cupo) {
        max_tokens = cupo;
    }
    if (max_tokens < 8) {
        free(tokens);
        pthread_mutex_unlock(&fc_lock);
        return -7;
    }

    if (est->kv == NULL || est->kv_cap < n_ctx) {
        llama_token *nuevo = (llama_token *) realloc(est->kv, sizeof(llama_token) * (size_t) n_ctx);
        if (nuevo == NULL) {
            free(tokens);
            pthread_mutex_unlock(&fc_lock);
            return -8;
        }
        est->kv = nuevo;
        est->kv_cap = n_ctx;
    }

    /* Prefijo común con lo que ya está en la KV. Si el prompt es idéntico se
     * retrocede un token para volver a calcular los logits del último. */
    int32_t comun = 0;
    int32_t minimo = n_tok < est->kv_len ? n_tok : est->kv_len;
    while (comun < minimo && tokens[comun] == est->kv[comun]) {
        comun++;
    }
    if (comun == n_tok && n_tok > 0) {
        comun = n_tok - 1;
    }

    llama_memory_t memoria = llama_get_memory(est->ctx);
    if (memoria != NULL && comun < est->kv_len) {
        if (!llama_memory_seq_rm(memoria, 0, comun, -1)) {
            /* No se pudo recortar: se empieza de cero, nunca se deja un estado
             * a medias que haría fallar el siguiente decode. */
            llama_memory_clear(memoria, true);
            comun = 0;
        }
    }
    est->kv_len = comun;

    /* Sólo se decodifica lo nuevo. */
    uint32_t n_batch = llama_n_batch(est->ctx);
    int32_t i = comun;
    while (i < n_tok) {
        int32_t n = (n_tok - i) < (int32_t) n_batch ? (n_tok - i) : (int32_t) n_batch;
        struct llama_batch lote = llama_batch_get_one(tokens + i, n);
        int32_t rc = llama_decode(est->ctx, lote);
        if (rc != 0) {
            free(tokens);
            pthread_mutex_unlock(&fc_lock);
            return -6;
        }
        for (int32_t k = 0; k < n; k++) {
            est->kv[est->kv_len++] = tokens[i + k];
        }
        i += n;
    }

    /* Sampler nuevo por turno: limpia el historial de penalización. */
    if (est->sampler != NULL) {
        llama_sampler_free(est->sampler);
        est->sampler = NULL;
    }
    est->sampler = fc_sampler_nuevo(est);
    if (est->sampler == NULL) {
        free(tokens);
        pthread_mutex_unlock(&fc_lock);
        return -1;
    }
    llama_sampler_reset(est->sampler);

    struct timespec t0, t1, tp;
    clock_gettime(CLOCK_MONOTONIC, &t0);
    double primer_ms = 0.0;
    int primer_token = 0;

    int usados = 0;
    int emitidos = 0;
    int generados = 0;
    int cortado = 0;
    char pieza[256];

    while (generados < max_tokens) {
        if (est->cancelar) {
            cortado = 1;
            break;
        }

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
            if (copiar > 0) {
                memcpy(out + usados, pieza, (size_t) copiar);
                usados += copiar;
            }

            /* Se retienen los últimos bytes para no pintar medio marcador. */
            while (cb != NULL && usados - emitidos > FC_RETENIDO) {
                int lote_cb = usados - FC_RETENIDO - emitidos;
                if (!primer_token) {
                    clock_gettime(CLOCK_MONOTONIC, &tp);
                    primer_ms = (double) (tp.tv_sec - t0.tv_sec) * 1000.0
                              + (double) (tp.tv_nsec - t0.tv_nsec) / 1000000.0;
                    primer_token = 1;
                }
                cb(ud, out + emitidos, lote_cb, generados);
                emitidos += lote_cb;
            }
        }

        /* El token generado entra a la KV para el siguiente turno. */
        if (est->kv_len < est->kv_cap) {
            est->kv[est->kv_len++] = id;
        }

        struct llama_batch lote = llama_batch_get_one(&id, 1);
        int32_t rc = llama_decode(est->ctx, lote);
        if (rc != 0) {
            break;
        }
        generados++;

        int marcador = fc_marcador_final(out, usados);
        if (marcador > 0) {
            usados -= marcador;
            break;
        }
        if (usados >= outlen - 1) {
            break;
        }
    }

    /* Si se cortó por marcador, lo retenido ya no debe salir. */
    if (usados > emitidos && cb != NULL) {
        if (!primer_token) {
            clock_gettime(CLOCK_MONOTONIC, &tp);
            primer_ms = (double) (tp.tv_sec - t0.tv_sec) * 1000.0
                      + (double) (tp.tv_nsec - t0.tv_nsec) / 1000000.0;
        }
        cb(ud, out + emitidos, usados - emitidos, generados);
        emitidos = usados;
    }

    out[usados] = '\0';
    clock_gettime(CLOCK_MONOTONIC, &t1);
    double transcurrido = (double) (t1.tv_sec - t0.tv_sec) * 1000.0
                        + (double) (t1.tv_nsec - t0.tv_nsec) / 1000000.0;

    if (n_generados != NULL) *n_generados = generados;
    if (n_prompt != NULL) *n_prompt = n_tok;
    if (ms != NULL) *ms = transcurrido;
    if (ms_primer != NULL) *ms_primer = primer_ms;
    if (cancelado != NULL) *cancelado = cortado;
    if (reutilizados != NULL) *reutilizados = comun;

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
    free(est->kv);
    est->kv = NULL;
    est->kv_len = 0;
    est->kv_cap = 0;
    pthread_mutex_unlock(&fc_lock);
    free(est);
}
