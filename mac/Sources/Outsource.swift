// Outsource work to your other computer (PS 1.65), the Mac side. The PAGE (web core/second.ts, secondbridge.ts) holds the
// vault, does all the crypto and checks every signature and expiry; this file only
//  - keeps the pairing record (OutKeep, fixed Keychain name, survives updates and restarts),
//  - on the OTHER computer: runs a checked job (OutRunner) and gives the result back in pieces for the page to seal,
//  - on the MAIN computer: lands a verified bundle in a folder (OutLanding) and serves the command line the person's AI
//    calls (a Unix socket only this person can open, tools/ps-outsource), and
//  - runs a signed restart through the existing restart helper (RemoteCommand, AutoReboot, Helper/RebootXPC.swift).
// Nothing here ever pushes, merges or decides. Nothing runs on the main thread except talking to the page. Nothing polls: the
// socket waits for a connection, power changes come from macOS notifications. It never looks at 1Password or Signal.
import AppKit
import Foundation

final class Outsource {
  static let shared = Outsource()
  /// Set by the app: sends one JSON string to window.__psOutsource on the main page (main thread safe).
  var toPage: (String) -> Void = { _ in }
  var pageReady = false

  static let test = IS_TEST_COPY
  static var root: String {
    (ProcessInfo.processInfo.environment["PS_SELFTEST"].map { $0 + "/outsource" })
      ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("PS/outsource", isDirectory: true).path
  }
  private let keep = OutKeep(dir: Outsource.root, useKeychain: !Outsource.test)
  private let landing = OutLanding(root: Outsource.root)
  private lazy var runner = OutRunner(root: Outsource.root, tools: OutTools.find())
  private let work = DispatchQueue(label: "ps.outsource", qos: .utility)
  private var role = "none"
  private var peerName = "the main computer"
  private var observing = false
  // CLI socket (main computer)
  private var listenFd: Int32 = -1
  private var source: DispatchSourceRead?
  private let cliMu = NSLock()
  private var cliPending: [String: Int32] = [:]

  // MARK: the page talks to us

  /// A page message with type "outsource" (main page only). Called on the main thread.
  func handle(_ msg: [String: Any]) {
    guard let op = msg["op"] as? String else { return }
    switch op {
    case "hello":
      pageReady = true
      work.async { [self] in
        let rec = keep.load()
        let r = (rec?["role"] as? String) ?? "none"
        DispatchQueue.main.async { self.role = r; self.watchPower(); self.sendState(rec); self.applyRole() }
      }
    case "status":
      work.async { [self] in let rec = keep.load(); DispatchQueue.main.async { self.sendState(rec) } }
    case "keep":
      guard let rec = msg["record"] as? [String: Any] else { return }
      work.async { [self] in
        let ok = keep.save(rec)
        let r = (rec["role"] as? String) ?? "none"
        DispatchQueue.main.async {
          if ok { self.role = r; self.peerName = ((rec["peer"] as? [String: Any])?["name"] as? String) ?? "the main computer"; self.applyRole() }
          self.sendState(ok ? rec : nil)
        }
      }
    case "forget":
      work.async { [self] in keep.forget(); DispatchQueue.main.async { self.role = "none"; self.applyRole(); self.sendState(nil) } }
    case "run":
      guard let j = msg["job"] as? [String: Any] else { return }
      run(j)
    case "cancel":
      if let id = msg["id"] as? String, OutSafe.idOk(id) { runner.cancel(id) }
    case "land":
      land(msg)
    case "chunk":
      chunk(msg)
    case "restart":
      restart(msg["kind"] as? String ?? "")
    case "cli-answer":
      if let r = msg["req"] as? String { answerCli(r, ok: (msg["ok"] as? Bool) ?? false, text: (msg["text"] as? String) ?? "", id: msg["id"] as? String) }
    case "island":
      break   // the page shows its own island lines; nothing to draw natively
    default: break
    }
  }

  private func send(_ d: [String: Any]) {
    var o = d; o["type"] = "outsource"
    guard let data = try? JSONSerialization.data(withJSONObject: o), let s = String(data: data, encoding: .utf8) else { return }
    if Thread.isMainThread { toPage(s) } else { DispatchQueue.main.async { self.toPage(s) } }
  }

  // MARK: state

  private func sysctl(_ n: String) -> String {
    var size = 0
    guard sysctlbyname(n, nil, &size, nil, 0) == 0, size > 0 else { return "" }
    var b = [CChar](repeating: 0, count: size)
    guard sysctlbyname(n, &b, &size, nil, 0) == 0 else { return "" }
    return String(cString: b)
  }
  private var helperWord: String {
    switch AutoReboot.shared.helperState {
    case "on", "test": return "approved"
    case "approve": return "needs approval"
    case "missing": return "missing"
    default: return "not set up"
    }
  }
  private func sendState(_ rec: [String: Any]?) {
    let info = Bundle.main.infoDictionary
    let app = ((info?["CFBundleShortVersionString"] as? String) ?? "?") + " (" + ((info?["CFBundleVersion"] as? String) ?? "?") + ")"
    var d: [String: Any] = ["op": "state", "v": 1, "app": app, "model": sysctl("hw.model"), "chip": sysctl("machdep.cpu.brand_string"),
                            "name": Host.current().localizedName ?? "This Mac", "helper": helperWord, "awake": true,
                            "locked": RemoteCommand.screenLocked(), "cli": runner.tools.names, "folder": Outsource.root]
    d["keep"] = rec ?? NSNull()
    send(d)
  }

  /// Screen lock and sleep changes go to the page as they happen (notifications, no timer).
  private func watchPower() {
    guard !observing else { return }
    observing = true
    let dn = DistributedNotificationCenter.default()
    for (name, locked) in [("com.apple.screenIsLocked", true), ("com.apple.screenIsUnlocked", false)] {
      dn.addObserver(forName: NSNotification.Name(name), object: nil, queue: .main) { [weak self] _ in self?.send(["op": "power", "awake": true, "locked": locked]) }
    }
    let wn = NSWorkspace.shared.notificationCenter
    wn.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in self?.send(["op": "power", "awake": false, "locked": true]) }
    wn.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in self?.send(["op": "power", "awake": true, "locked": RemoteCommand.screenLocked()]) }
  }

  // MARK: the other computer: run a job

  private func run(_ j: [String: Any]) {
    let id = (j["id"] as? String) ?? ""
    func refuse(_ why: String) {
      guard OutSafe.idOk(id) else { return }
      send(["op": "done", "id": id, "state": "failed", "report": "{\"id\":\"\(id)\",\"state\":\"failed\",\"note\":\"\(why)\"}", "exit": -1])
    }
    guard role == "other" else { return refuse("This computer is not set up as the other computer.") }
    if Outsource.test { return refuse("A test copy runs no jobs.") }
    let (job, why) = OutsourceJob.parse(j, now: Date().timeIntervalSince1970 * 1000)
    guard let job else { return refuse("The job was refused: \(why ?? "bad job").") }
    let ok = runner.submit(job, progress: { [weak self] state, step in
      var d: [String: Any] = ["op": "progress", "id": job.id, "state": state, "step": step]
      if state == "running" { d["startedAt"] = Date().timeIntervalSince1970 * 1000 }
      self?.send(d)
    }, done: { [weak self] r in self?.finished(r) })
    if !ok { refuse("The queue on this computer is full.") }
  }

  /// A finished job: `done` first (the page learns the piece count), then the pieces one at a time off the main thread.
  private func finished(_ r: OutDone) {
    var d: [String: Any] = ["op": "done", "id": r.id, "state": r.state, "report": r.report.json(), "exit": Int(r.report.exit)]
    if let b = r.bundlePath, let sha = r.bundleSha { d["bundle"] = ["name": "\(r.id).bundle", "sha256": sha, "size": r.bundleSize, "n": OutChunks.count(r.bundleSize)] as [String: Any] }
    var shots: [String] = []
    for p in r.shotPaths { if let data = FileManager.default.contents(atPath: p) { shots.append("data:image/png;base64," + data.base64EncodedString()) } }
    if !shots.isEmpty { d["shots"] = shots }
    send(d)
    guard let b = r.bundlePath else { return }
    work.async { [self] in
      var i = 0
      while let piece = OutRunner.chunk(path: b, index: i) {
        send(["op": "chunk", "id": r.id, "i": i, "b64": piece.base64EncodedString()])
        i += 1
        usleep(8_000)   // one piece at a time, the page is never flooded
      }
    }
  }

  // MARK: the main computer: land a result

  private func land(_ m: [String: Any]) {
    guard let id = m["id"] as? String else { return }
    let report = (m["report"] as? String) ?? ""
    let bundle = m["bundle"] as? [String: Any]
    let shots = (m["shots"] as? [String]) ?? []
    work.async { [self] in
      guard let dir = landing.start(id: id, report: report, bundle: bundle, shots: shots) else { return send(["op": "landed", "id": id, "path": ""]) }
      if bundle == nil { send(["op": "landed", "id": id, "path": dir]) }
    }
  }
  private func chunk(_ m: [String: Any]) {
    guard let id = m["id"] as? String, let i = (m["i"] as? NSNumber)?.intValue, let b64 = m["b64"] as? String, b64.utf8.count <= OutChunks.size * 2,
          let data = Data(base64Encoded: b64) else { return }
    work.async { [self] in
      switch landing.chunk(id: id, i: i, data: data) {
      case .more: break
      case .landed(let path): send(["op": "landed", "id": id, "path": path])
      case .failed(let why): psLog("outsource: landing failed: \(why)"); send(["op": "landed", "id": id, "path": ""])
      }
    }
  }

  // MARK: restart through the existing helper (a signed, fresh command the page already checked)

  private func restart(_ kind: String) {
    guard role == "other", kind == "restart" || kind == "shutdown" else { return }
    RemoteCommand.shared.run(action: kind, id: "outsource-" + String(Int(Date().timeIntervalSince1970)), from: peerName) { ok, why in
      if !ok { psLog("outsource: restart not done: \(why ?? "no reason")") }
    }
  }

  // MARK: the command line (main computer only)

  private var socketPath: String { Outsource.root + "/cli.sock" }

  private func applyRole() {
    if role == "main" && !Outsource.test { startCli() } else { stopCli() }
  }

  private static func addr(_ path: String) -> sockaddr_un? {
    var a = sockaddr_un(); a.sun_family = sa_family_t(AF_UNIX)
    let bytes = Array(path.utf8)
    guard bytes.count < MemoryLayout.size(ofValue: a.sun_path) else { return nil }
    withUnsafeMutableBytes(of: &a.sun_path) { p in for (i, b) in bytes.enumerated() { p[i] = b }; p[bytes.count] = 0 }
    return a
  }

  private func startCli() {
    guard listenFd < 0 else { return }
    work.async { [self] in
      try? FileManager.default.createDirectory(atPath: Outsource.root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
      chmod(Outsource.root, 0o700)
      unlink(socketPath)
      guard var a = Outsource.addr(socketPath) else { return }
      let fd = socket(AF_UNIX, SOCK_STREAM, 0)
      guard fd >= 0 else { return }
      let ok = withUnsafePointer(to: &a) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) } }
      guard ok == 0, listen(fd, 4) == 0 else { close(fd); return }
      chmod(socketPath, 0o600)
      let src = DispatchSource.makeReadSource(fileDescriptor: fd, queue: work)
      src.setEventHandler { [weak self] in self?.accept(fd) }
      src.setCancelHandler { close(fd) }
      listenFd = fd; source = src; src.resume()
    }
  }

  private func stopCli() {
    work.async { [self] in
      source?.cancel(); source = nil; listenFd = -1
      unlink(socketPath)
    }
  }

  private func accept(_ lfd: Int32) {
    let c = Darwin.accept(lfd, nil, nil)
    guard c >= 0 else { return }
    var uid: uid_t = 0, gid: gid_t = 0
    guard getpeereid(c, &uid, &gid) == 0, uid == getuid() else { close(c); return }   // only this person
    var tv = timeval(tv_sec: 5, tv_usec: 0)
    setsockopt(c, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
    DispatchQueue.global(qos: .utility).async { [weak self] in
      var buf = [UInt8](), one = [UInt8](repeating: 0, count: 4096)
      while buf.count < OutCli.maxLine && !buf.contains(10) {
        let n = read(c, &one, one.count)
        if n <= 0 { break }
        buf += one[0..<n]
      }
      guard let nl = buf.firstIndex(of: 10), let line = String(bytes: buf[0..<nl], encoding: .utf8), let cmd = OutCli.parse(line) else {
        Self.reply(c, OutCli.answer(ok: false, text: "ps-outsource: that request was not understood.", id: nil)); return
      }
      DispatchQueue.main.async { self?.forwardCli(c, cmd) }
    }
  }

  private static func reply(_ fd: Int32, _ line: String) {
    let d = Array((line + "\n").utf8)
    var off = 0
    while off < d.count { let n = write(fd, Array(d[off...]), d.count - off); if n <= 0 { break }; off += n }
    close(fd)
  }

  private func forwardCli(_ fd: Int32, _ cmd: [String: Any]) {
    guard pageReady, role == "main" else {
      return Self.reply(fd, OutCli.answer(ok: false, text: "Outsourcing is not ready: PS must be open and unlocked on this computer, and paired. The switch is in Settings.", id: nil))
    }
    let req = UUID().uuidString.lowercased().replacingOccurrences(of: "-", with: "")
    cliMu.lock(); cliPending[req] = fd; cliMu.unlock()
    send(["op": "cli", "req": req, "cmd": cmd])
    DispatchQueue.global().asyncAfter(deadline: .now() + 40) { [weak self] in
      self?.answerCli(req, ok: false, text: "The page did not answer in time. Is PS unlocked?", id: nil)
    }
  }

  private func answerCli(_ req: String, ok: Bool, text: String, id: String?) {
    cliMu.lock(); let fd = cliPending.removeValue(forKey: req); cliMu.unlock()
    if let fd { Self.reply(fd, OutCli.answer(ok: ok, text: text, id: id)) }
  }
}
