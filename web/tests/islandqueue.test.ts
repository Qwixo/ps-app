// Run: node --experimental-strip-types tests/islandqueue.test.ts
// The shared island card queue (core/islandqueue.ts): the same cases as mac/tests/island-queue-test.swift.
import { BREATH_MS, DEAD_GRACE_MS, IslandQueue, MAX_WAITING, islandQueueRuntime } from "../src/core/islandqueue.ts";

let fails = 0, n = 0;
const ok = (name: string, c: boolean) => { n++; if (!c) { fails++; console.log(`FAIL ${name}`); } };
const s = (x: number) => x * 1000;
const ids = (q: IslandQueue) => q.waiting.map((c) => c.id).join(",");

const q = new IslandQueue();
ok("the first card shows now", q.enqueue({ id: "a", kind: "ai", priority: "low" }, s(0)).r === "showNow");
const w = q.enqueue({ id: "b", kind: "update", priority: "normal" }, s(1));
ok("the second waits, first in line", w.r === "wait" && w.position === 1);
ok("only one is active", q.active?.id === "a" && q.waiting.length === 1);
ok("a more urgent card never interrupts", q.enqueue({ id: "c", kind: "reminders", priority: "high" }, s(2)).r === "wait" && q.active?.id === "a");
ok("it goes next, ahead of the earlier normal one", ids(q) === "c,b");
ok("the same id is the same card", q.enqueue({ id: "b", kind: "update", priority: "normal" }, s(3)).r === "updated" && q.count === 3);
ok("a repeat with a higher priority moves it up, an equal one that came first goes first", q.enqueue({ id: "b", kind: "update", priority: "high" }, s(3)).r === "updated" && ids(q) === "b,c");
ok("same priority keeps arrival order", q.waiting[0].seq < q.waiting[1].seq);

ok("finishing a waiting card removes it quietly", q.finish("b", s(4)) === false && !q.isWaiting("b"));
ok("finishing the active card says so", q.finish("a", s(5)) === true && q.active === null);
ok("the next waits a short breath", q.step(s(5) + 100, false).promote === null);
const r = q.step(s(5.4), false);
ok("then it comes out", r.promote?.id === "c" && q.isActive("c"));
{
  const z = new IslandQueue();
  z.enqueue({ id: "x", kind: "k", priority: "low" }, s(0)); z.finish("x", s(1));
  const o = z.enqueue({ id: "y", kind: "k", priority: "low" }, s(1.05));
  ok("a card arriving during the breath waits, never shows on the same frame", o.r === "wait");
}
ok("Esc closes the active card", q.escape(s(6)) === "c" && q.active === null);
ok("Esc with nothing active does nothing", new IslandQueue().escape(0) === null);

{
  const t = new IslandQueue();
  t.enqueue({ id: "r", kind: "reminders", priority: "high" }, s(0));
  t.enqueue({ id: "ai1", kind: "ai", priority: "low", ttl: s(30) }, s(1));
  t.enqueue({ id: "keep", kind: "update", priority: "low" }, s(1));
  const x = t.step(s(40), true);
  ok("a stale waiting card is dropped, never shown late", x.dropped.map((c) => c.id).join() === "ai1" && !t.isWaiting("ai1"));
  ok("a card without a time to live keeps waiting", t.isWaiting("keep"));
}
{
  const d = new IslandQueue();
  d.enqueue({ id: "ghost", kind: "x", priority: "normal" }, s(0));
  d.enqueue({ id: "next", kind: "x", priority: "normal" }, s(0.5));
  let x = d.step(s(2), false);
  ok("a window missing for a moment is not given up on yet", d.isActive("ghost") && x.promote === null);
  x = d.step(s(5), false);
  ok("a window gone past the grace is let go", !d.isActive("ghost"));
  x = d.step(s(5.5), false);
  ok("and the next card takes over", x.promote?.id === "next");
  const v = new IslandQueue();
  v.enqueue({ id: "long", kind: "x", priority: "normal" }, s(0));
  v.step(s(500), true);
  ok("a card that stays visible is never let go, however long", v.isActive("long"));
}
{
  const f = new IslandQueue();
  f.enqueue({ id: "first", kind: "x", priority: "low" }, s(0));
  let refused = 0;
  for (let i = 0; i < 45; i++) if (f.enqueue({ id: `f${i}`, kind: "x", priority: "low" }, s(1)).r === "dropped") refused++;
  ok("a flood is capped", f.waiting.length === MAX_WAITING && refused === 15);
}
{
  const rc = new IslandQueue();
  ok("nothing pending: no recheck", rc.recheck(0) === null);
  rc.enqueue({ id: "a", kind: "x", priority: "low" }, s(0));
  rc.enqueue({ id: "b", kind: "x", priority: "low", ttl: s(2) }, s(0));
  ok("a recheck never later than the next expiry", (rc.recheck(0) ?? 1e9) <= s(2) + 20);
  const cc = new IslandQueue();
  cc.enqueue({ id: "a", kind: "x", priority: "low" }, s(0)); cc.finish("a", s(1));
  ok("a finished id can come again later", cc.enqueue({ id: "a", kind: "x", priority: "low" }, s(3)).r === "showNow");
}
ok("constants", BREATH_MS === 250 && DEAD_GRACE_MS === 4000);

// the runtime: a fake clock and a fake timer, no real waiting
{
  let now = 0; const jobs: { at: number; f: () => void }[] = [];
  const rt = islandQueueRuntime(() => now, (f, ms) => { jobs.push({ at: now + ms, f }); });
  const run = (to: number) => { for (;;) { jobs.sort((a, b) => a.at - b.at); const j = jobs[0]; if (!j || j.at > to) break; jobs.shift(); now = j.at; j.f(); } now = to; };
  const turns: string[] = [];
  ok("runtime: first shows now", rt.join({ id: "face", kind: "update", priority: "normal" }, () => turns.push("face")).r === "showNow");
  ok("runtime: second waits", rt.join({ id: "wn", kind: "notes", priority: "low" }, () => turns.push("wn")).r === "wait");
  run(1000);
  ok("runtime: nothing promoted while the first stays", turns.length === 0 && rt.queue.isActive("face"));
  rt.leave("face");
  run(now + 100);
  ok("runtime: the breath holds the next one back", turns.length === 0);
  run(now + 500);
  ok("runtime: then it takes its turn once", turns.join() === "wn" && rt.queue.isActive("wn"));
  rt.leave("wn");
  run(now + 5000);
  ok("runtime: leaving the last card leaves the queue empty", rt.queue.count === 0);
}

if (fails) { console.log(`${fails} of ${n} failed`); process.exit(1); }
console.log(`ok, ${n} checks`);
