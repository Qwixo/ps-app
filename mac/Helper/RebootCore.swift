// RebootCore: the auto reboot timer's whole decision logic, with no IOKit, no files and no clock of
// its own, so every case can be unit tested (tests/reboot-core-test.swift). rebootd.swift feeds it
// what it sees (the console session, continuous time, wall time, sleep and wake) and carries out the
// actions it returns (schedule or cancel a wake, save, log, restart).
//
// The rules, mirroring GrapheneOS's auto reboot (grapheneos.org/features: "reboots locked devices after a set
// period of time to put data at rest", the developer's spec from 2 Nov 2026), plus the developer's own:
//   - The countdown starts when the Mac stops being unlocked (locked, at the login window, or asleep)
//     and every unlock of any account resets it. The deadline is the last moment the Mac was seen
//     unlocked plus the timer length (10 minutes to 72 hours, 18 hours unless the developer changes it; the one
//     shot 5 minute test is the only shorter countdown).
//   - An unlocked Mac is never restarted by the timer. Nothing else holds it back (the developer, 2 Nov 2026: "if my
//     computer is locked in either AFU or BFU state, then I want it to restart, but not if it's
//     unlocked"): a call or a presentation happens on an unlocked Mac anyway.
//   - The timer arms only after an unlock it has SEEN in the current boot (GrapheneOS: it "doesn't apply
//     when the device is in Before First Unlock state", so it can never reboot over and over). After any
//     restart or shut down the Mac is in BFU until the developer signs in; the next lock after that starts afresh.
//     rebootd also keeps its own record of that first sign in for each boot (signInSeen, a separate
//     file): without it the timer never restarts, whatever this state says.
//   - Never within 30 minutes of boot, and at most one automatic restart per boot (its retries
//     included): even a stuck setting cannot make the Mac restart over and over.
//   - Time is continuous time since boot (it keeps counting through sleep and ignores clock, time
//     zone and DST changes). Wall time is only used to tell the RTC when to wake the Mac.
//   - A deadline belongs to one boot. A new boot or a corrupt, missing, odd or future dated state file
//     disarms it until the next unlock; a change of settings starts it again from now. Never an
//     instant restart. A crash or kill of rebootd (launchd starts it again) or of PS never resets it:
//     the countdown lives in rebootd's saved state.
//   - Every lock period ends up in a short list (LockPeriod): when it was locked, when and how it ended
//     (unlocked, restarted by the timer, restarted or shut down by the developer, the Mac started again, settings
//     changed, switched off), how long it ran, and any Postpone.
//   - Watch only logs "would have restarted" once per lock period and never restarts.
//   - activeAllowed (below) is the build's own switch: while false, Active behaves as Watch only.
//   - Postpone (a signed command from the other Mac or the phone, checked by PS): one more hour on the
//     running countdown, at most 12 hours in all; the next unlock starts a fresh countdown anyway.
import Foundation

enum RebootMode: String, Codable { case off, watch, active }

/// What the console shows. `noUser`: the login window, or nobody on the console.
enum ConsoleSession: String, Codable { case unlocked, locked, noUser }

enum RebootEvent: String { case start, tick, willSleep, didWake, config }

struct RebootConfig: Codable, Equatable {
  var mode: RebootMode = .off
  var minutes: Int = 18 * 60
  var testOnce: Bool = false                  // the next countdown is 5 minutes (used up when it fires or is unlocked)
  static let minMinutes = 10, maxMinutes = 72 * 60, testMinutes = 5

  /// 10 minutes to 72 hours or nothing: anything else is nil (the caller keeps the old config).
  static func parse(_ d: [String: Any]) -> RebootConfig? {
    guard let m = (d["mode"] as? String).flatMap(RebootMode.init(rawValue:)),
          let mins = (d["minutes"] as? NSNumber)?.intValue,
          mins >= minMinutes, mins <= maxMinutes else { return nil }
    return RebootConfig(mode: m, minutes: mins, testOnce: (d["testOnce"] as? Bool) ?? false)
  }
}

struct RebootState: Codable, Equatable {
  var v = 2
  var boot: String                            // kern.bootsessionuuid this countdown belongs to
  var seenUnlock = false                      // an unlock was SEEN in this boot (armed; never in Before First Unlock)
  var lastUnlocked: Double = 0                // continuous seconds: the countdown's start
  var periodMinutes: Int = 18 * 60            // fixed when the countdown (re)starts
  var fired = false                           // this countdown already restarted or logged "would have"
  var attempts = 0                            // restart attempts in this countdown (max 3)
  var lastAttempt: Double?                    // continuous seconds
  var wake: Double?                           // wall epoch of the RTC wake we hold, exactly as handed to IOKit
  var pending: PendingRestart?                // written just before a restart; read on the next boot
  var bootTried = false                       // an automatic restart was already started in this boot
  var savedUnlocked = false                   // the last save was made while unlocked (lastUnlocked may be a minute old)
  var skippedFor: Double?                     // lastUnlocked of a countdown already reported as slept through unlocked
  var postponed: Double?                      // seconds added to this countdown by Postpone (at most 12 h)
  var lockedWall: Double?                     // wall epoch: when the lock period now running began (nil: none running)
  var wouldAt: Double?                        // wall epoch: Watch only's "would have restarted" in that period
}

extension RebootState {
  /// Values only a bug or a damaged file could produce. Such a state is dropped and the timer is
  /// disarmed until the next unlock (never an instant restart).
  func isSane(now: Double) -> Bool {
    v == 2 && lastUnlocked.isFinite && lastUnlocked >= 0 && lastUnlocked <= now + 1
      && (periodMinutes == RebootConfig.testMinutes || (periodMinutes >= RebootConfig.minMinutes && periodMinutes <= RebootConfig.maxMinutes))
      && attempts >= 0 && attempts <= RebootEngine.maxAttempts
      && (lastAttempt.map { $0.isFinite && $0 >= lastUnlocked && $0 <= now + 1 } ?? true)
      && (wake.map { $0.isFinite } ?? true)
      && (postponed.map { $0.isFinite && $0 >= 0 && $0 <= RebootEngine.maxPostpone + 1 } ?? true)
      && (lockedWall.map { $0.isFinite } ?? true) && (wouldAt.map { $0.isFinite } ?? true)
  }
}

struct PendingRestart: Codable, Equatable { var at: Double; var why: String; var boot: String }

/// One lock period (rebootd keeps the last few, the Security window shows three): wall epochs, seconds.
/// end: "unlock" (an unlock ended it), "timer" (the timer restarted the Mac), "restart" or "shutdown" (the developer's
/// own, from a button or his other Mac or phone), "boot" (the Mac started again some other way), "changed"
/// (settings changed while locked, counting started again), "off" (auto reboot switched off).
struct LockPeriod: Codable, Equatable {
  var lockedAt: Double
  var endedAt: Double
  var ran: Double
  var end: String
  var postponed: Double?
  var would: Double?
}

struct HistoryEntry: Codable, Equatable {
  var at: Double                              // wall epoch
  var kind: String                            // "restart", "attempt", "would", "skipped", "remote", "shutdown", "gaveup", "held", "postponed"
  var text: String
}

enum RebootAction: Equatable {
  case scheduleWake(Double)                   // wall epoch, already rounded up and at least minWakeLead ahead
  case cancelWake(Double)
  case save
  case saveConfig                             // the 5 minute test was used up: write config.json again
  case markTried                              // write the "an automatic restart started in this boot" marker
  case log(String)
  case record(HistoryEntry)
  case restart(String)
  case period(LockPeriod)                     // a lock period ended: rebootd keeps it in its short list
}

final class RebootEngine {
  private(set) var config: RebootConfig
  private(set) var state: RebootState
  private var prev: ConsoleSession?
  private var savedAt: Double = -1e18         // continuous seconds of the last save while unlocked
  private var bfuLogged = false, gaveUpLogged = false, onceLogged = false
  private var explicitLogged = false          // the "waiting for your own restart" line, its own flag
  /// How a wall epoch is written in the log (rebootd passes local time with its zone).
  var fmt: (Double) -> String

  static let retryAfter = 180.0               // seconds between restart attempts
  static let maxAttempts = 3
  static let unlockedWakeSlack = 600.0        // while unlocked the held wake may be up to 10 min early
  static let lockedWakeSlack = 30.0           // while locked it is moved when 30 s off (clock changes)
  static let minWakeLead = 10.0               // a wake is never asked for less than 10 s ahead
  static let minUptime = 30.0 * 60            // never an automatic restart in the first 30 min after boot
  /// The build's own switch for real restarts by the timer. False: Active acts exactly as Watch only
  /// (logs, never restarts), whatever the settings say. V1.23 to V1.27 shipped false; true from V1.28
  /// (the developer, 1 Nov 2026: Active really works on the M1 and the M4; he switches it on himself).
  static let activeAllowed = true
  /// Each Postpone adds an hour to the running countdown, at most 12 hours in all.
  static let postponeStep = 3600.0
  static let maxPostpone = 12.0 * 3600

  static let commandGap = 30.0                // seconds between two explicit commands
  static let commandMinUptime = 180.0         // explicit commands are dropped in the first 3 min after boot

  enum Command: Equatable { case go(String), refuse(String) }
  /// Whether rebootd carries out an explicit restart or shut down (the developer's button, or a signed command
  /// from his other Mac or phone that PS has verified). `uptime`: continuous seconds since boot, so a
  /// command that reaches a Mac that only just started (for example one sent while it was restarting)
  /// can never restart it again. `sinceLast`: seconds since the last command. The reason is cleaned
  /// (no control characters, 120 at most) for the log.
  static func command(restart: Bool, reason: String, uptime: Double, sinceLast: Double) -> Command {
    let why = String(reason.unicodeScalars.filter { $0.value >= 0x20 && $0.value != 0x7F }.prefix(120).map(Character.init))
    if uptime < commandMinUptime { return .refuse("This Mac only just started") }
    if sinceLast < commandGap { return .refuse("Asked again within 30 s") }
    return .go(why)
  }

  /// `loaded`: the state file, nil when missing or unreadable. Anything but a sane state of this very
  /// boot leaves the timer disarmed until the next unlock it sees. `triedThisBoot`: the marker file
  /// says an automatic restart already started in this boot (kept apart, so a damaged state file
  /// cannot lift the one restart per boot rule). `session`: the console now.
  init(config: RebootConfig, loaded: RebootState?, boot: String, now: Double, wall: Double, triedThisBoot: Bool = false,
       session: ConsoleSession? = nil, fmt: @escaping (Double) -> String = { String(format: "%.0f", $0) }, log: inout [RebootAction]) {
    self.config = config
    self.fmt = fmt
    if let s = loaded, s.boot == boot, s.isSane(now: now) {
      state = s
      if s.savedUnlocked, let session, session != .unlocked, s.seenUnlock {
        // Saved while unlocked, now locked: the lock came while rebootd was not running, so the true
        // countdown start is unknown. Count from now (a little later, never earlier).
        state.lastUnlocked = now; state.savedUnlocked = false
        log += [.log("restarted while locked: countdown counted from now to be safe"), .save]
      }
    } else {
      state = RebootState(boot: boot, seenUnlock: false, lastUnlocked: now, periodMinutes: config.effectiveMinutes)
      if let s = loaded, s.boot == boot {
        if let w = s.wake { log.append(.cancelWake(w)) }
        state.bootTried = s.bootTried
        log.append(.log("saved state does not add up: disarmed until the next unlock"))
      } else if let s = loaded {
        if let w = s.wake { log.append(.cancelWake(w)) }
        if let p = s.pending, p.boot == s.boot {
          log.append(.record(HistoryEntry(at: p.at, kind: "restart", text: "Restarted at \(fmt(p.at)) (\(p.why)); back up at \(fmt(wall))")))
        }
        // A lock period still running when that boot ended (power, or a restart PS did not make): it ended then.
        if let lw = s.lockedWall, lw.isFinite {
          let bootWall = wall - now
          log.append(.period(LockPeriod(lockedAt: lw, endedAt: max(lw, bootWall), ran: max(0, bootWall - lw), end: "boot", postponed: s.postponed, would: s.wouldAt)))
        }
        log.append(.log("new boot: disarmed until the first unlock (Before First Unlock: no timer)"))
      } else {
        log.append(.log("no saved state (first run or unreadable): disarmed until the next unlock"))
      }
      log.append(.save)
    }
    if triedThisBoot { state.bootTried = true }
  }

  /// Continuous seconds. Never earlier than 30 minutes after boot. Postpone moves it later, never earlier.
  var deadline: Double { max(plainDeadline, RebootEngine.minUptime) }
  /// The countdown's own end (last unlock + timer length + postponed), without the 30 minute floor.
  private var plainDeadline: Double { state.lastUnlocked + Double(state.periodMinutes) * 60 + (state.postponed ?? 0) }
  /// Set by rebootd when this Mac would log itself in with nobody there (automatic login): then a
  /// restart is followed by an "unlock" no person made, so Active must act as Watch only.
  var watchOnlyBecause: String?
  /// Set by rebootd before every step from its own record of a sign in during this boot (a file apart from
  /// this state). False: Before First Unlock as far as rebootd knows, so the timer does nothing.
  var signInSeen = true
  /// Set by rebootd while the developer's own Restart or Shut down is under way (about 70 s after it was asked):
  /// the timer then makes no attempt of its own, so it never replaces or muddles that one.
  var explicitInFlight = false
  /// Active as the build and the Mac allow it.
  var mode: RebootMode { config.mode == .active && (!RebootEngine.activeAllowed || watchOnlyBecause != nil) ? .watch : config.mode }
  var session: ConsoleSession? { prev }
  /// Whether a countdown is running toward a restart or a "would have" right now.
  var counting: Bool { mode != .off && state.seenUnlock && prev != nil && prev != .unlocked && !state.fired && !(mode == .active && state.bootTried && state.attempts == 0) }

  /// A new config from PS. The same config again changes nothing; any real change restarts the
  /// countdown from now, so shortening the timer can never cause an instant restart.
  func setConfig(_ c: RebootConfig, now: Double, wall: Double, session s: ConsoleSession) -> [RebootAction] {
    if c == config { return [] }
    let old = config
    var closed: [RebootAction] = []
    if s != .unlocked { closed = closePeriod(c.mode == .off ? "off" : "changed", now: now, wall: wall) }
    config = c
    state.lastUnlocked = max(state.lastUnlocked, now)
    state.periodMinutes = c.effectiveMinutes
    state.fired = false; state.attempts = 0; state.lastAttempt = nil; state.pending = nil
    state.postponed = nil
    gaveUpLogged = false; onceLogged = false; explicitLogged = false
    var out: [RebootAction] = closed + [.log("settings: \(old.describe) -> \(c.describe); countdown starts again from now")]
    // Off drops every wake of ours at once (also a backup still pending after its wake fired).
    if c.mode == .off { out.append(.cancelWake(state.wake ?? 0)); state.wake = nil }
    out += step(.config, session: s, now: now, wall: wall)
    out.append(.save)
    return out
  }

  func step(_ ev: RebootEvent, session s: ConsoleSession, now: Double, wall: Double) -> [RebootAction] {
    var out: [RebootAction] = []
    defer { prev = s }
    // A wake whose time has passed has fired (or was missed): it is no longer held.
    if let w = state.wake, w <= wall - 1 { state.wake = nil }
    if mode == .off {
      out += closePeriod("off", now: now, wall: wall)
      if let w = state.wake { out += [.cancelWake(w), .log("timer off: wake cancelled"), .save]; state.wake = nil }
      if s == .unlocked { state.seenUnlock = true; state.lastUnlocked = now }
      return out
    }

    if s == .unlocked {
      out += closePeriod("unlock", now: now, wall: wall)
      let wasCounting = prev != nil && prev != .unlocked
      // Woke from a sleep that began unlocked and is still unlocked: macOS did not lock it on sleep, so
      // the timer cannot restart it. Say so once per countdown instead of staying silent.
      let oldDeadline = plainDeadline
      if ev == .didWake, prev == .unlocked, state.seenUnlock, now >= oldDeadline, state.skippedFor != state.lastUnlocked {
        state.skippedFor = state.lastUnlocked
        let text = "Slept past the deadline without locking, so no restart (set Lock Screen to ask for the password immediately)"
        out += [.log("woke unlocked after the deadline: " + text.lowercasedFirst), .record(HistoryEntry(at: wall, kind: "skipped", text: text))]
      }
      if wasCounting || !state.seenUnlock { out.append(.log(state.seenUnlock ? "unlocked: countdown reset" : "first unlock seen in this boot: timer armed")) }
      if wasCounting && config.testOnce && state.periodMinutes == RebootConfig.testMinutes {
        config.testOnce = false
        out += [.saveConfig, .log("5 minute test cancelled by the unlock")]
      }
      let changed = !state.seenUnlock || state.fired || state.attempts > 0 || state.pending != nil || !state.savedUnlocked
        || state.postponed != nil
      state.seenUnlock = true
      state.lastUnlocked = now
      state.periodMinutes = config.effectiveMinutes
      state.fired = false; state.attempts = 0; state.lastAttempt = nil; state.pending = nil
      state.postponed = nil
      bfuLogged = false; gaveUpLogged = false; explicitLogged = false
      // Keep a wake near the deadline so a sudden sleep (lid shut) still has one; exact on willSleep.
      let want = wall + (deadline - now)
      let slack = ev == .willSleep ? 1.0 : RebootEngine.unlockedWakeSlack
      if mode == .active && state.bootTried {
        if let w = state.wake { out.append(.cancelWake(w)); state.wake = nil }
      } else if state.wake.map({ abs($0 - want) > slack || (ev == .willSleep && $0 < want - 0.001) }) ?? true {
        out += hold(want, wall: wall)
      }
      if ev == .willSleep {
        out.append(.log("going to sleep unlocked: no restart while it stays unlocked; if it is locked when it wakes, \(mode == .watch ? "would restart" : "restart") at \(fmt(want))"))
      }
      if wasCounting || changed || ev == .willSleep || now - savedAt >= 60 || out.contains(where: { if case .scheduleWake = $0 { return true }; return false }) {
        savedAt = now; state.savedUnlocked = true; out.append(.save)
      }
      return out
    }

    // Locked, at the login window, or asleep from here on.
    if prev == .unlocked || state.savedUnlocked { state.savedUnlocked = false; out.append(.save) }
    if !state.seenUnlock || !signInSeen {
      // Before First Unlock (or rebootd has no record of a sign in this boot): no timer, no restart, ever.
      if !bfuLogged {
        // Once: drop every wake of ours (also a backup the state no longer names).
        bfuLogged = true
        out += [.cancelWake(state.wake ?? 0), .save, .log(state.seenUnlock
          ? "no sign in recorded by rebootd in this boot: the timer does not run (Before First Unlock, no restart loops)"
          : "no unlock seen in this boot: the timer does not run (Before First Unlock, no restart loops)")]
        state.wake = nil
      } else if let w = state.wake { out += [.cancelWake(w), .save]; state.wake = nil }
      return out
    }
    if state.lockedWall == nil {
      state.lockedWall = wall - (now - state.lastUnlocked)   // the lock period began when the Mac was last seen unlocked
      out.append(.save)
    }
    if mode == .active && state.bootTried && state.attempts == 0 {
      // An earlier countdown in this same boot already restarted (or tried): the Mac is still up, so
      // something is wrong. Never a second automatic restart in one boot.
      if !onceLogged {
        // Once: drop every wake of ours (also a backup the state no longer names).
        onceLogged = true
        out += [.cancelWake(state.wake ?? 0), .save,
                .log("an automatic restart was already started in this boot: not again until the next boot"),
                .record(HistoryEntry(at: wall, kind: "gaveup", text: "No restart: one automatic restart per boot, and this boot already had one"))]
        state.wake = nil
      } else if let w = state.wake { out += [.cancelWake(w), .save]; state.wake = nil }
      return out
    }
    let dl = deadline, left = dl - now, dlWall = wall + left
    if prev == .unlocked {
      let held = dl > plainDeadline ? ", held to 30 min after boot" : ""
      out.append(.log("\(s == .locked ? "locked" : "login window"): \(mode == .watch ? "would restart" : "restart") at \(fmt(dlWall)) (\(RebootEngine.dur(Double(state.periodMinutes) * 60)) after the last unlock\(held))"))
    }
    if ev == .didWake {
      out.append(.log("woke, \(s == .locked ? "locked" : "login window"): " + (left > 0 ? "\(RebootEngine.dur(left)) left" : "deadline passed \(RebootEngine.dur(-left)) ago")))
    }

    if left > 0 {
      // Exact when the countdown starts and before sleep; later only a clock change moves it. A held
      // wake earlier than the deadline is always moved (an early wake would find time left and could
      // fall back asleep with nothing held).
      let slack = ev == .willSleep || prev != s ? 1.0 : RebootEngine.lockedWakeSlack
      if state.wake.map({ abs($0 - dlWall) > slack || $0 < dlWall - 0.001 }) ?? true {
        if let w = state.wake, ev == .tick, prev == s { out.append(.log("clock changed: wake moved from \(fmt(w)) to \(fmt(dlWall))")) }
        out += hold(dlWall, wall: wall)
        out.append(.save)
      }
      return out
    }

    // The deadline has passed and nobody has unlocked.
    let late = RebootEngine.dur(-left)
    let place = s == .locked ? "locked" : "login window"
    switch mode {
    case .off: return out
    case .watch:
      if state.fired { return out }
      state.fired = true
      out.append(.cancelWake(state.wake ?? 0)); state.wake = nil   // the backup too, even if the wake itself has fired
      let held = config.mode != .active ? "" : !RebootEngine.activeAllowed ? " (Active is switched off in this build)" : " (\(watchOnlyBecause ?? ""))"
      let test = state.periodMinutes == RebootConfig.testMinutes && config.testOnce
      if test { config.testOnce = false; out.append(.saveConfig) }
      state.wouldAt = wall
      let text = "Would have restarted at \(fmt(dlWall)) (\(place), \(late) after the deadline\(test ? ", 5 minute test" : ""))"
      out += [.log("watch only\(held): " + text.lowercasedFirst), .record(HistoryEntry(at: wall, kind: "would", text: text)), .save]
    case .active:
      if explicitInFlight {
        if !explicitLogged { explicitLogged = true; out.append(.log("deadline reached while your own restart or shut down is under way: the timer waits")) }
        return out
      }
      if let a = state.lastAttempt, now - a < RebootEngine.retryAfter {
        // Waiting for the restart to take. If the retry wake was refused or lost, or the clock moved,
        // hold it again (every step, so also just before sleep): the Mac must not sleep through its retry.
        let want = wall + (a + RebootEngine.retryAfter - now)
        let slack = ev == .willSleep ? 1.0 : RebootEngine.lockedWakeSlack
        if state.wake.map({ abs($0 - want) > slack || $0 < want - 0.001 }) ?? true { out += hold(want, wall: wall); out.append(.save) }
        return out
      }
      if state.attempts >= RebootEngine.maxAttempts {
        if !gaveUpLogged {
          gaveUpLogged = true
          out.append(.cancelWake(state.wake ?? 0)); state.wake = nil
          out += [.log("still running after \(RebootEngine.maxAttempts) restart attempts: giving up until the next boot"),
                  .record(HistoryEntry(at: wall, kind: "gaveup", text: "Restart did not happen after \(RebootEngine.maxAttempts) tries")), .save]
        }
        return out
      }
      state.attempts += 1
      state.lastAttempt = now
      state.fired = true
      state.bootTried = true
      let test = state.periodMinutes == RebootConfig.testMinutes && config.testOnce
      if test { config.testOnce = false; out.append(.saveConfig) }
      // A wake a little later, in case the Mac falls asleep before the restart gets going.
      out += hold(wall + RebootEngine.retryAfter, wall: wall)
      let why = "auto reboot\(test ? " (5 minute test)" : ""), \(place), \(late) after the deadline"
      state.pending = PendingRestart(at: wall, why: why, boot: state.boot)
      out += closePeriod("timer", now: now, wall: wall)
      out += [.markTried, .save,
              .record(HistoryEntry(at: wall, kind: "attempt", text: "Restart started at \(fmt(wall)) (\(why), try \(state.attempts))")),
              .log("deadline reached, \(place), \(late) late: restarting (attempt \(state.attempts))"),
              .restart(why)]
    }
    return out
  }

  /// Postpone (a signed command from the developer's other Mac or phone that PS has already checked): the restart
  /// comes one hour later than it would now (an hour from now if it is already due). Only while a
  /// countdown runs (locked, nothing fired or attempted yet) and at most maxPostpone in all; the next
  /// unlock starts a fresh countdown anyway. It never restarts anything.
  func postpone(from who: String, now: Double, wall: Double, session s: ConsoleSession) -> (ok: Bool, why: String?, actions: [RebootAction]) {
    let from = String(who.unicodeScalars.filter { $0.value >= 0x20 && $0.value != 0x7F }.prefix(60).map(Character.init))
    if mode == .off { return (false, "Auto reboot is off on this Mac", []) }
    if s == .unlocked { return (false, "This Mac is unlocked, so nothing is counting down", []) }
    if !state.seenUnlock || !signInSeen { return (false, "Nothing is counting down (no sign in since this Mac started)", []) }
    if state.fired || state.attempts > 0 { return (false, "Too late: the restart has already started", []) }
    if mode == .active && state.bootTried { return (false, "Nothing is counting down: this Mac already restarted by itself since it started", []) }
    let need = max(deadline, now) + RebootEngine.postponeStep - (state.lastUnlocked + Double(state.periodMinutes) * 60)
    if need > RebootEngine.maxPostpone + 0.5 { return (false, "Already postponed as far as it goes (\(RebootEngine.dur(RebootEngine.maxPostpone)) for one countdown)", []) }
    state.postponed = need
    let dlWall = wall + (deadline - now)
    var out: [RebootAction] = [.log("postponed by 1 h (asked from \(from)): \(mode == .watch ? "would restart" : "restart") at \(fmt(dlWall)), \(RebootEngine.dur(need)) postponed in all"),
                               .record(HistoryEntry(at: wall, kind: "postponed", text: "Postponed 1 hour from \(from): now \(fmt(dlWall))"))]
    out += step(.config, session: s, now: now, wall: wall)   // moves the wake to the new deadline
    out.append(.save)
    return (true, nil, out)
  }

  /// Ends the lock period now running, if any, as `end` (see LockPeriod).
  func closePeriod(_ end: String, now: Double, wall: Double) -> [RebootAction] {
    guard let lw = state.lockedWall else { return [] }
    let p = LockPeriod(lockedAt: lw, endedAt: max(lw, wall), ran: max(0, now - state.lastUnlocked), end: end, postponed: state.postponed, would: state.wouldAt)
    state.lockedWall = nil; state.wouldAt = nil
    return [.period(p), .save]
  }
  /// The developer's own Restart or Shut down (a button, his other Mac or his phone) is being carried out.
  func explicitPower(restart: Bool, now: Double, wall: Double) -> [RebootAction] {
    closePeriod(restart ? "restart" : "shutdown", now: now, wall: wall)
  }

  /// Hold exactly one wake of ours (and its backup). The time kept is exactly what IOKit is given:
  /// rounded up to the whole second and never less than minWakeLead ahead. No cancel first: rebootd's
  /// scheduleWake removes the old pair only once the new wake is in, so a refusal never leaves none.
  private func hold(_ at: Double, wall: Double) -> [RebootAction] {
    let when = max(at, wall + RebootEngine.minWakeLead).rounded(.up)
    state.wake = when
    return [.scheduleWake(when)]
  }

  /// rebootd calls this when IOKit refused a wake, or does not hold the one the state names, so the
  /// next step asks for it again.
  func wakeFailed() { state.wake = nil }

  /// Whether a restart attempt of this boot is still in flight (the Mac may be going down for it).
  func attemptInFlight(now: Double) -> Bool { state.lastAttempt.map { now - $0 < 15 * 60 } ?? false }

  static let backupWake = 600.0               // a second wake 10 min after every wake, in case the first is missed
  /// The wakes rebootd holds for one wake time: it and its backup, whole seconds.
  static func wakePair(_ at: Double) -> [Double] { [at.rounded(.up), (at + backupWake).rounded(.up)] }

  /// What the console shows, from IOConsoleUsers (rebootd reads it from the IORegistry). Unlocked =
  /// someone logged in is on the console and that screen is not locked. Anything unclear counts as
  /// locked or no user, never as unlocked by mistake... except a missing lock flag, which is how macOS
  /// says "not locked". `loginDone`: someone is logged in at all.
  static func classifyConsole(_ value: Any?) -> (session: ConsoleSession, loginDone: Bool) {
    guard let users = value as? [[String: Any]] else { return (.noUser, false) }
    let loginDone = users.contains { ($0["kCGSessionLoginDoneKey"] as? Bool) == true }
    let onConsole = users.filter { ($0["kCGSSessionOnConsoleKey"] as? Bool) == true && ($0["kCGSessionLoginDoneKey"] as? Bool) == true }
    if onConsole.isEmpty { return (.noUser, loginDone) }
    let anyOpen = onConsole.contains { ($0["CGSSessionScreenIsLocked"] as? Bool) != true }
    return (anyOpen ? .unlocked : .locked, loginDone)
  }

  /// The "an automatic restart started in this boot" marker as rebootd stores it (checksummed body =
  /// the boot id). A marker that exists but cannot be read counts as tried for THIS boot, and rebootd
  /// rewrites it with this boot's id (`repair`), so damage costs at most one boot's restart, never a
  /// second restart and never the timer for good.
  static func triedThisBoot(markerBody: Data?, markerExists: Bool, boot: String) -> (tried: Bool, repair: Bool) {
    guard markerExists else { return (false, false) }
    guard let body = markerBody, let text = String(data: body, encoding: .utf8) else { return (true, true) }
    return (text == boot, false)
  }

  /// Whether the kernel fallback (60 s after asking shutdown) may force the restart. An explicit
  /// command always goes; the timer's own only while nobody has unlocked and the attempt still stands.
  static func fallbackGo(automatic: Bool, session: ConsoleSession, attempts: Int) -> Bool {
    !automatic || (session != .unlocked && attempts > 0)
  }

  /// rebootd is being stopped (SIGTERM). Returns whether to keep our wakes: yes while a restart
  /// attempt is in flight (most likely our own restart; the next boot removes them). Otherwise the
  /// wakes are cancelled and the state never keeps naming one.
  func stopping(now: Double) -> Bool {
    if attemptInFlight(now: now) { return true }
    state.wake = nil
    return false
  }

  /// At start: which of the wakes IOKit holds for us are stale (not the saved wake or its backup), and
  /// whether the saved wake is missing (then it is forgotten so the next step asks for it again).
  func reconcile(held: [Double]) -> (cancel: [Double], reask: Bool) {
    let pair = state.wake.map { RebootEngine.wakePair($0) } ?? []
    let cancel = held.filter { h in !pair.contains { abs(h - $0) < 1 } }
    let reask = state.wake.map { w in !held.contains { abs($0 - w.rounded(.up)) < 1 } } ?? false
    if reask { state.wake = nil }
    return (cancel, reask)
  }

  static func dur(_ s: Double) -> String {
    let t = Int(s.rounded())
    if t < 60 { return "\(t) s" }
    let h = t / 3600, m = (t % 3600) / 60
    return h == 0 ? "\(m) min" : m == 0 ? "\(h) h" : "\(h) h \(m) min"
  }
}

extension RebootConfig {
  var effectiveMinutes: Int { testOnce ? RebootConfig.testMinutes : minutes }
  var describe: String { mode == .off ? "off" : "\(mode == .watch ? "watch only" : "active") \(RebootEngine.dur(Double(effectiveMinutes) * 60))\(testOnce ? " (test)" : "")" }
}

private extension String { var lowercasedFirst: String { prefix(1).lowercased() + dropFirst() } }
