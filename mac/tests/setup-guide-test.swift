// Unit tests for the token guide's rules (Sources/SetupGuideCore.swift): the token match, the clipboard rules,
// the steps and their words, the arrows and where the card docks. No window, no clipboard, no network.
import Foundation
import CoreGraphics

var failed = 0, passed = 0
func check(_ ok: Bool, _ what: String, line: Int = #line) {
  if ok { passed += 1 } else { failed += 1; print("FAIL (line \(line)): \(what)") }
}

// MARK: the token pattern

let classic = "sbp_" + String(repeating: "a1b2c3d4e5", count: 4)          // sbp_ plus 40 (the classic shape)
let scoped = "sbp_fc" + String(repeating: "Z9y8X7w6", count: 5)          // scoped tokens start sbp_fc
check(GuideCore.isAccessToken(classic), "classic token")
check(GuideCore.isAccessToken(scoped), "scoped token")
check(GuideCore.isAccessToken("sbp_v0_" + String(repeating: "f", count: 40)), "underscores inside")
check(!GuideCore.isAccessToken("sbp_short"), "too short")
check(!GuideCore.isAccessToken("SBP_" + String(repeating: "a", count: 40)), "wrong case prefix")
check(!GuideCore.isAccessToken("sb_publishable_" + String(repeating: "a", count: 30)), "publishable key is not a token")
check(!GuideCore.isAccessToken("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.abc"), "a JWT (anon or service key) is not a token")
check(!GuideCore.isAccessToken(classic + "-x"), "a dash inside")
check(!GuideCore.isAccessToken("x" + classic), "text before")
check(!GuideCore.isAccessToken(classic + " "), "space after (exact match)")
check(!GuideCore.isAccessToken("sbp_" + String(repeating: "a", count: 201)), "too long")
check(GuideCore.isAccessToken("sbp_" + String(repeating: "a", count: 200)), "longest allowed")
check(!GuideCore.isAccessToken("sbp_" + String(repeating: "é", count: 40)), "letters outside ASCII")

check(GuideCore.token(in: classic) == classic, "clip: exact")
check(GuideCore.token(in: "  \n" + classic + "\n") == classic, "clip: spaces and line breaks around")
check(GuideCore.token(in: "my token is " + classic) == nil, "clip: inside a sentence is not taken")
check(GuideCore.token(in: classic + "\n" + scoped) == nil, "clip: two tokens are not taken")
check(GuideCore.token(in: String(repeating: " ", count: 290) + classic) == nil, "clip: longer than 300 is dropped unread")
check(GuideCore.token(in: "") == nil, "clip: empty")
check(GuideCore.token(in: "hunter2") == nil, "clip: a password")

// MARK: the clipboard rules

let text = [GuideCore.textType]
var w = GuideCore.PasteWatch()
check(w.tick(count: 5, protectedFront: false, types: { text }) == .nothing, "not armed: never reads")
check(!w.armed, "starts disarmed")
var asked = 0
_ = w.tick(count: 6, protectedFront: false, types: { asked += 1; return text })
check(asked == 0, "not armed: does not even ask for the types")
w.arm(count: 10)
check(w.tick(count: 10, protectedFront: false, types: { text }) == .nothing, "armed, nothing copied since")
check(w.tick(count: 11, protectedFront: false, types: { text }) == .read, "armed, a new text copy: read once")
check(w.tick(count: 11, protectedFront: false, types: { text }) == .nothing, "the same copy is never read twice")
// 1Password or Signal in front: skipped, and the copy made there stays skipped afterwards.
check(w.tick(count: 12, protectedFront: true, types: { asked += 1; return text }) == .nothing, "protected app in front: no read")
check(asked == 0, "protected app in front: not even the types")
check(w.tick(count: 12, protectedFront: false, types: { text }) == .nothing, "a copy made while protected is skipped after it leaves")
// A quick switch away from 1Password, quicker than one look: frontChanged takes the copy out of play.
w.frontChanged(count: 13, leftProtected: true)
check(w.tick(count: 13, protectedFront: false, types: { text }) == .nothing, "copy made just before leaving 1Password is skipped")
w.frontChanged(count: 13, leftProtected: false)
check(w.tick(count: 14, protectedFront: false, types: { text }) == .read, "a later copy in the browser is read")
// Concealed, transient, 1Password's own type, or no text at all: skipped without reading.
for mark in GuideCore.privateMarks.sorted() {
  var v = GuideCore.PasteWatch(); v.arm(count: 1)
  check(v.tick(count: 2, protectedFront: false, types: { text + [mark] }) == .nothing, "skips a copy marked \(mark)")
}
var v2 = GuideCore.PasteWatch(); v2.arm(count: 1)
check(v2.tick(count: 2, protectedFront: false, types: { ["public.png"] }) == .nothing, "no text: nothing to read")
v2.disarm()
check(v2.tick(count: 3, protectedFront: false, types: { text }) == .nothing, "disarmed: never reads again")
var v3 = GuideCore.PasteWatch(); v3.arm(count: 1); v3.disarm()
v3.frontChanged(count: 9, leftProtected: true)
check(v3.last == 1, "disarmed: a front change does nothing")

// MARK: the steps

let stages = GuideCore.all.map(\.stage)
check(stages == [.account, .generate, .legacy, .name, .create, .copy], "step order")
check(GuideCore.steps(from: .account).count == 6, "from the account step: six steps")
check(GuideCore.steps(from: .generate).count == 5, "with an account already: five steps")
check(GuideCore.steps(from: .generate).first?.stage == .generate, "token steps start at Generate new token")
check(GuideCore.steps(from: .generate).last?.stage == .copy, "the last step is Copy")
check(GuideCore.Stage.allCases.filter(GuideCore.watches) == [.copy], "the clipboard is watched on the Copy step only")
check(GuideCore.all.first { $0.stage == .account }?.url == "https://supabase.com/dashboard/sign-up", "account step opens sign up")
check(GuideCore.all.first { $0.stage == .generate }?.url == "https://supabase.com/dashboard/account/tokens", "generate step opens the tokens page")
check(GuideCore.all.filter { $0.url != nil }.count == 2, "only two pages are ever opened")
check(GuideCore.all.allSatisfy { $0.url.map { $0.hasPrefix("https://supabase.com/") } ?? true }, "every page is on supabase.com over https")

// Every word on the card: no em or en dashes, never the bare old name, the token's name is "PS app".
let words = GuideCore.all.flatMap { [$0.title, $0.text] } + [GuideCore.watchNote, GuideCore.caughtTitle, GuideCore.caughtText]
check(words.allSatisfy { !$0.contains("\u{2014}") && !$0.contains("\u{2013}") }, "no em or en dashes")
check(words.allSatisfy { $0.range(of: #"\bPS\b(?! app)"#, options: .regularExpression) == nil }, "always PS app, never PS alone")
check(GuideCore.all.first { $0.stage == .name }!.text.contains("Type PS app"), "the token's name to type is PS app")
check(GuideCore.watchNote.contains("this step only") && GuideCore.watchNote.contains("1Password"), "the watch note says when and what")
check(GuideCore.all.first { $0.stage == .name }!.text.contains("Expires in to Never"), "the token never expires, so updates keep working")
check(!words.contains { $0.contains("Organization") || $0.contains("Full access") || $0.contains("Preset") }, "no organization scoped token any more")
for label in ["Generate new token", "Resource access", "Create legacy token", "Name", "Expires in", "Never", "Generate token"] {
  check(words.contains { $0.contains(label) }, "Supabase's label \(label) is named on the card")
}

// MARK: the arrows

let big = CGRect(x: 0, y: 25, width: 1440, height: 875)
let small = CGRect(x: 200, y: 100, width: 800, height: 600)
for f in [big, small, CGRect(x: -1600, y: 0, width: 1280, height: 800)] {
  for s in GuideCore.Stage.allCases {
    guard let a = GuideCore.anchor(s, in: f) else { continue }
    check(f.insetBy(dx: 23, dy: 23).contains(a.tip), "\(s) tip inside the window \(f)")
    let len = (a.toward.dx * a.toward.dx + a.toward.dy * a.toward.dy).squareRoot()
    check(abs(len - 1) < 0.02, "\(s) direction is a unit vector")
    // The marker sits 74 points away along the direction: still on the window's screen side, not off the far edge.
    check(a.toward.dx < 0, "\(s) marker comes from the left (Supabase's panel is on the right)")
  }
}
check(GuideCore.anchor(.account, in: big) == nil, "no arrow on the sign up page")
check(GuideCore.anchor(.generate, in: CGRect(x: 0, y: 0, width: 200, height: 200)) == nil, "no arrow on a tiny window")
check(GuideCore.sheetWidth(1440) == 800 && GuideCore.sheetWidth(800) == 656 && GuideCore.sheetWidth(500) == 500, "Supabase's panel widths")
let name = GuideCore.anchor(.name, in: big)!.tip
check(name.x > big.maxX - 800, "Name arrow points inside the panel")
let create = GuideCore.anchor(.create, in: big)!.tip
check(create.y > big.maxY - 60 && create.x > big.maxX - 120, "Create token arrow at the panel's bottom right")
let copy = GuideCore.anchor(.copy, in: big)!.tip
check(copy.x > big.maxX - 60 && copy.y < big.midY, "Copy arrow at the token box's right end, near the top")
let gen = GuideCore.anchor(.generate, in: CGRect(x: 0, y: 0, width: 2560, height: 1400))!.tip
check(gen.x <= 1500, "on a very wide window the Generate arrow stays near the content")

// MARK: the browser's frame from a window list (process id, layer, bounds only)

func win(_ pid: Int32, _ layer: Int, _ x: Double, _ y: Double, _ w: Double, _ h: Double, alpha: Double = 1, name: String? = nil) -> [String: Any] {
  var d: [String: Any] = ["kCGWindowOwnerPID": NSNumber(value: pid), "kCGWindowLayer": NSNumber(value: layer), "kCGWindowAlpha": NSNumber(value: alpha),
                          "kCGWindowBounds": ["X": NSNumber(value: x), "Y": NSNumber(value: y), "Width": NSNumber(value: w), "Height": NSNumber(value: h)]]
  if let name { d["kCGWindowName"] = name }
  return d
}
let list = [win(77, 0, 0, 0, 900, 700, name: "1Password"), win(42, 25, 0, 0, 1440, 24), win(42, 0, 10, 10, 120, 40),
            win(42, 0, 100, 50, 1200, 800, alpha: 0), win(42, 0, 60, 40, 1300, 820), win(42, 0, 0, 0, 1440, 900)]
check(GuideCore.browserFrame(in: list, pid: 42) == CGRect(x: 60, y: 40, width: 1300, height: 820), "front most normal browser window")
check(GuideCore.browserFrame(in: list, pid: 0) == nil, "no browser known")
check(GuideCore.browserFrame(in: list, pid: 99) == nil, "browser with no window")
check(GuideCore.browserFrame(in: [], pid: 42) == nil, "empty list")

// MARK: where the card docks

let screenR = CGRect(x: 0, y: 25, width: 1920, height: 1050)
let card = CGSize(width: 344, height: 420)
let right = GuideCore.cardOrigin(browser: CGRect(x: 0, y: 25, width: 1400, height: 900), screen: screenR, card: card)
check(right.x >= 1400, "room on the right: beside the browser on the right")
let left = GuideCore.cardOrigin(browser: CGRect(x: 520, y: 25, width: 1400, height: 900), screen: screenR, card: card)
check(left.x + card.width <= 520, "room only on the left: beside it on the left")
let full = CGRect(x: 0, y: 25, width: 1920, height: 1050)
let inside = GuideCore.cardOrigin(browser: full, screen: screenR, card: card)
check(inside.x < 100 && inside.y + card.height <= full.maxY, "full width browser: inside its bottom left corner (the panel is on the right)")
let none = GuideCore.cardOrigin(browser: nil, screen: screenR, card: card)
check(none.x + card.width <= screenR.maxX && none.x > screenR.midX, "no browser window: bottom right of the screen")
for b in [CGRect(x: -500, y: -300, width: 900, height: 700), CGRect(x: 1700, y: 900, width: 1400, height: 900), CGRect(x: 0, y: 25, width: 300, height: 260)] {
  let o = GuideCore.cardOrigin(browser: b, screen: screenR, card: card)
  check(screenR.contains(CGRect(origin: o, size: card)), "card always fully on screen for \(b)")
}

print("setup guide tests: \(passed) passed, \(failed) failed")
exit(failed == 0 ? 0 : 1)
