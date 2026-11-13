import AppKit
import WebKit

// Self test for Minecraft mode (Sources/Minecraft.swift, web src/views/Minecraft.tsx). PS_SELFTEST_ONLY=minecraft.
// No network at all: the download runs on file:// copies made here (one good pack, one with a wrong fingerprint),
// the translator helper is started against an empty folder (it must answer "fail", proving the binary runs and the
// failure reaches the page), the screenshot reader reads a picture drawn here. The pop up: opened from the pickaxe,
// covers the screen, Latin Georgian read on the page, Minimise to the bubble (the big layer hidden and click
// through), a real press on the bubble brings it back with the typed text, Esc minimises and keeps the text.
// (The torch, scene and power clock have their own areas: torch, power.) Pictures: mc-panel.png, mc-latin.png,
// mc-bubble.png.
extension SelfTest {
  static func minecraftCheck(_ a: App, _ dir: String, _ done: @escaping () -> Void) {
    var r: [(String, Bool)] = []
    let mc = MinecraftMode.shared
    let fm = FileManager.default
    func later(_ s: Double, _ f: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + s, execute: f) }
    func js(_ s: String, _ f: @escaping (Any?) -> Void) { a.overlay.evaluateJavaScript(s) { v, _ in f(v) } }
    func wait(_ what: @escaping () -> Bool, _ limit: Double, _ f: @escaping (Bool) -> Void) {
      let t0 = Date()
      func poll() { if what() { f(true) } else if Date().timeIntervalSince(t0) > limit { f(false) } else { later(0.1, poll) } }
      poll()
    }
    func state() -> String { mc.q.sync { mc.state } }
    print("MINECRAFT: test folder", dir)

    // ---------- the download, from file:// copies ----------
    let src = URL(fileURLWithPath: dir).appendingPathComponent("mc-src")
    try? fm.createDirectory(at: src, withIntermediateDirectories: true)
    var files: [MCFile] = []
    for (name, size) in [("config.json", 300), ("sentencepiece.bpe.model", 40_000), ("model.bin", 3_000_000)] {
      var d = Data(count: size); for i in 0..<size { d[i] = UInt8((i * 31 + name.count) & 255) }
      let u = src.appendingPathComponent(name); try? d.write(to: u)
      files.append(MCFile(name: name, url: u.absoluteString, size: Int64(size), sha256: mc.sha256(of: u) ?? ""))
    }
    let good = MCPack(id: "test-pack", title: "Test pack", files: files)
    var bad = files; bad[1] = MCFile(name: bad[1].name, url: bad[1].url, size: bad[1].size, sha256: String(repeating: "0", count: 64))
    let badPack = MCPack(id: "test-bad", title: "Test bad", files: bad)

    mc.useTestPack(badPack)
    mc.handle(["op": "download"])
    wait({ state() == "error" }, 20) { _ in
      let err = mc.q.sync { mc.error ?? "" }
      r.append(("bad-fingerprint-refused", state() == "error" && err.contains("fingerprint")))
      r.append(("bad-file-thrown-away", !fm.fileExists(atPath: mc.stagingDir.appendingPathComponent("sentencepiece.bpe.model").path)))
      r.append(("bad-pack-never-ready", !mc.isReady() && !fm.fileExists(atPath: mc.modelDir.path)))
      mc.useTestPack(good)
      mc.handle(["op": "download"])
      wait({ state() == "ready" }, 30) { _ in
        r.append(("download-ready", state() == "ready" && mc.isReady()))
        r.append(("files-in-place", files.allSatisfy { fm.fileExists(atPath: mc.modelDir.appendingPathComponent($0.name).path) }))
        r.append(("staging-gone", !fm.fileExists(atPath: mc.stagingDir.path)))
        r.append(("under-test-folder", mc.modelDir.path.hasPrefix(dir)))
        // A file that later shrinks (disk trouble) is noticed without hashing again.
        let mb = mc.modelDir.appendingPathComponent("model.bin")
        let keep = try? Data(contentsOf: mb)
        try? Data([1, 2, 3]).write(to: mb)
        r.append(("damaged-model-not-ready", !mc.isReady()))
        try? keep?.write(to: mb)
        r.append(("model-ready-again", mc.isReady()))
        engine()
      }
    }

    // ---------- the translator helper ----------
    func engine() {
      let exe = mc.helperPath ?? ""
      r.append(("helper-inside-app", fm.isExecutableFile(atPath: exe) && exe.hasPrefix(Bundle.main.bundlePath)))
      // The test pack's model.bin is not a model: the helper must start, say so, and the page must hear it.
      var got: [String] = []
      let keep = mc.deliver
      mc.deliver = { s in got.append(s); keep?(s) }
      MCEngine.shared.translate(id: "t1", src: "kat_Geor", tgt: "eng_Latn", text: "გამარჯობა")
      wait({ got.contains { $0.contains("\"translated\"") && $0.contains("t1") } }, 20) { _ in
        let ans = got.first { $0.contains("\"translated\"") && $0.contains("t1") } ?? ""
        r.append(("helper-runs-and-reports-a-bad-model", ans.contains("\"ok\":false") && ans.contains("could not be loaded")))
        MCEngine.shared.translate(id: "t2", src: "xxx_Latn", tgt: "eng_Latn", text: "hi")
        wait({ got.contains { $0.contains("t2") } }, 5) { _ in
          r.append(("unknown-language-refused", got.contains { $0.contains("t2") && $0.contains("Unknown language") }))
          mc.deliver = keep
          ocr()
        }
      }
    }

    // ---------- reading a screenshot ----------
    func ocr() {
      let img = NSImage(size: NSSize(width: 900, height: 260))
      img.lockFocus()
      NSColor.white.setFill(); NSRect(x: 0, y: 0, width: 900, height: 260).fill()
      let at: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 40), .foregroundColor: NSColor.black]
      ("100 tsuti - 4 lari," as NSString).draw(at: NSPoint(x: 30, y: 170), withAttributes: at)
      ("vada - 30 dghe." as NSString).draw(at: NSPoint(x: 30, y: 100), withAttributes: at)
      ("Привет, как дела?" as NSString).draw(at: NSPoint(x: 30, y: 30), withAttributes: at)
      img.unlockFocus()
      let png = NSBitmapImageRep(data: img.tiffRepresentation!)!.representation(using: .png, properties: [:])!
      var got: [String] = []
      let keep = mc.deliver
      mc.deliver = { s in got.append(s); keep?(s) }
      mc.handle(["op": "ocr", "id": "o1", "image": "data:image/png;base64," + png.base64EncodedString()])
      // Vision's first use after the Mac starts takes about a minute (it loads its model), then 0.1 s.
      wait({ got.contains { $0.contains("\"ocr\"") } }, 90) { _ in
        let o = (got.first { $0.contains("\"ocr\"") }).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] } ?? [:]
        let text = o["text"] as? String ?? ""
        print("MINECRAFT OCR:", text.replacingOccurrences(of: "\n", with: " / "))
        r.append(("ocr-latin-georgian", text.contains("tsuti") && text.contains("lari") && text.contains("dghe")))
        r.append(("ocr-russian", text.contains("Привет")))
        // Lines that run on inside one message join; a new message starts a new line.
        let j = MinecraftMode.joinLines([("shedzenili erteulebi vadis", CGRect(x: 0.1, y: 0.8, width: 0.6, height: 0.04)),
                                         ("gasvlis shemdeg.", CGRect(x: 0.1, y: 0.755, width: 0.3, height: 0.04)),
                                         ("akhali paketis", CGRect(x: 0.1, y: 0.7, width: 0.3, height: 0.04)),
                                         ("13:50", CGRect(x: 0.1, y: 0.5, width: 0.1, height: 0.03))])
        r.append(("ocr-joins-wrapped-lines", j == "shedzenili erteulebi vadis gasvlis shemdeg.\nakhali paketis\n\n13:50"))
        if j != "shedzenili erteulebi vadis gasvlis shemdeg.\nakhali paketis\n\n13:50" { print("MINECRAFT joinLines got:", j.debugDescription) }
        // A request that is not a picture is refused, never crashes.
        mc.handle(["op": "ocr", "id": "o2", "image": "data:image/png;base64,AAAA"])
        wait({ got.contains { $0.contains("o2") } }, 10) { _ in
          r.append(("ocr-not-a-picture-refused", got.contains { $0.contains("o2") && $0.contains("\"ok\":false") }))
          mc.deliver = keep
          panel()
        }
      }
    }

    // ---------- the pop up in the Tab list ----------
    func panel() {
      a.showOverlay()
      later(1.0) {
        // V1.32 (the developer: "I don't want the pickaxe to be anywhere on my main screen"): no pickaxe on the list; it opens from
        // the gear's full screen Settings, General, Minecraft mode. Settings goes away, the pop up grows out of the gear.
        js("(function(){var p=document.querySelectorAll('.tm-overlay .mcw-btn, .tm-tr .mcw-entry, .tm-tr [aria-label*=Minecraft]').length;var g=document.querySelector('.tm-tr button[aria-label=Settings]');if(!g)return JSON.stringify({p:p,gear:false});g.click();return JSON.stringify({p:p,gear:true})})()") { v in
          let s0 = v as? String ?? ""
          r.append(("no-pickaxe-on-the-main-screen", s0.contains("\"p\":0")))
          later(1.2) {
          js("(function(){var e=document.querySelector('.gs-win .mcw-entry');if(!e)return 'none';e.click();return 'ok'})()") { v in
          r.append(("minecraft-mode-in-settings", (v as? String) == "ok"))
          later(1.6) {
            js("(function(){var w=document.querySelector('.mcw-full');if(!w)return 'none';var b=w.getBoundingClientRect();return JSON.stringify({open:w.classList.contains('mcw-open'),full:b.width>=innerWidth-1&&b.height>=innerHeight-1,title:(w.querySelector('h2')||{}).textContent,min:!!w.querySelector('.mcw-minbtn'),tr:!!w.querySelector('.mcw-tr')})})()") { v in
              let s = v as? String ?? ""
              print("MINECRAFT PANEL:", s)
              r.append(("popup-covers-the-screen", s.contains("\"open\":true") && s.contains("\"full\":true") && s.contains("Minecraft mode")))
              r.append(("minimise-button-and-translator", s.contains("\"min\":true") && s.contains("\"tr\":true")))
              js("JSON.stringify({settings:!!document.querySelector('.gs-win'),close:!!document.querySelector('.mcw-full .mcw-closebtn')})") { v in
                let s2 = v as? String ?? ""
                r.append(("settings-closed-and-close-button", s2.contains("\"settings\":false") && s2.contains("\"close\":true")))
              }
              snap(a.overlay, "\(dir)/mc-panel.png") {
                // Latin Georgian typed in: the page reads it as Georgian (the word lists ship inside PS).
                let set = "(function(){var t=document.querySelector('.mcw-in textarea');var s=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;s.call(t,'madloba, rom airchiet Magti\\n100 tsuti - 4 lari');t.dispatchEvent(new Event('input',{bubbles:true}));return 'ok'})()"
                js(set) { _ in
                  wait({ false }, 3) { _ in
                    js("(function(){var g=document.querySelector('.mcw-geo');return g?g.textContent:''})()") { v in
                      let g = v as? String ?? ""
                      print("MINECRAFT PAGE READ:", g.replacingOccurrences(of: "\n", with: " / "))
                      r.append(("page-reads-latin-georgian", g.contains("მადლობა, რომ აირჩიეთ მაგთი") && g.contains("100 წუთი - 4 ლარი")))
                      snap(a.overlay, "\(dir)/mc-latin.png") { minimise() }
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
    // Minimise: a bubble; the big layer is hidden and lets every click through; the bubble brings it all back.
    func minimise() {
      js("document.querySelector('.mcw-minbtn').click(); 'ok'") { _ in
        later(0.8) {
          js("(function(){var w=document.querySelector('.mcw-full'),b=document.querySelector('.mcw-bubble');var cs=getComputedStyle(w);var e=document.elementFromPoint(innerWidth/2,innerHeight/2);return JSON.stringify({bubble:!!b,vis:cs.visibility,pe:cs.pointerEvents,through:!!e&&!w.contains(e),kept:document.querySelector('.mcw-in textarea').value.length})})()") { v in
            let s = v as? String ?? ""
            print("MINECRAFT MIN:", s)
            r.append(("minimised-to-bubble", s.contains("\"bubble\":true")))
            r.append(("minimised-layer-hidden-and-click-through", s.contains("\"vis\":\"hidden\"") && s.contains("\"pe\":\"none\"") && s.contains("\"through\":true")))
            snap(a.overlay, "\(dir)/mc-bubble.png") {
              // A real press on the bubble (down and up in place) brings it back with the text still there.
              js("(function(){var b=document.querySelector('.mcw-bubble').getBoundingClientRect();return [b.left+b.width/2,b.top+b.height/2]})()") { v in
                guard let xy = v as? [NSNumber], xy.count == 2 else { r.append(("bubble-click-brings-it-back", false)); finish(); return }
                let pv = a.overlay!
                let p = pv.convert(NSPoint(x: xy[0].doubleValue, y: pv.isFlipped ? xy[1].doubleValue : pv.bounds.height - xy[1].doubleValue), to: nil)
                for (i, t) in [NSEvent.EventType.leftMouseDown, .leftMouseUp].enumerated() {
                  if let e = NSEvent.mouseEvent(with: t, location: p, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: a.panel.windowNumber,
                                                context: nil, eventNumber: 900 + i, clickCount: 1, pressure: t == .leftMouseUp ? 0 : 1) { a.panel.sendEvent(e) }
                }
                later(1.0) {
                  js("(function(){var w=document.querySelector('.mcw-full');return JSON.stringify({open:w.classList.contains('mcw-open'),text:document.querySelector('.mcw-in textarea').value})})()") { v in
                    let s = v as? String ?? ""
                    r.append(("bubble-click-brings-it-back-as-it-was", s.contains("\"open\":true") && s.contains("madloba")))
                    // Esc minimises, never clears.
                    a.overlay.evaluateJavaScript("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); 'ok'") { _, _ in
                      later(0.8) {
                        js("(function(){return JSON.stringify({open:document.querySelector('.mcw-full').classList.contains('mcw-open'),text:document.querySelector('.mcw-in textarea').value.length})})()") { v in
                          let s = v as? String ?? ""
                          r.append(("esc-minimises-and-keeps-text", s.contains("\"open\":false") && !s.contains("\"text\":0")))
                          closeIt()
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

    // Close (V1.32): put away completely, no bubble left on the screen, the typed text kept for next time.
    func closeIt() {
      js("(function(){window.__psOpenMinecraft&&window.__psOpenMinecraft();return 'ok'})()") { _ in
        later(1.0) {
          js("(function(){var c=document.querySelector('.mcw-closebtn');if(!c)return 'none';c.click();return 'ok'})()") { _ in
            later(0.9) {
              js("(function(){var w=document.querySelector('.mcw-full');return JSON.stringify({view:w&&w.dataset.mcwView,bubble:!!document.querySelector('.mcw-bubble'),saved:localStorage.getItem('ps.mc.view'),text:(document.querySelector('.mcw-in textarea')||{value:''}).value.length})})()") { v in
                let s = v as? String ?? ""
                print("MINECRAFT CLOSE:", s)
                r.append(("close-leaves-no-bubble-and-keeps-text", s.contains("\"view\":\"closed\"") && s.contains("\"bubble\":false") && s.contains("\"saved\":null") && !s.contains("\"text\":0")))
                finish()
              }
            }
          }
        }
      }
    }

    func finish() {
      print("MINECRAFT CHECK:", r.map { "\($0.0)=\($0.1 ? "ok" : "FAIL")" }.joined(separator: " "))
      done()
    }
  }
}
