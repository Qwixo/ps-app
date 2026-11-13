package com.cincee.ps.gos

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.OffsetDateTime
import java.time.ZoneId

/** The Soundboard's pure rules on the phone (SbClock.kt). FICTIONAL files and times only. */
class SbClockTest {
    private val LON = ZoneId.of("Europe/London")
    private val NY = ZoneId.of("America/New_York")
    private fun at(s: String) = OffsetDateTime.parse(s).toInstant().toEpochMilli()
    private fun play(at: String, days: List<Int> = (0..6).toList(), id: String = "p1", media: String = "0123456789abcdef") =
        SbClock.Play(id, media, "Wake song", at, days, 0.8, false)
    private var n = 0
    private val ids: () -> String = { "%016x".format(++n) }

    // ---------- kinds and content types ----------
    @Test fun audioAndVideoByExtension() {
        for (e in listOf("mp3", "m4a", "aac", "wav", "aif", "aiff", "flac", "ogg", "oga", "opus", "caf")) assertEquals(e, "audio", SbClock.kindOf(e))
        for (e in listOf("mp4", "m4v", "mov", "webm", "mkv", "3gp")) assertEquals(e, "video", SbClock.kindOf(e))
        assertNull(SbClock.kindOf("txt")); assertNull(SbClock.kindOf("")); assertNull(SbClock.kindOf("jpg"))
        assertEquals("mp3", SbClock.extOf("Song.MP3"))
        assertEquals("", SbClock.extOf(".hidden"))
        assertEquals("", SbClock.extOf("noext"))
        assertTrue(SbClock.isMedia("Mix.Final.FLAC"))
        assertFalse(SbClock.isMedia(".secret.mp3"))
        assertFalse(SbClock.isMedia("notes.txt"))
    }
    @Test fun contentTypesFromTheContract() {
        assertEquals("audio/mpeg", SbClock.mimeOf("mp3")); assertEquals("audio/mp4", SbClock.mimeOf("m4a")); assertEquals("audio/aac", SbClock.mimeOf("aac"))
        assertEquals("audio/wav", SbClock.mimeOf("wav")); assertEquals("audio/aiff", SbClock.mimeOf("aif")); assertEquals("audio/aiff", SbClock.mimeOf("aiff"))
        assertEquals("audio/flac", SbClock.mimeOf("flac")); assertEquals("audio/ogg", SbClock.mimeOf("ogg")); assertEquals("audio/ogg", SbClock.mimeOf("oga"))
        assertEquals("audio/opus", SbClock.mimeOf("opus")); assertEquals("audio/x-caf", SbClock.mimeOf("caf"))
        assertEquals("video/mp4", SbClock.mimeOf("mp4")); assertEquals("video/mp4", SbClock.mimeOf("M4V")); assertEquals("video/quicktime", SbClock.mimeOf("mov"))
        assertEquals("video/webm", SbClock.mimeOf("webm")); assertEquals("video/x-matroska", SbClock.mimeOf("mkv")); assertEquals("video/3gpp", SbClock.mimeOf("3gp"))
        assertEquals("application/octet-stream", SbClock.mimeOf("exe"))
    }

    // ---------- names ----------
    @Test fun aClashGetsTwoThenThree() {
        assertEquals("Song.mp3", SbClock.freeName("Song.mp3", setOf("other.mp3")))
        assertEquals("Song 2.mp3", SbClock.freeName("Song.mp3", setOf("song.mp3")))
        assertEquals("Song 3.mp3", SbClock.freeName("Song.mp3", setOf("song.mp3", "song 2.mp3")))
        assertEquals("Song 2", SbClock.freeName("Song", setOf("song")))
        assertEquals("My.Mix 2.flac", SbClock.freeName("My.Mix.flac", setOf("my.mix.flac")))
    }
    @Test fun namesAreSafeAndShort() {
        assertEquals("Song", SbClock.baseName("Song.mp3"))
        assertEquals(".mp3", SbClock.baseName(".mp3"))   // as the page's baseName: a leading dot is not an extension
        assertEquals("a b c.mp3", SbClock.fileName("a/b:c", "MP3"))
        assertEquals("hidden.wav", SbClock.fileName("..hidden", "wav"))
        assertEquals("Untitled.ogg", SbClock.fileName("  ", "ogg"))
        assertEquals("A long dash", SbClock.oneLine("A\u2014long\ndash", 120))
        assertEquals(120, SbClock.oneLine("x".repeat(500), 120).length)
        assertEquals("Gym mix/Old/Deep/Deeper", SbClock.cleanFolder(listOf("Gym mix", "Old", "Deep", "Deeper", "Too deep")))
    }
    @Test fun onlySafeRelativePaths() {
        assertEquals("Mix/a.mp3", SbClock.cleanRel("Mix/a.mp3"))
        assertEquals("a.mp4", SbClock.cleanRel("a.mp4"))
        assertNull(SbClock.cleanRel("../a.mp3"))
        assertNull(SbClock.cleanRel("Mix/../a.mp3"))
        assertNull(SbClock.cleanRel("/a.mp3"))
        assertNull(SbClock.cleanRel(".hidden/a.mp3"))
        assertNull(SbClock.cleanRel("a.txt"))
        assertNull(SbClock.cleanRel("1/2/3/4/5/a.mp3"))
        assertEquals("1/2/3/4/a.mp3", SbClock.cleanRel("1/2/3/4/a.mp3"))
    }
    @Test fun idsAre16Hex() {
        repeat(50) { assertTrue(SbClock.okId(SbClock.newId())) }
        assertFalse(SbClock.okId("0123456789ABCDEF"))
        assertFalse(SbClock.okId("0123"))
    }

    // ---------- the index ----------
    @Test fun indexRoundTripsAndDropsBadEntries() {
        val text = JSONObject().put("v", 1).put("items", JSONArray()
            .put(JSONObject().put("id", "00000000000000a1").put("path", "Mix/a.mp3").put("name", "A song").put("added", 5))
            .put(JSONObject().put("id", "00000000000000a1").put("path", "b.mp3").put("name", "same id"))
            .put(JSONObject().put("id", "00000000000000a2").put("path", "MIX/A.mp3").put("name", "same path"))
            .put(JSONObject().put("id", "00000000000000a3").put("path", "../x.mp3"))
            .put(JSONObject().put("id", "nothex").put("path", "c.mp3"))
            .put(JSONObject().put("id", "00000000000000a4").put("path", "c.mov"))).toString()
        val ix = SbClock.parseIndex(text, ownDefault = true)
        val items = ix.items
        assertEquals(listOf("Mix/a.mp3", "c.mov"), items.map { it.path })
        assertEquals("c", items[1].name)
        assertEquals(ix, SbClock.parseIndex(SbClock.indexJson(ix), ownDefault = false))
        assertTrue(SbClock.parseIndex("not json", true).items.isEmpty())
        assertTrue(SbClock.parseIndex(null, true).items.isEmpty())
    }

    // ---------- PS only ever deletes files PS itself put there ----------
    @Test fun ownFlagFromTheIndexAndAdoptedFilesAreNotOwn() {
        val text = JSONObject().put("v", 1).put("items", JSONArray()
            .put(JSONObject().put("id", "00000000000000a1").put("path", "old.mp3"))                       // from before "own"
            .put(JSONObject().put("id", "00000000000000a2").put("path", "mine.mp3").put("own", true))
            .put(JSONObject().put("id", "00000000000000a3").put("path", "found.mp3").put("own", false)))
            .put("ignored", JSONArray(listOf("skip.mp3", "../bad.mp3"))).toString()
        // An entry without the field is own in PS's private folder, not in a picked folder.
        assertEquals(listOf(true, true, false), SbClock.parseIndex(text, ownDefault = true).items.map { it.own })
        assertEquals(listOf(false, true, false), SbClock.parseIndex(text, ownDefault = false).items.map { it.own })
        assertEquals(listOf("skip.mp3"), SbClock.parseIndex(text, true).ignored)
        // A file the index did not know is adopted (own false); an ignored one is not added back.
        val ix = SbClock.parseIndex(text, false)
        val r = SbClock.reconcile(ix.items, mapOf("old.mp3" to 1L, "mine.mp3" to 1L, "found.mp3" to 1L, "skip.mp3" to 1L, "new.mp3" to 1L), 5, ids, ix.ignored)
        assertEquals(listOf("old.mp3", "mine.mp3", "found.mp3", "new.mp3"), r.items.map { it.path })
        assertFalse(r.items.last().own)
        assertEquals(listOf("skip.mp3"), r.ignored)
        // An ignored file that is gone leaves the ignored list.
        val gone = SbClock.reconcile(r.items, mapOf("old.mp3" to 1L, "mine.mp3" to 1L, "found.mp3" to 1L, "new.mp3" to 1L), 6, ids, r.ignored)
        assertTrue(gone.ignored.isEmpty()); assertTrue(gone.changed)
    }
    @Test fun aMoveDeletesOnlyOwnFilesFromTheOldPlace() {
        val old = listOf(SbClock.Entry("00000000000000a1", "mine.mp3", "Mine", 1, own = true),
            SbClock.Entry("00000000000000a2", "Music/found.mp3", "Found", 2, own = false))
        val there = listOf(SbClock.Entry("00000000000000b1", "theirs.mp3", "Theirs", 3, own = false))
        val p = SbClock.movePlan(old, there, setOf("theirs.mp3"), ids)
        // Both are copied, and every copy PS made is own in the new place; what was there keeps its flag.
        assertEquals(listOf("mine.mp3", "Music/found.mp3"), p.copies.map { it.from })
        assertTrue(p.index.filter { it.id.startsWith("00000000000000a") }.all { it.own })
        assertFalse(p.index.first { it.id == "00000000000000b1" }.own)
        // From the old place only the own file goes; the adopted one stays untouched.
        assertEquals(listOf("mine.mp3"), SbClock.deleteAfterMove(old))
    }
    @Test fun removeDeletesOwnFilesButOnlyForgetsAdoptedOnes() {
        val items = listOf(SbClock.Entry("00000000000000a1", "mine.mp3", "Mine", 1, own = true),
            SbClock.Entry("00000000000000a2", "found.mp3", "Found", 2, own = false),
            SbClock.Entry("00000000000000a3", "keep.mp3", "Keep", 3, own = false))
        val r = SbClock.removePlan(items, listOf("earlier.mp3"), setOf("00000000000000a1", "00000000000000a2"))
        assertEquals(listOf("keep.mp3"), r.items.map { it.path })
        assertEquals(listOf("mine.mp3"), r.delete)
        assertEquals(listOf("earlier.mp3", "found.mp3"), r.ignored)
        // The next scan does not bring the removed adopted file back.
        val again = SbClock.reconcile(r.items, mapOf("keep.mp3" to 1L, "found.mp3" to 1L, "earlier.mp3" to 1L), 9, ids, r.ignored)
        assertEquals(listOf("keep.mp3"), again.items.map { it.path })
        // The index file keeps the list.
        assertEquals(listOf("earlier.mp3", "found.mp3"), SbClock.parseIndex(SbClock.indexJson(SbClock.Index(r.items, r.ignored)), false).ignored)
    }
    @Test fun reconcileDropsGoneFilesAndAddsNewOnes() {
        val index = listOf(SbClock.Entry("00000000000000a1", "Mix/a.mp3", "A", 1), SbClock.Entry("00000000000000a2", "gone.mp3", "Gone", 2))
        val r = SbClock.reconcile(index, mapOf("mix/A.mp3" to 10L, "new.wav" to 5L), 99, ids)
        assertTrue(r.changed)
        assertEquals(listOf("mix/A.mp3", "new.wav"), r.items.map { it.path })
        assertEquals("00000000000000a1", r.items[0].id)   // same file in another case keeps its id
        assertEquals("new", r.items[1].name); assertEquals(99L, r.items[1].added)
        val same = SbClock.reconcile(r.items, mapOf("mix/A.mp3" to 10L, "new.wav" to 5L), 100, ids)
        assertFalse(same.changed)
    }

    // ---------- the safe move plan ----------
    @Test fun moveCopiesEverythingWithItsPath() {
        val old = listOf(SbClock.Entry("00000000000000a1", "Mix/a.mp3", "A", 1), SbClock.Entry("00000000000000a2", "b.mp4", "B", 2))
        val p = SbClock.movePlan(old, emptyList(), emptySet(), ids)
        assertEquals(listOf("Mix/a.mp3", "b.mp4"), p.copies.map { it.to })
        assertEquals(old, p.index)
    }
    @Test fun moveIntoAFolderWithASoundboardMergesAndRenamesClashes() {
        val old = listOf(SbClock.Entry("00000000000000a1", "Mix/a.mp3", "A", 1), SbClock.Entry("00000000000000a2", "b.mp4", "B", 2))
        val there = listOf(SbClock.Entry("00000000000000b1", "mix/A.mp3", "Theirs", 3), SbClock.Entry("00000000000000a2", "other.mp3", "Id clash", 4))
        val p = SbClock.movePlan(old, there, setOf("mix/A.mp3", "other.mp3", "Mix/a 2.mp3"), ids)
        assertEquals(listOf("Mix/a 3.mp3", "b.mp4"), p.copies.map { it.to })
        assertEquals(4, p.index.size)
        // Ours keep their ids (the timed plays point at them); theirs with the same id gets a fresh one.
        assertEquals("Mix/a 3.mp3", p.index.first { it.id == "00000000000000a1" }.path)
        assertEquals("b.mp4", p.index.first { it.id == "00000000000000a2" }.path)
        val clash = p.index.first { it.path == "other.mp3" }
        assertTrue(clash.id != "00000000000000a2" && SbClock.okId(clash.id))
        assertEquals(p.index.size, p.index.map { it.id }.toSet().size)
    }
    @Test fun moveSkipsWhatIsAlreadyThere() {
        val old = listOf(SbClock.Entry("00000000000000a1", "a.mp3", "A", 1))
        val p = SbClock.movePlan(old, listOf(SbClock.Entry("00000000000000a1", "A.mp3", "A", 1)), setOf("A.mp3"), ids)
        assertTrue(p.copies.isEmpty())
        assertEquals(listOf("00000000000000a1"), p.index.map { it.id })
    }
    @Test fun aPickedFolderMustNotBeInsideOrAroundTheCurrentOne() {
        assertTrue(SbClock.nested("primary:Music", "primary:Music"))
        assertTrue(SbClock.nested("primary:Music", "primary:Music/Sounds"))
        assertTrue(SbClock.nested("primary:Music/Sounds", "primary:Music"))
        assertTrue(SbClock.nested("primary:", "primary:Music"))
        assertFalse(SbClock.nested("primary:Music", "primary:Music2"))
        assertFalse(SbClock.nested("primary:Music", "1A2B-3C4D:Music"))
    }
    @Test fun readableLabelsNeverAFullPath() {
        assertEquals("Internal storage > Music > Sounds", SbClock.treeLabel("primary:Music/Sounds", "Sounds"))
        assertEquals("Internal storage", SbClock.treeLabel("primary:", null))
        assertEquals("SD card or USB > Music", SbClock.treeLabel("1A2B-3C4D:Music", "Music"))
        assertEquals("Internal storage > ... > c > d", SbClock.treeLabel("primary:a/b/c/d", "d"))
        assertEquals("Cloud box", SbClock.treeLabel("some-other-id", "Cloud box"))
        assertEquals("Your chosen folder", SbClock.treeLabel("x", null))
    }

    // ---------- byte ranges ----------
    @Test fun rangesForThePlayer() {
        assertEquals(SbClock.Serve(200, 0, 1000, null), SbClock.serve(null, 1000))
        assertEquals(SbClock.Serve(206, 0, 2, "bytes 0-1/1000"), SbClock.serve("bytes=0-1", 1000))
        assertEquals(SbClock.Serve(206, 500, 500, "bytes 500-999/1000"), SbClock.serve("bytes=500-", 1000))
        assertEquals(SbClock.Serve(206, 900, 100, "bytes 900-999/1000"), SbClock.serve("bytes=-100", 1000))
        assertEquals(SbClock.Serve(206, 990, 10, "bytes 990-999/1000"), SbClock.serve("bytes=990-5000", 1000))
        assertEquals(416, SbClock.serve("bytes=1000-", 1000).status)
        assertEquals("bytes */1000", SbClock.serve("bytes=1000-", 1000).contentRange)
        assertEquals(200, SbClock.serve("items=0-1", 1000).status)
        // Over 4 GB of video still has exact numbers.
        val big = 5L * 1024 * 1024 * 1024
        assertEquals(SbClock.Serve(206, big - 10, 10, "bytes ${big - 10}-${big - 1}/$big"), SbClock.serve("bytes=${big - 10}-", big))
    }

    // ---------- sb:read and sb:put ----------
    @Test fun squadPiecesOnlyAudioUpTo10Mb() {
        assertEquals(0L to 1024, SbClock.readSpan("audio", 5000, 0, 1024))
        assertEquals(4096L to 904, SbClock.readSpan("audio", 5000, 4096, 1024))
        assertNull(SbClock.readSpan("video", 5000, 0, 1024))
        assertNull(SbClock.readSpan("audio", SbClock.SHARE_MAX + 1, 0, 1024))
        assertNull(SbClock.readSpan("audio", 5000, 0, SbClock.CHUNK_MAX + 1))
        assertNull(SbClock.readSpan("audio", 5000, 5000, 10))
        assertTrue(SbClock.putOk("0123456789abcdef", "mp3", 0, 0, 1000))
        assertTrue(SbClock.putOk("0123456789abcdef", "OGG", 1000, 1000, 1000))
        assertFalse(SbClock.putOk("0123456789abcdef", "mp4", 0, 0, 1000))
        assertFalse(SbClock.putOk("0123456789abcdef", "mp3", 500, 1000, 1000))
        assertFalse(SbClock.putOk("../x", "mp3", 0, 0, 1000))
        assertFalse(SbClock.putOk("0123456789abcdef", "mp3", SbClock.SHARE_MAX - 10, SbClock.SHARE_MAX - 10, 11))
    }

    // ---------- timed plays ----------
    @Test fun planParsingKeepsGoodItems() {
        val items = JSONArray()
            .put(JSONObject().put("id", "p1").put("media", "0123456789abcdef").put("name", "Wake").put("at", "07:07").put("days", JSONArray(listOf(1, 2, 9))).put("vol", 3).put("loop", true))
            .put(JSONObject().put("id", "p2").put("media", "nope").put("at", "07:07"))
            .put(JSONObject().put("id", "p3").put("media", "0123456789abcdef").put("at", "25:00"))
            .put(JSONObject().put("id", "p1").put("media", "0123456789abcdef").put("at", "08:00"))
        val p = SbClock.parsePlan(items)
        assertEquals(1, p.size)
        assertEquals(listOf(1, 2), p[0].days); assertEquals(1.0, p[0].vol, 0.0); assertTrue(p[0].loop)
        assertEquals(p, SbClock.parsePlan(SbClock.planJson(p)))
        assertEquals((0..6).toList(), SbClock.parsePlan(JSONArray().put(JSONObject().put("id", "x").put("media", "0123456789abcdef").put("at", "07:07"))).single().days)
    }
    @Test fun nextFireIsTodayOrTheNextPickedDay() {
        // Tuesday 10 Nov 2026, London (GMT).
        val now = at("2026-11-10T06:00:00Z")
        assertEquals(at("2026-11-10T07:07:00Z"), SbClock.nextFire(play("07:07"), now, LON))
        assertEquals(at("2026-11-11T05:00:00Z"), SbClock.nextFire(play("05:00"), now, LON))
        assertEquals(at("2026-11-13T07:07:00Z"), SbClock.nextFire(play("07:07", listOf(5)), now, LON))   // Friday
        assertEquals(-1L, SbClock.nextFire(play("07:07", emptyList()), now, LON))
        // Exactly at the time: the next one, never the same one again.
        assertEquals(at("2026-11-11T07:07:00Z"), SbClock.nextFire(play("07:07"), at("2026-11-10T07:07:00Z"), LON))
    }
    @Test fun acrossMidnight() {
        // Saturday 14 Nov 2026 23:50 London: a Sunday 00:05 play is 15 minutes away, a Saturday 23:59 one is 9 minutes.
        val now = at("2026-11-14T23:50:00Z")
        assertEquals(at("2026-11-15T00:05:00Z"), SbClock.nextFire(play("00:05", listOf(0)), now, LON))
        assertEquals(at("2026-11-14T23:59:00Z"), SbClock.nextFire(play("23:59", listOf(6)), now, LON))
        // Just after midnight on Sunday: Saturday 23:59 is six days away.
        assertEquals(at("2026-11-21T23:59:00Z"), SbClock.nextFire(play("23:59", listOf(6)), at("2026-11-15T00:01:00Z"), LON))
    }
    @Test fun springForwardPlaysAfterTheJump() {
        // 29 Mar 2026: London goes 01:00 GMT to 02:00 BST, so 01:30 does not exist that day (tz.ts zonedToTs: 02:30 BST).
        val t = SbClock.nextFire(play("01:30"), at("2026-03-29T00:00:00Z"), LON)
        assertEquals(at("2026-03-29T02:30:00+01:00"), t)
        // The day after is normal again.
        assertEquals(at("2026-03-30T01:30:00+01:00"), SbClock.nextFire(play("01:30"), t, LON))
        // 07:07 on the change day is 07:07 BST.
        assertEquals(at("2026-03-29T07:07:00+01:00"), SbClock.nextFire(play("07:07"), at("2026-03-29T00:00:00Z"), LON))
    }
    @Test fun fallBackPlaysOnce() {
        // 1 Nov 2026 New York: 01:30 happens twice. It plays once that day, then the next day.
        val first = SbClock.nextFire(play("01:30"), at("2026-11-01T00:00:00-04:00"), NY)
        assertTrue(first == at("2026-11-01T01:30:00-04:00") || first == at("2026-11-01T01:30:00-05:00"))
        assertEquals(at("2026-11-02T01:30:00-05:00"), SbClock.nextFire(play("01:30"), first, NY))
    }
    @Test fun dueRingsOneAndCountsTheRest() {
        val a = play("07:07", id = "a"); val b = play("07:07", id = "b"); val c = play("07:06", id = "c")
        val now = at("2026-11-10T07:07:00Z")
        val d = SbClock.due(listOf(a, b, c), now, LON, emptySet())
        assertEquals("b", d.ring?.id)   // the latest time, the last in the list
        assertEquals(3, d.fired.size)
        assertNull(SbClock.due(listOf(a, b, c), now, LON, d.fired.toSet()).ring)
        // Delivered 5 minutes late: too late, nothing rings.
        assertNull(SbClock.due(listOf(a), at("2026-11-10T07:12:00Z"), LON, emptySet()).ring)
        // A minute early: not yet.
        assertNull(SbClock.due(listOf(a), at("2026-11-10T07:06:00Z"), LON, emptySet()).ring)
        // soonest after it rang: tomorrow.
        assertEquals(at("2026-11-11T07:06:00Z"), SbClock.soonest(listOf(a, b, c), now, LON))
    }
    @Test fun firedKeysAreKeptTwoDays() {
        val now = at("2026-11-10T07:07:00Z")
        val keep = SbClock.prune(setOf("a@${now - 3_600_000}", "b@${now - 3 * 86_400_000L}", "junk"), now)
        assertEquals(setOf("a@${now - 3_600_000}"), keep)
    }
}
