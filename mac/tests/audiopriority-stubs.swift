// Stand ins for tests/audiopriority-test.sh and audiopriority-real-test.sh: just enough of PS for
// Sources/AudioPriority*.swift and Headphones.swift to build alone.
import Foundation
func psLog(_ s: String) { if ProcessInfo.processInfo.environment["AP_LOG"] != nil { print("  log:", s) } }
enum Protected {
  static func matches(_ s: String?) -> Bool {
    guard let id = s?.lowercased() else { return false }
    return id.contains("1password") || id.contains("agilebits") || id.contains("whispersystems") || id.contains("signal")
  }
}
enum Features {
  static var answers: [String: Bool] = [:]
  static var observers: [() -> Void] = []
  static func on(_ id: String) -> Bool { answers[id] ?? true }
}
