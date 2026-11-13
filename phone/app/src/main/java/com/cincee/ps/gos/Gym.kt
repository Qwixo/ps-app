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
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.VibratorManager
import android.view.Gravity
import android.view.WindowManager
import android.view.animation.OvershootInterpolator
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * The gym reminder on the phone (the developer, 2 Nov 2026). The page hands over a plan (GymClock.kt); from it the
 * shell arms ONE exact alarm at a time, for the next step:
 *  - 2 h, 1 h, 30 min and 10 min before: a notification (one per day, its words move on), with Acknowledge.
 *  - 16 min before: it RINGS. A foreground service plays the alarm sound on the alarm volume and buzzes,
 *    and a full screen card (Acknowledge, Later) comes up, over the lock screen too. The developer, 2 Nov 2026:
 *    each ring stops by itself after 10 minutes and leaves a missed-gym notification; Later is quiet for
 *    5 minutes, then it rings again (again for at most 10); Acknowledge (here, on a notification, on the
 *    Mac) ends it at any time, ringing or snoozed. GymClock.ringNow decides, from the ring kept in prefs.
 *  - It is an alarm, so it rings through PS Do Not Disturb: nothing in this file asks Dnd (the Mac's cards
 *    stay quiet under DND, web src/core/gym.ts gymQuiet).
 * Acknowledge is saved in the vault by the page ({type:"gymAck", day}), so the Mac's card goes too. While
 * it rings, the shell asks vault_probe every 20 s (a few hundred bytes): when the vault moved (the Mac's
 * Acknowledge, say), one background check lets the page sync, and its new plan stops the ring.
 * Only times are kept here, never a title: nothing about the developer's day is on the lock screen beyond "Gym".
 */
object Gym {
    const val NOTE = "gym"
    const val RING = "gym_ring"
    internal const val NOTE_ID = 31
    internal const val RING_ID = 32
    internal const val MISSED_ID = 33
    internal const val SNOOZED_ID = 34
    private const val GOLD = "#F5C542"
    private val main = Handler(Looper.getMainLooper())

    private fun sp(c: Context) = c.getSharedPreferences("gym", Context.MODE_PRIVATE)
    fun plan(c: Context): GymPlan? = GymClock.parse(sp(c).getString("plan", null))
    private fun fired(c: Context): Set<String> = sp(c).getStringSet("fired", emptySet())!!.toSet()
    internal fun local(c: Context): Set<String> = sp(c).getStringSet("acked", emptySet())!!.toSet()
    fun ring(c: Context): GymRing? = sp(c).getString("ringDay", null)?.let { GymRing(it, sp(c).getLong("ringAt", 0), sp(c).getLong("ringStart", 0), sp(c).getLong("snoozeAt", 0)) }
    fun ringDay(c: Context): String? = ring(c)?.day
    fun ringAt(c: Context): Long = ring(c)?.at ?: 0
    fun ringing(c: Context) = GymClock.ringNow(ring(c), plan(c), System.currentTimeMillis(), local(c)) == RingNow.RINGING
    private fun saveRing(c: Context, r: GymRing) {
        sp(c).edit().putString("ringDay", r.day).putLong("ringAt", r.at).putLong("ringStart", r.start).putLong("snoozeAt", r.snoozeAt).apply()
    }

    // ---------- from the page ----------
    fun setPlan(c: Context, j: JSONObject) {
        val p = runCatching { GymClock.from(j) }.getOrNull() ?: return
        // Days the vault knows are acknowledged no longer need this phone's own copy.
        val keep = local(c).filter { it !in p.acked && it >= GymClock.minusDay(today()) }.toSet()
        sp(c).edit().putString("plan", GymClock.toJson(p).toString()).putStringSet("acked", keep).apply()
        sp(c).getString("noteDay", null)?.let { d -> if (d in p.acked || !p.on) cancelNote(c) }
        check(c, "plan")   // acknowledged on the Mac: the ring (or Later's wait) ends here
    }

    /** The alarm, a reboot, an update, a new plan or the ring service: settle the ring, fire what is due now
     *  (never late), arm the next. */
    fun check(c: Context, from: String) {
        val p = plan(c)
        val now = System.currentTimeMillis()
        val r = ring(c)
        when (GymClock.ringNow(r, p, now, local(c))) {
            RingNow.DONE -> { Plog.i("gym: ring over (acknowledged or switched off)"); endRing(c) }
            RingNow.MISSED -> { Plog.i("gym: rang 10 minutes unanswered, missed"); endRing(c); missed(c, r!!) }
            RingNow.AGAIN -> { Plog.i("gym: Later is up, ringing again"); startRing(c, GymClock.again(r!!, now)) }
            else -> {}
        }
        var f = fired(c)
        for (s in GymClock.dueNow(p, now, f, local(c))) {
            f = f + s.id
            if (s.ring) startRing(c, GymRing(s.day, s.at, now)) else note(c, s, p!!)
            Plog.i("gym: ${if (s.ring) "ring" else "reminder ${s.mins} min"} ($from)")
        }
        sp(c).edit().putStringSet("fired", GymClock.prune(f, today())).apply()
        arm(c)
    }
    fun restore(c: Context) {
        check(c, "system")
        // Rebooted mid ring: it goes on for what is left of its 10 minutes (Later's wait is armed by check).
        if (ringing(c)) runCatching { c.startForegroundService(Intent(c, GymRingService::class.java)) }
    }

    private fun today() = java.time.LocalDate.now().toString()

    // ---------- the alarm ----------
    private fun alarmIntent(c: Context) = PendingIntent.getBroadcast(c, 3101, Intent(c, GymAlarm::class.java),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    private fun arm(c: Context) {
        val am = c.getSystemService(AlarmManager::class.java)
        am.cancel(alarmIntent(c))
        val n = GymClock.next(plan(c), System.currentTimeMillis(), fired(c), local(c))
        // The ring needs the alarm too: Later's ring again, or its 10 minutes being up.
        val r = ring(c)
        val w = GymClock.ringWake(r)
        val (due, ringing) = listOfNotNull(n?.let { it.due to it.ring }, w?.let { it to (r!!.snoozeAt > 0) }).minByOrNull { it.first } ?: return
        val at = due.coerceAtLeast(System.currentTimeMillis() + 1000)
        // A ring is a real alarm clock (the system keeps it exact through Doze and shows the alarm icon);
        // the rest use the same exact alarms as the 10 minute call alerts.
        if (ringing && am.canScheduleExactAlarms()) am.setAlarmClock(AlarmManager.AlarmClockInfo(at, Notifier.openIntent(c, "fitness", 3102)), alarmIntent(c))
        else if (am.canScheduleExactAlarms()) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, alarmIntent(c))
        else am.setWindow(AlarmManager.RTC_WAKEUP, at, 60_000, alarmIntent(c))
    }

    // ---------- the four reminders ----------
    private fun nm(c: Context) = c.getSystemService(NotificationManager::class.java)
    private fun can(c: Context) = c.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    private fun ackIntent(c: Context, day: String) = PendingIntent.getBroadcast(c, Notifier.nid("gymack$day"),
        Intent(c, GymAction::class.java).putExtra("day", day), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    private fun note(c: Context, s: GymStep, p: GymPlan) {
        if (!can(c)) return
        val n = Notification.Builder(c, NOTE)
            .setSmallIcon(R.drawable.ic_stat_ps).setColor(Color.parseColor(GOLD))
            .setContentTitle(GymClock.title(s.at, System.currentTimeMillis()))
            .setContentText("At ${p.time}. Your phone rings ${p.ring} minutes before.")
            .setWhen(s.at).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true)
            .setCategory(Notification.CATEGORY_REMINDER)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(false)
            .setTimeoutAfter((s.at + 90 * 60_000L - System.currentTimeMillis()).coerceAtLeast(60_000L))
            .setContentIntent(Notifier.openIntent(c, "fitness", 3103))
            .addAction(Notification.Action.Builder(null, "Acknowledge", ackIntent(c, s.day)).build())
            .setGroup("gym")
            .build()
        sp(c).edit().putString("noteDay", s.day).apply()
        nm(c).notify(NOTE_ID, n)
    }
    private fun cancelNote(c: Context) { nm(c).cancel(NOTE_ID); nm(c).cancel(MISSED_ID); sp(c).edit().remove("noteDay").apply() }
    private fun hm(at: Long) = java.time.Instant.ofEpochMilli(at).atZone(java.time.ZoneId.systemDefault()).toLocalTime().toString().take(5)

    /** It rang 10 minutes and nobody answered: one notification that stays, with Acknowledge. */
    private fun missed(c: Context, r: GymRing) {
        if (!can(c)) return
        val n = Notification.Builder(c, NOTE)
            .setSmallIcon(R.drawable.ic_stat_ps).setColor(Color.parseColor(GOLD))
            .setContentTitle("Missed gym alarm")
            .setContentText("Gym at ${hm(r.at)}. It rang for 10 minutes.")
            .setCategory(Notification.CATEGORY_REMINDER)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setContentIntent(Notifier.openIntent(c, "fitness", 3105))
            .addAction(Notification.Action.Builder(null, "Acknowledge", ackIntent(c, r.day)).build())
            .setGroup("gym")
            .build()
        sp(c).edit().putString("noteDay", r.day).apply()
        nm(c).notify(MISSED_ID, n)
    }

    // ---------- the ring ----------
    private fun startRing(c: Context, r: GymRing) {
        saveRing(c, r)
        nm(c).cancel(SNOOZED_ID)
        runCatching { c.startForegroundService(Intent(c, GymRingService::class.java)) }.onFailure {
            // The exact alarm lets PS start the service; if the system refuses anyway, the card and one long buzz still come.
            Plog.i("gym: no ring service (${it.javaClass.simpleName}), notification only")
            if (can(c)) nm(c).notify(RING_ID, ringNotice(c))
            Buzz.once(c)
        }
    }
    /** Quiet now: no sound, no ring card. The ring itself is kept (Later). */
    private fun silence(c: Context) {
        c.stopService(Intent(c, GymRingService::class.java))
        nm(c).cancel(RING_ID)
        GymRingActivity.closeAll()
    }
    /** The ring is over: acknowledged, switched off, or missed. */
    fun endRing(c: Context) {
        sp(c).edit().remove("ringDay").remove("ringAt").remove("ringStart").remove("snoozeAt").apply()
        silence(c)
        nm(c).cancel(SNOOZED_ID)
    }

    /** Later (the ring card or its notification): quiet for 5 minutes, then it rings again. */
    fun later(c: Context, from: String) {
        val r = ring(c) ?: return
        if (!ringing(c)) return
        val s = GymClock.later(r, System.currentTimeMillis())
        saveRing(c, s)
        silence(c)
        // On the ring's channel: no sound and no buzz of its own, so the wait itself is quiet.
        if (can(c)) nm(c).notify(SNOOZED_ID, Notification.Builder(c, RING)
            .setSmallIcon(R.drawable.ic_stat_ps).setColor(Color.parseColor(GOLD))
            .setContentTitle("Gym alarm in 5 minutes").setContentText("Gym at ${hm(r.at)}. Rings again at ${hm(s.snoozeAt)}.")
            .setCategory(Notification.CATEGORY_REMINDER).setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true).setOngoing(true)
            .setContentIntent(Notifier.openIntent(c, "fitness", 3106))
            .addAction(Notification.Action.Builder(null, "Acknowledge", ackIntent(c, r.day)).build())
            .setGroup("gym").build())
        arm(c)
        Plog.i("gym: Later, rings again in 5 minutes ($from)")
    }

    /** The full screen card while it rings (over the lock screen; "Gym" and the time only). */
    fun ringNotice(c: Context): Notification {
        val time = hm(ringAt(c))
        val full = PendingIntent.getActivity(c, 3104, Intent(c, GymRingActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val day = ringDay(c) ?: today()
        return Notification.Builder(c, RING)
            .setSmallIcon(R.drawable.ic_stat_ps).setColor(Color.parseColor(GOLD))
            .setContentTitle("Gym at $time").setContentText("Rings up to 10 minutes. Later: again in 5.")
            .setCategory(Notification.CATEGORY_ALARM)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(true).setOnlyAlertOnce(true)
            .setFullScreenIntent(full, true)
            .setContentIntent(full)
            .setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(Notification.Action.Builder(null, "Acknowledge", ackIntent(c, day)).build())
            .addAction(Notification.Action.Builder(null, "Later", laterIntent(c)).build())
            .build()
    }
    private fun laterIntent(c: Context) = PendingIntent.getBroadcast(c, 3107, Intent(c, GymAction::class.java).putExtra("op", "later"),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    /** Acknowledge on this phone (the ring card or a notification): quiet here at once, then saved in the vault. */
    fun ack(c: Context, day: String, from: String) {
        if (!Regex("""^\d{4}-\d{2}-\d{2}$""").matches(day)) return
        sp(c).edit().putStringSet("acked", local(c) + day).apply()
        endRing(c)
        cancelNote(c)
        arm(c)
        Plog.i("gym: acknowledged ($from)")
        if (WebHost.unlocked) WebHost.post(JSONObject().put("type", "gymAck").put("day", day))
        else {
            val p = c.getSharedPreferences("pending", Context.MODE_PRIVATE)
            p.edit().putStringSet("gym", p.getStringSet("gym", emptySet())!! + day).apply()
            Reminds.saveSoon(c)   // a background check soon carries it to the vault, so the Mac card goes too
        }
    }

    /** While it rings and the screen is off: one background check when the vault moved (see the header). */
    fun syncSoon(c: Context) {
        if (!Prefs.background(c)) return
        WorkManager.getInstance(c).enqueueUniqueWork("ps-gym-sync", ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<PulseWorker>().setInputData(workDataOf("force" to true)).build())
    }

    /** No ring service: one long buzz at least (alarm vibration ignores silent mode). */
    object Buzz {
        private val PATTERN = longArrayOf(0, 900, 300, 900, 300, 900, 300, 1400)
        fun once(c: Context) = runCatching {
            c.getSystemService(VibratorManager::class.java).defaultVibrator
                .vibrate(VibrationEffect.createWaveform(PATTERN, -1), VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM))
        }
        fun loop(c: Context) = runCatching {
            c.getSystemService(VibratorManager::class.java).defaultVibrator
                .vibrate(VibrationEffect.createWaveform(longArrayOf(0, 900, 600), 1), VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM))
        }
        fun stop(c: Context) = runCatching { c.getSystemService(VibratorManager::class.java).defaultVibrator.cancel() }
    }
}

/** Plays the ring until Acknowledge, Later or its 10 minutes are up. Started by the gym alarm (an exact alarm may start a foreground service). */
class GymRingService : Service() {
    private val h = Handler(Looper.getMainLooper())
    private var player: MediaPlayer? = null
    private val bg = Executors.newSingleThreadExecutor()
    private var lastProbe: String? = null
    private val poll = object : Runnable {
        override fun run() {
            val c = this@GymRingService
            if (!Gym.ringing(c)) { Gym.check(c, "ring"); return }
            bg.execute {
                val p = Pulse.probe(c)
                if (p != null && lastProbe != null && p != lastProbe) h.post { Gym.syncSoon(c) }
                if (p != null) lastProbe = p
            }
            h.postDelayed(this, 20_000)
        }
    }

    /** Its 10 minutes are up: check ends it and leaves the missed notification (the exact alarm does too). */
    private val end = Runnable { Gym.check(this, "ring") }

    override fun onBind(i: Intent?): IBinder? = null
    override fun onStartCommand(i: Intent?, flags: Int, id: Int): Int {
        val r = Gym.ring(this)
        if (r == null || !Gym.ringing(this)) { stopSelf(); return START_NOT_STICKY }
        startForeground(Gym.RING_ID, Gym.ringNotice(this), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        if (player == null) play()
        h.removeCallbacks(poll); h.postDelayed(poll, 20_000)
        h.removeCallbacks(end); h.postDelayed(end, (r.start + GymClock.RING_FOR - System.currentTimeMillis()).coerceAtLeast(0) + 500)
        return START_STICKY
    }
    private fun play() {
        val attrs = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
        val uri = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM) ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
        player = runCatching {
            MediaPlayer().apply { setAudioAttributes(attrs); setDataSource(this@GymRingService, uri); isLooping = true; prepare(); start() }
        }.getOrNull() ?: runCatching { MediaPlayer.create(this, R.raw.rest_over, attrs, 0)?.apply { isLooping = true; start() } }.getOrNull()
        if (player == null) Plog.i("gym: no ring sound, buzz only")
        Gym.Buzz.loop(this)
    }
    override fun onDestroy() {
        h.removeCallbacks(poll); h.removeCallbacks(end)
        runCatching { player?.stop(); player?.release() }
        player = null
        Gym.Buzz.stop(this)
        bg.shutdownNow()
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }
}

/** The gym alarm: whatever step is due now. */
class GymAlarm : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) { Gym.check(c.applicationContext, "alarm") }
}
/** Acknowledge on a gym notification or on the ring's notification; Later on the ring's notification. */
class GymAction : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        if (i.getStringExtra("op") == "later") Gym.later(c.applicationContext, "notification")
        else Gym.ack(c.applicationContext, i.getStringExtra("day") ?: return, "notification")
    }
}

/** The full screen card while it rings: over the lock screen, the screen turned on, a big Acknowledge and Later. */
class GymRingActivity : ComponentActivity() {
    companion object {
        private val open = HashSet<GymRingActivity>()
        fun closeAll() { open.toList().forEach { it.finish() } }
    }
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        setShowWhenLocked(true); setTurnScreenOn(true)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        open.add(this)
        val d = resources.displayMetrics.density
        fun dp(v: Int) = (v * d).toInt()
        val at = Gym.ringAt(this)
        val time = java.time.Instant.ofEpochMilli(at).atZone(java.time.ZoneId.systemDefault()).toLocalTime().toString().take(5)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#0B0C0E")); setPadding(dp(28), dp(40), dp(28), dp(40))
        }
        val orb = TextView(this).apply {
            text = "GYM"; textSize = 22f; typeface = Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER; letterSpacing = .2f
            setTextColor(Color.parseColor("#0B0C0E"))
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; colors = intArrayOf(Color.parseColor("#FFE08A"), Color.parseColor("#F5C542"), Color.parseColor("#C9971C")) }
            layoutParams = LinearLayout.LayoutParams(dp(132), dp(132))
        }
        val big = TextView(this).apply {
            text = time; textSize = 64f; typeface = Typeface.create(Typeface.DEFAULT, 900, false); gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#F4F6F2")); setPadding(0, dp(28), 0, 0)
        }
        val sub = TextView(this).apply {
            text = GymClock.title(at, System.currentTimeMillis()); textSize = 20f; gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#FFE7A3")); setPadding(0, dp(4), 0, dp(40))
        }
        val ack = Button(this).apply {
            text = "Acknowledge"; isAllCaps = false; textSize = 22f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.parseColor("#0B0C0E"))
            stateListAnimator = null
            background = GradientDrawable().apply { setColor(Color.parseColor("#F5C542")); cornerRadius = 99 * d }
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(76))
            setOnClickListener {
                performHapticFeedback(android.view.HapticFeedbackConstants.CONFIRM)
                Gym.ack(applicationContext, Gym.ringDay(applicationContext) ?: java.time.LocalDate.now().toString(), "ring")
                finish()
            }
        }
        val later = Button(this).apply {
            text = "Later"; isAllCaps = false; textSize = 19f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.parseColor("#FFE7A3"))
            stateListAnimator = null
            background = GradientDrawable().apply { setColor(Color.TRANSPARENT); setStroke(dp(2), Color.parseColor("#F5C542")); cornerRadius = 99 * d }
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(60)).apply { topMargin = dp(14) }
            setOnClickListener {
                performHapticFeedback(android.view.HapticFeedbackConstants.CONFIRM)
                Gym.later(applicationContext, "ring")
                finish()
            }
        }
        val hint = TextView(this).apply {
            text = "Acknowledge stops it here and on your Mac. Later rings again in 5 minutes."; textSize = 14f; gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#9EF4F6F2")); setPadding(0, dp(14), 0, 0)
        }
        listOf(orb, big, sub, ack, later, hint).forEach(root::addView)
        setContentView(root)
        // Back leaves the card; the ring goes on until Acknowledge, Later or its 10 minutes (the notification has both buttons).
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) { override fun handleOnBackPressed() { finish() } })
        orb.scaleX = .6f; orb.scaleY = .6f; orb.alpha = 0f
        orb.animate().scaleX(1f).scaleY(1f).alpha(1f).setDuration(520).setInterpolator(OvershootInterpolator(1.6f)).start()
        breathe(orb)
    }
    private fun breathe(v: android.view.View) {
        v.animate().scaleX(1.06f).scaleY(1.06f).setStartDelay(600).setDuration(700).withEndAction {
            v.animate().scaleX(1f).scaleY(1f).setStartDelay(0).setDuration(700).withEndAction { if (!isFinishing) breathe(v) }.start()
        }.start()
    }
    override fun onResume() { super.onResume(); if (!Gym.ringing(this)) finish() }
    override fun onDestroy() { open.remove(this); super.onDestroy() }
}

