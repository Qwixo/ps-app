package com.cincee.ps.gos

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.os.Handler
import android.os.HandlerThread
import com.googlecode.tesseract.android.TessBaseAPI
import org.json.JSONObject

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

    /** Time the search may use (the page gives up after 20 s). Each try is about a second on a phone. */
    private const val BUDGET_MS = 12_000L

    private fun read(c: Context, id: String, img: String): JSONObject {
        val bytes = ScanText.bytes(img) ?: return answer(id).put("error", "image")
        val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return answer(id).put("error", "image")
        val t0 = System.currentTimeMillis()
        try {
            val t = api(c) ?: return answer(id).put("error", "model")
            // V1.60: a real label is read at 0, 90 and 270 degrees (a name written up the side), bigger and tilted a little if
            // that finds no title; the try with the best big title line wins (ScanText.search, tested on real labels).
            val found = ScanText.search({ System.currentTimeMillis() - t0 < BUDGET_MS }) { turn, scale, tilt ->
                val shot = reshape(bmp, turn, scale, tilt)
                try { lines(t, shot) } finally { if (shot !== bmp) shot.recycle() }
            }
            val text = found.text
            val conf = found.best?.lines?.let { l -> l.filter { it.text.isNotBlank() }.map { it.conf }.average().takeIf { !it.isNaN() }?.toFloat() } ?: 0f
            Plog.i("gymscan: ${ScanText.letters(text)} letters, ${found.tries} tries, turn ${found.best?.turn ?: 0}, ${System.currentTimeMillis() - t0} ms")
            return answer(id).put("text", text).put("conf", conf)
                .put("title", found.title ?: "").put("turn", found.best?.turn ?: 0)
        } finally {
            bmp.recycle()
        }
    }

    /** The picture turned, scaled and tilted for one try (a new bitmap, or the same one when nothing changes). */
    private fun reshape(src: Bitmap, turn: Int, scale: Float, tilt: Float): Bitmap {
        if (turn == 0 && scale == 1f && tilt == 0f) return src
        val m = Matrix()
        m.postRotate(turn.toFloat() + tilt)
        val side = maxOf(src.width, src.height) * scale
        if (side > 2400f) return reshape(src, turn, 2400f / maxOf(src.width, src.height), tilt)
        if (scale != 1f) m.postScale(scale, scale)
        val out = Bitmap.createBitmap(src, 0, 0, src.width, src.height, m, true)
        if (tilt == 0f) return out
        // The corners a tilt leaves empty are white, not clear.
        val flat = Bitmap.createBitmap(out.width, out.height, Bitmap.Config.ARGB_8888)
        Canvas(flat).apply { drawColor(Color.WHITE); drawBitmap(out, 0f, 0f, null) }
        out.recycle()
        return flat
    }

    /** One try: the text lines with how sure the reader is of each and how tall they are. Scattered text mode finds a big title among pictures. */
    private fun lines(t: TessBaseAPI, bmp: Bitmap): List<ScanText.Line> {
        t.setPageSegMode(TessBaseAPI.PageSegMode.PSM_SPARSE_TEXT)
        t.setImage(bmp)
        t.getUTF8Text()   // runs the reader
        val list = ArrayList<ScanText.Line>()
        val it = t.getResultIterator()
        if (it != null) {
            try {
                it.begin()
                do {
                    val text = it.getUTF8Text(TessBaseAPI.PageIteratorLevel.RIL_TEXTLINE)?.replace(Regex("\\s+"), " ")?.trim() ?: continue
                    if (text.isEmpty()) continue
                    list += ScanText.Line(text, it.confidence(TessBaseAPI.PageIteratorLevel.RIL_TEXTLINE), it.getBoundingRect(TessBaseAPI.PageIteratorLevel.RIL_TEXTLINE).height())
                } while (it.next(TessBaseAPI.PageIteratorLevel.RIL_TEXTLINE))
            } finally {
                it.delete()
            }
        }
        t.clear()
        return list
    }

    /** The reader, made once: the models are copied out of the APK the first time (OcrModels, shared with the receipt
     *  scan). Before this fix it read each model's size with openFd, which throws on the compressed assets, so no scan worked. */
    private fun api(c: Context): TessBaseAPI? {
        tess?.let { return it }
        val root = OcrModels.root(c, LANGS, "gym") ?: return null
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

    // ---------- V1.60: reading a real label (the big title, any turn, any maker) ----------
    /** One line the reader found: its text, how sure it is (0 to 100) and how tall its box is in pixels. */
    data class Line(val text: String, val conf: Float, val h: Int)

    /** One try: the picture turned `turn` degrees (0, 90, 270), scaled by `scale`, tilted `tilt` degrees, and what was read. */
    data class Try(val turn: Int, val scale: Float, val tilt: Float, val lines: List<Line>)

    /** What the search found: the text for the page (the title line first), and the try it came from. */
    data class Found(val text: String, val title: String?, val score: Float, val best: Try?, val tries: Int)

    private val URLISH = Regex("@|\\bwww\\b|https?:|\\b[a-z0-9-]{2,}\\.(com|de|net|org|eu|it|fr|es|nl|co\\.uk|us|io)\\b", RegexOption.IGNORE_CASE)
    private val PHONE = Regex("\\b(tel|telefon|phone|fax|mob|mobil)\\b\\.?:?\\s*[\\d+(]", RegexOption.IGNORE_CASE)
    private val POSTCODE = Regex("\\b\\d{4,5}\\s+\\p{L}{3,}")
    private val COMPANY = Regex("\\b(gmbh|ltd|llc|inc|s\\.?r\\.?l|s\\.?p\\.?a|b\\.?v)\\b", RegexOption.IGNORE_CASE)
    private val STREET = Regex("\\p{L}{3,}\\s*(stra(ss|\u00DF)e|str\\.|weg|allee|platz|gasse|street|road|avenue)\\s*\\d", RegexOption.IGNORE_CASE)

    /** An address, a web or mail address, a phone number or a company line: never the exercise. Any maker, any country. */
    fun isJunk(line: String): Boolean {
        val t = line.trim()
        if (t.isEmpty()) return true
        return URLISH.containsMatchIn(t) || PHONE.containsMatchIn(t) || t.count { it.isDigit() } >= 6 ||
            POSTCODE.containsMatchIn(t) || COMPANY.containsMatchIn(t) || STREET.containsMatchIn(t)
    }

    /** How much a line looks like the big title of a label (0 to 1): one to four words, capitals, no list number in front. */
    fun titleLook(line: String): Float {
        val t = line.trim()
        val ws = t.split(Regex("\\s+")).filter { it.isNotEmpty() }
        val letters = letters(t)
        if (ws.isEmpty() || ws.size > 4 || letters < 4 || Regex("^\\d+[.)]").containsMatchIn(t) || isJunk(t)) return 0f
        val upper = t.count { it.isUpperCase() }.toFloat() / letters
        val initials = ws.all { w -> w.dropWhile { !it.isLetter() }.firstOrNull()?.isUpperCase() == true }
        val solid = letters.toFloat() / t.count { !it.isWhitespace() }
        return maxOf(upper, if (initials) 0.7f else 0f) * solid
    }

    /** Title score of one line among the lines of one try: sure of it, looks like a title, taller than the usual line. 0 when unsure. */
    fun titleScore(l: Line, all: List<Line>): Float {
        if (l.conf < 55f) return 0f
        val look = titleLook(l.text)
        if (look <= 0f) return 0f
        val hs = all.filter { it.conf >= 40f }.map { it.h }.sorted()
        val med = if (hs.size >= 3) hs[hs.size / 2].toFloat() else l.h.toFloat()
        val hf = (l.h / maxOf(1f, med)).coerceIn(0.6f, 2.5f)
        return l.conf / 100f * look * hf
    }

    /** The best title line of one try and its score, or null. */
    fun title(lines: List<Line>): Pair<Line, Float>? =
        lines.map { it to titleScore(it, lines) }.filter { it.second > 0f }.maxByOrNull { it.second }

    /** The text for the page: the title first, then the other lines the reader is sure of (no addresses). */
    fun compose(lines: List<Line>, title: Line?, min: Float = 45f): String {
        val rest = lines.filter { it !== title && !isJunk(it.text) }
        val sure = rest.filter { it.conf >= min && it.text.any { c -> c.isLetter() } }.map { it.text.trim() }
        val out = ArrayList<String>()
        if (title != null) out += title.text.trim()
        out += if (title != null || letters(sure.joinToString(" ")) >= 3) sure else rest.map { it.text.trim() }
        return out.filter { it.isNotBlank() }.joinToString("\n")
    }

    /** A title this good ends the search at once. */
    const val GOOD = 0.7f
    private const val MAX_TRIES = 8

    /**
     * Where to look, in order: the picture as it is, turned 90 and 270 degrees (a name written up the side of a label), then,
     * if no good title yet, the best turn bigger (a small label) and tilted a little each way. Keeps the try with the best
     * title. `more` says whether there is time left; `read` reads one try (the phone's reader, or a recording in the tests).
     */
    fun search(more: () -> Boolean, read: (turn: Int, scale: Float, tilt: Float) -> List<Line>): Found {
        val tries = ArrayList<Try>()
        var bestT: Try? = null
        var bestS = 0f
        var bestTitle: Line? = null
        fun go(turn: Int, scale: Float, tilt: Float): Boolean {
            if (tries.size >= MAX_TRIES || (tries.isNotEmpty() && !more())) return false
            val t = Try(turn, scale, tilt, read(turn, scale, tilt))
            tries += t
            val ti = title(t.lines)
            if (ti != null && ti.second > bestS) { bestS = ti.second; bestT = t; bestTitle = ti.first }
            return bestS >= GOOD && titleLook(bestTitle!!.text) >= 0.8f
        }
        var done = false
        for (turn in intArrayOf(0, 90, 270)) { if (go(turn, 1f, 0f)) { done = true; break } }
        if (!done) {
            val turn = bestT?.turn ?: tries.maxByOrNull { t -> letters(t.lines.filter { it.conf >= 45f && !isJunk(it.text) }.joinToString(" ") { it.text }) }?.turn ?: 0
            val order = listOf(turn to 1.5f, turn to -8f, turn to 8f)
            for ((i, o) in order.withIndex()) {
                val (tn, x) = o
                val hit = if (i == 0) go(tn, x, 0f) else go(tn, bestT?.scale ?: 1f, x)
                if (hit) break
            }
        }
        val b = bestT
        if (b != null) return Found(compose(b.lines, bestTitle), bestTitle?.text?.trim(), bestS, b, tries.size)
        // No title anywhere (a blurry or plain label): the try with the most sure letters, as before.
        val most = tries.maxByOrNull { t -> letters(t.lines.filter { it.conf >= 45f && !isJunk(it.text) }.joinToString(" ") { it.text }) }
        return Found(if (most == null) "" else compose(most.lines, null), null, 0f, most, tries.size)
    }
}
