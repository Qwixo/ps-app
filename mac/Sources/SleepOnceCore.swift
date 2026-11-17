// PS 1.65 "Just tomorrow" on the Sleep screen: the pure rules (SleepScreen.swift draws the line and the pills).
// The page sends `once` inside the sleep plan: the line to show ("Just tomorrow: 09:00"), the usual wake time and every
// word to show (nothing is written here in English). A choice goes back to the page only after Touch ID or the Mac
// password passed (gate). The page can also ask for Touch ID itself (Settings): sleep:auth, answered with authOk.
// Pure Foundation: no window, no Touch ID, so tests/sleeponce-test.sh builds this file alone.
import Foundation

enum SleepOnce {
  struct Min: Equatable { let mins: Int; let label: String }
  struct Words: Equatable {
    var title = "", skip = "", later = "", pick = "", undo = "", save = "", reason = "", undoReason = ""
    var mins: [Min] = []
  }
  /// The `once` part of the plan. Nil from parse: the feature is off or there is no alarm, nothing is drawn.
  struct Plan: Equatable {
    var set: Bool
    var skipped: Bool
    var line: String
    var usual: String
    var words: Words
  }
  /// What the person chose. Each one becomes one small JSON line for the page.
  enum Act: Equatable {
    case skip
    case later(Int)
    case pick(String)
    case undo
  }

  static let idleSeconds: Double = 20
  static let maxLater = 24 * 60

  // MARK: reading the plan

  private static func text(_ d: [String: Any], _ k: String, _ cap: Int) -> String {
    guard let s = d[k] as? String else { return "" }
    return String(s.trimmingCharacters(in: .whitespacesAndNewlines).prefix(cap))
  }

  /// Checked: wrong types are dropped, text is capped, a line or usual time that is missing or bad means nil.
  static func parse(_ any: Any?) -> Plan? {
    guard let d = any as? [String: Any] else { return nil }
    let line = text(d, "line", 160)
    let usual = text(d, "usual", 5)
    guard !line.isEmpty, validTime(usual) else { return nil }
    var w = Words()
    let ws = (d["words"] as? [String: Any]) ?? [:]
    w.title = text(ws, "title", 60); w.skip = text(ws, "skip", 40); w.later = text(ws, "later", 40); w.pick = text(ws, "pick", 40)
    w.undo = text(ws, "undo", 40); w.save = text(ws, "save", 40); w.reason = text(ws, "reason", 80); w.undoReason = text(ws, "undoReason", 80)
    w.mins = ((ws["mins"] as? [[String: Any]]) ?? []).prefix(12).compactMap { m in
      guard let n = (m["mins"] as? NSNumber)?.intValue, n >= 1, n <= maxLater else { return nil }
      let label = text(m, "label", 30)
      return label.isEmpty ? nil : Min(mins: n, label: label)
    }.prefix(4).map { $0 }
    return Plan(set: d["set"] as? Bool ?? false, skipped: d["skipped"] as? Bool ?? false, line: line, usual: usual, words: w)
  }

  // MARK: times

  /// "HH:MM", 00:00 to 23:59.
  static func validTime(_ s: String) -> Bool {
    s.range(of: "^([01][0-9]|2[0-3]):[0-5][0-9]$", options: .regularExpression) != nil
  }
  static func minutes(_ s: String) -> Int? {
    guard validTime(s) else { return nil }
    let p = s.split(separator: ":")
    guard p.count == 2, let h = Int(p[0]), let m = Int(p[1]) else { return nil }
    return h * 60 + m
  }
  static func clock(_ mins: Int) -> String {
    let m = ((mins % 1440) + 1440) % 1440
    return String(format: "%02d:%02d", m / 60, m % 60)
  }
  /// Where the hour and minute picker starts: the usual time plus one hour, wrapping past midnight (23:30 gives 00:30).
  static func pickStart(usual: String) -> String? {
    minutes(usual).map { clock($0 + 60) }
  }

  // MARK: what goes to the page

  /// The one JSON line for a choice, or nil when the choice itself is not valid (a bad time, minutes out of range).
  static func json(_ act: Act) -> String? {
    switch act {
    case .skip: return "{\"once\":{\"act\":\"skip\"}}"
    case .undo: return "{\"once\":{\"act\":\"undo\"}}"
    case .later(let m):
      guard m >= 1, m <= maxLater else { return nil }
      return "{\"once\":{\"act\":\"later\",\"mins\":\(m)}}"
    case .pick(let at):
      guard validTime(at) else { return nil }
      return "{\"once\":{\"act\":\"pick\",\"at\":\"\(at)\"}}"
    }
  }
  /// The gate: the JSON only when Touch ID or the password passed. Not passed: nil, nothing is sent.
  static func gate(authPassed: Bool, _ act: Act) -> String? {
    authPassed ? json(act) : nil
  }
  /// The sentence the system sheet shows for a choice (Undo has its own).
  static func reason(for act: Act, words w: Words) -> String {
    let r: String
    if case .undo = act { r = w.undoReason.isEmpty ? w.reason : w.undoReason } else { r = w.reason }
    return cleanReason(r)
  }

  // MARK: the page asks for Touch ID (sleep:auth)

  /// 1 to 24 letters, digits, underscore or hyphen.
  static func okAuthId(_ s: Any?) -> String? {
    guard let s = s as? String, s.range(of: "^[A-Za-z0-9_-]{1,24}$", options: .regularExpression) != nil else { return nil }
    return s
  }
  /// Short text for the system sheet: at most 80 characters, never empty (the sheet needs something).
  static func cleanReason(_ s: String) -> String {
    let t = String(s.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
    return t.isEmpty ? "PS" : t
  }
  /// The answer to the page: authOk, and authNone when this Mac cannot ask at all.
  static func authReply(id: String, ok: Bool, none: Bool) -> String? {
    guard okAuthId(id) != nil else { return nil }
    return "{\"authId\":\"\(id)\"\(none && !ok ? ",\"authNone\":true" : ""),\"authOk\":\(ok ? "true" : "false")}"
  }

  /// One sheet at a time, shared by the pills and the page's request: begin() is false while one is open.
  struct Latch {
    private(set) var busy = false
    mutating func begin() -> Bool { if busy { return false }; busy = true; return true }
    mutating func end() { busy = false }
  }
}
