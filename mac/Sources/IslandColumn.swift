import AppKit

// Pop ups with windows of their own out of the Dynamic Island (V1.55, the developer 12 Nov 2026: "Actually yes. But make it so
// you can change it all in settings"). The 15 min and task reminders (Reminders.swift), the update card (UpdateUI.swift),
// the restart helper alert (HelperAlert.swift), the meeting notes card (NotesCard.swift) and the Soundboard card
// (Soundboard.swift) each ask here where to go. While the island is there for cards and the developer left that kind on Island
// (Settings, the Dynamic Island's own list), the answer is a place under the island: they settle one under the other in
// the order they came, each keeping its own size, buttons and rules, and the card stack (Toast.swift) starts under the
// last of them. Otherwise the answer is nil and the window goes to its usual place, exactly as before.
// Arriving under the island, a window slides down from behind it (the island is drawn above every one of these windows)
// while it fades in, and the island swells as for a card. Only the window's place and its alpha change: nothing inside
// is redrawn or scaled, so each keeps its own look. Never takes the keyboard, never touches 1Password or Signal (every
// one of these windows already hides over them, and the island is gone then, so they would be in their usual place).
// A self test copy keeps every window in its usual place.
final class IslandColumn {
  static let shared = IslandColumn()

  /// `arrived`: the window made its entrance and has stayed in the column since; `target`: where it was last sent.
  private struct Entry { var id: String; var kind: String; weak var window: NSWindow?; var size: CGSize; var replace: () -> Void
    var arrived = false; var target: NSRect? = nil }
  /// The windows under the island now, in the order they came (the first is next to the island).
  private var entries: [Entry] = []
  private var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
  /// A self test copy keeps every window in its usual place unless a test asks for the island.
  var testIsland = false

  /// Does this kind come out of the island right now?
  func wants(_ kind: String) -> Bool {
    if Toast.testCopy && !testIsland { return false }
    return NoteDrop.route(kind: kind, island: Island.shared.noteAnchor() != nil, top: Island.shared.model.st.cardsTop)
  }

  /// Where this window goes under the island, or nil for its usual place (the caller then does what it always did).
  /// `replace`: how the window places itself again (the island moved, a window before it came or went).
  func frame(id: String, kind: String, size: CGSize, window: NSWindow, replace: @escaping () -> Void) -> NSRect? {
    guard wants(kind), let a = Island.shared.noteAnchor() else { leave(id); return nil }
    if let i = entries.firstIndex(where: { $0.id == id }) {
      let grew = abs(entries[i].size.height - size.height) > 0.5
      entries[i].size = size; entries[i].window = window; entries[i].replace = replace
      if grew { DispatchQueue.main.async { [weak self] in self?.relayout(after: id) } }
    } else {
      entries.append(Entry(id: id, kind: kind, window: window, size: size, replace: replace))
      DispatchQueue.main.async { Toast.shared.islandChanged() }   // the card stack makes room under it
    }
    let before = entries.prefix { $0.id != id }.map { $0.size.height }
    return NoteDrop.columnFrame(a, size: size, offset: NoteDrop.columnHeight(before))
  }

  /// The window went (closed, answered, hidden): the windows after it and the card stack move up into its place.
  func leave(_ id: String) {
    guard let i = entries.firstIndex(where: { $0.id == id }) else { return }
    entries.remove(at: i)
    let after = entries.suffix(from: i).map { $0.replace }
    DispatchQueue.main.async {
      after.forEach { $0() }
      Toast.shared.islandChanged()
    }
  }

  /// How far the column reaches from the island (the card stack starts past it). Windows that went away on their own
  /// (closed without a leave) no longer count.
  var height: CGFloat {
    entries.removeAll { $0.window == nil || $0.window?.isVisible != true }
    return NoteDrop.columnHeight(entries.map { $0.size.height })
  }

  /// The island moved, hid, came back, or a choice changed: every window places itself again (some go back to their
  /// usual place, which takes them out of the column).
  func islandChanged() {
    let all = entries.map { $0.replace }
    all.forEach { $0() }
  }
  private func relayout(after id: String) {
    guard let i = entries.firstIndex(where: { $0.id == id }) else { return }
    entries.suffix(from: i + 1).map { $0.replace }.forEach { $0() }
    Toast.shared.islandChanged()
  }

  /// Puts a window at its place under the island: a window already showing glides there; a new one slides down from
  /// behind the island while it fades in, and the island swells. `alpha`: what the window shows at (0 in a test copy).
  /// V1.56 hang fix: a window that already arrived only glides from now on, even while it is still fading in (in V1.55
  /// its arrival started again on every island change and each arrival swelled the island: an endless main thread loop).
  func put(_ w: NSWindow, _ f: NSRect, alpha: CGFloat = 1) {
    let i = entries.firstIndex { $0.window === w }
    let step = NoteDrop.putStep(arrived: i.map { entries[$0].arrived } ?? false, visible: w.isVisible, alpha: w.alphaValue,
                                current: w.frame, target: i.flatMap { entries[$0].target }, to: f)
    if let i { entries[i].arrived = true; entries[i].target = f }
    if step == .stay { return }
    if step == .glide {
      NSAnimationContext.runAnimationGroup { ctx in
        ctx.duration = reduceMotion ? 0 : 0.3
        ctx.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.9, 0.3, 1)
        w.animator().setFrame(f, display: true)
      }
      return
    }
    let calm = reduceMotion || Toast.testCopy
    let side = Island.shared.noteAnchor().map { NoteDrop.spot($0, cap: $0.visible.height).side } ?? .below
    // From behind the island: up to 36 points nearer to it, so its edge starts tucked under the island's.
    let tuck = calm ? 0 : min(36, f.height * 0.5)
    let from = f.offsetBy(dx: 0, dy: side == .below ? tuck : -tuck)
    w.setFrame(from, display: false)
    w.alphaValue = 0
    w.orderFrontRegardless()
    Island.shared.swell(true)
    NSAnimationContext.runAnimationGroup { ctx in
      ctx.duration = calm ? 0.2 : 0.5
      ctx.timingFunction = calm ? CAMediaTimingFunction(name: .easeOut) : CAMediaTimingFunction(controlPoints: 0.22, 1.12, 0.36, 1)
      w.animator().setFrame(f, display: true)
      w.animator().alphaValue = alpha
    }
  }

  /// Self test and the note's checks: which windows are under the island, in order.
  var ids: [String] { entries.map { $0.id } }
}
