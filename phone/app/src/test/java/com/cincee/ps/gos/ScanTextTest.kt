package com.cincee.ps.gos

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ScanTextTest {
    private fun w(t: String, c: Float, start: Boolean = false) = ScanText.Word(t, c, start)

    @Test fun picture_from_a_data_url() {
        val raw = ByteArray(200) { it.toByte() }
        val url = "data:image/jpeg;base64," + java.util.Base64.getEncoder().encodeToString(raw)
        assertArrayEquals(raw, ScanText.bytes(url))
        assertArrayEquals(raw, ScanText.bytes(url.replace("jpeg", "png")))
    }

    @Test fun anything_else_is_refused() {
        assertNull(ScanText.bytes(""))
        assertNull(ScanText.bytes("https://example.com/a.jpg"))
        assertNull(ScanText.bytes("data:text/html;base64,PGgxPg=="))
        assertNull(ScanText.bytes("data:image/jpeg;base64,!!!not base64!!!"))
        assertNull(ScanText.bytes("data:image/jpeg;base64,AAAA"))   // too small to be a picture
        assertNull(ScanText.bytes("data:image/jpeg;base64," + "A".repeat(ScanText.MAX_URL)))
    }

    @Test fun lines_are_kept_and_unsure_specks_dropped() {
        val words = listOf(w("gym80", 88f, true), w("|", 20f), w("BEINPRESSE", 91f, true), w("ii", 12f), w("~", 30f, true), w("12", 80f, true), w("kg", 75f))
        assertEquals("gym80\nBEINPRESSE\n12 kg", ScanText.pick(words))
    }

    @Test fun a_blurry_label_keeps_every_word() {
        val words = listOf(w("Latzug", 31f, true), w("_", 10f))
        assertEquals("Latzug", ScanText.pick(words))
    }

    @Test fun nothing_read_is_empty() {
        assertEquals("", ScanText.pick(emptyList()))
        assertEquals("", ScanText.pick(listOf(w("  ", 90f, true), w("..", 90f))))
        assertEquals(3, ScanText.letters("Ab 1c!"))
    }
}
