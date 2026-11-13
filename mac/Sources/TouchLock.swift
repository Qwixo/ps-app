// Lock with Touch ID (the developer, 27 Oct 2026; replaces "Lock = full sign out" of 15 Oct, matching the
// phone's fingerprint unlock).
//  - Silent launch stays: while unlocked, the "Remember me" item (Remember.swift) opens PS silently.
//  - Lock: the keys leave memory (the page locks) and the remembered item becomes a LOCKED item:
//    the same derived keys under another name, and the silent item no longer exists. So a relaunch,
//    a restart or an update of a locked PS stays locked: nothing silent is left to read.
//  - Unlock: Touch ID or the Mac password (LocalAuthentication, deviceOwnerAuthentication) first;
//    only then PS reads the locked item, opens the vault with it and turns it back into the silent
//    one. Never on the main thread: the system sheet waits on its own queue.
//  - "Sign out of this Mac" deletes both items: next time it is the passphrase.
// Why not a Keychain item that macOS itself only hands out after Touch ID (a biometry access
// control): that needs the data protection keychain, which needs an Apple Developer team ID. PS is
// self-signed, and macOS refuses it ("A required entitlement is not present", -34018, checked on
// 27 Oct). What protects the locked item instead: only this exact PS build can read it without a
// password prompt (the Keychain ties each item to the build), the hardened runtime stops any code
// being injected into PS, and PS reads it only after Touch ID. Anyone else asking gets the login
// keychain password prompt. Nothing in zero knowledge changes: the keys are the same derived keys.
// Test copies never touch the Keychain or the real Touch ID sheet: an in-memory store and a fake.
import Foundation
import LocalAuthentication
import Security

enum TouchLock {
  static let service = "com.cincee.ps.locked"
  static var cachedLocked = false
  private static let test = UpdatePaths.test
  private static var memory: [String: Data] = [:]      // test copies only (fictional)
  private static let memLock = NSLock()

  // MARK: the two items (Keychain for the developer, memory for test copies)

  static func base() -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: Remember.account]
  }
  private static func quietly<T>(_ body: () -> T) -> T {
    KeychainQuiet.run(body)   // one lock for the whole app (KeychainQuiet.swift)
  }
  static func memGet(_ k: String) -> Data? { memLock.lock(); defer { memLock.unlock() }; return memory[k] }
  static func memSet(_ k: String, _ d: Data?) { memLock.lock(); memory[k] = d; memLock.unlock() }

  /// The silent item's keys (Remember.swift), or the test copy's.
  static func readRemembered() -> Data? { test ? memGet("remember") : Remember.read() }
  static func readLocked() -> Data? {
    if test { return memGet("locked") }
    var q = base(); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    return quietly { SecItemCopyMatching(q as CFDictionary, &out) } == errSecSuccess ? out as? Data : nil
  }
  static func saveLocked(_ data: Data) {
    if test { memSet("locked", data); cachedLocked = true; return }
    quietly { SecItemDelete(base() as CFDictionary) }
    var q = base()
    q[kSecValueData as String] = data
    q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    q[kSecAttrSynchronizable as String] = false
    q[kSecAttrLabel as String] = "PS sign-in, locked (this Mac only)"
    let st = quietly { SecItemAdd(q as CFDictionary, nil) }
    psLog("PS lock: locked item saved=\(st == errSecSuccess ? 1 : 0)")
    refresh()
  }
  static func deleteLocked() {
    if test { memSet("locked", nil) } else { quietly { SecItemDelete(base() as CFDictionary) } }
    refresh()
  }
  @discardableResult static func refresh() -> Bool {
    if test { cachedLocked = memGet("locked") != nil; return cachedLocked }
    var q = base(); q[kSecReturnAttributes as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
    cachedLocked = quietly { SecItemCopyMatching(q as CFDictionary, nil) } == errSecSuccess
    return cachedLocked
  }

  // MARK: lock and unlock (never on the main thread)

  /// Lock: the silent item becomes the locked one. False when there was nothing remembered (then
  /// Lock is simply a sign out, as before).
  @discardableResult static func lock() -> Bool {
    guard let d = readRemembered() else { return false }
    saveLocked(d)
    guard cachedLocked else { psLog("PS lock: could not save the locked item, the remembered one stays"); return false }
    if test { memSet("remember", nil) } else { Remember.forget(keepLocked: true) }
    psLog("PS lock: locked (silent item removed)")
    return true
  }
  /// After Touch ID: the locked keys, turned back into the silent item for the next launch.
  static func unlockedKeys() -> Data? {
    guard let d = readLocked() else { return nil }
    if test { memSet("remember", d); memSet("locked", nil); refresh() }
    else { Remember.save(d) }        // saves the silent item and deletes the locked one
    return d
  }
  /// Sign out of this Mac: both items gone.
  static func signOut() {
    if test { memSet("remember", nil); memSet("locked", nil); refresh() }
    else { Remember.forget() }
  }

  // MARK: Touch ID (or the Mac password)

  /// The check itself; test copies get a fake (PS_SELFTEST_TOUCHID=ok, fail, or slow).
  static var evaluate: (_ reason: String, _ done: @escaping (Bool, String) -> Void) -> Void = { reason, done in
    if UpdatePaths.test {
      let mode = ProcessInfo.processInfo.environment["PS_SELFTEST_TOUCHID"] ?? "fail"
      DispatchQueue.global().asyncAfter(deadline: .now() + (mode == "slow" ? 1.5 : 0.1)) { done(mode != "fail", mode == "fail" ? "cancelled (fake)" : "") }
      return
    }
    let c = LAContext()
    c.localizedCancelTitle = "Not now"
    var e: NSError?
    guard c.canEvaluatePolicy(.deviceOwnerAuthentication, error: &e) else { done(false, e?.localizedDescription ?? "Touch ID is not available"); return }
    c.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, err in done(ok, err?.localizedDescription ?? "") }
  }
  private static var asking = false
  /// Asks for Touch ID (or the Mac password); on success hands the keys to `opened` on the main
  /// thread. One sheet at a time. The main thread never waits for it.
  static func unlock(_ opened: @escaping (Data?) -> Void) {
    dispatchPrecondition(condition: .onQueue(.main))
    guard !asking, cachedLocked else { return }
    asking = true
    evaluate("unlock \(AppName.current)") { ok, why in
      let keys = ok ? unlockedKeys() : nil
      DispatchQueue.main.async {
        asking = false
        psLog("PS lock: Touch ID \(ok ? (keys == nil ? "ok, but no locked item" : "ok, unlocked") : "not passed (\(why.prefix(60)))")")
        opened(keys)
      }
    }
  }
  static var isAsking: Bool { asking }
}
