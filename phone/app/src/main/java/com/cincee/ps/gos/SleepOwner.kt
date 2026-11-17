package com.cincee.ps.gos

import android.app.KeyguardManager
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import org.json.JSONObject

/**
 * V1.65 "Just tomorrow": the owner check. The phone's own fingerprint, face, PIN, pattern or password (BIOMETRIC_STRONG or
 * DEVICE_CREDENTIAL), asked one at a time. The clock uses it before a choice goes to the page; Settings in the app asks for it
 * with {type:"sleep:auth", id, reason} and gets {type:"sleep:auth", id, ok, none?} back. Main thread only.
 */
object SleepOwner {
    private var busy = false
    private const val ANY = BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL

    /** The phone has no screen lock at all (no PIN, pattern, password or fingerprint to ask for). */
    fun noLock(a: FragmentActivity): Boolean = !a.getSystemService(KeyguardManager::class.java).isDeviceSecure

    /** Shows the system prompt titled `reason`. `done(ok, none)`: ok true when passed; none true when there is no screen lock. */
    fun ask(a: FragmentActivity, reason: String, done: (Boolean, Boolean) -> Unit) {
        if (busy) { done(false, false); return }
        if (noLock(a)) { done(false, true); return }
        if (BiometricManager.from(a).canAuthenticate(ANY) != BiometricManager.BIOMETRIC_SUCCESS) { done(false, false); return }
        busy = true
        var answered = false
        fun end(ok: Boolean) { if (answered) return; answered = true; busy = false; done(ok, false) }
        val title = reason.ifBlank { a.applicationInfo.loadLabel(a.packageManager).toString() }
        val info = BiometricPrompt.PromptInfo.Builder().setTitle(title).setAllowedAuthenticators(ANY).build()
        runCatching {
            BiometricPrompt(a, ContextCompat.getMainExecutor(a), object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(r: BiometricPrompt.AuthenticationResult) { end(true) }
                override fun onAuthenticationError(code: Int, msg: CharSequence) { end(false) }
            }).authenticate(info)
        }.onFailure { Plog.i("sleep: owner check failed to start (${it.javaClass.simpleName})"); end(false) }
    }

    /** The page's request (main thread). Anything wrong with the id gets no answer: the page times its own request out. */
    fun fromPage(a: FragmentActivity?, m: JSONObject) {
        val id = m.optString("id")
        if (!SleepOnceCore.okAuthId(id)) { Plog.i("sleep: owner check asked with a bad id"); return }
        val reason = SleepOnceCore.authReason(m.optString("reason"))
        if (a == null || a.isFinishing) { WebHost.post(JSONObject(SleepOnceCore.authAnswer(id, false))); return }
        ask(a, reason) { ok, none -> WebHost.post(JSONObject(SleepOnceCore.authAnswer(id, ok, none))) }
    }
}
