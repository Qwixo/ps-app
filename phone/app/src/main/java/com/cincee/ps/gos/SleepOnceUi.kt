package com.cincee.ps.gos

import android.animation.ValueAnimator
import android.app.TimePickerDialog
import android.content.Context
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.text.format.DateFormat
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * V1.65 "Just tomorrow" on the Sleep clock: one calm thin line under the alarm line, and a tap opens a compact row of thin
 * pills (Skip, the page's later choices, Pick a time, Undo). Every word comes from the page. A choice is handed to
 * `onChoose(json, reason)`, which runs the owner check and sends it. Opens and closes with a short spring and a tiny squeeze
 * (none when the system's animations are off), closes on a tap outside, on Back and after 20 seconds of nothing.
 */
class SleepOnceUi(private val a: SleepActivity, private val onChoose: (json: String, reason: String) -> Unit, private val onTouch: () -> Unit) {
    private val d = a.resources.displayMetrics.density
    private fun dp(v: Int) = (v * d).toInt()
    private val h = Handler(Looper.getMainLooper())
    private val idle = Runnable { close() }
    private var once: SleepOnce? = null
    private var shown = ""
    private var pickOpen = false
    var isOpen = false; private set

    val line = TextView(a).apply {
        textSize = 13f; gravity = Gravity.CENTER; typeface = Typeface.create("sans-serif-light", Typeface.NORMAL)
        setPadding(dp(18), dp(8), dp(18), dp(8)); visibility = View.GONE
        setOnClickListener { if (isOpen) close() else open() }
    }
    val row = OnceFlow(a).apply { visibility = View.GONE; setPadding(dp(20), dp(2), dp(20), dp(2)) }

    private fun calm() = runCatching { android.provider.Settings.Global.getFloat(a.contentResolver, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }.getOrDefault(false)

    /** Called from SleepActivity.draw. `show` is false while ringing or for an alarm without Sleep mode. */
    fun bind(o: SleepOnce?, show: Boolean, ink: (Float) -> Int, b: Float) {
        if (o == null || !show) { once = null; shown = ""; line.visibility = View.GONE; row.visibility = View.GONE; isOpen = false; h.removeCallbacks(idle); return }
        line.visibility = View.VISIBLE
        line.setTextColor(ink(b * .38f))
        line.contentDescription = if (o.words.title.isEmpty()) o.line else "${o.words.title}: ${o.line}"
        if (o.line != shown) {
            val first = shown.isEmpty()
            shown = o.line
            if (first || calm()) { line.animate().cancel(); line.alpha = 1f; line.text = o.line }
            else line.animate().alpha(0f).setDuration(140).withEndAction { line.text = shown; line.animate().alpha(1f).setDuration(240).start() }.start()
        }
        if (o != once) { once = o; rebuild(o) }
        val dd = a.resources.displayMetrics.density
        for (i in 0 until row.childCount) (row.getChildAt(i) as Button).apply {
            setTextColor(ink(.9f)); background = GradientDrawable().apply { setColor(ink(.12f)); setStroke((1 * dd).toInt(), ink(.3f)); cornerRadius = 99 * dd }
        }
    }

    private fun pill(text: String, go: () -> Unit) = Button(a).apply {
        isAllCaps = false; textSize = 13f; typeface = Typeface.DEFAULT_BOLD; stateListAnimator = null; minHeight = 0; minimumHeight = 0
        setPadding(dp(14), dp(6), dp(14), dp(6)); this.text = text
        setOnClickListener { touch(); go() }
    }

    private fun rebuild(o: SleepOnce) {
        row.removeAllViews()
        val w = o.words
        if (w.skip.isNotEmpty()) row.addView(pill(w.skip) { SleepOnceCore.skipJson().let { onChoose(it, w.reason) } })
        for (m in w.mins) SleepOnceCore.laterJson(m.mins)?.let { j -> row.addView(pill(m.label) { onChoose(j, w.reason) }) }
        if (w.pick.isNotEmpty()) row.addView(pill(w.pick) { pickTime(o) })
        if (o.set && w.undo.isNotEmpty()) row.addView(pill(w.undo) { onChoose(SleepOnceCore.undoJson(), w.undoReason.ifEmpty { w.reason }) })
    }

    /** The system time picker, starting at the usual time plus an hour, in the phone's own 12 or 24 hour setting. */
    private fun pickTime(o: SleepOnce) {
        val (hh, mm) = SleepOnceCore.pickStart(o.usual)
        pickOpen = true; h.removeCallbacks(idle)
        val dlg = TimePickerDialog(a, android.R.style.Theme_DeviceDefault_Dialog_Alert, { _, hour, min ->
            SleepOnceCore.pickJson(SleepOnceCore.hhmm(hour, min))?.let { onChoose(it, o.words.reason) }
        }, hh, mm, DateFormat.is24HourFormat(a))
        if (o.words.pick.isNotEmpty()) dlg.setTitle(o.words.pick)
        dlg.setOnDismissListener { pickOpen = false; if (isOpen) restartIdle() }
        dlg.show()
        if (o.words.save.isNotEmpty()) dlg.getButton(android.content.DialogInterface.BUTTON_POSITIVE)?.text = o.words.save
    }

    private fun restartIdle() { h.removeCallbacks(idle); if (isOpen && !pickOpen) h.postDelayed(idle, SleepOnceCore.IDLE_MS) }
    private fun touch() { onTouch(); restartIdle() }

    fun open() {
        if (isOpen || once == null || row.childCount == 0) return
        isOpen = true
        row.animate().cancel(); row.visibility = View.VISIBLE
        if (calm()) { row.alpha = 1f; row.scaleX = 1f; row.scaleY = 1f }
        else ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 360
            addUpdateListener { v ->
                val t = v.animatedValue as Float
                val s = .96f + .04f * IslandSpring.grow(t, false)   // the tiny squeeze first, then a short spring
                row.alpha = (t * 3f).coerceAtMost(1f); row.scaleX = s; row.scaleY = s
            }
            start()
        }
        touch()
    }

    fun close(animated: Boolean = true) {
        h.removeCallbacks(idle)
        if (!isOpen) return
        isOpen = false
        row.animate().cancel()
        if (!animated || calm()) { row.visibility = View.GONE; return }
        row.animate().alpha(0f).scaleX(.96f).scaleY(.96f).setDuration(160).withEndAction { if (!isOpen) row.visibility = View.GONE }.start()
    }
}

/** Pills laid out left to right, wrapping to a new centred row when the width runs out. */
class OnceFlow(c: Context) : ViewGroup(c) {
    private val gap = (6 * c.resources.displayMetrics.density).toInt()
    private fun rows(w: Int): List<List<View>> {
        val out = ArrayList<MutableList<View>>(); var used = 0
        for (i in 0 until childCount) {
            val v = getChildAt(i); if (v.visibility == View.GONE) continue
            if (out.isEmpty() || used + v.measuredWidth > w) { out.add(ArrayList()); used = 0 }
            out.last().add(v); used += v.measuredWidth + gap
        }
        return out
    }
    override fun onMeasure(wSpec: Int, hSpec: Int) {
        val w = MeasureSpec.getSize(wSpec)
        val inner = w - paddingLeft - paddingRight
        for (i in 0 until childCount) getChildAt(i).measure(MeasureSpec.makeMeasureSpec(inner, MeasureSpec.AT_MOST), MeasureSpec.UNSPECIFIED)
        val rs = rows(inner)
        val hh = rs.sumOf { r -> r.maxOf { it.measuredHeight } } + gap * maxOf(0, rs.size - 1) + paddingTop + paddingBottom
        setMeasuredDimension(w, hh)
        pivotX = w / 2f; pivotY = hh / 2f
    }
    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        val inner = r - l - paddingLeft - paddingRight
        var y = paddingTop
        for (row in rows(inner)) {
            val rw = row.sumOf { it.measuredWidth } + gap * (row.size - 1)
            var x = paddingLeft + (inner - rw) / 2
            val rh = row.maxOf { it.measuredHeight }
            for (v in row) { v.layout(x, y, x + v.measuredWidth, y + v.measuredHeight); x += v.measuredWidth + gap }
            y += rh + gap
        }
    }
}
