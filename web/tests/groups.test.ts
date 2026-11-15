// Sections and task groups in the Tab list (core/groups.ts): order, membership and what a move saves.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accepts, cleanGroups, cleanSecOrder, dropAbovePrioIsP1, hitSection, mergeOrder, planMove, planUngroup, sectionOrder, tabLists } from "../src/core/groups.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const T = "2026-10-29";
const d = (id: string, order: number, x: Record<string, unknown> = {}) =>
  ({ id, ws: null, kind: "todo", author: null, updatedAt: null, data: { title: id, type: "once", done: false, order, ...x } }) as never;
const G = [{ id: "aaaa1", name: "Launch" }, { id: "bbbb2", name: "Admin" }];
const all = [
  d("p1a", 0, { p1: true }), d("p1b", 1, { p1: true }), d("x", 2), d("y", 3), d("z", 4, { unranked: true }),
  d("gym", 0, { type: "daily" }), d("read", 1, { type: "daily" }),
  d("g1", 0, { group: "aaaa1" }), d("g2", 1, { group: "aaaa1" }), d("gd", 2, { group: "aaaa1", type: "daily" }),
  d("gone", 0, { group: "zzzz9" }), d("done", 9, { group: "aaaa1", done: true }),
];
const L = () => tabLists(all, G, T);
const ids = (l: { id: string }[]) => l.map((x) => x.id);
const patches = (out: { id: string; patch: Record<string, unknown> }[]) => Object.fromEntries(out.map((w) => [w.id, w.patch]));

ok("each task shows in one section; a missing group sends its task back", () => {
  const l = L();
  assert.deepEqual(ids(l.p1), ["p1a", "p1b"]);
  assert.deepEqual(ids(l.prio), ["gone", "x", "y", "z"]);
  assert.deepEqual(ids(l.daily), ["gym", "read"]);
  assert.deepEqual(ids(l.groups.get("aaaa1")!), ["g1", "g2", "gd"], "ticked one-off tasks leave the group");
  assert.deepEqual(ids(l.groups.get("bbbb2")!), [], "an empty group still shows");
});
ok("section order: old saves keep their place, P1 sits above Priorities, new groups go last", () => {
  assert.deepEqual(sectionOrder(undefined, false, G), ["p1", "prio", "daily", "g:aaaa1", "g:bbbb2"]);
  assert.deepEqual(sectionOrder(undefined, true, []), ["daily", "p1", "prio"]);
  assert.deepEqual(sectionOrder(["g:bbbb2", "daily", "prio", "p1"], false, G), ["g:bbbb2", "daily", "prio", "p1", "g:aaaa1"]);
  assert.deepEqual(sectionOrder(["daily", "prio", "g:dead1"], false, G), ["daily", "p1", "prio", "g:aaaa1", "g:bbbb2"], "a deleted group drops out");
});
ok("dragging the shown sections keeps hidden ones in their slot", () => {
  assert.deepEqual(mergeOrder(["p1", "prio", "daily", "g:aaaa1"], ["daily", "g:aaaa1", "prio"]), ["p1", "daily", "g:aaaa1", "prio"]);
});
ok("groups take anything; Every day only repeating tasks; Priorities only one-off ones", () => {
  assert.equal(accepts("g:aaaa1", ["once", "daily"]), true);
  assert.equal(accepts("daily", ["once"]), false);
  assert.equal(accepts("p1", ["daily"]), false);
  assert.equal(accepts("prio", ["once", "once"]), true);
});
ok("Cmd-selected tasks dragged into a group land where dropped, in their order", () => {
  const p = patches(planMove(L(), { ids: ["x", "gym"], to: "g:aaaa1", index: 1 }));
  assert.deepEqual(p.x, { order: 1, group: "aaaa1" });
  assert.deepEqual(p.gym, { order: 2, group: "aaaa1" });
  assert.deepEqual(p.g2, { order: 3 });
  assert.deepEqual(p.gd, { order: 4 });
  assert.equal(p.g1, undefined, "nothing above the drop changes");
});
ok("into Priority 1 sets P1 and keeps one order with Priorities", () => {
  const p = patches(planMove(L(), { ids: ["g2"], to: "p1", index: 1 }));
  assert.deepEqual(p.g2, { group: null, p1: true });   // order 1 already
  assert.deepEqual(p.p1b, { order: 2 });
  assert.deepEqual(p.gone, { order: 3 });
});
ok("out of a group into Priorities: no group, no P1, a priority unless dropped below an unranked task", () => {
  const top = patches(planMove(L(), { ids: ["g1"], to: "prio", index: 0 }));
  assert.deepEqual(top.g1, { order: 2, group: null });
  const low = patches(planMove(L(), { ids: ["g1"], to: "prio", index: 4 }));
  assert.equal(low.g1.unranked, true);
});
ok("a P1 task dragged to Priorities drops P1", () => {
  const p = patches(planMove(L(), { ids: ["p1a"], to: "prio", index: 0 }));
  assert.equal(p.p1a.p1, false);
});
ok("moving within the same section counts the moved rows where they were", () => {
  const p = patches(planMove(L(), { ids: ["g1"], to: "g:aaaa1", index: 3 }));
  assert.deepEqual(p.g1, { order: 2 });
  assert.deepEqual(p.g2, { order: 0 });
  assert.deepEqual(p.gd, { order: 1 });
});
ok("with no Priority 1 group, the very top of Priorities starts one", () => {
  const none = tabLists(all.filter((x: { data: { p1?: boolean } }) => !x.data.p1), G, T);
  assert.deepEqual(patches(planMove(none, { ids: ["g1"], to: "prio", index: 0 })).g1, { group: null, p1: true });
  assert.equal(patches(planMove(none, { ids: ["g1"], to: "prio", index: 1 })).g1.p1, undefined);
});
ok("a move nobody can make saves nothing", () => {
  assert.deepEqual(planMove(L(), { ids: ["x"], to: "daily", index: 0 }), []);
  assert.deepEqual(planMove(L(), { ids: ["x"], to: "g:nope1", index: 0 }), []);
  assert.deepEqual(planMove(L(), { ids: ["nobody"], to: "prio", index: 0 }), []);
});
ok("taking a group apart sends tasks back to the end of their old sections", () => {
  const p = patches(planUngroup(L(), "aaaa1"));
  assert.deepEqual(p.g1, { group: null, order: 5, p1: false, unranked: false });
  assert.deepEqual(p.g2, { group: null, order: 6, p1: false, unranked: false });
  assert.deepEqual(p.gd, { group: null, order: 2 });
});
ok("only clean groups and section keys are saved", () => {
  assert.deepEqual(cleanGroups([{ id: "aaaa1", name: "  Big   launch " }, { id: "aaaa1", name: "dup" }, { id: "BAD!", name: "x" }, { id: "cccc3", name: "" }, "junk"]),
    [{ id: "aaaa1", name: "Big launch" }, { id: "cccc3", name: "Group" }]);
  assert.deepEqual(cleanSecOrder(["p1", "p1", "g:aaaa1", "evil", 3, "daily"]), ["p1", "g:aaaa1", "daily"]);
});
// ---------- dragging a task onto Priority 1 (the developer's friend, 15 Nov 2026) ----------
ok("a Priorities task let go on Priority 1 becomes Priority 1, at the spot, whatever its place", () => {
  for (const index of [0, 1, 2]) {
    const p = patches(planMove(L(), { ids: ["y"], to: "p1", index }));
    assert.equal(p.y.p1, true, `index ${index}`);
  }
  const mid = patches(planMove(L(), { ids: ["y"], to: "p1", index: 1 }));
  assert.equal(mid.y.order, 1);
  assert.equal(mid.p1b.order, 2, "the P1 task below makes room");
});
ok("a task with no priority yet dropped on Priority 1 becomes Priority 1 and ranked", () => {
  const p = patches(planMove(L(), { ids: ["z"], to: "p1", index: 2 }));
  assert.equal(p.z.p1, true);
  assert.equal(p.z.unranked, false);
});
ok("several picked tasks dropped on Priority 1 all become Priority 1, in the order picked", () => {
  const out = planMove(L(), { ids: ["x", "y"], to: "p1", index: 0 });
  const p = patches(out);
  assert.equal(p.x.p1, true); assert.equal(p.y.p1, true);
  assert.equal(p.x.order, 0); assert.equal(p.y.order, 1);
});
ok("a task from a group dropped on Priority 1 leaves the group and is Priority 1", () => {
  assert.deepEqual({ g: patches(planMove(L(), { ids: ["g1"], to: "p1", index: 0 })).g1.group, p: patches(planMove(L(), { ids: ["g1"], to: "p1", index: 0 })).g1.p1 }, { g: null, p: true });
});
ok("Priority 1 back into Priorities clears the flag; Every day tasks are refused by Priority 1", () => {
  assert.equal(patches(planMove(L(), { ids: ["p1a"], to: "prio", index: 2 })).p1a.p1, false);
  assert.deepEqual(planMove(L(), { ids: ["gym"], to: "p1", index: 0 }), []);
  assert.deepEqual(planMove(L(), { ids: ["x", "gym"], to: "p1", index: 0 }), [], "one daily in the bundle refuses it all");
});
ok("a task dropped on its own Priority 1 group stays Priority 1 and only reorders", () => {
  const p = patches(planMove(L(), { ids: ["p1b"], to: "p1", index: 0 }));
  assert.equal(p.p1b.p1, undefined);
  assert.equal(p.p1b.order, 0); assert.equal(p.p1a.order, 1);
});

const box = (key: string, top: number, bottom: number, left = 100, right = 500) => ({ key, left, top, right, bottom });
const BOXES = [box("p1", 100, 260), box("prio", 290, 800), box("daily", 830, 1000)];
ok("hitSection finds the section under the pointer, with 40 px of room either side, and none in the gap", () => {
  assert.equal(hitSection(BOXES, 300, 150), "p1");
  assert.equal(hitSection(BOXES, 300, 120), "p1", "its header");
  assert.equal(hitSection(BOXES, 300, 500), "prio");
  assert.equal(hitSection(BOXES, 70, 500), "prio", "40 px left of the box");
  assert.equal(hitSection(BOXES, 50, 500), null);
  assert.equal(hitSection(BOXES, 300, 275), null, "the gap between sections");
  assert.equal(hitSection([], 300, 150), null);
});
ok("a Priorities task let go in the gap above Priorities is Priority 1 only while a Priority 1 group is there", () => {
  const prio = BOXES[1], p1 = BOXES[0];
  assert.equal(dropAbovePrioIsP1(2, prio, p1, 300, 275), true);
  assert.equal(dropAbovePrioIsP1(0, prio, p1, 300, 275), false, "no group yet: the old rule (the top starts one) stays");
  assert.equal(dropAbovePrioIsP1(2, prio, p1, 300, 400), false, "inside Priorities");
  assert.equal(dropAbovePrioIsP1(2, prio, p1, 700, 275), false, "far to the side");
  assert.equal(dropAbovePrioIsP1(2, prio, null, 300, 275), false);
  assert.equal(dropAbovePrioIsP1(2, prio, box("p1", 900, 960), 300, 275), false, "Priority 1 drawn below Priorities");
});
ok("TaskMap finds sections on the shown list page, not only as direct children of the list box", () => {
  const src = readFileSync(new URL("../src/views/TaskMap.tsx", import.meta.url), "utf8");
  assert.ok(!/\.tm-inner > \.tm-sec/.test(src), "a section sits inside .tl-page (V1.55), so the direct child selector finds none");
  assert.ok(/sectionOnShownPage/.test(src) && /tl-near/.test(src), "pages beside the shown one are left out");
});
console.log(`\n${n} passed`);
