// Is the developer at the Mac right now? Used by "Shall I end my day now?" (src/eodask.ts) so the card only
// comes while he is here: idle, locked or asleep at noon means it waits until he is back.
// Reads only the time since the last input and whether the screen is locked: never which key,
// never any app's content (1Password and Signal included).
import AppKit
import CoreGraphics

enum Here {
  static let idleLimit = 120.0        // seconds with no input before the developer counts as away

  static func now() -> Bool {
    let idle = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: CGEventType(rawValue: ~0)!)
    let session = CGSessionCopyCurrentDictionary() as? [String: Any]
    let locked = session?["CGSSessionScreenIsLocked"] as? Bool ?? false
    let onConsole = session?["kCGSSessionOnConsoleKey"] as? Bool ?? true
    return idle < idleLimit && !locked && onConsole
  }
}
