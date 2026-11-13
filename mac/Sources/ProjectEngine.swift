// What PS's "Connect your own Supabase" setup does (5 Nov 2026), without any window: ProjectSetup.swift
// drives it and shows the progress. Given a personal access token it creates a project (or takes an
// empty one the person picked), waits until it is up, applies the core migrations and deploys the sign in
// function from the kit inside the signed app (Contents/Resources/project-kit, made by web
// scripts/ps-kit.mjs from supabase/ps-core.json), checks the function answers, reads the public key and,
// while the project has no account yet, leaves a one time setup code for the first one.
// Every step can run again safely: applied migrations are recorded in the project (schema ps_meta), a
// project that was made but not finished is picked up again by Retry instead of making another, and the developer's
// own projects are refused outright.
import Foundation
import CryptoKit
import Security

// MARK: - the kit

struct ProjectKit {
  struct Migration { let version: String; let name: String; let file: String; let sha256: String }
  struct Function { let slug: String; let entry: String; let verifyJWT: Bool; let secrets: [String]; let files: [(path: String, file: String)]; let sha256: String }
  let kit: String
  let migrations: [Migration]
  let functions: [Function]
  let dir: URL

  /// The kit inside the app. A test copy may name another folder (PS_PROJECT_KIT).
  static var bundled: URL {
    let env = ProcessInfo.processInfo.environment
    if (env["PS_SELFTEST"] != nil || env["PS_PROJECT_TEST"] == "1"), let d = env["PS_PROJECT_KIT"] { return URL(fileURLWithPath: d, isDirectory: true) }
    return Bundle.main.resourceURL!.appendingPathComponent("project-kit", isDirectory: true)
  }

  /// Reads kit.json and checks every file against its SHA-256 (a changed file stops the setup).
  static func load(_ dir: URL = bundled) throws -> ProjectKit {
    let bad = SBError(status: 0, message: "PS's setup files are missing or damaged. Download PS again.")
    guard let d = try? Data(contentsOf: dir.appendingPathComponent("kit.json")),
          let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any], o["format"] as? Int == 1,
          let kit = o["kit"] as? String, let ms = o["migrations"] as? [[String: Any]], let fs = o["functions"] as? [[String: Any]] else { throw bad }
    func checked(_ file: String, _ sha: String) throws {
      guard !file.contains(".."), let data = try? Data(contentsOf: dir.appendingPathComponent(file)), hex(SHA256.hash(data: data)) == sha else { throw bad }
    }
    var migrations: [Migration] = []
    for m in ms {
      guard let v = m["version"] as? String, v.range(of: #"^\d{3}$"#, options: .regularExpression) != nil,
            let n = m["name"] as? String, n.range(of: #"^[a-z0-9_]+$"#, options: .regularExpression) != nil,
            let f = m["file"] as? String, let s = m["sha256"] as? String else { throw bad }
      try checked(f, s)
      migrations.append(Migration(version: v, name: n, file: f, sha256: s))
    }
    guard migrations.map(\.version) == migrations.map(\.version).sorted(), Set(migrations.map(\.version)).count == migrations.count else { throw bad }
    var functions: [Function] = []
    for f in fs {
      guard let slug = f["slug"] as? String, slug.range(of: #"^[a-z0-9-]{1,40}$"#, options: .regularExpression) != nil,
            let entry = f["entry"] as? String, let files = f["files"] as? [[String: Any]], let sha = f["sha256"] as? String else { throw bad }
      var list: [(String, String)] = []
      for x in files {
        guard let p = x["path"] as? String, let file = x["file"] as? String, let s = x["sha256"] as? String, !p.contains("..") else { throw bad }
        try checked(file, s)
        list.append((p, file))
      }
      functions.append(Function(slug: slug, entry: entry, verifyJWT: f["verify_jwt"] as? Bool ?? true, secrets: f["secrets"] as? [String] ?? [], files: list.map { (path: $0.0, file: $0.1) }, sha256: sha))
    }
    return ProjectKit(kit: kit, migrations: migrations, functions: functions, dir: dir)
  }
  func data(_ file: String) -> Data { (try? Data(contentsOf: dir.appendingPathComponent(file))) ?? Data() }
}

func hex<D: Sequence>(_ d: D) -> String where D.Element == UInt8 { d.map { String(format: "%02x", $0) }.joined() }

// MARK: - the engine

enum SetupStep: String, CaseIterable { case create, wait, database, functions, check, save }

final class ProjectEngine {
  /// Projects PS must never change (the developer's vault and his follow up engine), whatever token is used.
  /// Projects PS never sets up or changes: the default vault project and the developer's other project. The other one is
  /// kept as a SHA-256 only, so its id never ships in the public app (release/audit.py blocks it).
  static let untouchableHashes: Set<String> = ["785cf5ec58afae51d8adf1e645cf1074a0c4ca3819cc9fb40a779ec7f19a739a"]
  static func isUntouchable(_ ref: String) -> Bool {
    ref == ProjectStore.redRef || untouchableHashes.contains(SHA256.hash(data: Data(ref.utf8)).map { String(format: "%02x", $0) }.joined())
  }
  static let defaultName = "ps-vault"

  let api: SupabaseAPI
  let kit: ProjectKit
  /// step, "now" or "done", a fraction (nil: no number), a short detail line
  var report: (SetupStep, String, Double?, String?) -> Void = { _, _, _, _ in }
  var pause: (TimeInterval) -> Void = { Thread.sleep(forTimeInterval: $0) }
  var cancelled: () -> Bool = { false }
  var readyLimit: TimeInterval = 600, dbLimit: TimeInterval = 180, checkLimit: TimeInterval = 90
  var poll: TimeInterval = 4
  /// Checks the deployed sign in function answers (the real one asks the project; tests replace it).
  var checkFunction: (_ url: String, _ key: String) -> Bool
  var clock: () -> Date = Date.init

  init(api: SupabaseAPI, kit: ProjectKit, session: URLSession? = nil) {
    self.api = api; self.kit = kit
    let s = session ?? {
      let c = URLSessionConfiguration.ephemeral
      c.timeoutIntervalForRequest = 15; c.timeoutIntervalForResource = 20; c.waitsForConnectivity = false
      return URLSession(configuration: c)
    }()
    checkFunction = { url, key in ProjectEngine.vaultAuthAnswers(url: url, key: key, session: s) }
  }

  // MARK: helpers

  static func randomString(_ n: Int, _ alphabet: String = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789") -> String {
    let chars = Array(alphabet)
    var out = ""
    var bytes = [UInt8](repeating: 0, count: n * 2)
    while out.count < n {
      _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
      for b in bytes where out.count < n && Int(b) < 256 - (256 % chars.count) { out.append(chars[Int(b) % chars.count]) }
    }
    return out
  }
  /// A strong database password. PS never needs it again (the Management API does not), so it is not kept.
  static func databasePassword() -> String { randomString(40) }
  static func setupCode() -> String { randomString(32) }

  /// The Supabase region nearest to this Mac, from its time zone only (nothing is looked up online).
  static func region(forTimeZone id: String) -> String {
    let z = id.lowercased()
    let table: [(String, String)] = [
      ("europe/london", "eu-west-2"), ("europe/dublin", "eu-west-1"), ("europe/lisbon", "eu-west-1"), ("atlantic/", "eu-west-1"),
      ("europe/paris", "eu-west-3"), ("europe/brussels", "eu-west-3"), ("europe/madrid", "eu-west-3"),
      ("europe/stockholm", "eu-north-1"), ("europe/oslo", "eu-north-1"), ("europe/helsinki", "eu-north-1"), ("europe/copenhagen", "eu-north-1"),
      ("europe/riga", "eu-north-1"), ("europe/tallinn", "eu-north-1"), ("europe/vilnius", "eu-north-1"),
      ("europe/zurich", "eu-central-2"), ("europe/", "eu-central-1"), ("asia/yerevan", "eu-central-1"),
      ("asia/baku", "eu-central-1"), ("asia/istanbul", "eu-central-1"), ("africa/", "eu-central-1"),
      ("asia/dubai", "ap-south-1"), ("asia/kolkata", "ap-south-1"), ("asia/calcutta", "ap-south-1"), ("asia/karachi", "ap-south-1"),
      ("asia/dhaka", "ap-south-1"), ("asia/kathmandu", "ap-south-1"), ("asia/colombo", "ap-south-1"),
      ("asia/tokyo", "ap-northeast-1"), ("asia/seoul", "ap-northeast-2"), ("asia/hong_kong", "ap-east-1"), ("asia/taipei", "ap-east-1"),
      ("asia/shanghai", "ap-east-1"), ("asia/", "ap-southeast-1"), ("australia/", "ap-southeast-2"), ("pacific/auckland", "ap-southeast-2"),
      ("america/sao_paulo", "sa-east-1"), ("america/argentina", "sa-east-1"), ("america/santiago", "sa-east-1"), ("america/bogota", "us-east-1"),
      ("america/toronto", "ca-central-1"), ("america/montreal", "ca-central-1"), ("america/vancouver", "us-west-1"),
      ("america/los_angeles", "us-west-1"), ("america/phoenix", "us-west-1"), ("america/denver", "us-west-1"), ("america/chicago", "us-east-2"),
      ("america/", "us-east-1"), ("us/pacific", "us-west-1"), ("us/", "us-east-1"),
    ]
    return table.first { z.hasPrefix($0.0) }?.1 ?? "eu-central-1"
  }
  static let regions: [(code: String, label: String)] = [
    ("eu-central-1", "Frankfurt"), ("eu-central-2", "Zurich"), ("eu-west-1", "Ireland"), ("eu-west-2", "London"), ("eu-west-3", "Paris"),
    ("eu-north-1", "Stockholm"), ("us-east-1", "North Virginia"), ("us-east-2", "Ohio"), ("us-west-1", "North California"),
    ("us-west-2", "Oregon"), ("ca-central-1", "Canada"), ("sa-east-1", "Sao Paulo"), ("ap-south-1", "Mumbai"), ("ap-southeast-1", "Singapore"),
    ("ap-northeast-1", "Tokyo"), ("ap-northeast-2", "Seoul"), ("ap-east-1", "Hong Kong"), ("ap-southeast-2", "Sydney"),
  ]

  private func guardRef(_ ref: String) throws {
    guard ref.range(of: #"^[a-z0-9]{20}$"#, options: .regularExpression) != nil else { throw SBError(status: 0, message: "That is not a Supabase project PS can use.") }
    guard !ProjectEngine.isUntouchable(ref) else { throw SBError(status: 0, message: "That project is the PS default server. Pick or create a project of your own.") }
  }
  private func stopIfCancelled() throws { if cancelled() { throw SBError(status: 0, message: "Stopped. Nothing else was changed.") } }

  // MARK: create

  /// A new project in `org`. If the answer is lost, the project that appeared meanwhile is used (never two).
  func create(org: String, region: String, name: String = ProjectEngine.defaultName) throws -> SBProject {
    report(.create, "now", nil, "Creating \(name)")
    let before = Set((try? api.projects())?.map(\.ref) ?? [])
    do {
      let p = try api.create(name: name, org: org, region: region)
      try guardRef(p.ref)
      report(.create, "done", 1, "\(name) created")
      return p
    } catch let e as SBError {
      // Lost or failed: did Supabase make it anyway?
      if let made = (try? api.projects())?.first(where: { !before.contains($0.ref) && $0.name == name && ($0.org.isEmpty || $0.org == org) }) {
        try guardRef(made.ref)
        report(.create, "done", 1, "\(name) created")
        return made
      }
      if e.status == 400 || e.status == 402 || e.status == 403, e.message.lowercased().contains("limit") || e.message.lowercased().contains("free") {
        throw SBError(status: e.status, message: "Your Supabase plan has no room for another project. Pause or delete one you do not use on supabase.com, or choose Use an existing project.")
      }
      throw e
    }
  }

  // MARK: finish (resumable)

  /// Wait, database, functions, check: everything after the project exists. Safe to run again.
  func finish(ref: String, name: String, previous: PSProject? = nil) throws -> PSProject {
    try guardRef(ref)
    try waitReady(ref: ref)
    try stopIfCancelled()
    report(.database, "now", 0, "Checking the project")
    let schema = try checkUsable(ref: ref)
    if schema == "ps" { psLog("PS project: the project has its own tables, PS goes in its own schema (ps)") }
    let n = try migrate(ref: ref, schema: schema)
    if schema == "ps" { try exposeSchema(ref: ref, schema: schema) }
    report(.database, "done", 1, n == 0 ? "Already up to date" : "\(n) step\(n == 1 ? "" : "s") applied")
    try stopIfCancelled()
    let same = previous?.ref == ref && previous?.dbSchema == schema
    let deployed = try deploy(ref: ref, have: same ? previous?.functions ?? [:] : [:], schema: schema)
    try stopIfCancelled()
    guard let key = try api.publicKey(ref: ref) else { throw SBError(status: 0, message: "Supabase did not give PS the project's public key. Try again in a minute.") }
    let url = "https://\(ref).supabase.co"
    try check(url: url, key: key)
    report(.save, "now", nil, nil)
    let code = try setupCode(ref: ref, schema: schema)
    let p = PSProject(url: url, key: key, ref: ref, name: name, setupCode: code, kit: kit.kit, functions: deployed,
                      linkedAt: ISO8601DateFormatter().string(from: clock()), schema: schema == "ps" ? "ps" : nil)
    report(.save, "done", 1, code == nil ? "Sign in with your account" : "Ready for your account")
    return p
  }

  /// Polls until the project is up and its database answers.
  func waitReady(ref: String) throws {
    let start = clock()
    report(.wait, "now", 0, "Starting your project. This usually takes one to two minutes.")
    while true {
      try stopIfCancelled()
      let p = try api.project(ref: ref)
      let s = p.status.uppercased()
      if s == "ACTIVE_HEALTHY" { break }
      if ["INIT_FAILED", "REMOVED", "GOING_DOWN", "RESTORE_FAILED", "PAUSE_FAILED"].contains(s) {
        throw SBError(status: 0, message: "Supabase could not start this project (\(p.status.lowercased())). Create a new one, or check it on supabase.com.")
      }
      if ["INACTIVE", "PAUSED"].contains(s) { throw SBError(status: 0, message: "This project is paused. Restore it on supabase.com, then try again.") }
      let t = clock().timeIntervalSince(start)
      if t > readyLimit { throw SBError(status: 0, message: "Your project is taking longer than usual to start. Try again in a minute: PS carries on where it stopped.") }
      report(.wait, "now", min(0.9, t / 120), "Starting your project. This usually takes one to two minutes.")
      pause(poll)
    }
    // The database can lag a little behind the project's status.
    while true {
      try stopIfCancelled()
      do { try api.sql(ref: ref, "select 1 as ok", timeout: 20); break }
      catch let e as SBError {
        if clock().timeIntervalSince(start) > readyLimit + dbLimit || (!e.retryable && e.status != 400) { throw e }
        report(.wait, "now", 0.95, "Waiting for the database")
        pause(poll)
      }
    }
    report(.wait, "done", 1, "Running")
  }

  /// Where PS goes in this project. Never the developer's, never on top of someone's own tables:
  /// - "public": an empty project, or one PS set up in public before (as since 5 Nov 2026);
  /// - "ps": a project that already holds the person's own app (7 Nov 2026, the developer's friend has one free project
  ///   and wanted PS in it "without fucking anything up"). PS then lives in its own schema ps, leaves public,
  ///   auth.users and auth.sessions alone, and only adds ps to the schemas the Data API serves.
  func checkUsable(ref: String) throws -> String {
    let rows = try api.sql(ref: ref, """
      select (select count(*) from information_schema.tables where table_schema = 'public')::int as tables,
             (to_regclass('public.user_keys') is not null) as ps,
             (to_regclass('ps.user_keys') is not null) as own,
             (select count(*) from information_schema.tables where table_schema = 'ps')::int as pstables,
             (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'ps')::int as psfuncs,
             (to_regclass('ps_meta.migrations') is not null) as tracked
      """)
    let r = rows.first ?? [:]
    func int(_ k: String) -> Int { (r[k] as? Int) ?? Int("\(r[k] ?? "0")") ?? 0 }
    func bool(_ k: String) -> Bool { (r[k] as? Bool) ?? ("\(r[k] ?? "")" == "true") }
    let tables = int("tables"), ps = bool("ps"), own = bool("own"), tracked = bool("tracked")
    if own {
      if !tracked { throw SBError(status: 0, message: "This project already has a part called ps that PS did not set up. PS stops here so nothing of yours is touched.") }
      return "ps"
    }
    if ps {
      if !tracked { throw SBError(status: 0, message: "This project already has PS tables that PS did not set up here. Pick another project or create a new one.") }
      return "public"
    }
    if tables == 0 { return "public" }
    // The person's own app is in public: PS gets its own schema, which must not hold anything of theirs.
    if int("pstables") > 0 || int("psfuncs") > 0 { throw SBError(status: 0, message: "This project already uses the name ps for something of its own, so PS cannot set itself up here without touching it. Nothing was changed.") }
    if let fns = try? api.functionSlugs(ref: ref), fns.contains(where: { kit.functions.map(\.slug).contains($0) }) {
      throw SBError(status: 0, message: "This project already has a function called vault-auth that PS did not make. PS stops here so nothing of yours is touched.")
    }
    return "ps"
  }

  /// A kit migration made for public, rewritten for the schema ps: every public. name becomes ps., and the two
  /// triggers on Supabase's own auth.users and auth.sessions are left out (in a shared project they would gate
  /// and log the person's own app's sign ups and sign ins). Anything the rewrite cannot vouch for stops the setup.
  static func forSchema(_ sql: String, _ schema: String) throws -> String {
    guard schema == "ps" else { return sql }
    var t = sql
    func re(_ p: String, _ w: String) { t = t.replacingOccurrences(of: p, with: w, options: [.regularExpression, .caseInsensitive]) }
    re(#"create\s+trigger\s+\w+\s+(before|after)\s+\w+(\s+or\s+\w+)*\s+on\s+auth\.\w+\s+for\s+each\s+row\s+execute\s+(function|procedure)\s+[\w.]+\(\)\s*;"#,
       "-- (left out by PS: a trigger on Supabase's own auth tables is never made in a project shared with another app)\n")
    re(#"\bpublic\."#, "ps.")
    re(#"\b(in|on)\s+schema\s+public\b"#, "$1 schema ps")
    re(#"schemaname\s*=\s*'public'"#, "schemaname = 'ps'")
    // V1.44: PS's own rules on Supabase's realtime.messages carry a "ps: " name, so PS can never drop or collide with a
    // rule of the person's own app that happens to have the same name.
    re(#"((?:create|drop)\s+policy\s+(?:if\s+exists\s+)?)"([^"]+)"(\s+on\s+realtime\.)"#, "$1\"ps: $2\"$3")
    // A realtime publication made FOR ALL TABLES already carries PS's tables (and refuses an add): leave it alone.
    re(#"if\s+not\s+exists\s*\(\s*select\s+1\s+from\s+pg_publication_tables\b"#,
       "if exists (select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables) and not exists (select 1 from pg_publication_tables")
    let left = { (p: String) in t.range(of: p, options: [.regularExpression, .caseInsensitive]) != nil }
    if left(#"\bpublic\."#) || left(#"schema\s+public\b"#) || left(#"'public'"#) || left(#"create\s+trigger[^;]*\bon\s+auth\."#) || left(#"alter\s+table\s+auth\."#) {
      throw SBError(status: 0, message: "PS's setup files do not fit a shared project. Nothing was changed. Update PS and try again.")
    }
    return t
  }

  /// A function's source for the schema: vault-auth's one DB_SCHEMA line says where the tables are.
  static func functionSource(_ data: Data, _ schema: String) throws -> Data {
    guard schema == "ps" else { return data }
    let line = "const DB_SCHEMA: string = \"public\";"
    guard let src = String(data: data, encoding: .utf8) else { return data }
    if !src.contains("DB_SCHEMA") { return data }   // a file that does not read the database
    guard src.components(separatedBy: line).count == 2 else { throw SBError(status: 0, message: "PS's setup files do not fit a shared project. Nothing was changed. Update PS and try again.") }
    return Data(src.replacingOccurrences(of: line, with: "const DB_SCHEMA: string = \"ps\";").utf8)
  }

  /// The Data API serves ps too (added to the list, nothing removed), so the page and vault-auth can reach it.
  func exposeSchema(ref: String, schema: String) throws {
    let cur = try api.postgrestSchemas(ref: ref)
    let parts = cur.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    if parts.contains(schema) { return }
    try api.setPostgrestSchemas(ref: ref, (parts.isEmpty ? ["public", "graphql_public"] : parts) + [schema])
    psLog("PS project: the Data API now also serves \(schema)")
  }

  /// The same baseline as every Supabase project, then the record of what PS applied.
  static func baseline(_ schema: String) -> String { (schema == "ps" ? "create schema if not exists ps;\n" : "") + """
    grant usage on schema \(schema) to anon, authenticated, service_role;
    alter default privileges in schema \(schema) grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema \(schema) grant all on functions to anon, authenticated, service_role;
    alter default privileges in schema \(schema) grant all on sequences to anon, authenticated, service_role;
    create schema if not exists ps_meta;
    revoke all on schema ps_meta from public, anon, authenticated;
    create table if not exists ps_meta.migrations (version text primary key, name text not null, applied_at timestamptz not null default now());
    revoke all on ps_meta.migrations from public, anon, authenticated;
    select version from ps_meta.migrations order by version;
    """ }

  /// Applies every kit migration the project does not have yet, in order. Returns how many ran.
  @discardableResult
  func migrate(ref: String, schema: String = "public") throws -> Int {
    try guardRef(ref)
    let have = Set(try api.sql(ref: ref, ProjectEngine.baseline(schema)).compactMap { $0["version"] as? String })
    let todo = kit.migrations.filter { !have.contains($0.version) }
    for (i, m) in todo.enumerated() {
      try stopIfCancelled()
      report(.database, "now", Double(i) / Double(max(1, todo.count)), "Setting up the database (\(i + 1) of \(todo.count))")
      guard let raw = String(data: kit.data(m.file), encoding: .utf8) else { throw SBError(status: 0, message: "PS's setup files are damaged. Download PS again.") }
      let sql = try ProjectEngine.forSchema(raw, schema)
      // One request: if any statement fails, Postgres undoes the whole migration and nothing is recorded.
      // Never sent twice on its own (a lost answer may still be running): Retry reads the record again first.
      let record = "insert into ps_meta.migrations (version, name) values ('\(m.version)', '\(m.name)') on conflict (version) do nothing;"
      do { try api.sql(ref: ref, sql + "\n;\n" + record, timeout: 120, retry: false) }
      catch let e as SBError {
        psLog("PS project: migration \(m.version) failed (\(e.status))")
        throw SBError(status: e.status, message: e.retryable ? e.message : "Setting up the database stopped at step \(m.version): \(e.message)")
      }
    }
    return todo.count
  }

  /// Deploys every kit function whose sources differ from what was deployed. Returns name -> hash.
  func deploy(ref: String, have: [String: String], schema: String = "public") throws -> [String: String] {
    try guardRef(ref)
    var out = have
    let todo = kit.functions.filter { have[$0.slug] != $0.sha256 }
    report(.functions, "now", 0, todo.isEmpty ? "Already installed" : "Installing the sign in service")
    for (i, f) in todo.enumerated() {
      try stopIfCancelled()
      try api.deployFunction(ref: ref, slug: f.slug, entry: f.entry, files: try f.files.map { ($0.path, try ProjectEngine.functionSource(kit.data($0.file), schema)) }, verifyJWT: f.verifyJWT)
      if !f.secrets.isEmpty { throw SBError(status: 0, message: "This PS needs settings it cannot make by itself. Update PS and try again.") }
      out[f.slug] = f.sha256
      report(.functions, "now", Double(i + 1) / Double(todo.count), nil)
    }
    report(.functions, "done", 1, "Installed")
    return out
  }

  /// The sign in service answers (a new function can take a few seconds to come up).
  func check(url: String, key: String) throws {
    report(.check, "now", nil, "Checking it all works")
    let start = clock()
    while !checkFunction(url, key) {
      try stopIfCancelled()
      if clock().timeIntervalSince(start) > checkLimit { throw SBError(status: 0, message: "The sign in service is not answering yet. Try again in a minute: PS carries on where it stopped.") }
      pause(3)
    }
    report(.check, "done", 1, "Working")
  }
  /// vault-auth answers a request with no action with 400 and a JSON error: it is deployed and running.
  static func vaultAuthAnswers(url: String, key: String, session: URLSession) -> Bool {
    guard let u = URL(string: url + "/functions/v1/vault-auth") else { return false }
    var req = URLRequest(url: u, timeoutInterval: 15)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue(key, forHTTPHeaderField: "apikey")
    req.httpBody = Data("{}".utf8)
    let done = DispatchSemaphore(value: 0)
    var ok = false
    session.dataTask(with: req) { d, r, _ in
      let status = (r as? HTTPURLResponse)?.statusCode ?? 0
      let j = d.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
      ok = status == 400 && j?["error"] is String
      done.signal()
    }.resume()
    _ = done.wait(timeout: .now() + 20)
    return ok
  }

  /// While the project has no account: a fresh one time code for the first one (its hash only goes to the project).
  func setupCode(ref: String, schema: String = "public") throws -> String? {
    try guardRef(ref)
    let sc = schema == "ps" ? "ps" : "public"
    let rows = try api.sql(ref: ref, "select exists (select 1 from \(sc).app_owner) as owned")
    let owned = (rows.first?["owned"] as? Bool) ?? ("\(rows.first?["owned"] ?? "")" == "true")
    if owned { return nil }
    let code = ProjectEngine.setupCode()
    let h = hex(SHA256.hash(data: Data(code.utf8)))
    try api.sql(ref: ref, "delete from \(sc).setup_codes where expires_at < now(); insert into \(sc).setup_codes (code_hash, expires_at) values ('\(h)', now() + interval '7 days');")
    return code
  }

  // MARK: update

  /// A newer PS brought new migrations or functions: apply them to the linked project.
  func update(_ p: PSProject) throws -> PSProject {
    try guardRef(p.ref)
    let n = try migrate(ref: p.ref, schema: p.dbSchema)
    if p.dbSchema == "ps" { try exposeSchema(ref: p.ref, schema: "ps") }
    let fns = try deploy(ref: p.ref, have: p.functions ?? [:], schema: p.dbSchema)
    var q = p
    q.functions = fns
    q.kit = kit.kit
    psLog("PS project: updated (\(n) migration\(n == 1 ? "" : "s"), kit \(kit.kit))")
    return q
  }
}

extension SupabaseAPI {
  /// createProject with a fresh database password (never kept).
  func create(name: String, org: String, region: String) throws -> SBProject {
    try createProject(name: name, org: org, region: region, dbPass: ProjectEngine.databasePassword())
  }
}
