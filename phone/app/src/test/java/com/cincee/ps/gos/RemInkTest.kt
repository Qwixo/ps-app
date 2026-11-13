package com.cincee.ps.gos

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Readable colours on a reminder's or alarm's own background (V1.58, RemInk.kt): every theme of web
 *  core/remind.ts REM_COLOURS, light custom colours and a sweep, at 4.5 to 1 (big bold words on the accent at 3). */
class RemInkTest {
    private val presets = listOf("#28121e" to "#ec4e86", "#0f1b2d" to "#3b82f6", "#0f2418" to "#22c55e", "#2a1a08" to "#f59e0b",
        "#1c1230" to "#8b5cf6", "#2a0d0d" to "#ef4444", "#18181b" to "#e5e7eb", "#f6f3ee" to "#e0457b")
    private val customs = listOf("#ffffff", "#fff8e1", "#fffde7", "#e5e7eb", "#d4d4d8", "#fbcfe8", "#bbf7d0", "#bae6fd", "#c8c8c8", "#b0b0b0", "#9a9a9a", "#ec4e86", "#f59e0b", "#22c55e")
        .flatMap { bg -> listOf("#ec4e86", "#ffffff", "#f59e0b", "#e5e7eb", "#3b82f6").map { bg to it } }
    private fun at(want: Double, got: Double, what: String) = assertTrue("$what: $got", got >= want)

    @Test fun contrastAndMix() {
        assertEquals(21.0, RemInk.contrast("#000000", "#ffffff"), 0.01)
        assertEquals("#808080", RemInk.mix("#ffffff", "#000000", 0.5))
    }
    @Test fun inkLikeThePage() {
        presets.dropLast(1).forEach { assertEquals(it.first, "#ffffff", RemInk.inkFor(it.first)) }
        assertEquals("#17121a", RemInk.inkFor("#f6f3ee"))
        assertEquals("#17121a", RemInk.inkFor("#ffffff"))
        assertEquals("#17121a", RemInk.inkFor("#fff8e1"))
        for (bg in listOf("#b0b0b0", "#a0a0a0", "#ec4e86", "#f59e0b", "#22c55e")) { assertNotEquals(bg, "#ffffff", RemInk.inkFor(bg)); at(RemInk.AA, RemInk.contrast(RemInk.inkFor(bg), bg), bg) }
    }
    @Test fun inkReadsOnAnyBackground() {
        for (r in 0 until 256 step 8) for (g in 0 until 256 step 8) for (b in 0 until 256 step 8) {
            val bg = "#%02x%02x%02x".format(r, g, b)
            val l = RemInk.alarm(bg, "#ec4e86")
            at(RemInk.AA, RemInk.contrast(l.ink, bg), "ink on $bg")
            at(RemInk.AA, RemInk.contrast(l.sub, bg), "words on $bg")
            at(RemInk.AA, RemInk.contrast(l.hint, bg), "hint on $bg")
        }
    }
    @Test fun ringScreenOnEveryTheme() {
        for ((bg, acc) in presets + customs) {
            val l = RemInk.alarm(bg, acc)
            at(RemInk.AA, RemInk.contrast(l.ink, bg), "time on $bg")
            at(RemInk.AA, RemInk.contrast(l.sub, bg), "words and Later on $bg")
            at(RemInk.AA, RemInk.contrast(l.hint, bg), "hint on $bg")
            at(RemInk.BIG, RemInk.contrast(l.on, acc), "orb and stop button on $acc")
        }
    }
    @Test fun darkThemesKeepTheirLook() {
        presets.dropLast(1).forEach { (bg, acc) -> val l = RemInk.alarm(bg, acc); assertEquals("#ffffff", l.ink); assertEquals(bg, l.on) }
        val graphiteOnWhite = RemInk.alarm("#18181b", "#ffffff")
        assertEquals("#18181b", graphiteOnWhite.on)
    }
    @Test fun oldPlansGetReadableInk() {
        assertEquals("#17121a", RemInk.inkOr("#ffffff", "#f6f3ee"))
        assertEquals("#17121a", RemInk.inkOr("", "#f6f3ee"))
        assertEquals("#ffffff", RemInk.inkOr("#ffffff", "#28121e"))
        val p = RemClock.parse(JSONObject().put("v", 1).put("items", JSONArray()
            .put(JSONObject().put("id", "p").put("at", "09:00").put("until", "10:00").put("bg", "#f6f3ee"))
            .put(JSONObject().put("id", "w").put("at", "09:00").put("until", "10:00").put("bg", "#ffffff").put("ink", "#ffffff"))))
        assertEquals(listOf("#17121a", "#17121a"), p.map { it.ink })
    }
}
