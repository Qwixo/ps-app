// Offline test for Sources/SecureInputCore.swift (V1.41): who is named, when the card shows, its words. Asks macOS nothing.
//   mkdir -p build/secureinput && cp tests/secureinput-test.swift build/secureinput/main.swift && swiftc build/secureinput/main.swift Sources/SecureInputCore.swift Sources/Protected.swift -o build/secureinput/test && build/secureinput/test
import Foundation

var fails = 0
func check(_ name: String, _ ok: Bool) { print("\(name)=\(ok ? "ok" : "FAIL")"); if !ok { fails += 1 } }

let me: Int32 = 500
let lock = SecureHolder(pid: 416, bundleId: "com.apple.loginwindow", name: "loginwindow")
let lockNoId = SecureHolder(pid: 416, bundleId: nil, name: "loginwindow")
let claude = SecureHolder(pid: 49846, bundleId: "com.anthropic.claudefordesktop", name: "Claude")
let onePw = SecureHolder(pid: 700, bundleId: "com.1password.1password", name: nil)
let onePwHelper = SecureHolder(pid: 701, bundleId: nil, name: "1Password Browser Helper")
let signal = SecureHolder(pid: 702, bundleId: "org.whispersystems.signal-desktop", name: nil)
let safari = SecureHolder(pid: 800, bundleId: "com.apple.Safari", name: "Safari")

// Names
check("lock-screen", SecureInputCore.label(lock, me: me, appName: "PS") == "the lock screen")
check("lock-screen-by-process-name", SecureInputCore.label(lockNoId, me: me, appName: "PS") == "the lock screen")
check("app-by-name", SecureInputCore.label(claude, me: me, appName: "PS") == "Claude")
check("1password-never-named", SecureInputCore.label(onePw, me: me, appName: "PS") == "a password app")
check("1password-helper-never-named", SecureInputCore.label(onePwHelper, me: me, appName: "PS") == "a password app")
check("signal-never-named", SecureInputCore.label(signal, me: me, appName: "PS") == "a password app")
check("ps-itself", SecureInputCore.label(SecureHolder(pid: me, bundleId: "com.cincee.ps", name: "PS"), me: me, appName: "PS") == "PS")
check("unknown", SecureInputCore.label(nil, me: me, appName: "PS") == "another app")
check("blank-name", SecureInputCore.label(SecureHolder(pid: 9, bundleId: nil, name: "  "), me: me, appName: "PS") == "another app")
check("long-name-cut", SecureInputCore.label(SecureHolder(pid: 9, bundleId: nil, name: String(repeating: "a", count: 90)), me: me, appName: "PS").count == 40)

// When it is stuck
check("off-never", !SecureInputCore.stuck(on: false, holders: [lock], frontPid: nil).stuck)
check("password-box-in-front-is-normal", !SecureInputCore.stuck(on: true, holders: [safari], frontPid: 800).stuck)
check("background-holder-is-stuck", SecureInputCore.stuck(on: true, holders: [claude], frontPid: 800).holder == claude)
check("lock-screen-wins", SecureInputCore.stuck(on: true, holders: [claude, lock], frontPid: 800).holder == lock)
check("any-holder-in-front-is-normal", !SecureInputCore.stuck(on: true, holders: [claude, lock], frontPid: 49846).stuck)
check("on-no-holder-is-stuck", SecureInputCore.stuck(on: true, holders: [], frontPid: 800) == (true, nil))
check("front-plus-background-is-normal", !SecureInputCore.stuck(on: true, holders: [safari, claude], frontPid: 800).stuck)
check("lock-screen-from-another-app", SecureInputCore.stuck(on: true, holders: [claude, lock], frontPid: 800).holder == lock)

// Debounce: 6 s without a break
var d = SecureDebounce()
let t0 = Date(timeIntervalSince1970: 1000)
check("not-at-once", !d.step(stuck: true, now: t0, after: 6))
check("not-at-5s", !d.step(stuck: true, now: t0 + 5, after: 6))
check("at-6s", d.step(stuck: true, now: t0 + 6, after: 6))
check("break-clears", !d.step(stuck: false, now: t0 + 7, after: 6))
check("starts-over", !d.step(stuck: true, now: t0 + 8, after: 6) && d.step(stuck: true, now: t0 + 14, after: 6))

// Words: plain, the fix, no dashes, no protected names
let words = ["the lock screen", "a password app", "another app", "Claude"].map { SecureInputCore.notice(label: $0, appName: "PS") }
check("fix-in-every-one", words.allSatisfy { $0.contains("Control Command Q") && $0.contains("typing your password") })
check("names-the-app", words[3].contains("Quit Claude"))
check("no-dashes", words.allSatisfy { !$0.contains("\u{2014}") && !$0.contains("\u{2013}") && !$0.contains(" - ") })
check("no-protected-names", words.allSatisfy { !$0.lowercased().contains("1password") && !$0.lowercased().contains("signal") })
check("log-line", SecureInputCore.logOn("the lock screen") == "PS tab: macOS Secure Input is on, held by the lock screen")
print(words.joined(separator: "\n"))
print(fails == 0 ? "SECURE INPUT: 0 FAIL" : "SECURE INPUT: \(fails) FAIL")
exit(fails == 0 ? 0 : 1)
