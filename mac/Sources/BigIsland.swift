import AppKit
import AVFoundation
import SwiftUI

// PS 1.60 (items 26 and 27) on screen: the island grows into a big panel, for Welcome back and for the workout summary.
// The rules, numbers and words are in WelcomeBackCore.swift and WorkoutSummaryCore.swift (tested); this draws them, plays
// the sounds and listens for the Mac coming back.
//
// How it looks: ONE window just above the real island, the same black, joined flat to the island's top edge and rounded at
// the bottom (like the What's new panel). It starts exactly the island's size and grows on a spring after the island's own
// squeeze (Island.moment), so it reads as the island itself growing. Closing shrinks it back up into the island.
// It never takes the keyboard (Esc closes it, in PS's windows at once and in any app once Accessibility is on, as the stand-up
// question does), uses PR 6's shared queue (IslandQueue) so it is never on top of another card, and gives way to Reduce Motion
// (fades, no springs). Sounds: the existing island tones (SetupIslandSound) and one soft tone made in code.

// MARK: - sounds

enum BigIslandSound {
  /// A quiet tick as each part of the summary comes in (a sine at 1318 Hz, 0.12 s, soft).
  static let soft: [Sfx.Tone] = [Sfx.Tone(f: 1318.5, to: nil, dur: 0.12, peak: 0.07, wave: 0, at: 0)]
  private static var players: [String: AVAudioPlayer] = [:]
  static func play(_ kind: WorkoutSummaryCore.SoundKind, volume: Double = 0.4) {
    let tones = kind == .chime ? SetupIslandSound.chime : soft
    play(kind.rawValue, tones, kind == .chime ? volume : 0.3)
  }
  static func play(_ name: String, _ tones: [Sfx.Tone], _ volume: Double) {
    guard ProcessInfo.processInfo.environment["PS_SELFTEST"] == nil, !DND.shared.mutes("sounds") else { return }
    if players[name] == nil { players[name] = try? AVAudioPlayer(data: Sfx.wav(tones)); players[name]?.prepareToPlay() }
    guard let p = players[name] else { return }
    p.volume = Float(volume); p.currentTime = 0; p.play()
  }
}

// MARK: - the shape: flat on top (joined to the island), round at the bottom

struct HangShape: Shape {
  var bottom: CGFloat
  var animatableData: CGFloat { get { bottom } set { bottom = newValue } }
  func path(in r: CGRect) -> Path {
    let b = max(0, min(bottom, min(r.width, r.height) / 2))
    var p = Path()
    p.move(to: CGPoint(x: r.minX, y: r.minY))
    p.addLine(to: CGPoint(x: r.maxX, y: r.minY))
    p.addLine(to: CGPoint(x: r.maxX, y: r.maxY - b))
    p.addArc(center: CGPoint(x: r.maxX - b, y: r.maxY - b), radius: b, startAngle: .degrees(0), endAngle: .degrees(90), clockwise: false)
    p.addLine(to: CGPoint(x: r.minX + b, y: r.maxY))
    p.addArc(center: CGPoint(x: r.minX + b, y: r.maxY - b), radius: b, startAngle: .degrees(90), endAngle: .degrees(180), clockwise: false)
    p.closeSubpath()
    return p
  }
}

// MARK: - the model

final class BigIslandModel: ObservableObject {
  enum Kind { case welcome, workout }
  /// welcome: panel, then face (the Face ID moment). workout: announce ("Workout complete"), then panel (the summary).
  enum Phase { case hidden, announce, panel, face }
  @Published var kind: Kind = .welcome
  @Published var phase: Phase = .hidden
  /// The shape has grown from the island's size to its own size.
  @Published var open = false
  /// The words are in.
  @Published var inside = false
  @Published var islandSize = CGSize(width: 200, height: 34)
  // Welcome back
  @Published var tasks: [WelcomeTask] = []
  @Published var ticks = Set<String>()
  @Published var over: String?
  @Published var tickDraw: CGFloat = 0
  // Workout summary
  @Published var summary: WorkoutSummaryIn?
  /// 0 nothing yet, 1 the congratulation, 2 the totals, 3 + i: exercise i is in.
  @Published var parts = 0
  var done: () -> Void = {}
  var close: () -> Void = {}
  var toggle: (String) -> Void = { _ in }

  /// The shape's size now (the island's own while it is not open).
  var shape: CGSize {
    let h = islandSize.height
    if !open { return islandSize }
    switch (kind, phase) {
    case (.welcome, .face): return CGSize(width: WelcomeBackCore.faceSize, height: h + WelcomeBackCore.faceSize - 8)
    case (.welcome, _): return CGSize(width: WelcomeBackCore.panelW, height: h + WelcomeBackCore.panelH(rows: tasks.count))
    case (.workout, .announce): return CGSize(width: WorkoutSummaryCore.announceSize.width, height: h + WorkoutSummaryCore.announceSize.height)
    case (.workout, _): return CGSize(width: WorkoutSummaryCore.panelW, height: h + (summary.map { WorkoutSummaryCore.panelH($0) } ?? 120))
    }
  }
  var radius: CGFloat { open ? (phase == .face ? WelcomeBackCore.faceRadius : 30) : 18 }
  var reduce: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
}

// MARK: - the views

struct BigIslandView: View {
  @ObservedObject var m: BigIslandModel
  static let pad: CGFloat = 20       // room round the shape for its shadow
  private let green = Color(red: 0.2, green: 0.83, blue: 0.6)
  static func window(for m: BigIslandModel) -> CGSize {
    // Big enough for every phase of this kind, so the window never has to change while the shape moves.
    switch m.kind {
    case .welcome: return CGSize(width: max(WelcomeBackCore.panelW, WelcomeBackCore.faceSize) + 2 * pad, height: m.islandSize.height + max(WelcomeBackCore.panelH(rows: m.tasks.count), WelcomeBackCore.faceSize) + 2 * pad)
    case .workout: return CGSize(width: WorkoutSummaryCore.panelW + 2 * pad, height: m.islandSize.height + (m.summary.map { WorkoutSummaryCore.panelH($0) } ?? 120) + 2 * pad)
    }
  }

  var body: some View {
    ZStack(alignment: .top) {
      Color.clear
      HangShape(bottom: m.radius).fill(Color.black)
        .frame(width: m.shape.width, height: m.shape.height)
        .shadow(color: Color.black.opacity(m.open ? 0.4 : 0), radius: 14, y: 6)
        .overlay(alignment: .top) { content.frame(width: m.shape.width, height: m.shape.height, alignment: .top).clipShape(HangShape(bottom: m.radius)) }
        .padding(.top, 0)
    }
    .frame(width: BigIslandView.window(for: m).width, height: BigIslandView.window(for: m).height, alignment: .top)
    .environment(\.colorScheme, .dark)
  }

  @ViewBuilder private var content: some View {
    if m.open {
      switch (m.kind, m.phase) {
      case (.welcome, .face): face
      case (.welcome, _): welcome
      case (.workout, .announce): announce
      case (.workout, _): summary
      }
    }
  }

  // ---- Welcome back
  private var welcome: some View {
    VStack(spacing: 0) {
      Color.clear.frame(height: m.islandSize.height)
      VStack(spacing: 3) {
        Text(WelcomeBackCore.title).font(.system(size: 21, weight: .bold, design: .rounded)).foregroundColor(.white)
        Text(WelcomeBackCore.sub).font(.system(size: 13, weight: .medium, design: .rounded)).foregroundColor(Color.white.opacity(0.6))
      }
      .frame(height: WelcomeBackCore.headH, alignment: .center)
      VStack(spacing: WelcomeBackCore.rowGap) {
        ForEach(m.tasks, id: \.id) { t in taskRow(t) }
      }
      .padding(.horizontal, WelcomeBackCore.pad)
      Spacer(minLength: 0)
      Button(action: m.done) {
        Text(WelcomeBackCore.done).font(.system(size: 15, weight: .bold, design: .rounded)).foregroundColor(.black)
          .frame(width: 150, height: WelcomeBackCore.doneH)
          .background(Capsule().fill(green.opacity(m.over == "done" ? 0.88 : 1)))
          .contentShape(Capsule())
      }
      .buttonStyle(.plain)
      .onHover { h in withAnimation(.easeOut(duration: 0.12)) { m.over = h ? "done" : (m.over == "done" ? nil : m.over) } }
      .padding(.bottom, WelcomeBackCore.pad)
    }
    .opacity(m.inside ? 1 : 0)
    .offset(y: m.inside ? 0 : -6)
    .accessibilityElement(children: .contain)
  }
  private func taskRow(_ t: WelcomeTask) -> some View {
    let on = m.ticks.contains(t.id), over = m.over == t.id
    return Button(action: { m.toggle(t.id) }) {
      HStack(spacing: 10) {
        ZStack {
          Circle().stroke(on ? green : Color.white.opacity(0.35), lineWidth: 1.6).frame(width: 22, height: 22)
          if on { Circle().fill(green).frame(width: 22, height: 22); Image(systemName: "checkmark").font(.system(size: 11, weight: .heavy)).foregroundColor(.black) }
        }
        Text(t.title).font(.system(size: 14, weight: .medium, design: .rounded)).foregroundColor(on ? Color.white.opacity(0.5) : .white)
          .strikethrough(on, color: Color.white.opacity(0.5)).lineLimit(1).truncationMode(.tail)
        Spacer(minLength: 0)
      }
      .padding(.horizontal, 12).frame(height: WelcomeBackCore.rowH)
      .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(over ? 0.14 : 0.08)))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .onHover { h in withAnimation(.easeOut(duration: 0.12)) { if h { m.over = t.id } else if m.over == t.id { m.over = nil } } }
    .accessibilityLabel(Text("\(t.title), \(on ? "done" : "not done")"))
  }
  // ---- the Face ID style moment
  private var face: some View {
    VStack(spacing: 0) {
      Color.clear.frame(height: m.islandSize.height - 8)
      SetupTickMark(size: 64, draw: m.tickDraw)
        .frame(width: WelcomeBackCore.faceSize, height: WelcomeBackCore.faceSize - 8)
    }
    .accessibilityElement(children: .ignore).accessibilityLabel(Text("Done"))
  }

  // ---- Workout summary
  private var announce: some View {
    VStack(spacing: 4) {
      Color.clear.frame(height: m.islandSize.height)
      HStack(spacing: 8) {
        SetupTickMark(size: 22, draw: m.tickDraw)
        Text(WorkoutSummaryCore.headline).font(.system(size: 19, weight: .bold, design: .rounded)).foregroundColor(.white)
      }
      Text(WorkoutSummaryCore.congrats).font(.system(size: 14, weight: .medium, design: .rounded)).foregroundColor(Color.white.opacity(0.65))
        .opacity(m.parts >= 1 ? 1 : 0).offset(y: m.parts >= 1 ? 0 : 6)
    }
    .opacity(m.inside ? 1 : 0)
  }
  @ViewBuilder private var summary: some View {
    if let s = m.summary {
      VStack(spacing: 0) {
        Color.clear.frame(height: m.islandSize.height)
        HStack(spacing: 8) {
          SetupTickMark(size: 20, draw: 1)
          Text(WorkoutSummaryCore.headline).font(.system(size: 17, weight: .bold, design: .rounded)).foregroundColor(.white)
          Spacer(minLength: 0)
          Button(action: m.close) {
            Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).foregroundColor(Color.white.opacity(0.6))
              .frame(width: 26, height: 26).background(Circle().fill(Color.white.opacity(m.over == "x" ? 0.2 : 0.1)))
          }
          .buttonStyle(.plain).accessibilityLabel(Text("Close"))
          .onHover { h in withAnimation(.easeOut(duration: 0.12)) { m.over = h ? "x" : (m.over == "x" ? nil : m.over) } }
        }
        .padding(.horizontal, WorkoutSummaryCore.pad).padding(.top, 6).frame(height: WorkoutSummaryCore.headH - 28, alignment: .top)
        Text(WorkoutSummaryCore.summaryLine(s)).font(.system(size: 13, weight: .semibold, design: .rounded)).foregroundColor(green)
          .frame(height: WorkoutSummaryCore.summaryH).opacity(m.parts >= 2 ? 1 : 0).offset(y: m.parts >= 2 ? 0 : 6)
        VStack(spacing: 6) {
          ForEach(Array(s.rows.enumerated()), id: \.offset) { i, r in workoutRow(r).opacity(m.parts >= 3 + i ? 1 : 0).offset(y: m.parts >= 3 + i ? 0 : 8) }
          if s.more > 0 { Text("and \(s.more) more").font(.system(size: 12, weight: .medium)).foregroundColor(Color.white.opacity(0.5)).frame(height: 16).opacity(m.parts >= 3 + s.rows.count ? 1 : 0) }
        }
        .padding(.horizontal, WorkoutSummaryCore.pad)
        Spacer(minLength: 0)
      }
      .accessibilityElement(children: .contain)
    }
  }
  private func workoutRow(_ r: WorkoutRow) -> some View {
    let trendColor: Color = r.trend == .up ? green : r.trend == .down ? Color(red: 1, green: 0.62, blue: 0.3) : Color.white.opacity(0.55)
    let icon = r.trend == .up ? "arrow.up" : r.trend == .down ? "arrow.down" : r.trend == .same ? "equal" : "sparkles"
    return VStack(alignment: .leading, spacing: 2) {
      HStack(spacing: 6) {
        Text(r.name).font(.system(size: 14, weight: .semibold, design: .rounded)).foregroundColor(.white).lineLimit(1)
        Spacer(minLength: 4)
        Text(WorkoutSummaryCore.bestLine(r)).font(.system(size: 13, weight: .bold, design: .rounded)).monospacedDigit().foregroundColor(.white)
      }
      HStack(spacing: 5) {
        Image(systemName: icon).font(.system(size: 10, weight: .bold)).foregroundColor(trendColor)
        Text(WorkoutSummaryCore.trendWords(r)).font(.system(size: 12, weight: .medium)).foregroundColor(trendColor).lineLimit(1)
        Spacer(minLength: 0)
        Text("\(r.sets) set\(r.sets == 1 ? "" : "s")").font(.system(size: 12, weight: .medium)).foregroundColor(Color.white.opacity(0.5))
      }
      if let f = WorkoutSummaryCore.feltWords(r) {
        Text(f).font(.system(size: 12)).foregroundColor(Color.white.opacity(0.62)).lineLimit(1).truncationMode(.tail)
      }
    }
    .padding(.horizontal, 12).padding(.vertical, 6).frame(height: WorkoutSummaryCore.rowHeight(r), alignment: .center)
    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(0.07)))
  }
}

// MARK: - the window

final class BigIslandWindow {
  static let shared = BigIslandWindow()
  let m = BigIslandModel()
  private var win: IslandPanel?
  private var monitors: [Any] = []
  private var work: [DispatchWorkItem] = []
  private var closing = false
  var isOpen: Bool { win?.isVisible == true && m.phase != .hidden }
  /// Called once when it has gone (queue: finish).
  var onGone: (() -> Void)?
  /// Esc, the close button, or a click on Done come here.
  var onEscape: (() -> Void)?

  private func after(_ s: Double, _ f: @escaping () -> Void) {
    let w = DispatchWorkItem(block: f); work.append(w)
    DispatchQueue.main.asyncAfter(deadline: .now() + s, execute: w)
  }
  private func cancelAll() { work.forEach { $0.cancel() }; work = [] }
  private var spring: Animation { m.reduce ? .easeInOut(duration: 0.2) : .spring(response: 0.55, dampingFraction: 0.68) }

  private func ensure() -> IslandPanel {
    if let w = win { return w }
    let p = IslandPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    p.isOpaque = false; p.backgroundColor = .clear; p.hasShadow = false
    p.level = NSWindow.Level(rawValue: NSWindow.Level.mainMenu.rawValue + 3)   // just above the real island
    p.hidesOnDeactivate = false; p.isReleasedWhenClosed = false
    p.collectionBehavior = IslandPlace.spaces
    p.setAccessibilityLabel("Island panel")
    p.contentView = IslandHost(rootView: BigIslandView(m: m))
    win = p
    return p
  }
  /// The window sits with its top on the island's top, centred on it.
  private func place(_ island: NSRect) {
    let p = ensure(), size = BigIslandView.window(for: m)
    let screen = (Island.shared.timerAnchor()?.screen) ?? NSScreen.main?.frame ?? island
    var x = island.midX - size.width / 2
    x = max(screen.minX, min(x, screen.maxX - size.width))
    p.setFrame(NSRect(x: x, y: island.maxY - size.height + 0, width: size.width, height: size.height).integral, display: true)
  }

  /// The island's own squeeze, then the shape grows out of the island's size, then the words come in. Returns false when
  /// the island is not on screen (the caller then does nothing, and the queue lets go).
  func open(kind: BigIslandModel.Kind, phase: BigIslandModel.Phase, moment: IslandMoment, setUp: () -> Void, wordsIn: @escaping () -> Void) -> Bool {
    guard let island = Island.shared.shapeOnScreen() else { return false }
    cancelAll(); closing = false
    m.kind = kind; m.phase = .hidden; m.open = false; m.inside = false; m.parts = 0; m.tickDraw = 0; m.over = nil
    m.islandSize = island.size
    setUp()
    m.phase = phase
    place(island)
    Island.shared.moment(moment)
    let delay = m.reduce ? 0 : WelcomeBackCore.growDelay
    after(delay) { [weak self] in
      guard let self, let p = self.win else { return }
      p.alphaValue = 1
      p.orderFrontRegardless()
      withAnimation(self.spring) { self.m.open = true }
    }
    after(delay + (m.reduce ? 0.1 : WelcomeBackCore.contentDelay - WelcomeBackCore.growDelay)) { [weak self] in
      withAnimation(.easeOut(duration: 0.28)) { self?.m.inside = true }
      wordsIn()
    }
    startEsc()
    return true
  }

  /// A new phase: the shape morphs to the new size on a spring (Done to the Face ID square, the announcement to the summary).
  func morph(to phase: BigIslandModel.Phase, then: (() -> Void)? = nil) {
    withAnimation(spring) { m.phase = phase }
    if let then { then() }
  }
  /// The window follows the island if it moved or changed size (it stays joined to it).
  func follow() {
    guard isOpen, !closing, let island = Island.shared.shapeOnScreen() else { return }
    place(island)
  }

  /// Back up into the island: the words go, the shape shrinks to the island's size, the window goes.
  func close() {
    guard !closing else { return }
    // Never on screen (so nothing to shrink): it is over, and the queue must still hear it, or its card would stay active for good.
    guard win?.isVisible == true else { drop(); return }
    closing = true
    cancelAll(); stopEsc()
    withAnimation(.easeOut(duration: 0.14)) { m.inside = false }
    after(m.reduce ? 0.12 : 0.1) { [weak self] in guard let self else { return }; withAnimation(self.spring) { self.m.open = false } }
    after(m.reduce ? 0.35 : 0.75) { [weak self] in
      guard let self else { return }
      self.win?.orderOut(nil)
      self.m.phase = .hidden; self.closing = false
      let g = self.onGone; self.onGone = nil
      Island.shared.swell(false)
      g?()
    }
  }
  /// 1Password or Signal came to the front and the island is not allowed over them (the owner's build): the panel goes with it.
  func protectedChanged() {
    if isOpen, Protected.front, !BuildRules.now.islandOverProtected { drop() }
  }
  /// Quietly gone at once (the island went, the app is closing).
  func drop() {
    cancelAll(); stopEsc()
    win?.orderOut(nil); m.open = false; m.phase = .hidden; closing = false
    let g = onGone; onGone = nil; g?()
  }
  func schedule(_ s: Double, _ f: @escaping () -> Void) { after(s, f) }

  private func startEsc() {
    guard monitors.isEmpty else { return }
    if let l = NSEvent.addLocalMonitorForEvents(matching: [.keyDown], handler: { [weak self] e in
      if e.keyCode == 53, self?.isOpen == true { self?.onEscape?() }
      return e   // never swallowed: the same Esc still backs out of the Tab list (EscAlways.swift)
    }) { monitors.append(l) }
    if let g = NSEvent.addGlobalMonitorForEvents(matching: [.keyDown], handler: { [weak self] e in
      if e.keyCode == 53 { DispatchQueue.main.async { if self?.isOpen == true { self?.onEscape?() } } }
    }) { monitors.append(g) }
  }
  private func stopEsc() { monitors.forEach { NSEvent.removeMonitor($0) }; monitors = [] }
}

// MARK: - what the Mac says about itself

enum MacState {
  static func locked() -> Bool {
    let d = CGSessionCopyCurrentDictionary() as? [String: Any]
    return (d?["CGSSessionScreenIsLocked"] as? Bool) == true || (d?["CGSSessionScreenIsLocked"] as? Int) == 1
  }
  /// Seconds since the last key, click or mouse move.
  static func idle() -> Double {
    CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: CGEventType(rawValue: ~0)!)
  }
  /// Screen sharing, best effort (ScreenShareCore). Looks in this process (no helper program, nothing that can wait on the main
  /// thread) for the few sharing helpers by name, and reads on screen window titles. 1Password and Signal are never read: a
  /// process name is compared and dropped at once, and their windows are skipped before any title is looked at.
  static func screenSharing() -> Bool {
    var names: [String] = []
    // The system keeps a process name to 16 letters, so the helper names are compared the same way.
    let wanted = Set(ScreenShareCore.processes.map { String($0.prefix(16)) })
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_ALL, 0]
    var len = 0
    if sysctl(&mib, 4, nil, &len, nil, 0) == 0, len > 0 {
      var raw = [UInt8](repeating: 0, count: len + 4096)
      len = raw.count
      if sysctl(&mib, 4, &raw, &len, nil, 0) == 0 {
        raw.withUnsafeBytes { bytes in
          let procs = bytes.bindMemory(to: kinfo_proc.self)
          for i in 0..<(len / MemoryLayout<kinfo_proc>.stride) {
            var c = procs[i].kp_proc.p_comm
            let n = withUnsafePointer(to: &c) { $0.withMemoryRebound(to: CChar.self, capacity: 17) { String(cString: $0) } }
            if wanted.contains(n) { names.append(n) }   // only a sharing helper is kept, every other name is dropped at once
          }
        }
      }
    }
    let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    var titles: [String] = []
    for w in list {
      if let pid = w[kCGWindowOwnerPID as String] as? Int32, Protected.matches(NSRunningApplication(processIdentifier: pid)) { continue }
      if let t = w[kCGWindowName as String] as? String { titles.append(t) }
    }
    let full = ScreenShareCore.processes.filter { names.contains(String($0.prefix(16))) }
    return ScreenShareCore.isSharing(processes: Array(full), windowTitles: titles)
  }
  static func block(locked: Bool? = nil) -> WelcomeBlock {
    WelcomeBlock(screenLocked: locked ?? MacState.locked(), screenSharing: MacState.screenSharing(), fullScreen: Island.shared.fullScreenNow, dnd: DND.shared.active)
  }
}

// MARK: - the controller

/// Listens for the Mac coming back and for a finished workout, asks the shared island queue for its turn, and plays both panels.
final class WelcomeBack {
  static let shared = WelcomeBack()
  private let test = ProcessInfo.processInfo.environment["PS_SELFTEST"] != nil
  private var tracker = AwayTracker()
  private var input = WelcomeInput(on: false, minutes: 15, tasks: [])
  private var islandOn = true
  private var sounds = true
  private var pendingWorkout: WorkoutSummaryIn?
  private var lastShown: Date?
  private var started = false
  private var sampler: Timer?
  private var workoutTimer: Timer?
  private var wasSleepMode = false, wasSentry = false
  private var activeWelcome = false
  private static let shownKey = "workout.summary.shown"
  private var shownHere: [String] {
    get { UserDefaults.standard.stringArray(forKey: WelcomeBack.shownKey) ?? [] }
    set { UserDefaults.standard.set(newValue, forKey: WelcomeBack.shownKey) }
  }
  private var reduce: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

  /// Every state from the page: the Welcome back input, the workout waiting, the island's sound switch and mode.
  func fromPage(_ d: [String: Any]) {
    guard !test else { return }
    input = WelcomeBackCore.parse(d["welcome"])
    islandOn = (d["mode"] as? String) != "off"
    sounds = (d["sounds"] as? Bool) != false
    pendingWorkout = WorkoutSummaryCore.parse(d["workout"])
    start()
    if pendingWorkout != nil { evaluateWorkout(); armWorkoutTimer() } else { workoutTimer?.invalidate(); workoutTimer = nil }
  }

  private func start() {
    guard !started else { return }
    started = true
    sample()
    sampler = Timer.scheduledTimer(withTimeInterval: AwayTracker.interval, repeats: true) { [weak self] _ in self?.sample() }
    NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in self?.trigger(.wake) }
    DistributedNotificationCenter.default().addObserver(forName: Notification.Name("com.apple.screenIsUnlocked"), object: nil, queue: .main) { [weak self] _ in self?.trigger(.unlock) }
  }
  /// One look at the person's last input, and whether Sleep mode or Sentry mode just ended (both are PS's own modes).
  private func sample() {
    let now = Date().timeIntervalSince1970
    tracker.sample(now: now, idle: MacState.idle(), locked: MacState.locked())
    let sleeping = SleepScreen.shared.isUp, sentry = Sentry.shared.engaged
    if wasSleepMode && !sleeping { trigger(.sleepModeEnded) }
    if wasSentry && !sentry { trigger(.sentryEnded) }
    wasSleepMode = sleeping; wasSentry = sentry
  }

  // ---------- Welcome back ----------
  private func trigger(_ t: WelcomeTrigger) {
    guard !test else { return }
    let now = Date().timeIntervalSince1970
    let locked = MacState.locked()
    let blocks = MacState.block(locked: locked)
    let d = WelcomeBackCore.decide(trigger: t, away: tracker.away(now: now), input: input, featureOn: Features.on("welcome-back"), islandOn: islandOn && Island.shared.onScreen,
                                   block: blocks, sinceLastShown: lastShown.map { Date().timeIntervalSince($0) })
    psLog("PS welcome back: \(t.rawValue), away \(Int(tracker.away(now: now))) s, \(d)")
    switch d {
    case .wait: return
    case .skip: tracker.returned(now: now)
    case .show:
      tracker.returned(now: now); lastShown = Date()
      let tasks = input.tasks
      DispatchQueue.main.asyncAfter(deadline: .now() + (t == .unlock ? 0.6 : WelcomeBackCore.wakeDelay)) { [weak self] in self?.askWelcome(tasks) }
    }
    if t == .unlock || t == .wake { evaluateWorkout() }
  }
  private func askWelcome(_ tasks: [WelcomeTask]) {
    guard !activeWelcome else { return }
    let id = "welcome"
    let b = MacState.block()
    guard !b.any, !b.screenLocked else { psLog("PS welcome back: not shown, \(b)"); return }
    let o = IslandQueue.shared.enqueue(id: id, kind: "welcome", priority: .normal, ttl: 45, show: { [weak self] in self?.showWelcome(tasks) },
                                       visible: { [weak self] in self?.activeWelcome == true || BigIslandWindow.shared.isOpen })
    if o == .showNow { showWelcome(tasks) }
  }
  private func showWelcome(_ tasks: [WelcomeTask]) {
    let w = BigIslandWindow.shared
    let b = MacState.block()
    if b.any || b.screenLocked { IslandQueue.shared.finish("welcome"); return }   // it was not its turn in time
    activeWelcome = true
    w.m.tasks = tasks
    let ok = w.open(kind: .welcome, phase: .panel, moment: .welcomeBack, setUp: { w.m.ticks = [] }, wordsIn: {})
    guard ok else { activeWelcome = false; IslandQueue.shared.finish("welcome"); return }
    psLog("PS welcome back: shown, \(tasks.count) tasks")
    w.m.toggle = { id in withAnimation(.easeOut(duration: 0.12)) { w.m.ticks = WelcomeBackCore.toggle(w.m.ticks, id: id, tasks: tasks) } }
    w.m.done = { [weak self] in self?.welcomeDone(tasks) }
    w.m.close = { [weak self] in self?.welcomeEnd() }
    w.onEscape = { [weak self] in self?.welcomeEnd() }
    w.onGone = { [weak self] in self?.activeWelcome = false; IslandQueue.shared.finish("welcome") }
    w.schedule(WelcomeBackCore.autoClose) { [weak self] in if self?.activeWelcome == true { self?.welcomeEnd() } }
  }
  /// Done: the ticks go to the page, then the Face ID style moment (a rounded square, a big tick, a chime), then back to normal.
  private func welcomeDone(_ tasks: [WelcomeTask]) {
    let w = BigIslandWindow.shared
    guard activeWelcome, w.m.phase == .panel else { return }
    w.m.done = {}; w.m.toggle = { _ in }   // a second click in the same moment must not tick everything a second time (a tick toggles)
    let ids = WelcomeBackCore.ticked(tasks, marks: w.m.ticks)
    if !ids.isEmpty { Island.shared.onAction?("welcomeDone", WelcomeBackCore.doneJSON(ids)) }
    psLog("PS welcome back: done, \(ids.count) ticked")
    withAnimation(.easeOut(duration: 0.12)) { w.m.inside = false }
    w.schedule(0.12) {
      w.morph(to: .face)
      Island.shared.moment(.faceID)
      w.m.inside = true
      withAnimation(.easeOut(duration: self.reduce ? 0.15 : 0.4)) { w.m.tickDraw = 1 }
      if IslandMotionCore.chimes(.faceID, soundOn: self.sounds, dndMutesSounds: DND.shared.mutes("sounds")) { BigIslandSound.play(.chime) }
    }
    w.schedule(0.12 + WelcomeBackCore.faceHold) { w.close() }
  }
  /// Esc, a timeout: closes everything, nothing is ticked.
  private func welcomeEnd() { BigIslandWindow.shared.close() }

  // ---------- Workout summary ----------
  private func armWorkoutTimer() {
    guard workoutTimer == nil else { return }
    workoutTimer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in self?.evaluateWorkout() }
  }
  private var workoutActive = false
  func evaluateWorkout() {
    guard !test, let s = pendingWorkout, !workoutActive, !IslandQueue.shared.isActive("workout:" + s.id), !IslandQueue.shared.isWaiting("workout:" + s.id) else { return }
    let d = WorkoutSummaryCore.decide(s, shownHere: Set(shownHere), featureOn: Features.on("workout-summary"), islandOn: islandOn && Island.shared.onScreen,
                                      idle: MacState.idle(), block: MacState.block())
    guard d == .show else { return }
    let id = "workout:" + s.id
    let o = IslandQueue.shared.enqueue(id: id, kind: "workout", priority: .low, ttl: 120, show: { [weak self] in self?.showWorkout(s) },
                                       visible: { [weak self] in self?.workoutActive == true || BigIslandWindow.shared.isOpen })
    if o == .showNow { showWorkout(s) }
  }
  private func showWorkout(_ s: WorkoutSummaryIn) {
    let id = "workout:" + s.id, w = BigIslandWindow.shared
    // Its turn came: ask again, so a Mac that locked, shared its screen or went quiet meanwhile does not show it.
    let d = WorkoutSummaryCore.decide(s, shownHere: Set(shownHere), featureOn: Features.on("workout-summary"), islandOn: islandOn && Island.shared.onScreen, idle: MacState.idle(), block: MacState.block())
    guard d == .show else { IslandQueue.shared.finish(id); return }
    workoutActive = true
    let t = WorkoutSummaryCore.timeline(reduceMotion: reduce)
    let ok = w.open(kind: .workout, phase: .announce, moment: .workoutDone, setUp: { w.m.summary = s }, wordsIn: {})
    guard ok else { workoutActive = false; IslandQueue.shared.finish(id); return }
    // Shown on this Mac: marked at once, here and (through the page) on the workout, so no other Mac shows it again.
    shownHere = WorkoutSummaryCore.remember(s.id, in: shownHere)
    Island.shared.onAction?("workoutShown", s.id)
    psLog("PS workout summary: shown, \(s.rows.count) exercises")
    w.onEscape = { w.close() }
    w.m.close = { w.close() }
    w.onGone = { [weak self] in self?.workoutActive = false; IslandQueue.shared.finish(id) }
    // The parts, each with its own soft sound.
    let dnd = DND.shared.mutes("sounds")
    for snd in WorkoutSummaryCore.sounds(rows: s.rows.count, soundOn: sounds, dnd: dnd, t) {
      w.schedule(snd.at + 0.3) { BigIslandSound.play(snd.kind) }
    }
    w.schedule(0.3) { withAnimation(.easeOut(duration: 0.4)) { w.m.tickDraw = 1 } }
    w.schedule(t.congratsAt + 0.3) { withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) { w.m.parts = 1 } }
    w.schedule(t.growAt + 0.3) { w.morph(to: .panel) }
    w.schedule(t.totalsAt + 0.3) { withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) { w.m.parts = 2 } }
    for i in 0..<s.rows.count { w.schedule(WorkoutSummaryCore.rowAt(i, t) + 0.3) { withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) { w.m.parts = 3 + i } } }
    w.schedule(t.autoClose) { w.close() }
  }
}
