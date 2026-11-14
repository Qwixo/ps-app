import Foundation
import CoreGraphics

// PS 1.60 (item 26), Welcome back on the island. Pure rules, no window, no sound, no clock of its own:
// tests/welcome-back-test.sh checks them while someone uses the Mac.
//
// After the Mac was left for more than 15 minutes (adjustable, with a switch, Settings), when the person unlocks it, it wakes,
// or they leave Sleep mode or Sentry mode, the island shrinks a little and grows into a panel: "Welcome back", "Tick any
// tasks you've done", the tasks they were working on as a tick list, a green Done. The web page (core/welcomeback.ts)
// says which tasks count as "working on" and the setting; this file says WHEN, how long "away" is, and what stops it.

struct WelcomeTask: Equatable { var id: String; var title: String }
struct WelcomeInput: Equatable {
  var on: Bool = true
  var minutes: Int = 15
  var tasks: [WelcomeTask] = []
}

/// How the Mac says the person is back.
enum WelcomeTrigger: String, CaseIterable { case unlock, wake, sleepModeEnded, sentryEnded }

/// What is in the way right now. Never during any of these: screen sharing, a full screen app (video), Do Not Disturb.
struct WelcomeBlock: Equatable {
  var screenLocked = false
  var screenSharing = false
  var fullScreen = false
  var dnd = false
  var any: Bool { screenSharing || fullScreen || dnd }
}

/// The time the person was last at the Mac. Sampled every `interval` seconds from the system's idle time (the time of
/// the last key or mouse move), so a Mac left on, left locked or put to sleep all read the same: the time since the last input.
struct AwayTracker: Equatable {
  static let interval: Double = 20
  private(set) var lastInput: Double?
  private(set) var lastSample: Double?

  /// One look. `idle`: seconds since the last input. `locked`: the screen is locked (the keys that unlock it must not
  /// count as time at the keys). A look after a gap (the Mac slept, or PS was stuck) is not trusted either: it is the
  /// way back, and the trigger handler reads the tracker before the next look.
  mutating func sample(now: Double, idle: Double, locked: Bool) {
    defer { lastSample = now }
    if locked { return }
    if let s = lastSample, now - s > AwayTracker.interval * 2.5 { return }
    let t = now - max(0, idle)
    lastInput = max(lastInput ?? t, t)
  }
  /// How long they were away at `now`. Unknown (PS just started): zero, never a welcome at launch.
  func away(now: Double) -> Double { lastInput.map { max(0, now - $0) } ?? 0 }
  /// They are back: a new stretch starts (a second trigger straight after, like wake then unlock, is no longer away).
  mutating func returned(now: Double) { lastInput = now }
}

enum WelcomeSkip: String, Equatable {
  case featureOff, off, noTasks, notLongEnough, sharing, fullScreen, dnd, justShown
}
enum WelcomeDecision: Equatable {
  /// Show it now.
  case show
  /// Not yet: the screen is locked after a wake, the unlock will come (nothing is used up).
  case wait
  /// Not this time: this stretch away is over.
  case skip(WelcomeSkip)
}

enum WelcomeBackCore {
  static let defaultMinutes = 15, minMinutes = 1, maxMinutes = 720
  /// Wake then unlock, or two modes ending, make two triggers within seconds: only the first shows.
  static let againAfter: Double = 120
  /// Most tasks in the list (the page sends up to this many).
  static let maxTasks = 6
  /// After a wake with no lock the screen needs a moment before anything is drawn on it.
  static let wakeDelay: Double = 1.6
  /// Nobody touches it: it goes by itself after this long (Esc and Done are the usual ways).
  static let autoClose: Double = 300

  static func clampMinutes(_ m: Int) -> Int { max(minMinutes, min(maxMinutes, m)) }

  /// The page's {welcome: {on, minutes, tasks: [{id, title}]}}, checked and capped. Missing: off with no tasks.
  static func parse(_ v: Any?) -> WelcomeInput {
    guard let d = v as? [String: Any] else { return WelcomeInput(on: false, minutes: defaultMinutes, tasks: []) }
    var i = WelcomeInput()
    i.on = (d["on"] as? Bool) != false
    let m = (d["minutes"] as? NSNumber)?.doubleValue
    i.minutes = m.flatMap { $0.isFinite ? clampMinutes(Int($0.rounded())) : nil } ?? defaultMinutes
    var seen = Set<String>()
    for x in (d["tasks"] as? [Any] ?? []).prefix(maxTasks * 2) {
      guard let t = x as? [String: Any], let id = t["id"] as? String, !id.isEmpty, id.count <= 200, !seen.contains(id) else { continue }
      let title = String(((t["title"] as? String) ?? "").replacingOccurrences(of: "\n", with: " ").prefix(120))
      seen.insert(id)
      i.tasks.append(WelcomeTask(id: id, title: title.isEmpty ? "Untitled task" : title))
      if i.tasks.count >= maxTasks { break }
    }
    return i
  }

  /// The whole rule. `sinceLastShown`: seconds since it last showed (nil: never since PS started).
  static func decide(trigger: WelcomeTrigger, away: Double, input: WelcomeInput, featureOn: Bool, islandOn: Bool, block: WelcomeBlock, sinceLastShown: Double?) -> WelcomeDecision {
    if !featureOn || !islandOn { return .skip(.featureOff) }
    if !input.on { return .skip(.off) }
    if let s = sinceLastShown, s < againAfter { return .skip(.justShown) }
    if away < Double(clampMinutes(input.minutes)) * 60 { return .skip(.notLongEnough) }
    if input.tasks.isEmpty { return .skip(.noTasks) }
    // A wake that lands on the lock screen waits for the unlock (that is a trigger of its own). Everything else about the
    // person's screen is a hard no.
    if block.screenLocked { return trigger == .unlock ? .skip(.notLongEnough) : .wait }
    if block.screenSharing { return .skip(.sharing) }
    if block.fullScreen { return .skip(.fullScreen) }
    if block.dnd { return .skip(.dnd) }
    return .show
  }

  // ---------- the tick list ----------
  /// The ticks the person made (by id, in the list's order), only for tasks that are in the list.
  static func ticked(_ tasks: [WelcomeTask], marks: Set<String>) -> [String] { tasks.map { $0.id }.filter { marks.contains($0) } }
  /// Toggling a row: ticks are kept as a set; an unknown id is ignored.
  static func toggle(_ marks: Set<String>, id: String, tasks: [WelcomeTask]) -> Set<String> {
    guard tasks.contains(where: { $0.id == id }) else { return marks }
    var m = marks
    if m.contains(id) { m.remove(id) } else { m.insert(id) }
    return m
  }
  /// What goes back to the page on Done: a JSON list of the ticked ids (web core/welcomeback.ts welcomeDoneIds reads it).
  static func doneJSON(_ ids: [String]) -> String {
    (try? JSONSerialization.data(withJSONObject: ids)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
  }
  /// The words on Done once ticks were made (the person sees what happened), or nothing to say.
  static func doneWords(ticks: Int) -> String? { ticks > 0 ? (ticks == 1 ? "1 task done" : "\(ticks) tasks done") : nil }

  // ---------- the words ----------
  static let title = "Welcome back"
  static let sub = "Tick any tasks you've done"
  static let done = "Done"

  // ---------- the panel's size ----------
  static let panelW: CGFloat = 360
  static let headH: CGFloat = 70, rowH: CGFloat = 36, rowGap: CGFloat = 4, doneH: CGFloat = 38, pad: CGFloat = 16
  static func panelH(rows: Int) -> CGFloat {
    let n = max(1, min(maxTasks, rows))
    return headH + CGFloat(n) * rowH + CGFloat(n - 1) * rowGap + pad + doneH + pad
  }
  /// The Face ID style moment after Done: a rounded square with a big tick.
  static let faceSize: CGFloat = 132, faceRadius: CGFloat = 38
  /// How long the tick shows before the island is itself again.
  static let faceHold: Double = 1.25
  /// The panel after the island's squeeze: it grows out of the island's width, then the words fade in.
  static let growDelay: Double = 0.18, contentDelay: Double = 0.3
}

/// Is the screen being shared? Best effort, from what is running and what is on screen (no private API, nothing read from
/// the shared content): Apple's Screen Sharing and Zoom's share helper run as their own processes while it is on, and the
/// conferencing apps put up a small "you are sharing your screen" window. The Mac side (BigIsland.swift ScreenShareProbe)
/// reads the names; this decides.
enum ScreenShareCore {
  static let processes: Set<String> = ["screensharingd", "ScreensharingAgent", "CptHost", "AEServer"]
  static let titleHints = ["is sharing your screen", "you are sharing", "you're sharing", "stop sharing", "stop share", "you are presenting", "presenting to everyone", "screen sharing"]
  static func isSharing(processes names: [String], windowTitles: [String]) -> Bool {
    if names.contains(where: { processes.contains($0) }) { return true }
    return windowTitles.contains { t in let l = t.lowercased(); return titleHints.contains { l.contains($0) } }
  }
}
