// Offline test for Sources/ScreenFit.swift (V1.40, the Tab list on any screen size): the zoom rule, what the page is
// told, and points to page pixels. Never starts PS, never opens a window.
//   mkdir -p build/screenfit && cp tests/screenfit-test.swift build/screenfit/main.swift && swiftc build/screenfit/main.swift Sources/ScreenFit.swift -o build/screenfit/test && build/screenfit/test
import AppKit

var fails = 0, count = 0
func check(_ name: String, _ ok: Bool, _ info: String = "") { count += 1; print("\(name)=\(ok ? "ok" : "FAIL")\(info.isEmpty || ok ? "" : " (\(info))")"); if !ok { fails += 1 } }

// MARK: the zoom rule (web src/core/screenfit.ts fitZoom holds the same numbers)
let rule: [(CGFloat, CGFloat, CGFloat)] = [(1710, 1112, 1), (1440, 900, 1), (1470, 956, 1), (1512, 982, 1), (1920, 1080, 1), (2560, 1440, 1), (3008, 1692, 1),
                                           (1440, 860, 1), (1280, 800, 0.889), (1280, 720, 0.837), (1152, 720, 0.8), (1024, 640, 0.8), (1024, 576, 0.8), (800, 500, 0.8)]
for (w, h, z) in rule { check("zoom-\(Int(w))x\(Int(h))", abs(ScreenFit.zoom(w, h) - z) < 0.0006, "got \(ScreenFit.zoom(w, h))") }
check("zoom-tucked-window-left-alone", ScreenFit.zoom(1, 1) == 1)
check("zoom-never-under-floor", (300...3000).allSatisfy { ScreenFit.zoom(CGFloat($0), CGFloat($0) * 0.6) >= 0.8 })
check("zoom-never-over-1", (300...6000).allSatisfy { ScreenFit.zoom(CGFloat($0), CGFloat($0)) <= 1 })

// MARK: what the page is told
let red = ScreenFit.Info(frame: NSRect(x: 0, y: 0, width: 1710, height: 1112), visible: NSRect(x: 0, y: 66, width: 1710, height: 1008.5), scale: 2, safeTop: 37.5)
let jsRed = ScreenFit.script(red, zoom: 1)
check("red-safe-top-as-before", jsRed.hasPrefix("document.documentElement.style.setProperty('--safe-top','37px')"), jsRed)
check("red-info", jsRed.contains("window.__psScreen&&window.__psScreen({w:1710,h:1112,scale:2,zoom:1,top:37,bottom:66,left:0,right:0})"), jsRed)
let friend = ScreenFit.Info(frame: NSRect(x: 1710, y: 0, width: 1152, height: 720), visible: NSRect(x: 1710, y: 0, width: 1152, height: 695), scale: 2, safeTop: 25)
let jsFriend = ScreenFit.script(friend, zoom: ScreenFit.zoom(1152, 720))
check("friend-safe-top-in-page-pixels", jsFriend.contains("'--safe-top','31.25px'"), jsFriend)
check("friend-info", jsFriend.contains("{w:1152,h:720,scale:2,zoom:0.8,top:25,bottom:0,left:0,right:0}"), jsFriend)
let side = ScreenFit.Info(frame: NSRect(x: 0, y: 0, width: 1440, height: 900), visible: NSRect(x: 70, y: 0, width: 1370, height: 875), scale: 1, safeTop: 25)
check("dock-on-the-left", ScreenFit.script(side, zoom: 1).contains("left:70,right:0"))
check("no-dashes", ![jsRed, jsFriend].joined().unicodeScalars.contains { $0.value == 0x2013 || $0.value == 0x2014 })

// MARK: V1.47, the display scaling itself (a friend's 13 inch panel, 2880 px wide, set to "looks like 1152 x 720")
let scaled = ScreenFit.Info(frame: NSRect(x: 0, y: 0, width: 1152, height: 720), visible: NSRect(x: 0, y: 0, width: 1152, height: 695), scale: 2, safeTop: 25, nativeW: 2880, axZoom: true)
check("ui-scale-larger-text", abs(scaled.uiScale - 1.25) < 0.0006, "\(scaled.uiScale)")
check("ui-scale-unknown-is-1", friend.uiScale == 1)
let jsScaled = ScreenFit.script(scaled, zoom: ScreenFit.zoom(1152, 720))
check("scaled-info", jsScaled.contains("{w:1152,h:720,scale:2,zoom:0.8,top:25,bottom:0,left:0,right:0,native:2880,ui:1.25,ax:1})"), jsScaled)
check("red-default-ui", abs(ScreenFit.Info(frame: red.frame, visible: red.visible, scale: 2, safeTop: 37.5, nativeW: 3420).uiScale - 1) < 0.0006)
check("no-extra-without-a-real-screen", !jsRed.contains("native") && !jsRed.contains("ax:"))

// MARK: points to page pixels (MouseFeed, Keep overlay click-through)
let p = ScreenFit.toPage(NSPoint(x: 576, y: 360), zoom: 0.8)
check("to-page-at-0.8", abs(p.x - 720) < 0.001 && abs(p.y - 450) < 0.001, "\(p)")
check("to-page-at-1-unchanged", ScreenFit.toPage(NSPoint(x: 123, y: 45), zoom: 1) == NSPoint(x: 123, y: 45))
check("to-page-zero-zoom-safe", ScreenFit.toPage(NSPoint(x: 10, y: 10), zoom: 0).x.isFinite)

print("SCREENFIT TEST: \(fails == 0 ? "ok" : "FAIL") \(count - fails) of \(count)")
exit(fails == 0 ? 0 : 1)
