// Which calendars PS works with: the Mac side (15 Nov 2026, the developer's friend). The page lets each calendar of the Calendar
// app be Meetings, Show only or Off (web/src/core/calpick.ts). For that, every event carries the calendar it is in and the page gets
// the list of calendars: only an identifier, a name, a colour and the account's name, nothing else (no notes, no
// events of its own). Still read only, still on LocalCalendar's own queue. This file is the pure part: no EventKit, no AppKit.
import Foundation

enum CalPickCore {
  static let maxCals = 60
  static let idMax = 200, nameMax = 120, acctMax = 80

  /// "#rrggbb" from colour parts in 0...1 (anything outside is clamped; not a number gives nil).
  static func hex(r: Double, g: Double, b: Double) -> String? {
    guard r.isFinite, g.isFinite, b.isFinite else { return nil }
    func byte(_ v: Double) -> Int { Int((min(1, max(0, v)) * 255).rounded()) }
    return String(format: "#%02x%02x%02x", byte(r), byte(g), byte(b))
  }

  /// One calendar as the page gets it. nil when it has no identifier (it cannot be told apart, so it stays a meeting).
  static func info(id: String?, name: String?, color: String?, acct: String?) -> [String: Any]? {
    guard let id = id, !id.isEmpty else { return nil }
    let n = (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    return ["id": String(id.prefix(idMax)), "name": String((n.isEmpty ? "Calendar" : n).prefix(nameMax)),
            "color": color.map { $0 as Any } ?? NSNull(), "acct": String((acct ?? "").prefix(acctMax))]
  }

  /// The list for the page: no duplicates, in a steady order (account, then name), at most maxCals.
  static func list(_ rows: [[String: Any]]) -> [[String: Any]] {
    var seen = Set<String>()
    let unique = rows.filter { r in
      guard let id = r["id"] as? String, !seen.contains(id) else { return false }
      seen.insert(id); return true
    }
    let sorted = unique.sorted {
      let a = ($0["acct"] as? String ?? "", $0["name"] as? String ?? ""), b = ($1["acct"] as? String ?? "", $1["name"] as? String ?? "")
      return a.0 == b.0 ? a.1.localizedCaseInsensitiveCompare(b.1) == .orderedAscending : a.0.localizedCaseInsensitiveCompare(b.0) == .orderedAscending
    }
    return Array(sorted.prefix(maxCals))
  }

  /// The three fields an event carries about its calendar (the page keeps only the identifier; the name and colour are in the list).
  static func eventFields(id: String?, name: String?, color: String?) -> [String: Any] {
    guard let id = id, !id.isEmpty else { return [:] }
    var out: [String: Any] = ["cal": String(id.prefix(idMax))]
    if let n = name, !n.isEmpty { out["calName"] = String(n.prefix(nameMax)) }
    if let c = color { out["calColor"] = c }
    return out
  }
}
