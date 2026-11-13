// Run: node --experimental-strip-types tests/remind.test.ts
// The Annoying 15 min reminder (src/core/remind.ts): the schedule across days, midnight and time zones, the old daily
// reminder becoming reminder one, snooze and confirm, the words, and two devices merging. FICTIONAL days only.
import assert from "node:assert/strict";
const R = await import("../src/core/remind.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const TB = "Asia/Dubai", NY = "America/New_York";
const tb = (day: string, hm: string) => Date.parse(`${day}T${hm}:00+04:00`);
const rem = (p: Partial<import("../src/core/remind.ts").Reminder> = {}) => ({ ...R.newReminder("abc", 1), ...p });

// ---------- the schedule ----------
ok("old window 02:00 to 06:00 Dubai: opens at 02:00, closes at 06:00", () => {
  const r = rem({ at: "02:00", until: "06:00", tz: TB });
  assert.equal(R.remStatus(r, undefined, tb("2026-11-10", "01:59"), NY), "closed");
  assert.equal(R.remStatus(r, undefined, tb("2026-11-10", "02:00"), NY), "show");
  assert.equal(R.remStatus(r, undefined, tb("2026-11-10", "05:59"), NY), "show");
  assert.equal(R.remStatus(r, undefined, tb("2026-11-10", "06:00"), NY), "closed");
});
ok("the cycle day: before the start time it is the day before's", () => {
  const r = rem({ at: "02:00", until: "06:00", tz: TB });
  assert.equal(R.cycleDay(r, tb("2026-11-10", "01:30"), NY), "2026-11-09");
  assert.equal(R.cycleDay(r, tb("2026-11-10", "02:00"), NY), "2026-11-10");
});
ok("a window past midnight belongs to the day it started, on its picked days only", () => {
  const r = rem({ at: "22:00", until: "02:00", tz: TB, days: [1] });   // Monday nights only (2026-11-09 is a Monday)
  assert.equal(R.weekdayOf("2026-11-09"), 1);
  assert.equal(R.remStatus(r, undefined, tb("2026-11-09", "21:59"), NY), "closed");
  assert.equal(R.remStatus(r, undefined, tb("2026-11-09", "23:00"), NY), "show");
  assert.equal(R.remStatus(r, undefined, tb("2026-11-10", "01:00"), NY), "show");    // Tuesday 01:00 is still Monday's
  assert.equal(R.remStatus(r, undefined, tb("2026-11-10", "02:00"), NY), "closed");
  assert.equal(R.remStatus(r, undefined, tb("2026-11-10", "23:00"), NY), "closed");   // Tuesday night: not picked
  assert.equal(R.openWindow(r, tb("2026-11-10", "01:00"), NY)?.day, "2026-11-09");
});
ok("weekdays: Saturday and Sunday stay quiet", () => {
  const r = rem({ at: "09:00", until: "21:00", tz: TB, days: [1, 2, 3, 4, 5] });
  assert.equal(R.remStatus(r, undefined, tb("2026-11-14", "12:00"), NY), "closed");   // Saturday
  assert.equal(R.remStatus(r, undefined, tb("2026-11-13", "12:00"), NY), "show");     // Friday
  assert.equal(R.nextStart(r, tb("2026-11-14", "12:00"), NY), tb("2026-11-16", "09:00"));   // Monday 09:00
});
ok("no zone set: the device's own zone; a zone set: that zone wherever the device is", () => {
  const local = rem({ at: "09:00", until: "10:00", tz: "" });
  const nine = Date.parse("2026-11-10T09:30:00-05:00");   // 09:30 in New York, 18:30 in the developer's city
  assert.equal(R.remStatus(local, undefined, nine, NY), "show");
  assert.equal(R.remStatus(local, undefined, nine, TB), "closed");
  const fixed = rem({ at: "18:00", until: "19:00", tz: TB });
  assert.equal(R.remStatus(fixed, undefined, nine, NY), "show");
  assert.equal(R.remStatus(fixed, undefined, nine, "Europe/London"), "show");
});
ok("daylight saving: New York's 1 Nov 2026 night window is an hour longer, wall times kept", () => {
  const r = rem({ at: "00:30", until: "03:00", tz: NY });
  const w = R.windowOn(r, "2026-11-01", NY);
  assert.equal(new Date(w.start).toISOString(), "2026-11-01T04:30:00.000Z");   // 00:30 EDT
  assert.equal(new Date(w.end).toISOString(), "2026-11-01T08:00:00.000Z");     // 03:00 EST
  assert.equal((w.end - w.start) / 3600_000, 3.5);
});
ok("off, and no days picked: never", () => {
  assert.equal(R.remStatus(rem({ on: false, tz: TB }), undefined, tb("2026-11-10", "12:00"), NY), "off");
  const none = rem({ days: [], tz: TB });
  assert.equal(R.remStatus(none, undefined, tb("2026-11-10", "12:00"), NY), "closed");
  assert.equal(R.nextStart(none, tb("2026-11-10", "12:00"), NY), 0);
});

// ---------- confirm and snooze ----------
ok("confirmed: done for that window only, back the next day", () => {
  const r = rem({ at: "02:00", until: "06:00", tz: TB });
  const a = R.doneAct(r, tb("2026-11-10", "03:00"), NY, "mac");
  assert.equal(a.day, "2026-11-10");
  const s = { done: a.day, at: a.at };
  assert.equal(R.remStatus(r, s, tb("2026-11-10", "04:00"), NY), "done");
  assert.equal(R.remStatus(r, s, tb("2026-11-11", "01:59"), NY), "done");    // still that cycle
  assert.equal(R.remStatus(r, s, tb("2026-11-11", "02:00"), NY), "show");
});
ok("snooze: away for its length, then back; one that ends after the window does not bring it back", () => {
  const r = rem({ at: "02:00", until: "06:00", tz: TB, snooze: 15 });
  const a = R.snoozeAct(r, tb("2026-11-10", "03:00"), "phone");
  assert.equal(a.until, tb("2026-11-10", "03:15"));
  const s = { snoozeUntil: a.until, at: a.at };
  assert.equal(R.remStatus(r, s, tb("2026-11-10", "03:14"), NY), "snoozed");
  assert.equal(R.remStatus(r, s, tb("2026-11-10", "03:15"), NY), "show");
  const late = { snoozeUntil: tb("2026-11-10", "06:10"), at: 1 };
  assert.equal(R.remStatus(r, late, tb("2026-11-10", "06:05"), NY), "closed");
  const long = R.snoozeAct(rem({ snooze: 90 }), 0);
  assert.equal(long.until, 90 * 60_000);
});
ok("next wake: the snooze end, the window end, the next start", () => {
  const r = rem({ at: "02:00", until: "06:00", tz: TB });
  assert.equal(R.remNextWake(r, undefined, tb("2026-11-10", "01:00"), NY), tb("2026-11-10", "02:00"));
  assert.equal(R.remNextWake(r, undefined, tb("2026-11-10", "03:00"), NY), tb("2026-11-10", "06:00"));
  assert.equal(R.remNextWake(r, { snoozeUntil: tb("2026-11-10", "03:15"), at: 1 }, tb("2026-11-10", "03:00"), NY), tb("2026-11-10", "03:15"));
  assert.equal(R.remNextWake(r, undefined, tb("2026-11-10", "07:00"), NY), tb("2026-11-11", "02:00"));
});
ok("answers go into the record; an older answer than the one kept is ignored", () => {
  const rec = { ...R.emptyRemind(), list: [rem()] };
  const s1 = R.applyAct(rec, { id: "abc", act: "snooze", until: 5000, at: 100, by: "mac" })!;
  assert.deepEqual(s1.state.abc, { snoozeUntil: 5000, at: 100, by: "mac" });
  assert.equal(R.applyAct(s1, { id: "abc", act: "done", day: "2026-11-10", at: 99 }), null);
  const s2 = R.applyAct(s1, { id: "abc", act: "done", day: "2026-11-10", at: 101, by: "phone" })!;
  assert.deepEqual(s2.state.abc, { done: "2026-11-10", at: 101, by: "phone" });
  const s3 = R.applyAct(s2, { id: "abc", act: "snooze", until: 9000, at: 102 })!;
  assert.deepEqual(s3.state.abc, { done: "2026-11-10", snoozeUntil: 9000, at: 102 });   // a snooze keeps the day's Yes
  assert.equal(R.applyAct(rec, { id: "nope", act: "done", day: "2026-11-10", at: 5 }), null);
  assert.equal(R.applyAct(rec, { id: "abc", act: "done", day: "10 Nov", at: 5 }), null);
});

// ---------- the words ----------
ok("snooze button: the number follows the length; own words with {n}", () => {
  assert.equal(R.laterOf(rem({ snooze: 15 })), "Remind me in 15 mins");
  assert.equal(R.laterOf(rem({ snooze: 1 })), "Remind me in 1 min");
  assert.equal(R.laterOf(rem({ snooze: 60 })), "Remind me in 1 hour");
  assert.equal(R.laterOf(rem({ snooze: 90 })), "Remind me in 1 h 30 mins");
  assert.equal(R.laterOf(rem({ snooze: 5, later: "Not yet ({n})" })), "Not yet (5)");
});
ok("confirm: Yes by default, own words, typed word, one click", () => {
  const r = rem();
  assert.equal(R.yesOf(r), "Yes");
  assert.ok(R.confirms(r, "  yES "));
  assert.ok(!R.confirms(r, "yes please"));
  const own = rem({ yes: "Done it", word: "" });
  assert.equal(R.wordOf(own), "Done it");
  assert.ok(R.confirms(own, "done it"));
  const typed = rem({ yes: "Done", word: "I promise" });
  assert.ok(!R.confirms(typed, "done"));
  assert.ok(R.confirms(typed, "I PROMISE"));
  assert.ok(R.confirms(rem({ click: true }), ""));
});
ok("cleaning: broken fields fall back one by one, never an empty window", () => {
  const r = R.cleanReminder({ id: "x1", at: "25:00", until: "09:00", days: [1, 1, 9, "x"], snooze: 999, vol: 3, bg: "red", accent: "#ABCDEF", sound: "boom", text: "a\u0007b ".repeat(50) })!;
  assert.equal(r.at, "09:00"); assert.equal(r.until, "21:00");
  assert.deepEqual(r.days, [1]); assert.equal(r.snooze, 240); assert.equal(r.vol, 1);
  assert.equal(r.bg, R.REM_BG); assert.equal(r.accent, "#abcdef"); assert.equal(r.sound, "none");
  assert.ok(r.text.length <= R.REM_TEXT_MAX && !/\u0007/.test(r.text));
  assert.equal(R.cleanReminder({ id: "BAD ID" }), null);
  const rec = R.cleanRemind({ list: [{ id: "a" }, { id: "a" }, { id: "b" }], state: { a: { done: "2026-11-10", at: 3 }, zz: { at: 1 } } });
  assert.deepEqual(rec.list.map((x) => x.id), ["a", "b"]);
  assert.deepEqual(Object.keys(rec.state), ["a"]);
});
ok("text colour reads on light and dark backgrounds", () => {
  assert.equal(R.inkFor("#28121e"), "#ffffff");
  assert.equal(R.inkFor("#f6f3ee"), "#17121a");
});

// ---------- the old daily reminder becomes reminder one ----------
ok("The developer's old card: reminder one keeps his words, his window, Dubai and today's Yes", () => {
  const leg = R.cleanLegacy({ on: true, at: "02:00", until: "06:00", text: "", doneFor: "2026-11-10" })!;
  const rec = R.migrateLegacy(null, leg, true, 1000)!;
  const r = rec.list[0];
  assert.equal(r.id, "fu"); assert.equal(r.tz, "Asia/Dubai"); assert.equal(r.at, "02:00"); assert.equal(r.until, "06:00");
  assert.equal(r.snooze, 15); assert.equal(r.sound, "none"); assert.ok(!r.seed);
  assert.equal(rec.state.fu.done, "2026-11-10");
  const p = R.remPlan(rec, true).items[0];
  assert.equal(p.text, "HAVE YOU RAN FOLLOW UP SYSTEM YET?");
  assert.equal(p.later, "Remind me in 15 mins"); assert.equal(p.yes, "Yes"); assert.equal(p.word, "Yes"); assert.equal(p.pill, "Daily reminder");
  assert.equal(p.done, "2026-11-10");
  // Nothing pops up again that night after updating.
  assert.equal(R.remStatus(r, rec.state.fu, tb("2026-11-10", "04:00"), NY), "done");
});
ok("anyone else's old card: their edited question, their own zone, the neutral default otherwise", () => {
  const edited = R.migrateLegacy(null, R.cleanLegacy({ on: false, at: "07:00", until: "08:30", text: "Did you stretch?" }), false, 5)!;
  assert.equal(edited.list[0].tz, ""); assert.equal(edited.list[0].on, false); assert.equal(edited.list[0].until, "08:30");
  assert.equal(R.remPlan(edited, false).items[0].text, "Did you stretch?");
  const plain = R.migrateLegacy(null, R.cleanLegacy({ on: true, at: "02:00", until: "06:00", text: "" }), false, 5)!;
  assert.equal(R.remPlan(plain, false).items[0].text, "HAVE YOU DONE YOUR DAILY TASK YET?");
});
ok("a snooze still running is carried over; a finished one is not", () => {
  const live = R.migrateLegacy(null, R.cleanLegacy({ at: "02:00", until: "06:00", text: "", snoozeUntil: 9000 }), true, 1000)!;
  assert.equal(live.state.fu.snoozeUntil, 9000);
  const old = R.migrateLegacy(null, R.cleanLegacy({ at: "02:00", until: "06:00", text: "", snoozeUntil: 500 }), true, 1000)!;
  assert.deepEqual(old.state, {});
});
ok("made on the phone first: the Mac's old settings fill in only what was never changed", () => {
  const seedRec = R.remindOrDefault(null, true);
  assert.ok(seedRec.list[0].seed);
  const edited = R.patchReminder(seedRec, "fu", { sound: "soft" }, 50);   // the phone picked a sound: seed gone
  assert.equal(edited.list[0].seed, undefined);
  assert.equal(R.migrateLegacy(edited, R.cleanLegacy({ at: "03:00", until: "05:00", text: "X" }), true, 60), null);
  // Saved untouched (an Add reminder on the phone, say): still the seed, so the Mac fills it in.
  const added = R.addReminder(seedRec, "zz1", 50);
  const m = R.migrateLegacy(added, R.cleanLegacy({ on: true, at: "03:00", until: "05:00", text: "My words" }), true, 60)!;
  assert.equal(m.list[0].at, "03:00"); assert.equal(m.list[0].text, "My words"); assert.equal(m.list[0].seed, undefined);
  assert.equal(m.list.length, 2);
  assert.equal(R.migrateLegacy(m, R.cleanLegacy({ at: "04:00", until: "05:00", text: "" }), true, 70), null);   // once only
});
ok("no old settings, or reminder one removed: nothing", () => {
  assert.equal(R.migrateLegacy(null, null, true, 1), null);
  const gone = R.removeReminder(R.remindOrDefault(null, true), "fu", 5);
  assert.equal(R.migrateLegacy(gone, R.cleanLegacy({ at: "03:00", until: "05:00", text: "" }), true, 6), null);
});
ok("no record and no Mac: the plan is empty (a phone never pops up something nobody set)", () => {
  assert.deepEqual(R.remPlan(null, true).items, []);
});

// ---------- editing ----------
ok("add, edit, move, remove; a new start time forgets that window's answer", () => {
  let rec = R.remindOrDefault(null, false);
  rec = R.addReminder(rec, "b2", 10);
  assert.equal(rec.list[1].label, "Reminder 2");
  rec = R.applyAct(rec, { id: "b2", act: "done", day: "2026-11-10", at: 11 })!;
  rec = R.patchReminder(rec, "b2", { text: "Water?" }, 12);
  assert.ok(rec.state.b2, "words only: the answer stays");
  rec = R.patchReminder(rec, "b2", { at: "10:00" }, 13);
  assert.equal(rec.state.b2, undefined);
  rec = R.moveReminder(rec, "b2", -1, 14);
  assert.deepEqual(rec.list.map((r) => r.id), ["b2", "fu"]);
  rec = R.removeReminder(rec, "b2", 15);
  assert.deepEqual(rec.list.map((r) => r.id), ["fu"]);
  assert.equal(rec.gone.b2, 15);
  let full = R.emptyRemind();
  for (let i = 0; i < 25; i++) full = R.addReminder(full, `r${i}`, i);
  assert.equal(full.list.length, R.REM_MAX);
  assert.match(R.freshId(full, () => 0.5), /^[a-z0-9]{8}$/);
});

// ---------- two devices at once ----------
ok("merge: each reminder's newer settings and newer state, the newer copy's order", () => {
  const base = R.addReminder(R.addReminder(R.emptyRemind(), "a", 1), "b", 2);
  const mac = R.applyAct(R.patchReminder(base, "a", { text: "Mac words" }, 10), { id: "b", act: "snooze", until: 99, at: 11, by: "mac" })!;
  const phone = R.applyAct(R.moveReminder(R.patchReminder(base, "b", { text: "Phone words" }, 12), "b", -1, 13), { id: "a", act: "done", day: "2026-11-10", at: 14, by: "phone" })!;
  const m = R.mergeRemind(mac, phone);
  assert.deepEqual(m.list.map((r) => r.id), ["b", "a"]);
  assert.equal(m.list.find((r) => r.id === "a")!.text, "Mac words");
  assert.equal(m.list.find((r) => r.id === "b")!.text, "Phone words");
  assert.equal(m.state.a.done, "2026-11-10");
  assert.equal(m.state.b.snoozeUntil, 99);
  assert.deepEqual(R.mergeRemind(phone, mac), m);   // either way round
});
ok("merge: a removal beats an older edit, a newer edit brings it back", () => {
  const base = R.addReminder(R.emptyRemind(), "a", 1);
  const removed = R.removeReminder(base, "a", 10);
  const older = R.patchReminder(base, "a", { text: "x" }, 5);
  assert.deepEqual(R.mergeRemind(removed, older).list, []);
  const newer = R.patchReminder(base, "a", { text: "y" }, 20);
  const m = R.mergeRemind(removed, newer);
  assert.equal(m.list[0].text, "y");
  assert.equal(m.gone.a, undefined);
});
ok("the plan carries every word worked out and the state", () => {
  const rec = R.applyAct(R.addReminder(R.emptyRemind(), "k", 1), { id: "k", act: "snooze", until: 77, at: 3 })!;
  const p = R.remPlan(rec, false).items[0];
  assert.deepEqual(Object.keys(p).sort(), ["accent", "at", "bg", "click", "date", "days", "done", "id", "ink", "later", "on", "open", "pill", "snooze", "snoozeUntil", "sound", "stateAt", "task", "text", "tz", "until", "vol", "word", "yes"]);
  assert.equal(p.snoozeUntil, 77); assert.equal(p.stateAt, 3); assert.equal(p.pill, "Reminder 1");
});
ok("window words for the list", () => {
  assert.equal(R.windowWords(rem({ at: "02:00", until: "06:00", days: [0, 1, 2, 3, 4, 5, 6] })), "02:00 to 06:00, every day");
  assert.equal(R.windowWords(rem({ at: "22:00", until: "01:00", days: [1, 2, 3, 4, 5] })), "22:00 to 01:00 (next day), weekdays");
  assert.equal(R.windowWords(rem({ at: "09:00", until: "10:00", days: [2, 4] })), "09:00 to 10:00, Tue, Thu");
});

console.log(`\n${n} passed`);
