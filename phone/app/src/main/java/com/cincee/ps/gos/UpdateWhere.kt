package com.cincee.ps.gos

/**
 * Where the phone asks for updates (V1.57, the developer, 13 Nov 2026: "Remove the IP address part so I can't see their IP
 * address when [PS] asks Cincee for updates"). The public PS repo's newest GitHub release holds the note
 * (gos-version.json) and the APK side by side; GitHub sends each request on to its file host. No fallback to
 * cincee.com. Where the files come from changes nothing about the checks: the APK must still match the note's
 * SHA-256 and be signed with PS's own pinned certificate (Updater.verifySigner). Unit tested in UpdateWhereTest.
 */
object UpdateWhere {
    private val APK = Regex("^[A-Za-z0-9._-]+\\.apk$")
    fun base(b: String = BuildConfig.UPDATE_BASE) = b.trimEnd('/') + "/"
    fun note(b: String = BuildConfig.UPDATE_BASE, name: String = BuildConfig.UPDATE_NOTE) = base(b) + name
    /** The APK the note names, or null for a name that is not a plain file name (no folders, no other host). */
    fun apk(name: String, b: String = BuildConfig.UPDATE_BASE): String? = if (APK.matches(name) && !name.startsWith(".")) base(b) + name else null
}
