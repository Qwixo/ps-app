// One shared queue for every card that comes out of the island (PS 1.60, the developer 14 Nov 2026: "never a notification on
// top of another ... one card at a time, queue the rest, never overlapping, one shared queue for all island cards").
//
// Pure Foundation: no windows, no clock of its own, no sounds. tests/island-queue-test.sh runs it on any Mac, and the web
// copy (web/src/core/islandqueue.ts) has the same rules and the same test cases. IslandQueue.swift is the part that
// owns windows; a new kind of card joins with ONE call: IslandQueue.shared.enqueue(id:kind:priority:show:).
//
// The rules:
//  - One card is active (on screen) at a time. Every other card waits, out of sight.
//  - A new card never interrupts the active one, whatever its priority: it goes next if it is more urgent.
//  - Waiting order: higher priority first, then the one that came first.
//  - The same id twice is the same card: it keeps its place and takes the higher priority, never a second copy.
//  - A waiting card with a time to live (an AI chat card, a notice) that waited longer is dropped, never shown stale.
//  - An active card whose window is gone without a word (a crash, a lost close) is let go after a short grace, so
//    the queue never sticks.
//  - Finishing the active card (answered, Esc, timed out) makes the next one active, after a short breath so two cards
//    never swap on the same frame.
import Foundation

enum IslandPriority: Int, Comparable, CaseIterable {
  case low = 1        // AI chat finished, notices
  case normal = 2     // update, meeting notes, client emails
  case high = 3       // the 15 minute reminder, the restart helper alert
  static func < (a: IslandPriority, b: IslandPriority) -> Bool { a.rawValue < b.rawValue }
}

struct IslandCardRef: Equatable {
  let id: String
  let kind: String
  var priority: IslandPriority
  /// Order of arrival (never reused), the tie break inside a priority.
  let seq: Int
  let since: Date
  /// A waiting card older than this is dropped (nil: waits as long as it takes).
  let ttl: TimeInterval?
}

struct IslandQueueCore {
  /// A pause between one card leaving and the next one coming out, so the island can settle.
  static let breath: TimeInterval = 0.25
  /// An active card that has not been seen alive for this long is let go.
  static let deadGrace: TimeInterval = 4
  /// No more than this many cards wait; the least important newest ones past it are dropped (a flood never grows forever).
  static let maxWaiting = 30

  private(set) var active: IslandCardRef?
  private(set) var waiting: [IslandCardRef] = []
  private var nextSeq = 0
  /// When the active card was last confirmed alive (its window visible).
  private var aliveAt = Date.distantPast
  /// The earliest moment the next card may become active (the breath).
  private(set) var holdUntil = Date.distantPast

  enum Outcome: Equatable {
    case showNow            // this card is active now: show it
    case wait(position: Int) // behind others, 1 = next up
    case updated            // already known: nothing changes but its priority maybe
    case dropped            // refused (queue full)
  }

  /// A card wants the island. One call, for every kind of card.
  mutating func enqueue(id: String, kind: String, priority: IslandPriority, ttl: TimeInterval? = nil, now: Date) -> Outcome {
    if active?.id == id { if priority > active!.priority { active!.priority = priority }; return .updated }
    if let i = waiting.firstIndex(where: { $0.id == id }) {
      if priority > waiting[i].priority { waiting[i].priority = priority; sortWaiting() }
      return .updated
    }
    let ref = IslandCardRef(id: id, kind: kind, priority: priority, seq: nextSeq, since: now, ttl: ttl)
    nextSeq += 1
    if active == nil && now >= holdUntil && waiting.isEmpty {
      active = ref; aliveAt = now
      return .showNow
    }
    guard waiting.count < IslandQueueCore.maxWaiting else { return .dropped }
    waiting.append(ref)
    sortWaiting()
    return .wait(position: (waiting.firstIndex { $0.id == id } ?? 0) + 1)
  }

  private mutating func sortWaiting() {
    waiting.sort { $0.priority != $1.priority ? $0.priority > $1.priority : $0.seq < $1.seq }
  }

  /// The card is finished (answered, closed, Esc, timed out), or cancelled while it waits. True when it was the active one.
  @discardableResult mutating func finish(_ id: String, now: Date) -> Bool {
    if active?.id == id {
      active = nil; holdUntil = now.addingTimeInterval(IslandQueueCore.breath)
      return true
    }
    waiting.removeAll { $0.id == id }
    return false
  }

  /// Esc: the active card closes (the caller closes its window, then calls this). The same as finish.
  @discardableResult mutating func escape(now: Date) -> String? {
    guard let a = active else { return nil }
    finish(a.id, now: now)
    return a.id
  }

  /// The active card's window was seen on screen just now.
  mutating func alive(_ id: String, now: Date) { if active?.id == id { aliveAt = now } }

  /// Time moves on: drops waiting cards past their time to live, lets go of a dead active card, and returns the card
  /// that should become active now (the caller shows it), or nil.
  mutating func step(now: Date, activeIsVisible: Bool) -> (promote: IslandCardRef?, dropped: [IslandCardRef]) {
    var gone: [IslandCardRef] = []
    waiting.removeAll { c in
      if let t = c.ttl, now.timeIntervalSince(c.since) > t { gone.append(c); return true }
      return false
    }
    if active != nil {
      if activeIsVisible { aliveAt = now }
      else if now.timeIntervalSince(aliveAt) > IslandQueueCore.deadGrace {
        active = nil; holdUntil = now.addingTimeInterval(IslandQueueCore.breath)
      }
    }
    guard active == nil, now >= holdUntil, !waiting.isEmpty else { return (nil, gone) }
    let next = waiting.removeFirst()
    active = next; aliveAt = now
    return (next, gone)
  }

  /// When to call step again at the latest (nil: nothing is pending), so a hold or a time to live is never missed.
  func recheck(now: Date) -> TimeInterval? {
    if waiting.isEmpty && active == nil { return nil }
    var t: TimeInterval = IslandQueueCore.deadGrace
    if active == nil, holdUntil > now { t = min(t, holdUntil.timeIntervalSince(now) + 0.01) }
    else if active == nil { t = 0.01 }
    for c in waiting { if let ttl = c.ttl { t = min(t, max(0.01, ttl - now.timeIntervalSince(c.since) + 0.01)) } }
    return t
  }

  func isActive(_ id: String) -> Bool { active?.id == id }
  func isWaiting(_ id: String) -> Bool { waiting.contains { $0.id == id } }
  var count: Int { (active == nil ? 0 : 1) + waiting.count }
}
