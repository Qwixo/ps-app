package com.cincee.ps.gos

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Add Telegram Bot (V1.47): the key check, the method allowlist, the request the phone builds and the answer the page
 * gets, against a FAKE Telegram. A made up key only; nothing here reaches the network or the Keystore.
 */
class TgCoreTest {
    private val fake = "1234567890:AAFakeFakeFakeFakeFakeFakeFakeFake12"   // made up

    @Test fun keys() {
        assertTrue(TgCore.validToken(fake))
        assertFalse(TgCore.validToken("hello"))
        assertFalse(TgCore.validToken("$fake/../x"))
        assertFalse(TgCore.validToken(null))
        assertTrue(TgCore.validId("t1abc")); assertFalse(TgCore.validId("a b"))
    }

    @Test fun onlyTheseMethodsAndOnlyTelegram() {
        assertNull(TgCore.request(fake, "deleteWebhook", null))
        assertNull(TgCore.request(fake, "setWebhook", null))
        assertNull(TgCore.request("x", "getMe", null))
        val r = TgCore.request(fake, "getUpdates", JSONObject().put("timeout", 300).put("offset", 5))!!
        assertEquals("https://api.telegram.org/bot$fake/getUpdates", r.url)
        assertEquals(30, JSONObject(r.body).getInt("timeout"))
        assertEquals(5, JSONObject(r.body).getInt("offset"))
        assertEquals(45_000, r.readTimeoutMs)
    }

    @Test fun relayAnswersAndNeverLeaksTheKey() {
        val asked = mutableListOf<TgCore.Req>()
        val ok = TgHttp { r -> asked += r; 200 to """{"ok":true,"result":[]}""" }
        val a = TgBot.call(null, "t1", "getUpdates", JSONObject().put("timeout", 25), ok) { fake }
        assertEquals("tg:res", a.getString("type")); assertEquals(200, a.getInt("status"))
        assertTrue(a.getString("body").contains("\"ok\":true"))
        assertEquals(1, asked.size)

        val conflict = TgHttp { 409 to """{"ok":false,"error_code":409,"description":"Conflict"}""" }
        assertTrue(TgBot.call(null, "t2", "getUpdates", null, conflict) { fake }.getString("body").contains("409"))

        val down = TgHttp { throw java.io.IOException("failed to connect to https://api.telegram.org/bot$fake/getMe") }
        val e = TgBot.call(null, "t3", "getMe", null, down) { fake }
        assertFalse(e.toString().contains(fake)); assertFalse(e.toString().contains("AAFake"))
        assertEquals("network IOException", e.getString("error"))

        val none = TgBot.call(null, "t4", "getMe", null, ok) { null }
        assertTrue(none.getBoolean("noKey"))
        val blocked = TgBot.call(null, "t5", "deleteWebhook", null, ok) { fake }
        assertEquals("not allowed", blocked.getString("error"))
        assertEquals(1, asked.size)   // neither of the last two reached the network
    }
}
