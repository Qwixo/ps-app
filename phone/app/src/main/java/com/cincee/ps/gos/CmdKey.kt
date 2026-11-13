package com.cincee.ps.gos

import android.content.Context
import org.json.JSONObject
import java.security.Signature

// Left out of the public source: the phone's key for restarting, shutting down and locking the developer's Macs
// (Second Computer). It only runs on the developer's own account. This placeholder keeps the names the rest of the
// app uses and does nothing. See README.md, "What is left out". (scripts in the private tree: open-source.mjs)
object CmdKey {
    fun info(c: Context): JSONObject = JSONObject().put("ok", false)
    fun device(c: Context): String = ""
    fun prepare(c: Context, body: String, now: Long = System.currentTimeMillis()): Pair<Signature?, String?> =
        Pair(null, "Left out of the public source")
    fun finish(sig: Signature, body: String): String = ""
}
