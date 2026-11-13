package com.cincee.ps.gos

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.security.SecureRandom

/**
 * Local first (V1.44): the key that opens a new person's local vault (web src/core/localstore.ts), 32
 * random bytes sealed with the device key in the Keystore (Keys.kt), in the app's private storage. There is no
 * password in local mode, so this file is a way into the data: PS never replaces it, and removes it only when the
 * page asks after a verified move to sync and the person's confirm. A file that is there but cannot be opened answers
 * "denied", never "missing", so the page never makes a new key over it (the browser's own key opens the vault too).
 * Runs on the bridge thread only (every Keystore call goes through Keys.gate). The key is never logged.
 */
object LocalKey {
    private const val NAME = "localvault.key"
    private fun f(c: Context): File = Keys.file(c, NAME)
    private fun st(s: String) = JSONObject().put("status", s)

    fun answer(c: Context, op: String): JSONObject = when (op) {
        "get", "allow" -> {
            if (!f(c).exists()) st("missing")
            else Keys.read(c, NAME)?.takeIf { runCatching { Keys.unb64(it).size == 32 }.getOrDefault(false) }?.let { st("ok").put("key", it) } ?: st("denied")
        }
        "create" -> {
            if (f(c).exists()) st("error").put("error", "A key is already there.")
            else {
                val key = Keys.b64(ByteArray(32).also { SecureRandom().nextBytes(it) })
                // Written whole to a new file, then moved into place: a cut off write never leaves half a key there.
                val tmp = File(f(c).parentFile, "$NAME.new")
                tmp.writeBytes(Keys.seal(key.toByteArray()))
                if (!tmp.renameTo(f(c))) { tmp.delete(); st("error").put("error", "The phone could not keep the key.") }
                else if (Keys.read(c, NAME) == key) st("ok").put("key", key)
                else st("error").put("error", "The phone could not keep the key.")
            }
        }
        "forget" -> { f(c).delete(); Plog.i("local key: removed"); st("missing") }
        else -> st("error").put("error", "unknown")
    }
}

/**
 * Export my data (V1.44): the page's encrypted backup file into the phone's Downloads folder (MediaStore, no
 * permission needed for the app's own file). The text is already encrypted with the person's file passphrase; nothing
 * here reads it. Answers {type:"file:saved", ok, name}.
 */
object BackupSave {
    fun save(c: Context, name: String, text: String): JSONObject {
        val safe = name.replace(Regex("[^A-Za-z0-9 ._-]"), "").take(80).ifEmpty { "PS backup.psbackup" }
        val out = JSONObject().put("type", "file:saved").put("name", safe)
        if (text.length > 150_000_000 || !text.startsWith("{\"format\":\"ps-backup\"")) return out.put("ok", false)
        return runCatching {
            val v = android.content.ContentValues().apply {
                put(android.provider.MediaStore.Downloads.DISPLAY_NAME, safe)
                put(android.provider.MediaStore.Downloads.MIME_TYPE, "application/octet-stream")
                put(android.provider.MediaStore.Downloads.IS_PENDING, 1)
            }
            val r = c.contentResolver
            val uri = r.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, v) ?: error("no uri")
            r.openOutputStream(uri)?.use { it.write(text.toByteArray()) } ?: error("no stream")
            r.update(uri, android.content.ContentValues().apply { put(android.provider.MediaStore.Downloads.IS_PENDING, 0) }, null, null)
            Plog.i("backup: saved to Downloads")
            out.put("ok", true)
        }.getOrElse { Plog.i("backup: save failed ${it.javaClass.simpleName}"); out.put("ok", false) }
    }
}
