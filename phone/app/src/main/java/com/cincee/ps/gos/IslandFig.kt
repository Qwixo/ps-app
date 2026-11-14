package com.cincee.ps.gos

import org.json.JSONObject
import kotlin.math.PI
import kotlin.math.cos

/**
 * The little stick figure on the island (V1.60, Found and Workout added). The page sends two poses (the start and the end of a
 * rep) from the exercise picture's own rig (web src/fitness/island-fig.ts), 17 points each as x,y pairs in a 0 to 100 box.
 * Pure, so IslandFigTest checks it on the JVM; Island.kt only draws the lines.
 */
object IslandFig {
    /** The order of the points (web FIG_POINTS): keep both in step. */
    const val HEAD = 0; const val NECK = 1; const val HIP = 2; const val SH = 3; const val SH2 = 4; const val EL = 5; const val EL2 = 6
    const val WR = 7; const val WR2 = 8; const val HIPL = 9; const val HIPR = 10; const val KN = 11; const val KN2 = 12
    const val AN = 13; const val AN2 = 14; const val TOE = 15; const val TOE2 = 16
    const val POINTS = 17

    class Fig(val a: FloatArray, val b: FloatArray, val hr: Float) {
        override fun equals(other: Any?) = other is Fig && a.contentEquals(other.a) && b.contentEquals(other.b) && hr == other.hr
        override fun hashCode() = a.contentHashCode() * 31 + b.contentHashCode()
    }

    /** Anything that is not two lists of 34 finite numbers in a sane range is no figure (the island then shows the name alone). */
    fun parse(o: JSONObject?): Fig? {
        o ?: return null
        val a = floats(o.optJSONArray("a")) ?: return null
        val b = floats(o.optJSONArray("b")) ?: return null
        val hr = o.optDouble("hr", 4.0).toFloat()
        return if (hr.isFinite() && hr in 0.5f..30f) Fig(a, b, hr) else null
    }
    private fun floats(a: org.json.JSONArray?): FloatArray? {
        if (a == null || a.length() != POINTS * 2) return null
        val out = FloatArray(POINTS * 2)
        for (i in out.indices) {
            val v = a.optDouble(i, Double.NaN)
            if (!v.isFinite() || v < -50 || v > 150) return null
            out[i] = v.toFloat()
        }
        return out
    }

    /** A pose between the two (k 0 is the start, 1 the end). */
    fun blend(f: Fig, k: Float): FloatArray {
        val kk = k.coerceIn(0f, 1f)
        return FloatArray(f.a.size) { f.a[it] + (f.b[it] - f.a[it]) * kk }
    }

    /** Where in a rep a figure is `ms` after it started: a smooth loop, 0 to 1 and back every 2.2 seconds. Still (reduced motion) is the start. */
    const val REP_MS = 2200L
    fun repK(ms: Long, still: Boolean): Float = if (still) 0f else (0.5 - 0.5 * cos(2 * PI * (ms.coerceAtLeast(0) % REP_MS) / REP_MS)).toFloat()

    /** The lines of a pose as x1,y1,x2,y2 (in the 0 to 100 box), the head is a circle at point HEAD. */
    fun lines(p: FloatArray): List<FloatArray> {
        fun l(i: Int, j: Int) = floatArrayOf(p[2 * i], p[2 * i + 1], p[2 * j], p[2 * j + 1])
        return listOf(
            l(HEAD, NECK), l(NECK, HIP), l(NECK, SH), l(NECK, SH2), l(HIP, HIPL), l(HIP, HIPR),
            l(SH, EL), l(EL, WR), l(SH2, EL2), l(EL2, WR2),
            l(HIPL, KN), l(KN, AN), l(AN, TOE), l(HIPR, KN2), l(KN2, AN2), l(AN2, TOE2),
        )
    }
}
