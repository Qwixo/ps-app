// Stand ins for the Sleep screen unit test (tests/sleepscreen-test.sh): nothing real is read, shown or asked.
import Foundation
import AppKit
func psLog(_ s: String) {}
enum UpdatePaths { static let test = true }
enum Protected { static var front = false; static func matches(_ bundleId: String?) -> Bool { false } }
enum TouchLock { static func evaluate(_ reason: String, _ done: @escaping (Bool, String) -> Void) { done(false, "fake") } }
final class DND { static let shared = DND(); func mutes(_ kind: String) -> Bool { false } }
enum Sfx {
  struct Tone { let f: Double; let to: Double?; let dur: Double; let peak: Double; let wave: Int; let at: Double }
  static func wav(_ tones: [Tone]) -> Data { Data() }
}
/// V1.43: the volume, brightness and fonts, faked: a test never touches the real ones. The fakes record what they were
/// asked so the test can check that Loud and Bright white put everything back.
enum SleepHW {
  static var vol: (volume: Float, muted: Bool)? = (0.3, true)
  static var bright: Float? = 0.4
  static var calls: [String] = []
  static func fontDir() -> URL? { nil }
  static func volume() -> (volume: Float, muted: Bool)? { vol }
  static func setVolume(_ v: Float, muted: Bool) { calls.append("vol \(v) \(muted)"); vol = (v, muted) }
  static func brightness(_ d: CGDirectDisplayID) -> Float? { bright }
  @discardableResult static func setBrightness(_ d: CGDirectDisplayID, _ v: Float) -> Bool { calls.append("bright \(v)"); bright = v; return true }
}
