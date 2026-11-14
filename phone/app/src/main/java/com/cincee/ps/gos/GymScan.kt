package com.cincee.ps.gos

import android.content.Context
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.HandlerThread
import com.googlecode.tesseract.android.TessBaseAPI
import org.json.JSONObject
import java.io.File

/*
 * Gym scan (V1.59, the developer: "a text scan for the gym... PS reads the text on the phone"). The page (web
 * src/fitness/Scan.tsx, src/gos/gymscan.ts) takes one still from its own camera view, crops it to the frame and turns it
 * grey, and sends it here as a data URL. Tesseract (Tesseract4Android, Apache 2.0) reads it on the phone with the
 * German and English "fast" models bundled in assets/tessdata, and the text goes back to the page, which puts it into
 * English and finds the exercise (src/fitness/scan-logic.ts).
 *
 * Why Tesseract: it is open source, runs fully offline and needs no Google Play services (GrapheneOS). ML Kit's bundled
 * text model also runs without Play, but it is closed and reports usage to Google; Android itself has no text reader.
 *
 * Privacy: the picture is decoded in memory, read, and dropped (the bitmap is recycled at once). It is never written to
 * a file and never sent anywhere; this file has no network code. The log says how many letters were read, never what.
 * The reader works on its own thread (a read takes about a second), never the bridge or main thread, and lets its
 * memory go after 90 s without a scan.
 */
object GymScan {
    private const val LANGS = "deu+eng"
    private const val IDLE_MS = 90_000L
    private val thread = HandlerThread("ps-scan").apply { start() }
    private val h = Handler(thread.looper)
    private var tess: TessBaseAPI? = null   // only touched on the ps-scan thread
    @Volatile private var busy = false
    private val idle = Runnable { release() }
    private val ID = Regex("^[A-Za-z0-9_-]{1,40}$")

    /** True when the message was a Gym scan one. Called on the bridge thread; the work goes to the ps-scan thread. */
    fun handle(c: Context, type: String, m: JSONObject, post: (JSONObject) -> Unit): Boolean {
        when (type) {
            "gymscan:warm" -> h.post { runCatching { api(c) }; later() }
            "gymscan:read" -> {
                val id = m.optString("id")
                if (!ID.matches(id)) return true
                if (busy) { post(answer(id).put("error", "busy")); return true }
                busy = true
                val img = m.optString("img")
                h.post {
                    val out = try { read(c, id, img) } catch (e: Throwable) {
                        Plog.i("gymscan: failed (${e.javaClass.simpleName})"); answer(id).put("error", "failed")
                    }
                    busy = false
                    later()
                    post(out)
                }
            }
            else -> return false
        }
        return true
    }

    private fun answer(id: String) = JSONObject().put("type", "gymscan").put("id", id)

    private fun read(c: Context, id: String, img: String): JSONObject {
        val bytes = ScanText.bytes(img) ?: return answer(id).put("error", "image")
        val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return answer(id).put("error", "image")
        val t0 = System.currentTimeMillis()
        try {
            val t = api(c) ?: return answer(id).put("error", "model")
            t.setPageSegMode(TessBaseAPI.PageSegMode.PSM_AUTO)
            t.setImage(bmp)
            var text = words(t)
            var conf = t.meanConfidence()
            // A label with little text on it reads better as scattered words.
            if (ScanText.letters(text) < 4) {
                t.setPageSegMode(TessBaseAPI.PageSegMode.PSM_SPARSE_TEXT)
                t.setImage(bmp)
                val s = words(t)
                if (ScanText.letters(s) > ScanText.letters(text)) { text = s; conf = t.meanConfidence() }
            }
            t.clear()
            Plog.i("gymscan: ${ScanText.letters(text)} letters, confidence $conf, ${System.currentTimeMillis() - t0} ms")
            return answer(id).put("text", text).put("conf", conf)
        } finally {
            bmp.recycle()
        }
    }

    /** The words with how sure the reader is of each, unsure ones dropped (the specks a photo adds). */
    private fun words(t: TessBaseAPI): String {
        val all = t.getUTF8Text() ?: ""
        val it = t.getResultIterator() ?: return all
        val list = ArrayList<ScanText.Word>()
        try {
            it.begin()
            do {
                val w = it.getUTF8Text(TessBaseAPI.PageIteratorLevel.RIL_WORD) ?: continue
                list += ScanText.Word(w, it.confidence(TessBaseAPI.PageIteratorLevel.RIL_WORD), it.isAtBeginningOf(TessBaseAPI.PageIteratorLevel.RIL_TEXTLINE))
            } while (it.next(TessBaseAPI.PageIteratorLevel.RIL_WORD))
        } finally {
            it.delete()
        }
        return ScanText.pick(list)
    }

    /** The reader, made once: the models are copied out of the APK the first time (Tesseract reads files, not assets). */
    private fun api(c: Context): TessBaseAPI? {
        tess?.let { return it }
        val root = File(c.noBackupFilesDir, "ocr")
        val dir = File(root, "tessdata").apply { mkdirs() }
        for (lang in LANGS.split("+")) {
            val name = "$lang.traineddata"
            val f = File(dir, name)
            val size = c.assets.openFd("tessdata/$name").use { it.length }
            if (f.length() != size) {
                val tmp = File(dir, "$name.part")
                c.assets.open("tessdata/$name").use { i -> tmp.outputStream().use { o -> i.copyTo(o) } }
                if (!tmp.renameTo(f)) { tmp.delete(); return null }
            }
        }
        val t = TessBaseAPI()
        if (!t.init(root.absolutePath, LANGS, TessBaseAPI.OEM_LSTM_ONLY)) { t.recycle(); Plog.i("gymscan: the reader did not start"); return null }
        t.setVariable("user_defined_dpi", "300")
        tess = t
        return t
    }

    private fun later() { h.removeCallbacks(idle); h.postDelayed(idle, IDLE_MS) }
    private fun release() { tess?.recycle(); tess = null }
}

/** The pure parts of Gym scan (ScanTextTest on the JVM). */
object ScanText {
    /** A data URL longer than this is not a picture from the page (a 1400 px wide JPEG is well under 1 MB). */
    const val MAX_URL = 8_000_000
    private val HEAD = Regex("^data:image/(jpeg|png|webp);base64,")

    /** The picture's bytes from the page's data URL, or null when it is not one. */
    fun bytes(url: String): ByteArray? {
        if (url.length > MAX_URL) return null
        val m = HEAD.find(url) ?: return null
        return runCatching { java.util.Base64.getDecoder().decode(url.substring(m.range.last + 1)) }.getOrNull()?.takeIf { it.size >= 64 }
    }

    data class Word(val text: String, val conf: Float, val lineStart: Boolean)

    fun letters(s: String) = s.count { it.isLetter() }

    /** The words the reader is sure enough of, one label line per line. */
    fun join(words: List<Word>, min: Float): String {
        val lines = ArrayList<StringBuilder>()
        for (w in words) {
            if (lines.isEmpty() || w.lineStart) lines += StringBuilder()
            val t = w.text.trim()
            if (t.isEmpty() || w.conf < min || t.none { it.isLetterOrDigit() }) continue
            val b = lines.last()
            if (b.isNotEmpty()) b.append(' ')
            b.append(t)
        }
        return lines.map { it.toString() }.filter { it.isNotBlank() }.joinToString("\n")
    }

    /** Sure words only; when that leaves almost nothing (a blurry label), every word, and the page sorts it out. */
    fun pick(words: List<Word>, min: Float = 45f): String {
        val sure = join(words, min)
        return if (letters(sure) >= 3) sure else join(words, 0f)
    }
}
