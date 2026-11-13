// Offline test for Sources/MacOSWatchCore.swift (V1.47): the start line and the "macOS updated" check.
//   bash tests/macos-watch-test.sh
import Foundation

var fails = 0, count = 0
func check(_ name: String, _ ok: Bool, _ info: String = "") { count += 1; print("\(name)=\(ok ? "ok" : "FAIL")\(info.isEmpty || ok ? "" : " (\(info))")"); if !ok { fails += 1 } }

let a = "Version 27.2 (Build 26B123)", b = "Version 27.2.1 (Build 26B131)"
let first = MacOSWatchCore.note(now: a, last: nil)
check("first-start", !first.changed && first.line == "PS start: macOS \(a)", first.line)
let empty = MacOSWatchCore.note(now: a, last: "")
check("empty-memory", !empty.changed)
let same = MacOSWatchCore.note(now: a, last: a)
check("same-macos", !same.changed && same.line == "PS start: macOS \(a)")
let up = MacOSWatchCore.note(now: b, last: a)
check("updated", up.changed && up.line == "PS start: macOS updated from \(a) to \(b)", up.line)
let line = up.line.unicodeScalars
check("no-dashes", !line.contains { $0.value == 0x2013 || $0.value == 0x2014 })
print("\(count - fails)/\(count) passed")
exit(fails == 0 ? 0 : 1)
