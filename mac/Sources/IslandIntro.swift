import Cocoa

// The window and system side of the feature intros (PS 1.60). The rules are in IslandIntroCore.swift (tested). Nothing here waits:
// the process list is read from the kernel in memory (one sysctl, no helper program, no pause), so the main thread never blocks.
enum IslandIntro {
  /// True when a screen sharing helper is running. The process list is read from the kernel in memory (one sysctl, no helper program, no
  /// pause). Each name is compared and dropped at once: only a sharing helper's name is ever kept, never 1Password's or Signal's (rule 7).
  static func sharingNow() -> Bool {
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_ALL, 0]
    var size = 0
    guard sysctl(&mib, 3, nil, &size, nil, 0) == 0, size > 0 else { return false }
    var raw = [UInt8](repeating: 0, count: size + 4096)
    size = raw.count
    guard sysctl(&mib, 3, &raw, &size, nil, 0) == 0 else { return false }
    var found = false
    raw.withUnsafeBytes { bytes in
      let procs = bytes.bindMemory(to: kinfo_proc.self)
      for i in 0..<(size / MemoryLayout<kinfo_proc>.stride) {
        var c = procs[i].kp_proc.p_comm
        let n = withUnsafePointer(to: &c) { $0.withMemoryRebound(to: CChar.self, capacity: 17) { String(cString: $0) } }
        if IslandIntroCore.isHelper(n) { found = true }
      }
    }
    return found
  }

  static func facts() -> IslandIntroFacts {
    IslandIntroFacts(featureOn: Features.on("feature-intros"),
                     sentry: Sentry.shared.isUp,
                     sleep: SleepScreen.shared.isUp,
                     sharing: sharingNow(),
                     fullScreen: Island.shared.model.fullScreen)
  }
}
