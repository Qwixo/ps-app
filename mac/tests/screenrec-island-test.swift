import Foundation
// Run: bash tests/screenrec-island-test.sh. Fake capture, fake permissions, fake clock, fake samples only.
setvbuf(stdout, nil, _IOLBF, 0)
var n = 0, bad = 0
func ok(_ name: String, _ c: Bool) { n += 1; if c { print("ok - \(name)") } else { bad += 1; print("FAIL - \(name)") } }
let T0 = Date(timeIntervalSince1970: 1_763_024_400)
func at(_ s: Double) -> Date { T0.addingTimeInterval(s) }

final class FakePerms: SRPermissionsAPI {
  var asked = 0
  func screen() -> SRPerm { .granted }
  func mic() -> SRPerm { .granted }
  func requestScreen() { asked += 1 }
  func requestMic(_ done: @escaping (Bool) -> Void) { asked += 1; done(true) }
}
final class FakeCapture: SRCaptureAPI, SRAdjustableCapture {
  var started = 0, stopped = 0, paused = 0, resumed = 0, adjusted: [SRStep] = []
  var plans: [SRPlan] = []
  var canAdjust = SRAdjustable()
  func start(_ plan: SRPlan, done: @escaping (Error?) -> Void) { started += 1; plans.append(plan); done(nil) }
  func pause() { paused += 1 }
  func resume() { resumed += 1 }
  func switchMic(_ uid: String?) {}
  func stop(done: @escaping () -> Void) { stopped += 1; done() }
  func adjust(_ s: SRStep) { adjusted.append(s) }
}
struct Rig {
  let cap = FakeCapture(), perms = FakePerms()
  var clock = T0
  let ctl: SRController
  let brain: SRIslandBrain
  var cards: [(SRCard, String?)] = []
  init(enabled: Bool = true, tweak: (inout SRSettings) -> Void = { _ in }) {
    var s = SRSettings(); s.enabled = enabled; tweak(&s)
    ctl = SRController(settings: s, featureOn: { true }, perms: perms, capture: cap)
    brain = SRIslandBrain(controller: ctl)
    brain.adjuster = cap
  }
}
final class Box { var cards: [(SRCard, String?)] = []; var clock = T0; var priv = false }

func rig(enabled: Bool = true, tweak: (inout SRSettings) -> Void = { _ in }) -> (Rig, Box) {
  let r = Rig(enabled: enabled, tweak: tweak), b = Box()
  r.brain.now = { b.clock }
  r.ctl.now = { b.clock }
  r.brain.privateOn = { b.priv }
  r.brain.localQueue?.now = { b.clock }
  r.brain.router.now = { b.clock }
  r.brain.emit = { c, s in b.cards.append((c, s)) }
  r.brain.screenH = { 1080 }
  r.ctl.onChange = { [weak brain = r.brain] _ in brain?.recorderChanged() }
  return (r, b)
}

// ---- the meeting found rule ----
let cal = SRMeetingFacts(calendarName: "Call with Sam", calendarKey: "e1", appWindows: [], micInUse: false)
ok("a meeting starting now is found", SRMeetingRule.found(cal)?.name == "Call with Sam")
ok("an app window with the mic in use is found", SRMeetingRule.found(SRMeetingFacts(appWindows: ["Zoom"], micInUse: true))?.name == "Zoom call")
ok("an app window with the mic idle is not found", SRMeetingRule.found(SRMeetingFacts(appWindows: ["Zoom"], micInUse: false)) == nil)
ok("the mic in use with no meeting window is not found", SRMeetingRule.found(SRMeetingFacts(appWindows: [], micInUse: true)) == nil)
ok("nothing is nothing", SRMeetingRule.found(SRMeetingFacts()) == nil)
ok("a blank calendar name is not a meeting", SRMeetingRule.found(SRMeetingFacts(calendarName: "  ")) == nil)
ok("calendar wins over an app window", SRMeetingRule.found(SRMeetingFacts(calendarName: "Standup", calendarKey: "k", appWindows: ["Teams"], micInUse: true))?.fromCalendar == true)
var titleAsked = 0
func title(_ t: String?) -> () -> String? { { titleAsked += 1; return t } }
ok("zoom is a meeting app", SRMeetingApps.classify(owner: "zoom.us", title: title(nil)) == "Zoom")
ok("teams is a meeting app", SRMeetingApps.classify(owner: "Microsoft Teams", title: title(nil)) == "Teams")
ok("facetime is a meeting app", SRMeetingApps.classify(owner: "FaceTime", title: title(nil)) == "FaceTime")
ok("google meet in a browser, by the window", SRMeetingApps.classify(owner: "Google Chrome", title: title("Meet - abc-defg-hij")) == "Google Meet")
ok("a browser window that is not meet is not a meeting", SRMeetingApps.classify(owner: "Safari", title: title("Inbox")) == nil)
titleAsked = 0
ok("1password is never classified", SRMeetingApps.classify(owner: "1Password", title: title("Meet - x")) == nil)
ok("signal is never classified", SRMeetingApps.classify(owner: "Signal", title: title("Zoom")) == nil)
ok("a blocked bundle id is never classified", SRMeetingApps.classify(owner: "App", bundle: "org.whispersystems.signal-desktop", title: title("Meet -")) == nil)
ok("a 1password browser extension app by bundle", SRMeetingApps.classify(owner: "Helper", bundle: "com.1password.1password", title: title("x")) == nil)
ok("a blocked app's window text is never even asked for", titleAsked == 0)
ok("a non browser app's window text is never asked for", { _ = SRMeetingApps.classify(owner: "Notes", title: title("x")); return titleAsked == 0 }())

// ---- the order: private mode question first, then the record question ----
do {
  var flow = SRAskFlow()
  let f = SRMeetingRule.found(cal)
  var i = SRAskInputs(privateAskPending: true)
  ok("record question waits while the private question is pending", flow.look(f, i) == nil)
  i.privateAskPending = false
  ok("record question comes right after the private question is answered", flow.look(f, i)?.name == "Call with Sam")
  ok("never asked twice for the same meeting", flow.look(f, i) == nil)
  var flow2 = SRAskFlow()
  var j = SRAskInputs(privateOn: true)
  ok("private mode on: the record question is not shown", flow2.look(f, j) == nil)
  j.privateOn = false
  ok("private mode off again during the meeting: it is asked then", flow2.look(f, j) != nil)
  var flow3 = SRAskFlow()
  ok("a No hides it for that meeting", { let a = flow3.look(f, SRAskInputs()); flow3.answered(a!.key, yes: false); return flow3.look(f, SRAskInputs()) == nil }())
  var flow4 = SRAskFlow()
  ok("feature off: nothing is asked or remembered", flow4.look(f, SRAskInputs(gateOpen: false)) == nil && flow4.asked.isEmpty)
  ok("the Settings switch off: no question", flow4.look(f, SRAskInputs(askMeetings: false)) == nil && flow4.asked.isEmpty)
  ok("recording already: no question", flow4.look(f, SRAskInputs(recordingBusy: true)) == nil)
  ok("question already open: no second one", flow4.look(f, SRAskInputs(recordAskOpen: true)) == nil)
  // an app call that ended and a new one: asked again
  var flow5 = SRAskFlow()
  let app = SRMeetingRule.found(SRMeetingFacts(appWindows: ["Zoom"], micInUse: true))
  let a1 = flow5.look(app, SRAskInputs()); flow5.answered(a1!.key, yes: false)
  ok("app call: No holds while it lasts", flow5.look(app, SRAskInputs()) == nil)
  _ = flow5.look(nil, SRAskInputs())
  ok("app call ended, a new one asks again", flow5.look(app, SRAskInputs()) != nil)
}

// ---- the brain: the whole order through the REAL router and the island queue rules, one card at a time ----
do {
  let (r, b) = rig()
  let q = r.brain.localQueue!
  // The private question is on the island ahead of us, in the same queue
  _ = q.enqueue(id: "private-ask", ttl: nil, show: {}, visible: { true }, close: {}, dropped: {})
  ok("the private question is the active card", q.isActive("private-ask"))
  ok("the page says the private question is pending: no record question yet", r.brain.meetingTick(cal, privateAskPending: true) == false && b.cards.isEmpty)
  // the page's flag lagged: the record question is submitted anyway and must wait its turn, never on top
  ok("record question submitted while a card is active waits", r.brain.meetingTick(cal, privateAskPending: false) == true && b.cards.isEmpty && q.isWaiting(SRCards.askId))
  q.finish("private-ask"); b.clock = at(1); q.pump()
  ok("the record question shows right after the private question, through the queue", b.cards.map { $0.0.id } == [SRCards.askId] && q.isActive(SRCards.askId))
}
do {
  let (r, b) = rig(); let q = r.brain.localQueue!
  _ = r.ctl.start()                                   // a recording: moments to come
  r.brain.openControls()
  _ = r.brain.meetingTick(cal, privateAskPending: false)   // busy: no question while recording
  ok("controls card is the active one", q.isActive(SRCards.menuId) && b.cards.count == 1)
  r.brain.perfTick(SRSample(diskFree: 0))               // disk stop: a card of its own
  ok("a second moment waits, never two cards", b.cards.count == 1 && q.isWaiting(SRCards.diskId))
  r.brain.router.answered(SRCards.menuId); b.clock = at(1); q.pump()
  ok("and comes after the first is answered", b.cards.map { $0.0.id } == [SRCards.menuId, SRCards.diskId] && !b.cards.contains { $0.0.id == SRCards.savedId })
  var activeAtOnce = 0
  for id in [SRCards.menuId, SRCards.diskId, SRCards.perfId] { if q.isActive(id) { activeAtOnce += 1 } }
  ok("never two active", activeAtOnce == 1)
}
do {
  // H4: the question stays answerable for as long as it is on the island (the old reaper declined it after 8 to 13 seconds)
  let (r, b) = rig(); let q = r.brain.localQueue!
  _ = r.brain.meetingTick(cal, privateAskPending: false)
  for k in 1...12 { b.clock = at(Double(k) * 10); q.pump(); _ = r.brain.meetingTick(cal, privateAskPending: false) }
  ok("two minutes later the question is still the card on screen", q.isActive(SRCards.askId) && r.brain.openAsk != nil && b.cards.count == 1)
  ok("and Yes still works", r.brain.answer(cardId: SRCards.askId, action: "yes") == .countIn(3))
  r.brain.router.answered(SRCards.askId)
  ok("the answered card left the queue", !q.isActive(SRCards.askId) && !r.brain.router.isOpen(SRCards.askId))
}
do {
  // Esc, the x and a timeout all finish the card and count as No
  let (r, b) = rig(); let q = r.brain.localQueue!
  _ = r.brain.meetingTick(cal, privateAskPending: false)
  _ = q.escape()
  ok("Esc closes the question and frees the queue", !q.isActive(SRCards.askId) && r.brain.openAsk == nil)
  b.clock = at(2); ok("Esc is a No for that meeting", r.brain.meetingTick(cal, privateAskPending: false) == false)
  let (r2, b2) = rig(); let q2 = r2.brain.localQueue!
  _ = r2.brain.meetingTick(cal, privateAskPending: false)
  r2.brain.cardGone(SRCards.askId)
  ok("the x on the card frees the queue too", !q2.isActive(SRCards.askId) && !r2.brain.router.isOpen(SRCards.askId) && b2.cards.count == 1)
}
do {
  // dropped unseen: waited past its time to live behind a long card: it is asked again later, not counted as a No
  let (r, b) = rig(); let q = r.brain.localQueue!
  _ = q.enqueue(id: "private-ask", ttl: nil, show: {}, visible: { true }, close: {}, dropped: {})
  _ = r.brain.meetingTick(cal, privateAskPending: false)
  b.clock = at(500); q.pump()
  ok("a question that never reached the island is dropped and forgotten", b.cards.isEmpty && r.brain.openAsk == nil && !r.brain.router.isOpen(SRCards.askId))
  q.finish("private-ask"); b.clock = at(501); q.pump()
  ok("and asked again afterwards", r.brain.meetingTick(cal, privateAskPending: false) == true && b.cards.count == 1)
}
do {
  // an active card whose window is gone without a word is let go: the queue never sticks
  let (r, b) = rig(); let q = r.brain.localQueue!
  _ = r.ctl.start(); r.brain.recorderChanged()
  r.ctl.stop(); r.brain.recorderChanged()
  ok("saved card shown", q.isActive(SRCards.savedId))
  b.clock = at(60); q.pump()
  ok("a card that is never closed does not hold the island forever", !q.isActive(SRCards.savedId))
  _ = q
}
do {
  // private mode takes the question down and asks again after it
  let (r, b) = rig(); let q = r.brain.localQueue!
  var taken: [String] = []
  r.brain.router.retract = { taken.append($0) }
  _ = r.brain.meetingTick(cal, privateAskPending: false)
  b.priv = true; r.brain.privateChanged()
  ok("private mode on: the question is taken down and leaves the queue", taken == [SRCards.askId] && !q.isActive(SRCards.askId) && r.brain.openAsk == nil)
  b.priv = false; r.brain.privateChanged(); b.clock = at(5)
  ok("private mode off: it is not a No, it asks again", r.brain.meetingTick(cal, privateAskPending: false) == true)
}
do {
  var shownTogether = 0
  let q = SRLocalQueue(); var t = T0; q.now = { t }
  for k in 0..<6 {
    _ = q.enqueue(id: "c\(k)", ttl: nil, show: {}, visible: { true }, close: {}, dropped: {}); t = t.addingTimeInterval(0.01)
    var active = 0; for j in 0..<6 where q.isActive("c\(j)") { active += 1 }
    if active > 1 { shownTogether += 1 }
  }
  ok("six moments at once: still exactly one active", shownTogether == 0 && q.isActive("c0") && q.shown == ["c0"])
}

// ---- Yes, No, the chip ----
do {
  let (r, b) = rig()
  _ = r.brain.meetingTick(cal, privateAskPending: false)
  let askCard = b.cards.last!.0
  ok("the question has the meeting name, Yes, No and the chip", askCard.title == SRWords.askTitle && askCard.sub == "Call with Sam" && askCard.actions.map { $0.id } == ["yes", "no", "chip"])
  ok("the chip starts on Calls", askCard.actions[2].label == "Calls")
  _ = r.brain.answer(cardId: SRCards.askId, action: "chip")
  ok("tap the chip: the card says Sharp", b.cards.last?.0.actions[2].label == "Sharp" && r.brain.openAsk?.choice == .sharp)
  ok("a chip tap never changes the saved defaults", r.ctl.settings.preset != .sharp && r.ctl.settings.mode == .screenAndAudio)
  _ = r.brain.answer(cardId: SRCards.askId, action: "chip"); _ = r.brain.answer(cardId: SRCards.askId, action: "chip")
  ok("tap again: Tiny then Audio only", b.cards.last?.0.actions[2].label == "Audio only" && r.ctl.settings.mode == .screenAndAudio)
  let nx = r.brain.answer(cardId: SRCards.askId, action: "yes")
  ok("Yes: a short count in of 3", nx == .countIn(3))
  ok("after the count in it starts with the meeting name", r.brain.startAfterCountIn() == nil && r.cap.started == 1 && r.ctl.snapshot.fileName?.contains("Call with Sam") == true)
  ok("the chip choice applied to THIS start only", r.cap.plans.last?.mode == .audioOnly && r.ctl.settings.mode == .screenAndAudio)
  ok("a second count in end does not start twice", r.brain.startAfterCountIn() == .off && r.cap.started == 1)
}
do {
  // Yes, then the person switches screen recording off during the count in: nothing starts
  let (r, _) = rig()
  _ = r.brain.meetingTick(cal, privateAskPending: false)
  ok("Yes begins a count in", r.brain.answer(cardId: SRCards.askId, action: "yes") == .countIn(3) && r.brain.countInPending)
  r.ctl.setEnabled(false); r.brain.gateChanged()
  ok("switched off during the count in: it is cancelled", !r.brain.countInPending)
  ok("so nothing starts when the count ends", r.brain.startAfterCountIn() == .off && r.cap.started == 0)
}
do {
  // the feature itself (Settings, From the squad) switched off during the count in, and during a recording
  var on = true
  var s = SRSettings(); s.enabled = true
  let cap = FakeCapture(), perms = FakePerms()
  let ctl = SRController(settings: s, featureOn: { on }, perms: perms, capture: cap)
  let brain = SRIslandBrain(controller: ctl)
  ctl.onChange = { [weak brain] _ in brain?.recorderChanged() }
  _ = brain.meetingTick(cal, privateAskPending: false)
  _ = brain.answer(cardId: SRCards.askId, action: "yes")
  on = false; brain.gateChanged()
  ok("feature off in the count in: cancelled and nothing starts", brain.startAfterCountIn() == .off && cap.started == 0)
  on = true; brain.gateChanged()
  _ = ctl.start()
  on = false; brain.gateChanged()
  ok("feature off while recording: stopped and saved at once", cap.stopped == 1 && ctl.snapshot.state == .off)
}
do {
  // reduced motion: no count in, the claim and the code agree
  let (r, _) = rig()
  r.brain.reduceMotion = { true }
  _ = r.brain.meetingTick(cal, privateAskPending: false)
  ok("reduced motion: Yes starts at once, no count in", r.brain.answer(cardId: SRCards.askId, action: "yes") == .countIn(0))
}
do {
  // a refused start after Yes is said on the island, and on the button (snapshot.error)
  let (r, b) = rig()
  r.ctl.folders = { (nil, SRFolderState(exists: true, writable: true, freeBytes: 10)) }
  _ = r.brain.meetingTick(cal, privateAskPending: false)
  _ = r.brain.answer(cardId: SRCards.askId, action: "yes")
  r.brain.router.answered(SRCards.askId)
  b.clock = at(1); r.brain.localQueue?.pump()
  let ref = r.brain.startAfterCountIn()
  b.clock = at(2); r.brain.localQueue?.pump()
  ok("refused: no room", ref == .noRoom && r.cap.started == 0)
  ok("the person is told on the island", b.cards.last?.0.id == SRCards.failId && b.cards.last?.0.sub?.contains("not enough room") == true)
  ok("and on the button", r.ctl.snapshot.error?.contains("not enough room") == true)
}
do {
  // a writer failure ends with a card that says what was kept
  let (r, b) = rig()
  _ = r.ctl.start()
  r.ctl.writerFailed("The drive was removed.")
  ok("writer failure: a card says it stopped and what was kept", b.cards.last?.0.id == SRCards.stoppedId && b.cards.last?.0.title.contains("kept") == true)
  ok("and no Saved card pretends all is well", !b.cards.contains { $0.0.id == SRCards.savedId })
}
do {
  // the disk stop never depends on the Performance watch switch
  let (r, b) = rig(tweak: { $0.perfWatch = false })
  _ = r.ctl.start(); r.brain.recorderChanged()
  ok("watch switch off: the watch still runs for the disk", r.brain.watch.running)
  r.brain.perfTick(SRSample(cpu: 1, thermal: .critical, dropRatio: 0.9))
  ok("watch switch off: no quiet adjust and no question", r.cap.adjusted.isEmpty && b.cards.isEmpty)
  r.brain.perfTick(SRSample(diskFree: 1_000))
  ok("watch switch off: a nearly full disk still stops and saves", r.cap.stopped == 1 && b.cards.contains { $0.0.id == SRCards.diskId })
}
do {
  let (r, b) = rig()
  _ = r.brain.meetingTick(cal, privateAskPending: false)
  _ = r.brain.answer(cardId: SRCards.askId, action: "no")
  ok("No: nothing starts", r.cap.started == 0)
  ok("No: not asked again for that meeting", r.brain.meetingTick(cal, privateAskPending: false) == false && b.cards.count == 1)
  let (r2, b2) = rig()
  _ = r2.brain.meetingTick(cal, privateAskPending: false)
  r2.brain.escaped(cardId: SRCards.askId)
  ok("Esc is a No", r2.brain.meetingTick(cal, privateAskPending: false) == false && b2.cards.count == 1)
}
ok("count in is skipped under reduced motion or private mode", SRCountIn.seconds(privateOn: true, reduceMotion: false) == 0 && SRCountIn.seconds(privateOn: false, reduceMotion: true) == 0)

// ---- the opt in gate: nothing runs while it is off ----
do {
  let (r, b) = rig(enabled: false)
  ok("off: the meeting look asks nothing", r.brain.meetingTick(cal, privateAskPending: false) == false && b.cards.isEmpty)
  r.brain.perfTick(SRSample(cpu: 1, thermal: .critical))
  ok("off: no sample is looked at", b.cards.isEmpty && r.brain.watch.running == false)
  ok("off: nothing touched capture or macOS", r.cap.started == 0 && r.perms.asked == 0)
  let (r2, b2) = rig(tweak: { $0.askMeetings = false })
  ok("ask to record meetings off: no question", r2.brain.meetingTick(cal, privateAskPending: false) == false && b2.cards.isEmpty)
  let (r3, _) = rig(tweak: { $0.perfWatch = false })
  _ = r3.ctl.start(); r3.brain.recorderChanged()
  ok("performance watch off: only the disk stop runs, the quiet adjust and the question never do", r3.brain.watch.running == true && r3.brain.watch.feed(SRSample(cpu: 1, thermal: .critical), now: at(100)).isEmpty)
}

// ---- private mode ----
do {
  let (r, b) = rig()
  _ = r.ctl.start(); b.clock = at(60)
  var part = SRPartTracker()
  let v1 = part.view(r.ctl.snapshot, now: b.clock, privateOn: false, name: "Call with Sam")
  ok("the island part shows the dot, the name and the time", v1?.display.dot == true && v1?.display.timer == "1:00" && v1?.name == "Call with Sam" && v1?.comesBack == false)
  b.priv = true
  ok("private mode: no island part at all", part.view(r.ctl.snapshot, now: at(120), privateOn: true, name: "Call with Sam") == nil)
  ok("private mode: the recording keeps going", r.ctl.snapshot.state == .recording && r.cap.stopped == 0)
  ok("private mode: no chime of any kind", ["start", "saved", "warn"].allSatisfy { SRPrivacy.chime($0, privateOn: true, soundsOn: true, dndMutes: false) == nil })
  ok("sounds switch off: no chime", SRPrivacy.chime("saved", privateOn: false, soundsOn: false, dndMutes: false) == nil)
  ok("Do Not Disturb sounds off: no chime", SRPrivacy.chime("start", privateOn: false, soundsOn: true, dndMutes: true) == nil)
  ok("sounds on: a chime", SRPrivacy.chime("saved", privateOn: false, soundsOn: true, dndMutes: false) != nil)
  b.priv = false
  let v2 = part.view(r.ctl.snapshot, now: at(180), privateOn: false, name: "Call with Sam")
  ok("private mode off: the part comes back softly with the REAL time", v2?.comesBack == true && v2?.display.timer == "3:00")
  ok("and only softly once", part.view(r.ctl.snapshot, now: at(181), privateOn: false, name: nil)?.comesBack == false)
  ok("no name: Recording", part.view(r.ctl.snapshot, now: at(182), privateOn: false, name: nil)?.name == "Recording")
  // paused shows, and a pause is not counted
  r.ctl.pause(); b.clock = at(200)
  let pv = part.view(r.ctl.snapshot, now: b.clock, privateOn: false, name: nil)
  ok("paused: the dot stops pulsing and says paused", pv?.display.pulsing == false && pv?.display.paused == true)
}
do {
  // cards that come while private mode is on are held, and come out in order afterwards
  let (r, b) = rig()
  _ = r.ctl.start(); b.priv = true; r.brain.privateChanged()
  r.ctl.stop()
  ok("private mode: Saved is not shown", b.cards.isEmpty)
  b.clock = at(30); b.priv = false; r.brain.privateChanged()
  ok("private mode off: Saved comes out", b.cards.count == 1 && b.cards.first?.0.id == SRCards.savedId)
  ok("and it chimes now that it may", b.cards.first?.1 == "island-done")
  var h = SRHold()
  _ = h.offer(.saved(fileName: "a"), privateOn: true, now: at(0))
  ok("a stale held card (over 10 minutes) is dropped", h.release(now: at(700)).isEmpty)
}
do {
  let (r, b) = rig()
  _ = r.ctl.start(); b.priv = true
  _ = r.brain.meetingTick(cal, privateAskPending: false)
  ok("recording already: no meeting question", b.cards.isEmpty)
}

// ---- Saved ----
do {
  let (r, b) = rig()
  _ = r.ctl.start(meeting: "Call with Sam"); r.ctl.stop()
  ok("Stop: the island says Saved with the file name and Play in PS or Show in Finder",
     b.cards.last?.0.title == "Saved" && b.cards.last?.0.sub?.hasSuffix(".mov") == true && b.cards.last?.0.actions.map { $0.id } == ["play", "show"])
  ok("Saved chimes", b.cards.last?.1 == "island-done")
  ok("Saved does not stay forever", b.cards.last?.0.sticky == false)
  ok("Show in Finder and Play ask the Mac", r.brain.answer(cardId: SRCards.savedId, action: "show") == .reveal && r.brain.answer(cardId: SRCards.savedId, action: "play") == .play)
}

// ---- the performance watch ----
let calm = SRSample(cpu: 0.2)
let hot = SRSample(cpu: 0.95)
func watching(_ res: SRResolution = .p1080, _ fps: Int = 15, _ q: SRQuality = .balanced, can: SRAdjustable = SRAdjustable()) -> SRPerfWatch {
  var w = SRPerfWatch(); w.begin(res: res, fps: fps, quality: q, screenH: 1080, can: can, bytesPerHour: 1_000_000_000); return w
}
ok("a calm Mac: nothing", { var w = watching(); return w.feed(calm, now: at(0)).isEmpty }())
ok("thresholds: cpu high", SRThresholds.level(SRSample(), cpuAvg: 0.86) == .high && SRThresholds.level(SRSample(), cpuAvg: 0.5) == .ok)
ok("thresholds: serious thermal is high, critical is severe", SRThresholds.level(SRSample(thermal: .serious), cpuAvg: 0) == .high && SRThresholds.level(SRSample(thermal: .critical), cpuAvg: 0) == .severe)
ok("thresholds: memory pressure", SRThresholds.level(SRSample(memory: .warning), cpuAvg: 0) == .high && SRThresholds.level(SRSample(memory: .critical), cpuAvg: 0) == .severe)
ok("thresholds: dropped frames", SRThresholds.level(SRSample(dropRatio: 0.2), cpuAvg: 0) == .high && SRThresholds.level(SRSample(dropRatio: 0.6), cpuAvg: 0) == .severe)
do {
  var w = watching()
  ok("one spike is not trouble (the cpu is averaged)", w.feed(calm, now: at(0)).isEmpty && w.feed(calm, now: at(4)).isEmpty && w.feed(SRSample(cpu: 1), now: at(8)).isEmpty)
}
do {
  // 60 fps, 1440p, Best: lowered step by step
  var w = watching(.p1440, 60, .best)
  var steps: [SRStep] = []
  var t = 0.0
  for _ in 0..<12 { for a in w.feed(hot, now: at(t)) { if case .adjust(let s) = a { steps.append(s) } }; t += 8 }
  ok("quiet ladder: frame rate first (60, 30, 15), then resolution, then quality",
     steps == [.fps(30), .fps(15), .resolution(.p1080), .resolution(.p720), .quality(.high), .quality(.balanced), .quality(.small)])
  ok("the ladder never goes below Tiny", SRLadder.next((.p720, 15, .small), screenH: 1080) == nil)
  ok("and never below 15 frames", SRLadder.next((.p1080, 15, .balanced), screenH: 1080) == .resolution(.p720))
  ok("Same as screen on a big screen steps to 1440p first", SRLadder.next((.same, 15, .balanced), screenH: 2160) == .resolution(.p1440))
  ok("Same as screen on a small screen steps to 720p", SRLadder.next((.same, 15, .balanced), screenH: 800) == .resolution(.p720))
  ok("the lowered things are noted for the recording's details", w.lowered == ["frame rate", "frame rate", "resolution", "resolution", "quality", "quality", "quality"])
}
do {
  var w = watching(.p1080, 15, .balanced, can: SRAdjustable(fps: true, resolution: false, quality: false))
  ok("a capture that cannot lower the resolution or quality: those steps are skipped", SRLadder.next((.p1080, 15, .balanced), can: SRAdjustable(fps: true, resolution: false, quality: false), screenH: 1080) == nil)
  ok("nothing to lower: the first sign is only the question after 30 seconds", w.feed(hot, now: at(0)).isEmpty && w.feed(hot, now: at(4)).isEmpty)
}
do {
  // after the quiet steps, about 30 seconds high, then the question
  var w = watching(.p720, 15, .small)   // already Tiny: nothing to lower
  var acts: [(Double, SRPerfAction)] = []
  var t = 0.0
  while t <= 60 { for a in w.feed(hot, now: at(t)) { acts.append((t, a)) }; t += 4 }
  ok("already at Tiny: asked once after about 30 seconds still high", acts.count == 1 && acts[0].1 == .ask && acts[0].0 >= 30 && acts[0].0 <= 36)
}
do {
  var w = watching(.p1080, 15, .balanced)
  var first: Double? = nil, adj = 0
  var t = 0.0
  while t <= 120 { for a in w.feed(hot, now: at(t)) { if case .adjust = a { adj += 1 }; if a == .ask && first == nil { first = t } }; t += 4 }
  ok("quiet adjust first, the question about 30 seconds after the last adjust", adj == 2 && first != nil && first! >= 8 + 30 && first! <= 8 + 36)
  ok("asked only once", { var c = 0; var w2 = watching(.p720, 15, .small); var tt = 0.0; while tt <= 200 { c += w2.feed(hot, now: at(tt)).filter { $0 == .ask }.count; tt += 4 }; return c == 1 }())
}
do {
  var w = watching(.p720, 15, .small)
  var t = 0.0
  while t <= 40 { _ = w.feed(SRSample(cpu: 0.9), now: at(t)); t += 4 }
  ok("it recovers: calm resets the 30 second clock", w.feed(calm, now: at(44)).isEmpty)
  var again: [SRPerfAction] = []
  t = 48
  while t <= 70 { again += w.feed(SRSample(cpu: 0.9), now: at(t)); t += 4 }
  ok("after a calm moment the clock starts again", again.filter { $0 == .ask }.isEmpty)
}
do {
  // No means do not ask again unless much worse
  var w = watching(.p720, 15, .small)
  var t = 0.0, asks = 0
  while t <= 40 { asks += w.feed(SRSample(cpu: 0.9), now: at(t)).filter { $0 == .ask }.count; t += 4 }
  w.answered(stop: false)
  ok("No: the person was asked once", asks == 1 && w.declined)
  var more = 0
  while t <= 300 { more += w.feed(SRSample(cpu: 0.9), now: at(t)).filter { $0 == .ask }.count; t += 4 }
  ok("No: never asked again while it stays the same", more == 0)
  var worse = 0
  t = 300
  while t <= 360 { worse += w.feed(SRSample(cpu: 1, thermal: .critical), now: at(t)).filter { $0 == .ask }.count; t += 4 }
  ok("No: asked again only when it gets much worse", worse == 1)
}
do {
  var w = watching(.p720, 15, .small)
  var asks = 0, t = 0.0
  while t <= 100 { asks += w.feed(SRSample(cpu: 0.9), now: at(t), canShow: false).filter { $0 == .ask }.count; t += 4 }
  ok("private mode: the question waits and is not used up", asks == 0)
  ok("and comes when private mode is off", w.feed(SRSample(cpu: 0.9), now: at(104), canShow: true).contains(.ask))
}
do {
  var w = watching()
  ok("disk nearly full: stop and save, once", w.feed(SRSample(cpu: 0.1, diskFree: 100_000_000), now: at(0)) == [.stopForDisk] && w.feed(SRSample(diskFree: 1), now: at(4)).isEmpty)
  ok("room to spare: no stop", { var w2 = watching(); return w2.feed(SRSample(diskFree: 50_000_000_000), now: at(0)).isEmpty }())
  ok("disk limit is five minutes of recording, at least 300 MB", SRThresholds.diskStop(bytesPerHour: 12_000_000_000) == 1_000_000_000 && SRThresholds.diskStop(bytesPerHour: 1_000) == 300_000_000)
}
do {
  var w = watching(); w.end()
  ok("the watch does nothing outside a recording", w.feed(hot, now: at(0)).isEmpty && w.running == false)
}

// ---- the brain with the watch: quiet adjust, the question, Yes stops, disk stop ----
do {
  let (r, b) = rig(tweak: { $0.preset = .sharp; $0.resolution = .same; $0.fps = 30; $0.quality = .high })
  _ = r.ctl.start()
  r.brain.diskBytesPerHour = { 1_000_000_000 }
  r.brain.recorderChanged()   // begin was already called by onChange on .recording, a second call must be harmless
  r.brain.perfTick(hot)
  ok("quiet adjust reaches the capture and the details", r.cap.adjusted == [.fps(15)] && r.ctl.snapshot.lowered == [SRWords.lowered("frame rate")] && b.cards.isEmpty)
  var t = 8.0
  while t <= 120 { b.clock = at(t); r.brain.perfTick(hot); t += 8 }
  let ask = b.cards.first { $0.0.id == SRCards.perfId }
  ok("then the island asks with the right words and buttons", ask?.0.title == "Resources are high. Stop screen recording?" && ask?.0.actions.map { $0.label } == ["Yes, stop recording", "No, keep recording"])
  ok("the warning has a gentle sound", ask?.1 == "island-start")
  let n = r.brain.answer(cardId: SRCards.perfId, action: "keep")
  ok("No, keep recording: it keeps going", n == .none && r.ctl.snapshot.state == .recording && r.cap.stopped == 0)
}
do {
  let (r, b) = rig()
  _ = r.ctl.start(); r.brain.diskBytesPerHour = { 1_000_000_000 }
  r.brain.perfTick(SRSample(diskFree: 10_000_000))
  ok("disk nearly full: stops and saves", r.cap.stopped == 1 && r.ctl.snapshot.state == .idle)
  ok("and says why on the island", b.cards.contains { $0.0.id == SRCards.diskId && $0.0.sub == SRWords.diskWhy })
}
do {
  let (r, _) = rig(tweak: { $0.preset = .tiny; $0.resolution = .p720; $0.quality = .small })
  _ = r.ctl.start(); r.brain.diskBytesPerHour = { 1_000_000_000 }
  var t = 0.0
  while t <= 60 { r.brain.now = { at(t) }; r.brain.perfTick(hot); t += 4 }
  let n = r.brain.answer(cardId: SRCards.perfId, action: "stop")
  ok("Yes, stop recording: stops and saves", n == .stopNow && r.cap.stopped == 1)
}

// ---- counting frame gaps ourselves ----
do {
  var g = SRFrameGaps()
  for k in 0..<10 { g.note(at: Double(k) / 15, interval: 1.0 / 15) }
  ok("steady frames: no drops", g.ratioAndReset() == 0)
  g.note(at: 0, interval: 1.0 / 15); g.note(at: 1.0 / 15, interval: 1.0 / 15); g.note(at: 1.0 / 15 + 0.4, interval: 1.0 / 15)
  let r = g.ratioAndReset()
  ok("a gap of 0.4 seconds at 15 fps counts the missing frames", r > 0.5 && r < 0.9)
  g.note(at: 0, interval: 1.0 / 15); g.breakLine(); g.note(at: 30, interval: 1.0 / 15)
  ok("a pause is not a drop", g.ratioAndReset() == 0)
  g.note(at: 1, interval: 0.1); g.notReady()
  ok("a writer that was not ready counts", g.ratioAndReset() == 0.5)
  ok("no frames at all is no ratio", g.ratioAndReset() == 0)
}

// ---- words ----
ok("no dashes in any word", SRWords.all.allSatisfy { !$0.contains("\u{2014}") && !$0.contains("\u{2013}") })
ok("card buttons fit the card (24 letters, 3 buttons)", [SRMoment.recordAsk(name: "x", key: "k", choice: .audioOnly), .perfAsk, .saved(fileName: "f"), .diskStop(why: "w"), .controls(paused: true)].allSatisfy { m in
  let c = SRCards.card(m); return c.actions.count <= 3 && c.actions.allSatisfy { $0.label.count <= 24 && $0.id.count <= 20 } && c.id.count <= 40 })
ok("the moment ids are all different", Set([SRCards.askId, SRCards.perfId, SRCards.savedId, SRCards.diskId, SRCards.menuId]).count == 5)
ok("settings: both new switches default on and load tolerantly", { let s = SRSettings(); let d = try! JSONDecoder().decode(SRSettings.self, from: "{}".data(using: .utf8)!); return s.askMeetings && s.perfWatch && d.askMeetings && d.perfWatch }())

do {
  // the chip re-shows the card: the card's own "gone" that follows the click is not a No
  let (r, b) = rig(); let q = r.brain.localQueue!
  _ = r.brain.meetingTick(cal, privateAskPending: false)
  _ = r.brain.answer(cardId: SRCards.askId, action: "chip")
  r.brain.cardGone(SRCards.askId)
  ok("a gone right after a chip tap does not decline the meeting", r.brain.openAsk != nil && q.isActive(SRCards.askId))
  ok("the chip re-showed the same card, never a second one", b.cards.count == 2 && b.cards.allSatisfy { $0.0.id == SRCards.askId })
  b.clock = at(10); r.brain.cardGone(SRCards.askId)
  ok("a real close later is a No", r.brain.openAsk == nil && !q.isActive(SRCards.askId))
}

do {
  let (r, _) = rig(tweak: { $0.mode = .audioOnly; $0.fps = 60 })
  _ = r.ctl.start(); r.brain.recorderChanged()
  for k in 0..<4 { b0(r, k) }
  ok("audio only: the details never say the frame rate was lowered", !r.cap.adjusted.isEmpty && r.ctl.snapshot.lowered.isEmpty)
}
func b0(_ r: Rig, _ k: Int) { r.brain.perfTick(SRSample(cpu: 1, thermal: .critical)) }

print("\(n - bad) of \(n) pass")
exit(bad == 0 ? 0 : 1)
