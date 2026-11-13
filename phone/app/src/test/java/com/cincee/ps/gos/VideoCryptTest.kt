package com.cincee.ps.gos

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.concurrent.atomic.AtomicInteger

/** V1.33: the developer's background videos on the phone, sealed in software with the phone's video key and served in byte ranges. */
class VideoCryptTest {
    private val key = VideoCrypt.newKey()

    @Test fun sealOpenRoundTripAndCiphertextOnly() {
        val plain = ByteArray(1_500_000) { (it % 251).toByte() }
        val sealed = VideoCrypt.seal(key, "v-abc", 3, plain)
        assertEquals(plain.size + VideoCrypt.OVERHEAD, sealed.size)
        assertArrayEquals(plain, VideoCrypt.open(key, "v-abc", 3, sealed))
        // Nothing of the plain video shows in the file.
        assertTrue(String(sealed, Charsets.ISO_8859_1).indexOf(String(plain.copyOfRange(0, 64), Charsets.ISO_8859_1)) < 0)
    }

    @Test fun freshIvEveryTime() {
        val p = "same".toByteArray()
        assertNotEquals(VideoCrypt.seal(key, "v", 0, p).toList(), VideoCrypt.seal(key, "v", 0, p).toList())
    }

    @Test fun aPieceCannotMoveOrBeOpenedWithAnotherKey() {
        val sealed = VideoCrypt.seal(key, "v-abc", 1, "piece one".toByteArray())
        for (bad in listOf<() -> Unit>(
            { VideoCrypt.open(key, "v-abc", 2, sealed) },            // another place
            { VideoCrypt.open(key, "v-other", 1, sealed) },          // another video
            { VideoCrypt.open(VideoCrypt.newKey(), "v-abc", 1, sealed) },
            { VideoCrypt.open(key, "v-abc", 1, sealed.copyOf().also { it[20] = (it[20].toInt() xor 1).toByte() }) },
            { VideoCrypt.open(key, "v-abc", 1, ByteArray(10)) },
        )) {
            try { bad(); fail("opened") } catch (_: Exception) { /* expected */ }
        }
    }

    @Test fun rangeHeaders() {
        val n = 10_000L
        assertEquals(VideoRange.Result.Whole, VideoRange.parse(null, n))
        assertEquals(VideoRange.Result.Whole, VideoRange.parse("items=0-4", n))
        assertEquals(VideoRange.Result.Whole, VideoRange.parse("bytes=x-4", n))
        assertEquals(VideoRange.Result.Part(ByteSpan(0, 9_999)), VideoRange.parse("bytes=0-", n))
        assertEquals(VideoRange.Result.Part(ByteSpan(100, 199)), VideoRange.parse("bytes=100-199", n))
        assertEquals(VideoRange.Result.Part(ByteSpan(9_000, 9_999)), VideoRange.parse("Bytes=9000-20000", n))
        assertEquals(VideoRange.Result.Part(ByteSpan(9_500, 9_999)), VideoRange.parse("bytes=-500", n))
        assertEquals(VideoRange.Result.Part(ByteSpan(0, 9_999)), VideoRange.parse("bytes=-50000", n))
        assertEquals(VideoRange.Result.Part(ByteSpan(5, 9)), VideoRange.parse("bytes=5-9, 20-30", n))
        assertEquals(VideoRange.Result.Bad, VideoRange.parse("bytes=10000-", n))
        assertEquals(VideoRange.Result.Bad, VideoRange.parse("bytes=50-10", n))
        assertEquals(VideoRange.Result.Bad, VideoRange.parse("bytes=-0", n))
        assertEquals(500L, ByteSpan(9_500, 9_999).length)
    }

    @Test fun locateAByte() {
        val sizes = listOf(1_500_000L, 1_500_000L, 700L)
        assertEquals(0 to 0, VideoRange.locate(sizes, 0))
        assertEquals(0 to 1_499_999, VideoRange.locate(sizes, 1_499_999))
        assertEquals(1 to 0, VideoRange.locate(sizes, 1_500_000))
        assertEquals(2 to 699, VideoRange.locate(sizes, 3_000_699))
        assertNull(VideoRange.locate(sizes, 3_000_700))
    }

    /** A range served from sealed pieces is exactly those bytes, and only the pieces it needs are opened. */
    @Test fun aRangeFromSealedPieces() {
        val video = ByteArray(3_200_000) { (it * 7 % 256).toByte() }
        val piece = 1_500_000
        val sealed = (0 until 3).map { i -> VideoCrypt.seal(key, "v-r", i, video.copyOfRange(i * piece, minOf(video.size, (i + 1) * piece))) }
        val sizes = sealed.map { (it.size - VideoCrypt.OVERHEAD).toLong() }
        assertEquals(video.size.toLong(), sizes.sum())
        fun serve(header: String?): Pair<ByteArray, List<Int>> {
            val opened = ArrayList<Int>()
            val r = VideoRange.parse(header, sizes.sum())
            val s = when (r) {
                is VideoRange.Result.Part -> { val (f, k) = VideoRange.locate(sizes, r.span.start)!!; PieceStream(3, f, k, r.span.length) { i -> opened.add(i); VideoCrypt.open(key, "v-r", i, sealed[i]) } }
                else -> PieceStream(3) { i -> opened.add(i); VideoCrypt.open(key, "v-r", i, sealed[i]) }
            }
            val out = ByteArrayOutputStream(); val buf = ByteArray(65_536)
            while (true) { val n = s.read(buf, 0, buf.size); if (n < 0) break; out.write(buf, 0, n) }
            return out.toByteArray() to opened
        }
        assertArrayEquals(video, serve(null).first)
        // The mp4 index at the end: only the last piece is opened.
        val (tail, tailOpened) = serve("bytes=3100000-")
        assertArrayEquals(video.copyOfRange(3_100_000, video.size), tail)
        assertEquals(listOf(2), tailOpened)
        // Across a piece boundary.
        val (mid, midOpened) = serve("bytes=1499990-1500009")
        assertArrayEquals(video.copyOfRange(1_499_990, 1_500_010), mid)
        assertEquals(listOf(0, 1), midOpened)
        // A loop back to the start reads the first piece only for its first bytes.
        val (head, headOpened) = serve("bytes=0-99")
        assertArrayEquals(video.copyOfRange(0, 100), head)
        assertEquals(listOf(0), headOpened)
    }

    @Test fun limitStopsSingleByteReadsAndAvailable() {
        val opened = AtomicInteger()
        val s = PieceStream(5, 1, 2, 3) { i -> opened.incrementAndGet(); byteArrayOf((10 * i).toByte(), (10 * i + 1).toByte(), (10 * i + 2).toByte(), (10 * i + 3).toByte()) }
        assertEquals(12, s.read()); assertEquals(1, s.available()); assertEquals(13, s.read()); assertEquals(20, s.read())
        assertEquals(-1, s.read()); assertEquals(0, s.available())
        assertEquals(2, opened.get())
    }
}
