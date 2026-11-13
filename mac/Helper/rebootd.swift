// rebootd: PS's restart helper, a LaunchDaemon (root) registered with SMAppService. The developer approves it
// once in System Settings > General > Login Items & Extensions. It runs on its own, so the timer
// keeps working when PS is quit or crashes.
//
// It can do exactly five things and nothing else (no shell, no other commands):
//   1. restart, 2. shut down (both only when genuine PS asks over XPC),
//   3. hold one RTC wake of its own for the auto reboot deadline, 4. report its status,
//   5. (V1.48) keep the Mac awake with the lid closed for Sentry mode, on a 90 s lease PS renews, with battery
//      and heat cutoffs (the decisions are in LidCore.swift; off at every start),
//   6. (V1.48) restart the Mac when Sentry mode was not unlocked by its deadline (armed and cancelled only by PS,
//      fires even with PS gone, cleared by the restart; LidCore.swift, SentryRestart). It holds its own RTC wake.
// PS may also pass on a Postpone from the developer's other Mac or phone (V1.28): it only moves the restart later.
// When PS is updated, it restarts itself (launchd starts the new copy) once the new file is complete
// and signed by PS's own key, so a new helper never waits for the Mac's next restart.
// The auto reboot decisions all live in RebootCore.swift; this file only feeds it what the Mac is
// doing and carries out what it returns. Every decision is one plain line in rebootd.log.
// Never `fdesetup authrestart`: a restart always goes back to the FileVault password.
import CryptoKit
import Foundation
import IOKit
import IOKit.ps
import IOKit.pwr_mgt
import Security

let DIR = "/Library/Application Support/PS/rebootd"
let CONFIG = "\(DIR)/config.json", STATE = "\(DIR)/state.json", HISTORY = "\(DIR)/history.json", LOGF = "\(DIR)/rebootd.log"
let TRIED = "\(DIR)/tried"                 // the boot id in which an automatic restart was started
let SIGNIN = "\(DIR)/signin"               // the boot id in which rebootd itself saw a signed in, unlocked console
let PERIODS = "\(DIR)/periods.json"        // the last lock periods (LockPeriod), newest last
let WAKE_ID = "com.cincee.ps.rebootd" as CFString
let SENTRY = "\(DIR)/sentry.json"             // V1.48: Sentry mode's restart deadline (SentryDeadline), this boot only
let SENTRY_WAKE_ID = "com.cincee.ps.rebootd.sentry" as CFString   // its wake, apart from the auto reboot's one

// MARK: log

var recentLog: [String] = []
let stamp: DateFormatter = {
  let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd HH:mm:ss xxx"; return f
}()
func wallText(_ t: Double) -> String { stamp.timeZone = TimeZone.current; return stamp.string(from: Date(timeIntervalSince1970: t)) }
func log(_ s: String) {
  let line = "\(wallText(Date().timeIntervalSince1970)) \(s)"
  recentLog.append(line); if recentLog.count > 200 { recentLog.removeFirst(recentLog.count - 200) }
  FileHandle.standardError.write(Data((line + "\n").utf8))
  if let a = try? FileManager.default.attributesOfItem(atPath: LOGF), (a[.size] as? Int ?? 0) > 512 * 1024 {
    try? FileManager.default.removeItem(atPath: LOGF + ".1"); try? FileManager.default.moveItem(atPath: LOGF, toPath: LOGF + ".1")
  }
  if !FileManager.default.fileExists(atPath: LOGF) { FileManager.default.createFile(atPath: LOGF, contents: nil, attributes: [.posixPermissions: 0o644]) }
  if let h = FileHandle(forWritingAtPath: LOGF) { h.seekToEndOfFile(); h.write(Data((line + "\n").utf8)); try? h.close() }
}

// MARK: clocks and the console

/// Seconds since boot, counting sleep (mach_continuous_time), immune to clock and time zone changes.
func continuousNow() -> Double {
  var tb = mach_timebase_info_data_t(); mach_timebase_info(&tb)
  return Double(mach_continuous_time()) * Double(tb.numer) / Double(tb.denom) / 1e9
}
func wallNow() -> Double { Date().timeIntervalSince1970 }

func sysctlString(_ name: String) -> String {
  var size = 0
  guard sysctlbyname(name, nil, &size, nil, 0) == 0, size > 0 else { return "" }
  var buf = [CChar](repeating: 0, count: size)
  guard sysctlbyname(name, &buf, &size, nil, 0) == 0 else { return "" }
  return String(cString: buf)
}
func bootedAt() -> Double {
  var tv = timeval(), size = MemoryLayout<timeval>.size
  guard sysctlbyname("kern.boottime", &tv, &size, nil, 0) == 0 else { return 0 }
  return Double(tv.tv_sec) + Double(tv.tv_usec) / 1e6
}

/// Read straight from the IORegistry (no process spawned). Unlocked = someone is logged in on the
/// console and that screen is not locked. Anything unclear counts as locked, never as unlocked
/// (the unsafe direction for a reset is only a later restart, never a restart of a Mac in use).
func readConsole() -> (session: ConsoleSession, loginDone: Bool) {
  let root = IORegistryGetRootEntry(kIOMainPortDefault)
  defer { IOObjectRelease(root) }
  return RebootEngine.classifyConsole(IORegistryEntryCreateCFProperty(root, "IOConsoleUsers" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue())
}

/// The user macOS logs in by itself at start up (System Settings > Users & Groups > Automatically log
/// in as), or nil. Read as root from loginwindow's own preferences.
func autoLoginUser(path: String = "/Library/Preferences/com.apple.loginwindow.plist") -> String? {
  guard let d = NSDictionary(contentsOfFile: path), let u = d["autoLoginUser"] as? String, !u.isEmpty else { return nil }
  return u
}

/// Whether rebootd itself has seen someone signed in and unlocked during this boot (its own file, apart from
/// the timer's state). Missing, damaged or from another boot: no, so the timer does nothing (Before First Unlock).
func signInSeen(boot: String, path: String = SIGNIN) -> Bool {
  guard let body = readChecked(path), let text = String(data: body, encoding: .utf8) else { return false }
  return text == boot
}

/// Reads the marker; a damaged one counts as tried for this boot and is rewritten with this boot's id.
func readTried(boot: String, path: String = TRIED) -> Bool {
  let r = RebootEngine.triedThisBoot(markerBody: readChecked(path), markerExists: FileManager.default.fileExists(atPath: path), boot: boot)
  if r.repair {
    log("tried marker damaged: counted as tried for this boot only, rewritten")
    writeChecked(path, Data(boot.utf8))
  }
  return r.tried
}

/// The uid of the user on the console (locked or not), nil at the login window.
func consoleUID() -> uid_t? {
  let root = IORegistryGetRootEntry(kIOMainPortDefault)
  defer { IOObjectRelease(root) }
  guard let v = IORegistryEntryCreateCFProperty(root, "IOConsoleUsers" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue(),
        let users = v as? [[String: Any]],
        let u = users.first(where: { ($0["kCGSSessionOnConsoleKey"] as? Bool) == true && ($0["kCGSessionLoginDoneKey"] as? Bool) == true }),
        let id = (u["kCGSSessionUserIDKey"] as? NSNumber)?.uint32Value else { return nil }
  return id
}

/// Safe Mode (Shift at start up): rebootd stays completely inert, so Safe Mode is always a way out.
func safeBoot() -> Bool {
  var v: Int32 = 0, size = MemoryLayout<Int32>.size
  return sysctlbyname("kern.safeboot", &v, &size, nil, 0) == 0 && v != 0
}

// MARK: files (root only, 0600, written atomically with a checksum line)

func ensureDir() {
  let fm = FileManager.default
  try? fm.createDirectory(atPath: DIR, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
  try? fm.setAttributes([.posixPermissions: 0o700, .ownerAccountID: 0, .groupOwnerAccountID: 0], ofItemAtPath: DIR)
}
func writeChecked(_ path: String, _ data: Data) {
  let sum = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  var out = data; out.append(Data("\n\(sum)\n".utf8))
  let tmp = path + ".tmp"
  let fd = open(tmp, O_WRONLY | O_CREAT | O_TRUNC, 0o600)
  guard fd >= 0 else { log("could not write \(path)"); return }
  let ok = out.withUnsafeBytes { write(fd, $0.baseAddress, out.count) } == out.count
  _ = fcntl(fd, F_FULLFSYNC)               // on the disk before the rename, so a power cut leaves old or new, never half
  close(fd)
  guard ok else { log("could not write \(path)"); unlink(tmp); return }
  if rename(tmp, path) != 0 { log("could not replace \(path)"); return }
  let dfd = open((path as NSString).deletingLastPathComponent, O_RDONLY)
  if dfd >= 0 { _ = fsync(dfd); close(dfd) }
}
/// nil when missing, damaged or edited by hand (the checksum no longer matches).
func readChecked(_ path: String) -> Data? {
  guard let all = FileManager.default.contents(atPath: path), let text = String(data: all, encoding: .utf8) else { return nil }
  var lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
  while lines.last == "" { lines.removeLast() }
  guard lines.count >= 2, let sum = lines.popLast() else { return nil }
  let body = Data(lines.joined(separator: "\n").utf8)
  return SHA256.hash(data: body).map({ String(format: "%02x", $0) }).joined() == sum ? body : nil
}
let enc: JSONEncoder = { let e = JSONEncoder(); e.outputFormatting = [.sortedKeys]; return e }()

// MARK: wakes (IOPMSchedulePowerEvent, ours only, identified by WAKE_ID)

func ourWakes(id: CFString = WAKE_ID) -> [Date] {
  guard let all = IOPMCopyScheduledPowerEvents()?.takeRetainedValue() as? [[String: Any]] else { return [] }
  return all.compactMap { e in
    (e[kIOPMPowerEventAppNameKey] as? String) == (id as String) ? e[kIOPMPowerEventTimeKey] as? Date : nil
  }
}
func cancelWake(_ d: Date, id: CFString = WAKE_ID) {
  let r = IOPMCancelScheduledPowerEvent(d as CFDate, id, kIOPMAutoWake as CFString)
  if r != kIOReturnSuccess { log("wake at \(wallText(d.timeIntervalSince1970)) was already gone (\(r))") }
}
/// Our wakes for `at`: the wake itself and a backup 10 min later (a missed RTC wake gets a second
/// chance). Every other wake of ours is removed. `at` comes from RebootCore, already whole seconds.
/// The new pair goes in FIRST; the old wakes are removed only once the new wake is accepted, so a
/// refusal never leaves the Mac with no wake at all.
/// `id`: the auto reboot's wakes (WAKE_ID) or Sentry mode's (SENTRY_WAKE_ID); each kind only ever touches its own.
@discardableResult
func scheduleWake(_ at: Double, id: CFString = WAKE_ID) -> Bool {
  let want = RebootEngine.wakePair(at).map { Date(timeIntervalSince1970: $0) }
  var ok = true
  for w in want where !ourWakes(id: id).contains(where: { abs($0.timeIntervalSince(w)) < 1 }) {
    let r = IOPMSchedulePowerEvent(w as CFDate, id, kIOPMAutoWake as CFString)
    if r != kIOReturnSuccess { log("could not schedule the wake at \(wallText(w.timeIntervalSince1970)) (\(r))"); if w == want[0] { ok = false } }
  }
  if ok { for d in ourWakes(id: id) where !want.contains(where: { abs(d.timeIntervalSince($0)) < 1 }) { cancelWake(d, id: id) } }
  return ok
}
func cancelAllWakes(id: CFString = WAKE_ID) { for d in ourWakes(id: id) { cancelWake(d, id: id) } }

// MARK: restart and shut down

var assertion: IOPMAssertionID = 0
/// Keeps the Mac awake (also in a dark wake with the lid shut, as far as macOS allows) while a
/// restart gets going. The retry wake in RebootCore covers the case where it falls asleep anyway.
func holdAwake(_ why: String, seconds: Double) {
  if assertion != 0 { IOPMAssertionRelease(assertion); assertion = 0 }
  var id: IOPMAssertionID = 0
  let props: [String: Any] = [kIOPMAssertionTypeKey: "PreventSystemSleep", kIOPMAssertionNameKey: "PS rebootd: \(why)", kIOPMAssertionTimeoutKey: seconds,
                              kIOPMAssertionTimeoutActionKey: kIOPMAssertionTimeoutActionRelease]
  if IOPMAssertionCreateWithProperties(props as CFDictionary, &id) == kIOReturnSuccess { assertion = id }
  var bg: IOPMAssertionID = 0
  let bgProps: [String: Any] = [kIOPMAssertionTypeKey: "BackgroundTask", kIOPMAssertionNameKey: "PS rebootd: \(why)", kIOPMAssertionTimeoutKey: seconds,
                                kIOPMAssertionTimeoutActionKey: kIOPMAssertionTimeoutActionRelease]
  _ = IOPMAssertionCreateWithProperties(bgProps as CFDictionary, &bg)
}

/// How the Mac is restarted, and why this way:
///   1. `/sbin/shutdown -r now` (or `-h now`), fixed arguments, no shell. launchd stops every process
///      with SIGTERM, then SIGKILL, and unmounts the disks cleanly. Unlike Apple menu > Restart, no app
///      is asked and none can say no: an unsaved document, a "Save changes?" sheet or a hung app cannot
///      stop it (unsaved changes are lost, except what apps keep by themselves).
///   2. If this process is still alive 60 s later, shutdown did not happen: reboot(2) straight into the
///      kernel (it still writes the disks out first). Daemon.armFallback does that; for the timer's own
///      restart it first checks again that nobody has unlocked the Mac in the meantime.
/// Never `fdesetup authrestart`: the Mac always comes back to the FileVault password.
func powerOff(restart: Bool, why: String) -> Bool {
  holdAwake(why, seconds: 120)
  var pid: pid_t = 0
  let args = ["/sbin/shutdown", restart ? "-r" : "-h", "now"]
  var argv: [UnsafeMutablePointer<CChar>?] = args.map { strdup($0) } + [nil]
  defer { argv.forEach { free($0) } }
  let env: [UnsafeMutablePointer<CChar>?] = [strdup("PATH=/usr/bin:/bin:/usr/sbin:/sbin"), nil]
  defer { env.forEach { free($0) } }
  let r = posix_spawn(&pid, "/sbin/shutdown", nil, nil, &argv, env)
  if r != 0 { log("could not start /sbin/shutdown (\(r)): the kernel fallback follows in 60 s") }
  return true
}

// MARK: lid closed keep awake (V1.48, Sentry mode)

/// The root domain's clamshell switch (kPMSetClamshellSleepState, selector 12 in IOKit's IOPMLibDefs.h), the call
/// powerd itself makes for clamshell mode: while set, closing the lid does not sleep the Mac, on battery too. PS's
/// own no idle sleep assertion (Sources/Sentry.swift) keeps it from idle sleep meanwhile. Kernel memory only:
/// nothing is written to disk, and a restart always clears it, whatever happens to this helper.
///
/// V1.48 to V1.52 set "SleepDisabled" (what `pmset disablesleep` changes) instead, and it never took: the kernel
/// lets only processes with Apple's private entitlement com.apple.private.iokit.rootdomain-set-property set root
/// domain properties (pmset and powerd have it; root is not enough), so the write came back 0xe00002e2
/// kIOReturnNotPermitted. Its fallback, IOPMSetSystemPowerSetting, only saves the setting in
/// /Library/Preferences/com.apple.PowerManagement.plist for powerd to apply later: on disk, kept over a restart.
///
/// The switch cannot be read back, so the helper keeps what the kernel last accepted from it (`lidKernel`), and
/// sends it again every 2 s while on, as powerd may set it off when its own reasons for it end.
let PM_SET_CLAMSHELL_SLEEP_STATE: UInt32 = 12
func rootDomain() -> io_registry_entry_t { IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("IOPMrootDomain")) }
/// What the kernel last accepted from this helper: true on, false off, nil before the first (or after a refusal).
var lidKernel: Bool?
/// A refusal's IOReturn is logged once per stretch of refusals, not every 2 s.
var lidRefusalLogged = false
/// One call to the switch with these scalar inputs (one input, 1 or 0; the tests send none, which the kernel refuses
/// by its argument count before doing anything). The kernel's IOReturn.
func callClamshellSwitch(_ inputs: [UInt64]) -> kern_return_t {
  let rd = rootDomain()
  guard rd != 0 else { return kIOReturnNotFound }
  defer { IOObjectRelease(rd) }
  var c: io_connect_t = 0
  let o = IOServiceOpen(rd, mach_task_self_, 0, &c)
  guard o == KERN_SUCCESS else { return o }
  defer { IOServiceClose(c) }
  return inputs.withUnsafeBufferPointer { IOConnectCallScalarMethod(c, PM_SET_CLAMSHELL_SLEEP_STATE, $0.baseAddress, UInt32($0.count), nil, nil) }
}
/// Sets the switch: true when the kernel accepted it.
func applyLid(_ on: Bool) -> Bool {
  let r = callClamshellSwitch([LidIO.input(on)])
  if r == KERN_SUCCESS { lidKernel = on; lidRefusalLogged = false; return true }
  lidKernel = nil
  if !lidRefusalLogged { lidRefusalLogged = true; log(LidIO.refusal(on: on, r)) }
  return false
}
/// The power source and heat, for the cutoffs. thermal: 0 nominal, 1 fair, 2 serious, 3 critical.
func readLidPower() -> LidPower {
  let thermal: Int
  switch ProcessInfo.processInfo.thermalState {
  case .nominal: thermal = 0
  case .fair: thermal = 1
  case .serious: thermal = 2
  default: thermal = 3
  }
  guard let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue() else { return LidPower(onBattery: false, percent: nil, thermal: thermal) }
  let onBattery = (IOPSGetProvidingPowerSourceType(info)?.takeUnretainedValue() as String?) == kIOPSBatteryPowerValue
  var percent: Int?
  let list = (IOPSCopyPowerSourcesList(info)?.takeRetainedValue() as? [CFTypeRef]) ?? []
  for ps in list {
    guard let d = IOPSGetPowerSourceDescription(info, ps)?.takeUnretainedValue() as? [String: Any],
          (d[kIOPSTypeKey] as? String) == kIOPSInternalBatteryType,
          let cur = d[kIOPSCurrentCapacityKey] as? Int, let max = d[kIOPSMaxCapacityKey] as? Int, max > 0 else { continue }
    percent = cur * 100 / max
  }
  return LidPower(onBattery: onBattery, percent: percent, thermal: thermal)
}

// MARK: this helper's own file

/// The path this process was started from.
func ownPath() -> String? {
  var buf = [CChar](repeating: 0, count: 4096)
  return proc_pidpath(getpid(), &buf, UInt32(buf.count)) > 0 ? String(cString: buf) : nil
}
/// Device, inode, size and modification time: any replacement of the file changes it.
func fileStamp(_ path: String) -> [Int]? {
  var st = stat()
  guard stat(path, &st) == 0 else { return nil }
  return [Int(st.st_dev), Int(st.st_ino), Int(st.st_size), Int(st.st_mtimespec.tv_sec), Int(st.st_mtimespec.tv_nsec)]
}
/// What checkOwnFile does next (pure, so tests/rebootd-io-test.swift checks every case): `.same` the
/// file is the one this helper started from (or is missing for now: an update in progress), `.seen` a
/// new or still changing file (the 30 s clock starts again), `.wait` not yet 30 s unchanged, or a
/// restart is under way, `.refused` not signed with PS's key, `.restart` save and exit so launchd runs it.
enum OwnFileStep: Equatable { case same, seen, wait, refused, restart }
func ownFileStep(started: [Int], current: [Int]?, seen: (stamp: [Int], since: Double)?, now: Double, busy: Bool, signed: () -> Bool) -> OwnFileStep {
  guard let current, current != started else { return .same }
  guard let seen, seen.stamp == current else { return .seen }
  if now - seen.since < 30 || busy { return .wait }
  return signed() ? .restart : .refused
}
/// The file at `path` is a complete, valid helper signed with PS's own certificate and identifier.
func signedByPS(_ path: String) -> Bool {
  var code: SecStaticCode?, req: SecRequirement?
  guard SecStaticCodeCreateWithPath(URL(fileURLWithPath: path) as CFURL, [], &code) == errSecSuccess, let code,
        SecRequirementCreateWithString(RebootdIDs.helperRequirement as CFString, [], &req) == errSecSuccess, let req else { return false }
  return SecStaticCodeCheckValidity(code, SecCSFlags(rawValue: kSecCSCheckAllArchitectures), req) == errSecSuccess
}

// MARK: the daemon

final class Daemon: NSObject, NSXPCListenerDelegate, RebootdXPC {
  var engine: RebootEngine!
  var history: [HistoryEntry] = []
  var periods: [LockPeriod] = []
  var bootId = ""
  var signedIn = false                      // this boot's sign in, as rebootd's own file says
  var configError = false
  var lastAsked = -1e18
  var timer: DispatchSourceTimer?
  var timerFallback: DispatchWorkItem?      // the timer's own restart (cancelled by an unlock)
  var explicitFallback: DispatchWorkItem?   // The developer's Restart or Shut down (always goes)
  var autoLoginStamp: Date?                 // loginwindow preferences last read (modification time)
  var explicitUntil = -1e18                 // continuous seconds: the developer's own Restart or Shut down is under way until then
  var sigterm: DispatchSourceSignal?
  var exe: (path: String, stamp: [Int])?    // this helper's own file when it started (inode, size, mtime)
  var exeChanged: (stamp: [Int], since: Double)?   // a new file seen at that path, and since when it is unchanged
  var exeRefusedLogged = false
  var ticks = 0
  var powerPort: IONotificationPortRef?
  var rootPort: io_connect_t = 0
  let lid = LidEngine()
  var sentry: SentryDeadline?               // V1.48: Sentry mode's restart deadline, this boot only
  var sentrySession: ConsoleSession?        // the console as last seen for it (a real unlock cancels it)
  var sentryWatch: DispatchSourceTimer?     // 0.5 s console checks while one is armed, so a quick unlock is not missed
  let listener = NSXPCListener(machServiceName: RebootdIDs.mach)

  var inert = false

  func start() {
    ensureDir()
    if safeBoot() {
      // Safe Mode is the developer's way out: no timer, no wakes, no restart, whatever the settings say.
      inert = true
      log("Safe Mode: doing nothing (no timer, no wakes, no restarts, no lid keep awake, no Sentry restart)")
      cancelAllWakes(); cancelAllWakes(id: SENTRY_WAKE_ID)
      _ = runLid(lid.start(actual: lidKernel))
      listener.delegate = self; listener.resume()
      return
    }
    // SIGTERM (the helper switched off in Login Items, removed, or the Mac shutting down): drop our
    // wakes so a removed helper leaves nothing behind. launchd restarting it after a crash sends none.
    signal(SIGTERM, SIG_IGN)
    let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    term.setEventHandler { [weak self] in
      if let self { _ = self.runLid(self.lid.stopping()) }
      // Sentry's wake goes (it could only wake the Mac for nothing); its deadline stays on disk for a helper that
      // starts again in this boot.
      cancelAllWakes(id: SENTRY_WAKE_ID)
      guard let self, let e = self.engine else { cancelAllWakes(); exit(0) }
      if e.stopping(now: continuousNow()) {
        // Most likely our own restart: launchd is stopping everything. Keep the retry and backup wakes
        // (the next boot removes them; at worst they wake the Mac once) in case it does not go through.
        log("stopping during a restart attempt: wakes kept")
      } else {
        log("stopping: wakes cancelled")       // stopping() already dropped the wake from the state
        cancelAllWakes()
      }
      if let d = try? enc.encode(e.state) { writeChecked(STATE, d) }
      exit(0)
    }
    term.resume(); sigterm = term
    // Lid closed keep awake is never on when the helper starts (a crash, an update, a boot): off first of all.
    _ = runLid(lid.start(actual: lidKernel))
    var config = RebootConfig()
    if FileManager.default.fileExists(atPath: CONFIG) || FileManager.default.fileExists(atPath: CONFIG + ".bak") {
      let parsed = [CONFIG, CONFIG + ".bak"].lazy.compactMap { readChecked($0) }
        .compactMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] }.compactMap { RebootConfig.parse($0) }.first
      if let c = parsed { config = c } else { configError = true; log("config unreadable: timer off until PS sends it again") }
    }
    let loaded = readChecked(STATE).flatMap { try? JSONDecoder().decode(RebootState.self, from: $0) }
    if FileManager.default.fileExists(atPath: STATE) && loaded == nil { log("state file unreadable: dropped") }
    history = readChecked(HISTORY).flatMap { try? JSONDecoder().decode([HistoryEntry].self, from: $0) } ?? []
    periods = readChecked(PERIODS).flatMap { try? JSONDecoder().decode([LockPeriod].self, from: $0) } ?? []
    let c = readConsole()
    let boot = sysctlString("kern.bootsessionuuid")
    bootId = boot
    signedIn = signInSeen(boot: boot)
    let tried = readTried(boot: boot)
    var first: [RebootAction] = []
    engine = RebootEngine(config: config, loaded: loaded, boot: boot, now: continuousNow(), wall: wallNow(),
                          triedThisBoot: tried, session: c.session, fmt: wallText, log: &first)
    noteSignIn(c.session)
    log("started: \(config.describe), console \(c.session.rawValue), booted \(wallText(bootedAt()))\(tried ? ", an automatic restart was already started in this boot" : "")")
    refreshAutoLogin()
    run(first)
    // Stale wakes of ours (a crash between schedule and save) never survive a start.
    // Stale wakes of ours (a crash between schedule and save) never survive a start, and a saved wake
    // IOKit does not hold (cancelled from outside, or dropped) is asked for again.
    let saved = engine.state.wake
    let rec = engine.reconcile(held: ourWakes().map { $0.timeIntervalSince1970 })
    for d in rec.cancel { log("removing a stale wake at \(wallText(d))"); cancelWake(Date(timeIntervalSince1970: d)) }
    if rec.reask, let w = saved { log("the saved wake at \(wallText(w)) is not scheduled: asking for it again") }
    loadSentry()
    watchPower()
    listener.delegate = self
    listener.resume()
    if let p = ownPath(), let st = fileStamp(p) { exe = (p, st) }
    let t = DispatchSource.makeTimerSource(queue: .main)
    t.schedule(deadline: .now(), repeating: 2, leeway: .milliseconds(300))
    t.setEventHandler { [weak self] in
      guard let self else { return }
      self.step(.tick)
      if self.lid.on || self.lid.dirty { self.runLid(self.lid.tick(now: continuousNow(), power: readLidPower(), actual: lidKernel)) }
      // Still on: the switch again (powerd may have set it off; it cannot be read back). A refusal ends the session.
      if self.lid.on { self.runLid([.set(true)]) }
      if self.sentry != nil { self.checkSentry() }
      self.ticks += 1
      if self.ticks % 15 == 0 { self.checkOwnFile() }   // every 30 s
    }
    t.resume(); timer = t
    step(.start)
  }

  /// 60 s after asking shutdown, if this process still runs, the restart did not happen: force it
  /// through the kernel. For the timer's restart only if the Mac is still not unlocked and the engine
  /// still has the attempt (an unlock in between cancels it here and in step()).
  func armFallback(restart: Bool, automatic: Bool) {
    let item = DispatchWorkItem { [weak self] in
      guard let self else { return }
      guard RebootEngine.fallbackGo(automatic: automatic, session: readConsole().session, attempts: self.engine.state.attempts) else {
        log("unlocked since the restart attempt: kernel fallback skipped"); return
      }
      log("still running 60 s after asking shutdown: forcing \(restart ? "reboot" : "halt") through the kernel")
      sync()
      _ = Darwin.reboot(restart ? RB_AUTOBOOT : RB_HALT)
    }
    if automatic { timerFallback?.cancel(); timerFallback = item } else { explicitFallback?.cancel(); explicitFallback = item }
    DispatchQueue.main.asyncAfter(deadline: .now() + 60, execute: item)
  }

  /// Automatic login is checked again whenever loginwindow's preferences change (cheap: one stat a
  /// step), so turning it on later in a boot makes Active act as Watch only at once.
  func refreshAutoLogin() {
    let path = "/Library/Preferences/com.apple.loginwindow.plist"
    let stamp = (try? FileManager.default.attributesOfItem(atPath: path))?[.modificationDate] as? Date ?? .distantPast
    if stamp == autoLoginStamp { return }
    autoLoginStamp = stamp
    let why: String? = autoLoginUser(path: path) != nil ? "automatic login is on" : nil
    if why != engine.watchOnlyBecause {
      engine.watchOnlyBecause = why
      log(why == nil ? "automatic login is off: Active works as chosen" : "automatic login is on: Active acts as Watch only, so a restart can never be followed by a restart with nobody there")
    }
  }

  /// Someone signed in and unlocked on the console during this boot: rebootd writes it down once, in its own file.
  func noteSignIn(_ session: ConsoleSession) {
    if session == .unlocked && !signedIn {
      writeChecked(SIGNIN, Data(bootId.utf8))
      signedIn = signInSeen(boot: bootId)
      log(signedIn ? "a sign in is seen in this boot: the timer may run from the next lock" : "could not write down this boot's sign in: the timer stays off")
    }
    engine?.signInSeen = signedIn
  }

  func step(_ ev: RebootEvent) {
    let c = readConsole()
    noteSignIn(c.session)
    refreshAutoLogin()
    engine.explicitInFlight = continuousNow() < explicitUntil
    if let f = timerFallback, !f.isCancelled, !RebootEngine.fallbackGo(automatic: true, session: c.session, attempts: engine.state.attempts) {
      f.cancel(); log("unlocked: the pending kernel fallback of the timer is cancelled")
    }
    run(engine.step(ev, session: c.session, now: continuousNow(), wall: wallNow()))
  }

  func run(_ actions: [RebootAction]) {
    for a in actions {
      switch a {
      case .log(let s): log(s)
      case .save: if let d = try? enc.encode(engine.state) { writeChecked(STATE, d) }
      case .cancelWake: for d in ourWakes() { cancelWake(d) }      // we only ever hold one: drop all of ours
      case .saveConfig: if let d = try? enc.encode(engine.config) { writeChecked(CONFIG, d); writeChecked(CONFIG + ".bak", d) }
      case .markTried: writeChecked(TRIED, Data(sysctlString("kern.bootsessionuuid").utf8))
      case .scheduleWake(let w):
        if !scheduleWake(w) { engine.wakeFailed() }
      case .record(let e): addHistory(e)
      case .period(let p): addPeriod(p)
      case .restart(let why):
        if continuousNow() < explicitUntil {
          // Belt and braces (the engine already waits while explicitInFlight): the developer's own one decides.
          log("an explicit restart or shut down is under way: the timer leaves it")
        } else if !signInSeen(boot: bootId) {
          // The hard guard, apart from the timer's state: no sign in written down in this boot, no restart.
          log("the timer asked for a restart, but no sign in is written down in this boot: not restarting (Before First Unlock)")
        } else { _ = powerOff(restart: true, why: why); armFallback(restart: true, automatic: true) }
      }
    }
  }

  /// Carries out the lid engine's actions. True when turning it on did not take (the engine is told, and it is off again).
  @discardableResult
  func runLid(_ actions: [LidAction]) -> Bool {
    var failedOn = false
    for a in actions {
      switch a {
      case .log(let s): log(s)
      case .set(let on): if !applyLid(on) && on { failedOn = true }
      }
    }
    if failedOn { runLid(lid.applyFailed()) }
    return failedOn
  }

  func addPeriod(_ p: LockPeriod) {
    periods.append(p); if periods.count > 10 { periods.removeFirst(periods.count - 10) }
    if let d = try? enc.encode(periods) { writeChecked(PERIODS, d) }
  }

  func addHistory(_ e: HistoryEntry) {
    history.append(e); if history.count > 200 { history.removeFirst(history.count - 200) }
    if let d = try? enc.encode(history) { writeChecked(HISTORY, d) }
  }

  // Sleep and wake. The will sleep step runs before macOS is allowed to sleep, so the wake is exact.
  func watchPower() {
    var notifier: io_object_t = 0
    let me = Unmanaged.passUnretained(self).toOpaque()
    rootPort = IORegisterForSystemPower(me, &powerPort, { refcon, _, type, arg in
      guard let refcon else { return }
      let d = Unmanaged<Daemon>.fromOpaque(refcon).takeUnretainedValue()
      switch type {
      case 0xE000_0270: IOAllowPowerChange(d.rootPort, Int(bitPattern: arg))             // can system sleep
      case 0xE000_0280: d.step(.willSleep); d.scheduleSentryWake(); IOAllowPowerChange(d.rootPort, Int(bitPattern: arg)) // will sleep
      case 0xE000_0300:                                                                    // has powered on
        // At once, before anything else: keep this (possibly short, lid shut) wake up long enough.
        if d.engine.mode != .off && d.engine.state.seenUnlock { holdAwake("checking the timer after a wake", seconds: 60) }
        else if d.sentry != nil { holdAwake("checking the Sentry deadline after a wake", seconds: 60) }
        d.step(.didWake)
        if d.sentry != nil { d.checkSentry() }
      default: break
      }
    }, &notifier)
    if rootPort == 0 { log("could not watch sleep and wake: relying on the 2 s check and the RTC wake"); return }
    IONotificationPortSetDispatchQueue(powerPort, .main)
  }

  // MARK: XPC (only genuine PS, checked by its code signature)

  func listener(_ listener: NSXPCListener, shouldAcceptNewConnection c: NSXPCConnection) -> Bool {
    c.setCodeSigningRequirement(RebootdIDs.psRequirement)
    c.exportedInterface = NSXPCInterface(with: RebootdXPC.self)
    c.exportedObject = self
    c.resume()
    return true
  }

  func statusData() -> Data {
    guard !inert, let e = engine else {
      // Safe Mode: report the stored settings as they are, the timer as off, and nothing else.
      let stored = [CONFIG, CONFIG + ".bak"].lazy.compactMap { readChecked($0) }
        .compactMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] }.compactMap { RebootConfig.parse($0) }.first
      let d: [String: Any] = ["v": 1, "proto": RebootdIDs.proto, "safeMode": true, "mode": stored?.mode.rawValue ?? "off", "minutes": stored?.minutes ?? 0, "testOnce": false,
                              "effectiveMode": "off", "counting": false, "history": [], "log": Array(recentLog.suffix(60))]
      return (try? JSONSerialization.data(withJSONObject: d)) ?? Data("{}".utf8)
    }
    let s = e.state, c = readConsole()
    let now = continuousNow(), wall = wallNow()
    let counting = e.counting && c.session != .unlocked
    var d: [String: Any] = ["v": 1, "proto": RebootdIDs.proto, "mode": e.config.mode.rawValue, "effectiveMode": e.mode.rawValue, "activeAllowed": RebootEngine.activeAllowed,
                            "bootTried": s.bootTried, "watchOnlyBecause": e.watchOnlyBecause ?? NSNull(), "minutes": e.config.minutes, "testOnce": e.config.testOnce,
                            "session": c.session.rawValue, "seenUnlock": s.seenUnlock, "counting": counting,
                            "periodMinutes": s.periodMinutes, "bootedAt": bootedAt(), "configError": configError,
                            "history": history.suffix(50).map { ["at": $0.at, "kind": $0.kind, "text": $0.text] },
                            "log": Array(recentLog.suffix(60))]
    if e.mode != .off && s.seenUnlock {
      let dl = wall + (e.deadline - now)
      d["deadline"] = dl; d["left"] = max(0, e.deadline - now)
    }
    if let w = s.wake { d["wake"] = w }
    if let p = s.postponed, p > 0 { d["postponed"] = p }
    if let l = s.lockedWall, c.session != .unlocked { d["lockedAt"] = l }
    d["signedIn"] = signedIn
    d["lid"] = lid.on
    if let sd = sentry { d["sentryDeadline"] = (wall + (sd.at - now)).rounded() }
    d["periods"] = periods.suffix(3).reversed().map { p -> [String: Any] in
      var x: [String: Any] = ["lockedAt": p.lockedAt, "endedAt": p.endedAt, "ran": p.ran, "end": p.end]
      if let v = p.postponed, v > 0 { x["postponed"] = v }
      if let v = p.would { x["would"] = v }
      return x
    }
    return (try? JSONSerialization.data(withJSONObject: d)) ?? Data("{}".utf8)
  }

  func status(reply: @escaping (Data) -> Void) { DispatchQueue.main.async { reply(self.statusData()) } }

  /// Only PS running as the user on the console may change anything (another account, or a PS of
  /// another user, gets status only).
  private func callerOK() -> Bool {
    guard let c = NSXPCConnection.current() else { return false }
    let uid = c.effectiveUserIdentifier
    return !inert && (uid == 0 || uid == consoleUID())
  }

  func setConfig(_ json: Data, reply: @escaping (Data) -> Void) {
    let ok = callerOK()
    DispatchQueue.main.async {
      guard ok else { log("settings refused: not the user on the console (or Safe Mode)"); return reply(self.statusData()) }
      guard json.count < 4096, let j = try? JSONSerialization.jsonObject(with: json) as? [String: Any], let c = RebootConfig.parse(j) else {
        log("settings from PS refused: not valid"); return reply(self.statusData())
      }
      self.configError = false
      if let d = try? enc.encode(c) { writeChecked(CONFIG, d); writeChecked(CONFIG + ".bak", d) }
      let s = readConsole().session
      self.run(self.engine.setConfig(c, now: continuousNow(), wall: wallNow(), session: s))
      reply(self.statusData())
    }
  }

  func restart(_ reason: String, reply: @escaping (Data) -> Void) {
    let ok = callerOK()
    DispatchQueue.main.async { ok ? self.asked(restart: true, reason, reply) : reply(Data("{\"ok\":false,\"why\":\"not allowed\"}".utf8)) }
  }
  func shutDown(_ reason: String, reply: @escaping (Data) -> Void) {
    let ok = callerOK()
    DispatchQueue.main.async { ok ? self.asked(restart: false, reason, reply) : reply(Data("{\"ok\":false,\"why\":\"not allowed\"}".utf8)) }
  }

  func postpone(_ reason: String, reply: @escaping (Data) -> Void) {
    let ok = callerOK()
    DispatchQueue.main.async {
      guard ok else { return reply(Data("{\"ok\":false,\"why\":\"not allowed\"}".utf8)) }
      let r = self.engine.postpone(from: reason, now: continuousNow(), wall: wallNow(), session: readConsole().session)
      if !r.ok { log("postpone \(String(reason.prefix(60))): not done, \((r.why ?? "").lowercased())") }
      self.run(r.actions)
      var body: [String: Any] = ["ok": r.ok]
      if let why = r.why { body["why"] = why }
      reply((try? JSONSerialization.data(withJSONObject: body)) ?? Data())
    }
  }

  /// V1.48 Sentry mode: lid closed keep awake on or off, renewed by PS every 30 s (LidCore.swift has the rules).
  func lid(_ json: Data, reply: @escaping (Data) -> Void) {
    let ok = callerOK()
    DispatchQueue.main.async {
      func answer(_ d: [String: Any]) { reply((try? JSONSerialization.data(withJSONObject: d)) ?? Data("{}".utf8)) }
      guard !self.inert else { return answer(["ok": false, "on": false, "why": LidStop.safeMode.rawValue]) }
      guard json.count < 1024, let j = try? JSONSerialization.jsonObject(with: json) as? [String: Any], let r = LidRequest.parse(j) else {
        log("lid keep awake: request from PS refused, not valid")
        return answer(["ok": false, "on": self.lid.on, "why": LidStop.invalid.rawValue])
      }
      let out = self.lid.request(r, now: continuousNow(), power: readLidPower(), allowed: ok)
      answer(self.runLid(out.actions) ? self.lid.replyNow : out.reply)
    }
  }

  // MARK: Sentry mode's restart deadline (V1.48)

  /// At start: only a deadline of this very boot survives (so the restart it caused clears it: never a boot loop).
  func loadSentry() {
    let exists = FileManager.default.fileExists(atPath: SENTRY)
    let rec = readChecked(SENTRY).flatMap { try? JSONDecoder().decode(SentryDeadline.self, from: $0) }
    let l = SentryRestart.loaded(rec, damaged: exists && rec == nil, boot: bootId)
    if let s = l.log { log(s) }
    sentry = l.keep
    if sentry == nil {
      if exists { try? FileManager.default.removeItem(atPath: SENTRY) }
      cancelAllWakes(id: SENTRY_WAKE_ID)
    } else { sentrySession = readConsole().session; scheduleSentryWake(); watchSentry() }
  }

  /// While a deadline is armed, the console is looked at every 0.5 s (one IORegistry read), so a lock and Touch ID
  /// unlock quicker than the 2 s check still cancels it. Stopped once nothing is armed.
  func watchSentry() {
    if sentry == nil { sentryWatch?.cancel(); sentryWatch = nil; return }
    guard sentryWatch == nil else { return }
    let t = DispatchSource.makeTimerSource(queue: .main)
    t.schedule(deadline: .now() + 0.5, repeating: 0.5, leeway: .milliseconds(100))
    t.setEventHandler { [weak self] in if let self, self.sentry != nil { self.checkSentry() } }
    t.resume(); sentryWatch = t
  }

  func saveSentry() {
    if let d = sentry, let body = try? enc.encode(d) { writeChecked(SENTRY, body) }
    else { try? FileManager.default.removeItem(atPath: SENTRY) }
  }

  /// One wake (and its backup) at the deadline, so a Mac asleep with the lid shut still restarts on time.
  func scheduleSentryWake() {
    guard let d = sentry else { return }
    if !scheduleWake(SentryRestart.wakeWall(d, now: continuousNow(), wall: wallNow()), id: SENTRY_WAKE_ID) {
      log("Sentry restart: could not schedule its wake, the deadline still holds while the Mac is awake")
    }
  }

  func checkSentry() {
    let session = readConsole().session
    let before = sentrySession
    sentrySession = session
    if sentry != nil && SentryRestart.unlockCancels(previous: before, now: session) {
      log("Sentry restart: cancelled, the Mac was unlocked with its own lock screen")
      sentry = nil; saveSentry(); cancelAllWakes(id: SENTRY_WAKE_ID); watchSentry()
      return
    }
    switch SentryRestart.due(sentry, boot: bootId, now: continuousNow(), signedIn: signInSeen(boot: bootId)) {
    case .none: break
    case .drop(let why):
      log(why); sentry = nil; saveSentry(); cancelAllWakes(id: SENTRY_WAKE_ID); watchSentry()
    case .fire:
      // Cleared on disk first: whatever happens next, this deadline never fires twice.
      sentry = nil; saveSentry(); cancelAllWakes(id: SENTRY_WAKE_ID); watchSentry()
      let now = continuousNow(), wall = wallNow()
      if now < explicitUntil { log("Sentry restart: due, and a restart or shut down is already under way"); return }
      log("Sentry restart: nobody unlocked Sentry mode in time, restarting")
      explicitUntil = now + 70                 // shutdown, then the kernel fallback at 60 s
      run(engine.explicitPower(restart: true, now: now, wall: wall))
      addHistory(HistoryEntry(at: wall, kind: "sentry", text: "Restarted at \(wallText(wall)): Sentry mode was not unlocked in time"))
      _ = powerOff(restart: true, why: "Sentry mode was not unlocked in time")
      armFallback(restart: true, automatic: false)
    }
  }

  /// V1.48: arm, cancel or read Sentry mode's restart deadline. Arm and cancel only from PS of the console user.
  func sentryRestart(_ json: Data, reply: @escaping (Data) -> Void) {
    let ok = callerOK()
    DispatchQueue.main.async {
      func answer(_ d: [String: Any]) { reply((try? JSONSerialization.data(withJSONObject: d)) ?? Data("{}".utf8)) }
      guard !self.inert else { return answer(["ok": false, "why": "safeMode"]) }
      let now = continuousNow(), wall = wallNow()
      guard json.count < 512, let j = try? JSONSerialization.jsonObject(with: json) as? [String: Any], let r = SentryRestartRequest.parse(j) else {
        log("Sentry restart: request from PS refused, not valid")
        return answer(SentryRestart.reply(self.sentry, now: now, wall: wall, ok: false, why: "invalid"))
      }
      if r != .read && !ok {
        log("Sentry restart: refused, not the user on the console")
        return answer(SentryRestart.reply(self.sentry, now: now, wall: wall, ok: false, why: "notAllowed"))
      }
      switch r {
      case .read:
        answer(SentryRestart.reply(self.sentry, now: now, wall: wall))
      case .arm(let secs):
        guard let d = SentryRestart.arm(seconds: secs, boot: self.bootId, now: now, wall: wall) else {
          return answer(SentryRestart.reply(self.sentry, now: now, wall: wall, ok: false, why: "range"))
        }
        self.sentry = d; self.saveSentry(); self.scheduleSentryWake()
        self.sentrySession = readConsole().session; self.watchSentry()
        log("Sentry restart: armed, the Mac restarts in \(RebootEngine.dur(secs)) unless Sentry mode is unlocked")
        answer(SentryRestart.reply(d, now: now, wall: wall))
      case .cancel:
        if self.sentry != nil { log("Sentry restart: cancelled (Sentry mode was unlocked)") }
        self.sentry = nil; self.saveSentry(); cancelAllWakes(id: SENTRY_WAKE_ID); self.watchSentry()
        answer(["ok": true])
      }
    }
  }

  // MARK: PS updated: run the new helper

  /// Every 30 s: has PS been updated (a new file at this helper's own path)? Once the new file has stayed
  /// the same for 30 s and is signed by PS's own key, save and exit: launchd (KeepAlive) starts the new
  /// copy at once, which picks up the saved state and wakes. Never while a restart is under way.
  func checkOwnFile() {
    guard let exe else { return }
    let now = continuousNow(), current = fileStamp(exe.path)
    // Not while Sentry mode keeps the lid closed Mac awake either: the new copy starts with it off.
    let busy = engine.attemptInFlight(now: now) || now < explicitUntil || lid.on
    switch ownFileStep(started: exe.stamp, current: current, seen: exeChanged, now: now, busy: busy, signed: { signedByPS(exe.path) }) {
    case .same: exeChanged = nil
    case .seen: exeChanged = current.map { ($0, now) }
    case .wait: break
    case .refused:
      if !exeRefusedLogged { exeRefusedLogged = true; log("the helper file was replaced by one not signed with PS's key: keeping this one running") }
    case .restart:
      log("PS was updated: restarting the helper so the new version runs")
      if let d = try? enc.encode(engine.state) { writeChecked(STATE, d) }
      exit(0)
    }
  }

  private func asked(restart: Bool, _ reason: String, _ reply: @escaping (Data) -> Void) {
    let now = continuousNow(), wall = wallNow(), verb = restart ? "restart" : "shut down"
    switch RebootEngine.command(restart: restart, reason: reason, uptime: now, sinceLast: now - lastAsked) {
    case .refuse(let no):
      log("\(verb) asked by PS: \(no.lowercased()) (\(String(reason.prefix(60))))")
      addHistory(HistoryEntry(at: wall, kind: "refused", text: "\(restart ? "Restart" : "Shut down") asked, not done: \(no.lowercased())"))
      let d = (try? JSONSerialization.data(withJSONObject: ["ok": false, "why": no])) ?? Data()
      reply(d)
    case .go(let why):
      lastAsked = now
      explicitUntil = now + 70                 // shutdown, then the kernel fallback at 60 s
      run(engine.explicitPower(restart: restart, now: now, wall: wall))
      log("\(verb) asked by PS: \(why)")
      addHistory(HistoryEntry(at: wall, kind: restart ? "remote" : "shutdown", text: "\(restart ? "Restarted" : "Shut down") at \(wallText(wall)): \(why)"))
      reply(Data("{\"ok\":true}".utf8))
      // A moment for the reply to reach PS, then go.
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { _ = powerOff(restart: restart, why: why); self.armFallback(restart: restart, automatic: false) }
    }
  }

}

#if !REBOOTD_TEST
@main enum Rebootd {
  static func main() {
    guard getuid() == 0 else { FileHandle.standardError.write(Data("rebootd runs only as a LaunchDaemon\n".utf8)); exit(1) }
    signal(SIGPIPE, SIG_IGN)
    let daemon = Daemon()
    daemon.start()
    withExtendedLifetime(daemon) { dispatchMain() }
  }
}
#endif
