// Network monitor (the developer, 18 Oct 2026): a private view of what this Mac sends and receives, shown
// in the Tab list (gear menu > Network). Everything here runs as the developer's own user: no admin password,
// no helper with system rights, no packet capture.
//
// Sources: the interface byte counters (sysctl NET_RT_IFLIST2, same numbers as getifaddrs but 64
// bit), `nettop` (every process's TCP and UDP sockets, their interface and bytes), the routing table
// (`netstat -rn`: where the VPN's server is), SystemConfiguration (primary interface, DNS servers),
// CoreWLAN (Wi-Fi signal; the network NAME needs Location Services, which PS never asks for) and
// `networkQuality` (Apple's speed test, only when the developer presses it).
//
// GOLDEN RULE: 1Password and Signal rows are dropped the moment a nettop line is read (process
// name, path or any bundle id in the path matches Protected), before anything is counted, shown,
// stored or logged. Only the whole-interface byte totals include them, unavoidably.
//
// PRIVATE: nothing leaves the Mac. No vault, no Supabase, no telemetry. The only network use is the
// speed test (Apple's servers, through the VPN) and reverse DNS if the developer switches it on (off by
// default). Countries come from the bundled offline file (geo/ip-country.bin, DB-IP Lite). Live
// data stays in memory and goes to the page only while the monitor is open. History (optional)
// is sealed with AES-GCM; the key sits in PS's own Keychain item, the file is 0600.
//
// NO FREEZES: every collector runs on its own serial queue with short timeouts; nothing here touches
// the main thread except handing finished JSON to the page, and nothing touches the keyboard tap.
// Polling runs only while the monitor is open, plus a light leak check every few seconds when the
// leak alarm is on.
import Cocoa
import CoreWLAN
import CryptoKit
import Darwin
import Network
import Security
import SystemConfiguration

final class NetMonitor {
  static let shared = NetMonitor()
  /// Hands JSON to the overlay page (set by App; called on the main thread, only while open).
  var deliver: ((String) -> Void)?
  /// A leak or VPN alarm pop-up (title, body), main thread.
  var alarmPopup: ((String, String) -> Void)?

  private let q = DispatchQueue(label: "PS net monitor", qos: .utility)
  private let speedQ = DispatchQueue(label: "PS net speed test", qos: .utility)
  private let dnsQ = DispatchQueue(label: "PS net reverse dns", qos: .utility, attributes: .concurrent)
  private var timer: DispatchSourceTimer?
  private var isOpen = false
  /// The developer can switch the whole monitor off (More settings > Network monitor): then nothing runs at
  /// all, not even the light leak watch, until he switches it back on. Saved on this Mac.
  private(set) var enabled = true
  private var testDir: String?
  private var settings: [String: Any] = NetMonitor.defaults

  // ---------- settings (this Mac only: UserDefaults, never the vault) ----------
  static let defaults: [String: Any] = [
    "live": true, "apps": true, "conns": true, "vpn": true, "speed": true, "wifi": true,
    "countries": true, "rdns": false, "refresh": 2, "history": true, "keepDays": 30,
    "alarm": true, "alarmPopup": true, "cardVpn": true, "cardOffline": true, "cardConn": true, "units": "bits",
    "uptime": true,
  ]
  static func clean(_ raw: [String: Any]) -> [String: Any] {
    var s = defaults
    for k in ["live", "apps", "conns", "vpn", "speed", "wifi", "countries", "rdns", "history", "alarm", "alarmPopup", "cardVpn", "cardOffline", "cardConn", "uptime"] {
      if let b = raw[k] as? Bool { s[k] = b }
    }
    if let r = raw["refresh"] as? Int, [1, 2, 5, 10].contains(r) { s["refresh"] = r }
    if let d = raw["keepDays"] as? Int, [7, 30, 90, 365].contains(d) { s["keepDays"] = d }
    if let u = raw["units"] as? String, ["bits", "bytes"].contains(u) { s["units"] = u }
    return s
  }
  private func flag(_ k: String) -> Bool { settings[k] as? Bool ?? false }

  /// Starts the light leak watch (when the alarm is on). `testDir`: a self test copy keeps its
  /// history there, never touches the Keychain or the developer's saved settings, and never pops up alarms.
  func start(testDir: String? = nil) {
    q.async { [self] in
      self.testDir = testDir
      if testDir == nil, let saved = UserDefaults.standard.dictionary(forKey: "net.settings") { settings = Self.clean(saved) }
      if testDir == nil, let on = UserDefaults.standard.object(forKey: "net.enabled") as? Bool { enabled = on }
      reschedule()
      if enabled { startPath() }   // the monitor switched off: no path watch at all (and so no Internet offline or connection cards)
      startUptime()
    }
  }

  /// A message from the page: {type:"net", op:"open"|"close"|"settings"|"speedtest"|"clearHistory"}.
  func handle(_ msg: [String: Any]) {
    let op = msg["op"] as? String ?? ""
    let raw = msg["settings"] as? [String: Any]
    let on = msg["on"] as? Bool
    q.async { [self] in
      switch op {
      case "enable":
        guard let on, on != enabled else { return }
        enabled = on
        if testDir == nil { UserDefaults.standard.set(on, forKey: "net.enabled") }
        psLog("PS net: monitor switched \(on ? "on" : "off")")
        if !on { isOpen = false }
        if on { startPath() } else { stopPath() }
        reschedule(); rescheduleUp()
      case "open":
        guard enabled else { return }
        isOpen = true
        loadHistory()
        send(["kind": "settings", "settings": settings])
        send(historyJSON())
        sendSpeed()
        send(uptime.json(now: Self.nowMs()))
        reschedule(); sample()
      case "close":
        isOpen = false; reschedule()
      case "settings":
        guard let raw else { return }
        settings = Self.clean(raw)
        if testDir == nil { UserDefaults.standard.set(settings, forKey: "net.settings") }
        if !flag("history") { deleteHistoryFile() } else { dirty = true }
        send(["kind": "settings", "settings": settings])
        uptime.keepDays = settings["keepDays"] as? Int ?? 30
        reschedule(); rescheduleUp()
      case "speedtest":
        guard enabled else { return }
        startSpeedTest()
      case "clearHistory":
        days = [:]; speedTests = []; leakLog = []; vpnLog = []
        deleteHistoryFile()
        send(historyJSON())
      case "clearUptime":
        uptime.clear(at: Self.nowMs()); saveUptime(force: true)
        send(uptime.json(now: Self.nowMs()))
      default: break
      }
    }
  }
  /// The Tab list went away: stop live polling at once (the light leak watch carries on).
  func listHidden() { q.async { [self] in if isOpen { isOpen = false; reschedule() } } }

  private func reschedule() {
    timer?.cancel(); timer = nil
    let every: Double
    if !enabled { saveHistoryIfNeeded(force: true); return }
    if isOpen { every = Double(settings["refresh"] as? Int ?? 2) }
    else if Owner.red && (flag("alarm") || flag("cardVpn")) { every = 6 }   // the leak watch is the developer's own (his VPN)
    else { saveHistoryIfNeeded(force: true); return }
    let t = DispatchSource.makeTimerSource(queue: q)
    t.schedule(deadline: .now() + every, repeating: every, leeway: .milliseconds(300))
    t.setEventHandler { [weak self] in self?.sample() }
    t.resume()
    timer = t
  }

  /// Messages handed to the page so far (the self test checks none go out while closed).
  private(set) var sentCount = 0
  private func send(_ obj: [String: Any]) {
    guard isOpen, let d = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: d, encoding: .utf8) else { return }
    sentCount += 1
    DispatchQueue.main.async { [weak self] in self?.deliver?(s) }
  }
  /// Self test: how many messages went to the page (read on the monitor's own queue).
  func sent(_ done: @escaping (Int) -> Void) { q.async { [self] in let n = sentCount; DispatchQueue.main.async { done(n) } } }
  /// Self test: is the monitor switched on, and is anything polling right now.
  func running(_ done: @escaping (Bool, Bool) -> Void) { q.async { [self] in let r = (enabled, timer != nil); DispatchQueue.main.async { done(r.0, r.1) } } }

  // ---------- interfaces ----------
  struct IfKind { let kind: String; let label: String }
  private var kinds: [String: IfKind] = [:]
  private var kindsAt = Date.distantPast
  private var wifiName: String?
  private func refreshKinds() {
    guard Date().timeIntervalSince(kindsAt) > 60 else { return }
    kindsAt = Date()
    var k: [String: IfKind] = [:]
    for i in (SCNetworkInterfaceCopyAll() as? [SCNetworkInterface]) ?? [] {
      guard let bsd = SCNetworkInterfaceGetBSDName(i) as String? else { continue }
      let type = SCNetworkInterfaceGetInterfaceType(i) as String? ?? ""
      let label = SCNetworkInterfaceGetLocalizedDisplayName(i) as String? ?? bsd
      if type == (kSCNetworkInterfaceTypeIEEE80211 as String) { k[bsd] = IfKind(kind: "wifi", label: label) }
      else if type == (kSCNetworkInterfaceTypeEthernet as String) && !label.lowercased().contains("bridge") { k[bsd] = IfKind(kind: "ethernet", label: label) }
    }
    wifiName = CWWiFiClient.shared().interface()?.interfaceName
    if let w = wifiName { k[w] = IfKind(kind: "wifi", label: k[w]?.label ?? "Wi-Fi") }
    kinds = k
  }
  static func isTunnel(_ n: String) -> Bool { n.hasPrefix("utun") || n.hasPrefix("ipsec") || n.hasPrefix("ppp") || n.hasPrefix("tun") || n.hasPrefix("wg") }
  /// Only the tunnel the default route goes into is the VPN; other utun interfaces belong to macOS
  /// services (iCloud, Continuity) and count as "other".
  private func kind(_ n: String) -> IfKind {
    if Self.isTunnel(n) { return n == defaultIface ? IfKind(kind: "vpn", label: "VPN tunnel (\(n))") : IfKind(kind: "other", label: "System tunnel (\(n))") }
    if let k = kinds[n] { return k }
    return IfKind(kind: "other", label: n)
  }

  /// 64 bit byte counters per interface (NET_RT_IFLIST2).
  static func counters() -> [String: (rx: UInt64, tx: UInt64)] {
    var mib: [Int32] = [CTL_NET, PF_ROUTE, 0, 0, NET_RT_IFLIST2, 0]
    var len = 0
    guard sysctl(&mib, 6, nil, &len, nil, 0) == 0, len > 0 else { return [:] }
    var buf = [UInt8](repeating: 0, count: len)
    guard sysctl(&mib, 6, &buf, &len, nil, 0) == 0 else { return [:] }
    var out: [String: (rx: UInt64, tx: UInt64)] = [:]
    var off = 0
    buf.withUnsafeBytes { raw in
      while off + MemoryLayout<if_msghdr>.size <= len {
        let base = raw.baseAddress!.advanced(by: off)
        let h = base.load(as: if_msghdr.self)
        if Int32(h.ifm_type) == RTM_IFINFO2 {
          let h2 = base.load(as: if_msghdr2.self)
          var name = [CChar](repeating: 0, count: Int(IF_NAMESIZE) + 1)
          if if_indextoname(UInt32(h2.ifm_index), &name) != nil {
            out[String(cString: name)] = (h2.ifm_data.ifi_ibytes, h2.ifm_data.ifi_obytes)
          }
        }
        if h.ifm_msglen == 0 { break }
        off += Int(h.ifm_msglen)
      }
    }
    return out
  }

  // ---------- per day totals and history ----------
  private var lastCounters: [String: (rx: UInt64, tx: UInt64)] = [:]
  private var lastAt: Date?
  private var rates: [String: (rx: Double, tx: Double)] = [:]
  /// day -> {"k": {kind: [rx, tx]}, "a": {app: [rx, tx]}}
  private var days: [String: [String: [String: [Double]]]] = [:]
  private var series: [[String: Any]] = []          // last 120 samples, per kind rates (memory only)
  private var speedTests: [[String: Any]] = []
  private var leakLog: [[String: Any]] = []
  private var vpnLog: [[String: Any]] = []
  private var dirty = false, loaded = false, savedAt = Date.distantPast
  private var historyNote: String?
  private static let dayFmt: DateFormatter = { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX"); return f }()
  private func dayKey(_ d: Date = Date()) -> String { Self.dayFmt.string(from: d) }
  private func addDay(_ group: String, _ key: String, _ rx: Double, _ tx: Double) {
    guard rx > 0 || tx > 0 else { return }
    let d = dayKey()
    var day = days[d] ?? [:]
    var g = day[group] ?? [:]
    let cur = g[key] ?? [0, 0]
    g[key] = [cur[0] + rx, cur[1] + tx]
    day[group] = g
    days[d] = day
    dirty = true
  }

  // ---------- nettop: processes and their sockets ----------
  struct Proc { var name: String; var pid: Int32; var app: String; var bundle: String?; var system: Bool; var rx: UInt64; var tx: UInt64; var conns: [Conn] }
  struct Conn { var proto: String; var local: String; var remote: String; var port: Int; var iface: String; var state: String; var rx: UInt64; var tx: UInt64 }
  struct ProcInfo { let app: String; let bundle: String?; let system: Bool }

  /// Parses `nettop -L 1 -n -x -J interface,state,bytes_in,bytes_out`. `info` returns nil for a
  /// protected process (1Password, Signal): that process and all of its sockets are dropped here,
  /// the very first time its line is read.
  static func parse(_ text: String, info: (String, Int32) -> ProcInfo?) -> [Proc] {
    var out: [Proc] = []
    var cur: Proc?
    var skipping = false
    for line in text.split(separator: "\n") {
      let f = line.split(separator: ",", omittingEmptySubsequences: false).map(String.init)
      guard f.count >= 5, !f[0].isEmpty else { continue }
      let first = f[0]
      let isSocket = first.hasPrefix("tcp4 ") || first.hasPrefix("tcp6 ") || first.hasPrefix("udp4 ") || first.hasPrefix("udp6 ")
      if !isSocket {
        if let c = cur { out.append(c) }
        cur = nil; skipping = false
        guard let dot = first.lastIndex(of: "."), let pid = Int32(first[first.index(after: dot)...]) else { skipping = true; continue }
        let name = String(first[..<dot])
        if Protected.matches(name) { skipping = true; continue }               // golden rule, first check
        guard let i = info(name, pid) else { skipping = true; continue }       // golden rule, by path and bundle
        cur = Proc(name: name, pid: pid, app: i.app, bundle: i.bundle, system: i.system, rx: UInt64(f[3]) ?? 0, tx: UInt64(f[4]) ?? 0, conns: [])
        continue
      }
      guard !skipping, cur != nil else { continue }
      let proto = String(first.prefix(4))
      let ends = first.dropFirst(5).components(separatedBy: "<->")
      guard ends.count == 2 else { continue }
      let (rhost, rport) = splitEnd(ends[1], v6: proto.hasSuffix("6"))
      let (lhost, _) = splitEnd(ends[0], v6: proto.hasSuffix("6"))
      if rhost == "*" || rhost.isEmpty { continue }                             // listening, not connected
      cur!.conns.append(Conn(proto: proto, local: lhost, remote: rhost, port: rport, iface: ifaceName(f[1]), state: f[2], rx: UInt64(f[3]) ?? 0, tx: UInt64(f[4]) ?? 0))
    }
    if let c = cur { out.append(c) }
    return out
  }
  /// nettop prints "idx-21" when it cannot name an interface (eg while the VPN reconnects). Name it
  /// again from the index; one that still has no name comes back empty and is never treated as a leak.
  static func ifaceName(_ s: String) -> String {
    guard s.hasPrefix("idx-") else { return s }
    guard let n = UInt32(s.dropFirst(4)), n > 0 else { return "" }
    var b = [CChar](repeating: 0, count: Int(IF_NAMESIZE) + 1)
    return if_indextoname(n, &b) != nil ? String(cString: b) : ""
  }

  /// Is this socket a leak (data really moved outside the VPN), a blocked attempt (it tried, nothing
  /// came back: the VPN's firewall stopped it), or fine? Public address, a named non tunnel interface,
  /// not the VPN's own relay and not the VPN app itself. A leak needs bytes BOTH ways.
  enum Verdict: String { case leak, blocked, fine }
  static func leakVerdict(remote: String, iface: String, rx: UInt64, tx: UInt64, state: String, app: String, bundle: String?, relays: Set<String>) -> Verdict {
    guard isPublic(remote), !iface.isEmpty, !iface.hasPrefix("idx-"), !isTunnel(iface), !iface.hasPrefix("lo") else { return .fine }
    if relays.contains(remote) { return .fine }
    let a = app.lowercased(), b = (bundle ?? "").lowercased()
    if a.contains("vpn-daemon") || b.contains("vpn-daemon") { return .fine }
    if rx > 0 && tx > 0 { return .leak }
    if tx > 0 || state == "SynSent" || state == "Established" { return .blocked }
    return .fine
  }

  static func splitEnd(_ s: String, v6: Bool) -> (String, Int) {
    guard let i = s.lastIndex(of: v6 ? "." : ":") else { return (s, 0) }
    var host = String(s[..<i])
    if let pct = host.firstIndex(of: "%") { host = String(host[..<pct]) }
    return (host, Int(s[s.index(after: i)...]) ?? 0)
  }

  private var infoCache: [String: ProcInfo] = [:]
  /// Who a process is: its app (the outermost .app in its path) or its own name. nil = protected.
  private func procInfo(_ name: String, _ pid: Int32) -> ProcInfo? {
    let key = "\(name).\(pid)"
    if let hit = infoCache[key] { return hit }
    var buf = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
    let n = proc_pidpath(pid, &buf, UInt32(buf.count))
    let path = n > 0 ? String(cString: buf) : nil
    var bundles: [String] = []
    var app = name, bundle: String? = nil
    if let path {
      if Protected.matches(path) { return nil }
      let parts = path.split(separator: "/").map(String.init)
      var acc = ""
      for p in parts {
        acc += "/" + p
        if p.hasSuffix(".app"), let b = Bundle(path: acc) {
          if let id = b.bundleIdentifier { bundles.append(id) }
          if bundle == nil {
            bundle = b.bundleIdentifier
            app = (b.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String) ?? (b.object(forInfoDictionaryKey: "CFBundleName") as? String) ?? String(p.dropLast(4))
          }
        }
      }
      if bundle == nil { app = URL(fileURLWithPath: path).lastPathComponent }
    }
    if bundles.contains(where: { Protected.matches($0) }) || Protected.matches(app) { return nil }
    // macOS's own processes: Apple bundles outside /Applications, or binaries in the system folders.
    let p = path ?? ""
    let system = (bundle?.hasPrefix("com.apple.") ?? false) && !p.hasPrefix("/Applications/")
      || (bundle == nil && ["/System/", "/usr/libexec/", "/usr/sbin/", "/usr/bin/", "/sbin/", "/Library/Apple/"].contains { p.hasPrefix($0) })
    // "com.apple.WebKit.Networking" reads better as "WebKit Networking".
    if app.hasPrefix("com.apple.") { app = String(app.dropFirst(10)).replacingOccurrences(of: ".", with: " ") }
    let i = ProcInfo(app: app, bundle: bundle, system: system)
    if infoCache.count > 3000 { infoCache = [:] }
    infoCache[key] = i
    return i
  }

  private func run(_ exe: String, _ args: [String], timeout: Double) -> String? {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: exe)
    p.arguments = args
    let out = Pipe()
    p.standardOutput = out
    p.standardError = FileHandle.nullDevice
    do { try p.run() } catch { return nil }
    let killer = DispatchWorkItem { if p.isRunning { p.terminate() } }
    DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: killer)
    let data = out.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    killer.cancel()
    return String(data: data, encoding: .utf8)
  }

  // ---------- addresses ----------
  static func isPublic(_ ip: String) -> Bool {
    if ip.contains(":") {
      var a = in6_addr()
      guard inet_pton(AF_INET6, ip, &a) == 1 else { return false }
      let b0 = a.__u6_addr.__u6_addr8.0
      return b0 & 0xE0 == 0x20                                    // 2000::/3, global unicast
    }
    let p = ip.split(separator: ".").compactMap { Int($0) }
    guard p.count == 4 else { return false }
    switch (p[0], p[1]) {
    case (0, _), (10, _), (127, _), (169, 254), (192, 168), (255, _): return false
    case (172, 16...31), (100, 64...127): return false
    default: return p[0] < 224
    }
  }

  // Offline country lookup (geo/ip-country.bin, see geo/README.md).
  private var geo4: [UInt32] = [], cc4: [UInt8] = [], geo6: [UInt64] = [], cc6: [UInt8] = []
  private var geoLoaded = false
  private func loadGeo() {
    guard !geoLoaded else { return }
    geoLoaded = true
    guard let url = Bundle.main.url(forResource: "ip-country", withExtension: "bin"), let d = try? Data(contentsOf: url), d.count > 12,
          d.prefix(4) == Data("PSG1".utf8) else { return }
    let n4 = Int(d.subdata(in: 4..<8).withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) })
    let n6 = Int(d.subdata(in: 8..<12).withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) })
    var o = 12
    guard d.count >= 12 + n4 * 6 + n6 * 10 else { return }
    d.withUnsafeBytes { r in
      geo4 = (0..<n4).map { r.loadUnaligned(fromByteOffset: o + $0 * 4, as: UInt32.self) }; o += n4 * 4
      cc4 = Array(r[o..<(o + n4 * 2)]); o += n4 * 2
      geo6 = (0..<n6).map { r.loadUnaligned(fromByteOffset: o + $0 * 8, as: UInt64.self) }; o += n6 * 8
      cc6 = Array(r[o..<(o + n6 * 2)])
    }
  }
  func country(_ ip: String) -> String? {
    loadGeo()
    func pick<T: Comparable>(_ starts: [T], _ ccs: [UInt8], _ v: T) -> String? {
      var lo = 0, hi = starts.count - 1, best = -1
      while lo <= hi { let m = (lo + hi) / 2; if starts[m] <= v { best = m; lo = m + 1 } else { hi = m - 1 } }
      guard best >= 0, ccs.count >= best * 2 + 2 else { return nil }
      let s = String(bytes: ccs[(best * 2)..<(best * 2 + 2)], encoding: .ascii)
      return s == "ZZ" ? nil : s
    }
    if ip.contains(":") {
      var a = in6_addr()
      guard inet_pton(AF_INET6, ip, &a) == 1 else { return nil }
      let b = a.__u6_addr.__u6_addr8
      let hi = [b.0, b.1, b.2, b.3, b.4, b.5, b.6, b.7].reduce(UInt64(0)) { $0 << 8 | UInt64($1) }
      return pick(geo6, cc6, hi)
    }
    var a = in_addr()
    guard inet_pton(AF_INET, ip, &a) == 1 else { return nil }
    return pick(geo4, cc4, UInt32(bigEndian: a.s_addr))
  }

  // Reverse DNS (only when switched on): answers arrive in the next sample.
  private var names: [String: String] = [:]
  private var asking = Set<String>()
  private func host(_ ip: String) -> String? {
    if let n = names[ip] { return n.isEmpty ? nil : n }
    guard flag("rdns"), asking.count < 16, !asking.contains(ip), Self.isPublic(ip) else { return nil }
    asking.insert(ip)
    dnsQ.async { [weak self] in
      var name = ""
      var hints = addrinfo(ai_flags: AI_NUMERICHOST, ai_family: AF_UNSPEC, ai_socktype: 0, ai_protocol: 0, ai_addrlen: 0, ai_canonname: nil, ai_addr: nil, ai_next: nil)
      var res: UnsafeMutablePointer<addrinfo>?
      if getaddrinfo(ip, nil, &hints, &res) == 0, let r = res {
        var h = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        if getnameinfo(r.pointee.ai_addr, r.pointee.ai_addrlen, &h, socklen_t(h.count), nil, 0, NI_NAMEREQD) == 0 { name = String(cString: h) }
        freeaddrinfo(r)
      }
      self?.q.async { self?.names[ip] = name; self?.asking.remove(ip) }
    }
    return nil
  }

  // ---------- VPN ----------
  private var vpnServers: [String] = []
  private var physGateway: String?, physIface: String?, defaultIface = ""
  private var routesAt = Date.distantPast
  private var wasVpnUp: Bool?
  private func primaryInterface() -> String? {
    guard let store = SCDynamicStoreCreate(nil, "PS net" as CFString, nil, nil),
          let v = SCDynamicStoreCopyValue(store, "State:/Network/Global/IPv4" as CFString) as? [String: Any] else { return nil }
    return v["PrimaryInterface"] as? String
  }
  private func dnsServers() -> [String] {
    guard let store = SCDynamicStoreCreate(nil, "PS net" as CFString, nil, nil),
          let v = SCDynamicStoreCopyValue(store, "State:/Network/Global/DNS" as CFString) as? [String: Any] else { return [] }
    return (v["ServerAddresses"] as? [String]) ?? []
  }
  /// The VPN's own server(s): host routes that go out on the physical network while everything
  /// else goes into the tunnel. Packets to them are the tunnel itself, never a leak.
  private func refreshRoutes() {
    guard Date().timeIntervalSince(routesAt) > 10, let text = run("/usr/sbin/netstat", ["-rn", "-f", "inet"], timeout: 3) else { return }
    routesAt = Date()
    var gw: String?, gwIf: String?, first: String?
    var hosts: [(String, String, String)] = []
    for line in text.split(separator: "\n") {
      let c = line.split(separator: " ", omittingEmptySubsequences: true).map(String.init)
      guard c.count >= 4 else { continue }
      if c[0] == "default" {
        if first == nil { first = c[3] }
        if gw == nil, !Self.isTunnel(c[3]), c[1].contains(".") { gw = c[1]; gwIf = c[3] }
        continue
      }
      let dest = c[0].hasSuffix("/32") ? String(c[0].dropLast(3)) : c[0]
      if (c[0].hasSuffix("/32") || c[2].contains("H")), dest.split(separator: ".").count == 4 { hosts.append((dest, c[1], c[3])) }
    }
    physGateway = gw; physIface = gwIf; defaultIface = first ?? ""
    vpnServers = hosts.filter { $0.1 == gw && $0.2 == gwIf && Self.isPublic($0.0) }.map { $0.0 }
  }
  private func tunnelAddress(_ iface: String) -> String? {
    var ifap: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&ifap) == 0, let first = ifap else { return nil }
    defer { freeifaddrs(ifap) }
    var p: UnsafeMutablePointer<ifaddrs>? = first
    while let a = p {
      if String(cString: a.pointee.ifa_name) == iface, let sa = a.pointee.ifa_addr, sa.pointee.sa_family == UInt8(AF_INET) {
        var h = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        if getnameinfo(sa, socklen_t(sa.pointee.sa_len), &h, socklen_t(h.count), nil, 0, NI_NUMERICHOST) == 0 { return String(cString: h) }
      }
      p = a.pointee.ifa_next
    }
    return nil
  }

  // ---------- one sample ----------
  private var lastProc: [String: (rx: UInt64, tx: UInt64)] = [:]
  private var lastConn: [String: (rx: UInt64, tx: UInt64)] = [:]
  private var firstSeen: [String: Date] = [:]
  private var lastAlarm: [String: Date] = [:]
  private var leaksNow: [[String: Any]] = []

  private func sample() {
    let now = Date()
    refreshKinds()
    refreshRoutes()
    // Interfaces: rates and today's totals per network.
    let c = Self.counters()
    let dt = lastAt.map { now.timeIntervalSince($0) } ?? 0
    var r: [String: (rx: Double, tx: Double)] = [:]
    for (n, v) in c {
      guard let o = lastCounters[n], v.rx >= o.rx, v.tx >= o.tx else { continue }   // new interface or counters reset
      let drx = Double(v.rx - o.rx), dtx = Double(v.tx - o.tx)
      if dt > 0 { r[n] = (drx / dt, dtx / dt) }
      if !n.hasPrefix("lo") { addDay("k", kind(n).kind, drx, dtx) }
    }
    lastCounters = c; lastAt = now; rates = r

    // Sockets (protected apps dropped inside parse).
    let primary = Self.isTunnel(defaultIface) ? defaultIface : (primaryInterface() ?? defaultIface)
    let mv = vpnApp()
    mvSeen = (mv, now)
    let vpnUp = mv.map { $0.connected } ?? Self.isTunnel(primary)
    let relays = Set(vpnServers).union(mv?.relays ?? [])
    var blocked: [[String: Any]] = []
    let procs = run("/usr/bin/nettop", ["-L", "1", "-n", "-x", "-J", "interface,state,bytes_in,bytes_out"], timeout: 4)
      .map { Self.parse($0, info: { self.procInfo($0, $1) }) } ?? []
    var appRows: [String: [String: Any]] = [:]
    var connRows: [[String: Any]] = []
    var seen = Set<String>(), seenConn = Set<String>()
    var leaks: [[String: Any]] = []
    for p in procs {
      let pk = "\(p.name).\(p.pid)"
      seen.insert(pk)
      var drx = 0.0, dtx = 0.0
      if let o = lastProc[pk], p.rx >= o.rx, p.tx >= o.tx { drx = Double(p.rx - o.rx); dtx = Double(p.tx - o.tx) }
      lastProc[pk] = (p.rx, p.tx)
      addDay("a", p.app, drx, dtx)
      var row = appRows[p.app] ?? ["name": p.app, "id": p.bundle ?? "", "system": p.system, "rx": 0.0, "tx": 0.0, "conns": 0, "procs": 0]
      let prx: Double = dt > 0 ? drx / dt : 0, ptx: Double = dt > 0 ? dtx / dt : 0
      row["rx"] = ((row["rx"] as? NSNumber)?.doubleValue ?? 0) + prx
      row["tx"] = ((row["tx"] as? NSNumber)?.doubleValue ?? 0) + ptx
      row["conns"] = (row["conns"] as? Int ?? 0) + p.conns.count
      row["procs"] = (row["procs"] as? Int ?? 0) + 1
      appRows[p.app] = row
      for cn in p.conns {
        let ck = "\(p.pid)|\(cn.proto)|\(cn.local)|\(cn.remote):\(cn.port)"
        seenConn.insert(ck)
        if firstSeen[ck] == nil { firstSeen[ck] = now }
        var crx = 0.0, ctx = 0.0
        if let o = lastConn[ck], cn.rx >= o.rx, cn.tx >= o.tx { crx = Double(cn.rx - o.rx); ctx = Double(cn.tx - o.tx) }
        lastConn[ck] = (cn.rx, cn.tx)
        let pub = Self.isPublic(cn.remote)
        let tunnelItself = relays.contains(cn.remote)
        let verdict = Self.leakVerdict(remote: cn.remote, iface: cn.iface, rx: cn.rx, tx: cn.tx, state: cn.state, app: p.app, bundle: p.bundle, relays: relays)
        let leak = verdict == .leak
        if verdict != .fine {
          let row: [String: Any] = ["app": p.app, "ip": cn.remote, "port": cn.port, "iface": cn.iface, "proto": cn.proto, "cc": country(cn.remote) ?? "", "ck": ck]
          if leak { leaks.append(row) } else { blocked.append(row) }
        }
        if isOpen && flag("conns") {
          let crate: Double = dt > 0 ? crx / dt : 0, ctate: Double = dt > 0 ? ctx / dt : 0
          var cr: [String: Any] = ["app": p.app, "id": p.bundle ?? "", "proto": cn.proto, "ip": cn.remote, "port": cn.port, "iface": cn.iface,
                                   "kind": cn.iface.isEmpty ? "" : kind(cn.iface).kind, "state": cn.state, "rxT": Double(cn.rx), "txT": Double(cn.tx),
                                   "rx": crate, "tx": ctate, "since": firstSeen[ck]!.timeIntervalSince1970 * 1000,
                                   "public": pub, "leak": leak, "tunnel": tunnelItself]
          if flag("countries"), pub, let cc = country(cn.remote) { cr["cc"] = cc }
          if let h = host(cn.remote) { cr["host"] = h }
          connRows.append(cr)
        }
      }
    }
    lastProc = lastProc.filter { seen.contains($0.key) }
    lastConn = lastConn.filter { seenConn.contains($0.key) }
    firstSeen = firstSeen.filter { seenConn.contains($0.key) }
    if infoCache.count > 1500 { infoCache = infoCache.filter { seen.contains($0.key) } }
    leaksNow = leaks
    // The app that runs the tunnel: whoever talks to the VPN server, else a known VPN app by name.
    let known = ["wireguard", "openvpn", "nordvpn", "protonvpn", "expressvpn", "tunnelblick", "surfshark", "tailscale", "windscribe", "ivpn"]
    let daemon = procs.first { $0.conns.contains { vpnServers.contains($0.remote) } }?.app
      ?? procs.first { p in known.contains { p.app.lowercased().contains($0) || p.name.lowercased().contains($0) } }?.app
    noteBlocked(blocked)
    checkAlarms(vpnUp: vpnUp, primary: primary, leaks: leaks, mv: mv)

    // Series for the graph (per kind, bytes per second).
    var perKind: [String: [Double]] = [:]
    for (n, v) in rates where !n.hasPrefix("lo") {
      let k = kind(n).kind
      let cur = perKind[k] ?? [0, 0]
      perKind[k] = [cur[0] + v.rx, cur[1] + v.tx]
    }
    if dt > 0 { series.append(["t": now.timeIntervalSince1970 * 1000, "k": perKind]); if series.count > 150 { series.removeFirst(series.count - 150) } }
    saveHistoryIfNeeded()
    guard isOpen else { return }

    // The snapshot for the page.
    var ifaces: [[String: Any]] = []
    for (n, v) in rates.sorted(by: { $0.key < $1.key }) where !n.hasPrefix("lo") {
      let k = kind(n)
      // The VPN, the network under it, and anything else that is moving data right now.
      guard n == primary || n == physIface || v.rx + v.tx > 50 else { continue }
      ifaces.append(["name": n, "kind": k.kind, "label": k.label, "rx": v.rx, "tx": v.tx, "primary": n == primary])
    }
    var snap: [String: Any] = ["kind": "snap", "at": now.timeIntervalSince1970 * 1000, "ifaces": ifaces, "series": series,
                               "totals": totals(), "primary": primary]
    if flag("apps") {
      snap["apps"] = appRows.values.map { row -> [String: Any] in
        var x = row
        let name = row["name"] as? String ?? ""
        let today = days[dayKey()]?["a"]?[name] ?? [0, 0]
        x["rxT"] = today[0]; x["txT"] = today[1]
        return x
      }
    }
    if flag("conns") {
      let busy = { (r: [String: Any]) -> Double in ((r["rx"] as? NSNumber)?.doubleValue ?? 0) + ((r["tx"] as? NSNumber)?.doubleValue ?? 0) }
      connRows.sort { busy($0) > busy($1) }
      snap["conns"] = Array(connRows.prefix(400))
      snap["connCount"] = connRows.count
    }
    if flag("vpn") {
      var v = vpnJSON(up: vpnUp, primary: primary, leaks: leaks, daemon: mv != nil ? "VPN app" : daemon)
      if let mv { v["vpnApp"] = ["state": mv.state, "city": mv.city, "country": mv.country, "host": mv.host, "entry": mv.entry, "lockdown": mv.lockdown,
                                  "blocking": mv.blocking, "features": mv.features]
        if !mv.iface.isEmpty { v["iface"] = mv.connected ? mv.iface : "" } }
      v["blocked"] = blockedLog.suffix(40).map { $0 }
      v["netlog"] = Array(netLog.suffix(40))
      snap["vpn"] = v
    }
    if flag("wifi") { snap["wifi"] = wifiJSON() }
    send(snap)
  }

  private func totals() -> [String: Any] {
    let cal = Calendar(identifier: .iso8601)
    let today = dayKey()
    let monday = cal.dateInterval(of: .weekOfYear, for: Date())?.start ?? Date()
    var t: [String: [Double]] = [:], w: [String: [Double]] = [:]
    for (d, v) in days {
      guard let k = v["k"], let date = Self.dayFmt.date(from: d) else { continue }
      for (kind, x) in k {
        if d == today { t[kind] = [(t[kind]?[0] ?? 0) + x[0], (t[kind]?[1] ?? 0) + x[1]] }
        if date >= monday { w[kind] = [(w[kind]?[0] ?? 0) + x[0], (w[kind]?[1] ?? 0) + x[1]] }
      }
    }
    return ["today": t, "week": w]
  }

  /// `daemon`: the app that runs the tunnel (whoever talks to the VPN server).
  private func vpnJSON(up: Bool, primary: String, leaks: [[String: Any]], daemon: String?) -> [String: Any] {
    return ["up": up, "iface": up ? primary : "", "address": up ? (tunnelAddress(primary) ?? "") : "",
            "servers": vpnServers.map { ["ip": $0, "cc": country($0) ?? ""] }, "daemon": daemon ?? "",
            "physical": physIface ?? "", "gateway": physGateway ?? "", "dns": dnsServers(),
            "leaks": leaks, "log": Array(leakLog.suffix(50)), "events": Array(vpnLog.suffix(30)), "alarm": flag("alarm")]
  }

  // ---------- alarms: cards in the top right pop-up stack (Toast.showMeet, tones ok/warn/bad/info) ----------
  // One card per subject (the same id replaces the card showing), never a stack of repeats.
  private var leakGroups: [String: (first: Date, count: Int, conns: Set<String>)] = [:]
  private var lastVpnApp: VpnApp?
  private var vpnDownSince: Date?
  /// Events for the window's log (VPN, connection, offline), newest last. Memory only.
  private var netLog: [[String: Any]] = []
  /// Attempts the VPN's firewall stopped (tried, nothing came back). Shown quietly in the window only.
  private var blockedLog: [[String: Any]] = []
  private func noteBlocked(_ rows: [[String: Any]]) {
    let now = Date().timeIntervalSince1970 * 1000
    for r in rows {
      let key = "\(r["app"] ?? "")|\(r["ip"] ?? "")|\(r["iface"] ?? "")"
      if let i = blockedLog.lastIndex(where: { ($0["key"] as? String) == key }) {
        blockedLog[i]["at"] = now; blockedLog[i]["n"] = (blockedLog[i]["n"] as? Int ?? 1) + 1
      } else {
        var e = r; e.removeValue(forKey: "ck"); e["key"] = key; e["at"] = now; e["n"] = 1
        blockedLog.append(e); if blockedLog.count > 200 { blockedLog.removeFirst(blockedLog.count - 200) }
      }
    }
  }
  private func log(_ tone: String, _ text: String) {
    netLog.append(["at": Date().timeIntervalSince1970 * 1000, "tone": tone, "text": text])
    if netLog.count > 200 { netLog.removeFirst(netLog.count - 200) }
  }

  private func checkAlarms(vpnUp: Bool, primary: String, leaks: [[String: Any]], mv: VpnApp?) {
    let now = Date()
    // VPN state changes. The VPN app says what it is doing; otherwise the default route tells.
    if let mv {
      if let card = Self.vpnCard(prev: lastVpnApp, now: mv, downFor: vpnDownSince.map { now.timeIntervalSince($0) }, physical: physIface ?? "") {
        log(card["tone"] as? String ?? "info", "\(card["title"] as? String ?? "")\((card["sub"] as? String).map { ", " + $0 } ?? "")")
        vpnLog.append(["at": now.timeIntervalSince1970 * 1000, "up": mv.connected, "iface": mv.iface]); dirty = true
        show(card, "cardVpn")
      }
      if !mv.connected && vpnDownSince == nil { vpnDownSince = now }
      if mv.connected { vpnDownSince = nil }
      lastVpnApp = mv
    } else if let was = wasVpnUp, was != vpnUp {
      vpnLog.append(["at": now.timeIntervalSince1970 * 1000, "up": vpnUp, "iface": primary]); dirty = true
      let card: [String: Any] = vpnUp
        ? ["id": "net-vpn", "tone": "ok", "icon": "shield", "title": "VPN connected", "sub": primary]
        : ["id": "net-vpn", "tone": "bad", "icon": "shield", "title": "VPN is OFF", "sub": "Traffic is going out on \(primary.isEmpty ? "the normal network" : primary)"]
      log(card["tone"] as! String, card["title"] as! String)
      show(card, "cardVpn")
    }
    wasVpnUp = vpnUp
    guard flag("alarm") else { return }
    // Leaks: one card per app and network, with a count, for an hour.
    leakGroups = leakGroups.filter { now.timeIntervalSince($0.value.first) < 3600 }
    for l in leaks {
      let app = l["app"] as? String ?? "", iface = l["iface"] as? String ?? "", ck = l["ck"] as? String ?? ""
      let key = "\(app)|\(iface)"
      var g = leakGroups[key] ?? (first: now, count: 0, conns: [])
      if g.conns.contains(ck) { continue }
      g.count += 1; g.conns.insert(ck)
      leakGroups[key] = g
      var e = l; e.removeValue(forKey: "ck"); e["at"] = now.timeIntervalSince1970 * 1000
      leakLog.append(e); if leakLog.count > 500 { leakLog.removeFirst(leakLog.count - 500) }
      dirty = true
      psLog("PS net: leak alarm, \(app) on \(iface) (\(g.count) this hour)")
      if flag("alarmPopup") { show(Self.leakCard(app: app, iface: iface, label: kind(iface).label, ip: l["ip"] as? String ?? "", port: l["port"] as? Int ?? 0, cc: l["cc"] as? String ?? "", count: g.count), "alarm") }
    }
  }
  /// Hands a card to the pop-up stack. Never from a self test copy (its pictures use the builders).
  private func show(_ card: [String: Any], _ switchKey: String) {
    guard testDir == nil, Self.cardAllowed(enabled: enabled, flag: flag(switchKey)) else { return }
    // VPN leak and VPN up or down cards watch the developer's own VPN. Anyone else's PS (the public download, 5 Nov 2026:
    // The developer's friend has no VPN and got a stream of leak pop-ups) never shows them. Offline and connection cards stay.
    if Self.redOnlyCard(switchKey) && !Owner.red { return }
    DispatchQueue.main.async { Toast.shared.showMeet(card) }
  }

  /// A card may show only while the monitor itself is on and that card's own switch is on (the monitor's off switch
  /// stops every card, Internet offline and connection changes too).
  static func cardAllowed(enabled: Bool, flag: Bool) -> Bool { enabled && flag }
  /// The cards that are about the developer's own VPN.
  static func redOnlyCard(_ switchKey: String) -> Bool { switchKey == "alarm" || switchKey == "cardVpn" }
  /// The developer became known after launch: start the light leak watch now.
  func ownerKnown() { q.async { [self] in reschedule() } }

  static func leakCard(app: String, iface: String, label: String, ip: String, port: Int, cc: String, count: Int) -> [String: Any] {
    let place = cc.isEmpty ? "" : " (\(Locale(identifier: "en_GB").localizedString(forRegionCode: cc) ?? cc))"
    return ["id": "nl:" + String(abs((app + "|" + iface).hashValue) % 1_000_000_007, radix: 36), "tone": "bad", "icon": "shield",
            "title": count > 1 ? "Possible VPN leak, \(count) times this hour" : "Possible VPN leak",
            "sub": "\(app) on \(label)",
            "body": "Data went both ways outside the VPN, to \(ip)\(port > 0 ? ":\(port)" : "")\(place)."]
  }

  /// The card for a change in the VPN app's state, or nil when nothing worth a card changed.
  static func vpnCard(prev: VpnApp?, now: VpnApp, downFor: TimeInterval?, physical: String) -> [String: Any]? {
    guard let prev else { return nil }                                   // first look: no card
    let place = [now.city, now.country].filter { !$0.isEmpty }.joined(separator: ", ")
    if now.connected && !prev.connected {
      let back = downFor.map { " after \(Self.duration($0))" } ?? ""
      let moved = !prev.city.isEmpty && prev.city != now.city ? ", was \(prev.city)" : ""
      return ["id": "net-vpn", "tone": "ok", "icon": "shield", "title": "VPN connected\(now.city.isEmpty ? "" : ", \(now.city)")",
              "sub": [place, now.host].filter { !$0.isEmpty }.joined(separator: " · "), "body": "Back\(back)\(moved)."]
    }
    if now.connected && prev.connected && !now.host.isEmpty && !prev.host.isEmpty && now.host != prev.host {
      return ["id": "net-vpn", "tone": "info", "icon": "swap", "title": "VPN server changed",
              "sub": "Now \(place.isEmpty ? now.host : place) (\(now.host))", "body": "Was \(prev.city.isEmpty ? prev.host : prev.city) (\(prev.host))."]
    }
    if !now.connected && (prev.connected || prev.state != now.state) {
      if now.blocking {
        let reconnecting = now.state == "connecting" || now.state == "error" || now.state == "disconnecting"
        return ["id": "net-vpn", "tone": "warn", "icon": "shield",
                "title": reconnecting ? "VPN reconnecting" : "VPN disconnected, traffic blocked",
                "sub": "The VPN app is blocking traffic\(reconnecting ? " until it is back" : "")",
                "body": reconnecting ? "Nothing goes out without the VPN while it reconnects." : "Lockdown mode is on: nothing goes out until the VPN app connects again."]
      }
      if prev.connected || prev.blocking {
        return ["id": "net-vpn", "tone": "bad", "icon": "shield", "title": "VPN is OFF",
                "sub": "Traffic is going out on \(physical.isEmpty ? "the normal network" : physical)", "body": "The VPN app is disconnected and not blocking."]
      }
    }
    return nil
  }
  static func duration(_ t: TimeInterval) -> String {
    let s = Int(t.rounded())
    if s < 60 { return "\(s) s" }
    if s < 3600 { return "\(s / 60) min\(s % 60 > 0 ? " \(s % 60) s" : "")" }
    return "\(s / 3600) h \((s % 3600) / 60) min"
  }

  // ---------- the VPN app's own view of the tunnel (read only: its CLI, else its log) ----------
  struct VpnApp {
    var state: String; var lockdown: Bool; var city: String; var country: String; var host: String; var entry: String
    var relays: Set<String>; var iface: String; var features: [String]
    var connected: Bool { state == "connected" }
    /// the VPN app's firewall lets nothing out while it connects, after an error, or (lockdown) while off.
    var blocking: Bool { !connected && (state == "connecting" || state == "error" || state == "disconnecting" || lockdown) }
  }
  private let vpnAppCLI: String? = nil   // left out: the developer's VPN app command line
  private var lockdownKnown: Bool?, lockdownAt = Date.distantPast
  private func vpnApp() -> VpnApp? {
    let haveApp = vpnAppCLI != nil || FileManager.default.fileExists(atPath: "/var/log/your-vpn/daemon.log")
    guard haveApp else { return nil }
    if let cli = vpnAppCLI, Date().timeIntervalSince(lockdownAt) > 300, let t = run(cli, ["lockdown-mode", "get"], timeout: 3) {
      lockdownAt = Date(); lockdownKnown = t.lowercased().contains(": on")
    }
    if let cli = vpnAppCLI, let t = run(cli, ["status", "-j"], timeout: 3), let d = t.data(using: .utf8),
       let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any], var m = Self.parseVpnApp(j) {
      if let l = lockdownKnown { m.lockdown = m.lockdown || l }
      return m
    }
    return vpnAppFromLog()
  }
  static func hostOnly(_ a: String) -> String {
    if a.hasPrefix("["), let e = a.firstIndex(of: "]") { return String(a[a.index(after: a.startIndex)..<e]) }
    if a.filter({ $0 == ":" }).count == 1, let c = a.lastIndex(of: ":") { return String(a[..<c]) }
    return a
  }
  static func parseVpnApp(_ j: [String: Any]) -> VpnApp? {
    guard let state = (j["state"] as? String)?.lowercased() else { return nil }
    let d = j["details"] as? [String: Any] ?? [:]
    var relays = Set<String>()
    func add(_ any: Any?) { if let s = (any as? [String: Any])?["address"] as? String { relays.insert(hostOnly(s)) } }
    let ep = d["endpoint"] as? [String: Any] ?? [:]
    add(ep); add(ep["entry_endpoint"])
    if let ob = ep["obfuscation"] as? [String: Any] { for v in ob.values { add((v as? [String: Any])?["endpoint"]) } }
    let loc = d["location"] as? [String: Any] ?? [:]
    let feats = (d["feature_indicators"] as? [String]) ?? []
    return VpnApp(state: state, lockdown: feats.contains("LockdownMode"), city: loc["city"] as? String ?? "", country: loc["country"] as? String ?? "",
                   host: loc["hostname"] as? String ?? "", entry: loc["entry_hostname"] as? String ?? "", relays: relays,
                   iface: ep["tunnel_interface"] as? String ?? "", features: feats)
  }
  /// Fallback without the CLI: the last "New tunnel state" line in the VPN app's own log (readable without admin).
  private func vpnAppFromLog() -> VpnApp? {
    guard let h = FileHandle(forReadingAtPath: "/var/log/your-vpn/daemon.log") else { return nil }
    defer { try? h.close() }
    let size = (try? h.seekToEnd()) ?? 0
    try? h.seek(toOffset: size > 65536 ? size - 65536 : 0)
    guard let data = try? h.readToEnd(), let text = String(data: data, encoding: .utf8) else { return nil }
    guard let line = text.components(separatedBy: "\n").last(where: { $0.contains("New tunnel state: ") }),
          let r = line.range(of: "New tunnel state: ") else { return nil }
    let word = line[r.upperBound...].prefix { $0.isLetter }.lowercased()
    return VpnApp(state: word, lockdown: lockdownKnown ?? false, city: "", country: "", host: "", entry: "", relays: [], iface: "", features: [])
  }

  // ---------- the connection itself (NWPathMonitor: event driven, no permissions) ----------
  private var pathMon: NWPathMonitor?
  private var pathWait: DispatchWorkItem?
  private var online: Bool?, offlineSince: Date?, connLabel: String?
  private func startPath() {
    guard pathMon == nil else { return }
    let m = NWPathMonitor()
    m.pathUpdateHandler = { [weak self] p in self?.q.async { self?.pathChanged(p) } }
    m.start(queue: DispatchQueue(label: "PS net path", qos: .utility))
    pathMon = m
  }
  /// The monitor switched off: the path watch stops, and the next start counts as a first look (no stale card).
  private func stopPath() {
    pathMon?.cancel(); pathMon = nil
    pathWait?.cancel(); pathWait = nil
    online = nil
  }
  private func pathChanged(_ p: NWPath) {
    lastPath = p
    let ok = p.status == .satisfied
    let phys = p.availableInterfaces.first { $0.type == .wifi || $0.type == .wiredEthernet || $0.type == .cellular }
    refreshKinds()
    let label = phys.map { Self.connectionLabel(type: $0.type, name: $0.name, scLabel: kinds[$0.name]?.label, expensive: p.isExpensive) }
    // Wait for it to settle: a cable swap or a Wi-Fi roam fires several changes in a second.
    pathWait?.cancel()
    let w = DispatchWorkItem { [weak self] in self?.settlePath(ok: ok, label: label) }
    pathWait = w
    q.asyncAfter(deadline: .now() + 4, execute: w)
  }
  static func connectionLabel(type: NWInterface.InterfaceType, name: String, scLabel: String?, expensive: Bool) -> String {
    switch type {
    case .wifi: return expensive ? "iPhone hotspot (Wi-Fi)" : "Wi-Fi"
    case .cellular: return "Mobile data"
    default:
      let l = scLabel ?? name
      if l.lowercased().contains("iphone") { return "iPhone (USB)" }
      if l.lowercased().contains("thunderbolt bridge") { return "Thunderbolt Bridge" }
      return l == name || l.lowercased() == "ethernet" ? "Ethernet" : "Ethernet (\(l))"
    }
  }
  private func settlePath(ok: Bool, label: String?) {
    let now = Date()
    defer { online = ok; if ok, let label { connLabel = label } }
    guard let was = online else { if !ok { offlineSince = now }; return }   // first look: no card
    if was && !ok {
      offlineSince = now
      log("bad", "Internet offline")
      show(Self.offlineCard(), "cardOffline")
    } else if !was && ok {
      let down = offlineSince.map { now.timeIntervalSince($0) } ?? 0
      offlineSince = nil
      log("ok", "Back online after \(Self.duration(down))")
      show(Self.onlineCard(down: down, label: label), "cardOffline")
    }
    if ok, let l = label, let prev = connLabel, l != prev {
      log("info", "Connection changed to \(l), was \(prev)")
      show(Self.connCard(now: l, was: prev), "cardConn")
    }
    upTick()
  }
  static func offlineCard() -> [String: Any] {
    ["id": "net-online", "tone": "bad", "icon": "globe", "title": "Internet offline", "sub": "This Mac has no network right now", "body": "\(AppName.current) will tell you when it is back."]
  }
  static func onlineCard(down: TimeInterval, label: String?) -> [String: Any] {
    ["id": "net-online", "tone": "ok", "icon": "globe", "title": "Back online", "sub": label ?? "", "body": "Offline for \(duration(down))."]
  }
  static func connCard(now: String, was: String) -> [String: Any] {
    ["id": "net-conn", "tone": "info", "icon": now.contains("Wi-Fi") || now.contains("hotspot") ? "wifi" : "plug", "title": "Connection changed", "sub": "Now on \(now)", "body": "Was \(was)."]
  }

  // ---------- Last online (Sources/NetUptime.swift): this Mac's connection history ----------
  private let uptime = NetUptime()
  private var upTimer: DispatchSourceTimer?
  private var lastPath: NWPath?
  private var mvSeen: (VpnApp?, Date)?
  private var dnsBusy = false, dnsAt = Date.distantPast, lastDns: Bool?
  private var upStarted = false
  static func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }
  private var uptimeURL: URL {
    if let d = testDir { return URL(fileURLWithPath: d).appendingPathComponent("uptime.json") }
    return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("PS", isDirectory: true).appendingPathComponent("uptime.json")
  }
  private func startUptime() {
    guard !upStarted else { return }
    upStarted = true
    uptime.keepDays = settings["keepDays"] as? Int ?? 30
    if testDir != nil {
      // A test copy never asks the network: fictional history only, for the page's picture.
      uptime.testFill(Self.fictionalDrops(now: Self.nowMs()), seen: Self.nowMs())
      return
    }
    uptime.load(uptimeURL)
    uptime.started(at: Self.nowMs())
    let nc = NSWorkspace.shared.notificationCenter
    nc.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: nil) { [weak self] _ in
      self?.q.async { guard let self else { return }; self.uptime.asleep(at: Self.nowMs()); self.saveUptime(force: true) }
    }
    nc.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: nil) { [weak self] _ in
      self?.q.async { guard let self else { return }; self.uptime.woke(at: Self.nowMs()); self.lastDns = nil; self.dnsAt = .distantPast }
    }
    rescheduleUp()
  }
  /// One light check every 10 s while the monitor and "Last online" are on (window open or not).
  private func rescheduleUp() {
    upTimer?.cancel(); upTimer = nil
    guard testDir == nil, upStarted, enabled, flag("uptime") else { saveUptime(force: true); return }
    let t = DispatchSource.makeTimerSource(queue: q)
    t.schedule(deadline: .now() + 3, repeating: 10, leeway: .seconds(1))
    t.setEventHandler { [weak self] in self?.upTick() }
    t.resume()
    upTimer = t
  }
  /// Everything but DNS, read now (off the main thread, short timeouts).
  private func upSignals() -> NetUptime.Signals {
    refreshKinds(); refreshRoutes()
    let p = lastPath
    let link = p?.availableInterfaces.first { $0.type == .wiredEthernet || $0.type == .wifi }
    var physical: String? = link.map { $0.type == .wifi ? "wifi" : "ethernet" }
    if physical == nil, let i = physIface { physical = kind(i).kind == "wifi" ? "wifi" : "ethernet" }
    let w = CWWiFiClient.shared().interface()
    let power = w.map { $0.powerOn() }
    let joined = w.map { $0.powerOn() && $0.rssiValue() != 0 }
    var mv: VpnApp?
    if let seen = mvSeen, Date().timeIntervalSince(seen.1) < 15 { mv = seen.0 } else { mv = vpnApp(); mvSeen = (mv, Date()) }
    let via = connLabel ?? physIface.map { kind($0).label }
    return NetUptime.Signals(physical: physical, wifiPower: power, wifiJoined: joined, route: physGateway != nil,
                             path: p.map { $0.status == .satisfied } ?? true, vpnBlocking: mv?.blocking ?? false, dns: lastDns, via: via)
  }
  private func upTick() {
    guard testDir == nil, upStarted, enabled, flag("uptime") else { return }
    var s = upSignals()
    var base = s; base.dns = nil
    let othersFine = NetUptime.verdict(base) == nil
    let every: Double = uptime.suspect ? 10 : 60
    if othersFine && !dnsBusy && (Date().timeIntervalSince(dnsAt) >= every || uptime.suspect) {
      dnsBusy = true; dnsAt = Date()
      DNSProbe.ask(on: q) { [weak self] ok in
        guard let self else { return }
        self.dnsBusy = false; self.lastDns = ok
        s.dns = ok
        self.upObserve(s)
      }
      return
    }
    if !othersFine { s.dns = nil }
    upObserve(s)
  }
  private func upObserve(_ s: NetUptime.Signals) {
    let was = uptime.online
    if uptime.observe(s, at: Self.nowMs()) {
      if was != uptime.online { psLog("PS net: last online, \(uptime.online ? "back online" : "offline (\(uptime.open?.cause ?? "?"))")") }
      send(uptime.json(now: Self.nowMs()))
    }
    saveUptime()
  }
  private func saveUptime(force: Bool = false) { if testDir == nil || force { uptime.save(uptimeURL, now: Self.nowMs(), force: force) } }
  /// FICTIONAL drops for test copies (the page's picture and the self test).
  static func fictionalDrops(now: Double) -> [NetUptime.Drop] {
    let m = 60_000.0, h = 60 * m, d = 24 * h
    return [
      NetUptime.Drop(start: now - 6 * d - 3 * h, end: now - 6 * d - 3 * h + 4 * m, cause: "wifi-lost", via: "Wi-Fi"),
      NetUptime.Drop(start: now - 3 * d - 9 * h, end: now - 3 * d - 9 * h + 47 * m, cause: "vpn", also: ["dns"], via: "Ethernet (USB 10/100/1000 LAN)"),
      NetUptime.Drop(start: now - 2 * d, end: now - 2 * d + 25_000, cause: "dns", via: "Ethernet (USB 10/100/1000 LAN)"),
      NetUptime.Drop(start: now - 20 * h, end: now - 20 * h + 2 * h, cause: "no-route", via: "Ethernet (USB 10/100/1000 LAN)", note: "slept"),
      NetUptime.Drop(start: now - 3 * h - 12 * m, end: now - 3 * h + 2 * m, cause: "vpn", via: "Ethernet (USB 10/100/1000 LAN)"),
    ]
  }
  /// Self test: the verdict and the counting rules, FICTIONAL signals only.
  static func uptimeCheck() -> String {
    typealias S = NetUptime.Signals
    let fine = S(physical: "ethernet", wifiPower: false, wifiJoined: false, route: true, path: true, vpnBlocking: false, dns: true, via: "Ethernet")
    var off = fine; off.physical = nil
    var lost = off; lost.wifiPower = true; lost.wifiJoined = false
    var cable = off; cable.wifiPower = nil
    var route = fine; route.route = false
    var vpn = fine; vpn.vpnBlocking = true
    var dns = fine; dns.dns = false
    let v = [("fine", NetUptime.verdict(fine) == nil), ("wifi-off", NetUptime.verdict(off) == "wifi-off"), ("wifi-lost", NetUptime.verdict(lost) == "wifi-lost"),
             ("no-link", NetUptime.verdict(cable) == "no-link"), ("no-route", NetUptime.verdict(route) == "no-route"), ("vpn", NetUptime.verdict(vpn) == "vpn"),
             ("dns", NetUptime.verdict(dns) == "dns")]
    // Counting: one bad look is not a drop; two 8 s apart is, from the first; back closes it; grace after wake.
    let u = NetUptime(); let t0 = 1_800_000_000_000.0
    u.started(at: t0 - 100_000)
    u.observe(fine, at: t0)
    u.observe(vpn, at: t0 + 10_000); let blip = u.online
    u.observe(fine, at: t0 + 20_000); let noBlip = u.drops.isEmpty
    u.observe(vpn, at: t0 + 30_000); u.observe(dns, at: t0 + 40_000)
    let opened = !u.online && u.open?.start == t0 + 30_000 && u.open?.cause == "vpn" && u.open?.also == ["dns"]
    u.observe(fine, at: t0 + 100_000)
    let closed = u.online && u.drops.count == 1 && u.drops[0].end == t0 + 100_000
    u.woke(at: t0 + 200_000)
    u.observe(off, at: t0 + 201_000); u.observe(off, at: t0 + 211_000); let graceHolds = u.online
    u.observe(off, at: t0 + 245_000); let afterGrace = !u.online && u.open?.start == t0 + 201_000 && u.open?.cause == "wifi-off"
    u.asleep(at: t0 + 300_000); let sleepEnds = u.online && u.drops.last?.note == "slept"
    // DNS first, then the tunnel goes: the tunnel (deeper) is the headline.
    let w = NetUptime(); w.started(at: t0 - 100_000)
    w.observe(dns, at: t0); w.observe(dns, at: t0 + 10_000); w.observe(vpn, at: t0 + 20_000)
    let deepest = w.open?.cause == "vpn" && w.open?.also == ["dns"]
    // Two bad looks only 5 s apart (a cable swap): never a drop.
    let q5 = NetUptime(); q5.started(at: t0 - 100_000)
    q5.observe(fine, at: t0); q5.observe(off, at: t0 + 1_000); q5.observe(off, at: t0 + 6_000); q5.observe(fine, at: t0 + 9_000)
    let short = q5.drops.isEmpty
    let j = u.json(now: t0 + 300_000)
    let shape = (j["drops"] as? [[String: Any]])?.count == 2 && j["online"] as? Bool == true
    // On disk: 0600, plain times and causes, and it comes back.
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("ps-uptime-\(UUID().uuidString)")
    let url = dir.appendingPathComponent("uptime.json")
    u.save(url, now: t0 + 300_000, force: true)
    let mode = ((try? FileManager.default.attributesOfItem(atPath: url.path))?[.posixPermissions] as? NSNumber)?.intValue ?? 0
    let back = NetUptime(); back.load(url)
    try? FileManager.default.removeItem(at: dir)
    let disk = mode == 0o600 && back.drops == u.drops
    let checks = v + [("blip-not-a-drop", blip && noBlip), ("drop-from-first-look", opened), ("back-closes", closed), ("wake-grace", graceHolds),
                      ("after-grace-from-first-look", afterGrace), ("sleep-ends", sleepEnds), ("deepest-cause-leads", deepest), ("5s-blip-not-a-drop", short), ("json", shape), ("disk-0600-roundtrip", disk)]
    return checks.map { "\($0.0)=\($0.1 ? "ok" : "FAIL")" }.joined(separator: " ")
  }

  // ---------- Wi-Fi (no Location: the network name stays hidden) ----------
  private func wifiJSON() -> [String: Any] {
    guard let i = CWWiFiClient.shared().interface() else { return ["available": false] }
    var o: [String: Any] = ["available": true, "iface": i.interfaceName ?? "", "power": i.powerOn()]
    guard i.powerOn() else { return o }
    let rssi = i.rssiValue(), noise = i.noiseMeasurement()
    o["rssi"] = rssi; o["noise"] = noise; o["snr"] = rssi - noise
    o["rate"] = i.transmitRate()
    if let ch = i.wlanChannel() {
      o["channel"] = ch.channelNumber
      o["band"] = [CWChannelBand.band2GHz: "2.4 GHz", .band5GHz: "5 GHz", .band6GHz: "6 GHz"][ch.channelBand] ?? ""
      o["width"] = [CWChannelWidth.width20MHz: 20, .width40MHz: 40, .width80MHz: 80, .width160MHz: 160][ch.channelWidth] ?? 0
    }
    let phy: [CWPHYMode: String] = [.mode11a: "802.11a", .mode11b: "802.11b", .mode11g: "802.11g", .mode11n: "Wi-Fi 4 (802.11n)", .mode11ac: "Wi-Fi 5 (802.11ac)", .mode11ax: "Wi-Fi 6 (802.11ax)"]
    o["phy"] = phy[i.activePHYMode()] ?? ""
    o["connected"] = rssi != 0
    return o
  }

  // ---------- speed test (Apple's networkQuality, only on request) ----------
  private var speedRunning = false, speedStarted: Date?, speedError: String?
  private func sendSpeed() {
    send(["kind": "speed", "running": speedRunning, "startedAt": (speedStarted?.timeIntervalSince1970 ?? 0) * 1000, "error": speedError ?? "", "tests": speedTests])
  }
  private func startSpeedTest() {
    guard !speedRunning else { return }
    speedRunning = true; speedStarted = Date(); speedError = nil
    sendSpeed()
    speedQ.async { [weak self] in
      guard let self else { return }
      let text = self.run("/usr/bin/networkQuality", ["-c", "-M", "20"], timeout: 60)
      self.q.async {
        self.speedRunning = false
        if let text, let d = text.data(using: .utf8), let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
           let dl = j["dl_throughput"] as? Double, let ul = j["ul_throughput"] as? Double {
          let resp = j["responsiveness"] as? Double ?? 0
          self.speedTests.append(["at": Date().timeIntervalSince1970 * 1000, "down": dl, "up": ul, "rtt": j["base_rtt"] as? Double ?? 0,
                                  "rpm": resp > 0 ? 60000 / resp : 0, "iface": j["interface_name"] as? String ?? "",
                                  "server": j["test_endpoint"] as? String ?? ""])
          if self.speedTests.count > 200 { self.speedTests.removeFirst(self.speedTests.count - 200) }
          self.dirty = true
          self.saveHistoryIfNeeded(force: true)
        } else { self.speedError = "The speed test did not finish (no answer in 60 seconds)." }
        self.sendSpeed()
      }
    }
  }

  // ---------- history: sealed on disk, key in PS's Keychain ----------
  private var historyURL: URL {
    if let d = testDir { return URL(fileURLWithPath: d).appendingPathComponent("netmon.sealed") }
    let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("PS", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    return dir.appendingPathComponent("netmon.sealed")
  }
  private var testKey: SymmetricKey?
  /// Read from the Keychain once per launch, then kept in memory (V1.44: the history is saved every minute, and a
  /// Keychain read on a timer is one more chance for macOS to ask).
  private var liveKey: SymmetricKey?
  private func key(create: Bool) -> SymmetricKey? {
    if testDir != nil { if testKey == nil { testKey = SymmetricKey(size: .bits256) }; return testKey }
    if let k = liveKey { return k }
    liveKey = NetKey.load() ?? (create ? NetKey.create() : nil)
    return liveKey
  }
  private func loadHistory() {
    guard !loaded else { return }
    loaded = true
    guard flag("history"), let data = try? Data(contentsOf: historyURL) else { return }
    guard let k = key(create: false), let box = try? AES.GCM.SealedBox(combined: data), let plain = try? AES.GCM.open(box, using: k),
          let j = try? JSONSerialization.jsonObject(with: plain) as? [String: Any] else {
      // Sealed by an older PS build whose Keychain item this build cannot read without a prompt.
      historyNote = "History started again: the saved history was sealed by an older PS app build."
      deleteHistoryFile()
      return
    }
    let saved = (j["days"] as? [String: [String: [String: [Double]]]]) ?? [:]
    for (d, v) in saved where days[d] == nil { days[d] = v }
    speedTests = ((j["speed"] as? [[String: Any]]) ?? []) + speedTests
    leakLog = ((j["leaks"] as? [[String: Any]]) ?? []) + leakLog
    vpnLog = ((j["vpn"] as? [[String: Any]]) ?? []) + vpnLog
  }
  private func saveHistoryIfNeeded(force: Bool = false) {
    guard flag("history"), dirty, force || Date().timeIntervalSince(savedAt) > 60 else { return }
    if !loaded { loadHistory() }
    let keep = Double(settings["keepDays"] as? Int ?? 30)
    let cutoff = Date().addingTimeInterval(-keep * 86400)
    let cutKey = dayKey(cutoff), cutMs = cutoff.timeIntervalSince1970 * 1000
    days = days.filter { $0.key >= cutKey }
    speedTests = speedTests.filter { ($0["at"] as? Double ?? 0) >= cutMs }
    leakLog = leakLog.filter { ($0["at"] as? Double ?? 0) >= cutMs }
    vpnLog = vpnLog.filter { ($0["at"] as? Double ?? 0) >= cutMs }
    guard let k = key(create: true),
          let plain = try? JSONSerialization.data(withJSONObject: ["v": 1, "days": days, "speed": speedTests, "leaks": leakLog, "vpn": vpnLog]),
          let sealed = try? AES.GCM.seal(plain, using: k).combined else { return }
    let url = historyURL, tmp = url.appendingPathExtension("tmp")
    FileManager.default.createFile(atPath: tmp.path, contents: sealed, attributes: [.posixPermissions: 0o600])
    _ = try? FileManager.default.replaceItemAt(url, withItemAt: tmp)
    try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    dirty = false; savedAt = Date()
  }
  private func deleteHistoryFile() { try? FileManager.default.removeItem(at: historyURL) }
  private func historyJSON() -> [String: Any] {
    let list = days.keys.sorted().suffix(Int(settings["keepDays"] as? Int ?? 30)).map { d -> [String: Any] in
      let k = days[d]?["k"] ?? [:]
      let apps = (days[d]?["a"] ?? [:]).sorted { $0.value[0] + $0.value[1] > $1.value[0] + $1.value[1] }.prefix(8).map { ["name": $0.key, "rx": $0.value[0], "tx": $0.value[1]] }
      return ["day": d, "k": k, "apps": Array(apps)]
    }
    return ["kind": "history", "on": flag("history"), "days": list, "note": historyNote ?? ""]
  }

  /// Self test: are app rows from protected apps dropped at parse? Uses FICTIONAL nettop text only.
  static func goldenRuleCheck() -> String {
    let fake = """
    ,interface,state,bytes_in,bytes_out,
    Safari.101,,,500,600,
    tcp4 10.0.0.2:5000<->17.1.2.3:443,utun4,Established,500,600,
    1Password.202,,,700,800,
    tcp4 10.0.0.2:5001<->3.4.5.6:443,utun4,Established,700,800,
    Signal Helper (Renderer).303,,,900,100,
    tcp4 10.0.0.2:5002<->5.6.7.8:443,en0,Established,900,100,
    Slack Helper.404,,,10,20,
    tcp4 10.0.0.2:5003<->52.1.1.1:443,en0,Established,10,20,
    """
    let fakeInfo: (String, Int32) -> ProcInfo? = { name, pid in
      let paths: [Int32: String] = [101: "/Applications/Safari.app/Contents/MacOS/Safari", 404: "/Applications/Slack.app/Contents/Frameworks/Slack Helper.app/Contents/MacOS/Slack Helper",
                                    202: "/Applications/1Password.app/Contents/MacOS/1Password", 303: "/Applications/Signal.app/Contents/Frameworks/Signal Helper (Renderer).app/x"]
      if Protected.matches(paths[pid]) { return nil }
      return ProcInfo(app: name.replacingOccurrences(of: " Helper", with: ""), bundle: nil, system: false)
    }
    let rows = parse(fake, info: fakeInfo)
    let names = rows.map { $0.app }
    let conns = rows.reduce(0) { $0 + $1.conns.count }
    let clean = !names.contains { Protected.matches($0) } && rows.allSatisfy { !Protected.matches($0.name) }
    return "rows=\(names.joined(separator: "+")) conns=\(conns) protected-dropped=\(clean && rows.count == 2 && conns == 2 ? "ok" : "FAIL")"
  }
  /// Self test: is history on disk sealed (no plain text) with 0600?
  func privacyCheck(_ done: @escaping (String) -> Void) {
    q.async { [self] in
      dirty = true
      saveHistoryIfNeeded(force: true)
      let url = historyURL
      let data = (try? Data(contentsOf: url)) ?? Data()
      let mode = ((try? FileManager.default.attributesOfItem(atPath: url.path))?[.posixPermissions] as? NSNumber)?.intValue ?? 0
      let plain = String(data: data, encoding: .utf8).map { $0.contains("\"days\"") } ?? false
      let opens = (try? AES.GCM.open(AES.GCM.SealedBox(combined: data), using: key(create: false)!)) != nil
      let r = "file=\(data.count)B mode=\(String(mode, radix: 8)) sealed=\(!plain && opens ? "ok" : "FAIL") perms=\(mode == 0o600 ? "ok" : "FAIL") sentWhileClosed=\(isOpen ? "open" : "none")"
      DispatchQueue.main.async { done(r) }
    }
  }
}

/// The history key: 256 random bits in PS's own Keychain item (this Mac only), one per PS build like
/// Remember (a newer build cannot read an older build's item without a password prompt, and PS
/// never prompts). Every call has prompts switched off.
enum NetKey {
  static let service = "com.cincee.ps.netmon"
  static var account: String { "key-" + Remember.account }
  private static func quietly<T>(_ body: () -> T) -> T {
    KeychainQuiet.run(body)   // one lock for the whole app (KeychainQuiet.swift)
  }
  private static var base: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account] }
  static func load() -> SymmetricKey? {
    var q = base
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    guard quietly({ SecItemCopyMatching(q as CFDictionary, &out) }) == errSecSuccess, let d = out as? Data, d.count == 32 else { return nil }
    return SymmetricKey(data: d)
  }
  static func create() -> SymmetricKey? {
    let k = SymmetricKey(size: .bits256)
    let data = k.withUnsafeBytes { Data($0) }
    _ = quietly { SecItemDelete(base as CFDictionary) }
    var q = base
    q[kSecValueData as String] = data
    q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    q[kSecAttrSynchronizable as String] = false
    q[kSecAttrLabel as String] = "PS network history key (this Mac only)"
    return quietly({ SecItemAdd(q as CFDictionary, nil) }) == errSecSuccess ? k : nil
  }
}

// MARK: - Self test (invisible copy, FICTIONAL parse data for the golden rule, real network otherwise)
extension SelfTest {
  static func netMonitor(_ a: App, _ dir: String, _ done: @escaping () -> Void) {
    print("NET GOLDEN CHECK:", NetMonitor.goldenRuleCheck())
    print("NET UPTIME CHECK:", NetMonitor.uptimeCheck())
    let page = "JSON.stringify({win: !!document.querySelector('.nm-win'), tab: (document.querySelector('.nm-head .cs-tabs .on') || {}).textContent || null, apps: document.querySelectorAll('.nm-apps tbody tr').length, conns: document.querySelectorAll('.nm-conns tbody tr').length, ifaces: document.querySelectorAll('.nm-ifs li').length, vpn: (document.querySelector('.nm-head .nm-pill') || {}).textContent || null, drops: document.querySelectorAll('.nm-drops li').length, devices: document.querySelectorAll('.nm-devs li').length, lastOnline: (document.querySelector('.nm-uphero h3') || {}).textContent || null, protectedInTables: /1password|agilebits|whispersystems|signal/i.test([...document.querySelectorAll('.nm-apps, .nm-conns, .nm-ifs, .nm-leaks, .nm-log, .nm-drops, .nm-devs')].map(function(e){return e.innerText}).join(' '))})"
    let views: [(String, Double)] = [("live", 5), ("apps", 1.5), ("vpn", 1.2), ("speed", 1.2), ("wifi", 1.2), ("history", 1.2), ("uptime", 1.2), ("settings", 1.2)]
    func show(_ i: Int) {
      guard i < views.count else { return speedThenClose() }
      let (v, wait) = views[i]
      let js = i == 0 ? "window.dispatchEvent(new CustomEvent('ps-net-open', {detail: 'live'}))" : "window.dispatchEvent(new CustomEvent('nm-tab', {detail: '\(v)'}))"
      a.overlay.evaluateJavaScript(js, completionHandler: nil)
      DispatchQueue.main.asyncAfter(deadline: .now() + wait) {
        a.overlay.evaluateJavaScript(page) { r, _ in print("NET \(v.uppercased()):", r ?? "nothing", "flag=\(a.dimxOpen)") }
        snap(a.overlay, "\(dir)/net-\(v).png") { show(i + 1) }
      }
    }
    // The speed test uses the real network for about 20 s, so only when asked (PS_SELFTEST_NETSPEED=1).
    func speedThenClose() {
      guard ProcessInfo.processInfo.environment["PS_SELFTEST_NETSPEED"] == "1" else { return close() }
      a.overlay.evaluateJavaScript("window.dispatchEvent(new CustomEvent('nm-tab', {detail: 'speed'})); setTimeout(function(){ var b=document.querySelector('.nm-run'); if (b) b.click(); }, 400)", completionHandler: nil)
      DispatchQueue.main.asyncAfter(deadline: .now() + 30) {
        a.overlay.evaluateJavaScript("(document.querySelector('.cs-tiles') || {}).innerText || 'no result'") { r, _ in print("NET SPEED RESULT:", String(describing: r ?? "nothing").replacingOccurrences(of: "\n", with: " ")) }
        snap(a.overlay, "\(dir)/net-speed-result.png") { close() }
      }
    }
    func close() {
      a.overlay.evaluateJavaScript("!!(window.__psDimxClose && window.__psDimxClose())") { r, _ in
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
          NetMonitor.shared.sent { before in
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
              NetMonitor.shared.sent { after in
                a.overlay.evaluateJavaScript("!!document.querySelector('.nm-win')") { still, _ in
                  print("NET CLOSE CHECK:", "esc-closes=\((r as? Bool) == true && (still as? Bool) == false ? "ok" : "FAIL")", "nothing-sent-while-closed=\(after == before ? "ok" : "FAIL (\(after - before))")", "list-still-up=\(a.shown ? "ok" : "FAIL")")
                  NetMonitor.shared.privacyCheck { p in print("NET PRIVACY CHECK:", p); netCards(dir, done) }
                }
              }
            }
          }
        }
      }
    }
    show(0)
  }
}

// MARK: - Self test: the network cards (18 Oct fixes and new cards). FICTIONAL inputs only.
extension SelfTest {
  static func netCards(_ dir: String, _ done: @escaping () -> Void) {
    typealias N = NetMonitor
    // idx-N names: the VPN's own index must come back as its name; an unknown index as nothing.
    let lo = if_nametoindex("lo0")
    let names = N.ifaceName("idx-\(lo)") == "lo0" && N.ifaceName("idx-99999") == "" && N.ifaceName("en5") == "en5"
    // The leak rule.
    let relays: Set<String> = ["146.70.134.2", "138.199.6.233"]
    func v(_ ip: String, _ i: String, _ rx: UInt64, _ tx: UInt64, app: String = "Brave Browser", st: String = "SynSent") -> String {
      N.leakVerdict(remote: ip, iface: i, rx: rx, tx: tx, state: st, app: app, bundle: nil, relays: relays).rawValue
    }
    let rule = [("both-ways-is-leak", v("52.1.1.1", "en5", 900, 400, st: "Established") == "leak"),
                ("nothing-back-is-blocked", v("52.1.1.1", "en5", 0, 120) == "blocked"),
                ("unnamed-interface-is-fine", v("52.1.1.1", "", 900, 400) == "fine" && v("52.1.1.1", "idx-21", 900, 400) == "fine"),
                ("tunnel-is-fine", v("52.1.1.1", "utun4", 900, 400) == "fine"),
                ("relay-is-fine", v("146.70.134.2", "en5", 900, 400) == "fine"),
                ("vpn-app-itself-is-fine", v("52.1.1.1", "en5", 900, 400, app: "vpn-daemon") == "fine"),
                ("private-address-is-fine", v("192.168.18.1", "en5", 900, 400) == "fine")]
    // the VPN app's JSON and the cards for each change.
    let json = #"{"state":"connected","details":{"endpoint":{"address":"138.199.6.233:51820","entry_endpoint":{"address":"146.70.134.2:54822"},"obfuscation":{"Single":{"endpoint":{"address":"146.70.134.2:10571"}}},"tunnel_interface":"utun4"},"location":{"city":"Zurich","country":"Switzerland","hostname":"ch-zrh-wg-404","entry_hostname":"ch-zrh-wg-501"},"feature_indicators":["LockdownMode","Multihop"]}}"#
    let up = N.parseVpnApp((try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any]) ?? [:])!
    var conn = up; conn.state = "connecting"
    var off = up; off.state = "disconnected"; off.lockdown = false
    var moved = up; moved.host = "de-fra-wg-007"; moved.city = "Frankfurt"; moved.country = "Germany"
    let reconnect = N.vpnCard(prev: up, now: conn, downFor: nil, physical: "en5")
    let back = N.vpnCard(prev: conn, now: up, downFor: 42, physical: "en5")
    let server = N.vpnCard(prev: up, now: moved, downFor: nil, physical: "en5")
    let gone = N.vpnCard(prev: up, now: off, downFor: nil, physical: "en5")
    let mv = [("relays", up.relays == ["138.199.6.233", "146.70.134.2"]), ("city", up.city == "Zurich"), ("lockdown", up.lockdown),
              ("reconnecting-is-calm-amber", reconnect?["tone"] as? String == "warn" && reconnect?["title"] as? String == "VPN reconnecting"),
              ("never-off-while-blocking", (reconnect?["title"] as? String ?? "").contains("OFF") == false),
              ("back-says-city-and-time", back?["title"] as? String == "VPN connected, Zurich" && back?["body"] as? String == "Back after 42 s."),
              ("server-change", server?["tone"] as? String == "info"), ("really-off-is-red", gone?["tone"] as? String == "bad"),
              ("first-look-no-card", N.vpnCard(prev: nil, now: up, downFor: nil, physical: "en5") == nil)]
    print("NET CARDS CHECK:", "names=\(names ? "ok" : "FAIL")", (rule + mv).map { "\($0.0)=\($0.1 ? "ok" : "FAIL")" }.joined(separator: " "))
    // Pictures of each card, one at a time, from the invisible pop-up panel.
    let cards: [(String, [String: Any])] = [
      ("net-card-reconnecting", reconnect!), ("net-card-connected", back!), ("net-card-server", server!), ("net-card-off", gone!),
      ("net-card-offline", N.offlineCard()), ("net-card-online", N.onlineCard(down: 200, label: "Ethernet (USB 10/100/1000 LAN)")),
      ("net-card-conn", N.connCard(now: "iPhone hotspot (Wi-Fi)", was: "Ethernet (USB 10/100/1000 LAN)")),
      ("net-card-leak", N.leakCard(app: "Example Browser", iface: "en5", label: "USB 10/100/1000 LAN", ip: "52.1.1.1", port: 443, cc: "US", count: 3)),
    ]
    // The exact cards, for pictures made outside PS (parked test windows do not draw).
    if let d = try? JSONSerialization.data(withJSONObject: cards.map { ["name": $0.0, "card": $0.1] }) { try? d.write(to: URL(fileURLWithPath: "\(dir)/net-cards.json")) }
    let t = Toast.shared
    func next(_ i: Int) {
      guard i < cards.count else { return done() }
      t.showMeet(cards[i].1)
      // The first card follows the meeting cards' "Clear all" straight away: give the panel longer to settle.
      DispatchQueue.main.asyncAfter(deadline: .now() + (i == 0 ? 2.2 : 1.3)) {
        snap(t.web, "\(dir)/\(cards[i].0).png") {
          t.web.evaluateJavaScript("document.getElementById('clear').click()", completionHandler: nil)
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { next(i + 1) }
        }
      }
    }
    // The pop-up panel may not exist yet at this point of the run: make it once (a card, then clear) so
    // the test copy's drawing setup has caught its web view before the first picture.
    t.showMeet(["id": "net-warmup", "tone": "info", "title": "Warming up"])
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
      t.web.evaluateJavaScript("document.getElementById('clear').click()", completionHandler: nil)
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { next(0) }
    }
  }
}

