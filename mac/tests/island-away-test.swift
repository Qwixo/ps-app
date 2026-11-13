// Offline test for Sources/IslandAwayCore.swift (V1.58, the island's right click menu): Disappear for this meeting
// (its end, moved or longer meetings, gone meetings), Disappear for a time (typed, scrolled, kept between 1 minute and 24
// hours), and the hide kept across a restart. Never starts PS, never opens a window.
//   mkdir -p build/islandaway && cp tests/island-away-test.swift build/islandaway/main.swift && swiftc build/islandaway/main.swift Sources/IslandAwayCore.swift -o build/islandaway/test && build/islandaway/test
import Foundation

var fails = 0, count = 0
func check(_ name: String, _ ok: Bool, _ info: String = "") { count += 1; print("\(name)=\(ok ? "ok" : "FAIL")\(info.isEmpty || ok ? "" : " (\(info))")"); if !ok { fails += 1 } }
typealias C = IslandAwayCore

let now = 1_794_600_000.0   // 13 Nov 2026, 15:00 UTC
func meet(_ id: String, _ s: Double, _ e: Double, real: Bool = true) -> IslandMeet { IslandMeet(id: id, start: now + s * 60, end: now + e * 60, real: real) }

// MARK: what the page sends
let raw: [Any] = [["id": "a", "start": (now - 600) * 1000, "end": (now + 1200) * 1000, "real": true],
                  ["id": "", "start": 1, "end": 2], ["id": "b", "start": 5, "end": 1], "junk", ["id": "c", "start": "x", "end": 3]]
let parsed = C.meets(raw)
check("meets-parsed-and-checked", parsed == [IslandMeet(id: "a", start: now - 600, end: now + 1200, real: true)], "\(parsed)")
check("meets-none", C.meets(nil).isEmpty && C.meets("x").isEmpty)
check("meets-capped", C.meets(Array(repeating: ["id": "x", "start": 1000, "end": 2000] as [String: Any], count: 40)).count == 12)

// MARK: which meeting is on now
check("current-none-before", C.current([meet("a", 5, 30)], now: now) == nil)
check("current-none-after", C.current([meet("a", -60, 0)], now: now) == nil)
check("current-on-now", C.current([meet("a", -10, 20), meet("later", 30, 60)], now: now)?.id == "a")
check("current-real-before-block", C.current([meet("focus", -5, 50, real: false), meet("call", -20, 10)], now: now)?.id == "call")
check("current-latest-started", C.current([meet("first", -50, 30), meet("joined", -5, 40)], now: now)?.id == "joined")
check("current-starts-later-without-new-message", C.current([meet("at3", 30, 60)], now: now + 31 * 60)?.id == "at3")

// MARK: disappear for this meeting
let m = meet("a", -10, 20)
let away = C.forMeeting(m, now: now)!
check("meeting-until-its-end", away.kind == .meeting && away.until == now + 1200 && away.meet == "a")
check("meeting-over-no-away", C.forMeeting(meet("x", -60, -1), now: now) == nil)
check("meeting-capped-12h", C.forMeeting(meet("allday", -10, 3000), now: now)!.until == now + 12 * 3600)
check("meeting-stays-while-on", C.step(away, now: now + 60, meets: [m]) == .stay(away))
check("meeting-back-at-end", C.step(away, now: now + 1200, meets: [m]) == .back)
check("meeting-back-at-end-without-page", C.step(away, now: now + 1201, meets: nil) == .back)
var longer = away; longer.until = now + 50 * 60
check("meeting-extended-follows", C.step(away, now: now + 60, meets: [meet("a", -10, 50)]) == .stay(longer))
var shorter = away; shorter.until = now + 5 * 60
check("meeting-shortened-follows", C.step(away, now: now + 60, meets: [meet("a", -10, 5)]) == .stay(shorter))
check("meeting-ended-early-back", C.step(away, now: now + 6 * 60, meets: [meet("a", -10, 5)]) == .back)
check("meeting-moved-later-back", C.step(away, now: now + 60, meets: [meet("a", 30, 60)]) == .back)
check("meeting-deleted-back", C.step(away, now: now + 60, meets: [meet("other", -10, 60)]) == .back)
check("meeting-page-silent-clock-only", C.step(away, now: now + 60, meets: nil) == .stay(away))
check("meeting-other-overlap-ignored", C.step(away, now: now + 60, meets: [m, meet("b", -30, 90)]) == .stay(away))

// MARK: disappear for a time
let half = C.forMinutes(30, now: now)
check("minutes-until", half.kind == .minutes && half.until == now + 1800 && half.meet == nil)
check("minutes-stay", C.step(half, now: now + 1799, meets: []) == .stay(half))
check("minutes-back", C.step(half, now: now + 1800, meets: []) == .back)
check("minutes-ignore-meetings", C.step(half, now: now + 60, meets: [meet("a", -10, 1)]) == .stay(half))
check("minutes-clamped", C.forMinutes(0, now: now).until == now + 60 && C.forMinutes(99_999, now: now).until == now + 24 * 3600)

// MARK: the restart (wall clock end kept in UserDefaults)
let kept = C.encode(half)
check("restart-kept", C.decode(kept, now: now + 600) == half)
check("restart-after-sleep-over", C.decode(kept, now: now + 1800) == nil)
check("restart-meeting-kept", C.decode(C.encode(away), now: now + 60) == away)
check("restart-broken-dropped", C.decode(Data("{".utf8), now: now) == nil && C.decode(nil, now: now) == nil)
check("restart-too-long-dropped", C.decode(C.encode(IslandAway(kind: .minutes, until: now + 3 * 86400, meet: nil)), now: now) == nil)
check("restart-meeting-without-id-dropped", C.decode(C.encode(IslandAway(kind: .meeting, until: now + 60, meet: nil)), now: now) == nil)
check("restart-nothing-kept", C.encode(nil) == nil)

// MARK: typing and scrolling the time
for (t, want) in [("30", 30), ("45m", 45), ("45 min", 45), (" 90 ", 90), ("1h", 60), ("1 hour", 60), ("2 hours", 120), ("1.5h", 90), ("1,5 h", 90),
                  ("1:30", 90), ("0:45", 45), ("2h 15m", 135), ("1h30", 90), ("1 hr 5 mins", 65), ("24h", 1440), ("100h", 1440)] {
  check("parse-\(t.trimmingCharacters(in: .whitespaces))", C.parse(t) == want, "\(String(describing: C.parse(t)))")
}
for t in ["", "abc", "0", "0m", "1:75", "-5", "5 days", "h", "12345678901234567890123"] { check("parse-bad-\(t)", C.parse(t) == nil, "\(String(describing: C.parse(t)))") }
check("scroll-small-steps", C.scrolled(from: 5, up: true) == 6 && C.scrolled(from: 10, up: false) == 9)
check("scroll-five-up-to-an-hour", C.scrolled(from: 30, up: true) == 35 && C.scrolled(from: 60, up: false) == 55)
check("scroll-fifteen-above", C.scrolled(from: 60, up: true) == 75 && C.scrolled(from: 90, up: false) == 75)
check("scroll-stops-at-ends", C.scrolled(from: 1, up: false) == 1 && C.scrolled(from: 1440, up: true) == 1440)
check("unit-words", C.unit(1) == "minute" && C.unit(30) == "minutes")
check("default-30", C.defaultMinutes == 30)

print("ISLAND AWAY: \(count - fails) of \(count) ok")
exit(fails == 0 ? 0 : 1)
