import AppKit
import SwiftUI

// "PS is active" (the developer, 31 Oct 2026, V1.23: "I want to do away with the actual PS app application screen
// ... like a mini pop-up just to say that PS is active ... I only want it to be the tab overlay now").
// PS has no main window any more: its page still runs hidden (the engine: vault, sync, cards, island).
// When PS launches, or its Dock icon is clicked, this small card drops in at the top of the screen:
// PS is active, hold Tab to open your list, synced, the next meeting, and three buttons (Open list,
// Settings, Quit PS). It fades away by itself after a few seconds, or on a click anywhere else, and
// never takes the keyboard (a panel that cannot become key; the first click on a button counts).
// Locked: Unlock with Touch ID or the passphrase. Signed out: Sign in (the engine page's own sign in
// screen in a small window, so a passphrase never passes through here). Gone while 1Password or Signal
// is in front, never shown over them. The engine page posts {type:"psStatus", state} (src/psstatus.ts);
// this file only draws what it was handed: no vault, no network, nothing saved.
final class PopupPanel: NSPanel {
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}
final class PopupHost<C: View>: NSHostingView<C> {
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }   // the first click on a button counts
}

struct PopupNext: Equatable { var start: Date; var end: Date?; var title: String?; var now: Bool }
struct PopupState: Equatable {
  enum Stage: String { case opening, open, locked, signedOut }
  var stage = Stage.opening
  var keyName = "Tab"
  var tabOn = true
  var trusted = true
  var online = true
  var lastSync: Date?
  var pending = 0
  var error = false
  var next: PopupNext?
  var priv = false
  var version = ""
  var second = false        // a Second Computer window to open (set once that code is in: Popup.secondComputer)
  var secondLine = ""       // its one line state ("Home M1, online"), empty to hide (Popup.secondStatus)
  /// macOS Secure Input is stuck on, so no key reaches PS (SecureInput.swift, V1.41): the words to show, nil when fine.
  var secureNote: String?
  /// The keyboard tap gets no keys while you type, even after a fresh one (TabWatch.deafCheck, V1.41).
  var deaf = false
  /// The Tab problem to tell, worst first (TabHealthCore.swift). The card stays while there is one.
  var tabNotice: TabNotice? { TabHealth.notice(tabOn: tabOn, trusted: trusted, secureNote: secureNote, deaf: deaf, appName: AppName.current, keyName: keyName) }

  /// The page's status, checked and capped (src/core/psstatus.ts).
  mutating func take(_ d: [String: Any]) {
    let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    func date(_ v: Any?) -> Date? { (v as? String).flatMap { f.date(from: $0) ?? ISO8601DateFormatter().date(from: $0) } }
    online = (d["online"] as? Bool) ?? true
    lastSync = date(d["lastSync"])
    pending = max(0, min(999, (d["pending"] as? Int) ?? 0))
    error = (d["error"] as? Bool) == true
    priv = (d["private"] as? Bool) == true
    if let n = d["next"] as? [String: Any], let s = date(n["start"]) {
      let t = (n["title"] as? String).map { String($0.replacingOccurrences(of: "\n", with: " ").prefix(80)) }
      next = PopupNext(start: s, end: date(n["end"]), title: priv ? nil : (t?.isEmpty == true ? nil : t), now: (n["now"] as? Bool) == true)
    } else { next = nil }
  }

  var title: String {
    switch stage {
    case .opening: return "\(AppName.current) is starting"
    case .open: return "\(AppName.current) is active"
    case .locked: return "\(AppName.current) is locked"
    case .signedOut: return "\(AppName.current) is signed out"
    }
  }
  var subtitle: String {
    switch stage {
    case .opening: return "Opening your vault"
    case .open: return !tabOn ? "The Tab list is switched off" : tabNotice != nil ? "Holding \(keyName) does nothing right now" : "Hold \(keyName) to open your list"
    case .locked: return "Touch ID or your Mac password opens it again"
    case .signedOut: return "Sign in once and your list, cards and island come back"
    }
  }
  func syncLine(_ now: Date) -> (String, Bool) {
    if !online { return ("Offline, showing your saved copy", false) }
    if pending > 0 { return ("Saving \(pending) change\(pending == 1 ? "" : "s")", true) }
    if error { return ("Sync issue, retrying", false) }
    guard let l = lastSync else { return ("Not synced yet", false) }
    let sec = max(0, now.timeIntervalSince(l))
    let fresh = sec < 5 * 60
    if sec < 45 { return ("Synced just now", true) }
    let m = Int((sec / 60).rounded())
    if m < 60 { return ("Synced \(m) min ago", fresh) }
    return ("Synced \(Int((Double(m) / 60).rounded()))h ago", false)
  }
  func nextLine(_ now: Date) -> String? {
    guard let n = next else { return nil }
    let when: String
    if n.now { when = "Now" }
    else {
      let mins = Int((n.start.timeIntervalSince(now) / 60).rounded())
      if mins < 60 { when = mins <= 1 ? "In a minute" : "In \(mins) min" }
      else {
        let tf = DateFormatter(); tf.dateFormat = "h:mm a"
        when = (Calendar.current.isDateInToday(n.start) ? "" : "Tomorrow ") + tf.string(from: n.start)
      }
    }
    return n.title.map { "\(when) · \($0)" } ?? "\(when) · next meeting"
  }
}

final class PopupModel: ObservableObject {
  @Published var st = PopupState()
  @Published var visible = false
  @Published var hovering = false
  @Published var left: Double = 1          // the hairline along the bottom: time until it fades
  @Published var quitArmed = false
  @Published var hover: String?            // the button under the pointer (no @State: built without SwiftUI's macros)
  @Published var pulse = false             // the live ring round the green dot, only while the card is up
  var act: (String) -> Void = { _ in }
}

private let pink = Color(red: 0.93, green: 0.31, blue: 0.53)
private let pinkLight = Color(red: 0.96, green: 0.45, blue: 0.66)
private let violet = Color(red: 0.55, green: 0.36, blue: 0.96)
private let green = Color(red: 0.36, green: 0.80, blue: 0.60)
private let amber = Color(red: 0.94, green: 0.70, blue: 0.35)

/// A pill button: a plain SwiftUI button with its own look (the system button style drew marks at its ends).
struct PopupButton: View {
  @ObservedObject var m: PopupModel
  let title: String
  let id: String
  var primary = false
  var danger = false
  var disabled = false
  var hover: Bool { m.hover == id && !disabled }
  var body: some View {
    Button { m.act(id) } label: {
      Text(title)
        .font(.system(size: 13, weight: .semibold)).lineLimit(1).fixedSize()
        .foregroundColor(.white.opacity(disabled ? 0.4 : primary || danger ? 1 : 0.92))
        .padding(.horizontal, 14).frame(height: 32)
        .background(
          // The rim is a second fill 1 pt larger (a stroked Capsule left hairlines at its ends).
          ZStack {
            Capsule().fill(Color.white.opacity(primary ? 0.3 : 0.17))
            Capsule().fill(primary ? AnyShapeStyle(LinearGradient(colors: [pinkLight, pink], startPoint: .top, endPoint: .bottom))
                           : danger ? AnyShapeStyle(Color(red: 0.86, green: 0.25, blue: 0.3)) : AnyShapeStyle(Color(red: 0.2, green: 0.13, blue: 0.24).opacity(hover ? 0.75 : 1)))
              .padding(1)
          }
          .opacity(disabled ? 0.5 : 1)
        )
        .contentShape(Capsule())
        .shadow(color: primary && !disabled ? pink.opacity(0.45) : .clear, radius: primary ? 10 : 0, y: primary ? 4 : 0)
        .scaleEffect(hover ? 1.03 : 1)
        .animation(.spring(response: 0.25, dampingFraction: 0.7), value: hover)
    }
    .buttonStyle(.plain)
    .focusable(false)
    .disabled(disabled)
    .onHover { on in if on { m.hover = id } else if m.hover == id { m.hover = nil } }
  }
}

struct PopupView: View {
  @ObservedObject var m: PopupModel
  var now = Date()          // the self test draws a fixed moment
  static let width: CGFloat = 392

  var body: some View {
    VStack(spacing: 0) { card.padding(.horizontal, 20).padding(.top, 6).padding(.bottom, 28) }
      .frame(width: PopupView.width + 40)
      .fixedSize(horizontal: false, vertical: true)
  }

  private var dot: some View {
    let c: Color = m.st.stage == .open ? green : m.st.stage == .locked ? amber : m.st.stage == .signedOut ? pink : violet
    return ZStack {
      if m.st.stage == .opening {
        ProgressView().controlSize(.small).progressViewStyle(.circular).tint(.white).scaleEffect(0.8)
      } else {
        if m.visible && m.st.stage == .open {
          Circle().stroke(c.opacity(0.7), lineWidth: 2).frame(width: 10, height: 10)
            .scaleEffect(m.pulse ? 2.4 : 1).opacity(m.pulse ? 0 : 0.9)
        }
        Circle().fill(c).frame(width: 10, height: 10).shadow(color: c.opacity(0.8), radius: 6)
      }
    }.frame(width: 28, height: 28)
  }

  private var card: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .top, spacing: 10) {
        dot.padding(.top, 1)
        VStack(alignment: .leading, spacing: 3) {
          HStack(spacing: 8) {
            Text(m.st.title).font(.system(size: 17, weight: .bold)).foregroundColor(.white)
            if !m.st.version.isEmpty {
              Text(m.st.version).font(.system(size: 10.5, weight: .semibold)).foregroundColor(.white.opacity(0.5))
                .padding(.horizontal, 6).padding(.vertical, 2).background(Capsule().fill(Color.white.opacity(0.08)))
            }
          }
          Text(m.st.subtitle).font(.system(size: 13, weight: .medium)).foregroundColor(.white.opacity(0.66))
            .fixedSize(horizontal: false, vertical: true)
        }
        Spacer(minLength: 4)
        Button { m.act("close") } label: {
          Image(systemName: "xmark").font(.system(size: 10, weight: .bold)).foregroundColor(.white.opacity(0.6))
            .frame(width: 22, height: 22).background(Circle().fill(Color.white.opacity(0.08)))
        }.buttonStyle(.plain).help("Close")
      }

      if m.st.stage == .open {
        VStack(alignment: .leading, spacing: 7) {
          let s = m.st.syncLine(now)
          row(s.1 ? "checkmark.circle.fill" : "exclamationmark.circle.fill", s.0, s.1 ? green : amber)
          if let n = m.st.nextLine(now) { row(m.st.next?.now == true ? "video.fill" : "calendar", n, pinkLight) }
          if m.st.second {
            Button { m.act("second") } label: {
              HStack(spacing: 8) {
                Image(systemName: "desktopcomputer").font(.system(size: 12, weight: .semibold)).foregroundColor(violet).frame(width: 16)
                Text("Second Computer").font(.system(size: 13, weight: .semibold)).foregroundColor(.white.opacity(m.hover == "second" ? 1 : 0.86))
                if !m.st.secondLine.isEmpty {
                  Text("· " + m.st.secondLine).font(.system(size: 13, weight: .medium)).foregroundColor(.white.opacity(0.55)).lineLimit(1).truncationMode(.tail)
                }
                Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold)).foregroundColor(.white.opacity(0.45))
                  .offset(x: m.hover == "second" ? 3 : 0)
              }
              .contentShape(Rectangle())
              .animation(.spring(response: 0.25, dampingFraction: 0.7), value: m.hover)
            }
            .buttonStyle(.plain).focusable(false)
            .onHover { on in if on { m.hover = "second" } else if m.hover == "second" { m.hover = nil } }
            .help("Opens the Second Computer window")
          }
        }
        .padding(.leading, 38)
        .transition(.opacity.combined(with: .move(edge: .top)))
      }

      // Any stage (locked or signed out too): Open list, just below, works meanwhile once signed in.
      if let n = m.st.tabNotice {
        notice(n.text, n.button, n.action)
      } else if m.st.stage == .open && !m.st.tabOn {
        notice("Holding Tab does nothing while it is off", "Turn on", "tabOn")
      }

      HStack(spacing: 8) {
        switch m.st.stage {
        case .open, .opening:
          PopupButton(m: m, title: "Open list", id: "list", primary: true, disabled: m.st.stage == .opening)
          PopupButton(m: m, title: "Settings", id: "settings", disabled: m.st.stage == .opening)
        case .locked:
          PopupButton(m: m, title: "Use Touch ID", id: "touch", primary: true)
          PopupButton(m: m, title: "Passphrase", id: "signin")
        case .signedOut:
          PopupButton(m: m, title: "Sign in", id: "signin", primary: true)
        }
        Spacer(minLength: 6)
        PopupButton(m: m, title: m.quitArmed ? "Click again to quit" : "Quit \(AppName.current)", id: "quit", danger: m.quitArmed)
          .help("Quits \(AppName.current): the Tab list, cards and island stop until you open it again")
      }
      .padding(.leading, 38)
    }
    .padding(.horizontal, 16).padding(.top, 15).padding(.bottom, 16)
    .frame(width: PopupView.width, alignment: .leading)
    .background(
      ZStack {
        RoundedRectangle(cornerRadius: 22, style: .continuous)
          .fill(LinearGradient(colors: [Color(red: 0.14, green: 0.07, blue: 0.20), Color(red: 0.08, green: 0.04, blue: 0.10)], startPoint: .top, endPoint: .bottom))
        RoundedRectangle(cornerRadius: 22, style: .continuous)
          .fill(RadialGradient(colors: [pink.opacity(0.22), .clear], center: .topLeading, startRadius: 0, endRadius: 220))
        RoundedRectangle(cornerRadius: 22, style: .continuous)
          .fill(RadialGradient(colors: [violet.opacity(0.2), .clear], center: .topTrailing, startRadius: 0, endRadius: 200))
      }
    )
    .overlay(alignment: .bottom) {
      // How long until it fades: a pink line along the bottom that runs out (stops while the pointer is on it).
      GeometryReader { g in
        Capsule().fill(LinearGradient(colors: [violet, pink], startPoint: .leading, endPoint: .trailing))
          .frame(width: max(0, g.size.width * m.left), height: 2).opacity(m.left > 0 && m.left < 1 ? 0.75 : 0)
      }.frame(height: 2).padding(.horizontal, 22).padding(.bottom, 1)
    }
    .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Color(red: 0.77, green: 0.71, blue: 0.99).opacity(0.3), lineWidth: 1))
    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    .shadow(color: .black.opacity(0.55), radius: 22, y: 12)
    .shadow(color: violet.opacity(0.25), radius: 30)
    .onHover { m.viewHover($0) }
    .animation(.spring(response: 0.38, dampingFraction: 0.86), value: m.st.stage)
    .animation(.spring(response: 0.3, dampingFraction: 0.8), value: m.quitArmed)
    // In: drops a little and grows to size. Out: rises and fades.
    .opacity(m.visible ? 1 : 0)
    .scaleEffect(m.visible ? 1 : 0.94, anchor: .top)
    .offset(y: m.visible ? 0 : -14)
    .blur(radius: m.visible ? 0 : 4)
  }

  private func row(_ icon: String, _ text: String, _ tint: Color) -> some View {
    HStack(spacing: 8) {
      Image(systemName: icon).font(.system(size: 12, weight: .semibold)).foregroundColor(tint).frame(width: 16)
      Text(text).font(.system(size: 13, weight: .medium)).foregroundColor(.white.opacity(0.86)).lineLimit(1).truncationMode(.tail)
    }
  }
  private func notice(_ text: String, _ button: String?, _ action: String?) -> some View {
    HStack(spacing: 10) {
      Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 12)).foregroundColor(amber)
      Text(text).font(.system(size: 12.5, weight: .medium)).foregroundColor(.white.opacity(0.85)).fixedSize(horizontal: false, vertical: true)
      Spacer(minLength: 4)
      if let button, let action { PopupButton(m: m, title: button, id: action) }
    }
    .padding(.horizontal, 12).padding(.vertical, 8)
    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(amber.opacity(0.12)))
    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(amber.opacity(0.35), lineWidth: 1))
    .padding(.leading, 38)
  }
}

final class Popup {
  static let shared = Popup()
  let model = PopupModel()
  private(set) var panel: PopupPanel?
  private var host: PopupHost<PopupView>?
  private var monitors: [Any] = []
  private var fade: DispatchWorkItem?
  private var hideWork: DispatchWorkItem?
  private var quitWork: DispatchWorkItem?
  private static let testCopy = ProcessInfo.processInfo.environment["PS_SELFTEST"] != nil
  /// Button presses go to the app (main.swift): list, settings, quit, touch, signin, fix, tabOn.
  var onAction: (String) -> Void = { _ in }
  /// Opens the Second Computer window (set by that feature's own setup; the row shows only once it is set).
  var secondComputer: (() -> Void)? { didSet { let on = secondComputer != nil; update { $0.second = on } } }
  /// Its one line state, read each time the card shows (main thread, no I/O; "" hides it).
  var secondStatus: (() -> String)?
  /// The card went away (by itself, a click elsewhere or its x): main.swift hands the keyboard back.
  var onHidden: () -> Void = {}
  /// How long it stays (seconds) before fading, by stage. Signed out stays until a click elsewhere.
  var stayFor: (PopupState.Stage) -> Double? = { s in
    switch s { case .open: return 6; case .locked: return 10; case .opening, .signedOut: return nil }
  }
  /// After the pointer leaves the card, it stays this long more.
  var afterHover = 3.5
  var isShown: Bool { model.visible }

  private func setUp() {
    guard panel == nil else { return }
    model.act = { [weak self] a in self?.pressed(a) }
    let v = PopupView(m: model)
    let h = PopupHost(rootView: v)
    let p = PopupPanel(contentRect: NSRect(x: 0, y: 0, width: PopupView.width + 40, height: 220), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    p.isOpaque = false
    p.backgroundColor = .clear
    p.hasShadow = false                  // the card draws its own soft shadow
    p.level = .statusBar
    p.hidesOnDeactivate = false
    p.isReleasedWhenClosed = false
    p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle]
    p.contentView = h
    if Popup.testCopy { p.alphaValue = 0; p.ignoresMouseEvents = true }   // a test copy never shows or catches a click
    panel = p; host = h
  }

  /// New state from the app (stage, Tab, status). Resizes the card while it is up.
  func update(_ change: (inout PopupState) -> Void) {
    var s = model.st
    change(&s)
    guard s != model.st else { return }
    let problemNew = s.tabNotice != nil && s.tabNotice != model.st.tabNotice
    let stageChanged = s.stage != model.st.stage || s.tabNotice != model.st.tabNotice
    model.st = s
    if model.visible { place(); if stageChanged { armFade() } }
    // A Tab problem appeared (or changed): the card comes up and stays until it is fixed (V1.41). Even in Do Not
    // Disturb: without it Tab is dead with no word why. Never over 1Password or Signal (show() checks).
    if problemNew && !Popup.testCopy { show() }
  }

  /// asked: Tab was held for it (SafePeek, V1.44). Only then does it come up over 1Password or Signal: a nonactivating
  /// panel, so their keyboard stays theirs. Never by itself over them (golden rule).
  func show(asked: Bool = false) {
    if Protected.front && !asked { return }   // golden rule: never over 1Password or Signal unless Tab was held for it
    setUp()
    guard let panel else { return }
    hideWork?.cancel(); hideWork = nil
    model.quitArmed = false
    if let f = secondStatus { let line = String(f().prefix(60)); update { $0.secondLine = line } }
    place()
    panel.orderFrontRegardless()
    if !model.visible {
      withAnimation(.spring(response: 0.42, dampingFraction: 0.8)) { model.visible = true }
      if !Popup.testCopy { withAnimation(.easeOut(duration: 1.4).repeatForever(autoreverses: false)) { model.pulse = true } }
    }
    watchClicks()
    armFade()
  }

  /// giveBack: hand the keyboard back to the app the developer was in (not when the next step needs PS, eg Sign in).
  func hide(giveBack: Bool = true) {
    guard model.visible else { return }
    fade?.cancel(); fade = nil
    quitWork?.cancel(); model.quitArmed = false
    monitors.forEach { NSEvent.removeMonitor($0) }; monitors = []
    withAnimation(.easeIn(duration: 0.2)) { model.visible = false }
    var still = Transaction(); still.disablesAnimations = true
    withTransaction(still) { model.pulse = false; model.hover = nil }
    let w = DispatchWorkItem { [weak self] in
      guard let self, !self.model.visible else { return }
      self.panel?.orderOut(nil)
      self.model.left = 1
    }
    hideWork = w
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.26, execute: w)
    if giveBack { onHidden() }
  }

  func protectedChanged() { if Protected.front { hide() } }

  /// Top centre of the screen with the pointer, under the menu bar and clear of the Dynamic Island.
  private func place() {
    guard let panel, let host else { return }
    host.layoutSubtreeIfNeeded()
    let size = host.fittingSize
    let mouse = NSEvent.mouseLocation
    let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main ?? NSScreen.screens.first
    guard let s = screen else { return }
    let top = s.visibleFrame.maxY - 44
    let f = NSRect(x: (s.frame.midX - size.width / 2).rounded(), y: (top - size.height).rounded(), width: size.width, height: size.height)
    panel.setFrame(f, display: true)
  }

  /// Fades by itself after the stage's time; the pointer on it holds it, and leaving gives it 3.5 s more.
  private func armFade(_ seconds: Double? = nil) {
    fade?.cancel(); fade = nil
    var t = Transaction(); t.disablesAnimations = true
    withTransaction(t) { model.left = 1 }
    // While Tab has a problem the card stays until it is fixed (or closed); then it fades as usual.
    guard model.visible, !model.hovering, model.st.tabNotice == nil, let d = seconds ?? stayFor(model.st.stage) else { return }
    DispatchQueue.main.async { withAnimation(.linear(duration: d)) { self.model.left = 0 } }
    let w = DispatchWorkItem { [weak self] in self?.hide() }
    fade = w
    DispatchQueue.main.asyncAfter(deadline: .now() + d, execute: w)
  }
  func hoverChanged(_ on: Bool) {
    guard model.visible else { return }
    if on { fade?.cancel(); fade = nil; withAnimation(.easeOut(duration: 0.2)) { model.left = 1 } }
    else if stayFor(model.st.stage) != nil { armFade(afterHover) }
  }

  /// A click anywhere outside the card puts it away (other apps, the desktop, PS's own Tab list).
  private func watchClicks() {
    guard monitors.isEmpty else { return }
    if let g = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown], handler: { [weak self] _ in self?.clickedAway() }) { monitors.append(g) }
    if let l = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown], handler: { [weak self] e in
      if e.window !== self?.panel { self?.clickedAway() }
      return e
    }) { monitors.append(l) }
  }
  func clickedAway() { hide() }

  private func pressed(_ a: String) {
    switch a {
    case "close": hide()
    case "quit":
      // Two clicks, so a slip never stops PS (and with it the Tab list, the cards and the island).
      if model.quitArmed { onAction("quit"); return }
      model.quitArmed = true
      fade?.cancel(); fade = nil; withAnimation(.easeOut(duration: 0.2)) { model.left = 1 }
      quitWork?.cancel()
      let w = DispatchWorkItem { [weak self] in self?.model.quitArmed = false; self?.armFade(self?.afterHover ?? 3.5) }
      quitWork = w
      DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: w)
    default:
      hide(giveBack: a != "signin" && a != "second")
      onAction(a)
    }
  }
}

extension PopupModel {
  /// The hover hook (kept out of the view so the fade logic lives in Popup).
  func setHovering(_ on: Bool) { hovering = on; Popup.shared.hoverChanged(on) }
  /// From the card itself. A test copy's card is parked off screen, where SwiftUI still reports the real
  /// pointer: there only the test's own setHovering counts.
  func viewHover(_ on: Bool) { if ProcessInfo.processInfo.environment["PS_SELFTEST"] == nil { setHovering(on) } }
}
