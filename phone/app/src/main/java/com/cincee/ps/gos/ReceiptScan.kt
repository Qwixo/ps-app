package com.cincee.ps.gos

import android.content.Context
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.HandlerThread
import com.googlecode.tesseract.android.TessBaseAPI
import org.json.JSONObject

/*
 * Receipt scan (PS 1.65, the developer, 17 Nov 2026: "scan receipts, mostly Georgian, nothing leaves my devices"). The page
 * (web src/views/ReceiptScan.tsx, src/gos/receiptscan.ts) takes one still from its own camera view and sends it here as a data
 * URL. The same offline Tesseract as the gym scan reads it with the Georgian (kat) and English (eng) "fast" models bundled in
 * assets/tessdata (pinned by SHA-256 in app/build.gradle.kts, checkTessdata), and the text goes back to the page, which finds the
 * shop, the date, the total and the items (web src/core/receiptparse.ts, tested there).
 *
 * Privacy: the picture is decoded in memory, read and dropped. It is never written to a file and never sent anywhere; this file
 * has no network code. The log says how many characters were read, never what. The reader works on its own thread and lets its
 * memory go after 90 s without a scan.
 */
object ReceiptScan {
    private const val LANGS = "kat+eng"
    private const val IDLE_MS = 90_000L
    private val thread = HandlerThread("ps-receipt").apply { start() }
    private val h = Handler(thread.looper)
    private var tess: TessBaseAPI? = null   // only touched on the ps-receipt thread
    @Volatile private var busy = false
    private val idle = Runnable { release() }
    private val ID = Regex("^[A-Za-z0-9_-]{1,40}$")

    /** True when the message was a Receipt scan one. Called on the bridge thread; the work goes to the ps-receipt thread. */
    fun handle(c: Context, type: String, m: JSONObject, post: (JSONObject) -> Unit): Boolean {
        when (type) {
            "receiptscan:warm" -> h.post { runCatching { api(c) }; later() }
            "receiptscan:read" -> {
                val id = m.optString("id")
                if (!ID.matches(id)) return true
                if (busy) { post(answer(id).put("error", "busy")); return true }
                busy = true
                val img = m.optString("img")
                h.post {
                    val out = try { read(c, id, img) } catch (e: Throwable) {
                        Plog.i("receiptscan: failed (${e.javaClass.simpleName})"); answer(id).put("error", "failed")
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

    private fun answer(id: String) = JSONObject().put("type", "receiptscan").put("id", id)

    private fun read(c: Context, id: String, img: String): JSONObject {
        val bytes = ScanText.bytes(img) ?: return answer(id).put("error", "image")
        val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return answer(id).put("error", "image")
        val t0 = System.currentTimeMillis()
        try {
            val t = api(c) ?: return answer(id).put("error", "model")
            // One column: a receipt is a list, and the automatic layout often reads the prices as a second block after all the
            // names, which breaks "name ... price" apart. Single column keeps each printed line whole.
            t.setPageSegMode(TessBaseAPI.PageSegMode.PSM_SINGLE_COLUMN)
            t.setImage(bmp)
            t.getUTF8Text()   // runs the reader
            val lines = ArrayList<ReceiptText.Line>()
            val it = t.getResultIterator()
            if (it != null) {
                try {
                    it.begin()
                    do {
                        val text = it.getUTF8Text(TessBaseAPI.PageIteratorLevel.RIL_TEXTLINE) ?: continue
                        lines += ReceiptText.Line(text, it.confidence(TessBaseAPI.PageIteratorLevel.RIL_TEXTLINE))
                    } while (it.next(TessBaseAPI.PageIteratorLevel.RIL_TEXTLINE))
                } finally {
                    it.delete()
                }
            }
            t.clear()
            val text = ReceiptText.compose(lines)
            Plog.i("receiptscan: ${text.length} characters, ${System.currentTimeMillis() - t0} ms")
            return answer(id).put("text", text).put("conf", ReceiptText.confidence(lines))
        } finally {
            bmp.recycle()
        }
    }

    /** The reader, made once: the models are copied out of the APK the first time (OcrModels, shared with the gym scan). */
    private fun api(c: Context): TessBaseAPI? {
        tess?.let { return it }
        val root = OcrModels.root(c, LANGS, "receipt") ?: return null
        val t = TessBaseAPI()
        if (!t.init(root.absolutePath, LANGS, TessBaseAPI.OEM_LSTM_ONLY)) { t.recycle(); Plog.i("receiptscan: the reader did not start"); return null }
        t.setVariable("user_defined_dpi", "300")
        tess = t
        return t
    }

    private fun later() { h.removeCallbacks(idle); h.postDelayed(idle, IDLE_MS) }
    private fun release() { tess?.recycle(); tess = null }
}

/** The pure part of Receipt scan (ReceiptTextTest on the JVM): the lines the reader found, tidied, one per line. */
object ReceiptText {
    /** One line the reader found and how sure it is of it (0 to 100). */
    data class Line(val text: String, val conf: Float)

    /** Spaces squeezed, empty lines gone, and a line the reader is nearly blind to (under 15) with no digit and no letter dropped. */
    fun compose(lines: List<Line>): String =
        lines.map { it.copy(text = it.text.replace(Regex("[ \\t\\u00A0]+"), " ").trim()) }
            .filter { it.text.isNotEmpty() && (it.conf >= 15f || it.text.any { c -> c.isLetterOrDigit() }) }
            .joinToString("\n") { it.text }

    /** The average sureness of the lines with something in them, 0 when there are none. */
    fun confidence(lines: List<Line>): Float {
        val l = lines.filter { it.text.any { c -> c.isLetterOrDigit() } }
        return if (l.isEmpty()) 0f else l.map { it.conf }.average().toFloat()
    }
}
