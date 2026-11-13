// Run: node --experimental-strip-types tests/gsquad-board.test.ts
// G Squad Leaderboard and Screen time (V1.40): which month you add what you made for (V1.43: from the 1st in your
// zone, open all month, never a pop-up; skip), the cards (opt-outs never sealed, Not shared and
// repeating tasks never counted, 1Password and Signal never in screen time, no app names), ranking only vs exact,
// and the Tab list never holding a key. Names are fictional.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as S from "../src/core/squadcrypto.ts";
import {
  BOARD_RULES, addMonths, answerMoney, boardAad, buildBoard, cleanAmount, cleanBoardOp, cleanCard, cleanMoney, moneyCard, moneyDue,
  placeLabel, planBoardSync, screenCard, skipMoney, tasksCard, type BoardKind, type HeldCard,
} from "../src/core/squadboard.ts";
import { cleanBoardView } from "../src/squad/boardmirror.ts";
import type { Doc, ScreenTimeDay, Todo } from "../src/core/model.ts";

const tests: [string, () => Promise<void> | void][] = [];
const ok = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const T = (iso: string) => Date.parse(iso);
const SQ = "0b6f1a52-7c1d-4b0e-9a3c-1f2e3d4c5b6a", ME = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", C = "33333333-3333-4333-8333-333333333333";
// Marked Share with G Squad (V1.43: only shared tasks count on the leaderboard).
const todo = (id: string, data: Partial<Todo>): Doc<Todo> => ({ id, ws: null, kind: "todo", author: null, updatedAt: null,
  data: { title: "Task", type: "once", done: false, order: 0, sqOn: true, ...data } as Todo });
const st = (day: string, device: "mac" | "gos" | undefined, apps: [string, string, number][]): Doc<ScreenTimeDay> => ({ id: `${day}-${device}`, ws: null, kind: "screentime", author: null, updatedAt: null,
  data: { day, ...(device ? { device } : {}), apps: apps.map(([id, name, secs]) => ({ id, name, secs })), updatedAt: "" } });

// ---------- what you made last month ----------
ok("money: due from the 1st at 00:00 Dubai (GST, UTC+4) by default, about the month before", () => {
  const m = cleanMoney({});
  assert.equal(moneyDue(m, T("2026-10-31T19:59:00Z")), "2026-09");   // 23:59 on 31 Oct in the developer's city: still September
  assert.equal(moneyDue(m, T("2026-10-31T20:00:00Z")), "2026-10");   // 00:00 on 1 Nov in the developer's city
});
ok("money: another person's zone moves midnight with it", () => {
  const m = cleanMoney({ tz: "Europe/London" });
  assert.equal(moneyDue(m, T("2026-10-31T23:59:00Z")), "2026-09");
  assert.equal(moneyDue(m, T("2026-11-01T00:00:00Z")), "2026-10");
  assert.equal(cleanMoney({ tz: "Not/AZone" }).tz, undefined);
});
ok("money: open all month (still due days later), until added", () => {
  const m = cleanMoney({});
  assert.equal(moneyDue(m, T("2026-11-05T09:00:00Z")), "2026-10");
  const a = answerMoney(m, "2026-10", 12500);
  assert.equal(moneyDue(a, T("2026-11-05T09:00:00Z")), null);
  assert.equal(moneyDue(a, T("2026-11-30T19:00:00Z")), null);
  assert.equal(moneyDue(a, T("2026-11-30T20:00:00Z")), "2026-11");   // next month: November's turn
});
ok("money: no snooze any more (an old stored one is dropped), and Skip this month", () => {
  const now = T("2026-11-01T10:00:00Z");   // 14:00 in the developer's city
  const old = cleanMoney({ snooze: { month: "2026-10", until: now + 3_600_000 } });
  assert.ok(!("snooze" in old));
  assert.equal(moneyDue(old, now + 10_000), "2026-10", "an old snooze never hides the entry");
  const sk = skipMoney(cleanMoney({ m: { "2026-10": 5 } }), "2026-10");
  assert.equal(moneyDue(sk, now), null);
  assert.equal(sk.m, undefined);
  assert.deepEqual(answerMoney(sk, "2026-10", 7).skip, undefined);
});
ok("money: amounts are whole numbers; a minus only when the rule is profit", () => {
  assert.equal(cleanAmount("12,400"), 12400);
  assert.equal(cleanAmount("$ 1 500.6"), 1501);
  assert.equal(cleanAmount("-50", { ...BOARD_RULES, money: "revenue" }), null);
  assert.equal(cleanAmount("-50", { ...BOARD_RULES, money: "profit" }), -50);
  assert.equal(cleanAmount("lots"), null);
  assert.equal(cleanAmount(1e12), null);
});
ok("the one setting: revenue and ranking only, by default", () => {
  assert.equal(BOARD_RULES.money, "revenue");
  assert.equal(BOARD_RULES.show, "rank");
});

// ---------- the cards ----------
ok("tasks card: shared tasks done only; Not shared and repeating tasks never count; anonymised ones do", () => {
  const now = T("2026-11-07T12:00:00Z");
  const list = [
    todo("a", { done: true, doneAt: "2026-11-07T08:00:00Z" }),
    todo("b", { done: true, doneAt: "2026-11-06T08:00:00Z", sqAnon: true }),
    todo("c", { done: true, doneAt: "2026-11-06T09:00:00Z", sqOff: true }),
    todo("d", { done: true, doneAt: "2026-11-06T09:00:00Z", type: "daily" }),
    todo("e", { done: false }),
    todo("f", { done: true, doneAt: "2026-10-20T09:00:00Z", clearedAt: "2026-10-21T00:00:00Z" }),
    todo("g", { done: true, doneAt: "2026-10-31T21:00:00Z" }),   // 1 Nov 01:00 in the developer's city
  ];
  const c = tasksCard(list, now, "Asia/Dubai");
  assert.deepEqual(c.m, { "2026-10": 1, "2026-11": 3 });
  assert.deepEqual(c.d, { "2026-11-01": 1, "2026-11-06": 1, "2026-11-07": 1 });
});
ok("screen card: daily totals per device, last 7 days, never 1Password or Signal, never an app name", () => {
  const now = T("2026-11-07T12:00:00Z");
  const docs = [
    st("2026-11-07", "mac", [["com.apple.Safari", "Safari", 3600], ["com.1password.1password", "1Password", 900], ["org.whispersystems.signal-desktop", "Signal", 600]]),
    st("2026-11-07", "gos", [["gos:com.android.chrome", "Chrome", 1200], ["gos:org.thoughtcrime.securesms", "Signal", 500]]),
    st("2026-11-01", undefined, [["com.figma.Desktop", "Figma", 7200]]),
    st("2026-10-30", "mac", [["com.figma.Desktop", "Figma", 7200]]),   // over a week ago
  ];
  const c = screenCard(docs, now, "Asia/Dubai");
  assert.deepEqual(c.d, { "2026-11-01": [7200, 0], "2026-11-07": [3600, 1200] });
  const text = JSON.stringify(c);
  for (const w of ["Safari", "Chrome", "Figma", "1Password", "Signal", "com.", "gos:"]) assert.ok(!text.includes(w), w);
});
ok("cards from the hub are checked field by field", () => {
  assert.deepEqual(cleanCard("money", { m: { "2026-10": 5, bad: 3, "2026-11": "x" }, extra: 1 }), { m: { "2026-10": 5 } });
  assert.deepEqual(cleanCard("tasks", { m: { "2026-10": -1 }, d: { "2026-11-02": 4 } }), { m: {}, d: { "2026-11-02": 4 } });
  assert.deepEqual(cleanCard("screen", { d: { "2026-11-02": [10, 20], "2026-11-03": [99999, 0], x: [1, 1] } }), { d: { "2026-11-02": [10, 20] } });
  assert.equal(cleanCard("money", "nope"), null);
});

// ---------- the gate ----------
async function input(settings: Record<string, unknown>, have = new Map<string, string>(), gen = 1) {
  const key = { raw: await S.newSquadKey(), gen };
  return { settings, todos: [todo("a", { done: true, doneAt: "2026-11-07T08:00:00Z" })], screen: [st("2026-11-07", "mac", [["x", "X", 60]])],
    squad: SQ, member: ME, secret: S.newSecret(), key, have, now: T("2026-11-07T12:00:00Z"), deviceTz: "Asia/Dubai" };
}
ok("gate: every piece on sends three sealed cards that open only with their own aad", async () => {
  const never = await planBoardSync(await input({ squadMoney: { m: { "2026-10": 900 } } }));
  assert.deepEqual(never.put.map((r) => r.kind).sort(), ["money", "screen"], "V1.43: Tasks never set is off, so no tasks card");
  const i = await input({ squadShare: { tasks: true }, squadMoney: { m: { "2026-10": 900 } } });
  const p = await planBoardSync(i);
  assert.deepEqual(p.put.map((r) => r.kind).sort(), ["money", "screen", "tasks"]);
  const money = p.put.find((r) => r.kind === "money")!;
  assert.deepEqual(await S.open(i.key.raw, money.ct, boardAad(SQ, ME, "money", 1)), { m: { "2026-10": 900 } });
  await assert.rejects(S.open(i.key.raw, money.ct, boardAad(SQ, B, "money", 1)));      // moved onto another member: refused
  await assert.rejects(S.open(i.key.raw, money.ct, boardAad(SQ, ME, "screen", 1)));    // or another kind
  // Nothing changed: nothing sent.
  const again = await planBoardSync({ ...i, have: new Map(p.put.map((r) => [r.kind, r.fp])) });
  assert.deepEqual(again, { put: [], del: [] });
  // A new key gen: everything sealed again.
  const regen = await planBoardSync({ ...i, key: { raw: await S.newSquadKey(), gen: 2 }, have: new Map(p.put.map((r) => [r.kind, r.fp])) });
  assert.equal(regen.put.length, 3);
});
ok("gate: a piece switched off is never sealed or sent, and its card is taken away", async () => {
  for (const piece of ["money", "tasks", "screen"] as const) {
    const i = await input({ squadShare: { [piece]: false }, squadMoney: { m: { "2026-10": 900 } } }, new Map([[piece, "ab".repeat(16)]]));
    const p = await planBoardSync(i);
    assert.ok(!p.put.some((r) => r.kind === piece), piece);
    assert.deepEqual(p.del, [piece]);
  }
  // Switched off and nothing on the hub: nothing at all.
  const i = await input({ squadShare: { money: false, tasks: false, screen: false } });
  assert.deepEqual(await planBoardSync(i), { put: [], del: [] });
});
ok("gate: the board code seals only through sealForSquad (the opt-out gate)", () => {
  const core = src("core/squadboard.ts");
  assert.ok(core.includes("sealForSquad(opts, PIECE_OF[kind]"));
  assert.ok(!/\bseal\(/.test(core.replace(/sealForSquad\(/g, "")));
  for (const f of ["squad/board.ts", "squad/boardhub.ts"]) assert.ok(!/\bseal\(|sealForSquad/.test(src(f)), f);   // the engine side only opens; planBoardSync seals
});

// ---------- what the pop-up shows ----------
const held = (kind: BoardKind, card: unknown): HeldCard => ({ kind, card: card as HeldCard["card"], at: "2026-11-07T11:00:00Z" });
function squad(cards: Record<string, Partial<Record<BoardKind, unknown>>>) {
  const m = new Map<string, Map<BoardKind, HeldCard>>();
  for (const [id, c] of Object.entries(cards)) m.set(id, new Map(Object.entries(c).map(([k, v]) => [k as BoardKind, held(k as BoardKind, v)])));
  return m;
}
const members = [{ id: ME, me: true }, { id: B, me: false }, { id: C, me: false }];
const NOW = T("2026-11-07T12:00:00Z");
ok("leaderboard, ranking only: others' amounts never reach the Tab list, your own does", () => {
  const cards = squad({ [ME]: { money: { m: { "2026-10": 500 } } }, [B]: { money: { m: { "2026-10": 900, "2026-09": 100 } } }, [C]: {} });
  const v = buildBoard({ members, cards, myMoney: cleanMoney({ m: { "2026-10": 500 } }), myShare: {}, now: NOW, deviceTz: "Asia/Dubai", loaded: true, rules: { ...BOARD_RULES, show: "rank" } });
  const last = v.money["1"];
  assert.deepEqual(last.map((e) => [e.member, e.state, e.rank]), [[B, "ok", 1], [ME, "ok", 2], [C, "off", null]]);
  assert.equal(last.find((e) => e.member === ME)!.amount, 500);
  assert.equal(last.find((e) => e.member === B)!.amount, undefined);
  assert.ok(!JSON.stringify(v).includes("900") && !JSON.stringify(v).includes("1000"));
  const three = v.money["3"];
  assert.equal(three.find((e) => e.member === B)!.months, 2);
});
ok("leaderboard, exact: everyone's amounts and the 'none' state for no answer in the stretch", () => {
  const cards = squad({ [ME]: { money: { m: {} } }, [B]: { money: { m: { "2026-10": 900 } } }, [C]: { money: { m: { "2026-10": 900 } } } });
  const v = buildBoard({ members, cards, myMoney: {}, myShare: {}, now: NOW, deviceTz: "Asia/Dubai", loaded: true, rules: { ...BOARD_RULES, show: "exact" } });
  assert.deepEqual(v.money["1"].map((e) => [e.member, e.state, e.rank, e.amount]), [[B, "ok", 1, 900], [C, "ok", 1, 900], [ME, "none", null, undefined]]);
});
ok("leaderboard: tasks done over 7 days, this month and 3 months; Not shared for opted out", () => {
  const cards = squad({ [ME]: { tasks: { m: { "2026-11": 4, "2026-10": 10, "2026-08": 50 }, d: { "2026-11-07": 2, "2026-10-31": 9 } } }, [B]: { tasks: { m: { "2026-11": 4 }, d: { "2026-11-02": 3 } } } });
  const v = buildBoard({ members, cards, myMoney: {}, myShare: {}, now: NOW, deviceTz: "Asia/Dubai", loaded: true });
  assert.deepEqual(v.tasks["7d"].map((e) => [e.member, e.n, e.rank]), [[B, 3, 1], [ME, 2, 2], [C, undefined, null]]);
  assert.deepEqual(v.tasks.month.map((e) => [e.member, e.n, e.rank]), [[ME, 4, 1], [B, 4, 1], [C, undefined, null]]);
  assert.equal(v.tasks["3m"].find((e) => e.member === ME)!.n, 14);
  assert.equal(v.tasks["7d"].find((e) => e.member === C)!.state, "off");
});
ok("screen time tab: today's total, the device split, a 7 day row and the average of the days before today", () => {
  const cards = squad({ [ME]: { screen: { d: { "2026-11-07": [3600, 600], "2026-11-06": [7200, 0], "2026-11-05": [3600, 0] } } }, [B]: {} });
  const v = buildBoard({ members: members.slice(0, 2), cards, myMoney: {}, myShare: {}, now: NOW, deviceTz: "Asia/Dubai", loaded: true });
  const me = v.screen.find((e) => e.member === ME)!;
  assert.deepEqual([me.today, me.mac, me.phone, me.avg], [4200, 3600, 600, 5400]);
  assert.deepEqual(me.week, [null, null, null, null, 3600, 7200, 4200]);
  assert.equal(v.days[6], "2026-11-07");
  assert.equal(v.screen.find((e) => e.member === B)!.state, "off");
});
ok("the question shows only while Money is shared, and only for the month due", () => {
  const base = { members, cards: squad({}), myMoney: cleanMoney({}), now: NOW, deviceTz: "Asia/Dubai", loaded: true };
  assert.deepEqual(buildBoard({ ...base, myShare: {} }).due, { month: "2026-10", label: "October" });
  assert.equal(buildBoard({ ...base, myShare: { money: false } }).due, null);
});
ok("places and ties: 1, 1, 3", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(placeLabel), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st"]);
});

// ---------- the Tab list ----------
ok("Tab list requests are checked on the main page", () => {
  assert.deepEqual(cleanBoardOp({ op: "money", month: "2026-10", amount: "1,200" }), { op: "money", month: "2026-10", amount: 1200 });
  assert.equal(cleanBoardOp({ op: "money", month: "2026-13", amount: 1 }), null);
  assert.equal(cleanBoardOp({ op: "snooze", month: "2026-10", choice: "hour" }), null, "V1.43: no snooze");
  assert.deepEqual(cleanBoardOp({ op: "skip", month: "2026-10" }), { op: "skip", month: "2026-10" });
  assert.equal(cleanBoardOp({ op: "tz", tz: "Mars/Base" }), null);
  assert.deepEqual(cleanBoardOp({ op: "tz", tz: "Europe/Paris" }), { op: "tz", tz: "Europe/Paris" });
});
ok("the Tab list's copy of the board drops anything unexpected", () => {
  const v = cleanBoardView({ rules: { money: "x", show: "exact", currency: "USDOLLAR" }, money: { "1": [{ member: B, state: "ok", rank: 1, amount: 5, key: "secret" }] }, due: { month: "2026-10", label: "October" } })!;
  assert.equal(v.rules.money, "revenue");
  assert.equal(v.rules.currency, "USD");
  assert.ok(!("key" in v.money["1"][0]));
  assert.deepEqual(v.money["3"], []);
  assert.equal(cleanBoardView(null), null);
});
ok("the Tab list side holds no key and no crypto", () => {
  for (const f of ["views/GSquadBoard.tsx", "squad/boardmirror.ts"]) {
    const t = src(f);
    assert.ok(!/squadcrypto|squadrec|crypto\.subtle/.test(t), f);
  }
});
ok("no em or en dashes in the new files", () => {
  for (const f of ["core/squadboard.ts", "squad/board.ts", "squad/boardhub.ts", "squad/boardmirror.ts", "views/GSquadBoard.tsx", "views/gsquadboard.css"]) assert.ok(!/[–—]/.test(src(f)), f);
  assert.ok(!/[–—]/.test(readFileSync(new URL("../supabase/hub/functions/board/index.ts", import.meta.url), "utf8")));
  assert.ok(!/[–—]/.test(readFileSync(new URL("../supabase/hub/migrations/004_board_core.sql", import.meta.url), "utf8")));
});
ok("month maths", () => {
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(addMonths("2026-11", 2), "2027-01");
  assert.deepEqual(moneyCard(cleanMoney({ m: { "2025-10": 1, "2025-11": 2, "2026-10": 3 } }), NOW).m, { "2025-11": 2, "2026-10": 3 });
});

let pass = 0;
for (const [name, fn] of tests) {
  try { await fn(); pass++; } catch (e) { console.error(`FAIL ${name}\n`, e); process.exitCode = 1; }
}
console.log(`gsquad-board: ${pass} of ${tests.length} passed`);
