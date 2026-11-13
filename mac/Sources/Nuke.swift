// The rule book's nuke (the developer, 28 Oct 2026, "Ride or DIE"). Marking a rule Failed in the end of day
// rule check (web views/RuleBook.tsx) removes PS from this Mac at once, no confirm:
//  1. exactly what "Sign out of this Mac" does: the page locks, both Keychain items of PS's own sign
//     in (Remember me and the Touch ID lock) are deleted;
//  2. the running app's own bundle goes to the Trash (FileManager.trashItem, never rm), only when it is
//     this app's own bundle straight inside /Applications, whatever it is called (V1.36: people may rename
//     it, AppName.ownBundle: a real .app there with PS's bundle id). Nothing else is touched;
//  3. PS quits with NSApp.terminate (never a signal).
// The vault on the server is never touched. The developer comes back by installing PS again from Google Drive
// "YOUR_SYNC_FOLDER/PS App" and signing in with his passphrase. One plain log line, never the rule's words.
// Test copies: TouchLock keeps their sign in in memory (the real Keychain is never read or written),
// and the only thing they may trash is PS_SELFTEST_NUKE_TARGET, a dummy .app inside the test
// folder. Without it a test copy trashes nothing, and never anything in /Applications.
import AppKit

enum Nuke {
  static let line = "PS nuke: a rule was failed, PS removed itself"
  private(set) static var fired = false

  /// The bundle to put in the Trash, or nil when nothing may be touched. `apps`: the Applications folder
  /// (the self test passes a fake one to prove the rule; live PS always uses /Applications).
  static func target(test: Bool, env: [String: String], bundle: String, apps: String = "/Applications") -> URL? {
    if test {
      guard let t = env["PS_SELFTEST_NUKE_TARGET"], let dir = env["PS_SELFTEST"], let folder = AppName.real(dir), let p = AppName.real(t) else { return nil }
      guard p.hasPrefix(folder + "/") else { return nil }      // only inside the test folder
      guard (p as NSString).pathExtension.lowercased() == "app", !p.hasPrefix("/Applications/") else { return nil }
      return URL(fileURLWithPath: p, isDirectory: true)
    }
    // Live: only this app's own bundle, a real .app straight inside Applications with PS's bundle id.
    guard AppName.ownBundle(bundle, apps: apps), let p = AppName.real(bundle) else { return nil }
    return URL(fileURLWithPath: p, isDirectory: true)
  }

  /// Main thread only; the Keychain and the Trash run off it.
  static func run(_ a: App) {
    dispatchPrecondition(condition: .onQueue(.main))
    guard !fired else { return }
    fired = true
    psLog(line)
    let test = a.selfTest
    let url = target(test: test, env: ProcessInfo.processInfo.environment, bundle: Bundle.main.bundlePath)
    // Sign out of this Mac, as Settings does.
    Owner.set(false)
    a.sendToMain(#"{"type":"lock"}"#); a.hideOverlay(force: true)
    DispatchQueue.global(qos: .userInitiated).async {
      TouchLock.signOut()
      var trashed: URL?, err = ""
      if let url {
        var out: NSURL?
        do { try FileManager.default.trashItem(at: url, resultingItemURL: &out); trashed = out as URL? } catch { err = error.localizedDescription }
      }
      DispatchQueue.main.async {
        if url != nil && trashed == nil { psLog("PS nuke: could not move PS to the Trash (\(err.prefix(120)))") }
        if test {
          print("NUKE SIGNED OUT:", TouchLock.readRemembered() == nil && TouchLock.readLocked() == nil ? "ok" : "FAIL")
          print("NUKE TRASHED:", trashed?.path ?? "none")
          print(ScreenGuard.report()); print(NetGuard.report())
          print("DONE")
        }
        NSApp.terminate(nil)
      }
    }
  }
}

/// Self test (NUKE TARGET CHECK, V1.36): the live rule with renamed bundles, in a fake Applications folder made
/// inside the test folder. Only this app's own bundle straight inside Applications passes, whatever its name.
enum NukeRules {
  static func renamed(_ base: String) -> [(String, Bool)] {
    let fm = FileManager.default
    let apps = base + "/apps"
    func bundle(_ path: String, _ id: String?) {
      try? fm.createDirectory(atPath: path + "/Contents", withIntermediateDirectories: true)
      if let id, let d = try? PropertyListSerialization.data(fromPropertyList: ["CFBundleIdentifier": id], format: .xml, options: 0) {
        try? d.write(to: URL(fileURLWithPath: path + "/Contents/Info.plist"))
      }
    }
    let own = apps + "/To Do List - by Cincee.app"
    bundle(own, AppName.bundleID)
    bundle(apps + "/Other.app", "com.example.other")
    bundle(apps + "/No Info.app", nil)
    bundle(base + "/deep/Own.app", AppName.bundleID)
    try? fm.createSymbolicLink(atPath: apps + "/Escape.app", withDestinationPath: base + "/deep/Own.app")
    func live(_ b: String) -> URL? { Nuke.target(test: false, env: [:], bundle: b, apps: apps) }
    return [
      ("live-renamed-own-bundle", live(own)?.path == AppName.real(own)),
      ("live-foreign-app-refused", live(apps + "/Other.app") == nil),
      ("live-no-info-refused", live(apps + "/No Info.app") == nil),
      ("live-not-straight-in-apps-refused", live(base + "/deep/Own.app") == nil),
      ("live-apps-folder-itself-refused", live(apps) == nil),
      ("live-symlink-out-refused", live(apps + "/Escape.app") == nil),
      ("live-dotdot-out-refused", live(apps + "/../deep/Own.app") == nil),
      ("test-renamed-dummy-ok", Nuke.target(test: true, env: ["PS_SELFTEST": base, "PS_SELFTEST_NUKE_TARGET": own], bundle: "x") != nil),
    ]
  }
}
