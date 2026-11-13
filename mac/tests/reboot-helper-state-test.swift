// Offline test for Sources/RebootHelperCore.swift (V1.45): what PS remembers about the restart helper, when it says
// macOS switched it off after an update, when the card shows, when the settings are sent again. Asks macOS nothing.
//   bash tests/reboot-helper-state-test.sh
import Foundation

var fails = 0
func check(_ name: String, _ ok: Bool) { print("\(name)=\(ok ? "ok" : "FAIL")"); if !ok { fails += 1 } }

let none = HelperMemory(wasOn: false, onBuild: "")
let on143 = HelperMemory(wasOn: true, onBuild: "2611080331")
let b144 = "2611091412", b145 = "2611120900"

// Memory: only a helper that macOS calls on AND that answered counts.
check("remember-on-answered", RebootHelperCore.remember(state: "on", answered: true, memory: none, build: b144) == HelperMemory(wasOn: true, onBuild: b144))
check("remember-on-silent-keeps", RebootHelperCore.remember(state: "on", answered: false, memory: on143, build: b144) == on143)
check("remember-approve-keeps", RebootHelperCore.remember(state: "approve", answered: false, memory: on143, build: b144) == on143)
check("remember-off-blip-keeps", RebootHelperCore.remember(state: "off", answered: false, memory: on143, build: b144) == on143)
check("remember-missing-keeps", RebootHelperCore.remember(state: "missing", answered: false, memory: on143, build: b144) == on143)

// Migration from a PS before V1.45 (no memory yet): saved settings mean it was on once, build unknown.
check("migrate-settings", RebootHelperCore.migrate(stored: nil, hasSettings: true) == HelperMemory(wasOn: true, onBuild: ""))
check("migrate-nothing", RebootHelperCore.migrate(stored: nil, hasSettings: false) == none)
check("migrate-stored-wins", RebootHelperCore.migrate(stored: none, hasSettings: true) == none)

// Why it is off.
check("offby-update", RebootHelperCore.offBy(state: "approve", memory: on143, build: b144) == .update)
check("offby-update-migrated", RebootHelperCore.offBy(state: "approve", memory: HelperMemory(wasOn: true, onBuild: ""), build: b144) == .update)
check("offby-settings-same-build", RebootHelperCore.offBy(state: "approve", memory: HelperMemory(wasOn: true, onBuild: b144), build: b144) == .settings)
check("offby-first-setup-none", RebootHelperCore.offBy(state: "approve", memory: none, build: b144) == nil)
check("offby-on-none", RebootHelperCore.offBy(state: "on", memory: on143, build: b144) == nil)
check("offby-off-none", RebootHelperCore.offBy(state: "off", memory: on143, build: b144) == nil)
check("offby-missing-none", RebootHelperCore.offBy(state: "missing", memory: on143, build: b144) == nil)

// The card: an update only, once per run, not when the developer chose Off.
check("card-update-watch", RebootHelperCore.showCard(offBy: .update, mode: "watch", toldThisRun: false))
check("card-update-active", RebootHelperCore.showCard(offBy: .update, mode: "active", toldThisRun: false))
check("card-once-per-run", !RebootHelperCore.showCard(offBy: .update, mode: "active", toldThisRun: true))
check("card-not-when-off", !RebootHelperCore.showCard(offBy: .update, mode: "off", toldThisRun: false))
check("card-not-for-settings", !RebootHelperCore.showCard(offBy: .settings, mode: "active", toldThisRun: false))
check("card-not-first-setup", !RebootHelperCore.showCard(offBy: nil, mode: "watch", toldThisRun: false))

// Settings go out again the moment it is back on, never on a plain start.
check("back-from-approve", RebootHelperCore.cameBack(previous: "approve", now: "on"))
check("back-from-off", RebootHelperCore.cameBack(previous: "off", now: "on"))
check("not-back-at-start", !RebootHelperCore.cameBack(previous: nil, now: "on"))
check("not-back-on-on", !RebootHelperCore.cameBack(previous: "on", now: "on"))
check("not-back-to-approve", !RebootHelperCore.cameBack(previous: "on", now: "approve"))

// Looks quickly only while waiting for the developer in System Settings.
check("poll-fast-approve", RebootHelperCore.pollSeconds(state: "approve") <= 5)
check("poll-slow-on", RebootHelperCore.pollSeconds(state: "on") == 60)
check("poll-slow-off", RebootHelperCore.pollSeconds(state: "off") == 60)

// The whole story of 9 Nov 2026, step by step: on in 1.43, update to 1.44 (macOS switches it off), card once,
// The developer switches it on, settings sent, memory moves to 1.44; a later update with the helper unchanged stays on.
var mem = on143, told = false, prev: String? = nil, sent = 0, cards = 0
func step(_ state: String, answered: Bool, build: String, mode: String = "active") {
  if RebootHelperCore.showCard(offBy: RebootHelperCore.offBy(state: state, memory: mem, build: build), mode: mode, toldThisRun: told) { told = true; cards += 1 }
  if RebootHelperCore.cameBack(previous: prev, now: state) { sent += 1 }
  mem = RebootHelperCore.remember(state: state, answered: answered, memory: mem, build: build)
  prev = state
}
step("approve", answered: false, build: b144)
step("approve", answered: false, build: b144)
step("approve", answered: false, build: b144)
check("story-one-card", cards == 1)
step("on", answered: true, build: b144)
check("story-settings-sent", sent == 1)
check("story-memory-144", mem == HelperMemory(wasOn: true, onBuild: b144))
prev = nil; told = false   // PS restarts into 1.45; the pinned helper is unchanged, so macOS still says on
step("on", answered: true, build: b145)
check("story-145-no-card", cards == 1)
check("story-145-memory", mem == HelperMemory(wasOn: true, onBuild: b145))
step("approve", answered: false, build: b145)   // The developer switches PS off himself in System Settings
check("story-own-switch-no-card", cards == 1)
check("story-own-switch-says-settings", RebootHelperCore.offBy(state: "approve", memory: mem, build: b145) == .settings)

// The words: plain, the app's own name, no dashes of any kind.
let words = [RebootHelperCore.cardTitle(app: "PS"), RebootHelperCore.cardSub(app: "My PS"), RebootHelperCore.cardButton]
check("words-name", RebootHelperCore.cardSub(app: "My PS").contains("Find My PS under Allow in the Background and switch it on. If it already looks on, switch it off and then on again."))
check("words-no-dashes", !words.joined().contains { "\u{2013}\u{2014}".contains($0) })
check("words-button-fits", RebootHelperCore.cardButton.count <= 24)
check("words-id-prefix", RebootHelperCore.cardId.hasPrefix("rh:") && RebootHelperCore.cardId.count <= 40)

print(fails == 0 ? "REBOOT HELPER STATE: all ok" : "REBOOT HELPER STATE: \(fails) FAILED")
exit(fails == 0 ? 0 : 1)
