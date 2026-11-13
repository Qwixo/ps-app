package com.cincee.ps.gos

import android.content.Context
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneId

// Alarm playlists on the phone (V1.47; web src/core/alarmlist.ts has the rules, src/sleepmode/list.ts the page).
// The developer, 10 Nov 2026: "add a bunch of audio files so it goes through all these audio files one after another, randomly
// or in order, so every day there is a different audio file, so we can wake up to a motivational speaker".
//  - The page keeps the list in the vault settings (synced). The FILES stay on the phone they were added on, kept as
//    they are (never converted) in filesDir/alarm-list/<id>.<ext>; the id is the start of the file's SHA-256, checked
//    here when the last piece lands. Never uploaded, never in the vault.
//  - The page reads a picked file and hands it over in 512 KB pieces ("sleep:list:put"), on the bridge thread, never
//    the main one. Up to 100 MB a file.
//  - The plan says which file each day plays; Sleep.kt rings it at the alarm loudness through PS Do Not Disturb like
//    every Sleep alarm, with the style's rise and the fade in, looping (10 min) or the whole file (until it ends, 10 min
//    to 3 h). Stop, Wake up and the back gesture stop it. A day whose file is not here rings the usual sound.

/** The pure rules (the page's numbers), JVM tested in ListClockTest. */
object ListClock {
    const val MAX_BYTES = 100L * 1024 * 1024
    const val PIECE = 512 * 1024
    const val WHOLE_MAX = 3 * 3600_000L
    const val PREVIEW_MAX = 31_000L
    const val KEEP_YOUNG = 10 * 60_000L
    val EXTS = setOf("mp3", "m4a", "wav", "aac", "aiff", "aif", "flac", "ogg", "oga", "opus", "caf")

    data class Entry(val id: String, val name: String, val secs: Double, val n: Int, val of: Int)
    /** V1.47 (Sleep settings) `on`: every alarm with no sound of its own plays it; false: only alarms set to it. */
    data class PlanList(val end: String, val fade: Int, val days: Map<String, Entry>, val on: Boolean = true)

    fun okId(s: String?) = s != null && s.length == 16 && s.all { it in '0'..'9' || it in 'a'..'f' }
    fun day(ms: Long, zone: ZoneId = ZoneId.systemDefault()): String = Instant.ofEpochMilli(ms).atZone(zone).toLocalDate().toString()

    /** The plan's "list" (null: off, or an older page). */
    fun parse(plan: String?): PlanList? = runCatching { parse(JSONObject(plan ?: return null).optJSONObject("list")) }.getOrNull()
    fun parse(o: JSONObject?): PlanList? {
        val d = o?.optJSONObject("days") ?: return null
        val days = mutableMapOf<String, Entry>()
        for (k in d.keys()) {
            if (days.size >= 14) break
            val e = d.optJSONObject(k) ?: continue
            val id = e.optString("id")
            if (k.length != 10 || !okId(id)) continue
            days[k] = Entry(id, e.optString("name").take(60), e.optDouble("secs", 0.0).coerceAtLeast(0.0), e.optInt("n"), e.optInt("of"))
        }
        val f = o.optInt("fade", 0)
        return PlanList(if (o.optString("end") == "whole") "whole" else "loop", if (f in listOf(0, 10, 30, 60)) f else 0, days, o.opt("on") as? Boolean ?: true)
    }
    fun entry(p: PlanList?, now: Long, zone: ZoneId = ZoneId.systemDefault()): Entry? = p?.days?.get(day(now, zone))

    /** How long the alarm rings with this file: the whole file (10 min to 3 h) or the usual 10 min while it loops. */
    fun ringFor(end: String, secs: Double): Long {
        if (end != "whole" || secs <= 0) return SleepClock.RING_FOR
        return minOf(WHOLE_MAX, maxOf(SleepClock.RING_FOR, Math.round(secs * 1000) + 3000))
    }
    /** The fade in: 0.05 rising to 1 over `fade` seconds (0: none). Never on Loud. */
    fun fadeAt(ms: Long, fade: Int): Double = if (fade <= 0) 1.0 else minOf(1.0, 0.05 + 0.95 * maxOf(0L, ms) / (fade * 1000.0))
    /** The first 16 hex characters of the SHA-256. */
    fun idOf(f: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        f.inputStream().use { s -> val b = ByteArray(1 shl 16); while (true) { val n = s.read(b); if (n < 0) break; md.update(b, 0, n) } }
        return md.digest().take(8).joinToString("") { "%02x".format(it) }
    }
    /** Is a piece acceptable? Pieces must come in order, each at most PIECE, the whole file under MAX_BYTES. */
    fun pieceOk(id: String?, ext: String?, i: Int, n: Int, expect: Int, size: Long, got: Int): Boolean =
        okId(id) && ext in EXTS && n in 1..((MAX_BYTES / PIECE).toInt() + 1) && i in 0 until n && i == expect && got in 1..PIECE && size + got <= MAX_BYTES
}

/** The playlist's files on this phone. Every call on the bridge thread (file work never on the main thread). */
object AlarmListStore {
    fun dir(c: Context) = File(c.filesDir, "alarm-list")
    /** The file kept for `id`, if this phone has it. */
    fun listFile(c: Context, id: String?): File? {
        if (!ListClock.okId(id)) return null
        return dir(c).listFiles()?.firstOrNull { it.name.startsWith("$id.") && !it.name.endsWith(".part") && it.isFile }
    }
    fun have(c: Context): List<String> = (dir(c).listFiles() ?: emptyArray()).filter { it.isFile && !it.name.endsWith(".part") }
        .map { it.name.take(16) }.filter { ListClock.okId(it) }.sorted()

    /** {type:"sleep:list", have, saved?, failed?, error?} to the page. */
    fun post(c: Context, saved: String? = null, failed: String? = null, error: String? = null) {
        val o = JSONObject().put("type", "sleep:list").put("have", JSONArray(have(c)))
        if (saved != null) o.put("saved", saved)
        if (failed != null) o.put("failed", failed)
        if (error != null) o.put("error", error)
        WebHost.post(o)
    }

    private var expect = 0
    private var size = 0L
    private var current = ""
    private var dead = ""
    /** One piece of a file the page is handing over ("sleep:list:put"). */
    fun put(c: Context, id: String, ext: String, i: Int, n: Int, b64: String) {
        val bytes = runCatching { Base64.decode(b64, Base64.DEFAULT) }.getOrNull()
        val key = "$id.$ext"
        if (i > 0 && key == dead) return   // the rest of a file already refused: one answer is enough
        if (i == 0) { current = key; expect = 0; size = 0; dead = "" }
        if (bytes == null || key != current || !ListClock.pieceOk(id, ext, i, n, expect, size, bytes.size)) {
            fail(c, id, ext, "PS app could not keep that file on this phone.")
            return
        }
        val part = File(dir(c), "$key.part")
        val ok = runCatching {
            dir(c).mkdirs()
            FileOutputStream(part, i > 0).use { it.write(bytes) }
        }.isSuccess
        if (!ok) { fail(c, id, ext, "PS app could not keep that file on this phone (is it full?)."); return }
        expect++; size += bytes.size
        if (i < n - 1) return
        // The last piece: the bytes must be the file the page meant (its SHA-256), then it is kept.
        val same = runCatching { ListClock.idOf(part) == id }.getOrDefault(false)
        if (!same || !part.renameTo(File(dir(c), key))) { fail(c, id, ext, "That file did not arrive whole. Try adding it again."); return }
        current = ""
        Plog.i("alarm list: a file kept (${size / 1024} KB)")
        post(c, saved = id)
    }
    private fun fail(c: Context, id: String, ext: String, why: String) {
        File(dir(c), "$id.$ext.part").delete()
        current = ""; expect = 0; size = 0; dead = "$id.$ext"
        Plog.i("alarm list: a file refused")
        post(c, failed = id, error = why)
    }
    /** A file read back to share it in the squad, 1 MB at a time: {type:"sleep:list", chunk:{id, off, size, b64}}. */
    fun read(c: Context, id: String, off: Long, len: Int) {
        val f = listFile(c, id)
        val chunk = JSONObject().put("id", id)
        if (f != null) runCatching {
            java.io.RandomAccessFile(f, "r").use { r ->
                val size = r.length(); val at = off.coerceIn(0, size)
                val b = ByteArray(minOf(len.coerceIn(1, 1 shl 20).toLong(), size - at).toInt())
                r.seek(at); r.readFully(b)
                chunk.put("off", at).put("size", size).put("b64", Base64.encodeToString(b, Base64.NO_WRAP))
            }
        }
        WebHost.post(JSONObject().put("type", "sleep:list").put("have", JSONArray(have(c))).put("chunk", chunk))
    }
    fun remove(c: Context, id: String) {
        listFile(c, id)?.delete()
        Plog.i("alarm list: a file removed")
        post(c)
    }
    /** Files no longer on the list (removed on another device) go, once they are over 10 minutes old. */
    fun keep(c: Context, ids: Set<String>, now: Long = System.currentTimeMillis()) {
        for (f in dir(c).listFiles() ?: emptyArray()) {
            if (f.name.take(16) in ids && !f.name.endsWith(".part")) continue
            if (now - f.lastModified() > ListClock.KEEP_YOUNG) { f.delete(); Plog.i("alarm list: a file no longer on the list removed") }
        }
        post(c)
    }
}
