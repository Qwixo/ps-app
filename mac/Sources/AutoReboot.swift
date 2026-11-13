// Auto reboot and restart, PS's half. The work is done by rebootd (Helper/rebootd.swift), a root
// LaunchDaemon PS registers with SMAppService. The developer approves it once in System Settings > General >
// Login Items & Extensions. After that it runs on its own: the timer keeps going when PS is quit.
//
// PS only: registers the helper when the developer clicks Set up, tells it the developer's settings (Off, Watch only or
// Active, and the hours), reads its status for the Tab list, GOS and the Machine pane, and asks it to
// restart or shut down when the developer (or a signed command from his other Mac or phone) says so.
// The timer itself (GrapheneOS style: counts only while locked or asleep, every unlock resets it,
// never restarts an unlocked Mac) lives in Helper/RebootCore.swift.
// V1.28: Active really restarts (only ever a locked Mac, also before the first unlock). PS passes on
// Postpone from the developer's other Mac or phone (only ever later) and his settings from his main Mac.
//
// Test copies never register, connect to or ask the real helper anything (IS_TEST_COPY).
import Cocoa
import ServiceManagement

final class AutoReboot {
  static let shared = AutoReboot()
  /// The lengths offered, as GrapheneOS offers them (the developer, 2 Nov 2026): 10 minutes to 72 hours.
  static let minuteChoices = [10, 30, 60, 120, 240, 480, 720, 1080, 1440, 2160, 2880, 4320]
  static let minuteRange = 10...(72 * 60)
  let defaults = UserDefaults.standard
  var onChange: (() -> Void)?
  /// More listeners (Second Computer's stat body); each is called with onChange, on the main thread.
  private var observers: [() -> Void] = []
  func observe(_ f: @escaping () -> Void) { observers.append(f) }
  private func changed() { onChange?(); observers.forEach { $0() } }
  /// Made on first use. A test copy never makes it, so it never registers, removes or even reads the helper.
  private(set) var serviceMade = false
  private lazy var service: SMAppService = { self.serviceMade = true; return SMAppService.daemon(plistName: RebootdIDs.plist) }()
  private var conn: NSXPCConnection?
  private var timer: Timer?
  /// The helper's last status (see RebootdXPC.status), empty until it answered.
  private(set) var helper: [String: Any] = [:]
  private(set) var lastError: String?
  /// Called just before PS opens Login Items in System Settings (Set up, Open it again): main.swift puts
  /// the Tab list away first, or the page opened underneath it.
  var beforeSystemSettings: (() -> Void)?

  /// 18 hours on every Mac, GrapheneOS's default (the developer, 2 Nov 2026; before, 12 on the M4).
  static let defaultMinutes = 18 * 60

  /// The developer's choice: "off", "watch" (log only, the default) or "active". A test copy keeps its own in
  /// memory and never touches the developer's real settings.
  private var testMode = "watch", testMinutes = AutoReboot.defaultMinutes
  var mode: String {
    get { if IS_TEST_COPY { return testMode }; let m = defaults.string(forKey: "reboot.mode") ?? "watch"; return ["off", "watch", "active"].contains(m) ? m : "watch" }
    set {
      guard ["off", "watch", "active"].contains(newValue) else { return }
      if IS_TEST_COPY { testMode = newValue; changed(); return }
      defaults.set(newValue, forKey: "reboot.mode"); push()
    }
  }
  /// The timer length in minutes (10 to 4320). V1.23 to V1.27 kept whole hours in reboot.hours: still honoured.
  var minutes: Int {
    get {
      if IS_TEST_COPY { return testMinutes }
      let m = defaults.integer(forKey: "reboot.minutes")
      if AutoReboot.minuteRange.contains(m) { return m }
      let h = defaults.integer(forKey: "reboot.hours")
      return (1...72).contains(h) ? h * 60 : AutoReboot.defaultMinutes
    }
    set {
      guard AutoReboot.minuteRange.contains(newValue) else { return }
      if IS_TEST_COPY { testMinutes = newValue; changed(); return }
      defaults.set(newValue, forKey: "reboot.minutes"); push()
    }
  }

  /// "on", "approve" (the developer still has to switch it on in System Settings), "off" (not set up),
  /// "missing" (this build has no helper) or "test" (a self test copy, unless its card check picked one).
  var helperState: String {
    if IS_TEST_COPY { return testHelper }
    if let svcState { return svcState }
    let s = AutoReboot.state(service.status, bundled: AutoReboot.bundled)   // once, before the first read off the main thread
    svcState = s
    return s
  }
  /// What macOS said last (read on statusQ, kept on the main thread): nil until the first read.
  private var svcState: String?
  private let statusQ = DispatchQueue(label: "ps.reboot.status", qos: .utility)

  // MARK: after an update (V1.45, RebootHelperCore.swift has the rules)

  /// This build's number: the helper "ran in this build" or "in an older one".
  private static let build = (Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String) ?? ""
  private var memory: HelperMemory {
    get {
      if IS_TEST_COPY { return testMemory }
      let stored = defaults.object(forKey: "reboot.helperWasOn") == nil ? nil
        : HelperMemory(wasOn: defaults.bool(forKey: "reboot.helperWasOn"), onBuild: defaults.string(forKey: "reboot.helperOnBuild") ?? "")
      let set = defaults.object(forKey: "reboot.mode") != nil || defaults.object(forKey: "reboot.minutes") != nil || defaults.object(forKey: "reboot.hours") != nil
      return RebootHelperCore.migrate(stored: stored, hasSettings: set)
    }
    set {
      if IS_TEST_COPY { testMemory = newValue; return }
      defaults.set(newValue.wasOn, forKey: "reboot.helperWasOn"); defaults.set(newValue.onBuild, forKey: "reboot.helperOnBuild")
    }
  }
  private var testMemory = HelperMemory(wasOn: false, onBuild: "")
  /// Why the helper is not running although it ran here before (nil otherwise): the panel says it, the card offers the fix.
  var offBy: HelperOffBy? { RebootHelperCore.offBy(state: helperState, memory: memory, build: AutoReboot.build) }
  private var fastTimer: Timer?
  /// V1.49 (HelperAlertCore.swift): asks in a row the helper did not answer while macOS says on. The pop up calls it
  /// "not answering" at HelperAlertCore.failLimit; PS asks again HelperAlertCore.retryAfter seconds after each miss.
  private(set) var failures = 0
  private var retryWork: DispatchWorkItem?
  private var askSeq = 0
  /// V1.49: the helper inside this app passes its own signature check (RebootdIDs.helperRequirement); nil until
  /// checked or when this build has none. Only ever names the reason of a helper that is not answering.
  private(set) var pinOK: Bool?

  /// Called on the main thread with every fresh answer from macOS.
  private func took(_ state: String) {
    let before = svcState
    svcState = state
    // V1.54 (HelperCheckCore.errorAfter): a "not switched on" miss from while it was off never outlives the switch on.
    lastError = HelperCheckCore.errorAfter(state: state, error: lastError)
    if before != state { psLog("reboot: helper \(before ?? "unknown") -> \(state)\(offBy.map { " (switched off by \($0 == .update ? "macOS after the update" : "System Settings"))" } ?? "")") }
    // V1.49: the "switched off after the update" card is gone; the restart helper pop up (HelperAlert.swift) says it,
    // with every other way the helper can be off, so there is only ever one pop up.
    if state != "on" { failures = 0; retryWork?.cancel(); retryWork = nil }
    // V1.51: a repair waiting for the fresh helper's answer ends when macOS no longer lists it as on.
    if repairPhase == .probing && state != "on" { finishRepair(HelperRepairCore.outcome(state: state, answered: false, registerError: false)) }
    if state == "on" && before != nil && before != "on" && repairPhase == .idle { repairResult = nil }
    // Quick looks only while macOS waits for the developer's yes, so it comes back within seconds of him switching it on.
    let fast = RebootHelperCore.pollSeconds(state: state) < 60
    if fast && fastTimer == nil {
      fastTimer = Timer.scheduledTimer(withTimeInterval: RebootHelperCore.pollSeconds(state: state), repeats: true) { [weak self] _ in self?.readState(nil) }
    } else if !fast { fastTimer?.invalidate(); fastTimer = nil }
    if RebootHelperCore.cameBack(previous: before, now: state) {
      conn?.invalidate(); conn = nil   // a connection made while it was off can be dead
      psLog("reboot: the helper is on again, sending the saved settings")
      push()
    }
    if before != state { changed() }
  }

  /// Asks macOS off the main thread, then `took` on it.
  private func readState(_ then: (() -> Void)?) {
    guard !IS_TEST_COPY else { return }
    let svc = service
    statusQ.async {
      let s = AutoReboot.state(svc.status, bundled: AutoReboot.bundled)
      DispatchQueue.main.async { self.took(s); then?() }
    }
  }

  /// The card's button (main.swift sends "rh:" here): the same as Set up in Security, which is how the helper came back
  /// on 2 Nov 2026: register again (macOS answers "already registered" and refreshes its record of this build), then
  /// put the Tab list away and open Login Items & Extensions.
  func cardAction(_ id: String, _ action: String) {
    guard id == RebootHelperCore.cardId, action == "open" else { return }
    Toast.shared.hideCard(RebootHelperCore.cardId)
    psLog("reboot: card, opening Login Items & Extensions")
    setUp { e in if let e { psLog("reboot: card: \(e)") } }
  }

  /// macOS answers notFound for a helper that IS in this build but was never registered (seen on the M1 and with a
  /// probe app, 2 Nov 2026), so that reads as "off" and the card offers Set up; "missing" only when the files are not
  /// in this build at all.
  static func state(_ s: SMAppService.Status, bundled: Bool) -> String {
    switch s {
    case .enabled: return "on"
    case .requiresApproval: return "approve"
    case .notRegistered: return "off"
    case .notFound: return bundled ? "off" : "missing"
    @unknown default: return "off"
    }
  }
  /// The daemon plist and the helper are in this app (where SMAppService looks for them).
  static let bundled: Bool = {
    let c = Bundle.main.bundleURL.appendingPathComponent("Contents")
    return FileManager.default.fileExists(atPath: c.appendingPathComponent("Library/LaunchDaemons/\(RebootdIDs.plist)").path)
      && FileManager.default.isExecutableFile(atPath: c.appendingPathComponent("Resources/rebootd").path)
  }()

  // MARK: FileVault (read only, `fdesetup status` needs no admin rights)

  private(set) var fileVault = "unknown"
  func refreshFileVault() {
    refreshPasswordDelayIfStarted()
    DispatchQueue.global(qos: .utility).async { [weak self] in
      let v = AutoReboot.readFileVault()
      DispatchQueue.main.async { if let self, v != self.fileVault { self.fileVault = v; self.changed() } }
    }
  }
  private func refreshPasswordDelayIfStarted() { if passwordImmediately != nil { refreshPasswordDelay() } }
  private static func readFileVault() -> String {
    let p = Process(), out = Pipe()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/fdesetup"); p.arguments = ["status"]; p.standardOutput = out; p.standardError = FileHandle.nullDevice
    guard (try? p.run()) != nil else { return "unknown" }
    let text = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    p.waitUntilExit()
    return text.contains("FileVault is On") ? "on" : text.contains("FileVault is Off") ? "off" : "unknown"
  }

  static func hwModel() -> String {
    var size = 0
    guard sysctlbyname("hw.model", nil, &size, nil, 0) == 0, size > 0 else { return "" }
    var buf = [CChar](repeating: 0, count: size)
    guard sysctlbyname("hw.model", &buf, &size, nil, 0) == 0 else { return "" }
    return String(cString: buf)
  }

  // MARK: start, set up

  func start() {
    refreshFileVault(); refreshPasswordDelay()
    guard !IS_TEST_COPY else { return }
    checkPin()
    refresh()
    // A local XPC call a minute: no network, no disk on PS's side.
    timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in self?.refresh() }
    NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in self?.refresh() }
    for n in ["com.apple.screenIsLocked", "com.apple.screenIsUnlocked"] {
      DistributedNotificationCenter.default().addObserver(forName: .init(n), object: nil, queue: .main) { [weak self] _ in
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self?.refresh() }
      }
    }
  }

  /// The developer clicked Set up: register the helper. macOS then lists it in Login Items & Extensions, where
  /// The developer switches it on himself; PS opens that page for him. Off the main thread (register can wait).
  func setUp(done: @escaping (String?) -> Void) {
    if IS_TEST_COPY {   // the stand-in: what macOS would do, without macOS (never registers, never opens System Settings)
      testDid.append("setup")
      if testHelper == "off" { testHelper = "approve" }
      beforeSystemSettings?()
      changed()
      return done(nil)
    }
    // The first, never shipped helper (admin password install, same label) must not be there.
    if FileManager.default.fileExists(atPath: "/Library/LaunchDaemons/com.cincee.ps.rebootd.plist") {
      return done("An old auto-reboot helper is installed. Ask Claude to remove it first (it needs your admin password).")
    }
    // V1.51 (HelperRepairCore.cleanSetUp): it ran here before and macOS now waits for approval, so launchd may still
    // hold a job it cannot start (the V1.48 helper change). Unregister first: the switch on then starts a fresh job.
    let clean = HelperRepairCore.cleanSetUp(wasOn: memory.wasOn, state: helperState)
    if clean { psLog("reboot: set up for a helper that ran here before: unregistering first, so macOS starts a fresh one when it is switched on") }
    let svc = service
    let register = {
      var err: String?
      do { try svc.register() } catch {
        let ns = error as NSError
        if ns.code != kSMErrorAlreadyRegistered && svc.status != .requiresApproval { err = "macOS did not register the helper: \(ns.localizedDescription) (\(ns.code))" }
      }
      let now = AutoReboot.state(svc.status, bundled: AutoReboot.bundled)
      DispatchQueue.main.async {
        psLog("reboot: set up asked, helper \(now)\(err.map { ", \($0)" } ?? "")")
        if now == "approve" { self.beforeSystemSettings?(); SMAppService.openSystemSettingsLoginItems() }
        self.took(now)
        self.refresh(); self.changed()
        done(err)
      }
    }
    DispatchQueue.global(qos: .userInitiated).async {
      guard clean else { return register() }
      svc.unregister { e in
        if let e { DispatchQueue.main.async { psLog("reboot: set up: unregister said \(e.localizedDescription) (\((e as NSError).code)), registering anyway") } }
        DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 1) { register() }
      }
    }
  }

  // MARK: repair (V1.51; HelperRepairCore.swift has the cause, read from macOS's own log, and the rules)

  private enum RepairPhase { case idle, working, probing }
  private var repairPhase = RepairPhase.idle
  /// A repair is under way (the pop up waits for it, or shows its Try again as busy).
  var repairing: Bool { repairPhase != .idle }
  /// What the last repair in this run came to (nil: none yet, or the helper came back on since).
  private(set) var repairResult: HelperRepairResult?
  /// Repairs in this run (by itself and Try again): Try again waits longer after each.
  private(set) var repairs = 0
  private var repairEndedAt: Date?
  private var repairTriedThisLaunch = false
  private var repairWatch: DispatchWorkItem?
  /// The build that last repaired by itself: once per build, kept across launches.
  private var lastAutoRepairBuild: String {
    get { IS_TEST_COPY ? testAutoRepairBuild : (defaults.string(forKey: "reboot.repairAutoBuild") ?? "") }
    set { if IS_TEST_COPY { testAutoRepairBuild = newValue } else { defaults.set(newValue, forKey: "reboot.repairAutoBuild") } }
  }
  private var testAutoRepairBuild = ""
  /// Seconds before Try again works (0 now, infinity while a repair runs).
  var repairWaitLeft: TimeInterval {
    HelperRepairCore.waitLeft(running: repairing, tries: repairs, lastEnded: repairEndedAt?.timeIntervalSince1970, now: Date().timeIntervalSince1970)
  }

  /// After the last miss in a row: repair by itself when the rules allow (once per build, never twice in a run).
  private func autoRepairIfDue() {
    let f = HelperRepairFacts(state: helperState, failures: failures, safeMode: (helper["safeMode"] as? Bool) == true, pinOK: pinOK,
                              testCopy: IS_TEST_COPY, running: repairing, triedThisLaunch: repairTriedThisLaunch,
                              lastAutoBuild: lastAutoRepairBuild, build: AutoReboot.build)
    if HelperRepairCore.shouldAuto(f) { repair(manual: false) }
  }

  /// The same as switching PS app off and on under Allow in the Background: unregister (launchd drops the job it
  /// cannot start) then register (a fresh job). Off the main thread. False when it did not start (one is running, or
  /// Try again still has to wait). A test copy never touches macOS.
  @discardableResult
  func repair(manual: Bool) -> Bool {
    guard !repairing else { return false }
    let wait = repairWaitLeft
    if manual && wait > 0 { psLog("reboot: repair: Try again waits \(Int(wait.rounded(.up))) s more"); return false }
    repairTriedThisLaunch = true; repairs += 1; repairResult = nil
    if !manual { lastAutoRepairBuild = AutoReboot.build }
    repairPhase = .working
    psLog("reboot: repair \(manual ? "(Try again)" : "(by itself, once for build \(AutoReboot.build))"): macOS lists the helper as on but it did not answer \(failures) times in a row; unregistering and registering it again, the same as switching it off and on in Allow in the Background")
    retryWork?.cancel(); retryWork = nil
    conn?.invalidate(); conn = nil; helper = [:]
    let w = DispatchWorkItem { [weak self] in
      guard let self, self.repairPhase == .working else { return }
      psLog("reboot: repair: macOS did not finish unregistering and registering in 90 s")
      self.finishRepair(.failed)
    }
    repairWatch = w
    DispatchQueue.main.asyncAfter(deadline: .now() + 90, execute: w)
    changed()
    if IS_TEST_COPY { testDid.append("repair"); finishRepair(.fixed); return true }
    let svc = service
    DispatchQueue.global(qos: .userInitiated).async {
      svc.unregister { e in
        // launchd has dropped the job (and stopped a helper that still ran) when this comes back.
        let unregErr = e.map { "\($0.localizedDescription) (\(($0 as NSError).code))" }
        DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 1) {
          var regErr: String?
          do { try svc.register() } catch {
            let ns = error as NSError
            if ns.code != kSMErrorAlreadyRegistered && svc.status != .requiresApproval { regErr = "\(ns.localizedDescription) (\(ns.code))" }
          }
          let now = AutoReboot.state(svc.status, bundled: AutoReboot.bundled)
          DispatchQueue.main.async { self.registeredAgain(state: now, unregisterError: unregErr, registerError: regErr) }
        }
      }
    }
    return true
  }

  private func registeredAgain(state: String, unregisterError: String?, registerError: String?) {
    guard repairPhase == .working else { return }   // the 90 s watch already ended it
    if let unregisterError { psLog("reboot: repair: unregister said \(unregisterError)") }
    psLog("reboot: repair: registered again, macOS says \(state)\(registerError.map { ", register said \($0)" } ?? "")")
    failures = 0
    if state == "on" {
      // The fresh job starts the helper at once. Ask in 2 s; three misses in a row (about 30 s) mean it did not help.
      repairPhase = .probing
      took(state)
      DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.refresh() }
      changed()
    } else {
      finishRepair(HelperRepairCore.outcome(state: state, answered: false, registerError: registerError != nil))
      took(state)
    }
  }

  private func finishRepair(_ r: HelperRepairResult) {
    guard repairPhase != .idle else { return }
    repairPhase = .idle; repairResult = r; repairEndedAt = Date()
    repairWatch?.cancel(); repairWatch = nil
    switch r {
    case .fixed: psLog("reboot: repair worked: the helper answers again")
    case .needsApproval: psLog("reboot: repair: macOS wants the owner's OK again under Allow in the Background; the pop up asks")
    case .stillDead: psLog("reboot: repair did not help: macOS lists the helper as on and it still does not answer; the pop up asks to switch it off and on")
    case .failed: psLog("reboot: repair failed: macOS did not register the helper again; the pop up asks")
    }
    changed()
  }

  /// V1.49: the restart helper pop up's "Open System Settings" for a helper that is on but not answering (registering
  /// again would change nothing): put the Tab list away, then open Login Items & Extensions. Never in a test copy.
  func openLoginItems() {
    if IS_TEST_COPY { testDid.append("settings"); return }
    psLog("reboot: opening Login Items & Extensions (the helper is not answering)")
    beforeSystemSettings?()
    SMAppService.openSystemSettingsLoginItems()
  }

  /// V1.49: whether the helper inside this app passes RebootdIDs.helperRequirement (the same check every XPC
  /// connection makes). Off the main thread, once; read only, nothing is registered or asked.
  private func checkPin() {
    guard !IS_TEST_COPY, AutoReboot.bundled else { return }
    let url = Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/rebootd")
    DispatchQueue.global(qos: .utility).async {
      var code: SecStaticCode?, req: SecRequirement?
      let ok = SecStaticCodeCreateWithPath(url as CFURL, [], &code) == errSecSuccess
        && SecRequirementCreateWithString(RebootdIDs.helperRequirement as CFString, [], &req) == errSecSuccess
        && code.map { c in req.map { SecStaticCodeCheckValidity(c, SecCSFlags(rawValue: kSecCSCheckAllArchitectures), $0) == errSecSuccess } ?? false } ?? false
      DispatchQueue.main.async {
        if !ok { psLog("reboot: the helper inside this app does not pass its signature check") }
        if self.pinOK != ok { self.pinOK = ok; self.changed() }
      }
    }
  }

  /// The developer removes the helper (PS > Settings). The timer is switched off first (the helper drops its
  /// wakes), then macOS removes it. Nothing restarts.
  func remove(done: @escaping (String?) -> Void) {
    if IS_TEST_COPY { testDid.append("remove"); testHelper = "off"; testMemory = HelperMemory(wasOn: false, onBuild: ""); helper = [:]; changed(); return done(nil) }
    var finished = false
    let go = { [weak self] in
      guard let self, !finished else { return }
      finished = true
      self.unregister(done: done)
    }
    if let data = try? JSONSerialization.data(withJSONObject: ["mode": "off", "minutes": minutes, "testOnce": false]),
       let p = proxy({ _ in DispatchQueue.main.async { go() } }) {
      p.setConfig(data) { _ in DispatchQueue.main.async { go() } }
      DispatchQueue.main.asyncAfter(deadline: .now() + 3) { go() }
    } else { go() }
  }

  private func unregister(done: @escaping (String?) -> Void) {
    service.unregister { error in
      DispatchQueue.main.async {
        self.conn?.invalidate(); self.conn = nil; self.helper = [:]
        self.memory = HelperMemory(wasOn: false, onBuild: "")   // removed on purpose: no "switched off" card
        self.svcState = nil
        psLog("reboot: helper removed\(error.map { " (\($0.localizedDescription))" } ?? "")")
        self.changed(); done(error?.localizedDescription)
      }
    }
  }

  // MARK: talking to rebootd

  private func proxy(_ fail: @escaping (String) -> Void) -> RebootdXPC? {
    guard !IS_TEST_COPY, helperState == "on" else { fail(HelperCheckCore.notOnError); return nil }
    if conn == nil {
      let c = NSXPCConnection(machServiceName: RebootdIDs.mach, options: .privileged)
      c.remoteObjectInterface = NSXPCInterface(with: RebootdXPC.self)
      c.setCodeSigningRequirement(RebootdIDs.helperRequirement)   // only the genuine helper
      c.invalidationHandler = { [weak self] in DispatchQueue.main.async { self?.conn = nil } }
      c.interruptionHandler = { [weak self] in DispatchQueue.main.async { self?.conn = nil } }
      c.resume()
      conn = c
    }
    return conn?.remoteObjectProxyWithErrorHandler { e in DispatchQueue.main.async { fail(e.localizedDescription) } } as? RebootdXPC
  }

  private func parse(_ d: Data) -> [String: Any] { (try? JSONSerialization.jsonObject(with: d) as? [String: Any]) ?? [:] }

  /// Reads the helper's status, then makes sure it has the developer's settings (rebootd keeps its own copy so
  /// it works with PS quit; the same settings again change nothing there).
  func refresh() {
    guard !IS_TEST_COPY else { return }   // a test copy has no helper to ask
    readState { [weak self] in self?.ask() }   // macOS first (off the main thread), then the helper itself
  }

  private func ask() {
    // V1.49: each ask ends once, as an answer or as one miss (an error, or no reply in 10 s: a helper that never
    // replies is "not answering" too).
    askSeq += 1
    let seq = askSeq
    let miss: (String) -> Void = { [weak self] e in
      guard let self, seq == self.askSeq else { return }
      self.askSeq += 1
      self.failed(e)
    }
    guard let p = proxy({ e in miss(e) }) else { if !helper.isEmpty { helper = [:]; changed() }; return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 10) { miss("no answer in 10 s") }
    p.status { [weak self] d in
      let s = self?.parse(d) ?? [:]
      DispatchQueue.main.async {
        guard let self else { return }
        if seq == self.askSeq { self.askSeq += 1 }   // answered: the 10 s check above lets it be
        self.heard(s)
        let changed = (s as NSDictionary) != (self.helper as NSDictionary)
        self.helper = s
        if (s["safeMode"] as? Bool) == true { if changed { self.changed() }; return }   // the helper does nothing in Safe Mode
        if s["mode"] as? String != self.mode || (s["minutes"] as? Int) != self.minutes || (s["configError"] as? Bool) == true { self.push() }
        else if changed { self.changed() }
      }
    }
  }

  /// The helper answered (a status, a settings reply or the fresh check): no miss holds any more. Was the body of ask's
  /// answer; V1.54 also runs it for push and the fresh check, so an old miss never outlives a real answer.
  private func heard(_ s: [String: Any]) {
    lastError = nil
    if !s.isEmpty && failures > 0 {
      psLog("reboot: the helper answers again after \(failures) miss\(failures == 1 ? "" : "es")")
      failures = 0; retryWork?.cancel(); retryWork = nil; changed()
    }
    if !s.isEmpty && repairPhase == .probing { finishRepair(.fixed) }   // V1.51: the fresh helper answers
    if !s.isEmpty {   // it really runs here, in this build: remember that for the next update
      let m = RebootHelperCore.remember(state: helperState, answered: true, memory: memory, build: AutoReboot.build)
      if m != memory { memory = m }
    }
  }

  // MARK: the fresh check before Sentry mode engages (V1.54, HelperCheckCore.swift has the rules)

  /// The last check the page asked for that has finished (status()["checked"]); the page waits for its own id.
  private(set) var checkedId: String?
  private var checkWaiting: [() -> Void] = []
  private var checkStarted: Date?
  /// What the last fresh check found (a HelperCheckCore.gap code; nil: the helper is fine). Sleep mode's button reads it.
  private(set) var lastGap: String?
  /// The page's AI button: check, then say which check finished (the settings the page gets carry the id).
  func checkFromPage(_ id: String) {
    let clean = String(id.prefix(40))
    check { [weak self] in self?.checkedId = clean; self?.changed() }
  }
  /// Asks macOS and the helper itself, now, and tries again for a few seconds before saying off or not answering
  /// (HelperCheckCore.next). Waits only with asyncAfter: macOS is read on statusQ, the helper over XPC; nothing blocks the
  /// main thread. Misses here never count towards the repair (only the regular asks do). A check already running takes
  /// the new caller along. A test copy answers at once with what it has.
  func check(done: @escaping () -> Void) {
    checkWaiting.append(done)
    guard checkStarted == nil else { return }
    if IS_TEST_COPY { finishCheck(state: helperState, answered: !helper.isEmpty); return }
    checkStarted = Date()
    psLog("reboot: Sentry mode check: asking macOS and the helper now")
    checkTry()
  }
  private func checkTry() {
    let svc = service
    statusQ.async {
      let s = AutoReboot.state(svc.status, bundled: AutoReboot.bundled)
      DispatchQueue.main.async {
        self.took(s)
        guard s == "on" else { return self.checkNext(state: s, answered: false, miss: nil) }
        self.probe { miss in self.checkNext(state: s, answered: miss == nil, miss: miss) }
      }
    }
  }
  /// One status ask with its own short limit (HelperCheckCore.answerWait). nil: it answered.
  private func probe(_ then: @escaping (String?) -> Void) {
    var over = false
    let end: (String?) -> Void = { m in if !over { over = true; then(m) } }
    guard let p = proxy({ e in end(e) }) else { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + HelperCheckCore.answerWait) { end("no answer in \(HelperCheckCore.answerWait) s") }
    p.status { [weak self] d in
      let s = self?.parse(d) ?? [:]
      DispatchQueue.main.async {
        guard let self, !over else { return }
        if s.isEmpty { return end("an empty answer") }
        self.heard(s)
        let changed = (s as NSDictionary) != (self.helper as NSDictionary)
        self.helper = s
        if changed { self.changed() }
        end(nil)
      }
    }
  }
  private func checkNext(state: String, answered: Bool, miss: String?) {
    let elapsed = Date().timeIntervalSince(checkStarted ?? Date())
    if HelperCheckCore.next(state: state, answered: answered, ranBefore: memory.wasOn, elapsed: elapsed) == .again {
      DispatchQueue.main.asyncAfter(deadline: .now() + HelperCheckCore.every) { [weak self] in self?.checkTry() }
      return
    }
    if state == "on" && !answered { lastError = miss ?? "no answer"; helper = [:] }
    finishCheck(state: state, answered: answered)
  }
  private func finishCheck(state: String, answered: Bool) {
    lastGap = HelperCheckCore.gap(state: state, answered: answered, old: helperOld)
    if let t = checkStarted { psLog("reboot: Sentry mode check: \(lastGap ?? "the helper is on and answering") after \(String(format: "%.1f", Date().timeIntervalSince(t))) s") }
    checkStarted = nil
    let w = checkWaiting; checkWaiting = []
    changed()
    w.forEach { $0() }
  }

  /// The helper did not answer: never keep showing its last status as if it were live.
  private func failed(_ e: String) {
    if lastError != e { psLog("reboot: helper not reachable: \(e)") }
    lastError = e; helper = [:]
    // V1.49: count the misses while macOS says on, and ask again soon, so a dead helper is told within about 30 s.
    // V1.51: misses while the repair unregisters and registers are its own doing, not the helper's.
    if repairPhase == .working { changed(); return }
    if helperState == "on" {
      failures += 1
      if failures == HelperAlertCore.failLimit {
        psLog("reboot: the helper did not answer \(failures) times in a row")
        // V1.51: the fresh helper after a repair did not answer either; else repair by itself when the rules allow.
        if repairPhase == .probing { finishRepair(.stillDead) } else { autoRepairIfDue() }
      }
      if failures < HelperAlertCore.failLimit && retryWork == nil {
        let w = DispatchWorkItem { [weak self] in self?.retryWork = nil; self?.refresh() }
        retryWork = w
        DispatchQueue.main.asyncAfter(deadline: .now() + HelperAlertCore.retryAfter, execute: w)
      }
    }
    changed()
  }

  /// Sends the developer's settings. A pending 5 minute test in the helper is kept unless `testOnce` says otherwise.
  func push(testOnce: Bool? = nil) {
    let t = testOnce ?? ((helper["testOnce"] as? Bool) ?? false)
    let cfg: [String: Any] = ["mode": mode, "minutes": minutes, "testOnce": t]
    guard let data = try? JSONSerialization.data(withJSONObject: cfg), let p = proxy({ [weak self] e in self?.failed(e) }) else { changed(); return }
    p.setConfig(data) { [weak self] d in
      let s = self?.parse(d) ?? [:]
      DispatchQueue.main.async {
        guard let self else { return }
        self.heard(s)   // V1.54: it answered, so an old miss no longer holds (it did, until the next once a minute ask)
        self.helper = s
        let took = s["mode"] as? String == self.mode && (s["minutes"] as? Int) == self.minutes
        psLog("reboot: settings \(took ? "sent" : "refused by the helper"): \(self.mode) \(self.minutes) min\(t ? " (next countdown 5 min test)" : "")")
        self.changed()
      }
    }
  }

  /// What the running helper understands (RebootdIDs.proto): 1 for a helper from V1.23 to V1.27.
  var helperProto: Int { (helper["proto"] as? NSNumber)?.intValue ?? 1 }
  /// The helper running now is older than this PS (it updates itself from V1.28 on; an older one waits
  /// for the Mac's next restart), so Active and Postpone are not there yet.
  var helperOld: Bool { !helper.isEmpty && (helper["safeMode"] as? Bool) != true && helperProto < RebootdIDs.proto }

  /// The developer chose this Mac's auto reboot on his main Mac (a signed set command Second.swift has checked;
  /// RemoteCommand hands it here): the same as choosing it in this Mac's own Security window.
  func setFromMain(mode m: String, minutes n: Int, from who: String) {
    guard ["off", "watch", "active"].contains(m), AutoReboot.minuteRange.contains(n) else { return }
    psLog("reboot: settings from \(who): \(m) \(n) min")
    if IS_TEST_COPY { testDid.append("set:\(m):\(n)"); testMode = m; testMinutes = n; changed(); return }
    defaults.set(n, forKey: "reboot.minutes"); defaults.set(m, forKey: "reboot.mode")
    push()
  }

  /// Postpone from the developer's other Mac or phone (a signed command Second.swift has checked; RemoteCommand
  /// hands it here): the restart comes an hour later. Never restarts anything.
  func postpone(from who: String, done: @escaping (String?) -> Void) {
    if IS_TEST_COPY { testDid.append("postpone"); return done(nil) }
    guard !helper.isEmpty, helperProto >= 2 else {
      return done(helper.isEmpty ? "The restart helper is not running on this Mac" : "The restart helper on this Mac is from an older PS app: it updates when this Mac restarts")
    }
    guard let p = proxy({ done($0) }) else { return }
    p.postpone("asked from \(who)") { [weak self] d in
      let r = self?.parse(d) ?? [:]
      DispatchQueue.main.async {
        psLog("reboot: postpone from \(who): \((r["ok"] as? Bool) == true ? "done" : (r["why"] as? String) ?? "refused")")
        self?.refresh()
        done((r["ok"] as? Bool) == true ? nil : (r["why"] as? String) ?? "The helper said no")
      }
    }
  }

  /// The next countdown is 5 minutes, once (for the M1 tests). Watch only stays watch only.
  func testOnce() {
    if IS_TEST_COPY { testDid.append("test"); if !helper.isEmpty { helper["testOnce"] = true }; changed(); return }
    push(testOnce: true)
  }

  /// Restart now (the developer's button, or a verified remote command after its cancel window).
  func restartNow(reason: String, done: @escaping (String?) -> Void) { ask(restart: true, reason, done) }
  /// Shut down now (the Second Computer Shut down button, or a verified remote command).
  func shutDownNow(reason: String, done: @escaping (String?) -> Void) { ask(restart: false, reason, done) }

  private func ask(restart: Bool, _ reason: String, _ done: @escaping (String?) -> Void) {
    guard let p = proxy({ done($0) }) else { return }
    psLog("reboot: asking the helper to \(restart ? "restart" : "shut down"): \(reason)")
    let reply: (Data) -> Void = { [weak self] d in
      let r = self?.parse(d) ?? [:]
      let ok = (r["ok"] as? Bool) == true
      DispatchQueue.main.async { done(ok ? nil : (r["why"] as? String) ?? "The helper said no") }
    }
    if restart { p.restart(reason, reply: reply) } else { p.shutDown(reason, reply: reply) }
  }

  // MARK: self test copies: a stand-in for the helper, so every button on the card can be clicked for real

  /// What a test copy shows in place of the helper ("test" until its card check picks "off", "approve" or "on").
  private var testHelper = "test"
  /// What a test copy did in place of asking macOS or the helper: "setup", "remove", "test".
  private(set) var testDid: [String] = []
  /// Self test only: the card in a helper state, with a made up status from the helper.
  func testShow(_ state: String, status: [String: Any] = [:]) {
    guard IS_TEST_COPY else { return }
    testHelper = state; helper = status; lastError = nil; changed()
  }
  /// Self test: nothing real was ever made or asked (no SMAppService object, no XPC connection).
  var testNeverTouched: Bool { IS_TEST_COPY && !serviceMade && conn == nil }

  // MARK: status for the page (Tab list settings, Machine pane) and the vault (GOS)

  func status() -> [String: Any] {
    var d: [String: Any] = ["helper": helperState, "mode": mode, "minutes": minutes, "defaultMinutes": AutoReboot.defaultMinutes,
                            "fileVault": fileVault, "model": AutoReboot.hwModel(), "passwordImmediately": passwordImmediately ?? NSNull(),
                            "helperOld": helperOld]
    if !helper.isEmpty { d["status"] = helper }
    if let lastError { d["error"] = lastError }
    d["checks"] = 1   // V1.54: the AI button can ask for a fresh check (reboot:check); an older Mac never sends this
    if let checkedId { d["checked"] = checkedId }
    if let o = offBy { d["offBy"] = o.rawValue }   // V1.45: "update" (macOS switched it off) or "settings"
    return d
  }

  /// `machine` in the Second Computer stat body (protocol section 13), what GOS and the other Mac show:
  /// awake (PS is running, so yes), locked, FileVault, whether sleep asks for the password at once, the
  /// timer and the helper. No log lines or history text leave this Mac.
  func machine() -> [String: Any] {
    let live = !helper.isEmpty && lastError == nil && (helper["safeMode"] as? Bool) != true
    let effective = (helper["effectiveMode"] as? String) ?? mode
    // hours stays for older pages (the Machine pane); minutes is the length (10 minutes to 72 hours).
    var timer: [String: Any] = ["on": effective != "off" && helperState == "on" && live, "hours": max(1, minutes / 60), "minutes": minutes, "mode": effective,
                                "asked": mode, "live": live, "safeMode": (helper["safeMode"] as? Bool) == true]
    timer["deadline"] = (helper["counting"] as? Bool) == true ? helper["deadline"] ?? NSNull() : NSNull()
    // V1.28: Postpone so far, and whether Postpone can reach this helper at all (an older helper says no
    // until this Mac restarts).
    if let p = helper["postponed"] as? NSNumber { timer["postponed"] = p }
    timer["postpone"] = live && helperProto >= 2 && (helper["counting"] as? Bool) == true
    timer["set"] = true   // this PS takes its auto reboot settings from the main Mac (V1.28)
    // The live timer on the other Mac and its last three lock periods (changes only at a lock, an unlock or a
    // restart, so the stat, sent only when it changes, stays rare).
    if live {
      if let l = helper["lockedAt"] { timer["lockedAt"] = l }
      if let si = helper["signedIn"] as? Bool { timer["signedIn"] = si }
      if let p = helper["periods"] as? [[String: Any]] { timer["periods"] = Array(p.prefix(3)) }
    }
    if let w = (helper["history"] as? [[String: Any]])?.last(where: { $0["kind"] as? String == "would" }) { timer["lastWould"] = w["at"] ?? NSNull() }
    var d: [String: Any] = ["awake": true, "locked": RemoteCommand.screenLocked(), "fileVault": fileVault,
                            "passwordImmediately": passwordImmediately ?? NSNull(), "timer": timer,
                            "helper": ["on": "approved", "approve": "needs approval", "off": "not set up"][helperState] ?? "missing"]
    if let b = helper["bootedAt"] { d["bootedAt"] = b }
    if let r = (helper["history"] as? [[String: Any]])?.last(where: { ["restart", "remote", "shutdown"].contains($0["kind"] as? String ?? "") }) {
      d["lastRestart"] = ["at": r["at"] ?? 0, "kind": r["kind"] ?? ""]
    }
    return d
  }

  /// Whether the screen locks at once on sleep (`sysadminctl -screenLock status`, no admin needed).
  /// Without it a Mac can sleep unlocked, and the timer (never restarting an unlocked Mac) waits.
  private(set) var passwordImmediately: Bool?
  func refreshPasswordDelay() {
    DispatchQueue.global(qos: .utility).async { [weak self] in
      let p = Process(), out = Pipe()
      p.executableURL = URL(fileURLWithPath: "/usr/sbin/sysadminctl"); p.arguments = ["-screenLock", "status"]
      p.standardOutput = out; p.standardError = out
      guard (try? p.run()) != nil else { return }
      let text = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
      p.waitUntilExit()
      let v: Bool? = text.contains("delay is immediate") ? true : text.contains("screenLock delay is") || text.contains("screenLock is off") ? false : nil
      DispatchQueue.main.async { if let self, v != self.passwordImmediately { self.passwordImmediately = v; self.changed() } }
    }
  }
}
