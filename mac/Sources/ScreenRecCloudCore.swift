// Screen recorder, cloud and library rules (PS 1.60, pull request 12c). Pure values, Foundation and CryptoKit only: no AppKit, no
// network, no Keychain, no windows, so mac/tests/screenrec-cloud-test.sh checks every rule with fake files and a fake cloud.
//
// What lives here:
//  - the three provider hashes (Google Drive md5 and sha256, Dropbox content_hash, OneDrive QuickXorHash), streamed in chunks;
//  - sealing a recording to the person's key before upload (chunked AES-GCM, never a whole recording in memory) and opening it;
//  - the waiting rules (recording, hot Mac, battery under 20 percent, Low Power Mode, constrained or expensive network),
//    the retry back off, and the one rule that matters most: a local copy is NEVER deleted before the upload is checked;
//  - "keep the last X days on this Mac";
//  - the recordings library (newest first, where each one is, rename, delete that asks first);
//  - playback numbers (speed, skip 15 seconds, the Me and Them volumes);
//  - what the island shows while uploading (a ring) and when done, and how private mode hides both.
// The providers and the engine are in ScreenRecCloudProviders.swift, the real network, Keychain and windows in ScreenRecCloud.swift.
import Foundation
import CryptoKit

// ---------- providers ----------
enum SRCloudProvider: String, Codable, CaseIterable {
  case none, googleDrive, iCloud, dropbox, oneDrive, folder
  var label: String {
    switch self { case .none: return "Nowhere (keep on this Mac)"; case .googleDrive: return "Google Drive"; case .iCloud: return "iCloud Drive"
    case .dropbox: return "Dropbox"; case .oneDrive: return "OneDrive"; case .folder: return "Any folder" }
  }
  /// A short name for sentences ("the copy in Google Drive").
  var short: String { self == .folder ? "the folder" : self == .none ? "the cloud" : label }
  /// Uploaded through the provider's own API with the person's own login (and checked with the provider's hash).
  var usesAPI: Bool { self == .googleDrive || self == .dropbox || self == .oneDrive }
  /// Copied into a folder on this Mac (an iCloud Drive folder, or any folder).
  var usesFolder: Bool { self == .iCloud || self == .folder }
  var hashKind: SRHashKind? { switch self { case .googleDrive: return .sha256; case .dropbox: return .dropbox; case .oneDrive: return .quickXor; case .iCloud, .folder: return .sha256; case .none: return nil } }
}
enum SRHashKind: String, Codable, CaseIterable { case md5, sha256, dropbox, quickXor }

/// The person's cloud choices (kept on this Mac only). Logins are NOT in here: they live in the Keychain.
struct SRCloudSettings: Equatable, Codable {
  var provider: SRCloudProvider = .none
  /// "Remove from this Mac after upload": on by default. Only ever happens after the upload is checked.
  var removeAfter = true
  /// "Keep the last X days on this Mac": a checked upload is removed from the Mac only after this many days.
  var keepDays = 7
  /// "Encrypt uploads so only PS can play them": off by default so recordings still play in the cloud itself.
  var encrypt = false
  var folderName: String? = nil
  init() {}
  init(from d: Decoder) throws {
    let c = try d.container(keyedBy: K.self)
    func get<T: Decodable>(_ k: K, _ def: T) -> T { (try? c.decodeIfPresent(T.self, forKey: k)) ?? def }
    provider = get(.provider, SRCloudProvider.none); removeAfter = get(.removeAfter, true)
    keepDays = max(0, min(365, get(.keepDays, 7))); encrypt = get(.encrypt, false); folderName = get(.folderName, String?.none)
  }
  enum K: String, CodingKey { case provider, removeAfter, keepDays, encrypt, folderName }
}

// ---------- hashes ----------
private func srHex<S: Sequence>(_ s: S) -> String where S.Element == UInt8 { s.map { String(format: "%02x", $0) }.joined() }

struct SRHashes: Equatable, Codable {
  var size: Int64 = 0
  var md5: String?
  var sha256: String?
  var dropbox: String?
  var quickXor: String?
  func value(_ k: SRHashKind) -> String? { switch k { case .md5: return md5; case .sha256: return sha256; case .dropbox: return dropbox; case .quickXor: return quickXor } }
}

/// Dropbox content_hash: 4 MiB blocks, SHA-256 of each, SHA-256 of the joined raw digests, hex.
struct SRDropboxHash {
  static let blockSize = 4 * 1024 * 1024
  private var block = Data()
  private var digests = Data()
  mutating func update(_ d: Data) {
    var off = 0
    while off < d.count {
      let n = min(Self.blockSize - block.count, d.count - off)
      block.append(d.subdata(in: (d.startIndex + off)..<(d.startIndex + off + n))); off += n
      if block.count == Self.blockSize { digests.append(contentsOf: SHA256.hash(data: block)); block.removeAll(keepingCapacity: true) }
    }
  }
  mutating func finish() -> String {
    if !block.isEmpty { digests.append(contentsOf: SHA256.hash(data: block)); block.removeAll() }
    return srHex(SHA256.hash(data: digests))
  }
}

/// OneDrive QuickXorHash (Microsoft's published algorithm): 160 bit state, 11 bit shift per byte, the length XORed into the end, base64.
struct SRQuickXor {
  private var cells: [UInt64] = [0, 0, 0]
  private var length: Int64 = 0
  private var shiftSoFar = 0
  mutating func update(_ d: Data) {
    d.withUnsafeBytes { raw in
      let a = raw.bindMemory(to: UInt8.self)
      let cb = a.count
      if cb == 0 { return }
      var arrIdx = shiftSoFar / 64, off = shiftSoFar % 64
      for i in 0..<min(cb, 160) {
        let isLast = arrIdx == cells.count - 1
        let bits = isLast ? 32 : 64
        if off <= bits - 8 {
          var j = i
          while j < cb { cells[arrIdx] ^= UInt64(a[j]) << UInt64(off); j += 160 }
        } else {
          let i2 = isLast ? 0 : arrIdx + 1
          let low = bits - off
          var x: UInt8 = 0
          var j = i
          while j < cb { x ^= a[j]; j += 160 }
          cells[arrIdx] ^= UInt64(x) << UInt64(off)
          cells[i2] ^= UInt64(x) >> UInt64(low)
        }
        off += 11
        while off >= bits { arrIdx = isLast ? 0 : arrIdx + 1; off -= bits }
      }
      shiftSoFar = (shiftSoFar + 11 * (cb % 160)) % 160
      length += Int64(cb)
    }
  }
  func finish() -> String {
    var out = [UInt8](repeating: 0, count: 20)
    for c in 0..<2 { for b in 0..<8 { out[c * 8 + b] = UInt8((cells[c] >> UInt64(8 * b)) & 0xff) } }
    for b in 0..<4 { out[16 + b] = UInt8((cells[2] >> UInt64(8 * b)) & 0xff) }
    var len = UInt64(bitPattern: length)
    for i in 0..<8 { out[12 + i] ^= UInt8(len & 0xff); len >>= 8 }
    return Data(out).base64EncodedString()
  }
}

enum SRFileHash {
  /// One pass over the file, only the hashes asked for. Reads 1 MiB at a time.
  static func compute(_ url: URL, kinds: Set<SRHashKind>) throws -> SRHashes {
    let fh = try FileHandle(forReadingFrom: url)
    defer { try? fh.close() }
    var md5 = Insecure.MD5(), sha = SHA256(), db = SRDropboxHash(), qx = SRQuickXor()
    var out = SRHashes()
    while true {
      guard let d = try fh.read(upToCount: 1 << 20), !d.isEmpty else { break }
      out.size += Int64(d.count)
      if kinds.contains(.md5) { md5.update(data: d) }
      if kinds.contains(.sha256) { sha.update(data: d) }
      if kinds.contains(.dropbox) { db.update(d) }
      if kinds.contains(.quickXor) { qx.update(d) }
    }
    if kinds.contains(.md5) { out.md5 = srHex(md5.finalize()) }
    if kinds.contains(.sha256) { out.sha256 = srHex(sha.finalize()) }
    if kinds.contains(.dropbox) { out.dropbox = db.finish() }
    if kinds.contains(.quickXor) { out.quickXor = qx.finish() }
    return out
  }
  static func hex(_ d: Data) -> String { srHex(d) }
  static func sha256Hex(_ d: Data) -> String { srHex(SHA256.hash(data: d)) }
  static func md5Hex(_ d: Data) -> String { srHex(Insecure.MD5.hash(data: d)) }
}

// ---------- sealing a recording to the person's key (streamed, never the whole file in memory) ----------
// File: "PSRC" 1 byte version, 4 bytes chunk size (big endian), 16 bytes salt, then chunks. Each chunk is AES-GCM sealed with a key
// worked out from the person's key and the salt, a nonce from the chunk number, and the header, the chunk number and a "last chunk"
// flag as extra data. So a chunk cannot be moved, repeated or cut off at the end without opening failing.
enum SRSealError: Error, Equatable { case notSealed, wrongKey, damaged }
enum SRSeal {
  static let magic: [UInt8] = [0x50, 0x53, 0x52, 0x43]   // PSRC
  static let chunk = 1 << 20
  static let overhead = 16
  static func key(master: Data, salt: Data) -> SymmetricKey {
    HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: master), salt: salt, info: Data("ps-recording-seal-v1".utf8), outputByteCount: 32)
  }
  private static func nonce(_ i: UInt64) throws -> AES.GCM.Nonce {
    var d = Data(repeating: 0, count: 4)
    var b = i.bigEndian; d.append(Data(bytes: &b, count: 8))
    return try AES.GCM.Nonce(data: d)
  }
  private static func aad(_ header: Data, _ i: UInt64, last: Bool) -> Data {
    var d = header; var b = i.bigEndian
    d.append(Data(bytes: &b, count: 8)); d.append(last ? 1 : 0)
    return d
  }
  /// Seals `src` into `dst`. Returns the sealed size.
  @discardableResult static func seal(_ src: URL, to dst: URL, master: Data, chunkSize: Int = chunk, salt: Data? = nil) throws -> Int64 {
    let salt = salt ?? Data((0..<16).map { _ in UInt8.random(in: 0...255) })
    var header = Data(magic); header.append(1)
    var cs = UInt32(chunkSize).bigEndian; header.append(Data(bytes: &cs, count: 4)); header.append(salt)
    let k = key(master: master, salt: salt)
    FileManager.default.createFile(atPath: dst.path, contents: nil)
    let out = try FileHandle(forWritingTo: dst), inp = try FileHandle(forReadingFrom: src)
    defer { try? out.close(); try? inp.close() }
    try out.write(contentsOf: header)
    var i: UInt64 = 0
    var cur = try inp.read(upToCount: chunkSize) ?? Data()
    while true {
      let next = cur.count == chunkSize ? (try inp.read(upToCount: chunkSize) ?? Data()) : Data()
      let last = next.isEmpty
      let box = try AES.GCM.seal(cur, using: k, nonce: try nonce(i), authenticating: aad(header, i, last: last))
      try out.write(contentsOf: box.ciphertext + box.tag)
      if last { break }
      cur = next; i += 1
    }
    try out.synchronize()
    return Int64(try FileManager.default.attributesOfItem(atPath: dst.path)[.size] as? Int ?? 0)
  }
  /// Opens `src` into `dst`. Throws notSealed, wrongKey or damaged; on any error the partial output is removed.
  static func open(_ src: URL, to dst: URL, master: Data) throws {
    let inp = try FileHandle(forReadingFrom: src)
    defer { try? inp.close() }
    guard let header = try inp.read(upToCount: 25), header.count == 25, Array(header.prefix(4)) == magic, header[4] == 1 else { throw SRSealError.notSealed }
    let cs = Int(header.subdata(in: 5..<9).withUnsafeBytes { $0.loadUnaligned(as: UInt32.self).bigEndian })
    guard cs > 0, cs <= 64 << 20 else { throw SRSealError.damaged }
    let k = key(master: master, salt: header.subdata(in: 9..<25))
    FileManager.default.createFile(atPath: dst.path, contents: nil)
    let out = try FileHandle(forWritingTo: dst)
    defer { try? out.close() }
    do {
      var i: UInt64 = 0
      var cur = try inp.read(upToCount: cs + overhead) ?? Data()
      if cur.isEmpty { throw SRSealError.damaged }
      while true {
        let next = cur.count == cs + overhead ? (try inp.read(upToCount: cs + overhead) ?? Data()) : Data()
        let last = next.isEmpty
        guard cur.count >= overhead else { throw SRSealError.damaged }
        let box = try AES.GCM.SealedBox(nonce: try nonce(i), ciphertext: cur.prefix(cur.count - overhead), tag: cur.suffix(overhead))
        let plain: Data
        do { plain = try AES.GCM.open(box, using: k, authenticating: aad(header, i, last: last)) } catch { throw i == 0 ? SRSealError.wrongKey : SRSealError.damaged }
        try out.write(contentsOf: plain)
        if last { break }
        cur = next; i += 1
      }
    } catch {
      try? out.close(); try? FileManager.default.removeItem(at: dst)
      throw error
    }
  }
  static func isSealed(_ url: URL) -> Bool {
    guard let fh = try? FileHandle(forReadingFrom: url) else { return false }
    defer { try? fh.close() }
    return (try? fh.read(upToCount: 4)).map { Array($0) == magic } ?? false
  }
}

// ---------- when to wait ----------
struct SREnv: Equatable {
  var recording = false          // a recording is running, starting or stopping (never upload while the recorder works)
  var thermalHigh = false        // the Mac is hot (serious or critical)
  var onBattery = false
  var batteryPct = 100
  var lowPower = false           // Low Power Mode
  var constrained = false        // Low Data Mode (a hotspot or a slow plan)
  var expensive = false          // a cellular or hotspot network
  var online = true
}
enum SRWaitReason: String, Equatable {
  case recording, hot, battery, lowPower, constrained, expensive, offline
  var words: String {
    switch self {
    case .recording: return "Waiting: a recording is running."
    case .hot: return "Waiting: the Mac is hot."
    case .battery: return "Waiting: the battery is under 20 percent. Plug in to upload."
    case .lowPower: return "Waiting: Low Power Mode is on."
    case .constrained: return "Waiting: this network is in Low Data Mode."
    case .expensive: return "Waiting: this network is a hotspot or costs data."
    case .offline: return "Waiting: no internet."
    }
  }
}
enum SRWait {
  static let batteryFloor = 20
  /// Why uploads wait right now, or nil to go ahead. The first reason that applies.
  static func reason(_ e: SREnv) -> SRWaitReason? {
    if e.recording { return .recording }
    if e.thermalHigh { return .hot }
    if e.onBattery && e.batteryPct < batteryFloor { return .battery }
    if e.lowPower { return .lowPower }
    if e.constrained { return .constrained }
    if e.expensive { return .expensive }
    if !e.online { return .offline }
    return nil
  }
}

enum SRBackoff {
  /// Seconds to wait before try number `attempt` (1 is the first retry): 30 s, 1 min, 2, 5, 15, 30, then an hour.
  static func delay(_ attempt: Int) -> TimeInterval {
    let steps: [TimeInterval] = [30, 60, 120, 300, 900, 1800, 3600]
    return steps[max(0, min(attempt - 1, steps.count - 1))]
  }
  /// After this many failed tries the job stops by itself and the file stays on the Mac.
  static let giveUp = 24
}

// ---------- the one rule: never delete before the upload is checked ----------
enum SRVerdict: Equatable {
  case verified
  case mismatch(String)     // the cloud copy is not the same file
  case unsure(String)       // the cloud cannot say: keep the file
  case notYet(String)       // the cloud has not finished (OneDrive hash not ready, iCloud still uploading): ask again later
}
enum SRKeep: Equatable {
  case notChecked, mismatch, unsure, removeOff, keepDays(Int), fileChanged, fileGone, inUse, noRemote
  var words: String {
    switch self {
    case .notChecked: return "Kept on this Mac: the upload is not checked yet."
    case .mismatch: return "Kept on this Mac: the cloud copy did not match."
    case .unsure: return "Kept on this Mac: the cloud could not confirm the copy."
    case .removeOff: return "Kept on this Mac: removing after upload is off."
    case .keepDays(let d): return "Kept on this Mac for \(d) more day\(d == 1 ? "" : "s")."
    case .fileChanged: return "Kept on this Mac: the file is not the one that was uploaded."
    case .fileGone: return "Already gone from this Mac."
    case .inUse: return "Kept on this Mac: it is being recorded."
    case .noRemote: return "Kept on this Mac: no cloud copy on record."
    }
  }
}
enum SRDeleteDecision: Equatable { case delete, keep(SRKeep) }
struct SRDeleteFacts: Equatable {
  var verdict: SRVerdict?              // nil: never checked
  var remoteSize: Int64?               // what the cloud says it holds (the uploaded bytes, so the sealed size when encrypted)
  var uploadedSize: Int64              // what PS sent
  var localSizeNow: Int64?             // nil: the file is gone
  var localSizeAtUpload: Int64         // the recording's size when the upload started
  var verifiedAt: Date?
  var inUse = false
}
enum SRDeletePolicy {
  /// Delete the local copy only when EVERYTHING lines up. Any doubt keeps the file.
  static func decide(_ f: SRDeleteFacts, removeAfter: Bool, keepDays: Int, now: Date) -> SRDeleteDecision {
    guard let local = f.localSizeNow else { return .keep(.fileGone) }
    if f.inUse { return .keep(.inUse) }
    switch f.verdict {
    case .none, .some(.notYet): return .keep(.notChecked)
    case .some(.mismatch): return .keep(.mismatch)
    case .some(.unsure): return .keep(.unsure)
    case .some(.verified): break
    }
    guard let remote = f.remoteSize, remote == f.uploadedSize else { return .keep(.mismatch) }
    guard local == f.localSizeAtUpload else { return .keep(.fileChanged) }
    guard removeAfter else { return .keep(.removeOff) }
    guard let at = f.verifiedAt else { return .keep(.notChecked) }
    let wait = at.addingTimeInterval(Double(max(0, keepDays)) * 86_400)
    if now < wait { return .keep(.keepDays(Int(ceil(wait.timeIntervalSince(now) / 86_400)))) }
    return .delete
  }
}

// ---------- the recordings library ----------
/// What the cloud holds for one recording.
struct SRCloudRef: Equatable, Codable {
  var provider: SRCloudProvider
  var remoteId: String
  var remoteName: String
  var size: Int64                 // the uploaded bytes (sealed size when encrypted)
  var hashKind: SRHashKind?
  var hash: String?
  var encrypted: Bool
  var verified: Bool
  var verifiedAt: Date?
  var webURL: String?
}
struct SRRec: Equatable, Codable {
  var id: String
  var title: String
  var fileName: String
  var path: String?               // the file on this Mac, nil when it is only in the cloud
  var startedAt: Date
  var duration: TimeInterval
  var meeting: String?
  var attendees: [String] = []    // email addresses of the other people, for matching to a client (never sent anywhere but PS's own vault)
  var audioOnly = false
  var size: Int64 = 0
  var sizeAtUpload: Int64 = 0
  var thumb: String?              // a tiny jpeg as a data address
  var cloud: SRCloudRef?
  var lowered: [String] = []
  var where_: SRWhere { path != nil ? (cloud != nil ? .both : .mac) : (cloud != nil ? .cloud : .gone) }
}
enum SRWhere: String, Codable { case mac, cloud, both, gone
  var words: String { switch self { case .mac: return "This Mac"; case .cloud: return "Cloud"; case .both: return "This Mac and cloud"; case .gone: return "Gone" } }
}
struct SRDeletePlan: Equatable {
  var local: Bool, cloud: Bool
  var provider: SRCloudProvider?
  /// The question the page asks. It says plainly whether the cloud copy goes too.
  var question: String
}
enum SRDeleteAnswer: Equatable { case asks(SRDeletePlan), done(local: Bool, cloud: Bool), unknown }

struct SRLibrary: Codable, Equatable {
  var items: [SRRec] = []
  /// Newest first (by start time, then name).
  func sorted() -> [SRRec] { items.sorted { $0.startedAt != $1.startedAt ? $0.startedAt > $1.startedAt : $0.title < $1.title } }
  func rec(_ id: String) -> SRRec? { items.first { $0.id == id } }
  mutating func add(_ r: SRRec) { items.removeAll { $0.id == r.id }; items.append(r) }
  @discardableResult mutating func rename(_ id: String, to title: String) -> Bool {
    let t = Self.cleanTitle(title)
    guard !t.isEmpty, let i = items.firstIndex(where: { $0.id == id }) else { return false }
    items[i].title = t; return true
  }
  static func cleanTitle(_ s: String) -> String {
    String(s.replacingOccurrences(of: "\n", with: " ").replacingOccurrences(of: "\r", with: " ").trimmingCharacters(in: .whitespaces).prefix(120))
  }
  static func plan(for r: SRRec, cloudAlso: Bool = false) -> SRDeletePlan {
    let hasLocal = r.path != nil, hasCloud = r.cloud != nil
    let name = "\"\(r.title)\""
    switch (hasLocal, hasCloud) {
    case (true, false): return SRDeletePlan(local: true, cloud: false, provider: nil, question: "Delete \(name) from this Mac? It is not in the cloud, so it cannot be brought back.")
    case (true, true):
      let p = r.cloud!.provider
      return cloudAlso
        ? SRDeletePlan(local: true, cloud: true, provider: p, question: "Delete \(name) from this Mac and from \(p.short)? It cannot be brought back.")
        : SRDeletePlan(local: true, cloud: false, provider: p, question: "Delete \(name) from this Mac only? The copy in \(p.short) stays.")
    case (false, true):
      let p = r.cloud!.provider
      return SRDeletePlan(local: false, cloud: true, provider: p, question: "Delete \(name) from \(p.short)? It is only there, so it cannot be brought back.")
    default: return SRDeletePlan(local: false, cloud: false, provider: nil, question: "Remove \"\(r.title)\" from the list? There is no file left.")
    }
  }
  /// Delete ASKS FIRST: without `confirmed` nothing is touched and the answer is the question to show. The actual file removal is the caller's
  /// (it needs the real disk and the real cloud); this removes the library row after the caller says it worked.
  func deleteRequest(_ id: String, confirmed: Bool, cloudAlso: Bool) -> SRDeleteAnswer {
    guard let r = rec(id) else { return .unknown }
    let p = Self.plan(for: r, cloudAlso: cloudAlso)
    if !confirmed { return .asks(p) }
    return .done(local: p.local, cloud: p.cloud)
  }
  mutating func finishDelete(_ id: String, localGone: Bool, cloudGone: Bool) {
    guard let i = items.firstIndex(where: { $0.id == id }) else { return }
    if localGone { items[i].path = nil }
    if cloudGone { items[i].cloud = nil }
    if items[i].path == nil && items[i].cloud == nil { items.remove(at: i) }
  }
  /// Recordings whose local copy may go now because the cloud copy is checked, the person wants them removed, and the days are up.
  /// This only says WHICH; the engine re-checks the cloud before it removes anything.
  func removable(settings: SRCloudSettings, now: Date, inUse: Set<String> = []) -> [String] {
    guard settings.removeAfter else { return [] }
    return items.filter { r in
      guard r.path != nil, let c = r.cloud, c.verified else { return false }
      let f = SRDeleteFacts(verdict: .verified, remoteSize: c.size, uploadedSize: c.size, localSizeNow: r.size, localSizeAtUpload: r.sizeAtUpload > 0 ? r.sizeAtUpload : r.size,
                            verifiedAt: c.verifiedAt, inUse: inUse.contains(r.id) || (r.path.map { inUse.contains($0) } ?? false))
      return SRDeletePolicy.decide(f, removeAfter: true, keepDays: settings.keepDays, now: now) == .delete
    }.map { $0.id }
  }
}

// ---------- playback numbers (the player is native; the rules are here so they are tested) ----------
enum SRVoice: String { case me, them }
struct SRPlayback: Equatable {
  static let rates: [Double] = [1, 1.25, 1.5, 2]
  static let skipSeconds = 15.0
  var duration: TimeInterval = 0
  var position: TimeInterval = 0
  var rate = 1.0
  var playing = false
  var me = 1.0, them = 1.0
  /// Two sound tracks (Me then Them). A one track file has no separate volumes.
  var audioTracks = 2
  var hasTwoTracks: Bool { audioTracks >= 2 }
  mutating func toggle() { playing.toggle() }
  mutating func skip(_ seconds: Double) { position = max(0, min(duration, position + seconds)) }
  mutating func back() { skip(-Self.skipSeconds) }
  mutating func forward() { skip(Self.skipSeconds) }
  mutating func seek(_ to: TimeInterval) { position = max(0, min(duration, to)) }
  /// Only 1, 1.25, 1.5 and 2 are allowed; anything else becomes the nearest allowed speed.
  mutating func setRate(_ r: Double) { rate = Self.rates.min { abs($0 - r) < abs($1 - r) } ?? 1 }
  mutating func nextRate() { let i = Self.rates.firstIndex(of: rate) ?? 0; rate = Self.rates[(i + 1) % Self.rates.count] }
  mutating func setVolume(_ v: SRVoice, _ x: Double) { let c = max(0, min(1, x.isFinite ? x : 1)); if v == .me { me = c } else { them = c } }
  /// The volume of each sound track in file order: first track is Me (the mic), second is Them (the computer sound).
  func trackVolumes() -> [Double] { hasTwoTracks ? [me, them] : [1] }
  static func rateLabel(_ r: Double) -> String { r == r.rounded() ? "\(Int(r))x" : "\(r)x" }
}

/// How a recording that is only in the cloud gets played on the Mac.
enum SRPlayHow: Equatable { case local, streamWithToken, temporaryLink, directLink, downloadFirst, downloadThenOpen }
enum SRPlayPlan {
  static func how(localExists: Bool, provider: SRCloudProvider, encrypted: Bool) -> SRPlayHow {
    if localExists { return .local }
    if encrypted { return .downloadThenOpen }      // sealed files cannot stream: download, open into a temp file, play, delete the temp file
    switch provider {
    case .googleDrive: return .streamWithToken     // files.get?alt=media with a Range header and the token on the Mac
    case .dropbox: return .temporaryLink
    case .oneDrive: return .directLink             // the item's short lived download address
    case .iCloud, .folder: return .downloadFirst   // a placeholder file: macOS downloads it first
    case .none: return .downloadFirst
    }
  }
}
/// What the phone and the website can do with a row (they never hold a cloud login and never go through a server of ours).
enum SRPhonePlay: Equatable { case openInCloud(String), playOnMac }
enum SRRemotePlay {
  static func phone(provider: SRCloudProvider, encrypted: Bool, openURL: String?) -> SRPhonePlay {
    if encrypted { return .playOnMac }
    switch provider {
    case .googleDrive, .dropbox, .oneDrive: if let u = openURL, !u.isEmpty { return .openInCloud(u) }; return .playOnMac
    default: return .playOnMac
    }
  }
}

// ---------- the island: a ring while uploading, a card when done ----------
struct SRUploadSign: Equatable {
  var fraction: Double
  var name: String
  var count: Int
}
enum SRUploadSigns {
  /// The ring and its words, or nil: nothing is uploading, a recording is running, or private mode is on (private mode shows NOTHING).
  static func ring(active: [(name: String, fraction: Double)], privateOn: Bool, recording: Bool) -> SRUploadSign? {
    guard !privateOn, !recording, let first = active.first else { return nil }
    let share = active.map { max(0, min(1, $0.fraction)) }.reduce(0, +) / Double(active.count)
    return SRUploadSign(fraction: share, name: first.name, count: active.count)
  }
  static let uploading = "Uploading", uploaded = "Uploaded"
  static func percent(_ f: Double) -> String { "\(Int((max(0, min(1, f)) * 100).rounded()))%" }
}
