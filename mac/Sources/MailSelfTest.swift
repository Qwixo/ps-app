import AppKit

// Self test for the client email cards that stay until dismissed (src/mailcards.ts -> Toast, tone
// "mail"). FICTIONAL emails only, sent through the real bridge from the main page just as
// src/mailcards.ts does. Checks: they outlive the normal 14 s auto clear (PS_SELFTEST_MAIL5=1 waits a
// full 5 minutes), a click on the body or Open in Gmail leaves them, every card shows at once (no
// collapsed stack, the developer 30 Oct 2026), simulated sleep and wake leave them, a restart (fresh page) gets
// them back when the main window sends them again, sending the same card twice shows it once, private
// mode hides their names, Dismiss removes one, Clear all the rest. Remind me in (mailRemind below):
// real scroll wheel events on the button step it by 5 minutes and never scroll the list (on the card's
// text they scroll the list instead, the developer 31 Oct 2026), a real
// click sends it and the card leaves, a typed time ("40", "1h30") sends that, Escape cancels, and the
// card comes back when the main window sends it again at the time. A real mouse drag to the right
// dismisses a card, a short one springs back. A finished Claude chat card starts at 2 minutes and steps
// by 1. Pictures: mail-list.png, mail-open.png, mail-discreet.png, mail-remind.png, mail-done.png.
// The panel never takes the keyboard or brings PS forward, and test copies never open a link.
extension SelfTest {
  static func mailCards(_ a: App, _ dir: String, _ done: @escaping () -> Void) {
    let t = Toast.shared
    func post(_ obj: [String: Any]) {
      guard let d = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: d, encoding: .utf8) else { return }
      a.main.callAsyncJavaScript("window.webkit.messageHandlers.ps.postMessage(m)", arguments: ["m": s], in: nil, in: .page, completionHandler: nil)
    }
    let iso = ISO8601DateFormatter()
    let cards: [[String: Any]] = [
      ["id": "m:test-r1", "tone": "mail", "icon": "mail", "title": "Jane just sent an email", "sub": "Northwind Silk · Homepage draft",
       "body": "Hi Sam. Loved the draft! Can we move the banner up a little? Also the font feels small on phones.", "url": "https://mail.google.com/mail/?authuser=test#all/r1",
       "at": iso.string(from: Date().addingTimeInterval(-600)), "discreetText": "New client email"],
      ["id": "m:test-r2", "tone": "mail", "icon": "mail", "title": "Sam just sent an email", "sub": "Example Co · Invoice 12",
       "body": "Thanks, paid today.", "url": "https://mail.google.com/mail/?authuser=test#all/r2", "at": iso.string(from: Date().addingTimeInterval(-300)), "discreetText": "New client email"],
      ["id": "m:test-r3", "tone": "mail", "icon": "mail", "title": "Ana just sent an email", "sub": "Lumi Botanics · Proposal",
       "body": "Looks great, a few questions on the timeline.", "url": "https://mail.google.com/mail/?authuser=test#all/r3", "at": iso.string(from: Date().addingTimeInterval(-60)), "discreetText": "New client email"],
    ]
    func sendAll() { for c in cards { post(["type": "meetCard", "card": c]) } }
    let keep = t.onAction
    var got: [String] = []
    t.onAction = { id, action in got.append("\(id):\(action)") }
    let count = "document.querySelectorAll('.card.t-mail').length"
    var r: [(String, Bool)] = []
    func js(_ s: String, _ f: @escaping (Any?) -> Void) { t.web.evaluateJavaScript(s) { v, _ in f(v) } }
    let stay = ProcessInfo.processInfo.environment["PS_SELFTEST_MAIL5"] == "1" ? 300.0 : 20.0
    // Every card at once: all three fully showing, none on top of another, the bar up for 2 or more.
    let showing = "(function(){var cs=[].slice.call(document.querySelectorAll('.card.t-mail')); var rs=cs.map(function(c){return c.getBoundingClientRect()}).sort(function(a,b){return a.top-b.top}); var ok=cs.length===3&&cs.every(function(c){return getComputedStyle(c).opacity==='1'}); for(var i=1;i<rs.length;i++) if(rs[i].top<rs[i-1].bottom-0.5) ok=false; return ok&&document.getElementById('wrap').classList.contains('open')})()"
    sendAll()
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
      snap(t.web, "\(dir)/mail-list.png") {
        DispatchQueue.main.asyncAfter(deadline: .now() + stay) {           // past the 14 s auto clear (or 5 minutes)
          js(count) { n in
            r.append(("stays-\(Int(stay))s", (n as? Int) == 3))
            // A click on the newest card's body, then on its Open in Gmail: both leave it.
            js("document.querySelector('.card[data-id=\"m:test-r3\"] .b').click(); document.querySelectorAll('.card.t-mail').length") { n1 in
              js("(function(){var c=document.querySelector('.card[data-id=\"m:test-r3\"]'); var b=[].filter.call(c.querySelectorAll('.acts button'),function(x){return x.dataset.link==='open'})[0]; b && b.click(); return document.querySelectorAll('.card.t-mail').length})()") { n2 in
                r.append(("body-click-leaves-it", (n1 as? Int) == 3 && !got.contains { $0.hasSuffix(":dismiss") }))
                r.append(("open-in-gmail-leaves-it", (n2 as? Int) == 3 && t.testOpened.contains { $0.contains("#all/r3") }))
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) {
                  snap(t.web, "\(dir)/mail-open.png") {
                    js(showing) { all in
                      r.append(("all-cards-showing", (all as? Bool) == true))
                      // Sleep and wake (simulated): nothing goes.
                      let nc = NSWorkspace.shared.notificationCenter
                      nc.post(name: NSWorkspace.willSleepNotification, object: nil)
                      nc.post(name: NSWorkspace.didWakeNotification, object: nil)
                      DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                        js(count) { n3 in
                          r.append(("sleep-wake-keeps", (n3 as? Int) == 3))
                          // A restart: a fresh page with nothing, then the main window sends the list again (twice).
                          t.reloadForTest {
                            js(count) { n4 in
                              sendAll(); sendAll()
                              DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                                js(count) { n5 in
                                  r.append(("restart-brings-them-back", (n4 as? Int) == 0 && (n5 as? Int) == 3))
                                  // Private mode comes on: the names and text hide.
                                  post(["type": "meetPrivacy", "on": true])
                                  DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) {
                                    js("JSON.stringify({d: document.querySelectorAll('.card.t-mail.discreet').length, txt: [].map.call(document.querySelectorAll('.card.t-mail'), function(c){return c.innerText}).join(' ')})") { v in
                                      let s = String(describing: v ?? "")
                                      r.append(("private-mode-hides-names", s.contains("\"d\":3") && !s.contains("Jane") && !s.contains("Northwind")))
                                      snap(t.web, "\(dir)/mail-discreet.png") {
                                        post(["type": "meetPrivacy", "on": false])
                                        t.reveal(true); t.reveal(false)
                                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) {
                                         mailRemind(t, dir, got: { got }, resend: { i in post(["type": "meetCard", "card": cards[i]]) }, post: post) { rr in
                                          r.append(contentsOf: rr)
                                          // Dismiss on the newest card (Ana).
                                          js("(function(){var c=document.querySelector('.card[data-id=\"m:test-r3\"]'); if(c.classList.contains('discreet')) c.click(); var b=c.querySelector('button.dis'); b && b.click(); return true})()") { _ in
                                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) {
                                              js(count) { n6 in
                                                r.append(("dismiss-removes-one", (n6 as? Int) == 2 && got.contains("m:test-r3:dismiss")))
                                                js("document.getElementById('clear').click()") { _ in
                                                  DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                                                    js(count) { n7 in
                                                      // Jane was swiped away once already (mailRemind), so her Dismiss is the second.
                                                      r.append(("clear-all-dismisses-the-rest", (n7 as? Int) == 0 && got.filter { $0 == "m:test-r1:dismiss" }.count == 2 && got.contains("m:test-r2:dismiss")))
                                                      print("MAIL CHECK:", r.map { "\($0.0)=\($0.1 ? "ok" : "FAIL")" }.joined(separator: " "), "key=\(t.panel.isKeyWindow)", "activePS=\(NSApp.isActive)")
                                                      t.onAction = keep
                                                      done()
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
          }
        }
      }
    }
  }

  /// "Remind me in 15 mins" on the newest card (FICTIONAL Ana, m:test-r3, at the top of the list),
  /// with the list short enough to scroll: real scroll wheel events (CGEvent, through the panel's own
  /// event path), up adds 5 minutes, down takes 5, 5 minutes to 4 hours, the label in hours past 60,
  /// the list never scrolls under the button, while on the card's text the wheel scrolls the list and leaves
/// the time alone (the developer, 31 Oct 2026: the stack scrolls, only the pill takes the wheel); a real click on
  /// "Remind me in" sends "remind:65" and the card leaves; sent again (as src/mailcards.ts does when
  /// the time comes) it is back at 15 minutes. A click on the time opens a box: "40" and Enter sends
  /// remind:40, "1h30" remind:90, Escape sends nothing. Then real mouse drags on Jane's card: 30 px
  /// springs back and does nothing, 250 px to the right dismisses it. Last, a finished Claude chat
  /// card (FICTIONAL): 2 minutes to start, 1 minute per notch, never under 1 minute.
  static func mailRemind(_ t: Toast, _ dir: String, got: @escaping () -> [String], resend: @escaping (Int) -> Void,
                         post: @escaping ([String: Any]) -> Void, _ done: @escaping ([(String, Bool)]) -> Void) {
    var r: [(String, Bool)] = []
    func js(_ s: String, _ f: @escaping (Any?) -> Void) { t.web.evaluateJavaScript(s) { v, _ in f(v) } }
    func later(_ s: Double, _ f: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + s, execute: f) }
    func state(_ sel: String = "button.rem", _ f: @escaping ([String: Any]) -> Void) { js("window.__note.rem(\"\(sel)\")") { v in f(v as? [String: Any] ?? [:]) } }
    func screen(_ s: [String: Any]) -> NSPoint? {
      guard let x = s["x"] as? Double, let y = s["y"] as? Double else { return nil }
      let w = t.web!
      return t.panel.convertPoint(toScreen: w.convert(NSPoint(x: x, y: w.isFlipped ? y : w.bounds.height - y), to: nil))
    }
    // A real scroll wheel event (CGEvent, one notch of 3 lines) sent through the panel's own event path
    // (NSWindow.sendEvent: hit test, then WebKit's native wheel handling), at the element's spot. An
    // event made from a CGEvent has no window, so its location is given in the panel's own coordinates.
    var sent = 0
    func wheel(_ sel: String, _ up: Bool, _ times: Int, _ f: @escaping () -> Void) {
      guard times > 0 else { return f() }
      state(sel) { s in
        guard let pt = screen(s), let cg = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1, wheel1: up ? 3 : -3, wheel2: 0, wheel3: 0) else { return f() }
        let inWin = t.panel.convertPoint(fromScreen: pt)
        cg.location = CGPoint(x: inWin.x, y: (NSScreen.screens.first?.frame.height ?? 0) - inWin.y)
        cg.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(t.panel.windowNumber))
        if let ev = NSEvent(cgEvent: cg) { t.panel.sendEvent(ev); sent += 1 }
        later(0.32) { wheel(sel, up, times - 1, f) }
      }
    }
    var evn = 0
    func mouse(_ type: NSEvent.EventType, _ at: NSPoint) {
      evn += 1
      if let e = NSEvent.mouseEvent(with: type, location: at, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: t.panel.windowNumber,
                                    context: nil, eventNumber: evn, clickCount: 1, pressure: type == .leftMouseUp ? 0 : 1) { t.panel.sendEvent(e) }
    }
    /// A real click on "Remind me in", left of the time (a click on the time opens the box instead).
    func click(_ f: @escaping () -> Void) {
      state { s in
        guard var p = s["x"] as? Double, let w = s["w"] as? Int else { return f() }
        p = p - Double(w) / 2 + 16
        var s2 = s; s2["x"] = p
        guard let pt = screen(s2) else { return f() }
        let inWin = t.panel.convertPoint(fromScreen: pt)
        mouse(.leftMouseDown, inWin)
        later(0.09) { mouse(.leftMouseUp, inWin); later(0.9, f) }
      }
    }
    /// A real mouse drag to the right from a card's title, `dx` points in 10 steps.
    func drag(_ id: String, _ dx: Double, _ f: @escaping () -> Void) {
      js("(function(){var c=document.querySelector('.card[data-id=\"\(id)\"]'); if(!c) return null; c.scrollIntoView({block:'center'}); var t=c.querySelector('.t').getBoundingClientRect(); return {x:t.left+20, y:t.top+t.height/2}})()") { v in
        guard let s = v as? [String: Any], let pt = screen(s) else { return f() }
        let start = t.panel.convertPoint(fromScreen: pt)
        mouse(.leftMouseDown, start)
        func step(_ i: Int) {
          if i > 10 { mouse(.leftMouseUp, NSPoint(x: start.x + dx, y: start.y)); return later(1.0, f) }
          mouse(.leftMouseDragged, NSPoint(x: start.x + dx * Double(i) / 10, y: start.y))
          later(0.016) { step(i + 1) }
        }
        later(0.05) { step(1) }
      }
    }
    /// A time typed into the box on Ana's card, then Enter (or Escape).
    func type(_ text: String, _ key: String, _ f: @escaping () -> Void) {
      js("(function(){var c=document.querySelector('.card[data-id=\"m:test-r3\"]'); c.querySelector('button.rem .rv').click(); window.__note.focusEdit(); var i=c.querySelector('input.rt'); if(!i) return false; i.value='\(text)'; i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new KeyboardEvent('keydown',{key:'\(key)',bubbles:true})); return true})()") { _ in later(0.9, f) }
    }
    let count = "document.querySelectorAll('.card.t-mail').length"
    let left = "(function(){var c=document.querySelector('.card[data-id=\"m:test-r1\"]'); return c ? Math.round(c.getBoundingClientRect().left) : -1})()"
    let maxH = Toast.cap()
    // Short enough that the list scrolls. The privacy check left them discreet: a click on each shows it again (as the developer would).
    js("window.__note.max(300); [].forEach.call(document.querySelectorAll('.card.t-mail.discreet'), function(c){ c.click() }); document.getElementById('list').scrollTop=0; document.getElementById('wrap').classList.contains('open')") { open in
      later(0.9) {
        state { s0 in
          r.append(("remind-button-says-15", (s0["label"] as? String) == "Remind me in 15 mins" && (s0["w"] as? Int ?? 0) > 0 && (open as? Bool) == true))
          wheel("button.rem", true, 2) {
            state { s1 in
              wheel("button.rem", false, 1) {
                state { s2 in
                  r.append(("wheel-up-adds-5-down-takes-5", (s1["label"] as? String) == "Remind me in 25 mins" && (s2["label"] as? String) == "Remind me in 20 mins"))
                  r.append(("same-width-every-time", s1["w"] as? Int == s0["w"] as? Int && s2["w"] as? Int == s0["w"] as? Int))
                  wheel("button.rem", false, 5) {
                    state { s3 in
                      r.append(("never-under-5", (s3["label"] as? String) == "Remind me in 5 mins"))
                      wheel("button.rem", true, 12) {
                        state { s4 in
                          r.append(("hours-past-60", (s4["label"] as? String) == "Remind me in 1h 5m"))
                          r.append(("list-never-scrolls-under-it", (s4["top"] as? Int ?? -1) == 0 && (s1["top"] as? Int ?? -1) == 0 && (s3["top"] as? Int ?? -1) == 0))
                          snap(t.web, "\(dir)/mail-remind.png") {
                            // On the card's text the wheel scrolls the list, the time stays.
                            wheel(".b", false, 1) {
                              state { s5 in
                                r.append(("wheel-on-text-scrolls-not-time", (s5["label"] as? String) == "Remind me in 1h 5m" && (s5["top"] as? Int ?? 0) > 0))
                                js("document.getElementById('list').scrollTop=0") { _ in
                                  later(0.5) {
                                    click {
                                      js(count) { n1 in
                                        r.append(("click-sends-remind-65-and-it-leaves", got().contains("m:test-r3:remind:65") && (n1 as? Int) == 2 && !got().contains("m:test-r3:dismiss")))
                                        resend(2)
                                        later(1.2) {
                                          js(count) { n2 in
                                            state { s7 in
                                              r.append(("comes-back-at-15", (n2 as? Int) == 3 && (s7["label"] as? String) == "Remind me in 15 mins"))
                                              typed()
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
    func typed() {
      type("7", "Escape") {
        js("JSON.stringify({n: document.querySelectorAll('.card.t-mail').length, box: document.querySelectorAll('input.rt').length})") { v in
          let s = String(describing: v ?? "")
          r.append(("escape-cancels", s.contains("\"n\":3") && s.contains("\"box\":0") && !got().contains { $0.hasPrefix("m:test-r3:remind:7") }))
          type("40", "Enter") {
            js(count) { n1 in
              r.append(("typed-time-40", got().contains("m:test-r3:remind:40") && (n1 as? Int) == 2))
              resend(2)
              later(1.2) {
                type("1h30", "Enter") {
                  js(count) { n2 in
                    r.append(("typed-1h30", got().contains("m:test-r3:remind:90") && (n2 as? Int) == 2))
                    resend(2)
                    later(1.2) { swipe() }
                  }
                }
              }
            }
          }
        }
      }
    }
    func swipe() {
      js(left) { l0 in
        let before = got().count, opened = t.testOpened.count
        drag("m:test-r1", 30) {
          js(left) { l1 in
            js(count) { n1 in
              let back = abs((l1 as? Int ?? -99) - (l0 as? Int ?? 0)) <= 2
              r.append(("short-drag-springs-back", back && (n1 as? Int) == 3 && got().count == before && t.testOpened.count == opened))
              drag("m:test-r1", 250) {
                js(count) { n2 in
                  r.append(("swipe-dismisses", got().contains("m:test-r1:dismiss") && (n2 as? Int) == 2))
                  resend(0)
                  later(1.2) { doneCard() }
                }
              }
            }
          }
        }
      }
    }
    // A finished Claude chat (FICTIONAL): newest, so at the top of the list.
    func doneCard() {
      js("window.__note.max(\(maxH)); document.getElementById('list').scrollTop=0") { _ in
        post(["type": "meetCard", "card": ["id": "c:test-chat", "tone": "done", "icon": "done", "title": "Fictional chat", "sub": "Claude finished",
                                            "at": ISO8601DateFormatter().string(from: Date()), "discreetText": "A Claude chat finished",
                                            "remind": ["start": 2, "step": 1, "min": 1, "max": 240]]])
        later(1.4) {
          state { s0 in
            r.append(("done-remind-says-2", (s0["label"] as? String) == "Remind me in 2 mins"))
            wheel("button.rem", true, 1) {
              state { s1 in
                r.append(("done-wheel-steps-1", (s1["label"] as? String) == "Remind me in 3 mins"))
                wheel("button.rem", false, 3) {
                  state { s2 in
                    r.append(("never-under-1", (s2["label"] as? String) == "Remind me in 1 min"))
                    snap(t.web, "\(dir)/mail-done.png") {
                      js("(function(){var c=document.querySelector('.card[data-id=\"c:test-chat\"]'); var b=c&&c.querySelector('button.dis'); b && b.click(); return !!b})()") { b in
                        later(0.9) {
                          js("document.querySelectorAll('.card[data-id=\"c:test-chat\"]').length") { n in
                            r.append(("done-dismiss", (b as? Bool) == true && (n as? Int) == 0 && got().contains("c:test-chat:dismiss")))
                            print("MAIL REMIND: real wheel events sent=\(sent) way=panel.sendEvent")
                            done(r)
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
