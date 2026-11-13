import AppKit
import WebKit

// Self test for Edit mode in the Tab list (G Squad, the developer 7 Nov 2026), web src/views/EditMode.tsx and
// src/core/tablayout.ts. PS_SELFTEST_ONLY=editmode, with PS_SELFTEST_RED=1 (the developer's) and =0 (a stranger's, the public
// G Squad). Real mouse events into the parked overlay (the window's own event path), fictional tasks only.
// EDIT: the Edit button sits top left on every account; a click opens Edit mode (the list is kept up, the island is
// told, the whole screen takes the clicks); every panel has its outline, the developer's own panels only on the developer's account.
// MOVE: a real drag of the Meetings panel's outline moves it (snapped, on screen) and the layout goes to the main page
// as its own small layoutOp (never a settings save). REMOVE: the x removes Overdue; the Hidden tray brings it back.
// DONE: the layout stays; outside Edit mode a real drag on a panel moves nothing; Esc leaves Edit mode; Reset puts
// everything back. Pictures: editmode-on.png, editmode-moved.png, editmode-tray.png, editmode-done.png.
extension SelfTest {
  static func editModeCheck(_ a: App, _ dir: String, _ done: @escaping () -> Void) {
    var r: [(String, Bool)] = []
    let red = ProcessInfo.processInfo.environment["PS_SELFTEST_RED"] != "0"
    var evn = 700
    func later(_ t: Double, _ f: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + t, execute: f) }
    func js(_ s: String, _ f: @escaping (Any?) -> Void) { a.overlay.evaluateJavaScript(s) { v, _ in f(v) } }
    func obj(_ v: Any?) -> [String: Any] { (v as? String).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] } ?? [:] }
    func win(_ x: Double, _ y: Double) -> NSPoint {
      let v = a.overlay!
      return v.convert(NSPoint(x: x, y: v.isFlipped ? y : v.bounds.height - y), to: nil)
    }
    func send(_ t: NSEvent.EventType, _ p: NSPoint) {
      evn += 1
      if let e = NSEvent.mouseEvent(with: t, location: p, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: a.panel.windowNumber,
                                    context: nil, eventNumber: evn, clickCount: 1, pressure: t == .leftMouseUp ? 0 : 1) { a.panel.sendEvent(e) }
    }
    func centre(_ sel: String) -> String {
      "(function(){var e=document.querySelector(\(String(reflecting: sel)));if(!e)return null;var b=e.getBoundingClientRect();return [b.left+b.width/2,b.top+b.height/2]})()"
    }
    func click(_ sel: String, _ f: @escaping (Bool) -> Void) {
      js(centre(sel)) { v in
        guard let xy = v as? [NSNumber], xy.count == 2 else { f(false); return }
        let p = win(xy[0].doubleValue, xy[1].doubleValue)
        send(.leftMouseDown, p); later(0.08) { send(.leftMouseUp, p); later(0.35) { f(true) } }
      }
    }
    /// A real drag from the middle of `sel` by (dx, dy) page points, in small steps like a hand.
    func drag(_ sel: String, _ dx: Double, _ dy: Double, _ f: @escaping (Bool) -> Void) {
      js(centre(sel)) { v in
        guard let xy = v as? [NSNumber], xy.count == 2 else { f(false); return }
        let x0 = xy[0].doubleValue, y0 = xy[1].doubleValue
        send(.leftMouseDown, win(x0, y0))
        func step(_ i: Int) {
          if i > 14 { send(.leftMouseUp, win(x0 + dx, y0 + dy)); later(0.6) { f(true) }; return }
          let t = Double(i) / 14
          send(.leftMouseDragged, win(x0 + dx * t, y0 + dy * t))
          later(0.025) { step(i + 1) }
        }
        later(0.06) { step(1) }
      }
    }
    let ov = ".tm-overlay:not(.tm-docked)"
    let state = """
      (function(){var o=document.querySelector('\(ov)');if(!o)return '{}';var m=o.querySelector('[data-slot=meetings]'),od=o.querySelector('[data-slot=overdue]');
      var mr=m&&(m.classList.contains('ed-moved')?m:m.firstElementChild);var b=mr?mr.getBoundingClientRect():null;
      return JSON.stringify({edit:!!o.querySelector('.ed-layer'),btn:!!o.querySelector('.ed-corner .ed-btn'),btnAt:(function(){var e=o.querySelector('.ed-corner');if(!e)return null;var q=e.getBoundingClientRect();return [Math.round(q.left),Math.round(q.top)]})(),
        boxes:[...o.querySelectorAll('.ed-box')].map(function(x){return x.getAttribute('aria-label').replace('Move ','')}),
        moved:!!(m&&m.classList.contains('ed-moved')),meet:b?[Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)]:null,
        odHidden:!!(od&&od.classList.contains('ed-hidden')),chips:[...o.querySelectorAll('.ed-chip')].map(function(x){return x.textContent.replace('+','')}),
        vw:innerWidth,vh:innerHeight})})()
      """
    let looks = { a.testRaw.filter { $0.contains("\"type\":\"looks\"") } }
    let redOnly = ["Numerology", "Campaign stats", "Rule book", "Morning brief", "Second Computer", "Client emails", "New tasks"]

    // ---------- EDIT ----------
    js(state) { v in
      let s0 = obj(v)
      let at = s0["btnAt"] as? [Int]
      r.append(("edit-button-top-left", s0["btn"] as? Bool == true && (at.map { $0[0] < 60 && $0[1] < 60 } ?? false)))
      let log0 = a.testLog.count, looks0 = looks().count
      click("\(ov) .ed-corner .ed-btn") { _ in
        later(0.5) {
          js(state) { v in
            let s = obj(v), boxes = s["boxes"] as? [String] ?? []
            let newLog = Array(a.testLog.suffix(from: min(log0, a.testLog.count)))
            r.append(("edit-opens", s["edit"] as? Bool == true))
            r.append(("edit-keeps-list-up", newLog.contains("keep") && a.kept))
            r.append(("edit-tells-island", newLog.contains("island:edit")))
            r.append(("edit-whole-screen-clicks", a.hitRects.count == 1 && (a.hitRects.first.map { $0.width >= CGFloat(s["vw"] as? Int ?? 1) - 1 } ?? false)))
            r.append(("edit-outlines-panels", ["Time zones", "Meetings", "Overdue", "Settings", "Do Not Disturb", "Glass slider"].allSatisfy { boxes.contains($0) }))
            r.append((red ? "edit-red-panels-shown" : "edit-red-panels-hidden", red ? boxes.contains("Client emails") : !boxes.contains { redOnly.contains($0) }))
            print("EDIT BOXES:", boxes.joined(separator: ", "))
            snap(a.overlay, "\(dir)/editmode-on.png") {
              // ---------- MOVE ----------
              let before = (s["meet"] as? [Int]) ?? []
              drag("\(ov) .ed-box[aria-label='Move Meetings']", 520, -120) { okd in
                js(state) { v in
                  let s2 = obj(v), m = (s2["meet"] as? [Int]) ?? [], vw = s2["vw"] as? Int ?? 0, vh = s2["vh"] as? Int ?? 0
                  let moved = okd && s2["moved"] as? Bool == true && m.count == 4 && before.count == 4 && abs(m[0] - (before[0] + 520)) < 16
                  r.append(("move-drag-moves-panel", moved))
                  r.append(("move-stays-on-screen", m.count == 4 && m[0] >= 11 && m[1] >= 11 && m[0] + m[2] <= vw - 11 && m[1] + m[3] <= vh - 11))
                  print("EDIT MOVE: before=\(before) after=\(m) screen=\(vw)x\(vh)")
                  later(0.8) {
                    let sent = looks().suffix(from: min(looks0, looks().count))
                    r.append(("move-saved-as-layout-op", sent.contains { $0.contains("layoutOp") && $0.contains("tablayout") && $0.contains("meetings") }))
                    r.append(("move-never-a-settings-save", !sent.contains { $0.contains("tmLayout") || ($0.contains("\"pos\"") && !$0.contains("layoutOp")) }))
                    r.append(("move-small", (sent.last { $0.contains("layoutOp") }?.count ?? 9999) < 1200))
                    snap(a.overlay, "\(dir)/editmode-moved.png") {
                      // ---------- REMOVE, BRING BACK ----------
                      click("\(ov) .ed-box[aria-label='Move Overdue'] .ed-x") { _ in
                        later(0.4) {
                          click("\(ov) .ed-bar .ed-btn:nth-child(2)") { _ in
                            js(state) { v in
                              let s3 = obj(v), chips = s3["chips"] as? [String] ?? []
                              r.append(("remove-hides", s3["odHidden"] as? Bool == true && !(s3["boxes"] as? [String] ?? []).contains("Overdue")))
                              r.append(("tray-lists-it", chips.contains("Overdue")))
                              snap(a.overlay, "\(dir)/editmode-tray.png") {
                                click("\(ov) .ed-chip") { _ in
                                  later(0.5) {
                                    js(state) { v in
                                      r.append(("tray-brings-back", obj(v)["odHidden"] as? Bool == false))
                                      // ---------- DONE ----------
                                      click("\(ov) .ed-done") { _ in
                                        // Done lets go of the keep it took, so PS puts the list away: show it again to look.
                                        let unkept = !a.kept
                                        reshow {
                                          js(state) { v in
                                            r.append(("done-lets-go-of-keep", unkept))
                                            let s4 = obj(v), m4 = (s4["meet"] as? [Int]) ?? []
                                            r.append(("done-leaves-edit", s4["edit"] as? Bool == false && s4["btn"] as? Bool == true))
                                            r.append(("done-keeps-layout", s4["moved"] as? Bool == true))
                                            snap(a.overlay, "\(dir)/editmode-done.png") {
                                              // Outside Edit mode a drag on the panel's top edge moves nothing.
                                              js("(function(){var e=document.querySelector('\(ov) [data-slot=meetings]');if(!e)return null;var b=e.getBoundingClientRect();return [b.left+b.width/2,b.top+6]})()") { v in
                                                guard let xy = v as? [NSNumber], xy.count == 2 else { r.append(("no-drag-outside-edit", false)); finish(); return }
                                                let x0 = xy[0].doubleValue, y0 = xy[1].doubleValue
                                                send(.leftMouseDown, win(x0, y0))
                                                later(0.05) { send(.leftMouseDragged, win(x0 - 200, y0 + 100)); later(0.05) { send(.leftMouseUp, win(x0 - 200, y0 + 100))
                                                  later(0.4) {
                                                    js(state) { v in
                                                      let m5 = (obj(v)["meet"] as? [Int]) ?? []
                                                      r.append(("no-drag-outside-edit", m5.count == 4 && m4.count == 4 && m5[0] == m4[0] && m5[1] == m4[1]))
                                                      escAndReset()
                                                    }
                                                  }
                                                } }
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
              }
            }
          }
        }
      }
    }
    // Esc leaves Edit mode; Reset puts everything back.
    func reshow(_ f: @escaping () -> Void) { a.showOverlay(); later(1.0, f) }
    func escAndReset() {
      reshow { click("\(ov) .ed-corner .ed-btn") { _ in
        later(0.3) {
          js("(function(){var e=new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});window.dispatchEvent(e);return !!document.querySelector('\(ov) .ed-layer')})()") { v in
            later(0.3) {
              js(state) { v2 in
                r.append(("esc-leaves-edit", (v as? Bool) == true && obj(v2)["edit"] as? Bool == false))
                reshow { click("\(ov) .ed-corner .ed-btn") { _ in
                  click("\(ov) .ed-bar .ed-btn:nth-child(3)") { _ in
                    later(0.5) {
                      js(state) { v in
                        r.append(("reset-puts-back", obj(v)["moved"] as? Bool == false))
                        click("\(ov) .ed-done") { _ in finish() }
                      }
                    }
                  }
                } }
              }
            }
          }
        }
      } }
    }
    func finish() {
      print("EDIT MODE CHECK (\(red ? "Owner" : "stranger")):", r.map { "\($0.0)=\($0.1 ? "ok" : "FAIL")" }.joined(separator: " "))
      done()
    }
  }
}
