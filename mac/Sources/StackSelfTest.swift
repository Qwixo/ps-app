import AppKit
import WebKit

// Self test for the capped, scrollable card stack (Toast.swift; the developer, 31 Oct 2026: "make it so they don't
// take up the whole screen... so I can just scroll over them"). FICTIONAL finished chat cards only.
// Checks: 1, 3 and 12 cards (never taller than Toast.cap, the window exactly as tall as what shows, the
// fade only while more waits below, the "N notifications" bar inside the window), the window never
// resizes while the stack stays capped, real wheel events over a card's text scroll the stack and leave
// the time alone while over "Remind me in" they change the time and never scroll, the pill lights up
// under the pointer, a new card while scrolled down leaves every card on screen where it was (a pill
// says "1 new", a real click on it goes back up), a new card at the top springs in there, trackpad style
// gestures lock to one axis, the "N notifications · Clear all" bar sits at the top and stays put while the cards
// scroll beneath it (the developer, 31 Oct 2026), (a vertical one that drifts sideways never moves a card, a sideways one with
// vertical jitter dismisses without scrolling), and nothing of the window reaches below the stack.
// Pictures: stack-1, stack-3, stack-12 (each also -screen: the stack on a screen sized canvas with the
// window's outline), stack-pill, stack-held, stack-top-new, stack-swipe.
extension SelfTest {
  static func stackCheck(_ dir: String, _ done: @escaping () -> Void) {
    let t = Toast.shared
    var r: [(String, Bool)] = []
    let keep = t.onAction
    var got: [String] = []
    t.onAction = { id, action in got.append("\(id):\(action)") }
    func js(_ s: String, _ f: @escaping (Any?) -> Void) { t.web.evaluateJavaScript(s) { v, _ in f(v) } }
    func later(_ s: Double, _ f: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + s, execute: f) }
    func geom(_ f: @escaping ([String: Any]) -> Void) { js("window.__note.geom()") { v in f(v as? [String: Any] ?? [:]) } }
    func num(_ g: [String: Any], _ k: String) -> Double { (g[k] as? Double) ?? Double(g[k] as? Int ?? -9999) }
    let iso = ISO8601DateFormatter()
    func add(_ i: Int) {
      t.showMeet(["id": "c:test-s\(i)", "tone": "done", "icon": "done", "title": "Fictional chat \(i)", "sub": "Claude finished",
                  "at": iso.string(from: Date()), "discreetText": "A Claude chat finished", "remind": ["start": 2, "step": 1, "min": 1, "max": 240]])
    }
    func addMany(_ from: Int, _ to: Int, _ f: @escaping () -> Void) {
      guard from <= to else { return later(1.6, f) }
      add(from); later(0.3) { addMany(from + 1, to, f) }
    }
    // A page point (top left origin) to the panel's own coordinates.
    func inPanel(_ x: Double, _ y: Double) -> NSPoint {
      let w = t.web!
      return w.convert(NSPoint(x: x, y: w.isFlipped ? y : w.bounds.height - y), to: nil)
    }
    func point(_ sel: String, _ f: @escaping ((Double, Double)?) -> Void) {
      js("(function(){var e=document.querySelector('\(sel)');if(!e)return null;var b=e.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2}})()") { v in
        guard let d = v as? [String: Any], let x = d["x"] as? Double, let y = d["y"] as? Double else { return f(nil) }
        f((x, y))
      }
    }
    // A real scroll wheel event through the panel's own event path (as MailSelfTest). Lines: a mouse wheel
    // notch. Pixels with a phase: a trackpad gesture (began, changed..., ended).
    var sent = 0
    func scroll(_ at: NSPoint, _ units: CGScrollEventUnit, _ dy: Int32, _ dx: Int32, phase: Int64 = 0) {
      guard let cg = CGEvent(scrollWheelEvent2Source: nil, units: units, wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0) else { return }
      cg.location = CGPoint(x: at.x, y: (NSScreen.screens.first?.frame.height ?? 0) - at.y)
      cg.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(t.panel.windowNumber))
      if units == .pixel { cg.setIntegerValueField(.scrollWheelEventIsContinuous, value: 1) }
      if phase != 0 { cg.setIntegerValueField(.scrollWheelEventScrollPhase, value: phase) }
      if let ev = NSEvent(cgEvent: cg) { t.panel.sendEvent(ev); sent += 1 }
    }
    func notches(_ sel: String, _ up: Bool, _ times: Int, _ f: @escaping () -> Void) {
      guard times > 0 else { return later(0.5, f) }
      point(sel) { p in
        guard let p else { return f() }
        scroll(inPanel(p.0, p.1), .line, up ? 3 : -3, 0)
        later(0.32) { notches(sel, up, times - 1, f) }
      }
    }
    // A trackpad gesture at a page point: each step (dy, dx) in pixels, 16 ms apart.
    func gesture(_ x: Double, _ y: Double, _ steps: [(Int32, Int32)], _ f: @escaping () -> Void) {
      let at = inPanel(x, y)
      func go(_ i: Int) {
        if i == steps.count { scroll(at, .pixel, 0, 0, phase: 4); return later(1.0, f) }   // ended
        scroll(at, .pixel, steps[i].0, steps[i].1, phase: i == 0 ? 1 : 2)                  // began, changed
        later(0.016) { go(i + 1) }
      }
      go(0)
    }
    var evn = 0
    func click(_ x: Double, _ y: Double, _ f: @escaping () -> Void) {
      let at = inPanel(x, y)
      func mouse(_ type: NSEvent.EventType) {
        evn += 1
        if let e = NSEvent.mouseEvent(with: type, location: at, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: t.panel.windowNumber,
                                      context: nil, eventNumber: evn, clickCount: 1, pressure: type == .leftMouseUp ? 0 : 1) { t.panel.sendEvent(e) }
      }
      mouse(.leftMouseDown); later(0.08) { mouse(.leftMouseUp); later(1.0, f) }
    }
    // The window against the screen: where it ends, how tall it may be.
    func window(_ g: [String: Any]) -> (fits: Bool, info: String) {
      let vf = NSScreen.main?.visibleFrame ?? .zero, f = t.panel.frame, cap = Double(Toast.cap()), posted = num(g, "posted")
      let below = NSPoint(x: f.midX, y: f.minY - 2)
      let fits = abs(Double(f.height) - posted) <= 1 && Double(f.height) <= cap + 1 && abs(f.maxY - (vf.maxY - 4)) <= 1 && !f.contains(below)
        && num(g, "bar") <= posted + 1 && num(g, "page") <= posted + 1
      return (fits, "window=\(Int(f.height))/cap \(Int(cap))/screen \(Int(vf.height)) (\(Int(Double(f.height) / Double(max(1, vf.height)) * 100))%)")
    }
    // The stack as a picture, and the same on a screen sized canvas with the window's outline (the dashed
    // line is where the window ends: below it every click reaches the app underneath).
    func pictures(_ name: String, screen: Bool, _ f: @escaping () -> Void) {
      t.web.takeSnapshot(with: nil) { img, _ in
        guard let img else { print("snapshot failed", name); return f() }
        func save(_ i: NSImage, _ p: String) {
          if let tiff = i.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) {
            try? png.write(to: URL(fileURLWithPath: p)); print("saved", p)
          }
        }
        save(img, "\(dir)/\(name).png")
        guard screen, let s = NSScreen.main else { return f() }
        let sf = s.frame, vf = s.visibleFrame, pf = t.panel.frame
        let canvas = NSImage(size: sf.size)
        canvas.lockFocus()
        NSGradient(starting: NSColor(calibratedRed: 0.16, green: 0.2, blue: 0.3, alpha: 1), ending: NSColor(calibratedRed: 0.32, green: 0.22, blue: 0.3, alpha: 1))?.draw(in: NSRect(origin: .zero, size: sf.size), angle: -60)
        NSColor(white: 0, alpha: 0.35).setFill(); NSRect(x: 0, y: vf.maxY - sf.minY, width: sf.width, height: sf.maxY - vf.maxY).fill()
        // Where it shows on the developer's screen (a test copy parks the real window far off screen, only sideways).
        let at = NSRect(x: vf.maxX - pf.width - 6 - sf.minX, y: pf.minY - sf.minY, width: pf.width, height: pf.height)
        img.draw(in: at)
        let line = NSBezierPath(rect: at.insetBy(dx: 0.5, dy: 0.5)); line.lineWidth = 1.5; line.setLineDash([6, 4], count: 2, phase: 0)
        NSColor(calibratedRed: 0.93, green: 0.31, blue: 0.53, alpha: 0.95).setStroke(); line.stroke()
        let words = "Window ends here: clicks below reach your apps" as NSString
        let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 13, weight: .semibold), .foregroundColor: NSColor.white]
        let ws = words.size(withAttributes: attrs)
        words.draw(at: NSPoint(x: at.maxX - ws.width - 8, y: at.minY - ws.height - 8), withAttributes: attrs)
        canvas.unlockFocus()
        save(canvas, "\(dir)/\(name)-screen.png")
        f()
      }
    }
    func finish() {
      js("document.getElementById('clear').click()") { _ in
        later(1.6) {
          r.append(("clear-all-hides-window", !t.panel.isVisible))
          t.onAction = keep
          print("STACK CHECK:", r.map { "\($0.0)=\($0.1 ? "ok" : "FAIL")" }.joined(separator: " "), "wheel-events=\(sent) key=\(t.panel.isKeyWindow) activePS=\(NSApp.isActive)")
          done()
        }
      }
    }

    // The top visible card's own parts (s12 is the newest, at the top).
    let top = ".card[data-id=\"c:test-s12\"]"
    let label = "(document.querySelector('\(top) button.rem')||{}).textContent"
    // The card nearest the middle of the list, and where it is on screen.
    let mid = "(function(){var l=document.getElementById('list').getBoundingClientRect(),m=(l.top+l.bottom)/2,best=null,d=1e9;[].forEach.call(document.querySelectorAll('.card'),function(c){var b=c.getBoundingClientRect(),k=Math.abs((b.top+b.bottom)/2-m);if(k<d){d=k;best=c}});return best?{id:best.dataset.id,y:best.getBoundingClientRect().top}:null})()"

    // ---------- 1 card ----------
    js("var b=document.getElementById('clear');b&&b.click();window.__note.drop&&[].forEach.call(document.querySelectorAll('.card'),function(c){c.dataset.id&&window.__note.drop(c.dataset.id)})") { _ in
      later(1.4) {
        add(1)
        later(1.6) {
          geom { g1 in
            let w1 = window(g1)
            r.append(("one-card", num(g1, "n") == 1 && g1["scroll"] as? Bool == false && g1["open"] as? Bool == false && w1.fits))
            print("STACK 1:", w1.info, g1)
            pictures("stack-1", screen: true) {
              // ---------- 3 cards ----------
              addMany(2, 3) {
                geom { g3 in
                  let w3 = window(g3)
                  let scrolls = num(g3, "max") > 2
                  r.append(("three-cards", num(g3, "n") == 3 && g3["open"] as? Bool == true && (g3["count"] as? String) == "3 notifications" && w3.fits
                            && (g3["scroll"] as? Bool) == scrolls && (g3["down"] as? Bool) == scrolls))
                  print("STACK 3:", w3.info, g3)
                  pictures("stack-3", screen: true) { twelve() }
                }
              }
            }
          }
        }
      }
    }

    // ---------- 12 cards: capped, scrolls, no window resizes once capped ----------
    func twelve() {
      addMany(4, 11) {
        let r0 = t.resizes
        add(12)
        later(1.6) {
          geom { g in
            let w = window(g)
            r.append(("twelve-capped", num(g, "n") == 12 && w.fits && num(g, "posted") <= Double(Toast.cap()) && num(g, "max") > 200 && (g["count"] as? String) == "12 notifications"))
            r.append(("fade-at-bottom", g["scroll"] as? Bool == true && g["down"] as? Bool == true && g["up"] as? Bool == false && num(g, "fade") < 0.05))
            r.append(("no-resize-while-capped", t.resizes == r0))
            r.append(("bar-on-top", num(g, "barTop") <= 14 && num(g, "bar") < num(g, "first") && num(g, "first") < 60))
            print("STACK 12:", w.info, "resizes \(r0)->\(t.resizes)", g)
            pictures("stack-12", screen: true) { wheelChecks() }
          }
        }
      }
    }

    // ---------- the wheel: over the pill it is the time, anywhere else it scrolls ----------
    func wheelChecks() {
      js(label) { l0 in
        notches("\(top) button.rem", true, 2) {
          geom { g1 in
            js(label) { l1 in
              r.append(("wheel-on-pill-changes-time", (l0 as? String) == "Remind me in 2 mins" && (l1 as? String) == "Remind me in 4 mins" && num(g1, "top") == 0))
              // The pointer on the pill lights it, on the title it does not.
              point("\(top) button.rem") { p in
                if let p { t.host.testPointer(Int(p.0), Int(p.1)) }
                later(0.5) {
                  geom { gh in
                    pictures("stack-pill", screen: false) {
                      point("\(top) .t") { q in
                        if let q { t.host.testPointer(Int(q.0), Int(q.1)) }
                        later(0.4) {
                          geom { gn in
                            r.append(("pill-lights-under-pointer", num(gh, "hot") == 1 && num(gn, "hot") == 0))
                            notches("\(top) .t", false, 2) {
                              geom { g2 in
                                js(label) { l2 in
                                  r.append(("wheel-elsewhere-scrolls-stack", num(g2, "top") > 20 && (l2 as? String) == "Remind me in 4 mins" && g2["up"] as? Bool == true))
                                  r.append(("bar-pinned-while-scrolled", num(g2, "barTop") == num(g1, "barTop") && num(g2, "first") < num(g2, "barTop")))
                                  t.host.testPointer(-1, -1)
                                  held()
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

    // ---------- a new card while scrolled down: nothing on screen moves ----------
    func at(_ id: String) -> String { "(function(){var c=document.querySelector('.card[data-id=\"\(id)\"]');return c?c.getBoundingClientRect().top:null})()" }
    func held() {
      js("document.getElementById('list').scrollTop=260") { _ in
        later(0.6) {
          js(mid) { v in
            guard let m = v as? [String: Any], let id = m["id"] as? String, let y0 = m["y"] as? Double else { r.append(("scroll-held-on-new-card", false)); return finish() }
            geom { gb in
              let r0 = t.resizes
              add(13)
              var ys: [Double] = []
              func sample(_ k: Int, _ f: @escaping () -> Void) {
                guard k > 0 else { return f() }
                js(at(id)) { y in ys.append(y as? Double ?? -1); later(0.12) { sample(k - 1, f) } }
              }
              sample(8) {
                geom { ga in
                  let still = ys.allSatisfy { abs($0 - y0) <= 1 }
                  let moved = num(ga, "top") - num(gb, "top")
                  r.append(("scroll-held-on-new-card", still && moved > 60 && (ga["newer"] as? String) == "\u{2191} 1 new" && t.resizes == r0))
                  print("STACK HELD: card \(id) y \(Int(y0)) -> \(ys.map { Int($0) }) scroll \(Int(num(gb, "top")))->\(Int(num(ga, "top")))")
                  pictures("stack-held", screen: false) {
                    // A real click on the pill: back to the top, the pill goes.
                    point("#newer") { p in
                      guard let p else { r.append(("new-pill-goes-to-top", false)); return topNew() }
                      click(p.0, p.1) {
                        geom { gt in
                          r.append(("new-pill-goes-to-top", num(gt, "top") == 0 && (gt["newer"] as? String) == ""))
                          topNew()
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
    // At the top a new card springs into the top place and the list stays at the top.
    func topNew() {
      add(14)
      later(1.4) {
        geom { g in
          js("(function(){var cs=[].slice.call(document.querySelectorAll('.card')).sort(function(a,b){return a.getBoundingClientRect().top-b.getBoundingClientRect().top});var n=document.querySelector('.card[data-id=\"c:test-s14\"]');return {id:cs[0]&&cs[0].dataset.id,op:n?getComputedStyle(n).opacity:''}})()") { v in
            let d = v as? [String: Any] ?? [:]
            r.append(("new-card-at-top-when-at-top", num(g, "top") == 0 && (d["id"] as? String) == "c:test-s14" && (d["op"] as? String) == "1" && (g["newer"] as? String) == ""))
            pictures("stack-top-new", screen: false) { axisLock() }
          }
        }
      }
    }

    // ---------- trackpad gestures lock to one axis ----------
    func axisLock() {
      let target = ".card[data-id=\"c:test-s13\"]"
      // Bring a known card to the middle, so both gestures start on it.
      js("(function(){var l=document.getElementById('list'),c=document.querySelector('\(target)');l.scrollTop+=c.getBoundingClientRect().top-l.getBoundingClientRect().top-l.clientHeight/2+c.offsetHeight/2;return l.scrollTop})()") { _ in
        later(0.6) {
          point("\(target) .t") { p in
            guard let p else { r.append(("vertical-never-swipes", false)); return finish() }
            geom { g0 in
              let n0 = got.count
              // Down with a little sideways, then sideways only, all one gesture: it scrolls, no card moves.
              var steps: [(Int32, Int32)] = [(-10, 2)]
              for k in 0..<6 { steps.append((-14, k % 2 == 0 ? 3 : -3)) }
              for _ in 0..<6 { steps.append((0, -30)) }
              let drag = "[].some.call(document.querySelectorAll('.card'),function(c){return c.classList.contains('drag')||Math.abs(new WebKitCSSMatrix(getComputedStyle(c).transform).m41)>1})"
              var dragged = false
              gesture(p.0, p.1, steps) {
                js(drag) { d in
                  if (d as? Bool) == true { dragged = true }
                  geom { g1 in
                    r.append(("vertical-never-swipes", !dragged && got.count == n0 && num(g1, "n") == num(g0, "n") && num(g1, "top") > num(g0, "top") + 30))
                    print("STACK AXIS v: scroll \(Int(num(g0, "top")))->\(Int(num(g1, "top"))) cards \(Int(num(g0, "n")))->\(Int(num(g1, "n")))")
                    // Sideways with a little up and down: that card goes, the stack stays where it is.
                    point("\(target) .t") { q in
                      guard let q else { r.append(("sideways-swipes-not-scrolls", false)); return finish() }
                      var side: [(Int32, Int32)] = [(1, -12)]
                      for k in 0..<8 { side.append((k % 2 == 0 ? 4 : -4, -30)) }
                      gesture(q.0, q.1, side) {
                        later(0.4) {
                          geom { g2 in
                            r.append(("sideways-swipes-not-scrolls", got.contains("c:test-s13:dismiss") && num(g2, "n") == num(g1, "n") - 1 && abs(num(g2, "top") - num(g1, "top")) <= 1))
                            print("STACK AXIS h: scroll \(Int(num(g1, "top")))->\(Int(num(g2, "top"))) cards \(Int(num(g1, "n")))->\(Int(num(g2, "n"))) actions \(got.suffix(3))")
                            geom { gw in
                              let w = window(gw)
                              r.append(("clicks-pass-below-stack", w.fits))
                              print("STACK BELOW:", w.info, "frame=\(t.panel.frame)")
                              pictures("stack-swipe", screen: true) { finish() }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
              // While the gesture runs (sideways part included): never a card on the move.
              later(0.2) { js(drag) { d in if (d as? Bool) == true { dragged = true } } }
              later(0.3) { js(drag) { d in if (d as? Bool) == true { dragged = true } } }
            }
          }
        }
      }
    }
  }
}
