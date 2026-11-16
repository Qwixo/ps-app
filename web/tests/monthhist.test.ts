// Run: node --experimental-strip-types tests/monthhist.test.ts
// Month history (PS 1.65, core/monthhist.ts): your own earnings and the leaderboards as you saw them, copied once a month.
import assert from "node:assert/strict";
import { cleanMonth, MH, planMonths, type MonthRec } from "../src/core/monthhist.ts";
import type { BoardKind, HeldCard } from "../src/core/squadboard.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const NOW = Date.parse("2026-11-12T10:00:00Z");   // October just ended
const held = (kind: BoardKind, card: unknown): HeldCard => ({ kind, card, at: "2026-11-11T00:00:00Z" } as HeldCard);
const cards = new Map<string, Map<BoardKind, HeldCard>>([
  ["me", new Map([["money", held("money", { m: { "2026-10": 5000 } })], ["tasks", held("tasks", { m: { "2026-10": 20 }, d: {} })]])],
  ["a", new Map([["money", held("money", { m: { "2026-10": 9000 } })], ["tasks", held("tasks", { m: { "2026-10": 31 }, d: {} })]])],
  ["b", new Map([["money", held("money", { m: { "2026-10": 5000 } })]])],
]);
const members = [{ id: "me", me: true }, { id: "a", me: false }, { id: "b", me: false }];
const base = { have: new Map<string, MonthRec>(), money: { m: { "2026-09": 4000, "2026-10": 5000 } }, members, cards, now: NOW, loaded: true };

ok("your own earnings are kept per month, with currency and source", () => {
  const out = planMonths({ ...base, members: [{ id: "me", me: true }], loaded: false });
  assert.deepEqual(out.map((r) => r.month), ["2026-09", "2026-10"]);
  assert.deepEqual(out[0].mine, { amount: 4000, currency: "USD", source: "squad-answer" });
  assert.equal(out[0].boards, undefined);
});
ok("the leaderboards as you saw them: ranks, your amount, never other people's amounts under the rank rule", () => {
  const oct = planMonths(base).find((r) => r.month === "2026-10")!;
  assert.deepEqual(oct.boards!.money!.map((x) => [x.m, x.r]), [["a", 1], ["me", 2], ["b", 2]], "equal amounts share a place");
  assert.equal(oct.boards!.money!.find((x) => x.m === "me")!.a, 5000);
  assert.equal(oct.boards!.money!.find((x) => x.m === "a")!.a, undefined);
  assert.deepEqual(oct.boards!.tasks!.map((x) => [x.m, x.r, x.n]), [["a", 1, 31], ["me", 2, 20]]);
  assert.ok(!JSON.stringify(oct).includes("@"), "member ids only, no names");
});
ok("under the exact rule everyone's amount is kept, because the squad showed it", () => {
  const oct = planMonths({ ...base, show: "exact" }).find((r) => r.month === "2026-10")!;
  assert.equal(oct.boards!.money!.find((x) => x.m === "a")!.a, 9000);
});
ok("nothing changed, nothing written; a changed answer is written again", () => {
  const first = planMonths(base);
  const have = new Map(first.map((r) => [r.month, r]));
  assert.deepEqual(planMonths({ ...base, have }), []);
  const again = planMonths({ ...base, have, money: { m: { "2026-09": 4000, "2026-10": 5500 } } });
  assert.deepEqual(again.map((r) => r.month), ["2026-10"]);
  assert.equal(again[0].mine!.amount, 5500); assert.ok(again[0].boards, "the boards copy is kept");
});
ok("an older month's boards are never rewritten, only the month that just ended", () => {
  const have = new Map(planMonths(base).map((r) => [r.month, r]));
  const later = planMonths({ ...base, have, now: Date.parse("2026-12-05T10:00:00Z") });
  assert.ok(!later.some((r) => r.month === "2026-10" && r.boards && JSON.stringify(r.boards) !== JSON.stringify(have.get("2026-10")!.boards)));
});
ok("alone in no squad, or cards not loaded yet: no board copy", () => {
  assert.equal(planMonths({ ...base, loaded: false }).some((r) => r.boards), false);
  assert.equal(planMonths({ ...base, members: [{ id: "me", me: true }] }).some((r) => r.boards), false);
});
ok("a month with no answers and no cards writes nothing; the list stays small", () => {
  assert.deepEqual(planMonths({ ...base, money: {}, cards: new Map() }), []);
  const many: Record<string, number> = {};
  for (let i = 0; i < 40; i++) many[`${2023 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}`] = i;
  assert.equal(planMonths({ ...base, money: { m: many }, loaded: false }).length, MH.keepMonths);
});
ok("stored records are read safely", () => {
  assert.equal(cleanMonth(null), null); assert.equal(cleanMonth({ t: "month", month: "bad" }), null);
  const r = cleanMonth({ t: "month", month: "2026-10", at: "x", mine: { amount: 5, currency: "USD" }, boards: { money: [{ m: "a", r: 1 }, { bad: 1 }] } })!;
  assert.equal(r.boards!.money!.length, 1); assert.equal(r.mine!.amount, 5);
});
console.log(`monthhist: ${n} passed`);
