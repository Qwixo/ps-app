// Offline test for "Connect your own Supabase" (Sources/Project.swift, SupabaseAPI.swift, ProjectEngine.swift).
// Every Supabase answer comes from a mock (a URLProtocol inside this process): no socket, no account, no network.
//   bash tests/project-setup-test.sh
import Foundation
import CryptoKit

setvbuf(stdout, nil, _IONBF, 0)
var logged: [String] = []
func psLog(_ s: String) { logged.append(s) }
var fails = 0, passes = 0
func check(_ name: String, _ ok: Bool, _ why: @autoclosure () -> String = "") {
  if ok { passes += 1; print("ok - \(name)") } else { fails += 1; print("FAIL - \(name) \(why())") }
}

// ---------- the mock Supabase ----------
struct Seen { let method: String; let path: String; let query: String; let headers: [String: String]; let body: Data }
final class Mock: URLProtocol {
  static var seen: [Seen] = []
  static var answer: (Seen) -> (Int, Any?, URLError.Code?) = { _ in (404, ["message": "no route"], nil) }
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    var body = request.httpBody ?? Data()
    if body.isEmpty, let s = request.httpBodyStream {
      s.open(); var buf = [UInt8](repeating: 0, count: 65536)
      while s.hasBytesAvailable { let n = s.read(&buf, maxLength: buf.count); if n <= 0 { break }; body.append(buf, count: n) }
      s.close()
    }
    let u = request.url!
    let seen = Seen(method: request.httpMethod ?? "GET", path: u.path, query: u.query ?? "", headers: request.allHTTPHeaderFields ?? [:], body: body)
    Mock.seen.append(seen)
    let (status, json, err) = Mock.answer(seen)
    if let err { client?.urlProtocol(self, didFailWithError: URLError(err)); return }
    let data = json.map { (try? JSONSerialization.data(withJSONObject: $0, options: [.fragmentsAllowed])) ?? Data() } ?? Data()
    client?.urlProtocol(self, didReceive: HTTPURLResponse(url: u, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: data)
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}
let cfg = URLSessionConfiguration.ephemeral
cfg.protocolClasses = [Mock.self]
let session = URLSession(configuration: cfg)
let TOKEN = "sbp_" + "0123456789abcdef0123456789abcdef01234567"
let REF = "abcdefghijklmnopqrst"
let JWT = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJlLXNpZ25hdHVyZQ"
let PUB = "sb_publishable_AbCdEf0123456789xyz"
func api() -> SupabaseAPI { let a = SupabaseAPI(token: TOKEN, session: session); a.pause = { _ in }; return a }
func sqlOf(_ s: Seen) -> String { ((try? JSONSerialization.jsonObject(with: s.body)) as? [String: Any])?["query"] as? String ?? "" }

let kitDir = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let kit = try! ProjectKit.load(kitDir)

/// A healthy Supabase: an empty account and a project that comes up after two polls.
func healthy(owned: Bool = false, applied: [String] = [], tables: Int = 0, ps: Bool = false, tracked: Bool = false, status: [String] = ["COMING_UP", "COMING_UP", "ACTIVE_HEALTHY"]) {
  var polls = 0
  var made = false
  Mock.answer = { s in
    switch (s.method, s.path) {
    case ("GET", "/v1/organizations"): return (200, [["id": "acme", "slug": "acme", "name": "Acme"]], nil)
    case ("GET", "/v1/projects"): return (200, made ? [["ref": REF, "name": "ps-vault", "organization_slug": "acme", "region": "eu-central-1", "status": "COMING_UP"]] : [], nil)
    case ("POST", "/v1/projects"): made = true; return (201, ["ref": REF, "id": REF, "name": "ps-vault", "organization_slug": "acme", "region": "eu-central-1", "status": "COMING_UP"], nil)
    case ("GET", "/v1/projects/\(REF)"):
      let st = status[min(polls, status.count - 1)]; polls += 1
      return (200, ["ref": REF, "name": "ps-vault", "status": st, "region": "eu-central-1"], nil)
    case ("GET", "/v1/projects/\(REF)/api-keys"): return (200, [["name": "anon", "api_key": JWT, "type": "legacy"], ["name": "service_role", "api_key": "eyJsecret.secret.secretsecret", "type": "legacy"]], nil)
    case ("POST", "/v1/projects/\(REF)/functions/deploy"): return (201, ["slug": "vault-auth", "status": "ACTIVE"], nil)
    case ("GET", "/v1/projects/\(REF)/functions"): return (200, [["slug": "their-own-function"]], nil)
    case ("GET", "/v1/projects/\(REF)/postgrest"): return (200, ["db_schema": "public, graphql_public", "max_rows": 1000], nil)
    case ("PATCH", "/v1/projects/\(REF)/postgrest"): return (200, ["db_schema": "public, graphql_public, ps"], nil)
    case ("POST", "/v1/projects/\(REF)/database/query"):
      let q = sqlOf(s)
      if q.contains("information_schema.tables") { return (201, [["tables": tables, "ps": ps, "tracked": tracked, "own": false, "pstables": 0, "psfuncs": 0]], nil) }
      if q.contains("select version from ps_meta.migrations") { return (201, applied.map { ["version": $0] }, nil) }
      if q.contains("exists (select 1 from public.app_owner)") || q.contains("exists (select 1 from ps.app_owner)") { return (201, [["owned": owned]], nil) }
      return (201, [], nil)
    default: return (404, ["message": "no route \(s.method) \(s.path)"], nil)
    }
  }
}
func engine() -> ProjectEngine {
  let e = ProjectEngine(api: api(), kit: kit, session: session)
  e.pause = { _ in }
  e.checkFunction = { _, _ in true }
  return e
}

let group = DispatchGroup()
group.enter()
DispatchQueue.global().async {
  defer { group.leave() }

  // ---------- pure parts ----------
  check("token format", SupabaseAPI.validToken(TOKEN) && !SupabaseAPI.validToken("sbp_short") && !SupabaseAPI.validToken("eyJabc") && !SupabaseAPI.validToken(""))
  check("project address", ProjectStore.ref(of: "https://\(REF).supabase.co/") == REF && ProjectStore.ref(of: "https://\(REF).supabase.co.evil.com") == nil
        && ProjectStore.ref(of: "http://\(REF).supabase.co") == nil && ProjectStore.ref(of: "https://ABC.supabase.co") == nil)
  check("public keys only", ProjectStore.validKey(JWT) && ProjectStore.validKey(PUB) && !ProjectStore.validKey("sb_secret_abcdefghijklmnop") && !ProjectStore.validKey("service_role"))
  check("The developer's project gets no page script (the build's own)", ProjectStore.pageScript(nil) == nil
        && ProjectStore.pageScript(PSProject(url: ProjectStore.redURL, key: JWT, ref: ProjectStore.redRef)) == nil)
  let ps = ProjectStore.pageScript(PSProject(url: "https://\(REF).supabase.co", key: JWT, ref: REF, setupCode: "Abcdefghijkmnopq2345")) ?? ""
  check("the page script hands in url, key and setup code, frozen", ps.contains("\"url\":\"https:\\/\\/\(REF).supabase.co\"") && ps.contains("\"key\":\"\(JWT)\"")
        && ps.contains("\"setupCode\":\"Abcdefghijkmnopq2345\"") && ps.contains("Object.freeze") && ps.contains("writable:false"), ps)
  let csp = pageCSP("'self' " + ProjectStore.connectSources("https://\(REF).supabase.co"))
  check("the page may reach only its own project", csp.contains("connect-src 'self' https://\(REF).supabase.co wss://\(REF).supabase.co;") && !csp.contains("*") && !csp.contains(ProjectStore.redRef), csp)
  let redCsp = pageCSP("'self' " + ProjectStore.connectSources(ProjectStore.redURL))
  check("the default page policy is the developer's project, as before", redCsp.contains("connect-src 'self' https://mxusokxekkecebwqgeru.supabase.co wss://mxusokxekkecebwqgeru.supabase.co;"))
  check("script-src stays 'self'", csp.contains("script-src 'self';") && csp.contains("object-src 'none'"))

  // the saved file
  let f = URL(fileURLWithPath: CommandLine.arguments[2])
  check("no file: the developer's default project", ProjectStore.current == nil && ProjectStore.isRed && !ProjectStore.custom && ProjectStore.url == ProjectStore.redURL)
  try? ProjectStore.save(PSProject(url: "https://\(REF).supabase.co", key: JWT, ref: REF, name: "ps-vault", setupCode: "Abcdefghijkmnopq2345", kit: "k"))
  let attrs = try? FileManager.default.attributesOfItem(atPath: f.path)
  check("saved to its own file, readable by this user only", (attrs?[.posixPermissions] as? NSNumber)?.intValue == 0o600)
  ProjectStore.reload()
  check("read back after a restart", ProjectStore.current?.ref == REF && ProjectStore.custom && !ProjectStore.isRed && ProjectStore.url == "https://\(REF).supabase.co")
  try? Data(#"{"url":"https://evil.com","key":"x","ref":"abcdefghijklmnopqrst"}"#.utf8).write(to: f)
  ProjectStore.reload()
  check("a damaged or forged file falls back to the default", ProjectStore.current == nil && ProjectStore.isRed)
  check("a forged project is never saved", (try? ProjectStore.save(PSProject(url: "https://evil.com", key: JWT, ref: REF))) == nil)
  ProjectStore.clear()

  // regions
  check("nearest region from the time zone", ProjectEngine.region(forTimeZone: "Asia/Dubai") == "eu-central-1" && ProjectEngine.region(forTimeZone: "Europe/London") == "eu-west-2"
        && ProjectEngine.region(forTimeZone: "America/Los_Angeles") == "us-west-1" && ProjectEngine.region(forTimeZone: "America/New_York") == "us-east-1"
        && ProjectEngine.region(forTimeZone: "Australia/Sydney") == "ap-southeast-2" && ProjectEngine.region(forTimeZone: "Nowhere/Else") == "eu-central-1"
        && ProjectEngine.regions.contains { $0.code == ProjectEngine.region(forTimeZone: "Asia/Tokyo") })
  let pw = ProjectEngine.databasePassword(), code = ProjectEngine.setupCode()
  check("strong random secrets", pw.count == 40 && code.count == 32 && ProjectStore.validCode(code) && pw != ProjectEngine.databasePassword())

  // the kit
  check("the kit lists the core migrations in order and vault-auth", kit.migrations.first?.version == "001" && kit.migrations.contains { $0.version == "025" }
        && !kit.migrations.contains { $0.name.contains("gmail") || $0.name.contains("instantly") || $0.name.contains("telegram") }
        && kit.functions.map(\.slug) == ["vault-auth"] && kit.functions[0].verifyJWT == false)
  let bad = FileManager.default.temporaryDirectory.appendingPathComponent("ps-kit-bad-\(getpid())")
  try? FileManager.default.removeItem(at: bad)
  try? FileManager.default.copyItem(at: kitDir, to: bad)
  try? Data("drop table public.records;".utf8).write(to: bad.appendingPathComponent(kit.migrations[1].file))
  check("a changed kit file stops the setup", (try? ProjectKit.load(bad)) == nil)
  try? FileManager.default.removeItem(at: bad)

  // ---------- the whole setup on a healthy Supabase ----------
  Mock.seen = []; healthy()
  let e = engine()
  var steps: [String] = []
  e.report = { s, st, _, _ in steps.append("\(s.rawValue):\(st)") }
  do {
    let made = try e.create(org: "acme", region: "eu-central-1")
    let p = try e.finish(ref: made.ref, name: made.name)
    check("creates one project and finishes it", made.ref == REF && Mock.seen.filter { $0.method == "POST" && $0.path == "/v1/projects" }.count == 1)
    let create = Mock.seen.first { $0.method == "POST" && $0.path == "/v1/projects" }!
    let cb = (try? JSONSerialization.jsonObject(with: create.body)) as? [String: Any] ?? [:]
    check("project name ps-vault, nearest region, strong database password", cb["name"] as? String == "ps-vault" && cb["organization_slug"] as? String == "acme"
          && ((cb["region_selection"] as? [String: Any])?["code"] as? String) == "eu-central-1" && (cb["db_pass"] as? String)?.count == 40)
    check("waits until the project is up", Mock.seen.filter { $0.path == "/v1/projects/\(REF)" }.count == 3)
    let queries = Mock.seen.filter { $0.path.hasSuffix("/database/query") }.map(sqlOf)
    let migs = queries.filter { $0.contains("insert into ps_meta.migrations") }
    check("applies every core migration once, in order, each recorded in the same request", migs.count == kit.migrations.count
          && zip(migs, kit.migrations).allSatisfy { $0.0.contains("values ('\($0.1.version)', '\($0.1.name)')") })
    check("the same baseline privileges as every Supabase project, and its own record schema", queries.contains { $0.contains("alter default privileges in schema public grant all on tables to anon, authenticated, service_role") && $0.contains("create schema if not exists ps_meta") })
    let deploy = Mock.seen.first { $0.path.hasSuffix("/functions/deploy") }
    let dbody = String(data: deploy?.body ?? Data(), encoding: .utf8) ?? ""
    check("deploys vault-auth from the bundled source, verify_jwt off", deploy?.query == "slug=vault-auth" && dbody.contains("\"verify_jwt\":false") && dbody.contains("\"entrypoint_path\":\"index.ts\"")
          && dbody.contains("filename=\"index.ts\"") && dbody.contains("vault-auth") && (deploy?.headers["Content-Type"] ?? "").hasPrefix("multipart/form-data; boundary="))
    let insert = queries.first { $0.contains("insert into public.setup_codes") } ?? ""
    let h = SHA256.hash(data: Data((p.setupCode ?? "").utf8)).map { String(format: "%02x", $0) }.joined()
    check("leaves a one time setup code: only its hash reaches the project, 7 days", p.setupCode != nil && insert.contains("'\(h)'") && !insert.contains(p.setupCode ?? "x") && insert.contains("interval '7 days'"))
    check("the result is the project's public url and anon key, never the service key", p.url == "https://\(REF).supabase.co" && p.key == JWT && ProjectStore.valid(p) && p.kit == kit.kit && p.functions?["vault-auth"] == kit.functions[0].sha256)
    let authOK = Mock.seen.allSatisfy { $0.headers["Authorization"] == "Bearer \(TOKEN)" }
    let inBody = Mock.seen.contains { String(data: $0.body, encoding: .utf8)?.contains(TOKEN) == true || $0.query.contains(TOKEN) }
    var inOtherHeader = false
    for seen in Mock.seen { for (k, v) in seen.headers where k != "Authorization" && v.contains(TOKEN) { inOtherHeader = true } }
    check("every request carries the token only in the Authorization header", authOK && !inBody && !inOtherHeader)
    check("the steps run in order", steps.filter { $0.hasSuffix(":done") } == ["create:done", "wait:done", "database:done", "functions:done", "check:done", "save:done"], "\(steps)")
    check("nothing logged carries the token", !logged.contains { $0.contains("sbp_") })
  } catch { check("healthy setup", false, "\(error)") }

  // ---------- busy and broken answers ----------
  Mock.seen = []
  var n = 0
  Mock.answer = { s in n += 1; return n < 3 ? (503, ["message": "busy"], nil) : (200, [["slug": "acme", "name": "Acme"]], nil) }
  check("tries a busy answer again (503, 503, then 200)", ((try? api().orgs())?.count ?? 0) == 1 && Mock.seen.count == 3)
  Mock.seen = []
  Mock.answer = { _ in (401, ["message": "Unauthorized \(TOKEN)"], nil) }
  do { _ = try api().orgs(); check("a refused token stops", false) } catch let e as SBError {
    check("a refused token: one try, plain words, never the token", Mock.seen.count == 1 && e.message.contains("did not accept this access token") && !e.message.contains("sbp_"))
  } catch { check("a refused token", false) }
  // A scoped token limited to one project sees no organisation (7 Nov 2026): it is told apart, and a 403 says full access.
  check("a scoped token (sbp_fc) is recognised", SupabaseAPI(token: "sbp_fc" + String(repeating: "a", count: 40), session: session).scopedToken && !api().scopedToken || TOKEN.hasPrefix("sbp_fc"))
  Mock.seen = []
  Mock.answer = { _ in (200, [] as [Any], nil) }
  check("a token that sees no organisation gets an empty list (no crash)", ((try? api().orgs()) ?? [SBOrg(slug: "x", name: "x")]).isEmpty)
  check("a refused permission (403) asks for full access", SupabaseAPI.words(403, Data()).contains("full access") && SupabaseAPI.words(403, try! JSONSerialization.data(withJSONObject: ["message": "Forbidden"])).contains("full access"))
  check("Supabase's own words never echo the token", !SupabaseAPI.words(400, try! JSONSerialization.data(withJSONObject: ["message": "bad \(TOKEN)"])).contains("sbp_"))
  Mock.seen = []
  Mock.answer = { _ in (0, nil, .notConnectedToInternet) }
  do { _ = try api().projects(); check("offline", false) } catch let e as SBError {
    check("offline: three tries, then says so plainly", Mock.seen.count == 3 && e.status == 0 && e.message.contains("offline"))
  } catch { check("offline", false) }

  // a lost answer to "create": the project that appeared is used, never a second one
  Mock.seen = []
  var created = false
  Mock.answer = { s in
    if s.method == "POST" && s.path == "/v1/projects" { created = true; return (0, nil, .timedOut) }
    if s.method == "GET" && s.path == "/v1/projects" { return (200, created ? [["ref": REF, "name": "ps-vault", "organization_slug": "acme", "status": "COMING_UP"]] : [], nil) }
    return (404, nil, nil)
  }
  let lost = try? engine().create(org: "acme", region: "eu-central-1")
  check("a lost create answer adopts the project that appeared (no duplicate)", lost?.ref == REF && Mock.seen.filter { $0.method == "POST" }.count == 1)

  // the free plan has no room
  Mock.seen = []
  Mock.answer = { s in
    if s.method == "POST" { return (400, ["message": "The following organization members have reached their maximum limits for the number of active free projects"], nil) }
    return (200, [], nil)
  }
  do { _ = try engine().create(org: "acme", region: "eu-central-1"); check("plan limit", false) } catch let e as SBError {
    check("a full free plan says what to do", e.message.contains("no room for another project") && e.message.contains("Use an existing project"), e.message)
  } catch { check("plan limit", false) }

  // ---------- a project that already holds someone's own app (7 Nov 2026) ----------
  // Every kit migration rewritten for the schema ps: nothing in public, no trigger on auth.users or auth.sessions.
  var rewriteOK = true
  for m in kit.migrations {
    let raw = String(data: kit.data(m.file), encoding: .utf8) ?? ""
    guard let t = try? ProjectEngine.forSchema(raw, "ps") else { rewriteOK = false; print("  cannot rewrite \(m.file)"); continue }
    let bad = t.range(of: #"\bpublic\.|schema\s+public\b|create\s+trigger[^;]*\bon\s+auth\."#, options: [.regularExpression, .caseInsensitive])
    if bad != nil { rewriteOK = false; print("  \(m.file) still touches public or auth") }
    if raw.contains("public.") && !t.contains("ps.") { rewriteOK = false }
  }
  check("every migration rewrites for the schema ps, with nothing left in public or on auth tables", rewriteOK)
  let gate = (try? ProjectEngine.forSchema(String(data: kit.data(kit.migrations[0].file), encoding: .utf8) ?? "", "ps")) ?? ""
  check("the sign up gate on auth.users is left out (it would block the other app's sign ups)", !gate.contains("vault_signup_gate before insert on auth.users") && gate.contains("left out by PS"))
  check("revoking anon covers only ps, never the other app's tables", gate.contains("revoke all on all tables in schema ps from anon") && !gate.contains("in schema public"))
  check("the role named public is not mistaken for the schema", gate.contains("from public, anon"))
  let presence = (try? ProjectEngine.forSchema("drop policy if exists \"owner reads own second topic\" on realtime.messages;\ncreate policy \"owner tracks ps presence\" on realtime.messages for insert to authenticated with check ((select public.is_owner()));", "ps")) ?? ""
  check("PS's realtime rules in a shared project are named ps: and never touch a rule of theirs", presence.contains("drop policy if exists \"ps: owner reads own second topic\"") && presence.contains("create policy \"ps: owner tracks ps presence\"") && !presence.contains("\"owner "))
  let rt = kit.migrations.first { $0.file.contains("realtime") }.flatMap { try? ProjectEngine.forSchema(String(data: kit.data($0.file), encoding: .utf8) ?? "", "ps") } ?? ""
  check("the realtime publication is only added to when it is not FOR ALL TABLES", rt.contains("not puballtables") && rt.contains("add table ps.records"))
  check("public stays exactly as it was for an empty project", (try? ProjectEngine.forSchema("select 1 from public.x;", "public")) == "select 1 from public.x;")
  check("anything the rewrite cannot vouch for stops it", (try? ProjectEngine.forSchema("alter table auth.users add column x int;", "ps")) == nil)
  let fsrc = Data("const DB_SCHEMA: string = \"public\";\nconst x = 1;".utf8)
  check("vault-auth is told the schema", String(data: (try? ProjectEngine.functionSource(fsrc, "ps")) ?? Data(), encoding: .utf8)?.contains("const DB_SCHEMA: string = \"ps\";") == true
        && (try? ProjectEngine.functionSource(fsrc, "public")) == fsrc)

  Mock.seen = []; healthy(tables: 7, status: ["ACTIVE_HEALTHY"])
  let shared = try? engine().finish(ref: REF, name: "their-app")
  let qs = Mock.seen.map(sqlOf)
  check("a project with its own tables: PS goes in its own schema ps", shared?.schema == "ps" && shared?.dbSchema == "ps", "\(String(describing: shared))")
  check("the schema ps is made first", qs.contains { $0.contains("create schema if not exists ps;") && $0.contains("alter default privileges in schema ps") })
  let migQ = qs.filter { $0.contains("insert into ps_meta.migrations") }
  check("every migration ran, none touching public or auth triggers", migQ.count == kit.migrations.count
        && !migQ.contains { $0.range(of: #"\bpublic\.|schema public|before insert on auth\.users|after insert on auth\.sessions"#, options: .regularExpression) != nil })
  check("nothing PS sends changes the other app's privileges", !qs.contains { $0.contains("in schema public") })
  let patch = Mock.seen.first { $0.method == "PATCH" && $0.path.hasSuffix("/postgrest") }
  let patched = ((try? JSONSerialization.jsonObject(with: patch?.body ?? Data())) as? [String: Any])?["db_schema"] as? String
  check("the Data API keeps every schema it served and adds ps", patched == "public, graphql_public, ps", patched ?? "no patch")
  let dep = Mock.seen.first { $0.path.hasSuffix("/functions/deploy") }
  check("vault-auth is deployed reading the schema ps", String(data: dep?.body ?? Data(), encoding: .utf8)?.contains("const DB_SCHEMA: string = \"ps\";") == true)
  check("the setup code goes into ps", qs.contains { $0.contains("insert into ps.setup_codes") } && !qs.contains { $0.contains("public.setup_codes") })
  let sps = ProjectStore.pageScript(shared ?? PSProject(url: "", key: "", ref: "")) ?? ""
  check("the page is told the schema", sps.contains("\"schema\":\"ps\""), sps)

  Mock.seen = []; healthy(tables: 0, status: ["ACTIVE_HEALTHY"])
  let empty = try? engine().finish(ref: REF, name: "ps-vault")
  check("an empty project still uses public, as before", empty != nil && empty?.schema == nil && !Mock.seen.contains { $0.method == "PATCH" })

  // A project whose own app already uses the name ps: stop, change nothing.
  Mock.seen = []; healthy(tables: 7, status: ["ACTIVE_HEALTHY"])
  let prev = Mock.answer
  Mock.answer = { s in sqlOf(s).contains("information_schema.tables") ? (201, [["tables": 7, "ps": false, "tracked": false, "own": false, "pstables": 2, "psfuncs": 0]], nil) : prev(s) }
  do { _ = try engine().finish(ref: REF, name: "their-app"); check("ps already used", false) } catch let e as SBError {
    check("a project already using the name ps is left alone", e.message.contains("Nothing was changed") && !Mock.seen.contains { sqlOf($0).contains("create schema") } && !Mock.seen.contains { $0.method == "PATCH" }, e.message)
  } catch { check("ps already used", false) }

  // ---------- picking up where it stopped ----------
  Mock.seen = []; healthy(applied: kit.migrations.prefix(5).map(\.version), status: ["ACTIVE_HEALTHY"])
  let again = try? engine().migrate(ref: REF)
  check("a second run applies only what is missing", again == kit.migrations.count - 5
        && Mock.seen.map(sqlOf).filter { $0.contains("insert into ps_meta.migrations") }.count == kit.migrations.count - 5)
  Mock.seen = []
  var calls = 0
  Mock.answer = { s in
    let q = sqlOf(s)
    if q.contains("select version from ps_meta.migrations") { return (201, [], nil) }
    calls += 1
    return calls == 3 ? (400, ["message": "relation \"blobs\" already exists"], nil) : (201, [], nil)
  }
  do { try engine().migrate(ref: REF); check("a failing migration stops", false) } catch let e as SBError {
    let third = kit.migrations[2].version
    check("a failing migration stops at its step, sent once, with Supabase's words", e.message.contains("stopped at step \(third)") && e.message.contains("already exists")
          && Mock.seen.filter { sqlOf($0).contains("values ('\(third)'") }.count == 1, e.message)
  } catch { check("failing migration", false) }

  Mock.seen = []
  Mock.answer = { s -> (Int, Any?, URLError.Code?) in
    if sqlOf(s).contains("select version from ps_meta.migrations") { return (201, [[String: Any]](), nil) }
    return (504, ["message": "gateway timeout"], nil)
  }
  do { try engine().migrate(ref: REF); check("a lost migration answer", false) } catch let e as SBError {
    check("a lost migration answer is never sent again on its own (it may still be running)", Mock.seen.filter { sqlOf($0).contains("insert into ps_meta.migrations") }.count == 1 && e.retryable)
  } catch { check("lost migration answer", false) }

  // ---------- refusals ----------
  for red in [ProjectStore.redRef, "YOUR_OTHER_PROJECT_REF"] {
    Mock.seen = []; healthy()
    let r1 = (try? engine().finish(ref: red, name: "x")) == nil
    let r2 = (try? engine().migrate(ref: red)) == nil
    let r3 = (try? engine().deploy(ref: red, have: [:])) == nil
    check("The developer's project \(red.prefix(4)) is never touched (no request at all)", r1 && r2 && r3 && Mock.seen.isEmpty)
  }
  Mock.seen = []; healthy(tables: 4, status: ["ACTIVE_HEALTHY"])
  // Since 7 Nov 2026 a project with other tables is used, but nothing of PS ever goes into its public schema.
  let mine = try? engine().finish(ref: REF, name: "mine")
  check("a project with other tables never gets a PS table in public", mine?.schema == "ps" && !Mock.seen.contains { sqlOf($0).contains("create table public.") })
  Mock.seen = []; healthy(tables: 12, ps: true, tracked: false, status: ["ACTIVE_HEALTHY"])
  check("PS tables set up some other way are refused", (try? engine().finish(ref: REF, name: "x")) == nil && !Mock.seen.contains { sqlOf($0).contains("insert into ps_meta") })
  Mock.seen = []; healthy(status: ["INIT_FAILED"])
  do { _ = try engine().finish(ref: REF, name: "x"); check("init failed", false) } catch let e as SBError { check("a project that failed to start says so", e.message.contains("could not start")) } catch { check("init failed", false) }
  Mock.seen = []; healthy(status: ["COMING_UP"])
  let slow = engine()
  var t0 = Date(timeIntervalSince1970: 0)
  slow.clock = { t0 = t0.addingTimeInterval(30); return t0 }
  do { _ = try slow.finish(ref: REF, name: "x"); check("slow start", false) } catch let e as SBError { check("a slow start gives up with Try again words", e.message.contains("taking longer than usual") && e.message.contains("carries on")) } catch { check("slow", false) }
  Mock.seen = []; healthy(status: ["ACTIVE_HEALTHY"])
  let down = engine(); down.checkFunction = { _, _ in false }; down.checkLimit = 0
  check("a sign in service that never answers stops the setup", (try? down.finish(ref: REF, name: "x")) == nil)

  // an existing project that already has its account: no setup code
  Mock.seen = []; healthy(owned: true, applied: kit.migrations.map(\.version), tables: 14, ps: true, tracked: true, status: ["ACTIVE_HEALTHY"])
  let have = PSProject(url: "https://\(REF).supabase.co", key: JWT, ref: REF, functions: ["vault-auth": kit.functions[0].sha256])
  let re = try? engine().finish(ref: REF, name: "mine", previous: have)
  check("an existing PS project with an account: no setup code, nothing to redeploy", re != nil && re?.setupCode == nil
        && !Mock.seen.contains { sqlOf($0).contains("insert into public.setup_codes") } && !Mock.seen.contains { $0.path.hasSuffix("/functions/deploy") })

  // keys: anon first, else publishable, else stop
  Mock.answer = { _ in (200, [["name": "publishable", "type": "publishable", "api_key": PUB], ["name": "secret", "type": "secret", "api_key": "sb_secret_xxxxxxxxxxxxxx"]], nil) }
  check("no anon key: the publishable key, never a secret one", (try? api().publicKey(ref: REF)) == .some(PUB))
  Mock.answer = { _ in (200, [["name": "service_role", "api_key": "eyJhbGciOiJIUzI1NiJ9.c2VydmljZV9yb2xlXw.c2lnbmF0dXJlLXNpZ25hdHVyZQ"]], nil) }
  check("only a service key: none", (try? api().publicKey(ref: REF)) == .some(nil))

  // updates on a later release
  Mock.seen = []; healthy(applied: kit.migrations.dropLast().map(\.version), status: ["ACTIVE_HEALTHY"])
  let old = PSProject(url: "https://\(REF).supabase.co", key: JWT, ref: REF, kit: "old", functions: ["vault-auth": "0000"])
  let upd = try? engine().update(old)
  check("an update applies only the new migration and redeploys a changed function", upd?.kit == kit.kit && upd?.functions?["vault-auth"] == kit.functions[0].sha256
        && Mock.seen.map(sqlOf).filter { $0.contains("insert into ps_meta.migrations") }.count == 1
        && Mock.seen.filter { $0.path.hasSuffix("/functions/deploy") }.count == 1 && !Mock.seen.contains { $0.method == "POST" && $0.path == "/v1/projects" })

  // the function check itself
  Mock.answer = { s in s.path == "/functions/v1/vault-auth" && s.headers["apikey"] == JWT ? (400, ["error": "Bad request"], nil) : (404, ["message": "no"], nil) }
  check("vault-auth counts as running when it answers 400 with its own error", ProjectEngine.vaultAuthAnswers(url: "https://\(REF).supabase.co", key: JWT, session: session))
  Mock.answer = { _ in (404, ["message": "Function not found"], nil) }
  check("a missing function does not count", !ProjectEngine.vaultAuthAnswers(url: "https://\(REF).supabase.co", key: JWT, session: session))
}
group.wait()
print(fails == 0 ? "PROJECT SETUP: \(passes) ok, 0 FAIL" : "PROJECT SETUP: \(passes) ok, \(fails) FAIL")
exit(fails == 0 ? 0 : 1)
