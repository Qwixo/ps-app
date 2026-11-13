import Cocoa

// Self test for "Tab keeps the list open" (the developer, 7 Nov 2026), area `tabstays` (also in `watchdog` and
// the full run). Keys go straight into the tap's own decision code on another thread, as they do for
// real; anything the tap would send on is recorded, never typed. No real keyboard tap, no real hotkey.
// Checks: the default is off for the developer and on for anyone else, a choice wins over it; with it on, hold
// Tab and let go keeps the list up, a quick tap is still a Tab, the next hold hides it, Esc closes it,
// a pinned screen stays and goes with it, / and . does the same, the Signal path (SafePeek) keeps it
// without the keyboard, the watchdog still passes Tab; with it off, letting go hides as before.
extension SelfTest {
  static func tabStays(_ a: App, _ done: @escaping () -> Void) {
    let w = TabWatch.shared
    if Protected.front { print("TAB STAYS CHECK: skipped (1Password or Signal is in front, where the tap is off by design)"); done(); return }
    if !w.enabled || w.triggerKey != "tab" { print("TAB STAYS CHECK: skipped (Tab over other apps is off or set to Right Option on this Mac)"); done(); return }
    let was = (a.vaultUnlocked, w.appActive, w.frontID, w.staysChoice)
    a.vaultUnlocked = true; w.appActive = false; w.frontID = nil
    if a.shown { a.hideOverlay(force: true) }
    w.mu.lock(); w.testPosted = []; w.state = .idle; w.held = nil; w.pinned = false; w.editing = false; w.closingHold = false; w.mu.unlock()
    let names: [Int64: String] = [48: "⇥", 44: "/", 47: ".", 53: "⎋", 0: "a"]
    typealias K = (code: Int64, down: Bool, shift: Bool)
    func k(_ c: Int64, _ d: Bool, shift: Bool = false) -> K { (c, d, shift) }
    func tap(_ c: Int64) -> [K] { [k(c, true), k(c, false)] }
    /// Feeds keys to the tap and returns what would reach the app, as text (⇧ marks Shift).
    /// The page's own state and the real front app can change the starting point mid run (the vault state,
    /// The developer's app coming forward), so it is set back before every feed.
    func feed(_ keys: [K], stuck: Bool = false) -> String {
      if !Thread.isMainThread { DispatchQueue.main.sync { a.vaultUnlocked = true; w.mu.lock(); w.appActive = false; w.frontID = nil; w.mu.unlock() } }
      var out: [CGEvent] = []
      for x in keys {
        let e = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(x.code), keyDown: x.down)!
        e.flags = x.shift ? .maskShift : []
        w.mu.lock(); w.testPosted = []; w.mu.unlock()
        if stuck { w.beat = CACurrentMediaTime() - 5 }   // as if main had not answered for 5 s
        let r = w.handle(x.down ? .keyDown : .keyUp, e)
        w.mu.lock(); out += w.testPosted ?? []; w.mu.unlock()
        if r != nil { out.append(e) }
      }
      return out.filter { $0.type == .keyDown }.map { ($0.flags.contains(.maskShift) ? "⇧" : "") + (names[$0.getIntegerValueField(.keyboardEventKeycode)] ?? "?") }.joined()
    }
    var res: [String] = []
    var ok = true
    func check(_ name: String, _ pass: Bool, _ extra: String = "") { if !pass { ok = false }; res.append("\(name)=\(pass ? "ok" : "FAIL")\(extra.isEmpty ? "" : "(\(extra))")") }
    func expect(_ name: String, _ got: String, _ want: String) { check(name, got == want, got == want ? "" : "got \"\(got)\" want \"\(want)\"") }
    func state(_ name: String, shown: Bool, pinned: Bool? = nil) {
      DispatchQueue.main.sync {
        w.mu.lock(); let p = w.pinned; w.mu.unlock()
        check(name, a.shown == shown && (pinned == nil || p == pinned), "shown=\(a.shown) pinned=\(p)")
      }
    }
    let hold = HOLD_SECONDS + 0.3
    /// After a Tab down: wait until the tap has taken it as a hold (its timer runs on main, which can be
    /// slow in a busy test copy), so a slow main never turns the test's hold into a quick tap.
    func waitHold() {
      let t0 = CACurrentMediaTime()
      while CACurrentMediaTime() - t0 < 4 {
        Thread.sleep(forTimeInterval: 0.03)
        w.mu.lock(); let s = w.state; w.mu.unlock()
        if s != .pending { break }
      }
      DispatchQueue.main.sync {}   // the show or hide it queued has run
    }
    /// The Signal path's hold timer also runs on main: wait for the list to show (up to 4 s).
    func waitShown() {
      let t0 = CACurrentMediaTime()
      while CACurrentMediaTime() - t0 < 4 { Thread.sleep(forTimeInterval: 0.03); if DispatchQueue.main.sync(execute: { a.shown }) { break } }
    }

    // The default: off for the developer, on for anyone else; a choice made in Settings wins.
    w.setStays(nil)
    let red = Owner.red
    w.mu.lock(); let def = w.stays; w.mu.unlock()
    check("default-off-for-red-on-for-others", TabWatch.staysDefault(red: true) == false && TabWatch.staysDefault(red: false) == true)
    check("default-here", def == !red, "red=\(red) on=\(def)")
    w.setStays(!def)
    w.mu.lock(); let chosen = w.stays; w.mu.unlock()
    check("choice-wins", chosen == !def && w.staysChoice == !def)

    w.setStays(true)
    DispatchQueue.global(qos: .userInteractive).async {
      // Hold, let go: it stays. A quick tap is a Tab. Hold again: it goes.
      expect("hold-types-nothing", feed([k(48, true)]), "")
      waitHold()
      state("hold-shows", shown: true)
      expect("release-types-nothing", feed([k(48, false)]), "")
      Thread.sleep(forTimeInterval: 0.3)
      state("release-stays", shown: true, pinned: true)
      expect("quick-tap-is-a-tab", feed(tap(48)), "⇥")
      Thread.sleep(forTimeInterval: hold)
      state("quick-tap-keeps-it", shown: true, pinned: true)
      expect("shift-tab-passes", feed([k(48, true, shift: true), k(48, false, shift: true)]), "⇧⇥")
      expect("typing-a-passes", feed(tap(0)), "a")
      expect("hold-again-types-nothing", feed([k(48, true)]), "")
      waitHold()
      state("hold-again-hides", shown: false)
      expect("its-release-types-nothing", feed([k(48, false)]), "")
      Thread.sleep(forTimeInterval: 0.3)
      state("stays-hidden", shown: false, pinned: false)
      expect("hidden-quick-tap-is-a-tab", feed(tap(48)), "⇥")
      Thread.sleep(forTimeInterval: hold)
      state("hidden-quick-tap-shows-nothing", shown: false)

      // Esc closes a kept list.
      _ = feed([k(48, true)]); waitHold(); _ = feed([k(48, false)]); Thread.sleep(forTimeInterval: 0.3)
      state("kept-before-esc", shown: true, pinned: true)
      expect("esc-swallowed", feed([k(53, true)]), "")
      Thread.sleep(forTimeInterval: 0.4)
      _ = feed([k(53, false)])
      state("esc-closes", shown: false, pinned: false)

      // A pinned screen: pinned while Tab is held, letting go keeps both up; the next hold hides both.
      _ = feed([k(48, true)]); waitHold()
      DispatchQueue.main.sync { a.pinChanged(true) }
      _ = feed([k(48, false)]); Thread.sleep(forTimeInterval: 0.3)
      state("pinned-screen-stays", shown: true, pinned: true)
      _ = feed([k(48, true)]); waitHold()
      state("pinned-screen-hold-hides", shown: false)
      _ = feed([k(48, false)]); Thread.sleep(forTimeInterval: 0.3)
      DispatchQueue.main.sync { a.pinChanged(false) }

      // The watchdog: main stuck, Tab passes straight through even with the list kept.
      _ = feed([k(48, true)]); waitHold(); _ = feed([k(48, false)]); Thread.sleep(forTimeInterval: 0.3)
      expect("watchdog-passes-tab", feed([k(48, true)], stuck: true), "⇥")
      w.heartbeat()
      _ = feed([k(48, false)])
      DispatchQueue.main.sync { a.hideOverlay(force: true) }
      Thread.sleep(forTimeInterval: 0.3)
      w.mu.lock(); w.state = .idle; w.held = nil; w.pinned = false; w.mu.unlock()

      // Hold / and press . : the same.
      if w.slashOn {
        expect("chord-types-nothing", feed([k(44, true), k(47, true)]), "")
        Thread.sleep(forTimeInterval: 0.35)
        state("chord-shows", shown: true)
        expect("chord-release-types-nothing", feed([k(47, false), k(44, false)]), "")
        Thread.sleep(forTimeInterval: 0.3)
        state("chord-stays", shown: true, pinned: true)
        expect("chord-again-types-nothing", feed([k(44, true), k(47, true)]), "")
        Thread.sleep(forTimeInterval: 0.35)
        state("chord-again-hides", shown: false)
        _ = feed([k(47, false), k(44, false)])
        Thread.sleep(forTimeInterval: 0.3)
        state("chord-again-release-stays-hidden", shown: false)
        expect("after-chord-/-types", feed(tap(44)), "/")
      } else { res.append("chord=skipped(off on this Mac)") }

      // Signal (SafePeek, simulated hotkey): kept, never takes the keyboard, the next press hides it.
      DispatchQueue.main.sync { SafePeek.shared.hit(1, pressed: true) }
      waitShown()
      state("signal-hold-shows", shown: true)
      DispatchQueue.main.sync { SafePeek.shared.hit(1, pressed: false) }
      Thread.sleep(forTimeInterval: 0.3)
      state("signal-release-stays", shown: true, pinned: true)
      DispatchQueue.main.sync { check("signal-no-keyboard", !a.panel.isKeyWindow) }
      DispatchQueue.main.sync { SafePeek.shared.hit(1, pressed: true) }
      Thread.sleep(forTimeInterval: 0.3)
      state("signal-press-hides", shown: false)
      DispatchQueue.main.sync { SafePeek.shared.hit(1, pressed: false) }
      Thread.sleep(forTimeInterval: 0.3)

      // Off: exactly as before. Letting go hides, a tap is a Tab.
      w.setStays(false)
      _ = feed([k(48, true)]); waitHold()
      state("off-hold-shows", shown: true)
      expect("off-release-types-nothing", feed([k(48, false)]), "")
      Thread.sleep(forTimeInterval: 0.3)
      state("off-release-hides", shown: false, pinned: false)
      expect("off-quick-tap-is-a-tab", feed(tap(48)), "⇥")
      Thread.sleep(forTimeInterval: hold)
      state("off-quick-tap-shows-nothing", shown: false)

      DispatchQueue.main.async {
        w.mu.lock(); w.editing = false; w.pinned = false; w.state = .idle; w.held = nil; w.testPosted = nil; w.closingHold = false; w.mu.unlock()
        a.hideOverlay(force: true)
        w.setStays(was.3)
        a.vaultUnlocked = was.0; w.appActive = was.1; w.frontID = was.2
        print("TAB STAYS CHECK:", ok ? "ok" : "FAIL", res.joined(separator: " "), "red=\(red) default=\(def ? "on" : "off")")
        done()
      }
    }
  }
}
