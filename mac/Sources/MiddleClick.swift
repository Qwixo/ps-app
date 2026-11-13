import Cocoa
import ServiceManagement

// Force Touch middle click (the developer, 31 Oct 2026: "I also want it to just be embedded in a PS app too").
// PS ships the helper "PS Middle Click.app" at PS.app/Contents/Library/LoginItems, built from
// ~/Projects/middle-click (the same code as the standalone PSMiddleClicker app, so fixes reach both).
// The helper runs as its own process: PS restarting never drops a click, and a mouse tap problem can
// never take PS down. PS only switches it on and off and shows how it is doing:
// - on: registers it as a login item (SMAppService) and opens it; off: unregisters it and asks the
//   running helper to quit through its own NSRunningApplication handle. Never by name.
// - Its state comes from ~/Library/Application Support/PS/middleclick.json, re-read on the helper's
//   distributed notification "com.cincee.ps.middleclick.changed".
// - Never both at once: while the standalone PSMiddleClicker app runs, the helper keeps its tap off.
// - The helper needs its own Accessibility switch ("PS Middle Click"); PS Settings says so and opens
//   the right page. PS never changes the setting itself.
// Off for everyone until switched on in PS Settings. A self test copy never starts the helper.
final class MiddleClick {
  static let shared = MiddleClick()
  static let helperID = "com.cincee.ps.middleclick"
  static let standaloneID = "com.cincee.psmiddleclicker"
  static let stateURL = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Application Support/PS/middleclick.json")

  var onChange: (() -> Void)?
  private var test = false
  private var service: SMAppService { .loginItem(identifier: MiddleClick.helperID) }
  var helperURL: URL { Bundle.main.bundleURL.appendingPathComponent("Contents/Library/LoginItems/PS Middle Click.app") }

  /// PS Settings > Force Touch middle click.
  private(set) var on: Bool {
    get { UserDefaults.standard.bool(forKey: "middleClick.on") }
    set { UserDefaults.standard.set(newValue, forKey: "middleClick.on") }
  }

  func start(testDir: String?) {
    test = testDir != nil
    DistributedNotificationCenter.default().addObserver(forName: Notification.Name("com.cincee.ps.middleclick.changed"), object: nil, queue: .main) { [weak self] _ in
      self?.onChange?()
    }
    guard !test else { return }
    if on { DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.ensureRunning() } }
  }

  /// From the page: {op: "set", on: Bool} or {op: "accessibility"}.
  func handle(_ msg: [String: Any]) {
    switch msg["op"] as? String {
    case "set":
      guard let v = msg["on"] as? Bool, v != on else { return }
      on = v
      psLog("PS middle click: switched \(v ? "on" : "off")")
      if !test { v ? switchOn() : switchOff() }
    case "accessibility":
      // Only opens the page; the user flips the switch for "PS Middle Click" themselves.
      if !test { NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!) }
    default: break
    }
  }

  private func running() -> [NSRunningApplication] {
    NSRunningApplication.runningApplications(withBundleIdentifier: MiddleClick.helperID).filter { !$0.isTerminated }
  }

  private func switchOn() {
    do { try service.register() } catch { psLog("PS middle click: login item not registered (\(error.localizedDescription)), PS opens it at each start instead") }
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.ensureRunning() }
  }

  private func switchOff() {
    try? service.unregister()
    for h in running() { h.terminate() }   // its own handle: a polite quit, it gives back any held click
  }

  /// On: the helper from THIS PS runs. After a PS update the old helper may still run from the old
  /// bundle, so it is asked to quit and the new one opens (a gap of about a second).
  private func ensureRunning() {
    guard on, !test, FileManager.default.fileExists(atPath: helperURL.path) else { return }
    let mine = helperURL.resolvingSymlinksInPath().path
    let old = running().filter { $0.bundleURL?.resolvingSymlinksInPath().path != mine }
    for h in old { h.terminate() }
    let delay = old.isEmpty ? 0 : 1.5
    DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
      guard self.on, self.running().isEmpty else { return }
      let cfg = NSWorkspace.OpenConfiguration()
      cfg.activates = false
      cfg.addsToRecentItems = false
      NSWorkspace.shared.openApplication(at: self.helperURL, configuration: cfg) { _, err in
        if let err { psLog("PS middle click: could not open the helper (\(err.localizedDescription))") }
      }
    }
  }

  /// For PS Settings. The helper's own report, checked against what is really running.
  func settingsJSON() -> [String: Any] {
    let raw = (try? Data(contentsOf: MiddleClick.stateURL)).flatMap { String(data: $0, encoding: .utf8) }
    let alive = !running().isEmpty
    let standalone = NSRunningApplication.runningApplications(withBundleIdentifier: MiddleClick.standaloneID).contains { !$0.isTerminated }
    var d = MiddleClick.status(on: on, stateJSON: raw, helperAlive: alive, standalone: standalone)
    d["present"] = FileManager.default.fileExists(atPath: helperURL.path)
    d["approval"] = !test && service.status == .requiresApproval
    return d
  }

  /// Pure, for the self test: what PS Settings shows. status is one of
  /// "off", "starting", "needsAccess", "standalone" (the PSMiddleClicker app is doing it), "on".
  static func status(on: Bool, stateJSON: String?, helperAlive: Bool, standalone: Bool) -> [String: Any] {
    let s = stateJSON.flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] } ?? [:]
    let reported = (s["running"] as? Bool) == true && helperAlive
    let trusted = (s["trusted"] as? Bool) == true
    let tap = (s["tap"] as? Bool) == true
    let yielding = (s["yielding"] as? Bool) == true || standalone
    let status: String
    if !on { status = standalone ? "standalone" : "off" }
    else if !reported { status = "starting" }
    else if yielding { status = "standalone" }
    else if !trusted { status = "needsAccess" }
    else if tap { status = "on" }
    else { status = "starting" }
    return ["on": on, "status": status, "trusted": trusted, "build": s["build"] as? String ?? ""]
  }

  /// Self test line (native only, no helper is started): the helper is inside this PS, signed as
  /// itself, in embedded mode; and the status logic maps each helper report right.
  static func selfCheck() -> String {
    var r: [(String, Bool)] = []
    let url = Bundle.main.bundleURL.appendingPathComponent("Contents/Library/LoginItems/PS Middle Click.app")
    let info = Bundle(url: url)?.infoDictionary ?? [:]
    r.append(("present", FileManager.default.fileExists(atPath: url.path)))
    r.append(("id", info["CFBundleIdentifier"] as? String == helperID))
    r.append(("embedded", info["PSMCEmbedded"] as? Bool == true))
    r.append(("noMenuIcon", info["LSUIElement"] as? Bool == true))
    var code: SecStaticCode?
    let signed = SecStaticCodeCreateWithPath(url as CFURL, [], &code) == errSecSuccess && code != nil
      && SecStaticCodeCheckValidity(code!, SecCSFlags(rawValue: kSecCSStrictValidate), nil) == errSecSuccess
    r.append(("signed", signed))
    func st(_ on: Bool, _ j: String?, _ alive: Bool, _ sa: Bool) -> String { status(on: on, stateJSON: j, helperAlive: alive, standalone: sa)["status"] as? String ?? "" }
    let good = #"{"running":true,"trusted":true,"tap":true,"yielding":false,"build":"1","pid":1}"#
    r.append(("statusOff", st(false, nil, false, false) == "off"))
    r.append(("statusStarting", st(true, nil, false, false) == "starting"))
    r.append(("statusStale", st(true, good, false, false) == "starting"))   // the file says running, the process is gone
    r.append(("statusOn", st(true, good, true, false) == "on"))
    r.append(("statusNeedsAccess", st(true, #"{"running":true,"trusted":false,"tap":false,"yielding":false}"#, true, false) == "needsAccess"))
    r.append(("statusStandalone", st(true, #"{"running":true,"trusted":true,"tap":false,"yielding":true}"#, true, true) == "standalone"))
    r.append(("statusOffStandalone", st(false, nil, false, true) == "standalone"))
    return "MIDDLECLICK CHECK: " + r.map { "\($0.0)=\($0.1 ? "ok" : "FAIL")" }.joined(separator: " ")
  }
}
