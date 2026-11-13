// PS's own log file: ~/Library/Logs/PS/ps.log (Console > Log Reports, or `tail` it).
// Only app state goes here (permission, keyboard tap, Tab switch). Never keys, tasks or passwords.
import Foundation

let psLogURL: URL = {
  let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/PS", isDirectory: true)
  try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  return dir.appendingPathComponent("ps.log")
}()

func psLog(_ s: String) {
  NSLog("%@", s)
  let line = "\(ISO8601DateFormatter().string(from: Date())) \(s)\n"
  if let h = try? FileHandle(forWritingTo: psLogURL) { h.seekToEndOfFile(); h.write(Data(line.utf8)); try? h.close() }
  else { try? Data(line.utf8).write(to: psLogURL) }
}
