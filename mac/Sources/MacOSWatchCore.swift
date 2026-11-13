// V1.47: the rule behind MacOSWatch.swift's start line, with no AppKit so tests/macos-watch-test.swift can run it.
import Foundation

enum MacOSWatchCore {
  /// The line for this start, and whether macOS changed since the last one (nil or empty: the first start with this code).
  static func note(now: String, last: String?) -> (line: String, changed: Bool) {
    guard let last, !last.isEmpty, last != now else { return ("PS start: macOS \(now)", false) }
    return ("PS start: macOS updated from \(last) to \(now)", true)
  }
}
