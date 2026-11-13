// Several to-do lists as pages (core/lists.ts, V1.55): the page model, moving tasks, renames, and the rule that keeps
// a page swipe, a row swipe and a scroll apart.
import assert from "node:assert/strict";
import {
  MAIN, PAGES_MAX, PLUS_LEFT, PLUS_RIGHT, addGroupFor, cleanPagesLooks, fingerDx, isPlus, movePage, pageOrder, pagerIds, placeAt, addPage, allPages, cleanNames, cleanPages, cleanSwipeDir, listMoveTarget, moveSec, pageDx,
  pageGesture, pageOfSec, pageOfTask, pageOffset, prunePages, removePage, renamePage, secsByPage, settleIndex, shownName,
  springDone, springStart, springStep, stepIndex,
} from "../src/core/lists.ts";
import { sectionOrder, tabLists } from "../src/core/groups.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const T = "2026-11-12";
const d = (id: string, order: number, x: Record<string, unknown> = {}) =>
  ({ id, ws: null, kind: "todo", author: null, updatedAt: null, data: { title: id, type: "once", done: false, order, ...x } }) as never;
const G = [{ id: "aaaa1", name: "Launch" }, { id: "bbbb2", name: "Errands" }];
const known = new Set(G.map((g) => g.id));
const all = [
  d("p1a", 0, { p1: true }), d("x", 1), d("y", 2),
  d("gym", 0, { type: "daily" }), d("read", 1, { type: "daily" }),
  d("g1", 0, { group: "aaaa1" }), d("e1", 0, { group: "bbbb2" }),
];
const L = () => tabLists(all, G, T);
// The developer's example: the main list on the left, Every day on its own page to the right.
const STREAKS = { id: "strk1", name: "Every day", secs: ["daily"] };

ok("no extra lists: everything is on the main list, as before", () => {
  const full = sectionOrder(undefined, false, G);
  const by = secsByPage(full, []);
  assert.deepEqual(by.get(MAIN), ["p1", "prio", "daily", "g:aaaa1", "g:bbbb2"]);
  assert.deepEqual(allPages([], {}), [{ id: MAIN, name: "Main list" }]);
});
ok("The developer's example in one step: Every day moved to a new list sits to the right, the rest stays", () => {
  const pages = addPage([], STREAKS);
  const by = secsByPage(sectionOrder(undefined, false, G), pages);
  assert.deepEqual(by.get(MAIN), ["p1", "prio", "g:aaaa1", "g:bbbb2"]);
  assert.deepEqual(by.get("strk1"), ["daily"]);
  assert.deepEqual(allPages(pages).map((p) => p.name), ["Main list", "Every day"]);
});
ok("a section is on one list only; moving it takes it off the other", () => {
  let pages = addPage([], STREAKS);
  pages = addPage(pages, { id: "work1", name: "Work", secs: ["g:aaaa1", "daily"] });
  assert.deepEqual(pages.find((p) => p.id === "strk1")!.secs, [], "Every day left Streaks for Work");
  assert.equal(pageOfSec(pages, "daily"), "work1");
  pages = moveSec(pages, "daily", MAIN);
  assert.equal(pageOfSec(pages, "daily"), MAIN, "moved back to the main list");
  pages = moveSec(pages, "g:bbbb2", "strk1");
  assert.deepEqual(pages.find((p) => p.id === "strk1")!.secs, ["g:bbbb2"]);
});
ok("a new list goes after the one it was made from, or at the end", () => {
  let pages = addPage([], { id: "aaaa", name: "A", secs: [] });
  pages = addPage(pages, { id: "bbbb", name: "B", secs: [] });
  pages = addPage(pages, { id: "cccc", name: "C", secs: [] }, "aaaa");
  assert.deepEqual(pages.map((p) => p.id), ["aaaa", "cccc", "bbbb"]);
  pages = addPage(pages, { id: "dddd", name: "D", secs: [] }, MAIN);
  assert.deepEqual(pages.map((p) => p.id), ["dddd", "aaaa", "cccc", "bbbb"]);
  let many = [] as ReturnType<typeof addPage>;
  for (let i = 0; i < PAGES_MAX + 3; i++) many = addPage(many, { id: `pg${String(i).padStart(3, "0")}`, name: "x", secs: [] });
  assert.equal(many.length, PAGES_MAX, "never more than the cap");
});
ok("each task shows on the page of its section", () => {
  const pages = addPage(addPage([], STREAKS), { id: "lnch1", name: "Launch", secs: ["g:aaaa1"] });
  assert.equal(pageOfTask({ type: "daily" }, known, pages), "strk1");
  assert.equal(pageOfTask({ type: "once" }, known, pages), MAIN);
  assert.equal(pageOfTask({ type: "once", p1: true }, known, pages), MAIN);
  assert.equal(pageOfTask({ type: "once", group: "aaaa1" }, known, pages), "lnch1");
  assert.equal(pageOfTask({ type: "daily", group: "aaaa1" }, known, pages), "lnch1", "a group wins over Every day");
  assert.equal(pageOfTask({ type: "once", group: "gone9" }, known, pages), MAIN, "a group that is gone: back to Priorities");
});
ok("a deleted list sends its sections home; nothing is lost", () => {
  const pages = removePage(addPage([], STREAKS), "strk1");
  assert.deepEqual(pages, []);
  assert.equal(pageOfSec(pages, "daily"), MAIN);
  assert.deepEqual(prunePages([{ id: "lnch1", name: "L", secs: ["g:aaaa1", "g:dead9", "daily"] }], known)[0].secs, ["g:aaaa1", "daily"]);
});
ok("saved lists are checked: bad ids, the main id, repeats and a section on two lists are dropped", () => {
  const c = cleanPages([
    { id: "good1", name: "  Gym   stuff ", secs: ["daily", "daily", "bad key", "g:aaaa1"] },
    { id: "main", name: "x", secs: [] }, { id: "BAD!", name: "x", secs: [] }, { id: "good1", name: "again", secs: [] },
    { id: "good2", name: "", secs: ["daily", "prio"] }, null, "x",
  ]);
  assert.deepEqual(c, [{ id: "good1", name: "Gym stuff", secs: ["daily", "g:aaaa1"] }, { id: "good2", name: "List", secs: ["prio"] }]);
  assert.deepEqual(cleanPages("nope"), []);
});
ok("renames: lists and the built-in sections; blank keeps the old name; defaults as before", () => {
  const pages = renamePage(addPage([], STREAKS), "strk1", "  Streaks ");
  assert.equal(pages[0].name, "Streaks");
  assert.equal(renamePage(pages, "strk1", "   ")[0].name, "Streaks", "blank: unchanged");
  const names = cleanNames({ prio: " Today's three ", main: "Work", done: "", p1: 5, other: "x" });
  assert.deepEqual(names, { main: "Work", prio: "Today's three" });
  assert.equal(shownName(names, "prio"), "Today's three");
  assert.equal(shownName({}, "prio"), "Priorities");
  assert.equal(shownName({}, "p1"), "Priority 1");
  assert.equal(shownName({}, "daily", true), "Every day");
  assert.equal(shownName({}, "daily", false), "Repeating", "as before when some repeat less often");
  assert.equal(shownName({ daily: "Streaks" }, "daily", false), "Streaks", "The developer's own name wins");
  assert.equal(shownName(undefined, "done"), "Completed");
  assert.equal(allPages([], names)[0].name, "Work");
});
ok("Move to list: the first section there that takes the task, at its end", () => {
  const l = L();
  assert.deepEqual(listMoveTarget(l, ["daily"], ["daily"]), { to: "daily", index: 2 });
  assert.equal(listMoveTarget(l, ["daily"], ["once"]), null, "Every day takes no one-off task: a group is made");
  assert.deepEqual(listMoveTarget(l, ["daily", "g:bbbb2"], ["once"]), { to: "g:bbbb2", index: 1 });
  assert.deepEqual(listMoveTarget(l, ["p1", "prio", "g:aaaa1"], ["once"]), { to: "prio", index: 2 }, "never Priority 1 by a move");
  assert.deepEqual(listMoveTarget(l, ["p1", "g:aaaa1"], ["once"]), { to: "p1", index: 1 }, "only Priority 1 there");
  assert.deepEqual(listMoveTarget(l, ["prio", "g:aaaa1"], ["once", "daily"]), { to: "g:aaaa1", index: 1 }, "mixed: only a group takes both");
  assert.equal(listMoveTarget(l, [], ["once"]), null);
});
ok("a task typed on a list joins that list's group only when it would not show there anyway", () => {
  assert.equal(addGroupFor(["daily", "g:aaaa1"], "daily", known), null, "Every day is here");
  assert.equal(addGroupFor(["daily", "g:aaaa1"], "once", known), "aaaa1");
  assert.equal(addGroupFor(["p1", "prio"], "once", known), null);
  assert.equal(addGroupFor(["g:dead9"], "once", known), null, "no group of its own: it goes where it always went");
});
ok("gesture rule: sideways anywhere on the list (rows too, the V1.34 row swipe is gone) is a page swipe", () => {
  assert.equal(pageGesture("list", 4, 0), null, "too small to tell");
  assert.equal(pageGesture("list", 12, 2), "page");
  assert.equal(pageGesture("list", -30, 10), "page");
});
ok("gesture rule: up or down first is a scroll, also on the empty space, and the tail of a scroll never pages", () => {
  assert.equal(pageGesture("list", 2, 6), "scroll");
  assert.equal(pageGesture("list", 14, 12), "scroll", "diagonal stays a scroll");
  assert.equal(pageGesture("list", 40, 2, 100), "scroll", "sideways just after a scroll");
  assert.equal(pageGesture("list", 40, 2, 400), "page");
  assert.equal(pageGesture("other", 40, 0), "none", "the side panels");
  // Up or down first never pages, however far it then goes sideways (the owner is kept for the whole gesture).
  for (const [dx, dy] of [[3, 8], [14, 12], [5, 20], [-9, 9], [0, 4], [-12, 16]]) assert.equal(pageGesture("list", dx, dy), "scroll", `${dx},${dy}`);
});
ok("trackpad: fingers right is a swipe right, with natural scrolling or without (from the old core/swipe.ts)", () => {
  assert.equal(fingerDx(-12, true), 12);
  assert.equal(fingerDx(-12, undefined), 12, "not told: the Mac default, natural");
  assert.equal(fingerDx(12, false), 12);
});
ok("swipe direction: push (the developer's words) goes right for fingers right; drag follows the fingers", () => {
  assert.equal(pageDx(30, "push"), -30, "pages move left: the list on the right comes in");
  assert.equal(pageDx(30, "drag"), 30);
  assert.equal(cleanSwipeDir("drag"), "drag");
  assert.equal(cleanSwipeDir("x"), "push");
});
ok("the slide follows one to one, stretches like rubber past the ends, and never moves with one page", () => {
  assert.equal(pageOffset(-120, 600, 0, 3), -120);
  assert.equal(pageOffset(-900, 600, 0, 3), -600, "never more than one page at a time");
  const rub = pageOffset(200, 600, 0, 3);
  assert.ok(rub > 0 && rub < 100, `rubber at the first page: ${rub}`);
  assert.ok(pageOffset(-200, 600, 2, 3) < 0 && pageOffset(-200, 600, 2, 3) > -100, "rubber at the last page");
  assert.equal(pageOffset(-200, 600, 0, 1), 0);
});
ok("letting go: a third of the way or a flick goes one page; short of it springs back", () => {
  assert.equal(settleIndex(0, 3, -250, 0, 600), 1);
  assert.equal(settleIndex(1, 3, 250, 0, 600), 0);
  assert.equal(settleIndex(0, 3, -100, 0, 600), 0, "short: back");
  assert.equal(settleIndex(0, 3, -60, -0.8, 600), 1, "a flick");
  assert.equal(settleIndex(0, 3, -60, 0.8, 600), 0, "flicked back the other way");
  assert.equal(settleIndex(0, 3, 400, 0, 600), 0, "nothing left of the first page");
  assert.equal(settleIndex(2, 3, -400, 0, 600), 2, "nothing right of the last");
  assert.equal(stepIndex(0, 3, -1), 0);
  assert.equal(stepIndex(1, 3, 1), 2);
});
ok("the spring lands on its page quickly, with a soft settle and no jump on a slow frame", () => {
  let x = 0, v = 0, t = 0, max = 0;
  while (!springDone(x, v, -600) && t < 2) { ({ x, v } = springStep(x, v, -600, 1 / 60)); t += 1 / 60; max = Math.min(max, x); }
  assert.ok(t < 0.6, `settled in ${t.toFixed(2)} s`);
  assert.ok(max > -610, `overshoot under 10 px: ${max.toFixed(1)}`);
  // A hard flick let go 112 px short (the headless frame strip once overshot 100 px before the cap): a few px at most.
  x = -640; v = springStart(-1.6, -752 - x); t = 0; let past = 0;
  while (!springDone(x, v, -752) && t < 2) { ({ x, v } = springStep(x, v, -752, 1 / 60)); t += 1 / 60; past = Math.max(past, -752 - x); }
  assert.ok(past < 6, `a flick overshoots under 6 px: ${past.toFixed(1)}`);
  assert.ok(t < 0.5, `and lands in ${t.toFixed(2)} s`);
  assert.equal(springStart(1, 0), 250, "already home: a small push at most");
  const slow = springStep(0, 0, -600, 0.5);
  assert.ok(slow.x > -600 && slow.x < 0, "a long frame is cut to a short one");
});
ok("what PS's main window saves from the Tab list window: only well formed lists, names and direction", () => {
  assert.deepEqual(cleanPagesLooks({ tmPages: [{ id: "strk1", name: "Streaks", secs: ["daily"] }, { id: "main" }], tmNames: { prio: "Today" }, tmSwipeDir: "drag" }),
    { tmPages: [{ id: "strk1", name: "Streaks", secs: ["daily"] }], tmNames: { prio: "Today" }, tmSwipeDir: "drag" });
  assert.deepEqual(cleanPagesLooks({ tmSwipeDir: "sideways", tmPages: "x" }), {}, "nothing it does not know");
  assert.deepEqual(cleanPagesLooks({ tmNames: {} }), { tmNames: {} }, "all names back to the usual ones");
});
ok("pages on both sides of home: the saved order, each page once, missing ones on the right", () => {
  const P = [{ id: "left1", name: "Sleep", secs: [] }, { id: "rite1", name: "Streaks", secs: [] }, { id: "rite2", name: "Work", secs: [] }];
  assert.deepEqual(pageOrder(undefined, P), [MAIN, "left1", "rite1", "rite2"], "an old vault: the main list first");
  assert.deepEqual(pageOrder(["left1", MAIN, "rite1"], P), ["left1", MAIN, "rite1", "rite2"]);
  assert.deepEqual(pageOrder(["gone9", "rite2", "rite2", "left1"], P), [MAIN, "rite2", "left1", "rite1"], "unknown and repeats dropped, home put back");
  assert.deepEqual(allPages(P, { main: "Home" }, ["left1", MAIN, "rite1", "rite2"]).map((p) => p.name), ["Sleep", "Home", "Streaks", "Work"]);
});
ok("an empty + page past each end, while there is room for another list", () => {
  assert.deepEqual(pagerIds([MAIN], []), [PLUS_LEFT, MAIN, PLUS_RIGHT]);
  assert.deepEqual(pagerIds(["a1b2", MAIN], [{ id: "a1b2", name: "x", secs: [] }]), [PLUS_LEFT, "a1b2", MAIN, PLUS_RIGHT]);
  const full = Array.from({ length: PAGES_MAX }, (_, i) => ({ id: `pg${String(i).padStart(3, "0")}`, name: "x", secs: [] }));
  assert.equal(pagerIds([MAIN, ...full.map((p) => p.id)], full).some(isPlus), false, "full: no + pages");
  assert.ok(isPlus(PLUS_LEFT) && isPlus(PLUS_RIGHT) && !isPlus(MAIN));
});
ok("a new list goes where its + page was; pages move one place left or right", () => {
  assert.deepEqual(placeAt([MAIN, "aaaa"], "left1", 0), ["left1", MAIN, "aaaa"], "the + on the left");
  assert.deepEqual(placeAt([MAIN, "aaaa"], "rite9", 2), [MAIN, "aaaa", "rite9"], "the + on the right");
  assert.deepEqual(movePage(["left1", MAIN, "aaaa"], MAIN, -1), [MAIN, "left1", "aaaa"], "home moves too");
  assert.deepEqual(movePage(["left1", MAIN, "aaaa"], "aaaa", 1), ["left1", MAIN, "aaaa"], "already last");
  assert.deepEqual(movePage(["left1", MAIN], "nope", 1), ["left1", MAIN]);
});
ok("each page keeps its own background and look; bad ones are dropped", () => {
  const c = cleanPages([{ id: "rite1", name: "Streaks", secs: [], bg: "storm-forked", look: "legal" }, { id: "rite2", name: "x", secs: [], bg: "<script>", look: 5 }]);
  assert.deepEqual(c[0], { id: "rite1", name: "Streaks", secs: [], bg: "storm-forked", look: "legal" });
  assert.deepEqual(c[1], { id: "rite2", name: "x", secs: [] });
  assert.deepEqual(cleanPagesLooks({ tmPageOrder: ["rite1", "main", "BAD!", "rite1"] }), { tmPageOrder: ["rite1", "main"] });
});
console.log(`${n} of ${n} ok`);
