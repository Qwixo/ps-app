package com.cincee.ps.gos

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.WindowManager
import android.view.animation.OvershootInterpolator
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback

/**
 * The Annoying 15 min reminder's ring on the phone (1.60, Remind.kt decides when). Like the gym ring: a foreground
 * service plays the reminder's own sound loudly (on the alarm volume, looping) and buzzes for a minute, and a full
 * screen card with the reminder's own words and buttons comes up over the lock screen. The notification stays after
 * the minute, and the reminder rings again every snooze length until it is answered.
 * A reminder set to "No sound" only buzzes. Nothing about the reminder leaves the phone.
 */
class RemRingService : Service() {
    private val h = Handler(Looper.getMainLooper())
    private var player: MediaPlayer? = null
    private val end = Runnable { Remind.ringCheck(this) }

    override fun onBind(i: Intent?): IBinder? = null
    override fun onStartCommand(i: Intent?, flags: Int, id: Int): Int {
        // startForegroundService() promises a startForeground() within seconds: always make it, even when the ring was
        // answered a moment before this ran (then stop at once), or Android kills the app for not doing so.
        startForeground(Remind.RING_ID, Remind.ringNotice(this), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        val r = Remind.ringItem(this)
        if (r == null) { stopSelf(); return START_NOT_STICKY }
        if (player == null) play(r)
        h.removeCallbacks(end); h.postDelayed(end, RemClock.RING_FOR + 500)
        return START_NOT_STICKY
    }
    private fun play(r: RemItem) {
        val file = Remind.soundFile(this, r)
        if (file != null) {
            val attrs = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
            player = runCatching {
                MediaPlayer().apply { setAudioAttributes(attrs); setDataSource(file.path); isLooping = true; prepare(); setVolume(r.vol.toFloat(), r.vol.toFloat()); start() }
            }.getOrNull()
            if (player == null) Plog.i("rem: no ring sound, buzz only")
        }
        Gym.Buzz.loop(this)
    }
    override fun onDestroy() {
        h.removeCallbacks(end)
        runCatching { player?.stop(); player?.release() }
        player = null
        Gym.Buzz.stop(this)
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }
}

/** The full screen card while a reminder rings: its pill, its words, its confirm button (typing the word first unless it is one tap) and its snooze. */
class RemRingActivity : ComponentActivity() {
    companion object {
        private val open = HashSet<RemRingActivity>()
        fun closeAll() { open.toList().forEach { it.finish() } }
    }
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        val r = Remind.ringItem(this)
        if (r == null) { finish(); return }
        setShowWhenLocked(true); setTurnScreenOn(true)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        open.add(this)
        val d = resources.displayMetrics.density
        fun dp(v: Int) = (v * d).toInt()
        fun col(hex: String, def: String) = runCatching { Color.parseColor(hex) }.getOrDefault(Color.parseColor(def))
        val bg = col(r.bg, RemClock.BG)
        val accent = col(r.accent, RemClock.ACCENT)
        val look = RemInk.alarm(r.bg, r.accent, r.ink)
        val ink = col(look.ink, "#FFFFFF"); val soft = col(look.sub, "#FFFFFF"); val onAcc = col(look.on, "#000000"); val hintInk = col(look.hint, "#FFFFFF")
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
            setBackgroundColor(bg); setPadding(dp(28), dp(40), dp(28), dp(40))
        }
        val pill = TextView(this).apply {
            text = r.pill.uppercase(); textSize = 16f; typeface = Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER; letterSpacing = .2f; maxLines = 2
            setTextColor(onAcc); setPadding(dp(18), dp(10), dp(18), dp(10))
            background = GradientDrawable().apply { setColor(accent); cornerRadius = 99 * d }
        }
        val words = TextView(this).apply {
            text = r.text; textSize = 28f; typeface = Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER
            setTextColor(ink); setPadding(0, dp(30), 0, dp(26))
        }
        val field = EditText(this).apply {
            hint = "Type ${r.word}"; textSize = 20f; gravity = Gravity.CENTER; setTextColor(ink); setHintTextColor(hintInk)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS; imeOptions = EditorInfo.IME_ACTION_DONE; setSingleLine()
            background = GradientDrawable().apply { setColor(Color.TRANSPARENT); setStroke(dp(2), accent); cornerRadius = 18 * d }
            setPadding(dp(14), dp(14), dp(14), dp(14))
            visibility = if (r.click) android.view.View.GONE else android.view.View.VISIBLE
        }
        val note = TextView(this).apply { textSize = 15f; gravity = Gravity.CENTER; setTextColor(hintInk); setPadding(0, dp(8), 0, dp(10)); visibility = android.view.View.GONE }
        fun confirm() {
            val typed = field.text?.toString()
            if (!RemClock.confirms(r, typed)) { note.text = "Only ${r.word} clears this"; note.visibility = android.view.View.VISIBLE; return }
            window.decorView.performHapticFeedback(android.view.HapticFeedbackConstants.CONFIRM)
            Remind.answer(applicationContext, r.id, if (r.click) "done" else "reply", typed)
            finish()
        }
        val yes = Button(this).apply {
            text = r.yes; isAllCaps = false; textSize = 22f; typeface = Typeface.DEFAULT_BOLD; setTextColor(onAcc)
            stateListAnimator = null
            background = GradientDrawable().apply { setColor(accent); cornerRadius = 99 * d }
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(76))
            setOnClickListener { confirm() }
        }
        field.setOnEditorActionListener { _, _, _ -> confirm(); true }
        val later = Button(this).apply {
            text = r.later; isAllCaps = false; textSize = 19f; typeface = Typeface.DEFAULT_BOLD; setTextColor(soft)
            stateListAnimator = null
            background = GradientDrawable().apply { setColor(Color.TRANSPARENT); setStroke(dp(2), accent); cornerRadius = 99 * d }
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(60)).apply { topMargin = dp(14) }
            setOnClickListener {
                performHapticFeedback(android.view.HapticFeedbackConstants.CONFIRM)
                Remind.answer(applicationContext, r.id, "snooze", null)
                finish()
            }
        }
        val hint = TextView(this).apply {
            text = "${r.yes} stops it here and on your other devices."; textSize = 14f; gravity = Gravity.CENTER
            setTextColor(hintInk); setPadding(0, dp(14), 0, 0)
        }
        listOf(pill, words, field, note, yes, later, hint).forEach(root::addView)
        (field.layoutParams as LinearLayout.LayoutParams).apply { width = LinearLayout.LayoutParams.MATCH_PARENT; bottomMargin = dp(6) }
        setContentView(root)
        // Back leaves the card; the notification keeps both buttons and it rings again in its own time.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) { override fun handleOnBackPressed() { finish() } })
        pill.scaleX = .6f; pill.scaleY = .6f; pill.alpha = 0f
        pill.animate().scaleX(1f).scaleY(1f).alpha(1f).setDuration(520).setInterpolator(OvershootInterpolator(1.6f)).start()
    }
    override fun onResume() { super.onResume(); if (!Remind.ringing(this)) finish() }
    override fun onDestroy() { open.remove(this); super.onDestroy() }
}
