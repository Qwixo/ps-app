// "Last online" (the developer, 4 Nov 2026, right after his internet dropped): when this Mac was last on the
// internet, and every drop with its start, end, length and the likely cause. Shown in the network
// monitor's "Last online" tab (web src/views/NetMonitor.tsx).
//
// What counts as online: a physical link (Ethernet or Wi-Fi), a router to go out through, the VPN not
// blocking (the VPN app reconnecting or in lockdown lets nothing out), and DNS answering. The first one that
// fails is the cause. Everything except DNS is read from what PS already watches (NWPathMonitor,
// CoreWLAN, the routing table, the VPN app's own CLI). DNS is one lookup of a made up name under cincee.com
// (so no cache can answer it) through macOS's own resolver: once a minute while online, every 10 s while
// a drop is open. PS itself opens no socket for it (mDNSResponder asks, through the VPN like everything
// else), there is no new server, and nothing goes to the vault or Supabase.
//
// A drop counts once it is seen twice at least 8 s apart, so a Wi-Fi roam or a cable swap is not one.
// After a wake or a launch there is 40 s of grace (the network always takes a moment to come back); a
// drop that is still there after it starts from when it was first seen. Sleep ends an open drop.
//
// Saved on this Mac only: ~/Library/Application Support/PS/uptime.json, 0600, at most every 5 minutes
// and at each change. Times and causes only (no network names, addresses or apps), so it is not sealed:
// the history key changes with every PS build and would wipe it at each update. Kept 30 days or the
// history's "Keep for", whichever is longer; at most 2000 drops.
import Foundation
import dnssd

final class NetUptime {
  /// What the Mac looks like at one check. `dns` nil = not asked this time.
  struct Signals {
    var physical: String?        // "wifi" | "ethernet" | nil (no link at all)
    var wifiPower: Bool?         // nil = no Wi-Fi hardware
    var wifiJoined: Bool?
    var route: Bool              // a physical router (default route outside the tunnel)
    var path: Bool               // NWPathMonitor says satisfied
    var vpnBlocking: Bool        // The VPN app lets nothing out (reconnecting, error, lockdown while off)
    var dns: Bool?
    var via: String?             // "Wi-Fi", "Ethernet (USB LAN)", ... for the record
  }
  struct Drop: Equatable {
    var start: Double; var end: Double?; var cause: String; var also: [String]; var via: String; var note: String
    var json: [String: Any] {
      var o: [String: Any] = ["start": start, "cause": cause, "also": also, "via": via, "note": note]
      if let end { o["end"] = end }
      return o
    }
    init(start: Double, end: Double? = nil, cause: String, also: [String] = [], via: String = "", note: String = "") {
      self.start = start; self.end = end; self.cause = cause; self.also = also; self.via = via; self.note = note
    }
    init?(_ j: [String: Any]) {
      guard let s = (j["start"] as? NSNumber)?.doubleValue, let c = j["cause"] as? String, NetUptime.causes.contains(c) else { return nil }
      start = s; end = (j["end"] as? NSNumber)?.doubleValue; cause = c
      also = ((j["also"] as? [String]) ?? []).filter { NetUptime.causes.contains($0) }
      via = String((j["via"] as? String ?? "").prefix(60)); note = String((j["note"] as? String ?? "").prefix(20))
    }
  }
  static let causes: Set<String> = ["wifi-off", "wifi-lost", "no-link", "no-route", "vpn", "dns", "unknown"]
  /// Deepest first: a lost link explains a dead tunnel, a dead tunnel explains failing DNS. A drop's headline cause is
  /// always the deepest one seen during it; the others stay in `also`.
  static let depth = ["wifi-off", "wifi-lost", "no-link", "no-route", "vpn", "dns", "unknown"]
  static func deeper(_ a: String, _ b: String) -> Bool { (depth.firstIndex(of: a) ?? 99) < (depth.firstIndex(of: b) ?? 99) }
  /// Adds `c` to the drop, making it the headline if it is deeper.
  static func add(_ c: String, to d: inout Drop) {
    if c == d.cause || d.also.contains(c) { return }
    if deeper(c, d.cause) { d.also.insert(d.cause, at: 0); d.cause = c } else { d.also.append(c) }
  }
  static let confirmAfter = 8_000.0, grace = 40_000.0, maxDrops = 2000   // ms, like every time here

  /// nil = online, else the first thing that is wrong.
  static func verdict(_ s: Signals) -> String? {
    if s.physical == nil {
      if s.wifiPower == false { return "wifi-off" }
      if s.wifiPower == true && s.wifiJoined == false { return "wifi-lost" }
      return "no-link"
    }
    if !s.route || !s.path { return "no-route" }
    if s.vpnBlocking { return "vpn" }
    if s.dns == false { return "dns" }
    return nil
  }

  private(set) var drops: [Drop] = []          // oldest first; the last may be open (end nil)
  private(set) var seenAt: Double = 0          // the last check of any kind
  private(set) var goodAt: Double = 0          // the last check that said online
  private(set) var upSince: Double = 0         // online since (this run: first good check, or the last drop's end)
  private var pending: (at: Double, cause: String)?
  private var graceUntil: Double = 0
  private(set) var dirty = false
  private var savedAt: Double = 0
  var keepDays = 30

  var open: Drop? { drops.last.flatMap { $0.end == nil ? $0 : nil } }
  /// Online right now: no open drop and nothing pending confirmation.
  var online: Bool { open == nil }

  /// PS started (or a test copy): drops left open by a PS that stopped are closed at its last check.
  func started(at now: Double) {
    if let i = drops.indices.last, drops[i].end == nil {
      drops[i].end = max(drops[i].start, seenAt > 0 ? seenAt : drops[i].start); drops[i].note = "ps-stopped"; dirty = true
    }
    graceUntil = now + Self.grace
    pending = nil
  }
  func asleep(at now: Double) {
    if let i = drops.indices.last, drops[i].end == nil { drops[i].end = now; drops[i].note = "slept"; dirty = true }
    pending = nil
    seenAt = now
  }
  func woke(at now: Double) { graceUntil = now + Self.grace; pending = nil; upSince = 0 }

  /// One check. Returns true when something the page shows changed.
  @discardableResult
  func observe(_ s: Signals, at now: Double) -> Bool {
    seenAt = now
    let cause = Self.verdict(s)
    if let i = drops.indices.last, drops[i].end == nil {
      if cause == nil {                                   // back
        drops[i].end = now; pending = nil; upSince = now; goodAt = now; dirty = true
        return true
      }
      if let c = cause, c != drops[i].cause, !drops[i].also.contains(c) { Self.add(c, to: &drops[i]); dirty = true; return true }
      return false
    }
    guard let c = cause else {
      let was = pending != nil
      pending = nil; goodAt = now
      if upSince == 0 { upSince = now; return true }
      return was
    }
    guard let p = pending else { pending = (now, c); return false }
    if now - p.at < Self.confirmAfter || now < graceUntil { return false }
    var d = Drop(start: p.at, cause: p.cause, via: s.via ?? "")
    Self.add(c, to: &d)
    drops.append(d)
    if drops.count > Self.maxDrops { drops.removeFirst(drops.count - Self.maxDrops) }
    pending = nil; dirty = true
    return true
  }
  /// A drop is suspected (one bad look, not confirmed yet): check again soon.
  var suspect: Bool { pending != nil || open != nil }

  func prune(now: Double) {
    let cut = now - Double(max(30, keepDays)) * 86_400_000
    let before = drops.count
    drops.removeAll { ($0.end ?? now) < cut }
    if drops.count != before { dirty = true }
  }

  /// For the page: {kind:"uptime", ...}. Times in ms since 1970.
  func json(now: Double) -> [String: Any] {
    var o: [String: Any] = ["kind": "uptime", "online": online, "checkedAt": seenAt, "goodAt": goodAt, "keepDays": max(30, keepDays),
                            "drops": drops.suffix(500).reversed().map { $0.json }]
    if let d = open { o["since"] = d.start; o["cause"] = d.cause }
    else { o["since"] = upSince > 0 ? upSince : (drops.last?.end ?? 0) }
    return o
  }

  // ---------- on disk ----------
  func load(_ url: URL) {
    guard let d = try? Data(contentsOf: url), let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return }
    drops = ((j["drops"] as? [[String: Any]]) ?? []).compactMap(Drop.init).sorted { $0.start < $1.start }
    for i in drops.indices.dropLast() where drops[i].end == nil { drops[i].end = drops[i].start; drops[i].note = "ps-stopped" }
    seenAt = (j["seenAt"] as? NSNumber)?.doubleValue ?? 0
    goodAt = (j["goodAt"] as? NSNumber)?.doubleValue ?? 0
  }
  func save(_ url: URL, now: Double, force: Bool = false) {
    guard dirty || force || now - savedAt > 300_000 else { return }
    prune(now: now)
    let o: [String: Any] = ["v": 1, "seenAt": seenAt, "goodAt": goodAt, "drops": drops.map { $0.json }]
    guard let data = try? JSONSerialization.data(withJSONObject: o) else { return }
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let tmp = url.appendingPathExtension("tmp")
    FileManager.default.createFile(atPath: tmp.path, contents: data, attributes: [.posixPermissions: 0o600])
    if FileManager.default.fileExists(atPath: url.path) { _ = try? FileManager.default.replaceItemAt(url, withItemAt: tmp) }
    else { try? FileManager.default.moveItem(at: tmp, to: url) }
    try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    dirty = false; savedAt = now
  }
  /// The developer pressed Clear: every finished drop goes; an open one stays (it is still happening).
  func clear(at now: Double) { drops = open.map { [$0] } ?? []; dirty = true }
  /// Self test: fictional history for the page's picture.
  func testFill(_ list: [Drop], seen: Double) { drops = list; seenAt = seen; goodAt = seen; upSince = list.last?.end ?? seen; dirty = true }
}

/// One DNS question through macOS's resolver (mDNSResponder asks; PS opens no socket). Any answer,
/// "no such name" included, means DNS works; no answer within `timeout` means it does not.
/// `done` runs on `q` (the network monitor's queue) exactly once.
enum DNSProbe {
  private static let probeQ = DispatchQueue(label: "PS net dns probe", qos: .utility)
  private final class Box {
    var ref: DNSServiceRef?; var finished = false; let done: (Bool) -> Void; let q: DispatchQueue
    init(_ q: DispatchQueue, _ done: @escaping (Bool) -> Void) { self.q = q; self.done = done }
    func finish(_ ok: Bool) {                    // on probeQ only
      guard !finished else { return }
      finished = true
      if let r = ref { DNSServiceRefDeallocate(r); ref = nil }
      let d = done
      q.async { d(ok) }
      Unmanaged.passUnretained(self).release()   // balances passRetained in ask
    }
  }
  /// A name nobody has asked before, so no cache on the way can answer it.
  static func freshName() -> String {
    let hex = (0..<6).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
    return "ps-check-\(hex).cincee.com"
  }
  static func ask(_ name: String = freshName(), timeout: Double = 5, on q: DispatchQueue, done: @escaping (Bool) -> Void) {
    probeQ.async {
      let box = Box(q, done)
      let ctx = Unmanaged.passRetained(box).toOpaque()
      var ref: DNSServiceRef?
      let err = DNSServiceQueryRecord(&ref, DNSServiceFlags(kDNSServiceFlagsReturnIntermediates), 0, name,
                                      UInt16(kDNSServiceType_A), UInt16(kDNSServiceClass_IN), { _, _, _, code, _, _, _, _, _, _, ctx in
        guard let ctx else { return }
        let b = Unmanaged<Box>.fromOpaque(ctx).takeUnretainedValue()
        b.finish(code == kDNSServiceErr_NoError || code == kDNSServiceErr_NoSuchRecord || code == kDNSServiceErr_NoSuchName)
      }, ctx)
      guard err == kDNSServiceErr_NoError, let ref else { box.finish(false); return }
      box.ref = ref
      if DNSServiceSetDispatchQueue(ref, probeQ) != kDNSServiceErr_NoError { box.finish(false); return }
      probeQ.asyncAfter(deadline: .now() + timeout) { box.finish(false) }
    }
  }
}
