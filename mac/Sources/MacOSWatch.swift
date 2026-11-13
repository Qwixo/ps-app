// V1.47 (the developer, 10 Nov 2026: "I'm going to be updating to macOS 27.2.1 ... make sure the PS app will work"):
// one line at every start with the macOS version, and when it differs from the last start a clear
// "macOS updated" line plus, a few seconds later, the state of everything an update can quietly switch off
// (Accessibility and the keyboard tap). Read it in ~/Library/Logs/PS/ps.log.
// Only versions and on/off states are written, never keys, tasks or app names. Self test copies keep no memory.
import AppKit

enum MacOSWatch {
  /// "Version 27.2 (Build 26B123)".
  static var current: String { ProcessInfo.processInfo.operatingSystemVersionString }

  static func atLaunch(app: App) {
    let now = current
    let key = "macos.lastSeen"
    let last = IS_TEST_COPY ? nil : UserDefaults.standard.string(forKey: key)
    let n = MacOSWatchCore.note(now: now, last: last)
    psLog(n.line)
    if !IS_TEST_COPY { UserDefaults.standard.set(now, forKey: key) }
    guard n.changed else { return }
    // Long enough for the tap to settle after login. The restart helper, the hotkey, Secure Input, the mixer and
    // Calendar already write their own line when macOS refuses or changes them.
    DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak app] in app?.logTabStatus("after the macOS update:") }
  }
}
