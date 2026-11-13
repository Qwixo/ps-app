import AppKit
import WebKit

// Minecraft mode switched off (V1.32, MinecraftSwitch.swift and web src/core/mcmode.ts). PS_SELFTEST_ONLY=mcoff
// checks that every way in is gone: no pickaxe or Minecraft button anywhere on the Tab list, no pop up and no bubble on
// the page, nothing in the gear's Settings, no window.__psOpenMinecraft for PS to call, and the bridge does nothing:
// "mc", "power:get" and "torch:open" from the page get no answer and open nothing. Native: the power watch never
// started and no translator helper runs. The areas minecraft, torch and power print "skipped" while it is off.
extension SelfTest {
  /// An area that belongs to Minecraft mode, while it is off: nothing to test, the guards still report.
  static func mcSkipped(_ a: App, _ area: String) {
    DispatchQueue.main.asyncAfter(deadline: .now() + 6) {
      print("\(area.uppercased()) AREA: skipped, Minecraft mode is off (MinecraftSwitch.swift); PS_SELFTEST_ONLY=mcoff checks it is gone")
      print(ScreenGuard.report()); print(NetGuard.report()); print("DONE"); exit(0)
    }
  }

  static func minecraftOffCheck(_ a: App, _ dir: String, _ done: @escaping () -> Void) {
    var r: [(String, Bool)] = [("switch-is-off", !MINECRAFT_ENABLED)]
    a.showOverlay()
    let js = """
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const R = {};
    const any = (q) => document.querySelectorAll(q).length;
    R.noButton = any('.mcw-btn, .mcw-entry, .tm-overlay [aria-label*="Minecraft"], .tm-overlay [title*="Minecraft"]') === 0;
    R.noPopup = any('.mcw-full, .mcw-bubble, .mcw-bubble-layer, .mcw-stage') === 0;
    R.noHook = typeof window.__psOpenMinecraft === 'undefined';
    // The gear's full screen Settings, every tab: no Minecraft mode in it.
    const gear = document.querySelector('.tm-tr button[aria-label=Settings]');
    if (gear && !document.querySelector('.gs-win')) { gear.click(); await sleep(900); }
    let words = '', found = 0;
    for (const t of document.querySelectorAll('.gs-win [role=tab]')) { t.click(); await sleep(500); const w = document.querySelector('.gs-win'); words += w ? w.innerText : ''; found += any('.gs-win .mcw-entry, .gs-win .mcw-entry-ico'); }
    R.settingsOpened = !!document.querySelector('.gs-win');
    R.notInSettings = R.settingsOpened && found === 0 && !/minecraft/i.test(words);
    window.__psDimxClose && window.__psDimxClose(); await sleep(900);
    // The bridge: messages the old pieces sent get no answer and open nothing.
    window.__mcGot = [];
    window.__psMc = () => window.__mcGot.push('mc');
    window.__psPower = () => window.__mcGot.push('power');
    window.__psTorch = () => window.__mcGot.push('torch');
    const post = (o) => window.webkit.messageHandlers.ps.postMessage(JSON.stringify(o));
    post({ type: 'mc', op: 'status' }); post({ type: 'mc', op: 'lexicon' }); post({ type: 'power:get' }); post({ type: 'torch:open', color: '#ffffff', bright: false }); post({ type: 'torch:state' });
    await sleep(1500);
    R.noAnswers = window.__mcGot.length === 0;
    R.got = window.__mcGot.join(',');
    return JSON.stringify(R);
    """
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
      a.overlay.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { res in
        let s = ((try? res.get()) as? String) ?? "error \(res)"
        print("MINECRAFT OFF PAGE:", s)
        r.append(("no-pickaxe-or-entry-on-the-list", s.contains("\"noButton\":true")))
        r.append(("no-popup-and-no-bubble", s.contains("\"noPopup\":true")))
        r.append(("no-open-hook-for-ps", s.contains("\"noHook\":true")))
        r.append(("not-in-settings", s.contains("\"notInSettings\":true")))
        r.append(("bridge-answers-nothing", s.contains("\"noAnswers\":true")))
        r.append(("torch-never-opens", !TorchLight.shared.open))
        r.append(("power-watch-never-started", !PowerWatch.shared.isStarted))
        // No translator helper child of this PS (the live PS's own one, if any, is not ours).
        let p = Process(), out = Pipe()
        p.executableURL = URL(fileURLWithPath: "/bin/ps"); p.arguments = ["-axo", "ppid=,comm="]; p.standardOutput = out
        try? p.run(); p.waitUntilExit()
        let me = ProcessInfo.processInfo.processIdentifier
        let kids = (String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? "").split(separator: "\n")
          .filter { Int32($0.trimmingCharacters(in: .whitespaces).split(separator: " ").first ?? "") == me }
        r.append(("no-translator-helper-running", !kids.contains { $0.hasSuffix("PSTranslate") }))
        snap(a.overlay, "\(dir)/mc-off-tab-list.png") {
          print("MINECRAFT OFF CHECK:", r.map { "\($0.0)=\($0.1 ? "ok" : "FAIL")" }.joined(separator: " "))
          done()
        }
      }
    }
  }
}
