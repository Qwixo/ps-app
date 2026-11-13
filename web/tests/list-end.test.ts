// The end of the Tab list (V1.47): Complete all and its one Undo, Resurrect that shows whenever something can come
// back (it used to live inside Completed and went away with it), and the Fitness menu button as a hamburger.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COMPLETE_ALL_ASK, cleanTodoOp, completedList, listPrefs, openOnList, resurrectList, resurrectSince, keepSince } from "../src/core/completed.ts";
import { tabLists } from "../src/core/groups.ts";
import { tickPatch } from "../src/core/repeat.ts";
import type { Doc, Todo } from "../src/core/model.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const TB = "Asia/Dubai";
const at = (iso: string) => Date.parse(iso);
const NOW = at("2026-11-10T10:00:00Z");   // 14:00 on 10 Nov in the developer's city
const TODAY = "2026-11-10";
const task = (id: string, data: Partial<Todo>): Doc<Todo> =>
  ({ id, ws: null, kind: "todo", author: null, updatedAt: null, data: { title: id, type: "once", done: false, order: 0, ...data } }) as Doc<Todo>;
const every = (id: string, data: Partial<Todo> = {}) => task(id, { type: "daily", repeat: { every: "day" } as Todo["repeat"], ...data });

// ---------- Complete all ----------
ok("Complete all takes every open task on the list: Priority 1, Priorities, Every day and groups, each once", () => {
  const all = [
    task("p1-aaaaaaaa", { p1: true, order: 1 }),
    task("prio-aaaaaa", { order: 2 }),
    task("prio-bbbbbb", { order: 3, done: true, doneAt: "2026-11-10T08:00:00Z" }),
    every("daily-aaaaa"),
    every("daily-bbbbb", { done: true, doneAt: "2026-11-10T07:00:00Z" }),
    task("group-aaaaa", { group: "g1", order: 4 }),
  ];
  const lists = tabLists(all, [{ id: "g1", name: "Work" } as never], TODAY, { now: NOW, tz: TB });
  assert.deepEqual(openOnList(lists), ["p1-aaaaaaaa", "prio-aaaaaa", "daily-aaaaa", "group-aaaaa"]);
});
ok("Complete all leaves overdue tasks alone (they are in the Overdue card, not on the list)", () => {
  const all = [task("late-aaaaaa", { due: "2026-11-01" }), task("fine-aaaaaa", { due: "2026-11-10" })];
  const lists = tabLists(all, [], TODAY, { now: NOW, tz: TB });
  assert.deepEqual(openOnList(lists), ["fine-aaaaaa"]);
});
ok("nothing open: no Complete all (empty list)", () => {
  assert.deepEqual(openOnList(tabLists([task("x-aaaaaaaa", { done: true, doneAt: "2026-11-10T08:00:00Z" })], [], TODAY)), []);
});
ok("it asks first only when it would tick more than a few", () => {
  assert.equal(COMPLETE_ALL_ASK, 5);
  const c = src("views/Completed.tsx");
  assert.match(c, /n > COMPLETE_ALL_ASK \? |if \(n > COMPLETE_ALL_ASK\) \{ sfx\.click\(\); setAsking\(true\); \} else run\(\);/);
  assert.match(c, /Tick all \{n\}\?/);
  assert.match(c, /e\.key === "Escape"/, "Esc says no to the question");
});
ok("one Undo puts them all back: Complete all ticks the ids once, its Undo unticks the same ids", () => {
  const c = src("views/Completed.tsx");
  assert.match(c, /sendCompleteAll\(ids\);\s*pushUndoAction\(`all:\$\{ids\[0\]\}:\$\{ids\.length\}`, [^;]+\(\) => sendTicks\(ids, false\)\);/);
  const m = src("views/TaskMap.tsx");
  assert.match(m, /export function sendCompleteAll\(ids: string\[\]\) \{[\s\S]*?taskMapActions\.tickMany\(ids, true\);/);
});
ok("Undo of Complete all is exact for Every day tasks too: the streak tick is taken back", () => {
  const t: Todo = { title: "Gym", type: "daily", done: false, order: 0, repeat: { every: "day" } as Todo["repeat"], streak: 4, bestStreak: 4 };
  const ticked = { ...t, ...tickPatch(t, "2026-11-10T10:00:00Z") } as Todo;
  assert.equal(ticked.done, true); assert.equal(ticked.streak, 5);
  const back = { ...ticked, ...tickPatch(ticked, "2026-11-10T10:00:05Z") } as Todo;
  assert.equal(back.done, false); assert.equal(back.doneAt, null); assert.equal(back.streak, 4); assert.equal(back.bestStreak, 5);
});
ok("the cascade is short however long the list: under a second, none with reduced motion", () => {
  const m = src("views/TaskMap.tsx");
  assert.match(m, /const step = reduce \? 0 : Math\.min\(70, Math\.floor\(900 \/ ids\.length\)\);/);
});

// ---------- Resurrect ----------
const prefs = listPrefs({});
ok("Completed shows tasks: Resurrect brings back exactly those (as before)", () => {
  const all = [task("a-aaaaaaaa", { done: true, doneAt: "2026-11-10T08:00:00Z" }), task("b-bbbbbbbb", { done: true, doneAt: "2026-11-09T08:00:00Z", clearedAt: "2026-11-09T20:00:00Z" })];
  assert.deepEqual(resurrectList(all, prefs, NOW, TB).map((d) => d.id), completedList(all, "today", NOW, TB).map((d) => d.id));
  assert.deepEqual(resurrectList(all, prefs, NOW, TB).map((d) => d.id), ["a-aaaaaaaa"]);
});
ok("the cause: after the reset Completed is empty, and Resurrect used to go with it; now it brings back yesterday's ticks", () => {
  const all = [
    task("y-aaaaaaaa", { done: true, doneAt: "2026-11-09T15:00:00Z", clearedAt: "2026-11-09T20:00:00Z" }),   // ticked yesterday, cleared by the midnight reset
    task("y-bbbbbbbb", { done: true, doneAt: "2026-11-09T17:00:00Z" }),
    task("old-aaaaaa", { done: true, doneAt: "2026-11-05T10:00:00Z", clearedAt: "2026-11-05T20:00:00Z" }),     // too old
    every("d-aaaaaaaa", { done: true, doneAt: "2026-11-10T06:00:00Z" }),                                       // repeating: never
    task("open-aaaaa"),
  ];
  assert.equal(completedList(all, "today", NOW, TB).length, 0, "Completed is empty");
  assert.deepEqual(resurrectList(all, prefs, NOW, TB).map((d) => d.id), ["y-bbbbbbbb", "y-aaaaaaaa"], "newest first");
});
ok("End day or Clear today: the cleared ones can still come back", () => {
  const all = [task("c-aaaaaaaa", { done: true, doneAt: "2026-11-10T08:00:00Z", clearedAt: "2026-11-10T09:00:00Z" })];
  assert.deepEqual(resurrectList(all, prefs, NOW, TB).map((d) => d.id), ["c-aaaaaaaa"]);
});
ok("Disappear picked or Completed hidden: Resurrect still shows for today's ticks", () => {
  const all = [task("v-aaaaaaaa", { done: true, doneAt: "2026-11-10T08:00:00Z" })];
  assert.deepEqual(resurrectList(all, listPrefs({ tmTickMode: "vanish" }), NOW, TB).map((d) => d.id), ["v-aaaaaaaa"]);
  assert.deepEqual(resurrectList(all, listPrefs({ tmShowDone: false }), NOW, TB).map((d) => d.id), ["v-aaaaaaaa"]);
});
ok("nothing to bring back: no Resurrect", () => {
  assert.deepEqual(resurrectList([task("o-aaaaaaaa")], prefs, NOW, TB), []);
});
ok("Resurrect looks back today and yesterday at least, or the whole keep window", () => {
  assert.equal(resurrectSince("today", NOW, TB), at("2026-11-08T20:00:00Z"), "00:00 on 9 Nov in the developer's city");
  assert.equal(resurrectSince("7d", NOW, TB), keepSince("7d", NOW, TB));
  assert.equal(resurrectSince("30d", NOW, TB), keepSince("30d", NOW, TB));
  assert.equal(resurrectSince("today", NOW, TB, 4 * 60), at("2026-11-09T00:00:00Z"), "a 04:00 reset time moves the day start");
});
ok("Resurrect is drawn whenever there is something to bring back, not only inside Completed", () => {
  const c = src("views/Completed.tsx");
  assert.match(c, /\{back\.length > 0 && \(\s*<button type="button" className="tm-done-res"/);
  const m = src("views/TaskMap.tsx");
  // V1.55: each list has its own Completed, the same lists filtered to that list (core/lists.ts pageOfTask).
  assert.match(m, /<Completed list=\{mine\(done\)\} back=\{mine\(back\)\} open=\{openHere\}/);
  assert.doesNotMatch(m, /done\.length > 0 && <Completed/, "the section (and its row) no longer hides with an empty Completed");
});
ok("Resurrect of cleared tasks and its Undo travel from PS's Tab list, checked", () => {
  assert.deepEqual(cleanTodoOp({ op: "revive", ids: ["abcdefgh-1", "../x"] }), { op: "revive", ids: ["abcdefgh-1"] });
  assert.deepEqual(cleanTodoOp({ op: "bury", ids: ["abcdefgh-1", "abcdefgh-2"], cleared: ["abcdefgh-2", "zzzzzzzz-9"] }), { op: "bury", ids: ["abcdefgh-1", "abcdefgh-2"], cleared: ["abcdefgh-2"] });
  assert.equal(cleanTodoOp({ op: "revive", ids: [] }), null);
  const ps = src("ps.ts");
  assert.match(ps, /if \(o\.op === "revive"\) return reviveTodos\(o\.ids\);/);
  assert.match(ps, /if \(o\.op === "bury"\) return buryTodos\(o\.ids, o\.cleared\);/);
  const act = src("core/actions.ts");
  assert.match(act, /if \(d\.data\.clearedAt\) await put<Todo>\("todo", \{ \.\.\.d\.data, clearedAt: null \}, \{ id, ws: null \}\);\s*await setTodoDone\(id, false\);/);
  assert.match(act, /await setTodosDone\(ids, true\);\s*if \(cleared\.length\) await clearTodos\(cleared, true\);/);
  const c = src("views/Completed.tsx");
  assert.match(c, /sendRevive\(r, cleared\);\s*pushUndoAction\([^;]+\(\) => sendBury\(r, cleared\)\);/);
});

// ---------- Sleep moved to the bottom right (V1.47) ----------
ok("Sleep: bottom right of the Tab list and website (an Edit mode slot), the phone's thumb row, the end of the list only when the side is hidden", () => {
  const m = src("views/TaskMap.tsx");
  assert.match(m, /\{!GOS && <Slot id="sleep"><SleepRow where="side" \/><\/Slot>\}/);
  assert.ok(m.indexOf('<Slot id="sleep">') > m.indexOf('<Slot id="overdue">'), "last in the right column, so it sits at the bottom");
  assert.match(m, /extra=\{GOS \? null : <SleepRow where="end" \/>\}/);
  assert.match(src("core/tabLayout.ts"), /\{ id: "sleep", label: "Sleep" \}/);
  assert.match(src("gos/GosLayer.tsx"), /<SleepRow where="thumb" \/>\s*\{dnd\}/);
  const css = src("views/sleepmode.css");
  assert.match(css, /\.slp-end \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 760px\) \{ html:not\(\.gos\) \.tm-done-bar \.slp-end \{ display: block;/);
  assert.match(src("views/SleepMode.tsx"), /data-tip="Sleep mode"/);
});

ok("the Sleep note's close X: top left corner, shown on hover, always on touch screens", () => {
  const css = src("views/sleepmode.css");
  assert.match(css, /\.slp-note \.slp-x \{ position: absolute; left: calc\(-8px/);
  assert.match(css, /\.slp-note:hover \.slp-x, \.slp-note \.slp-x:focus-visible \{ opacity: 1;/);
  assert.match(css, /@media \(hover: none\) \{ \.slp-note \.slp-x \{ opacity: 1;/);
});

// ---------- Fitness menu button ----------
ok("Fitness: the top left menu button is a three line hamburger with the hover label Menu", () => {
  const nav = src("fitness/Nav.tsx");
  const btn = nav.slice(nav.indexOf("export function DonutButton"), nav.indexOf("export function DonutButton") + 1400);
  assert.equal((btn.match(/className="fit-burger-l /g) || []).length, 3);
  assert.doesNotMatch(btn, /<circle/);
  assert.match(btn, /data-tip=\{open \? "Close the menu" : "Menu"\}/);
  assert.match(src("fitness/nav.css"), /\.fit \.fit-donut \{ position: relative; flex: none; width: 48px; height: 48px;/, "same 48 px tap target");
});

// ---------- no dashes in the new words ----------
ok("no em or en dashes in the changed files", () => {
  for (const f of ["core/completed.ts", "views/Completed.tsx", "fitness/Nav.tsx", "fitness/nav.css", "views/taskmap.css"]) assert.doesNotMatch(src(f), /[\u2013\u2014]/, f);
});

console.log(`${n} checks passed`);
