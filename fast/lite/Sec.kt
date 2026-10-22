package cl.fabri.core.lite

import android.content.ContentValues
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec

/**
 * Seguridad del dispositivo.
 *
 *  · Contraseñas: PBKDF2-HMAC-SHA256 con sal aleatoria (nunca se guarda la clave).
 *  · Sesiones: token aleatorio de 256 bits; en la base solo vive su SHA-256.
 *  · Claves de proveedores de IA: cifradas con AES-256-GCM usando una clave que
 *    genera y custodia el Android Keystore (no exportable). El texto plano nunca
 *    se escribe en disco ni se muestra en pantalla.
 */
object Sec {

    private const val KS = "AndroidKeyStore"
    private const val ALIAS = "fabri_core_master"
    private const val ITER = 120_000
    private val rnd = SecureRandom()

    // ── aleatorios ────────────────────────────────────────────────────────
    fun token(bytes: Int = 32): String {
        val b = ByteArray(bytes); rnd.nextBytes(b)
        return Base64.encodeToString(b, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    }

    fun sha256(s: String): String =
        Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(s.toByteArray()), Base64.NO_WRAP)

    fun same(a: String, b: String): Boolean = MessageDigest.isEqual(a.toByteArray(), b.toByteArray())

    // ── contraseñas ───────────────────────────────────────────────────────
    fun newSalt(): String = token(16)

    fun hashPassword(pass: String, salt: String, iterations: Int = ITER): String {
        val spec = PBEKeySpec(pass.toCharArray(), salt.toByteArray(), iterations, 256)
        val k = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
        return Base64.encodeToString(k, Base64.NO_WRAP)
    }

    // ── clave maestra del Keystore ────────────────────────────────────────
    private fun master(): SecretKey {
        val ks = KeyStore.getInstance(KS).apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KS)
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return gen.generateKey()
    }

    /** Cifra y devuelve (cipher, iv) listos para guardar en la base. */
    fun encrypt(plain: String): Pair<String, String> {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, master())
        val out = c.doFinal(plain.toByteArray())
        return Base64.encodeToString(out, Base64.NO_WRAP) to Base64.encodeToString(c.iv, Base64.NO_WRAP)
    }

    fun decrypt(cipherB64: String, ivB64: String): String? = try {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, master(), GCMParameterSpec(128, Base64.decode(ivB64, Base64.NO_WRAP)))
        String(c.doFinal(Base64.decode(cipherB64, Base64.NO_WRAP)))
    } catch (_: Throwable) { null }

    fun mask(secret: String): String =
        if (secret.length <= 8) "••••" else secret.take(4) + "••••" + secret.takeLast(4)
}

/** Autenticación local con tokens persistidos en la base del dispositivo. */
class Auth(private val ctx: Context) {

    private val db = Db.get(ctx)
    private val prefs = ctx.getSharedPreferences("fabri_session", Context.MODE_PRIVATE)

    data class User(val id: Long, val email: String, val name: String, val role: String)

    fun userCount(): Long = db.scalar("SELECT COUNT(*) FROM users").toLongOrNull() ?: 0L

    fun register(email: String, name: String, pass: String): Result<User> = runCatching {
        require(email.contains("@")) { "El correo no parece válido" }
        require(pass.length >= 8) { "La contraseña necesita al menos 8 caracteres" }
        if (db.scalar("SELECT COUNT(*) FROM users WHERE email = ?", arrayOf(email.trim().lowercase())).toInt() > 0)
            error("Ese correo ya está registrado en este dispositivo")

        val salt = Sec.newSalt()
        val hash = Sec.hashPassword(pass, salt)
        val now = System.currentTimeMillis()
        val id = db.writableDatabase.insertOrThrow("users", null, ContentValues().apply {
            put("email", email.trim().lowercase()); put("name", name.trim().ifBlank { email.substringBefore("@") })
            put("pass_hash", hash); put("pass_salt", salt); put("iterations", Sec_iterations())
            put("role", if (userCount() == 0L) "owner" else "member"); put("created_at", now)
        })
        db.log("info", "auth", "usuario creado #$id")
        db.audit(email, "registro", "alta de usuario")
        User(id, email.trim().lowercase(), name.ifBlank { email.substringBefore("@") }, "owner")
    }

    private fun Sec_iterations() = 120_000

    fun login(email: String, pass: String): Result<Pair<User, String>> = runCatching {
        val (_, rows) = db.raw(
            "SELECT id, email, name, role, pass_hash, pass_salt, iterations FROM users WHERE email = ?",
            arrayOf(email.trim().lowercase())
        )
        val r = rows.firstOrNull() ?: error("No existe una cuenta con ese correo en este dispositivo")
        val it = (r[6].toIntOrNull() ?: 120_000)
        val calc = Sec.hashPassword(pass, r[5], it)
        if (!Sec.same(calc, r[4])) {
            db.log("warn", "auth", "intento fallido para $email")
            error("Contraseña incorrecta")
        }
        val user = User(r[0].toLong(), r[1], r[2], r[3])
        val token = Sec.token()
        val exp = System.currentTimeMillis() + 30L * 24 * 3600 * 1000
        db.writableDatabase.insertOrThrow("sessions", null, ContentValues().apply {
            put("user_id", user.id); put("token_hash", Sec.sha256(token))
            put("device", android.os.Build.MODEL); put("created_at", System.currentTimeMillis()); put("expires_at", exp)
        })
        db.writableDatabase.update("users", ContentValues().apply { put("last_login", System.currentTimeMillis()) }, "id = ?", arrayOf(user.id.toString()))
        prefs.edit().putString("token", token).putLong("uid", user.id).apply()
        db.log("info", "auth", "sesión iniciada: ${user.email}")
        db.audit(user.email, "login", "token emitido")
        user to token
    }

    fun current(): User? = try {
        val token = prefs.getString("token", null) ?: return null
        val (_, rows) = db.raw(
            """SELECT u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
               WHERE s.token_hash = ? AND s.revoked = 0 AND s.expires_at > ? LIMIT 1""",
            arrayOf(Sec.sha256(token), System.currentTimeMillis().toString())
        )
        rows.firstOrNull()?.let { User(it[0].toLong(), it[1], it[2], it[3]) }
    } catch (_: Throwable) { null }

    fun logout() {
        prefs.getString("token", null)?.let { t ->
            db.exec("UPDATE sessions SET revoked = 1 WHERE token_hash = '${Sec.sha256(t)}'")
            db.audit(null, "logout", "token revocado")
        }
        prefs.edit().remove("token").apply()
    }

    fun sessions(): List<List<String>> =
        db.raw("""SELECT s.id, u.email, s.device, s.created_at, s.expires_at, s.revoked
                  FROM sessions s JOIN users u ON u.id = s.user_id ORDER BY s.id DESC LIMIT 30""").second
}

/** Bóveda de claves de proveedores: cifradas con Keystore, jamás en claro. */
class Vault(private val ctx: Context) {

    private val db = Db.get(ctx)

    data class Provider(
        val id: String, val name: String, val kind: String, val baseUrl: String,
        val models: List<String>, val free: Boolean, val docs: String
    )

    data class Key(
        val id: Long, val provider: String, val label: String, val baseUrl: String,
        val model: String, val masked: String, val active: Boolean, val updatedAt: Long
    )

    fun save(provider: String, secret: String, baseUrl: String, model: String, label: String): Result<Long> = runCatching {
        require(secret.length >= 8) { "La clave es demasiado corta" }
        val (cipher, iv) = Sec.encrypt(secret.trim())
        val now = System.currentTimeMillis()
        val id = db.writableDatabase.insertOrThrow("api_keys", null, ContentValues().apply {
            put("provider", provider); put("label", label); put("base_url", baseUrl)
            put("model", model); put("cipher", cipher); put("iv", iv)
            put("masked", Sec.mask(secret.trim())); put("active", 1)
            put("created_at", now); put("updated_at", now)
        })
        db.audit(null, "clave_guardada", "$provider · ${Sec.mask(secret.trim())}")
        db.log("info", "vault", "clave cifrada para $provider")
        id
    }

    fun list(): List<Key> = try {
        db.raw("""SELECT id, provider, label, base_url, model, masked, active, updated_at
                  FROM api_keys ORDER BY provider, id DESC""").second.map {
            Key(it[0].toLong(), it[1], it[2], it[3], it[4], it[5], it[6] == "1", it[7].toLongOrNull() ?: 0L)
        }
    } catch (_: Throwable) { emptyList() }

    /** Descifra solo en memoria, para la llamada. Nunca se muestra ni se registra. */
    fun secret(id: Long): String? = try {
        val (_, rows) = db.raw("SELECT cipher, iv FROM api_keys WHERE id = ? AND active = 1", arrayOf(id.toString()))
        rows.firstOrNull()?.let { Sec.decrypt(it[0], it[1]) }
    } catch (_: Throwable) { null }

    fun remove(id: Long) {
        db.exec("UPDATE api_keys SET active = 0, updated_at = ${System.currentTimeMillis()} WHERE id = $id")
        db.audit(null, "clave_revocada", "#$id")
    }

    companion object {
        /** Catálogo real de proveedores: endpoints y modelos que existen hoy. */
        val PROVIDERS = listOf(
            Provider("openai", "OpenAI", "openai", "https://api.openai.com/v1",
                listOf("gpt-4o-mini", "gpt-4o", "o4-mini"), false, "platform.openai.com/api-keys"),
            Provider("anthropic", "Anthropic", "anthropic", "https://api.anthropic.com/v1",
                listOf("claude-3-5-haiku-latest", "claude-3-7-sonnet-latest"), false, "console.anthropic.com"),
            Provider("google", "Google Gemini", "google", "https://generativelanguage.googleapis.com/v1beta",
                listOf("gemini-2.0-flash", "gemini-2.5-flash"), true, "aistudio.google.com/apikey"),
            Provider("groq", "Groq", "openai", "https://api.groq.com/openai/v1",
                listOf("llama-3.3-70b-versatile", "llama-3.1-8b-instant"), true, "console.groq.com/keys"),
            Provider("openrouter", "OpenRouter", "openai", "https://openrouter.ai/api/v1",
                listOf("deepseek/deepseek-chat", "meta-llama/llama-3.3-70b-instruct:free"), true, "openrouter.ai/keys"),
            Provider("mistral", "Mistral", "openai", "https://api.mistral.ai/v1",
                listOf("mistral-small-latest", "open-mistral-nemo"), false, "console.mistral.ai"),
            Provider("deepseek", "DeepSeek", "openai", "https://api.deepseek.com/v1",
                listOf("deepseek-chat", "deepseek-reasoner"), false, "platform.deepseek.com"),
            Provider("together", "Together", "openai", "https://api.together.xyz/v1",
                listOf("meta-llama/Llama-3.3-70B-Instruct-Turbo"), false, "api.together.ai"),
            Provider("ollama", "Ollama (local)", "openai", "http://127.0.0.1:11434/v1",
                listOf("llama3.2", "qwen2.5"), true, "ollama.com")
        )

        fun provider(id: String): Provider? = PROVIDERS.firstOrNull { it.id == id }
    }
}
