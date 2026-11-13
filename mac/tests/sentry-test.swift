// Unit tests for Sentry mode's pure rules (Sources/SentryCore.swift, V1.48). Nothing opens, locks or is held, so it is
// safe while someone is using the Mac. Run: bash tests/sentry-test.sh
import Foundation

var passed = 0
func check(_ name: String, _ ok: Bool) {
  if ok { passed += 1; print("ok -", name) } else { print("FAIL -", name); exit(1) }
}

// The plan from the page
check("plan defaults: stop at 10%, lid on (V1.49), restart 8 h", SentryPlanN.parse(nil) == SentryPlanN())
check("plan: an old page's screen choice is ignored (V1.49 has no Screen while engaged)", SentryPlanN.parse(["screen": "off"]) == SentryPlanN())
check("plan: the level is kept between 5 and 50", SentryPlanN.parse(["lowPct": 2]).lowPct == 5 && SentryPlanN.parse(["lowPct": 90]).lowPct == 50 && SentryPlanN.parse(["lowPct": 15]).lowPct == 15)
check("plan: stop switched off and lid on", { let p = SentryPlanN.parse(["lowStop": false, "lid": true]); return !p.lowStop && p.lid }())
check("plan: lid on by default, off when the page says off", SentryPlanN().lid && SentryPlanN.parse(["lowStop": true]).lid && !SentryPlanN.parse(["lid": false]).lid)

check("plan: restart default 8 h, only offered times", SentryPlanN.parse(nil).restartH == 8 && SentryPlanN.parse(["restartH": 0]).restartH == 0
      && SentryPlanN.parse(["restartH": 72]).restartH == 72 && SentryPlanN.parse(["restartH": 5]).restartH == 8)
check("only a real unlock cancels the restart", SentryRules.endCancelsRestart("unlock") && SentryRules.endCancelsRestart("auth")
      && !SentryRules.endCancelsRestart("battery") && !SentryRules.endCancelsRestart("esc"))

// The battery
let p = SentryPlanN()
check("battery: stops at or under the level on battery", SentryRules.batteryStops(p, onBattery: true, pct: 10) && !SentryRules.batteryStops(p, onBattery: true, pct: 11))
check("battery: never on power", !SentryRules.batteryStops(p, onBattery: false, pct: 1))
check("battery: never when switched off", !SentryRules.batteryStops(SentryPlanN.parse(["lowStop": false]), onBattery: true, pct: 1))
check("battery: an unknown level never stops", !SentryRules.batteryStops(p, onBattery: true, pct: nil))

// Refusals, in order
check("refused: a protected app in front first", SentryRules.refusal(protectedFront: true, canLock: false, screens: 0, plan: p, onBattery: true, pct: 1) == "protected")
check("refused: no lock call on this macOS", SentryRules.refusal(protectedFront: false, canLock: false, screens: 1, plan: p, onBattery: false, pct: nil) == "nolock")
check("refused: no screen", SentryRules.refusal(protectedFront: false, canLock: true, screens: 0, plan: p, onBattery: false, pct: nil) == "screen")
check("refused: battery under the level", SentryRules.refusal(protectedFront: false, canLock: true, screens: 1, plan: p, onBattery: true, pct: 9) == "battery")
check("engages otherwise", SentryRules.refusal(protectedFront: false, canLock: true, screens: 2, plan: p, onBattery: true, pct: 60) == nil)

let sentrySrc = (try? String(contentsOfFile: "\(ProcessInfo.processInfo.environment["PS_MAC_DIR"] ?? ".")/Sources/Sentry.swift", encoding: .utf8)) ?? ""
// Lit and dim
check("the headline is the fixed literal", SentryRules.title == "Protected by PS")
check("the Dim Screen words", SentryRules.dimButton == "Dim Screen" && SentryRules.dimLine == "Battery saver, dims screen to save on battery life")
check("fades are short and smooth", SentryRules.dimFade > 0.2 && SentryRules.dimFade <= 1 && SentryRules.undimFade > 0.1 && SentryRules.undimFade <= SentryRules.dimFade && SentryRules.fadeSteps >= 8)
check("a fade starts near where it was", abs(SentryRules.fadeStep(from: 0.8, to: 0.03, step: 1, of: 15) - 0.8) < 0.02)
check("a fade lands exactly (the person's own brightness comes back exactly)", SentryRules.fadeStep(from: 0.03, to: 0.734, step: 15, of: 15) == 0.734 && SentryRules.fadeStep(from: 0.5, to: 0.62, step: 99, of: 15) == 0.62)
check("a fade goes one way only", (1...15).map { SentryRules.fadeStep(from: 0.8, to: 0.03, step: $0, of: 15) }.enumerated().allSatisfy { i, v in i == 0 || v <= SentryRules.fadeStep(from: 0.8, to: 0.03, step: i, of: 15) })
check("dark means nothing lit at all (the developer: completely dark)", SentryRules.dimContent == 0)
check("dark back quicker than down, both quick", SentryRules.undimFade < SentryRules.dimFade && SentryRules.dimFade <= 0.4 && SentryRules.undimFade <= 0.25)
do {
  typealias D = SentryRules.DimState
  check("dim: the pointer on the button goes dark", SentryRules.dimNext(D(), onButton: true, input: false) == D(dark: true, woke: false))
  check("dim: the pointer off the button is lit", SentryRules.dimNext(D(dark: true), onButton: false, input: false) == D())
  check("dim: a key or click while dark lights it and keeps it lit on the button", SentryRules.dimNext(D(dark: true), onButton: true, input: true) == D(dark: false, woke: true)
        && SentryRules.dimNext(D(dark: false, woke: true), onButton: true, input: false) == D(dark: false, woke: true))
  check("dim: leaving after a wake resets it, coming back darkens again", { let off = SentryRules.dimNext(D(dark: false, woke: true), onButton: false, input: false)
        return off == D() && SentryRules.dimNext(off, onButton: true, input: false).dark }())
  check("dim: input off the button changes nothing", SentryRules.dimNext(D(), onButton: false, input: true) == D())
}
check("dark hides the Dim Screen button too, its area stays live", sentrySrc.contains("dim.animator().alphaValue = on ? 0 : 1") && !sentrySrc.contains("guard let w = window, !isHidden, alphaValue"))
check("the pointer hides while dark and always comes back (hide and unhide pair, also on undim and end)", sentrySrc.contains("if on { NSCursor.hide() } else { NSCursor.unhide() }")
      && sentrySrc.components(separatedBy: "setCursorHidden(false)").count >= 3)
check("keys other than Esc and Return, clicks and scrolls are input", sentrySrc.contains("default: onInput?()") && sentrySrc.contains("override func mouseDown(with e: NSEvent) { onInput?() }"))
check("no new brightness change: only the guarded V1.49 backlight fade (restored by the guard from the flag)", sentrySrc.components(separatedBy: "sys.brightSet(").count == 3)
check("Dim Screen: the backlight goes right down to 0 on every Mac, whatever it was", SentryRules.dimBright == 0 && SentryRules.dimmed(from: 0.8) == 0 && SentryRules.dimmed(from: 1) == 0 && SentryRules.dimmed(from: 0.01) == 0)
check("Dim Screen: the fade down ends exactly at 0 and the fade back exactly at the person's own brightness", SentryRules.fadeStep(from: 0.7, to: 0, step: SentryRules.fadeSteps, of: SentryRules.fadeSteps) == 0
      && SentryRules.fadeStep(from: 0, to: 0.7, step: SentryRules.fadeSteps, of: SentryRules.fadeSteps) == 0.7)
check("0 never sticks: the flag keeps the person's own brightness, a 0 included, for the guard and the next launch", {
  var f = SentryRules.Flag(pid: 1, since: 1, boot: 1); f.bright = [1: 0.62, 2: 0]
  return SentryRules.Flag.parse(f.json())?.bright == [1: 0.62, 2: 0] }())
check("0 never sticks: the person's brightness is saved before the first dim, written to the flag, and given back on every way out",
      sentrySrc.contains("if let b = sys.brightGet(d) { self.savedBright[d] = b; changed = true }") && sentrySrc.contains("if changed { var f = flag; f.bright = self.savedBright; Sentry.writeFlag(f, url) }")
      && sentrySrc.contains("for (d, b) in self.savedBright { sys.brightSet(d, b) }")
      && sentrySrc.contains("for (d, b) in f.bright { _ = TorchLightBrightness.write(d, b) }") && sentrySrc.contains("for (d, b) in flag?.bright ?? [:] { _ = TorchLightBrightness.write(d, b) }"))

// Words
check("engaged for", SentryRules.engagedFor(since: 0, now: 30) == "Engaged just now" && SentryRules.engagedFor(since: 0, now: 600) == "Engaged for 10 min"
      && SentryRules.engagedFor(since: 0, now: 7500) == "Engaged for 2 h 05" && SentryRules.engagedFor(since: 0, now: 7200) == "Engaged for 2 h")
check("power line", SentryRules.powerLine(onBattery: false, pct: 80) == "on power" && SentryRules.powerLine(onBattery: true, pct: 64) == "on battery at 64%")
check("lid codes", SentryRules.lidCode(.batteryLow) == "batteryLow" && SentryRules.lidCode(.tooHot) == "tooHot" && SentryRules.lidCode(.helperMissing) == "helperMissing" && SentryRules.lidCode(.other("x")) == "other")
check("lid codes: refused has its own code for the Tab list", SentryRules.lidCode(.refused) == "refused")
check("V1.54: no lid text on the Sentry screen", !sentrySrc.contains("notice = CATextLayer()") && !sentrySrc.contains("setStatus(line, notice")
      && sentrySrc.contains("func setStatus(_ s: String) {") && !sentrySrc.contains("lidNote"))
check("V1.54: a lid stop is told with the end, for the Tab list after the unlock", sentrySrc.contains("send(stopped: why, lid: lidStopCode)")
      && sentrySrc.contains("lidStopCode = code") && !sentrySrc.contains("send(lid: code)"))
check("V1.54: the page can ask for the lid check before engaging", sentrySrc.contains(#"case "sentry:lidCheck": lidCheck("#) && sentrySrc.contains("SentryLid.shared.probe(done: reply)"))

// The flag and the crash safety
let f = SentryRules.Flag(pid: 4242, since: 1000.5, boot: 900, bright: [1: 0.6, 7: 0.25], restart: true)
check("flag round trip", SentryRules.Flag.parse(f.json()) == f)
check("flag: an old flag has no restart", SentryRules.Flag.parse(Data(#"{"pid":1,"since":2}"#.utf8))?.restart == false)
check("flag: junk is no flag", SentryRules.Flag.parse(Data("{}".utf8)) == nil && SentryRules.Flag.parse(nil) == nil && SentryRules.Flag.parse(Data("x".utf8)) == nil)
check("flag: a bad brightness is dropped", SentryRules.Flag.parse(Data(#"{"pid":1,"since":2,"boot":3,"bright":{"5":7,"6":0.5,"x":0.2}}"#.utf8))?.bright == [6: 0.5])
check("recovery: no flag, nothing", SentryRules.recovery(flag: nil, bootNow: 900, screenLocked: false) == .nothing)
check("recovery: a flag and an open Mac locks at once", SentryRules.recovery(flag: f, bootNow: 900, screenLocked: false) == .lockNow)
check("recovery: already locked is safe", SentryRules.recovery(flag: f, bootNow: 900, screenLocked: true) == .alreadySafe)
check("recovery: restarted since is safe (macOS asked at login)", SentryRules.recovery(flag: f, bootNow: 5000, screenLocked: false) == .alreadySafe)
check("recovery: an old flag with no boot time still locks", SentryRules.recovery(flag: SentryRules.Flag(pid: 1, since: 2, boot: 0), bootNow: 5000, screenLocked: false) == .lockNow)
check("guard acts only while the flag is there", SentryRules.guardActs(flagExists: true) && !SentryRules.guardActs(flagExists: false))

print("sentry: \(passed) passed")
