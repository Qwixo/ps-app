// Checklist reminder (core/chkremind.ts, PS 1.65): the setting, when the pop-up may come, the Rethink counter, the Dimension X
// cards, the island pin rule and the words.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CHK_BANDS, CHK_CHOICES, CHK_DEFAULT, CHK_EVERY_CHOICES, CHK_EVERY_DEF, CHK_EVERY_MAX, CHK_EVERY_MIN, CHK_MAX_TASKS, CHK_WORDS,
  checklistTasks, chkBlock, chkStart, chkStep, cleanChk, counter, dimxCard, everyLabel, isScreen, lastTickOf, needsIslandPin, overBy,
  chkCardItem, dimxQueue, screenOf, sureOk, withCard, withoutCard, type ChkFacts,
} from "../src/core/chkremind.ts";
import type { DimxItem, Doc, Todo } from "../src/core/model.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const T0 = Date.parse("2026-11-17T09:00:00Z");
const MIN = 60_000;

const facts = (o: Partial<ChkFacts> = {}): ChkFacts => ({ now: T0, enabled: true, ready: true, everyMin: 120, lastTickAt: 0, openTasks: 3, cardOpen: false, block: null, ...o });
const doc = (id: string, o: Partial<Todo> = {}) => ({ id, data: { title: id, type: "once", done: false, order: 0, ...o } }) as unknown as Doc<Todo>;

ok("default is on, every 2 hours", () => { assert.deepEqual(CHK_DEFAULT, { on: true, every: 120, sound: true }); assert.deepEqual(cleanChk(undefined), CHK_DEFAULT); assert.deepEqual(cleanChk("x"), CHK_DEFAULT); });
ok("the interval is held between 30 minutes and 12 hours", () => {
  assert.equal(cleanChk({ every: 5 }).every, CHK_EVERY_MIN);
  assert.equal(cleanChk({ every: 99999 }).every, CHK_EVERY_MAX);
  assert.equal(cleanChk({ every: 90.4 }).every, 90);
  assert.equal(cleanChk({ every: NaN }).every, CHK_EVERY_DEF);
  assert.equal(cleanChk({ every: "60" }).every, CHK_EVERY_DEF);
  for (const m of CHK_EVERY_CHOICES) assert.equal(cleanChk({ every: m }).every, m);
});
ok("off is only an explicit false", () => { assert.equal(cleanChk({ sound: false }).sound, false); assert.equal(cleanChk({}).sound, true); assert.equal(cleanChk({ on: false }).on, false); assert.equal(cleanChk({ on: 0 }).on, true); assert.equal(cleanChk({}).on, true); });
ok("the menu runs from 30 minutes to 12 hours", () => { assert.equal(CHK_EVERY_CHOICES[0], 30); assert.equal(CHK_EVERY_CHOICES[CHK_EVERY_CHOICES.length - 1], 720); assert.ok(CHK_EVERY_CHOICES.includes(120)); });
ok("the interval reads in plain words", () => {
  assert.equal(everyLabel(30), "30 minutes"); assert.equal(everyLabel(60), "1 hour"); assert.equal(everyLabel(90), "1 hour 30 minutes");
  assert.equal(everyLabel(120), "2 hours"); assert.equal(everyLabel(720), "12 hours"); assert.equal(everyLabel(1), "30 minutes");
});

ok("it comes after the whole interval with no tick", () => {
  const c = chkStart(T0);
  assert.equal(chkStep(c, facts({ now: T0 + 119 * MIN })).fire, false);
  const r = chkStep(c, facts({ now: T0 + 120 * MIN }));
  assert.equal(r.fire, true);
  assert.equal(r.clock.since, T0 + 120 * MIN);       // counts again from the pop-up
});
ok("a tick inside the interval puts it off", () => {
  const c = chkStep(chkStart(T0), facts({ now: T0 + 119 * MIN, lastTickAt: T0 + 100 * MIN })).clock;
  assert.equal(chkStep(c, facts({ now: T0 + 130 * MIN, lastTickAt: T0 + 100 * MIN })).fire, false);
  assert.equal(chkStep(c, facts({ now: T0 + 220 * MIN, lastTickAt: T0 + 100 * MIN })).fire, true);
});
ok("a tick long ago does not make it come at once after PS opens", () => {
  const c = chkStart(T0);
  assert.equal(chkStep(c, facts({ now: T0 + MIN, lastTickAt: T0 - 9 * 60 * MIN })).fire, false);
});
ok("a tick stamped by a clock that runs ahead counts as now, so the pop-up does not come right after a real tick", () => {
  assert.equal(chkStep(chkStart(T0), facts({ now: T0 + 121 * MIN, lastTickAt: T0 + 999 * MIN })).fire, false);
  assert.equal(chkStep(chkStart(T0), facts({ now: T0 + 121 * MIN, lastTickAt: T0 + 122 * MIN })).fire, false);
  assert.equal(chkStep(chkStart(T0), facts({ now: T0 + 121 * MIN, lastTickAt: 0 })).fire, true);
});
ok("every blocker keeps it away and restarts the count", () => {
  for (const b of ["locked", "protected", "meeting", "sleep", "sentry", "dnd", "away", "setup"] as const) {
    const r = chkStep(chkStart(T0), facts({ now: T0 + 500 * MIN, block: b }));
    assert.equal(r.fire, false, b);
    assert.equal(r.clock.since, T0 + 500 * MIN, b);
  }
});
ok("it never comes the moment a meeting ends", () => {
  let c = chkStart(T0);
  c = chkStep(c, facts({ now: T0 + 200 * MIN, block: "meeting" })).clock;
  assert.equal(chkStep(c, facts({ now: T0 + 201 * MIN })).fire, false);
  assert.equal(chkStep(c, facts({ now: T0 + 320 * MIN })).fire, true);
});
ok("off, not ready, no open task, or a card already up: never", () => {
  for (const o of [{ enabled: false }, { ready: false }, { openTasks: 0 }, { cardOpen: true }]) assert.equal(chkStep(chkStart(T0), facts({ now: T0 + 999 * MIN, ...o })).fire, false);
});
ok("a clock that went backwards starts again", () => { const r = chkStep({ since: T0 + 10_000 * MIN }, facts({ now: T0 })); assert.equal(r.fire, false); assert.equal(r.clock.since, T0); });
ok("30 minutes works as the shortest and 12 hours as the longest", () => {
  assert.equal(chkStep(chkStart(T0), facts({ everyMin: 30, now: T0 + 30 * MIN })).fire, true);
  assert.equal(chkStep(chkStart(T0), facts({ everyMin: 720, now: T0 + 719 * MIN })).fire, false);
  assert.equal(chkStep(chkStart(T0), facts({ everyMin: 720, now: T0 + 720 * MIN })).fire, true);
});

ok("the first blocker in the list wins", () => {
  const none = { locked: false, protectedFront: false, inMeeting: false, sleepMode: false, sentry: false, dnd: false, away: false, setup: false };
  assert.equal(chkBlock(none), null);
  assert.equal(chkBlock({ ...none, inMeeting: true }), "meeting");
  assert.equal(chkBlock({ ...none, away: true, dnd: true }), "dnd");
  assert.equal(chkBlock({ ...none, protectedFront: true, inMeeting: true }), "protected");
  assert.equal(chkBlock({ ...none, locked: true, away: true }), "locked");
});

ok("the newest tick is found", () => {
  const t = (done: boolean, at: string | null) => ({ data: { done, doneAt: at } });
  assert.equal(lastTickOf([]), 0);
  assert.equal(lastTickOf([t(true, "2026-11-17T08:00:00Z"), t(true, "2026-11-17T08:30:00Z"), t(false, "2026-11-17T09:30:00Z"), t(true, null), t(true, "junk")]), Date.parse("2026-11-17T08:30:00Z"));
});

ok("the checklist is every task still to do, once", () => {
  const a = doc("a"), b = doc("b"), c = doc("c", { done: true }), d = doc("d", { type: "daily" }), e = doc("e");
  const lists = { p1: [a], prio: [b, c], daily: [d], groups: new Map([["g1", [e, a]]]) };
  assert.deepEqual(checklistTasks(lists).map((x) => x.id), ["a", "b", "d", "e"]);
});

ok("the limit is 5 and the counter counts the tasks over it", () => {
  assert.equal(CHK_MAX_TASKS, 5);
  assert.equal(overBy(9), 4); assert.equal(overBy(5), 0); assert.equal(overBy(0), 0); assert.equal(overBy(6), 1);
  assert.equal(counter(9, 0).label, "Delete 0/4 tasks");
  assert.equal(counter(9, 2).label, "Delete 2/4 tasks");
  assert.equal(counter(9, 4).reached, true);
  assert.equal(counter(9, 7).label, "Delete 4/4 tasks");     // never past the goal on screen
  assert.equal(counter(5, 0).need, 0); assert.equal(counter(5, 0).reached, false);
  assert.equal(counter(9, -3).gone, 0);
});

ok("a task sent to Dimension X becomes a text card at the top of its band", () => {
  const old: DimxItem[] = [{ id: "1", text: "x1", zone: "x", createdAt: "t" }, { id: "2", text: "s1", zone: "soon", createdAt: "t" }];
  const card = dimxCard({ id: "t1", title: "  Call mum  " }, "soon", "now");
  assert.deepEqual(card, { id: "t1", text: "Call mum", zone: "soon", createdAt: "now" });
  assert.deepEqual(withCard(old, card).map((x) => x.id), ["1", "t1", "2"]);
  assert.deepEqual(withCard(withCard(old, card), card).filter((x) => x.id === "t1").length, 1);    // never doubled
  assert.deepEqual(withoutCard(withCard(old, card), "t1"), old);                                    // Undo
  assert.equal(dimxCard({ id: "z", title: "" }, "x", "n").text, "Untitled task");
  assert.equal(dimxCard({ id: "z", title: "a".repeat(900) }, "x", "n").text.length, 500);
});
ok("the bands are the three Dimension X shows", () => { assert.deepEqual(CHK_BANDS.map((b) => b.zone), ["act", "soon", "x"]); });

ok("pinning to the island never unpins a task that is already there", () => { assert.equal(needsIslandPin(["a"], "a"), false); assert.equal(needsIslandPin(["a"], "b"), true); assert.equal(needsIslandPin([], "b"), true); });

ok("the three choices are worded exactly as the request says", () => {
  assert.deepEqual([...CHK_CHOICES], ["Rethink to do list", "I know what I'm doing, I'm getting tasks done", "I forgot"]);
  assert.equal(CHK_WORDS.headline, "DO YOUR CHECKLIST");
  assert.equal(CHK_WORDS.rethinkHeadline, "Luc life lesson recommends max 5 tasks on your checklist in a day. You can send the rest to Dimension X.");
  assert.equal(CHK_WORDS.areYouSure, "Are you sure?");
  assert.equal(CHK_WORDS.islandAsk, "Add it to the Dynamic Island?");
});
ok("choices map to screens, the second is typed on the card", () => { assert.equal(screenOf(0), "rethink"); assert.equal(screenOf(1), null); assert.equal(screenOf(2), "forgot"); assert.ok(isScreen("rethink")); assert.ok(!isScreen("x")); });
ok("only yes passes Are you sure", () => { assert.ok(sureOk("yes")); assert.ok(sureOk("  YES ")); assert.ok(!sureOk("y")); assert.ok(!sureOk("yes please")); assert.ok(!sureOk("")); assert.ok(!sureOk(undefined)); });

ok("no em or en dash anywhere in the words or the logic", () => {
  const src = readFileSync(new URL("../src/core/chkremind.ts", import.meta.url), "utf8");
  assert.ok(!/[–—]/.test(src));
  for (const w of Object.values(CHK_WORDS)) assert.ok(!/[–—]/.test(w));
});

ok("the card handed to the Mac has the three choices, the typed yes second, and the sound switch", () => {
  const c = chkCardItem(CHK_DEFAULT);
  assert.deepEqual(c.choices, [...CHK_CHOICES]); assert.equal(c.sure, 1); assert.equal(c.word, "yes"); assert.equal(c.sound, "soft");
  assert.equal(c.text, "DO YOUR CHECKLIST"); assert.equal(chkCardItem({ ...CHK_DEFAULT, sound: false }).sound, "none");
  assert.ok(String(c.ask).length <= 60 && String(c.text).length <= 80 && CHK_CHOICES.every((w) => w.length <= 60));   // the Mac's limits (RemMath.item)
});

const okA = async (name: string, fn: () => Promise<unknown>) => { await fn(); n++; console.log("ok -", name); };
const card = (id: string, zone: "act" | "soon" | "x" = "act"): DimxItem => ({ id, text: id, zone, createdAt: "2026-11-17T09:00:00.000Z" });
const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

await okA("two sends close together keep both cards, even when the page's list is a write behind", async () => {
  let saved: DimxItem[] = [card("old", "x")];
  const removed: string[] = [];
  const stale = [card("old", "x")];                       // the page's state never catches up during this test
  const q = dimxQueue(() => stale, async (l) => { await later(5); saved = l; }, async (id) => { removed.push(id); });
  const a = q.send(card("a")), b = q.send(card("b"));
  assert.deepEqual(await Promise.all([a, b]), [true, true]);
  assert.deepEqual(saved.map((x) => x.id).sort(), ["a", "b", "old"]);
  assert.deepEqual(removed, ["a", "b"]);
});
await okA("a failed Dimension X write never deletes the task, and the next send still works", async () => {
  let saved: DimxItem[] = [];
  const removed: string[] = [];
  let fail = true;
  const q = dimxQueue(() => saved, async (l) => { if (fail) { fail = false; throw new Error("offline"); } saved = l; }, async (id) => { removed.push(id); });
  assert.equal(await q.send(card("a")), false);
  assert.deepEqual(removed, []);
  assert.equal(await q.send(card("b")), true);
  assert.deepEqual(removed, ["b"]);
  assert.ok(saved.some((x) => x.id === "b"));
});
await okA("undo takes only its own card back out, and the page's list is trusted again once idle", async () => {
  let saved: DimxItem[] = [];
  let page: DimxItem[] = [];
  const q = dimxQueue(() => page, async (l) => { saved = l; }, async () => {});
  await q.send(card("a")); await q.send(card("b"));
  assert.equal(await q.unsend("a", async () => {}), true);
  assert.deepEqual(saved.map((x) => x.id), ["b"]);
  page = [card("z")]; q.fresh();
  await q.send(card("c"));
  assert.deepEqual(saved.map((x) => x.id).sort(), ["c", "z"]);
});
ok("the website goes to To-do before it opens a screen, and the pop-up stays off the phone", () => {
  const w = readFileSync(new URL("../src/chkwatch.ts", import.meta.url), "utf8");
  assert.match(w, /goToTodo\(\); openChkScreen\(outcome\)/);
  const a = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(a, /!MWEB && <ChecklistReminderHost/);
  assert.match(a, /MODE !== "gos" && !MWEB && <ChecklistReminderHost/);
  const t = readFileSync(new URL("../src/chkwatch.ts", import.meta.url), "utf8");
  assert.ok(t.indexOf("if (!enabled)") < t.indexOf("checklistNow()", t.indexOf("function tick")), "nothing is worked out while it is off");
});
ok("the Mac drops a held card when the person is away or a quiet spell is on", () => {
  const m = readFileSync(new URL("../../mac/Sources/Reminders.swift", import.meta.url), "utf8");
  assert.match(m, /chkItem != nil, !up\.contains\(Reminders\.chkId\), quiet \|\| !here/);
  assert.match(m, /onChk\?\("away"\)/);
});
console.log(`${n} passed`);
