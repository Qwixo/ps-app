// Sentry mode on a Mac (V1.48; web src/core/sentry.ts and src/views/Sentry.tsx have the page's half, the pure
// rules are in SentryCore.swift). The developer, 11 Nov 2026: lock the Mac but keep it fully awake so AI jobs keep running in the
// background, even unplugged. The big AI button in the Tab list engages it. Every Mac, public and private.
//
// While engaged:
//  - The Mac stays awake with power assertions (no idle system sleep, also on battery; the display too in Very dim).
//    Network, Claude Code and every other process keep running. PS changes no setting and no network.
//  - PS covers every screen (and screens plugged in later) with its own window above everything PS has, in kiosk
//    presentation (no Dock, no menu bar, no app switching, no Force Quit window, no Apple menu). It always shows
//    "Protected by PS" (a fixed literal, never the app's name or a rename) and "Sentry mode engaged".
//  - V1.49 (the developer, 12 Nov 2026): it no longer dims by itself. The Dim Screen button at the bottom middle dims every
//    screen smoothly while the pointer rests on it (the backlight down on screens PS can set, the words faded on all)
//    and fades them back the moment the pointer leaves. Keys never dim. The person's own brightness comes back
//    exactly on leaving the button, on Unlock, on Esc, at the end, and if PS dies (the guard, from the flag).
//    sentry-real-lock (the developer): dark means completely black: the words, shield, Unlock, the button itself and the pointer
//    all go, every pixel black. Leaving the button's (still live) area, or any key, click or scroll, brings it back.
//  - The only way out is Touch ID or the Mac password, through the REAL macOS lock screen: Unlock (and Esc, the developer's Esc
//    rule) lock the Mac at once with the same call as Control Command Q; the cover goes once macOS says the screen is
//    locked, the keep awake stays on, and unlocking macOS ends Sentry mode. Why not a Touch ID sheet over the cover, as
//    Sleep mode's Wake up does: the sheet comes from another process and sat under Sleep mode's clock (V1.41), so Wake
//    up takes the clock away while it asks, which here would show the desktop. The lock screen is above every app by
//    design, cannot be dismissed into an open desktop and does not depend on PS staying alive.
//  - Any other app coming to the front (something got past the kiosk), or PS losing the front, locks the Mac too.
//    No app's name is read or logged for it (golden rule: 1Password and Signal included).
//  - Battery at the stop level (Settings): the Mac locks, then the keep awake is let go so it can sleep.
//  - Lid closed (Settings, opt in): SentryLid.shared (the sentry-lid branch) keeps a closed lid Mac awake; when it stops by
//    itself Sentry mode keeps running. V1.54 (the developer): the cover never shows lid text; it is checked before engaging
//    (sentry:lidCheck, the pre engage pop up's lid row), and a stop is told in the Tab list after the unlock.
//  - V1.52 (the developer, 12 Nov 2026): from Sleep mode's AI Sentry mode button (SleepSentry.swift) it runs UNDER Sleep mode:
//    one cover at a time, so Sleep mode's window stays the visible one on its screen and Sentry covers only the other
//    screens. Everything else is the same (keep awake on battery with Sentry's battery stop, the lid, the restart if
//    not unlocked, the guard and the flag, leaving only through the real lock screen). Sleep mode hears what happens
//    (startUnderSleep's host): the lock done, the end, and stepping aside for the Touch ID fallback.
// Crash safety (PS quits, crashes or is killed while engaged): see SentryGuard below.
// Bridge (from the Tab list page):
//   sentry:start {plan}   engages (the page already showed the heat and bag warning the first time)
//   sentry:get            asks for the state
// The state goes to both pages: window.__psSentry({phase, since, refused?, stopped?, lid?}).
// Test copies: no assertion, no lock, no brightness, no kiosk, no guard process; every window parked off screen.
import Cocoa
import IOKit.pwr_mgt
import IOKit.ps
import LocalAuthentication

/// Everything Sentry mode asks of the system, so a test copy can swap it.
struct SentrySystem {
  var holdSystem: () -> IOPMAssertionID?
  var holdDisplay: () -> IOPMAssertionID?
  var release: (IOPMAssertionID) -> Void
  /// Read on a background queue only.
  var power: () -> (onBattery: Bool, pct: Int?)
  /// The lock call exists on this macOS (checked before engaging, never calls it).
  var canLock: () -> Bool
  /// Locks the Mac with the real lock screen (Control Command Q). Background queue only.
  var lockScreen: () -> Bool
  /// macOS says the screen is locked. Background queue only.
  var screenLocked: () -> Bool
  var protectedFront: () -> Bool
  var kiosk: (Bool) -> Void
  var isActive: () -> Bool
  /// Background queue only.
  var brightGet: (CGDirectDisplayID) -> Float?
  var brightSet: (CGDirectDisplayID, Float) -> Void
  /// Touch ID or the Mac password: only when the lock call failed at the moment it was needed (never a trap).
  var auth: (_ reason: String, _ done: @escaping (Bool) -> Void) -> Void
  /// The guard process (SentryGuard). Nil in a test copy.
  var spawnGuard: (_ flag: URL) -> Process?

  static let kioskOptions: NSApplication.PresentationOptions = [.hideDock, .hideMenuBar, .disableProcessSwitching, .disableForceQuit, .disableHideApplication, .disableAppleMenu]

  static let real = SentrySystem(
    holdSystem: {
      var id: IOPMAssertionID = 0
      let ok = IOPMAssertionCreateWithName(kIOPMAssertionTypePreventUserIdleSystemSleep as CFString, IOPMAssertionLevel(kIOPMAssertionLevelOn),
                                           "PS Sentry mode is on (keeping background jobs running)" as CFString, &id)
      return ok == kIOReturnSuccess ? id : nil
    },
    holdDisplay: {
      var id: IOPMAssertionID = 0
      let ok = IOPMAssertionCreateWithName(kIOPMAssertionTypePreventUserIdleDisplaySleep as CFString, IOPMAssertionLevel(kIOPMAssertionLevelOn),
                                           "PS Sentry mode is on (the Sentry screen stays on)" as CFString, &id)
      return ok == kIOReturnSuccess ? id : nil
    },
    release: { IOPMAssertionRelease($0) },
    power: { SleepSystem.real.power() },
    canLock: { SentryLock.available },
    lockScreen: { RemoteCommand.lockScreen() },
    screenLocked: { RemoteCommand.screenLocked() },
    protectedFront: { Protected.front || Protected.matches(NSWorkspace.shared.frontmostApplication?.bundleIdentifier) },
    kiosk: { on in
      if on {
        NSApp.activate(ignoringOtherApps: true)
        NSApp.presentationOptions = SentrySystem.kioskOptions
      } else { NSApp.presentationOptions = [] }
    },
    isActive: { NSApp.isActive },
    brightGet: { TorchLightBrightness.read($0) },
    brightSet: { _ = TorchLightBrightness.write($0, $1) },
    auth: { reason, done in TouchLock.evaluate(reason) { ok, _ in done(ok) } },
    spawnGuard: { SentryGuard.spawn(flag: $0) })

  /// Test copies: nothing is held, locked, dimmed or spawned. The lock "works" and macOS "says" locked at once, so the
  /// whole flow runs off screen. PS_SELFTEST_POWER as in Sleep mode (mains, battery50, battery8).
  static var testLocked = false
  static let test = SentrySystem(
    holdSystem: { nil }, holdDisplay: { nil }, release: { _ in },
    power: { SleepSystem.test.power() },
    canLock: { true },
    lockScreen: { testLocked = true; return true },
    screenLocked: { testLocked },
    protectedFront: { false }, kiosk: { _ in }, isActive: { true },
    brightGet: { _ in nil }, brightSet: { _, _ in },
    auth: { reason, done in TouchLock.evaluate(reason) { ok, _ in done(ok) } },
    spawnGuard: { _ in nil })
}

/// The lock call (login.framework's SACLockScreenImmediate, the same as Control Command Q), only looked up here.
enum SentryLock {
  static let available: Bool = {
    guard let h = dlopen("/System/Library/PrivateFrameworks/login.framework/Versions/Current/login", RTLD_LAZY) else { return false }
    return dlsym(h, "SACLockScreenImmediate") != nil
  }()
}

/// Takes every key and click: nothing reaches an app behind. Keys never dim or undim (only the Dim Screen button does).
final class SentryView: NSView {
  var onEsc: (() -> Void)?
  var onUnlock: (() -> Void)?
  /// Any other key, a click or a scroll: brings a dark Dim Screen back (sentry-real-lock).
  var onInput: (() -> Void)?
  override var acceptsFirstResponder: Bool { true }
  override var isFlipped: Bool { false }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  private func key(_ e: NSEvent) {
    switch e.keyCode {
    case 53: onEsc?()                         // Esc: lock the Mac at once (the developer's Esc rule)
    case 36, 76: onUnlock?()                  // Return, Enter: Unlock
    default: onInput?()                       // any other key: the screen comes back if Dim Screen made it dark
    }
  }
  override func keyDown(with e: NSEvent) { key(e) }
  override func performKeyEquivalent(with e: NSEvent) -> Bool { if e.type == .keyDown { key(e) }; return true }   // Command Q and every shortcut: swallowed
  override func cancelOperation(_ sender: Any?) { onEsc?() }
  override func mouseDown(with e: NSEvent) { onInput?() }
  override func rightMouseDown(with e: NSEvent) { onInput?() }
  override func otherMouseDown(with e: NSEvent) { onInput?() }
  override func scrollWheel(with e: NSEvent) { onInput?() }
}
/// V1.49: the Dim Screen button at the bottom middle of each cover, with its small line under it. Hover only: the
/// pointer resting on it dims every screen, leaving it brings them back (a click does nothing more). Sentry checks the
/// pointer itself too (SentryCover.pointerOnDim), so a missed enter or exit is put right within a moment.
final class SentryDimButton: NSView {
  var onHover: (() -> Void)?
  /// A click on its (invisible while dark) area brings the screen back (sentry-real-lock).
  var onInput: (() -> Void)?
  static let size = NSSize(width: 380, height: 82)
  private let pill = CALayer(), label = CATextLayer(), line = CATextLayer()
  private(set) var on = false
  init(scale: CGFloat) {
    super.init(frame: NSRect(origin: .zero, size: SentryDimButton.size))
    wantsLayer = true
    let W = SentryDimButton.size.width, H = SentryDimButton.size.height
    pill.frame = CGRect(x: W / 2 - 112, y: H - 48, width: 224, height: 48)
    pill.cornerRadius = 24; pill.borderWidth = 1
    layer?.addSublayer(pill)
    func text(_ l: CATextLayer, _ s: String, size: CGFloat, weight: NSFont.Weight, alpha: CGFloat) {
      l.string = NSAttributedString(string: s, attributes: [.font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: SentryCover.ink.withAlphaComponent(alpha),
                                                            .paragraphStyle: { let p = NSMutableParagraphStyle(); p.alignment = .center; return p }()])
      l.contentsScale = scale; l.alignmentMode = .center
      layer?.addSublayer(l)
    }
    text(label, SentryRules.dimButton, size: 16, weight: .semibold, alpha: 0.92)
    label.frame = CGRect(x: 0, y: pill.frame.midY - 11, width: W, height: 22)
    text(line, SentryRules.dimLine, size: 12, weight: .regular, alpha: 0.5)
    line.frame = CGRect(x: 0, y: 4, width: W, height: 17)
    paint()
    setAccessibilityElement(true)
    setAccessibilityRole(.button)
    setAccessibilityLabel("\(SentryRules.dimButton): \(SentryRules.dimLine)")
  }
  required init?(coder: NSCoder) { nil }
  override var isFlipped: Bool { false }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func mouseDown(with e: NSEvent) { onInput?() }
  override func rightMouseDown(with e: NSEvent) { onInput?() }
  override func scrollWheel(with e: NSEvent) { onInput?() }
  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    for t in trackingAreas { removeTrackingArea(t) }
    addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .mouseMoved, .activeAlways, .inVisibleRect], owner: self))
  }
  override func mouseEntered(with e: NSEvent) { onHover?() }
  override func mouseExited(with e: NSEvent) { onHover?() }
  override func mouseMoved(with e: NSEvent) { onHover?() }
  /// The pointer (screen coordinates) is on the button or its small line. Its alpha may be 0 (dark): the area stays live.
  func contains(screenPoint p: NSPoint) -> Bool {
    guard let w = window, !isHidden else { return false }
    return NSMouseInRect(p, w.convertToScreen(convert(bounds, to: nil)), false)
  }
  /// Lit while dimming: the pill glows a little so it is clear what the pointer is doing.
  func setOn(_ v: Bool, reduceMotion: Bool) {
    guard v != on else { return }
    on = v
    CATransaction.begin()
    CATransaction.setAnimationDuration(reduceMotion ? 0.12 : (v ? SentryRules.dimFade : SentryRules.undimFade))
    CATransaction.setAnimationTimingFunction(CAMediaTimingFunction(name: .easeInEaseOut))
    paint()
    CATransaction.commit()
  }
  private func paint() {
    pill.backgroundColor = (on ? SentryCover.blue.withAlphaComponent(0.2) : NSColor.white.withAlphaComponent(0.06)).cgColor
    pill.borderColor = (on ? SentryCover.soft.withAlphaComponent(0.7) : NSColor.white.withAlphaComponent(0.2)).cgColor
    pill.shadowColor = SentryCover.blue.cgColor; pill.shadowRadius = 14; pill.shadowOffset = .zero
    pill.shadowOpacity = on ? 0.45 : 0
  }
}

final class SentryWindow: NSPanel {
  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { false }
}

/// One screen's cover: black, with the shield, the words, Unlock and the Esc line in the middle, and the Dim Screen
/// button at the bottom middle.
final class SentryCover {
  let window: SentryWindow
  let view: SentryView
  let display: CGDirectDisplayID
  private let content = CALayer()
  private let shield = CAShapeLayer(), shieldFill = CAGradientLayer(), ring = CAShapeLayer()
  private let title = CATextLayer(), sub = CATextLayer(), status = CATextLayer(), hint = CATextLayer(), esc = CATextLayer()
  let unlock: SleepButton
  let dim: SentryDimButton

  static let ink = NSColor(srgbRed: 0.93, green: 0.95, blue: 1, alpha: 0.94)
  static let soft = NSColor(srgbRed: 0.66, green: 0.74, blue: 1, alpha: 1)
  static let blue = NSColor(srgbRed: 0.56, green: 0.66, blue: 1, alpha: 1)
  static let violet = NSColor(srgbRed: 0.79, green: 0.64, blue: 1, alpha: 1)

  init(screen: NSScreen, test: Bool, target: AnyObject, unlockAction: Selector) {
    display = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? 0
    let frame = test ? NSRect(x: ScreenGuard.parkX, y: -20000, width: screen.frame.width, height: screen.frame.height) : screen.frame
    window = SentryWindow(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    window.isReleasedWhenClosed = false
    window.isFloatingPanel = true
    window.becomesKeyOnlyIfNeeded = false
    window.level = Sentry.level
    window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    window.hidesOnDeactivate = false; window.hasShadow = false; window.isOpaque = true; window.animationBehavior = .none
    window.backgroundColor = .black
    window.alphaValue = 0
    window.acceptsMouseMovedEvents = true
    view = SentryView(frame: NSRect(origin: .zero, size: frame.size))
    view.wantsLayer = true
    view.layer?.backgroundColor = NSColor.black.cgColor
    view.autoresizingMask = [.width, .height]
    unlock = SleepButton("Unlock", target: target, action: unlockAction)
    unlock.fill = NSColor(srgbRed: 0.56, green: 0.66, blue: 1, alpha: 0.16)
    unlock.edge = NSColor(srgbRed: 0.66, green: 0.74, blue: 1, alpha: 0.55)
    unlock.ink = SentryCover.ink
    unlock.font = NSFont.systemFont(ofSize: 17, weight: .semibold)
    unlock.setAccessibilityLabel("Unlock: opens your Mac's lock screen")
    dim = SentryDimButton(scale: screen.backingScaleFactor)
    window.contentView = view
    build(scale: screen.backingScaleFactor)
  }

  private func text(_ l: CATextLayer, _ s: String, size: CGFloat, weight: NSFont.Weight, color: NSColor, scale: CGFloat) {
    l.string = NSAttributedString(string: s, attributes: [.font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: color,
                                                          .paragraphStyle: { let p = NSMutableParagraphStyle(); p.alignment = .center; return p }()])
    l.contentsScale = scale; l.alignmentMode = .center; l.isWrapped = true; l.truncationMode = .end
  }

  /// The shield, a 100 point outline with a tick (the same drawing as the web button's icon).
  private static func shieldPath(size s: CGFloat) -> CGPath {
    let p = CGMutablePath(), k = s / 24
    // M12 3 l7 3 v6 c0 4.5 -3 7.5 -7 9 c-4 -1.5 -7 -4.5 -7 -9 V6 z (flipped for a y up layer)
    func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * k, y: (24 - y) * k) }
    p.move(to: pt(12, 3)); p.addLine(to: pt(19, 6)); p.addLine(to: pt(19, 12))
    p.addCurve(to: pt(12, 21), control1: pt(19, 16.5), control2: pt(16, 19.5))
    p.addCurve(to: pt(5, 12), control1: pt(8, 19.5), control2: pt(5, 16.5))
    p.addLine(to: pt(5, 6)); p.closeSubpath()
    p.move(to: pt(9.5, 12)); p.addLine(to: pt(11.5, 14)); p.addLine(to: pt(15, 10.5))
    return p
  }

  private func build(scale: CGFloat) {
    guard let root = view.layer else { return }
    let W = view.bounds.width, H = view.bounds.height
    content.frame = view.bounds
    content.opacity = 0
    root.addSublayer(content)
    let s: CGFloat = min(110, max(72, H * 0.1))
    let cx = W / 2, top = H / 2 + s * 1.15
    let shieldFrame = CGRect(x: cx - s / 2, y: top - s / 2, width: s, height: s)
    ring.frame = shieldFrame.insetBy(dx: -s * 0.45, dy: -s * 0.45)
    ring.path = CGPath(ellipseIn: ring.bounds, transform: nil)
    ring.fillColor = NSColor.clear.cgColor
    ring.strokeColor = SentryCover.blue.withAlphaComponent(0.5).cgColor
    ring.lineWidth = 1.5
    ring.opacity = 0
    content.addSublayer(ring)
    // The shield's outline drawn with a blue to violet gradient (the gradient masked by the stroked path).
    shield.frame = CGRect(origin: .zero, size: shieldFrame.size)
    shield.path = SentryCover.shieldPath(size: s)
    shield.fillColor = NSColor.clear.cgColor
    shield.strokeColor = NSColor.white.cgColor
    shield.lineWidth = max(3, s / 24 * 1.6); shield.lineCap = .round; shield.lineJoin = .round
    shieldFill.frame = shieldFrame
    shieldFill.colors = [SentryCover.blue.cgColor, SentryCover.violet.cgColor]
    shieldFill.startPoint = CGPoint(x: 0, y: 1); shieldFill.endPoint = CGPoint(x: 1, y: 0)
    shieldFill.mask = shield
    shieldFill.shadowColor = SentryCover.blue.cgColor; shieldFill.shadowRadius = 18; shieldFill.shadowOpacity = 0.55; shieldFill.shadowOffset = .zero
    content.addSublayer(shieldFill)
    var y = top - s / 2 - 34
    func place(_ l: CATextLayer, h: CGFloat, gap: CGFloat) { y -= h; l.frame = CGRect(x: cx - 320, y: y, width: 640, height: h); y -= gap; content.addSublayer(l) }
    text(title, SentryRules.title, size: 38, weight: .semibold, color: SentryCover.ink, scale: scale)
    text(sub, "Sentry mode engaged", size: 19, weight: .medium, color: SentryCover.soft, scale: scale)
    text(status, "", size: 13.5, weight: .regular, color: SentryCover.ink.withAlphaComponent(0.55), scale: scale)
    text(hint, "Your Mac's lock screen opens. Touch ID or your password ends Sentry mode.", size: 13, weight: .regular, color: SentryCover.ink.withAlphaComponent(0.5), scale: scale)
    text(esc, "Esc locks this Mac", size: 12, weight: .regular, color: SentryCover.ink.withAlphaComponent(0.32), scale: scale)
    place(title, h: 48, gap: 6)
    place(sub, h: 26, gap: 14)
    place(status, h: 18, gap: 42)   // V1.54: where the lid notice was (2 + 18 + 22), so nothing else moves
    y -= 48
    unlock.frame = NSRect(x: cx - 110, y: y, width: 220, height: 48)
    y -= 12
    place(hint, h: 18, gap: 4)
    place(esc, h: 16, gap: 0)
    // The Dim Screen button at the bottom middle. On a short screen the middle moves up so nothing overlaps.
    let ds = SentryDimButton.size, dimY: CGFloat = 26
    dim.frame = NSRect(x: cx - ds.width / 2, y: dimY, width: ds.width, height: ds.height)
    let lift = max(0, dimY + ds.height + 18 - y)
    if lift > 0 { content.frame.origin.y += lift; unlock.frame.origin.y += lift }
    unlock.alphaValue = 0
    dim.alphaValue = 0
    view.addSubview(unlock)
    view.addSubview(dim)
  }

  /// The status. V1.52 (the developer): the cover never shows the restart time or a countdown, in any state. V1.54 (the developer): nor
  /// any lid text (it is checked before engaging; a stop is told in the Tab list after the unlock).
  func setStatus(_ s: String) {
    let scale = view.window?.backingScaleFactor ?? 2
    if let a = status.string as? NSAttributedString, a.string == s { return }
    text(status, s, size: 13.5, weight: .regular, color: SentryCover.ink.withAlphaComponent(0.55), scale: scale)
  }

  /// Comes up with the words (a soft rise, the shield's ring going out once). It stays up until Sentry mode leaves.
  func appear(reduceMotion: Bool) {
    CATransaction.begin()
    do {
      CATransaction.setAnimationDuration(reduceMotion ? 0.2 : 0.55)
      CATransaction.setAnimationTimingFunction(CAMediaTimingFunction(controlPoints: 0.2, 0.8, 0.2, 1))
      content.opacity = 1
      if !reduceMotion {
        let rise = CASpringAnimation(keyPath: "transform.scale")
        rise.fromValue = 0.955; rise.toValue = 1; rise.damping = 16; rise.stiffness = 140; rise.mass = 1
        rise.duration = rise.settlingDuration
        content.add(rise, forKey: "rise")
        let up = CABasicAnimation(keyPath: "position.y")
        up.fromValue = content.position.y - 10; up.toValue = content.position.y; up.duration = 0.6
        up.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.8, 0.2, 1)
        content.add(up, forKey: "up")
        for (i, l) in [sub, status, hint, esc].enumerated() {
          let f = CABasicAnimation(keyPath: "opacity")
          f.fromValue = 0; f.toValue = 1; f.duration = 0.5
          f.beginTime = CACurrentMediaTime() + 0.1 + Double(i) * 0.06; f.fillMode = .backwards
          l.add(f, forKey: "in")
        }
        pulse()
      }
    }
    CATransaction.commit()
    NSAnimationContext.runAnimationGroup { c in
      c.duration = 0.5
      unlock.animator().alphaValue = 1
    }
    NSAnimationContext.runAnimationGroup { c in
      c.duration = reduceMotion ? 0.2 : 0.7
      dim.animator().alphaValue = 1
    }
  }
  /// The pointer is on this screen's Dim Screen button.
  func pointerOnDim(_ p: NSPoint) -> Bool { dim.contains(screenPoint: p) }
  /// Dark (the pointer rests on Dim Screen) or back to normal. sentry-real-lock (the developer: "completely dark ... not even a
  /// little bit light"): the words, the shield, Unlock AND the Dim Screen button all fade to nothing, so every pixel is
  /// pure black (the window is black underneath). The button's area keeps its tracking while invisible.
  func setDim(_ on: Bool, reduceMotion: Bool) {
    let secs = reduceMotion ? 0.12 : (on ? SentryRules.dimFade : SentryRules.undimFade)
    CATransaction.begin()
    CATransaction.setAnimationDuration(secs)
    CATransaction.setAnimationTimingFunction(CAMediaTimingFunction(name: .easeInEaseOut))
    content.opacity = on ? SentryRules.dimContent : 1
    CATransaction.commit()
    NSAnimationContext.runAnimationGroup { c in
      c.duration = secs
      c.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
      unlock.animator().alphaValue = on ? CGFloat(SentryRules.dimContent) : 1
      dim.animator().alphaValue = on ? 0 : 1
    }
    dim.setOn(on, reduceMotion: reduceMotion)
  }
  /// The ring around the shield goes out once (each time the cover lights up).
  private func pulse() {
    let g = CAAnimationGroup()
    let sc = CABasicAnimation(keyPath: "transform.scale"); sc.fromValue = 0.55; sc.toValue = 1.25
    let op = CAKeyframeAnimation(keyPath: "opacity"); op.values = [0, 0.75, 0]; op.keyTimes = [0, 0.25, 1]
    g.animations = [sc, op]; g.duration = 1.5; g.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.7, 0.3, 1)
    ring.add(g, forKey: "pulse")
  }
}

final class Sentry: NSObject {
  static let shared = Sentry()
  /// Above every other PS window (Sleep mode and the torch sit at screen saver level and one above).
  static let level = NSWindow.Level(rawValue: NSWindow.Level.screenSaver.rawValue + 2)
  var sys: SentrySystem = UpdatePaths.test ? .test : .real
  private let test = UpdatePaths.test
  /// Set by main.swift: hands a JS line to both pages. Main thread.
  var deliver: ((String) -> Void)?
  /// Set by main.swift: the Tab list goes away when Sentry mode engages.
  var onOpen: (() -> Void)?

  enum Phase: String { case off, covered, locking, locked }
  private(set) var phase: Phase = .off
  /// The cover is up or the Mac is being locked: the Tab list stays hidden and Esc is Sentry mode's.
  var isUp: Bool { phase == .covered || phase == .locking }
  /// Engaged at all (covered, locking or locked with the keep awake on).
  var engaged: Bool { phase != .off }

  private var plan = SentryPlanN()
  private var since: Double = 0
  private var covers: [SentryCover] = []
  private var sysAssertion: IOPMAssertionID?, dispAssertion: IOPMAssertionID?
  private var tick: Timer?
  private var observers: [(NSObjectProtocol, NotificationCenter)] = []
  private var onBattery = false, pct: Int?
  private var lastPower: Double = 0
  private var lidOn = false
  /// Why the lid keep awake stopped during this Sentry mode (SentryRules.lidCode), told with the end (V1.54).
  private var lidStopCode: String?
  private var sawLock = false
  private var settledAt: Double = 0
  private var lockFinal = false, lockWhy = ""
  private var lockFails = 0
  private var asking = false
  /// Dim Screen: dark while the pointer rests on a cover's button, unless a key or click woke it (SentryRules.dimNext).
  /// Main thread.
  private var dim = SentryRules.DimState()
  /// PS hid the pointer for Dim Screen (NSCursor hide and unhide must pair). Main thread.
  private var cursorHidden = false
  private var guardProc: Process?
  /// Restart if not unlocked is armed with the helper (SentryLid). Stays armed after Sentry mode ends without a real
  /// unlock (the battery stop): then restartWatch cancels it at the next unlock.
  private var restartArmed = false
  private var restartWatch: NSObjectProtocol?
  /// Background work (power, brightness, the lock call, the flag file, the guard). Serial, so the flag is written
  /// before the guard starts and the brightness saved before it changes.
  private let q = DispatchQueue(label: "ps.sentry", qos: .userInitiated)
  /// q only: each dimmed screen's own brightness, to give back. Kept until a fade back lands exactly on it.
  private var savedBright: [CGDirectDisplayID: Float] = [:]
  /// q only: the newest brightness fade; an older one's steps stop when a newer fade (or the end) starts.
  private var fadeGen = 0

  // V1.52: under Sleep mode (SleepSentry.swift)
  enum HostEvent: Equatable {
    /// Step aside (true) for the Touch ID fallback sheet, or come back over everything (false).
    case aside(Bool)
    /// macOS says locked (Sentry stays engaged behind the lock screen): the why is Sentry's lock reason.
    case locked(String)
    /// Sentry mode ended (the why as in end(why:)).
    case ended(String)
    /// The battery stop could not lock the Mac: let it sleep anyway (the cover stays).
    case letSleep
  }
  /// Engaged from Sleep mode's button: Sleep mode's window is the cover on its screen.
  private(set) var underSleep = false
  private var host: ((HostEvent) -> Void)?
  /// The display Sleep mode's window is on (no Sentry cover there).
  private var hostDisplay: (() -> CGDirectDisplayID?)?

  static var flagURL: URL { UpdatePaths.support.appendingPathComponent("sentry-active.json") }
  private static func now() -> Double { Date().timeIntervalSince1970 }

  // MARK: the bridge

  /// From main.swift's message switch. True when the message was Sentry mode's.
  @discardableResult func handle(_ type: String, _ msg: [String: Any]) -> Bool {
    guard type.hasPrefix("sentry:") else { return false }
    psLog("PS sentry: got \(type) (phase \(phase.rawValue))")
    switch type {
    case "sentry:start": start(SentryPlanN.parse(msg["plan"]))
    case "sentry:get": send()
    case "sentry:fileVault": openFileVault()
    case "sentry:lidCheck": lidCheck((msg["id"] as? String) ?? "")
    default: return false
    }
    return true
  }
  private func send(refused: String? = nil, stopped: String? = nil, lid: String? = nil) {
    var d: [String: Any] = ["phase": phase.rawValue, "since": engaged ? Int64(since * 1000) : NSNull()]
    if let refused { d["refused"] = refused }
    if let stopped { d["stopped"] = stopped }
    if let lid { d["lid"] = lid }
    if underSleep { d["sleep"] = true }
    let data = (try? JSONSerialization.data(withJSONObject: d, options: [.sortedKeys])) ?? Data("{}".utf8)
    deliver?("window.__psSentry && window.__psSentry(\(String(data: data, encoding: .utf8) ?? "{}"))")
  }

  /// V1.54: the AI button asks whether the lid keep awake really works before engaging (SentryLid.probe, a few seconds
  /// at most, never on the main thread). Answers window.__psSentryLid({id, gap}); gap is null, "helper" or "refused".
  private func lidCheck(_ id: String) {
    dispatchPrecondition(condition: .onQueue(.main))
    let reply = { [weak self] (g: SentryLid.Gap?) in
      let d: [String: Any] = ["id": String(id.prefix(64)), "gap": g?.rawValue ?? NSNull()]
      let data = (try? JSONSerialization.data(withJSONObject: d, options: [.sortedKeys])) ?? Data("{}".utf8)
      self?.deliver?("window.__psSentryLid && window.__psSentryLid(\(String(data: data, encoding: .utf8) ?? "{}"))")
    }
    if engaged || test { return reply(nil) }
    SentryLid.shared.probe(done: reply)
  }

  /// sentry-real-lock: the pre engage check's "Open FileVault settings". Only opens System Settings, Privacy and Security,
  /// FileVault (the Tab list steps aside first so the pane is not under it). PS never switches FileVault on or off.
  static let fileVaultPane = "x-apple.systempreferences:com.apple.preference.security?FileVault"
  private func openFileVault() {
    dispatchPrecondition(condition: .onQueue(.main))
    guard !engaged else { return }
    psLog("PS sentry: opening System Settings at FileVault (read only check said off)")
    onOpen?()
    if !test, let u = URL(string: Sentry.fileVaultPane) { NSWorkspace.shared.open(u) }
  }

  // MARK: engage

  /// Sleep mode's host for an engage from its AI Sentry mode button (nil: the Tab list's AI button).
  struct SleepHost {
    let display: () -> CGDirectDisplayID?
    let event: (HostEvent) -> Void
    /// Nil: engaged. Else the refusal code (SentryRules.refusal, or "engaged" when it already was).
    let done: (String?) -> Void
  }
  /// V1.52: Sentry mode's protection under Sleep mode (SleepSentry.swift). Main thread; nothing blocks (the power is
  /// read on the Sentry queue), `done` comes back on the main thread.
  func startUnderSleep(_ p: SentryPlanN, host h: SleepHost) {
    dispatchPrecondition(condition: .onQueue(.main))
    psLog("PS sentry: asked from Sleep mode")
    start(p, sleep: h)
  }
  /// V1.52: Sleep mode's Wake up, Esc, Customise, Settings or the page while protected: the real lock screen.
  func leaveFromSleep(_ sleepWhy: String) {
    dispatchPrecondition(condition: .onQueue(.main))
    guard underSleep, phase == .covered else { return }
    psLog("PS sentry: Sleep mode asked to leave (\(sleepWhy)), locking the Mac")
    lockMac(SleepSentryRules.lockWhy(sleepWhy))
  }

  private func start(_ p: SentryPlanN, sleep: SleepHost? = nil) {
    dispatchPrecondition(condition: .onQueue(.main))
    if engaged { send(); sleep?.done("engaged"); return }
    if sleep == nil, SleepScreen.shared.isUp { psLog("PS sentry: not engaged, Sleep mode is up"); send(); return }
    let protectedNow = sys.protectedFront()
    let canLock = sys.canLock(), screens = NSScreen.screens.count
    let sys = self.sys
    q.async { [weak self] in
      let pw = sys.power()
      DispatchQueue.main.async {
        guard let self, !self.engaged else { return }
        self.onBattery = pw.onBattery; self.pct = pw.pct
        if let r = SentryRules.refusal(protectedFront: protectedNow || self.sys.protectedFront(), canLock: canLock, screens: screens, plan: p, onBattery: pw.onBattery, pct: pw.pct) {
          psLog("PS sentry: not engaged (\(r))")
          self.send(refused: r); sleep?.done(r); return
        }
        // From Sleep mode: it must still be up (Esc or Wake up may have come while the power was read).
        if let sleep, !SleepScreen.shared.isUp { psLog("PS sentry: not engaged, Sleep mode went"); sleep.done("gone"); return }
        self.engage(p, sleep: sleep)
        sleep?.done(nil)
      }
    }
  }

  private func engage(_ p: SentryPlanN, sleep: SleepHost? = nil) {
    plan = p; since = Sentry.now(); sawLock = false; lockFails = 0; lidStopCode = nil; asking = false; dim = SentryRules.DimState()
    lastPower = since
    phase = .covered
    underSleep = sleep != nil; host = sleep?.event; hostDisplay = sleep?.display
    if !underSleep { onOpen?() }   // under Sleep mode the Tab list is already away
    // 1. The flag and the guard first (a crash from here on locks the Mac), on the background queue in that order.
    // Restart if not unlocked (opt out, default 8 h): the helper restarts the Mac unless a real unlock comes first.
    stopRestartWatch()
    restartArmed = false
    if plan.restartH == 0 { SentryLid.shared.cancelRestart() }   // engaged from an unlocked Mac: nothing older stays armed
    if plan.restartH > 0 {
      restartArmed = true
      SentryLid.shared.armRestart(after: TimeInterval(plan.restartH) * 3600)
      psLog("PS sentry: restart if not unlocked armed (\(plan.restartH) h, helper deadline \(SentryLid.shared.restartDeadline == nil ? "none" : "set"))")
    }
    let flag = currentFlag()
    let url = Sentry.flagURL, sys = self.sys
    q.async { [weak self] in
      self?.savedBright = [:]
      Sentry.writeFlag(flag, url)
      let g = sys.spawnGuard(url)
      DispatchQueue.main.async {
        guard let self else { g?.terminate(); return }
        if self.engaged { self.guardProc = g } else { g?.terminate() }
      }
    }
    // 2. Awake: never idle sleep (on battery too); the display too, so the Sentry screen stays on (Dim Screen dims it).
    if sysAssertion == nil { sysAssertion = sys.holdSystem() }
    if dispAssertion == nil { dispAssertion = sys.holdDisplay() }
    // 3. The cover on every screen, in kiosk presentation.
    showCovers()
    sys.kiosk(true)
    settledAt = since + SentryRules.settle
    // 4. The lid (opt in): the sentry-lid branch's helper keeps a closed lid Mac awake.
    if plan.lid {
      lidOn = true
      SentryLid.shared.onAutoStop = { [weak self] r in DispatchQueue.main.async { self?.lidStopped(r) } }
      SentryLid.shared.set(enabled: true)
    }
    watch()
    tick = Timer(timeInterval: 0.3, repeats: true) { [weak self] _ in self?.second() }
    tick?.tolerance = 0.1
    RunLoop.main.add(tick!, forMode: .common)
    DispatchQueue.main.asyncAfter(deadline: .now() + SentryRules.settle) { [weak self] in self?.checkFront(again: true) }
    psLog("PS sentry: engaged\(underSleep ? " under Sleep mode" : "") (stop at \(plan.lowStop ? "\(plan.lowPct)%" : "never"), lid \(plan.lid ? "on" : "off"), \(covers.count) cover\(covers.count == 1 ? "" : "s"))")
    refreshStatus()
    for c in covers { c.appear(reduceMotion: reduceMotion) }
    send()
  }
  private var reduceMotion: Bool { test ? false : NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

  private func showCovers() {
    let old = covers
    if !old.isEmpty { undimNow() }   // screens changed: back to normal first; the pointer check dims the new ones again
    // V1.52: under Sleep mode, one cover at a time: Sleep mode's window is the cover on its own screen, Sentry covers
    // only the others (none on a one screen Mac).
    let skip = underSleep ? hostDisplay?() : nil
    let screens = NSScreen.screens.filter { s in skip.map { Sentry.display(of: s) != $0 } ?? true }
    covers = screens.map { SentryCover(screen: $0, test: test, target: self, unlockAction: #selector(unlockTapped)) }
    let mouse = NSEvent.mouseLocation
    for c in covers {
      c.view.onEsc = { [weak self] in self?.escape() }
      c.view.onUnlock = { [weak self] in self?.unlockTapped() }
      c.dim.onHover = { [weak self] in self?.pointerMoved() }
      c.view.onInput = { [weak self] in self?.inputWhileCovered() }
      c.dim.onInput = { [weak self] in self?.inputWhileCovered() }
      if !test { c.window.orderFrontRegardless() }
      // Engaging: a soft fade in. Screens changed while engaged: at once, so no screen ever shows the desktop.
      if old.isEmpty && !underSleep { NSAnimationContext.runAnimationGroup { $0.duration = 0.45; c.window.animator().alphaValue = 1 } } else { c.window.alphaValue = 1 }
    }
    if !test, !underSleep, let key = covers.first(where: { NSMouseInRect(mouse, $0.window.frame, false) }) ?? covers.first {   // under Sleep mode its window keeps the keys
      key.window.makeKey(); key.window.makeFirstResponder(key.view)
    }
    // Screens changed: the old covers go only once the new ones are up (no gap where a screen shows the desktop).
    for c in old { Sentry.close(c, fade: false) }
    // A screen plugged in (or out) while engaged: the new covers come up at once.
    if !old.isEmpty { refreshStatus(); for c in covers { c.appear(reduceMotion: true) }; pointerMoved() }
  }
  static func display(of s: NSScreen) -> CGDirectDisplayID { (s.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? 0 }
  private static func close(_ c: SentryCover, fade: Bool) {
    let w = c.window
    let done = { if w.isKeyWindow { w.resignKey() }; w.orderOut(nil); w.contentView = nil }
    if fade { NSAnimationContext.runAnimationGroup({ $0.duration = 0.4; w.animator().alphaValue = 0 }, completionHandler: done) } else { done() }
  }
  private func closeCovers(fade: Bool) {
    let old = covers
    covers = []
    for c in old { Sentry.close(c, fade: fade) }
  }

  // MARK: while engaged

  /// Every 0.3 s: keep the kiosk, check the pointer against Dim Screen (a backstop for a missed enter or exit), the
  /// words now and then, the power every powerEvery seconds. Nothing dims by itself.
  private func second() {
    guard engaged else { return }
    let now = Sentry.now()
    if now - lastPower >= SentryRules.powerEvery { lastPower = now; checkPower() }
    guard phase == .covered, !asking else { return }
    if !test && NSApp.presentationOptions != SentrySystem.kioskOptions && sys.isActive() { NSApp.presentationOptions = SentrySystem.kioskOptions }
    pointerMoved()
    if Int(now) % 5 == 0 { refreshStatus() }
  }
  /// Dim Screen: dark exactly while the pointer rests on a cover's button (a key or click brings it back, SentryRules.dimNext). A test copy's covers
  /// are parked off screen, so the real pointer never dims anything there.
  private func pointerMoved() {
    guard phase == .covered, !asking else { return }
    applyDim(SentryRules.dimNext(dim, onButton: pointerOnDim(), input: false))
  }
  /// A key (not Esc or Return, which lock), a click or a scroll on the cover: a dark screen comes back and stays lit
  /// until the pointer leaves Dim Screen.
  private func inputWhileCovered() {
    guard phase == .covered, !asking else { return }
    applyDim(SentryRules.dimNext(dim, onButton: pointerOnDim(), input: true))
  }
  private func pointerOnDim() -> Bool {
    let m = NSEvent.mouseLocation
    return !test && covers.contains { $0.pointerOnDim(m) }
  }
  private func applyDim(_ next: SentryRules.DimState) {
    let was = dim.dark
    dim = next
    guard next.dark != was else { return }
    psLog("PS sentry: \(next.dark ? "Dim Screen, every screen goes black" : next.woke ? "a key or click, screens back to normal" : "the pointer left Dim Screen, screens back to normal")")
    for c in covers { c.setDim(next.dark, reduceMotion: reduceMotion) }
    setCursorHidden(next.dark)
    fadeBacklight(dim: next.dark, covers.map(\.display).filter { $0 != 0 })
  }
  /// The pointer is hidden while dark (nothing lit) and shown again the moment it is not. Hide and unhide always pair.
  private func setCursorHidden(_ on: Bool) {
    guard on != cursorHidden, !test else { return }
    cursorHidden = on
    if on { NSCursor.hide() } else { NSCursor.unhide() }
  }
  /// Back to normal at once (Unlock, Esc, any lock, the end, screens changing): the words up, the pointer back, the
  /// brightness exact.
  private func undimNow() {
    if dim.dark { for c in covers { c.setDim(false, reduceMotion: true) } }
    dim = SentryRules.DimState()
    setCursorHidden(false)
    restoreBacklight()
  }
  private func refreshStatus() {
    let line = SentryRules.engagedFor(since: since, now: Sentry.now()) + ", " + SentryRules.powerLine(onBattery: onBattery, pct: pct)
    // V1.52 (the developer): no restart countdown on the cover, ever. The restart itself still runs (the helper holds it).
    for c in covers { c.setStatus(line) }
  }

  /// The backlight fades down (dim) or back to the person's own brightness, in small steps on the Sentry queue (never
  /// the main thread, never a sleep on the queue). Before the first dim each screen's own brightness is saved, and put
  /// in the flag so the guard gives it back if PS dies. It is kept until a fade back lands exactly on it, so dimming
  /// again halfway back never saves a dimmed value.
  private func fadeBacklight(dim on: Bool, _ displays: [CGDirectDisplayID]) {
    let sys = self.sys, url = Sentry.flagURL, flag = currentFlag()
    let secs = on ? SentryRules.dimFade : SentryRules.undimFade, n = SentryRules.fadeSteps
    q.async { [weak self] in
      guard let self else { return }
      self.fadeGen &+= 1
      let gen = self.fadeGen
      if on {
        var changed = false
        for d in displays where self.savedBright[d] == nil {
          if let b = sys.brightGet(d) { self.savedBright[d] = b; changed = true }
        }
        if changed { var f = flag; f.bright = self.savedBright; Sentry.writeFlag(f, url) }
      }
      let saved = self.savedBright
      guard !saved.isEmpty else { return }
      var from: [CGDirectDisplayID: Float] = [:]
      for (d, b) in saved { from[d] = sys.brightGet(d) ?? b }
      for i in 1...n {
        self.q.asyncAfter(deadline: .now() + secs * Double(i) / Double(n)) { [weak self] in
          guard let self, self.fadeGen == gen else { return }   // a newer fade, or the end, took over
          for (d, b) in saved {
            sys.brightSet(d, SentryRules.fadeStep(from: from[d] ?? b, to: on ? SentryRules.dimmed(from: b) : b, step: i, of: n))
          }
          if !on && i == n {   // landed exactly on the person's own brightness
            self.savedBright = [:]
            var f = flag; f.bright = [:]; Sentry.writeFlag(f, url)
          }
        }
      }
    }
  }
  /// The person's own brightness back at once, exactly (any fade still running stops).
  private func restoreBacklight() {
    let sys = self.sys
    q.async { [weak self] in
      guard let self else { return }
      self.fadeGen &+= 1
      guard !self.savedBright.isEmpty else { return }
      for (d, b) in self.savedBright { sys.brightSet(d, b) }
      self.savedBright = [:]
    }
  }
  private func currentFlag() -> SentryRules.Flag {
    var f = SentryRules.Flag(pid: getpid(), since: since, boot: RemoteCommand.bootedAt()); f.restart = restartArmed; return f
  }

  private func checkPower() {
    let sys = self.sys
    q.async { [weak self] in
      let pw = sys.power()
      DispatchQueue.main.async {
        guard let self, self.engaged else { return }
        self.onBattery = pw.onBattery; self.pct = pw.pct
        if SentryRules.batteryStops(self.plan, onBattery: pw.onBattery, pct: pw.pct), self.phase == .covered || self.phase == .locked {
          psLog("PS sentry: battery at \(pw.pct ?? -1)%, stopping and locking the Mac")
          if self.phase == .locked { self.end(why: "battery") } else { self.lockMac("battery", final: true) }
        }
      }
    }
  }

  private func lidStopped(_ r: SentryLid.StopReason) {
    guard engaged, lidOn else { return }
    lidOn = false
    SentryLid.shared.set(enabled: false)
    let code = SentryRules.lidCode(r)
    lidStopCode = code   // no text on the cover (V1.54): the Tab list says it after the unlock
    psLog("PS sentry: lid closed keep awake stopped by itself (\(code)); Sentry mode keeps running")
  }

  /// PS must be the app in front while the cover is up; after the settle time, anything else means a way past it.
  private func checkFront(again: Bool) {
    guard phase == .covered, !asking, !test else { return }
    if sys.isActive() { return }
    if again {
      psLog("PS sentry: PS is not in front yet, asking once more")
      sys.kiosk(true)
      DispatchQueue.main.asyncAfter(deadline: .now() + SentryRules.settle) { [weak self] in self?.checkFront(again: false) }
    } else { lockMac("PS app could not stay in front") }
  }

  private func watch() {
    guard observers.isEmpty else { return }
    let ws = NSWorkspace.shared.notificationCenter, nc = NotificationCenter.default, dn = DistributedNotificationCenter.default()
    let me = ProcessInfo.processInfo.processIdentifier
    // Another app in front, or PS no longer in front, while the cover is up: lock the Mac (no name is read).
    observers.append((ws.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] n in
      let pid = (n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)?.processIdentifier ?? 0
      guard let self, pid != me else { return }
      self.frontLost("another app came to the front")
    }, ws))
    observers.append((nc.addObserver(forName: NSApplication.didResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
      self?.frontLost("PS app left the front")
    }, nc))
    observers.append((nc.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
      guard let self, self.phase == .covered else { return }
      psLog("PS sentry: the screens changed, covering every screen again")
      if self.underSleep {
        // Sleep mode moves its window to the screen under the pointer first (its own observer), then the rest are covered.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
          guard let self, self.phase == .covered, self.underSleep else { return }
          self.showCovers(); if !self.test { self.sys.kiosk(true) }
        }
        return
      }
      self.showCovers()
      if !self.test { self.sys.kiosk(true) }
    }, nc))
    observers.append((ws.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in self?.checkPower() }, ws))
    observers.append((dn.addObserver(forName: .init("com.apple.screenIsLocked"), object: nil, queue: .main) { [weak self] _ in
      guard let self, self.engaged else { return }
      self.sawLock = true
      if self.phase == .locking { self.didLock() }
    }, dn))
    observers.append((dn.addObserver(forName: .init("com.apple.screenIsUnlocked"), object: nil, queue: .main) { [weak self] _ in
      guard let self, self.engaged else { return }
      // Touch ID or the password on the real lock screen: the owner is back, Sentry mode ends.
      if self.phase == .locked || self.phase == .locking || self.sawLock { self.end(why: "unlock") }
    }, dn))
  }
  private func unwatch() { for (o, c) in observers { c.removeObserver(o) }; observers = [] }
  private func frontLost(_ why: String) {
    guard phase == .covered, !asking, !test, Sentry.now() >= settledAt else { return }
    lockMac(why)
  }

  // MARK: leaving: always through the real lock screen

  @objc private func unlockTapped() { psLog("PS sentry: Unlock pressed"); lockMac("unlock") }
  /// The developer's Esc rule: Esc leaves the PS cover and locks the Mac at once (the keep awake stays on).
  func escape() {
    dispatchPrecondition(condition: .onQueue(.main))
    guard phase == .covered else { return }
    psLog("PS sentry: Esc, locking the Mac")
    lockMac("esc")
  }

  /// Locks the Mac with the real lock screen; the cover goes only once macOS says it is locked. `final`: Sentry mode
  /// ends once locked (the battery), else it stays engaged behind the lock screen until it is unlocked.
  private func lockMac(_ why: String, final: Bool = false) {
    guard phase == .covered else { return }
    undimNow()
    phase = .locking; lockFinal = final; lockWhy = why
    psLog("PS sentry: locking the Mac (\(why))")
    let sys = self.sys
    q.async { [weak self] in
      let ok = sys.lockScreen()
      DispatchQueue.main.async { if ok { self?.waitLocked(0) } else { self?.lockFailed("no lock call") } }
    }
  }
  private func waitLocked(_ n: Int) {
    guard phase == .locking else { return }
    let sys = self.sys
    q.async { [weak self] in
      let locked = sys.screenLocked()
      DispatchQueue.main.async {
        guard let self, self.phase == .locking else { return }
        if locked { self.didLock() }
        else if Double(n) * 0.1 < SentryRules.lockWait { DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in self?.waitLocked(n + 1) } }
        else { self.lockFailed("macOS did not say locked in \(Int(SentryRules.lockWait)) s") }
      }
    }
  }
  private func didLock() {
    guard phase == .locking else { return }
    sawLock = true
    if lockFinal { end(why: lockWhy); return }
    phase = .locked
    // Behind the lock screen: the cover goes, the kiosk ends, the keep awake stays (the display may sleep now).
    closeCovers(fade: false)
    sys.kiosk(false)
    if let a = dispAssertion { sys.release(a); dispAssertion = nil }
    restoreBacklight()
    psLog("PS sentry: the Mac is locked (\(lockWhy)); still awake until it is unlocked")
    send()
    host?(.locked(lockWhy))   // V1.52: Sleep mode's window goes now too (behind the lock screen)
  }
  /// The lock did not happen. The cover stays (never an open desktop). After a second failure, Touch ID or the
  /// password straight away so nobody is ever trapped (the Sleep mode way: the cover steps aside while it asks).
  private func lockFailed(_ why: String) {
    guard phase == .locking else { return }
    phase = .covered
    lockFails += 1
    psLog("PS sentry: the lock failed (\(why)), try \(lockFails)")
    if lockFinal {
      // The battery: let the Mac sleep anyway (macOS asks for the password when it wakes); the cover stays.
      if let a = sysAssertion { sys.release(a); sysAssertion = nil }
      if let a = dispAssertion { sys.release(a); dispAssertion = nil }
      host?(.letSleep)
      return
    }
    if lockFails < 2 { refreshStatus(); return }
    undimNow()
    asking = true
    for c in covers { c.window.orderOut(nil) }
    host?(.aside(true))   // V1.52: Sleep mode's window steps aside for the sheet too
    sys.kiosk(false)
    sys.auth("end Sentry mode") { [weak self] ok in
      DispatchQueue.main.async {
        guard let self, self.phase == .covered else { return }
        self.asking = false
        if ok { self.end(why: "auth"); return }
        for c in self.covers where !self.test { c.window.orderFrontRegardless() }
        self.host?(.aside(false))
        self.sys.kiosk(true)
        self.settledAt = Sentry.now() + SentryRules.settle
        self.refreshStatus()
      }
    }
  }

  /// Ends Sentry mode: the keep awake let go, the lid helper told, the brightness given back, the flag removed (the
  /// guard leaves by itself), the cover gone. Only after an unlock (Touch ID or the password) or once the Mac is locked.
  func end(why: String) {
    dispatchPrecondition(condition: .onQueue(.main))
    guard engaged else { return }
    phase = .off
    tick?.invalidate(); tick = nil
    unwatch()
    asking = false
    dim = SentryRules.DimState()
    setCursorHidden(false)
    if let a = sysAssertion { sys.release(a); sysAssertion = nil }
    if let a = dispAssertion { sys.release(a); dispAssertion = nil }
    if lidOn { lidOn = false; SentryLid.shared.set(enabled: false) }
    SentryLid.shared.onAutoStop = nil
    // Only a real unlock (Touch ID or the password) cancels the restart; anything else leaves it for the next unlock.
    if restartArmed {
      if SentryRules.endCancelsRestart(why) { restartArmed = false; SentryLid.shared.cancelRestart(); psLog("PS sentry: restart if not unlocked cancelled (unlocked)") }
      else { watchUnlockToCancelRestart() }
    }
    restoreBacklight()
    let g = guardProc; guardProc = nil
    q.async { try? FileManager.default.removeItem(at: Sentry.flagURL); g?.terminate() }
    closeCovers(fade: true)
    sys.kiosk(false)
    psLog("PS sentry: ended (\(why))\(underSleep ? ", it was under Sleep mode" : "")")
    let h = host
    host = nil; hostDisplay = nil; underSleep = false
    send(stopped: why, lid: lidStopCode)
    lidStopCode = nil
    h?(.ended(why))   // V1.52: Sleep mode's window goes too if it is still up
  }

  /// The restart stays armed after Sentry mode ended without an unlock (the battery stop) or after PS stopped while
  /// engaged: the next real unlock of the Mac cancels it.
  func watchUnlockToCancelRestart() {
    restartArmed = true
    guard restartWatch == nil else { return }
    restartWatch = DistributedNotificationCenter.default().addObserver(forName: .init("com.apple.screenIsUnlocked"), object: nil, queue: .main) { [weak self] _ in
      guard let self, !self.engaged else { return }
      self.restartArmed = false
      SentryLid.shared.cancelRestart()
      psLog("PS sentry: restart if not unlocked cancelled (the Mac was unlocked)")
      self.stopRestartWatch()
    }
  }
  private func stopRestartWatch() {
    if let o = restartWatch { DistributedNotificationCenter.default().removeObserver(o); restartWatch = nil }
  }

  /// PS is quitting while engaged (applicationWillTerminate): lock the Mac now; the guard locks it too if this does not
  /// get through, and the flag stays so the next launch checks.
  func quitting() {
    guard engaged, !test else { return }
    psLog("PS sentry: PS is quitting while engaged, locking the Mac")
    _ = sys.lockScreen()
  }

  // MARK: crash safety

  static func writeFlag(_ f: SentryRules.Flag, _ url: URL) {
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try? f.json().write(to: url, options: [.atomic])
    chmod(url.path, 0o600)
  }
  /// At launch (main.swift, before anything shows): a flag left behind means PS stopped while engaged. Lock the Mac at
  /// once unless it is already locked or restarted since, give the brightness back, tell the lid helper, then remove
  /// the flag. On a background queue; a test copy never does any of it.
  static func recoverAtLaunch() {
    guard !UpdatePaths.test else { return }
    DispatchQueue.global(qos: .userInitiated).async {
      let url = flagURL
      guard let data = try? Data(contentsOf: url) else { return }
      let flag = SentryRules.Flag.parse(data)
      let r = SentryRules.recovery(flag: flag, bootNow: RemoteCommand.bootedAt(), screenLocked: RemoteCommand.screenLocked())
      psLog("PS sentry: a flag was left behind (PS stopped while engaged): \(r)")
      if r == .lockNow { _ = RemoteCommand.lockScreen() }
      // Restart if not unlocked was armed: a restart since means a login (a real password unlock), so cancel; else the
      // next real unlock cancels it. Sentry mode itself never comes back on by itself (no re-engage, no boot loop).
      if flag?.restart == true {
        let restarted = (flag?.boot ?? 0) > 0 && abs((flag?.boot ?? 0) - RemoteCommand.bootedAt()) > 2
        DispatchQueue.main.async { if restarted { SentryLid.shared.cancelRestart() } else { Sentry.shared.watchUnlockToCancelRestart() } }
      }
      for (d, b) in flag?.bright ?? [:] { _ = TorchLightBrightness.write(d, b) }
      DispatchQueue.main.async { SentryLid.shared.set(enabled: false) }
      try? FileManager.default.removeItem(at: url)
    }
  }
}

// MARK: the guard process

/// Crash safety (the developer: "If PS quits or crashes during Sentry, the Mac must end up locked, never open").
/// Three layers, none of them in Helper/ (no new approval on any Mac):
///  1. The guard: when Sentry mode engages, PS starts its own binary again as `--ps-sentry-guard <pid> <flag>`. It has
///     no window, no Dock icon and does nothing but wait for that PS to exit (a kernel process exit event, plus a poll
///     of the parent every half second). If PS goes while the flag file is still there (it did not end Sentry mode
///     itself: a crash, a force quit, a kill), the guard locks the Mac at once with the real lock screen, gives the
///     brightness back and removes the flag. When PS ends Sentry mode normally it removes the flag and the guard
///     leaves by itself (it checks every half second, and PS also stops it).
///  2. The flag: PS checks it at every launch (Sentry.recoverAtLaunch): still there and the Mac unlocked means the guard
///     could not act, so PS locks the Mac first thing (unless the Mac restarted since: macOS asked for the password).
///  3. A normal quit while engaged (applicationWillTerminate) locks the Mac itself before PS goes.
/// The cover's window dies with PS, so after a crash the desktop can show for the moment it takes the guard to hear
/// the exit and macOS to put the lock screen up (well under a second). While engaged the kiosk keeps Force Quit,
/// app switching, the Dock and the menu bar away, so nothing can be reached in that moment.
enum SentryGuard {
  static let arg = "--ps-sentry-guard"

  /// Started from PS on the Sentry queue. Nil when it could not start (Sentry mode still runs: layers 2 and 3 remain).
  static func spawn(flag: URL) -> Process? {
    guard let exe = Bundle.main.executableURL else { return nil }
    let p = Process()
    p.executableURL = exe
    p.arguments = [arg, String(getpid()), flag.path]
    p.standardInput = FileHandle.nullDevice; p.standardOutput = FileHandle.nullDevice; p.standardError = FileHandle.nullDevice
    do { try p.run(); psLog("PS sentry: guard started (pid \(p.processIdentifier))"); return p }
    catch { psLog("PS sentry: the guard did not start (\(error.localizedDescription.prefix(80)))"); return nil }
  }

  /// main.swift calls this first thing. Not the guard: returns at once. The guard: never returns.
  static func runIfAsked() {
    let a = CommandLine.arguments
    guard let i = a.firstIndex(of: arg) else { return }
    guard a.count > i + 2, let parent = Int32(a[i + 1]), parent > 1 else { exit(2) }
    let flag = URL(fileURLWithPath: a[i + 2])
    // Its own session: a signal to PS's group, or the terminal PS was started from closing, does not reach it.
    _ = setsid()
    signal(SIGHUP, SIG_IGN); signal(SIGINT, SIG_IGN); signal(SIGPIPE, SIG_IGN)
    let gone: () -> Void = {
      let there = FileManager.default.fileExists(atPath: flag.path)
      if SentryRules.guardActs(flagExists: there) {
        psLog("PS sentry guard: PS (pid \(parent)) stopped while Sentry mode was engaged, locking the Mac")
        _ = RemoteCommand.lockScreen()
        if let f = SentryRules.Flag.parse(try? Data(contentsOf: flag)) { for (d, b) in f.bright { _ = TorchLightBrightness.write(d, b) } }
        // Keep the flag until macOS says locked, so a lock that did not happen is caught at PS's next launch.
        for _ in 0..<50 where !RemoteCommand.screenLocked() { usleep(100_000) }
        if RemoteCommand.screenLocked() { try? FileManager.default.removeItem(at: flag) }
      }
      exit(0)
    }
    let src = DispatchSource.makeProcessSource(identifier: parent, eventMask: .exit, queue: .main)
    src.setEventHandler(handler: gone)
    src.resume()
    let t = DispatchSource.makeTimerSource(queue: .main)
    t.schedule(deadline: .now() + 0.5, repeating: 0.5, leeway: .milliseconds(100))
    t.setEventHandler {
      if kill(parent, 0) != 0 && errno == ESRCH { gone(); return }   // PS is gone (the exit event already missed)
      if getppid() != parent && getppid() == 1 && kill(parent, 0) != 0 { gone(); return }
      if !FileManager.default.fileExists(atPath: flag.path) { exit(0) }   // Sentry mode ended normally
    }
    t.resume()
    withExtendedLifetime((src, t)) { dispatchMain() }
  }
}
