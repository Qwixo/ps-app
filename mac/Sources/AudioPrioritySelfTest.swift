// Self test of Audio priority (Sources/AudioPriority.swift, web views/AudioPriority.tsx, PS 1.65) on a FAKE Mac: a test
// copy never reads or changes the real output or microphone. Opens the volume mixer and checks: the two lists are there
// in order (AirPods in both), no Speakers | Headphones switch and no gear; a connect switches to the top device; a drag
// in the page reorders and the new top is used at once; a click on a connected row uses it and holds it; a remembered
// row shows "not connected" and Forget removes it; Signal is never listed; Esc closes the mixer. Kept as hpCheck, the
// name the self test chain in main.swift calls.
import AppKit
import WebKit

extension SelfTest {
  static func hpCheck(_ a: App, _ dir: String, _ done: @escaping () -> Void) {
    let ap = AudioPriority.shared
    var r: [(String, Bool)] = []
    func later(_ t: Double, _ g: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + t, execute: g) }
    func js(_ s: String, _ g: @escaping (String) -> Void) { a.overlay.evaluateJavaScript(s) { v, _ in g(v.map { "\($0)" } ?? "") } }
    func click(_ sel: String, _ g: @escaping () -> Void) { js("(function(){var e=document.querySelector(\"\(sel)\");if(e){e.click();return true}return false})()") { _ in later(0.8, g) } }
    func snapPop(_ name: String, _ g: @escaping () -> Void) {
      a.overlay.evaluateJavaScript("(function(){var e=document.querySelector('.mix-pop');if(!e)return null;var r=e.getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()") { v, _ in
        guard let c = v as? [NSNumber], c.count == 4 else { g(); return }
        let cfg = WKSnapshotConfiguration(); cfg.rect = CGRect(x: c[0].doubleValue - 8, y: c[1].doubleValue - 8, width: c[2].doubleValue + 16, height: c[3].doubleValue + 16)
        a.overlay.takeSnapshot(with: cfg) { img, _ in
          if let img, let t = img.tiffRepresentation, let rep = NSBitmapImageRep(data: t), let png = rep.representation(using: .png, properties: [:]) {
            try? png.write(to: URL(fileURLWithPath: "\(dir)/\(name).png")); print("saved \(dir)/\(name).png")
          }
          g()
        }
      }
    }
    // A drag in the page: pointer events on a row, down, move by `rows` rows, up (the view's own handlers run).
    func dragRow(_ side: String, _ index: Int, by rows: Int, _ g: @escaping () -> Void) {
      js("""
      (function(){var l=document.querySelectorAll('.ap-sec[data-side=\(side)] .ap-row');var e=l[\(index)];if(!e)return false;
      var b=e.getBoundingClientRect(),p=(l[1]?l[1].getBoundingClientRect().top-l[0].getBoundingClientRect().top:38),x=b.left+20,y=b.top+b.height/2;
      function ev(t,yy){e.dispatchEvent(new PointerEvent(t,{bubbles:true,pointerId:7,button:0,buttons:1,clientX:x,clientY:yy}))}
      ev('pointerdown',y);for(var i=1;i<=8;i++)ev('pointermove',y+p*\(rows)*i/8);ev('pointerup',y+p*\(rows));return true})()
      """) { _ in later(1.2, g) }
    }
    let mac = APDevice(uid: "BuiltInSpeakerDevice", name: "MacBook Air Speakers", kind: .builtIn, alive: true)
    let pods = APDevice(uid: "A0-B1-C2:output", name: "AirPods Max", kind: .bluetooth, alive: true)
    let jbl = APDevice(uid: "C0-D1:output", name: "JBL Flip 6", kind: .bluetooth, alive: true)
    let macMic = APDevice(uid: "BuiltInMicrophoneDevice", name: "MacBook Air Microphone", kind: .builtIn, alive: true)
    let podsMic = APDevice(uid: "A0-B1-C2:input", name: "AirPods Max", kind: .bluetooth, alive: true)
    let signal = APDevice(uid: "signal-audio", name: "Signal Audio", kind: .usb, alive: true)
    let f = FakeAP()
    f.outs = [mac, jbl]; f.ins = [macMic]; f.out = mac.uid; f.mic = macMic.uid
    ap.debounce = 0.1; ap.settle = 0.2; ap.verifyDelays = [0.1, 0.2, 0.3]
    ap.resetForTest()
    ap.start(testDir: dir, backend: f)
    later(1.0) {
      ap.syncForTest()
      r.append(("launch-uses-the-top-connected", f.out == jbl.uid && f.mic == macMic.uid))
      click(".tm-tr .mix-btn") {
        js("JSON.stringify({spk: [].map.call(document.querySelectorAll('.ap-sec[data-side=speakers] .ap-nm'),function(e){return e.textContent}), seg: document.querySelectorAll('.hp-seg, .mix-gear-btn').length, using: (document.querySelector('.ap-sec[data-side=speakers] .ap-row.using .ap-nm')||{}).textContent||''})") { s in
          r.append(("two-lists-in-the-mixer", s.contains("JBL Flip 6") && s.contains("MacBook Air Speakers")))
          r.append(("no-mode-switch-no-gear", s.contains("\"seg\":0")))
          r.append(("in-use-shown", s.contains("\"using\":\"JBL Flip 6\"")))
          // AirPods connect: in both lists, above the Mac's speakers, below the Mac's own microphone.
          f.outs = [mac, jbl, pods, signal]; f.ins = [macMic, podsMic]; f.fire()
          later(1.2) {
            ap.syncForTest()
            let l = ap.listsNow
            r.append(("airpods-in-both-lists", l.speakers.contains { $0.uid == pods.uid } && l.mics.last?.uid == podsMic.uid))
            r.append(("signal-never-listed", !l.speakers.contains { $0.uid == signal.uid }))
            snapPop("audio-priority") {
              // Drag the Mac speakers (3rd) to the top: used at once.
              let i = l.speakers.firstIndex { $0.uid == mac.uid } ?? 2
              dragRow("speakers", i, by: -i) {
                ap.syncForTest()
                r.append(("drag-reorders-and-applies", ap.listsNow.speakers.first?.uid == mac.uid && f.out == mac.uid))
                // A click on the JBL: used now, held.
                js("(function(){var e=[].filter.call(document.querySelectorAll('.ap-sec[data-side=speakers] .ap-row'),function(x){return x.dataset.uid==='\(jbl.uid)'})[0];if(!e)return false;var b=e.getBoundingClientRect();['pointerdown','pointerup'].forEach(function(t){e.dispatchEvent(new PointerEvent(t,{bubbles:true,pointerId:8,button:0,clientX:b.left+40,clientY:b.top+10}))});return true})()") { _ in
                  later(1.0) {
                    ap.syncForTest()
                    r.append(("click-uses-and-holds", f.out == jbl.uid && ap.holdNow(.speakers)?.uid == jbl.uid))
                    // The JBL goes away: remembered, dimmed, not connected; Forget removes it.
                    f.outs = [mac, pods]; f.fire()
                    later(1.0) {
                      js("JSON.stringify({gone: !!document.querySelector('.ap-row.gone[data-uid=\"\(jbl.uid)\"] em'), x: !!document.querySelector('.ap-row.gone[data-uid=\"\(jbl.uid)\"] .ap-x')})") { g in
                        r.append(("remembered-shows-not-connected", g.contains("\"gone\":true") && g.contains("\"x\":true")))
                        snapPop("audio-priority-remembered") {
                          click(".ap-row.gone[data-uid=\\\"\(jbl.uid)\\\"] .ap-x") {
                            ap.syncForTest()
                            r.append(("forget-removes-it", !ap.listsNow.speakers.contains { $0.uid == jbl.uid }))
                            js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));true") { _ in
                              later(0.6) {
                                js("!!document.querySelector('.mix-pop')") { open in
                                  r.append(("esc-closes", open == "0" || open == "false"))
                                  print("AUDIOPRIO CHECK:", r.map { "\($0.0)=\($0.1 ? "ok" : "FAIL")" }.joined(separator: " "))
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
