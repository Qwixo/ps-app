import AppKit
import SwiftUI

// The island's timers on screen (V1.58): Pomodoro breaks, Stand-up reminders and the next meeting bubble. The rules are
// IslandTimersCore.swift; this draws them and moves between them with a bounce, plays the chimes, and says it with a
// pop-up card instead when the island is not on screen (switched off, hidden by its grab line, over 1Password or Signal).
// Island.swift only calls in here (IslandState.timers, Island.update, IslandModel.tshow, the content and the bubble), so
// its own code stays as it was.
//
// Reusable (setup-island-158 and anything later): IslandTick (the green tick that springs in), IslandChime (its chime and
// the softer start sound), IslandCountdown (a time that counts down by itself to a wall clock end).

// ---------- reusable pieces ----------
enum IslandChime {
  /// "done" with the green tick, "start" as a takeover begins. Made in Sfx.swift from tones (never a recorded file), the
  /// same numbers as web src/core/islandtimers.ts ISLAND_TONES. Never under Do Not Disturb's sounds switch.
  static func play(_ kind: String, volume: Double = 0.55) {
    guard kind == "done" || kind == "start", !DND.shared.mutes("sounds") else { return }
    Sfx.shared.play("island-\(kind)", volume: volume)
  }
}

/// The green tick: the disc springs in, then the check draws itself. Driven by the time since `born` (no view state).
struct IslandTick: View {
  var size: CGFloat = 18
  var born: Date = IslandTimers.shared.changedAt
  var body: some View {
    let calm = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    TimelineView(.animation(minimumInterval: 1 / 60, paused: calm || Date().timeIntervalSince(born) > 1.2)) { ctx in
      let t = calm ? 2 : ctx.date.timeIntervalSince(born)
      let disc = IslandTick.spring(t), draw = min(1, max(0, (t - 0.12) / 0.3))
      ZStack {
        Circle().fill(Color(red: 0.2, green: 0.78, blue: 0.35)).scaleEffect(0.2 + 0.8 * disc).opacity(min(1, t / 0.12))
        CheckShape().trim(from: 0, to: draw)
          .stroke(Color.black, style: StrokeStyle(lineWidth: max(1.6, size * 0.13), lineCap: .round, lineJoin: .round))
          .frame(width: size * 0.5, height: size * 0.5)
      }
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }
  /// 0 to 1 with a small overshoot, settled by about 0.6 s.
  static func spring(_ t: Double) -> Double { t <= 0 ? 0 : 1 - exp(-7 * t) * cos(10 * t) }
}
struct CheckShape: Shape {
  func path(in r: CGRect) -> Path {
    var p = Path()
    p.move(to: CGPoint(x: r.minX, y: r.midY + r.height * 0.05))
    p.addLine(to: CGPoint(x: r.minX + r.width * 0.36, y: r.maxY - r.height * 0.08))
    p.addLine(to: CGPoint(x: r.maxX, y: r.minY + r.height * 0.1))
    return p
  }
}

/// A time counting down to a wall clock end, by itself (the digits roll on macOS 14 and later).
struct IslandCountdown: View {
  var endsAt: Double            // ms since 1970
  var left: Double? = nil       // paused: ms left, frozen
  var short = false             // "12m" rather than "11:42"
  var size: CGFloat = 13
  var color: Color = .white
  var body: some View {
    TimelineView(.periodic(from: .now, by: 1)) { ctx in
      let ms = left ?? (endsAt - ctx.date.timeIntervalSince1970 * 1000)
      roll(Text(short ? TimersCore.shortLeft(ms) : TimersCore.clock(ms)))
        .font(.system(size: size, weight: .bold)).monospacedDigit().foregroundColor(color).lineLimit(1).fixedSize()
    }
  }
  @ViewBuilder func roll(_ t: Text) -> some View {
    if #available(macOS 14.0, *) { t.contentTransition(.numericText(countsDown: true)) } else { t }
  }
}

/// The little man (original, drawn here): he rises from sitting to standing, then stretches his arms up and down, and
/// sways a little, for as long as he shows.
struct StandMan: View {
  var size: CGFloat = 30
  var color: Color = .white
  var born: Date = IslandTimers.shared.changedAt
  var body: some View {
    TimelineView(.animation(minimumInterval: 1 / 24, paused: NSWorkspace.shared.accessibilityDisplayShouldReduceMotion)) { ctx in
      let t = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 10 : ctx.date.timeIntervalSince(born)
      Canvas { g, sz in StandMan.draw(g, sz, t, color) }
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }
  /// up: 0 sitting, 1 standing (eased over the first 0.9 s, with a small overshoot); then the stretch loops every 2.4 s.
  static func draw(_ g: GraphicsContext, _ sz: CGSize, _ t: Double, _ c: Color) {
    let k = min(1, t / 0.9)
    let up = 1 - pow(1 - k, 3) + sin(k * .pi) * 0.08
    let loop = t > 0.9 ? (1 - cos((t - 0.9) / 2.4 * 2 * .pi)) / 2 : 0      // 0 arms down, 1 arms up
    let sway = t > 0.9 ? sin((t - 0.9) * 1.6) * 0.03 : 0
    let w = sz.width, h = sz.height, u = h / 30
    let hipY = h - (9 + 7 * up) * u, footY = h - 1.5 * u, cx = w / 2 + sway * w
    let shoulderY = hipY - 9 * u
    let head = CGPoint(x: cx, y: shoulderY - 4.2 * u)
    let lw = 2.2 * u
    var p = Path()
    // legs: bent at the knee while sitting, straight standing
    let knee = CGPoint(x: cx + (1 - up) * 6 * u, y: hipY + (footY - hipY) * (0.5 - (1 - up) * 0.15))
    for side in [-1.0, 1.0] {
      p.move(to: CGPoint(x: cx + side * 1.4 * u, y: hipY))
      p.addLine(to: CGPoint(x: knee.x + side * 1.4 * u, y: knee.y))
      p.addLine(to: CGPoint(x: cx + side * 2.2 * u + (1 - up) * 6 * u, y: footY))
    }
    // body
    p.move(to: CGPoint(x: cx, y: hipY)); p.addLine(to: CGPoint(x: cx, y: shoulderY))
    // arms: down by his sides, rising to a stretch over his head
    let a = loop * up
    for side in [-1.0, 1.0] {
      let ang = (0.15 + a * 2.75) * side      // radians from straight down
      let hand = CGPoint(x: cx + sin(ang) * 7.5 * u, y: shoulderY + cos(ang) * 7.5 * u)
      p.move(to: CGPoint(x: cx, y: shoulderY + 0.6 * u)); p.addLine(to: hand)
    }
    g.stroke(p, with: .color(c), style: StrokeStyle(lineWidth: lw, lineCap: .round, lineJoin: .round))
    g.fill(Path(ellipseIn: CGRect(x: head.x - 3 * u, y: head.y - 3 * u, width: 6 * u, height: 6 * u)), with: .color(c))
  }
}

// ---------- what the island shows in the middle ----------
/// The middle of the island while a timer has it: a break counting down, Break ready with Start, the green tick, or
/// Stand up with the little man; also the meeting opened from its bubble.
struct TimerMiddle: View {
  @ObservedObject var m: IslandModel
  var fg: Color
  var dim: Color
  var accent: Color
  var start: () -> Void
  var open: (String?) -> Void
  private let green = Color(red: 0.2, green: 0.83, blue: 0.6), blue = Color(red: 0.38, green: 0.65, blue: 0.98)

  var body: some View {
    VStack(spacing: 0) {
      if !m.pill { Color.clear.frame(height: m.geo.notchH) }
      Group {
        if let mt = m.meetOpen { meetBig(mt) }
        else {
          switch m.tshow.middle {
          case .back(_, let words): row { IslandTick(size: m.bigTimer ? 22 : 18); Text(words).font(.system(size: 13, weight: .bold)).foregroundColor(fg).lineLimit(1).fixedSize() }
          case .brk(let phase, let endsAt, let left, let ready): breakRow(phase, endsAt, left, ready)
          case .stand(_, let endsAt): standBig(endsAt)
          case .task: Color.clear
          }
        }
      }
      .id(key)
      .transition(TimerMiddle.pop)
    }
  }
  private var key: String { m.meetOpen != nil ? "meet" : m.tshow.middle.kind }
  static var pop: AnyTransition {
    NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? .opacity
      : .asymmetric(insertion: .scale(scale: 0.55).combined(with: .opacity).combined(with: .offset(y: 5)),
                    removal: .scale(scale: 0.8).combined(with: .opacity))
  }
  private func row<C: View>(@ViewBuilder _ c: () -> C) -> some View {
    HStack(spacing: 8) { c() }.frame(maxWidth: .infinity).frame(height: m.pill ? m.pillH : 30)
  }
  private func breakRow(_ phase: String, _ endsAt: Double, _ left: Double?, _ ready: Bool) -> some View {
    let c = phase == "long" ? blue : green
    return row {
      Image(systemName: left != nil && !ready ? "pause.fill" : "cup.and.saucer.fill").font(.system(size: 11, weight: .bold)).foregroundColor(c)
      if ready {
        Text(phase == "long" ? TimersCore.wLongReady : TimersCore.wReady).font(.system(size: 12.5, weight: .semibold)).foregroundColor(fg).lineLimit(1).fixedSize()
        Button(action: start) {
          Text(TimersCore.wStart).font(.system(size: 11.5, weight: .bold)).padding(.horizontal, 10).padding(.vertical, 3)
            .background(c).foregroundColor(.black).clipShape(Capsule())
        }.buttonStyle(.plain)
      } else {
        Text(phase == "long" ? TimersCore.wLong : TimersCore.wShort).font(.system(size: 12.5, weight: .semibold)).foregroundColor(dim).lineLimit(1).fixedSize()
        IslandCountdown(endsAt: endsAt, left: left, size: 14.5, color: c)
      }
    }
  }
  private func standBig(_ endsAt: Double) -> some View {
    HStack(spacing: 14) {
      StandMan(size: 40, color: green)
      VStack(alignment: .leading, spacing: 2) {
        Text(TimersCore.wStandUp).font(.system(size: 16, weight: .heavy)).foregroundColor(fg)
        IslandCountdown(endsAt: endsAt, size: 13, color: dim)
      }
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 20).frame(height: IslandTimerLayout.bigBody)
  }
  private func meetBig(_ mt: TMeet) -> some View {
    let f = DateFormatter(); f.timeStyle = .short; f.dateStyle = .none
    let when = "\(f.string(from: Date(timeIntervalSince1970: mt.start / 1000))) to \(f.string(from: Date(timeIntervalSince1970: mt.end / 1000)))"
    return HStack(spacing: 12) {
      ZStack { Circle().fill(blue.opacity(0.22)); Image(systemName: "video.fill").font(.system(size: 13, weight: .bold)).foregroundColor(blue) }
        .frame(width: 36, height: 36)
      VStack(alignment: .leading, spacing: 2) {
        Text(mt.title).font(.system(size: 14, weight: .bold)).foregroundColor(fg).lineLimit(1)
        Text(when).font(.system(size: 12, weight: .medium)).foregroundColor(dim).lineLimit(1)
      }
      Spacer(minLength: 4)
      if let l = mt.link {
        Button(action: { open(l) }) {
          Text(TimersCore.wJoin).font(.system(size: 12.5, weight: .bold)).padding(.horizontal, 13).padding(.vertical, 5)
            .background(blue).foregroundColor(.black).clipShape(Capsule())
        }.buttonStyle(.plain)
      }
    }
    .padding(.horizontal, 16).frame(height: IslandTimerLayout.bigBody)
  }
}

enum IslandTimerLayout {
  /// The open island's body for Stand up and an opened meeting (below the notch, or the whole pill).
  static let bigBody: CGFloat = 62
  static let bubbleH: CGFloat = 24, bubbleGap: CGFloat = 6
}

/// The bubble that splits off the island's right side: the last 15 seconds before a stand-up, or the next meeting.
struct TimerBubble: View {
  @ObservedObject var m: IslandModel
  var r: CGRect
  var fg: Color
  var tap: (TBubble) -> Void
  private let green = Color(red: 0.2, green: 0.83, blue: 0.6), blue = Color(red: 0.38, green: 0.65, blue: 0.98)
  var body: some View {
    let room = max(40, IslandModel.panelW - r.maxX - IslandTimerLayout.bubbleGap - 4)
    let y = m.pill ? r.minY + (m.pillH - IslandTimerLayout.bubbleH) / 2 : max(0, (m.geo.notchH - IslandTimerLayout.bubbleH) / 2)
    ZStack(alignment: .topLeading) {
      Color.clear
      if !m.tshow.right.isNone, m.meetOpen == nil, !m.expanded, m.hasContent, !m.inBar {   // not in the black band over a full screen app
        Button(action: { tap(m.tshow.right) }) { content.frame(maxWidth: room, alignment: .leading) }
          .buttonStyle(.plain)
          .padding(.horizontal, 9).frame(height: IslandTimerLayout.bubbleH)
          .background(Capsule().fill(Color.black))
          .overlay(Capsule().stroke(Color.white.opacity(0.14), lineWidth: 0.8))
          .fixedSize()
          .offset(x: r.maxX + IslandTimerLayout.bubbleGap, y: y)
          .transition(NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? .opacity
            : .scale(scale: 0.2, anchor: .leading).combined(with: .opacity).combined(with: .offset(x: -18)))
          .id(bubbleKey)
          .opacity(m.opacity)
      }
    }
    .frame(width: IslandModel.panelW, height: IslandModel.panelH, alignment: .topLeading)
    .allowsHitTesting(!m.tshow.right.isNone)
  }
  private var bubbleKey: String {
    switch m.tshow.right { case .none: return "none"; case .standSoon: return "stand"; case .meet(let mode, let mt): return "meet-\(mt.id)-\(mode == "join" ? "j" : "c")" }
  }
  @ViewBuilder private var content: some View {
    switch m.tshow.right {
    case .standSoon(let at):
      HStack(spacing: 5) {
        Image(systemName: "figure.stand").font(.system(size: 11, weight: .bold)).foregroundColor(green)
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
          Text("\(max(0, Int(((at - ctx.date.timeIntervalSince1970 * 1000) / 1000).rounded(.up))))")
            .font(.system(size: 12, weight: .heavy)).monospacedDigit().foregroundColor(fg)
        }
      }
    case .meet(let mode, let mt):
      HStack(spacing: 5) {
        Image(systemName: "video.fill").font(.system(size: 10, weight: .bold)).foregroundColor(blue)
        if mode == "join" {
          Text(TimersCore.wJoin).font(.system(size: 11.5, weight: .heavy)).foregroundColor(blue).fixedSize()
          IslandCountdown(endsAt: mt.start, short: true, size: 11, color: fg.opacity(0.7))
        } else if mode == "now" {
          IslandCountdown(endsAt: mt.end, short: true, size: 11.5, color: fg)
          Text("left").font(.system(size: 11, weight: .semibold)).foregroundColor(fg.opacity(0.7)).fixedSize()
        } else {
          Text(TimersCore.wIn(mt.title)).font(.system(size: 11, weight: .semibold)).foregroundColor(fg.opacity(0.8)).lineLimit(1).truncationMode(.tail)
          IslandCountdown(endsAt: mt.start, short: true, size: 11.5, color: fg)
        }
      }
    case .none: EmptyView()
    }
  }
}

/// The time left beside the task during a Pomodoro work session (Settings, "Time left on the island while you work", off
/// unless switched on).
struct WorkClock: View {
  @ObservedObject var m: IslandModel
  var color: Color
  var body: some View {
    if let p = m.tin.pomo, p.phase == "work", p.clock, !p.wait {
      IslandCountdown(endsAt: p.endsAt, left: p.left, size: 11, color: color)
    }
  }
}

// ---------- the controller ----------
/// Keeps the island's timers right: one shot timers to the next moment anything changes (never a ticking loop), and
/// again on wake. Plays the chimes and bounces the island at each change.
final class IslandTimers {
  static let shared = IslandTimers()
  private(set) var input = TimersIn()
  private var seen = Set<String>()
  private var dropped = Set<Double>()
  /// The green tick being shown, and until when.
  private var holding: (id: String, words: String, until: Date)?
  private var timer: DispatchWorkItem?
  private var islandOn = true
  private var meetTimer: DispatchWorkItem?
  private let test = ProcessInfo.processInfo.environment["PS_SELFTEST"] != nil
  /// What the last check found (the self test reads it; nothing else needs it).
  private(set) var last = TShow.idle
  /// When the middle last changed: the green tick and the little man animate from here.
  private(set) var changedAt = Date()

  private init() {
    NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in self?.check() }
  }
  private var model: IslandModel { Island.shared.model }
  private var nowMs: Double { Date().timeIntervalSince1970 * 1000 }

  /// From the island's state ({type:"island"}), also with the island off (then pop-up cards say it).
  func update(_ t: TimersIn, islandOn on: Bool) {
    islandOn = on
    let was = input
    input = t
    if t != was || model.tin != t { model.tin = t }
    check()
  }

  func check() {
    timer?.cancel()
    let now = nowMs
    if let d = TimersCore.dropsStand(input, now) { dropped.insert(d) }
    if dropped.count > 50 { dropped = Set(dropped.sorted().suffix(20)) }
    var s = TimersCore.show(input, now, seen: seen, dropped: dropped)
    // The green tick holds its few seconds, once.
    if let h = holding {
      if Date() < h.until { s.middle = .back(id: h.id, words: h.words); s.right = .none } else { holding = nil; s = TimersCore.show(input, now, seen: seen, dropped: dropped) }
    }
    if case .back(let id, let words) = s.middle, holding == nil {
      seen.insert(id)
      if seen.count > 100 { seen.removeAll() ; seen.insert(id) }
      holding = (id, words, Date().addingTimeInterval(TimersCore.backShowMs / 1000))
      if sound(for: id) { IslandChime.play("done") }
      if !onScreen && words == TimersCore.wBack { Toast.shared.show(title: TimersCore.wBack) }
    }
    apply(s)
    // The next moment anything can change: the earliest boundary, or the tick's end.
    var next = TimersCore.nextChange(input, now).map { ($0 - now) / 1000 }
    if let h = holding { next = min(next ?? .infinity, h.until.timeIntervalSinceNow) }
    if let n = next, n.isFinite {
      let w = DispatchWorkItem { [weak self] in self?.check() }
      timer = w
      DispatchQueue.main.asyncAfter(deadline: .now() + max(0.05, n + 0.02), execute: w)
    }
  }

  private func sound(for backId: String) -> Bool {
    if backId.hasPrefix("stand-") { return input.stand?.sound == true }
    return input.pomo?.sound == true
  }
  private var onScreen: Bool { islandOn && Island.shared.onScreen }

  private func apply(_ s: TShow) {
    let old = model.tshow
    last = s
    guard s != old else { return }
    let calm = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    let began = old.middle.isTask && !s.middle.isTask
    let kindChanged = old.middle.kind != s.middle.kind
    // A takeover begins: the start sound, and a pop-up card when the island is not on screen.
    if old.middle.kind != s.middle.kind {
      switch s.middle {
      case .brk(let phase, _, _, _):
        if input.pomo?.sound == true { IslandChime.play("start") }
        if !onScreen { Toast.shared.show(title: phase == "long" ? TimersCore.wTimeLong : TimersCore.wTimeShort) }
      case .stand(let at, let endsAt):
        if input.stand?.sound == true { IslandChime.play("start") }
        if !onScreen { Toast.shared.show(title: TimersCore.wStandPop, sub: TimersCore.wStandFor(max(1, Int(((endsAt - at) / 60_000).rounded())))) }
      default: break
      }
    }
    if kindChanged || began { model.meetOpen = nil }
    if kindChanged { changedAt = Date().addingTimeInterval(calm || !onScreen ? 0 : 0.13) }
    // The bounce: the island squashes a little, springs to its new size with an overshoot, and settles.
    if kindChanged && !calm && onScreen {
      withAnimation(.spring(response: 0.16, dampingFraction: 0.9)) { model.swell = -0.9 }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.13) { [weak self] in
        guard let self else { return }
        withAnimation(.spring(response: 0.5, dampingFraction: 0.58)) { self.model.tshow = s }
        withAnimation(.spring(response: 0.55, dampingFraction: 0.45)) { self.model.swell = 0 }
        Island.shared.timersChanged()
      }
    } else {
      withAnimation(calm ? .easeInOut(duration: 0.2) : .spring(response: 0.42, dampingFraction: 0.7)) { model.tshow = s }
      Island.shared.timersChanged()
    }
  }

  // ---------- the bubble and the island's buttons ----------
  /// A click on the bubble: Join opens the meeting; otherwise the meeting opens in the island for 10 seconds.
  func tapBubble(_ b: TBubble) {
    guard case .meet(let mode, let mt) = b else { return }
    if mode == "join", let l = mt.link { openLink(l); return }
    meetTimer?.cancel()
    withAnimation(.spring(response: 0.45, dampingFraction: 0.66)) { model.meetOpen = mt }
    Island.shared.timersChanged()
    let w = DispatchWorkItem { [weak self] in self?.closeMeet() }
    meetTimer = w
    DispatchQueue.main.asyncAfter(deadline: .now() + 10, execute: w)
  }
  func closeMeet() {
    meetTimer?.cancel()
    guard model.meetOpen != nil else { return }
    withAnimation(.spring(response: 0.42, dampingFraction: 0.72)) { model.meetOpen = nil }
    Island.shared.timersChanged()
  }
  func openLink(_ l: String?) {
    guard let s = TimersCore.openableLink(l), let u = URL(string: s) else { return }
    if !test { NSWorkspace.shared.open(u) }
    closeMeet()
  }
}
