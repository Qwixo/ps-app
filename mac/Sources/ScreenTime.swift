// Screen time, kept by PS instead of macOS (PS > Settings > Screen time). Never chosen: on for everyone
// else (public PS, 7 Nov 2026: a friend's screen time stayed empty because nobody ever turned it on),
// off for the developer (Owner.red), who turns it on himself. The pop-up in the Tab list says when it is off and
// has a Turn on button (web TaskMap.tsx ScreenTimePop).
// Counts how long each app is in front, per local day. Not counted: 5 minutes or more with no
// mouse or keyboard input, a locked screen, a sleeping Mac or display.
// Only app names and bundle ids are recorded: never window titles, URLs, screenshots or keys.
// The totals live in memory plus ~/Library/Application Support/PS/screentime.json (this Mac only,
// so a restart loses nothing). Every few minutes they go to the main window, which saves them
// end-to-end encrypted in the vault (one owner-private record per day).
// Meetings (V1.40): during a calendar meeting (Sources/MeetingTime.swift, the AFK timer's "Stay off during
// meetings") sitting still is not away. Time with no input in a meeting counts as "Meetings" (a row of its own,
// id ps.meetings) instead of being dropped, and no away stretch on the timeline covers a meeting.
import Cocoa

final class ScreenTime {
  static let shared = ScreenTime()
  static let idleLimit = 300.0          // seconds with no input before the developer counts as away
  static let keepDays = 14
  static let ignored: Set<String> = ["com.apple.loginwindow", "com.apple.ScreenSaver.Engine"]
  /// Idle time inside a calendar meeting, as its own row (not an app; it has no icon, so the page shows an M).
  static let meeting = (id: "ps.meetings", name: "Meetings")

  var onSend: ((String) -> Void)?
  /// A test copy (PS_SELFTEST) keeps its own throwaway settings and files: it never reads or writes the developer's
  /// real screen time, his choice, or his last time on.
  static let testDir = ProcessInfo.processInfo.environment["PS_SELFTEST"]
  static let store: UserDefaults = {
    guard testDir != nil, let t = UserDefaults(suiteName: "com.cincee.ps.st-selftest") else { return .standard }
    t.removePersistentDomain(forName: "com.cincee.ps.st-selftest")
    return t
  }()
  private static let folder: URL = {
    let dir = testDir.map { URL(fileURLWithPath: $0, isDirectory: true).appendingPathComponent("screentime", isDirectory: true) }
      ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("PS", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }()
  /// The choice made with the switch (Settings or the pop-up's Turn on), nil while never chosen.
  var choice: Bool? { ScreenTime.store.object(forKey: "screenTime.enabled") as? Bool }
  /// Never chosen: on for everyone else, off for the developer (his own Macs already hold his choice, so nothing changes there).
  static func enabledDefault(red: Bool) -> Bool { !red }
  var enabled: Bool {
    get { choice ?? ScreenTime.enabledDefault(red: Owner.red) }
    set { choose(newValue) }
  }
  /// From the switch (clicks only). nil forgets the choice (self test only).
  func choose(_ on: Bool?) {
    account()
    if let on { ScreenTime.store.set(on, forKey: "screenTime.enabled") } else { ScreenTime.store.removeObject(forKey: "screenTime.enabled") }
    last = Date()
    psLog("PS screentime: \(on.map { $0 ? "on" : "off" } ?? "not chosen, \(enabled ? "on" : "off")")")
    if enabled { send() }
  }

  // day -> bundle id -> (name, seconds)
  private var days: [String: [String: (name: String, secs: Double)]] = [:]
  private var current: (id: String, name: String)?
  private var last = Date()
  private var locked = false, asleep = false, displayOff = false
  private var dirty = false
  private let file = ScreenTime.folder.appendingPathComponent("screentime.json")

  func start() {
    load()
    loadTimeline()
    // PS (or the Mac) was off: the developer was away from the last moment it saw him.
    if let s = lastSeen, Date().timeIntervalSince(s) >= 60 { awaySince = s }
    setCurrent(NSWorkspace.shared.frontmostApplication)
    let ws = NSWorkspace.shared.notificationCenter
    ws.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] n in
      self?.account()
      self?.setCurrent(n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)
    }
    let pause: (Notification.Name, ReferenceWritableKeyPath<ScreenTime, Bool>, Bool) -> Void = { [weak self] name, key, value in
      ws.addObserver(forName: name, object: nil, queue: .main) { _ in
        guard let self else { return }
        self.account()
        self[keyPath: key] = value
        self.last = Date()
      }
    }
    pause(NSWorkspace.willSleepNotification, \.asleep, true)
    pause(NSWorkspace.didWakeNotification, \.asleep, false)
    pause(NSWorkspace.screensDidSleepNotification, \.displayOff, true)
    pause(NSWorkspace.screensDidWakeNotification, \.displayOff, false)
    let dnc = DistributedNotificationCenter.default()
    for (name, value) in [("com.apple.screenIsLocked", true), ("com.apple.screenIsUnlocked", false)] {
      dnc.addObserver(forName: .init(name), object: nil, queue: .main) { [weak self] _ in
        guard let self else { return }
        self.account()
        self.locked = value
        self.last = Date()
      }
    }
    Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in self?.account() }
    Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in self?.save() }
    Timer.scheduledTimer(withTimeInterval: 3 * 60, repeats: true) { [weak self] _ in self?.send() }
  }

  private func setCurrent(_ app: NSRunningApplication?) {
    setCurrent(id: app?.bundleIdentifier, name: app?.localizedName)
  }
  private func setCurrent(id: String?, name: String?) {
    // Golden rule: 1Password and Signal are never counted or named.
    guard let id, !ScreenTime.ignored.contains(id), !Protected.matches(id) else { current = nil; return }
    current = (id, name ?? id)
  }

  /// Self test only (a test copy): `secs` seconds of `id` in front, as if someone were at the Mac, through the
  /// same golden rule and counting as a real app. Puts the real front app back after.
  func selfTestCount(id: String, name: String, secs: Double) {
    guard ScreenTime.testDir != nil else { return }
    let was = (locked, asleep, displayOff)
    account()
    locked = false; asleep = false; displayOff = false
    setCurrent(id: id, name: name)
    last = Date().addingTimeInterval(-secs)
    testIdle = 0
    account()
    testIdle = nil
    (locked, asleep, displayOff) = was
    setCurrent(NSWorkspace.shared.frontmostApplication)
  }
  /// What the self test sends to the page: each day's message, as send() would.
  func selfTestSent() -> [String] {
    guard ScreenTime.testDir != nil else { return [] }
    var out: [String] = []
    let keep = onSend
    onSend = { out.append($0) }
    send()
    onSend = keep
    return out
  }
  private var testIdle: Double?

  static func dayKey(_ d: Date) -> String {
    let c = Calendar.current.dateComponents([.year, .month, .day], from: d)
    return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
  }

  // MARK: last time on (eg after a nap): when the developer last left the Mac and when he came back

  private var lastSeen: Date? = ScreenTime.store.object(forKey: "screenTime.lastSeen") as? Date
  private var awaySince: Date?
  /// The most recent time away of a minute or more: (left, came back).
  private(set) var lastAway: (from: Date, to: Date)? = {
    let d = ScreenTime.store
    guard let f = d.object(forKey: "screenTime.awayFrom") as? Date, let t = d.object(forKey: "screenTime.awayTo") as? Date else { return nil }
    return (f, t)
  }()

  private func presence(_ now: Date, idle: Double) {
    // In a calendar meeting the developer is never away, whatever the mouse and keyboard do (MeetingTime.swift).
    let here = MeetingTime.shared.window(at: now) != nil || (!locked && !asleep && !displayOff && idle < ScreenTime.idleLimit)
    if here {
      if let since = awaySince {
        // Only the parts outside meetings (a sleep across a call), each a minute or more.
        let parts = MeetingTime.shared.outside(since, now).filter { $0.1.timeIntervalSince($0.0) >= 60 }
        if let last = parts.last {
          lastAway = last
          ScreenTime.store.set(last.0, forKey: "screenTime.awayFrom")
          ScreenTime.store.set(last.1, forKey: "screenTime.awayTo")
          for p in parts { aways.append(Span(id: "", name: "", start: p.0, end: p.1)) }
          timelineDirty = true
        }
      }
      awaySince = nil
      lastSeen = now
    } else if awaySince == nil {
      // Left at the last input (idle) or the last moment PS saw the developer here (lock, sleep, display off),
      // or at the end of a meeting that ended since: sitting still through it was not away.
      let left = idle >= ScreenTime.idleLimit ? now.addingTimeInterval(-idle) : (lastSeen ?? now)
      awaySince = MeetingTime.shared.after(left, now: now)
      // The app stretch ends when the developer left, not 5 idle minutes later.
      if let since = awaySince, var lastSeg = segs.last, lastSeg.end > since {
        lastSeg.end = max(lastSeg.start, since); segs[segs.count - 1] = lastSeg; timelineDirty = true
      }
    }
  }

  // MARK: the timeline (the screen time pop-up): which app was in front, start to end, and when the developer
  // was away. This Mac only (timeline.json, 48 hours); sent to the Tab list when the pop-up opens.

  struct Span { let id: String; let name: String; let start: Date; var end: Date }
  private var segs: [Span] = []
  private var aways: [Span] = []
  private var timelineDirty = false
  private let timelineFile = ScreenTime.folder.appendingPathComponent("timeline.json")

  private func addTime(_ cur: (id: String, name: String), from: Date, to: Date) {
    if var lastSeg = segs.last, lastSeg.id == cur.id, from.timeIntervalSince(lastSeg.end) < 30 {
      lastSeg.end = to; segs[segs.count - 1] = lastSeg
    } else {
      segs.append(Span(id: cur.id, name: cur.name, start: from, end: to))
    }
    timelineDirty = true
  }

  /// An AFK break (Sources/Afk.swift, from 2 minutes) on the timeline, so it shows as a named break
  /// even when it was shorter than the 5 minutes screen time itself counts as away. Main thread.
  func addAway(_ start: Date, _ end: Date) {
    guard enabled, end > start else { return }
    if aways.contains(where: { abs($0.start.timeIntervalSince(start)) < 90 }) { return }   // already there (5 minutes or more)
    // The app stretches give way to the break.
    segs = segs.flatMap { g -> [Span] in
      guard g.start < end && g.end > start else { return [g] }
      var out: [Span] = []
      if g.start < start { out.append(Span(id: g.id, name: g.name, start: g.start, end: start)) }
      if g.end > end { out.append(Span(id: g.id, name: g.name, start: end, end: g.end)) }
      return out
    }
    aways.append(Span(id: "", name: "", start: start, end: end))
    aways.sort { $0.start < $1.start }
    timelineDirty = true
    saveTimeline()
  }

  private func loadTimeline() {
    guard let data = try? Data(contentsOf: timelineFile),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
    let read: (Any?) -> [Span] = { list in
      (list as? [[String: Any]] ?? []).compactMap { o in
        guard let s = o["s"] as? Double, let e = o["e"] as? Double else { return nil }
        let id = o["i"] as? String ?? ""
        if Protected.matches(id) { return nil }
        return Span(id: id, name: o["n"] as? String ?? id, start: Date(timeIntervalSince1970: s), end: Date(timeIntervalSince1970: e))
      }
    }
    segs = read(obj["segs"]); aways = read(obj["away"])
  }

  private func saveTimeline() {
    guard timelineDirty else { return }
    let cut = Date().addingTimeInterval(-48 * 3600)
    segs = segs.filter { $0.end > cut && !Protected.matches($0.id) }
    aways = aways.filter { $0.end > cut }
    let enc: (Span) -> [String: Any] = { ["i": $0.id, "n": $0.name, "s": $0.start.timeIntervalSince1970.rounded(), "e": $0.end.timeIntervalSince1970.rounded()] }
    guard let data = try? JSONSerialization.data(withJSONObject: ["segs": segs.map(enc), "away": aways.map(enc)]) else { return }
    if (try? data.write(to: timelineFile, options: .atomic)) != nil {
      try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: timelineFile.path)
      timelineDirty = false
    }
  }

  /// {"type":"timeline","now":ms,"apps":[{"id","name"}],"segs":[[app index, start ms, end ms]],"away":[[start ms, end ms]]}
  func timelineJSON(hours: Double) -> String? {
    guard enabled else { return nil }
    account()
    let now = Date(), from = now.addingTimeInterval(-max(1, min(48, hours)) * 3600)
    var ids: [String] = [], names: [String: String] = [:]
    var out: [[Double]] = []
    for s in segs where s.end > from && !Protected.matches(s.id) {
      if names[s.id] == nil { ids.append(s.id); names[s.id] = s.name }
      out.append([Double(ids.firstIndex(of: s.id)!), (max(s.start, from).timeIntervalSince1970 * 1000).rounded(), (s.end.timeIntervalSince1970 * 1000).rounded()])
    }
    var away = aways.filter { $0.end > from }.map { [($0.start.timeIntervalSince1970 * 1000).rounded(), ($0.end.timeIntervalSince1970 * 1000).rounded()] }
    if let since = awaySince { away.append([(since.timeIntervalSince1970 * 1000).rounded(), (now.timeIntervalSince1970 * 1000).rounded()]) }
    let obj: [String: Any] = ["type": "timeline", "now": (now.timeIntervalSince1970 * 1000).rounded(), "from": (from.timeIntervalSince1970 * 1000).rounded(),
                              "apps": ids.map { ["id": $0, "name": names[$0]!] }, "segs": out, "away": away]
    guard let d = try? JSONSerialization.data(withJSONObject: obj) else { return nil }
    return String(data: d, encoding: .utf8)
  }

  /// {"type":"presence","lastOn":"<iso>","back":"<iso>"}: when the developer last left and when he came back.
  func presenceJSON() -> String? {
    guard enabled else { return nil }
    let f = ISO8601DateFormatter()
    var o: [String: Any] = ["type": "presence"]
    if let a = lastAway { o["lastOn"] = f.string(from: a.from); o["back"] = f.string(from: a.to) }
    guard let d = try? JSONSerialization.data(withJSONObject: o) else { return nil }
    return String(data: d, encoding: .utf8)
  }

  /// Adds the time since the last call to the app in front, if the developer was really there.
  func account() {
    let now = Date()
    var delta = now.timeIntervalSince(last)
    last = now
    // Any keyboard, mouse or trackpad input (kCGAnyInputEventType). No permission needed.
    let idle = testIdle ?? CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: CGEventType(rawValue: ~0)!)
    if enabled { presence(now, idle: idle) }
    guard enabled, !locked, !asleep, !displayOff, let cur = current, delta > 0 else { return }
    delta = min(delta, 60)   // the 10 second timer never misses more than this unless the Mac was stopped
    // The last part with no input (past the 5 minutes) is not the app's. In a meeting it is meeting time.
    let still = idle > ScreenTime.idleLimit ? min(delta, idle - ScreenTime.idleLimit) : 0
    if delta - still > 0 { credit(cur, delta - still, from: now.addingTimeInterval(-delta), to: now.addingTimeInterval(-still)) }
    if still > 0, MeetingTime.shared.window(at: now) != nil { credit(ScreenTime.meeting, still, from: now.addingTimeInterval(-still), to: now) }
  }
  private func credit(_ app: (id: String, name: String), _ secs: Double, from: Date, to: Date) {
    addTime(app, from: from, to: to)
    let day = ScreenTime.dayKey(to)
    var apps = days[day] ?? [:]
    let prev = apps[app.id]?.secs ?? 0
    apps[app.id] = (app.name, prev + secs)
    days[day] = apps
    dirty = true
  }

  // MARK: file (this Mac only)

  private func load() {
    guard let data = try? Data(contentsOf: file),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: [String: [String: Any]]] else { return }
    for (day, apps) in obj {
      var m: [String: (name: String, secs: Double)] = [:]
      for (id, v) in apps where !Protected.matches(id) { if let n = v["name"] as? String, let s = v["secs"] as? Double { m[id] = (n, s) } }
      days[day] = m
    }
  }

  func save() {
    account()
    saveTimeline()
    if let s = lastSeen { ScreenTime.store.set(s, forKey: "screenTime.lastSeen") }
    guard dirty else { return }
    let keep = Set((0..<ScreenTime.keepDays).map { ScreenTime.dayKey(Date().addingTimeInterval(Double(-$0) * 86400)) })
    days = days.filter { keep.contains($0.key) }
    let obj = days.mapValues { $0.mapValues { ["name": $0.name, "secs": ($0.secs * 10).rounded() / 10] } }
    guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
    do {
      try data.write(to: file, options: .atomic)
      try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
      dirty = false
    } catch { psLog("PS screentime: could not save the local file") }
  }

  // MARK: app icons for the pop-up (never stored; never for 1Password or Signal)

  private var iconCache: [String: String] = [:]
  /// {"type":"appIcons","icons":{"<bundle id>":"data:image/png;base64,..."}} for the ids asked for.
  func iconsJSON(_ ids: [String]) -> String? {
    var out: [String: String] = [:]
    for id in ids.prefix(30) where !Protected.matches(id) {
      if let hit = iconCache[id] { out[id] = hit; continue }
      guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: id) else { continue }
      let icon = NSWorkspace.shared.icon(forFile: url.path)
      let size = NSSize(width: 64, height: 64)
      guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 64, pixelsHigh: 64, bitsPerSample: 8, samplesPerPixel: 4,
                                       hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { continue }
      NSGraphicsContext.saveGraphicsState()
      NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
      icon.draw(in: NSRect(origin: .zero, size: size))
      NSGraphicsContext.restoreGraphicsState()
      guard let png = rep.representation(using: .png, properties: [:]) else { continue }
      let data = "data:image/png;base64," + png.base64EncodedString()
      iconCache[id] = data
      out[id] = data
    }
    guard !out.isEmpty, let d = try? JSONSerialization.data(withJSONObject: ["type": "appIcons", "icons": out]) else { return nil }
    return String(data: d, encoding: .utf8)
  }

  // MARK: to the vault

  /// One message per stored day; the page merges (keeps the larger count per app) and only
  /// writes when something changed, so resending is harmless.
  func send() {
    guard enabled, let onSend else { return }
    account()
    for day in days.keys.sorted() {
      let apps = days[day]!.filter { $0.value.secs >= 1 && !Protected.matches($0.key) }
        .map { ["id": $0.key, "name": $0.value.name, "secs": Int($0.value.secs)] as [String: Any] }
      guard !apps.isEmpty,
            let data = try? JSONSerialization.data(withJSONObject: ["type": "screentime", "day": day, "apps": apps]),
            let json = String(data: data, encoding: .utf8) else { continue }
      onSend(json)
    }
  }
}
