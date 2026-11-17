import Foundation
// Run: bash tests/activity-test.sh. The Activity monitor's rules (Sources/ActivityCore.swift). The web half (sorting, heat,
// the End task steps on screen, App history sums) is web/tests/activitymon.test.ts.
var n = 0, bad = 0
func ok(_ name: String, _ c: Bool) { n += 1; if c { print("ok - \(name)") } else { bad += 1; print("FAIL - \(name)") } }
func near(_ a: Double, _ b: Double, _ e: Double = 0.01) -> Bool { abs(a - b) <= e }
typealias T = ActivityCore.Ticks

// CPU percent from two samples
let a = T(user: 100, system: 50, idle: 850, nice: 0), b = T(user: 160, system: 70, idle: 870, nice: 0)
ok("a core busy 80 of 100 ticks is 80%", near(ActivityCore.corePercent(a, b), 80))
ok("no time passed is 0%, never a divide by zero", ActivityCore.corePercent(a, a) == 0)
ok("a counter that went backwards is 0%, never a spike", ActivityCore.corePercent(b, a) == 0)
ok("all idle is 0%", ActivityCore.corePercent(T(user: 1, system: 1, idle: 1, nice: 0), T(user: 1, system: 1, idle: 101, nice: 0)) == 0)
ok("nice counts as busy", near(ActivityCore.corePercent(T(user: 0, system: 0, idle: 0, nice: 0), T(user: 0, system: 0, idle: 50, nice: 50)), 50))
let all = ActivityCore.overall([a, a], [b, T(user: 100, system: 50, idle: 950, nice: 0)])
ok("the whole Mac: one core at 80, one idle is 40%", near(all.total, 40))
ok("user and system add up to the total", near(all.user + all.system, all.total))
ok("mismatched core lists read as 0", ActivityCore.overall([a], [a, b]).total == 0)
ok("mach ticks become nanoseconds (Apple silicon 125/3)", near(ActivityCore.machNs(24, numer: 125, denom: 3), 1000))
// a process used 0.5 s of CPU in 1 s on a 10 core Mac: 5% of the whole Mac
let half = UInt64(0.5e9 * 3 / 125)
ok("half a second of CPU in a second on 10 cores is 5%", near(ActivityCore.processPercent(cpuA: 0, cpuB: half, wallNs: 1e9, cores: 10, numer: 125, denom: 3), 5, 0.001))
ok("on an Intel timebase (1/1) the same works", near(ActivityCore.processPercent(cpuA: 1_000, cpuB: 1_000 + 500_000_000, wallNs: 1e9, cores: 1, numer: 1, denom: 1), 50))
ok("a process that restarted (time went down) is 0%", ActivityCore.processPercent(cpuA: 50, cpuB: 10, wallNs: 1e9, cores: 4, numer: 1, denom: 1) == 0)
ok("never above 100%", ActivityCore.processPercent(cpuA: 0, cpuB: 10_000_000_000, wallNs: 1e9, cores: 1, numer: 1, denom: 1) == 100)
ok("10 cores, 4 performance: 6 efficiency first", ActivityCore.coreKinds(total: 10, performance: 4, efficiency: 6) == ["e", "e", "e", "e", "e", "e", "p", "p", "p", "p"])
ok("cores macOS does not split: no labels", ActivityCore.coreKinds(total: 8, performance: 0, efficiency: 0) == Array(repeating: "", count: 8))
ok("counts that do not add up: no labels", ActivityCore.coreKinds(total: 8, performance: 4, efficiency: 2).allSatisfy { $0.isEmpty })

// memory maths (16 KB pages)
let P: UInt64 = 16_384, GB: UInt64 = 1 << 30
var vm = ActivityCore.VM(pageSize: P)
vm.internalPages = 6 * GB / P + 1000; vm.purgeable = 1000; vm.wired = 2 * GB / P; vm.compressor = GB / P; vm.external = 3 * GB / P; vm.free = GB / P
let m = ActivityCore.memory(vm, total: 16 * GB, swapUsed: GB / 2, swapTotal: 2 * GB, pressureLevel: 1)
ok("app memory leaves out what can be purged", m.app == 6 * GB)
ok("used is app + wired + compressed", m.used == 9 * GB)
ok("cached files are file pages plus purgeable", m.cached == 3 * GB + 1000 * P)
ok("free is what is left", m.free == 16 * GB - 9 * GB - (3 * GB + 1000 * P))
ok("used + cached + free is the total", m.used + m.cached + m.free == m.total)
ok("swap carried through", m.swapUsed == GB / 2 && m.swapTotal == 2 * GB)
ok("pressure 1 is normal, 2 warn, 4 critical", ActivityCore.pressureWord(1) == "normal" && ActivityCore.pressureWord(2) == "warn" && ActivityCore.pressureWord(4) == "critical")
ok("an unknown pressure level reads as normal", ActivityCore.pressureWord(0) == "normal" && ActivityCore.pressureWord(9) == "normal")
var big = vm; big.wired = 20 * GB / P
let mb = ActivityCore.memory(big, total: 16 * GB, swapUsed: 0, swapTotal: 0, pressureLevel: 4)
ok("used never goes past the total, free never below 0", mb.used == 16 * GB && mb.free == 0 && mb.cached == 0 && mb.pressure == "critical")
var odd = vm; odd.purgeable = odd.internalPages + 5
ok("more purgeable than anonymous pages: app memory 0, not a wrap", ActivityCore.memory(odd, total: 16 * GB, swapUsed: 0, swapTotal: 0, pressureLevel: 1).app == 0)

// disk and battery
ok("disk busy 250 ms in 1 s is 25%", near(ActivityCore.diskActive(busyNsA: 0, busyNsB: 250_000_000, wallNs: 1e9)!, 25))
ok("no busy time from the driver: nil", ActivityCore.diskActive(busyNsA: nil, busyNsB: 5, wallNs: 1e9) == nil)
ok("busy time never above 100%", ActivityCore.diskActive(busyNsA: 0, busyNsB: 9_000_000_000, wallNs: 1e9) == 100)
ok("bytes per second", ActivityCore.rate(1000, 3000, seconds: 2) == 1000 && ActivityCore.rate(3000, 1000, seconds: 2) == 0)
ok("battery health 5534 of 5760 is 96%", ActivityCore.batteryHealth(rawMax: 5534, design: 5760) == 96)
ok("battery health unknown without a design capacity", ActivityCore.batteryHealth(rawMax: 5534, design: 0) == nil && ActivityCore.batteryHealth(rawMax: nil, design: 5760) == nil)
ok("11.532 V at -1.157 A is about 13.3 W", near(ActivityCore.watts(mV: 11532, mA: -1157)!, 13.34, 0.01))
ok("no current: no watts", ActivityCore.watts(mV: 11532, mA: 0) == nil)
ok("time left -1 (still working it out) shows nothing", ActivityCore.minutes(-1) == nil && ActivityCore.minutes(65) == 65 && ActivityCore.minutes(65535) == nil)

// the golden rule
ok("1Password by name", ActivityCore.isProtected(name: "1Password", path: nil))
ok("1Password's helper by path", ActivityCore.isProtected(name: "helper", path: "/Applications/1Password.app/Contents/Library/LoginItems/1Password Launcher.app/Contents/MacOS/1Password Launcher"))
ok("Signal by name and by bundle", ActivityCore.isProtected(name: "Signal", path: nil) && ActivityCore.isProtected(name: "x", path: nil, bundles: ["org.whispersystems.signal-desktop"]))
ok("Signal Helper (Renderer) by path", ActivityCore.isProtected(name: "Signal Helper (Renderer)", path: "/Applications/Signal.app/Contents/Frameworks/Signal Helper (Renderer).app/Contents/MacOS/Signal Helper (Renderer)"))
ok("agilebits ids", ActivityCore.isProtected(name: "x", path: nil, bundles: ["com.agilebits.onepassword7"]))
ok("an ordinary app is not", !ActivityCore.isProtected(name: "Sample Browser", path: "/Applications/Sample Browser.app/Contents/MacOS/Sample Browser", bundles: ["com.example.browser"]))
typealias PR = ActivityCore.Proc
let me: UInt32 = 501
let list = [PR(pid: 10, ppid: 1, rpid: 10, uid: me, name: "Sample Browser", path: "/Applications/Sample Browser.app/Contents/MacOS/Sample Browser", bundles: ["com.example.browser"], appPath: "/Applications/Sample Browser.app", regular: true),
            PR(pid: 11, ppid: 10, rpid: 10, uid: me, name: "Sample Browser Helper", path: "/Applications/Sample Browser.app/Contents/Frameworks/H.app/Contents/MacOS/H", bundles: ["com.example.browser", "com.example.browser.helper"], appPath: "/Applications/Sample Browser.app"),
            PR(pid: 20, ppid: 1, rpid: 20, uid: me, name: "1Password", path: "/Applications/1Password.app/Contents/MacOS/1Password", bundles: ["com.1password.1password"], appPath: "/Applications/1Password.app", regular: true),
            PR(pid: 21, ppid: 20, rpid: 20, uid: me, name: "crashpad_handler", path: "/opt/x/crashpad_handler"),
            PR(pid: 22, ppid: 1, rpid: 23, uid: me, name: "renderer", path: "/opt/y/renderer"),
            PR(pid: 30, ppid: 1, rpid: 30, uid: 0, name: "rootd", path: "/usr/libexec/rootd"),
            PR(pid: 40, ppid: 1, rpid: 40, uid: me, name: "syncagent", path: "/opt/sample/bin/syncagent")]
let kept = ActivityCore.keep(list, myUid: me, protectedPids: [23])
ok("1Password itself is dropped", !kept.contains { $0.pid == 20 })
ok("a helper whose parent is 1Password is dropped too", !kept.contains { $0.pid == 21 })
ok("a process macOS holds 1Password (or Signal) responsible for is dropped", !kept.contains { $0.pid == 22 })
ok("another user's process is left out", !kept.contains { $0.pid == 30 })
ok("the person's own apps and background processes stay", Set(kept.map(\.pid)) == [10, 11, 40])
ok("no name of a protected app survives the read", !kept.contains { ActivityCore.isProtected(name: $0.name, path: $0.path, bundles: $0.bundles) })

// grouping helpers under their app
let g = ActivityCore.groups(kept + [PR(pid: 12, ppid: 11, rpid: 12, uid: me, name: "gpu", path: "/opt/z/gpu"),
                                    PR(pid: 13, ppid: 1, rpid: 13, uid: me, name: "Sample Browser Updater", path: "/Applications/Sample Browser.app/Contents/Updater", appPath: "/Applications/Sample Browser.app")])
ok("a helper folds under the app macOS holds responsible", g[11] == 10)
ok("a child of a helper folds under the app (parent walk)", g[12] == 10)
ok("a program inside the app's bundle folds under the app", g[13] == 10)
ok("the app itself is a row of its own", g[10] == nil)
ok("a background process with no app is a row of its own", g[40] == nil)
let loop = ActivityCore.groups([PR(pid: 50, ppid: 51, rpid: 50, uid: me, name: "a", path: nil), PR(pid: 51, ppid: 50, rpid: 51, uid: me, name: "b", path: nil)])
ok("a parent loop ends, nothing hangs", loop.isEmpty)
let twoCopies = ActivityCore.groups([PR(pid: 70, ppid: 1, rpid: 70, uid: me, name: "App", path: "/Applications/A.app/Contents/MacOS/A", appPath: "/Applications/A.app", regular: true),
                                     PR(pid: 71, ppid: 1, rpid: 71, uid: me, name: "App", path: "/Applications/A.app/Contents/MacOS/A", appPath: "/Applications/A.app", regular: true)])
ok("two copies of one app are two rows", twoCopies.isEmpty)

// End task rules
func facts(_ pid: Int32, uid: UInt32 = me, path: String?, bundle: String? = nil, name: String = "x", top: Int32? = nil) -> ActivityCore.EndFacts {
  ActivityCore.EndFacts(pid: pid, uid: uid, myUid: me, myPid: 900, path: path, bundle: bundle, name: name, groupTop: top, psBundlePath: "/Applications/PS.app", psBundleId: "com.cincee.ps")
}
ok("an ordinary app can be ended", ActivityCore.canEnd(facts(10, path: "/Applications/Sample Browser.app/Contents/MacOS/Sample Browser", bundle: "com.example.browser")))
ok("an app's helper can be ended", ActivityCore.canEnd(facts(11, path: "/Applications/Sample Browser.app/Contents/Frameworks/H.app/Contents/MacOS/H", top: 10)))
ok("a background program of the person's own can be ended", ActivityCore.canEnd(facts(40, path: "/opt/sample/bin/syncagent")))
ok("never PS itself", !ActivityCore.canEnd(facts(900, path: "/Applications/PS.app/Contents/MacOS/PS", bundle: "com.cincee.ps")))
ok("never a helper inside PS's bundle", !ActivityCore.canEnd(facts(901, path: "/Applications/PS.app/Contents/Library/Helpers/ps-helper")))
ok("never a test copy of PS (its bundle id)", !ActivityCore.canEnd(facts(902, path: "/tmp/other/PS.app/Contents/MacOS/PS", bundle: "com.cincee.ps.selftest")))
ok("never anything that folds under PS (its web pages)", !ActivityCore.canEnd(facts(903, path: "/opt/x/web", top: 900)))
ok("never another user's process", !ActivityCore.canEnd(facts(30, uid: 0, path: "/opt/rootd")))
ok("never pid 0 or 1", !ActivityCore.canEnd(facts(1, path: "/sbin/launchd")) && !ActivityCore.canEnd(facts(0, path: "/x")))
ok("never macOS's own (Finder, Dock)", !ActivityCore.canEnd(facts(60, path: "/System/Library/CoreServices/Finder.app/Contents/MacOS/Finder", bundle: "com.apple.finder")))
ok("never a system program", !ActivityCore.canEnd(facts(61, path: "/usr/libexec/trustd")) && !ActivityCore.canEnd(facts(62, path: "/usr/sbin/cfprefsd")))
ok("an Apple app in /Applications can be ended", ActivityCore.canEnd(facts(63, path: "/Applications/Pages.app/Contents/MacOS/Pages", bundle: "com.apple.iWork.Pages")))
ok("a process whose path macOS hides is not ended", !ActivityCore.canEnd(facts(64, path: nil)))
ok("never 1Password or Signal", !ActivityCore.canEnd(facts(20, path: "/Applications/1Password.app/Contents/MacOS/1Password")) && !ActivityCore.canEnd(facts(24, path: "/opt/s", name: "Signal")))
ok("a PS lookalike name elsewhere is fine", ActivityCore.canEnd(facts(65, path: "/Applications/PS Remote.app/Contents/MacOS/PS Remote", bundle: "com.example.psremote")))
ok("the two steps", ActivityCore.endStep("quit") == .quit && ActivityCore.endStep("force") == .force && ActivityCore.endStep("kill") == nil && ActivityCore.endStep(nil) == nil)

// speeds
ok("half a second, one and two seconds are allowed", ActivityCore.cleanSpeed(0.5) == 0.5 && ActivityCore.cleanSpeed(1) == 1 && ActivityCore.cleanSpeed(2) == 2)
ok("anything else is one second", ActivityCore.cleanSpeed(0.01) == 1 && ActivityCore.cleanSpeed("fast") == 1 && ActivityCore.cleanSpeed(nil) == 1)

// startup items
let la = ActivityCore.launchAgent(["Label": "com.example.sync", "ProgramArguments": ["/Applications/Sample Sync.app/Contents/MacOS/sync", "--bg"], "RunAtLoad": true], file: "com.example.sync.plist", folder: "user")
ok("a launch agent reads its label and program", la?.label == "com.example.sync" && la?.program == "/Applications/Sample Sync.app/Contents/MacOS/sync" && la?.runAtLoad == true)
ok("KeepAlive as a dictionary counts as kept alive", ActivityCore.launchAgent(["Label": "a", "Program": "/x", "KeepAlive": ["SuccessfulExit": false]], file: "a.plist", folder: "user")?.keepAlive == true)
ok("1Password's launch agent never reaches the list", ActivityCore.launchAgent(["Label": "com.1password.helper", "Program": "/x"], file: "com.1password.helper.plist", folder: "user") == nil)
ok("Signal's by program path", ActivityCore.launchAgent(["Label": "x.y", "Program": "/Applications/Signal.app/Contents/MacOS/Signal"], file: "x.y.plist", folder: "user") == nil)
ok("a launch agent with no label uses its file name", ActivityCore.launchAgent(["Program": "/opt/x"], file: "org.example.thing.plist", folder: "mac")?.label == "org.example.thing")
ok("the app a program lives in", ActivityCore.appOf("/Applications/Sample Sync.app/Contents/MacOS/sync") == "/Applications/Sample Sync.app" && ActivityCore.appOf("/usr/local/bin/x") == nil)

// app history
var h = ActivityCore.History()
ActivityCore.add(&h, day: "2026-11-17", key: "com.example.browser", name: "Sample Browser", secs: 30)
ActivityCore.add(&h, day: "2026-11-17", key: "com.example.browser", name: "Sample Browser", secs: 12.5)
ActivityCore.add(&h, day: "2026-11-17", key: "com.1password.1password", name: "1Password", secs: 99)
ActivityCore.add(&h, day: "2026-11-17", key: "x", name: "Signal", secs: 99)
ActivityCore.add(&h, day: "2026-11-17", key: "y", name: "Y", secs: -3)
ok("CPU seconds add up per app per day", h["2026-11-17"]?["com.example.browser"]?.secs == 42.5)
ok("1Password and Signal never get into the history", h["2026-11-17"]?.count == 1)
ok("old days are trimmed", ActivityCore.trim(["2026-11-01": [:], "2026-11-17": [:]], keep: ["2026-11-17"]).keys.sorted() == ["2026-11-17"])

// the island readout and the made up numbers
ok("the readout rounds", ActivityCore.readout(cpu: 23.4, used: 9 * GB, total: 16 * GB) == ("23%", "56%"))
ok("the readout never shows nonsense", ActivityCore.readout(cpu: 180, used: 1, total: 0) == ("100%", "0%"))
let f = ActivityCore.fake(t: 12)
let names = ((f["meta"] as? [String: [String: Any]]) ?? [:]).values.compactMap { $0["n"] as? String }
ok("the self test numbers are made up and marked so", f["fake"] as? Bool == true && names.allSatisfy { $0.hasPrefix("Sample") || !$0.contains(" ") })
ok("the made up numbers hold no protected app", !names.contains { ActivityCore.isProtected(name: $0, path: nil) })
ok("the made up numbers can be sent to the page", JSONSerialization.isValidJSONObject(f))

print("\(n - bad) of \(n) passed")
exit(bad == 0 ? 0 : 1)
