package com.cincee.ps.gos

/**
 * PS 1.60: the camera path in the page. The header `Permissions-Policy: camera=()` blocked the camera inside the page before
 * Android was ever asked, so Gym scan never opened it. The page's own origin may use the camera now (`camera=(self)`);
 * the microphone and location stay blocked. The rest of the path is unchanged: the page asks, WebHost.onPermissionRequest
 * lets only PS's own page ask for video and nothing else, MainActivity.cameraFor asks Android, the camera opens.
 * Pure, so a unit test checks it (CameraPolicyTest).
 */
object CameraPolicy {
    /** The page's own address on the phone (WebViewAssetLoader's default host). */
    const val HOST = "appassets.androidplatform.net"
    const val VIDEO = "android.webkit.resource.VIDEO_CAPTURE"

    /** The Permissions-Policy header: camera for PS's own page only, everything else off. */
    fun header(): String = "camera=(self), microphone=(), geolocation=()"

    /** May this request get the camera: PS's own page over https, asking for video and nothing else, while the screen is up. */
    fun allow(scheme: String?, host: String?, resources: Collection<String>, screenUp: Boolean): Boolean =
        screenUp && scheme == "https" && host == HOST && resources.isNotEmpty() && resources.all { it == VIDEO }
}
