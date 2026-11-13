// Self test for Lock with Touch ID (TouchLock.swift), area "touchid". Test copies only: an in-memory
// store with FICTIONAL keys and a fake Touch ID (never the Keychain, never the real sheet).
// Not testable here: the real Touch ID sheet, and holding the real Tab key while locked.
import AppKit
import WebKit

extension UpdaterSelfTest {
  static func touchID(_ a: App) {
    print("TOUCH ID CHECK:")
    let fake = Data(#"{"username":"fictional","auth":"FICTIONAL-auth","kek":"FICTIONAL-kek"}"#.utf8)
    var touchAsked = 0
    func setFake(_ mode: String) {
      TouchLock.evaluate = { _, done in
        DispatchQueue.main.async { touchAsked += 1 }
        DispatchQueue.global().asyncAfter(deadline: .now() + (mode == "slow" ? 1.5 : 0.1)) { done(mode != "fail", mode == "fail" ? "cancelled (fake)" : "") }
      }
    }
    // 1. Lock: the silent item becomes the locked one; nothing silent is left.
    TouchLock.memSet("remember", fake); TouchLock.memSet("locked", nil); TouchLock.refresh()
    check("lock-moves-the-keys", TouchLock.lock() && TouchLock.readRemembered() == nil && TouchLock.readLocked() == fake && TouchLock.cachedLocked)
    check("nothing-silent-while-locked", TouchLock.readRemembered() == nil)
    // 2. The page shows the Touch ID screen, in the Sign in window (V1.23: the only time it is shown).
    a.loadMain()
    a.showSignIn()
    let btn = "[...document.querySelectorAll('.lock-card button')].find(function(b){return /Unlock with Touch ID/.test(b.textContent)})"
    later(3) {
     a.sendToMain(#"{"type":"lock"}"#); a.sendRememberStatus()
     later(0.8) {
      js(a.main, "[!!(\(btn)), document.body.innerText.slice(0, 160)]") { r in
        let v = (r as? [Any])?.first
        check("locked-screen-offers-touch-id", (v as? Bool) == true, (r as? [Any])?.last as? String ?? "")
        SelfTest.snap(a.main, "\(dir)/touch-locked.png") {}
        js(a.main, "(function(){var b=(\(btn));b.setAttribute('data-touch','1');window.__tc=0;window.__tm=0;b.addEventListener('mousedown',function(){window.__tm++});b.addEventListener('click',function(){window.__tc++});return true})()") { _ in
          // 3. Touch ID refused: still locked, a quiet hint.
          setFake("fail")
          // A window that is not key takes the first real click as focus only (as on the developer's screen):
          // up to three real clicks, 0.4 s apart, until the fake Touch ID is asked.
          func clickUntilAsked(_ left: Int, _ f: @escaping (Bool) -> Void) {
            click(a.main, a.window, "[data-touch]") { ok in
              later(0.4) { if touchAsked > 0 || left <= 1 { f(ok) } else { clickUntilAsked(left - 1, f) } }
            }
          }
          clickUntilAsked(3) { clicked in do {
            check("real-click-reaches-the-button", clicked)
            later(0.8) {
              js(a.main, "'mousedown '+window.__tm+', click '+window.__tc+', disabled '+document.querySelector('[data-touch]').disabled+', key '+document.hasFocus()") { d in print("  touch click detail: \(d as? String ?? "?")") }
              check("refused-asked-touch-id", touchAsked > 0, "\(touchAsked) asks")
            check("refused-stays-locked", TouchLock.cachedLocked && TouchLock.readRemembered() == nil)
              js(a.main, "/Not unlocked/.test(document.body.innerText)") { v in
                check("refused-says-so", (v as? Bool) == true)
                // 4. Touch ID passes, slowly: the main thread keeps running meanwhile.
                setFake("slow")
                var ticks = 0
                let t = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in ticks += 1 }
                a.touchUnlock()
                later(1.8) {
                  t.invalidate()
                  check("main-thread-free-during-touch-id", ticks >= 25, "\(ticks) ticks in 1.8 s")
                  check("passed-unlocks", !TouchLock.cachedLocked && TouchLock.readRemembered() == fake && TouchLock.readLocked() == nil)
                  // 5. Sign out of this Mac: both gone.
                  TouchLock.memSet("locked", fake); TouchLock.refresh()
                  TouchLock.signOut()
                  check("sign-out-forgets-both", TouchLock.readRemembered() == nil && TouchLock.readLocked() == nil && !TouchLock.cachedLocked)
                  // 6. Lock with nothing remembered is a plain sign out (as before).
                  check("lock-without-remember-is-sign-out", !TouchLock.lock() && !TouchLock.cachedLocked)
                  a.sendRememberStatus()
                  finish()
                }
               }
              }
              }
            }
          }
        }
      }
    }
  }
}
