import AppKit
import ApplicationServices
import WebKit

// Screen fit (V1.40, G Squad): the Tab list fits any screen and any display scaling.
// A friend's bigger screen with macOS scaling set to a larger size ("looks like" 1152 x 720 and smaller) had the
// glass bar over the top right buttons, pop-ups clipped and panels on top of each other: the page was laid out for
// The developer's MacBook. Now, each time the list opens (and when the screen's size or arrangement changes while it is up):
//  - PS reads the screen the list is on: its frame and visible frame in points, the menu bar or notch and the Dock,
//    and its backing scale;
//  - picks a page zoom: 1 on any screen of at least 1440 x 860 points (the developer's 1710 x 1112 MacBook, a 1440 x 900 one,
//    every big display), smaller on a smaller screen, never under 0.8. It is the web view's own zoom
//    (WKWebView.pageZoom), so the page simply lays out on a 1440 x 900 sized page and every click, hover and
//    measurement stays right. Points <-> page pixels are converted where PS and the page swap positions:
//    MouseFeed (pointer moves), the Keep overlay click-through rectangles, and Second Computer drops (SecondDrop.swift);
//  - tells the page (web src/core/screenfit.ts, window.__psScreen), which takes it from there with fluid
//    rules: narrower side columns, pop-ups kept on screen, the glass bar placed clear of the buttons.
// The same rule lives in web src/core/screenfit.ts fitZoom; tests/screenfit.test.ts holds them together.
// V1.47: PS also tells the page the panel's own pixel width (the native mode), how much bigger macOS draws than
// that (uiScale: 1.25 for a 2880 px panel set to "looks like 1152 x 720") and whether Accessibility Zoom is on.
// The friend's broken clocks were not this file: WebKit scaled the clock hands' px pivot by pageZoom
// (web src/core/clockface.ts); the hands now turn around 0,0, which no zoom moves.
enum ScreenFit {
  static let refW: CGFloat = 1440, refH: CGFloat = 860, floor: CGFloat = 0.8
  /// Off in self test copies except the screenfit area: every other area clicks by page coordinates 1:1.
  static var enabled = true

  /// The page zoom for a screen of `w` x `h` points.
  static func zoom(_ w: CGFloat, _ h: CGFloat) -> CGFloat {
    guard w >= 200, h >= 200 else { return 1 }   // the tucked 1 x 1 window, or nonsense: leave the page alone
    return (max(floor, min(1, w / refW, h / refH)) * 1000).rounded() / 1000
  }

  struct Info: Equatable {
    var frame: NSRect, visible: NSRect, scale: CGFloat, safeTop: CGFloat
    /// V1.47: the panel's own (native) width in pixels, when macOS says which mode is native; nil when unknown.
    var nativeW: CGFloat? = nil
    /// V1.47: Accessibility, Zoom is magnifying the screen right now (it magnifies PS like everything else).
    var axZoom = false
    init(frame: NSRect, visible: NSRect, scale: CGFloat, safeTop: CGFloat, nativeW: CGFloat? = nil, axZoom: Bool = false) {
      self.frame = frame; self.visible = visible; self.scale = scale; self.safeTop = safeTop; self.nativeW = nativeW; self.axZoom = axZoom
    }
    init(_ s: NSScreen) {
      frame = s.frame; visible = s.visibleFrame; scale = s.backingScaleFactor
      // Below the menu bar and the notch (MacBook Air): as before V1.40.
      safeTop = s.safeAreaInsets.top > 0 ? s.safeAreaInsets.top : s.frame.maxY - s.visibleFrame.maxY
      nativeW = ScreenFit.nativeWidth(s)
      axZoom = UAZoomEnabled()
    }

    /// How much bigger than the panel's own pixels macOS draws everything (System Settings, Displays, "Larger
    /// text" side): a 2880 px wide panel shown "looks like 1152 x 720" at 2x is 2880 / 2304 = 1.25. 1 when unknown.
    var uiScale: CGFloat {
      guard let n = nativeW, n > 0, frame.width > 0, scale > 0 else { return 1 }
      return (n / (frame.width * scale) * 1000).rounded() / 1000
    }
  }

  /// The widest native mode macOS lists for the screen's display (its real panel), in pixels.
  static func nativeWidth(_ s: NSScreen) -> CGFloat? {
    guard let n = s.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else { return nil }
    let id = CGDirectDisplayID(n.uint32Value)
    let opts = [kCGDisplayShowDuplicateLowResolutionModes: kCFBooleanTrue] as CFDictionary
    guard let modes = CGDisplayCopyAllDisplayModes(id, opts) as? [CGDisplayMode] else { return nil }
    let nativeFlag: UInt32 = 0x0200_0000   // kDisplayModeNativeFlag (IOKit IOGraphicsTypes.h)
    let w = modes.filter { $0.ioFlags & nativeFlag != 0 }.map { CGFloat($0.pixelWidth) }.max()
    return w.flatMap { $0 > 0 ? $0 : nil }
  }

  /// The JS that tells the page about the screen; also sets --safe-top itself, so an older page keeps working.
  static func script(_ i: Info, zoom z: CGFloat) -> String {
    let f = i.frame, v = i.visible
    let top = CGFloat(Int(i.safeTop))
    func n(_ x: CGFloat) -> String { String(format: "%.3f", Double(x)).replacingOccurrences(of: #"\.?0+$"#, with: "", options: .regularExpression) }
    // V1.47: what the display scaling does (native panel width, how much bigger macOS draws, Accessibility Zoom),
    // only when PS read it from a real screen, so the page can say why it zoomed.
    var extra = ""
    if let nw = i.nativeW { extra += ",native:\(n(nw)),ui:\(n(i.uiScale))" }
    if i.axZoom { extra += ",ax:1" }
    let info = "{w:\(n(f.width)),h:\(n(f.height)),scale:\(n(i.scale)),zoom:\(n(z)),top:\(n(top)),bottom:\(n(max(0, v.minY - f.minY))),left:\(n(max(0, v.minX - f.minX))),right:\(n(max(0, f.maxX - v.maxX)))\(extra)}"
    return "document.documentElement.style.setProperty('--safe-top','\(n(top / z))px');window.__psScreen&&window.__psScreen(\(info))"
  }

  /// Sizes the page for the screen the list is on. Returns the zoom it set.
  @discardableResult
  static func apply(_ web: WKWebView, _ i: Info) -> CGFloat {
    let z = enabled ? zoom(i.frame.width, i.frame.height) : 1
    if abs(web.pageZoom - z) > 0.0005 { web.pageZoom = z }
    web.evaluateJavaScript(script(i, zoom: z), completionHandler: nil)
    return z
  }

  /// A point in the web view (points, top left origin) as a page point (CSS pixels).
  static func toPage(_ p: NSPoint, _ web: WKWebView) -> NSPoint { toPage(p, zoom: web.pageZoom) }
  static func toPage(_ p: NSPoint, zoom: CGFloat) -> NSPoint {
    let z = max(0.1, zoom)
    return NSPoint(x: p.x / z, y: p.y / z)
  }
}
