import Foundation

// The shared queue of island cards, the part with a clock and windows (PS 1.60). The rules are in IslandQueueCore.swift
// (tested in tests/island-queue-test.sh). Every card that comes out of the island asks here first, so there is never one
// on top of another: one is on screen, the rest wait.
//
// A new kind of card joins with ONE call (this is what the client emails cards, PR 8, use):
//
//   IslandQueue.shared.enqueue(id: "mail:abc", kind: "mail", priority: .normal, ttl: 600, show: { ...show it now... },
//                              visible: { window.isVisible })
//
//  - `enqueue` answers .showNow (show it yourself, right now) or .wait (it is queued; `show` is called later when
//    it is its turn). Never call `show` yourself for a queued card.
//  - `finish(id)` when the card is gone (answered, Esc, timed out, closed). Always, or the next card never comes.
//  - `ttl`: a card that waited longer than this is never shown (`dropped` is called instead).
// The windows under the island (IslandColumn.swift) already use it: reminders, update, restart helper, meeting notes.
final class IslandQueue {
  static let shared = IslandQueue()

  struct Item {
    var show: () -> Void
    var visible: () -> Bool
    var close: (() -> Void)?
    var dropped: (() -> Void)?
  }
  private var core = IslandQueueCore()
  private var items: [String: Item] = [:]
  private var timer: DispatchWorkItem?

  /// Asks for the island. See the header for what each answer means.
  @discardableResult
  func enqueue(id: String, kind: String, priority: IslandPriority, ttl: TimeInterval? = nil,
               show: @escaping () -> Void, visible: @escaping () -> Bool = { true },
               close: (() -> Void)? = nil, dropped: (() -> Void)? = nil) -> IslandQueueCore.Outcome {
    let o = core.enqueue(id: id, kind: kind, priority: priority, ttl: ttl, now: Date())
    switch o {
    case .showNow, .wait: items[id] = Item(show: show, visible: visible, close: close, dropped: dropped)
    case .updated: items[id]?.show = show   // the newest way to show it wins
    case .dropped: dropped?()
    }
    schedule()
    return o
  }

  /// The card is gone. True when it was the one on screen (the next card follows after a short breath).
  @discardableResult func finish(_ id: String) -> Bool {
    let was = core.finish(id, now: Date())
    items[id] = nil
    schedule()
    return was
  }

  /// Esc: closes the card on screen (its own close hook first), and the queue moves on.
  @discardableResult func escape() -> String? {
    guard let id = core.active?.id else { return nil }
    items[id]?.close?()
    finish(id)
    return id
  }

  func isActive(_ id: String) -> Bool { core.isActive(id) }
  func isWaiting(_ id: String) -> Bool { core.isWaiting(id) }
  var activeId: String? { core.active?.id }
  var waitingIds: [String] { core.waiting.map { $0.id } }

  /// Looks again when something may have changed (a card finished, a time to live ran out): promotes the next card.
  private func schedule() {
    timer?.cancel(); timer = nil
    guard let after = core.recheck(now: Date()) else { return }
    let w = DispatchWorkItem { [weak self] in self?.tick() }
    timer = w
    DispatchQueue.main.asyncAfter(deadline: .now() + after, execute: w)
  }
  private func tick() {
    timer = nil
    let visible = core.active.flatMap { items[$0.id]?.visible() } ?? true
    let r = core.step(now: Date(), activeIsVisible: visible)
    for c in r.dropped { let d = items[c.id]?.dropped; items[c.id] = nil; d?() }
    if let next = r.promote { items[next.id]?.show() }
    schedule()
  }
}
