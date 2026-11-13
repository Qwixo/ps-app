// Self test areas for the installer and the updater (PS_SELFTEST_ONLY=upanim, update, webupdate,
// rollback, install). Fixtures come from tests/updater-test.sh: a fake Applications folder, a fake
// Drive folder, a test signing key and FICTIONAL sign in data. Never /Applications, never the developer's
// Drive, never the Keychain. Clicks are real mouse events through the window's own event path.
// Animations are proven twice: every running animation may only move transform or opacity, and
// frames compared pixel by pixel change nothing outside the elements that are meant to move.
import AppKit
import WebKit

enum UpdaterSelfTest {
  static let env = ProcessInfo.processInfo.environment
  static var dir: String { env["PS_SELFTEST"]! }
  static var fails = 0
  static func check(_ name: String, _ ok: Bool, _ info: String = "") {
    if !ok { fails += 1 }
    print("  \(name)=\(ok ? "ok" : "FAIL")\(info.isEmpty ? "" : " (\(info))")")
  }
  static func later(_ s: Double, _ f: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + s, execute: f) }
  /// A Swift string as a JS string literal (JSON quoting).
  static func jsString(_ s: String) -> String {
    (try? JSONSerialization.data(withJSONObject: [s])).flatMap { String(data: $0, encoding: .utf8) }.map { String($0.dropFirst().dropLast()) } ?? "\"\""
  }
  static func finish() {
    print("UPDATER TOTAL:", fails == 0 ? "0 FAIL" : "\(fails) FAIL")
    print(ScreenGuard.report()); print(NetGuard.report()); print("DONE")
    exit(fails == 0 ? 0 : 1)
  }

  /// From applicationDidFinishLaunching: true when this run is one of these areas.
  /// A hidden test copy with no vault open gets App Nap, which stops the page painting.
  static var awake: NSObjectProtocol?
  static func stayAwake() { awake = ProcessInfo.processInfo.beginActivity(options: [.userInitiated, .latencyCritical], reason: "PS self test") }

  static func run(_ a: App) -> Bool {
    setvbuf(stdout, nil, _IONBF, 0)   // every line reaches the log at once
    if ["upanim", "update", "rollback", "webupdate"].contains(env["PS_SELFTEST_ONLY"] ?? "") { stayAwake() }
    // These areas test the fallback card (a Mac whose Tab list page never said hello).
    if ["update", "rollback", "webupdate"].contains(env["PS_SELFTEST_ONLY"] ?? "") { Updater.shared.forcePanel = true }
    switch env["PS_SELFTEST_ONLY"] {
    case "upanim": later(2) { animations { finish() } }
    case "update": later(3) { appUpdate(a, rollback: false) }
    case "rollback": later(3) { appUpdate(a, rollback: true) }
    case "webupdate": later(3) { webUpdate(a) }
    case "touchid": later(4) { touchID(a) }
    case "signals": later(1) { signals() }
    case "torch" where !MINECRAFT_ENABLED: SelfTest.mcSkipped(a, "torch")   // Minecraft mode is off (MinecraftSwitch.swift)
    case "torch": later(1) { torchCheck() }
    default: return false
    }
    return true
  }

  // MARK: tools

  static func js(_ w: WKWebView, _ s: String, _ f: @escaping (Any?) -> Void) { w.evaluateJavaScript(s) { v, _ in f(v) } }

  /// A real click (mouse down, then up 90 ms later) on the element's centre.
  static func click(_ w: WKWebView, _ win: NSWindow, _ sel: String, _ done: @escaping (Bool) -> Void) {
    js(w, "(function(){var e=document.querySelector('\(sel)');if(!e)return null;var r=e.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()") { v in
      guard let a = v as? [NSNumber], a.count == 2 else { done(false); return }
      let local = NSPoint(x: a[0].doubleValue, y: w.isFlipped ? a[1].doubleValue : w.bounds.height - a[1].doubleValue)
      let inWin = w.convert(local, to: nil)
      func ev(_ t: NSEvent.EventType) -> NSEvent? {
        NSEvent.mouseEvent(with: t, location: inWin, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: win.windowNumber,
                           context: nil, eventNumber: 7, clickCount: 1, pressure: t == .leftMouseUp ? 0 : 1)
      }
      if let d = ev(.leftMouseDown) { win.sendEvent(d) }
      later(0.09) { if let u = ev(.leftMouseUp) { win.sendEvent(u) }; done(true) }
    }
  }

  /// Waits until the card's (or page's) visible title is `t` (up to `max` seconds).
  static func waitTitle(_ w: WKWebView, _ t: String, max: Double = 20, _ f: @escaping (Bool) -> Void) {
    let until = Date().addingTimeInterval(max)
    func tick() {
      js(w, "(document.querySelector('#card .t1:not(.out)')||{}).textContent") { v in
        if (v as? String) == t { f(true) } else if Date() > until { f(false) } else { later(0.05, tick) }
      }
    }
    tick()
  }

  /// Records, every frame, which properties the running animations move, and the frame times.
  /// The same, counting only animations on elements matching `scope` (the Tab list page has many of its own).
  static func recorder(scope: String) -> String {
    recorder.replacingOccurrences(of: "document.getAnimations().forEach(function (a) {",
      with: "document.getAnimations().forEach(function (a) { var t = a.effect && a.effect.target; if (!t || !(t.closest('\(scope)') || t.matches('.mu-wrap ~ *'))) return;")
  }
  static let muScope = ".mu-wrap, .mu-gear-dot"
  static let recorder = """
    (function(){ if (window.__rec) return; var r = window.__rec = {props: {}, bad: {}, dts: [], last: 0, stop: false};
      var skip = {offset: 1, computedOffset: 1, easing: 1, composite: 1};
      var ok = {transform: 1, opacity: 1, translate: 1, scale: 1, rotate: 1};
      function loop(t) { if (r.last) r.dts.push(t - r.last); r.last = t;
        document.getAnimations().forEach(function (a) {
          var ps = a.transitionProperty ? [a.transitionProperty] : [].concat.apply([], a.effect.getKeyframes().map(function (k) { return Object.keys(k); })).filter(function (x) { return !skip[x]; });
          ps.forEach(function (p) { r.props[p] = 1; if (!ok[p]) { var e = a.effect.target; r.bad[p + ' on ' + (e.id || e.getAttribute('class') || e.tagName)] = 1; } });
        });
        if (!r.stop) requestAnimationFrame(loop); }
      requestAnimationFrame(loop); })()
    """
  static func recorderReport(_ w: WKWebView, _ f: @escaping () -> Void) {
    js(w, "(function(){var r=window.__rec;r.stop=true;var d=r.dts.filter(function(x){return x>0&&x<200}).sort(function(a,b){return a-b});var q=function(p){return d.length?d[Math.min(d.length-1,Math.floor(d.length*p))].toFixed(1):'n/a'};return JSON.stringify({props:Object.keys(r.props),bad:Object.keys(r.bad),n:d.length,median:q(.5),p95:q(.95),long:d.filter(function(x){return x>2.5*(d[Math.floor(d.length/2)]||16)}).length})})()") { v in
      guard let s = v as? String, let o = try? JSONSerialization.jsonObject(with: Data(s.utf8)) as? [String: Any] else { check("anim-properties", false, "no recorder"); f(); return }
      let props = (o["props"] as? [String]) ?? [], bad = (o["bad"] as? [String]) ?? []
      check("only-transform-and-opacity", bad.isEmpty && !props.isEmpty, "animated: \(props.sorted().joined(separator: ", "))\(bad.isEmpty ? "" : "; NOT allowed: \(bad.joined(separator: "; "))")")
      print("  frame pacing (test copy, parked off screen, so only a guide): median \(o["median"] ?? "?") ms, p95 \(o["p95"] ?? "?") ms, long frames \(o["long"] ?? "?") of \(o["n"] ?? "?")")
      f()
    }
  }

  /// `count` pictures `every` seconds apart. Counts pixels that changed between pictures OUTSIDE the
  /// elements in `anim` (must be 0) and inside them (shows something really moved).
  /// Only when `on` (the Drive wait has no frames to measure when the update came through the channel).
  static func framesIf(_ on: Bool, _ w: WKWebView, _ name: String, anim: [String], count: Int, every: Double, _ done: @escaping () -> Void) {
    if on { frames(w, name, anim: anim, count: count, every: every, done) } else { done() }
  }
  /// `clip`: only pixels inside that element count (the Tab list page has clocks and backgrounds of its own).
  static func frames(_ w: WKWebView, _ name: String, anim: [String], pad: Double = 6, count: Int = 8, every: Double = 0.08,
                     expectMotion: Bool = true, clip: String? = nil, _ done: @escaping () -> Void) {
    let sels = anim.map { "'\($0)'" }.joined(separator: ",")
    let clipJS = clip.map { "(function(){var e=document.querySelector('\($0)');if(!e)return null;var r=e.getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()" } ?? "null"
    js(w, "JSON.stringify({W: innerWidth, c: \(clipJS), r: [\(sels)].reduce(function(a,s){return a.concat([].slice.call(document.querySelectorAll(s)))},[]).map(function(e){var r=e.getBoundingClientRect();return [r.left,r.top,r.width,r.height]})})") { v in
      guard let s = v as? String, let o = try? JSONSerialization.jsonObject(with: Data(s.utf8)) as? [String: Any],
            let W = (o["W"] as? NSNumber)?.doubleValue, let rs = o["r"] as? [[NSNumber]] else { check("frames-\(name)", false, "no rects"); done(); return }
      let cr = o["c"] as? [NSNumber]
      if clip != nil && cr == nil { check("frames-\(name)", false, "no \(clip!)"); done(); return }
      var imgs: [NSImage] = []
      func shoot(_ i: Int) {
        guard i < count else { return compare() }
        w.takeSnapshot(with: nil) { img, _ in if let img { imgs.append(img) }; later(every) { shoot(i + 1) } }
      }
      func compare() {
        guard imgs.count >= 2, let first = SelfTest.pixels(imgs[0]) else { check("frames-\(name)", false, "no pictures"); done(); return }
        let scale = Double(first.w) / W
        let boxes = rs.map { r in CGRect(x: (r[0].doubleValue - pad) * scale, y: (r[1].doubleValue - pad) * scale, width: (r[2].doubleValue + 2 * pad) * scale, height: (r[3].doubleValue + 2 * pad) * scale) }
        // Inset by 5 px: a card's rounded corners (radius 16) leave the menu's see-through background inside its box.
        let within = cr.map { r in CGRect(x: r[0].doubleValue * scale, y: r[1].doubleValue * scale, width: r[2].doubleValue * scale, height: r[3].doubleValue * scale).insetBy(dx: 5 * scale, dy: 5 * scale) }
        var outside = 0, inside = 0, prev = first
        var ob = CGRect.null                     // where outside changes were (CSS pixels), to find them
        for k in 1..<imgs.count {
          guard let cur = SelfTest.pixels(imgs[k]), cur.w == prev.w, cur.h == prev.h else { continue }
          for y in 0..<cur.h { for x in 0..<cur.w {
            let o = y * cur.bpr + x * cur.spp
            var diff = false
            for c in 0..<min(4, cur.spp) where abs(Int(cur.data[o + c]) - Int(prev.data[o + c])) > 2 { diff = true; break }
            guard diff else { continue }
            let p = CGPoint(x: Double(x) + 0.5, y: Double(y) + 0.5)
            if let within, !within.contains(p) { continue }
            if boxes.contains(where: { $0.contains(p) }) { inside += 1 } else { outside += 1; ob = ob.union(CGRect(x: p.x / scale, y: p.y / scale, width: 1, height: 1)) }
          } }
          prev = cur
        }
        for (i, img) in [(0, imgs[0]), (imgs.count - 1, imgs[imgs.count - 1])] {
          if let t = img.tiffRepresentation, let r = NSBitmapImageRep(data: t), let png = r.representation(using: .png, properties: [:]) {
            try? png.write(to: URL(fileURLWithPath: "\(dir)/up-\(name)-\(i == 0 ? "first" : "last").png"))
          }
        }
        let moved = !expectMotion || inside > 0
        check("frames-\(name)", outside == 0 && moved, "\(imgs.count) frames, changed outside=\(outside), inside=\(inside)" + (ob.isNull ? "" : " at x \(Int(ob.minX))-\(Int(ob.maxX)) y \(Int(ob.minY))-\(Int(ob.maxY))"))
        done()
      }
      shoot(0)
    }
  }

  // MARK: upanim: every state of the card, fictional numbers

  static func animations(_ done: @escaping () -> Void) {
    print("UPDATE CARD ANIMATIONS:")
    let u = UpdateUI(install: false)
    u.present()
    later(1.0) {
      js(u.web, recorder) { _ in }
      u.call("offer", ["title": "Update available · V1.08 · Abundance", "sub": "New app build · 12 MB", "notes": ["Fictional note one.", "Fictional note two, a longer one that wraps onto a second line in the card."]] as [String: Any])
      frames(u.web, "card-enter", anim: ["#card"], pad: 56, count: 6, every: 0.06) {
        later(0.4) {
          frames(u.web, "card-idle", anim: [], count: 5, every: 0.12, expectMotion: false) {
            // A download at 20 updates a second, the way the real one reports.
            var f = 0.0
            let t = Timer(timeInterval: 0.05, repeats: true) { _ in
              f = min(1, f + 0.012)
              u.call("progress", ["title": "Downloading", "sub": NSNull(), "phase": "read", "frac": f, "detail": "\(mb(Int64(f * 12_400_000))) of 12 MB"])
            }
            RunLoop.main.add(t, forMode: .common)
            later(0.6) {
              frames(u.web, "card-download", anim: [".ic", "#bar", "#bytes"], count: 10, every: 0.08) {
                t.invalidate()
                u.call("progress", ["title": "Getting it from Google Drive", "sub": NSNull(), "phase": "drive", "frac": NSNull(), "detail": ""])
                later(0.5) {
                  frames(u.web, "card-drive-wait", anim: [".ic", "#bar"], count: 8, every: 0.08) {
                    u.call("progress", ["title": "Checking the signature", "sub": "Signed by you, every file matches", "phase": "busy", "frac": 1, "detail": ""])
                    later(0.5) {
                      frames(u.web, "card-checking", anim: [".ic"], count: 8, every: 0.08) {
                        u.call("done", ["title": "PS updated", "sub": "Now on V1.08 · Abundance. You are still signed in.", "ok": false])
                        frames(u.web, "card-done", anim: [".ic", ".tx", ".row"], count: 6, every: 0.07) {
                          later(0.3) {
                            frames(u.web, "card-done-still", anim: [], count: 4, every: 0.12, expectMotion: false) {
                              u.call("error", ["title": "Update stopped", "sub": "The update file does not match its signed note. Nothing was changed."])
                              later(0.6) {
                                SelfTest.snap(u.web, "\(dir)/up-card-error.png") {
                                  u.call("hide")
                                  frames(u.web, "card-leave", anim: ["#card"], pad: 56, count: 6, every: 0.06) {
                                    recorderReport(u.web) { done() }
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

  // MARK: the stop path never signals anything but the new build (27 Oct 2026: kill(-1))

  /// No app is launched and no real signal is sent: SafeSignal.send is replaced for the check.
  static func signals() {
    print("SIGNAL CHECK:")
    var sent: [(Int32, Int32)] = []
    let realSend = SafeSignal.send
    SafeSignal.send = { p, s in sent.append((p, s)); return 0 }
    defer { SafeSignal.send = realSend }
    let target = URL(fileURLWithPath: dir).appendingPathComponent("Applications/PS.app").path
    let j = UpdateJournal(phase: "swapped", from: 1, to: 2, target: target, previous: dir + "/previous/PS.app", failed: dir + "/failed/PS.app",
                          socket: dir + "/h.sock", attempts: 0, at: 0, shown: false, test: true)
    for (name, pid) in [("minus-one", Int32(-1)), ("zero", 0), ("one", 1), ("self", getpid()), ("parent-not-ps", getppid())] {
      sent = []
      UpdateHelper.lock.lock(); UpdateHelper.launchedPid = pid; UpdateHelper.calledPid = pid; UpdateHelper.launchDone = true
      UpdateHelper.children = [pid]; UpdateHelper.lock.unlock()
      UpdateHelper.stopNewBuild(j, known: pid)
      check("stop-path-no-signal-to-\(name)", sent.isEmpty, sent.map { "\($0.0):\($0.1)" }.joined(separator: " "))
      check("not-alive-\(name)", name == "parent-not-ps" || !UpdateHelper.alive(pid))
    }
    UpdateHelper.lock.lock(); UpdateHelper.launchedPid = nil; UpdateHelper.calledPid = nil; UpdateHelper.children = []; UpdateHelper.lock.unlock()
    later(3) { finish() }      // long enough for the network check to take its samples
  }

  /// Where the test's manifest and files are: the fake Drive folder, or the fake channel (a file://
  /// folder standing in for cincee.com/client/ps/, area "channel").
  static var source: URL {
    UpdatePaths.drive() ?? URL(string: env["PS_SELFTEST_CHANNEL"] ?? "file:///nonexistent/")!
  }

  // MARK: refusals (fixtures made by tests/updater-test.sh)

  static func refusals() {
    guard let bad = env["PS_SELFTEST_BAD"] else { return }
    let b = URL(fileURLWithPath: bad), key = UpdatePaths.publicKey
    print("UPDATE REFUSALS:")
    let badSig = (try? UpdateManifest.open(Data(contentsOf: b.appendingPathComponent("bad-sig.json")), publicKey: key)) == nil
    check("bad-signature-refused", badSig)
    let realKey = (try? UpdateManifest.open(Data(contentsOf: UpdaterSelfTest.source.appendingPathComponent("ps-update.json")), publicKey: UPDATE_PUBLIC_KEY)) == nil
    check("test-note-refused-by-real-key", realKey)
    if let older = try? UpdateManifest.open(Data(contentsOf: b.appendingPathComponent("older.json")), publicKey: key) {
      check("older-build-ignored", UpdatePlan.decide(older, myBuild: PSVersion.mine, web: PSVersion.web()) == .none)
    } else { check("older-build-ignored", false, "note unreadable") }
    if let m = try? UpdateManifest.open(Data(contentsOf: UpdaterSelfTest.source.appendingPathComponent("ps-update.json")), publicKey: key), let a = m.app {
      let tampered = b.appendingPathComponent("tampered").appendingPathComponent(a.file)
      var why = ""
      do { try UpdateFiles.fetch(tampered, to: URL(fileURLWithPath: dir).appendingPathComponent("t.zip"), size: a.size, sha256: a.sha256, progress: FetchProgress()) } catch { why = "\(error)" }
      check("tampered-file-refused", why.contains("does not match"), why)
    }
    let adhoc = UpdateFiles.signatureProblem(b.appendingPathComponent("adhoc/PS.app"))
    check("other-signer-refused", adhoc != nil, adhoc ?? "accepted")
    let modified = UpdateFiles.signatureProblem(b.appendingPathComponent("modified/PS.app"))
    check("changed-after-signing-refused", modified != nil, modified ?? "accepted")
    // The note carries the version the developer sees; an unknown key never stops a note opening.
    let named = try? UpdateManifest.open(Data(contentsOf: UpdaterSelfTest.source.appendingPathComponent("ps-update.json")), publicKey: key)
    check("note-names-the-version", named?.name == "V1.08 · Abundance", named?.name ?? "none")
    check("version-names", PSVersion.hundredths("1.02") == 102 && PSVersion.hundredths("1.2") == 0 && PSVersion.hundredths("V1.02") == 0 && PSVersion.hundredths("1.10") > PSVersion.hundredths("1.09")
      && PSVersion.show("1.07", "Wisdom") == "V1.07 · Wisdom" && PSVersion.show("V1.07", nil) == "V1.07" && PSVersion.keyword("<b>") == nil)
    // The card only for what will really install (the developer, 27 Oct 2026).
    if let m = named, m.kind == "app", let a = m.app {
      check("card-none-for-same-build", UpdatePlan.decide(m, myBuild: a.build, web: (m.web.src, m.web.built)) == .none)
      check("card-none-for-older-build", UpdatePlan.decide(m, myBuild: a.build + 1, web: (m.web.src, m.web.built)) == .none)
      var why = ""
      do { try Updater.verify(.app(a, m.web), drive: b.appendingPathComponent("tampered")) } catch { why = "\(error)" }
      check("card-none-for-unverifiable-files", why.contains("does not match"), why)
      why = ""
      do { try Updater.verify(.app(a, m.web), drive: UpdaterSelfTest.source) } catch { why = "\(error)" }
      check("card-for-newer-verified-build", why.isEmpty && UpdatePlan.decide(m, myBuild: a.build - 1, web: nil) != .none, why)
    }
    check("real-applications-never-a-test-target", UpdatePaths.apps?.path != "/Applications", UpdatePaths.apps?.path ?? "off")
    // Which update a Mac gets (made up versions).
    let w1 = UpdateManifest.Web(src: "aaa", built: "2026-10-27T10:00:00Z", file: "w.zip", size: 1, sha256: "x")
    let a5 = UpdateManifest.App(build: 2610271000, file: "a.zip", size: 1, sha256: "x")
    let m = UpdateManifest(kind: "web", made: "", app: a5, web: w1)
    let D = UpdatePlan.decide
    check("plan-newer-app", D(m, 2610260000, ("bbb", "2026-10-27T11:00:00Z")) == .app(a5, w1))
    check("plan-web-only-when-app-same", D(m, 2610271000, ("bbb", "2026-10-26T10:00:00Z")) == .web(w1))
    check("plan-nothing-when-web-same", D(m, 2610271000, ("aaa", "2026-10-27T10:00:00Z")) == .none)
    check("plan-never-older-web", D(m, 2610271000, ("bbb", "2026-10-28T10:00:00Z")) == .none)
    check("plan-web-when-none-installed", D(m, 2610271000, nil) == .web(w1))
    check("plan-file-names-safe", !UpdateManifest.safeFile("../x.zip") && !UpdateManifest.safeFile("/etc/x") && UpdateManifest.safeFile("updates/PS-app-1.zip"))
  }

  // MARK: update and rollback

  static func appUpdate(_ a: App, rollback: Bool) {
    calmFront()
    refusals()
    print(rollback ? "ROLLBACK CHECK:" : "UPDATE CHECK:")
    let target = UpdatePaths.target!
    let oldBuild = PSVersion.build(of: target) ?? 0
    Updater.shared.testHold = true
    Updater.shared.checkNow(manual: false) { plan in
      guard case .app(let info, _) = plan, let u = Updater.shared.ui else { check("offers-the-app-update", false, "\(plan)"); return finish() }
      check("offers-the-app-update", true, "build \(oldBuild) to \(info.build)")
      later(0.9) {
        js(u.web, recorder) { _ in }
        js(u.web, "[...document.querySelectorAll('#card .t1:not(.out), #card .t2:not(.out)')].map(e => e.textContent).join(' / ') + (document.querySelector('#card .t1:not(.out) .kw') && getComputedStyle(document.querySelector('#card .t1:not(.out) .kw')).color !== getComputedStyle(document.querySelector('#card .t1:not(.out)')).color ? ' [soft keyword]' : '')") { v in
          check("card-says-app-build", (v as? String)?.contains("New app build") == true, v as? String ?? "")
          check("keyword-softer-than-number", (v as? String)?.hasSuffix("[soft keyword]") == true, v as? String ?? "")
          check("card-says-version", (v as? String)?.hasPrefix("Update available · V1.08 · Abundance") == true, v as? String ?? "")
          SelfTest.snap(u.web, "\(dir)/up-offer.png") {
            click(u.web, u.window, "[data-id=install]") { _ in
              waitTitle(u.web, "Getting it from Google Drive", max: 3) { saw in
                check("real-click-starts-it", Updater.shared.log.contains("click:install"))
                // The channel downloads before the card offers anything, so there is no Drive wait then.
                if UpdatePaths.drive() == nil { check("no-drive-wait-in-channel", !saw) } else { check("drive-wait-shown", saw) }
                later(0.5) {
                  framesIf(UpdatePaths.drive() != nil, u.web, "update-drive-wait", anim: [".ic", "#bar"], count: 6, every: 0.08) {
                    waitTitle(u.web, "Downloading", max: 10) { _ in
                      later(0.3) {
                        frames(u.web, "update-download", anim: [".ic", "#bar", "#bytes"], count: 8, every: 0.08) {
                          waitTitle(u.web, "Checking the signature", max: 30) { saw in
                            check("checks-the-signature", saw)
                            later(0.3) {
                              frames(u.web, "update-checking", anim: [".ic"], count: 5, every: 0.08) {
                                waitTitle(u.web, "Restarting \(AppName.current)", max: 30) { saw in
                                  check("restarts", saw, Updater.shared.lastError)
                                  recorderReport(u.web) { afterHelper(target, oldBuild, info.build, rollback) }
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

  static func afterHelper(_ target: URL, _ oldBuild: Int, _ newBuild: Int, _ rollback: Bool, menu: App? = nil) {
    guard let h = Updater.shared.helper else { check("helper-started", false); return finish() }
    DispatchQueue.global().async {
      let until = Date().addingTimeInterval(90)
      while h.isRunning && Date() < until { usleep(100_000) }
      DispatchQueue.main.async {
        check("helper-finished", !h.isRunning, "exit \(h.isRunning ? -1 : h.terminationStatus)")
        let j = UpdateJournal.read()
        let now = PSVersion.build(of: target) ?? 0
        let d = URL(fileURLWithPath: dir)
        if rollback {
          check("rolled-back", j?.phase == "rolledBack", j?.phase ?? "no journal")
          check("old-build-back-in-place", now == oldBuild, "installed \(now)")
          check("failed-build-kept-aside", j.map { PSVersion.build(of: URL(fileURLWithPath: $0.failed)) == newBuild } ?? false)
          check("old-build-restarted", (try? String(contentsOf: d.appendingPathComponent("child-restored.txt"), encoding: .utf8)) == "\(oldBuild)")
          // The build that did not start is never offered again (27 Oct 2026: the developer was offered it in a loop).
          var why = ""
          if let m = try? UpdateManifest.open(Data(contentsOf: UpdaterSelfTest.source.appendingPathComponent("ps-update.json")), publicKey: UpdatePaths.publicKey) {
            let p = Updater.skipRolledBack(.app(m.app!, m.web), m, manual: true, why: &why)
            check("rolled-back-build-not-offered-again", { if case .app = p { return false }; return true }(), why)
            let newer = UpdateManifest.App(build: newBuild + 1, file: "x.zip", size: 1, sha256: "x")
            let auto = Updater.skipRolledBack(.app(newer, m.web), m, manual: false, why: &why)
            check("newer-build-waits-quiet-period", { if case .app = auto { return false }; return true }(), why)
            check("newer-build-on-request", Updater.skipRolledBack(.app(newer, m.web), m, manual: true, why: &why) == .app(newer, m.web))
          } else { check("rolled-back-build-not-offered-again", false, "no note") }
        } else if env["PS_SELFTEST_CHILD_NOHANDOVER"] == "1" {
          check("healthy-without-hand-over-not-rolled-back", j?.phase == "ok" && now == newBuild, "\(j?.phase ?? "no journal"), installed \(now)")
          check("no-sign-in-received", !FileManager.default.fileExists(atPath: d.appendingPathComponent("child-received.json").path))
        } else {
          check("journal-ok", j?.phase == "ok", j?.phase ?? "no journal")
          check("new-build-in-place", now == newBuild, "installed \(now)")
          check("previous-build-kept", j.map { PSVersion.build(of: URL(fileURLWithPath: $0.previous)) == oldBuild } ?? false)
          check("new-build-started", (try? String(contentsOf: d.appendingPathComponent("child-new.txt"), encoding: .utf8)) == "\(newBuild)")
          let sent = (try? Data(contentsOf: URL(fileURLWithPath: env["PS_SELFTEST_HANDOFF"]!))).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
          let got = (try? Data(contentsOf: d.appendingPathComponent("child-received.json"))).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
          // The silent item, or (PS locked with Touch ID) the locked one: whichever was sent arrives.
          if sent?["remember"] == nil && sent?["locked"] == nil {
            // Nothing remembered (the developer's state on 27 Oct, remember=0): only the network key goes over.
            check("nothing-remembered-hand-over", got?["remember"] is NSNull && got?["locked"] is NSNull && sent?["netmon"] as? String == got?["netmon"] as? String)
          } else {
            let item = sent?["remember"] != nil ? "remember" : "locked"
            check("sign-in-handed-over", sent?[item] as? String != nil && sent?[item] as? String == got?[item] as? String && sent?["netmon"] as? String == got?["netmon"] as? String, item)
            if item == "locked" { check("stays-locked-after-update", got?["remember"] is NSNull) }
          }
          // Second Computer's key, id and pairing list arrive and are saved as the new build's own (no re-pairing).
          if let sec = sent?["second"] as? [String: String] {
            let keep = SecondFileStore(dir: d.appendingPathComponent("child-second-keys").path)
            check("second-computer-keys-handed-over", got?["second"] as? [String: String] == sec && got?["secondSaved"] as? Int == sec.count
                  && sec.allSatisfy { keep.read($0.key)?.base64EncodedString() == $0.value })
          }
        }
        check("installed-app-signature", UpdateFiles.signatureProblem(target) == nil, UpdateFiles.signatureProblem(target) ?? "")
        check("no-quarantine-flag", UpdateFiles.quarantined(target) == 0, "\(UpdateFiles.quarantined(target)) files")
        // V1.36: the update went into the folder it found, under its own name, and left exactly one PS there.
        let apps = UpdatePaths.apps!
        let mineThere = ((try? FileManager.default.contentsOfDirectory(atPath: apps.path)) ?? []).filter { AppName.bundleID(of: apps.appendingPathComponent($0)) == AppName.bundleID }
        check("name-kept-one-ps", mineThere == [target.lastPathComponent] && (env["PS_SELFTEST_EXPECT_INSTALLED"].map { $0 == target.lastPathComponent } ?? true),
              mineThere.joined(separator: ", "))
        let w = PSVersion.web()
        check("web-files-installed", w?.built == env["PS_SELFTEST_NEWWEB"], w?.built ?? "none")
        if let a = menu {
          // The new build's gear menu after its restart (the new build itself ran as a test child): the
          // menu starts closed, the gear has a green dot, opening the menu shows "Updated to" and clears it.
          // V1.32: Settings is full screen and covers the gear, so it closes with its own Close button.
          overlayClick(a, ".gs-win .cs-min") { _ in
            later(0.5) {
              Updater.shared.testPage(["state": "done", "kind": "app", "current": "V1.08", "currentKeyword": "Abundance", "unseen": true])
              waitJS(a.overlay, "document.querySelector('.tm-tr .mu-gear-dot.done') && !document.querySelector('.gs-win')", max: 3) { dot in
                check("green-dot-after-update", dot)
                SelfTest.snap(a.overlay, "\(dir)/set-real-done-dot.png") {
                  overlayClick(a, ".tm-tr button[aria-label=Settings]") { _ in
                    waitJS(a.overlay, "document.querySelector('.gs-win .mu-card.s-done') && !document.querySelector('.tm-tr .mu-gear-dot')", max: 3) { seen in
                      check("updated-to-shown-and-dot-cleared", seen)
                      later(0.5) { SelfTest.snap(a.overlay, "\(dir)/set-real-done.png") { finish() } }
                    }
                  }
                }
              }
            }
          }
          return
        }
        // The "Updated" moment the new build shows after its restart.
        Updater.shared.showDone("\(AppName.current) updated", "Now on \(PSVersion.name). You are still signed in.")
        later(1.0) {
          if let u = Updater.shared.ui { SelfTest.snap(u.web, "\(dir)/up-updated.png") { finish() } } else { finish() }
        }
      }
    }
  }

  // MARK: the gear menu (31 Oct 2026): pictures of every state, and a real update through it

  /// Real clicks into the parked Tab list window, as the DND test does.
  static func overlayClick(_ a: App, _ sel: String, _ f: @escaping (Bool) -> Void) {
    js(a.overlay, "(function(){var e=document.querySelector('\(sel)');if(!e)return null;var r=e.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()") { v in
      guard let xy = v as? [NSNumber], xy.count == 2, let w = a.overlay else { f(false); return }
      let local = NSPoint(x: xy[0].doubleValue, y: w.isFlipped ? xy[1].doubleValue : w.bounds.height - xy[1].doubleValue)
      let inWin = w.convert(local, to: nil)
      a.updateClickThrough(at: NSPoint(x: xy[0].doubleValue, y: xy[1].doubleValue))
      func ev(_ t: NSEvent.EventType) -> NSEvent? {
        NSEvent.mouseEvent(with: t, location: inWin, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: a.panel.windowNumber,
                           context: nil, eventNumber: 13, clickCount: 1, pressure: t == .leftMouseUp ? 0 : 1)
      }
      if let d = ev(.leftMouseDown) { a.panel.sendEvent(d) }
      later(0.09) { if let u = ev(.leftMouseUp) { a.panel.sendEvent(u) }; f(true) }
    }
  }
  /// Polls a JS condition (true) for up to `max` seconds.
  static func waitJS(_ w: WKWebView, _ cond: String, max: Double, _ f: @escaping (Bool) -> Void) {
    let until = Date().addingTimeInterval(max)
    func tick() { js(w, "!!(\(cond))") { v in if v as? Bool == true { f(true) } else if Date() > until { f(false) } else { later(0.05, tick) } } }
    tick()
  }
  static let menuText = "(function(){var c=document.querySelector('.gs-win .mu-card, .gs-win .mu-row');return c?c.innerText.replace(/\\s+/g,' ').trim():''})()"
  /// The update row's own place in the menu (the menu's other panels have animations of their own).
  static let menuClip = ".gs-win .mu-wrap > *"   // V1.32: the update row lives in the gear's full screen Settings, General
  /// Text without spaces (a flex row's gaps are not spaces).
  static func squeeze(_ s: String) -> String { s.components(separatedBy: .whitespacesAndNewlines).joined() }

  /// PS_SELFTEST_ONLY=settingsui: every state of the gear menu's update row, FICTIONAL versions and notes.
  static func settingsPictures(_ a: App) {
    stayAwake()
    print("SETTINGS UPDATE PICTURES:")
    let w: WKWebView = a.overlay, U = Updater.shared
    let base: [String: Any] = ["version": "V1.23", "keyword": "Fitness", "current": "V1.22", "currentKeyword": "Mastery", "kind": "app", "size": 14_200_000,
                               "notes": ["A Fitness tab for the gym, with a rest timer.", "Updates now live in this menu, like the phone."]]
    func st(_ s: String, _ extra: [String: Any] = [:]) { var o = base; o["state"] = s; for (k, v) in extra { o[k] = v }; U.testPage(o) }
    check("page-said-hello", U.pageOn)
    st("available")
    later(0.8) {
      js(w, "!!document.querySelector('.tm-tr .mu-gear-dot.update')") { v in
        check("gear-dot-when-available", v as? Bool == true)
        SelfTest.snap(w, "\(dir)/set-01-gear-dot.png") {
          overlayClick(a, ".tm-tr button[aria-label=Settings]") { _ in
            waitJS(w, "document.querySelector('.gs-win .mu-row.avail') && !document.querySelector('.gs-win').getAnimations().length", max: 3) { open in
              check("menu-row-shows", open)
              js(w, menuText) { t in
                check("row-says-update-available", squeeze(t as? String ?? "").hasPrefix(squeeze("Update available · V1.23 · Fitness")), t as? String ?? "")
                js(w, recorder(scope: muScope)) { _ in }
                SelfTest.snap(w, "\(dir)/set-02-row.png") {
                  overlayClick(a, ".gs-win .mu-row.avail") { _ in
                    waitJS(w, "document.querySelector('.gs-win .mu-card.s-available')", max: 3) { _ in
                    frames(w, "card-open", anim: [".gs-win .mu-card"], pad: 8, count: 6, every: 0.06, clip: menuClip) {
                      js(w, menuText) { t in
                        let s = t as? String ?? ""
                        check("card-says-version", s.hasPrefix("Update available · V1.23 · Fitness"), s)
                        check("card-shows-notes", s.contains("A Fitness tab for the gym") && s.contains("New app build · 14 MB"), s)
                        check("card-has-update-now-button", s.hasSuffix("Later Update now"), s)
                        later(0.4) {
                          frames(w, "card-still", anim: [], count: 5, every: 0.1, expectMotion: false, clip: menuClip) {
                            SelfTest.snap(w, "\(dir)/set-03-card.png") { download() }
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
    func download() {
      var f = 0.0
      st("downloading", ["progress": 0])
      let t = Timer(timeInterval: 0.05, repeats: true) { _ in f = min(1, f + 0.011); st("downloading", ["progress": f]) }
      RunLoop.main.add(t, forMode: .common)
      later(0.7) {
        frames(w, "downloading", anim: [".gs-win .mu-orb", ".gs-win .mu-bar", ".gs-win .mu-s", ".gs-win .mu-steps", ".gs-win .mu-t"], count: 10, every: 0.08, clip: menuClip) {
          js(w, "document.querySelector('.tm-tr .mu-gear-dot')===null") { v in check("no-dot-while-working", v as? Bool == true) }
          SelfTest.snap(w, "\(dir)/set-04-downloading.png") {
            t.invalidate()
            st("verifying")
            later(0.5) {
              frames(w, "verifying", anim: [".gs-win .mu-orb", ".gs-win .mu-bar", ".gs-win .mu-steps", ".gs-win .mu-t", ".gs-win .mu-s"], count: 6, every: 0.08, clip: menuClip) {
                SelfTest.snap(w, "\(dir)/set-05-verifying.png") {
                  st("installing")
                  later(0.6) {
                    SelfTest.snap(w, "\(dir)/set-06-installing.png") {
                      st("ready")
                      waitJS(w, "document.querySelector('.gs-win .mu-card.s-ready')", max: 3) { _ in
                      frames(w, "ready-enter", anim: [".gs-win .mu-card"], pad: 8, count: 6, every: 0.06, clip: menuClip) {
                        later(0.6) {
                          frames(w, "ready-still", anim: [], count: 5, every: 0.1, expectMotion: false, clip: menuClip) {
                            js(w, menuText) { t in
                              let s = t as? String ?? ""
                              check("ready-says-relaunch", s.hasPrefix("Relaunch to finish") && s.hasSuffix("Relaunch to finish"), s)
                              js(w, "!!document.querySelector('.tm-tr .mu-gear-dot.update')") { v in check("gear-dot-when-ready", v as? Bool == true) }
                              SelfTest.snap(w, "\(dir)/set-07-ready.png") { rest() }
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
    func rest() {
      st("relaunching")
      later(0.6) {
        SelfTest.snap(w, "\(dir)/set-08-relaunching.png") {
          st("done", ["current": "V1.23", "currentKeyword": "Fitness", "unseen": true])
          later(0.3) {
            // The menu is open, so the news counts as seen at once (the dot goes).
            waitJS(w, "document.querySelector('.gs-win .mu-card.s-done') && !document.querySelector('.tm-tr .mu-gear-dot')", max: 3) { seen in
              check("done-seen-when-menu-open", seen && U.page["unseen"] as? Bool == false)
              SelfTest.snap(w, "\(dir)/set-09-done.png") {
                st("error", ["error": "The update file does not match its signed note", "unseen": false])
                later(0.6) {
                  js(w, menuText) { t in
                    check("error-says-nothing-changed", (t as? String)?.contains("Nothing was changed.") == true, t as? String ?? "")
                    SelfTest.snap(w, "\(dir)/set-10-error.png") {
                      U.testPage(["state": "none", "current": "V1.23", "currentKeyword": "Fitness"])
                      later(0.6) {
                        SelfTest.snap(w, "\(dir)/set-11-up-to-date.png") {
                          recorderReport(w) {
                            // The card never appeared on its own.
                            check("no-popup-card", U.ui == nil || U.ui?.window.isVisible == false)
                            finish()
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

  /// PS_SELFTEST_ONLY=settingsupdate: an older build (fake Applications folder) updates to this one
  /// through the gear menu, real clicks only: the note and files come through the channel code (a
  /// file:// folder, offline), Update runs Download, Verify, Install, nothing is swapped until
  /// "Relaunch to finish", then the same helper, hand over and checks as the card's update.
  /// PS_SELFTEST_SIGNEDOUT=1 (with PS_SELFTEST_RED=0): someone else's PS, never signed in (7 Nov 2026, the developer: "if
  /// you're not signed in you can update anyway"). The gear cannot be seen, so the card offers the update; once
  /// the vault opens the card goes and the gear's dot shows it.
  static func signedOut(_ a: App) {
    let w: WKWebView = a.overlay, U = Updater.shared
    calmFront()
    check("not-red", !Owner.red)
    a.vaultUnlocked = false
    U.checkNow(manual: false) { plan in
      guard case .app = plan else { check("signed-out-finds-the-update", false, "\(plan)"); return finish() }
      later(0.5) {
        check("signed-out-card-offers-it", U.ui?.window.isVisible == true)
        js(w, "!!document.querySelector('.tm-tr .mu-gear-dot.update')") { v in
          check("signed-out-no-gear-dot", (v as? Bool) != true)
          a.vaultUnlocked = true   // signing in: the update moves to the gear
          later(0.6) {
            check("signed-in-card-goes", U.ui?.window.isVisible != true)
            check("signed-in-gear-has-it", (U.page["state"] as? String) == "available", U.page["state"] as? String ?? "")
            finish()
          }
        }
      }
    }
  }

  // MARK: the update pop-up (V1.40)

  /// The pop-up waits while 1Password or Signal is in front (V1.40). A test copy runs on the developer's real Mac, so the
  /// card areas start as if neither were in front (a flag in this test copy only; it never looks at those apps).
  static func calmFront() {
    if Protected.front { print("  (1Password or Signal is in front on this Mac: this test copy acts as if not)") }
    Protected.simulate(front: false, signal: false)
  }

  /// PS_SELFTEST_ONLY=updatepopup (tests/updater-test.sh, PS_SELFTEST_RED=1 the developer's PS, =0 someone else's), signed in:
  /// the update pops up by itself once with its version and notes, waits for Do Not Disturb, steps aside for
  /// 1Password or Signal, Later is a day of quiet (the gear keeps it) then once more, then only the gear; after an
  /// update the setup offer shows once and its button fires ps:open-setup in the Tab list. Real clicks on the card.
  static func updatePopup(_ a: App) {
    stayAwake()
    print("UPDATE POPUP CHECK:")
    let w: WKWebView = a.overlay, U = Updater.shared
    print("  OWNER: \(Owner.red ? "Owner" : "someone else")")
    calmFront()
    a.vaultUnlocked = true
    check("page-said-hello", U.pageOn)
    if !U.pageOn { js(w, "location.href+' | root children '+((document.getElementById('root')||{}).childElementCount)+' | door '+typeof window.__psOpenSetup+' | ps '+typeof window.__psMacUpdate") { v in print("  TAB LIST PAGE:", v as? String ?? "no answer") } }
    DND.shared.testSet(on: true, mute: [:])
    let text = "(function(){var c=document.getElementById('card');return [...c.querySelectorAll('.t1:not(.out), .t2:not(.out)')].map(e=>e.textContent).join(' / ')+' | '+[...c.querySelectorAll('#notes li')].map(e=>e.textContent).join(' + ')+' | '+[...c.querySelectorAll('.row:not(.off) .btn')].map(e=>e.textContent).join(' + ')})()"
    U.checkNow(manual: false) { plan in
      guard case .app = plan else { check("finds-the-update", false, "\(plan)"); return finish() }
      later(0.5) {
        check("waits-for-dnd", U.ui?.window.isVisible != true && U.testNudgeState.shown == 0)
        check("gear-has-it-meanwhile", (U.page["state"] as? String) == "available")
        DND.shared.testSet(on: false, mute: [:])   // DND ends: the pop-up comes up by itself
        later(0.8) {
          guard let u = U.ui, u.window.isVisible else { check("shows-when-dnd-ends", false); return finish() }
          check("shows-when-dnd-ends", U.cardMode == "offer" && U.testNudgeState.shown == 1)
          js(u.web, text) { v in
            let s = v as? String ?? ""
            check("names-the-version", s.hasPrefix("Update available · V1.08 · Abundance / New app build"), s)
            check("shows-the-notes", s.contains("Fictional note one. + Fictional note two."), s)
            check("update-now-and-later", s.hasSuffix("Update now + Later"), s)
            check("window-fits-the-notes", u.window.frame.height > UpdateUI.cardSize.height, "\(Int(u.window.frame.height))")
            SelfTest.snap(u.web, "\(dir)/popup-offer.png") {
              Protected.simulate(front: true, signal: false)
              later(0.3) {
                check("steps-aside-for-1password-or-signal", !u.window.isVisible)
                Protected.simulate(front: false, signal: false)
                later(0.3) {
                  check("back-when-they-go", u.window.isVisible)
                  click(u.web, u.window, "#ask:not(.off) [data-id=later]") { _ in
                    later(0.8) { afterLater(u) }
                  }
                }
              }
            }
          }
        }
      }
    }
    func afterLater(_ u: UpdateUI) {
      let n = U.testNudgeState, day = n.laterUntil - Date().timeIntervalSince1970
      check("later-hides-it", !u.window.isVisible && U.log.contains("click:later"))
      check("later-is-a-day", day > 23.9 * 3600 && day <= 24 * 3600, "\(Int(day)) s")
      check("gear-keeps-it", (U.page["state"] as? String) == "available")
      js(w, "!!document.querySelector('.tm-tr .mu-gear-dot.update')") { v in
        print("  gear dot in the Tab list: \((v as? Bool) == true ? "yes" : "not drawn (no list state in this run)")")
        U.checkNow(manual: false) { _ in
          later(0.4) {
            check("quiet-on-the-next-check", !u.window.isVisible)
            // A day later (the record moved back a day): once more.
            var m = U.testNudgeState; m.laterUntil = Date().timeIntervalSince1970 - 1; U.testNudge(m)
            U.checkNow(manual: false) { _ in
              later(0.6) {
                check("back-a-day-later", u.window.isVisible && U.testNudgeState.shown == 2)
                click(u.web, u.window, "#ask:not(.off) [data-id=later]") { _ in
                  later(0.6) {
                    check("second-later-ends-it", !u.window.isVisible && U.testNudgeState.answered)
                    var m2 = U.testNudgeState; m2.laterUntil = Date().timeIntervalSince1970 - 1; U.testNudge(m2)
                    U.checkNow(manual: false) { _ in later(0.5) { check("never-again-by-itself", !u.window.isVisible); setup(u) } }
                  }
                }
              }
            }
          }
        }
      }
    }
    func setup(_ u: UpdateUI) {
      print("UPDATE SETUP OFFER CHECK:")
      // Signed in as a real friend would be: a FICTIONAL signed in state for the Tab list page (as renameFlow), held so
      // no engine answer replaces it. Without it someone else's test copy has a signed out page behind a native "signed in".
      let st: [String: Any] = ["type": "state", "unlocked": true, "red": Owner.red, "lastSync": NSNull(), "docs": [
        ["id": "s1", "ws": NSNull(), "kind": "settings", "author": NSNull(), "updatedAt": NSNull(), "data": ["lastResetAt": ISO8601DateFormatter().string(from: Date())]],
        ["id": "t1", "ws": NSNull(), "kind": "todo", "author": NSNull(), "updatedAt": NSNull(), "data": ["title": "Fictional task", "type": "once", "done": false, "order": 0]]]]
      a.lastState = String(data: try! JSONSerialization.data(withJSONObject: st), encoding: .utf8)
      a.testHoldState = true
      a.pushState()
      U.setupCan(1)
      later(0.4) {
        check("no-setup-offer-without-an-update", !u.window.isVisible)
        js(w, "window.__setupGot=[];window.addEventListener('ps:open-setup',function(e){e.preventDefault();window.__setupGot.push(e.detail&&e.detail.from)});typeof window.__psOpenSetup") { v in
          check("tab-list-has-the-door", (v as? String) == "function", v as? String ?? "")
          U.testUpdated()
          a.vaultUnlocked = true   // the test copy's engine page may have said "locked" meanwhile (no real vault here)
          DND.shared.testSet(on: true, mute: [:])
          U.setupCan(1)
          later(0.4) {
            check("setup-waits-for-dnd", !u.window.isVisible)
            DND.shared.testSet(on: false, mute: [:])
            later(0.8) {
              check("setup-offered-after-update", u.window.isVisible && U.cardMode == "setup")
              js(u.web, text) { t in
                let s = t as? String ?? ""
                check("setup-words", s.hasPrefix("Updated to ") && s.hasSuffix("See what's new and set it up + Not now"), s)
                SelfTest.snap(u.web, "\(dir)/popup-setup.png") {
                  // The door itself: what PS calls after the click fires ps:open-setup in the Tab list page.
                  js(w, "window.__psOpenSetup('test');(window.__setupGot||[]).join(',')") { v in
                    check("door-fires-ps-open-setup", (v as? String) == "test", v as? String ?? "")
                    click(u.web, u.window, "#setuprow:not(.off) [data-id=setup]") { _ in
                      later(1.0) {
                        check("click-opens-the-tab-list", U.log.contains("click:setup") && !u.window.isVisible && a.shown, "shown \(a.shown)")
                        U.setupCan(1)
                        later(0.5) {
                          check("setup-offered-once", !u.window.isVisible)
                          // The page's answer once the list is up (a test copy's list page can be slow to answer): a note, not a check.
                          var ended = false
                          func end(_ got: Bool) {
                            if ended { return }
                            ended = true
                            print("  SETUP CLICK REACHED THE PAGE: \(got ? "yes" : "no answer from the test copy's page in 6 s")")
                            finish()
                          }
                          waitJS(w, "window.__setupGot && window.__setupGot.indexOf('update') >= 0", max: 6) { got in end(got) }
                          later(7) { end(false) }   // a page that does not answer at all must not hold the run
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

  static func settingsUpdate(_ a: App) {
    stayAwake()
    refusals()
    print("SETTINGS UPDATE CHECK:")
    let w: WKWebView = a.overlay, U = Updater.shared
    let target = UpdatePaths.target!
    let oldBuild = PSVersion.build(of: target) ?? 0
    U.testHold = true
    calmFront()
    check("page-said-hello", U.pageOn)
    if env["PS_SELFTEST_SIGNEDOUT"] == "1" { return signedOut(a) }
    U.checkNow(manual: false) { plan in
      guard case .app(let info, _) = plan else { check("finds-the-app-update", false, "\(plan)"); return finish() }
      check("finds-the-app-update", true, "build \(oldBuild) to \(info.build)")
      // V1.40: signed in, the update pops up by itself too (once); Update in the gear puts it away.
      check("popup-card-signed-in", U.ui?.window.isVisible == true && U.cardMode == "offer", U.cardMode)
      waitJS(w, "document.querySelector('.tm-tr .mu-gear-dot.update')", max: 3) { dot in
        check("gear-dot", dot)
        overlayClick(a, ".tm-tr button[aria-label=Settings]") { _ in
          waitJS(w, "document.querySelector('.gs-win .mu-row.avail') && !document.querySelector('.gs-win').getAnimations().length", max: 3) { _ in
            js(w, menuText) { t in
              check("row-names-the-version", squeeze(t as? String ?? "").hasPrefix(squeeze("Update available · V1.08 · Abundance")), t as? String ?? "")
              SelfTest.snap(w, "\(dir)/set-real-row.png") {
                overlayClick(a, ".gs-win .mu-row.avail") { _ in
                  waitJS(w, "document.querySelector('.gs-win .mu-card.s-available [data-mu=start]')", max: 3) { _ in
                    js(w, menuText) { t in
                      let s = t as? String ?? ""
                      check("card-shows-signed-notes", s.contains("Fictional note one.") && s.contains("Fictional note two."), s)
                      js(w, recorder(scope: muScope)) { _ in }
                      SelfTest.snap(w, "\(dir)/set-real-card.png") {
                        overlayClick(a, ".gs-win [data-mu=start]") { _ in
                          waitJS(w, "document.querySelector('.gs-win .mu-card.s-downloading')", max: 3) { saw in
                            check("real-click-starts-it", saw && U.log.contains("page:start"))
                            check("gear-update-puts-the-popup-away", U.ui?.window.isVisible != true && U.testNudgeState.answered)
                            later(0.3) {   // WebKit's picture lags the page by a frame or two
                            frames(w, "real-download", anim: [".gs-win .mu-orb", ".gs-win .mu-bar", ".gs-win .mu-s", ".gs-win .mu-steps", ".gs-win .mu-t"], count: 8, every: 0.08, clip: menuClip) {
                              SelfTest.snap(w, "\(dir)/set-real-downloading.png") { verify() }
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
      func verify() {
        waitJS(w, "document.querySelector('.gs-win .mu-card.s-verifying')", max: 30) { saw in
          check("verifies", saw)
          SelfTest.snap(w, "\(dir)/set-real-verifying.png") {
            waitJS(w, "document.querySelector('.gs-win .mu-card.s-installing')", max: 30) { saw in
              check("installs", saw)
              SelfTest.snap(w, "\(dir)/set-real-installing.png") {
                waitJS(w, "document.querySelector('.gs-win .mu-card.s-ready [data-mu=finish]')", max: 30) { saw in
                  check("ready-to-relaunch", saw, U.lastError)
                  // Nothing went in yet: the old build is still installed and running.
                  check("not-swapped-before-relaunch", PSVersion.build(of: target) == oldBuild && U.helper == nil, "installed \(PSVersion.build(of: target) ?? 0)")
                  // A check while it waits keeps it waiting (change only, no second download).
                  U.checkNow(manual: false) { _ in
                    js(w, "!!document.querySelector('.gs-win .mu-card.s-ready')") { v in
                      check("stays-ready-after-a-check", v as? Bool == true)
                      SelfTest.snap(w, "\(dir)/set-real-ready.png") {
                        overlayClick(a, ".gs-win [data-mu=finish]") { _ in
                          waitJS(w, "document.querySelector('.gs-win .mu-card.s-relaunching')", max: 10) { saw in
                            check("relaunch-click", saw && U.log.contains("page:finish"))
                            SelfTest.snap(w, "\(dir)/set-real-relaunching.png") {
                              let until = Date().addingTimeInterval(30)
                              func waitHelper() {
                                if U.helper != nil { recorderReport(w) { afterHelper(target, oldBuild, info.build, false, menu: a) } }
                                else if Date() > until { check("helper-started", false, U.lastError); finish() }
                                else { later(0.1, waitHelper) }
                              }
                              waitHelper()
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

  // MARK: Settings > Mac settings > App name (V1.36)

  /// PS_SELFTEST_ONLY=rename: a test copy running from a fake Applications folder (tests/updater-test.sh area rename)
  /// is renamed from its own Mac settings tab with real clicks. A name with a colon and a name taken by something
  /// that is not PS are refused in plain words and nothing moves; a good name renames the folder in one step
  /// (signature intact, one PS there) and the renamed copy starts from its new place (a hidden test child).
  static func renameFlow(_ a: App) {
    stayAwake()
    print("RENAME CHECK:")
    let w: WKWebView = a.overlay, R = AppRename.shared
    let apps = UpdatePaths.apps!
    let want = AppName.tidy(env["PS_SELFTEST_RENAME_TO"] ?? AppName.publicDefault)
    let start = Bundle.main.bundleURL
    let mine = PSVersion.mine   // read now: after the rename this copy's own folder has a new name
    check("runs-from-the-fake-applications", R.here != nil, start.path)
    check("name-is-the-folder-name", AppName.current == AppName.name(of: start), AppName.current)
    // What macOS itself calls this copy (Cmd-Tab, Force Quit, the Dock), for the report: not a check.
    print("  MACOS NAMES: localizedName=\(NSRunningApplication.current.localizedName ?? "nil") displayName=\(FileManager.default.displayName(atPath: start.path)) CFBundleName=\(Bundle.main.object(forInfoDictionaryKey: "CFBundleName") ?? "nil")")
    func mineThere() -> [String] { ((try? FileManager.default.contentsOfDirectory(atPath: apps.path)) ?? []).filter { AppName.bundleID(of: apps.appendingPathComponent($0)) == AppName.bundleID }.sorted() }
    let before = mineThere()
    js(w, "window.__psAppName") { v in check("page-knows-the-name", (v as? String) == AppName.current, v as? String ?? "none") }
    // As the "PS is active" pop-up's Settings button does: the Tab list opens on Mac settings. It needs a signed in
    // (FICTIONAL) state first, as NoWindowSelfTest's Mac settings check does; held so no engine answer replaces it.
    let st: [String: Any] = ["type": "state", "unlocked": true, "red": false, "lastSync": NSNull(), "docs": [
      ["id": "s1", "ws": NSNull(), "kind": "settings", "author": NSNull(), "updatedAt": NSNull(), "data": ["lastResetAt": ISO8601DateFormatter().string(from: Date())]],
      ["id": "t1", "ws": NSNull(), "kind": "todo", "author": NSNull(), "updatedAt": NSNull(), "data": ["title": "Fictional task", "type": "once", "done": false, "order": 0]]]]
    a.lastState = String(data: try! JSONSerialization.data(withJSONObject: st), encoding: .utf8)
    a.vaultUnlocked = true
    a.testHoldState = true
    a.pushState()
    later(0.8) { a.openList(then: App.openSettingsJS) }
    waitJS(w, "document.querySelector('.gs-win .an-row input')", max: 10) { shown in
      check("app-name-row-shows", shown)
      if !shown { js(w, "JSON.stringify({gs: !!document.querySelector('.gs-win'), tab: (document.querySelector('.gs-win')||{}).dataset && document.querySelector('.gs-win').dataset.tab, mac: !!document.querySelector('.mac-win')})") { v in print("  RENAME DEBUG:", v as? String ?? "") } }
      later(1.2) {   // the panels' own entrance animation ends
        js(w, "(function(){var i=document.querySelector('.gs-win .an-row input');if(!i)return null;i.scrollIntoView({block:'center'});return i.value})()") { v in
          check("row-shows-the-name", (v as? String) == AppName.current, v as? String ?? "")
          later(0.5) { SelfTest.snap(w, "\(dir)/rename-row.png") { bad() } }
        }
      }
    }
    func type(_ s: String, _ then: @escaping () -> Void) {
      js(w, "(function(){var i=document.querySelector('.gs-win .an-row input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,\(jsString(s)));i.dispatchEvent(new Event('input',{bubbles:true}));return true})()") { _ in
        later(0.2) { overlayClick(a, ".gs-win .an-row .an-go") { _ in then() } }
      }
    }
    func refused(_ typed: String, _ name: String, _ words: String, _ then: @escaping () -> Void) {
      type(typed) {
        waitJS(w, "(document.querySelector('.gs-win .an-err')||{}).textContent && document.querySelector('.gs-win .an-err').textContent.indexOf(\(jsString(words))) >= 0", max: 4) { saw in
          js(w, "(document.querySelector('.gs-win .an-err')||{}).textContent || ''") { v in
            check("\(name)-refused-in-plain-words", saw, v as? String ?? "")
            check("\(name)-moved-nothing", FileManager.default.fileExists(atPath: start.path) && mineThere() == before && R.renamedTo == nil)
            then()
          }
        }
      }
    }
    func bad() {
      refused("Bad:Name", "colon-name", "cannot have / or :") {
        refused("Taken", "taken-name", "There is already something called Taken in Applications") {
          SelfTest.snap(w, "\(dir)/rename-refused.png") { good() }
        }
      }
    }
    func good() {
      check("log-says-nothing-but-clicks", R.log.allSatisfy { $0 == "set" })
      type(want) {
        let until = Date().addingTimeInterval(15)
        let marker = URL(fileURLWithPath: dir).appendingPathComponent("child-renamed-path.txt")
        func wait() {
          if R.renamedTo != nil && FileManager.default.fileExists(atPath: marker.path) { results() }
          else if Date() > until { check("renamed", false, R.error ?? "no answer"); finish() }
          else { later(0.1, wait) }
        }
        wait()
      }
    }
    func results() {
      let to = apps.appendingPathComponent(AppName.folder(want), isDirectory: true)
      check("renamed-to-the-name", R.renamedTo?.lastPathComponent == AppName.folder(want), R.renamedTo?.path ?? "")
      check("old-folder-gone", !FileManager.default.fileExists(atPath: start.path) || AppName.sameItem(start.path, to.path))
      check("one-ps-in-applications", mineThere() == [AppName.folder(want)], mineThere().joined(separator: ", "))
      check("signature-intact-after-rename", UpdateFiles.signatureProblem(to) == nil, UpdateFiles.signatureProblem(to) ?? "")
      check("same-build", PSVersion.build(of: to) == mine, "\(PSVersion.build(of: to) ?? 0) vs \(mine)")
      let ran = (try? String(contentsOf: URL(fileURLWithPath: dir).appendingPathComponent("child-renamed-path.txt"), encoding: .utf8)) ?? ""
      check("renamed-copy-started-from-its-new-place", AppName.real(ran) == AppName.real(to.path), ran)
      check("renamed-copy-knows-its-name", AppName.name(of: URL(fileURLWithPath: ran)) == want, ran)
      check("no-error-shown", R.error == nil, R.error ?? "")
      finish()
    }
  }

  // MARK: web-only update: the app is never touched

  static func webUpdate(_ a: App) {
    calmFront()
    refusals()
    print("WEB UPDATE CHECK:")
    let target = UpdatePaths.target!
    func stamp() -> String {
      var st = stat(); stat(target.appendingPathComponent("Contents/MacOS/PS").path, &st)
      return "\(st.st_ino)-\(st.st_mtimespec.tv_sec)-\(PSVersion.build(of: target) ?? 0)"
    }
    let before = stamp()
    let oldIndex = readText(UpdatePaths.web.appendingPathComponent("index.html"))
    Updater.shared.checkNow(manual: false) { plan in
      guard case .web = plan, let u = Updater.shared.ui else { check("offers-a-web-update", false, "\(plan)"); return finish() }
      check("offers-a-web-update", true)
      later(0.9) {
        js(u.web, "[...document.querySelectorAll('#card .t1:not(.out), #card .t2:not(.out)')].map(e => e.textContent).join(' / ')") { v in
          check("card-says-no-restart", (v as? String)?.contains("no restart") == true, v as? String ?? "")
          check("card-says-version", (v as? String)?.hasPrefix("Update available · V1.08 · Abundance") == true, v as? String ?? "")
          click(u.web, u.window, "[data-id=install]") { _ in
            waitTitle(u.web, "\(AppName.current) updated", max: 30) { saw in
              check("installed", saw, Updater.shared.lastError)
              check("app-untouched", stamp() == before, "\(before) then \(stamp())")
              check("no-helper-no-restart", Updater.shared.helper == nil && UpdateJournal.read() == nil)
              check("web-version-now-new", PSVersion.web()?.built == env["PS_SELFTEST_NEWWEB"], PSVersion.web()?.built ?? "")
              // The web files now carry the new version (the app's own may be newer than the test's V1.08).
              let wn = PSVersion.webName().map { PSVersion.show($0.0, $0.1) } ?? "none"
              check("now-on-the-new-version", wn == "V1.08 · Abundance", wn)
              let newIndex = readText(UpdatePaths.web.appendingPathComponent("index.html"))
              check("index-replaced", !newIndex.isEmpty && newIndex != oldIndex)
              a.loadMain()
              later(2.5) {
                check("page-runs-the-new-build", a.loadedIndex == newIndex)
                SelfTest.snap(u.web, "\(dir)/up-web-done.png") { finish() }
              }
            }
          }
        }
      }
    }
  }

  // MARK: install from the DMG (area install), or move a copy opened elsewhere (area move)

  static func install() {
    setvbuf(stdout, nil, _IONBF, 0)
    stayAwake()
    let ins = Installer.shared
    guard let u = ins.ui else { check("install-screen", false); return finish() }
    let mine = PSVersion.mine   // read now: in the move area this copy's own bundle goes to the trash
    print("INSTALL CHECK:")
    ins.fakePerms = ["ax": false, "audio": false]
    later(2.0) {
      js(u.web, recorder) { _ in }
      frames(u.web, "install-welcome-still", anim: [], count: 4, every: 0.12, expectMotion: false) {
        // V1.36: the name field starts with the name PS already has here, else the public default.
        let prefill = env["PS_SELFTEST_EXPECT_PREFILL"] ?? AppName.publicDefault
        js(u.web, "document.getElementById('wTitle').textContent + ' | ' + document.getElementById('wGo').textContent + ' | ' + document.getElementById('wName').value") { v in
          let want = Installer.moving ? "Move \(prefill) to Applications | Move to Applications | \(prefill)" : "Install \(prefill) | Install | \(prefill)"
          check("welcome-words", (v as? String) == want, v as? String ?? "")
        }
        SelfTest.snap(u.web, "\(dir)/install-welcome.png") {
          names {
          click(u.web, u.window, "[data-id=start]") { _ in
            later(0.15) {
              check("real-click-starts-it", ins.log.contains("click:start"))
              frames(u.web, "install-steps", anim: ["#pSteps .steps li.now .dot", "#pSteps .steps li.now .bar", "#pSteps .steps li .sd", "#pSteps .steps li .st", "#pSteps .steps li .dot", "#pWelcome", "#pSteps h1"], count: 8, every: 0.07) {
                let until = Date().addingTimeInterval(30)
                func waitPerms() {
                  js(u.web, "document.querySelector('#pPerms').className") { v in
                    if (v as? String) == "page" { perms() } else if Date() > until { check("reaches-permissions", false); finish() } else { later(0.1, waitPerms) }
                  }
                }
                waitPerms()
              }
            }
          }
          }
        }
      }
    }
    /// V1.36, the name field: a name with a slash and a name taken by something that is not PS are refused on the
    /// welcome page in plain words (nothing copied); then the name to install under, typed in, names every step.
    func names(_ next: @escaping () -> Void) {
      guard let want = env["PS_SELFTEST_INSTALL_NAME"] else { return next() }
      let apps = UpdatePaths.apps!
      func type(_ s: String) -> String { "(function(){var f=document.getElementById('wName');f.value=\(jsString(s));f.dispatchEvent(new Event('input',{bubbles:true}));return document.getElementById('wTitle').textContent})()" }
      func appsNow() -> [String] { ((try? FileManager.default.contentsOfDirectory(atPath: apps.path)) ?? []).sorted() }
      let before = appsNow()
      func refused(_ typed: String, _ name: String, _ words: String, _ then: @escaping () -> Void) {
        js(u.web, type(typed)) { _ in
          click(u.web, u.window, "[data-id=start]") { _ in
            waitJS(u.web, "document.getElementById('wNameErr').classList.contains('on')", max: 3) { shown in
              js(u.web, "document.getElementById('wNameErr').textContent + ' | ' + document.getElementById('pWelcome').className") { v in
                let s = v as? String ?? ""
                check("\(name)-refused-in-plain-words", shown && s.contains(words) && s.hasSuffix("| page"), s)
                check("\(name)-copied-nothing", appsNow() == before, appsNow().joined(separator: ", "))
                then()
              }
            }
          }
        }
      }
      refused("Bad/Name", "slash-name", "cannot have / or :") {
        refused("Taken", "taken-name", "There is already something called Taken in Applications") {
          js(u.web, type(want)) { v in
            check("title-follows-the-field", (v as? String) == (Installer.moving ? "Move \(want) to Applications" : "Install \(want)"), v as? String ?? "")
            later(0.4) { SelfTest.snap(u.web, "\(dir)/install-named.png") { next() } }
          }
        }
      }
    }
    func perms() {
      check("reaches-permissions", true)
      later(0.7) {
        js(u.web, "[].map.call(document.querySelectorAll('.perm .pn'),function(e){return e.textContent}).join(' | ')") { v in
          check("macos-27-pane-names", (v as? String)?.contains(Installer.axPane) == true, v as? String ?? "")
          SelfTest.snap(u.web, "\(dir)/install-perms.png") {
            frames(u.web, "install-perms-still", anim: [], count: 4, every: 0.12, expectMotion: false) {
              ins.fakePerms = ["ax": true, "audio": false]
              ins.refreshPerms()
              frames(u.web, "install-perm-granted", anim: ["#perm-ax .ok", "#perm-ax .btn", "#permNote"], count: 6, every: 0.07) {
                SelfTest.snap(u.web, "\(dir)/install-perms-granted.png") {
                  // V1.44 local first: on a Mac that never used PS, Next first asks where the list lives.
                  click(u.web, u.window, "#permGo") { _ in
                    later(0.6) {
                      js(u.web, "(function(){var p=document.getElementById('pStore');return !!p&&!p.classList.contains('later')&&!p.classList.contains('away')&&document.querySelectorAll('#pStore .opt').length===2&&document.querySelector('#pStore .opt.sel').dataset.store==='local'})()") { v in
                        check("install-asks-where-the-list-lives", (v as? Bool) == true)
                        SelfTest.snap(u.web, "\(dir)/install-store.png") {
                          click(u.web, u.window, "#pStore [data-id=finish]") { _ in
                            later(0.25) {
                              check("install-keeps-the-list-on-this-mac", ProjectStore.setupStore == "local")
                              frames(u.web, "install-all-set", anim: ["#pDone", "#pPerms", "#pSteps"], pad: 0, count: 5, every: 0.07) {
                                later(2.5) { results() }
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
    func results() {
      let t = ins.installedAt ?? UpdatePaths.target!
      let d = URL(fileURLWithPath: dir)
      // V1.36: installed under the chosen name, and exactly one PS in Applications (one there before under another
      // name was moved out into PS's own update folder).
      let wantName = env["PS_SELFTEST_INSTALL_NAME"] ?? env["PS_SELFTEST_EXPECT_PREFILL"] ?? AppName.publicDefault
      check("installed-under-the-name", t.lastPathComponent == AppName.folder(wantName), t.lastPathComponent)
      let apps = UpdatePaths.apps!
      let mineThere = ((try? FileManager.default.contentsOfDirectory(atPath: apps.path)) ?? []).filter { AppName.bundleID(of: apps.appendingPathComponent($0)) == AppName.bundleID }
      check("one-ps-in-applications", mineThere == [AppName.folder(wantName)], mineThere.joined(separator: ", "))
      check("copied-to-applications", PSVersion.build(of: t) == mine, "\(PSVersion.build(of: t) ?? 0)")
      check("installed-app-signature", UpdateFiles.signatureProblem(t) == nil, UpdateFiles.signatureProblem(t) ?? "")
      check("no-quarantine-flag", UpdateFiles.quarantined(t) == 0, "\(UpdateFiles.quarantined(t)) files")
      let bgs = ((try? FileManager.default.contentsOfDirectory(atPath: UpdatePaths.backgrounds.path)) ?? []).filter { $0.hasSuffix(".mp4") }
      check("backgrounds-unpacked", bgs.count == Int(env["PS_SELFTEST_BGCOUNT"] ?? "1"), bgs.joined(separator: ", "))
      check("web-files-installed", PSVersion.web() != nil, PSVersion.web()?.built ?? "none")
      check("installed-ps-opened", (try? String(contentsOf: d.appendingPathComponent("child-installed.txt"), encoding: .utf8)) == "\(mine)")
      // Moving: the copy it was opened from is gone (in the test's own trash folder), the installed one stays.
      let gone = !FileManager.default.fileExists(atPath: Installer.originalApp().path)
      let binned = FileManager.default.fileExists(atPath: d.appendingPathComponent("trash/\(Installer.originalApp().lastPathComponent)/Contents/Info.plist").path)
      if Installer.moving { check("old-copy-to-trash", gone && binned && ins.log.contains("trashed"), "gone=\(gone) binned=\(binned)") }
      else { check("disk-image-copy-kept", !binned && !ins.log.contains("trashed")) }
      recorderReport(u.web) {
        SelfTest.snap(u.web, "\(dir)/install-done.png") { finish() }
      }
    }
  }
}
