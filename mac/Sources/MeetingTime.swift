// Meeting time on this Mac (V1.40, the developer 7 Nov 2026: "I'm in a meeting and the AFK timer comes on because I'm not
// doing anything on the keyboard"). The main window sends each calendar meeting's window
// ({type:"afkMeetings", windows:[[from ms, to ms], ...]}): web src/core/afkmeet.ts decides what counts
// (a call link or other people, not all day, not hidden on the Meetings panel) and adds 5 minutes before and
// 10 after. This file only keeps those windows and answers with this Mac's own clock: is a meeting on now, when
// did the last one end, and which part of a stretch was outside meetings.
// Users: Afk.swift (no AFK card in a meeting, and the clock starts again when it ends) and ScreenTime.swift
// (meeting time is not away; it shows as "Meetings"). Calendar only: PS never looks at which app uses the
// microphone or camera for this. The switch is the AFK timer's "Stay off during meetings" (on unless switched off).
// Read from the AFK queue and the main thread, so a lock guards the state. Never blocks: no I/O here.
import Foundation

final class MeetingTime {
  static let shared = MeetingTime()

  struct Win: Equatable { let from: Date; let to: Date }
  static let maxWindows = 60
  static let longest: TimeInterval = 12 * 3600 + 20 * 60   // the page drops meetings over 12 hours; this adds its margins

  private let lock = NSLock()
  private var wins: [Win] = []
  private var on = true

  /// The page's list. Anything odd is dropped. Returns true when it changed.
  @discardableResult func set(_ raw: Any?) -> Bool {
    let w = MeetingTime.parse(raw)
    lock.lock(); defer { lock.unlock() }
    if w == wins { return false }
    wins = w
    return true
  }
  /// "Stay off during meetings" (Afk.Prefs.meetings). Off: nothing here counts.
  func setEnabled(_ b: Bool) { lock.lock(); on = b; lock.unlock() }
  var enabled: Bool { lock.lock(); defer { lock.unlock() }; return on }
  private var active: [Win] { lock.lock(); defer { lock.unlock() }; return on ? wins : [] }

  func window(at now: Date) -> Win? { MeetingTime.window(now, active) }
  func after(_ t: Date, now: Date) -> Date { MeetingTime.after(t, now: now, active) }
  func outside(_ s: Date, _ e: Date) -> [(Date, Date)] { MeetingTime.outside(s, e, active) }

  // ---------- pure rules (tests/meetingtime-test.swift) ----------

  /// [[from ms, to ms], ...] from the page, sorted, overlaps joined, at most 60. Never trusts the page blindly.
  static func parse(_ raw: Any?) -> [Win] {
    guard let list = raw as? [Any] else { return [] }
    var out: [Win] = []
    for item in list.prefix(maxWindows * 2) {
      guard let pair = item as? [Any], pair.count == 2,
            let a = (pair[0] as? NSNumber)?.doubleValue, let b = (pair[1] as? NSNumber)?.doubleValue,
            a.isFinite, b.isFinite, b > a, (b - a) / 1000 <= longest else { continue }
      out.append(Win(from: Date(timeIntervalSince1970: a / 1000), to: Date(timeIntervalSince1970: b / 1000)))
    }
    out.sort { $0.from < $1.from }
    var joined: [Win] = []
    for w in out {
      if let last = joined.last, w.from <= last.to { joined[joined.count - 1] = Win(from: last.from, to: max(last.to, w.to)) }
      else { joined.append(w) }
    }
    return Array(joined.suffix(maxWindows))
  }

  /// The window that holds this moment (from included, to not), or nil.
  static func window(_ now: Date, _ w: [Win]) -> Win? { w.first { $0.from <= now && now < $0.to } }

  /// The AFK clock's start: `t` (the last input), moved to the end of any meeting that ended after it and by now.
  /// So sitting still through a call and its overrun never counts as away once the call is over.
  static func after(_ t: Date, now: Date, _ w: [Win]) -> Date {
    w.reduce(t) { best, x in x.to > best && x.to <= now && x.from < x.to ? max(best, x.to) : best }
  }

  /// The parts of [s, e) outside every meeting window, oldest first.
  static func outside(_ s: Date, _ e: Date, _ w: [Win]) -> [(Date, Date)] {
    guard e > s else { return [] }
    var out: [(Date, Date)] = []
    var cur = s
    for x in w.sorted(by: { $0.from < $1.from }) where x.to > cur && x.from < e {
      if x.from > cur { out.append((cur, x.from)) }
      cur = max(cur, x.to)
      if cur >= e { break }
    }
    if cur < e { out.append((cur, e)) }
    return out
  }

  /// An AFK card is up when a meeting starts: the part of its stretch to keep as a break (start to the meeting's
  /// window), or nil when it began inside the window (nothing to keep).
  static func keep(start: Date, window: Win, now: Date) -> (Date, Date)? {
    let end = min(window.from, now)
    return end > start ? (start, end) : nil
  }
}
