package com.cincee.ps.gos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class IslandSpringTest {
    @Test fun theSpringStartsAtZeroOvershootsAndEndsAtExactlyOne() {
        assertEquals(0f, IslandSpring.spring(0f), 0f)
        assertEquals(1f, IslandSpring.spring(1f), 0f)
        val peak = (1..99).maxOf { IslandSpring.spring(it / 100f) }
        assertTrue("overshoots", peak > 1.03f)
        assertTrue("not wildly", peak < 1.15f)
        assertTrue("settled by the end", (95..99).all { Math.abs(IslandSpring.spring(it / 100f) - 1f) < 0.03f })
    }

    @Test fun theGrowthWaitsForTheSqueezeThenSprings() {
        assertEquals(0f, IslandSpring.grow(0f, false), 0f)
        assertEquals(0f, IslandSpring.grow(IslandSpring.SQUEEZE_END, false), 0f)
        assertEquals(1f, IslandSpring.grow(1f, false), 0f)
        assertTrue(IslandSpring.grow(0.5f, false) > 0.5f)
        assertTrue((1..99).any { IslandSpring.grow(it / 100f, false) > 1f })
    }

    @Test fun theSqueezeShrinksATouchThenLetsGo() {
        assertEquals(1f, IslandSpring.squeeze(0f, false), 0f)
        val low = (1 until 16).minOf { IslandSpring.squeeze(it / 100f, false) }
        assertTrue(low < 0.96f && low > 0.9f)
        assertEquals(1f, IslandSpring.squeeze(0.5f, false), 0f)
        assertEquals(1f, IslandSpring.squeeze(1f, false), 0f)
    }

    @Test fun reducedMotionIsAPlainSlideWithNoSqueezeAndAFinishedTick() {
        for (i in 0..10) { val t = i / 10f; assertEquals(t, IslandSpring.grow(t, true), 0f); assertEquals(1f, IslandSpring.squeeze(t / 5, true), 0f) }
        assertEquals(1f to 1f, IslandSpring.tick(0, true))
    }

    @Test fun theTickSweepsTheRingThenDrawsTheCheck() {
        assertEquals(0f to 0f, IslandSpring.tick(0, false))
        val mid = IslandSpring.tick(400, false)
        assertTrue(mid.first > 0f && mid.first < 1f); assertEquals(0f, mid.second, 0f)
        val end = IslandSpring.tick(5_000, false)
        assertEquals(1f to 1f, end)
        assertEquals(0f to 0f, IslandSpring.tick(-100, false))
    }
}
