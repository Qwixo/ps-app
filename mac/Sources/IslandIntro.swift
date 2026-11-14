import Cocoa

// The window and system side of the feature intros (PS 1.60). The rules are in IslandIntroCore.swift (tested). Nothing here waits:
// the process list is read from the kernel in memory (one sysctl, no helper program, no pause), so the main thread never blocks.
enum IslandIntro {
  /// Names of the running programs, from memory. Only the short name of each, nothing else.
  static func processNames() -> [String] {
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_ALL, 0]
    var size = 0
    guard sysctl(&mib, 3, nil, &size, nil, 0) == 0, size > 0 else { return [] }
    let count = size / MemoryLayout<kinfo_proc>.stride + 16
    var procs = [kinfo_proc](repeating: kinfo_proc(), count: count)
    size = count * MemoryLayout<kinfo_proc>.stride
    guard sysctl(&mib, 3, &procs, &size, nil, 0) == 0 else { return [] }
    return procs.prefix(size / MemoryLayout<kinfo_proc>.stride).map { p in
      var c = p.kp_proc.p_comm
      return withUnsafePointer(to: &c) { $0.withMemoryRebound(to: CChar.self, capacity: 17) { String(cString: $0) } }
    }
  }

  static func facts() -> IslandIntroFacts {
    IslandIntroFacts(featureOn: Features.on("feature-intros"),
                     sentry: Sentry.shared.isUp,
                     sleep: SleepScreen.shared.isUp,
                     sharing: IslandIntroCore.isSharing(processNames: processNames()),
                     fullScreen: Island.shared.model.fullScreen)
  }
}
