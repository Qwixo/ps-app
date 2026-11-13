// Run: node --experimental-strip-types tests/gsquad-money-entry.test.ts
// G Squad (V1.43), the developer 8 Nov 2026: "the part where it asks how much money did you make last month keeps popping up.
// Make it so it doesn't pop up, and instead you go to the Leaderboard screen and type in how much you made last
// month... Sometimes people take a few days to submit their result." The month window, the late entry, fixing a
// past month, the quiet dot, the Money opt-out, "Not added yet", and no pop-up anywhere. Names are fictional.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { answerMoney, buildBoard, cleanMoney, moneyCard, moneyDue, moneyMonthOk, skipMoney, type BoardKind, type HeldCard } from "../src/core/squadboard.ts";
import { cleanBoardOp } from "../src/core/squadboard.ts";

const tests: [string, () => Promise<void> | void][] = [];
const ok = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const T = (s: string) => Date.parse(s);
const ME = "11111111-1111-4111-8111-111111111111", SAM = "22222222-2222-4222-8222-222222222222";

// ---------- the month window ----------
ok("window: October opens at 00:00 on 1 November (Dubai by default), not a minute before", () => {
  const m = cleanMoney({});
  assert.equal(moneyDue(m, T("2026-10-31T19:59:59Z")), "2026-09", "23:59 on 31 Oct in the developer's city: still September's turn");
  assert.equal(moneyDue(m, T("2026-10-31T20:00:00Z")), "2026-10");
});
ok("window: open for the whole month (day 1, day 3, day 15, the last minute), then the next month's turn", () => {
  const m = cleanMoney({});
  for (const at of ["2026-11-01T08:00:00Z", "2026-11-03T12:00:00Z", "2026-11-15T12:00:00Z", "2026-11-30T19:59:00Z"]) assert.equal(moneyDue(m, T(at)), "2026-10", at);
  assert.equal(moneyDue(m, T("2026-11-30T20:00:00Z")), "2026-11", "1 Dec 00:00 Dubai");
});
ok("window: your own time zone moves the 1st with it", () => {
  const m = cleanMoney({ tz: "America/New_York" });
  assert.equal(moneyDue(m, T("2026-11-01T03:59:00Z")), "2026-09", "still 31 Oct in New York");
  assert.equal(moneyDue(m, T("2026-11-01T04:00:00Z")), "2026-10");
});
ok("window: added or skipped, the entry and its dot go away until next month", () => {
  const now = T("2026-11-04T10:00:00Z");
  assert.equal(moneyDue(answerMoney(cleanMoney({}), "2026-10", 9000), now), null);
  assert.equal(moneyDue(skipMoney(cleanMoney({}), "2026-10"), now), null);
});

// ---------- the late entry ----------
ok("late: added days later it counts for October, the card carries it, and the entry goes", () => {
  const late = T("2026-11-19T15:00:00Z");
  const m = answerMoney(cleanMoney({}), "2026-10", 12400);
  assert.equal(moneyDue(m, late), null);
  assert.deepEqual(moneyCard(m, late).m, { "2026-10": 12400 });
});
ok("late: any month that has ended, back 12 months, can be added or fixed; this month and later never", () => {
  const money = cleanMoney({});
  const now = T("2026-11-19T15:00:00Z");
  assert.equal(moneyMonthOk("2026-10", money, now), true, "last month");
  assert.equal(moneyMonthOk("2026-06", money, now), true, "a past month, to fix it");
  assert.equal(moneyMonthOk("2025-11", money, now), true, "12 months back");
  assert.equal(moneyMonthOk("2025-10", money, now), false, "13 months back: past what the card carries");
  assert.equal(moneyMonthOk("2026-11", money, now), false, "this month is not over");
  assert.equal(moneyMonthOk("2026-12", money, now), false);
  assert.equal(moneyMonthOk("2026-13", money, now), false);
});
ok("late: fixing a past month replaces it, a skip is undone by adding it", () => {
  const m1 = answerMoney(cleanMoney({ m: { "2026-08": 500, "2026-09": 700 } }), "2026-08", 650);
  assert.deepEqual(m1.m, { "2026-08": 650, "2026-09": 700 });
  const sk = skipMoney(cleanMoney({}), "2026-10");
  const back = answerMoney(sk, "2026-10", 300);
  assert.equal(back.skip, undefined);
  assert.equal(back.m?.["2026-10"], 300);
});
ok("late: the main page refuses a month that has not ended (or is too old) before saving", () => {
  assert.match(src("squad/board.ts"), /case "money": if \(!moneyMonthOk\(o\.month, money, Date\.now\(\)\)\) return;/);
  assert.match(src("squad/board.ts"), /case "skip": if \(!moneyMonthOk\(o\.month, money, Date\.now\(\)\)\) return;/);
  assert.equal(cleanBoardOp({ op: "snooze", month: "2026-10", choice: "hour" }), null, "no snooze any more");
});

// ---------- what the Leaderboard shows ----------
const held = (m: Record<string, number>): Map<BoardKind, HeldCard> => new Map([["money", { kind: "money", card: { m }, at: "2026-11-02T00:00:00Z" }]]);
const base = { members: [{ id: ME, me: true }, { id: SAM, me: false }], myMoney: cleanMoney({}), now: T("2026-11-03T10:00:00Z"), deviceTz: "Asia/Dubai", loaded: true };
ok("Leaderboard: the entry is for October, and people who have not added it yet show as Not added yet", () => {
  const b = buildBoard({ ...base, myShare: {}, cards: new Map([[ME, held({})], [SAM, held({ "2026-10": 900 })]]) });
  assert.deepEqual(b.due, { month: "2026-10", label: "October" });
  const me = b.money["1"].find((e) => e.member === ME)!;
  assert.equal(me.state, "none");
  const g = src("views/GSquadBoard.tsx");
  assert.match(g, /e\.state === "none" \? <span className="gsb-off">Not added yet<\/span>/);
  assert.match(g, /<span className="gs-h">Add what you made in \{label\}<\/span>/);
  assert.match(g, /Add it any day this month\./);
  assert.match(g, /\{b\.due && b\.mine\.on && <AddMonth b=\{b\} month=\{b\.due\.month\} label=\{b\.due\.label\} \/>\}/);
});
ok("Leaderboard: Money switched off shows no entry and no dot", () => {
  const b = buildBoard({ ...base, myShare: { money: false }, cards: new Map() });
  assert.equal(b.due, null);
  assert.equal(b.mine.on, false);
  assert.match(src("views/GSquadBoard.tsx"), /dot: \(v\) => !!\(v\.board\?\.due && v\.board\.mine\.on\)/);
});
ok("the hint is only a quiet dot on the Leaderboard tab: no pop-up, no sound, no notification, no Tab list opening", () => {
  const g = src("views/GSquadBoard.tsx"), board = src("squad/board.ts"), ps = src("ps.ts"), tab = src("views/GSquadWindow.tsx"), row = src("squad/window.ts");
  assert.ok(!/createPortal|registerSquadLayer|How much did you make|Remind me in an hour/.test(g), "no pop-up left");
  assert.ok(!/openList|post\(|dndMutes|inCall|askTimer/.test(board), "the main page never opens the Tab list for it");
  assert.match(ps, /startSquadBoard\(\);/);
  // V1.43 merge: the G Squad window's Leaderboard row carries the dot and an "Add what you made in" line.
  assert.match(tab, /r\?\.dot \|\| extra\?\.dot \? <i className="gsw-dot"/);   // V1.47: the row gets dot: t.dot?.(v)
  assert.match(tab, /dot: t\.dot\?\.\(v\)/);
  assert.match(row, /if \(v\.board\?\.due && v\.board\.mine\.on\) return \{ line: `Add what you made in \$\{v\.board\.due\.label\}`/);
  assert.ok(!/sfx|cardShow|notify/.test(g.slice(g.indexOf("registerSquadTab({ id: \"leaderboard\""))), "the dot makes no sound");
});
ok("no em or en dashes in anything this change touched", () => {
  for (const p of ["core/squadboard.ts", "squad/board.ts", "squad/boardmirror.ts", "squad/tabs.ts", "views/GSquadBoard.tsx", "views/gsquadboard.css", "views/gsquad.css", "views/GSquad.tsx", "ps.ts"]) {
    assert.ok(!/[–—]/.test(src(p)), p);
  }
});

let pass = 0;
for (const [name, fn] of tests) {
  try { await fn(); pass++; console.log("ok -", name); } catch (e) { console.error("FAIL -", name); console.error(e); process.exitCode = 1; }
}
console.log(`\ngsquad-money-entry: ${pass} of ${tests.length} passed`);
