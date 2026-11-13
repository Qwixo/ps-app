// AI chat finished cards, PS's side (V1.53). The rules and the file work are in AiDoneCore.swift; this runs them:
// - Settings, Notifications, AI chat finished cards (web views/AiDone.tsx): one row per tool, its state in
//   psSettings.aiDone, a click comes in as {type:"aiDone:set", tool, on}.
// - Every tool starts Off (open source build): nothing is written into ~/.claude/settings.json or any other tool's
//   settings until the person clicks On for it in Settings. (Before, Claude Code was switched on once by itself at the
//   first launch.) A Mac that already has PS's hook keeps it and stays On; Off takes it out again (uninstall), and every
//   change keeps a backup of the file beside it (AiInstaller.write). A Mac with its own chat done hook (the developer's) is left alone.
// - The inbox (~/Library/PS/ai-done/inbox): watched while any tool is on. Each file the script leaves becomes a card
//   (or is dropped: held while a Claude Code chat still has work running, a sub chat, too old) and goes to the main
//   page as {type:"aiDone", items}. The page answers {type:"aiDone:taken", keys} once the card is in the vault, and
//   only then is the file deleted, so a locked PS keeps them until it is unlocked. Tried again every 30 seconds.
// One plain log line per file, never a chat's name. A self test copy never touches any of it.
import Foundation

final class AiDone {
  static let shared = AiDone()
  /// Hands items to the main page (main.swift sendToMain).
  var deliver: (([[String: Any]]) -> Void)?
  /// Settings changed (main.swift sendSettings).
  var onChange: (() -> Void)?

  private let q = DispatchQueue(label: "PS ai done", qos: .utility)
  private var test = false
  private let paths = AiPaths(home: FileManager.default.homeDirectoryForCurrentUser)
  private var installer: AiInstaller { AiInstaller(p: paths) }
  private var watcher: DispatchSourceFileSystemObject?
  private var timer: DispatchSourceTimer?
  /// Items the page has not taken yet, by file name (on q).
  private var pending: [String: [String: Any]] = [:]
  private var lastSent: [String: Date] = [:]
  // The rows for Settings, worked out on q and read on main.
  private let mu = NSLock()
  private var rows: [[String: Any]] = []
  private var busy: Set<AiTool> = []
  private var notes: [AiTool: String] = [:]

  static let defaultKey = "aiDone.defaultDone"

  func start(testDir: String?) {
    test = testDir != nil
    guard !test else { return }
    q.async { [self] in
      // No hook is written at launch: only a click on On (handle) installs one. The old first launch marker stays set so
      // an older build run again later does not switch Claude Code on by itself either.
      UserDefaults.standard.set(true, forKey: AiDone.defaultKey)
      if AiTool.allCases.contains(where: { installer.how($0) != nil }) { try? installer.ensureScript() }   // a newer script after an update
      refresh()
      watch()
      scan()
    }
  }

  // MARK: Settings

  func settingsJSON() -> [String: Any] { mu.lock(); defer { mu.unlock() }; return ["tools": rows] }

  /// Works out every row again (on q) and tells Settings.
  private func refresh() {
    let i = installer
    let own = i.ownClaudeHook()
    mu.lock(); let b = busy, n = notes; mu.unlock()
    let r: [[String: Any]] = AiTool.allCases.map { t in
      var row: [String: Any] = ["id": t.rawValue, "name": t.name, "found": i.found(t), "on": own && t == .claude ? true : i.how(t) != nil]
      if own && t == .claude { row["own"] = true }
      if b.contains(t) { row["busy"] = true }
      if let note = n[t] { row["note"] = note }
      else if t == .codex && i.how(.codex) == "hooks" { row["note"] = AiDoneCore.codexTrustNote }
      return row
    }
    mu.lock(); rows = r; mu.unlock()
    DispatchQueue.main.async { [weak self] in self?.onChange?() }
  }

  /// From the page: {type:"aiDone:set", tool, on}. Click only.
  func handle(_ msg: [String: Any]) {
    guard !test, let t = (msg["tool"] as? String).flatMap(AiTool.init(rawValue:)), let on = msg["on"] as? Bool else { return }
    mu.lock(); busy.insert(t); notes[t] = nil; mu.unlock()
    q.async { [self] in
      refresh()
      let r = on ? installer.install(t) : installer.uninstall(t)
      mu.lock()
      busy.remove(t)
      if case .refused(let why) = r { notes[t] = why } else if case .done(let note) = r, let note { notes[t] = note }
      mu.unlock()
      psLog("PS ai done: \(t.rawValue) switched \(on ? "on" : "off") (\(r == .done(nil) ? "done" : "with a note"))")
      refresh()
      watch()
      scan()
    }
  }

  // MARK: the inbox

  /// Watches the inbox folder while it is there (a tool is on), and checks it every 30 seconds for the page.
  private func watch() {
    if timer == nil {
      let t = DispatchSource.makeTimerSource(queue: q)
      t.schedule(deadline: .now() + 30, repeating: 30, leeway: .seconds(5))
      t.setEventHandler { [weak self] in self?.scan() }
      t.resume()
      timer = t
    }
    if watcher != nil { return }
    let fd = open(paths.inbox.path, O_EVTONLY)
    guard fd >= 0 else { return }
    let w = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: [.write, .delete, .rename], queue: q)
    w.setEventHandler { [weak self] in
      guard let self else { return }
      if w.data.contains(.delete) || w.data.contains(.rename) { w.cancel(); self.watcher = nil; return }   // the folder went (all off)
      self.scan()
    }
    w.setCancelHandler { close(fd) }
    w.resume()
    watcher = w
  }

  /// New files become items; items the page has not taken go again (at most every 20 seconds each).
  private func scan() {
    if watcher == nil && FileManager.default.fileExists(atPath: paths.inbox.path) { watch() }
    let names = ((try? FileManager.default.contentsOfDirectory(atPath: paths.inbox.path)) ?? []).filter { $0.hasSuffix(".drop") && !$0.hasPrefix(".") }
    let have = Set(names)
    pending = pending.filter { have.contains($0.key) }
    for name in names where pending[name] == nil {
      let url = paths.inbox.appendingPathComponent(name)
      guard let text = try? String(contentsOf: url, encoding: .utf8), let d = AiDoneCore.parseDrop(text) else { try? FileManager.default.removeItem(at: url); continue }
      let home = FileManager.default.homeDirectoryForCurrentUser
      let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first ?? home.appendingPathComponent("Library/Application Support")
      let v = AiDoneCore.verdict(d, lines: { path in Self.transcriptLines(path) }, named: { AiDoneCore.toolName($0, home: home, appSupport: support) })
      switch v {
      case .card(let tool, let id, let chat, let at, let turn):
        var item: [String: Any] = ["key": name, "tool": tool.rawValue, "id": id, "chat": chat, "at": ISO8601DateFormatter().string(from: at)]
        if !turn.isEmpty { item["turn"] = turn }   // V1.57: the same prompt again is the same card (core/chatdone.ts sameFinish)
        pending[name] = item
        psLog("PS ai done: a \(tool.rawValue) chat finished")
      case .held(let n):
        psLog("PS ai done: held, \(n) background job\(n == 1 ? "" : "s") still running")
        try? FileManager.default.removeItem(at: url)
      case .skipped(let why):
        psLog("PS ai done: skipped, \(why)")
        try? FileManager.default.removeItem(at: url)
      }
    }
    let now = Date()
    let due = pending.filter { now.timeIntervalSince(lastSent[$0.key] ?? .distantPast) > 20 }
    guard !due.isEmpty else { return }
    for k in due.keys { lastSent[k] = now }
    let items = Array(due.values)
    DispatchQueue.main.async { [weak self] in self?.deliver?(items) }
  }

  /// From the page: these cards are in the vault now, so their files go.
  func taken(_ keys: [String]) {
    q.async { [self] in
      for k in keys where pending[k] != nil && !k.contains("/") && k.hasSuffix(".drop") {
        try? FileManager.default.removeItem(at: paths.inbox.appendingPathComponent(k))
        pending[k] = nil; lastSent[k] = nil
      }
    }
  }

  /// A Claude Code transcript's lines: only a file under ~/.claude, at most 200 MB.
  static func transcriptLines(_ path: String) -> [Substring]? {
    let url = URL(fileURLWithPath: path).standardizedFileURL
    let claude = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude").standardizedFileURL.path + "/"
    guard url.path.hasPrefix(claude), url.pathExtension == "jsonl",
          let size = (try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? Int, size < 200_000_000,
          let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
    return text.split(separator: "\n", omittingEmptySubsequences: true)
  }
}
