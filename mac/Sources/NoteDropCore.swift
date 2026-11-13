import CoreGraphics

// Notifications out of the Dynamic Island (V1.55, the developer 12 Nov 2026: "if my dynamic island is on, then I want the
// notifications on the top right when I'm just using my computer, I want them to come out of the dynamic island
// instead with a nice animation"). Plain numbers, no windows and no screens, so tests/notedrop-test.sh checks it on any
// Mac without putting anything on the developer's screen. Toast.swift asks these where its one card window goes; Island.swift
// says where the island is.
//
// The rule:
//  1. No island to come from (switched off, the setting off, nothing to show, hidden by its grab line, over 1Password
//     or Signal, being dragged with no spot known yet): the top right corner, exactly as before. Over a full screen app
//     the island now shows (PS steps out of the Dock for it) and the cards come from it there too, in the black band at
//     the top left or wherever it sits.
//  2. Otherwise the window is centred under the island, its top `gap` below the island's resting shape (never the
//     hover view, which opens over the cards for a moment and closes again), kept `edge` from the screen's sides.
//  3. Too little room below (the island moved down near the bottom): the stack goes above the island instead, its
//     bottom `gap` above the island, and the page mirrors itself so the newest card is still the one next to the island.
//  4. Never taller than the cap (45% of the screen, as in the corner) or the room on its side, whichever is less.

enum NoteDrop {
  /// The window's width (Toast.width): the 364 point cards plus 14 points either side for their shadows.
  static let width: CGFloat = 392
  /// Between the island's resting shape and the window's edge (the page adds its own 8 point top margin).
  static let gap: CGFloat = 4
  /// The least gap to the screen's sides (the corner window sits 6 from the right edge too).
  static let edge: CGFloat = 6
  /// The least gap to the screen's top or bottom on the far side of the stack.
  static let far: CGFloat = 8
  /// Below this much room under the island the stack goes above it, if there is more room there.
  static let minRoom: CGFloat = 220
  /// The page's stack numbers (Toast.page layout(): GAP=10,TOP=8,BOT=20,BAR=38,PAD=4, and the list's least height 160).
  static let cardGap: CGFloat = 10, top: CGFloat = 8, bottom: CGFloat = 20, bar: CGFloat = 38, pad: CGFloat = 4, least: CGFloat = 160

  /// The island's resting shape and its screen's visible frame (Cocoa coordinates, bottom left origin, points).
  struct Anchor: Equatable { var island: CGRect; var visible: CGRect }
  enum Side: Equatable { case below, above }
  /// Where the stack hangs: its side, the window's left edge, the edge next to the island (the window's top when
  /// below, its bottom when above), the most height it may have, and the island's centre and width in page points.
  struct Spot: Equatable {
    var side: Side
    var x: CGFloat
    var edgeY: CGFloat
    var room: CGFloat
    var islandX: CGFloat
    var islandW: CGFloat
  }
  /// Where the cards go: the corner as always, or out of the island.
  enum Home: Equatable { case corner, island(Spot) }

  static func home(_ a: Anchor?, cap: CGFloat) -> Home {
    guard let a, valid(a) else { return .corner }
    return .island(spot(a, cap: cap))
  }
  static func valid(_ a: Anchor) -> Bool {
    let n = [a.island.minX, a.island.minY, a.island.width, a.island.height, a.visible.minX, a.visible.minY, a.visible.width, a.visible.height]
    return n.allSatisfy { $0.isFinite } && a.island.width > 0 && a.island.height > 0 && a.visible.width >= width + edge * 2 && a.visible.height > 100
      && a.island.intersects(a.visible.insetBy(dx: -1, dy: -60))   // an island on another screen is no anchor
  }

  static func spot(_ a: Anchor, cap: CGFloat) -> Spot {
    let v = a.visible, i = a.island
    let x = min(max(i.midX - width / 2, v.minX + edge), v.maxX - edge - width)
    // The island can sit up in the menu bar (around the notch): its bottom is still below the visible frame's top,
    // or the whole stack starts just under the menu bar.
    let belowTop = min(i.minY - gap, v.maxY)
    let roomBelow = max(0, belowTop - v.minY - far)
    let aboveBottom = max(i.maxY + gap, v.minY)
    let roomAbove = max(0, v.maxY - aboveBottom - far)
    let below = roomBelow >= min(minRoom, cap) || roomBelow >= roomAbove
    let room = max(0, min(cap, below ? roomBelow : roomAbove))
    return Spot(side: below ? .below : .above, x: x.rounded(), edgeY: (below ? belowTop : aboveBottom).rounded(), room: room.rounded(.down),
                islandX: (i.midX - x).rounded(), islandW: i.width.rounded())
  }

  /// The window for a stack `h` tall (what the page asks for), never past its room.
  static func frame(_ s: Spot, height h: CGFloat) -> CGRect {
    let hh = max(1, min(h, s.room))
    return s.side == .below ? CGRect(x: s.x, y: s.edgeY - hh, width: width, height: hh) : CGRect(x: s.x, y: s.edgeY, width: width, height: hh)
  }

  /// The corner window as it has always been (Toast.swift before V1.55).
  static func corner(visible v: CGRect, height h: CGFloat) -> CGRect {
    let hh = min(h, v.height - 16)
    return CGRect(x: v.maxX - width - 6, y: v.maxY - hh - 4, width: width, height: hh)
  }

  /// The height the page asks for with these cards (each card's own height, newest first) and this cap: the same sum as
  /// the page's layout() (the bar's room comes in with the second card; the list scrolls once it reaches the cap).
  static func stackHeight(_ cards: [CGFloat], cap: CGFloat) -> CGFloat {
    guard !cards.isEmpty else { return 0 }
    let content = top + (cards.count > 1 ? bar : 0) + cards.reduce(0, +) + cardGap * CGFloat(cards.count - 1) + bottom
    return min(content, max(least, cap - pad)) + pad
  }
  /// Where each card's top sits in the page (newest first), as the page lays them out.
  static func cardTops(_ cards: [CGFloat]) -> [CGFloat] {
    var y = top + (cards.count > 1 ? bar : 0), out: [CGFloat] = []
    for h in cards { out.append(y); y += h + cardGap }
    return out
  }

  // ---------- which stack (the developer, 12 Nov 2026: "decide which notifications actually pop out the dynamic island and which
  // notifications go on the top right") ----------
  /// The kinds of card the developer can send to the island or the top right (web src/core/island.ts CARD_KINDS).
  static let kinds = ["mail", "chats", "leads", "meetings", "network", "mac", "reminders", "update", "helper", "notes", "sound"]
  /// The pop ups with windows of their own (IslandColumn.swift): the 15 min and task reminders, the update card, the
  /// restart helper alert, the meeting notes card and the Soundboard card. Their "Top right" is their usual place.
  static let ownWindows: Set<String> = ["reminders", "update", "helper", "notes", "sound"]
  static let meetTones: Set<String> = ["booked", "declined", "msg", "cancel", "soon", "soon-warn"]
  static let netTones: Set<String> = ["ok", "warn", "bad", "info"]
  /// A card's kind from its id and tone: client emails (m:), AI chat cards (c:, tone done), Instantly lead replies
  /// (n:, tone lead), meeting alerts, network and VPN alarms, and everything else PS shows (AirPods, files, the
  /// restart helper, vault updates...).
  static func kind(id: String?, tone: String?) -> String {
    let i = id ?? ""
    if tone == "mail" || i.hasPrefix("m:") { return "mail" }
    if tone == "done" || i.hasPrefix("c:") { return "chats" }
    if tone == "lead" || i.hasPrefix("n:") { return "leads" }
    if let t = tone, meetTones.contains(t) { return "meetings" }
    if let t = tone, netTones.contains(t) { return "network" }
    if i.hasPrefix("net-") || i.hasPrefix("nl:") { return "network" }
    return "mac"
  }
  /// true: the island stack; false: the top right. Only while the island is there for cards (on screen, the main
  /// switch on, not hidden by its own rules), and only for a kind the developer has not sent to the top right.
  static func route(kind: String, island: Bool, top: [String]) -> Bool { island && !top.contains(kind) }

  /// A card's own time on screen in seconds (V1.55, the AI chat cards' "disappear by themselves"), or nil for a card
  /// that stays until it is answered. 3 seconds to 10 minutes; anything else (0, Off, nonsense) stays.
  static func life(_ v: Any?) -> Int? {
    let n: Double? = (v as? Int).map(Double.init) ?? (v as? Double)
    guard let x = n, x.isFinite, x >= 3 else { return nil }
    return Int(min(600, x.rounded()))
  }

  // ---------- the column under the island (V1.55, the developer: "Actually yes. But make it so you can change it all in settings") ----------
  // The pop ups with windows of their own settle under the island too, one under the other in the order they came, each
  // keeping its own size; the card stack starts under the last of them.
  /// Between two windows in the column.
  static let colGap: CGFloat = 6
  /// A window `size` big, `offset` points further from the island than the first place (the windows before it).
  static func columnFrame(_ a: Anchor, size: CGSize, offset: CGFloat) -> CGRect? {
    guard valid(a), size.width > 0, size.height > 0 else { return nil }
    let v = a.visible, i = a.island
    let x = min(max(i.midX - size.width / 2, v.minX + edge), v.maxX - edge - size.width)
    let side = spot(a, cap: v.height).side
    if side == .below {
      let top = min(i.minY - gap, v.maxY) - offset
      return CGRect(x: x.rounded(), y: (top - size.height).rounded(), width: size.width, height: size.height)
    }
    let bottom = max(i.maxY + gap, v.minY) + offset
    return CGRect(x: x.rounded(), y: bottom.rounded(), width: size.width, height: size.height)
  }
  /// How far the column reaches from the island: its windows' heights and the gaps, plus one gap before the stack.
  static func columnHeight(_ heights: [CGFloat]) -> CGFloat {
    heights.isEmpty ? 0 : heights.reduce(0, +) + colGap * CGFloat(heights.count)
  }
  /// The card stack's spot moved past the column (`d` points further from the island), with that much less room.
  static func shifted(_ s: Spot, by d: CGFloat) -> Spot {
    guard d > 0 else { return s }
    var t = s
    t.edgeY = s.side == .below ? s.edgeY - d : s.edgeY + d
    t.room = max(0, s.room - d)
    return t
  }

  /// What a pop up window under the island does when it is placed (IslandColumn.put). V1.56 hang fix (the developer, 13 Nov 2026:
  /// "My PS app keeps going unresponsive"): in V1.55 a window still fading in (alpha near 0) counted as new every time
  /// it was placed, so it started its arrival again, the arrival swelled the island, the swell was an island change,
  /// and the island change placed the window again: the main thread looped for good and the card never showed.
  /// A window that already made its entrance while it stays in the column now only glides (or stays), never arrives
  /// again, so an arrival can not lead to another arrival.
  enum PutStep: Equatable { case stay, glide, arrive }
  /// `arrived`: this window made its entrance and has stayed in the column since. `target`: where it was last sent.
  static func putStep(arrived: Bool, visible: Bool, alpha: CGFloat, current: CGRect, target: CGRect?, to f: CGRect) -> PutStep {
    if arrived && visible { return moved(target ?? current, f) ? .glide : .stay }
    if visible && alpha > 0.01 { return moved(current, f) ? .glide : .stay }   // already showing in its usual place
    return .arrive
  }

  /// What the cards and the pop ups under the island follow (Island.shapeChanged): the island's resting spot, its
  /// screen and which kinds the developer sent to the top right. The same text means nothing they follow changed, so a swell,
  /// a glow or the hover view no longer re-places every card window (V1.56 hang fix).
  static func followKey(_ a: Anchor?, top: [String]) -> String {
    let r = { (f: CGRect) in "\(Int(f.minX.rounded())),\(Int(f.minY.rounded())),\(Int(f.width.rounded())),\(Int(f.height.rounded()))" }
    return (a.map { r($0.island) + "|" + r($0.visible) } ?? "none") + "|" + top.joined(separator: ",")
  }

  /// Did the stack really move? Under a point is not worth a glide.
  static func moved(_ a: CGRect, _ b: CGRect) -> Bool {
    abs(a.minX - b.minX) > 0.5 || abs(a.minY - b.minY) > 0.5 || abs(a.width - b.width) > 0.5 || abs(a.height - b.height) > 0.5
  }
  /// A change of home that needs the quick fade (the corner to the island and back, or below to above): a glide across
  /// the screen would drag the cards over everything in between.
  static func jump(_ a: Home, _ b: Home) -> Bool {
    switch (a, b) {
    case (.corner, .corner): return false
    case let (.island(x), .island(y)): return x.side != y.side || abs(x.x - y.x) > 260 || abs(x.edgeY - y.edgeY) > 260
    default: return true
    }
  }
}
