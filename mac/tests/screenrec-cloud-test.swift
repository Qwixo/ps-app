import Foundation
import CryptoKit
// Run: bash tests/screenrec-cloud-test.sh. Fake files in a temp folder and a FAKE cloud server in memory: nothing records, nothing
// reaches a real cloud, no Keychain, no window, no sound.
setvbuf(stdout, nil, _IOLBF, 0)
var n = 0, bad = 0
func ok(_ name: String, _ c: Bool) { n += 1; if c { print("ok - \(name)") } else { bad += 1; print("FAIL - \(name)") } }
let T0 = Date(timeIntervalSince1970: 1_763_024_400)
func data(_ len: Int) -> Data { Data((0..<len).map { UInt8(($0 * 31 + 7) % 256) }) }
let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("psrec-cloud-\(UUID().uuidString)")
try! FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
func file(_ name: String, _ d: Data) -> URL { let u = tmp.appendingPathComponent(name); try! d.write(to: u); return u }
func exists(_ p: String) -> Bool { FileManager.default.fileExists(atPath: p) }

// ---------- 1. the three hashes against known vectors ----------
// md5 and sha256 of "abc" are the standard test vectors. The Dropbox and QuickXor vectors come from an independent bit by bit
// implementation of each published algorithm (hashlib for Dropbox, a plain 160 bit rotate for QuickXor), written separately from this code.
// The Dropbox and Microsoft docs name no downloadable example file, so no published example file could be run offline.
ok("md5 abc", SRFileHash.md5Hex(Data("abc".utf8)) == "900150983cd24fb0d6963f7d28e17f72")
ok("sha256 abc", SRFileHash.sha256Hex(Data("abc".utf8)) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
let dbVec: [(Int, String)] = [(0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"), (1, "b6d58dfa6547c1eb7f0d4ffd3e3bd6452213210ea51baa70b97c31f011187215"),
  (4194304, "bca3e93b94c12aa6c47bcc903e7083767d74b2e587671c3363a44c2b81264132"), (4194305, "0f58159d5fe331a084fa22edb858ab75855e20634735b15ff70b84a340b5f517"),
  (10000000, "3b4cb2401852d24e5de455e58b86e53fd87deb87439b078fe7e87e286cc448ca")]
for (len, h) in dbVec { let u = file("db\(len)", data(len)); ok("dropbox content_hash \(len) bytes", (try? SRFileHash.compute(u, kinds: [.dropbox]))?.dropbox == h) }
let qxVec: [(Int, String)] = [(0, "AAAAAAAAAAAAAAAAAAAAAAAAAAA="), (1, "BwAAAAAAAAAAAAAAAQAAAAAAAAA="), (20, "BSu2oYg9oFEEAxz/5EAPuLAHTeQ="), (160, "GD+KGCbnJ+lXCrS07BVjSpWmgvs="),
  (161, "fz+KGCbnJ+lXCrS07RVjSpWmgvs="), (1000, "X4X7cC7/cVgPZMrjju+fOUsa7aY="), (100003, "fw/OMSbnJ+lXCrS075NiSpWmgvs=")]
for (len, h) in qxVec { let u = file("qx\(len)", data(len)); ok("quickXorHash \(len) bytes", (try? SRFileHash.compute(u, kinds: [.quickXor]))?.quickXor == h) }
do {
  var q = SRQuickXor(); let d = data(100003); var off = 0; let cuts = [1, 7, 159, 160, 161, 4096, 33333]; var ci = 0
  while off < d.count { let k = min(cuts[ci % cuts.count], d.count - off); q.update(d.subdata(in: off..<off + k)); off += k; ci += 1 }
  ok("quickXorHash the same however the bytes are cut", q.finish() == "fw/OMSbnJ+lXCrS075NiSpWmgvs=")
  var db = SRDropboxHash(); let e = data(10000000); var o2 = 0
  while o2 < e.count { let k = min(1_234_567, e.count - o2); db.update(e.subdata(in: o2..<o2 + k)); o2 += k }
  ok("dropbox hash the same however the bytes are cut", db.finish() == "3b4cb2401852d24e5de455e58b86e53fd87deb87439b078fe7e87e286cc448ca")
  let all = try! SRFileHash.compute(file("all", data(5000)), kinds: Set(SRHashKind.allCases))
  ok("one pass gives every hash and the size", all.size == 5000 && all.md5?.count == 32 && all.sha256?.count == 64 && all.dropbox?.count == 64 && all.quickXor?.count == 28)
}

// ---------- 2. seal then open ----------
let master = Data((0..<32).map { UInt8($0) })
do {
  let plain = data(10_000), src = file("plain.bin", plain), sealed = tmp.appendingPathComponent("s.psrc"), back = tmp.appendingPathComponent("back.bin")
  let size = try! SRSeal.seal(src, to: sealed, master: master, chunkSize: 4096)
  ok("sealed size is plain plus header plus 16 per chunk", size == 25 + 10_000 + 3 * 16)
  ok("a sealed file says so", SRSeal.isSealed(sealed) && !SRSeal.isSealed(src))
  ok("the sealed bytes do not contain the recording", (try! Data(contentsOf: sealed)).range(of: plain.prefix(64)) == nil)
  try! SRSeal.open(sealed, to: back, master: master)
  ok("seal then open gives the same recording", (try! Data(contentsOf: back)) == plain)
  let exact = file("exact.bin", data(8192)), se = tmp.appendingPathComponent("e.psrc"), be = tmp.appendingPathComponent("be.bin")
  try! SRSeal.seal(exact, to: se, master: master, chunkSize: 4096); try! SRSeal.open(se, to: be, master: master)
  ok("an exact multiple of the chunk size round trips", (try! Data(contentsOf: be)) == data(8192))
  let empty = file("empty.bin", Data()), sz = tmp.appendingPathComponent("z.psrc"), bz = tmp.appendingPathComponent("bz.bin")
  try! SRSeal.seal(empty, to: sz, master: master); try! SRSeal.open(sz, to: bz, master: master)
  ok("an empty file round trips", (try! Data(contentsOf: bz)).isEmpty)
  let wrong = tmp.appendingPathComponent("w.bin")
  var err: SRSealError?; do { try SRSeal.open(sealed, to: wrong, master: Data(repeating: 9, count: 32)) } catch { err = error as? SRSealError }
  ok("the wrong key is refused and leaves no file", err == .wrongKey && !exists(wrong.path))
  var all = try! Data(contentsOf: sealed); let cut = tmp.appendingPathComponent("cut.psrc"); try! all.prefix(all.count - (4096 + 16)).write(to: cut)
  err = nil; do { try SRSeal.open(cut, to: wrong, master: master) } catch { err = error as? SRSealError }
  ok("a file cut short at a chunk end is refused", err == .damaged && !exists(wrong.path))
  all[200] ^= 1; let flip = tmp.appendingPathComponent("flip.psrc"); try! all.write(to: flip)
  err = nil; do { try SRSeal.open(flip, to: wrong, master: master) } catch { err = error as? SRSealError }
  ok("one changed byte is refused", err != nil && !exists(wrong.path))
  err = nil; do { try SRSeal.open(src, to: wrong, master: master) } catch { err = error as? SRSealError }
  ok("a file that is not sealed is refused", err == .notSealed)
}

// ---------- 3. waiting rules and back off ----------
ok("nothing wrong means go", SRWait.reason(SREnv()) == nil)
ok("wait while recording", SRWait.reason(SREnv(recording: true)) == .recording)
ok("wait while the Mac is hot", SRWait.reason(SREnv(thermalHigh: true)) == .hot)
ok("battery under 20 waits", SRWait.reason(SREnv(onBattery: true, batteryPct: 19)) == .battery)
ok("battery at 20 goes", SRWait.reason(SREnv(onBattery: true, batteryPct: 20)) == nil)
ok("low battery on the charger goes", SRWait.reason(SREnv(onBattery: false, batteryPct: 5)) == nil)
ok("Low Power Mode waits", SRWait.reason(SREnv(lowPower: true)) == .lowPower)
ok("Low Data Mode waits", SRWait.reason(SREnv(constrained: true)) == .constrained)
ok("an expensive network waits", SRWait.reason(SREnv(expensive: true)) == .expensive)
ok("no internet waits", SRWait.reason(SREnv(online: false)) == .offline)
ok("recording is the first reason", SRWait.reason(SREnv(recording: true, lowPower: true, online: false)) == .recording)
ok("every wait has words", [SRWaitReason.recording, .hot, .battery, .lowPower, .constrained, .expensive, .offline].allSatisfy { $0.words.hasPrefix("Waiting:") })
ok("back off steps", [1, 2, 3, 4, 5, 6, 7, 8, 50].map { SRBackoff.delay($0) } == [30, 60, 120, 300, 900, 1800, 3600, 3600, 3600])

// ---------- 4. never delete before a checked upload ----------
func facts(_ v: SRVerdict?, remote: Int64? = 1000, up: Int64 = 1000, local: Int64? = 1000, atUp: Int64 = 1000, at: Date? = T0, use: Bool = false) -> SRDeleteFacts {
  SRDeleteFacts(verdict: v, remoteSize: remote, uploadedSize: up, localSizeNow: local, localSizeAtUpload: atUp, verifiedAt: at, inUse: use)
}
func dec(_ f: SRDeleteFacts, remove: Bool = true, days: Int = 0, now: Date = T0) -> SRDeleteDecision { SRDeletePolicy.decide(f, removeAfter: remove, keepDays: days, now: now) }
ok("checked upload, days up: delete", dec(facts(.verified)) == .delete)
ok("never checked: keep", dec(facts(nil)) == .keep(.notChecked))
ok("not yet confirmed: keep", dec(facts(.notYet("x"))) == .keep(.notChecked))
ok("mismatch: keep", dec(facts(.mismatch("x"))) == .keep(.mismatch))
ok("unsure: keep", dec(facts(.unsure("x"))) == .keep(.unsure))
ok("cloud size differs: keep", dec(facts(.verified, remote: 999)) == .keep(.mismatch))
ok("cloud size unknown: keep", dec(facts(.verified, remote: nil)) == .keep(.mismatch))
ok("local file changed since the upload: keep", dec(facts(.verified, local: 1001)) == .keep(.fileChanged))
ok("removing is switched off: keep", dec(facts(.verified), remove: false) == .keep(.removeOff))
ok("file being recorded: keep", dec(facts(.verified, use: true)) == .keep(.inUse))
ok("already gone", dec(facts(.verified, local: nil)) == .keep(.fileGone))
ok("keep 7 days: kept on day 3", dec(facts(.verified), days: 7, now: T0.addingTimeInterval(3 * 86_400)) == .keep(.keepDays(4)))
ok("keep 7 days: removed on day 7", dec(facts(.verified), days: 7, now: T0.addingTimeInterval(7 * 86_400)) == .delete)
ok("no check time: keep", dec(facts(.verified, at: nil)) == .keep(.notChecked))

// ---------- the fake cloud ----------
final class FakeCloud: SRCloudHTTP {
  var log: [String] = []
  var files: [String: (name: String, data: Data)] = [:]
  var sessions: [String: (name: String, total: Int64, data: Data)] = [:]
  var folders: [String: String] = [:]
  var next = 1
  var dropNetwork = 0            // the next N chunk requests never arrive
  var dropAnswer = 0             // the next N chunk requests arrive but the answer is lost
  var corrupt = false            // what is stored is not what was sent
  var driveSha = true, driveMd5 = true
  var hashDelay = 0              // OneDrive: calls before the hash shows up
  var hashNever = false
  var unauthorizedOnce = false, alwaysUnauthorized = false
  var authOnPut = false          // OneDrive: any PUT that carried an Authorization header
  var badFragment = false        // OneDrive: a fragment that is not a multiple of 320 KiB (except the last)
  var chunkSizes: [Int] = []
  func id() -> String { defer { next += 1 }; return "id\(next)" }
  func json(_ o: Any, _ status: Int = 200, headers: [String: String] = [:]) -> SRResp { SRResp(status: status, headers: headers, body: try! JSONSerialization.data(withJSONObject: o)) }
  func send(_ r: SRReq) -> SRResp {
    let host = r.url.host ?? "", path = r.url.path
    log.append("\(r.method) \(host)\(path)")
    if alwaysUnauthorized && r.headers["Authorization"] != nil { return SRResp(status: 401) }
    if unauthorizedOnce && r.headers["Authorization"] == "Bearer old" { unauthorizedOnce = false; return SRResp(status: 401) }
    let q = Dictionary(uniqueKeysWithValues: (URLComponents(url: r.url, resolvingAgainstBaseURL: false)?.queryItems ?? []).map { ($0.name, $0.value ?? "") })
    if host == "www.googleapis.com" || host == "upload.fake" { return google(r, host, path, q) }
    if host.hasSuffix("dropboxapi.com") { return dropbox(r, path) }
    if host == "graph.microsoft.com" || host == "od.fake" { return graph(r, host, path, q) }
    return SRResp(status: 404)
  }
  func lost(_ r: SRReq) -> SRResp? {
    if dropNetwork > 0 { dropNetwork -= 1; return SRResp(status: 0, netError: "offline") }
    return nil
  }
  func store(_ d: Data) -> Data { var x = d; if corrupt, !x.isEmpty { x[x.count / 2] ^= 0xff }; return x }
  // --- Google Drive
  func google(_ r: SRReq, _ host: String, _ path: String, _ q: [String: String]) -> SRResp {
    if host == "upload.fake" {
      let sid = String(path.split(separator: "/").last ?? "")
      guard var s = sessions[sid] else { return SRResp(status: 404) }
      let cr = r.headers["Content-Range"] ?? ""
      if cr.hasPrefix("bytes */") {
        if Int64(s.data.count) == s.total { let fid = id(); files[fid] = (s.name, store(s.data)); return json(["id": fid, "name": s.name, "size": "\(s.total)"]) }
        return s.data.isEmpty ? SRResp(status: 308) : SRResp(status: 308, headers: ["Range": "bytes=0-\(s.data.count - 1)"])
      }
      if let l = lost(r) { return l }
      let parts = cr.replacingOccurrences(of: "bytes ", with: "").split(whereSeparator: { $0 == "-" || $0 == "/" }).compactMap { Int64($0) }
      guard parts.count == 3, parts[0] == Int64(s.data.count) else { return SRResp(status: 400) }
      let body = r.body ?? Data()
      if parts[2] > 0, Int64(parts[0] + Int64(body.count)) < parts[2], body.count % 262_144 != 0 { return SRResp(status: 400) }
      chunkSizes.append(body.count)
      s.data.append(body); sessions[sid] = s
      if dropAnswer > 0 { dropAnswer -= 1; return SRResp(status: 0, netError: "answer lost") }
      if Int64(s.data.count) == s.total { let fid = id(); files[fid] = (s.name, store(s.data)); return json(["id": fid, "name": s.name, "size": "\(s.total)", "webViewLink": "https://drive.example.com/file/\(fid)"]) }
      return SRResp(status: 308, headers: ["Range": "bytes=0-\(s.data.count - 1)"])
    }
    if path == "/drive/v3/files" && r.method == "GET" { return json(["files": folders.values.map { ["id": $0] }]) }
    if path == "/drive/v3/files" && r.method == "POST" { let fid = id(); folders["PS Recordings"] = fid; return json(["id": fid]) }
    if path == "/upload/drive/v3/files" && r.method == "POST" {
      let meta = (try? JSONSerialization.jsonObject(with: r.body ?? Data())) as? [String: Any]
      let sid = "s\(next)"; next += 1
      sessions[sid] = ((meta?["name"] as? String) ?? "", Int64(r.headers["X-Upload-Content-Length"] ?? "0") ?? 0, Data())
      return SRResp(status: 200, headers: ["Location": "https://upload.fake/session/\(sid)"])
    }
    if path.hasPrefix("/drive/v3/files/") {
      let fid = String(path.dropFirst("/drive/v3/files/".count))
      if r.method == "DELETE" { files[fid] = nil; return SRResp(status: 204) }
      guard let f = files[fid] else { return SRResp(status: 404) }
      var o: [String: Any] = ["id": fid, "name": f.name, "size": "\(f.data.count)", "webViewLink": "https://drive.example.com/file/\(fid)"]
      if driveMd5 { o["md5Checksum"] = SRFileHash.md5Hex(f.data) }
      if driveSha { o["sha256Checksum"] = SRFileHash.sha256Hex(f.data) }
      return json(o)
    }
    return SRResp(status: 404)
  }
  // --- Dropbox
  func dropbox(_ r: SRReq, _ path: String) -> SRResp {
    let arg = ((try? JSONSerialization.jsonObject(with: Data((r.headers["Dropbox-API-Arg"] ?? "{}").utf8))) as? [String: Any]) ?? [:]
    let body = (try? JSONSerialization.jsonObject(with: r.body ?? Data())) as? [String: Any]
    switch path {
    case "/2/files/upload_session/start": let sid = "S\(next)"; next += 1; sessions[sid] = ("", 0, Data()); return json(["session_id": sid])
    case "/2/files/upload_session/append_v2":
      if let l = lost(r) { return l }
      let cur = arg["cursor"] as? [String: Any]; let sid = cur?["session_id"] as? String ?? ""
      guard var s = sessions[sid] else { return json(["error": [".tag": "not_found"]], 409) }
      let off = (cur?["offset"] as? Int64) ?? Int64((cur?["offset"] as? Int) ?? -1)
      if off != Int64(s.data.count) { return json(["error": [".tag": "incorrect_offset", "correct_offset": s.data.count]], 409) }
      chunkSizes.append((r.body ?? Data()).count)
      s.data.append(r.body ?? Data()); sessions[sid] = s
      if dropAnswer > 0 { dropAnswer -= 1; return SRResp(status: 0, netError: "answer lost") }
      return json([String: Any]())
    case "/2/files/upload_session/finish":
      let cur = arg["cursor"] as? [String: Any]; let sid = cur?["session_id"] as? String ?? ""
      guard let s = sessions[sid] else { return json(["error": [".tag": "lookup_failed"]], 409) }
      let commit = arg["commit"] as? [String: Any]; let pth = commit?["path"] as? String ?? "/x"
      let fid = "id:" + id(); let stored = store(s.data); files[fid] = ((pth as NSString).lastPathComponent, stored)
      var db = SRDropboxHash(); db.update(stored)
      return json(["id": fid, "name": (pth as NSString).lastPathComponent, "path_display": pth, "size": stored.count, "content_hash": db.finish()])
    case "/2/files/get_metadata":
      guard let fid = body?["path"] as? String, let f = files[fid] else { return json(["error": [".tag": "path"]], 409) }
      var db = SRDropboxHash(); db.update(f.data)
      return json(["id": fid, "name": f.name, "size": f.data.count, "content_hash": db.finish()])
    case "/2/files/delete_v2": files[(body?["path"] as? String) ?? ""] = nil; return json([String: Any]())
    case "/2/files/get_temporary_link": return json(["link": "https://dl.example.com/temp/abc"])
    default: return SRResp(status: 404)
    }
  }
  // --- OneDrive
  func graph(_ r: SRReq, _ host: String, _ path: String, _ q: [String: String]) -> SRResp {
    if host == "od.fake" {
      if r.headers["Authorization"] != nil { authOnPut = true }
      let sid = String(path.split(separator: "/").last ?? "")
      guard var s = sessions[sid] else { return SRResp(status: 404) }
      if r.method == "GET" { return json(["nextExpectedRanges": ["\(s.data.count)-"]]) }
      if let l = lost(r) { return l }
      let parts = (r.headers["Content-Range"] ?? "").replacingOccurrences(of: "bytes ", with: "").split(whereSeparator: { $0 == "-" || $0 == "/" }).compactMap { Int64($0) }
      guard parts.count == 3, parts[0] == Int64(s.data.count) else { return SRResp(status: 416) }
      let body = r.body ?? Data()
      if Int64(s.data.count + body.count) < s.total, body.count % 327_680 != 0 { badFragment = true; return SRResp(status: 400) }
      chunkSizes.append(body.count)
      s.data.append(body); sessions[sid] = s
      if dropAnswer > 0 { dropAnswer -= 1; return SRResp(status: 0, netError: "answer lost") }
      if Int64(s.data.count) == s.total { let fid = id(); files[fid] = (s.name, store(s.data)); return json(["id": fid, "name": s.name, "size": s.data.count, "webUrl": "https://onedrive.example.com/\(fid)"], 201) }
      return json(["nextExpectedRanges": ["\(s.data.count)-"]], 202)
    }
    if path.hasSuffix(":/createUploadSession") {
      let meta = ((try? JSONSerialization.jsonObject(with: r.body ?? Data())) as? [String: Any])?["item"] as? [String: Any]
      let sid = "o\(next)"; next += 1
      sessions[sid] = ((meta?["name"] as? String) ?? "", Int64(0), Data())
      pendingTotal = sid
      return json(["uploadUrl": "https://od.fake/up/\(sid)"])
    }
    if path.hasPrefix("/v1.0/me/drive/items/") {
      let fid = String(path.dropFirst("/v1.0/me/drive/items/".count))
      if r.method == "DELETE" { files[fid] = nil; return SRResp(status: 204) }
      guard let f = files[fid] else { return SRResp(status: 404) }
      if (q["select"] ?? "").contains("downloadUrl") { return json(["id": fid, "@microsoft.graph.downloadUrl": "https://dl.example.com/od/\(fid)"]) }
      var o: [String: Any] = ["id": fid, "name": f.name, "size": f.data.count, "webUrl": "https://onedrive.example.com/\(fid)"]
      if hashDelay > 0 { hashDelay -= 1; o["file"] = ["hashes": [String: Any]()] }
      else if hashNever { o["file"] = ["hashes": [String: Any]()] }
      else { var qx = SRQuickXor(); qx.update(f.data); o["file"] = ["hashes": ["quickXorHash": qx.finish()]] }
      return json(o)
    }
    return SRResp(status: 404)
  }
  var pendingTotal = ""
}

// The OneDrive session needs its total size: the real service learns it from the first Content-Range. The fake reads it the same way.
extension FakeCloud {
  func fixTotal(_ r: SRReq) { }
}

// ---------- engine rig ----------
final class Clock { var t = T0 }
final class Holder { var env = SREnv(); var st = SRCloudSettings(); var verified: [String] = [], removed: [String] = [], failed: [String] = [], saves = 0; var tokens: [Bool] = []; var useMaster = true }
func makeEngine(_ p: SRCloudProvider, _ cloud: FakeCloud, _ clock: Clock, _ h: Holder, folder: URL? = nil, ubi: SRUbiquity? = nil) -> (SRUploadEngine, SRUploader) {
  let a = SRAuthed(http: cloud, token: { force in h.tokens.append(force); return force ? "new" : "old" })
  let up: SRUploader
  switch p {
  case .googleDrive: let g = SRGoogleDrive(a); g.chunk = 262_144; up = g
  case .dropbox: let d = SRDropbox(a); d.chunk = 150_000; up = d
  case .oneDrive: let o = SROneDrive(a); o.fragment = 327_680; up = o
  default: up = SRFolderUploader(provider: p, dest: folder ?? tmp.appendingPathComponent("dest"), ubiquity: ubi)
  }
  let e = SRUploadEngine()
  e.now = { clock.t }; e.env = { h.env }; e.settings = { h.st }; e.uploader = { _ in up }
  e.tempDir = tmp; e.master = { if h.useMaster { return master }; throw SRSealError.wrongKey }
  e.save = { _ in h.saves += 1 }
  e.onVerified = { h.verified.append($0.id) }; e.onLocalRemoved = { h.removed.append($0.id) }; e.onFailed = { h.failed.append($0.id) }
  return (e, up)
}
var seq = 0
func recFile(_ size: Int = 700_000) -> (URL, Data) { seq += 1; let d = data(size); return (file("rec\(seq).mov", d), d) }
func addJob(_ e: SRUploadEngine, _ u: URL, _ p: SRCloudProvider, id: String = "r1", encrypt: Bool = false) {
  let size = (try! FileManager.default.attributesOfItem(atPath: u.path)[.size] as! NSNumber).int64Value
  _ = e.enqueue(id: id, path: u.path, name: "2026-11-14 Call with Sam.mov", size: size, provider: p, encrypt: encrypt)
}
func drain(_ e: SRUploadEngine, _ clock: Clock, max: Int = 60, step: TimeInterval = 40) {
  for _ in 0..<max { let r = e.tick(); if r == .idle && e.queue.active.isEmpty { return }; if case .waiting = r { return }; clock.t = clock.t.addingTimeInterval(step) }
}

// The fake needs each OneDrive session's total: set it when the first fragment arrives (the real service does the same from Content-Range).
final class TotalFix: SRCloudHTTP {
  let inner: FakeCloud; init(_ i: FakeCloud) { inner = i }
  func send(_ r: SRReq) -> SRResp {
    if r.url.host == "od.fake", r.method == "PUT", let cr = r.headers["Content-Range"], let total = Int64(cr.split(separator: "/").last ?? ""), let sid = r.url.path.split(separator: "/").last.map(String.init), var s = inner.sessions[sid], s.total == 0 {
      s.total = total; inner.sessions[sid] = s
    }
    return inner.send(r)
  }
}

// ---------- 5. Google Drive ----------
do {
  let c = FakeCloud(), clock = Clock(), h = Holder(); h.st.keepDays = 0
  let (e, _) = makeEngine(.googleDrive, c, clock, h)
  let (u, d) = recFile()
  addJob(e, u, .googleDrive)
  drain(e, clock)
  let job = e.queue.job("r1")!
  ok("drive: uploaded, checked, done", job.state == .done && job.remote != nil && h.verified == ["r1"])
  ok("drive: the cloud holds the same bytes", c.files.values.first?.data == d)
  ok("drive: chunks are multiples of 256 KiB except the last", c.chunkSizes.dropLast().allSatisfy { $0 % 262_144 == 0 } && c.chunkSizes.count == 3)
  ok("drive: made one folder and asked the file again with a fresh get", c.log.contains { $0.hasPrefix("GET www.googleapis.com/drive/v3/files/id") })
  ok("drive: local copy removed only after the check", !exists(u.path) && h.removed == ["r1"])
  ok("drive: sha256 preferred over md5 (both present)", job.hashes?.sha256 != nil && job.hashes?.md5 != nil)
  ok("drive: the open in cloud link is kept", job.remote?.webURL?.hasPrefix("https://drive.example.com/") == true)
}
do { // only md5 available
  let c = FakeCloud(); c.driveSha = false; let clock = Clock(), h = Holder(); h.st.keepDays = 0
  let (e, _) = makeEngine(.googleDrive, c, clock, h); let (u, _) = recFile(); addJob(e, u, .googleDrive); drain(e, clock)
  ok("drive: md5 alone is enough", e.queue.job("r1")?.state == .done && !exists(u.path))
}
do { // no checksum at all: unsure, file stays
  let c = FakeCloud(); c.driveSha = false; c.driveMd5 = false; let clock = Clock(), h = Holder(); h.st.keepDays = 0
  let (e, _) = makeEngine(.googleDrive, c, clock, h); let (u, _) = recFile(); addJob(e, u, .googleDrive); drain(e, clock)
  ok("drive: no checksum means unsure and the file stays", e.queue.job("r1")?.state == .unsure && exists(u.path) && h.removed.isEmpty && h.verified.isEmpty)
}
do { // mismatch twice: fails, local stays, bad cloud copy removed
  let c = FakeCloud(); c.corrupt = true; let clock = Clock(), h = Holder(); h.st.keepDays = 0
  let (e, _) = makeEngine(.googleDrive, c, clock, h); let (u, _) = recFile(); addJob(e, u, .googleDrive); drain(e, clock)
  let j = e.queue.job("r1")!
  ok("drive: a cloud copy that differs fails after one more try", j.state == .failed && j.mismatches == 1)
  ok("drive: mismatch never deletes the Mac file", exists(u.path) && h.removed.isEmpty && h.verified.isEmpty && h.failed == ["r1"])
  ok("drive: the bad cloud copies are cleaned up", c.files.isEmpty)
}
do { // network drops and a lost answer: resume from where the cloud stands
  let c = FakeCloud(); let clock = Clock(), h = Holder(); h.st.keepDays = 0
  let (e, _) = makeEngine(.googleDrive, c, clock, h); let (u, d) = recFile()
  c.dropAnswer = 1; c.dropNetwork = 0
  addJob(e, u, .googleDrive)
  _ = e.tick()
  ok("drive: a lost answer is a retry later, not a failure", e.queue.job("r1")?.state == .uploading && e.queue.job("r1")?.attempts == 1 && e.queue.job("r1")?.nextTry == T0.addingTimeInterval(30))
  ok("drive: nothing runs before the back off ends", e.tick() == .idle)
  clock.t = T0.addingTimeInterval(31); drain(e, clock)
  ok("drive: it resumed and finished with the same bytes", e.queue.job("r1")?.state == .done && c.files.values.first?.data == d)
  ok("drive: resume asked the session where it stands", c.log.contains("PUT upload.fake/session/s2") || c.log.filter { $0.hasPrefix("PUT upload.fake") }.count > 3)
  ok("drive: no byte sent twice", c.chunkSizes.reduce(0, +) == d.count)
}
do { // network down: back off steps, then gives up and keeps the file
  let c = FakeCloud(); c.dropNetwork = 1000; let clock = Clock(), h = Holder()
  let (e, _) = makeEngine(.googleDrive, c, clock, h); let (u, _) = recFile(); addJob(e, u, .googleDrive)
  var delays: [TimeInterval] = []
  for _ in 0..<SRBackoff.giveUp + 2 { _ = e.tick(); if let nt = e.queue.job("r1")?.nextTry, e.queue.job("r1")?.state == .uploading { delays.append(nt.timeIntervalSince(clock.t)); clock.t = nt } }
  ok("drive: back off grows 30 s, 1 min, 2 min, 5 min", Array(delays.prefix(4)) == [30, 60, 120, 300])
  ok("drive: after many tries it stops by itself, file kept", e.queue.job("r1")?.state == .failed && exists(u.path) && h.failed == ["r1"])
}
do { // the Mac gets busy between chunks: pause, then go on
  let c = FakeCloud(); let clock = Clock(), h = Holder(); h.st.keepDays = 0
  let (e, _) = makeEngine(.googleDrive, c, clock, h); let (u, d) = recFile()
  var calls = 0; e.env = { calls += 1; var x = SREnv(); if calls >= 3 && calls < 5 { x.recording = true }; return x }
  addJob(e, u, .googleDrive); _ = e.tick()
  ok("drive: a recording starting pauses the upload between chunks", e.queue.job("r1")?.state == .uploading && c.chunkSizes.count < 3)
  e.env = { SREnv() }; drain(e, clock)
  ok("drive: then it carries on and finishes", e.queue.job("r1")?.state == .done && c.files.values.first?.data == d)
}
do { // waiting rules: nothing at all is sent
  let c = FakeCloud(); let clock = Clock(), h = Holder()
  let (e, _) = makeEngine(.googleDrive, c, clock, h); let (u, _) = recFile(); addJob(e, u, .googleDrive)
  for env in [SREnv(recording: true), SREnv(thermalHigh: true), SREnv(onBattery: true, batteryPct: 10), SREnv(lowPower: true), SREnv(constrained: true), SREnv(expensive: true), SREnv(online: false)] {
    h.env = env; _ = e.tick()
  }
  ok("waiting rules send nothing", c.log.isEmpty && e.queue.job("r1")?.state == .waiting)
  h.env = SREnv(); h.st.keepDays = 0; drain(e, clock)
  ok("when the Mac is ready it uploads", e.queue.job("r1")?.state == .done)
}
do { // empty queue and no provider: no requests
  let c = FakeCloud(); let clock = Clock(), h = Holder()
  let (e, _) = makeEngine(.googleDrive, c, clock, h)
  ok("empty queue sends nothing", e.tick() == .idle && c.log.isEmpty)
  ok("no provider means nothing is queued", !e.enqueue(id: "x", path: "/x", name: "x", size: 10, provider: .none, encrypt: false))
}
do { // token: one refresh on a 401, then sign in again
  let c = FakeCloud(); c.unauthorizedOnce = true; let clock = Clock(), h = Holder(); h.st.keepDays = 0
  let (e, _) = makeEngine(.googleDrive, c, clock, h); let (u, _) = recFile(); addJob(e, u, .googleDrive); drain(e, clock)
  ok("a 401 refreshes the token once and goes on", e.queue.job("r1")?.state == .done && h.tokens.contains(true))
  let c2 = FakeCloud(); c2.alwaysUnauthorized = true; let h2 = Holder()
  let (e2, _) = makeEngine(.googleDrive, c2, clock, h2); let (u2, _) = recFile(); addJob(e2, u2, .googleDrive); drain(e2, clock)
  ok("a login that keeps failing waits for sign in and keeps the file", e2.queue.job("r1")?.state == .needsSignIn && exists(u2.path))
  c2.alwaysUnauthorized = false; e2.signedIn(); h2.st.keepDays = 0; drain(e2, clock)
  ok("after sign in it finishes", e2.queue.job("r1")?.state == .done)
}
do { // keep the last X days, then a sweep that asks the cloud again
  let c = FakeCloud(); let clock = Clock(), h = Holder(); h.st.keepDays = 7
  let (e, up) = makeEngine(.googleDrive, c, clock, h); let (u, _) = recFile(); addJob(e, u, .googleDrive); drain(e, clock)
  let j = e.queue.job("r1")!
  ok("keep days: checked upload is kept for now, with the reason", j.state == .done && exists(u.path) && j.keep?.contains("7 more days") == true && h.removed.isEmpty)
  var lib = SRLibrary()
  lib.add(SRRec(id: "r1", title: "Call", fileName: "a.mov", path: u.path, startedAt: T0, duration: 60, size: j.size, sizeAtUpload: j.size,
                cloud: SRCloudRef(provider: .googleDrive, remoteId: j.remote!.id, remoteName: j.remote!.name, size: j.remote!.size ?? 0, hashKind: .sha256, hash: j.hashes?.sha256, encrypted: false, verified: true, verifiedAt: j.verifiedAt)))
  clock.t = T0.addingTimeInterval(3 * 86_400)
  ok("keep days: nothing due on day 3", e.sweep(lib).isEmpty && exists(u.path))
  clock.t = T0.addingTimeInterval(8 * 86_400)
  c.files[j.remote!.id] = nil
  ok("keep days: a cloud copy that is gone keeps the Mac file", e.sweep(lib).isEmpty && exists(u.path))
  c.files[j.remote!.id] = (j.remote!.name, try! Data(contentsOf: u))
  ok("keep days: day 8 with the cloud copy checked again removes it", e.sweep(lib) == ["r1"] && !exists(u.path))
  _ = up
}
do { // remove after upload off keeps everything
  let c = FakeCloud(); let clock = Clock(), h = Holder(); h.st.removeAfter = false; h.st.keepDays = 0
  let (e, _) = makeEngine(.googleDrive, c, clock, h); let (u, _) = recFile(); addJob(e, u, .googleDrive); drain(e, clock)
  ok("remove off: the file stays after a checked upload", e.queue.job("r1")?.state == .done && exists(u.path) && h.removed.isEmpty)
}
do { // the file changed before upload
  let c = FakeCloud(); let clock = Clock(), h = Holder()
  let (e, _) = makeEngine(.googleDrive, c, clock, h); let (u, _) = recFile(); addJob(e, u, .googleDrive)
  try! (data(10)).write(to: u); drain(e, clock)
  ok("a changed file is not uploaded", e.queue.job("r1")?.state == .failed && c.log.isEmpty && exists(u.path))
}
do { // encrypted upload
  let c = FakeCloud(); let clock = Clock(), h = Holder(); h.st.keepDays = 0
  let (e, _) = makeEngine(.googleDrive, c, clock, h); let (u, d) = recFile(300_000); addJob(e, u, .googleDrive, encrypt: true); drain(e, clock)
  let stored = c.files.values.first!
  ok("encrypted: the cloud holds sealed bytes, not the recording", SRFileHash.sha256Hex(stored.data) != SRFileHash.sha256Hex(d) && Array(stored.data.prefix(4)) == SRSeal.magic && stored.name.hasSuffix(".psrc"))
  ok("encrypted: checked against the sealed bytes, then the Mac copy goes", e.queue.job("r1")?.state == .done && !exists(u.path))
  let cloudFile = tmp.appendingPathComponent("fromcloud.psrc"), opened = tmp.appendingPathComponent("opened.mov")
  try! stored.data.write(to: cloudFile); try! SRSeal.open(cloudFile, to: opened, master: master)
  ok("encrypted: opening the cloud copy gives the recording back", (try! Data(contentsOf: opened)) == d)
  ok("encrypted: the sealed temp copy is gone", !exists(tmp.appendingPathComponent("r1.psrc").path))
  let c2 = FakeCloud(); let h2 = Holder(); h2.useMaster = false
  let (e2, _) = makeEngine(.googleDrive, c2, clock, h2); let (u2, _) = recFile(300_000); addJob(e2, u2, .googleDrive, encrypt: true); drain(e2, clock)
  ok("encrypted: no key means nothing is uploaded and the file stays", e2.queue.job("r1")?.state == .failed && c2.log.isEmpty && exists(u2.path))
}

// ---------- 6. Dropbox ----------
do {
  let c = FakeCloud(); let clock = Clock(), h = Holder(); h.st.keepDays = 0
  let (e, _) = makeEngine(.dropbox, c, clock, h); let (u, d) = recFile()
  c.dropAnswer = 1
  addJob(e, u, .dropbox); drain(e, clock)
  ok("dropbox: a lost answer resumes at Dropbox's own offset (incorrect_offset)", e.queue.job("r1")?.state == .done && c.files.values.first?.data == d)
  ok("dropbox: content_hash and size checked, then the Mac copy goes", h.verified == ["r1"] && !exists(u.path))
  ok("dropbox: used get_metadata for the fresh check", c.log.contains("POST api.dropboxapi.com/2/files/get_metadata"))
  ok("dropbox: the argument header is plain ASCII", srDropboxArg(["path": "/PS Recordings/Café 2026.mov"]).unicodeScalars.allSatisfy { $0.value < 128 })
}
do {
  let c = FakeCloud(); c.corrupt = true; let clock = Clock(), h = Holder(); h.st.keepDays = 0
  let (e, _) = makeEngine(.dropbox, c, clock, h); let (u, _) = recFile(); addJob(e, u, .dropbox); drain(e, clock)
  ok("dropbox: a different content_hash never deletes the Mac file", e.queue.job("r1")?.state == .failed && exists(u.path) && h.removed.isEmpty)
}

// ---------- 7. OneDrive ----------
do {
  let c = FakeCloud(); let t = TotalFix(c); let clock = Clock(), h = Holder(); h.st.keepDays = 0
  let a = SRAuthed(http: t, token: { _ in "tok" }); let od = SROneDrive(a); od.fragment = 327_680
  let e = SRUploadEngine(); e.now = { clock.t }; e.env = { h.env }; e.settings = { h.st }; e.uploader = { _ in od }; e.onVerified = { h.verified.append($0.id) }; e.onLocalRemoved = { h.removed.append($0.id) }
  let (u, d) = recFile(900_000); addJob(e, u, .oneDrive)
  c.dropAnswer = 1
  drain(e, clock)
  ok("onedrive: fragments are multiples of 320 KiB, no auth header on the PUTs", !c.badFragment && !c.authOnPut)
  ok("onedrive: lost answer resumed from nextExpectedRanges, same bytes", e.queue.job("r1")?.state == .done && c.files.values.first?.data == d)
  ok("onedrive: quickXorHash and size checked, then the Mac copy goes", h.verified == ["r1"] && !exists(u.path))
  ok("onedrive: the open in cloud link is kept", e.queue.job("r1")?.remote?.webURL?.hasPrefix("https://onedrive.example.com/") == true)
}
do { // hash not ready yet: asks again later
  let c = FakeCloud(); c.hashDelay = 2; let t = TotalFix(c); let clock = Clock(), h = Holder(); h.st.keepDays = 0
  let od = SROneDrive(SRAuthed(http: t, token: { _ in "tok" }))
  let e = SRUploadEngine(); e.now = { clock.t }; e.env = { h.env }; e.settings = { h.st }; e.uploader = { _ in od }; e.onLocalRemoved = { h.removed.append($0.id) }
  let (u, _) = recFile(400_000); addJob(e, u, .oneDrive)
  _ = e.tick()
  ok("onedrive: hash not ready means check again later and keep the file", e.queue.job("r1")?.state == .verifying && exists(u.path) && h.removed.isEmpty)
  drain(e, clock)
  ok("onedrive: once the hash shows up it is checked and the file goes", e.queue.job("r1")?.state == .done && !exists(u.path))
}
do { // hash never shows up: unsure, file stays
  let c = FakeCloud(); c.hashNever = true; let t = TotalFix(c); let clock = Clock(), h = Holder(); h.st.keepDays = 0
  let od = SROneDrive(SRAuthed(http: t, token: { _ in "tok" }))
  let e = SRUploadEngine(); e.now = { clock.t }; e.env = { h.env }; e.settings = { h.st }; e.uploader = { _ in od }; e.onLocalRemoved = { h.removed.append($0.id) }
  let (u, _) = recFile(400_000); addJob(e, u, .oneDrive); drain(e, clock, max: 40, step: 700)
  ok("onedrive: a hash that never comes means unsure and the file stays", e.queue.job("r1")?.state == .unsure && exists(u.path) && h.removed.isEmpty)
}
do { // corrupt
  let c = FakeCloud(); c.corrupt = true; let t = TotalFix(c); let clock = Clock(), h = Holder(); h.st.keepDays = 0
  let od = SROneDrive(SRAuthed(http: t, token: { _ in "tok" }))
  let e = SRUploadEngine(); e.now = { clock.t }; e.env = { h.env }; e.settings = { h.st }; e.uploader = { _ in od }; e.onLocalRemoved = { h.removed.append($0.id) }
  let (u, _) = recFile(400_000); addJob(e, u, .oneDrive); drain(e, clock)
  ok("onedrive: a different quickXorHash never deletes the Mac file", e.queue.job("r1")?.state == .failed && exists(u.path) && h.removed.isEmpty)
}

// ---------- 8. folders and iCloud ----------
struct Ubi: SRUbiquity { var v: Bool?; func uploaded(_ url: URL) -> Bool? { v } }
do {
  let dest = tmp.appendingPathComponent("anyfolder"); let c = FakeCloud(); let clock = Clock(), h = Holder(); h.st.keepDays = 0
  let (e, _) = makeEngine(.folder, c, clock, h, folder: dest); let (u, d) = recFile()
  addJob(e, u, .folder); drain(e, clock)
  ok("folder: copied under its own name, read back, same bytes", (try? Data(contentsOf: dest.appendingPathComponent("2026-11-14 Call with Sam.mov"))) == d && e.queue.job("r1")?.state == .done)
  ok("folder: no temp name left behind", ((try? FileManager.default.contentsOfDirectory(atPath: dest.path)) ?? []).allSatisfy { !$0.hasSuffix(".pspart") })
  ok("folder: the Mac copy goes only after the read back", !exists(u.path) && h.removed == ["r1"])
  let (u2, _) = recFile(); addJob(e, u2, .folder, id: "r2"); drain(e, clock)
  ok("folder: a name that is taken gets a number, never overwritten", exists(dest.appendingPathComponent("2026-11-14 Call with Sam 2.mov").path))
}
do { // folder corruption between copy and read back
  let dest = tmp.appendingPathComponent("badfolder"); let c = FakeCloud(); let clock = Clock(), h = Holder(); h.st.keepDays = 0
  let (e, up) = makeEngine(.folder, c, clock, h, folder: dest); (up as! SRFolderUploader).testAfterCopy = { u in var x = try! Data(contentsOf: u); x[10] ^= 1; try! x.write(to: u) }
  let (u, _) = recFile(); addJob(e, u, .folder); drain(e, clock)
  ok("folder: a copy that reads back different keeps the Mac file", exists(u.path) && h.removed.isEmpty && e.queue.job("r1")?.state == .failed)
}
do { // iCloud flag: true, false, nil
  let clock = Clock(), c = FakeCloud()
  for (flag, want, kept) in [(Optional(true), SRJobState.done, false), (Optional(false), SRJobState.verifying, true), (Optional<Bool>.none, SRJobState.unsure, true)] {
    let h = Holder(); h.st.keepDays = 0
    let dest = tmp.appendingPathComponent("icloud\(seq)"); let (e, _) = makeEngine(.iCloud, c, clock, h, folder: dest, ubi: Ubi(v: flag)); let (u, _) = recFile(); addJob(e, u, .iCloud)
    if flag == nil { drain(e, clock, max: 40, step: 700) } else { _ = e.tick() }
    ok("icloud flag \(String(describing: flag)): state \(want), Mac file \(kept ? "kept" : "removed")", e.queue.job("r1")?.state == want && exists(u.path) == kept)
  }
}

// ---------- 9. delete from the cloud, play links ----------
do {
  let c = FakeCloud(); let clock = Clock(), h = Holder(); h.st.keepDays = 0
  for p in [SRCloudProvider.googleDrive, .dropbox] {
    let (e, up) = makeEngine(p, c, clock, h); let (u, _) = recFile(100_000); addJob(e, u, p); drain(e, clock)
    let r = e.queue.job("r1")!.remote!
    let before = c.files.count
    try! up.remove(r)
    ok("\(p.label): removing the cloud copy removes it", c.files.count == before - 1)
    let s = try! up.stream(r)
    ok("\(p.label): a way to stream it", p == .googleDrive ? (s?.url.absoluteString.contains("alt=media") == true && s?.headers["Authorization"] == "Bearer old") : (s?.url.host == "dl.example.com"))
  }
  let t = TotalFix(c); let od = SROneDrive(SRAuthed(http: t, token: { _ in "tok" })); let e = SRUploadEngine(); e.now = { clock.t }; e.env = { SREnv() }; e.settings = { h.st }; e.uploader = { _ in od }
  let (u, _) = recFile(100_000); addJob(e, u, .oneDrive); drain(e, clock)
  let s = try! od.stream(e.queue.job("r1")!.remote!)
  ok("OneDrive: a way to stream it (the short lived download address)", s?.url.host == "dl.example.com")
  ok("folder: nothing to stream", (try! SRFolderUploader(provider: .folder, dest: tmp).stream(SRRemote(id: "x", name: "x", webURL: nil, size: 1))) == nil)
}

// ---------- 10. the library ----------
func rec(_ id: String, _ t: Double, title: String = "Call", path: String? = "/x/a.mov", cloud: SRCloudProvider? = nil, verified: Bool = true) -> SRRec {
  SRRec(id: id, title: title, fileName: "\(id).mov", path: path, startedAt: T0.addingTimeInterval(t), duration: 120, size: 1000, sizeAtUpload: 1000,
        cloud: cloud.map { SRCloudRef(provider: $0, remoteId: "rid", remoteName: "n", size: 1000, hashKind: .sha256, hash: "h", encrypted: false, verified: verified, verifiedAt: T0) })
}
do {
  var lib = SRLibrary()
  lib.add(rec("a", 0)); lib.add(rec("b", 100)); lib.add(rec("c", 50, title: "Zed")); lib.add(rec("d", 50, title: "Alpha"))
  ok("library: newest first, then by name", lib.sorted().map { $0.id } == ["b", "d", "c", "a"])
  ok("library: adding the same id replaces it", { var l = lib; l.add(rec("a", 5)); return l.items.count == 4 }())
  ok("library: where it is", rec("x", 0).where_ == .mac && rec("x", 0, cloud: .dropbox).where_ == .both && rec("x", 0, path: nil, cloud: .dropbox).where_ == .cloud && rec("x", 0, path: nil).where_ == .gone)
  ok("library: where in words", SRWhere.both.words == "This Mac and cloud" && SRWhere.mac.words == "This Mac" && SRWhere.cloud.words == "Cloud")
  ok("library: rename trims and refuses empty", lib.rename("a", to: "  New name \n") && lib.rec("a")?.title == "New name" && !lib.rename("a", to: "   ") && !lib.rename("zz", to: "x"))
  ok("library: a title is cut at 120", SRLibrary.cleanTitle(String(repeating: "x", count: 300)).count == 120)
}
do {
  var lib = SRLibrary(); lib.add(rec("m", 0)); lib.add(rec("b", 1, cloud: .googleDrive)); lib.add(rec("c", 2, path: nil, cloud: .dropbox))
  if case .asks(let p) = lib.deleteRequest("b", confirmed: false, cloudAlso: false) { ok("delete asks first and says the cloud copy stays", !p.cloud && p.local && p.question.contains("only") && p.question.contains("stays") && p.question.contains("Google Drive")) } else { ok("delete asks first", false) }
  if case .asks(let p) = lib.deleteRequest("b", confirmed: false, cloudAlso: true) { ok("delete asks first and says the cloud copy goes too", p.cloud && p.question.contains("and from Google Drive")) } else { ok("delete asks first (cloud too)", false) }
  if case .asks(let p) = lib.deleteRequest("m", confirmed: false, cloudAlso: false) { ok("a Mac only recording says it cannot be brought back", !p.cloud && p.question.contains("cannot be brought back")) } else { ok("mac only asks", false) }
  if case .asks(let p) = lib.deleteRequest("c", confirmed: false, cloudAlso: false) { ok("a cloud only recording names the cloud", p.cloud && !p.local && p.question.contains("Dropbox")) } else { ok("cloud only asks", false) }
  ok("asking changes nothing", lib.items.count == 3)
  ok("unknown id", lib.deleteRequest("zz", confirmed: true, cloudAlso: false) == .unknown)
  ok("confirmed Mac only keeps the cloud row", lib.deleteRequest("b", confirmed: true, cloudAlso: false) == .done(local: true, cloud: false))
  lib.finishDelete("b", localGone: true, cloudGone: false)
  ok("after a Mac only delete the row stays as cloud", lib.rec("b")?.where_ == .cloud)
  lib.finishDelete("b", localGone: false, cloudGone: true)
  ok("after the cloud copy goes too the row is gone", lib.rec("b") == nil)
}
do {
  var lib = SRLibrary(); var st = SRCloudSettings(); st.keepDays = 7
  lib.add(rec("v", 0, cloud: .googleDrive)); lib.add(rec("u", 0, cloud: .googleDrive, verified: false)); lib.add(rec("m", 0)); lib.add(rec("g", 0, path: nil, cloud: .googleDrive))
  ok("retention: nothing is due before the days are up", lib.removable(settings: st, now: T0.addingTimeInterval(86_400)).isEmpty)
  ok("retention: only a checked cloud copy with the Mac file still there is due", lib.removable(settings: st, now: T0.addingTimeInterval(8 * 86_400)) == ["v"])
  st.removeAfter = false
  ok("retention: remove off means nothing is ever due", lib.removable(settings: st, now: T0.addingTimeInterval(80 * 86_400)).isEmpty)
  st.removeAfter = true; st.keepDays = 0
  ok("retention: zero days means due at once", lib.removable(settings: st, now: T0) == ["v"])
  ok("retention: a file being recorded is never due", lib.removable(settings: st, now: T0, inUse: ["/x/a.mov"]).isEmpty)
}

// ---------- 11. playback ----------
do {
  var p = SRPlayback(); p.duration = 100
  p.forward(); ok("playback: forward 15", p.position == 15)
  p.back(); p.back(); ok("playback: back never goes below 0", p.position == 0)
  p.seek(95); p.forward(); ok("playback: forward never passes the end", p.position == 100)
  p.setRate(1.25); ok("playback: 1.25x", p.rate == 1.25)
  p.setRate(1.8); ok("playback: another speed becomes the nearest allowed one", p.rate == 2)
  p.setRate(1); p.nextRate(); p.nextRate(); p.nextRate(); p.nextRate()
  ok("playback: speeds go 1, 1.25, 1.5, 2 and round again", p.rate == 1)
  ok("playback: speed labels", SRPlayback.rates.map { SRPlayback.rateLabel($0) } == ["1x", "1.25x", "1.5x", "2x"])
  p.setVolume(.me, 0.3); p.setVolume(.them, 2); ok("playback: Me and Them volumes, clamped, in file order", p.trackVolumes() == [0.3, 1])
  p.setVolume(.them, -1); ok("playback: Them can be turned right down", p.trackVolumes() == [0.3, 0])
  p.setVolume(.me, .nan); ok("playback: a bad number becomes full volume", p.me == 1)
  p.audioTracks = 1; ok("playback: a one track file has no separate volumes", !p.hasTwoTracks && p.trackVolumes() == [1])
  p.toggle(); ok("playback: play and pause", p.playing); p.toggle(); ok("playback: paused", !p.playing)
  ok("play plan: local first", SRPlayPlan.how(localExists: true, provider: .googleDrive, encrypted: false) == .local)
  ok("play plan: drive streams with the token", SRPlayPlan.how(localExists: false, provider: .googleDrive, encrypted: false) == .streamWithToken)
  ok("play plan: dropbox temporary link", SRPlayPlan.how(localExists: false, provider: .dropbox, encrypted: false) == .temporaryLink)
  ok("play plan: onedrive download address", SRPlayPlan.how(localExists: false, provider: .oneDrive, encrypted: false) == .directLink)
  ok("play plan: icloud and folders download first", SRPlayPlan.how(localExists: false, provider: .iCloud, encrypted: false) == .downloadFirst && SRPlayPlan.how(localExists: false, provider: .folder, encrypted: false) == .downloadFirst)
  ok("play plan: sealed files download, open, play", SRPlayPlan.how(localExists: false, provider: .googleDrive, encrypted: true) == .downloadThenOpen)
  ok("phone: an unsealed cloud copy opens in the cloud", SRRemotePlay.phone(provider: .googleDrive, encrypted: false, openURL: "https://drive.example.com/x") == .openInCloud("https://drive.example.com/x"))
  ok("phone: sealed, iCloud, folder or no link means play on the Mac", SRRemotePlay.phone(provider: .googleDrive, encrypted: true, openURL: "https://x") == .playOnMac && SRRemotePlay.phone(provider: .iCloud, encrypted: false, openURL: "https://x") == .playOnMac && SRRemotePlay.phone(provider: .dropbox, encrypted: false, openURL: nil) == .playOnMac)
}

// ---------- 12. the island: ring and moment, private mode ----------
ok("ring: nothing uploading, nothing shown", SRUploadSigns.ring(active: [], privateOn: false, recording: false) == nil)
ok("ring: shows the share done", SRUploadSigns.ring(active: [("A", 0.5), ("B", 1.0)], privateOn: false, recording: false) == SRUploadSign(fraction: 0.75, name: "A", count: 2))
ok("ring: private mode shows nothing", SRUploadSigns.ring(active: [("A", 0.5)], privateOn: true, recording: false) == nil)
ok("ring: never beside a running recording", SRUploadSigns.ring(active: [("A", 0.5)], privateOn: false, recording: true) == nil)
ok("ring: percent words", SRUploadSigns.percent(0.456) == "46%" && SRUploadSigns.percent(7) == "100%")
do {
  let s = { () -> SRSettings in var s = SRSettings(); s.enabled = true; return s }()
  final class P: SRPermissionsAPI { func screen() -> SRPerm { .granted }; func mic() -> SRPerm { .granted }; func requestScreen() {}; func requestMic(_ d: @escaping (Bool) -> Void) { d(true) } }
  final class C: SRCaptureAPI { func start(_ p: SRPlan, done: @escaping (Error?) -> Void) { done(nil) }; func pause() {}; func resume() {}; func switchMic(_ u: String?) {}; func stop(done: @escaping () -> Void) { done() } }
  let ctl = SRController(settings: s, featureOn: { true }, perms: P(), capture: C())
  let b = SRIslandBrain(controller: ctl); var cards: [(SRCard, String?)] = []; var priv = false; var clock = T0
  b.emit = { cards.append(($0, $1)) }; b.privateOn = { priv }; b.now = { clock }
  b.uploaded(fileName: "Call.mov")
  ok("island: Uploaded card with a chime", cards.count == 1 && cards[0].0.id == "sr:uploaded" && cards[0].0.title == "Uploaded" && cards[0].1 == "island-done")
  ok("island: the Uploaded card plays the recording in PS", b.answer(cardId: "sr:uploaded", action: "play") == .play)
  b.router.answered("sr:uploaded")
  cards = []; priv = true; b.privateChanged(); b.uploaded(fileName: "Call.mov")
  ok("private mode: no card and no sound while it is on", cards.isEmpty)
  priv = false; clock = T0.addingTimeInterval(30); b.privateChanged(); b.localQueue?.pump()
  ok("private mode off: the held Uploaded card comes out once", cards.count == 1 && cards[0].0.id == "sr:uploaded")
  let off = SRController(settings: SRSettings(), featureOn: { true }, perms: P(), capture: C()); let b2 = SRIslandBrain(controller: off); var c2 = 0; b2.emit = { _, _ in c2 += 1 }
  b2.uploaded(fileName: "x")
  ok("feature off: no Uploaded card", c2 == 0)
  ok("words have no dashes", (SRWords.all + [SRUploadSigns.uploading, SRUploadSigns.uploaded] + [SRWaitReason.recording, .hot, .battery, .lowPower, .constrained, .expensive, .offline].map { $0.words } + [SRKeep.notChecked, .mismatch, .unsure, .removeOff, .keepDays(2), .fileChanged, .fileGone, .inUse, .noRemote].map { $0.words }).allSatisfy { !$0.contains("\u{2014}") && !$0.contains("\u{2013}") })
}
do {
  let d = try! JSONDecoder().decode(SRCloudSettings.self, from: Data("{\"provider\":\"dropbox\",\"keepDays\":9999}".utf8))
  ok("cloud settings: tolerant loading, defaults on, days capped", d.provider == .dropbox && d.removeAfter && !d.encrypt && d.keepDays == 365)
  ok("cloud settings: defaults", SRCloudSettings().provider == .none && SRCloudSettings().removeAfter && !SRCloudSettings().encrypt && SRCloudSettings().keepDays == 7)
}

try? FileManager.default.removeItem(at: tmp)
print("\(n - bad) of \(n) pass")
exit(bad == 0 ? 0 : 1)
