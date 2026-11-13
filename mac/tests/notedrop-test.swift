// Offline test for Sources/NoteDropCore.swift (V1.55, notifications out of the Dynamic Island): from the island's
// place, width and screen to the card window's frame, the stacking sums, and the checks that the page's own numbers
// still match. Never starts PS, never opens a window. Run: bash tests/notedrop-test.sh
import Foundation
import CoreGraphics

var fails = 0, count = 0
func check(_ name: String, _ ok: Bool, _ info: String = "") { count += 1; print("\(name)=\(ok ? "ok" : "FAIL")\(info.isEmpty || ok ? "" : " (\(info))")"); if !ok { fails += 1 } }
func near(_ a: CGFloat, _ b: CGFloat, _ t: CGFloat = 0.01) -> Bool { abs(a - b) < t }
func spotOf(_ h: NoteDrop.Home) -> NoteDrop.Spot? { if case .island(let s) = h { return s }; return nil }
func inside(_ f: CGRect, _ v: CGRect) -> Bool { f.minX >= v.minX - 0.5 && f.maxX <= v.maxX + 0.5 && f.minY >= v.minY - 0.5 && f.maxY <= v.maxY + 0.5 }
func clear(_ f: CGRect, _ island: CGRect) -> Bool { !f.insetBy(dx: 0.5, dy: 0.5).intersects(island) }

// The developer's 15 inch MacBook Air (9 Nov 2026): 1710 x 1112, menu bar 38, the Dock 66 high at the bottom.
let redVisible = CGRect(x: 0, y: 66, width: 1710, height: 1008)
let cap = (redVisible.height * 0.45).rounded()
// The island around the notch in its Drop look at rest: the 208 point notch plus a 300 wide body, 67.5 high.
let dropIsland = CGRect(x: 705, y: 1112 - 67.5, width: 300, height: 67.5)

// MARK: no island: the corner, exactly as before V1.55
check("no-island-corner", NoteDrop.home(nil, cap: cap) == .corner)
let oldCorner = { (vf: CGRect, h: CGFloat) -> CGRect in   // Toast.swift's own sum before V1.55
  let height = min(h, vf.height - 16)
  return CGRect(x: vf.maxX - 392 - 6, y: vf.maxY - height - 4, width: 392, height: height)
}
check("corner-same-as-before", [40, 152, 300, 2000].allSatisfy { NoteDrop.corner(visible: redVisible, height: $0) == oldCorner(redVisible, $0) })

// MARK: around the notch, at the top centre
let a1 = NoteDrop.Anchor(island: dropIsland, visible: redVisible)
let s1 = spotOf(NoteDrop.home(a1, cap: cap))
check("notch-hangs-below", s1?.side == .below)
check("notch-centred", s1.map { near($0.x, 855 - 196) && near($0.islandX, 196) && near($0.islandW, 300) } == true, "\(String(describing: s1))")
check("notch-top-just-under-island", s1.map { $0.edgeY <= dropIsland.minY - NoteDrop.gap + 0.5 && $0.edgeY >= dropIsland.minY - NoteDrop.gap - 1 } == true)
check("notch-room-is-cap", s1.map { near($0.room, cap) } == true, "\(String(describing: s1?.room))")
let one = NoteDrop.stackHeight([120], cap: s1!.room)
let f1 = NoteDrop.frame(s1!, height: one)
check("notch-one-card-frame", near(f1.height, 8 + 120 + 20 + 4) && near(f1.maxY, s1!.edgeY) && near(f1.width, 392), "\(f1)")
check("notch-never-over-island", clear(f1, dropIsland))
check("notch-on-screen", inside(f1, redVisible))

// Slim and Halo end in the menu bar, at the notch's bottom: the stack starts just under the menu bar.
let slim = CGRect(x: 855 - 138, y: 1112 - 37.5, width: 276, height: 37.5)
let s2 = spotOf(NoteDrop.home(.init(island: slim, visible: redVisible), cap: cap))!
check("slim-below-menu-bar", s2.side == .below && s2.edgeY <= redVisible.maxY + 0.5 && clear(NoteDrop.frame(s2, height: 200), slim))

// MARK: the pill on a Mac with no notch (1440 x 900, menu bar 24, Dock hidden)
let m1Visible = CGRect(x: 0, y: 0, width: 1440, height: 876)
let pill = CGRect(x: 720 - 165, y: 900 - 30 - 34, width: 330, height: 34)
let s3 = spotOf(NoteDrop.home(.init(island: pill, visible: m1Visible), cap: (876 * 0.45).rounded()))!
let f3 = NoteDrop.frame(s3, height: 300)
check("pill-no-notch-below", s3.side == .below && near(s3.x, 720 - 196) && near(s3.islandW, 330))
check("pill-no-notch-clear", clear(f3, pill) && inside(f3, m1Visible) && near(pill.minY - f3.maxY, NoteDrop.gap, 0.6), "\(f3) \(pill)")

// MARK: moved anywhere (G Squad): the cards come from where it is, never off the screen
// (The island keeps its centre 240 points from a side itself; the clamp is for anything closer, and for a wide open shape.)
check("moved-not-clamped-when-room", spotOf(NoteDrop.home(.init(island: CGRect(x: 75, y: 700, width: 330, height: 34), visible: redVisible), cap: cap)).map { near($0.islandX, 196) } == true)
let leftPill = CGRect(x: 15, y: 700, width: 330, height: 34)            // closer to the left side than the window's half
let s4 = spotOf(NoteDrop.home(.init(island: leftPill, visible: redVisible), cap: cap))!
check("moved-left-clamped", near(s4.x, NoteDrop.edge) && near(s4.islandX, leftPill.midX - NoteDrop.edge), "\(s4)")
let rightPill = CGRect(x: 1710 - 15 - 330, y: 700, width: 330, height: 34)
let s5 = spotOf(NoteDrop.home(.init(island: rightPill, visible: redVisible), cap: cap))!
check("moved-right-clamped", near(s5.x + NoteDrop.width, 1710 - NoteDrop.edge) && near(s5.islandX, rightPill.midX - s5.x))
check("moved-left-right-on-screen", inside(NoteDrop.frame(s4, height: 400), redVisible) && inside(NoteDrop.frame(s5, height: 400), redVisible))

// Lower half, close to the Dock: too little room below, so the stack goes above the island.
let lowPill = CGRect(x: 600, y: 66 + 40, width: 330, height: 34)
let s6 = spotOf(NoteDrop.home(.init(island: lowPill, visible: redVisible), cap: cap))!
let f6 = NoteDrop.frame(s6, height: NoteDrop.stackHeight([110, 140, 90], cap: s6.room))
check("low-goes-above", s6.side == .above && near(s6.edgeY, (lowPill.maxY + NoteDrop.gap).rounded()))
check("low-above-clear-and-on-screen", clear(f6, lowPill) && inside(f6, redVisible) && near(f6.minY, s6.edgeY), "\(f6)")
check("low-above-room-is-cap", near(s6.room, cap))

// Middle of the screen: below while there is enough room (at least minRoom, or more than above).
let midPill = CGRect(x: 600, y: 520, width: 330, height: 34)
let s7 = spotOf(NoteDrop.home(.init(island: midPill, visible: redVisible), cap: cap))!
check("middle-below-room-limited", s7.side == .below && near(s7.room, min(cap, (midPill.minY - NoteDrop.gap - redVisible.minY - NoteDrop.far).rounded(.down))), "\(s7.room)")
let f7 = NoteDrop.frame(s7, height: 2000)
check("middle-never-past-room", near(f7.height, s7.room) && inside(f7, redVisible) && clear(f7, midPill), "\(f7)")

// MARK: things that are no anchor (the corner instead)
check("island-on-other-screen-corner", NoteDrop.home(.init(island: CGRect(x: 2500, y: 1000, width: 330, height: 34), visible: redVisible), cap: cap) == .corner)
check("tiny-screen-corner", NoteDrop.home(.init(island: CGRect(x: 10, y: 300, width: 200, height: 34), visible: CGRect(x: 0, y: 0, width: 380, height: 400)), cap: 180) == .corner)
check("broken-numbers-corner", NoteDrop.home(.init(island: CGRect(x: CGFloat.nan, y: 0, width: 330, height: 34), visible: redVisible), cap: cap) == .corner)
check("zero-island-corner", NoteDrop.home(.init(island: CGRect(x: 600, y: 600, width: 0, height: 0), visible: redVisible), cap: cap) == .corner)

// MARK: stacking (the page's layout(), newest first)
check("stack-none", NoteDrop.stackHeight([], cap: cap) == 0)
check("stack-one-no-bar", near(NoteDrop.stackHeight([100], cap: cap), 8 + 100 + 20 + 4))
check("stack-two-with-bar", near(NoteDrop.stackHeight([100, 80], cap: cap), 8 + 38 + 100 + 10 + 80 + 20 + 4))
check("stack-capped", near(NoteDrop.stackHeight(Array(repeating: 120, count: 12), cap: cap), cap))
check("stack-small-cap-floor", near(NoteDrop.stackHeight(Array(repeating: 120, count: 12), cap: 100), 160 + 4))
let tops = NoteDrop.cardTops([100, 80, 60])
check("stack-newest-top-under-bar", tops == [46, 156, 246], "\(tops)")
check("stack-single-at-top", NoteDrop.cardTops([90]) == [8])
// Several cards under the island stay one neat column under it, newest nearest the island.
let many = NoteDrop.frame(s1!, height: NoteDrop.stackHeight([120, 100, 140, 90], cap: s1!.room))
check("stack-under-island-column", near(many.midX, dropIsland.midX) && clear(many, dropIsland) && inside(many, redVisible))

// MARK: moves
check("jump-corner-to-island", NoteDrop.jump(.corner, .island(s1!)) && NoteDrop.jump(.island(s1!), .corner))
check("no-jump-corner", !NoteDrop.jump(.corner, .corner))
var nudged = s1!; nudged.edgeY -= 40
check("glide-small-move", !NoteDrop.jump(.island(s1!), .island(nudged)))
check("jump-below-to-above", NoteDrop.jump(.island(s1!), .island(s6)))
check("jump-far-move", NoteDrop.jump(.island(s4), .island(s5)))
check("moved-sub-point-is-not", !NoteDrop.moved(f1, f1.offsetBy(dx: 0.2, dy: -0.3)) && NoteDrop.moved(f1, f1.offsetBy(dx: 0, dy: 2)))

// MARK: the developer's top left island (12 Nov 2026, his M4): moved to the top left, just under the menu bar
let topLeft = CGRect(x: 240 - 165, y: redVisible.maxY - 6 - 34, width: 330, height: 34)
let s8 = spotOf(NoteDrop.home(.init(island: topLeft, visible: redVisible), cap: cap))!
let f8 = NoteDrop.frame(s8, height: NoteDrop.stackHeight([120, 100], cap: s8.room))
check("top-left-hangs-below-it", s8.side == .below && near(s8.islandX, 196) && near(f8.midX, topLeft.midX) && clear(f8, topLeft) && inside(f8, redVisible), "\(f8)")
check("top-left-not-top-right", f8.maxX < redVisible.midX, "\(f8)")

// MARK: which stack each kind of card goes to (V1.55)
check("kind-mail", NoteDrop.kind(id: "m:r1", tone: "mail") == "mail" && NoteDrop.kind(id: "m:r2", tone: nil) == "mail")
check("kind-chats", NoteDrop.kind(id: "c:abc", tone: "done") == "chats")
check("kind-leads", NoteDrop.kind(id: "n:x", tone: "lead") == "leads")
check("kind-meetings", ["booked", "declined", "msg", "cancel", "soon", "soon-warn"].allSatisfy { NoteDrop.kind(id: "mb:1", tone: $0) == "meetings" })
check("kind-network", NoteDrop.kind(id: "net-vpn", tone: "warn") == "network" && NoteDrop.kind(id: "net-down", tone: nil) == "network" && NoteDrop.kind(id: "x", tone: "bad") == "network")
check("kind-mac-notices", ["ar:airpods", "bg:adding", "rr:1", "sk:allow", "rh:off", "ma:play"].allSatisfy { NoteDrop.kind(id: $0, tone: nil) == "mac" } && NoteDrop.kind(id: nil, tone: nil) == "mac")
check("kinds-listed", Set(["mail", "chats", "leads", "meetings", "network", "mac", "reminders", "update", "helper", "notes", "sound"]) == Set(NoteDrop.kinds))
check("own-window-kinds", NoteDrop.ownWindows == ["reminders", "update", "helper", "notes", "sound"] && NoteDrop.ownWindows.isSubset(of: Set(NoteDrop.kinds)))
check("route-own-windows-island-by-default", NoteDrop.ownWindows.allSatisfy { NoteDrop.route(kind: $0, island: true, top: []) })
check("route-own-window-usual-place", !NoteDrop.route(kind: "update", island: true, top: ["update"]) && NoteDrop.route(kind: "reminders", island: true, top: ["update"]))
check("route-own-windows-no-island-usual", NoteDrop.ownWindows.allSatisfy { !NoteDrop.route(kind: $0, island: false, top: []) })

// MARK: the column under the island (pop ups with windows of their own)
let colA = NoteDrop.Anchor(island: topLeft, visible: redVisible)
let rem = NoteDrop.columnFrame(colA, size: CGSize(width: 380, height: 150), offset: 0)!
let upd = NoteDrop.columnFrame(colA, size: CGSize(width: 420, height: 200), offset: NoteDrop.columnHeight([150]))!
check("column-first-under-island", near(rem.maxY, (topLeft.minY - NoteDrop.gap).rounded(), 0.6) && near(rem.midX, topLeft.midX, 0.6) && clear(rem, topLeft), "\(rem)")
check("column-keeps-own-size", near(rem.width, 380) && near(rem.height, 150) && near(upd.width, 420) && near(upd.height, 200))
check("column-second-under-first", near(upd.maxY, rem.minY - NoteDrop.colGap, 0.6) && !upd.insetBy(dx: 0.5, dy: 0.5).intersects(rem), "\(upd) \(rem)")
check("column-height", near(NoteDrop.columnHeight([]), 0) && near(NoteDrop.columnHeight([150, 200]), 150 + 200 + 2 * NoteDrop.colGap))
let stackAfter = NoteDrop.shifted(spotOf(NoteDrop.home(colA, cap: cap))!, by: NoteDrop.columnHeight([150, 200]))
let stackF = NoteDrop.frame(stackAfter, height: 152)
check("stack-starts-under-column", stackF.maxY <= upd.minY - NoteDrop.colGap + 0.6 && clear(stackF, topLeft) && !stackF.intersects(upd), "\(stackF) \(upd)")
check("stack-room-shrinks", near(stackAfter.room, cap - NoteDrop.columnHeight([150, 200])))
let lowCol = NoteDrop.columnFrame(.init(island: lowPill, visible: redVisible), size: CGSize(width: 380, height: 150), offset: 0)!
check("column-above-low-island", near(lowCol.minY, (lowPill.maxY + NoteDrop.gap).rounded(), 0.6) && clear(lowCol, lowPill) && inside(lowCol, redVisible), "\(lowCol)")
let wide = NoteDrop.columnFrame(.init(island: CGRect(x: 15, y: 900, width: 330, height: 34), visible: redVisible), size: CGSize(width: 520, height: 120), offset: 0)!
check("column-wide-window-on-screen", inside(wide, redVisible) && near(wide.minX, NoteDrop.edge), "\(wide)")
check("column-no-anchor", NoteDrop.columnFrame(.init(island: .zero, visible: redVisible), size: CGSize(width: 100, height: 100), offset: 0) == nil)
check("shift-zero-same", NoteDrop.shifted(s1!, by: 0) == s1!)
check("route-all-island-by-default", NoteDrop.kinds.allSatisfy { NoteDrop.route(kind: $0, island: true, top: []) })
check("route-top-right-choice", !NoteDrop.route(kind: "leads", island: true, top: ["leads"]) && NoteDrop.route(kind: "mail", island: true, top: ["leads"]))
check("route-no-island-all-corner", NoteDrop.kinds.allSatisfy { !NoteDrop.route(kind: $0, island: false, top: []) })

// MARK: a card's own time (the AI chat cards' line)
check("life-default-15", NoteDrop.life(15) == 15 && NoteDrop.life(15.0) == 15)
check("life-choices", [5, 10, 15, 30, 60].allSatisfy { NoteDrop.life($0) == $0 })
check("life-off-stays", NoteDrop.life(0) == nil && NoteDrop.life(nil) == nil && NoteDrop.life("15") == nil && NoteDrop.life(-5) == nil && NoteDrop.life(Double.nan) == nil)
check("life-clamped", NoteDrop.life(2) == nil && NoteDrop.life(5000) == 600)

// MARK: V1.56 hang fix (the developer, 13 Nov 2026: "My PS app keeps going unresponsive")
let spotA = CGRect(x: 659, y: 900, width: 460, height: 186), spotB = spotA.offsetBy(dx: 0, dy: -40)
check("put-new-window-arrives", NoteDrop.putStep(arrived: false, visible: false, alpha: 0, current: .zero, target: nil, to: spotA) == .arrive)
check("put-fading-in-never-arrives-again", NoteDrop.putStep(arrived: true, visible: true, alpha: 0, current: spotA.offsetBy(dx: 0, dy: 36), target: spotA, to: spotA) == .stay)
check("put-fading-in-glides-to-new-spot", NoteDrop.putStep(arrived: true, visible: true, alpha: 0.003, current: spotA, target: spotA, to: spotB) == .glide)
check("put-test-copy-alpha-0-stays", NoteDrop.putStep(arrived: true, visible: true, alpha: 0, current: spotA, target: spotA, to: spotA) == .stay)
check("put-hidden-window-arrives-again", NoteDrop.putStep(arrived: true, visible: false, alpha: 1, current: spotA, target: spotA, to: spotA) == .arrive)
check("put-showing-elsewhere-glides", NoteDrop.putStep(arrived: false, visible: true, alpha: 1, current: spotB, target: nil, to: spotA) == .glide)
// The V1.55 loop, played out: an arrival swells the island, the swell is an island change, the island change places
// the window again while it is still fading in. It must settle after one arrival, not loop.
do {
  var arrived = false, visible = false, alpha: CGFloat = 0, current = CGRect.zero, target: CGRect? = nil
  var arrivals = 0, changes = 1, rounds = 0
  while changes > 0 && rounds < 10_000 {
    changes -= 1; rounds += 1
    let step = NoteDrop.putStep(arrived: arrived, visible: visible, alpha: alpha, current: current, target: target, to: spotA)
    arrived = true; target = spotA
    if step == .arrive { arrivals += 1; visible = true; alpha = 0; current = spotA.offsetBy(dx: 0, dy: 36); changes += 1 }   // swell
  }
  check("put-loop-settles", arrivals == 1 && rounds < 5, "arrivals \(arrivals) rounds \(rounds)")
}
let anchorA = NoteDrop.Anchor(island: dropIsland, visible: redVisible)
check("follow-same-spot-same-key", NoteDrop.followKey(anchorA, top: []) == NoteDrop.followKey(.init(island: dropIsland.offsetBy(dx: 0.2, dy: 0), visible: redVisible), top: []))
check("follow-moved-island-new-key", NoteDrop.followKey(anchorA, top: []) != NoteDrop.followKey(.init(island: dropIsland.offsetBy(dx: 0, dy: -30), visible: redVisible), top: []))
check("follow-gone-new-key", NoteDrop.followKey(anchorA, top: []) != NoteDrop.followKey(nil, top: []))
check("follow-top-choice-new-key", NoteDrop.followKey(anchorA, top: []) != NoteDrop.followKey(anchorA, top: ["reminders"]))
check("follow-screen-new-key", NoteDrop.followKey(anchorA, top: []) != NoteDrop.followKey(.init(island: dropIsland, visible: redVisible.insetBy(dx: 0, dy: 20)), top: []))

// MARK: the page still uses the same numbers (Toast.swift)
let here = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : FileManager.default.currentDirectoryPath)
let toast = (try? String(contentsOf: here.appendingPathComponent("Sources/Toast.swift"), encoding: .utf8)) ?? ""
check("page-stack-numbers-match", toast.contains("var GAP=10,TOP=8,BOT=20,BAR=38,PAD=4,") && toast.contains("Math.max(160,maxH-PAD)"))
check("page-width-matches", toast.contains("private static let width: CGFloat = 392"))
check("page-life-line", toast.contains("animation-play-state:paused") && toast.contains(".card.held .life i") && toast.contains("c.timedOut=true;remove(c)") && toast.contains("timedOut:!!c.timedOut"))
check("page-timeout-is-not-dismiss", !toast.contains("answer(c,'timeout')") && toast.contains("case \"gone\":"))
check("page-has-island-mode", toast.contains("mode:function(m)") && toast.contains("body.up #wrap") && toast.contains("prefers-reduced-motion"))

// The windows use the hang fix (a plain text check: the window code itself needs AppKit and a screen).
let column = (try? String(contentsOf: here.appendingPathComponent("Sources/IslandColumn.swift"), encoding: .utf8)) ?? ""
let islandSrc = (try? String(contentsOf: here.appendingPathComponent("Sources/Island.swift"), encoding: .utf8)) ?? ""
check("column-uses-put-step", column.contains("NoteDrop.putStep(arrived:") && !column.contains("if w.isVisible && w.alphaValue > 0.01"))
check("island-follow-deduped", islandSrc.contains("NoteDrop.followKey(noteAnchor()") && islandSrc.contains("if follow != lastFollow"))
check("island-watch-coalesced", islandSrc.contains("!self.shapePending") && !islandSrc.contains("_ in DispatchQueue.main.async { self?.shapeChanged() }"))

print("\(count - fails)/\(count) passed")
exit(fails == 0 ? 0 : 1)
