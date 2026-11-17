import Foundation

// Low power mode, the Mac's pure half (PS 1.65, feature "low-power"; the page decides: web/src/core/lowpower.ts).
// The main page sends {type:"lowpower", on, why, asleep:[ids], names:[plain names], alarms} on every change.
// This checks it and answers "is this feed asleep?" for the Mac's own timers (LowPower.swift holds the live copy).
//
// For features on other branches (activity monitor, audio priority, voice capture, Second Computer):
//   guard !LowPower.shared.asleep("activity") else { return }          // before any background work
//   LowPower.shared.every("activity", 30) { [weak self] in self?.pull() }   // a timer that stops while asleep
//   LowPower.shared.onChange { asleep in ... }                         // start or stop your own source
// Declare the feed's id and plain name in web/src/core/lowpower.ts FEEDS (or lowPower.register on the page), so the
// island and Settings can list it. An id the page does not know sleeps whenever Low power mode is on.

struct LowPowerState: Equatable {
  var on = false
  var why = ""            // "hand" | "mac" | "phone" | ""
  var asleep: Set<String> = []
  var names: [String] = []
  var alarms = true

  static let idOK = try! NSRegularExpression(pattern: "^[a-z0-9]+(-[a-z0-9]+)*$")
  private static func okID(_ s: String) -> Bool {
    s.count <= 40 && idOK.firstMatch(in: s, range: NSRange(location: 0, length: s.utf16.count)) != nil
  }

  /// Everything from the page checked and capped: at most 64 ids and 40 names of 40 characters, no new lines.
  static func from(_ d: [String: Any]) -> LowPowerState {
    var s = LowPowerState()
    s.on = (d["on"] as? Bool) == true
    let w = d["why"] as? String ?? ""
    s.why = s.on && ["hand", "mac", "phone"].contains(w) ? w : ""
    if s.on {
      s.asleep = Set(((d["asleep"] as? [Any]) ?? []).prefix(64).compactMap { $0 as? String }.filter(okID))
      s.names = ((d["names"] as? [Any]) ?? []).prefix(40).compactMap { $0 as? String }
        .map { String($0.replacingOccurrences(of: "\n", with: " ").prefix(40)) }.filter { !$0.isEmpty }
    }
    s.alarms = (d["alarms"] as? Bool) != false
    return s
  }

  /// Is this feed asleep? Off: nothing is. On: what the page listed, and any id it did not list except the alarms
  /// while their switch is on (a feed the page does not know yet still sleeps, so nothing new runs by mistake).
  func asleep(_ id: String) -> Bool {
    guard on else { return false }
    if asleep.contains(id) { return true }
    if id == "alarms" { return !alarms }
    return true
  }

  /// A new answer from the page: the catch ups still waiting from the last wake are dropped only when it fell asleep again (they
  /// wait for the next wake). Any other change (a name, the alarms switch, why) keeps them, so a wake never loses its catch ups.
  static func dropsCatchUps(before: LowPowerState, next: LowPowerState) -> Bool { next.on && !before.on }
  /// When the next catch up may run (seconds of uptime): 0.8 s from now, and 1.5 s after the last one already waiting.
  static func nextSlot(now: TimeInterval, last: TimeInterval?) -> TimeInterval { max(now + 0.8, (last ?? -.infinity) + 1.5) }

  /// How often the Mac asks the page for a vault sync: slower while on (the owner: "every few minutes").
  static func syncEvery(_ normal: TimeInterval, on: Bool) -> TimeInterval { on ? max(normal, 240) : normal }

  /// The island's line under the leaf: "Asleep: Gmail, Squad chat and 12 more".
  static func line(_ names: [String], max: Int = 3) -> String {
    if names.isEmpty { return "Nothing is asleep" }
    let shown = Array(names.prefix(max)), rest = names.count - shown.count
    if rest > 0 { return "Asleep: \(shown.joined(separator: ", ")) and \(rest) more" }
    if shown.count == 1 { return "Asleep: \(shown[0])" }
    return "Asleep: \(shown.dropLast().joined(separator: ", ")) and \(shown.last!)"
  }
}
