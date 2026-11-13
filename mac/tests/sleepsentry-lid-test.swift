// Unit tests for the lid row of Sleep mode's AI Sentry mode pop up (V1.54, lid-notice-154). Run: bash tests/sleepsentry-lid-test.sh
import Foundation

var passed = 0
func check(_ name: String, _ ok: Bool) {
  if ok { passed += 1; print("ok -", name) } else { print("FAIL -", name); exit(1) }
}
let dir = ProcessInfo.processInfo.environment["PS_MAC_DIR"] ?? FileManager.default.currentDirectoryPath
func src(_ f: String) -> String { (try? String(contentsOfFile: "\(dir)/Sources/\(f)", encoding: .utf8)) ?? "" }
let ss = src("SleepSentry.swift")

let restart: [String: Any] = ["title": "Auto restart is off", "helper": "The restart helper is not set up on this Mac.", "consequence": "If this Mac is taken while in Sentry mode, it will not restart into its locked state.",
                              "fixHelper": true, "setUp": "Set up the helper", "turnOn": "Turn on restart", "anyway": "Engage anyway", "cancel": "Cancel"]
let lidOn = SleepSentryN.parse(["plan": ["lid": true, "restartH": 18], "words": [:]])!
let lidOff = SleepSentryN.parse(["plan": ["lid": false, "restartH": 18]])!
let both = SleepSentryN.parse(["plan": ["lid": true, "restartH": 18], "check": restart])!

// When the row shows
check("lid off: never a lid row", SleepSentryRules.lidPanel(nil, gap: "helper", lidOff) == nil)
check("it works (no gap): no lid row", SleepSentryRules.lidPanel(nil, gap: nil, lidOn) == nil && SleepSentryRules.lidPanel(both.check, gap: nil, both) == nil)
check("an unknown gap: no lid row", SleepSentryRules.lidPanel(nil, gap: "zzz", lidOn) == nil)
let only = SleepSentryRules.lidPanel(nil, gap: "helper", lidOn)
check("lid only: its own pop up, title and the helper line", only?.title == "Your Mac will sleep when the lid is closed"
      && only?.lines == ["Keeping your Mac awake with the lid closed needs the restart helper, and it is not on."])
check("refused says macOS did not let it, and how to fix it", SleepSentryRules.lidPanel(nil, gap: "refused", lidOn)?.lines.first?.contains("Setting the helper up again") == true)
let withRestart = SleepSentryRules.lidPanel(both.check, gap: "refused", both)
check("with the restart check: its title, its lines, then the lid line last", withRestart?.title == "Auto restart is off"
      && withRestart?.lines.count == SleepSentryRules.lines(both.check!).count + 1 && withRestart?.lines.last?.hasPrefix("macOS did not let") == true)
check("the page's words win", SleepSentryRules.lidPanel(nil, gap: "helper", SleepSentryN.parse(["plan": ["lid": true], "words": ["lidHelper": "X"]])!)?.lines == ["X"])
check("words: no em or en dashes", ["lidTitle", "lidHelper", "lidRefused", "lidSetUp", "lidAnyway", "lidCancel"].allSatisfy { k in
  let w = SleepSentryRules.words[k] ?? ""; return !w.isEmpty && !w.contains("\u{2014}") && !w.contains("\u{2013}") })

// The wiring: checked before engaging and before the restart pop up, a fix button, Engage anyway, retries in the probe
check("engaging checks the lid first (busy meanwhile, never blocking)", ss.contains("if lidGate(p, then: { [weak self] in self?.engage(p) }) { return }")
      && ss.contains("SentryLid.shared.probe { [weak self] g in"))
check("a gap with nothing else: the lid only pop up with Set up the helper and Engage anyway", ss.contains("showLidOnly(lp, s); return")
      && ss.contains(#"(s.word("lidSetUp"), #selector(setUpTapped)), (s.word("lidAnyway"), #selector(anywayTapped))"#))
check("the restart pop up gets the lid line and the Set up button", ss.contains("if c.fixHelper || lid != nil { buttons.append((c.setUp, #selector(setUpTapped))) }")
      && ss.contains("lines: lid?.lines ?? SleepSentryRules.lines(c)"))
check("Engage anyway does not check the lid again; Cancel and Set up check it fresh next time", ss.contains("lidAnyway = true")
      && ss.contains("lidChecked = nil; lidAnyway = false; closePanel()") && ss.contains("lidChecked = nil\n    closePanel()"))

print("sleep sentry lid: \(passed) passed")
