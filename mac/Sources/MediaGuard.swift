// AirPods Max crown (the developer, 23 Oct 2026). His crown presses sometimes gave the macOS error sound and
// double and triple tap stopped working: a browser tab (Brave, DuckDuckGo) held the Now Playing slot,
// so the press went to a browser that never answered (mediaremoted: "Client com.brave.Browser-10201
// failed to reply to command ... TimedoutWaitingForCanBeNowPlaying").
//
// 1) "Give AirPods button back to Spotify" (the volume mixer's gear; also on the card below; it was
//    called "Reconfigure AirPods Max" until the developer said on 4 Nov 2026 he could not tell what that meant):
//    one click hands the crown back to his music app. Spotify (or Music) running and
//    paused: its own volume goes to 0, play, pause, volume back, so it ends up paused, silent the whole
//    time, and holding Now Playing; the next crown press resumes it. Already playing: left playing.
//    No music app running: "Open Spotify first" (nothing is launched). Each step is one AppleScript
//    line that only talks to an app that is already running; macOS asks once for Automation
//    permission, on that first click.
// 2) Optional, off by default (PS > Settings): when a media command to a browser times out (read only
//    from mediaremoted's log, one "log stream" on its own queue, only while switched on), PS gives the
//    button back to the music app by itself, once (at most every 10 minutes per browser), the same silent
//    way as the button, and says so in a short card ("Your AirPods button went to Brave, so PS gave it
//    back to Spotify"). Only when that fails does the card carry the button. A browser simply taking
//    Now Playing (a video the developer is watching) never raises anything.
// Never: 1Password or Signal (dropped at the first parse, never shown or counted), killing a daemon,
// changing audio or Bluetooth settings. A self test copy reads a fake feed and talks to a fake player.
import AppKit

final class MediaGuard {
  static let shared = MediaGuard()

  // Test hooks: the clock, the running music apps, the player, the browser, the pop-up stack.
  var now: () -> Date = { Date() }
  var musicRunning: () -> [String] = {
    let ids = Set(NSWorkspace.shared.runningApplications.compactMap { $0.bundleIdentifier })
    return MediaGuard.players.map { $0.id }.filter { ids.contains($0) }
  }
  /// One AppleScript command to a music app that is already running (never launches it). The output, or nil on an error.
  var tell: (_ app: String, _ command: String) -> String? = { app, cmd in
    MediaGuard.osascript("if application id \"\(app)\" is running then tell application id \"\(app)\" to \(cmd)")
  }
  var bringForward: (String) -> Void = { id in
    NSRunningApplication.runningApplications(withBundleIdentifier: id).first?.activate()
  }
  /// The card goes to the pop-up stack (a test copy collects it as well).
  var present: ([String: Any]) -> Void = { c in Toast.shared.showCard(c) }

  /// The optional card for a press nobody answered. Off unless the developer switches it on.
  private(set) var on = false
  private var testDir: String?
  private let q = DispatchQueue(label: "PS media guard", qos: .utility)
  private var proc: Process?
  private var buffer = Data()
  private var lastShown: [String: Date] = [:]
  private var showing: Set<String> = []
  private(set) var shownCount = 0
  private var busy = false

  /// match: bundle id prefixes; the name the log gives counts too (whole word, at the end).
  struct Browser { let id: String; let name: String; let match: [String] }
  static let browsers: [Browser] = [
    Browser(id: "com.brave.Browser", name: "Brave", match: ["com.brave.browser"]),
    Browser(id: "com.duckduckgo.macos.browser", name: "DuckDuckGo", match: ["com.duckduckgo"]),
    Browser(id: "com.google.Chrome", name: "Chrome", match: ["com.google.chrome"]),
    Browser(id: "com.apple.Safari", name: "Safari", match: ["com.apple.safari"]),
    Browser(id: "org.mozilla.firefox", name: "Firefox", match: ["org.mozilla.firefox"]),
    Browser(id: "company.thebrowser.Browser", name: "Arc", match: ["company.thebrowser"]),
    Browser(id: "com.microsoft.edgemac", name: "Edge", match: ["com.microsoft.edge"]),
    Browser(id: "com.operasoftware.Opera", name: "Opera", match: ["com.operasoftware"]),
    Browser(id: "com.vivaldi.Vivaldi", name: "Vivaldi", match: ["com.vivaldi"]),
    Browser(id: "org.chromium.Chromium", name: "Chromium", match: ["org.chromium"]),
    Browser(id: "com.kagi.kagimacOS", name: "Orion", match: ["com.kagi"]),
    Browser(id: "app.zen-browser.zen", name: "Zen", match: ["app.zen-browser"]),
  ]
  static let players: [(id: String, name: String)] = [("com.spotify.client", "Spotify"), ("com.apple.Music", "Music")]

  // ---------- settings ----------
  func handle(_ msg: [String: Any]) {
    if let b = msg["on"] as? Bool {
      on = b
      if testDir == nil { UserDefaults.standard.set(b, forKey: "mediaGuard.failedCard") }
      if b { q.async { self.startStream() } } else { q.async { self.stopStream() } }
    }
  }
  func settingsJSON() -> [String: Any] { ["on": on] }

  func start(testDir: String?) {
    self.testDir = testDir
    if testDir == nil { on = UserDefaults.standard.bool(forKey: "mediaGuard.failedCard") }   // a new key: off for everyone until switched on
    guard testDir == nil else { return }                           // a test copy only reads the fake feed (SelfTest.mediaCheck)
    NotificationCenter.default.addObserver(forName: NSApplication.willTerminateNotification, object: nil, queue: nil) { [weak self] _ in self?.q.sync { self?.stopStream() } }
    q.async { self.reapOrphans(); if self.on { self.startStream() } }
  }
  /// A PS that was replaced without quitting (an update) leaves its "log stream" child behind, now
  /// owned by launchd. Only PS's own reader of mediaremoted's log is ended here, nothing else.
  private func reapOrphans() {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/ps")
    p.arguments = ["-x", "-o", "pid=,ppid=,command="]
    let out = Pipe(); p.standardOutput = out; p.standardError = FileHandle.nullDevice
    guard (try? p.run()) != nil else { return }
    let d = out.fileHandleForReading.readDataToEndOfFile(); p.waitUntilExit()
    for line in String(decoding: d, as: UTF8.self).split(separator: "\n") {
      let f = line.split(separator: " ", maxSplits: 2, omittingEmptySubsequences: true)
      guard f.count == 3, let pid = Int32(f[0]), f[1] == "1", f[2].hasPrefix("/usr/bin/log stream --style ndjson"), f[2].contains("process == \"mediaremoted\"") else { continue }
      // Only if that pid still runs /usr/bin/log (SafeSignal checks it right before).
      if SafeSignal.signal(pid, SIGTERM, expected: ["/usr/bin/log"], why: "log reader left behind") {
        psLog("PS media: ended a log reader left behind by an earlier PS")
      }
    }
  }

  // ---------- the log stream (read only, its own queue, only while the card is switched on) ----------
  private func startStream() {
    guard proc == nil, on, testDir == nil else { return }
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/log")
    p.arguments = ["stream", "--style", "ndjson", "--level", "default", "--predicate",
                   "process == \"mediaremoted\" AND eventMessage CONTAINS \"failed to reply to command\""]
    let out = Pipe()
    p.standardOutput = out
    p.standardError = FileHandle.nullDevice
    out.fileHandleForReading.readabilityHandler = { [weak self] h in
      let d = h.availableData
      guard let self, !d.isEmpty else { return }
      self.q.async { self.take(d) }
    }
    p.terminationHandler = { [weak self] _ in
      out.fileHandleForReading.readabilityHandler = nil
      guard let self else { return }
      self.q.async {
        self.proc = nil
        // log stream ended (eg after a wake): start again in a little while, while switched on.
        self.q.asyncAfter(deadline: .now() + 30) { self.startStream() }
      }
    }
    do { try p.run(); proc = p } catch { psLog("PS media: log stream did not start (\(error.localizedDescription))") }
  }
  private func stopStream() {
    proc?.terminationHandler = nil
    proc?.terminate()
    proc = nil
  }
  private func take(_ d: Data) {
    buffer.append(d)
    while let nl = buffer.firstIndex(of: 0x0A) {
      let line = buffer[buffer.startIndex..<nl]
      buffer.removeSubrange(buffer.startIndex...nl)
      guard let o = try? JSONSerialization.jsonObject(with: line) as? [String: Any], let m = o["eventMessage"] as? String else { continue }
      feed(m)
    }
    if buffer.count > 1_000_000 { buffer.removeAll() }
  }

  // ---------- reading one log message ----------
  enum Event: Equatable { case failed(String), nowPlaying(String) }
  /// What a mediaremoted message says, or nil. 1Password and Signal never get past this.
  static func parse(_ m: String) -> Event? {
    if let r = m.range(of: "Client "), let e = m.range(of: " failed to reply to command", range: r.upperBound..<m.endIndex) {
      var app = String(m[r.upperBound..<e.lowerBound])
      if let dash = app.range(of: "-", options: .backwards), Int(app[dash.upperBound...]) != nil { app = String(app[..<dash.lowerBound]) }   // "com.brave.Browser-10201"
      return Protected.matches(app) ? nil : .failed(app)
    }
    if m.contains("NowPlayingApplicationDidChangeNotification"), let r = m.range(of: "❯") {
      let seg = m[r.upperBound...].components(separatedBy: "❯").first ?? ""
      let words = seg.split(separator: " ").map(String.init)
      guard let pidAt = words.firstIndex(where: { $0.hasPrefix("(") && $0.hasSuffix(")") && Int($0.dropFirst().dropLast()) != nil }), pidAt >= 1 else { return nil }
      let id = words[pidAt - 1], name = words[(pidAt + 1)...].joined(separator: " ")
      let app = id.contains(".") ? id + (name.isEmpty ? "" : " " + name) : name
      return app.isEmpty || Protected.matches(app) ? nil : .nowPlaying(app)
    }
    return nil
  }
  static func browser(_ app: String) -> Browser? {
    let a = app.lowercased()
    if Protected.matches(a) { return nil }
    return browsers.first { b in
      let n = b.name.lowercased()
      return b.match.contains { a.contains($0) } || a == n || a.hasSuffix(" " + n) || a.hasSuffix(" " + n + " browser")
    }
  }

  /// One message from mediaremoted (the live stream on its own queue, or a self test's fake line).
  /// Only a press a browser never answered counts; a browser taking Now Playing (a video the developer is
  /// watching) is normal and never raises a card.
  func feed(_ m: String) {
    guard on, case .failed(let app)? = MediaGuard.parse(m), let b = MediaGuard.browser(app) else { return }
    let t = now()
    q.async { [self] in
      if let last = lastShown[b.id], t.timeIntervalSince(last) < 600 { return }   // at most once every 10 minutes per app
      lastShown[b.id] = t
      shownCount += 1
      let id = "ma:" + b.name.lowercased()
      psLog("PS media: \(b.name) did not answer a media command")
      // Give the button back by itself first, the same silent way as the button (no sound, no output change).
      DispatchQueue.main.async { [self] in
        let player = MediaGuard.players.first { musicRunning().contains($0.id) }?.name ?? "Spotify"
        reconfigure(auto: true) { [self] _, ok in
          if ok {
            present(["id": id, "title": "Your AirPods button went to \(b.name), so PS app gave it back to \(player)"])
            return
          }
          q.async { [self] in showing.insert(id) }
          present(["id": id, "title": "Your AirPods button went to \(b.name)", "sub": "\(b.name) didn't respond",
                   "body": "That's the error sound you heard. A \(b.name) tab with video or sound took over your AirPods play and pause button. Click below to give the button back to \(player).",
                   "sticky": true, "actions": [["id": "reconf", "label": "Give it back to \(player)"], ["id": "dismiss", "label": "Dismiss"]]])
        }
      }
    }
  }

  /// A button on the card (Toast.onAction, ids starting "ma:"). Main thread.
  func action(_ id: String, _ act: String) {
    q.async { [self] in
      guard showing.remove(id) != nil else { return }
      DispatchQueue.main.async { [self] in
        Toast.shared.hideCard(id)
        if act == "reconf" {
          reconfigure { text, ok in self.present(["id": "ma:done", "title": text, "sticky": !ok]) }
        }
      }
    }
  }

  // ---------- Give AirPods button back to Spotify (once "Reconfigure AirPods Max") ----------
  /// Hands the AirPods button back to the music app (see the top of this file). Off the main thread;
  /// the answer ("Your AirPods button now goes to Spotify", or why not) comes back on the main thread.
  /// auto: PS doing it by itself after a browser timeout, which never touches the sound output.
  func reconfigure(auto: Bool = false, _ done: @escaping (String, Bool) -> Void) {
    let running = musicRunning()
    q.async { [self] in
      guard !busy else { return }
      // First the sound itself goes to the AirPods, as a lasting pick (macOS's own switch on connect is only
      // temporary and falls back to the speakers, AutoRoute.swift); nil when it was already there.
      let out = auto ? nil : AutoRoute.shared.restoreOutput()
      func answer(_ s: String, _ ok: Bool) { let t = out.map { "\($0) \(s)" } ?? s; psLog("PS media: reconfigure, \(t)"); DispatchQueue.main.async { done(t, ok) } }
      // Then the AirPods leave hands-free (call) mode: with the AirPods as the Mac's microphone, any
      // app listening to it holds them there, and then the crown goes to Siri, not to play and pause.
      let mic = AutoRoute.shared.restoreHomeMic()
      func toldTo(_ who: String) -> String { mic.map { "Your AirPods button now goes to \(who). The microphone is back on \($0), so the AirPods are out of call mode." } ?? "Your AirPods button now goes to \(who)" }
      guard let p = MediaGuard.players.first(where: { running.contains($0.id) }) else { answer(mic.map { "Open Spotify first. The microphone is back on \($0), so the AirPods are out of call mode." } ?? "Open Spotify first", false); return }
      busy = true
      defer { busy = false }
      guard let state = tell(p.id, "get player state") else {
        answer("PS app could not reach \(p.name). If macOS asked, allow PS app to control \(p.name) in System Settings, Privacy and Security, Automation.", false); return
      }
      if state.contains("playing") { answer(toldTo(p.name), true); return }   // playing: it already holds Now Playing, left as it is
      guard let vs = tell(p.id, "get sound volume"), let vol = Int(vs.trimmingCharacters(in: .whitespacesAndNewlines)) else {
        answer("PS app could not read \(p.name)'s volume, nothing was changed", false); return
      }
      // Silent the whole time: its own volume to 0, play, pause, volume back (the volume always comes back).
      var ok = tell(p.id, "set sound volume to 0") != nil
      if ok { ok = tell(p.id, "play") != nil; Thread.sleep(forTimeInterval: 0.45) }
      let paused = tell(p.id, "pause") != nil
      let restored = tell(p.id, "set sound volume to \(vol)") != nil
      if ok && paused && restored { answer(toldTo(p.name), true) }
      else { answer(restored ? "\(p.name) did not take the AirPods button, try again" : "\(p.name)'s volume may still be at 0, check it in \(p.name)", false) }
    }
  }

  /// Runs one AppleScript line with osascript (off the main thread). The output, or nil on an error.
  static func osascript(_ line: String) -> String? {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    p.arguments = ["-e", line]
    let out = Pipe()
    p.standardOutput = out
    p.standardError = FileHandle.nullDevice
    do { try p.run() } catch { return nil }
    let d = out.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    return p.terminationStatus == 0 ? String(data: d, encoding: .utf8) ?? "" : nil
  }

  // Self test helpers.
  func resetForTest(dir: String) { q.sync { testDir = dir; on = false; lastShown = [:]; showing = []; shownCount = 0 } }
  func setOnForTest(_ b: Bool) { q.sync { on = b } }
  var showingIds: [String] { q.sync { Array(showing) } }
}

// MARK: - Self test: fake mediaremoted lines and a fake Spotify (no real log, no real player, no app brought forward).
extension SelfTest {
  static func mediaCheck(_ a: App, _ dir: String, _ done: @escaping () -> Void) {
    let g = MediaGuard.shared
    let keep = (g.now, g.musicRunning, g.tell, g.bringForward, g.present)
    // A fake Spotify: its player state and its own volume, and every command it got, in order.
    final class FakePlayer { var state = "paused"; var volume = 70; var log: [String] = []; var minVolume = 100; var down = false }
    let fake = FakePlayer()
    var clock = Date(), music = ["com.spotify.client"], cards: [[String: Any]] = [], clicked: [String] = []
    g.now = { clock }; g.musicRunning = { music }; g.bringForward = { _ in }
    g.tell = { app, cmd in
      guard app == "com.spotify.client", music.contains(app), !fake.down else { return nil }   // down: Spotify does not answer
      fake.log.append(cmd)
      switch cmd {
      case "get player state": return fake.state + "\n"
      case "get sound volume": return "\(fake.volume)\n"
      case "play": fake.state = "playing"; return ""
      case "pause": fake.state = "paused"; return ""
      default:
        if cmd.hasPrefix("set sound volume to "), let v = Int(cmd.dropFirst(20)) { fake.volume = v; fake.minVolume = min(fake.minVolume, v); return "" }
        return nil
      }
    }
    g.present = { c in cards.append(c); Toast.shared.showCard(c) }      // the parked test stack, for the picture
    g.resetForTest(dir: dir)
    var r: [(String, Bool)] = []
    let braveFail = "Client com.brave.Browser-10201 failed to reply to command (commandID=7EDAE27E-BAE2-41E6-9AF7-4B2E1D5D97F4) with error=Error Domain=kMRMediaRemoteFrameworkErrorDomain Code=307 UserInfo={NSLocalizedDescription=<private>, NSLocalizedFailureReason=<private>}"
    let ddgNow = "Posted Active Now Playing Notification kMRMediaRemoteNowPlayingApplicationDidChangeNotification for path 【 􁊸 LOCL (Mac) ❯ 􀎬 com.apple.WebKit.GPU (46395) DuckDuckGo ❯ 􀽍 default 】"
    let braveNow = "Posted Active Now Playing Notification kMRMediaRemoteNowPlayingApplicationDidChangeNotification for path 【 􁊸 LOCL (Mac) ❯ 􀐥 com.brave.Browser (10201) Brave Browser ❯ 􀽍 default 】"
    let ddgFail = "Client com.duckduckgo.macos.browser-555 failed to reply to command (commandID=2) with error=Error Domain=kMRMediaRemoteFrameworkErrorDomain Code=307"
    let signalFail = "Client org.whispersystems.signal-desktop-777 failed to reply to command (commandID=1) with error=Error Domain=kMRMediaRemoteFrameworkErrorDomain Code=307"
    func later(_ t: Double, _ f: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + t, execute: f) }
    func reconf(_ then: @escaping (String, Bool) -> Void) { g.reconfigure { s, ok in then(s, ok) } }
    func click(_ title: String, _ act: String, _ then: @escaping () -> Void) {
      let js = "(function(t,a){var b=[].filter.call(document.querySelectorAll('button'),function(x){if(x.dataset.act!==a)return false;var e=x;while(e&&(e.textContent||'').indexOf(t)<0)e=e.parentElement;return !!e&&(e.textContent.split(t).length===2)})[0];if(b){b.click();return true}return false})(" + "\"\(title)\",\"\(act)\")"
      Toast.shared.web.evaluateJavaScript(js) { v, _ in clicked.append("\(act):\(v as? Bool ?? false)"); later(1.0, then) }
    }

    // The Give AirPods button back to Spotify button, Spotify paused: muted, play, pause, volume back; paused and silent throughout.
    reconf { s1, ok1 in
      r.append(("reconfigure-paused-spotify", ok1 && s1 == "Your AirPods button now goes to Spotify"
                && fake.log == ["get player state", "get sound volume", "set sound volume to 0", "play", "pause", "set sound volume to 70"]
                && fake.volume == 70 && fake.state == "paused" && fake.minVolume == 0))
      // Spotify already playing: left playing, nothing else sent.
      fake.log = []; fake.state = "playing"
      reconf { s2, ok2 in
        r.append(("playing-spotify-left-playing", ok2 && fake.state == "playing" && fake.log == ["get player state"] && fake.volume == 70))
        // No music app running: the message, nothing launched or told.
        fake.log = []; music = []
        reconf { s3, ok3 in
          r.append(("no-music-app-says-open-spotify", !ok3 && s3 == "Open Spotify first" && fake.log.isEmpty))
          music = ["com.spotify.client"]; fake.state = "paused"; fake.log = []
          // The gear menu button in the Tab list page: its click goes through the bridge, the answer comes back under it.
          // It lives in the volume mixer's own gear: open the mixer, then its gear, then click it.
          a.overlay.evaluateJavaScript("(function(){if(!document.querySelector('.mix-pop'))document.querySelector('.tm-tr .mix-btn').click();return true})()") { _, _ in
          later(0.6) {
          a.overlay.evaluateJavaScript("(function(){if(!document.querySelector('.mix-gear'))document.querySelector('.mix-gear-btn').click();return !!document.querySelector('.mix-pop')})()") { _, _ in
          later(0.6) {
          a.overlay.evaluateJavaScript("(function(){var b=[].filter.call(document.querySelectorAll('.mix-gear button'),function(x){return x.textContent==='Give AirPods button back to Spotify'})[0];if(b){b.click();return true}return false})()") { v, _ in
          later(1.5) {
          a.overlay.evaluateJavaScript("[].map.call(document.querySelectorAll('.mix-air-note[role=status]'),function(x){return x.textContent}).join('|')") { note, _ in
          a.overlay.evaluateJavaScript("(function(){if(document.querySelector('.mix-pop'))document.querySelector('.tm-tr .mix-btn').click();return true})()", completionHandler: nil)
          r.append(("mixer-gear-button-works", (v as? Bool) == true && "\(note ?? "")".contains("Your AirPods button now goes to Spotify") && fake.log.contains("play") && fake.volume == 70))
          // The card: off by default, so a timeout raises nothing; a browser taking Now Playing never does.
          g.feed(braveFail); g.feed(ddgNow); g.feed(braveNow)
          later(0.6) {
            r.append(("failed-press-card-off-by-default", cards.isEmpty && !g.on))
            g.setOnForTest(true)
            g.feed(ddgNow); g.feed(braveNow)
            later(0.6) {
              r.append(("takeover-never-raises-a-card", cards.isEmpty))
              g.feed(signalFail)
              later(0.4) {
                r.append(("signal-never-counts", cards.isEmpty && MediaGuard.parse(signalFail) == nil))
                fake.log = []
                g.feed(braveFail)
                later(1.2) {
                  // A browser timed out: PS gave the button back by itself (silently) and says so, no button on the card.
                  let first = cards.last
                  r.append(("timeout-gives-it-back-by-itself", cards.count == 1 && (first?["title"] as? String) == "Your AirPods button went to Brave, so PS app gave it back to Spotify"
                            && first?["actions"] == nil && fake.log.contains("play") && fake.state == "paused" && fake.volume == 70 && fake.minVolume == 0))
                  snap(Toast.shared.web, "\(dir)/media-card.png") {
                    clock = clock.addingTimeInterval(300); g.feed(braveFail)
                    later(0.5) {
                      r.append(("not-again-within-10-min", cards.count == 1))
                      // Spotify does not answer: then the card explains it in plain words and carries the button.
                      fake.down = true; fake.log = []
                      g.feed(ddgFail)
                      later(1.2) {
                        let c = cards.last ?? [:]
                        let acts = ((c["actions"] as? [[String: String]]) ?? []).map { $0["label"] ?? "" }
                        r.append(("failed-give-back-shows-the-button", cards.count == 2 && (c["title"] as? String) == "Your AirPods button went to DuckDuckGo"
                                  && (c["sub"] as? String) == "DuckDuckGo didn't respond"
                                  && (c["body"] as? String) == "That's the error sound you heard. A DuckDuckGo tab with video or sound took over your AirPods play and pause button. Click below to give the button back to Spotify."
                                  && acts == ["Give it back to Spotify", "Dismiss"]))
                        snap(Toast.shared.web, "\(dir)/media-card-button.png") {
                          fake.down = false; fake.log = []; fake.state = "paused"
                          click("Your AirPods button went to DuckDuckGo", "reconf") {        // the card's own button, clicked in the page
                            later(0.8) {
                              r.append(("card-button-gives-it-back", fake.log.contains("play") && fake.volume == 70 && fake.state == "paused"
                                        && cards.contains { ($0["title"] as? String) == "Your AirPods button now goes to Spotify" }))
                              snap(Toast.shared.web, "\(dir)/media-done.png") {
                                print("MEDIA CHECK:", r.map { "\($0.0)=\($0.1 ? "ok" : "FAIL")" }.joined(separator: " "), "clicks=\(clicked.joined(separator: ","))")
                                g.setOnForTest(false)
                                (g.now, g.musicRunning, g.tell, g.bringForward, g.present) = keep
                                // Take away the cards this check put up ("Your AirPods button now goes to Spotify" stays
                                // until dismissed, by design), so the checks after it count only their own cards.
                                for c in cards { if let id = c["id"] as? String { Toast.shared.hideCard(id) } }
                                later(0.8) { done() }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
          } } } } } } }
        }
      }
    }
  }
}
