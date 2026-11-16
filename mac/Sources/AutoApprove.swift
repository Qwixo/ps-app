// Auto approve, PS's side. The rules, the hook script and the file work are in AutoApproveCore.swift; this runs them:
// - Settings, Sentry mode, Auto approve (web views/AutoApprove.tsx): three switches kept on this Mac (UserDefaults), shown
//   in psSettings.autoApprove; a click comes in as {type:"autoApprove:set", key: "ai"|"sleep"|"always", on, quiet?}. The log
//   clears with {type:"autoApprove:clearLog"}. PS 1.65 (feature "auto-approve-defaults"): "In AI mode" and "In Sleep mode" are
//   on until the person chooses, "Always" is off; but only once the 1.65 notice was shown on this Mac ({type:
//   "autoApprove:noticed"}), until then an unset switch is off. A saved On or Off is never changed by a default.
// - Every second (main thread) it looks at what the Mac is doing: AI mode is Sentry mode engaged (Sentry.shared),
//   Sleep mode is the sleep screen up for a real Sleep mode (not an alarm alone). When Auto approve turns on or off it says so in the log
//   file and moves the lease; while it is on the lease is moved on every 30 seconds.
// - Route 1, the hook: PS's line sits in Claude Code's (and Codex's) settings from launch while a switch is SAVED On; a switch
//   that is only on by its default puts the line in when Auto approve turns on and takes it out when it turns off
//   (ApproveCore.hookWanted). Only PS's own entry changes, every other byte of the file stays (JSONEdit). The script it
//   runs leaves a small drop per approval in ~/Library/PS/auto-approve/inbox; PS turns each into a log line (the
//   command shortened, secrets out, the folder's name only) and deletes it.
// - Route 2, keys, for prompts the hook cannot reach. Every 2.5 seconds while on:
//   * Terminal and iTerm2: their text through AppleScript (every window and tab, on any desktop, minimised too).
//     Needs the Mac's Automation permission for that app, asked when a switch is turned on in Settings, never during a
//     mode and never from the notice or a synced answer (quiet).
//   * Warp, VS Code, Cursor: their Accessibility text, on the current desktop only. Usually none for a terminal
//     drawn on the GPU (Warp, VS Code's terminal): then PS sees no prompt and does nothing. It never guesses.
//   A window counts only when ApproveCore.classify says it is a yes or no permission prompt with Yes chosen, the same
//   prompt is still there on the next look, and it is not one PS already pressed (at most 3 tries, 8 s apart).
//   Pressing: iTerm2 gets Return written straight into that session (no window moves, works under Sentry and Sleep
//   mode's cover). Every other app needs its window in front: PS only does that with "Always" on, the Mac unlocked,
//   no Sentry or Sleep screen up, 1Password or Signal not in front, and nobody typing or moving the mouse for 3
//   seconds; it brings that exact window forward, checks it is in front, presses Return, and puts the app you were
//   in back in front. Otherwise the log says it is waiting.
// - Golden rule: 1Password and Signal are never read or touched (only Terminal, iTerm2, Warp, VS Code and Cursor
//   are ever looked at, and Protected.matches is checked again on each).
// A self test copy never touches any of it.
import Cocoa
import ApplicationServices
import Carbon

final class AutoApprove {
  static let shared = AutoApprove()
  /// Settings changed (main.swift sendSettings).
  var onChange: (() -> Void)?

  private var test = false
  private let paths = ApprovePaths(home: FileManager.default.homeDirectoryForCurrentUser)
  private var installer: ApproveInstaller { ApproveInstaller(p: paths) }
  private let q = DispatchQueue(label: "PS auto approve", qos: .utility)

  // Main thread.
  private var sw = ApproveCore.Switches()
  private var why: String?
  /// PS's line is in the tools' settings (or on its way in), as far as the main thread asked.
  private var hookIn = false
  private var watchingFeatures = false
  private var tick: Timer?
  private var lastLease = Date.distantPast
  private var lastScan = Date.distantPast

  // Shown in Settings; written on q, read on main.
  private let mu = NSLock()
  private var hookLines: [String: String] = [:]
  private var keysLine = ""
  private var log: [[String: Any]] = []

  // q only: the key route's memory.
  private var scanning = false
  private var firstSeen: [String: Date] = [:]
  private var tries: [String: (n: Int, at: Date)] = [:]
  private var told: Set<String> = []

  static let keyAi = "autoApprove.ai", keySleep = "autoApprove.sleep", keyAlways = "autoApprove.always", keyLog = "autoApprove.log"
  /// PS 1.65: the notice about the defaults was shown on this Mac (the defaults act as off until then).
  static let keyNoticed = "autoApprove.noticeSeen"
  static let logMax = 60
  static let scanEvery: TimeInterval = 2.5

  /// The apps the key route looks at (bundle id, name, how PS reads it).
  enum Reader { case terminal, iterm, ax }
  static let apps: [(id: String, name: String, how: Reader)] = [
    ("com.apple.Terminal", "Terminal", .terminal),
    ("com.googlecode.iterm2", "iTerm2", .iterm),
    ("dev.warp.Warp-Stable", "Warp", .ax),
    ("com.microsoft.VSCode", "VS Code", .ax),
    ("com.microsoft.VSCodeInsiders", "VS Code", .ax),
    ("com.todesktop.230313mzl4w4u92", "Cursor", .ax),
  ]

  /// What this Mac has saved for each switch: nil when the person never chose it.
  private func saved() -> ApproveCore.Saved {
    let d = UserDefaults.standard
    let g = { (k: String) -> Bool? in d.object(forKey: k) == nil ? nil : d.bool(forKey: k) }
    return ApproveCore.Saved(ai: g(Self.keyAi), sleep: g(Self.keySleep), always: g(Self.keyAlways))
  }

  /// PS 1.65: the defaults count with the feature on and the notice shown on this Mac.
  private var defaultsLive: Bool { ApproveCore.defaultsLive(feature: Features.on("auto-approve-defaults"), noticeSeen: UserDefaults.standard.bool(forKey: Self.keyNoticed)) }
  private func resolveNow() { sw = ApproveCore.resolve(saved(), defaults: defaultsLive) }

  // MARK: start and stop

  func start(testDir: String?) {
    test = testDir != nil
    guard !test else { return }
    let d = UserDefaults.standard
    // PS 1.65: a switch the person never chose takes its default (AI mode and Sleep mode on, Always off); a saved one stands.
    resolveNow()
    log = (d.array(forKey: Self.keyLog) as? [[String: Any]]) ?? []
    // At launch only a SAVED On puts the line in; a default never writes another tool's settings before a mode starts.
    let keep = ApproveCore.hookWanted(saved(), active: false)
    hookIn = keep
    let waiting = ApproveCore.armed(sw)
    q.async { [self] in
      installer.setLease(false)                    // never a lease left from before (a crash): the mode decides again
      if keep { applyHook(true) }
      else if installer.claudeOn() || installer.codexOn() || FileManager.default.fileExists(atPath: paths.hook.path) { applyHook(false, waiting: waiting) }
      else if waiting { applyHook(false, waiting: true) }
      refreshKeysLine(ask: false)
    }
    // The feature switch turned in Settings applies at once, no restart.
    if !watchingFeatures { watchingFeatures = true; Features.observers.append { [weak self] in self?.recheck() } }
    tick = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.tickMain() }
    tick?.tolerance = 0.2
  }

  /// PS is quitting: no lease left behind (the script says nothing without one). PS 1.65: a line that is in only because a mode
  /// ran with a default switch comes out now too (a few small file reads and writes, once, at quit), so nothing of PS's stays in
  /// another tool's settings while PS is closed. A saved On keeps its line, as before.
  func stop() {
    guard !test else { return }
    installer.setLease(false)
    if hookIn && !ApproveCore.savedOn(saved()) { hookIn = false; q.sync { _ = installer.uninstall() } }
  }

  // MARK: Settings

  func settingsJSON() -> [String: Any] {
    mu.lock(); defer { mu.unlock() }
    let sv = saved(), feat = Features.on("auto-approve-defaults")
    var out: [String: Any] = ["ai": sw.ai, "sleep": sw.sleep, "always": sw.always, "on": why != nil, "keys": keysLine,
                              "defaulted": feat && ApproveCore.defaulted(sv), "unset": feat ? ApproveCore.unset(sv) : [],
                              "noticed": UserDefaults.standard.bool(forKey: Self.keyNoticed),
                              "log": Array(log.suffix(30).reversed())]
    if let why { out["why"] = why }
    out["hooks"] = hookLines
    return out
  }

  /// From the page: {type:"autoApprove:set", key, on, quiet?}, {type:"autoApprove:clearLog"} or {type:"autoApprove:noticed"}.
  /// A click, the notice's answer, or the person's Turn off from the notice on another Mac (quiet: never asks macOS anything).
  func handle(_ msg: [String: Any]) {
    guard !test else { return }
    if (msg["type"] as? String) == "autoApprove:noticed" {
      guard !UserDefaults.standard.bool(forKey: Self.keyNoticed) else { return }
      UserDefaults.standard.set(true, forKey: Self.keyNoticed)
      psLog("PS auto approve: the 1.65 notice was shown, the defaults count from now")
      recheck()
      return
    }
    if (msg["type"] as? String) == "autoApprove:clearLog" {
      mu.lock(); log = []; mu.unlock()
      UserDefaults.standard.removeObject(forKey: Self.keyLog)
      onChange?()
      return
    }
    guard let key = msg["key"] as? String, let on = msg["on"] as? Bool else { return }
    let quiet = msg["quiet"] as? Bool == true
    switch key {
    case "ai": sw.ai = on; UserDefaults.standard.set(on, forKey: Self.keyAi)
    case "sleep": sw.sleep = on; UserDefaults.standard.set(on, forKey: Self.keySleep)
    case "always": sw.always = on; UserDefaults.standard.set(on, forKey: Self.keyAlways)
    default: return
    }
    psLog("PS auto approve: \(key) switched \(on ? "on" : "off")\(quiet ? " (quietly)" : "")")
    resolveNow()
    let want = hookWanted()
    let waiting = ApproveCore.armed(sw)
    hookIn = want
    q.async { [self] in
      applyHook(want, waiting: waiting)   // an On click writes the line again (its rows say how it went)
      // A click in Settings: the person is at the Mac, the one moment macOS may ask to let PS read Terminal and iTerm2.
      // Never from the notice or a synced answer (quiet): those must not pop up a system prompt.
      refreshKeysLine(ask: on && !quiet)
      DispatchQueue.main.async { [weak self] in self?.tickMain(); self?.onChange?() }
    }
    onChange?()
  }

  /// Main: the switches again (the feature switch changed, the notice was shown), then the hook and the state.
  private func recheck() {
    guard !test else { return }
    let before = sw
    resolveNow()
    tickMain()
    syncHook()
    if sw != before { psLog("PS auto approve: switches now ai \(sw.ai), sleep \(sw.sleep), always \(sw.always)") }
    onChange?()
  }
  private func hookWanted() -> Bool { ApproveCore.hookWanted(saved(), active: ApproveCore.why(sw, modes()) != nil) }
  /// Main: the line in or out when what is wanted changed (a mode began or ended, a switch moved).
  private func syncHook() {
    let want = hookWanted()
    guard want != hookIn else { return }
    hookIn = want
    let waiting = ApproveCore.armed(sw)
    q.async { [self] in applyHook(want, waiting: waiting) }
  }

  /// q: the hook line in or out, and the rows that say so. `waiting`: out, but a switch is on by its default (it goes in
  /// when Auto approve turns on).
  private func applyHook(_ on: Bool, waiting: Bool = false) {
    let i = installer
    var lines: [String: String] = [:]
    if on {
      let r = i.install()
      lines["claude"] = Self.line(r.claude, name: "Claude Code", on: "On. Claude Code's permission prompts are answered Yes while Auto approve is on. Questions wait for you.")
      lines["codex"] = Self.line(r.codex, name: "Codex", on: "On. Codex runs PS's hook once you type /hooks in Codex and trust it.")
      psLog("PS auto approve: hook line in (claude \(r.claude == .done ? "done" : "not"), codex \(r.codex == .done ? "done" : "not"))")
    } else {
      let notes = i.uninstall()
      lines["claude"] = notes.first(where: { $0.contains(".claude") }) ?? (waiting ? Self.waitLine : "Off.")
      lines["codex"] = notes.first(where: { $0.contains(".codex") }) ?? (waiting ? Self.waitLine : "Off.")
      psLog("PS auto approve: hook line out\(notes.isEmpty ? "" : " (with a note)")")
    }
    mu.lock(); hookLines = lines; mu.unlock()
    DispatchQueue.main.async { [weak self] in self?.onChange?() }
  }
  /// PS 1.65: a switch on by its default, no mode running: nothing is written yet.
  static let waitLine = "PS adds its line when Auto approve turns on and takes it out after."
  private static func line(_ o: ApproveInstaller.Outcome, name: String, on: String) -> String {
    switch o { case .done: return on; case .missing: return "\(name) is not on this Mac."; case .refused(let why): return why }
  }

  /// q: the line about the key route: can PS read Terminal and iTerm2, and press keys at all.
  private func refreshKeysLine(ask: Bool) {
    var blocked: [String] = []
    for app in Self.apps where app.how != .ax {
      guard !NSRunningApplication.runningApplications(withBundleIdentifier: app.id).isEmpty else { continue }
      let st = Self.automation(app.id, ask: ask)
      if st != noErr && st != OSStatus(procNotFound) { blocked.append(app.name) }
    }
    let line: String
    if !AXIsProcessTrusted() { line = "For prompts the hook cannot answer, PS needs Accessibility in System Settings, Privacy and Security." }
    else if !blocked.isEmpty { line = "To answer prompts in \(blocked.joined(separator: " and ")), allow PS under System Settings, Privacy and Security, Automation." }
    else { line = "Other prompts: PS reads Terminal and iTerm2 windows, and Warp, VS Code and Cursor where they show their text, and presses Return only on a clear yes or no permission prompt." }
    mu.lock(); keysLine = line; mu.unlock()
  }

  // MARK: every second

  private func modes() -> ApproveCore.Modes {
    .init(ai: Sentry.shared.engaged, sleep: ApproveCore.sleepMode(screenUp: SleepScreen.shared.isUp, alarmOnly: SleepScreen.shared.plan?.alarmOnly == true))
  }

  private func tickMain() {
    let now = Date()
    let w = ApproveCore.why(sw, modes())
    if w != why {
      why = w
      lastLease = now
      psLog("PS auto approve: \(w.map { "on (\($0))" } ?? "off")")
      q.async { [self] in installer.setLease(w != nil); firstSeen = [:]; tries = [:]; told = [] }
      syncHook()   // a default only switch: the line goes in as the mode starts and out as it ends
      onChange?()
    } else if w != nil && now.timeIntervalSince(lastLease) >= ApproveCore.leaseEvery {
      lastLease = now
      q.async { [self] in installer.setLease(true) }
    }
    guard ApproveCore.armed(sw), now.timeIntervalSince(lastScan) >= Self.scanEvery else { return }
    lastScan = now
    let ctx = Ctx(why: w, covered: Sentry.shared.engaged || SleepScreen.shared.isUp, protectedFront: Protected.front,
                  locked: Self.screenLocked(), idle: Self.idleSeconds(),
                  running: Self.apps.flatMap { a in NSRunningApplication.runningApplications(withBundleIdentifier: a.id).filter { !Protected.matches($0) }.map { (a, $0.processIdentifier) } })
    q.async { [self] in
      pickUpDrops()
      if ctx.why != nil { scan(ctx) }
    }
  }

  /// What the Mac is doing, read on the main thread for the scan on q.
  struct Ctx {
    var why: String?
    var covered: Bool
    var protectedFront: Bool
    var locked: Bool
    var idle: TimeInterval
    var running: [(app: (id: String, name: String, how: Reader), pid: pid_t)]
    /// PS may bring a window forward: only with Always on and the Mac in use by nobody right now.
    var mayFocus: Bool { why == "Always" && !covered && !protectedFront && !locked && idle >= 3 }
  }

  // MARK: route 1, the hook's drops

  private func pickUpDrops() {
    let fm = FileManager.default
    let names = ((try? fm.contentsOfDirectory(atPath: paths.inbox.path)) ?? []).filter { $0.hasSuffix(".drop") && !$0.hasPrefix(".") }
    guard !names.isEmpty else { return }
    var lines: [[String: Any]] = []
    for name in names.prefix(200) {
      let url = paths.inbox.appendingPathComponent(name)
      if let text = try? String(contentsOf: url, encoding: .utf8), let d = ApproveCore.parseDrop(text) { lines.append(ApproveCore.logLine(d)) }
      try? fm.removeItem(at: url)
    }
    psLog("PS auto approve: \(lines.count) approved by the hook")
    add(lines.sorted { (($0["at"] as? Double) ?? 0) < (($1["at"] as? Double) ?? 0) })
  }

  /// Adds log lines (any thread) and keeps the last logMax on this Mac.
  private func add(_ lines: [[String: Any]]) {
    guard !lines.isEmpty else { return }
    mu.lock()
    log.append(contentsOf: lines)
    if log.count > Self.logMax { log.removeFirst(log.count - Self.logMax) }
    let copy = log
    mu.unlock()
    UserDefaults.standard.set(copy, forKey: Self.keyLog)
    DispatchQueue.main.async { [weak self] in self?.onChange?() }
  }
  private func logKey(_ app: String, _ what: String, how: String) {
    add([["at": Date().timeIntervalSince1970, "app": app, "how": how, "what": what, "where": ""]])
  }

  // MARK: route 2, keys

  /// One window or session PS can read, and what is on it.
  struct Seen { var app: (id: String, name: String, how: Reader); var pid: pid_t; var target: String; var text: String; var window: AXUIElement? }

  private func scan(_ ctx: Ctx) {
    guard !scanning, !ctx.running.isEmpty else { return }
    scanning = true
    defer { scanning = false }
    let now = Date()
    var still = Set<String>()
    for (app, pid) in ctx.running {
      for s in read(app, pid) {
        guard case .approve(let key, let what) = ApproveCore.classify(s.text) else { continue }
        let fp = s.target + "\n" + key
        still.insert(fp)
        // Seen twice, 2.5 s apart: never a half drawn screen, and the hook gets its chance first.
        guard let first = firstSeen[fp] else { firstSeen[fp] = now; continue }
        guard now.timeIntervalSince(first) >= 2 else { continue }
        let t = tries[fp] ?? (0, .distantPast)
        guard now.timeIntervalSince(t.at) >= 8 else { continue }
        guard t.n < 3 else {
          if told.insert(fp + "gave up").inserted { logKey(app.name, "Could not approve: \(what)", how: "stuck") }
          continue
        }
        if app.how == .iterm {
          tries[fp] = (t.n + 1, now)
          if pressITerm(s, key: key) { logKey(app.name, what, how: "key") }
        } else if ctx.mayFocus {
          tries[fp] = (t.n + 1, now)
          if pressFocused(s, key: key) { logKey(app.name, what, how: "key") }
        } else if told.insert(fp).inserted {
          logKey(app.name, "Waiting: \(what). PS presses keys in \(app.name) only with Always on, while the Mac is unlocked and idle.", how: "waiting")
        }
      }
    }
    firstSeen = firstSeen.filter { still.contains($0.key) }
    tries = tries.filter { still.contains($0.key) }
  }

  /// Every window or session of an app, with its text. Empty when PS may not or cannot read it.
  private func read(_ app: (id: String, name: String, how: Reader), _ pid: pid_t) -> [Seen] {
    guard !Protected.matches(app.id) else { return [] }
    switch app.how {
    case .terminal, .iterm:
      guard Self.automation(app.id, ask: false) == noErr else { return [] }
      let nonce = UUID().uuidString.prefix(8)
      let script = app.how == .terminal ? Self.terminalRead(String(nonce)) : Self.itermRead(String(nonce))
      guard let out = Self.osascript(script) else { return [] }
      return ApproveCore.split(out, nonce: String(nonce)).map { Seen(app: app, pid: pid, target: $0.target, text: $0.text, window: nil) }
    case .ax:
      guard AXIsProcessTrusted() else { return [] }
      return Self.axWindows(pid).map { Seen(app: app, pid: pid, target: "\(pid):\($0.title)", text: $0.text, window: $0.window) }
    }
  }

  /// The same prompt still there, just before a key goes in.
  private func stillThere(_ s: Seen, key: String) -> Bool {
    guard let now = read(s.app, s.pid).first(where: { $0.target == s.target }) else { return false }
    if case .approve(let k, _) = ApproveCore.classify(now.text) { return k == key }
    return false
  }

  /// iTerm2: Return written straight into that session. Nothing moves on screen.
  private func pressITerm(_ s: Seen, key: String) -> Bool {
    let sid = s.target.filter { $0.isLetter || $0.isNumber || $0 == "-" }
    guard !sid.isEmpty, stillThere(s, key: key) else { return false }
    let script = """
    tell application id "com.googlecode.iterm2"
      repeat with w in windows
        repeat with t in tabs of w
          repeat with s in sessions of t
            if (id of s as text) is "\(sid)" then
              tell s to write text (character id 13) newline no
              return "ok"
            end if
          end repeat
        end repeat
      end repeat
    end tell
    return "gone"
    """
    let ok = Self.osascript(script)?.trimmingCharacters(in: .whitespacesAndNewlines) == "ok"
    psLog("PS auto approve: iTerm2 \(ok ? "pressed Return" : "session gone")")
    return ok
  }

  /// Terminal, Warp, VS Code, Cursor: that exact window forward, checked, Return, the app you were in back.
  private func pressFocused(_ s: Seen, key: String) -> Bool {
    guard stillThere(s, key: key), NSRunningApplication(processIdentifier: s.pid) != nil else { return false }
    let axApp = AXUIElementCreateApplication(s.pid)
    AXUIElementSetMessagingTimeout(axApp, 1)
    // 1. The window to the front inside its app (Terminal: its tab chosen too).
    if s.app.how == .terminal {
      let parts = s.target.split(separator: " ").compactMap { Int($0) }
      guard parts.count == 2 else { return false }
      _ = Self.osascript("tell application id \"com.apple.Terminal\"\nset selected of tab \(parts[1]) of window id \(parts[0]) to true\nset index of window id \(parts[0]) to 1\nend tell")
    } else if let w = s.window {
      AXUIElementPerformAction(w, kAXRaiseAction as CFString)
      AXUIElementSetAttributeValue(w, kAXMainAttribute as CFString, kCFBooleanTrue)
    } else { return false }
    // 2. The app to the front, remembering what was there.
    var before: NSRunningApplication?
    DispatchQueue.main.sync { before = NSWorkspace.shared.frontmostApplication }
    if let b = before, Protected.matches(b) { return false }
    AXUIElementSetAttributeValue(axApp, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
    Thread.sleep(forTimeInterval: 0.35)
    // 3. Check: that app in front, that window focused, nobody started typing.
    var frontPid: pid_t = 0
    DispatchQueue.main.sync { frontPid = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0 }
    var focused: CFTypeRef?
    AXUIElementCopyAttributeValue(axApp, kAXFocusedWindowAttribute as CFString, &focused)
    var right = frontPid == s.pid && Self.idleSeconds() >= 0.3
    if right {
      if s.app.how == .terminal {
        let parts = s.target.split(separator: " ").compactMap { Int($0) }
        let front = Self.osascript("tell application id \"com.apple.Terminal\" to return (id of front window as text) & \" \" & (index of selected tab of front window as text)")?
          .trimmingCharacters(in: .whitespacesAndNewlines)
        right = front == "\(parts[0]) \(parts[1])"
      } else if let w = s.window, let f = focused {
        right = CFEqual(w, f)
      } else { right = false }
    }
    // 4. Return, only into the checked window.
    if right {
      let src = CGEventSource(stateID: .combinedSessionState)
      let down = CGEvent(keyboardEventSource: src, virtualKey: CGKeyCode(kVK_Return), keyDown: true)
      let up = CGEvent(keyboardEventSource: src, virtualKey: CGKeyCode(kVK_Return), keyDown: false)
      down?.postToPid(s.pid); up?.postToPid(s.pid)
      Thread.sleep(forTimeInterval: 0.15)
    }
    // 5. The app you were in back in front.
    if let b = before, b.processIdentifier != s.pid, !Protected.matches(b) {
      let el = AXUIElementCreateApplication(b.processIdentifier)
      AXUIElementSetAttributeValue(el, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
    }
    psLog("PS auto approve: \(s.app.name) \(right ? "pressed Return" : "window not in front, nothing pressed")")
    return right
  }

  // MARK: reading windows

  static func terminalRead(_ nonce: String) -> String {
    """
    set out to ""
    tell application id "com.apple.Terminal"
      repeat with w in windows
        try
          set wid to id of w
          set n to 0
          repeat with t in tabs of w
            set n to n + 1
            set out to out & "<<PS-\(nonce) " & wid & " " & n & ">>" & linefeed & (contents of t) & linefeed
          end repeat
        end try
      end repeat
    end tell
    return out
    """
  }
  static func itermRead(_ nonce: String) -> String {
    """
    set out to ""
    tell application id "com.googlecode.iterm2"
      repeat with w in windows
        repeat with t in tabs of w
          repeat with s in sessions of t
            try
              set out to out & "<<PS-\(nonce) " & (id of s as text) & ">>" & linefeed & (contents of s) & linefeed
            end try
          end repeat
        end repeat
      end repeat
    end tell
    return out
    """
  }
  /// Runs an AppleScript with osascript, at most 6 seconds. Nil on any failure.
  static func osascript(_ script: String) -> String? {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    p.arguments = ["-e", script]
    let out = Pipe()
    p.standardOutput = out; p.standardError = FileHandle.nullDevice; p.standardInput = FileHandle.nullDevice
    do { try p.run() } catch { return nil }
    let deadline = Date().addingTimeInterval(6)
    while p.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.05) }
    if p.isRunning { p.terminate(); return nil }
    let data = out.fileHandleForReading.readDataToEndOfFile()
    guard p.terminationStatus == 0 else { return nil }
    return String(decoding: data, as: UTF8.self)
  }

  /// May PS send Apple events to this app? `ask` shows macOS's question (only when the person just clicked).
  static func automation(_ bundleId: String, ask: Bool) -> OSStatus {
    var addr = AEAddressDesc()
    let bytes = Array(bundleId.utf8)
    let st = bytes.withUnsafeBufferPointer { AECreateDesc(DescType(typeApplicationBundleID), $0.baseAddress, $0.count, &addr) }
    guard st == noErr else { return OSStatus(st) }
    defer { AEDisposeDesc(&addr) }
    return AEDeterminePermissionToAutomateTarget(&addr, AEEventClass(typeWildCard), AEEventID(typeWildCard), ask)
  }

  /// An app's windows on the current desktop, each with the text Accessibility shows (text areas and static text,
  /// at most 3000 elements a window). A window with no text is left out.
  static func axWindows(_ pid: pid_t) -> [(window: AXUIElement, title: String, text: String)] {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 1)
    var v: CFTypeRef?
    guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &v) == .success, let wins = v as? [AXUIElement] else { return [] }
    var res: [(AXUIElement, String, String)] = []
    for w in wins.prefix(8) {
      var t: CFTypeRef?
      AXUIElementCopyAttributeValue(w, kAXTitleAttribute as CFString, &t)
      var texts: [String] = []
      var stack: [AXUIElement] = [w]
      var n = 0
      while let e = stack.popLast(), n < 3000 {
        n += 1
        var role: CFTypeRef?
        AXUIElementCopyAttributeValue(e, kAXRoleAttribute as CFString, &role)
        let r = role as? String ?? ""
        if r == kAXTextAreaRole as String || r == kAXStaticTextRole as String {
          var val: CFTypeRef?
          if AXUIElementCopyAttributeValue(e, kAXValueAttribute as CFString, &val) == .success, let s = val as? String, !s.isEmpty { texts.append(s) }
        }
        var kids: CFTypeRef?
        if AXUIElementCopyAttributeValue(e, kAXChildrenAttribute as CFString, &kids) == .success, let k = kids as? [AXUIElement] { stack.append(contentsOf: k.reversed()) }
      }
      let text = texts.joined(separator: "\n")
      if !text.isEmpty { res.append((w, (t as? String) ?? "", text)) }
    }
    return res
  }

  static func screenLocked() -> Bool {
    guard let d = CGSessionCopyCurrentDictionary() as? [String: Any] else { return true }
    return (d["CGSSessionScreenIsLocked"] as? Bool) == true || (d["CGSSessionScreenIsLocked"] as? Int) == 1
  }
  /// Seconds since the last key, click or mouse move.
  static func idleSeconds() -> TimeInterval {
    CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: CGEventType(rawValue: ~0)!)
  }
}
