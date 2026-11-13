package com.cincee.ps.gos

import android.content.Context
import android.webkit.WebResourceResponse
import org.json.JSONArray
import java.io.ByteArrayInputStream
import java.io.File

/**
 * the developer's own background videos on this phone. They arrive from his vault (decrypted by the page with
 * the vault key) piece by piece and are stored here sealed again, so the files in PS's private storage
 * are ciphertext too. Played back at /client/bg/<id>.mp4, with byte ranges.
 *
 * V1.33: the pieces are sealed with this phone's own video key in software (VideoCrypt.kt), not in the
 * hardware Keystore: there a 1.5 MB piece took seconds, so the background never played. The video key
 * itself is sealed by the Keystore device key in bg.key and opened once per PS start. Pieces of the
 * old kind ("N.bin", V1.16 to V1.32) are dropped, so each video downloads once more.
 */
object BgStore {
    private val ID = Regex("^[a-z0-9-]{1,48}$")
    private const val EXT = ".p"
    private fun dir(c: Context, id: String) = File(c.filesDir, "bg/$id")
    private fun piece(d: File, i: Int) = File(d, "$i$EXT")

    @Volatile private var vkey: ByteArray? = null
    /** This phone's video key: made once, kept sealed by the Keystore. Never on the main thread (Keys.gate). */
    @Synchronized private fun key(c: Context): ByteArray {
        vkey?.let { return it }
        val f = File(c.filesDir, "bg.key")
        // A busy Keystore throws something else and is tried again next time; only a missing file or a
        // wrong device key (it was made again) means a new video key.
        val old = if (f.exists()) try { Keys.open(f.readBytes()) } catch (_: javax.crypto.AEADBadTagException) { null } else null
        val k = old?.takeIf { it.size == 32 } ?: run {
            // First use, or the device key is gone: a new key, and nothing sealed with an old one is kept.
            File(c.filesDir, "bg").deleteRecursively()
            val n = VideoCrypt.newKey()
            val tmp = File(c.filesDir, ".bg.key.tmp")
            tmp.writeBytes(Keys.seal(n))
            if (!tmp.renameTo(f)) { tmp.delete(); throw java.io.IOException("video key not saved") }
            n
        }
        vkey = k
        return k
    }

    fun put(c: Context, id: String, index: Int, total: Int, data: String) {
        if (!ID.matches(id) || index !in 0 until total || total > 400) return
        val k = key(c)
        val d = dir(c, id).apply { mkdirs() }
        // Written next to it, then renamed: a piece cut off half way (PS killed) is never served.
        val tmp = File(d, ".$index.tmp")
        tmp.writeBytes(VideoCrypt.seal(k, id, index, Keys.unb64(data)))
        if (!tmp.renameTo(piece(d, index))) { tmp.delete(); throw java.io.IOException("piece not saved") }
        File(d, "total").writeText(total.toString())
    }

    private fun complete(c: Context, id: String): Int? {
        val d = dir(c, id)
        val total = runCatching { File(d, "total").readText().toInt() }.getOrNull() ?: return null
        return if (total > 0 && (0 until total).all { piece(d, it).exists() }) total else null
    }

    /** The pieces already here of videos still coming (id -> piece numbers), so a download that
     *  stopped picks up where it stopped instead of downloading the whole video again (egress). */
    fun partial(c: Context, keep: JSONArray?): org.json.JSONObject {
        val out = org.json.JSONObject()
        for (id in ids(keep)) {
            if (complete(c, id) != null) continue
            val got = dir(c, id).listFiles()?.mapNotNull { f -> f.name.takeIf { it.endsWith(EXT) }?.removeSuffix(EXT)?.toIntOrNull() }?.sorted() ?: continue
            if (got.isNotEmpty()) out.put(id, JSONArray(got))
        }
        return out
    }

    /** Keeps the videos still in the vault, drops the rest (and old kind pieces), answers which ones are complete here.
     *  V1.47: the page also lists an older copy that stands in while its newer copy downloads (web
     *  src/core/bgvault.ts), so a replaced video no longer vanishes from the screen until the new one is in. */
    fun keep(c: Context, keep: JSONArray?): List<String> {
        val want = ids(keep)
        File(c.filesDir, "bg").listFiles()?.forEach { d ->
            if (d.name !in want) { Plog.i("bg video: dropped ${d.name} (no longer in the vault)"); d.deleteRecursively() }
            else d.listFiles()?.forEach { if (it.name.endsWith(".bin")) it.delete() }
        }
        return want.filter { complete(c, it) != null }
    }

    @Volatile private var keyFailedAt = 0L
    /** The video key for the player, tried up to 3 times (0.3 s, 0.6 s apart). A log line when it fails and when it is back. */
    private fun playerKey(c: Context): ByteArray? {
        val k = KeyRetry.run(3, { 300L * it }, onFail = { n, e ->
            if (keyFailedAt == 0L) keyFailedAt = System.currentTimeMillis()
            Plog.i("bg video: key not ready, try $n (${e.javaClass.simpleName})")
        }) { key(c) }
        if (k != null && keyFailedAt != 0L) { Plog.i("bg video: key ready again after ${System.currentTimeMillis() - keyFailedAt} ms"); keyFailedAt = 0L }
        if (k == null) Plog.i("bg video: key still not ready, the page tries again later")
        return k
    }

    private fun ids(keep: JSONArray?) = (0 until (keep?.length() ?: 0)).map { keep!!.optString(it) }.filter { ID.matches(it) }.toSet()

    /**
     * The video for the player. `range` is the request's Range header: the player asks for parts (the
     * index at the end of an mp4, a loop back to the start), and gets only those pieces opened.
     * This runs on WebView's own threads, never the main thread.
     */
    fun serve(c: Context, file: String, range: String?, headers: Map<String, String>): WebResourceResponse? {
        val id = file.removeSuffix(".mp4")
        if (!ID.matches(id)) return null
        val total = complete(c, id) ?: run {
            Plog.i("bg video: $id asked for but not all here")
            return WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers, ByteArrayInputStream(ByteArray(0)))
        }
        val d = dir(c, id)
        // V1.47: a busy Keystore on the first ask after PS starts used to answer 503 once, and the player gave up for
        // good (the background "just stops"). Now the key is tried again a few times here (WebView's own thread, never
        // the main one), and the page reloads the video if it still fails (src/core/bgwatch.ts).
        val k = playerKey(c) ?: return WebResourceResponse("text/plain", "utf-8", 503, "Not Ready", headers, ByteArrayInputStream(ByteArray(0)))
        val sizes = (0 until total).map { maxOf(0L, piece(d, it).length() - VideoCrypt.OVERHEAD) }
        val size = sizes.sum()
        val open = { i: Int ->
            try { VideoCrypt.open(k, id, i, piece(d, i).readBytes()) }
            catch (e: Exception) { Plog.i("bg video: piece $i of $id could not be opened (${e.javaClass.simpleName})"); throw java.io.IOException("piece $i", e) }
        }
        val h = headers + mapOf("Accept-Ranges" to "bytes")
        return when (val r = VideoRange.parse(range, size)) {
            VideoRange.Result.Bad -> WebResourceResponse("video/mp4", null, 416, "Range Not Satisfiable",
                h + mapOf("Content-Range" to "bytes */$size"), ByteArrayInputStream(ByteArray(0)))
            VideoRange.Result.Whole -> WebResourceResponse("video/mp4", null, 200, "OK",
                h + mapOf("Content-Length" to size.toString()), PieceStream(total, open = open))
            is VideoRange.Result.Part -> {
                val (first, skip) = VideoRange.locate(sizes, r.span.start) ?: return WebResourceResponse("video/mp4", null, 416, "Range Not Satisfiable",
                    h + mapOf("Content-Range" to "bytes */$size"), ByteArrayInputStream(ByteArray(0)))
                WebResourceResponse("video/mp4", null, 206, "Partial Content",
                    h + mapOf("Content-Range" to "bytes ${r.span.start}-${r.span.end}/$size", "Content-Length" to r.span.length.toString()),
                    PieceStream(total, first, skip, r.span.length, open))
            }
        }
    }
}

/** Tries `f` up to `tries` times, waiting `wait(n)` ms after failure number n. Null if every try failed. Pure (unit tested). */
object KeyRetry {
    fun <T> run(tries: Int, wait: (Int) -> Long, sleep: (Long) -> Unit = { Thread.sleep(it) }, onFail: (Int, Throwable) -> Unit = { _, _ -> }, f: () -> T): T? {
        for (n in 1..tries) {
            try { return f() } catch (e: Exception) {
                onFail(n, e)
                if (n < tries) sleep(wait(n))
            }
        }
        return null
    }
}
