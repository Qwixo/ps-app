import AppKit
import WebKit

// Self test for the Map pill (web src/views/SeriesPill.tsx, the website's series map from
// To-do > Map in a window of the Tab list). Real mouse events into the parked overlay: the bottom row
// reads Timelines, Map, Numerology, left to right on one line; one click opens the map window (the
// same map: its four views, this month as the heading); PS pins the list and gives it the keyboard
// (the dimx flag), so letting go of Tab keeps the list and the map up; a click on Year switches the
// view; the Mac's Esc closes only the map and the list stays. PS_SELFTEST_ONLY=seriesmap.
// Pictures: seriesmap-row.png, seriesmap-open.png, seriesmap-year.png, seriesmap-closed.png.
extension SelfTest {
  static func mapCheck(_ a: App, _ dir: String, _ done: @escaping () -> Void) {
    func later(_ t: Double, _ f: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + t, execute: f) }
    func js(_ s: String, _ f: @escaping (Any?) -> Void) { a.overlay.evaluateJavaScript(s) { v, _ in f(v) } }
    func obj(_ v: Any?) -> [String: Any] { (v as? String).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] } ?? [:] }
    /// A real click (mouse down, then up 90 ms later) on the element's centre, into the overlay window.
    func click(_ sel: String, _ f: @escaping (Bool) -> Void) {
      js("(function(){var e=document.querySelector(\"\(sel)\");if(!e)return null;var r=e.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()") { v in
        guard let xy = v as? [NSNumber], xy.count == 2, let w = a.overlay else { f(false); return }
        let local = NSPoint(x: xy[0].doubleValue, y: w.isFlipped ? xy[1].doubleValue : w.bounds.height - xy[1].doubleValue)
        let inWin = w.convert(local, to: nil)
        a.updateClickThrough(at: NSPoint(x: xy[0].doubleValue, y: xy[1].doubleValue))
        func ev(_ t: NSEvent.EventType) -> NSEvent? {
          NSEvent.mouseEvent(with: t, location: inWin, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: a.panel.windowNumber,
                             context: nil, eventNumber: 13, clickCount: 1, pressure: t == .leftMouseUp ? 0 : 1)
        }
        if let d = ev(.leftMouseDown) { a.panel.sendEvent(d) }
        later(0.09) { if let u = ev(.leftMouseUp) { a.panel.sendEvent(u) }; f(true) }
      }
    }
    var r: [(String, Bool)] = []
    let state = """
      JSON.stringify((function(){
        var q=function(s){return document.querySelector(s)}, R=function(e){if(!e)return null;var b=e.getBoundingClientRect();return [b.left,b.top,b.right,b.bottom]};
        var ov=q('.tm-overlay:not(.tm-docked)'), row=ov&&ov.querySelector('.nu-tlrow'), col=ov&&ov.querySelector('.tm-left');
        var M=['January','February','March','April','May','June','July','August','September','October','November','December'], d=new Date();
        return {kids: row ? [].map.call(row.children, function(c){return c.className.split(' ')[0]}) : [],
          tl: R(row&&row.querySelector('.tm-tl-pill')), sp: R(row&&row.querySelector('.sp-pill')), nu: R(row&&row.querySelector('.nu-pill')), col: R(col),
          win: R(q('.sp-win')), embedded: !!q('.sp-win .sm-overlay.sm-embedded'), tabs: document.querySelectorAll('.sp-win .tabs .tab').length,
          heading: (q('.sp-win .sm-heading')||{}).textContent||'', month: M[d.getMonth()]+' '+d.getFullYear(), year: String(d.getFullYear())};
      })())
      """
    func finish() {
      print("MAP CHECK:", r.map { "\($0.0)=\($0.1 ? "ok" : "FAIL")" }.joined(separator: " "))
      later(0.6, done)
    }
    later(1.0) {
      js(state) { v0 in
        let s = obj(v0)
        let t = (s["tl"] as? [Double]) ?? [], p = (s["sp"] as? [Double]) ?? [], n = (s["nu"] as? [Double]) ?? [], c = (s["col"] as? [Double]) ?? []
        let mid = { (x: [Double]) in (x[1] + x[3]) / 2 }
        r.append(("order-timelines-map-numerology", (s["kids"] as? [String]) == ["tm-tl", "sp", "nu"]
          && t.count == 4 && p.count == 4 && n.count == 4 && t[2] <= p[0] && p[2] <= n[0] && abs(mid(t) - mid(p)) < 3 && abs(mid(p) - mid(n)) < 3))
        r.append(("row-inside-column", n.count == 4 && c.count == 4 && n[2] <= c[2] + 1))
        r.append(("map-closed-at-start", s["win"] is NSNull || s["win"] == nil))
        snap(a.overlay, "\(dir)/seriesmap-row.png") {
          click(".tm-overlay:not(.tm-docked) .sp-pill") { _ in
            later(1.5) {
              js(state) { v1 in
                let s = obj(v1)
                let w = (s["win"] as? [Double]) ?? []
                r.append(("one-click-opens-map", w.count == 4 && w[2] - w[0] > 600 && (s["embedded"] as? Bool) == true))
                r.append(("same-map-four-views-this-month", (s["tabs"] as? Int) == 4 && (s["heading"] as? String) == (s["month"] as? String)))
                // Letting go of Tab keeps the list (pinned) and typing goes to it (editing), as for Dimension X.
                r.append(("tab-let-go-keeps-list", a.dimxOpen && TabWatch.shared.pinned && TabWatch.shared.editing))
                snap(a.overlay, "\(dir)/seriesmap-open.png") {
                  js("(function(){var b=[].filter.call(document.querySelectorAll('.sp-win .tabs .tab'),function(x){return x.textContent==='Year'})[0];if(b)b.classList.add('st-year');return !!b})()") { _ in
                    click(".sp-win .tabs .tab.st-year") { _ in
                      later(0.8) {
                        js(state) { v2 in
                          let s = obj(v2)
                          r.append(("year-view-on-click", (s["heading"] as? String) == (s["year"] as? String)))
                          snap(a.overlay, "\(dir)/seriesmap-year.png") {
                            a.escKey()   // the Mac's own Esc (keyboard tap path): only the map closes
                            later(1.6) {
                              js(state) { v3 in
                                let s = obj(v3)
                                r.append(("esc-closes-map", s["win"] is NSNull || s["win"] == nil))
                                r.append(("esc-keeps-list", a.shown && !a.dimxOpen))
                                snap(a.overlay, "\(dir)/seriesmap-closed.png") { finish() }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
