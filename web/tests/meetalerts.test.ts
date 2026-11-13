// Run: node --experimental-strip-types tests/meetalerts.test.ts
// Meeting alert cards (src/core/meetalerts.ts) with FICTIONAL leads, calls and messages.
// The developer's zone is Dubai (UTC+4, no daylight saving); the lead is in New York.
import assert from "node:assert/strict";
const M = await import("../src/core/meetalerts.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const at = (s: string) => new Date(`${s}+04:00`);
const iso = (s: string) => at(s).toISOString();
const HOME = "Asia/Dubai", HOME_NAME = "Dubai";
const lead = { name: "Jane Doe", company: "Northwind Silk", emails: ["jane@northwindsilk.example", "ops@northwindsilk.example"], tz: "America/New_York" };
const red = { email: "red@example.com", self: true, organizer: false, rsvp: "accepted" };
const call = (o: Partial<{ id: string; start: string; title: string; rsvp: string; redMade: boolean; link: string }> = {}) => ({
  id: o.id || "evt-1", title: o.title || "Shopify Redesign", start: o.start || iso("2026-10-21T16:00:00"), end: null as string | null,
  allDay: false, link: o.link ?? "https://meet.google.com/abc-defg-hij",
  attendees: [{ ...red, organizer: !!o.redMade }, { email: "jane@northwindsilk.example", name: "Jane", rsvp: o.rsvp || "needsAction", organizer: !o.redMade }],
});
const prefs = M.MEET_DEFAULTS;
const run = (now: Date, events: ReturnType<typeof call>[], seen: ReturnType<typeof M.emptySeen>, msgs: Parameters<typeof M.meetAlerts>[0]["msgs"] = [], p = prefs) =>
  M.meetAlerts({ now, events: events.map((e) => ({ ...e, end: e.end ?? new Date(Date.parse(e.start) + 3600_000).toISOString() })), leads: [lead], msgs, seen, prefs: p, homeTz: HOME, homeName: HOME_NAME });

const now0 = at("2026-10-18T10:00:00");
const first = run(now0, [call({ id: "old" })], M.emptySeen(now0));

ok("first run only takes a baseline (no flood of old calls)", () => {
  assert.equal(first.cards.length, 0);
  assert.equal(first.seen.started, true);
});
ok("a new call the lead booked (Calendly or their invite) raises BOOKED with both clocks", () => {
  const r = run(at("2026-10-18T10:05:00"), [call({ id: "old" }), call({ id: "new", start: iso("2026-10-21T16:00:00") })], first.seen);
  assert.equal(r.cards.length, 1);
  const c = r.cards[0];
  assert.equal(c.tone, "booked");
  assert.equal(c.title, "Jane Doe just booked a call");
  assert.equal(c.sub, "Wed 21 Oct 4:00 PM Dubai · 8:00 AM ET for them");
  assert.match(c.body || "", /Shopify Redesign · Northwind Silk/);
  assert.ok(c.id.length <= 40);
});
ok("The developer's own invite is not a booking; their accept is", () => {
  const a = run(at("2026-10-18T10:05:00"), [call({ id: "old" }), call({ id: "mine", redMade: true })], first.seen);
  assert.equal(a.cards.length, 0);
  const b = run(at("2026-10-18T10:10:00"), [call({ id: "old" }), call({ id: "mine", redMade: true, rsvp: "accepted" })], a.seen);
  assert.deepEqual(b.cards.map((c) => [c.tone, c.title]), [["booked", "Jane Doe accepted your call"]]);
  const d = run(at("2026-10-18T10:15:00"), [call({ id: "old" }), call({ id: "mine", redMade: true, rsvp: "declined" })], b.seen);
  assert.deepEqual(d.cards.map((c) => [c.tone, c.title]), [["declined", "Jane Doe declined the call"]]);
});
ok("an empty calendar refresh never makes old calls look newly booked", () => {
  const empty = run(at("2026-10-18T10:05:00"), [], first.seen);
  const back = run(at("2026-10-18T10:10:00"), [call({ id: "old" })], empty.seen);
  assert.equal(back.cards.length, 0);
});

// Today: a call at 16:00 Dubai; she writes at 15:20.
const today = call({ id: "today", start: iso("2026-10-18T16:00:00"), rsvp: "accepted" });
const base = run(at("2026-10-18T09:00:00"), [today], M.emptySeen(at("2026-10-18T09:00:00"))).seen;
const msg = (id: string, text: string, when: string, from = "jane@northwindsilk.example") =>
  ({ id, from, fromName: "Jane", at: iso(when), channel: "instantly" as const, subject: "Re: your call", text, url: "https://app.instantly.ai/app/unibox" });

ok("a lead cancelling 40 minutes before raises the strongest card", () => {
  const r = run(at("2026-10-18T15:20:30"), [today], base, [msg("m1", "Hi the developer, so sorry, I can't make the call today. Something came up. Can we reschedule?\n\nOn Fri, the developer wrote:\n> old", "2026-10-18T15:20:00")]);
  assert.equal(r.cards.length, 1);
  const c = r.cards[0];
  assert.equal(c.tone, "cancel");
  assert.equal(c.title, "Jane Doe may not make today's 4:00 PM call");
  assert.equal(c.sub, "Instantly · Northwind Silk");
  assert.equal(M.untilText(new Date(c.callAt!), at("2026-10-18T15:20:30")), "in 40 min");
  assert.equal(c.body, "Hi the developer, so sorry, I can't make the call today. Something came up. Can we reschedule?");
  assert.equal(c.url, "https://app.instantly.ai/app/unibox");
});
ok("any other message from her before the call is still urgent", () => {
  const r = run(at("2026-10-18T15:30:00"), [today], base, [msg("m2", "Looking forward to it! Here is the link to our store.", "2026-10-18T15:29:00")]);
  assert.deepEqual(r.cards.map((c) => [c.tone, c.title]), [["msg", "Jane Doe messaged about the 4:00 PM call"]]);
});
ok("a colleague's address on the lead counts too", () => {
  const r = run(at("2026-10-18T15:30:00"), [today], base, [msg("m3", "Jane is running late, 10 minutes.", "2026-10-18T15:29:00", "ops@northwindsilk.example")]);
  assert.equal(r.cards[0]?.tone, "cancel");
});
ok("newsletters and strangers never raise one", () => {
  const r = run(at("2026-10-18T15:30:00"), [today], base, [msg("m4", "Can't make it? Reschedule our webinar!", "2026-10-18T15:29:00", "news@shop.example")]);
  assert.equal(r.cards.length, 0);
});
ok("a lead message with no call coming up is left to the normal email pop-ups", () => {
  const r = run(at("2026-10-18T09:30:00"), [today], base, [msg("m5", "Quick question about pricing.", "2026-10-18T09:29:00")]);
  assert.equal(r.cards.length, 0, "the call is over 6 hours away");
});
ok("the same message never shows twice", () => {
  const once = run(at("2026-10-18T15:21:00"), [today], base, [msg("m6", "Running late!", "2026-10-18T15:20:00")]);
  const twice = run(at("2026-10-18T15:22:00"), [today], once.seen, [msg("m6", "Running late!", "2026-10-18T15:20:00")]);
  assert.equal(once.cards.length, 1);
  assert.equal(twice.cards.length, 0);
});
ok("10 minutes before: a quiet reminder, flagged when they never accepted", () => {
  const notYet = call({ id: "today", start: iso("2026-10-18T16:00:00"), rsvp: "needsAction" });
  const b = run(at("2026-10-18T09:00:00"), [notYet], M.emptySeen(at("2026-10-18T09:00:00"))).seen;
  const early = run(at("2026-10-18T15:45:00"), [notYet], b);
  assert.equal(early.cards.length, 0);
  const r = run(at("2026-10-18T15:50:00"), [notYet], early.seen);
  assert.equal(r.cards.length, 1);
  assert.equal(r.cards[0].tone, "soon-warn");
  assert.equal(r.cards[0].title, "Call with Jane Doe in 10 min");
  assert.match(r.cards[0].body || "", /never accepted/);
  assert.equal(r.cards[0].join, "https://meet.google.com/abc-defg-hij");
  assert.equal(run(at("2026-10-18T15:52:00"), [notYet], r.seen).cards.length, 0, "only once");
});
ok("private mode makes cards discreet (no names or text) until clicked; a meeting alone does not", () => {
  const other = { id: "client-call", title: "Weekly sync", start: iso("2026-10-18T15:00:00"), end: iso("2026-10-18T16:00:00"), allDay: false, link: null, attendees: [red] };
  const r = M.meetAlerts({ now: at("2026-10-18T15:20:30"), events: [{ ...today, end: iso("2026-10-18T17:00:00") }, other], leads: [lead],
    msgs: [msg("m7", "Can we reschedule?", "2026-10-18T15:20:00")], seen: base, prefs, homeTz: HOME, homeName: HOME_NAME, privateMode: true });
  assert.equal(r.inMeeting, true);
  assert.equal(r.cards[0].discreet, true);
  assert.equal(r.cards[0].discreetText, "Message from a lead about this call");
  const off = M.meetAlerts({ now: at("2026-10-18T15:20:30"), events: [{ ...today, end: iso("2026-10-18T17:00:00") }, other], leads: [lead],
    msgs: [msg("m8", "Can we reschedule?", "2026-10-18T15:20:00")], seen: base, prefs, homeTz: HOME, homeName: HOME_NAME });
  assert.equal(off.inMeeting, true);
  assert.equal(off.cards[0].discreet, false, "in a meeting with private mode off, cards show in full");
});
ok("Start private mode? is asked once per real meeting, never with private mode on or the question off", () => {
  const call = { id: "c1", title: "Call", start: iso("2026-10-18T15:00:00"), end: iso("2026-10-18T16:00:00"), allDay: false, link: "https://meet.google.com/x", attendees: [red] };
  const solo = { id: "s1", title: "Focus", start: iso("2026-10-18T15:00:00"), end: iso("2026-10-18T16:00:00"), allDay: false, link: null, attendees: [red] };
  const t = Date.parse(iso("2026-10-18T15:01:00"));
  assert.equal(M.privateAskFor([solo, call], t, false, true, []), "c1" + call.start);
  assert.equal(M.privateAskFor([solo], t, false, true, []), null, "a block with nobody else is not a meeting");
  assert.equal(M.privateAskFor([call], t, false, true, ["c1" + call.start]), null, "asked already");
  assert.equal(M.privateAskFor([call], t, true, true, []), null, "already private");
  assert.equal(M.privateAskFor([call], t, false, false, []), null, "question switched off");
  assert.equal(M.privateAskFor([call], Date.parse(iso("2026-10-18T14:59:00")), false, true, []), null, "not started");
  assert.equal(M.privateAskFor([{ ...call, start: iso("2026-10-18T17:00:00"), end: iso("2026-10-18T18:00:00") }], t, false, true, []), null, "moved later: no longer on");
});
ok("each card type can be switched off", () => {
  const r = run(at("2026-10-18T15:21:00"), [today], base, [msg("m9", "Can't make it", "2026-10-18T15:20:00")], { ...prefs, msg: false });
  assert.equal(r.cards.length, 0);
});
ok("cancel words: real ones match, ordinary replies do not", () => {
  for (const s of ["I can't make it today", "Can we reschedule?", "running late", "something came up", "need to postpone", "can we push it to tomorrow", "I cannot attend"])
    assert.ok(M.CANCEL_WORDS.test(s), s);
  for (const s of ["See you soon!", "Here is the store link", "Thanks the developer, looking forward to the call"])
    assert.ok(!M.CANCEL_WORDS.test(s), s);
});
console.log(`meet alert tests: ${n} passed`);
