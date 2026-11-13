// Sleep mode's hold on this Mac's own volume, brightness and font files (V1.43 wake styles; SleepWake.swift has the
// rules). Kept apart so the unit test (tests/sleepscreen-test.sh) swaps every one of them for a stand in: a test never
// touches the real volume or brightness. Called on SleepScreen's own background queue, never the main thread.
//  - Loud: the output volume goes to full and unmuted for the alarm, and back to what it was the moment it stops.
//  - Bright white and Strobe flash: the display under the clock goes to full brightness, and back after.
import Cocoa

enum SleepHW {
  /// The web files' assets folder: the clock's bundled fonts are there (the same files the page uses).
  static func fontDir() -> URL? { webRoot().appendingPathComponent("assets", isDirectory: true) }
  static func volume() -> (volume: Float, muted: Bool)? { CoreAudioMix().master() }
  static func setVolume(_ v: Float, muted: Bool) { CoreAudioMix().setMaster(volume: max(0, min(1, v)), muted: muted) }
  static func brightness(_ d: CGDirectDisplayID) -> Float? { TorchLightBrightness.read(d) }
  @discardableResult static func setBrightness(_ d: CGDirectDisplayID, _ v: Float) -> Bool { TorchLightBrightness.write(d, v) }
}
