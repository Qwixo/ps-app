// The token guide on the person's own screen (V1.49, the developer, 12 Nov 2026). From the "Connect your own Supabase"
// window (ProjectSetup.swift), PS app opens the exact Supabase page in the default browser and shows, beside the
// browser, a small step card (ui/guide.html) plus one numbered, animated arrow pointing at what to click. On the
// last step (Copy) PS app watches the clipboard for a Supabase access token; when one is copied it comes to the
// front by itself with the token already in, and the guide goes away.
//
// What PS app may see here (GuideCore has the rules and their tests):
//  - the browser window's FRAME only (CGWindowList: process id, layer, bounds; never a title, never the page);
//  - the clipboard only on the Copy step, never while 1Password or Signal is in front, never a copy made there or
//    marked concealed or transient, and nothing kept but a match (handed straight to ProjectSetup, never logged).
// Golden rule: while 1Password or Signal is in front the card and the arrow are hidden and nothing is read; the
// card never takes focus by itself (a non activating panel), and PS app never comes forward over either app.
// Mission Control (hard rule 5): the arrow window is a small square around the arrow, the card is the card's size,
// both ordered out (not just faded) when hidden. Nothing here blocks the main thread: the window list is read on its
// own queue, the clipboard text too.
import AppKit
import WebKit

/// The step card's panel. It can take the keyboard when clicked (so Esc reaches it) without making PS app the
/// active app, so the browser stays where the person is working.
final class GuideCardPanel: NSPanel {
  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { false }
}

/// The numbered marker and its arrow, drawn with layers (transform and opacity animations only).
final class GuideMarkerView: NSView {
  static let side: CGFloat = 220
  private var root = CALayer()
  override init(frame: NSRect) {
    super.init(frame: frame)
    wantsLayer = true
    layer?.addSublayer(root)
  }
  required init?(coder: NSCoder) { fatalError() }
  override var isFlipped: Bool { true }

  /// Draws marker `n` with its arrow tip at the view's centre, the marker `toward` that way.
  func show(_ n: Int, toward v: CGVector, scale: CGFloat) {
    root.removeFromSuperlayer()
    root = CALayer()
    root.frame = bounds
    layer?.addSublayer(root)
    let pink = CGColor(red: 0.925, green: 0.306, blue: 0.525, alpha: 1)
    let deep = CGColor(red: 0.784, green: 0.212, blue: 0.42, alpha: 1)
    let tip = CGPoint(x: bounds.midX, y: bounds.midY)
    let len: CGFloat = 74, r: CGFloat = 19
    let c = CGPoint(x: tip.x + v.dx * len, y: tip.y + v.dy * len)

    // The arrow: a soft curve from the marker's edge to the tip, then the head.
    let start = CGPoint(x: c.x - v.dx * (r + 5), y: c.y - v.dy * (r + 5))
    let end = CGPoint(x: tip.x + v.dx * 6, y: tip.y + v.dy * 6)
    let mid = CGPoint(x: (start.x + end.x) / 2 - v.dy * 12, y: (start.y + end.y) / 2 + v.dx * 12)
    let line = CGMutablePath(); line.move(to: start); line.addQuadCurve(to: end, control: mid)
    let ang = atan2(end.y - mid.y, end.x - mid.x)
    let head = CGMutablePath()
    for s in [CGFloat.pi * 0.82, -CGFloat.pi * 0.82] {
      head.move(to: end); head.addLine(to: CGPoint(x: end.x + cos(ang + s) * 12, y: end.y + sin(ang + s) * 12))
    }
    let arrow = CALayer(); arrow.frame = bounds
    for (p, w, a) in [(line, CGFloat(7), CGFloat(0.28)), (line, 3.2, 1), (head, 7, 0.28), (head, 3.2, 1)] as [(CGPath, CGFloat, CGFloat)] {
      let s = CAShapeLayer(); s.frame = bounds; s.path = p
      s.strokeColor = a < 1 ? CGColor(gray: 0, alpha: a) : pink
      s.fillColor = nil; s.lineWidth = w; s.lineCap = .round; s.lineJoin = .round
      arrow.addSublayer(s)
    }
    root.addSublayer(arrow)

    // A ring that keeps pulsing out from the tip, so the eye finds the spot.
    let ping = CAShapeLayer()
    ping.frame = CGRect(x: tip.x - 16, y: tip.y - 16, width: 32, height: 32)
    ping.path = CGPath(ellipseIn: CGRect(x: 0, y: 0, width: 32, height: 32), transform: nil)
    ping.fillColor = nil; ping.strokeColor = pink; ping.lineWidth = 2.5
    root.addSublayer(ping)

    // The numbered marker.
    let dot = CAGradientLayer()
    dot.frame = CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)
    dot.colors = [pink, deep]; dot.startPoint = CGPoint(x: 0, y: 0); dot.endPoint = CGPoint(x: 1, y: 1)
    dot.cornerRadius = r
    dot.borderColor = CGColor(gray: 1, alpha: 0.9); dot.borderWidth = 2
    dot.shadowColor = pink; dot.shadowOpacity = 0.55; dot.shadowRadius = 10; dot.shadowOffset = .zero
    let num = CATextLayer()
    num.string = NSAttributedString(string: "\(n)", attributes: [.font: NSFont.systemFont(ofSize: 17, weight: .bold), .foregroundColor: NSColor.white])
    num.alignmentMode = .center
    num.contentsScale = scale
    num.frame = CGRect(x: 0, y: (r * 2 - 21) / 2, width: r * 2, height: 22)
    dot.addSublayer(num)
    root.addSublayer(dot)
    [arrow, ping, dot, num].forEach { $0.contentsScale = scale }
    arrow.sublayers?.forEach { $0.contentsScale = scale }

    // Entrance: the marker pops in, then the arrow draws itself, then the whole thing nudges towards the spot.
    let pop = CASpringAnimation(keyPath: "transform.scale")
    pop.fromValue = 0.2; pop.toValue = 1; pop.damping = 11; pop.stiffness = 180; pop.mass = 1
    pop.duration = pop.settlingDuration
    dot.add(pop, forKey: "pop")
    let fade = CABasicAnimation(keyPath: "opacity"); fade.fromValue = 0; fade.toValue = 1; fade.duration = 0.25
    root.add(fade, forKey: "in")
    for s in arrow.sublayers ?? [] {
      guard let s = s as? CAShapeLayer else { continue }
      let draw = CABasicAnimation(keyPath: "strokeEnd"); draw.fromValue = 0; draw.toValue = 1
      draw.duration = 0.45; draw.beginTime = CACurrentMediaTime() + 0.12; draw.fillMode = .backwards
      draw.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.8, 0.2, 1)
      s.add(draw, forKey: "draw")
    }
    let nudge = CABasicAnimation(keyPath: "transform.translation")
    nudge.fromValue = NSValue(size: .zero); nudge.toValue = NSValue(size: NSSize(width: -v.dx * 7, height: -v.dy * 7))
    nudge.duration = 0.6; nudge.autoreverses = true; nudge.repeatCount = .infinity
    nudge.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut); nudge.beginTime = CACurrentMediaTime() + 0.6
    for l in [arrow, dot] { l.add(nudge, forKey: "nudge") }
    let grow = CABasicAnimation(keyPath: "transform.scale"); grow.fromValue = 0.4; grow.toValue = 1.9
    let out = CABasicAnimation(keyPath: "opacity"); out.fromValue = 0.9; out.toValue = 0
    let g = CAAnimationGroup(); g.animations = [grow, out]; g.duration = 1.3; g.repeatCount = .infinity
    g.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.8, 0.2, 1)
    ping.opacity = 0
    ping.add(g, forKey: "ping")
  }
}

final class SetupGuide: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
  static let shared = SetupGuide()
  static let cardSize = NSSize(width: 344, height: 420)

  /// A token was copied on the Copy step (handed over once, never kept here).
  var onToken: ((String) -> Void)?
  /// The guide ended without a token. True: the person asked to go back to PS app (Paste it myself, close).
  var onEnd: ((Bool) -> Void)?
  /// Each step as it shows, for the setup window's own progress.
  var onStep: ((GuideCore.Stage) -> Void)?

  private(set) var running = false
  private var steps: [GuideCore.Step] = []
  private var index = 0
  private var card: GuideCardPanel?
  private var cardWeb: WKWebView?
  private var cardReady = false
  private var queued: [String] = []
  private var marker: NSPanel?
  private var markerView: GuideMarkerView?
  private var markerShown: (Int, CGPoint)?
  private var browserPid: pid_t = 0
  private var browserFrame: CGRect?          // top left based, from the window list
  private var browserFront = false
  private var frameTimer: Timer?
  private var pasteTimer: Timer?
  private var watch = GuideCore.PasteWatch()
  private var gen = 0                        // drops answers that arrive after the guide moved on or stopped
  private var frontObs: NSObjectProtocol?
  private var caughtOnce = false
  private let frameQ = DispatchQueue(label: "PS guide frame", qos: .utility)
  private let readQ = DispatchQueue(label: "PS guide clipboard", qos: .userInitiated)
  private var test: Bool { IS_TEST_COPY || ProjectStore.test }

  // MARK: start and stop

  func start(from stage: GuideCore.Stage) {
    stop(quiet: true)
    running = true; caughtOnce = false
    gen += 1
    steps = GuideCore.steps(from: stage)
    index = 0
    psLog("PS guide: started at \(stage.rawValue)")
    if card == nil { buildCard() }
    frontObs = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] n in
      self?.frontChanged(n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)
    }
    frameTimer = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { [weak self] _ in self?.readFrame() }
    frameTimer?.tolerance = 0.1
    enter(0)
  }

  /// Ends the guide. Everything it showed is ordered out and nothing more is read.
  func stop(quiet: Bool = false) {
    guard running || card?.isVisible == true || marker?.isVisible == true else { return }
    let was = running
    running = false
    gen += 1
    watch.disarm()
    pasteTimer?.invalidate(); pasteTimer = nil
    frameTimer?.invalidate(); frameTimer = nil
    if let o = frontObs { NSWorkspace.shared.notificationCenter.removeObserver(o); frontObs = nil }
    browserPid = 0; browserFrame = nil; markerShown = nil
    hideMarker()
    if let c = card, c.isVisible {
      NSAnimationContext.runAnimationGroup({ ctx in ctx.duration = 0.2; c.animator().alphaValue = 0 }, completionHandler: { [weak self] in
        guard let self, !self.running else { return }
        c.orderOut(nil)
      })
    }
    if was && !quiet { psLog("PS guide: stopped") }
  }

  // MARK: steps

  private func enter(_ i: Int) {
    guard running, steps.indices.contains(i) else { return }
    index = i
    let s = steps[i]
    if let u = s.url.flatMap(URL.init(string:)) { open(u) }
    // The clipboard: armed on the Copy step only, and only for copies made from now on.
    if GuideCore.watches(s.stage) { armWatch() } else { watch.disarm(); pasteTimer?.invalidate(); pasteTimer = nil }
    cardCall("show", ["n": i + 1, "total": steps.count, "stage": s.stage.rawValue, "title": s.title, "text": s.text,
                      "watching": GuideCore.watches(s.stage), "note": GuideCore.watchNote, "first": i == 0])
    markerShown = nil
    layout()
    onStep?(s.stage)
  }

  /// Opens the exact page in the person's default browser and remembers which app that is (for its frame).
  private func open(_ u: URL) {
    guard !test else { return }
    let cfg = NSWorkspace.OpenConfiguration()
    cfg.activates = true
    let g = gen
    guard let appURL = NSWorkspace.shared.urlForApplication(toOpen: u) else { NSWorkspace.shared.open(u); return }
    NSWorkspace.shared.open([u], withApplicationAt: appURL, configuration: cfg) { [weak self] app, _ in
      DispatchQueue.main.async {
        guard let self, g == self.gen, let app, !Protected.matches(app) else { return }
        self.browserPid = app.processIdentifier
        self.browserFront = NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier
        self.readFrame()
      }
    }
  }

  private func frontChanged(_ app: NSRunningApplication?) {
    guard running else { return }
    // Leaving 1Password or Signal: skip whatever was copied there, before the next look (GuideCore.PasteWatch).
    watch.frontChanged(count: NSPasteboard.general.changeCount, leftProtected: !Protected.matches(app) && lastFrontProtected)
    lastFrontProtected = Protected.matches(app)
    browserFront = browserPid > 0 && app?.processIdentifier == browserPid
    layout()
  }
  private var lastFrontProtected = false

  // MARK: the browser's frame (never its contents)

  private func readFrame() {
    guard running, browserPid > 0 else { return }
    let pid = browserPid, g = gen
    frameQ.async { [weak self] in
      let list = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]) ?? []
      let f = GuideCore.browserFrame(in: list, pid: pid)
      DispatchQueue.main.async {
        guard let self, g == self.gen, self.running else { return }
        if f != self.browserFrame { self.browserFrame = f; self.layout() }
      }
    }
  }

  // MARK: placing the card and the arrow

  /// Top left based (window list) rect to AppKit's bottom left based screen coordinates.
  private func flip(_ r: CGRect) -> NSRect {
    let h = NSScreen.screens.first?.frame.height ?? 0
    return NSRect(x: r.minX, y: h - r.maxY, width: r.width, height: r.height)
  }
  private func unflip(_ r: NSRect) -> CGRect {
    let h = NSScreen.screens.first?.frame.height ?? 0
    return CGRect(x: r.minX, y: h - r.maxY, width: r.width, height: r.height)
  }
  private func screen(for b: CGRect?) -> NSScreen? {
    if let b { let c = flip(b); if let s = NSScreen.screens.first(where: { $0.frame.contains(NSPoint(x: c.midX, y: c.midY)) }) { return s } }
    return NSScreen.main ?? NSScreen.screens.first
  }

  private func layout() {
    guard running, let card else { return }
    // Golden rule: nothing of PS app's shows over 1Password or Signal.
    if Protected.front { card.orderOut(nil); hideMarker(); return }
    if IS_TEST_COPY { card.alphaValue = 0; card.setFrameOrigin(NSPoint(x: -20000, y: -20000)); card.orderFrontRegardless(); return }   // parked
    guard let scr = screen(for: browserFrame) else { return }
    let o = GuideCore.cardOrigin(browser: browserFrame, screen: unflip(scr.visibleFrame), card: SetupGuide.cardSize)
    let target = flip(CGRect(origin: o, size: SetupGuide.cardSize))
    if !card.isVisible {
      card.setFrame(target.offsetBy(dx: 0, dy: -14), display: false)
      card.alphaValue = 0
      card.orderFrontRegardless()   // shows without taking focus (non activating panel)
      NSAnimationContext.runAnimationGroup { ctx in
        ctx.duration = 0.42; ctx.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.8, 0.2, 1)
        card.animator().alphaValue = 1; card.animator().setFrame(target, display: true)
      }
    } else if abs(card.frame.minX - target.minX) > 1 || abs(card.frame.minY - target.minY) > 1 || card.alphaValue < 1 {
      NSAnimationContext.runAnimationGroup { ctx in ctx.duration = 0.25; card.animator().alphaValue = 1; card.animator().setFrame(target, display: true) }
    }
    placeMarker()
  }

  private func placeMarker() {
    let s = steps[index]
    guard browserFront, let b = browserFrame, let a = GuideCore.anchor(s.stage, in: b) else { hideMarker(); return }
    let side = GuideMarkerView.side
    let r = flip(CGRect(x: a.tip.x - side / 2, y: a.tip.y - side / 2, width: side, height: side))
    if marker == nil {
      let p = NSPanel(contentRect: r, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
      p.isOpaque = false; p.backgroundColor = .clear; p.hasShadow = false
      p.ignoresMouseEvents = true   // every click goes to the browser underneath
      p.level = .floating
      p.collectionBehavior = [.canJoinAllSpaces, .transient, .fullScreenAuxiliary, .ignoresCycle]
      p.isReleasedWhenClosed = false
      let v = GuideMarkerView(frame: NSRect(origin: .zero, size: r.size))
      p.contentView = v
      marker = p; markerView = v
    }
    guard let m = marker, let v = markerView else { return }
    if markerShown?.0 == index + 1, let at = markerShown?.1, abs(at.x - r.minX) < 1, abs(at.y - r.minY) < 1, m.isVisible { return }
    let same = markerShown?.0 == index + 1 && m.isVisible
    m.setFrame(r, display: false)
    if !same { v.show(index + 1, toward: a.toward, scale: m.backingScaleFactor) }
    markerShown = (index + 1, r.origin)
    if IS_TEST_COPY { m.alphaValue = 0 }
    m.orderFrontRegardless()
  }
  private func hideMarker() { marker?.orderOut(nil); markerShown = nil }

  // MARK: the clipboard (Copy step only)

  private func armWatch() {
    guard !test else { return }   // test copies never look at the clipboard
    watch.arm(count: NSPasteboard.general.changeCount)
    lastFrontProtected = Protected.front
    pasteTimer?.invalidate()
    pasteTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.lookAtClipboard() }
    pasteTimer?.tolerance = 0.05
    psLog("PS guide: watching the clipboard for a Supabase token (Copy step)")
  }

  private func lookAtClipboard() {
    guard running, GuideCore.watches(steps[index].stage) else { watch.disarm(); return }
    let pb = NSPasteboard.general
    let count = pb.changeCount
    let act = watch.tick(count: count, protectedFront: Protected.front) { (pb.types ?? []).map(\.rawValue) }
    guard act == .read else { return }
    let g = gen
    readQ.async { [weak self] in
      // Read once, matched at once, dropped at once: nothing but a token leaves this block, nothing is logged.
      let found = pb.string(forType: .string).flatMap { GuideCore.token(in: $0) }
      guard let found else { return }
      DispatchQueue.main.async {
        guard let self, g == self.gen, self.running, self.watch.armed, !Protected.front, pb.changeCount == count else { return }
        self.caught(found)
      }
    }
  }

  private func caught(_ token: String) {
    guard !caughtOnce else { return }
    caughtOnce = true
    watch.disarm(); pasteTimer?.invalidate(); pasteTimer = nil
    psLog("PS guide: a Supabase token was copied, handing it to the setup window")
    hideMarker()
    cardCall("caught", ["title": GuideCore.caughtTitle, "text": GuideCore.caughtText])
    let g = gen
    let hand = onToken
    // The card says "Got your token" for a moment, then PS app comes forward with it already in.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { [weak self] in
      guard let self, g == self.gen else { return }
      self.stop(quiet: true)
      hand?(token)
    }
  }

  // MARK: the card (ui/guide.html)

  private func buildCard() {
    let c = WKWebViewConfiguration()
    c.websiteDataStore = .nonPersistent()
    if IS_TEST_COPY, let list = testBlockList { c.userContentController.add(list) }
    c.userContentController.add(self, name: "guide")
    let size = SetupGuide.cardSize
    let v = ClickThroughWebView(frame: NSRect(origin: .zero, size: size), configuration: c)
    v.setValue(false, forKey: "drawsBackground")
    v.navigationDelegate = self
    let p = GuideCardPanel(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    p.isOpaque = false; p.backgroundColor = .clear; p.hasShadow = true
    p.level = .floating
    p.collectionBehavior = [.canJoinAllSpaces, .transient, .fullScreenAuxiliary, .ignoresCycle]
    p.isReleasedWhenClosed = false
    p.hidesOnDeactivate = false
    p.becomesKeyOnlyIfNeeded = true
    p.isMovableByWindowBackground = false
    p.appearance = NSAppearance(named: .darkAqua)
    p.title = "PS app guide"
    p.contentView = v
    if IS_TEST_COPY { p.ignoresMouseEvents = true }
    card = p; cardWeb = v; cardReady = false
    let file = Bundle.main.resourceURL!.appendingPathComponent("guide.html")
    v.loadFileURL(file, allowingReadAccessTo: file)
  }

  private func cardCall(_ fn: String, _ arg: [String: Any]) {
    guard let d = try? JSONSerialization.data(withJSONObject: arg), let s = String(data: d, encoding: .utf8) else { return }
    let js = "window.__g && window.__g.\(fn)(\(s))"
    if cardReady { cardWeb?.evaluateJavaScript(js, completionHandler: nil) } else { queued.append(js) }
  }

  func webView(_ webView: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    decisionHandler(a.request.url?.isFileURL == true ? .allow : .cancel)
  }

  func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.webView === cardWeb, let s = message.body as? String,
          let o = try? JSONSerialization.jsonObject(with: Data(s.utf8)) as? [String: Any], let t = o["type"] as? String else { return }
    switch t {
    case "ready":
      cardReady = true
      queued.forEach { cardWeb?.evaluateJavaScript($0, completionHandler: nil) }; queued = []
    case "next": if running && !caughtOnce { enter(index + 1) }
    case "back": if running && !caughtOnce && index > 0 { enter(index - 1) }
    case "reopen":   // "Open the page again": the current step's page, or the tokens page
      if running, let u = URL(string: steps[index].url ?? (steps[index].stage == .account ? GuideCore.signUpURL : GuideCore.tokensURL)) { open(u) }
    case "close", "paste":   // the close button, Esc, or "Paste it myself": back to PS app's window
      guard running, !caughtOnce else { return }
      stop()
      onEnd?(true)
    default: break
    }
  }
}
