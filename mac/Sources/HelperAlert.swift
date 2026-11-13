// The restart helper pop up (V1.49; the rules and the words are in HelperAlertCore.swift). PS's own panel in the
// middle of the screen, above the Tab list, that never activates PS and never takes the keyboard: Esc reaches it
// through the keyboard tap (TabWatch.handleLocked) while it is up. It reads AutoReboot (which asks macOS every
// minute, every 3 s while macOS waits for approval, after every wake and unlock, and again 15 s after a missed answer)
// and looks again every few seconds itself (cheap, main thread reads only, no I/O).
//
//  - Problem: "Your restart helper is off", why, three numbered steps, the fix button and Remind me in 1 hour.
//  - After the fix button: a small strip at the bottom of the screen ("Waiting for you to switch it on") so System
//    Settings stays clear. It closes by itself with "Restart helper is on" the moment the helper is back.
//  - V1.51: a helper macOS lists as on that does not answer is repaired by PS first (AutoReboot.repair, off and on);
//    the pop up waits for it and shows only when that did not help, with Try again under the reason.
//  - Gone at once when 1Password or Signal comes to the front, and back when neither is (golden rule). Never over
//    Sleep mode, Sentry mode or the lock screen. A self test copy never shows it.
import AppKit
import SwiftUI

final class HelperAlertPanel: NSPanel {
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}
final class HelperAlertHost<C: View>: NSHostingView<C> {
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }   // the first click on a button counts
}

final class HelperAlertModel: ObservableObject {
  enum Phase: Equatable { case problem, waiting, back }
  @Published var phase = Phase.problem
  @Published var visible = false
  @Published var text = HelperAlertCore.text(.notSetUp, app: "PS", autoReboot: true, sentry: true)
  @Published var backSub = ""
  @Published var error: String?
  @Published var busy = false
  @Published var hover: String?
  @Published var glow = false
  /// V1.51 Try again: its label ("Try again", "Try again in 25 s", "Restarting the helper") and whether it works now.
  @Published var retryLabel = HelperRepairCore.retry
  @Published var retryReady = true
  var act: (String) -> Void = { _ in }
}

private let haPink = Color(red: 0.93, green: 0.31, blue: 0.53)
private let haPinkLight = Color(red: 0.96, green: 0.45, blue: 0.66)
private let haViolet = Color(red: 0.55, green: 0.36, blue: 0.96)
private let haGreen = Color(red: 0.36, green: 0.80, blue: 0.60)
private let haAmber = Color(red: 0.96, green: 0.68, blue: 0.30)
private let haRed = Color(red: 0.96, green: 0.42, blue: 0.42)

struct HelperAlertButton: View {
  @ObservedObject var m: HelperAlertModel
  let title: String
  let id: String
  var primary = false
  var hover: Bool { m.hover == id && !m.busy }
  var body: some View {
    Button { if !m.busy { m.act(id) } } label: {
      Text(title)
        .font(.system(size: 13.5, weight: .semibold)).lineLimit(1).fixedSize()
        .foregroundColor(.white.opacity(primary ? 1 : 0.9))
        .padding(.horizontal, 16).frame(height: 34)
        .background(
          ZStack {
            Capsule().fill(Color.white.opacity(primary ? 0.3 : 0.16))
            Capsule().fill(primary ? AnyShapeStyle(LinearGradient(colors: [haPinkLight, haPink], startPoint: .top, endPoint: .bottom))
                           : AnyShapeStyle(Color(red: 0.2, green: 0.13, blue: 0.24).opacity(hover ? 0.7 : 1)))
              .padding(1)
          }
        )
        .contentShape(Capsule())
        .shadow(color: primary ? haPink.opacity(0.45) : .clear, radius: primary ? 10 : 0, y: primary ? 4 : 0)
        .scaleEffect(hover ? 1.03 : 1)
        .opacity(m.busy && primary ? 0.6 : 1)
        .animation(.spring(response: 0.25, dampingFraction: 0.7), value: hover)
    }
    .buttonStyle(.plain)
    .focusable(false)
    .onHover { on in if on { m.hover = id } else if m.hover == id { m.hover = nil } }
  }
}

struct HelperAlertView: View {
  @ObservedObject var m: HelperAlertModel
  static let width: CGFloat = 440

  var body: some View {
    Group {
      switch m.phase {
      case .problem: problem
      case .waiting: waiting
      case .back: back
      }
    }
    .padding(24)   // room for the shadow
    .fixedSize()
  }

  private func card<C: View>(_ width: CGFloat?, tint: Color, @ViewBuilder _ content: () -> C) -> some View {
    content()
      .frame(width: width, alignment: .leading)
      .background(
        ZStack {
          RoundedRectangle(cornerRadius: 22, style: .continuous)
            .fill(LinearGradient(colors: [Color(red: 0.15, green: 0.07, blue: 0.20), Color(red: 0.08, green: 0.04, blue: 0.10)], startPoint: .top, endPoint: .bottom))
          RoundedRectangle(cornerRadius: 22, style: .continuous)
            .fill(RadialGradient(colors: [tint.opacity(0.24), .clear], center: .topLeading, startRadius: 0, endRadius: 240))
          RoundedRectangle(cornerRadius: 22, style: .continuous)
            .fill(RadialGradient(colors: [haViolet.opacity(0.18), .clear], center: .topTrailing, startRadius: 0, endRadius: 220))
        }
      )
      .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(tint.opacity(0.4), lineWidth: 1))
      .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
      .shadow(color: .black.opacity(0.55), radius: 22, y: 12)
      .shadow(color: tint.opacity(0.22), radius: 30)
      // In: grows to size from a little smaller and drops into place. Out: shrinks a touch and fades.
      .opacity(m.visible ? 1 : 0)
      .scaleEffect(m.visible ? 1 : 0.92)
      .offset(y: m.visible ? 0 : -10)
      .blur(radius: m.visible ? 0 : 3)
  }

  private var closeButton: some View {
    Button { m.act("close") } label: {
      Image(systemName: "xmark").font(.system(size: 10, weight: .bold)).foregroundColor(.white.opacity(m.hover == "close" ? 0.9 : 0.6))
        .frame(width: 22, height: 22).background(Circle().fill(Color.white.opacity(m.hover == "close" ? 0.16 : 0.08)))
    }
    .buttonStyle(.plain).focusable(false).help("Close (Esc). It comes back while the helper is off.")
    .onHover { on in if on { m.hover = "close" } else if m.hover == "close" { m.hover = nil } }
  }

  /// V1.51: Try again, small, under the reason (PS repairs the helper once more: off and on).
  private var retryButton: some View {
    let hot = m.hover == "retry" && m.retryReady
    return Button { if m.retryReady { m.act("retry") } } label: {
      HStack(spacing: 6) {
        if m.retryLabel == HelperRepairCore.retrying {
          ProgressView().controlSize(.small).progressViewStyle(.circular).tint(.white).scaleEffect(0.6).frame(width: 12, height: 12)
        } else {
          Image(systemName: "arrow.clockwise").font(.system(size: 10.5, weight: .bold))
        }
        Text(m.retryLabel).font(.system(size: 12, weight: .semibold)).lineLimit(1).fixedSize()
      }
      .foregroundColor(.white.opacity(m.retryReady ? 0.92 : 0.55))
      .padding(.horizontal, 11).frame(height: 26)
      .background(Capsule().fill(Color.white.opacity(hot ? 0.2 : 0.11)))
      .overlay(Capsule().stroke(Color.white.opacity(0.14), lineWidth: 1))
      .contentShape(Capsule())
      .scaleEffect(hot ? 1.03 : 1)
      .animation(.spring(response: 0.25, dampingFraction: 0.7), value: hot)
    }
    .buttonStyle(.plain).focusable(false)
    .help("Switches the restart helper off and on again for you")
    .onHover { on in if on { m.hover = "retry" } else if m.hover == "retry" { m.hover = nil } }
  }

  private var badge: some View {
    ZStack {
      Circle().fill(haAmber.opacity(0.16)).frame(width: 44, height: 44)
      Circle().stroke(haAmber.opacity(0.6), lineWidth: 2).frame(width: 44, height: 44)
        .scaleEffect(m.glow ? 1.35 : 1).opacity(m.glow ? 0 : 0.8)
      Image(systemName: "exclamationmark.shield.fill").font(.system(size: 21, weight: .semibold)).foregroundColor(haAmber)
    }
    .frame(width: 44, height: 44)
  }

  private var problem: some View {
    card(HelperAlertView.width, tint: haAmber) {
      VStack(alignment: .leading, spacing: 16) {
        HStack(alignment: .top, spacing: 14) {
          badge
          VStack(alignment: .leading, spacing: 5) {
            Text(m.text.title).font(.system(size: 19, weight: .bold)).foregroundColor(.white)
            Text(m.text.line).font(.system(size: 13.5, weight: .medium)).foregroundColor(.white.opacity(0.78))
              .fixedSize(horizontal: false, vertical: true)
            Text(m.error ?? m.text.reason).font(.system(size: 12.5, weight: .semibold))
              .foregroundColor(m.error == nil ? haAmber : haRed).fixedSize(horizontal: false, vertical: true)
            if m.text.retry { retryButton.padding(.top, 3) }
          }
          Spacer(minLength: 2)
          closeButton
        }
        VStack(alignment: .leading, spacing: 9) {
          ForEach(Array(m.text.steps.enumerated()), id: \.offset) { i, s in
            HStack(alignment: .firstTextBaseline, spacing: 10) {
              Text("\(i + 1)").font(.system(size: 11.5, weight: .bold)).foregroundColor(.white)
                .frame(width: 20, height: 20).background(Circle().fill(haPink.opacity(0.55)))
              Text(s).font(.system(size: 13, weight: .medium)).foregroundColor(.white.opacity(0.88))
                .fixedSize(horizontal: false, vertical: true)
            }
          }
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(0.05)))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Color.white.opacity(0.08), lineWidth: 1))
        HStack(spacing: 10) {
          HelperAlertButton(m: m, title: m.text.button, id: "fix", primary: true)
          HelperAlertButton(m: m, title: m.text.later, id: "later")
          Spacer(minLength: 0)
        }
      }
      .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 20)
    }
  }

  private var waiting: some View {
    card(nil, tint: haViolet) {
      HStack(spacing: 12) {
        ProgressView().controlSize(.small).progressViewStyle(.circular).tint(.white).scaleEffect(0.8).frame(width: 18, height: 18)
        VStack(alignment: .leading, spacing: 3) {
          Text(HelperAlertCore.waitingNote).font(.system(size: 13.5, weight: .semibold)).foregroundColor(.white)
          Text(m.text.steps.dropFirst().joined(separator: "  ")).font(.system(size: 12.5, weight: .medium)).foregroundColor(.white.opacity(0.7))
        }
        .frame(maxWidth: 480, alignment: .leading).fixedSize(horizontal: false, vertical: true)   // V1.52: the longer words wrap
        Spacer(minLength: 8)
        closeButton
      }
      .padding(.horizontal, 16).padding(.vertical, 12)
    }
  }

  private var back: some View {
    card(nil, tint: haGreen) {
      HStack(spacing: 12) {
        Image(systemName: "checkmark.circle.fill").font(.system(size: 22, weight: .semibold)).foregroundColor(haGreen)
          .shadow(color: haGreen.opacity(0.7), radius: 8)
        VStack(alignment: .leading, spacing: 2) {
          Text(HelperAlertCore.backOn).font(.system(size: 14.5, weight: .bold)).foregroundColor(.white)
          Text(m.backSub).font(.system(size: 12.5, weight: .medium)).foregroundColor(.white.opacity(0.7))
        }
      }
      .padding(.horizontal, 18).padding(.vertical, 13)
      .contentShape(Rectangle())
      .onTapGesture { m.act("close") }   // a click closes it (it also fades by itself after 3 s, and on Esc)
      .help("Click to close")
    }
  }
}

final class HelperAlert {
  static let shared = HelperAlert()
  let model = HelperAlertModel()
  private var panel: HelperAlertPanel?
  private var host: HelperAlertHost<HelperAlertView>?
  private var timer: Timer?
  private var started = false
  private let defaults = UserDefaults.standard
  /// The problem last seen (nil: the helper is fine), and the step last logged.
  private var lastProblem: HelperProblem?
  private var lastLog = ""
  /// When the main button was last clicked (the "Restart helper is on" confirmation still shows within 15 minutes).
  private var fixedAt: Date?
  private var memo = HelperAlertMemo()
  /// The confirmation's life: once per stretch of being off, gone after 3 s (HelperAlertCore.swift).
  private var backOn = HelperBackOn()
  /// Every show and hide takes a new number: a cross fade, a timer or a removal from an older one does nothing.
  /// (The stuck confirmation: a hide landed during the 0.18 s cross fade, cancelled the 3 s timer, and the late
  /// swap showed it with nothing left to take it away.)
  private var gen = 0
  /// The phase being shown or about to be (nil: hidden or hiding).
  private var target: HelperAlertModel.Phase?
  /// When the panel was last told to go (the backstop removes a panel still on screen after that).
  private var hiddenAt: Date?

  // Esc from the keyboard tap's thread (TabWatch.handleLocked): true while the panel is on screen.
  private static let upLock = NSLock()
  private static var upFlag = false
  static var upNow: Bool { upLock.lock(); defer { upLock.unlock() }; return upFlag }
  private static func markUp(_ v: Bool) { upLock.lock(); upFlag = v; upLock.unlock() }

  /// Sentry mode's restart if not unlocked, in hours (0 Off). Only the page knows it ({type:"sentryPrefs"},
  /// web src/sentryprefs.ts); kept here so it holds while the vault is locked. 8 (the default) until told.
  private(set) var sentryRestartH: Int {
    get { defaults.object(forKey: "helperAlert.sentryRestartH") == nil ? 8 : max(0, defaults.integer(forKey: "helperAlert.sentryRestartH")) }
    set { defaults.set(newValue, forKey: "helperAlert.sentryRestartH") }
  }
  /// Security, "Remind me to set up the restart helper" (HelperAlertCore.remindOn): Off, this pop up never shows.
  var remind: Bool { HelperAlertCore.remindOn(defaults.object(forKey: HelperAlertCore.remindKey)) }
  func setRemind(_ on: Bool) {
    guard on != remind || defaults.object(forKey: HelperAlertCore.remindKey) == nil else { return }
    defaults.set(on, forKey: HelperAlertCore.remindKey)
    psLog("PS helper alert: Remind me to set up the restart helper is \(on ? "On" : "Off")")
    evaluate()
  }
  func setSentryRestart(_ h: Int) {
    guard (0...168).contains(h), h != sentryRestartH || defaults.object(forKey: "helperAlert.sentryRestartH") == nil else { return }
    sentryRestartH = h
    psLog("PS helper alert: Sentry mode's restart if not unlocked is \(h == 0 ? "Off" : "\(h) h")")
    evaluate()
  }

  func start() {
    guard !IS_TEST_COPY, !started else { return }
    started = true
    let s = defaults.double(forKey: "helperAlert.snoozeUntil")
    if s > Date().timeIntervalSince1970 { memo.snoozeUntil = s }
    AutoReboot.shared.observe { [weak self] in self?.evaluate() }
    // Cheap looks (no I/O): the end of a snooze or a quiet time, Sleep mode or Sentry mode ending, the lock screen
    // going, and the backstop for the panel itself.
    timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.tick() }
    DistributedNotificationCenter.default().addObserver(forName: .init("com.apple.screenIsUnlocked"), object: nil, queue: .main) { [weak self] _ in
      DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self?.evaluate() }
    }
    evaluate()
  }

  /// 1Password or Signal came to the front (or went): gone at once, back when neither is.
  func protectedChanged() { evaluate() }

  private var ticks = 0
  private func tick() {
    let now = Date().timeIntervalSince1970
    // The confirmation fades by itself after 3 s; the backstop takes it away at 6 s whatever happened.
    if target == .back && (backOn.due(now) || backOn.overdue(now)) {
      if backOn.overdue(now) { psLog("PS helper alert: the confirmation was still up, taking it away") }
      hide()
    }
    // ScreenGuard rule: nothing to show, yet the panel is still on screen (an animation that never finished): remove it.
    if HelperAlertCore.staleWindow(onScreen: panel?.isVisible == true, shouldShow: target != nil, hiddenFor: hiddenAt.map { Date().timeIntervalSince($0) }) {
      psLog("PS helper alert: a hidden panel was still on screen, removed")
      remove()
    }
    if target == .problem && model.text.retry { updateRetry() }   // V1.51: Try again's wait counts down by the second
    ticks += 1
    if ticks % 5 == 0 { evaluate() }
  }

  private func covered() -> String? {
    if Sentry.shared.isUp { return "Sentry mode is up" }
    if SleepScreen.shared.isUp { return "Sleep mode is up" }
    if RemoteCommand.screenLocked() { return "the Mac is locked" }
    return nil
  }

  func evaluate() {
    guard started else { return }
    let ar = AutoReboot.shared
    let facts = HelperFacts(state: ar.helperState, offBy: ar.offBy, failures: ar.failures,
                            safeMode: (ar.helper["safeMode"] as? Bool) == true, pinOK: ar.pinOK, repair: ar.repairResult)
    let p = HelperAlertCore.problem(facts)
    let autoOn = ar.mode != "off", sentryOn = sentryRestartH > 0
    let now = Date().timeIntervalSince1970
    let wasProblem = lastProblem != nil
    lastProblem = p
    if p != nil && !wasProblem { backOn.wentOff() }
    if p == nil && wasProblem {
      let fixedAgo = fixedAt.map { Date().timeIntervalSince($0) }
      let up = target == .problem || target == .waiting
      let wanted = HelperAlertCore.confirmBack(wasProblem: true, nowProblem: false, up: up, fixedAgo: fixedAgo)
        && HelperAlertCore.wanted(mode: ar.mode, sentryRestartH: sentryRestartH) && covered() == nil && !Protected.front
      memo = HelperAlertCore.cleared(memo); saveSnooze(); fixedAt = nil
      lastLog = ""
      // Only after a real off to on, and only once for it (never again for the same on state).
      if wanted && backOn.claim() {
        psLog("PS helper alert: the restart helper is on again, saying so")
        showBack(autoOn: autoOn, sentryOn: sentryOn)
      } else {
        psLog("PS helper alert: the restart helper is on again")
        hide()
      }
      return
    }
    updateRetry()
    // V1.51: Try again pressed with the pop up up: it stays, its Try again busy, until the repair has an answer.
    if ar.repairing && target == .problem && !Protected.front && covered() == nil { return }
    let step = HelperAlertCore.step(problem: p, wanted: HelperAlertCore.wanted(mode: ar.mode, sentryRestartH: sentryRestartH), now: now,
                                    memo: memo, protectedFront: Protected.front, covered: covered(), testCopy: IS_TEST_COPY,
                                    repairing: ar.repairing, remind: remind)
    let line: String
    switch step {
    case .show(let p): line = "showing (\(p.rawValue))"
    case .wait(let why): line = "\(p?.rawValue ?? "") waits: \(why)"
    case .hide(let why): line = p.map { "\($0.rawValue), not shown: \(why)" } ?? ""
    }
    if line != lastLog { if !line.isEmpty { psLog("PS helper alert: \(line)") }; lastLog = line }
    switch step {
    case .show(let p):
      let t = HelperAlertCore.text(p, app: AppName.current, autoReboot: autoOn, sentry: sentryOn, repaired: ar.repairs > 0)
      if target == .waiting { if model.text.steps != t.steps { model.text = t }; return }   // still waiting for System Settings
      present(.problem) { if self.model.text != t { self.model.error = nil }; self.model.text = t }
    case .wait, .hide:
      // The confirmation runs out by itself (tick); anything else goes now.
      if target != .back { hide() }
    }
  }

  /// V1.51: Try again's label and whether it works now (it waits longer after each repair; HelperRepairCore).
  private func updateRetry() {
    let left = AutoReboot.shared.repairWaitLeft
    let label = HelperRepairCore.retryLabel(waitLeft: left)
    if model.retryLabel != label { model.retryLabel = label }
    if model.retryReady != (left == 0) { model.retryReady = left == 0 }
  }

  // MARK: buttons and Esc

  private func pressed(_ a: String) {
    let now = Date().timeIntervalSince1970
    switch a {
    case "close":
      if target == .back || model.phase == .back { hide(); return }   // the confirmation: just gone
      psLog("PS helper alert: closed, back on the next check")
      memo = HelperAlertCore.closed(memo, now: now); hide()
    case "later":
      psLog("PS helper alert: Remind me in 1 hour")
      memo = HelperAlertCore.later(memo, now: now); saveSnooze(); hide()
    case "retry":
      // V1.51: PS switches the helper off and on again itself (AutoReboot.repair); the pop up stays with Try again busy.
      psLog("PS helper alert: Try again")
      if AutoReboot.shared.repair(manual: true) { fixedAt = Date(); model.error = nil }
      updateRetry()
    case "fix":
      guard let p = lastProblem else { hide(); return }
      fixedAt = Date()
      switch HelperAlertCore.action(p) {
      case "setup":
        psLog("PS helper alert: \(model.text.button)")
        model.busy = true
        AutoReboot.shared.setUp { [weak self] err in
          guard let self else { return }
          self.model.busy = false
          if let err { self.model.error = err; psLog("PS helper alert: set up: \(err)"); return }
          if self.lastProblem != nil && self.target != nil { self.present(.waiting) {} }
          self.evaluate()
        }
      case "settings":
        AutoReboot.shared.openLoginItems()
        present(.waiting) {}
      default:   // a helper that fails its signature check: only a fresh copy of PS fixes it
        psLog("PS helper alert: Check for Updates")
        memo = HelperAlertCore.closed(memo, now: now); hide()
        Updater.shared.checkNow(manual: true)
      }
    default: break
    }
  }

  /// Esc (TabWatch's tap, App.escKey): closes it (the problem until the next check). True when it was up.
  func escape() -> Bool {
    guard target != nil || model.visible || panel?.isVisible == true else { return false }
    if target == nil { remove(); return true }
    pressed("close")
    return true
  }

  // MARK: the panel

  private func setUpPanel() {
    guard panel == nil else { return }
    model.act = { [weak self] a in self?.pressed(a) }
    let h = HelperAlertHost(rootView: HelperAlertView(m: model))
    let p = HelperAlertPanel(contentRect: NSRect(x: 0, y: 0, width: HelperAlertView.width + 48, height: 300), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    p.isOpaque = false
    p.backgroundColor = .clear
    p.hasShadow = false                       // the card draws its own soft shadow
    p.level = NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue + 1)   // above the Tab list (statusBar)
    p.hidesOnDeactivate = false
    p.isReleasedWhenClosed = false
    p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
    p.contentView = h
    panel = p; host = h
  }

  /// Shows `phase` (the content set by `change`). Already up in another phase: it fades out, moves and comes back in.
  private func present(_ phase: HelperAlertModel.Phase, _ change: @escaping () -> Void) {
    if target == phase && model.visible { change(); place(); return }
    gen += 1
    let g = gen
    target = phase
    hiddenAt = nil
    if phase != .back { backOn.gone() }
    let swap = { [weak self] in
      guard let self, g == self.gen else { return }   // a later show or hide won
      self.setUpPanel()
      guard let panel = self.panel else { return }
      var still = Transaction(); still.disablesAnimations = true
      withTransaction(still) { change(); self.model.phase = phase; self.model.hover = nil }
      self.place()
      panel.orderFrontRegardless()
      HelperAlert.markUp(true)
      if phase == .back { self.backOn.appeared(Date().timeIntervalSince1970) }   // its 3 s start now, on screen
      withAnimation(.spring(response: 0.45, dampingFraction: 0.78)) { self.model.visible = true }
      if phase == .problem {
        var t = Transaction(); t.disablesAnimations = true
        withTransaction(t) { self.model.glow = false }
        withAnimation(.easeOut(duration: 1.6).repeatForever(autoreverses: false)) { self.model.glow = true }
      }
    }
    if model.visible {
      withAnimation(.easeIn(duration: 0.16)) { model.visible = false }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) { swap() }
    } else { swap() }
  }

  private func showBack(autoOn: Bool, sentryOn: Bool) {
    present(.back) { self.model.backSub = HelperAlertCore.backOnSub(autoReboot: autoOn, sentry: sentryOn); self.model.error = nil }
  }

  /// Fades out, then the window is removed (closed and let go, so nothing invisible stays on screen). Safe to call at
  /// any time: it also cancels a show still in its cross fade.
  func hide() {
    let wasShowing = target != nil || model.visible || panel?.isVisible == true
    gen += 1
    let g = gen
    target = nil
    backOn.gone()
    HelperAlert.markUp(false)
    guard wasShowing else { return }
    hiddenAt = Date()
    withAnimation(.easeIn(duration: 0.22)) { model.visible = false }
    var still = Transaction(); still.disablesAnimations = true
    withTransaction(still) { model.hover = nil; model.glow = false }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.26) { [weak self] in
      guard let self, g == self.gen else { return }   // shown again meanwhile
      self.remove()
    }
  }

  /// The window goes for good (a new one is made on the next show).
  private func remove() {
    IslandColumn.shared.leave("helper")
    target = nil
    HelperAlert.markUp(false)
    var still = Transaction(); still.disablesAnimations = true
    withTransaction(still) { model.visible = false; model.hover = nil; model.glow = false; model.busy = false }
    panel?.orderOut(nil)
    panel?.close()
    panel?.contentView = nil
    panel = nil; host = nil
    hiddenAt = nil
  }

  /// The problem: the middle of the screen with the pointer, a little above centre. Waiting and back on: the bottom
  /// middle, clear of System Settings.
  private func place() {
    guard let panel, let host else { return }
    host.layoutSubtreeIfNeeded()
    let size = host.fittingSize
    let mouse = NSEvent.mouseLocation
    guard let s = NSScreen.screens.first(where: { NSMouseInRect(mouse, $0.frame, false) }) ?? NSScreen.main ?? NSScreen.screens.first else { return }
    // V1.55: the problem comes out of the Dynamic Island while it is there and the developer left this alert on Island
    // (IslandColumn.swift). "Waiting for you to switch it on" stays at the bottom, clear of System Settings.
    if model.phase == .problem, let f = IslandColumn.shared.frame(id: "helper", kind: "helper", size: size, window: panel,
                                                                 replace: { [weak self] in if self?.panel?.isVisible == true { self?.place() } }) {
      IslandColumn.shared.put(panel, f)
      return
    }
    IslandColumn.shared.leave("helper")
    let v = s.visibleFrame
    let y: CGFloat = model.phase == .problem ? v.minY + v.height * 0.58 - size.height / 2 : v.minY + 28
    panel.setFrame(NSRect(x: (v.midX - size.width / 2).rounded(), y: max(v.minY, y.rounded()), width: size.width, height: size.height), display: true)
  }

  private func saveSnooze() { defaults.set(memo.snoozeUntil, forKey: "helperAlert.snoozeUntil") }
}
