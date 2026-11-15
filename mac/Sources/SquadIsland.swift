import AppKit
import AVFoundation
import SwiftUI

// G Squad messages on the Dynamic Island (PS 1.63, feature "gsquad-island-reply"), the part on screen. The rules are in
// SquadIslandCore.swift (tested in tests/squad-island-test.sh); this draws them.
//
// The page sends a G Squad message as a card of tone "squad" (src/core/squadnotify.ts). Toast.showMeet offers it here first
// (`take`). When the island is on and the person's switch ("Show messages on the island") is on, it comes out of the island like
// an Apple Watch notification: a tiny squeeze, then a dark card in the island's own black, attached to it, with the sender, the
// words, and the pills Reply and Dismiss. Reply grows it into a small box with quick replies. Otherwise `take` says no and the
// old card in the top right does what it always did.
//
// Never in the way: the panel takes no keyboard and no focus until the person clicks Reply (then only for the box, and it hands
// the keyboard back); it never shows over 1Password or Signal where the island is not allowed there, and never lets the box take
// the keyboard from them (rule 7); Esc always steps back (box, then card, then gone); it uses the shared island queue
// (IslandQueue) so it is never on top of another card; Reduce Motion gets a plain fade; nothing is sent without the person's own
// click or Return and the short Undo. The sound is the page's (the same "Sound" switch and Do Not Disturb rules as the corner
// card), so a message never chimes twice.

// MARK: - the model

final class SquadIslandModel: ObservableObject {
  @Published var state: SquadReplyState = .closed
  @Published var item: SquadItem?
  /// The shape has grown from the island's size to its own size.
  @Published var open = false
  /// The words are in.
  @Published var inside = false
  @Published var islandSize = CGSize(width: 200, height: 34)
  @Published var hover: String?            // the button under the pointer (no @State: built without SwiftUI's macros)
  @Published var over = false              // the pointer is on the card
  @Published var draft = ""
  @Published var undoLeft = 0
  @Published var tickDraw: CGFloat = 0
  @Published var focusToken = 0
  var reduce: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
  var canCompose = true
  var act: (SquadReplyEvent) -> Void = { _ in }

  var shape: CGSize {
    let h = islandSize.height
    guard open, let it = item else { return islandSize }
    return CGSize(width: SquadIslandCore.cardW, height: h + SquadIslandCore.bodyHeight(state, item: it))
  }
  var radius: CGFloat { open ? 28 : 18 }
}

// MARK: - the text box (an AppKit field: Return sends, the box owns the keyboard only while the person types)

struct SquadField: NSViewRepresentable {
  @ObservedObject var m: SquadIslandModel
  func makeNSView(context: Context) -> NSTextField {
    let f = NSTextField()
    f.isBordered = false; f.drawsBackground = false; f.focusRingType = .none
    f.font = .systemFont(ofSize: 13.5)
    f.textColor = .white
    f.placeholderAttributedString = NSAttributedString(string: "Reply to the squad", attributes: [.foregroundColor: NSColor.white.withAlphaComponent(0.4), .font: NSFont.systemFont(ofSize: 13.5)])
    f.cell?.usesSingleLineMode = true
    f.cell?.isScrollable = true
    f.delegate = context.coordinator
    f.setAccessibilityLabel("Reply to the squad")
    return f
  }
  func updateNSView(_ f: NSTextField, context: Context) {
    if f.stringValue != m.draft { f.stringValue = m.draft }
    if context.coordinator.token != m.focusToken {
      context.coordinator.token = m.focusToken
      DispatchQueue.main.async { if f.window?.canBecomeKey == true { f.window?.makeFirstResponder(f); f.currentEditor()?.selectedRange = NSRange(location: f.stringValue.count, length: 0) } }
    }
  }
  func makeCoordinator() -> Coord { Coord(m) }
  final class Coord: NSObject, NSTextFieldDelegate {
    let m: SquadIslandModel
    var token = -1
    init(_ m: SquadIslandModel) { self.m = m }
    func controlTextDidChange(_ n: Notification) {
      guard let f = n.object as? NSTextField else { return }
      m.draft = f.stringValue
      m.act(.type(f.stringValue))
    }
    func control(_ c: NSControl, textView: NSTextView, doCommandBy sel: Selector) -> Bool {
      if sel == #selector(NSResponder.insertNewline(_:)) { m.act(.send); return true }
      return false   // Esc is handled by the panel's key monitor (one step back), never here, so it never counts twice
    }
  }
}

// MARK: - the view

struct SquadIslandView: View {
  @ObservedObject var m: SquadIslandModel
  static let pad: CGFloat = 20
  static func window(_ islandH: CGFloat) -> CGSize {
    // Big enough for the tallest state, so the window never has to change while the shape moves.
    let tall = [SquadReplyState.card, .composing(""), .undo(text: "", until: Date()), .failed(text: "", why: "")]
    let item = SquadItem(chat: "g", msgs: [SquadMsg(id: "g:x", chat: "g", name: "x", group: nil, text: String(repeating: "x", count: 400), at: "")])
    let h = tall.map { SquadIslandCore.bodyHeight($0, item: item) }.max() ?? 160
    return CGSize(width: SquadIslandCore.cardW + 2 * pad, height: islandH + h + 2 * pad)
  }

  var body: some View {
    ZStack(alignment: .top) {
      Color.clear
      HangShape(bottom: m.radius).fill(Color.black)
        .frame(width: m.shape.width, height: m.shape.height)
        .shadow(color: Color.black.opacity(m.open ? 0.4 : 0), radius: 14, y: 6)
        .overlay(alignment: .top) { content.frame(width: m.shape.width, height: m.shape.height, alignment: .top).clipShape(HangShape(bottom: m.radius)) }
    }
    .frame(width: SquadIslandView.window(m.islandSize.height).width, height: SquadIslandView.window(m.islandSize.height).height, alignment: .top)
    .environment(\.colorScheme, .dark)
    .onHover { h in m.over = h }
  }

  @ViewBuilder private var content: some View {
    if m.open, let it = m.item {
      VStack(spacing: 0) {
        Color.clear.frame(height: m.islandSize.height)
        Group {
          switch m.state {
          case .closed: EmptyView()
          case .card: card(it)
          case .composing: composer(it)
          case .undo(_, _): undo(it)
          case .sending(_, _): undo(it)
          case .sent: sent
          case .failed(_, let why): failed(it, why)
          }
        }
        .padding(.horizontal, SquadIslandCore.pad)
        .padding(.top, SquadIslandCore.pad)
        Spacer(minLength: 0)
      }
      .opacity(m.inside ? 1 : 0)
      .offset(y: m.inside ? 0 : -6)
      .accessibilityElement(children: .contain)
    }
  }

  // The round picture or initial, the name, the group.
  private func head(_ it: SquadItem, replying: Bool) -> some View {
    HStack(alignment: .center, spacing: 10) {
      ZStack {
        Circle().fill(Color(hue: SquadIslandCore.hue(it.newest.name), saturation: 0.55, brightness: 0.62))
        Text(SquadIslandCore.initial(it.newest.name)).font(.system(size: 16, weight: .bold, design: .rounded)).foregroundColor(.white)
      }
      .frame(width: 34, height: 34)
      VStack(alignment: .leading, spacing: 1) {
        Text(replying ? "Reply to \(SquadIslandCore.firstName(it.newest.name))" : SquadIslandCore.title(it))
          .font(.system(size: 14.5, weight: .semibold, design: .rounded)).foregroundColor(.white).lineLimit(1)
        Text(SquadIslandCore.sub(it)).font(.system(size: 11.5, weight: .medium, design: .rounded)).foregroundColor(Color.white.opacity(0.55)).lineLimit(1)
      }
      Spacer(minLength: 0)
    }
    .frame(height: 34)
  }

  private func pill(_ title: String, key: String, strong: Bool = false, tint: Color? = nil, _ action: @escaping () -> Void) -> some View {
    let fg: Color = strong ? .black : .white
    let hov = m.hover == key
    let fill: Color = strong ? (tint ?? .white).opacity(hov ? 0.85 : 1) : Color.white.opacity(hov ? 0.24 : 0.14)
    return Button(action: action) {
      Text(title).font(.system(size: 13, weight: .semibold, design: .rounded)).foregroundColor(fg)
        .frame(maxWidth: .infinity).frame(height: 32)
        .background(Capsule().fill(fill))
        .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .onHover { h in withAnimation(.easeOut(duration: 0.12)) { m.hover = h ? key : (m.hover == key ? nil : m.hover) } }
    .accessibilityLabel(title)
  }

  private func card(_ it: SquadItem) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      head(it, replying: false)
      Button(action: { m.act(.open) }) {
        VStack(alignment: .leading, spacing: 3) {
          Text(SquadIslandCore.body(it)).font(.system(size: 13.5)).foregroundColor(Color.white.opacity(0.92))
            .lineLimit(SquadIslandCore.maxLines).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
          if SquadIslandCore.hasMore(SquadIslandCore.body(it)) { Text("more").font(.system(size: 12, weight: .semibold, design: .rounded)).foregroundColor(Color.white.opacity(0.5)) }
        }
        .frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Open the chat")
      Spacer(minLength: 4)
      HStack(spacing: 8) {
        pill(m.canCompose ? "Reply" : "Open", key: "reply", strong: true) { m.act(m.canCompose ? .openReply : .open) }
        pill("Dismiss", key: "dismiss") { m.act(.dismiss) }
      }
    }
  }

  private func composer(_ it: SquadItem) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      head(it, replying: true)
      SquadField(m: m)
        .frame(height: 22).padding(.horizontal, 12).padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(0.12)))
      HStack(spacing: 6) {
        ForEach(Array(SquadIslandCore.quickReplies.enumerated()), id: \.offset) { i, t in
          Button(action: { m.act(.quick(i)) }) {
            Text(t).font(.system(size: 12.5, weight: .medium, design: .rounded)).foregroundColor(.white)
              .padding(.horizontal, 11).frame(height: 28)
              .background(Capsule().fill(Color.white.opacity(m.hover == "q\(i)" ? 0.24 : 0.14)))
              .contentShape(Capsule())
          }
          .buttonStyle(.plain)
          .onHover { h in withAnimation(.easeOut(duration: 0.12)) { m.hover = h ? "q\(i)" : (m.hover == "q\(i)" ? nil : m.hover) } }
          .accessibilityLabel("Quick reply \(t)")
        }
        Spacer(minLength: 0)
        Button(action: { m.act(.send) }) {
          Text("Send").font(.system(size: 12.5, weight: .bold, design: .rounded)).foregroundColor(.black)
            .padding(.horizontal, 16).frame(height: 28)
            .background(Capsule().fill(Color(red: 0.3, green: 0.85, blue: 0.7).opacity(SquadIslandCore.cleanReply(m.draft) == nil ? 0.35 : 1)))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Send")
      }
    }
  }

  private func undo(_ it: SquadItem) -> some View {
    var sending = false
    if case .sending = m.state { sending = true }
    return VStack(alignment: .leading, spacing: 8) {
      head(it, replying: true)
      HStack(spacing: 10) {
        Text(sending ? "Sending" : "Sending in \(m.undoLeft)").font(.system(size: 13, weight: .medium, design: .rounded)).foregroundColor(Color.white.opacity(0.75))
        Spacer(minLength: 0)
        if !sending { pill("Undo", key: "undo") { m.act(.undo) }.frame(width: 110) }
      }
      .frame(height: 38)
    }
  }

  private var sent: some View {
    HStack(spacing: 10) {
      SetupTickMark(size: 34, draw: m.tickDraw)
      Text("Sent").font(.system(size: 16, weight: .bold, design: .rounded)).foregroundColor(.white)
      Spacer(minLength: 0)
    }
    .frame(height: 40)
  }

  private func failed(_ it: SquadItem, _ why: String) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      head(it, replying: true)
      Text("Not sent. \(why)").font(.system(size: 12.5, weight: .medium, design: .rounded)).foregroundColor(Color(red: 1, green: 0.55, blue: 0.5)).lineLimit(1)
      Spacer(minLength: 4)
      HStack(spacing: 8) {
        pill("Retry", key: "retry", strong: true) { m.act(.retry) }
        pill("Close", key: "close") { m.act(.esc) }
      }
    }
  }
}

// MARK: - the window

final class SquadIslandPanel: NSPanel {
  var keyable = false
  override var canBecomeKey: Bool { keyable }
  override var canBecomeMain: Bool { false }
  override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

/// The controller: asks the shared island queue for its turn, plays the card, and talks to the page through Toast's hooks (the
/// same ones the corner card uses), so the page sends and marks things exactly as before.
final class SquadIsland {
  static let shared = SquadIsland()
  let m = SquadIslandModel()
  private var q = SquadIslandQueue()
  private var clock = SquadShowClock()
  private var win: SquadIslandPanel?
  private var timer: Timer?
  private var monitors: [Any] = []
  private var work: [DispatchWorkItem] = []
  private var requested = false
  private var closing = false
  private var presenting = false
  private var stateSince = Date()
  private var returnTo: pid_t = 0
  private var soundOn = true
  /// A calendar meeting is on (Toast.meetPrivacy): the corner card knows how to be discreet, the island does not.
  var privacy = false
  private static let queueId = "squad-island"
  private var spring: Animation { m.reduce ? .easeInOut(duration: 0.2) : .spring(response: 0.5, dampingFraction: 0.7) }
  private var test: Bool { ProcessInfo.processInfo.environment["PS_SELFTEST"] != nil }

  var isOpen: Bool { win?.isVisible == true && m.state != .closed }

  private func after(_ s: Double, _ f: @escaping () -> Void) {
    let w = DispatchWorkItem(block: f); work.append(w)
    DispatchQueue.main.asyncAfter(deadline: .now() + s, execute: w)
  }
  private func cancelAll() { work.forEach { $0.cancel() }; work = [] }

  private func gate(wants: Bool) -> SquadGate {
    SquadGate(feature: Features.on(SquadIslandCore.feature), cardWantsIsland: wants, islandOnScreen: Island.shared.shapeOnScreen() != nil,
              sleepMode: SleepScreen.shared.isUp, sentry: Sentry.shared.isUp, screenSharing: MacState.screenSharing(),
              fullScreen: Island.shared.fullScreenNow, screenLocked: MacState.locked(),
              privateMode: PrivateHold.shared.on || privacy, protectedFront: Protected.front, islandOverProtected: BuildRules.now.islandOverProtected)
  }

  // ---------- from Toast ----------
  /// A G Squad message card from the page. True when the island took it (the corner card is then not made).
  func take(_ c: [String: Any]) -> Bool {
    guard !test, let msg = SquadIslandCore.parse(c) else { return false }
    switch SquadIslandCore.decide(gate(wants: SquadIslandCore.wantsIsland(c))) {
    case .old: return false
    case .hold: return true
    case .island: break
    }
    soundOn = (c["sound"] as? Bool) != false
    let reading = isOpen && !closing && m.state == .card
    switch q.receive(msg, reading: reading) {
    case .again: break
    case .joinedActive:
      m.item = q.active
      clock.restart(for: SquadShowClock.total(for: SquadIslandCore.body(q.active!)))
      Island.shared.moment(.faceID)   // a small pop: one more message
    case .joinedWaiting: break
    case .new: request()
    }
    return true
  }

  /// The card left the page (read on another device, the chat opened, the person's switch went off).
  func retract(_ id: String) {
    let keep = SquadReply.holdsFocus(m.state) || { if case .sent = m.state { return true }; if case .failed = m.state { return true }; return false }()
    let closeNow = q.retract(id, keepActive: keep)
    if !keep, q.active != nil { m.item = q.active }
    if closeNow { close() }
  }

  /// The page's answer to a reply: it went, or it did not.
  func result(id: String, ok: Bool, why: String?) {
    guard isOpen, let it = m.item, it.msgs.contains(where: { $0.id == id }) else { return }
    apply(.answer(ok: ok, why: why))
  }

  func follow() {
    guard isOpen, !closing, let island = Island.shared.shapeOnScreen() else { return }
    m.islandSize = island.size
    place(island)
  }
  func protectedChanged() {
    guard isOpen else { return }
    if Protected.front && !BuildRules.now.islandOverProtected { drop(); return }
    if Protected.front, SquadReply.wantsKeyboard(m.state) { apply(.esc) }   // never type while 1Password or Signal is in front
  }

  // ---------- the queue ----------
  private func request() {
    guard !requested else { return }
    requested = true
    let o = IslandQueue.shared.enqueue(id: SquadIsland.queueId, kind: "squad", priority: .normal, ttl: 120,
                                       show: { [weak self] in self?.present() },
                                       visible: { [weak self] in self?.presenting == true || self?.win?.isVisible == true },
                                       dropped: { [weak self] in self?.requested = false })
    if o == .showNow { present() }
  }

  private func finishShared() {
    presenting = false
    IslandQueue.shared.finish(SquadIsland.queueId)
    requested = false
    if q.hasWaiting { request() }
  }

  /// Its turn: the island's squeeze, then the shape grows out of the island, then the words come in.
  private func present() {
    guard let item = q.promote() else { finishShared(); return }
    guard let island = Island.shared.shapeOnScreen(), SquadIslandCore.decide(gate(wants: true)) == .island else {
      fallBack(item); finishShared(); return
    }
    presenting = true; closing = false
    cancelAll()
    m.islandSize = island.size
    m.item = item
    m.draft = ""; m.over = false; m.hover = nil; m.tickDraw = 0; m.undoLeft = 0
    m.canCompose = SquadIslandCore.canCompose(protectedFront: Protected.front)
    m.act = { [weak self] ev in self?.event(ev) }
    m.open = false; m.inside = false
    m.state = SquadReply.step(.closed, .show, now: Date()).state
    stateSince = Date()
    clock = SquadShowClock(for: SquadShowClock.total(for: SquadIslandCore.body(item)))
    place(island)
    Island.shared.moment(.cardOut)
    let delay = m.reduce ? 0 : WelcomeBackCore.growDelay
    after(delay) { [weak self] in
      guard let self, let p = self.win else { return }
      p.alphaValue = 1
      p.orderFrontRegardless()
      withAnimation(self.spring) { self.m.open = true }
    }
    after(delay + (m.reduce ? 0.1 : WelcomeBackCore.contentDelay - WelcomeBackCore.growDelay)) { [weak self] in
      withAnimation(.easeOut(duration: 0.28)) { self?.m.inside = true }
    }
    startEsc(); startTimer()
    psLog("PS squad island: shown, \(item.count) message(s)")
  }

  /// The island was not usable when its turn came: the old card in the top right takes the messages instead.
  private func fallBack(_ item: SquadItem) {
    for msg in item.msgs {
      var card: [String: Any] = ["id": msg.id, "rev": String(msg.id.dropFirst(SquadIslandCore.prefix.count)), "tone": "squad", "icon": "chat",
                                 "title": msg.name, "sub": msg.group ?? "G Squad", "body": msg.text, "at": msg.at, "reply": true]
      card["island"] = false
      Toast.shared.showMeet(card)
    }
  }

  // ---------- the window ----------
  private func ensure() -> SquadIslandPanel {
    if let w = win { return w }
    let p = SquadIslandPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    p.isOpaque = false; p.backgroundColor = .clear; p.hasShadow = false
    p.level = NSWindow.Level(rawValue: NSWindow.Level.mainMenu.rawValue + 3)   // just above the real island
    p.hidesOnDeactivate = false; p.isReleasedWhenClosed = false
    p.collectionBehavior = IslandPlace.spaces
    p.setAccessibilityLabel("G Squad message")
    p.contentView = IslandHost(rootView: SquadIslandView(m: m))
    win = p
    return p
  }
  private func place(_ island: NSRect) {
    let p = ensure(), size = SquadIslandView.window(m.islandSize.height)
    let screen = (Island.shared.timerAnchor()?.screen) ?? NSScreen.main?.frame ?? island
    var x = island.midX - size.width / 2
    x = max(screen.minX, min(x, screen.maxX - size.width))
    p.setFrame(NSRect(x: x, y: island.maxY - size.height, width: size.width, height: size.height).integral, display: true)
  }

  // ---------- the steps ----------
  private func kind(_ s: SquadReplyState) -> Int {
    switch s { case .closed: return 0; case .card: return 1; case .composing: return 2; case .undo: return 3; case .sending: return 4; case .sent: return 5; case .failed: return 6 }
  }
  private func event(_ ev: SquadReplyEvent) { apply(ev) }

  private func apply(_ ev: SquadReplyEvent) {
    guard !closing, m.state != .closed, let it = m.item else { return }
    let before = m.state
    let r = SquadReply.step(before, ev, now: Date())
    if r.state != before {
      if kind(r.state) != kind(before) {
        stateSince = Date()
        withAnimation(spring) { m.state = r.state }
      } else { m.state = r.state }
    }
    if case .composing(let t) = r.state, kind(before) != 2 { m.draft = t }
    if case .composing(let t) = r.state, case .undo = before { m.draft = t }
    if kind(r.state) == 3 { m.undoLeft = SquadReply.undoLeft(r.state, now: Date()) }
    if kind(r.state) == 5 { withAnimation(.easeOut(duration: m.reduce ? 0.15 : 0.4)) { m.tickDraw = 1 } }
    // The keyboard: only while the box is open and the person clicked Reply.
    let wasKey = SquadReply.wantsKeyboard(before), isKey = SquadReply.wantsKeyboard(r.state)
    if isKey && !wasKey { takeKeyboard() }
    if wasKey && !isKey { giveKeyboard() }
    let id = it.newest.id
    switch r.effect {
    case .deliver(let t)?: Toast.shared.onSquadReply?(id, t)
    case .retryDelivery?: Toast.shared.onAction?(id, "retry")
    case .dismissAction?: Toast.shared.onAction?(id, "dismiss"); close()
    case .openChat?: Toast.shared.onAction?(id, "open"); close()
    case .close?: close()
    case .sentTick?: if soundOn, !test, !DND.shared.mutes("sounds") { BigIslandSound.play("squad-sent", BigIslandSound.soft, 0.3) }
    case nil: break
    }
  }

  private func takeKeyboard() {
    guard let p = win, !test, !Protected.front else { return }
    returnTo = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0
    p.keyable = true
    p.makeKey()
    m.focusToken += 1
  }
  private func giveKeyboard() {
    guard let p = win else { return }
    let wasKey = p.isKeyWindow
    p.keyable = false
    if wasKey { p.resignKey(); handBack() } else { returnTo = 0 }
  }
  /// The keyboard goes back to the app the person was in (never 1Password or Signal).
  private func handBack() {
    defer { returnTo = 0 }
    guard !test, returnTo > 0, let app = NSRunningApplication(processIdentifier: returnTo), !Protected.matches(app) else { return }
    if NSWorkspace.shared.frontmostApplication?.processIdentifier == returnTo { app.activate(options: []) }
  }

  // ---------- the clock ----------
  private func startTimer() {
    timer?.invalidate()
    let t = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in self?.tick() }
    RunLoop.main.add(t, forMode: .common)
    timer = t
  }
  private func tick() {
    guard isOpen, !closing else { return }
    let now = Date()
    switch m.state {
    case .card:
      if clock.tick(0.25, hovered: m.over, focused: false) { apply(.timeout) }
    case .undo:
      m.undoLeft = SquadReply.undoLeft(m.state, now: now)
      apply(.tick)
    case .sending:
      apply(.tick)
    case .sent:
      if now.timeIntervalSince(stateSince) >= SquadIslandCore.sentFor { apply(.tick) }
    case .failed:
      if !m.over, now.timeIntervalSince(stateSince) >= SquadIslandCore.failedFor { apply(.timeout) }
    default: break
    }
  }

  // ---------- Esc ----------
  private func startEsc() {
    guard monitors.isEmpty else { return }
    if let l = NSEvent.addLocalMonitorForEvents(matching: [.keyDown], handler: { [weak self] e in
      guard e.keyCode == 53, self?.isOpen == true, let s = self?.m.state else { return e }
      self?.apply(.esc)
      if case .card = s { return e }   // the same Esc still backs out of the Tab list (EscAlways.swift)
      return nil                        // the box, the Undo and the rest: this Esc was this card's step back
    }) { monitors.append(l) }
    if let g = NSEvent.addGlobalMonitorForEvents(matching: [.keyDown], handler: { [weak self] e in
      if e.keyCode == 53 { DispatchQueue.main.async { if self?.isOpen == true { self?.apply(.esc) } } }
    }) { monitors.append(g) }
  }
  private func stopEsc() { monitors.forEach { NSEvent.removeMonitor($0) }; monitors = [] }

  // ---------- going away ----------
  /// Back up into the island: the words go, the shape shrinks to the island's size, the window goes, then the next card.
  private func close() {
    guard !closing else { return }
    guard win?.isVisible == true else { drop(); return }
    closing = true
    cancelAll(); timer?.invalidate(); timer = nil; stopEsc()
    giveKeyboard()
    withAnimation(.easeOut(duration: 0.14)) { m.inside = false }
    after(m.reduce ? 0.12 : 0.1) { [weak self] in guard let self else { return }; withAnimation(self.spring) { self.m.open = false } }
    after(m.reduce ? 0.35 : 0.75) { [weak self] in
      guard let self else { return }
      self.win?.orderOut(nil)
      self.gone()
      Island.shared.swell(false)
    }
  }
  /// Quietly gone at once (the island went, 1Password or Signal came forward).
  private func drop() {
    cancelAll(); timer?.invalidate(); timer = nil; stopEsc(); giveKeyboard()
    win?.orderOut(nil)
    gone()
  }
  private func gone() {
    m.open = false; m.inside = false; m.state = .closed; m.draft = ""
    closing = false
    q.finishActive()
    finishShared()
  }
}
