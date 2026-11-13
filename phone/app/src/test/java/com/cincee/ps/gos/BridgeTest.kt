package com.cincee.ps.gos

import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * The 2 Nov 2026 freeze, off the phone: the page's messages must leave the main thread at once, the
 * Keystore must never be used on the main thread and only ever one operation at a time, and a video
 * stream must not decrypt pieces nobody reads. A real "main" thread here is a named single thread.
 */
class BridgeTest {
    private val mainPool = Executors.newSingleThreadExecutor { r -> Thread(r, "fake-main") }
    private val bridgePool = Executors.newSingleThreadExecutor { r -> Thread(r, "fake-bridge") }
    private fun onMain() = Thread.currentThread().name == "fake-main"
    @After fun stop() { mainPool.shutdownNow(); bridgePool.shutdownNow() }

    private fun drain() {
        // Twice: a bridge task may post to main, and main work may have been queued after it.
        repeat(2) { bridgePool.submit {}.get(5, TimeUnit.SECONDS); mainPool.submit {}.get(5, TimeUnit.SECONDS) }
    }

    // ---------- routes ----------
    @Test fun keystoreAndDiskMessagesNeverRunOnMain() {
        // Every message whose handler seals, opens or deletes with the Keystore, or reads or writes a file.
        for (t in listOf("session", "schedule", "remember:forget", "nuke", "cmdKey:get", "ready", "lock", "prefs:set",
            "status", "tasks", "meetCard", "dnd", "cardHide", "remindNext", "update:check", "update:install", "bg:list", "pulse:done", "log",
            "remPlan", "rem:test", "rem:testStop", "rem:sound:get", "rem:sound:save", "rem:sound:remove"))
            assertEquals(t, On.BRIDGE, BridgeRoutes.of(t))
    }

    @Test fun onlyScreenMessagesRunOnMain() {
        for (t in listOf("haptic", "perm", "back:none", "kb:show", "remember:save", "remember:unlock", "cmd:sign", "gymPlan", "fitness:start", "fitness:get"))
            assertEquals(t, On.MAIN, BridgeRoutes.of(t))
        // Anything new or unknown defaults to the bridge thread, never the main thread.
        assertEquals(On.BRIDGE, BridgeRoutes.of("something:new"))
        assertEquals(On.BRIDGE, BridgeRoutes.of(""))
    }

    // ---------- dispatcher ----------
    @Test fun theListenerOnlyHandsOver() {
        val calls = AtomicInteger()
        val blockBridge = CountDownLatch(1)
        bridgePool.execute { blockBridge.await(5, TimeUnit.SECONDS) }   // keystore2 is busy: the bridge thread is stuck
        val d = BridgeDispatcher(mainPool, bridgePool, { _, _ -> calls.incrementAndGet() })
        // Called "from main": it must return at once even though the bridge thread is stuck.
        val t0 = System.nanoTime()
        mainPool.submit { d.onRaw("""{"type":"session","access":"a","exp":1}""") }.get(1, TimeUnit.SECONDS)
        assertTrue("onRaw waited", System.nanoTime() - t0 < 500_000_000)
        assertEquals(0, calls.get())
        blockBridge.countDown()
        drain()
        assertEquals(1, calls.get())
    }

    @Test fun sessionIsSealedOnTheBridgeThreadAndInOrder() {
        val gate = KeyGate(::onMain, strict = true)
        val seen = Collections.synchronizedList(ArrayList<String>())
        val errors = Collections.synchronizedList(ArrayList<Throwable>())
        val d = BridgeDispatcher(mainPool, bridgePool, { type, m ->
            when (type) {
                "session", "schedule", "remember:forget" -> gate.run(type) { seen.add("$type:${Thread.currentThread().name}:${m.optString("n")}") }
                "haptic" -> seen.add("$type:${Thread.currentThread().name}")
            }
        }, { _, e -> errors.add(e) })
        mainPool.submit {
            for (n in 1..5) d.onRaw(JSONObject().put("type", "session").put("n", n).toString())
            d.onRaw("""{"type":"schedule","n":"s"}""")
            d.onRaw("""{"type":"haptic"}""")
            d.onRaw("""{"type":"remember:forget","n":"f"}""")
            d.onRaw("not json")
        }.get(1, TimeUnit.SECONDS)
        drain()
        assertTrue(errors.toString(), errors.isEmpty())
        assertEquals(listOf("session:fake-bridge:1", "session:fake-bridge:2", "session:fake-bridge:3", "session:fake-bridge:4", "session:fake-bridge:5",
            "schedule:fake-bridge:s", "remember:forget:fake-bridge:f"), seen.filter { !it.startsWith("haptic") })
        assertTrue(seen.contains("haptic:fake-main"))
    }

    @Test fun aFailingMessageIsLoggedAndTheNextOneStillRuns() {
        val failed = Collections.synchronizedList(ArrayList<String>())
        val ok = AtomicInteger()
        val d = BridgeDispatcher(mainPool, bridgePool, { type, _ -> if (type == "bad") throw IllegalStateException("x") else ok.incrementAndGet() }, { t, _ -> failed.add(t) })
        d.onRaw("""{"type":"bad"}"""); d.onRaw("""{"type":"tasks"}""")
        drain()
        assertEquals(listOf("bad"), failed)
        assertEquals(1, ok.get())
    }

    // ---------- the Keystore gate ----------
    @Test fun debugGateThrowsOnTheMainThread() {
        val gate = KeyGate(::onMain, strict = true)
        val r = mainPool.submit<Throwable?> { try { gate.run("seal") { 1 }; null } catch (e: Throwable) { e } }.get(1, TimeUnit.SECONDS)
        assertTrue(r is IllegalStateException)
        // The same call off the main thread is fine.
        assertEquals(1, bridgePool.submit<Int> { gate.run("seal") { 1 } }.get(1, TimeUnit.SECONDS))
    }

    @Test fun releaseGateWarnsOnceAndNeverQueuesMainBehindOthers() {
        val warned = Collections.synchronizedList(ArrayList<String>())
        val gate = KeyGate(::onMain, strict = false) { warned.add(it) }
        val holding = CountDownLatch(1); val release = CountDownLatch(1)
        bridgePool.execute { gate.run("video") { holding.countDown(); release.await(5, TimeUnit.SECONDS) } }
        holding.await(1, TimeUnit.SECONDS)
        // A slipped main thread call does not wait for the video piece holding the gate.
        assertEquals(7, mainPool.submit<Int> { gate.run("a") { 7 } }.get(1, TimeUnit.SECONDS))
        mainPool.submit { gate.run("b") { 0 } }.get(1, TimeUnit.SECONDS)
        release.countDown()
        assertEquals(1, warned.size)
    }

    @Test fun keystoreOperationsNeverOverlap() {
        val gate = KeyGate({ false }, strict = true)
        val pool = Executors.newFixedThreadPool(8)
        val inside = AtomicInteger(); val most = AtomicInteger(); val done = AtomicInteger()
        val tasks = (1..8).map { pool.submit { repeat(40) {
            gate.run("op") {
                val n = inside.incrementAndGet(); most.accumulateAndGet(n) { a, b -> maxOf(a, b) }
                Thread.sleep(0, 200_000)
                // Reentrant: a gated call inside a gated call (Keys.write inside CmdKey.prepare) must not deadlock.
                gate.run("inner") { done.incrementAndGet() }
                inside.decrementAndGet()
            }
        } } }
        tasks.forEach { it.get(30, TimeUnit.SECONDS) }
        pool.shutdown()
        assertEquals(1, most.get())
        assertEquals(320, done.get())
    }

    // ---------- the video stream ----------
    private fun pieces(vararg p: String) = p.map { it.toByteArray() }

    @Test fun pieceStreamReadsEverythingInOrder() {
        val ps = pieces("hello ", "", "video ", "world")
        val opened = ArrayList<Int>()
        val s = PieceStream(ps.size) { i -> opened.add(i); ps[i] }
        val out = ByteArrayOutputStream()
        val buf = ByteArray(4)
        while (true) { val n = s.read(buf, 0, buf.size); if (n < 0) break; out.write(buf, 0, n) }
        assertEquals("hello video world", out.toString())
        assertEquals(listOf(0, 1, 2, 3), opened)
        assertEquals(-1, s.read())
    }

    @Test fun pieceStreamOpensOnlyWhatIsRead() {
        val opened = AtomicInteger()
        val s = PieceStream(400) { opened.incrementAndGet(); ByteArray(1000) { 7 } }
        assertEquals(0, opened.get())         // nothing decrypted just to make the response
        assertEquals(7, s.read())
        assertEquals(1, opened.get())
        s.close()                             // SequenceInputStream would decrypt the other 399 here
        assertEquals(1, opened.get())
        assertEquals(-1, s.read())
        assertEquals(0, s.available())
    }

    @Test fun pieceStreamSingleBytesAndEmpty() {
        val s = PieceStream(2) { i -> byteArrayOf((200 + i).toByte()) }
        assertEquals(200, s.read()); assertEquals(201, s.read()); assertEquals(-1, s.read())
        assertEquals(-1, PieceStream(0) { fail("opened"); ByteArray(0) }.read())
        assertArrayEquals(ByteArray(0), PieceStream(1) { ByteArray(0) }.readBytes())
    }

    // ---------- repeats ----------
    @Test fun aRepeatIsNotSealedAgain() {
        val m = SameAsLast()
        val tok = """{"access":"eyJ.a.b","exp":1793448000}"""
        assertFalse(m.same(tok))
        m.wrote(tok)
        assertTrue(m.same(tok))
        assertFalse(m.same("""{"access":"eyJ.c.d","exp":1793451600}"""))
        m.forget()
        assertFalse(m.same(tok))
    }
}
