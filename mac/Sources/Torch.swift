// The torch (Minecraft mode, V1.31; the developer, 4 Nov 2026: "If I click on the torch icon, it comes up with
// basically a full screen of whiteness so I can use my MacBook as a torch, and different colours of the
// torch as well, red, green, white"). Built for power cuts: no network, no web files needed
// once the page has asked for it.
//
// What it does:
//  - One borderless window of one pure colour over the WHOLE display under the mouse (menu bar and Dock
//    too), above every other window, fading in and out smoothly. The cursor is hidden while it is on.
//  - ONLY Esc puts it away (the developer, 4 Nov 2026: a bumped trackpad or key must never turn it off in the
//    dark). Clicks, Tab and every other key do nothing. A faint "Press Esc to turn off" shows at the bottom
//    for 2 s when it opens, then fades. Safety exits if Esc is somehow never received: Cmd Q quits PS and
//    a PS restart (or crash) ends it too, both putting the brightness back. The Mac going to sleep, the
//    screens changing and 1Password or Signal coming forward also put it away; another app coming
//    forward does not.
//  - The Mac stays awake while it is on (an IOPMAssertion that stops the display sleeping).
//  - Full brightness (a setting, on by default, sent by the page): the built in display goes to full
//    while the torch is on and back to EXACTLY the level it had when the torch is put away. The level
//    from before is written to disk before anything changes, so if PS quits, is stopped or crashes it
//    is put back too: at exit (atexit), on SIGTERM, SIGINT, SIGHUP and SIGQUIT (a dispatch source, so
//    the restore never runs inside a signal handler), on a crash signal (best effort), and at the next
//    launch (only while the display is still at full, so a level the developer set himself since is never undone).
//  - Golden rule: it never opens while 1Password or Signal is in front, and closes at once if one of
//    them comes to the front. Only the bundle id of the app in front is checked (Protected.swift).
//  - No invisible leftover window ever (ScreenGuard.swift): when put away the window is ordered out and
//    released, nothing stays on screen at alpha 0.
// It never takes focus from the app in front (a key window that does not activate PS, as the Tab
// list does), so nothing has to be handed back when it goes.
// Bridge (src/views/minecraft/torch-bridge.ts), from the Tab list page or the main page:
//   torch:open {color:"#rrggbb", bright?:bool}   opens it, or recolours it if it is already on
//   torch:close                                  puts it away
//   torch:state {bright?:bool}                   asks for the state (and saves the brightness setting)
// The answer goes back to the page that asked, and to every page that talked to the torch whenever
// the state changes: window.__psTorch({open, color, bright, canBright, refused?}).
// Nothing on the main thread blocks: brightness is read and set on a serial background queue.
// Test copies (TorchSelfTest.swift, area "torch") swap every system call for a fake: no real
// brightness, no real assertion, no cursor change, no activation, and the window is parked off screen.
// Type names carry "Light" (TorchLight, TorchLightWindow...) so they never clash with another torch
// built in parallel for the same panel (minecraft-mode's Minecraft.swift); the main chat keeps one.
import Cocoa
import IOKit.pwr_mgt
import WebKit

/// Everything the torch asks of the system, in one place so the self test can swap it for fakes.
struct TorchLightSystem {
  /// The built in display's brightness, 0...1 (nil when this display cannot report it).
  var readBrightness: (CGDirectDisplayID) -> Float?
  var setBrightness: (CGDirectDisplayID, Float) -> Bool
  var holdAwake: () -> IOPMAssertionID?
  var releaseAwake: (IOPMAssertionID) -> Void
  var hideCursor: () -> Void
  var showCursor: () -> Void
  /// Shows the window and makes it key WITHOUT activating PS (as the Tab list does), so the app in
  /// front keeps its place and gets the keyboard back by itself when the torch goes.
  var present: (NSWindow) -> Void
  /// True while 1Password or Signal is in front (Protected.swift's flag, or the bundle id in front).
  var protectedFront: () -> Bool
  /// The screen under the mouse.
  var mouseScreen: () -> NSScreen?
  /// Cmd Q while the torch has the keyboard: the safety exit, PS quits (and the brightness goes back at exit).
  var quit: () -> Void

  static let real = TorchLightSystem(
    readBrightness: { TorchLightBrightness.read($0) },
    setBrightness: { TorchLightBrightness.write($0, $1) },
    holdAwake: {
      var id: IOPMAssertionID = 0
      let ok = IOPMAssertionCreateWithName(kIOPMAssertionTypePreventUserIdleDisplaySleep as CFString, IOPMAssertionLevel(kIOPMAssertionLevelOn),
                                           "PS torch is on" as CFString, &id)
      return ok == kIOReturnSuccess ? id : nil
    },
    releaseAwake: { IOPMAssertionRelease($0) },
    hideCursor: { TorchLightBrightness.cursorInBackground(); NSCursor.hide() },
    showCursor: { NSCursor.unhide() },
    present: { w in w.orderFrontRegardless(); w.makeKey(); w.makeFirstResponder(w.contentView) },
    protectedFront: { Protected.front || Protected.matches(NSWorkspace.shared.frontmostApplication?.bundleIdentifier) },
    mouseScreen: {
      let p = NSEvent.mouseLocation
      return NSScreen.screens.first { NSMouseInRect(p, $0.frame, false) } ?? NSScreen.main ?? NSScreen.screens.first
    },
    quit: { NSApp.terminate(nil) })
}

/// The display brightness through DisplayServices (a system framework without a public header, loaded
/// at run time; if it is missing the torch simply never changes the brightness).
enum TorchLightBrightness {
  private typealias GetFn = @convention(c) (UInt32, UnsafeMutablePointer<Float>) -> Int32
  private typealias SetFn = @convention(c) (UInt32, Float) -> Int32
  private typealias CanFn = @convention(c) (UInt32) -> Bool
  private static let lib = dlopen("/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices", RTLD_LAZY)
  private static func sym<T>(_ name: String, _ t: T.Type) -> T? {
    guard let lib, let p = dlsym(lib, name) else { return nil }
    return unsafeBitCast(p, to: t)
  }
  private static let getFn = sym("DisplayServicesGetBrightness", GetFn.self)
  private static let setFn = sym("DisplayServicesSetBrightness", SetFn.self)
  private static let canFn = sym("DisplayServicesCanChangeBrightness", CanFn.self)

  static func read(_ d: CGDirectDisplayID) -> Float? {
    guard let getFn, canFn?(d) ?? true else { return nil }
    var v: Float = -1
    guard getFn(d, &v) == 0, v >= 0, v <= 1.0001 else { return nil }
    return min(v, 1)
  }
  static func write(_ d: CGDirectDisplayID, _ v: Float) -> Bool {
    guard let setFn else { return false }
    return setFn(d, max(0, min(1, v))) == 0
  }

  /// Lets PS hide the cursor even while another app is still in front (the torch opens from the Tab
  /// list, which never takes focus). Best effort: without it the cursor hides once PS is in front.
  private typealias ConnFn = @convention(c) () -> Int32
  private typealias PropFn = @convention(c) (Int32, Int32, CFString, CFTypeRef) -> Int32
  private static var cursorDone = false
  static func cursorInBackground() {
    guard !cursorDone else { return }
    cursorDone = true
    let cg = dlopen("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices", RTLD_LAZY)
    guard let cg, let c = dlsym(cg, "_CGSDefaultConnection"), let s = dlsym(cg, "CGSSetConnectionProperty") else { return }
    let conn = unsafeBitCast(c, to: ConnFn.self)(), set = unsafeBitCast(s, to: PropFn.self)
    _ = set(conn, conn, "SetsCursorInBackground" as CFString, kCFBooleanTrue)
  }
}

/// The torch's window: borderless, takes the keys (a non activating panel can be key while another
/// app is in front), never in the window cycle, Mission Control or the Dock.
final class TorchLightWindow: NSPanel {
  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { false }
}

/// The one colour. Takes every key and click so nothing reaches the app behind; only Esc (and Cmd Q,
/// the safety exit) does anything.
final class TorchLightView: NSView {
  var onInput: ((String) -> Void)?
  private static let blank = NSCursor(image: NSImage(size: NSSize(width: 1, height: 1)), hotSpot: .zero)
  override var acceptsFirstResponder: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  static func isCmdQ(_ e: NSEvent) -> Bool {
    e.keyCode == 12 && e.modifierFlags.intersection([.command, .control, .option]) == .command
  }
  override func keyDown(with e: NSEvent) {
    if e.keyCode == 53 { onInput?("esc") } else if TorchLightView.isCmdQ(e) { onInput?("quit") }   // anything else: nothing, no beep
  }
  override func performKeyEquivalent(with e: NSEvent) -> Bool {
    guard e.type == .keyDown else { return false }
    if TorchLightView.isCmdQ(e) { onInput?("quit") }
    return true        // every other shortcut is swallowed: no PS menu item fires behind the torch
  }
  override func cancelOperation(_ sender: Any?) { onInput?("esc") }
  override func mouseDown(with e: NSEvent) {}
  override func rightMouseDown(with e: NSEvent) {}
  override func otherMouseDown(with e: NSEvent) {}
  override func scrollWheel(with e: NSEvent) {}
  override func resetCursorRects() { addCursorRect(bounds, cursor: TorchLightView.blank) }
}

final class TorchLight {
  static let shared = TorchLight()
  var sys = TorchLightSystem.real
  private let test = UpdatePaths.test

  // Timings (the self test reads them).
  static let fadeIn = 0.32, fadeOut = 0.26
  /// The "Press Esc to turn off" hint: shown this long, then faded out over hintFade.
  static let hintFor = 2.0, hintFade = 0.6
  static let hintText = "Press Esc to turn off"
  /// Brightness steps toward full and back, so the screen does not jump.
  static let rampSteps = 10, rampStep = 0.028

  private(set) var window: TorchLightWindow?
  private(set) var color = "#ffffff"
  private(set) var bright = true
  private(set) var open = false
  private(set) var closing = false
  private(set) var lastRefused: String?
  private(set) var hint: NSTextField?
  private var hintGen = 0
  private var gen = 0
  private var assertion: IOPMAssertionID?
  private var cursorHidden = false
  private var observers: [(NotificationCenter, NSObjectProtocol)] = []
  private var keyMonitor: Any?
  private var pages: [WeakWeb] = []
  private struct WeakWeb { weak var web: WKWebView? }

  // Brightness: only touched on this queue. `raisedFrom` is what to put back (also read by the exit
  // and signal paths, under `levelLock`).
  private let q = DispatchQueue(label: "ps.torch.brightness", qos: .userInitiated)
  private var rampGen = 0                       // q only
  private var canBright = true                  // last known, for the page
  static let levelLock = NSLock()
  static var raisedFrom: (display: CGDirectDisplayID, level: Float)?

  private init() {
    if !test {
      let d = UserDefaults.standard
      if let c = d.string(forKey: "torch.color"), let ok = TorchLight.cleanColor(c) { color = ok }
      if d.object(forKey: "torch.bright") != nil { bright = d.bool(forKey: "torch.bright") }
    }
  }

  // MARK: colours

  /// "#rrggbb" (or "rrggbb", or "#rgb"), lower case; anything else is nil.
  static func cleanColor(_ s: String?) -> String? {
    guard var t = s?.trimmingCharacters(in: .whitespaces).lowercased() else { return nil }
    if t.hasPrefix("#") { t.removeFirst() }
    if t.count == 3 { t = t.map { "\($0)\($0)" }.joined() }
    guard t.count == 6, t.allSatisfy({ $0.isHexDigit }) else { return nil }
    return "#" + t
  }
  static func nsColor(_ hex: String) -> NSColor {
    let v = UInt32(String((cleanColor(hex) ?? "#ffffff").dropFirst()), radix: 16) ?? 0xffffff
    return NSColor(srgbRed: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255, blue: CGFloat(v & 0xff) / 255, alpha: 1)
  }

  // MARK: the bridge

  /// From main.swift's message switch. True when the message was the torch's.
  @discardableResult func handle(_ type: String, _ msg: [String: Any], from web: WKWebView?) -> Bool {
    guard type.hasPrefix("torch:") else { return false }
    if let web, !pages.contains(where: { $0.web === web }) { pages.append(WeakWeb(web: web)) }
    pages.removeAll { $0.web == nil }
    switch type {
    case "torch:open":
      let c = TorchLight.cleanColor(msg["color"] as? String) ?? "#ffffff"
      let b = msg["bright"] as? Bool ?? bright
      if !show(color: c, bright: b) { reply(to: web) }
    case "torch:close": close(why: "page")
    case "torch:state":
      if let b = msg["bright"] as? Bool { bright = b; save() }
      reply(to: web)
    default: return false
    }
    return true
  }

  func stateJSON() -> String {
    var d: [String: Any] = ["open": open && !closing, "color": color, "bright": bright, "canBright": canBright]
    if let r = lastRefused { d["refused"] = r }
    let data = (try? JSONSerialization.data(withJSONObject: d, options: [.sortedKeys])) ?? Data("{}".utf8)
    return String(data: data, encoding: .utf8) ?? "{}"
  }
  private func reply(to web: WKWebView?) {
    let js = "window.__psTorch && window.__psTorch(\(stateJSON()))"
    if let web { web.evaluateJavaScript(js, completionHandler: nil) }
  }
  private func broadcast() {
    let js = "window.__psTorch && window.__psTorch(\(stateJSON()))"
    pages.removeAll { $0.web == nil }
    for p in pages { p.web?.evaluateJavaScript(js, completionHandler: nil) }
  }
  private func save() {
    guard !test else { return }
    UserDefaults.standard.set(color, forKey: "torch.color")
    UserDefaults.standard.set(bright, forKey: "torch.bright")
  }

  // MARK: open and close

  /// Opens the torch in `color` (or recolours it). False when it was refused (1Password or Signal in front).
  @discardableResult func show(color c: String, bright b: Bool) -> Bool {
    dispatchPrecondition(condition: .onQueue(.main))
    let hex = TorchLight.cleanColor(c) ?? "#ffffff"
    // Golden rule: never over 1Password or Signal.
    if sys.protectedFront() {
      lastRefused = "protected"
      psLog("PS torch: not opened, a protected app is in front")
      return false
    }
    lastRefused = nil
    color = hex; bright = b; save()
    if let w = window, open {
      // Already on (or fading out): recolour, and fade back in if it was going.
      let wasClosing = closing
      closing = false
      gen += 1
      NSAnimationContext.runAnimationGroup { ctx in
        ctx.duration = 0.18; ctx.allowsImplicitAnimation = true
        w.contentView?.layer?.backgroundColor = TorchLight.nsColor(hex).cgColor
      }
      w.backgroundColor = TorchLight.nsColor(hex)
      hint?.textColor = TorchLight.hintColor(hex)
      if wasClosing {
        // Brought back while it was fading out: everything close let go of is taken again.
        sys.present(w)
        if !cursorHidden { sys.hideCursor(); cursorHidden = true }
        if assertion == nil { assertion = sys.holdAwake() }
        watch()
        NSAnimationContext.runAnimationGroup { $0.duration = TorchLight.fadeIn; w.animator().alphaValue = 1 }
        if let v = w.contentView { showHint(in: v, hex) }
      }
      brightness(on: b, display: TorchLight.displayID(w.screen ?? sys.mouseScreen()))
      broadcast()
      return true
    }
    guard let screen = sys.mouseScreen() else { psLog("PS torch: no screen"); return false }
    let w = TorchLightWindow(contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    w.isReleasedWhenClosed = false
    w.isFloatingPanel = true        // before the level: setting it later drops the window to the floating level
    w.becomesKeyOnlyIfNeeded = false
    w.level = NSWindow.Level(rawValue: NSWindow.Level.screenSaver.rawValue + 1)
    w.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    w.hidesOnDeactivate = false
    w.hasShadow = false
    w.isOpaque = false
    w.animationBehavior = .none
    w.backgroundColor = TorchLight.nsColor(hex)
    w.alphaValue = 0
    let v = TorchLightView(frame: NSRect(origin: .zero, size: screen.frame.size))
    v.wantsLayer = true
    v.layer?.backgroundColor = TorchLight.nsColor(hex).cgColor
    v.autoresizingMask = [.width, .height]
    v.onInput = { [weak self] why in self?.input(why) }
    w.contentView = v
    showHint(in: v, hex)
    w.setFrame(screen.frame, display: false)
    window = w
    open = true; closing = false
    gen += 1
    sys.present(w)
    NSAnimationContext.runAnimationGroup { ctx in
      ctx.duration = TorchLight.fadeIn
      ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
      w.animator().alphaValue = 1
    }
    if !cursorHidden { sys.hideCursor(); cursorHidden = true }
    if assertion == nil { assertion = sys.holdAwake() }
    watch()
    brightness(on: b, display: TorchLight.displayID(screen))
    psLog("PS torch: on (\(Int(screen.frame.width))x\(Int(screen.frame.height)))")
    broadcast()
    return true
  }

  /// Esc puts it away; Cmd Q quits PS (the safety exit). Nothing else ever reaches here.
  func input(_ why: String) {
    guard open, !closing else { return }
    switch why {
    case "esc": close(why: "Esc")
    case "quit": psLog("PS torch: Cmd Q while on, PS quits (the brightness goes back at exit)"); sys.quit()
    default: break
    }
  }

  // MARK: the hint

  /// Faint but readable on the torch's own colour: dark on light colours, light on dark ones.
  static func hintColor(_ hex: String) -> NSColor {
    let c = nsColor(hex).usingColorSpace(.sRGB) ?? .white
    let lum = 0.2126 * c.redComponent + 0.7152 * c.greenComponent + 0.0722 * c.blueComponent
    return lum > 0.5 ? NSColor(white: 0, alpha: 0.38) : NSColor(white: 1, alpha: 0.5)
  }
  private func showHint(in v: NSView, _ hex: String) {
    hint?.removeFromSuperview()
    let l = NSTextField(labelWithString: TorchLight.hintText)
    l.font = NSFont.systemFont(ofSize: 15, weight: .medium)
    l.textColor = TorchLight.hintColor(hex)
    l.alignment = .center
    l.wantsLayer = true
    l.sizeToFit()
    l.frame = NSRect(x: (v.bounds.width - l.frame.width) / 2, y: 44, width: l.frame.width, height: l.frame.height)
    l.autoresizingMask = [.minXMargin, .maxXMargin, .maxYMargin]
    v.addSubview(l)
    hint = l
    hintGen += 1
    let g = hintGen
    DispatchQueue.main.asyncAfter(deadline: .now() + TorchLight.hintFor) { [weak self, weak l] in
      guard let self, let l, self.hintGen == g else { return }
      NSAnimationContext.runAnimationGroup({ ctx in
        ctx.duration = TorchLight.hintFade
        l.animator().alphaValue = 0
      }, completionHandler: { [weak self, weak l] in
        guard let self, self.hintGen == g else { return }
        l?.removeFromSuperview()
        if self.hint === l { self.hint = nil }
      })
    }
  }

  /// Puts it away: fades out, then the window is ordered out and released (never left on screen invisible).
  func close(why: String, fade: Bool = true) {
    dispatchPrecondition(condition: .onQueue(.main))
    guard open, !closing, let w = window else { return }
    closing = true
    gen += 1
    let g = gen
    brightness(on: false, display: nil)      // back to the level from before, while it fades
    unwatch()
    if cursorHidden { sys.showCursor(); cursorHidden = false }
    if let a = assertion { sys.releaseAwake(a); assertion = nil }
    psLog("PS torch: off (\(why))")
    broadcast()
    let finish = { [weak self] in
      guard let self, self.gen == g, self.closing else { return }   // reopened meanwhile
      if w.isKeyWindow { w.resignKey() }
      w.orderOut(nil)
      self.hint = nil; self.hintGen += 1
      w.contentView = nil
      self.window = nil
      self.open = false; self.closing = false
      self.broadcast()
    }
    if fade {
      NSAnimationContext.runAnimationGroup({ ctx in
        ctx.duration = TorchLight.fadeOut
        ctx.timingFunction = CAMediaTimingFunction(name: .easeIn)
        w.animator().alphaValue = 0
      }, completionHandler: finish)
    } else { w.alphaValue = 0; finish() }
  }

  // MARK: what else puts it away

  private func watch() {
    guard observers.isEmpty else { return }
    let ws = NSWorkspace.shared.notificationCenter, nc = NotificationCenter.default
    let me = ProcessInfo.processInfo.processIdentifier
    observers.append((ws, ws.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] n in
      let app = n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
      self?.appActivated(app?.bundleIdentifier, pid: app?.processIdentifier ?? 0, me: me)
    }))
    for name in [NSWorkspace.willSleepNotification, NSWorkspace.screensDidSleepNotification, NSWorkspace.sessionDidResignActiveNotification] {
      observers.append((ws, ws.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in self?.close(why: "sleep", fade: false) }))
    }
    observers.append((nc, nc.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
      self?.close(why: "screens changed", fade: false)
    }))
    // Backstop: Esc reaching any of PS's own windows while the torch is up (if the torch was not key).
    keyMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown]) { [weak self] e in
      guard let self, self.open, !self.closing, e.keyCode == 53 else { return e }
      self.input("esc")
      return nil
    }
  }
  private func unwatch() {
    for (c, o) in observers { c.removeObserver(o) }
    observers = []
    if let m = keyMonitor { NSEvent.removeMonitor(m); keyMonitor = nil }
  }
  /// Another app came to the front. 1Password or Signal: away at once, no fade (golden rule). Any other
  /// app: it stays on (only Esc turns it off; the developer, 4 Nov 2026).
  func appActivated(_ bundleId: String?, pid: Int32, me: Int32 = ProcessInfo.processInfo.processIdentifier) {
    guard open, !closing, pid != me else { return }
    if Protected.matches(bundleId) { close(why: "protected app in front", fade: false) }
  }

  // MARK: brightness

  static func displayID(_ s: NSScreen?) -> CGDirectDisplayID? {
    (s?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value
  }

  /// On: remembers the level (on disk first), then steps up to full. Off: steps back to exactly that level.
  private func brightness(on: Bool, display: CGDirectDisplayID?) {
    let sys = self.sys
    q.async { [weak self] in
      guard let self else { return }
      self.rampGen += 1
      let g = self.rampGen
      TorchLight.levelLock.lock(); let raised = TorchLight.raisedFrom; TorchLight.levelLock.unlock()
      if on, let d = display {
        if let r = raised, r.display == d {
          self.ramp(d, to: 1, gen: g)          // already raised (a recolour): stay at full
          return
        }
        if let r = raised { self.ramp(r.display, to: r.level, gen: g, last: true) }   // another display: put that one back first
        guard let now = sys.readBrightness(d) else { DispatchQueue.main.async { self.canBright = false }; return }
        DispatchQueue.main.async { self.canBright = true }
        guard now < 0.995 else { return }
        TorchLight.writeRestore(display: d, level: now)       // disk first: a crash from here on still puts it back
        TorchLight.levelLock.lock(); TorchLight.raisedFrom = (d, now); TorchLight.levelLock.unlock()
        TorchLight.installExitPaths()
        self.ramp(d, to: 1, gen: g)
      } else if let r = raised {
        self.ramp(r.display, to: r.level, gen: g, last: true)
      }
    }
  }
  /// Steps from the current level to `target` (q only). `last`: this is the restore, so the final
  /// write is exactly the stored level and the record is cleared.
  private func ramp(_ d: CGDirectDisplayID, to target: Float, gen g: Int, last: Bool = false) {
    let from = sys.readBrightness(d) ?? target
    for i in 1...TorchLight.rampSteps {
      if rampGen != g && !last { return }        // a newer change took over
      let t = Float(i) / Float(TorchLight.rampSteps)
      let eased = t * t * (3 - 2 * t)
      _ = sys.setBrightness(d, i == TorchLight.rampSteps ? target : from + (target - from) * eased)
      if i < TorchLight.rampSteps { Thread.sleep(forTimeInterval: TorchLight.rampStep) }
    }
    if last {
      _ = sys.setBrightness(d, target)            // exactly the level from before
      TorchLight.levelLock.lock(); TorchLight.raisedFrom = nil; TorchLight.levelLock.unlock()
      TorchLight.clearRestore()
      TorchLight.removeExitPaths()
    }
  }

  // MARK: putting the brightness back if PS quits, is stopped or crashes

  static var restoreFile: URL { UpdatePaths.support.appendingPathComponent("torch-light-restore.json") }
  static func writeRestore(display: CGDirectDisplayID, level: Float) {
    let d: [String: Any] = ["display": Int(display), "level": Double(level), "at": Date().timeIntervalSince1970]
    guard let data = try? JSONSerialization.data(withJSONObject: d) else { return }
    try? FileManager.default.createDirectory(at: UpdatePaths.support, withIntermediateDirectories: true)
    try? data.write(to: restoreFile, options: [.atomic])
  }
  static func clearRestore() { try? FileManager.default.removeItem(at: restoreFile) }

  /// At launch (main.swift, off the main thread): a level left behind by a PS that quit with the torch
  /// on. Put back only while the display is still at full (nobody has changed it since).
  static func restoreLeftover(_ sys: TorchLightSystem = TorchLight.shared.sys, done: ((String) -> Void)? = nil) {
    DispatchQueue.global(qos: .utility).async {
      guard let data = try? Data(contentsOf: restoreFile),
            let d = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let disp = (d["display"] as? NSNumber)?.uint32Value, let lv = (d["level"] as? NSNumber)?.floatValue, lv >= 0, lv <= 1 else {
        clearRestore(); done?("none"); return
      }
      clearRestore()
      guard let now = sys.readBrightness(disp) else { psLog("PS torch: a brightness was left from last time, this display is gone"); done?("no display"); return }
      if now >= 0.98 {
        _ = sys.setBrightness(disp, lv)
        psLog(String(format: "PS torch: brightness put back to %.2f (PS had quit with the torch on)", lv))
        done?("restored")
      } else {
        psLog("PS torch: a brightness was left from last time, but it was changed since: left alone")
        done?("changed since")
      }
    }
  }

  /// Exit, a stop signal or a crash while the brightness is raised: put it back now, synchronously.
  static func emergencyRestore() {
    // Never waits on the lock: a crash may have come while it was held (it is only held for a moment).
    let locked = levelLock.try()
    let r = raisedFrom
    raisedFrom = nil
    if locked { levelLock.unlock() }
    guard let r else { return }
    _ = TorchLight.shared.sys.setBrightness(r.display, r.level)
    clearRestore()
  }

  private static var exitInstalled = false
  private static var signalSources: [DispatchSourceSignal] = []
  private static let stopSignals: [Int32] = [SIGTERM, SIGINT, SIGHUP, SIGQUIT]
  private static let crashSignals: [Int32] = [SIGSEGV, SIGBUS, SIGILL, SIGABRT, SIGTRAP, SIGFPE]
  private static var oldCrash: [Int32: sigaction] = [:]
  static var signalsActive: Bool { exitLock.lock(); defer { exitLock.unlock() }; return !signalSources.isEmpty }
  private static let exitLock = NSLock()

  /// Only while the brightness is raised: atexit (once for the process), stop signals through dispatch
  /// sources (the default action is put back right after the restore), crash signals best effort.
  static func installExitPaths() {
    exitLock.lock(); defer { exitLock.unlock() }
    if !exitInstalled { exitInstalled = true; atexit { TorchLight.emergencyRestore() } }
    guard signalSources.isEmpty else { return }
    for s in stopSignals {
      signal(s, SIG_IGN)
      let src = DispatchSource.makeSignalSource(signal: s, queue: .global(qos: .userInteractive))
      src.setEventHandler {
        TorchLight.emergencyRestore()
        signal(s, SIG_DFL)
        raise(s)            // what the signal would have done anyway (PS stops)
      }
      src.resume()
      signalSources.append(src)
    }
    for s in crashSignals {
      var act = sigaction(), old = sigaction()
      act.__sigaction_u.__sa_handler = { sig in
        // Crashing anyway: best effort (the next launch puts it back if this does not).
        TorchLight.emergencyRestore()
        signal(sig, SIG_DFL)
        raise(sig)
      }
      sigemptyset(&act.sa_mask)
      act.sa_flags = SA_RESETHAND
      if sigaction(s, &act, &old) == 0 { oldCrash[s] = old }
    }
  }
  static func removeExitPaths() {
    exitLock.lock(); defer { exitLock.unlock() }
    guard !signalSources.isEmpty else { return }
    for src in signalSources { src.cancel() }
    signalSources = []
    for s in stopSignals { signal(s, SIG_DFL) }
    for (s, old) in oldCrash { var o = old; sigaction(s, &o, nil) }
    oldCrash = [:]
  }
}
