// rebootd's glue without root (tests/rebootd-io-test.sh): checksum files, the console, the clocks,
// and reading (never changing) the scheduled wakes. Compiled with -D REBOOTD_TEST so main() is left out.
import Foundation

@main enum IOTest {
  static func main() {
    var fails = 0
    func check(_ ok: Bool, _ what: String) { if !ok { fails += 1; print("FAIL: \(what)") } }
    let dir = NSTemporaryDirectory() + "rebootd-io-\(getpid())"
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(atPath: dir) }
    let f = dir + "/state.json"

    // Round trip, damage, hand edits, empty and missing files.
    let st = RebootState(boot: "b", seenUnlock: true, lastUnlocked: 12.5, periodMinutes: 720)
    writeChecked(f, try! enc.encode(st))
    check(readChecked(f).flatMap { try? JSONDecoder().decode(RebootState.self, from: $0) } == st, "round trip")
    let attrs = try? FileManager.default.attributesOfItem(atPath: f)
    check((attrs?[.posixPermissions] as? Int) == 0o600, "file is 0600")
    var bytes = FileManager.default.contents(atPath: f)!
    bytes[5] ^= 0x01; FileManager.default.createFile(atPath: f, contents: bytes)
    check(readChecked(f) == nil, "one flipped bit is refused")
    let edited = String(data: try! enc.encode(st), encoding: .utf8)!.replacingOccurrences(of: "720", with: "60")
    FileManager.default.createFile(atPath: f, contents: Data((edited + "\nffff\n").utf8))
    check(readChecked(f) == nil, "hand edit with a wrong sum is refused")
    FileManager.default.createFile(atPath: f, contents: Data())
    check(readChecked(f) == nil, "empty file refused")
    check(readChecked(dir + "/none.json") == nil, "missing file is nil")
    let multi = Data("{\n\"a\": 1\n}".utf8); writeChecked(f, multi)
    check(readChecked(f) == multi, "a body with newlines survives")
    FileManager.default.createFile(atPath: f, contents: Data("{\"v\":1}".utf8))
    check(readChecked(f) == nil, "no sum line refused")

    // V1.28: rebootd's own record of a sign in during this boot, the hard guard against a boot loop (the developer).
    let si = dir + "/signin"
    check(!signInSeen(boot: "boot-A", path: si), "no record: no sign in (Before First Unlock)")
    writeChecked(si, Data("boot-A".utf8))
    check(signInSeen(boot: "boot-A", path: si), "this boot's record: signed in")
    check(!signInSeen(boot: "boot-B", path: si), "an earlier boot's record: not signed in in this one")
    var sb = FileManager.default.contents(atPath: si)!; sb[1] ^= 1; FileManager.default.createFile(atPath: si, contents: sb)
    check(!signInSeen(boot: "boot-A", path: si), "a damaged record: not signed in")
    // The lock periods file, written exactly as addPeriod writes it.
    let pf = dir + "/periods.json"
    let pl = [LockPeriod(lockedAt: 1_793_000_000, endedAt: 1_793_003_600, ran: 3600, end: "unlock", postponed: nil, would: nil),
              LockPeriod(lockedAt: 1_793_010_000, endedAt: 1_793_053_200, ran: 43_200, end: "timer", postponed: 3600, would: nil)]
    writeChecked(pf, try! enc.encode(pl))
    check(readChecked(pf).flatMap { try? JSONDecoder().decode([LockPeriod].self, from: $0) } == pl, "lock periods round trip")

    // V1.28: the helper notices PS was updated (its own file replaced) and restarts only when it is safe.
    let me = ownPath()
    check(me != nil && FileManager.default.fileExists(atPath: me!), "own path is this running file")
    let ex = dir + "/rebootd"
    FileManager.default.createFile(atPath: ex, contents: Data("old".utf8))
    let a = fileStamp(ex)!
    check(fileStamp(ex) == a, "same file, same stamp")
    let tmp = dir + "/rebootd.new"; FileManager.default.createFile(atPath: tmp, contents: Data("new!".utf8)); rename(tmp, ex)
    let b = fileStamp(ex)!
    check(b != a, "a replaced file has a new stamp")
    check(fileStamp(dir + "/missing") == nil, "missing file: no stamp")
    check(ownFileStep(started: a, current: a, seen: nil, now: 100, busy: false, signed: { true }) == .same, "unchanged: same")
    check(ownFileStep(started: a, current: nil, seen: nil, now: 100, busy: false, signed: { true }) == .same, "missing for now (an update in progress): same")
    check(ownFileStep(started: a, current: b, seen: nil, now: 100, busy: false, signed: { true }) == .seen, "new file: the 30 s clock starts")
    check(ownFileStep(started: a, current: b, seen: (b, 100), now: 120, busy: false, signed: { true }) == .wait, "20 s: waits")
    check(ownFileStep(started: a, current: [9], seen: (b, 100), now: 140, busy: false, signed: { true }) == .seen, "still changing: the clock starts again")
    check(ownFileStep(started: a, current: b, seen: (b, 100), now: 131, busy: true, signed: { true }) == .wait, "a restart under way: waits")
    check(ownFileStep(started: a, current: b, seen: (b, 100), now: 131, busy: false, signed: { false }) == .refused, "not signed by PS: keeps running")
    check(ownFileStep(started: a, current: b, seen: (b, 100), now: 131, busy: false, signed: { true }) == .restart, "30 s unchanged and signed: restart")
    check(!signedByPS(ex), "a file that is not a signed helper never counts as PS's")
    if let me { check(!signedByPS(me), "this test binary (not signed with PS's key) never counts as PS's") }

    // The "tried in this boot" marker, written exactly as run(.markTried) writes it and read as start() reads it.
    let marker = dir + "/tried"
    check(!readTried(boot: "boot-A", path: marker), "no marker: not tried")
    writeChecked(marker, Data("boot-A".utf8))
    check(readTried(boot: "boot-A", path: marker), "marker of this boot reads back as tried")
    check(!readTried(boot: "boot-B", path: marker), "marker of an earlier boot: not tried")
    var mb = FileManager.default.contents(atPath: marker)!; mb[2] ^= 1; FileManager.default.createFile(atPath: marker, contents: mb)
    check(readTried(boot: "boot-A", path: marker), "a damaged marker counts as tried in this boot (never a second restart)")
    check(readChecked(marker).flatMap { String(data: $0, encoding: .utf8) } == "boot-A", "and is rewritten with this boot's id")
    check(!readTried(boot: "boot-B", path: marker), "so the next boot arms again (damage costs one boot at most)")

    // Automatic login, read from loginwindow's preferences the way rebootd reads them.
    let plist = dir + "/loginwindow.plist"
    check(autoLoginUser(path: plist) == nil, "no preferences file: no automatic login")
    (["autoLoginUser": "someone", "GuestEnabled": false] as NSDictionary).write(toFile: plist, atomically: true)
    check(autoLoginUser(path: plist) == "someone", "automatic login user read")
    (["autoLoginUser": ""] as NSDictionary).write(toFile: plist, atomically: true)
    check(autoLoginUser(path: plist) == nil, "an empty name is no automatic login")
    check(autoLoginUser() == nil, "this Mac has no automatic login (real file)")

    // Clocks: continuous time counts sleep, so it is never behind uptime and is close to boot time.
    let cont = continuousNow(), up = ProcessInfo.processInfo.systemUptime
    check(cont + 1 >= up, "continuous time (\(cont)) not behind uptime (\(up))")
    let sinceBoot = Date().timeIntervalSince1970 - bootedAt()
    check(abs(sinceBoot - cont) < 120, "continuous time matches wall time since boot (\(sinceBoot) vs \(cont))")
    check(!sysctlString("kern.bootsessionuuid").isEmpty, "boot session id")

    // The console and the wake list are readable without root; nothing is changed.
    let c = readConsole()
    print("console now: \(c.session.rawValue), login done \(c.loginDone); our wakes: \(ourWakes().count); booted \(wallText(bootedAt()))")
    check(c.loginDone, "someone is logged in on this Mac")
    check(consoleUID() == getuid(), "the console user is this user (XPC callers are checked against it)")
    check(!safeBoot(), "not in Safe Mode now (kern.safeboot reads 0)")
    // Lid keep awake (V1.53): the clamshell switch is there and open to the helper's call, checked without changing
    // it: no inputs, so the kernel refuses it by its argument count (kIOReturnBadArgument) before doing anything.
    // applyLid is never called here.
    let probe = callClamshellSwitch([])
    check(probe == Int32(bitPattern: 0xe00002c2), "the clamshell switch answers (refused by argument count only: \(LidIO.describe(probe)))")
    let lp = readLidPower()
    check((0...3).contains(lp.thermal), "thermal state read as 0 to 3")
    check(lp.percent.map { (0...100).contains($0) } ?? true, "battery percent, when there is one, is 0 to 100")
    check(!lp.onBattery || lp.percent != nil, "on battery power the level is known")
    print("lid keep awake reads now: clamshell switch probe \(LidIO.describe(probe)), on battery \(lp.onBattery), battery \(lp.percent.map { "\($0)%" } ?? "none"), thermal \(lp.thermal)")

    print(fails == 0 ? "REBOOTD IO: all checks passed" : "REBOOTD IO: \(fails) FAILED")
    exit(fails == 0 ? 0 : 1)
  }
}
