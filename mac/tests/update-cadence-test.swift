// Offline test for UpdateCadence (Sources/UpdateLatest.swift, V1.54, the developer, 12 Nov 2026: "can you not change it to every
// five minutes the update instead of every 30 minutes?"). Looks every 5 minutes, one at a time, and a longer wait after
// failed looks: 5, 10, 20, 30 minutes at most, back to 5 after one that works. Nothing runs, no network, no files.
// Run: bash tests/update-cadence-test.sh
import Foundation

var fails = 0
func check(_ name: String, _ ok: Bool, _ info: String = "") { print("\(name)=\(ok ? "ok" : "FAIL")\(info.isEmpty ? "" : " (\(info))")"); if !ok { fails += 1 } }

// 1. The rhythm.
check("every-5-minutes", UpdateCadence.every == 300 && UpdateCadence().delay == 300)
check("first-look-45-seconds-after-launch", UpdateCadence.first == 45)
check("never-longer-than-30-minutes", UpdateCadence.longest == 1800)

// 2. The back off: 5, 10, 20, 30, 30 ... (minutes).
check("backoff-steps", [0, 1, 2, 3, 4, 5, 50, 1000].map { UpdateCadence.delay(fails: $0) / 60 } == [5, 10, 20, 30, 30, 30, 30, 30])
check("negative-counts-as-none", UpdateCadence.delay(fails: -3) == 300)

// 3. Failures count in a row; one look that works goes back to 5 minutes.
let c = UpdateCadence()
for n in 1...4 { _ = c.begin(manual: false); c.end(failed: true); check("after-\(n)-failed-looks", c.fails == n && c.delay == UpdateCadence.delay(fails: n)) }
check("fourth-failure-waits-30-minutes", c.delay == 1800)
_ = c.begin(manual: false); c.end(failed: false)
check("a-good-look-goes-back-to-5-minutes", c.fails == 0 && c.delay == 300)

// 4. One look at a time: an automatic look is skipped while one runs, the developer's own click still runs, and the count unwinds.
let d = UpdateCadence()
check("first-look-starts", d.begin(manual: false) && d.running)
check("automatic-look-skipped-while-running", !d.begin(manual: false) && !d.begin(manual: false))
check("clicked-look-still-runs", d.begin(manual: true))
d.end(failed: false)
check("still-running-until-both-end", d.running && !d.begin(manual: false))
d.end(failed: false)
check("idle-again", !d.running && d.begin(manual: false))
d.end(failed: false)
check("extra-end-never-goes-negative", { d.end(failed: false); return !d.running && d.begin(manual: false) }())

// 5. Many threads at once: exactly one automatic look gets in.
let e = UpdateCadence()
var started = 0
let lock = NSLock()
DispatchQueue.concurrentPerform(iterations: 200) { _ in if e.begin(manual: false) { lock.lock(); started += 1; lock.unlock() } }
check("200-threads-one-look", started == 1, "\(started)")

// 6. Settings, "Check for updates every" (V1.54): 5, 10, 15 or 30 minutes, default 5, bad values fall back to 5,
// and the back off (5, 10, 20, 30) only ever makes the wait longer.
check("choices", UpdateCadence.choices == [5, 10, 15, 30])
check("default-is-5-minutes", UpdateCadence().every == 5 && UpdateCadence().delay == 300)
for m in [5, 10, 15, 30] {
  let k = UpdateCadence()
  check("choice-\(m)-kept", k.setEvery(m) == m && k.every == m && k.delay == Double(m) * 60)
}
for bad in [-5, 1, 7, 20, 31, 60, 1800, Int.max, Int.min] {
  let k = UpdateCadence()
  check("bad-value-\(bad)-falls-back-to-5", k.setEvery(bad) == 5 && k.delay == 300)
}
let k5 = UpdateCadence(), k10 = UpdateCadence(), k15 = UpdateCadence(), k30 = UpdateCadence()
k5.setEvery(5); k10.setEvery(10); k15.setEvery(15); k30.setEvery(30)
var seen5 = [Double](), seen10 = [Double](), seen15 = [Double](), seen30 = [Double]()
for _ in 0..<4 {
  seen5.append(k5.delay / 60); seen10.append(k10.delay / 60); seen15.append(k15.delay / 60); seen30.append(k30.delay / 60)
  for k in [k5, k10, k15, k30] { _ = k.begin(manual: false); k.end(failed: true) }
}
check("backoff-on-5", seen5 == [5, 10, 20, 30])
check("backoff-on-10-never-shorter", seen10 == [10, 10, 20, 30])
check("backoff-on-15-never-shorter", seen15 == [15, 15, 20, 30])
check("backoff-on-30-stays-30", seen30 == [30, 30, 30, 30])
check("a-good-look-returns-to-the-choice", { k10.end(failed: false); return k10.fails == 0 && k10.delay == 600 }())
let k = UpdateCadence()
check("no-look-yet-no-last-end", k.sinceLastEnd == nil)
_ = k.begin(manual: false); k.end(failed: false)
check("last-end-known-after-a-look", (k.sinceLastEnd ?? 99) < 5)
check("changing-the-choice-keeps-the-failures", { let j = UpdateCadence(); _ = j.begin(manual: false); j.end(failed: true); j.setEvery(15); return j.fails == 1 && j.delay == 900 }())

// 7. Off (open source build): 0 means no automatic looks; nothing stored yet stays 5, a stored 0 stays Off.
let off = UpdateCadence()
check("off-is-0", UpdateCadence.off == 0 && UpdateCadence.clean(0) == 0)
check("off-kept", off.setEvery(0) == 0 && off.isOff && off.every == 0)
check("off-delay-is-a-safe-number", off.delay == 300 && UpdateCadence.delay(everyMin: 0, fails: 2) == 1200)
check("default-is-not-off", !UpdateCadence().isOff)
check("back-on-from-off", { let j = UpdateCadence(); j.setEvery(0); j.setEvery(15); return !j.isOff && j.delay == 900 }())
check("nothing-stored-is-5", UpdateCadence.stored(nil) == 5)
check("stored-0-is-off", UpdateCadence.stored(0) == 0 && UpdateCadence.stored(NSNumber(value: 0)) == 0)
check("stored-choice-kept", UpdateCadence.stored(15) == 15 && UpdateCadence.stored("15") == 5 && UpdateCadence.stored(7) == 5)
check("a-clicked-look-still-runs-when-off", { let j = UpdateCadence(); j.setEvery(0); let r = j.begin(manual: true); j.end(failed: false); return r }())

print(fails == 0 ? "ALL OK" : "\(fails) FAILED")
exit(fails == 0 ? 0 : 1)
