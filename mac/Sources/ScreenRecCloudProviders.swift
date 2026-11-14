// Screen recorder, the cloud providers and the upload engine (PS 1.60, pull request 12c). Foundation and CryptoKit only. Every provider
// talks through SRCloudHTTP (one blocking request), so the tests plug in a fake cloud server and nothing ever reaches a real cloud.
//
// Research behind each one is in the 12c report (sources: the providers' own docs). In short:
//  - Google Drive: resumable upload (chunks in multiples of 256 KiB), check size and sha256Checksum or md5Checksum with a fresh files.get.
//  - Dropbox: upload sessions (append_v2 with the offset), check size and content_hash with a fresh get_metadata.
//  - OneDrive: Graph upload session (fragments in multiples of 320 KiB, no auth header on the PUTs), check size and quickXorHash.
//  - iCloud Drive and any folder: copy to a temp name, fsync, rename, read back and compare SHA-256; iCloud also waits for macOS's own
//    "uploaded" flag (ubiquitousItemIsUploaded). A flag that is not there at all means unsure, so the file stays.
import Foundation
import CryptoKit

// ---------- one HTTP request ----------
struct SRReq {
  var method: String
  var url: URL
  var headers: [String: String] = [:]
  var body: Data? = nil
}
struct SRResp {
  var status: Int
  var headers: [String: String] = [:]
  var body = Data()
  var netError: String? = nil
  func header(_ n: String) -> String? { headers.first { $0.key.lowercased() == n.lowercased() }?.value }
  var json: [String: Any]? { (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] }
}
protocol SRCloudHTTP: AnyObject { func send(_ r: SRReq) -> SRResp }

enum SRUpError: Error, Equatable {
  case transient(String)    // try again later (no network, 5xx, 429)
  case sessionLost          // the upload session is gone: start it again from the beginning
  case authLost(String)     // the login stopped working: sign in again
  case fatal(String)        // will not work by trying again
  case stopped              // paused between chunks because the Mac got busy
}

struct SRRemote: Equatable, Codable {
  var id: String
  var name: String
  var webURL: String?
  var size: Int64?
}
struct SRSession: Equatable, Codable {
  var url: String?
  var id: String?
  var folder: String?
  var offset: Int64 = 0
}
struct SRUploadSource { var url: URL; var size: Int64; var name: String }
struct SRChecked: Equatable { var verdict: SRVerdict; var remoteSize: Int64?; var remote: SRRemote? }
struct SRStream: Equatable { var url: URL; var headers: [String: String] }

protocol SRUploader: AnyObject {
  var provider: SRCloudProvider { get }
  var needs: Set<SRHashKind> { get }
  func upload(_ src: SRUploadSource, session: inout SRSession, progress: (Int64) -> Void, shouldStop: () -> Bool) throws -> SRRemote
  func check(_ remote: SRRemote, local: SRHashes) throws -> SRChecked
  func remove(_ remote: SRRemote) throws
  func stream(_ remote: SRRemote) throws -> SRStream?
}

/// A request with the person's token on it. A 401 refreshes the token once; a second 401 means the login is gone.
struct SRAuthed {
  let http: SRCloudHTTP
  let token: (_ forceRefresh: Bool) throws -> String
  func send(_ r: SRReq, auth: Bool = true) throws -> SRResp {
    var req = r
    if auth { req.headers["Authorization"] = "Bearer " + (try token(false)) }
    var resp = http.send(req)
    if resp.status == 401 && auth {
      req.headers["Authorization"] = "Bearer " + (try token(true))
      resp = http.send(req)
      if resp.status == 401 { throw SRUpError.authLost("The login stopped working. Sign in again.") }
    }
    return resp
  }
  /// What a failed answer means.
  static func problem(_ r: SRResp) -> SRUpError {
    if let e = r.netError { return .transient(e) }
    switch r.status {
    case 0, 408, 429, 500...599: return .transient("The cloud said \(r.status). PS will try again.")
    case 401: return .authLost("The login stopped working. Sign in again.")
    case 403:
      let t = String(decoding: r.body.prefix(400), as: UTF8.self).lowercased()
      if t.contains("ratelimit") || t.contains("rate_limit") || t.contains("too_many") { return .transient("The cloud asked PS to slow down.") }
      return .fatal("The cloud refused this (\(r.status)). It may be full, or PS may not be allowed.")
    default: return .fatal("The cloud said \(r.status).")
    }
  }
}

private func url(_ base: String, _ path: String, _ q: [String: String] = [:]) -> URL {
  var c = URLComponents(string: base + path)!
  if !q.isEmpty { c.queryItems = q.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) } }
  return c.url!
}
private func jsonData(_ o: Any) -> Data { (try? JSONSerialization.data(withJSONObject: o)) ?? Data() }
private func readChunk(_ u: URL, offset: Int64, length: Int) throws -> Data {
  let fh = try FileHandle(forReadingFrom: u)
  defer { try? fh.close() }
  try fh.seek(toOffset: UInt64(offset))
  return try fh.read(upToCount: length) ?? Data()
}
private func int64(_ v: Any?) -> Int64? { if let n = v as? Int64 { return n }; if let n = v as? Int { return Int64(n) }; if let s = v as? String { return Int64(s) }; return nil }
/// Keeps a file name safe for every cloud (no slashes or colons).
func srSafeName(_ s: String) -> String {
  let bad = CharacterSet(charactersIn: "/\\:*?\"<>|\n\r")
  let t = s.unicodeScalars.map { bad.contains($0) ? "-" : String($0) }.joined().trimmingCharacters(in: .whitespaces)
  return t.isEmpty ? "Recording" : String(t.prefix(150))
}

// ---------- Google Drive ----------
final class SRGoogleDrive: SRUploader {
  let provider = SRCloudProvider.googleDrive
  let needs: Set<SRHashKind> = [.sha256, .md5]
  let a: SRAuthed
  var base = "https://www.googleapis.com"
  var folderName = "PS Recordings"
  var chunk: Int64 = 8 * 1024 * 1024        // a multiple of 256 KiB
  init(_ a: SRAuthed) { self.a = a }

  private func ensureFolder() throws -> String {
    let q = "name='\(folderName)' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    let r = try a.send(SRReq(method: "GET", url: url(base, "/drive/v3/files", ["q": q, "fields": "files(id)", "spaces": "drive"])))
    guard (200..<300).contains(r.status) else { throw SRAuthed.problem(r) }
    if let id = ((r.json?["files"] as? [[String: Any]])?.first?["id"]) as? String { return id }
    let c = try a.send(SRReq(method: "POST", url: url(base, "/drive/v3/files", ["fields": "id"]), headers: ["Content-Type": "application/json"],
                             body: jsonData(["name": folderName, "mimeType": "application/vnd.google-apps.folder"])))
    guard (200..<300).contains(c.status), let id = c.json?["id"] as? String else { throw SRAuthed.problem(c) }
    return id
  }
  private static func rangeEnd(_ r: SRResp) -> Int64 {
    // "bytes=0-8388607" means the first 8388608 bytes are safe; no header means nothing yet
    guard let h = r.header("Range"), let dash = h.lastIndex(of: "-"), let end = Int64(h[h.index(after: dash)...]) else { return 0 }
    return end + 1
  }
  private func remote(_ r: SRResp, name: String) throws -> SRRemote {
    guard let j = r.json, let id = j["id"] as? String else { throw SRUpError.fatal("Google Drive did not say which file it made.") }
    return SRRemote(id: id, name: (j["name"] as? String) ?? name, webURL: j["webViewLink"] as? String, size: int64(j["size"]))
  }
  func upload(_ src: SRUploadSource, session: inout SRSession, progress: (Int64) -> Void, shouldStop: () -> Bool) throws -> SRRemote {
    guard src.size > 0 else { throw SRUpError.fatal("The recording is empty.") }
    var offset: Int64 = 0
    if let s = session.url, let u = URL(string: s) {
      // resume: ask where the session stands
      let r = try a.send(SRReq(method: "PUT", url: u, headers: ["Content-Range": "bytes */\(src.size)"]))
      switch r.status {
      case 200, 201: return try remote(r, name: src.name)
      case 308: offset = Self.rangeEnd(r)
      case 404, 410: session = SRSession(folder: session.folder); throw SRUpError.sessionLost
      default: throw SRAuthed.problem(r)
      }
    } else {
      let folder = try session.folder ?? ensureFolder()
      session.folder = folder
      let r = try a.send(SRReq(method: "POST", url: url(base, "/upload/drive/v3/files", ["uploadType": "resumable", "fields": "id,name,size,webViewLink"]),
                               headers: ["Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "application/octet-stream", "X-Upload-Content-Length": "\(src.size)"],
                               body: jsonData(["name": src.name, "parents": [folder]])))
      guard r.status == 200, let loc = r.header("Location") else { throw SRAuthed.problem(r) }
      session.url = loc; session.offset = 0
    }
    progress(offset)
    while offset < src.size {
      if shouldStop() { session.offset = offset; throw SRUpError.stopped }
      let n = Int(min(chunk, src.size - offset))
      let data = try readChunk(src.url, offset: offset, length: n)
      guard data.count == n else { throw SRUpError.fatal("The file changed while it was uploading.") }
      guard let u = URL(string: session.url ?? "") else { throw SRUpError.sessionLost }
      let r = try a.send(SRReq(method: "PUT", url: u, headers: ["Content-Range": "bytes \(offset)-\(offset + Int64(n) - 1)/\(src.size)"], body: data))
      switch r.status {
      case 200, 201: progress(src.size); return try remote(r, name: src.name)
      case 308: offset = Self.rangeEnd(r); session.offset = offset; progress(offset)
      case 404, 410: session = SRSession(folder: session.folder); throw SRUpError.sessionLost
      default: session.offset = offset; throw SRAuthed.problem(r)
      }
    }
    // everything sent but no final answer: ask the session once more
    guard let u = URL(string: session.url ?? "") else { throw SRUpError.sessionLost }
    let r = try a.send(SRReq(method: "PUT", url: u, headers: ["Content-Range": "bytes */\(src.size)"]))
    if r.status == 200 || r.status == 201 { return try remote(r, name: src.name) }
    throw r.status == 308 ? SRUpError.transient("Google Drive has not finished yet.") : SRAuthed.problem(r)
  }
  func check(_ remote: SRRemote, local: SRHashes) throws -> SRChecked {
    let r = try a.send(SRReq(method: "GET", url: url(base, "/drive/v3/files/\(remote.id)", ["fields": "id,name,size,md5Checksum,sha256Checksum,webViewLink"])))
    guard r.status == 200, let j = r.json else { if r.status == 404 { return SRChecked(verdict: .mismatch("The file is not in Google Drive."), remoteSize: nil, remote: nil) }; throw SRAuthed.problem(r) }
    let size = int64(j["size"])
    var out = remote; out.webURL = (j["webViewLink"] as? String) ?? remote.webURL; out.size = size
    guard let size, size == local.size else { return SRChecked(verdict: .mismatch("Google Drive holds a different size."), remoteSize: size, remote: out) }
    if let s = j["sha256Checksum"] as? String, let mine = local.sha256 {
      return SRChecked(verdict: s.lowercased() == mine.lowercased() ? .verified : .mismatch("The SHA-256 in Google Drive is different."), remoteSize: size, remote: out)
    }
    if let m = j["md5Checksum"] as? String, let mine = local.md5 {
      return SRChecked(verdict: m.lowercased() == mine.lowercased() ? .verified : .mismatch("The MD5 in Google Drive is different."), remoteSize: size, remote: out)
    }
    return SRChecked(verdict: .unsure("Google Drive gave no checksum."), remoteSize: size, remote: out)
  }
  func remove(_ remote: SRRemote) throws {
    let r = try a.send(SRReq(method: "DELETE", url: url(base, "/drive/v3/files/\(remote.id)")))
    guard (200..<300).contains(r.status) || r.status == 404 else { throw SRAuthed.problem(r) }
  }
  func stream(_ remote: SRRemote) throws -> SRStream? {
    SRStream(url: url(base, "/drive/v3/files/\(remote.id)", ["alt": "media"]), headers: ["Authorization": "Bearer " + (try a.token(false))])
  }
}

// ---------- Dropbox ----------
/// Dropbox wants its argument header as plain ASCII JSON: letters outside ASCII are written as \uXXXX.
func srDropboxArg(_ o: Any) -> String {
  let s = String(decoding: jsonData(o), as: UTF8.self)
  var out = ""
  for u in s.utf16 { out += u < 128 ? String(UnicodeScalar(UInt8(u))) : String(format: "\\u%04x", u) }
  return out
}
final class SRDropbox: SRUploader {
  let provider = SRCloudProvider.dropbox
  let needs: Set<SRHashKind> = [.dropbox]
  let a: SRAuthed
  var content = "https://content.dropboxapi.com", api = "https://api.dropboxapi.com"
  var folder = "/PS Recordings"
  var chunk: Int64 = 8 * 1024 * 1024        // two 4 MiB blocks
  init(_ a: SRAuthed) { self.a = a }

  private func call(_ path: String, arg: Any, body: Data? = nil) throws -> SRResp {
    try a.send(SRReq(method: "POST", url: URL(string: content + path)!, headers: ["Dropbox-API-Arg": srDropboxArg(arg), "Content-Type": "application/octet-stream"], body: body ?? Data()))
  }
  private func rpc(_ path: String, _ o: Any) throws -> SRResp {
    try a.send(SRReq(method: "POST", url: URL(string: api + path)!, headers: ["Content-Type": "application/json"], body: jsonData(o)))
  }
  private func remote(_ j: [String: Any]?, _ name: String) throws -> SRRemote {
    guard let j, let id = j["id"] as? String else { throw SRUpError.fatal("Dropbox did not say which file it made.") }
    // the page that opens the folder in the person's own Dropbox
    let dir = ((j["path_display"] as? String) ?? "").split(separator: "/").dropLast().map { "/" + (String($0).addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? "") }.joined()
    return SRRemote(id: id, name: (j["name"] as? String) ?? name, webURL: "https://www.dropbox.com/home" + dir, size: int64(j["size"]))
  }
  private func errorTag(_ r: SRResp) -> (tag: String, correct: Int64?) {
    let e = r.json?["error"] as? [String: Any]
    return ((e?[".tag"] as? String) ?? "", int64(e?["correct_offset"]))
  }
  func upload(_ src: SRUploadSource, session: inout SRSession, progress: (Int64) -> Void, shouldStop: () -> Bool) throws -> SRRemote {
    guard src.size > 0 else { throw SRUpError.fatal("The recording is empty.") }
    if session.id == nil {
      let r = try call("/2/files/upload_session/start", arg: ["close": false])
      guard r.status == 200, let id = r.json?["session_id"] as? String else { throw SRAuthed.problem(r) }
      session.id = id; session.offset = 0
    }
    var offset = session.offset
    progress(offset)
    while offset < src.size {
      if shouldStop() { session.offset = offset; throw SRUpError.stopped }
      let n = Int(min(chunk, src.size - offset))
      let data = try readChunk(src.url, offset: offset, length: n)
      guard data.count == n else { throw SRUpError.fatal("The file changed while it was uploading.") }
      let r = try call("/2/files/upload_session/append_v2", arg: ["cursor": ["session_id": session.id!, "offset": offset], "close": false], body: data)
      if r.status == 200 { offset += Int64(n); session.offset = offset; progress(offset); continue }
      let e = errorTag(r)
      if r.status == 409, e.tag == "incorrect_offset", let c = e.correct, c >= 0, c <= src.size { offset = c; session.offset = c; progress(c); continue }
      if r.status == 409, e.tag == "not_found" || e.tag == "closed" { session = SRSession(); throw SRUpError.sessionLost }
      session.offset = offset
      throw SRAuthed.problem(r)
    }
    let path = folder + "/" + src.name
    let fin = try call("/2/files/upload_session/finish", arg: ["cursor": ["session_id": session.id!, "offset": src.size],
                                                                "commit": ["path": path, "mode": "add", "autorename": true, "mute": true]])
    if fin.status == 200 { progress(src.size); return try remote(fin.json, src.name) }
    if fin.status == 409 {
      let e = errorTag(fin)
      if e.tag == "lookup_failed" || e.tag == "not_found" || e.tag == "closed" {
        // the finish may have gone through while the answer was lost: look at the path before starting again
        let m = try rpc("/2/files/get_metadata", ["path": path])
        if m.status == 200, int64(m.json?["size"]) == src.size { return try remote(m.json, src.name) }
        session = SRSession(); throw SRUpError.sessionLost
      }
    }
    throw SRAuthed.problem(fin)
  }
  func check(_ remote: SRRemote, local: SRHashes) throws -> SRChecked {
    let r = try rpc("/2/files/get_metadata", ["path": remote.id])
    guard r.status == 200, let j = r.json else { if r.status == 409 { return SRChecked(verdict: .mismatch("The file is not in Dropbox."), remoteSize: nil, remote: nil) }; throw SRAuthed.problem(r) }
    let size = int64(j["size"])
    var out = remote; out.size = size
    guard let size, size == local.size else { return SRChecked(verdict: .mismatch("Dropbox holds a different size."), remoteSize: size, remote: out) }
    guard let h = j["content_hash"] as? String, let mine = local.dropbox else { return SRChecked(verdict: .unsure("Dropbox gave no content hash."), remoteSize: size, remote: out) }
    return SRChecked(verdict: h.lowercased() == mine.lowercased() ? .verified : .mismatch("The content hash in Dropbox is different."), remoteSize: size, remote: out)
  }
  func remove(_ remote: SRRemote) throws {
    let r = try rpc("/2/files/delete_v2", ["path": remote.id])
    guard (200..<300).contains(r.status) || r.status == 409 else { throw SRAuthed.problem(r) }
  }
  func stream(_ remote: SRRemote) throws -> SRStream? {
    let r = try rpc("/2/files/get_temporary_link", ["path": remote.id])
    guard r.status == 200, let l = r.json?["link"] as? String, let u = URL(string: l) else { throw SRAuthed.problem(r) }
    return SRStream(url: u, headers: [:])
  }
}

// ---------- OneDrive (Microsoft Graph) ----------
final class SROneDrive: SRUploader {
  let provider = SRCloudProvider.oneDrive
  let needs: Set<SRHashKind> = [.quickXor]
  let a: SRAuthed
  var base = "https://graph.microsoft.com/v1.0"
  var folder = "PS Recordings"
  var fragment: Int64 = 32 * 327_680        // 10 MiB, a multiple of 320 KiB
  init(_ a: SRAuthed) { self.a = a }

  private func item(_ j: [String: Any]?, _ name: String) throws -> SRRemote {
    guard let j, let id = j["id"] as? String else { throw SRUpError.fatal("OneDrive did not say which file it made.") }
    return SRRemote(id: id, name: (j["name"] as? String) ?? name, webURL: j["webUrl"] as? String, size: int64(j["size"]))
  }
  private static func nextStart(_ j: [String: Any]?) -> Int64? {
    guard let first = (j?["nextExpectedRanges"] as? [String])?.first else { return nil }
    return Int64(first.split(separator: "-").first ?? "")
  }
  func upload(_ src: SRUploadSource, session: inout SRSession, progress: (Int64) -> Void, shouldStop: () -> Bool) throws -> SRRemote {
    guard src.size > 0 else { throw SRUpError.fatal("The recording is empty.") }
    var offset: Int64 = 0
    if let s = session.url, let u = URL(string: s) {
      let r = try a.send(SRReq(method: "GET", url: u), auth: false)   // the upload address carries its own key: no Authorization header
      switch r.status {
      case 200: offset = Self.nextStart(r.json) ?? 0
      case 404, 410: session = SRSession(); throw SRUpError.sessionLost
      default: throw SRAuthed.problem(r)
      }
    } else {
      let path = (folder + "/" + src.name).split(separator: "/").map { String($0).addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)! }.joined(separator: "/")
      let r = try a.send(SRReq(method: "POST", url: URL(string: base + "/me/drive/root:/" + path + ":/createUploadSession")!, headers: ["Content-Type": "application/json"],
                               body: jsonData(["item": ["@microsoft.graph.conflictBehavior": "rename", "name": src.name]])))
      guard (200..<300).contains(r.status), let up = r.json?["uploadUrl"] as? String else { throw SRAuthed.problem(r) }
      session.url = up; session.offset = 0
    }
    progress(offset)
    while offset < src.size {
      if shouldStop() { session.offset = offset; throw SRUpError.stopped }
      let n = Int(min(fragment, src.size - offset))
      let data = try readChunk(src.url, offset: offset, length: n)
      guard data.count == n else { throw SRUpError.fatal("The file changed while it was uploading.") }
      guard let u = URL(string: session.url ?? "") else { throw SRUpError.sessionLost }
      let r = try a.send(SRReq(method: "PUT", url: u, headers: ["Content-Range": "bytes \(offset)-\(offset + Int64(n) - 1)/\(src.size)", "Content-Type": "application/octet-stream"], body: data), auth: false)
      switch r.status {
      case 200, 201: progress(src.size); return try item(r.json, src.name)
      case 202: offset = Self.nextStart(r.json) ?? (offset + Int64(n)); session.offset = offset; progress(offset)
      case 404, 410: session = SRSession(); throw SRUpError.sessionLost
      case 416: // the server is further along than we thought: ask where it stands
        let q = try a.send(SRReq(method: "GET", url: u), auth: false)
        offset = Self.nextStart(q.json) ?? offset; session.offset = offset
      default: session.offset = offset; throw SRAuthed.problem(r)
      }
    }
    throw SRUpError.transient("OneDrive has not finished yet.")
  }
  func check(_ remote: SRRemote, local: SRHashes) throws -> SRChecked {
    let r = try a.send(SRReq(method: "GET", url: url(base, "/me/drive/items/\(remote.id)", ["select": "id,name,size,webUrl,file"])))
    guard r.status == 200, let j = r.json else { if r.status == 404 { return SRChecked(verdict: .mismatch("The file is not in OneDrive."), remoteSize: nil, remote: nil) }; throw SRAuthed.problem(r) }
    let size = int64(j["size"])
    var out = remote; out.size = size; out.webURL = (j["webUrl"] as? String) ?? remote.webURL
    guard let size, size == local.size else { return SRChecked(verdict: .mismatch("OneDrive holds a different size."), remoteSize: size, remote: out) }
    let hashes = (j["file"] as? [String: Any])?["hashes"] as? [String: Any]
    guard let h = hashes?["quickXorHash"] as? String, let mine = local.quickXor else {
      return SRChecked(verdict: .notYet("OneDrive has not worked out the checksum yet."), remoteSize: size, remote: out)
    }
    return SRChecked(verdict: h == mine ? .verified : .mismatch("The quickXorHash in OneDrive is different."), remoteSize: size, remote: out)
  }
  func remove(_ remote: SRRemote) throws {
    let r = try a.send(SRReq(method: "DELETE", url: url(base, "/me/drive/items/\(remote.id)")))
    guard (200..<300).contains(r.status) || r.status == 404 else { throw SRAuthed.problem(r) }
  }
  func stream(_ remote: SRRemote) throws -> SRStream? {
    let r = try a.send(SRReq(method: "GET", url: url(base, "/me/drive/items/\(remote.id)", ["select": "id,@microsoft.graph.downloadUrl"])))
    guard r.status == 200, let l = r.json?["@microsoft.graph.downloadUrl"] as? String, let u = URL(string: l) else { throw SRAuthed.problem(r) }
    return SRStream(url: u, headers: [:])
  }
}

// ---------- iCloud Drive and any folder ----------
protocol SRUbiquity { func uploaded(_ url: URL) -> Bool? }    // nil: macOS does not say
final class SRFolderUploader: SRUploader {
  let provider: SRCloudProvider
  let needs: Set<SRHashKind> = [.sha256]
  let dest: URL
  let ubiquity: SRUbiquity?
  var testAfterCopy: ((URL) -> Void)?
  init(provider: SRCloudProvider, dest: URL, ubiquity: SRUbiquity? = nil) { self.provider = provider; self.dest = dest; self.ubiquity = ubiquity }

  /// Copy to a temp name in the destination, fsync, rename: a half copy never has the real name.
  func upload(_ src: SRUploadSource, session: inout SRSession, progress: (Int64) -> Void, shouldStop: () -> Bool) throws -> SRRemote {
    let fm = FileManager.default
    if let done = session.url, fm.fileExists(atPath: done) { return SRRemote(id: done, name: (done as NSString).lastPathComponent, webURL: nil, size: src.size) }
    do { try fm.createDirectory(at: dest, withIntermediateDirectories: true) } catch { throw SRUpError.fatal("The folder cannot be made: \(error.localizedDescription)") }
    let tmp = dest.appendingPathComponent(".\(src.name).pspart")
    try? fm.removeItem(at: tmp)
    guard fm.createFile(atPath: tmp.path, contents: nil) else { throw SRUpError.fatal("PS cannot write in that folder.") }
    do {
      let out = try FileHandle(forWritingTo: tmp), inp = try FileHandle(forReadingFrom: src.url)
      defer { try? out.close(); try? inp.close() }
      var sent: Int64 = 0
      while true {
        if shouldStop() { try? fm.removeItem(at: tmp); throw SRUpError.stopped }
        guard let d = try inp.read(upToCount: 1 << 20), !d.isEmpty else { break }
        try out.write(contentsOf: d); sent += Int64(d.count); progress(sent)
      }
      try out.synchronize()
      if sent != src.size { throw SRUpError.fatal("The file changed while it was copied.") }
    } catch let e as SRUpError { try? fm.removeItem(at: tmp); throw e }
    catch { try? fm.removeItem(at: tmp); throw SRUpError.transient("The copy stopped: \(error.localizedDescription)") }
    var target = dest.appendingPathComponent(src.name)
    var n = 2
    let base = (src.name as NSString).deletingPathExtension, ext = (src.name as NSString).pathExtension
    while fm.fileExists(atPath: target.path) { target = dest.appendingPathComponent(ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)"); n += 1 }
    do { try fm.moveItem(at: tmp, to: target) } catch { try? fm.removeItem(at: tmp); throw SRUpError.transient("The copy could not be finished: \(error.localizedDescription)") }
    session.url = target.path
    testAfterCopy?(target)
    return SRRemote(id: target.path, name: target.lastPathComponent, webURL: nil, size: src.size)
  }
  /// Read the copy back and compare SHA-256 and size. iCloud also needs macOS to say the file reached iCloud.
  func check(_ remote: SRRemote, local: SRHashes) throws -> SRChecked {
    let u = URL(fileURLWithPath: remote.id)
    guard FileManager.default.fileExists(atPath: u.path) else { return SRChecked(verdict: .mismatch("The copy is not in the folder."), remoteSize: nil, remote: nil) }
    let back: SRHashes
    do { back = try SRFileHash.compute(u, kinds: [.sha256]) } catch { return SRChecked(verdict: .notYet("The copy cannot be read yet."), remoteSize: nil, remote: remote) }
    var out = remote; out.size = back.size
    guard back.size == local.size, let h = back.sha256, h == local.sha256 else { return SRChecked(verdict: .mismatch("The copy in the folder is not the same file."), remoteSize: back.size, remote: out) }
    if provider == .iCloud {
      switch ubiquity?.uploaded(u) {
      case .some(true): return SRChecked(verdict: .verified, remoteSize: back.size, remote: out)
      case .some(false): return SRChecked(verdict: .notYet("iCloud has not finished uploading it yet."), remoteSize: back.size, remote: out)
      case .none: return SRChecked(verdict: .unsure("macOS does not say if iCloud has it."), remoteSize: back.size, remote: out)
      }
    }
    return SRChecked(verdict: .verified, remoteSize: back.size, remote: out)
  }
  func remove(_ remote: SRRemote) throws {
    let u = URL(fileURLWithPath: remote.id)
    if FileManager.default.fileExists(atPath: u.path) { do { try FileManager.default.removeItem(at: u) } catch { throw SRUpError.fatal("The copy cannot be deleted.") } }
  }
  func stream(_ remote: SRRemote) throws -> SRStream? { nil }
}

// ---------- the queue and the engine ----------
enum SRJobState: String, Codable { case waiting, uploading, verifying, done, unsure, failed, needsSignIn }
struct SRJob: Codable, Equatable {
  var id: String
  var path: String
  var name: String
  var size: Int64
  var provider: SRCloudProvider
  var encrypt: Bool
  var state: SRJobState = .waiting
  var session = SRSession()
  var sent: Int64 = 0
  var attempts = 0
  var verifyTries = 0
  var mismatches = 0
  var nextTry: Date?
  var lastError: String?
  var remote: SRRemote?
  var sealedPath: String?
  var uploadSize: Int64 = 0
  var hashes: SRHashes?
  var verifiedAt: Date?
  var keep: String?                 // why the local copy was kept, in words
  var addedAt: Date
  var uploadName: String { encrypt ? name + ".psrc" : name }
  var fraction: Double { uploadSize > 0 ? min(1, Double(sent) / Double(uploadSize)) : (state == .done ? 1 : 0) }
  var finished: Bool { state == .done || state == .unsure || state == .failed }
}
struct SRQueue: Codable, Equatable {
  var jobs: [SRJob] = []
  func job(_ id: String) -> SRJob? { jobs.first { $0.id == id } }
  /// The oldest job that may run now.
  func next(now: Date) -> Int? {
    jobs.indices.filter { [.waiting, .uploading, .verifying].contains(jobs[$0].state) && (jobs[$0].nextTry.map { $0 <= now } ?? true) }
      .min { jobs[$0].addedAt < jobs[$1].addedAt }
  }
  var active: [SRJob] { jobs.filter { [.waiting, .uploading, .verifying].contains($0.state) } }
  mutating func prune(keepFinished: Int = 20) {
    let fin = jobs.filter { $0.finished }.sorted { $0.addedAt > $1.addedAt }.prefix(keepFinished).map { $0.id }
    jobs.removeAll { $0.finished && !fin.contains($0.id) }
  }
}
enum SRTick: Equatable { case waiting(SRWaitReason), idle, ran(String, SRJobState) }

final class SRUploadEngine {
  var queue = SRQueue()
  var settings: () -> SRCloudSettings = { SRCloudSettings() }
  var env: () -> SREnv = { SREnv() }
  var now: () -> Date = { Date() }
  var uploader: (SRCloudProvider) -> SRUploader? = { _ in nil }
  var master: () throws -> Data = { throw SRSealError.wrongKey }
  var tempDir: URL = FileManager.default.temporaryDirectory
  var inUse: () -> Set<String> = { [] }
  var save: (SRQueue) -> Void = { _ in }
  var onProgress: (SRJob) -> Void = { _ in }
  var onVerified: (SRJob) -> Void = { _ in }
  var onLocalRemoved: (SRJob) -> Void = { _ in }
  var onFailed: (SRJob) -> Void = { _ in }
  static let verifyTriesMax = 12

  /// Add a finished recording. Never while it is the file being recorded (the caller only calls this after the recording ended).
  @discardableResult func enqueue(id: String, path: String, name: String, size: Int64, provider: SRCloudProvider, encrypt: Bool) -> Bool {
    guard provider != .none, size > 0, queue.job(id) == nil else { return false }
    queue.jobs.append(SRJob(id: id, path: path, name: srSafeName(name), size: size, provider: provider, encrypt: encrypt, addedAt: now()))
    save(queue)
    return true
  }
  /// Sign in worked again: jobs that waited for it go on.
  func signedIn() { for i in queue.jobs.indices where queue.jobs[i].state == .needsSignIn { queue.jobs[i].state = .uploading; queue.jobs[i].nextTry = nil; queue.jobs[i].lastError = nil }; save(queue) }
  /// A recording was deleted: its finished job goes too (a job still running is left to finish).
  func forget(_ id: String) { queue.jobs.removeAll { $0.id == id && $0.finished }; save(queue) }
  func retry(_ id: String) { if let i = queue.jobs.firstIndex(where: { $0.id == id && ($0.state == .failed || $0.state == .unsure) }) { queue.jobs[i].state = .uploading; queue.jobs[i].attempts = 0; queue.jobs[i].verifyTries = 0; queue.jobs[i].nextTry = nil; queue.jobs[i].lastError = nil; save(queue) } }

  /// One step: waits when the Mac says so, else runs the oldest due job. Blocking: call it off the main thread.
  @discardableResult func tick() -> SRTick {
    if let w = SRWait.reason(env()) { return .waiting(w) }
    guard let i = queue.next(now: now()) else { return .idle }
    let id = queue.jobs[i].id
    run(i)
    return .ran(id, queue.job(id)?.state ?? .failed)
  }

  private func update(_ i: Int, _ f: (inout SRJob) -> Void) { f(&queue.jobs[i]); save(queue) }

  private func run(_ i: Int) {
    var j = queue.jobs[i]
    let fm = FileManager.default
    let size = (try? fm.attributesOfItem(atPath: j.path)[.size] as? Int64) ?? nil
    guard let size, size == j.size else {
      update(i) { $0.state = .failed; $0.lastError = size == nil ? "The recording is not on this Mac any more." : "The recording changed, so PS did not upload it." }
      onFailed(queue.jobs[i]); return
    }
    guard let up = uploader(j.provider) else {
      update(i) { $0.state = .needsSignIn; $0.lastError = j.provider.usesFolder ? "Choose a folder in Settings to upload." : "Sign in to \(j.provider.label) to upload." }; return
    }
    if j.state != .verifying {
      do {
        let src = try source(&j)
        update(i) { $0 = j; $0.state = .uploading }
        let remote = try up.upload(src, session: &j.session, progress: { [self] sent in queue.jobs[i].sent = sent; onProgress(queue.jobs[i]) },
                                   shouldStop: { [self] in SRWait.reason(env()) != nil })
        update(i) { $0 = j; $0.remote = remote; $0.sent = $0.uploadSize; $0.state = .verifying; $0.verifyTries = 0; $0.lastError = nil }
        onProgress(queue.jobs[i])
      } catch let e as SRUpError { update(i) { $0.session = j.session }; handle(i, e); return }
      catch { handle(i, .transient(error.localizedDescription)); return }
    }
    verify(i, up)
  }

  /// The bytes to send: the recording, or its sealed copy (made once, opened again to prove it matches before anything is sent).
  private func source(_ j: inout SRJob) throws -> SRUploadSource {
    guard j.encrypt else { j.uploadSize = j.size; return SRUploadSource(url: URL(fileURLWithPath: j.path), size: j.size, name: j.uploadName) }
    let fm = FileManager.default
    if let p = j.sealedPath, fm.fileExists(atPath: p), let s = (try? fm.attributesOfItem(atPath: p)[.size] as? Int64) ?? nil, s == j.uploadSize, s > 0 {
      return SRUploadSource(url: URL(fileURLWithPath: p), size: s, name: j.uploadName)
    }
    let key: Data
    do { key = try master() } catch { throw SRUpError.fatal("PS cannot reach the key to seal this recording, so it was not uploaded.") }
    let sealed = tempDir.appendingPathComponent("\(j.id).psrc"), plain = tempDir.appendingPathComponent("\(j.id).check")
    try? fm.removeItem(at: sealed); try? fm.removeItem(at: plain)
    defer { try? fm.removeItem(at: plain) }
    do {
      let n = try SRSeal.seal(URL(fileURLWithPath: j.path), to: sealed, master: key)
      try SRSeal.open(sealed, to: plain, master: key)
      let a = try SRFileHash.compute(plain, kinds: [.sha256]), b = try SRFileHash.compute(URL(fileURLWithPath: j.path), kinds: [.sha256])
      guard a.sha256 == b.sha256, a.size == b.size else { try? fm.removeItem(at: sealed); throw SRUpError.fatal("The sealed copy did not open back to the same recording, so PS did not upload it.") }
      j.sealedPath = sealed.path; j.uploadSize = n; j.session = SRSession(); j.sent = 0
      return SRUploadSource(url: sealed, size: n, name: j.uploadName)
    } catch let e as SRUpError { throw e }
    catch { try? fm.removeItem(at: sealed); throw SRUpError.transient("Sealing the recording failed: \(error.localizedDescription)") }
  }

  private func verify(_ i: Int, _ up: SRUploader) {
    let j = queue.jobs[i]
    guard let remote = j.remote else { update(i) { $0.state = .uploading }; return }
    do {
      let url = URL(fileURLWithPath: j.encrypt ? (j.sealedPath ?? j.path) : j.path)
      let h = try SRFileHash.compute(url, kinds: up.needs)
      let c = try up.check(remote, local: h)
      switch c.verdict {
      case .verified:
        update(i) { $0.state = .done; $0.verifiedAt = now(); $0.hashes = h; $0.remote = c.remote ?? remote; $0.lastError = nil; $0.nextTry = nil }
        onVerified(queue.jobs[i])
        afterVerified(i)
      case .notYet(let why):
        if j.verifyTries + 1 >= Self.verifyTriesMax { update(i) { $0.state = .unsure; $0.lastError = why; $0.keep = SRKeep.unsure.words; $0.hashes = h } ; onFailed(queue.jobs[i]) }
        else { update(i) { $0.state = .verifying; $0.verifyTries += 1; $0.nextTry = now().addingTimeInterval(min(600, 30 * Double($0.verifyTries))); $0.lastError = why } }
      case .unsure(let why):
        update(i) { $0.state = .unsure; $0.lastError = why; $0.keep = SRKeep.unsure.words; $0.hashes = h; $0.remote = c.remote ?? remote }
        onFailed(queue.jobs[i])
      case .mismatch(let why):
        // not the same file: the local copy stays, the bad cloud copy is removed, and PS tries once more from the start
        try? up.remove(remote)
        if j.mismatches >= 1 { update(i) { $0.state = .failed; $0.lastError = why; $0.keep = SRKeep.mismatch.words; $0.remote = nil }; onFailed(queue.jobs[i]) }
        else { update(i) { $0.state = .uploading; $0.mismatches += 1; $0.remote = nil; $0.session = SRSession(); $0.sent = 0; $0.sealedPath = nil; $0.lastError = why; $0.nextTry = now().addingTimeInterval(30) } }
      }
    } catch let e as SRUpError { handle(i, e) } catch { handle(i, .transient(error.localizedDescription)) }
  }

  /// The local copy: removed only when the policy says so after a checked upload, else kept with the reason in words.
  private func afterVerified(_ i: Int) {
    let j = queue.jobs[i], fm = FileManager.default
    if let s = j.sealedPath { try? fm.removeItem(atPath: s) }     // the sealed temp copy is always safe to remove
    let local = (try? fm.attributesOfItem(atPath: j.path)[.size] as? Int64) ?? nil
    let st = settings()
    let facts = SRDeleteFacts(verdict: .verified, remoteSize: j.remote?.size, uploadedSize: j.uploadSize, localSizeNow: local, localSizeAtUpload: j.size, verifiedAt: j.verifiedAt, inUse: inUse().contains(j.id) || inUse().contains(j.path))
    switch SRDeletePolicy.decide(facts, removeAfter: st.removeAfter, keepDays: st.keepDays, now: now()) {
    case .delete:
      do { try fm.removeItem(atPath: j.path); update(i) { $0.keep = nil }; onLocalRemoved(queue.jobs[i]) } catch { update(i) { $0.keep = "Kept on this Mac: it could not be removed." } }
    case .keep(let why): update(i) { $0.keep = why.words }
    }
  }

  private func handle(_ i: Int, _ e: SRUpError) {
    switch e {
    case .stopped: update(i) { $0.nextTry = nil }
    case .sessionLost: update(i) { $0.attempts += 1; $0.session = SRSession(); $0.sent = 0; $0.nextTry = now(); $0.lastError = "The upload had to start again." }
    case .authLost(let m): update(i) { $0.state = .needsSignIn; $0.lastError = m }
    case .fatal(let m): update(i) { $0.state = .failed; $0.lastError = m; $0.keep = SRKeep.notChecked.words }; onFailed(queue.jobs[i])
    case .transient(let m):
      update(i) { $0.attempts += 1; $0.lastError = m
        if $0.attempts >= SRBackoff.giveUp { $0.state = .failed; $0.keep = SRKeep.notChecked.words } else { $0.nextTry = now().addingTimeInterval(SRBackoff.delay($0.attempts)) } }
      if queue.jobs[i].state == .failed { onFailed(queue.jobs[i]) }
    }
  }

  /// "Keep the last X days": local copies whose cloud copy was checked earlier and whose days are up. The cloud is asked again first
  /// (a quick size and checksum read, no re-hash of the cloud file by PS), and the local file must still be the one that was uploaded.
  @discardableResult func sweep(_ lib: SRLibrary) -> [String] {
    var removed: [String] = []
    for id in lib.removable(settings: settings(), now: now(), inUse: inUse()) {
      guard let r = lib.rec(id), let path = r.path, let c = r.cloud, c.verified else { continue }
      if let up = uploader(c.provider), c.provider.usesAPI {
        // ask the cloud again: the copy must still be there with the same size and checksum
        var h = SRHashes(); h.size = c.size
        switch c.hashKind { case .some(.md5): h.md5 = c.hash; case .some(.sha256): h.sha256 = c.hash; case .some(.dropbox): h.dropbox = c.hash; case .some(.quickXor): h.quickXor = c.hash; case .none: break }
        let remote = SRRemote(id: c.remoteId, name: c.remoteName, webURL: c.webURL, size: c.size)
        guard let chk = try? up.check(remote, local: h), chk.verdict == .verified else { continue }
      }
      if (try? FileManager.default.removeItem(atPath: path)) != nil { removed.append(id) }
    }
    return removed
  }
}
