// Self test of the volume mixer (Sources/Mixer.swift, views/Mixer.tsx) on a FAKE Mac: fake apps,
// fake devices and fake taps (a test copy never lists, taps or meters real audio). Checks the rows
// and their grouping, the protected apps never listed, the permission explanation before the first
// tap, a slider changing the gain, mute, levels kept after a restart, the gain and limiter on fake
// samples (no clicks), keeping an app out of a recording through a fake virtual device, the hints,
// protected audio left untouched, the mixer's own gear settings, and Mute living in the gear menu.
import AppKit
import CoreAudio
import WebKit

extension SelfTest {
  static func mixCheck(_ a: App, _ dir: String, _ done: @escaping () -> Void) {
    let mx = Mixer.shared
    guard let f = mx.fake else { print("MIXER CHECK: FAIL no fake backend"); done(); return }
    var r: [(String, Bool)] = []
    func later(_ t: Double, _ g: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + t, execute: g) }
    func js(_ s: String, _ g: @escaping (String) -> Void) { a.overlay.evaluateJavaScript(s) { v, _ in g(v.map { "\($0)" } ?? "") } }
    let blue = kAudioDeviceTransportTypeBluetooth, virt = kAudioDeviceTransportTypeVirtual, aggr = kAudioDeviceTransportTypeAggregate
    f.devices = [MixDevice(id: 83, uid: "airpods", name: "AirPods Max", transport: blue, subUIDs: []),
                 MixDevice(id: 71, uid: "speakers", name: "MacBook Air Speakers", transport: kAudioDeviceTransportTypeBuiltIn, subUIDs: []),
                 MixDevice(id: 90, uid: "blackhole", name: "BlackHole 2ch", transport: virt, subUIDs: []),
                 MixDevice(id: 91, uid: "multi", name: "OBS Multi-Output", transport: aggr, subUIDs: ["blackhole", "airpods"])]
    f.defaultUID = "airpods"
    func app(_ pid: pid_t, _ b: String, _ n: String, regular: Bool = true) -> MixApp { MixApp(pid: pid, bundle: b, name: n, regular: regular) }
    let spotify = app(2403, "com.spotify.client", "Spotify"), brave = app(10201, "com.brave.Browser", "Brave Browser"), brave2 = app(20000, "com.brave.Browser", "Brave Browser")
    let ddg = app(46385, "com.duckduckgo.macos.browser", "DuckDuckGo"), signal = app(777, "org.whispersystems.signal-desktop", "Signal"), op = app(888, "com.1password.1password", "1Password")
    let ps = app(28714, "com.cincee.ps", "PS"), daemon = app(343, "com.apple.mediaremoted", "mediaremoted", regular: false)
    f.procs = [MixProc(object: 116, pid: 2403, bundle: "com.spotify.client", playing: true), MixProc(object: 117, pid: 2978, bundle: "com.spotify.client.helper", playing: false),
               MixProc(object: 118, pid: 10201, bundle: "com.brave.Browser", playing: false), MixProc(object: 119, pid: 10297, bundle: "com.brave.Browser.helper", playing: true),
               MixProc(object: 150, pid: 20000, bundle: "com.brave.Browser", playing: false), MixProc(object: 151, pid: 20001, bundle: "com.brave.Browser.helper", playing: true),
               MixProc(object: 129, pid: 46385, bundle: "com.duckduckgo.macos.browser", playing: false), MixProc(object: 128, pid: 46395, bundle: "com.apple.WebKit.GPU", playing: true),
               MixProc(object: 160, pid: 777, bundle: "org.whispersystems.signal-desktop", playing: true), MixProc(object: 161, pid: 778, bundle: "org.whispersystems.signal-desktop.helper", playing: true),
               MixProc(object: 162, pid: 779, bundle: "com.apple.WebKit.GPU", playing: true),                    // a WebKit process Signal started
               MixProc(object: 170, pid: 888, bundle: "com.1password.1password", playing: true),
               MixProc(object: 140, pid: 28714, bundle: "com.cincee.ps", playing: true), MixProc(object: 102, pid: 343, bundle: "com.apple.mediaremoted", playing: false)]
    f.apps = [2403: spotify, 2978: spotify, 10201: brave, 10297: brave, 20000: brave2, 20001: brave2, 46385: ddg, 46395: ddg,
              777: signal, 778: signal, 779: signal, 888: op, 28714: ps, 343: daemon]
    f.tags = [20000: "BraveMeet"]
    f.changed(); mx.syncForTest()
    let keys = Set(mx.rowKeys)
    r.append(("rows-for-apps-making-sound", keys == ["com.spotify.client", "com.brave.Browser", "com.brave.Browser|BraveMeet", "com.duckduckgo.macos.browser"]))
    r.append(("protected-never-listed", !keys.contains { Protected.matches($0) || $0.contains("cincee") || $0.contains("mediaremoted") }))
    r.append(("helpers-grouped", mx.groupObjects("com.brave.Browser") == [118, 119] && mx.groupObjects("com.duckduckgo.macos.browser") == [128, 129]
              && mx.groupObjects("com.spotify.client") == [116, 117] && mx.groupObjects("com.brave.Browser|BraveMeet") == [150, 151]))
    // The limiter and the ramp on fake samples (the same code the real audio thread runs).
    let out = UnsafeMutablePointer<Float>.allocate(capacity: 1024)
    defer { out.deallocate() }
    let v = MixVoice(gain: 0.1)
    FakeMix.feed(v, silent: false, times: 1, out: out)
    var jump: Float = 0; for i in 1..<1024 { jump = max(jump, abs(out[i] - out[i - 1])) }        // the first buffer ramps in from silence
    FakeMix.feed(v, silent: false, times: 1, out: out)
    var pk: Float = 0; for i in 0..<1024 { pk = max(pk, abs(out[i])) }
    r.append(("gain-applies-without-clicks", abs(pk - 0.05) < 0.003 && jump < 0.02))
    v.setGain(0); FakeMix.feed(v, silent: false, times: 2, out: out)
    var mk: Float = 0; for i in 0..<1024 { mk = max(mk, abs(out[i])) }
    v.setGain(1.5); FakeMix.feed(v, silent: false, times: 2, out: out)
    var bk: Float = 0; for i in 0..<1024 { bk = max(bk, abs(out[i])) }
    r.append(("mute-is-silent-and-boost-is-limited", mk == 0 && bk > 0.7 && bk <= 1.0))

    let row = { (k: String) in "document.querySelector('.mix-row[data-key=\"\(k)\"]')" }
    func setRange(_ k: String, _ val: Int, _ g: @escaping () -> Void) {
      js("(function(){var e=\(row(k)).querySelector('.mix-range');var s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(e,'\(val)');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));return true})()") { _ in later(0.6, g) }
    }
    func click(_ sel: String, _ g: @escaping () -> Void) { js("(function(){var e=document.querySelector(\"\(sel)\");if(e){e.click();return true}return false})()") { _ in later(0.6, g) } }
    func snapMixer(_ name: String, _ g: @escaping () -> Void) {
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
    // The Tab list: the mixer button where the speaker was; Mute in the gear's Settings (V1.32: a full screen,
    // so it is opened, read and closed again first).
    func gearMute(_ g: @escaping (String) -> Void) {
      js("(function(){var b=document.querySelector('.tm-tr button[aria-label=Settings]');if(b&&!document.querySelector('.gs-win'))b.click();return 1})()") { _ in
        later(1.0) {
          js("(document.querySelector('.gs-win .tm-mute-btn')||{}).textContent||''") { m in
            js("(window.__psDimxClose&&window.__psDimxClose(),1)") { _ in later(1.0) { g(m) } }
          }
        }
      }
    }
    gearMute { mute in
    js("JSON.stringify({mixer: !!document.querySelector('.tm-tr .mix-btn'), speaker: !!document.querySelector('.tm-tr button[aria-label^=\"Sounds\"]')})") { s in
      r.append(("mixer-button-replaces-speaker", s.contains("\"mixer\":true") && s.contains("\"speaker\":false")))
      r.append(("mute-button-in-gear-menu", mute == "Mute" || mute == "Unmute"))
      click(".tm-tr .mix-btn") {
        js("JSON.stringify([].map.call(document.querySelectorAll('.mix-row:not(.master) .mix-name'),function(e){return e.textContent}))") { names in
          r.append(("rows-show-in-the-pop-up", names.contains("Spotify") && names.contains("Brave Browser (BraveMeet)") && names.contains("DuckDuckGo") && !names.contains("Signal") && !names.contains("1Password")))
          // First slider move: the explanation first, nothing tapped yet.
          setRange("com.spotify.client", 10) {
            js("!!document.querySelector('.mix-ask')") { ask in
              r.append(("asks-with-explanation-before-tapping", ask == "1" && f.started.isEmpty && mx.level("com.spotify.client")?.gain == 0.1 && mx.permissionNow != "ok"))
              snapMixer("mixer-ask") {
                click(".mix-ask .mix-b") {                                     // Continue: macOS's question (fake: yes)
                  mx.syncForTest()
                  let t1 = f.started.last
                  r.append(("slider-changes-gain", mx.permissionNow == "ok" && t1?.objects == [116, 117] && t1?.device == "airpods" && mx.voice("com.spotify.client")?.gain == 0.1))
                  click(".mix-row[data-key='com.spotify.client'] .mix-b") {    // Mute
                    r.append(("mute", mx.level("com.spotify.client")?.muted == true && mx.voice("com.spotify.client")?.gain == 0))
                    click(".mix-row[data-key='com.spotify.client'] .mix-b") {  // Unmute
                      // Keep out of recordings: the default output is a multi-output with BlackHole in it.
                      f.defaultUID = "multi"; f.changed(); mx.syncForTest()
                      click(".mix-row[data-key='com.brave.Browser'] .mix-b.hide") {
                        mx.syncForTest()
                        let devs = mx.tapDevices
                        r.append(("kept-out-goes-to-the-real-device", devs["com.brave.Browser"] == "airpods" && devs["com.spotify.client"] == "multi"))
                        f.running = ["com.obsproject.obs-studio"]
                        let h = mx.hintsNow
                        r.append(("hints-say-what-a-recording-hears", h.contains { $0.contains("Recording through BlackHole 2ch") && $0.contains("AirPods Max") } && h.contains { $0.hasPrefix("OBS:") }))
                        // Protected audio: silent while playing, so it is left untouched.
                        f.silent = [128]
                        setRange("com.duckduckgo.macos.browser", 50) {
                          later(4.6) {
                            mx.tickForTest()
                            r.append(("protected-audio-left-untouched", mx.cantAdjust("com.duckduckgo.macos.browser") && mx.voice("com.duckduckgo.macos.browser") == nil
                                      && (f.started.last { $0.objects == [128, 129] }?.stopped ?? false)))
                            // The AirPods change sample rate: Spotify's tap is rebuilt for it.
                            let before = f.started.count
                            f.rates["multi"] = 44100; mx.tickForTest()
                            r.append(("sample-rate-change-rebuilds", f.started.count > before && (f.started.last { $0.objects == [116, 117] }?.stopped == false)))
                            // Signal can never be adjusted, even when asked directly.
                            mx.handle(["op": "gain", "key": "org.whispersystems.signal-desktop", "value": 0.2]); mx.syncForTest()
                            r.append(("signal-never-touched", mx.level("org.whispersystems.signal-desktop") == nil && !f.started.contains { $0.objects.contains(160) || $0.objects.contains(162) }))
                            later(1.2) {
                              snapMixer("mixer") {
                                // PS 1.65: one look, no gear. The levels are kept across a restart.
                                js("JSON.stringify({gear: document.querySelectorAll('.mix-gear-btn, .mix-gear').length, seg: document.querySelectorAll('.hp-seg').length})") { ui in
                                  r.append(("one-look-no-gear-no-mode-switch", ui.contains("\"gear\":0") && ui.contains("\"seg\":0")))
                                  mx.reloadForTest()                                   // a restart: levels come back
                                  r.append(("levels-persist", mx.level("com.spotify.client")?.gain == 0.1 && mx.level("com.brave.Browser")?.hide == true))
                                  click(".tm-tr .mix-btn") {                            // close
                                    onlyWhilePlaying(mx, f) { more in
                                      r += more
                                      print("MIXER CHECK:", r.map { "\($0.0)=\($0.1 ? "ok" : "FAIL")" }.joined(separator: " "), "taps=\(f.started.count)")
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

  /// 4 Nov 2026: a tap runs only while its app plays (else its IO keeps the Mac awake all night).
  /// Spotify at 10%: quiet, its tap stays a moment then stops; nothing runs while it is idle; it
  /// plays again and the tap is back at once with the same level.
  static func onlyWhilePlaying(_ mx: Mixer, _ f: FakeMix, _ done: @escaping ([(String, Bool)]) -> Void) {
    var r: [(String, Bool)] = []
    func later(_ t: Double, _ g: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + t, execute: g) }
    func spotify(playing: Bool) {
      f.procs = f.procs.map { p in p.bundle.hasPrefix("com.spotify.client") ? MixProc(object: p.object, pid: p.pid, bundle: p.bundle, playing: playing && p.object == 116) : p }
      f.changed(); mx.syncForTest()
    }
    let keepHold = mx.quietHold
    mx.quietHold = 1.0
    mx.syncForTest()
    let tapped = mx.voice("com.spotify.client") != nil
    r.append(("listens-only-to-adjusted-apps", f.watched.contains(116) && !f.watched.contains(160) && !f.watched.contains(162) && !f.watched.contains(170) && !f.watched.contains(140)))
    spotify(playing: false)
    later(0.4) {
      mx.tickForTest()
      let kept = mx.voice("com.spotify.client") != nil                  // a pause between songs keeps it
      later(1.0) {
        mx.tickForTest()
        let stopped = mx.voice("com.spotify.client") == nil && (f.started.last { $0.objects == [116, 117] }?.stopped ?? false)
        r.append(("tap-stays-briefly-then-stops-after-quiet", tapped && kept && stopped))
        let count = f.started.count
        later(1.5) {
          mx.tickForTest(); mx.tickForTest()
          r.append(("no-tap-while-idle", f.started.count == count && mx.voice("com.spotify.client") == nil && mx.tapDevices["com.spotify.client"] == nil))
          r.append(("level-kept-while-idle", mx.level("com.spotify.client")?.gain == 0.1))
          spotify(playing: true)                                       // the process listener fires: tap at once
          let t = f.started.last
          r.append(("tap-starts-when-playing", f.started.count == count + 1 && t?.objects == [116, 117] && t?.stopped == false && mx.voice("com.spotify.client")?.gain == 0.1))
          mx.quietHold = keepHold
          done(r)
        }
      }
    }
  }
}
