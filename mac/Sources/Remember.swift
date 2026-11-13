// "Remember me" on this Mac: after the developer signs in once, PS keeps the DERIVED keys (login hash and
// key-encryption key from his passphrase, never the passphrase itself) in the macOS Keychain,
// this Mac only (never iCloud Keychain), and signs in with them silently at launch.
// The developer's rule (15th Oct): with "Remember me" ticked PS never signs him out (quit, restart, sleep,
// Mac lock, update refresh). Since 27 Oct Lock turns this item into a locked one that only opens
// after Touch ID (TouchLock.swift); "Sign out of this Mac" deletes both.
//
// Never a Keychain password prompt (the developer, 16th Oct: "PS wants to access key... enter the login
// keychain password" kept appearing). PS is signed locally without an Apple team, so macOS ties
// each saved item to the exact build that saved it and asks for the Mac password when a newer
// build reads it. So: every build keeps its own item (named after the build), every Keychain call
// runs with prompts switched off, and an item from an older build simply counts as "not saved".
// After a new PS build the developer signs in once more; plain restarts open silently.
import Foundation
import Security

enum Remember {
  static let service = "com.cincee.ps.remember"
  static var cachedExists = false

  /// This build's own account name, from its code signature hash (stable for this exact binary).
  static let account: String = {
    var code: SecCode?
    var info: CFDictionary?
    if SecCodeCopySelf([], &code) == errSecSuccess, let code,
       SecCodeCopySigningInformation(unsafeBitCast(code, to: SecStaticCode.self), SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
       let d = info as? [String: Any], let unique = d[kSecCodeInfoUnique as String] as? Data {
      return "owner-" + unique.prefix(8).map { String(format: "%02x", $0) }.joined()
    }
    return "owner"
  }()

  static func base(_ acct: String = account) -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: acct]
  }

  /// Runs a Keychain call with its password prompts switched off: it fails quietly instead.
  @discardableResult
  private static func quietly<T>(_ body: () -> T) -> T {
    KeychainQuiet.run(body)   // one lock for the whole app (KeychainQuiet.swift)
  }

  @discardableResult static func refresh() -> Bool {
    var q = base()
    q[kSecReturnAttributes as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    cachedExists = quietly { SecItemCopyMatching(q as CFDictionary, nil) } == errSecSuccess
    return cachedExists
  }

  static func save(_ data: Data) {
    quietly { SecItemDelete(base() as CFDictionary) }
    var q = base()
    q[kSecValueData as String] = data
    q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    q[kSecAttrSynchronizable as String] = false
    q[kSecAttrLabel as String] = "PS sign-in (this Mac only)"
    let st = quietly { SecItemAdd(q as CFDictionary, nil) }
    psLog("PS remember: saved=\(st == errSecSuccess ? 1 : 0)")
    if st == errSecSuccess { TouchLock.deleteLocked() }     // signed in or unlocked: no locked copy left
    cleanOld()
    refresh()
  }

  static func read() -> Data? {
    var q = base()
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    let st = quietly { SecItemCopyMatching(q as CFDictionary, &out) }
    guard st == errSecSuccess else { psLog("PS remember: read status \(st)"); return nil }
    return out as? Data
  }

  /// Deletes the silent item (and the locked one too, unless Lock is moving it there).
  static func forget(keepLocked: Bool = false) {
    quietly { SecItemDelete(base() as CFDictionary) }
    if !keepLocked { TouchLock.deleteLocked() }
    cleanOld()
    refresh()
  }

  /// Older builds' items: removed where macOS allows it without asking (it never prompts).
  private static func cleanOld() {
    for old in ["owner"] { quietly { SecItemDelete(base(old) as CFDictionary) } }
  }
}
