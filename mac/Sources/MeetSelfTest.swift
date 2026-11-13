import AppKit

// Self test for the meeting alert cards (src/core/meetalerts.ts -> Toast.showMeet). FICTIONAL
// people only. The cards go through the real bridge: the main page posts {type:"meetCard"} just as
// src/meetwatch.ts does, main.swift hands them to the pop-up panel. Pictures of each look:
// meet-booked.png, meet-cancel.png (above a plain message card in the list), meet-soon.png,
// meet-discreet.png (a meeting is on), meet-revealed.png (clicked open). The panel must never take
// the keyboard or bring PS forward.
extension SelfTest {
  static func meetCards(_ a: App, _ dir: String, _ done: @escaping () -> Void) {
    let t = Toast.shared
    func post(_ obj: [String: Any]) {
      guard let d = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: d, encoding: .utf8) else { return }
      a.main.callAsyncJavaScript("window.webkit.messageHandlers.ps.postMessage(m)", arguments: ["m": s], in: nil, in: .page, completionHandler: nil)
    }
    let soon = ISO8601DateFormatter().string(from: Date().addingTimeInterval(40 * 60))
    let ten = ISO8601DateFormatter().string(from: Date().addingTimeInterval(10 * 60))
    let later = ISO8601DateFormatter().string(from: Date().addingTimeInterval(3 * 86400))
    let booked: [String: Any] = ["id": "mb:test1", "tone": "booked", "title": "Jane Doe just booked a call", "sub": "Wed 21 Oct 4:00 PM Lisbon · 8:00 AM ET for them",
      "body": "Shopify Redesign · Northwind Silk", "callAt": later, "join": "https://meet.google.com/abc-defg-hij", "discreet": false, "discreetText": "A lead booked a call", "sound": "booked"]
    let msg: [String: Any] = ["id": "mm:test2", "tone": "msg", "title": "Sam Lee messaged about the 3:30 PM call", "sub": "Gmail · Example Co",
      "body": "Looking forward to it! I added our head of marketing to the invite.", "callAt": soon, "url": "https://mail.google.com/mail/?authuser=test#all/abc",
      "join": "https://meet.google.com/abc-defg-hij", "discreet": false, "discreetText": "Message from a lead about this call", "sound": "alert"]
    let cancel: [String: Any] = ["id": "mm:test3", "tone": "cancel", "title": "Jane Doe may not make today's 4:00 PM call", "sub": "Instantly · Northwind Silk",
      "body": "Hi Sam, so sorry, I can't make the call today. Something came up. Can we reschedule?", "callAt": soon, "url": "https://app.instantly.ai/app/unibox",
      "join": "https://meet.google.com/abc-defg-hij", "discreet": false, "discreetText": "Message from a lead about this call", "sound": "alert"]
    let soonCard: [String: Any] = ["id": "ms:test4", "tone": "soon-warn", "title": "Call with Jane Doe in 10 min", "sub": "Today 4:00 PM Lisbon · 8:00 AM ET for them",
      "body": "They never accepted the invite · Shopify Redesign", "callAt": ten, "join": "https://meet.google.com/abc-defg-hij", "discreet": false, "discreetText": "A call starts soon", "sound": "soon"]
    var discreet = cancel; discreet["id"] = "mm:test5"; discreet["discreet"] = true
    func step(_ wait: Double, _ shot: String, _ then: @escaping () -> Void) {
      DispatchQueue.main.asyncAfter(deadline: .now() + wait) { snap(t.web, "\(dir)/\(shot).png") { then() } }
    }
    func clear(_ then: @escaping () -> Void) {
      // Clear all shows for 2 or more cards; a single card is taken away by its id.
      t.web.evaluateJavaScript("(function(){var cs=document.querySelectorAll('.card'), b=document.getElementById('clear'); if(cs.length>1&&b) b.click(); else [].forEach.call(cs,function(c){ if(c.dataset.id) window.__note.drop(c.dataset.id) })})()", completionHandler: nil)
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { then() }
    }
    let count = "JSON.stringify({cards: document.querySelectorAll('.card.meet').length, discreet: document.querySelectorAll('.card.meet.discreet').length, text: (document.querySelector('.card.meet') || {}).innerText || ''})"
    // The gear's Meeting alerts settings (click only), in the Tab list's full screen Settings (V1.32, General).
    a.overlay.evaluateJavaScript("(function(){var g=document.querySelector('.tm-tr [aria-label=Settings]'); if(g) g.click(); setTimeout(function(){var m=document.querySelector('.mp'); if(m) m.scrollIntoView({block:'center'});}, 300); return !!g;})()") { v, _ in
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) {
        snap(a.overlay, "\(dir)/meet-settings.png") {
          a.overlay.evaluateJavaScript("JSON.stringify({rows: document.querySelectorAll('.mp .mp-row').length, on: document.querySelectorAll('.mp .mp-row.on').length, sounds: document.querySelectorAll('.mp .mp-snd').length})") { r, _ in
            print("MEET SETTINGS:", r ?? "nothing", "panel=\(v ?? "?")")
            // V1.32: the gear opens the full screen Settings; Esc's way out closes it (the old menu closed on any click).
            a.overlay.evaluateJavaScript("window.__psDimxClose ? window.__psDimxClose() : document.body.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}))", completionHandler: nil)
            cards()
          }
        }
      }
    }
    func cards() {
    post(["type": "meetCard", "card": booked])
    step(1.4, "meet-booked") {
      clear {
        post(["type": "meetCard", "card": msg]); post(["type": "meetCard", "card": cancel])
        step(1.4, "meet-cancel") {
          clear {
            post(["type": "meetCard", "card": soonCard])
            step(1.4, "meet-soon") {
              clear {
                post(["type": "meetCard", "card": discreet])
                step(1.4, "meet-discreet") {
                  t.web.evaluateJavaScript(count) { v1, _ in
                    let hidden = String(describing: v1 ?? "")
                    let leaks = hidden.contains("Jane") || hidden.contains("reschedule") || hidden.contains("Northwind")
                    t.web.evaluateJavaScript("document.querySelector('.card.meet').click()") { _, _ in
                      step(0.9, "meet-revealed") {
                        t.web.evaluateJavaScript(count) { v2, _ in
                          let shown = String(describing: v2 ?? "").contains("Jane")
                          // Private mode comes on while a full card shows: it goes discreet; holding Tab shows it again.
                          clear {
                            post(["type": "meetCard", "card": msg])
                            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                              post(["type": "meetPrivacy", "on": true])
                              DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                                t.web.evaluateJavaScript("document.querySelectorAll('.card.meet.discreet').length") { p, _ in
                                  t.reveal(true)
                                  DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                                    t.web.evaluateJavaScript("document.querySelectorAll('.card.meet.discreet').length") { r, _ in
                                      t.reveal(false); post(["type": "meetPrivacy", "on": false])
                                      print("MEET CHECK:", "discreet-hides-names=\(!leaks && hidden.contains("Message from a lead") ? "ok" : "FAIL")",
                                            "click-reveals=\(shown ? "ok" : "FAIL")", "private-mode-hides=\((p as? Int) == 1 ? "ok" : "FAIL")",
                                            "tab-hold-shows=\((r as? Int) == 0 ? "ok" : "FAIL")", "key=\(t.panel.isKeyWindow)", "activePS=\(NSApp.isActive)")
                                      clear { mailCards(a, dir, done) }
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
