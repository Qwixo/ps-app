// Run: node --experimental-strip-types tests/welcomeback.test.ts
// Welcome back on the Mac island (core/welcomeback.ts, PS 1.60): the setting, which tasks count as "working on", what Done may tick.
import { WELCOME_DEFAULT, WELCOME_MAX_TASKS, welcomeDoneIds, welcomeIsland, welcomePrefs, welcomeTasks } from "../src/core/welcomeback.ts";
import { PRIVATE_TITLE } from "../src/core/island.ts";

let fails = 0, n = 0;
const ok = (name: string, c: boolean) => { n++; if (!c) { fails++; console.log(`FAIL ${name}`); } };
const t = (id: string, x: Record<string, unknown> = {}) => ({ id, ws: null, kind: "todo", author: null, updatedAt: null, data: { title: "Task " + id, type: "once", done: false, order: 0, ...x } }) as never;

ok("defaults: on, 15 minutes", welcomePrefs(undefined).on === true && welcomePrefs(undefined).minutes === 15 && WELCOME_DEFAULT.minutes === 15);
ok("off only when set to false", welcomePrefs({ on: false }).on === false && welcomePrefs({ on: 0 }).on === true && welcomePrefs(null).on === true);
ok("minutes are kept between 1 and 720", welcomePrefs({ minutes: 0 }).minutes === 1 && welcomePrefs({ minutes: 99999 }).minutes === 720 && welcomePrefs({ minutes: 30 }).minutes === 30);
ok("minutes: text numbers work, junk is the default", welcomePrefs({ minutes: "45" }).minutes === 45 && welcomePrefs({ minutes: "soon" }).minutes === 15 && welcomePrefs({ minutes: NaN }).minutes === 15);
ok("minutes are rounded", welcomePrefs({ minutes: 20.6 }).minutes === 21);

const todos = [t("a"), t("b"), t("c", { done: true }), t("d", { clearedAt: "2026-11-14T10:00:00Z" }), t("e", { title: "  Spaced   out \n title " }), t("f"), t("g"), t("h"), t("i")];
ok("working tasks, in the order marked, only open ones", welcomeTasks(todos, { workingIds: ["b", "a"] }, false).map((x) => x.id).join() === "b,a");
ok("done, cleared and missing tasks are left out", welcomeTasks(todos, { workingIds: ["c", "d", "zzz", "a"] }, false).map((x) => x.id).join() === "a");
ok("nothing marked: no list", welcomeTasks(todos, {}, false).length === 0 && welcomeTasks(todos, { workingIds: [] }, false).length === 0);
ok("older builds' single workingOn counts", welcomeTasks(todos, { workingOn: "b" }, false).map((x) => x.id).join() === "b");
ok("a task listed twice shows once", welcomeTasks(todos, { workingIds: ["a", "a", "b"] }, false).length === 2);
ok("titles are cleaned", welcomeTasks(todos, { workingIds: ["e"] }, false)[0].title === "Spaced out title");
ok("an empty title is Untitled task", welcomeTasks([t("z", { title: "" })], { workingIds: ["z"] }, false)[0].title === "Untitled task");
ok("a long title is cut", welcomeTasks([t("z", { title: "x".repeat(500) })], { workingIds: ["z"] }, false)[0].title.length === 120);
ok("at most six", welcomeTasks(todos, { workingIds: ["a", "b", "e", "f", "g", "h", "i"] }, false).length === WELCOME_MAX_TASKS);
ok("private mode hides every name", welcomeTasks(todos, { workingIds: ["a", "b"] }, true).every((x) => x.title === PRIVATE_TITLE));

ok("the island is told the switch and the minutes", (() => { const w = welcomeIsland(todos, { workingIds: ["a"], welcomeBack: { minutes: 20 } }, false); return w.on && w.minutes === 20 && w.tasks.length === 1; })());
ok("switched off: no tasks are sent at all", (() => { const w = welcomeIsland(todos, { workingIds: ["a"], welcomeBack: { on: false } }, false); return !w.on && w.tasks.length === 0; })());

const map = new Map(todos.map((d: { id: string }) => [d.id, d]));
const told = welcomeTasks(todos, { workingIds: ["a", "b", "e"] }, false);
ok("Done ticks the ones picked (a JSON list)", welcomeDoneIds('["a","e"]', told, map as never).join() === "a,e");
ok("a task the island was never told about is ignored", welcomeDoneIds('["a","f"]', told, map as never).join() === "a");
ok("a task that was ticked meanwhile is ignored", welcomeDoneIds('["c"]', [{ id: "c", title: "x" }], map as never).length === 0);
ok("a task deleted meanwhile is ignored", welcomeDoneIds('["gone"]', [{ id: "gone", title: "x" }], map as never).length === 0);
ok("the same id twice ticks once", welcomeDoneIds('["a","a"]', told, map as never).length === 1);
ok("junk is ignored", welcomeDoneIds("not json", told, map as never).length === 0 && welcomeDoneIds('{"a":1}', told, map as never).length === 0 && welcomeDoneIds('[1,null,{}]', told, map as never).length === 0 && welcomeDoneIds(undefined, told, map as never).length === 0);
ok("an empty list ticks nothing", welcomeDoneIds("[]", told, map as never).length === 0);
ok("nothing was told: nothing can be ticked", welcomeDoneIds('["a"]', [], map as never).length === 0);

if (fails) { console.log(`${fails} of ${n} failed`); process.exit(1); }
console.log(`ok, ${n} checks`);
