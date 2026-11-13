import AppKit
import WebKit

// Self test for Do Not Disturb (DND.swift, web src/core/dnd.ts and src/views/Dnd.tsx). FICTIONAL
// data. Real mouse events into the parked overlay: the moon off, one click turns it on at once with no
// pop-up, a second click opens the pop-up (every toggle muted, the duration chips), a toggle and a chip
// work, Turn off Do Not Disturb turns it off. Native side: a muted PS card (End my day) is held and comes
// up when DND ends, a VPN alarm is never held, card sounds are muted but the Tab list's own sounds are not,
// the island lights up instead of popping, the 2 am card's kinds map right. PS_SELFTEST_ONLY=dnd.
// Pictures: dnd-off.png, dnd-on.png, dnd-popover.png, dnd-popover-toggled.png, dnd-released.png.
extension SelfTest {
  /// The test copy has no vault: the overlay's DND action is applied to its test settings the same way
  /// core/dnd.ts dndApply does it (on keeps the let-through list, off records when).
  static func dndApplyForTest(_ cur: [String: Any]?, _ op: [String: Any]) -> [String: Any] {
    var d = cur ?? ["on": false]
    let now = ISO8601DateFormatter().string(from: Date())
    switch op["op"] as? String {
    case "on": if (d["on"] as? Bool) != true { d["on"] = true; d["since"] = now; d["until"] = NSNull() }
    case "off": if (d["on"] as? Bool) == true { d["on"] = false; d["offAt"] = now }
    case "pass":
      var pass = (d["pass"] as? [String]) ?? []
      if let k = op["kind"] as? String {
        pass.removeAll { $0 == k }
        if (op["pass"] as? Bool) == true { pass.append(k) }
      }
      d["pass"] = pass
    case "until": d["until"] = (op["until"] as? String) ?? NSNull()
    default: break
    }
    return d
  }

  static func dndCheck(_ a: App, _ dir: String, _ done: @escaping () -> Void) {
    func later(_ t: Double, _ f: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + t, execute: f) }
    func js(_ s: String, _ f: @escaping (Any?) -> Void) { a.overlay.evaluateJavaScript(s) { v, _ in f(v) } }
    /// A real click (mouse down, then up 90 ms later) on the element's centre, into the overlay window.
    func click(_ sel: String, _ f: @escaping (Bool) -> Void) {
      js("(function(){var e=document.querySelector('\(sel)');if(!e)return null;var r=e.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()") { v in
        guard let xy = v as? [NSNumber], xy.count == 2, let w = a.overlay else { f(false); return }
        let local = NSPoint(x: xy[0].doubleValue, y: w.isFlipped ? xy[1].doubleValue : w.bounds.height - xy[1].doubleValue)
        let inWin = w.convert(local, to: nil)
        a.updateClickThrough(at: NSPoint(x: xy[0].doubleValue, y: xy[1].doubleValue))
        func ev(_ t: NSEvent.EventType) -> NSEvent? {
          NSEvent.mouseEvent(with: t, location: inWin, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: a.panel.windowNumber,
                             context: nil, eventNumber: 11, clickCount: 1, pressure: t == .leftMouseUp ? 0 : 1)
        }
        if let d = ev(.leftMouseDown) { a.panel.sendEvent(d) }
        later(0.09) { if let u = ev(.leftMouseUp) { a.panel.sendEvent(u) }; f(true) }
      }
    }
    let keep = a.lastState
    var r: [(String, Bool)] = []
    let state = "JSON.stringify({btn: !!document.querySelector('.dnd-btn'), on: !!document.querySelector('.dnd-btn.on'), menu: !!document.querySelector('.dnd-menu'), rows: document.querySelectorAll('.dnd-menu .dnd-row').length, muted: document.querySelectorAll('.dnd-menu .dnd-row.muted').length, chip: (document.querySelector('.dnd-chips .sel')||{}).textContent||'', mail: !!document.querySelector('.dnd-menu .dnd-row.muted') && [].some.call(document.querySelectorAll('.dnd-menu .dnd-row'), function(b){return /Client emails/.test(b.textContent) && !b.classList.contains('muted')}), island: [].some.call(document.querySelectorAll('.dnd-menu .dnd-row'), function(b){return /Dynamic Island/.test(b.textContent) && !b.classList.contains('muted')}), redRows: [].filter.call(document.querySelectorAll('.dnd-menu .dnd-row'), function(b){return /Client emails|Claude chat done|Instantly replies|Vault notices/.test(b.textContent)}).length, right: (function(){var b=document.querySelector('.dnd-btn'), t=document.querySelector('.tm-tr'); if(!b||!t) return -1; return Math.round(t.getBoundingClientRect().right - b.getBoundingClientRect().right)})()})"
    func obj(_ v: Any?) -> [String: Any] { (v as? String).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] } ?? [:] }
    func finish() {
      print("DND CHECK:", r.map { "\($0.0)=\($0.1 ? "ok" : "FAIL")" }.joined(separator: " "))
      DND.shared.testSet(on: false, mute: [:])
      a.lastState = keep; a.pushState()
      later(0.6, done)
    }
    later(1.0) {
      js(state) { v0 in
        let s0 = obj(v0)
        r.append(("moon-top-right", (s0["btn"] as? Bool) == true && (s0["right"] as? Int).map { $0 >= 0 && $0 <= 2 } == true))
        r.append(("starts-off", (s0["on"] as? Bool) == false))
        snap(a.overlay, "\(dir)/dnd-off.png") {
          click(".dnd-btn") { _ in
            later(1.1) {
              js(state) { v1 in
                let s1 = obj(v1)
                r.append(("one-click-on-no-popup", (s1["on"] as? Bool) == true && (s1["menu"] as? Bool) == false))
                snap(a.overlay, "\(dir)/dnd-on.png") {
                  click(".dnd-btn") { _ in
                    later(0.7) {
                      js(state) { v2 in
                        let s2 = obj(v2)
                        r.append(("second-click-opens-popup", (s2["menu"] as? Bool) == true))
                        // Anyone but the developer has no switches for the developer's own feeds (Claude chats, client emails, Instantly, vault notices).
                        let rows = Owner.red ? 10 : 6
                        r.append(("every-toggle-muted", (s2["rows"] as? Int) == rows && (s2["muted"] as? Int) == rows))
                        r.append((Owner.red ? "red-feed-switches-shown" : "public-has-no-red-feed-switches", (s2["redRows"] as? Int) == (Owner.red ? 4 : 0)))
                        r.append(("until-off-by-default", (s2["chip"] as? String) == "Until I turn it off"))
                        snap(a.overlay, "\(dir)/dnd-popover.png") {
                          click(".dnd-menu .dnd-list li:nth-child(2) .dnd-row") { _ in
                            later(0.6) {
                              click(".dnd-menu .dnd-chips button:nth-child(1)") { _ in
                                later(0.8) {
                                  js(state) { v3 in
                                    let s3 = obj(v3)
                                    // The second row: Client emails on the developer's PS, Dynamic Island pop on anyone else's.
                                    if Owner.red { r.append(("toggle-lets-email-through", (s3["mail"] as? Bool) == true)) }
                                    else { r.append(("toggle-lets-island-through", (s3["island"] as? Bool) == true)) }
                                    r.append(("one-hour-chip", (s3["chip"] as? String) == "1 hour"))
                                    snap(a.overlay, "\(dir)/dnd-popover-toggled.png") {
                                      native {
                                        click(".dnd-menu .dnd-off") { _ in
                                          later(1.0) {
                                            js(state) { v4 in
                                              let s4 = obj(v4)
                                              r.append(("turn-off-button", (s4["on"] as? Bool) == false && (s4["menu"] as? Bool) == false))
                                              finish()
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

    /// The Mac's own cards, sounds, the island and the 2 am card (no page involved).
    func native(_ next: @escaping () -> Void) {
      let t = Toast.shared
      let all: [String: Bool] = ["chats": true, "mail": true, "leads": true, "meetings": true, "island": true, "sounds": true, "vault": true, "system": true, "followup": true, "phone": true]
      DND.shared.testSet(on: true, mute: all)
      t.showCard(["id": "eod", "title": "Shall I end my day now?", "actions": [["id": "yes", "label": "Yes"]]])
      t.showMeet(["id": "net-vpn", "tone": "bad", "icon": "shield", "title": "VPN is OFF", "sub": "Fictional test"])
      t.showMeet(["id": "mb:test1", "tone": "booked", "title": "Fictional Lead just booked a call", "sub": "Tomorrow 15:00"])
      r.append(("ps-card-held", t.heldIds.contains("eod") && t.heldIds.contains("mb:test1")))
      r.append(("vpn-alarm-never-held", !t.heldIds.contains("net-vpn")))
      r.append(("card-sounds-muted", DND.shared.mutes("sounds") && DND.cardSounds.contains("chime") && !DND.cardSounds.contains("click")))
      r.append(("kinds-map", DND.kind(id: "m:x", tone: "mail") == "mail" && DND.kind(id: "c:x", tone: "done") == "chats" && DND.kind(id: "n:x", tone: "lead") == "leads"
                && DND.kind(id: "ms:x", tone: "soon") == "meetings" && DND.kind(id: "ar:airpods", tone: nil) == "system" && DND.kind(id: "nl:x", tone: "bad") == nil
                && DND.kind(id: "private-ask", tone: nil) == nil))
      // The island: news while muted lights it up and never opens it.
      let isl = Island.shared
      isl.update(["mode": "notch", "private": false, "task": ["id": "t1", "title": "Fictional task", "dim": false], "more": 0, "tasks": [], "mail": 1, "leads": 0,
                  "event": ["id": "dnd-e1", "kind": "mail", "title": "Jane just sent an email", "sub": "Northwind Silk", "url": "https://mail.google.com/", "quiet": true]])
      later(0.6) {
        r.append(("island-lights-up-no-pop", isl.model.popping == nil && isl.model.glowing))
        // An end time that has passed: everything held comes up by itself.
        DND.shared.testSet(on: true, until: Date().addingTimeInterval(1.0), mute: all)
        later(2.0) {
          r.append(("ends-by-itself-releases", !DND.shared.active && t.heldIds.isEmpty))
          t.web.evaluateJavaScript("[!!document.querySelector('.card[data-id=\"eod\"]'), !!document.querySelector('.card[data-id=\"mb:test1\"]')]") { v, _ in
            let shown = (v as? [Bool]) ?? []
            r.append(("held-cards-come-up", shown == [true, true]))
            snap(t.web, "\(dir)/dnd-released.png") {
              t.hideCard("eod"); t.hideCard("net-vpn"); t.hideCard("mb:test1")
              next()
            }
          }
        }
      }
    }
  }
}
