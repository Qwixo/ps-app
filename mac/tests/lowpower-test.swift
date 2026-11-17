// Unit tests for Low power mode's Mac rules (Sources/LowPowerCore.swift, PS 1.65). No window, no timer, no network.
import Foundation

var fails: [String] = [], n = 0
func check(_ name: String, _ ok: Bool) { if ok { n += 1 } else { fails.append(name) } }

let off = LowPowerState.from([:])
check("off: nothing asleep", !off.on && !off.asleep("net") && !off.asleep("alarms") && !off.asleep("anything"))
let on = LowPowerState.from(["on": true, "why": "hand", "asleep": ["net", "mixer", "updates", "Bad Id", 7], "names": ["Network monitor", "Volume\nmixer"], "alarms": true])
check("on: listed feeds asleep", on.asleep("net") && on.asleep("mixer") && on.asleep("updates"))
check("on: bad ids dropped", !on.asleep.contains("Bad Id") && on.asleep.count == 3)
check("on: an id the page did not list still sleeps", on.asleep("activity"))
check("on: alarms keep ringing with their switch on", !on.asleep("alarms"))
check("on: names cleaned", on.names == ["Network monitor", "Volume mixer"])
check("why kept", on.why == "hand")
let noAlarms = LowPowerState.from(["on": true, "why": "mac", "asleep": ["net"], "alarms": false])
check("alarms switch off: alarms asleep", noAlarms.asleep("alarms") && noAlarms.why == "mac")
let odd = LowPowerState.from(["on": "yes", "why": "evil", "asleep": "net"])
check("odd values: off", !odd.on && odd.why == "" && odd.asleep.isEmpty)
let weird = LowPowerState.from(["on": true, "why": "evil"])
check("unknown why: empty", weird.on && weird.why == "")
let big = LowPowerState.from(["on": true, "asleep": (0..<500).map { "f\($0)" }, "names": (0..<500).map { _ in String(repeating: "x", count: 300) }])
check("caps: 64 ids, 40 names of 40", big.asleep.count == 64 && big.names.count == 40 && big.names.allSatisfy { $0.count == 40 })
check("sync slows to 4 minutes while on", LowPowerState.syncEvery(20, on: true) == 240 && LowPowerState.syncEvery(20, on: false) == 20 && LowPowerState.syncEvery(600, on: true) == 600)
check("line", LowPowerState.line([]) == "Nothing is asleep" && LowPowerState.line(["Gmail"]) == "Asleep: Gmail"
  && LowPowerState.line(["A", "B"]) == "Asleep: A and B" && LowPowerState.line(["A", "B", "C", "D", "E"]) == "Asleep: A, B, C and 2 more")
check("the same answer twice is equal (no extra work)", LowPowerState.from(["on": true, "asleep": ["net"]]) == LowPowerState.from(["on": true, "asleep": ["net"]]))

let offS = LowPowerState(), onS = LowPowerState.from(["on": true, "why": "hand", "asleep": ["net"]])
check("catch ups dropped only when it falls asleep again", LowPowerState.dropsCatchUps(before: offS, next: onS)
  && !LowPowerState.dropsCatchUps(before: onS, next: offS) && !LowPowerState.dropsCatchUps(before: offS, next: offS)
  && !LowPowerState.dropsCatchUps(before: onS, next: LowPowerState.from(["on": true, "why": "mac", "asleep": ["net"]])))
check("catch ups staggered after the ones already waiting", LowPowerState.nextSlot(now: 100, last: nil) == 100.8
  && LowPowerState.nextSlot(now: 100, last: 104) == 105.5 && LowPowerState.nextSlot(now: 100, last: 90) == 100.8)

if fails.isEmpty { print("lowpower: \(n) passed") } else { print("lowpower: \(fails.count) failed: \(fails.joined(separator: ", "))"); exit(1) }
