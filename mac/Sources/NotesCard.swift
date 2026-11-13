// Meeting notes pop-up (the developer, 22 Oct 2026). A few minutes after a meeting starts, the notes the developer wrote
// for it come up at the TOP LEFT of the screen as a checklist (src/notescard.ts decides when and
// what; it arrives through Toast.showMeet with tone "notes"). Ticking an item saves it and slides
// it away; when every item is ticked the card closes itself. "Remind me in": the MOUSE WHEEL over it
// steps through the choices (5 to 60 minutes, then "Don't remind me"), a click confirms.
//
// Private notes while the developer may be sharing his screen: the window is excluded from screen capture
// (sharingType .none) and, by default, the items stay blurred until the mouse is over the card
// (gear menu > Meeting alerts). The window never takes focus or keys (it can not become key) and is
// only as big as the card. Buttons are clicks; the picker is the one place where the wheel acts.
import AppKit
import WebKit

final class NotesPanel: NSPanel {
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}

/// Tells the page when the mouse is over the card: a window that is never key gets no hover otherwise.
final class HoverView: NSView {
  var onHover: ((Bool) -> Void)?
  override func updateTrackingAreas() {
    // One area that follows the view's size by itself. Removing and re-adding it on every resize lost
    // track of a pointer resting inside (no "mouse entered" comes for an area added under it).
    if trackingAreas.isEmpty { addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)) }
    super.updateTrackingAreas()
  }
  override func mouseEntered(with event: NSEvent) { onHover?(true) }
  override func mouseExited(with event: NSEvent) { onHover?(false) }
}

final class NotesCard: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
  static let shared = NotesCard()
  private(set) var panel: NotesPanel?
  private(set) var web: ClickThroughWebView?
  private var ready = false
  private var queued: String?
  private var cardId: String?
  private static let width: CGFloat = 340
  private var height: CGFloat = 220
  private var test: Bool { ProcessInfo.processInfo.environment["PS_SELFTEST"] != nil }

  private func setUp() {
    guard panel == nil else { return }
    let c = WKWebViewConfiguration()
    c.websiteDataStore = .nonPersistent()
    c.userContentController.add(self, name: "notes")
    let box = HoverView(frame: NSRect(x: 0, y: 0, width: NotesCard.width, height: height))
    let w = ClickThroughWebView(frame: box.bounds, configuration: c)
    w.autoresizingMask = [.width, .height]
    w.setValue(false, forKey: "drawsBackground")
    w.navigationDelegate = self
    box.addSubview(w)
    box.onHover = { [weak w] on in w?.evaluateJavaScript("window.__notes && window.__notes.hover(\(on))", completionHandler: nil) }
    let p = NotesPanel(contentRect: box.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    p.isOpaque = false; p.backgroundColor = .clear; p.hasShadow = false
    p.level = .statusBar
    p.hidesOnDeactivate = false
    p.isReleasedWhenClosed = false
    p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    p.sharingType = .none                       // never in screenshots or screen sharing (see SelfTest.notesCard for what is proven)
    p.contentView = box
    if test { p.alphaValue = 0; p.ignoresMouseEvents = true }   // a self test copy never shows or catches a click
    panel = p; web = w
    w.loadHTMLString(NotesCard.page, baseURL: nil)
  }
  private func frame(hidden: Bool) -> NSRect {
    let screen = NSScreen.screens.first ?? NSScreen.main!
    let v = screen.visibleFrame
    var r = NSRect(x: v.minX + 8, y: v.maxY - height - 6, width: NotesCard.width, height: height)
    // The AFK stopwatch (or its open pop-up) may sit anywhere the developer dragged it: never cover it. Just below
    // it when there is room, else beside it.
    if let occ = Afk.shared.occupied, occ.insetBy(dx: -4, dy: -4).intersects(r) {
      let below = NSRect(x: r.minX, y: occ.minY - height - 6, width: r.width, height: height)
      let right = NSRect(x: occ.maxX + 8, y: r.minY, width: r.width, height: height)
      let left = NSRect(x: occ.minX - r.width - 8, y: r.minY, width: r.width, height: height)
      r = [below, right, left].first { v.contains($0) && !$0.intersects(occ) } ?? below
    }
    if hidden { r.origin.x = v.minX - NotesCard.width - 20 }
    return r
  }
  /// V1.55: under the Dynamic Island while it is there and the developer left the notes card on Island (IslandColumn.swift), or
  /// nil for its usual place. It keeps its own size, snooze and its hiding from screenshots and screen sharing.
  private func islandFrame() -> NSRect? {
    guard let panel else { return nil }
    return IslandColumn.shared.frame(id: "notes", kind: "notes", size: NSSize(width: NotesCard.width, height: height), window: panel,
                                     replace: { [weak self] in self?.relayout() })
  }
  /// The AFK stopwatch came, went, opened or closed: slide to the new place.
  func relayout() {
    guard let panel, panel.isVisible, cardId != nil else { return }
    if !test, let f = islandFrame() { IslandColumn.shared.put(panel, f); return }
    let to = frame(hidden: false)
    if test { panel.setFrame(to, display: true); return }
    NSAnimationContext.runAnimationGroup { ctx in
      ctx.duration = 0.32
      ctx.timingFunction = CAMediaTimingFunction(controlPoints: 0.22, 1, 0.36, 1)
      panel.animator().setFrame(to, display: true)
    }
  }

  /// From Toast.showMeet (tone "notes").
  func show(_ c: [String: Any]) {
    guard let id = c["id"] as? String, id.hasPrefix("nc:"), id.count <= 40, let items = c["items"] as? [[String: Any]] else { return }
    let clean: [String: Any] = [
      "id": id, "title": String((c["title"] as? String ?? "").prefix(160)), "blur": (c["blur"] as? Bool) != false,
      "items": items.prefix(30).compactMap { i -> [String: Any]? in
        guard let iid = i["id"] as? String, let t = i["text"] as? String else { return nil }
        return ["id": String(iid.prefix(64)), "text": String(t.prefix(300)), "every": (i["every"] as? Bool) == true]
      },
      "snooze": ((c["snooze"] as? [Int]) ?? [5, 10, 15, 20, 30, 45, 60]).filter { $0 >= 5 && $0 <= 60 },
    ]
    guard let d = try? JSONSerialization.data(withJSONObject: clean), let s = String(data: d, encoding: .utf8) else { return }
    if (clean["items"] as? [Any])?.isEmpty != false { hide(id); return }   // no open notes, no card
    setUp()
    let fresh = cardId != id
    cardId = id
    if ready { web?.evaluateJavaScript("window.__notes.set(\(s))", completionHandler: nil) } else { queued = s }
    guard let panel else { return }
    if panel.isVisible && !fresh { return }
    if test { panel.setFrame(frame(hidden: false), display: true); panel.orderFrontRegardless(); return }
    if let f = islandFrame() { IslandColumn.shared.put(panel, f); return }   // V1.55: out of the island
    // Slides in from the left edge.
    panel.setFrame(frame(hidden: true), display: false)
    panel.alphaValue = 0
    panel.orderFrontRegardless()
    NSAnimationContext.runAnimationGroup { ctx in
      ctx.duration = 0.55
      ctx.timingFunction = CAMediaTimingFunction(controlPoints: 0.22, 1, 0.36, 1)
      panel.animator().setFrame(frame(hidden: false), display: true)
      panel.animator().alphaValue = 1
    }
  }
  /// From Toast.hideCard (an id starting "nc:"), or the card itself after the last tick or a snooze.
  func hide(_ id: String? = nil) {
    if let id, id != cardId { return }
    cardId = nil
    let inIsland = IslandColumn.shared.ids.contains("notes")
    IslandColumn.shared.leave("notes")
    guard let panel, panel.isVisible else { return }
    if test { panel.orderOut(nil); return }
    if inIsland {   // under the island it fades where it is (the slide out to the left belongs to its usual place)
      NSAnimationContext.runAnimationGroup({ ctx in ctx.duration = 0.25; panel.animator().alphaValue = 0 }) { panel.orderOut(nil) }
      return
    }
    NSAnimationContext.runAnimationGroup({ ctx in
      ctx.duration = 0.4
      ctx.timingFunction = CAMediaTimingFunction(controlPoints: 0.5, 0, 0.75, 0)
      panel.animator().setFrame(frame(hidden: true), display: true)
      panel.animator().alphaValue = 0
    }) { panel.orderOut(nil) }
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    ready = true
    if let s = queued { webView.evaluateJavaScript("window.__notes.set(\(s))", completionHandler: nil); queued = nil }
  }
  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    decisionHandler(action.navigationType == .other ? .allow : .cancel)
  }
  func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let s = message.body as? String, let d = s.data(using: .utf8), let m = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
          let type = m["type"] as? String else { return }
    switch type {
    case "size":
      let h = CGFloat(m["h"] as? Double ?? 0)
      guard h > 40, let panel else { return }
      height = min(h, 640)
      var f = panel.frame
      f.origin.y += f.height - height; f.size.height = height
      panel.setFrame(f, display: true)
      if IslandColumn.shared.ids.contains("notes") { relayout() }   // V1.55: under the island, the ones after it make room
    case "action":
      guard let id = cardId, let a = m["action"] as? String else { return }
      Toast.shared.onAction?(id, String(a.prefix(80)))           // to the main window: src/notescard.ts
      if a.hasPrefix("snooze:") || a == "quiet" || a == "alldone" { hide() }
    default: break
    }
  }

  // The card. Built in: no network, no vault; it only holds the notes it was handed.
  private static let page = #"""
  <!doctype html><html><head><meta charset="utf-8"><style>
  :root{--ease:cubic-bezier(.22,1,.36,1)}
  html,body{margin:0;background:transparent;overflow:hidden;color:#fff;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Inter",sans-serif;-webkit-font-smoothing:antialiased;-webkit-user-select:none;cursor:default}
  #card{margin:6px 10px 14px 6px;border-radius:20px;overflow:hidden;padding:13px 14px 12px;
    background:linear-gradient(160deg,rgba(20,58,52,.97),rgba(16,20,22,.97) 62%);border:1.5px solid rgba(52,211,153,.5);box-shadow:0 18px 40px rgba(0,0,0,.42)}
  .h{display:flex;align-items:center;gap:8px}
  .pill{padding:3px 9px;border-radius:99px;font-size:10.5px;font-weight:850;letter-spacing:.14em;background:rgba(52,211,153,.2);color:#A7F3D0;flex:none}
  #title{flex:1;min-width:0;font-size:14px;font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #left{font-size:11.5px;color:rgba(255,255,255,.55);flex:none}
  ul{list-style:none;margin:10px 0 0;padding:0}
  li{display:flex;align-items:flex-start;gap:9px;padding:7px 8px;margin:0 -8px;border-radius:12px;transition:background .15s,opacity .35s var(--ease),transform .35s var(--ease),max-height .35s var(--ease),padding .35s var(--ease);max-height:120px;overflow:hidden}
  li:hover{background:rgba(255,255,255,.06)}
  li.out{opacity:0;transform:translateX(30px);max-height:0;padding-top:0;padding-bottom:0}
  .tick{flex:none;width:18px;height:18px;border-radius:50%;border:2px solid rgba(255,255,255,.55);display:grid;place-items:center;margin-top:1px;transition:background .15s,border-color .15s}
  .tick svg{opacity:0}
  li.done .tick{background:#34D399;border-color:#34D399}li.done .tick svg{opacity:1}
  .t{font-size:13.5px;line-height:1.4;overflow-wrap:anywhere}
  .ev{flex:none;font-size:10px;font-weight:750;color:#A7F3D0;opacity:.75;margin-top:3px}
  #list{transition:filter .25s var(--ease)}
  .blur #list{filter:blur(7px)}
  .blur .hint{display:block}
  .hint{display:none;margin-top:6px;font-size:11px;color:rgba(255,255,255,.5)}
  .rem{display:flex;align-items:center;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08)}
  .rem span{font-size:12px;color:rgba(255,255,255,.6)}
  #pick{flex:1;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.08);color:#fff;border-radius:99px;padding:6px 12px;font:750 12.5px -apple-system,sans-serif;text-align:center;cursor:ns-resize;transition:background .15s,transform .12s}
  #pick:hover{background:rgba(255,255,255,.16)}
  #pick.bump{transform:scale(1.05)}
  #pick.quiet{border-color:rgba(248,113,113,.6);color:#FECACA}
  .wheel{font-size:10.5px;color:rgba(255,255,255,.4);flex:none}
  @media (prefers-reduced-motion:reduce){li,#list{transition:none}}
  </style></head><body><div id="card"><div class="h"><span class="pill">NOTES</span><span id="title"></span><span id="left"></span></div>
  <ul id="list"></ul><div class="hint">Hidden while you might be sharing your screen. Move the mouse over the card to read.</div>
  <div class="rem"><span>Remind me in</span><button id="pick" title="Scroll to change, click to confirm"></button><span class="wheel">scroll</span></div></div>
  <script>
  (function(){
    var post=function(m){try{webkit.messageHandlers.notes.postMessage(JSON.stringify(m))}catch(e){}};
    var card=document.getElementById('card'),list=document.getElementById('list'),title=document.getElementById('title'),left=document.getElementById('left'),pick=document.getElementById('pick');
    var st=null,choices=[15],ci=0,hover=false,rows={};
    var SVG='<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#0B2E25" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>';
    function size(){post({type:'size',h:card.offsetHeight+20})}
    function label(){var v=choices[ci];pick.textContent=v==='quiet'?"Don't remind me":v+' minutes';pick.classList.toggle('quiet',v==='quiet')}
    function count(){var n=list.querySelectorAll('li:not(.done)').length;left.textContent=n+' to go';return n}
    function blur(){card.classList.toggle('blur',!!(st&&st.blur)&&!hover)}
    function set(s){
      var fresh=!st||st.id!==s.id;st=s;title.textContent=s.title;
      if(fresh){list.innerHTML='';rows={};choices=(s.snooze&&s.snooze.length?s.snooze:[15]).concat(['quiet']);ci=Math.max(0,choices.indexOf(15));label()}
      var want={};s.items.forEach(function(it){want[it.id]=1});
      Object.keys(rows).forEach(function(id){if(!want[id]&&!rows[id].classList.contains('done'))gone(rows[id],id)});
      s.items.forEach(function(it){
        if(rows[it.id])return;
        var li=document.createElement('li');li.innerHTML='<span class="tick">'+SVG+'</span><span class="t"></span>'+(it.every?'<span class="ev">every call</span>':'');
        li.querySelector('.t').textContent=it.text;
        li.addEventListener('click',function(){if(li.classList.contains('done'))return;li.classList.add('done');post({type:'action',action:'tick:'+it.id});
          setTimeout(function(){gone(li,it.id);if(!count())setTimeout(function(){post({type:'action',action:'alldone'})},420)},280)});
        rows[it.id]=li;list.appendChild(li);
      });
      count();blur();setTimeout(size,0);
    }
    function gone(li,id){li.classList.add('out');setTimeout(function(){li.remove();delete rows[id];size()},380)}
    // The wheel steps through the choices (one step per notch, a short pause between steps); a click confirms.
    var lastStep=0,acc=0;
    pick.addEventListener('wheel',function(e){e.preventDefault();acc+=e.deltaY;var now=Date.now();if(Math.abs(acc)<4||now-lastStep<90)return;
      ci=Math.max(0,Math.min(choices.length-1,ci+(acc>0?1:-1)));acc=0;lastStep=now;label();pick.classList.add('bump');setTimeout(function(){pick.classList.remove('bump')},120)},{passive:false});
    pick.addEventListener('click',function(){var v=choices[ci];post({type:'action',action:v==='quiet'?'quiet':'snooze:'+v})});
    window.__notes={set:set,hover:function(on){hover=!!on;blur()},state:function(){return{items:list.querySelectorAll('li').length,open:count(),pick:pick.textContent,blur:card.classList.contains('blur')}}};
  })();
  </script></body></html>
  """#
}

// MARK: - Self test: the meeting notes card with FICTIONAL notes, and whether it is kept out of screen capture.
extension SelfTest {
  static func notesCheck(_ a: App, _ dir: String, _ done: @escaping () -> Void) {
    let n = NotesCard.shared
    func post(_ obj: [String: Any]) {
      guard let d = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: d, encoding: .utf8) else { return }
      a.main.callAsyncJavaScript("window.webkit.messageHandlers.ps.postMessage(m)", arguments: ["m": s], in: nil, in: .page, completionHandler: nil)
    }
    let card: [String: Any] = ["id": "nc:test1", "tone": "notes", "title": "Shopify Redesign with Northwind Silk", "blur": true, "snooze": [5, 10, 15, 20, 30, 45, 60],
      "items": [["id": "s1", "text": "Confirm the budget", "every": true], ["id": "i1", "text": "Ask about the launch date", "every": false],
                ["id": "i2", "text": "Show the new mobile menu", "every": false]]]
    let keep = Toast.shared.onAction
    var got: [String] = []
    Toast.shared.onAction = { id, action in got.append("\(id):\(action)") }
    var r: [(String, Bool)] = []
    func js(_ s: String, _ f: @escaping (Any?) -> Void) { n.web?.evaluateJavaScript(s) { v, _ in f(v) } ?? f(nil) }
    func later(_ t: Double, _ f: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + t, execute: f) }
    let state = "JSON.stringify(window.__notes.state())"
    func wheel(_ dy: Int, _ times: Int, _ f: @escaping () -> Void) {
      guard times > 0 else { return f() }
      js("document.getElementById('pick').dispatchEvent(new WheelEvent('wheel', {deltaY: \(dy), bubbles: true, cancelable: true}))") { _ in later(0.15) { wheel(dy, times - 1, f) } }
    }
    post(["type": "meetCard", "card": card])
    later(2.0) {
      js(state) { v in
        let s = String(describing: v ?? "")
        r.append(("appears-with-3", n.panel?.isVisible == true && s.contains("\"items\":3")))
        r.append(("blurred-until-hover", s.contains("\"blur\":true")))
        snap(n.web!, "\(dir)/notes-card-blur.png") {
          js("window.__notes.hover(true)") { _ in
            later(0.5) {
              snap(n.web!, "\(dir)/notes-card.png") {
                js(state) { v1 in
                  r.append(("hover-shows", String(describing: v1 ?? "").contains("\"blur\":false")))
                  js("document.querySelectorAll('#list li')[1].click()") { _ in        // tick "Ask about the launch date"
                    later(1.0) {
                      js(state) { v2 in
                        r.append(("tick-saves-and-leaves", got.contains("nc:test1:tick:i1") && String(describing: v2 ?? "").contains("\"items\":2")))
                        js(state) { v3 in
                          let start = String(describing: v3 ?? "")
                          wheel(100, 2) {                                          // down two notches: 15 -> 20 -> 30
                            js(state) { v4 in
                              let down = String(describing: v4 ?? "")
                              wheel(-100, 1) {                                     // up one: 20
                                js(state) { v5 in
                                  let up = String(describing: v5 ?? "")
                                  r.append(("wheel-picks", start.contains("15 minutes") && down.contains("30 minutes") && up.contains("20 minutes")))
                                  snap(n.web!, "\(dir)/notes-card-picker.png") {
                                    js("document.getElementById('pick').click()") { _ in
                                      later(0.8) {
                                        r.append(("click-snoozes", got.contains("nc:test1:snooze:20") && n.panel?.isVisible != true))
                                        post(["type": "meetCard", "card": card])            // back after the snooze, items still open
                                        later(1.5) {
                                          r.append(("returns", n.panel?.isVisible == true))
                                          wheel(100, 12) {                                 // to the end: Don't remind me
                                            js(state) { v6 in
                                              r.append(("last-is-dont-remind", String(describing: v6 ?? "").contains("Don't remind me")))
                                              js("document.getElementById('pick').click()") { _ in
                                                later(0.8) {
                                                  r.append(("dont-remind-closes", got.contains("nc:test1:quiet") && n.panel?.isVisible != true))
                                                  // Tick everything: it closes itself.
                                                  var two = card; two["id"] = "nc:test2"
                                                  two["items"] = [["id": "a1", "text": "Say thanks", "every": false]]
                                                  post(["type": "meetCard", "card": two])
                                                  later(1.5) {
                                                    js("document.querySelector('#list li').click()") { _ in
                                                      later(1.4) {
                                                        r.append(("all-ticked-closes", got.contains("nc:test2:alldone") && n.panel?.isVisible != true))
                                                        var none = card; none["id"] = "nc:test3"; none["items"] = [[String: Any]]()
                                                        post(["type": "meetCard", "card": none])
                                                        later(1.0) {
                                                          r.append(("no-notes-no-card", n.panel?.isVisible != true))
                                                          captureCheck(n) { cap in
                                                            print("NOTES CHECK:", r.map { "\($0.0)=\($0.1 ? "ok" : "FAIL")" }.joined(separator: " "),
                                                                  "key=\(n.panel?.isKeyWindow ?? false)", "activePS=\(NSApp.isActive)")
                                                            print("NOTES CAPTURE:", cap)
                                                            Toast.shared.onAction = keep
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
    }
  }

  /// Is the notes window kept out of screen capture? Captures this test copy's OWN windows only (no
  /// permission needed, nothing of the developer's): the notes window (sharingType .none) against a control
  /// window drawn the same way but shareable. Both stay parked off screen.
  static func captureCheck(_ n: NotesCard, _ done: @escaping (String) -> Void) {
    n.show(["id": "nc:cap", "tone": "notes", "title": "Capture test", "blur": false, "items": [["id": "c1", "text": "If you can read this, capture works", "every": false]]])
    let control = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 340, height: 160), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    control.backgroundColor = .systemRed; control.isOpaque = true; control.sharingType = .readOnly
    control.ignoresMouseEvents = true
    control.orderFrontRegardless()
    let wasAlpha = n.panel?.alphaValue ?? 0
    n.panel?.alphaValue = 1
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
      func painted(_ id: CGWindowID) -> String {
        guard let img = CGWindowListCreateImage(.null, .optionIncludingWindow, id, [.boundsIgnoreFraming]) else { return "nil" }
        guard let data = img.dataProvider?.data, let p = CFDataGetBytePtr(data) else { return "nodata" }
        let len = CFDataGetLength(data), step = max(4, (len / 4000) / 4 * 4)
        var lit = 0, seen = 0
        var i = 0
        while i + 3 < len { seen += 1; if p[i] > 8 || p[i + 1] > 8 || p[i + 2] > 8 || p[i + 3] > 8 { lit += 1 }; i += step }
        return "\(img.width)x\(img.height) painted=\(seen > 0 ? lit * 100 / seen : 0)%"
      }
      let notes = n.panel.map { painted(CGWindowID($0.windowNumber)) } ?? "no window"
      let ctl = painted(CGWindowID(control.windowNumber))
      control.orderOut(nil)
      n.panel?.alphaValue = wasAlpha
      n.hide("nc:cap")
      done("notes-window(sharingType none): \(notes) control-window(shareable): \(ctl)")
    }
  }
}

