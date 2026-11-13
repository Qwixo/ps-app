import Cocoa
import CryptoKit
import IOKit.pwr_mgt
import Vision

// MINECRAFT MODE (the developer, 4 Nov 2026): "offline access to Georgian and Russian translations... and when I say
// Georgian, I also mean this English Georgian looking language... And include a torch: click the torch icon
// and it comes up with a full screen of whiteness so I can use my MacBook as a torch, and different colours".
// This file is the translator half.
// The developer's city has frequent internet and power cuts; the MacBook has battery. Everything here works with no
// internet once the translation model is on the Mac.
//
// The page (web src/views/Minecraft.tsx, the pickaxe in the Tab list) sends {type:"mc", op:...};
// answers go back to the overlay page as window.__psMc({ev:...}). Native does what a page cannot:
//  - the model: Meta's NLLB-200 distilled 1.3B (int8, CTranslate2 format, 1.38 GB), downloaded ONCE on the developer's
//    click through the normal network path (URLSession: macOS routes it, so through his VPN like everything
//    else; nothing here binds an interface), resumable after a cut, every file checked against its SHA-256,
//    kept in Application Support/PS/Translate. Never in the app bundle.
//  - the translator: PSTranslate (tools/translate/PSTranslate.cpp) in its own process, started on the first
//    translation and stopped after 2 idle minutes. Cancel kills it. Nothing waits on the main thread.
//  - reading a screenshot: Apple Vision text recognition, on this Mac, off the main thread.
//  - the word lists the Latin Georgian reader uses (translate/*.txt.gz, shipped in Resources).
// The torch is its own piece (Sources/Torch.swift, TorchLight, from the mc-torch branch).

struct MCFile: Codable, Equatable { let name: String; let url: String; let size: Int64; let sha256: String }
struct MCPack: Codable, Equatable { let id: String; let title: String; let files: [MCFile] }

enum MCPacks {
  /// Pinned to exact revisions: a file that changed upstream fails its hash instead of being trusted.
  /// Model: OpenNMT's own CTranslate2 conversion of facebook/nllb-200-distilled-1.3B (CC BY-NC 4.0: fine for
  /// The developer's own use; it is never shipped with PS). Tokenizer: Meta's sentencepiece model from the original repo.
  static let nllb13 = MCPack(id: "nllb-1.3b-int8", title: "NLLB-200 1.3B (Meta), int8", files: [
    MCFile(name: "config.json", url: "https://huggingface.co/OpenNMT/nllb-200-distilled-1.3B-ct2-int8/resolve/70f572adafa4794890ce7826156a4209717855af/config.json",
           size: 1071, sha256: "bb11352c2579e31d4251500cd3d813beb6ab083c8a60268db52e9698c1c9cda2"),
    MCFile(name: "shared_vocabulary.json", url: "https://huggingface.co/OpenNMT/nllb-200-distilled-1.3B-ct2-int8/resolve/70f572adafa4794890ce7826156a4209717855af/shared_vocabulary.json",
           size: 5921176, sha256: "af53bfd0e6f726209e7325e45b87ab3b14e5856f7d42d7b9be91de3287c45267"),
    MCFile(name: "sentencepiece.bpe.model", url: "https://huggingface.co/facebook/nllb-200-distilled-1.3B/resolve/7be3e24664b38ce1cac29b8aeed6911aa0cf0576/sentencepiece.bpe.model",
           size: 4852054, sha256: "14bb8dfb35c0ffdea7bc01e56cea38b9e3d5efcdcb9c251d6b40538e1aab555a"),
    MCFile(name: "model.bin", url: "https://huggingface.co/OpenNMT/nllb-200-distilled-1.3B-ct2-int8/resolve/70f572adafa4794890ce7826156a4209717855af/model.bin",
           size: 1377755738, sha256: "89dc4b9eb7f4dcd3ff36023c9b1c55fcecb47ddc0df97ab31b068ef9cf194940"),
  ])
}

final class MinecraftMode: NSObject, URLSessionDownloadDelegate {
  static let shared = MinecraftMode()
  /// Answers for the overlay page (window.__psMc). Set by App.
  var deliver: ((String) -> Void)?
  let q = DispatchQueue(label: "PS minecraft", qos: .userInitiated)
  private(set) var testDir: String?
  private(set) var pack = MCPacks.nllb13
  /// Application Support/PS/Translate (a test copy: <test dir>/mc).
  private(set) var base = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support/PS/Translate")
  var modelDir: URL { base.appendingPathComponent(pack.id) }
  var stagingDir: URL { base.appendingPathComponent(pack.id + ".partial") }
  /// The translator inside the app (build.sh puts it in Resources). A test may point elsewhere.
  var helperPath: String? = Bundle.main.path(forResource: "PSTranslate", ofType: nil)

  // ---------- download state (on q) ----------
  private(set) var state = "none"          // none, downloading, checking, paused, ready, error
  private(set) var error: String?
  private var fileIndex = 0
  private var doneBytes: Int64 = 0         // whole files already in staging
  private var fileBytes: Int64 = 0         // the current file so far
  private var checked: Int64 = 0           // bytes hashed so far while checking
  private var session: URLSession?
  private var task: URLSessionDownloadTask?
  private var lastSent = Date.distantPast
  private var cancelledByRed = false

  func start(testDir: String?) {
    self.testDir = testDir
    if let t = testDir {
      base = URL(fileURLWithPath: t).appendingPathComponent("mc")
      // A test may hand in its own pack (file:// links): never the real download.
      if let p = ProcessInfo.processInfo.environment["PS_MC_PACK"], let d = FileManager.default.contents(atPath: p),
         let pk = try? JSONDecoder().decode(MCPack.self, from: d) { pack = pk }
    }
    q.async { [self] in state = isReady() ? "ready" : (FileManager.default.fileExists(atPath: stagingDir.path) ? "paused" : "none") }
  }

  /// Self test only: a pack of small local files (file:// links) in place of the real model.
  func useTestPack(_ p: MCPack) {
    guard testDir != nil else { return }
    q.sync { pack = p; state = isReady() ? "ready" : "none"; error = nil; session?.invalidateAndCancel(); session = nil; task = nil }
  }

  /// The model is there: the folder, its ready note for this exact pack, and every file at its size. The hashes
  /// were checked once when it arrived (1.4 GB is not hashed again on every launch).
  func isReady() -> Bool {
    let fm = FileManager.default
    guard let d = fm.contents(atPath: modelDir.appendingPathComponent("ready.json").path),
          let p = try? JSONDecoder().decode(MCPack.self, from: d), p == pack else { return false }
    for f in pack.files {
      let size = (try? fm.attributesOfItem(atPath: modelDir.appendingPathComponent(f.name).path)[.size] as? NSNumber)?.int64Value
      if size != f.size { return false }
    }
    return true
  }
  var totalBytes: Int64 { pack.files.reduce(0) { $0 + $1.size } }

  // ---------- from the page ----------
  func handle(_ msg: [String: Any]) {
    let op = msg["op"] as? String ?? ""
    switch op {
    case "status": q.async { self.sendStatus() }
    case "warm": q.async { self.warmVision() }
    case "lexicon": q.async { self.sendLexicon() }
    case "download": q.async { self.download() }
    case "pause": q.async { self.pause() }
    case "remove": q.async { self.removeModel() }
    case "translate":
      guard let id = msg["id"] as? String, let src = msg["src"] as? String, let tgt = msg["tgt"] as? String, let text = msg["text"] as? String else { return }
      MCEngine.shared.translate(id: id, src: src, tgt: tgt, text: String(text.prefix(8000)))
    case "cancel":
      if let id = msg["id"] as? String { MCEngine.shared.cancel(id) }
    case "ocr":
      guard let id = msg["id"] as? String, let img = msg["image"] as? String else { return }
      q.async { self.ocr(id: id, dataURL: img) }
    default: break
    }
  }

  func send(_ o: [String: Any]) {
    guard let d = try? JSONSerialization.data(withJSONObject: o), let s = String(data: d, encoding: .utf8) else { return }
    DispatchQueue.main.async { self.deliver?(s) }
  }

  func statusObject() -> [String: Any] {
    var o: [String: Any] = ["ev": "status", "state": state, "pack": pack.title, "total": totalBytes,
                            "helper": helperPath.map { FileManager.default.isExecutableFile(atPath: $0) } ?? false,
                            "engine": MCEngine.shared.stateName]
    switch state {
    case "downloading": o["got"] = doneBytes + fileBytes; o["file"] = pack.files[min(fileIndex, pack.files.count - 1)].name
    case "checking": o["got"] = checked
    case "paused": o["got"] = stagedBytes()
    case "ready": o["got"] = totalBytes
    default: o["got"] = 0
    }
    if let e = error { o["error"] = e }
    return o
  }
  func sendStatus() { send(statusObject()) }

  // ---------- the download ----------
  private func stagedBytes() -> Int64 {
    var n: Int64 = 0
    for f in pack.files {
      let p = stagingDir.appendingPathComponent(f.name).path
      if let s = (try? FileManager.default.attributesOfItem(atPath: p)[.size] as? NSNumber)?.int64Value, s == f.size { n += s }
    }
    return n
  }

  private func download() {
    guard state != "downloading" && state != "checking" && state != "ready" else { sendStatus(); return }
    error = nil; cancelledByRed = false
    let fm = FileManager.default
    try? fm.createDirectory(at: stagingDir, withIntermediateDirectories: true)
    // Room first: the files plus a little.
    if let free = try? base.deletingLastPathComponent().resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]).volumeAvailableCapacityForImportantUsage,
       free < totalBytes - stagedBytes() + 200_000_000 {
      fail("Not enough free space: the model needs \(gb(totalBytes)) and the Mac has \(gb(free)) free.")
      return
    }
    state = "downloading"; fileIndex = 0; doneBytes = 0; fileBytes = 0
    nextFile()
  }

  private func nextFile() {
    let fm = FileManager.default
    // Skip files already here and already checked (a resumed download).
    while fileIndex < pack.files.count {
      let f = pack.files[fileIndex]
      let at = stagingDir.appendingPathComponent(f.name)
      if fm.fileExists(atPath: at.path + ".ok"), (try? fm.attributesOfItem(atPath: at.path)[.size] as? NSNumber)?.int64Value == f.size {
        doneBytes += f.size; fileIndex += 1; continue
      }
      break
    }
    guard fileIndex < pack.files.count else { finish(); return }
    let f = pack.files[fileIndex]
    guard let url = URL(string: f.url), url.scheme == "https" || (testDir != nil && url.scheme == "file") else { fail("Bad link for \(f.name)"); return }
    if session == nil {
      let cfg = URLSessionConfiguration.default
      cfg.waitsForConnectivity = false
      cfg.timeoutIntervalForRequest = 60
      cfg.httpAdditionalHeaders = ["User-Agent": "PS"]
      let oq = OperationQueue(); oq.underlyingQueue = q; oq.maxConcurrentOperationCount = 1
      session = URLSession(configuration: cfg, delegate: self, delegateQueue: oq)
    }
    fileBytes = 0
    let resume = stagingDir.appendingPathComponent(f.name + ".resume")
    if let data = try? Data(contentsOf: resume) {
      try? fm.removeItem(at: resume)
      task = session!.downloadTask(withResumeData: data)
    } else {
      task = session!.downloadTask(with: url)
    }
    task!.resume()
    sendStatus()
  }

  func urlSession(_ s: URLSession, downloadTask: URLSessionDownloadTask, didWriteData _: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite _: Int64) {
    fileBytes = totalBytesWritten
    if Date().timeIntervalSince(lastSent) > 0.25 { lastSent = Date(); sendStatus() }
  }

  func urlSession(_ s: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
    guard fileIndex < pack.files.count else { return }
    if let h = downloadTask.response as? HTTPURLResponse, !(200..<300).contains(h.statusCode) { fail("The server said \(h.statusCode) for \(pack.files[fileIndex].name). Try again later."); return }
    let f = pack.files[fileIndex]
    let at = stagingDir.appendingPathComponent(f.name)
    try? FileManager.default.removeItem(at: at)
    do { try FileManager.default.moveItem(at: location, to: at) } catch { fail("Could not keep \(f.name): \(error.localizedDescription)"); return }
  }

  func urlSession(_ s: URLSession, task t: URLSessionTask, didCompleteWithError err: Error?) {
    guard fileIndex < pack.files.count, t === task else { return }
    let f = pack.files[fileIndex]
    if let err = err as NSError? {
      if let data = err.userInfo[NSURLSessionDownloadTaskResumeData] as? Data {
        try? data.write(to: stagingDir.appendingPathComponent(f.name + ".resume"))
      }
      if cancelledByRed { state = "paused"; sendStatus(); return }
      fail(err.code == NSURLErrorNotConnectedToInternet || err.code == NSURLErrorNetworkConnectionLost || err.code == NSURLErrorTimedOut
           ? "The internet went away. What came down is kept: press Download to carry on." : "Download stopped: \(err.localizedDescription). Press Download to carry on.")
      return
    }
    // Arrived: check it before anything trusts it.
    let at = stagingDir.appendingPathComponent(f.name)
    state = "checking"; checked = doneBytes; sendStatus()
    guard let sum = sha256(of: at, progress: { n in self.checked = self.doneBytes + n }) , sum == f.sha256 else {
      try? FileManager.default.removeItem(at: at)
      fail("\(f.name) did not match its fingerprint (a damaged or changed download), so it was thrown away. Press Download to try again.")
      return
    }
    FileManager.default.createFile(atPath: at.path + ".ok", contents: Data())
    doneBytes += f.size; fileIndex += 1; state = "downloading"
    nextFile()
  }

  private func finish() {
    let fm = FileManager.default
    for f in pack.files { try? fm.removeItem(atPath: stagingDir.appendingPathComponent(f.name + ".ok").path) }
    if let d = try? JSONEncoder().encode(pack) { try? d.write(to: stagingDir.appendingPathComponent("ready.json")) }
    try? fm.removeItem(at: modelDir)
    do { try fm.moveItem(at: stagingDir, to: modelDir) } catch { fail("Could not put the model in place: \(error.localizedDescription)"); return }
    session?.finishTasksAndInvalidate(); session = nil; task = nil
    state = isReady() ? "ready" : "error"
    if state == "error" { error = "The model is incomplete. Press Download again." }
    psLog("PS minecraft: model \(pack.id) \(state)")
    sendStatus()
  }

  private func pause() {
    guard state == "downloading", let t = task else { return }
    cancelledByRed = true
    t.cancel(byProducingResumeData: { _ in })   // the resume data arrives in didCompleteWithError
  }

  private func removeModel() {
    MCEngine.shared.stop()
    task?.cancel(); task = nil; session?.invalidateAndCancel(); session = nil
    try? FileManager.default.removeItem(at: modelDir)
    try? FileManager.default.removeItem(at: stagingDir)
    state = "none"; error = nil
    sendStatus()
  }

  private func fail(_ why: String) {
    state = "error"; error = why
    psLog("PS minecraft: download error: \(why)")
    sendStatus()
  }

  private func gb(_ n: Int64) -> String { String(format: "%.1f GB", Double(n) / 1_000_000_000) }

  /// SHA-256 of a file in 4 MB pieces (never the whole file in memory).
  func sha256(of url: URL, progress: ((Int64) -> Void)? = nil) -> String? {
    guard let h = try? FileHandle(forReadingFrom: url) else { return nil }
    defer { try? h.close() }
    var hasher = SHA256(), n: Int64 = 0
    while true {
      let chunk = autoreleasepool { h.readData(ofLength: 4 << 20) }
      if chunk.isEmpty { break }
      hasher.update(data: chunk); n += Int64(chunk.count)
      progress?(n)
      if Date().timeIntervalSince(lastSent) > 0.25 { lastSent = Date(); sendStatus() }
    }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
  }

  // ---------- word lists for the Latin Georgian reader ----------
  private func sendLexicon() {
    func b64(_ name: String) -> String? {
      guard let p = Bundle.main.path(forResource: name, ofType: "txt.gz", inDirectory: "translate") ?? testLexicon(name),
            let d = FileManager.default.contents(atPath: p) else { return nil }
      return d.base64EncodedString()
    }
    guard let ka = b64("ka-words"), let en = b64("en-words") else { send(["ev": "lexicon", "ok": false]); return }
    send(["ev": "lexicon", "ok": true, "ka": ka, "en": en])
  }
  private func testLexicon(_ name: String) -> String? { ProcessInfo.processInfo.environment["PS_MC_LEXICON"].map { "\($0)/\(name).txt.gz" } }

  // ---------- reading a screenshot ----------
  /// Apple Vision on this Mac (no network). Latin (so Latin Georgian too) and Cyrillic; Vision cannot read
  /// Georgian script. Lines that wrap inside one message are joined again, so a sentence is translated whole.
  func ocr(id: String, dataURL: String) {
    let b64 = dataURL.range(of: ",").map { String(dataURL[$0.upperBound...]) } ?? dataURL
    guard b64.count < 40_000_000, let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters) else {
      send(["ev": "ocr", "id": id, "ok": false, "error": "That picture could not be read."]); return
    }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = false        // correction would "fix" Latin Georgian into English words
    req.recognitionLanguages = ["en-US", "ru-RU"]
    do { try VNImageRequestHandler(data: data, options: [:]).perform([req]) } catch {
      send(["ev": "ocr", "id": id, "ok": false, "error": "Could not read text in that picture."]); return
    }
    let lines: [(String, CGRect)] = (req.results ?? []).compactMap { o in o.topCandidates(1).first.map { ($0.string, o.boundingBox) } }
    send(["ev": "ocr", "id": id, "ok": true, "text": MinecraftMode.joinLines(lines)])
  }

  /// Apple Vision loads its text model the first time it is used after the Mac starts: about a minute (4 Nov 2026,
  /// 57 s, then 0.1 s). PS reads one tiny blank picture when Minecraft mode opens, once per launch, at low priority,
  /// so a pasted screenshot is read at once.
  private var warmed = false
  func warmVision() {
    guard !warmed else { return }
    warmed = true
    DispatchQueue.global(qos: .utility).async {
      let img = NSImage(size: NSSize(width: 64, height: 16))
      img.lockFocus(); NSColor.white.setFill(); NSRect(x: 0, y: 0, width: 64, height: 16).fill(); img.unlockFocus()
      guard let tiff = img.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else { return }
      let req = VNRecognizeTextRequest()
      req.recognitionLevel = .accurate; req.recognitionLanguages = ["en-US", "ru-RU"]
      try? VNImageRequestHandler(data: png, options: [:]).perform([req])
    }
  }

  /// Vision's lines (bottom left origin boxes) in reading order; a line that runs on joins the next one.
  static func joinLines(_ lines: [(String, CGRect)]) -> String {
    let sorted = lines.sorted { a, b in abs(a.1.maxY - b.1.maxY) > min(a.1.height, b.1.height) * 0.5 ? a.1.maxY > b.1.maxY : a.1.minX < b.1.minX }
    var out = "", prev: CGRect?
    for (s, r) in sorted {
      let t = s.trimmingCharacters(in: .whitespaces)
      guard !t.isEmpty else { continue }
      if let p = prev {
        let gap = p.minY - r.maxY
        let h = max(p.height, r.height)
        let ends = out.last.map { ".!?:;".contains($0) } ?? true
        if gap > h * 0.9 { out += "\n\n" }
        else if !ends && gap < h * 0.6 && abs(p.minX - r.minX) < 0.08 { out += " " }
        else { out += "\n" }
      }
      out += t; prev = r
    }
    return out
  }
}

// MARK: - The translator process

final class MCEngine {
  static let shared = MCEngine()
  private let q = DispatchQueue(label: "PS minecraft engine", qos: .userInitiated)
  private var proc: Process?
  private var stdin: FileHandle?
  private var ready = false
  private var buffer = Data()
  private var queue: [(id: String, line: String)] = []
  private var inflight: String?
  private var idle: DispatchWorkItem?
  private(set) var stateName = "off"       // off, loading, ready, busy
  private static let codes: Set<String> = ["eng_Latn", "rus_Cyrl", "kat_Geor"]
  var threads = 4

  func translate(id: String, src: String, tgt: String, text: String) {
    q.async { [self] in
      guard MCEngine.codes.contains(src), MCEngine.codes.contains(tgt) else { reply(id, ok: false, text: "Unknown language", ms: 0); return }
      guard MinecraftMode.shared.isReady() else { reply(id, ok: false, text: "The model is not downloaded yet.", ms: 0); return }
      let rid = id.filter { $0.isLetter || $0.isNumber || $0 == "-" }
      queue.append((rid, "\(rid)\ttr\t\(src)\t\(tgt)\t\(Data(text.utf8).base64EncodedString())\n"))
      pump()
    }
  }

  func cancel(_ id: String) {
    q.async { [self] in
      let rid = id.filter { $0.isLetter || $0.isNumber || $0 == "-" }
      queue.removeAll { $0.id == rid }
      if inflight == rid {
        // The only way to stop CTranslate2 mid sentence: end the process. The next request starts a fresh one.
        inflight = nil
        kill()
        MinecraftMode.shared.send(["ev": "translated", "id": rid, "ok": false, "cancelled": true])
      }
    }
  }

  func stop() { q.async { self.kill() } }

  private func pump() {
    if proc == nil { launch(); return }
    guard ready, inflight == nil, !queue.isEmpty else { return }
    let r = queue.removeFirst()
    inflight = r.id; stateName = "busy"
    idle?.cancel()
    stdin?.write(Data(r.line.utf8))
  }

  private func launch() {
    guard let exe = MinecraftMode.shared.helperPath, FileManager.default.isExecutableFile(atPath: exe) else {
      for r in queue { reply(r.id, ok: false, text: "This PS app build has no translator inside.", ms: 0) }
      queue.removeAll(); return
    }
    let p = Process()
    p.executableURL = URL(fileURLWithPath: exe)
    p.arguments = [MinecraftMode.shared.modelDir.path, String(threads)]
    p.environment = [:]                                  // nothing of PS's own environment
    p.qualityOfService = .userInitiated
    let inP = Pipe(), outP = Pipe()
    p.standardInput = inP; p.standardOutput = outP; p.standardError = FileHandle.nullDevice
    outP.fileHandleForReading.readabilityHandler = { [weak self] h in
      let d = h.availableData
      self?.q.async { self?.got(d, from: p) }
    }
    p.terminationHandler = { [weak self] pr in self?.q.async { self?.ended(pr) } }
    do { try p.run() } catch {
      for r in queue { reply(r.id, ok: false, text: "The translator could not start.", ms: 0) }
      queue.removeAll(); return
    }
    proc = p; stdin = inP.fileHandleForWriting; ready = false; buffer = Data(); stateName = "loading"
    MinecraftMode.shared.q.async { MinecraftMode.shared.sendStatus() }
  }

  private func got(_ d: Data, from p: Process) {
    guard p === proc else { return }
    buffer.append(d)
    while let nl = buffer.firstIndex(of: 0x0A) {
      let line = String(decoding: buffer[buffer.startIndex..<nl], as: UTF8.self)
      buffer.removeSubrange(buffer.startIndex...nl)
      let f = line.components(separatedBy: "\t")
      if f.first == "ready" {
        ready = true; stateName = "ready"
        psLog("PS minecraft: translator ready in \(f.count > 1 ? f[1] : "?") ms")
        MinecraftMode.shared.q.async { MinecraftMode.shared.sendStatus() }
        pump(); continue
      }
      if f.first == "fail" {
        let why = f.count > 1 ? String(decoding: Data(base64Encoded: f[1]) ?? Data(), as: UTF8.self) : ""
        psLog("PS minecraft: translator failed to load: \(why)")
        for r in queue { reply(r.id, ok: false, text: "The model could not be loaded. Try removing it and downloading again.", ms: 0) }
        queue.removeAll(); kill(); continue
      }
      guard f.count >= 4, f[0] == inflight else { continue }
      inflight = nil; stateName = "ready"
      let text = String(decoding: Data(base64Encoded: f[2]) ?? Data(), as: UTF8.self)
      reply(f[0], ok: f[1] == "ok", text: text, ms: Int(f[3]) ?? 0)
      armIdle()
      pump()
    }
  }

  private func ended(_ p: Process) {
    guard p === proc else { return }
    proc = nil; stdin = nil; ready = false; stateName = "off"
    if let id = inflight { inflight = nil; reply(id, ok: false, text: "The translator stopped. Try again.", ms: 0) }
    MinecraftMode.shared.q.async { MinecraftMode.shared.sendStatus() }
    if !queue.isEmpty { pump() }
  }

  private func kill() {
    idle?.cancel()
    if let p = proc { proc = nil; stdin = nil; ready = false; stateName = "off"; p.terminate() }
    MinecraftMode.shared.q.async { MinecraftMode.shared.sendStatus() }
  }

  /// 2 minutes with nothing to do: the process goes (it holds about 1.5 GB of memory while loaded).
  private func armIdle() {
    idle?.cancel()
    let w = DispatchWorkItem { [weak self] in self?.kill() }
    idle = w
    q.asyncAfter(deadline: .now() + 120, execute: w)
  }

  private func reply(_ id: String, ok: Bool, text: String, ms: Int) {
    MinecraftMode.shared.send(ok ? ["ev": "translated", "id": id, "ok": true, "text": text, "ms": ms] : ["ev": "translated", "id": id, "ok": false, "error": text])
  }
}
