import Foundation

// Activity monitor, the pure rules (PS 1.65, the developer's request of 17 Nov 2026). No windows, no clock, no reading of the
// Mac: ActivityMonitor.swift reads the numbers and hands them in here, tests/activity-test.swift checks every rule.
//
// What lives here: CPU percent from two samples (per core and per process), the memory sums, which process is a helper of which
// app (grouping), the golden rule filter (1Password and Signal dropped at the very first read), the End task rules, the sampling
// speeds, the launch agent reader, the app history tally and the made up numbers a self test copy shows.
enum ActivityCore {
  // ---------- sampling speed (seconds between samples, the person picks one) ----------
  static let speeds: [Double] = [0.5, 1, 2]
  static func cleanSpeed(_ v: Any?) -> Double {
    if let d = (v as? NSNumber)?.doubleValue, speeds.contains(d) { return d }
    return 1
  }

  // ---------- CPU ----------
  /// One core's tick counters (host_processor_info PROCESSOR_CPU_LOAD_INFO).
  struct Ticks: Equatable {
    var user: UInt64, system: UInt64, idle: UInt64, nice: UInt64
    var busy: UInt64 { user &+ system &+ nice }
    var total: UInt64 { busy &+ idle }
  }
  /// How busy one core was between two samples, 0 to 100. A counter that went backwards (a reset) reads as 0, never a spike.
  static func corePercent(_ a: Ticks, _ b: Ticks) -> Double {
    guard b.total > a.total, b.busy >= a.busy, b.idle >= a.idle else { return 0 }
    return min(100, max(0, Double(b.busy - a.busy) / Double(b.total - a.total) * 100))
  }
  /// The whole Mac between two samples: user, system and total percent (every core counted, so 100 means every core busy).
  static func overall(_ a: [Ticks], _ b: [Ticks]) -> (user: Double, system: Double, total: Double) {
    guard a.count == b.count, !a.isEmpty else { return (0, 0, 0) }
    var du = 0.0, ds = 0.0, dt = 0.0
    for (x, y) in zip(a, b) where y.total > x.total && y.busy >= x.busy {
      du += Double(y.user &- x.user) + Double(y.nice &- x.nice); ds += Double(y.system &- x.system); dt += Double(y.total - x.total)
    }
    guard dt > 0 else { return (0, 0, 0) }
    let u = min(100, du / dt * 100), s = min(100, ds / dt * 100)
    return (u, s, min(100, u + s))
  }
  /// rusage CPU times are in mach ticks (on Apple silicon 125/3 ns each), not nanoseconds.
  static func machNs(_ t: UInt64, numer: UInt32, denom: UInt32) -> Double {
    guard denom > 0 else { return Double(t) }
    return Double(t) * Double(numer) / Double(denom)
  }
  /// One process's share of the WHOLE Mac between two samples, 0 to 100, so the rows add up to the header's total (as the
  /// Processes table shows it). `cpuA`/`cpuB`: user + system time in mach ticks, `wallNs`: the wall time between the samples.
  static func processPercent(cpuA: UInt64, cpuB: UInt64, wallNs: Double, cores: Int, numer: UInt32, denom: UInt32) -> Double {
    guard cpuB >= cpuA, wallNs > 0, cores > 0 else { return 0 }
    let used = machNs(cpuB - cpuA, numer: numer, denom: denom)
    return min(100, max(0, used / (wallNs * Double(cores)) * 100))
  }
  /// Which cores are efficiency and which are performance. macOS numbers the efficiency cores first.
  static func coreKinds(total: Int, performance: Int, efficiency: Int) -> [String] {
    guard total > 0 else { return [] }
    guard performance > 0, efficiency > 0, performance + efficiency == total else { return Array(repeating: "", count: total) }
    return Array(repeating: "e", count: efficiency) + Array(repeating: "p", count: performance)
  }

  // ---------- memory ----------
  /// The counters of host_statistics64 HOST_VM_INFO64 that matter, in pages.
  struct VM: Equatable {
    var pageSize: UInt64
    var free: UInt64 = 0, wired: UInt64 = 0, compressor: UInt64 = 0, purgeable: UInt64 = 0, external: UInt64 = 0, internalPages: UInt64 = 0, speculative: UInt64 = 0
  }
  struct Memory: Equatable {
    var total: UInt64, used: UInt64, app: UInt64, wired: UInt64, compressed: UInt64, cached: UInt64, free: UInt64
    var swapUsed: UInt64, swapTotal: UInt64
    var pressure: String
  }
  /// The sums the way macOS's own monitor makes them: app memory is anonymous memory that cannot be thrown away, used is
  /// app + wired + compressed, cached files can be given back at once, free is whatever is left of the total.
  static func memory(_ vm: VM, total: UInt64, swapUsed: UInt64, swapTotal: UInt64, pressureLevel: Int) -> Memory {
    let p = vm.pageSize
    let app = (vm.internalPages > vm.purgeable ? vm.internalPages - vm.purgeable : 0) * p
    let wired = vm.wired * p, compressed = vm.compressor * p
    let cached = (vm.external + vm.purgeable) * p
    let used = min(total, app + wired + compressed)
    let free = total > used + cached ? total - used - cached : 0
    return Memory(total: total, used: used, app: app, wired: wired, compressed: compressed, cached: min(cached, total - used), free: free,
                  swapUsed: swapUsed, swapTotal: swapTotal, pressure: pressureWord(pressureLevel))
  }
  /// kern.memorystatus_vm_pressure_level: 1 normal, 2 warning, 4 critical (anything else reads as normal).
  static func pressureWord(_ level: Int) -> String { level == 4 ? "critical" : level == 2 ? "warn" : "normal" }

  // ---------- disk ----------
  /// Active time: how much of the wall time the disk spent busy reading or writing, 0 to 100 (nil when the driver does not say).
  static func diskActive(busyNsA: UInt64?, busyNsB: UInt64?, wallNs: Double) -> Double? {
    guard let a = busyNsA, let b = busyNsB, wallNs > 0 else { return nil }
    guard b >= a else { return 0 }
    return min(100, Double(b - a) / wallNs * 100)
  }
  /// Bytes per second from two counters (a counter that went backwards reads as 0).
  static func rate(_ a: UInt64, _ b: UInt64, seconds: Double) -> Double { b >= a && seconds > 0 ? Double(b - a) / seconds : 0 }

  // ---------- battery ----------
  /// Health as a percent of the design capacity (nil when the battery does not say).
  static func batteryHealth(rawMax: Int?, design: Int?) -> Int? {
    guard let r = rawMax, let d = design, d > 0, r > 0 else { return nil }
    return min(100, Int((Double(r) / Double(d) * 100).rounded()))
  }
  /// Watts from millivolts and milliamps (negative amps: the battery is being drained). Always a positive number.
  static func watts(mV: Int?, mA: Int?) -> Double? {
    guard let v = mV, let a = mA, v > 0, a != 0 else { return nil }
    return abs(Double(v) * Double(a)) / 1_000_000
  }
  /// IOPowerSources time left in minutes: -1 means "still working it out", which shows as nothing.
  static func minutes(_ v: Int?) -> Int? { guard let v, v >= 0, v < 24 * 60 else { return nil }; return v }

  // ---------- processes ----------
  struct Proc: Equatable {
    var pid: Int32
    var ppid: Int32
    /// The process macOS holds responsible (an app for its helpers), the pid itself when none is known.
    var rpid: Int32
    var uid: UInt32
    var name: String
    var path: String?
    /// The bundle ids of every .app the path goes through, outermost first.
    var bundles: [String] = []
    /// The outermost .app the path goes through.
    var appPath: String?
    /// An app with a window of its own (a Dock app).
    var regular: Bool = false
  }

  /// THE GOLDEN RULE: 1Password and Signal, by name, path or any bundle id on the path. Checked before anything else is read.
  static func isProtected(name: String?, path: String?, bundles: [String] = []) -> Bool {
    Protected.matches(name) || Protected.matches(path) || bundles.contains { Protected.matches($0) }
  }

  /// macOS's own processes: Apple bundles outside /Applications, or programs in the system folders (the same rule as the Network monitor).
  static func isSystem(path: String?, bundle: String?) -> Bool {
    let p = path ?? ""
    if let b = bundle, b.hasPrefix("com.apple.") { return !p.hasPrefix("/Applications/") }
    if p.isEmpty { return true }   // a path macOS will not tell: treat as the system's
    return ["/System/", "/usr/libexec/", "/usr/sbin/", "/usr/bin/", "/sbin/", "/bin/", "/Library/Apple/", "/private/var/", "/Library/Developer/CommandLineTools/"].contains { p.hasPrefix($0) }
  }

  /// The row each process folds under: pid -> its group's top pid (absent: the process is a row of its own).
  /// A Dock app is always a row of its own. A helper goes under the app macOS holds responsible for it, else under the app whose
  /// bundle holds its program (Brave Helper inside Brave.app), else under the nearest Dock app among its parents. Background
  /// processes with no app stay rows of their own. Never a loop, never more than 12 steps.
  static func groups(_ procs: [Proc]) -> [Int32: Int32] {
    var byPid: [Int32: Proc] = [:]
    for p in procs { byPid[p.pid] = p }
    var appByPath: [String: Int32] = [:]
    for p in procs where p.regular { if let a = p.appPath, appByPath[a] == nil || p.pid < appByPath[a]! { appByPath[a] = p.pid } }
    func isApp(_ pid: Int32) -> Bool { byPid[pid]?.regular == true }
    var out: [Int32: Int32] = [:]
    for p in procs where !p.regular {
      var top: Int32?
      if p.rpid != p.pid, p.rpid > 1, isApp(p.rpid) { top = p.rpid }
      if top == nil, let a = p.appPath, let owner = appByPath[a], owner != p.pid { top = owner }
      if top == nil {
        var cur = p.ppid, steps = 0, seen: Set<Int32> = [p.pid]
        while cur > 1, steps < 12, !seen.contains(cur), let q = byPid[cur] {
          if q.regular { top = q.pid; break }
          seen.insert(cur); cur = q.ppid; steps += 1
        }
      }
      if let t = top { out[p.pid] = t }
    }
    return out
  }

  /// The processes the screen may hold: this user's only, and the golden rule applied at the first read, helpers of a protected
  /// app included (a process whose responsible process or parent is 1Password or Signal goes too). `protectedPids`: pids
  /// already dropped by name or path at the read (only their numbers are kept, for this one sample, never their names).
  /// `named`: the caller already dropped every process whose own name, path or bundles match (the reader does, at the read), so only
  /// the responsible process and the parents are checked here.
  static func keep(_ procs: [Proc], myUid: UInt32, protectedPids: Set<Int32>, named: Bool = false) -> [Proc] {
    var drop = protectedPids
    if !named { for p in procs where isProtected(name: p.name, path: p.path, bundles: p.bundles) { drop.insert(p.pid) } }
    let byPid = Dictionary(procs.map { ($0.pid, $0) }, uniquingKeysWith: { a, _ in a })
    func tainted(_ p: Proc) -> Bool {
      if drop.contains(p.rpid) { return true }
      var cur = p.ppid, steps = 0
      while cur > 1, steps < 12 { if drop.contains(cur) { return true }; guard let q = byPid[cur] else { break }; cur = q.ppid; steps += 1 }
      return false
    }
    return procs.filter { $0.uid == myUid && !drop.contains($0.pid) && !tainted($0) }
  }

  // ---------- End task ----------
  /// May PS end this process? Only the person's own, never pid 0 or 1, never macOS's own processes, never PS itself, its
  /// helpers or anything that folds under PS, never 1Password or Signal (they never reach the list at all).
  struct EndFacts {
    var pid: Int32, uid: UInt32, myUid: UInt32, myPid: Int32
    var path: String?, bundle: String?, name: String
    var groupTop: Int32?
    var psBundlePath: String, psBundleId: String
  }
  static func canEnd(_ f: EndFacts) -> Bool {
    guard f.pid > 1, f.uid == f.myUid, f.pid != f.myPid else { return false }
    if let t = f.groupTop, t == f.myPid { return false }
    if isProtected(name: f.name, path: f.path, bundles: f.bundle.map { [$0] } ?? []) { return false }
    if isPS(path: f.path, bundle: f.bundle, psBundlePath: f.psBundlePath, psBundleId: f.psBundleId) { return false }
    if isSystem(path: f.path, bundle: f.bundle) { return false }
    return true
  }
  /// PS, a test copy of PS, or any helper inside PS's bundle.
  static func isPS(path: String?, bundle: String?, psBundlePath: String, psBundleId: String) -> Bool {
    let base = psBundlePath.hasSuffix("/") ? psBundlePath : psBundlePath + "/"
    if let p = path, !psBundlePath.isEmpty, p.hasPrefix(base) || p == psBundlePath { return true }
    if let b = bundle?.lowercased(), !psBundleId.isEmpty, b == psBundleId.lowercased() || b.hasPrefix(psBundleId.lowercased() + ".") { return true }
    return false
  }
  /// The two steps of End task: a normal quit first, a force quit only after a second click.
  enum EndStep: String { case quit, force }
  static func endStep(_ s: Any?) -> EndStep? { (s as? String).flatMap(EndStep.init(rawValue:)) }

  // ---------- startup items ----------
  struct Startup: Equatable {
    var label: String, program: String, folder: String, runAtLoad: Bool, keepAlive: Bool, disabled: Bool
  }
  /// One launch agent's plist, or nil when it is not one PS may show (unreadable, no program, 1Password or Signal).
  static func launchAgent(_ plist: [String: Any], file: String, folder: String) -> Startup? {
    let label = plist["Label"] as? String ?? (file as NSString).deletingPathExtension
    let program = (plist["Program"] as? String) ?? ((plist["ProgramArguments"] as? [Any])?.first as? String) ?? ""
    if isProtected(name: label, path: program) || isProtected(name: file, path: nil) { return nil }
    guard !program.isEmpty || !label.isEmpty else { return nil }
    let keep: Bool = (plist["KeepAlive"] as? Bool) ?? (plist["KeepAlive"] is [String: Any])
    return Startup(label: label, program: program, folder: folder, runAtLoad: plist["RunAtLoad"] as? Bool ?? false, keepAlive: keep, disabled: plist["Disabled"] as? Bool ?? false)
  }
  /// The outermost .app a program path goes through (for its name and icon), nil when none.
  static func appOf(_ path: String) -> String? {
    guard let r = path.range(of: ".app/") ?? (path.hasSuffix(".app") ? path.range(of: ".app") : nil) else { return nil }
    return String(path[..<r.upperBound]).replacingOccurrences(of: ".app/", with: ".app")
  }

  // ---------- app history (CPU time per app per day) ----------
  /// day -> app key -> (name, CPU seconds). Kept 8 days. Protected names never get in (checked again here).
  typealias History = [String: [String: HistoryApp]]
  struct HistoryApp: Equatable { var name: String; var secs: Double }
  static func add(_ h: inout History, day: String, key: String, name: String, secs: Double) {
    guard secs > 0, secs.isFinite, !isProtected(name: key, path: nil), !isProtected(name: name, path: nil) else { return }
    var d = h[day] ?? [:]
    let cur = d[key]?.secs ?? 0
    d[key] = HistoryApp(name: name, secs: cur + min(secs, 86_400))
    h[day] = d
  }
  static func trim(_ h: History, keep days: Set<String>) -> History { h.filter { days.contains($0.key) } }

  // ---------- the island readout ----------
  /// The tiny live readout beside the island: "23%" and "61%" (memory used of the total).
  static func readout(cpu: Double, used: UInt64, total: UInt64) -> (cpu: String, mem: String) {
    let c = Int(min(100, max(0, cpu)).rounded())
    let m = total > 0 ? Int((Double(used) / Double(total) * 100).rounded()) : 0
    return ("\(c)%", "\(min(100, max(0, m)))%")
  }

  // ---------- made up numbers (a self test copy never reads real processes) ----------
  /// A whole snapshot of fictional numbers that move smoothly with `t` (seconds). Names are invented, never a real person's.
  static func fake(t: Double) -> [String: Any] {
    func wave(_ k: Double, _ lo: Double, _ hi: Double) -> Double { lo + (hi - lo) * (0.5 + 0.5 * sin(t * k)) }
    let cores = (0..<10).map { i in wave(0.7 + Double(i) * 0.13, 2, i < 6 ? 35 : 70) }
    let total = cores.reduce(0, +) / Double(cores.count)
    let gb: UInt64 = 1 << 30
    let apps: [(Int32, String, String, Bool, Double, Double)] = [
      (501, "Sample Browser", "com.example.browser", true, wave(0.9, 3, 18), 1.4), (502, "Sample Notes", "com.example.notes", true, wave(0.4, 0.2, 2), 0.3),
      (503, "Sample Music", "com.example.music", true, wave(0.6, 1, 4), 0.5), (504, "Sample Editor", "com.example.editor", true, wave(1.1, 2, 9), 0.9),
      (601, "Sample Browser Helper", "com.example.browser.helper", false, wave(1.3, 1, 6), 0.6), (602, "sampled", "", false, wave(0.5, 0, 3), 0.05),
      (603, "indexerd", "", false, wave(0.3, 0, 1.5), 0.02), (604, "syncagent", "", false, wave(0.8, 0, 2), 0.04)]
    var rows: [[Double]] = [], meta: [String: [String: Any]] = [:]
    for a in apps {
      rows.append([Double(a.0), (a.4 * 10).rounded() / 10, a.5 * Double(gb), wave(1.7, 0, 4e6), wave(1.3, 0, 2e6), wave(0.9, 0, 9e5), wave(1.1, 0, 2e5), a.4 * 0.05, 12])
      meta["\(a.0)"] = ["n": a.1, "id": a.2, "g": a.0 == 601 ? 501 : 0, "app": a.3, "sys": false, "end": true, "st": 1_000 + Double(a.0)]
    }
    return ["kind": "snap", "fake": true, "at": t * 1000, "dt": 1,
            "cpu": ["t": total, "u": total * 0.7, "s": total * 0.3, "cores": cores, "kinds": coreKinds(total: 10, performance: 4, efficiency: 6), "name": "Sample chip", "up": 86_400 * 3 + t, "procs": 640, "thr": 3100],
            "mem": ["total": 16 * gb, "used": UInt64(wave(0.2, 9, 12) * Double(gb)), "app": 6 * gb, "wired": 2 * gb, "comp": gb, "cached": 3 * gb, "free": 2 * gb, "swap": gb / 2, "swapT": 2 * gb, "press": "normal"],
            "disk": ["r": wave(0.9, 0, 4e7), "w": wave(0.6, 0, 2e7), "act": wave(0.8, 0, 30), "vols": [["n": "Sample Disk", "total": 512 * gb, "free": 210 * gb]]],
            "net": ["on": true, "ifs": [["n": "en0", "l": "Wi-Fi", "k": "wifi", "rx": wave(1.0, 1e4, 3e6), "tx": wave(0.7, 1e3, 4e5)], ["n": "utun4", "l": "VPN", "k": "vpn", "rx": wave(1.0, 1e4, 2e6), "tx": wave(0.7, 1e3, 3e5)]]],
            "gpu": ["u": wave(0.5, 3, 40), "name": "Sample GPU"],
            "bat": ["pct": 76, "charging": false, "ac": false, "health": 96, "cycles": 115, "mins": 312, "watts": wave(0.4, 4, 14)],
            "rows": rows, "meta": meta, "gone": [Int](), "self": ["ms": 2.5, "cpu": 0.4]]
  }
}
