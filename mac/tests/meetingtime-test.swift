// Offline test for Sources/MeetingTime.swift (V1.40, the AFK timer stays off during meetings): the windows the
// page sends, "is a meeting on", where the AFK clock starts after a meeting, what part of a stretch is away, and
// what is kept of a card that was up when a meeting started. FICTIONAL times only; no app, no calendar.
//   mkdir -p build/meetingtime && cp tests/meetingtime-test.swift build/meetingtime/main.swift && swiftc build/meetingtime/main.swift Sources/MeetingTime.swift -o build/meetingtime/test && build/meetingtime/test
import Foundation

var fails = 0, count = 0
func check(_ name: String, _ ok: Bool, _ info: String = "") { count += 1; print("\(name)=\(ok ? "ok" : "FAIL")\(info.isEmpty || ok ? "" : " (\(info))")"); if !ok { fails += 1 } }

let base = Date(timeIntervalSince1970: 1_794_000_000)        // a fixed fictional moment
func at(_ min: Double) -> Date { base.addingTimeInterval(min * 60) }
func ms(_ min: Double) -> NSNumber { NSNumber(value: at(min).timeIntervalSince1970 * 1000) }
typealias W = MeetingTime.Win

// MARK: the page's list
let raw: [Any] = [[ms(60), ms(105)], [ms(0), ms(45)], [ms(40), ms(50)], ["x", ms(1)], [ms(10)], [ms(30), ms(20)], [ms(0), ms(60 * 14)], "junk"]
let w = MeetingTime.parse(raw)
check("parse-sorts-joins-drops", w == [W(from: at(0), to: at(50)), W(from: at(60), to: at(105))], "\(w)")
check("parse-junk", MeetingTime.parse(nil).isEmpty && MeetingTime.parse("x").isEmpty && MeetingTime.parse([Any]()).isEmpty)
check("parse-cap", MeetingTime.parse((0..<200).map { [ms(Double($0) * 10), ms(Double($0) * 10 + 5)] as [Any] }).count == MeetingTime.maxWindows)

// MARK: is a meeting on (the page already added 5 minutes before and 10 after)
check("meeting-now", MeetingTime.window(at(20), w) == W(from: at(0), to: at(50)))
check("window-start-counts", MeetingTime.window(at(0), w) != nil)
check("window-end-does-not", MeetingTime.window(at(50), w) == nil)
check("between-meetings", MeetingTime.window(at(55), w) == nil)

// MARK: where the AFK clock starts
check("after-meeting-clock-starts-at-its-end", MeetingTime.after(at(10), now: at(70 + 45), w) == at(105))   // still since minute 10, both meetings over
check("after-one-meeting", MeetingTime.after(at(10), now: at(55), w) == at(50))
check("input-after-meeting-stands", MeetingTime.after(at(52), now: at(58), w) == at(52))
check("meeting-not-over-yet-ignored", MeetingTime.after(at(55), now: at(80), w) == at(55))
check("no-meetings", MeetingTime.after(at(10), now: at(99), []) == at(10))

// MARK: away stretches leave meetings out
let parts = MeetingTime.outside(at(-20), at(120), w)
check("outside-cuts", parts.count == 3 && parts[0] == (at(-20), at(0)) && parts[1] == (at(50), at(60)) && parts[2] == (at(105), at(120)), "\(parts)")
check("outside-all-meeting", MeetingTime.outside(at(5), at(40), w).isEmpty)
check("outside-none", MeetingTime.outside(at(200), at(210), w).count == 1)
check("outside-empty", MeetingTime.outside(at(10), at(10), w).isEmpty)

// MARK: a card up when a meeting starts
let m = W(from: at(30), to: at(75))
check("keep-before-meeting", MeetingTime.keep(start: at(10), window: m, now: at(31)).map { $0 == (at(10), at(30)) } == true)
check("keep-none-inside", MeetingTime.keep(start: at(32), window: m, now: at(33)) == nil)
check("keep-never-after-now", MeetingTime.keep(start: at(10), window: m, now: at(20)).map { $0.1 == at(20) } == true)

// MARK: the shared copy and its switch
let t = MeetingTime()
check("set-changed", t.set([[ms(0), ms(45)]] as [Any]) && !t.set([[ms(0), ms(45)]] as [Any]))
check("shared-on", t.window(at: at(10)) != nil)
t.setEnabled(false)
check("switched-off-nothing-counts", t.window(at: at(10)) == nil && t.after(at(1), now: at(50)) == at(1) && t.outside(at(0), at(10)).count == 1)
t.setEnabled(true)
check("switched-on-again", t.window(at: at(10)) != nil)

print("\(count - fails)/\(count) ok")
exit(fails == 0 ? 0 : 1)
