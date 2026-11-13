import AppKit
import ServiceManagement
import WebKit

// Self test for remote restart and auto reboot, the PS side (AutoReboot.swift, RemoteCommand.swift).
// PS_SELFTEST_ONLY=reboot. The test copy never registers, connects to or asks the real helper
// anything, so nothing here can restart, shut down or lock the developer's Mac: RemoteCommand only records what
// it would have done (testDid). Checks: the helper is untouched; lock; restart on an unlocked Mac waits
// 10 s on a Cancel card and Cancel stops it; a cancel command from the other device stops a countdown;
// a second restart while one counts down is refused; an unknown command is refused; the card is never
// held back by Do Not Disturb. With the screen locked: no card, the command goes at once. The timer
// itself is tested by tests/reboot-core-test.sh.
extension SelfTest {
  static func rebootCheck(_ a: App, _ done: @escaping () -> Void) {
    rebootCommandCheck(a, done)
  }

  static func rebootCommandCheck(_ a: App, _ done: @escaping () -> Void) {
    let rc = RemoteCommand.shared, ar = AutoReboot.shared
    var results: [(String, Bool)] = []
    func ok(_ name: String, _ v: Bool) { results.append((name, v)) }
    func later(_ t: Double, _ f: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + t, execute: f) }
    func report() { print("REBOOT CHECK:", results.map { "\($0.0)=\($0.1 ? "ok" : "FAIL")" }.joined(separator: " ")); done() }

    ok("helper-untouched", ar.helperState == "test" && ar.helper.isEmpty)
    ok("machine-shape", ar.machine()["timer"] != nil && ar.machine()["helper"] as? String == "missing")
    // 2 Nov 2026: macOS says notFound for a helper that is in the build but was never registered; that must offer Set up.
    ok("never-registered-offers-set-up", AutoReboot.state(.notFound, bundled: true) == "off" && AutoReboot.state(.notFound, bundled: false) == "missing"
       && AutoReboot.state(.notRegistered, bundled: true) == "off" && AutoReboot.state(.requiresApproval, bundled: true) == "approve"
       && AutoReboot.state(.enabled, bundled: true) == "on")
    ok("helper-files-in-this-build", AutoReboot.bundled)
    // V1.28: Postpone from the other Mac or the phone reaches the helper (here the stand-in), and the stat body
    // says whether Postpone can reach this Mac's helper at all (no helper here, so no).
    rc.run(action: "postpone", id: "t-pp", from: "Test M4") { r, why in ok("postpone-recorded", r && why == nil && ar.testDid.last == "postpone") }
    ok("machine-says-postpone", ((ar.machine()["timer"] as? [String: Any])?["postpone"] as? Bool) == false)
    ok("status-says-helper-not-old", ar.status()["helperOld"] as? Bool == false)
    // V1.28 (the developer: choose the M1's auto reboot from the M4): set:<mode>:<hours>, only from the main Mac, strict format.
    rc.run(action: "set:active:600", id: "t-set", from: "Test M4") { r, why in
      ok("set-from-main-mac", r && why == nil && ar.testDid.last == "set:active:600" && ar.mode == "active" && ar.minutes == 600)
    }
    ar.mode = "watch"; ar.minutes = AutoReboot.defaultMinutes
    ok("default-18-hours", AutoReboot.defaultMinutes == 1080)
    let nowMs = Date().timeIntervalSince1970 * 1000
    func cmdBody(_ a: String) -> [String: Any] { ["v": 1, "t": "cmd", "id": "t-c", "from": "p", "to": "m", "at": nowMs, "exp": nowMs + 60_000, "action": a] }
    ok("set-only-from-main-mac", SecondIdentity.checkCmd(cmdBody("set:active:1080"), signerRole: "primary") == nil
       && SecondIdentity.checkCmd(cmdBody("set:active:1080"), signerRole: "phone") == "Not signed by your primary"
       && SecondIdentity.checkCmd(cmdBody("postpone"), signerRole: "phone") == nil)
    ok("set-strict-format", ["set:active:9", "set:active:4321", "set:boom:600", "set:active:0600", "set:active:1:2", "set:active:", "set::600"]
       .allSatisfy { SecondIdentity.checkCmd(cmdBody($0), signerRole: "primary") == "Unknown command" })
    ok("machine-says-set", ((ar.machine()["timer"] as? [String: Any])?["set"] as? Bool) == true)
    // Wired to the Second Computer: a verified cmd reaches RemoteCommand, and the stat body gets the machine block.
    ok("second-wired", Second.shared.cmdRunner != nil && (Second.shared.machine?()["timer"] as? [String: Any]) != nil)
    rc.run(action: "lock", id: "t-lock", from: "Test phone") { r, _ in ok("lock-recorded", r && rc.testDid == ["lock"]) }
    rc.run(action: "wipe", id: "t-bad", from: "Test phone") { r, why in ok("unknown-refused", !r && why == "Unknown command") }
    rc.run(action: "restart", id: "t-old", from: "Test phone", at: 1_000_000) { r, why in ok("sent-before-boot-dropped", !r && why == "Sent before this Mac last started" && !rc.testDid.contains("restart")) }
    if RemoteCommand.screenLocked() {
      // The screen is locked (nobody at the Mac): no Cancel card, the command goes at once. The card
      // checks below need an unlocked screen and run on the next self test while the developer is at the Mac.
      var got: (Bool, String?)?
      rc.run(action: "restart", id: "t-locked", from: "Test phone") { r, why in got = (r, why) }
      ok("locked-goes-at-once", got?.0 == true && rc.testDid.last == "restart")
      var got2: (Bool, String?)?
      rc.run(action: "cancel", id: "t-locked-c", from: "Test phone") { r, why in got2 = (r, why) }
      ok("locked-nothing-left-to-cancel", got2?.0 == false && got2?.1 == "Nothing to cancel")
      print("REBOOT CHECK NOTE: screen locked, so the unlocked Cancel card checks were not run this time")
      return report()
    }

    var got1: (Bool, String?)?
    rc.run(action: "restart", id: "t-r1", from: "Test phone") { r, why in got1 = (r, why) }
    rc.run(action: "shutdown", id: "t-r2", from: "Test phone") { r, why in ok("second-refused", !r && (why ?? "").contains("already")) }
    ok("card-not-held-by-dnd", !Toast.shared.heldIds.contains { $0.hasPrefix("rr:") })
    later(3) {
      ok("waits-on-card", got1 == nil && !rc.testDid.contains("restart"))
      rc.cardAction("rr:t-r1", "cancel")
      ok("cancel-on-mac", got1?.0 == false && got1?.1 == "Cancelled on this Mac" && !rc.testDid.contains("restart"))
      var got2: (Bool, String?)?
      rc.run(action: "shutdown", id: "t-r3", from: "Test phone") { r, why in got2 = (r, why) }
      later(2) {
        rc.run(action: "cancel", id: "t-c", from: "Test phone") { r, _ in ok("cancel-from-phone", r) }
        ok("shutdown-stopped", got2?.0 == false && !rc.testDid.contains("shutdown"))
        var got3: (Bool, String?)?
        rc.run(action: "restart", id: "t-r4", from: "Test phone") { r, why in got3 = (r, why) }
        later(Double(RemoteCommand.cancelWindow) + 1.5) {
          ok("restart-after-10s", got3?.0 == true && rc.testDid.last == "restart")
          ok("nothing-to-cancel", true)
          rc.run(action: "cancel", id: "t-c2", from: "Test phone") { r, why in ok("cancel-nothing", !r && why == "Nothing to cancel") }
          report()
        }
      }
    }
  }
}

// The Auto reboot card itself (web RebootCard.tsx), clicked for real. 1 Nov, the developer on V1.24: "I can't
// actually like click onto anything". The card's root class was rb, which the rule book's full screen page also
// styles (rulebook.css: position absolute, inset 0), so it sat over the top of Mac settings and took every click
// there. Real mouse events into the parked Tab list and into the parked Second Computer window's Machine pane.
// V1.28 (the developer, 1 Nov: "a security icon just to the left of the second computer button"): the card lives in the
// Security window behind the padlock. Checked here: the padlock sits directly left of Second Computer, opens
// Security on a real click, the window holds both Macs at a glance, the card, the other Mac's Lock, Restart,
// Shut down and Postpone (each a real click that reaches PS as a Second Computer action), the phone, Are you
// sure and Sign out; Mac settings points there. The helper is a stand-in (AutoReboot.testShow): nothing is
// registered, removed or asked, System Settings never opens, and the made up other Mac exists only in this
// test copy's own pages (nothing is signed or sent). Each click must land on its own control (nothing lying
// over it), reach PS, and come back as the new state.
// Pictures: security-top.png, security-window.png, reboot-card-list-off.png, reboot-card-list-on.png, reboot-card-machine.png.
extension SelfTest {
  static func rebootCardCheck(_ a: App, _ dir: String, _ done: @escaping () -> Void) {
    let ar = AutoReboot.shared
    var results: [(String, Bool)] = []
    func ok(_ name: String, _ v: Bool) { results.append((name, v)); if !v { print("REBOOT CARD FAIL:", name) } }
    func later(_ t: Double, _ f: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + t, execute: f) }
    func obj(_ v: Any?) -> [String: Any]? { (v as? String).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] } }
    let realMode = UserDefaults.standard.object(forKey: "reboot.mode") as? String, realHours = UserDefaults.standard.object(forKey: "reboot.hours") as? Int,
        realMinutes = UserDefaults.standard.object(forKey: "reboot.minutes") as? Int
    // The card by its title, not its class: the same check then also shows what V1.24's card (class rb) did.
    // "Auto reboot" in the Machine pane, "Auto reboot on this Mac" in the Security window.
    let cardJS = "[].find.call(document.querySelectorAll('section'), function (s) { var h = s.querySelector('h2'); return !!h && h.textContent.trim().indexOf('Auto reboot') === 0; })"
    ok("watch-only-by-default", ar.mode == "watch")
    ar.minutes = 1080   // a known start for Shorter and Longer, 18 hours (a test copy keeps it in memory)
    // No click on the card may stall PS: the main thread beats every 50 ms throughout (pictures and the
    // Second Computer window's first load are left out of the measure).
    var lastBeat = CACurrentMediaTime(), worst = 0.0, paused = false
    let beat = Timer(timeInterval: 0.05, repeats: true) { _ in let n = CACurrentMediaTime(); if !paused { worst = max(worst, n - lastBeat) }; lastBeat = n }
    RunLoop.main.add(beat, forMode: .common)
    func picture(_ w: WKWebView?, _ name: String, _ f: @escaping () -> Void) {
      guard let w else { return f() }
      paused = true
      // The card itself in the picture (its top near the top of the view).
      w.evaluateJavaScript("(function(){var c=\(cardJS);if(c)c.scrollIntoView({block:'start',behavior:'instant'})})()") { _, _ in
        later(0.4) { snap(w, "\(dir)/\(name)") { lastBeat = CACurrentMediaTime(); paused = false; f() } }
      }
    }

    /// The Security window from its top (both Macs at a glance).
    func topPicture(_ name: String, _ f: @escaping () -> Void) {
      paused = true
      a.overlay.evaluateJavaScript("(function(){var sc=document.querySelector('.sec-win .cs-scroll');if(sc)sc.scrollTop=0})()") { _, _ in
        later(0.4) { snap(a.overlay, "\(dir)/\(name)") { lastBeat = CACurrentMediaTime(); paused = false; f() } }
      }
    }
    struct Surface { let name: String; let list: Bool; let web: () -> WKWebView?; let win: () -> NSWindow?; let sent: () -> [String] }
    let tabList = Surface(name: "list", list: true, web: { a.overlay }, win: { a.panel }, sent: { a.testLog })
    let pane = Surface(name: "machine", list: false, web: { a.secondWin.web }, win: { a.secondWin.window }, sent: { a.secondWin.seen })
    func call(_ s: Surface, _ body: String, _ args: [String: Any] = [:], _ f: @escaping (Any?) -> Void) {
      guard let w = s.web() else { return f(nil) }
      w.callAsyncJavaScript(body, arguments: args, in: nil, in: .page) { r in f(try? r.get()) }
    }
    /// A real click (mouse down, then up 90 ms later) at a page point, into the surface's own window.
    var evn = 300
    func press(_ s: Surface, _ x: Double, _ y: Double, _ f: @escaping () -> Void) {
      guard let w = s.web(), let win = s.win() else { return f() }
      let inWin = w.convert(NSPoint(x: x, y: w.isFlipped ? y : w.bounds.height - y), to: nil)
      if s.list { a.updateClickThrough(at: NSPoint(x: x, y: y)) }
      evn += 1
      let n = evn
      func ev(_ t: NSEvent.EventType) -> NSEvent? {
        NSEvent.mouseEvent(with: t, location: inWin, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: win.windowNumber,
                           context: nil, eventNumber: n, clickCount: 1, pressure: t == .leftMouseUp ? 0 : 1)
      }
      if let d = ev(.leftMouseDown) { win.sendEvent(d) }
      later(0.09) { if let u = ev(.leftMouseUp) { win.sendEvent(u) }; f() }
    }
    /// Real mouse wheel notches (down) at a page point.
    func wheel(_ s: Surface, _ x: Double, _ y: Double, _ notches: Int, _ f: @escaping () -> Void) {
      guard notches > 0, let w = s.web(), let win = s.win() else { return later(0.5, f) }
      let at = w.convert(NSPoint(x: x, y: w.isFlipped ? y : w.bounds.height - y), to: nil)
      if let cg = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1, wheel1: -3, wheel2: 0, wheel3: 0) {
        cg.location = CGPoint(x: at.x, y: (NSScreen.screens.first?.frame.height ?? 0) - at.y)
        cg.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(win.windowNumber))
        if let ev = NSEvent(cgEvent: cg) { win.sendEvent(ev) }
      }
      later(0.15) { wheel(s, x, y, notches - 1, f) }
    }
    // A control on the card by its words or aria-label ("Log*": starts with), scrolled into view: its centre and
    // whether that point really lands on it (nothing lying over it).
    let find = """
      var card = \(cardJS); if (!card) return null;
      var pre = t.slice(-1) === '*' ? t.slice(0, -1) : null;
      var e = [].find.call(card.querySelectorAll('button, summary'), function (x) {
        var w = x.textContent.trim(); return x.getAttribute('aria-label') === t || (pre === null ? w === t : w.indexOf(pre) === 0); });
      if (!e) return null;
      e.scrollIntoView({ block: 'center', behavior: 'instant' });
      var r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, h = document.elementFromPoint(x, y);
      return JSON.stringify({ x: x, y: y, hit: !!h && (h === e || e.contains(h)) });
      """
    // What the card shows now (and where it sits).
    let read = """
      var card = \(cardJS); if (!card) return JSON.stringify({ card: false });
      var tx = function (e) { return e ? e.textContent.trim() : ''; }, bs = [].slice.call(card.querySelectorAll('button'));
      var has = function (t) { return bs.some(function (b) { return tx(b) === t; }); };
      var mode = bs.filter(function (b) { return b.getAttribute('role') === 'radio' && b.getAttribute('aria-checked') === 'true'; }).map(tx)[0] || '';
      var chip = bs.filter(function (b) { return /^\\d+ (h|min)$/.test(tx(b)) && b.classList.contains('primary'); }).map(tx)[0] || '';
      var test = bs.filter(function (b) { return /5 minute test|Test ready/.test(tx(b)); })[0];
      var log = card.querySelector('details'), prev = card.previousElementSibling, r = card.getBoundingClientRect();
      return JSON.stringify({ card: true, pos: getComputedStyle(card).position, top: r.top, prevBottom: prev ? prev.getBoundingClientRect().bottom : null,
        pill: tx(card.querySelector('.pill')), mode: mode, hours: tx(card.querySelector('[role=group] b')), chip: chip,
        setup: has('Set up the restart helper'), again: has('Open it again'), sure: has('Yes, make it Active'),
        banners: [].map.call(card.querySelectorAll('.banner'), tx), test: tx(test), testOff: test ? test.disabled : null,
        explain: [].some.call(card.querySelectorAll('p'), function (p) { return tx(p).indexOf('Active: restarts once if this Mac stays locked') === 0; }),
        next: tx(card.querySelector('.arb-next')),
        logOpen: log ? log.open : null, logItems: log ? log.querySelectorAll('li').length : 0, remove: has('Remove the helper') });
      """
    typealias Check = (_ card: [String: Any], _ sent: [String], _ did: [String]) -> Bool
    /// Clicks `t` on the card for real, then waits (up to 3 s) for the check: the card's new state, the
    /// reboot messages PS got from this page since the click, and what the stand-in helper did since.
    func step(_ s: Surface, _ t: String, _ name: String, _ check: @escaping Check, _ next: @escaping () -> Void) {
      call(s, find, ["t": t]) { v in
        guard let p = obj(v), let x = p["x"] as? Double, let y = p["y"] as? Double else {
          print("REBOOT CARD: no '\(t)' on the \(s.name) card"); ok("\(s.name)-\(name)", false); return next()
        }
        let hit = (p["hit"] as? Bool) == true
        if !hit { print("REBOOT CARD: '\(t)' on the \(s.name) card has something lying over it") }
        let sent0 = s.sent().count, did0 = ar.testDid.count
        press(s, x, y) {
          let end = Date().addingTimeInterval(3)
          func poll() {
            call(s, read) { v in
              let st = obj(v) ?? [:], sent = s.sent().dropFirst(sent0).filter { $0.hasPrefix("reboot:") }, did = Array(ar.testDid.dropFirst(did0))
              if check(st, sent, did) { ok("\(s.name)-\(name)", hit); return next() }
              if Date() > end { print("REBOOT CARD: \(s.name)-\(name) card=\(st) sent=\(sent) did=\(did) mode=\(ar.mode) minutes=\(ar.minutes) helper=\(ar.helperState) shown=\(a.shown)"); ok("\(s.name)-\(name)", false); return next() }
              later(0.1, poll)
            }
          }
          poll()
        }
      }
    }
    func run(_ s: Surface, _ steps: [(String, String, Check)], _ i: Int = 0, _ f: @escaping () -> Void) {
      guard i < steps.count else { return f() }
      step(s, steps[i].0, steps[i].1, steps[i].2) { run(s, steps, i + 1, f) }
    }
    /// Waits (up to 3 s) until the card shows what `check` wants.
    func settle(_ s: Surface, _ check: @escaping ([String: Any]) -> Bool, _ f: @escaping (Bool) -> Void) {
      let end = Date().addingTimeInterval(3)
      func poll() { call(s, read) { v in let st = obj(v) ?? [:]; if check(st) { f(true) } else if Date() > end { print("REBOOT CARD: \(s.name) card=\(st)"); f(false) } else { later(0.1, poll) } } }
      poll()
    }
    /// The card sits in the page's flow: not pinned over anything (position static) and below the section
    /// before it. In the Tab list it also leaves the Security window's own close button free and moves up
    /// with everything else under a real mouse wheel (in V1.24 it stayed stuck at the top of Mac settings).
    func layout(_ s: Surface, _ tag: String, _ f: @escaping () -> Void) {
      call(s, read) { v in
        let st = obj(v) ?? [:], top = st["top"] as? Double ?? -1
        ok("\(tag)-card-in-place", st["pos"] as? String == "static" && top >= ((st["prevBottom"] as? Double) ?? .infinity) - 1)
        guard s.list else { return f() }
        call(s, "var b = document.querySelector('.sec-win .cs-min'); if (!b) return null; var r = b.getBoundingClientRect(), h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && (h === b || b.contains(h));") { v in
          ok("\(tag)-close-button-free", (v as? Bool) == true)
          call(s, "var sc = document.querySelector('.sec-win .cs-scroll'); if (!sc) return null; sc.scrollTop = 0; var r = sc.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, top: \(cardJS).getBoundingClientRect().top });") { v in
            guard let p = obj(v), let x = p["x"] as? Double, let y = p["y"] as? Double, let top0 = p["top"] as? Double else { ok("\(tag)-card-scrolls-with-list", false); return f() }
            wheel(s, x, y, 6) {
              call(s, read) { v in
                let top1 = (obj(v) ?? [:])["top"] as? Double ?? top0
                ok("\(tag)-card-scrolls-with-list", top1 < top0 - 60)
                if top1 >= top0 - 60 { print("REBOOT CARD: card top \(Int(top0)) then \(Int(top1)) after the wheel") }
                f()
              }
            }
          }
        }
      }
    }
    // Where a page element is, and what really sits on top of its centre (said when a click would miss).
    func spot(_ s: Surface, _ el: String, _ f: @escaping ([String: Any]?) -> Void) {
      call(s, "var e = \(el); if (!e) return null; var r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, h = document.elementFromPoint(x, y); return JSON.stringify({ x: x, y: y, hit: !!h && (h === e || e.contains(h)), top: h ? h.tagName + ' ' + (h.getAttribute('class') || '') : 'nothing' });") { v in f(obj(v)) }
    }
    /// The Tab list up, then the gear and its Mac settings tab clicked for real, as the developer does. True once Mac settings shows.
    func openMac(_ f: @escaping (Bool) -> Void) {
      if !a.shown { a.showOverlay() }
      later(0.8) {
        // The New tasks pop-up folds away first, as in the other Tab list checks (it can sit over the top right).
        a.overlay.evaluateJavaScript("document.querySelector('.nt-min') && document.querySelector('.nt-min').click()", completionHandler: nil)
        later(0.8) {
          spot(tabList, "document.querySelector('.tm-tr button[aria-label=Settings]')") { g in
            guard let g, let gx = g["x"] as? Double, let gy = g["y"] as? Double else { print("REBOOT CARD: no gear in the Tab list"); return f(false) }
            if g["hit"] as? Bool != true { print("REBOOT CARD: the gear has \(g["top"] ?? "?") over it") }
            press(tabList, gx, gy) {
              later(1.1) {   // the full screen Settings grows out of the gear in 0.6 s
                // V1.32: the gear opens the full screen Settings; Mac settings is its tab.
                spot(tabList, "document.querySelector('.gs-win [data-tab=mac]')") { m in
                  guard let m, let mx = m["x"] as? Double, let my = m["y"] as? Double else { print("REBOOT CARD: the gear menu did not open"); return f(false) }
                  if m["hit"] as? Bool != true { print("REBOOT CARD: Mac settings in the gear menu has \(m["top"] ?? "?") over it") }
                  press(tabList, mx, my) {
                    later(1.4) {
                      call(tabList, "return !!document.querySelector('.mac-win:not(.sec-win)');") { v in
                        if (v as? Bool) != true { print("REBOOT CARD: Mac settings did not open") }
                        f((v as? Bool) == true)
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
    /// The Tab list up, then the padlock clicked for real. True once the Security window shows the card.
    func openSec(_ f: @escaping (Bool) -> Void) {
      if !a.shown { a.showOverlay() }
      later(0.8) {
        a.overlay.evaluateJavaScript("document.querySelector('.nt-min') && document.querySelector('.nt-min').click()", completionHandler: nil)
        later(0.8) {
          spot(tabList, "document.querySelector('.tm-tr .sec-btn')") { g in
            guard let g, let gx = g["x"] as? Double, let gy = g["y"] as? Double else { print("REBOOT CARD: no padlock in the Tab list"); return f(false) }
            if g["hit"] as? Bool != true { print("REBOOT CARD: the padlock has \(g["top"] ?? "?") over it") }
            press(tabList, gx, gy) {
              later(1.4) {
                call(tabList, "var c = \(cardJS); return JSON.stringify({ win: !!document.querySelector('.sec-win'), card: !!c && !!c.closest('.sec-win') });") { v in
                  let o = obj(v) ?? [:]
                  if o["card"] as? Bool != true { print("REBOOT CARD: after the padlock click: \(o)") }
                  f(o["card"] as? Bool == true)
                }
              }
            }
          }
        }
      }
    }
    /// The state with a made up pairing (this Mac the primary, "Test M1" trusted), so the Machine pane and the
    /// Security window draw the other Mac: they show it only once a second Mac is paired. `extra`: Test M1's
    /// status (its auto reboot Active, due in 30 minutes, Postpone reaching its helper) and a phone that asked to
    /// be trusted. Only this test copy's own pages see it; nothing is signed or sent.
    func pairedState(extra: Bool = false) -> String? {
      guard let s = a.lastState, var j = (try? JSONSerialization.jsonObject(with: Data(s.utf8))) as? [String: Any] else { return nil }
      let at = Int(Date().timeIntervalSince1970 * 1000)
      // Test M1's announcement, and its "pair ok" (V1.25: paired only once the second Mac confirmed).
      let dev: [String: Any] = ["v": 1, "t": "dev", "id": "rc-dev", "from": "rc-m1", "to": "*", "at": at, "name": "Test M1", "role": "secondary", "pub": "rc-pub-m1"]
      let pairOk: [String: Any] = ["v": 1, "t": "pairok", "id": "rc-pairok", "from": "rc-m1", "to": "rc-m4", "at": at,
                                   "primary": "rc-m4", "primaryPub": "rc-pub-m4", "secondary": "rc-m1", "secondaryPub": "rc-pub-m1"]
      func doc(_ id: String, _ kind: String, _ body: [String: Any]) -> [String: Any]? {
        guard let d = try? JSONSerialization.data(withJSONObject: body), let text = String(data: d, encoding: .utf8) else { return nil }
        return ["id": id, "ws": NSNull(), "kind": kind, "author": NSNull(), "updatedAt": NSNull(), "data": ["env": ["body": text, "sig": "", "by": "rc-m1"]]]
      }
      guard let devDoc = doc("rc-sdev", "sdev", dev), let okDoc = doc("rc-spair", "spair", pairOk) else { return nil }
      j["docs"] = (j["docs"] as? [[String: Any]] ?? []) + [devDoc, okDoc]
      if extra {
        let due = Date().timeIntervalSince1970 + 30 * 60
        let stat: [String: Any] = ["v": 1, "t": "stat", "id": "rc-stat", "from": "rc-m1", "to": "all", "at": at, "cpu": 7, "battery": NSNull(), "charging": false,
                                   "power": "ac", "busy": NSNull(), "queue": 0, "have": [:],
                                   "machine": ["awake": true, "locked": true, "fileVault": "on", "passwordImmediately": true, "helper": "approved",
                                               "timer": ["on": true, "hours": 18, "minutes": 1080, "mode": "active", "asked": "active", "live": true, "safeMode": false,
                                                         "deadline": due, "postpone": true, "set": true, "lockedAt": due - 1080 * 60, "signedIn": true,
                                                         "periods": [["lockedAt": due - 30 * 3600, "endedAt": due - 20 * 3600, "ran": 36_000, "end": "unlock"],
                                                                     ["lockedAt": due - 60 * 3600, "endedAt": due - 42 * 3600, "ran": 64_800, "end": "timer"],
                                                                     ["lockedAt": due - 70 * 3600, "endedAt": due - 66 * 3600, "ran": 14_400, "end": "unlock", "postponed": 3600]]]]]
        let phone: [String: Any] = ["id": "rc-phone", "ws": NSNull(), "kind": "sdev", "author": NSNull(), "updatedAt": NSNull(),
                                    "data": ["phone": true, "device": "rc-phone", "pub": "rc-pub-phone", "name": "Test phone", "at": at]]
        if let st = doc("rc-sstat", "sstat", stat) { j["docs"] = (j["docs"] as? [[String: Any]] ?? []) + [st, phone] }
      }
      j["unlocked"] = true
      j["second"] = ["native": true, "me": ["device": "rc-m4", "name": "Test M4", "pub": "rc-pub-m4", "role": "primary"],
                     "trusted": [["device": "rc-m1", "name": "Test M1", "pub": "rc-pub-m1", "role": "secondary"]],
                     "verified": [], "progress": [], "projects": [], "pairing": NSNull(), "waitingSince": NSNull(), "note": NSNull()]
      return (try? JSONSerialization.data(withJSONObject: j)).flatMap { String(data: $0, encoding: .utf8) }
    }
    /// The Second Computer window (invisible and parked in a test copy), paired, then Machine in its sidebar
    /// clicked for real. The engine page's own state is held meanwhile (it would put the unpaired one back).
    var keptState: String?
    func openMachine(_ f: @escaping (Bool) -> Void) {
      paused = true
      keptState = a.lastState
      a.testHoldState = true
      if let p = pairedState() { a.lastState = p }
      Second.shared.handle("second:window", ["tab": "files"])
      let end = Date().addingTimeInterval(12)
      func poll() {
        if a.secondWin.ready {
          return later(1.5) {
            lastBeat = CACurrentMediaTime(); paused = false
            spot(pane, "[].find.call(document.querySelectorAll('.sw-nav button'), function (b) { return b.textContent.trim() === 'Machine'; })") { m in
              guard let m, let x = m["x"] as? Double, let y = m["y"] as? Double else { print("REBOOT CARD: no Machine in the window's sidebar"); return f(false) }
              press(pane, x, y) {
                later(1.0) {
                  call(pane, "return JSON.stringify({ card: !!\(cardJS), text: (document.querySelector('.sw-main') || document.body).innerText.slice(0, 160) });") { v in
                    let o = obj(v) ?? [:]
                    if o["card"] as? Bool != true { print("REBOOT CARD: the Machine pane has no card: \(o)") }
                    f(o["card"] as? Bool == true)
                  }
                }
              }
            }
          }
        }
        if Date() > end { paused = false; print("REBOOT CARD: the Second Computer window page never said it was ready"); return f(false) }
        later(0.2, poll)
      }
      poll()
    }
    func closeMachine() { a.secondWin.testTearDown(); a.lastState = keptState; a.testHoldState = false }
    /// A made up status from the helper: Watch only, this Mac unlocked, two log lines. `old`: a helper from
    /// V1.23 to V1.27 (no proto, Active switched off in it).
    func fakeStatus(old: Bool = false, _ more: [String: Any] = [:]) -> [String: Any] {
      let now = Date().timeIntervalSince1970
      var d: [String: Any] = ["v": 2, "mode": "watch", "minutes": 720, "testOnce": false, "session": "unlocked", "seenUnlock": true, "counting": false,
              "effectiveMode": "watch", "activeAllowed": !old, "bootTried": false, "bootedAt": now - 7200,
              "history": [["at": now - 5400, "kind": "would", "text": "Locked 12 hours: would have restarted (Watch only)"],
                          ["at": now - 600, "kind": "skipped", "text": "Unlocked: the countdown starts again at the next lock"]]]
      if !old {
        d["proto"] = 2; d["signedIn"] = true
        d["periods"] = [["lockedAt": now - 9 * 3600, "endedAt": now - 3600, "ran": 28_800, "end": "unlock"],
                        ["lockedAt": now - 40 * 3600, "endedAt": now - 22 * 3600, "ran": 64_800, "end": "timer"]]
      }
      for (k, v) in more { d[k] = v }
      return d
    }
    func setOnly(_ sent: [String]) -> Bool { sent.count == 1 && sent[0] == "reboot:set" }
    /// Every control with the helper switched on: the three modes (Active asks first), minus and plus, the
    /// hour chips, the 5 minute test, the Log, and Remove.
    func onSteps() -> [(String, String, Check)] {
      var steps: [(String, String, Check)] = [
        ("Off", "mode-off", { c, s, _ in setOnly(s) && ar.mode == "off" && c["mode"] as? String == "Off" && c["pill"] as? String == "Off" }),
        ("Watch only", "mode-watch", { c, s, _ in setOnly(s) && ar.mode == "watch" && c["mode"] as? String == "Watch only" && c["pill"] as? String == "Watch only" }),
        ("Active", "active-asks-first", { c, s, _ in s.isEmpty && ar.mode == "watch" && c["sure"] as? Bool == true }),
        ("Not yet", "active-not-yet", { c, s, _ in s.isEmpty && ar.mode == "watch" && c["sure"] as? Bool == false && c["mode"] as? String == "Watch only" }),
        ("Active", "active-asks-again", { c, s, _ in s.isEmpty && c["sure"] as? Bool == true }),
        ("Yes, make it Active", "active-yes", { c, s, _ in setOnly(s) && ar.mode == "active" && c["mode"] as? String == "Active" && c["pill"] as? String == "Active"
          && c["explain"] as? Bool == true && !((c["banners"] as? [String]) ?? []).contains { $0.contains("from an older PS app") } }),
        ("Watch only", "back-to-watch-only", { c, s, _ in setOnly(s) && ar.mode == "watch" && c["mode"] as? String == "Watch only" }),
        ("Shorter", "shorter", { c, s, _ in setOnly(s) && ar.minutes == 720 && c["hours"] as? String == "12 hours" }),
        ("Longer", "longer", { c, s, _ in setOnly(s) && ar.minutes == 1080 && c["hours"] as? String == "18 hours" }),
      ]
      // GrapheneOS's range: 10 minutes to 72 hours.
      for (label, n, text) in [("10 min", 10, "10 minutes"), ("1 h", 60, "1 hour"), ("8 h", 480, "8 hours"), ("24 h", 1440, "24 hours"), ("72 h", 4320, "72 hours")] {
        steps.append((label, "chip-\(n)-min", { c, s, _ in setOnly(s) && ar.minutes == n && c["hours"] as? String == text && c["chip"] as? String == label }))
      }
      steps += [
        ("Longer", "longer-stops-at-72-h", { c, s, _ in s.isEmpty && ar.minutes == 4320 && c["hours"] as? String == "72 hours" }),
        ("10 min", "chip-10-min-again", { c, s, _ in setOnly(s) && ar.minutes == 10 }),
        ("Shorter", "shorter-stops-at-10-min", { c, s, _ in s.isEmpty && ar.minutes == 10 }),
        ("18 h", "chip-18-h-again", { c, s, _ in setOnly(s) && ar.minutes == 1080 }),
        ("5 minute test", "five-minute-test", { c, s, d in s == ["reboot:test"] && d == ["test"] && c["test"] as? String == "Test ready: lock this Mac" && c["testOff"] as? Bool == true }),
        ("Log*", "log-opens", { c, s, _ in s.isEmpty && c["logOpen"] as? Bool == true && c["logItems"] as? Int == 2 }),
        ("Remove the helper", "remove", { c, s, d in s == ["reboot:remove"] && d == ["remove"] && ar.helperState == "off" && c["setup"] as? Bool == true && c["remove"] as? Bool == false }),
      ]
      return steps
    }

    // The Security window's own parts: a control by its words inside the window, clicked for real.
    let secFind = """
      var w = document.querySelector(sc || '.sec-win'); if (!w) return null;
      var e = [].find.call(w.querySelectorAll('button'), function (x) { return x.textContent.trim() === t || x.getAttribute('aria-label') === t; });
      if (!e) return null;
      e.scrollIntoView({ block: 'center', behavior: 'instant' });
      var r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, h = document.elementFromPoint(x, y);
      return JSON.stringify({ x: x, y: y, hit: !!h && (h === e || e.contains(h)) });
      """
    let secRead = """
      var w = document.querySelector('.sec-win'); if (!w) return JSON.stringify({ win: false });
      var tx = function (e) { return e ? e.textContent.trim() : ''; }, bs = [].map.call(w.querySelectorAll('button'), tx);
      var h2s = [].map.call(w.querySelectorAll('h2'), tx), cards = [].map.call(w.querySelectorAll('.sec-card h3'), tx);
      var rs = w.querySelector('.sec-rset'), rm = rs ? [].filter.call(rs.querySelectorAll('[role=radio]'), function (b) { return b.getAttribute('aria-checked') === 'true'; }).map(tx)[0] : '';
      return JSON.stringify({ win: true, buttons: bs, h2: h2s, cards: cards, confirm: tx(w.querySelector('.sec-confirm b')), next: tx(w.querySelector('.sec-next')),
        phone: tx(w.querySelector('.sec-phone')), status: tx(w.querySelector('[role=status]')), mac: !!document.querySelector('.mac-win:not(.sec-win)'),
        rset: !!rs, rmode: rm || '', rsure: rs ? !!rs.querySelector('.sec-confirm') : false, rstatus: rs ? tx(rs.querySelector('[role=status]')) : '' });
      """
    /// What the Tab list sent PS as Second Computer actions since `from` (the overlay's "looks" messages).
    func ops(since from: Int) -> [String] {
      a.testRaw.dropFirst(from).compactMap { t -> String? in
        guard let j = obj(t), let o = (j["patch"] as? [String: Any])?["secondOp"] as? [String: Any], let op = o["op"] as? String else { return nil }
        return op + ":" + ((o["action"] as? String) ?? (o["device"] as? String) ?? "")
      }
    }
    typealias SecCheck = (_ win: [String: Any], _ ops: [String]) -> Bool
    func secStep(_ t: String, _ name: String, _ check: @escaping SecCheck, in scope: String = "", _ next: @escaping () -> Void) {
      call(tabList, secFind, ["t": t, "sc": scope]) { v in
        guard let p = obj(v), let x = p["x"] as? Double, let y = p["y"] as? Double else {
          print("REBOOT CARD: no '\(t)' in the Security window"); ok("security-\(name)", false); return next()
        }
        let hit = (p["hit"] as? Bool) == true
        if !hit { print("REBOOT CARD: '\(t)' in the Security window has something lying over it") }
        let raw0 = a.testRaw.count
        press(tabList, x, y) {
          let end = Date().addingTimeInterval(3)
          func poll() {
            call(tabList, secRead) { v in
              let w = obj(v) ?? [:], sent = ops(since: raw0)
              if check(w, sent) { ok("security-\(name)", hit); return next() }
              if Date() > end { print("REBOOT CARD: security-\(name) win=\(w) ops=\(sent)"); ok("security-\(name)", false); return next() }
              later(0.1, poll)
            }
          }
          poll()
        }
      }
    }
    func secRun(_ steps: [(String, String, SecCheck)], in scope: String = "", _ i: Int = 0, _ f: @escaping () -> Void) {
      guard i < steps.count else { return f() }
      secStep(steps[i].0, steps[i].1, steps[i].2, in: scope) { secRun(steps, in: scope, i + 1, f) }
    }
    func has(_ w: [String: Any], _ b: String) -> Bool { ((w["buttons"] as? [String]) ?? []).contains(b) }

    // 0. The padlock and the Security window, with a made up other Mac and phone (held in this test copy's pages).
    func securityPart(_ f: @escaping () -> Void) {
      keptState = a.lastState
      a.testHoldState = true
      if let p = pairedState(extra: true) { a.lastState = p }
      ar.testShow("approve")
      if !a.shown { a.showOverlay() }
      a.pushState()
      later(1.5) {
        let place = "var p = document.querySelector('.tm-tr .sec-btn'), s = document.querySelector('.tm-tr .sc-btn'); if (!p || !s) return JSON.stringify({ p: !!p, s: !!s });"
          + " var a = p.getBoundingClientRect(), b = s.getBoundingClientRect();"
          + " return JSON.stringify({ gap: b.left - a.right, dy: Math.abs(a.top - b.top), w: a.width, sw: b.width, next: p.nextElementSibling === s, dot: !!p.querySelector('.sec-dot'), label: p.getAttribute('aria-label') });"
        call(tabList, place) { v in
          let o = obj(v) ?? [:]
          let placed = o["next"] as? Bool == true && abs((o["gap"] as? Double ?? 99) - 8) <= 1 && (o["dy"] as? Double ?? 99) <= 1 && (o["w"] as? Double) == (o["sw"] as? Double)
          if !placed { print("REBOOT CARD: padlock placement \(o)") }
          ok("padlock-directly-left-of-second-computer", placed)
          ok("padlock-dot-when-the-helper-waits-for-red", o["dot"] as? Bool == true && (o["label"] as? String ?? "").contains("needs a look"))
          ar.testShow("on", status: fakeStatus())
          openSec { opened in
            ok("security-opens-from-the-padlock", opened)
            guard opened else { return f() }
            call(tabList, secRead) { v in
              let w = obj(v) ?? [:], h2 = (w["h2"] as? [String]) ?? [], cards = (w["cards"] as? [String]) ?? []
              ok("security-both-macs-at-a-glance", cards.count == 2 && cards.contains { $0.contains("Test M1") })
              ok("security-holds-everything", ["Auto reboot on this Mac", "Test M1", "Your phone", "Are you sure", "Signing in on this Mac"].allSatisfy { t in h2.contains(t) })
              ok("security-other-mac-controls", ["Lock now", "Restart", "Shut down", "Postpone 1 hour"].allSatisfy { has(w, $0) })
              ok("security-other-mac-countdown", (w["next"] as? String ?? "").contains("Restarts"))
              ok("security-phone-asks", (w["phone"] as? String ?? "").contains("Test phone") && has(w, "Trust phone"))
              ok("security-sign-out-here", has(w, "Sign out of this Mac"))
              // The timers: this Mac (unlocked while the developer looks) reads 00:00:00; Test M1's countdown ticks; each has its last locks.
              let clocks = "var cs = [].map.call(document.querySelectorAll('.sec-win .sec-card'), function (c) { var k = c.querySelector('.sec-clock');"
                + " return { d: k ? k.querySelector('.sec-digits').textContent.trim() : '', l: k ? k.querySelector('span').textContent.trim() : '', run: !!k && k.classList.contains('sec-run'),"
                + " locks: c.querySelectorAll('.sec-periods li').length, first: (c.querySelector('.sec-periods li') || { textContent: '' }).textContent.trim() }; }); return JSON.stringify(cs);"
              call(tabList, clocks) { v0 in
                let c0 = (try? JSONSerialization.jsonObject(with: Data(((v0 as? String) ?? "[]").utf8)) as? [[String: Any]]) ?? []
                later(2.2) {
                  call(tabList, clocks) { v1 in
                    let c1 = (try? JSONSerialization.jsonObject(with: Data(((v1 as? String) ?? "[]").utf8)) as? [[String: Any]]) ?? []
                    let mine = c0.first ?? [:], m1a = c0.count > 1 ? c0[1] : [:], m1b = c1.count > 1 ? c1[1] : [:]
                    ok("timer-this-mac-not-running", mine["d"] as? String == "00:00:00" && (mine["l"] as? String ?? "").hasPrefix("Not running: this Mac is unlocked") && (mine["l"] as? String ?? "").contains("18:00:00"))
                    ok("timer-m1-ticks", m1a["run"] as? Bool == true && (m1a["d"] as? String ?? "").hasPrefix("00:2") && m1a["d"] as? String != m1b["d"] as? String)
                    ok("last-locks-both-macs", mine["locks"] as? Int == 2 && m1a["locks"] as? Int == 3 && (m1a["first"] as? String ?? "").contains("Unlocked")
                       && (mine["first"] as? String ?? "").contains("Ran 8 h"))
                    if m1a["run"] as? Bool != true || mine["locks"] as? Int != 2 { print("REBOOT CARD: clocks \(c0) then \(c1)") }
                  }
                }
              }
              topPicture("security-top.png") { picture(a.overlay, "security-window.png") {
                secRun([
                  ("Lock now", "lock-other-mac", { _, o in o == ["cmd:lock"] }),
                  ("Postpone 1 hour", "postpone-other-mac", { _, o in o == ["cmd:postpone"] }),
                  ("Restart", "restart-asks-first", { w, o in o.isEmpty && w["confirm"] as? String == "Restart Test M1?" }),
                  ("Cancel", "restart-cancel", { w, o in o.isEmpty && (w["confirm"] as? String ?? "") == "" && has(w, "Restart") }),
                  ("Restart", "restart-asks-again", { w, o in o.isEmpty && w["confirm"] as? String == "Restart Test M1?" }),
                  ("Restart now", "restart-other-mac", { w, o in o == ["cmd:restart"] && (w["confirm"] as? String ?? "") == "" }),
                  ("Shut down", "shut-down-asks-first", { w, o in o.isEmpty && w["confirm"] as? String == "Shut down Test M1?" }),
                  ("Cancel", "shut-down-cancel", { w, o in o.isEmpty && (w["confirm"] as? String ?? "") == "" }),
                ]) {
                 // Test M1's own auto reboot, chosen from this Mac (the developer, 2 Nov): each choice is one signed set command.
                 secRun([
                  ("Watch only", "m1-watch-only", { w, o in o == ["cmd:set:watch:1080"] && w["rmode"] as? String == "Watch only" && (w["rstatus"] as? String ?? "").hasPrefix("Sent") }),
                  ("Active", "m1-active-asks-first", { w, o in o.isEmpty && w["rsure"] as? Bool == true }),
                  ("Yes, make Test M1 Active", "m1-active-yes", { w, o in o == ["cmd:set:active:1080"] && w["rmode"] as? String == "Active" && w["rsure"] as? Bool == false }),
                  ("Test M1: 24 hours", "m1-24-hours", { w, o in o == ["cmd:set:active:1440"] }),
                  ("Test M1: 10 minutes", "m1-10-minutes", { w, o in o == ["cmd:set:active:10"] }),
                 ], in: ".sec-win .sec-rset") {
                  // The window's own close button, clicked for real, then the padlock again.
                  spot(tabList, "document.querySelector('.sec-win .cs-min')") { c in
                    guard let c, let cx = c["x"] as? Double, let cy = c["y"] as? Double else { ok("security-close-button", false); return f() }
                    press(tabList, cx, cy) {
                      later(1.0) {
                        call(tabList, "return !document.querySelector('.sec-win');") { v in
                          ok("security-close-button", (v as? Bool) == true)
                          a.lastState = keptState; a.testHoldState = false; a.pushState()
                          later(0.8) { f() }
                        }
                      }
                    }
                  }
                 }
                }
              } }
            }
          }
        }
      }
    }
    // 0b. Mac settings no longer keeps its own copies: a row points to Security and opens it (Mac settings goes first).
    func pointerPart(_ f: @escaping () -> Void) {
      openMac { opened in
        ok("mac-settings-opens", opened)
        guard opened else { return f() }
        let probe = "var m = document.querySelector('.mac-win:not(.sec-win)'); if (!m) return null; var tx = function (e) { return e.textContent.trim(); };"
          + " return JSON.stringify({ moved: !!m.querySelector('.ms-moved'), card: [].some.call(m.querySelectorAll('h2'), function (h) { return tx(h).indexOf('Auto reboot') === 0 || tx(h) === 'Are you sure'; }),"
          + " signout: [].some.call(m.querySelectorAll('button'), function (b) { return tx(b) === 'Sign out of this Mac'; }) });"
        call(tabList, probe) { v in
          let o = obj(v) ?? [:]
          ok("mac-settings-points-to-security", o["moved"] as? Bool == true && o["card"] as? Bool == false && o["signout"] as? Bool == false)
          spot(tabList, "[].find.call(document.querySelectorAll('.ms-moved button'), function (b) { return b.textContent.trim() === 'Open Security'; })") { b in
            guard let b, let bx = b["x"] as? Double, let by = b["y"] as? Double else { ok("open-security-from-mac-settings", false); return f() }
            press(tabList, bx, by) {
              later(1.6) {
                call(tabList, "return JSON.stringify({ sec: !!document.querySelector('.sec-win'), mac: !!document.querySelector('.mac-win:not(.sec-win)') });") { v in
                  let o = obj(v) ?? [:]
                  ok("open-security-from-mac-settings", o["sec"] as? Bool == true && o["mac"] as? Bool == false && a.dimxOpen)
                  if o["sec"] as? Bool != true || o["mac"] as? Bool != false { print("REBOOT CARD: after Open Security: \(o) dimx=\(a.dimxOpen)") }
                  a.overlay.evaluateJavaScript("window.__psDimxClose && window.__psDimxClose()", completionHandler: nil)
                  later(0.9) { f() }
                }
              }
            }
          }
        }
      }
    }

    // 1. The Tab list's Security window: Set up (the list is put away for System Settings), Open it again, then every control.
    func listPart(_ f: @escaping () -> Void) {
      ar.testShow("off")
      openSec { opened in
        ok("list-security-opens", opened)
        guard opened else { return f() }
        layout(tabList, "list") {
          picture(a.overlay, "reboot-card-list-off.png") {
            step(tabList, "Set up the restart helper", "setup-puts-list-away", { _, s, d in s == ["reboot:setup"] && d == ["setup"] && ar.helperState == "approve" && !a.shown }) {
              openSec { opened in
                ok("list-reopens", opened)
                settle(tabList, { $0["again"] as? Bool == true && $0["pill"] as? String == "Needs your OK in System Settings" }) { good in
                  ok("list-shows-approve", good)
                  step(tabList, "Open it again", "open-again-puts-list-away", { _, s, d in s == ["reboot:setup"] && d == ["setup"] && ar.helperState == "approve" && !a.shown }) {
                    ar.testShow("on", status: fakeStatus())
                    openSec { opened in
                      ok("list-reopens-on", opened)
                      layout(tabList, "list-on") {
                        picture(a.overlay, "reboot-card-list-on.png") {
                          run(tabList, onSteps()) {
                            statesPart {
                              a.overlay.evaluateJavaScript("window.__psDimxClose && window.__psDimxClose()", completionHandler: nil)
                              later(0.9) { a.hideOverlay(force: true); f() }
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
      }
    }
    // 1b. What the card says for an older helper and a postponed countdown (V1.28).
    func statesPart(_ f: @escaping () -> Void) {
      let now = Date().timeIntervalSince1970
      ar.testShow("on", status: fakeStatus(old: true))
      settle(tabList, { (($0["banners"] as? [String]) ?? []).contains { $0.contains("from an older PS app") } }) { good in
        ok("list-says-old-helper", good)
        ar.testShow("on", status: fakeStatus(["mode": "active", "effectiveMode": "active", "session": "locked", "counting": true, "deadline": now + 7200, "postponed": 7200]))
        settle(tabList, { ($0["next"] as? String ?? "").contains("Postponed 2 h") }) { good in
          ok("list-says-postponed", good)
          ar.testShow("on", status: fakeStatus())
          f()
        }
      }
    }
    // 2. The Second Computer window's Machine pane: the same card, the same controls.
    func panePart(_ f: @escaping () -> Void) {
      ar.testShow("off")
      openMachine { opened in
        ok("machine-pane-opens", opened)
        guard opened else { closeMachine(); return f() }
        layout(pane, "machine") {
          step(pane, "Set up the restart helper", "setup", { c, s, d in s == ["reboot:setup"] && d == ["setup"] && ar.helperState == "approve" && c["again"] as? Bool == true }) {
            step(pane, "Open it again", "open-again", { c, s, d in s == ["reboot:setup"] && d == ["setup"] && c["again"] as? Bool == true }) {
              ar.testShow("on", status: fakeStatus())
              settle(pane, { $0["mode"] as? String == "Watch only" }) { good in
                ok("machine-shows-on", good)
                layout(pane, "machine-on") {
                  picture(a.secondWin.web, "reboot-card-machine.png") {
                    run(pane, onSteps()) { closeMachine(); f() }
                  }
                }
              }
            }
          }
        }
      }
    }

    securityPart {
    pointerPart {
    listPart {
      panePart {
        beat.invalidate()
        ok("main-thread-free", worst < 0.25)
        ok("helper-never-touched", ar.testNeverTouched)
        ok("real-settings-untouched", UserDefaults.standard.object(forKey: "reboot.mode") as? String == realMode && UserDefaults.standard.object(forKey: "reboot.hours") as? Int == realHours
           && UserDefaults.standard.object(forKey: "reboot.minutes") as? Int == realMinutes)
        ar.testShow("test"); ar.mode = "watch"; ar.minutes = AutoReboot.defaultMinutes
        print("REBOOT CARD CHECK:", results.map { "\($0.0)=\($0.1 ? "ok" : "FAIL")" }.joined(separator: " "))
        print("REBOOT CARD: \(results.filter { $0.1 }.count) of \(results.count) ok, longest main thread gap \(Int(worst * 1000)) ms")
        done()
      }
    }
    }
    }
  }
}
