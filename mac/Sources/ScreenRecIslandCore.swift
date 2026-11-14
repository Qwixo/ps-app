// Screen recorder, the island side (PS 1.60, pull request 12b). Pure values and small state machines, Foundation only: no windows,
// no sounds, no clock of its own, no capture. tests/screenrec-island-test.sh checks every rule with fake clocks, fake samplers and
// a fake capture. ScreenRecIsland.swift is the thin part that reads real macOS and draws.
//
// What lives here:
//  - the meeting found rule (a meeting starting now, OR a meeting app window open with the mic in use) and the filter that
//    never looks at 1Password or Signal (rule 7): their window text is not even asked for;
//  - the meeting start order: "Start private mode?" first, then "Do you want to record this meeting?", never together;
//  - the cards and their words, one card at a time through the shared island queue, and private mode hiding every sign and
//    sound about the recording (held cards come out, in order, when it goes off);
//  - the recording part of the island (red dot, name, running time) and how it comes back after private mode;
//  - the performance watch: thresholds, the quiet adjust ladder (never below Tiny), the 30 second rule, "No" means do not ask
//    again unless much worse, and the disk nearly full stop.
// The setting the person chooses: SRSettings.askMeetings and SRSettings.perfWatch (ScreenRecCore.swift).
import Foundation

// ---------- what a meeting is, and what is never looked at ----------
enum SRMeetingApps {
  /// Apps PS never reads anything about, in any build (rule 7): not their names, titles, windows or audio. Checked FIRST, on the
  /// owning app's name or bundle id only, before anything else is asked of the window.
  static func isBlocked(owner: String, bundle: String? = nil) -> Bool {
    let o = owner.lowercased(), b = (bundle ?? "").lowercased()
    for bad in ["1password", "signal"] where o.contains(bad) || b.contains(bad) { return true }
    return false
  }
  static let browsers = ["google chrome", "safari", "firefox", "microsoft edge", "arc", "brave browser", "opera", "vivaldi"]
  /// Which meeting app this window belongs to ("Zoom", "Google Meet", "Teams", "FaceTime"), or nil. `title` is only asked for a
  /// browser window, and never for a blocked app: a closure, so a test can prove it was never called.
  static func classify(owner: String, bundle: String? = nil, title: () -> String?) -> String? {
    if isBlocked(owner: owner, bundle: bundle) { return nil }
    let o = owner.lowercased()
    if o == "zoom.us" || o == "zoom" { return "Zoom" }
    if o == "microsoft teams" || o == "microsoft teams (work or school)" || o == "teams" { return "Teams" }
    if o == "facetime" { return "FaceTime" }
    if browsers.contains(o) {
      let t = (title() ?? "").lowercased()
      if t.hasPrefix("meet -") || t.hasPrefix("meet \u{2013}") || t.contains("meet.google.com") { return "Google Meet" }
    }
    return nil
  }
}

struct SRMeetingFacts: Equatable {
  /// A meeting in the Meetings panel that is on now (the page sends its name and a key, hidden meetings already left out).
  var calendarName: String? = nil
  var calendarKey: String? = nil
  /// The meeting apps with a window open (labels from SRMeetingApps.classify).
  var appWindows: [String] = []
  /// The default microphone is in use by some app.
  var micInUse = false
}
struct SRFound: Equatable { var name: String; var key: String; var fromCalendar: Bool }

enum SRMeetingRule {
  /// The rule: a meeting starting now in the Meetings panel, OR a meeting app window is open with the mic in use.
  static func found(_ f: SRMeetingFacts) -> SRFound? {
    if let n = f.calendarName?.trimmingCharacters(in: .whitespacesAndNewlines), !n.isEmpty {
      return SRFound(name: n, key: "cal:" + (f.calendarKey ?? n), fromCalendar: true)
    }
    if f.micInUse, let app = f.appWindows.sorted().first { return SRFound(name: "\(app) call", key: "app:" + app, fromCalendar: false) }
    return nil
  }
}

// ---------- the order at the start of a meeting ----------
/// What the controller of the question knows right now.
struct SRAskInputs: Equatable {
  var gateOpen = true             // screen recording is on (the person said yes, the feature is on in this build)
  var askMeetings = true          // the Settings switch
  var recordingBusy = false       // already starting, recording, paused or stopping
  var privateOn = false           // private mode: nothing about recording is shown
  var privateAskPending = false   // "Start private mode?" is on the island, waiting, or about to come: it goes first
  var recordAskOpen = false       // the record question is on the island or queued already
}

/// "Start private mode?" and "Do you want to record this meeting?" are never shown together: the private question first, the
/// record question right after it is answered (or gone), both through the island queue. Nothing runs while the feature is off.
struct SRAskFlow {
  private(set) var asked: Set<String> = []      // asked for this meeting already (answered or not): never twice
  private(set) var declined: Set<String> = []   // the person said No
  private(set) var lastFoundKey: String? = nil

  /// One look. Returns the meeting to ask about, or nil. The key is marked asked only when it is returned.
  mutating func look(_ found: SRFound?, _ i: SRAskInputs) -> SRFound? {
    // No asks while the feature is off or switched off: nothing here even remembers the meeting.
    guard i.gateOpen, i.askMeetings else { return nil }
    // A meeting app window with the mic in use ended: its "No" is forgotten, so the next call asks again.
    if found?.key != lastFoundKey { if let k = lastFoundKey, k.hasPrefix("app:") { declined.remove(k); asked.remove(k) }; lastFoundKey = found?.key }
    guard let f = found else { return nil }
    guard !i.recordingBusy, !i.recordAskOpen, !asked.contains(f.key), !declined.contains(f.key) else { return nil }
    if i.privateAskPending || i.privateOn { return nil }   // the private question first; nothing about recording while private mode is on
    asked.insert(f.key)
    return f
  }
  mutating func answered(_ key: String, yes: Bool) { if !yes { declined.insert(key) } }
}

// ---------- the moments and their cards ----------
enum SRMoment: Equatable {
  case recordAsk(name: String, key: String, choice: SRAskChoice)
  case perfAsk
  case saved(fileName: String)
  case diskStop(why: String)
  case controls(paused: Bool)
}
/// The chip on the record question: tap to change. Presets first, then audio only.
enum SRAskChoice: String, CaseIterable, Equatable {
  case calls, sharp, tiny, audioOnly
  var label: String { switch self { case .calls: return "Calls"; case .sharp: return "Sharp"; case .tiny: return "Tiny"; case .audioOnly: return "Audio only" } }
  var next: SRAskChoice { let all = SRAskChoice.allCases; return all[(all.firstIndex(of: self)! + 1) % all.count] }
  /// Applies the choice to the settings: a preset (and screen and audio), or audio only (the preset stays).
  func apply(to s: SRSettings) -> SRSettings {
    var o = s
    switch self {
    case .calls: o = SRPresets.apply(.calls, to: o); o.mode = .screenAndAudio
    case .sharp: o = SRPresets.apply(.sharp, to: o); o.mode = .screenAndAudio
    case .tiny: o = SRPresets.apply(.tiny, to: o); o.mode = .screenAndAudio
    case .audioOnly: o.mode = .audioOnly
    }
    return o
  }
  static func from(_ s: SRSettings) -> SRAskChoice {
    if s.mode == .audioOnly { return .audioOnly }
    switch SRPresets.detect(s) { case .sharp: return .sharp; case .tiny: return .tiny; default: return .calls }
  }
}

struct SRCard: Equatable {
  var id: String
  var title: String
  var sub: String?
  var body: String?
  var actions: [(id: String, label: String)]
  var sticky = true
  static func == (a: SRCard, b: SRCard) -> Bool { a.id == b.id && a.title == b.title && a.sub == b.sub && a.body == b.body && a.actions.map { $0.id } == b.actions.map { $0.id } }
}

enum SRWords {
  static let askTitle = "Do you want to record this meeting?"
  static let yes = "Yes", no = "No"
  static let perfTitle = "Resources are high. Stop screen recording?"
  static let perfYes = "Yes, stop recording", perfNo = "No, keep recording"
  static let perfBody = "Your Mac is struggling. PS already made the recording a little lighter."
  static let savedTitle = "Saved"
  static let showInFinder = "Show in Finder", playInPS = "Play"
  static let diskTitle = "Recording stopped and saved"
  static let diskWhy = "The disk was nearly full, so PS stopped and saved the recording before it ran out."
  static let pause = "Pause", resume = "Resume", stop = "Stop and save"
  static let recording = "Recording", paused = "Paused"
  static let countIn = "Recording starts in"
  /// Added to a recording's details when the performance watch made it lighter.
  static func lowered(_ what: String) -> String { "PS lowered the \(what) because the Mac was struggling." }
  static let all: [String] = [askTitle, yes, no, perfTitle, perfYes, perfNo, perfBody, savedTitle, showInFinder, playInPS, diskTitle, diskWhy,
                              pause, resume, stop, recording, paused, countIn]
}

enum SRCards {
  static let askId = "sr:ask", perfId = "sr:perf", savedId = "sr:saved", diskId = "sr:disk", menuId = "sr:menu"
  /// Card text is cut to what Toast.showCard accepts (title 160, sub 200, body 600, labels 24, ids 20, three buttons).
  static func card(_ m: SRMoment, settings: SRSettings? = nil) -> SRCard {
    switch m {
    case .recordAsk(let name, _, let choice):
      let what = choice == .audioOnly ? "Audio only" : "Screen and audio, \(choice.label)"
      return SRCard(id: askId, title: SRWords.askTitle, sub: name, body: what + ". Tap the last button to change it.",
                    actions: [("yes", SRWords.yes), ("no", SRWords.no), ("chip", choice.label)])
    case .perfAsk:
      return SRCard(id: perfId, title: SRWords.perfTitle, sub: nil, body: SRWords.perfBody, actions: [("stop", SRWords.perfYes), ("keep", SRWords.perfNo)])
    case .saved(let f):
      return SRCard(id: savedId, title: SRWords.savedTitle, sub: f, body: nil, actions: [("play", SRWords.playInPS), ("show", SRWords.showInFinder)], sticky: false)
    case .diskStop(let why):
      return SRCard(id: diskId, title: SRWords.diskTitle, sub: why, body: nil, actions: [("ok", "OK")])
    case .controls(let paused):
      return SRCard(id: menuId, title: SRWords.recording, sub: nil, body: nil,
                    actions: [(paused ? "resume" : "pause", paused ? SRWords.resume : SRWords.pause), ("stop", SRWords.stop), ("mic", "Switch mic")])
    }
  }
}

// ---------- private mode: nothing about the recording is shown or heard ----------
enum SRPrivacy {
  /// A moment about the recording is shown only while private mode is off.
  static func mayShow(privateOn: Bool) -> Bool { !privateOn }
  /// The sound for a moment: nil while private mode is on, with the sound switch off, or when Do Not Disturb mutes sounds.
  static func chime(_ kind: String, privateOn: Bool, soundsOn: Bool, dndMutes: Bool) -> String? {
    guard !privateOn, soundsOn, !dndMutes else { return nil }
    switch kind {
    case "start": return "island-start"
    case "saved": return "island-done"
    case "warn": return "island-start"
    default: return nil
    }
  }
}

/// Cards that came while private mode was on wait here, in order, and come out when it goes off (a stale one is dropped).
struct SRHold {
  static let keepFor: TimeInterval = 600
  static let most = 5
  private(set) var held: [(m: SRMoment, at: Date)] = []
  /// Returns the moment to show now, or nil when it is held.
  mutating func offer(_ m: SRMoment, privateOn: Bool, now: Date) -> SRMoment? {
    if SRPrivacy.mayShow(privateOn: privateOn) { return m }
    held.append((m, now)); if held.count > SRHold.most { held.removeFirst() }
    return nil
  }
  /// Private mode went off: what is still fresh, in the order it came.
  mutating func release(now: Date) -> [SRMoment] {
    let out = held.filter { now.timeIntervalSince($0.at) <= SRHold.keepFor }.map { $0.m }
    held = []
    return out
  }
}

/// One card at a time: every moment goes through IslandQueueCore (the same rules as the real IslandQueue). Nothing here draws.
struct SRCardLane {
  var queue = IslandQueueCore()
  private(set) var shown: [String] = []     // the ids that became active, in order (the tests read this)
  mutating func submit(_ c: SRCard, now: Date) -> IslandQueueCore.Outcome {
    let o = queue.enqueue(id: c.id, kind: "screenrec", priority: .normal, ttl: 300, now: now)
    if o == .showNow { shown.append(c.id) }
    return o
  }
  mutating func finish(_ id: String, now: Date) { queue.finish(id, now: now) }
  mutating func step(now: Date) { let r = queue.step(now: now, activeIsVisible: true); if let p = r.promote { shown.append(p.id) } }
}

// ---------- the recording part of the island ----------
/// What the island part draws, and when it comes back with a soft animation.
struct SRPartTracker {
  private var wasHidden = false
  struct Shown: Equatable { var display: SRSnapshot.Display; var comesBack: Bool; var name: String }
  /// `name`: the meeting name, or "Recording". Private mode: no part at all (comesBack is true on the first frame after it).
  mutating func view(_ snap: SRSnapshot, now: Date, privateOn: Bool, name: String?) -> Shown? {
    guard snap.isRecording else { wasHidden = false; return nil }
    if privateOn { wasHidden = true; return nil }
    let d = snap.display(now: now, privateMode: false)
    let back = wasHidden; wasHidden = false
    let n = (name ?? "").trimmingCharacters(in: .whitespaces)
    return Shown(display: d, comesBack: back, name: n.isEmpty ? SRWords.recording : String(n.prefix(40)))
  }
}

enum SRCountIn {
  /// Yes starts the recording after a short count in (3, 2, 1) and a chime. Private mode or reduced motion: no count, no chime.
  static func seconds(privateOn: Bool, reduceMotion: Bool) -> Int { privateOn || reduceMotion ? 0 : 3 }
}

// ---------- the performance watch ----------
enum SRThermal: Int, Comparable { case nominal = 0, fair, serious, critical
  static func < (a: SRThermal, b: SRThermal) -> Bool { a.rawValue < b.rawValue } }
enum SRMemory: Int, Comparable { case normal = 0, warning, critical
  static func < (a: SRMemory, b: SRMemory) -> Bool { a.rawValue < b.rawValue } }

/// One look at the Mac. Every value is read by ScreenRecIsland.swift (thermalState, a memory pressure source, host CPU load,
/// volumeAvailableCapacityForImportantUsage, IOPowerSources) or counted from the stream (frame gaps).
struct SRSample: Equatable {
  var cpu: Double = 0                 // 0 to 1, the whole Mac's busy share
  var thermal: SRThermal = .nominal
  var memory: SRMemory = .normal
  var diskFree: Int64 = Int64.max     // bytes free on the recording folder's volume
  var onBattery = false
  var batteryPct: Int? = nil
  var lowPower = false
  var dropRatio: Double = 0           // gaps in the frames over the last sample window (0 to 1)
}
enum SRLevel: Int, Comparable { case ok = 0, high, severe
  static func < (a: SRLevel, b: SRLevel) -> Bool { a.rawValue < b.rawValue } }

enum SRThresholds {
  static let cpuHigh = 0.85, cpuSevere = 0.97
  static let dropHigh = 0.15, dropSevere = 0.5
  static let batteryLow = 10
  /// How long it must stay high, after the last quiet adjust, before the island asks.
  static let askAfter: TimeInterval = 30
  /// A quiet adjust gets this long to show its effect before the next one.
  static let settle: TimeInterval = 8
  /// A "No" is only asked again when it gets MUCH worse: severe, having been merely high at the time.
  static let sampleEvery: TimeInterval = 4
  /// Room that must stay free: five minutes of this recording, never less than 300 MB.
  static func diskStop(bytesPerHour: Int64) -> Int64 { max(300_000_000, bytesPerHour / 12) }

  /// The CPU is judged over the last few samples (a spike is not trouble).
  static func level(_ s: SRSample, cpuAvg: Double) -> SRLevel {
    if s.thermal >= .critical || s.memory >= .critical || cpuAvg >= cpuSevere || s.dropRatio >= dropSevere { return .severe }
    if s.thermal >= .serious || s.memory >= .warning || cpuAvg >= cpuHigh || s.dropRatio >= dropHigh { return .high }
    return .ok
  }
}

/// A quiet step: lower the frame rate, then the resolution, then the quality. Never below the Tiny preset (720p, 15, small file).
enum SRStep: Equatable { case fps(Int), resolution(SRResolution), quality(SRQuality)
  var words: String {
    switch self { case .fps: return "frame rate"; case .resolution: return "resolution"; case .quality: return "quality" }
  }
}
struct SRAdjustable { var fps = true, resolution = true, quality = true }   // what the real capture can change while it runs

enum SRLadder {
  static func next(_ cur: (res: SRResolution, fps: Int, quality: SRQuality), can: SRAdjustable = SRAdjustable(), screenH: Int) -> SRStep? {
    // 1. the frame rate: 60, 30, 15 (15 is Tiny's own)
    if can.fps, let f = [60, 30, 15].first(where: { $0 < cur.fps }), f >= 15 { return .fps(f) }
    // 2. the resolution: down to 720p, never above what it is and never below 720p. "Same as screen" first goes to 1080p (or 720p on a screen that small).
    if can.resolution {
      let h = cur.res.height ?? screenH
      let order: [SRResolution] = [.p2160, .p1440, .p1080, .p720]
      if h > 720, let r = order.first(where: { ($0.height ?? 0) < h && ($0.height ?? 0) >= 720 }) { return .resolution(r) }
    }
    // 3. the quality: Best, High, Balanced, Small file (never lower than Small, which is Tiny's)
    if can.quality {
      switch cur.quality { case .best: return .quality(.high); case .high: return .quality(.balanced); case .balanced: return .quality(.small); case .small: break }
    }
    return nil
  }
}

/// SCStream has no dropped frame counter, so the gaps are counted here: every frame the stream hands over (even an idle one, so a
/// still screen is not a drop) notes its time; a gap of more than two and a half frame intervals counts the frames that are missing.
struct SRFrameGaps {
  private var last: Double?
  private(set) var frames = 0
  private(set) var missed = 0
  mutating func note(at t: Double, interval: Double) {
    frames += 1
    if let l = last, interval > 0, t - l > interval * 2.5 { missed += max(1, Int(((t - l) / interval).rounded()) - 1) }
    last = t
  }
  /// The writer was not ready for a picture: that one is lost.
  mutating func notReady() { missed += 1 }
  /// A pause or a resume breaks the line: the gap while paused is not a drop.
  mutating func breakLine() { last = nil }
  /// The share of frames missed since the last look, then starts again.
  mutating func ratioAndReset() -> Double {
    let total = frames + missed
    let r = total > 0 ? Double(missed) / Double(total) : 0
    frames = 0; missed = 0
    return min(1, r)
  }
}

enum SRPerfAction: Equatable {
  case adjust(SRStep)
  case ask            // show "Resources are high. Stop screen recording?"
  case stopForDisk    // stop and save now, then say why
}

/// The watch for ONE recording. It only runs between begin() and end(): nothing is sampled while no recording runs. The caller
/// feeds a sample every few seconds (SRThresholds.sampleEvery) and does what comes back; no clock of its own, no busy loop.
struct SRPerfWatch {
  private(set) var running = false
  private var cur: (res: SRResolution, fps: Int, quality: SRQuality) = (.p1080, 15, .balanced)
  private var screenH = 1080
  private var can = SRAdjustable()
  private var bytesPerHour: Int64 = 0
  private var cpuWindow: [Double] = []
  private var highSince: Date? = nil
  private var lastAdjust: Date? = nil
  private(set) var asked = false          // the question was shown this recording
  private(set) var declined = false       // the person said No
  private var levelAtDecline: SRLevel = .ok
  private var askOpen = false
  private var diskStopped = false
  private(set) var lowered: [String] = []  // what was lowered, for the recording's details

  mutating func begin(res: SRResolution, fps: Int, quality: SRQuality, screenH: Int, can: SRAdjustable, bytesPerHour: Int64) {
    self = SRPerfWatch()
    running = true; cur = (res, fps, quality); self.screenH = screenH; self.can = can; self.bytesPerHour = bytesPerHour
  }
  mutating func end() { self = SRPerfWatch() }

  /// The person's answer to the question. No: do not ask again this recording unless it gets much worse.
  mutating func answered(stop: Bool) {
    askOpen = false
    if !stop { declined = true; levelAtDecline = lastLevel }
  }
  private var lastLevel: SRLevel = .ok

  /// `canShow`: false while private mode is on (nothing about the recording is shown, so the question waits; it is not used up).
  mutating func feed(_ s: SRSample, now: Date, canShow: Bool = true) -> [SRPerfAction] {
    guard running else { return [] }
    var out: [SRPerfAction] = []
    // Disk nearly full: stop and save before it fills. Once.
    if !diskStopped, s.diskFree < SRThresholds.diskStop(bytesPerHour: bytesPerHour) { diskStopped = true; return [.stopForDisk] }
    if diskStopped { return [] }
    cpuWindow.append(s.cpu); if cpuWindow.count > 3 { cpuWindow.removeFirst() }
    let avg = cpuWindow.reduce(0, +) / Double(cpuWindow.count)
    let level = SRThresholds.level(s, cpuAvg: avg)
    lastLevel = level
    guard level >= .high else { highSince = nil; return [] }
    if highSince == nil { highSince = now }
    // Quiet first: one step now, the next only after it had time to show.
    if lastAdjust == nil || now.timeIntervalSince(lastAdjust!) >= SRThresholds.settle,
       let step = SRLadder.next(cur, can: can, screenH: screenH) {
      switch step { case .fps(let f): cur.fps = f; case .resolution(let r): cur.res = r; case .quality(let q): cur.quality = q }
      lastAdjust = now; lowered.append(step.words)
      out.append(.adjust(step))
      return out
    }
    // Still high about 30 seconds after the last quiet step (or after it began, when nothing could be lowered): ask.
    let since = max(highSince ?? now, lastAdjust ?? highSince ?? now)
    guard now.timeIntervalSince(since) >= SRThresholds.askAfter, canShow, !askOpen else { return out }
    if declined { guard level > levelAtDecline else { return out } }   // only when much worse than when they said No
    else if asked { return out }
    asked = true; askOpen = true
    out.append(.ask)
    return out
  }
}

// ---------- the brain: the recorder, the watch and the island moments together ----------
/// A capture that can be made lighter while it runs (the real one changes its frame rate; the file's picture size is fixed once
/// the file is open, so the real one says no to the resolution and quality steps and the ladder skips them).
protocol SRAdjustableCapture {
  var canAdjust: SRAdjustable { get }
  func adjust(_ s: SRStep)
}

/// Ties SRController (12a) to the island moments. Everything that could reach capture or draw something checks the gate first, so
/// while screen recording is off nothing here runs: no meeting looks, no samples, no cards.
final class SRIslandBrain {
  let controller: SRController
  var flow = SRAskFlow()
  var watch = SRPerfWatch()
  var hold = SRHold()
  var now: () -> Date = { Date() }
  var privateOn: () -> Bool = { false }
  var dndMutesSounds: () -> Bool = { false }
  var adjuster: SRAdjustableCapture?
  /// Show one card (the real one goes through Toast.showCard and the shared island queue, so one at a time) and play its sound.
  var emit: (SRCard, String?) -> Void = { _, _ in }
  /// The question about the meeting, and the answer, are kept until it is answered.
  private(set) var openAsk: (key: String, choice: SRAskChoice)?
  private var prev: SRRunState = .off
  private var wasPrivate = false
  private(set) var meetingName: String?
  var diskBytesPerHour: () -> Int64 = { 0 }
  var screenH: () -> Int = { 1080 }

  init(controller: SRController) { self.controller = controller; prev = controller.snapshot.state }

  private var settings: SRSettings { controller.settings }
  private var busy: Bool { switch controller.snapshot.state { case .starting, .recording, .paused, .stopping: return true; default: return false } }

  private func show(_ m: SRMoment, sound: String?) {
    guard let go = hold.offer(m, privateOn: privateOn(), now: now()) else { return }
    emit(SRCards.card(go), SRPrivacy.chime(sound ?? "", privateOn: privateOn(), soundsOn: settings.sounds, dndMutes: dndMutesSounds()))
  }

  // ----- a meeting -----
  /// Called every few seconds with what the Mac and the page can see. Returns true when the question was shown.
  @discardableResult func meetingTick(_ facts: SRMeetingFacts, privateAskPending: Bool) -> Bool {
    let inputs = SRAskInputs(gateOpen: controller.gateOpen, askMeetings: settings.askMeetings, recordingBusy: busy,
                             privateOn: privateOn(), privateAskPending: privateAskPending, recordAskOpen: openAsk != nil)
    guard let f = flow.look(SRMeetingRule.found(facts), inputs) else { return false }
    let choice = SRAskChoice.from(settings)
    openAsk = (f.key, choice); meetingName = f.name
    show(.recordAsk(name: f.name, key: f.key, choice: choice), sound: "")
    return true
  }

  /// A button on one of the cards. Returns what the Mac should do next, for the part that touches the real world.
  enum Next: Equatable { case none, countIn(Int), reshow, stopNow, reveal, play, mic }
  @discardableResult func answer(cardId: String, action: String) -> Next {
    switch cardId {
    case SRCards.askId:
      guard let ask = openAsk else { return .none }
      switch action {
      case "chip":
        let c = ask.choice.next
        controller.update(c.apply(to: settings)); openAsk = (ask.key, c)
        emit(SRCards.card(.recordAsk(name: meetingName ?? "", key: ask.key, choice: c)), nil)
        return .reshow
      case "yes":
        openAsk = nil
        let n = SRCountIn.seconds(privateOn: privateOn(), reduceMotion: false)
        return .countIn(n)
      default:   // No (or the x, or Esc): hidden for this meeting
        openAsk = nil; flow.answered(ask.key, yes: false); return .none
      }
    case SRCards.perfId:
      watch.answered(stop: action == "stop")
      if action == "stop" { controller.stop(); return .stopNow }
      return .none
    case SRCards.savedId: return action == "show" ? .reveal : action == "play" ? .play : .none
    case SRCards.menuId:
      switch action { case "pause": controller.pause(); case "resume": controller.resume(); case "stop": controller.stop(); case "mic": return .mic; default: break }
      return .none
    default: return .none
    }
  }
  /// The count in is over (or was skipped): start with the meeting's name.
  @discardableResult func startAfterCountIn() -> SRRefusal? { controller.start(meeting: meetingName) }
  /// Esc (or the x) closed the question: the same as No. A closed "Resources are high" card is a No, keep recording.
  func escaped(cardId: String) {
    if cardId == SRCards.askId, let a = openAsk { openAsk = nil; flow.answered(a.key, yes: false) }
    if cardId == SRCards.perfId { watch.answered(stop: false) }
  }

  // ----- the recorder changed -----
  /// Called on every state change of the recorder (SRController.onChange).
  func recorderChanged() {
    let s = controller.snapshot.state
    defer { prev = s }
    if s == .recording, prev != .recording, prev != .paused {
      guard controller.gateOpen, settings.perfWatch else { return }
      watch.begin(res: settings.resolution, fps: settings.fps, quality: settings.quality, screenH: screenH(),
                  can: adjuster?.canAdjust ?? SRAdjustable(fps: false, resolution: false, quality: false), bytesPerHour: diskBytesPerHour())
    }
    if prev == .stopping || prev == .recording || prev == .paused, s == .idle || s == .off {
      watch.end()
      if let f = controller.snapshot.fileName, controller.snapshot.error == nil, prev == .stopping { show(.saved(fileName: f), sound: "saved") }
    }
  }
  /// The island part was clicked: Pause or Resume, Stop, Switch mic.
  func openControls() { if controller.snapshot.isRecording { show(.controls(paused: controller.snapshot.state == .paused), sound: nil) } }

  // ----- private mode changed -----
  func privateChanged() {
    let p = privateOn()
    defer { wasPrivate = p }
    guard wasPrivate, !p else { return }
    for m in hold.release(now: now()) { emit(SRCards.card(m), SRPrivacy.chime("saved", privateOn: false, soundsOn: settings.sounds, dndMutes: dndMutesSounds())) }
  }

  // ----- the performance watch -----
  /// One sample every few seconds, only while recording and only when the watch is on and the gate is open.
  func perfTick(_ s: SRSample) {
    guard controller.gateOpen, settings.perfWatch, controller.snapshot.state == .recording || controller.snapshot.state == .paused else { return }
    for a in watch.feed(s, now: now(), canShow: !privateOn()) {
      switch a {
      case .adjust(let step): adjuster?.adjust(step); controller.noteLowered(SRWords.lowered(step.words))
      case .ask: show(.perfAsk, sound: "warn")
      case .stopForDisk:
        controller.stop()
        show(.diskStop(why: SRWords.diskWhy), sound: "saved")
      }
    }
  }
}
