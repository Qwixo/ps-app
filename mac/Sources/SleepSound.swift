// The alarm's sound on a Mac (V1.44; web src/core/alarmsound.ts has the same rules and numbers).
// A G Squad friend via the developer, 9 Nov 2026: "upload custom audio file to the alarm so that I can have for example YOU ARE
// BROKE as an alarm" and "being able to set and test the audio, how loud it will actually be. i want it to be loud.
// right now there is a couple options and only one of them is loud".
//  - The built in sounds (soft chime, alarm) are made here and brought to ONE level (AlarmMath.targetDb, the loudest
//    400 ms), so every wake style is as loud as Loud. V1.43 had the chime at -18.7 dB and the alarm at -19.6 dB.
//  - Your own sound: PS's own Open panel, one mp3, m4a, wav or aiff file up to 20 MB. It is read here (AVAudioFile),
//    the first 60 seconds, one channel, silence trimmed, brought to the same level, and kept as a WAV in PS's own
//    Application Support folder. It stays on this Mac: never in the vault, never uploaded, never synced.
//  - Alarm loudness: while an alarm rings (SleepScreen.swift) and while Test plays, this Mac's output volume is set
//    to the loudness the page sends (Loud: 100%) and unmuted, and put back the moment it stops.
//  - Test plays exactly the sound an alarm plays, at that level, for 10 seconds at most; the page's Stop and Esc
//    stop it at once ("sleep:testStop"), and so does Sleep mode starting or an alarm ringing.
// Never on the main thread: reading the file and every volume change are on `q`. A test copy (UpdatePaths.test)
// never plays a sound and never touches the volume.
import AVFoundation
import AppKit
import UniformTypeIdentifiers

/// The pure maths (no sound is played): the same as core/alarmsound.ts. tests/sleepscreen-test.swift checks it.
enum AlarmMath {
  static let targetDb = -12.0, maxGainDb = 30.0, knee = 0.8
  static let ownMaxSecs = 60.0, ownMaxBytes = 20 * 1024 * 1024
  static let ownExt = ["mp3", "m4a", "wav", "aiff", "aif"]
  static let levelMin = 0.1, levelDef = 0.8
  static let testMaxMs = 15_000.0
  static let previewMaxMs = 31_000.0   // V1.47: one playlist file's Preview
  static let rate = 44100.0

  static func toDb(_ a: Double) -> Double { a > 0 ? 20 * log10(a) : -.infinity }
  static func fromDb(_ d: Double) -> Double { pow(10, d / 20) }
  static func peak(_ x: [Float]) -> Double { Double(x.reduce(0) { max($0, abs($1)) }) }
  /// How loud a sound gets: the loudest `win` seconds (RMS every `hop` seconds). A short sound is measured whole.
  static func loudest(_ x: [Float], rate: Double, win: Double = 0.4, hop: Double = 0.1) -> Double {
    let n = x.count
    guard n > 0 else { return 0 }
    let w = max(1, min(n, Int((win * rate).rounded()))), h = max(1, Int((hop * rate).rounded()))
    var sq = [Double](repeating: 0, count: n + 1)
    for i in 0..<n { sq[i + 1] = sq[i] + Double(x[i]) * Double(x[i]) }
    var best = 0.0, s = 0
    while s + w <= n { best = max(best, (sq[s + w] - sq[s]) / Double(w)); s += h }
    best = max(best, (sq[n] - sq[n - w]) / Double(w))
    return best.squareRoot()
  }
  /// Unchanged up to the knee, then gently towards (never past) 1.
  static func soften(_ v: Double) -> Double {
    let a = abs(v)
    if a <= knee { return v }
    return (v < 0 ? -1 : 1) * (knee + (1 - knee) * tanh((a - knee) / (1 - knee)))
  }
  static func gain(for loud: Double) -> Double { loud > 1e-6 ? min(fromDb(maxGainDb), fromDb(targetDb) / loud) : 1 }
  /// The sound at the one level: gain, then the limiter, and up to two more passes for what the limiter took.
  static func normalise(_ x: [Float], rate: Double) -> [Float] {
    let loud = loudest(x, rate: rate), cap = fromDb(maxGainDb), want = fromDb(targetDb)
    var g = gain(for: loud)
    var out = [Float](repeating: 0, count: x.count)
    for _ in 0..<3 {
      for i in 0..<x.count { out[i] = Float(soften(Double(x[i]) * g)) }
      guard loud > 1e-6 else { break }
      let got = loudest(out, rate: rate)
      if got >= want * fromDb(-0.25) || g >= cap { break }
      g = min(cap, g * want / got)
    }
    return out
  }
  /// Silence off both ends (a file starting with 3 seconds of nothing would wake you 3 seconds late).
  static func trim(_ x: [Float], floor: Float = Float(pow(10, -50.0 / 20))) -> [Float] {
    var a = 0, b = x.count
    while a < b && abs(x[a]) < floor { a += 1 }
    while b > a && abs(x[b - 1]) < floor { b -= 1 }
    return Array(x[a..<b])
  }

  // The built in sounds: one loop each, the same tones as V1.43 (and as the page), then brought to the one level.
  struct Tone { let f: Double; let dur: Double; let peak: Double; let wave: Int; let at: Double }   // wave: 0 sine, 1 triangle, 2 square
  static let soft: (tones: [Tone], loop: Double) = ([Tone(f: 660, dur: 0.9, peak: 0.3, wave: 0, at: 0), Tone(f: 880, dur: 0.9, peak: 0.28, wave: 0, at: 0.22),
                                                    Tone(f: 990, dur: 1.2, peak: 0.26, wave: 0, at: 0.44)], 2.6)
  static let alarm: (tones: [Tone], loop: Double) = ((0..<4).flatMap { i in [Tone(f: 1046, dur: 0.12, peak: 0.3, wave: 2, at: Double(i) * 0.16),
                                                                          Tone(f: 784, dur: 0.12, peak: 0.34, wave: 0, at: Double(i) * 0.16)] }, 1.3)
  static func render(_ tones: [Tone], loop: Double, rate: Double = rate) -> [Float] {
    let n = Int((loop * rate).rounded())
    var buf = [Double](repeating: 0, count: n)
    for t in tones {
      let start = Int((t.at * rate).rounded()), len = Int((t.dur * rate).rounded())
      var phase = 0.0
      var i = 0
      while i < len && start + i < n {
        let x = Double(i) / rate
        phase += t.f / rate
        let p = phase - floor(phase)
        let w = t.wave == 0 ? sin(2 * .pi * p) : t.wave == 1 ? 4 * abs(p - 0.5) - 1 : (p < 0.5 ? 1.0 : -1.0)
        let env = x < 0.004 ? x / 0.004 : exp(-6.9 * (x - 0.004) / max(0.001, t.dur - 0.004))
        buf[start + i] += w * env * t.peak
        i += 1
      }
    }
    return buf.map { Float($0) }
  }
  /// "soft" or "alarm", one loop at the one level.
  static func builtIn(_ kind: String) -> [Float] {
    let s = kind == "alarm" ? alarm : soft
    return normalise(render(s.tones, loop: s.loop), rate: rate)
  }
  /// 16 bit mono WAV.
  static func wav(_ x: [Float], rate: Int) -> Data {
    var d = Data()
    func u32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) } }
    func u16(_ v: UInt16) { withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) } }
    d.append(contentsOf: Array("RIFF".utf8)); u32(UInt32(36 + x.count * 2)); d.append(contentsOf: Array("WAVE".utf8))
    d.append(contentsOf: Array("fmt ".utf8)); u32(16); u16(1); u16(1); u32(UInt32(rate)); u32(UInt32(rate * 2)); u16(2); u16(16)
    d.append(contentsOf: Array("data".utf8)); u32(UInt32(x.count * 2))
    for v in x { u16(UInt16(bitPattern: Int16((max(-1, min(1, v)) * 32767).rounded()))) }
    return d
  }

  // Your own sound's checks: the ending, the size, and what the first bytes say (never the name alone).
  static func sniff(_ h: [UInt8]) -> String? {
    guard h.count >= 12 else { return nil }
    func s(_ a: Int, _ n: Int) -> String { String(bytes: h[a..<a + n], encoding: .isoLatin1) ?? "" }
    if s(0, 4) == "RIFF" && s(8, 4) == "WAVE" { return "wav" }
    if s(0, 4) == "FORM" && (s(8, 4) == "AIFF" || s(8, 4) == "AIFC") { return "aiff" }
    if s(4, 4) == "ftyp" { return "m4a" }
    if s(0, 3) == "ID3" || (h[0] == 0xff && h[1] & 0xe0 == 0xe0) { return "mp3" }
    return nil
  }
  /// Nil when the file can be your own sound, else a plain sentence.
  static func check(name: String, size: Int, head: [UInt8]) -> String? {
    if !ownExt.contains((name as NSString).pathExtension.lowercased()) { return "Pick an mp3, m4a, wav or aiff file." }
    if size <= 0 { return "That file is empty." }
    if size > ownMaxBytes { return "That file is over 20 MB. A shorter clip works." }
    if sniff(head) == nil { return "That file does not look like a sound file PS app can play." }
    return nil
  }
  static func ownName(_ file: String) -> String {
    let base = file.replacingOccurrences(of: "\\.[^.]+$", with: "", options: .regularExpression).replacingOccurrences(of: "_", with: " ")
      .components(separatedBy: .controlCharacters).joined().split(whereSeparator: { $0 == " " }).joined(separator: " ")
    return String((base.isEmpty ? "Your sound" : base).prefix(40))
  }
  /// The alarm loudness from the page: 0.1 to 1 in steps of 0.05 (anything else: the default).
  static func okLevel(_ v: Double?) -> Double {
    guard let v, v.isFinite else { return levelDef }
    return (max(levelMin, min(1, v)) * 20).rounded() / 20
  }
  static func ringLevel(loud: Bool, level: Double) -> Double { loud ? 1 : okLevel(level) }
}

/// Your own sound on this Mac, the sound an alarm plays, and Test.
final class SleepSound: NSObject {
  static let shared = SleepSound()
  /// Set by main.swift: hands a JS line to both pages. Main thread.
  var deliver: ((String) -> Void)?
  /// Set by main.swift: the Tab list steps aside for the Open panel.
  var beforePanel: () -> Void = {}
  var volumeGet: () -> (volume: Float, muted: Bool)? = { SleepHW.volume() }
  var volumeSet: (Float, Bool) -> Void = { SleepHW.setVolume($0, muted: $1) }
  private let q = DispatchQueue(label: "ps.sleep.sound", qos: .utility)
  private let test = UpdatePaths.test
  private var player: AVAudioPlayer?
  private var saved: (volume: Float, muted: Bool)?
  private var testEnd: DispatchWorkItem?
  private var testGen = 0
  private var builtIns: [String: Data] = [:]
  private(set) var testing = false

  /// PS's own folder (a test copy: a folder of its own under the temporary folder, never the real one).
  var dir: URL {
    test ? FileManager.default.temporaryDirectory.appendingPathComponent("ps-test-sleep-sound", isDirectory: true)
      : FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("PS", isDirectory: true)
  }
  var ownFile: URL { dir.appendingPathComponent("sleep-sound.wav") }
  var metaFile: URL { dir.appendingPathComponent("sleep-sound.json") }
  /// Your own sound's name and length, when this Mac has one.
  func own() -> (name: String, secs: Double)? {
    guard FileManager.default.fileExists(atPath: ownFile.path), let d = try? Data(contentsOf: metaFile),
          let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any], let n = o["name"] as? String, !n.isEmpty else { return nil }
    return (String(n.prefix(40)), (o["secs"] as? NSNumber)?.doubleValue ?? 0)
  }
  /// The sound an alarm plays: your own if this Mac has one (and `own`), else the built in `kind` ("soft" or "alarm").
  /// The Annoying 15 min reminders ask with own false: their own sounds are their own (Reminders.swift).
  func ringData(_ kind: String, own useOwn: Bool = true) -> Data {
    if useOwn, own() != nil, let d = try? Data(contentsOf: ownFile), d.count > 44 { return d }
    if let d = builtIns[kind] { return d }
    let d = AlarmMath.wav(AlarmMath.builtIn(kind), rate: Int(AlarmMath.rate))
    builtIns[kind] = d
    return d
  }

  // MARK: the bridge

  /// From main.swift's message switch. True when the message was this one's.
  @discardableResult func handle(_ type: String, _ msg: [String: Any]) -> Bool {
    switch type {
    case "sleep:sound:get": send()
    case "sleep:sound:pick": pick()
    case "sleep:sound:remove":
      stopTest()
      try? FileManager.default.removeItem(at: ownFile); try? FileManager.default.removeItem(at: metaFile)
      psLog("PS sleep: own sound removed")
      send()
    case "sleep:test":
      let style = WakeRules.styles.contains(msg["style"] as? String ?? "") ? msg["style"] as! String : "chime"
      // V1.47: `track` plays that playlist file (Test with the playlist on, or one file's Preview, up to 30 s).
      let track = (msg["track"] as? String).flatMap { ListMath.okId($0) ? $0 : nil }
      let ms = min(track == nil ? AlarmMath.testMaxMs : AlarmMath.previewMaxMs, max(1000, (msg["ms"] as? NSNumber)?.doubleValue ?? 10_000))
      startTest(style: style, level: AlarmMath.okLevel((msg["level"] as? NSNumber)?.doubleValue), ms: ms, track: track)
    case "sleep:testStop": stopTest()
    default: return false
    }
    return true
  }
  private func send(error: String? = nil) {
    var d: [String: Any] = ["testing": testing]
    if let o = own() { d["own"] = ["name": o.name, "secs": (o.secs * 10).rounded() / 10] } else { d["own"] = NSNull() }
    if let error { d["error"] = error }
    let data = (try? JSONSerialization.data(withJSONObject: d, options: [.sortedKeys])) ?? Data("{}".utf8)
    deliver?("window.__psAlarm && window.__psAlarm(\(String(data: data, encoding: .utf8) ?? "{}"))")
  }

  // MARK: your own sound

  /// PS's Open panel, one sound file. Main thread; the panel never blocks it.
  func pick() {
    guard !test else { send(); return }
    beforePanel()
    let p = NSOpenPanel()
    p.allowedContentTypes = [UTType.mp3, .mpeg4Audio, .wav, .aiff] + [UTType(filenameExtension: "m4a"), UTType(filenameExtension: "aif")].compactMap { $0 }
    p.allowsMultipleSelection = false; p.canChooseDirectories = false
    p.prompt = "Use this sound"; p.message = "Pick a sound for your alarms. It stays on this Mac."
    if #available(macOS 14.0, *) { NSApp.activate() } else { NSApp.activate(ignoringOtherApps: true) }
    p.begin { [weak self] r in
      if r == .OK, let url = p.url { self?.importFile(url) } else { self?.send() }
    }
  }
  /// Reads the picked file on `q` (never the main thread) and keeps it ready to ring. `done`: the plain sentence when
  /// it could not, nil when it worked (the unit test calls it with a file it made itself).
  func importFile(_ src: URL, done: ((String?) -> Void)? = nil) {
    q.async { [self] in
      let why = make(from: src)
      if let why { psLog("PS sleep: own sound not taken (\(why))") } else { psLog("PS sleep: own sound kept") }
      DispatchQueue.main.async { self.send(error: why); done?(why) }
    }
  }
  private func make(from src: URL) -> String? { SleepSound.makeSound(from: src, dir: dir, wav: ownFile, meta: metaFile) }
  /// Reads `src` and keeps it as a WAV at the one level, with its name and length (also the Annoying 15 min
  /// reminders' own sounds, Reminders.swift). Nil when it worked, else a plain sentence. Never on the main thread.
  static func makeSound(from src: URL, dir: URL, wav ownFile: URL, meta metaFile: URL) -> String? {
    let scoped = src.startAccessingSecurityScopedResource()
    defer { if scoped { src.stopAccessingSecurityScopedResource() } }
    let size = ((try? FileManager.default.attributesOfItem(atPath: src.path))?[.size] as? NSNumber)?.intValue ?? 0
    var head = [UInt8]()
    if let h = try? FileHandle(forReadingFrom: src) { head = [UInt8](h.readData(ofLength: 16)); try? h.close() }
    if let why = AlarmMath.check(name: src.lastPathComponent, size: size, head: head) { return why }
    guard let f = try? AVAudioFile(forReading: src) else { return "PS app could not read that file. Try an mp3, m4a or wav." }
    let rate = f.processingFormat.sampleRate
    let frames = AVAudioFrameCount(min(Double(f.length), AlarmMath.ownMaxSecs * rate))
    guard rate > 0, frames > 0, let buf = AVAudioPCMBuffer(pcmFormat: f.processingFormat, frameCapacity: frames),
          (try? f.read(into: buf, frameCount: frames)) != nil, let ch = buf.floatChannelData else { return "PS app could not read that file. Try an mp3, m4a or wav." }
    let n = Int(buf.frameLength), chans = Int(buf.format.channelCount)
    var mono = [Float](repeating: 0, count: n)
    for c in 0..<chans { let p = ch[c]; for i in 0..<n { mono[i] += p[i] / Float(chans) } }
    let x = AlarmMath.trim(mono)
    if Double(x.count) < rate * 0.1 { return "That file has no sound in it PS app can hear." }
    let out = AlarmMath.normalise(x, rate: rate)
    do {
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      try AlarmMath.wav(out, rate: Int(rate.rounded())).write(to: ownFile, options: .atomic)
      let meta: [String: Any] = ["name": AlarmMath.ownName(src.lastPathComponent), "secs": (Double(x.count) / rate * 10).rounded() / 10]
      try JSONSerialization.data(withJSONObject: meta).write(to: metaFile, options: .atomic)
    } catch { return "PS app could not keep that sound on this Mac." }
    return nil
  }

  // MARK: Test

  /// Plays exactly what an alarm in `style` plays, at the level it rings: the Mac's volume set to it first (and kept
  /// to put back), then the sound, looping, for `ms` at most.
  func startTest(style: String, level: Double, ms: Double, track: String? = nil) {
    stopTest(silent: true)
    let spec = WakeRules.spec(style)
    guard spec.sound != "none" else { send(); return }
    testing = true; testGen += 1
    let gen = testGen, to = Float(AlarmMath.ringLevel(loud: spec.loud, level: level))
    psLog("PS sleep: test \(style) at \(Int(to * 100))%")
    let end = DispatchWorkItem { [weak self] in self?.stopTest() }
    testEnd = end
    DispatchQueue.main.asyncAfter(deadline: .now() + ms / 1000, execute: end)
    send()
    if test { return }   // a test copy: no sound, no volume
    q.async { [self] in
      let old = volumeGet()
      volumeSet(to, false)
      DispatchQueue.main.async { [self] in
        guard testing, gen == testGen else { if let old { q.async { self.volumeSet(old.volume, old.muted) } }; return }
        if saved == nil { saved = old }
        if let track, let f = AlarmListStore.shared.listFile(track), let p = try? AVAudioPlayer(contentsOf: f) {
          player = p; p.numberOfLoops = 0   // a playlist file plays from its start (Test, Preview)
        } else {
          player = try? AVAudioPlayer(data: ringData(spec.sound))
          player?.numberOfLoops = -1
        }
        player?.volume = 1
        player?.play()
      }
    }
  }
  /// Stop (the page's Stop or Esc), the time up, Sleep mode opening or an alarm ringing: quiet, and the volume back.
  func stopTest(silent: Bool = false) {
    testEnd?.cancel(); testEnd = nil
    player?.stop(); player = nil
    if let v = saved { saved = nil; q.async { [self] in volumeSet(v.volume, v.muted) } }
    let was = testing
    testing = false; testGen += 1
    if was && !silent { send() }
  }
}
