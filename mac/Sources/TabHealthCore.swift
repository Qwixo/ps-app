import Foundation

// Tab health (V1.41, the developer, 8 Nov 2026: a friend's Tab was dead after an update and a restart, with no word why).
// Every way the keyboard tap can be deaf becomes one line in the log and, when it needs the person, one notice on
// the "PS is active" card that stays until it is fixed and goes by itself after. Plain values only (testable).
// The keyboard tap only ever notes WHEN a key went by, never which; macOS's own "seconds since the last key"
// is the same kind of number.

/// What the card tells about Tab, worst first. nil: nothing wrong.
struct TabNotice: Equatable {
  var text: String
  var button: String?
  var action: String?
}

enum TabHealth {
  /// The tap is deaf: someone typed in the last few seconds (macOS's own count), yet the tap has had no key for
  /// `quiet` seconds, the tap and the app in front have been settled that long (never right after 1Password or
  /// Signal, where the tap is off on purpose), this session is the one at the screen, and Secure Input is off
  /// (that has its own notice).
  static func deaf(systemKeyAgo: Double, tapKeyAgo: Double, settledFor: Double, onConsole: Bool, secureInput: Bool, quiet: Double = 20) -> Bool {
    systemKeyAgo < 4 && tapKeyAgo > quiet && settledFor > quiet && onConsole && !secureInput
  }

  /// The one notice the card shows, worst first.
  static func notice(tabOn: Bool, trusted: Bool, secureNote: String?, deaf: Bool, appName: String, keyName: String) -> TabNotice? {
    guard tabOn else { return nil }   // switched off: the card's own "Turn on" notice says so
    if !trusted {
      return TabNotice(text: "macOS is not letting \(appName) see the \(keyName) key. Click Open settings, then switch \(appName) on in Accessibility (if it is on already, switch it off and on).",
                       button: "Open settings", action: "fix")
    }
    if let secureNote { return TabNotice(text: secureNote, button: nil, action: nil) }
    if deaf {
      return TabNotice(text: "macOS is not passing keys to \(appName), so holding \(keyName) does nothing. Click Open settings, then switch \(appName) on in Accessibility again.",
                       button: "Open settings", action: "fix")
    }
    return nil
  }
}
