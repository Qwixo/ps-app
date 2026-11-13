#!/bin/bash
# Proof that the unit tests guard each promise: every mutant below breaks one rule in a temp copy of
# Helper/RebootCore.swift, and the tests must FAIL for it. Never touches the repo copy.
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cp "$HERE/tests/reboot-core-test.swift" "$OUT/main.swift"
run() {   # name, then pairs of (old, new) replacements, all applied
  local name="$1"; shift
  python3 - "$HERE/Helper/RebootCore.swift" "$OUT/RebootCore.swift" "$@" <<'PY'
import sys
src, dst, pairs = sys.argv[1], sys.argv[2], sys.argv[3:]
s = open(src).read()
for old, new in zip(pairs[0::2], pairs[1::2]):
    if old not in s: sys.exit("mutant does not apply: " + old[:60])
    s = s.replace(old, new, 1)
open(dst, "w").write(s)
PY
  [ $? -eq 0 ] || { echo "MUTANT $name: DID NOT APPLY"; bad=$((bad+1)); return; }
  if ! swiftc -O -D REBOOT_TEST_ACTIVE "$OUT/RebootCore.swift" "$OUT/main.swift" -o "$OUT/t" 2>/dev/null; then echo "MUTANT $name: does not compile (counts as caught)"; caught=$((caught+1)); return; fi
  timeout 90 "$OUT/t" > "$OUT/log" 2>&1; rc=$?
  if [ $rc -eq 0 ]; then echo "MUTANT $name: SURVIVED (tests still pass)"; bad=$((bad+1))
  elif [ $rc -eq 124 ]; then echo "MUTANT $name: caught (the tests never finish: the simulated Mac loops)"; caught=$((caught+1))
  else echo "MUTANT $name: caught ($(grep -c FAIL "$OUT/log") failing checks)"; caught=$((caught+1)); fi
}
caught=0; bad=0
run no-30-min-uptime 'var deadline: Double { max(plainDeadline, RebootEngine.minUptime) }' 'var deadline: Double { plainDeadline }'
run second-restart-per-boot 'if mode == .active && state.bootTried && state.attempts == 0 {' 'if false {'
run marker-ignored 'if triedThisBoot { state.bootTried = true }' ''
run arms-without-unlock 'state = RebootState(boot: boot, seenUnlock: false,' 'state = RebootState(boot: boot, seenUnlock: true,'
# V1.28 (the developer: no boot loop, GrapheneOS's BFU rule): rebootd's own sign in record gates the timer too.
run signin-record-ignored '    if !state.seenUnlock || !signInSeen {' '    if !state.seenUnlock {'
run postpone-in-bfu '    if !state.seenUnlock || !signInSeen { return (false, "Nothing is counting down' '    if false { return (false, "Nothing is counting down'
# Lock periods.
run period-not-closed-on-unlock '      out += closePeriod("unlock", now: now, wall: wall)
' ''
run period-ran-zero 'ran: max(0, now - state.lastUnlocked), end: end' 'ran: 0, end: end'
run boot-period-dropped '          log.append(.period(LockPeriod(lockedAt: lw, endedAt: max(lw, bootWall), ran: max(0, bootWall - lw), end: "boot", postponed: s.postponed, would: s.wouldAt)))' ''
run restarts-unlocked 'let anyOpen = onConsole.contains { ($0["CGSSessionScreenIsLocked"] as? Bool) != true }' 'let anyOpen = false'
# The retry wake has two guards (set at the attempt, held again during the window): break both.
run no-retry-wake 'out += hold(wall + RebootEngine.retryAfter, wall: wall)' '' 'if state.wake.map({ abs($0 - want) > slack || $0 < want - 0.001 }) ?? true { out += hold(want, wall: wall); out.append(.save) }' ''
run no-backup-wake '[at.rounded(.up), (at + backupWake).rounded(.up)]' '[at.rounded(.up)]'
run floor-under-10-minutes 'static let minMinutes = 10,' 'static let minMinutes = 1,'
run corrupt-not-disarmed 'v == 2 && lastUnlocked.isFinite && lastUnlocked >= 0 && lastUnlocked <= now + 1' 'v == 2'
run config-change-no-reset 'state.lastUnlocked = max(state.lastUnlocked, now)' ''
run test-never-expires 'if wasCounting && config.testOnce && state.periodMinutes == RebootConfig.testMinutes {' 'if false {'
run saved-unlocked-not-marked 'savedAt = now; state.savedUnlocked = true; out.append(.save)' 'savedAt = now; out.append(.save)'
run early-wake-kept '|| $0 < dlWall - 0.001 }) ?? true {' '}) ?? true {'
run auto-login-ignored 'config.mode == .active && (!RebootEngine.activeAllowed || watchOnlyBecause != nil) ? .watch' 'config.mode == .active && !RebootEngine.activeAllowed ? .watch'
run damaged-marker-not-tried 'guard let body = markerBody, let text = String(data: body, encoding: .utf8) else { return (true, true) }' 'guard let body = markerBody, let text = String(data: body, encoding: .utf8) else { return (false, false) }'
run no-max-attempts 'if state.attempts >= RebootEngine.maxAttempts {' 'if false {'
run cross-boot-state-kept 'if let s = loaded, s.boot == boot, s.isSane(now: now) {' 'if let s = loaded, s.isSane(now: now) {'
run boot-floor-25-min 'static let minUptime = 30.0 * 60' 'static let minUptime = 25.0 * 60'
run future-start-tolerated 'lastUnlocked <= now + 1' 'lastUnlocked <= now + 3000'
run command-boot-floor 'if uptime < commandMinUptime {' 'if uptime < 61 {'
run command-gap 'if sinceLast < commandGap {' 'if sinceLast < 6 {'
run fallback-ignores-unlock '!automatic || (session != .unlocked && attempts > 0)' 'true'
run sigterm-always-keeps 'if attemptInFlight(now: now) { return true }' 'return true'
run sigterm-keeps-saved-wake '    state.wake = nil
    return false' '    return false'
run reconcile-never-reasks 'if reask { state.wake = nil }' ''
run off-keeps-wake 'if c.mode == .off { out.append(.cancelWake(state.wake ?? 0)); state.wake = nil }' ''
run retry-wake-not-reasked 'if state.wake.map({ abs($0 - want) > slack || $0 < want - 0.001 }) ?? true {' 'if false {'
run retry-not-moved-on-clock 'if state.wake.map({ abs($0 - want) > slack || $0 < want - 0.001 }) ?? true {' 'if state.wake == nil {'
run watch-keeps-backup 'out.append(.cancelWake(state.wake ?? 0)); state.wake = nil   // the backup too' 'if let w = state.wake { out.append(.cancelWake(w)) }; state.wake = nil   // the backup too'
run explicit-ignored '      if explicitInFlight {' '      if false {'
run explicit-uses-gaveup-flag 'if !explicitLogged { explicitLogged = true;' 'if !gaveUpLogged { gaveUpLogged = true;'
run marker-not-repaired 'else { return (true, true) }' 'else { return (true, false) }'
# V1.28: Postpone.
run postpone-not-reset-on-unlock '      state.postponed = nil
      bfuLogged = false; gaveUpLogged = false; explicitLogged = false' '      bfuLogged = false; gaveUpLogged = false; explicitLogged = false'
run postpone-no-cap 'if need > RebootEngine.maxPostpone + 0.5 {' 'if false {'
run postpone-after-attempt 'if state.fired || state.attempts > 0 { return (false, "Too late' 'if false { return (false, "Too late'
run postpone-while-unlocked 'if s == .unlocked { return (false, "This Mac is unlocked' 'if false { return (false, "This Mac is unlocked'
run postpone-instant-restart 'let need = max(deadline, now) + RebootEngine.postponeStep' 'let need = deadline + RebootEngine.postponeStep'
run postpone-ignored-by-deadline 'state.lastUnlocked + Double(state.periodMinutes) * 60 + (state.postponed ?? 0) }' 'state.lastUnlocked + Double(state.periodMinutes) * 60 }'
run postponed-damage-tolerated '      && (postponed.map { $0.isFinite && $0 >= 0 && $0 <= RebootEngine.maxPostpone + 1 } ?? true)' ''
run active-switched-off 'static let activeAllowed = true' 'static let activeAllowed = false'
echo "MUTANTS: $caught caught, $bad survived"
[ $bad -eq 0 ]
