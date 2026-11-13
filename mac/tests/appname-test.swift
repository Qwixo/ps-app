// Offline test for Sources/AppName.swift (V1.36, the app's name): the name rules, the path rules the nuke, the
// updater and the rename stand on, and the rename itself, all inside a temporary folder (never /Applications).
//   mkdir -p build/appname && cp tests/appname-test.swift build/appname/main.swift && swiftc build/appname/main.swift Sources/AppName.swift Sources/Protected.swift -o build/appname/test && build/appname/test
import Foundation

var fails = 0, count = 0
func check(_ name: String, _ ok: Bool, _ info: String = "") { count += 1; print("\(name)=\(ok ? "ok" : "FAIL")\(info.isEmpty || ok ? "" : " (\(info))")"); if !ok { fails += 1 } }

// MARK: names
check("public-default", AppName.publicDefault == "PS app" && AppName.defaultName == "PS app" && !AppName.publicDefault.unicodeScalars.contains { $0.value == 0x2013 || $0.value == 0x2014 })
check("public-default-is-a-name", AppName.problem(AppName.publicDefault) == nil)
check("tidy-spaces", AppName.tidy("  My   List  ") == "My List")
check("tidy-dot-app", AppName.tidy("My List.app") == "My List" && AppName.tidy("My List.APP ") == "My List")
check("tidy-accents-one-form", AppName.tidy("Cafe\u{301}") == "Caf\u{e9}")
check("empty", AppName.problem(AppName.tidy("   ")) == "Type a name first.")
check("slash", AppName.problem("a/b")?.contains("/ or :") == true)
check("colon", AppName.problem("a:b")?.contains("/ or :") == true)
check("dot-first", AppName.problem(".hidden")?.contains("dot") == true)
check("tab", AppName.problem("a\tb")?.contains("hidden characters") == true)
check("newline", AppName.problem("a\nb")?.contains("hidden characters") == true)
check("zero-width", AppName.problem("a\u{200B}b")?.contains("hidden characters") == true)
check("sixty-ok", AppName.problem(String(repeating: "x", count: 60)) == nil)
check("sixty-one-too-long", AppName.problem(String(repeating: "x", count: 61))?.contains("too long") == true)
for good in ["PS", "My Tasks - test", "Liste de t\u{e2}ches", "\u{417}\u{430}\u{434}\u{430}\u{447}\u{438}", "To-do (work)", "A & B"] {
  check("good-\(good.prefix(8))", AppName.problem(good) == nil)
}
// V1.49: the names older versions gave the app by themselves read as "PS app"; a name a person picked is kept.
check("name-of-old-public-default", AppName.name(of: URL(fileURLWithPath: "/Applications/To Do List - by Cincee.app")) == "PS app")
check("name-of-old-ps-folder", AppName.name(of: URL(fileURLWithPath: "/Applications/PS.app")) == "PS app")
check("name-of-lowercase-old-ps", AppName.name(of: URL(fileURLWithPath: "/Applications/ps.app")) == "PS app")
check("name-of-new-default-folder", AppName.name(of: URL(fileURLWithPath: "/Applications/PS app.app")) == "PS app")
check("name-of-own-choice", AppName.name(of: URL(fileURLWithPath: "/Applications/My Tasks.app")) == "My Tasks")
check("name-of-build", AppName.name(of: URL(fileURLWithPath: "/x/build/PS.app")) == "PS app")
check("name-of-not-an-app", AppName.name(of: URL(fileURLWithPath: "/usr/local/bin/ps")) == "PS app")
check("folder-name-keeps-the-disk-name", AppName.folderName(of: URL(fileURLWithPath: "/Applications/PS.app")) == "PS" && AppName.folderName(of: URL(fileURLWithPath: "/usr/local/bin/ps")) == nil)
check("legacy-defaults", AppName.isLegacyDefault("PS") && AppName.isLegacyDefault("to do list - by cincee") && !AppName.isLegacyDefault("PS app") && !AppName.isLegacyDefault("My Tasks"))

// MARK: paths (a temporary fake Applications folder)
let fm = FileManager.default
let base = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("appname-test-\(getpid())", isDirectory: true)
try? fm.removeItem(at: base)
let apps = base.appendingPathComponent("Applications", isDirectory: true)
func bundle(_ u: URL, _ id: String?) {
  try? fm.createDirectory(at: u.appendingPathComponent("Contents"), withIntermediateDirectories: true)
  if let id, let d = try? PropertyListSerialization.data(fromPropertyList: ["CFBundleIdentifier": id], format: .xml, options: 0) {
    try? d.write(to: u.appendingPathComponent("Contents/Info.plist"))
  }
}
let ps = apps.appendingPathComponent("PS.app")
bundle(ps, AppName.bundleID)
bundle(apps.appendingPathComponent("Other.app"), "com.example.other")
bundle(apps.appendingPathComponent("1Password 7.app"), AppName.bundleID)   // named like a protected app: never opened, never matched
try? fm.createDirectory(at: apps.appendingPathComponent("Taken.app"), withIntermediateDirectories: true)
bundle(base.appendingPathComponent("elsewhere/Deep.app"), AppName.bundleID)

check("own-bundle", AppName.ownBundle(ps.path, apps: apps.path))
check("foreign-not-own", !AppName.ownBundle(apps.appendingPathComponent("Other.app").path, apps: apps.path))
check("plain-folder-not-own", !AppName.ownBundle(apps.appendingPathComponent("Taken.app").path, apps: apps.path))
check("deeper-not-own", !AppName.ownBundle(base.appendingPathComponent("elsewhere/Deep.app").path, apps: apps.path))
check("apps-itself-not-own", !AppName.ownBundle(apps.path, apps: apps.path))
check("missing-not-own", !AppName.ownBundle(apps.appendingPathComponent("Nope.app").path, apps: apps.path))
check("inside", AppName.inside(apps: apps, bundle: ps)?.path == ps.path)
check("inside-not-deeper", AppName.inside(apps: apps, bundle: base.appendingPathComponent("elsewhere/Deep.app")) == nil)
check("installed-finds-ps", AppName.installed(in: apps)?.lastPathComponent == "PS.app")

// MARK: renaming
func refusal(_ f: () throws -> URL) -> String { do { _ = try f(); return "" } catch { return "\(error)" } }
check("rename-bad-name", refusal { try AppName.rename(ps, to: "a/b", apps: apps) }.contains("/ or :") && fm.fileExists(atPath: ps.path))
check("rename-taken", refusal { try AppName.rename(ps, to: "Taken", apps: apps) }.contains("There is already something called Taken") && fm.fileExists(atPath: ps.path))
check("rename-same", refusal { try AppName.rename(ps, to: "PS", apps: apps) }.contains("already called PS"))   // the folder is still PS.app: same name on disk
check("rename-foreign-refused", refusal { try AppName.rename(apps.appendingPathComponent("Other.app"), to: "Mine", apps: apps) }.contains("Applications folder")
      && fm.fileExists(atPath: apps.appendingPathComponent("Other.app").path))
let to = try? AppName.rename(ps, to: "  To Do List - by Cincee.app ", apps: apps)
check("rename-ok", to?.lastPathComponent == "To Do List - by Cincee.app" && !fm.fileExists(atPath: ps.path)
      && AppName.bundleID(of: apps.appendingPathComponent("To Do List - by Cincee.app")) == AppName.bundleID)
check("installed-finds-renamed", AppName.installed(in: apps)?.lastPathComponent == "To Do List - by Cincee.app")
let renamed = apps.appendingPathComponent("To Do List - by Cincee.app")
let lower = try? AppName.rename(renamed, to: "to do list - by cincee", apps: apps)   // a case only change is allowed
check("rename-case-only", lower?.lastPathComponent == "to do list - by cincee.app"
      && ((try? fm.contentsOfDirectory(atPath: apps.path)) ?? []).contains("to do list - by cincee.app"))
check("same-item", AppName.sameItem(apps.appendingPathComponent("to do list - by cincee.app").path, apps.appendingPathComponent("TO DO LIST - BY CINCEE.app").path)
      || !fm.fileExists(atPath: apps.appendingPathComponent("TO DO LIST - BY CINCEE.app").path))   // case sensitive volumes: not the same name
try? fm.removeItem(at: base)
print(fails == 0 ? "APP NAME: \(count) ok, 0 FAIL" : "APP NAME: \(fails) FAIL of \(count)")
exit(fails == 0 ? 0 : 1)
