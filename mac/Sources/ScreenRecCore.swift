// Screen recorder rules (PS 1.60, pull request 12a). Pure values and a small controller that takes fake capture and fake
// permissions, so tests/screenrec-test.sh checks every rule without recording anything. Foundation only (no AppKit, no
// ScreenCaptureKit, no AVFoundation): the real capture is ScreenRec.swift, which plugs into the two protocols below.
//
// What lives here:
//  - the choices (screen or audio only, resolution, frame rate, quality, format, audio quality) and the presets that set them all;
//  - the numbers (the size a recording gets, never above the screen; the video bitrate; the space an hour takes, summed
//    from the real settings);
//  - the file names ("2026-11-14 Call with Sam.mov"), the folder fallback (missing or nearly full folder: the default one),
//    the leave out list (PS itself is always left out);
//  - the opt in gate: screen recording is OFF until the person says yes. While it is off no capture code runs and no
//    macOS permission is ever requested (SRController refuses before it touches either protocol);
//  - the recorder state that the Record button reads, and that 12b's island and 12c's cloud will read too: SRSnapshot.
//    Private mode hides the red dot and the timer (SRSnapshot.display) but never touches the recording itself, and the
//    timer is worked out from the start and pause times, so it shows the real running time when the signs come back.
import Foundation

// ---------- the choices ----------
enum SRMode: String, Codable { case screenAndAudio, audioOnly }
enum SRResolution: String, Codable, CaseIterable {
  case p720, p1080, p1440, p2160, same
  /// The picture height, or nil for "Same as screen".
  var height: Int? { switch self { case .p720: return 720; case .p1080: return 1080; case .p1440: return 1440; case .p2160: return 2160; case .same: return nil } }
  var label: String { switch self { case .p720: return "720p"; case .p1080: return "1080p"; case .p1440: return "1440p"; case .p2160: return "4K"; case .same: return "Same as screen" } }
}
enum SRQuality: String, Codable, CaseIterable {
  case small, balanced, high, best
  /// Bits per pixel per frame for H.264 (screen content). HEVC needs SRCodec.factor of that.
  var bitsPerPixel: Double { switch self { case .small: return 0.035; case .balanced: return 0.07; case .high: return 0.12; case .best: return 0.2 } }
  var label: String { switch self { case .small: return "Small file"; case .balanced: return "Balanced"; case .high: return "High"; case .best: return "Best" } }
}
enum SRCodec: String, Codable, CaseIterable {
  case hevc, h264
  var factor: Double { self == .hevc ? 0.6 : 1.0 }
  var label: String { self == .hevc ? "HEVC" : "H.264" }
}
enum SRAudioQuality: String, Codable, CaseIterable {
  case standard, high
  /// Bits per second for each sound track.
  var bitrate: Int { self == .standard ? 64_000 : 128_000 }
  var label: String { self == .standard ? "Standard" : "High" }
}
enum SRPreset: String, Codable, CaseIterable { case calls, sharp, tiny, custom }
let SR_FPS = [15, 30, 60]

/// Where the picture comes from: the main screen, one screen, or one window (ids are macOS display and window numbers).
struct SRSource: Equatable, Codable {
  var kind: String = "main"      // "main", "display" or "window"
  var id: UInt32 = 0
  static let main = SRSource()
}

struct SRSettings: Equatable, Codable {
  var enabled = false             // the opt in: OFF until the person says yes
  var mode: SRMode = .screenAndAudio
  var preset: SRPreset = .calls
  var resolution: SRResolution = .p1080
  var fps = 15
  var quality: SRQuality = .balanced
  var codec: SRCodec = .hevc
  var audioQuality: SRAudioQuality = .standard
  var source = SRSource.main
  var micOn = true
  var micUID: String? = nil       // nil: the Mac's own default microphone
  var computerSound = true
  var leftOut: [String] = []      // bundle ids of apps whose sound and windows are left out
  var remind = true               // "Let everyone on the call know you are recording."
  var sounds = true
  var askMeetings = true          // 12b: ask "Do you want to record this meeting?" when a meeting starts (only while screen recording is on)
  var perfWatch = true            // 12b: watch the Mac while recording and ask before it struggles
  var picked = false              // the person has seen the picker once (the first click on Record opens it)
  var folderName: String? = nil   // the chosen folder's name (the bookmark itself is kept by ScreenRec.swift)

  init() {}
  // Tolerant: a missing or odd value keeps its default, so an old or edited file never stops it loading.
  init(from d: Decoder) throws {
    let c = try d.container(keyedBy: CodingKeys.self)
    func get<T: Decodable>(_ k: CodingKeys, _ def: T) -> T { (try? c.decodeIfPresent(T.self, forKey: k)) ?? def }
    let def = SRSettings()
    enabled = get(.enabled, def.enabled); mode = get(.mode, def.mode); preset = get(.preset, def.preset)
    resolution = get(.resolution, def.resolution); quality = get(.quality, def.quality); codec = get(.codec, def.codec)
    audioQuality = get(.audioQuality, def.audioQuality); source = get(.source, def.source); micOn = get(.micOn, def.micOn)
    let f: Int = get(.fps, def.fps); fps = SR_FPS.contains(f) ? f : def.fps
    micUID = get(.micUID, def.micUID); computerSound = get(.computerSound, def.computerSound)
    leftOut = SRLeaveOut.clean(get(.leftOut, def.leftOut)); remind = get(.remind, def.remind); sounds = get(.sounds, def.sounds); picked = get(.picked, def.picked)
    askMeetings = get(.askMeetings, def.askMeetings); perfWatch = get(.perfWatch, def.perfWatch)
    folderName = get(.folderName, def.folderName)
  }
  enum CodingKeys: String, CodingKey { case enabled, mode, preset, resolution, fps, quality, codec, audioQuality, source, micOn, micUID, computerSound, leftOut, remind, sounds, picked, folderName, askMeetings, perfWatch }
}

// ---------- presets ----------
enum SRPresets {
  /// Every value a preset sets (the picker, the island chip and Settings all use this one table).
  static func values(_ p: SRPreset) -> (resolution: SRResolution, fps: Int, quality: SRQuality, codec: SRCodec, audioQuality: SRAudioQuality)? {
    switch p {
    case .calls: return (.p1080, 15, .balanced, .hevc, .standard)
    case .sharp: return (.same, 30, .high, .hevc, .high)
    case .tiny: return (.p720, 15, .small, .hevc, .standard)
    case .custom: return nil
    }
  }
  static func label(_ p: SRPreset) -> String { switch p { case .calls: return "Calls"; case .sharp: return "Sharp"; case .tiny: return "Tiny"; case .custom: return "Custom" } }
  /// Sets every value the preset owns. "Custom" keeps the values as they are.
  static func apply(_ p: SRPreset, to s: SRSettings) -> SRSettings {
    var o = s
    o.preset = p
    if let v = values(p) { o.resolution = v.resolution; o.fps = v.fps; o.quality = v.quality; o.codec = v.codec; o.audioQuality = v.audioQuality }
    return o
  }
  /// Which preset the values match now ("custom" when none).
  static func detect(_ s: SRSettings) -> SRPreset {
    for p in [SRPreset.calls, .sharp, .tiny] {
      if let v = values(p), v.resolution == s.resolution, v.fps == s.fps, v.quality == s.quality, v.codec == s.codec, v.audioQuality == s.audioQuality { return p }
    }
    return .custom
  }
  /// Changing one value by hand: the preset follows the values.
  static func touched(_ s: SRSettings) -> SRSettings { var o = s; o.preset = detect(s); return o }
}

// ---------- the numbers ----------
enum SRMath {
  static func even(_ v: Double) -> Int { max(2, Int(v.rounded(.down)) / 2 * 2) }
  /// The size a recording gets: the chosen height, never above the screen's own pixels, the screen's shape kept, even numbers.
  static func size(_ r: SRResolution, screenW: Int, screenH: Int) -> (w: Int, h: Int) {
    guard screenW > 0, screenH > 0 else { return (2, 2) }
    guard let h = r.height, h < screenH else { return (even(Double(screenW)), even(Double(screenH))) }
    let scale = Double(h) / Double(screenH)
    return (even(Double(screenW) * scale), even(Double(h)))
  }
  /// Only the resolutions the picked screen can do ("Same as screen" always; never an upscale).
  static func available(screenW: Int, screenH: Int) -> [SRResolution] {
    var o: [SRResolution] = []
    for r in SRResolution.allCases where r != .same { if let h = r.height, h <= screenH { o.append(r) } }
    o.append(.same)
    return o
  }
  /// Video bits per second from the real settings (clamped to something sane).
  static func videoBitrate(_ s: SRSettings, w: Int, h: Int) -> Int {
    let raw = Double(w) * Double(h) * Double(s.fps) * s.quality.bitsPerPixel * s.codec.factor
    return Int(min(80_000_000, max(250_000, raw)))
  }
  /// How many sound tracks the file has: the mic ("Me") and the computer sound ("Them").
  static func tracks(_ s: SRSettings) -> Int { (s.micOn ? 1 : 0) + (s.computerSound ? 1 : 0) }
  /// Bytes an hour takes. Audio only counts the sound tracks alone.
  static func bytesPerHour(_ s: SRSettings, screenW: Int, screenH: Int) -> Int64 {
    let audio = tracks(s) * s.audioQuality.bitrate
    var bits = audio
    if s.mode == .screenAndAudio { let z = size(s.resolution, screenW: screenW, screenH: screenH); bits += videoBitrate(s, w: z.w, h: z.h) }
    return Int64(bits) / 8 * 3600
  }
  /// "about 450 MB an hour", "about 1.2 GB an hour".
  static func spaceWords(_ bytes: Int64) -> String {
    let mb = Double(bytes) / 1_000_000
    if mb < 1000 { return "about \(max(10, Int((mb / 10).rounded()) * 10)) MB an hour" }
    return "about \(String(format: "%.1f", mb / 1000)) GB an hour"
  }
}

// ---------- what a start needs ----------
enum SRNeeds {
  /// Screen Recording permission: the picture, or the computer sound (ScreenCaptureKit carries it). Audio only with the
  /// computer sound off never asks for it.
  static func screen(_ s: SRSettings) -> Bool { s.mode == .screenAndAudio || s.computerSound }
  static func mic(_ s: SRSettings) -> Bool { s.micOn }
  /// Nothing to record: audio only with no mic and no computer sound.
  static func problem(_ s: SRSettings) -> String? {
    if s.mode == .audioOnly && SRMath.tracks(s) == 0 { return "Pick the mic or the computer sound to record." }
    return nil
  }
}

// ---------- the leave out list ----------
enum SRLeaveOut {
  /// Tidy list: no blanks, no repeats, sorted, at most 60.
  static func clean(_ ids: [String]) -> [String] {
    var seen = Set<String>(), out: [String] = []
    for raw in ids {
      let id = raw.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !id.isEmpty, id.count <= 200, !seen.contains(id) else { continue }
      seen.insert(id); out.append(id)
    }
    return Array(out.sorted().prefix(60))
  }
  /// What the content filter excludes: the person's list, and PS itself always.
  static func excluded(chosen: [String], own: String?) -> [String] {
    clean(chosen + (own.map { [$0] } ?? []))
  }
  /// Toggle one app in the list.
  static func toggle(_ chosen: [String], id: String) -> [String] {
    chosen.contains(id) ? clean(chosen.filter { $0 != id }) : clean(chosen + [id])
  }
}

// ---------- file names ----------
enum SRNames {
  /// "2026-11-14 Call with Sam.mov", or "2026-11-14 Recording 14.30.mov" with no meeting name. No slashes or colons, never
  /// longer than 90 letters, and a repeat gets " 2", " 3" so nothing is overwritten.
  static func fileName(date: Date, meeting: String?, ext: String, taken: Set<String>, timeZone: TimeZone = .current) -> String {
    var cal = Calendar(identifier: .gregorian); cal.timeZone = timeZone
    func f(_ p: String) -> String { let d = DateFormatter(); d.locale = Locale(identifier: "en_US_POSIX"); d.timeZone = timeZone; d.dateFormat = p; return d.string(from: date) }
    let day = f("yyyy-MM-dd")
    let name = tidy(meeting)
    let base = name.isEmpty ? "\(day) Recording \(f("HH.mm"))" : "\(day) \(name)"
    let e = ext.hasPrefix(".") ? String(ext.dropFirst()) : ext
    var out = "\(base).\(e)", n = 2
    while taken.contains(out) || taken.contains(out.lowercased()) { out = "\(base) \(n).\(e)"; n += 1 }
    return out
  }
  static func tidy(_ s: String?) -> String {
    guard let s else { return "" }
    var o = ""
    for ch in s.unicodeScalars {
      if ch == "/" || ch == ":" || ch == "\\" || ch.value < 32 || ch.value == 127 { o.append(" ") } else { o.unicodeScalars.append(ch) }
    }
    o = o.split(separator: " ", omittingEmptySubsequences: true).joined(separator: " ")
    while o.hasPrefix(".") { o.removeFirst() }
    if o.count > 60 { o = String(o.prefix(60)).trimmingCharacters(in: .whitespaces) }
    return o
  }
  static func ext(_ m: SRMode) -> String { m == .audioOnly ? "m4a" : "mov" }
}

// ---------- the folder ----------
struct SRFolderState: Equatable { var exists: Bool; var writable: Bool; var freeBytes: Int64 }
enum SRFallbackReason: String, Equatable { case missing, notWritable, nearlyFull
  var words: String {
    switch self {
    case .missing: return "Your recordings folder is not there (is the drive plugged in?). Saving to the default folder instead."
    case .notWritable: return "PS cannot save to your recordings folder. Saving to the default folder instead."
    case .nearlyFull: return "Your recordings folder is nearly full. Saving to the default folder instead."
    }
  }
}
struct SRFolderPlan: Equatable {
  var useDefault: Bool
  var reason: SRFallbackReason?
  /// The default folder itself has no room either: say so, do not start.
  var noRoom: Bool
}
enum SRFolder {
  /// Room needed before a recording starts: half an hour of this recording, at least 1 GB.
  static func needed(_ s: SRSettings, screenW: Int, screenH: Int) -> Int64 {
    max(1_000_000_000, SRMath.bytesPerHour(s, screenW: screenW, screenH: screenH) / 2)
  }
  /// `custom`: the chosen folder (nil: none chosen, the default is used). `fallback`: the default folder.
  static func plan(custom: SRFolderState?, fallback: SRFolderState, needed: Int64) -> SRFolderPlan {
    let defaultLow = !fallback.exists ? false : fallback.freeBytes < needed
    guard let c = custom else { return SRFolderPlan(useDefault: true, reason: nil, noRoom: defaultLow) }
    if !c.exists { return SRFolderPlan(useDefault: true, reason: .missing, noRoom: defaultLow) }
    if !c.writable { return SRFolderPlan(useDefault: true, reason: .notWritable, noRoom: defaultLow) }
    if c.freeBytes < needed { return SRFolderPlan(useDefault: true, reason: .nearlyFull, noRoom: defaultLow) }
    return SRFolderPlan(useDefault: false, reason: nil, noRoom: false)
  }
}

// ---------- the recorder state (what the button, the island and the cloud read) ----------
enum SRRunState: String { case off, idle, starting, recording, paused, stopping }

/// The one small state API. Pure values: the button (web) and later the island (12b) both read it.
struct SRSnapshot: Equatable {
  var state: SRRunState = .idle
  var startedAt: Date? = nil
  var pausedTotal: TimeInterval = 0
  var pausedAt: Date? = nil
  var fileName: String? = nil
  var folderNote: String? = nil          // why the default folder was used
  var error: String? = nil
  var lowered: [String] = []             // 12b: what the performance watch made lighter (frame rate, resolution, quality), for the recording's details

  var isRecording: Bool { state == .recording || state == .paused }
  /// The real running time (a pause does not count). From the start and pause times, never from a counter, so it is right
  /// whatever was or was not drawn while private mode hid it.
  func elapsed(now: Date) -> TimeInterval {
    guard let s = startedAt, isRecording else { return 0 }
    let end = pausedAt ?? now
    return max(0, end.timeIntervalSince(s) - pausedTotal)
  }
  struct Display: Equatable { var dot: Bool; var pulsing: Bool; var timer: String?; var paused: Bool }
  /// What to draw. Private mode shows NOTHING (no dot, no timer, no "Paused"); the recording itself keeps going.
  func display(now: Date, privateMode: Bool) -> Display {
    guard isRecording, !privateMode else { return Display(dot: false, pulsing: false, timer: nil, paused: false) }
    return Display(dot: true, pulsing: state == .recording, timer: SRSnapshot.timerText(elapsed(now: now)), paused: state == .paused)
  }
  static func timerText(_ secs: TimeInterval) -> String {
    let t = Int(max(0, secs))
    let h = t / 3600, m = (t % 3600) / 60, s = t % 60
    return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
  }
}

// ---------- the two doors to the real world (fake in tests) ----------
enum SRPerm: String { case unknown, granted, denied }
protocol SRPermissionsAPI {
  func screen() -> SRPerm
  func mic() -> SRPerm
  func requestScreen()
  func requestMic(_ done: @escaping (Bool) -> Void)
}
/// Everything the capture needs, worked out by SRController from the settings.
struct SRPlan: Equatable {
  var mode: SRMode
  var source: SRSource
  var folderIsDefault: Bool
  var fileName: String
  var width: Int
  var height: Int
  var fps: Int
  var codec: SRCodec
  var videoBitrate: Int
  var audioBitrate: Int
  var micOn: Bool
  var micUID: String?
  var computerSound: Bool
  var excludedApps: [String]
}
protocol SRCaptureAPI {
  func start(_ plan: SRPlan, done: @escaping (Error?) -> Void)
  func pause()
  func resume()
  /// Another microphone while recording (nil: the Mac's own default).
  func switchMic(_ uid: String?)
  func stop(done: @escaping () -> Void)
}

enum SRRefusal: Equatable { case off, busy, notRecording, permission(String), problem(String), noRoom, failed(String) }
struct SRScreenInfo { var width: Int; var height: Int }

/// The opt in gate and the recorder state machine. Every method that could reach capture or macOS checks the gate FIRST:
/// feature on and the person's own opt in. While it is closed nothing below the gate is called, so no recording code
/// runs and no permission is requested.
final class SRController {
  private(set) var settings: SRSettings
  private(set) var snapshot = SRSnapshot()
  var featureOn: () -> Bool
  let perms: SRPermissionsAPI
  let capture: SRCaptureAPI
  var now: () -> Date = { Date() }
  var screenInfo: () -> SRScreenInfo = { SRScreenInfo(width: 1920, height: 1080) }
  var folders: () -> (custom: SRFolderState?, fallback: SRFolderState) = { (nil, SRFolderState(exists: true, writable: true, freeBytes: 100_000_000_000)) }
  var takenNames: () -> Set<String> = { [] }
  var ownBundleID: String? = "example.ps"
  var onChange: ((SRSnapshot) -> Void)?

  init(settings: SRSettings, featureOn: @escaping () -> Bool, perms: SRPermissionsAPI, capture: SRCaptureAPI) {
    self.settings = settings; self.featureOn = featureOn; self.perms = perms; self.capture = capture
    if !(settings.enabled && featureOn()) { snapshot.state = .off }
  }

  /// The gate: the feature is on in this build AND the person said yes.
  var gateOpen: Bool { featureOn() && settings.enabled }

  private func set(_ f: (inout SRSnapshot) -> Void) { f(&snapshot); onChange?(snapshot) }

  /// The person's yes or no. A yes asks for nothing by itself (permissions are asked on purpose, after the explanation).
  /// A no stops a recording that is running (capture saves it first).
  func setEnabled(_ on: Bool) {
    guard featureOn() else { return }
    if !on, snapshot.isRecording { stop() }
    settings.enabled = on
    set { $0.state = on ? .idle : .off; if !on { $0.error = nil } }
  }
  /// Switch the mic: remembered for next time, and applied now if a recording is running.
  func switchMic(_ uid: String?) {
    guard gateOpen else { return }
    settings.micUID = uid
    if snapshot.isRecording { capture.switchMic(uid) }
  }
  func noteError(_ m: String) { set { $0.error = m } }
  /// 12b: the performance watch made the recording lighter: noted in the recording's details.
  func noteLowered(_ what: String) { guard snapshot.isRecording else { return }; set { if !$0.lowered.contains(what) { $0.lowered.append(what) } } }
  func update(_ s: SRSettings) { var n = s; n.enabled = settings.enabled; settings = n }

  /// Ask macOS, one permission at a time, only while the gate is open (the page shows its explanation first).
  @discardableResult func askScreen() -> SRRefusal? {
    guard gateOpen else { return .off }
    if perms.screen() != .granted { perms.requestScreen() }
    return nil
  }
  @discardableResult func askMic(_ done: @escaping (Bool) -> Void = { _ in }) -> SRRefusal? {
    guard gateOpen else { return .off }
    if perms.mic() == .granted { done(true); return nil }
    perms.requestMic(done)
    return nil
  }

  /// Start recording with the saved choices.
  @discardableResult func start(meeting: String? = nil) -> SRRefusal? {
    guard gateOpen else { return .off }
    if snapshot.state != .idle { return .busy }
    if let p = SRNeeds.problem(settings) { return .problem(p) }
    if SRNeeds.screen(settings) && perms.screen() != .granted { return .permission("screen") }
    if SRNeeds.mic(settings) && perms.mic() != .granted { return .permission("mic") }
    let scr = screenInfo()
    let size = SRMath.size(settings.resolution, screenW: scr.width, screenH: scr.height)
    let f = folders()
    let folder = SRFolder.plan(custom: f.custom, fallback: f.fallback, needed: SRFolder.needed(settings, screenW: scr.width, screenH: scr.height))
    if folder.noRoom { return .noRoom }
    let name = SRNames.fileName(date: now(), meeting: meeting, ext: SRNames.ext(settings.mode), taken: takenNames())
    let plan = SRPlan(mode: settings.mode, source: settings.source, folderIsDefault: folder.useDefault, fileName: name,
                      width: size.w, height: size.h, fps: settings.fps, codec: settings.codec,
                      videoBitrate: SRMath.videoBitrate(settings, w: size.w, h: size.h), audioBitrate: settings.audioQuality.bitrate,
                      micOn: settings.micOn, micUID: settings.micUID, computerSound: settings.computerSound,
                      excludedApps: SRLeaveOut.excluded(chosen: settings.leftOut, own: ownBundleID))
    set { $0 = SRSnapshot(state: .starting, startedAt: nil, pausedTotal: 0, pausedAt: nil, fileName: name, folderNote: folder.reason?.words, error: nil) }
    capture.start(plan) { [weak self] err in
      guard let self else { return }
      if let err { self.set { $0.state = .idle; $0.startedAt = nil; $0.error = "\(err.localizedDescription)" }; return }
      self.set { $0.state = .recording; $0.startedAt = self.now() }
    }
    return nil
  }

  func pause() {
    guard gateOpen, snapshot.state == .recording else { return }
    capture.pause()
    set { $0.state = .paused; $0.pausedAt = self.now() }
  }
  func resume() {
    guard gateOpen, snapshot.state == .paused, let at = snapshot.pausedAt else { return }
    capture.resume()
    set { $0.pausedTotal += self.now().timeIntervalSince(at); $0.pausedAt = nil; $0.state = .recording }
  }
  func stop() {
    guard snapshot.isRecording else { return }          // a stop is always allowed while recording, even if the gate just closed
    set { $0.state = .stopping }
    capture.stop { [weak self] in
      guard let self else { return }
      self.set { $0.state = self.gateOpen ? .idle : .off; $0.startedAt = nil; $0.pausedAt = nil; $0.pausedTotal = 0 }
    }
  }
}
