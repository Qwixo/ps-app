// One place for "never let macOS ask" around every Keychain call PS makes (V1.44, the developer: the "PS wants to access key
// ... enter the login keychain password" screen "is confusing people").
//
// Why the question comes up at all: PS is signed with a self signed certificate (no Apple team, no paid account), so
// the login Keychain stamps every item with the partition "cdhash:<this exact build>". A newer build is outside that
// partition and macOS asks for the login keychain password before it may read the item. Nothing a self signed app
// can set when it creates an item avoids that (proven on the M4 on 4 Nov 2026 with a throwaway item; the data protection
// Keychain needs an Apple team). So PS never reads an older build's item: the sign in, the lock, the network key, the
// Supabase token and the reply sign ins are named after the build and handed over at each update (UpdateHandoff);
// Second Computer (the developer only) keeps fixed names and is handed over too, and asks only after the developer's own click on Allow.
//
// The old way switched prompts off with SecKeychainSetUserInteractionAllowed, which is ONE switch for the whole
// process: two threads doing it at once (the sign in, the lock, Second Computer and the network key are all read at
// launch, each on its own queue) could leave it on for a call that meant to be quiet, and macOS then asked with no
// PS card first. Now every quiet call runs under one lock, and the Second Computer queries also carry
// kSecUseAuthenticationUIFail, so each such call says "fail, never ask" by itself.
import Foundation
import Security

enum KeychainQuiet {
  private static let lock = NSRecursiveLock()

  /// Runs Keychain calls with macOS's password question switched off: they fail quietly instead
  /// (errSecInteractionNotAllowed). Never on the main thread in practice; the lock is held only for the call itself.
  @discardableResult
  static func run<T>(_ body: () -> T) -> T {
    lock.lock(); defer { lock.unlock() }
    var was: DarwinBoolean = true
    SecKeychainGetUserInteractionAllowed(&was)
    SecKeychainSetUserInteractionAllowed(false)
    defer { SecKeychainSetUserInteractionAllowed(was.boolValue) }
    return body()
  }

  /// The one call where macOS may ask: after the developer's own click on Allow, with PS's card already on screen. The lock is
  /// NOT held while macOS waits for him (other Keychain calls, and the main thread, never wait on his answer); the
  /// query itself says "may ask" (`allowing`), so a quiet call on another thread cannot switch it off.
  static func asking<T>(_ body: () -> T) -> T {
    lock.lock()
    SecKeychainSetUserInteractionAllowed(true)
    lock.unlock()
    return body()
  }

  /// A query that fails rather than asks, whatever the process wide switch says.
  static func never(_ q: [String: Any]) -> [String: Any] {
    var q = q; q[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail; return q
  }
  /// A query that may ask (only inside `asking`, after the developer clicked Allow).
  static func allowing(_ q: [String: Any]) -> [String: Any] {
    var q = q; q[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIAllow; return q
  }
}
