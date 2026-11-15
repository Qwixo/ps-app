// Run: node --experimental-strip-types tests/calpick.test.ts
// Which calendars PS works with (src/core/calpick.ts, 15 Nov 2026): Meetings, Show only, Off per calendar; defaults for unknown
// calendars and old events; a renamed calendar keeps its choice; a removed calendar's choice is harmless and dropped later;
// the Mac's answer carries the calendar; and every consumer of meetings asks the choice. FICTIONAL calendars only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const P = await import("../src/core/calpick.ts");
const L = await import("../src/core/localcal.ts");
const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const now = Date.parse("2026-11-15T10:00:00Z");
const DAY = 86400_000;
const ev = (id: string, cal?: string | null) => ({ id, title: "Fictional " + id, start: "2026-11-16T10:00:00Z", end: "2026-11-16T11:00:00Z", allDay: false, attendees: [], ...(cal === undefined ? {} : { cal }) });
const work = ev("a", "cal-work"), routine = ev("b", "cal-routine"), bday = ev("c", "cal-bday"), old = ev("d");
const all = [work, routine, bday, old];
let ch = P.setChoice({}, "cal-routine", "show", now);
ch = P.setChoice(ch, "cal-bday", "off", now);

ok("default for everything is Meetings, so nothing changes until a choice", () => {
  assert.equal(P.calUse(undefined, "cal-work"), "meeting");
  assert.equal(P.calUse({}, "cal-work"), "meeting");
  assert.deepEqual(P.shownEvents(all, undefined), all);
  assert.deepEqual(P.meetingEvents(all, {}), all);
  assert.equal(P.shownEvents(all, {}), all);   // the same list: no copy made when nothing was chosen
});
ok("Off is not shown, Show only is shown", () => {
  assert.deepEqual(P.shownEvents(all, ch).map((e) => e.id), ["a", "b", "d"]);
});
ok("only Meetings count as meetings (and events with no calendar)", () => {
  assert.deepEqual(P.meetingEvents(all, ch).map((e) => e.id), ["a", "d"]);
});
ok("an old event with no calendar (or a null one) is always a meeting, even with every calendar off", () => {
  const every = P.setChoice(P.setChoice(ch, "cal-work", "off", now), "cal-routine", "off", now);
  assert.deepEqual(P.meetingEvents([old, ev("e", null)], every).map((e) => e.id), ["d", "e"]);
  assert.deepEqual(P.shownEvents([old, ev("e", null)], every).length, 2);
});
ok("a calendar PS has never seen is a meeting (a new calendar defaults to Meetings)", () => {
  const fresh = ev("f", "cal-new");
  assert.equal(P.calUse(ch, "cal-new"), "meeting");
  assert.deepEqual(P.meetingEvents([fresh], ch), [fresh]);
});
ok("a renamed calendar keeps its choice because the choice is by identifier", () => {
  const before = P.groupCals([{ id: "cal-routine", name: "Routines", color: null, acct: "iCloud" }], ch)[0].cals[0];
  const after = P.groupCals([{ id: "cal-routine", name: "Daily stuff", color: "#112233", acct: "iCloud" }], ch)[0].cals[0];
  assert.equal(before.use, "show");
  assert.equal(after.use, "show");
  assert.equal(after.name, "Daily stuff");
});
ok("choosing Meetings again removes the entry (the default is never stored)", () => {
  const back = P.setChoice(ch, "cal-routine", "meeting", now);
  assert.equal("cal-routine" in back, false);
  assert.equal(P.calUse(back, "cal-routine"), "meeting");
  assert.deepEqual(P.setChoice({}, "", "off", now), {});
});
ok("a removed calendar's choice is harmless: no event carries it", () => {
  assert.deepEqual(P.meetingEvents([work], { "cal-gone": { u: "off", seen: new Date(now).toISOString() } }), [work]);
});
ok("a calendar still in the list is marked seen at most once a week", () => {
  const cals = [{ id: "cal-routine", name: "R", color: null, acct: "" }];
  const fresh = P.tidyChoices(ch, cals, now + 2 * DAY);
  assert.equal(fresh["cal-routine"].seen, ch["cal-routine"].seen);   // not rewritten again and again
  const stale = P.tidyChoices(ch, cals, now + 8 * DAY);
  assert.equal(stale["cal-routine"].seen, new Date(now + 8 * DAY).toISOString());
});
ok("a removed calendar's choice is dropped after 60 days, kept before", () => {
  const cals = [{ id: "cal-other", name: "O", color: null, acct: "" }];
  assert.ok("cal-bday" in P.tidyChoices(ch, cals, now + 59 * DAY));
  assert.equal("cal-bday" in P.tidyChoices(ch, cals, now + 61 * DAY), false);
});
ok("nothing read (an empty list) never drops a choice", () => {
  assert.deepEqual(P.tidyChoices(ch, [], now + 400 * DAY), ch);
});
ok("a damaged setting is cleaned and never hides everything", () => {
  const bad = P.cleanChoices({ a: { u: "nope" }, b: "x", c: null, d: { u: "off", seen: "junk" }, "": { u: "off" }, e: { u: "show", seen: new Date(now).toISOString() } });
  assert.deepEqual(Object.keys(bad).sort(), ["d", "e"]);
  assert.equal(P.cleanChoices("x") && Object.keys(P.cleanChoices("x")).length, 0);
  assert.equal(P.calUse("junk", "a"), "meeting");
  assert.equal(P.calUse([], "a"), "meeting");
  const huge = Object.fromEntries(Array.from({ length: 500 }, (_, i) => ["c" + i, { u: "off", seen: new Date(now).toISOString() }]));
  assert.equal(Object.keys(P.cleanChoices(huge)).length, P.CAL_PICK.maxChoices);
});
ok("the picker groups by account in a steady order, each with its use", () => {
  const g = P.groupCals([
    { id: "1", name: "Work", color: "#ff0000", acct: "Work account" },
    { id: "2", name: "Birthdays", color: null, acct: "iCloud" },
    { id: "3", name: "Alpha", color: null, acct: "Work account" },
  ], { "1": { u: "off", seen: new Date(now).toISOString() } });
  assert.deepEqual(g.map((x) => x.acct), ["iCloud", "Work account"]);
  assert.deepEqual(g[1].cals.map((c) => [c.name, c.use]), [["Alpha", "meeting"], ["Work", "off"]]);
});
ok("cleanCals drops junk and duplicates, keeps names and colours only", () => {
  const c = P.cleanCals([{ id: "1", name: "A", color: "#ABCDEF", acct: "x", secret: "no" }, { id: "1", name: "dup" }, { name: "noid" }, 5, null, { id: "2", color: "red" }]);
  assert.deepEqual(c, [{ id: "1", name: "A", color: "#abcdef", acct: "x" }, { id: "2", name: "Calendar", color: null, acct: "" }]);
  assert.deepEqual(P.cleanCals("x"), []);
  assert.equal(P.cleanCals(Array.from({ length: 200 }, (_, i) => ({ id: "c" + i }))).length, P.CAL_PICK.maxCals);
});
ok("the Mac's answer: events keep their calendar id, the answer keeps the calendar list", () => {
  const e = L.localEvent({ id: "m1", title: "x", start: "2026-11-16T10:00:00Z", end: "2026-11-16T11:00:00Z", cal: "cal-work", calName: "Work", calColor: "#ff0000" });
  assert.equal(e?.cal, "cal-work");
  assert.equal("calName" in (e as object), false);   // names and colours live in the list, not on every event
  assert.equal(L.localEvent({ id: "m2", start: "2026-11-16T10:00:00Z" })?.cal, undefined);   // an older Mac sends none
  const snap = L.localSnap({ status: "ok", at: "2026-11-15T10:00:00Z", from: "2026-11-15T00:00:00Z", to: "2026-11-23T00:00:00Z", events: [], cals: [{ id: "cal-work", name: "Work", color: "#ff0000", acct: "iCloud" }] });
  assert.deepEqual(snap?.cals, [{ id: "cal-work", name: "Work", color: "#ff0000", acct: "iCloud" }]);
  assert.equal("cals" in (L.localSnap({ status: "ok", at: "2026-11-15T10:00:00Z", from: "2026-11-15T00:00:00Z", to: "2026-11-23T00:00:00Z", events: [] }) as object), false);
});
ok("every consumer of meetings asks the choice (source check)", () => {
  const need: [string, RegExp][] = [
    ["../src/meetwatch.ts", /meetingEvents\(visibleEvents\(/],        // alerts, private mode ask, record ask
    ["../src/meetwatch.ts", /meetingEvents\(cal \? \(cal\.data as CalendarSnap\)\.events : \[\], st\.calChoices\)\.some/],   // Are you sure mode, Reminders
    ["../src/meetwatch.ts", /afkMeetWindows\(meetingEvents\(/],       // AFK timer
    ["../src/island.ts", /meetingEvents\(cal \? cal\.data\.events/],  // next meeting bubble, Join, Disappear for this meeting
    ["../src/psstatus.ts", /meetingEvents\(calendarSnap/],            // the status the Mac island shows
    ["../src/notescard.ts", /meetingEvents\(/],                       // meeting notes pop up
    ["../src/views/Tips.tsx", /afkMeetWindows\(meetingEvents\(/],
    ["../src/views/NewPopups.tsx", /afkMeetWindows\(meetingEvents\(/],
    ["../src/views/Walkthrough.tsx", /afkMeetWindows\(meetingEvents\(/],
    ["../src/views/TimeZones.tsx", /eventBlocks\(meetingEvents\(/],   // the time converter's free check
    ["../src/views/TaskMap.tsx", /meetReal/],                         // edit sounds quiet in a meeting
    ["../src/views/TaskMap.tsx", /MinecraftWindow dnd=\{st\.dnd\} events=\{meetingEvents\(/],
    ["../src/views/NotesLeftovers.tsx", /meetingEvents\(/],
    ["../src/gos/bridge.ts", /meetingEvents\(/],                      // the phone's meeting alarms
    ["../src/gos/PhoneEditMode.tsx", /meetingEvents\(/],
    ["../src/core/select.ts", /shownDoc\(mainCalendar/],              // every list of events: Off is left out
    ["../src/ps.ts", /cleanChoices\(p\.calChoices\)/],
  ];
  for (const [f, re] of need) assert.match(read(f), re, f + " " + re);
});
console.log(`\n${n} passed`);
