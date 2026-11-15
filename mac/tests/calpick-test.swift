// Offline test for Sources/CalPickCore.swift (15 Nov 2026, which calendars PS works with): a colour as "#rrggbb", one calendar as the
// page gets it, the list (no duplicates, steady order, capped) and the fields an event carries. FICTIONAL calendars only; no
// EventKit, no app, no permission prompt.
//   mkdir -p build/calpick && cp tests/calpick-test.swift build/calpick/main.swift && swiftc build/calpick/main.swift Sources/CalPickCore.swift -o build/calpick/test && build/calpick/test
import Foundation

var fails = 0, count = 0
func check(_ name: String, _ ok: Bool, _ info: String = "") { count += 1; print("\(name)=\(ok ? "ok" : "FAIL")\(info.isEmpty || ok ? "" : " (\(info))")"); if !ok { fails += 1 } }

check("hex-basic", CalPickCore.hex(r: 1, g: 0, b: 0.5) == "#ff0080", "\(String(describing: CalPickCore.hex(r: 1, g: 0, b: 0.5)))")
check("hex-clamps", CalPickCore.hex(r: 2, g: -1, b: 0) == "#ff0000")
check("hex-nan", CalPickCore.hex(r: .nan, g: 0, b: 0) == nil && CalPickCore.hex(r: 0, g: .infinity, b: 0) == nil)

let a = CalPickCore.info(id: "id-1", name: "  Work  ", color: "#112233", acct: "iCloud")!
check("info-fields", a["id"] as? String == "id-1" && a["name"] as? String == "Work" && a["color"] as? String == "#112233" && a["acct"] as? String == "iCloud")
check("info-no-id", CalPickCore.info(id: nil, name: "x", color: nil, acct: nil) == nil && CalPickCore.info(id: "", name: "x", color: nil, acct: nil) == nil)
let b = CalPickCore.info(id: "id-2", name: "   ", color: nil, acct: nil)!
check("info-defaults", b["name"] as? String == "Calendar" && b["color"] is NSNull && b["acct"] as? String == "")
let long = CalPickCore.info(id: String(repeating: "i", count: 500), name: String(repeating: "n", count: 500), color: nil, acct: String(repeating: "a", count: 500))!
check("info-capped", (long["id"] as! String).count == 200 && (long["name"] as! String).count == 120 && (long["acct"] as! String).count == 80)

let rows: [[String: Any]] = [
  CalPickCore.info(id: "3", name: "routine", color: nil, acct: "Work")!,
  CalPickCore.info(id: "1", name: "Birthdays", color: nil, acct: "iCloud")!,
  CalPickCore.info(id: "3", name: "duplicate", color: nil, acct: "Work")!,
  CalPickCore.info(id: "2", name: "Calls", color: nil, acct: "Work")!,
]
let l = CalPickCore.list(rows)
check("list-unique-sorted", l.map { $0["id"] as! String } == ["1", "2", "3"], "\(l.map { $0["id"] as! String })")
check("list-keeps-first-duplicate", (l[2]["name"] as? String) == "routine")
let many = (0..<100).map { CalPickCore.info(id: "c\($0)", name: "n\($0)", color: nil, acct: "A")! }
check("list-capped", CalPickCore.list(many).count == CalPickCore.maxCals)
check("list-empty", CalPickCore.list([]).isEmpty)

let f = CalPickCore.eventFields(id: "id-1", name: "Work", color: "#112233")
check("event-fields", f["cal"] as? String == "id-1" && f["calName"] as? String == "Work" && f["calColor"] as? String == "#112233")
check("event-fields-none", CalPickCore.eventFields(id: nil, name: "Work", color: nil).isEmpty && CalPickCore.eventFields(id: "", name: nil, color: nil).isEmpty)
check("event-fields-id-only", CalPickCore.eventFields(id: "x", name: nil, color: nil).count == 1)

print("\(count - fails)/\(count) passed")
exit(fails == 0 ? 0 : 1)
