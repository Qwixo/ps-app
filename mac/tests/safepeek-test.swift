// Offline test for Sources/SafePeekCore.swift (V1.44, the developer: "open on ANY app, even 1Password and Signal on the PUBLIC
// release"): when the plain Tab hotkey arms, what a hold does, and that a quick tap is never sent into 1Password or
// Signal. Asks macOS nothing, registers no hotkey, sends no key.
//   mkdir -p build/safepeek && cp tests/safepeek-test.swift build/safepeek/main.swift && swiftc build/safepeek/main.swift Sources/SafePeekCore.swift -o build/safepeek/test && build/safepeek/test
import Foundation

var fails = 0
func check(_ name: String, _ ok: Bool) { print("\(name)=\(ok ? "ok" : "FAIL")"); if !ok { fails += 1 } }
typealias C = SafePeekCore
func want(_ f: (inout C.Inputs) -> Void) -> Bool { var i = C.Inputs(); f(&i); return C.wantTab(i) }

// Over 1Password or Signal (the keyboard tap is off there): armed, whatever else is going on.
check("protected-armed", want { $0.protectedFront = true })
check("protected-armed-right-option", want { $0.protectedFront = true; $0.triggerKey = "rightOption" })
check("protected-armed-any-key-name", want { $0.protectedFront = true; $0.triggerKey = "somethingNew" })
check("protected-armed-even-if-ignore-listed", want { $0.protectedFront = true; $0.frontIgnored = true })
check("protected-armed-with-ps-active", want { $0.protectedFront = true; $0.appActive = true })
// The Inputs have no "unlocked" at all: locked or signed out never disarms it (the friend's silent Tab).
check("protected-off-when-tab-switched-off", !want { $0.protectedFront = true; $0.enabled = false })
check("protected-off-when-kept", !want { $0.protectedFront = true; $0.kept = true })
check("protected-off-when-typing-in-list", !want { $0.protectedFront = true; $0.editing = true })
check("protected-off-while-passing-on", !want { $0.protectedFront = true; $0.passingOn = true })

// A normal app with the tap working: never armed (the tap has Tab).
check("normal-off", !want { _ in })
check("normal-off-right-option", !want { $0.triggerKey = "rightOption" })
check("held-stays-armed", want { $0.held = true })
check("held-stays-armed-even-switched-off", want { $0.held = true; $0.enabled = false })

// Secure Input stuck on in the background: armed over normal apps.
check("secure-armed", want { $0.secureStuck = true })
check("secure-armed-right-option", want { $0.secureStuck = true; $0.triggerKey = "rightOption" })
check("secure-off-ps-sign-in", !want { $0.secureStuck = true; $0.appActive = true })
check("secure-off-ignore-listed", !want { $0.secureStuck = true; $0.frontIgnored = true })
check("secure-off-switched-off", !want { $0.secureStuck = true; $0.enabled = false })
check("secure-off-kept", !want { $0.secureStuck = true; $0.kept = true })
check("secure-off-editing", !want { $0.secureStuck = true; $0.editing = true })
check("secure-off-while-passing-on", !want { $0.secureStuck = true; $0.passingOn = true })
check("secure-and-protected-protected-wins", C.blind(protectedFront: true, secureStuck: true) == .protected)
check("blind-none", C.blind(protectedFront: false, secureStuck: false) == nil)

// Esc: only while the list is up and the tap cannot see it.
check("esc-protected-shown", C.wantEsc(protectedFront: true, secureStuck: false, shown: true))
check("esc-secure-shown", C.wantEsc(protectedFront: false, secureStuck: true, shown: true))
check("esc-not-hidden", !C.wantEsc(protectedFront: true, secureStuck: true, shown: false))
check("esc-not-normal", !C.wantEsc(protectedFront: false, secureStuck: false, shown: true))

// A hold: the same as over any other app.
check("hold-unlocked-list", C.onHold(unlocked: true, locked: false, askingTouchID: false, sleepUp: false) == .showList)
check("hold-unlocked-wins-over-stale-lock", C.onHold(unlocked: true, locked: true, askingTouchID: false, sleepUp: false) == .showList)
check("hold-locked-touch-id", C.onHold(unlocked: false, locked: true, askingTouchID: false, sleepUp: false) == .askTouchID)
check("hold-locked-already-asking", C.onHold(unlocked: false, locked: true, askingTouchID: true, sleepUp: false) == .nothing)
check("hold-signed-out-card", C.onHold(unlocked: false, locked: false, askingTouchID: false, sleepUp: false) == .showCard)
check("hold-sleep-mode-nothing", C.onHold(unlocked: true, locked: false, askingTouchID: false, sleepUp: true) == .nothing)

// The golden rule: a quick tap is NEVER sent into 1Password or Signal; over a normal app it goes on.
check("tap-never-into-protected", !C.passOnTap(protectedFront: true))
check("tap-goes-on-normal", C.passOnTap(protectedFront: false))

// The log never names an app, and never writes a line for a protected app at all (SafePeek only logs Secure Input).
for l in [C.logLine(armed: true, why: .protected), C.logLine(armed: true, why: .secureInput), C.logLine(armed: false, why: nil)] {
  let low = l.lowercased()
  check("log-no-names:\(l.prefix(32))", !low.contains("signal") && !low.contains("1password") && !low.contains("agilebits") && !low.contains("whisper"))
}

// No em or en dashes in the rules file (plain words rule).
let src = (try? String(contentsOfFile: "Sources/SafePeekCore.swift", encoding: .utf8)) ?? ""
check("source-read", !src.isEmpty)
check("no-em-en-dashes", !src.contains("\u{2014}") && !src.contains("\u{2013}"))

print(fails == 0 ? "SAFEPEEK CORE: all ok" : "SAFEPEEK CORE: \(fails) FAIL")
exit(fails == 0 ? 0 : 1)
