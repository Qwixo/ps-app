import Foundation
import CoreGraphics

// PS 1.60 (item 27), the workout summary on the Mac. The maths (best set, up, same or down, days ago, total time) is
// in the page (web core/workoutsummary.ts, tested there); the page sends the finished summary in the island's state as
// {workout: {...}}. This file checks it, decides WHEN it shows on this Mac, and holds the layout and the timing.
// Pure: no window, no sound, no clock of its own (tests/workout-summary-test.sh).
//
// Once per workout, never again on another Mac (answer 23): the Mac says it showed it ({islandAction workoutShown, id}) AS
// IT SHOWS, the page saves a mark on the workout itself (synced through the vault), and no other Mac is sent the summary
// again. This Mac also keeps the ids it showed (UserDefaults), so a slow sync never shows it twice here.

enum WorkoutTrend: String, Equatable { case up, same, down, new }

struct WorkoutRow: Equatable {
  var name: String
  var sets: Int
  var bestKg: Double?
  var bestReps: Int?
  var rir: String?
  var comment: String?
  var trend: WorkoutTrend
  var daysAgo: Int?
}
struct WorkoutSummaryIn: Equatable {
  var id: String
  var title: String
  var minutes: Int
  var sets: Int
  var rows: [WorkoutRow]
  var more: Int
}

enum WorkoutSummaryCore {
  static let maxRows = 6

  // ---------- from the page ----------
  /// The page's {workout: {...}}, checked and capped. nil: nothing waiting, or it does not look right.
  static func parse(_ v: Any?) -> WorkoutSummaryIn? {
    guard let d = v as? [String: Any], let id = d["id"] as? String, !id.isEmpty, id.count <= 200 else { return nil }
    func num(_ x: Any?) -> Double? { (x as? NSNumber).map { $0.doubleValue }.flatMap { $0.isFinite ? $0 : nil } }
    func str(_ x: Any?, _ n: Int) -> String? {
      let s = String(((x as? String) ?? "").replacingOccurrences(of: "\n", with: " ").prefix(n)).trimmingCharacters(in: .whitespaces)
      return s.isEmpty ? nil : s
    }
    var rows: [WorkoutRow] = []
    for x in (d["rows"] as? [Any] ?? []).prefix(maxRows) {
      guard let r = x as? [String: Any], let name = str(r["name"], 40) else { continue }
      let sets = Int(max(0, min(99, num(r["sets"]) ?? 0)))
      let kg = num(r["bestKg"]).map { max(0, min(2000, $0)) }
      let reps = num(r["bestReps"]).map { Int(max(0, min(999, $0))) }
      let trend = WorkoutTrend(rawValue: (r["trend"] as? String) ?? "") ?? .new
      let days = num(r["daysAgo"]).map { Int(max(0, min(3650, $0))) }
      rows.append(WorkoutRow(name: name, sets: sets, bestKg: kg, bestReps: reps, rir: str(r["rir"], 4), comment: str(r["comment"], 80), trend: trend, daysAgo: trend == .new ? nil : days))
    }
    guard !rows.isEmpty else { return nil }
    return WorkoutSummaryIn(id: id, title: str(d["title"], 30) ?? "Workout", minutes: Int(max(0, min(1440, num(d["minutes"]) ?? 0))),
                            sets: Int(max(0, min(999, num(d["sets"]) ?? 0))), rows: rows, more: Int(max(0, min(99, num(d["more"]) ?? 0))))
  }

  // ---------- when ----------
  /// "Back at the Mac and using it": the last input was this recently, the screen is not locked.
  static let usingWithin: Double = 20
  static let rememberLimit = 60

  enum Skip: String, Equatable { case featureOff, alreadyShown, locked, notUsing, sharing, fullScreen, dnd }
  enum Decision: Equatable {
    case show
    /// Not now, but still waiting: this Mac asks again (nothing is marked shown).
    case wait(Skip)
    /// Never on this Mac.
    case skip(Skip)
  }
  static func decide(_ s: WorkoutSummaryIn?, shownHere: Set<String>, featureOn: Bool, islandOn: Bool, idle: Double, block: WelcomeBlock) -> Decision {
    guard let s else { return .skip(.featureOff) }
    if !featureOn || !islandOn { return .skip(.featureOff) }
    if shownHere.contains(s.id) { return .skip(.alreadyShown) }
    if block.screenLocked { return .wait(.locked) }
    if idle > usingWithin { return .wait(.notUsing) }
    if block.screenSharing { return .wait(.sharing) }
    if block.fullScreen { return .wait(.fullScreen) }
    if block.dnd { return .wait(.dnd) }
    return .show
  }
  /// The ids this Mac showed, newest last, capped.
  static func remember(_ id: String, in list: [String]) -> [String] {
    var l = list.filter { $0 != id }; l.append(id)
    return l.count > rememberLimit ? Array(l.suffix(rememberLimit)) : l
  }

  // ---------- the words ----------
  static let headline = "Workout complete"
  static let congrats = "Nice work"
  static let firstTime = "First time"
  static func gymTime(_ minutes: Int) -> String {
    minutes <= 0 ? "" : minutes < 60 ? "\(minutes) min" : (minutes % 60 == 0 ? "\(minutes / 60) h" : "\(minutes / 60) h \(minutes % 60) min")
  }
  static func summaryLine(_ s: WorkoutSummaryIn) -> String {
    let n = s.sets, t = gymTime(s.minutes)
    let sets = "\(n) set\(n == 1 ? "" : "s")"
    return t.isEmpty ? sets : "\(t) in the gym, \(sets)"
  }
  static func kgText(_ kg: Double) -> String {
    let r = (kg * 100).rounded() / 100
    return r == r.rounded() ? String(Int(r)) : String(r)
  }
  /// "82.5 kg x 8"
  static func bestLine(_ r: WorkoutRow) -> String {
    let w = r.bestKg.map { "\(kgText($0)) kg" } ?? ""
    return "\(w) x \(r.bestReps ?? 0)".trimmingCharacters(in: .whitespaces)
  }
  static func agoWords(_ n: Int) -> String { n <= 0 ? "today" : n == 1 ? "yesterday" : "\(n) days ago" }
  /// "Up, last time 7 days ago", "Same, last time yesterday", "Down, last time 3 days ago", "First time".
  static func trendWords(_ r: WorkoutRow) -> String {
    guard r.trend != .new, let d = r.daysAgo else { return firstTime }
    let w = r.trend == .up ? "Up" : r.trend == .down ? "Down" : "Same"
    return "\(w), last time \(agoWords(d))"
  }
  /// How it felt: the person's own comment, and the RIR ("2 in reserve", "4 or more in reserve").
  static func feltWords(_ r: WorkoutRow) -> String? {
    var parts: [String] = []
    if let x = r.rir { parts.append(x == "4+" ? "4 or more in reserve" : "\(x) in reserve") }
    if let c = r.comment { parts.append(c) }
    return parts.isEmpty ? nil : parts.joined(separator: ", ")
  }

  // ---------- the layout ----------
  static let panelW: CGFloat = 372
  static let headH: CGFloat = 78, summaryH: CGFloat = 30, rowH: CGFloat = 50, rowFeltH: CGFloat = 16, pad: CGFloat = 16
  /// The first part: "Workout complete" with the congratulation, the island only a little bigger.
  static let announceSize = CGSize(width: 300, height: 78)
  static func rowHeight(_ r: WorkoutRow) -> CGFloat { rowH + (feltWords(r) == nil ? 0 : rowFeltH) }
  static func panelH(_ s: WorkoutSummaryIn) -> CGFloat {
    headH + summaryH + s.rows.reduce(0) { $0 + rowHeight($1) } + CGFloat(s.rows.count - 1) * 6 + (s.more > 0 ? 22 : 0) + pad
  }

  // ---------- the timing (seconds after it starts) ----------
  struct Timeline: Equatable {
    /// "Workout complete" with a big pop and the chime.
    var announceAt: Double
    /// The congratulation under it, a soft sound.
    var congratsAt: Double
    /// The island grows into the summary.
    var growAt: Double
    /// The totals line, a soft sound.
    var totalsAt: Double
    /// Each exercise comes in, a soft sound each (the first at rowsAt, then every rowGap).
    var rowsAt: Double
    var rowGap: Double
    /// It goes by itself after this long (Esc or a click closes it sooner).
    var autoClose: Double
  }
  static func timeline(reduceMotion: Bool) -> Timeline {
    reduceMotion ? Timeline(announceAt: 0, congratsAt: 0.2, growAt: 0.9, totalsAt: 1.1, rowsAt: 1.3, rowGap: 0.1, autoClose: 18)
                 : Timeline(announceAt: 0, congratsAt: 0.55, growAt: 1.9, totalsAt: 2.3, rowsAt: 2.6, rowGap: 0.2, autoClose: 18)
  }
  static func rowAt(_ i: Int, _ t: Timeline) -> Double { t.rowsAt + Double(i) * t.rowGap }
  /// When the last part is in.
  static func settledAt(rows: Int, _ t: Timeline) -> Double { rowAt(max(0, rows - 1), t) + 0.4 }
  /// Soft sounds, one per part: the chime at the top, then a quiet tick for each part that comes in. Each is (time, tone).
  enum SoundKind: String, Equatable { case chime, soft }
  static func sounds(rows: Int, soundOn: Bool, dnd: Bool, _ t: Timeline) -> [(at: Double, kind: SoundKind)] {
    guard soundOn, !dnd else { return [] }
    var out: [(Double, SoundKind)] = [(t.announceAt, .chime), (t.congratsAt, .soft), (t.totalsAt, .soft)]
    for i in 0..<rows { out.append((rowAt(i, t), .soft)) }
    return out.map { (at: $0.0, kind: $0.1) }
  }
}
