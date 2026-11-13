// Offline test for Sources/TabHealthCore.swift (V1.41): when the tap counts as deaf, and which notice the card shows.
//   mkdir -p build/tabhealth && cp tests/tabhealth-test.swift build/tabhealth/main.swift && swiftc build/tabhealth/main.swift Sources/TabHealthCore.swift -o build/tabhealth/test && build/tabhealth/test
import Foundation

var fails = 0
func check(_ name: String, _ ok: Bool) { print("\(name)=\(ok ? "ok" : "FAIL")"); if !ok { fails += 1 } }
func deaf(_ sys: Double, _ tap: Double, _ settled: Double, console: Bool = true, secure: Bool = false) -> Bool {
  TabHealth.deaf(systemKeyAgo: sys, tapKeyAgo: tap, settledFor: settled, onConsole: console, secureInput: secure)
}

// Deaf only when typing goes on and the tap has heard nothing for 20 s, settled, at the screen, no Secure Input.
check("deaf", deaf(1, 25, 60))
check("not-while-tap-hears", !deaf(1, 2, 60))
check("not-when-nobody-types", !deaf(30, 300, 600))
check("not-right-after-install-or-protected", !deaf(1, 25, 10))
check("not-in-another-session", !deaf(1, 25, 60, console: false))
check("not-during-secure-input", !deaf(1, 25, 60, secure: true))
check("not-at-20s-exactly", !deaf(1, 20, 60))

// Which notice, worst first
let none = TabHealth.notice(tabOn: true, trusted: true, secureNote: nil, deaf: false, appName: "PS", keyName: "Tab")
check("fine-no-notice", none == nil)
check("off-no-notice", TabHealth.notice(tabOn: false, trusted: false, secureNote: "x", deaf: true, appName: "PS", keyName: "Tab") == nil)
let untrusted = TabHealth.notice(tabOn: true, trusted: false, secureNote: "x", deaf: true, appName: "PS", keyName: "Tab")
check("untrusted-first", untrusted?.action == "fix" && untrusted?.button == "Open settings" && untrusted!.text.contains("Accessibility"))
check("untrusted-steps", untrusted!.text.contains("switch it off and on"))
let secure = TabHealth.notice(tabOn: true, trusted: true, secureNote: "macOS has paused keys", deaf: true, appName: "PS", keyName: "Tab")
check("secure-before-deaf", secure?.text == "macOS has paused keys" && secure?.button == nil)
let d = TabHealth.notice(tabOn: true, trusted: true, secureNote: nil, deaf: true, appName: "PS", keyName: "Right Option")
check("deaf-notice", d?.action == "fix" && d!.text.contains("holding Right Option does nothing"))
let all = [untrusted!.text, d!.text]
check("no-dashes", all.allSatisfy { !$0.contains("\u{2014}") && !$0.contains("\u{2013}") && !$0.contains(" - ") })
check("app-name-used", TabHealth.notice(tabOn: true, trusted: false, secureNote: nil, deaf: false, appName: "Focus", keyName: "Tab")!.text.contains("switch Focus on"))
print(all.joined(separator: "\n"))
print(fails == 0 ? "TAB HEALTH: 0 FAIL" : "TAB HEALTH: \(fails) FAIL")
exit(fails == 0 ? 0 : 1)
