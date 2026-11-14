// Run: node --experimental-strip-types tests/islandtimers.test.ts
// V1.58 the island's timers (src/core/islandtimers.ts): Stand-up reminders (src/core/standup.ts), the next meeting bubble
// (src/core/meetbubble.ts), and the rules between them and Pomodoro: never two takeovers at once, a break counts as
// standing time, the bubble waits for a takeover. Also the Pomodoro button's place (core/tablayout.ts, TaskMap.tsx).
// ps-mac tests/island-timers-test.swift checks the Mac's copy of the same rules.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BACK_SHOW_MS, ISLAND_TONES, dropsStand, standBackId, timersShow } from "../src/core/islandtimers.ts";
import { STAND_ASK_WORDS, STAND_DEFAULT, STAND_LEAD_MS, STAND_WORDS, inHours, nextStand, standAskDue, standAskPatch, standIsland, standPrefs } from "../src/core/standup.ts";
import { MEET_WORDS, meetBubblePrefs, meetIsland, shortLeft } from "../src/core/meetbubble.ts";
import { POMO_DEFAULT, applyOp, breakWindows, pomoIsland, pomoPrefs, resolve } from "../src/core/pomodoro.ts";
import { FOLLOWS, SLOTS, followStyle, emptyLayout } from "../src/core/tablayout.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const MIN = 60_000;
const at = (h: number, m: number, s = 0) => new Date(2026, 10, 13, h, m, s).getTime();   // local time, like the Mac
const P = POMO_DEFAULT;

// ---------- Stand-up timing ----------
ok("defaults from the research: every 30 minutes, stand 2 minutes, on, sound on, any hour", () => {
  assert.deepEqual(standPrefs(undefined), { on: true, every: 30, len: 2, sound: true, hours: false, from: "09:00", to: "18:00" });
  assert.deepEqual(STAND_DEFAULT, standPrefs({}));
});
ok("settings are kept in range; bad times fall back", () => {
  const p = standPrefs({ every: 3, len: 99, from: "25:00", to: "7:5", hours: true, on: false, sound: false });
  assert.equal(p.every, 10); assert.equal(p.len, 15); assert.equal(p.from, "09:00"); assert.equal(p.to, "18:00");
  assert.equal(p.hours, true); assert.equal(p.on, false); assert.equal(p.sound, false);
});
ok("stand-ups line up with the clock: every 30 minutes is :00 and :30", () => {
  const p = standPrefs({});
  assert.equal(nextStand(p, at(10, 7)), at(10, 30));
  assert.equal(nextStand(p, at(10, 30)), at(10, 30), "on now");
  assert.equal(nextStand(p, at(10, 31, 59)), at(10, 30), "still standing: the one on now");
  assert.equal(nextStand(p, at(10, 32)), at(11, 0), "over: the next");
  assert.equal(nextStand(standPrefs({ every: 45 }), at(0, 50)), at(1, 30));
});
ok("the same answer after a restart or a sleep: nothing is saved, it is the clock", () => {
  const p = standPrefs({});
  assert.equal(nextStand(p, at(14, 12)), nextStand(p, at(14, 12)));
  assert.equal(nextStand(p, at(23, 59)), new Date(2026, 10, 14, 0, 0).getTime(), "past midnight");
});
ok("off: none", () => assert.equal(nextStand(standPrefs({ on: false }), at(10, 0)), null));
ok("active hours: only inside them, also past midnight", () => {
  const p = standPrefs({ hours: true, from: "09:00", to: "17:00" });
  assert.equal(nextStand(p, at(7, 0)), at(9, 0));
  assert.equal(nextStand(p, at(16, 45)), new Date(2026, 10, 14, 9, 0).getTime(), "17:00 is outside: tomorrow");
  const night = standPrefs({ hours: true, from: "22:00", to: "02:00" });
  assert.equal(inHours(night, at(23, 0)), true); assert.equal(inHours(night, at(1, 0)), true); assert.equal(inHours(night, at(3, 0)), false);
});
ok("a stand-up in a Pomodoro break is skipped: the break counts as standing time", () => {
  const run = applyOp(null, "start", P, at(10, 5))!;               // work 10:05 to 10:30, break 10:30 to 10:35
  const wins = breakWindows(run, P, at(10, 10));
  assert.deepEqual(wins, [[at(10, 30), at(10, 35)]]);
  const s = standIsland(standPrefs({}), at(10, 10), true, (t) => wins.some(([a, b]) => t >= a && t < b));
  assert.equal(s?.at, at(11, 0), "10:30 falls in the break: the next one");
  const inBreak = resolve(run, P, at(10, 31))!;
  assert.deepEqual(breakWindows(inBreak, P, at(10, 31)), [[at(10, 30), at(10, 35)]]);
  assert.deepEqual(breakWindows(applyOp(run, "pause", P, at(10, 10)), P, at(10, 10)), [], "a paused work session: no break known");
});
ok("Try it now: one stand-up 15 seconds away, whatever the schedule", () => {
  const t = at(10, 7) + STAND_LEAD_MS;
  const s = standIsland(standPrefs({}), at(10, 7), true, undefined, t)!;
  assert.equal(s.at, t); assert.equal(s.test, true);
  assert.equal(standIsland(standPrefs({}), t + 2 * MIN, true, undefined, t)!.test, undefined, "over: back to the schedule");
  assert.equal(standIsland(standPrefs({ sound: true }), at(10, 7), false)!.sound, false, "Do Not Disturb mutes it");
});

// ---------- the meeting bubble ----------
const ev = (id: string, title: string, s: number, e: number, link: string | null = "https://meet.google.com/abc-defg-hij") =>
  ({ id, title, start: new Date(s).toISOString(), end: new Date(e).toISOString(), allDay: false, link, attendees: [] });
ok("meeting bubble defaults: on, 15 minutes before; the lead is kept in range", () => {
  assert.deepEqual(meetBubblePrefs(undefined), { on: true, lead: 15 });
  assert.equal(meetBubblePrefs({ lead: 0 }).lead, 1); assert.equal(meetBubblePrefs({ lead: 500 }).lead, 120);
});
ok("the next meeting within the lead time, sent a little early so the island starts it on time", () => {
  const list = [ev("a", "Design review", at(11, 0), at(11, 30)), ev("b", "Later", at(15, 0), at(16, 0))];
  assert.equal(meetIsland(list, [], meetBubblePrefs({}), at(10, 40), false), null, "20 minutes away: nothing");
  const m = meetIsland(list, [], meetBubblePrefs({}), at(10, 44), false)!;
  assert.equal(m.title, "Design review"); assert.equal(m.from, at(10, 45)); assert.equal(m.link, "https://meet.google.com/abc-defg-hij");
  assert.equal(meetIsland(list, [], meetBubblePrefs({ on: false }), at(10, 50), false), null, "off");
  assert.equal(meetIsland(list, [], meetBubblePrefs({}), at(10, 50), true)!.title, MEET_WORDS.meeting, "private mode hides the name");
  assert.equal(meetIsland([ev("c", "x", at(11, 0), at(11, 30), "javascript:alert(1)")], [], meetBubblePrefs({}), at(10, 50), false)!.link, null, "https links only");
});
ok("during a meeting it stays; one starting soon wins over one nearly over", () => {
  const list = [ev("a", "Now", at(10, 0), at(11, 0)), ev("b", "Next", at(11, 0), at(11, 30))];
  assert.equal(meetIsland(list, [], meetBubblePrefs({}), at(10, 30), false)!.title, "Now");
  assert.equal(meetIsland(list, [], meetBubblePrefs({}), at(10, 50), false)!.title, "Next");
  assert.equal(meetIsland([{ ...ev("d", "All day", at(0, 0), at(23, 0)), allDay: true }], [], meetBubblePrefs({}), at(10, 0), false), null, "all day is not a meeting");
});
ok("short times", () => {
  assert.equal(shortLeft(12 * MIN), "12m"); assert.equal(shortLeft(11 * MIN + 1), "12m"); assert.equal(shortLeft(45_000), "45s"); assert.equal(shortLeft(65 * MIN), "1h 5m");
  assert.equal(MEET_WORDS.in("Design review", "12m"), "Design review in 12m");
});

// ---------- the shared rules ----------
const stand = (t: number) => ({ at: t, len: 2 * MIN, sound: true });
ok("stand-up: nothing until the last 15 seconds, then the right tab, then Stand up, then the green tick, then the task", () => {
  const s = stand(at(10, 30));
  const show = (now: number, seen?: Set<string>) => timersShow({ pomo: null, stand: s, meet: null }, now, seen);
  assert.deepEqual(show(at(10, 29, 44)), { middle: { kind: "task" }, right: { kind: "none" } });
  assert.deepEqual(show(at(10, 29, 45)).right, { kind: "standSoon", at: at(10, 30) });
  assert.deepEqual(show(at(10, 30)).middle, { kind: "stand", at: at(10, 30), endsAt: at(10, 32) });
  assert.equal(show(at(10, 30)).right.kind, "none", "a takeover hides the bubble");
  const id = standBackId(s, at(10, 32))!;
  assert.deepEqual(show(at(10, 32)).middle, { kind: "back", id, words: STAND_WORDS.back });
  assert.deepEqual(show(at(10, 32, 1), new Set([id])).middle, { kind: "task" });
  assert.equal(show(at(10, 40)).middle.kind, "task", "no old tick later");
});
ok("never two takeovers: a break wins, and a stand-up that comes in a break is dropped", () => {
  const run = resolve(applyOp(null, "start", P, at(10, 5)), P, at(10, 31));
  const pomo = pomoIsland(run, P, at(10, 31), true);
  const t = { pomo, stand: stand(at(10, 32)), meet: null };
  assert.equal(timersShow(t, at(10, 31, 50)).right.kind, "none", "no tab counting down in a break");
  assert.equal(timersShow(t, at(10, 32)).middle.kind, "break");
  assert.equal(dropsStand(t, at(10, 32)), at(10, 32));
  assert.equal(timersShow({ ...t, pomo: null }, at(10, 33), new Set(), new Set([at(10, 32)])).middle.kind, "task", "dropped: never shown after");
});
ok("the meeting bubble: soon, Join in the last 2 minutes with a link, time left during, hidden by a takeover", () => {
  const m = meetIsland([ev("a", "Design review", at(11, 0), at(11, 30))], [], meetBubblePrefs({}), at(10, 50), false)!;
  const show = (now: number, extra: Partial<Parameters<typeof timersShow>[0]> = {}) => timersShow({ pomo: null, stand: null, meet: m, ...extra }, now);
  assert.equal(show(at(10, 44)).right.kind, "none");
  assert.deepEqual(show(at(10, 45)).right, { kind: "meet", mode: "soon", m });
  assert.deepEqual(show(at(10, 58, 30)).right, { kind: "meet", mode: "join", m });
  assert.deepEqual(show(at(11, 10)).right, { kind: "meet", mode: "now", m });
  assert.equal(show(at(11, 30)).right.kind, "none");
  assert.equal(timersShow({ pomo: null, stand: null, meet: { ...m, link: null } }, at(10, 59)).right.kind === "meet" &&
    (timersShow({ pomo: null, stand: null, meet: { ...m, link: null } }, at(10, 59)).right as { mode: string }).mode, "soon", "no link, no Join");
  assert.equal(show(at(10, 50), { stand: stand(at(10, 50)) }).right.kind, "none", "Stand up has the island: the bubble waits");
  assert.equal(show(at(10, 55), { stand: stand(at(10, 50)) }).right.kind, "meet", "and comes back after");
  assert.equal(show(at(10, 49, 50), { stand: stand(at(10, 50)) }).right.kind, "standSoon", "most urgent wins the right side");
});
ok("the green tick shows for the same few seconds for every timer, with the same chime", () => {
  assert.equal(BACK_SHOW_MS, 3200);
  assert.ok(ISLAND_TONES.done.length > 2 && ISLAND_TONES.start.length > 1);
  for (const t of [...ISLAND_TONES.done, ...ISLAND_TONES.start]) assert.ok(t.peak <= 0.1, "quiet");
});

// ---------- the Pomodoro button's place ----------
ok("by default the Pomodoro button sits between Time zones and Sentry mode", () => {
  const ids = SLOTS.map((x) => x.id);
  assert.equal(ids.indexOf("pomodoro"), ids.indexOf("clocks") + 1);
  assert.equal(ids.indexOf("sentry"), ids.indexOf("pomodoro") + 1);
  const tm = readFileSync(new URL("../src/views/TaskMap.tsx", import.meta.url), "utf8");
  const a = tm.indexOf('<Slot id="clocks">'), b = tm.indexOf('<Slot id="pomodoro">'), c = tm.indexOf('<Slot id="sentry">');
  assert.ok(a > 0 && a < b && b < c, "drawn in that order in the Tab list");
  assert.equal(tm.split('<Slot id="pomodoro">').length, 2, "once");
});
ok("someone who moved Time zones: Pomodoro follows it, right below; otherwise it keeps its own place", () => {
  assert.equal(FOLLOWS.pomodoro, "clocks");
  const l = emptyLayout();
  assert.equal(followStyle(l, "pomodoro"), null, "nothing moved: the column");
  const moved = { ...l, pos: { clocks: { x: 0.5, y: 0.2, w: 300, h: 120 } } };
  const s = followStyle(moved, "pomodoro")!;
  assert.match(s.top, /\+ 128px\)$/); assert.ok(s.left.includes("0.5"));
  assert.equal(followStyle({ ...moved, pos: { ...moved.pos, pomodoro: { x: 0, y: 0, w: 120, h: 34 } } }, "pomodoro"), null, "moved itself: its own place");
  assert.equal(followStyle({ ...moved, hidden: ["clocks"] }, "pomodoro"), null, "Time zones taken off: the column");
  assert.equal(followStyle({ ...moved, page: { clocks: "abcd1" } }, "pomodoro"), null, "Time zones on another list: the column");
  assert.ok(followStyle({ ...l, pos: { clocks: { x: 0.1, y: 0.9, w: 300, h: 120 } } }, "pomodoro")!.bottom, "low on the screen: anchored from the bottom");
  assert.equal(followStyle(moved, "sentry"), null);
});

// ---------- words ----------
ok("plain words, no long dashes, in every new file", () => {
  for (const f of ["src/core/islandtimers.ts", "src/core/standup.ts", "src/core/meetbubble.ts", "src/views/IslandTimersSettings.tsx"]) {
    assert.doesNotMatch(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), /[–—]/, f);
  }
});

// ---------- V1.59: on by default for everyone, and the first stand-up asks once ----------
ok("stand-ups are on for a new person (no settings at all)", () => {
  assert.equal(standPrefs(undefined).on, true);
  assert.notEqual(standIsland(standPrefs(undefined), at(10, 7), true), null);
});
ok("stand-ups are on for someone who changed other stand-up settings but never the switch", () => {
  assert.equal(standPrefs({ every: 45, sound: false }).on, true);
  assert.equal(standPrefs({ on: undefined, len: 3 }).on, true);
  assert.equal(standPrefs(null).on, true);
});
ok("someone who switched them off keeps them off", () => {
  assert.equal(standPrefs({ on: false }).on, false);
  assert.equal(standIsland(standPrefs({ on: false }), at(10, 7), true), null);
});
ok("the page's settings cleaner keeps standAsk only as true", () => {
  const src = readFileSync(new URL("../src/ps.ts", import.meta.url), "utf8");
  assert.match(src, /if \(p\.standAsk === true\) o\.standAsk = true;/);
});
ok("ask: due until seen, only with stand-ups on", () => {
  assert.equal(standAskDue({}), true, "a new person");
  assert.equal(standAskDue({ standup: { every: 20 } }), true, "never touched the switch");
  assert.equal(standAskDue({ standAsk: true }), false, "seen: never again");
  assert.equal(standAskDue({ standup: { on: false } }), false, "already off: nothing to ask");
});
ok("ask: sent with the next real stand-up, never with Try it now", () => {
  const p = standPrefs({});
  assert.equal(standIsland(p, at(10, 7), true, undefined, null, true)?.ask, true);
  assert.equal(standIsland(p, at(10, 7), true, undefined, null, false)?.ask, undefined);
  const tried = standIsland(p, at(10, 7), true, undefined, at(10, 7), true);
  assert.equal(tried?.test, true); assert.equal(tried?.ask, undefined);
});
ok("ask: every answer marks it seen; Turn off also switches stand-ups off and keeps the rest", () => {
  assert.deepEqual(standAskPatch("seen", undefined), { standAsk: true });
  assert.deepEqual(standAskPatch("keep", undefined), { standAsk: true });
  assert.deepEqual(standAskPatch("settings", undefined), { standAsk: true });
  assert.deepEqual(standAskPatch("off", { every: 45, len: 3 }), { standAsk: true, standup: { ...standPrefs({ every: 45, len: 3 }), on: false } });
  assert.equal(standAskPatch("nonsense", undefined), null);
  assert.equal(standAskPatch(undefined, undefined), null);
});
ok("ask: the words (the Mac's copy is ps-mac IslandBubbleCore.swift StandAsk) with no long dashes", () => {
  assert.equal(STAND_ASK_WORDS.title, "Do you want to turn stand-up reminders off?");
  assert.deepEqual([STAND_ASK_WORDS.off, STAND_ASK_WORDS.settings, STAND_ASK_WORDS.keep], ["Turn off", "See settings", "Keep them on"]);
  for (const w of Object.values(STAND_ASK_WORDS)) assert.ok(!/[\u2013\u2014]/.test(w));
});
ok("ask: the island page saves the answer and Settings opens on a tab by name", () => {
  const isl = readFileSync(new URL("../src/island.ts", import.meta.url), "utf8");
  assert.match(isl, /m\.action === "standAsk"/);
  assert.match(isl, /standAskDue\(st\)/);
  const set = readFileSync(new URL("../src/views/SettingsScreen.tsx", import.meta.url), "utf8");
  assert.match(set, /__psOpenSettings = \(to\?: unknown\)/);
});
console.log(`\n${n} passed`);
