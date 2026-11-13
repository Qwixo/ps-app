package com.cincee.ps.gos

import android.content.Context
import android.media.AudioManager
import org.json.JSONObject

/*
 * The phone's ring mode for the page (V1.56, the phone's own Edit mode). The developer, 13 Nov 2026: the Edit mode sounds
 * follow the phone's silent mode. The WebView plays its sounds on the media stream, which Android never mutes for
 * Silent or Vibrate, so the page asks here ("ringer:get") and stays quiet unless the phone rings normally.
 * Reads one system value, writes nothing, needs no permission.
 */
object Ringer {
    /** AudioManager.RINGER_MODE_SILENT, _VIBRATE, _NORMAL as plain numbers, so the unit tests need no Android. */
    const val SILENT = 0
    const val VIBRATE = 1
    const val NORMAL = 2

    /** The name the page reads: "silent", "vibrate" or "normal" (anything unknown counts as normal). */
    fun name(mode: Int): String = when (mode) { SILENT -> "silent"; VIBRATE -> "vibrate"; else -> "normal" }

    /** The answer to "ringer:get". */
    fun answer(c: Context): JSONObject {
        val am = c.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        return JSONObject().put("type", "ringer").put("mode", name(am?.ringerMode ?: NORMAL))
    }
}
