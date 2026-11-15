import Foundation
// Run: bash tests/squad-island-test.sh. Fictional people only (Ada, Kit, Sam).
var n = 0, bad = 0
func ok(_ name: String, _ c: Bool) { n += 1; if c { print("ok - \(name)") } else { bad += 1; print("FAIL - \(name)") } }
let T0 = Date(timeIntervalSince1970: 1_763_024_400)
func at(_ s: Double) -> Date { T0.addingTimeInterval(s) }
func msg(_ id: String, _ name: String = "Ada Example", chat: String = "g", text: String = "hello there", group: String? = nil) -> SquadMsg {
  SquadMsg(id: "g:\(id)", chat: chat, name: name, group: group, text: text, at: "2026-11-15T10:00:00Z")
}

// ---------- from the page ----------
let card: [String: Any] = ["id": "g:abc", "tone": "squad", "title": "Ada Example", "body": "  Lunch at one?  ", "at": "2026-11-15T10:00:00Z", "island": true]
ok("a squad card parses, words trimmed", SquadIslandCore.parse(card)?.text == "Lunch at one?" && SquadIslandCore.parse(card)?.chat == "g")
ok("the island flag travels on the card", SquadIslandCore.wantsIsland(card) && !SquadIslandCore.wantsIsland(["id": "g:abc"]))
ok("a card of another tone is not ours", SquadIslandCore.parse(["id": "g:abc", "tone": "mail", "title": "x"]) == nil)
ok("an id without the prefix is not ours", SquadIslandCore.parse(["id": "abc", "tone": "squad", "title": "x"]) == nil)
ok("an id too long is not ours", SquadIslandCore.parse(["id": "g:" + String(repeating: "a", count: 60), "tone": "squad"]) == nil)
ok("no name becomes Someone", SquadIslandCore.parse(["id": "g:1", "tone": "squad"])?.name == "Someone")
ok("the group travels", SquadIslandCore.parse(["id": "g:1", "tone": "squad", "title": "Kit", "group": "Gym crew", "chat": "gym"])?.group == "Gym crew")
ok("a long message is cut", (SquadIslandCore.parse(["id": "g:1", "tone": "squad", "body": String(repeating: "x", count: 5000)])?.text.count ?? 0) == 600)

// ---------- when it may show ----------
var g = SquadGate()
ok("everything fine: the island takes it", SquadIslandCore.decide(g) == .island)
g = SquadGate(); g.feature = false
ok("feature off: the old card", SquadIslandCore.decide(g) == .old)
g = SquadGate(); g.cardWantsIsland = false
ok("the person's switch off: the old card stays as it is", SquadIslandCore.decide(g) == .old)
g = SquadGate(); g.islandOnScreen = false
ok("island off or away: the old card", SquadIslandCore.decide(g) == .old)
g = SquadGate(); g.sleepMode = true
ok("Sleep mode: nothing", SquadIslandCore.decide(g) == .hold)
g = SquadGate(); g.sentry = true
ok("Sentry mode: nothing", SquadIslandCore.decide(g) == .hold)
g = SquadGate(); g.sentry = true; g.feature = false
ok("Sentry mode beats everything", SquadIslandCore.decide(g) == .hold)
for (name, set) in [("screen sharing", { (x: inout SquadGate) in x.screenSharing = true }), ("a full screen app", { (x: inout SquadGate) in x.fullScreen = true }),
                    ("a locked screen", { (x: inout SquadGate) in x.screenLocked = true }), ("private mode", { (x: inout SquadGate) in x.privateMode = true })] {
  var x = SquadGate(); set(&x)
  ok("\(name): never on the island, the old card with its own rules", SquadIslandCore.decide(x) == .old)
}
g = SquadGate(); g.protectedFront = true
ok("1Password or Signal in front, island not allowed over them: not on the island", SquadIslandCore.decide(g) == .old)
g = SquadGate(); g.protectedFront = true; g.islandOverProtected = true
ok("island allowed over them: it shows", SquadIslandCore.decide(g) == .island)
ok("but the box never takes the keyboard from them (rule 7)", !SquadIslandCore.canCompose(protectedFront: true) && SquadIslandCore.canCompose(protectedFront: false))

// ---------- the words ----------
ok("first name", SquadIslandCore.firstName("Ada Example") == "Ada" && SquadIslandCore.firstName("  ") == "Someone" && SquadIslandCore.firstName("Kit") == "Kit")
ok("initial", SquadIslandCore.initial("ada example") == "A" && SquadIslandCore.initial("") == "S")
ok("initial skips a leading symbol", SquadIslandCore.initial("~Kit") == "K")
ok("the same name always gets the same hue, in range", SquadIslandCore.hue("Ada Smith") == SquadIslandCore.hue("ada jones") && (0..<1).contains(SquadIslandCore.hue("Kit")))
ok("a short message is one line, no more", SquadIslandCore.lines("hi") == 1 && !SquadIslandCore.hasMore("hi"))
ok("line breaks count", SquadIslandCore.lines("a\nb\nc") == 3 && !SquadIslandCore.hasMore("a\nb\nc") && SquadIslandCore.hasMore("a\nb\nc\nd"))
ok("a long message caps at three lines and says more", SquadIslandCore.lines(String(repeating: "x", count: 500)) == 3 && SquadIslandCore.hasMore(String(repeating: "x", count: 500)))
ok("exactly three lines of words: no more", !SquadIslandCore.hasMore(String(repeating: "x", count: 120)) && SquadIslandCore.hasMore(String(repeating: "x", count: 121)))
ok("no words: never an empty card", SquadIslandCore.shownText("") == "Sent something")
ok("quick replies: three, the last a thumbs up", SquadIslandCore.quickReplies.count == 3 && SquadIslandCore.quickReplies[0] == "On it" && SquadIslandCore.quickReplies[1] == "Thanks" && SquadIslandCore.quickReplies[2] == "\u{1F44D}")
ok("a reply is trimmed, empty is nothing, and it is cut at the chat's limit", SquadIslandCore.cleanReply("  yes ") == "yes" && SquadIslandCore.cleanReply("   \n") == nil && SquadIslandCore.cleanReply(String(repeating: "y", count: 5000))?.count == 2000)

// ---------- queueing and collapsing ----------
var q = SquadIslandQueue()
ok("the first message is new", q.receive(msg("1"), reading: false) == .new)
ok("the same card twice is one message", q.receive(msg("1"), reading: false) == .again && q.waiting.count == 1)
ok("a second message from the same chat joins the waiting card", q.receive(msg("2", "Kit Sample"), reading: false) == .joinedWaiting && q.waiting.count == 1 && q.waiting[0].count == 2)
ok("a message from another chat waits behind", q.receive(msg("3", chat: "gym"), reading: false) == .new && q.waiting.count == 2)
var it = q.promote()
ok("the first chat comes out first, newest last", it?.chat == "g" && it?.count == 2 && it?.newest.id == "g:2")
ok("only one is on the island at a time", q.promote() == nil && q.active?.chat == "g")
ok("the burst says how many and shows the newest", SquadIslandCore.title(it!) == "2 new messages" && SquadIslandCore.body(it!) == "Kit: hello there")
ok("a single message shows the first name and the words", SquadIslandCore.title(SquadItem(chat: "g", msgs: [msg("x")])) == "Ada" && SquadIslandCore.body(SquadItem(chat: "g", msgs: [msg("x")])) == "hello there")
ok("the small line is the group's name or G Squad", SquadIslandCore.sub(SquadItem(chat: "g", msgs: [msg("x", group: "Gym crew")])) == "Gym crew" && SquadIslandCore.sub(it!) == "G Squad")
ok("a message from the showing chat, while it is only read, joins it", q.receive(msg("4"), reading: true) == .joinedActive && q.active?.count == 3)
ok("three new messages", SquadIslandCore.title(q.active!) == "3 new messages")
ok("while the person types, a new message from the same chat waits (the box never changes under them)", q.receive(msg("5"), reading: false) == .new && q.waiting.count == 2)
q.finishActive()
ok("the next chat comes after", q.promote()?.chat == "gym" && q.promote() == nil)
q.finishActive()
ok("then the one that waited during typing", q.promote()?.newest.id == "g:5")
var f = SquadIslandQueue()
for i in 0..<30 { _ = f.receive(msg("m\(i)", chat: "c\(i)"), reading: false) }
ok("a flood never builds a pile", f.waiting.count == SquadIslandCore.maxWaiting && f.waiting.last?.newest.id == "g:m29")
// retract: read somewhere else
var r = SquadIslandQueue()
_ = r.receive(msg("a"), reading: false); _ = r.receive(msg("b", chat: "gym"), reading: false); _ = r.receive(msg("c"), reading: false)
_ = r.promote()
ok("a waiting message read elsewhere is removed", r.retract("g:b", keepActive: false) == false && r.waiting.isEmpty)
ok("one of two on the card: the card stays with the rest", r.retract("g:a", keepActive: false) == false && r.active?.count == 1)
ok("the last one read elsewhere: the card closes", r.retract("g:c", keepActive: false) == true && r.active == nil)
var r2 = SquadIslandQueue(); _ = r2.receive(msg("a"), reading: false); _ = r2.promote()
ok("a reply in progress keeps its card even if the message was read elsewhere", r2.retract("g:a", keepActive: true) == false && r2.active != nil)

// M4: the island turn is dropped while messages wait: they come out (corner cards), and later messages are new again
var dq = SquadIslandQueue()
_ = dq.receive(msg("1"), reading: false)
ok("a second message joins the waiting one (the stuck case)", dq.receive(msg("2"), reading: false) == .joinedWaiting)
let out = dq.dropWaiting()
ok("a dropped turn hands every waiting message back, in order", out.count == 1 && out[0].msgs.map { $0.id } == ["g:1", "g:2"] && dq.waiting.isEmpty && !dq.hasWaiting)
ok("after the drop a later message is new again, so it asks for the island and shows", dq.receive(msg("3"), reading: false) == .new && dq.hasWaiting)
ok("dropping again with nothing waiting is harmless", { var e = SquadIslandQueue(); return e.dropWaiting().isEmpty }())
var dq2 = SquadIslandQueue(); _ = dq2.receive(msg("a"), reading: false); _ = dq2.promote(); _ = dq2.receive(msg("b"), reading: false)
ok("a drop leaves the card on the island alone", dq2.dropWaiting().count == 1 && dq2.active?.newest.id == "g:a")

// M5: a parked reply (closed while sending)
let park = SquadParked(id: "g:9", name: "Ada Sample", group: nil, text: "on my way", at: "2026-11-15T10:00:00Z", since: at(100))
ok("a parked reply that went is quiet", SquadParkedRules.onAnswer(ok: true, why: nil) == .quiet)
ok("a parked reply that failed says why", SquadParkedRules.onAnswer(ok: false, why: "No connection") == .failureCard("No connection"))
ok("a parked failure with no reason still says something", SquadParkedRules.onAnswer(ok: false, why: "  ") == .failureCard("Could not send"))
ok("no answer in time is a failure too", SquadParkedRules.timeoutAfter(park, now: at(100)) == SquadIslandCore.answerWithin && SquadParkedRules.timeoutAfter(park, now: at(200)) == 0 && SquadParkedRules.timedOut == .failureCard("Could not confirm it was sent"))
let pc = SquadParkedRules.failureCard(park, why: "No connection")
ok("the failure card is a corner card for the same message, never the island, with the words kept", (pc["island"] as? Bool) == false && (pc["id"] as? String) == "g:9" && (pc["tone"] as? String) == "squad" && ((pc["body"] as? String) ?? "").contains("on my way") && ((pc["body"] as? String) ?? "").contains("Ada") && SquadIslandCore.wantsIsland(pc) == false)

// M9: the global key watcher is off over 1Password and Signal
ok("the global Esc watcher is allowed normally and never while 1Password or Signal is in front", SquadIslandCore.globalEscAllowed(protectedFront: false) && !SquadIslandCore.globalEscAllowed(protectedFront: true))

// ---------- how long it stays ----------
var c = SquadShowClock()
ok("it stays 8 seconds", !c.tick(7.75, hovered: false, focused: false) && c.tick(0.5, hovered: false, focused: false))
c = SquadShowClock()
ok("hover holds it", !c.tick(60, hovered: true, focused: false) && c.left == SquadIslandCore.showFor)
ok("typing holds it", !c.tick(60, hovered: false, focused: true))
ok("and after the pointer leaves it still has its time", !c.tick(2, hovered: false, focused: false) && c.left == SquadIslandCore.showFor - 2)
c.restart(for: 12)
ok("a new message in the burst gives it a fresh start", c.left == 12)
ok("a longer message stays longer", SquadShowClock.total(for: "ok") == 8 && SquadShowClock.total(for: String(repeating: "x", count: 150)) == 12)

// ---------- the reply steps ----------
func go(_ s: SquadReplyState, _ e: SquadReplyEvent, _ t: Double = 0) -> SquadReplyStep { SquadReply.step(s, e, now: at(t)) }
ok("closed shows the card", go(.closed, .show).state == .card)
ok("closed ignores everything else", go(.closed, .send).state == .closed && go(.closed, .tick).effect == nil)
ok("Reply opens the box", go(.card, .openReply).state == .composing(""))
ok("typing keeps the words", go(.composing(""), .type("on my way")).state == .composing("on my way"))
ok("nothing is delivered by typing alone, nor by a tick", go(.composing("hi"), .tick).effect == nil && go(.composing("hi"), .type("hi!")).effect == nil)
ok("an empty box does not send", go(.composing("  "), .send).state == .composing("  "))
var s = go(.composing("  on it  "), .send, 10)
ok("Send starts the short Undo with the trimmed words, nothing goes yet", s.state == .undo(text: "on it", until: at(15)) && s.effect == nil)
ok("a tick inside the Undo changes nothing", go(s.state, .tick, 14.9).state == s.state && go(s.state, .tick, 14.9).effect == nil)
ok("Undo goes back to the box with the words", go(s.state, .undo, 12).state == .composing("on it"))
ok("Esc in the Undo cancels the send: nothing goes", go(s.state, .esc, 12).state == .card && go(s.state, .esc, 12).effect == nil)
ok("a tick that is a late one after Esc cannot send (the state is the card)", go(.card, .tick, 20).effect == nil)
var d = go(s.state, .tick, 15)
ok("when the Undo runs out the words are delivered once", d.state == .sending(text: "on it", since: at(15)) && d.effect == .deliver("on it"))
ok("a second tick delivers nothing more", go(d.state, .tick, 16).effect == nil)
ok("Undo is too late after it went", go(d.state, .undo, 16).state == d.state)
ok("Esc closes the card even while the reply is sending (rule 4)", go(d.state, .esc, 16).state == .closed && go(d.state, .esc, 16).effect == .close)
ok("Esc closing while sending delivers nothing more (no duplicate)", go(d.state, .esc, 16).effect != .deliver("on it") && go(go(d.state, .esc, 16).state, .tick, 17).effect == nil)
ok("the page says it went: Sent, with the tick", go(d.state, .answer(ok: true, why: nil), 16).state == .sent && go(d.state, .answer(ok: true, why: nil), 16).effect == .sentTick)
ok("Sent shrinks back on the next tick", go(.sent, .tick).effect == .close && go(.sent, .tick).state == .closed)
var fl = go(d.state, .answer(ok: false, why: "No connection"), 16)
ok("the page says it did not: failed with its reason", fl.state == .failed(text: "on it", why: "No connection") && fl.effect == nil)
ok("a failed reply with no reason still says something", { if case .failed(_, let w) = go(d.state, .answer(ok: false, why: nil)).state { return !w.isEmpty }; return false }())
ok("Retry asks the page to send it again, once", go(fl.state, .retry, 20).state == .sending(text: "on it", since: at(20)) && go(fl.state, .retry, 20).effect == .retryDelivery)
ok("no answer for too long is a failure with a retry, never an endless wait", go(d.state, .tick, 15 + SquadIslandCore.answerWithin - 1).state == d.state
   && { if case .failed = go(d.state, .tick, 15 + SquadIslandCore.answerWithin + 1).state { return true }; return false }())
ok("Esc on a failed reply closes the card", go(fl.state, .esc).state == .closed && go(fl.state, .esc).effect == .close)
ok("quick reply goes to the Undo, never straight out", go(.composing(""), .quick(0), 30).state == .undo(text: "On it", until: at(35)) && go(.composing(""), .quick(0), 30).effect == nil)
ok("every quick reply works, a wrong one does nothing", go(.composing(""), .quick(2), 0).state == .undo(text: "\u{1F44D}", until: at(5)) && go(.composing(""), .quick(9)).state == .composing(""))
ok("a quick reply cannot start from the card (the box must be open)", go(.card, .quick(0)).state == .card)
ok("Esc in the box goes back to the card, not out", go(.composing("half"), .esc).state == .card && go(.composing("half"), .esc).effect == nil)
ok("Esc on the card closes it, without dismissing the message", go(.card, .esc).effect == .close && go(.card, .esc).state == .closed)
ok("the card's time running out closes it quietly", go(.card, .timeout).effect == .close)
ok("the time running out never touches a reply in progress", go(.composing("x"), .timeout).state == .composing("x") && go(.undo(text: "x", until: at(5)), .timeout).state == .undo(text: "x", until: at(5)))
ok("Dismiss tells the page and closes", go(.card, .dismiss).effect == .dismissAction && go(.card, .dismiss).state == .closed)
ok("Open brings the chat up", go(.card, .open).effect == .openChat)
ok("the box text is cut at the chat's limit", { if case .composing(let t) = go(.composing(""), .type(String(repeating: "z", count: 3000))).state { return t.count == 2000 }; return false }())
ok("the keyboard is wanted only in the box", SquadReply.wantsKeyboard(.composing("")) && !SquadReply.wantsKeyboard(.card) && !SquadReply.wantsKeyboard(.undo(text: "x", until: at(1))) && !SquadReply.wantsKeyboard(.sent))
ok("no auto shrink while typing, in the Undo or while sending", SquadReply.holdsFocus(.composing("")) && SquadReply.holdsFocus(.undo(text: "x", until: at(1))) && SquadReply.holdsFocus(.sending(text: "x", since: at(0))) && !SquadReply.holdsFocus(.card) && !SquadReply.holdsFocus(.sent))
ok("Undo countdown rounds up and never goes below zero", SquadReply.undoLeft(.undo(text: "x", until: at(5)), now: at(0.2)) == 5 && SquadReply.undoLeft(.undo(text: "x", until: at(5)), now: at(4.2)) == 1 && SquadReply.undoLeft(.undo(text: "x", until: at(5)), now: at(9)) == 0 && SquadReply.undoLeft(.card, now: at(0)) == 0)
// every state, every event: it never crashes, a delivery only ever comes from an Undo that ran out
var delivered = 0
let states: [SquadReplyState] = [.closed, .card, .composing("a"), .undo(text: "a", until: at(5)), .sending(text: "a", since: at(0)), .sent, .failed(text: "a", why: "w")]
let events: [SquadReplyEvent] = [.show, .openReply, .type("b"), .send, .quick(0), .undo, .tick, .answer(ok: true, why: nil), .answer(ok: false, why: "x"), .retry, .dismiss, .esc, .timeout, .open]
for st in states { for ev in events { for t in [0.0, 4.0, 6.0] {
  let e = go(st, ev, t).effect
  if case .deliver? = e { delivered += 1; if case .undo = st, ev == .tick, t >= 5 { } else { ok("a delivery from \(st) on \(ev) at \(t)", false) } }
} } }
ok("a delivery happens only when an Undo ran out (one state, one event, two times)", delivered == 1)

// ---------- the size ----------
let one = SquadItem(chat: "g", msgs: [msg("x")])
ok("closed has no body, every open state has one", SquadIslandCore.bodyHeight(.closed, item: one) == 0 && [SquadReplyState.card, .composing(""), .undo(text: "", until: at(0)), .sending(text: "", since: at(0)), .sent, .failed(text: "", why: "")].allSatisfy { SquadIslandCore.bodyHeight($0, item: one) > 60 })
let long = SquadItem(chat: "g", msgs: [msg("x", text: String(repeating: "x", count: 500))])
ok("a long message makes the card taller, but only to three lines", SquadIslandCore.bodyHeight(.card, item: long) > SquadIslandCore.bodyHeight(.card, item: one) && SquadIslandCore.bodyHeight(.card, item: long) < SquadIslandCore.bodyHeight(.card, item: one) + 60)

print("\(n - bad) of \(n) passed")
exit(bad == 0 ? 0 : 1)
