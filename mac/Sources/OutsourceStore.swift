// Outsource work to your other computer (PS 1.65), what this Mac keeps on disk. Foundation and Security only.
// - OutKeep: the page's pairing record. The private half (a blob the page already sealed, opaque here) goes in the
//   Keychain under a FIXED service and account (never the app version, never the build), with a 0600 copy in the PS
//   folder as the way back: a self signed build cannot always read an older build's Keychain item without macOS
//   asking, so a read that fails quietly falls back to the file and puts the item back. Pairing is never lost
//   across updates or restarts. The rest of the record is a plain file (public keys, names, ids).
// - OutLanding: a result bundle arriving in pieces on the main computer. Each piece is checked in order, the whole is
//   checked against its size and SHA-256, and only then does it get its real name. Nothing is ever merged or applied.
import Foundation
import Security

final class OutKeep {
  static let service = "com.cincee.ps.outsource"     // stable on purpose
  static let account = "pairing-private"
  let dir: String
  let useKeychain: Bool
  private let fm = FileManager.default
  init(dir: String, useKeychain: Bool = true) { self.dir = dir; self.useKeychain = useKeychain }

  private var recordPath: String { dir + "/keep.json" }
  private var privPath: String { dir + "/keep.priv" }

  private var kcBase: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: Self.service, kSecAttrAccount as String: Self.account] }

  private func kcRead() -> String? {
    guard useKeychain else { return nil }
    var q = KeychainQuiet.never(kcBase); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    guard KeychainQuiet.run({ SecItemCopyMatching(q as CFDictionary, &out) }) == errSecSuccess, let d = out as? Data else { return nil }
    return String(data: d, encoding: .utf8)
  }
  @discardableResult private func kcWrite(_ s: String) -> Bool {
    guard useKeychain else { return false }
    let d = Data(s.utf8)
    if KeychainQuiet.run({ SecItemUpdate(KeychainQuiet.never(kcBase) as CFDictionary, [kSecValueData as String: d] as CFDictionary) }) == errSecSuccess { return true }
    var q = KeychainQuiet.never(kcBase)
    q[kSecValueData as String] = d
    q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    q[kSecAttrSynchronizable as String] = false
    q[kSecAttrLabel as String] = "PS outsource pairing (sealed, this Mac only)"
    return KeychainQuiet.run { SecItemAdd(q as CFDictionary, nil) } == errSecSuccess
  }
  private func kcDelete() { if useKeychain { _ = KeychainQuiet.run { SecItemDelete(KeychainQuiet.never(kcBase) as CFDictionary) } } }

  /// Saves the record. False when the record is not a JSON object or the disk refuses.
  @discardableResult func save(_ record: [String: Any]) -> Bool {
    var rec = record
    let priv = (rec.removeValue(forKey: "priv") as? String) ?? ""
    guard priv.utf8.count <= 20_000, let d = try? JSONSerialization.data(withJSONObject: rec, options: [.sortedKeys]) else { return false }
    do {
      try fm.createDirectory(atPath: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
      try d.write(to: URL(fileURLWithPath: recordPath), options: .atomic)
      chmod(recordPath, 0o600)
      if !priv.isEmpty {
        try priv.write(toFile: privPath, atomically: true, encoding: .utf8); chmod(privPath, 0o600)
        kcWrite(priv)
      }
      return true
    } catch { return false }
  }

  /// The record with its private blob put back, or nil when never paired. Reads the Keychain without any question.
  func load() -> [String: Any]? {
    guard let d = fm.contents(atPath: recordPath), var rec = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return nil }
    var priv = kcRead()
    if priv == nil, let f = try? String(contentsOfFile: privPath, encoding: .utf8), !f.isEmpty {
      priv = f
      kcWrite(f)   // the way back: put the Keychain item back for the next read
    }
    rec["priv"] = priv ?? ""
    return rec
  }

  func forget() {
    try? fm.removeItem(atPath: recordPath); try? fm.removeItem(atPath: privPath); kcDelete()
  }
}

final class OutLanding {
  struct Plan { var id: String; var name: String; var sha256: String; var size: Int; var n: Int; var next = 0; var got = 0; var part: String }
  let root: String
  private var plans: [String: Plan] = [:]
  private let fm = FileManager.default
  init(root: String) { self.root = root }
  static let maxBytes = OutRunner.maxBundle

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

  static func sha256(_ path: String) -> String? {
    let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/bin/shasum"); p.arguments = ["-a", "256", path]
    let pipe = Pipe(); p.standardOutput = pipe; p.standardError = FileHandle.nullDevice
    do { try p.run() } catch { return nil }
    let d = pipe.fileHandleForReading.readDataToEndOfFile(); p.waitUntilExit()
    return String(data: d, encoding: .utf8)?.split(separator: " ").first.map(String.init)
  }
}
