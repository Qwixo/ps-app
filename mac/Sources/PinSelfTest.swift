import AppKit
import WebKit

// Self test for two Tab list fixes (the developer, 2 Nov 2026), web src/core/press.ts and src/ui/pin.ts.
// PS_SELFTEST_ONLY=pin. Real mouse events into the parked overlay (the window's own event path: hit test,
// first click, WebKit), fictional tasks, the keyboard tap's own code fed test keys (it never types).
// TAP: a press on the top padding of a task card, outside its words (the old code ignored it, so the developer needed
// several clicks), turns the card white on the mouse down and counts on the mouse up, one "work" per press;
// a second press clears it; a press that slides 14 px is not a click.
// PIN: Numerology opens with a click; a real double click on its top bar pins it (bar lit, kept in local
// storage, PS told, so letting go no longer keeps the list up); letting go of Tab hides everything; the next
// hold shows the screen at once, scrolled where it was; the / then . chord behaves the same; a second double
// click unpins and the screen closes with the list as before; after the overlay page reloads (a restart)
// the pinned screen opens again by itself while the list is hidden, and the PS window never took the keyboard.
// Pictures: pin-tap-white.png, pin-pinned.png, pin-back.png, pin-restored.png.
extension SelfTest {
  static func pinCheck(_ a: App, _ dir: String, _ done: @escaping () -> Void) {
    var r: [(String, Bool)] = []
    let keep = a.lastState
    let w = TabWatch.shared
    let posted = w.testPosted
    if w.testPosted == nil { w.testPosted = [] }   // never a real key, even if a branch would repost one
    var evn = 300
    func later(_ t: Double, _ f: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + t, execute: f) }
    func js(_ s: String, _ f: @escaping (Any?) -> Void) { a.overlay.evaluateJavaScript(s) { v, _ in f(v) } }
    func obj(_ v: Any?) -> [String: Any] { (v as? String).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] } ?? [:] }
    /// A point in the page (top left origin) as a window point.
    func win(_ x: Double, _ y: Double) -> NSPoint {
      let v = a.overlay!
      return v.convert(NSPoint(x: x, y: v.isFlipped ? y : v.bounds.height - y), to: nil)
    }
    func send(_ t: NSEvent.EventType, _ p: NSPoint, _ clicks: Int = 1) {
      evn += 1
      if let e = NSEvent.mouseEvent(with: t, location: p, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: a.panel.windowNumber,
                                    context: nil, eventNumber: evn, clickCount: clicks, pressure: t == .leftMouseUp ? 0 : 1) { a.panel.sendEvent(e) }
    }
    /// The page point for a JS expression returning [x, y].
    func at(_ expr: String, _ f: @escaping (NSPoint?) -> Void) {
      js(expr) { v in
        guard let xy = v as? [NSNumber], xy.count == 2 else { f(nil); return }
        f(win(xy[0].doubleValue, xy[1].doubleValue))
      }
    }
    func click(_ sel: String, _ f: @escaping () -> Void) {
      at("(function(){var e=document.querySelector(\"\(sel)\");if(!e)return null;var b=e.getBoundingClientRect();return [b.left+b.width/2,b.top+b.height/2]})()") { p in
        guard let p else { f(); return }
        send(.leftMouseDown, p); later(0.09) { send(.leftMouseUp, p); f() }
      }
    }
    func dbl(_ sel: String, _ f: @escaping () -> Void) {
      at("(function(){var e=document.querySelector(\"\(sel)\");if(!e)return null;var b=e.getBoundingClientRect();return [b.left+b.width/2,b.top+b.height/2]})()") { p in
        guard let p else { f(); return }
        send(.leftMouseDown, p, 1); later(0.06) { send(.leftMouseUp, p, 1)
          later(0.09) { send(.leftMouseDown, p, 2); later(0.06) { send(.leftMouseUp, p, 2); later(0.5, f) } } }
      }
    }
    func key(_ code: Int64, _ down: Bool) -> CGEvent { CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(code), keyDown: down)! }
    let works = { a.testRaw.filter { $0.contains("\"type\":\"work\"") }.count }

    // ---------- TAP ----------
    let row = "[...document.querySelectorAll('.tm-overlay:not(.tm-docked) .tm-list > .tm-row')].find(function(r){var t=r.querySelector(':scope > .tm-text .tm-t');return t&&t.textContent==='Invoice Example Co'})"
    let pad = "(function(){var r=\(row);if(!r)return null;var b=r.getBoundingClientRect();return [b.left+b.width*0.6,b.top+4]})()"
    let cls = "(function(){var r=\(row);return r?JSON.stringify({c:r.className,tag:!!r.querySelector('.tm-working')}):'{}'})()"
    func tap(_ next: @escaping () -> Void) {
      js("(function(){var r=\(row);if(!r)return 'no row';var b=r.getBoundingClientRect(),x=b.left+b.width*0.6,y=b.top+4,h=document.elementFromPoint(x,y);return h===r?'card':(h&&h.className)||'none'})()") { hit in
        r.append(("press-spot-is-card-padding", (hit as? String) == "card"))
        let w0 = works()
        at(pad) { p in
          guard let p else { r.append(("row-found", false)); next(); return }
          send(.leftMouseDown, p)
          later(0.05) {
            js(cls) { v in
              let s = obj(v)
              r.append(("white-on-mouse-down", (s["c"] as? String)?.contains("working") == true))
              snap(a.overlay, "\(dir)/pin-tap-white.png") {
                send(.leftMouseUp, p)
                later(0.35) {
                  js(cls) { v in
                    let s = obj(v)
                    r.append(("padding-press-counts", (s["c"] as? String)?.contains("working") == true && (s["tag"] as? Bool) == true))
                    r.append(("one-work-per-press", works() - w0 == 1))
                    send(.leftMouseDown, p); later(0.08) { send(.leftMouseUp, p)
                      later(0.35) {
                        js(cls) { v in
                          r.append(("second-press-clears", (obj(v)["c"] as? String).map { !$0.contains("working") } == true && works() - w0 == 2))
                          let p2 = NSPoint(x: p.x + 14, y: p.y)
                          send(.leftMouseDown, p)
                          later(0.04) { send(.leftMouseDragged, NSPoint(x: p.x + 7, y: p.y)); later(0.03) { send(.leftMouseDragged, p2); later(0.03) { send(.leftMouseUp, p2)
                            later(0.35) {
                              js(cls) { v in
                                r.append(("slide-is-not-a-click", (obj(v)["c"] as? String).map { !$0.contains("working") } == true && works() - w0 == 2))
                                next()
                              }
                            }
                          } } }
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

    // ---------- TICK (V1.34, the developer 5 Nov 2026: "it sometimes takes a few clicks to actually register as a tick") ----------
    // A real press on the left edge of a task's tick, held like a person holds it: the card shrinks and slides under the
    // pointer meanwhile, so the mouse up lands off the tick (WebKit then sends no click: the old miss). It must count
    // once, show at once, slide down to Completed, and one press on it there puts it back. Plus the right click menu.
    let tickRow = "[...document.querySelectorAll('.tm-overlay:not(.tm-docked) .tm-sec-prio .tm-list > .tm-row[data-type=once]')].find(function(r){var t=r.querySelector('.tm-t');return t&&t.textContent!=='Invoice Example Co'})"
    let tickEdge = "(function(){var r=\(tickRow);if(!r)return null;window.__tickId=r.dataset.id;var b=r.querySelector('.tm-tick').getBoundingClientRect();return [b.left+3,b.top+b.height/2]})()"
    let byId = "document.querySelector('.tm-overlay:not(.tm-docked) .tm-list > .tm-row[data-id=\"'+window.__tickId+'\"]')"
    let tickState = "(function(){var r=\(byId);if(!r)return '{}';var s=r.closest('section');return JSON.stringify({c:r.className,s:s?s.className:''})})()"
    let doneTick = "(function(){var r=\(byId);if(!r)return null;var b=r.querySelector('.tm-tick').getBoundingClientRect();return [b.left+b.width/2,b.top+b.height/2]})()"
    let ticks = { a.testRaw.filter { $0.contains("\"type\":\"tick\"") } }
    // React draws the menu a moment after the right click (a microtask), so open, look, then Esc, each in its own step.
    let menuOpen = """
      (function(){var o=document.querySelector('.tm-overlay:not(.tm-docked)'),r=o&&o.querySelector('.tm-sec-prio .tm-list > .tm-row');if(!r)return false;
        var b=r.getBoundingClientRect(),e=new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:b.left+120,clientY:b.top+10,button:2});
        r.querySelector('.tm-text').dispatchEvent(e);return e.defaultPrevented})()
      """
    let menuLook = """
      JSON.stringify((function(){var m=document.querySelector('.tm-ctx'),items=m?[].map.call(m.querySelectorAll('[role=menuitem]'),function(x){return x.getAttribute('data-k')}).join(''):'';
        var bg=new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:4,clientY:4,button:2});document.body.dispatchEvent(bg);
        if(m)(document.activeElement||document.body).dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
        return {menu:!!m,items:items,bg:bg.defaultPrevented};})())
      """
    let menuAfter = "JSON.stringify({closed:!document.querySelector('.tm-ctx'),list:!!document.querySelector('.tm-overlay:not(.tm-docked)')})"
    func tick(_ next: @escaping () -> Void) {
      let t0 = ticks().count
      at(tickEdge) { p in
        guard let p else { r.append(("tick-row-found", false)); next(); return }
        send(.leftMouseDown, p)
        later(0.16) {
          send(.leftMouseUp, p)
          later(0.1) {
            js(tickState) { v in
              let s = obj(v), sent = Array(ticks().dropFirst(t0))
              r.append(("one-press-one-tick", sent.count == 1 && sent.first?.contains("\"done\":true") == true))
              r.append(("ticked-at-once", (s["c"] as? String).map { $0.contains("done") && $0.contains("ticking") } == true))
              later(0.9) {
                js(tickState) { v in
                  r.append(("slides-to-completed", (obj(v)["s"] as? String)?.contains("tm-sec-done") == true))
                  snap(a.overlay, "\(dir)/tick-completed.png") {
                    at(doneTick) { q in
                      guard let q else { r.append(("untick-in-completed", false)); next(); return }
                      send(.leftMouseDown, q); later(0.1) { send(.leftMouseUp, q)
                        later(0.35) {
                          js(tickState) { v in
                            let sent = Array(ticks().dropFirst(t0))
                            r.append(("untick-in-completed", sent.count == 2 && sent.last?.contains("\"done\":false") == true
                              && (obj(v)["s"] as? String)?.contains("tm-sec-prio") == true))
                            js(menuOpen) { native in
                             later(0.35) {
                              js(menuLook) { v in
                               later(0.3) {
                                js(menuAfter) { v2 in
                              let m = obj(v), after = obj(v2)
                              print("TICK MENU: items=\(m["items"] ?? "none") (info)")
                              r.append(("right-click-menu", (m["menu"] as? Bool) == true && (m["items"] as? String) == "edpncx" && (native as? Bool) == true))
                              r.append(("no-browser-menu", (m["bg"] as? Bool) == true))
                              r.append(("esc-closes-menu-only", (after["closed"] as? Bool) == true && (after["list"] as? Bool) == true))
                              let menu = NSMenu()
                              let rl = NSMenuItem(title: "Reload", action: nil, keyEquivalent: ""); rl.identifier = NSUserInterfaceItemIdentifier("WKMenuItemIdentifierReload")
                              menu.addItem(rl); menu.addItem(.separator()); menu.addItem(NSMenuItem(title: "Copy", action: nil, keyEquivalent: ""))
                              NoReload.clean(menu)
                              r.append(("no-reload-item", NoReload.active && menu.items.map { $0.title } == ["Copy"]))
                              next()
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

    // ---------- PIN ----------
    let state = """
      JSON.stringify((function(){var q=function(s){return document.querySelector(s)},win=q('.nu-win'),s=q('.nu-scroll'),raw=null;
        try{raw=localStorage.getItem('ps.pinScreen.v1')}catch(e){}
        return {win:!!(win&&win.isConnected&&win.getClientRects().length), lit:!!q('.nu-head[data-ps-pinned]'), stored:raw||'', scroll:s?s.scrollTop:-1, list:!!q('.tm-overlay:not(.tm-docked) .tm-list')}})())
      """
    var fake: String?   // the fictional list; the signed out test engine may send its locked state over it
    func pin(_ next: @escaping () -> Void) {
      // Fictional people (as NumerologySelfTest), so the window has enough to scroll.
      if let st = a.lastState, var j = try? JSONSerialization.jsonObject(with: Data(st.utf8)) as? [String: Any], var docs = j["docs"] as? [[String: Any]],
         let i = docs.firstIndex(where: { $0["kind"] as? String == "settings" }) {
        var d = docs[i]["data"] as? [String: Any] ?? [:]
        d["tmNumPeople"] = [["id": "me", "name": "Alex", "birthday": "1996-10-11", "me": true], ["id": "np2", "name": "Kit Lane", "birthday": "2003-06-12"]]
        docs[i]["data"] = d; j["docs"] = docs
        a.lastState = (try? JSONSerialization.data(withJSONObject: j)).flatMap { String(data: $0, encoding: .utf8) }
        a.pushState()
      }
      fake = a.lastState
      click(".tm-overlay:not(.tm-docked) .nu-pill") {
        later(1.4) {
          js(state) { v in
            r.append(("numerology-opens", (obj(v)["win"] as? Bool) == true))
            r.append(("open-keeps-list-up-as-before", w.pinned))
            w.mu.lock(); w.state = .showing; w.chordKey = 48; w.mu.unlock()   // as if Tab is still held
            dbl(".nu-head h2") {
              js(state) { v in
                let s = obj(v)
                r.append(("double-click-pins-bar-lit", (s["lit"] as? Bool) == true))
                r.append(("pin-kept-in-storage", (s["stored"] as? String)?.contains("nu-layer|Numerology") == true))
                r.append(("ps-told-list-not-held", a.screenPinned && !w.pinned))
                js("(function(){var s=document.querySelector('.nu-scroll');s.scrollTop=Math.min(260,s.scrollHeight-s.clientHeight-1);return s.scrollTop})()") { top in
                  let want = (top as? NSNumber)?.doubleValue ?? -1
                  r.append(("screen-scrolls", want > 0))
                  if want <= 0 { js("(function(){var s=document.querySelector('.nu-scroll');return s?[s.scrollHeight,s.clientHeight].join('/'):'none'})()") { v in print("PIN scroll sizes:", v ?? "nothing") } }
                  snap(a.overlay, "\(dir)/pin-pinned.png") {
                    _ = w.handle(.keyUp, key(48, false))   // let go of Tab
                    later(0.5) {
                      js(state) { v in
                        r.append(("tab-release-hides-all", !a.shown && (obj(v)["win"] as? Bool) == true))
                        a.showOverlay()                       // the next hold
                        later(0.03) {
                          js(state) { v in
                            let s = obj(v)
                            r.append(("next-hold-shows-it-at-once", a.shown && (s["win"] as? Bool) == true && (s["lit"] as? Bool) == true))
                            r.append(("scroll-kept", ((s["scroll"] as? NSNumber)?.doubleValue ?? -2) == want))
                            later(0.4) { snap(a.overlay, "\(dir)/pin-back.png") { slash(next) } }
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
    func slash(_ next: @escaping () -> Void) {
      a.hideOverlay()
      later(0.4) {
        let was = a.vaultUnlocked
        a.vaultUnlocked = true; w.slashOn = true   // the chord only works signed in
        w.mu.lock(); w.state = .idle; w.appActive = false; w.frontID = nil; w.mu.unlock()
        let swallowed = w.handle(.keyDown, key(SLASH_KEY, true)) == nil && w.handle(.keyDown, key(DOT_KEY, true)) == nil
        a.vaultUnlocked = was
        later(0.15) {
          js(state) { v in
            r.append(("slash-chord-shows-it-at-once", swallowed && a.shown && (obj(v)["win"] as? Bool) == true))
            if !(swallowed && a.shown) { print("PIN slash: swallowed=\(swallowed) shown=\(a.shown) state=\(w.state)") }
            _ = w.handle(.keyUp, key(DOT_KEY, false)); _ = w.handle(.keyUp, key(SLASH_KEY, false))
            later(0.4) {
              r.append(("slash-release-hides-all", !a.shown))
              unpin(next)
            }
          }
        }
      }
    }
    func unpin(_ next: @escaping () -> Void) {
      a.lastState = fake; a.pushState()
      a.showOverlay()
      later(0.4) {
        dbl(".nu-head h2") {
          js(state) { v in
            let s = obj(v)
            r.append(("double-click-again-unpins", (s["lit"] as? Bool) == false && (s["stored"] as? String) == "" && !a.screenPinned))
            if !((s["lit"] as? Bool) == false && !a.screenPinned) { print("PIN unpin state:", v ?? "nothing", "screenPinned=\(a.screenPinned)") }
            a.hideOverlay(force: true)
            later(0.5) {
              a.showOverlay()
              later(0.5) {
                js(state) { v in
                  r.append(("unpinned-closes-as-before", (obj(v)["win"] as? Bool) == false))
                  restart(next)
                }
              }
            }
          }
        }
      }
    }
    func restart(_ next: @escaping () -> Void) {
      click(".tm-overlay:not(.tm-docked) .nu-pill") {
        later(1.4) {
          dbl(".nu-head h2") {
            a.hideOverlay(force: true)
            later(0.4) {
              a.screenPinned = false
              a.lastState = fake
              a.overlay.reload()   // as PS starts: a fresh page, the pin only in local storage
              later(6) {
                js(state) { v in
                  let s = obj(v)
                  r.append(("restart-reopens-it-hidden", !a.shown && (s["win"] as? Bool) == true && (s["lit"] as? Bool) == true))
                  if (s["win"] as? Bool) != true { print("PIN restart state:", v ?? "nothing") }
                  r.append(("restart-tells-ps", a.screenPinned))
                  r.append(("hidden-list-never-took-keyboard", !a.panel.isKeyWindow))
                  a.showOverlay()
                  later(0.03) {
                    js(state) { v in
                      r.append(("restart-then-hold-shows-it-at-once", (obj(v)["win"] as? Bool) == true))
                      later(0.4) {
                        snap(a.overlay, "\(dir)/pin-restored.png") {
                          dbl(".nu-head h2") { a.hideOverlay(force: true); later(0.5, next) }   // unpin, as it was
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

    if !a.shown { a.showOverlay() }
    later(0.8) {
      tap {
       tick {
        pin {
          print("TAP CHECK:", r.filter { ["press-spot-is-card-padding", "row-found", "white-on-mouse-down", "padding-press-counts", "one-work-per-press", "second-press-clears", "slide-is-not-a-click"].contains($0.0) }.map { "\($0.0)=\($0.1 ? "ok" : "FAIL")" }.joined(separator: " "))
          print("TICK CHECK:", r.filter { ["tick-row-found", "one-press-one-tick", "ticked-at-once", "slides-to-completed", "untick-in-completed", "right-click-menu", "no-browser-menu", "esc-closes-menu-only", "no-reload-item"].contains($0.0) }.map { "\($0.0)=\($0.1 ? "ok" : "FAIL")" }.joined(separator: " "))
          print("PIN CHECK:", r.filter { !["press-spot-is-card-padding", "row-found", "white-on-mouse-down", "padding-press-counts", "one-work-per-press", "second-press-clears", "slide-is-not-a-click"].contains($0.0) && !["tick-row-found", "one-press-one-tick", "ticked-at-once", "slides-to-completed", "untick-in-completed", "right-click-menu", "no-browser-menu", "esc-closes-menu-only", "no-reload-item"].contains($0.0) }.map { "\($0.0)=\($0.1 ? "ok" : "FAIL")" }.joined(separator: " "))
          w.testPosted = posted
          a.lastState = keep; a.pushState()
          later(0.6, done)
        }
       }
      }
    }
  }
}
