package com.cincee.ps.gos

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Updates with no app store, since V1.57 from the public PS repo's newest GitHub release (UpdateWhere), not from
 * cincee.com, so the developer never gets the phone's address from a look (V1.56 and older still ask cincee.com/client/gos/):
 *  1. gos-version.json (the same note the phone read as version.json on cincee.com): {versionCode, versionName, apk, sha256, size, notes, history (V1.52: earlier versions' approved notes)}
 *  2. download the APK next to it (progress to the card)
 *  3. verify: the SHA-256 must match the manifest AND the APK must be signed by PS's own release
 *     certificate (pinned in the app, and the same as the installed app's). Anything else is thrown away.
 *  4. PackageInstaller session; GrapheneOS asks once ("Update this app?").
 */
object Updater {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile private var job: Job? = null
    @Volatile var state: JSONObject = JSONObject().put("state", "idle"); private set
    private var manifest: JSONObject? = null

    fun set(s: String, extra: JSONObject) {
        val o = JSONObject().put("state", s).put("current", BuildConfig.VERSION_NAME).put("currentKeyword", BuildConfig.KEYWORD)
        manifest?.let { o.put("version", it.optString("versionName")).put("keyword", it.optString("keyword")).put("size", it.optLong("size")).put("notes", it.optString("notes")).put("history", it.optJSONArray("history") ?: org.json.JSONArray()) }
        extra.keys().forEach { o.put(it, extra.get(it)) }
        state = o
        WebHost.post(JSONObject().put("type", "update").put("update", o))
    }

    private fun get(url: String): HttpURLConnection = (URL(url).openConnection() as HttpURLConnection).apply {
        connectTimeout = 15_000; readTimeout = 30_000; useCaches = false
        // GitHub answers with a redirect to the release's file host (https to https, followed by itself).
        instanceFollowRedirects = true
        setRequestProperty("Cache-Control", "no-cache")
        // Just "PS": Android's own User-Agent names the Android version and the phone model.
        setRequestProperty("User-Agent", "PS")
    }

    // When to look by itself: UpdateClock (unit tested). The note is tiny and on GitHub, not Supabase.
    private fun sp(c: Context) = c.getSharedPreferences("upd", Context.MODE_PRIVATE)
    private fun times(c: Context) = sp(c).let { UpdateTimes(it.getLong("okAt", 0), it.getLong("failAt", 0), it.getInt("fails", 0)) }
    private fun save(c: Context, t: UpdateTimes) { sp(c).edit().putLong("okAt", t.okAt).putLong("failAt", t.failAt).putInt("fails", t.fails).apply() }

    /** Settings, "Check for updates every" (V1.54): the minutes chosen, 5 until the page has said otherwise, 0 = Off. */
    fun every(c: Context): Int = UpdateClock.cleanEvery(sp(c).getInt("every", 5))
    /** The page tells this app the choice when the vault opens and on every change ({type:"update:every"}); it counts at once. */
    fun setEvery(c: Context, min: Int) {
        val now = UpdateClock.cleanEvery(min)
        if (now == every(c)) return
        sp(c).edit().putInt("every", now).apply()
        Plog.i(if (UpdateClock.off(now)) "update: automatic looks off" else "update: looks every $now minutes now")
        WebHost.activity?.updatePace()
    }

    /** A look of its own: `open` when PS opens or comes to the front, else from the background check.
     *  Offline it does not try (and so does not count a failure). It only ever shows an update. */
    @Synchronized fun maybe(c: Context, open: Boolean) {
        if (job?.isActive == true || !Net.online(c)) return
        if (!UpdateClock.due(times(c), System.currentTimeMillis(), open, every(c))) return
        check(c, manual = false)
    }

    @Synchronized fun check(c: Context, manual: Boolean) {
        if (job?.isActive == true) return
        job = scope.launch {
            if (manual) set("checking", JSONObject())
            try {
                val m = fetchNote()
                manifest = m
                // Stamped only once there is an answer: a failed look is tried again soon (UpdateClock).
                save(c, UpdateClock.succeeded(System.currentTimeMillis()))
                val code = m.optInt("versionCode")
                if (code > BuildConfig.VERSION_CODE) {
                    val was = state.optString("state")
                    // Never further than this: Update now stays the developer's tap on the card.
                    if (was !in setOf("downloading", "verifying", "ready", "installing")) set("available", JSONObject())
                    // One quiet notification per version, even after Android restarted PS (UpdateClock.shouldTell).
                    if (!manual && UpdateClock.shouldTell(sp(c).getInt("told", 0), code, BuildConfig.VERSION_CODE)) {
                        sp(c).edit().putInt("told", code).commit()
                        Notifier.update(c, m.optString("versionName"), m.optString("keyword"))
                    }
                } else set("none", JSONObject())
            } catch (e: Exception) {
                save(c, UpdateClock.failed(times(c), System.currentTimeMillis()))
                Plog.i("update look failed: ${e.javaClass.simpleName}")
                if (manual) set("error", JSONObject().put("error", friendly(e))) else set("idle", JSONObject())
            }
        }
    }

    /** The note, read whole (no cache anywhere on the way: get() sets useCaches false and no-cache). */
    private fun fetchNote(): JSONObject {
        val h = get(UpdateWhere.note())
        try {
            if (h.responseCode != 200) throw Exception("No update file found (${h.responseCode}).")
            return JSONObject(h.inputStream.use { it.readBytes().decodeToString() })
        } finally { h.disconnect() }
    }

    /** The newest version.json at the tap; null when it cannot be read (offline): then the card's goes in. */
    private fun freshNote(): JSONObject? = try { fetchNote() } catch (e: Exception) {
        Plog.i("update: fresh look at the tap failed: ${e.javaClass.simpleName}"); null
    }

    private fun friendly(e: Exception) = when (e) {
        is java.net.UnknownHostException, is java.net.ConnectException -> "No connection. Check that PS app has the Network permission and the phone is online."
        is java.net.SocketTimeoutException -> "The connection timed out. Try again in a moment."
        else -> e.message ?: "Something went wrong. Nothing was installed."
    }

    fun install(c: Context) {
        if (job?.isActive == true) return
        val card = manifest ?: run { check(c, true); return }
        job = scope.launch {
            val apk = File(c.cacheDir, "update.apk")
            try {
                set("downloading", JSONObject().put("progress", 0.0))
                // V1.51 (UpdatePick): version.json read fresh at the tap, so the newest release goes in, never the older
                // one an earlier look put on the card; the card's number moves on to it (set() reads `manifest`).
                var m = UpdatePick.choose(card, freshNote())
                var round = 0
                while (true) {
                    manifest = m
                    if (!UpdatePick.newer(m.optInt("versionCode"), BuildConfig.VERSION_CODE)) { set("none", JSONObject()); return@launch }
                    val code = fetchApk(c, apk, m)
                    // The APK against the newest version.json once more: older is refused and the newest fetched (once).
                    val newest = freshNote()?.takeIf { it.optInt("versionCode") > m.optInt("versionCode") } ?: m
                    val stale = UpdatePick.staleProblem(code, newest.optInt("versionCode")) ?: break
                    apk.delete()
                    if (round++ >= 1) throw Exception("$stale Try again.")
                    Plog.i("update: refused a stale download, fetching the newest")
                    m = newest
                }
                // 3. install
                set("installing", JSONObject())
                val pi = c.packageManager.packageInstaller
                val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
                    setAppPackageName(c.packageName)
                    setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
                    setInstallReason(android.content.pm.PackageManager.INSTALL_REASON_USER)
                }
                val id = pi.createSession(params)
                pi.openSession(id).use { s ->
                    s.openWrite("ps-gos.apk", 0, apk.length()).use { out -> apk.inputStream().use { it.copyTo(out) }; s.fsync(out) }
                    val back = PendingIntent.getBroadcast(c, 41, Intent(c, Receivers.Installed::class.java), PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
                    s.commit(back.intentSender)
                }
            } catch (e: Exception) {
                apk.delete()
                set("error", JSONObject().put("error", friendly(e)))
            }
        }
    }

    /** 1. download and 2. verify the APK `m` names; returns the APK's own versionCode. Any mismatch throws. */
    private fun fetchApk(c: Context, apk: File, m: JSONObject): Long {
        set("downloading", JSONObject().put("progress", 0.0))
        val h = get(UpdateWhere.apk(m.optString("apk")) ?: throw Exception("The update file has a strange name. Not installed."))
        if (h.responseCode != 200) throw Exception("Download failed (${h.responseCode}).")
        val total = h.contentLengthLong.takeIf { it > 0 } ?: m.optLong("size")
        val md = MessageDigest.getInstance("SHA-256")
        var got = 0L; var lastSent = 0L
        h.inputStream.use { inp -> apk.outputStream().use { out ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = inp.read(buf); if (n < 0) break
                out.write(buf, 0, n); md.update(buf, 0, n); got += n
                if (got - lastSent > 256 * 1024 || got == total) { lastSent = got; set("downloading", JSONObject().put("progress", if (total > 0) got.toDouble() / total else 0.0)) }
                if (got > 300L * 1024 * 1024) throw Exception("The download is far too big. Not installed.")
            }
        } }
        h.disconnect()
        // 2. verify
        set("verifying", JSONObject())
        val sha = md.digest().joinToString("") { "%02x".format(it) }
        if (!sha.equals(m.optString("sha256"), ignoreCase = true)) throw Exception("The file does not match its checksum. Not installed.")
        return verifySigner(c, apk, m)
    }

    /** The APK must be signed by the same certificate as this app (and, for release builds, the pinned one). */
    private fun verifySigner(c: Context, apk: File, m: JSONObject): Long {
        val pm = c.packageManager
        val info = pm.getPackageArchiveInfo(apk.path, PackageManager.GET_SIGNING_CERTIFICATES) ?: throw Exception("The phone cannot read this update. Not installed.")
        if (info.packageName != c.packageName) throw Exception("That update is for a different app. Not installed.")
        if (info.longVersionCode <= BuildConfig.VERSION_CODE) throw Exception("That file is not newer than this PS app. Not installed.")
        val theirs = info.signingInfo?.apkContentsSigners?.map { sha256(it.toByteArray()) }?.toSet().orEmpty()
        val mine = pm.getPackageInfo(c.packageName, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo?.apkContentsSigners?.map { sha256(it.toByteArray()) }?.toSet().orEmpty()
        if (theirs.isEmpty() || theirs != mine) throw Exception("The update is not signed with your PS app key. Not installed.")
        val pin = BuildConfig.CERT_SHA256.lowercase().replace(":", "")
        if (pin.isNotEmpty() && pin !in theirs) throw Exception("The update is not signed with your PS app key. Not installed.")
        if (m.optString("cert").isNotEmpty() && m.optString("cert").lowercase() !in theirs) throw Exception("The update's details do not match its signature. Not installed.")
        return info.longVersionCode
    }

    private fun sha256(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }

    fun cleanup(c: Context) { File(c.cacheDir, "update.apk").delete(); state = JSONObject().put("state", "idle") }
}
