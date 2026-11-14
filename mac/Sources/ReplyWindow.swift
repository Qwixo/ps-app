import AppKit
import WebKit

// Reply from PS (V1.44): the compose window around the page /reply-window (web/src/views/ReplyWindow.tsx).
// One see through panel with three looks the page picks: the compose screen in the middle of the screen (takes the
// keyboard, PS comes to the front so Tab moves between the fields), the pill at the bottom while a reply waits, and
// the queue it opens (neither takes the keyboard). Like the Tab list it holds no keys and no vault: the main page
// sends the email being answered and the developer's signatures and responses ({type:"reply:open"}), MailSend.swift sends the
// sign in status and the queue. Its "looks" messages (a saved response, a signature) go to the main page.
// It opens only on the developer's click on a card's Reply (or Settings, Scheduled replies), never over 1Password or Signal.
// Esc: the page answers it itself (EscAlways.swift .own): a menu first, then "Throw away this reply?", then it closes.

/// The panel: key only while the compose screen shows.
final class ReplyPanel: NSPanel {
  var keyable = false
  override var canBecomeKey: Bool { keyable }
  override var canBecomeMain: Bool { false }
}

final class ReplyWebView: WKWebView {
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

final class ReplyWindow: NSObject {
  private weak var app: App?
  private(set) var panel: ReplyPanel?
  private(set) var web: WKWebView?
  private(set) var ready = false
  private var calls: [(String, Any)] = []
  private(set) var mode = "hidden"
  private var returnTo: NSRunningApplication?
  private var topEdge: CGFloat?
  private let test = IS_TEST_COPY
  private static let url = URL(string: "ps://app/client/reply-window")!

  init(app: App) { self.app = app }
  func isWeb(_ v: WKWebView?) -> Bool { v != nil && v === web }

  private func ensure() {
    guard panel == nil, let app else { return }
    let p = ReplyPanel(contentRect: NSRect(x: 0, y: 0, width: 820, height: 760), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    p.isOpaque = false; p.backgroundColor = .clear; p.hasShadow = false
    p.level = .floating
    p.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
    p.isReleasedWhenClosed = false; p.hidesOnDeactivate = false
    p.animationBehavior = .none   // the page animates the card itself
    let c = app.config()
    if test, #available(macOS 14.0, *) { c.preferences.inactiveSchedulingPolicy = .none }
    let v = ReplyWebView(frame: p.contentView?.bounds ?? .zero, configuration: c)
    v.setValue(false, forKey: "drawsBackground")
    v.autoresizingMask = [.width, .height]
    v.uiDelegate = app
    v.navigationDelegate = app
    p.contentView = v
    panel = p; web = v; ready = false
    v.load(URLRequest(url: ReplyWindow.url))
  }

  /// The main page loaded a newer build: this page follows (an open compose screen keeps nothing typed; it only
  /// reloads when nothing is showing).
  func reloadPage() {
    guard let v = web, mode == "hidden" else { return }
    ready = false
    v.load(URLRequest(url: ReplyWindow.url))
  }

  private func call(_ fn: String, _ arg: Any) {
    guard ready, let web else { calls.append((fn, arg)); if calls.count > 20 { calls.removeFirst() }; return }
    guard JSONSerialization.isValidJSONObject(["a": arg]), let d = try? JSONSerialization.data(withJSONObject: ["a": arg]), let s = String(data: d, encoding: .utf8) else { return }
    web.callAsyncJavaScript("window.__psReply && window.__psReply[f](JSON.parse(s).a)", arguments: ["f": fn, "s": s], in: nil, in: .page, completionHandler: nil)
  }

  // MARK: from the main page and MailSend

  /// A card's Reply: the compose screen for that email (the developer's click).
  func open(ctx: Any, prefs: Any, job: Any? = nil, tries: Int = 0) {
    if !test && Protected.front {   // golden rule: never over 1Password or Signal; it opens once they are not in front
      if tries < 30 { DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in self?.open(ctx: ctx, prefs: prefs, job: job, tries: tries + 1) } }
      return
    }
    ensure()
    if let app, app.shown { app.hideOverlay(force: true, giveBack: false) }   // the Tab list floats above: it goes first
    var o: [String: Any] = ["ctx": ctx, "prefs": prefs]
    if let job { o["job"] = job }
    status(); queue()
    call("open", o)
    psLog("PS reply: compose window opened")
  }
  func prefs(_ p: Any) { if panel != nil { call("prefs", p) } }
  func status() { if panel != nil { call("status", MailSend.shared.settingsJSON()) } }
  func queue() { if panel != nil { call("queue", MailSend.shared.rows) } }
  /// Settings, Scheduled replies: the queue at the bottom of the screen.
  func showQueue() { ensure(); status(); queue(); call("show", "queue") }
  /// After Send or Schedule (and on start, when something is waiting): the pill.
  func showPill() { ensure(); queue(); call("show", "pill") }

  // MARK: from its page

  /// Every message from the reply window's page. Nothing from it reaches main.swift's other cases.
  func handle(_ type: String, _ msg: [String: Any], _ text: String) {
    switch type {
    case "reply:ready":
      ready = true
      let c = calls; calls = []
      for (f, a) in c { call(f, a) }
    case "reply:size":
      size(msg["mode"] as? String ?? "hidden", CGFloat((msg["w"] as? NSNumber)?.doubleValue ?? 0), CGFloat((msg["h"] as? NSNumber)?.doubleValue ?? 0))
    case "reply:queue":
      if let j = msg["job"] as? [String: Any] { MailSend.shared.queue(j, undo: (msg["undo"] as? Bool) == true) }
    case "reply:undo", "reply:edit":
      guard let id = msg["id"] as? String else { return }
      MailSend.shared.takeBack(id, why: type == "reply:undo" ? "undone" : "taken back to edit") { [weak self] page in
        guard let self else { return }
        guard let page, let d = page["draft"] as? [String: Any], let ctx = d["ctx"] else { self.call("note", "Too late: it has gone."); return }
        self.open(ctx: ctx, prefs: self.lastPrefs ?? ([:] as [String: Any]), job: page)
      }
    case "reply:cancel": if let id = msg["id"] as? String { MailSend.shared.cancel(id) }
    case "reply:sendNow": if let id = msg["id"] as? String { MailSend.shared.sendNow(id) }
    case "reply:dismiss": if let id = msg["id"] as? String { MailSend.shared.dismiss(id) }
    case "reply:connect": connect(msg)
    case "reply:close": giveBack()
    case "looks": app?.sendToMain(text)   // a signature or a saved response: the main page saves it (src/replyengine.ts)
    case "log": if let t = msg["text"] as? String { psLog("PS reply window: " + String(t.prefix(200))) }
    default: break
    }
  }
  /// The prefs the main page sent last (Edit and Undo open the compose screen again with them).
  var lastPrefs: Any?

  func connect(_ msg: [String: Any]) {
    if (msg["via"] as? String) == "instantly" { MailSend.shared.connectInstantly() }
    else if let a = msg["account"] as? String { MailSend.shared.connectGmail(a) }
  }

  private func size(_ m: String, _ w: CGFloat, _ h: CGFloat) {
    guard let p = panel else { return }
    let was = mode
    mode = ["compose", "pill", "queue"].contains(m) && w > 0 && h > 0 ? m : "hidden"
    if mode == "hidden" { p.orderOut(nil); p.keyable = false; topEdge = nil; if was == "compose" { giveBack() }; return }
    let screen = (mode == "compose" ? NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } : nil) ?? p.screen ?? NSScreen.main
    guard let vf = screen?.visibleFrame else { return }
    let width = min(w, vf.width - 20), height = min(h, vf.height - 20)
    var f = NSRect(x: vf.midX - width / 2, y: 0, width: width, height: height)
    if mode == "compose" {
      // Centred when it opens; after that the top edge stays put and it grows down (no jumping while typing).
      if was != "compose" || topEdge == nil { topEdge = vf.midY + height / 2 + min(60, (vf.height - height) / 4) }
      f.origin.y = max(vf.minY + 10, min(vf.maxY - height - 10, topEdge! - height))
      if was == "compose" { f.origin.x = p.frame.midX - width / 2 }
    } else {
      f.origin.y = vf.minY + 6
      topEdge = nil
    }
    if p.frame != f { p.setFrame(f, display: true) }
    if mode == "compose" {
      if !test && !Protected.front {
        if was != "compose" { returnTo = NSWorkspace.shared.frontmostApplication.flatMap { $0.processIdentifier == ProcessInfo.processInfo.processIdentifier ? nil : $0 } }
        p.keyable = true
        p.makeKeyAndOrderFront(nil)
        if #available(macOS 14.0, *) { NSApp.activate() } else { NSApp.activate(ignoringOtherApps: true) }
        p.makeFirstResponder(web)
      } else { p.orderFrontRegardless() }
    } else {
      if was == "compose" { giveBack() }
      p.keyable = false
      if p.isKeyWindow { p.resignKey() }
      if test { p.alphaValue = 0 }
      if !Protected.front || test { p.orderFrontRegardless() } else { p.orderOut(nil) }
    }
    if test { p.alphaValue = 0; p.ignoresMouseEvents = true }
  }

  /// The keyboard goes back to the app the developer was in.
  private func giveBack() {
    panel?.keyable = false
    guard !test, let a = returnTo else { return }
    returnTo = nil
    if !a.isTerminated { if #available(macOS 14.0, *) { a.activate() } else { a.activate(options: []) } }
  }

  /// 1Password or Signal came to the front: the pill and the queue step aside (the compose screen never opens there).
  func protectedChanged() {
    guard let p = panel, mode == "pill" || mode == "queue" else { return }
    if Protected.front { p.orderOut(nil) } else { p.orderFrontRegardless() }
  }
}
