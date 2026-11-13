// Offline test for Sources/SafeSignal.swift: never sends a signal (send and probe are stubbed).
//   mkdir -p build/safesignal && cp tests/safesignal-test.swift build/safesignal/main.swift && swiftc build/safesignal/main.swift Sources/SafeSignal.swift -o build/safesignal/test && build/safesignal/test
import Darwin
import Foundation

func psLog(_ s: String) {}
var sent: [(pid_t, Int32)] = []
SafeSignal.send = { p, s in sent.append((p, s)); return 0 }
SafeSignal.probe = { _ in true }
var fails = 0
func check(_ name: String, _ ok: Bool) { print("\(name)=\(ok ? "ok" : "FAIL")"); if !ok { fails += 1 } }

let psExe = "/Applications/PS.app/Contents/MacOS/PS"
for (name, pid) in [("minus-one", pid_t(-1)), ("zero", 0), ("one", 1), ("negative", -42), ("self", getpid()),
                    ("parent-not-ps", getppid())] {
  sent = []
  SafeSignal.signal(pid, SIGTERM, expected: [psExe], why: "test")
  SafeSignal.signal(pid, SIGKILL, expected: [psExe], why: "test")
  SafeSignal.stop(pid, exe: psExe, grace: 0.1, why: "test")
  check("no-signal-to-\(name)", sent.isEmpty)
}
check("not-usable", ![-1, 0, 1, getpid()].contains(where: { SafeSignal.usable($0) }))
check("not-existing-when-unusable", ![-1, 0, 1, getpid()].contains(where: { SafeSignal.exists($0) }))
// Positive control: the parent process with its own exact executable is the only case that sends.
sent = []
if let exe = SafeSignal.executable(of: getppid()) {
  SafeSignal.signal(getppid(), 0, expected: [exe], why: "test")
  check("sends-only-on-exact-path", sent.count == 1 && sent[0].0 == getppid())
}
print(fails == 0 ? "SAFE SIGNAL: 0 FAIL" : "SAFE SIGNAL: \(fails) FAIL")
exit(fails == 0 ? 0 : 1)
