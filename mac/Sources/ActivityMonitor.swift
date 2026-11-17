// Activity monitor (PS 1.65, the developer's request of 17 Nov 2026): what this Mac is doing right now, in the Tab list (the chart
// button next to Network). The pure rules are in ActivityCore.swift (tests/activity-test.sh); this file reads the Mac and hands the
// numbers to the page (web views/ActivityMonitor.tsx). It copies the Network monitor's whole pattern:
//
// - Everything runs as the person's own user: no admin password, no helper with system rights, no new permission prompt.
// - Nothing is read while the screen is closed. Open: one sample every 0.5, 1 or 2 seconds (the person picks), on this file's own
//   background queue. A sample still running when the next one is due is skipped, and one that runs long stops reading processes
//   (the rest wait for the next sample). The main thread only hands finished JSON to the page.
// - Nothing leaves the Mac: no vault, no Supabase, no server. Live numbers stay in memory.
// - GOLDEN RULE: 1Password and Signal are dropped at the very first read (a process's short name, then its path and every bundle id
//   on it, then anything macOS holds them responsible for), before any other number about them is read, kept or sent. Only the whole
//   Mac totals (CPU, memory, disk, network) include them, unavoidably.
// - End task: only the person's own processes, never macOS's own, PS or its helpers (ActivityCore.canEnd, checked again here on a
//   fresh read of the process right before anything is sent). A normal quit first, a force quit only after a second click.
// - A self test copy (PS_SELFTEST) shows made up numbers (ActivityCore.fake) and never reads a real process.
// - App history: CPU time per app per day rides screen time's minute (ScreenTime.swift), only while PS runs and screen time is on.
//   Kept on this Mac only (Application Support/PS/activity-history.json), 8 days, never a protected app.
import Cocoa
import IOKit
import IOKit.ps
import Darwin
import SystemConfiguration

final class ActivityMonitor {
  static let shared = ActivityMonitor()
  /// Hands JSON to the Tab list page (set by App; called on the main thread, only while open).
  var deliver: ((String) -> Void)?

  private let q = DispatchQueue(label: "PS activity monitor", qos: .utility)
  private let volQ = DispatchQueue(label: "PS activity volumes", qos: .utility)
  private var timer: DispatchSourceTimer?
  private var isOpen = false
  /// The page's switch (Settings, Mac, Activity monitor), sent on every change. Off: nothing runs at all.
  private var enabled = true
  private var speed = 1.0
  private let testDir = ProcessInfo.processInfo.environment["PS_SELFTEST"]
  private let born = Date()
  private var sampling = false

  // ---------- messages from the page ----------
  /// {type:"activity", op:"enable"|"open"|"close"|"speed"|"end"|"startup"|"history"|"loginItems"|"folded"}. Main thread.
  func handle(_ msg: [String: Any], overlay: NSWindow?) {
    let op = msg["op"] as? String ?? ""
    let featureOn = Features.on("activity-monitor")
    switch op {
    case "open":
      guard featureOn else { return }
      // The burst: the island squeezes and bounces, and the page unfolds the window from the island's place.
      let place = burstPlace(overlay)
      if place != nil { Island.shared.moment(.cardOut) }
      sendNow(["kind": "place", "place": place.map { $0 as Any } ?? NSNull()])
      ActivityIsland.shared.opened()
    case "folded":
      // The window folded back into the island: the island gulps it.
      if Island.shared.shapeOnScreen() != nil { Island.shared.moment(.cardBack) }
    case "loginItems":
      if let u = URL(string: "x-apple.systempreferences:com.apple.LoginItems-Settings.extension") { NSWorkspace.shared.open(u) }
      return
    case "close":
      ActivityIsland.shared.closed()
    default: break
    }
    let on = msg["on"] as? Bool, sp = msg["speed"], pid = (msg["pid"] as? NSNumber)?.int32Value, st = (msg["st"] as? NSNumber)?.doubleValue
    let step = ActivityCore.endStep(msg["step"])
    q.async { [self] in
      switch op {
      case "enable":
        guard let on, on != enabled else { return }
        enabled = on
        if !on { close() }
      case "open":
        guard enabled, featureOn else { return }
        isOpen = true
        speed = ActivityCore.cleanSpeed(sp)
        resetSamples()
        if testDir == nil { NetMonitor.shared.borrow(true) }
        reschedule()
        sample()
      case "close":
        close()
      case "speed":
        speed = ActivityCore.cleanSpeed(sp)
        if isOpen { reschedule() }
      case "end":
        guard isOpen, let pid, let st, let step else { return }
        end(pid: pid, start: st, step: step)
      case "startup":
        guard isOpen else { return }
        send(startupJSON())
      case "history":
        guard isOpen else { return }
        sendHistory()
      default: break
      }
    }
  }
  /// The Tab list went away: stop at once.
  func listHidden() {
    q.async { [self] in
      guard isOpen else { return }
      close()
      // The page closes its window too, so it never shows stale numbers when the list comes back.
      DispatchQueue.main.async { [weak self] in self?.deliver?("{\"kind\":\"hidden\"}") }
    }
    DispatchQueue.main.async { ActivityIsland.shared.closed() }
  }

  private func close() {
    isOpen = false
    reschedule()
    if testDir == nil { NetMonitor.shared.borrow(false) }
    resetSamples()
    DispatchQueue.main.async { ActivityIsland.shared.closed() }
  }
  private func reschedule() {
    timer?.cancel(); timer = nil
    guard isOpen, enabled else { return }
    let t = DispatchSource.makeTimerSource(queue: q)
    let ms = Int(speed * 1000)
    t.schedule(deadline: .now() + .milliseconds(ms), repeating: .milliseconds(ms), leeway: .milliseconds(max(40, ms / 10)))
    t.setEventHandler { [weak self] in self?.sample() }
    t.resume()
    timer = t
  }

  /// Messages handed to the page so far (a self test can check none go out while closed).
  private(set) var sentCount = 0
  private func send(_ obj: [String: Any]) {
    guard isOpen, let d = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: d, encoding: .utf8) else { return }
    sentCount += 1
    DispatchQueue.main.async { [weak self] in self?.deliver?(s) }
  }
  /// Main thread only: the island's place goes out before the queue has even opened.
  private func sendNow(_ obj: [String: Any]) {
    guard let d = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: d, encoding: .utf8) else { return }
    deliver?(s)
  }

  /// Where the window bursts out of: the island's centre, its bottom edge and its width, in the Tab list window's points. nil when the
  /// island cannot do it (off, moments off, Reduce Motion, not on screen): the page then grows the window out of its button.
  private func burstPlace(_ overlay: NSWindow?) -> [String: Double]? {
    guard Features.on("island-moments"), !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion,
          let o = overlay, let r = Island.shared.shapeOnScreen() else { return nil }
    return ["x": Double(r.midX - o.frame.minX), "bottom": Double(o.frame.maxY - r.minY), "w": Double(r.width), "h": Double(r.height)]
  }

  // ---------- one sample ----------
  private struct Last {
    var at: UInt64 = 0
    var ticks: [ActivityCore.Ticks] = []
    var procs: [Int32: (start: Double, cpu: UInt64, dr: UInt64, dw: UInt64, en: UInt64)] = [:]
    var disk: (r: UInt64, w: UInt64, busy: UInt64?)?
    var ifs: [String: (rx: UInt64, tx: UInt64)] = [:]
  }
  private var last = Last()
  /// What the page already has about each row (its name, icon, group, End task answer), so only changes go out.
  private struct MetaSig: Equatable { var display: String, iconId: String, top: Int32, regular: Bool, sys: Bool, end: Bool, start: Double }
  private var sentMeta: [Int32: MetaSig] = [:]
  private var netRates: [Int32: (rx: Double, tx: Double)] = [:], netOn = false
  private var costs: [Double] = []
  private var round = 0
  private var vols: [[String: Any]] = []
  private var ifLabels: [String: (label: String, kind: String)] = [:]
  private var battery: [String: Any]?
  private var gpuName = ""
  private var startupCache: [String: Any]?

  private func resetSamples() {
    last = Last(); sentMeta = [:]; costs = []; round = 0; netRates = [:]; startupCache = nil
  }

  private func sample() {
    guard isOpen, !sampling else { return }   // the one before is still running: skip this one
    sampling = true
    defer { sampling = false }
    let t0 = DispatchTime.now().uptimeNanoseconds
    if testDir != nil {
      var f = ActivityCore.fake(t: Date().timeIntervalSince(born))
      if round > 0 { f["meta"] = [String: Any]() }
      round += 1
      send(f)
      readout(cpu: ((f["cpu"] as? [String: Any])?["t"] as? Double) ?? 0, mem: f["mem"] as? [String: Any])
      return
    }
    // the per process network numbers the Network monitor lent last time (asked now, used next sample: never waits)
    NetMonitor.shared.pidRates { [weak self] r, on in self?.q.async { self?.netRates = r; self?.netOn = on } }

    let now = DispatchTime.now().uptimeNanoseconds
    let wallNs = last.at > 0 ? Double(now - last.at) : 0
    let secs = wallNs / 1e9
    var snap: [String: Any] = ["kind": "snap", "at": Date().timeIntervalSince1970 * 1000, "dt": secs]

    // CPU, per core
    let ticks = Self.coreTicks()
    let per = last.ticks.count == ticks.count ? zip(last.ticks, ticks).map { ActivityCore.corePercent($0, $1) } : ticks.map { _ in 0.0 }
    let all = ActivityCore.overall(last.ticks, ticks)
    let cores = ticks.count
    let readA = DispatchTime.now().uptimeNanoseconds
    let procsRead = readProcesses(deadline: readA + 600_000_000)   // a long read stops after 0.6 s
    var tb = mach_timebase_info_data_t(); mach_timebase_info(&tb)

    var rows: [[Double]] = [], meta: [String: [String: Any]] = [:], seen = Set<Int32>(), threads = 0
    var nextProcs: [Int32: (start: Double, cpu: UInt64, dr: UInt64, dw: UInt64, en: UInt64)] = [:]
    let groups = ActivityCore.groups(procsRead.map(\.proc))
    let me = getpid(), psPath = Bundle.main.bundlePath, psId = Bundle.main.bundleIdentifier ?? "com.cincee.ps"
    for r in procsRead {
      let p = r.proc
      seen.insert(p.pid)
      threads += r.threads
      nextProcs[p.pid] = (r.start, r.cpu, r.dr, r.dw, r.energy)
      var cpu = 0.0, dr = 0.0, dw = 0.0, watts = 0.0
      if let o = last.procs[p.pid], o.start == r.start, secs > 0 {
        cpu = ActivityCore.processPercent(cpuA: o.cpu, cpuB: r.cpu, wallNs: wallNs, cores: cores, numer: tb.numer, denom: tb.denom)
        dr = ActivityCore.rate(o.dr, r.dr, seconds: secs); dw = ActivityCore.rate(o.dw, r.dw, seconds: secs)
        watts = ActivityCore.rate(o.en, r.energy, seconds: secs) / 1e9    // billed energy is in nanojoules
      }
      let net = netOn ? netRates[p.pid] : nil
      rows.append([Double(p.pid), (cpu * 10).rounded() / 10, Double(r.mem), dr.rounded(), dw.rounded(), net.map { $0.rx.rounded() } ?? -1, net.map { $0.tx.rounded() } ?? -1,
                   (watts * 1000).rounded() / 1000, Double(r.threads)])
      let top = groups[p.pid]
      let v: (start: Double, top: Int32, sys: Bool, end: Bool, ps: Bool)
      if let hit = verdicts[p.pid], hit.start == r.start, hit.top == (top ?? 0) { v = hit }
      else {
        let bundle = p.bundles.last
        let sys = ActivityCore.isSystem(path: p.path, bundle: p.bundles.first)
        let end = ActivityCore.canEnd(ActivityCore.EndFacts(pid: p.pid, uid: p.uid, myUid: getuid(), myPid: me, path: p.path, bundle: bundle, name: p.name,
                                                            groupTop: top, psBundlePath: psPath, psBundleId: psId))
        let isPS = p.pid == me || ActivityCore.isPS(path: p.path, bundle: bundle, psBundlePath: psPath, psBundleId: psId)
        v = (r.start, top ?? 0, sys, end, isPS)
        verdicts[p.pid] = v
      }
      let sys = v.sys, end = v.end, isPS = v.ps
      let sig = MetaSig(display: r.display, iconId: r.iconId, top: top ?? 0, regular: p.regular, sys: sys, end: end, start: r.start)
      if sentMeta[p.pid] != sig {
        sentMeta[p.pid] = sig
        meta["\(p.pid)"] = ["n": r.display, "id": r.iconId, "g": top.map { Int($0) } ?? 0, "app": p.regular, "sys": sys, "end": end, "ps": isPS, "st": r.start]
      }
    }
    verdicts = verdicts.filter { seen.contains($0.key) }
    let gone = sentMeta.keys.filter { !seen.contains($0) }
    gone.forEach { sentMeta.removeValue(forKey: $0) }
    snap["rows"] = rows; snap["meta"] = meta; snap["gone"] = gone.map { Int($0) }

    snap["cpu"] = ["t": all.total, "u": all.user, "s": all.system, "cores": per.map { ($0 * 10).rounded() / 10 },
                   "kinds": ActivityCore.coreKinds(total: cores, performance: Self.sysInt("hw.perflevel0.logicalcpu"), efficiency: Self.sysInt("hw.perflevel1.logicalcpu")),
                   "name": Self.sysString("machdep.cpu.brand_string"), "up": Self.uptime(), "procs": Self.processCount(), "thr": threads]
    let mem = Self.memory()
    snap["mem"] = mem

    // Disk: every block storage driver's counters, and the volumes (read on their own queue: a stuck network disk never holds a sample).
    let d = Self.diskCounters()
    var disk: [String: Any] = ["r": 0, "w": 0, "act": NSNull(), "vols": vols]
    if let o = last.disk, secs > 0 {
      disk["r"] = ActivityCore.rate(o.r, d.r, seconds: secs); disk["w"] = ActivityCore.rate(o.w, d.w, seconds: secs)
      disk["act"] = ActivityCore.diskActive(busyNsA: o.busy, busyNsB: d.busy, wallNs: wallNs) as Any? ?? NSNull()
    }
    last.disk = d
    snap["disk"] = disk
    if round % 10 == 0 { refreshVolumes() }

    // Network, per interface (the same counters as the Network monitor)
    if round % 60 == 0 { refreshLabels() }
    let c = NetMonitor.counters()
    var ifs: [[String: Any]] = []
    for (n, v) in c.sorted(by: { $0.key < $1.key }) where Self.shownInterface(n) {
      guard let o = last.ifs[n], secs > 0 else { continue }
      let rx = ActivityCore.rate(o.rx, v.rx, seconds: secs), tx = ActivityCore.rate(o.tx, v.tx, seconds: secs)
      guard v.rx + v.tx > 0 else { continue }
      let l = ifLabels[n] ?? (NetMonitor.isTunnel(n) ? ("VPN", "vpn") : (n, "other"))
      ifs.append(["n": n, "l": l.label, "k": l.kind, "rx": rx.rounded(), "tx": tx.rounded()])
    }
    last.ifs = c
    snap["net"] = ["on": netOn, "ifs": ifs]

    // GPU and battery (the battery changes slowly: every 5th sample)
    snap["gpu"] = Self.gpu(&gpuName)
    if round % 5 == 0 { battery = Self.battery() }
    snap["bat"] = battery as Any? ?? NSNull()

    last.ticks = ticks; last.procs = nextProcs; last.at = now
    let ms = Double(DispatchTime.now().uptimeNanoseconds - t0) / 1e6
    costs.append(ms); if costs.count > 10 { costs.removeFirst() }
    let mine = rows.first { Int32($0[0]) == me }?[1] ?? 0
    snap["self"] = ["ms": (costs.reduce(0, +) / Double(costs.count) * 10).rounded() / 10, "cpu": mine]
    round += 1
    send(snap)
    readout(cpu: all.total, mem: mem)
  }

  private func readout(cpu: Double, mem: [String: Any]?) {
    let used = (mem?["used"] as? NSNumber)?.uint64Value ?? 0, total = (mem?["total"] as? NSNumber)?.uint64Value ?? 0
    DispatchQueue.main.async { ActivityIsland.shared.update(cpu: cpu, used: used, total: total) }
  }

  // ---------- processes ----------
  struct Read {
    var proc: ActivityCore.Proc
    var display: String, iconId: String
    var start: Double, cpu: UInt64, mem: UInt64, dr: UInt64, dw: UInt64, energy: UInt64, threads: Int
  }
  private var pathCache: [String: (bundles: [String], appPath: String?, display: String?)] = [:]
  /// What a process is never changes while it runs, so it is read once per process (pid and start time): its path, its bundles and
  /// who is responsible for it. A protected process keeps only its number and start time here, never anything about it.
  private struct Known { var start: Double; var path: String?; var info: (bundles: [String], appPath: String?, display: String?); var rpid: Int32; var protected: Bool }
  private var known: [Int32: Known] = [:]
  /// End task's answer per process (pid, start time and the row it folds under).
  private var verdicts: [Int32: (start: Double, top: Int32, sys: Bool, end: Bool, ps: Bool)] = [:]
  private static let responsible: (@convention(c) (pid_t) -> pid_t)? = {
    guard let f = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "responsibility_get_pid_responsible_for_pid") else { return nil }
    return unsafeBitCast(f, to: (@convention(c) (pid_t) -> pid_t).self)
  }()

  /// This user's processes, golden rule first. Stops reading at `deadline` (the rest come next sample).
  private func readProcesses(deadline: UInt64) -> [Read] {
    let myUid = getuid()
    let n = proc_listallpids(nil, 0)
    guard n > 0 else { return [] }
    var pids = [Int32](repeating: 0, count: Int(n) + 64)
    let got = Int(proc_listallpids(&pids, Int32(pids.count * MemoryLayout<Int32>.size)))
    let apps = NSWorkspace.shared.runningApplications
    var regular: [Int32: (name: String, id: String)] = [:]
    for a in apps where a.activationPolicy == .regular && !Protected.matches(a.bundleIdentifier) && !Protected.matches(a.localizedName) {
      regular[a.processIdentifier] = (a.localizedName ?? "", a.bundleIdentifier ?? "")
    }
    var out: [Read] = [], protectedPids = Set<Int32>(), seenPids = Set<Int32>()
    var buf = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
    for pid in pids.prefix(max(0, got)) where pid > 0 {
      if DispatchTime.now().uptimeNanoseconds > deadline { break }
      var bi = proc_bsdinfo()
      guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &bi, Int32(MemoryLayout<proc_bsdinfo>.size)) == Int32(MemoryLayout<proc_bsdinfo>.size), bi.pbi_uid == myUid else { continue }
      let start = Double(bi.pbi_start_tvsec) * 1000 + Double(bi.pbi_start_tvusec) / 1000
      let short = withUnsafeBytes(of: &bi.pbi_name) { String(decoding: $0.prefix { $0 != 0 }, as: UTF8.self) }
      var k: Known
      if let hit = known[pid], hit.start == start { k = hit }
      else {
        k = Known(start: start, path: nil, info: (bundles: [], appPath: nil, display: nil), rpid: pid, protected: true)
        if ActivityCore.isProtected(name: short, path: nil) { known[pid] = k; protectedPids.insert(pid); continue }      // golden rule, first check
        let len = proc_pidpath(pid, &buf, UInt32(buf.count))
        let path: String? = len > 0 ? String(cString: buf) : nil
        if ActivityCore.isProtected(name: nil, path: path) { known[pid] = k; protectedPids.insert(pid); continue }
        let info = path.map(pathInfo) ?? (bundles: [], appPath: nil, display: nil)
        if ActivityCore.isProtected(name: info.display, path: nil, bundles: info.bundles) { known[pid] = k; protectedPids.insert(pid); continue }
        k = Known(start: start, path: path, info: info, rpid: Self.responsible?(pid) ?? pid, protected: false)
        known[pid] = k
      }
      if k.protected { protectedPids.insert(pid); continue }
      let path = k.path, info = k.info, rpid = k.rpid
      seenPids.insert(pid)
      var ru = rusage_info_v4()
      let rr = withUnsafeMutablePointer(to: &ru) { $0.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) { proc_pid_rusage(pid, RUSAGE_INFO_V4, $0) } }
      guard rr == 0 else { continue }   // refused: left out, never an error
      var ti = proc_taskinfo()
      let threads = proc_pidinfo(pid, PROC_PIDTASKINFO, 0, &ti, Int32(MemoryLayout<proc_taskinfo>.size)) > 0 ? Int(ti.pti_threadnum) : 0
      let reg = regular[pid]
      let file = path.map { ($0 as NSString).lastPathComponent } ?? short
      let display = reg.map { $0.name.isEmpty ? file : $0.name } ?? info.display ?? (file.hasPrefix("com.apple.") ? String(file.dropFirst(10)).replacingOccurrences(of: ".", with: " ") : file)
      let proc = ActivityCore.Proc(pid: pid, ppid: Int32(bi.pbi_ppid), rpid: rpid, uid: bi.pbi_uid, name: short, path: path, bundles: info.bundles,
                                   appPath: info.appPath, regular: reg != nil)
      out.append(Read(proc: proc, display: display, iconId: reg?.id ?? info.bundles.first ?? "", start: start, cpu: ru.ri_user_time &+ ru.ri_system_time,
                      mem: ru.ri_phys_footprint, dr: ru.ri_diskio_bytesread, dw: ru.ri_diskio_byteswritten, energy: ru.ri_billed_energy, threads: threads))
    }
    if known.count > 6000 { known = known.filter { seenPids.contains($0.key) || protectedPids.contains($0.key) } }
    // Anything whose parent or responsible process turned out to be protected goes too.
    let kept = Set(ActivityCore.keep(out.map(\.proc), myUid: myUid, protectedPids: protectedPids, named: true).map(\.pid))
    return out.filter { kept.contains($0.proc.pid) }
  }

  /// The bundles a program's path goes through (outermost first) and the app's display name. Cached per path.
  private func pathInfo(_ path: String) -> (bundles: [String], appPath: String?, display: String?) {
    if let hit = pathCache[path] { return hit }
    var bundles: [String] = [], appPath: String?, display: String?
    var acc = ""
    for part in path.split(separator: "/") {
      acc += "/" + part
      guard part.hasSuffix(".app") else { continue }
      if appPath == nil { appPath = acc }
      if let b = Bundle(path: acc) {
        if let id = b.bundleIdentifier { bundles.append(id) }
        if display == nil { display = (b.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String) ?? (b.object(forInfoDictionaryKey: "CFBundleName") as? String) ?? String(part.dropLast(4)) }
      }
    }
    // a helper's own name reads better than its app's (Brave Browser Helper (Renderer)), the app's row shows the app's name
    if bundles.count > 1, let last = path.split(separator: "/").last { display = String(last) }
    if pathCache.count > 4000 { pathCache = [:] }
    let r = (bundles, appPath, display)
    pathCache[path] = r
    return r
  }

  // ---------- the Mac as a whole ----------
  static func coreTicks() -> [ActivityCore.Ticks] {
    var count: natural_t = 0
    var info: processor_info_array_t?
    var infoCount: mach_msg_type_number_t = 0
    guard host_processor_info(mach_host_self(), PROCESSOR_CPU_LOAD_INFO, &count, &info, &infoCount) == KERN_SUCCESS, let info else { return [] }
    defer { vm_deallocate(mach_task_self_, vm_address_t(bitPattern: info), vm_size_t(Int(infoCount) * MemoryLayout<integer_t>.stride)) }
    var out: [ActivityCore.Ticks] = []
    for i in 0..<Int(count) {
      let b = i * Int(CPU_STATE_MAX)
      func v(_ s: Int32) -> UInt64 { UInt64(UInt32(bitPattern: info[b + Int(s)])) }
      out.append(ActivityCore.Ticks(user: v(CPU_STATE_USER), system: v(CPU_STATE_SYSTEM), idle: v(CPU_STATE_IDLE), nice: v(CPU_STATE_NICE)))
    }
    return out
  }
  static func sysInt(_ name: String) -> Int {
    var v: Int32 = 0, s = MemoryLayout<Int32>.size
    return sysctlbyname(name, &v, &s, nil, 0) == 0 ? Int(v) : 0
  }
  static func sysString(_ name: String) -> String {
    var s = 0
    guard sysctlbyname(name, nil, &s, nil, 0) == 0, s > 0, s < 512 else { return "" }
    var b = [CChar](repeating: 0, count: s)
    return sysctlbyname(name, &b, &s, nil, 0) == 0 ? String(cString: b) : ""
  }
  static func uptime() -> Double {
    var tv = timeval(), s = MemoryLayout<timeval>.size
    var mib: [Int32] = [CTL_KERN, KERN_BOOTTIME]
    guard sysctl(&mib, 2, &tv, &s, nil, 0) == 0, tv.tv_sec > 0 else { return 0 }
    return max(0, Date().timeIntervalSince1970 - Double(tv.tv_sec))
  }
  /// Every process on the Mac (a count only: nothing about another user's process is read).
  static func processCount() -> Int { max(0, Int(proc_listallpids(nil, 0))) }
  static func memory() -> [String: Any] {
    var st = vm_statistics64()
    var count = mach_msg_type_number_t(MemoryLayout<vm_statistics64_data_t>.size / MemoryLayout<integer_t>.size)
    let kr = withUnsafeMutablePointer(to: &st) { $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { host_statistics64(mach_host_self(), HOST_VM_INFO64, $0, &count) } }
    var total: UInt64 = 0, ts = MemoryLayout<UInt64>.size
    sysctlbyname("hw.memsize", &total, &ts, nil, 0)
    var sw = xsw_usage(), ss = MemoryLayout<xsw_usage>.size
    sysctlbyname("vm.swapusage", &sw, &ss, nil, 0)
    guard kr == KERN_SUCCESS else { return ["total": total, "used": 0, "app": 0, "wired": 0, "comp": 0, "cached": 0, "free": total, "swap": sw.xsu_used, "swapT": sw.xsu_total, "press": "normal"] }
    let vm = ActivityCore.VM(pageSize: UInt64(vm_kernel_page_size), free: UInt64(st.free_count), wired: UInt64(st.wire_count), compressor: UInt64(st.compressor_page_count),
                             purgeable: UInt64(st.purgeable_count), external: UInt64(st.external_page_count), internalPages: UInt64(st.internal_page_count),
                             speculative: UInt64(st.speculative_count))
    let m = ActivityCore.memory(vm, total: total, swapUsed: sw.xsu_used, swapTotal: sw.xsu_total, pressureLevel: sysInt("kern.memorystatus_vm_pressure_level"))
    return ["total": m.total, "used": m.used, "app": m.app, "wired": m.wired, "comp": m.compressed, "cached": m.cached, "free": m.free, "swap": m.swapUsed, "swapT": m.swapTotal, "press": m.pressure]
  }
  static func diskCounters() -> (r: UInt64, w: UInt64, busy: UInt64?) {
    var it: io_iterator_t = 0
    guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IOBlockStorageDriver"), &it) == KERN_SUCCESS else { return (0, 0, nil) }
    defer { IOObjectRelease(it) }
    var r: UInt64 = 0, w: UInt64 = 0, busy: UInt64 = 0, sawTime = false
    var s = IOIteratorNext(it)
    while s != 0 {
      if let st = IORegistryEntryCreateCFProperty(s, "Statistics" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? [String: Any] {
        r &+= (st["Bytes (Read)"] as? NSNumber)?.uint64Value ?? 0
        w &+= (st["Bytes (Write)"] as? NSNumber)?.uint64Value ?? 0
        if let a = (st["Total Time (Read)"] as? NSNumber)?.uint64Value, let b = (st["Total Time (Write)"] as? NSNumber)?.uint64Value { busy &+= a &+ b; sawTime = true }
      }
      IOObjectRelease(s)
      s = IOIteratorNext(it)
    }
    return (r, w, sawTime ? busy : nil)
  }
  private func refreshVolumes() {
    volQ.async { [weak self] in
      let keys: [URLResourceKey] = [.volumeIsLocalKey, .volumeNameKey, .volumeTotalCapacityKey, .volumeAvailableCapacityForImportantUsageKey, .volumeAvailableCapacityKey]
      let urls = FileManager.default.mountedVolumeURLs(includingResourceValuesForKeys: [.volumeIsLocalKey], options: [.skipHiddenVolumes]) ?? []
      var out: [[String: Any]] = []
      for u in urls.prefix(12) {
        guard let v = try? u.resourceValues(forKeys: Set(keys)), v.volumeIsLocal == true, let total = v.volumeTotalCapacity, total > 0 else { continue }
        let free = v.volumeAvailableCapacityForImportantUsage.map { Int($0) } ?? v.volumeAvailableCapacity ?? 0
        let name = v.volumeName ?? u.lastPathComponent
        if ActivityCore.isProtected(name: name, path: nil) { continue }
        out.append(["n": name, "total": total, "free": max(0, free)])
      }
      self?.q.async { self?.vols = out }
    }
  }
  private func refreshLabels() {
    var k: [String: (label: String, kind: String)] = [:]
    for i in (SCNetworkInterfaceCopyAll() as? [SCNetworkInterface]) ?? [] {
      guard let bsd = SCNetworkInterfaceGetBSDName(i) as String? else { continue }
      let type = SCNetworkInterfaceGetInterfaceType(i).map { $0 as String } ?? ""
      let label = SCNetworkInterfaceGetLocalizedDisplayName(i).map { $0 as String } ?? bsd
      k[bsd] = (label, type == (kSCNetworkInterfaceTypeIEEE80211 as String) ? "wifi" : type == (kSCNetworkInterfaceTypeEthernet as String) ? "ethernet" : "other")
    }
    ifLabels = k
  }
  /// The interfaces worth a graph: Wi-Fi, Ethernet and the VPN tunnels, never the loopback or macOS's own private links.
  static func shownInterface(_ n: String) -> Bool {
    NetMonitor.isTunnel(n) || n.hasPrefix("en")
  }
  static func gpu(_ name: inout String) -> [String: Any] {
    var it: io_iterator_t = 0
    guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IOAccelerator"), &it) == KERN_SUCCESS else { return ["u": NSNull(), "name": name] }
    defer { IOObjectRelease(it) }
    var util: Double?
    var s = IOIteratorNext(it)
    while s != 0 {
      if util == nil, let st = IORegistryEntryCreateCFProperty(s, "PerformanceStatistics" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? [String: Any],
         let u = (st["Device Utilization %"] as? NSNumber)?.doubleValue ?? (st["GPU Activity(%)"] as? NSNumber)?.doubleValue {
        util = min(100, max(0, u))
        if name.isEmpty, let m = IORegistryEntryCreateCFProperty(s, "model" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() {
          name = (m as? String) ?? (m as? Data).flatMap { String(data: $0, encoding: .utf8)?.trimmingCharacters(in: .controlCharacters) } ?? ""
        }
      }
      IOObjectRelease(s)
      s = IOIteratorNext(it)
    }
    return ["u": util as Any? ?? NSNull(), "name": name]
  }
  /// The battery, or nil on a Mac without one. Never its serial number.
  static func battery() -> [String: Any]? {
    guard let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(), let list = IOPSCopyPowerSourcesList(info)?.takeRetainedValue() as? [CFTypeRef] else { return nil }
    for ps in list {
      guard let d = IOPSGetPowerSourceDescription(info, ps)?.takeUnretainedValue() as? [String: Any], (d[kIOPSTypeKey] as? String) == kIOPSInternalBatteryType else { continue }
      let cur = d[kIOPSCurrentCapacityKey] as? Int ?? 0, max = d[kIOPSMaxCapacityKey] as? Int ?? 100
      let charging = d[kIOPSIsChargingKey] as? Bool ?? false
      let ac = (d[kIOPSPowerSourceStateKey] as? String) == kIOPSACPowerValue
      var out: [String: Any] = ["pct": max > 0 ? Int((Double(cur) / Double(max) * 100).rounded()) : cur, "charging": charging, "ac": ac]
      out["mins"] = ActivityCore.minutes(charging ? d[kIOPSTimeToFullChargeKey] as? Int : d[kIOPSTimeToEmptyKey] as? Int) as Any? ?? NSNull()
      let b = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("AppleSmartBattery"))
      if b != 0 {
        func int(_ k: String) -> Int? { (IORegistryEntryCreateCFProperty(b, k as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? NSNumber)?.intValue }
        out["cycles"] = int("CycleCount") as Any? ?? NSNull()
        out["health"] = ActivityCore.batteryHealth(rawMax: int("AppleRawMaxCapacity") ?? int("NominalChargeCapacity"), design: int("DesignCapacity")) as Any? ?? NSNull()
        out["watts"] = ActivityCore.watts(mV: int("Voltage"), mA: int("InstantAmperage") ?? int("Amperage")).map { ($0 * 10).rounded() / 10 } as Any? ?? NSNull()
        IOObjectRelease(b)
      }
      return out
    }
    return nil
  }

  // ---------- End task ----------
  private func end(pid: Int32, start: Double, step: ActivityCore.EndStep) {
    // Read the process again right now: same process (its start time), still the person's, still allowed.
    guard testDir == nil else { send(["kind": "ended", "pid": Int(pid), "step": step.rawValue, "ok": true, "alive": false]); return }
    guard let fresh = readProcesses(deadline: DispatchTime.now().uptimeNanoseconds + 400_000_000).first(where: { $0.proc.pid == pid }), fresh.start == start else {
      send(["kind": "ended", "pid": Int(pid), "step": step.rawValue, "ok": false, "alive": false]); return
    }
    let all = readProcesses(deadline: DispatchTime.now().uptimeNanoseconds + 400_000_000)
    let top = ActivityCore.groups(all.map(\.proc))[pid]
    let p = fresh.proc
    let allowed = ActivityCore.canEnd(ActivityCore.EndFacts(pid: pid, uid: p.uid, myUid: getuid(), myPid: getpid(), path: p.path, bundle: p.bundles.last, name: p.name,
                                                            groupTop: top, psBundlePath: Bundle.main.bundlePath, psBundleId: Bundle.main.bundleIdentifier ?? "com.cincee.ps"))
    guard allowed else { psLog("PS activity: End task refused"); send(["kind": "ended", "pid": Int(pid), "step": step.rawValue, "ok": false, "alive": true]); return }
    psLog("PS activity: End task (\(step.rawValue))")
    DispatchQueue.main.async { [weak self] in
      let app = NSRunningApplication(processIdentifier: pid)
      let sent: Bool
      switch step {
      case .quit: sent = app?.terminate() ?? (kill(pid, SIGTERM) == 0)
      case .force: sent = app?.forceTerminate() ?? (kill(pid, SIGKILL) == 0)
      }
      // Is it still there a moment later (the same process, not a new one with the same number)?
      self?.q.asyncAfter(deadline: .now() + (step == .quit ? 2.5 : 1)) { [weak self] in
        var bi = proc_bsdinfo()
        let alive = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &bi, Int32(MemoryLayout<proc_bsdinfo>.size)) == Int32(MemoryLayout<proc_bsdinfo>.size)
          && Double(bi.pbi_start_tvsec) * 1000 + Double(bi.pbi_start_tvusec) / 1000 == start
        self?.send(["kind": "ended", "pid": Int(pid), "step": step.rawValue, "ok": sent, "alive": alive])
      }
    }
  }

  // ---------- Startup apps ----------
  private func startupJSON() -> [String: Any] {
    if let c = startupCache { return c }
    if testDir != nil {
      return ["kind": "startup", "fake": true, "hidden": true, "items": [["label": "com.example.sync.agent", "name": "Sample Sync", "id": "com.example.sync", "folder": "user", "run": true, "keep": true, "off": false],
                                                                       ["label": "org.example.updater", "name": "Sample Updater", "id": "", "folder": "mac", "run": true, "keep": false, "off": false]]]
    }
    var items: [[String: Any]] = []
    let home = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/LaunchAgents", isDirectory: true)
    for (dir, folder) in [(home, "user"), (URL(fileURLWithPath: "/Library/LaunchAgents", isDirectory: true), "mac")] {
      let files = ((try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []).filter { $0.hasSuffix(".plist") }.sorted().prefix(200)
      for f in files {
        if ActivityCore.isProtected(name: f, path: nil) { continue }   // golden rule: by file name, before the file is opened
        guard let data = FileManager.default.contents(atPath: dir.appendingPathComponent(f).path), data.count < 256 * 1024,
              let pl = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
              let a = ActivityCore.launchAgent(pl, file: f, folder: folder) else { continue }
        var name = a.label, id = ""
        if let appPath = ActivityCore.appOf(a.program), let b = Bundle(path: appPath) {
          if b.bundleIdentifier.map(Protected.matches) == true { continue }
          id = b.bundleIdentifier ?? ""
          name = (b.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String) ?? (b.object(forInfoDictionaryKey: "CFBundleName") as? String) ?? URL(fileURLWithPath: appPath).deletingPathExtension().lastPathComponent
        }
        if ActivityCore.isProtected(name: name, path: nil, bundles: [id]) { continue }
        items.append(["label": a.label, "name": name, "id": id, "folder": folder, "run": a.runAtLoad, "keep": a.keepAlive, "off": a.disabled])
      }
    }
    let out: [String: Any] = ["kind": "startup", "hidden": true, "items": items]
    startupCache = out
    return out
  }

  // ---------- App history ----------
  private var history = ActivityCore.History()
  private var historyLoaded = false, historyDirty = false, historySaved = Date.distantPast
  private var historyLast: [String: UInt64] = [:]   // "pid.start" -> CPU time (mach ticks) at the last minute
  private static let dayFmt: DateFormatter = { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX"); return f }()
  private static func dayKey(_ d: Date = Date()) -> String { dayFmt.string(from: d) }
  private var historyURL: URL {
    let dir = testDir.map { URL(fileURLWithPath: $0, isDirectory: true) }
      ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("PS", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir.appendingPathComponent("activity-history.json")
  }
  /// Once a minute, from screen time's own timer (main thread): CPU time per app since the last minute. Never in a self test copy.
  func historyTick() {
    guard testDir == nil, Features.on("activity-monitor") else { return }
    q.async { [self] in
      guard enabled else { return }
      loadHistory()
      var tb = mach_timebase_info_data_t(); mach_timebase_info(&tb)
      let procs = readProcesses(deadline: DispatchTime.now().uptimeNanoseconds + 400_000_000)
      let groups = ActivityCore.groups(procs.map(\.proc))
      let byPid = Dictionary(procs.map { ($0.proc.pid, $0) }, uniquingKeysWith: { a, _ in a })
      var next: [String: UInt64] = [:]
      let day = Self.dayKey()
      for r in procs {
        let k = "\(r.proc.pid).\(r.start)"
        next[k] = r.cpu
        guard let was = historyLast[k], r.cpu > was else { continue }
        let owner = groups[r.proc.pid].flatMap { byPid[$0] } ?? r
        let key = owner.iconId.isEmpty ? owner.display : owner.iconId
        ActivityCore.add(&history, day: day, key: key, name: owner.display, secs: ActivityCore.machNs(r.cpu - was, numer: tb.numer, denom: tb.denom) / 1e9)
        historyDirty = true
      }
      historyLast = next
      if historyDirty && Date().timeIntervalSince(historySaved) > 300 { saveHistory() }
    }
  }
  private func loadHistory() {
    guard !historyLoaded else { return }
    historyLoaded = true
    guard let data = try? Data(contentsOf: historyURL), let j = try? JSONSerialization.jsonObject(with: data) as? [String: [String: [String: Any]]] else { return }
    for (d, apps) in j {
      for (k, v) in apps { ActivityCore.add(&history, day: d, key: k, name: v["name"] as? String ?? k, secs: (v["secs"] as? NSNumber)?.doubleValue ?? 0) }
    }
  }
  private func saveHistory() {
    let keep = Set((0..<8).map { Self.dayKey(Date().addingTimeInterval(Double(-$0) * 86400)) })
    history = ActivityCore.trim(history, keep: keep)
    let obj = history.mapValues { $0.mapValues { ["name": $0.name, "secs": ($0.secs * 10).rounded() / 10] } }
    guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
    let url = historyURL, tmp = url.appendingPathExtension("tmp")
    FileManager.default.createFile(atPath: tmp.path, contents: data, attributes: [.posixPermissions: 0o600])
    _ = try? FileManager.default.replaceItemAt(url, withItemAt: tmp)
    historyDirty = false; historySaved = Date()
  }
  private func sendHistory() {
    loadHistory()
    let days = (0..<7).map { Self.dayKey(Date().addingTimeInterval(Double(-$0) * 86400)) }
    var cpu: [String: [[String: Any]]] = [:]
    if testDir != nil {
      let t = Self.dayKey()
      cpu[t] = [["id": "com.example.browser", "name": "Sample Browser", "secs": 1840], ["id": "com.example.editor", "name": "Sample Editor", "secs": 920]]
      send(["kind": "history", "fake": true, "days": days, "cpu": cpu, "net": [t: ["Sample Browser": [4.2e8, 3.1e7]]]])
      return
    }
    for d in days { cpu[d] = (history[d] ?? [:]).map { ["id": $0.key, "name": $0.value.name, "secs": ($0.value.secs * 10).rounded() / 10] } }
    NetMonitor.shared.appDays(7) { [weak self] net in
      self?.q.async {
        // The Network monitor's history keeps app names: a protected name never got in there either, and is dropped again here.
        let clean = net.mapValues { $0.filter { !ActivityCore.isProtected(name: $0.key, path: nil) } }
        self?.send(["kind": "history", "days": days, "cpu": cpu, "net": clean])
      }
    }
  }
}
