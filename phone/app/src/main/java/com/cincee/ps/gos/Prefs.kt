package com.cincee.ps.gos

import android.app.AlarmManager
import android.app.AppOpsManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.PowerManager
import android.os.Process
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject

/** This phone's PS settings (never in the vault). Nothing secret lives here. */
object Prefs {
    private fun sp(c: Context) = c.getSharedPreferences("ps", Context.MODE_PRIVATE)

    fun get(c: Context, k: String, d: Boolean) = sp(c).getBoolean(k, d)
    fun str(c: Context, k: String, d: String) = sp(c).getString(k, d) ?: d

    // Default: the Quick Settings tile (always there once added, costs nothing) and the quiet
    // notification. The widget is added from the home screen; the bubble needs a permission.
    fun tile(c: Context) = get(c, "tile", true)
    fun notification(c: Context) = get(c, "notification", true)
    fun widget(c: Context) = get(c, "widget", true)
    fun bubble(c: Context) = get(c, "bubble", false)
    fun background(c: Context) = get(c, "background", true)
    fun ays(c: Context) = get(c, "ays", false)
    fun haptics(c: Context) = get(c, "haptics", true)
    /** V1.59 the Dynamic island (Island.kt): on unless switched off; it needs Display over other apps. */
    fun island(c: Context) = get(c, "island", true)
    /** V1.59 Instant notifications (LiveLink.kt): the live link while background checks are on. On unless switched off. */
    fun live(c: Context) = get(c, "live", true)
    /** Track my screen time (open source build): off, ScreenTime.today reads no usage at all. On unless switched off. */
    fun screenTime(c: Context) = get(c, "screenTime", true)
    /** Stay signed in (the developer, 28 Oct 2026: no fingerprint every time PS opens). Off: the fingerprint each time. */
    fun stay(c: Context) = get(c, "stay", true)
    /** The developer pressed Lock: the next open asks for the fingerprint once, even with Stay signed in on. */
    fun handLocked(c: Context) = get(c, "handLocked", false)
    fun setHandLocked(c: Context, v: Boolean) = sp(c).edit().putBoolean("handLocked", v).apply()
    fun aysApps(c: Context): List<String> = str(c, "aysApps", "com.google.android.youtube,com.netflix.mediaclient").split(',').filter { it.isNotBlank() }

    fun json(c: Context) = JSONObject().apply {
        put("open", str(c, "open", "tile"))
        put("tile", tile(c)); put("widget", widget(c)); put("notification", notification(c)); put("bubble", bubble(c))
        put("background", background(c)); put("ays", ays(c)); put("haptics", haptics(c)); put("stay", stay(c)); put("screenTime", screenTime(c))
        put("island", island(c)); put("live", live(c))
        put("aysApps", JSONArray(aysApps(c)))
    }

    fun set(c: Context, p: JSONObject) {
        val e = sp(c).edit()
        for (k in listOf("tile", "widget", "notification", "bubble", "background", "ays", "haptics", "stay", "screenTime", "island", "live")) if (p.has(k)) e.putBoolean(k, p.optBoolean(k))
        if (p.has("open")) e.putString("open", p.optString("open").takeIf { it in setOf("tile", "widget", "notification", "bubble") } ?: "tile")
        e.apply()
    }

    fun perms(c: Context) = JSONObject().apply {
        put("notifications", c.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
        put("usage", hasUsage(c))
        put("overlay", Settings.canDrawOverlays(c))
        put("battery", (c.getSystemService(PowerManager::class.java)).isIgnoringBatteryOptimizations(c.packageName))
        put("exactAlarm", c.getSystemService(AlarmManager::class.java).canScheduleExactAlarms())
        put("install", c.packageManager.canRequestPackageInstalls())
        // The gym ring's full screen card over the lock screen (Android 14 asks for this one by hand).
        put("fullScreen", c.getSystemService(android.app.NotificationManager::class.java).canUseFullScreenIntent())
        // V1.59: this build keeps the island off 1Password and Signal, so it needs Usage access to know when they are open.
        put("islandUsage", Island.needsUsage(c))
        put("live", LiveLink.up)
    }

    fun hasUsage(c: Context): Boolean {
        val ops = c.getSystemService(AppOpsManager::class.java)
        return ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), c.packageName) == AppOpsManager.MODE_ALLOWED
    }
}

/** THE DEVELOPER'S GOLDEN RULE: PS never looks at or touches Signal or 1Password. Every read of an app name
 *  goes through here first and they are dropped before anything else sees them. */
object Protected {
    private val ids = setOf("org.thoughtcrime.securesms", "com.onepassword.android", "com.agilebits.onepassword")
    private val rx = Regex("1password|onepassword|agilebits|whispersystems|signal|thoughtcrime|securesms", RegexOption.IGNORE_CASE)
    fun isProtected(pkg: String?): Boolean = pkg != null && (pkg in ids || rx.containsMatchIn(pkg))
}
