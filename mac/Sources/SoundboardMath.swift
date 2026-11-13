// The Soundboard's pure rules on a Mac (V1.47, Soundboard.swift does the disk, the serving and the timed plays).
// The same rules as the page's web src/core/soundboard.ts and the contract (v147-soundboard-contract.md).
// Nothing here reads or writes a file, plays a sound or looks at the clock by itself: tests/soundboard-test.swift
// checks every function with made up names, sizes and dates.
import Foundation

enum SbMath {
  // ---------- kinds ----------
  static let audio: Set<String> = ["mp3", "m4a", "aac", "wav", "aif", "aiff", "flac", "ogg", "oga", "opus", "caf"]
  static let video: Set<String> = ["mp4", "m4v", "mov", "webm", "mkv", "3gp"]
  static let types: [String: String] = [
    "mp3": "audio/mpeg", "m4a": "audio/mp4", "aac": "audio/aac", "wav": "audio/wav", "aif": "audio/aiff", "aiff": "audio/aiff",
    "flac": "audio/flac", "ogg": "audio/ogg", "oga": "audio/ogg", "opus": "audio/opus", "caf": "audio/x-caf",
    "mp4": "video/mp4", "m4v": "video/mp4", "mov": "video/quicktime", "webm": "video/webm", "mkv": "video/x-matroska", "3gp": "video/3gpp",
  ]
  /// "audio", "video" or nil (skipped) for a file name or an extension.
  static func kind(_ nameOrExt: String) -> String? {
    let e = ext(nameOrExt)
    return audio.contains(e) ? "audio" : video.contains(e) ? "video" : nil
  }
  static func ext(_ nameOrExt: String) -> String {
    let s = nameOrExt.contains(".") ? (nameOrExt as NSString).pathExtension : nameOrExt
    return s.lowercased()
  }
  static func contentType(_ ext: String) -> String { types[ext.lowercased()] ?? "application/octet-stream" }

  // ---------- limits ----------
  static let maxFile: Int64 = 4 * 1024 * 1024 * 1024      // a single import over 4 GB is refused
  static let maxShare: Int64 = 10 * 1024 * 1024           // sb:read and sb:put: audio of 10 MB or less
  static let maxPiece = 1_048_576                          // sb:read len and one sb:put piece
  static let maxDepth = 4                                  // folders below the storage folder
  static let maxName = 120
  static let loopMax: Double = 600                         // a looping timed play rings 10 minutes at most
  static let lateGrace: Double = 120                       // a time missed by up to 2 minutes (a wake, a busy Mac) still rings
  static let squadFolder = "From your squad"

  // ---------- ids ----------
  static func isId(_ s: String) -> Bool { s.count == 16 && s.allSatisfy { $0.isHexDigit && !$0.isUppercase } }
  static func newId() -> String {
    var g = SystemRandomNumberGenerator()
    return (0..<16).map { _ in String(UInt8.random(in: 0..<16, using: &g), radix: 16) }.joined()
  }

  // ---------- names and paths ----------
  /// The display name of a file: its name without the extension.
  static func displayName(_ file: String) -> String {
    let base = (file as NSString).deletingPathExtension
    return String((base.isEmpty ? file : base).prefix(maxName))
  }
  /// A rename from the page: 1 to 120 characters once trimmed, no control characters. Nil: refused.
  static func cleanName(_ s: String?) -> String? {
    guard let s else { return nil }
    let t = s.components(separatedBy: .controlCharacters).joined().trimmingCharacters(in: .whitespacesAndNewlines)
    guard !t.isEmpty, t.count <= maxName else { return nil }
    return t
  }
  /// A file or folder name safe on disk: no slash, colon or control characters, no leading dot, at most 100 characters.
  static func safeFileName(_ s: String, fallback: String) -> String {
    var t = s.components(separatedBy: .controlCharacters).joined()
      .replacingOccurrences(of: "/", with: " ").replacingOccurrences(of: ":", with: " ")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    while t.hasPrefix(".") { t.removeFirst() }
    t = String(t.trimmingCharacters(in: .whitespaces).prefix(100))
    return t.isEmpty ? fallback : t
  }
  /// A path the index may hold: relative, no "..", no empty or hidden part, at most maxDepth folders, a known kind.
  static func pathOk(_ p: String) -> Bool {
    guard !p.isEmpty, !p.hasPrefix("/"), p.count <= 1024 else { return false }
    let parts = p.split(separator: "/", omittingEmptySubsequences: false)
    guard parts.count <= maxDepth + 1 else { return false }
    for c in parts where c.isEmpty || c == "." || c == ".." || c.hasPrefix(".") { return false }
    return kind(String(parts.last!)) != nil
  }
  /// The folder part of a relative path ("" for a file at the top).
  static func folder(_ p: String) -> String {
    let d = (p as NSString).deletingLastPathComponent
    return d == "." ? "" : d
  }
  /// A free name in a folder: "Song.mp3", then "Song 2.mp3", "Song 3.mp3" (taken: the names already there, any case).
  static func uniqueName(_ want: String, taken: Set<String>) -> String {
    let lower = Set(taken.map { $0.lowercased() })
    if !lower.contains(want.lowercased()) { return want }
    let ns = want as NSString, base = ns.deletingPathExtension, e = ns.pathExtension
    var n = 2
    while true {
      let c = e.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(e)"
      if !lower.contains(c.lowercased()) { return c }
      n += 1
    }
  }

  // ---------- the index ----------
  // Safety rule (V1.47): PS only ever deletes files PS itself put there. `own` is true for a file PS wrote (an import,
  // a drop, a squad sound, a copy made while moving the storage); a file found in the folder that the index did not
  // know is adopted (`own` false) and is never deleted: removing it only hides it (`ignored`, so the next look does not
  // add it back) and moving the storage copies it but leaves the original where it was. Someone may pick their own
  // Music folder as the storage folder.
  struct Item: Equatable { var id: String; var path: String; var name: String; var added: Double; var own: Bool }
  /// The index file. `inDefault`: it lives in the default folder (an old entry without `own` counts as PS's there, as
  /// only PS ever wrote into that folder; anywhere else it counts as adopted).
  static func items(_ json: Any?, inDefault: Bool) -> [Item] {
    guard let o = json as? [String: Any], let a = o["items"] as? [Any] else { return [] }
    var seenId = Set<String>(), seenPath = Set<String>(), out: [Item] = []
    for v in a {
      guard let d = v as? [String: Any], let id = d["id"] as? String, isId(id), let p = d["path"] as? String, pathOk(p),
            !seenId.contains(id), !seenPath.contains(p.lowercased()) else { continue }
      let name = cleanName(d["name"] as? String) ?? displayName((p as NSString).lastPathComponent)
      let added = (d["added"] as? NSNumber)?.doubleValue ?? 0
      let own = (d["own"] as? Bool) ?? inDefault
      seenId.insert(id); seenPath.insert(p.lowercased())
      out.append(Item(id: id, path: p, name: name, added: added.isFinite ? added : 0, own: own))
    }
    return out
  }
  /// The paths removed from the list that stay on disk (adopted files): never added back by a look at the folder.
  static func ignored(_ json: Any?) -> [String] {
    guard let o = json as? [String: Any], let a = o["ignored"] as? [Any] else { return [] }
    var seen = Set<String>(), out: [String] = []
    for v in a { if let p = v as? String, pathOk(p), !seen.contains(p) { seen.insert(p); out.append(p) } }
    return out
  }
  static func indexJSON(_ items: [Item], ignored: [String] = []) -> [String: Any] {
    ["v": 1, "items": items.map { ["id": $0.id, "path": $0.path, "name": $0.name, "added": $0.added, "own": $0.own] as [String: Any] }, "ignored": ignored]
  }
  /// The index against what is on disk: entries whose file is gone are dropped, files it does not know are added with
  /// a fresh id (in the order found) as adopted, except ignored ones. An ignored path whose file is gone is forgotten.
  /// `files`: relative paths found on disk.
  static func merge(_ index: [Item], files: [String], ignored: [String] = [], now: Double, newId: () -> String = newId)
    -> (items: [Item], ignored: [String], changed: Bool) {
    let onDisk = Set(files)
    var out = index.filter { onDisk.contains($0.path) }
    let ign = ignored.filter { onDisk.contains($0) }
    var changed = out.count != index.count || ign.count != ignored.count
    var known = Set(out.map(\.path)).union(ign), ids = Set(out.map(\.id))
    for f in files where !known.contains(f) && pathOk(f) {
      var id = newId()
      while ids.contains(id) { id = newId() }
      out.append(Item(id: id, path: f, name: displayName((f as NSString).lastPathComponent), added: now, own: false))
      known.insert(f); ids.insert(id); changed = true
    }
    return (out, ign, changed)
  }
  /// What removing one entry does: delete the file (PS's own) or only hide it (adopted: the path joins `ignored`).
  static func removal(_ i: Item) -> (deleteFile: Bool, ignore: String?) { i.own ? (true, nil) : (false, i.path) }
  /// Two indexes into one (moving onto a folder that has its own): `theirs` stay as they are, `ours` keep their ids
  /// (a fresh one on the rare clash) at the paths the move gave them, and are PS's own there (PS made those copies).
  static func mergeIndexes(theirs: [Item], ours: [Item], newId: () -> String = newId) -> [Item] {
    var out = theirs, ids = Set(theirs.map(\.id)), paths = Set(theirs.map { $0.path.lowercased() })
    for var i in ours where !paths.contains(i.path.lowercased()) {
      while ids.contains(i.id) { i.id = newId() }
      i.own = true
      out.append(i); ids.insert(i.id); paths.insert(i.path.lowercased())
    }
    return out
  }
  /// After a move, the old copies that may go: only PS's own. Adopted files stay where they were.
  static func oldToDelete(_ items: [Item], copied: Set<String>) -> [String] {
    items.filter { $0.own && copied.contains($0.path) }.map(\.path)
  }

  // ---------- moving the storage ----------
  /// Where each of our files goes in the new folder: the same relative path, or " 2" before the extension when the
  /// new folder already has that name (`existing`: relative paths there, any case).
  static func movePlan(_ paths: [String], existing: Set<String>) -> [(from: String, to: String)] {
    var byDir: [String: Set<String>] = [:], out: [(String, String)] = []
    for e in existing { byDir[folder(e).lowercased(), default: []].insert((e as NSString).lastPathComponent.lowercased()) }
    for p in paths {
      let dir = folder(p), name = (p as NSString).lastPathComponent
      let n = uniqueName(name, taken: byDir[dir.lowercased()] ?? [])
      byDir[dir.lowercased(), default: []].insert(n.lowercased())
      out.append((p, dir.isEmpty ? n : dir + "/" + n))
    }
    return out
  }
  /// Whether the storage may move from `from` to `to` (standardised paths): never into itself or below itself.
  static func moveOk(from: String, to: String) -> Bool {
    let a = from.hasSuffix("/") ? from : from + "/", b = to.hasSuffix("/") ? to : to + "/"
    return a != b && !b.hasPrefix(a)
  }

  /// A short readable place for the folder, never a full path with the user's name in it.
  static func label(_ path: String, home: String) -> String {
    var parts: [String]
    let h = home.hasSuffix("/") ? String(home.dropLast()) : home
    if path == h { return "Home" }
    if path.hasPrefix(h + "/") { parts = String(path.dropFirst(h.count + 1)).split(separator: "/").map(String.init) }
    else if path.hasPrefix("/Volumes/") { parts = String(path.dropFirst("/Volumes/".count)).split(separator: "/").map(String.init) }
    else if path.hasPrefix("/Users/") {   // another user's folder: their name stays out
      parts = Array(path.split(separator: "/").map(String.init).dropFirst(2))
      if parts.isEmpty { return "Another account" }
    } else { parts = path.split(separator: "/").map(String.init) }
    if parts.isEmpty { return "This Mac" }
    if parts.count > 3 { parts = Array(parts.suffix(3)) }
    return parts.joined(separator: " > ")
  }

  // ---------- byte ranges ----------
  /// A Range header against a file of `size` bytes: (start, end) inclusive and whether it was partial, or nil when it
  /// cannot be met (416). No header or one PS cannot read: the whole file. `cap`: at most this many bytes at once.
  static func range(_ header: String?, size: Int64, cap: Int64) -> (start: Int64, end: Int64, partial: Bool)? {
    guard size > 0 else { return nil }
    var start: Int64 = 0, end: Int64 = size - 1, partial = false
    if let h = header?.trimmingCharacters(in: .whitespaces).lowercased(), h.hasPrefix("bytes=") {
      let spec = h.dropFirst(6).split(separator: ",").first.map(String.init) ?? ""
      let ab = spec.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
      if ab.count == 2 {
        if let a = Int64(ab[0]), a >= 0 {
          start = a; partial = true
          if !ab[1].isEmpty { guard let b = Int64(ab[1]), b >= a else { return nil }; end = min(b, size - 1) }
        } else if ab[0].isEmpty, let n = Int64(ab[1]), n > 0 {
          start = max(0, size - n); partial = true
        }
      }
    }
    if start >= size { return nil }
    end = min(end, start + cap - 1)
    return (start, end, partial || end < size - 1)
  }

  // ---------- timed plays ----------
  struct Plan: Equatable {
    var id: String; var media: String; var name: String
    var hour: Int; var minute: Int; var days: [Int]; var vol: Double; var loop: Bool
    var json: [String: Any] {
      ["id": id, "media": media, "name": name, "at": String(format: "%02d:%02d", hour, minute), "days": days, "vol": vol, "loop": loop]
    }
  }
  static func hm(_ s: String?) -> (Int, Int)? {
    guard let s, s.count == 5, s.range(of: #"^\d\d:\d\d$"#, options: .regularExpression) != nil,
          let h = Int(s.prefix(2)), let m = Int(s.suffix(2)), (0...23).contains(h), (0...59).contains(m) else { return nil }
    return (h, m)
  }
  /// The page's plan, checked: bad items are left out, an id only once, at most 200.
  static func plan(_ v: Any?) -> [Plan] {
    guard let a = v as? [Any] else { return [] }
    var out: [Plan] = [], seen = Set<String>()
    for x in a.prefix(200) {
      guard let d = x as? [String: Any], let id = d["id"] as? String, id.range(of: #"^[A-Za-z0-9_-]{1,64}$"#, options: .regularExpression) != nil,
            !seen.contains(id), let media = d["media"] as? String, isId(media), let (h, m) = hm(d["at"] as? String) else { continue }
      let days = Array(Set(((d["days"] as? [Any]) ?? []).compactMap { ($0 as? NSNumber)?.intValue }.filter { (0...6).contains($0) })).sorted()
      let vol = level((d["vol"] as? NSNumber)?.doubleValue)
      let name = cleanName(d["name"] as? String) ?? "Sound"
      seen.insert(id)
      out.append(Plan(id: id, media: media, name: name, hour: h, minute: m, days: days, vol: vol, loop: (d["loop"] as? Bool) == true))
    }
    return out
  }
  /// The alarm level, 0.1 to 1 (anything else: 0.8, the alarms' default).
  static func level(_ v: Double?) -> Double {
    guard let v, v.isFinite else { return 0.8 }
    return max(0.1, min(1, v))
  }
  /// The first time strictly after `after` that this plan rings, in `cal`'s time zone (local time). Nil: no days.
  /// A time that does not exist on a day (the clocks go forward) rings at the next valid moment.
  static func nextDue(_ p: Plan, after: Date, cal: Calendar) -> Date? {
    guard !p.days.isEmpty else { return nil }
    let day0 = cal.startOfDay(for: after)
    for off in 0...8 {
      guard let day = cal.date(byAdding: .day, value: off, to: day0) else { continue }
      let wd = cal.component(.weekday, from: day) - 1   // 0 Sunday
      guard p.days.contains(wd), let t = cal.date(bySettingHour: p.hour, minute: p.minute, second: 0, of: day) else { continue }
      if t > after { return t }
    }
    return nil
  }
  /// The plan item due in (since, now], the latest one when several are, if it is no more than `grace` late.
  static func due(_ plan: [Plan], since: Date, now: Date, cal: Calendar, grace: Double = lateGrace) -> (Plan, Date)? {
    var best: (Plan, Date)?
    let lo = max(since, now.addingTimeInterval(-grace))   // a plan rings once a day at most: one time fits in here
    for p in plan {
      guard let t = nextDue(p, after: lo, cal: cal), t <= now else { continue }
      if best == nil || t > best!.1 { best = (p, t) }
    }
    return best
  }
  /// When the one timer should fire next: the earliest due time after `now`.
  static func nextWake(_ plan: [Plan], after now: Date, cal: Calendar) -> Date? {
    plan.compactMap { nextDue($0, after: now, cal: cal) }.min()
  }
}
