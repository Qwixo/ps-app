package com.cincee.ps.gos

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId

/**
 * The Soundboard's pure rules on the phone (V1.47), with no platform classes in them (unit tested in src/test,
 * SbClockTest). The same rules as web src/core/soundboard.ts and the contract
 * (side-session-notes v147-soundboard-contract.md): which files are audio or video, the index file, a name clash
 * ("Song 2.mp3"), the safe move plan, byte ranges for the player, and when a timed play is due (nextFire, the same
 * zone maths as the page through RemClock.zonedToTs, so the phone, the Mac and the page agree on DST days).
 * Soundboard.kt does the files, the serving, the pickers and the ring.
 */
object SbClock {
    val AUDIO = setOf("mp3", "m4a", "aac", "wav", "aif", "aiff", "flac", "ogg", "oga", "opus", "caf")
    val VIDEO = setOf("mp4", "m4v", "mov", "webm", "mkv", "3gp")
    private val MIME = mapOf(
        "mp3" to "audio/mpeg", "m4a" to "audio/mp4", "aac" to "audio/aac", "wav" to "audio/wav", "aif" to "audio/aiff", "aiff" to "audio/aiff",
        "flac" to "audio/flac", "ogg" to "audio/ogg", "oga" to "audio/ogg", "opus" to "audio/opus", "caf" to "audio/x-caf",
        "mp4" to "video/mp4", "m4v" to "video/mp4", "mov" to "video/quicktime", "webm" to "video/webm", "mkv" to "video/x-matroska", "3gp" to "video/3gpp",
    )
    const val FILE_MAX = 4L * 1024 * 1024 * 1024    // one file: 4 GB
    const val SHARE_MAX = 10L * 1024 * 1024         // sb:read and sb:put: audio of 10 MB or less
    const val CHUNK_MAX = 1024 * 1024               // one sb:read or sb:put piece
    const val LIB_MAX = 5000
    const val DEPTH_MAX = 4                         // folders deep
    const val NAME_MAX = 120
    const val PLAYS_MAX = 50
    const val LOOP_MAX_MS = 10 * 60_000L            // a loop rings at most this long
    const val LATE_MS = 2 * 60_000L                 // a timed play delivered late still plays within this (soundboard.ts LATE_MS)
    const val INDEX = ".ps-soundboard.json"
    const val SQUAD = "From your squad"
    const val PART = ".ps-part-"                    // a copy in progress: hidden, so a scan never takes it
    private val ID = Regex("^[0-9a-f]{16}$")
    private val PLAY_ID = Regex("^[0-9a-z]{1,16}$")
    private val HHMM = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")

    // ---------- files ----------
    fun okId(v: String?) = v != null && ID.matches(v)
    /** "Song.MP3" -> "mp3"; no extension (or a hidden name with none) -> "". */
    fun extOf(name: String): String {
        val base = name.substringAfterLast('/')
        val i = base.lastIndexOf('.')
        return if (i > 0) base.substring(i + 1).lowercase() else ""
    }
    fun kindOf(ext: String): String? = ext.lowercase().let { if (it in AUDIO) "audio" else if (it in VIDEO) "video" else null }
    fun isMedia(name: String) = !name.startsWith(".") && kindOf(extOf(name)) != null
    fun mimeOf(ext: String) = MIME[ext.lowercase()] ?: "application/octet-stream"

    /** One line, no control characters and no long dashes, trimmed, at most `max` characters (soundboard.ts oneLine). */
    fun oneLine(v: String?, max: Int): String =
        (v ?: "").take(2000).replace(Regex("[\\u0000-\\u001f\\u007f\\u2013\\u2014]"), " ").replace(Regex("\\s+"), " ").trim().take(max).trim()
    /** The display name: the file name without its extension (soundboard.ts baseName). */
    fun baseName(file: String): String {
        val base = file.substringAfterLast('/')
        val i = base.lastIndexOf('.')
        return oneLine(if (i > 0) base.substring(0, i) else base, NAME_MAX).ifEmpty { "Untitled" }
    }
    /** A name that is safe as one file or folder name on any disk: no slashes, no characters FAT refuses, no leading dot. */
    fun safeName(v: String?, max: Int = NAME_MAX): String =
        oneLine(v, 400).replace(Regex("[/\\\\:*?\"<>|]"), " ").replace(Regex("\\s+"), " ").trim().trimStart('.').trim().take(max).trim()
    /** "Song.mp3" for a file: a safe stem (Untitled when nothing is left) and the lower case extension. */
    fun fileName(stem: String?, ext: String): String = "${safeName(stem).ifEmpty { "Untitled" }}.${ext.lowercase()}"

    /** A name that is free in `taken` (lower case compare): "Song.mp3", then "Song 2.mp3", "Song 3.mp3" (soundboard.ts freeName). */
    fun freeName(file: String, taken: Set<String>): String {
        fun has(n: String) = n.lowercase() in taken
        if (!has(file)) return file
        val i = file.lastIndexOf('.')
        val stem = if (i > 0) file.substring(0, i) else file
        val ext = if (i > 0) file.substring(i) else ""
        for (n in 2 until 10_000) { val c = "$stem $n$ext"; if (!has(c)) return c }
        return "$stem ${System.currentTimeMillis()}$ext"
    }

    /** A path relative to the root that is safe to use ("Mix/Old/a.mp3"), or null: no "..", no hidden parts, no
     *  empty parts, at most DEPTH_MAX folders, a media file at the end. */
    fun cleanRel(p: String?): String? {
        val parts = (p ?: return null).split('/')
        if (parts.isEmpty() || parts.size > DEPTH_MAX + 1) return null
        if (parts.any { it.isEmpty() || it.startsWith(".") || it.any { ch -> ch.code < 32 } || it.contains('\\') }) return null
        return if (isMedia(parts.last())) parts.joinToString("/") else null
    }
    fun folderOf(rel: String) = rel.substringBeforeLast('/', "")
    fun fileOf(rel: String) = rel.substringAfterLast('/')
    fun join(folder: String, file: String) = if (folder.isEmpty()) file else "$folder/$file"
    /** A folder for a folder import: the picked folder's own name, then its subfolders, at most DEPTH_MAX deep. */
    fun cleanFolder(parts: List<String>): String = parts.map { safeName(it, 60) }.filter { it.isNotEmpty() }.take(DEPTH_MAX).joinToString("/")

    fun newId(rnd: java.util.Random = java.security.SecureRandom()): String =
        (0 until 16).joinToString("") { Integer.toHexString(rnd.nextInt(16)) }

    // ---------- the index (.ps-soundboard.json) ----------
    /**
     * One file. `own`: PS put it there (an import, a squad sound, a copy PS made while moving), so PS may delete it.
     * Not own: it was found in the folder (adopted); PS never deletes it (the developer's rule: "PS only ever deletes files PS
     * itself put there").
     */
    data class Entry(val id: String, val path: String, val name: String, val added: Long, val own: Boolean = true)
    /** The index file: the entries and the paths Removed while adopted, so a scan does not bring them back. */
    data class Index(val items: List<Entry>, val ignored: List<String> = emptyList())

    /** {v:1, items:[{id, path, name, added, own}], ignored:[path]}: every good entry, no id or path twice, at most
     *  LIB_MAX. An entry from before `own` existed counts as own only in PS's private folder (`ownDefault`). */
    fun parseIndex(text: String?, ownDefault: Boolean): Index {
        val o = runCatching { JSONObject(text ?: return Index(emptyList())) }.getOrNull() ?: return Index(emptyList())
        val ign = o.optJSONArray("ignored")
        val ignored = (0 until (ign?.length() ?: 0)).mapNotNull { cleanRel(ign!!.optString(it)) }.distinctBy { it.lowercase() }.take(LIB_MAX)
        return Index(parseItems(o.optJSONArray("items"), ownDefault), ignored)
    }
    private fun parseItems(a: JSONArray?, ownDefault: Boolean): List<Entry> {
        a ?: return emptyList()
        val out = ArrayList<Entry>()
        val ids = HashSet<String>(); val paths = HashSet<String>()
        for (i in 0 until a.length()) {
            val o = a.optJSONObject(i) ?: continue
            val id = o.optString("id").lowercase()
            val path = cleanRel(o.optString("path")) ?: continue
            if (!okId(id) || id in ids || path.lowercase() in paths) continue
            ids.add(id); paths.add(path.lowercase())
            val own = if (o.has("own")) o.optBoolean("own", false) else ownDefault
            out.add(Entry(id, path, oneLine(o.optString("name"), NAME_MAX).ifEmpty { baseName(path) }, o.optLong("added", 0).coerceAtLeast(0), own))
            if (out.size >= LIB_MAX) break
        }
        return out
    }
    fun indexJson(ix: Index): String = JSONObject().put("v", 1).put("items", JSONArray().apply {
        ix.items.forEach { put(JSONObject().put("id", it.id).put("path", it.path).put("name", it.name).put("added", it.added).put("own", it.own)) }
    }).put("ignored", JSONArray(ix.ignored)).toString()

    data class Reconciled(val items: List<Entry>, val changed: Boolean, val ignored: List<String> = emptyList())
    /** The index against what is really in the folder (`files`: relative path to size): entries whose file is gone are
     *  dropped, files the index does not know (copied in with Files) are adopted (own false) with a fresh id, except
     *  the ones Removed before (`ignored`, kept only while the file is still there). Paths compare in lower case (the
     *  phone's shared storage does not tell case apart). */
    fun reconcile(index: List<Entry>, files: Map<String, Long>, now: Long, newId: () -> String, ignored: List<String> = emptyList()): Reconciled {
        val have = files.keys.associateBy { it.lowercase() }
        val inIndex = index.map { it.path.lowercase() }.toSet()
        val ign = ignored.filter { it.lowercase() in have && it.lowercase() !in inIndex }
        val skip = ign.map { it.lowercase() }.toSet()
        val kept = index.mapNotNull { e -> have[e.path.lowercase()]?.let { real -> if (real == e.path) e else e.copy(path = real) } }
        val known = kept.map { it.path.lowercase() }.toHashSet()
        val ids = kept.map { it.id }.toHashSet()
        val added = ArrayList<Entry>()
        for (p in files.keys.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it })) {
            if (p.lowercase() in known || p.lowercase() in skip || kept.size + added.size >= LIB_MAX) continue
            var id = newId(); while (id in ids) id = newId()
            ids.add(id); known.add(p.lowercase())
            added.add(Entry(id, p, baseName(p), now, own = false))
        }
        return Reconciled(kept + added, kept.size != index.size || added.isNotEmpty() || ign.size != ignored.size || kept.zip(index).any { (a, b) -> a != b }, ign)
    }

    // ---------- Remove ----------
    data class Removal(val items: List<Entry>, val ignored: List<String>, val delete: List<String>)
    /** Remove `ids`: an own file is deleted; an adopted one only leaves the index and goes on the ignored list, so the
     *  next scan does not add it back. The file itself is never touched. */
    fun removePlan(items: List<Entry>, ignored: List<String>, ids: Set<String>): Removal {
        val gone = items.filter { it.id in ids }
        val adopted = gone.filter { !it.own }.map { it.path }
        return Removal(items.filter { it.id !in ids }, (ignored + adopted).distinctBy { it.lowercase() }.take(LIB_MAX), gone.filter { it.own }.map { it.path })
    }

    // ---------- moving the storage ----------
    data class Copy(val id: String, val from: String, val to: String)
    data class MovePlan(val copies: List<Copy>, val index: List<Entry>)
    /**
     * Moving everything to a new root (contract: copy all, check sizes, write the index, then delete the old copies).
     * `old`: the current index. `target`: what the new root already holds (its own index reconciled with its files),
     * so a folder that already has a Soundboard merges: both sets, clashes renamed (" 2"). An old entry already there
     * (same id, same path) is not copied again. An id in both for different files: the old one keeps it (the timed
     * plays point at it), the target's gets a fresh one. Every copy PS makes there is own; what was already there keeps
     * its own flag. After it worked, only [deleteAfterMove] goes from the old place.
     */
    fun movePlan(old: List<Entry>, target: List<Entry>, targetFiles: Set<String>, newId: () -> String): MovePlan {
        val oldIds = old.map { it.id }.toSet()
        // Names already used in each folder of the new root (lower case), so a clash gets " 2".
        val taken = HashMap<String, HashSet<String>>()
        fun take(p: String) { val l = p.lowercase(); taken.getOrPut(folderOf(l)) { HashSet() }.add(fileOf(l)) }
        (targetFiles + target.map { it.path }).forEach(::take)
        val ids = (oldIds + target.map { it.id }).toHashSet()
        val same = target.filter { t -> old.any { it.id == t.id && it.path.equals(t.path, ignoreCase = true) } }.map { it.id }.toSet()
        val keepTarget = target.map { t ->
            if (t.id in oldIds && t.id !in same) { var id = newId(); while (id in ids) id = newId(); ids.add(id); t.copy(id = id) } else t
        }.filter { it.id !in same }
        val copies = ArrayList<Copy>()
        val moved = ArrayList<Entry>()
        for (e in old) {
            val there = target.firstOrNull { it.id == e.id && it.id in same }
            if (there != null) { moved.add(e.copy(path = there.path, own = there.own)); continue }
            val folder = folderOf(e.path)
            val to = join(folder, freeName(fileOf(e.path), taken[folder.lowercase()] ?: emptySet()))
            take(to)
            copies.add(Copy(e.id, e.path, to))
            moved.add(e.copy(path = to, own = true))
        }
        return MovePlan(copies, (moved + keepTarget).take(LIB_MAX))
    }

    /** What leaves the old place once a move worked: only the files PS put there. Adopted files stay, untouched. */
    fun deleteAfterMove(old: List<Entry>): List<String> = old.filter { it.own }.map { it.path }

    /** A folder picked as the new place must not be inside the current one, or hold it (tree document ids of one app). */
    fun nested(a: String, b: String): Boolean {
        val x = a.trimEnd('/'); val y = b.trimEnd('/')
        if (x == y) return true
        fun under(c: String, p: String) = c.startsWith("$p/") || (p.endsWith(":") && c.startsWith(p))
        return under(x, y) || under(y, x)
    }

    /** A short readable place for a picked folder, never a full path: "Internal storage > Music > Sounds". The document
     *  id of the phone's own storage is "primary:Music/Sounds"; a card or a stick is "1A2B-3C4D:Music". */
    fun treeLabel(docId: String?, rootName: String?): String {
        val id = docId ?: ""
        val colon = id.indexOf(':')
        if (colon > 0 && Regex("^(primary|[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4})$").matches(id.substring(0, colon))) {
            val head = if (id.substring(0, colon) == "primary") "Internal storage" else "SD card or USB"
            val parts = id.substring(colon + 1).split('/').filter { it.isNotBlank() }.map { oneLine(it, 40) }
            val shown = if (parts.size > 3) listOf("...") + parts.takeLast(2) else parts
            return (listOf(head) + shown).joinToString(" > ")
        }
        return oneLine(rootName, 60).ifEmpty { "Your chosen folder" }
    }

    // ---------- byte ranges for the player ----------
    data class Serve(val status: Int, val start: Long, val length: Long, val contentRange: String?)
    /** The player's Range header for a file of `size` bytes: 200 whole, 206 a part, 416 past the end. */
    fun serve(range: String?, size: Long): Serve = when (val r = VideoRange.parse(range, size)) {
        VideoRange.Result.Whole -> Serve(200, 0, size, null)
        VideoRange.Result.Bad -> if (size == 0L && range == null) Serve(200, 0, 0, null) else Serve(416, 0, 0, "bytes */$size")
        is VideoRange.Result.Part -> Serve(206, r.span.start, r.span.length, "bytes ${r.span.start}-${r.span.end}/$size")
    }

    // ---------- sb:read and sb:put ----------
    /** A piece the page may read for the squad: audio of 10 MB or less, at most 1 MB from `off`. Null when refused. */
    fun readSpan(kind: String?, size: Long, off: Long, len: Int): Pair<Long, Int>? {
        if (kind != "audio" || size <= 0 || size > SHARE_MAX || off < 0 || off >= size || len <= 0 || len > CHUNK_MAX) return null
        return off to minOf(len.toLong(), size - off).toInt()
    }
    /** A sound arriving from the squad, piece by piece: the next piece must start where the last one ended. */
    fun putOk(tmp: String?, ext: String?, off: Long, have: Long, len: Int): Boolean =
        okId(tmp) && (ext ?: "").lowercase() in AUDIO && off == have && len in 0..CHUNK_MAX && have + len <= SHARE_MAX

    // ---------- timed plays (sb:plan) ----------
    data class Play(val id: String, val media: String, val name: String, val at: String, val days: List<Int>, val vol: Double, val loop: Boolean)

    fun parsePlan(items: JSONArray?): List<Play> {
        val out = ArrayList<Play>()
        for (i in 0 until (items?.length() ?: 0)) {
            val o = items!!.optJSONObject(i) ?: continue
            val id = o.optString("id"); val media = o.optString("media").lowercase(); val at = o.optString("at")
            if (!PLAY_ID.matches(id) || !okId(media) || !HHMM.matches(at) || out.any { it.id == id }) continue
            val days = sortedSetOf<Int>()
            o.optJSONArray("days")?.let { a -> for (k in 0 until a.length()) { val d = a.opt(k); if (d is Number && d.toDouble() == d.toInt().toDouble() && d.toInt() in 0..6) days.add(d.toInt()) } }
            val v = o.opt("vol").let { if (it is Number) it.toDouble() else 0.8 }.let { if (it.isNaN()) 0.8 else it }
            out.add(Play(id, media, oneLine(o.optString("name"), NAME_MAX).ifEmpty { "Untitled" }, at, if (days.isEmpty()) (0..6).toList() else days.toList(),
                Math.round(v.coerceIn(0.1, 1.0) * 100) / 100.0, o.optBoolean("loop", false)))
            if (out.size >= PLAYS_MAX) break
        }
        return out
    }
    fun planJson(plays: List<Play>): JSONArray = JSONArray().apply {
        plays.forEach { put(JSONObject().put("id", it.id).put("media", it.media).put("name", it.name).put("at", it.at).put("days", JSONArray(it.days)).put("vol", it.vol).put("loop", it.loop)) }
    }

    private fun dayOf(ts: Long, z: ZoneId) = Instant.ofEpochMilli(ts).atZone(z).toLocalDate().toString()
    /** The next time it plays, strictly after `now`, in the phone's zone; -1 when none (soundboard.ts nextFire). */
    fun nextFire(p: Play, now: Long, z: ZoneId): Long {
        if (p.days.isEmpty()) return -1
        val today = dayOf(now, z)
        for (i in 0..8) {
            val day = RemClock.addDays(today, i)
            if (RemClock.weekdayOf(day) !in p.days) continue
            val ts = RemClock.zonedToTs(day, p.at, z)
            if (ts > now) return ts
        }
        return -1
    }
    /** When the one alarm goes off next: the soonest play after `now`, -1 when none. */
    fun soonest(plays: List<Play>, now: Long, z: ZoneId): Long = plays.map { nextFire(it, now, z) }.filter { it > 0 }.minOrNull() ?: -1
    fun firedKey(p: Play, at: Long) = "${p.id}@$at"
    /** What rings now: the plays due in the last LATE_MS that have not rung yet. Never two at once: the latest one rings
     *  (the last in the list when two share a time) and the others count as played. */
    data class Due(val ring: Play?, val at: Long, val fired: List<String>)
    fun due(plays: List<Play>, now: Long, z: ZoneId, fired: Set<String>): Due {
        val hits = plays.mapNotNull { p -> nextFire(p, now - LATE_MS, z).takeIf { it in 1..now && firedKey(p, it) !in fired }?.let { p to it } }
        val pick = hits.withIndex().maxWithOrNull(compareBy({ it.value.second }, { it.index }))?.value
        return Due(pick?.first, pick?.second ?: 0, hits.map { firedKey(it.first, it.second) })
    }
    /** Keys of plays that rang in the last two days (enough for any DST day); older ones go. */
    fun prune(fired: Set<String>, now: Long): Set<String> = fired.filter { k -> k.substringAfterLast('@').toLongOrNull()?.let { it > now - 2 * 86_400_000L } == true }.toSet()
}
