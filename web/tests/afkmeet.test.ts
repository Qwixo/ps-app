// Run: node --experimental-strip-types tests/afkmeet.test.ts
// The AFK timer stays off during meetings (src/core/afkmeet.ts, V1.40): which calendar events count as a
// meeting, the early and late minutes, hidden and declined meetings, and the windows sent to the Mac.
// FICTIONAL events only.
import assert from "node:assert/strict";
const A = await import("../src/core/afkmeet.ts");
const H = await import("../src/core/meethide.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const MIN = 60_000;
const t = (iso: string) => Date.parse(iso);
type Ev = Parameters<typeof A.countsAsMeeting>[0];
const ev = (id: string, start: string | null, end: string | null, more: Partial<Ev> = {}): Ev =>
  ({ id, title: "Fictional " + id, start, end, allDay: false, link: null, place: null, attendees: [], ...more });
const me = { email: "me@example.com", name: null, rsvp: "accepted", self: true, organizer: true };
const guest = { email: "guest@example.com", name: "Guest", rsvp: "accepted", self: false, organizer: false };
const call = ev("call", "2026-11-07T15:00:00Z", "2026-11-07T15:30:00Z", { link: "https://meet.google.com/abc-defg-hij" });
const people = ev("people", "2026-11-07T17:00:00Z", "2026-11-07T18:00:00Z", { attendees: [me, guest] });
const cooking = ev("cooking", "2026-11-07T19:00:00Z", "2026-11-07T20:00:00Z");
const work = ev("work", "2026-11-07T09:00:00Z", "2026-11-07T12:00:00Z", { attendees: [me] });
const allDay = ev("trip", "2026-11-07", "2026-11-08", { allDay: true, link: "https://meet.google.com/abc-defg-hij", attendees: [me, guest] });
const at = (iso: string, list: Ev[], hidden?: Parameters<typeof A.afkMeetWindows>[1]) => {
  const now = t(iso);
  return A.meetWindowAt(A.afkMeetWindows(list, hidden, now), now);
};

ok("meeting now: a call with a Join link counts while it runs", () => {
  assert.ok(A.countsAsMeeting(call));
  assert.deepEqual(at("2026-11-07T15:10:00Z", [call]), [t("2026-11-07T14:55:00Z"), t("2026-11-07T15:40:00Z")]);
});
ok("meeting now: other people invited counts even without a link", () => {
  assert.ok(A.countsAsMeeting(people));
  assert.ok(at("2026-11-07T17:30:00Z", [people]));
});
ok("a block without a link or other people never counts (Cooking, work blocks, bed time)", () => {
  assert.equal(A.countsAsMeeting(cooking), false);
  assert.equal(A.countsAsMeeting(work), false);   // only you on it
  assert.equal(at("2026-11-07T19:30:00Z", [cooking]), null);
  assert.equal(at("2026-11-07T10:00:00Z", [work]), null);
});
ok("all day events never count, even with a link and people", () => {
  assert.equal(A.countsAsMeeting(allDay), false);
  assert.equal(at("2026-11-07T15:10:00Z", [allDay]), null);
});
ok("a meeting hidden with the Meetings panel's delete does not count", () => {
  const hidden = H.hideMeeting([], H.meetKey(call), call.end, t("2026-11-07T14:00:00Z"));
  assert.equal(at("2026-11-07T15:10:00Z", [call], hidden), null);
  assert.ok(at("2026-11-07T17:10:00Z", [call, people], hidden));   // the others still do
});
ok("early start: counts from 5 minutes before, not 6", () => {
  assert.ok(at("2026-11-07T14:55:00Z", [call]));
  assert.ok(at("2026-11-07T14:57:30Z", [call]));
  assert.equal(at("2026-11-07T14:54:00Z", [call]), null);
});
ok("overrun: counts until 10 minutes after the end, not after", () => {
  assert.ok(at("2026-11-07T15:30:00Z", [call]));
  assert.ok(at("2026-11-07T15:39:59Z", [call]));
  assert.equal(at("2026-11-07T15:40:00Z", [call]), null);
});
ok("a declined meeting does not count", () => {
  const no = ev("no", "2026-11-07T15:00:00Z", "2026-11-07T16:00:00Z", { attendees: [{ ...me, rsvp: "declined" }, guest] });
  assert.equal(A.countsAsMeeting(no), false);
});
ok("over 12 hours is not a meeting; broken times are ignored", () => {
  assert.equal(A.countsAsMeeting(ev("conf", "2026-11-07T08:00:00Z", "2026-11-08T08:00:00Z", { link: "https://zoom.us/j/1" })), false);
  assert.equal(A.countsAsMeeting(ev("bad", "soon", "later", { link: "https://zoom.us/j/1" })), false);
  assert.equal(A.countsAsMeeting(ev("back", "2026-11-07T16:00:00Z", "2026-11-07T15:00:00Z", { link: "https://zoom.us/j/1" })), false);
  assert.equal(A.countsAsMeeting(ev("open", "2026-11-07T16:00:00Z", null, { link: "https://zoom.us/j/1" })), false);
  assert.equal(A.countsAsMeeting({ ...call, attendees: undefined } as unknown as Ev), true);   // no attendee list: the link still counts
});
ok("back to back meetings join into one window; the gap after them does not", () => {
  const next = ev("next", "2026-11-07T15:45:00Z", "2026-11-07T16:00:00Z", { link: "https://zoom.us/j/2" });
  const w = A.afkMeetWindows([next, call], undefined, t("2026-11-07T15:00:00Z"));
  assert.deepEqual(w, [[t("2026-11-07T14:55:00Z"), t("2026-11-07T16:10:00Z")]]);
  assert.ok(A.meetWindowAt(w, t("2026-11-07T15:41:00Z")));
});
ok("only the last day and the next two are sent", () => {
  const old = ev("old", "2026-11-05T10:00:00Z", "2026-11-05T11:00:00Z", { link: "https://zoom.us/j/3" });
  const far = ev("far", "2026-11-10T10:00:00Z", "2026-11-10T11:00:00Z", { link: "https://zoom.us/j/4" });
  const w = A.afkMeetWindows([old, far, call], undefined, t("2026-11-07T12:00:00Z"));
  assert.deepEqual(w, [[t("2026-11-07T14:55:00Z"), t("2026-11-07T15:40:00Z")]]);
  assert.deepEqual(A.afkMeetWindows(null, undefined, 0), []);
});
ok("sameWindows only says yes for the same list", () => {
  const w = A.afkMeetWindows([call, people], undefined, t("2026-11-07T12:00:00Z"));
  assert.ok(A.sameWindows(w.map((x) => [x[0], x[1]] as [number, number]), w));
  assert.equal(A.sameWindows(null, w), false);
  assert.equal(A.sameWindows(w.slice(1), w), false);
});
ok("no em or en dashes in the rule's file", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/core/afkmeet.ts", import.meta.url), "utf8");
  assert.equal(/[\u2013\u2014]/.test(src), false);
});

console.log(`\n${n} passed`);
