import AppKit

// Self test for the Annoying 15 min reminders' cards (Sources/Reminders.swift), area "fu". Everything it looks at is
// faked: the clock (Dubai times), whether you are at the Mac, a meeting, 1Password or Signal in front. It keeps its
// own throwaway settings, is handed a plan like the page's, and never takes the keyboard. Pictures: fu-card.png (reminder
// one, as the old daily card), fu-box.png (the confirm box after a wrong answer), fu-two.png (two cards stacked).
extension SelfTest {
  static func fuCheck(_ a: App, _ dir: String, _ done: @escaping () -> Void) {
    let f = Reminders.shared
    var now = Date()
    var here = true
    var shield = false
    let keep = (f.clock, f.hereNow, f.shieldNow)
    f.clock = { now }; f.hereNow = { here }; f.shieldNow = { shield }
    let iso = ISO8601DateFormatter()
    func at(_ s: String) -> Date { iso.date(from: s + ":00+04:00")! }     // a Dubai wall clock time
    func ms(_ s: String) -> Double { at(s).timeIntervalSince1970 * 1000 }
    func tick(_ s: String) { now = at(s); f.check() }
    var r: [(String, Bool)] = []
    func later(_ s: Double, _ next: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + s, execute: next) }
    func js(_ id: String, _ code: String, _ next: @escaping () -> Void) { f.web(id)?.evaluateJavaScript(code) { _, _ in later(0.35, next) } }
    let up = { (id: String) in f.up.contains(id) }

    // Reminder one as the page hands it over for the developer: his words, 02:00 to 06:00 Dubai, done for Saturday 24 Oct.
    var one: [String: Any] = ["id": "fu", "on": true, "pill": "Daily reminder", "text": "HAVE YOU RAN FOLLOW UP SYSTEM YET?", "at": "02:00", "until": "06:00",
      "days": [0, 1, 2, 3, 4, 5, 6], "tz": "Asia/Dubai", "snooze": 15, "later": "Remind me in 15 mins", "yes": "Yes", "word": "Yes", "click": false,
      "bg": "#28121e", "accent": "#ec4e86", "ink": "#ffffff", "sound": "none", "vol": 0.8, "done": "2026-10-24", "snoozeUntil": 0, "stateAt": 1]
    func plan(_ items: [[String: Any]]) { f.setPlan(["v": 1, "items": items]) }
    plan([one])

    tick("2026-10-25T01:59")
    r.append(("nothing-at-0159", !up("fu")))
    tick("2026-10-25T02:00")
    later(1.2) {
      r.append(("card-at-0200", up("fu") && f.cardVisible("fu")))
      SelfTest.snap(f.web("fu")!, "\(dir)/fu-card.png") {
        f.web("fu")?.evaluateJavaScript("[document.getElementById('q').textContent, document.getElementById('later').textContent, document.getElementById('yes').textContent]") { v, _ in
          let a = v as? [String]
          r.append(("exact-words", a == ["HAVE YOU RAN FOLLOW UP SYSTEM YET?", "Remind me in 15 mins", "Yes"]))
          // New words from Settings: on the card at once, as plain text.
          one["text"] = "Have you taken the <b>bins</b> out?"; one["yes"] = "Done it"; one["word"] = "done it"
          plan([one])
          later(0.5) {
          f.web("fu")?.evaluateJavaScript("[document.getElementById('q').textContent, document.getElementById('q').children.length, document.getElementById('yes').textContent]") { v, _ in
            let b = v as? [Any]
            r.append(("edited-words-on-card", (b?[0] as? String) == "Have you taken the <b>bins</b> out?" && (b?[1] as? Int) == 0 && (b?[2] as? String) == "Done it"))
          // Remind me in: gone, back after its snooze.
          js("fu", "document.getElementById('later').click()") {
            r.append(("snooze-hides", !up("fu")))
            tick("2026-10-25T02:14")
            r.append(("snoozed-at-0214", !up("fu")))
            tick("2026-10-25T02:15")
            r.append(("back-at-0215", up("fu")))
            later(0.8) {
            // The confirm button alone: only the box opens.
            js("fu", "document.getElementById('yes').click()") {
              r.append(("yes-alone-keeps-card", up("fu") && f.boxOpen("fu")))
              r.append(("test-copy-never-takes-keyboard", !f.keyRequested("fu")))
              js("fu", "document.getElementById('t').value='no';document.getElementById('done').click()") {
                r.append(("wrong-word-keeps-card", up("fu")))
                SelfTest.snap(f.web("fu")!, "\(dir)/fu-box.png") {
                  here = false; tick("2026-10-25T05:00")
                  r.append(("never-auto-hides", up("fu")))
                  here = true
                  js("fu", "var t=document.getElementById('t');t.value='  DONE IT ';t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))") {
                    r.append(("own-word-closes", !up("fu")))
                    r.append(("answer-kept-for-page", f.local["fu"]?.done == "2026-10-25"))
                    tick("2026-10-25T23:00"); let q1 = !up("fu")
                    tick("2026-10-26T01:59"); let q2 = !up("fu")
                    r.append(("quiet-until-next-window", q1 && q2))
                    tick("2026-10-26T02:00")
                    r.append(("next-day-asks", up("fu")))
                    // Confirmed on the phone: the next plan closes the card here.
                    one["done"] = "2026-10-26"; one["stateAt"] = ms("2026-10-26T02:01"); now = at("2026-10-26T02:01"); plan([one])
                    r.append(("phone-answer-closes", !up("fu")))
                    // Away at 02:00: comes when back. A meeting delays it and moves it aside.
                    here = false; tick("2026-10-27T02:00"); let away = !up("fu")
                    here = true; tick("2026-10-27T02:40")
                    r.append(("away-then-on-return", away && up("fu")))
                    f.setMeetingForTest(true); f.check(); let aside = !up("fu")
                    f.setMeetingForTest(false); f.check()
                    r.append(("meeting-moves-aside", aside && up("fu")))
                    shield = true; f.check(); let hidden = up("fu") && !f.cardVisible("fu")
                    shield = false; f.check()
                    r.append(("never-over-1password-or-signal", hidden && f.cardVisible("fu")))
                    // A second reminder, one click, its own colours: both stack.
                    let two: [String: Any] = ["id": "w2", "on": true, "pill": "Water", "text": "DRINK WATER?", "at": "02:30", "until": "03:30", "days": [0, 1, 2, 3, 4, 5, 6],
                      "tz": "Asia/Dubai", "snooze": 5, "later": "Remind me in 5 mins", "yes": "Drank it", "word": "Drank it", "click": true, "bg": "#0f1b2d", "accent": "#3b82f6",
                      "ink": "#ffffff", "sound": "none", "vol": 0.8, "done": "", "snoozeUntil": 0, "stateAt": 0]
                    plan([one, two]); tick("2026-10-27T02:41")
                    later(1.0) {
                      r.append(("two-at-once", up("fu") && up("w2") && f.cardVisible("w2")))
                      SelfTest.snap(f.web("w2")!, "\(dir)/fu-two.png") {
                        js("w2", "document.getElementById('yes').click()") {
                          r.append(("one-click-clears", !up("w2") && up("fu")))
                          // A restart keeps the answers.
                          f.reloadForTest(); tick("2026-10-27T02:45")
                          r.append(("survives-restart", !up("w2") && up("fu")))
                          // Up at 05:58: it stays past 06:00 until answered; a snooze past 06:00 does not come back.
                          one["done"] = "2026-10-27"; one["stateAt"] = ms("2026-10-27T03:00"); plan([one]); f.check()
                          tick("2026-10-28T05:58"); let upAt = up("fu")
                          tick("2026-10-28T06:30")
                          r.append(("up-at-0600-stays", upAt && up("fu")))
                          later(0.8) {
                          js("fu", "document.getElementById('later').click()") {
                            tick("2026-10-28T06:45"); let a1 = !up("fu")
                            tick("2026-10-28T12:00"); let a2 = !up("fu")
                            r.append(("snooze-past-window-no-return", a1 && a2))
                            // Off: nothing.
                            one["on"] = false; plan([one]); tick("2026-10-29T03:00")
                            r.append(("off-means-off", !up("fu")))
                            plan([])
                            f.clock = keep.0; f.hereNow = keep.1; f.shieldNow = keep.2
                            let bad = r.filter { !$0.1 }
                            print("FOLLOW UP CHECK: \(r.count - bad.count) of \(r.count) ok", r.map { "\($0.0)=\($0.1 ? "ok" : "FAIL")" }.joined(separator: " "))
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
