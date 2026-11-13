import AppKit
import WebKit

// Self test for Screen fit (V1.40, ScreenFit.swift and web src/core/screenfit.ts). PS_SELFTEST_ONLY=screenfit.
// The parked list window is set to each screen size in turn (points, as macOS "looks like"), ScreenFit.apply runs as on
// a real screen, and the page is measured in WebKit with the fictional tasks:
//   ZOOM CHECK      the zoom rule, the zoom the web view really has, the page size it gives, --safe-top, __psScreen.
//   FIT CHECK       per size: no two panels, buttons or bars on top of each other (left column, right column, the
//                   glass bar, the top right buttons, the headline), nothing off screen, and the Timelines pop-up on
//                   screen and drawn on top when it opens.
//   FEED CHECK      at a zoomed size a pointer move reaches the page at the right page pixel (points / zoom).
//   BACK CHECK      back on this Mac's own screen the zoom is what the rule says for it (1 on the developer's MacBook).
// Pictures: screenfit-<w>x<h>.png and screenfit-<w>x<h>-timelines.png.
extension SelfTest {
  static func screenFitCheck(_ a: App, _ dir: String, _ done: @escaping () -> Void) {
    var zoomR: [(String, Bool)] = [], fitR: [(String, Bool)] = [], notes: [String] = []
    func later(_ t: Double, _ f: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + t, execute: f) }
    func js(_ s: String, _ f: @escaping (Any?) -> Void) { a.overlay.callAsyncJavaScript(s, arguments: [:], in: nil, in: .page) { r in if case .success(let v) = r { f(v) } else { f(nil) } } }
    func obj(_ v: Any?) -> [String: Any] { (v as? String).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] } ?? [:] }
    let fmt = { (r: [(String, Bool)]) in r.map { "\($0.0)=\($0.1 ? "ok" : "FAIL")" }.joined(separator: " ") }

    // The rule itself.
    let rule: [(CGFloat, CGFloat, CGFloat)] = [(1710, 1112, 1), (1440, 900, 1), (1512, 982, 1), (1920, 1080, 1), (2560, 1440, 1), (3008, 1692, 1),
                                               (1280, 800, 0.889), (1280, 720, 0.837), (1152, 720, 0.8), (1024, 640, 0.8), (1024, 576, 0.8), (1, 1, 1)]
    zoomR.append(("rule", rule.allSatisfy { abs(ScreenFit.zoom($0.0, $0.1) - $0.2) < 0.0006 }))

    let measure = """
    await new Promise((r) => setTimeout(r, 50));
    const vis = (e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 2 && r.height > 2 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0'; };
    // Edit mode (V1.40) wraps each panel in a [data-slot] box with display: contents: look through it.
    const kids = (sel) => [...document.querySelectorAll(sel.split(',').map((x) => x.trim()).flatMap((x) => [x, x.replace(/ > \\*$/, ' > [data-slot] > *')]).join(', '))].filter((e) => !e.matches('[data-slot]'));
    const groups = { glass: [...document.querySelectorAll('.tm-glass-wrap')], topright: kids('.tm-tr > *'),
      left: kids('.tm-left > *, .tm-left .nu-tlrow > *, .tm-left .tm-xrow > *').filter((e) => !e.matches('.nu-tlrow, .tm-xrow')),
      right: kids('.tm-right > *'), head: [...document.querySelectorAll('.tm-head')] };
    const items = [];
    for (const [g, list] of Object.entries(groups)) for (const e of list) if (vis(e)) { const r = e.getBoundingClientRect(); items.push({ g, n: (typeof e.className === 'string' ? e.className.split(' ')[0] : e.tagName), l: r.left, t: r.top, r: r.right, b: r.bottom }); }
    const hit = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 2 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 2;
    const over = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (items[i].g !== items[j].g && hit(items[i], items[j])) over.push(items[i].g + ':' + items[i].n + ' x ' + items[j].g + ':' + items[j].n);
    const off = items.filter((i) => i.l < -1 || i.t < -1 || i.r > innerWidth + 1 || i.b > innerHeight + 1).map((i) => i.g + ':' + i.n);
    const o = document.querySelector('.tm-overlay');
    return JSON.stringify({ view: innerWidth + 'x' + innerHeight, safeTop: getComputedStyle(document.documentElement).getPropertyValue('--safe-top').trim(),
      zoomVar: getComputedStyle(document.documentElement).getPropertyValue('--scr-zoom').trim(), glass: o ? o.dataset.glass || '' : '', over, off });
    """
    let openTimelines = """
    const tl = document.querySelector('.tm-tl'); if (!tl) return JSON.stringify({ found: false });
    // React hears a hover as a mouseout from where the pointer was plus a mouseover where it is (as the clocks check does).
    const from = document.querySelector('.tm-inner'), pill = tl.querySelector('.tm-tl-pill') || tl;
    from.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: pill }));
    pill.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: from }));
    await new Promise((r) => setTimeout(r, 700));
    const p = document.querySelector('.tm-tl-panel'); if (!p) return JSON.stringify({ found: true, open: false });
    const r = p.getBoundingClientRect();
    const pts = [[.5, .06], [.9, .06], [.1, .5], [.5, .5], [.9, .5], [.5, .94]];
    const onTop = pts.every(([fx, fy]) => { const t = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy); return !!t && p.contains(t); });
    return JSON.stringify({ found: true, open: true, onScreen: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, onTop });
    """
    let closeTimelines = "const tl = document.querySelector('.tm-tl'), to = document.querySelector('.tm-inner'); if (tl) { const p = tl.querySelector('.tm-tl-panel') || tl; p.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: to })); to.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: p })); } await new Promise((r) => setTimeout(r, 700)); return 1"

    let home = a.panel.frame
    // w, h, menu bar or notch
    let sizes: [(CGFloat, CGFloat, CGFloat)] = [(1024, 576, 25), (1024, 640, 25), (1152, 720, 25), (1280, 800, 25), (1440, 900, 25), (1512, 982, 38),
                                                 (1710, 1112, 38), (2560, 1440, 25), (3008, 1692, 25)]
    func size(_ k: Int) {
      guard k < sizes.count else { feed(); return }
      let (w, h, top) = sizes[k], tag = "\(Int(w))x\(Int(h))"
      a.panel.setFrame(NSRect(x: home.minX, y: home.maxY - h, width: w, height: h), display: true)   // parked off screen by ScreenGuard
      let info = ScreenFit.Info(frame: NSRect(x: 0, y: 0, width: w, height: h), visible: NSRect(x: 0, y: 66, width: w, height: h - 66 - top), scale: 2, safeTop: top)
      let z = ScreenFit.apply(a.overlay, info)
      later(1.4) {
        js(measure) { v in
          let m = obj(v)
          let want = "\(Int((w / z).rounded()))x\(Int((h / z).rounded()))"
          let view = m["view"] as? String ?? "?", over = m["over"] as? [String] ?? ["?"], off = m["off"] as? [String] ?? ["?"]
          let vw = view.split(separator: "x").compactMap { Double($0) }, ww = want.split(separator: "x").compactMap { Double($0) }
          zoomR.append(("\(tag)-zoom-\(z)", abs(a.overlay.pageZoom - z) < 0.0006 && vw.count == 2 && ww.count == 2 && abs(vw[0] - ww[0]) <= 1 && abs(vw[1] - ww[1]) <= 1))
          let st = Double((m["safeTop"] as? String ?? "").replacingOccurrences(of: "px", with: "")) ?? -1
          zoomR.append(("\(tag)-safe-top", abs(st - Double(top / z)) < 0.05 && (m["zoomVar"] as? String) == "\(ScreenFit.zoom(w, h))".replacingOccurrences(of: #"\.0$"#, with: "", options: .regularExpression)))
          fitR.append(("\(tag)-no-overlap", over.isEmpty))
          fitR.append(("\(tag)-on-screen", off.isEmpty))
          notes.append("\(tag) z=\(z) view=\(view) glass=\(m["glass"] ?? "") over=\(over.joined(separator: "|")) off=\(off.joined(separator: "|"))")
          snap(a.overlay, "\(dir)/screenfit-\(tag).png") {
            js(openTimelines) { t in
              let o = obj(t)
              fitR.append(("\(tag)-timelines", o["open"] as? Bool == true && o["onScreen"] as? Bool == true && o["onTop"] as? Bool == true))
              notes.append("\(tag) timelines=\(t ?? "nil")")
              snap(a.overlay, "\(dir)/screenfit-\(tag)-timelines.png") { js(closeTimelines) { _ in size(k + 1) } }
            }
          }
        }
      }
    }
    // A pointer move at a zoomed size reaches the page at points / zoom.
    func feed() {
      let w: CGFloat = 1152, h: CGFloat = 720
      a.panel.setFrame(NSRect(x: home.minX, y: home.maxY - h, width: w, height: h), display: true)
      let z = ScreenFit.apply(a.overlay, ScreenFit.Info(frame: NSRect(x: 0, y: 0, width: w, height: h), visible: NSRect(x: 0, y: 0, width: w, height: h - 25), scale: 2, safeTop: 25))
      later(1.0) {
        a.overlay.evaluateJavaScript("window.__sfm=null;document.addEventListener('mousemove',function(e){window.__sfm=[e.clientX,e.clientY]},true);1") { _, _ in
          if let feedView = a.panel.contentView as? MouseFeed, let ev = NSEvent.mouseEvent(with: .mouseMoved, location: NSPoint(x: 576, y: h - 360), modifierFlags: [], timestamp: 0,
                                                                                         windowNumber: a.panel.windowNumber, context: nil, eventNumber: 0, clickCount: 0, pressure: 0) {
            MouseFeed.testMove = true; feedView.mouseMoved(with: ev); MouseFeed.testMove = false
          }
          later(0.4) {
            js("return JSON.stringify(window.__sfm)") { v in
              let xy = (v as? String).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [Double] } ?? []
              let ex = Double(576 / z), ey = Double(360 / z)
              zoomR.append(("feed-at-page-pixels", xy.count == 2 && abs(xy[0] - ex) <= 1.5 && abs(xy[1] - ey) <= 1.5))
              notes.append("feed point 576,360 at zoom \(z) -> page \(v ?? "nil") (want \(Int(ex)),\(Int(ey)))")
              back()
            }
          }
        }
      }
    }
    // Back on this Mac's own screen.
    func back() {
      a.panel.setFrame(home, display: true)
      let s = NSScreen.main ?? NSScreen.screens.first!
      let z = ScreenFit.apply(a.overlay, ScreenFit.Info(s))
      later(1.0) {
        js("return innerWidth + 'x' + innerHeight") { v in
          zoomR.append(("back-home-zoom", abs(a.overlay.pageZoom - ScreenFit.zoom(s.frame.width, s.frame.height)) < 0.0006 && abs(z - ScreenFit.zoom(s.frame.width, s.frame.height)) < 0.0006))
          notes.append("home screen \(Int(s.frame.width))x\(Int(s.frame.height)) zoom \(z) page \(v ?? "nil")")
          print("ZOOM CHECK:", fmt(zoomR))
          print("FIT CHECK:", fmt(fitR))
          print("SCREEN FIT NOTES:\n  " + notes.joined(separator: "\n  "))
          done()
        }
      }
    }
    size(0)
  }
}
