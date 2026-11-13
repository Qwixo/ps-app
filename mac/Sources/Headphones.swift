// Headphones mode (V1.40, G Squad). A Speakers | Headphones switch at the top of the volume mixer. For each
// mode the person picks a sound output and a microphone, each with a fallback order (first choice, then the
// next one that is connected). Switching mode makes those the Mac's default output, its system output (alerts)
// and its default input, the same as picking them in the sound menu.
// Empty lists: Speakers plays through the Mac's built in speakers, Headphones through the first headphones that
// are connected (Bluetooth, the headphone jack, or a name like AirPods, Buds, headphones). An empty microphone
// list leaves the microphone as it is.
// Auto switch (off until the person turns it on, every account): when headphones from the Headphones list (or
// any headphones, when that list is empty) connect, PS goes to Headphones; when the last of them disconnects
// while in Headphones, back to Speakers. Once per connection. A device picked by hand afterwards is never fought.
// How it fits with AutoRoute (the developer's AirPods Max fix, AutoRoute.swift): while this auto switch is on and the
// AirPods are headphones it handles, AutoRoute leaves their output switch to this file (claims()); when the
// Headphones microphone list is set, the microphone too. Everything else AutoRoute does stays as it was (its
// mic fix when that list is empty, its honest card, the crown fix). Every microphone this file sets is told to
// AutoRoute first (noteOwnInput), so AutoRoute never reads it as the person's own pick.
// The preferences (lists and the auto switch) live in the vault as settings.tmAudio and sync like other PS
// settings; the page sends them here (src/audiomode.ts) and the last copy is kept on this Mac (it works while
// the vault is locked). Which mode is on is kept per Mac: switching on one Mac never moves another Mac's sound.
// Core Audio work runs on its own queue, never on the main thread. 1Password and Signal devices are dropped at
// the first read. A self test copy runs on fake devices and never changes the real output or microphone.
import AppKit
import CoreAudio

// ---------- the pure part: what to switch to (no Core Audio, unit tested in tests/headphones-logic) ----------
struct HPRef: Codable, Equatable { var uid: String; var name: String }
struct HPPrefs: Codable, Equatable {
  var auto = false
  var spkOut: [HPRef] = []; var spkMic: [HPRef] = []
  var hpOut: [HPRef] = []; var hpMic: [HPRef] = []
  init() {}
  init(from d: Decoder) throws {
    let c = try d.container(keyedBy: CodingKeys.self)
    auto = (try? c.decode(Bool.self, forKey: .auto)) ?? false
    func list(_ k: CodingKeys) -> [HPRef] { Array(((try? c.decode([HPRef].self, forKey: k)) ?? []).prefix(8)) }
    spkOut = list(.spkOut); spkMic = list(.spkMic); hpOut = list(.hpOut); hpMic = list(.hpMic)
  }
  /// From the page's JSON (settings.tmAudio): unknown or bad parts are dropped, at most 8 per list.
  static func from(_ o: Any?) -> HPPrefs {
    guard let o = o as? [String: Any] else { return HPPrefs() }
    var p = HPPrefs()
    p.auto = o["auto"] as? Bool ?? false
    func list(_ k: String) -> [HPRef] {
      ((o[k] as? [[String: Any]]) ?? []).compactMap { r in
        guard let u = r["uid"] as? String, !u.isEmpty, u.count <= 200 else { return nil }
        return HPRef(uid: u, name: String((r["name"] as? String ?? "").prefix(100)))
      }.prefix(8).map { $0 }
    }
    p.spkOut = list("spkOut"); p.spkMic = list("spkMic"); p.hpOut = list("hpOut"); p.hpMic = list("hpMic")
    return p
  }
}
struct HPDev: Equatable {
  let uid: String; let name: String; let alive: Bool; let transport: UInt32
  var builtIn: Bool { transport == kAudioDeviceTransportTypeBuiltIn }
  /// Headphones when nothing is listed: Bluetooth, the headphone jack, or a headphones name.
  var headphoneLike: Bool {
    if transport == kAudioDeviceTransportTypeBluetooth || transport == kAudioDeviceTransportTypeBluetoothLE { return true }
    let n = name.lowercased()
    return ["headphone", "airpods", "buds", "headset", "beats"].contains { n.contains($0) }
  }
}
enum HPMode: String { case speakers, headphones }

enum HPLogic {
  /// The first device in the list that is connected and awake: matched by its id, else by its exact name
  /// (the same headphones on another Mac, or a device whose id changed).
  static func pick(_ refs: [HPRef], _ devs: [HPDev]) -> HPDev? {
    let live = devs.filter(\.alive)
    for r in refs {
      if let d = live.first(where: { $0.uid == r.uid }) { return d }
      if !r.name.isEmpty, let d = live.first(where: { $0.name.caseInsensitiveCompare(r.name) == .orderedSame }) { return d }
    }
    return nil
  }
  /// Is this output headphones this mode handles? The listed ones, or any headphones when the list is empty.
  static func isHeadphones(_ d: HPDev, _ p: HPPrefs) -> Bool {
    if p.hpOut.isEmpty { return d.headphoneLike }
    return p.hpOut.contains { $0.uid == d.uid || (!$0.name.isEmpty && $0.name.caseInsensitiveCompare(d.name) == .orderedSame) }
  }
  /// What a mode switches to. out nil: nothing to switch to (Headphones with none connected). mic nil: leave it.
  static func target(_ m: HPMode, _ p: HPPrefs, outs: [HPDev], ins: [HPDev]) -> (out: HPDev?, mic: HPDev?) {
    switch m {
    case .speakers:
      let out = pick(p.spkOut, outs) ?? outs.first { $0.alive && $0.builtIn && !$0.headphoneLike && !$0.name.lowercased().contains("external") }
      return (out, pick(p.spkMic, ins))
    case .headphones:
      let out = p.hpOut.isEmpty ? outs.first { $0.alive && $0.headphoneLike } : pick(p.hpOut, outs)
      return (out, pick(p.hpMic, ins))
    }
  }
  /// The auto switch: given which outputs were connected before, a mode to go to now, or nil.
  /// New headphones connected: Headphones. In Headphones and the last of them gone: Speakers.
  static func autoStep(_ p: HPPrefs, mode: HPMode, before: Set<String>, now: [HPDev]) -> HPMode? {
    guard p.auto else { return nil }
    let hp = now.filter { $0.alive && isHeadphones($0, p) }
    if hp.contains(where: { !before.contains($0.uid) }) { return .headphones }
    if mode == .headphones, hp.isEmpty, !before.isEmpty { return .speakers }
    return nil
  }
}

// ---------- what Headphones mode needs from the Mac (a self test copy swaps in a fake) ----------
protocol HPBackend: AnyObject {
  func outputs() -> [HPDev]
  func inputs() -> [HPDev]
  func defaultOutput() -> String?
  func defaultInput() -> String?
  /// The default output and the system output (alerts), as the sound menu sets them.
  func setOutput(_ uid: String) -> Bool
  func setInput(_ uid: String) -> Bool
  func onChange(_ f: @escaping () -> Void)
}

final class HeadphonesMode {
  static let shared = HeadphonesMode()
  private let q = DispatchQueue(label: "PS headphones mode", qos: .userInitiated)
  private var backend: HPBackend?
  private var testDir: String?
  private(set) var mode: HPMode = .speakers
  private var prefs = HPPrefs()
  private var present: Set<String> = []            // headphones this mode handles, connected right now
  private var gen = 0                              // a newer switch ends an older one's tries
  private var note = ""                            // what the last switch did, said plainly
  private var guardMic: (uid: String, until: Date)?   // the mic just set: macOS moving it in the next seconds is put back once
  private let lock = NSLock()
  private var snapPrefs = HPPrefs()                // for claims(), read from AutoRoute's queue
  /// The Tab list page gets {type:"hpmode", ...} (main thread).
  var deliver: ((String) -> Void)?
  /// A card after an auto switch (main thread). Only the mode, never a device name.
  var announce: (HPMode, Bool) -> Void = { m, ok in
    let id = "hp:switch"
    let title = ok ? (m == .headphones ? "Switched to Headphones" : "Switched to Speakers")
                   : (m == .headphones ? "Couldn't switch to Headphones" : "Couldn't switch to Speakers")
    Toast.shared.showCard(["id": id, "title": title, "sub": ok ? "Headphones mode auto switch" : "macOS kept the sound where it was"])
  }
  var settle: Double = 1.2                         // a fresh Bluetooth device gets a moment before it is used
  var verifyDelays: [Double] = [0.4, 0.8, 1.6]
  var micGuard: Double = 8

  func start(testDir: String?, backend: HPBackend? = nil) {
    self.testDir = testDir
    q.async { [self] in
      if let b = backend { self.backend = b } else if testDir == nil { self.backend = CoreAudioHP() } else { return }   // a test copy waits for its fake
      guard let b = self.backend else { return }
      if testDir == nil {
        let d = UserDefaults.standard
        if let data = d.data(forKey: "hpmode.prefs"), let p = try? JSONDecoder().decode(HPPrefs.self, from: data) { prefs = p }
        if let m = d.string(forKey: "hpmode.mode").flatMap(HPMode.init) { mode = m }
        else if let cur = b.defaultOutput(), let dev = outs(b).first(where: { $0.uid == cur }), dev.headphoneLike { mode = .headphones }
      }
      setSnap()
      present = Set(outs(b).filter { $0.alive && HPLogic.isHeadphones($0, prefs) }.map(\.uid))   // already on when PS starts: nothing to do
      b.onChange { [weak self] in self?.q.async { self?.changed() } }
      push()
    }
  }
  /// Every device as this file sees it: 1Password and Signal dropped here too (the reader already drops them).
  private func outs(_ b: HPBackend) -> [HPDev] { b.outputs().filter { !Protected.matches($0.name) && !Protected.matches($0.uid) } }
  private func ins(_ b: HPBackend) -> [HPDev] { b.inputs().filter { !Protected.matches($0.name) && !Protected.matches($0.uid) } }
  private func setSnap() { lock.lock(); snapPrefs = prefs; lock.unlock() }
  private func save() {
    guard testDir == nil else { return }
    UserDefaults.standard.set(mode.rawValue, forKey: "hpmode.mode")
    if let data = try? JSONEncoder().encode(prefs) { UserDefaults.standard.set(data, forKey: "hpmode.prefs") }
  }

  /// Devices came or went, or the default changed. Own queue.
  private func changed() {
    guard let b = backend else { return }
    let outs = outs(b)
    defer { push() }
    // Only macOS's own move onto headphones' microphone (as it does when they connect), never another pick.
    if let g = guardMic, Date() < g.until, let cur = b.defaultInput(), cur != g.uid,
       ins(b).first(where: { $0.uid == cur })?.headphoneLike == true,
       ins(b).contains(where: { $0.uid == g.uid && $0.alive }) {
      guardMic = nil                                   // once only, then the person's own pick always stands
      AutoRoute.shared.noteOwnInput(g.uid)
      _ = b.setInput(g.uid)
      psLog("PS headphones mode: macOS moved the microphone, put back once")
    }
    let before = present
    present = Set(outs.filter { $0.alive && HPLogic.isHeadphones($0, prefs) }.map(\.uid))
    guard let next = HPLogic.autoStep(prefs, mode: mode, before: before, now: outs) else { return }
    if next == .speakers && mode == .speakers { return }
    gen += 1
    let g = gen
    q.asyncAfter(deadline: .now() + (next == .headphones ? settle : 0.3)) { [self] in
      guard g == gen, prefs.auto else { return }
      psLog("PS headphones mode: auto switch to \(next.rawValue)")
      apply(next, auto: true)
    }
  }

  /// Make a mode's devices the Mac's defaults, then read them back (retries while a fresh device warms up). Own queue.
  private func apply(_ m: HPMode, auto: Bool) {
    guard let b = backend else { return }
    let t = HPLogic.target(m, prefs, outs: outs(b), ins: ins(b))
    guard let out = t.out else {
      note = m == .headphones ? "No headphones connected, the sound stays where it is." : "No speakers found, the sound stays where it is."
      psLog("PS headphones mode: nothing to switch to for \(m.rawValue)")
      if !auto { push() }
      return
    }
    mode = m; save()
    gen += 1
    let g = gen
    if let mic = t.mic, b.defaultInput() != mic.uid {
      AutoRoute.shared.noteOwnInput(mic.uid)
      _ = b.setInput(mic.uid)
      guardMic = (mic.uid, Date().addingTimeInterval(micGuard))
    } else if let mic = t.mic { guardMic = (mic.uid, Date().addingTimeInterval(micGuard)) }
    note = ""
    push()
    try1(out, mode: m, attempt: 0, gen: g, auto: auto)
  }
  private func try1(_ out: HPDev, mode m: HPMode, attempt: Int, gen g: Int, auto: Bool) {
    guard let b = backend, g == gen else { return }
    let took = b.setOutput(out.uid)
    let wait = verifyDelays.isEmpty ? 0.4 : verifyDelays[min(attempt, verifyDelays.count - 1)]
    q.asyncAfter(deadline: .now() + wait) { [self] in
      guard g == gen else { return }
      if took && b.defaultOutput() == out.uid {
        psLog("PS headphones mode: \(m.rawValue) on" + (attempt > 0 ? " (macOS took it on try \(attempt + 1))" : ""))
        note = ""
        push()
        if auto { DispatchQueue.main.async { self.announce(m, true) } }
        return
      }
      if attempt + 1 < max(verifyDelays.count, 1), outs(b).contains(where: { $0.uid == out.uid && $0.alive }) {
        try1(out, mode: m, attempt: attempt + 1, gen: g, auto: auto); return
      }
      psLog("PS headphones mode: macOS kept the sound where it was after \(attempt + 1) tries")
      note = "macOS kept the sound where it was. Try again, or pick it in the sound menu."
      push()
      if auto { DispatchQueue.main.async { self.announce(m, false) } }
    }
  }

  /// The state for the mixer pop-up: the mode, every output and microphone, which are in use, the last note.
  private func push() {
    guard let b = backend else { return }
    func row(_ d: HPDev) -> [String: Any] { ["uid": d.uid, "name": d.name, "alive": d.alive, "hp": d.headphoneLike, "builtin": d.builtIn] }
    let o: [String: Any] = ["type": "hpmode", "mode": mode.rawValue, "auto": prefs.auto, "note": note,
                            "outs": outs(b).map(row), "ins": ins(b).map(row),
                            "out": b.defaultOutput() ?? "", "mic": b.defaultInput() ?? ""]
    guard let data = try? JSONSerialization.data(withJSONObject: o), let j = String(data: data, encoding: .utf8) else { return }
    DispatchQueue.main.async { self.deliver?(j) }
  }

  /// From the pages (main.swift, type "hpmode"): get, mode, prefs. Returns at once; the work runs on its own queue.
  func handle(_ m: [String: Any]) {
    q.async { [self] in
      switch m["op"] as? String ?? "" {
      case "get": push()
      case "mode":
        guard let s = m["mode"] as? String, let md = HPMode(rawValue: s) else { return }
        psLog("PS headphones mode: \(md.rawValue) picked")
        apply(md, auto: false)
      case "prefs":
        let p = HPPrefs.from(m["prefs"])
        guard p != prefs else { return }
        let wasAuto = prefs.auto
        prefs = p; setSnap(); save()
        if let b = backend { present = Set(outs(b).filter { $0.alive && HPLogic.isHeadphones($0, prefs) }.map(\.uid)) }
        if wasAuto != p.auto { psLog("PS headphones mode: auto switch \(p.auto ? "on" : "off")") }
        push()
      default: break
      }
    }
  }

  /// For AutoRoute (its own queue): does this auto switch handle these AirPods? out: their output switch;
  /// mic: the microphone too (only when the Headphones microphone list is set).
  func claims(uid: String, name: String) -> (out: Bool, mic: Bool) {
    lock.lock(); let p = snapPrefs; lock.unlock()
    guard p.auto else { return (false, false) }
    let d = HPDev(uid: uid, name: name, alive: true, transport: kAudioDeviceTransportTypeBluetooth)
    let out = HPLogic.isHeadphones(d, p)
    return (out, out && !p.hpMic.isEmpty)
  }

  // Self test helpers.
  func syncForTest() { q.sync {} }
  var noteNow: String { q.sync { note } }
  var modeNow: HPMode { q.sync { mode } }
  var prefsNow: HPPrefs { q.sync { prefs } }
  func resetForTest() { q.sync { gen += 1; mode = .speakers; prefs = HPPrefs(); setSnap(); note = ""; guardMic = nil; present = [] } }
}

// ---------- the real Mac ----------
final class CoreAudioHP: HPBackend {
  private static let sys = AudioObjectID(kAudioObjectSystemObject)
  private let lq = DispatchQueue(label: "PS headphones mode listen")
  private var change: (() -> Void)?
  private var watched: Set<AudioObjectID> = []
  private func addr(_ s: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: s, mScope: scope, mElement: kAudioObjectPropertyElementMain)
  }
  private struct Raw { let id: AudioObjectID; let dev: HPDev }
  /// Real devices only: no virtual or aggregate ones (PS's own mixer devices among them), never 1Password or Signal.
  private func devices(_ scope: AudioObjectPropertyScope) -> [Raw] {
    var a = addr(kAudioHardwarePropertyDevices); var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(Self.sys, &a, 0, nil, &size) == 0, size > 0 else { return [] }
    var ids = [AudioObjectID](repeating: 0, count: Int(size) / 4)
    guard AudioObjectGetPropertyData(Self.sys, &a, 0, nil, &size, &ids) == 0 else { return [] }
    return ids.compactMap { d in
      let name = string(d, kAudioObjectPropertyName)
      guard !Protected.matches(name) else { return nil }
      var s = addr(kAudioDevicePropertyStreams, scope); var n: UInt32 = 0
      guard AudioObjectGetPropertyDataSize(d, &s, 0, nil, &n) == 0, n > 0 else { return nil }
      let t = u32(d, kAudioDevicePropertyTransportType)
      guard t != kAudioDeviceTransportTypeAggregate, t != kAudioDeviceTransportTypeAutoAggregate, t != kAudioDeviceTransportTypeVirtual else { return nil }
      let uid = string(d, kAudioDevicePropertyDeviceUID)
      guard !uid.isEmpty, !uid.hasPrefix("ps-mixer-"), !Protected.matches(uid) else { return nil }
      return Raw(id: d, dev: HPDev(uid: uid, name: name, alive: u32(d, kAudioDevicePropertyDeviceIsAlive) != 0, transport: t))
    }
  }
  private func string(_ o: AudioObjectID, _ s: AudioObjectPropertySelector) -> String {
    var a = addr(s); var v: Unmanaged<CFString>?; var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    return AudioObjectGetPropertyData(o, &a, 0, nil, &size, &v) == 0 ? (v?.takeRetainedValue() as String? ?? "") : ""
  }
  private func u32(_ o: AudioObjectID, _ s: AudioObjectPropertySelector) -> UInt32 {
    var a = addr(s); var v: UInt32 = 0; var size = UInt32(4)
    return AudioObjectGetPropertyData(o, &a, 0, nil, &size, &v) == 0 ? v : 0
  }
  func outputs() -> [HPDev] { let d = devices(kAudioObjectPropertyScopeOutput); watch(d); return d.map(\.dev) }
  func inputs() -> [HPDev] { devices(kAudioObjectPropertyScopeInput).map(\.dev) }
  private func uidOf(_ s: AudioObjectPropertySelector) -> String? { let id = u32(Self.sys, s); return id == 0 ? nil : string(id, kAudioDevicePropertyDeviceUID) }
  func defaultOutput() -> String? { uidOf(kAudioHardwarePropertyDefaultOutputDevice) }
  func defaultInput() -> String? { uidOf(kAudioHardwarePropertyDefaultInputDevice) }
  private func set(_ s: AudioObjectPropertySelector, _ uid: String, _ list: [Raw]) -> Bool {
    guard var id = list.first(where: { $0.dev.uid == uid })?.id else { return false }
    var a = addr(s)
    return AudioObjectSetPropertyData(Self.sys, &a, 0, nil, 4, &id) == noErr
  }
  func setOutput(_ uid: String) -> Bool {
    let list = devices(kAudioObjectPropertyScopeOutput)
    let ok = set(kAudioHardwarePropertyDefaultOutputDevice, uid, list)
    _ = set(kAudioHardwarePropertyDefaultSystemOutputDevice, uid, list)   // alerts too, as the sound menu does
    return ok
  }
  func setInput(_ uid: String) -> Bool { set(kAudioHardwarePropertyDefaultInputDevice, uid, devices(kAudioObjectPropertyScopeInput)) }
  func onChange(_ f: @escaping () -> Void) {
    change = f
    for s in [kAudioHardwarePropertyDevices, kAudioHardwarePropertyDefaultOutputDevice, kAudioHardwarePropertyDefaultInputDevice] {
      var a = addr(s)
      AudioObjectAddPropertyListenerBlock(Self.sys, &a, lq) { [weak self] _, _ in self?.change?() }
    }
    watch(devices(kAudioObjectPropertyScopeOutput))
  }
  /// Each output also says when it comes alive (Bluetooth headphones can stay listed while asleep).
  private func watch(_ list: [Raw]) {
    for r in list where !watched.contains(r.id) {
      watched.insert(r.id)
      var a = addr(kAudioDevicePropertyDeviceIsAlive)
      AudioObjectAddPropertyListenerBlock(r.id, &a, lq) { [weak self] _, _ in self?.change?() }
    }
  }
}

// ---------- a test copy: fake devices, nothing real is read or changed ----------
final class FakeHP: HPBackend {
  var outs: [HPDev] = []
  var ins: [HPDev] = []
  var out: String?
  var mic: String?
  /// Like macOS: answers yes to this many output switches but keeps the old output.
  var ignoreSets = 0
  private(set) var outputSets = 0
  private var change: (() -> Void)?
  func outputs() -> [HPDev] { outs }
  func inputs() -> [HPDev] { ins }
  func defaultOutput() -> String? { out }
  func defaultInput() -> String? { mic }
  func setOutput(_ uid: String) -> Bool {
    outputSets += 1
    guard outs.contains(where: { $0.uid == uid }) else { return false }
    if ignoreSets > 0 { ignoreSets -= 1; return true }
    out = uid; changed(); return true
  }
  func setInput(_ uid: String) -> Bool { guard ins.contains(where: { $0.uid == uid }) else { return false }; mic = uid; changed(); return true }
  func onChange(_ f: @escaping () -> Void) { change = f }
  func changed() { change?() }
}
