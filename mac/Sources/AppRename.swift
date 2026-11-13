// Settings > Mac settings > App name (V1.36, the developer 6 Nov 2026: "in the settings menu make it so you can change
// the name of the app too"). The rules and the rename itself are in AppName.swift; this is the flow:
//  1. the Mac settings tab sends {"type":"appName:set","name":...} (a click on Rename only);
//  2. the name is tidied and checked here (plain words back when it cannot be a name, or is taken);
//  3. the bundle is renamed in one step on disk, OFF the main thread, only when this copy sits straight in
//     the Applications folder PS updates from, and never while an update is running;
//  4. PS opens the renamed copy (it waits for this one to quit: one PS at a time, --ps-renamed) and quits.
// Accessibility, the Keychain items and the code signature stay (none of them is tied to the folder name).
// Test copies rename only inside their own fake Applications folder (PS_SELFTEST_APPS) and start the renamed
// copy as a hidden child that only says where it runs from; they never quit by themselves.
import AppKit

/// The Sign in window's title (it names the app; NoWindow.swift finds the window by it).
let SIGN_IN_TITLE = "Sign in to \(AppName.current)"

final class AppRename {
  static let shared = AppRename()
  private let q = DispatchQueue(label: "PS rename", qos: .userInitiated)
  private(set) var busy = false
  private(set) var error: String?
  private(set) var log: [String] = []
  /// Test copies: where the renamed copy went (the self test checks it).
  private(set) var renamedTo: URL?

  /// This copy, when it may be renamed: straight inside the Applications folder PS installs and updates in.
  var here: URL? { UpdatePaths.apps.flatMap { AppName.inside(apps: $0, bundle: Bundle.main.bundleURL) } }

  /// For the Mac settings tab (main.swift sendSettings).
  func settingsJSON() -> [String: Any] {
    var d: [String: Any] = ["name": AppName.current, "busy": busy, "max": AppName.maxLength, "canRename": here != nil]
    if let error { d["error"] = error }
    return d
  }

  /// From the page (main thread). `changed` sends the settings again (busy, then an error or the relaunch).
  func set(_ raw: String, changed: @escaping () -> Void) {
    dispatchPrecondition(condition: .onQueue(.main))
    log.append("set")
    guard !busy else { return }
    let name = AppName.tidy(raw)
    if let why = AppName.problem(name) { error = why; changed(); return }
    if name == AppName.current { error = "It is already called \(name)."; changed(); return }
    guard let apps = UpdatePaths.apps, let from = here else {
      error = "Only the copy in your Applications folder can be renamed."; changed(); return
    }
    if Updater.shared.busy || UpdateJournal.read()?.phase == "swapped" {
      error = "An update is running. Try again once it is done."; changed(); return
    }
    busy = true; error = nil; changed()
    psLog("PS rename: renaming the app folder")
    q.async { [self] in
      do {
        let to = try AppName.rename(from, to: name, apps: apps)
        DispatchQueue.main.async { self.relaunch(to, changed) }
      } catch {
        let why = "\(error)"
        DispatchQueue.main.async {
          psLog("PS rename: refused (\(why.prefix(160)))")
          self.busy = false; self.error = why; changed()
        }
      }
    }
  }

  /// The folder was renamed: open the renamed copy, then quit this one (it keeps the instance lock until it is gone,
  /// and the new one waits for it). If the renamed copy cannot be opened, this one stays and says so.
  private func relaunch(_ to: URL, _ changed: @escaping () -> Void) {
    renamedTo = to
    psLog("PS rename: renamed, opening the renamed copy")
    log.append("renamed")
    if UpdatePaths.test {
      // A test copy starts the renamed copy as a hidden child that only says where it runs from.
      let p = Process(); p.executableURL = to.appendingPathComponent("Contents/MacOS/PS")
      var e = ProcessInfo.processInfo.environment; e["PS_SELFTEST_CHILD"] = "1"; e["PS_SELFTEST_CHILD_ROLE"] = "renamed"; e.removeValue(forKey: "PS_SELFTEST_ONLY")
      p.environment = e
      do { try p.run(); log.append("launched") } catch { self.error = "Renamed, but it did not open again: open it from Applications." }
      busy = false; changed()
      return
    }
    let open = Process()
    open.executableURL = URL(fileURLWithPath: "/usr/bin/open")
    open.arguments = ["-n", to.path, "--args", "--ps-renamed"]
    open.standardOutput = FileHandle.nullDevice; open.standardError = FileHandle.nullDevice
    q.async {
      var ok = true
      do {
        try open.run()
        // `open` may only return once the new copy checked in, which waits for this one to quit: give it 2 s.
        let until = Date().addingTimeInterval(2)
        while open.isRunning && Date() < until { Thread.sleep(forTimeInterval: 0.05) }
        if !open.isRunning && open.terminationStatus != 0 { ok = false }
      } catch { ok = false }
      DispatchQueue.main.async {
        if ok { NSApp.terminate(nil); return }
        psLog("PS rename: the renamed copy did not open")
        self.busy = false
        self.error = "Renamed to \(AppName.name(of: to)). Quit it and open it again from Applications to finish."
        changed()
      }
    }
  }
}
