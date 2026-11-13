// Alarm playlists on a Mac (V1.47; web src/core/alarmlist.ts has the rules, src/sleepmode/list.ts the page).
// The developer, 10 Nov 2026: "add a bunch of audio files so it goes through all these audio files one after another, randomly
// or in order, so every day there is a different audio file, so we can wake up to a motivational speaker".
//  - The page keeps the list (names, lengths, order, today's pick) in the vault settings, synced. The FILES stay on
//    the Mac they were added on: copied as they are (never converted, so a long talk costs its own size and no more)
//    into Application Support/PS/alarm-list/<id>.<ext>, the id being the start of the file's SHA-256 (the phone works
//    it out the same way, so one talk added on both is one entry). Never uploaded, never in the vault.
//  - Added with PS's own Open panel (several at once) or by dropping files on the playlist in Settings (the Tab list
//    web view takes the drop natively, SecondDrop.swift, kind "alarm"); the page never holds the bytes.
//  - The plan says which file each day plays (SleepPlanN.list); SleepScreen.swift plays it at the alarm loudness, with
//    the style's rise and the fade in, looping or once ("Play the whole file": the ring lasts until it ends, 10 min to
//    3 h). Stop, Wake up, Esc and closing stop it. A day whose file is not on this Mac rings the usual sound.
// Page -> Mac: sleep:list:get, sleep:list:pick, sleep:list:remove {id}, sleep:list:keep {ids}, sleep:list:put {id, ext,
// i, n, b64} (a file the page holds: the Soundboard, a starter pack, the squad), sleep:list:read {id, off, len} (to share
// it). Mac -> page: window.__psAlarmList({have, added?, saved?, failed?, chunk?, error?, busy?}). File work is never on
// the main thread.
import AVFoundation
import AppKit
import CryptoKit
import UniformTypeIdentifiers

/// The pure rules (the same numbers as core/alarmlist.ts). tests/sleepscreen-test.swift checks them.
enum ListMath {
  static let exts = ["mp3", "m4a", "wav", "aac", "aiff", "aif", "flac", "ogg", "oga", "opus", "caf"]
  static let piece = 512 * 1024
  static let maxBytes = 100 * 1024 * 1024
  static let maxTracks = 40
  static let ringMs = 10 * 60_000.0, wholeMaxMs = 3 * 3600_000.0
  static let keepYoung: TimeInterval = 10 * 60   // a file this new is never tidied away (it may be on its way into the list)

  /// The day at `ms` on this Mac's clock, YYYY-MM-DD (the page keys each day's file the same way).
  static func day(_ ms: Double, tz: TimeZone = .current) -> String {
    var c = Calendar(identifier: .gregorian); c.timeZone = tz
    let d = c.dateComponents([.year, .month, .day], from: Date(timeIntervalSince1970: ms / 1000))
    return String(format: "%04d-%02d-%02d", d.year ?? 1970, d.month ?? 1, d.day ?? 1)
  }
  /// How long the alarm rings with this file: the whole file (10 min to 3 h) or the usual 10 min while it loops.
  static func ringFor(end: String, secs: Double) -> Double {
    guard end == "whole", secs > 0 else { return ringMs }
    return min(wholeMaxMs, max(ringMs, (secs * 1000).rounded() + 3000))
  }
  /// The fade in: 0.05 rising to 1 over `fade` seconds (0: none).
  static func fadeAt(_ ms: Double, fade: Int) -> Double {
    guard fade > 0 else { return 1 }
    return min(1, 0.05 + 0.95 * max(0, ms) / (Double(fade) * 1000))
  }
  static func okId(_ s: String) -> Bool { s.count == 16 && s.allSatisfy { "0123456789abcdef".contains($0) } }
  /// Nil when the file can go on the list, else a plain sentence (the page's words).
  static func check(name: String, size: Int, head: [UInt8]) -> String? {
    let ext = (name as NSString).pathExtension.lowercased(), shown = AlarmMath.ownName(name)
    if !exts.contains(ext) { return "\(shown): pick an mp3, m4a, wav, aac, flac or ogg file." }
    if size <= 0 { return "\(shown) is empty." }
    if size > maxBytes { return "\(shown) is over 100 MB." }
    if !sniff(head) { return "\(shown) does not look like a sound file PS app can play." }
    return nil
  }
  /// What the first bytes say (the page's rules): the own sound's kinds, plus flac, ogg and opus, caf.
  static func sniff(_ h: [UInt8]) -> Bool {
    if AlarmMath.sniff(h) != nil { return true }
    guard h.count >= 4, let s = String(bytes: h[0..<4], encoding: .isoLatin1) else { return false }
    return ["fLaC", "OggS", "caff"].contains(s)
  }
  /// A piece the page hands over: in order, at most `piece`, the whole file under `maxBytes`.
  static func pieceOk(id: String, ext: String, i: Int, n: Int, expect: Int, size: Int, got: Int) -> Bool {
    okId(id) && exts.contains(ext) && (1...(maxBytes / piece + 1)).contains(n) && i >= 0 && i < n && i == expect && (1...piece).contains(got) && size + got <= maxBytes
  }
  static func name(_ file: String) -> String {
    let base = (file as NSString).deletingPathExtension.replacingOccurrences(of: "_", with: " ")
      .components(separatedBy: .controlCharacters).joined().split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    return String((base.isEmpty ? "Audio file" : base).prefix(60))
  }
  /// The first 16 hex characters of the SHA-256 of the file, read 1 MB at a time.
  static func id(of url: URL) -> String? {
    guard let h = try? FileHandle(forReadingFrom: url) else { return nil }
    defer { try? h.close() }
    var sha = SHA256()
    while true {
      let d = h.readData(ofLength: 1 << 20)
      if d.isEmpty { break }
      sha.update(data: d)
    }
    return sha.finalize().prefix(8).map { String(format: "%02x", $0) }.joined()
  }
}

/// One day's file from the plan (core/alarmlist.ts PlanList).
struct PlanListN {
  struct Entry: Equatable { let id: String; let name: String; let secs: Double; let n: Int; let of: Int }
  var end = "loop"
  var fade = 0
  var days: [String: Entry] = [:]
  /// V1.47 (Sleep settings): true when every alarm with no sound of its own plays the playlist; false when only the
  /// alarms set to it ("list") do. An older page sends none: on.
  var on = true
  static func parse(_ any: Any?) -> PlanListN? {
    guard let d = any as? [String: Any], let days = d["days"] as? [String: Any] else { return nil }
    var p = PlanListN()
    p.end = d["end"] as? String == "whole" ? "whole" : "loop"
    p.on = d["on"] as? Bool ?? true
    let f = (d["fade"] as? NSNumber)?.intValue ?? 0
    p.fade = [0, 10, 30, 60].contains(f) ? f : 0
    for (k, v) in days.prefix(14) {
      guard k.count == 10, let e = v as? [String: Any], let id = e["id"] as? String, ListMath.okId(id) else { continue }
      p.days[k] = Entry(id: id, name: String((e["name"] as? String ?? "").prefix(60)), secs: max(0, (e["secs"] as? NSNumber)?.doubleValue ?? 0),
                        n: (e["n"] as? NSNumber)?.intValue ?? 0, of: (e["of"] as? NSNumber)?.intValue ?? 0)
    }
    return p
  }
  func entry(_ ms: Double) -> Entry? { days[ListMath.day(ms)] }
}

/// The playlist's files on this Mac.
final class AlarmListStore {
  static let shared = AlarmListStore()
  private let q = DispatchQueue(label: "ps.alarm.list", qos: .utility)
  private let test = UpdatePaths.test
  private var adding = false

  var dir: URL {
    test ? FileManager.default.temporaryDirectory.appendingPathComponent("ps-test-alarm-list", isDirectory: true)
      : FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("PS/alarm-list", isDirectory: true)
  }
  /// The file kept for `id`, if this Mac has it.
  func listFile(_ id: String) -> URL? {
    guard ListMath.okId(id), let names = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else { return nil }
    return names.first { $0.hasPrefix(id + ".") && !$0.hasSuffix(".part") }.map { dir.appendingPathComponent($0) }
  }
  /// The ids of every file on this Mac.
  func have() -> [String] {
    let names = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
    return names.filter { !$0.hasSuffix(".part") }.map { String($0.prefix(16)) }.filter(ListMath.okId).sorted()
  }

  // MARK: the bridge

  @discardableResult func handle(_ type: String, _ msg: [String: Any]) -> Bool {
    switch type {
    case "sleep:list:get": q.async { self.send() }
    case "sleep:list:pick": pick()
    case "sleep:list:remove":
      if let id = msg["id"] as? String, ListMath.okId(id) {
        q.async { [self] in if let f = listFile(id) { try? FileManager.default.removeItem(at: f); psLog("PS alarm list: a file removed") }; send() }
      }
    case "sleep:list:put":   // a file the page holds (the Soundboard, a starter pack, the squad), in pieces
      let id = msg["id"] as? String ?? "", ext = (msg["ext"] as? String ?? "").lowercased()
      let i = (msg["i"] as? NSNumber)?.intValue ?? -1, n = (msg["n"] as? NSNumber)?.intValue ?? 0, b = msg["b64"] as? String ?? ""
      q.async { [self] in put(id: id, ext: ext, i: i, n: n, b64: b) }
    case "sleep:list:read":  // a file read back to share it (1 MB at a time)
      let id = msg["id"] as? String ?? "", off = max(0, (msg["off"] as? NSNumber)?.intValue ?? 0), len = min(1 << 20, max(1, (msg["len"] as? NSNumber)?.intValue ?? 0))
      q.async { [self] in read(id: id, off: off, len: len) }
    case "sleep:list:keep":
      let keep = Set(((msg["ids"] as? [Any]) ?? []).compactMap { $0 as? String }.filter(ListMath.okId))
      q.async { [self] in tidy(keep: keep); send() }
    default: return false
    }
    return true
  }
  /// Called on `q`.
  private func send(added: [[String: Any]] = [], error: String? = nil, busy: String? = nil, extra: [String: Any] = [:]) {
    var d: [String: Any] = ["have": have(), "busy": busy.map { $0 as Any } ?? NSNull()]
    d.merge(extra) { a, _ in a }
    if !added.isEmpty { d["added"] = added }
    if let error { d["error"] = error }
    let data = (try? JSONSerialization.data(withJSONObject: d, options: [.sortedKeys])) ?? Data("{}".utf8)
    let js = "window.__psAlarmList && window.__psAlarmList(\(String(data: data, encoding: .utf8) ?? "{}"))"
    DispatchQueue.main.async { SleepSound.shared.deliver?(js) }
  }
  // MARK: pieces from the page, and reading back (on `q`)

  private var cur = "", expect = 0, got = 0, dead = ""
  /// One piece of a file the page hands over. The last one: the bytes must hash to the id, then the file is kept.
  func put(id: String, ext: String, i: Int, n: Int, b64: String) {
    let key = "\(id).\(ext)"
    if i > 0 && key == dead { return }   // the rest of a file already refused: one answer is enough
    if i == 0 { cur = key; expect = 0; got = 0; dead = "" }
    let part = dir.appendingPathComponent("\(key).part")
    func fail(_ why: String) {
      try? FileManager.default.removeItem(at: part)
      cur = ""; expect = 0; got = 0; dead = key
      psLog("PS alarm list: a file refused")
      send(error: why, extra: ["failed": id])
    }
    guard let data = Data(base64Encoded: b64), key == cur, ListMath.pieceOk(id: id, ext: ext, i: i, n: n, expect: expect, size: got, got: data.count) else {
      fail("PS app could not keep that file on this Mac."); return
    }
    do {
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      if i == 0 { try data.write(to: part) } else {
        let h = try FileHandle(forWritingTo: part); try h.seekToEnd(); try h.write(contentsOf: data); try h.close()
      }
    } catch { fail("PS app could not keep that file on this Mac (is the disk full?)."); return }
    expect += 1; got += data.count
    if i < n - 1 { return }
    guard ListMath.id(of: part) == id else { fail("That file did not arrive whole. Try adding it again."); return }
    let dest = dir.appendingPathComponent(key)
    try? FileManager.default.removeItem(at: dest)
    guard (try? FileManager.default.moveItem(at: part, to: dest)) != nil else { fail("PS app could not keep that file on this Mac."); return }
    cur = ""
    psLog("PS alarm list: a file kept (\(got / 1024) KB)")
    send(extra: ["saved": id])
  }
  func read(id: String, off: Int, len: Int) {
    guard let f = listFile(id), let h = try? FileHandle(forReadingFrom: f) else { send(extra: ["chunk": ["id": id]]); return }
    defer { try? h.close() }
    let size = ((try? FileManager.default.attributesOfItem(atPath: f.path))?[.size] as? NSNumber)?.intValue ?? 0
    try? h.seek(toOffset: UInt64(min(off, size)))
    let d = h.readData(ofLength: len)
    send(extra: ["chunk": ["id": id, "off": off, "size": size, "b64": d.base64EncodedString()]])
  }

  private func tidy(keep: Set<String>) {
    let fm = FileManager.default
    for name in (try? fm.contentsOfDirectory(atPath: dir.path)) ?? [] {
      let id = String(name.prefix(16)), url = dir.appendingPathComponent(name)
      if keep.contains(id) && !name.hasSuffix(".part") { continue }
      let made = ((try? fm.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date) ?? Date()
      if Date().timeIntervalSince(made) > ListMath.keepYoung { try? fm.removeItem(at: url); psLog("PS alarm list: a file no longer on the list removed") }
    }
  }

  // MARK: adding

  /// PS's Open panel, several sound files at once. Main thread; the panel never blocks it.
  func pick() {
    guard !test else { q.async { self.send() }; return }
    SleepSound.shared.beforePanel()
    let p = NSOpenPanel()
    p.allowedContentTypes = [UTType.mp3, .mpeg4Audio, .wav, .aiff] + ["m4a", "aac", "aif", "flac", "ogg", "oga", "opus", "caf"].compactMap { UTType(filenameExtension: $0) }
    p.allowsMultipleSelection = true; p.canChooseDirectories = false
    p.prompt = "Add to the playlist"; p.message = "Pick the audio files to wake up to, one a day. They stay on this Mac."
    if #available(macOS 14.0, *) { NSApp.activate() } else { NSApp.activate(ignoringOtherApps: true) }
    p.begin { [weak self] r in
      if r == .OK { self?.add(p.urls) } else { self?.q.async { self?.send() } }
    }
  }
  /// Files picked or dropped: each checked and copied in as it is, one at a time on `q`. `done` (tests): the tracks
  /// added and the plain sentences for the ones that were not.
  func add(_ urls: [URL], done: (([[String: Any]], [String]) -> Void)? = nil) {
    let files = Array(urls.filter { $0.isFileURL }.prefix(ListMath.maxTracks))
    guard !files.isEmpty else { q.async { self.send(error: "Drop audio files from Finder (mp3, m4a, wav or aac)."); done?([], []) }; return }
    q.async { [self] in
      guard !adding else { send(error: "Still adding the last files. Try again in a moment."); done?([], []); return }
      adding = true
      var added: [[String: Any]] = [], bad: [String] = []
      for (i, u) in files.enumerated() {
        send(busy: "Adding \(ListMath.name(u.lastPathComponent))\(files.count > 1 ? " (\(i + 1) of \(files.count))" : "")...")
        switch importOne(u) {
        case .success(let t): added.append(t)
        case .failure(let e): bad.append(e.why)
        }
      }
      adding = false
      psLog("PS alarm list: \(added.count) added, \(bad.count) refused")
      send(added: added, error: bad.isEmpty ? nil : bad.prefix(4).joined(separator: " "))
      done?(added, bad)
    }
  }
  struct Refused: Error { let why: String }
  /// Checks one file and copies it in (a part file first, renamed when whole). On `q`.
  private func importOne(_ src: URL) -> Result<[String: Any], Refused> {
    let scoped = src.startAccessingSecurityScopedResource()
    defer { if scoped { src.stopAccessingSecurityScopedResource() } }
    let fm = FileManager.default, shown = ListMath.name(src.lastPathComponent)
    let size = ((try? fm.attributesOfItem(atPath: src.path))?[.size] as? NSNumber)?.intValue ?? 0
    var head = [UInt8]()
    if let h = try? FileHandle(forReadingFrom: src) { head = [UInt8](h.readData(ofLength: 16)); try? h.close() }
    if let why = ListMath.check(name: src.lastPathComponent, size: size, head: head) { return .failure(Refused(why: why)) }
    // The Mac's own player must open it (and says how long it is), so a file that would not ring is refused now.
    guard let player = try? AVAudioPlayer(contentsOf: src), player.duration > 0 else { return .failure(Refused(why: "\(shown): this Mac cannot play that file.")) }
    let secs = player.duration.rounded()
    guard let id = ListMath.id(of: src) else { return .failure(Refused(why: "\(shown): PS app could not read that file.")) }
    let ext = src.pathExtension.lowercased()
    if listFile(id) == nil {
      do {
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        let part = dir.appendingPathComponent("\(id).\(ext).part"), dest = dir.appendingPathComponent("\(id).\(ext)")
        try? fm.removeItem(at: part)
        try fm.copyItem(at: src, to: part)   // an APFS clone where it can be: instant, no extra space
        try fm.moveItem(at: part, to: dest)
      } catch { return .failure(Refused(why: "\(shown): PS app could not keep it on this Mac.")) }
    }
    return .success(["id": id, "name": shown, "secs": secs, "bytes": size, "ext": ext])
  }
}
