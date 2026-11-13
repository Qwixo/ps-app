// Self test for V1.23, PS without its main window (NoWindow.swift, Popup.swift). Area "nowindow"
// (PS_SELFTEST_ONLY=nowindow), and part of the full run. Test copies only: FICTIONAL status, no Keychain,
// nothing on the developer's screen (every window parked and invisible), never a real click on his apps.
// NO MAIN WINDOW: from launch to the end of the run the main page's window is never on screen, except
// while the Sign in window was asked for. ENGINE: the hidden page is loaded, answers at once, keeps its
// bridge and sends PS its status. POPUP: every state drawn (pictures), never key, fades by itself,
// held by the pointer, a click elsewhere puts it away, Quit needs two clicks, never over 1Password or
// Signal, a Dock click and Show PS bring it (never a window), holding Tab while signed out brings it.
// SIGN IN: the small window shows the engine page's own sign in, then goes once signed in.
import AppKit
import SwiftUI
import WebKit

enum NoWindowWatch {
  static var seen = 0          // ticks with the main window on screen while nobody asked to sign in
  static var titled = 0        // ticks with any other titled PS window on screen
  static var ticks = 0
  private static var timer: Timer?
  static func start(_ a: App) {
    guard timer == nil else { return }
    let t = Timer(timeInterval: 0.1, repeats: true) { _ in
      ticks += 1
      if a.window.isVisible && !a.signInOpen { seen += 1 }
      // The Second Computer window opens only on the developer's click (its own self test opens it on purpose): not counted.
      if NSApp.windows.contains(where: { $0 !== a.window && $0 !== a.secondWin.window && $0.isVisible && $0.styleMask.contains(.titled) && !($0 is NSPanel) }) { titled += 1 }
    }
    RunLoop.main.add(t, forMode: .common)
    timer = t
  }
}

extension SelfTest {
  static func noWindow(_ a: App, _ dir: String, _ done: @escaping () -> Void) {
    var r: [(String, Bool)] = []
    func ok(_ n: String, _ v: Bool) { r.append((n, v)) }
    let p = Popup.shared
    let later = { (s: Double, f: @escaping () -> Void) in DispatchQueue.main.asyncAfter(deadline: .now() + s, execute: f) }

    // ENGINE: the hidden page is the real page, loaded, with its bridge, and it talks to PS.
    let probe = "return JSON.stringify({ ready: document.readyState, bridge: !!(window.__ps && window.__ps.apply), href: location.href, scripts: document.scripts.length, root: !!document.getElementById('root') && document.getElementById('root').children.length > 0, html: (document.getElementById('root') || {}).innerHTML ? document.getElementById('root').innerHTML.slice(0, 120) : '', hidden: document.hidden, vis: document.visibilityState })"
    let deep = "const mc = await new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r('ok'); c.port2.postMessage(1); setTimeout(() => r('stuck'), 1500); }); const raf = await new Promise((r) => { requestAnimationFrame(() => r('ok')); setTimeout(() => r('stuck'), 1500); }); const res = performance.getEntriesByType('resource').map((e) => e.name.split('/').pop()).join(','); return JSON.stringify({ mc, raf, res, errs: window.__errs || [] });"
    a.main.callAsyncJavaScript(deep, arguments: [:], in: nil, in: .page) { d in print("ENGINE DEEP:", (try? d.get()) as? String ?? "error \(d)") }
    a.main.callAsyncJavaScript(probe, arguments: [:], in: nil, in: .page) { res in
      let text = (try? res.get()) as? String ?? ""
      print("ENGINE PROBE:", text.isEmpty ? "error \(res)" : text)
      ok("engine-loaded", text.contains("\"ready\":\"complete\"") && text.contains("\"root\":true"))
      ok("engine-bridge", text.contains("\"bridge\":true"))
      ok("engine-in-hidden-window", a.main.window === a.window && !a.window.isVisible)
      ok("engine-sent-status", a.testStatusSeen > 0)
      // The hidden page posts a status (as src/psstatus.ts does) and the pop-up takes it.
      let iso = ISO8601DateFormatter()
      let st: [String: Any] = ["open": true, "online": true, "lastSync": iso.string(from: Date().addingTimeInterval(-20)), "pending": 0, "error": false, "private": false,
                               "next": ["start": iso.string(from: Date().addingTimeInterval(95 * 60)), "end": iso.string(from: Date().addingTimeInterval(155 * 60)), "title": "Call with Northwind Silk", "now": false]]
      let js = "window.webkit.messageHandlers.ps.postMessage(JSON.stringify({ type: 'psStatus', state: s }))"
      a.main.callAsyncJavaScript(js, arguments: ["s": st], in: nil, in: .page) { _ in
        later(0.4) {
          ok("engine-status-reaches-popup", p.model.st.next?.title == "Call with Northwind Silk" && p.model.st.lastSync != nil)
          popupChecks()
        }
      }
    }

    func popupChecks() {
      let wasUnlocked = a.vaultUnlocked
      a.vaultUnlocked = true; a.updatePopup()
      // A Dock click: the pop-up, never a window.
      let reopen = a.applicationShouldHandleReopen(NSApp, hasVisibleWindows: false)
      ok("dock-click-no-window", !a.window.isVisible)
      a.showPopup()
      ok("popup-shows", p.isShown && p.panel?.isVisible == true && p.model.st.stage == .open)
      ok("popup-never-key", p.panel?.canBecomeKey == false && p.panel?.isKeyWindow == false && p.panel?.styleMask.contains(.nonactivatingPanel) == true)
      print("POPUP KEY:", "canBecomeKey=\(p.panel?.canBecomeKey ?? true) isKey=\(p.panel?.isKeyWindow ?? true) appActive=\(NSApp.isActive)")
      _ = reopen
      a.showMain()   // Show PS (Cmd+0)
      ok("show-ps-no-window", !a.window.isVisible && p.isShown)
      // Pictures of every state (drawn from a copy of the model at a fixed moment).
      pictures(dir)
      // Fades by itself (shortened here), held while the pointer is on it, gone after it leaves.
      let stay = p.stayFor
      p.stayFor = { _ in 0.6 }
      p.afterHover = 0.6
      p.hide(); later(0.4) {
        p.show()
        later(1.1) {
          ok("fades-by-itself", !p.isShown)
          p.show(); p.model.setHovering(true)
          later(1.1) {
            ok("pointer-holds-it", p.isShown)
            p.model.setHovering(false)
            later(1.1) {
              ok("leaves-then-fades", !p.isShown)
              // A click anywhere else.
              p.show(); p.clickedAway()
              ok("click-away-hides", !p.isShown)
              // Quit needs two clicks (the second is caught here: a test never quits this way).
              var actions: [String] = []
              let keep = p.onAction
              p.onAction = { actions.append($0) }
              p.show(); p.model.act("quit")
              ok("quit-first-click-only-arms", actions.isEmpty && p.model.quitArmed && p.isShown)
              p.model.act("quit")
              ok("quit-second-click-quits", actions == ["quit"])
              // The Second Computer row: only once that feature sets its hook; a click opens its window.
              // (V1.23 sets the hook at launch, NoWindow.swift setUpPopup: take it off first, put it back after.)
              let realHook = p.secondComputer
              p.secondComputer = nil
              let rowHidden = !p.model.st.second
              var opened = 0
              p.secondComputer = { opened += 1 }
              p.onAction = keep
              p.show(); p.model.act("second")
              ok("second-computer-row", rowHidden && p.model.st.second && opened == 1 && !p.isShown)
              p.secondComputer = realHook
              p.onAction = keep
              p.hide()
              // Golden rule: never over 1Password or Signal, and gone when one comes in front.
              p.show()
              Protected.simulate(front: true, signal: false)
              ok("protected-hides", !p.isShown)
              p.show()
              ok("protected-never-shows", !p.isShown)
              Protected.simulate(front: false, signal: false)
              p.stayFor = stay; p.afterHover = 3.5
              a.vaultUnlocked = wasUnlocked; a.updatePopup()
              macSettings()
            }
          }
        }
      }
    }

    // The pop-up's Settings: the Tab list opens with its Mac settings window (PS > Settings until V1.23).
    func macSettings() {
      let keepState = a.lastState, wasUnlocked = a.vaultUnlocked
      let st: [String: Any] = ["type": "state", "unlocked": true, "red": true, "lastSync": NSNull(), "docs": [
        ["id": "s1", "ws": NSNull(), "kind": "settings", "author": NSNull(), "updatedAt": NSNull(), "data": ["lastResetAt": ISO8601DateFormatter().string(from: Date()), "autoReset": "midnight"]],
        ["id": "t1", "ws": NSNull(), "kind": "todo", "author": NSNull(), "updatedAt": NSNull(), "data": ["title": "Send Northwind Silk the homepage draft", "type": "once", "done": false, "order": 0]]]]
      a.lastState = String(data: try! JSONSerialization.data(withJSONObject: st), encoding: .utf8)
      a.vaultUnlocked = true
      // The pop-up checks above asked the engine to sync; its answer (signed out, in a test copy) can land
      // any time now and would close the list. Held until this state is put back.
      a.testHoldState = true
      a.pushState()
      later(0.8) {
        a.openList(then: App.openSettingsJS)
        later(2.2) {
          // V1.32: Mac settings is a tab of the gear's full screen Settings (.gs-win, its page keeps the class mac-win).
          let q = "JSON.stringify({ win: !!document.querySelector('.gs-win[data-tab=mac] .mac-win'), text: ((document.querySelector('.gs-win') || {}).innerText || '').slice(0, 30000) })"
          a.overlay.evaluateJavaScript(q) { v, _ in
            let t = v as? String ?? ""
            ok("settings-opens-mac-settings", a.shown && t.contains("\"win\":true"))
            // V1.28: Auto reboot, Are you sure and Sign out moved to Security (the padlock); a row here points there.
            let want = ["Mac settings", "Task list over other apps", "Hold Right Option", "Screen time", "End of day", "Also reset at midnight", "Security has its own place now", "Open Security"]
            let missing = want.filter { !t.contains($0) }
            ok("mac-settings-has-every-section", missing.isEmpty)
            if !missing.isEmpty { print("MAC SETTINGS missing:", missing) }
            ok("mac-settings-permission-row", t.contains("Fix permission"))   // a test copy is never trusted for Accessibility
            snap(a.overlay, "\(dir)/mac-settings.png") {
              a.overlay.evaluateJavaScript("window.__psDimxClose && window.__psDimxClose()", completionHandler: nil)
              later(0.9) {
                a.hideOverlay(force: true)
                // Locked while the list is up: its own Sign in button (opens the Sign in window).
                a.lastState = #"{"type":"state","unlocked":false,"lastSync":null,"docs":[]}"#
                a.vaultUnlocked = false
                a.pushState()
                a.showOverlay()
                later(1.0) {
                  snap(a.overlay, "\(dir)/overlay-locked.png") {
                    a.overlay.evaluateJavaScript("(function(){var b=[].find.call(document.querySelectorAll('.ps-locked-acts button'),function(x){return /Sign in/.test(x.textContent)});if(b){b.click();return true}return false})()") { v, _ in
                      later(0.8) {
                        ok("locked-list-sign-in-opens-window", (v as? Bool) == true && a.window.isVisible && a.signInOpen && !a.shown)
                        _ = a.windowShouldClose(a.window)   // its close button: hidden again
                        a.lastState = keepState; a.vaultUnlocked = wasUnlocked; a.testHoldState = false; a.pushState()
                        tabWhileSignedOut()
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

    // Holding Tab while signed out brings the pop-up (fed into the tap's own code, never a real key).
    func tabWhileSignedOut() {
      let w = TabWatch.shared
      if Protected.front { ok("tab-signed-out-shows-popup (skipped: 1Password or Signal in front)", true); signIn(); return }
      p.hide()
      let was = (a.vaultUnlocked, w.appActive, w.frontID)
      a.vaultUnlocked = false; w.appActive = false; w.frontID = nil
      w.mu.lock(); w.testPosted = []; w.state = .idle; w.held = nil; w.pinned = false; w.mu.unlock()
      let down = CGEvent(keyboardEventSource: nil, virtualKey: 48, keyDown: true)!, up = CGEvent(keyboardEventSource: nil, virtualKey: 48, keyDown: false)!
      let held = w.handle(.keyDown, down) == nil
      later(HOLD_SECONDS + 0.3) {
        _ = w.handle(.keyUp, up)
        let shownNow = p.isShown && p.model.st.stage != .open
        // A quick tap stays a normal Tab.
        p.hide()
        w.mu.lock(); w.testPosted = []; w.mu.unlock()
        _ = w.handle(.keyDown, down); _ = w.handle(.keyUp, up)
        w.mu.lock(); let sent = w.testPosted?.count ?? 0; w.testPosted = nil; w.state = .idle; w.held = nil; w.mu.unlock()
        later(HOLD_SECONDS + 0.3) {
          ok("tab-hold-signed-out-shows-popup", held && shownNow)
          ok("tab-tap-signed-out-stays-tab", sent == 2 && !p.isShown)
          a.vaultUnlocked = was.0; w.appActive = was.1; w.frontID = was.2
          signIn()
        }
      }
    }

    // The Sign in window: the engine page's own sign in, then it goes once the page says it is done.
    func signIn() {
      p.hide()
      a.showSignIn()
      ok("signin-window-shows", a.window.isVisible && a.signInOpen)
      ok("signin-tab-follows-window", TabWatch.shared.appActive == NSApp.isActive)   // Tab is PS's own only while this window is up and PS active
      later(1.2) { cleanSignIn {
        snap(a.main, "\(dir)/signin-window.png") {
          a.main.evaluateJavaScript("window.webkit.messageHandlers.ps.postMessage(JSON.stringify({ type: 'signin:done' }))", completionHandler: nil)
          // The tick, then the fade (about 1 s; longer while a full run keeps the main thread busy).
          func gone(_ left: Int, _ f: @escaping () -> Void) { if !a.window.isVisible || left <= 0 { f() } else { later(0.25) { gone(left - 1, f) } } }
          later(1.0) { gone(16) {
            ok("signin-window-goes", !a.window.isVisible && !a.signInOpen)
            ok("tab-free-after-signin", !TabWatch.shared.appActive)
            ok("never-a-main-window", NoWindowWatch.seen == 0 && NoWindowWatch.titled == 0)
            let pass = r.allSatisfy { $0.1 }
            print("NO MAIN WINDOW CHECK:", pass ? "ok" : "FAIL", r.map { "\($0.0)=\($0.1 ? "ok" : "FAIL")" }.joined(separator: " "),
                  "watched=\(NoWindowWatch.ticks) ticks, main-on-screen=\(NoWindowWatch.seen), other-windows=\(NoWindowWatch.titled)")
            done()
          } }
        }
      } }
    }

    // V1.26 (the developer, 1 Nov 2026: "make that screen look cleaner"): the Sign in window is PS's own page, not the
    // website's lock card cut down. Sized to the page (no scrollbar), only what the developer needs on his Mac, drawn in
    // dark and light, the recovery key screen and the Touch ID locked screen in the same window.
    func cleanSignIn(_ next: @escaping () -> Void) {
      let read = "JSON.stringify({ text: document.body.innerText, sh: document.documentElement.scrollHeight, ih: innerHeight, card: !!document.querySelector('.lock-card'), si: !!document.querySelector('.ps-si') })"
      func page(_ f: @escaping ([String: Any]) -> Void) {
        a.main.evaluateJavaScript(read) { v, _ in f((v as? String).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] } ?? [:]) }
      }
      func fits() -> Bool { a.signInHeight.map { abs(a.window.frame.height - $0) <= 1 } ?? false }
      func click(_ re: String) { a.main.evaluateJavaScript("(function(){var b=[].find.call(document.querySelectorAll('.ps-si-link'),function(x){return /\(re)/.test(x.textContent)});if(b)b.click();return !!b})()", completionHandler: nil) }
      page { pg in
        let t = pg["text"] as? String ?? ""
        ok("signin-own-page", pg["si"] as? Bool == true && pg["card"] as? Bool == false)
        ok("signin-mac-only", !t.contains("See the demo") && !t.contains("Set up the vault") && !t.contains("Client?") && !t.contains("AES-256"))
        ok("signin-has-what-red-needs", ["Sign in to \(AppName.current)", "Username", "Passphrase", "Remember me on this Mac", "Touch ID", "Unlock", "recovery key"].allSatisfy { t.contains($0) })
        ok("signin-window-fits-page", fits())
        ok("signin-no-scrollbar", (pg["sh"] as? Double ?? 9999) <= (pg["ih"] as? Double ?? 0) + 1)
        print("SIGNIN SIZE: page=\(a.signInHeight ?? 0) window=\(a.window.frame.size)")
        a.window.appearance = NSAppearance(named: .darkAqua)
        later(0.6) { snap(a.main, "\(dir)/signin-dark.png") {
          a.window.appearance = NSAppearance(named: .aqua)
          later(0.6) { snap(a.main, "\(dir)/signin-light.png") {
            a.window.appearance = nil
            let h0 = a.window.frame.height
            click("recovery key")
            later(0.8) { page { rp in
              ok("signin-recover-grows", a.window.frame.height > h0 + 40 && fits() && (rp["sh"] as? Double ?? 9999) <= (rp["ih"] as? Double ?? 0) + 1)
              snap(a.main, "\(dir)/signin-recover.png") {
                click("Back to sign in")
                later(0.8) {
                  ok("signin-back-shrinks", abs(a.window.frame.height - h0) <= 1)
                  // Locked with Remember me: Touch ID first, in the same clean window.
                  a.sendToMain(#"{"type":"rememberStatus","exists":true,"locked":true}"#)
                  later(0.8) { page { tp in
                    ok("signin-touch-id-locked", (tp["text"] as? String ?? "").contains("Unlock with Touch ID") && tp["si"] as? Bool == true && fits())
                    snap(a.main, "\(dir)/signin-touch-id.png") {
                      a.sendRememberStatus()
                      later(0.8) { next() }
                    }
                  } }
                }
              }
            } }
          } }
        } }
      }
    }
  }

  /// The pop-up in every state, drawn into a parked panel at a fixed moment (fictional status).
  static func pictures(_ dir: String) {
    let now = Date()
    let iso = ISO8601DateFormatter()
    func status(_ x: [String: Any] = [:]) -> [String: Any] {
      var d: [String: Any] = ["open": true, "online": true, "lastSync": iso.string(from: now.addingTimeInterval(-20)), "pending": 0, "error": false, "private": false,
                              "next": ["start": iso.string(from: now.addingTimeInterval(95 * 60)), "end": NSNull(), "title": "Call with Northwind Silk", "now": false]]
      x.forEach { d[$0.key] = $0.value }
      return d
    }
    func shot(_ name: String, _ make: (inout PopupState) -> Void, quit: Bool = false) {
      let m = PopupModel()
      var s = PopupState(); s.version = "V1.23"; s.take(status()); make(&s)
      m.st = s; m.visible = true; m.quitArmed = quit; m.left = quit || s.stage == .opening || s.stage == .signedOut ? 1 : 0.62
      let v = ZStack(alignment: .top) {
        LinearGradient(colors: [Color(white: 0.82), Color(white: 0.7)], startPoint: .top, endPoint: .bottom)
        PopupView(m: m, now: now)
      }.frame(width: PopupView.width + 40, height: 250)
      let pw = PopupPanel(contentRect: NSRect(x: 0, y: 0, width: PopupView.width + 40, height: 250), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
      pw.alphaValue = 0
      let host = NSHostingView(rootView: v)
      host.frame = NSRect(x: 0, y: 0, width: PopupView.width + 40, height: 250)
      pw.contentView = host
      host.layoutSubtreeIfNeeded()
      let rep0 = host.bitmapImageRepForCachingDisplay(in: host.bounds)
      if let rep0 { host.cacheDisplay(in: host.bounds, to: rep0) }
      pw.contentView = nil
      if let rep = rep0, let png = rep.representation(using: .png, properties: [:]) {
        try? png.write(to: URL(fileURLWithPath: "\(dir)/\(name).png")); print("saved", "\(dir)/\(name).png")
      } else { print("popup picture failed", name) }
    }
    shot("popup-starting") { $0.stage = .opening }
    shot("popup-active") { $0.stage = .open }
    shot("popup-active-second-computer") { $0.stage = .open; $0.second = true; $0.secondLine = "Home M1, online" }
    shot("popup-active-meeting-now") { $0.stage = .open; $0.next = PopupNext(start: now.addingTimeInterval(-600), end: nil, title: "Weekly check in", now: true) }
    shot("popup-active-private") { $0.stage = .open; $0.take(status(["private": true])) }
    shot("popup-offline") { $0.stage = .open; $0.online = false; $0.next = nil }
    shot("popup-permission") { $0.stage = .open; $0.trusted = false }
    shot("popup-tab-off") { $0.stage = .open; $0.tabOn = false }
    shot("popup-right-option") { $0.stage = .open; $0.keyName = "Right Option" }
    shot("popup-quit-armed", { $0.stage = .open }, quit: true)
    shot("popup-locked") { $0.stage = .locked }
    shot("popup-signed-out") { $0.stage = .signedOut }
  }
}
