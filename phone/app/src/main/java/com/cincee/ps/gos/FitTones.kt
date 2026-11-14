package com.cincee.ps.gos

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Handler
import android.os.Looper
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.sin

/**
 * The sounds of the island's Fitness moments (V1.60), made in code (no sound files, nothing to license): each moment has
 * its own, so you know what happened without looking. Scanning: a soft tick. Found: two notes up. Not found: two notes down.
 * Workout added: a bright rising chime that rings out (the big one). Higher than last time: three quick notes up. Same weight:
 * one calm note. A nudge: two plucks, the second a little higher, like a question. The end of a rest keeps the app's own
 * chime (Fitness.kt, rest_over.wav). `render` is pure (IslandSoundTest); `play` obeys the phone's silent mode and Do Not Disturb
 * the same way the rest chime does, and the page's "Island sounds" switch.
 */
object FitTones {
    const val RATE = 22_050
    private data class Note(val hz: Double, val at: Int, val ms: Int, val amp: Double, val decay: Double = 7.0, val shimmer: Double = 0.0)

    private fun notes(kind: String): List<Note> = when (kind) {
        "scanning" -> listOf(Note(1046.5, 0, 90, 0.22, 14.0))
        "found" -> listOf(Note(784.0, 0, 200, 0.3), Note(1174.7, 95, 280, 0.3))
        "notfound" -> listOf(Note(392.0, 0, 220, 0.3, 9.0), Note(293.7, 120, 320, 0.3, 9.0))
        "added" -> listOf(Note(1046.5, 0, 300, 0.26, 5.0, 0.2), Note(1318.5, 85, 300, 0.26, 5.0, 0.2), Note(1568.0, 170, 340, 0.26, 5.0, 0.2), Note(2093.0, 270, 750, 0.3, 3.2, 0.35))
        "better" -> listOf(Note(659.3, 0, 180, 0.28), Note(830.6, 75, 180, 0.28), Note(987.8, 150, 340, 0.3, 5.0))
        "same" -> listOf(Note(587.3, 0, 420, 0.3, 5.0))
        "nudge" -> listOf(Note(880.0, 0, 150, 0.28, 12.0), Note(1108.7, 105, 260, 0.28, 9.0))
        else -> emptyList()
    }

    /** 16 bit mono samples of a moment's sound; empty for an unknown kind. Peak stays at half scale or less. */
    fun render(kind: String): ShortArray {
        val ns = notes(kind)
        if (ns.isEmpty()) return ShortArray(0)
        val total = ns.maxOf { it.at + it.ms } * RATE / 1000 + RATE / 20
        val mix = DoubleArray(total)
        for (n in ns) {
            val start = n.at * RATE / 1000
            val len = n.ms * RATE / 1000
            for (i in 0 until len) {
                val t = i.toDouble() / RATE
                val attack = (i / (0.006 * RATE)).coerceAtMost(1.0)               // 6 ms in, so it never clicks
                val release = ((len - i) / (0.02 * RATE)).coerceIn(0.0, 1.0)       // 20 ms out
                val env = attack * release * exp(-n.decay * t)
                val w = sin(2 * PI * n.hz * t) + 0.18 * sin(2 * PI * n.hz * 2 * t) + n.shimmer * sin(2 * PI * n.hz * 3.01 * t)
                if (start + i < total) mix[start + i] += n.amp * env * w
            }
        }
        val peak = mix.maxOf { abs(it) }
        val gain = if (peak > 0.5) 0.5 / peak else 1.0
        return ShortArray(total) { (mix[it] * gain * Short.MAX_VALUE).toInt().toShort() }
    }

    fun millis(kind: String) = render(kind).size * 1000L / RATE

    private val main by lazy { Handler(Looper.getMainLooper()) }   // lazy: the pure part runs in JVM tests with no Android
    /** Plays a moment's sound, once, if the phone is not silent or in Do Not Disturb. Never throws. */
    fun play(c: Context, kind: String) {
        runCatching {
            if (!Fitness.Buzz.mayRing(c)) return
            val pcm = render(kind)
            if (pcm.isEmpty()) return
            val attrs = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
            val fmt = AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build()
            val t = AudioTrack.Builder().setAudioAttributes(attrs).setAudioFormat(fmt).setTransferMode(AudioTrack.MODE_STATIC).setBufferSizeInBytes(pcm.size * 2).build()
            t.write(pcm, 0, pcm.size)
            t.play()
            main.postDelayed({ runCatching { t.stop(); t.release() } }, pcm.size * 1000L / RATE + 250)
        }.onFailure { Plog.i("island: sound not played (${it.javaClass.simpleName})") }
    }
}
