import AppKit

// Self test for "Are you sure" mode (Sources/AreYouSure.swift). Everything it looks at is faked:
// the app in front, the window title, the microphone and the clock. It never reads the developer's real
// windows. Pictures: ays-card.png (the countdown), ays-continue.png (Continue after 10 seconds).
extension SelfTest {
  static func aysCheck(_ a: App, _ dir: String, _ done: @escaping () -> Void) {
    let y = AreYouSure.shared
    let brave = ("com.brave.Browser" as String?, pid_t(4242))
    var front: (String?, pid_t) = ("com.apple.finder", 4241)
    var title: String? = nil
    var reads = 0
    var mic = false
    var now = Date()
    y.frontNow = { (front.0, front.1) }
    y.titleNow = { _ in reads += 1; return title }
    y.micNow = { mic }
    y.clock = { now }
    var p = AreYouSure.Prefs()
    p.on = true; p.sites = ["YouTube", "Netflix"]; p.countdown = 10; p.pass = 30; p.phrase = "I am sure, I swear on PS"
    y.setPrefsForTest(p)
    y.resetForTest()

    var r: [(String, Bool)] = []
    func later(_ s: Double, _ f: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + s, execute: f) }
    func page(_ next: @escaping (String) -> Void) {
      y.webForTest?.evaluateJavaScript("JSON.stringify({ready: document.body.classList.contains('ready'), num: document.getElementById('num').textContent, site: document.getElementById('site').textContent})") { v, _ in next((v as? String) ?? "none") }
    }
    let yt = "Rain sounds for focus - YouTube - Brave"

    // 1. A title that only mentions the site does nothing (a Google search for "youtube").
    front = brave; title = "youtube - Google Search - Brave"
    y.checkForTest()
    r.append(("non-matching-title-nothing", !y.cardUp))
    // 2. A YouTube video: the card, with a 10 second countdown.
    title = yt
    y.checkForTest()
    later(1.6) {
      r.append(("youtube-raises-card", y.cardUp && y.cardVisible && y.countsForTest.prompts == 1))
      page { s0 in
        r.append(("countdown-shows-10", s0.contains("\"num\":\"10\"") && s0.contains("\"site\":\"YouTube\"") && s0.contains("\"ready\":false")))
        snap(y.webForTest!, "\(dir)/ays-card.png") {
          // 3. Leaving within the 10 seconds cancels it quietly (no pass).
          now += 3; front = ("com.apple.finder", 4241)
          y.checkForTest()
          later(0.5) {
            r.append(("leaving-cancels", !y.cardUp && !y.cardVisible && y.countsForTest.passes == 0 && y.passUntilForTest == nil))
            // 4. Back to it: the card again. Continue cannot be used early, and appears at 10 seconds.
            front = brave
            y.checkForTest()
            now += 9.5
            y.tickForTest()
            y.messageForTest("continue")
            let early = y.cardUp
            now += 0.6
            y.tickForTest()
            later(0.5) {
              page { s1 in
                r.append(("continue-only-after-10s", early && s1.contains("\"ready\":true") && s1.contains("\"num\":\"0\"")))
                snap(y.webForTest!, "\(dir)/ays-continue.png") {
                  y.webForTest?.evaluateJavaScript("document.getElementById('go').click()") { _, _ in
                    later(0.4) {
                      let pass = y.passUntilForTest
                      r.append(("continue-lets-in-30-min-pass", !y.cardUp && y.countsForTest.passes == 1 && pass != nil && abs(pass!.timeIntervalSince(now) - 1800) < 2))
                      // 5. The pass holds (still on YouTube), then runs out and it asks again.
                      y.checkForTest()
                      let held0 = !y.cardUp
                      now += 29 * 60
                      y.checkForTest()
                      let held29 = !y.cardUp
                      now += 2 * 60
                      y.checkForTest()
                      r.append(("pass-holds-then-expires", held0 && held29 && y.cardUp))
                      // 6. The phrase: a wrong one does nothing, the right one (any case, punctuation at the end) at once.
                      later(0.5) {
                        y.messageForTest("sworn:I am sure")
                        let stillUp = y.cardUp
                        y.webForTest?.evaluateJavaScript("(function(){const i=document.getElementById('phrase'); i.value='i am SURE,  i swear on ps!!'; i.dispatchEvent(new Event('input')); return 1})()") { _, _ in
                          later(0.4) {
                            r.append(("phrase-dismisses-at-once", stillUp && !y.cardUp && y.countsForTest.passes == 2))
                            // 7. A meeting in progress: no card; a meeting starting closes an open one. A call (the microphone in use) the same.
                            y.resetForTest()
                            y.setMeetingForTest(true)
                            y.checkForTest()
                            let noCardInMeeting = !y.cardUp
                            y.setMeetingForTest(false)
                            let upAfter = y.cardUp
                            y.setMeetingForTest(true)
                            r.append(("meeting-no-card-and-closes", noCardInMeeting && upAfter && !y.cardUp))
                            y.setMeetingForTest(false)
                            mic = true
                            y.checkForTest()
                            let noCardInCall = !y.cardUp
                            mic = false
                            y.checkForTest()
                            let upNoCall = y.cardUp
                            mic = true
                            y.tickForTest()
                            r.append(("call-no-card-and-closes", noCardInCall && upNoCall && !y.cardUp))
                            mic = false
                            // 8. Signal in front: nothing is read, and an open card goes.
                            y.resetForTest()
                            front = ("org.whispersystems.signal-desktop", 4243)
                            let n0 = reads
                            y.checkForTest()
                            let noRead = reads == n0 && !y.cardUp
                            front = brave
                            y.checkForTest()
                            let up = y.cardUp
                            front = ("org.whispersystems.signal-desktop", 4243)
                            let n1 = reads
                            y.tickForTest()
                            r.append(("signal-never-read", noRead && up && reads == n1 && !y.cardUp))
                            // 9. Netflix counts too; a Meet tab in front is a call.
                            y.resetForTest()
                            front = brave; title = "Netflix"
                            y.checkForTest()
                            let netflix = y.cardUp
                            title = "Meet - abc defg hij - Brave"
                            y.tickForTest()
                            r.append(("netflix-and-meet-tab", netflix && !y.cardUp))
                            // Done: the mode off again, nothing left up.
                            y.resetForTest()
                            var off = p; off.on = false
                            y.setPrefsForTest(off)
                            front = ("com.apple.finder", 4241); title = nil
                            later(0.6) {
                              r.append(("nothing-left-up", !y.cardVisible))
                              let ok = r.allSatisfy { $0.1 }
                              print("ARE YOU SURE CHECK:", ok ? "ok" : "FAIL", r.map { "\($0.0)=\($0.1 ? "ok" : "FAIL")" }.joined(separator: " "))
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
