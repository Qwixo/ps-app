package com.cincee.ps.gos

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.webkit.WebResourceResponse
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.FilterInputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.time.ZoneId
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * The Soundboard on the phone (V1.47, the shell half; the page is web src/soundboard/, its rules
 * src/core/soundboard.ts, the pure rules here in SbClock.kt). The developer, 10 Nov 2026: a full screen Soundboard with all your
 * audio and video files, stored locally in a place you can change, a timed play ("play it at 7:07am"), sharing a sound
 * in the G Squad.
 *  - Files live in PS's own folder (filesDir/soundboard, private, no permission), or in a folder the developer picks (a
 *    persistable read and write grant, DocumentsContract). `<root>/<folder>/<file>.<ext>` and the index
 *    `<root>/.ps-soundboard.json`. Imports are copies; Remove deletes only our copy.
 *  - Moving the storage: copy every file, check each size, write the index there, only then delete the old copies.
 *    Any failure: the partial new copies go, the old place stays, an error goes to the page.
 *  - The player gets `/client/media/<id>.<ext>` with byte ranges (WebHost.shouldInterceptRequest, serve below).
 *  - Timed plays: one exact alarm clock at the soonest one; at the time a foreground service plays the file on the
 *    alarm stream at the plan's alarm level (the alarm volume set while it plays, put back after, like Sleep mode),
 *    a notification with the file name, Stop and Open. Once ends at the file's end, loop rings at most 10 minutes.
 *    A new one replaces the old. Like Sleep mode's alarms and the gym ring it is an alarm: it rings through PS Do Not
 *    Disturb (nothing here asks Dnd); the phone's own Do Not Disturb lets it through as it does any alarm.
 * Threads: every message is handed to "ps-sound" (quick work: the list, reads, a squad piece, the plan) or
 * "ps-sound-copy" (imports, moving the storage, landing a squad sound), never the main thread. The ring's player
 * lives on "ps-sound-ring" (prepareAsync there). The main thread only opens the pickers.
 */
object Soundboard {
    const val RING = "sb_ring"
    internal const val RING_ID = 61
    private const val PINK = "#EC4E86"
    val TYPES = setOf("sb:get", "sb:add", "sb:remove", "sb:rename", "sb:location", "sb:plan", "sb:stop", "sb:open", "sb:read", "sb:put")

    private val ex = Executors.newSingleThreadExecutor { r -> Thread(r, "ps-sound") }
    private val long = Executors.newSingleThreadExecutor { r -> Thread(r, "ps-sound-copy") }
    private fun quick(what: String, f: () -> Unit) = ex.execute { runCatching(f).onFailure { Plog.i("sb: $what failed (${it.javaClass.simpleName})") } }
    private fun slow(what: String, f: () -> Unit) = long.execute { runCatching(f).onFailure { Plog.i("sb: $what failed (${it.javaClass.simpleName})") } }

    private fun sp(c: Context) = c.getSharedPreferences("sb", Context.MODE_PRIVATE)
    private fun zone(): ZoneId = ZoneId.systemDefault()

    // ---------- to the page ----------
    private fun send(o: JSONObject) = WebHost.post(o.put("type", "sb"))
    private fun error(text: String) = send(JSONObject().put("ev", "error").put("text", text))
    private fun progress(done: Int, total: Int, name: String) = send(JSONObject().put("ev", "progress").put("done", done).put("total", total).put("name", name))

    // ---------- from the page (the bridge thread) ----------
    fun onMessage(c: Context, type: String, m: JSONObject) {
        when (type) {
            "sb:get" -> quick("get") { postLib(c, load(c)) }
            "sb:add" -> pick(c, m.optString("what"))
            "sb:remove" -> quick("remove") { remove(c, m.optJSONArray("ids")) }
            "sb:rename" -> quick("rename") { rename(c, m.optString("id"), m.optString("name")) }
            "sb:location" -> location(c, m.optString("act"))
            "sb:plan" -> quick("plan") { setPlan(c, m.optJSONArray("items")) }
            "sb:stop" -> stop(c, "page")
            "sb:open" -> {}   // the Mac's file drops follow this; nothing on the phone
            "sb:read" -> quick("read") { read(c, m.optString("id").lowercase(), m.optLong("off", -1), m.optInt("len", 0)) }
            "sb:put" -> quick("put") { put(c, m) }
        }
    }
    /** A squad piece (up to 1 MB as base64) straight from the listener: read here, never on the bridge thread. */
    fun onRaw(c: Context, raw: String) = quick("put") { put(c, JSONObject(raw)) }

    // ---------- the storage ----------
    private val lock = Any()
    @Volatile private var root: SbRoot? = null
    /** The index as last read or written, with sizes, for the player and the ring (id to entry). */
    private class Cache(val key: String, val items: List<SbClock.Entry>, val sizes: Map<String, Long>, val ignored: List<String> = emptyList()) {
        val byId = items.associateBy { it.id }
    }
    @Volatile private var cache: Cache? = null
    @Volatile private var moving = false
    private val jobs = AtomicInteger(0)

    private fun defaultDir(c: Context) = File(c.filesDir, "soundboard")
    private fun root(c: Context): SbRoot = synchronized(lock) {
        val tree = sp(c).getString("tree", null)
        val key = tree ?: FileRoot.KEY
        root?.takeIf { it.key == key }?.let { return it }
        val r = if (tree == null) FileRoot(defaultDir(c)) else SafRoot(c.contentResolver, Uri.parse(tree))
        root = r; cache = null
        r
    }

    private class Loaded(val root: SbRoot, val items: List<SbClock.Entry>, val sizes: Map<String, Long>, val ok: Boolean)
    /** The folder scanned and the index brought up to date (files gone dropped, files copied in added). */
    private fun load(c: Context): Loaded = synchronized(lock) {
        val r = root(c)
        if (!r.ok()) { cache = Cache(r.key, emptyList(), emptyMap()); return Loaded(r, emptyList(), emptyMap(), false) }
        val files = r.list(SbClock.DEPTH_MAX)
        val ix = SbClock.parseIndex(r.readIndex(), ownDefault = !r.custom)
        val rec = SbClock.reconcile(ix.items, files, System.currentTimeMillis(), { SbClock.newId() }, ix.ignored)
        if (rec.changed) runCatching { r.writeIndex(SbClock.indexJson(SbClock.Index(rec.items, rec.ignored))) }.onFailure { Plog.i("sb: index not written (${it.javaClass.simpleName})") }
        if (jobs.get() == 0) runCatching { r.dropParts() }
        val sizes = files.mapKeys { it.key.lowercase() }
        cache = Cache(r.key, rec.items, sizes, rec.ignored)
        Loaded(r, rec.items, sizes, true)
    }
    /** The index as cached, else as written in the folder (no scan: the alarm and the player must not wait on one). */
    private fun current(c: Context): Cache = synchronized(lock) {
        val r = root(c)
        cache?.takeIf { it.key == r.key }?.let { return it }
        val ix = runCatching { SbClock.parseIndex(r.readIndex(), ownDefault = !r.custom) }.getOrDefault(SbClock.Index(emptyList()))
        Cache(r.key, ix.items, emptyMap(), ix.ignored).also { cache = it }
    }
    /** What an edit may change: the entries, their sizes and the ignored paths. */
    private class Ed(val list: MutableList<SbClock.Entry>, val sizes: MutableMap<String, Long>, var ignored: List<String>)
    /** The index changed by `f` (under the lock), written, cached. */
    private fun <T> edit(c: Context, f: (Ed) -> T): T = synchronized(lock) {
        val r = root(c)
        val cur = current(c)
        val ed = Ed(cur.items.toMutableList(), cur.sizes.toMutableMap(), cur.ignored)
        val out = f(ed)
        r.writeIndex(SbClock.indexJson(SbClock.Index(ed.list, ed.ignored)))
        cache = Cache(r.key, ed.list.toList(), ed.sizes, ed.ignored)
        out
    }
    /** The file for an id: its root and entry, or null. For the player, the ring and sb:read. */
    private fun find(c: Context, id: String): Pair<SbRoot, SbClock.Entry>? {
        if (!SbClock.okId(id)) return null
        val r = root(c)
        val e = current(c).byId[id] ?: return null
        return r to e
    }

    private fun postLib(c: Context, l: Loaded? = null) {
        val cur = l ?: load(c)
        if (!cur.ok) error(if (cur.root.custom) "PS app cannot reach your Soundboard folder any more. Pick it again, or go back to the default folder." else "PS app cannot open its Soundboard folder on this phone.")
        val items = JSONArray()
        for (e in cur.items) {
            val ext = SbClock.extOf(e.path)
            items.put(JSONObject().put("id", e.id).put("name", e.name).put("ext", ext).put("kind", SbClock.kindOf(ext))
                .put("size", cur.sizes[e.path.lowercase()] ?: 0L).put("folder", SbClock.folderOf(e.path)).put("added", e.added))
        }
        send(JSONObject().put("ev", "lib").put("items", items).put("loc", JSONObject().put("label", cur.root.label).put("custom", cur.root.custom)))
    }

    // ---------- remove and rename ----------
    private fun busyMoving(): Boolean { if (moving) error("PS app is still moving your Soundboard. Try again when it is done."); return moving }
    private fun remove(c: Context, ids: JSONArray?) {
        if (busyMoving()) return
        val want = (0 until (ids?.length() ?: 0)).map { ids!!.optString(it).lowercase() }.filter { SbClock.okId(it) }.toSet()
        if (want.isEmpty()) { postLib(c); return }
        if (ringing?.media?.let { it in want } == true) stop(c, "removed")
        val r = root(c)
        // PS only ever deletes files PS itself put there: an adopted file just leaves the list (and stays ignored).
        val plan = edit(c) { ed ->
            val p = SbClock.removePlan(ed.list, ed.ignored, want)
            ed.list.clear(); ed.list.addAll(p.items); ed.ignored = p.ignored
            ed.sizes.keys.retainAll(p.items.map { it.path.lowercase() }.toSet())
            p
        }
        for (path in plan.delete) {
            runCatching { r.delete(path) }.onFailure { Plog.i("sb: a copy was not deleted (${it.javaClass.simpleName})") }
            if (!r.custom) runCatching { r.prune(SbClock.folderOf(path)) }   // empty folders in PS's own folder go too
        }
        Plog.i("sb: removed ${want.size} (${plan.delete.size} deleted, the rest left in place)")
        postLib(c)
    }
    private fun rename(c: Context, id: String, name: String) {
        if (busyMoving()) return
        val n = SbClock.oneLine(name, SbClock.NAME_MAX)
        if (n.isEmpty()) { error("A name needs at least one character."); postLib(c); return }
        edit(c) { ed -> val i = ed.list.indexOfFirst { it.id == id.lowercase() }; if (i >= 0) ed.list[i] = ed.list[i].copy(name = n) }
        postLib(c)
    }

    // ---------- importing (sb:add) ----------
    private fun pick(c: Context, what: String) {
        val a = WebHost.activity ?: return error("Open PS app to add files.")
        android.os.Handler(android.os.Looper.getMainLooper()).post {
            when (what) {
                "files" -> a.sbPickFiles { uris -> if (uris.isEmpty()) quick("get") { postLib(c) } else slow("import") { importFiles(c, uris) } }
                "folder" -> a.sbPickTree { tree -> if (tree == null) quick("get") { postLib(c) } else slow("import") { importFolder(c, tree) } }
            }
        }
    }
    /** One copy into the root: hidden while it is written, its size checked, then in the index. */
    private fun copyIn(c: Context, folder: String, file: String, display: String, size: Long, names: MutableSet<String>, open: () -> InputStream?): String {
        val r = root(c)
        val want = SbClock.freeName(file, names)
        val rel = r.write(folder, want, size) { out -> (open() ?: throw IOException("no source")).use { copy(it, out, SbClock.FILE_MAX) } }
        names.add(SbClock.fileOf(rel).lowercase())
        val real = r.size(rel)
        edit(c) { ed ->
            val list = ed.list
            // A scan in between may have found it first (as adopted): keep that entry, but PS wrote this file, so it is own.
            val i = list.indexOfFirst { it.path.equals(rel, ignoreCase = true) }
            if (i >= 0) list[i] = list[i].copy(name = display, own = true)
            else if (list.size < SbClock.LIB_MAX)
                list.add(SbClock.Entry(SbClock.newId().let { id -> var x = id; while (list.any { it.id == x }) x = SbClock.newId(); x }, rel, display, System.currentTimeMillis(), own = true))
            ed.ignored = ed.ignored.filterNot { it.equals(rel, ignoreCase = true) }
            ed.sizes[rel.lowercase()] = real
        }
        return rel
    }
    private class Meta(val name: String, val size: Long)
    private fun meta(cr: ContentResolver, u: Uri): Meta? = runCatching {
        cr.query(u, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { k ->
            if (!k.moveToFirst()) null else Meta(k.getString(0) ?: "", if (k.isNull(1)) -1 else k.getLong(1))
        }
    }.getOrNull()

    private fun importFiles(c: Context, uris: List<Uri>) {
        jobs.incrementAndGet()
        try {
            val cr = c.contentResolver
            val have = current(c).items.size
            var n = 0; var skipped = 0; var failed = 0
            val names = root(c).names("").toMutableSet()
            progress(0, uris.size, "")
            for ((i, u) in uris.withIndex()) {
                val m = meta(cr, u)
                val ext = SbClock.extOf(m?.name ?: "")
                if (m == null || SbClock.kindOf(ext) == null || m.size == 0L || m.size > SbClock.FILE_MAX || have + n >= SbClock.LIB_MAX) { skipped++; progress(i + 1, uris.size, m?.name ?: ""); continue }
                progress(i, uris.size, m.name)
                val ok = runCatching { copyIn(c, "", SbClock.fileName(SbClock.baseName(m.name), ext), SbClock.baseName(m.name), m.size, names) { cr.openInputStream(u) } }
                    .onFailure { Plog.i("sb: a file was not copied (${it.javaClass.simpleName})") }.isSuccess
                if (ok) n++ else { skipped++; failed++ }
                progress(i + 1, uris.size, m.name)
            }
            Plog.i("sb: added $n files, skipped $skipped")
            postLib(c)
            send(JSONObject().put("ev", "added").put("n", n).put("skipped", skipped))
            if (failed > 0) error("PS app could not copy $failed of them. The phone may be short of space.")
        } finally { jobs.decrementAndGet() }
    }
    /** A whole folder (and its subfolders, at most 4 deep with its own name), copied in. The grant is for this once. */
    private fun importFolder(c: Context, tree: Uri) {
        jobs.incrementAndGet()
        try {
            val src = SafRoot(c.contentResolver, tree)
            val top = SbClock.safeName(src.rootName(), 60).ifEmpty { "Folder" }
            val all = src.list(SbClock.DEPTH_MAX - 1, media = false)
            val take = all.filter { (p, s) -> SbClock.isMedia(SbClock.fileOf(p)) && s != 0L && s <= SbClock.FILE_MAX }
                .keys.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it })
            var skipped = all.size - take.size
            val have = current(c).items.size
            var n = 0; var failed = 0
            val names = HashMap<String, MutableSet<String>>()
            progress(0, take.size, "")
            for ((i, p) in take.withIndex()) {
                val file = SbClock.fileOf(p)
                if (have + n >= SbClock.LIB_MAX) { skipped++; continue }
                progress(i, take.size, file)
                val folder = SbClock.cleanFolder(listOf(top) + SbClock.folderOf(p).split('/').filter { it.isNotEmpty() })
                val set = names.getOrPut(folder.lowercase()) { root(c).names(folder).toMutableSet() }
                val ok = runCatching { copyIn(c, folder, SbClock.fileName(SbClock.baseName(file), SbClock.extOf(file)), SbClock.baseName(file), all[p] ?: -1, set) { src.open(p, 0) } }
                    .onFailure { Plog.i("sb: a file was not copied (${it.javaClass.simpleName})") }.isSuccess
                if (ok) n++ else { skipped++; failed++ }
                progress(i + 1, take.size, file)
            }
            Plog.i("sb: folder added $n files, skipped $skipped")
            postLib(c)
            send(JSONObject().put("ev", "added").put("n", n).put("skipped", skipped))
            if (failed > 0) error("PS app could not copy $failed of them. The phone may be short of space.")
        } finally { jobs.decrementAndGet() }
    }

    // ---------- moving the storage (sb:location) ----------
    private fun location(c: Context, act: String) {
        when (act) {
            "default" -> slow("move") { moveTo(c, null) }
            "choose" -> {
                val a = WebHost.activity ?: return error("Open PS app to pick a folder.")
                android.os.Handler(android.os.Looper.getMainLooper()).post {
                    a.sbPickTree { tree -> if (tree == null) quick("get") { postLib(c) } else slow("move") { moveTo(c, tree) } }
                }
            }
        }
    }
    private const val RW = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION

    private fun moveTo(c: Context, tree: Uri?) {
        val cr = c.contentResolver
        moving = true; jobs.incrementAndGet()
        try {
            val from = load(c)
            val old = from.root
            if (tree == null && old.key == FileRoot.KEY) { postLib(c, from); return }
            if (tree != null && tree.toString() == old.key) { postLib(c, from); return }
            if (tree != null) {
                if (old is SafRoot && old.tree.authority == tree.authority &&
                    SbClock.nested(old.rootId, runCatching { DocumentsContract.getTreeDocumentId(tree) }.getOrDefault(""))) {
                    error("Pick a folder that is not inside the current one."); postLib(c, from); return
                }
                if (runCatching { cr.takePersistableUriPermission(tree, RW) }.isFailure) {
                    error("PS app could not keep access to that folder. Try another one."); postLib(c, from); return
                }
            }
            val dest: SbRoot = if (tree == null) FileRoot(defaultDir(c)) else SafRoot(cr, tree)
            fun giveUp(text: String) {
                if (tree != null) runCatching { cr.releasePersistableUriPermission(tree, RW) }
                error(text); postLib(c, from)
            }
            if (!dest.ok()) return giveUp("PS app cannot write to that folder. Try another one.")
            if (!from.ok && from.root.custom) Plog.i("sb: the old folder cannot be reached, moving what is listed")
            val destFiles = dest.list(SbClock.DEPTH_MAX)
            val destIx = SbClock.parseIndex(dest.readIndex(), ownDefault = !dest.custom)
            val destRec = SbClock.reconcile(destIx.items, destFiles, System.currentTimeMillis(), { SbClock.newId() }, destIx.ignored)
            val destItems = destRec.items
            val plan = SbClock.movePlan(from.items, destItems, destFiles.keys) { SbClock.newId() }
            // Copy everything, each size checked. Nothing old is touched until the index is written there.
            val made = ArrayList<String>()
            val placed = HashMap<String, String>()   // id to the path it really got
            val missing = HashSet<String>()
            val sizes = HashMap<String, Long>()
            destFiles.forEach { (p, s) -> sizes[p.lowercase()] = s }
            val total = plan.copies.size
            try {
                for ((i, cp) in plan.copies.withIndex()) {
                    progress(i, total, SbClock.fileOf(cp.to))
                    val size = old.size(cp.from)
                    if (size < 0) { missing.add(cp.id); continue }   // gone since the scan: dropped, not a failure
                    val rel = dest.write(SbClock.folderOf(cp.to), SbClock.fileOf(cp.to), size) { out -> old.open(cp.from, 0).use { copy(it, out, SbClock.FILE_MAX) } }
                    made.add(rel)
                    val got = dest.size(rel)
                    if (got != size) throw IOException("size $got not $size")
                    placed[cp.id] = rel; sizes[rel.lowercase()] = got
                }
                val index = plan.index.filter { it.id !in missing }.map { e -> placed[e.id]?.let { e.copy(path = it) } ?: e }
                dest.writeIndex(SbClock.indexJson(SbClock.Index(index, destRec.ignored)))
                // Now the new place is the place.
                synchronized(lock) {
                    if (tree == null) sp(c).edit().remove("tree").commit() else sp(c).edit().putString("tree", tree.toString()).commit()
                    root = dest
                    cache = Cache(dest.key, index, sizes, destRec.ignored)
                }
            } catch (e: Throwable) {
                Plog.i("sb: move failed (${e.javaClass.simpleName}), the old place stays")
                for (p in made) runCatching { dest.delete(p); dest.prune(SbClock.folderOf(p)) }
                return giveUp("PS app could not move your Soundboard, so everything stays where it was.")
            }
            progress(total, total, "")
            postLib(c)
            // Only now: from the old place go only the files PS put there, and the old index. Adopted files (found
            // there, not written by PS) stay where they were, untouched. Files imported FROM elsewhere were never here.
            for (path in SbClock.deleteAfterMove(from.items)) runCatching { old.delete(path); old.prune(SbClock.folderOf(path)) }
            runCatching { old.deleteIndex() }
            if (old is SafRoot) runCatching { cr.releasePersistableUriPermission(old.tree, RW) }
            Plog.i("sb: moved ${plan.copies.size} files to ${if (dest.custom) "a picked folder" else "PS on this phone"}")
        } finally { moving = false; jobs.decrementAndGet() }
    }

    // ---------- sharing in the G Squad (sb:read, sb:put) ----------
    private fun read(c: Context, id: String, off: Long, len: Int) {
        val (r, e) = find(c, id) ?: return error("That file is not on this phone any more.")
        val size = r.size(e.path)
        val span = SbClock.readSpan(SbClock.kindOf(SbClock.extOf(e.path)), size, off, len)
            ?: return error("Only audio files of 10 MB or less can be shared in the squad.")
        val buf = ByteArray(span.second)
        r.open(e.path, span.first).use { s -> var got = 0; while (got < buf.size) { val k = s.read(buf, got, buf.size - got); if (k < 0) break; got += k }; if (got < buf.size) throw IOException("short") }
        send(JSONObject().put("ev", "chunk").put("id", id).put("off", span.first).put("size", size).put("b64", java.util.Base64.getEncoder().encodeToString(buf)))
    }
    private fun putDir(c: Context) = File(c.cacheDir, "sb-put").apply { mkdirs() }
    private fun put(c: Context, m: JSONObject) {
        val tmp = m.optString("tmp").lowercase(); val ext = m.optString("ext").lowercase().removePrefix(".")
        val off = m.optLong("off", -1)
        val f = File(putDir(c), tmp)
        val bytes = runCatching { java.util.Base64.getDecoder().decode(m.optString("b64")) }.getOrNull()
        if (off == 0L) putDir(c).listFiles()?.forEach { if (it.lastModified() < System.currentTimeMillis() - 3_600_000) it.delete() }   // pieces left from before
        val have = if (off == 0L) 0L else if (f.isFile) f.length() else -1L
        if (bytes == null || !SbClock.putOk(tmp, ext, off, have, bytes.size)) {
            if (SbClock.okId(tmp)) f.delete()
            Plog.i("sb: a squad piece was refused")
            return error("PS app could not receive that sound. Only audio of 10 MB or less can come from the squad.")
        }
        FileOutputStream(f, off != 0L).use { it.write(bytes) }
        if (!m.optBoolean("last")) return
        val name = m.optString("name").let { n -> if (n.lowercase().endsWith(".$ext")) n.dropLast(ext.length + 1) else n }
        slow("squad") { land(c, f, name, ext) }
    }
    /** The last piece arrived: the sound lands in "From your squad" (after any move or import still running). */
    private fun land(c: Context, f: File, name: String, ext: String) {
        try {
            if (!f.isFile || f.length() == 0L) return error("PS app could not receive that sound.")
            jobs.incrementAndGet()
            try {
                val names = root(c).names(SbClock.SQUAD).toMutableSet()
                // The squad's own title is the display name; the file gets a safe version of it.
                val title = SbClock.oneLine(name, SbClock.NAME_MAX).ifEmpty { "Untitled" }
                copyIn(c, SbClock.SQUAD, SbClock.fileName(name, ext), title, f.length(), names) { FileInputStream(f) }
                Plog.i("sb: a squad sound landed (${f.length() / 1024} KB)")
            } finally { jobs.decrementAndGet() }
            postLib(c)
        } catch (e: Throwable) {
            Plog.i("sb: squad sound not kept (${e.javaClass.simpleName})")
            error("PS app could not keep that sound on this phone.")
        } finally { f.delete() }
    }

    // ---------- serving to the player (WebView's own threads, never the main thread) ----------
    fun serve(c: Context, file: String, range: String?, headers: Map<String, String>): WebResourceResponse {
        val id = file.substringBefore('.').lowercase()
        val nf = WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers, ByteArrayInputStream(ByteArray(0)))
        val (r, e) = runCatching { find(c, id) }.getOrNull() ?: return nf
        val size = runCatching { r.size(e.path) }.getOrDefault(-1L)
        if (size < 0) return nf
        val mime = SbClock.mimeOf(SbClock.extOf(e.path))
        val s = SbClock.serve(range, size)
        val h = headers + mapOf("Accept-Ranges" to "bytes")
        return when (s.status) {
            416 -> WebResourceResponse(mime, null, 416, "Range Not Satisfiable", h + mapOf("Content-Range" to s.contentRange!!), ByteArrayInputStream(ByteArray(0)))
            206 -> WebResourceResponse(mime, null, 206, "Partial Content",
                h + mapOf("Content-Range" to s.contentRange!!, "Content-Length" to s.length.toString()),
                runCatching { Limit(r.open(e.path, s.start), s.length) }.getOrElse { return nf })
            else -> WebResourceResponse(mime, null, 200, "OK", h + mapOf("Content-Length" to size.toString()),
                runCatching { r.open(e.path, 0) }.getOrElse { return nf })
        }
    }
    /** At most `left` bytes of a stream. */
    private class Limit(s: InputStream, private var left: Long) : FilterInputStream(s) {
        override fun read(): Int { if (left <= 0) return -1; val b = super.read(); if (b >= 0) left--; return b }
        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (left <= 0) return -1
            val n = super.read(b, off, minOf(len.toLong(), left).toInt())
            if (n > 0) left -= n
            return n
        }
        override fun available(): Int = minOf(super.available().toLong(), left).toInt()
    }
    /** Streams, never the whole file in memory; refuses past `max`. */
    internal fun copy(i: InputStream, o: OutputStream, max: Long): Long {
        val buf = ByteArray(256 * 1024)
        var n = 0L
        while (true) {
            val k = i.read(buf); if (k < 0) break
            n += k
            if (n > max) throw IOException("too big")
            o.write(buf, 0, k)
        }
        return n
    }

    // ---------- timed plays (sb:plan) ----------
    private fun plays(c: Context) = SbClock.parsePlan(runCatching { JSONArray(sp(c).getString("plan", null) ?: "[]") }.getOrNull())
    private fun setPlan(c: Context, items: JSONArray?) {
        val p = SbClock.parsePlan(items)
        sp(c).edit().putString("plan", SbClock.planJson(p).toString()).apply()
        Plog.i("sb: ${p.size} timed plays")
        arm(c)
    }
    private fun alarmIntent(c: Context) = PendingIntent.getBroadcast(c, 6101, Intent(c, SbAlarm::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    private fun arm(c: Context) {
        val am = c.getSystemService(AlarmManager::class.java)
        am.cancel(alarmIntent(c))
        val now = System.currentTimeMillis()
        val at = SbClock.soonest(plays(c), now, zone()).takeIf { it > 0 }?.coerceAtLeast(now + 1000) ?: return
        // A real alarm clock (exact through Doze, the alarm icon), like Sleep mode's alarms and the gym ring.
        if (am.canScheduleExactAlarms()) am.setAlarmClock(AlarmManager.AlarmClockInfo(at, Notifier.openIntent(c, "soundboard", 6102)), alarmIntent(c))
        else am.setWindow(AlarmManager.RTC_WAKEUP, at, 60_000, alarmIntent(c))
    }
    /** A reboot, an update, the clock or zone changing: the alarm armed again (and a volume left from a ring put back). */
    fun restore(c: Context, done: (() -> Unit)? = null) = ex.execute {
        try { arm(c); if (ringing == null) rh.post { giveVolumeBack(c) } } catch (e: Throwable) { Plog.i("sb: restore failed (${e.javaClass.simpleName})") }
        finally { done?.invoke() }
    }
    /** The alarm: what is due now rings (one at most), the next one is armed. */
    fun alarm(c: Context, done: () -> Unit) = ex.execute {
        try {
            val now = System.currentTimeMillis()
            val plays = plays(c)
            val fired = sp(c).getStringSet("fired", emptySet())!!.toSet()
            val d = SbClock.due(plays, now, zone(), fired)
            sp(c).edit().putStringSet("fired", SbClock.prune(fired + d.fired, now)).apply()
            d.ring?.let { p ->
                val hit = runCatching { find(c, p.media) }.getOrNull()
                if (hit == null) Plog.i("sb: a timed play's file is gone, skipped")
                else ring(c, Ring(p.id, p.media, hit.second.name, p.vol, p.loop))
            }
            arm(c)
        } catch (e: Throwable) { Plog.i("sb: alarm failed (${e.javaClass.simpleName})") }
        finally { done() }
    }

    // ---------- the ring ----------
    class Ring(val plan: String, val media: String, val name: String, val vol: Double, val loop: Boolean) {
        fun into(i: Intent): Intent = i.putExtra("plan", plan).putExtra("media", media).putExtra("name", name).putExtra("vol", vol).putExtra("loop", loop)
        companion object {
            fun from(i: Intent?): Ring? {
                i ?: return null
                val plan = i.getStringExtra("plan") ?: return null; val media = i.getStringExtra("media") ?: return null
                return Ring(plan, media, i.getStringExtra("name") ?: "Soundboard", i.getDoubleExtra("vol", 0.8), i.getBooleanExtra("loop", false))
            }
        }
    }
    private val rt = HandlerThread("ps-sound-ring").apply { start() }
    private val rh = Handler(rt.looper)
    @Volatile private var ringing: Ring? = null
    private var player: MediaPlayer? = null
    private var focus: AudioFocusRequest? = null
    private var ringCtx: Context? = null
    private val timeUp = Runnable { ringCtx?.let { finish(it, "10 minutes") } }
    private val stuck = Runnable { ringCtx?.let { if (runCatching { player?.isPlaying }.getOrNull() != true) finish(it, "did not start") } }

    private fun ring(c: Context, r: Ring) {
        Plog.i("sb: timed play ${r.plan} rings")
        runCatching { c.startForegroundService(r.into(Intent(c, SbRingService::class.java))) }.onFailure {
            // The exact alarm lets PS start the service; if the system refuses anyway, it plays with the notification only.
            Plog.i("sb: no ring service (${it.javaClass.simpleName}), notification only")
            if (can(c)) nm(c).notify(RING_ID, notice(c, r.name))
            play(c, r)
        }
    }
    /** From the ring service (or the fallback above): on the ring thread, the player prepared there. */
    fun play(c: Context, r: Ring) = rh.post { start(c.applicationContext, r) }
    private fun start(c: Context, r: Ring) {
        ringing?.let { finish(c, "replaced", stopService = false) }   // never two at once
        val hit = runCatching { find(c, r.media) }.getOrNull()
        if (hit == null) { Plog.i("sb: the file is gone, nothing rings"); return stopService(c) }
        val (root, e) = hit
        ringing = r; ringCtx = c
        holdVolume(c, r.vol)
        val attrs = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build()
        focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(attrs).build().also {
            runCatching { c.getSystemService(AudioManager::class.java).requestAudioFocus(it) }
        }
        val mp = MediaPlayer()
        player = mp
        try {
            mp.setAudioAttributes(attrs)
            val f = root.fileOf(e.path)
            if (f != null) mp.setDataSource(f.path) else mp.setDataSource(c, root.uriOf(e.path) ?: throw IOException("no uri"))
            mp.isLooping = r.loop
            mp.setOnPreparedListener { p ->
                if (player !== p) return@setOnPreparedListener
                runCatching { p.start() }.onFailure { finish(c, "start failed"); return@setOnPreparedListener }
                if (WebHost.view != null) send(JSONObject().put("ev", "ring").put("plan", r.plan).put("media", r.media).put("name", r.name))
            }
            mp.setOnCompletionListener { p -> if (player === p && !r.loop) finish(c, "end") }
            mp.setOnErrorListener { p, _, _ -> if (player === p) finish(c, "player error"); true }
            mp.prepareAsync()
        } catch (t: Throwable) {
            Plog.i("sb: could not play (${t.javaClass.simpleName})")
            finish(c, "no sound")
            return
        }
        rh.removeCallbacks(timeUp); rh.removeCallbacks(stuck)
        if (r.loop) rh.postDelayed(timeUp, SbClock.LOOP_MAX_MS)
        rh.postDelayed(stuck, 30_000)
    }
    /** Stop on the notification, the page's sb:stop, the file removed. */
    fun stop(c: Context, from: String) = rh.post { if (ringing != null) finish(c.applicationContext, from) else stopService(c.applicationContext) }
    /** The ring service went away (the system stopped it): the sound goes too. */
    fun serviceGone(c: Context) = rh.post { if (ringing != null) finish(c.applicationContext, "service gone", stopService = false) }
    private fun finish(c: Context, why: String, stopService: Boolean = true) {
        val r = ringing
        rh.removeCallbacks(timeUp); rh.removeCallbacks(stuck)
        player?.let { runCatching { it.stop() }; runCatching { it.release() } }
        player = null; ringing = null
        focus?.let { f -> runCatching { c.getSystemService(AudioManager::class.java).abandonAudioFocusRequest(f) } }
        focus = null
        giveVolumeBack(c)
        if (r != null) {
            Plog.i("sb: timed play ${r.plan} stopped ($why)")
            if (WebHost.view != null) send(JSONObject().put("ev", "ringEnd").put("plan", r.plan))
        }
        if (stopService) stopService(c)
    }
    private fun stopService(c: Context) {
        runCatching { c.stopService(Intent(c, SbRingService::class.java)) }
        nm(c).cancel(RING_ID)
    }
    /** The alarm volume to the plan's level while it plays (SleepClock.alarmStep, as Sleep mode); what it was is kept. */
    private fun holdVolume(c: Context, level: Double) {
        val am = c.getSystemService(AudioManager::class.java)
        if (sp(c).getInt("savedAlarmVol", -1) >= 0) { runCatching { am.setStreamVolume(AudioManager.STREAM_ALARM, SleepClock.alarmStep(false, level, am.getStreamMaxVolume(AudioManager.STREAM_ALARM)), 0) }; return }
        runCatching {
            val step = SleepClock.alarmStep(false, level, am.getStreamMaxVolume(AudioManager.STREAM_ALARM))
            sp(c).edit().putInt("savedAlarmVol", am.getStreamVolume(AudioManager.STREAM_ALARM)).commit()
            am.setStreamVolume(AudioManager.STREAM_ALARM, step, 0)
        }.onFailure { Plog.i("sb: could not set the alarm volume (${it.javaClass.simpleName})") }
    }
    private fun giveVolumeBack(c: Context) {
        val v = sp(c).getInt("savedAlarmVol", -1)
        if (v < 0) return
        sp(c).edit().remove("savedAlarmVol").apply()
        runCatching { c.getSystemService(AudioManager::class.java).setStreamVolume(AudioManager.STREAM_ALARM, v, 0) }
    }

    // ---------- the notification ----------
    private fun nm(c: Context) = c.getSystemService(NotificationManager::class.java)
    private fun can(c: Context) = c.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    private fun stopIntent(c: Context) = PendingIntent.getBroadcast(c, 6104, Intent(c, SbAction::class.java).putExtra("op", "stop"),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    /** The file name, Stop and Open (PS on the Soundboard). The lock screen shows "PS Soundboard" and Stop only. */
    fun notice(c: Context, name: String): Notification {
        val open = Notifier.openIntent(c, "soundboard", 6103)
        val stop = Notification.Action.Builder(null, "Stop", stopIntent(c)).build()
        val pub = Notification.Builder(c, RING).setSmallIcon(R.drawable.ic_stat_ps).setColor(Color.parseColor(PINK))
            .setContentTitle("PS Soundboard").setContentText("A timed play is on").addAction(stop).build()
        return Notification.Builder(c, RING)
            .setSmallIcon(R.drawable.ic_stat_ps).setColor(Color.parseColor(PINK))
            .setContentTitle(name).setContentText("Soundboard timed play")
            .setCategory(Notification.CATEGORY_ALARM)
            .setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(pub)
            .setOngoing(true).setOnlyAlertOnce(true).setShowWhen(true)
            .setContentIntent(open)
            .setDeleteIntent(stopIntent(c))   // swiped away: the sound stops too
            .setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(stop)
            .addAction(Notification.Action.Builder(null, "Open", open).build())
            .setGroup("soundboard")
            .build()
    }
}

/** Plays a timed play until its end, Stop, or 10 minutes for a loop. Started by the Soundboard's exact alarm. */
class SbRingService : Service() {
    override fun onBind(i: Intent?): IBinder? = null
    override fun onStartCommand(i: Intent?, flags: Int, id: Int): Int {
        val r = Soundboard.Ring.from(i) ?: run { stopSelf(); return START_NOT_STICKY }
        startForeground(Soundboard.RING_ID, Soundboard.notice(this, r.name), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        Soundboard.play(applicationContext, r)
        return START_NOT_STICKY
    }
    override fun onDestroy() {
        Soundboard.serviceGone(applicationContext)
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }
}
/** The Soundboard's one alarm: whatever timed play is due now. */
class SbAlarm : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) { val p = goAsync(); Soundboard.alarm(c.applicationContext) { p.finish() } }
}
/** Stop on the timed play's notification (or swiping it away). */
class SbAction : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) { if (i.getStringExtra("op") == "stop") Soundboard.stop(c.applicationContext, "notification") }
}

// ---------- where the files live ----------
/** One place for the Soundboard's files: PS's own folder (FileRoot) or a folder the developer picked (SafRoot). Paths are relative. */
interface SbRoot {
    val key: String
    val label: String
    val custom: Boolean
    fun ok(): Boolean
    /** Files (relative path to size) in folders at most `depth` deep; media files only unless `media` is false. Hidden ones never. */
    fun list(depth: Int, media: Boolean = true): Map<String, Long>
    /** Lower case names already in `folder`. */
    fun names(folder: String): Set<String>
    fun size(rel: String): Long
    fun open(rel: String, at: Long): InputStream
    /** A new file `file` in `folder` (folders made as needed), filled by `fill`, hidden until it is whole. The path it got. */
    fun write(folder: String, file: String, expect: Long, fill: (OutputStream) -> Long): String
    fun delete(rel: String): Boolean
    /** Empty folders from `folder` up (never the root itself). */
    fun prune(folder: String)
    fun readIndex(): String?
    fun writeIndex(text: String)
    fun deleteIndex()
    /** Copies cut off half way (PS was killed) go. */
    fun dropParts()
    fun fileOf(rel: String): File?
    fun uriOf(rel: String): Uri?
}

/** PS's own folder on this phone: private, no permission needed. */
class FileRoot(private val dir: File) : SbRoot {
    companion object { const val KEY = "default" }
    override val key = KEY
    override val label = "PS app on this phone"
    override val custom = false
    private val parts = ArrayList<File>()
    private fun f(rel: String) = File(dir, rel)
    override fun ok() = dir.isDirectory || dir.mkdirs()
    override fun list(depth: Int, media: Boolean): Map<String, Long> {
        val out = LinkedHashMap<String, Long>()
        synchronized(parts) { parts.clear() }
        fun walk(d: File, prefix: String, deep: Int) {
            for (x in d.listFiles() ?: return) {
                if (x.name.startsWith(".")) { if (x.name.startsWith(SbClock.PART) && x.isFile) synchronized(parts) { parts.add(x) }; continue }
                val rel = SbClock.join(prefix, x.name)
                if (x.isDirectory) { if (deep < depth) walk(x, rel, deep + 1) }
                else if (x.isFile && (!media || SbClock.isMedia(x.name))) out[rel] = x.length()
            }
        }
        walk(dir, "", 0)
        return out
    }
    override fun names(folder: String) = f(folder).list()?.map { it.lowercase() }?.toSet() ?: emptySet()
    override fun size(rel: String) = f(rel).let { if (it.isFile) it.length() else -1L }
    override fun open(rel: String, at: Long): InputStream = FileInputStream(f(rel)).also { if (at > 0) it.channel.position(at) }
    override fun write(folder: String, file: String, expect: Long, fill: (OutputStream) -> Long): String {
        val d = f(folder).apply { mkdirs() }
        val tmp = File(d, SbClock.PART + SbClock.newId())
        try {
            val n = FileOutputStream(tmp).use { o -> fill(o).also { o.fd.sync() } }
            if (expect >= 0 && n != expect) throw IOException("size")
            val name = SbClock.freeName(file, names(folder))   // a clash that came up meanwhile: renameTo would replace it
            if (!tmp.renameTo(File(d, name))) throw IOException("rename")
            return SbClock.join(folder, name)
        } catch (e: Throwable) { tmp.delete(); throw e }
    }
    override fun delete(rel: String) = f(rel).delete()
    override fun prune(folder: String) {
        var p = folder
        while (p.isNotEmpty()) { val d = f(p); if (d.isDirectory && d.list()?.isEmpty() == true) d.delete() else break; p = SbClock.folderOf(p) }
    }
    override fun readIndex(): String? = File(dir, SbClock.INDEX).takeIf { it.isFile }?.readText()
    override fun writeIndex(text: String) {
        dir.mkdirs()
        val tmp = File(dir, SbClock.INDEX + ".tmp")
        FileOutputStream(tmp).use { it.write(text.toByteArray()); it.fd.sync() }
        if (!tmp.renameTo(File(dir, SbClock.INDEX))) { tmp.delete(); throw IOException("index") }
    }
    override fun deleteIndex() { File(dir, SbClock.INDEX).delete() }
    override fun dropParts() { synchronized(parts) { parts.forEach { it.delete() }; parts.clear() } }
    override fun fileOf(rel: String) = f(rel)
    override fun uriOf(rel: String): Uri? = null
}

/** A folder the developer picked (DocumentsContract with the tree's grant). Lookups by path are cached as they are found. */
class SafRoot(private val cr: ContentResolver, val tree: Uri) : SbRoot {
    override val key: String = tree.toString()
    override val custom = true
    val rootId: String = DocumentsContract.getTreeDocumentId(tree)
    private val ids = ConcurrentHashMap<String, String>()   // lower case path ("" root, "a/b" folder or file) to document id
    private val parts = ArrayList<String>()
    private class Child(val id: String, val name: String, val dir: Boolean, val size: Long)
    private fun doc(id: String) = DocumentsContract.buildDocumentUriUsingTree(tree, id)
    private fun children(parent: String): List<Child> =
        cr.query(DocumentsContract.buildChildDocumentsUriUsingTree(tree, parent), arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE), null, null, null)?.use { k ->
            val out = ArrayList<Child>()
            while (k.moveToNext()) {
                val id = k.getString(0) ?: continue
                out.add(Child(id, k.getString(1) ?: "", k.getString(2) == DocumentsContract.Document.MIME_TYPE_DIR, if (k.isNull(3)) -1 else k.getLong(3)))
            }
            out
        } ?: emptyList()
    private fun one(id: String, col: String): Any? = cr.query(doc(id), arrayOf(col), null, null, null)?.use { k ->
        if (!k.moveToFirst() || k.isNull(0)) null else if (col == DocumentsContract.Document.COLUMN_SIZE || col == DocumentsContract.Document.COLUMN_FLAGS) k.getLong(0) else k.getString(0)
    }
    fun rootName(): String = runCatching { one(rootId, DocumentsContract.Document.COLUMN_DISPLAY_NAME) as? String }.getOrNull() ?: ""
    override val label: String by lazy { SbClock.treeLabel(rootId, rootName()) }
    override fun ok() = runCatching { one(rootId, DocumentsContract.Document.COLUMN_DOCUMENT_ID) != null }.getOrDefault(false)

    override fun list(depth: Int, media: Boolean): Map<String, Long> {
        val out = LinkedHashMap<String, Long>()
        synchronized(parts) { parts.clear() }
        fun walk(id: String, prefix: String, deep: Int) {
            for (ch in children(id)) {
                if (ch.name.isEmpty()) continue
                val rel = SbClock.join(prefix, ch.name)
                if (ch.name.startsWith(".")) { if (!ch.dir && ch.name.startsWith(SbClock.PART)) synchronized(parts) { parts.add(ch.id) }; continue }
                ids[rel.lowercase()] = ch.id
                if (ch.dir) { if (deep < depth) walk(ch.id, rel, deep + 1) }
                else if (!media || SbClock.isMedia(ch.name)) out[rel] = ch.size.coerceAtLeast(0)
            }
        }
        ids[""] = rootId
        walk(rootId, "", 0)
        return out
    }
    /** The document id of a path, found folder by folder when it is not cached (names compare in lower case). */
    private fun find(rel: String): String? {
        if (rel.isEmpty()) return rootId
        ids[rel.lowercase()]?.let { return it }
        var id = rootId; var at = ""
        for (part in rel.split('/')) {
            at = SbClock.join(at, part)
            id = ids[at.lowercase()] ?: (children(id).firstOrNull { it.name.equals(part, ignoreCase = true) }?.id ?: return null).also { ids[at.lowercase()] = it }
        }
        return id
    }
    override fun names(folder: String): Set<String> = find(folder)?.let { f -> runCatching { children(f).map { it.name.lowercase() }.toSet() }.getOrNull() } ?: emptySet()
    override fun size(rel: String): Long {
        val id = find(rel) ?: return -1
        val s = runCatching { one(id, DocumentsContract.Document.COLUMN_SIZE) as? Long }.getOrNull()
        if (s == null) { ids.remove(rel.lowercase()); return if (runCatching { one(id, DocumentsContract.Document.COLUMN_DOCUMENT_ID) }.getOrNull() == null) -1 else 0 }
        return s
    }
    override fun open(rel: String, at: Long): InputStream {
        val id = find(rel) ?: throw IOException("gone")
        val pfd = cr.openFileDescriptor(doc(id), "r") ?: throw IOException("no fd")
        val s = ParcelFileDescriptor.AutoCloseInputStream(pfd)
        if (at > 0) {
            // A real file (the phone's storage) seeks; a pipe from another app is read up to the place.
            if (runCatching { s.channel.position(at) }.isFailure) { var left = at; while (left > 0) { val k = s.skip(left); if (k <= 0) { s.close(); throw IOException("short") }; left -= k } }
        }
        return s
    }
    private fun mkdirs(folder: String): String {
        var id = rootId; var at = ""
        for (part in folder.split('/').filter { it.isNotEmpty() }) {
            at = SbClock.join(at, part)
            val known = ids[at.lowercase()] ?: children(id).firstOrNull { it.dir && it.name.equals(part, ignoreCase = true) }?.id
            id = known ?: DocumentsContract.createDocument(cr, doc(id), DocumentsContract.Document.MIME_TYPE_DIR, part)
                ?.let { DocumentsContract.getDocumentId(it) } ?: throw IOException("folder")
            ids[at.lowercase()] = id
        }
        return id
    }
    private val OCTET = "application/octet-stream"   // keeps the name exactly as given (no extension added for a type)
    override fun write(folder: String, file: String, expect: Long, fill: (OutputStream) -> Long): String {
        val parent = mkdirs(folder)
        var made: Uri? = null
        try {
            val tmp = DocumentsContract.createDocument(cr, doc(parent), OCTET, SbClock.PART + SbClock.newId()) ?: throw IOException("create")
            made = tmp
            val canRename = ((runCatching { one(DocumentsContract.getDocumentId(tmp), DocumentsContract.Document.COLUMN_FLAGS) as? Long }.getOrNull() ?: 0L)
                and DocumentsContract.Document.FLAG_SUPPORTS_RENAME.toLong()) != 0L
            var target = tmp
            if (!canRename) {   // no rename here: written under its own name straight away
                DocumentsContract.deleteDocument(cr, tmp)
                target = DocumentsContract.createDocument(cr, doc(parent), OCTET, SbClock.freeName(file, names(folder))) ?: throw IOException("create")
                made = target
            }
            val n = (cr.openOutputStream(target, "w") ?: throw IOException("no stream")).use { fill(it) }
            if (expect >= 0 && n != expect) throw IOException("size")
            if (canRename) {
                target = DocumentsContract.renameDocument(cr, tmp, SbClock.freeName(file, names(folder))) ?: tmp
                made = target
            }
            val id = DocumentsContract.getDocumentId(target)
            val name = (one(id, DocumentsContract.Document.COLUMN_DISPLAY_NAME) as? String) ?: throw IOException("name")
            val rel = SbClock.join(folder, name)
            ids[rel.lowercase()] = id
            return rel
        } catch (e: Throwable) {
            made?.let { u -> runCatching { DocumentsContract.deleteDocument(cr, u) } }
            throw e
        }
    }
    override fun delete(rel: String): Boolean {
        val id = find(rel) ?: return false
        ids.remove(rel.lowercase())
        return DocumentsContract.deleteDocument(cr, doc(id))
    }
    override fun prune(folder: String) {
        var p = folder
        while (p.isNotEmpty()) {
            val id = find(p) ?: break
            if (children(id).isNotEmpty()) break
            if (!DocumentsContract.deleteDocument(cr, doc(id))) break
            ids.remove(p.lowercase())
            p = SbClock.folderOf(p)
        }
    }
    private fun indexId(): String? = children(rootId).firstOrNull { !it.dir && it.name == SbClock.INDEX }?.id
    override fun readIndex(): String? = indexId()?.let { id -> cr.openInputStream(doc(id))?.use { String(it.readBytes()) } }
    override fun writeIndex(text: String) {
        val bytes = text.toByteArray()
        val id = indexId()
        if (id != null && runCatching { (cr.openOutputStream(doc(id), "wt") ?: throw IOException("no stream")).use { it.write(bytes) } }.isSuccess) return
        // No truncating write here: a fresh index file instead.
        id?.let { runCatching { DocumentsContract.deleteDocument(cr, doc(it)) } }
        val u = DocumentsContract.createDocument(cr, doc(rootId), OCTET, SbClock.INDEX) ?: throw IOException("index")
        (cr.openOutputStream(u, "w") ?: throw IOException("no stream")).use { it.write(bytes) }
    }
    override fun deleteIndex() { indexId()?.let { DocumentsContract.deleteDocument(cr, doc(it)) } }
    override fun dropParts() { synchronized(parts) { parts.forEach { runCatching { DocumentsContract.deleteDocument(cr, doc(it)) } }; parts.clear() } }
    override fun fileOf(rel: String): File? = null
    override fun uriOf(rel: String): Uri? = find(rel)?.let { doc(it) }
}
