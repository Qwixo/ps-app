// The NEW badge (core/newbadge.ts, V1.33): the "is it new" rule, the one timer's next moment, the settings
// defaults and limits, a badge clicked away, and the pruning that keeps newGone tiny.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NEW_MIN_DEFAULT, NEW_MIN_HIGH, NEW_MIN_LOW, clampNewMin, cleanNewLooks, createdMs, dismissPatch, isNewTask, newPrefs, newUntil,
  nextNewExpiry, pruneGone,
} from "../src/core/newbadge.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const MIN = 60_000;
const T0 = Date.parse("2026-11-04T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const task = (createdAt?: string, done = false) => ({ createdAt, done });
const on = newPrefs({});

ok("defaults: on, 30 minutes, nothing dismissed", () => {
  assert.deepEqual(newPrefs(undefined), { on: true, min: 30, gone: {} });
  assert.deepEqual(newPrefs({ newBadges: false }), { on: false, min: 30, gone: {} });
  assert.equal(NEW_MIN_DEFAULT, 30);
});

ok("the minutes stay inside 5 to 240, whole minutes", () => {
  assert.equal(clampNewMin(1), NEW_MIN_LOW);
  assert.equal(clampNewMin(999), NEW_MIN_HIGH);
  assert.equal(clampNewMin(44.6), 45);
  assert.equal(clampNewMin("abc"), 30);
  assert.equal(clampNewMin(NaN), 30);
  assert.equal(newPrefs({ newBadgeMin: 0 }).min, 5);
});

ok("new for exactly the window after it was made, then not", () => {
  const t = task(iso(T0));
  assert.equal(isNewTask(t, "a", T0, on), true);
  assert.equal(isNewTask(t, "a", T0 + 29 * MIN, on), true);
  assert.equal(isNewTask(t, "a", T0 + 30 * MIN - 1, on), true);
  assert.equal(isNewTask(t, "a", T0 + 30 * MIN, on), false);
  assert.equal(newUntil(t, "a", T0 + MIN, on), T0 + 30 * MIN);
});

ok("the minutes setting changes the window", () => {
  const p = newPrefs({ newBadgeMin: 5 });
  assert.equal(isNewTask(task(iso(T0)), "a", T0 + 4 * MIN, p), true);
  assert.equal(isNewTask(task(iso(T0)), "a", T0 + 6 * MIN, p), false);
  assert.equal(isNewTask(task(iso(T0)), "a", T0 + 200 * MIN, newPrefs({ newBadgeMin: 240 })), true);
});

ok("old tasks with no created time, or an unreadable one, are never new", () => {
  assert.equal(isNewTask(task(undefined), "a", T0, on), false);
  assert.equal(isNewTask(task("not a date"), "a", T0, on), false);
  assert.equal(createdMs({ createdAt: "" }), null);
});

ok("never on a ticked or cleared task, never when switched off", () => {
  assert.equal(isNewTask(task(iso(T0), true), "a", T0 + MIN, on), false);
  assert.equal(isNewTask({ ...task(iso(T0)), clearedAt: iso(T0) }, "a", T0 + MIN, on), false);
  assert.equal(isNewTask(task(iso(T0)), "a", T0 + MIN, newPrefs({ newBadges: false })), false);
});

ok("a badge clicked away stays away for that task only", () => {
  const p = newPrefs({ newGone: { a: Math.floor(T0 / 1000) } });
  assert.equal(isNewTask(task(iso(T0)), "a", T0 + MIN, p), false);
  assert.equal(isNewTask(task(iso(T0)), "b", T0 + MIN, p), true);
});

ok("a task made on a device with its clock ahead still shows, from its own created time", () => {
  assert.equal(isNewTask(task(iso(T0 + 2 * MIN)), "a", T0, on), true);
  assert.equal(newUntil(task(iso(T0 + 2 * MIN)), "a", T0, on), T0 + 32 * MIN);
});

ok("one timer: the soonest badge to run out, none when nothing is new", () => {
  const list = [
    { id: "old", data: task(iso(T0 - 60 * MIN)) },
    { id: "a", data: task(iso(T0 - 10 * MIN)) },
    { id: "b", data: task(iso(T0 - 25 * MIN)) },
    { id: "gone", data: task(iso(T0 - 29 * MIN)) },
    { id: "done", data: task(iso(T0 - 28 * MIN), true) },
    { id: "none", data: task(undefined) },
  ];
  const p = newPrefs({ newGone: { gone: Math.floor((T0 - 29 * MIN) / 1000) } });
  assert.equal(nextNewExpiry(list, T0, p), T0 + 5 * MIN);   // b, made 25 minutes ago
  assert.equal(nextNewExpiry(list, T0 + 6 * MIN, p), T0 + 20 * MIN);   // then a
  assert.equal(nextNewExpiry(list, T0 + 21 * MIN, p), null);
  assert.equal(nextNewExpiry(list, T0, newPrefs({ newBadges: false })), null);
});

ok("pruning keeps only dismissals still inside the longest window (240 minutes)", () => {
  const sec = (ms: number) => Math.floor(ms / 1000);
  const gone = { fresh: sec(T0 - 10 * MIN), edge: sec(T0 - 239 * MIN), stale: sec(T0 - 241 * MIN), bad: Number.NaN, text: "x" as unknown as number };
  assert.deepEqual(pruneGone(gone, T0), { fresh: sec(T0 - 10 * MIN), edge: sec(T0 - 239 * MIN) });
  assert.deepEqual(pruneGone({}, T0), {});
});

ok("a click: adds the task with its created time and drops the stale ones in the same write", () => {
  const sec = (ms: number) => Math.floor(ms / 1000);
  const patch = dismissPatch({ stale: sec(T0 - 300 * MIN), keep: sec(T0 - 5 * MIN) }, "a", { createdAt: iso(T0 - 2 * MIN) }, T0);
  assert.deepEqual(patch, { newGone: { keep: sec(T0 - 5 * MIN), a: sec(T0 - 2 * MIN) } });
});

ok("a pruned task cannot come back even when the minutes are raised to the most", () => {
  const made = T0 - 241 * MIN;
  const p = newPrefs({ newBadgeMin: NEW_MIN_HIGH, newGone: pruneGone({ a: Math.floor(made / 1000) }, T0) });
  assert.equal(isNewTask(task(iso(made)), "a", T0, p), false);
});

ok("the looks patch: on, minutes, a click checked against the newest settings; unknown keys and tasks ignored", () => {
  const cur = { newGone: { b: Math.floor(T0 / 1000) - 60 } };
  const created = (id: string) => (id === "a" ? iso(T0 - MIN) : id === "old" ? null : undefined);
  assert.deepEqual(cleanNewLooks({ newBadges: false, newBadgeMin: 1000, tmTheme: "light" }, cur, created, T0), { newBadges: false, newBadgeMin: 240 });
  assert.deepEqual(cleanNewLooks({ newBadges: "yes", newBadgeMin: "30" }, cur, created, T0), {});
  assert.deepEqual(cleanNewLooks({ newGoneId: "a" }, cur, created, T0), { newGone: { b: Math.floor(T0 / 1000) - 60, a: Math.floor((T0 - MIN) / 1000) } });
  assert.deepEqual(cleanNewLooks({ newGoneId: "missing" }, cur, created, T0), {});
  assert.deepEqual(cleanNewLooks({ newGoneId: "../x" }, cur, created, T0), {});
  assert.ok("old" in (cleanNewLooks({ newGoneId: "old" }, cur, created, T0).newGone ?? {}));
});

ok("wired in: cleanLooks takes the badge patch, the row draws the badge, the settings show it", () => {
  assert.match(readFileSync("src/ps.ts", "utf8"), /Object\.assign\(o, newLooks\(p\)\)/);
  const tm = readFileSync("src/views/TaskMap.tsx", "utf8");
  assert.match(tm, /<NewBadge d=\{d\} \/>/);
  // V1.43: one row in Settings, Your list (views/SettingsGroups.tsx), on the Mac, the website and the phone alike.
  assert.equal(readFileSync("src/views/SettingsGroups.tsx", "utf8").match(/<NewBadgeControls \/>/g)?.length, 1);
  assert.match(readFileSync("src/core/settingsindex.ts", "utf8"), /id: "new-badge", group: "list"/);
  // The badge never starts a drag, a press or a phone hold: it is a no-drag control and stops the press.
  const b = readFileSync("src/views/NewBadge.tsx", "utf8");
  assert.match(b, /className="tm-new no-drag"/);
  assert.match(b, /onPointerDown=\{stop\}/);
});

ok("no em or en dashes", () => {
  for (const f of ["src/core/newbadge.ts", "src/newbadge.ts", "src/views/NewBadge.tsx", "src/views/newbadge.css", "tests/newbadge.test.ts"])
    assert.doesNotMatch(readFileSync(f, "utf8"), /[\u2013\u2014]/, f);
});

console.log(`\n${n} passed`);
