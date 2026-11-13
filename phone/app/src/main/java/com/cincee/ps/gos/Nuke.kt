package com.cincee.ps.gos

import android.app.Activity
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.work.WorkManager

/**
 * The rule book's nuke (the developer, 28 Oct 2026, "Ride or DIE"). A rule marked Failed in the end of day rule
 * check (web views/RuleBook.tsx) removes PS from the phone at once: the phone's saved sign in,
 * its background copy and the fingerprint key go, the page locks, then the system uninstall of PS starts.
 * GrapheneOS shows its own confirm for that. "No way back": once nuked, this install stays nuked, so
 * Cancel on that confirm leaves only the Gone screen (every way into PS lands there and asks again), and
 * nothing runs in the background. A fresh install from Drive starts clean (uninstalling clears the flag).
 * The vault on the server is never touched: the developer comes back by installing PS again and signing in with his
 * passphrase. One plain log line, never the rule's words.
 */
object Nuke {
    const val LINE = "PS nuke: a rule was failed, PS removed itself"
    private const val FLAG = "nuked"

    fun done(c: Context) = c.getSharedPreferences("ps", Context.MODE_PRIVATE).getBoolean(FLAG, false)

    /** Off the main thread (the bridge thread): the flag is written to disk and the keys leave the Keystore.
     *  The caller then shows the Gone screen on the main thread ([gone]). */
    fun run(c: Context) {
        Plog.i(LINE)
        c.getSharedPreferences("ps", Context.MODE_PRIVATE).edit().putBoolean(FLAG, true).commit()
        Remember.forget(c)              // sign in file, background copy and the fingerprint key
        Session.save(c, null, 0)        // the page's access token too
        Quiet.locked(c)
        stop(c)
    }

    /** Nothing of PS keeps running: the quiet notification, the watcher and the background checks. */
    fun stop(c: Context) {
        runCatching { c.stopService(Intent(c, WatchService::class.java)) }
        runCatching { WorkManager.getInstance(c).cancelAllWork() }
        c.getSystemService(NotificationManager::class.java).cancelAll()
    }

    /** Swaps the screen for the Gone screen, which starts the uninstall. */
    fun gone(c: Context, a: Activity?) {
        val i = Intent(c, GoneActivity::class.java)
        if (a == null) i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { (a ?: c).startActivity(i) }
        a?.finish()
    }

    fun uninstall(a: Activity) {
        runCatching { a.startActivity(Intent(Intent.ACTION_DELETE, Uri.parse("package:" + a.packageName))) }
            .onFailure { Plog.i("PS nuke: could not start the uninstall") }
    }
}

/** All that is left of a nuked PS: one line, one button, and the uninstall asked again each time it opens. */
class GoneActivity : Activity() {
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        val dp = resources.displayMetrics.density
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#050505"))
            setPadding((32 * dp).toInt(), 0, (32 * dp).toInt(), 0)
        }
        col.addView(TextView(this).apply {
            text = "A rule was failed. PS app is gone."
            setTextColor(Color.parseColor("#E6E6E6")); setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f); gravity = Gravity.CENTER
        })
        col.addView(Button(this).apply {
            text = "Remove PS app"; isAllCaps = false
            setTextColor(Color.parseColor("#0A0A0A")); setBackgroundColor(Color.parseColor("#D9D9D9"))
            setOnClickListener { Nuke.uninstall(this@GoneActivity) }
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = (28 * dp).toInt() })
        setContentView(col)
    }
    // Every time PS is opened (Cancel on the confirm only pauses this screen, so it does not loop).
    override fun onStart() { super.onStart(); Nuke.stop(this); Nuke.uninstall(this) }
}
