// Local first (V1.44): the key that opens a new person's local vault (web src/core/localstore.ts) lives here,
// in this Mac's Keychain (this Mac only, never iCloud). It is 32 random bytes; the page uses it to unwrap the vault key
// and never stores it. There is no password in local mode, so this item IS the way into the data: it is never deleted
// or replaced by PS, except "Remove the copy on this Mac" after a verified move to sync (the page's forget).
//
// The same trap as Remember.swift and Second Computer: PS is signed without an Apple team, so macOS ties each item to
// the build that made it. A newer build cannot read an older build's item without a Keychain question. So:
//  - every build saves its own copy under its own account name (vault-key.<code hash>), and never deletes an older one;
//  - a read tries every copy quietly (prompts switched off), this build's own first;
//  - an item that is there but cannot be read answers "denied", NEVER "missing", so the page asks the person to Allow
//    (their click: the read then may show macOS's question) and never makes a new key over the old one;
//  - create refuses when any copy is there;
//  - on an update the old build hands its copy to the new one (UpdateHandoff.swift), which saves it as its own.
// Test copies never touch the Keychain: they keep the key in memory only.
import Foundation
import Security

enum LocalKey {
  static let service = "com.cincee.ps.localvault"
  static let prefix = "vault-key"
  static var test: Bool { ProcessInfo.processInfo.environment["PS_SELFTEST"] != nil }
  private static var testKey: Data?
  private static let lock = NSLock()

  /// This build's own account name (same idea as Remember.account).
  static let ownAccount: String = {
    var code: SecCode?
    var info: CFDictionary?
    if SecCodeCopySelf([], &code) == errSecSuccess, let code,
       SecCodeCopySigningInformation(unsafeBitCast(code, to: SecStaticCode.self), SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
       let d = info as? [String: Any], let unique = d[kSecCodeInfoUnique as String] as? Data {
      return prefix + "." + unique.prefix(8).map { String(format: "%02x", $0) }.joined()
    }
    return prefix
  }()

  private static func base(_ account: String? = nil) -> [String: Any] {
    var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
    if let account { q[kSecAttrAccount as String] = account }
    return q
  }
  /// Quiet calls go through KeychainQuiet's one lock (the prompt switch is process wide, V1.44 keychain fix). The one
  /// call that may ask (after the person's own Allow click) uses KeychainQuiet.asking with an "allow" query.
  private static func withUI<T>(_ allow: Bool, _ body: () -> T) -> T {
    allow ? KeychainQuiet.asking(body) : KeychainQuiet.run(body)
  }

  /// Every account name of this service (attributes only: no data is read, so no question).
  static func accounts() -> [String] {
    var q = base()
    q[kSecReturnAttributes as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitAll
    var out: CFTypeRef?
    let st = withUI(false) { SecItemCopyMatching(q as CFDictionary, &out) }
    guard st == errSecSuccess, let list = out as? [[String: Any]] else { return [] }
    let names = list.compactMap { $0[kSecAttrAccount as String] as? String }.filter { $0 == prefix || $0.hasPrefix(prefix + ".") }
    return names.sorted { a, b in a == ownAccount ? true : b == ownAccount ? false : a < b }
  }

  enum Read { case ok(Data), missing, denied }

  /// Reads the key: quietly, or (after the person's click on Allow) letting macOS ask.
  static func read(allowUI: Bool = false) -> Read {
    if test { lock.lock(); defer { lock.unlock() }; return testKey.map { .ok($0) } ?? .missing }
    let names = accounts()
    if names.isEmpty {
      // Attributes could not be listed at all (a locked Keychain answers that way too): only errSecItemNotFound is missing.
      var q = base(); q[kSecReturnAttributes as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
      let st = withUI(false) { SecItemCopyMatching(q as CFDictionary, nil) }
      return st == errSecItemNotFound ? .missing : .denied
    }
    for a in names {
      var q = base(a)
      q[kSecReturnData as String] = true
      q[kSecMatchLimit as String] = kSecMatchLimitOne
      if allowUI { q = KeychainQuiet.allowing(q) }   // a quiet call on another thread cannot switch this one off
      var out: CFTypeRef?
      let st = withUI(allowUI) { SecItemCopyMatching(q as CFDictionary, &out) }
      if st == errSecSuccess, let d = out as? Data, d.count == 32 {
        if a != ownAccount { _ = saveOwn(d) }   // read once (allowed, or an older copy): this build keeps its own from now on
        return .ok(d)
      }
    }
    return .denied
  }

  /// Saves `d` as this build's own copy, unless it already has one that reads back the same. Never removes another.
  @discardableResult
  static func saveOwn(_ d: Data) -> Bool {
    guard d.count == 32 else { return false }
    if test { lock.lock(); testKey = testKey ?? d; lock.unlock(); return true }
    var rq = base(ownAccount); rq[kSecReturnData as String] = true; rq[kSecMatchLimit as String] = kSecMatchLimitOne
    var cur: CFTypeRef?
    if withUI(false, { SecItemCopyMatching(rq as CFDictionary, &cur) }) == errSecSuccess, let c = cur as? Data {
      if c == d { return true }
      psLog("PS local key: this build's copy differs, kept as it is")   // never overwritten; the page opens with whichever works
      return false
    }
    var q = base(ownAccount)
    q[kSecValueData as String] = d
    q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    q[kSecAttrSynchronizable as String] = false
    q[kSecAttrLabel as String] = "PS local data key (this Mac only)"
    let st = withUI(false) { SecItemAdd(q as CFDictionary, nil) }
    psLog("PS local key: saved=\(st == errSecSuccess ? 1 : 0)")
    return st == errSecSuccess
  }

  /// A new key, only when there is none at all. Read back before it counts.
  static func create() -> Data? {
    if test {
      lock.lock(); defer { lock.unlock() }
      if testKey != nil { return nil }
      var b = Data(count: 32); let ok = b.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) } == errSecSuccess
      if ok { testKey = b }
      return ok ? b : nil
    }
    guard case .missing = read() else { psLog("PS local key: create refused, a key is already there"); return nil }
    var b = Data(count: 32)
    guard b.withUnsafeMutableBytes({ SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }) == errSecSuccess else { return nil }
    guard saveOwn(b), case .ok(let back) = read(), back == b else { return nil }
    return b
  }

  /// Only after a verified move and the person's confirm (the page asks). Best effort for older builds' copies.
  static func forget() {
    if test { lock.lock(); testKey = nil; lock.unlock(); return }
    for a in accounts() { _ = withUI(false) { SecItemDelete(base(a) as CFDictionary) } }
    psLog("PS local key: removed")
  }

  /// The page's request (`localkey:get|create|allow|forget`): the answer for it, never logged.
  static func answer(_ op: String) -> [String: Any] {
    switch op {
    case "get", "allow":
      switch read(allowUI: op == "allow") {
      case .ok(let d): return ["status": "ok", "key": d.base64EncodedString()]
      case .missing: return ["status": "missing"]
      case .denied: return ["status": "denied"]
      }
    case "create":
      if let d = create() { return ["status": "ok", "key": d.base64EncodedString()] }
      return ["status": "error", "error": "This Mac could not keep the key."]
    case "forget":
      forget(); return ["status": "missing"]
    default:
      return ["status": "error", "error": "unknown"]
    }
  }

  /// Update hand over, the old build: its key, read quietly (nil when there is none or it cannot be read).
  static func collect() -> String? {
    if case .ok(let d) = read() { return d.base64EncodedString() }
    return nil
  }
}
