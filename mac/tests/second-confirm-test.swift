// Second Computer's questions (Sources/SecondConfirm.swift), offline, in a process that can never become
// the active app (activation policy .prohibited), so nothing here takes focus from the developer. Every window is
// invisible (alpha 0), click-through for real clicks, and far off screen.
//   mkdir -p build/second-confirm && cp tests/second-confirm-test.swift build/second-confirm/main.swift && swiftc build/second-confirm/main.swift Sources/SecondConfirm.swift -o build/second-confirm/test && build/second-confirm/test
// Part 1 reproduces the 1 Nov freeze with the OLD way (an NSAlert run with runModal): while it is up a
// click on the Tab list never arrives, and the alert sits below the list. Part 2 proves the new panel.
import AppKit

var fails = 0
func check(_ name: String, _ ok: Bool) { print("\(name)=\(ok ? "ok" : "FAIL")"); if !ok { fails += 1 } }
func info(_ name: String, _ v: Any) { print("\(name)=\(v) (info)") }

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
app.finishLaunching()
let park = NSPoint(x: -60000, y: 0)

/// Stands in for the Tab list: a full size panel at the list's level that counts the clicks it gets.
final class ListPanel: NSPanel {
  var clicks = 0
  override func sendEvent(_ e: NSEvent) { if e.type == .leftMouseDown { clicks += 1 }; super.sendEvent(e) }
}
let list = ListPanel(contentRect: NSRect(x: 0, y: 0, width: 800, height: 600), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
list.level = .statusBar
list.alphaValue = 0
list.setFrameOrigin(park)
list.orderFrontRegardless()
var listShown = true

/// A real click on the list, queued the way the window server delivers one.
func clickList() {
  for t in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
    if let e = NSEvent.mouseEvent(with: t, location: NSPoint(x: 400, y: 300), modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                  windowNumber: list.windowNumber, context: nil, eventNumber: 1, clickCount: 1, pressure: t == .leftMouseDown ? 1 : 0) {
      app.postEvent(e, atStart: false)
    }
  }
}
/// Runs the main run loop (and so the app's event handling) for a moment.
func pump(_ s: Double) {
  let end = Date().addingTimeInterval(s)
  while Date() < end {
    if let e = app.nextEvent(matching: .any, until: Date().addingTimeInterval(0.02), inMode: .default, dequeue: true) { app.sendEvent(e) }
  }
}

// ---------- Part 1: the old way freezes ----------
do {
  // The old Second.alert ran an NSAlert with runModal: the app modal loop at the modal panel level. The
  // same loop on an invisible, parked window (an NSAlert would centre itself on the developer's screen).
  let w = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 400, height: 160), styleMask: [.titled], backing: .buffered, defer: false)
  w.level = .modalPanel
  w.alphaValue = 0; w.ignoresMouseEvents = true
  w.setFrameOrigin(park)
  struct A { let window: NSWindow }
  let a = A(window: w)
  var during: (modal: Bool, level: Int, before: Int, after: Int, returnedEarly: Bool) = (false, 0, 0, 0, false)
  var returned = false
  // Timers in the common modes run inside the modal loop: look, click the list, then answer.
  let look = Timer(timeInterval: 0.3, repeats: false) { _ in
    a.window.setFrameOrigin(park)
    during.modal = app.modalWindow != nil
    during.level = a.window.level.rawValue
    during.before = list.clicks
    during.returnedEarly = returned
    clickList()
  }
  let answer = Timer(timeInterval: 0.9, repeats: false) { _ in during.after = list.clicks; app.abortModal() }
  RunLoop.main.add(look, forMode: .common); RunLoop.main.add(answer, forMode: .common)
  _ = app.runModal(for: w)
  returned = true
  a.window.orderOut(nil)
  check("old-alert-blocks-until-answered", !during.returnedEarly && during.modal)
  check("old-alert-under-the-list", during.level < list.level.rawValue)
  check("old-alert-list-click-lost", during.after == during.before)
  info("old-alert-level", "\(during.level) list=\(list.level.rawValue)")
  pump(0.2)   // the lost click is gone for good, not just late
  info("old-alert-list-clicks-after", list.clicks)
}

// ---------- Part 2: the new question ----------
let c = SecondConfirm.shared
c.test = true
var hid = 0
c.beforeShow = { hid += 1; listShown = false }
var answers: [String] = []
let clicksBefore = list.clicks
listShown = true
c.ask("Let your primary Mac run jobs here?", "Your primary Mac will be able to run allowlisted jobs.", "Allow") { yes in answers.append("role:\(yes)") }
check("new-returns-at-once", c.showing && answers.isEmpty)
check("new-not-modal", app.modalWindow == nil)
check("new-list-put-away-first", hid == 1 && !listShown)
check("new-above-the-list", (c.panel?.level.rawValue ?? 0) > list.level.rawValue)
check("new-never-on-screen-in-tests", (c.panel?.alphaValue ?? 1) == 0 && !NSScreen.screens.contains { $0.frame.intersects(c.panel?.frame ?? .zero) })
check("new-buttons", c.panel.map { p in
  func all(_ v: NSView) -> [NSView] { [v] + v.subviews.flatMap(all) }
  let titles = all(p.contentView!).compactMap { ($0 as? NSButton)?.title }
  return titles.contains("Allow") && titles.contains("Cancel")
} ?? false)
check("new-first-click-counts", c.panel.map { p in
  func all(_ v: NSView) -> [NSView] { [v] + v.subviews.flatMap(all) }
  let b = all(p.contentView!).compactMap { $0 as? NSButton }
  return b.count == 2 && b.allSatisfy { $0.acceptsFirstMouse(for: nil) }
} ?? false)
// PS keeps working while the question is up: a click on the list still arrives.
clickList(); pump(0.3)
check("new-list-click-still-arrives", list.clicks == clicksBefore + 1)
// A second question waits its turn.
c.ask("Pair with Home M1?", "Check the code: 123 456", "Pair") { yes in answers.append("pair:\(yes)") }
check("new-one-at-a-time", c.showingTitle == "Let your primary Mac run jobs here?")
c.press(true)
check("new-allow-answers-yes", answers == ["role:true"])
pump(0.1)
check("new-next-question-after", c.showingTitle == "Pair with Home M1?" && hid == 2)
// Esc answers no.
c.panel?.cancelOperation(nil)
check("new-esc-answers-no", answers == ["role:true", "pair:false"] && !c.showing)
pump(0.1)
check("new-nothing-left-up", !c.showing && c.panel == nil)
// Return answers yes (the default button).
c.ask("Unpair Home M1?", "It will no longer get jobs.", "Unpair") { yes in answers.append("unpair:\(yes)") }
c.panel?.makeKey()   // in PS the question is the key window (a test copy never takes focus)
if let p = c.panel, let e = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [], timestamp: 0, windowNumber: p.windowNumber, context: nil,
                                               characters: "\r", charactersIgnoringModifiers: "\r", isARepeat: false, keyCode: 36) {
  _ = p.performKeyEquivalent(with: e)
}
check("new-return-answers-yes", answers.last == "unpair:true" && !c.showing)

list.orderOut(nil)
print(fails == 0 ? "SECOND CONFIRM TEST: all ok" : "SECOND CONFIRM TEST: \(fails) FAIL")
exit(fails == 0 ? 0 : 1)
