// Unit tests for the auto reboot timer (Helper/RebootCore.swift). Run: tests/reboot-core-test.sh
// A small simulated Mac drives the engine the way rebootd does: a step every 2 s while awake, the
// will sleep step before sleeping, the did wake step on waking (by the user or by our RTC wake).
// Besides the named cases, a randomized run checks the safety rules on thousands of event mixes:
//   - never a restart while the console is unlocked,
//   - never a restart before the timer length has passed since the last unlock (or reset),
//   - never a restart before someone has unlocked since boot,
//   - at most one wake of ours is held, and a locked countdown always has one.
import Foundation

var failures = 0, passes = 0
func check(_ ok: Bool, _ what: String, file: String = #file, line: Int = #line) {
  if ok { passes += 1 } else { failures += 1; print("FAIL line \(line): \(what)") }
}

final class Sim {
  var cont = 1000.0                       // continuous seconds since boot
  var offset = 1_793_000_000.0            // wall = cont + offset (a clock change moves the offset)
  var wall: Double { cont + offset }
  var session: ConsoleSession = .unlocked
  var asleep = false
  var boot = "boot-1"
  var config: RebootConfig
  var engine: RebootEngine!
  var saved: RebootState?
  var wakes: [Double] = []                // the RTC wakes we hold (wall)
  var restarts: [(cont: Double, wall: Double, boot: String)] = []
  var woulds: [Double] = []
  var logs: [String] = []
  var spawnWorks = true                   // false: the restart never happens (Mac stays up)
  var missNextWake = false                // the next RTC wake does not happen (the backup must cover it)
  var wakeLatency = 1.5                   // macOS tells rebootd about a wake a moment after the RTC time
  var quickResleep = false                // after a dark wake the Mac sleeps again at once, with no will sleep notice
  var simPeriod = 12 * 3600.0             // the sim's OWN idea of the timer length (from its config, not the engine)
  var lastReset = 0.0                     // the sim's own idea of the countdown start
  var seenUnlock = false
  var triedThisBoot = false, unlockedSinceTry = false
  var marker: String?                     // rebootd's "tried in this boot" marker file (survives a damaged state file)
  var loggedIn = true                     // someone is logged in this boot (with FileVault that took the password)
  var violations: [String] = []
  var wakeFails = false
  var tickEvery = 2.0                     // rebootd checks every 2 s; the random run uses 20 s to stay quick
  var records: [HistoryEntry] = []
  var simPostponed = 0.0                  // the sim's own idea of how far Postpone moved this countdown
  var clock = 0.0                         // seconds the sim has run in all (cont starts again at every boot)
  var signedIn = false                    // rebootd's own sign in record for this boot (its separate file)
  var periods: [LockPeriod] = []

  init(_ c: RebootConfig, session: ConsoleSession = .unlocked) {
    config = c; self.session = session; simPeriod = Double(c.testOnce ? 5 : c.minutes) * 60
    var a: [RebootAction] = []
    engine = RebootEngine(config: c, loaded: nil, boot: boot, now: cont, wall: wall, log: &a)
    lastReset = cont; seenUnlock = false
    apply(a)
    step(.start)
  }

  func apply(_ acts: [RebootAction]) {
    for a in acts {
      switch a {
      case .log(let s): logs.append(s)
      case .save: saved = engine.state
      case .saveConfig: config = engine.config
      case .markTried: marker = boot
      case .cancelWake: wakes = []
      case .scheduleWake(let w):
        if wakeFails { engine.wakeFailed(); continue }
        if w < wall + RebootEngine.minWakeLead - 0.001 || w != w.rounded(.up) { violations.append("wake asked too soon or not whole seconds: \(w)") }
        wakes = RebootEngine.wakePair(w)          // rebootd holds the wake and its 10 min backup
      case .record(let e): records.append(e); if e.kind == "would" { woulds.append(cont) }
      case .period(let p):
        periods.append(p)
        if !(p.endedAt >= p.lockedAt - 0.001 && p.ran >= 0 && ["unlock", "timer", "restart", "shutdown", "boot", "changed", "off"].contains(p.end)) { violations.append("odd lock period \(p)") }
      case .restart:
        if session == .unlocked { violations.append("restart while unlocked at \(cont)") }
        if cont - lastReset < simPeriod + simPostponed - 0.001 { violations.append("restart before the postponed deadline: \(cont - lastReset) < \(simPeriod + simPostponed)") }
        if !seenUnlock { violations.append("restart before any unlock at \(cont)") }
        if !signedIn { violations.append("restart without rebootd's own sign in record at \(cont)") }
        if simPeriod < 600 && simPeriod != 300 { violations.append("timer under 10 minutes: \(simPeriod)") }
        if cont - lastReset < simPeriod - 0.001 { violations.append("restart early: \(cont - lastReset) < \(simPeriod)") }
        if cont < 1800 { violations.append("restart \(cont) s after boot (the floor is 30 min)") }
        if triedThisBoot && unlockedSinceTry { violations.append("a second automatic restart in one boot") }
        triedThisBoot = true; unlockedSinceTry = false
        restarts.append((cont, wall, boot))
        if spawnWorks { newBoot() }
      }
    }
  }

  func step(_ ev: RebootEvent) {
    if session == .unlocked { lastReset = cont; seenUnlock = true; loggedIn = true; unlockedSinceTry = true; simPostponed = 0; signedIn = true }
    engine.signInSeen = signedIn          // as rebootd does before every step
    apply(engine.step(ev, session: session, now: cont, wall: wall))
    if session == .unlocked { simPeriod = Double(config.testOnce ? 5 : config.minutes) * 60 }
    if wakes.count > 2 { violations.append("more than one wake pair held") }
  }

  /// Moves continuous time on (and the sim's own total clock with it).
  func move(_ to: Double) { clock += to - cont; cont = to }
  /// Time passes. Awake: a step every 2 s. Asleep: nothing runs until our RTC wake (or `userWakeAt`).
  /// It runs for `seconds` of real time even across restarts (each new boot starts cont again).
  func advance(_ seconds: Double, userWakeAt: Double? = nil) {
    let end = clock + seconds, startBoot = boot
    while clock < end - 0.0001 {
      let endCont = cont + (end - clock)
      if asleep {
        let rtc = wakes.first.map { max($0 - offset, cont) }   // a wake whose wall time has passed fires at once
        let u = boot == startBoot ? userWakeAt.map { cont >= $0 ? cont : $0 } : nil
        let next = [rtc, u, endCont].compactMap { $0 }.filter { $0 >= cont }.min() ?? endCont
        move(next)
        if let r = rtc, abs(cont - r) < 0.0001 {
          wakes.removeFirst()
          if missNextWake { missNextWake = false; continue }   // this RTC wake did not happen: still asleep
          move(cont + wakeLatency)
          asleep = false; step(.didWake); sleepAgainIfDark(); continue
        }
        if let u, abs(cont - u) < 0.0001, cont < endCont { asleep = false; step(.didWake); continue }
        continue
      }
      move(min(endCont, cont + tickEvery))
      wakes.removeAll { $0 <= wall - 1 }      // awake: a wake whose time passed is gone from powerd
      step(.tick)
    }
  }
  /// After an RTC (dark) wake with nobody there, the Mac goes back to sleep a little later.
  var lidShut = false
  func sleepAgainIfDark() {
    guard lidShut && !restartedJustNow() else { return }
    if quickResleep { asleep = true; return }          // no tick, no will sleep: only what the wake step held counts
    move(cont + 1); step(.tick); goToSleep()
  }
  func restartedJustNow() -> Bool { restarts.last.map { cont - $0.cont < 2 } ?? false && spawnWorks }

  func goToSleep() {
    step(.willSleep); asleep = true
    // Before sleeping, a running countdown must hold a wake at its deadline (or a retry soon after).
    let e = engine!
    if e.counting && !wakeFails {
      let dlWall = wall + (e.deadline - cont)
      let ok = wakes.count == 2 && wakes[1] - wakes[0] == RebootEngine.backupWake
        && (abs(wakes[0] - dlWall) <= 2 || (dlWall < wall + RebootEngine.minWakeLead + 2 && wakes[0] <= wall + RebootEngine.minWakeLead + 2))
      if !ok { violations.append("asleep without the right wake: held \(wakes), deadline \(dlWall)") }
    }
  }
  func lock() { session = .locked }
  func unlock() { session = .unlocked; if !asleep { step(.tick) } }
  /// Postpone as PS hands it on (from the other Mac or the phone).
  @discardableResult
  func postpone(_ who: String) -> (ok: Bool, why: String?) {
    let simDeadline = max(lastReset + simPeriod + simPostponed, RebootEngine.minUptime)
    engine.signInSeen = signedIn
    let r = engine.postpone(from: who, now: cont, wall: wall, session: session)
    if r.ok { simPostponed = max(simDeadline, cont) + RebootEngine.postponeStep - (lastReset + simPeriod) }
    apply(r.actions)
    return (r.ok, r.why)
  }
  func setConfig(_ c: RebootConfig) {
    let before = engine.config
    config = c
    let a = engine.setConfig(c, now: cont, wall: wall, session: session)
    if c != before { lastReset = cont; simPostponed = 0 }
    apply(a)
    if c != before { simPeriod = Double(config.testOnce ? 5 : config.minutes) * 60 }
  }
  func daemonRestart(corrupt: Bool = false, state: RebootState? = nil) {
    var a: [RebootAction] = []
    let fresh = corrupt || (state ?? saved).map { !$0.isSane(now: cont) || $0.boot != boot } ?? true
    engine = RebootEngine(config: config, loaded: corrupt ? nil : (state ?? saved), boot: boot, now: cont, wall: wall,
                          triedThisBoot: marker == boot, session: session, log: &a)
    if fresh { lastReset = cont; seenUnlock = false; simPeriod = Double(config.testOnce ? 5 : config.minutes) * 60; simPostponed = 0 }
    lastReset = max(lastReset, engine.state.lastUnlocked)
    apply(a); step(.start)
  }
  var boots = 1
  func newBoot() {
    boots += 1
    boot = "boot-\(boots)"
    let w = wall
    cont = 30; offset = w - cont                               // continuous time starts again; the wall clock goes on
    asleep = false; session = .noUser; wakes = []; signedIn = false   // a fresh Mac at the login window (BFU)
    var a: [RebootAction] = []
    engine = RebootEngine(config: config, loaded: saved, boot: boot, now: cont, wall: wall, log: &a)
    lastReset = cont; seenUnlock = false; loggedIn = false; triedThisBoot = false; unlockedSinceTry = false
    simPeriod = Double(config.testOnce ? 5 : config.minutes) * 60; simPostponed = 0
    apply(a); step(.start)
  }
}

let H = 3600.0
func cfg(_ m: RebootMode, _ h: Int = 12, test: Bool = false) -> RebootConfig { RebootConfig(mode: m, minutes: h * 60, testOnce: test) }

// 1. In use, unlocked, for 4 days: never a restart, never a "would have".
do {
  let s = Sim(cfg(.active)); s.advance(96 * H)
  check(s.restarts.isEmpty && s.woulds.isEmpty, "unlocked Mac never restarts")
}

// 2. Locked and awake: restarts 12 h after the lock, within one 2 s step.
do {
  let s = Sim(cfg(.active)); s.advance(60); let lockAt = s.cont; s.lock(); s.advance(13 * H)
  check(s.restarts.count == 1, "locked awake: one restart")
  if let r = s.restarts.first { check(r.cont - lockAt >= 12 * H - 2 && r.cont - lockAt <= 12 * H + 2.01, "restart 12 h after the lock (got \(r.cont - lockAt))") }
}

// 3. Lid shut on battery: locks, sleeps; the RTC wake at the deadline restarts it.
do {
  let s = Sim(cfg(.active)); s.advance(10); s.lock(); let lockAt = s.cont; s.advance(2); s.lidShut = true; s.goToSleep()
  check(s.wakes.count == 2, "asleep with a wake (and its backup) held")
  if let w = s.wakes.first { check(abs((w - s.offset) - (lockAt - 2 + 12 * H)) <= 3, "wake at the deadline") }
  s.advance(13 * H)
  check(s.restarts.count == 1, "lid shut: restarted from sleep")
  if let r = s.restarts.first { check(abs(r.cont - (lockAt + 12 * H)) <= 3, "lid shut: on time (off by \(r.cont - (lockAt + 12 * H)))") }
}

// 4. Unlock in the middle of the countdown: no restart, and the next countdown starts at the next lock.
do {
  let s = Sim(cfg(.active)); s.lock(); s.advance(6 * H); s.unlock(); s.advance(H); s.lock(); let second = s.cont
  s.advance(11 * H)
  check(s.restarts.isEmpty, "unlock mid countdown resets it")
  s.advance(1.5 * H)
  check(s.restarts.count == 1 && abs(s.restarts[0].cont - second - 12 * H) <= 4, "restart 12 h after the second lock")
}

// 5. Watch only: logs once per countdown, never restarts.
do {
  let s = Sim(cfg(.watch)); s.lock(); s.advance(20 * H)
  check(s.restarts.isEmpty && s.woulds.count == 1, "watch only: one would have, no restart")
  check(s.wakes.isEmpty, "watch only: no wake left after logging")
  s.unlock(); s.advance(60); s.lock(); s.goToSleep(); s.advance(13 * H)
  check(s.restarts.isEmpty && s.woulds.count == 2, "watch only: logs again after a new lock, also from sleep")
}

// 6. Clock jumps (forward 5 h, back 1 day): the deadline stays in continuous time; the wake follows.
do {
  let s = Sim(cfg(.active)); s.lock(); s.advance(2); let lockAt = s.lastReset; s.advance(H)
  s.offset += 5 * H; s.advance(2)
  check(s.restarts.isEmpty, "clock forward does not restart early")
  if let w = s.wakes.first { check(abs((w - s.offset) - (s.lastReset + 12 * H)) <= 31, "wake moved with the clock") }
  check(s.logs.contains { $0.hasPrefix("clock changed") }, "clock change is logged")
  s.offset -= 29 * H; s.advance(12 * H)
  check(s.restarts.count == 1 && abs(s.restarts[0].cont - lockAt - 12 * H) <= 3, "after clock changes, restart still 12 h after the lock")
}

// 7. Clock jump while asleep: the wake comes early or late by wall time; the decision uses continuous time.
do {
  let s = Sim(cfg(.active)); s.lock(); s.advance(4); let lockAt7 = s.lastReset; s.lidShut = true; s.goToSleep()
  s.offset -= 3 * H                            // wall clock set back: the held wake now fires 3 h late
  s.advance(16 * H)
  check(s.restarts.count == 1, "clock set back while asleep: still restarts")
  if let r = s.restarts.first { check(r.cont - lockAt7 >= 12 * H && r.cont - lockAt7 <= 15 * H + 5, "never early after a clock change (\(r.cont - lockAt7))") }
  let t = Sim(cfg(.active)); t.lock(); t.advance(4); let lockAt7b = t.lastReset; t.lidShut = true; t.goToSleep()
  t.offset += 3 * H                            // set forward: the wake fires 3 h early, finds time left, sleeps again
  t.advance(16 * H)
  check(t.restarts.count == 1 && t.restarts[0].cont - lockAt7b >= 12 * H && t.restarts[0].cont - lockAt7b <= 12 * H + 5, "clock set forward while asleep: early wake, sleeps again, on time (\(t.restarts.first.map { $0.cont - lockAt7b } ?? -1))")
}

// 8. rebootd restarted in the middle of the countdown: carries on to the same deadline.
do {
  let s = Sim(cfg(.active)); s.lock(); s.advance(5 * H); let lockAt = s.lastReset
  s.daemonRestart(); s.advance(8 * H)
  check(s.restarts.count == 1 && abs(s.restarts[0].cont - lockAt - 12 * H) <= 3, "helper restart keeps the deadline")
}

// 9. Corrupt (unreadable) state file while locked: the countdown starts again from now, never instantly.
do {
  let s = Sim(cfg(.active)); s.lock(); s.advance(11.9 * H)
  s.daemonRestart(corrupt: true); s.advance(H)
  check(s.restarts.isEmpty, "corrupt state: no instant restart")
  s.advance(5 * 24 * H)
  check(s.restarts.isEmpty && s.wakes.isEmpty, "corrupt state: disarmed while locked, no wake held")
  s.unlock(); s.advance(10); s.lock(); let t0 = s.cont; s.advance(12 * H + 10)
  check(s.restarts.count == 1 && (s.restarts.first?.cont ?? 0) - t0 >= 12 * H - 2.01, "corrupt state: armed again by the next unlock")
}

// 10. A state that parses but does not add up (bad values) is dropped the same way.
do {
  let s = Sim(cfg(.active)); s.lock(); s.advance(H)
  var bad = s.saved!; bad.lastUnlocked = -1e9
  s.daemonRestart(state: bad); s.advance(2 * H)
  check(s.restarts.isEmpty, "insane state: no instant restart")
  var bad2 = s.saved!; bad2.periodMinutes = 1
  s.daemonRestart(state: bad2); s.advance(60)
  check(s.restarts.isEmpty, "1 minute period refused")
  var bad3 = s.saved!; bad3.lastUnlocked = s.cont + 1e6
  s.daemonRestart(state: bad3); s.advance(60)
  check(s.restarts.isEmpty && s.engine.state.lastUnlocked <= s.cont, "future start refused")
}

// 11. Before First Unlock (GrapheneOS: the timer "doesn't apply" there; the developer, 2 Nov 2026: "all it takes is one
//     reboot or one shutdown"): after the timer's restart nobody signs in; it never restarts again (no loop).
do {
  let s = Sim(cfg(.active)); s.lock(); s.advance(12 * H + 10)
  check(s.restarts.count == 1, "first restart")
  s.advance(10 * 24 * H)
  check(s.restarts.count == 1, "no restart loop at the login window")
  check(s.wakes.isEmpty, "no wake held before the first unlock")
  check(s.logs.contains { $0.contains("Back up") } == false, "back entry is a record, not a log line")
  s.unlock(); s.advance(60); s.lock(); s.advance(12 * H + 10)
  check(s.restarts.count == 2, "after a real sign in the timer runs again")
}

// 12. Settings changed while locked (12 h -> 1 h after 5 h locked): no instant restart, 1 h from the change.
do {
  let s = Sim(cfg(.active)); s.lock(); s.advance(5 * H); let t0 = s.cont
  s.setConfig(cfg(.active, 1)); s.advance(30 * 60)
  check(s.restarts.isEmpty, "shorter timer: no instant restart")
  s.advance(H)
  check(s.restarts.count == 1 && abs(s.restarts[0].cont - t0 - H) <= 3, "shorter timer: 1 h after the change")
}

// 13. The same settings again change nothing (PS re-sends them on every launch).
do {
  let s = Sim(cfg(.active)); s.lock(); s.advance(6 * H); let lockAt = s.lastReset
  s.setConfig(cfg(.active)); s.setConfig(cfg(.active)); s.advance(7 * H)
  check(s.restarts.count == 1 && abs(s.restarts[0].cont - lockAt - 12 * H) <= 3, "same config keeps the deadline")
}

// 14. The restart does not happen (shutdown failed): retries every 3 min, 3 tries, then gives up.
do {
  let s = Sim(cfg(.active)); s.spawnWorks = false; s.lock(); s.advance(12 * H + 30 * 60)
  check(s.restarts.count == 3, "three attempts (got \(s.restarts.count))")
  if s.restarts.count >= 2 { check(s.restarts[1].cont - s.restarts[0].cont >= 180 - 0.01, "attempts 3 min apart") }
  check(s.wakes.isEmpty, "gave up: no wake left")
  check(s.logs.contains { $0.contains("giving up") }, "gave up is logged")
  s.unlock(); s.advance(10); s.lock(); s.advance(12 * H + 10)
  check(s.restarts.count == 3, "one automatic restart per boot: no new attempt after an unlock in the same boot")
  check(s.logs.contains { $0.contains("already started in this boot") }, "one per boot is logged")
  check(s.wakes.isEmpty, "no wake held once this boot had its restart")
  s.daemonRestart(corrupt: true); s.unlock(); s.advance(10); s.lock(); s.advance(13 * H)
  check(s.restarts.count == 3, "one per boot survives a damaged state file (marker)")
}

// 15. Off: no wake, no restart, ever.
do {
  let s = Sim(cfg(.off)); s.lock(); s.goToSleep(); s.advance(80 * H)
  check(s.restarts.isEmpty && s.woulds.isEmpty && s.wakes.isEmpty, "off does nothing")
  let t = Sim(cfg(.active)); t.lock(); t.advance(H); t.setConfig(cfg(.off)); t.advance(80 * H)
  check(t.restarts.isEmpty && t.wakes.isEmpty, "switching off while counting cancels the wake")
}

// 16. Test once: the next countdown is 5 minutes, then back to the normal length.
do {
  let s = Sim(cfg(.active, 12, test: true)); s.lock(); s.advance(4 * 60)
  check(s.restarts.isEmpty, "test: not before 5 min")
  s.advance(70)
  check(s.restarts.isEmpty, "test: held until 30 min after boot (Mac booted \(s.cont) s ago)")
  s.advance(RebootEngine.minUptime - s.cont + 3)
  check(s.restarts.count == 1, "test: restarts at 30 min uptime")
  check(s.engine.config.testOnce == false, "test is used up")
  s.unlock(); s.advance(10); s.lock(); s.advance(10 * 60)
  check(s.restarts.count == 1, "after the test the normal 12 h applies")
}

// 17. The login window (logged out) counts like locked; another user unlocked on the console counts as in use.
do {
  let s = Sim(cfg(.active)); s.session = .noUser; s.advance(12 * H + 10)
  check(s.restarts.count == 1, "logged out: restarts")
}

// 18. Sleep without a lock (password asked later): the wake finds it unlocked and resets, no restart.
do {
  let s = Sim(cfg(.active)); s.lidShut = true; s.goToSleep(); s.advance(30 * H)
  check(s.restarts.isEmpty, "asleep but unlocked on wake: never restarts")
}

// 19. Lock flapping every few seconds for a day: never early.
do {
  let s = Sim(cfg(.active, 1))
  for i in 0..<20_000 { if i % 3 == 0 { s.unlock() } else { s.lock() }; s.advance(4) }
  check(s.restarts.isEmpty, "flapping never restarts")
}

// 20. IOKit refuses the wake: the previous wake stays (never none), the engine asks again on the next step.
do {
  let s = Sim(cfg(.active)); s.advance(10); let before = s.wakes; s.wakeFails = true; s.lock(); s.advance(10)
  check(s.engine.state.wake == nil && s.wakes == before && !before.isEmpty, "refused: the engine knows, the earlier wake is still there")
  s.wakeFails = false; s.advance(4)
  check(s.wakes.count == 2 && s.engine.state.wake == s.wakes[0], "wake asked again")
}

// 21. PS quit: the engine needs nothing from PS after its settings (rebootd keeps them in config.json).
do {
  let s = Sim(cfg(.active)); s.lock(); s.goToSleep(); s.advance(13 * H)
  check(s.restarts.count == 1, "no PS needed")
}

// 22. Unlocked while the wake is due: woken early by the user exactly at the deadline, unlocked: no restart.
do {
  let s = Sim(cfg(.active)); s.lock(); s.advance(4); s.goToSleep()
  let due = s.wakes.first! - s.offset
  s.advance(due - s.cont - 2, userWakeAt: due - 5)
  check(!s.asleep && s.session == .locked && s.restarts.isEmpty, "woken by the user before the deadline, still locked, no restart")
  s.unlock(); s.advance(30)
  check(s.restarts.isEmpty, "unlocked just before the deadline: no restart")
  let t = Sim(cfg(.active)); t.lock(); t.advance(4); let lockT = t.lastReset; t.goToSleep()
  let dueT = t.wakes.first! - t.offset
  t.advance(dueT - t.cont - 2, userWakeAt: dueT - 5); t.advance(30)
  check(t.restarts.count == 1 && t.restarts[0].cont - lockT >= 12 * H, "woken by the user but left locked: exactly one restart, on time")
}

// 23. Unlocked going to sleep (lid shut while unlocked, locks during sleep): exact wake at will sleep.
do {
  let s = Sim(cfg(.active)); s.advance(700); let at = s.cont
  s.goToSleep()
  check(s.wakes.count == 2 && abs((s.wakes[0] - s.offset) - (at + 12 * H)) <= 2, "exact wake (and its backup) set at will sleep")
}

// 25. Logged in but never seen unlocked (helper started while locked): never armed, never restarts.
do {
  let s = Sim(cfg(.active), session: .locked); s.advance(5 * 24 * H)
  check(s.restarts.isEmpty && s.wakes.isEmpty, "not armed without a seen unlock")
}

// 26. A future dated state file is dropped and disarms (no restart while locked).
do {
  let s = Sim(cfg(.active)); s.lock(); s.advance(H)
  var f = s.saved!; f.lastUnlocked = s.cont + 3600
  s.daemonRestart(state: f); s.advance(3 * 24 * H)
  check(s.restarts.isEmpty, "future dated state: disarmed")
}

// 27. Right after boot: unlock at once, lock, 1 h timer: restarts at 1 h, and a 5 min test waits for 30 min uptime.
do {
  let s = Sim(cfg(.active, 1)); s.newBoot(); s.session = .unlocked; s.advance(4); s.lock(); s.advance(1.5 * H)
  check(s.restarts.count == 1 && (s.restarts.first?.cont ?? 0) >= H, "1 h after boot")
}

// 28. A 5 minute test that is interrupted by an unlock is used up (never fires days later).
do {
  let s = Sim(cfg(.active, 12, test: true)); s.advance(RebootEngine.minUptime); s.lock(); s.advance(3 * 60); s.unlock()
  check(!s.engine.config.testOnce && !s.config.testOnce, "test cancelled by the unlock")
  s.advance(5 * 24 * H); s.lock(); s.advance(10 * 60)
  check(s.restarts.isEmpty, "no surprise 5 minute restart later")
}

// 29. Helper restarted while locked after a save made unlocked: counts from its start, never earlier.
do {
  let s = Sim(cfg(.active)); s.advance(50); s.lock()
  var st = s.saved!; st.savedUnlocked = true; st.lastUnlocked = s.cont - 50   // the lock happened while rebootd was down
  let t0 = s.cont; s.daemonRestart(state: st); s.advance(12 * H - 10)
  check(s.restarts.isEmpty, "not early after a restart across a lock")
  s.advance(20)
  check(s.restarts.count == 1 && s.restarts[0].cont - t0 >= 12 * H - 0.01, "on time from the helper's start")
}

// 30. Slept unlocked past the deadline: no restart, but it is written down once.
do {
  let s = Sim(cfg(.watch)); s.lidShut = true; s.goToSleep(); s.advance(30 * H)
  check(s.restarts.isEmpty && s.logs.filter { $0.hasPrefix("woke unlocked after the deadline") }.count >= 1, "slept unlocked: reported")
}

// 31. Explicit Restart and Shut down (rebootd's own rule): carried out, but never in the first 3 min after
//     boot (a command that reaches a Mac that only just restarted is dropped), never twice within 30 s,
//     and the reason is cleaned for the log.
do {
  check(RebootEngine.command(restart: true, reason: "a\u{0}b\nc", uptime: 3600, sinceLast: 1e9) == .go("abc"), "explicit restart goes, reason cleaned")
  check(RebootEngine.command(restart: false, reason: "x", uptime: 3600, sinceLast: 1e9) == .go("x"), "explicit shut down goes")
  check(RebootEngine.command(restart: true, reason: "x", uptime: 3600, sinceLast: 5) == .refuse("Asked again within 30 s"), "second command within 30 s refused")
  check(RebootEngine.command(restart: true, reason: "x", uptime: 60, sinceLast: 1e9) == .refuse("This Mac only just started"), "command right after boot dropped")
  check(RebootEngine.command(restart: true, reason: String(repeating: "y", count: 500), uptime: 3600, sinceLast: 1e9) == .go(String(repeating: "y", count: 120)), "long reason cut to 120")
}

// 32. Asleep, lid shut, and the restart does not happen: the retry wake brings attempts 2 and 3 with nobody there.
do {
  let s = Sim(cfg(.active)); s.spawnWorks = false; s.lock(); s.advance(4); s.lidShut = true; s.goToSleep()
  s.advance(13 * H)
  check(s.restarts.count == 3, "asleep: three attempts through the retry wakes (got \(s.restarts.count))")
  if s.restarts.count >= 2 { check(s.restarts[1].cont - s.restarts[0].cont >= 180 - 0.01 && s.restarts[1].cont - s.restarts[0].cont <= 190, "retry wake 3 min later") }
}

// 33. The RTC wake at the deadline is missed: the backup wake 10 min later restarts it.
do {
  let s = Sim(cfg(.active)); s.lock(); s.advance(4); let lockAt = s.lastReset; s.lidShut = true; s.goToSleep()
  s.missNextWake = true; s.advance(13 * H)
  check(s.restarts.count == 1, "backup wake restarts it")
  if let r = s.restarts.first { check(r.cont - lockAt >= 12 * H + 590 && r.cont - lockAt <= 12 * H + 615, "about 10 min after the deadline (\(r.cont - lockAt - 12 * H) s)") }
}

// 34. The engine itself marks saves made while unlocked, so a helper restarted across a lock is never early.
do {
  let s = Sim(cfg(.active)); s.advance(RebootEngine.minUptime + 100)
  check(s.saved?.savedUnlocked == true, "unlocked saves are marked")
  let st = s.saved!; s.cont += 50; s.session = .locked          // locked while rebootd was down, no step in between
  let t0 = s.cont; s.daemonRestart(state: st); s.advance(12 * H - 10)
  check(s.restarts.isEmpty, "not early after a helper restart across a lock")
  s.advance(30)
  check(s.restarts.count == 1 && s.restarts[0].cont - t0 >= 12 * H - 0.01, "on time from the helper's start")
}

// 35. Automatic login on (rebootd sets watchOnlyBecause): Active acts as Watch only.
do {
  let s = Sim(cfg(.active)); s.engine.watchOnlyBecause = "automatic login is on"; s.lock(); s.advance(13 * H)
  check(s.restarts.isEmpty && s.woulds.count == 1 && s.engine.mode == .watch, "automatic login: logs, never restarts")
}

// 36. Tables: settings, saved state, console, wakes, the tried marker.
do {
  func p(_ d: [String: Any]) -> RebootConfig? { RebootConfig.parse(d) }
  check(p(["mode": "active", "minutes": 0]) == nil && p(["mode": "active", "minutes": 9]) == nil && p(["mode": "active", "minutes": 4321]) == nil, "under 10 min or over 72 h refused")
  check(p(["mode": "active", "minutes": 10]) == RebootConfig(mode: .active, minutes: 10) && p(["mode": "watch", "minutes": 4320]) != nil, "10 min and 72 h accepted")
  check(p(["mode": "active", "minutes": "60"]) == nil && p(["minutes": 600]) == nil && p(["mode": "reboot", "minutes": 600]) == nil, "bad types and modes refused")
  check(p(["mode": "active", "minutes": 600, "testOnce": "yes"])?.testOnce == false, "testOnce of the wrong type is not a test")
  var st = RebootState(boot: "b", seenUnlock: true, lastUnlocked: 100, periodMinutes: 720)
  check(st.isSane(now: 200), "a normal state is sane")
  for bad in [1, 4, 9, 4321] { st.periodMinutes = bad; check(!st.isSane(now: 200), "period \(bad) min refused") }
  st.periodMinutes = 5; check(st.isSane(now: 200), "the 5 min test period is allowed")
  st.periodMinutes = 720; st.attempts = 4; check(!st.isSane(now: 200), "more than 3 attempts refused")
  st.attempts = 0; st.lastAttempt = 50; check(!st.isSane(now: 200), "an attempt before the countdown start refused")
  let c = RebootEngine.classifyConsole
  let u: [String: Any] = ["kCGSSessionOnConsoleKey": true, "kCGSessionLoginDoneKey": true]
  var l = u; l["CGSSessionScreenIsLocked"] = true
  var off = u; off["kCGSSessionOnConsoleKey"] = false
  var notDone = u; notDone["kCGSessionLoginDoneKey"] = false
  check(c([u]).session == .unlocked && c([u]).loginDone, "no lock flag: unlocked")
  check(c([l]).session == .locked, "lock flag: locked")
  var lf = u; lf["CGSSessionScreenIsLocked"] = false; check(c([lf]).session == .unlocked, "lock flag false: unlocked")
  check(c([off]).session == .noUser && c([off]).loginDone, "logged in but not on the console (switched away): no user")
  check(c([notDone]).session == .noUser && !c([notDone]).loginDone, "login not finished: no user")
  check(c([l, off]).session == .locked, "two users, the one on the console locked: locked")
  check(c([]).session == .noUser && c(nil).session == .noUser && c("junk").session == .noUser, "empty or odd: no user")
  check(RebootEngine.wakePair(1000.2) == [1001, 1601], "wake and its backup, whole seconds")
  check(RebootEngine.triedThisBoot(markerBody: nil, markerExists: false, boot: "a") == (false, false), "no marker: not tried")
  check(RebootEngine.triedThisBoot(markerBody: Data("a".utf8), markerExists: true, boot: "a") == (true, false), "marker of this boot: tried")
  check(RebootEngine.triedThisBoot(markerBody: Data("z".utf8), markerExists: true, boot: "a") == (false, false), "marker of another boot: not tried")
  check(RebootEngine.triedThisBoot(markerBody: nil, markerExists: true, boot: "a") == (true, true), "damaged marker: tried, and repaired")
  check(RebootEngine.minUptime == 1800, "the floor after boot is 30 min")
  var near = RebootState(boot: "b", seenUnlock: true, lastUnlocked: 101, periodMinutes: 720)
  check(near.isSane(now: 100), "a start 1 s ahead is tolerated")
  near.lastUnlocked = 102; check(!near.isSane(now: 100), "a start 2 s in the future is refused")
  for (up, ok) in [(179.9, false), (180.0, true)] {
    check((RebootEngine.command(restart: true, reason: "x", uptime: up, sinceLast: 1e9) == .go("x")) == ok, "command at \(up) s after boot: \(ok ? "goes" : "dropped")")
  }
  for (gap, ok) in [(29.9, false), (30.0, true)] {
    check((RebootEngine.command(restart: true, reason: "x", uptime: 3600, sinceLast: gap) == .go("x")) == ok, "command \(gap) s after the last: \(ok ? "goes" : "dropped")")
  }
  // The kernel fallback 60 s after asking shutdown.
  check(RebootEngine.fallbackGo(automatic: false, session: .unlocked, attempts: 0), "explicit command: always forced")
  check(!RebootEngine.fallbackGo(automatic: true, session: .unlocked, attempts: 1), "timer: never forced on an unlocked Mac")
  check(!RebootEngine.fallbackGo(automatic: true, session: .locked, attempts: 0), "timer: not forced once the attempt was reset")
  check(RebootEngine.fallbackGo(automatic: true, session: .locked, attempts: 1) && RebootEngine.fallbackGo(automatic: true, session: .noUser, attempts: 2), "timer: forced while still locked")
}

// 37. The RTC wake fires a few seconds before the continuous deadline (the wall clock was stepped while
//     asleep): the engine asks for a new wake at the deadline instead of sleeping on with none near it.
do {
  let s = Sim(cfg(.active)); s.lock(); s.advance(4); let lockAt = s.lastReset; s.lidShut = true; s.goToSleep()
  s.offset += 5; s.advance(13 * H)
  check(s.restarts.count == 1, "restarted")
  if let r = s.restarts.first { check(r.cont - lockAt >= 12 * H && r.cont - lockAt <= 12 * H + 20, "within seconds of the deadline, not at the backup (\(r.cont - lockAt - 12 * H) s)") }
}

// 38. Off cancels every wake at once, also one the engine no longer names (a backup still pending
//     after its wake fired, or a wake it forgot).
do {
  let s = Sim(cfg(.active)); s.lock(); s.advance(H)
  s.engine.wakeFailed()                                  // IOKit still holds the pair; the engine names none
  check(!s.wakes.isEmpty, "the Mac still holds wakes the engine does not name")
  let acts = s.engine.setConfig(cfg(.off), now: s.cont, wall: s.wall, session: s.session)
  check(acts.contains { if case .cancelWake = $0 { return true }; return false }, "Off asks to cancel the wakes")
  s.apply(acts); s.config = cfg(.off)
  check(s.wakes.isEmpty && s.engine.state.wake == nil, "no wake left right after Off")
}

// 44. Watch only, lid shut: once "would have" is logged, the backup wake is gone too (no pointless wake).
do {
  let s = Sim(cfg(.watch)); s.lock(); s.advance(4); s.lidShut = true; s.goToSleep(); s.advance(12 * H + 120)
  check(s.woulds.count == 1 && s.wakes.isEmpty, "would have logged and no wake left (held \(s.wakes.count))")
}

// 45. Early RTC wake, the Mac told at once and asleep again at once (no will sleep notice): the wake step
//     itself must move the wake to the deadline, or the restart slips to the backup 10 min later.
do {
  let s = Sim(cfg(.active)); s.lock(); s.advance(4); let lockAt = s.lastReset; s.lidShut = true; s.goToSleep()
  s.wakeLatency = 0.3; s.quickResleep = true; s.offset += 5; s.advance(13 * H)
  check(s.restarts.count == 1, "restarted")
  if let r = s.restarts.first { check(r.cont - lockAt <= 12 * H + 20, "on time, not 10 min late (\(r.cont - lockAt - 12 * H) s)") }
}

// 46. The wall clock steps back 1 h during the retry window: the retry wake moves with it.
do {
  let s = Sim(cfg(.active)); s.spawnWorks = false; s.lock(); s.advance(12 * H + 2)
  check(s.restarts.count == 1, "first attempt")
  let a = s.restarts.first?.cont ?? s.cont              // (no attempt is a failure above, never a crash)
  s.offset -= 3600; s.advance(2)                          // clock set back while awake, then the lid shuts
  s.lidShut = true; s.goToSleep(); s.advance(30 * 60)
  check(s.restarts.count >= 2 && s.restarts[1].cont - a <= RebootEngine.retryAfter + 20, "retry on time after the clock change (\(s.restarts.count >= 2 ? s.restarts[1].cont - a : -1) s)")
}

// 47. The developer's own Restart or Shut down is under way (rebootd sets explicitInFlight): the timer makes no
//     attempt of its own (no attempt, no marker, no pending), and goes on once that window is over.
do {
  let s = Sim(cfg(.active)); s.lock(); s.advance(12 * H - 30)
  s.engine.explicitInFlight = true; s.advance(60)
  check(s.restarts.isEmpty && s.engine.state.attempts == 0 && s.engine.state.pending == nil && s.marker == nil, "no timer attempt while the explicit one is under way")
  s.engine.explicitInFlight = false; s.advance(4)
  check(s.restarts.count == 1, "the timer goes on after the window if the Mac is still up")
}

// 39. The retry wake is refused during an attempt: it is asked for again before the Mac sleeps.
do {
  let s = Sim(cfg(.active)); s.spawnWorks = false; s.lock(); s.advance(12 * H + 2)
  check(s.restarts.count == 1, "first attempt")
  s.wakes = []; s.engine.wakeFailed()             // IOKit lost or refused the retry wake
  s.advance(2)
  check(s.wakes.count == 2 && abs((s.wakes[0] - s.offset) - (s.restarts[0].cont + RebootEngine.retryAfter)) <= 2, "retry wake asked for again")
  s.lidShut = true; s.goToSleep(); s.advance(10 * 60)
  check(s.restarts.count >= 2, "the retry happened from sleep")
}

// 40. Automatic login switched on in the middle of a countdown: no restart from then on.
do {
  let s = Sim(cfg(.active)); s.lock(); s.advance(6 * H)
  s.engine.watchOnlyBecause = "automatic login is on"; s.advance(7 * H)
  check(s.restarts.isEmpty && s.woulds.count == 1, "auto login mid countdown: logs only")
}

// 41. The helper stopping (SIGTERM): wakes kept only while an attempt is in flight; otherwise the state
//     forgets its wake, so a relaunch asks for one again.
do {
  let s = Sim(cfg(.active)); s.spawnWorks = false; s.lock(); s.advance(12 * H + 2)
  check(s.engine.state.lastAttempt != nil, "an attempt was made")
  let a = s.engine.state.lastAttempt ?? s.cont
  check(s.engine.stopping(now: a + 14 * 60 + 59), "attempt 14:59 ago: wakes kept")
  check(s.engine.state.wake != nil, "and the state still names its wake")
  check(!s.engine.stopping(now: a + 15 * 60 + 1), "attempt 15:01 ago: wakes cancelled")
  check(s.engine.state.wake == nil, "and the state forgets the wake")
  let t = Sim(cfg(.active)); t.lock(); t.advance(H)
  check(!t.engine.stopping(now: t.cont) && t.engine.state.wake == nil, "no attempt: cancelled and forgotten")
  t.advance(2)
  check(t.engine.state.wake != nil, "the next step asks for a wake again")
}

// 42. Start up reconcile: a missing saved wake is asked for again, stale ones are removed, the exact pair is kept.
do {
  let s = Sim(cfg(.active)); s.lock(); s.advance(H)
  let w = s.engine.state.wake!, pair = RebootEngine.wakePair(w)
  let keep = s.engine.reconcile(held: pair)
  check(keep.cancel.isEmpty && !keep.reask && s.engine.state.wake == w, "exact pair held: nothing to do")
  let stale = s.engine.reconcile(held: pair + [w + 5000])
  check(stale.cancel == [w + 5000] && !stale.reask, "a stale extra wake is removed")
  let missing = s.engine.reconcile(held: [])
  check(missing.reask && s.engine.state.wake == nil, "missing: asked for again")
  s.wakes = []; s.advance(2)
  check(s.engine.state.wake != nil && s.wakes.count == 2, "the next locked step holds it again")
}

// 43. A state from an earlier boot that happens to pass the time checks (rebootd first starts late in
//     the new boot, Mac locked): disarmed, its wake cancelled, its restart recorded, never a restart.
do {
  var old = RebootState(boot: "boot-1", seenUnlock: true, lastUnlocked: 1000, periodMinutes: 60)
  old.wake = 1_793_000_000; old.pending = PendingRestart(at: 1_792_999_000, why: "auto reboot", boot: "boot-1")
  var a: [RebootAction] = []
  let e = RebootEngine(config: cfg(.active, 1), loaded: old, boot: "boot-2", now: 7200, wall: 1_793_100_000, session: .locked, log: &a)
  check(!e.state.seenUnlock, "not armed in the new boot")
  check(a.contains { if case .cancelWake = $0 { return true }; return false }, "the old wake is cancelled")
  check(a.contains { if case .record(let h) = $0 { return h.kind == "restart" }; return false }, "the old boot's restart is recorded")
  var restarted = false; var t = 7200.0
  while t < 7200 + 5 * 3600 { if e.step(.tick, session: .locked, now: t, wall: 1_793_100_000 + t - 7200).contains(where: { if case .restart = $0 { return true }; return false }) { restarted = true }; t += 30 }
  check(!restarted, "never restarts without an unlock in the new boot")
}

// 48. The developer's own restart is under way at the deadline and fails, then the timer's 3 attempts fail too:
//     the timer still gives up properly (logged, recorded, every wake dropped).
do {
  let s = Sim(cfg(.active)); s.spawnWorks = false; s.lock(); s.advance(12 * H - 10)
  s.engine.explicitInFlight = true; s.advance(40); s.engine.explicitInFlight = false
  s.advance(20 * 60)
  check(s.restarts.count == 3, "three timer attempts after the window (got \(s.restarts.count))")
  check(s.logs.contains { $0.contains("giving up") }, "giving up is logged")
  check(s.engine.state.wake == nil && s.wakes.isEmpty, "no wake left after giving up")
}


// 54. Postpone: an hour later each time, the wake follows, at most 12 h in all, refused while unlocked.
do {
  let s = Sim(cfg(.active)); s.advance(10)
  var r = s.postpone("MacBook M4")
  check(!r.ok && (r.why ?? "").contains("unlocked"), "refused while unlocked (\(r.why ?? ""))")
  s.lock(); s.advance(60); let base = s.lastReset
  r = s.postpone("MacBook M4")
  check(r.ok, "postponed")
  check(abs(s.engine.deadline - (base + 13 * H)) < 0.01, "the deadline is 13 h after the last unlock")
  if let w = s.wakes.first { check(abs((w - s.offset) - (base + 13 * H)) <= 2, "the wake moved to the new deadline") } else { check(false, "a wake is held") }
  check(s.records.last?.kind == "postponed", "postponed is in the history")
  for _ in 0..<11 { s.postpone("MacBook M4") }
  check(abs(s.engine.deadline - (base + 24 * H)) < 0.01, "12 postpones: 24 h")
  r = s.postpone("MacBook M4")
  check(!r.ok, "a 13th is refused (12 h in all)")
  s.advance(base + 24 * H - 30 - s.cont)
  check(s.restarts.isEmpty, "not before the postponed deadline")
  s.advance(60)
  check(s.restarts.count == 1, "restarts at the postponed deadline")
}

// 56. Postpone refused when Off, before any sign in since the start, once the restart started; an unlock forgets it.
do {
  let off = Sim(cfg(.off)); off.lock(); off.advance(60)
  check(!off.postpone("x").ok, "off: refused")
  let bfu = Sim(cfg(.active), session: .locked); bfu.advance(60)
  check(!bfu.postpone("x").ok, "no unlock seen: refused")
  let t = Sim(cfg(.active)); t.spawnWorks = false; t.lock(); t.advance(12 * H + 10)
  let late = t.postpone("x")
  check(t.restarts.count == 1 && !late.ok && (late.why ?? "").contains("Too late"), "after the attempt: refused, too late (\(late.why ?? ""))")
  let w = Sim(cfg(.watch)); w.lock(); w.advance(12 * H + 10)
  let logged = w.postpone("x")
  check(w.woulds.count == 1 && !logged.ok && (logged.why ?? "").contains("Too late"), "watch only, after the would have: refused, too late")
  let u = Sim(cfg(.active)); u.lock(); u.advance(60); u.postpone("x"); u.unlock(); u.advance(10)
  check(u.engine.state.postponed == nil, "an unlock forgets the postpone")
  u.lock(); u.advance(2); let b = u.lastReset; u.advance(12 * H + 10)
  check(u.restarts.count == 1 && abs(u.restarts[0].cont - b - 12 * H) <= 3, "the next countdown is the plain 12 h")
  let c = Sim(cfg(.active)); c.lock(); c.advance(60); c.postpone("x"); c.setConfig(cfg(.active, 10))
  check(c.engine.state.postponed == nil, "a settings change forgets the postpone")
}

// 57. A state file from V1.23 to V1.27 (no postponed) loads and keeps counting; damaged values disarm.
do {
  let s = Sim(cfg(.active)); s.lock(); s.advance(H)
  var obj = try! JSONSerialization.jsonObject(with: try! JSONEncoder().encode(s.engine.state)) as! [String: Any]
  obj.removeValue(forKey: "postponed")
  let old = try? JSONDecoder().decode(RebootState.self, from: try! JSONSerialization.data(withJSONObject: obj))
  check(old != nil && old!.isSane(now: s.cont), "an old state file loads and is sane")
  if let old { s.daemonRestart(state: old); s.advance(11 * H + 10); check(s.restarts.count == 1, "and the countdown carries on to its deadline") }
  var bad = s.engine.state; bad.postponed = 13 * H; check(!bad.isSane(now: s.cont), "postponed over 12 h: not sane")
  bad = s.engine.state; bad.postponed = -1; check(!bad.isSane(now: s.cont), "negative postponed: not sane")
  bad = s.engine.state; bad.postponed = .nan; check(!bad.isSane(now: s.cont), "NaN postponed: not sane")
}

// 59. The helper's own sign in record (rebootd's separate file) is missing although the state says an unlock was seen
//     (eg PS was updated mid boot, or the file was removed): no restart, no wake, until an unlock writes it again.
do {
  let s = Sim(cfg(.active)); s.lock(); s.advance(H)
  s.signedIn = false; s.advance(12 * H)
  check(s.restarts.isEmpty && s.wakes.isEmpty, "no sign in record: the timer does not run")
  check(s.logs.contains { $0.contains("no sign in recorded by rebootd") }, "said once in the log")
  s.unlock(); s.advance(60); s.lock(); let t0 = s.cont; s.advance(12 * H + 10)
  check(s.restarts.count == 1 && (s.restarts.first?.cont ?? 0) - t0 >= 12 * H - 2.01, "the next unlock writes it again: restarts on time")
  var e = s.engine!
  var a: [RebootAction] = []
  e = RebootEngine(config: cfg(.active), loaded: nil, boot: "z", now: 4000, wall: 1_793_000_000, log: &a)
  e.signInSeen = false
  check(!e.postpone(from: "x", now: 4000, wall: 1_793_000_000, session: .locked).ok, "no Postpone either")
}

// 61. A timer restart is never followed by a second one without a sign in in between (the developer: no boot loop), over a
//     month with the lid shut, wakes missed, the helper restarted and settings changed.
do {
  let s = Sim(cfg(.active, 1)); s.advance(H); s.lock(); s.advance(2 * H)
  check(s.restarts.count == 1, "the first restart")
  s.lidShut = true; s.goToSleep()
  for i in 0..<30 {
    s.advance(24 * H, userWakeAt: s.cont + 3 * H)
    if !s.asleep { s.daemonRestart(); s.setConfig(cfg(.active, [1, 2, 72][i % 3])) }
  }
  check(s.restarts.count == 1, "still one restart after 30 days without a sign in (got \(s.restarts.count))")
}

// 62. Lock periods (the Security window shows the last three): when it was locked, how long it ran, how it ended.
do {
  let s = Sim(cfg(.active)); s.advance(10); let lockWall = s.wall; s.lock(); s.advance(3 * H); s.unlock(); s.advance(10)
  check(s.periods.count == 1 && s.periods[0].end == "unlock" && abs(s.periods[0].ran - 3 * H) <= 4 && abs(s.periods[0].lockedAt - lockWall) <= 3, "lock then unlock: one period of 3 h")
  s.lock(); s.advance(12 * H + 10)
  check(s.periods.count == 2 && s.periods[1].end == "timer" && abs(s.periods[1].ran - 12 * H) <= 4, "lock until the timer: ended by the restart")
  let w = Sim(cfg(.watch)); w.lock(); w.advance(13 * H); w.unlock(); w.advance(10)
  check(w.periods.count == 1 && w.periods[0].end == "unlock" && abs(w.periods[0].ran - 13 * H) <= 4 && w.periods[0].would != nil, "watch only: one period with its would have")
  let c = Sim(cfg(.active)); c.lock(); c.advance(H); c.setConfig(cfg(.active, 24)); c.advance(H); c.setConfig(cfg(.off)); c.advance(H)
  check(c.periods.map(\.end) == ["changed", "off"], "settings changed, then switched off (\(c.periods.map(\.end)))")
  let pp = Sim(cfg(.active)); pp.lock(); pp.advance(H); pp.postpone("M4"); pp.unlock(); pp.advance(10)
  check(pp.periods.count == 1 && pp.periods[0].postponed == 3600, "postponed is kept with its period")
  let x = Sim(cfg(.active)); x.lock(); x.advance(H)
  x.apply(x.engine.explicitPower(restart: false, now: x.cont, wall: x.wall))
  check(x.periods.last?.end == "shutdown", "The developer's own shut down ends it")
  let b = Sim(cfg(.active)); b.lock(); b.advance(2 * H); b.newBoot()
  check(b.periods.last?.end == "boot" && abs((b.periods.last?.ran ?? 0) - 2 * H) <= 40, "a boot in the middle (power): ended by the start, 2 h")
}

// 63. 10 minutes to 72 hours (GrapheneOS's range): 10 minutes restarts 10 minutes after the lock, 9 is refused.
do {
  check(RebootConfig.parse(["mode": "active", "minutes": 10]) != nil && RebootConfig.parse(["mode": "active", "minutes": 9]) == nil
        && RebootConfig.parse(["mode": "active", "minutes": 4320]) != nil && RebootConfig.parse(["mode": "active", "minutes": 4321]) == nil, "10 to 4320 minutes")
  check(RebootConfig().minutes == 18 * 60, "18 hours by default")
  let s = Sim(RebootConfig(mode: .active, minutes: 10)); s.advance(H); s.lock(); let t0 = s.lastReset; s.advance(11 * 60)
  check(s.restarts.count == 1 && abs((s.restarts.first?.cont ?? 0) - (t0 + 600)) <= 3, "10 minutes after the lock")
}

// 64. rebootd killed or stopped mid countdown (launchd starts it again): the countdown carries on to the same
//     deadline, never from scratch; a stop drops the wake, the relaunch asks for it again before any sleep.
do {
  let s = Sim(cfg(.active)); s.lock(); s.advance(5 * H); let dl = s.engine.deadline
  _ = s.engine.stopping(now: s.cont); s.wakes = []; s.saved = s.engine.state   // SIGTERM: wakes cancelled, state saved
  s.daemonRestart()
  check(abs(s.engine.deadline - dl) < 0.01, "same deadline after the relaunch")
  s.advance(4); s.lidShut = true; s.goToSleep(); s.advance(8 * H)
  check(s.restarts.count == 1 && abs((s.restarts.first?.cont ?? 0) - dl) <= 3, "restarted at the original deadline")
}

// 60. Postpone when the restart is already overdue (here the developer's own restart held the timer for 2 h): an hour from
//     now, never an instant restart.
do {
  let s = Sim(cfg(.active)); s.lock(); s.advance(12 * H - 10)
  s.engine.explicitInFlight = true; s.advance(2 * H)          // the timer waits while the developer's own restart is under way
  let r = s.postpone("Phone"); s.engine.explicitInFlight = false
  check(r.ok && s.engine.deadline >= s.cont + H - 0.01, "overdue: postponed to an hour from now")
  s.advance(H - 60)
  check(s.restarts.isEmpty, "no restart before that hour")
  s.advance(120)
  check(s.restarts.count == 1, "then it restarts")
}

// 58. Active really restarts in this build (V1.28): the developer's switch is the only one.
do {
  check(RebootEngine.activeAllowed, "activeAllowed is on in this build")
  let s = Sim(cfg(.active, 1)); s.lock(); s.advance(H + 600)
  check(s.restarts.count == 1 && s.woulds.isEmpty, "Active: restarted, no would have")
}

// 24. Randomized: thousands of mixes of lock, unlock, sleep, wake, clock changes, helper restarts,
//     corrupt files and setting changes. The safety rules are checked on every restart.
var rng = SystemRandomNumberGenerator()
var totalRestarts = 0
for round in 0..<300 {
  let modes: [RebootMode] = [.active, .active, .watch, .off]
  let s = Sim(cfg(modes[round % 4], [1, 2, 12, 72][Int.random(in: 0..<4, using: &rng)]), session: .unlocked)
  s.lidShut = Bool.random(using: &rng); s.tickEvery = 20
  for _ in 0..<150 {
    switch Int.random(in: 0..<13, using: &rng) {
    case 0, 1: s.lock()
    case 2: s.unlock()
    case 3: if !s.asleep { s.goToSleep() }
    case 4: s.session = .noUser
    case 5: s.offset += Double.random(in: -86400...86400, using: &rng)
    case 6: if !s.asleep { s.daemonRestart(corrupt: Bool.random(using: &rng)) }
    case 7: if !s.asleep { s.setConfig(cfg([.active, .watch, .off][Int.random(in: 0..<3, using: &rng)], Int.random(in: 1...72, using: &rng), test: Int.random(in: 0..<8, using: &rng) == 0)) }
    case 8: s.spawnWorks = Int.random(in: 0..<5, using: &rng) != 0
    case 9: s.missNextWake = Bool.random(using: &rng)
    case 10: if !s.asleep { s.postpone("random") }
    default: break
    }
    let d = Double.random(in: 1...(8 * H), using: &rng)
    if s.asleep, Bool.random(using: &rng) { s.advance(d, userWakeAt: s.cont + Double.random(in: 1...d, using: &rng)) } else { s.advance(d) }
  }
  totalRestarts += s.restarts.count
  for v in s.violations { check(false, "random round \(round): \(v)") }
}
check(totalRestarts > 50, "the random run really restarted sometimes (\(totalRestarts))")

print(failures == 0 ? "REBOOT CORE: all \(passes) checks passed (random restarts: \(totalRestarts))" : "REBOOT CORE: \(failures) FAILED, \(passes) passed")
exit(failures == 0 ? 0 : 1)
