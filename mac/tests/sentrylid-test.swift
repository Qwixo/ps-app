// Unit tests for Sources/SentryLid.swift against a fake helper that runs the helper's real rules (Helper/LidCore.swift)
// on a fake kernel setting. Times are shrunk 300 times: 0.1 s here is PS's 30 s renewal, 0.3 s the helper's 90 s lease.
// Run: tests/sentrylid-test.sh
import Foundation

var fails = 0, checks = 0
func check(_ ok: Bool, _ what: String, line: Int = #line) { checks += 1; if !ok { fails += 1; print("FAIL (line \(line)): \(what)") } }
func spin(_ s: Double) { RunLoop.main.run(until: Date().addingTimeInterval(s)) }
func wait(_ timeout: Double, _ cond: () -> Bool) -> Bool {
  let end = Date().addingTimeInterval(timeout)
  while Date() < end { if cond() { return true }; spin(0.01) }
  return cond()
}
let SCALE = 300.0
func mono() -> Double { Double(clock_gettime_nsec_np(CLOCK_MONOTONIC)) / 1e9 }

final class FakeHelper: SentryLidLink {
  enum Mode { case normal, silent, invalid }
  let l = NSLock()
  let engine = LidEngine()
  var kernel = false
  var power = LidPower(onBattery: true, percent: 80, thermal: 0)
  var ready = true, readyDelay = 0.0
  var mode = Mode.normal
  var replyDelay = 0.0
  /// The kernel does not take on (the helper answers "failed"), as the helper of the previous PS did (V1.53 to V1.54).
  var kernelRefuses = false
  var onSends = 0, offSends = 0
  // The Sentry restart deadline, run with the helper's real rules (SentryRestart).
  var sentry: SentryDeadline?
  var boot = "boot-1"
  var restarts = 0, cancels = 0, arms = 0, reads = 0
  var console: ConsoleSession = .unlocked, seen: ConsoleSession?
  var sessions = Set<String>()
  let t0 = mono()

  init() { run(engine.start(actual: false)) }
  func now() -> Double { (mono() - t0) * SCALE }
  private func run(_ a: [LidAction]) { for x in a { if case .set(let b) = x { kernel = b } } }

  /// The helper's own 2 s check, also run on its own between requests.
  func tick() {
    l.lock()
    run(engine.tick(now: now(), power: power, actual: kernel))
    let before = seen; seen = console
    if sentry != nil && SentryRestart.unlockCancels(previous: before, now: console) { sentry = nil }
    switch SentryRestart.due(sentry, boot: boot, now: now(), signedIn: true) {
    case .fire: sentry = nil; restarts += 1
    case .drop: sentry = nil
    case .none: break
    }
    l.unlock()
  }
  /// The Mac restarted: a new boot, and the helper starts again (loading what is on disk).
  func reboot() { l.lock(); boot += "x"; sentry = SentryRestart.loaded(sentry, damaged: false, boot: boot).keep; l.unlock() }

  func sendRestart(_ json: Data, done: @escaping (SentryLidAnswer) -> Void) {
    l.lock()
    let m = mode
    guard let j = try? JSONSerialization.jsonObject(with: json) as? [String: Any], let r = SentryRestartRequest.parse(j) else {
      l.unlock(); print("FAIL: PS sent a restart request the helper would refuse: \(String(data: json, encoding: .utf8) ?? "")"); fails += 1; return done(.error("bad"))
    }
    if m == .silent { l.unlock(); return }
    if m == .invalid { l.unlock(); return done(.missing) }
    let n = now(), w = Date().timeIntervalSince1970
    var out: [String: Any]
    switch r {
    case .read: reads += 1; out = SentryRestart.reply(sentry, now: n, wall: w)
    case .cancel: cancels += 1; sentry = nil; out = ["ok": true]
    case .arm(let secs):
      arms += 1
      if let d = SentryRestart.arm(seconds: secs, boot: boot, now: n, wall: w) { sentry = d; seen = console; out = SentryRestart.reply(d, now: n, wall: w) }
      else { out = SentryRestart.reply(sentry, now: n, wall: w, ok: false, why: "range") }
    }
    let reply = try! JSONSerialization.data(withJSONObject: out)
    l.unlock()
    if replyDelay > 0 { DispatchQueue.global().asyncAfter(deadline: .now() + replyDelay) { done(.reply(reply)) } }
    else { DispatchQueue.global().async { done(.reply(reply)) } }
  }
  var armed: Bool { l.lock(); defer { l.unlock() }; return sentry != nil }
  var restartCount: Int { l.lock(); defer { l.unlock() }; return restarts }

  func helperReady() -> Bool {
    if Thread.isMainThread { print("FAIL: helperReady on the main thread"); fails += 1 }
    if readyDelay > 0 { Thread.sleep(forTimeInterval: readyDelay) }
    return ready
  }

  func send(_ json: Data, done: @escaping (SentryLidAnswer) -> Void) {
    l.lock()
    let m = mode
    guard let j = try? JSONSerialization.jsonObject(with: json) as? [String: Any], let r = LidRequest.parse(j) else {
      l.unlock(); print("FAIL: PS sent a request the helper would refuse: \(String(data: json, encoding: .utf8) ?? "")"); fails += 1; return done(.error("bad"))
    }
    if r.on { onSends += 1; sessions.insert(r.session) } else { offSends += 1 }
    if m == .silent { l.unlock(); return }
    if m == .invalid { l.unlock(); return done(.missing) }
    run(engine.tick(now: now(), power: power, actual: kernel))
    let out = engine.request(r, now: now(), power: power, allowed: true)
    var answer = out.reply
    if kernelRefuses && out.actions.contains(where: { if case .set(true) = $0 { return true }; return false }) {
      run(engine.applyFailed()); answer = engine.replyNow
    } else { run(out.actions) }
    let reply = try! JSONSerialization.data(withJSONObject: answer)
    l.unlock()
    if replyDelay > 0 { DispatchQueue.global().asyncAfter(deadline: .now() + replyDelay) { done(.reply(reply)) } }
    else { DispatchQueue.global().async { done(.reply(reply)) } }
  }
  func set(_ f: (FakeHelper) -> Void) { l.lock(); f(self); l.unlock() }
  var on: Bool { l.lock(); defer { l.unlock() }; return engine.on && kernel }
  var sends: Int { l.lock(); defer { l.unlock() }; return onSends }
}

func make(_ h: FakeHelper) -> (SentryLid, () -> [String]) {
  let s = SentryLid(link: h, renewEvery: 0.1, giveUpAfter: 0.3, replyWithin: 0.15, probeFor: 0.25, probeEvery: 0.05)
  var got: [String] = []
  s.onAutoStop = { r in
    if !Thread.isMainThread { print("FAIL: onAutoStop off the main thread"); fails += 1 }
    got.append(SentryLidCore.describe(r))
  }
  s.onRestartProblem = { r in
    if !Thread.isMainThread { print("FAIL: onRestartProblem off the main thread"); fails += 1 }
    got.append("restart " + SentryLidCore.describe(r))
  }
  return (s, { got })
}

// The contract: what PS sends is exactly what the helper accepts.
check(LidRequest.parse((try! JSONSerialization.jsonObject(with: SentryLidCore.body(on: true, session: UUID().uuidString, battery: 10))) as! [String: Any]) != nil,
      "PS's request body parses in the helper")
check(SentryLidCore.batteryFloor(nil) == 10 && SentryLidCore.batteryFloor(25) == 25 && SentryLidCore.batteryFloor(4) == 10
      && SentryLidCore.batteryFloor(51) == 10 && SentryLidCore.batteryFloor(5) == 5 && SentryLidCore.batteryFloor(50) == 50, "battery floor: 5 to 50, else 10")
for w in ["battery", "hot", "lease", "failed", "notAllowed", "safeMode", "off", "invalid"] {
  check(LidStop(rawValue: w) != nil, "the helper has the why \(w) PS reads")
}
check(SentryLidCore.describe(SentryLidCore.reason(why: "battery")) == "battery low", "why battery: batteryLow")
check(SentryLidCore.describe(SentryLidCore.reason(why: "hot")) == "too hot", "why hot: tooHot")
check(SentryLidCore.describe(SentryLidCore.reason(why: "lease")).hasPrefix("other:"), "why lease: other")
if case .refused = SentryLidCore.reason(why: "failed") {} else { check(false, "why failed: refused (retried before it counts)") }
check(SentryLidCore.describe(SentryLidCore.reason(why: nil)).hasPrefix("other:"), "no why: other")
if case .retry = SentryLidCore.outcome(.reply(Data("nope".utf8))) {} else { check(false, "an unreadable reply is retried, not trusted") }
if case .active = SentryLidCore.outcome(.reply(Data(#"{"ok":false,"on":true,"why":"notAllowed"}"#.utf8))) { check(false, "on but not ok is not active") }

// 1. No helper set up: helperMissing at once, nothing sent, and set() never blocks the main thread.
do {
  let h = FakeHelper(); h.ready = false; h.readyDelay = 0.3
  let (s, got) = make(h)
  let t = mono(); s.set(enabled: true); let took = mono() - t
  check(took < 0.05, "set(enabled:) returns at once even while macOS is slow to answer (\(took) s)")
  let t2 = mono(); _ = s.isActive; check(mono() - t2 < 0.05, "isActive does not wait for the helper")
  check(!s.isActive && got().isEmpty, "not told at once: it may be switched on in a moment")
  check(wait(1.5) { got() == ["helper missing"] }, "helper not set up: helperMissing after the wait")
  check(!s.isActive && h.sends == 0, "not active, nothing sent")
}

// 2. Normal run: on, kept alive by renewals well past the lease, then off.
do {
  let h = FakeHelper()
  let (s, got) = make(h)
  s.set(enabled: true); s.set(enabled: true)
  check(wait(0.5) { s.isActive }, "on")
  check(h.on, "the helper has it on")
  spin(0.75)   // 225 helper seconds, two and a half leases
  h.tick()
  check(s.isActive && h.on, "still on after 2.5 leases: the renewals keep it")
  check(h.sends >= 5, "renewed every 30 s (\(h.sends) sends)")
  check(h.sessions.count == 1, "set(true) twice is one session")
  s.set(enabled: false)
  check(wait(0.5) { !h.on }, "off in the helper")
  check(!s.isActive && got().isEmpty, "off here, and no auto stop for an off PS asked for")
  let n = h.sends; spin(0.3)
  check(h.sends == n, "no renewals after off")
}

// 3. Battery falls below the floor mid run: the helper stops it, PS is told batteryLow and stops renewing.
do {
  let h = FakeHelper()
  let (s, got) = make(h)
  s.set(enabled: true)
  check(wait(0.5) { s.isActive }, "on")
  h.set { $0.power = LidPower(onBattery: true, percent: 9, thermal: 0) }
  h.tick()
  check(!h.on, "the helper turned it off by itself")
  check(wait(0.5) { got() == ["battery low"] }, "PS is told batteryLow")
  check(!s.isActive, "not active")
  let n = h.sends; spin(0.3)
  check(h.sends == n, "no renewals after the cutoff")
  h.set { $0.power = LidPower(onBattery: false, percent: 9, thermal: 0) }
  s.set(enabled: true)
  check(wait(0.5) { s.isActive }, "plugged in, Sentry mode asks again: on (a new session)")
  s.set(enabled: false)
}

// 4. Too hot when starting.
do {
  let h = FakeHelper(); h.power = LidPower(onBattery: false, percent: nil, thermal: 2)
  let (s, got) = make(h)
  s.set(enabled: true)
  check(wait(0.5) { got() == ["too hot"] } && !s.isActive && !h.on, "seriously hot: never on, PS told tooHot")
}

// 5. The helper goes quiet after it was on: given up after the lease, other("stopped answering").
do {
  let h = FakeHelper()
  let (s, got) = make(h)
  s.set(enabled: true)
  check(wait(0.5) { s.isActive }, "on")
  h.set { $0.mode = .silent }
  spin(0.2)
  check(s.isActive && got().isEmpty, "one missed renewal: still trusted (the helper's lease decides)")
  check(wait(1) { got().count == 1 }, "given up")
  check(got().first?.contains("stopped answering") == true && !s.isActive, "told the helper stopped answering")
  h.tick(); check(!h.on, "and the helper's lease turned it off by itself")
}

// 6. A helper that never answers at all: helperMissing after the wait.
do {
  let h = FakeHelper(); h.mode = .silent
  let (s, got) = make(h)
  s.set(enabled: true)
  check(wait(1) { got() == ["helper missing"] } && !s.isActive, "never answered: helperMissing")
}

// 7. The helper switched off mid run (XPC invalid): helperMissing at once.
do {
  let h = FakeHelper()
  let (s, got) = make(h)
  s.set(enabled: true)
  check(wait(0.5) { s.isActive }, "on")
  h.set { $0.mode = .invalid }
  check(wait(1) { got() == ["helper missing"] } && !s.isActive, "switched off mid run: helperMissing after the wait")
}

// 8. A slow answer that lands after off never turns it on again here, and quick on, off, on is one live session.
do {
  let h = FakeHelper(); h.replyDelay = 0.05
  let (s, got) = make(h)
  s.set(enabled: true); s.set(enabled: false)
  spin(0.2)
  check(!s.isActive && got().isEmpty, "the late answer to an on that was then turned off is ignored")
  check(wait(0.3) { !h.on }, "and the helper ends up off")
  s.set(enabled: true); s.set(enabled: false); s.set(enabled: true)
  check(wait(0.5) { s.isActive && h.on }, "on, off, on: on")
  check(got().isEmpty, "no auto stops on the way")
  s.set(enabled: false)
  check(wait(0.5) { !h.on }, "off")
}

// 9. The helper's lease with PS gone: PS renews, then stops renewing (as if it quit): the helper turns it off.
do {
  let h = FakeHelper()
  var s: SentryLid? = SentryLid(link: h, renewEvery: 0.1, giveUpAfter: 0.3, replyWithin: 0.15)
  s!.set(enabled: true)
  check(wait(0.5) { s!.isActive }, "on")
  h.set { $0.mode = .silent }   // nothing more reaches the helper, as if PS hung
  s = nil
  spin(0.35); h.tick()
  check(!h.on, "no renewal for over 90 helper seconds: off")
}

// ===== Sentry restart deadline (helper times x300: 8 h is 96 s here, 5 min is 1 s) =====
check(SentryRestartRequest.parse((try! JSONSerialization.jsonObject(with: SentryLidCore.restartBody(.arm(28800)))) as! [String: Any]) == .arm(28800), "PS's arm body parses in the helper")
check(SentryRestartRequest.parse((try! JSONSerialization.jsonObject(with: SentryLidCore.restartBody(.cancel))) as! [String: Any]) == .cancel, "PS's cancel body parses")
check(SentryRestartRequest.parse((try! JSONSerialization.jsonObject(with: SentryLidCore.restartBody(.read))) as! [String: Any]) == .read, "PS's read body parses")

// 10. Arm: the deadline shows; it fires with PS gone (killed or hung), and the restart clears it (no boot loop).
do {
  let h = FakeHelper()
  var s: SentryLid? = make(h).0
  let t = Date()
  let t0 = mono(); s!.armRestart(after: 8 * 3600); check(mono() - t0 < 0.05, "armRestart returns at once")
  check(wait(0.5) { s!.restartDeadline != nil }, "the deadline shows")
  if let d = s!.restartDeadline { check(abs(d.timeIntervalSince(t) - 8 * 3600) < 60, "about 8 hours ahead (\(d.timeIntervalSince(t)))") }
  h.reboot(); h.tick()
  check(!h.armed && h.restartCount == 0, "a restart some other way (power, update) clears it: nothing fires in the new boot")
  s!.armRestart(after: 300)
  check(wait(0.5) { h.armed }, "armed again for 5 min")
  h.set { $0.mode = .silent }   // PS hangs: nothing more reaches the helper
  s = nil                       // or is gone altogether
  spin(1.1); h.tick()
  check(h.restartCount == 1, "fired with PS gone")
  h.set { $0.mode = .normal }
  h.reboot(); spin(1.1); h.tick()
  check(h.restartCount == 1, "after the restart nothing is left to fire: no boot loop")
}

// 11. Cancel after unlock clears it; nothing fires.
do {
  let h = FakeHelper()
  let (s, got) = make(h)
  s.armRestart(after: 300)
  check(wait(0.5) { s.restartDeadline != nil }, "armed")
  s.cancelRestart()
  check(wait(0.5) { s.restartDeadline == nil && !h.armed }, "cancelled here and in the helper")
  spin(1.1); h.tick()
  check(h.restartCount == 0 && got().isEmpty, "nothing fired, no auto stop")
}

// 12. A cancel that does not get through is sent again until the helper confirms it.
do {
  let h = FakeHelper()
  let (s, _) = make(h)
  s.armRestart(after: 300)
  check(wait(0.5) { s.restartDeadline != nil }, "armed")
  h.set { $0.mode = .silent }
  s.cancelRestart()
  spin(0.3)
  check(s.restartDeadline != nil && h.armed, "not confirmed: the countdown still shows the truth")
  h.set { $0.mode = .invalid }
  spin(0.3)
  check(s.restartDeadline != nil, "helper unreachable: still not cleared here")
  h.set { $0.mode = .normal }
  check(wait(0.6) { s.restartDeadline == nil && !h.armed }, "helper back: the cancel got through")
  check(h.cancels >= 1, "sent again (\(h.cancels) cancels arrived)")
}

// 13. Quick arm then cancel, and a slow arm answer after the cancel: ends cancelled.
do {
  let h = FakeHelper(); h.replyDelay = 0.05
  let (s, _) = make(h)
  s.armRestart(after: 600); s.cancelRestart()
  spin(0.3)
  check(s.restartDeadline == nil && !h.armed, "arm then cancel: cancelled")
  s.armRestart(after: 600); s.armRestart(after: 900)
  check(wait(0.5) { s.restartDeadline != nil && h.armed }, "armed twice: the last one stands")
  s.cancelRestart()
  check(wait(0.5) { !h.armed && s.restartDeadline == nil }, "and cancelled")
}

// 14. No helper: helperMissing; a time out of range: other; a PS started again reads the deadline.
do {
  let h = FakeHelper(); h.ready = false
  let (s, got) = make(h)
  s.armRestart(after: 300)
  check(wait(0.5) { got() == ["restart helper missing"] } && s.restartDeadline == nil, "no helper: helperMissing (a restart problem)")
  check(h.arms == 0, "nothing sent")
  let h2 = FakeHelper()
  let (s2, got2) = make(h2)
  s2.armRestart(after: 60)
  check(wait(0.5) { got2().count == 1 } && got2().first?.contains("5 minutes") == true && !h2.armed, "1 minute: refused, told the range")
  s2.armRestart(after: 3600)
  check(wait(0.5) { h2.armed }, "an hour: armed")
  let (s3, _) = make(h2)   // PS crashed and started again
  check(wait(0.5) { s3.restartDeadline != nil }, "the new PS reads the deadline from the helper")
  s3.cancelRestart()
  check(wait(0.5) { !h2.armed }, "and can cancel it")
  _ = s
}

// 15. The helper goes away mid countdown and an arm is not answered: given up with a message, never hangs.
do {
  let h = FakeHelper(); h.mode = .silent
  let (s, got) = make(h)
  s.armRestart(after: 600)
  check(wait(1.2) { got().count == 1 } && got().first?.hasPrefix("restart ") == true && got().first?.contains("did not take") == true, "unanswered arm: told after the wait")
  check(s.restartDeadline == nil, "no deadline shown")
}

// 16. PS crashed and is never opened again: a real macOS lock and unlock cancels the restart in the helper by itself.
do {
  let h = FakeHelper()
  var s: SentryLid? = make(h).0
  s!.armRestart(after: 300)
  check(wait(0.5) { h.armed }, "armed")
  s = nil; h.set { $0.mode = .silent }    // PS gone
  h.tick(); check(h.armed, "Sentry's own cover (unlocked all along): still armed")
  h.set { $0.console = .locked }; h.tick(); check(h.armed, "locked: still armed")
  h.set { $0.console = .unlocked }; h.tick()
  check(!h.armed, "unlocked with the lock screen: cancelled by the helper")
  spin(1.1); h.tick()
  check(h.restartCount == 0, "and nothing fires later")
}

// 17. V1.54: the helper of the previous PS still answering after an update (macOS says no), then PS switched on
//     again and the new helper answers: retried with fresh sessions, on, and never told it stopped.
do {
  let h = FakeHelper(); h.kernelRefuses = true
  let (s, got) = make(h)
  s.set(enabled: true)
  spin(0.12)
  check(!s.isActive && got().isEmpty && !h.on, "refused at first: not on, and nothing shown yet")
  check(h.sessions.count > 1, "each retry is a fresh session (\(h.sessions.count))")
  h.set { $0.kernelRefuses = false }
  check(wait(0.5) { s.isActive && h.on }, "the new helper takes it: on")
  spin(0.3)
  check(got().isEmpty && s.isActive, "never told it stopped")
  s.set(enabled: false)
  check(wait(0.5) { !h.on }, "off")
}

// 18. macOS keeps saying no: told once after the wait, as refused, then nothing more is sent.
do {
  let h = FakeHelper(); h.kernelRefuses = true
  let (s, got) = make(h)
  s.set(enabled: true)
  check(wait(1) { got().count == 1 }, "given up after the wait")
  check(got().first?.hasPrefix("refused") == true && !s.isActive && !h.on, "told refused, not active")
  let n = h.sends; spin(0.3)
  check(h.sends == n && got().count == 1, "no more sends, told once")
}

// 19. The helper switched on a moment after Sentry mode started: on, never told it was missing.
do {
  let h = FakeHelper(); h.ready = false
  let (s, got) = make(h)
  s.set(enabled: true)
  spin(0.1)
  h.set { $0.ready = true }
  check(wait(0.5) { s.isActive && h.on }, "on once it is switched on")
  check(got().isEmpty, "never told helper missing")
  s.set(enabled: false)
}

// 20. A Sentry restart problem says nothing about the lid: the lid stays on and onAutoStop is never called.
do {
  let h = FakeHelper()
  let (s, got) = make(h)
  var lidStops = 0
  let keep = s.onAutoStop; s.onAutoStop = { r in lidStops += 1; keep?(r) }
  s.set(enabled: true)
  check(wait(0.5) { s.isActive }, "on")
  s.armRestart(after: 60)   // out of range: the helper refuses it
  check(wait(0.5) { got().count == 1 } && got().first?.hasPrefix("restart other:") == true, "the restart problem is told as a restart problem")
  spin(0.2)
  check(lidStops == 0 && s.isActive && h.on, "and the lid keep awake is untouched")
  s.set(enabled: false)
}

// 21. V1.54 the check before engaging: it works, so the kernel ends up off again and nothing is told.
func probed(_ s: SentryLid) -> (done: () -> Bool, gap: () -> SentryLid.Gap?, main: () -> Bool) {
  var d = false, g: SentryLid.Gap?, m = true
  s.probe { x in m = Thread.isMainThread; g = x; d = true }
  return ({ d }, { g }, { m })
}
do {
  let h = FakeHelper()
  let (s, got) = make(h)
  let p = probed(s)
  check(wait(1) { p.done() } && p.gap() == nil && p.main(), "works: no gap, answered on the main thread")
  check(wait(0.5) { !h.on && !h.kernel }, "the switch is back off after the check")
  check(h.sends == 1 && got().isEmpty && !s.isActive, "one on, no stop told, no session")
}
// 22. The previous PS's helper (macOS says no): retried for the check's few seconds, then refused.
do {
  let h = FakeHelper(); h.kernelRefuses = true
  let (s, _) = make(h)
  let t = mono(); let p = probed(s)
  check(wait(1) { p.done() } && p.gap() == .refused, "refused")
  check(mono() - t >= 0.2 && h.sends >= 3, "retried before calling it broken (\(h.sends) tries)")
}
// 23. The helper not switched on: helper. Switched on during the check: it works.
do {
  let h = FakeHelper(); h.ready = false
  let (s, _) = make(h)
  let p = probed(s)
  check(wait(1) { p.done() } && p.gap() == .helper && h.sends == 0, "not on: helper, nothing sent")
  let h2 = FakeHelper(); h2.ready = false
  let (s2, _) = make(h2)
  let p2 = probed(s2)
  spin(0.08); h2.set { $0.ready = true }
  check(wait(1) { p2.done() } && p2.gap() == nil, "switched on a moment later: works")
}
// 24. A helper that never answers: helper. Battery low or too hot: not a lid fault, no row.
do {
  let h = FakeHelper(); h.mode = .silent
  let (s, _) = make(h)
  let p = probed(s)
  check(wait(2) { p.done() } && p.gap() == .helper, "no answer: helper")
  check(SentryLidCore.probeGap(.reply(Data(#"{"ok":false,"on":false,"why":"battery"}"#.utf8))) == nil
        && SentryLidCore.probeGap(.reply(Data(#"{"ok":false,"on":false,"why":"hot"}"#.utf8))) == nil, "battery or heat: no row")
  check(SentryLidCore.probeGap(.reply(Data(#"{"ok":false,"on":false,"why":"failed"}"#.utf8))) == .refused
        && SentryLidCore.probeGap(.missing) == .helper && SentryLidCore.probeGap(.error("x")) == .helper, "failed: refused; missing or no answer: helper")
}
// 25. While Sentry mode has it on, the check sends nothing and says it works.
do {
  let h = FakeHelper()
  let (s, _) = make(h)
  s.set(enabled: true)
  check(wait(0.5) { s.isActive }, "on")
  let n = h.sends + 0
  let p = probed(s)
  check(wait(0.5) { p.done() } && p.gap() == nil && s.isActive && h.on, "nil, and Sentry's lid is untouched")
  check(h.sessions.count == 1, "no probe session sent (\(n) sends before)")
  s.set(enabled: false)
}

print(fails == 0 ? "SENTRY LID: all \(checks) checks ok" : "SENTRY LID: \(fails) of \(checks) checks FAILED")
exit(fails == 0 ? 0 : 1)
