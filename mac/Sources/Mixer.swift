// Per-app volume mixer (the developer, 24 Oct 2026, "like Windows 10's"). The Tab list's mixer button opens a
// pop-up with one row per app making sound: its icon and name, a volume slider (0 to 150%), Mute,
// and "Keep out of recordings". A master row shows the Mac's own volume. Levels are remembered per
// app (UserDefaults "mixer.levels") and come back whenever the app plays again.
//
// How: an app at 100%, unmuted and not kept out is never touched. Otherwise PS makes a Core Audio
// process tap of that app's processes (CATapDescription, muted while PS reads it, private), puts it
// in a private aggregate device with the output device, and plays it back from the real time IO
// thread with the gain (ramped every buffer, so no clicks; a soft limit above 100%). Nothing is
// recorded, saved or sent anywhere: the samples go from the tap to the speakers and nowhere else.
// Helpers are grouped under their app by macOS's "responsible process" (browser helpers and audio
// services, WebKit GPU processes under the browser that started them). A second copy of a browser
// started with its own data folder is its own row (several profiles inside ONE browser copy share
// one audio process, so macOS cannot tell them apart: see the report of 24 Oct).
// Keep out of recordings: that app's tapped audio goes straight to the physical output (AirPods or
// speakers), never to a virtual or loopback device (BlackHole, Loopback, an OBS multi-output), so a
// recorder that records such a device does not get it. Recorders that capture all Mac sound
// (ScreenCaptureKit, QuickTime, OBS's macOS audio capture) still hear it: the pop-up says so.
// Only while the app plays (the developer, 4 Nov 2026): a tap and its aggregate device run only while that app
// is actually playing sound (kAudioProcessPropertyIsRunningOutput, heard through a property listener
// on each process, so the tap starts within tens of milliseconds and the voice ramps in), and stop
// about 10 seconds after it goes quiet. Before, a tap ran for every app below 100% that merely had
// processes; its running IO kept coreaudiod's output context alive, which holds
// PreventUserIdleSystemSleep, so the Mac never idle slept and the battery drained (the night of the
// power cut). The level is kept and comes back the moment the app plays again.
// Safety: a tap that never runs, or stays silent while its app is playing (protected audio, or no
// permission), is removed within seconds and the app plays untouched again ("can't adjust").
// macOS asks once for "System Audio Recording", only after the developer's first slider move and a short
// explanation. GOLDEN RULE: 1Password and Signal are dropped at the first look, never tapped,
// listed or metered; Signal calls always play untouched. PS itself is never in the list.
// Everything runs on the mixer's own queue (and the audio thread); a test copy uses a fake backend.
import AppKit
import CoreAudio
import AudioToolbox

// ---------- what the mixer needs from the Mac (a self test copy swaps in a fake) ----------
struct MixProc { let object: AudioObjectID; let pid: pid_t; let bundle: String; let playing: Bool }
struct MixDevice { let id: AudioObjectID; let uid: String; let name: String; let transport: UInt32; let subUIDs: [String] }
struct MixApp { let pid: pid_t; let bundle: String; let name: String; let regular: Bool }
protocol MixTap: AnyObject { func stop() }
protocol MixBackend: AnyObject {
  func processes() -> [MixProc]
  func outputDevices() -> [MixDevice]
  func defaultOutput() -> MixDevice?
  /// The app a process belongs to (macOS's responsible process), or nil.
  func app(of pid: pid_t) -> MixApp?
  /// The data folder name of a browser copy started with its own --user-data-dir, if any.
  func instanceTag(_ pid: pid_t) -> String?
  func icon(_ pid: pid_t) -> String?
  func master() -> (volume: Float, muted: Bool)?
  func setMaster(volume: Float?, muted: Bool?)
  /// "ok", "denied" or "unknown" for System Audio Recording.
  func permission() -> String
  func requestPermission(_ done: @escaping (Bool) -> Void)
  func startTap(_ objects: [AudioObjectID], deviceUID: String, voice: MixVoice) -> MixTap?
  /// Hear when these processes start or stop playing (they belong to apps with a level set).
  func watchPlaying(_ objects: [AudioObjectID])
  func onChange(_ f: @escaping () -> Void)
  func runningBundles() -> Set<String>
  func sampleRate(_ uid: String) -> Double
}

/// One app's sound on its way from the tap to the speakers. render() runs on the real time IO
/// thread: no locks, no allocation; the gain is read as one Float.
final class MixVoice {
  private let target = UnsafeMutablePointer<Float>.allocate(capacity: 1)
  private var current: Float = 0                 // starts silent and ramps up: no click when the tap starts
  private(set) var peak: Float = 0
  private(set) var callbacks: UInt64 = 0
  private(set) var heardSound = false
  private(set) var lastSound: UInt64 = 0
  init(gain: Float) { target.pointee = gain }
  deinit { target.deallocate() }
  func setGain(_ g: Float) { target.pointee = max(0, min(1.5, g)) }
  var gain: Float { target.pointee }
  func takePeak() -> Float { let p = peak; peak = 0; return p }

  /// Copies the tap's samples to the output with the gain. Float32, interleaved or not, any channel count.
  func render(_ input: UnsafePointer<AudioBufferList>, _ output: UnsafeMutablePointer<AudioBufferList>) {
    callbacks &+= 1
    let ins = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
    let outs = UnsafeMutableAudioBufferListPointer(output)
    let g0 = current, g1 = target.pointee
    var inChannels = 0
    for b in ins { inChannels += Int(b.mNumberChannels) }
    var p: Float = 0
    var outCh = 0
    for ob in outs {
      guard let od = ob.mData?.assumingMemoryBound(to: Float.self) else { continue }
      let oc = max(1, Int(ob.mNumberChannels))
      let frames = Int(ob.mDataByteSize) / (4 * oc)
      for c in 0..<oc {
        let src = inChannels == 0 ? -1 : min(outCh + c, inChannels - 1)
        // Find the input buffer and channel offset for src.
        var sd: UnsafeMutablePointer<Float>?; var sc = 1; var so = 0; var sframes = 0
        if src >= 0 {
          var acc = 0
          for ib in ins {
            let n = Int(ib.mNumberChannels)
            if src < acc + n, let d = ib.mData?.assumingMemoryBound(to: Float.self) { sd = d; sc = max(1, n); so = src - acc; sframes = Int(ib.mDataByteSize) / (4 * max(1, n)); break }
            acc += n
          }
        }
        let n = min(frames, sframes)
        let step = frames > 0 ? (g1 - g0) / Float(frames) : 0
        for f in 0..<frames {
          var x: Float = 0
          if let sd, f < n {
            x = sd[f * sc + so]
            if x != 0 { heardSound = true }
            let a = abs(x); if a > p { p = a }
          }
          var y = x * (g0 + step * Float(f))
          let ay = abs(y)
          if ay > 0.9 { y = (y < 0 ? -1 : 1) * (0.9 + 0.1 * tanhf((ay - 0.9) / 0.1)) }   // a soft limit above 100%, never a hard clip
          od[f * oc + c] = y
        }
      }
      outCh += oc
    }
    current = g1
    if p > 0.0001 { lastSound = mach_absolute_time() }
    if p * g1 > peak { peak = min(1, p * g1) }
  }
}

final class Mixer {
  static let shared = Mixer()
  private let q = DispatchQueue(label: "PS mixer", qos: .userInitiated)
  private var backend: MixBackend!
  private var testDir: String?
  /// The overlay page gets {type:"mixer", ...} while the pop-up is open.
  var deliver: ((String) -> Void)?

  struct Level: Codable { var gain: Float = 1; var muted = false; var hide = false }
  struct Prefs: Codable, Equatable {
    var density = "roomy"; var icons = true; var slider = "thin"; var color = "#A78BFA"; var filter = "playing"; var sort = "name"; var meters = true; var opacity = 0.96
    init() {}
    init(from d: Decoder) throws {
      let c = try d.container(keyedBy: CodingKeys.self); let z = Prefs()
      density = (try? c.decode(String.self, forKey: .density)) ?? z.density; icons = (try? c.decode(Bool.self, forKey: .icons)) ?? z.icons
      slider = (try? c.decode(String.self, forKey: .slider)) ?? z.slider; color = (try? c.decode(String.self, forKey: .color)) ?? z.color
      filter = (try? c.decode(String.self, forKey: .filter)) ?? z.filter; sort = (try? c.decode(String.self, forKey: .sort)) ?? z.sort
      meters = (try? c.decode(Bool.self, forKey: .meters)) ?? z.meters; opacity = (try? c.decode(Double.self, forKey: .opacity)) ?? z.opacity
    }
  }
  private struct Group {
    var key: String; var bundle: String; var name: String; var pid: pid_t; var tag: String?
    var objects: [AudioObjectID]; var playing: Bool; var lastPlayed: Date?
  }
  private struct Tapped { var tap: MixTap; var voice: MixVoice; var device: String; var objects: [AudioObjectID]; var started: Date; var rate: Double }

  private var levels: [String: Level] = [:]
  private(set) var prefs = Prefs()
  private var groups: [String: Group] = [:]
  private var taps: [String: Tapped] = [:]
  private var cant: [String: Date] = [:]          // can't adjust (protected audio, or the tap never ran): untouched for a while
  private var icons: [String: String] = [:]
  private var open = false
  private var permission = "unknown"
  private var asked = false                       // the explanation was shown and the developer said go
  private var pendingWhileAsking: [(String, Level)] = []
  private var timer: DispatchSourceTimer?
  private var quietSince: [String: Date] = [:]    // a tapped app that stopped playing, since when
  /// How long a tap stays after its app goes quiet (a pause between songs keeps it), then it stops.
  var quietHold: Double = 10
  private var stateAt = Date.distantPast

  // ---------- start ----------
  func start(testDir: String?, backend: MixBackend? = nil) {
    self.testDir = testDir
    q.async { [self] in
      self.backend = backend ?? (testDir == nil ? CoreAudioMix() : FakeMix())
      load()
      permission = self.backend.permission()
      self.backend.onChange { [weak self] in self?.q.async { self?.refresh() } }
      refresh()
      let t = DispatchSource.makeTimerSource(queue: q)
      t.schedule(deadline: .now() + 1, repeating: 1, leeway: .milliseconds(150))
      t.setEventHandler { [weak self] in self?.tick() }
      t.resume(); timer = t
    }
  }
  private func defaultsKey(_ k: String) -> String { testDir == nil ? k : "test." + k }
  private func load() {
    let d = UserDefaults.standard
    if testDir == nil, let x = d.data(forKey: "mixer.levels"), let l = try? JSONDecoder().decode([String: Level].self, from: x) { levels = l }
    if testDir == nil, let x = d.data(forKey: "mixer.ui"), let p = try? JSONDecoder().decode(Prefs.self, from: x) { prefs = p }
    if let x = testFile("mixer.json"), let o = try? JSONDecoder().decode(Saved.self, from: x) { levels = o.levels; prefs = o.prefs; asked = o.asked }
    else if testDir == nil { asked = d.bool(forKey: "mixer.asked") }
  }
  private struct Saved: Codable { var levels: [String: Level]; var prefs: Prefs; var asked: Bool }
  private func testFile(_ n: String) -> Data? { testDir.flatMap { try? Data(contentsOf: URL(fileURLWithPath: $0).appendingPathComponent(n)) } }
  private func save() {
    if let dir = testDir {
      if let x = try? JSONEncoder().encode(Saved(levels: levels, prefs: prefs, asked: asked)) { try? x.write(to: URL(fileURLWithPath: dir).appendingPathComponent("mixer.json")) }
      return
    }
    let d = UserDefaults.standard
    if let x = try? JSONEncoder().encode(levels) { d.set(x, forKey: "mixer.levels") }
    if let x = try? JSONEncoder().encode(prefs) { d.set(x, forKey: "mixer.ui") }
    d.set(asked, forKey: "mixer.asked")
  }

  // ---------- the apps making sound ----------
  /// GOLDEN RULE: 1Password and Signal never get past here, by the process or by its app. PS itself neither.
  private func excluded(_ s: String) -> Bool { Protected.matches(s) || s.lowercased().hasPrefix("com.cincee.ps") }
  private func refresh() {
    guard let backend else { return }
    var next: [String: Group] = [:]
    for p in backend.processes() {
      if excluded(p.bundle) { continue }
      guard let a = backend.app(of: p.pid), !excluded(a.bundle), a.regular else { continue }   // system services stay out
      let tag = backend.instanceTag(a.pid)
      let key = a.bundle + (tag.map { "|" + $0 } ?? "")
      var g = next[key] ?? groups[key] ?? Group(key: key, bundle: a.bundle, name: a.name + (tag.map { " (\($0))" } ?? ""), pid: a.pid, tag: tag, objects: [], playing: false, lastPlayed: nil)
      if next[key] == nil { g.objects = []; g.playing = false }
      g.objects.append(p.object)
      if p.playing { g.playing = true; g.lastPlayed = Date() }
      g.pid = a.pid
      next[key] = g
      if icons[key] == nil, let i = backend.icon(a.pid) { icons[key] = i }
    }
    for (k, g) in next { next[k]?.objects = g.objects.sorted() }
    for (k, g) in next {
      if g.playing { quietSince[k] = nil } else if quietSince[k] == nil, taps[k] != nil { quietSince[k] = Date() }
    }
    quietSince = quietSince.filter { next[$0.key] != nil }
    groups = next
    reconcile()
    if open { push() }
  }
  /// Which apps need a tap, and on which device. Taps follow the app's processes and the output device.
  private func reconcile() {
    guard let backend else { return }
    let def = backend.defaultOutput()
    let physical = physicalOutput()
    var want: [String: (objects: [AudioObjectID], device: String)] = [:]
    if permission == "ok" {
      for (k, g) in groups {
        guard let l = levels[k], l.gain != 1 || l.muted || l.hide, cant[k] == nil, !g.objects.isEmpty else { continue }
        backend.watchPlaying(g.objects)
        // Only while it plays, or for quietHold seconds after (no IO, so the Mac can sleep).
        guard g.playing || (taps[k] != nil && quietSince[k].map { Date().timeIntervalSince($0) < quietHold } ?? true) else { continue }
        guard let dev = l.hide ? physical : def?.uid else { continue }
        want[k] = (g.objects, dev)
      }
    }
    for (k, t) in taps where want[k] == nil || want[k]!.objects != t.objects || want[k]!.device != t.device {
      t.tap.stop(); taps[k] = nil
    }
    for (k, w) in want where taps[k] == nil {
      let l = levels[k] ?? Level()
      let v = MixVoice(gain: l.muted ? 0 : l.gain)
      MixRefusal.last = ""
      if let tap = backend.startTap(w.objects, deviceUID: w.device, voice: v) {
        taps[k] = Tapped(tap: tap, voice: v, device: w.device, objects: w.objects, started: Date(), rate: backend.sampleRate(w.device))
        psLog("PS mixer: adjusting \(groups[k]?.name ?? k)")
      } else {
        cant[k] = Date(); psLog("PS mixer: could not adjust \(groups[k]?.name ?? k)\(MixRefusal.last.isEmpty ? "" : ", macOS refused the \(MixRefusal.last)")")
      }
    }
    for (k, t) in taps { let l = levels[k] ?? Level(); t.voice.setGain(l.muted ? 0 : l.gain) }
  }
  /// The physical device for "Keep out of recordings": the default output when it is real; the real
  /// device inside a multi-output; else the first real output (Bluetooth, then built in).
  func physicalOutput() -> String? {
    guard let backend else { return nil }
    let all = backend.outputDevices(), def = backend.defaultOutput()
    func isVirtual(_ d: MixDevice) -> Bool { d.transport == kAudioDeviceTransportTypeVirtual || d.transport == kAudioDeviceTransportTypeAggregate || d.transport == kAudioDeviceTransportTypeAutoAggregate }
    if let def, !isVirtual(def) { return def.uid }
    if let def {
      for u in def.subUIDs { if let d = all.first(where: { $0.uid == u }), !isVirtual(d) { return d.uid } }
    }
    return (all.first { $0.transport == kAudioDeviceTransportTypeBluetooth } ?? all.first { !isVirtual($0) })?.uid
  }
  /// Recording through a virtual or loopback device right now (the default output is one, or holds one).
  private func recordingDevice() -> String? {
    guard let backend, let def = backend.defaultOutput() else { return nil }
    let all = backend.outputDevices()
    if def.transport == kAudioDeviceTransportTypeVirtual { return def.name }
    for u in def.subUIDs { if let d = all.first(where: { $0.uid == u }), d.transport == kAudioDeviceTransportTypeVirtual { return d.name } }
    return nil
  }

  // ---------- every second: safety, meters ----------
  private func tick() {
    let now = Date()
    // The output device changed its sample rate (AirPods switching modes): rebuild those taps.
    var rebuilt = false
    for (k, t) in taps where backend.sampleRate(t.device) != t.rate { t.tap.stop(); taps[k] = nil; rebuilt = true }
    // A tapped app quiet for quietHold seconds: its tap stops.
    let expired = taps.keys.contains { k in quietSince[k].map { now.timeIntervalSince($0) >= quietHold } ?? false }
    if rebuilt || expired { reconcile() }
    for (k, t) in taps {
      let age = now.timeIntervalSince(t.started)
      if age > 1.5 && t.voice.callbacks == 0 { fail(k, "the tap never ran"); continue }
      if age > 4, groups[k]?.playing == true, !t.voice.heardSound { fail(k, "silent while playing (protected audio)"); continue }
    }
    cant = cant.filter { now.timeIntervalSince($0.value) < 120 }        // tried again after two minutes, or on the next slider move
    if open { refresh() }                                                // who is playing, and the meters, while the pop-up is open
  }
  private func fail(_ k: String, _ why: String) {
    taps[k]?.tap.stop(); taps[k] = nil
    cant[k] = Date()
    psLog("PS mixer: \(groups[k]?.name ?? k) left untouched, \(why)")
    if open { push() }
  }

  // ---------- the pop-up ----------
  private func push() {
    guard let backend else { return }
    var rows: [[String: Any]] = []
    let now = Date()
    for (k, g) in groups {
      let recent = g.lastPlayed.map { now.timeIntervalSince($0) < 1800 } ?? false
      guard g.playing || recent || levels[k] != nil else { continue }
      let l = levels[k] ?? Level()
      var r: [String: Any] = ["key": k, "name": g.name, "playing": g.playing, "gain": Double(l.gain), "muted": l.muted, "hide": l.hide,
                              "cant": cant[k] != nil, "adjusted": taps[k] != nil, "meter": Double(taps[k]?.voice.takePeak() ?? 0)]
      if prefs.icons, let i = icons[k] { r["icon"] = i }
      if let t = g.tag { r["instance"] = t }
      rows.append(r)
    }
    var d: [String: Any] = ["type": "mixer", "rows": rows, "permission": permission, "asked": asked, "prefs": prefsJSON(), "hints": hints()]
    if let m = backend.master() { d["master"] = ["volume": Double(m.volume), "muted": m.muted, "device": backend.defaultOutput()?.name ?? ""] }
    guard let data = try? JSONSerialization.data(withJSONObject: d), let j = String(data: data, encoding: .utf8) else { return }
    DispatchQueue.main.async { self.deliver?(j) }
  }
  private func prefsJSON() -> [String: Any] {
    ["density": prefs.density, "icons": prefs.icons, "slider": prefs.slider, "color": prefs.color, "filter": prefs.filter, "sort": prefs.sort, "meters": prefs.meters, "opacity": prefs.opacity]
  }
  /// What a recording will and will not hear, said plainly (never more protection than there is).
  private func hints() -> [String] {
    guard let backend else { return [] }
    var h: [String] = []
    let run = backend.runningBundles()
    let anyHidden = levels.contains { $0.value.hide }
    if let v = recordingDevice() { h.append("Recording through \(v): apps kept out go straight to your \(backend.outputDevices().first { $0.uid == physicalOutput() }?.name ?? "speakers"), not into it.") }
    if run.contains("com.obsproject.obs-studio") { h.append("OBS: capture your meeting app only, or exclude PS app. OBS's own Mac audio capture hears everything PS app plays.") }
    let screen = ["com.apple.QuickTimePlayerX": "QuickTime", "com.loom.desktop": "Loom", "pl.maketheweb.cleanshotx": "CleanShot", "com.techsmith.camtasia2023": "Camtasia", "net.telestream.screenflow10": "ScreenFlow"]
    for (b, n) in screen where run.contains(b) { h.append("\(n) records all Mac sound, so it still hears apps kept out.") }
    if anyHidden && h.isEmpty { h.append("Kept out works for recordings made through a loopback device (BlackHole, Loopback). Screen recorders that take all Mac sound still hear it.") }
    return h
  }

  /// From the Tab list page (main.swift, type "mixer"). Click only, except slider drags.
  func handle(_ m: [String: Any]) {
    q.async { [self] in
      switch m["op"] as? String ?? "" {
      case "open": open = true; refresh()
      case "close": open = false
      case "gain", "mute", "hide":
        guard let k = m["key"] as? String, groups[k] != nil || levels[k] != nil, !excluded(k) else { return }
        var l = levels[k] ?? Level()
        if let v = m["value"] as? Double { l.gain = Float(max(0, min(1.5, v))) }
        if let b = m["muted"] as? Bool { l.muted = b }
        if let b = m["hide"] as? Bool { l.hide = b }
        levels[k] = l; cant[k] = nil; save()
        if permission != "ok" && !asked { push(); return }          // the page shows the explanation first; nothing is tapped yet
        reconcile(); push()
      case "allow":                                                     // The developer read the explanation and said go
        asked = true; save()
        backend.requestPermission { [weak self] ok in
          self?.q.async { guard let self else { return }; self.permission = ok ? "ok" : self.backend.permission() == "ok" ? "ok" : "denied"; self.reconcile(); self.push() }
        }
      case "retry":
        if let k = m["key"] as? String { cant[k] = nil; reconcile(); push() }
      case "master":
        backend.setMaster(volume: (m["value"] as? Double).map { Float(max(0, min(1, $0))) }, muted: m["muted"] as? Bool); push()
      case "prefs":
        guard let p = m["prefs"] as? [String: Any] else { return }
        if let v = p["density"] as? String, ["compact", "roomy"].contains(v) { prefs.density = v }
        if let v = p["icons"] as? Bool { prefs.icons = v }
        if let v = p["slider"] as? String, ["thin", "thick", "pill"].contains(v) { prefs.slider = v }
        if let v = p["color"] as? String, v.range(of: "^#[0-9A-Fa-f]{6}$", options: .regularExpression) != nil { prefs.color = v.uppercased() }
        if let v = p["filter"] as? String, ["playing", "recent"].contains(v) { prefs.filter = v }
        if let v = p["sort"] as? String, ["name", "loud"].contains(v) { prefs.sort = v }
        if let v = p["meters"] as? Bool { prefs.meters = v }
        if let v = p["opacity"] as? Double { prefs.opacity = max(0.55, min(1, v)) }
        save(); push()
      default: break
      }
    }
  }

  // Self test helpers.
  func syncForTest() { q.sync {} }
  var tapDevices: [String: String] { q.sync { taps.mapValues { $0.device } } }
  var rowKeys: [String] { q.sync { Array(groups.keys) } }
  func groupObjects(_ k: String) -> [AudioObjectID] { q.sync { groups[k]?.objects ?? [] } }
  func level(_ k: String) -> Level? { q.sync { levels[k] } }
  func voice(_ k: String) -> MixVoice? { q.sync { taps[k]?.voice } }
  func cantAdjust(_ k: String) -> Bool { q.sync { cant[k] != nil } }
  var currentPrefs: Prefs { q.sync { prefs } }
  var hintsNow: [String] { q.sync { hints() } }
  var permissionNow: String { q.sync { permission } }
  func reloadForTest() { q.sync { levels = [:]; prefs = Prefs(); asked = false; load(); groups = [:]; for (_, t) in taps { t.tap.stop() }; taps = [:]; refresh() } }
  func tickForTest() { q.sync { tick() } }
  var fake: FakeMix? { q.sync { backend as? FakeMix } }
}

// ---------- the real Mac: Core Audio ----------
final class CoreAudioMix: MixBackend {
  private static let sys = AudioObjectID(kAudioObjectSystemObject)
  private func addr(_ s: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: s, mScope: scope, mElement: kAudioObjectPropertyElementMain)
  }
  private func get<T>(_ o: AudioObjectID, _ s: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal, _ def: T) -> T {
    var a = addr(s, scope); var v = def; var size = UInt32(MemoryLayout<T>.size)
    return AudioObjectGetPropertyData(o, &a, 0, nil, &size, &v) == 0 ? v : def
  }
  private func string(_ o: AudioObjectID, _ s: AudioObjectPropertySelector) -> String {
    var a = addr(s); var v: Unmanaged<CFString>?; var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    return AudioObjectGetPropertyData(o, &a, 0, nil, &size, &v) == 0 ? (v?.takeRetainedValue() as String? ?? "") : ""
  }
  private func ids(_ o: AudioObjectID, _ s: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> [AudioObjectID] {
    var a = addr(s, scope); var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(o, &a, 0, nil, &size) == 0, size > 0 else { return [] }
    var out = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    return AudioObjectGetPropertyData(o, &a, 0, nil, &size, &out) == 0 ? out : []
  }

  func processes() -> [MixProc] {
    ids(Self.sys, kAudioHardwarePropertyProcessObjectList).map { o in
      MixProc(object: o, pid: get(o, kAudioProcessPropertyPID, kAudioObjectPropertyScopeGlobal, pid_t(0)), bundle: string(o, kAudioProcessPropertyBundleID),
              playing: get(o, kAudioProcessPropertyIsRunningOutput, kAudioObjectPropertyScopeGlobal, UInt32(0)) != 0)
    }
  }
  func outputDevices() -> [MixDevice] {
    ids(Self.sys, kAudioHardwarePropertyDevices).compactMap { d in
      var a = addr(kAudioDevicePropertyStreams, kAudioObjectPropertyScopeOutput); var size: UInt32 = 0
      guard AudioObjectGetPropertyDataSize(d, &a, 0, nil, &size) == 0, size > 0 else { return nil }
      return device(d)
    }
  }
  private func device(_ d: AudioObjectID) -> MixDevice {
    var subs: [String] = []
    if let arr = cfArray(d, kAudioAggregateDevicePropertyFullSubDeviceList) { subs = arr }
    return MixDevice(id: d, uid: string(d, kAudioDevicePropertyDeviceUID), name: string(d, kAudioObjectPropertyName), transport: get(d, kAudioDevicePropertyTransportType, kAudioObjectPropertyScopeGlobal, UInt32(0)), subUIDs: subs)
  }
  private func cfArray(_ o: AudioObjectID, _ s: AudioObjectPropertySelector) -> [String]? {
    var a = addr(s); var v: Unmanaged<CFArray>?; var size = UInt32(MemoryLayout<Unmanaged<CFArray>?>.size)
    guard AudioObjectGetPropertyData(o, &a, 0, nil, &size, &v) == 0, let arr = v?.takeRetainedValue() as? [String] else { return nil }
    return arr
  }
  func defaultOutput() -> MixDevice? {
    let d: AudioObjectID = get(Self.sys, kAudioHardwarePropertyDefaultOutputDevice, kAudioObjectPropertyScopeGlobal, AudioObjectID(0))
    return d == 0 ? nil : device(d)
  }
  private typealias RespFn = @convention(c) (pid_t) -> pid_t
  private lazy var responsible: RespFn? = {
    guard let s = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "responsibility_get_pid_responsible_for_pid") else { return nil }
    return unsafeBitCast(s, to: RespFn.self)
  }()
  func app(of pid: pid_t) -> MixApp? {
    var r = responsible?(pid) ?? pid
    if r <= 0 { r = pid }
    guard let a = NSRunningApplication(processIdentifier: r) ?? NSRunningApplication(processIdentifier: pid), let b = a.bundleIdentifier else { return nil }
    return MixApp(pid: a.processIdentifier, bundle: b, name: a.localizedName ?? b, regular: a.activationPolicy == .regular)
  }
  func instanceTag(_ pid: pid_t) -> String? {
    // KERN_PROCARGS2 of the app's main process (same user): "--user-data-dir=<path>" names a separate copy.
    var mib: [Int32] = [CTL_KERN, KERN_PROCARGS2, pid]; var size = 0
    guard sysctl(&mib, 3, nil, &size, nil, 0) == 0, size > 0, size < 1 << 20 else { return nil }
    var buf = [UInt8](repeating: 0, count: size)
    guard sysctl(&mib, 3, &buf, &size, nil, 0) == 0 else { return nil }
    let parts = buf.split(separator: 0).compactMap { String(bytes: $0, encoding: .utf8) }
    guard let arg = parts.first(where: { $0.hasPrefix("--user-data-dir=") }) else { return nil }
    let name = URL(fileURLWithPath: String(arg.dropFirst(16))).lastPathComponent
    return name.isEmpty ? nil : String(name.prefix(40))
  }
  func icon(_ pid: pid_t) -> String? {
    guard let img = NSRunningApplication(processIdentifier: pid)?.icon else { return nil }
    let size = NSSize(width: 32, height: 32)
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 32, pixelsHigh: 32, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    img.draw(in: NSRect(origin: .zero, size: size))
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:]).map { "data:image/png;base64," + $0.base64EncodedString() }
  }
  func master() -> (volume: Float, muted: Bool)? {
    guard let d = defaultOutput()?.id else { return nil }
    let v: Float32 = get(d, kAudioHardwareServiceDeviceProperty_VirtualMainVolume, kAudioObjectPropertyScopeOutput, Float32(-1))
    let m: UInt32 = get(d, kAudioDevicePropertyMute, kAudioObjectPropertyScopeOutput, UInt32(0))
    return v < 0 ? nil : (v, m != 0)
  }
  func setMaster(volume: Float?, muted: Bool?) {
    guard let d = defaultOutput()?.id else { return }
    if var v = volume { var a = addr(kAudioHardwareServiceDeviceProperty_VirtualMainVolume, kAudioObjectPropertyScopeOutput); AudioObjectSetPropertyData(d, &a, 0, nil, UInt32(MemoryLayout<Float32>.size), &v) }
    if let m = muted { var x: UInt32 = m ? 1 : 0; var a = addr(kAudioDevicePropertyMute, kAudioObjectPropertyScopeOutput); AudioObjectSetPropertyData(d, &a, 0, nil, 4, &x) }
  }
  // System Audio Recording permission: macOS's own TCC check and request (read and ask only).
  private typealias PreflightFn = @convention(c) (CFString, CFDictionary?) -> Int
  private typealias RequestFn = @convention(c) (CFString, CFDictionary?, @escaping (Bool) -> Void) -> Void
  private lazy var tcc: UnsafeMutableRawPointer? = dlopen("/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC", RTLD_NOW)
  func permission() -> String {
    guard let h = tcc, let s = dlsym(h, "TCCAccessPreflight") else { return "unknown" }
    switch unsafeBitCast(s, to: PreflightFn.self)("kTCCServiceAudioCapture" as CFString, nil) { case 0: return "ok"; case 1: return "denied"; default: return "unknown" }
  }
  func requestPermission(_ done: @escaping (Bool) -> Void) {
    guard let h = tcc, let s = dlsym(h, "TCCAccessRequest") else { done(false); return }
    unsafeBitCast(s, to: RequestFn.self)("kTCCServiceAudioCapture" as CFString, nil) { ok in done(ok) }
  }
  func startTap(_ objects: [AudioObjectID], deviceUID: String, voice: MixVoice) -> MixTap? {
    guard #available(macOS 14.2, *) else { return nil }
    return CoreTap(objects: objects, deviceUID: deviceUID, voice: voice)
  }
  private var listening = false
  private let listenQ = DispatchQueue(label: "PS mixer listen")
  private var change: (() -> Void)?
  private var watchedProcs: Set<AudioObjectID> = []    // the mixer's queue only
  /// The processes of an app with a level set say when they start or stop playing, so its tap starts
  /// within tens of milliseconds and the mixer hears it go quiet. Only apps PS may adjust are ever
  /// passed here (1Password, Signal and PS never are). Listening only.
  func watchPlaying(_ list: [AudioObjectID]) {
    guard change != nil else { return }
    let alive = Set(ids(Self.sys, kAudioHardwarePropertyProcessObjectList))
    watchedProcs.formIntersection(alive)                 // gone processes are forgotten (their listeners go with the object)
    for o in list where !watchedProcs.contains(o) {
      var a = addr(kAudioProcessPropertyIsRunningOutput)
      if AudioObjectAddPropertyListenerBlock(o, &a, listenQ, { [weak self] _, _ in self?.change?() }) == noErr { watchedProcs.insert(o) }
    }
  }
  func onChange(_ f: @escaping () -> Void) {
    guard !listening else { return }
    listening = true
    change = f
    let q = listenQ
    for s in [kAudioHardwarePropertyProcessObjectList, kAudioHardwarePropertyDefaultOutputDevice, kAudioHardwarePropertyDevices] {
      var a = addr(s)
      AudioObjectAddPropertyListenerBlock(Self.sys, &a, q) { _, _ in f() }
    }
  }
  func runningBundles() -> Set<String> { Set(NSWorkspace.shared.runningApplications.compactMap { $0.bundleIdentifier }) }
  func sampleRate(_ uid: String) -> Double {
    guard let d = outputDevices().first(where: { $0.uid == uid }) else { return 0 }
    return get(d.id, kAudioDevicePropertyNominalSampleRate, kAudioObjectPropertyScopeGlobal, Float64(0))
  }
}

/// V1.47: which step macOS refused on the last failed tap, with its status ("tap -1234"), so "could not adjust"
/// says why (after a macOS update a tap can be refused with nothing on screen). The mixer's queue only.
enum MixRefusal { static var last = "" }

/// One app's tap and its private aggregate device, playing through the voice on the real time IO thread.
@available(macOS 14.2, *)
final class CoreTap: MixTap {
  private var tapID = AudioObjectID(kAudioObjectUnknown)
  private var agg = AudioObjectID(kAudioObjectUnknown)
  private var proc: AudioDeviceIOProcID?
  init?(objects: [AudioObjectID], deviceUID: String, voice: MixVoice) {
    let d = CATapDescription(stereoMixdownOfProcesses: objects)
    d.uuid = UUID(); d.muteBehavior = .mutedWhenTapped; d.isPrivate = true; d.name = "PS mixer"
    let st = AudioHardwareCreateProcessTap(d, &tapID)
    guard st == noErr, tapID != kAudioObjectUnknown else { MixRefusal.last = "tap \(st)"; return nil }
    let desc: [String: Any] = [
      kAudioAggregateDeviceNameKey: "PS mixer", kAudioAggregateDeviceUIDKey: "ps-mixer-" + UUID().uuidString,
      kAudioAggregateDeviceMainSubDeviceKey: deviceUID, kAudioAggregateDeviceIsPrivateKey: true, kAudioAggregateDeviceIsStackedKey: false,
      kAudioAggregateDeviceTapAutoStartKey: true,
      kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: deviceUID]],
      kAudioAggregateDeviceTapListKey: [[kAudioSubTapDriftCompensationKey: true, kAudioSubTapUIDKey: d.uuid.uuidString]],
    ]
    let ag = AudioHardwareCreateAggregateDevice(desc as CFDictionary, &agg)
    guard ag == noErr else { MixRefusal.last = "aggregate device \(ag)"; stop(); return nil }
    let ok = AudioDeviceCreateIOProcIDWithBlock(&proc, agg, nil) { _, input, _, output, _ in voice.render(input, output) }
    guard ok == noErr, let proc else { MixRefusal.last = "io proc \(ok)"; stop(); return nil }
    let go = AudioDeviceStart(agg, proc)
    guard go == noErr else { MixRefusal.last = "start \(go)"; stop(); return nil }
  }
  func stop() {
    if let p = proc { AudioDeviceStop(agg, p); AudioDeviceDestroyIOProcID(agg, p); proc = nil }
    if agg != kAudioObjectUnknown { AudioHardwareDestroyAggregateDevice(agg); agg = kAudioObjectUnknown }
    if tapID != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tapID); tapID = kAudioObjectUnknown }
  }
  deinit { stop() }
}

// ---------- a test copy's Mac: fake apps, fake devices, fake taps (no real audio is ever touched) ----------
final class FakeMix: MixBackend {
  var procs: [MixProc] = []
  var apps: [pid_t: MixApp] = [:]           // process -> its app
  var tags: [pid_t: String] = [:]
  var devices: [MixDevice] = []
  var defaultUID = ""
  var masterVol: Float = 0.5, masterMuted = false
  var perm = "unknown", grant = true
  var running: Set<String> = []
  var silent: Set<AudioObjectID> = []       // taps of these processes hear nothing (protected audio)
  final class Tap: MixTap { var stopped = false; let objects: [AudioObjectID]; let device: String; init(_ o: [AudioObjectID], _ d: String) { objects = o; device = d }; func stop() { stopped = true } }
  private(set) var started: [Tap] = []
  private var change: (() -> Void)?
  func processes() -> [MixProc] { procs }
  func outputDevices() -> [MixDevice] { devices }
  func defaultOutput() -> MixDevice? { devices.first { $0.uid == defaultUID } }
  func app(of pid: pid_t) -> MixApp? { apps[pid] }
  func instanceTag(_ pid: pid_t) -> String? { tags[pid] }
  func icon(_ pid: pid_t) -> String? { nil }
  func master() -> (volume: Float, muted: Bool)? { (masterVol, masterMuted) }
  func setMaster(volume: Float?, muted: Bool?) { if let v = volume { masterVol = v }; if let m = muted { masterMuted = m } }
  func permission() -> String { perm }
  func requestPermission(_ done: @escaping (Bool) -> Void) { perm = grant ? "ok" : "denied"; done(grant) }
  func startTap(_ objects: [AudioObjectID], deviceUID: String, voice: MixVoice) -> MixTap? {
    let t = Tap(objects, deviceUID); started.append(t)
    // The fake audio thread: a quiet sine through the voice, or silence for protected audio.
    let sil = objects.contains { silent.contains($0) }
    DispatchQueue.global().asyncAfter(deadline: .now() + 0.05) { FakeMix.feed(voice, silent: sil, times: 4) }
    return t
  }
  /// Runs a voice on a fake interleaved stereo sine (0.5 peak), like the IO thread would.
  static func feed(_ v: MixVoice, silent: Bool, times: Int, out: UnsafeMutablePointer<Float>? = nil) {
    let frames = 512
    let inp = UnsafeMutablePointer<Float>.allocate(capacity: frames * 2), o = out ?? UnsafeMutablePointer<Float>.allocate(capacity: frames * 2)
    defer { inp.deallocate(); if out == nil { o.deallocate() } }
    for f in 0..<frames { let s: Float = silent ? 0 : 0.5 * sinf(Float(f) * 2 * .pi * 440 / 48000); inp[f * 2] = s; inp[f * 2 + 1] = s }
    var il = AudioBufferList(mNumberBuffers: 1, mBuffers: AudioBuffer(mNumberChannels: 2, mDataByteSize: UInt32(frames * 8), mData: inp))
    var ol = AudioBufferList(mNumberBuffers: 1, mBuffers: AudioBuffer(mNumberChannels: 2, mDataByteSize: UInt32(frames * 8), mData: o))
    for _ in 0..<times { v.render(&il, &ol) }
  }
  private(set) var watched: Set<AudioObjectID> = []
  func watchPlaying(_ objects: [AudioObjectID]) { watched.formUnion(objects) }
  func onChange(_ f: @escaping () -> Void) { change = f }
  func changed() { change?() }
  func runningBundles() -> Set<String> { running }
  var rates: [String: Double] = [:]
  func sampleRate(_ uid: String) -> Double { rates[uid] ?? 48000 }
}
