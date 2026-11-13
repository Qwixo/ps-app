// Self test for the torch (Torch.swift, class TorchLight), area "torch" (PS_SELFTEST_ONLY=torch). Test copies only:
// every system call is a FAKE (brightness, the stay awake assertion, the cursor, the app in front), and
// the window is parked far off screen by ScreenGuard, so nothing ever lights up the developer's screen, hides his
// cursor, changes his brightness or takes his keyboard. Native only: no page is needed.
// Covers: never over 1Password or Signal (also when one comes to the front while it is on), the window
// (borderless, above everything, the whole screen, parked here), the fade, ONLY Esc puts it away (Tab, any
// key, other shortcuts, clicks and another app coming forward leave it on), Cmd Q is the safety exit (a
// fake quit), the "Press Esc to turn off" hint (shown, faint on the colour, gone after 2 s), recolouring in
// place, the stay awake assertion and the cursor balanced, brightness to full and back to EXACTLY the level
// from before, the record on disk while raised, the exit restore, the next launch restore (and leaving alone
// a level changed since), the sleep close, coming back during the fade out, the main thread
// never waiting on a slow display, a bad colour from the page, and no torch window left behind.
// Not testable here: the real full screen colour, the real brightness and the real hidden cursor (the developer's
// screen), and a real crash or SIGTERM (the test copy would stop).
import AppKit

extension UpdaterSelfTest {
  /// The fake system: a display whose brightness lives in memory.
  final class TorchFake {
    private let lock = NSLock()
    private var _level: Float = 0.42
    var level: Float { get { lock.lock(); defer { lock.unlock() }; return _level } set { lock.lock(); _level = newValue; lock.unlock() } }
    private(set) var sets = 0
    var readable = true
    var slow = 0.0            // seconds each brightness write takes (a slow display)
    var held = 0, released = 0, hidden = 0, presented = 0
    var front = "com.apple.Safari"
    var quits = 0
    var protectedFlag = false
    func write(_ v: Float) -> Bool {
      if slow > 0 { Thread.sleep(forTimeInterval: slow) }
      lock.lock(); _level = v; sets += 1; lock.unlock()
      return true
    }
    func read() -> Float? { readable ? level : nil }
  }

  static func torchCheck() {
    print("TORCH CHECK:")
    let t = TorchLight.shared, f = TorchFake()
    let real = t.sys
    let screen = NSScreen.screens.first
    let disp = TorchLight.displayID(screen) ?? 1
    t.sys = TorchLightSystem(
      readBrightness: { _ in f.read() },
      setBrightness: { _, v in f.write(v) },
      holdAwake: { f.held += 1; return IOPMAssertionID(9000 + f.held) },
      releaseAwake: { _ in f.released += 1 },
      hideCursor: { f.hidden += 1 },
      showCursor: { f.hidden -= 1 },
      present: { w in f.presented += 1; w.orderFrontRegardless() },   // never key: the test copy never takes the developer's keyboard
      // Faked too: the test copy's real watcher follows the developer's real front app (it once saw 1Password come
      // forward mid run and the torch rightly refused to open, failing checks that had nothing to do with it).
      protectedFront: { f.protectedFlag || Protected.matches(f.front) },
      mouseScreen: { screen },
      quit: { f.quits += 1 })
    let fm = FileManager.default
    func restoreRecord() -> Float? {
      guard let d = try? Data(contentsOf: TorchLight.restoreFile), let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return nil }
      return (j["level"] as? NSNumber)?.floatValue
    }
    func key(_ code: UInt16, _ ch: String, _ mods: NSEvent.ModifierFlags = []) -> NSEvent {
      NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: mods, timestamp: ProcessInfo.processInfo.systemUptime,
                       windowNumber: t.window?.windowNumber ?? 0, context: nil, characters: ch, charactersIgnoringModifiers: ch, isARepeat: false, keyCode: code)!
    }
    func view() -> TorchLightView? { t.window?.contentView as? TorchLightView }
    func mouse(_ type: NSEvent.EventType) -> NSEvent? {
      NSEvent.mouseEvent(with: type, location: NSPoint(x: 20, y: 20), modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                         windowNumber: t.window?.windowNumber ?? 0, context: nil, eventNumber: 1, clickCount: 1, pressure: 1)
    }
    func torchWindows() -> Int { NSApp.windows.filter { $0 is TorchLightWindow && $0.isVisible }.count }
    func near(_ a: Float, _ b: Float) -> Bool { abs(a - b) < 0.0001 }
    let settle = TorchLight.fadeOut + Double(TorchLight.rampSteps) * TorchLight.rampStep + 0.35

    var steps: [(@escaping () -> Void) -> Void] = []

    // 1. Golden rule: never over 1Password or Signal.
    steps.append { next in
      for id in ["com.1password.1password", "com.agilebits.onepassword7", "org.whispersystems.signal-desktop"] {
        f.front = id
        let opened = t.show(color: "#ffffff", bright: true)
        check("refused-over-\(id.split(separator: ".")[1])", !opened && t.window == nil && t.lastRefused == "protected")
      }
      f.front = "com.apple.Safari"
      f.protectedFlag = true
      check("refused-while-protected-flag", !t.show(color: "#ffffff", bright: true) && t.window == nil)
      f.protectedFlag = false
      check("refused-touched-nothing", f.presented == 0 && f.held == 0 && f.hidden == 0 && f.sets == 0)
      check("refused-state-says-so", t.stateJSON().contains("\"refused\":\"protected\"") && t.stateJSON().contains("\"open\":false"))
      next()
    }
    // 2. Opens through the bridge: the window, the fade, the assertion, the cursor, brightness to full.
    var firstWin: ObjectIdentifier?
    steps.append { next in
      f.slow = 0.03
      var ticks = 0
      let ticker = Timer(timeInterval: 0.02, repeats: true) { _ in ticks += 1 }
      RunLoop.main.add(ticker, forMode: .common)
      t.handle("torch:open", ["color": "#FFF", "bright": true], from: nil)
      guard let w = t.window, let sc = screen else { check("opened", false); next(); return }
      firstWin = ObjectIdentifier(w)
      check("opened", t.open && t.lastRefused == nil && t.color == "#ffffff")
      check("borderless", !w.styleMask.contains(.titled))
      check("above-everything", w.level.rawValue > NSWindow.Level.screenSaver.rawValue, "level \(w.level.rawValue)")
      check("every-space-and-full-screen-apps", w.collectionBehavior.contains(.canJoinAllSpaces) && w.collectionBehavior.contains(.fullScreenAuxiliary))
      check("whole-screen-under-mouse", w.frame.width == sc.frame.width && w.frame.height == sc.frame.height, "\(Int(w.frame.width))x\(Int(w.frame.height))")
      check("parked-off-screen-in-test", w.frame.minX < ScreenGuard.parkX / 2 && !ScreenGuard.onAnyScreen(w.frame))
      check("fades-in", w.alphaValue < 0.5, String(format: "alpha %.2f at start", w.alphaValue))
      check("cursor-hidden", f.hidden == 1)
      check("kept-awake", f.held == 1 && f.released == 0)
      check("shown-without-taking-focus", f.presented == 1)
      // The hint: there, readable but faint on white (dark ink, see through).
      let h = t.hint
      let ink = h?.textColor?.usingColorSpace(.sRGB)
      check("hint-shown", h?.stringValue == "Press Esc to turn off" && h?.superview === w.contentView && (h?.alphaValue ?? 0) > 0.99)
      check("hint-faint-on-white", ink.map { $0.redComponent < 0.1 && $0.alphaComponent > 0.25 && $0.alphaComponent < 0.6 } ?? false)
      check("hint-at-the-bottom", (h?.frame.minY ?? 999) < 120 && abs((h?.frame.midX ?? 0) - (w.contentView?.bounds.midX ?? 1)) < 2)
      let onRed = TorchLight.hintColor("#d10a00").usingColorSpace(.sRGB)
      check("hint-light-on-red", onRed.map { $0.redComponent > 0.9 && $0.greenComponent > 0.9 && $0.alphaComponent < 0.7 } ?? false)
      later(0.95) {
        ticker.invalidate()
        check("faded-in", w.alphaValue > 0.99, String(format: "alpha %.2f", w.alphaValue))
        check("brightness-full", near(f.level, 1), "\(f.level)")
        check("level-from-before-on-disk", restoreRecord().map { near($0, 0.42) } ?? false)
        check("exit-paths-armed", TorchLight.signalsActive)
        check("main-thread-free-on-slow-display", ticks >= 30, "\(ticks) ticks in 0.95 s")
        check("state-open", t.stateJSON().contains("\"open\":true") && t.stateJSON().contains("\"color\":\"#ffffff\""))
        f.slow = 0
        next()
      }
    }
    // 3. Recolour in place: the same window, nothing taken twice.
    steps.append { next in
      t.handle("torch:open", ["color": "#00ff00"], from: nil)
      let same = t.window.map { ObjectIdentifier($0) } == firstWin
      check("recolour-same-window", same && f.presented == 1 && f.held == 1 && f.hidden == 1)
      later(0.3) {
        let c = t.window?.contentView?.layer?.backgroundColor.flatMap { NSColor(cgColor: $0)?.usingColorSpace(.sRGB) }
        check("recolour-green", t.color == "#00ff00" && (c.map { $0.greenComponent > 0.99 && $0.redComponent < 0.01 } ?? false))
        check("recolour-stays-full", near(f.level, 1))
        // Opened 1.25 s ago: the hint is gone 2 s + the fade after opening.
        later(TorchLight.hintFor + TorchLight.hintFade + 0.3 - 1.25) {
          check("hint-gone-after-2s", t.hint == nil && !(t.window?.contentView?.subviews.contains { $0 is NSTextField } ?? true))
          check("still-on-after-hint", t.open && !t.closing)
          next()
        }
      }
    }
    // 4. Esc puts it away: ordered out and released, brightness exactly back, everything let go.
    steps.append { next in
      weak var gone = t.window
      view()?.keyDown(with: key(53, "\u{1b}"))
      check("esc-closes", t.closing)
      check("closing-state-says-off", t.stateJSON().contains("\"open\":false"))
      later(settle) {
        check("window-released", t.window == nil && gone == nil && torchWindows() == 0)
        check("brightness-exactly-back", near(f.level, 0.42), "\(f.level)")
        check("cursor-back", f.hidden == 0)
        check("awake-released", f.released == 1 && f.held == 1)
        check("disk-record-cleared", !fm.fileExists(atPath: TorchLight.restoreFile.path))
        check("exit-paths-disarmed", !TorchLight.signalsActive)
        next()
      }
    }
    // 5. Only Esc: Tab, any key, other shortcuts, clicks, scrolling and another app in front leave it on.
    //    Cmd Q is the safety exit (here a fake quit; the restore at exit is step 10).
    steps.append { next in
      t.show(color: "#ff0000", bright: false)
      later(0.5) {
        // The view's own path, never the window's: a test window must never be made key (the developer's keyboard).
        view()?.keyDown(with: key(48, "\t"));                      check("tab-leaves-it-on", t.open && !t.closing)
        view()?.keyDown(with: key(0, "a"));                         check("any-key-leaves-it-on", t.open && !t.closing)
        view()?.keyDown(with: key(49, " "));                        check("space-leaves-it-on", t.open && !t.closing)
        let w = view()?.performKeyEquivalent(with: key(13, "w", .command)) ?? false
        check("cmd-w-swallowed-leaves-it-on", w && t.open && !t.closing)
        if let e = mouse(.leftMouseDown) { view()?.mouseDown(with: e) };   check("click-leaves-it-on", t.open && !t.closing)
        if let e = mouse(.rightMouseDown) { view()?.rightMouseDown(with: e) }; check("right-click-leaves-it-on", t.open && !t.closing)
        if let e = mouse(.otherMouseDown) { view()?.otherMouseDown(with: e) }; check("other-click-leaves-it-on", t.open && !t.closing)
        t.appActivated("com.apple.Safari", pid: 99_992);            check("other-app-front-leaves-it-on", t.open && !t.closing)
        check("nothing-quit-yet", f.quits == 0)
        let q = view()?.performKeyEquivalent(with: key(12, "q", .command)) ?? false
        check("cmd-q-is-the-safety-exit", q && f.quits == 1)
        view()?.keyDown(with: key(12, "q", .command))
        check("cmd-q-as-a-key-too", f.quits == 2)
        _ = view()?.performKeyEquivalent(with: key(12, "q", [.command, .option]))
        check("cmd-option-q-is-not-quit", f.quits == 2)
        view()?.cancelOperation(nil)
        check("esc-as-cancel-closes", t.closing || !t.open)
        later(settle) { check("esc-released", t.window == nil && torchWindows() == 0); next() }
      }
    }
    // 6. Brightness off: the level is never touched.
    steps.append { next in
      let before = f.sets
      t.show(color: "#ffffff", bright: false)
      later(0.6) {
        check("bright-off-leaves-level", near(f.level, 0.42) && f.sets == before && restoreRecord() == nil)
        t.close(why: "test")
        later(settle) { next() }
      }
    }
    // 7. Brought back during the fade out: one window, everything held once, then all let go.
    steps.append { next in
      t.show(color: "#ffffff", bright: true)
      later(0.7) {
        t.close(why: "test")
        later(0.06) {
          t.show(color: "#ffffff", bright: true)
          later(settle + 0.3) {
            check("reopen-during-fade-stays", t.open && !t.closing && t.window != nil && (t.window?.alphaValue ?? 0) > 0.99)
            check("reopen-balanced", f.held - f.released == 1 && f.hidden == 1)
            check("reopen-full", near(f.level, 1), "\(f.level)")
            t.close(why: "test")
            later(settle) {
              check("reopen-then-close-back", near(f.level, 0.42) && f.held == f.released && f.hidden == 0 && t.window == nil, "\(f.level)")
              next()
            }
          }
        }
      }
    }
    // 8. 1Password or Signal comes to the front while it is on: gone at once, no fade.
    steps.append { next in
      t.show(color: "#ffffff", bright: true)
      later(0.6) {
        t.appActivated("com.1password.1password", pid: 99_991)
        check("protected-front-closes-at-once", t.window == nil && !t.open)
        later(settle) { check("protected-front-level-back", near(f.level, 0.42)); next() }
      }
    }
    // 9. The Mac going to sleep puts it away (and the brightness back).
    steps.append { next in
      t.show(color: "#ffffff", bright: true)
      later(0.6) {
        NSWorkspace.shared.notificationCenter.post(name: NSWorkspace.willSleepNotification, object: NSWorkspace.shared)
        check("sleep-closes", t.window == nil && !t.open)
        later(settle) { check("sleep-level-back", near(f.level, 0.42)); next() }
      }
    }
    // 10. The exit path (atexit, stop signals, crash): put back at once, synchronously.
    steps.append { next in
      t.show(color: "#ffffff", bright: true)
      later(0.8) {
        check("exit-before-raised", near(f.level, 1))
        TorchLight.emergencyRestore()
        check("exit-restores-now", near(f.level, 0.42) && !fm.fileExists(atPath: TorchLight.restoreFile.path))
        t.close(why: "test")
        later(settle) { check("exit-then-close-stays-back", near(f.level, 0.42)); next() }
      }
    }
    // 11. The next launch: a level left on disk is put back only while the display is still at full.
    steps.append { next in
      TorchLight.writeRestore(display: disp, level: 0.3)
      f.level = 1
      TorchLight.restoreLeftover(t.sys) { r in
        DispatchQueue.main.async {
          check("launch-restores-left-level", r == "restored" && near(f.level, 0.3) && !fm.fileExists(atPath: TorchLight.restoreFile.path), r)
          TorchLight.writeRestore(display: disp, level: 0.3)
          f.level = 0.6
          TorchLight.restoreLeftover(t.sys) { r2 in
            DispatchQueue.main.async {
              check("launch-leaves-a-changed-level", r2 == "changed since" && near(f.level, 0.6) && !fm.fileExists(atPath: TorchLight.restoreFile.path), r2)
              try? Data("not json".utf8).write(to: TorchLight.restoreFile)
              TorchLight.restoreLeftover(t.sys) { r3 in
                DispatchQueue.main.async {
                  check("launch-ignores-a-bad-record", r3 == "none" && near(f.level, 0.6) && !fm.fileExists(atPath: TorchLight.restoreFile.path), r3)
                  f.level = 0.42
                  next()
                }
              }
            }
          }
        }
      }
    }
    // 12. A display that cannot report its brightness: the torch still works, the page is told.
    steps.append { next in
      f.readable = false
      let before = f.sets
      t.show(color: "#ffffff", bright: true)
      later(0.5) {
        check("no-brightness-still-lights", t.open && f.sets == before && t.stateJSON().contains("\"canBright\":false"))
        t.close(why: "test")
        f.readable = true
        later(settle) { next() }
      }
    }
    // 13. What the page may send: colours are cleaned, the setting is kept.
    steps.append { next in
      check("colour-short-form", TorchLight.cleanColor("#AbC") == "#aabbcc")
      check("colour-bad-refused", TorchLight.cleanColor("url(javascript:alert(1))") == nil && TorchLight.cleanColor("#12345g") == nil && TorchLight.cleanColor(nil) == nil)
      t.handle("torch:open", ["color": "red; background:url(x)"], from: nil)
      check("bad-colour-is-white", t.color == "#ffffff")
      t.close(why: "test")
      later(settle) {
        t.handle("torch:state", ["bright": false], from: nil)
        check("setting-kept", t.stateJSON().contains("\"bright\":false"))
        t.handle("torch:state", ["bright": true], from: nil)
        check("not-a-torch-message", !t.handle("state", [:], from: nil))
        next()
      }
    }
    // Run them in order, then the totals.
    func run(_ i: Int) {
      guard i < steps.count else {
        check("no-torch-window-left", torchWindows() == 0 && t.window == nil)
        check("all-let-go", f.held == f.released && f.hidden == 0 && near(f.level, 0.42), "held \(f.held) released \(f.released) hidden \(f.hidden) level \(f.level)")
        t.sys = real
        print("TORCH TOTAL:", fails == 0 ? "0 FAIL" : "\(fails) FAIL")
        // selftest.sh reads only lines with "CHECK:" for failures: one summary line it can see.
        print("TORCH SUMMARY CHECK: \(fails == 0 ? "ok" : "FAIL") fails=\(fails)")
        print(ScreenGuard.report()); print(NetGuard.report()); print("DONE")
        exit(fails == 0 ? 0 : 1)
      }
      steps[i]({ run(i + 1) })
    }
    // Long enough at the end for the network check to have taken its samples.
    later(0.5) { run(0) }
  }
}
