package com.cincee.ps.gos

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.time.ZoneId
import java.util.concurrent.Executors

/**
 * The Annoying 15 min reminder on the phone (the developer, 10 Nov 2026: "Do the same with the notifications on the GOS app
 * too"). The rules are in web src/core/remind.ts, the timing here in RemClock.kt.
 *  - The page sends a plan ({type:"remPlan"}) only when it changed. Each reminder pops up as a notification from its
 *    start time until it is confirmed, on the days picked. One already up when its window closes stays until answered.
 *  - Its buttons: "Remind me in" (away for the snooze length) and the confirm words. Confirm is one tap when the
 *    reminder says so, else the word has to be typed (a reply box); a wrong word brings it back with "Only <word>
 *    clears this". Swiping it away counts as Remind me in: annoying on purpose.
 *  - The channel is silent. PS plays the reminder's own sound itself, at its share of the notification volume (never
 *    changing any volume), only when the ringer is on normal and neither PS Do Not Disturb nor the phone's own Do Not
 *    Disturb is on. It plays when the notification first comes up in a window and each time a snooze brings it back.
 *  - An answer here goes to the page as {type:"remAct"} (saved in the vault, so the Mac's card goes too). While the
 *    page is not running it waits in prefs, exactly like the gym's Acknowledge, and a background check carries it.
 *  - A reminder on a task (V1.55) says the task's name and has a third button, Open task (PS opens at the list with that
 *    task glowing). Done ticks the task: the page does that when the answer reaches it.
 *  - ONE exact alarm at the soonest wake of all reminders; armed again on boot, update, a clock or zone change and
 *    every new plan.
 * Everything here runs on its own thread (one at a time, in order), never on the main thread: the plan, the files,
 * the notifications and the player. Only the reminders' words and times are kept here, and own sounds stay on this
 * phone (never in the vault, never uploaded).
 */
object Remind {
    const val CH = "rem"
    private const val NID = 51
    private const val TEST_TAG = "remtest"
    private const val OWN_MAX = 4 * 1024 * 1024 + 44
    private val ex = Executors.newSingleThreadExecutor { r -> Thread(r, "ps-rem") }

    /** Every piece of work here, in order, off the main thread. `done` runs after it (a receiver's goAsync). */
    fun work(done: (() -> Unit)? = null, f: () -> Unit) {
        ex.execute {
            try { runCatching(f).onFailure { Plog.i("rem: failed (${it.javaClass.simpleName})") } }
            finally { done?.invoke() }
        }
    }

    private fun sp(c: Context) = c.getSharedPreferences("rem", Context.MODE_PRIVATE)
    private fun device(): ZoneId = ZoneId.systemDefault()
    private fun plan(c: Context): List<RemItem> = RemClock.parseList(sp(c).getString("plan", null))
    private fun answers(c: Context): Map<String, RemAnswer> = RemClock.answersFrom(sp(c).getString("ans", null))
    /** Which window day each notification now up belongs to. */
    private fun shown(c: Context): MutableMap<String, String> {
        val o = runCatching { JSONObject(sp(c).getString("shown", null) ?: "{}") }.getOrDefault(JSONObject())
        return o.keys().asSequence().associateWith { o.optString(it) }.toMutableMap()
    }
    private fun saveShown(c: Context, m: Map<String, String>) { sp(c).edit().putString("shown", JSONObject(m).toString()).apply() }
    /** The plan with this phone's newer answers on top. */
    private fun items(c: Context): List<RemItem> { val a = answers(c); return plan(c).map { RemClock.merge(it, a[it.id]) } }

    // ---------- from the page ----------
    fun setPlan(c: Context, j: JSONObject) = work {
        val items = RemClock.parse(j)
        // Answers the vault already has (or for reminders no longer in the list) are not needed here any more.
        val keep = RemClock.keepAnswers(items, answers(c))
        sp(c).edit().putString("plan", RemClock.listJson(items).toString()).putString("ans", RemClock.answersJson(keep).toString()).apply()
        settle(c, "plan", refresh = true)
    }
    /** A reboot, an update or the clock or zone changing: the notifications as they should be now, the alarm armed. */
    fun restore(c: Context, done: (() -> Unit)? = null) = work(done) { settle(c, "system", refresh = false) }
    fun alarm(c: Context, done: (() -> Unit)? = null) = work(done) { settle(c, "alarm", refresh = false) }

    /** Up what should be up (with its sound when it first comes up in a window), away what was answered, the next alarm. */
    private fun settle(c: Context, from: String, refresh: Boolean) {
        val now = System.currentTimeMillis()
        val z = device()
        val items = items(c)
        val shown = shown(c)
        // After a reboot (or the clock changing) the shade may have been cleared: what is not really up comes up again.
        if (from == "system") runCatching { nm(c).activeNotifications.map { it.tag }.toSet() }.getOrNull()?.let { up ->
            shown.keys.retainAll { tag(it) in up }
        }
        for (r in items) {
            val day = shown[r.id]
            when (RemClock.status(r, now, z)) {
                RemStatus.SHOW -> {
                    val cd = RemClock.cycleDay(r, now, z)
                    if (day != cd) { if (post(c, r, wrong = false)) { shown[r.id] = cd; play(c, r, test = false); Plog.i("rem: ${r.id} up ($from)") } }
                    else if (refresh) post(c, r, wrong = false)
                }
                RemStatus.OFF, RemStatus.DONE, RemStatus.SNOOZED -> if (day != null) { away(c, r.id); shown.remove(r.id) }
                // The window closed: one already up stays until answered (here, or on the Mac: done or snoozed there).
                RemStatus.CLOSED -> if (day != null) {
                    if (r.done == day || r.snoozeUntil > now) { away(c, r.id); shown.remove(r.id) }
                    else if (refresh) post(c, r, wrong = false)
                }
            }
        }
        for (id in shown.keys.toList()) if (items.none { it.id == id }) { away(c, id); shown.remove(id) }
        saveShown(c, shown)
        arm(c, items, now, z)
    }

    // ---------- the alarm ----------
    private fun alarmIntent(c: Context) = PendingIntent.getBroadcast(c, 5101, Intent(c, RemAlarm::class.java),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    private fun arm(c: Context, items: List<RemItem>, now: Long, z: ZoneId) {
        val am = c.getSystemService(AlarmManager::class.java)
        am.cancel(alarmIntent(c))
        val at = RemClock.soonest(items, now, z).takeIf { it > 0 }?.coerceAtLeast(now + 1000) ?: return
        if (am.canScheduleExactAlarms()) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, alarmIntent(c))
        else am.setWindow(AlarmManager.RTC_WAKEUP, at, 60_000, alarmIntent(c))
    }

    // ---------- the notification ----------
    private fun nm(c: Context) = c.getSystemService(NotificationManager::class.java)
    private fun can(c: Context) = c.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    private fun tag(id: String) = "rem:$id"
    private fun color(r: RemItem) = runCatching { Color.parseColor(r.accent) }.getOrDefault(Color.parseColor(RemClock.ACCENT))
    private fun action(c: Context, id: String, op: String, mutable: Boolean = false) = PendingIntent.getBroadcast(c, Notifier.nid("rem:$id:$op"),
        Intent(c, RemAction::class.java).putExtra("id", id).putExtra("op", op),
        (if (mutable) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE) or PendingIntent.FLAG_UPDATE_CURRENT)

    /** Heads up, its colour, its two buttons. Quiet on its own: the channel has no sound (PS plays it, see play). */
    private fun post(c: Context, r: RemItem, wrong: Boolean): Boolean {
        if (!can(c)) return false
        val text = if (wrong) "${r.text}\nOnly ${r.word} clears this" else r.text
        val pub = Notification.Builder(c, CH).setSmallIcon(R.drawable.ic_stat_ps).setColor(color(r)).setContentTitle(r.pill).build()
        val b = Notification.Builder(c, CH)
            .setSmallIcon(R.drawable.ic_stat_ps).setColor(color(r))
            .setContentTitle(r.pill).setContentText(text).setStyle(Notification.BigTextStyle().bigText(text))
            .setCategory(Notification.CATEGORY_REMINDER)
            .setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(pub)
            .setOnlyAlertOnce(true).setAutoCancel(false).setShowWhen(true)
            .setContentIntent(Notifier.openIntent(c, "list", Notifier.nid("rem:open:${r.id}")))
            .setDeleteIntent(action(c, r.id, "swipe"))   // swiped away = Remind me in
            .addAction(Notification.Action.Builder(null, r.later, action(c, r.id, "snooze")).build())
        // V1.55 Open task (a reminder on a task): PS opens at the list with that task glowing; the notification stays.
        if (r.open.isNotEmpty() && RemClock.okTask(r.task))
            b.addAction(Notification.Action.Builder(null, r.open, Notifier.openIntent(c, "task:${r.task}", Notifier.nid("rem:task:${r.id}"))).build())
        if (r.click) b.addAction(Notification.Action.Builder(null, r.yes, action(c, r.id, "done")).build())
        else b.addAction(Notification.Action.Builder(null, r.yes, action(c, r.id, "reply", mutable = true))
            .addRemoteInput(RemoteInput.Builder("word").setLabel("Type ${r.word}").build())
            .setAllowGeneratedReplies(false).build())
        nm(c).notify(tag(r.id), NID, b.build())
        Island.reminder(c, r.id, r.pill, r.text, r.task.takeIf { RemClock.okTask(it) })   // V1.59: the island pops it too
        return true
    }
    private fun away(c: Context, id: String) { nm(c).cancel(tag(id), NID); if (playing == id) stopSound() }

    // ---------- answers ----------
    /** A button, the reply box or a swipe on a reminder (or on the test). */
    fun answer(c: Context, id: String, op: String, typed: String?, done: (() -> Unit)? = null) = work(done) {
        if (op == "test") { stopTest(c); return@work }
        val now = System.currentTimeMillis()
        val r = items(c).firstOrNull { it.id == id }
        if (r == null) { away(c, id); return@work }
        val a = when (op) {
            "snooze", "swipe" -> RemClock.snoozeAct(r, now)
            "done" -> RemClock.doneAct(r, now, device())
            "reply" -> if (RemClock.confirms(r, typed)) RemClock.doneAct(r, now, device()) else null
            else -> return@work
        }
        if (a == null) {
            // The wrong word: the same notification again, quietly, with what clears it.
            post(c, r, wrong = true)
            Plog.i("rem: $id wrong word")
            return@work
        }
        sp(c).edit().putString("ans", RemClock.answersJson(answers(c) + (id to a)).toString()).apply()
        away(c, id)
        saveShown(c, shown(c).apply { remove(id) })
        Plog.i("rem: $id ${a.act} ($op)")
        deliver(c, a)
        settle(c, "answer", refresh = false)
    }
    /** To the page now, or kept until it runs (Receivers.flushPending), like the gym's Acknowledge. */
    private fun deliver(c: Context, a: RemAnswer) {
        val o = RemClock.actJson(a)
        if (WebHost.unlocked) WebHost.post(o)
        else {
            val p = c.getSharedPreferences("pending", Context.MODE_PRIVATE)
            val kept = p.getStringSet("rem", emptySet())!!.filterNot { s -> runCatching { JSONObject(s).optString("id") == a.id }.getOrDefault(true) }
            p.edit().putStringSet("rem", (kept + o.toString()).toSet()).apply()
            Reminds.saveSoon(c)   // a background check soon carries it to the vault, so the Mac card goes too
        }
    }

    // ---------- the sound ----------
    private var player: MediaPlayer? = null
    private var playing: String? = null
    private fun mayPlay(c: Context): Boolean {
        val ringer = runCatching { c.getSystemService(AudioManager::class.java).ringerMode == AudioManager.RINGER_MODE_NORMAL }.getOrDefault(false)
        val phoneDnd = runCatching { nm(c).currentInterruptionFilter != NotificationManager.INTERRUPTION_FILTER_ALL }.getOrDefault(false)
        return ringer && !phoneDnd && !Dnd.mutes(c, "followup")
    }
    fun ownFile(c: Context, id: String) = File(File(c.filesDir, "rem-sounds"), "$id.wav")
    /** The built in sound, made once from the tone tables and kept in the cache. */
    private fun builtIn(c: Context, kind: String): File? {
        val f = File(c.cacheDir, "rem-$kind-1.wav")
        if (f.isFile) return f
        return runCatching {
            val tmp = File(c.cacheDir, "rem-$kind-1.tmp")
            tmp.writeBytes(RemTones.wavBytes(RemTones.builtIn(kind)))
            check(tmp.renameTo(f)); f
        }.getOrNull()
    }
    private fun play(c: Context, r: RemItem, test: Boolean) {
        stopSound()
        if (r.sound == "none" || (!test && !mayPlay(c))) return
        val own = ownFile(c, r.id).takeIf { r.sound == "own" && it.isFile }
        val file = own ?: builtIn(c, if (r.sound == "alarm") "alarm" else "soft") ?: return
        val attrs = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
        val mp = runCatching { MediaPlayer().apply { setAudioAttributes(attrs); setDataSource(file.path); prepare() } }.getOrNull()
            ?: return Plog.i("rem: no sound")
        mp.setVolume(r.vol.toFloat(), r.vol.toFloat())
        mp.setOnCompletionListener { done -> work { if (player === done) stopSound() else runCatching { done.release() } } }
        player = mp; playing = if (test) TEST_TAG else r.id
        runCatching { mp.start() }.onFailure { stopSound() }
    }
    private fun stopSound() {
        player?.let { runCatching { it.stop() }; runCatching { it.release() } }
        player = null; playing = null
    }

    // ---------- Test (Settings) ----------
    /** {type:"rem:test", item}: the notification now (tag "remtest") and its sound once. Its buttons only close it. */
    fun test(c: Context, o: JSONObject?) = work {
        val r = o?.let { runCatching { RemClock.item(it) }.getOrNull() } ?: return@work
        if (can(c)) {
            val close = action(c, TEST_TAG, "test")
            nm(c).notify(TEST_TAG, NID, Notification.Builder(c, CH)
                .setSmallIcon(R.drawable.ic_stat_ps).setColor(color(r))
                .setContentTitle(r.pill).setContentText(r.text).setStyle(Notification.BigTextStyle().bigText(r.text))
                .setCategory(Notification.CATEGORY_REMINDER).setOnlyAlertOnce(true).setAutoCancel(true)
                .setDeleteIntent(close)
                .addAction(Notification.Action.Builder(null, r.later, close).build())
                .addAction(Notification.Action.Builder(null, r.yes, close).build())
                .build())
        }
        play(c, r, test = true)
        Plog.i("rem: test")
    }
    fun testStop(c: Context) = work { stopTest(c) }
    private fun stopTest(c: Context) { nm(c).cancel(TEST_TAG, NID); if (playing == TEST_TAG) stopSound() }

    // ---------- your own sound per reminder (stays on this phone) ----------
    private fun names(c: Context): JSONObject = runCatching { JSONObject(sp(c).getString("own", null) ?: "{}") }.getOrDefault(JSONObject())
    /** {type:"rem:sound", own: {[id]: {name, secs}}, error?} to the page. Only files that are really here. */
    private fun postSound(c: Context, error: String? = null) {
        val n = names(c); val own = JSONObject()
        for (id in n.keys()) if (RemClock.okId(id) && ownFile(c, id).isFile) n.optJSONObject(id)?.let { own.put(id, it) }
        val o = JSONObject().put("type", "rem:sound").put("own", own)
        if (error != null) o.put("error", error)
        WebHost.post(o)
    }
    fun soundGet(c: Context) = work { postSound(c) }
    /** The WAV the page made (core/alarmsound.ts ownSound), under 4 MB. */
    fun soundSave(c: Context, id: String, name: String, secs: Double, b64: String) = work {
        val bytes = if (RemClock.okId(id) && b64.length <= OWN_MAX / 3 * 4 + 16) runCatching { Base64.decode(b64, Base64.DEFAULT) }.getOrNull() else null
        if (bytes == null || bytes.size > OWN_MAX || !SleepClock.okOwnWav(bytes)) {
            Plog.i("rem: own sound refused"); postSound(c, "PS app could not keep that sound on this phone."); return@work
        }
        val ok = runCatching {
            val dir = File(c.filesDir, "rem-sounds").apply { mkdirs() }
            val tmp = File(dir, "$id.tmp")
            tmp.writeBytes(bytes)
            check(tmp.renameTo(ownFile(c, id)))
        }.isSuccess
        if (!ok) { postSound(c, "PS app could not keep that sound on this phone."); return@work }
        val n = names(c).put(id, JSONObject().put("name", SleepClock.ownName(name) ?: "Your sound").put("secs", secs.coerceIn(0.0, 60.0)))
        sp(c).edit().putString("own", n.toString()).apply()
        Plog.i("rem: own sound kept for $id (${bytes.size / 1024} KB)")
        postSound(c)
    }
    fun soundRemove(c: Context, id: String) = work {
        if (!RemClock.okId(id)) return@work
        if (playing == id) stopSound()
        ownFile(c, id).delete()
        val n = names(c); n.remove(id)
        sp(c).edit().putString("own", n.toString()).apply()
        Plog.i("rem: own sound removed for $id")
        postSound(c)
    }
}

/** The one reminder alarm: a window opens or closes, or a snooze is up. */
class RemAlarm : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) { val p = goAsync(); Remind.alarm(c.applicationContext) { p.finish() } }
}
/** The clock was set or the zone changed (a trip): the reminders without a zone of their own follow the phone. */
class RemTime : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        if (i.action != Intent.ACTION_TIME_CHANGED && i.action != Intent.ACTION_TIMEZONE_CHANGED) return
        Soundboard.restore(c.applicationContext)   // the Soundboard's timed plays follow the phone's clock too
        val p = goAsync(); Remind.restore(c.applicationContext) { p.finish() }
    }
}
/** Remind me in, the confirm button, the typed word, or a swipe, on a reminder or the test. */
class RemAction : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        val id = i.getStringExtra("id") ?: return
        val op = i.getStringExtra("op") ?: return
        val typed = RemoteInput.getResultsFromIntent(i)?.getCharSequence("word")?.toString()
        val p = goAsync()
        Remind.answer(c.applicationContext, id, op, typed) { p.finish() }
    }
}
