package com.cincee.ps.gos

/**
 * Which update the Update now tap installs, with no Android in it (unit tested in src/test, UpdatePickTest).
 *
 * V1.51 (the developer, 12 Nov 2026: "it updates you to 1.49 and then you have to update again to 1.5"): the tap used to
 * install the version.json the last look had read (looks run when PS opens, at most once an hour, and in the
 * background every few hours), so a tap after a newer release still installed the older one. Now the tap reads
 * version.json fresh and installs what it names; the card moves on to that number. The downloaded APK's own
 * versionCode is checked against the newest version.json before it is installed: older is refused and the newest
 * is fetched once more.
 */
object UpdatePick {
    /** The fresh version.json wins; only when it could not be read (offline) the card's goes in. */
    fun <T> choose(card: T, fresh: T?): T = fresh ?: card

    /** Worth installing at all: strictly newer than this app. */
    fun newer(code: Int, installed: Int): Boolean = code > installed

    /** The phrase every "older than the newest" refusal carries (Updater retries once on it). */
    const val STALE = "older than the newest version"

    /** Refuses an APK older than the newest version.json (null = fine). */
    fun staleProblem(apkCode: Long, newestCode: Int): String? =
        if (apkCode < newestCode) "The download (code $apkCode) is $STALE (code $newestCode)." else null

    fun isStale(why: String?): Boolean = why?.contains(STALE) == true
}
