import Foundation

// V1.58 the island away (the developer, 13 Nov 2026, through the manager): right click the island's small grey bar for a menu with
// "Settings", "Disappear for this meeting" (only while a meeting is on, back by itself when that meeting ends per the
// calendar, following it if it is moved or made longer) and "Disappear for 30 minutes" (a time you can scroll or type,
// remembered). Plain numbers, no windows: tests/island-away-test.swift checks it on any Mac without a screen.
//
// The end is a wall clock time (seconds since 1970), kept in UserDefaults (island.away), so the hide outlasts sleep and a
// PS restart: Island.swift checks it against the clock on a timer, on wake and on every state from the page, never by
// counting seconds (a Mac asleep does not count them).
// The meetings come from the page (web src/core/islandaway.ts): the Meetings panel's own calendar copy, only
// ids and times, from now to 12 hours ahead. The Mac decides with its own clock which one is on now.

/** One calendar event from the page: its id, start and end (seconds since 1970), and whether it is a real meeting
 *  (people or a call link) rather than a block of time. */
struct IslandMeet: Equatable {
  var id: String
  var start: Double
  var end: Double
  var real: Bool
}

/** The island away until a wall clock time: for a number of minutes, or until a meeting ends (its id, to follow it). */
struct IslandAway: Codable, Equatable {
  enum Kind: String, Codable { case minutes, meeting }
  var kind: Kind
  var until: Double
  var meet: String?
}

enum IslandAwayCore {
  /** The time menu: 30 minutes the first time, then the last one chosen; 1 minute to 24 hours. */
  static let defaultMinutes = 30, minMinutes = 1, maxMinutes = 24 * 60
  /** A meeting never keeps the island away longer than this, whatever its calendar says (a meeting left on all day). */
  static let meetingCap: Double = 12 * 3600

  /** Meetings from the page's island state ({"meets": [{id, start, end, real}]}, start and end in ms), checked and capped. */
  static func meets(_ v: Any?) -> [IslandMeet] {
    guard let a = v as? [Any] else { return [] }
    return a.prefix(12).compactMap { x in
      guard let d = x as? [String: Any], let id = d["id"] as? String, !id.isEmpty,
            let s = (d["start"] as? NSNumber)?.doubleValue, let e = (d["end"] as? NSNumber)?.doubleValue, s.isFinite, e.isFinite, e > s else { return nil }
      return IslandMeet(id: String(id.prefix(200)), start: s / 1000, end: e / 1000, real: (d["real"] as? Bool) == true)
    }
  }

  /** The meeting on now that "Disappear for this meeting" means: a real meeting before a block of time, then the one
   *  that started last (the one just joined), then the one that ends first. nil: no meeting on now (no menu item). */
  static func current(_ meets: [IslandMeet], now: Double) -> IslandMeet? {
    meets.filter { $0.start <= now && $0.end > now }
      .sorted { a, b in a.real != b.real ? a.real : a.start != b.start ? a.start > b.start : a.end < b.end }
      .first
  }

  /** Away for a number of minutes from now (kept between 1 minute and 24 hours). */
  static func forMinutes(_ m: Int, now: Double) -> IslandAway {
    IslandAway(kind: .minutes, until: now + Double(clampMinutes(m)) * 60, meet: nil)
  }
  /** Away until this meeting ends (never past the cap). nil when it is already over. */
  static func forMeeting(_ m: IslandMeet, now: Double) -> IslandAway? {
    let until = min(m.end, now + meetingCap)
    return until > now ? IslandAway(kind: .meeting, until: until, meet: m.id) : nil
  }

  /** What happens to an away island now. `meets` is the page's latest list, or nil when the page has said nothing yet
   *  (just restarted, the vault still locked): then only the clock counts.
   *  - Minutes: away until the time, then back.
   *  - Meeting: its end followed (moved or made longer: the new end; shorter: back sooner). Gone from the calendar, or
   *    moved so it is no longer on now: back at once. */
  enum Step: Equatable { case stay(IslandAway), back }
  static func step(_ a: IslandAway, now: Double, meets: [IslandMeet]?) -> Step {
    var a = a
    if a.kind == .meeting, let meets {
      guard let m = meets.first(where: { $0.id == a.meet }), m.start <= now, m.end > now else { return .back }
      a.until = min(m.end, now + meetingCap)
    }
    return a.until > now ? .stay(a) : .back
  }

  // ---------- kept between runs (UserDefaults island.away) ----------
  static func encode(_ a: IslandAway?) -> Data? { a.flatMap { try? JSONEncoder().encode($0) } }
  /** A kept away, only if it is well formed and not over (a stale or broken one is dropped). Never more than 24 hours. */
  static func decode(_ d: Data?, now: Double) -> IslandAway? {
    guard let d, let a = try? JSONDecoder().decode(IslandAway.self, from: d), a.until.isFinite, a.until > now else { return nil }
    if a.kind == .meeting, (a.meet ?? "").isEmpty { return nil }
    return a.until - now > Double(maxMinutes) * 60 ? nil : a
  }

  // ---------- the time in the menu ----------
  static func clampMinutes(_ m: Int) -> Int { min(maxMinutes, max(minMinutes, m)) }
  /** A typed time: "45", "45m", "45 min", "1h", "1.5 hours", "1:30", "2h 15m". Plain numbers are minutes. nil: not a time. */
  static func parse(_ text: String) -> Int? {
    let t = text.lowercased().trimmingCharacters(in: .whitespaces)
    guard !t.isEmpty, t.count <= 20 else { return nil }
    if t.contains(":") {
      let p = t.split(separator: ":", omittingEmptySubsequences: false)
      guard p.count == 2, let h = Int(p[0]), let m = Int(p[1]), h >= 0, (0..<60).contains(m) else { return nil }
      return ok(h * 60 + m)
    }
    var total = 0.0, num = "", any = false
    var i = t.startIndex
    func flush(_ unit: Double) -> Bool { guard let n = Double(num), n >= 0 else { return false }; total += n * unit; num = ""; any = true; return true }
    while i < t.endIndex {
      let c = t[i]
      if c.isNumber || c == "." || c == "," { num.append(c == "," ? "." : c); i = t.index(after: i); continue }
      if c == " " { i = t.index(after: i); continue }
      var word = ""
      while i < t.endIndex, t[i].isLetter { word.append(t[i]); i = t.index(after: i) }
      guard !num.isEmpty else { return nil }
      if ["h", "hr", "hrs", "hour", "hours"].contains(word) { guard flush(60) else { return nil } }
      else if ["m", "min", "mins", "minute", "minutes"].contains(word) { guard flush(1) else { return nil } }
      else { return nil }
    }
    if !num.isEmpty { guard flush(1) else { return nil } }   // a bare number, or the minutes after "1h 30", are minutes
    return any ? ok(Int(total.rounded())) : nil
  }
  private static func ok(_ m: Int) -> Int? { m >= minMinutes ? min(maxMinutes, m) : nil }
  /** The scroll wheel's step from a value: 1 minute up to 10, 5 up to an hour, then 15. */
  static func scrolled(from m: Int, up: Bool) -> Int {
    let s = up ? (m < 10 ? 1 : m < 60 ? 5 : 15) : (m <= 10 ? 1 : m <= 60 ? 5 : 15)
    return clampMinutes(up ? m + s : m - s)
  }
  /** The word after the number in "Disappear for 30 minutes". */
  static func unit(_ m: Int) -> String { m == 1 ? "minute" : "minutes" }
}
