import AppKit
import AVFoundation

// Self test for the Drive folder sync of the developer's background videos (4 Nov 2026, Backgrounds.swift),
// PS_SELFTEST_ONLY=bgvideo, right after the BG VIDEO CHECK. Test clips in the test folder only (never
// his Drive, his vault or his clipboard). Checks:
//  - a .mov in the folder gets a silent HEVC copy and a tile (the developer's second video was a .mov);
//  - the main window is told: the copy is to go in the vault (older, with its file version) and the
//    folder's videos (drive); after bg:adopt it is complete here and never offered again;
//  - a video in the vault that is still in the folder but missing from the vault's list goes back in;
//  - the file leaving the folder: gone only when missing on looks far enough apart, then out of the Tab list,
//    reported as gone, and deleted here when the vault's list no longer has it;
//  - the folder missing: one card with Copy error code; the copied text has the code and no path or
//    account; the card is not shown again while the problem stays; it ends when the folder is back;
//  - the 12 hour check runs and leaves a playable copy;
//  - Add video: a picked .mov (outside the folder) gets a silent copy, a tile and progress cards, goes in
//    the vault once, the folder never takes it away, the picked file is untouched, a broken file is one
//    BG-ADD card with Copy error code, and it goes when the vault no longer has it.
extension SelfTest {
  static func bgSync(_ a: App, _ dir: String, _ src: URL, _ done: @escaping () -> Void) {
    let bg = Backgrounds.shared
    var r: [(String, Bool)] = []
    var sent: [[String: Any]] = []
    let keepMain = bg.toMain
    bg.toMain = { j in if let d = j.data(using: .utf8), let m = try? JSONSerialization.jsonObject(with: d) as? [String: Any] { sent.append(m) } }
    func lastHave() -> [String: Any] { sent.last { $0["type"] as? String == "bg:have" } ?? [:] }
    func ids(_ k: String) -> [String] {
      (lastHave()[k] as? [Any] ?? []).compactMap { ($0 as? String) ?? (($0 as? [String: Any])?["id"] as? String) }
    }
    func after(_ s: Double, _ f: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + s, execute: f) }
    let ff = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].first { FileManager.default.isExecutableFile(atPath: $0) } ?? "/usr/bin/true"
    // 6. Add video (More settings, Background): a file the developer picks outside the folder, synced the same way
    func addVideo(_ finish: @escaping () -> Void) {
      let pickDir = URL(fileURLWithPath: dir).appendingPathComponent("bgpick", isDirectory: true)
      try? FileManager.default.createDirectory(at: pickDir, withIntermediateDirectories: true)
      let picked = pickDir.appendingPathComponent("Picked Clip.mov"), broken = pickDir.appendingPathComponent("Broken.mov")
      try? Data("not a video".utf8).write(to: broken)
      DispatchQueue.global(qos: .utility).async {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: ff)
        p.arguments = ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=960x540:rate=25", "-f", "lavfi", "-i", "sine=frequency=440",
                       "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "pcm_s16le", "-shortest", picked.path]
        try? p.run(); p.waitUntilExit()
        let before = (try? FileManager.default.attributesOfItem(atPath: picked.path)[.size] as? NSNumber)?.intValue ?? -1
        DispatchQueue.main.async { bg.add(picked) { id in
          let copy = id.map { bg.localDir.appendingPathComponent("\($0).mp4") }
          let asset = copy.map { AVURLAsset(url: $0) }
          r.append(("added-copy-silent", asset.map { $0.tracks(withMediaType: .audio).isEmpty && !$0.tracks(withMediaType: .video).isEmpty } ?? false))
          r.append(("added-tile", id.map { i in bg.list.contains { $0["id"] == i } } ?? false))
          let o = (lastHave()["older"] as? [[String: Any]] ?? []).first { $0["id"] as? String == id }
          r.append(("added-offered-for-vault", o?["added"] as? Bool == true && o?["sig"] == nil))
          r.append(("added-progress-card", bg.lastAddCard.hasPrefix("Sending Picked Clip")))
          guard let id else { finish(); return }
          bg.handle("bg:progress", ["id": id, "pct": 40])
          after(0.5) {
            r.append(("added-progress-percent", bg.lastAddCard.hasSuffix("40%")))
            bg.handle("bg:adopt", ["from": id, "id": id])
            bg.handle("bg:list", ["keep": ["test-clip", id]])
            after(1.0) {
              r.append(("added-done-card", bg.lastAddCard.hasSuffix("is on every device now")))
              r.append(("added-complete", ids("ids").contains(id) && !ids("older").contains(id)))
              // the Drive folder never takes it away (it is not a folder video)
              bg.testLook { after(0.7) { bg.testLook { bg.testState { _, _, m in
                r.append(("added-not-gone-with-folder", m[id] != nil && m[id]?["gone"] as? Bool != true && bg.list.contains { $0["id"] == id }))
                let after_ = (try? FileManager.default.attributesOfItem(atPath: picked.path)[.size] as? NSNumber)?.intValue ?? -2
                r.append(("picked-file-untouched", before > 0 && before == after_))
                // a file that is not a video: one card with Copy error code
                bg.add(broken) { bad in bg.testState { probs, cards, _ in
                  r.append(("added-broken-card", bad == nil && probs.contains("BG-ADD") && cards.contains("BG-ADD")))
                  bg.cardAction("bg:BG-ADD", "copy")
                  after(0.5) {
                    r.append(("added-broken-code", bg.lastCopied.hasPrefix("PS error code BG-ADD\n") && !bg.lastCopied.contains(pickDir.path)))
                    // taken out of the vault elsewhere: it goes from here too
                    bg.handle("bg:list", ["keep": ["test-clip"]])
                    after(1.0) { r.append(("added-removed-with-vault", copy.map { !FileManager.default.fileExists(atPath: $0.path) } ?? false)); finish() }
                  }
                } }
              } } } }
            }
          }
        } }
      }
    }
    let mov = src.appendingPathComponent("Second Clip.mov")
    DispatchQueue.global(qos: .utility).async {
      let p = Process()
      p.executableURL = URL(fileURLWithPath: ff)
      p.arguments = ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=25", "-f", "lavfi", "-i", "sine=frequency=330",
                     "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "pcm_s16le", "-shortest", mov.path]
      try? p.run(); p.waitUntilExit()
      DispatchQueue.main.async {
        // 1. the page asks (bg:list); the .mov is made and offered for the vault
        bg.handle("bg:list", ["keep": ["test-clip"]])
        after(1.5) { bg.testLook {
          let copy = bg.localDir.appendingPathComponent("second-clip.mp4")
          let asset = AVURLAsset(url: copy)
          let silent = asset.tracks(withMediaType: .audio).isEmpty && !asset.tracks(withMediaType: .video).isEmpty
          r.append(("mov-copied-silent", silent))
          r.append(("mov-tile", bg.list.contains { $0["id"] == "second-clip" }))
          let older = (lastHave()["older"] as? [[String: Any]] ?? []).first { $0["id"] as? String == "second-clip" }
          r.append(("offered-for-vault-with-version", (older?["sig"] as? String)?.isEmpty == false))
          r.append(("folder-list-sent", ids("drive").contains("second-clip") && ids("drive").contains("test-clip")))
          r.append(("never-downloaded-over-own-copy", ids("ids").contains("test-clip")))
          if Backgrounds.shrinkAll { r.append(("compressed-smaller", bg.lastShrink.map { $0.to < $0.from } ?? false)) }
          // 2. the page put it in the vault
          bg.handle("bg:adopt", ["from": "second-clip", "id": "second-clip"])
          bg.handle("bg:list", ["keep": ["test-clip", "second-clip"]])
          after(1.0) {
            r.append(("adopted-complete", ids("ids").contains("second-clip")))
            r.append(("adopted-not-offered-again", !ids("older").contains("second-clip")))
            // 3. lost from the vault's list but still in the folder: goes back in (not deleted)
            bg.handle("bg:list", ["keep": ["test-clip"]])
            after(1.0) {
              r.append(("lost-goes-back-in", ids("older").contains("second-clip") && FileManager.default.fileExists(atPath: copy.path)))
              bg.handle("bg:adopt", ["from": "second-clip", "id": "second-clip"])
              bg.handle("bg:list", ["keep": ["test-clip", "second-clip"]])
              // 4. the file leaves the folder: gone only when missing on looks far enough apart (0.5 s in a test copy)
              after(1.0) { try? FileManager.default.removeItem(at: mov); bg.testLook { bg.testLook { bg.testState { _, _, m1 in
                r.append(("not-gone-on-quick-looks", m1["second-clip"]?["gone"] as? Bool != true))
                after(0.7) { bg.testLook { bg.testState { _, _, m2 in
                  r.append(("gone-after-two-looks", m2["second-clip"]?["gone"] as? Bool == true))
                  r.append(("gone-off-the-tab-list", !bg.list.contains { $0["id"] == "second-clip" }))
                  r.append(("gone-reported", ids("gone").contains("second-clip")))
                  bg.handle("bg:list", ["keep": ["test-clip"]])
                  after(1.0) {
                    r.append(("deleted-here-after-vault", !FileManager.default.fileExists(atPath: copy.path)))
                    // 5. the folder goes missing: one card, Copy error code, not shown twice, ends when back
                    let moved = src.deletingLastPathComponent().appendingPathComponent("bgsrc-moved")
                    try? FileManager.default.moveItem(at: src, to: moved)
                    bg.testLook { bg.testLook { bg.testState { probs, cards, _ in
                      r.append(("folder-missing-card", probs.contains("BG-FOLDER-GONE") && cards.contains("BG-FOLDER-GONE")))
                      bg.cardAction("bg:BG-FOLDER-GONE", "copy")
                      after(0.5) {
                        let t = bg.lastCopied
                        r.append(("copied-code", t.hasPrefix("PS error code BG-FOLDER-GONE\n") && t.contains("Device: Mac")))
                        r.append(("copied-nothing-private", !t.contains(dir) && !t.contains("/Users/") && !t.contains("@")))
                        r.append(("copied-no-path", !t.contains(src.path) && !t.contains("bgsrc")))
                        bg.testLook { bg.testState { probs2, cards2, _ in
                          r.append(("not-shown-again", probs2.contains("BG-FOLDER-GONE") && !cards2.contains("BG-FOLDER-GONE")))
                          try? FileManager.default.moveItem(at: moved, to: src)
                          bg.testLook(full: true) { bg.testState { probs3, _, m3 in
                            r.append(("ends-when-back", !probs3.contains("BG-FOLDER-GONE")))
                            r.append(("full-check-keeps-copy", m3["test-clip"] != nil && bg.list.contains { $0["id"] == "test-clip" }))
                            r.append(("full-check-tells-page", lastHave()["check"] as? Bool == true))
                            addVideo { bg.toMain = keepMain
                              let bad = r.filter { !$0.1 }.map { $0.0 }
                              print("BG SYNC CHECK:", bad.isEmpty ? "ok" : "FAIL", r.map { "\($0.0)=\($0.1 ? "ok" : "FAIL")" }.joined(separator: " "))
                              done()
                            }
                          } }
                        } }
                      }
                    } } }
                  }
                } } }
              } } } }
            }
          }
        } }
      }
    }
  }
}
