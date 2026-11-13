// Unit tests for Keep overlay off (Sources/KeepCore.swift, V1.57). The developer, 13 Nov 2026: clicking a page in the Edit
// overview must keep him in the list "until you hold/let go of tab again or you click anywhere on screen that there
// isn't a button/panel". The rule, then its wiring in main.swift (read as text). Run: bash tests/keepcore-test.sh
import Foundation

var passed = 0
func ok(_ name: String, _ cond: Bool) {
  if cond { passed += 1; print("ok - \(name)") } else { print("FAIL - \(name)"); exit(1) }
}
ok("leaving Edit with the list up: it stays, pinned", KeepCore.off(stay: true, shown: true) == .stayPinned)
ok("the Keep tick taken off: the list goes, as always", KeepCore.off(stay: false, shown: true) == .hide)
ok("the list already hidden: nothing is kept up", KeepCore.off(stay: true, shown: false) == .hide && KeepCore.off(stay: false, shown: false) == .hide)

let main = (try? String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8)) ?? ""
func slice(_ from: String, _ to: String) -> String {
  guard let a = main.range(of: from), let b = main.range(of: to, range: a.upperBound..<main.endIndex) else { return "" }
  return String(main[a.lowerBound..<b.lowerBound])
}
let keepMsg = slice("case \"keep\" where fromOverlay:", "case \"hitRects\"")
ok("the page's keep message carries stay", keepMsg.contains("setKeep(msg[\"on\"] as? Bool ?? false, stay: msg[\"stay\"] as? Bool == true)"))
let f = slice("func setKeep(_ on: Bool, stay: Bool = false) {", "func setHitRects")
ok("stay: pinned, so the next Tab closes it by the usual rules", f.contains("KeepCore.off(stay: stay, shown: shown) == .stayPinned") && f.contains("w.pinned = true"))
ok("stay: clicks land on the list everywhere, so empty space reaches the page's background click",
   f.contains("panel.ignoresMouseEvents = selfTest") && f.contains("clickThrough = selfTest") && f.contains("removeAttribute('data-mouse-out')"))
ok("stay: the list keeps the keyboard like a list kept by Tab (never over 1Password or Signal: keepOpen)", f.contains("keepOpen()"))
ok("no stay: the list goes, as before", f.contains("} else {\n        hideOverlay(force: true)"))
// The usual Tab rules for a pinned list, which now close it after Edit.
let tap = slice("if overlayOpen && pinned && stays {", "// Shift+Tab and shortcuts pass straight through")
ok("Tab keeps the list open on: a hold puts the pinned list away", tap.contains("{ [weak self] in self?.app?.hideOverlay() })"))
ok("Tab keeps the list open off: Tab down puts the pinned list away", tap.contains("if overlayOpen && pinned {") && tap.contains("DispatchQueue.main.async { self.app?.hideOverlay() }"))
ok("hideOverlay without force is not blocked once Keep is off", main.contains("if kept && !force { return }"))
ok("no em or en dashes in KeepCore", !((try? String(contentsOfFile: CommandLine.arguments[1].replacingOccurrences(of: "main.swift", with: "KeepCore.swift"), encoding: .utf8)) ?? "x").contains(where: { $0 == "\u{2013}" || $0 == "\u{2014}" }))
print("\(passed) of \(passed) ok")
