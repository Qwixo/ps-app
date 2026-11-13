// AI Sentry mode from Sleep mode (V1.52; pure rules in SleepSentryCore.swift, the page's half in web
// src/core/sentry.ts sleepSentry and src/views/Sentry.tsx). The developer, 12 Nov 2026: a little AI Sentry mode button on the sleep
// screen (by default the left, half way up; where it sits is a Sleep look setting) that turns into the Protected by PS
// shield and puts Sentry mode's protection under Sleep mode.
//
// How it works:
//  - SleepScreen.swift calls this through its `guardian` (SleepGuard): attach when the screen is built, draw on every
//    redraw, detach when it goes, Esc, and leave (Wake up, Customise, Settings, Esc, the page's stop) while protected.
//  - Pressing the button: the same restart check as the Tab list's AI button (no heat warning, the developer: never) (the page worked it out, it comes in the plan), each in a small panel drawn in the sleep screen's
//    own colours with the same words and buttons; then Sentry.shared.startUnderSleep. Nothing blocks the main thread.
//  - Engaged: the pill folds into the shield (the same shield as the Sentry screen, blue to violet) and stays as the
//    indicator, with "Protected by PS" under it. Sleep mode's window stays the only cover on its screen; Sentry covers
//    the other screens. Its keep awake (on battery too, with its own battery stop), the lid, the restart if not unlocked,
//    the guard process and the flag all run underneath (Sentry.swift).
//  - Leaving while protected: Sentry locks the Mac with the real lock screen; once macOS says locked this screen goes
//    with the reason the person gave (Wake up logs the wake time, Esc locks PS as always). Touch ID or the password on
//    the lock screen ends Sentry mode and cancels the restart deadline. Alarms keep ringing and Stop needs no Touch ID.
// Golden rule: the button and its panels are drawn inside the sleep screen's own window, which already steps aside for
// 1Password and Signal; nothing here reads or touches any other app.
import Cocoa

/// The button: a small pill ("AI Sentry mode" with a shield outline) that folds into the Protected by PS shield.
final class SleepSentryButton: NSView {
  enum Look: Equatable { case idle, busy, on }
  var onTap: (() -> Void)?
  static let size = NSSize(width: 210, height: 92)
  private(set) var look: Look = .idle
  private(set) var hugsLeft = true
  private let pill = CALayer(), label = CATextLayer(), icon = CAShapeLayer()
  private let shieldFill = CAGradientLayer(), shield = CAShapeLayer(), ring = CAShapeLayer(), caption = CATextLayer()
  private var ink = NSColor.white, alpha: CGFloat = 0.35
  private var words = (button: "AI Sentry mode", on: SentryRules.title)
  static let pillSize = CGSize(width: 176, height: 40), disc: CGFloat = 50

  override init(frame: NSRect) {
    super.init(frame: NSRect(origin: frame.origin, size: SleepSentryButton.size))
    wantsLayer = true
    guard let root = layer else { return }
    pill.cornerRadius = SleepSentryButton.pillSize.height / 2; pill.borderWidth = 1
    root.addSublayer(pill)
    icon.path = SleepSentryButton.shieldPath(size: 16); icon.fillColor = NSColor.clear.cgColor; icon.lineWidth = 1.6
    icon.lineCap = .round; icon.lineJoin = .round
    pill.addSublayer(icon)
    label.alignmentMode = .left; label.truncationMode = .end
    pill.addSublayer(label)
    ring.fillColor = NSColor.clear.cgColor; ring.strokeColor = SentryCover.blue.withAlphaComponent(0.55).cgColor; ring.lineWidth = 1.4; ring.opacity = 0
    root.addSublayer(ring)
    shield.fillColor = NSColor.clear.cgColor; shield.strokeColor = NSColor.white.cgColor
    shield.lineCap = .round; shield.lineJoin = .round; shield.lineWidth = 2.2
    shieldFill.colors = [SentryCover.blue.cgColor, SentryCover.violet.cgColor]
    shieldFill.startPoint = CGPoint(x: 0, y: 1); shieldFill.endPoint = CGPoint(x: 1, y: 0)
    shieldFill.mask = shield
    shieldFill.shadowColor = SentryCover.blue.cgColor; shieldFill.shadowRadius = 10; shieldFill.shadowOffset = .zero; shieldFill.shadowOpacity = 0.4
    shieldFill.opacity = 0
    root.addSublayer(shieldFill)
    caption.alignmentMode = .center; caption.opacity = 0
    root.addSublayer(caption)
    setAccessibilityElement(true)
    setAccessibilityRole(.button)
    lay()
  }
  required init?(coder: NSCoder) { nil }
  override var isFlipped: Bool { false }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func resetCursorRects() { if look == .idle { addCursorRect(pillRect, cursor: .pointingHand) } }

  /// The shield outline with its tick (the same drawing as the Sentry screen and the web button), y up.
  static func shieldPath(size s: CGFloat) -> CGPath {
    let p = CGMutablePath(), k = s / 24
    func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * k, y: (24 - y) * k) }
    p.move(to: pt(12, 3)); p.addLine(to: pt(19, 6)); p.addLine(to: pt(19, 12))
    p.addCurve(to: pt(12, 21), control1: pt(19, 16.5), control2: pt(16, 19.5))
    p.addCurve(to: pt(5, 12), control1: pt(8, 19.5), control2: pt(5, 16.5))
    p.addLine(to: pt(5, 6)); p.closeSubpath()
    p.move(to: pt(9.5, 12)); p.addLine(to: pt(11.5, 14)); p.addLine(to: pt(15, 10.5))
    return p
  }

  private var pillRect: CGRect {
    let W = bounds.width, H = bounds.height, ps = SleepSentryButton.pillSize
    let x = hugsLeft ? 0 : W - ps.width
    return CGRect(x: x, y: (H - ps.height) / 2 + 8, width: ps.width, height: ps.height)
  }
  private var discRect: CGRect {
    let W = bounds.width, H = bounds.height, d = SleepSentryButton.disc
    let x = hugsLeft ? 30 : W - d - 30
    return CGRect(x: x, y: (H - d) / 2 + 10, width: d, height: d)
  }
  /// Places every layer for the current look (no animation).
  private func lay() {
    CATransaction.begin(); CATransaction.setDisableActions(true)
    let r = look == .on ? discRect : pillRect
    pill.frame = r
    pill.cornerRadius = r.height / 2
    icon.frame = CGRect(x: 14, y: (SleepSentryButton.pillSize.height - 16) / 2, width: 16, height: 16)
    label.frame = CGRect(x: 38, y: (SleepSentryButton.pillSize.height - 18) / 2, width: SleepSentryButton.pillSize.width - 50, height: 18)
    let s: CGFloat = 30, d = discRect
    shieldFill.frame = CGRect(x: d.midX - s / 2, y: d.midY - s / 2, width: s, height: s)
    shield.frame = CGRect(origin: .zero, size: CGSize(width: s, height: s)); shield.path = SleepSentryButton.shieldPath(size: s)
    ring.frame = d.insetBy(dx: -8, dy: -8); ring.path = CGPath(ellipseIn: ring.bounds, transform: nil)
    caption.frame = CGRect(x: d.midX - 55, y: d.minY - 24, width: 110, height: 17)   // centred under the shield
    CATransaction.commit()
  }

  /// The words, the colours (the sleep screen's own ink, dim until it is touched), which side it hugs.
  func set(words w: (button: String, on: String), ink i: NSColor, lit: Bool, hugsLeft left: Bool, scale: CGFloat, bright: Double) {
    let side = left != hugsLeft
    hugsLeft = left; ink = i; words = w
    let a = CGFloat(max(0.18, min(1, bright)))
    alpha = lit ? 0.92 : 0.36 * a + 0.06
    CATransaction.begin(); CATransaction.setAnimationDuration(0.6)
    pill.backgroundColor = ink.withAlphaComponent(look == .on ? (lit ? 0.1 : 0.04) : (lit ? 0.12 : 0.04)).cgColor
    pill.borderColor = (look == .on ? SentryCover.soft.withAlphaComponent(lit ? 0.6 : 0.3) : ink.withAlphaComponent(lit ? 0.32 : 0.12)).cgColor
    icon.strokeColor = ink.withAlphaComponent(alpha).cgColor
    label.string = NSAttributedString(string: w.button, attributes: [.font: NSFont.systemFont(ofSize: 14, weight: .semibold), .foregroundColor: ink.withAlphaComponent(alpha)])
    label.contentsScale = scale
    caption.string = NSAttributedString(string: w.on, attributes: [.font: NSFont.systemFont(ofSize: 11.5, weight: .semibold), .foregroundColor: SentryCover.soft.withAlphaComponent(lit ? 0.85 : 0.45 * a + 0.1),
                                                                   .paragraphStyle: { let p = NSMutableParagraphStyle(); p.alignment = .center; return p }()])
    caption.contentsScale = scale
    if look == .on { shieldFill.opacity = Float(lit ? 1 : 0.55 * a + 0.2) }
    CATransaction.commit()
    if side { lay() }
    setAccessibilityLabel(look == .on ? w.on : w.button)
  }

  /// The state, with the fold into the shield (or straight there when reduce motion is on).
  func setLook(_ l: Look, reduceMotion: Bool) {
    guard l != look else { return }
    let was = look
    look = l
    window?.invalidateCursorRects(for: self)
    pill.removeAnimation(forKey: "busy")
    switch l {
    case .busy:
      // A slow breath on the pill while Sentry mode checks the power and engages.
      let b = CABasicAnimation(keyPath: "opacity")
      b.fromValue = 1; b.toValue = 0.45; b.duration = 0.7; b.autoreverses = true; b.repeatCount = .infinity
      b.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
      pill.add(b, forKey: "busy")
    case .idle:
      CATransaction.begin(); CATransaction.setAnimationDuration(reduceMotion ? 0.15 : 0.45)
      shieldFill.opacity = 0; caption.opacity = 0; label.opacity = 1; icon.opacity = 1
      CATransaction.commit()
      lay()
    case .on:
      fold(from: was, reduceMotion: reduceMotion)
    }
  }

  /// The pill folds into a round disc, its words fade, the shield draws itself in, the ring goes out once and
  /// "Protected by PS" fades in under it.
  private func fold(from: Look, reduceMotion: Bool) {
    let to = discRect
    if reduceMotion {
      CATransaction.begin(); CATransaction.setAnimationDuration(0.25)
      label.opacity = 0; icon.opacity = 0; shieldFill.opacity = 1; caption.opacity = 1
      CATransaction.commit()
      lay()
      return
    }
    let ease = CAMediaTimingFunction(controlPoints: 0.2, 0.8, 0.2, 1)
    CATransaction.begin()
    CATransaction.setAnimationDuration(0.22)
    label.opacity = 0; icon.opacity = 0
    CATransaction.commit()
    // The pill to the disc: a spring on its frame and corner.
    let fromFrame = pill.frame
    CATransaction.begin(); CATransaction.setDisableActions(true)
    pill.frame = to; pill.cornerRadius = to.height / 2
    CATransaction.commit()
    let spring = { (key: String, a: Any, b: Any) -> CASpringAnimation in
      let s = CASpringAnimation(keyPath: key); s.fromValue = a; s.toValue = b
      s.damping = 18; s.stiffness = 170; s.mass = 1; s.initialVelocity = 0; s.duration = s.settlingDuration
      s.beginTime = CACurrentMediaTime() + 0.08; s.fillMode = .backwards; return s
    }
    pill.add(spring("bounds.size", NSValue(size: fromFrame.size), NSValue(size: to.size)), forKey: "fold.size")
    pill.add(spring("position", NSValue(point: CGPoint(x: fromFrame.midX, y: fromFrame.midY)), NSValue(point: CGPoint(x: to.midX, y: to.midY))), forKey: "fold.pos")
    pill.add(spring("cornerRadius", fromFrame.height / 2, to.height / 2), forKey: "fold.corner")
    lay()
    // The shield draws itself in, then glows.
    let draw = CABasicAnimation(keyPath: "strokeEnd")
    draw.fromValue = 0; draw.toValue = 1; draw.duration = 0.75; draw.timingFunction = ease
    draw.beginTime = CACurrentMediaTime() + 0.3; draw.fillMode = .backwards
    shield.add(draw, forKey: "draw")
    let appear = CABasicAnimation(keyPath: "opacity")
    appear.fromValue = 0; appear.toValue = 1; appear.duration = 0.3; appear.beginTime = CACurrentMediaTime() + 0.3; appear.fillMode = .backwards
    shieldFill.add(appear, forKey: "in")
    shieldFill.opacity = 1
    let g = CAAnimationGroup()
    let sc = CABasicAnimation(keyPath: "transform.scale"); sc.fromValue = 0.6; sc.toValue = 1.35
    let op = CAKeyframeAnimation(keyPath: "opacity"); op.values = [0, 0.8, 0]; op.keyTimes = [0, 0.25, 1]
    g.animations = [sc, op]; g.duration = 1.4; g.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.7, 0.3, 1)
    g.beginTime = CACurrentMediaTime() + 0.75
    ring.add(g, forKey: "pulse")
    let cap = CABasicAnimation(keyPath: "opacity")
    cap.fromValue = 0; cap.toValue = 1; cap.duration = 0.5; cap.beginTime = CACurrentMediaTime() + 0.9; cap.fillMode = .backwards
    caption.add(cap, forKey: "in")
    caption.opacity = 1
  }

  override func mouseDown(with e: NSEvent) {
    let p = convert(e.locationInWindow, from: nil)
    if look == .idle, pillRect.insetBy(dx: -4, dy: -4).contains(p) { onTap?(); return }
    super.mouseDown(with: e)   // anywhere else: the sleep screen's own tap (it brightens the controls)
  }
  override func accessibilityPerformPress() -> Bool { if look == .idle { onTap?(); return true }; return false }
}

/// A small panel in the sleep screen's own colours: a title, its lines, and its buttons (the first is the main one).
final class SleepSentryPanel: NSView {
  init(title: String, lines: [String], buttons: [(String, Selector)], cancel: (String, Selector), target: AnyObject, ink: NSColor, bg: NSColor, width W: CGFloat) {
    super.init(frame: .zero)
    wantsLayer = true
    layer?.cornerRadius = 20; layer?.borderWidth = 1
    layer?.backgroundColor = bg.withAlphaComponent(0.97).cgColor; layer?.borderColor = ink.withAlphaComponent(0.25).cgColor
    layer?.shadowColor = NSColor.black.cgColor; layer?.shadowOpacity = 0.5; layer?.shadowRadius = 24; layer?.shadowOffset = .zero
    let pw = min(560, W - 40), inner = pw - 48
    func text(_ s: String, size: CGFloat, weight: NSFont.Weight, alpha: CGFloat) -> NSTextField {
      let t = NSTextField(wrappingLabelWithString: s)
      t.font = NSFont.systemFont(ofSize: size, weight: weight); t.textColor = ink.withAlphaComponent(alpha)
      t.isSelectable = false; t.drawsBackground = false; t.isBordered = false; t.alignment = .left
      t.preferredMaxLayoutWidth = inner
      return t
    }
    // From the bottom up: Cancel, the buttons, the lines, the title.
    var y: CGFloat = 18
    let cancelB = SleepButton(cancel.0, target: target, action: cancel.1)
    cancelB.font = NSFont.systemFont(ofSize: 13, weight: .semibold)
    cancelB.fill = .clear; cancelB.edge = .clear; cancelB.ink = ink.withAlphaComponent(0.6)
    cancelB.frame = NSRect(x: (pw - 140) / 2, y: y, width: 140, height: 30)
    addSubview(cancelB)
    y += 40
    for (i, b) in buttons.enumerated().reversed() {
      let btn = SleepButton(b.0, target: target, action: b.1)
      btn.font = NSFont.systemFont(ofSize: 15, weight: .bold)
      btn.fill = i == 0 ? ink.withAlphaComponent(0.2) : ink.withAlphaComponent(0.07)
      btn.edge = ink.withAlphaComponent(i == 0 ? 0.45 : 0.22); btn.ink = ink.withAlphaComponent(0.95)
      btn.frame = NSRect(x: 24, y: y, width: inner, height: 42)
      addSubview(btn)
      y += 50
    }
    y += 4
    for l in lines.reversed() {
      let t = text(l, size: 14.5, weight: .regular, alpha: 0.82)
      let h = ceil(t.cell?.cellSize(forBounds: NSRect(x: 0, y: 0, width: inner, height: 1000)).height ?? 20)
      t.frame = NSRect(x: 24, y: y, width: inner, height: h)
      addSubview(t)
      y += h + 8
    }
    y += 4
    let t = text(title, size: 20, weight: .bold, alpha: 0.95)
    let th = ceil(t.cell?.cellSize(forBounds: NSRect(x: 0, y: 0, width: inner, height: 1000)).height ?? 26)
    t.frame = NSRect(x: 24, y: y, width: inner, height: th)
    addSubview(t)
    y += th + 22
    setFrameSize(NSSize(width: pw, height: y))
    setAccessibilityElement(true); setAccessibilityRole(.group); setAccessibilityLabel(title)
  }
  required init?(coder: NSCoder) { nil }
  override var isFlipped: Bool { false }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func mouseDown(with e: NSEvent) {}   // a click on the panel itself does nothing (never reaches the screen under it)
}

final class SleepSentry: NSObject, SleepGuard {
  static let shared = SleepSentry()
  private weak var view: NSView?
  private var btn: SleepSentryButton?
  private var panel: SleepSentryPanel?
  private var spec: SleepSentryN?
  private var spot = SleepSentryRules.spotDef
  private var busy = false
  /// Turn on restart pressed on this screen: the check without its restart line (until the page's next plan).
  private var turnedOn = false
  /// Why the person is leaving (and when), until macOS says locked.
  private var leaving: (why: String, at: Double)?
  private var note: (text: String, until: Double)?
  private var noteL = NSTextField(labelWithString: "")
  private var ink = NSColor.white, lit = false
  private var reduceMotion: Bool { UpdatePaths.test ? false : NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
  private static func now() -> Double { Date().timeIntervalSince1970 * 1000 }

  /// Protecting the sleep screen now: engaged under it and still covering (not yet behind the lock screen, where the
  /// sleep screen has gone; an alarm that rings later on its own screen is not protected by it).
  var isOn: Bool { Sentry.shared.underSleep && Sentry.shared.isUp }
  var isBusy: Bool { busy }

  // MARK: SleepGuard

  func attach(to v: NSView, plan: SleepPlanN) {
    detach()
    view = v
    turnedOn = false; busy = false; leaving = nil; note = nil
    let b = SleepSentryButton(frame: .zero)
    b.onTap = { [weak self] in self?.tapped() }
    b.alphaValue = 0
    v.addSubview(b)
    btn = b
    noteL.font = NSFont.systemFont(ofSize: 12.5, weight: .medium); noteL.isBordered = false; noteL.drawsBackground = false
    noteL.isSelectable = false; noteL.lineBreakMode = .byWordWrapping; noteL.maximumNumberOfLines = 3
    noteL.stringValue = ""
    v.addSubview(noteL)
    // Comes in softly with the screen.
    NSAnimationContext.runAnimationGroup { $0.duration = 1.2; b.animator().alphaValue = 1 }
  }
  func detach() {
    panel?.removeFromSuperview(); panel = nil
    btn?.removeFromSuperview(); btn = nil
    noteL.removeFromSuperview()
    view = nil; busy = false
  }
  func draw(plan p: SleepPlanN, lit l: Bool, ink i: NSColor, drift: CGPoint) {
    guard let b = btn, let v = view else { return }
    ink = i; lit = l
    let s = SleepSentryN.parse(p.sentry)
    if !turnedOn || s?.check?.restartOff == nil { turnedOn = false }   // the page's plan caught up
    spec = s
    spot = SleepSentryRules.okSpot(p.look.sentry)
    let on = isOn
    // Shown while protected (always: it is the indicator), otherwise when the page sent the plan's part and the spot
    // is not Hidden; never on an alarm with Sleep mode off.
    let visible = on || (s != nil && !p.alarmOnly && spot != "hidden")
    b.isHidden = !visible
    noteL.isHidden = !visible
    guard visible else { return }
    let place = SleepSentryRules.frame(spot: spot == "hidden" ? SleepSentryRules.spotDef : spot, width: Double(v.bounds.width), height: Double(v.bounds.height), size: SleepSentryButton.size)
      ?? CGRect(origin: .zero, size: SleepSentryButton.size)
    let target = NSPoint(x: place.minX + drift.x, y: place.minY + drift.y)
    if b.frame.origin == .zero || abs(b.frame.minX - target.x) > 40 || abs(b.frame.minY - target.y) > 40 { b.setFrameOrigin(target) }
    else if b.frame.origin != target { NSAnimationContext.runAnimationGroup { $0.duration = 6; b.animator().setFrameOrigin(target) } }
    let left = SleepSentryRules.hugsLeft(spot)
    let w = (button: s?.word("button") ?? SleepSentryRules.words["button"]!, on: s?.word("on") ?? SentryRules.title)
    b.set(words: w, ink: ink, lit: l, hugsLeft: left, scale: v.window?.backingScaleFactor ?? 2, bright: p.look.bright)
    b.setLook(on ? .on : busy ? .busy : .idle, reduceMotion: reduceMotion)
    b.toolTip = on ? nil : s?.word("tip")
    // A refusal note, for a few seconds, under the button.
    if let n = note, SleepSentry.now() > n.until { note = nil }
    noteL.stringValue = note?.text ?? ""
    noteL.textColor = SleepScreen.glow(0.8)
    noteL.alignment = left ? .left : .right
    noteL.frame = NSRect(x: left ? b.frame.minX : b.frame.maxX - 280, y: b.frame.minY - 44, width: 280, height: 46)
  }
  func escape() -> Bool {
    if panel != nil { psLog("PS sleep sentry: Esc closes the panel"); closePanel(); return true }
    if isOn { leave("esc"); return true }
    return false
  }
  func leave(_ why: String) {
    guard isOn else { return }
    if leaving == nil { leaving = (why, SleepSentry.now()) }
    psLog("PS sleep sentry: leaving (\(why)) through the lock screen")
    Sentry.shared.leaveFromSleep(why)
  }
  func lines(onBattery: Bool) -> (battery: String, hint: String)? {
    guard isOn, let s = spec ?? SleepSentryN.parse(["plan": [:]]) else { return nil }
    return (SleepSentryRules.batteryLine(s, onBattery: onBattery) ?? "", s.word("hint"))
  }

  // MARK: pressing it

  private func tapped() {
    guard SleepScreen.shared.isUp, !isOn, !busy, panel == nil, spec != nil else { return }
    SleepScreen.shared.touched()
    psLog("PS sleep sentry: AI Sentry mode pressed")
    // V1.54 (HelperCheckCore): ask the restart helper fresh first (a few seconds at most, the button shows busy), so a
    // helper switched on a moment ago never reads as off. Nothing blocks: the answer comes back on the main thread.
    busy = true; helperOK = false
    SleepScreen.shared.redraw()
    AutoReboot.shared.check { [weak self] in
      guard let self else { return }
      self.busy = false
      self.helperOK = AutoReboot.shared.lastGap == nil
      SleepScreen.shared.redraw()
      // The other way round (the page's plan still says fine, the fresh check found a gap): the page works the check out
      // again from the settings this check just sent, so give its new plan a moment to arrive (it draws the words).
      let wait: Double = AutoReboot.shared.lastGap != nil && self.spec?.check?.helper == nil ? 0.6 : 0
      DispatchQueue.main.asyncAfter(deadline: .now() + wait) { [weak self] in
        guard let self, SleepScreen.shared.isUp, !self.isOn, !self.busy, self.panel == nil, let now = self.spec else { return }
        self.step(now)
      }
    }
  }
  /// The fresh check found the helper on and answering (until the next press).
  private var helperOK = false
  private func step(_ s: SleepSentryN) {
    switch SleepSentryRules.firstStep(s) {
    case .check: if let c = currentCheck(s) { showCheck(c) } else { engage(s.plan) }
    case .engage: engage(s.plan)
    }
  }
  /// The check as it stands here: after Turn on restart, without its restart line (nil: nothing left).
  private func currentCheck(_ s: SleepSentryN) -> SleepSentryN.Check? {
    guard var c = s.check else { return nil }
    if helperOK && c.helper != nil { guard let left = SleepSentryRules.afterHelperOK(c) else { return nil }; c = left }
    return turnedOn ? SleepSentryRules.afterTurnOn(c) : c
  }
  private func planNow(_ s: SleepSentryN) -> SentryPlanN { var p = s.plan; if turnedOn { p.restartH = s.restartOn }; return p }

  private func showCheck(_ c: SleepSentryN.Check) {
    if let s = spec, lidGate(planNow(s), then: { [weak self] in self?.showCheck(c) }) { return }   // V1.54: the lid first
    let lid = spec.flatMap { SleepSentryRules.lidPanel(c, gap: lidGap, $0) }
    var buttons: [(String, Selector)] = []
    if c.fixHelper || lid != nil { buttons.append((c.setUp, #selector(setUpTapped))) }
    if c.restartOff != nil { buttons.append((c.turnOn, #selector(turnOnTapped))) }
    buttons.append((c.anyway, #selector(anywayTapped)))
    show(SleepSentryPanel(title: c.title, lines: lid?.lines ?? SleepSentryRules.lines(c), buttons: buttons, cancel: (c.cancel, #selector(cancelTapped)),
                          target: self, ink: ink, bg: bg, width: view?.bounds.width ?? 800))
  }

  // MARK: V1.54 the lid check before engaging (lid-notice-154; apart from the restart check above)

  /// What the lid check found for this press, and when (milliseconds). Nil: not checked yet.
  private var lidChecked: (at: Double, gap: SentryLid.Gap?)?
  /// Engage anyway was pressed on a pop up with the lid row: no second lid check for this engage.
  private var lidAnyway = false
  private var lidGap: String? { lidChecked?.gap?.rawValue }
  /// With the lid option on and no fresh check: check it (a few seconds at most, the button shows busy, nothing
  /// blocks), then `then`. True: it is checking now, the caller returns.
  private func lidGate(_ p: SentryPlanN, then: @escaping () -> Void) -> Bool {
    guard p.lid, !lidAnyway else { return false }
    if let c = lidChecked, SleepSentry.now() - c.at < SleepSentryRules.lidCheckFor { return false }
    busy = true
    SleepScreen.shared.redraw()
    SentryLid.shared.probe { [weak self] g in
      guard let self else { return }
      self.busy = false
      self.lidChecked = (SleepSentry.now(), g)
      SleepScreen.shared.redraw()
      guard SleepScreen.shared.isUp, !self.isOn, self.panel == nil else { return }
      then()
    }
    return true
  }
  /// The pop up with only the lid row (the restart check had nothing to say).
  private func showLidOnly(_ lp: SleepSentryRules.LidPanel, _ s: SleepSentryN) {
    show(SleepSentryPanel(title: lp.title, lines: lp.lines,
                          buttons: [(s.word("lidSetUp"), #selector(setUpTapped)), (s.word("lidAnyway"), #selector(anywayTapped))],
                          cancel: (s.word("lidCancel"), #selector(cancelTapped)), target: self, ink: ink, bg: bg, width: view?.bounds.width ?? 800))
  }
  private var bg: NSColor { SleepScreen.color(SleepScreen.shared.lookNow?.bg ?? "#050302", 1) }
  private func show(_ p: SleepSentryPanel) {
    guard let v = view else { return }
    panel?.removeFromSuperview()
    p.setFrameOrigin(NSPoint(x: ((v.bounds.width - p.frame.width) / 2).rounded(), y: ((v.bounds.height - p.frame.height) / 2).rounded()))
    p.alphaValue = 0
    v.addSubview(p)
    panel = p
    psLog("PS sleep sentry: the restart check shows")
    NSAnimationContext.runAnimationGroup { c in c.duration = reduceMotion ? 0.12 : 0.28; c.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.8, 0.2, 1); p.animator().alphaValue = 1 }
  }
  private func closePanel() {
    guard let p = panel else { return }
    panel = nil
    NSAnimationContext.runAnimationGroup({ $0.duration = 0.18; p.animator().alphaValue = 0 }, completionHandler: { p.removeFromSuperview() })
    SleepScreen.shared.touched()
  }

  @objc private func cancelTapped() { psLog("PS sleep sentry: panel cancelled"); lidChecked = nil; lidAnyway = false; closePanel() }
  @objc private func setUpTapped() {
    lidChecked = nil
    closePanel()
    psLog("PS sleep sentry: Set up the helper, leaving Sleep mode for Security")
    SleepScreen.shared.askFromGuard("security")
  }
  @objc private func turnOnTapped() {
    guard let s = spec else { closePanel(); return }
    turnedOn = true
    SleepScreen.shared.deliver?("window.__psSentryAsk && window.__psSentryAsk({\"do\":\"restartOn\"})")
    psLog("PS sleep sentry: restart turned on (\(s.restartOn) h)")
    // Nothing else missing: the fix was the last step, so engage now (as the AI button does). Otherwise what is left.
    if let left = currentCheck(s) { closePanelNow(); showCheck(left) } else { closePanel(); engage(planNow(s)) }
  }
  @objc private func anywayTapped() {
    lidAnyway = true   // the lid row, if any, was on this pop up
    closePanel()
    if let s = spec { psLog("PS sleep sentry: Engage anyway"); engage(planNow(s)) }
  }
  private func closePanelNow() { panel?.removeFromSuperview(); panel = nil }

  // MARK: engaging, and what Sentry mode tells this screen

  private func engage(_ p: SentryPlanN) {
    guard SleepScreen.shared.isUp, !isOn, !busy else { return }
    // V1.54: the lid check before engaging; a gap shows its own pop up (Engage anyway comes back here).
    if lidGate(p, then: { [weak self] in self?.engage(p) }) { return }
    if !lidAnyway, let s = spec, let lp = SleepSentryRules.lidPanel(nil, gap: lidGap, s) { showLidOnly(lp, s); return }
    lidAnyway = false; lidChecked = nil
    busy = true; note = nil
    SleepScreen.shared.redraw()
    Sentry.shared.startUnderSleep(p, host: Sentry.SleepHost(
      display: { SleepScreen.shared.display },
      event: { [weak self] e in self?.hostEvent(e) },
      done: { [weak self] r in
        guard let self else { return }
        self.busy = false
        if let r {
          psLog("PS sleep sentry: not engaged (\(r))")
          if r != "gone" && r != "engaged" { self.note = (SleepSentryRules.refusedLine(self.spec, code: r), SleepSentry.now() + 6000) }
        } else { psLog("PS sleep sentry: protected, the button is the shield now") }
        SleepScreen.shared.touched()
      }))
  }
  private func hostEvent(_ e: Sentry.HostEvent) {
    switch e {
    case .aside(let on): SleepScreen.shared.stepBehind(on)
    case .letSleep: SleepScreen.shared.letSleep()
    case .locked(let w):
      // macOS says locked: this screen goes now, for the reason the person gave (or Sentry's own).
      let why = leaving?.why ?? SleepSentryRules.closeWhy(lockWhy: w)
      finish(why)
    case .ended(let w):
      if SleepScreen.shared.isUp, SleepScreen.shared.plan?.alarmOnly != true { finish(leaving?.why ?? SleepSentryRules.endWhy(w)) }
      leaving = nil
      SleepScreen.shared.redraw()
    }
  }
  /// The sleep screen goes. Only Wake up logs a wake time; Esc (and a lock Sentry made for its own reason) locks PS.
  private func finish(_ why: String) {
    let at = leaving?.at ?? SleepSentry.now()
    leaving = nil
    guard SleepScreen.shared.isUp else { return }
    psLog("PS sleep sentry: the sleep screen goes (\(why))")
    SleepScreen.shared.closeFromGuard(why, woke: why == "wake" ? at : nil)
    if SleepSentryRules.locksPS(why) { SleepScreen.shared.onEscaped?() }
  }
}
