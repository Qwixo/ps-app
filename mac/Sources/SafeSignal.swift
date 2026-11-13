// The only way PS signals another process. Why (27 Oct 2026): NSWorkspace reported a launched
// test copy's process id as -1, the update helper passed it to kill(), and kill(-1, ...) reaches
// every process the user owns: every app on the developer's Mac stopped.
// Rules: a signal goes only to a pid above 1 that is not this process, and only when that process
// runs exactly an expected executable, checked right before the signal. Never kill(-1), kill(0) or
// a negative pid; never anything found by name. Asking whether a pid exists (signal 0, nothing is
// delivered) obeys the same pid rule. Tests replace `send` so they never send a real signal.
import Darwin
import Foundation

enum SafeSignal {
  static var send: (pid_t, Int32) -> Int32 = { Darwin.kill($0, $1) }
  static var probe: (pid_t) -> Bool = { Darwin.kill($0, 0) == 0 }       // signal 0: nothing delivered
  static var log: (String) -> Void = { psLog($0) }

  /// A pid PS may act on at all: above 1 and not PS itself (a pid of -1 or 0 means "not known").
  static func usable(_ pid: pid_t) -> Bool { pid > 1 && pid != getpid() }

  /// Whether the process exists (signal 0: nothing is delivered), for a usable pid only.
  static func exists(_ pid: pid_t) -> Bool { usable(pid) && probe(pid) }

  /// The executable a process runs, as the kernel knows it (symlinks resolved).
  static func executable(of pid: pid_t) -> String? {
    guard pid > 1 else { return nil }
    var buf = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
    guard proc_pidpath(pid, &buf, UInt32(buf.count)) > 0 else { return nil }
    return real(String(cString: buf))
  }
  static func real(_ p: String) -> String { URL(fileURLWithPath: p).standardizedFileURL.resolvingSymlinksInPath().path }

  /// Sends `sig` to `pid` only when it runs one of `expected` (exact executable paths). True: sent.
  @discardableResult
  static func signal(_ pid: pid_t, _ sig: Int32, expected: [String], why: String) -> Bool {
    guard usable(pid) else { log("PS signal: refused pid \(pid) (\(why))"); return false }
    guard let exe = executable(of: pid) else { log("PS signal: pid \(pid) is gone or unknown, nothing sent (\(why))"); return false }
    guard expected.map(real).contains(exe) else { log("PS signal: refused pid \(pid), it runs \(exe) (\(why))"); return false }
    let ok = send(pid, sig) == 0
    log("PS signal: sent \(sig == SIGKILL ? "SIGKILL" : sig == SIGTERM ? "SIGTERM" : "signal \(sig)") to pid \(pid) (\(exe)) \(ok ? "" : "failed ")(\(why))")
    return ok
  }

  /// Asks a PS build to stop (SIGTERM), then SIGKILL after `grace` seconds, each time only if the
  /// pid still runs `exe`. Waits until it is gone. True when it is gone (or never ran it).
  @discardableResult
  static func stop(_ pid: pid_t, exe: String, grace: Double = 3, why: String) -> Bool {
    guard signal(pid, SIGTERM, expected: [exe], why: why) else { return !runs(pid, exe) }
    var until = Date().addingTimeInterval(grace)
    while runs(pid, exe) && Date() < until { usleep(50_000) }
    if runs(pid, exe) { signal(pid, SIGKILL, expected: [exe], why: why) }
    until = Date().addingTimeInterval(3)
    while runs(pid, exe) && Date() < until { usleep(50_000) }
    return !runs(pid, exe)
  }
  /// Whether `pid` is alive and still runs `exe`.
  static func runs(_ pid: pid_t, _ exe: String) -> Bool { exists(pid) && executable(of: pid) == real(exe) }
}
