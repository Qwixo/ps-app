// Sentry mode's lid closed keep awake (V1.48), PS's half. The Mac really stays awake with the lid closed (also on
// battery) only through the restart helper (Helper/rebootd.swift, root): it sets the kernel's clamshell switch (closing
// the lid does not sleep the Mac; kernel memory only, nothing on disk), and its rules live in Helper/LidCore.swift.
// PS's own no idle sleep assertion (Sentry.swift) keeps it from idle sleep meanwhile.
//
// PS only asks, and keeps asking: set(enabled: true) starts a session and renews it every 30 s; the helper turns it
// off by itself 90 s after the last renewal (PS quit, crashed or hung), at every helper start and boot, when the
// battery is at or below the floor (10% unless `sentry.lidBatteryFloor` says 5 to 50) on battery power, and when the
// Mac is seriously hot. When the helper stops it, or the helper is not set up, onAutoStop says why on the main
// thread: helperMissing means the UI should offer "Set up the helper" (Security, the restart helper).
//
// V1.54 (the developer: "on 1.53, it still shows the text about ... sleep when lid closed in yellow"): onAutoStop means the lid
// keep awake has truly stopped. The helper not switched on, not reachable, or answering "failed" is first retried for
// up to 90 s (every 5 s, a fresh session each time, since the helper never turns a stopped session on again): right
// after an update that pins a new helper, the helper of the previous PS keeps running and answering (with its old
// code) until PS is switched on again in Login Items, and a helper switched on a moment ago needs a moment too.
// Problems with the Sentry restart deadline go to onRestartProblem, never onAutoStop: they say nothing about the lid.
//
// V1.54 (the developer: "before you even engage sentry mode it should come up saying that. And you should be able to fix it
// before you actually [start] the sentry mode"): probe(done:) checks it really works before Sentry mode engages, by
// turning it on and straight back off, retried for a few seconds. The AI button (the page) and Sleep mode's AI Sentry
// mode button show the result as a lid row in the pre engage pop up. The Sentry screen never shows lid text.
//
// Sentry restart (the developer, V1.48): armRestart(after:) when Sentry mode engages (if his setting is on) asks the helper to
// restart the Mac at that deadline, back to the FileVault password, unless cancelRestart() comes first (only after a
// real Touch ID or password unlock). The helper keeps the deadline itself: it fires even if PS is killed, hangs or
// crashes, and the restart clears it (never a boot loop). A cancel is sent again until the helper confirms it.
// restartDeadline is the helper's own deadline, for the countdown; a PS that starts again reads it from the helper.
//
// Nothing here runs on the main thread: every helper call, macOS's helper status and the renewals run on one
// queue of their own, and set(enabled:), armRestart and cancelRestart return at once. A test copy never reaches the real helper (IS_TEST_COPY):
// it always answers helperMissing.
import Foundation
import ServiceManagement

final class SentryLid {
  static let shared = SentryLid()
  enum StopReason { case batteryLow, tooHot, helperMissing, refused, other(String) }
  /// Called on the main thread when the lid keep awake stopped without set(enabled: false), or could not start
  /// (after the retries: see the top of this file). Only ever about the lid.
  var onAutoStop: ((StopReason) -> Void)?
  /// Called on the main thread when the Sentry restart deadline could not be armed. Never about the lid.
  var onRestartProblem: ((StopReason) -> Void)?

  /// Starts (true) or stops (false) the lid keep awake. Returns at once; the outcome shows in isActive and onAutoStop.
  func set(enabled: Bool) { q.async { enabled ? self.begin() : self.end() } }

  /// The helper confirmed it is on and nothing has stopped it since.
  var isActive: Bool { lock.lock(); defer { lock.unlock() }; return active }

  /// Called when Sentry mode engages, if the restart setting is on: the Mac restarts after `seconds` (5 minutes to
  /// 7 days) unless cancelRestart() comes first. Arming again moves the deadline. Problems arrive through onAutoStop.
  func armRestart(after seconds: TimeInterval) { q.async { self.arm(seconds) } }
  /// Called only after a successful Touch ID or password unlock. Sent again until the helper confirms it.
  func cancelRestart() { q.async { self.cancel() } }
  /// When the helper will restart the Mac, as the helper says (nil: no restart armed, or not known yet).
  var restartDeadline: Date? { lock.lock(); defer { lock.unlock() }; return deadline }

  /// What the check before engaging found: the helper is not on (not set up, switched off or not answering), or macOS
  /// did not take it (also the previous PS's helper right after an update). Nil: it works.
  enum Gap: String { case helper, refused }
  /// V1.54: turns the lid keep awake on and straight back off to see it really works, trying again every second for a
  /// few seconds first (a helper switched on a moment ago needs a moment). `done` once, on the main thread. While a
  /// session runs (Sentry mode engaged) it answers nil at once and sends nothing.
  func probe(done: @escaping (Gap?) -> Void) { q.async { self.probeTry(started: self.now(), done) } }

  // MARK: inside

  private let link: SentryLidLink
  private let renewEvery: Double, giveUpAfter: Double, replyWithin: Double
  private let q = DispatchQueue(label: "ps.sentry.lid", qos: .userInitiated)
  private let lock = NSLock()
  private var active = false
  private var deadline: Date?
  // Only on q from here on.
  private var session: String?
  private var timer: DispatchSourceTimer?
  private var startedAt = 0.0, lastGood = 0.0, everGood = false
  /// A retry of the lid is waiting (the renewal timer leaves it alone meanwhile), and its first line was logged.
  private var retryWaiting = false, retryLogged = false
  /// Every arm and cancel bumps it, so an older arm's or cancel's late answers and retries do nothing.
  private var restartGen = 0
  /// A restart deadline was confirmed (or read) in this run: a cancel keeps trying even while the helper is unreachable.
  private var hadDeadline = false

  private let probeFor: Double, probeEvery: Double

  /// Tests pass a fake link and short times; PS uses the real helper and 30 s, 90 s, 10 s, and probes for 5 s, every 1 s.
  init(link: SentryLidLink = SentryLidXPC(), renewEvery: Double = 30, giveUpAfter: Double = 90, replyWithin: Double = 10,
       probeFor: Double = 5, probeEvery: Double = 1) {
    self.link = link; self.renewEvery = renewEvery; self.giveUpAfter = giveUpAfter; self.replyWithin = replyWithin
    self.probeFor = probeFor; self.probeEvery = probeEvery
    q.async { self.readDeadline() }   // a PS started again learns of a deadline armed before it quit or crashed
  }

  /// Retries of an arm or a cancel: every 5 s in PS.
  private var retryEvery: Double { renewEvery / 6 }

  /// Seconds on a clock that counts sleep and ignores clock changes (Darwin's CLOCK_MONOTONIC).
  private func now() -> Double { Double(clock_gettime_nsec_np(CLOCK_MONOTONIC)) / 1e9 }

  private func setActive(_ on: Bool) { lock.lock(); active = on; lock.unlock() }
  private func setDeadline(_ d: Date?) { lock.lock(); deadline = d; lock.unlock() }
  private func notify(_ r: StopReason) {
    psLog("sentry restart: \(SentryLidCore.describe(r))")
    DispatchQueue.main.async { self.onRestartProblem?(r) }
  }

  // MARK: the restart deadline

  private func readDeadline() {
    let g = restartGen
    guard link.helperReady() else { return }
    call(SentryLidCore.restartBody(.read), restart: true) { a in
      guard self.restartGen == g, case .deadline(let d) = SentryLidCore.restartOutcome(a) else { return }
      self.setDeadline(d); self.hadDeadline = d != nil
      if d != nil { psLog("sentry restart: the helper has a deadline armed") }
    }
  }

  private func arm(_ secs: Double) {
    restartGen += 1
    let g = restartGen
    guard link.helperReady() else { return notify(.helperMissing) }
    armTry(secs, g, started: now())
  }

  private func armTry(_ secs: Double, _ g: Int, started: Double) {
    call(SentryLidCore.restartBody(.arm(secs)), restart: true) { a in
      guard self.restartGen == g else { return }
      switch SentryLidCore.restartOutcome(a) {
      case .deadline(let d):
        self.setDeadline(d); self.hadDeadline = d != nil
        psLog("sentry restart: armed")
      case .refused(let r): self.notify(r)
      case .missing: self.notify(.helperMissing)
      case .retry(let e):
        if self.now() - started >= self.giveUpAfter { return self.notify(.other("The helper did not take the Sentry restart time")) }
        psLog("sentry restart: arm not answered (\(e)), trying again")
        self.q.asyncAfter(deadline: .now() + self.retryEvery) { if self.restartGen == g { self.armTry(secs, g, started: started) } }
      }
    }
  }

  private func cancel() {
    restartGen += 1
    cancelTry(restartGen)
  }

  /// Keeps going until the helper confirms: a cancel that never arrived would restart a Mac the developer is using.
  private func cancelTry(_ g: Int) {
    call(SentryLidCore.restartBody(.cancel), restart: true) { a in
      guard self.restartGen == g else { return }
      let o = SentryLidCore.restartOutcome(a)
      var again: Double?
      switch o {
      case .deadline:
        if self.hadDeadline || self.restartDeadline != nil { psLog("sentry restart: cancelled") }
        self.setDeadline(nil); self.hadDeadline = false
      case .refused(let r):
        if case .other(let why) = r, why == SentryLidCore.safeModeText { self.setDeadline(nil); self.hadDeadline = false }   // an inert helper never fires
        else { again = self.renewEvery }
      case .missing:
        // No helper to reach. If one was armed in this run it may come back in this boot, so keep trying.
        if self.hadDeadline || self.restartDeadline != nil { again = self.renewEvery }
      case .retry: again = self.retryEvery
      }
      if let w = again {
        psLog("sentry restart: cancel not confirmed yet, trying again")
        self.q.asyncAfter(deadline: .now() + w) { if self.restartGen == g { self.cancelTry(g) } }
      }
    }
  }

  // MARK: the check before engaging (V1.54)

  private func probeTry(started: Double, _ done: @escaping (Gap?) -> Void) {
    func finish(_ g: Gap?) {
      psLog("sentry lid: the check before engaging: \(g.map { $0 == .helper ? "the helper is not on" : "macOS said no" } ?? "it works")")
      DispatchQueue.main.async { done(g) }
    }
    func again(_ g: Gap) {
      if now() - started + probeEvery > probeFor { return finish(g) }
      q.asyncAfter(deadline: .now() + probeEvery) { self.probeTry(started: started, done) }
    }
    if session != nil { return finish(nil) }   // Sentry mode is on and has it: nothing to check, nothing to send
    guard link.helperReady() else { return again(.helper) }
    let s = UUID().uuidString, floor = SentryLidCore.batteryFloor()
    call(SentryLidCore.body(on: true, session: s, battery: floor), restart: false, within: min(replyWithin, 3)) { a in
      let g = SentryLidCore.probeGap(a)
      // Straight back off (whatever the answer: off is only ever safer). Sent before `done`, so it is always ahead of
      // the on of a Sentry mode engaged right after (XPC keeps one connection's messages in order).
      if case .reply = a { self.link.send(SentryLidCore.body(on: false, session: s, battery: floor)) { _ in } }
      if let g { again(g) } else { finish(nil) }
    }
  }

  /// One request with a time limit; `then` runs once, on q.
  private func call(_ json: Data, restart: Bool, within: Double? = nil, then: @escaping (SentryLidAnswer) -> Void) {
    final class Once { var done = false }
    let once = Once()
    let cb: (SentryLidAnswer) -> Void = { [weak self] a in self?.q.async { guard !once.done else { return }; once.done = true; then(a) } }
    if restart { link.sendRestart(json, done: cb) } else { link.send(json, done: cb) }
    let limit = within ?? replyWithin
    q.asyncAfter(deadline: .now() + limit) {
      guard !once.done else { return }; once.done = true; then(.error("no answer within \(Int(limit)) s"))
    }
  }

  // MARK: the lid keep awake

  private func begin() {
    guard session == nil else { return }   // already running or starting
    let s = UUID().uuidString
    session = s; startedAt = now(); lastGood = 0; everGood = false; retryWaiting = false; retryLogged = false
    let t = DispatchSource.makeTimerSource(queue: q)
    t.schedule(deadline: .now() + renewEvery, repeating: renewEvery, leeway: .milliseconds(Int(min(renewEvery, 1) * 200)))
    t.setEventHandler { [weak self] in
      // The current session (a retry starts a fresh one); a retry already waiting sends on its own.
      guard let self, let cur = self.session, !self.retryWaiting else { return }
      self.attempt(cur)
    }
    t.resume(); timer = t
    attempt(s)
  }

  /// One try: the helper must be switched on (macOS's own status), then the request.
  private func attempt(_ s: String) {
    guard session == s else { return }
    guard link.helperReady() else { return trouble(s, .helperMissing, "the restart helper is not switched on") }
    send(s)
  }

  /// The helper is not switched on, not reachable, or said "failed". Retried with a fresh session until it has been
  /// like that for giveUpAfter since the last good answer (or the start); then the lid keep awake has truly stopped.
  private func trouble(_ s: String, _ r: StopReason, _ what: String) {
    guard session == s else { return }
    setActive(false)
    let since = everGood ? lastGood : startedAt
    if now() - since >= giveUpAfter {
      if case .helperMissing = r { return finish(s, r, tellHelper: false) }
      return finish(s, r, tellHelper: true)
    }
    if !retryLogged { retryLogged = true; psLog("sentry lid: \(what), trying again every \(Int(retryEvery.rounded())) s") }
    let n = UUID().uuidString
    session = n; retryWaiting = true
    q.asyncAfter(deadline: .now() + retryEvery) { [weak self] in
      guard let self, self.session == n else { return }
      self.retryWaiting = false
      self.attempt(n)
    }
  }

  private func end() {
    guard let s = session else { return }
    session = nil; timer?.cancel(); timer = nil; retryWaiting = false
    let was = isActive
    setActive(false)
    // Best effort: if this never arrives, the helper's 90 s lease turns it off anyway.
    link.send(SentryLidCore.body(on: false, session: s, battery: SentryLidCore.batteryFloor())) { _ in }
    if was { psLog("sentry lid: off") }
  }

  private func send(_ s: String) {
    call(SentryLidCore.body(on: true, session: s, battery: SentryLidCore.batteryFloor()), restart: false) { [weak self] a in self?.handle(s, a) }
  }

  private func handle(_ s: String, _ a: SentryLidAnswer) {
    guard session == s else { return }   // turned off, or a newer session: this answer is old news
    switch SentryLidCore.outcome(a) {
    case .active:
      lastGood = now(); everGood = true; retryLogged = false
      if !isActive { psLog("sentry lid: on") }
      setActive(true)
    case .stopped(.helperMissing):
      trouble(s, .helperMissing, "the restart helper is not reachable")
    case .stopped(.refused):
      // Also what the helper of the previous PS answers right after an update, until PS is switched on again.
      trouble(s, .refused, "macOS did not let the helper keep the Mac awake")
    case .stopped(let r):
      finish(s, r, tellHelper: true)
    case .retry(let e):
      // Kept going on the next renewal; the helper's own lease is what really turns it off.
      let since = everGood ? lastGood : startedAt
      if now() - since >= giveUpAfter {
        finish(s, everGood ? .other("The helper stopped answering") : .helperMissing, tellHelper: true)
      } else {
        psLog("sentry lid: helper did not answer (\(e)), trying again")
      }
    }
  }

  private func finish(_ s: String, _ r: StopReason, tellHelper: Bool) {
    guard session == s else { return }
    session = nil; timer?.cancel(); timer = nil; retryWaiting = false
    setActive(false)
    if tellHelper { link.send(SentryLidCore.body(on: false, session: s, battery: SentryLidCore.batteryFloor())) { _ in } }
    psLog("sentry lid: stopped, \(SentryLidCore.describe(r))")
    DispatchQueue.main.async { self.onAutoStop?(r) }
  }
}

/// What came back from the helper.
enum SentryLidAnswer {
  case reply(Data)
  case missing             // no helper to talk to (not set up, switched off, or an older one without Sentry mode)
  case error(String)       // it did not answer this time
}

/// How SentryLid reaches the helper: XPC to rebootd in PS, a fake in tests/sentrylid-test.swift.
protocol SentryLidLink: AnyObject {
  /// Whether the restart helper is set up and switched on. Called on SentryLid's queue, never the main thread.
  func helperReady() -> Bool
  /// One lid request (RebootdXPC.lid); `done` at most once, on any thread.
  func send(_ json: Data, done: @escaping (SentryLidAnswer) -> Void)
  /// One restart deadline request (RebootdXPC.sentryRestart); `done` at most once, on any thread.
  func sendRestart(_ json: Data, done: @escaping (SentryLidAnswer) -> Void)
}

/// The pure parts, for tests/sentrylid-test.swift.
enum SentryLidCore {
  enum Outcome { case active, stopped(SentryLid.StopReason), retry(String) }
  enum RestartOutcome { case deadline(Date?), refused(SentryLid.StopReason), missing, retry(String) }
  enum RestartOp { case arm(Double), cancel, read }
  static let safeModeText = "The Mac is in Safe Mode"

  static func restartBody(_ op: RestartOp) -> Data {
    let j: [String: Any]
    switch op {
    case .arm(let s): j = ["op": "arm", "seconds": s.isFinite ? s.rounded() : 0]
    case .cancel: j = ["op": "cancel"]
    case .read: j = ["op": "read"]
    }
    return (try? JSONSerialization.data(withJSONObject: j, options: [.sortedKeys])) ?? Data()
  }

  /// The helper's answer {ok, deadline?, left?, why?} (RebootdXPC.sentryRestart).
  static func restartOutcome(_ a: SentryLidAnswer) -> RestartOutcome {
    switch a {
    case .missing: return .missing
    case .error(let e): return .retry(e)
    case .reply(let d):
      guard let j = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any], let ok = j["ok"] as? Bool else { return .retry("an answer that could not be read") }
      if ok { return .deadline((j["deadline"] as? NSNumber).map { Date(timeIntervalSince1970: $0.doubleValue) }) }
      switch j["why"] as? String {
      case "range": return .refused(.other("The restart time must be between 5 minutes and 7 days"))
      case "notAllowed": return .refused(.other("Only the user signed in on this Mac's screen can set the Sentry restart"))
      case "safeMode": return .refused(.other(safeModeText))
      default: return .refused(.other("The helper did not accept the Sentry restart request"))
      }
    }
  }

  static let defaultFloor = 10
  /// The battery floor in percent: `sentry.lidBatteryFloor` when it is 5 to 50, else 10.
  static func batteryFloor(_ stored: Int? = UserDefaults.standard.object(forKey: "sentry.lidBatteryFloor") as? Int) -> Int {
    guard let v = stored, (5...50).contains(v) else { return defaultFloor }
    return v
  }

  static func body(on: Bool, session: String, battery: Int) -> Data {
    (try? JSONSerialization.data(withJSONObject: ["on": on, "session": session, "battery": battery], options: [.sortedKeys])) ?? Data()
  }

  /// The helper's answer {ok, on, why?} (Helper/RebootXPC.swift, lid) read as what SentryLid does next.
  static func outcome(_ a: SentryLidAnswer) -> Outcome {
    switch a {
    case .missing: return .stopped(.helperMissing)
    case .error(let e): return .retry(e)
    case .reply(let d):
      guard let j = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any], let on = j["on"] as? Bool else { return .retry("an answer that could not be read") }
      if on && (j["ok"] as? Bool) == true { return .active }
      return .stopped(reason(why: j["why"] as? String))
    }
  }

  /// The check before engaging, from the helper's answer to its on. Battery low and too hot are not a fault of the lid
  /// keep awake (they pass with the battery or the heat, and Sentry mode has its own battery stop): nil, it works.
  static func probeGap(_ a: SentryLidAnswer) -> SentryLid.Gap? {
    switch outcome(a) {
    case .active: return nil
    case .retry: return .helper                 // no answer, or one that could not be read
    case .stopped(.helperMissing): return .helper
    case .stopped(.batteryLow), .stopped(.tooHot): return nil
    case .stopped: return .refused              // failed, notAllowed, safeMode, invalid, anything else
    }
  }

  static func reason(why: String?) -> SentryLid.StopReason {
    switch why {
    case "battery": return .batteryLow
    case "hot": return .tooHot
    case "lease": return .other("PS app did not renew in time, so the helper turned it off")
    case "failed": return .refused   // macOS did not take it (the helper's log has the IOReturn)
    case "notAllowed": return .other("Only the user signed in on this Mac's screen can turn it on")
    case "safeMode": return .other(safeModeText)
    case "off": return .other("It was turned off")
    case "invalid": return .other("The helper did not accept the request")
    default: return .other("The helper turned it off")
    }
  }

  static func describe(_ r: SentryLid.StopReason) -> String {
    switch r {
    case .batteryLow: return "battery low"
    case .tooHot: return "too hot"
    case .helperMissing: return "helper missing"
    case .refused: return "refused: macOS did not let the helper keep the Mac awake"
    case .other(let s): return "other: \(s)"
    }
  }
}

/// The real link: rebootd over XPC, checked both ways by code signature (RebootdIDs).
final class SentryLidXPC: SentryLidLink {
  private var conn: NSXPCConnection?
  private let l = NSLock()

  func helperReady() -> Bool {
    if IS_TEST_COPY { return false }   // a test copy never reads or reaches the real helper
    return SMAppService.daemon(plistName: RebootdIDs.plist).status == .enabled
  }

  func send(_ json: Data, done: @escaping (SentryLidAnswer) -> Void) {
    guard let p = proxy(done) else { return }
    p.lid(json) { d in done(.reply(d)) }
  }

  func sendRestart(_ json: Data, done: @escaping (SentryLidAnswer) -> Void) {
    guard let p = proxy(done) else { return }
    p.sentryRestart(json) { d in done(.reply(d)) }
  }

  /// The helper's proxy; nil (and `done(.missing)` already called) in a test copy or when none can be made.
  private func proxy(_ done: @escaping (SentryLidAnswer) -> Void) -> RebootdXPC? {
    if IS_TEST_COPY { done(.missing); return nil }
    let c: NSXPCConnection = {
      l.lock(); defer { l.unlock() }
      if let c = conn { return c }
      let c = NSXPCConnection(machServiceName: RebootdIDs.mach, options: .privileged)
      c.remoteObjectInterface = NSXPCInterface(with: RebootdXPC.self)
      c.setCodeSigningRequirement(RebootdIDs.helperRequirement)   // only the genuine helper
      c.invalidationHandler = { [weak self] in self?.drop(c) }
      c.interruptionHandler = { [weak self] in self?.drop(c) }
      c.resume()
      conn = c
      return c
    }()
    let p = c.remoteObjectProxyWithErrorHandler { e in
      // Invalid: nothing to talk to (not set up, switched off, refused signature, or a helper without this call).
      let code = (e as NSError).code
      done(code == NSXPCConnectionInvalid ? .missing : .error(e.localizedDescription))
    } as? RebootdXPC
    if p == nil { done(.missing) }
    return p
  }

  private func drop(_ c: NSXPCConnection) { l.lock(); if conn === c { conn = nil }; l.unlock() }
}
