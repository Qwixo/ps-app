package com.cincee.ps.gos

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileNotFoundException
import java.io.InputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class OcrModelsTest {
    @get:Rule val tmp = TemporaryFolder()

    /** A fake APK: model name to bytes, counting every open. */
    private class Apk(vararg models: Pair<String, String>) {
        val files = models.associate { (k, v) -> "$k.traineddata" to v.toByteArray() }.toMutableMap()
        val opened = mutableListOf<String>()
        fun open(name: String): InputStream {
            synchronized(opened) { opened += name }
            return ByteArrayInputStream(files[name] ?: throw FileNotFoundException(name))
        }
    }

    private fun dir() = File(tmp.root, "tessdata")
    private fun leftovers() = dir().listFiles().orEmpty().filter { it.name.endsWith(".part") }

    @Test fun modelsAreCopiedOncePerBuild() {
        assertTrue("first start, no copy yet", OcrModels.needsCopy(null, "100", 0L))
        assertFalse("copied for this build", OcrModels.needsCopy("100", "100", 2_524_769L))
        assertTrue("an update brings new models", OcrModels.needsCopy("100", "200", 2_524_769L))
        assertTrue("an empty copy is made again", OcrModels.needsCopy("100", "100", 0L))
        assertTrue("no build stamp known: copy to be safe", OcrModels.needsCopy("", "", 10L))
    }

    @Test fun firstStartCopiesEveryModelAndStamps() {
        val apk = Apk("deu" to "DEU", "eng" to "ENG")
        assertTrue(OcrModels.copyOut(dir(), "deu+eng", "gym", "100", apk::open))
        assertEquals(listOf("deu.traineddata", "eng.traineddata"), apk.opened)
        assertArrayEquals("DEU".toByteArray(), File(dir(), "deu.traineddata").readBytes())
        assertArrayEquals("ENG".toByteArray(), File(dir(), "eng.traineddata").readBytes())
        assertEquals("100", File(dir(), ".gym-models").readText())
        assertTrue("no part file left", leftovers().isEmpty())
    }

    @Test fun sameBuildOpensNothing() {
        val apk = Apk("deu" to "DEU", "eng" to "ENG")
        OcrModels.copyOut(dir(), "deu+eng", "gym", "100", apk::open)
        apk.opened.clear()
        assertTrue(OcrModels.copyOut(dir(), "deu+eng", "gym", "100", apk::open))
        assertTrue("nothing read from the APK again", apk.opened.isEmpty())
    }

    @Test fun anUpdateCopiesAgain() {
        val apk = Apk("deu" to "DEU", "eng" to "ENG")
        OcrModels.copyOut(dir(), "deu+eng", "gym", "100", apk::open)
        apk.files["eng.traineddata"] = "ENG2".toByteArray()
        apk.opened.clear()
        assertTrue(OcrModels.copyOut(dir(), "deu+eng", "gym", "200", apk::open))
        assertEquals(2, apk.opened.size)
        assertArrayEquals("ENG2".toByteArray(), File(dir(), "eng.traineddata").readBytes())
        assertEquals("200", File(dir(), ".gym-models").readText())
    }

    @Test fun anEmptyOrMissingModelIsCopiedAgain() {
        val apk = Apk("deu" to "DEU", "eng" to "ENG")
        OcrModels.copyOut(dir(), "deu+eng", "gym", "100", apk::open)
        File(dir(), "deu.traineddata").writeText("")
        File(dir(), "eng.traineddata").delete()
        apk.opened.clear()
        assertTrue(OcrModels.copyOut(dir(), "deu+eng", "gym", "100", apk::open))
        assertEquals(listOf("deu.traineddata", "eng.traineddata"), apk.opened)
        assertArrayEquals("DEU".toByteArray(), File(dir(), "deu.traineddata").readBytes())
    }

    @Test fun eachScanKeepsItsOwnStamp() {
        val apk = Apk("deu" to "DEU", "eng" to "ENG", "kat" to "KAT")
        OcrModels.copyOut(dir(), "kat+eng", "receipt", "100", apk::open)
        apk.opened.clear()
        assertTrue(OcrModels.copyOut(dir(), "deu+eng", "gym", "100", apk::open))
        assertTrue("the gym scan gets its German model", apk.opened.contains("deu.traineddata"))
        assertTrue(File(dir(), "deu.traineddata").length() > 0)
        apk.opened.clear()
        assertTrue(OcrModels.copyOut(dir(), "kat+eng", "receipt", "100", apk::open))
        assertTrue("the receipt stamp still holds", apk.opened.isEmpty())
    }

    @Test fun aFailedCopyLeavesTheOldModelAndNoStamp() {
        val apk = Apk("deu" to "DEU", "eng" to "ENG")
        OcrModels.copyOut(dir(), "deu+eng", "gym", "100", apk::open)
        apk.files.remove("eng.traineddata")
        try {
            OcrModels.copyOut(dir(), "deu+eng", "gym", "200", apk::open)
            fail("a model missing from the APK must not pass silently")
        } catch (_: FileNotFoundException) {}
        assertArrayEquals("the old copy stays whole", "ENG".toByteArray(), File(dir(), "eng.traineddata").readBytes())
        assertEquals("not stamped with the new build", "100", File(dir(), ".gym-models").readText())
        assertTrue("no part file left", leftovers().isEmpty())
    }

    @Test fun aStreamThatBreaksHalfwayLeavesNoPart() {
        val broken = object : InputStream() {
            var n = 0
            override fun read(): Int = if (n++ < 5) 65 else throw java.io.IOException("cut")
        }
        try {
            OcrModels.copyOut(dir(), "eng", "gym", "100") { broken }
            fail("a broken read must not pass silently")
        } catch (_: java.io.IOException) {}
        assertFalse("no half model in place", File(dir(), "eng.traineddata").exists())
        assertTrue(leftovers().isEmpty())
    }

    @Test fun bothScansAtOnceGetWholeModels() {
        val big = "x".repeat(2_000_000)
        val apk = Apk("deu" to big, "eng" to big, "kat" to big)
        val pool = Executors.newFixedThreadPool(2)
        val go = CountDownLatch(1)
        val a = pool.submit<Boolean> { go.await(); OcrModels.copyOut(dir(), "kat+eng", "receipt", "100", apk::open) }
        val b = pool.submit<Boolean> { go.await(); OcrModels.copyOut(dir(), "deu+eng", "gym", "100", apk::open) }
        go.countDown()
        assertTrue(a.get(20, TimeUnit.SECONDS))
        assertTrue(b.get(20, TimeUnit.SECONDS))
        pool.shutdown()
        for (m in listOf("deu", "eng", "kat")) assertEquals(big.length.toLong(), File(dir(), "$m.traineddata").length())
        assertTrue(leftovers().isEmpty())
    }
}
