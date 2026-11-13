// Stand ins for tests/sentrylid-test.sh: just enough of PS for Sources/SentryLid.swift to build alone.
import Foundation
let IS_TEST_COPY = false
let testLog = NSMutableArray()
func psLog(_ s: String) { objc_sync_enter(testLog); testLog.add(s); objc_sync_exit(testLog); if ProcessInfo.processInfo.environment["LID_LOG"] != nil { print("  log:", s) } }
