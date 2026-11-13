// Offline test for Sources/IslandPlace.swift (V1.44, the island over full screen apps): where the notch is, the menu
// bar height, full screen or not, and where the island's panel goes. Never starts PS, never opens a window.
//   mkdir -p build/islandplace && cp tests/island-place-test.swift build/islandplace/main.swift && swiftc build/islandplace/main.swift Sources/IslandPlace.swift -o build/islandplace/test && build/islandplace/test
import Foundation
import CoreGraphics
import AppKit

var fails = 0, count = 0
func check(_ name: String, _ ok: Bool, _ info: String = "") { count += 1; print("\(name)=\(ok ? "ok" : "FAIL")\(info.isEmpty || ok ? "" : " (\(info))")"); if !ok { fails += 1 } }
func near(_ a: CGFloat, _ b: CGFloat) -> Bool { abs(a - b) < 0.01 }

// The developer's 15 inch MacBook Air as macOS reports it (9 Nov 2026): 1710 x 1112, the Dock 66 high at the bottom, menu bar 38,
// camera inset 37.5, clear strips 751 wide either side of a 208 point notch.
let redFrame = CGRect(x: 0, y: 0, width: 1710, height: 1112)
let redVisible = CGRect(x: 0, y: 66, width: 1710, height: 1008)
let redL = CGRect(x: 0, y: 1074.5, width: 751, height: 37.5), redR = CGRect(x: 959, y: 1074.5, width: 751, height: 37.5)
let red = IslandGeo.make(frame: redFrame, visible: redVisible, inset: 37.5, left: redL, right: redR)

// MARK: the notch, read from the screen's numbers
check("normal-notch-found", red.notch && near(red.notchW, 208) && near(red.notchH, 37.5))
check("normal-notch-centre", near(red.centerX, 855) && near(red.notchLeft, 751) && near(red.leftW, 751))
check("normal-menu-height", near(red.menuH, 38), "\(red.menuH)")

// Full screen: the menu bar is hidden, the visible frame reaches the top. The menu height stays the notch's (no jump).
let redFull = IslandGeo.make(frame: redFrame, visible: redFrame, inset: 37.5, left: redL, right: redR)
check("fullscreen-menu-height-no-jump", near(redFull.menuH, 38), "\(redFull.menuH)")
check("fullscreen-same-notch", redFull.notch == red.notch && redFull.notchLeft == red.notchLeft && redFull.centerX == red.centerX)

// Menu bar set to hide on a screen without a notch: the usual 24, as before.
let plain = IslandGeo.make(frame: CGRect(x: 0, y: 0, width: 1440, height: 900), visible: CGRect(x: 0, y: 0, width: 1440, height: 900), inset: 0, left: nil, right: nil)
check("menu-hidden-no-notch-24", near(plain.menuH, 24) && !plain.notch && near(plain.centerX, 720))
let plainShown = IslandGeo.make(frame: CGRect(x: 0, y: 0, width: 1440, height: 900), visible: CGRect(x: 0, y: 70, width: 1440, height: 805), inset: 0, left: nil, right: nil)
check("menu-shown-no-notch-25", near(plainShown.menuH, 25))

// Second display: the MacBook placed right of a main 1920 x 1080 display, then left of it. macOS may give the clear
// strips relative to the screen or in global points; both land on the same notch.
for (name, x) in [("right", CGFloat(1920)), ("left", CGFloat(-1710))] {
  let f = redFrame.offsetBy(dx: x, dy: 0), v = redVisible.offsetBy(dx: x, dy: 0)
  let local = IslandGeo.make(frame: f, visible: v, inset: 37.5, left: redL, right: redR)
  let global = IslandGeo.make(frame: f, visible: v, inset: 37.5, left: redL.offsetBy(dx: x, dy: 0), right: redR.offsetBy(dx: x, dy: 0))
  check("second-display-\(name)-local", near(local.notchLeft, x + 751) && near(local.centerX, x + 855), "\(local.notchLeft)")
  check("second-display-\(name)-global", near(global.notchLeft, x + 751) && near(global.centerX, x + 855), "\(global.notchLeft)")
}

// MARK: full screen or not (window list coordinates, top left origin)
let t = IslandPlace.cgRect(redFrame, primaryH: 1112)
check("cg-rect-main", t == CGRect(x: 0, y: 0, width: 1710, height: 1112))
let below = CGRect(x: 0, y: 37.5, width: 1710, height: 1074.5)          // a full screen app below the notch
let whole = CGRect(x: 0, y: 0, width: 1710, height: 1112)               // a browser over the whole screen
let zoomed = CGRect(x: 0, y: 38, width: 1710, height: 1008)             // a big window above the Dock (the developer's Claude)
let tall = CGRect(x: 0, y: 38, width: 1710, height: 1074)               // a big window down to the bottom (no Dock)
let toolbar = CGRect(x: 0, y: 37.5, width: 1710, height: 90)            // a browser's own full screen toolbar window
check("kind-below-notch", IslandPlace.kind([toolbar, below], screen: t, inset: 37.5) == .belowNotch)
check("kind-whole", IslandPlace.kind([toolbar, whole], screen: t, inset: 37.5) == .whole)
check("kind-whole-wins", IslandPlace.kind([below, whole], screen: t, inset: 37.5) == .whole)
check("kind-zoomed-window-not", IslandPlace.kind([zoomed], screen: t, inset: 37.5) == .none)
check("kind-small-window-not", IslandPlace.kind([CGRect(x: 455, y: 242, width: 800, height: 600)], screen: t, inset: 37.5) == .none)
check("kind-no-notch-below-not", IslandPlace.kind([below], screen: t, inset: 0) == .none)
check("kind-tall-looks-like-full", IslandPlace.kind([tall], screen: t, inset: 37.5) == .belowNotch)

// The menu bar decides between a full screen app and a big ordinary window.
let menuShown = IslandPlace.BarWindow(bounds: CGRect(x: 0, y: 0, width: 1710, height: 38), name: "Menubar")
let menuUp = IslandPlace.BarWindow(bounds: CGRect(x: 0, y: -38, width: 1710, height: 38), name: "Menubar")
let backstop = IslandPlace.BarWindow(bounds: CGRect(x: 0, y: 0, width: 1710, height: 38), name: "Backstop Menubar")
let noName = IslandPlace.BarWindow(bounds: CGRect(x: 0, y: 0, width: 1710, height: 38), name: nil)
let otherScreen = IslandPlace.BarWindow(bounds: CGRect(x: 1710, y: 0, width: 1920, height: 25), name: "Menubar")
check("menu-shown", IslandPlace.menuBar([menuShown], screen: t) == .shown)
check("menu-gone-is-hidden", IslandPlace.menuBar([], screen: t) == .hidden)
check("menu-slid-up-is-hidden", IslandPlace.menuBar([menuUp], screen: t) == .hidden)
check("menu-backstop-only-is-hidden", IslandPlace.menuBar([backstop], screen: t) == .hidden)
check("menu-other-display-is-hidden-here", IslandPlace.menuBar([otherScreen], screen: t) == .hidden)
check("menu-no-names-unknown", IslandPlace.menuBar([noName], screen: t) == .unknown)
check("menu-visible-frame-at-top-is-hidden", IslandPlace.menuBar([menuShown], screen: t, visibleReachesTop: true) == .hidden)

check("decide-full-screen", IslandPlace.decide(.belowNotch, menu: .hidden, pointerAtTop: false, previous: .none) == .belowNotch)
check("decide-browser-whole", IslandPlace.decide(.whole, menu: .hidden, pointerAtTop: false, previous: .none) == .whole)
check("decide-big-window-on-desktop", IslandPlace.decide(.belowNotch, menu: .shown, pointerAtTop: false, previous: .none) == .none)
check("decide-big-window-after-full-screen", IslandPlace.decide(.belowNotch, menu: .shown, pointerAtTop: false, previous: .belowNotch) == .none)
check("decide-menu-pulled-down-keeps", IslandPlace.decide(.belowNotch, menu: .shown, pointerAtTop: true, previous: .belowNotch) == .belowNotch)
check("decide-pointer-at-top-on-desktop", IslandPlace.decide(.belowNotch, menu: .shown, pointerAtTop: true, previous: .none) == .none)
check("decide-unknown-trusts-windows", IslandPlace.decide(.belowNotch, menu: .unknown, pointerAtTop: false, previous: .none) == .belowNotch)
check("decide-no-window", IslandPlace.decide(.none, menu: .hidden, pointerAtTop: true, previous: .whole) == .none)

check("pointer-at-top", IslandPlace.pointerAtTop(CGPoint(x: 300, y: 1111), screen: redFrame, band: 38))
check("pointer-in-band", IslandPlace.pointerAtTop(CGPoint(x: 300, y: 1080), screen: redFrame, band: 38))
check("pointer-below-band", !IslandPlace.pointerAtTop(CGPoint(x: 300, y: 1000), screen: redFrame, band: 38))
check("pointer-other-display", !IslandPlace.pointerAtTop(CGPoint(x: 2000, y: 1111), screen: redFrame, band: 38))

check("place-bar", IslandPlace.place(.belowNotch, notch: true, menuAlways: false, menuDown: false) == .bar)
check("place-whole-bar", IslandPlace.place(.whole, notch: true, menuAlways: false, menuDown: false) == .bar)
check("place-menu-down-drops", IslandPlace.place(.whole, notch: true, menuAlways: false, menuDown: true) == .dropped)
check("place-no-notch-as-desktop", IslandPlace.place(.whole, notch: false, menuAlways: false, menuDown: false) == .off)
check("place-menu-always-as-desktop", IslandPlace.place(.belowNotch, notch: true, menuAlways: true, menuDown: false) == .off)
check("place-desktop", IslandPlace.place(.none, notch: true, menuAlways: false, menuDown: false) == .off)
check("place-move-off-stays", IslandPlace.place(.whole, notch: true, menuAlways: false, menuDown: false, move: false) == .off)
check("place-move-off-menu-down-stays", IslandPlace.place(.belowNotch, notch: true, menuAlways: false, menuDown: true, move: false) == .off)
check("place-move-on-default", IslandPlace.place(.whole, notch: true, menuAlways: false, menuDown: false, move: true) == .bar)

// MARK: the panel's frame
let W = IslandPlace.panelW, H = IslandPlace.panelH
let home = IslandPlace.frame(.off, red, pos: nil, pillH: 34)
check("normal-home-top-centre", near(home.midX, 855) && near(home.maxY, 1112) && near(home.width, W) && near(home.height, H))
let bar = IslandPlace.frame(.bar, red, pos: nil, pillH: 34)
let barW = IslandPlace.barW(red)
check("bar-width", near(barW, 340))
check("fullscreen-bar-left-of-notch", near(bar.midX + barW / 2, red.notchLeft - 10) && bar.midX - barW / 2 >= red.frame.minX && near(bar.maxY, 1112), "\(bar)")
check("fullscreen-bar-covers-no-notch", bar.midX + barW / 2 < red.notchLeft)
let dropped = IslandPlace.frame(.dropped, red, pos: CGPoint(x: 0.1, y: 0.9), pillH: 34)
check("fullscreen-dropped-under-the-bar", near(dropped.midX, bar.midX) && near(dropped.maxY, 1112) && dropped.minX >= 0, "\(dropped)")
let moved = CGPoint(x: 0.1, y: 0.95)
let spot = IslandPlace.frame(.off, red, pos: moved, pillH: 34)
check("moved-spot-on-desktop", spot.midX < 855 - 300 && spot.minX >= 0)
check("moved-spot-waits-in-full-screen", IslandPlace.frame(.bar, red, pos: moved, pillH: 34) == bar)
check("moved-spot-same-when-menu-hides", IslandPlace.frame(.off, redFull, pos: moved, pillH: 34) == spot)
// Little screen, little left strip: the bar never goes past the screen's left edge or into the notch.
let small = IslandGeo.make(frame: CGRect(x: 0, y: 0, width: 1280, height: 832), visible: CGRect(x: 0, y: 0, width: 1280, height: 795), inset: 32,
                           left: CGRect(x: 0, y: 800, width: 547, height: 32), right: CGRect(x: 733, y: 800, width: 547, height: 32))
let sbar = IslandPlace.frame(.bar, small, pos: nil, pillH: 34)
check("small-bar-left-of-notch", sbar.midX + IslandPlace.barW(small) / 2 <= small.notchLeft - 10 + 0.01 && sbar.midX - IslandPlace.barW(small) / 2 >= 0)
// Second display (MacBook left of the main one): the bar sits on the MacBook, left of its notch.
let leftMac = IslandGeo.make(frame: redFrame.offsetBy(dx: -1710, dy: 0), visible: redVisible.offsetBy(dx: -1710, dy: 0), inset: 37.5, left: redL, right: redR)
let lbar = IslandPlace.frame(.bar, leftMac, pos: nil, pillH: 34)
check("second-display-bar-on-the-macbook", lbar.midX - barW / 2 >= -1710 && lbar.midX + barW / 2 <= -1710 + 751)
check("second-display-cg-rect", IslandPlace.cgRect(CGRect(x: 1920, y: -200, width: 1710, height: 1112), primaryH: 1080) == CGRect(x: 1920, y: 168, width: 1710, height: 1112))

// MARK: the moved spot round trip (G Squad, kept as fractions of the room)
let c = IslandPlace.center(moved, red, pillH: 34)
check("spot-round-trip", IslandPlace.spot(c, red, pillH: 34) == moved)
check("spot-clamped", IslandPlace.spot(CGPoint(x: -5000, y: 99999), red, pillH: 34) == CGPoint(x: 0, y: 1))

// MARK: every desktop (the developer, 12 Nov 2026: the island stopped following him across desktops after a drag)
let sp = IslandPlace.spaces
check("spaces-every-desktop", sp.contains(.canJoinAllSpaces))
check("spaces-over-full-screen", sp.contains(.fullScreenAuxiliary))
check("spaces-mission-control-leaves-it", sp.contains(.stationary) && sp.contains(.ignoresCycle))
check("spaces-never-move-to-active", !sp.contains(.moveToActiveSpace) && !sp.contains(.transient) && !sp.contains(.managed))
check("spaces-every-apps-space", sp.contains(.canJoinAllApplications))
check("rejoin-when-missing-here", IslandPlace.rejoin(visible: true, onActiveSpace: false, dragging: false))
check("rejoin-not-when-here", !IslandPlace.rejoin(visible: true, onActiveSpace: true, dragging: false))
check("rejoin-not-while-dragged", !IslandPlace.rejoin(visible: true, onActiveSpace: false, dragging: true))
check("rejoin-not-when-away", !IslandPlace.rejoin(visible: false, onActiveSpace: false, dragging: false))

// MARK: over full screen apps at all (12 Nov 2026: a friend's island vanished in full screen; a Dock app's windows are never
// drawn over another app's full screen Space, so PS steps out of the Dock while one is in front, and back after)
typealias P = IslandPlace.Presence
check("presence-out-for-full-screen", IslandPlace.presence(fullScreen: true, islandOn: true, psFront: false, menuBarHere: false, now: .dock) == .overFullScreen)
check("presence-back-when-it-ends", IslandPlace.presence(fullScreen: false, islandOn: true, psFront: false, menuBarHere: true, now: .overFullScreen) == .dock)
check("presence-dock-on-desktop", IslandPlace.presence(fullScreen: false, islandOn: true, psFront: false, menuBarHere: true, now: .dock) == .dock)
check("presence-island-off-stays-in-dock", IslandPlace.presence(fullScreen: true, islandOn: false, psFront: false, menuBarHere: false, now: .dock) == .dock)
check("presence-island-off-goes-back", IslandPlace.presence(fullScreen: true, islandOn: false, psFront: false, menuBarHere: false, now: .overFullScreen) == .dock)
check("presence-ps-front-over-full-screen-stays", IslandPlace.presence(fullScreen: true, islandOn: true, psFront: true, menuBarHere: false, now: .overFullScreen) == .overFullScreen)
check("presence-ps-front-on-desktop-back", IslandPlace.presence(fullScreen: true, islandOn: true, psFront: true, menuBarHere: true, now: .overFullScreen) == .dock)
check("presence-ps-front-never-leaves-dock", IslandPlace.presence(fullScreen: true, islandOn: true, psFront: true, menuBarHere: false, now: .dock) == .dock)

// MARK: the glide (the developer: "a fancy animation")
let toBar = IslandPlace.glide(from: home, to: bar, reduceMotion: false)
check("glide-to-bar-leans-left", toBar.stretch < 0 && toBar.stretch >= -1, "\(toBar)")
check("glide-to-bar-length", toBar.duration >= 0.42 && toBar.duration <= 0.75, "\(toBar)")
check("glide-soft-ease-out", toBar.curve == IslandPlace.glideCurve && toBar.curve.count == 4)
let back = IslandPlace.glide(from: bar, to: home, reduceMotion: false)
check("glide-back-leans-right", back.stretch > 0 && back.duration == toBar.duration && abs(back.stretch) == abs(toBar.stretch))
let toSpot = IslandPlace.glide(from: bar, to: spot, reduceMotion: false)
check("glide-back-to-moved-spot", toSpot.duration >= 0.42 && toSpot.duration <= 0.75 && toSpot.stretch != 0)
let far = IslandPlace.glide(from: CGRect(x: 0, y: 0, width: 480, height: 270), to: CGRect(x: 5000, y: 0, width: 480, height: 270), reduceMotion: false)
check("glide-long-trip-capped", far.duration == 0.75 && far.stretch == 1)
let still = IslandPlace.glide(from: bar, to: bar, reduceMotion: false)
check("glide-no-trip-no-lean", still.stretch == 0)
let calm = IslandPlace.glide(from: home, to: bar, reduceMotion: true)
check("glide-reduce-motion-no-travel", calm.stretch == 0 && calm.duration <= 0.2)
let lean = IslandPlace.leanScale(-1), none = IslandPlace.leanScale(0)
check("glide-lean-shape", lean.x > 1 && lean.x <= 1.15 && lean.y < 1 && lean.y >= 0.9 && none == (1, 1))
check("glide-dropped-only-drops", IslandPlace.glide(from: bar, to: dropped, reduceMotion: false).stretch == 0)

print("ISLAND PLACE: \(count - fails) of \(count) ok")
exit(fails == 0 ? 0 : 1)
