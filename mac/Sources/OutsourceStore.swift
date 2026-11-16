// Outsource work to your other computer (PS 1.65), what this Mac keeps on disk. Foundation and Security only.
// - OutKeep: the page's pairing record. The private half lives ONLY in the Keychain: this build's own item (named after the build,
//   like the sign in, Remember.swift) is handed to the next build at every update (UpdateHandoff.swift, "outsource"), so an update
//   never asks for a password and never asks to pair again. A copy under one fixed name is the second way back (a build that
//   was installed by hand, with no hand over); it is read quietly and only ever fails quietly. Never a file: an AI working on
//   this computer as the same person could read a file. The rest of the record (ids, names, public keys, the replay list,
//   the phones allowed to restart it) is a plain 0600 file in the PS folder: nothing in it is secret.
// - OutLanding: a result bundle arriving in pieces on the main computer. Each piece is checked in order, the whole is
//   checked against its size and SHA-256, and only then does it get its real name. Nothing is ever merged or applied.
import Foundation
import Security

/// The Keychain side, kept apart so tests use a folder instead (never the real Keychain).
protocol OutSecretStore { func read() -> String?; @discardableResult func write(_ s: String) -> Bool; func delete() }

final class OutKeychain: OutSecretStore {
  static let service = "com.cincee.ps.outsource"     // fixed on purpose
  static let fixedAccount = "pairing"
  let account: String
  init(build: String) { account = "pairing-" + build }
  private func base(_ acct: String) -> [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: Self.service, kSecAttrAccount as String: acct] }
  private func readOne(_ acct: String) -> String? {
    var q = KeychainQuiet.never(base(acct)); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    guard KeychainQuiet.run({ SecItemCopyMatching(q as CFDictionary, &out) }) == errSecSuccess, let d = out as? Data, let s = String(data: d, encoding: .utf8), !s.isEmpty else { return nil }
    return s
  }
  private func writeOne(_ acct: String, _ s: String) -> Bool {
    let d = Data(s.utf8)
    if KeychainQuiet.run({ SecItemUpdate(KeychainQuiet.never(base(acct)) as CFDictionary, [kSecValueData as String: d] as CFDictionary) }) == errSecSuccess { return true }
    var q = KeychainQuiet.never(base(acct))
    q[kSecValueData as String] = d
    q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    q[kSecAttrSynchronizable as String] = false
    q[kSecAttrLabel as String] = "PS outsource pairing key (this Mac only)"
    return KeychainQuiet.run { SecItemAdd(q as CFDictionary, nil) } == errSecSuccess
  }
  /// This build's item first, then the fixed one (put back as this build's own when found).
  func read() -> String? {
    if let s = readOne(account) { return s }
    if let s = readOne(Self.fixedAccount) { _ = writeOne(account, s); return s }
    return nil
  }
  @discardableResult func write(_ s: String) -> Bool { let a = writeOne(account, s); _ = writeOne(Self.fixedAccount, s); return a }
  func delete() { for a in [account, Self.fixedAccount] { _ = KeychainQuiet.run { SecItemDelete(KeychainQuiet.never(base(a)) as CFDictionary) } } }
}

/// Tests only: a 0600 file in a temp folder stands in for the Keychain.
final class OutFileSecret: OutSecretStore {
  let path: String
  init(path: String) { self.path = path }
  func read() -> String? { (try? String(contentsOfFile: path, encoding: .utf8)).flatMap { $0.isEmpty ? nil : $0 } }
  @discardableResult func write(_ s: String) -> Bool { (try? s.write(toFile: path, atomically: true, encoding: .utf8)) != nil && chmod(path, 0o600) == 0 }
  func delete() { try? FileManager.default.removeItem(atPath: path) }
}

final class OutKeep {
  let dir: String
  let secret: OutSecretStore
  private let fm = FileManager.default
  init(dir: String, secret: OutSecretStore) { self.dir = dir; self.secret = secret }
  private var recordPath: String { dir + "/keep.json" }

  /// Saves the record: the private half to the Keychain only, the rest to a file. False when it is not a record or the disk refuses.
  @discardableResult func save(_ record: [String: Any]) -> Bool {
    var rec = record
    let priv = (rec.removeValue(forKey: "priv") as? String) ?? ""
    guard priv.utf8.count <= 20_000, rec["device"] is String, let d = try? JSONSerialization.data(withJSONObject: rec, options: [.sortedKeys]), d.count <= 400_000 else { return false }
    do {
      try fm.createDirectory(atPath: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
      try d.write(to: URL(fileURLWithPath: recordPath), options: .atomic)
      chmod(recordPath, 0o600)
    } catch { return false }
    if !priv.isEmpty, secret.read() != priv { return secret.write(priv) }
    return true
  }

  /// The record with its private half put back ("" when the Keychain would not give it without asking), or nil when never paired.
  func load() -> [String: Any]? {
    guard let d = fm.contents(atPath: recordPath), var rec = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return nil }
    rec["priv"] = secret.read() ?? ""
    return rec
  }
  func forget() { try? fm.removeItem(atPath: recordPath); secret.delete() }

  /// The update hand over (UpdateHandoff.swift): the private half only; the file stays where it is.
  func handoffCollect() -> String? { secret.read() }
  @discardableResult func handoffSave(_ s: String?) -> Bool { guard let s, !s.isEmpty, s.utf8.count <= 20_000 else { return false }; return secret.write(s) }
}

final class OutLanding {
  struct Plan { var id: String; var name: String; var sha256: String; var size: Int; var n: Int; var next = 0; var got = 0; var part: String }
  let root: String
  private var plans: [String: Plan] = [:]
  private let fm = FileManager.default
  init(root: String) { self.root = root }
  static let maxBytes = 24 * 1024 * 1024   // web BUNDLE_MAX

  func folder(_ id: String) -> String { root + "/results/" + id }

  /// Starts a landing from the page's `land` message. Returns the folder, or nil when it is refused.
  func start(id: String, report: String, bundle: [String: Any]?, shots: [String]) -> String? {
    guard OutSafe.idOk(id), report.utf8.count <= 200_000 else { return nil }
    let dir = folder(id)
    try? fm.removeItem(atPath: dir)
    do { try fm.createDirectory(atPath: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]) } catch { return nil }
    guard (try? report.write(toFile: dir + "/report.json", atomically: true, encoding: .utf8)) != nil else { return nil }
    var k = 0
    for s in shots.prefix(4) {
      guard s.hasPrefix("data:image/png;base64,"), s.utf8.count < 900_000, let d = Data(base64Encoded: String(s.dropFirst(22))), d.count <= 600_000 else { continue }
      k += 1; fm.createFile(atPath: dir + "/shot-\(k).png", contents: d, attributes: [.posixPermissions: 0o600])
    }
    plans[id] = nil
    if let b = bundle {
      guard let n = (b["n"] as? NSNumber)?.intValue, let size = (b["size"] as? NSNumber)?.intValue, let sha = b["sha256"] as? String,
            size > 0, size <= Self.maxBytes, n == OutChunks.count(size), sha.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else { try? fm.removeItem(atPath: dir); return nil }
      var name = OutRunner.cleanName((b["name"] as? String) ?? "result.bundle")
      if !name.hasSuffix(".bundle") { name += ".bundle" }
      let part = dir + "/" + name + ".part"
      fm.createFile(atPath: part, contents: nil, attributes: [.posixPermissions: 0o600])
      plans[id] = Plan(id: id, name: name, sha256: sha, size: size, n: n, part: part)
    }
    return dir
  }

  enum Step: Equatable { case more, landed(String), failed(String) }

  /// One verified chunk from the page (already base64 decoded). Pieces must come in order, none twice, none too big.
  func chunk(id: String, i: Int, data: Data) -> Step {
    guard var p = plans[id] else { return .failed("no landing for this job") }
    guard i == p.next, data.count <= OutChunks.size, !data.isEmpty, p.got + data.count <= p.size else { return abort(id, "a piece came in the wrong order or too big") }
    guard let h = FileHandle(forWritingAtPath: p.part) else { return abort(id, "could not write") }
    defer { try? h.close() }
    do { try h.seekToEnd(); try h.write(contentsOf: data) } catch { return abort(id, "could not write") }
    p.next += 1; p.got += data.count; plans[id] = p
    if p.next < p.n { return .more }
    guard p.got == p.size, Self.sha256(p.part) == p.sha256 else { return abort(id, "the result did not match its checksum") }
    let final = folder(id) + "/" + p.name
    try? fm.removeItem(atPath: final)
    do { try fm.moveItem(atPath: p.part, toPath: final) } catch { return abort(id, "could not finish") }
    plans[id] = nil
    return .landed(final)
  }

  private func abort(_ id: String, _ why: String) -> Step {
    if let p = plans[id] { try? fm.removeItem(atPath: p.part) }
    plans[id] = nil
    return .failed(why)
  }

  static func sha256(_ path: String) -> String? { OutHash.sha256(path) }
}
