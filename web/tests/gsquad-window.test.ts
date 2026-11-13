// Run: node --experimental-strip-types tests/gsquad-window.test.ts
// V1.43 G Squad window (the developer, 8 Nov 2026: "more like a Telegram looking kind of thing ... a Fitness tab ... a maximize
// and minimize button"). The rules in src/squad/window.ts and src/squad/back.ts, and the source checks that matter.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const W = await import("../src/squad/window.ts");
const B = await import("../src/squad/back.ts");
const T = await import("../src/squad/tabs.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };

ok("one size (V1.47): the whole screen; the old size key is gone from the rules", () => {
  assert.ok(!("readSize" in W) && !("saveSize" in W) && !("SIZE_KEY" in W));
  assert.ok(W.NARROW_PX >= 700, "one pane at a time on narrow screens and phones");
});
ok("sections in the developer's order: Chat, Tasks, Fitness, Leaderboard, Screen time, Members", () => {
  const ids = Object.entries(T.TAB_ORDER).sort((a, b) => a[1] - b[1]).map(([k]) => k);
  assert.deepEqual(ids, ["chat", "tasks", "fitness", "leaderboard", "screen", "members"]);
  assert.deepEqual([...W.SECTION_IDS], ids);
});
ok("the first section: asked for, else a hand over waiting, else the last one, else Chat", () => {
  const ids = ["chat", "tasks", "fitness", "members"];
  assert.equal(W.firstSection({ asked: "members", waiting: 3, last: "fitness", ids }), "members");
  assert.equal(W.firstSection({ asked: null, waiting: 1, last: "fitness", ids }), "tasks");
  assert.equal(W.firstSection({ asked: null, waiting: 0, last: "fitness", ids }), "fitness");
  assert.equal(W.firstSection({ asked: "nope", waiting: 0, last: "gone", ids }), "chat");
});
ok("rows: counts and last lines", () => {
  const t = (iso: string) => iso.slice(11, 16);
  assert.deepEqual(W.chatRow(3, null, t), { line: "3 new messages", strong: true, time: "", count: 3, dot: false });
  assert.equal(W.chatRow(1, null, t).line, "1 new message");
  const last = { name: "Sam", mine: false, t: "Gym\n at 6", at: "2026-11-08T18:05:00Z" };
  assert.deepEqual(W.chatRow(0, last, t), { line: "Sam: Gym at 6", strong: false, time: "18:05", count: 0, dot: false });
  assert.equal(W.chatRow(0, { ...last, mine: true }, t).line, "You: Gym at 6");
  assert.equal(W.chatRow(0, null, t).line, "Say hi to the squad");
  const v = { in: true, name: "S", me: "m", meName: "A", creator: false, count: 1, waiting: 0, link: null, busy: null, error: null, loaded: true, hands: [],
    members: [{ id: "m", name: "A", me: true, creator: false, working: true }, { id: "k", name: "Kit", me: false, creator: false, working: false }],
    tasks: [{ id: "1", member: "m", t: "x", p: 1, d: null, x: false }, { id: "2", member: "k", t: "y", p: 2, d: null, x: true }] };
  assert.equal(W.tasksRow(v).line, "1 open task shared");
  assert.deepEqual(W.tasksRow({ ...v, waiting: 2 }), { line: "2 tasks handed to you", strong: true, time: "", count: 2, dot: false });
  assert.equal(W.membersRow(v).line, "2 members, 1 working");
  assert.equal(W.membersRow({ ...v, asks: [{ id: "a", name: "Jo", code: "1", at: "", ok: true }] }).line, "Jo asked to join");
  assert.equal(W.boardRow(v).line, "Money made and tasks done");
});
ok("Fitness row: someone else's newest best, a dot until you look", () => {
  const pb = (x: string, d: string) => ({ id: x, m: x, x, k: "kg", d, v: 1 });
  const g = { on: true, in: true, me: "m", share: { fitness: true, sleep: true }, ex: null, loaded: true, error: null, posts: [],
    members: [{ id: "m", name: "You", me: true, working: true }, { id: "s", name: "Sam", me: false, working: true }],
    cards: [{ id: "m", sum: { pb: [pb("Deadlift", "2026-11-08")] }, sleep: null }, { id: "s", sum: { pb: [pb("Bench", "2026-11-06"), pb("Squat", "2026-11-07")] }, sleep: null }] } as never;
  assert.deepEqual(W.fitnessRow(g, null), { line: "Sam set a new best: Squat", strong: true, time: "", count: 0, dot: true });
  assert.equal(W.fitnessRow(g, "2026-11-07").dot, false, "seen that day");
  assert.equal(W.fitnessRow(g, "2026-11-06").dot, true);
  assert.equal(W.fitnessRow({ ...(g as object), cards: [] } as never, null).line, "Gym boards, bests and challenges");
});
ok("avatars: initials and a steady colour", () => {
  assert.equal(W.initials("Sam Rivera"), "SR");
  assert.equal(W.initials("kit"), "K");
  assert.equal(W.initials("  ana  maria  petrova "), "AM");
  assert.equal(W.initials(""), "?");
  assert.equal(W.initials("Élodie"), "É");
  const id = "00000000-0000-4000-8000-0000000000a1";
  assert.equal(W.toneOf(id), W.toneOf(id));
  const seen = new Set(Array.from({ length: 60 }, (_, i) => W.toneOf(`member-${i}`)));
  assert.ok([...seen].every((t) => t >= 0 && t < W.TONES));
  assert.ok(seen.size >= 5, "people get different colours");
});
ok("chat day lines", () => {
  const now = new Date("2026-11-08T12:00:00");
  assert.equal(W.dayLabel("2026-11-08T08:00:00", now), "Today");
  assert.equal(W.dayLabel("2026-11-07T23:00:00", now), "Yesterday");
  assert.equal(W.dayLabel("nope", now), "");
  assert.ok(/1 October/.test(W.dayLabel("2026-10-01T10:00:00", now)), W.dayLabel("2026-10-01T10:00:00", now));
  assert.ok(/Friday/.test(W.dayLabel("2026-11-06T10:00:00", now)), "this week: the day name");
  assert.ok(W.sameDay("2026-11-08T01:00:00", "2026-11-08T22:00:00"));
});
ok("Esc: a sheet, then a step back, then the list on a narrow screen, then close; never only a size change", () => {
  assert.equal(W.escStep({ sheet: true, back: true, narrowInSection: true }), "sheet");
  assert.equal(W.escStep({ sheet: false, back: true, narrowInSection: true }), "back");
  assert.equal(W.escStep({ sheet: false, back: false, narrowInSection: true }), "list");
  assert.equal(W.escStep({ sheet: false, back: false, narrowInSection: false }), "close");
});
ok("back steps: newest first, a step stays until its owner takes it off, a broken step is dropped", () => {
  const log: string[] = [];
  const offA = B.pushBack(() => log.push("a"));
  let step = 2;
  const offB = B.pushBack(() => { log.push(`b${step}`); step--; if (!step) offB(); });
  assert.equal(B.popBack(), true); assert.equal(B.popBack(), true);   // two steps of b (list, then form)
  assert.equal(B.popBack(), true);                                    // b took itself off: a
  assert.deepEqual(log, ["b2", "b1", "a"]);
  offA();
  assert.equal(B.popBack(), false);
  B.pushBack(() => { throw new Error("broken"); });
  assert.equal(B.popBack(), true);
  assert.equal(B.popBack(), false, "the broken one is gone");
});
ok("the screen: Close (no Mac buttons since V1.47), the dimx hand over, Esc asks Fitness's sheets first, every look's colours", () => {
  const w = src("views/GSquadWindow.tsx");
  assert.match(w, /aria-label="Close"/);
  assert.ok(!/Minimize|Maximize/.test(w));
  assert.match(w, /new Event\("gos-back", \{ cancelable: true \}\)/);
  assert.match(w, /psPost\(\{ type: "dimx", open: true \}\)/);
  assert.match(w, /role="dialog"/, "in the Tab list's hit rects ([role='dialog'])");
  assert.match(src("views/GSquadFit.tsx"), /<SquadScreen v=\{fit\} desk \/>/, "Fitness's own screen, not a copy");
  assert.ok(!/isRedAccount|\bred\b/.test(w + src("views/GSquadFit.tsx")), "the same in private and public PS");
});
ok("no em or en dashes in anything new", () => {
  for (const f of ["squad/window.ts", "squad/back.ts", "views/GSquadWindow.tsx", "views/GSquadSettings.tsx", "views/GSquadFit.tsx", "views/SquadAvatar.tsx", "views/gswin.css", "views/squadavatar.css", "views/gschat.css", "views/GSquadChat.tsx", "dev/gsquad-fake.ts"]) {
    assert.ok(!/[–—]/.test(src(f)), f);
  }
});
console.log(`${n} passed`);
