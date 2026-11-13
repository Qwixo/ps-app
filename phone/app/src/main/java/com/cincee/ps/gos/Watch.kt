package com.cincee.ps.gos

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationManager
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.animation.OvershootInterpolator
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import kotlin.math.abs

/** The quiet notification: a silent PS line in the shade that opens the list (or Add task). */
object Quiet {
    const val ID = 11
    // Set from the bridge thread, read on the main thread.
    @Volatile private var count = -1
    @Volatile private var top = ""
    @Volatile private var working = ""
    @Volatile private var locked = true

    fun tasks(c: Context, m: JSONObject) {
        count = m.optInt("count", -1); top = m.optString("top"); working = m.optString("working"); locked = false
        refresh(c)
    }
    fun locked(c: Context) { locked = true; refresh(c) }

    fun build(c: Context): Notification {
        val title = when { locked -> "PS app"; working.isNotEmpty() -> "Working on: $working"; else -> "PS app" }
        val text = when { locked -> "Tap to open your list"; count == 0 -> "Nothing on your list"; count > 0 -> "$count open${if (top.isNotEmpty() && working.isEmpty()) " · next: $top" else ""}"; else -> "Tap to open your list" }
        return Notification.Builder(c, Notifier.QUIET)
            .setSmallIcon(R.drawable.ic_stat_ps).setColor(Color.parseColor("#EC4E86"))
            .setContentTitle(title).setContentText(text)
            .setOngoing(true).setShowWhen(false).setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setPublicVersion(Notification.Builder(c, Notifier.QUIET).setSmallIcon(R.drawable.ic_stat_ps).setContentTitle("PS app").build())
            .setContentIntent(Notifier.openIntent(c, "list", 1))
            .addAction(Notification.Action.Builder(null, "Add task", Notifier.openIntent(c, "add", 2)).build())
            .build()
    }

    fun sync(c: Context) = refresh(c)
    private fun refresh(c: Context) {
        val nm = c.getSystemService(NotificationManager::class.java)
        if (Nuke.done(c)) { nm.cancel(ID); return }
        if (WatchService.running) { nm.notify(ID, build(c)); return }   // the watcher's own notification is this line
        if (Prefs.notification(c) && c.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == android.content.pm.PackageManager.PERMISSION_GRANTED) nm.notify(ID, build(c))
        else nm.cancel(ID)
    }
}

/** "Are you sure" state: the 30 minute pass and whether a call is on (from the page). */
object Ays {
    @Volatile var inMeeting = false
    @Volatile var passUntil = 0L
    @Volatile var showing = false
    /** Reads the sealed schedule the first time (Alarms), so never on the main thread. */
    fun quiet(c: Context) = inMeeting || System.currentTimeMillis() < passUntil || Alarms.inMeeting(c)
}

/**
 * Runs only while the floating bubble or "Are you sure" is on. Once a second, and only while the
 * screen is on, it reads which app came to the front (UsageStatsManager). Signal and 1Password are
 * dropped at that first read: with either in front the bubble hides and nothing else happens; their
 * names are never kept, logged or sent.
 */
class WatchService : Service() {
    companion object {
        @Volatile var running = false
        @Volatile private var self: WatchService? = null
        /** PS itself came to the front: the bubble goes at once, not on the next one second tick. */
        fun ownFront() { self?.let { s -> s.h.post { s.front = s.packageName; s.hideBubble() } } }
        fun sync(c: Context) {
            val want = !Nuke.done(c) && ((Prefs.bubble(c) && Settings.canDrawOverlays(c)) || (Prefs.ays(c) && Prefs.hasUsage(c) && Settings.canDrawOverlays(c)))
            val i = Intent(c, WatchService::class.java)
            if (want && !running) runCatching { c.startForegroundService(i) }
            else if (!want && running) c.stopService(i)
        }
    }

    private val h = Handler(Looper.getMainLooper())
    private var front: String? = null
    @Volatile private var since = 0L
    private var bubble: View? = null
    private var screenOn = true
    private val screen = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) { screenOn = i.action == Intent.ACTION_SCREEN_ON; if (screenOn) tick() }
    }

    override fun onBind(i: Intent?): IBinder? = null
    override fun onCreate() {
        super.onCreate()
        running = true
        self = this
        startForeground(Quiet.ID, Quiet.build(this), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        registerReceiver(screen, IntentFilter().apply { addAction(Intent.ACTION_SCREEN_ON); addAction(Intent.ACTION_SCREEN_OFF) })
        screenOn = getSystemService(PowerManager::class.java).isInteractive
        since = System.currentTimeMillis() - 10_000
        tick()
    }
    override fun onStartCommand(i: Intent?, f: Int, id: Int): Int { return START_STICKY }
    override fun onDestroy() {
        running = false
        self = null
        h.removeCallbacksAndMessages(null)
        runCatching { unregisterReceiver(screen) }
        hideBubble()
        Quiet.sync(this)
        super.onDestroy()
    }

    // The read is a call into the system, so it runs on the work thread and only its answer comes back
    // here: this service shares PS's main thread, where a slow read held up every tap (1 Nov 2026).
    private var reading = false
    private val next = Runnable { tick() }
    private fun tick() {
        h.removeCallbacks(next)
        if (!screenOn) { hideBubble(); return }
        if (reading) return
        reading = true
        Work.post {
            val latest = runCatching { frontApp() }.getOrNull()
            // "Is a call on" reads the sealed schedule (Keystore): here on the work thread, only for a watched app.
            val quiet = latest != null && Prefs.ays(this) && latest in Prefs.aysApps(this) && runCatching { Ays.quiet(this) }.getOrDefault(true)
            h.post {
                reading = false
                if (self !== this) return@post
                if (latest != null) changed(latest, quiet)
                if (screenOn) h.postDelayed(next, 1000)
            }
        }
    }

    /** The app that came to the front since the last read, if any (work thread only). */
    private fun frontApp(): String? {
        val now = System.currentTimeMillis()
        val ev = getSystemService(UsageStatsManager::class.java).queryEvents(since, now)
        val e = UsageEvents.Event()
        var latest: String? = null
        while (ev.hasNextEvent()) {
            ev.getNextEvent(e)
            if (e.eventType == UsageEvents.Event.ACTIVITY_RESUMED) latest = e.packageName
        }
        since = now - 1500
        return latest
    }

    private fun changed(pkg: String, quiet: Boolean) {
        // GOLDEN RULE: Signal or 1Password in front: hide, read nothing more, keep nothing.
        if (Protected.isProtected(pkg)) { front = "protected"; hideBubble(); return }
        if (pkg == front) return
        front = pkg
        val mine = pkg == packageName
        if (Prefs.bubble(this) && !mine && Settings.canDrawOverlays(this)) showBubble() else hideBubble()
        if (Prefs.ays(this) && pkg in Prefs.aysApps(this) && !Ays.showing && !quiet) {
            Ays.showing = true
            runCatching { startActivity(Intent(this, AysActivity::class.java).putExtra("pkg", pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        }
    }

    // ---------- the bubble ----------
    @SuppressLint("ClickableViewAccessibility")
    private fun showBubble() {
        if (bubble != null) return
        val wm = getSystemService(WindowManager::class.java)
        val d = resources.displayMetrics.density
        val size = (54 * d).toInt()
        val v = TextView(this).apply {
            text = "PS"; setTextColor(Color.WHITE); textSize = 15f; gravity = Gravity.CENTER
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(Color.parseColor("#EC4E86"), Color.parseColor("#C8366B"))).apply { shape = GradientDrawable.OVAL }
            elevation = 10 * d
            alpha = 0f; scaleX = 0.4f; scaleY = 0.4f
        }
        val sp = getSharedPreferences("bubble", MODE_PRIVATE)
        val lp = WindowManager.LayoutParams(size, size, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS, PixelFormat.TRANSLUCENT).apply {
            gravity = Gravity.TOP or Gravity.START
            x = sp.getInt("x", resources.displayMetrics.widthPixels - size - (8 * d).toInt()); y = sp.getInt("y", (resources.displayMetrics.heightPixels * 0.55).toInt())
        }
        var sx = 0f; var sy = 0f; var ox = 0; var oy = 0; var moved = false
        v.setOnTouchListener { _, m ->
            when (m.action) {
                MotionEvent.ACTION_DOWN -> { sx = m.rawX; sy = m.rawY; ox = lp.x; oy = lp.y; moved = false; v.animate().scaleX(0.9f).scaleY(0.9f).setDuration(120).start() }
                MotionEvent.ACTION_MOVE -> {
                    if (abs(m.rawX - sx) + abs(m.rawY - sy) > 12 * d) moved = true
                    if (moved) { lp.x = ox + (m.rawX - sx).toInt(); lp.y = oy + (m.rawY - sy).toInt(); runCatching { wm.updateViewLayout(v, lp) } }
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    v.animate().scaleX(1f).scaleY(1f).setInterpolator(OvershootInterpolator(2.5f)).setDuration(260).start()
                    if (!moved) {
                        v.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
                        startActivity(Intent(this, MainActivity::class.java).putExtra("open", "list").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))
                    } else {
                        // Snap to the nearest side, smoothly.
                        val w = resources.displayMetrics.widthPixels
                        val target = if (lp.x + size / 2 < w / 2) (8 * d).toInt() else w - size - (8 * d).toInt()
                        val from = lp.x
                        android.animation.ValueAnimator.ofInt(from, target).apply {
                            duration = 320; interpolator = OvershootInterpolator(1.2f)
                            addUpdateListener { lp.x = it.animatedValue as Int; runCatching { wm.updateViewLayout(v, lp) } }
                            start()
                        }
                        sp.edit().putInt("x", target).putInt("y", lp.y).apply()
                    }
                }
            }
            true
        }
        runCatching { wm.addView(v, lp); bubble = v; v.animate().alpha(1f).scaleX(1f).scaleY(1f).setInterpolator(OvershootInterpolator(2f)).setDuration(300).start() }.onFailure { Plog.i("bubble: ${it.javaClass.simpleName}") }
    }

    fun hideBubble() {
        val v = bubble ?: return
        bubble = null
        v.animate().alpha(0f).scaleX(0.5f).scaleY(0.5f).setDuration(160).withEndAction { runCatching { getSystemService(WindowManager::class.java).removeView(v) } }.start()
    }
}

/**
 * Screen time from the phone's usage events (UsageCount.kt): today's minutes per app from local
 * midnight, and the last 24 hours as a line (which app was in front, when, and the screen off
 * breaks) for the same timeline the Mac shows. Signal and 1Password are dropped at the first read.
 */
object ScreenTime {
    private const val DAY_MS = 24 * 3600_000L
    private const val LOOK_BACK_MS = 3 * 3600_000L   // events before the window, to know what was already open

    fun today(c: Context): JSONObject? {
        if (!Prefs.screenTime(c) || !Prefs.hasUsage(c)) return null   // Settings, "Track my screen time" Off: no usage read at all
        val now = System.currentTimeMillis()
        val cal = Calendar.getInstance().apply { timeInMillis = now; set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }
        val midnight = cal.timeInMillis
        val lineFrom = now - DAY_MS
        val from = minOf(midnight, lineFrom)
        val evs = ArrayList<UsageCount.Ev>()
        val q = c.getSystemService(UsageStatsManager::class.java).queryEvents(from - LOOK_BACK_MS, now) ?: return null
        val e = UsageEvents.Event()
        while (q.hasNextEvent()) {
            q.getNextEvent(e)
            val pkg = e.packageName ?: ""
            if (Protected.isProtected(pkg)) continue                 // golden rule, before anything else
            if (e.eventType in UsageCount.WANTED) evs.add(UsageCount.Ev(pkg, e.className, e.eventType, e.timeStamp))
        }
        val pm = c.packageManager
        val launchable = HashMap<String, Boolean>()
        val labels = HashMap<String, String>()
        fun label(p: String) = labels.getOrPut(p) { runCatching { pm.getApplicationLabel(pm.getApplicationInfo(p, 0)).toString() }.getOrDefault(p) }
        // An app the developer opens has a launcher entry; the home screen and system UI do not. A label that
        // reads Signal or 1Password (a renamed copy) is dropped too.
        val counts = { p: String -> launchable.getOrPut(p) { pm.getLaunchIntentForPackage(p) != null && !Protected.isProtected(label(p)) } }
        val line = UsageCount.line(evs, from, now, counts, Protected::isProtected)

        val apps = JSONArray()
        UsageCount.totals(line.segs, midnight, now).entries
            .filter { it.value >= 10_000 }
            .sortedByDescending { it.value }
            .take(80)
            .forEach { (p, ms) -> apps.put(JSONObject().put("id", p).put("name", label(p)).put("secs", ms / 1000)) }

        val ids = ArrayList<String>(); val at = HashMap<String, Int>()
        val segs = JSONArray()
        for (g in line.segs) {
            if (g.e <= lineFrom) continue
            val i = at.getOrPut(g.pkg) { ids.add(g.pkg); ids.size - 1 }
            segs.put(JSONArray().put(i).put(maxOf(g.s, lineFrom)).put(g.e))
        }
        val away = JSONArray()
        for ((s, en) in line.away) if (en > lineFrom) away.put(JSONArray().put(maxOf(s, lineFrom)).put(en))
        val tl = JSONObject().put("now", now).put("from", lineFrom).put("segs", segs).put("away", away)
            .put("apps", JSONArray().apply { ids.forEach { put(JSONObject().put("id", it).put("name", label(it))) } })
        val day = String.format("%04d-%02d-%02d", cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH))
        return JSONObject().put("type", "screentime").put("day", day).put("apps", apps).put("exact", true).put("tl", tl)
    }
}
