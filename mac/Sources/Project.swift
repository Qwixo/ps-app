// The Supabase project this Mac's PS uses (5 Nov 2026, "Connect your own Supabase").
// PS is one app for everyone. By default it talks to the vault project the web build was made for
// (the developer's). Someone the developer gives PS to links a free Supabase project of their own instead, in PS's setup
// window (ProjectSetup.swift); its address and public (anon or publishable) key are kept here, on this
// Mac only, in Application Support/PS/project.json (0600). Never in the vault, never sent anywhere.
// The page learns it before any of its code runs (a document start script, window.__psProject), and
// the page's Content-Security-Policy lets it reach that one project and nothing else.
// The developer's own native features (Owner.swift) need the developer's project: on any other one they stay off.
import Foundation

struct PSProject: Codable, Equatable {
  var url: String                       // https://<ref>.supabase.co
  var key: String                       // the project's public key (anon or publishable): safe in a page by design
  var ref: String
  var name: String?
  var setupCode: String?                // lets the first account in; cleared once it exists
  var kit: String?                      // the project kit (migrations and functions) last applied in full
  var functions: [String: String]?      // function name -> SHA-256 of the sources deployed
  var linkedAt: String?
  /// Where PS's tables are: nil or "public", or "ps" in a project that also holds someone's own app (7 Nov 2026).
  var schema: String?
  var dbSchema: String { schema == "ps" ? "ps" : "public" }
}

enum ProjectStore {
  static let redRef = "mxusokxekkecebwqgeru"
  static let redURL = "https://\(redRef).supabase.co"
  private static let env = ProcessInfo.processInfo.environment
  static let test = env["PS_SELFTEST"] != nil

  /// The file: Application Support/PS/project.json (a test copy keeps its own in its test folder).
  static var file: URL {
    if let t = env["PS_SELFTEST"] { return URL(fileURLWithPath: t, isDirectory: true).appendingPathComponent("project.json") }
    if let f = env["PS_PROJECT_FILE"], env["PS_PROJECT_TEST"] == "1" { return URL(fileURLWithPath: f) }   // unit tests only
    return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("PS", isDirectory: true).appendingPathComponent("project.json")
  }

  /// The linked project, or nil for the build's own (the developer's). Read once at launch (a tiny local file).
  private(set) static var current: PSProject? = load()

  /// "https://<20 lowercase letters or digits>.supabase.co" gives its ref; anything else nil.
  static func ref(of url: String) -> String? {
    let u = url.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: #"/+$"#, with: "", options: .regularExpression)
    guard u.range(of: #"^https://[a-z0-9]{20}\.supabase\.co$"#, options: .regularExpression) != nil else { return nil }
    return String(u.dropFirst("https://".count).prefix(20))
  }
  static func validKey(_ k: String) -> Bool {
    k.range(of: #"^(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|sb_publishable_[A-Za-z0-9_-]{10,200})$"#, options: .regularExpression) != nil
  }
  static func validCode(_ c: String) -> Bool { c.range(of: #"^[A-Za-z0-9-]{16,64}$"#, options: .regularExpression) != nil }
  static func valid(_ p: PSProject) -> Bool {
    ref(of: p.url) == p.ref && validKey(p.key) && (p.setupCode.map(validCode) ?? true)
  }

  static func load() -> PSProject? {
    guard let d = try? Data(contentsOf: file), let p = try? JSONDecoder().decode(PSProject.self, from: d) else { return nil }
    guard valid(p) else { psLog("PS project: the saved project file is not valid, using the default"); return nil }
    return p
  }

  /// Saves atomically, readable by this user only.
  static func save(_ p: PSProject) throws {
    guard valid(p) else { throw NSError(domain: "PS", code: 1, userInfo: [NSLocalizedDescriptionKey: "not a valid project"]) }
    let dir = file.deletingLastPathComponent()
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let enc = JSONEncoder(); enc.outputFormatting = [.sortedKeys]
    let tmp = dir.appendingPathComponent(".project.json.tmp")
    try enc.encode(p).write(to: tmp, options: .atomic)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: tmp.path)
    _ = try FileManager.default.replaceItemAt(file, withItemAt: tmp)
    current = p
    psLog("PS project: linked to project \(p.ref)")
  }
  /// Back to the build's own project.
  static func clear() {
    try? FileManager.default.removeItem(at: file)
    current = nil
    psLog("PS project: back to the default project")
  }
  /// Test hook: what the next read sees.
  static func reload() { current = load() }

  /// True while PS uses the developer's own project (the default, or the developer's ref picked by hand).
  static var isRed: Bool { current == nil || current?.ref == redRef }
  static var custom: Bool { current != nil && current?.ref != redRef }
  static var url: String { current?.url ?? redURL }

  /// The G Squad hub (V1.40): its own Supabase project, reached only by its edge function `squad` over https.
  /// It holds only sealed squad data; never the vault. Every account's page may reach it (G Squad is public).
  static let squadHub = "https://zxhvchchfrkfqxuyorqo.supabase.co"
  /// connect-src for the page: this one project, its Realtime socket, nothing else.
  static func connectSources(_ url: String) -> String { "\(url) \(url.replacingOccurrences(of: "https://", with: "wss://"))" }

  /// The page's script, run before any of its own code: the linked project, or nothing for the default.
  static func pageScript(_ p: PSProject?) -> String? {
    guard let p, p.ref != redRef else { return nil }
    var o: [String: String] = ["url": p.url, "key": p.key]
    if let c = p.setupCode { o["setupCode"] = c }
    if p.dbSchema == "ps" { o["schema"] = "ps" }
    guard let d = try? JSONSerialization.data(withJSONObject: o, options: [.sortedKeys]), let j = String(data: d, encoding: .utf8) else { return nil }
    return "Object.defineProperty(window,'__psProject',{value:Object.freeze(\(j)),writable:false,configurable:false});"
  }

  // Whether PS asks for a project at first launch: never on a Mac that already used PS's default server.
  static let knownKey = "project.knownDefault", skippedKey = "project.skipped"
  static var knownDefault: Bool {
    get { flag(knownKey) as? Bool ?? false }
    set { setFlag(knownKey, newValue) }
  }
  static var skipped: Bool {
    get { flag(skippedKey) as? Bool ?? false }
    set { setFlag(skippedKey, newValue) }
  }
  /// Where the person chose to keep their list (V1.44 local first): "local" (this Mac only, no Supabase) or "sync"
  /// (their own Supabase). Set by the installer's "Where should your list live?" page, the Supabase window's "Keep
  /// everything on this Mac instead" and the page's own choice. nil: not asked yet (or a Mac from before V1.44).
  static let storeKey = "setup.store"
  static var setupStore: String? {
    get { (flag(storeKey) as? String).flatMap { ["local", "sync"].contains($0) ? $0 : nil } }
    set { setFlag(storeKey, newValue.flatMap { ["local", "sync"].contains($0) ? $0 : nil }) }
  }
  /// The installer may ask "Where should your list live?": only on a Mac that never used PS and never chose.
  static var choiceOpen: Bool { current == nil && !knownDefault && !skipped && !usedBefore && setupStore == nil }
  /// Someone has unlocked PS on this Mac before (Owner.swift writes owner.red after an unlock).
  static var usedBefore: Bool { flag("owner.red") != nil }
  /// This Mac's PS settings; a test copy keeps its own in memory and never reads or writes the developer's.
  private static var testFlags: [String: Any] = [:]
  static func flag(_ k: String) -> Any? { test ? testFlags[k] : UserDefaults.standard.object(forKey: k) }
  static func setFlag(_ k: String, _ v: Any?) {
    if test { testFlags[k] = v; return }
    if let v { UserDefaults.standard.set(v, forKey: k) } else { UserDefaults.standard.removeObject(forKey: k) }
  }
}

/// The page's Content-Security-Policy (the same rules as the website's): scripts only from the app,
/// network only to `connect`.
func pageCSP(_ connect: String) -> String {
  [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    "connect-src \(connect)",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].joined(separator: "; ")
}
