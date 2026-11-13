// "Connect your own Supabase" (5 Nov 2026). The developer gave PS to a friend: the friend must not use the developer's
// Supabase, and had no way to make an account. This window (ui/supabase.html, built into the app) walks
// anyone through it in three plain steps: make a free Supabase account, make a personal access token,
// paste it. PS then creates a project of their own (or takes an empty one they pick), sets it up from
// the kit inside the app (ProjectEngine.swift) and opens the Sign in window on Create account.
// When it shows: at first launch on a Mac that never used PS's default server (no saved sign in, nobody
// ever unlocked PS here), from the Sign in window's link, from Mac settings and from the PS menu
// (Supabase Project...). The developer's Macs never see it unasked.
// The access token: in memory while the window works; kept in this Mac's Keychain only if the person
// leaves "Keep it" ticked, so later PS versions can update the project's database (ProjectUpdate below).
// Never logged, printed, sent to the page that holds the vault, or anywhere but api.supabase.com.
// All network work runs on its own queue, never on the main thread.
import AppKit
import WebKit
import Security

// MARK: - the token in the Keychain (this Mac only, never iCloud), one item per build like Remember.swift

enum SupabaseToken {
  static let service = "com.cincee.ps.supabase-token"
  static var account: String { Remember.account }
  private static func base(_ acct: String = account) -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: acct]
  }
  @discardableResult private static func quietly<T>(_ body: () -> T) -> T {
    KeychainQuiet.run(body)   // one lock for the whole app (KeychainQuiet.swift)
  }
  static func save(_ token: String) {
    guard !ProjectStore.test else { return }
    quietly { SecItemDelete(base() as CFDictionary) }
    var q = base()
    q[kSecValueData as String] = Data(token.utf8)
    q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    q[kSecAttrSynchronizable as String] = false
    q[kSecAttrLabel as String] = "PS Supabase access token (this Mac only)"
    let st = quietly { SecItemAdd(q as CFDictionary, nil) }
    psLog("PS project: access token kept in the Keychain=\(st == errSecSuccess ? 1 : 0)")
  }
  static func read() -> String? {
    guard !ProjectStore.test else { return nil }
    var q = base()
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    guard quietly({ SecItemCopyMatching(q as CFDictionary, &out) }) == errSecSuccess, let d = out as? Data,
          let t = String(data: d, encoding: .utf8), SupabaseAPI.validToken(t) else { return nil }
    return t
  }
  static func forget() { guard !ProjectStore.test else { return }; quietly { SecItemDelete(base() as CFDictionary) } }
}

// MARK: - the window

final class ProjectSetup: NSObject, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate {
  static let shared = ProjectSetup()
  enum Mode: String { case first, change, update }

  /// True while PS waits for a project before loading its page (first launch, nothing chosen yet).
  private(set) var holding = false
  private(set) weak var app: App?
  private(set) var window: NSWindow?
  private(set) var web: WKWebView?
  private(set) var ready = false
  private var queued: [String] = []
  private let q = DispatchQueue(label: "PS project setup", qos: .userInitiated)
  private var mode: Mode = .first
  private var token: String?              // in memory only while this window works
  private var caughtToken: String?        // V1.49: copied on the guide's Copy step, waiting for the page's tick to finish
  private var keep = true
  private var orgs: [SBOrg] = []
  private var working = false { didSet { if working != oldValue { SetupIsland.shared.supabaseWorking(working) } } }   // V1.58: the island's loading square
  private var stop = false
  private var retry: (() -> Void)?
  private var finished: PSProject?
  private var updateTried = ""
  private let test = ProjectStore.test
  private var testOnly: Bool { ProcessInfo.processInfo.environment["PS_SELFTEST_ONLY"] == "project" }

  static func addPageScript(_ uc: WKUserContentController) {
    if let s = ProjectStore.pageScript(ProjectStore.current) {
      uc.addUserScript(WKUserScript(source: s, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }
    // Local first (V1.44): the installer's answer to "Where should your list live?", so the page's own choice
    // screen opens on it (never asked twice). Only the two known words ever reach the page.
    if ProjectStore.current == nil, let c = ProjectStore.setupStore {
      uc.addUserScript(WKUserScript(source: "Object.defineProperty(window,'__psSetup',{value:'\(c)',writable:false,configurable:false});", injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }
  }

  // MARK: launch

  /// Loads PS's page now, or first asks for a project on a Mac that never used PS's default server.
  func launch(_ app: App) {
    self.app = app
    if (test && !testOnly) || ProjectStore.current != nil || ProjectStore.knownDefault || ProjectStore.skipped || ProjectStore.usedBefore {
      if !test && ProjectStore.usedBefore && ProjectStore.current == nil { ProjectStore.knownDefault = true }
      app.loadMain()
      if ProjectStore.custom { DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in self?.checkForUpdate() } }
      return
    }
    // Local first (V1.44, the developer 8 Nov 2026: "new people should get in instantly with no database"): a Mac that never
    // used PS opens PS's page at once, never this window first. Its Sign in offers Start now (a name only: the data is
    // encrypted on this Mac, its key in the Keychain, LocalKey.swift), Connect your own Supabase (this window, in
    // Change mode) and Sign in. Turn on sync later opens this window from the page and moves everything across.
    psLog("PS project: no Supabase project chosen on this Mac yet, opening local first (choice: \(ProjectStore.setupStore ?? "none"))")
    app.loadMain()
    // The installer's "Sync with your own Supabase": this window opens once by itself, next to the page. Closing it
    // or "Keep everything on this Mac instead" leaves the page's choice screen, so nothing is forced.
    if ProjectStore.setupStore == "sync" && ProjectStore.flag(ProjectSetup.syncShownKey) == nil {
      ProjectStore.setFlag(ProjectSetup.syncShownKey, true)
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in self?.show(mode: .first) }
    }
  }
  static let syncShownKey = "setup.syncShown"
  /// Opened from the page's Turn on sync while the list lives on this Mac (the window then says it moves everything).
  private var fromLocal = false
  func show(mode m: Mode, fromLocal local: Bool) { fromLocal = local; show(mode: m) }

  /// The page unlocked: on the default project, this Mac now counts as one that uses it.
  func unlocked() { if ProjectStore.current == nil && !ProjectStore.knownDefault && !test { ProjectStore.knownDefault = true } }

  /// The first account exists: its one time code is spent, so it is not kept or handed to the page again.
  func accountCreated() {
    guard var p = ProjectStore.current, p.setupCode != nil else { return }
    p.setupCode = nil
    try? ProjectStore.save(p)
    psLog("PS project: first account created")
  }

  // MARK: window

  func show(mode m: Mode) {
    SetupIsland.shared.supabase(open: true)   // V1.58 setup island: this window's hint
    if working, window != nil { present(); return }
    mode = m
    if window == nil { build() }
    reset()
    present()
  }

  private func build() {
    let c = WKWebViewConfiguration()
    c.websiteDataStore = .nonPersistent()
    if IS_TEST_COPY, let list = testBlockList { c.userContentController.add(list) }
    c.preferences.isFraudulentWebsiteWarningEnabled = false
    c.userContentController.add(self, name: "sb")
    let size = NSSize(width: 640, height: 700)   // 700 since V1.44: room for the one line about projects that hold your own app
    let v = ClickThroughWebView(frame: NSRect(origin: .zero, size: size), configuration: c)
    v.setValue(false, forKey: "drawsBackground")
    v.navigationDelegate = self
    let w = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled, .closable, .fullSizeContentView], backing: .buffered, defer: false)
    w.titlebarAppearsTransparent = true
    w.titleVisibility = .hidden
    w.isMovableByWindowBackground = true
    w.backgroundColor = NSColor(red: 0.078, green: 0.067, blue: 0.086, alpha: 1)
    w.appearance = NSAppearance(named: .darkAqua)
    w.isReleasedWhenClosed = false
    w.title = "Connect your own Supabase"
    w.contentView = v
    w.delegate = self
    w.center()
    if IS_TEST_COPY { w.alphaValue = 0; w.ignoresMouseEvents = true }
    window = w; web = v; ready = false
    let file = Bundle.main.resourceURL!.appendingPathComponent("supabase.html")
    v.loadFileURL(file, allowingReadAccessTo: file)
  }

  private func present() {
    guard let w = window else { return }
    if IS_TEST_COPY { w.orderFrontRegardless(); return }
    if Protected.front { w.orderFrontRegardless(); return }   // never take focus over 1Password or Signal
    w.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
  }

  private func reset() {
    SetupGuide.shared.stop(quiet: true); caughtToken = nil
    stop = false; retry = nil; finished = nil; orgs = []
    let cur = ProjectStore.current
    call("start", ["mode": mode.rawValue, "linked": cur.map { ["ref": $0.ref, "name": $0.name ?? $0.ref] } as Any? ?? NSNull(),
                   // Local first (V1.44): offer "Keep everything on this Mac instead" while no project of their own is
                   // linked; fromLocal: the list already lives on this Mac and moves into the project afterwards.
                   "canLocal": cur == nil && mode != .update, "fromLocal": fromLocal, "fresh": cur == nil && !ProjectStore.knownDefault,
                   "hasToken": false, "region": ProjectEngine.region(forTimeZone: TimeZone.current.identifier),
                   "regions": ProjectEngine.regions.map { ["code": $0.code, "label": $0.label] }])
  }

  func windowWillClose(_ n: Notification) {
    SetupIsland.shared.supabase(open: false)
    SetupGuide.shared.stop(); caughtToken = nil   // V1.49: the guide goes with the window
    if working { stop = true }
    fromLocal = false
    token = nil
    // First launch with nothing chosen: PS stays without a page; Sign in or the PS menu brings this back.
    if holding { psLog("PS project: setup window closed before a project was chosen") }
  }

  /// Calls window.__sb.<fn>(arg) once the page is ready.
  private func call(_ fn: String, _ arg: Any? = nil) {
    var a = "null"
    if let arg, let d = try? JSONSerialization.data(withJSONObject: arg, options: [.fragmentsAllowed]), let s = String(data: d, encoding: .utf8) { a = s }
    let js = "window.__sb && window.__sb.\(fn)(\(a))"
    if ready { web?.evaluateJavaScript(js, completionHandler: nil) } else { queued.append(js) }
  }
  private func ui(_ fn: String, _ arg: Any? = nil) { DispatchQueue.main.async { self.call(fn, arg) } }

  func webView(_ webView: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    decisionHandler(a.request.url?.isFileURL == true ? .allow : .cancel)
  }

  // MARK: page messages (the setup page only: it holds no vault data)

  static let links = ["signup": "https://supabase.com/dashboard/sign-up", "tokens": "https://supabase.com/dashboard/account/tokens",
                      "dashboard": "https://supabase.com/dashboard/projects"]

  func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.webView === web, let s = message.body as? String,
          let o = try? JSONSerialization.jsonObject(with: Data(s.utf8)) as? [String: Any], let t = o["type"] as? String else { return }
    switch t {
    case "ready":
      ready = true
      queued.forEach { web?.evaluateJavaScript($0, completionHandler: nil) }; queued = []
      // Just updated on a Mac with no project yet (the developer's friend on V1.35): PS holds its page back, so this
      // window is the page that proves the new build started. Without it the update would roll back after 90 s.
      if holding { Updater.shared.pageReady() }
    case "open":   // the buttons that open Supabase's own pages in the browser
      if let k = o["what"] as? String, let l = ProjectSetup.links[k], let u = URL(string: l), !test { NSWorkspace.shared.open(u) }
    case "guide":   // V1.49: "Sign up free" or "Show me how": PS app opens Supabase and guides each click on screen
      guard !working, !test, let from = (o["from"] as? String).flatMap(GuideCore.Stage.init(rawValue:)) else { return }
      startGuide(from: from)
    case "guideStop": SetupGuide.shared.stop()
    case "useCaught":   // the page finished its "Token received" animation: carry on with the copied token
      guard !working, let tok = caughtToken else { return }
      caughtToken = nil
      keep = o["keep"] as? Bool ?? true
      token = tok
      mode == .update ? runUpdate() : checkToken()
    case "token":
      guard !working, let raw = o["token"] as? String else { return }
      SetupGuide.shared.stop(); caughtToken = nil
      let tok = raw.trimmingCharacters(in: .whitespacesAndNewlines)
      keep = o["keep"] as? Bool ?? true
      guard SupabaseAPI.validToken(tok) else { call("tokenError", "That does not look like a Supabase access token. It starts with sbp_."); return }
      token = tok
      mode == .update ? runUpdate() : checkToken()
    case "create":
      guard let org = o["org"] as? String, let region = o["region"] as? String, ProjectEngine.regions.contains(where: { $0.code == region }) else { return }
      createProject(org: org, region: region)
    case "use":
      guard let ref = o["ref"] as? String, ref.range(of: #"^[a-z0-9]{20}$"#, options: .regularExpression) != nil, let name = o["name"] as? String else { return }
      if ProjectEngine.isUntouchable(ref) { call("error", ["message": "PS cannot use that project. Pick another one.", "retry": false]); return }
      useProject(ref: ref, name: name)
    case "retry": retry?()
    case "back": if !working { reset() }
    case "skip":   // first launch only: this Mac signs in with an account on PS's default server
      guard mode == .first, !working else { return }
      ProjectStore.skipped = true
      psLog("PS project: skipped, using the default project")
      if holding { finishWith(nil) } else { window?.close(); app?.showSignIn() }   // local first: the page is open already
    case "local":   // "Keep everything on this Mac instead" (V1.44): no Supabase; the page's choice screen does the rest
      guard mode != .update, ProjectStore.current == nil, !working else { return }
      ProjectStore.setupStore = "local"
      psLog("PS project: keep everything on this Mac")
      window?.close()
      if holding { holding = false; app?.loadMain() }
      app?.showSignIn()
    case "default":   // Change project: back to PS's default server
      guard mode == .change, !working else { return }
      apply(nil)
    case "done":
      finishWith(finished)
    case "close": window?.close()
    default: break
    }
  }

  private func api() -> SupabaseAPI? {
    guard let token else { return nil }
    let env = ProcessInfo.processInfo.environment
    // Unit and self tests only: a local stand in for api.supabase.com.
    if (test || env["PS_PROJECT_TEST"] == "1"), let b = env["PS_SUPABASE_API"], let u = URL(string: b), u.host == "127.0.0.1" { return SupabaseAPI(token: token, base: u) }
    return SupabaseAPI(token: token)
  }

  private func failed(_ e: Error, again: @escaping () -> Void) {
    let words = (e as? SBError)?.message ?? "Something went wrong. Try again."
    psLog("PS project: setup stopped (\((e as? SBError)?.status ?? -1))")
    DispatchQueue.main.async {
      self.working = false
      self.retry = again
      self.call("error", ["message": words, "retry": true])
    }
  }

  private func engine(_ a: SupabaseAPI) throws -> ProjectEngine {
    let kit = try ProjectKit.load()
    let e = ProjectEngine(api: a, kit: kit)
    e.cancelled = { [weak self] in self?.stop ?? true }
    e.report = { [weak self] step, st, frac, detail in
      var o: [String: Any] = ["id": step.rawValue, "state": st]
      if let frac { o["frac"] = frac }
      if let detail { o["detail"] = detail }
      self?.ui("step", o)
    }
    return e
  }

  // MARK: the token guide (V1.49, SetupGuide.swift)

  /// Opens Supabase at the exact page and shows the step card and arrows beside the browser. When the token is
  /// copied on the last step, this window comes to the front by itself with it already in.
  private func startGuide(from: GuideCore.Stage) {
    let g = SetupGuide.shared
    g.onStep = { [weak self] st in self?.call("guideStep", st.rawValue) }
    g.onEnd = { [weak self] back in
      guard let self else { return }
      self.call("guideEnded", ["focus": back])
      if back { self.comeForward() }
    }
    g.onToken = { [weak self] tok in
      guard let self, self.window?.isVisible == true, !self.working, SupabaseAPI.validToken(tok) else { return }
      self.caughtToken = tok   // never shown to the page: it only learns that a token arrived
      self.comeForward()
      self.call("caught", ["update": self.mode == .update])
    }
    call("guideStarted", from.rawValue)
    g.start(from: from)
  }

  /// PS app's window to the front, by itself. Never takes focus over 1Password or Signal (it then only shows).
  /// Held above other windows for a moment, because macOS may let the browser keep the focus.
  private func comeForward() {
    guard let w = window else { return }
    if Protected.front || IS_TEST_COPY { w.orderFrontRegardless(); return }
    w.level = .floating
    w.orderFrontRegardless()
    w.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { [weak w] in w?.level = .normal }
  }

  // MARK: the flow

  static let perms = "Database, Edge Functions and Data API Config (read and write), and API Keys and Project Settings (read)"

  private func checkToken() {
    guard let a = api() else { return }
    working = true
    call("busy", "Checking your token")
    q.async { [self] in
      do {
        // Supabase's scoped tokens (7 Nov 2026, a friend's first tries) can be limited to one project: they see
        // no organisation (an empty list or a 403) and often no project list either. PS then offers only "use
        // an existing project", where the person can also paste the project's address.
        var orgs: [SBOrg] = [], projects: [SBProject] = []
        do { orgs = try a.orgs() } catch let e as SBError where e.status == 403 { orgs = [] }
        do { projects = try a.projects() } catch let e as SBError where e.status == 403 || e.status == 404 { projects = [] }
        if orgs.isEmpty { psLog("PS project: token sees no organisation (\(projects.count) project\(projects.count == 1 ? "" : "s"), \(a.scopedToken ? "scoped" : "classic") token)") }
        DispatchQueue.main.async {
          self.working = false
          self.orgs = orgs
          self.call("choose", ["scoped": orgs.isEmpty, "orgs": orgs.map { ["slug": $0.slug, "name": $0.name] },
                               "projects": projects.filter { !ProjectEngine.isUntouchable($0.ref) }.map { ["ref": $0.ref, "name": $0.name, "org": $0.org, "region": $0.region, "status": $0.status] }])
        }
      } catch { self.failed(error) { [weak self] in self?.checkToken() } }
    }
  }

  /// Create, then finish. A project made on an earlier try is finished, never made twice.
  private func createProject(org: String, region: String) {
    guard let a = api(), !working else { return }
    working = true; stop = false
    call("work", ["create": true])
    q.async { [self] in
      do {
        let e = try engine(a)
        let pending = ProjectStore.flag("project.pending") as? String
        let ref: String, name: String
        if let pending, let p = try? a.project(ref: pending), !["REMOVED", "GOING_DOWN"].contains(p.status.uppercased()) {
          ref = p.ref; name = p.name
          e.report(.create, "done", 1, "\(p.name) created")
        } else {
          let p = try e.create(org: org, region: region)
          ProjectStore.setFlag("project.pending", p.ref)
          ref = p.ref; name = p.name
        }
        let done = try e.finish(ref: ref, name: name)
        ProjectStore.setFlag("project.pending", nil)
        succeeded(done)
      } catch { self.failed(error) { [weak self] in self?.createProject(org: org, region: region) } }
    }
  }

  private func useProject(ref: String, name: String) {
    guard let a = api(), !working else { return }
    working = true; stop = false
    call("work", ["create": false])
    q.async { [self] in
      do {
        let e = try engine(a)
        let prev = ProjectStore.current
        succeeded(try e.finish(ref: ref, name: name, previous: prev))
      } catch { self.failed(error) { [weak self] in self?.useProject(ref: ref, name: name) } }
    }
  }

  private func succeeded(_ p: PSProject) {
    if keep, let token { SupabaseToken.save(token) } else { SupabaseToken.forget() }
    DispatchQueue.main.async {
      self.working = false
      self.finished = p
      self.call("done", ["ref": p.ref, "name": p.name ?? p.ref, "first": p.setupCode != nil, "kept": self.keep])
    }
  }

  /// "Create your account" (or Sign in): save, then load PS's page against the new project.
  private func finishWith(_ p: PSProject?) {
    if let p { apply(p) } else {
      holding = false
      token = nil
      window?.close()
      app?.loadMain()
      app?.showSignIn()
    }
  }

  /// Switches this Mac to `p` (nil: PS's default server). The old sign in is forgotten: it belongs to the old project.
  func apply(_ p: PSProject?) {
    guard let app else { return }
    let changed = p?.ref != ProjectStore.current?.ref
    do { if let p { try ProjectStore.save(p) } else { ProjectStore.clear(); SupabaseToken.forget() } }
    catch { call("error", ["message": "PS could not save this on your Mac: \(error.localizedDescription)", "retry": false]); return }
    if changed {
      Owner.set(false); if !test { UserDefaults.standard.set(false, forKey: "owner.red") }
      if !test { q.async { Remember.forget(); TouchLock.signOut() } }
    }
    if p == nil { ProjectStore.skipped = true }
    token = nil
    holding = false
    // Every page made before now has the old project's script: give them the new one, then reload.
    for v in [app.main, app.overlay, app.secondWin.web] {
      guard let uc = v?.configuration.userContentController else { continue }
      uc.removeAllUserScripts()
      ProjectSetup.addPageScript(uc)
    }
    if p != nil { SetupIsland.shared.supabaseLinked() }   // V1.58 setup island: green tick
    window?.close()
    app.hideOverlay(force: true)
    if app.main?.url != nil || changed { app.sendToMain(#"{"type":"lock"}"#) }
    app.loadMain()
    app.overlay?.load(URLRequest(url: URL(string: "ps://app/client/overlay")!))
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { app.showSignIn() }
  }

  // MARK: updates (ProjectUpdate): a newer PS brings new migrations or functions for a linked project

  /// At launch (20 s in) and when asked: applies the kit if it changed since the last time, with the
  /// kept token. With no token kept (or it stopped working) the window asks for one.
  func checkForUpdate() {
    guard let p = ProjectStore.current, ProjectStore.custom, !working, let kit = try? ProjectKit.load(), p.kit != kit.kit, updateTried != kit.kit else { return }
    updateTried = kit.kit
    q.async { [self] in
      guard let tok = SupabaseToken.read() else {
        psLog("PS project: an update for the linked project is waiting, no access token kept")
        DispatchQueue.main.async { self.show(mode: .update) }
        return
      }
      do {
        let e = ProjectEngine(api: SupabaseAPI(token: tok), kit: kit)
        let q2 = try e.update(p)
        DispatchQueue.main.async { try? ProjectStore.save(q2) }
      } catch {
        psLog("PS project: update of the linked project stopped (\((error as? SBError)?.status ?? -1))")
        DispatchQueue.main.async { self.show(mode: .update); self.call("error", ["message": (error as? SBError)?.message ?? "The update stopped.", "retry": false]) }
      }
    }
  }

  private func runUpdate() {
    guard let a = api(), let p = ProjectStore.current, !working else { return }
    working = true; stop = false
    call("work", ["update": true])
    q.async { [self] in
      do {
        let e = try engine(a)
        let q2 = try e.update(p)
        if keep, let token { SupabaseToken.save(token) }
        DispatchQueue.main.async {
          try? ProjectStore.save(q2)
          self.working = false; self.token = nil
          self.call("updated", ["ref": q2.ref])
        }
      } catch { self.failed(error) { [weak self] in self?.runUpdate() } }
    }
  }
}
