// The app's name on this Mac (V1.36, the developer 6 Nov 2026: "on the public release, call it 'To Do List - by
// Cincee' and when installing give the option to rename the app to something they like the name of. And
// in the settings menu make it so you can change the name of the app too").
//
// The name IS the .app folder's name in Applications: what Finder, Launchpad, Spotlight and the Dock show.
// Nothing inside the signed bundle changes: Info.plist (CFBundleName and CFBundleDisplayName stay "PS"),
// the bundle id com.cincee.ps, the executable Contents/MacOS/PS, the URL scheme, the log folder, the
// defaults domain and every Keychain label stay as they are. So the code signature, Accessibility (TCC
// keys it to the bundle id and the signing certificate, not the path), the Keychain items (tied to the
// build, not the path) and the updater (it swaps whatever folder this copy really runs from) keep working.
// macOS itself still says PS wherever it reads Info.plist (the bold name in the menu bar, Activity Monitor).
//
// V1.49 (the developer, 12 Nov 2026: "change the name of the app to 'PS app' for everyone, even on the public release"):
// the app is called "PS app" for everyone, private and public. Info.plist now says "PS app" too, so the bold
// name in the menu bar, the Dock and the app switcher say it. A fresh install lands as "PS app.app" unless the
// person types another name on the Install screen. The folders older versions made (PS.app on the developer's Macs and
// the first friends, "To Do List - by Cincee.app" from the V1.36 public install) are NOT moved (a new path would
// cost every Mac a new Little Snitch prompt and a new approval for the restart helper): they keep their folder
// and are called "PS app" by the app. A name a person picked themselves is kept as typed.
// Pure Foundation (plus Protected's name check), so tests/appname-test.swift builds it on its own.
import Foundation

enum AppName {
  /// What the app is called for everyone unless they rename it (V1.49).
  static let defaultName = "PS app"
  /// What a fresh install is called (V1.49: the same for private and public builds).
  static let publicDefault = defaultName
  /// Folder names older versions gave the app on their own (not a choice a person made): both read as "PS app".
  static let legacyDefaults = ["PS", "To Do List - by Cincee"]
  static func isLegacyDefault(_ folderName: String) -> Bool { legacyDefaults.contains { $0.caseInsensitiveCompare(folderName) == .orderedSame } }
  /// For the few short phrases that keep the short name ("Protected by PS"): "PS" while the app has its default
  /// name, else the name the person gave it.
  static var brief: String { current == defaultName ? "PS" : current }
  static let maxLength = 60
  static let bundleID = "com.cincee.ps"

  /// The name this copy runs under: its own folder name without ".app" (read once; a rename relaunches).
  static let current: String = name(of: Bundle.main.bundleURL)
  /// `current` as a JS string literal, for the pages (window.__psAppName, main.swift config()).
  static var pageJS: String {
    (try? JSONSerialization.data(withJSONObject: [current])).flatMap { String(data: $0, encoding: .utf8) }.map { String($0.dropFirst().dropLast()) } ?? "\"PS app\""
  }
  /// The folder's own name on disk without ".app" (nil when it is not an app folder).
  static func folderName(of bundle: URL) -> String? {
    let n = bundle.deletingPathExtension().lastPathComponent
    return bundle.pathExtension.lowercased() == "app" && !n.isEmpty ? n : nil
  }
  /// What that copy is called: its folder's name, except the names older versions gave it by themselves
  /// ("PS", "To Do List - by Cincee"), which read as "PS app".
  static func name(of bundle: URL) -> String {
    guard let n = folderName(of: bundle), !isLegacyDefault(n) else { return defaultName }
    return n
  }

  // MARK: what a person may type

  /// What the person typed, tidied: spaces at the ends dropped, runs of spaces made one, a typed ".app" dropped,
  /// accents in one standard form (so "é" typed two ways is the same name on disk).
  static func tidy(_ raw: String) -> String {
    var s = raw.precomposedStringWithCanonicalMapping.trimmingCharacters(in: .whitespacesAndNewlines)
    if s.lowercased().hasSuffix(".app") { s = String(s.dropLast(4)).trimmingCharacters(in: .whitespacesAndNewlines) }
    return s.split(separator: " ", omittingEmptySubsequences: true).joined(separator: " ")
  }

  /// nil when `name` (already tidied) can be a name, else what is wrong in plain words.
  static func problem(_ name: String) -> String? {
    if name.isEmpty { return "Type a name first." }
    if name.count > maxLength { return "That name is too long. Keep it to \(maxLength) characters or fewer." }
    if name.contains("/") || name.contains(":") { return "A name cannot have / or : in it." }
    if name.hasPrefix(".") { return "A name cannot start with a dot." }
    if name.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) || $0.properties.generalCategory == .format }) {
      return "A name cannot have tabs, line breaks or hidden characters in it."
    }
    if name.utf8.count + 4 > 255 { return "That name is too long. Keep it shorter." }
    return nil
  }

  static func folder(_ name: String) -> String { name + ".app" }

  // MARK: where this app sits

  /// The real path on disk (symlinks and .. resolved), nil when it does not exist.
  static func real(_ p: String) -> String? { guard let r = realpath(p, nil) else { return nil }; defer { free(r) }; return String(cString: r) }

  /// The bundle, really sitting straight inside `apps` (not deeper), or nil. Spelled as `apps` is spelled (the
  /// update journal compares it with the path macOS starts the app from), with the folder's real name.
  static func inside(apps: URL, bundle: URL) -> URL? {
    guard bundle.pathExtension.lowercased() == "app", let b = real(bundle.path), let a = real(apps.path),
          (b as NSString).deletingLastPathComponent == a else { return nil }
    return apps.appendingPathComponent((b as NSString).lastPathComponent, isDirectory: true)
  }

  /// The bundle id an app folder says it has (nil: not an app, or no Info.plist).
  static func bundleID(of app: URL) -> String? {
    guard let d = FileManager.default.contents(atPath: app.appendingPathComponent("Contents/Info.plist").path),
          let p = try? PropertyListSerialization.propertyList(from: d, format: nil) as? [String: Any] else { return nil }
    return p["CFBundleIdentifier"] as? String
  }

  /// True only for THIS app's own bundle in `apps`: a real .app straight inside it, with PS's bundle id.
  /// The nuke and the rename both stop at anything else, whatever it is called.
  static func ownBundle(_ path: String, apps: String) -> Bool {
    guard let p = real(path), p != "/", (p as NSString).pathExtension.lowercased() == "app",
          let a = real(apps), (p as NSString).deletingLastPathComponent == a else { return false }
    return bundleID(of: URL(fileURLWithPath: p)) == bundleID
  }

  /// PS installed in `apps` under any name (the first one found), or nil. Only names are read first:
  /// 1Password and Signal (and anything named like them) are skipped before anything of theirs is opened.
  /// Off the main thread (it reads each app's Info.plist).
  static func installed(in apps: URL) -> URL? { allInstalled(in: apps).first }
  /// Every PS straight in `apps` (normally one), same rules as `installed`.
  static func allInstalled(in apps: URL) -> [URL] {
    let fm = FileManager.default
    let names = ((try? fm.contentsOfDirectory(atPath: apps.path)) ?? []).filter { $0.lowercased().hasSuffix(".app") && !$0.hasPrefix(".") }
    return names.sorted().filter { !Protected.matches($0) }.map { apps.appendingPathComponent($0, isDirectory: true) }.filter { bundleID(of: $0) == bundleID }
  }

  /// Two paths name the very same folder on disk (a rename that only changes upper and lower case).
  static func sameItem(_ a: String, _ b: String) -> Bool {
    var x = stat(), y = stat()
    return lstat(a, &x) == 0 && lstat(b, &y) == 0 && x.st_dev == y.st_dev && x.st_ino == y.st_ino
  }

  // MARK: renaming

  struct Refusal: Error, CustomStringConvertible { let description: String; init(_ s: String) { description = s } }

  /// Renames this app's own bundle `from` (straight inside `apps`) to `name`, in one step on disk. Returns the new
  /// place. Off the main thread. Never replaces anything: a name that is taken is refused in plain words.
  @discardableResult
  static func rename(_ from: URL, to raw: String, apps: URL) throws -> URL {
    let name = tidy(raw)
    if let why = problem(name) { throw Refusal(why) }
    guard ownBundle(from.path, apps: apps.path), let src = real(from.path) else { throw Refusal("Only the copy in your Applications folder can be renamed.") }
    let dest = (real(apps.path) ?? apps.path) + "/" + folder(name)
    if src == dest { throw Refusal("It is already called \(name).") }
    let caseOnly = sameItem(src, dest)
    if FileManager.default.fileExists(atPath: dest) && !caseOnly {
      throw Refusal("There is already something called \(name) in Applications. Pick another name.")
    }
    // Never over anything: RENAME_EXCL fails if the name appeared meanwhile (a case only change is the same folder).
    let rc = caseOnly ? Darwin.rename(src, dest) : renamex_np(src, dest, UInt32(RENAME_EXCL))
    guard rc == 0 else {
      let e = errno
      if e == EEXIST { throw Refusal("There is already something called \(name) in Applications. Pick another name.") }
      if e == EPERM || e == EACCES {
        throw Refusal("macOS did not let \(current) rename itself. Turn it on in System Settings > Privacy & Security > App Management, then try again.")
      }
      throw Refusal("Could not rename it (\(String(cString: strerror(e)))). Nothing was changed.")
    }
    return URL(fileURLWithPath: dest, isDirectory: true)
  }
}
