package com.cincee.ps.gos

import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/*
 * Why this file exists (V1.33, the developer: "Make it so the background videos are also available on mobile").
 * Up to V1.32 every 1.5 MB piece of a background video was sealed and opened with the device key IN the
 * hardware Keystore (StrongBox, the Titan chip, on the Pixel). That chip is made for small secrets: a
 * piece took seconds, the player starved and the background never played. The 2 Nov 2026 freeze log shows
 * five WebView threads waiting in keystore2 on video pieces. Now:
 *  - one random 256 bit video key per phone, sealed by the Keystore device key in bg.key (ONE Keystore
 *    call per PS start), pieces sealed with it in software (AES-256-GCM, a fresh 12 byte IV each, the
 *    video id and piece number as AAD so a piece cannot be moved to another place). The files on disk are
 *    still ciphertext; the key is in PS's memory only while PS runs, like the vault key in the page.
 *  - the player gets byte ranges (206), so an mp4 whose index is at the end (a phone camera file) still
 *    plays, and a loop or a seek never reads the whole video again.
 * Plain JVM code (no Android classes), so the unit tests run it as is.
 */
object VideoCrypt {
    /** 12 byte IV in front, 16 byte tag at the end. */
    const val OVERHEAD = 28
    private val rnd = SecureRandom()

    fun newKey(): ByteArray = ByteArray(32).also { rnd.nextBytes(it) }

    fun seal(key: ByteArray, id: String, index: Int, plain: ByteArray): ByteArray {
        val iv = ByteArray(12).also { rnd.nextBytes(it) }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        c.updateAAD(aad(id, index))
        return iv + c.doFinal(plain)
    }

    fun open(key: ByteArray, id: String, index: Int, sealed: ByteArray): ByteArray {
        require(sealed.size >= OVERHEAD) { "piece too short" }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, sealed, 0, 12))
        c.updateAAD(aad(id, index))
        return c.doFinal(sealed, 12, sealed.size - 12)
    }

    private fun aad(id: String, index: Int) = "ps-bg:$id:$index".toByteArray()
}

/** One byte range of a video, both ends included. */
data class ByteSpan(val start: Long, val end: Long) { val length get() = end - start + 1 }

object VideoRange {
    /**
     * The player's Range header against a video of `size` bytes: the whole video when there is no header
     * or it is not one we understand (200), the span asked for (206), or null when it starts past the end
     * (416). Only the first span of a multi span header is served.
     */
    fun parse(header: String?, size: Long): Result {
        if (size <= 0) return Result.Bad
        val h = header?.trim()?.lowercase() ?: return Result.Whole
        if (!h.startsWith("bytes=")) return Result.Whole
        val first = h.removePrefix("bytes=").substringBefore(',').trim()
        val dash = first.indexOf('-')
        if (dash < 0) return Result.Whole
        val a = first.substring(0, dash).trim(); val b = first.substring(dash + 1).trim()
        return when {
            a.isEmpty() && b.isEmpty() -> Result.Whole
            a.isEmpty() -> {   // the last N bytes
                val n = b.toLongOrNull() ?: return Result.Whole
                if (n <= 0) Result.Bad else Result.Part(ByteSpan(maxOf(0, size - n), size - 1))
            }
            else -> {
                val s = a.toLongOrNull() ?: return Result.Whole
                val e = if (b.isEmpty()) size - 1 else (b.toLongOrNull() ?: return Result.Whole)
                if (s >= size || e < s) Result.Bad else Result.Part(ByteSpan(s, minOf(e, size - 1)))
            }
        }
    }

    sealed class Result {
        object Whole : Result()
        object Bad : Result()
        data class Part(val span: ByteSpan) : Result()
    }

    /** Where byte `at` is: the piece number and the offset inside it, from each piece's plain size. */
    fun locate(sizes: List<Long>, at: Long): Pair<Int, Int>? {
        var base = 0L
        for ((i, n) in sizes.withIndex()) {
            if (at < base + n) return i to (at - base).toInt()
            base += n
        }
        return null
    }
}
