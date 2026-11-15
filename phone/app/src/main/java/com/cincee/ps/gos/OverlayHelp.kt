package com.cincee.ps.gos

/**
 * PS 1.60: the island's first time card and "Display over other apps". Android blocks that permission for an app that was not
 * installed from a store ("App was denied access ... restricted permission"), and PS app is installed from a file. The
 * person must first unlock it: Settings, Apps, PS app, the three dots at the top right, Allow restricted settings, confirm,
 * and only then switch on Display over other apps. This holds the words and the rules for when the card shows again;
 * MainActivity.askIsland draws it. No Android calls here, so a unit test can run it (OverlayHelpTest).
 */
object OverlayHelp {
    const val TITLE = "Dynamic island"
    const val OPEN_APP = "Open PS app settings"
    const val OPEN_OVERLAY = "Display over other apps"
    const val LATER = "Not now"

    /** The steps, in the order the person does them. */
    val STEPS = listOf(
        "Tap Open PS app settings below.",
        "Tap the three dots at the top right, then Allow restricted settings, and confirm.",
        "Go back, tap Display over other apps, and switch it on.",
    )

    private const val WHY = "PS app can show a small live island around your camera, over every app: your next meeting, Pomodoro breaks, stand-ups, reminders and AI messages. Tap it to open PS app.\n\nAndroid calls this Display over other apps, and blocks it for apps installed from a file, so it needs two steps first. It never shows over the lock screen. You can switch it off in Settings, This phone."

    /** The card's words. `still`: the person came back from Settings and it is still off. */
    fun message(still: Boolean): String {
        val steps = STEPS.mapIndexed { i, s -> "${i + 1}. $s" }.joinToString("\n")
        return if (still) "Still off. Android has not allowed it yet. Do these steps once more:\n\n$steps"
        else "$WHY\n\n$steps"
    }

    /** Show the card again after the person comes back from Settings: they asked for it (`waiting`), the island is on, and
     *  Android still says no. */
    fun showAgain(granted: Boolean, islandOn: Boolean, waiting: Boolean) = waiting && islandOn && !granted

    /** They did it: stop waiting. */
    fun finished(granted: Boolean, waiting: Boolean) = waiting && granted

    /** The very first time: the island is on, there is no permission and the card was never shown. */
    fun showFirst(granted: Boolean, islandOn: Boolean, asked: Boolean) = islandOn && !granted && !asked
}
