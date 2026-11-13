// Run: node --experimental-strip-types tests/alarmlist.test.ts
// V1.47 alarm playlists (src/core/alarmlist.ts): the day's file in order and random (no repeat until all have played,
// never twice in a row across cycles), files added mid cycle, removed files, reordering, days passing with no alarm,
// the plan the shells get, the ring length and fade, the checks, and that the page, Mac and phone all take part.
// Nothing is played: no sound anywhere.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
const L = await import("../src/core/alarmlist.ts");
const W = await import("../src/core/sleepwake.ts");
const M = await import("../src/core/sleepmode.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const id = (i: number) => i.toString(16).padStart(16, "0");
const tr = (i: number, name = `Talk ${i}`) => ({ id: id(i), name, secs: 600 + i, bytes: 1000 * i, ext: "mp3" });
const D0 = "2026-11-10";
const day = (k: number) => L.dayStr(L.dayNum(D0) + k);
const list = (k: number, order: "seq" | "random" = "seq") => L.addTracks({ ...L.LIST_DEF, on: true, order, seed: "abc123" }, Array.from({ length: k }, (_, i) => tr(i + 1)), D0);
const run = (l: ReturnType<typeof list>, days: number, from = 0) => Array.from({ length: days }, (_, k) => L.pickFor(l, day(from + k))!.id);

ok("in order: day 1 file 1, day 2 file 2, then round again", () => {
  const l = list(3);
  assert.deepEqual(run(l, 7), [id(1), id(2), id(3), id(1), id(2), id(3), id(1)]);
  const p = L.pickFor(l, day(2))!;
  assert.equal(p.n, 3); assert.equal(p.of, 3); assert.equal(p.name, "Talk 3");
  assert.equal(L.pickLine(p, "Today"), "Today: Talk 3, file 3 of 3");
});

ok("the same day always gives the same file (every alarm that day, every device)", () => {
  const l = list(5, "random");
  for (let k = 0; k < 20; k++) assert.equal(L.pickFor(l, day(k))!.id, L.pickFor(structuredClone(l), day(k))!.id);
  // A device that rolled the list on (and saved it) still agrees with one that did not.
  const rolled = L.rollTo(l, day(12));
  for (let k = 12; k < 30; k++) assert.equal(L.pickFor(rolled, day(k))!.id, L.pickFor(l, day(k))!.id, `day ${k}`);
});

ok("random: every file once before any repeats, and never twice in a row across cycles", () => {
  const l = list(7, "random");
  const days = run(l, 70);
  for (let c = 0; c < 10; c++) assert.equal(new Set(days.slice(c * 7, c * 7 + 7)).size, 7, `cycle ${c} plays all 7 once`);
  for (let k = 1; k < days.length; k++) assert.notEqual(days[k], days[k - 1], `day ${k} repeats`);
  // Not simply the list order every time.
  assert.ok(days.slice(0, 21).join() !== run(list(7), 21).join(), "shuffled");
});

ok("random with two files alternates, with one file plays it daily", () => {
  const two = run(list(2, "random"), 10);
  for (let k = 1; k < 10; k++) assert.notEqual(two[k], two[k - 1]);
  assert.deepEqual(run(list(1, "random"), 3), [id(1), id(1), id(1)]);
});

ok("days pass with no alarm: the file moves on by the calendar, and a gap of a year is quick", () => {
  const l = list(3);
  assert.equal(L.pickFor(l, day(10))!.id, id(2));   // day 10: 10 mod 3 = 1, file 2
  const t = Date.now();
  assert.equal(L.pickFor(list(4, "random"), day(400)) !== null, true);
  assert.ok(Date.now() - t < 200, "rolling 400 days is fast");
});

ok("a file added mid cycle (in order) joins this cycle after the rest; today's file stays", () => {
  const l = list(3);
  const today = day(1);   // file 2 plays today
  const l2 = L.addTracks(l, [tr(4)], today);
  assert.equal(L.pickFor(l2, today)!.id, id(2), "today unchanged");
  assert.deepEqual(run(l2, 6, 1), [id(2), id(3), id(4), id(1), id(2), id(3)]);
  assert.equal(L.pickFor(l2, day(2))!.of, 4);
  // The same file added again (on another device, matched by its id) changes nothing.
  assert.equal(L.addTracks(l2, [tr(4)], today), l2);
});

ok("a file added mid cycle (random) plays this cycle, before any repeat; today's file stays", () => {
  const l = list(5, "random");
  const today = day(2);
  const before = L.pickFor(l, today)!.id;
  const played = run(l, 3);
  const l2 = L.addTracks(l, [tr(9)], today);
  assert.equal(L.pickFor(l2, today)!.id, before);
  const rest = run(l2, 3, 3);   // days 3, 4, 5: the cycle has 6 now
  assert.equal(new Set([...played, ...rest]).size, 6, "all six once");
  assert.ok(rest.includes(id(9)), "the new one plays this cycle");
});

ok("a file removed: today's stays when an earlier or later one goes, and the next one plays when today's goes", () => {
  const l = list(5);   // in order, today day(2) = file 3
  const today = day(2);
  const a = L.removeTrack(l, id(1), today);
  assert.equal(L.pickFor(a, today)!.id, id(3), "earlier removed, today stays");
  assert.deepEqual(run(a, 3, 2), [id(3), id(4), id(5)]);
  const b = L.removeTrack(l, id(5), today);
  assert.deepEqual(run(b, 4, 2), [id(3), id(4), id(1), id(2)], "later removed: skipped");
  const c = L.removeTrack(l, id(3), today);
  assert.equal(L.pickFor(c, today)!.id, id(4), "today's removed: the next one");
  assert.equal(L.pickFor(c, today)!.of, 4);
  // Random: removing the one that played yesterday keeps today's file and still plays every other file once.
  const r = list(6, "random");
  const t2 = day(3), yesterday = L.pickFor(r, day(2))!.id, todays = L.pickFor(r, t2)!.id;
  const r2 = L.removeTrack(r, yesterday, t2);
  assert.equal(L.pickFor(r2, t2)!.id, todays);
  const cycle = [...run(r, 2), ...run(r2, 3, 3)];
  assert.equal(new Set(cycle).size, 5);
  // The last file removed: nothing left to play.
  let e = list(1);
  e = L.removeTrack(e, id(1), D0);
  assert.equal(L.pickFor(e, D0), null);
  assert.equal(L.planList(e, Date.parse(`${D0}T12:00:00Z`), "UTC"), null);
});

ok("reorder in order mode: what is still to come follows the new order; today's stays", () => {
  const l = list(4);
  const today = day(1);   // file 2
  const l2 = L.moveTrack(l, id(4), -1, today);   // 1 2 4 3
  assert.equal(L.pickFor(l2, today)!.id, id(2));
  assert.deepEqual(run(l2, 3, 1), [id(2), id(4), id(3)]);
  assert.deepEqual(l2.tracks.map((t) => t.id), [id(1), id(2), id(4), id(3)]);
});

ok("switching in order and random starts a fresh cycle from today", () => {
  const l = list(4);
  const r = L.setOrder(l, "random", day(5));
  assert.equal(r.start, day(5));
  assert.equal(new Set(run(r, 4, 5)).size, 4);
  const s = L.setOrder(r, "seq", day(9));
  assert.deepEqual(run(s, 4, 9), [id(1), id(2), id(3), id(4)]);
});

ok("the settings record is checked: odd values dropped, the cycle only holds files on the list", () => {
  const c = L.cleanList({ on: true, order: "weird", end: "whole", fade: 7, tracks: [tr(1), tr(1), { id: "x", name: "bad" }, tr(2)], seed: "zz", start: "nope", cycle: [id(2), id(3), id(2)] });
  assert.equal(c.order, "seq"); assert.equal(c.end, "whole"); assert.equal(c.fade, 0);
  assert.deepEqual(c.tracks.map((t) => t.id), [id(1), id(2)]);
  assert.equal(c.start, ""); assert.equal(c.seed, "");
  assert.deepEqual(L.cleanList(null), L.LIST_DEF);
  // The wake settings carry it, and an older record without one gets the default (off).
  assert.deepEqual(W.cleanWake({}).list, L.LIST_DEF);
  assert.equal(W.cleanWake({ list: { on: true, tracks: [tr(3)] } }).list.tracks.length, 1);
  const many = L.cleanList({ tracks: Array.from({ length: 90 }, (_, i) => tr(i + 1)) });
  assert.equal(many.tracks.length, L.MAX_TRACKS);
});

ok("file checks: mp3, m4a, wav, aac by their first bytes, the size cap, a plain sentence", () => {
  const b = (s: string, pad = 16) => { const u = new Uint8Array(pad); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  const id3 = b("ID3"), adts = new Uint8Array([0xff, 0xf1, 0x50, 0x80, 0, 0, 0, 0, 0, 0, 0, 0]);
  const m4a = b("\0\0\0\x20ftypM4A "), wav = b("RIFF\0\0\0\0WAVE");
  assert.equal(L.checkFile("a.mp3", 10, id3).ok, true);
  assert.equal(L.checkFile("a.aac", 10, adts).ok, true);
  assert.equal(L.checkFile("a.m4a", 10, m4a).ok, true);
  assert.equal(L.checkFile("a.wav", 10, wav).ok, true);
  const bad = L.checkFile("Les Brown.mp3", 10, b("%PDF-1.7"));
  assert.equal(bad.ok, false);
  assert.match((bad as { why: string }).why, /^Les Brown does not look like a sound file/);
  assert.equal(L.checkFile("a.txt", 10, id3).ok, false);
  assert.equal(L.checkFile("a.flac", 10, b("fLaC")).ok, true);
  assert.equal(L.checkFile("a.ogg", 10, b("OggS")).ok, true);
  assert.match((L.checkFile("big.mp3", 101 * 1024 * 1024, id3) as { why: string }).why, /over 100 MB/);
  assert.equal(L.trackName("Les_Brown - It's Possible.m4a"), "Les Brown - It's Possible");
  assert.equal(L.idFromDigest(new Uint8Array([0, 1, 2, 255, 16, 32, 64, 128, 9])), "000102ff10204080");
});

ok("the plan: today's file and the next days, on the alarm's own clock; off or empty gives none", () => {
  const l = list(3);
  // 23:30 on 10 Nov in the developer's city is already 11 Nov there? No: UTC+4, 19:30Z is 23:30 the same day.
  const now = Date.parse("2026-11-10T19:30:00Z");
  const p = L.planList(l, now, "Asia/Dubai", [Date.parse("2026-11-11T03:00:00Z")])!;
  assert.deepEqual(Object.keys(p.days), [day(0), day(1), day(2)]);
  assert.equal(p.days[day(1)].id, id(2));
  assert.equal(L.dayIn(Date.parse("2026-11-10T21:00:00Z"), "Asia/Dubai"), "2026-11-11", "01:00 next day in the developer's city");
  assert.equal(L.planList({ ...l, on: false }, now, "UTC"), null);
  assert.ok(L.planList({ ...l, on: false }, now, "UTC", [], 3, true), "an alarm that picked the playlist gets it with the switch off");
  assert.deepEqual(p.files[id(3)], { name: "Talk 3", secs: 603 }, "every library file, for an alarm that picked one");
  assert.ok(["list", "style", "builtin", "own", `t:${id(2)}`].every(L.okRingSound) && !L.okRingSound("t:../x") && !L.okRingSound(""));
  assert.ok(L.ringWantsList("list") && L.ringWantsList(`t:${id(2)}`) && !L.ringWantsList("own") && !L.ringWantsList(undefined));
  const one = M.sleepModeOf({ sleepMode: { alarms: [{ id: "a1", at: "07:00", on: true }], wake: { list: { ...l, on: false } } } });
  const withPick = M.buildPlan({ since: now, tz: "UTC", prefs: one, tasks: [], squad: null, now });
  assert.equal(withPick.list, null, "switch off and no alarm asks: no playlist in the plan");
  // The sleep plan carries it (an older shell ignores the field).
  const prefs = M.sleepModeOf({ sleepMode: { alarms: [{ id: "a1", at: "07:00", on: true }], wake: { list: { ...l } } } });
  const plan = M.buildPlan({ since: now, tz: "Asia/Dubai", prefs, tasks: [], squad: null, now });
  assert.ok(plan.list && plan.list.days[day(1)].id === id(2), "the 07:00 alarm on 11 Nov plays file 2");
  const off = M.buildPlan({ since: now, tz: "UTC", prefs: M.sleepModeOf({ sleepMode: {} }), tasks: [], squad: null, now });
  assert.equal(off.list, null);
});

ok("ring length: the whole file (10 min to 3 h) or 10 min looping; the fade in", () => {
  assert.equal(L.ringMs("loop", 3600), 600_000);
  assert.equal(L.ringMs("whole", 60), 600_000);
  assert.equal(L.ringMs("whole", 1800), 1_803_000);
  assert.equal(L.ringMs("whole", 5 * 3600), 3 * 3600_000);
  assert.equal(L.fadeAt(0, 0), 1);
  assert.equal(L.fadeAt(0, 30), 0.05);
  assert.ok(Math.abs(L.fadeAt(15_000, 30) - 0.525) < 1e-9);
  assert.equal(L.fadeAt(31_000, 30), 1);
  assert.equal(L.lenText(3750), "1:02:30"); assert.equal(L.lenText(245), "4:05");
  assert.equal(L.sizeText(25 * 1024 * 1024), "25 MB");
});


ok("My library: a file ticked off stays in the library and leaves the playlist; today's file stays", () => {
  const l = list(4);              // in order, today day(1) = file 2
  const today = day(1);
  const off = L.setInPlaylist(l, id(1), false, today);
  assert.equal(off.tracks.length, 4, "still in the library");
  assert.deepEqual(L.playlistOf(off).map((t) => t.id), [id(2), id(3), id(4)]);
  assert.equal(L.pickFor(off, today)!.id, id(2));
  assert.deepEqual(run(off, 5, 1), [id(2), id(3), id(4), id(2), id(3)]);
  assert.equal(L.pickFor(off, today)!.of, 3, "file n of the playlist");
  // Ticked back in: it plays this cycle, after the rest.
  const on = L.setInPlaylist(off, id(1), true, today);
  assert.deepEqual(run(on, 4, 1), [id(2), id(3), id(4), id(1)]);
  // Today's own file ticked off: the next one plays today.
  assert.equal(L.pickFor(L.setInPlaylist(l, id(2), false, today), today)!.id, id(3));
});

ok("My library: files added to the library only, then Use the whole library", () => {
  const l = L.addTracks(list(2), [tr(5), tr(6)], D0, false);
  assert.equal(l.tracks.length, 4);
  assert.deepEqual(l.skip, [id(5), id(6)]);
  assert.deepEqual(run(l, 4), [id(1), id(2), id(1), id(2)], "only the playlist plays");
  const all = L.useWholeLibrary(l, day(1));
  assert.deepEqual(all.skip, []);
  assert.equal(L.pickFor(all, day(1))!.id, id(2), "today stays");
  assert.deepEqual(run(all, 3, 2), [id(5), id(6), id(1)]);
  // A library file that is not on the playlist can be deleted without moving anything.
  const del = L.removeTrack(l, id(5), D0);
  assert.deepEqual(del.skip, [id(6)]); assert.equal(del.tracks.length, 3);
  assert.deepEqual(run(del, 3), [id(1), id(2), id(1)]);
  // Nothing ticked: no plan, no pick, but the library is kept.
  const none = L.setInPlaylist(L.setInPlaylist(list(2), id(1), false, D0), id(2), false, D0);
  assert.equal(L.pickFor(none, D0), null);
  assert.equal(none.tracks.length, 2);
  const np = L.planList(none, Date.parse(`${D0}T12:00:00Z`), "UTC")!;
  assert.deepEqual(np.days, {}, "no day's file"); assert.equal(Object.keys(np.files).length, 2, "an alarm can still pick one file");
  // The settings record keeps skip only for files in the library, and never a skipped file in the cycle.
  const c = L.cleanList({ ...l, skip: [id(5), id(9)], cycle: [id(1), id(5), id(2)] });
  assert.deepEqual(c.skip, [id(5)]); assert.ok(!c.cycle.includes(id(5)));
});

ok("libraries to add from: the starter pack list is checked (no paths out of its folder), squad sounds grouped by pack", () => {
  const raw = JSON.parse(readFileSync(new URL("../public/alarm-packs/index.json", import.meta.url), "utf8"));
  assert.deepEqual(L.cleanPacks(raw), [], "the slot ships empty: no audio added by PS");
  const p = L.cleanPacks({ packs: [
    { id: "morning-1", name: "Morning talks", note: "Fictional", files: [{ file: "morning-1/talk-one.mp3", name: "Talk one", secs: 600 }, { file: "../../secret.mp3" }, { file: "/etc/x.mp3" }, { file: "morning-1/notes.txt" }, { file: "morning-1/talk_two.m4a" }] },
    { id: "Bad Id", name: "x", files: [{ file: "a.mp3" }] },
    { id: "empty", name: "Nothing", files: [] },
  ] });
  assert.equal(p.length, 1);
  assert.deepEqual(p[0].files.map((f) => f.file), ["morning-1/talk-one.mp3", "morning-1/talk_two.m4a"]);
  assert.equal(p[0].files[1].name, "talk two");
  const g = L.byPack([{ id: "1", pack: "Morning fire" }, { id: "2", pack: "" }, { id: "3", pack: "Morning fire" }]);
  assert.deepEqual(g.map((x) => [x.pack, x.files.length]), [["Morning fire", 2], ["Shared sounds", 1]]);
  assert.match(L.SHARE_NOTE, /^Only share audio you made or have the right to share\.$/);
});

ok("no em or en dashes in the playlist code and words", () => {
  for (const f of ["src/core/alarmlist.ts", "src/sleepmode/list.ts", "src/views/SleepWake.tsx", "tests/alarmlist.test.ts"]) {
    assert.ok(!new RegExp("[\\u2013\\u2014]").test(src(f)), f);
  }
});

// The Mac and the phone: when their branches sit next to this one (or PS_MAC_DIR / PS_GOS_DIR point at them), check
// they read the plan's list and keep Esc, Stop and the volume rules for it.
const mac = process.env.PS_MAC_DIR ?? `${process.env.HOME}/Projects/ps-mac`;
const gos = process.env.PS_GOS_DIR ?? `${process.env.HOME}/Projects/ps-gos`;
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
ok("the Mac and phone shells play the plan's file (checked when their sources have the playlist)", () => {
  const ms = ["AlarmList", "SleepSound", "SleepScreen", "SecondDrop"].map((f) => read(`${mac}/Sources/${f}.swift`)).join("\n");
  const gs = ["AlarmList", "Sleep", "SleepClock", "WebHost"].map((f) => read(`${gos}/app/src/main/java/com/cincee/ps/gos/${f}.kt`)).join("\n");
  if (ms.includes("alarm-list")) {
    assert.ok(ms.includes("sleep:list:pick") && ms.includes("sleep:list:remove") && ms.includes("listFile"), "Mac list messages");
    assert.ok(ms.includes("fadeAt") && ms.includes("ringOnce") && ms.includes("ringLen"), "Mac fade and whole file");
    assert.ok(ms.includes('case "msg", "alarm"') && ms.includes("takeAlarmDrops"), "Mac drops on the playlist, for everyone");
    assert.ok(ms.includes("previewMaxMs") && ms.includes("stopRing()"), "Mac Preview cap and Stop");
  } else console.log("  (the Mac source here has no playlist yet; skipped)");
  if (gs.includes("alarm-list")) {
    assert.ok(gs.includes("sleep:list:put") && gs.includes("sleep:list:remove") && gs.includes("listFile"), "phone list messages");
    assert.ok(gs.includes("ringLen") && gs.includes("fadeAt") && gs.includes("USAGE_ALARM"), "phone whole file, fade, alarm stream");
    assert.ok(gs.includes("ListClock.idOf(part) == id"), "phone checks the file's SHA-256 before keeping it");
  } else console.log("  (the phone source here has no playlist yet; skipped)");
});

console.log(`\n${n} passed`);
