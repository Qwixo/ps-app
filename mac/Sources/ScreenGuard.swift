// Keeping PS's invisible windows off the developer's screen (the developer, 18 Oct 2026).
// An invisible window that still covers the screen hides every desktop preview in Mission Control
// (fixed for the live list on 16 Oct by tucking it to one pixel; it came back through the self test
// copies, whose list window sat full screen at alpha 0 for minutes). Three parts:
//  - Self test copies put every window far off to the left of every screen before it is ever shown
//    (setFrame and ordering are redirected), so a test can never touch the developer's screen, Mission Control,
//    or the saved place of his real PS window. Pages still draw: occlusion detection is off for them.
//  - The live app checks every 2 s: the list window is never left larger than 1x1 while hidden, and
//    any PS window that is invisible but on screen for over 3 s is logged.
//  - The self test watches every PS window on screen (its own and the live app's, through the
//    window server) and fails if one bigger than 2x2 sits on screen invisibly for over 3 s, or if a
//    test copy window shows up on a screen at all.
import Cocoa
import WebKit

enum ScreenGuard {
  // ---------- self test copies: windows live far off screen ----------
  static let parkX: CGFloat = -60000
  static func parked(_ r: NSRect) -> NSRect { r.minX < parkX / 2 ? r : r.offsetBy(dx: parkX, dy: 0) }
  private static var installed = false

  /// Self test copies only: from now on no PS window can be placed on (or shown on) a real screen.
  static func installTestParking() {
    guard !installed else { return }
    installed = true
    // A test copy is a background app: no Dock icon, and macOS never hands it focus when another
    // app steps back (a full run on 20 Oct found one active during the card checks). If it ever is
    // active anyway, it gives focus straight back and the screen check counts it as a failure.
    NSApp.setActivationPolicy(.accessory)
    NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
      activations += 1
      print(String(format: "SCREEN GUARD: the test copy became active %.1f s after launch, giving focus back", ProcessInfo.processInfo.systemUptime - launchedAt))
      NSApp.deactivate()
    }
    let pairs: [(Selector, Selector)] = [
      (#selector(NSWindow.setFrame(_:display:)), #selector(NSWindow.ps_parkSetFrame(_:display:))),
      (#selector(NSWindow.setFrame(_:display:animate:)), #selector(NSWindow.ps_parkSetFrame(_:display:animate:))),
      (#selector(NSWindow.setFrameOrigin(_:)), #selector(NSWindow.ps_parkSetFrameOrigin(_:))),
      (#selector(NSWindow.setFrameTopLeftPoint(_:)), #selector(NSWindow.ps_parkSetFrameTopLeftPoint(_:))),
      (#selector(NSWindow.order(_:relativeTo:)), #selector(NSWindow.ps_parkOrder(_:relativeTo:))),
      // macOS pulls a titled window back until part of it is on a screen: not for a test copy.
      (#selector(NSWindow.constrainFrameRect(_:to:)), #selector(NSWindow.ps_parkConstrain(_:to:))),
    ]
    for (a, b) in pairs {
      if let m1 = class_getInstanceMethod(NSWindow.self, a), let m2 = class_getInstanceMethod(NSWindow.self, b) { method_exchangeImplementations(m1, m2) }
    }
    // Backstop: anything that still reaches a screen (a frame set some other way) goes straight back.
    // Common run loop modes: a modal window (an alert, a panel) or a menu being tracked runs the loop in
    // another mode, where a default mode timer never fires and such a window stayed on screen (P3, 27 Oct).
    let backstop = Timer(timeInterval: 0.1, repeats: true) { _ in
      for w in NSApp.windows {
        if w.isVisible && onAnyScreen(w.frame) { lateParks += 1; w.setFrame(parked(w.frame), display: false) }
        if let v = w.contentView { keepDrawing(in: v) }
      }
    }
    RunLoop.main.add(backstop, forMode: .common)
  }
  static var lateParks = 0
  static var activations = 0
  static let launchedAt = ProcessInfo.processInfo.systemUptime
  /// A parked window counts as covered, and WebKit stops drawing its page (pictures came out blank):
  /// every web view in a test copy's windows keeps drawing (WebKit SPI, test copies only).
  private static var drawing = Set<ObjectIdentifier>()
  private static func keepDrawing(in v: NSView) {
    if let web = v as? WKWebView, !drawing.contains(ObjectIdentifier(web)) {
      drawing.insert(ObjectIdentifier(web))
      let sel = NSSelectorFromString("_setWindowOcclusionDetectionEnabled:")
      if web.responds(to: sel) {
        typealias SetBool = @convention(c) (AnyObject, Selector, Bool) -> Void
        unsafeBitCast(web.method(for: sel), to: SetBool.self)(web, sel, false)
      }
    }
    v.subviews.forEach(keepDrawing(in:))
  }
  static func onAnyScreen(_ r: NSRect) -> Bool { NSScreen.screens.contains { $0.frame.intersects(r) } }

  // ---------- the live app: nothing invisible stays on screen ----------
  private static var since: [Int: Double] = [:]
  /// Every 2 s in the live app. `tuck` shrinks the hidden list window back to one pixel.
  static func startLiveGuard(overlay: @escaping () -> NSWindow?, listShown: @escaping () -> Bool, tuck: @escaping () -> Void) {
    Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { _ in
      if let p = overlay(), !listShown(), p.frame.width * p.frame.height > 4 {
        psLog("PS screen guard: hidden list window was \(Int(p.frame.width))x\(Int(p.frame.height)), tucked back to one pixel")
        tuck()
      }
      let now = CACurrentMediaTime()
      for w in NSApp.windows {
        let bad = w.isVisible && w.alphaValue < 0.05 && w.frame.width > 2 && w.frame.height > 2 && onAnyScreen(w.frame)
        if !bad { since[w.windowNumber] = nil; continue }
        let t0 = since[w.windowNumber] ?? now
        since[w.windowNumber] = t0
        if now - t0 > 3, now - t0 < 5 { psLog("PS screen guard: an invisible window (\(Int(w.frame.width))x\(Int(w.frame.height))) has been on screen for 3 s") }
      }
    }.tolerance = 0.5
  }

  // ---------- the self test's watch, through the window server ----------
  struct Seen { var first: Double; var last: Double; var size: String; var who: String; var what = "" }
  private static var seen: [String: Seen] = [:]
  private static var watchTimer: Timer?
  /// Watches this test copy's windows and the live PS's: what is on a screen, how big, how see-through.
  static func startTestWatch() {
    let me = ProcessInfo.processInfo.processIdentifier
    watchTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { _ in
      let live = NSRunningApplication.runningApplications(withBundleIdentifier: "com.cincee.ps").map(\.processIdentifier).filter { $0 != me }
      guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] else { return }
      var displays = [CGDirectDisplayID](repeating: 0, count: 16); var n: UInt32 = 0
      CGGetActiveDisplayList(16, &displays, &n)
      let screens = displays.prefix(Int(n)).map { CGDisplayBounds($0) }
      let now = CACurrentMediaTime()
      for w in list {
        guard let pid = w[kCGWindowOwnerPID as String] as? Int32, pid == me || live.contains(pid),
              let b = w[kCGWindowBounds as String] as? [String: CGFloat] else { continue }
        let r = CGRect(x: b["X"] ?? 0, y: b["Y"] ?? 0, width: b["Width"] ?? 0, height: b["Height"] ?? 0)
        guard r.width > 2, r.height > 2, screens.contains(where: { $0.intersects(r) }) else { continue }
        let alpha = w[kCGWindowAlpha as String] as? Double ?? 1
        let mine = pid == me
        // A test copy window on a screen counts whatever its alpha; a live one only while invisible.
        guard mine || alpha < 0.05 else { continue }
        let id = "\(pid)-\(w[kCGWindowNumber as String] as? Int ?? 0)"
        var s = seen[id] ?? Seen(first: now, last: now, size: "\(Int(r.width))x\(Int(r.height))", who: mine ? "test copy" : "live PS", what: describe(w, mine: mine))
        s.last = now
        seen[id] = s
      }
    }
  }
  /// Window title and owner class for the report (own windows only: the class comes from NSApp.windows).
  private static func describe(_ w: [String: Any], mine: Bool) -> String {
    let title = (w[kCGWindowName as String] as? String) ?? ""
    var cls = "?"
    if mine, let n = w[kCGWindowNumber as String] as? Int, let win = NSApp.window(withWindowNumber: n) {
      cls = String(describing: type(of: win))
      return "\(cls) title=\"\(title.isEmpty ? win.title : title)\" level=\(win.level.rawValue) frame=\(Int(win.frame.minX)),\(Int(win.frame.minY))"
    }
    let layer = w[kCGWindowLayer as String] as? Int ?? 0
    return "\(cls) title=\"\(title)\" layer=\(layer) (not an NSApp window)"
  }
  /// One line for the self test log. Fails on any test copy window seen on a screen, or a live PS
  /// window left invisible on screen for over 3 s.
  static func report() -> String {
    let test = seen.values.filter { $0.who == "test copy" }
    let live = seen.values.filter { $0.who == "live PS" && $0.last - $0.first > 3 }
    let ok = test.isEmpty && live.isEmpty && activations == 0
    let detail = (test + live).map { "\($0.who) \($0.size) [\($0.what)] for \(String(format: "%.1f", $0.last - $0.first)) s" }
    return "SCREEN CHECK: \(ok ? "ok" : "FAIL") test-copy-windows-on-screen=\(test.count) live-invisible-over-3s=\(live.count) late-parks=\(lateParks) test-copy-became-active=\(activations)" + (detail.isEmpty ? "" : " " + detail.joined(separator: ", "))
  }
}

extension NSWindow {
  @objc func ps_parkSetFrame(_ r: NSRect, display: Bool) { ps_parkSetFrame(ScreenGuard.parked(r), display: display) }
  @objc func ps_parkSetFrame(_ r: NSRect, display: Bool, animate: Bool) { ps_parkSetFrame(ScreenGuard.parked(r), display: display, animate: animate) }
  @objc func ps_parkSetFrameOrigin(_ p: NSPoint) { ps_parkSetFrameOrigin(ScreenGuard.parked(NSRect(origin: p, size: frame.size)).origin) }
  @objc func ps_parkSetFrameTopLeftPoint(_ p: NSPoint) {
    let r = ScreenGuard.parked(NSRect(x: p.x, y: p.y - frame.height, width: frame.width, height: frame.height))
    ps_parkSetFrameTopLeftPoint(NSPoint(x: r.minX, y: r.maxY))
  }
  @objc func ps_parkConstrain(_ r: NSRect, to screen: NSScreen?) -> NSRect { ScreenGuard.parked(r) }
  @objc func ps_parkOrder(_ place: NSWindow.OrderingMode, relativeTo other: Int) {
    if place != .out, frame.minX >= ScreenGuard.parkX / 2 { setFrame(ScreenGuard.parked(frame), display: false) }
    ps_parkOrder(place, relativeTo: other)
  }
}

// ---------- test copies never go online (the developer's Little Snitch, 20 Oct 2026) ----------
// Every 2 s the test copy lists the network sockets of itself and of every WebKit helper its pages
// use (page, graphics and, where WebKit says, networking processes). Any socket at all is a failure.
enum NetGuard {
  private static var seen: [String: Int] = [:]
  private static var samples = 0
  private static var pidsSeen = Set<Int32>()
  static func start() {
    Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { _ in
      var pids = Set([getpid()])
      for w in NSApp.windows { if let v = w.contentView { collect(v, &pids) } }
      pidsSeen.formUnion(pids)
      let list = pids.filter { $0 > 0 }.map(String.init).joined(separator: ",")
      DispatchQueue.global(qos: .utility).async {
        let p = Process(), out = Pipe()
        p.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        p.arguments = ["-nP", "-a", "-i", "-p", list]
        p.standardOutput = out; p.standardError = Pipe()
        guard (try? p.run()) != nil else { return }
        let text = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        p.waitUntilExit()
        let lines = text.split(separator: "\n").dropFirst().map { l -> String in
          let f = l.split(separator: " ", omittingEmptySubsequences: true)
          return f.count >= 9 ? "\(f[0]) \(f[7]) \(f[8...].joined(separator: " "))" : String(l)
        }
        DispatchQueue.main.async { samples += 1; for l in lines { seen[l, default: 0] += 1 } }
      }
    }
  }
  private static func collect(_ v: NSView, _ pids: inout Set<Int32>) {
    if let web = v as? WKWebView {
      for key in ["_webProcessIdentifier", "_gpuProcessIdentifier", "_networkProcessIdentifier"] where web.responds(to: NSSelectorFromString(key)) {
        if let n = web.value(forKey: key) as? Int32, n > 0 { pids.insert(n) }
      }
      let store = web.configuration.websiteDataStore
      if store.responds(to: NSSelectorFromString("_networkProcessIdentifier")), let n = store.value(forKey: "_networkProcessIdentifier") as? Int32, n > 0 { pids.insert(n) }
    }
    v.subviews.forEach { collect($0, &pids) }
  }
  static func report() -> String {
    let ok = seen.isEmpty && samples > 0
    return "NETWORK CHECK: \(ok ? "ok" : "FAIL") sockets=\(seen.count) samples=\(samples) processes-watched=\(pidsSeen.count)" + (seen.isEmpty ? "" : " " + seen.keys.sorted().prefix(8).joined(separator: " | "))
  }
}
