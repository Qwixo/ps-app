// The developer's own background videos for the Tab list (the developer, 20 Oct 2026; from his vault since 27 Oct 2026;
// from his Drive folder again, automatically, since 4 Nov 2026).
// PS is handed to other people too, so no video and no folder of the developer's is in the app. His videos
// live encrypted in his vault (settings.bgVault, pieces as vault blobs, the same as on his phone:
// web src/core/bgvault.ts). After he unlocks, the main window downloads each one ONCE and
// hands the pieces here (bg:put); they land in PS's own Application Support folder and the Tab list
// plays them from PS's own local address (ps://app/client/bg/<id>.mp4). A video taken out of the
// vault goes away here too (bg:list).
//
// The Drive folder (4 Nov 2026, the developer: "after every 12 hours the PS app refreshes this folder, and any
// background videos in it get linked automatically and transferred to every device"). Only on a Mac
// whose own defaults name the folder (`defaults write com.cincee.ps bg.folder <path>`), so the path
// is never in the app, and only while the developer is the one signed in (Owner.red):
//  - every 2 minutes a cheap read only look at the folder (names, sizes, dates; on its own thread
//    with a 20 s limit, because a Drive folder can hang while Drive is offline);
//  - a new or changed video gets a silent HEVC copy here (compressed harder when it is big), then the
//    main window puts that copy in the vault ONCE (bg:read pieces, bg:adopt), so his phone and his
//    other Mac download it once each;
//  - a video that left the folder (seen gone twice in a row) is taken out of the vault (bg:have gone);
//  - every 12 hours a full check: folder readable, every copy there and playable, failed copies tried
//    again, and the main window checks the vault still holds every piece (bg:have check);
//  - a problem shows ONE card (Toast) with a plain sentence and Copy error code, until it changes or
//    The developer dismisses it. Never his files, keys or the folder path in the code.
// Nothing here ever writes, moves or deletes anything in the Drive folder.
// Self test copies use PS_SELFTEST_BGSRC and their own folder, never the developer's defaults or his clipboard.
import AppKit
import AVFoundation
import Foundation
import UniformTypeIdentifiers
import WebKit

final class Backgrounds {
  static let shared = Backgrounds()
  /// Hands the list to the Tab list page (main thread): [{id, name}].
  var deliver: ((String) -> Void)?
  private let q = DispatchQueue(label: "PS backgrounds", qos: .utility)
  private var timer: DispatchSourceTimer?
  private(set) var list: [[String: String]] = []
  private var lastJSON = ""
  private(set) var made = 0                       // copies made this run (the self test reads it)
  let localDir: URL
  private var sourceDir: URL?
  private let test = ProcessInfo.processInfo.environment["PS_SELFTEST"] != nil
  static let videoTypes: Set<String> = ["mp4", "mov", "m4v"]
  /// A copy over this is compressed again before it goes to the other devices (egress: Supabase free plan).
  /// (PS_SELFTEST_BGSHRINK=1 in a test copy compresses every copy, to test that path.)
  static let shrinkAll = ProcessInfo.processInfo.environment["PS_SELFTEST"] != nil && ProcessInfo.processInfo.environment["PS_SELFTEST_BGSHRINK"] == "1"
  static let shrinkOver = shrinkAll ? 1 : 40_000_000
  /// What a shrunk copy aims for, and the most that ever goes into the vault.
  static let shrinkTo = shrinkAll ? 1 : 28_000_000, vaultMax = 60_000_000
  private(set) var lastShrink: (from: Int, to: Int)?    // the self test reads it

  private init() {
    let env = ProcessInfo.processInfo.environment
    if let test = env["PS_SELFTEST"] {
      localDir = URL(fileURLWithPath: test).appendingPathComponent("backgrounds", isDirectory: true)
      sourceDir = env["PS_SELFTEST_BGSRC"].map { URL(fileURLWithPath: $0, isDirectory: true) }
    } else {
      localDir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("PS/backgrounds", isDirectory: true)
      sourceDir = nil   // the folder comes from this Mac's defaults (folder), read at each look
    }
  }

  /// The Drive folder to watch, or nil (a Mac without one only gets the vault's videos).
  private var folder: URL? {
    if test { return sourceDir }
    guard Owner.red, let p = UserDefaults.standard.string(forKey: "bg.folder"), !p.isEmpty else { return nil }
    return URL(fileURLWithPath: (p as NSString).expandingTildeInPath, isDirectory: true)
  }

  func start() {
    q.async { [self] in
      try? FileManager.default.createDirectory(at: localDir, withIntermediateDirectories: true)
      try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: localDir.path)
      if pref("bg.lastGood") as? Double == nil { setPref("bg.lastGood", Date().timeIntervalSince1970) }
      scan()
      let t = DispatchSource.makeTimerSource(queue: q)
      t.schedule(deadline: .now() + 120, repeating: 120, leeway: .seconds(10))
      t.setEventHandler { [weak self] in self?.tick() }
      t.resume()
      timer = t
    }
  }
  /// Every 2 minutes: the cheap look, and the full check when 12 hours have passed since the last one.
  private func tick() {
    let last = pref("bg.lastFull") as? Double ?? 0
    scan(full: haveAsked && Date().timeIntervalSince1970 - last >= Backgrounds.fullEvery)
  }
  static let fullEvery: Double = 12 * 3600
  /// Self test only: a folder of test clips instead (never the developer's Drive), looked at now.
  func useTestSource(_ dir: URL, _ done: @escaping () -> Void) {
    guard test else { return }
    q.async { [self] in sourceDir = dir; try? FileManager.default.createDirectory(at: localDir, withIntermediateDirectories: true); scan(); DispatchQueue.main.async { done() } }
  }
  /// Self test only: one look now (full = the 12 hour check), then `done` on main.
  func testLook(full: Bool = false, _ done: @escaping () -> Void) {
    guard test else { return }
    q.async { [self] in scan(full: full); DispatchQueue.main.async { done() } }
  }
  /// Self test only: the problems now (codes), the cards up, and a note of one video.
  func testState(_ done: @escaping (_ problems: [String], _ cards: [String], _ metas: [String: [String: Any]]) -> Void) {
    guard test else { return }
    q.async { [self] in let p = Array(problems.keys).sorted(), c = Array(shownCards.keys).sorted(), m = metas(); DispatchQueue.main.async { done(p, c, m) } }
  }
  /// The page asks for the list (when it loads): sent again even if unchanged.
  func resend() { q.async { [self] in let j = lastJSON; if !j.isEmpty { DispatchQueue.main.async { self.deliver?(j) } } } }

  static func slug(_ name: String) -> String {
    let base = (name as NSString).deletingPathExtension.lowercased()
    let s = base.map { $0.isLetter || $0.isNumber ? String($0) : "-" }.joined()
      .replacingOccurrences(of: "-+", with: "-", options: .regularExpression).trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    return String(s.prefix(48)).isEmpty ? "video" : String(s.prefix(48))
  }

  // ---------- this Mac's own notes (test copies keep them in memory, never the developer's defaults) ----------
  private var mem: [String: Any] = [:]
  private func pref(_ k: String) -> Any? { test ? mem[k] : UserDefaults.standard.object(forKey: k) }
  private func setPref(_ k: String, _ v: Any?) { if test { mem[k] = v } else if let v { UserDefaults.standard.set(v, forKey: k) } else { UserDefaults.standard.removeObject(forKey: k) } }

  // ---------- looking at the folder ----------
  private struct Entry { let name: String; let size: Int64; let mtime: Double }
  private enum Look { case ok([Entry]), missing(parent: Bool), slow, unreadable(String) }
  private var looking = false
  /// The folder's videos, read on a thread of its own: a Drive folder can hang while Drive is offline,
  /// so after 20 s this gives up (and does not start another look while that one is still stuck).
  private func look(_ dir: URL) -> Look {
    if looking { return .slow }
    looking = true
    final class Box { var v: Look = .slow; let lock = NSLock() }
    let box = Box(), sem = DispatchSemaphore(value: 0)
    DispatchQueue.global(qos: .utility).async { [weak self] in
      let r = Backgrounds.read(dir)
      box.lock.lock(); box.v = r; box.lock.unlock()
      sem.signal()
      self?.q.async { self?.looking = false }
    }
    guard sem.wait(timeout: .now() + 20) == .success else { return .slow }
    box.lock.lock(); defer { box.lock.unlock() }
    return box.v
  }
  private static func read(_ dir: URL) -> Look {
    let fm = FileManager.default
    var isDir: ObjCBool = false
    guard fm.fileExists(atPath: dir.path, isDirectory: &isDir), isDir.boolValue else {
      return .missing(parent: fm.fileExists(atPath: dir.deletingLastPathComponent().path))
    }
    let names: [String]
    do { names = try fm.contentsOfDirectory(atPath: dir.path) } catch { return .unreadable("\((error as NSError).domain) \((error as NSError).code)") }
    var out: [Entry] = []
    for name in names.sorted() where !name.hasPrefix(".") && videoTypes.contains((name as NSString).pathExtension.lowercased()) {
      let path = dir.appendingPathComponent(name).path
      guard let a = try? fm.attributesOfItem(atPath: path), (a[.type] as? FileAttributeType) == .typeRegular,
            let size = (a[.size] as? NSNumber)?.int64Value, size > 0,
            let mtime = (a[.modificationDate] as? Date)?.timeIntervalSince1970 else { continue }
      out.append(Entry(name: name, size: size, mtime: mtime))
    }
    return .ok(out)
  }

  // ---------- problems: one card each, until it changes or the developer dismisses it ----------
  struct Problem { let code: String; let subject: String; let text: String; let detail: String }
  private var problems: [String: Problem] = [:]   // native ones, by code
  private var pageProblems: [String: Problem] = [:]   // the main window's (uploads, the vault), by code
  private var shownCards: [String: String] = [:]  // card code -> what it showed (code + subject)
  private(set) var lastCopied = ""                // the self test reads it instead of the clipboard
  private var failed: [String: String] = [:]      // id -> the version whose copy failed (tried again at the full check)
  private var missSince: [String: Double] = [:]   // id -> when a look first missed the source (gone after goneAfter)
  /// A file missing on looks this far apart is gone (a Drive hiccup, or two looks a second apart, is not a delete).
  private lazy var goneAfter: Double = test ? 0.5 : 100
  private var folderMiss = 0
  private var badLooks = 0                        // looks in a row that failed (a Mac just woken is not "offline")
  private var lastCount = 0

  private func setProblem(_ code: String, _ p: Problem?) { if let p { problems[code] = p } else { problems.removeValue(forKey: code) } }
  /// Shows a card for every problem not dismissed in this form, takes away the ones that ended.
  private func refreshCards() {
    let all = problems.merging(pageProblems) { a, _ in a }
    var dismissed = pref("bg.dismissed") as? [String: String] ?? [:]
    // A problem that ended may come back later: then it shows again.
    for code in dismissed.keys where all[code] == nil { dismissed.removeValue(forKey: code) }
    setPref("bg.dismissed", dismissed.isEmpty ? nil : dismissed)
    var want: [String: Problem] = [:]
    for (code, p) in all where dismissed[code] != "\(code)|\(p.subject)" { want[code] = p }
    let gone = shownCards.keys.filter { want[$0] == nil }
    let fresh = want.filter { shownCards[$0.key] != "\($0.key)|\($0.value.subject)" }
    for code in gone { shownCards.removeValue(forKey: code) }
    for (code, p) in fresh { shownCards[code] = "\(code)|\(p.subject)" }
    guard !gone.isEmpty || !fresh.isEmpty else { return }
    DispatchQueue.main.async {
      for code in gone { Toast.shared.hideCard("bg:\(code)") }
      for (code, p) in fresh.sorted(by: { $0.key < $1.key }) {
        psLog("PS backgrounds: problem \(code)")
        Toast.shared.showCard(["id": "bg:\(code)", "title": Backgrounds.title(code), "body": p.text, "sticky": true,
                               "actions": [["id": "copy", "label": "Copy error code"], ["id": "dismiss", "label": "Dismiss"]]])
      }
    }
  }
  static func title(_ code: String) -> String {
    switch code {
    case "BG-DRIVE-OFF": return "Background videos have not refreshed"
    case "BG-FOLDER-GONE", "BG-FOLDER-READ": return "Background videos folder not found"
    case "BG-COPY", "BG-TOO-BIG", "BG-ADD": return "A background video could not be added"
    case "BG-QUOTA": return "Your vault is full"
    default: return "Background videos did not sync"
    }
  }
  /// A card button (main.swift, Toast.onAction "bg:"): Copy error code copies the code and the
  /// details (never a key, a file or the folder path); either button closes the card for this problem.
  func cardAction(_ id: String, _ action: String) {
    let code = String(id.dropFirst(3))
    q.async { [self] in
      guard let p = problems[code] ?? pageProblems[code] else { return }
      if action == "copy" {
        let text = report(p)
        if test { lastCopied = text } else { DispatchQueue.main.async { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType: .string) } }
        psLog("PS backgrounds: error code \(code) copied")
      }
      var dismissed = pref("bg.dismissed") as? [String: String] ?? [:]
      dismissed[code] = "\(code)|\(p.subject)"
      setPref("bg.dismissed", dismissed)
      shownCards.removeValue(forKey: code)
    }
  }
  private static let stamp: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]; return f }()
  private func report(_ p: Problem) -> String {
    let build = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?") + " (" + (Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?") + ")"
    let good = (pref("bg.lastGood") as? Double).map { Backgrounds.stamp.string(from: Date(timeIntervalSince1970: $0)) } ?? "never"
    let full = (pref("bg.lastFull") as? Double).map { Backgrounds.stamp.string(from: Date(timeIntervalSince1970: $0)) } ?? "never"
    let m = metas()
    let inVault = m.values.filter { $0["vault"] as? Bool == true }.count
    return """
    PS error code \(p.code)
    Device: Mac, PS \(build)
    When: \(Backgrounds.stamp.string(from: Date()))
    Problem: \(p.detail)
    Drive folder: \(folder == nil ? "not set on this Mac" : "set"), last read \(good), \(lastCount) video\(lastCount == 1 ? "" : "s") in it
    Last full check: \(full)
    Copies on this Mac: \(m.count) (\(inVault) in the vault)
    """
  }

  /// Runs on q: every video in the folder has an up to date local copy; the list goes to the page.
  /// full: the 12 hour check (every copy playable, failed ones tried again, the vault checked).
  private func scan(full: Bool = false) {
    var changed = false
    if full { failed.removeAll(); setPref("bg.lastFull", Date().timeIntervalSince1970) }
    if let dir = folder {
      let now = Date().timeIntervalSince1970
      let lastGood = pref("bg.lastGood") as? Double ?? now
      let seen = look(dir)
      if case .ok = seen {} else { badLooks += 1 }
      let longOff = badLooks >= 3 && now - lastGood > Backgrounds.fullEvery
      switch seen {
      case .ok(let entries):
        setPref("bg.lastGood", now)
        folderMiss = 0; badLooks = 0; lastCount = entries.count
        for c in ["BG-DRIVE-OFF", "BG-FOLDER-GONE", "BG-FOLDER-READ"] { setProblem(c, nil) }
        changed = sync(dir, entries, full: full) || changed
      case .missing(let parent):
        folderMiss += 1
        if parent && folderMiss >= 2 {
          setProblem("BG-FOLDER-GONE", Problem(code: "BG-FOLDER-GONE", subject: "", text: "PS app cannot find your Backgrounds folder in Google Drive. Your videos keep playing from this Mac.",
                                               detail: "the Backgrounds folder is not there (its parent folder is), seen \(folderMiss) times in a row"))
        } else if !parent && longOff {
          setProblem("BG-DRIVE-OFF", Problem(code: "BG-DRIVE-OFF", subject: "", text: "Google Drive looks signed out or offline on this Mac, so new videos have not come in for 12 hours. Your videos keep playing.",
                                             detail: "the Drive folder and its parent are not there for \(Int((now - lastGood) / 3600)) h (Drive signed out, offline, or the folder moved)"))
        }
      case .slow:
        if longOff {
          setProblem("BG-DRIVE-OFF", Problem(code: "BG-DRIVE-OFF", subject: "", text: "Google Drive is not answering on this Mac, so new videos have not come in for 12 hours. Your videos keep playing.",
                                             detail: "reading the Drive folder took over 20 s every time for \(Int((now - lastGood) / 3600)) h (Drive offline or stuck)"))
        }
      case .unreadable(let why):
        folderMiss += 1
        if folderMiss >= 2 {
          setProblem("BG-FOLDER-READ", Problem(code: "BG-FOLDER-READ", subject: why, text: "PS app cannot read your Backgrounds folder in Google Drive. Your videos keep playing from this Mac.",
                                               detail: "the folder is there but could not be listed (\(why))"))
        }
      }
    } else {
      for c in ["BG-DRIVE-OFF", "BG-FOLDER-GONE", "BG-FOLDER-READ", "BG-COPY", "BG-TOO-BIG"] { setProblem(c, nil) }
    }
    if full { for (id, _) in metas() where !playable(file(id)) { psLog("PS backgrounds: a copy does not play, it is made again"); remove(id); changed = true } }
    publish()
    refreshCards()
    if changed || full { pushHave(check: full) }
  }

  /// The folder's videos against the copies here. True when something changed for the vault.
  private func sync(_ dir: URL, _ entries: [Entry], full: Bool) -> Bool {
    var changed = false, present = Set<String>(), copyFail: Problem?, big: Problem?
    var m = metas()
    // A folder video keeps the id it got in the vault (a replaced version gets a new one there).
    var bySource: [String: String] = [:]
    for (id, meta) in m { if let src = meta["source"] as? String { bySource[src] = id } }
    for e in entries {
      let id = bySource[e.name] ?? Backgrounds.slug(e.name), label = String((e.name as NSString).deletingPathExtension.prefix(60))
      guard !present.contains(id) else { continue }   // two names that make the same id: the first one wins
      present.insert(id)
      missSince[id] = nil
      let sig = "\(e.size)-\(Int(e.mtime))"
      if var old = m[id] {
        if old["source"] as? String == e.name, old["sig"] as? String == sig {
          if old["gone"] as? Bool == true { old["gone"] = nil; writeMeta(id, old); changed = true }   // back in the folder
          if old["big"] as? Bool == true { big = tooBig(e.name, old["size"] as? Int ?? 0) }
          continue
        }
        // The copy an older PS made of this very video (it is in the vault already): only linked to the folder.
        if old["source"] == nil, old["vault"] as? Bool == true, old["name"] as? String == label {
          old["source"] = e.name; old["sig"] = sig
          writeMeta(id, old); m[id] = old
          psLog("PS backgrounds: a video in the vault is linked to the Drive folder")
          continue
        }
      }
      if failed[id] == sig { copyFail = copyFail ?? Problem(code: "BG-COPY", subject: e.name, text: "PS app could not turn \(label) into a background video. It tries again in 12 hours, or when the file changes.", detail: "making the silent copy of \"\(e.name)\" failed earlier (\(failedWhy[id] ?? "?"))"); continue }
      let wasVault = m[id]?["vault"] as? Bool == true
      guard let size = makeCopy(from: dir.appendingPathComponent(e.name), to: file(id)) else {
        failed[id] = sig
        copyFail = copyFail ?? Problem(code: "BG-COPY", subject: e.name, text: "PS app could not turn \(label) into a background video. It tries again in 12 hours, or when the file changes.", detail: "making the silent copy of \"\(e.name)\" failed (\(failedWhy[id] ?? "?"))")
        continue
      }
      var meta: [String: Any] = ["id": id, "name": label, "source": e.name, "sig": sig, "size": size, "vault": false]
      if wasVault { meta["replaces"] = true }   // the vault holds the old version: the new one takes its place
      if size > Backgrounds.vaultMax { meta["big"] = true; big = tooBig(e.name, size) }
      writeMeta(id, meta); m[id] = meta
      made += 1; changed = true
    }
    // Gone from the folder: missing on looks at least goneAfter apart (a Drive hiccup is not a delete).
    let now = Date().timeIntervalSince1970
    for (id, meta) in m where meta["source"] is String && !present.contains(id) && meta["gone"] as? Bool != true {
      guard let since = missSince[id] else { missSince[id] = now; continue }
      guard now - since >= goneAfter else { continue }
      missSince[id] = nil; changed = true
      if meta["vault"] as? Bool == true { var g = meta; g["gone"] = true; writeMeta(id, g); psLog("PS backgrounds: a video left the Drive folder, it leaves the vault too") }
      else { remove(id); psLog("PS backgrounds: a video left the Drive folder") }
    }
    for id in failed.keys where !present.contains(id) { failed[id] = nil }
    setProblem("BG-COPY", copyFail)
    setProblem("BG-TOO-BIG", big)
    return changed
  }
  private func tooBig(_ name: String, _ size: Int) -> Problem {
    Problem(code: "BG-TOO-BIG", subject: name, text: "\((name as NSString).deletingPathExtension) is too big to send to your phone and other Mac, even compressed. It plays on this Mac. A shorter clip fixes it.",
            detail: "the copy of \"\(name)\" is \(size / 1_000_000) MB after compressing, the most that goes to the vault is \(Backgrounds.vaultMax / 1_000_000) MB")
  }

  // ---------- Add video (the developer, 4 Nov 2026: a button in More settings, Background) ----------
  // A file the developer picks himself: read only (never moved or changed), its silent copy made here exactly
  // like a Drive folder video's, then the main window puts it in the vault once (bg:have older) and
  // every device downloads it once. It is not a folder video, so the folder never takes it away;
  // taking it out of the vault does. Progress and the result are cards; a failure is a card with
  // Copy error code (BG-ADD here, BG-UPLOAD or BG-QUOTA from the page).
  var beforePanel: () -> Void = {}               // main.swift: the Tab list steps aside for the Open panel
  private var adding: [String: String] = [:]     // id -> name: added copies on their way to the vault
  /// The developer's click: PS's Open panel, one mp4, mov or m4v. Main thread; the panel never blocks it.
  func pick() {
    guard Owner.red, !test else { return }
    beforePanel()
    let p = NSOpenPanel()
    p.allowedContentTypes = [.mpeg4Movie, .quickTimeMovie] + [UTType("com.apple.m4v-video")].compactMap { $0 }
    p.allowsMultipleSelection = false; p.canChooseDirectories = false
    p.prompt = "Add"; p.message = "Pick a video for your background. PS app makes a silent copy and sends it to your phone and other Mac."
    if #available(macOS 14.0, *) { NSApp.activate() } else { NSApp.activate(ignoringOtherApps: true) }
    p.begin { [weak self] r in if r == .OK, let url = p.url { self?.add(url) } }
  }
  /// Makes the copy of a picked file and offers it to the vault. `done` (self test): the new id, or nil.
  func add(_ src: URL, _ done: ((String?) -> Void)? = nil) {
    let name = src.lastPathComponent, label = String((name as NSString).deletingPathExtension.prefix(60))
    addCard("Making a background video from \(label)", "A silent copy, compressed for your phone. This takes a few seconds.", sticky: true)
    q.async { [self] in
      let scoped = src.startAccessingSecurityScopedResource()
      defer { if scoped { src.stopAccessingSecurityScopedResource() } }
      guard Backgrounds.videoTypes.contains(src.pathExtension.lowercased()) else { addFailed(name, "not an mp4, mov or m4v file"); DispatchQueue.main.async { done?(nil) }; return }
      try? FileManager.default.createDirectory(at: localDir, withIntermediateDirectories: true)
      let id = String(Backgrounds.slug("my " + name).prefix(41)) + "-" + String(UUID().uuidString.lowercased().prefix(6))
      guard let size = makeCopy(from: src, to: file(id)) else { addFailed(name, failedWhy[id] ?? "?"); DispatchQueue.main.async { done?(nil) }; return }
      var meta: [String: Any] = ["id": id, "name": label, "size": size, "vault": false, "added": true]
      setProblem("BG-ADD", nil)
      if size > Backgrounds.vaultMax {
        meta["big"] = true
        setProblem("BG-ADD", Problem(code: "BG-ADD", subject: name, text: "\(label) is too big to send to your phone and other Mac, even compressed. It plays on this Mac. A shorter clip fixes it.",
                                     detail: "the copy of the added video is \(size / 1_000_000) MB after compressing, the most that goes to the vault is \(Backgrounds.vaultMax / 1_000_000) MB"))
        DispatchQueue.main.async { Toast.shared.hideCard("bg:adding") }
      } else {
        adding[id] = label
        if haveAsked { addCard("Sending \(label) to your vault", "Encrypted on this Mac first. Your phone and other Mac download it once.", sticky: false) }
        else { addCard("\(label) is ready on this Mac", "It goes to your phone and other Mac when PS app is unlocked.", sticky: false) }
      }
      writeMeta(id, meta)
      made += 1
      psLog("PS backgrounds: added a video the developer picked (\(size / 1_000_000) MB)")
      publish(); refreshCards(); pushHave()
      DispatchQueue.main.async { done?(id) }
    }
  }
  private func addFailed(_ name: String, _ why: String) {
    let label = (name as NSString).deletingPathExtension
    setProblem("BG-ADD", Problem(code: "BG-ADD", subject: name, text: "PS app could not turn \(label) into a background video. Try another file, or send the error code to Claude.",
                                 detail: "making the silent copy of an added video failed (\(why))"))
    DispatchQueue.main.async { Toast.shared.hideCard("bg:adding") }
    refreshCards()
  }
  private(set) var lastAddCard = ""                // the self test reads it
  private func addCard(_ title: String, _ body: String, sticky: Bool) {
    if test { lastAddCard = title; return }
    DispatchQueue.main.async { Toast.shared.showCard(["id": "bg:adding", "title": title, "body": body, "sticky": sticky]) }
  }

  /// The Tab list's list: every copy here that is not on its way out.
  private func publish() {
    var seen: [[String: String]] = []
    for (id, m) in metas().sorted(by: { ($0.value["name"] as? String ?? $0.key) < ($1.value["name"] as? String ?? $1.key) }) where m["gone"] as? Bool != true {
      seen.append(["id": id, "name": m["name"] as? String ?? id])
    }
    list = seen
    // Sorted keys: a dictionary's order changes from one to the next, which sent the same list again every 2 minutes.
    let json = (try? JSONSerialization.data(withJSONObject: seen, options: [.sortedKeys])).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
    if json != lastJSON {
      lastJSON = json
      psLog("PS backgrounds: \(seen.count) video\(seen.count == 1 ? "" : "s") (\(seen.map { $0["name"] ?? "" }.joined(separator: ", ")))")
      DispatchQueue.main.async { self.deliver?(json) }
    }
  }

  /// Does the copy open and have a picture? (the 12 hour check)
  private func playable(_ f: URL) -> Bool {
    let sem = DispatchSemaphore(value: 0)
    final class Flag { var v = false }
    let ok = Flag()
    Task { defer { sem.signal() }
      let a = AVURLAsset(url: f)
      if let t = try? await a.loadTracks(withMediaType: .video), !t.isEmpty, let d = try? await a.load(.duration), d.seconds > 0 { ok.v = true }
    }
    return sem.wait(timeout: .now() + 15) == .success ? ok.v : true   // too slow to tell: leave it
  }

  private var failedWhy: [String: String] = [:]
  /// A silent HEVC copy (video track only), written next to it and moved into place when done; a big
  /// one is compressed again. Returns its size, or nil.
  private func makeCopy(from src: URL, to dst: URL) -> Int? {
    let id = (dst.lastPathComponent as NSString).deletingPathExtension
    let asset = AVURLAsset(url: src)
    let done = DispatchSemaphore(value: 0)
    final class Out { var ok = false; var why = ""; var seconds = 0.0 }
    let out = Out()
    // Ends in .mp4: AVFoundation cannot open a ".part" file again for the compress step.
    let tmp = dst.deletingLastPathComponent().appendingPathComponent(".\(id).making.mp4")
    Task {
      defer { done.signal() }
      guard let track = try? await asset.loadTracks(withMediaType: .video).first,
            let range = try? await asset.load(.duration) else { out.why = "no video track could be read"; return }
      out.seconds = range.seconds
      let comp = AVMutableComposition()
      guard let v = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
            (try? v.insertTimeRange(CMTimeRange(start: .zero, duration: range), of: track, at: .zero)) != nil else { out.why = "the video track could not be copied"; return }
      v.preferredTransform = (try? await track.load(.preferredTransform)) ?? .identity
      guard let ex = AVAssetExportSession(asset: comp, presetName: AVAssetExportPresetHEVC1920x1080) else { out.why = "no HEVC export on this Mac"; return }
      try? FileManager.default.removeItem(at: tmp)
      ex.outputURL = tmp
      ex.outputFileType = .mp4
      ex.shouldOptimizeForNetworkUse = true
      await ex.export()
      guard ex.status == .completed else { let e = ex.error as NSError?; out.why = "export \(e?.domain ?? "?") \(e?.code ?? 0)"; return }
      out.ok = true
    }
    done.wait()
    guard out.ok else {
      try? FileManager.default.removeItem(at: tmp)
      failedWhy[id] = out.why
      psLog("PS backgrounds: could not copy a video (\(out.why))")
      return nil
    }
    var size = (try? FileManager.default.attributesOfItem(atPath: tmp.path)[.size] as? NSNumber)?.intValue ?? 0
    if size > Backgrounds.shrinkOver, let s = shrink(tmp, seconds: out.seconds) { lastShrink = (size, s); psLog("PS backgrounds: compressed a big copy from \(size / 1_000_000) to \(s / 1_000_000) MB"); size = s }
    try? FileManager.default.removeItem(at: dst)
    guard (try? FileManager.default.moveItem(at: tmp, to: dst)) != nil, size > 0 else { failedWhy[id] = "the copy could not be saved"; return nil }
    try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: dst.path)
    psLog("PS backgrounds: made a silent copy of \(src.lastPathComponent) (\(size / 1_000_000) MB)")
    return size
  }

  /// Encodes a copy again at a bit rate that lands near shrinkTo (HEVC, same size and turn). Returns the new size.
  private func shrink(_ file: URL, seconds: Double) -> Int? {
    guard seconds > 0 else { return nil }
    let small = file.deletingLastPathComponent().appendingPathComponent(file.lastPathComponent + ".small")
    try? FileManager.default.removeItem(at: small)
    let done = DispatchSemaphore(value: 0)
    final class Flag { var ok = false }
    let flag = Flag()
    Task {
      defer { done.signal() }
      let asset = AVURLAsset(url: file)
      guard let track = try? await asset.loadTracks(withMediaType: .video).first,
            let dims = try? await track.load(.naturalSize), let turn = try? await track.load(.preferredTransform),
            let reader = try? AVAssetReader(asset: asset), let writer = try? AVAssetWriter(outputURL: small, fileType: .mp4) else { return }
      let output = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange])
      output.alwaysCopiesSampleData = false
      let bps = max(1_000_000, Int(Double(Backgrounds.shrinkTo) * 8 / seconds * 0.92))
      let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.hevc, AVVideoWidthKey: Int(dims.width), AVVideoHeightKey: Int(dims.height),
        AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: bps]])
      input.transform = turn
      input.expectsMediaDataInRealTime = false
      guard reader.canAdd(output), writer.canAdd(input) else { return }
      reader.add(output); writer.add(input)
      writer.shouldOptimizeForNetworkUse = true
      guard reader.startReading(), writer.startWriting() else { return }
      writer.startSession(atSourceTime: .zero)
      let pump = DispatchQueue(label: "PS backgrounds compress")
      await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
        var finished = false
        input.requestMediaDataWhenReady(on: pump) {
          guard !finished else { return }
          while input.isReadyForMoreMediaData {
            guard let s = output.copyNextSampleBuffer(), input.append(s) else {
              finished = true; input.markAsFinished(); c.resume(); return
            }
          }
        }
      }
      await writer.finishWriting()
      flag.ok = writer.status == .completed && reader.status == .completed
    }
    done.wait()
    guard flag.ok, let size = (try? FileManager.default.attributesOfItem(atPath: small.path)[.size] as? NSNumber)?.intValue, size > 0,
          size < ((try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.intValue ?? 0) else {
      try? FileManager.default.removeItem(at: small); return nil
    }
    try? FileManager.default.removeItem(at: file)
    guard (try? FileManager.default.moveItem(at: small, to: file)) != nil else { return nil }
    return size
  }

  // ---------- the vault's videos, through the main window (the developer's account only) ----------
  // bg:list {keep:[ids]}           the vault's list: vault videos not in it are removed here (a Drive
  //                                folder video goes back in instead); the answer is bg:have
  // bg:have {ids, older, gone, drive, check}  (to the page) the complete ones; copies to put in the
  //                                vault (older: {id,name,size,sig?,replaces?}); videos that left the
  //                                Drive folder (gone); the folder's videos (drive: {id,sig}); check:
  //                                the 12 hour check, the page makes sure the vault holds every piece
  // bg:put {id,name,index,total,data}  one piece (base64, in order); the last one makes the video
  // bg:read {id,index}             a piece of a copy (bg:piece back), to put it in the vault
  // bg:adopt {from,id}             that copy is in the vault now as id: never put in or downloaded again
  // bg:status {problems:[{code,subject,text,detail}]}  the page's own problems (uploads, the vault)
  /// Sends a message to the main window (main thread).
  var toMain: ((String) -> Void)?
  static let piece = 1_500_000
  private var partNext: [String: Int] = [:]
  private var lastKeep: Set<String> = []
  private var haveAsked = false                   // the page asked once (it is unlocked and the developer's)
  private static func okID(_ s: String?) -> String? { s.flatMap { $0.range(of: "^[a-z0-9-]{1,48}$", options: .regularExpression) != nil ? $0 : nil } }

  /// Runs on q: tells the page what is here (after its bg:list, or when the folder brought a change).
  private func pushHave(check: Bool = false, force: Bool = false) {
    guard haveAsked || force else { return }
    var have: [String] = [], older: [[String: Any]] = [], gone: [String] = [], drive: [[String: String]] = []
    for (id, meta) in metas() {
      let size = (try? FileManager.default.attributesOfItem(atPath: file(id).path)[.size] as? NSNumber)?.intValue ?? 0
      if let sig = meta["sig"] as? String, meta["source"] is String, meta["gone"] as? Bool != true { drive.append(["id": id, "sig": sig]) }
      // On this Mac already (whatever its vault state): never downloaded over the copy made here.
      if lastKeep.contains(id) { have.append(id) }
      if meta["vault"] as? Bool == true {
        if meta["gone"] as? Bool == true { gone.append(id) }
      } else if size > 0, meta["big"] as? Bool != true, meta["gone"] as? Bool != true {
        var o: [String: Any] = ["id": id, "name": meta["name"] as? String ?? id, "size": size]
        if let sig = meta["sig"] as? String { o["sig"] = sig }
        if meta["replaces"] as? Bool == true { o["replaces"] = true }
        if meta["added"] as? Bool == true { o["added"] = true }
        older.append(o)
      }
    }
    reply(["type": "bg:have", "ids": have, "older": older, "gone": gone, "drive": drive, "check": check])
  }

  func handle(_ type: String, _ m: [String: Any]) {
    guard Owner.red else { return }            // nobody else's PS keeps videos (and the page sends none)
    q.async { [self] in
      let fm = FileManager.default
      try? fm.createDirectory(at: localDir, withIntermediateDirectories: true)
      switch type {
      case "bg:list":
        let keep = Set((m["keep"] as? [String] ?? []).compactMap { Backgrounds.okID($0) })
        lastKeep = keep
        for (id, meta) in metas() where meta["vault"] as? Bool == true && !keep.contains(id) {
          if meta["source"] is String && meta["gone"] as? Bool != true {
            // Still in the Drive folder but not in the vault (lost there): it goes back in.
            var again = meta; again["vault"] = false; again["replaces"] = nil; writeMeta(id, again)
            psLog("PS backgrounds: a Drive folder video is missing from the vault, it goes back in")
          } else { remove(id); psLog("PS backgrounds: removed a video taken out of the vault") }
        }
        let first = !haveAsked
        haveAsked = true
        // The first time after launch: the full check too when it is due (or never ran).
        if first && Date().timeIntervalSince1970 - (pref("bg.lastFull") as? Double ?? 0) >= Backgrounds.fullEvery { scan(full: true) }
        else { pushHave(); scan() }
      case "bg:put":
        guard let id = Backgrounds.okID(m["id"] as? String), let i = m["index"] as? Int, let n = m["total"] as? Int, n > 0, n < 2000, i >= 0, i < n,
              let d = (m["data"] as? String).flatMap({ Data(base64Encoded: $0) }), d.count <= Backgrounds.piece else { return }
        let part = localDir.appendingPathComponent(".\(id).mp4.part")
        if i == 0 { try? fm.removeItem(at: part); fm.createFile(atPath: part.path, contents: nil, attributes: [.posixPermissions: 0o600]); partNext[id] = 0 }
        guard partNext[id] == i, let h = FileHandle(forWritingAtPath: part.path) else { partNext[id] = nil; try? fm.removeItem(at: part); return }
        h.seekToEndOfFile(); h.write(d); try? h.close()
        partNext[id] = i + 1
        guard i == n - 1 else { return }
        partNext[id] = nil
        try? fm.removeItem(at: file(id))
        guard (try? fm.moveItem(at: part, to: file(id))) != nil else { return }
        let name = String((m["name"] as? String ?? "Video").prefix(60))
        writeMeta(id, ["id": id, "name": name, "vault": true])
        made += 1
        psLog("PS backgrounds: a video from the vault is on this Mac now")
        scan()
      case "bg:read":
        guard let id = Backgrounds.okID(m["id"] as? String), let i = m["index"] as? Int, i >= 0,
              let size = (try? fm.attributesOfItem(atPath: file(id).path)[.size] as? NSNumber)?.intValue, size > 0 else { return }
        let total = (size + Backgrounds.piece - 1) / Backgrounds.piece
        guard i < total, let h = FileHandle(forReadingAtPath: file(id).path) else { return }
        try? h.seek(toOffset: UInt64(i * Backgrounds.piece))
        let d = h.readData(ofLength: Backgrounds.piece); try? h.close()
        reply(["type": "bg:piece", "id": id, "index": i, "total": total, "data": d.base64EncodedString()])
      case "bg:adopt":
        guard let from = Backgrounds.okID(m["from"] as? String), let id = Backgrounds.okID(m["id"] as? String),
              let meta = metas()[from], meta["vault"] as? Bool != true else { return }
        if from != id {   // a new id: a replaced version, or another Mac put it in first
          try? fm.removeItem(at: file(id))
          guard (try? fm.moveItem(at: file(from), to: file(id))) != nil else { return }
          try? fm.removeItem(at: localDir.appendingPathComponent("\(from).json"))
        }
        var kept = meta; kept["id"] = id; kept["vault"] = true; kept["replaces"] = nil
        writeMeta(id, kept)
        psLog("PS backgrounds: a copy is in the vault now")
        if let label = adding.removeValue(forKey: from) { addCard("\(label) is on every device now", "Added to your backgrounds. Your phone and other Mac download it once.", sticky: false) }
        scan()
      case "bg:progress":   // the page putting an added video in the vault: how far (0 to 100)
        guard let id = Backgrounds.okID(m["id"] as? String), let label = adding[id], let pct = m["pct"] as? Int, (0...100).contains(pct) else { return }
        addCard("Sending \(label) to your vault: \(pct)%", "Encrypted on this Mac first. Your phone and other Mac download it once.", sticky: false)
      case "bg:status":
        var got: [String: Problem] = [:]
        for p in (m["problems"] as? [[String: Any]] ?? []).prefix(6) {
          guard let code = p["code"] as? String, code.range(of: "^BG-[A-Z-]{2,20}$", options: .regularExpression) != nil,
                let text = p["text"] as? String, !text.isEmpty else { continue }
          got[code] = Problem(code: code, subject: String((p["subject"] as? String ?? "").prefix(80)), text: String(text.prefix(300)), detail: String((p["detail"] as? String ?? "").prefix(400)))
        }
        pageProblems = got
        // An added video's upload failed: its progress card goes, the problem's card (Copy error code) shows.
        if !adding.isEmpty && (got["BG-UPLOAD"] != nil || got["BG-QUOTA"] != nil) {
          adding.removeAll(); lastAddCard = ""
          if !test { DispatchQueue.main.async { Toast.shared.hideCard("bg:adding") } }
        }
        refreshCards()
      default: break
      }
    }
  }
  private func file(_ id: String) -> URL { localDir.appendingPathComponent("\(id).mp4") }
  private func remove(_ id: String) {
    try? FileManager.default.removeItem(at: file(id))
    try? FileManager.default.removeItem(at: localDir.appendingPathComponent("\(id).json"))
  }
  private func writeMeta(_ id: String, _ m: [String: Any]) {
    if let d = try? JSONSerialization.data(withJSONObject: m) { try? d.write(to: localDir.appendingPathComponent("\(id).json"), options: .atomic) }
  }
  /// Every video here with its note (id -> note).
  private func metas() -> [String: [String: Any]] {
    var out: [String: [String: Any]] = [:]
    for n in (try? FileManager.default.contentsOfDirectory(atPath: localDir.path)) ?? [] where n.hasSuffix(".json") && !n.hasPrefix(".") {
      if let d = try? Data(contentsOf: localDir.appendingPathComponent(n)), let m = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
         let id = Backgrounds.okID(m["id"] as? String), FileManager.default.fileExists(atPath: file(id).path) { out[id] = m }
    }
    return out
  }
  private func reply(_ m: [String: Any]) {
    guard let d = try? JSONSerialization.data(withJSONObject: m), let j = String(data: d, encoding: .utf8) else { return }
    DispatchQueue.main.async { self.toMain?(j) }
  }

  // ---------- serving a copy to the page, with byte ranges (video needs them) ----------
  // The file is read on a background queue (never the main thread), at most 4 MB per answer
  // (a video asks for "the rest of the file" and takes it in pieces), and a request the page has
  // already cancelled is never answered.
  private let ioQ = DispatchQueue(label: "PS backgrounds files", qos: .userInitiated)
  static let chunk: Int64 = 4 << 20
  func serve(_ id: String, _ task: WKURLSchemeTask, _ url: URL, alive: @escaping () -> Bool) -> Bool {
    guard id.range(of: "^[a-z0-9-]{1,48}$", options: .regularExpression) != nil else { return false }
    let file = localDir.appendingPathComponent("\(id).mp4")
    guard let size = (try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.int64Value, size > 0 else { return false }
    let range = task.request.value(forHTTPHeaderField: "Range")
    ioQ.async {
      var start: Int64 = 0, end: Int64 = size - 1, partial = false
      if let r = range, let m = r.range(of: #"bytes=(\d*)-(\d*)"#, options: .regularExpression) {
        let parts = r[m].dropFirst(6).split(separator: "-", omittingEmptySubsequences: false).map(String.init)
        if let a = Int64(parts[0]) { start = a; if parts.count > 1, let b = Int64(parts[1]) { end = min(b, size - 1) } }
        else if parts.count > 1, let n = Int64(parts[1]) { start = max(0, size - n) }
        partial = true
      }
      end = min(end, start + Backgrounds.chunk - 1)
      var data = Data()
      if start <= end, let h = try? FileHandle(forReadingFrom: file) {
        try? h.seek(toOffset: UInt64(start))
        data = h.readData(ofLength: Int(end - start + 1))
        try? h.close()
      }
      DispatchQueue.main.async {
        guard alive() else { return }
        if data.isEmpty {
          let r = HTTPURLResponse(url: url, statusCode: 416, httpVersion: "HTTP/1.1", headerFields: ["Content-Range": "bytes */\(size)"])!
          task.didReceive(r); task.didFinish(); return
        }
        var headers = ["Content-Type": "video/mp4", "Content-Length": "\(data.count)", "Accept-Ranges": "bytes", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff"]
        if partial || Int64(data.count) < size { headers["Content-Range"] = "bytes \(start)-\(start + Int64(data.count) - 1)/\(size)"; self.ranges += 1 }
        let resp = HTTPURLResponse(url: url, statusCode: partial || Int64(data.count) < size ? 206 : 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(resp)
        task.didReceive(data)
        task.didFinish()
      }
    }
    return true
  }
  private(set) var ranges = 0                     // partial requests served (the self test reads it)
}
