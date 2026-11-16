package com.cincee.ps.gos

import org.junit.Assert.assertEquals
import org.junit.Test

class ReceiptTextTest {
    @Test fun squeezesSpacesAndDropsEmptyLines() {
        val t = ReceiptText.compose(listOf(ReceiptText.Line("  Nikora   Market ", 90f), ReceiptText.Line("   ", 80f), ReceiptText.Line("Milk 3.20", 88f)))
        assertEquals("Nikora Market\nMilk 3.20", t)
    }
    @Test fun keepsGeorgianAndDropsNoise() {
        val t = ReceiptText.compose(listOf(ReceiptText.Line("სულ 12.50", 70f), ReceiptText.Line("-- ~", 5f)))
        assertEquals("სულ 12.50", t)
    }
    @Test fun confidenceIsTheAverageOfRealLines() {
        assertEquals(80f, ReceiptText.confidence(listOf(ReceiptText.Line("a1", 70f), ReceiptText.Line("b2", 90f), ReceiptText.Line("--", 0f))), 0.01f)
        assertEquals(0f, ReceiptText.confidence(emptyList()), 0.01f)
    }
}
