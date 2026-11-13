// The only things PS can ask rebootd (compiled into both). Every answer is JSON data. There is no
// command that runs anything else, and wakes are rebootd's own business (never asked for by PS).
import Foundation

@objc protocol RebootdXPC {
  /// {v, proto, mode, minutes, testOnce, session, counting, deadline, left, wake, bootedAt, history, log, configError,
  ///  postponed}
  func status(reply: @escaping (Data) -> Void)
  /// {mode: "off"|"watch"|"active", minutes: 60...4320, testOnce: Bool}. Answers the new status.
  func setConfig(_ json: Data, reply: @escaping (Data) -> Void)
  /// Restart now (a normal restart: apps are told to quit and unsaved changes do not stop it).
  func restart(_ reason: String, reply: @escaping (Data) -> Void)
  /// Shut down now (the Second Computer Shut down button).
  func shutDown(_ reason: String, reply: @escaping (Data) -> Void)
  /// proto 2 (V1.28). Postpone the running countdown by an hour (a signed command from the developer's other Mac or
  /// phone that PS has already checked). Answers {ok, why}.
  func postpone(_ reason: String, reply: @escaping (Data) -> Void)
  /// proto 3 (V1.48). Sentry mode's lid closed keep awake: {on: Bool, session: String (8 to 64 letters, digits,
  /// dashes), battery: 1...50 (the floor in percent)}. PS sends on every 30 s while Sentry mode runs; with no
  /// renewal for 90 s the helper turns it off by itself. Answers {ok, on, why?}; why is one of LidStop's raw
  /// values (battery, hot, lease, off, failed, notAllowed, safeMode, invalid).
  func lid(_ json: Data, reply: @escaping (Data) -> Void)
  /// proto 3 (V1.48). Sentry mode's restart deadline: {op: "arm", seconds: 300...604800} | {op: "cancel"} |
  /// {op: "read"}. Armed, the Mac restarts at the deadline unless PS cancels it, even with PS gone; a new boot
  /// clears it. Arm and cancel only from PS of the console user. Answers {ok, deadline?: wall seconds,
  /// left?: seconds, why?: "range" | "notAllowed" | "invalid" | "safeMode"}.
  func sentryRestart(_ json: Data, reply: @escaping (Data) -> Void)
}

enum RebootdIDs {
  /// What this helper understands: 1 = V1.23 to V1.27 (status, setConfig, restart, shutDown), 2 = V1.28
  /// (postpone, Active allowed, counting before the first unlock), 3 = V1.48 (lid and sentryRestart, Sentry
  /// mode's lid closed keep awake and restart deadline). PS never calls a newer method on an
  /// older helper (it reads `proto` from the status first), and an old helper keeps running until the
  /// Mac restarts.
  static let proto = 3
  static let mach = "com.cincee.ps.rebootd"
  static let plist = "com.cincee.ps.rebootd.plist"
  // Both sides check the other is genuine: same certificate (the developer's "PS Local Signing", self signed,
  // so leaf and root are the same) and the exact identifier.
  static let cert = "c0e302f2ce304d062a50d6ebdaff97d5f7d4b6e6"
  static let psRequirement = "identifier \"com.cincee.ps\" and certificate root = H\"\(cert)\""
  static let helperRequirement = "identifier \"com.cincee.ps.rebootd\" and certificate root = H\"\(cert)\""
}
