import AppKit
import WebKit

// Self test for PS Fitness (web src/fitness, src/core/fitness.ts). FICTIONAL data only: a 4 day
// program and two weeks of workouts from web tests/fixtures/fitness-selftest.json (made fresh by
// scripts/fitness-fixture.ts at the start). Each picture is its own hidden web view (alpha 0, parked off
// screen, never clickable) on ps://app/client/fitview, the test only page that draws Fitness over data the
// test hands in (no vault, no keys, nothing saved). Every look (volt, chalk, pulse) at a phone size
// (412 x 892) and a Mac size (1180 x 800): the start screen, a workout in progress with the rest timer
// running, Program, History and Settings. Checks per picture: the right look is on, nothing wider than
// the page, no em or en dash in what is shown, the phone's Start button is thumb sized (60 px or more),
// the rest countdown shows and its set rows are there. PS_SELFTEST_ONLY=fitness.
extension SelfTest {
  static func fitnessCheck(_ a: App, _ dir: String, _ done: @escaping () -> Void) {
    func later(_ t: Double, _ f: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + t, execute: f) }
    let repo = ProcessInfo.processInfo.environment["PS_FITNESS_REPO"] ?? (NSHomeDirectory() + "/Projects/web")
    // Fresh fictional dates (the open workout must be from the last few hours). Local only, no network.
    let gen = Process()
    gen.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    gen.arguments = ["node", "--experimental-strip-types", "scripts/fitness-fixture.ts"]
    gen.currentDirectoryURL = URL(fileURLWithPath: repo)
    gen.standardOutput = FileHandle.nullDevice; gen.standardError = FileHandle.nullDevice
    try? gen.run(); gen.waitUntilExit()
    guard let raw = try? Data(contentsOf: URL(fileURLWithPath: repo + "/tests/fixtures/fitness-selftest.json")),
          let fx = try? JSONSerialization.jsonObject(with: raw) as? [String: Any],
          let start = fx["start"], let live = fx["live"], let rest = fx["rest"] as? [String: Any] else {
      print("FITNESS CHECK: fixture=FAIL (no tests/fixtures/fitness-selftest.json)"); done(); return
    }
    func json(_ o: Any) -> String { String(data: (try? JSONSerialization.data(withJSONObject: o)) ?? Data("{}".utf8), encoding: .utf8) ?? "{}" }
    struct Shot { let name: String; let style: String; let tab: String; let live: Bool; let size: NSSize }
    let phone = NSSize(width: 412, height: 892), mac = NSSize(width: 1180, height: 800)
    var shots: [Shot] = []
    for st in ["volt", "chalk", "pulse"] {
      shots.append(Shot(name: "phone-\(st)-start", style: st, tab: "gym", live: false, size: phone))
      shots.append(Shot(name: "phone-\(st)-live", style: st, tab: "gym", live: true, size: phone))
      shots.append(Shot(name: "phone-\(st)-program", style: st, tab: "plan", live: false, size: phone))
      shots.append(Shot(name: "phone-\(st)-history", style: st, tab: "history", live: false, size: phone))
      shots.append(Shot(name: "mac-\(st)-start", style: st, tab: "gym", live: false, size: mac))
      shots.append(Shot(name: "mac-\(st)-live", style: st, tab: "gym", live: true, size: mac))
      shots.append(Shot(name: "mac-\(st)-program", style: st, tab: "plan", live: false, size: mac))
      shots.append(Shot(name: "mac-\(st)-history", style: st, tab: "history", live: false, size: mac))
    }
    shots.append(Shot(name: "phone-volt-settings", style: "volt", tab: "settings", live: false, size: phone))
    shots.append(Shot(name: "mac-chalk-settings", style: "chalk", tab: "settings", live: false, size: mac))
    var r: [(String, Bool)] = []
    var keep: [NSWindow] = []
    let probe = """
    JSON.stringify((function(){
      var f=document.querySelector('.fit'), t=document.body.innerText||'';
      var big=[].some.call(document.querySelectorAll('.fit button'), function(b){var x=b.getBoundingClientRect(); return x.height>=60 && x.width>=120 && b.offsetParent});
      return {fit: !!f, style: f ? f.getAttribute('data-fit-style') : '', wide: document.documentElement.scrollWidth - innerWidth,
        dash: /[\\u2013\\u2014]/.test(t), big: big, clock: /\\b\\d:\\d\\d\\b/.test(t), rows: document.querySelectorAll('.fit [class*="fg-set"]').length, text: t.length,
        words: (function(){var n=0, w=document.createTreeWalker(document.querySelector('.fit')||document.body, NodeFilter.SHOW_TEXT); while(w.nextNode()){var p=w.currentNode.parentElement, r=p.getBoundingClientRect(), o=1; for(var e=p;e&&e!==document.body;e=e.parentElement){o*=+getComputedStyle(e).opacity} if(o>0.5 && r.width>0 && r.top<innerHeight && r.bottom>0) n+=w.currentNode.textContent.trim().length} return n})()}
    })())
    """
    func run(_ i: Int) {
      guard i < shots.count else {
        keep.forEach { $0.close() }
        print("FITNESS CHECK:", r.map { "\($0.0)=\($0.1 ? "ok" : "FAIL")" }.joined(separator: " "))
        later(0.3, done); return
      }
      let s = shots[i]
      let c = a.config()
      if s.live {
        let left = (rest["left"] as? Double) ?? 75, total = (rest["total"] as? Double) ?? 120
        var o = rest; o.removeValue(forKey: "left")
        o["endsAt"] = Date().timeIntervalSince1970 * 1000 + left * 1000; o["total"] = total; o["over"] = false; o["overAt"] = 0
        c.userContentController.addUserScript(WKUserScript(source: "try{localStorage.setItem('fit.rest', '\(json(o).replacingOccurrences(of: "'", with: "\\'"))')}catch(e){}", injectionTime: .atDocumentStart, forMainFrameOnly: true))
      } else {
        c.userContentController.addUserScript(WKUserScript(source: "try{localStorage.removeItem('fit.rest')}catch(e){}", injectionTime: .atDocumentStart, forMainFrameOnly: true))
      }
      let w = WKWebView(frame: NSRect(origin: .zero, size: s.size), configuration: c)
      let win = FitTestPanel(contentRect: NSRect(origin: NSPoint(x: -30000, y: -30000), size: s.size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
      win.alphaValue = 0; win.ignoresMouseEvents = true; win.isReleasedWhenClosed = false; win.hasShadow = false
      win.animationBehavior = .none   // no open or close animation: macOS drew it small, on screen, for a moment
      // The same flags as PS's own hidden windows (Reminders.swift): never in Stage Manager, Mission Control or the window cycle.
      win.level = .statusBar; win.hidesOnDeactivate = false; win.becomesKeyOnlyIfNeeded = true
      win.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle, .transient]
      win.contentView = w
      win.orderBack(nil)
      keep.append(win)
      w.load(URLRequest(url: URL(string: "ps://app/client/fitview?style=\(s.style)&tab=\(s.tab)")!))
      var tries = 0
      func feed() {
        tries += 1
        w.evaluateJavaScript("!!(window.__psOverlay && window.__psOverlay.load)") { v, _ in
          guard (v as? Bool) == true else { if tries < 40 { later(0.15, feed) } else { r.append((s.name + "-loaded", false)); run(i + 1) }; return }
          w.callAsyncJavaScript("window.__psOverlay.load(JSON.parse(d), true)", arguments: ["d": json(s.live ? live : start)], in: nil, in: .page) { _ in
            later(1.8) {
              w.evaluateJavaScript(probe) { pv, _ in
                let p = (pv as? String).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] } ?? [:]
                // "words": letters really drawn (visible, not see-through) on screen, so an empty screen fails.
                var ok = (p["fit"] as? Bool) == true && (p["style"] as? String) == s.style && ((p["wide"] as? Int) ?? 99) <= 1 && (p["dash"] as? Bool) == false && ((p["words"] as? Int) ?? 0) > (s.tab == "gym" && !s.live ? 100 : 250)
                if s.tab == "gym" && !s.live && s.size == phone { ok = ok && (p["big"] as? Bool) == true }
                if s.live { ok = ok && (p["clock"] as? Bool) == true }
                r.append((s.name, ok))
                if !ok { print("FITNESS DETAIL \(s.name):", pv ?? "nil") }
                snap(w, "\(dir)/fitness-\(s.name).png") { win.orderOut(nil); later(0.1) { run(i + 1) } }
              }
            }
          }
        }
      }
      later(0.4, feed)
    }
    run(0)
  }
}

/// A picture window that can never take the keyboard or become the main window (so the test copy never turns active).
final class FitTestPanel: NSPanel {
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}
