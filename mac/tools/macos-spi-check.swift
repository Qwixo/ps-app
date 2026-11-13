// V1.47: checks that every private macOS symbol PS leans on is still there after a macOS update.
// Only looks the names up (dlsym), never calls one, and reads no window, key, sound or permission.
// Safe while the developer uses the Mac. Run: bash tools/macos-spi-check.sh
import Foundation
import CoreGraphics

let checks: [(file: String, lib: String, sym: String, used: String)] = [
  ("/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC", "TCC", "TCCAccessPreflight", "mixer and installer: is sound recording allowed"),
  ("/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC", "TCC", "TCCAccessRequest", "mixer and installer: ask for sound recording"),
  ("", "libsystem", "responsibility_get_pid_responsible_for_pid", "mixer: which app a sound helper belongs to"),
  ("/System/Library/Frameworks/Security.framework/Security", "Security", "SecTranslocateIsTranslocatedURL", "installer: started from a quarantined copy"),
  ("/System/Library/Frameworks/Security.framework/Security", "Security", "SecTranslocateCreateOriginalPathForURL", "installer: the real path of that copy"),
  ("/System/Library/PrivateFrameworks/login.framework/Versions/Current/login", "login", "SACLockScreenImmediate", "phone command: lock the Mac"),
  ("/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices", "DisplayServices", "DisplayServicesGetBrightness", "torch: read brightness"),
  ("/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices", "DisplayServices", "DisplayServicesSetBrightness", "torch: set brightness"),
  ("/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices", "DisplayServices", "DisplayServicesCanChangeBrightness", "torch: can this screen change brightness"),
  ("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices", "ApplicationServices", "_CGSDefaultConnection", "torch: window server connection"),
  ("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices", "ApplicationServices", "CGSSetConnectionProperty", "torch: window server property"),
]
var bad = 0
for c in checks {
  let h = c.file.isEmpty ? UnsafeMutableRawPointer(bitPattern: -2) : dlopen(c.file, RTLD_LAZY)
  let ok = h != nil && dlsym(h, c.sym) != nil
  if !ok { bad += 1 }
  print("\(ok ? "ok     " : "MISSING") \(c.lib).\(c.sym)  (\(c.used))")
}
// Secure Input: PS names the app holding it from this session key (SecureInput.swift). It is only present while
// some app holds Secure Input, so "absent" here is normal; only a crash or an empty dictionary would be news.
let d = CGSessionCopyCurrentDictionary() as? [String: Any]
print("\(d == nil ? "MISSING" : "ok     ") CGSessionCopyCurrentDictionary  (Secure Input: which app holds it; key kCGSSessionSecureInputPID \(d?["kCGSSessionSecureInputPID"] == nil ? "absent right now, normal when nothing holds it" : "present"))")
if d == nil { bad += 1 }
print(bad == 0 ? "All private macOS pieces PS uses are still there." : "\(bad) missing: see macos-27.2.1-check.md for what each one breaks.")
exit(bad == 0 ? 0 : 1)
