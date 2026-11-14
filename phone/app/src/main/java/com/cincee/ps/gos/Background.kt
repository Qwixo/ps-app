package com.cincee.ps.gos

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.withLock

/**
 * "Remember me": the DERIVED vault keys (login password and key encryption key, never the
 * passphrase), as on the Mac. Kept sealed by the fingerprint key; the background check copy is
 * sealed by the device key and only exists while Background checks are on.
 */
object Remember {
    private const val FP = "remember.fp"
    private const val BG = "remember.bg"
    private const val STAY = "remember.stay"   // Stay signed in: sealed by the device key, opens PS without the fingerprint
    fun exists(c: Context) = Keys.file(c, FP).exists()

    // Never on the main thread (Keys): the step after the fingerprint talks to the Keystore too.
    fun save(c: Context, cipher: Cipher, json: JSONObject) {
        val ct = Keys.gate.run("remember save") { cipher.doFinal(json.toString().toByteArray()) }
        Keys.file(c, FP).writeBytes(cipher.iv + ct)
        if (Prefs.background(c)) Keys.write(c, BG, json.toString())
        if (Prefs.stay(c)) Keys.write(c, STAY, json.toString())
    }
    fun iv(c: Context): ByteArray? = runCatching { Keys.file(c, FP).readBytes().copyOfRange(0, 12) }.getOrNull()
    fun open(c: Context, cipher: Cipher): JSONObject {
        val all = Keys.file(c, FP).readBytes()
        val json = JSONObject(String(Keys.gate.run("remember open") { cipher.doFinal(all, 12, all.size - 12) }))
        // Background checks on but no copy yet (switched on after the last sign in): make it now.
        if (Prefs.background(c) && !Keys.file(c, BG).exists()) Keys.write(c, BG, json.toString())
        if (Prefs.stay(c) && !Keys.file(c, STAY).exists()) Keys.write(c, STAY, json.toString())
        return json
    }
    fun background(c: Context): JSONObject? = if (Prefs.background(c)) Keys.read(c, BG)?.let { runCatching { JSONObject(it) }.getOrNull() } else null
    fun dropBackground(c: Context) = Keys.delete(c, BG)
    /** The keys without the fingerprint: only with Stay signed in on and PS not locked by hand. */
    fun stayKeys(c: Context): JSONObject? = if (Prefs.stay(c) && !Prefs.handLocked(c) && exists(c)) Keys.read(c, STAY)?.let { runCatching { JSONObject(it) }.getOrNull() } else null
    fun dropStay(c: Context) = Keys.delete(c, STAY)
    fun forget(c: Context) { Keys.delete(c, FP); Keys.delete(c, BG); Keys.delete(c, STAY); Keys.dropFinger() }
}

/** The page's current access token (never the refresh token), so the shell can ask vault_probe by itself. */
object Session {
    private const val F = "session"
    // The page sends the token on every auth event, mostly the same one again: a repeat is not sealed again.
    private val last = SameAsLast()
    /** Bridge thread only (a Keystore seal). */
    fun save(c: Context, access: String?, exp: Long) {
        if (access == null) { last.forget(); Keys.delete(c, F); return }
        val text = JSONObject().put("access", access).put("exp", exp).toString()
        if (last.same(text) && Keys.file(c, F).exists()) return
        Keys.write(c, F, text)
        last.wrote(text)
        LiveLink.kick()   // V1.59: the live link joins (or renews) with the new token at once
    }
    /** The token and when it ends (ms), whatever is left of it. Off the main thread (Keystore). */
    fun current(c: Context): Pair<String, Long>? {
        val j = Keys.read(c, F)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return null
        val t = j.optString("access").takeIf { it.isNotEmpty() } ?: return null
        return t to j.optLong("exp") * 1000
    }
    /** A token with at least two minutes left, else null (then the page refreshes it during the check). */
    fun token(c: Context): String? {
        val j = Keys.read(c, F)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return null
        return j.optString("access").takeIf { it.isNotEmpty() && j.optLong("exp") * 1000 > System.currentTimeMillis() + 120_000 }
    }
}

/**
 * Background checks without Google: WorkManager (JobScheduler) about every 15 minutes, only with a
 * network. Each run asks vault_probe (a few hundred bytes of hashes, the same call the page makes)
 * and compares it with the last answer. Only a change wakes the page for one change only sync.
 * Supabase egress per quiet check: well under 1 KB.
 */
object Pulse {
    private const val NAME = "ps-pulse"
    fun schedule(c: Context) {
        val wm = WorkManager.getInstance(c)
        if (!Prefs.background(c) || Nuke.done(c)) { wm.cancelUniqueWork(NAME); return }
        val req = PeriodicWorkRequestBuilder<PulseWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        wm.enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, req)
    }

    /** Run the check now, outside WorkManager (PulseNow). force: wake the page even when the probe did not move. */
    fun now(c: Context, force: Boolean, why: String) { if (Prefs.background(c) && !Nuke.done(c)) PulseNow.start(c, force, why) }

    /** One check: the tiny probe, and only on a change (or force) the page's change only sync. Off the main thread. */
    private val gate = kotlinx.coroutines.sync.Mutex()
    suspend fun run(c: Context, force0: Boolean, why: String) = gate.withLock { runOnce(c, force0, why) }
    private suspend fun runOnce(c: Context, force0: Boolean, why: String) {
        // The screen is open: the page syncs by itself (its own Realtime socket and the card pokes).
        if (WebHost.activity?.isShown == true) return
        val t0 = android.os.SystemClock.elapsedRealtime()
        val sp = c.getSharedPreferences("pulse", Context.MODE_PRIVATE)
        val before = probe(c)
        val last = sp.getString("probe", null)
        val stale = System.currentTimeMillis() - sp.getLong("at", 0) > 6 * 3600_000   // at least one full look every 6 hours
        // A reminded email card is due, or a remind tapped while the page slept waits to be saved (Reminds).
        val force = force0 || Reminds.due(c)
        if (before != null && before == last && !stale && !force) return
        val keys = Remember.background(c)
        if (keys == null && !WebHost.unlocked) { if (before != null) sp.edit().putString("probe", before).apply(); return }
        val ok = WebHost.pulse(c, keys)
        Plog.i("pulse ($why): ${if (before == null) "token renewed" else if (before != last) "change" else "asked"} -> ${if (ok) "ok" else "failed"} in ${android.os.SystemClock.elapsedRealtime() - t0} ms")
        if (ok) sp.edit().putString("probe", probe(c) ?: before).putLong("at", System.currentTimeMillis()).apply()
    }

    /** vault_probe with the saved token: the answer's hash, or null when it could not ask. */
    fun probe(c: Context): String? {
        val token = Session.token(c) ?: return null
        return runCatching {
            val u = URL("${BuildConfig.SUPABASE_URL}/rest/v1/rpc/vault_probe")
            val h = (u.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"; connectTimeout = 10_000; readTimeout = 10_000; doOutput = true
                setRequestProperty("apikey", BuildConfig.SUPABASE_KEY)
                setRequestProperty("Authorization", "Bearer $token")
                setRequestProperty("Content-Type", "application/json")
            }
            h.outputStream.use { it.write("{}".toByteArray()) }
            if (h.responseCode != 200) { h.disconnect(); return null }
            val body = h.inputStream.use { it.readBytes() }
            h.disconnect()
            MessageDigest.getInstance("SHA-256").digest(body).joinToString("") { "%02x".format(it) }
        }.getOrNull()
    }
}

class PulseWorker(ctx: Context, p: WorkerParameters) : CoroutineWorker(ctx, p) {
    override suspend fun doWork(): Result {
        val c = applicationContext
        if (!Prefs.background(c)) return Result.success()
        // Updates first, screen open or not (due every 5 minutes, so every run of this job; a failed look waits 5, 10, 20, 30 minutes: UpdateClock).
        Updater.maybe(c, open = false)
        Pulse.run(c, inputData.getBoolean("force", false), "check")
        return Result.success()
    }
}

/**
 * V1.59: the same check started at once (the live link heard a signal, a reminded card is due, a remind tapped while
 * the page slept), instead of a WorkManager job that Android may hold back while the phone dozes. One at a time; a
 * request during a run makes one more run after it. A short wake lock keeps the phone up until the page has synced.
 */
object PulseNow {
    private val scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.IO)
    private val lock = Any()
    private var busy = false
    private var again = false
    private var againForce = false
    fun start(c: Context, force: Boolean, why: String) {
        val app = c.applicationContext
        synchronized(lock) { if (busy) { again = true; againForce = againForce || force; return }; busy = true }
        scope.launch {
            val wl = app.getSystemService(android.os.PowerManager::class.java).newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "ps:pulse")
            runCatching { wl.acquire(100_000) }
            var f = force; var w = why
            try {
                while (true) {
                    try { Pulse.run(app, f, w) } catch (e: Exception) { Plog.i("pulse failed: ${e.javaClass.simpleName}") }
                    synchronized(lock) { if (!again) { busy = false; return@launch }; again = false; f = againForce; againForce = false; w = "again" }
                }
            } finally { runCatching { if (wl.isHeld) wl.release() } }
        }
    }
}
