import Cocoa

// THE DEVELOPER'S GOLDEN RULE: PS never looks at or touches 1Password or Signal. Not their names, not their
// time, not their keystrokes, never brings them forward. The only thing PS ever checks is whether
// the app in front IS one of them (its bundle id, at the moment it comes to the front), so it can
// step aside completely. Matching is broad on purpose: any 1Password or Signal build or helper.
// While one of them is in front the keyboard tap is switched OFF (macOS hands PS none of its keys).
// Over both, the Tab list can still be held up through SafePeek: Signal since 17 Oct, 1Password
// since V1.40 (the developer, 7 Nov: "make it so you can do the tab overlay over the 1Password app"). SafePeek
// is one macOS hotkey for plain Tab, so PS still never sees a key typed in either app.
enum Protected {
  static func matches(_ bundleId: String?) -> Bool {
    guard let id = bundleId?.lowercased() else { return false }
    return id.contains("1password") || id.contains("agilebits") || id.contains("whispersystems") || id.contains("signal")
  }
  static func matches(_ app: NSRunningApplication?) -> Bool { matches(app?.bundleIdentifier) }
  static func isSignal(_ bundleId: String?) -> Bool {
    guard let id = bundleId?.lowercased() else { return false }
    return id.contains("whispersystems") || id.contains("signal")
  }

  /// True while 1Password or Signal is the app in front. Kept up to date by one observer, so the
  /// keyboard tap can step aside instantly without asking macOS on every key.
  private(set) static var front = false
  /// True while the app in front is Signal (not 1Password). Since V1.40 nothing depends on it: SafePeek
  /// arms over both. Kept so the self tests can still say which of the two they are pretending is in front.
  private(set) static var signalFront = false
  /// Runs on the main thread whenever either flag changes.
  static var onChange: (() -> Void)?
  static func start() {
    set(NSWorkspace.shared.frontmostApplication?.bundleIdentifier)
    NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { n in
      set((n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)?.bundleIdentifier)
    }
  }
  private static func set(_ id: String?) {
    let f = matches(id), s = f && isSignal(id)
    guard f != front || s != signalFront else { return }
    front = f; signalFront = s
    onChange?()
  }
  /// Self test only: act as if 1Password or Signal were in front (no real app is involved).
  static func simulate(front f: Bool, signal s: Bool) { front = f; signalFront = s; onChange?() }
}
