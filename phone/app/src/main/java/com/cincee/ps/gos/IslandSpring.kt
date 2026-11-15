package com.cincee.ps.gos

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.sin

/**
 * The island's motion for the Fitness moments (V1.60), pure maths, unit tested (IslandSpringTest). The same recipe as the Mac's
 * setup island: a tiny squeeze first (the island shrinks a touch), then it grows on a damped spring that overshoots a little
 * and settles, still joined to the pill. `t` is the morph's plain progress, 0 to 1.
 */
object IslandSpring {
    const val SQUEEZE_END = 0.16f      // the squeeze takes this first part of the morph
    const val DIP = 0.06f              // the island shrinks to 94 percent
    private const val DAMP = 7.0
    private const val FREQ = 9.0

    /** The damped spring alone: 0 at the start, about 1.09 at its highest, exactly 1 at the end. */
    fun spring(t: Float): Float {
        if (t <= 0f) return 0f
        if (t >= 1f) return 1f
        return (1.0 - exp(-DAMP * t) * cos(FREQ * t)).toFloat()
    }

    /** How far the island has grown from where it was to where it goes: nothing during the squeeze, then the spring. Reduced motion: a plain slide. */
    fun grow(t: Float, reduced: Boolean): Float {
        if (reduced) return t.coerceIn(0f, 1f)
        if (t <= SQUEEZE_END) return 0f
        return spring((t - SQUEEZE_END) / (1f - SQUEEZE_END))
    }

    /** The size factor of the island during the squeeze (1 before and after, 0.94 at the deepest). Reduced motion: none. */
    fun squeeze(t: Float, reduced: Boolean): Float {
        if (reduced || t <= 0f || t >= SQUEEZE_END) return 1f
        return 1f - DIP * sin(PI * t / SQUEEZE_END).toFloat()
    }

    /** The tick of a Face ID moment: the ring sweeps round, then the check draws. Both 0 to 1 from `ageMs` since the moment began.
     *  Reduced motion: both already complete. */
    fun tick(ageMs: Long, reduced: Boolean): Pair<Float, Float> {
        if (reduced) return 1f to 1f
        val ring = ((ageMs - 250) / 350f).coerceIn(0f, 1f)
        val check = ((ageMs - 560) / 280f).coerceIn(0f, 1f)
        return ring to check
    }
}
