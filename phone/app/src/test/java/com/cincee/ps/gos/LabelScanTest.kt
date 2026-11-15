package com.cincee.ps.gos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/*
 * Gym scan, real labels (V1.60). The five photos in src/test/resources/gym-labels are real machine labels (two makers, German and
 * English, one written up the side). Next to each is what Tesseract read from it with the app's own models at every turn, scale
 * and tilt the search tries (name.reads.txt). The test replays those reads through the same search the phone runs, so what the
 * scan would answer for each photo is checked here, with no phone.
 */
class LabelScanTest {
    private val dir = File(javaClass.classLoader!!.getResource("gym-labels")!!.toURI())

    /** The recorded reads for one photo as a reader: (turn, scale, tilt) gives that try's lines. */
    private fun reads(name: String): (Int, Float, Float) -> List<ScanText.Line> {
        val rows = File(dir, "$name.reads.txt").readLines().filter { !it.startsWith("#") && it.isNotBlank() }.map { it.split("|", limit = 6) }
        val by = rows.groupBy { Triple(it[0].toInt(), it[1].toFloat(), it[2].toFloat()) }
        return { turn, scale, tilt -> (by[Triple(turn, scale, tilt)] ?: emptyList()).map { ScanText.Line(it[5], it[3].toFloat(), it[4].toInt()) } }
    }
    private fun scan(name: String, tries: IntArray? = null): ScanText.Found {
        val r = reads(name)
        var n = 0
        val f = ScanText.search({ true }) { a, b, c -> n++; r(a, b, c) }
        tries?.set(0, n)
        return f
    }

    @Test fun the_five_photos_are_there_and_are_images() {
        val names = listOf("beinbeuger-liegend-lk-rotated", "beinstrecker-lk-rotated", "pectoral-technogym", "reverse-fly-technogym-close", "reverse-fly-technogym-far")
        for (n in names) {
            val f = File(dir, "$n.webp")
            assertTrue("$n.webp", f.length() > 10_000)
            val head = f.inputStream().use { it.readNBytes(12) }
            assertEquals("RIFF", String(head, 0, 4)); assertEquals("WEBP", String(head, 8, 4))
            assertTrue(File(dir, "$n.reads.txt").length() > 50)
        }
    }

    @Test fun lying_leg_curl_is_read_sideways() {
        val f = scan("beinbeuger-liegend-lk-rotated")
        assertEquals(90, f.best!!.turn)
        assertTrue(f.title!!, f.title!!.contains("BEINBEUGER LIEGEND"))
        assertTrue(f.text.lines().first().contains("BEINBEUGER LIEGEND"))
    }

    @Test fun leg_extension_is_read_sideways() {
        val f = scan("beinstrecker-lk-rotated")
        assertEquals(90, f.best!!.turn)
        assertEquals("BEINSTRECKER", f.title)
    }

    @Test fun pec_fly_label_reads_pectoral() {
        val f = scan("pectoral-technogym")
        assertEquals(0, f.best!!.turn)
        assertTrue(f.title!!, f.title!!.equals("PECTORAL", ignoreCase = true))
    }

    @Test fun reverse_fly_close_and_far() {
        assertEquals("REVERSE FLY", scan("reverse-fly-technogym-close").title)
        val far = scan("reverse-fly-technogym-far")
        assertEquals("REVERSE FLY", far.title)
        assertTrue("the far one needs more than the three turns", far.tries > 3)
    }

    @Test fun the_title_comes_first_and_no_address_comes_with_it() {
        for (n in listOf("beinbeuger-liegend-lk-rotated", "beinstrecker-lk-rotated")) {
            val f = scan(n)
            val lines = f.text.lines()
            assertEquals(f.title, lines.first())
            assertTrue(lines.none { ScanText.isJunk(it) })
        }
    }

    @Test fun a_good_title_ends_the_search_early() {
        val c = IntArray(1)
        scan("pectoral-technogym", c)
        assertTrue("tries ${c[0]}", c[0] <= 3)
        val d = IntArray(1)
        scan("reverse-fly-technogym-far", d)
        assertTrue("tries ${d[0]}", d[0] <= 8)
    }

    @Test fun out_of_time_stops_after_the_first_try() {
        val r = reads("beinstrecker-lk-rotated")
        var n = 0
        ScanText.search({ false }) { a, b, c -> n++; r(a, b, c) }
        assertEquals(1, n)
    }

    @Test fun nothing_read_gives_nothing() {
        val f = ScanText.search({ true }) { _, _, _ -> emptyList() }
        assertEquals("", f.text)
        assertNull(f.title)
    }

    @Test fun addresses_websites_phones_are_junk_any_maker() {
        for (t in listOf("Musterweg 2E - 12345 Beispielstadt", "www.example.com", "info" + "@" + "example.com", "Tel.: 01234 - 5678-0", "Example Fitness GmbH", "Musterstrasse 12", "technogym.com", "Fax: +49 1234 56780")) assertTrue(t, ScanText.isJunk(t))
        for (t in listOf("BEINBEUGER LIEGEND", "REVERSE FLY", "45 degree leg press", "Lat pulldown")) assertFalse(t, ScanText.isJunk(t))
    }

    @Test fun a_title_looks_like_one() {
        assertTrue(ScanText.titleLook("BEINSTRECKER") > 0.9f)
        assertTrue(ScanText.titleLook("Leg Press") >= 0.7f)
        assertEquals(0f, ScanText.titleLook("1. Das Trainingsgewicht so waehlen"), 0f)
        assertEquals(0f, ScanText.titleLook("4. Die Beine"), 0f)
        assertEquals(0f, ScanText.titleLook("Die Bauchlage so waehlen dass sich die"), 0f)
    }

    @Test fun the_tallest_capital_line_beats_small_text() {
        val lines = listOf(
            ScanText.Line("Seitenansicht", 93f, 33), ScanText.Line("3. der Fuesse", 84f, 32),
            ScanText.Line("BEINSTRECKER", 92f, 62), ScanText.Line("Rueckenlehne einstellen", 80f, 20), ScanText.Line("Pie polste", 70f, 27),
        )
        assertEquals("BEINSTRECKER", ScanText.title(lines)!!.first.text)
    }

    @Test fun unsure_garbage_is_never_a_title() {
        assertNull(ScanText.title(listOf(ScanText.Line("DEREN EEE", 28f, 102), ScanText.Line("YANDIALSNIAG", 21f, 62))))
        assertNotNull(ScanText.title(listOf(ScanText.Line("PECTORAL", 91f, 26))))
    }
}
