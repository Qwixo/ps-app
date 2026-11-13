import AppKit
import WebKit

// Self test for the notification colours and sounds per kind (V1.36, Toast.setLook; web src/core/notelook.ts).
// FICTIONAL cards only. Checks: a lead card takes the colour the developer picked (its border, the line under its title, its icon
// tile), a kind with no colour keeps today's look (the coral chats card), a value that is not a colour never reaches
// the page, Other alerts with the sound off play nothing, with a sound picked play exactly that one, and the same card
// shown again does not play it twice; plain cards take the Other alerts colour; back to unset puts every look back.
// Run alone with PS_SELFTEST_ONLY=notelook (main.swift), or in the full run after the lead card (Toast.leadTest).
// Pictures: notelook-lead.png, notelook-other.png.
extension Toast {
  func noteLookSelfTest(_ dir: String, _ done: @escaping () -> Void) {
    func js(_ s: String, _ f: @escaping (String) -> Void) { web.evaluateJavaScript(s) { v, _ in f(v as? String ?? "") } }
    func later(_ s: Double, _ f: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + s, execute: f) }
    let green: [String: Any] = ["c": "#22C55E", "top": "#115F2E", "bot": "#0F1D14", "icBg": "#15773A", "ic": "#C5F0D5", "sub": "#85DFA6",
                                "rem": "#167E3C", "remHi": "#188841", "line": "#85DFA6", "btn": "#22C55E", "ink": "#17121A"]
    let violet: [String: Any] = ["c": "#A78BFA", "top": "#281268", "bot": "#120F1D", "icBg": "#462F8B", "ic": "#C6B4FC", "sub": "#CFBFFC",
                                 "rem": "#4E3694", "remHi": "#6047A8", "line": "#CFBFFC", "btn": "#A78BFA", "ink": "#17121A"]
    var bad = green; bad["c"] = "red;}body{display:none"
    let iso = ISO8601DateFormatter()
    // A colour that is not a #RRGGBB drops that kind whole (done), the good one (lead) stays.
    setLook(["lead": green, "done": bad, "otherSound": NSNull()])
    showMeet(["id": "n:look-test", "tone": "lead", "icon": "reply", "title": "Lena replied in Instantly", "sub": "example.com · Quick question",
              "body": "Sounds interesting, can you send more details?", "url": "https://app.instantly.ai/app/unibox", "at": iso.string(from: Date()),
              "discreetText": "New lead reply", "remind": ["start": 15, "step": 5, "min": 5, "max": 240]])
    showMeet(["id": "c:look-test", "tone": "done", "icon": "done", "title": "Fictional chat", "sub": "Claude finished", "at": iso.string(from: Date()),
              "discreetText": "A Claude chat finished", "remind": ["start": 2, "step": 1, "min": 1, "max": 240]])
    let colours = """
      (function(){function cs(sel){var e=document.querySelector(sel);return e?getComputedStyle(e):null}
      var l=cs('.card.t-lead'),ls=cs('.card.t-lead .sub'),li=cs('.card.t-lead .ic'),d=cs('.card.t-done'),st=(document.getElementById('look')||{}).textContent||'';
      return JSON.stringify({lead:l&&l.borderTopColor,leadSub:ls&&ls.color,leadIc:li&&li.backgroundColor,done:d&&d.borderTopColor,bad:/red|display/.test(st)})})()
      """
    Sfx.shared.clearPlayLog()
    later(1.4) {
      SelfTest.snap(self.web, "\(dir)/notelook-lead.png") {
        js(colours) { s in
          let lead = s.contains("\"lead\":\"rgba(34, 197, 94, 0.6)\"") && s.contains("\"leadSub\":\"rgb(133, 223, 166)\"") && s.contains("\"leadIc\":\"rgb(21, 119, 58)\"")
          let doneKept = s.contains("\"done\":\"rgba(217, 119, 87, 0.6)\"")
          let badDropped = s.contains("\"bad\":false")
          // Other alerts, sound off (unset): a network card and a plain card make no sound.
          self.showMeet(["id": "net-look-test", "tone": "ok", "icon": "globe", "title": "Back online", "sub": "Wi-Fi"])
          self.show(title: "Calendar refreshed: 4 events")
          later(0.4) {
            let silent = Sfx.shared.playLog.isEmpty
            // A sound and a colour for Other alerts: one sound per new card, none for the same card again.
            self.setLook(["lead": green, "other": violet, "otherSound": "note-harp"])
            self.showMeet(["id": "net-look-test2", "tone": "info", "icon": "swap", "title": "Connection changed", "sub": "Now on Wi-Fi"])
            self.showMeet(["id": "net-look-test2", "tone": "info", "icon": "swap", "title": "Connection changed", "sub": "Now on Wi-Fi again"])
            later(1.2) {
              let once = Sfx.shared.playLog == ["note-harp"]
              SelfTest.snap(self.web, "\(dir)/notelook-other.png") {
                js("(function(){var p=[].filter.call(document.querySelectorAll('.card:not(.meet)'),function(c){return /Calendar refreshed/.test(c.textContent)})[0],i=document.querySelector('.card.t-info');return JSON.stringify({plain:p?getComputedStyle(p.querySelector('.dot')).backgroundColor:null,info:i?getComputedStyle(i).borderTopColor:null})})()") { o in
                  let other = o.contains("\"plain\":\"rgb(167, 139, 250)\"") && o.contains("\"info\":\"rgba(167, 139, 250, 0.6)\"")
                  // Back to unset: every kind looks as before, and no sound.
                  self.setLook([:])
                  self.showMeet(["id": "net-look-test3", "tone": "ok", "icon": "globe", "title": "Back online", "sub": "Ethernet"])
                  later(0.5) {
                    js(colours) { r in
                      let reset = r.contains("\"lead\":\"rgba(96, 165, 250, 0.6)\"") && Sfx.shared.playLog == ["note-harp"]
                      print("NOTELOOK CHECK: lead-takes-colour=\(lead ? "ok" : "FAIL") unset-kind-keeps-look=\(doneKept ? "ok" : "FAIL") bad-colour-dropped=\(badDropped ? "ok" : "FAIL") sound-off-silent=\(silent ? "ok" : "FAIL") sound-on-plays-once=\(once ? "ok" : "FAIL") other-takes-colour=\(other ? "ok" : "FAIL") back-to-unset=\(reset ? "ok" : "FAIL") colours=\(s) other=\(o) after=\(r) played=\(Sfx.shared.playLog) key=\(self.panel.isKeyWindow)")
                      self.web.evaluateJavaScript("document.getElementById('clear').click()", completionHandler: nil)
                      later(1.2) { done() }
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
