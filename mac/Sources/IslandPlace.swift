import Foundation
import CoreGraphics
import AppKit

// The Dynamic Island's placement math (V1.44): plain numbers, no windows and no screens, so
// tests/island-place-test.swift checks it on any Mac without putting anything on the developer's screen.
// Island.swift reads the screens, the pointer and the window list, and asks these where the island goes.
//
// Over a full screen app on a screen with a notch the island sits in the black bar left of the notch (V1.40), one
// line, covering nothing of the app. The developer, 9 Nov 2026: "for some reason this thing doesn't go on the side when i am on
// full screen mode, only when I am not on full screen". Three things were wrong:
//  - only an app window starting exactly below the notch counted. A browser in full screen (Brave, Chrome) can fill
//    the whole screen instead, so the island stayed at the top centre over its tabs;
//  - a big ordinary window (below the menu bar, down to the bottom) looked the same as a full screen app, so on the
//    desktop the island jumped into the menu bar and covered the menus;
//  - the check ran only at a space or app switch while the island was showing, and gave up after 1.6 s, so an
//    island that came back later, or a slow full screen animation, kept the wrong place.
// Now: the front app's window over the screen (below the notch or the whole screen) AND the menu bar hidden on that
// screen means full screen; the check also runs when the island comes back, when screens change and once more at 3 s.
//
// Full screen, part two (the developer, 12 Nov 2026, a friend's MacBook with a notch): "the island disappears completely when the
// front app is in full screen". Root cause: PS is a Dock app (activation policy .regular), and macOS never layers a
// Dock app's windows over another app's full screen Space, whatever the window's level or collection behaviour says
// (Apple DTS on the developer forums, thread 826308: "macOS doesn't layer regular foreground apps above other apps'
// full-screen Spaces"; Electron hides the Dock icon for the same reason in setVisibleOnAllWorkspaces). The window was
// set up right, so the island simply was not drawn there, and none of the V1.40 to V1.44 bar logic could show.
// Fix: while a full screen app is in front on the island's screen, PS steps out of the Dock (.accessory, the policy
// overlay utilities use), and steps back in the moment it ends (IslandPlace.presence). In full screen the Dock and the
// menu bar are hidden anyway, so nothing of PS goes missing that could be seen. Then the developer's wish: "make it so the
// dynamic island does a fancy animation so it moves itself up to the top left of the screen instead": it glides into
// the black band left of the notch (IslandPlace.glide), and back to its place or its moved spot when full screen ends.

/// Where the notch is, read live from the screen (never hard coded). No notch: a pill at the top centre.
struct IslandGeo: Equatable {
  var notch = false
  var notchW: CGFloat = 0
  var notchH: CGFloat = 32
  var menuH: CGFloat = 24
  var centerX: CGFloat = 0
  var frame = CGRect.zero
  /// The notch's left edge on screen, and the width of the clear strip left of it (NSScreen.auxiliaryTopLeftArea):
  /// where the island sits over a full screen app (V1.40).
  var notchLeft: CGFloat = 0
  var leftW: CGFloat = 0

  /// From one screen's numbers (bottom left origin, as NSScreen gives them): its frame and visible frame, the camera
  /// inset (safeAreaInsets.top) and the clear strips either side of the camera (auxiliaryTopLeftArea, ...RightArea).
  static func make(frame: CGRect, visible: CGRect, inset: CGFloat, left: CGRect?, right: CGRect?) -> IslandGeo {
    var g = IslandGeo()
    g.frame = frame
    g.centerX = frame.midX
    g.menuH = menuHeight(frame: frame, visible: visible, inset: inset)
    if inset > 0, let l = left, let r = right, r.minX > l.maxX {
      // The two clear strips either side of the camera: the gap between them is the notch. macOS has given them both
      // relative to the screen and in global points; strips that already lie inside the frame are global.
      let global = l.minX >= frame.minX - 1 && r.maxX <= frame.maxX + 1
      let dx = global ? 0 : frame.minX
      g.notch = true
      g.notchW = r.minX - l.maxX
      g.notchH = inset
      g.centerX = dx + (l.maxX + r.minX) / 2
      g.notchLeft = dx + l.maxX
      g.leftW = l.width
    }
    return g
  }

  /// The menu bar's height. With the menu bar hidden (a full screen space, or set to hide) the visible frame reaches
  /// the top: then the notch's height on a notched screen, else the usual 24, so a moved island never jumps when the
  /// menu bar comes and goes.
  static func menuHeight(frame: CGRect, visible: CGRect, inset: CGFloat) -> CGFloat {
    let mh = frame.maxY - visible.maxY
    if mh > 4 { return mh }
    return inset > 0 ? inset.rounded(.up) : 24
  }
}

/// Where the island is over a full screen app on a screen with a notch (V1.40).
enum FullScreenPlace { case off, bar, dropped }

enum IslandPlace {
  static let panelW: CGFloat = 480, panelH: CGFloat = 270
  /// Moved: the gap between the pill and the panel's edge, and the least gap to the screen's edge.
  static let freeGap: CGFloat = 6, screenGap: CGFloat = 8

  // ---------- full screen ----------

  /// What the front app's windows say: one over the whole screen, one below the notch's black bar, or neither.
  enum Kind: Equatable { case none, whole, belowNotch }
  /// The menu bar on the island's screen: showing, hidden (a full screen space, or slid up), or not known.
  enum MenuBar: Equatable { case shown, hidden, unknown }

  /// The screen in window list coordinates (top left origin of the main screen) from its Cocoa frame.
  static func cgRect(_ frame: CGRect, primaryH: CGFloat) -> CGRect {
    CGRect(x: frame.minX, y: primaryH - frame.maxY, width: frame.width, height: frame.height)
  }

  /// The front app's windows (window list bounds, layer 0) against the screen (window list coordinates): a window
  /// as wide as the screen down to its bottom, starting at its top (the whole screen) or just below the notch.
  static func kind(_ windows: [CGRect], screen t: CGRect, inset: CGFloat) -> Kind {
    var best = Kind.none
    for r in windows {
      guard abs(r.minX - t.minX) < 2, abs(r.width - t.width) < 2, abs(r.maxY - t.maxY) < 2 else { continue }
      let top = r.minY - t.minY
      if abs(top) < 2 { return .whole }
      if inset > 0, abs(top - inset) < 8 { best = .belowNotch }
    }
    return best
  }

  /// One window at the main menu level (layer 24) on screen: where it is, and its name ("Menubar", or the black
  /// "Backstop Menubar" some spaces keep behind it). Only these windows' names are ever read, never an app's.
  struct BarWindow: Equatable { var bounds: CGRect; var name: String? }
  /// Is the menu bar showing on this screen (window list coordinates)? A "Menubar" window at the screen's top is the
  /// menu bar showing; slid up above the screen, or not on screen at all, it is hidden. No names at all: not known.
  /// `visibleReachesTop`: the screen's visible frame goes up to its top edge, which macOS only gives while the menu bar
  /// is hidden there; either sign of a hidden menu bar is enough.
  static func menuBar(_ bars: [BarWindow], screen t: CGRect, visibleReachesTop: Bool = false) -> MenuBar {
    if visibleReachesTop { return .hidden }
    let here = bars.filter { $0.bounds.maxX > t.minX + 1 && $0.bounds.minX < t.maxX - 1 && $0.bounds.width > 40 }
    if !here.isEmpty, here.allSatisfy({ $0.name == nil }) { return .unknown }
    let menus = here.filter { $0.name == "Menubar" }
    if menus.contains(where: { abs($0.bounds.minY - t.minY) < 2 && $0.bounds.height > 4 }) { return .shown }
    return .hidden
  }

  /// Full screen or not. A full screen like window with the menu bar showing is a big ordinary window on the desktop
  /// (the island stays out of the menu bar), unless the island already knew it was over a full screen app and the
  /// pointer is up at the top: that is the menu bar sliding down over the app, so nothing changes.
  static func decide(_ windows: Kind, menu: MenuBar, pointerAtTop: Bool, previous: Kind) -> Kind {
    guard windows != .none else { return .none }
    switch menu {
    case .hidden, .unknown: return windows
    case .shown: return previous != .none && pointerAtTop ? previous : .none
    }
  }

  /// The pointer is in the menu bar's band at the top of the screen (Cocoa coordinates).
  static func pointerAtTop(_ p: CGPoint, screen: CGRect, band: CGFloat) -> Bool {
    p.x >= screen.minX && p.x <= screen.maxX && p.y >= screen.maxY - band - 2 && p.y <= screen.maxY + 1
  }

  /// In the black bar left of the notch, dropped just below the menu bar while it is down, or as on the desktop.
  /// Only on a screen with a notch, never when macOS keeps the menu bar showing in full screen, and never with
  /// "Move to the top left in full screen" switched off (settings.island.fsMove): then it stays where it is, dimmed.
  static func place(_ k: Kind, notch: Bool, menuAlways: Bool, menuDown: Bool, move: Bool = true) -> FullScreenPlace {
    guard k != .none, notch, !menuAlways, move else { return .off }
    return menuDown ? .dropped : .bar
  }

  // ---------- over full screen apps at all (the root cause above) ----------

  /// PS in the Dock as always, or out of it while a full screen app is in front (the only way macOS draws a PS
  /// window over another app's full screen Space).
  enum Presence: Equatable { case dock, overFullScreen }
  /// Out of the Dock only while the island is on and a full screen app is in front of its screen; back in the Dock the
  /// moment that ends. PS itself in front (the Tab list, Settings): the space did not change, so it stays as it is,
  /// unless the menu bar is showing on that screen (a desktop): then PS gets its Dock icon and menus back at once.
  static func presence(fullScreen: Bool, islandOn: Bool, psFront: Bool, menuBarHere: Bool, now: Presence) -> Presence {
    if psFront { return now == .overFullScreen && menuBarHere ? .dock : now }
    return fullScreen && islandOn ? .overFullScreen : .dock
  }

  // ---------- the glide (the developer: "a fancy animation") ----------

  /// How the island travels between its place and the black band: how long, the window's timing curve (a long, soft
  /// ease out: fast away, a slow settle), and how far the shape leans into the move (signed: below 0 it travels left).
  /// Longer trips take a little longer, never under 0.42 s or over 0.75 s. Reduce motion: no travel, a quick fade.
  struct Glide: Equatable { var duration: Double; var curve: [Float]; var stretch: CGFloat }
  static let glideCurve: [Float] = [0.16, 1, 0.3, 1]
  static func glide(from a: CGRect, to b: CGRect, reduceMotion: Bool) -> Glide {
    let d = hypot(b.midX - a.midX, b.midY - a.midY)
    if reduceMotion { return Glide(duration: 0.2, curve: [0.4, 0, 0.2, 1], stretch: 0) }
    if d < 1 { return Glide(duration: 0.28, curve: [0.2, 0.9, 0.3, 1], stretch: 0) }
    let dur = min(0.75, max(0.42, 0.36 + Double(d) / 900))
    let lean = min(1, d / 260) * (b.midX < a.midX - 0.5 ? -1 : 1)
    return Glide(duration: (dur * 100).rounded() / 100, curve: glideCurve, stretch: (lean * 1000).rounded() / 1000)
  }
  /// The lean as the shape draws it: wider along the way and a touch flatter, pulled from the side it leaves.
  static func leanScale(_ t: CGFloat) -> (x: CGFloat, y: CGFloat) { (1 + abs(t) * 0.14, 1 - abs(t) * 0.08) }

  // ---------- every desktop (the developer, 12 Nov 2026) ----------
  // "I just used the moving in the gray bar feature and when I moved it around the screen and put it back to where it
  // was and then I switched to a different desktop through Mission Control, it doesn't follow me around my desktop
  // anymore." A drag on the grab line moves the island's own window while the mouse button is down, and macOS treats
  // that like any window the user carries by hand: when the drag ends the window can be left on the one desktop it was
  // dropped on. AppKit still reads the same behaviour back, so nothing on PS's side noticed. Island.swift now joins
  // every desktop again after a drag, a put back and Edit mode, and on every desktop change it checks the island is on
  // the desktop in front (if not, it is ordered out and straight back in there).

  /// The island's place among desktops: on every desktop and over full screen apps, left where it is by Mission
  /// Control, never in the window cycle. Never .moveToActiveSpace (AppKit refuses it with .canJoinAllSpaces).
  /// .canJoinAllApplications (macOS 13): an auxiliary window of every app's Space, as Apple advises for overlays.
  static let spaces: NSWindow.CollectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .canJoinAllApplications, .stationary, .ignoresCycle]

  /// Is the island showing but missing from the desktop in front? Then it is put back on every desktop and ordered in
  /// there. Never in the middle of a drag (the pointer owns the window then), never while it is meant to be away.
  static func rejoin(visible: Bool, onActiveSpace: Bool, dragging: Bool) -> Bool { visible && !onActiveSpace && !dragging }

  // ---------- the panel ----------

  /// The bar's island: as wide as fits left of the notch, never wider than the pill.
  static func barW(_ g: IslandGeo) -> CGFloat { min(340, max(150, g.leftW - 24)) }

  /// The area the pill's centre may take: the screen below the menu bar, less the gaps, and so the panel (and the
  /// island open inside it) is never past a side.
  static func room(_ g: IslandGeo, pillH: CGFloat) -> CGRect {
    let top = g.frame.maxY - g.menuH - screenGap - pillH / 2, bottom = g.frame.minY + screenGap + pillH / 2
    let left = g.frame.minX + panelW / 2, right = g.frame.maxX - panelW / 2
    return CGRect(x: left, y: bottom, width: max(0, right - left), height: max(0, top - bottom))
  }
  /// The pill's centre on screen for a kept spot.
  static func center(_ p: CGPoint, _ g: IslandGeo, pillH: CGFloat) -> CGPoint {
    let r = room(g, pillH: pillH)
    return CGPoint(x: r.minX + p.x * r.width, y: r.minY + p.y * r.height)
  }
  /// The kept spot for a pill centre on screen (clamped to the room).
  static func spot(_ c: CGPoint, _ g: IslandGeo, pillH: CGFloat) -> CGPoint {
    let r = room(g, pillH: pillH)
    let x = r.width > 0 ? (c.x - r.minX) / r.width : 0.5, y = r.height > 0 ? (c.y - r.minY) / r.height : 1
    return CGPoint(x: min(1, max(0, (x * 10000).rounded() / 10000)), y: min(1, max(0, (y * 10000).rounded() / 10000)))
  }

  /// The bar island's centre across: its right end 10 points left of the notch.
  static func barMid(_ g: IslandGeo) -> CGFloat { g.notchLeft - 10 - barW(g) / 2 }
  /// The panel's frame: in the black bar (its right end just left of the notch), home at the top centre, or round
  /// the moved pill (its top or bottom edge freeGap from the pill). Over a full screen app the moved spot waits.
  /// Dropped below the menu bar while it is down: under the same spot as the bar, so it only drops, never jumps back
  /// to the centre (kept on the screen).
  static func frame(_ fs: FullScreenPlace, _ g: IslandGeo, pos: CGPoint?, pillH: CGFloat) -> CGRect {
    if fs == .bar || fs == .dropped {
      var x = barMid(g) - panelW / 2
      if fs == .dropped { x = min(max(x, g.frame.minX), g.frame.maxX - panelW) }
      return CGRect(x: x, y: g.frame.maxY - panelH, width: panelW, height: panelH)
    }
    guard let p = pos, fs == .off else {
      return CGRect(x: g.centerX - panelW / 2, y: g.frame.maxY - panelH, width: panelW, height: panelH)
    }
    let c = center(p, g, pillH: pillH)
    let y = p.y < 0.5 ? c.y - pillH / 2 - freeGap : c.y + pillH / 2 + freeGap - panelH
    return CGRect(x: c.x - panelW / 2, y: y, width: panelW, height: panelH)
  }
}
