import AppKit
import WebKit

// Self test for G Squad in the Tab list (V1.40, web src/views/GSquad.tsx, src/squad/*). FICTIONAL squad
// "Northside Crew": you ("Alex"), "Sam Fox" (working) and "Kit Lane" (not working), two working in all, Sam has
// handed you a task. The squad view goes into the test state the way PS's main page sends it (it holds no keys
// here, and a test copy never reaches the hub: zero network). Real mouse events into the parked overlay:
//   the icon sits in the top right, just left of the moon, with the count 2;
//   hovering it says "2 people are working right now" (never "online");
//   one click opens the pop-up with the five tabs in the developer's order, Tasks first because a hand over waits;
//   Tasks: the hand over with Accept and Decline, everyone's tasks, the anonymised one as "Client task";
//   Accept sends one answer to the main page (squadOp);
//   Members: three people, "Sam Fox is working", Invite someone, and every sharing switch (6, none called
//   Private mode); switching Working status off reaches the settings (the switch is enforced on the main page);
//   Leaderboard, Screen time and Chat say Coming soon, Leaderboard with the Money switch;
//   Esc closes only the pop-up (the list stays up);
//   not in a squad: Join with a link and Start a squad.
// PS_SELFTEST_ONLY=gsquad, with PS_SELFTEST_RED=1 (the developer) and =0 (anyone else: it must look the same).
// Pictures: gsquad-icon.png, gsquad-hover.png, gsquad-tasks.png, gsquad-members.png, gsquad-soon.png, gsquad-welcome.png.
extension SelfTest {
  static var squadOps: [[String: Any]] = []

  /// The squad view a main page would send (names, working, sealed copies already opened there).
  static func squadView(inSquad: Bool) -> [String: Any] {
    let me = "0b6f1a52-7c1d-4b0e-9a3c-000000000001", sam = "0b6f1a52-7c1d-4b0e-9a3c-000000000002", kit = "0b6f1a52-7c1d-4b0e-9a3c-000000000003"
    guard inSquad else {
      return ["in": false, "name": "", "me": "", "meName": "", "creator": false, "count": NSNull(), "waiting": 0, "members": [], "tasks": [], "hands": [], "link": NSNull(), "busy": NSNull(), "error": NSNull(), "loaded": false]
    }
    let task: (String, String, String, Any, Bool, Bool) -> [String: Any] = { id, who, t, p, done, anon in
      var o: [String: Any] = ["id": id, "member": who, "t": t, "p": p, "d": NSNull(), "x": done]
      if anon { o["a"] = true }
      return o
    }
    return ["in": true, "name": "Northside Crew", "me": me, "meName": "Alex", "creator": true, "count": 2, "waiting": 1,
      "members": [["id": me, "name": "Alex", "me": true, "creator": true, "working": true],
                  ["id": sam, "name": "Sam Fox", "me": false, "creator": false, "working": true],
                  ["id": kit, "name": "Kit Lane", "me": false, "creator": false, "working": false]],
      "tasks": [task("a1", me, "Write the launch plan", 1, false, false), task("a2", me, "Client task", 2, false, true),
                task("s1", sam, "Edit the promo video", 1, false, false), task("s2", sam, "Book the studio", NSNull(), true, false),
                task("k1", kit, "Chase two invoices", 2, false, false)],
      "hands": [["id": "0b6f1a52-7c1d-4b0e-9a3c-0000000000aa", "from": sam, "to": me, "state": "open", "t": "Proofread the newsletter", "d": NSNull(), "at": ISO8601DateFormatter().string(from: Date())]],
      "link": NSNull(), "busy": NSNull(), "error": NSNull(), "loaded": true]
  }

  static func gsquadCheck(_ a: App, _ dir: String, _ done: @escaping () -> Void) {
    func later(_ t: Double, _ f: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + t, execute: f) }
    func js(_ s: String, _ f: @escaping (Any?) -> Void) { a.overlay.evaluateJavaScript(s) { v, _ in f(v) } }
    func obj(_ v: Any?) -> [String: Any] { (v as? String).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] } ?? [:] }
    func at(_ sel: String, _ f: @escaping (NSPoint?, NSPoint?) -> Void) {
      js("(function(){var e=document.querySelector(\"\(sel)\");if(!e)return null;var r=e.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()") { v in
        guard let xy = v as? [NSNumber], xy.count == 2, let w = a.overlay else { f(nil, nil); return }
        let local = NSPoint(x: xy[0].doubleValue, y: w.isFlipped ? xy[1].doubleValue : w.bounds.height - xy[1].doubleValue)
        f(w.convert(local, to: nil), NSPoint(x: xy[0].doubleValue, y: xy[1].doubleValue))
      }
    }
    /// A real click (mouse down, then up 90 ms later) on the element's centre, into the overlay window.
    func click(_ sel: String, _ f: @escaping (Bool) -> Void) {
      at(sel) { inWin, page in
        guard let inWin, let page else { f(false); return }
        a.updateClickThrough(at: page)
        func ev(_ t: NSEvent.EventType) -> NSEvent? {
          NSEvent.mouseEvent(with: t, location: inWin, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: a.panel.windowNumber,
                             context: nil, eventNumber: 14, clickCount: 1, pressure: t == .leftMouseUp ? 0 : 1)
        }
        if let d = ev(.leftMouseDown) { a.panel.sendEvent(d) }
        later(0.09) { if let u = ev(.leftMouseUp) { a.panel.sendEvent(u) }; f(true) }
      }
    }
    /// Real mouse moves (PS's MouseFeed turns them into mouseover/mousemove on the page): first onto an empty part
    /// of the list 40 px below the element, then onto the element, the way a pointer arrives.
    func hover(_ sel: String, _ f: @escaping () -> Void) {
      at(sel) { inWin, page in
        guard let inWin, let page, let feed = a.panel.contentView as? MouseFeed else { f(); return }
        func move(_ p: NSPoint) {
          guard let ev = NSEvent.mouseEvent(with: .mouseMoved, location: p, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: a.panel.windowNumber, context: nil, eventNumber: 0, clickCount: 0, pressure: 0) else { return }
          MouseFeed.testMove = true
          feed.mouseMoved(with: ev)
          MouseFeed.testMove = false
        }
        a.updateClickThrough(at: page)
        move(NSPoint(x: inWin.x, y: inWin.y - 40))
        later(0.35) { move(inWin); later(0.6, f) }
      }
    }
    func setSquad(_ inSquad: Bool) {
      if let st = a.lastState, var j = try? JSONSerialization.jsonObject(with: Data(st.utf8)) as? [String: Any] {
        j["squad"] = squadView(inSquad: inSquad)
        a.lastState = (try? JSONSerialization.data(withJSONObject: j)).flatMap { String(data: $0, encoding: .utf8) }
        a.pushState()
      }
    }
    let keep = a.lastState
    setSquad(true)
    squadOps = []
    var r: [(String, Bool)] = []
    let state = """
      JSON.stringify((function(){
        var q=function(s){return document.querySelector(s)}, R=function(e){if(!e)return null;var b=e.getBoundingClientRect();return [b.left,b.top,b.right,b.bottom]};
        var ov=q('.tm-overlay:not(.tm-docked)');
        var txt=function(s){return [].map.call(document.querySelectorAll(s),function(e){return e.textContent.trim()})};
        var pop=q('.gs-pop');
        return {btn: R(ov&&ov.querySelector('.tm-tr .gs-btn')), moon: R(ov&&ov.querySelector('.tm-tr .dnd-btn')), n: (q('.gs-n')||{}).textContent||'',
          tip: (q('.gs-tip')||{}).textContent||'', label: (q('.gs-btn')||{getAttribute:function(){return ''}}).getAttribute('aria-label')||'',
          pop: R(pop), tabs: txt('.gs-tab'), on: (q('.gs-tab.on')||{}).textContent||'', hands: txt('.gs-hand .gs-tt'), accept: !!q('.gs-hand .gs-mini.go'),
          tasks: txt('.gs-task:not(.gs-hand) .gs-tt'), anon: txt('.gs-task.anon .gs-tt'), heads: txt('.gs-mem .gs-h'),
          members: txt('.gs-member .gs-tt'), switches: txt('.gs-sw .gs-tt'), swOn: [].map.call(document.querySelectorAll('.gs-sw'),function(e){return e.getAttribute('data-piece')+':'+e.getAttribute('aria-checked')}),
          invite: !!q('.gs-invite .gs-go'), soon: txt('.gs-soon .gs-lead'), welcome: txt('.gs-big'), all: pop ? pop.textContent : ''};
      })())
      """
    func finish() {
      print("GSQUAD CHECK:", r.map { "\($0.0)=\($0.1 ? "ok" : "FAIL")" }.joined(separator: " "))
      a.lastState = keep; a.pushState()
      later(0.6, done)
    }
    later(1.2) {
      js(state) { v0 in
        let s0 = obj(v0)
        let b = (s0["btn"] as? [Double]) ?? [], m = (s0["moon"] as? [Double]) ?? []
        r.append(("icon-in-top-right", b.count == 4 && b[0] > 600))
        r.append(("icon-left-of-moon", b.count == 4 && m.count == 4 && b[2] <= m[0] + 1 && abs((b[1] + b[3]) / 2 - (m[1] + m[3]) / 2) < 3))
        r.append(("count-shows-2", (s0["n"] as? String) == "2"))
        r.append(("closed-at-start", s0["pop"] is NSNull || s0["pop"] == nil))
        snap(a.overlay, "\(dir)/gsquad-icon.png") {
          let tipJS = "(document.querySelector('.gs-tip')||{}).textContent||''"
          func hovered(_ tries: Int, _ g: @escaping () -> Void) {
            hover(".tm-overlay:not(.tm-docked) .gs-btn") {
              js(tipJS) { t in if ((t as? String) ?? "").isEmpty && tries > 1 { hovered(tries - 1, g) } else { g() } }
            }
          }
          hovered(2) {
            js(state) { vh in
              let sh = obj(vh)
              r.append(("hover-says-working", (sh["tip"] as? String) == "2 people are working right now"))
              r.append(("never-online", !((sh["tip"] as? String) ?? "").lowercased().contains("online") && !((sh["label"] as? String) ?? "").lowercased().contains("online")))
              snap(a.overlay, "\(dir)/gsquad-hover.png") {
                click(".tm-overlay:not(.tm-docked) .gs-btn") { _ in
                  later(1.0) {
                    js(state) { v1 in
                      let s1 = obj(v1)
                      let p = (s1["pop"] as? [Double]) ?? []
                      r.append(("one-click-opens", p.count == 4 && p[2] - p[0] > 300))
                      r.append(("five-tabs-in-order", (s1["tabs"] as? [String]) == ["Leaderboard", "Tasks1", "Screen time", "Members", "Chat"]))
                      r.append(("tasks-first-when-handed", ((s1["on"] as? String) ?? "").hasPrefix("Tasks")))
                      r.append(("hand-over-shown", ((s1["hands"] as? [String]) ?? []).first?.hasPrefix("Proofread the newsletter") == true && s1["accept"] as? Bool == true))
                      let tasks = (s1["tasks"] as? [String]) ?? []
                      r.append(("everyones-tasks", ["Write the launch plan", "Edit the promo video", "Chase two invoices", "Book the studio"].allSatisfy { tasks.contains($0) }))
                      r.append(("anonymised-is-neutral", (s1["anon"] as? [String]) == ["Client task"]))
                      r.append(("list-pinned-while-open", a.dimxOpen))
                      snap(a.overlay, "\(dir)/gsquad-tasks.png") {
                        click(".gs-hand .gs-mini.go") { _ in
                          later(0.6) {
                            r.append(("accept-sent-once", squadOps.filter { $0["op"] as? String == "answer" && $0["accept"] as? Bool == true }.count == 1))
                            r.append(("open-told-main-page", squadOps.contains { $0["op"] as? String == "open" && $0["on"] as? Bool == true }))
                            click(".gs-tab:nth-child(4)") { _ in
                              later(0.8) {
                                js(state) { v2 in
                                  let s2 = obj(v2)
                                  let mem = (s2["members"] as? [String]) ?? []
                                  r.append(("three-members", mem.count == 3 && mem.contains { $0.hasPrefix("Sam Fox") && $0.contains("Sam Fox is working") }
                                    && mem.contains { $0.hasPrefix("Kit Lane") && $0.contains("Not working") }))
                                  r.append(("invite-button", s2["invite"] as? Bool == true))
                                  let sw = (s2["switches"] as? [String]) ?? []
                                  r.append(("six-sharing-switches", sw.count == 6 && ["Tasks", "Working status", "Money", "Screen time", "Fitness", "Sleep"].allSatisfy { l in sw.contains { $0.hasPrefix(l) } }))
                                  r.append(("no-private-mode-name", !((s2["all"] as? String) ?? "").lowercased().contains("private mode")))
                                  snap(a.overlay, "\(dir)/gsquad-members.png") {
                                    click(".gs-sw[data-piece='working']") { _ in
                                      later(0.8) {
                                        js(state) { v3 in
                                          let s3 = obj(v3)
                                          r.append(("switch-off-sent", squadOps.contains { $0["op"] as? String == "share" && $0["piece"] as? String == "working" && $0["on"] as? Bool == false }))
                                          r.append(("switch-shows-off", ((s3["swOn"] as? [String]) ?? []).contains("working:false")))
                                          click(".gs-tab:nth-child(1)") { _ in
                                            later(0.7) {
                                              js(state) { v4 in
                                                let s4 = obj(v4)
                                                r.append(("leaderboard-placeholder", ((s4["soon"] as? [String]) ?? []).first?.hasPrefix("Coming soon") == true
                                                  && ((s4["switches"] as? [String]) ?? []).first?.hasPrefix("Money") == true))
                                                snap(a.overlay, "\(dir)/gsquad-soon.png") {
                                                  click(".gs-tab:nth-child(5)") { _ in
                                                    later(0.6) {
                                                      js(state) { v5 in
                                                        r.append(("chat-placeholder", ((obj(v5)["soon"] as? [String]) ?? []).first?.hasPrefix("Coming soon") == true))
                                                        a.escKey()
                                                        later(0.8) {
                                                          js(state) { v6 in
                                                            let s6 = obj(v6)
                                                            r.append(("esc-closes-only-popup", (s6["pop"] is NSNull || s6["pop"] == nil) && a.shown))
                                                            r.append(("close-told-main-page", squadOps.contains { $0["op"] as? String == "open" && $0["on"] as? Bool == false }))
                                                            setSquad(false)
                                                            later(0.8) {
                                                              click(".tm-overlay:not(.tm-docked) .gs-btn") { _ in
                                                                later(1.0) {
                                                                  js(state) { v7 in
                                                                    let s7 = obj(v7)
                                                                    let w = (s7["welcome"] as? [String]) ?? []
                                                                    r.append(("welcome-join-and-start", w.count == 2 && w[0].hasPrefix("Join with a link") && w[1].hasPrefix("Start a squad")))
                                                                    r.append(("welcome-has-switches", ((s7["switches"] as? [String]) ?? []).count == 6))
                                                                    r.append(("no-count-outside-squad", (s7["n"] as? String) == ""))
                                                                    snap(a.overlay, "\(dir)/gsquad-welcome.png") {
                                                                      a.escKey()
                                                                      later(0.6) { finish() }
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
              }
            }
          }
        }
      }
    }
  }

  /// The test copy has no main page vault: a squadOp from the Tab list is kept for the checks, and a sharing
  /// switch is saved into the test settings (as the main page would save it in the vault).
  static func squadOpForTest(_ op: [String: Any], settings d: inout [String: Any]) {
    squadOps.append(op)
    if op["op"] as? String == "share", let piece = op["piece"] as? String, let on = op["on"] as? Bool {
      var s = d["squadShare"] as? [String: Any] ?? [:]
      s[piece] = on
      d["squadShare"] = s
    }
  }
}
