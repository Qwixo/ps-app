package com.cincee.ps.gos

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Base64
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Keys in the phone's hardware Keystore (StrongBox, the Titan chip, when the phone has it). They
 * never leave the chip and never leave the phone.
 *  - FINGER: opens the remembered vault keys. Each use needs the fingerprint (or the phone PIN);
 *    a new fingerprint enrolled on the phone destroys it.
 *  - DEVICE: no prompt. Used only by PS's own background code: the copy of the vault keys for
 *    background checks (only while that setting is on), the short lived access token, the meeting
 *    schedule and the developer's background videos. Usable after the phone's first unlock since boot.
 * Never on the main thread: every call here waits on keystore2, which can take seconds when the phone is
 * busy (the 2 Nov 2026 freeze). Callers run on the bridge thread, the video thread or a worker.
 */
object Keys {
    private const val FINGER = "ps_gos_finger"
    private const val DEVICE = "ps_gos_device"

    /** Every Keystore call in PS goes through this gate: one at a time, never on the main thread (Bridge.kt). */
    val gate = KeyGate({ android.os.Looper.getMainLooper().isCurrentThread }, BuildConfig.DEBUG) { Plog.i(it) }

    // The handles are references to keys that stay in the chip (never key material), so keeping them
    // saves a call into keystore2 on every seal and open. Thread safe for the gate's release fallback.
    @Volatile private var store: KeyStore? = null
    private val handles = java.util.concurrent.ConcurrentHashMap<String, SecretKey>()
    /** The Keystore itself; call only inside [gate]. */
    internal fun ks(): KeyStore = store ?: KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.also { store = it }

    private fun make(alias: String, finger: Boolean): SecretKey {
        fun spec(strong: Boolean) = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setIsStrongBoxBacked(strong)
            .apply {
                if (finger) {
                    setUserAuthenticationRequired(true)
                    setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
                    setInvalidatedByBiometricEnrollment(true)
                }
            }.build()
        val g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        return try { g.init(spec(true)); g.generateKey() } catch (_: StrongBoxUnavailableException) { g.init(spec(false)); g.generateKey() }
            catch (_: Exception) { g.init(spec(false)); g.generateKey() }
    }
    private fun key(alias: String, finger: Boolean): SecretKey =
        handles[alias] ?: ((ks().getKey(alias, null) as SecretKey?) ?: make(alias, finger)).also { handles[alias] = it }

    // ---------- fingerprint key: ciphers handed to BiometricPrompt ----------
    // A new cipher (and IV) every time, as before: GCM must never reuse one. The step after the
    // fingerprint (doFinal) goes through the gate too, see Remember.
    fun fingerEncrypt(): Cipher = gate.run("finger encrypt") { Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key(FINGER, true)) } }
    fun fingerDecrypt(iv: ByteArray): Cipher = gate.run("finger decrypt") { Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(FINGER, true), GCMParameterSpec(128, iv)) } }
    fun dropFinger() { gate.run("finger drop") { handles.remove(FINGER); runCatching { ks().deleteEntry(FINGER) } } }

    // ---------- device key ----------
    fun seal(plain: ByteArray): ByteArray = gate.run("seal") {
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key(DEVICE, false)) }
        c.iv + c.doFinal(plain)   // 12 byte IV, then ciphertext and tag
    }
    fun open(sealed: ByteArray): ByteArray = gate.run("open") {
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(DEVICE, false), GCMParameterSpec(128, sealed, 0, 12)) }
        c.doFinal(sealed, 12, sealed.size - 12)
    }

    // ---------- small sealed files in the app's private storage ----------
    fun file(c: Context, name: String) = File(c.filesDir, "sealed").apply { mkdirs() }.resolve(name)
    fun write(c: Context, name: String, text: String) { file(c, name).writeBytes(seal(text.toByteArray())) }
    fun read(c: Context, name: String): String? = runCatching { open(file(c, name).readBytes()).toString(Charsets.UTF_8) }.getOrNull()
    fun delete(c: Context, name: String) { file(c, name).delete() }

    fun b64(b: ByteArray): String = Base64.encodeToString(b, Base64.NO_WRAP)
    fun unb64(s: String): ByteArray = Base64.decode(s, Base64.NO_WRAP)
}
