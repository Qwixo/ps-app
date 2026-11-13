package com.cincee.ps.gos

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager

/** Debug builds only (not in the release APK): lets an emulator test run one background check now,
 *  without waiting for WorkManager's network rule. adb shell am broadcast -n <pkg>/com.cincee.ps.gos.DebugHooks */
class DebugHooks : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        Plog.i("debug: one background check now")
        WorkManager.getInstance(c).enqueue(OneTimeWorkRequestBuilder<PulseWorker>().build())
    }
}
