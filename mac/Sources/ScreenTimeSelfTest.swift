import AppKit
import WebKit

// Self test for screen time on someone else's PS (public PS, 7 Nov 2026: a friend's screen time stayed empty,
// "under 1m" and 0m, because it was off until someone turned it on, and nothing said so). PS_SELFTEST_ONLY=screentime.
// Run it twice: PS_SELFTEST_RED=0 (a stranger's PS) and PS_SELFTEST_RED=1 (the developer's, unchanged).
// Checks: never chosen, it is on for a stranger and off for the developer; a made up app ("Notes", com.example.Notes) counted
// for 50 s reaches the page for a stranger and nothing does for the developer until he chooses it; 1Password and Signal are never
// counted; switched off, the top bar button says Off and the pop-up says screen time is off with a Turn on button;
// that button turns it on (the choice is kept) and the note goes. A test copy keeps its own throwaway settings and
// files (ScreenTime.store, <out>/run/screentime): the developer's real screen time is never read or written.
// Pictures: screentime-off.png (the pop-up while off), screentime-on.png (after Turn on).
extension SelfTest {
  static func screenTimeCheck(_ a: App, _ dir: String, _ done: @escaping () -> Void) {
    func later(_ t: Double, _ f: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + t, execute: f) }
    func js(_ s: String, _ f: @escaping (Any?) -> Void) { a.overlay.evaluateJavaScript(s) { v, _ in f(v) } }
    func obj(_ v: Any?) -> [String: Any] { (v as? String).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] } ?? [:] }
    let st = ScreenTime.shared
    let red = Owner.red
    var r: [String] = []
    var ok = true
    func check(_ name: String, _ pass: Bool, _ extra: String = "") { if !pass { ok = false }; r.append("\(name)=\(pass ? "ok" : "FAIL")\(extra.isEmpty ? "" : "(\(extra))")") }

    // 1. The default, never chosen.
    st.choose(nil)
    check("default-\(red ? "red-off" : "stranger-on")", st.choice == nil && st.enabled == !red, "red=\(red) on=\(st.enabled)")
    // 2. Counting with nobody touching the switch (the friend's case), and the golden rule.
    st.selfTestCount(id: "com.example.Notes", name: "Notes", secs: 50)
    st.selfTestCount(id: "com.1password.1password", name: "1Password", secs: 50)
    st.selfTestCount(id: "org.whispersystems.signal-desktop", name: "Signal", secs: 50)
    let sent = st.selfTestSent().joined(separator: "\n")
    if red { check("red-not-counted-until-chosen", !sent.contains("com.example.Notes"), "sent=\(sent.count) chars") }
    else { check("stranger-counted", sent.contains("\"com.example.Notes\"") && sent.contains("\"type\":\"screentime\""), "sent=\(sent.prefix(160))") }
    check("never-1password-or-signal", !sent.lowercased().contains("1password") && !sent.lowercased().contains("signal") && !sent.contains("whispersystems"))

    // 3. Switched off: the Tab list says so and its Turn on button works.
    st.choose(false); a.sendSettings()
    let state = """
      JSON.stringify((function(){
        var q=function(s){return document.querySelector(s)};
        var off=q('.tm-st-pop .st-off');
        return {btn: !!q('.tm-st-btn'), chip: ((q('.tm-st-btn .tm-st-v')||{}).textContent||''), pop: !!q('.tm-st-pop'), off: !!off,
          turnOn: !!q('.tm-st-pop .st-off-on'), text: off ? off.textContent : '', note: [...document.querySelectorAll('.tm-st-pop .tm-pop-note')].map(function(e){return e.textContent}).join(' | ')};
      })())
      """
    later(1.0) {
      js("(function(){var b=document.querySelector('.tm-st-btn'); if(b && !document.querySelector('.tm-st-pop')) b.click(); return !!b})()") { _ in
        later(1.0) {
          js(state) { v in
            let o = obj(v)
            check("button-says-off", o["chip"] as? String == "Off", "chip=\(o["chip"] ?? "")")
            check("popup-says-off", o["pop"] as? Bool == true && o["off"] as? Bool == true && o["turnOn"] as? Bool == true
                  && (o["text"] as? String ?? "").contains("Screen time is off on this Mac"), "pop=\(o["pop"] ?? "") off=\(o["off"] ?? "") text=\(o["text"] ?? "")")
            snap(a.overlay, "\(dir)/screentime-off.png") {
              js("(function(){var b=document.querySelector('.tm-st-pop .st-off-on'); if(b) b.click(); return !!b})()") { _ in
                later(1.2) {
                  check("turn-on-saves-the-choice", st.choice == true && st.enabled, "choice=\(String(describing: st.choice)) on=\(st.enabled)")
                  js(state) { v in
                    let o = obj(v)
                    check("off-note-gone", o["off"] as? Bool == false && o["chip"] as? String != "Off", "off=\(o["off"] ?? "") chip=\(o["chip"] ?? "")")
                    check("on-note", !(o["note"] as? String ?? "").contains("Nothing counted on the Mac"), "note=\(o["note"] ?? "")")
                    snap(a.overlay, "\(dir)/screentime-on.png") {
                      // Back as it was: never chosen, pop-up closed.
                      st.choose(nil); a.sendSettings()
                      js("(function(){var b=document.querySelector('.tm-st-btn'); if(b && document.querySelector('.tm-st-pop')) b.click(); return true})()") { _ in
                        print("SCREENTIME CHECK: \(ok ? "ok" : "FAIL") red=\(red) " + r.joined(separator: " "))
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
