package com.cincee.ps.gos

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.VibratorManager
import android.widget.RemoteViews
import org.json.JSONObject

/**
 * The Fitness tab's rest timer and screen wake (contract: side-session-notes fitness/android-bridge.md).
 * A ticked set starts a rest: a live countdown on the lock screen (the system chronometer, so nothing
 * ticks while the phone sleeps), +15 s and Skip on the notification, and at zero a strong buzz (even in
 * silent mode) plus a short chime (never in silent or vibrate mode or Android Do Not Disturb).
 * The exact alarm ends the rest on time through Doze; the foreground service keeps PS (and the open
 * workout page) alive while resting and shows the countdown. All state is wall clock times (RestClock.kt).
 */
object Fitness {
    const val REST = "rest"
    const val OVER = "rest_over"
    private const val REST_ID = 21
    private const val OVER_ID = 22
    private const val REST_SUM = 23
    private const val OVER_SUM = 24
    private val main = Handler(Looper.getMainLooper())
    private var rest: Rest? = null
    private var loaded = false

    private fun sp(c: Context) = c.getSharedPreferences("fitness", Context.MODE_PRIVATE)
    fun current(c: Context): Rest? { if (!loaded) { rest = RestClock.decode(sp(c).getString("rest", null)); loaded = true }; return rest }
    private fun save(c: Context, r: Rest?) { rest = r; loaded = true; sp(c).edit().putString("rest", RestClock.encode(r)).apply() }

    // ---------- from the page ----------
    fun onMessage(c: Context, m: JSONObject) {
        when (m.optString("type")) {
            "fitness:start" -> start(c, m)
            "fitness:add" -> add(c, m.optInt("sec", 15), "page")
            "fitness:skip" -> skip(c, "page")
            "fitness:cancel" -> cancel(c)
            "fitness:awake" -> Awake.set(m.optBoolean("on"))
            "fitness:get" -> tell(c, "state", "page")
        }
    }

    private fun start(c: Context, m: JSONObject) {
        if (Nuke.done(c)) return
        val r = RestClock.start(System.currentTimeMillis(), m.optInt("sec", 90), m.optString("exercise"), m.optInt("set"),
            m.optInt("of"), m.optString("id"), m.optBoolean("sound", true))
        save(c, r)
        hideOver(c)
        arm(c, r)
        show(c)
        tell(c, "started", "page")
    }

    fun add(c: Context, sec: Int, from: String) {
        val now = System.currentTimeMillis()
        val before = current(c)
        val r = RestClock.add(before, now, sec)
        if (r == null || r == before || !r.running(now)) { tell(c, "state", from); return }
        save(c, r)
        arm(c, r)
        show(c)
        tell(c, "added", from)
    }

    fun skip(c: Context, from: String) {
        val r = current(c)
        if (r == null || r.over) { tell(c, "state", from); return }
        save(c, RestClock.finish(r, System.currentTimeMillis()))
        disarm(c)
        hide(c)
        tell(c, "skipped", from)
    }

    private fun cancel(c: Context) {
        save(c, null)
        disarm(c)
        hide(c)
        hideOver(c)
        tell(c, "cancelled", "page")
    }

    /** The alarm (or the service's own check while the phone is awake). Ends it once; `done` lets the
     *  alarm's broadcast keep the phone awake until the chime has played. */
    fun fire(c: Context, from: String, done: () -> Unit = {}) {
        val now = System.currentTimeMillis()
        val r = current(c)
        when (RestClock.onAlarm(r, now)) {
            RestClock.Fire.NOTHING -> done()
            RestClock.Fire.REARM -> { arm(c, r!!); done() }
            RestClock.Fire.END -> {
                val over = RestClock.finish(r, now)!!
                save(c, over)
                hide(c)
                overNotice(c, over)
                Buzz.go(c, over.sound, done)
                tell(c, "ended", from)
                Plog.i("fitness: rest over (${over.sec} s)")
            }
        }
    }

    /** After a reboot or an update in the middle of a rest. */
    fun restore(c: Context) {
        val r = current(c) ?: return
        val now = System.currentTimeMillis()
        when {
            r.over -> {}
            r.endsAt > now -> { arm(c, r); show(c) }
            now - r.endsAt < 60_000 -> fire(c, "system")
            else -> save(c, RestClock.finish(r, r.endsAt))   // long gone: no late buzz
        }
    }

    // ---------- to the page ----------
    fun json(c: Context, event: String, from: String): JSONObject {
        val r = current(c)
        return JSONObject().put("type", "fitness").put("event", event).put("from", from)
            .put("rest", r?.let {
                JSONObject().put("id", it.id).put("exercise", it.exercise).put("set", it.set).put("of", it.of).put("sec", it.sec)
                    .put("startedAt", it.startedAt).put("endsAt", it.endsAt).put("over", it.over).put("overAt", it.overAt)
            } ?: JSONObject.NULL)
            .put("awake", Awake.on)
            .put("perms", JSONObject().put("notifications", canNotify(c)).put("exactAlarm", c.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()))
    }
    private fun tell(c: Context, event: String, from: String) = WebHost.post(json(c, event, from))

    // ---------- the alarm ----------
    private fun alarmIntent(c: Context) = PendingIntent.getBroadcast(c, 2101, Intent(c, RestAlarm::class.java),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    private fun arm(c: Context, r: Rest) {
        val am = c.getSystemService(AlarmManager::class.java)
        val at = r.endsAt.coerceAtLeast(System.currentTimeMillis() + 500)
        // USE_EXACT_ALARM is granted at install for a timer, so this is the normal path; the window is only a fallback.
        if (am.canScheduleExactAlarms()) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, alarmIntent(c))
        else am.setWindow(AlarmManager.RTC_WAKEUP, at, 5_000, alarmIntent(c))
        RestService.due(r.endsAt)
    }
    private fun disarm(c: Context) { c.getSystemService(AlarmManager::class.java).cancel(alarmIntent(c)); RestService.due(0) }

    // ---------- notifications ----------
    private fun nm(c: Context) = c.getSystemService(NotificationManager::class.java)
    private fun canNotify(c: Context) = c.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun action(c: Context, what: String, label: String): Notification.Action =
        Notification.Action.Builder(null, label, PendingIntent.getBroadcast(c, Notifier.nid("rest$what"),
            Intent(c, RestAction::class.java).putExtra("what", what), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)).build()

    /** The countdown: a big system chronometer (counts down by itself, no wake ups) and the set line. */
    fun restNotice(c: Context, r: Rest): Notification {
        val left = (r.endsAt - System.currentTimeMillis()).coerceAtLeast(0)
        fun views(layout: Int) = RemoteViews(c.packageName, layout).apply {
            setChronometer(R.id.rest_clock, SystemClock.elapsedRealtime() + left, null, true)
            setChronometerCountDown(R.id.rest_clock, true)
            setTextViewText(R.id.rest_line, r.doneLine())
        }
        return Notification.Builder(c, REST)
            .setSmallIcon(R.drawable.ic_stat_ps).setColor(Color.parseColor("#EC4E86"))
            .setContentTitle("Rest").setContentText(r.doneLine())
            .setStyle(Notification.DecoratedCustomViewStyle())
            .setCustomContentView(views(R.layout.notif_rest_small))
            .setCustomBigContentView(views(R.layout.notif_rest))
            // The big clock above is the only one: a second chronometer in the header ran a second apart.
            .setWhen(r.endsAt).setShowWhen(false)
            .setOngoing(true).setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_STOPWATCH)
            .setGroup("fitness-rest")   // a real group of its own (summary below), see groupOf()
            .setVisibility(Notification.VISIBILITY_PUBLIC)   // the countdown is the point of the lock screen; exercise and set only
            .setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(Notifier.openIntent(c, "fitness", 2102))
            .addAction(action(c, "add", "+15 s"))
            .addAction(action(c, "skip", "Skip"))
            .build()
    }

    private fun overNotice(c: Context, r: Rest) {
        if (!canNotify(c)) return
        val n = Notification.Builder(c, OVER)
            .setSmallIcon(R.drawable.ic_stat_ps).setColor(Color.parseColor("#EC4E86"))
            .setContentTitle("Rest over: next set").setContentText(r.nextLine())
            .setShowWhen(true).setWhen(r.overAt)
            .setCategory(Notification.CATEGORY_REMINDER)
            .setGroup("fitness-over")
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setAutoCancel(true).setTimeoutAfter(30 * 60_000)
            .setContentIntent(Notifier.openIntent(c, "fitness", 2103))
            .build()
        groupOf(c, OVER, "fitness-over", OVER_SUM)
        nm(c).notify(OVER_ID, n)
    }

    /** Android 16 bundles every loose PS notification (client emails, calls, chats) into one "PS" stack, and
     *  a bundled countdown shows as one plain line on the lock screen. A real group (a summary plus this one
     *  child) is left alone, and with a single child the system shows the child itself, big clock and all. */
    internal fun groupOf(c: Context, channel: String, group: String, id: Int) {
        if (!canNotify(c)) return
        nm(c).notify(id, Notification.Builder(c, channel)
            .setSmallIcon(R.drawable.ic_stat_ps).setColor(Color.parseColor("#EC4E86"))
            .setGroup(group).setGroupSummary(true).setOnlyAlertOnce(true)
            .setOngoing(channel == REST).setAutoCancel(channel == OVER)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setContentIntent(Notifier.openIntent(c, "fitness", 2104))
            .build())
    }
    internal fun restGroup(c: Context) = groupOf(c, REST, "fitness-rest", REST_SUM)

    /** The countdown on screen: the foreground service while resting; a plain notification if the
     *  system refuses the service (it should not: PS is on screen when a set is ticked). */
    private fun show(c: Context) {
        val r = current(c) ?: return
        restGroup(c)
        if (RestService.running) { if (canNotify(c)) nm(c).notify(REST_ID, restNotice(c, r)); return }
        runCatching { c.startForegroundService(Intent(c, RestService::class.java)) }.onFailure {
            Plog.i("fitness: no foreground service (${it.javaClass.simpleName}), the alarm still ends the rest")
            if (canNotify(c)) nm(c).notify(REST_ID, restNotice(c, r))
        }
    }
    private fun hide(c: Context) {
        c.stopService(Intent(c, RestService::class.java))
        nm(c).cancel(REST_ID); nm(c).cancel(REST_SUM)
    }
    private fun hideOver(c: Context) { nm(c).cancel(OVER_ID); nm(c).cancel(OVER_SUM) }

    internal fun serviceNotice(c: Context): Notification? = current(c)?.takeIf { !it.over }?.let { restNotice(c, it) }
    internal const val SERVICE_ID = REST_ID

    /** Keep the screen on while a workout is open (MainActivity applies it while PS is in front). */
    object Awake {
        const val MAX_MS = 3 * 3_600_000L
        var on = false; private set
        private var until = 0L
        fun set(v: Boolean) {
            on = v; until = if (v) System.currentTimeMillis() + MAX_MS else 0
            main.removeCallbacks(expire)
            if (v) main.postDelayed(expire, MAX_MS)
            WebHost.activity?.applyAwake()
        }
        fun wanted() = on && System.currentTimeMillis() < until
        private val expire = Runnable { if (on) { Plog.i("fitness: screen wake ran 3 hours, released"); set(false) } }
    }

    /** The end of a rest: strong buzz always (alarm vibration ignores silent mode), chime only when the
     *  phone rings normally and Android Do Not Disturb is off. Music ducks for the chime. */
    object Buzz {
        private val PATTERN = longArrayOf(0, 450, 160, 450, 160, 900)
        private val AMPS = intArrayOf(0, 255, 0, 255, 0, 255)
        fun go(c: Context, sound: Boolean, done: () -> Unit) {
            runCatching {
                val v = c.getSystemService(VibratorManager::class.java).defaultVibrator
                val fx = if (v.hasAmplitudeControl()) VibrationEffect.createWaveform(PATTERN, AMPS, -1) else VibrationEffect.createWaveform(PATTERN, -1)
                v.vibrate(fx, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM))
            }.onFailure { Plog.i("fitness: no vibration (${it.javaClass.simpleName})") }
            val ring = sound && mayRing(c)
            Plog.i(if (ring) "fitness: buzz and chime" else "fitness: buzz only (${if (sound) "phone on silent, vibrate or Do Not Disturb" else "sound off"})")
            if (!ring) { main.postDelayed({ done() }, 300); return }
            chime(c, done)
        }
        fun mayRing(c: Context): Boolean {
            val am = c.getSystemService(AudioManager::class.java)
            val f = c.getSystemService(NotificationManager::class.java).currentInterruptionFilter
            return am.ringerMode == AudioManager.RINGER_MODE_NORMAL &&
                (f == NotificationManager.INTERRUPTION_FILTER_ALL || f == NotificationManager.INTERRUPTION_FILTER_UNKNOWN)
        }
        private fun chime(c: Context, done: () -> Unit) {
            val attrs = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
            val am = c.getSystemService(AudioManager::class.java)
            val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(attrs).build()
            var finished = false
            val finish = { if (!finished) { finished = true; runCatching { am.abandonAudioFocusRequest(focus) }; done() } }
            val mp = runCatching { MediaPlayer.create(c, R.raw.rest_over, attrs, am.generateAudioSessionId()) }.getOrNull()
            if (mp == null) { Plog.i("fitness: chime could not play"); finish(); return }
            am.requestAudioFocus(focus)
            mp.setOnCompletionListener { it.release(); finish() }
            mp.setOnErrorListener { p, _, _ -> p.release(); finish(); true }
            mp.start()
            main.postDelayed({ finish() }, 4_000)   // never hold the broadcast longer than this
        }
    }
}

/** Keeps PS (and the open workout page) alive while resting and shows the countdown. Ends with the rest. */
class RestService : Service() {
    companion object {
        @Volatile var running = false; private set
        private var self: RestService? = null
        /** While the phone is awake the service ends the rest itself on the second; the exact alarm covers sleep. */
        fun due(at: Long) { self?.watch(at) }
    }
    private val h = Handler(Looper.getMainLooper())
    private val check = Runnable { Fitness.fire(this, "alarm") }

    override fun onBind(i: Intent?): IBinder? = null
    override fun onStartCommand(i: Intent?, flags: Int, id: Int): Int {
        val n = Fitness.serviceNotice(this) ?: run { stopSelf(); return START_NOT_STICKY }
        Fitness.restGroup(this)
        startForeground(Fitness.SERVICE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        running = true; self = this
        Fitness.current(this)?.let { watch(it.endsAt) }
        return START_NOT_STICKY   // the alarm, not a restart, ends a rest if PS is killed
    }
    private fun watch(at: Long) {
        h.removeCallbacks(check)
        if (at > 0) h.postDelayed(check, (at - System.currentTimeMillis()).coerceAtLeast(0))
    }
    override fun onDestroy() {
        h.removeCallbacks(check)
        running = false; if (self === this) self = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }
}

/** The rest's exact alarm. Holds the broadcast (goAsync) until the buzz and chime are done. */
class RestAlarm : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        val p = goAsync()
        Fitness.fire(c.applicationContext, "alarm") { runCatching { p.finish() } }
    }
}

/** +15 s and Skip on the lock screen. */
class RestAction : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        when (i.getStringExtra("what")) {
            "add" -> Fitness.add(c.applicationContext, 15, "notification")
            "skip" -> Fitness.skip(c.applicationContext, "notification")
        }
    }
}
