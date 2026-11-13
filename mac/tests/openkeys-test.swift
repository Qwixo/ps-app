// Offline test for Sources/OpenKeysCore.swift (V1.47 Tab overlay shortcuts): hold, combo and chord matching, a quick
// tap going on as typed, keys by key code (any layout), clashes, and what may run over 1Password and Signal. Asks
// macOS nothing, registers no hotkey, sends no key.
//   mkdir -p build/openkeys && cp tests/openkeys-test.swift build/openkeys/main.swift && swiftc build/openkeys/main.swift Sources/OpenKeysCore.swift Sources/SafePeekCore.swift -o build/openkeys/test && build/openkeys/test
import Foundation

var fails = 0
func check(_ name: String, _ ok: Bool) { print("\(name)=\(ok ? "ok" : "FAIL")"); if !ok { fails += 1 } }
typealias K = OpenKeysCore
typealias S = OpenKeysCore.Shortcut
let P = 35, O = 31, W = 13, ONE = 18, A = 0, F13 = 105, RCMD = 54, LCMD = 55

// ---------- existing users keep exactly their keys ----------
let legacyTab = K.Plan(K.legacy(triggerKey: "tab", slashOn: true), legacy: true)
check("legacy-tab-hold", legacyTab.holdKeys == [48: 0.18] && legacyTab.modHolds.isEmpty)
check("legacy-slash-chord", legacyTab.chords == [44: [47]] && legacyTab.chordGaps == [44: 0])
check("legacy-no-combos", legacyTab.combos.isEmpty)
let legacyOpt = K.Plan(K.legacy(triggerKey: "rightOption", slashOn: false), legacy: true)
check("legacy-right-option", legacyOpt.holdKeys.isEmpty && legacyOpt.modHolds == [61] && legacyOpt.chords.isEmpty)
check("legacy-unknown-trigger-is-tab", K.legacy(triggerKey: "zzz", slashOn: false) == [S(kind: .hold, key: 48)])
check("hold-seconds-matches-today", K.baseHold == 0.18)
check("defaults-are-tab-and-slash", K.defaults == [S(kind: .hold, key: 48), S(kind: .chord, key: 47, first: 44)])
check("legacy-list-saves-cleanly", K.canSave(K.legacy(triggerKey: "rightOption", slashOn: true)))
// The same list saved as custom (someone opened the tab and saved without changing it) behaves the same.
check("custom-default-same-plan", K.Plan(K.defaults) == legacyTab)

// ---------- hold ----------
let holdP = K.Plan([S(kind: .hold, key: P)])
check("hold-letter-starts", K.start(holdP, code: Int64(P), down: true, plain: true, repeating: false, flagsChanged: false) == .hold(0.30))
check("hold-letter-longer-than-tab", K.holdSeconds(P) > K.holdSeconds(48))
check("hold-f13-tab-time", K.start(K.Plan([S(kind: .hold, key: F13)]), code: Int64(F13), down: true, plain: true, repeating: false, flagsChanged: false) == .hold(0.18))
check("hold-not-with-shift", K.start(holdP, code: Int64(P), down: true, plain: false, repeating: false, flagsChanged: false) == .none)
check("hold-not-on-repeat", K.start(holdP, code: Int64(P), down: true, plain: true, repeating: true, flagsChanged: false) == .none)
check("hold-not-on-key-up", K.start(holdP, code: Int64(P), down: false, plain: true, repeating: false, flagsChanged: false) == .none)
check("hold-other-key-not-mine", K.start(holdP, code: Int64(O), down: true, plain: true, repeating: false, flagsChanged: false) == .none)
check("hold-tab-not-mine-when-removed", K.start(holdP, code: 48, down: true, plain: true, repeating: false, flagsChanged: false) == .none)
let rcmd = K.Plan([S(kind: .hold, key: RCMD)])
check("hold-modifier-is-flags", rcmd.modHolds == [Int64(RCMD)] && rcmd.holdKeys.isEmpty)
check("hold-modifier-starts", K.start(rcmd, code: Int64(RCMD), down: true, plain: true, repeating: false, flagsChanged: true) == .modHold)
check("hold-modifier-other-not", K.start(rcmd, code: Int64(LCMD), down: true, plain: true, repeating: false, flagsChanged: true) == .none)

// ---------- quick tap passes through ----------
check("quick-tap-types", K.release(heldFor: 0.08, holdTime: K.holdSeconds(P)))
check("slow-letter-still-types", K.release(heldFor: 0.22, holdTime: K.holdSeconds(P)))   // a slow keystroke, not a hold
check("long-hold-opens", !K.release(heldFor: 0.35, holdTime: K.holdSeconds(P)))
check("tab-quick-tap-types", K.release(heldFor: 0.1, holdTime: K.holdSeconds(48)))
check("tab-hold-opens", !K.release(heldFor: 0.2, holdTime: K.holdSeconds(48)))

// ---------- chord ----------
let po = K.Plan([S(kind: .chord, key: O, first: P)])
check("chord-starts-on-first", K.start(po, code: Int64(P), down: true, plain: true, repeating: false, flagsChanged: false) == .chord)
check("chord-second-not-a-start", K.start(po, code: Int64(O), down: true, plain: true, repeating: false, flagsChanged: false) == .none)
check("chord-fires-after-gap", po.finishesChord(first: Int64(P), code: Int64(O), heldFor: 0.2))
check("chord-fast-typing-stays-typing", !po.finishesChord(first: Int64(P), code: Int64(O), heldFor: 0.05))   // "pop" rolled
check("chord-wrong-second", !po.finishesChord(first: Int64(P), code: Int64(A), heldFor: 0.5))
check("chord-wrong-first", !po.finishesChord(first: Int64(O), code: Int64(P), heldFor: 0.5))
check("legacy-chord-no-gap", legacyTab.finishesChord(first: 44, code: 47, heldFor: 0))
check("saved-slash-chord-no-gap", K.Plan([S(kind: .chord, key: 47, first: 44)]).finishesChord(first: 44, code: 47, heldFor: 0))
check("chord-two-seconds", K.Plan([S(kind: .chord, key: O, first: P), S(kind: .chord, key: A, first: P)]).chords[Int64(P)] == [Int64(O), Int64(A)])
check("chord-before-hold-same-key", K.start(K.Plan([S(kind: .chord, key: O, first: 48), S(kind: .hold, key: 48)]), code: 48, down: true, plain: true, repeating: false, flagsChanged: false) == .chord)

// ---------- combo ----------
let cos = S(kind: .combo, key: 49, mods: ["ctrl", "opt"])
let comboPlan = K.Plan([cos])
check("combo-not-the-tap", comboPlan.holdKeys.isEmpty && comboPlan.chords.isEmpty && comboPlan.modHolds.isEmpty && comboPlan.combos == [cos])
check("combo-space-not-a-hold", K.start(comboPlan, code: 49, down: true, plain: true, repeating: false, flagsChanged: false) == .none)
check("combo-carbon-bits", K.carbonMods(["ctrl", "opt"]) == 4096 | 2048 && K.carbonMods(["cmd", "shift"]) == 256 | 512 && K.carbonMods([]) == 0)
check("combo-needs-cmd-ctrl-opt", K.refusal(S(kind: .combo, key: P, mods: ["shift"])) != nil)
check("combo-plain-letter-refused", K.refusal(S(kind: .combo, key: P, mods: [])) != nil)
check("combo-f-key-alone-ok", K.refusal(S(kind: .combo, key: F13, mods: [])) == nil)
check("combo-modifier-key-refused", K.refusal(S(kind: .combo, key: RCMD, mods: ["ctrl"])) != nil)
check("combo-odd-mod-refused", K.refusal(S(kind: .combo, key: P, mods: ["hyper"])) != nil)

// ---------- layouts: saved by key code, never by character ----------
// A German or Russian layout puts other characters on these keys; the saved shortcut is the same physical key.
let ru = S(kind: .chord, key: O, first: P)   // on Russian, З then Щ; on AZERTY, P then O; same key codes
let json = K.encode([ru])
check("saved-by-key-code", json.contains("\"key\":31") && json.contains("\"first\":35") && !json.contains("\"P\""))
check("round-trip", K.decode(json) == [ru])
check("decode-empty-is-legacy", K.decode("[]") == nil && K.decode(nil) == nil && K.decode("not json") == nil)
check("decode-ignores-extra-fields", K.decode("[{\"kind\":\"hold\",\"key\":48,\"id\":\"x1\",\"label\":\"Tab\"}]") == [S(kind: .hold, key: 48)])
check("describe-uses-layout-label", K.describe(ru, label: { [35: "З", 31: "Щ"][$0] ?? "?" }) == "З and press Щ")
check("describe-combo", K.describe(cos, label: { $0 == 49 ? "Space" : "?" }) == "Control Option Space")
check("fixed-names", K.fixedName(48) == "Tab" && K.fixedName(61) == "Right Option" && K.fixedName(105) == "F13" && K.fixedName(P) == nil)
check("typing-keys", K.isTyping(P) && K.isTyping(49) && K.isTyping(44) && K.isTyping(10) && !K.isTyping(48) && !K.isTyping(F13) && !K.isTyping(36) && !K.isTyping(51))

// ---------- conflicts ----------
func errs(_ l: [S]) -> [K.Problem] { K.problems(l).filter { $0.error } }
func warns(_ l: [S]) -> [K.Problem] { K.problems(l).filter { !$0.error } }
check("empty-refused", !K.canSave([]))
check("duplicate-refused", errs([S(kind: .hold, key: 48), S(kind: .hold, key: 48)]).first?.index == 1)
check("hold-and-chord-same-first-refused", errs([S(kind: .hold, key: P), S(kind: .chord, key: O, first: P)]).first?.index == 1)
check("chord-different-seconds-ok", K.canSave([S(kind: .chord, key: O, first: P), S(kind: .chord, key: A, first: P)]))
check("same-combo-twice-refused", !K.canSave([cos, S(kind: .combo, key: 49, mods: ["opt", "ctrl"])]))
check("combo-and-hold-same-key-ok", K.canSave([S(kind: .combo, key: F13, mods: ["ctrl"]), S(kind: .hold, key: F13)]))
check("esc-refused", K.refusal(S(kind: .hold, key: 53)) != nil && K.refusal(S(kind: .chord, key: 53, first: P)) != nil && K.refusal(S(kind: .combo, key: 53, mods: ["ctrl"])) != nil)
check("delete-return-arrows-not-holds", [36, 51, 117, 76, 123, 126].allSatisfy { K.refusal(S(kind: .hold, key: $0)) != nil })
check("caps-refused", K.refusal(S(kind: .hold, key: 57)) != nil)
check("chord-same-key-refused", K.refusal(S(kind: .chord, key: P, first: P)) != nil)
check("chord-modifier-refused", K.refusal(S(kind: .chord, key: P, first: RCMD)) != nil)
check("chord-needs-first", K.refusal(S(kind: .chord, key: P)) != nil)
check("system-spotlight", K.systemClash(S(kind: .combo, key: 49, mods: ["cmd"])) != nil)
check("system-copy", K.systemClash(S(kind: .combo, key: 8, mods: ["cmd"])) != nil)
check("system-ctrl-opt-space-flagged", K.systemClash(cos) != nil)   // input source switching on some Macs
check("system-free-combo", K.systemClash(S(kind: .combo, key: F13, mods: ["ctrl"])) == nil)
check("system-clash-is-a-warning", K.canSave([S(kind: .combo, key: 49, mods: ["cmd"])]) && !warns([S(kind: .combo, key: 49, mods: ["cmd"])]).isEmpty)
check("system-fn-hold", K.systemClash(S(kind: .hold, key: 63)) != nil)
check("letter-hold-warns-but-saves", K.canSave([S(kind: .hold, key: P)]) && warns([S(kind: .hold, key: P)]).first?.text.contains("slows typing") == true)
check("left-cmd-hold-warns", warns([S(kind: .hold, key: LCMD)]).count == 1 && warns([S(kind: .hold, key: RCMD)]).isEmpty)
check("tab-hold-no-warning", K.problems([S(kind: .hold, key: 48)]).isEmpty)
check("thirteen-refused", !K.canSave((0..<13).map { S(kind: .combo, key: F13, mods: [["ctrl"], ["opt"], ["cmd"], ["ctrl", "opt"], ["ctrl", "cmd"], ["opt", "cmd"], ["ctrl", "opt", "cmd"], ["shift", "ctrl"], ["shift", "opt"], ["shift", "cmd"], ["shift", "ctrl", "opt"], ["shift", "ctrl", "cmd"], ["shift", "opt", "cmd"]][$0]) }))
check("refused-ones-never-reach-the-tap", K.Plan([S(kind: .hold, key: 53), S(kind: .hold, key: 51)]).holdKeys.isEmpty)

// ---------- 1Password and Signal: only what a macOS hotkey can match, never a key that types ----------
check("protected-tab-hold", K.hotkeyable(S(kind: .hold, key: 48)))
check("protected-f-key-hold", K.hotkeyable(S(kind: .hold, key: F13)))
check("protected-combo", K.hotkeyable(cos))
check("protected-no-letter-hold", !K.hotkeyable(S(kind: .hold, key: P)))      // it would eat every P typed in Signal
check("protected-no-space-hold", !K.hotkeyable(S(kind: .hold, key: 49)))
check("protected-no-modifier-hold", !K.hotkeyable(S(kind: .hold, key: 61)))   // needs the tap
check("protected-no-chord", !K.hotkeyable(ru) && !K.hotkeyable(S(kind: .chord, key: 47, first: 44)))
check("protected-legacy-is-plain-tab", K.blindHolds(K.legacy(triggerKey: "rightOption", slashOn: true), legacy: true) == [48])
check("protected-custom-holds", K.blindHolds([S(kind: .hold, key: P), S(kind: .hold, key: F13), S(kind: .hold, key: 48), S(kind: .chord, key: O, first: P)], legacy: false) == [F13, 48])
check("protected-custom-none", K.blindHolds([S(kind: .hold, key: 61), ru], legacy: false).isEmpty)
// SafePeek still arms only while the tap is blind and never keeps the hotkey through typing in the list.
var i = SafePeekCore.Inputs(); i.protectedFront = true
check("protected-arms", SafePeekCore.wantTab(i))
i.editing = true
check("protected-editing-off", !SafePeekCore.wantTab(i))
var n = SafePeekCore.Inputs()
check("normal-app-tap-has-it", !SafePeekCore.wantTab(n))
n.secureStuck = true
check("secure-input-arms", SafePeekCore.wantTab(n))
check("never-sent-into-protected", !SafePeekCore.passOnTap(protectedFront: true))

print(fails == 0 ? "OPENKEYS: all ok" : "OPENKEYS: \(fails) FAIL")
exit(fails == 0 ? 0 : 1)
