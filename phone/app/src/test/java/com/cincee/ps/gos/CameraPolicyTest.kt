package com.cincee.ps.gos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** PS 1.60: the camera path. The header lets the page's own origin use the camera and nothing else. */
class CameraPolicyTest {
    private val v = listOf(CameraPolicy.VIDEO)

    @Test fun theHeaderAllowsTheCameraForSelfOnly() {
        val h = CameraPolicy.header()
        assertTrue(h.contains("camera=(self)"))
        assertFalse(h.contains("camera=()"))
        assertTrue(h.contains("microphone=()"))
        assertTrue(h.contains("geolocation=()"))
        assertFalse(h.contains("*"))
    }

    @Test fun onlyOurOwnPageGetsVideo() {
        assertTrue(CameraPolicy.allow("https", CameraPolicy.HOST, v, true))
        assertFalse(CameraPolicy.allow("https", "example.com", v, true))
        assertFalse(CameraPolicy.allow("http", CameraPolicy.HOST, v, true))
        assertFalse(CameraPolicy.allow(null, null, v, true))
    }

    @Test fun neverTheMicrophoneOrAnythingElse() {
        assertFalse(CameraPolicy.allow("https", CameraPolicy.HOST, listOf(CameraPolicy.VIDEO, "android.webkit.resource.AUDIO_CAPTURE"), true))
        assertFalse(CameraPolicy.allow("https", CameraPolicy.HOST, listOf("android.webkit.resource.AUDIO_CAPTURE"), true))
        assertFalse(CameraPolicy.allow("https", CameraPolicy.HOST, emptyList(), true))
    }

    @Test fun onlyWhileTheScreenIsUp() {
        assertFalse(CameraPolicy.allow("https", CameraPolicy.HOST, v, false))
    }

    @Test fun theHostMatchesTheWebHostOrigin() {
        assertEquals("https://" + CameraPolicy.HOST, WebHost.ORIGIN)
    }
}
