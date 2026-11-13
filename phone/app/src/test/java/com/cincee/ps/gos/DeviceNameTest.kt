package com.cincee.ps.gos

import org.junit.Assert.assertEquals
import org.junit.Test

/** The maker and model the page gets for the Mac's phone picker (DeviceName.kt, V1.56). */
class DeviceNameTest {
    @Test fun pixel() = assertEquals("Google|Pixel 8", DeviceName.of("Google", "Pixel 8"))
    @Test fun nothingKnown() = assertEquals("", DeviceName.of(null, null))
    @Test fun noSplitterOrControlCharacters() = assertEquals("Evil|Pixel 9", DeviceName.of("Ev|il", "Pix\nel   9"))
    @Test fun keptShort() = assertEquals(30, DeviceName.of("x".repeat(99), "y").substringBefore('|').length)
}
