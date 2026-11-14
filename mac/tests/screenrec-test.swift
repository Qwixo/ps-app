import Foundation
// Run: bash tests/screenrec-test.sh. Fake capture, fake permissions, fake folders only. The same numbers are checked on the web
// side in web tests/screenrec.test.ts (the signs, the timer).
var n = 0, bad = 0
func ok(_ name: String, _ c: Bool) { n += 1; if c { print("ok - \(name)") } else { bad += 1; print("FAIL - \(name)") } }
let T0 = Date(timeIntervalSince1970: 1_763_024_400)
func at(_ s: Double) -> Date { T0.addingTimeInterval(s) }

// ---- fakes ----
final class FakePerms: SRPermissionsAPI {
  var screenState = SRPerm.unknown, micState = SRPerm.unknown
  var screenAsked = 0, micAsked = 0, statusReads = 0
  func screen() -> SRPerm { statusReads += 1; return screenState }
  func mic() -> SRPerm { statusReads += 1; return micState }
  func requestScreen() { screenAsked += 1 }
  func requestMic(_ done: @escaping (Bool) -> Void) { micAsked += 1; done(false) }
}
final class FakeCapture: SRCaptureAPI {
  var started: [SRPlan] = [], paused = 0, resumed = 0, stopped = 0
  var failWith: Error? = nil
  var holdStop = false
  var finishStop: (() -> Void)?
  func start(_ plan: SRPlan, done: @escaping (Error?) -> Void) { started.append(plan); done(failWith) }
  func pause() { paused += 1 }
  func resume() { resumed += 1 }
  var mics: [String?] = []
  func switchMic(_ uid: String?) { mics.append(uid) }
  func stop(done: @escaping () -> Void) { stopped += 1; if holdStop { finishStop = done } else { done() } }
}
struct Boom: Error {}

// ---- the opt in gate: nothing runs and nothing is asked while it is off ----
do {
  let p = FakePerms(), c = FakeCapture()
  let ctl = SRController(settings: SRSettings(), featureOn: { true }, perms: p, capture: c)
  ok("off by default", SRSettings().enabled == false && ctl.snapshot.state == .off)
  ok("start is refused while off", ctl.start() == .off)
  ok("asking for screen permission is refused while off", ctl.askScreen() == .off)
  ok("asking for mic permission is refused while off", ctl.askMic() == .off)
  ctl.pause(); ctl.resume(); ctl.stop()
  ok("no capture call at all while off", c.started.isEmpty && c.paused == 0 && c.resumed == 0 && c.stopped == 0)
  ok("no permission was asked or even read while off", p.screenAsked == 0 && p.micAsked == 0 && p.statusReads == 0)
  ctl.setEnabled(true)
  ok("saying yes alone asks macOS for nothing", p.screenAsked == 0 && p.micAsked == 0 && ctl.snapshot.state == .idle)
  ok("with yes, asking is allowed", ctl.askScreen() == nil && p.screenAsked == 1)
  ctl.setEnabled(false)
  ok("saying no puts it off again", ctl.snapshot.state == .off && ctl.start() == .off)
}
do {
  // the feature switch off in the build: even a saved yes does nothing
  var s = SRSettings(); s.enabled = true
  let p = FakePerms(), c = FakeCapture()
  let ctl = SRController(settings: s, featureOn: { false }, perms: p, capture: c)
  ok("feature off: gate closed even with a saved yes", !ctl.gateOpen && ctl.start() == .off && ctl.askScreen() == .off)
  ctl.setEnabled(true)
  ok("feature off: a yes is ignored", !ctl.gateOpen && p.screenAsked == 0 && c.started.isEmpty)
}

// ---- starting, permission, pause, stop ----
func on(_ f: (inout SRSettings) -> Void = { _ in }) -> (SRController, FakePerms, FakeCapture) {
  var s = SRSettings(); s.enabled = true; f(&s)
  let p = FakePerms(), c = FakeCapture()
  let ctl = SRController(settings: s, featureOn: { true }, perms: p, capture: c)
  var t = T0; ctl.now = { t }; _ = t; t = T0
  return (ctl, p, c)
}
do {
  let (ctl, p, c) = on()
  ok("start without permission says which", ctl.start() == .permission("screen") && c.started.isEmpty)
  p.screenState = .granted
  ok("then the mic", ctl.start() == .permission("mic"))
  p.micState = .granted
  ok("with both, it starts", ctl.start() == nil && c.started.count == 1 && ctl.snapshot.state == .recording)
  ok("a second start is busy", ctl.start() == .busy && c.started.count == 1)
  ok("pause then resume reach capture", { ctl.pause(); ctl.resume(); return c.paused == 1 && c.resumed == 1 && ctl.snapshot.state == .recording }())
  ctl.stop()
  ok("stop reaches capture and goes idle", c.stopped == 1 && ctl.snapshot.state == .idle)
  ok("stop when idle does nothing", { ctl.stop(); return c.stopped == 1 }())
}
do {
  let (ctl, p, c) = on(); p.screenState = .granted; p.micState = .granted
  c.failWith = Boom()
  ok("a capture failure goes back to idle with a message", ctl.start() == nil && ctl.snapshot.state == .idle && ctl.snapshot.error != nil)
}
do {
  // switching it off while recording stops and saves first
  let (ctl, p, c) = on(); p.screenState = .granted; p.micState = .granted
  c.holdStop = true
  _ = ctl.start()
  ctl.setEnabled(false)
  ok("switching off while recording asks capture to stop (it saves first)", c.stopped == 1 && ctl.snapshot.state == .stopping || ctl.snapshot.state == .off)
  c.finishStop?()
  ok("after the file is saved the state is off", ctl.snapshot.state == .off && !ctl.gateOpen)
}

// ---- switching the mic ----
do {
  let (ctl, p, c) = on(); p.screenState = .granted; p.micState = .granted
  ctl.switchMic("uid-a")
  ok("switching the mic while idle only remembers it", ctl.settings.micUID == "uid-a" && c.mics.isEmpty)
  _ = ctl.start()
  ctl.switchMic("uid-b")
  ok("switching the mic while recording reaches capture", c.mics == ["uid-b"] && ctl.settings.micUID == "uid-b")
  ctl.switchMic(nil)
  ok("nil is the Mac's default mic", c.mics.count == 2 && ctl.settings.micUID == nil)
  let off = SRController(settings: SRSettings(), featureOn: { true }, perms: p, capture: c)
  off.switchMic("x")
  ok("while off it does nothing", c.mics.count == 2 && off.settings.micUID == nil)
}

// ---- audio only never asks for what it does not need ----
do {
  var s = SRSettings(); s.mode = .audioOnly; s.computerSound = false
  ok("audio only, mic only: no screen permission needed", !SRNeeds.screen(s) && SRNeeds.mic(s))
  s.computerSound = true
  ok("audio only with computer sound needs the screen permission (the system carries the sound)", SRNeeds.screen(s))
  let (ctl, p, c) = on { $0.mode = .audioOnly; $0.computerSound = false }
  p.micState = .granted
  ok("audio only mic only starts with no screen permission", ctl.start() == nil && c.started.count == 1 && p.screenAsked == 0)
  ok("its file is .m4a", c.started[0].fileName.hasSuffix(".m4a") && c.started[0].mode == .audioOnly)
  var z = SRSettings(); z.mode = .audioOnly; z.micOn = false; z.computerSound = false
  ok("audio only with nothing to record is a problem", SRNeeds.problem(z) != nil)
  ok("two tracks when both are on", SRMath.tracks(SRSettings()) == 2 && SRMath.tracks(z) == 0)
}

// ---- presets set every value ----
do {
  var s = SRSettings()
  s.resolution = .p1440; s.fps = 60; s.quality = .best; s.codec = .h264; s.audioQuality = .high
  let calls = SRPresets.apply(.calls, to: s)
  ok("Calls: 1080p, 15 fps, Balanced (and HEVC, Standard sound)", calls.resolution == .p1080 && calls.fps == 15 && calls.quality == .balanced && calls.codec == .hevc && calls.audioQuality == .standard && calls.preset == .calls)
  let sharp = SRPresets.apply(.sharp, to: s)
  ok("Sharp: same as screen, 30 fps, High", sharp.resolution == .same && sharp.fps == 30 && sharp.quality == .high && sharp.codec == .hevc && sharp.audioQuality == .high)
  let tiny = SRPresets.apply(.tiny, to: s)
  ok("Tiny: 720p, 15 fps, Small file", tiny.resolution == .p720 && tiny.fps == 15 && tiny.quality == .small && tiny.audioQuality == .standard)
  let custom = SRPresets.apply(.custom, to: s)
  ok("Custom keeps the values", custom.resolution == .p1440 && custom.fps == 60 && custom.quality == .best && custom.preset == .custom)
  ok("the default is Calls", SRSettings().preset == .calls && SRPresets.detect(SRSettings()) == .calls)
  var t = calls; t.fps = 30
  ok("changing one value makes it Custom", SRPresets.touched(t).preset == .custom)
  t.fps = 15
  ok("putting it back matches Calls again", SRPresets.touched(t).preset == .calls)
  ok("every preset is different", Set([calls, sharp, tiny].map { "\($0.resolution)\($0.fps)\($0.quality)" }).count == 3)
}

// ---- resolution never above the screen ----
do {
  let a = SRMath.size(.p2160, screenW: 1920, screenH: 1080)
  ok("4K on a 1080 screen is the screen's own size", a.w == 1920 && a.h == 1080)
  let b = SRMath.size(.p1080, screenW: 2880, screenH: 1800)
  ok("1080p on a 2880x1800 screen keeps the shape (1728x1080)", b.w == 1728 && b.h == 1080)
  let c = SRMath.size(.same, screenW: 3024, screenH: 1964)
  ok("same as screen is the screen", c.w == 3024 && c.h == 1964)
  let d = SRMath.size(.p720, screenW: 1280, screenH: 720)
  ok("720p on a 720 screen is the screen", d.w == 1280 && d.h == 720)
  let e = SRMath.size(.p1440, screenW: 2560, screenH: 1440)
  ok("1440p on a 1440 screen is not scaled", e.w == 2560 && e.h == 1440)
  ok("sizes are even", SRMath.size(.p720, screenW: 1441, screenH: 901).w % 2 == 0 && SRMath.size(.p720, screenW: 1441, screenH: 901).h % 2 == 0)
  ok("a bad screen size is small, never zero", SRMath.size(.p1080, screenW: 0, screenH: 0).w >= 2)
  ok("a 1080 screen offers 720p, 1080p and same, no more", SRMath.available(screenW: 1920, screenH: 1080) == [.p720, .p1080, .same])
  ok("a big screen offers all", SRMath.available(screenW: 3840, screenH: 2160) == [.p720, .p1080, .p1440, .p2160, .same])
  ok("a tiny screen still offers same", SRMath.available(screenW: 640, screenH: 480) == [.same])
  for r in SRResolution.allCases { let z = SRMath.size(r, screenW: 1920, screenH: 1080); ok("never above the screen: \(r)", z.w <= 1920 && z.h <= 1080) }
}

// ---- space per hour: sums from the real settings ----
do {
  var s = SRSettings()   // Calls, HEVC, 2 tracks
  let z = SRMath.size(s.resolution, screenW: 1920, screenH: 1080)
  let v = SRMath.videoBitrate(s, w: z.w, h: z.h)
  ok("Calls video bitrate: 1920x1080 x 15 x 0.07 x 0.6", v == Int(1920.0 * 1080 * 15 * 0.07 * 0.6))
  let per = SRMath.bytesPerHour(s, screenW: 1920, screenH: 1080)
  ok("an hour is video plus two sound tracks", per == Int64(v + 2 * 64_000) / 8 * 3600)
  s.computerSound = false
  ok("turning the computer sound off drops one track from the sum", SRMath.bytesPerHour(s, screenW: 1920, screenH: 1080) == Int64(v + 64_000) / 8 * 3600)
  s.codec = .h264
  ok("H.264 is bigger than HEVC", SRMath.bytesPerHour(s, screenW: 1920, screenH: 1080) > per)
  var t = SRSettings(); t.mode = .audioOnly
  ok("audio only counts the sound tracks alone: 2 x 64 kbit", SRMath.bytesPerHour(t, screenW: 1920, screenH: 1080) == Int64(128_000) / 8 * 3600)
  t.audioQuality = .high
  ok("High audio doubles it", SRMath.bytesPerHour(t, screenW: 1920, screenH: 1080) == Int64(256_000) / 8 * 3600)
  let tiny = SRPresets.apply(.tiny, to: SRSettings()), sharp = SRPresets.apply(.sharp, to: SRSettings())
  let bt = SRMath.bytesPerHour(tiny, screenW: 2880, screenH: 1800), bc = SRMath.bytesPerHour(SRSettings(), screenW: 2880, screenH: 1800), bs = SRMath.bytesPerHour(sharp, screenW: 2880, screenH: 1800)
  ok("Tiny < Calls < Sharp", bt < bc && bc < bs)
  ok("the words are plain", SRMath.spaceWords(450_000_000) == "about 450 MB an hour" && SRMath.spaceWords(1_234_000_000) == "about 1.2 GB an hour")
  ok("the video bitrate never goes silly", SRMath.videoBitrate(sharp, w: 7680, h: 4320) <= 80_000_000 && SRMath.videoBitrate(tiny, w: 2, h: 2) >= 250_000)
}

// ---- file names ----
do {
  let utc = TimeZone(identifier: "UTC")!
  let d = Date(timeIntervalSince1970: 1_763_078_400 + 14 * 3600 + 30 * 60)   // 2025-11-14 14:30 UTC
  ok("date then meeting name", SRNames.fileName(date: d, meeting: "Call with Sam", ext: "mov", taken: [], timeZone: utc) == "2025-11-14 Call with Sam.mov")
  ok("no meeting: Recording and the time with a dot", SRNames.fileName(date: d, meeting: nil, ext: "mov", taken: [], timeZone: utc) == "2025-11-14 Recording 14.30.mov")
  ok("a blank name counts as none", SRNames.fileName(date: d, meeting: "   ", ext: ".mov", taken: [], timeZone: utc) == "2025-11-14 Recording 14.30.mov")
  ok("slashes and colons are removed", SRNames.fileName(date: d, meeting: "Q3: plan/review", ext: "mov", taken: [], timeZone: utc) == "2025-11-14 Q3 plan review.mov")
  ok("a repeat gets 2, then 3", SRNames.fileName(date: d, meeting: "Call", ext: "mov", taken: ["2025-11-14 Call.mov"], timeZone: utc) == "2025-11-14 Call 2.mov" && SRNames.fileName(date: d, meeting: "Call", ext: "mov", taken: ["2025-11-14 Call.mov", "2025-11-14 Call 2.mov"], timeZone: utc) == "2025-11-14 Call 3.mov")
  ok("a long name is cut", SRNames.tidy(String(repeating: "a", count: 200)).count == 60)
  ok("a leading dot never hides the file", !SRNames.tidy("..hidden").hasPrefix("."))
  ok("audio only is .m4a, video .mov", SRNames.ext(.audioOnly) == "m4a" && SRNames.ext(.screenAndAudio) == "mov")
  ok("control letters are removed", !SRNames.tidy("a\u{0}b\nc").contains("\n"))
  ok("the time zone decides the day", SRNames.fileName(date: d, meeting: "X", ext: "mov", taken: [], timeZone: TimeZone(identifier: "Pacific/Auckland")!) == "2025-11-15 X.mov")
}

// ---- folder fallback ----
do {
  let big: Int64 = 100_000_000_000
  let def = SRFolderState(exists: true, writable: true, freeBytes: big)
  let need = SRFolder.needed(SRSettings(), screenW: 1920, screenH: 1080)
  ok("room needed is at least 1 GB", need >= 1_000_000_000)
  ok("no chosen folder: the default, no reason", SRFolder.plan(custom: nil, fallback: def, needed: need) == SRFolderPlan(useDefault: true, reason: nil, noRoom: false))
  ok("a good chosen folder is used", SRFolder.plan(custom: SRFolderState(exists: true, writable: true, freeBytes: big), fallback: def, needed: need).useDefault == false)
  let m = SRFolder.plan(custom: SRFolderState(exists: false, writable: false, freeBytes: 0), fallback: def, needed: need)
  ok("a missing folder (unplugged drive) falls back and says why", m.useDefault && m.reason == .missing && m.reason!.words.contains("plugged in"))
  let f = SRFolder.plan(custom: SRFolderState(exists: true, writable: true, freeBytes: 10), fallback: def, needed: need)
  ok("a nearly full folder falls back", f.useDefault && f.reason == .nearlyFull)
  let w = SRFolder.plan(custom: SRFolderState(exists: true, writable: false, freeBytes: big), fallback: def, needed: need)
  ok("a folder PS cannot write falls back", w.reason == .notWritable)
  let both = SRFolder.plan(custom: SRFolderState(exists: true, writable: true, freeBytes: 5), fallback: SRFolderState(exists: true, writable: true, freeBytes: 5), needed: need)
  ok("no room anywhere: says so", both.noRoom)
  let (ctl, p, c) = on(); p.screenState = .granted; p.micState = .granted
  ctl.folders = { (SRFolderState(exists: false, writable: false, freeBytes: 0), def) }
  _ = ctl.start()
  ok("a start with a missing folder records into the default and keeps the note", c.started.count == 1 && c.started[0].folderIsDefault && ctl.snapshot.folderNote?.contains("default folder") == true)
  let (c2, p2, cap2) = on(); p2.screenState = .granted; p2.micState = .granted
  c2.folders = { (nil, SRFolderState(exists: true, writable: true, freeBytes: 5)) }
  ok("a full default folder refuses to start", c2.start() == .noRoom && cap2.started.isEmpty)
}

// ---- leave out list ----
do {
  ok("PS itself is always left out", SRLeaveOut.excluded(chosen: [], own: "example.ps") == ["example.ps"])
  ok("the list plus PS, sorted, no repeats", SRLeaveOut.excluded(chosen: ["com.spotify.client", "com.spotify.client", " "], own: "example.ps") == ["com.spotify.client", "example.ps"])
  ok("toggle adds and removes", SRLeaveOut.toggle([], id: "a.b") == ["a.b"] && SRLeaveOut.toggle(["a.b"], id: "a.b") == [])
  ok("the list is capped", SRLeaveOut.clean((0..<200).map { "app.\($0)" }).count == 60)
  let (ctl, p, c) = on { $0.leftOut = ["com.spotify.client"] }; p.screenState = .granted; p.micState = .granted
  _ = ctl.start()
  ok("the plan carries the list and PS", c.started[0].excludedApps == ["com.spotify.client", "example.ps"])
}

// ---- the plan has the real numbers ----
do {
  let (ctl, p, c) = on { $0.resolution = .p720; $0.fps = 30; $0.quality = .high; $0.codec = .h264; $0.audioQuality = .high; $0.micUID = "uid-1" }
  p.screenState = .granted; p.micState = .granted
  ctl.screenInfo = { SRScreenInfo(width: 2560, height: 1440) }
  _ = ctl.start()
  let pl = c.started[0]
  ok("plan: size, fps, codec, audio, mic", pl.width == 1280 && pl.height == 720 && pl.fps == 30 && pl.codec == .h264 && pl.audioBitrate == 128_000 && pl.micUID == "uid-1" && pl.computerSound)
  ok("plan: bitrate from the same math", pl.videoBitrate == Int(1280.0 * 720 * 30 * 0.12 * 1.0))
}

// ---- private mode: signs hidden, recording keeps going, the time is real after ----
do {
  let (ctl, p, c) = on(); p.screenState = .granted; p.micState = .granted
  var t = T0
  ctl.now = { t }
  _ = ctl.start()
  t = at(65)
  let normal = ctl.snapshot.display(now: t, privateMode: false)
  ok("signs show: dot, pulsing, 1:05", normal.dot && normal.pulsing && normal.timer == "1:05" && !normal.paused)
  let hidden = ctl.snapshot.display(now: t, privateMode: true)
  ok("private mode hides the dot, the timer and the pause word", !hidden.dot && hidden.timer == nil && !hidden.paused && !hidden.pulsing)
  ok("and the recording is still going", ctl.snapshot.isRecording && ctl.snapshot.state == .recording && c.stopped == 0)
  t = at(600)
  ok("signs come back with the real time (10:00), not a frozen one", ctl.snapshot.display(now: t, privateMode: false).timer == "10:00")
  t = at(660); ctl.pause()
  t = at(900)
  ok("while paused the time stops", ctl.snapshot.elapsed(now: at(900)) == 660 && ctl.snapshot.display(now: at(900), privateMode: false).paused)
  ok("paused: no dot pulse", ctl.snapshot.display(now: at(900), privateMode: false).pulsing == false)
  ok("paused in private mode shows nothing", ctl.snapshot.display(now: at(900), privateMode: true).timer == nil)
  ctl.resume()
  t = at(960)
  ok("a pause does not count: 660 + 60 = 12:00", ctl.snapshot.display(now: t, privateMode: false).timer == "12:00")
  ok("nothing shows when not recording", SRSnapshot().display(now: t, privateMode: false) == SRSnapshot.Display(dot: false, pulsing: false, timer: nil, paused: false))
  ok("timer text with hours", SRSnapshot.timerText(3725) == "1:02:05" && SRSnapshot.timerText(-5) == "0:00" && SRSnapshot.timerText(59) == "0:59")
}

// ---- settings load tolerantly ----
do {
  let json = "{\"enabled\":true,\"fps\":99,\"resolution\":\"weird\",\"leftOut\":[\"a\",\"a\",\"\"],\"extra\":1}".data(using: .utf8)!
  let s = try! JSONDecoder().decode(SRSettings.self, from: json)
  ok("odd values keep their defaults", s.enabled && s.fps == 15 && s.resolution == .p1080 && s.leftOut == ["a"])
  let back = try! JSONDecoder().decode(SRSettings.self, from: JSONEncoder().encode(s))
  ok("round trip", back == s)
  ok("an empty file is the defaults", (try! JSONDecoder().decode(SRSettings.self, from: "{}".data(using: .utf8)!)) == SRSettings())
}

print("\n\(n - bad) of \(n) passed")
exit(bad == 0 ? 0 : 1)
