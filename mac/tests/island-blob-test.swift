import Foundation
import CoreGraphics
// Run: bash tests/island-blob-test.sh
var n = 0, bad = 0
func ok(_ name: String, _ c: Bool) { n += 1; if c { print("ok - \(name)") } else { bad += 1; print("FAIL - \(name)") } }
// A fixed measure (no fonts): 5 points a letter at size 8.5, scaled with size; digits a little wider when bold.
let fake: BlobFit.Measure = { t, size, bold, digits in CGFloat(t.count) * size * (digits ? 0.62 : 0.55) }
let T = 1_763_024_400_000.0
func meet(_ title: String, in ms: Double, len: Double = 1_800_000, blob: Bool = true) -> TMeet {
  TMeet(id: "m1", title: title, start: T + ms, end: T + ms + len, from: T + ms - 900_000, link: nil, blob: blob)
}
let screen = CGRect(x: 0, y: 0, width: 1512, height: 982)

// ---------- the blob is exactly the island's height ----------
for h in [30.0, 31, 32, 34, 37, 40, 48] {
  let w = BlobFit.words(.meet(mode: "soon", m: meet("Weekly sync with the team", in: 600_000)), now: T)!
  let l = BlobFit.layout(height: CGFloat(h), words: w, measure: fake)
  ok("height \(h): the blob is exactly the island's height", l.height == CGFloat(h))
  ok("height \(h): the three lines fit inside it with room", BlobFit.contentHeight(l.sizes) + 2 * BlobFit.padY <= CGFloat(h) + 0.01)
}
ok("type never drops under 5.5 points, even on a tiny island", BlobFit.sizes(height: 12).icon >= 5.5 && BlobFit.sizes(height: 12).title >= 5.5 && BlobFit.sizes(height: 12).time >= 5.5)
ok("a taller island gets bigger type, never smaller", BlobFit.sizes(height: 40).title >= BlobFit.sizes(height: 34).title)
ok("the reference island (34) uses 7, 7.5 and 8", BlobFit.sizes(height: 34) == BlobFit.Sizes(icon: 7, title: 7.5, time: 8))

// ---------- about half the old pill ----------
let wMid = BlobFit.words(.meet(mode: "soon", m: meet("Weekly sync", in: 600_000)), now: T)!
let blobMid = BlobFit.layout(height: 34, words: wMid, measure: fake)
let pillW = BubbleFit.size(BubbleFit.pieces(.meet(mode: "soon", m: meet("Weekly sync", in: 600_000)), now: T), measure: { _ in 70 })   // the pill's pieces at a fixed 70
ok("a short meeting: the blob is clearly smaller than the long pill's area", blobMid.width * blobMid.height < pillW.width * BubbleFit.h * 0.9)
ok("the blob's width stays between its limits", blobMid.width >= BlobFit.widthMin && blobMid.width <= BlobFit.widthMax)
let wLong = BlobFit.words(.meet(mode: "soon", m: meet("A very long meeting name about the quarterly planning of everything", in: 600_000)), now: T)!
let blobLong = BlobFit.layout(height: 34, words: wLong, measure: fake)
ok("a long name is shortened, the blob never grows past its maximum", blobLong.width == BlobFit.widthMax && blobLong.titleW != nil && blobLong.titleW! <= BlobFit.widthMax - 2 * BlobFit.padX)
ok("a short name is shown whole", blobMid.titleW == nil)
let wTiny = BlobFit.words(.meet(mode: "soon", m: meet("1:1", in: 60_000)), now: T)!
ok("a tiny name does not make it thinner than the minimum", BlobFit.layout(height: 34, words: wTiny, measure: fake).width == BlobFit.widthMin)
ok("little room on the screen's side: never wider than the room (but the minimum holds)", BlobFit.layout(height: 34, words: wLong, room: 60, measure: fake).width == 60 && BlobFit.layout(height: 34, words: wLong, room: 10, measure: fake).width == BlobFit.widthMin)
ok("the corner is rounded in proportion to the height, never more than half the width", blobMid.radius == 34 / 2.6 && BlobFit.layout(height: 12, words: wTiny, measure: fake).radius <= 12 / 2)

// ---------- the words ----------
ok("soon: the name and the time to start", BlobFit.words(.meet(mode: "soon", m: meet("Sync", in: 600_000)), now: T) == BlobFit.Words(title: "Sync", time: "10m", timeWide: BubbleFit.widestLeft(600_000)))
ok("join: Join and the time to start", BlobFit.words(.meet(mode: "join", m: meet("Sync", in: 90_000)), now: T)?.title == "Join" && BlobFit.words(.meet(mode: "join", m: meet("Sync", in: 90_000)), now: T)?.time == "2m")
ok("now: the name and the time left", BlobFit.words(.meet(mode: "now", m: meet("Sync", in: -600_000)), now: T)?.time == "20m left")
ok("the count down is measured at its widest so it never cuts", { let w = BlobFit.words(.meet(mode: "soon", m: meet("Sync", in: 3_000_000)), now: T)!; return BubbleFit.shapeW(w.timeWide) >= BubbleFit.shapeW(w.time) }())
ok("a stand-up count down or nothing is not a blob", BlobFit.words(.standSoon(at: T + 10_000), now: T) == nil && BlobFit.words(.none, now: T) == nil)

// ---------- where it goes ----------
let island = CGRect(x: 656, y: 982 - 37, width: 200, height: 37)   // Cocoa coordinates, at the top centre
let spotR = BlobFit.place(width: 70, island: island, screen: screen)
ok("it sits on the island's right end, the same bottom and top, so exactly its height", spotR.side == .right && spotR.frame.minY == island.minY && spotR.frame.maxY == island.maxY && spotR.frame.height == island.height)
ok("it nearly touches the island (blended in)", spotR.frame.minX - island.maxX == BlobFit.gap && BlobFit.gap < BubbleFit.gap)
let nearRight = CGRect(x: 1330, y: 982 - 37, width: 200, height: 37)
let spotL = BlobFit.place(width: 70, island: nearRight, screen: screen)
ok("no room on the right: the left end", spotL.side == .left && spotL.frame.maxX == nearRight.minX - BlobFit.gap && spotL.frame.minY == nearRight.minY)
let tiny = CGRect(x: 0, y: 0, width: 220, height: 400)
let spotB = BlobFit.place(width: 120, island: CGRect(x: 40, y: 360, width: 150, height: 34), screen: tiny)
ok("a tiny screen: just below the island, on screen, still the island's height", spotB.side == .below && spotB.frame.height == 34 && spotB.frame.minX >= tiny.minX + BlobFit.edge && spotB.frame.maxX <= tiny.maxX - BlobFit.edge)
ok("room is the bigger side", BlobFit.room(island: island, screen: screen) == screen.maxX - BlobFit.edge - (island.maxX + BlobFit.gap) || BlobFit.room(island: island, screen: screen) == island.minX - BlobFit.gap - (screen.minX + BlobFit.edge))
let f = BlobFit.fit(.meet(mode: "soon", m: meet("Sync", in: 600_000)), now: T, island: island, screen: screen, measure: fake)
ok("fit: a blob meeting gets a layout and a spot of the island's height", f != nil && f!.0.height == island.height && f!.1.frame.height == island.height && f!.0.width == f!.1.frame.width)
ok("fit: the long pill choice is left to the old pill", BlobFit.fit(.meet(mode: "soon", m: meet("Sync", in: 600_000, blob: false)), now: T, island: island, screen: screen, measure: fake) == nil)
ok("fit: not for a stand-up count down", BlobFit.fit(.standSoon(at: T + 10_000), now: T, island: island, screen: screen, measure: fake) == nil)
ok("fit: an island too small to read is left to the old pill", BlobFit.fit(.meet(mode: "soon", m: meet("Sync", in: 600_000)), now: T, island: CGRect(x: 0, y: 0, width: 100, height: 20), screen: screen, measure: fake) == nil)
// the real font measure runs and gives sensible widths
let real = BlobFit.measure("Weekly sync", 7.5, false, false)
ok("the real font measure gives a width", real > 20 && real < 90)
let realFit = BlobFit.layout(height: 34, words: wMid, measure: BlobFit.measure)
ok("with real fonts the three lines fit the blob's width", realFit.width <= BlobFit.widthMax && BlobFit.measure(wMid.timeWide, realFit.sizes.time, true, true) <= realFit.width - 2 * BlobFit.padX + 2)

// ---------- the page's style reaches the Mac ----------
let dict: [String: Any] = ["id": "a", "title": "Sync", "start": T + 600_000, "end": T + 2_400_000, "from": T]
func parse(_ style: Any?) -> TMeet? { var d = dict; if let style { d["style"] = style }; return TimersCore.from(["meet": d]).meet }
ok("style blob or missing: a blob", parse("blob")?.blob == true && parse(nil)?.blob == true && parse(7)?.blob == true)
ok("style pill: the old long pill", parse("pill")?.blob == false)

// ---------- the taller stand-up island ----------
ok("the figure's highest point is at least 8 points under the words", StandFaceLayout.clearance() >= 8 && StandFaceLayout.minClear >= 8)
ok("the old layout ran into the words (2 points of space, 5 of overshoot): the check would have caught it", (2 + 0 - StandFaceLayout.overshoot(70)) < StandFaceLayout.minClear)
ok("taller than before: 124 for the pill, 112 below the notch", StandFaceLayout.height(pill: true) > 124 && StandFaceLayout.height(pill: false) > 112)
ok("the pill is a little taller than the notch body, as before", StandFaceLayout.height(pill: true) - StandFaceLayout.height(pill: false) == StandFaceLayout.topPad(pill: true) - StandFaceLayout.topPad(pill: false))
ok("the whole stack adds up to the height: top, words, spaces, box, bottom", StandFaceLayout.height(pill: true) == 12 + 14 + 2 + StandFaceLayout.lift + 2 + 78 + 14)
ok("the overshoot follows the man's size", StandFaceLayout.overshoot(70) == 6 && StandFaceLayout.overshoot(30) == 3 && StandFaceLayout.overshoot(100) == 8)
ok("his feet stay inside the island with room", StandFaceLayout.feetClear(pill: true) >= 10 && StandFaceLayout.feetClear(pill: false) >= 10)
ok("it is still narrower than the open island, rounder", StandFaceLayout.faceW == 236 && StandFaceLayout.radius == 36)
print(bad == 0 ? "ALL \(n) PASSED" : "\(bad) of \(n) FAILED")
exit(bad == 0 ? 0 : 1)
