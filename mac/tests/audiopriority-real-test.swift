// Run: bash tests/audiopriority-real-test.sh   (AP_READ_ONLY=1 to only read)
import CoreAudio
import Foundation

var n = 0, bad = 0
func check(_ name: String, _ ok: Bool) { n += 1; if ok { print("ok -", name) } else { bad += 1; print("FAIL -", name) } }
let b = CoreAudioAP()
let outs = b.devices(.speakers), ins = b.devices(.mics)
func show(_ d: APDevice) -> String { "\(d.name) [\(d.kind.rawValue)\(d.alive ? "" : ", asleep")]" }
print("Speakers on this Mac:"); outs.forEach { print("  ", show($0)) }
print("Microphones on this Mac:"); ins.forEach { print("  ", show($0)) }
let defOut = b.defaultUID(.speakers), defIn = b.defaultUID(.mics), sysOut = b.systemOutputUID()
print("Default output:", outs.first { $0.uid == defOut }?.name ?? "(virtual or none)", " Default input:", ins.first { $0.uid == defIn }?.name ?? "(virtual or none)")
check("at least one real speaker and one microphone are listed", !outs.isEmpty && !ins.isEmpty)
check("every device has a usable id, none repeated in a list", outs.allSatisfy { APCore.okUID($0.uid) } && Set(outs.map(\.uid)).count == outs.count && Set(ins.map(\.uid)).count == ins.count)
check("1Password and Signal are never listed", !(outs + ins).contains { Protected.matches($0.name) || Protected.matches($0.uid) })
check("PS's own mixer devices are never listed", !(outs + ins).contains { $0.uid.hasPrefix("ps-mixer-") })
check("the default output is listed or is a virtual one the person chose", defOut == nil || outs.contains { $0.uid == defOut } || b.isAlive(defOut!))
let first = APCore.merge([], outs, side: .speakers, now: 1, protected: Protected.matches)
let firstMics = APCore.merge([], ins, side: .mics, now: 1, protected: Protected.matches)
print("First order PS would make here. Speakers:", first.map(\.name).joined(separator: " > "), " Microphones:", firstMics.map(\.name).joined(separator: " > "))
check("the first order holds every real device once", first.count == outs.count && firstMics.count == ins.count)
check("ids are stable: a second read gives the same ids", Set(b.devices(.speakers).map(\.uid)) == Set(outs.map(\.uid)))

func waitFor(_ uid: String) -> Bool {
  for _ in 0..<30 { if b.defaultUID(.speakers) == uid { return true }; Thread.sleep(forTimeInterval: 0.1) }
  return false
}
if ProcessInfo.processInfo.environment["AP_READ_ONLY"] != nil {
  print("skip - setting the default output (AP_READ_ONLY)")
} else if b.micRunning() {
  print("skip - setting the default output: an app is using the microphone (a call?)")
} else if let orig = defOut, outs.contains(where: { $0.uid == orig }),
          let other = outs.first(where: { $0.uid != orig && $0.alive && $0.kind != .airplay && $0.kind != .phone }) {
  print("Setting the default output to \(other.name) and back")
  defer {
    // Always put both back, even if a check failed.
    _ = b.setDefault(.speakers, orig, alerts: false)
    if let s = sysOut { _ = b.setSystemOutput(s) }
  }
  check("set the default output to another device", b.setDefault(.speakers, other.uid, alerts: true) && waitFor(other.uid))
  check("set it back", b.setDefault(.speakers, orig, alerts: false) && waitFor(orig))
  if let s = sysOut { _ = b.setSystemOutput(s); Thread.sleep(forTimeInterval: 0.3) }
  check("the output is exactly what it was", b.defaultUID(.speakers) == orig)
  check("the alerts output is exactly what it was", b.systemOutputUID() == sysOut)
  check("the microphone was never touched", b.defaultUID(.mics) == defIn)
} else {
  print("skip - setting the default output: only one usable output on this Mac (or a virtual one is the default)")
}
print("audiopriority-real: \(n - bad) of \(n) passed")
exit(bad == 0 ? 0 : 1)
