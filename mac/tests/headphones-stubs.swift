// Stand ins for tests/headphones-test.sh: just enough of PS for Sources/Headphones.swift to build alone.
import Foundation
func psLog(_ s: String) { if ProcessInfo.processInfo.environment["HP_LOG"] != nil { print("  log:", s) } }
enum Protected {
  static func matches(_ s: String?) -> Bool {
    guard let id = s?.lowercased() else { return false }
    return id.contains("1password") || id.contains("agilebits") || id.contains("whispersystems") || id.contains("signal")
  }
}
final class Toast { static let shared = Toast(); func showCard(_ c: [String: Any]) {} }
final class AutoRoute {
  static let shared = AutoRoute()
  private let l = NSLock()
  private var own: [String] = []
  func noteOwnInput(_ uid: String) { l.lock(); own.append(uid); l.unlock() }
  var owned: [String] { l.lock(); defer { l.unlock() }; return own }
}
