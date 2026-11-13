package com.cincee.ps.gos

import android.animation.ValueAnimator
import android.app.Activity
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.animation.DecelerateInterpolator
import android.view.animation.LinearInterpolator
import android.view.animation.OvershootInterpolator
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.ComponentActivity

/**
 * "Are you sure" over YouTube or Netflix, as on the Mac: wait 10 seconds and Continue (a 30 minute
 * pass), or type "I am sure, I swear on PS" to go straight in. "Not now" goes home. Never shown
 * during a call or meeting (checked before it opens).
 */
class AysActivity : ComponentActivity() {
    private val phrase = "I am sure, I swear on PS"
    private val waitMs = 10_000L

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        val d = resources.displayMetrics.density
        fun dp(v: Int) = (v * d).toInt()
        val app = intent.getStringExtra("pkg").let { if (it == "com.netflix.mediaclient") "Netflix" else "YouTube" }

        val root = FrameLayout(this).apply { setBackgroundColor(Color.argb(0, 8, 4, 7)) }
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(26), dp(30), dp(26), dp(24))
            background = GradientDrawable().apply { setColor(Color.parseColor("#1A0F15")); cornerRadius = 30 * d; setStroke(dp(1), Color.parseColor("#55EC4E86")) }
            elevation = 24 * d
            alpha = 0f; scaleX = 0.92f; scaleY = 0.92f; translationY = 40 * d
        }
        val ring = Ring(this).apply { layoutParams = LinearLayout.LayoutParams(dp(92), dp(92)) }
        val title = TextView(this).apply {
            text = "Open $app?"; setTextColor(Color.WHITE); textSize = 26f; typeface = Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER
            setPadding(0, dp(18), 0, dp(6))
        }
        val sub = TextView(this).apply {
            text = "Take ten seconds. Is this what you want to do right now?"; setTextColor(Color.parseColor("#B3FFFFFF")); textSize = 15f; gravity = Gravity.CENTER
            setLineSpacing(0f, 1.15f)
        }
        val input = EditText(this).apply {
            hint = phrase; setHintTextColor(Color.parseColor("#55FFFFFF")); setTextColor(Color.WHITE); textSize = 15f
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            background = GradientDrawable().apply { setColor(Color.parseColor("#14FFFFFF")); cornerRadius = 14 * d }
            setPadding(dp(14), dp(12), dp(14), dp(12))
        }
        fun pill(label: String, primary: Boolean) = Button(this).apply {
            text = label; isAllCaps = false; textSize = 15f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE)
            stateListAnimator = null
            background = GradientDrawable().apply {
                if (primary) { colors = intArrayOf(Color.parseColor("#EC4E86"), Color.parseColor("#C8366B")); orientation = GradientDrawable.Orientation.TL_BR }
                else setColor(Color.parseColor("#1FFFFFFF"))
                cornerRadius = 99 * d
            }
            setPadding(dp(18), 0, dp(18), 0)
        }
        val home = pill("Not now", true)
        val cont = pill("Continue in 10", false).apply { isEnabled = false; alpha = 0.45f }
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER
            addView(home, LinearLayout.LayoutParams(0, dp(52), 1f).apply { marginEnd = dp(10) })
            addView(cont, LinearLayout.LayoutParams(0, dp(52), 1f))
        }
        card.addView(ring); card.addView(title); card.addView(sub)
        card.addView(input, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = dp(20) })
        card.addView(row, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = dp(16) })
        root.addView(card, FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT, Gravity.CENTER).apply { marginStart = dp(18); marginEnd = dp(18) })
        setContentView(root)

        // In: the dim fades up, the card rises and settles.
        ValueAnimator.ofInt(0, 215).apply { duration = 320; addUpdateListener { root.setBackgroundColor(Color.argb(it.animatedValue as Int, 8, 4, 7)) }; start() }
        card.animate().alpha(1f).scaleX(1f).scaleY(1f).translationY(0f).setInterpolator(OvershootInterpolator(0.9f)).setDuration(460).start()
        root.performHapticFeedback(HapticFeedbackConstants.REJECT)

        val start = System.currentTimeMillis()
        ValueAnimator.ofFloat(0f, 1f).apply {
            duration = waitMs; interpolator = LinearInterpolator()
            addUpdateListener {
                ring.p = it.animatedFraction; ring.invalidate()
                val left = ((waitMs - (System.currentTimeMillis() - start)) / 1000 + 1).coerceAtLeast(0)
                if (it.animatedFraction < 1f) cont.text = "Continue in $left"
            }
            doOnEnd {
                cont.text = "Continue"; cont.isEnabled = true
                cont.animate().alpha(1f).setDuration(220).start()
                cont.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
            }
            start()
        }
        cont.setOnClickListener { pass() }
        home.setOnClickListener { goHome() }
        input.addTextChangedListener(object : TextWatcher {
            override fun afterTextChanged(s: Editable?) { if (s.toString().trim().equals(phrase, ignoreCase = true)) pass() }
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        })
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) { override fun handleOnBackPressed() = goHome() })
    }

    private fun pass() { Ays.passUntil = System.currentTimeMillis() + 30 * 60_000; finishSoft() }
    private fun goHome() {
        startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        finishSoft()
    }
    private fun finishSoft() {
        val card = (findViewById<View>(android.R.id.content) as FrameLayout).getChildAt(0).let { (it as FrameLayout).getChildAt(0) }
        card.animate().alpha(0f).scaleX(0.95f).scaleY(0.95f).setInterpolator(DecelerateInterpolator()).setDuration(180).withEndAction { finish() }.start()
    }
    override fun onDestroy() { Ays.showing = false; super.onDestroy() }
    override fun finish() { super.finish(); overrideActivityTransition(Activity.OVERRIDE_TRANSITION_CLOSE, 0, android.R.anim.fade_out) }

    /** The countdown ring. */
    private class Ring(c: android.content.Context) : View(c) {
        var p = 0f
        private val d = c.resources.displayMetrics.density
        private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 7 * d; color = Color.parseColor("#22FFFFFF") }
        private val arc = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 7 * d; strokeCap = Paint.Cap.ROUND; color = Color.parseColor("#EC4E86") }
        private val txt = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; textAlign = Paint.Align.CENTER; textSize = 28 * d; typeface = Typeface.DEFAULT_BOLD }
        override fun onDraw(cv: Canvas) {
            val r = RectF(6 * d, 6 * d, width - 6 * d, height - 6 * d)
            cv.drawOval(r, track)
            cv.drawArc(r, -90f, 360f * p, false, arc)
            val n = (10 - (p * 10).toInt()).coerceAtLeast(0)
            cv.drawText(if (p >= 1f) "OK" else "$n", width / 2f, height / 2f - (txt.descent() + txt.ascent()) / 2, txt)
        }
    }
}

private fun ValueAnimator.doOnEnd(f: () -> Unit) = addListener(object : android.animation.AnimatorListenerAdapter() {
    override fun onAnimationEnd(a: android.animation.Animator) = f()
})
