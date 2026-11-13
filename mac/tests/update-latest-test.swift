// Offline test for Sources/UpdateLatest.swift and the fresh read in UpdateChannel.sync (V1.51, the developer, 12 Nov 2026:
// "it updates you to 1.49 and then you have to update again to 1.5"). One update must install the NEWEST release:
// the card says V1.49, the server says V1.50, the download must be V1.50, and a package older than the newest note
// is refused. Notes are signed with a throwaway key made here; the "channel" is a file:// folder in a temp folder.
// Never online, never /Applications, never the developer's Application Support. Run: bash tests/update-latest-test.sh
import CryptoKit
import Foundation

var fails = 0
func check(_ name: String, _ ok: Bool, _ info: String = "") { print("\(name)=\(ok ? "ok" : "FAIL")\(info.isEmpty ? "" : " (\(info))")"); if !ok { fails += 1 } }

// A test copy's folders only (UpdatePaths reads these the first time it is touched).
let tmp = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("ps-update-latest-\(UUID().uuidString)", isDirectory: true)
let channel = tmp.appendingPathComponent("channel", isDirectory: true)
try! FileManager.default.createDirectory(at: channel.appendingPathComponent("updates"), withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: tmp) }
let key = Curve25519.Signing.PrivateKey()
setenv("PS_SELFTEST", tmp.path, 1)
setenv("PS_SELFTEST_CHANNEL", channel.absoluteString, 1)
setenv("PS_SELFTEST_UPDATE_PUBKEY", key.publicKey.rawRepresentation.base64EncodedString(), 1)
check("test-folders-only", UpdatePaths.test && UpdatePaths.mirror.path.hasPrefix(tmp.path) && UpdateChannel.base?.isFileURL == true)

func hex(_ d: Data) -> String { SHA256.hash(data: d).map { String(format: "%02x", $0) }.joined() }

/// A release on the fake channel: its files (made up bytes) and its signed note.
struct Release { let version: String; let app: Int?; let built: String; let appFile: String?; let webFile: String; let note: Data }
func release(_ version: String, app: Int?, built: String, keepApp: (Int, String, Int64, String)? = nil) -> Release {
  var payload: [String: Any] = ["format": 1, "kind": app == nil ? "web" : "app", "made": built, "name": "V" + version, "keyword": "Test"]
  var appFile: String?
  if let app {
    let bytes = Data("app \(app)".utf8), f = "updates/PS-app-\(app).zip"
    try! bytes.write(to: channel.appendingPathComponent(f))
    payload["app"] = ["build": app, "file": f, "size": bytes.count, "sha256": hex(bytes)]
    appFile = f
  } else if let k = keepApp {
    payload["app"] = ["build": k.0, "file": k.1, "size": k.2, "sha256": k.3]   // a web only release keeps the last app
  }
  let web = Data("web \(built)".utf8), wf = "updates/PS-web-\(built.filter(\.isNumber)).zip"
  try! web.write(to: channel.appendingPathComponent(wf))
  payload["web"] = ["src": "src" + built.filter(\.isNumber), "built": built, "file": wf, "size": web.count, "sha256": hex(web)]
  let signed = try! JSONSerialization.data(withJSONObject: payload)
  let note = try! JSONSerialization.data(withJSONObject: ["signed": signed.base64EncodedString(), "sig": try! key.signature(for: signed).base64EncodedString()])
  return Release(version: version, app: app, built: built, appFile: appFile, webFile: wf, note: note)
}
func publish(_ r: Release) { try! r.note.write(to: channel.appendingPathComponent("ps-update.json")) }
func open(_ r: Release) -> UpdateManifest { try! UpdateManifest.open(r.note, publicKey: UpdatePaths.publicKey) }
func mirrored() -> UpdateManifest? { (try? Data(contentsOf: UpdatePaths.mirror.appendingPathComponent("ps-update.json"))).flatMap { try? UpdateManifest.open($0, publicKey: UpdatePaths.publicKey) } }
func appBuild(_ p: UpdatePlan) -> Int? { if case .app(let a, _) = p { return a.build }; return nil }

// The real builds of 11 Nov 2026: V1.48 2611111911, V1.49 2611112045, V1.50 2611112106.
let r148 = release("1.48", app: 2611111911, built: "2026-11-11T19:07:43.408Z")
let r149 = release("1.49", app: 2611112045, built: "2026-11-11T20:40:39.144Z")
let r150 = release("1.50", app: 2611112106, built: "2026-11-11T21:02:27.179Z")
let m149 = open(r149), m150 = open(r150)
let mac148 = (build: 2611111911, web: (src: "src20261111190743408", built: "2026-11-11T19:07:43.408Z"))

// 1. The 20:55 look on a V1.48 Mac finds V1.49: that is the card.
publish(r149)
let dir1 = try! UpdateChannel.sync(myBuild: mac148.build, web: mac148.web)
let card = UpdatePlan.decide(mirrored()!, myBuild: mac148.build, web: mac148.web)
check("look-at-2055-offers-1.49", dir1 != nil && appBuild(card) == 2611112045, "\(card)")

// 2. V1.50 goes live at 21:10. The developer clicks Update now at 21:15: the fresh read sees V1.50 and the download is V1.50.
publish(r150)
let dir2 = try! UpdateChannel.sync(myBuild: mac148.build, web: mac148.web, fresh: true)
let freshNote = mirrored()!
let fresh = UpdatePlan.decide(freshNote, myBuild: mac148.build, web: mac148.web)
let chosen = UpdateLatest.choose(card: card, fresh: fresh)
check("fresh-read-sees-1.50", freshNote.version == "V1.50" && appBuild(fresh) == 2611112106, "\(freshNote.version ?? "-")")
check("click-installs-1.50-not-1.49", appBuild(chosen) == 2611112106, "\(chosen)")
check("card-number-moves-to-1.50", freshNote.version == "V1.50" && UpdateLatest.newer(chosen, than: card))
check("1.50-files-are-in-the-mirror", dir2 != nil && UpdateChannel.files(chosen).allSatisfy { UpdateChannel.size(of: dir2!.appendingPathComponent($0.0)) == $0.1 })
check("1.49-files-are-gone-from-the-mirror", !FileManager.default.fileExists(atPath: UpdatePaths.mirror.appendingPathComponent(r149.appFile!).path))

// 3. A stale download is refused: the V1.49 plan, and a V1.49 package, against the V1.50 note.
let stale = UpdateLatest.staleProblem(installing: card, newest: fresh)
check("stale-plan-refused", stale != nil && UpdateLatest.isStale(stale ?? ""), stale ?? "")
check("newest-plan-passes", UpdateLatest.staleProblem(installing: fresh, newest: fresh) == nil)
let oldPkg = UpdateLatest.packageProblem(appBuild: 2611112045, appVersion: "1.49", webVersion: "1.49", newest: m150, plan: fresh)
check("1.49-package-refused-against-1.50-note", oldPkg != nil && UpdateLatest.isStale(oldPkg ?? ""), oldPkg ?? "")
let oldVer = UpdateLatest.packageProblem(appBuild: 2611112106, appVersion: "1.49", webVersion: "1.49", newest: m150, plan: fresh)
check("package-naming-1.49-refused", oldVer != nil && UpdateLatest.isStale(oldVer ?? ""), oldVer ?? "")
check("1.50-package-passes", UpdateLatest.packageProblem(appBuild: 2611112106, appVersion: "1.50", webVersion: "1.50", newest: m150, plan: fresh) == nil)
check("package-without-version-names-passes", UpdateLatest.packageProblem(appBuild: 2611112106, appVersion: nil, webVersion: nil, newest: m150, plan: fresh) == nil)
check("1.49-package-fine-against-its-own-note", UpdateLatest.packageProblem(appBuild: 2611112045, appVersion: "1.49", webVersion: "1.49", newest: m149, plan: card) == nil)

// 4. Offline at the click: the card's update (already checked here) goes in. The server saying nothing: nothing.
check("offline-falls-back-to-card", UpdateLatest.choose(card: card, fresh: nil) == card)
check("server-says-nothing-installs-nothing", UpdateLatest.choose(card: card, fresh: UpdatePlan.none) == .none)
check("nothing-is-never-stale", UpdateLatest.staleProblem(installing: .none, newest: fresh) == nil)

// 5. A web only release after an app release: V1.51 web only, the note keeps V1.50's app.
let a150 = m150.app!
let r151 = release("1.51", app: nil, built: "2026-11-12T10:00:00.000Z", keepApp: (a150.build, a150.file, a150.size, a150.sha256))
let m151 = open(r151)
let mac150web = (src: m150.web.src, built: m150.web.built)
let p151on150 = UpdatePlan.decide(m151, myBuild: a150.build, web: mac150web)
let p150on150 = UpdatePlan.decide(m150, myBuild: a150.build, web: (src: "old", built: "2026-11-11T20:00:00.000Z"))
check("web-only-1.51-on-a-1.50-mac", { if case .web(let w) = p151on150 { return w.built == m151.web.built }; return false }(), "\(p151on150)")
check("older-web-plan-is-stale", UpdateLatest.staleProblem(installing: p150on150, newest: p151on150) != nil)
let p151on148 = UpdatePlan.decide(m151, myBuild: mac148.build, web: mac148.web)
check("1.48-mac-gets-1.50-app-with-1.51-web", appBuild(p151on148) == a150.build && { if case .app(_, let w) = p151on148 { return w.built == m151.web.built }; return false }())
check("app-1.50-plus-web-1.51-package-passes", UpdateLatest.packageProblem(appBuild: a150.build, appVersion: "1.50", webVersion: "1.51", newest: m151, plan: p151on148) == nil)
check("app-1.50-plus-web-1.50-package-refused", UpdateLatest.packageProblem(appBuild: a150.build, appVersion: "1.50", webVersion: "1.50", newest: m151, plan: p151on148) != nil)

// 6. A newer app always outranks a web only update from an older note, and never backwards.
check("app-beats-web", UpdateLatest.newer(fresh, than: .web(m149.web)))
check("never-backwards", !UpdateLatest.newer(card, than: fresh) && UpdateLatest.newer(fresh, than: card))
check("1.48-note-offers-nothing-to-a-1.48-mac", UpdatePlan.decide(open(r148), myBuild: mac148.build, web: mac148.web) == .none)

// 7. The plain sync still answers from the file channel (no ETag for file:// folders), so a normal look sees 1.50 too.
let dir3 = try! UpdateChannel.sync(myBuild: mac148.build, web: mac148.web)
check("normal-look-also-sees-1.50", dir3 != nil && mirrored()?.version == "V1.50")

print(fails == 0 ? "ALL OK" : "\(fails) FAILED")
exit(fails == 0 ? 0 : 1)
