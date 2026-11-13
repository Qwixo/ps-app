// Sentry overlay trial (sentry-real-lock, the developer 12 Nov 2026, option d: "Ideally I want the protected by a PS lock screen",
// then "Yes, try it"). NOT part of PS.app: build.sh compiles Sources/ only, so this never ships. The developer runs it by hand:
//   bash tools/sentry-overlay-trial/run.sh            (windows made after the lock)
//   bash tools/sentry-overlay-trial/run.sh --prepare  (windows made, invisible and click through, just before the lock)
//
// What it does:
//  1. Checks it can work at all (unlocked now, the lock call, the input idle time, the SkyLight calls). If not, it stops
//     before locking anything.
//  2. Locks the Mac for real with the same call PS uses (SACLockScreenImmediate, as Control Command Q).
//  3. Once macOS says locked, shows a black "Protected by PS" screen on every display, ABOVE Apple's lock screen, by
//     putting its windows in a private SkyLight space at absolute level 400 (the level of Notification Center on the
//     lock screen; the lock screen is 300). PRIVATE API: it may stop working after any macOS update.
//  4. Decoration only: no password field, no Touch ID call, never the key window (typing always goes to Apple's
//     password field). Any touch, click or key puts it aside (it only reads HOW LONG since the last input, never what
//     was typed) so Apple's own prompt shows; it comes back after 10 quiet seconds.
//  5. Ends by itself the moment macOS says unlocked (Touch ID or the password), after 10 minutes, or if anything fails.
//     Ending only closes this program: Apple's lock screen stays and the Mac stays locked until the developer unlocks it.
//     A watchdog on its own queue does the unlocked and time limit checks too, so a stuck main thread cannot keep a
//     black screen over an unlocked Mac.
// Log: ~/Library/Logs/PS/sentry-overlay-trial.log (whether the space was made, return codes, whether clicks reach the
// window on the lock screen, each step). Nothing else is written, nothing is sent anywhere, no setting is changed.
import Cocoa
import IOKit
import IOKit.pwr_mgt

// MARK: the log

let logURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/PS/sentry-overlay-trial.log")
let logQ = DispatchQueue(label: "trial.log")
func log(_ s: String) {
  let line = "\(ISO8601DateFormatter().string(from: Date())) \(s)\n"
  FileHandle.standardOutput.write(Data(line.utf8))
  logQ.async {
    try? FileManager.default.createDirectory(at: logURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    if let h = try? FileHandle(forWritingTo: logURL) { h.seekToEndOfFile(); h.write(Data(line.utf8)); try? h.close() }
    else { try? Data(line.utf8).write(to: logURL) }
  }
}
func end(_ why: String, code: Int32 = 0) -> Never {
  log("trial: ends (\(why)). Apple's lock screen stays if the Mac is locked.")
  logQ.sync {}
  exit(code)
}

// MARK: the Mac (the same calls as PS's RemoteCommand.swift; read only apart from the lock)

enum Mac {
  /// macOS says the console screen is locked (as PS's RemoteCommand.screenLocked).
  static func locked() -> Bool {
    guard let d = CGSessionCopyCurrentDictionary() as? [String: Any] else { return true }
    if (d["kCGSSessionOnConsoleKey"] as? Bool) == false { return true }
    return (d["CGSSessionScreenIsLocked"] as? Bool) == true
  }
  private static let lockSym: UnsafeMutableRawPointer? = {
    guard let h = dlopen("/System/Library/PrivateFrameworks/login.framework/Versions/Current/login", RTLD_LAZY) else { return nil }
    return dlsym(h, "SACLockScreenImmediate")
  }()
  static var canLock: Bool { lockSym != nil }
  /// The same lock as Control Command Q (as PS's RemoteCommand.lockScreen).
  static func lock() -> Bool {
    guard let sym = lockSym else { return false }
    typealias Fn = @convention(c) () -> Void
    unsafeBitCast(sym, to: Fn.self)()
    return true
  }
  /// Seconds since the last touch, click or key anywhere (IOHIDSystem HIDIdleTime). Never what was typed.
  static func idle() -> Double? {
    var it: io_iterator_t = 0
    guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IOHIDSystem"), &it) == KERN_SUCCESS else { return nil }
    defer { IOObjectRelease(it) }
    let e = IOIteratorNext(it)
    guard e != 0 else { return nil }
    defer { IOObjectRelease(e) }
    guard let v = IORegistryEntryCreateCFProperty(e, "HIDIdleTime" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? NSNumber else { return nil }
    return v.doubleValue / 1_000_000_000
  }
}

// MARK: SkyLight (PRIVATE, looked up at run time; the trial stops before locking if any is missing)

final class Sky {
  typealias MainCID = @convention(c) () -> Int32
  typealias SpaceCreate = @convention(c) (Int32, Int32, Int32) -> Int32
  typealias SetLevel = @convention(c) (Int32, Int32, Int32) -> Int32
  typealias ShowSpaces = @convention(c) (Int32, CFArray) -> Int32
  typealias AddWindows = @convention(c) (Int32, Int32, CFArray, Int32) -> Int32
  private let cid: Int32
  private let space: Int32
  private let add: AddWindows

  init?() {
    guard let h = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/Versions/A/SkyLight", RTLD_NOW),
          let a = dlsym(h, "SLSMainConnectionID"), let b = dlsym(h, "SLSSpaceCreate"), let c = dlsym(h, "SLSSpaceSetAbsoluteLevel"),
          let d = dlsym(h, "SLSShowSpaces"), let e = dlsym(h, "SLSSpaceAddWindowsAndRemoveFromSpaces") else {
      log("sky: a SkyLight call is missing on this macOS"); return nil
    }
    cid = unsafeBitCast(a, to: MainCID.self)()
    space = unsafeBitCast(b, to: SpaceCreate.self)(cid, 1, 0)
    add = unsafeBitCast(e, to: AddWindows.self)
    guard space != 0 else { log("sky: SLSSpaceCreate gave 0 (connection \(cid))"); return nil }
    let lv = unsafeBitCast(c, to: SetLevel.self)(cid, space, TrialCore.spaceLevel)
    // macOS 27 (tgtools123/NUEM issue 6): SLSShowSpaces no longer returns 0 although the space does show. Logged, ignored.
    let sh = unsafeBitCast(d, to: ShowSpaces.self)(cid, [space] as CFArray)
    log("sky: connection \(cid), space \(space), set level \(TrialCore.spaceLevel) -> \(lv), show -> \(sh) (non zero is normal on macOS 27)")
    guard lv == 0 else { log("sky: the level was refused"); return nil }
  }
  /// Moves a window into the space above the lock screen.
  func raise(_ w: NSWindow) -> Int32 { add(cid, space, [w.windowNumber] as CFArray, 7) }
}

// MARK: the cover (a look alike of PS's Sentry screen; decoration only)

final class CoverWindow: NSPanel {
  override var canBecomeKey: Bool { false }    // never the key window: keys always go to Apple's password field
  override var canBecomeMain: Bool { false }
}
final class CoverView: NSView {
  var onInput: ((String) -> Void)?
  override var isFlipped: Bool { false }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func mouseDown(with e: NSEvent) { onInput?("mouse down") }
  override func rightMouseDown(with e: NSEvent) { onInput?("right mouse down") }
  override func scrollWheel(with e: NSEvent) { onInput?("scroll") }
  override func mouseMoved(with e: NSEvent) { onInput?("mouse moved") }
  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    for t in trackingAreas { removeTrackingArea(t) }
    addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseMoved, .activeAlways, .inVisibleRect], owner: self))
  }
}

final class Cover {
  let window: CoverWindow
  let view: CoverView
  init(screen: NSScreen) {
    window = CoverWindow(contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    window.isReleasedWhenClosed = false
    window.canBecomeVisibleWithoutLogin = true
    window.level = NSWindow.Level(rawValue: Int(CGShieldingWindowLevel()))
    window.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
    window.hidesOnDeactivate = false; window.hasShadow = false; window.animationBehavior = .none
    window.isOpaque = false; window.backgroundColor = .black
    window.alphaValue = 0
    window.ignoresMouseEvents = true
    view = CoverView(frame: NSRect(origin: .zero, size: screen.frame.size))
    view.wantsLayer = true
    view.layer?.backgroundColor = NSColor.black.cgColor
    window.contentView = view
    draw(scale: screen.backingScaleFactor)
  }
  private func draw(scale: CGFloat) {
    guard let root = view.layer else { return }
    let W = view.bounds.width, H = view.bounds.height
    let ink = NSColor(srgbRed: 0.93, green: 0.95, blue: 1, alpha: 0.94), soft = NSColor(srgbRed: 0.66, green: 0.74, blue: 1, alpha: 1)
    let blue = NSColor(srgbRed: 0.56, green: 0.66, blue: 1, alpha: 1), violet = NSColor(srgbRed: 0.79, green: 0.64, blue: 1, alpha: 1)
    let s: CGFloat = min(110, max(72, H * 0.1)), cx = W / 2, top = H / 2 + s * 1.15
    // The shield, as PS's SentryCover.shieldPath.
    let p = CGMutablePath(), k = s / 24
    func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * k, y: (24 - y) * k) }
    p.move(to: pt(12, 3)); p.addLine(to: pt(19, 6)); p.addLine(to: pt(19, 12))
    p.addCurve(to: pt(12, 21), control1: pt(19, 16.5), control2: pt(16, 19.5))
    p.addCurve(to: pt(5, 12), control1: pt(8, 19.5), control2: pt(5, 16.5))
    p.addLine(to: pt(5, 6)); p.closeSubpath()
    p.move(to: pt(9.5, 12)); p.addLine(to: pt(11.5, 14)); p.addLine(to: pt(15, 10.5))
    let shield = CAShapeLayer()
    shield.frame = CGRect(x: 0, y: 0, width: s, height: s)
    shield.path = p; shield.fillColor = NSColor.clear.cgColor; shield.strokeColor = NSColor.white.cgColor
    shield.lineWidth = max(3, s / 24 * 1.6); shield.lineCap = .round; shield.lineJoin = .round
    let fill = CAGradientLayer()
    fill.frame = CGRect(x: cx - s / 2, y: top - s / 2, width: s, height: s)
    fill.colors = [blue.cgColor, violet.cgColor]; fill.startPoint = CGPoint(x: 0, y: 1); fill.endPoint = CGPoint(x: 1, y: 0)
    fill.mask = shield
    root.addSublayer(fill)
    var y = top - s / 2 - 34
    func text(_ str: String, size: CGFloat, weight: NSFont.Weight, color: NSColor, h: CGFloat, gap: CGFloat) {
      let l = CATextLayer()
      let para = NSMutableParagraphStyle(); para.alignment = .center
      l.string = NSAttributedString(string: str, attributes: [.font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: color, .paragraphStyle: para])
      l.contentsScale = scale; l.alignmentMode = .center; l.isWrapped = true
      y -= h; l.frame = CGRect(x: cx - 320, y: y, width: 640, height: h); y -= gap
      root.addSublayer(l)
    }
    text("Protected by PS", size: 38, weight: .semibold, color: ink, h: 48, gap: 6)
    text("Sentry mode engaged", size: 19, weight: .medium, color: soft, h: 26, gap: 30)
    text("Trial. Touch anything to see your lock screen. Touch ID or your password ends it.", size: 13, weight: .regular, color: ink.withAlphaComponent(0.5), h: 18, gap: 0)
  }
  func fade(in on: Bool, quick: Bool) {
    window.ignoresMouseEvents = !on   // aside: every click goes straight to Apple's lock screen
    NSAnimationContext.runAnimationGroup { c in
      c.duration = quick ? 0.12 : (on ? 0.6 : 0.25)
      window.animator().alphaValue = on ? 1 : 0
    }
  }
}

// MARK: the trial

final class Trial: NSObject, NSApplicationDelegate {
  let prepare = CommandLine.arguments.contains("--prepare")
  let started = Date()
  var lockAsked = Date()
  var phase = TrialCore.Phase.waitingLock
  var everShown = false
  var sky: Sky?
  var covers: [Cover] = []
  var displayHold: IOPMAssertionID = 0
  var loggedInput: Set<String> = []
  let poll = DispatchQueue(label: "trial.poll", qos: .userInitiated)
  let dog = DispatchQueue(label: "trial.watchdog", qos: .userInitiated)
  var tick: DispatchSourceTimer?
  var dogTimer: DispatchSourceTimer?

  func applicationDidFinishLaunching(_ n: Notification) {
    log("trial: start, \(ProcessInfo.processInfo.operatingSystemVersionString), \(NSScreen.screens.count) screen(s), windows \(prepare ? "made before the lock (--prepare)" : "made after the lock")")
    let s = Sky()
    if let why = TrialCore.refusal(lockedNow: Mac.locked(), idleReadable: Mac.idle() != nil, skyLight: s != nil, lockCall: Mac.canLock) {
      end("not started: \(why). Nothing was locked", code: 1)
    }
    sky = s
    if prepare { makeCovers() }   // invisible and click through until the lock is seen
    // The lock screen turns the display off quickly; keep it on for the trial so the developer can see (let go when this ends).
    IOPMAssertionCreateWithName(kIOPMAssertionTypePreventUserIdleDisplaySleep as CFString, IOPMAssertionLevel(kIOPMAssertionLevelOn),
                                "PS Sentry overlay trial" as CFString, &displayHold)
    DistributedNotificationCenter.default().addObserver(forName: .init("com.apple.screenIsUnlocked"), object: nil, queue: .main) { _ in
      end("macOS said unlocked")
    }
    startWatchdog()
    lockAsked = Date()
    log("trial: locking the Mac (the same call as Control Command Q)")
    poll.async {
      let ok = Mac.lock()
      if !ok { DispatchQueue.main.async { end("the lock call failed", code: 1) } }
    }
    let t = DispatchSource.makeTimerSource(queue: poll)
    t.schedule(deadline: .now() + 0.2, repeating: 0.2, leeway: .milliseconds(40))
    t.setEventHandler { [weak self] in
      let locked = Mac.locked(), idle = Mac.idle()   // read off the main thread
      DispatchQueue.main.async { self?.step(locked: locked, idle: idle) }
    }
    t.resume(); tick = t
  }

  /// Independent of the main thread: unlocked after a lock was seen, or past the time limit, ends the program.
  func startWatchdog() {
    var sawLocked = false
    let t0 = Date()
    let t = DispatchSource.makeTimerSource(queue: dog)
    t.schedule(deadline: .now() + 0.2, repeating: 0.2, leeway: .milliseconds(40))
    t.setEventHandler {
      let locked = Mac.locked()
      if locked { sawLocked = true }
      if TrialCore.watchdogQuits(sawLocked: sawLocked, lockedNow: locked, sinceStart: Date().timeIntervalSince(t0)) {
        log("trial watchdog: \(sawLocked && !locked ? "unlocked" : "time limit")")
        end("watchdog")
      }
    }
    t.resume(); dogTimer = t
  }

  func step(locked: Bool, idle: Double?) {
    let s = TrialCore.step(phase, everShown: everShown, locked: locked, idle: idle,
                           sinceStart: Date().timeIntervalSince(started), sinceLockAsked: Date().timeIntervalSince(lockAsked))
    switch s {
    case .wait: break
    case .locked:
      log("trial: macOS says locked after \(String(format: "%.2f", Date().timeIntervalSince(lockAsked))) s")
      if covers.isEmpty { makeCovers() }
    case .show:
      everShown = true
      log("trial: showing Protected by PS above the lock screen (idle \(String(format: "%.1f", idle ?? -1)) s)")
      for c in covers { c.window.orderFrontRegardless(); c.fade(in: true, quick: false) }
      reportWindows()
    case .stepAside:
      log("trial: input (idle \(String(format: "%.2f", idle ?? -1)) s), stepping aside for Apple's prompt")
      for c in covers { c.fade(in: false, quick: false) }
    case .quit(let why): end(why)
    }
    phase = TrialCore.next(phase, s)
  }

  func makeCovers() {
    guard let sky else { return }
    covers = NSScreen.screens.map { Cover(screen: $0) }
    for c in covers {
      c.view.onInput = { [weak self] what in self?.input(what) }
      c.window.orderFrontRegardless()   // alpha 0 and click through until shown
      let r = sky.raise(c.window)
      log("trial: window \(c.window.windowNumber) moved to the space above the lock screen -> \(r)")
    }
  }

  /// Whether clicks reach the window on the lock screen (the answer for Sleep mode's alarm Stop). Logged once each.
  func input(_ what: String) {
    if loggedInput.insert(what).inserted { log("trial: the window itself got \(what) while \(phase == .shown ? "showing" : "aside")") }
    if phase == .shown { for c in covers { c.fade(in: false, quick: true) }; phase = .aside }
  }

  /// What the window server says about our windows (layer, on screen), off the main thread.
  func reportWindows() {
    let ids = Set(covers.map { CGWindowID($0.window.windowNumber) })
    poll.async {
      let list = (CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]]) ?? []
      for w in list {
        guard let n = w[kCGWindowNumber as String] as? NSNumber, ids.contains(CGWindowID(n.uint32Value)) else { continue }
        log("trial: window \(n) layer \(w[kCGWindowLayer as String] ?? "?") on screen \(w[kCGWindowIsOnscreen as String] ?? "?")")
      }
    }
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)   // no Dock icon, never activates
let trial = Trial()
app.delegate = trial
app.run()
