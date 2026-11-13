package com.cincee.ps.gos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The phone's "already shown" ledger (NoteLedger.kt): one notification per card revision, across the
 * page's minute resync, background checks and restarts. Fictional ids only.
 */
class NoteLedgerTest {
    private val day = 86_400_000L
    private val t0 = 1_793_448_000_000L
    /** Stand in for SharedPreferences: survives a "restart" (a new NoteLedger on the same store). */
    private class Store { var text: String? = null; var writes = 0 }
    private fun ledger(s: Store, keep: Long = 60 * day, max: Int = 500) = NoteLedger({ s.text }, { s.text = it; s.writes++ }, keep, max)

    /** What the shell does with each card from the page; returns how many notifications came up (with sound). */
    private fun post(l: NoteLedger, shade: MutableSet<String>, id: String, rev: String, now: Long): Int =
        when (l.decide(id, rev, id in shade, now)) {
            NoteLedger.Act.NEW -> { shade.add(id); 1 }
            NoteLedger.Act.UPDATE -> 0                // replaced in place, quietly
            NoteLedger.Act.SKIP -> 0
        }

    @Test fun sameItemTwiceGivesOneNotification() {
        val s = Store(); val l = ledger(s); val shade = mutableSetOf<String>()
        val id = "n:em-0001"; val rev = "2026-11-02T10:00:00.000Z|"
        // The webhook, then the minute feed, then the page's minute resync: the same email three times.
        val shown = post(l, shade, id, rev, t0) + post(l, shade, id, rev, t0 + 1_000) + post(l, shade, id, rev, t0 + 60_000)
        assertEquals(1, shown)
        // The developer swipes it away: the next resync does not bring it back.
        shade.remove(id)
        assertEquals(0, post(l, shade, id, rev, t0 + 120_000))
        assertEquals(NoteLedger.Act.SKIP, l.decide(id, rev, false, t0 + 180_000))
    }

    @Test fun restartWithAnAlreadySeenItemGivesNone() {
        val s = Store()
        assertEquals(NoteLedger.Act.NEW, ledger(s).decide("m:reply-42", "2026-11-02T09:00:00.000Z|", false, t0))
        // PS restarts (or a background check builds a fresh page): a new ledger on the same storage.
        val after = ledger(s)
        assertEquals(NoteLedger.Act.SKIP, after.decide("m:reply-42", "2026-11-02T09:00:00.000Z|", false, t0 + 3_600_000))
        // Still in the shade after the restart: updated in place, no sound.
        assertEquals(NoteLedger.Act.UPDATE, after.decide("m:reply-42", "2026-11-02T09:00:00.000Z|", true, t0 + 3_600_000))
    }

    @Test fun aNewRevisionShowsAgain() {
        val s = Store(); val l = ledger(s)
        assertEquals(NoteLedger.Act.NEW, l.decide("m:reply-42", "2026-11-02T09:00:00.000Z|", false, t0))
        // A newer email in the same thread: same card id, new revision, so it shows (with sound) even if still in the shade.
        assertEquals(NoteLedger.Act.NEW, l.decide("m:reply-42", "2026-11-02T11:00:00.000Z|", true, t0 + 1_000))
        // Remind me in 15 mins came due: a new revision too.
        assertEquals(NoteLedger.Act.NEW, l.decide("m:reply-42", "2026-11-02T11:00:00.000Z|2026-11-02T11:20:00.000Z", false, t0 + 2_000))
    }

    @Test fun writtenBeforeItIsShown() {
        val s = Store(); val l = ledger(s)
        val before = s.writes
        assertEquals(NoteLedger.Act.NEW, l.decide("c:chat-7", "x", false, t0))
        assertEquals(before + 1, s.writes)
        assertTrue(s.text!!.contains("c:chat-7|x"))
        // A repeat writes nothing.
        l.decide("c:chat-7", "x", true, t0 + 1)
        assertEquals(before + 1, s.writes)
    }

    @Test fun keptSmallByAgeAndCount() {
        val s = Store(); val l = ledger(s, keep = 10 * day, max = 50)
        for (i in 0 until 40) l.decide("n:old-$i", "", false, t0 + i)
        // Eleven days later the old ones are gone; a new one is all that is left.
        l.decide("n:new", "", false, t0 + 11 * day)
        assertEquals(1, l.size())
        for (i in 0 until 120) l.decide("n:many-$i", "", false, t0 + 11 * day + i)
        assertEquals(50, l.size())
        // The newest are the ones kept, and a fresh read of the storage agrees.
        assertEquals(NoteLedger.Act.SKIP, ledger(s, keep = 10 * day, max = 50).decide("n:many-119", "", false, t0 + 11 * day + 200))
        assertEquals(50, ledger(s, keep = 10 * day, max = 50).size())
    }

    @Test fun oddCharactersNeverBreakTheStorage() {
        val s = Store(); val l = ledger(s)
        l.decide("n:a\tb", "line\nbreak", false, t0)
        assertEquals(NoteLedger.Act.SKIP, ledger(s).decide("n:a\tb", "line\nbreak", false, t0 + 1))
        assertEquals(1, ledger(s).size())
    }

    @Test fun swipedAwayStaysGoneAndIsADismiss() {
        // Client emails, lead replies and chats: a swipe is the developer's Dismiss (sent to the vault, so the Mac clears too).
        assertEquals(true, NoteLedger.swipeDismisses("m:r1"))
        assertEquals(true, NoteLedger.swipeDismisses("n:em1"))
        assertEquals(true, NoteLedger.swipeDismisses("c:chat1"))
        assertEquals(false, NoteLedger.swipeDismisses("b:meet1"))
        // The page keeps re-sending it until the Dismiss lands: never back in the shade, also after a restart.
        val s = Store(); val l = ledger(s)
        assertEquals(NoteLedger.Act.NEW, l.decide("n:em1", "", false, t0))
        assertEquals(NoteLedger.Act.SKIP, l.decide("n:em1", "", false, t0 + 60_000))
        assertEquals(NoteLedger.Act.SKIP, ledger(s).decide("n:em1", "", false, t0 + 120_000))
        // Remind me in coming due is one new revision: shown once, then left alone.
        assertEquals(NoteLedger.Act.NEW, ledger(s).decide("n:em1", "2026-11-03T12:15:00.000Z", false, t0 + 900_000))
        assertEquals(NoteLedger.Act.SKIP, ledger(s).decide("n:em1", "2026-11-03T12:15:00.000Z", false, t0 + 960_000))
    }
}
