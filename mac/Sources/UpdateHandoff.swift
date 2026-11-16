// Staying signed in across an app update, and rolling back a build that does not start.
// Why: PS is signed without an Apple team, so macOS ties each Keychain item to the exact build that
// made it (a "cdhash" partition); a new build cannot read the old item without a password prompt,
// and the developer had to sign in after every native rebuild (Remember.swift). Nothing about that is
// weakened here. Instead the OLD build, which can read its own item, hands the saved sign in to the
// NEW build directly, process to process:
//  1. The old PS reads its item, starts a small helper (its own signed binary, --ps-update-helper)
//     and passes the item to it through a pipe, then quits normally.
//  2. The helper opens a private socket (a 0700 folder), starts the new PS and checks the code
//     signature of whoever connects (macOS's audit token: the developer's certificate, id com.cincee.ps, the
//     installed PS.app). The new PS checks the helper the same way. Only then is the item sent,
//     and the new PS saves it as its own Keychain item. It never touches disk in between.
//  3. Health, separate from the hand over: the new PS is healthy once its page has loaded and its
//     keyboard tap is up (it writes "healthy" in the journal and says "ok" on the socket). If it
//     quits, crashes or never gets there in its first 90 seconds, the helper swaps the previous
//     build back into place and starts it (roll back). A sign in that does not arrive never does.
// The new PS takes the hand over on its own thread while it finishes launching (27 Oct 2026 bug: a
// real launch only reports back to the helper once the new PS has finished launching, so a new PS
// that waited for the helper first gave up after 3 s, and the helper then refused the dead call).
// Test copies use fictional data only and never read or write the Keychain.
import AppKit
import Foundation
import Security

enum UpdateHandoff {
  static let env = ProcessInfo.processInfo.environment

  // MARK: checking the other end of the socket

  /// The process on the other end: signed with the developer's certificate as PS (and, when `path` is
  /// given, running from that app). Returns nil when good, else why not.
  static func peerProblem(_ fd: Int32, path: String?) -> String? {
    var token = audit_token_t()
    var len = socklen_t(MemoryLayout<audit_token_t>.size)
    guard getsockopt(fd, 0 /* SOL_LOCAL */, 0x006 /* LOCAL_PEERTOKEN */, &token, &len) == 0 else { return "no peer token" }
    let data = withUnsafeBytes(of: &token) { Data($0) }
    var code: SecCode?, req: SecRequirement?
    guard SecCodeCopyGuestWithAttributes(nil, [kSecGuestAttributeAudit: data] as CFDictionary, [], &code) == errSecSuccess, let code else { return "peer code unknown" }
    guard SecRequirementCreateWithString(PS_REQUIREMENT as CFString, [], &req) == errSecSuccess, let req else { return "bad requirement" }
    guard SecCodeCheckValidity(code, [], req) == errSecSuccess else { return "peer is not PS signed by PS Local Signing" }
    // Hardened runtime too (build.sh signs with it): without it anyone could start a genuine PS with
    // injected code (DYLD_INSERT_LIBRARIES) and pass the check above.
    var info: CFDictionary?
    let flags = SecCodeCopySigningInformation(unsafeBitCast(code, to: SecStaticCode.self), SecCSFlags(rawValue: kSecCSSigningInformation | kSecCSDynamicInformation), &info) == errSecSuccess
      ? ((info as? [String: Any])?[kSecCodeInfoFlags as String] as? NSNumber)?.uint32Value ?? 0 : 0
    guard flags & SecCodeSignatureFlags.runtime.rawValue != 0 else { return "peer runs without the hardened runtime" }
    if let path {
      var st: SecStaticCode?, url: CFURL?
      guard SecCodeCopyStaticCode(code, [], &st) == errSecSuccess, let st, SecCodeCopyPath(st, [], &url) == errSecSuccess,
            let p = (url as URL?)?.standardizedFileURL.path else { return "peer path unknown" }
      if p != URL(fileURLWithPath: path).standardizedFileURL.path { return "peer runs from \(p)" }
    }
    return nil
  }

  /// The process id on the other end of the socket (LOCAL_PEERPID).
  static func peerPid(_ fd: Int32) -> Int32? {
    var p: pid_t = 0
    var len = socklen_t(MemoryLayout<pid_t>.size)
    return getsockopt(fd, 0 /* SOL_LOCAL */, 0x002 /* LOCAL_PEERPID */, &p, &len) == 0 && SafeSignal.usable(p) ? p : nil
  }

  static func sockaddr(_ path: String) -> sockaddr_un? {
    var a = sockaddr_un()
    a.sun_family = sa_family_t(AF_UNIX)
    let bytes = Array(path.utf8)
    guard bytes.count < MemoryLayout.size(ofValue: a.sun_path) else { return nil }
    withUnsafeMutableBytes(of: &a.sun_path) { p in for (i, b) in bytes.enumerated() { p[i] = b }; p[bytes.count] = 0 }
    a.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
    return a
  }
  /// A short private folder for the socket (socket paths are limited to 103 bytes).
  static func socketPath(in work: URL) -> String {
    let p = work.appendingPathComponent("h.sock").path
    if p.utf8.count < 100 { return p }
    var t = Array("/tmp/ps-handoff-XXXXXX".utf8CString)
    guard let d = mkdtemp(&t) else { return p }
    return String(cString: d) + "/h.sock"
  }

  static func readLine(_ fd: Int32, timeout: Double) -> String? {
    var buf = [UInt8](), b: UInt8 = 0
    let until = Date().addingTimeInterval(timeout)
    while Date() < until {
      var pfd = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
      let r = poll(&pfd, 1, 200)
      if r < 0 { return nil }
      if r == 0 { continue }
      let n = read(fd, &b, 1)
      if n <= 0 { return nil }
      if b == 10 { return String(decoding: buf, as: UTF8.self) }
      buf.append(b)
      if buf.count > 1 << 16 { return nil }
    }
    return nil
  }
  static func writeLine(_ fd: Int32, _ s: String) -> Bool {
    let d = Array((s + "\n").utf8)
    return d.withUnsafeBytes { write(fd, $0.baseAddress, d.count) } == d.count
  }

  // MARK: the new build (at launch, before anything else starts)

  static var conn: Int32 = -1
  private static let group = DispatchGroup()
  private static var started = false

  /// Starts the hand over on its own thread and returns at once, so PS finishes launching meanwhile.
  static func start(_ j: UpdateJournal) {
    started = true; group.enter()
    Thread.detachNewThread { receive(j); group.leave() }
  }
  /// True while a hand over is still coming in.
  static var pending: Bool { started && group.wait(timeout: .now()) != .success }
  /// Waits (never on the main thread) until the hand over is done or `timeout` passed.
  static func waitDone(_ timeout: Double) { if started { _ = group.wait(timeout: .now() + timeout) } }

  /// Connects to the helper, checks it, takes the saved sign in and keeps it as this build's own.
  /// Keeps trying for up to 25 seconds: a helper only takes the call once macOS has told it this PS
  /// has finished launching, and an older helper refuses a call it took too late and waits for the next.
  static func receive(_ j: UpdateJournal) {
    let begin = Date(), until = begin.addingTimeInterval(25)
    var last = ""
    while Date() < until {
      if let fd = attempt(j, until: until, why: &last) { finish(fd, j); return }
      // No socket at all after 5 seconds: there is no helper (nothing to wait for).
      if last.hasPrefix("no helper") && Date().timeIntervalSince(begin) > 5 { break }
      usleep(250_000)
    }
    psLog("PS update: no sign in hand over (\(last)); PS runs normally")
  }

  /// One call to the helper; the connected socket once the helper sent the sign in.
  private static func attempt(_ j: UpdateJournal, until: Date, why: inout String) -> Int32? {
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0, var a = sockaddr(j.socket) else { why = "no socket"; if fd >= 0 { close(fd) }; return nil }
    let ok = withUnsafePointer(to: &a) { $0.withMemoryRebound(to: Darwin.sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) } } == 0
    guard ok else { why = "no helper (\(String(cString: strerror(errno))))"; close(fd); return nil }
    if let w = peerProblem(fd, path: nil) { why = "helper refused: \(w)"; close(fd); return nil }
    _ = writeLine(fd, #"{"hello":\#(PSVersion.mine)}"#)
    guard readable(fd, until: until) else { why = "the helper sent nothing"; close(fd); return nil }
    return fd
  }
  /// Waits for the first byte without reading it (false: timed out or the helper hung up).
  private static func readable(_ fd: Int32, until: Date) -> Bool {
    while Date() < until {
      var pfd = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
      let r = poll(&pfd, 1, 200)
      if r < 0 { return false }
      if r == 0 { continue }
      var b: UInt8 = 0
      return recv(fd, &b, 1, MSG_PEEK) == 1
    }
    return false
  }

  private static func finish(_ fd: Int32, _ j: UpdateJournal) {
    guard let line = readLine(fd, timeout: 3), let o = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any] else {
      psLog("PS update: the helper sent nothing readable"); close(fd); return
    }
    let remember = (o["remember"] as? String).flatMap { Data(base64Encoded: $0) }
    let locked = (o["locked"] as? String).flatMap { Data(base64Encoded: $0) }    // a PS locked with Touch ID stays locked
    let netmon = (o["netmon"] as? String).flatMap { Data(base64Encoded: $0) }
    let second = o["second"] as? [String: String] ?? [:]   // Second Computer's key, id and pairing (2 Nov 2026)
    let mail = o["mail"] as? [String: String] ?? [:]       // Reply from PS: Gmail and Instantly sign ins, replies waiting (V1.44)
    let tgbot = o["tgbot"] as? String                      // Add Telegram Bot: the bot key (V1.47)
    let taskapi = o["taskapi"] as? String                  // AI task API: its key
    let assist = o["assist"] as? [String: String]          // Settings assistant: the Claude and OpenAI keys (PS 1.65)
    var tgSaved = false
    let proton = o["proton"] as? String                    // Proton Mail through Bridge: the link (PS 1.65)
    var mailSaved = 0
    var secondSaved = 0
    if UpdatePaths.test {
      // Fictional data only: written to the test folder, never to the Keychain.
      secondSaved = SecondHandoff.save(second, into: SecondFileStore(dir: env["PS_SELFTEST"]! + "/child-second-keys"))
      let rec: [String: Any] = ["build": PSVersion.mine, "remember": remember?.base64EncodedString() ?? NSNull(), "locked": locked?.base64EncodedString() ?? NSNull(), "netmon": netmon?.base64EncodedString() ?? NSNull(),
                                "second": second, "secondSaved": secondSaved]
      if let d = try? JSONSerialization.data(withJSONObject: rec) { try? d.write(to: URL(fileURLWithPath: env["PS_SELFTEST"]!).appendingPathComponent("child-received.json")) }
    } else {
      if let remember { Remember.save(remember) } else if let locked { TouchLock.saveLocked(locked) }
      if let netmon, netmon.count == 32 { saveNetKey(netmon) }
      // Second Computer is the developer's alone: on anyone else's PS its items are never written, even when an older build
      // (V1.41 and before ran it for everyone) hands some over. They stay exactly where they are, never read.
      if !second.isEmpty && SecondKeychain.mayTouch { secondSaved = SecondHandoff.save(second, into: SecondKeychain()) }
      else if !second.isEmpty { psLog("PS update: Second Computer items not taken over (not the primary account's PS)") }
      // The linked Supabase project's access token, when one is kept (ProjectSetup.swift, 5 Nov 2026).
      if let t = o["sbtoken"] as? String, SupabaseAPI.validToken(t) { SupabaseToken.save(t) }
      // Local first (LocalKey.swift, V1.44): the local vault's key, saved as this build's own copy (the old one stays).
      if let k = (o["localkey"] as? String).flatMap({ Data(base64Encoded: $0) }), k.count == 32 { LocalKey.saveOwn(k) }
      mailSaved = MailSend.handoffSave(mail)
      tgSaved = TelegramBot.handoffSave(tgbot)
      ProtonBridge.handoffSave(proton)
      if TaskApi.handoffSave(taskapi) { psLog("PS update: AI task API key handed over") }
      AssistService.handoffSave(assist)
      if let c = o["srcloud"] as? [String: String] { ScreenRecCloud.handoffSave(c) }   // screen recorder cloud: logins and the sealing key (PS 1.60)
    }
    _ = writeLine(fd, #"{"saved":true}"#)
    psLog("PS update: sign in handed over from build \(j.from) (remember=\(remember == nil ? 0 : 1) locked=\(locked == nil ? 0 : 1) netmon=\(netmon == nil ? 0 : 1) second=\(secondSaved)/\(second.count) mail=\(mailSaved)/\(mail.count) tgbot=\(tgSaved ? 1 : 0) localkey=\(o["localkey"] == nil ? 0 : 1))")
    conn = fd
  }

  /// The new build has been running long enough: the helper can stop watching.
  static func reportHealthy() {
    waitDone(30)
    guard conn >= 0 else { return }
    _ = writeLine(conn, #"{"ok":true}"#)
    _ = readLine(conn, timeout: 2)   // the helper answers "bye"
    close(conn); conn = -1
  }

  /// The network monitor's history key, kept the same way NetKey (NetMonitor.swift) keeps it.
  static func saveNetKey(_ data: Data) {
    let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: NetKey.service, kSecAttrAccount as String: NetKey.account]
    KeychainQuiet.run {
      SecItemDelete(base as CFDictionary)
      var q = base
      q[kSecValueData as String] = data
      q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
      q[kSecAttrSynchronizable as String] = false
      q[kSecAttrLabel as String] = "PS network history key (this Mac only)"
      SecItemAdd(q as CFDictionary, nil)
    }
  }

  /// What the old build hands over (read off the main thread; the Keychain can stall).
  static func collect() -> Data {
    var o: [String: Any] = [:]
    if UpdatePaths.test {
      if let f = env["PS_SELFTEST_HANDOFF"], let d = FileManager.default.contents(atPath: f) { return d }   // fictional
    } else {
      if let r = Remember.read() { o["remember"] = r.base64EncodedString() }
      else if let l = TouchLock.readLocked() { o["locked"] = l.base64EncodedString() }   // locked: the new build stays locked
      if let k = NetKey.load() { o["netmon"] = k.withUnsafeBytes { Data($0) }.base64EncodedString() }
      // Second Computer's key, id and pairing (never re-paired): the developer only, like Second Computer itself. Anyone else's
      // PS never reads them (SecondKeychain.mayTouch), so no Keychain question can come from here.
      let second = SecondKeychain.mayTouch ? SecondHandoff.collect(SecondKeychain()) : [:]
      if !second.isEmpty { o["second"] = second }
      if let t = SupabaseToken.read() { o["sbtoken"] = t }   // a linked project's token: later releases can still update it
      if let k = LocalKey.collect() { o["localkey"] = k }      // local first: the key to the data on this Mac, so no Allow after updating
      let mail = MailSend.handoffCollect()   // Reply from PS: sign ins and the queue, so a scheduled reply survives the update
      if !mail.isEmpty { o["mail"] = mail }
      if let t = TelegramBot.handoffCollect() { o["tgbot"] = t }   // Add Telegram Bot: the bot key, so it keeps reading after the update
      if let p = ProtonBridge.handoffCollect() { o["proton"] = p }   // Proton Mail through Bridge: the link, so it keeps reading after the update
      if let k = TaskApi.handoffCollect() { o["taskapi"] = k }   // AI task API: the key, so AI tools keep working after the update
      if let a = AssistService.handoffCollect() { o["assist"] = a }   // Settings assistant: the API keys, so they survive the update
      let src = ScreenRecCloud.handoffCollect()   // screen recorder cloud: logins and the sealing key, so sealed recordings still open after the update
      if !src.isEmpty { o["srcloud"] = src }
    }
    return (try? JSONSerialization.data(withJSONObject: o)) ?? Data("{}".utf8)
  }
}

// MARK: - The helper (the old build's own binary, after the old PS quit)

enum UpdateHelper {
  static func log(_ s: String) { psLog("PS update helper: \(s)") }

  /// `--ps-update-helper <journal> <old pid>`, the sign in on stdin. Never returns.
  static func run(_ args: [String]) -> Never {
    guard let i = args.firstIndex(of: "--ps-update-helper"), args.count > i + 2,
          var j = UpdateJournal.read(URL(fileURLWithPath: args[i + 1])), let oldPid = Int32(args[i + 2]) else { log("bad arguments"); exit(2) }
    let journalURL = URL(fileURLWithPath: args[i + 1])
    let keys = FileHandle.standardInput.readDataToEndOfFile()
    log("started for build \(j.from) to \(j.to)")
    // 1. The old PS quits first (two copies must never run at once).
    //    (Only a real pid that still runs a PS build is ever signalled: SafeSignal.swift.)
    let until = Date().addingTimeInterval(15)
    let oldExe = [j.previous, j.target].map { $0 + "/Contents/MacOS/PS" }
    while SafeSignal.exists(oldPid) && Date() < until { usleep(50_000) }
    if SafeSignal.exists(oldPid) {
      log("old PS still running, asking it to quit")
      if SafeSignal.signal(oldPid, SIGTERM, expected: oldExe, why: "old PS did not quit for the update") { usleep(1_500_000) }
    }
    // 2. The private socket.
    let dir = (j.socket as NSString).deletingLastPathComponent
    mkdir(dir, 0o700); chmod(dir, 0o700)
    unlink(j.socket)
    let srv = socket(AF_UNIX, SOCK_STREAM, 0)
    guard srv >= 0, var a = UpdateHandoff.sockaddr(j.socket),
          withUnsafePointer(to: &a, { $0.withMemoryRebound(to: Darwin.sockaddr.self, capacity: 1) { bind(srv, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) } }) == 0,
          listen(srv, 4) == 0 else { log("no socket: \(String(cString: strerror(errno)))"); rollBack(&j, journalURL, pid: nil, why: "no socket") }
    chmod(j.socket, 0o600)
    defer { unlink(j.socket) }
    // 3. Start the new build. A real launch only reports back once the new PS has finished
    //    launching, so it runs beside the calls below, never before them (the 27 Oct 2026 bug).
    //    PS_SELFTEST_SYNCLAUNCH=1 starts it first instead, like the helper of build 2610270059.
    //    Its process id comes from macOS's launch report or, often sooner, from its call on the
    //    socket (27 Oct 2026, V1.09: the hand over finished before the launch report, and the helper
    //    took "no process id yet" for "did not start" and rolled back with the new build running).
    log("starting the new build")
    if j.test && ProcessInfo.processInfo.environment["PS_SELFTEST_SYNCLAUNCH"] == "1" {
      let r = launch(j, role: "new")
      lock.lock(); launchedPid = r.pid; launchFailed = !r.ok; launchDone = true; lock.unlock()
      guard r.ok else { rollBack(&j, journalURL, pid: nil, why: "the new build could not be started") }
      log("macOS reports the new build launched, pid \(r.pid.map(String.init) ?? "not known yet")")
    } else {
      Thread.detachNewThread {
        let r = launch(j, role: "new")
        lock.lock(); launchedPid = r.pid; launchFailed = !r.ok; launchDone = true; lock.unlock()
        log(r.ok ? "macOS reports the new build launched, pid \(r.pid.map(String.init) ?? "not known yet")" : "macOS could not launch the new build")
      }
    }
    func pid() -> Int32? { lock.lock(); defer { lock.unlock() }; return launchedPid ?? calledPid }
    func failed() -> Bool { lock.lock(); defer { lock.unlock() }; return launchFailed }
    // 4. The hand over (up to 30 seconds).
    var c: Int32 = -1, gaveKeys = false
    func healthy() -> Bool { UpdateJournal.read(journalURL)?.phase == "healthy" }
    let connectBy = Date().addingTimeInterval(30)
    // (A build that is already healthy still gets its sign in: the two do not wait on each other.)
    while c < 0 && Date() < connectBy {
      if failed() { rollBack(&j, journalURL, pid: nil, why: "the new build could not be started") }
      if let p = pid(), !alive(p) { if healthy() { break }; rollBack(&j, journalURL, pid: nil, why: "the new build quit while starting") }
      var pfd = pollfd(fd: srv, events: Int16(POLLIN), revents: 0)
      guard poll(&pfd, 1, 250) > 0 else { continue }
      let s = accept(srv, nil, nil)
      if s < 0 { continue }
      if let why = UpdateHandoff.peerProblem(s, path: j.target) { log("refused a connection: \(why)"); close(s); continue }
      if let pp = UpdateHandoff.peerPid(s) { lock.lock(); calledPid = pp; lock.unlock(); log("the new build called, pid \(pp)") }
      guard UpdateHandoff.readLine(s, timeout: 3) != nil else { close(s); continue }
      _ = UpdateHandoff.writeLine(s, String(decoding: keys.isEmpty ? Data("{}".utf8) : keys, as: UTF8.self))
      gaveKeys = UpdateHandoff.readLine(s, timeout: 5)?.contains("saved") == true
      log("sign in handed over: \(gaveKeys ? "saved" : "not confirmed")")
      c = s
    }
    // No process id yet (no call, launch report still on its way): wait for the report.
    let reportBy = Date().addingTimeInterval(20)
    while pid() == nil && !failed() && Date() < reportBy { lock.lock(); let done = launchDone; lock.unlock(); if done { break }; usleep(100_000) }
    guard let p = pid() else { rollBack(&j, journalURL, pid: nil, why: failed() ? "the new build could not be started" : "the new build never showed up") }
    if c < 0 && !healthy() { log("no sign in hand over; watching the new build anyway") }
    // 5. Health, separate from the hand over: the page loaded and the keyboard tap is up (the
    //    journal says "healthy", or the "ok" on the socket). Not there within 90 seconds of the
    //    swap, or the new build quits first: roll back. Whether the sign in came over plays no part.
    let healthBy = Date().addingTimeInterval(j.test ? Double(ProcessInfo.processInfo.environment["PS_SELFTEST_HEALTHWAIT"] ?? "") ?? 60 : 60)
    var okSaid = false
    while !okSaid && !healthy() {
      if !alive(p) { if healthy() { break }; if c >= 0 { close(c) }; rollBack(&j, journalURL, pid: nil, why: "the new build quit while starting") }
      if Date() > healthBy { if c >= 0 { close(c) }; rollBack(&j, journalURL, pid: p, why: "the new build did not finish starting (page and keyboard tap) within 90 seconds") }
      if c >= 0 {
        let t = Date()
        if let l = UpdateHandoff.readLine(c, timeout: 0.5) {
          if l.contains("\"ok\"") { _ = UpdateHandoff.writeLine(c, #"{"bye":true}"#); okSaid = true }
        } else if Date().timeIntervalSince(t) < 0.4 { close(c); c = -1 }      // it hung up (it can still write "healthy")
      } else { usleep(250_000) }
    }
    if c >= 0 { close(c) }
    j.phase = "ok"; j.write(journalURL)
    log("new build \(j.to) is running: done" + (gaveKeys ? "" : " (no sign in handed over)"))
    exit(0)
  }

  static let lock = NSLock()
  static var launchedPid: Int32?, calledPid: Int32?, launchFailed = false, launchDone = false
  static var children = Set<Int32>()
  static func alive(_ pid: Int32) -> Bool {
    guard SafeSignal.usable(pid) else { return false }
    lock.lock(); let child = children.contains(pid); lock.unlock()
    if child {
      var st: Int32 = 0
      let r = waitpid(pid, &st, WNOHANG)
      if r == pid { lock.lock(); children.remove(pid); lock.unlock(); return false }
    }
    return SafeSignal.exists(pid)
  }

  /// Starts the installed PS: as a real app for the developer; a test copy instead runs it as a hidden
  /// child that only does the hand over (never a second full PS, never a window).
  /// Starts a build. `ok`: macOS started it; `pid`: its process id when known (nil, never -1 or 0,
  /// when macOS reports none yet: the socket call usually tells it sooner).
  static func launch(_ j: UpdateJournal, role: String) -> (ok: Bool, pid: Int32?) {
    let app = URL(fileURLWithPath: j.target)
    if j.test && ProcessInfo.processInfo.environment["PS_SELFTEST_LSLAUNCH"] != "1" {
      let p = Process()
      p.executableURL = app.appendingPathComponent("Contents/MacOS/PS")
      var e = ProcessInfo.processInfo.environment
      e["PS_SELFTEST_CHILD"] = "1"; e["PS_SELFTEST_CHILD_ROLE"] = role
      e.removeValue(forKey: "PS_SELFTEST_MYBUILD")
      if role != "new" { e.removeValue(forKey: "PS_SELFTEST_CHILD_FAIL") }
      p.environment = e
      p.standardOutput = FileHandle.standardOutput; p.standardError = FileHandle.standardError
      let checkin = URL(fileURLWithPath: e["PS_SELFTEST"]!).appendingPathComponent("child-checkin")
      try? FileManager.default.removeItem(at: checkin)
      guard (try? p.run()) != nil, SafeSignal.usable(p.processIdentifier) else { return (false, nil) }
      lock.lock(); children.insert(p.processIdentifier); lock.unlock()
      // Like a real launch: report back only once the new PS has finished launching.
      if role == "new" && e["PS_SELFTEST_SYNCLAUNCH"] == "1" {
        let until = Date().addingTimeInterval(20)
        while p.isRunning && Date() < until && !FileManager.default.fileExists(atPath: checkin.path) { usleep(50_000) }
      }
      return (true, p.processIdentifier)
    }
    let c = NSWorkspace.OpenConfiguration()
    c.arguments = role == "new" ? ["--ps-updated"] : ["--ps-rolled-back"]
    c.createsNewApplicationInstance = true
    if j.test {
      // PS_SELFTEST_LSLAUNCH=1: a test child started the way the developer's PS is (macOS reports it once it
      // has finished launching), never shown, never in front.
      var e = ProcessInfo.processInfo.environment
      e["PS_SELFTEST_CHILD"] = "1"; e["PS_SELFTEST_CHILD_ROLE"] = role
      // macOS adds these to the helper's own environment rather than replacing it: blank, not removed.
      e["PS_SELFTEST_MYBUILD"] = ""
      if role != "new" { e["PS_SELFTEST_CHILD_FAIL"] = ""; e["PS_SELFTEST_CHILD_HANG"] = "" }
      c.environment = e
      c.activates = false; c.addsToRecentItems = false
    }
    let s = DispatchSemaphore(value: 0)
    var pid: Int32?, ok = false
    NSWorkspace.shared.openApplication(at: app, configuration: c) { ra, err in
      // -1 (or 0) means macOS does not know it yet: never a pid to act on.
      ok = ra != nil
      if let raw = ra?.processIdentifier {
        pid = SafeSignal.usable(raw) ? raw : nil
        if pid == nil { log("macOS reported pid \(raw) for the \(role) build: not known yet, never acted on") }
      }
      if let err { log("could not open \(app.path): \(err.localizedDescription)") }
      s.signal()
    }
    // No answer in 20 s: it may still be starting (the socket call or a later check will tell).
    let answered = s.wait(timeout: .now() + 20) == .success
    return (ok || !answered, pid)
  }

  /// The previous build goes back into place and starts; the one that failed is kept aside.
  static func rollBack(_ j: inout UpdateJournal, _ url: URL, pid: Int32?, why: String) -> Never {
    log("rolling back: \(why)")
    stopNewBuild(j, known: pid)                // first: two PS must never run at once
    restore(&j, url, why: why)
    _ = launch(j, role: "restored")
    exit(1)
  }
  /// Stops every copy of the new build and waits until they are gone: the one we know, the one macOS
  /// may still be reporting (waited for), and (for the developer) any PS running from Applications or the
  /// update folders. Test copies elsewhere on the Mac are never touched.
  static func stopNewBuild(_ j: UpdateJournal, known: Int32?) {
    let reportBy = Date().addingTimeInterval(10)
    while Date() < reportBy { lock.lock(); let done = launchDone; lock.unlock(); if done { break }; usleep(100_000) }
    // Only the new build itself: a pid above 1, not this helper, running exactly the new build's
    // executable (the installed PS.app, before the old one goes back), checked right before each
    // signal (SafeSignal). Candidates: the pids we were told, plus any PS app macOS lists.
    let exe = j.target + "/Contents/MacOS/PS"
    lock.lock()
    var pids = Set([known, launchedPid, calledPid].compactMap { $0 }).union(children)
    lock.unlock()
    if !j.test {
      for a in NSRunningApplication.runningApplications(withBundleIdentifier: "com.cincee.ps") { pids.insert(a.processIdentifier) }
    }
    pids = pids.filter { SafeSignal.usable($0) && SafeSignal.runs($0, exe) }
    guard !pids.isEmpty else { return }
    var left: [Int32] = []
    for p in pids.sorted() {
      // A child we started ourselves is reaped as it goes (no zombie that looks alive).
      if !SafeSignal.stop(p, exe: exe, why: "stopping the new build before the old one goes back") && alive(p) { left.append(p) }
    }
    log("stopped the new build (pid \(pids.sorted().map(String.init).joined(separator: ", ")))" + (left.isEmpty ? "" : ", pid \(left) did not stop"))
  }

  /// Also used by a build that keeps crashing at launch with no helper left (UpdateBoot).
  static func restore(_ j: inout UpdateJournal, _ url: URL, why: String) {
    let fm = FileManager.default
    let target = URL(fileURLWithPath: j.target), prev = URL(fileURLWithPath: j.previous), failed = URL(fileURLWithPath: j.failed)
    guard fm.fileExists(atPath: prev.path) else { log("no previous build to go back to"); j.phase = "failed"; j.write(url); return }
    do {
      try UpdateFiles.swap(prev, target)          // previous now holds the build that failed
      try? fm.removeItem(at: failed)
      try? fm.createDirectory(at: failed.deletingLastPathComponent(), withIntermediateDirectories: true)
      try? fm.moveItem(at: prev, to: failed)
      j.phase = "rolledBack"; j.shown = false; j.write(url)
      log("back on build \(j.from); build \(j.to) kept aside (\(why))")
    } catch { log("roll back failed: \(error)"); j.phase = "failed"; j.write(url) }
  }
}

// MARK: - At launch, before anything else

enum UpdateBoot {
  /// Runs first in main.swift. The helper and test children never get further than this.
  static func early() {
    let args = CommandLine.arguments
    if args.contains("--ps-update-helper") { UpdateHelper.run(args) }
    let env = ProcessInfo.processInfo.environment
    if UpdatePaths.test && env["PS_SELFTEST_CHILD"] == "1" { testChild(env) }
    // One PS at a time (27 Oct 2026: a roll back left two running, two keyboard taps). A second
    // PS quits here, before any window, keyboard tap or hand over. The installer screen is exempt.
    // Renamed in Settings (AppRename.swift, V1.36): the copy that renamed itself is still quitting, so wait for it.
    if !UpdatePaths.test && !Installer.shouldRun() && !SingleInstance.take(wait: args.contains("--ps-renamed") ? 15 : 0) {
      psLog("PS: another PS is already running; this one quits (pid \(getpid()))"); exit(0)
    }
    guard var j = UpdateJournal.read(), j.phase == "swapped", j.to == PSVersion.mine,
          URL(fileURLWithPath: j.target).standardizedFileURL.path == Bundle.main.bundleURL.standardizedFileURL.path else { return }
    j.attempts += 1; j.write()
    if j.attempts > 3 {
      // Crashed at launch three times and no helper was left to notice: go back by ourselves.
      UpdateHelper.restore(&j, UpdatePaths.journal, why: "the new build kept stopping at launch")
      if j.phase == "rolledBack" {
        SingleInstance.release()               // the build going back in place takes it
        let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/bin/open"); p.arguments = ["-n", j.target, "--args", "--ps-rolled-back"]
        try? p.run(); p.waitUntilExit()
        exit(0)
      }
      return
    }
    UpdateHandoff.start(j)
  }

  /// Test copies: the "new" or "restored" build started by the helper (fictional data, no window).
  static func testChild(_ env: [String: String]) -> Never {
    let role = env["PS_SELFTEST_CHILD_ROLE"] ?? "?"
    let dir = URL(fileURLWithPath: env["PS_SELFTEST"]!)
    print("CHILD: \(role) build \(PSVersion.mine) from \(Bundle.main.bundlePath)")
    if role == "renamed" { try? Data(Bundle.main.bundlePath.utf8).write(to: dir.appendingPathComponent("child-renamed-path.txt")) }   // AppRename.swift
    if role == "new" && env["PS_SELFTEST_CHILD_FAIL"] == "1" { print("CHILD: failing on purpose"); exit(9) }
    // One PS at a time, as for the developer (the lock lives in the test folder).
    if !SingleInstance.take() {
      print("CHILD: \(role) refused, another PS holds the lock")
      try? Data().write(to: dir.appendingPathComponent("child-\(role)-refused")); exit(0)
    }
    let ls = env["PS_SELFTEST_LSLAUNCH"] == "1"
    func checkIn() {
      // What a real launch does: register with macOS (who reports it to the helper). Never shown.
      if ls { _ = NSApplication.shared; NSApp.setActivationPolicy(.prohibited); NSApp.finishLaunching() }
      try? Data().write(to: dir.appendingPathComponent("child-checkin"))
    }
    if role == "new" && env["PS_SELFTEST_CHILD_HANG"] == "1" {
      // Starts but never gets healthy: the helper must stop it before the old build comes back.
      try? Data("\(PSVersion.mine)".utf8).write(to: dir.appendingPathComponent("child-new.txt"))
      try? Data("\(getpid())".utf8).write(to: dir.appendingPathComponent("child-new.pid"))
      checkIn(); sleep(60); exit(0)
    }
    if role == "restored" {
      checkIn()
      // Was the new build still running when the old one came back? It must not be.
      if let s = try? String(contentsOf: dir.appendingPathComponent("child-new.pid"), encoding: .utf8), let p = Int32(s), SafeSignal.exists(p) {
        try? Data().write(to: dir.appendingPathComponent("child-two-at-once"))
      }
    }
    if role == "new", var j = UpdateJournal.read(), j.phase == "swapped", j.to == PSVersion.mine {
      j.attempts += 1; j.write()
      // PS_SELFTEST_CHILD_NOHANDOVER=1: a healthy build that never takes the hand over.
      let handover = env["PS_SELFTEST_CHILD_NOHANDOVER"] != "1"
      if handover { UpdateHandoff.start(j) }
      // What a real app does next: finish launching (the helper hears of it), load the page, put
      // up the keyboard tap (Updater.markHealthy), then say "ok". A real launch takes a moment
      // (PS_SELFTEST_CHECKIN_DELAY): the hand over is often done before macOS reports the launch.
      if let d = Double(env["PS_SELFTEST_CHECKIN_DELAY"] ?? "") { usleep(useconds_t(d * 1_000_000)) }
      checkIn()
      try? Data("\(PSVersion.mine)".utf8).write(to: dir.appendingPathComponent("child-new.txt"))
      if !handover { sleep(2) }
      Updater.markHealthy(PSVersion.mine)
      UpdateHandoff.reportHealthy()
      if !handover { sleep(2) }
    }
    try? Data("\(PSVersion.mine)".utf8).write(to: dir.appendingPathComponent("child-\(role).txt"))
    exit(0)
  }
}

// MARK: - One PS at a time

enum SingleInstance {
  private static var fd: Int32 = -1
  /// Takes the PS lock (a file lock, freed by macOS the moment PS exits). False: another PS has it.
  /// `wait`: seconds to keep trying (only at launch, before any window: the renamed copy waits for the old one).
  static func take(wait: Double = 0) -> Bool {
    try? FileManager.default.createDirectory(at: UpdatePaths.support, withIntermediateDirectories: true)
    let f = open(UpdatePaths.support.appendingPathComponent("ps.lock").path, O_CREAT | O_RDWR | O_CLOEXEC, 0o600)
    guard f >= 0 else { return true }                    // cannot tell: never stop PS for that
    let until = Date().addingTimeInterval(wait)
    while flock(f, LOCK_EX | LOCK_NB) != 0 {
      if Date() >= until { close(f); return false }
      usleep(100_000)
    }
    fd = f
    return true
  }
  static func release() { if fd >= 0 { flock(fd, LOCK_UN); close(fd); fd = -1 } }
}
