// The Supabase Management API (api.supabase.com), only for PS's "Connect your own Supabase" setup
// (ProjectSetup.swift): list organisations and projects, create the project, wait for it, run the
// migrations, deploy the sign in function, read the public key. Authorised by the person's own
// personal access token, which is never logged, printed or put in a page.
// Every call runs off the main thread (it waits), with short timeouts, through whatever network the Mac
// has (an ephemeral session: no proxy, interface or VPN settings of its own). Busy and broken answers
// (429, 5xx, a dropped connection) are tried again a few times with growing pauses.
import Foundation

struct SBError: Error, CustomStringConvertible {
  let status: Int            // HTTP status, 0 = no answer (offline, timed out)
  let message: String        // plain words for the person
  var retryable: Bool { status == 0 || status == 408 || status == 429 || status >= 500 }
  var description: String { message }
}

struct SBOrg: Equatable { let slug: String; let name: String }
struct SBProject: Equatable { let ref: String; let name: String; let org: String; let region: String; let status: String }

final class SupabaseAPI {
  let base: URL
  private let token: String
  private let session: URLSession
  /// Pauses between tries (tests make them instant).
  var pause: (TimeInterval) -> Void = { Thread.sleep(forTimeInterval: $0) }
  var tries = 3

  init(token: String, base: URL = URL(string: "https://api.supabase.com")!, session: URLSession? = nil) {
    self.token = token
    self.base = base
    if let session { self.session = session } else {
      let c = URLSessionConfiguration.ephemeral
      c.timeoutIntervalForRequest = 20
      c.timeoutIntervalForResource = 60
      c.waitsForConnectivity = false
      c.httpCookieStorage = nil
      c.urlCache = nil
      self.session = URLSession(configuration: c)
    }
  }

  /// Supabase's scoped access tokens start with sbp_fc (docs, Nov 2026); classic ones carry the whole account.
  var scopedToken: Bool { token.hasPrefix("sbp_fc") }

  static func validToken(_ t: String) -> Bool { GuideCore.isAccessToken(t) }   // one pattern for the field and the guide (SetupGuideCore.swift)

  // MARK: requests

  /// One call, tried again on busy or broken answers. Never on the main thread.
  func call(_ method: String, _ path: String, query: [URLQueryItem] = [], json: Any? = nil, body: Data? = nil,
            contentType: String? = nil, timeout: TimeInterval = 20, retry: Bool = true) throws -> (Int, Data) {
    precondition(!Thread.isMainThread, "Supabase calls never run on the main thread")
    var comps = URLComponents(url: base.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
    if !query.isEmpty { comps.queryItems = query }
    var req = URLRequest(url: comps.url!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
    req.httpMethod = method
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    req.setValue("application/json", forHTTPHeaderField: "Accept")
    if let json {
      req.httpBody = try JSONSerialization.data(withJSONObject: json)
      req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    } else if let body {
      req.httpBody = body
      if let contentType { req.setValue(contentType, forHTTPHeaderField: "Content-Type") }
    }
    var last = SBError(status: 0, message: "No answer from Supabase.")
    for attempt in 0..<(retry ? max(1, tries) : 1) {
      if attempt > 0 { pause(Double(1 << (attempt - 1)) * 1.5) }
      let (status, data, err) = send(req, timeout: timeout + 5)
      if let err { last = SBError(status: 0, message: SupabaseAPI.offlineWords(err)); continue }
      if (200..<300).contains(status) { return (status, data) }
      last = SBError(status: status, message: SupabaseAPI.words(status, data))
      if !last.retryable { throw last }
    }
    throw last
  }

  private func send(_ req: URLRequest, timeout: TimeInterval) -> (Int, Data, Error?) {
    let done = DispatchSemaphore(value: 0)
    var out: (Int, Data, Error?) = (0, Data(), nil)
    let task = session.dataTask(with: req) { d, r, e in
      out = ((r as? HTTPURLResponse)?.statusCode ?? 0, d ?? Data(), e)
      done.signal()
    }
    task.resume()
    if done.wait(timeout: .now() + timeout) == .timedOut { task.cancel(); return (0, Data(), URLError(.timedOut)) }
    return out
  }

  static func offlineWords(_ e: Error) -> String {
    let c = (e as? URLError)?.code
    if c == .notConnectedToInternet || c == .networkConnectionLost { return "This Mac is offline. Check the internet connection and try again." }
    if c == .timedOut { return "Supabase did not answer in time. Try again in a moment." }
    return "Could not reach Supabase. Check the internet connection and try again."
  }

  /// Supabase's own message when there is one, in a sentence; never the request or the token.
  static func words(_ status: Int, _ data: Data) -> String {
    var msg = ""
    if let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
      msg = (o["message"] as? String) ?? (o["error"] as? String) ?? (o["msg"] as? String) ?? ""
    }
    msg = String(msg.replacingOccurrences(of: #"sbp_[A-Za-z0-9_]+"#, with: "(token)", options: .regularExpression).prefix(240))
    switch status {
    case 401: return "Supabase did not accept this access token. Make a new one and paste it again."
    case 403: return (msg.isEmpty ? "This access token may not do that." : "Supabase said no: \(msg).") + " Make a new token with full access, or limited to your project with Database, Edge Functions and Data API Config (read and write), and API Keys and Project Settings (read)."
    case 404: return msg.isEmpty ? "Supabase could not find that project." : "Supabase: \(msg)"
    case 429: return "Supabase is busy (too many requests). Wait a minute and try again."
    case 500...: return "Supabase had a problem (\(status)). Try again in a moment."
    default: return msg.isEmpty ? "Supabase answered \(status)." : "Supabase: \(msg)"
    }
  }

  private func jsonArray(_ d: Data) -> [[String: Any]] { (try? JSONSerialization.jsonObject(with: d)) as? [[String: Any]] ?? [] }
  private func jsonObject(_ d: Data) -> [String: Any] { (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] ?? [:] }

  // MARK: the calls PS uses

  func orgs() throws -> [SBOrg] {
    let (_, d) = try call("GET", "v1/organizations")
    return jsonArray(d).compactMap { o in
      guard let slug = (o["slug"] as? String) ?? (o["id"] as? String) else { return nil }
      return SBOrg(slug: slug, name: (o["name"] as? String) ?? slug)
    }
  }

  private func project(_ o: [String: Any]) -> SBProject? {
    guard let ref = (o["ref"] as? String) ?? (o["id"] as? String) else { return nil }
    return SBProject(ref: ref, name: o["name"] as? String ?? ref, org: (o["organization_slug"] as? String) ?? (o["organization_id"] as? String) ?? "",
                     region: o["region"] as? String ?? "", status: o["status"] as? String ?? "")
  }
  func projects() throws -> [SBProject] {
    let (_, d) = try call("GET", "v1/projects")
    return jsonArray(d).compactMap(project)
  }
  func project(ref: String) throws -> SBProject {
    let (_, d) = try call("GET", "v1/projects/\(ref)")
    guard let p = project(jsonObject(d)) else { throw SBError(status: 0, message: "Supabase sent an answer PS does not understand.") }
    return p
  }

  /// A new project. Never retried blindly: a lost answer may still have made one (ProjectEngine looks).
  func createProject(name: String, org: String, region: String, dbPass: String) throws -> SBProject {
    let body: [String: Any] = ["name": name, "organization_slug": org, "db_pass": dbPass, "region_selection": ["type": "specific", "code": region]]
    do {
      let (_, d) = try call("POST", "v1/projects", json: body, timeout: 45, retry: false)
      guard let p = project(jsonObject(d)) else { throw SBError(status: 0, message: "Supabase sent an answer PS does not understand.") }
      return p
    } catch let e as SBError where e.status == 400 || e.status == 422 {
      // An older form of the same call (organization_id and region).
      let old: [String: Any] = ["name": name, "organization_id": org, "db_pass": dbPass, "region": region]
      guard let (_, d) = try? call("POST", "v1/projects", json: old, timeout: 45, retry: false), let p = project(jsonObject(d)) else { throw e }
      return p
    }
  }

  /// The public key the page uses: the anon key while the project has one, else the publishable key.
  func publicKey(ref: String) throws -> String? {
    let (_, d) = try call("GET", "v1/projects/\(ref)/api-keys")
    let keys = jsonArray(d)
    func key(_ o: [String: Any]) -> String? { o["api_key"] as? String }
    if let anon = keys.first(where: { ($0["name"] as? String) == "anon" }).flatMap(key), ProjectStore.validKey(anon) { return anon }
    if let pub = keys.first(where: { ($0["type"] as? String) == "publishable" }).flatMap(key), ProjectStore.validKey(pub) { return pub }
    return nil
  }

  /// Runs SQL as the project's database owner. Returns the rows of the last statement.
  @discardableResult
  func sql(ref: String, _ query: String, timeout: TimeInterval = 60, retry: Bool = true) throws -> [[String: Any]] {
    let (_, d) = try call("POST", "v1/projects/\(ref)/database/query", json: ["query": query], timeout: timeout, retry: retry)
    return jsonArray(d)
  }

  /// Deploys one function from its source files (Supabase bundles it on its side).
  func deployFunction(ref: String, slug: String, entry: String, files: [(String, Data)], verifyJWT: Bool) throws {
    let boundary = "ps-" + UUID().uuidString
    var b = Data()
    func part(_ head: String, _ data: Data) { b.append(Data("--\(boundary)\r\n\(head)\r\n\r\n".utf8)); b.append(data); b.append(Data("\r\n".utf8)) }
    let meta: [String: Any] = ["entrypoint_path": entry, "name": slug, "verify_jwt": verifyJWT]
    part("Content-Disposition: form-data; name=\"metadata\"\r\nContent-Type: application/json", try JSONSerialization.data(withJSONObject: meta))
    for (path, data) in files {
      part("Content-Disposition: form-data; name=\"file\"; filename=\"\(path)\"\r\nContent-Type: application/typescript", data)
    }
    b.append(Data("--\(boundary)--\r\n".utf8))
    _ = try call("POST", "v1/projects/\(ref)/functions/deploy", query: [URLQueryItem(name: "slug", value: slug)],
                 body: b, contentType: "multipart/form-data; boundary=\(boundary)", timeout: 90)
  }

  /// The slugs of the project's Edge Functions.
  func functionSlugs(ref: String) throws -> [String] {
    let (_, d) = try call("GET", "v1/projects/\(ref)/functions")
    return jsonArray(d).compactMap { $0["slug"] as? String }
  }

  /// The schemas the Data API serves, as Supabase stores them ("public, graphql_public").
  func postgrestSchemas(ref: String) throws -> String {
    let (_, d) = try call("GET", "v1/projects/\(ref)/postgrest")
    return jsonObject(d)["db_schema"] as? String ?? ""
  }
  func setPostgrestSchemas(ref: String, _ schemas: [String]) throws {
    _ = try call("PATCH", "v1/projects/\(ref)/postgrest", json: ["db_schema": schemas.joined(separator: ", ")])
  }

  /// Function secrets (none are needed today; kept for kits that list some).
  func setSecrets(ref: String, _ secrets: [String: String]) throws {
    guard !secrets.isEmpty else { return }
    _ = try call("POST", "v1/projects/\(ref)/secrets", json: secrets.map { ["name": $0.key, "value": $0.value] })
  }
}
