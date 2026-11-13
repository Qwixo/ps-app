package com.cincee.ps.gos

import android.app.Application
import android.util.Log
import androidx.work.Configuration

/** PS GOS. Starts the notification channels and the background checks; nothing else runs at launch. */
class GosApp : Application(), Configuration.Provider {
    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setMinimumLoggingLevel(Log.WARN).build()

    override fun onCreate() {
        super.onCreate()
        if (BuildConfig.DEBUG) { MainWatch.start(); strict() }
        Notifier.channels(this)
        if (Nuke.done(this)) { Nuke.stop(this); return }   // a failed rule: nothing runs (Nuke.kt)
        Pulse.schedule(this)
        // The sealed call schedule needs the Keystore: never on the main thread (2 Nov 2026 freeze).
        val app = this
        Work.post { Alarms.restore(app) }
        WatchService.sync(this)
        Quiet.sync(this)
    }

    /**
     * Debug builds only: StrictMode logs every disk read or write, network call and slow call on the main
     * thread (logcat tag StrictMode). The Keystore itself has a hard
     * guard: Keys.gate throws in debug builds when the main thread gets there (Bridge.kt KeyGate).
     */
    private fun strict() {
        android.os.StrictMode.setThreadPolicy(android.os.StrictMode.ThreadPolicy.Builder()
            .detectDiskReads().detectDiskWrites().detectNetwork().detectCustomSlowCalls().penaltyLog().build())
    }
}

/**
 * Debug builds only: every main thread message that takes 100 ms or more is logged with its handler
 * and callback class, so a stall like the 1 Nov 2026 "PS isn't responding" shows up on the emulator
 * long before it gets anywhere near Android's 5 second limit. Class names only, never data.
 */
object MainWatch {
    fun start() {
        var at = 0L
        android.os.Looper.getMainLooper().setMessageLogging { line ->
            if (line.startsWith(">")) at = android.os.SystemClock.uptimeMillis()
            else if (line.startsWith("<") && at > 0) {
                val ms = android.os.SystemClock.uptimeMillis() - at
                if (ms >= 100) Log.w("PSGOS", "main thread busy $ms ms: ${line.substringAfter("Finished to ").take(160)}")
            }
        }
    }
}

/**
 * One background thread for calls into the system that can take a while when the phone is busy
 * (installing apps, low on memory): screen time, which app is in front, the permission checks. The
 * main thread only hands work over and gets the answer back, so a tap is never kept waiting on them.
 */
object Work {
    private val thread = android.os.HandlerThread("ps-work").apply { start() }
    private val h = android.os.Handler(thread.looper)
    fun post(f: () -> Unit) { h.post { runCatching(f).onFailure { Plog.i("work failed: ${it.javaClass.simpleName}") } } }
}

/** One line log with a PS GOS tag. Never names, texts or keys; Signal and 1Password never reach it. */
object Plog {
    fun i(msg: String) { Log.i("PSGOS", msg.take(300)) }
}
