// The "Install PS" screen (the developer, 27 Oct 2026): opening PS straight from PS.dmg on a Mac shows this
// instead of PS itself. It copies PS to Applications (one atomic step, signature checked), unpacks
// The developer's backgrounds (the silent copies PS makes, shipped next to the app in the DMG so the second
// Mac never has to make them again), installs the web files, walks through the permissions with
// the names macOS 27 uses, then opens the installed PS and ejects the DMG.
// PS opened from anywhere else outside Applications (Downloads, the desktop) shows the same screen as
// "Move PS to Applications" (the developer, 31 Oct 2026): PS updates itself only from /Applications. Once the
// copy there is open, the one it was opened from goes to the Trash.
// Nothing here goes online. Test copies install into folders they are given, never /Applications.
import AppKit
import ApplicationServices

final class Installer {
  static let shared = Installer()
  private(set) var ui: UpdateUI?
  private let q = DispatchQueue(label: "PS installer", qos: .userInitiated)
  private var permTimer: Timer?
  private(set) var log: [String] = []
  /// Test copies: the permission answers come from here instead of macOS.
  var fakePerms: [String: Bool]?

  // System Settings pane names on macOS 27 (Privacy & Security), and how to open each one.
  static let axPane = "Device Control and Data Access"
  static let audioPane = "Screen & System Audio Recording"
  static let axURL = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
  static let audioURL = "x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture"

  /// PS was opened from the DMG (or from Gatekeeper's temporary copy of it): install instead of run.
  /// Opened from any other place outside Applications: offer to move it there.
  static func shouldRun() -> Bool {
    let env = ProcessInfo.processInfo.environment
    if UpdatePaths.test { return env["PS_SELFTEST_ONLY"] == "install" || env["PS_SELFTEST_ONLY"] == "move" }
    let path = Bundle.main.bundleURL.standardizedFileURL.path
    if (path as NSString).deletingLastPathComponent == "/Applications" { return false }   // installed, under any name (V1.36)
    if translocated() { return true }
    return fromDiskImage(path) || movable(path)
  }
  static func fromDiskImage(_ path: String) -> Bool {
    var fs = statfs()
    let readOnly = statfs(path, &fs) == 0 && (fs.f_flags & UInt32(MNT_RDONLY)) != 0
    return readOnly || path.hasPrefix("/Volumes/")
  }
  /// A copy that may be moved: never a build (ps-mac/build/PS.app, the M1's job builds) and never
  /// PS's own update work (rolled back builds, the stage next to Applications).
  static func movable(_ path: String) -> Bool {
    !((path as NSString).deletingLastPathComponent.hasSuffix("/build") || path.contains("/Library/Application Support/PS/") || path.contains("/.PS-update/"))
  }
  /// The copy PS was opened from, where it really sits (not Gatekeeper's temporary copy).
  static func originalApp() -> URL { originalFolder().appendingPathComponent(Bundle.main.bundleURL.lastPathComponent, isDirectory: true) }
  /// Moving rather than installing from a disk image: the original is not on a disk image.
  static let moving: Bool = {
    if UpdatePaths.test { return ProcessInfo.processInfo.environment["PS_SELFTEST_ONLY"] == "move" }
    return !fromDiskImage(originalApp().standardizedFileURL.path)
  }()

  // Gatekeeper may run a downloaded app from a random read-only copy ("App Translocation").
  // These two Security calls say so and give the real place (to find the backgrounds next to it).
  private typealias IsTransFn = @convention(c) (CFURL, UnsafeMutablePointer<DarwinBoolean>, UnsafeMutablePointer<Unmanaged<CFError>?>?) -> DarwinBoolean
  private typealias OrigFn = @convention(c) (CFURL, UnsafeMutablePointer<Unmanaged<CFError>?>?) -> Unmanaged<CFURL>?
  private static let sec = dlopen("/System/Library/Frameworks/Security.framework/Security", RTLD_NOW)
  static func translocated() -> Bool {
    guard let s = dlsym(sec, "SecTranslocateIsTranslocatedURL") else { return false }
    var yes: DarwinBoolean = false
    _ = unsafeBitCast(s, to: IsTransFn.self)(Bundle.main.bundleURL as CFURL, &yes, nil)
    return yes.boolValue
  }
  /// Where PS.app really sits (the DMG's folder), even when Gatekeeper moved it.
  static func originalFolder() -> URL {
    if translocated(), let s = dlsym(sec, "SecTranslocateCreateOriginalPathForURL"),
       let u = unsafeBitCast(s, to: OrigFn.self)(Bundle.main.bundleURL as CFURL, nil)?.takeRetainedValue() {
      return (u as URL).deletingLastPathComponent()
    }
    return Bundle.main.bundleURL.deletingLastPathComponent()
  }
  static func payload() -> URL? {
    let near = originalFolder().appendingPathComponent(".ps-payload", isDirectory: true)
    if FileManager.default.fileExists(atPath: near.path) { return near }
    // Last resort: any mounted volume called PS with the payload on it.
    for v in (try? FileManager.default.contentsOfDirectory(atPath: "/Volumes")) ?? [] {
      let p = URL(fileURLWithPath: "/Volumes").appendingPathComponent(v).appendingPathComponent(".ps-payload", isDirectory: true)
      if FileManager.default.fileExists(atPath: p.path) { return p }
    }
    return nil
  }

  // MARK: the screen

  func start() {
    let u = UpdateUI(install: true)
    u.onClick = { [weak self] id in self?.clicked(id) }
    ui = u
    if Installer.moving { u.call("moving") }
    // Local first (V1.44): a Mac that never used PS is asked where the list lives (the same settings domain as the
    // installed copy, so its answer is there when it opens). A Mac with a project, a sign in or an answer is not.
    u.call("askStore", ProjectStore.choiceOpen)
    prefillName()
    u.present()
    // Closing the install window quits (nothing else of PS runs from the DMG).
    if !UpdatePaths.test {
      NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: u.window, queue: .main) { _ in NSApp.terminate(nil) }
    }
    psLog("PS install: screen shown (\(Installer.moving ? "move" : "disk image")), PS opened from \(Bundle.main.bundlePath)")
  }

  func clicked(_ id: String) {
    log.append("click:\(id)")
    switch id {
    case "start": run()
    case "finish": finish()
    case "open:ax":
      if fakePerms == nil {
        // macOS adds PS to the list with its own prompt, and the pane opens on it.
        _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
        NSWorkspace.shared.open(URL(string: Installer.axURL)!)
      }
    case "open:audio":
      if fakePerms == nil { requestAudio { _ in }; NSWorkspace.shared.open(URL(string: Installer.audioURL)!) }
    default: break
    }
  }

  private func step(_ id: String, _ st: String, _ frac: Double? = nil, _ detail: String? = nil) {
    ui?.call("step", id, st, frac as Any? ?? NSNull(), detail as Any? ?? NSNull())
  }

  // MARK: the name (V1.36, the developer 6 Nov 2026: "when installing give the option to rename the app")
  // The welcome page has a name field. It starts with the name PS already has on this Mac ("PS app" unless the
  // person picked another), else "PS app". The copy goes in as "<name>.app" (a PS.app already there stays PS.app
  // when the name is left as "PS app"); a PS already there under another name is
  // replaced and moved out of Applications into PS's own update folder (never deleted), so there is one PS.

  /// The PS already in Applications (any name), found when the screen opens (off the main thread).
  private var existing: URL?
  private var running = false
  private(set) var installedAt: URL?
  private(set) var chosenName = AppName.publicDefault

  private func prefillName() {
    guard let apps = UpdatePaths.apps else { return }
    let mine = Installer.moving ? Installer.originalApp().standardizedFileURL.path : ""
    q.async { [self] in
      // The copy being moved is not "the one already there" (it is not in Applications anyway).
      let found = AppName.installed(in: apps).flatMap { $0.standardizedFileURL.path == mine ? nil : $0 }
      DispatchQueue.main.async {
        self.existing = found
        self.chosenName = found.map { AppName.name(of: $0) } ?? AppName.publicDefault
        self.ui?.call("name", self.chosenName, AppName.maxLength)
      }
    }
  }

  /// The Install (or Move) click: the typed name checked first (plain words on the welcome page when it cannot be
  /// used), then the copy. A name taken by anything that is not PS is refused; nothing is ever replaced but PS.
  private func run() {
    guard let apps = UpdatePaths.apps, !running else { return }
    let name = AppName.tidy((ui?.clicked["name"] as? String) ?? chosenName)
    if let why = AppName.problem(name) { log.append("name-refused"); ui?.call("nameError", why); return }
    running = true
    let existingNow = existing
    q.async { [self] in
      // V1.49: the default name over a copy that older versions named by themselves (PS.app) goes into the SAME
      // folder, so the path (and what Little Snitch and the restart helper know) does not change.
      let own = apps.appendingPathComponent(AppName.folder(name), isDirectory: true)
      let target: URL
      if name.caseInsensitiveCompare(AppName.defaultName) == .orderedSame, let e = existingNow,
         let f = AppName.folderName(of: e), AppName.isLegacyDefault(f), AppName.ownBundle(e.path, apps: apps.path) { target = e } else { target = own }
      let taken = FileManager.default.fileExists(atPath: target.path) && AppName.bundleID(of: target) != AppName.bundleID
      DispatchQueue.main.async {
        if taken {
          self.running = false; self.log.append("name-refused")
          self.ui?.call("nameError", "There is already something called \(name) in Applications. Pick another name.")
          return
        }
        self.chosenName = name
        self.ui?.call("name", name, AppName.maxLength)
        self.copyIn(apps, target)
      }
    }
  }

  /// Copy, unpack, then the permissions page. All file work is off the main thread.
  private func copyIn(_ apps: URL, _ target: URL) {
    ui?.call("page", "pSteps")
    step("sCopy", "now", 0, "Getting ready")
    let src = Bundle.main.bundleURL
    installedAt = target
    let orig = Installer.moving ? Installer.originalApp().standardizedFileURL.path : ""
    q.async { [self] in
      // PS there under another name (looked for again now, the click may beat the first look): it is replaced.
      let before = AppName.allInstalled(in: apps).filter { !AppName.sameItem($0.path, target.path) && $0.standardizedFileURL.path != orig }
      psLog("PS install: installing as \(target.lastPathComponent)\(before.isEmpty ? "" : " (replacing \(before.map(\.lastPathComponent).joined(separator: ", ")))")")
      do {
        // 1. Copy PS to Applications (a running PS from there is asked to quit first).
        if !UpdatePaths.test {
          let paths = [target.path] + before.map { $0.standardizedFileURL.path }
          let running = NSRunningApplication.runningApplications(withBundleIdentifier: "com.cincee.ps")
            .filter { SafeSignal.usable($0.processIdentifier) && paths.contains($0.bundleURL?.standardizedFileURL.path ?? "") }
          running.forEach { $0.terminate() }
          let until = Date().addingTimeInterval(8)
          while running.contains(where: { !$0.isTerminated }) && Date() < until { Thread.sleep(forTimeInterval: 0.1) }
        }
        let stage = (UpdateFiles.sameVolume(UpdatePaths.support.deletingLastPathComponent(), apps) ? UpdatePaths.work : apps.appendingPathComponent(".PS-update", isDirectory: true))
          .appendingPathComponent("install", isDirectory: true)
        let copy = stage.appendingPathComponent("PS.app", isDirectory: true)
        try? FileManager.default.removeItem(at: stage)
        try FileManager.default.createDirectory(at: stage, withIntermediateDirectories: true)
        let total = Installer.bytes(src)
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
        p.arguments = ["--noqtn", src.path, copy.path]
        try p.run()
        while p.isRunning {
          let f = total > 0 ? Double(Installer.bytes(copy)) / Double(total) : 0
          DispatchQueue.main.async { self.step("sCopy", "now", min(f, 0.99), "\(mb(Int64(f * Double(total)))) of \(mb(total)) MB") }
          Thread.sleep(forTimeInterval: 0.08)
        }
        guard p.terminationStatus == 0 else { throw UpdateError("could not copy PS app") }
        try UpdateFiles.stripQuarantine(copy)
        if let why = UpdateFiles.signatureProblem(copy) { throw UpdateError("the copy failed the code signature check: \(why)") }
        let hadOne = FileManager.default.fileExists(atPath: target.path)
        try UpdateFiles.swap(copy, target)
        if hadOne {
          let prev = stage.deletingLastPathComponent().appendingPathComponent("previous", isDirectory: true)
          try? FileManager.default.removeItem(at: prev)
          try? FileManager.default.createDirectory(at: prev, withIntermediateDirectories: true)
          try? FileManager.default.moveItem(at: copy, to: prev.appendingPathComponent("PS-installed-before"))
        }
        // The PS that was there under another name leaves Applications (kept in the update folder, never deleted).
        for (i, old) in before.enumerated() where AppName.ownBundle(old.path, apps: apps.path) {
          let prev = stage.deletingLastPathComponent().appendingPathComponent("previous", isDirectory: true)
          try? FileManager.default.createDirectory(at: prev, withIntermediateDirectories: true)
          let aside = prev.appendingPathComponent("PS-renamed-before-\(Int(Date().timeIntervalSince1970))-\(i)")
          do { try FileManager.default.moveItem(at: old, to: aside); psLog("PS install: the PS that was there under another name was moved out of Applications") }
          catch { psLog("PS install: could not move the other PS out of Applications: \(error.localizedDescription)") }
        }
        try? FileManager.default.removeItem(at: stage)
        psLog("PS install: PS copied to \(target.path)")
        DispatchQueue.main.async { self.step("sCopy", "done", 1, "In Applications") ; self.step("sBg", "now", 0, "") }
        Thread.sleep(forTimeInterval: 0.35)

        // 2. Backgrounds (and the newest web files) from the DMG.
        var n = 0
        if let pay = Installer.payload() {
          let from = pay.appendingPathComponent("backgrounds", isDirectory: true), to = UpdatePaths.backgrounds
          try FileManager.default.createDirectory(at: to, withIntermediateDirectories: true)
          let files = ((try? FileManager.default.contentsOfDirectory(atPath: from.path)) ?? []).filter { $0.hasSuffix(".mp4") || $0.hasSuffix(".json") }.sorted()
          let all = files.reduce(Int64(0)) { $0 + Installer.size(from.appendingPathComponent($1)) }
          var done: Int64 = 0
          for f in files {
            let a = from.appendingPathComponent(f), b = to.appendingPathComponent(f)
            let s = Installer.size(a)
            if Installer.size(b) != s {
              let tmp = to.appendingPathComponent(".\(f).part")
              try? FileManager.default.removeItem(at: tmp)
              try FileManager.default.copyItem(at: a, to: tmp)
              try? FileManager.default.removeItem(at: b)
              try FileManager.default.moveItem(at: tmp, to: b)
            }
            done += s
            if f.hasSuffix(".mp4") { n += 1 }
            let frac = all > 0 ? Double(done) / Double(all) : 1
            DispatchQueue.main.async { self.step("sBg", "now", frac, "\(n) video\(n == 1 ? "" : "s")") }
          }
          try? UpdateFiles.stripQuarantine(to)
        }
        let bundled = target.appendingPathComponent("Contents/Resources/web", isDirectory: true)
        if let b = PSVersion.web(at: bundled), (PSVersion.web()?.built ?? "") < b.built { try UpdateFiles.installWeb(from: bundled, to: UpdatePaths.web) }
        psLog("PS install: \(n) backgrounds unpacked")
        DispatchQueue.main.async {
          self.step("sBg", "done", 1, n == 0 ? "Ready" : "\(n) video\(n == 1 ? "" : "s") ready")
          self.step("sPerm", "now")
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { self.permissions() }
        }
      } catch {
        DispatchQueue.main.async {
          psLog("PS install: stopped: \(error)")
          self.step("sCopy", "now", nil, "Stopped: \(error). Nothing was changed.")
        }
      }
    }
  }

  // MARK: permissions

  func axGranted() -> Bool { fakePerms?["ax"] ?? AXIsProcessTrusted() }
  func audioGranted() -> Bool { fakePerms?["audio"] ?? (audioStatus() == 0) }

  private func permissions() {
    ui?.call("page", "pPerms")
    refreshPerms()
    // Watched once a second, only while this page shows.
    let t = Timer(timeInterval: 1, repeats: true) { [weak self] _ in self?.refreshPerms() }
    t.tolerance = 0.2
    RunLoop.main.add(t, forMode: .common)
    permTimer = t
  }
  func refreshPerms() {
    let ax = axGranted(), audio = audioGranted()
    let list: [[String: Any]] = [
      ["id": "ax", "name": Installer.axPane, "why": "Needed: lets \(chosenName) see when you hold Tab, so the list can float over any app.", "granted": ax],
      ["id": "audio", "name": Installer.audioPane, "why": "Only for the volume mixer. Pick \"System Audio Recording Only\". Nothing is recorded.", "granted": audio],
    ]
    ui?.call("perms", list, ax ? (audio ? "Both on. You are ready." : "The mixer can be switched on later.") : "\(chosenName) works once the first one is on.")
  }

  private func finish() {
    permTimer?.invalidate(); permTimer = nil
    if let s = ui?.clicked["store"] as? String, ["local", "sync"].contains(s), ProjectStore.choiceOpen {
      ProjectStore.setupStore = s
      log.append("store:\(s)")
      psLog("PS install: list lives \(s == "local" ? "on this Mac" : "in their own Supabase")")
    }
    step("sPerm", "done"); step("sOpen", "now")
    ui?.call("page", "pDone")
    guard let target = installedAt ?? UpdatePaths.target else { return }
    let volume = Installer.originalFolder().path
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) {
      psLog("PS install: opening \(target.path)")
      if UpdatePaths.test {
        // A test copy starts the installed copy as a hidden child that only says it started.
        let p = Process(); p.executableURL = target.appendingPathComponent("Contents/MacOS/PS")
        var e = ProcessInfo.processInfo.environment; e["PS_SELFTEST_CHILD"] = "1"; e["PS_SELFTEST_CHILD_ROLE"] = "installed"; e.removeValue(forKey: "PS_SELFTEST_ONLY")
        p.environment = e
        try? p.run()
        self.log.append("launched")
        if Installer.moving { self.trashOriginal(target) }
        return
      }
      let c = NSWorkspace.OpenConfiguration()
      c.createsNewApplicationInstance = true
      if volume.hasPrefix("/Volumes/") { c.arguments = ["--ps-eject", volume] }
      NSWorkspace.shared.openApplication(at: target, configuration: c) { app, _ in
        if app != nil, Installer.moving { self.trashOriginal(target) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { NSApp.terminate(nil) }
      }
    }
  }

  /// Moving: the copy PS was opened from goes to the Trash (never deleted) once the one in
  /// Applications is open. Never the installed copy, never a disk image. A test copy puts it in its
  /// own folder instead of the Trash.
  func trashOriginal(_ target: URL) {
    let orig = Installer.originalApp().standardizedFileURL
    guard orig.path != target.standardizedFileURL.path, !Installer.fromDiskImage(orig.path), Installer.movable(orig.path),
          FileManager.default.fileExists(atPath: orig.appendingPathComponent("Contents/Info.plist").path) else { return }
    do {
      if UpdatePaths.test, let t = ProcessInfo.processInfo.environment["PS_SELFTEST"] {
        let bin = URL(fileURLWithPath: t, isDirectory: true).appendingPathComponent("trash", isDirectory: true)
        try FileManager.default.createDirectory(at: bin, withIntermediateDirectories: true)
        try FileManager.default.moveItem(at: orig, to: bin.appendingPathComponent(orig.lastPathComponent))
      } else {
        try FileManager.default.trashItem(at: orig, resultingItemURL: nil)
      }
      log.append("trashed")
      psLog("PS install: moved, the old copy went to the Trash")
    } catch { psLog("PS install: could not put the old copy in the Trash: \(error.localizedDescription)") }
  }

  /// The installed PS ejects the DMG it was installed from (it cannot while the DMG copy runs).
  static func ejectIfAsked() {
    let a = CommandLine.arguments
    guard let i = a.firstIndex(of: "--ps-eject"), a.count > i + 1, a[i + 1].hasPrefix("/Volumes/") else { return }
    let vol = URL(fileURLWithPath: a[i + 1])
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 3) {
      do { try NSWorkspace.shared.unmountAndEjectDevice(at: vol); psLog("PS install: ejected \(vol.path)") }
      catch { psLog("PS install: could not eject \(vol.path): \(error.localizedDescription)") }
    }
  }

  // System Audio Recording: macOS's own TCC check and request (as Mixer.swift does it).
  private typealias PreflightFn = @convention(c) (CFString, CFDictionary?) -> Int
  private typealias RequestFn = @convention(c) (CFString, CFDictionary?, @escaping (Bool) -> Void) -> Void
  private let tcc = dlopen("/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC", RTLD_NOW)
  func audioStatus() -> Int {
    guard let tcc, let s = dlsym(tcc, "TCCAccessPreflight") else { return 2 }
    return unsafeBitCast(s, to: PreflightFn.self)("kTCCServiceAudioCapture" as CFString, nil)
  }
  func requestAudio(_ done: @escaping (Bool) -> Void) {
    guard let tcc, let s = dlsym(tcc, "TCCAccessRequest") else { done(false); return }
    unsafeBitCast(s, to: RequestFn.self)("kTCCServiceAudioCapture" as CFString, nil) { ok in done(ok) }
  }

  static func size(_ u: URL) -> Int64 { ((try? FileManager.default.attributesOfItem(atPath: u.path)[.size]) as? NSNumber)?.int64Value ?? 0 }
  static func bytes(_ dir: URL) -> Int64 {
    var n: Int64 = 0
    if let e = FileManager.default.enumerator(at: dir, includingPropertiesForKeys: [.fileSizeKey, .isRegularFileKey]) {
      for case let u as URL in e { if let v = try? u.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey]), v.isRegularFile == true { n += Int64(v.fileSize ?? 0) } }
    }
    return n
  }
}
