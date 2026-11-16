// Outsource work to your other computer (PS 1.65), the runner that does the job on the OTHER computer.
// Foundation only (no app, no page): tests run it with a fake `claude` script and a temp git repo.
// One job at a time on its own serial queue (nothing on the main thread). Every child process starts in its own
// session so a timeout or a cancel ends the whole tree, not just the first process. The AI works in a git worktree of
// PS's OWN clone under the PS folder (never the person's own repository), on a fresh branch at the base commit.
// Walls against pushing: the tool's own deny flags (OutPolicy), a pre-push hook that always fails, a push URL that goes
// nowhere, refusing stand ins for gh and deploy tools first on PATH, and tokens dropped from the environment.
import Foundation

struct OutDone {
  var id: String
  var state: String                 // done, failed, cancelled, timeout
  var report: OutReport
  var bundlePath: String?
  var bundleSha: String?
  var bundleSize: Int
  var shotPaths: [String]
}

struct OutTools {
  var claude: String?
  var codex: String?
  var git: String
  var perl = "/usr/bin/perl"
  /// The names found and usable: "claude", "codex", "git" (web OtherStatus.tools).
  var names: [String] { (claude != nil ? ["claude"] : []) + (codex != nil ? ["codex"] : []) + (FileManager.default.isExecutableFile(atPath: git) ? ["git"] : []) }

  /// Looks for the tools. `override` is for tests (a fake script standing in for each).
  static func find(home: String = NSHomeDirectory(), path: String = ProcessInfo.processInfo.environment["PATH"] ?? "",
                   override: [String: String] = [:], fm: FileManager = .default) -> OutTools {
    func look(_ name: String, extra: [String]) -> String? {
      if let o = override[name] { return fm.isExecutableFile(atPath: o) ? o : nil }
      let dirs = path.split(separator: ":").map(String.init) + extra
      for d in dirs { let p = d + "/" + name; if fm.isExecutableFile(atPath: p) { return p } }
      return nil
    }
    let extra = [home + "/.local/bin", home + "/.claude/local", "/opt/homebrew/bin", "/usr/local/bin", home + "/.npm-global/bin"]
    // Signed in: a tool with no sign in only fails the job later, so it is not offered. Files are only checked for existing.
    var claude = look("claude", extra: extra)
    if override["claude"] == nil, claude != nil, !fm.fileExists(atPath: home + "/.claude.json") && !fm.fileExists(atPath: home + "/.claude") { claude = nil }
    var codex = look("codex", extra: extra)
    if override["codex"] == nil, codex != nil, !fm.fileExists(atPath: home + "/.codex/auth.json") { codex = nil }
    return OutTools(claude: claude, codex: codex, git: override["git"] ?? "/usr/bin/git")
  }
}

/// One child process in its own session, output to a file (never a pipe that could fill and stall), killed on a timeout or a cancel.
final class OutProc {
  struct Result { var exit: Int32; var timedOut: Bool; var cancelled: Bool }
  private let lock = NSLock()
  private var pid: pid_t = 0
  private(set) var cancelled = false

  func cancel() {
    lock.lock(); cancelled = true; let p = pid; lock.unlock()
    if p > 0 { OutProc.killGroup(p) }
  }
  static func killGroup(_ p: pid_t) {
    kill(-p, SIGTERM)
    DispatchQueue.global().asyncAfter(deadline: .now() + 3) { kill(-p, SIGKILL) }
    usleep(300_000)
    kill(-p, SIGKILL)   // the tree is gone before we go on; a second kill of nothing is harmless
  }

  func run(perl: String, exe: String, args: [String], cwd: String, env: [String: String], timeout: TimeInterval, out: String) -> Result {
    lock.lock(); if cancelled { lock.unlock(); return Result(exit: -1, timedOut: false, cancelled: true) }; lock.unlock()
    FileManager.default.createFile(atPath: out, contents: nil, attributes: [.posixPermissions: 0o600])
    guard let fh = FileHandle(forWritingAtPath: out) else { return Result(exit: -1, timedOut: false, cancelled: false) }
    defer { try? fh.close() }
    let p = Process()
    p.executableURL = URL(fileURLWithPath: perl)
    // setsid makes the child its own session and group leader: its pid is the group id we kill.
    p.arguments = ["-e", "use POSIX qw(setsid); setsid(); exec { $ARGV[0] } @ARGV or exit 127;", "--", exe] + args
    p.currentDirectoryURL = URL(fileURLWithPath: cwd)
    p.environment = env
    p.standardOutput = fh; p.standardError = fh; p.standardInput = FileHandle.nullDevice
    do { try p.run() } catch { return Result(exit: -1, timedOut: false, cancelled: false) }
    lock.lock(); pid = p.processIdentifier; let wasCancelled = cancelled; lock.unlock()
    if wasCancelled { OutProc.killGroup(p.processIdentifier) }
    var timedOut = false
    let t0 = Date()
    while p.isRunning {
      if Date().timeIntervalSince(t0) > timeout { timedOut = true; OutProc.killGroup(p.processIdentifier); break }
      usleep(100_000)
    }
    p.waitUntilExit()
    lock.lock(); let c = cancelled; pid = 0; lock.unlock()
    return Result(exit: p.terminationStatus, timedOut: timedOut, cancelled: c)
  }
}

final class OutRunner {
  let root: String          // the PS folder for this: repos/, jobs/, hooks/, shims/
  let home: String
  var tools: OutTools
  var searchDirs: [String]
  var baseEnv: [String: String]
  private let q = DispatchQueue(label: "ps.outsource.runner", qos: .utility)
  private let mu = NSLock()
  private var waiting = 0
  private var running: String?
  private var cancelledIds = Set<String>()
  private var current: OutProc?
  private var cancelFlag = false
  private let fm = FileManager.default

  init(root: String, home: String = NSHomeDirectory(), tools: OutTools, searchDirs: [String]? = nil, baseEnv: [String: String] = ProcessInfo.processInfo.environment) {
    self.root = root; self.home = home; self.tools = tools; self.baseEnv = baseEnv
    self.searchDirs = searchDirs ?? ["Developer", "Code", "Projects", "Documents/GitHub", "src", "dev"].map { home + "/" + $0 } + [root + "/sources"]
  }

  var busy: Bool { mu.lock(); defer { mu.unlock() }; return running != nil }
  var queueLength: Int { mu.lock(); defer { mu.unlock() }; return waiting }
  static let maxQueue = 5

  /// Queues a checked job. False when the queue is full (the page then tells the person). `progress` and `done` come from the runner's queue.
  func submit(_ job: OutJob, progress: @escaping (String, String) -> Void, done: @escaping (OutDone) -> Void) -> Bool {
    mu.lock()
    if waiting + (running == nil ? 0 : 1) >= OutRunner.maxQueue { mu.unlock(); return false }
    waiting += 1; mu.unlock()
    progress("queued", "")
    q.async { [self] in
      mu.lock(); waiting -= 1; running = job.id; cancelFlag = false; let skip = cancelledIds.remove(job.id) != nil; mu.unlock()
      let r = skip ? finish(job, state: "cancelled", note: "Cancelled before it started.", started: Date()) : execute(job, progress: progress)
      mu.lock(); running = nil; current = nil; mu.unlock()
      done(r)
    }
    return true
  }

  func cancel(_ id: String) {
    mu.lock()
    if running == id { cancelFlag = true; let c = current; mu.unlock(); c?.cancel() } else { cancelledIds.insert(id); mu.unlock() }
  }

  // MARK: the job

  private func jobDir(_ id: String) -> String { root + "/jobs/" + id }
  private func git(_ args: [String], cwd: String, timeout: TimeInterval = 120, env: [String: String]? = nil, out: String? = nil) -> (Int32, String) {
    let o = out ?? (root + "/jobs/.git-\(getpid())-\(UInt32.random(in: 0...UInt32.max)).log")
    let p = newProc()
    let r = p.run(perl: tools.perl, exe: tools.git, args: args, cwd: cwd, env: env ?? gitEnv(), timeout: timeout, out: o)
    let text = (try? String(contentsOfFile: o, encoding: .utf8)) ?? ""
    if out == nil { try? fm.removeItem(atPath: o) }
    return (r.exit, text.trimmingCharacters(in: .whitespacesAndNewlines))
  }
  private func gitEnv() -> [String: String] {
    var e = baseEnv
    e["GIT_TERMINAL_PROMPT"] = "0"; e["GIT_ASKPASS"] = "/usr/bin/true"
    e["HOME"] = home
    e["GIT_AUTHOR_NAME"] = "PS outsourced job"; e["GIT_COMMITTER_NAME"] = "PS outsourced job"
    e["GIT_AUTHOR_EMAIL"] = "ps-outsource@localhost"; e["GIT_COMMITTER_EMAIL"] = "ps-outsource@localhost"
    return e
  }

  private func execute(_ job: OutJob, progress: @escaping (String, String) -> Void) -> OutDone {
    let t0 = Date()
    let dir = jobDir(job.id), work = dir + "/work"
    prune()
    try? fm.removeItem(atPath: dir)
    do { try fm.createDirectory(atPath: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]) } catch { return finish(job, state: "failed", note: "Could not make the job folder.", started: t0) }
    func fail(_ note: String) -> OutDone { finish(job, state: "failed", note: note, started: t0) }

    guard let exe = (job.tool == "claude" ? tools.claude : tools.codex) else { return fail("\(job.tool) is not installed or not signed in on this computer.") }
    guard fm.isExecutableFile(atPath: tools.git) else { return fail("git is missing on this computer.") }

    // 1. PS's own clone.
    progress("running", "Getting the code")
    let name = OutSafe.cloneName(job.repo)
    let clone = root + "/repos/" + name
    try? fm.createDirectory(atPath: root + "/repos", withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    if !fm.fileExists(atPath: clone + "/.git") {
      var source = job.repo
      if OutSafe.folderName(job.repo) {
        guard let s = searchDirs.map({ $0 + "/" + job.repo }).first(where: { fm.fileExists(atPath: $0 + "/.git") }) else { return fail("This computer has no folder called \(job.repo).") }
        source = s
      }
      let (c, text) = git(["-c", "protocol.ext.allow=never", "clone", "--no-recurse-submodules", "--", source, clone], cwd: root, timeout: 600)
      if c != 0 { return fail("Could not copy the code: " + OutSecrets.tail(text, 300)) }
    } else {
      _ = git(["fetch", "--prune", "--no-recurse-submodules", "origin"], cwd: clone, timeout: 300)
    }
    if cancelledNow() { return finish(job, state: "cancelled", note: "Cancelled.", started: t0) }

    // 2. The walls.
    let hooks = root + "/hooks", shims = root + "/shims"
    setupWalls(hooks: hooks, shims: shims)
    _ = git(["config", "core.hooksPath", hooks], cwd: clone)
    _ = git(["config", "remote.origin.pushurl", OutPolicy.noPushURL], cwd: clone)
    _ = git(["config", "push.default", "nothing"], cwd: clone)
    let exclude = clone + "/.git/info/exclude"
    if let cur = try? String(contentsOfFile: exclude, encoding: .utf8), !cur.contains(".ps-outsource/") { try? (cur + "\n.ps-outsource/\n").write(toFile: exclude, atomically: true, encoding: .utf8) }
    else if !fm.fileExists(atPath: exclude) { try? fm.createDirectory(atPath: clone + "/.git/info", withIntermediateDirectories: true); try? ".ps-outsource/\n".write(toFile: exclude, atomically: true, encoding: .utf8) }

    // 3. The base commit and a fresh branch.
    var sha = ""
    for cand in [job.base, "origin/" + job.base] {
      let (c, o) = git(["rev-parse", "--verify", "--quiet", cand + "^{commit}"], cwd: clone)
      if c == 0, o.range(of: "^[0-9a-f]{40}$", options: .regularExpression) != nil { sha = o; break }
    }
    if sha.isEmpty { return fail("The base commit \(job.base) is not in this computer's copy of the code.") }
    let branch = "outsource/" + job.id
    _ = git(["worktree", "prune"], cwd: clone)
    _ = git(["branch", "-D", branch], cwd: clone)
    let (wc, wt) = git(["worktree", "add", "-b", branch, work, sha], cwd: clone)
    if wc != 0 { return fail("Could not start a branch: " + OutSecrets.tail(wt, 300)) }
    try? fm.createDirectory(atPath: work + "/.ps-outsource/shots", withIntermediateDirectories: true)

    // 4. The AI, with a time limit.
    progress("running", "\(job.tool) is working")
    let proc = newProc()
    let toolLog = dir + "/tool.log", lastMsg = dir + "/last-message.txt"
    let prompt = OutPolicy.fullPrompt(job)
    let args = job.tool == "claude" ? OutPolicy.claudeArgs(prompt: prompt) : OutPolicy.codexArgs(prompt: prompt, dir: work, lastMessage: lastMsg)
    let env = OutPolicy.env(base: baseEnv, shimDir: shims, hooksDir: hooks, home: home)
    let res = proc.run(perl: tools.perl, exe: exe, args: args, cwd: work, env: env, timeout: TimeInterval(job.minutes * 60), out: toolLog)
    let logText = (try? String(contentsOfFile: toolLog, encoding: .utf8)) ?? ""
    var summary = logText
    if job.tool == "codex", let m = try? String(contentsOfFile: lastMsg, encoding: .utf8), !m.isEmpty { summary = m }

    // 5. What it made.
    progress("running", "Collecting the result")
    let (dc, dirty) = git(["status", "--porcelain"], cwd: work)
    if dc == 0, !dirty.isEmpty {
      _ = git(["add", "-A"], cwd: work)
      _ = git(["commit", "-q", "-m", "Outsourced job: leftover changes"], cwd: work)
    }
    let (_, head) = git(["rev-parse", "HEAD"], cwd: work)
    let commits = Int(git(["rev-list", "--count", "\(sha)..HEAD"], cwd: work).1) ?? 0
    let stat = git(["diff", "--stat=100", "\(sha)..HEAD"], cwd: work).1.split(separator: "\n").prefix(30).map { String($0.prefix(120)) }

    var state = res.cancelled ? "cancelled" : res.timedOut ? "timeout" : res.exit == 0 ? "done" : "failed"
    var note = ""
    if res.timedOut { note = "Stopped after \(job.minutes) minutes." } else if res.cancelled { note = "Cancelled from the main computer." } else if res.exit != 0 { note = "\(job.tool) ended with an error (exit \(res.exit))." }

    var bundlePath: String?, bundleSha: String?, bundleSize = 0
    if job.bundle, commits > 0 {
      let b = dir + "/result.bundle"
      let (bc, bt) = git(["bundle", "create", b, branch, "^" + sha], cwd: clone)
      if bc == 0, git(["bundle", "verify", b], cwd: clone).0 == 0,
         let size = (try? fm.attributesOfItem(atPath: b))?[.size] as? Int {
        if size <= OutRunner.maxBundle { bundlePath = b; bundleSize = size; bundleSha = sha256(b) }
        else { note += " The result is too big to send back (\(size / 1_000_000) MB)."; if state == "done" { state = "failed" } }
      } else { note += " Could not pack the result: " + OutSecrets.tail(bt, 200); if state == "done" { state = "failed" } }
    }
    var shots: [String] = []
    if job.screenshots {
      let sd = work + "/.ps-outsource/shots"
      let names = ((try? fm.contentsOfDirectory(atPath: sd)) ?? []).filter { $0.lowercased().hasSuffix(".png") }.sorted().prefix(4)
      try? fm.createDirectory(atPath: dir + "/shots", withIntermediateDirectories: true)
      for n in names {
        let src = sd + "/" + n
        if let s = (try? fm.attributesOfItem(atPath: src))?[.size] as? Int, s <= 600_000, !n.contains("/") {
          let dst = dir + "/shots/" + OutRunner.cleanName(n)
          if (try? fm.copyItem(atPath: src, toPath: dst)) != nil { shots.append(dst) }
        }
      }
    }

    // 6. Clean up: the working folder goes, the branch stays in PS's clone, the bundle waits for the page.
    _ = git(["worktree", "remove", "--force", work], cwd: clone)
    try? fm.removeItem(atPath: work)

    let report = OutReport(id: job.id, title: job.title, state: state, tool: job.tool, branch: branch, base: sha, head: head, commits: commits,
                           files: stat, summary: OutSecrets.tail(summary, 3000), log: OutSecrets.tail(logText, 6000), exit: res.exit,
                           seconds: Int(Date().timeIntervalSince(t0)), note: note.trimmingCharacters(in: .whitespaces))
    try? report.json().write(toFile: dir + "/report.json", atomically: true, encoding: .utf8)
    return OutDone(id: job.id, state: state, report: report, bundlePath: bundlePath, bundleSha: bundleSha, bundleSize: bundleSize, shotPaths: shots)
  }

  static let maxBundle = 64 * 1024 * 1024
  static func cleanName(_ n: String) -> String {
    let s = String(n.unicodeScalars.filter { $0.value > 32 && $0.value < 127 && $0 != "/" && $0 != "\\" }.map(Character.init)).prefix(80)
    return s.isEmpty || s.hasPrefix(".") ? "shot.png" : String(s)
  }

  private func cancelledNow() -> Bool { mu.lock(); defer { mu.unlock() }; return cancelFlag }
  /// A process for the next step of the running job; born cancelled when the job was cancelled already.
  private func newProc() -> OutProc {
    let p = OutProc()
    mu.lock(); current = p; let c = cancelFlag; mu.unlock()
    if c { p.cancel() }
    return p
  }

  private func finish(_ job: OutJob, state: String, note: String, started: Date) -> OutDone {
    let r = OutReport(id: job.id, title: job.title, state: state, tool: job.tool, branch: "", base: "", head: "", commits: 0, files: [], summary: "", log: "",
                      exit: -1, seconds: Int(Date().timeIntervalSince(started)), note: note)
    return OutDone(id: job.id, state: state, report: r, bundlePath: nil, bundleSha: nil, bundleSize: 0, shotPaths: [])
  }

  private func setupWalls(hooks: String, shims: String) {
    for d in [hooks, shims] { try? fm.createDirectory(atPath: d, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]) }
    func put(_ path: String, _ text: String) {
      if (try? String(contentsOfFile: path, encoding: .utf8)) == text { return }
      try? text.write(toFile: path, atomically: true, encoding: .utf8)
      chmod(path, 0o755)
    }
    put(hooks + "/pre-push", OutPolicy.prePushHook)
    for n in OutPolicy.shimmed { put(shims + "/" + n, OutPolicy.shim(n)) }
  }

  /// Result folders older than two days go; the clones stay (a second job starts faster).
  func prune(now: Date = Date()) {
    let base = root + "/jobs"
    for n in (try? fm.contentsOfDirectory(atPath: base)) ?? [] {
      let p = base + "/" + n
      if let m = (try? fm.attributesOfItem(atPath: p))?[.modificationDate] as? Date, now.timeIntervalSince(m) > 48 * 3600 { try? fm.removeItem(atPath: p) }
    }
  }

  /// Reads one piece of the bundle (the page seals each piece); nil past the end.
  static func chunk(path: String, index: Int) -> Data? {
    guard let h = FileHandle(forReadingAtPath: path) else { return nil }
    defer { try? h.close() }
    do { try h.seek(toOffset: UInt64(index * OutChunks.size)); let d = try h.read(upToCount: OutChunks.size) ?? Data(); return d.isEmpty ? nil : d } catch { return nil }
  }

  private func sha256(_ path: String) -> String? {
    let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/bin/shasum"); p.arguments = ["-a", "256", path]
    let pipe = Pipe(); p.standardOutput = pipe; p.standardError = FileHandle.nullDevice
    do { try p.run() } catch { return nil }
    let d = pipe.fileHandleForReading.readDataToEndOfFile(); p.waitUntilExit()
    return String(data: d, encoding: .utf8)?.split(separator: " ").first.map(String.init)
  }
}
