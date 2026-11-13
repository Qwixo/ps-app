// Run: node --experimental-strip-types tests/localcal.test.ts
// The Meetings panel for anyone but the developer (7 Nov 2026): the Mac's Calendar answer (ps-mac LocalCalendar.swift) is
// checked and turned into the same calendar copy as Google's; the status line says plainly when access is off.
// FICTIONAL data.
import assert from "node:assert/strict";
const L = await import("../src/core/localcal.ts");
const S = await import("../src/core/calstatus.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const T0 = Date.parse("2026-11-07T10:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const ev = (i: number, extra: Record<string, unknown> = {}) => ({ id: `mac:e${i}@${iso(T0 + i * 3600_000)}`, title: `Call ${i}`, start: iso(T0 + i * 3600_000),
  end: iso(T0 + i * 3600_000 + 1800_000), allDay: false, link: null, place: null, attendees: [], ...extra });
const msg = (events: unknown[], status = "ok") => ({ type: "localCal", status, at: iso(T0), from: iso(T0 - 36e6), to: iso(T0 + 8 * 864e5), events });

ok("an allowed read becomes a calendar copy like Google's, sorted by start", () => {
  const snap = L.localSnap(msg([ev(3), ev(1)]))!;
  assert.equal(snap.account, "mac");
  assert.equal(snap.at, iso(T0));
  assert.deepEqual(snap.events.map((e) => e.title), ["Call 1", "Call 3"]);
});
ok("nothing is stored when access is off, asked for, a test copy or the developer's PS", () => {
  for (const st of ["denied", "ask", "test", "red", "error", "weird"]) assert.equal(L.localSnap(msg([ev(1)], st)), null, st);
  assert.equal(L.localSnap({ status: "ok", events: [] }), null);   // no times
});
ok("bad events are dropped and only https call links are kept", () => {
  const snap = L.localSnap(msg([ev(1, { link: "javascript:alert(1)" }), ev(2, { link: "https://meet.google.com/abc-defg-hij" }), { id: "x" }, null, ev(4, { start: "not a date" })]))!;
  assert.deepEqual(snap.events.map((e) => e.title), ["Call 1", "Call 2"]);
  assert.equal(snap.events[0].link, null);
  assert.equal(snap.events[1].link, "https://meet.google.com/abc-defg-hij");
});
ok("attendees keep only what the panel and the alerts need", () => {
  const snap = L.localSnap(msg([ev(1, { attendees: [{ email: "sam@example.com", name: "Sam", rsvp: "accepted", self: false }, { email: "me@example.com", self: true, rsvp: "odd" }, { email: "no-at" }] })]))!;
  assert.deepEqual(snap.events[0].attendees, [
    { email: "sam@example.com", name: "Sam", rsvp: "accepted", self: false, organizer: false },
    { email: "me@example.com", name: null, rsvp: "needsAction", self: true, organizer: false },
  ]);
});
ok("a long list is capped", () => {
  const many = Array.from({ length: 300 }, (_, i) => ev(i));
  assert.equal(L.localSnap(msg(many))!.events.length, L.LOCAL_CAL.maxEvents);
});
ok("the status line: allowed, refused (with the settings button), failed", () => {
  const base = { ...S.CAL_IDLE };
  const okSt = { ...base, ...L.localStatusPatch(msg([]), T0) };
  assert.equal(okSt.connected, true);
  assert.deepEqual(L.localLine(okSt, null, T0 + 120_000), { text: "From your Mac's Calendar · 2 min ago", tone: "ok", settings: false });
  const off = { ...base, ...L.localStatusPatch({ status: "denied" }, T0) };
  assert.deepEqual(L.localLine(off, null, T0), { text: "Calendar access is off", tone: "bad", settings: true });
  const bad = { ...base, ...L.localStatusPatch({ status: "nonsense" }, T0) };
  assert.equal(L.localLine(bad, null, T0).text, "Could not read Calendar");
  assert.equal(L.localLine({ ...base, busy: true }, null, T0).text, "Updating...");
  assert.equal(L.localLine(base, null, T0).text, "From your Mac's Calendar");
});
console.log(`localcal: ${n} passed`);
