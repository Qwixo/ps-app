// The Settings assistant's card on the island (PS 1.65), the part on screen. The rules are in AssistIslandCore.swift; the page drives it
// with {type:"assist:island", show, state, line}. The card grows out of the island's own shape (the same black) with a playful
// spring, a small bot drawn here in code swoops in and blinks, and it says "What do you want to do?" with a box to type in.
// States: ask, thinking (dots), answer (the lines), done (a tick), error.
//
// Never in the way (the same promise as SetupIsland.swift): the panel never activates PS. The box takes the keyboard ONLY after the
// person clicks it (not even from PS's own Settings search); never over another app's typing, never over 1Password
// or Signal (the card hides itself while they are in front), never in a test copy. Esc closes it (typed in the box, or in any app
// once Accessibility is on, like PS's own keys), and the keyboard goes back to where it was. Clicks pass through everywhere but the card.
//
// Sounds: original short tones made here with Sfx (nothing downloaded, no outside file, so no licence to note): a soft pop as it
// comes out, a gentle chime on an answer, a tiny happy sound when a setting is done. Quiet and short; they follow Island sounds in
// Settings and Do Not Disturb. Reduce Motion: no swoop, squeeze, blink or bounce, only fades.
import AppKit
import AVFoundation
import SwiftUI

// MARK: - sounds (original tones, CC0 by the PS project: made from sine waves in code)

enum AssistSound {
  typealias Tone = Sfx.Tone
  /// Out of the island: a soft low "pop" (a quick slide down).
  static let pop: [Tone] = [Tone(f: 620, to: 330, dur: 0.09, peak: 0.12, wave: 0, at: 0)]
  /// An answer: two soft notes, gentle.
  static let chime: [Tone] = [Tone(f: 880, to: nil, dur: 0.18, peak: 0.09, wave: 0, at: 0),
                              Tone(f: 1318, to: nil, dur: 0.32, peak: 0.08, wave: 0, at: 0.1)]
  /// Done: three tiny notes going up.
  static let happy: [Tone] = [Tone(f: 988, to: nil, dur: 0.07, peak: 0.09, wave: 0, at: 0),
                              Tone(f: 1318, to: nil, dur: 0.07, peak: 0.09, wave: 0, at: 0.07),
                              Tone(f: 1760, to: nil, dur: 0.16, peak: 0.08, wave: 0, at: 0.14)]
}

// MARK: - the model

final class AssistIslandModel: ObservableObject {
  @Published var look: AssistLook = .hidden
  @Published var line = ""
  @Published var sx: CGFloat = 1
  @Published var sy: CGFloat = 1
  @Published var botIn: CGFloat = 0        // 0 = off to the side, 1 = in place
  @Published var blink: CGFloat = 0        // 0 = eyes open, 1 = shut
  @Published var tickDraw: CGFloat = 0
  @Published var focus = 0                 // changes when the box should take the keyboard
  @Published var clear = 0                 // changes when the box should empty
  @Published var hover: String?
  @Published var islandSize = CGSize(width: 330, height: 34)
  @Published var buttons: [AssistButton] = []
  /// The page's reduce motion (the website's own setting can ask for it too), on top of the Mac's.
  var pageReduce = false
  var reduce: Bool { pageReduce || NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
  var submit: (String) -> Void = { _ in }
  var press: (AssistButton) -> Void = { _ in }
  var close: () -> Void = {}

  var size: CGSize {
    if look == .hidden { return islandSize }
    let s = AssistIslandCore.size(look, line: line)
    return CGSize(width: s.w, height: s.h)
  }
  var radius: CGFloat { CGFloat(AssistIslandCore.radius(Double(size.height))) }
}

// MARK: - the bot, drawn in code

struct AssistBot: View {
  var size: CGFloat
  var blink: CGFloat
  var happy: Bool
  var bob: CGFloat          // -1...1, the antenna and the head float a little
  var body: some View {
    let w = size, h = size
    ZStack {
      // antenna
      Path { p in p.move(to: CGPoint(x: w * 0.5, y: h * 0.16)); p.addLine(to: CGPoint(x: w * 0.5 + bob * 2, y: h * 0.04)) }
        .stroke(Color.white.opacity(0.7), style: StrokeStyle(lineWidth: max(1.5, w * 0.05), lineCap: .round))
      Circle().fill(Color(red: 0.93, green: 0.31, blue: 0.53)).frame(width: w * 0.14, height: w * 0.14)
        .shadow(color: Color(red: 0.93, green: 0.31, blue: 0.53).opacity(0.8), radius: 3)
        .position(x: w * 0.5 + bob * 2, y: h * 0.04)
      // ears
      Circle().fill(Color.white.opacity(0.55)).frame(width: w * 0.12, height: w * 0.12).position(x: w * 0.05, y: h * 0.6)
      Circle().fill(Color.white.opacity(0.55)).frame(width: w * 0.12, height: w * 0.12).position(x: w * 0.95, y: h * 0.6)
      // head
      RoundedRectangle(cornerRadius: w * 0.26, style: .continuous)
        .fill(LinearGradient(colors: [Color(red: 0.88, green: 0.94, blue: 1.0), Color(red: 0.66, green: 0.80, blue: 0.96)], startPoint: .top, endPoint: .bottom))
        .frame(width: w * 0.86, height: h * 0.68)
        .position(x: w * 0.5, y: h * 0.58)
      // eyes: they close to a line when blinking
      ForEach(0..<2, id: \.self) { i in
        Capsule().fill(Color.black.opacity(0.82))
          .frame(width: w * 0.12, height: max(1.5, h * 0.2 * (1 - blink)))
          .position(x: w * (i == 0 ? 0.34 : 0.66), y: h * 0.52)
      }
      // a smile (bigger when happy)
      Path { p in
        p.addArc(center: CGPoint(x: w * 0.5, y: h * (happy ? 0.58 : 0.62)), radius: w * (happy ? 0.16 : 0.11), startAngle: .degrees(20), endAngle: .degrees(160), clockwise: false)
      }
      .stroke(Color.black.opacity(0.7), style: StrokeStyle(lineWidth: max(1.6, w * 0.055), lineCap: .round))
    }
    .frame(width: w, height: h)
    .offset(y: bob * 1.5)
  }
}

/// Three dots that pulse one after the other (by the clock; slow fades under Reduce Motion).
struct AssistDots: View {
  var slow: Bool
  var body: some View {
    TimelineView(.animation) { t in
      let now = t.date.timeIntervalSinceReferenceDate
      HStack(spacing: 5) {
        ForEach(0..<3, id: \.self) { i in
          let ph = (now * (slow ? 0.6 : 1.5) - Double(i) * 0.18).truncatingRemainder(dividingBy: 1)
          let v = 0.5 + 0.5 * sin(ph * 2 * .pi)
          Circle().fill(Color.white).frame(width: 6, height: 6)
            .opacity(0.35 + 0.65 * v)
            .offset(y: slow ? 0 : CGFloat(-3 * v))
        }
      }
    }
  }
}

/// The box to type in. A real NSTextField, so it behaves like every other field on the Mac. It takes the keyboard only when `focus`
/// changes (the card decides that, see AssistIslandCore.mayTakeKeyboard).
struct AssistField: NSViewRepresentable {
  @ObservedObject var m: AssistIslandModel
  func makeCoordinator() -> Coordinator { Coordinator(m) }
  func makeNSView(context: Context) -> NSTextField {
    let f = NSTextField(string: "")
    f.isBordered = false
    f.drawsBackground = false
    f.focusRingType = .none
    f.textColor = .white
    f.font = NSFont.systemFont(ofSize: 13.5, weight: .medium)
    f.placeholderAttributedString = NSAttributedString(string: AssistWords.placeholder, attributes: [
      .foregroundColor: NSColor.white.withAlphaComponent(0.42), .font: NSFont.systemFont(ofSize: 13.5, weight: .medium)])
    f.cell?.usesSingleLineMode = true
    f.cell?.isScrollable = true
    f.delegate = context.coordinator
    f.setAccessibilityLabel(AssistWords.ask)
    context.coordinator.field = f
    return f
  }
  func updateNSView(_ f: NSTextField, context: Context) {
    let c = context.coordinator
    if c.lastClear != m.clear { c.lastClear = m.clear; f.stringValue = "" }
    if c.lastFocus != m.focus {
      c.lastFocus = m.focus
      DispatchQueue.main.async { f.window?.makeFirstResponder(f) }
    }
  }
  final class Coordinator: NSObject, NSTextFieldDelegate {
    let m: AssistIslandModel
    weak var field: NSTextField?
    var lastFocus = 0, lastClear = 0
    init(_ m: AssistIslandModel) { self.m = m }
    func control(_ control: NSControl, textView: NSTextView, doCommandBy sel: Selector) -> Bool {
      if sel == #selector(NSResponder.insertNewline(_:)) {
        let t = AssistCore.plain(control.stringValue, max: AssistCore.maxText)
        if !t.isEmpty { m.submit(t) }
        return true
      }
      if sel == #selector(NSResponder.cancelOperation(_:)) { m.close(); return true }
      return false
    }
  }
}

struct AssistIslandView: View {
  @ObservedObject var m: AssistIslandModel
  static let inset: CGFloat = 6

  var body: some View {
    VStack(spacing: 0) {
      ZStack(alignment: .topLeading) {
        RoundedRectangle(cornerRadius: m.radius, style: .continuous)
          .fill(Color.black)
          .overlay(RoundedRectangle(cornerRadius: m.radius, style: .continuous).stroke(Color.white.opacity(0.1), lineWidth: 1))
          .shadow(color: Color.black.opacity(m.look == .hidden ? 0 : 0.35), radius: 14, y: 6)
        content.transition(.opacity).id(m.look)
      }
      .frame(width: m.size.width, height: m.size.height)
      .scaleEffect(x: m.sx, y: m.sy, anchor: .top)
      .opacity(m.look == .hidden ? 0 : 1)
      Spacer(minLength: 0)
    }
    .padding(.top, AssistIslandView.inset)
    .frame(width: AssistIsland.panelW, height: AssistIsland.panelH)
    .environment(\.colorScheme, .dark)
  }

  private func bot(_ size: CGFloat, happy: Bool = false, bobbing: Bool = false) -> some View {
    TimelineView(.animation(paused: !bobbing || m.reduce)) { t in
      let b = bobbing && !m.reduce ? CGFloat(sin(t.date.timeIntervalSinceReferenceDate * 5)) : 0
      AssistBot(size: size, blink: m.blink, happy: happy, bob: b)
    }
    // Swoops in from the left, tilted, and settles (nothing but a fade under Reduce Motion).
    .offset(x: m.reduce ? 0 : (1 - m.botIn) * -60, y: m.reduce ? 0 : (1 - m.botIn) * -14)
    .rotationEffect(.degrees(m.reduce ? 0 : Double(1 - m.botIn) * -28))
    .scaleEffect(m.reduce ? 1 : 0.5 + 0.5 * m.botIn)
    .opacity(Double(min(1, m.botIn * 1.5)))
    .accessibilityLabel(AssistWords.botLabel)
  }

  static let accent = Color(red: 0.93, green: 0.31, blue: 0.53)
  /// One thin pill button: Do it is filled, the others quiet.
  private func pill(_ b: AssistButton) -> some View {
    let main = b == .doit, hot = m.hover == b.rawValue
    return Button(action: { m.press(b) }) {
      Text(b.word).font(.system(size: 12.5, weight: .semibold, design: .rounded))
        .foregroundColor(main ? .white : Color.white.opacity(hot ? 0.95 : 0.75))
        .padding(.horizontal, 12).frame(height: 26)
        .background(Capsule().fill(main ? AssistIslandView.accent.opacity(hot ? 1 : 0.88) : Color.white.opacity(hot ? 0.16 : 0.08)))
        .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(b.word)
    .onHover { on in if on { m.hover = b.rawValue } else if m.hover == b.rawValue { m.hover = nil } }
  }

  private var closeButton: some View {
    Button(action: { m.close() }) {
      Image(systemName: "xmark").font(.system(size: 10.5, weight: .semibold))
        .foregroundColor(Color.white.opacity(m.hover == "close" ? 0.95 : 0.5))
        .frame(width: 26, height: 26)
        .background(Circle().fill(Color.white.opacity(m.hover == "close" ? 0.14 : 0)))
        .contentShape(Circle())
    }
    .buttonStyle(.plain)
    .help(AssistWords.close)
    .accessibilityLabel(AssistWords.close)
    .onHover { on in if on { m.hover = "close" } else if m.hover == "close" { m.hover = nil } }
  }

  @ViewBuilder var content: some View {
    switch m.look {
    case .ask:
      ZStack(alignment: .topTrailing) {
        HStack(alignment: .center, spacing: 14) {
          bot(46)
          VStack(alignment: .leading, spacing: 9) {
            Text(AssistWords.ask).font(.system(size: 16, weight: .semibold, design: .rounded)).foregroundColor(.white).lineLimit(1)
            AssistField(m: m)
              .frame(height: 22)
              .padding(.horizontal, 12).padding(.vertical, 6)
              .background(Capsule().fill(Color.white.opacity(0.11)))
          }
        }
        .padding(.leading, 20).padding(.trailing, 22).padding(.vertical, 14)
        closeButton.padding(.top, 6).padding(.trailing, 8)
      }
    case .thinking:
      HStack(spacing: 12) {
        bot(34, bobbing: true)
        Text(AssistWords.thinking).font(.system(size: 14, weight: .semibold, design: .rounded)).foregroundColor(.white)
        AssistDots(slow: m.reduce)
        Spacer(minLength: 0)
      }
      .padding(.horizontal, 18)
      .frame(maxHeight: .infinity)
    case .confirm:
      ZStack(alignment: .topTrailing) {
        VStack(alignment: .leading, spacing: 10) {
          HStack(alignment: .top, spacing: 12) {
            bot(36)
            Text(m.line).font(.system(size: 13.5, weight: .medium, design: .rounded)).foregroundColor(Color.white.opacity(0.92))
              .lineLimit(4).fixedSize(horizontal: false, vertical: true).padding(.top, 2)
            Spacer(minLength: 0)
          }
          HStack(spacing: 8) {
            Spacer(minLength: 0)
            ForEach(m.buttons, id: \.self) { b in pill(b) }
          }
        }
        .padding(.leading, 18).padding(.trailing, 18).padding(.vertical, 14)
      }
    case .walk:
      HStack(alignment: .center, spacing: 12) {
        bot(32, bobbing: true)
        Image(systemName: "location.fill").font(.system(size: 11, weight: .semibold)).foregroundColor(AssistIslandView.accent)
        Text(m.line).font(.system(size: 13.5, weight: .semibold, design: .rounded)).foregroundColor(.white)
          .lineLimit(5).fixedSize(horizontal: false, vertical: true)
        Spacer(minLength: 0)
      }
      .padding(.horizontal, 18).padding(.vertical, 12)
      .frame(maxHeight: .infinity)
    case .answer, .error:
      ZStack(alignment: .topTrailing) {
        HStack(alignment: .top, spacing: 12) {
          bot(36)
          Text(m.line).font(.system(size: 13.5, weight: .medium, design: .rounded)).foregroundColor(Color.white.opacity(0.92))
            .lineLimit(5).fixedSize(horizontal: false, vertical: true)
            .padding(.top, 2)
          Spacer(minLength: 0)
        }
        .padding(.leading, 18).padding(.trailing, 36).padding(.vertical, 14)
        closeButton.padding(.top, 6).padding(.trailing, 8)
      }
    case .done:
      HStack(spacing: 10) {
        bot(30, happy: true)
        SetupTickMark(size: 24, draw: m.tickDraw)
        Text(m.line).font(.system(size: 14, weight: .semibold, design: .rounded)).foregroundColor(.white).lineLimit(2).minimumScaleFactor(0.85)
          .fixedSize(horizontal: false, vertical: true)
        Spacer(minLength: 0)
      }
      .padding(.horizontal, 16)
      .frame(maxHeight: .infinity)
    case .hidden:
      Color.clear
    }
  }
}

// MARK: - the panel (never key unless the person clicked the box, or PS was already in front)

final class AssistPanel: NSPanel {
  var keyable = false
  var onMouseDown: (() -> Void)?
  override var canBecomeKey: Bool { keyable }
  override var canBecomeMain: Bool { false }
  override func sendEvent(_ e: NSEvent) {
    if e.type == .leftMouseDown, !keyable { onMouseDown?() }
    super.sendEvent(e)
  }
}

// MARK: - the controller

final class AssistIsland {
  static let shared = AssistIsland()
  static let panelW: CGFloat = 470, panelH: CGFloat = 190

  let model = AssistIslandModel()
  private let test = ProcessInfo.processInfo.environment["PS_SELFTEST"] != nil
  private var panel: AssistPanel?
  private var monitors: [Any] = []
  private var timer: Timer?
  private var players: [String: AVAudioPlayer] = [:]
  private var settingSounds = true
  private var islandOff = false
  private var returnTo: pid_t = 0
  private var blinkLater: DispatchWorkItem?
  private var hideLater: DispatchWorkItem?
  private var protectedHidden = false
  /// PS's own sound volume from the page (0 is silent).
  private var volume: Double = 0
  private(set) var log: [String] = []

  private init() {
    model.close = { [weak self] in self?.userClose() }
    model.submit = { [weak self] t in self?.submitted(t) }
    model.press = { [weak self] b in self?.pressed(b) }
  }

  /// Island sounds and the island being off, as the page says (main.swift passes the island state on).
  func islandState(_ st: [String: Any]) {
    guard st["hide"] != nil, let mode = st["mode"] as? String else { return }
    islandOff = mode == "off"
    settingSounds = (st["sounds"] as? Bool) != false
  }

  // MARK: from the page

  func fromPage(_ msg: [String: Any]) {
    let show = (msg["show"] as? Bool) ?? false
    let state = AssistIslandCore.look(forState: msg["state"] as? String)
    let line = AssistCore.plain(msg["line"] as? String ?? "", max: 240)
    let buttons = AssistIslandCore.buttons(msg["buttons"], for: state ?? .ask)
    let vol = AssistIslandCore.volume(msg["vol"])
    let reduce = (msg["reduce"] as? Bool) == true
    DispatchQueue.main.async { [self] in
      volume = vol
      model.pageReduce = reduce
      if !show { hide(); return }
      model.buttons = buttons
      guard AssistIslandCore.mayShow(featureOn: Features.on("settings-assistant"), islandOff: islandOff, protectedFront: Protected.front, test: test) else { return }
      present(state ?? .ask, line: line)
    }
  }

  // MARK: showing

  private var spring: Animation { model.reduce ? .easeInOut(duration: 0.2) : .spring(response: 0.46, dampingFraction: 0.62) }

  private func present(_ want: AssistLook, line: String) {
    hideLater?.cancel()
    guard ensurePanel() else { return }
    let old = model.look
    model.line = line
    if old == .hidden || panel?.isVisible != true {
      model.islandSize = Island.shared.shapeOnScreen()?.size ?? CGSize(width: 330, height: 34)
      model.look = .hidden
      model.botIn = 0; model.blink = 0; model.tickDraw = 0
      model.sx = 1; model.sy = 1
      panel?.setFrame(topFrame(), display: true)
      panel?.alphaValue = 1
      if !Protected.front { panel?.orderFrontRegardless() }
      watch()
      // A tiny squeeze of the island first, then it grows out with a springy overshoot (the SetupIsland recipe).
      if AssistIslandCore.bigMotion(reduceMotion: model.reduce) {
        withAnimation(.easeOut(duration: 0.09)) { model.sx = 0.94; model.sy = 0.8 }
        after(0.1) { [self] in grow(to: want, from: old) }
      } else { grow(to: want, from: old) }
    } else {
      grow(to: want, from: old)
    }
  }

  private func grow(to want: AssistLook, from old: AssistLook) {
    withAnimation(spring) { model.look = want; model.sx = 1; model.sy = 1 }
    if let c = AssistIslandCore.cue(from: old, to: want, soundsOn: settingSounds && volume > 0 && !test, dndMutes: DND.shared.mutes("sounds")) { play(c) }
    if want == .done {
      model.tickDraw = 0
      after(0.1) { [self] in withAnimation(.easeOut(duration: model.reduce ? 0.15 : 0.38)) { model.tickDraw = 1 } }
      if AssistIslandCore.bigMotion(reduceMotion: model.reduce) {
        after(0.15) { [self] in withAnimation(.spring(response: 0.2, dampingFraction: 0.5)) { model.sx = 1.05; model.sy = 1.07 } }
        after(0.32) { [self] in withAnimation(.spring(response: 0.4, dampingFraction: 0.45)) { model.sx = 1; model.sy = 1 } }
      }
    }
    // The bot swoops in (once per time the card comes out), then blinks now and then.
    if old == .hidden {
      after(AssistIslandCore.bigMotion(reduceMotion: model.reduce) ? 0.16 : 0) { [self] in
        withAnimation(model.reduce ? .easeOut(duration: 0.2) : .spring(response: 0.5, dampingFraction: 0.58)) { model.botIn = 1 }
      }
      scheduleBlink()
    }
    // The box never takes the keyboard by itself, not even from PS's own Settings search: a click on the card does (clickedPanel).
    if want != .ask && old == .ask { giveBack() }
  }

  private func hide() {
    guard let p = panel, p.isVisible, model.look != .hidden else { return }
    giveBack()
    blinkLater?.cancel()
    withAnimation(model.reduce ? .easeOut(duration: 0.2) : .spring(response: 0.36, dampingFraction: 0.85)) {
      model.look = .hidden; model.sx = 1; model.sy = 1; model.botIn = 0
    }
    let w = DispatchWorkItem { [weak self] in
      guard let self, self.model.look == .hidden else { return }
      self.panel?.orderOut(nil); self.watch()
    }
    hideLater = w
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.45, execute: w)
  }

  // MARK: the keyboard

  private func clickedPanel() {
    guard model.look == .ask, !(panel?.isKeyWindow ?? false) else { return }
    if AssistIslandCore.mayTakeKeyboard(clickedField: true, psIsFront: NSApp.isActive, protectedFront: Protected.front, test: test) { takeKeyboard() }
  }
  private func takeKeyboard() {
    guard let p = panel, p.isVisible else { return }
    if returnTo == 0 {
      let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0
      returnTo = pid == ProcessInfo.processInfo.processIdentifier ? 0 : pid
    }
    p.keyable = true
    p.makeKey()
    model.focus += 1
  }
  /// The keyboard goes back to the app it was taken from.
  private func giveBack() {
    guard let p = panel else { returnTo = 0; return }
    let wasKey = p.isKeyWindow
    p.keyable = false
    if wasKey { p.resignKey() }
    defer { returnTo = 0 }
    guard wasKey, returnTo > 0, let app = NSRunningApplication(processIdentifier: returnTo), !Protected.matches(app) else { return }
    if NSWorkspace.shared.frontmostApplication?.processIdentifier == returnTo { app.activate(options: []) }
  }

  // MARK: the person's actions

  private func submitted(_ text: String) {
    log.append("typed")
    giveBack()
    model.clear += 1
    AssistService.shared.send(["type": "assist:typed", "text": text])
    // The page will say "thinking" itself; this makes it instant.
    model.line = ""
    withAnimation(spring) { model.look = .thinking }
  }
  /// Do it, Show me how or Cancel on the card: the page decides what happens (and re-checks it), the card only passes the click on.
  private func pressed(_ b: AssistButton) {
    log.append("pressed \(b.rawValue)")
    AssistService.shared.send(["type": "assist:action", "do": b.rawValue])
  }
  private func userClose() {
    log.append("close")
    hide()
    AssistService.shared.send(["type": "assist:closed"])
  }
  /// Esc, from the box, a local key or the global monitor.
  func escape() {
    guard AssistIslandCore.escape(visible: panel?.isVisible == true && model.look != .hidden) == .closeCard else { return }
    userClose()
  }

  // MARK: blinking, 1 Password and Signal, Esc in any app

  private func scheduleBlink() {
    blinkLater?.cancel()
    guard AssistIslandCore.bigMotion(reduceMotion: model.reduce) else { return }
    let w = DispatchWorkItem { [weak self] in
      guard let self, self.model.look != .hidden else { return }
      withAnimation(.easeIn(duration: 0.07)) { self.model.blink = 1 }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { withAnimation(.easeOut(duration: 0.09)) { self.model.blink = 0 } }
      self.scheduleBlink()
    }
    blinkLater = w
    DispatchQueue.main.asyncAfter(deadline: .now() + Double.random(in: 2.2...4.6), execute: w)
  }

  private func watch() {
    let need = panel?.isVisible == true
    if need && timer == nil {
      let t = Timer(timeInterval: 1, repeats: true) { [weak self] _ in self?.second() }
      t.tolerance = 0.25
      RunLoop.main.add(t, forMode: .common)
      timer = t
      startMonitors()
    } else if !need, let t = timer {
      t.invalidate(); timer = nil
      stopMonitors()
    }
  }
  private func second() {
    if Protected.front != protectedHidden {
      protectedHidden = Protected.front
      // While 1Password or Signal is in front the card is gone and PS hears no key at all (the monitors stop), then all comes back.
      if protectedHidden { giveBack(); stopMonitors(); panel?.orderOut(nil) }
      else if model.look != .hidden { startMonitors(); panel?.orderFrontRegardless() }
    }
  }
  private func startMonitors() {
    guard monitors.isEmpty, !Protected.front else { return }
    if let m = NSEvent.addGlobalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged], handler: { [weak self] _ in self?.pointer() }) { monitors.append(m) }
    if let m = NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved, .keyDown], handler: { [weak self] e in
      if e.type == .keyDown && e.keyCode == 53 { self?.escape() } else if e.type == .mouseMoved { self?.pointer() }
      return e
    }) { monitors.append(m) }
    if let m = NSEvent.addGlobalMonitorForEvents(matching: [.keyDown], handler: { [weak self] e in if e.keyCode == 53 { self?.escape() } }) { monitors.append(m) }
  }
  private func stopMonitors() { monitors.forEach { NSEvent.removeMonitor($0) }; monitors = [] }
  /// Clicks pass through everywhere except on the card itself.
  private func pointer() {
    guard let p = panel else { return }
    let over = shapeOnScreen()?.contains(NSEvent.mouseLocation) ?? false
    if p.ignoresMouseEvents == over { p.ignoresMouseEvents = !over }
  }
  private func shapeOnScreen() -> NSRect? {
    guard let p = panel, p.isVisible, model.look != .hidden else { return nil }
    let s = model.size
    return NSRect(x: p.frame.midX - s.width / 2, y: p.frame.maxY - AssistIslandView.inset - s.height, width: s.width, height: s.height)
  }

  // MARK: window

  private func ensurePanel() -> Bool {
    if panel != nil { return true }
    guard !test, NSScreen.main != nil else { return false }
    let p = AssistPanel(contentRect: NSRect(x: 0, y: 0, width: AssistIsland.panelW, height: AssistIsland.panelH),
                        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    p.isOpaque = false
    p.backgroundColor = .clear
    p.hasShadow = false
    p.level = NSWindow.Level(rawValue: NSWindow.Level.mainMenu.rawValue + 4)   // just above the setup guide, above the real island
    p.hidesOnDeactivate = false
    p.isReleasedWhenClosed = false
    p.collectionBehavior = IslandPlace.spaces
    p.ignoresMouseEvents = true
    p.setAccessibilityLabel(AssistWords.botLabel)
    p.onMouseDown = { [weak self] in self?.clickedPanel() }
    let host = IslandHost(rootView: AssistIslandView(m: model))
    host.frame = NSRect(x: 0, y: 0, width: AssistIsland.panelW, height: AssistIsland.panelH)
    p.contentView = host
    panel = p
    return true
  }
  private func topFrame() -> NSRect {
    let W = AssistIsland.panelW, H = AssistIsland.panelH, inset = AssistIslandView.inset
    if let r = Island.shared.shapeOnScreen() { return NSRect(x: r.midX - W / 2, y: r.maxY + inset - H, width: W, height: H) }
    let (g, _) = IslandGeo.read()
    let top = g.frame.maxY - (g.notch ? g.notchH : g.menuH) - 6
    return NSRect(x: g.centerX - W / 2, y: top + inset - H, width: W, height: H)
  }

  // MARK: sound

  private func play(_ c: AssistIslandCore.Cue) {
    guard !test else { return }
    let tones = c == .pop ? AssistSound.pop : c == .chime ? AssistSound.chime : AssistSound.happy
    if players[c.rawValue] == nil { players[c.rawValue] = try? AVAudioPlayer(data: Sfx.wav(tones)); players[c.rawValue]?.prepareToPlay() }
    guard let p = players[c.rawValue] else { return }
    p.volume = Float(0.35 * volume)
    p.currentTime = 0
    p.play()
  }
  private func after(_ s: Double, _ f: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + s, execute: f) }
}
