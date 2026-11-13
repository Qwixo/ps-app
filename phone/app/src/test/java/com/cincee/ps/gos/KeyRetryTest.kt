package com.cincee.ps.gos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** V1.47: the background video's key is tried again when the Keystore is busy, instead of the player giving up for good. */
class KeyRetryTest {
    @Test fun firstTryWinsWithNoWait() {
        val waits = ArrayList<Long>()
        assertEquals("k", KeyRetry.run(3, { 300L * it }, sleep = { waits.add(it) }) { "k" })
        assertEquals(emptyList<Long>(), waits)
    }

    @Test fun busyThenReady() {
        var calls = 0
        val waits = ArrayList<Long>()
        val fails = ArrayList<Int>()
        val k = KeyRetry.run(3, { 300L * it }, sleep = { waits.add(it) }, onFail = { n, _ -> fails.add(n) }) {
            calls++
            if (calls < 3) throw IllegalStateException("keystore busy")
            "key"
        }
        assertEquals("key", k)
        assertEquals(3, calls)
        assertEquals(listOf(300L, 600L), waits)
        assertEquals(listOf(1, 2), fails)
    }

    @Test fun neverReadyIsNullAfterTheLastTryWithNoWaitAfterIt() {
        var calls = 0
        val waits = ArrayList<Long>()
        assertNull(KeyRetry.run(3, { 300L * it }, sleep = { waits.add(it) }) { calls++; throw java.io.IOException("no") })
        assertEquals(3, calls)
        assertEquals(listOf(300L, 600L), waits)
    }
}
