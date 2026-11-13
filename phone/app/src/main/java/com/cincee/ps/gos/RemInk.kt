package com.cincee.ps.gos

// Readable colours on a reminder's or alarm's own background (V1.58). The developer, 13 Nov 2026: "when you choose the white
// coloured theme for the fifteen minute reminder, the text almost becomes invisible. The text doesn't adapt to the
// colour." The ring screen's words, smaller words and the words on its accent orb and stop button are worked out
// here from the background and accent, with the same numbers as web core/remind.ts (inkFor, alarmLook)
// and the Mac's card. Pure: no Android, so RemInkTest checks it on the JVM.
object RemInk {
    const val WHITE = "#ffffff"
    const val DARK = "#17121a"
    const val BLACK = "#000000"
    const val AA = 4.5          // words (WCAG AA)
    const val BIG = 3.0         // big bold words on an accent button keep their colour down to 3 to 1 (WCAG AA large)
    private val HEX = Regex("^#[0-9a-f]{6}$")

    fun ok(h: String?, def: String): String = h?.lowercase()?.takeIf { HEX.matches(it) } ?: def
    private fun rgb(h: String): IntArray { val n = ok(h, BLACK).substring(1).toInt(16); return intArrayOf((n shr 16) and 255, (n shr 8) and 255, n and 255) }
    /** Relative luminance 0 (black) to 1 (white). */
    fun luma(h: String): Double {
        fun f(c: Int): Double { val s = c / 255.0; return if (s <= 0.03928) s / 12.92 else Math.pow((s + 0.055) / 1.055, 2.4) }
        val c = rgb(h)
        return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
    }
    /** WCAG contrast ratio, 1 to 21. */
    fun contrast(a: String, b: String): Double { val x = luma(a); val y = luma(b); return (maxOf(x, y) + 0.05) / (minOf(x, y) + 0.05) }
    /** `a` at share `t` over `b` (CSS color-mix in srgb). */
    fun mix(a: String, b: String, t: Double): String {
        val p = rgb(a); val q = rgb(b)
        return "#" + (0..2).joinToString("") { i -> Math.round(p[i] * t + q[i] * (1 - t)).toInt().toString(16).padStart(2, '0') }
    }
    /** White or near black, whichever reads better; pure black or white on a middle tone. */
    fun inkFor(bg: String): String {
        val w = contrast(WHITE, bg); val d = contrast(DARK, bg)
        if (maxOf(w, d) >= AA) return if (w > d) WHITE else DARK
        return if (contrast(BLACK, bg) > w) BLACK else WHITE
    }
    /** The plan's ink when it reads on the background, else one worked out from it (an old plan, or none). */
    fun inkOr(ink: String?, bg: String): String { val i = ok(ink, ""); return if (i.isNotEmpty() && contrast(i, bg) >= AA) i else inkFor(bg) }
    /** `ink` softened toward `bg` as far as it still reads (smaller words). */
    fun soft(ink: String, bg: String, from: Double = 0.7): String {
        var i = Math.round(from * 100).toInt()
        while (i < 100) { val c = mix(ink, bg, i / 100.0); if (contrast(c, bg) >= AA) return c; i += 5 }
        return ink
    }
    /** Words on an accent filled orb or button: `first` when it reads, else a deep shade of the accent itself. */
    fun onAccent(accent: String, first: String, min: Double = BIG): String {
        if (contrast(first, accent) >= min) return first
        for (s in doubleArrayOf(0.4, 0.3, 0.2, 0.1)) { val c = mix(accent, BLACK, s); if (contrast(c, accent) >= AA) return c }
        return if (contrast(BLACK, accent) >= contrast(WHITE, accent)) BLACK else WHITE
    }
    data class Look(val ink: String, val sub: String, val hint: String, val on: String)
    /** The ring screen: time and stop words, the alarm's words and Later, the small hint, the orb and stop button. */
    fun alarm(bgIn: String?, accentIn: String?, inkIn: String? = null): Look {
        val bg = ok(bgIn, "#2a1a08"); val accent = ok(accentIn, "#f59e0b")
        val ink = inkOr(inkIn, bg)
        val sub = soft(ink, bg)
        return Look(ink, sub, soft(ink, bg, 0.6), onAccent(accent, bg))
    }
}
