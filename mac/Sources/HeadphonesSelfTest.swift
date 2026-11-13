// Self test of Headphones mode (Sources/Headphones.swift, web views/Headphones.tsx) on FAKE devices:
// a test copy never reads or changes the real output or microphone. Opens the volume mixer, checks the
// Speakers | Headphones switch is there, clicks Headphones (the fake output and mic move), turns the auto
// switch on (it reaches the Mac and the synced settings), adds headphones to the Headphones list in Devices,
// then unplugs them (back to Speakers, one card) and plugs them in again (Headphones, one card).
import AppKit
import CoreAudio
import WebKit

extension SelfTest {
  static func hpCheck(_ a: App, _ dir: String, _ done: @escaping () -> Void) {
    let hm = HeadphonesMode.shared
    var r: [(String, Bool)] = []
    func later(_ t: Double, _ g: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + t, execute: g) }
    func js(_ s: String, _ g: @escaping (String) -> Void) { a.overlay.evaluateJavaScript(s) { v, _ in g(v.map { "\($0)" } ?? "") } }
    func click(_ sel: String, _ g: @escaping () -> Void) { js("(function(){var e=document.querySelector(\"\(sel)\");if(e){e.click();return true}return false})()") { _ in later(0.8, g) } }
    func clickText(_ sel: String, _ text: String, _ g: @escaping () -> Void) {
      js("(function(){var e=[].filter.call(document.querySelectorAll(\"\(sel)\"),function(b){return b.textContent.trim()===\"\(text)\"})[0];if(e){e.click();return true}return false})()") { _ in later(0.8, g) }
    }
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
    let BT = kAudioDeviceTransportTypeBluetooth, BUILT = kAudioDeviceTransportTypeBuiltIn
    let speakers = HPDev(uid: "BuiltInSpeakerDevice", name: "MacBook Air Speakers", alive: true, transport: BUILT)
    let pods = HPDev(uid: "A0-B1-C2:output", name: "AirPods Max", alive: true, transport: BT)
    let builtMic = HPDev(uid: "BuiltInMicrophoneDevice", name: "MacBook Air Microphone", alive: true, transport: BUILT)
    let podsMic = HPDev(uid: "A0-B1-C2:input", name: "AirPods Max", alive: true, transport: BT)
    let signal = HPDev(uid: "signal-audio", name: "Signal Audio", alive: true, transport: kAudioDeviceTransportTypeUSB)
    let f = FakeHP()
    f.outs = [speakers, pods]; f.ins = [builtMic, podsMic]; f.out = speakers.uid; f.mic = builtMic.uid
    var cards: [String] = []
    hm.announce = { m, ok in cards.append("\(m.rawValue)\(ok ? "" : "!")") }
    hm.settle = 0.3; hm.verifyDelays = [0.2, 0.3, 0.4]
    hm.resetForTest()
    hm.start(testDir: dir, backend: f)
    hm.syncForTest()
    click(".tm-tr .mix-btn") {
      js("JSON.stringify({seg: document.querySelectorAll('.mix-pop .hp-seg button').length, spk: (document.querySelector('.hp-seg button[aria-checked=true]')||{}).textContent||'', auto: (document.querySelector('.hp-row .mix-chip.on')||{}).textContent||'', now: (document.querySelector('.hp-now')||{}).textContent||''})") { s in
        r.append(("switch-in-the-mixer", s.contains("\"seg\":2") && s.contains("\"spk\":\"Speakers\"")))
        r.append(("auto-switch-shown-and-off", s.contains("\"auto\":\"Off\"")))
        r.append(("shows-what-plays-now", s.contains("MacBook Air Speakers")))
        clickText(".hp-seg button", "Headphones") {
          hm.syncForTest()
          later(0.6) {
            r.append(("headphones-click-moves-the-sound", f.out == pods.uid && hm.modeNow == .headphones))
            r.append(("empty-mic-list-leaves-the-mic", f.mic == builtMic.uid))
            r.append(("manual-switch-no-card", cards.isEmpty))
            clickText(".hp-row .mix-chip", "On") {
              hm.syncForTest()
              r.append(("auto-on-reaches-the-mac", hm.prefsNow.auto))
              clickText(".hp-row .mix-b", "Devices") {
                clickText(".hp-tabs .mix-chip", "Headphones mode") {
                  clickText(".hp-sec[data-list=hpOut] .hp-add .mix-chip", "AirPods Max") {
                    clickText(".hp-sec[data-list=hpMic] .hp-add .mix-chip", "MacBook Air Microphone") {
                      hm.syncForTest()
                      js("JSON.stringify({rows: document.querySelectorAll('.hp-sec[data-list=hpOut] .hp-dev').length, active: !!document.querySelector('.hp-sec[data-list=hpOut] .hp-dev.active .hp-badge'), adds: [].map.call(document.querySelectorAll('.hp-add .mix-chip'),function(b){return b.textContent})})") { ui in
                        r.append(("devices-list-add-and-active", ui.contains("\"rows\":1") && ui.contains("\"active\":true")))
                        r.append(("lists-reach-the-mac", hm.prefsNow.hpOut.map(\.uid) == [pods.uid] && hm.prefsNow.hpMic.map(\.uid) == [builtMic.uid]))
                        snapPop("hpmode-devices") {
                          // Unplug: back to Speakers, a card. Plug in: Headphones, a card.
                          f.outs = [speakers]; f.ins = [builtMic]; f.out = speakers.uid; f.changed()
                          later(1.2) {
                            hm.syncForTest()
                            r.append(("auto-unplug-back-to-speakers", hm.modeNow == .speakers && f.out == speakers.uid && cards == ["speakers"]))
                            f.outs = [speakers, pods, signal]; f.ins = [builtMic, podsMic]; f.mic = podsMic.uid; f.changed()
                            later(1.8) {
                              hm.syncForTest()
                              r.append(("auto-plug-in-to-headphones", hm.modeNow == .headphones && f.out == pods.uid && cards == ["speakers", "headphones"]))
                              r.append(("mic-list-used-on-plug-in", f.mic == builtMic.uid))
                              js("(document.querySelector('.mix-pop .hp')||{}).textContent||''") { t in
                                r.append(("hp-switch-state-follows", t.contains("AirPods Max")))
                                r.append(("signal-never-listed", !t.contains("Signal")))
                                snapPop("hpmode-switch") {
                                  click(".tm-tr .mix-btn") {                            // close
                                    hm.handle(["op": "prefs", "prefs": ["auto": false]]); hm.syncForTest()
                                    print("HPMODE CHECK:", r.map { "\($0.0)=\($0.1 ? "ok" : "FAIL")" }.joined(separator: " "), "cards=\(cards.joined(separator: ","))")
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
