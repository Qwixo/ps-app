import AppKit
import WebKit

// Left out of the public source: Second Computer, AirPods and microphone auto routing, and sending email replies.
// They only run on the developer's own account (Owner.red). These placeholders keep the names the rest of the app
// uses and do nothing. See README.md, "What is left out". (scripts in the private tree: open-source.mjs)

/// Second Computer (left out).
final class Second {
  static let shared = Second()
  var toPage: (String) -> Void = { _ in }
  var openWindow: (String?) -> Void = { _ in }
  var beforePanel: () -> Void = {}
  var cmdRunner: ((_ action: String, _ id: String, _ from: String, _ at: Double, _ done: @escaping (Bool, String?) -> Void) -> Void)?
  var machine: (() -> [String: Any])?
  var statusLine: String { "" }
  func start() {}
  func quit() {}
  func setUnlocked(_ on: Bool) {}
  func machineChanged() {}
  func handle(_ type: String, _ msg: [String: Any]) {}
  func keyAction(_ id: String, _ action: String) {}
  func pick(_ target: [String: Any]) {}
  func dropped(_ l: SecondDragLoad, target: [String: Any]) {}
  func localShared(root: String, path: String) -> String? { nil }
  func fetchTo(_ item: [String: Any], dest: URL, done: @escaping (Error?) -> Void) { done(nil) }
}
final class SecondWindow: NSObject {
  private(set) var window: NSWindow?
  private(set) var web: WKWebView?
  private(set) var ready = false
  private(set) var seen: [String] = []
  func testTearDown() {}
  init(app: App) {}
  static func asMain(_ type: String) -> Bool { false }
  func handle(_ type: String, _ text: String) -> Bool { false }
  func open(_ tab: String?, tries: Int = 0) {}
  func isWeb(_ v: WKWebView?) -> Bool { false }
  func reloadPage() {}
  func send(_ json: String) {}
  func load(_ s: String) {}
}
final class SecondConfirm {
  static let shared = SecondConfirm()
  var beforeShow: () -> Void = {}
}
final class SecondConfirmPanel: NSPanel {}
protocol SecondStore: AnyObject {}
final class SecondKeychain: SecondStore {
  static var gate: () -> Bool = { false }
  static var mayTouch: Bool { false }
}
final class SecondFileStore: SecondStore {
  init(dir: String) {}
  func read(_ key: String) -> Data? { nil }
}
enum SecondHandoff {
  static func collect(_ store: SecondStore) -> [String: String] { [:] }
  static func save(_ items: [String: String], into store: SecondStore) -> Int { 0 }
}
final class SecondIdentity {
  static func checkCmd(_ b: [String: Any], signerRole: String?, now: Date = Date()) -> String? { "Left out of the public source" }
  static func autoRebootSet(_ a: String) -> (mode: String, minutes: Int)? { nil }
}
enum SecondSelfTest {
  static var peer: Bool { false }
  static func peerAllowed(lockFD: Int32) -> Bool { false }
  static func runPeer() {}
}

/// AirPods and microphone auto routing (left out).
final class AutoRoute {
  static let shared = AutoRoute()
  var isOn: Bool { false }
  func start(testDir: String?) {}
  func setOn(_ b: Bool) {}
  func action(_ id: String, _ act: String) {}
  func noteOwnInput(_ uid: String) {}
  func restoreOutput() -> String? { nil }
  func restoreHomeMic() -> String? { nil }
}

/// Sending email replies (left out).
final class MailSend {
  static let shared = MailSend()
  weak var app: App?
  var onChange: (() -> Void)?
  var onSent: ((String) -> Void)?
  private(set) var rows: [[String: Any]] = []
  func start() {}
  func settingsJSON() -> [String: Any] { [:] }
  func forget(_ via: String, _ account: String?) {}
  static func handoffCollect() -> [String: String] { [:] }
  @discardableResult static func handoffSave(_ o: [String: String]) -> Int { 0 }
}
final class ReplyPanel: NSPanel {}
final class ReplyWindow: NSObject {
  init(app: App) {}
  func isWeb(_ v: WKWebView?) -> Bool { false }
  func status() {}
  func queue() {}
  func showPill() {}
  func handle(_ type: String, _ msg: [String: Any], _ text: String) {}
  var lastPrefs: Any?
  func open(ctx: Any, prefs: Any, job: Any? = nil, tries: Int = 0) {}
  func prefs(_ p: Any) {}
  func connect(_ msg: [String: Any]) {}
  func showQueue() {}
  func reloadPage() {}
  func protectedChanged() {}
}

/// Used by public features too (dropping alarm sounds and soundboard files names the file with clean), so this one is
/// the real code, copied as it is. The rest of SecondLanding (Second Computer's file landing) is left out.
enum SecondLanding {
  /// A safe file name: no folders, no dot files, no control characters, at most 200 characters.
  static func clean(_ raw: String) -> String {
    var s = raw.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-").replacingOccurrences(of: "\\", with: "-")
    s = String(s.unicodeScalars.filter { $0.value >= 32 && $0.value != 127 }.map(Character.init))
    while s.hasPrefix(".") || s.hasPrefix(" ") || s.hasPrefix("-") { s.removeFirst() }
    s = s.trimmingCharacters(in: .whitespaces)
    if s.count > 200 {
      let ext = (s as NSString).pathExtension
      s = String(s.prefix(ext.isEmpty || ext.count > 10 ? 200 : 199 - ext.count)) + (ext.isEmpty || ext.count > 10 ? "" : "." + ext)
    }
    return s.isEmpty ? "file" : s
  }
}
/// Second Computer's shared folders and jobs (left out): nothing is ever accepted.
enum SecondShare {
  static func pathOk(_ p: String) -> Bool { false }
  static func rootIdOk(_ s: String) -> Bool { false }
}
enum SecondJobs {
  static func isId(_ s: String) -> Bool { false }
}

/// The self tests of the left out features: nothing to check here, they finish at once.
extension SelfTest {
  static func numCheck(_ a: App, _ dir: String, _ done: @escaping () -> Void) { done() }
  static func secondCheck(_ a: App, _ dir: String, _ done: @escaping () -> Void) { done() }
  static func routeCheck(_ a: App, _ dir: String, _ done: @escaping () -> Void) { done() }
}
