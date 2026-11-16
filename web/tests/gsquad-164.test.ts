// Run: node --experimental-strip-types tests/gsquad-164.test.ts
// G Squad PS 1.64: replies (sealed with the message, older PS shows the words, an edit keeps the quote, finding the
// original far up), the members list (sealed gym time, the developer's online rules, never a guess), and Past boards (the file
// format, the owner only sync plan, sealing). Names are fictional.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as S from "../src/core/squadcrypto.ts";
import type { SquadRec } from "../src/core/squadrec.ts";
import { cleanBody, cleanReply, openMessage, replySnippet, sealMessage, type ChatBody } from "../src/core/squadchat.ts";
import { cleanChatOp, cleanChatView, EMPTY_CHAT } from "../src/squad/chatview.ts";
import { buildSend } from "../src/squad/chatsend.ts";
import { ChatSession } from "../src/squad/chatflows.ts";
import { agoText, cleanSeenRows, memberStatus, openPresence, sealPresence, statusOrder } from "../src/core/squadpresence.ts";
import { cleanPastDoc, cleanPastMonth, cleanPastMonths, fmtUsd, monthLabel, monthShort, openPast, pastProblems, planPastSync } from "../src/core/squadpast.ts";
import { cleanBoardView } from "../src/squad/boardmirror.ts";

const tests: [string, () => Promise<void> | void][] = [];
const ok = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const SQ = "0b6f1a52-7c1d-4b0e-9a3c-1f2e3d4c5b6a";
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const squadKey = await S.newSquadKey();
async function member(id: string, me: string, keys = [{ gen: 1, k: squadKey }]): Promise<SquadRec> {
  return { v: 1, squadId: SQ, memberId: id, me, keys, sign: await S.newSignPair(), box: await S.newBoxPair(), secret: S.newSecret(), joinedAt: new Date().toISOString() };
}
const A = await member(ID(1), "Alex");

// ---------- replies ----------
ok("a reply travels sealed inside the message, bound to it like the words", async () => {
  const raw = await S.newSquadKey();
  const body: ChatBody = { t: "Agreed", q: { id: ID(50), w: ID(2), s: "Gym at 8?" } };
  const ct = await sealMessage(raw, SQ, 1, ID(1), ID(60), body);
  assert.ok(!ct.includes("Gym"), "the hub sees only ciphertext");
  assert.deepEqual(await openMessage(raw, SQ, 1, ID(1), ID(60), ct), body);
  assert.equal(await openMessage(raw, SQ, 1, ID(1), ID(61), ct), null, "moved to another id: does not open");
});
ok("older PS (before 1.64) drops the reply part and still shows the words", () => {
  // The pre 1.64 cleanBody kept only t and a: the same message reads as an ordinary one.
  const old = (v: Record<string, unknown>) => { const t = typeof v.t === "string" ? v.t.trim() : ""; return t ? { t } : null; };
  assert.deepEqual(old({ t: "Agreed", q: { id: ID(50), w: ID(2), s: "Gym at 8?" } }), { t: "Agreed" });
  assert.ok(read("src/core/squadchat.ts").includes("const a = cleanAbout(b.a), q = cleanReply(b.q);"));
});
ok("a reply with no words, or a bad reference, is not a reply", () => {
  assert.equal(cleanBody({ t: "   ", q: { id: ID(50), w: ID(2), s: "x" } }), null);
  assert.deepEqual(cleanBody({ t: "hi", q: { id: "nope", w: ID(2), s: "x" } }), { t: "hi" });
  assert.equal(cleanReply({ id: ID(50), w: "<script>", s: "x" }), undefined);
  assert.deepEqual(cleanBody({ t: "", r: { to: ID(5), e: "🔥" }, q: { id: ID(50), w: ID(2), s: "x" } }), { t: "", r: { to: ID(5), e: "🔥" } }, "a reaction is never a reply");
});
ok("the quoted line is the first line, one line, cut short", () => {
  assert.equal(replySnippet("\n\n  First line here  \nsecond"), "First line here");
  assert.equal(replySnippet("tab\there"), "tab here");
  const long = replySnippet("x".repeat(400));
  assert.ok(long.length <= 120 && long.endsWith("..."));
  assert.equal(replySnippet(42), "");
});
ok("the Tab list may send a reply and a seek, checked field by field", () => {
  assert.deepEqual(cleanChatOp({ op: "send", text: "yes", q: { id: ID(50).toUpperCase(), w: ID(2), s: "a\nb" } }), { op: "send", text: "yes", q: { id: ID(50), w: ID(2), s: "a" } });
  assert.deepEqual(cleanChatOp({ op: "send", text: "yes", q: { id: "x" } }), { op: "send", text: "yes" });
  assert.deepEqual(cleanChatOp({ op: "seek", id: ID(50) }), { op: "seek", id: ID(50) });
  assert.equal(cleanChatOp({ op: "seek", id: "../x" }), null);
  assert.deepEqual(buildSend(" ok ", { reply: { id: ID(50), w: ID(2), s: "a" } }), { op: "send", text: "ok", q: { id: ID(50), w: ID(2), s: "a" } });
  assert.deepEqual(buildSend("ok", { reply: { id: ID(50), w: ID(2), s: "a" }, editId: ID(9) }), { op: "edit", id: ID(9), text: "ok" }, "an edit never adds a reply");
});
ok("the Tab list's copy keeps the quote, and a gone quote carries no words", () => {
  const v = cleanChatView({ ...EMPTY_CHAT, lines: [
    { id: ID(60), from: ID(1), name: "You", mine: true, t: "Agreed", at: "2026-11-16T10:00:00Z", edited: false, left: false, q: { id: ID(50), name: "Sam", from: ID(2), s: "Gym at 8?", gone: false } },
    { id: ID(61), from: ID(1), name: "You", mine: true, t: "Again", at: "2026-11-16T10:01:00Z", edited: false, left: false, q: { id: ID(51), name: "Sam", from: ID(2), s: "secret words", gone: true } },
  ], jump: { id: ID(50), ok: true, n: 3 } });
  assert.deepEqual(v.lines[0].q, { id: ID(50), name: "Sam", from: ID(2), s: "Gym at 8?", gone: false });
  assert.equal(v.lines[1].q!.s, "");
  assert.deepEqual(v.jump, { id: ID(50), ok: true, n: 3 });
});
ok("finding the original loads older pages until it is there, or remembers it as gone", async () => {
  const s = new ChatSession(A);
  s.more = true;
  let pages = 0;
  s.older = async () => { pages++; if (pages === 3) s.msgs.set(ID(50), { id: ID(50), from: ID(2), epoch: 1, t: "far up", at: "2026-01-01T00:00:00Z", edited: false }); return 1; };
  assert.equal(await s.seek(ID(50)), true);
  assert.equal(pages, 3);
  const t = new ChatSession(A);
  t.more = true;
  let n = 0;
  t.older = async () => { n++; if (n === 2) t.more = false; return 0; };
  assert.equal(await t.seek(ID(51)), false);
  assert.ok(t.gone.has(ID(51)), "the whole history was looked through: not available");
  const u = new ChatSession(A);
  u.more = true;
  u.older = async () => 1;
  assert.equal(await u.seek(ID(52), 5), false);
  assert.ok(!u.gone.has(ID(52)), "stopped early (page limit): not called gone, the quote keeps its line");
});
ok("an edit keeps what the message replies to", async () => {
  const s = new ChatSession(A);
  const raw = await S.newSquadKey();
  s.keys.set(1, raw);
  s.msgs.set(ID(60), { id: ID(60), from: A.memberId, epoch: 1, t: "Agreed", q: { id: ID(50), w: ID(2), s: "Gym at 8?" }, at: "2026-11-16T10:00:00Z", edited: false });
  let sent = "";
  (s.api as { edit: (id: string, ct: string) => Promise<unknown> }).edit = async (_id, ct) => { sent = ct; return { ok: true }; };
  await s.edit(ID(60), "Agreed, see you");
  assert.deepEqual(await openMessage(raw, SQ, 1, A.memberId, ID(60), sent), { t: "Agreed, see you", q: { id: ID(50), w: ID(2), s: "Gym at 8?" } });
  assert.equal(s.msgs.get(ID(60))!.q!.id, ID(50));
});
ok("deleting your message marks it gone (a reply's quote then says not available)", async () => {
  const s = new ChatSession(A);
  s.msgs.set(ID(60), { id: ID(60), from: A.memberId, epoch: 1, t: "x", at: "2026-11-16T10:00:00Z", edited: false });
  (s.api as { del: (id: string) => Promise<unknown> }).del = async () => ({ ok: true });
  await s.del(ID(60));
  assert.ok(s.gone.has(ID(60)));
});
ok("the chat screen: Reply on hover and in the right click menu, Esc drops a reply, the quote goes to the original", () => {
  const chat = read("src/views/GSquadChat.tsx"), comp = read("src/views/GSquadComposer.tsx");
  assert.ok(chat.includes('className="gc-rp"') && chat.includes('className="gc-menu"') && chat.includes("Original message not available"));
  assert.ok(chat.includes('chatOp({ op: "seek", id })'));
  assert.ok(comp.includes("useBack(!!reply && !editing, stopReply)"));
});

// ---------- members list ----------
ok("the gym time is sealed to the squad and bound to its member", async () => {
  const at = "2026-11-16T10:00:00.000Z";
  const p = await sealPresence(A, at);
  assert.equal(p.sg, 1);
  assert.deepEqual(await openPresence(A, A.memberId, p.st, p.sg), { g: at });
  assert.equal(await openPresence(A, ID(2), p.st, p.sg), null, "copied onto another member's row: does not open");
  assert.equal(await openPresence(A, A.memberId, p.st, 2), null, "a gen you do not hold");
  assert.equal(await openPresence(A, A.memberId, null, 1), null);
});
ok("The developer's rules: at the gym, online in the last 15 minutes, last seen, or nothing", () => {
  const now = Date.parse("2026-11-16T12:00:00Z");
  const ago = (min: number) => new Date(now - min * 60_000).toISOString();
  const st = (p: Partial<Parameters<typeof memberStatus>[0]>) => memberStatus({ shares: true, working: false, known: true, ...p }, now).label;
  assert.equal(st({ seen: ago(2), gym: ago(1) }), "At the gym");
  assert.equal(st({ seen: ago(14) }), "Online");
  assert.equal(st({ seen: ago(16) }), "Last seen 16 min ago");
  assert.equal(st({ seen: ago(125) }), "Last seen 2 h ago");
  assert.equal(st({ seen: ago(60 * 30) }), "Last seen yesterday");
  assert.equal(st({ seen: ago(60 * 24 * 3) }), "Last seen 3 days ago");
  assert.equal(st({ seen: ago(60 * 24 * 20) }), "", "older than 14 days: nothing");
  assert.equal(st({ seen: ago(40), gym: ago(20) }), "Last seen 40 min ago", "a gym time older than 15 minutes is over");
  assert.equal(st({ shares: false, seen: ago(1), gym: ago(1) }), "", "does not share working: no status, never a guess");
  assert.equal(st({ seen: null }), "");
  assert.equal(st({ known: false, working: true }), "Online", "an older hub: working means online");
  assert.equal(st({ known: false, working: false }), "", "an older hub: not working tells nothing");
  assert.equal(agoText(30_000), "1 min ago");
});
ok("the hub's list is checked: ids, times, sizes", () => {
  assert.deepEqual(cleanSeenRows([{ id: ID(2).toUpperCase(), at: "2026-11-16T10:00:00Z", ct: "abc", gen: 2 }, { id: "x" }, { id: ID(3), at: "nope", ct: "y".repeat(700), gen: "1" }]), [
    { id: ID(2), at: "2026-11-16T10:00:00.000Z", ct: "abc", gen: 2 }, { id: ID(3), at: null, ct: null, gen: null }]);
  assert.deepEqual(cleanSeenRows("nope"), []);
});
ok("the list order: you, at the gym, online, last seen newest, then the rest by name", () => {
  const now = Date.parse("2026-11-16T12:00:00Z");
  const row = (name: string, me: boolean, seen: string | null, gym: string | null = null) => ({ me, name, seen, st: memberStatus({ shares: true, seen, gym, working: false, known: true }, now) });
  const list = [row("Zed", false, null), row("Bo", false, "2026-11-16T09:00:00Z"), row("Cy", false, "2026-11-16T11:55:00Z"), row("Al", false, "2026-11-16T11:00:00Z"),
    row("Di", false, "2026-11-16T11:58:00Z", "2026-11-16T11:58:00Z"), row("Me", true, "2026-11-10T00:00:00Z")].sort(statusOrder);
  assert.deepEqual(list.map((r) => r.name), ["Me", "Di", "Cy", "Al", "Bo", "Zed"]);
});
ok("the beat sends the gym only sealed, and only while you share Fitness; switching working off tells the hub", () => {
  const eng = read("src/squad/engine.ts"), hub = read("supabase/hub/functions/squad/index.ts"), sql = read("supabase/hub/migrations/presence_001_seen.sql");
  assert.ok(eng.includes('shareOn(share(), "fitness") && (gymScreen() || workoutOpen())'));
  assert.ok(eng.includes("await sealPresence(rec, new Date().toISOString())"));
  assert.ok(eng.includes("if (!o.on) void away();"));
  assert.ok(hub.includes('case "away"') && hub.includes("presence_off: true") && hub.includes('pq.gt("presence_at", at("p")!)'));
  assert.ok(!/case "away"[^}]*last_beat: null/.test(hub), "away never clears last_beat (auto_join reads it)");
  assert.ok(hub.includes("if (r.error) must(await db.from(\"squad_members\").update({ last_beat: now })"), "a beat still counts before the migration");
  assert.ok(sql.includes("presence_off boolean not null default false") && !/squad_members_heal/.test(sql.replace(/--.*$/gm, "")));
});
ok("the members button keeps the working line as its hover line, and Esc closes the list", () => {
  const v = read("src/views/GSquadMembers.tsx");
  assert.ok(v.includes("data-tip-line={workingLine(v.count)}"));
  assert.ok(v.includes("useBack(true, () => closeRef.current())"));
});

// ---------- Past boards ----------
const DEC = { month: "2025-12", title: "December 2025 Leaderboard - Revenue in USD",
  ranked: [{ place: 1, names: ["Robin"], usd: 3470.66 }, { place: 5, names: ["Sam", "Kim"], usd: 950, note: "joint" }, { names: ["Pat"], usd: 12 }],
  notes: [{ names: ["Nova"], usd: null, note: "Exempt" }],
  gulagTitle: "Gulag", gulag: [{ names: ["Lee"], usd: 234.85 }, { name: "Jo", usd: null }], line: "The rest did not post." };
ok("a month is checked: names, amounts, notes, no long dashes, no HTML", () => {
  const m = cleanPastMonth({ ...DEC, title: "December \u2014 <b>2025</b>" })!;
  assert.equal(m.title, "December - b2025/b");
  assert.deepEqual(m.ranked[1], { place: 5, names: ["Sam", "Kim"], usd: 950, note: "joint" });
  assert.deepEqual(m.ranked[2], { place: 3, names: ["Pat"], usd: 12 }, "no place given: its place in the order");
  assert.deepEqual(m.notes, [{ place: null, names: ["Nova"], usd: null, note: "Exempt" }], "notes have no place");
  assert.deepEqual(m.gulag[1], { place: null, names: ["Jo"], usd: null }, "one name may be given as name");
  assert.equal(cleanPastMonth({ month: "2025-13", ranked: DEC.ranked }), null);
  assert.equal(cleanPastMonth({ month: "2025-12", ranked: [], gulag: [] }), null);
  assert.equal(cleanPastMonth({ ...DEC, gulag: [{ names: ["X"], place: 3 }] })!.gulag[0].place, null, "no places in the Gulag");
});
ok("a file of months: newest first, one per month; the checker names every problem", () => {
  const list = cleanPastMonths({ months: [DEC, { ...DEC, month: "2026-07" }, { ...DEC, month: "2026-01" }] });
  assert.deepEqual(list.map((m) => m.month), ["2026-07", "2026-01", "2025-12"]);
  assert.deepEqual(pastProblems([DEC]), []);
  const bad = pastProblems([{ ...DEC, title: "A \u2013 B" }, DEC, { ...DEC, month: "2026-02", ranked: [{ names: [] }, ...DEC.ranked] }, { month: "x" }]);
  assert.ok(bad.some((p) => /long dash/.test(p)));
  assert.ok(bad.some((p) => /2025-12: twice/.test(p)));
  assert.ok(bad.some((p) => /2026-02: 1 ranked entry without a name/.test(p)));
  assert.ok(bad.some((p) => /^x: not a month/.test(p)));
  assert.deepEqual(pastProblems({ nope: 1 }), ["the file is not a list of months (or { \"months\": [...] })"]);
});
ok("the manager's file shape reads as is: name, amount, currency, notes, gulagLine, lineNote, places by order", () => {
  const file = { approved: "x", currency: "USD", months: [{ month: "2026-06", title: "Money In in USD", lineNote: "First month the line was $2K",
    ranked: [{ name: "Robin", amount: 12222 }, { name: "Sam and Kim", amount: 950, note: "joint" }],
    notes: [{ name: "Nova", note: "exempt" }],
    gulag: [{ name: "Lee", amount: 400, currency: "EUR" }, { name: "Jo", amount: 0 }, { name: "Max" }], gulagLine: "The rest didn't submit" }] };
  assert.deepEqual(pastProblems(file), []);
  const [m] = cleanPastMonths(file);
  assert.deepEqual(m.ranked.map((e) => [e.place, e.names[0], e.usd]), [[1, "Robin", 12222], [2, "Sam and Kim", 950]]);
  assert.deepEqual(m.notes, [{ place: null, names: ["Nova"], usd: null, note: "exempt" }]);
  assert.deepEqual(m.gulag[0], { place: null, names: ["Lee"], usd: null, amount: "400 EUR" });
  assert.equal(m.gulag[1].usd, 0);
  assert.equal(m.line, "The rest didn't submit");
  assert.equal(m.lineNote, "First month the line was $2K");
  assert.ok(pastProblems({ months: [{ ...file.months[0], extra: "words" }] }).some((p) => /"extra" is not a field/.test(p)), "a field the screen would not show is refused");
});
ok("The developer's approved months (gsquad-past-boards.json) go in word for word: every name, note and number, the EUR stays EUR", () => {
  const raw = JSON.parse(read("gsquad-past-boards.json")) as { months: Record<string, unknown>[] };
  assert.deepEqual(pastProblems(raw), []);
  const months = cleanPastMonths(raw);
  assert.equal(months.length, 8);
  assert.deepEqual(months.map((m) => m.month).sort(), ["2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]);
  for (const r of raw.months) {
    const m = months.find((x) => x.month === r.month)!;
    assert.equal(m.title ?? null, (r.title as string | undefined) ?? null);
    assert.equal(m.line ?? null, ((r.gulagLine ?? r.line) as string | undefined) ?? null);
    assert.equal(m.lineNote ?? null, (r.lineNote as string | undefined) ?? null);
    for (const k of ["ranked", "notes", "gulag"] as const) {
      const src = (r[k] ?? []) as Record<string, unknown>[], got = m[k] ?? [];
      assert.equal(got.length, src.length, `${r.month} ${k}`);
      src.forEach((e, i) => {
        assert.deepEqual(got[i].names, [e.name], `${r.month} ${k} #${i + 1}: the name exactly`);
        assert.equal(got[i].note ?? null, (e.note as string | undefined) ?? null);
        if (typeof e.amount === "number" && e.currency && e.currency !== "USD") assert.deepEqual([got[i].usd, got[i].amount], [null, `${e.amount} ${e.currency}`], "never converted");
        else assert.equal(got[i].usd, typeof e.amount === "number" ? e.amount : null);
        if (k === "ranked") assert.equal(got[i].place, i + 1);
      });
    }
  }
  assert.ok(months.find((m) => m.month === "2025-12")!.ranked.some((e) => e.names.length === 1 && e.names[0] === "The developer and Bakra Robin" && e.usd === 950 && e.note === "joint"), "one joint entry");
  assert.ok(months.find((m) => m.month === "2026-06")!.gulag.some((e) => e.names[0] === "Fabio Gullì" && e.amount === "400 EUR" && e.usd === null));
  assert.ok(read("scripts/open-source.mjs").includes("/^web\\/gsquad-past-boards\\.json$/"), "never in the public core");
});
ok("words for the screen", () => {
  assert.equal(monthLabel("2025-12"), "December 2025");
  assert.equal(monthShort("2026-07"), "Jul 26");
  assert.equal(fmtUsd(3470.66), "$3,470.66");
  assert.equal(fmtUsd(950), "$950");
});
ok("the owner's sync: sealed, only what changed, never a delete for a month the vault does not mention", async () => {
  const doc = cleanPastDoc({ month: "2025-12", data: DEC })!;
  const first = await planPastSync(A, [doc], new Map());
  assert.equal(first.put.length, 1);
  assert.ok(!first.put[0].ct.includes("Robin"));
  assert.deepEqual(await openPast(A, "2025-12", first.put[0].ct, 1), cleanPastMonth(DEC));
  assert.equal(await openPast(A, "2026-01", first.put[0].ct, 1), null, "moved to another month: does not open");
  const again = await planPastSync(A, [doc], new Map([["2025-12", first.put[0].fp]]));
  assert.deepEqual(again, { put: [], del: [] });
  const gone = await planPastSync(A, [{ month: "2025-12", removed: true }, { month: "2026-01", removed: true }], new Map([["2025-12", "f".repeat(32)], ["2026-03", "e".repeat(32)]]));
  assert.deepEqual(gone, { put: [], del: ["2025-12"] });
  assert.equal(cleanPastDoc({ month: "2025-12", data: { ...DEC, month: "2026-01" } }), null, "a record's month and its data agree");
});
ok("the Tab list's board copy carries the months, checked", () => {
  const v = cleanBoardView({ rules: {}, money: {}, tasks: {}, screen: [], days: [], mine: {}, due: null, loaded: true, past: [DEC, { month: "bad" }] })!;
  assert.equal(v.past!.length, 1);
  assert.equal(v.past![0].ranked[0].usd, 3470.66);
});
ok("Past boards ship empty and only the owner writes them", () => {
  const fn = read("supabase/hub/functions/board/index.ts"), board = read("src/squad/board.ts"), view = read("src/views/GSquadBoard.tsx"), app = read("src/App.tsx");
  assert.ok(fn.includes('if (sq.created_by !== me.id) throw new Fail(403, "owner only")'));
  assert.ok(board.includes("!squadView().creator") && board.includes("if (!list.length) return;"));
  assert.ok(view.includes("{!!b.past?.length && <PastBoards past={b.past} />}"), "nothing shows while there are none");
  assert.ok(app.includes('if (o.op === "sqPastBoards") {') && /sqPastBoards"[\s\S]{0,400}if \(!vaultStore\.get\(\)\.red\) continue;/.test(app), "only the developer's vault takes the step");
});
ok("no long dashes in anything 1.64 added", () => {
  for (const f of ["src/core/squadpast.ts", "src/core/squadpresence.ts", "src/squad/presence.ts", "src/views/GSquadMembers.tsx", "src/views/gsmembers.css", "scripts/gsquad-past.ts",
    "supabase/hub/migrations/presence_001_seen.sql", "supabase/hub/migrations/board_002_past.sql", "src/views/GSquadChat.tsx", "src/views/GSquadComposer.tsx", "src/views/GSquadBoard.tsx",
    "src/views/gschat.css", "src/views/gsquadboard.css", "src/squad/engine.ts", "src/squad/board.ts", "src/squad/chatengine.ts", "src/squad/chatflows.ts", "src/core/squadchat.ts",
    "supabase/hub/functions/squad/index.ts", "supabase/hub/functions/board/index.ts"]) {
    assert.ok(!/[\u2013\u2014]/.test(read(f)), `a long dash in ${f}`);
  }
});

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log(`ok   ${name}`); }
  catch (e) { failed++; console.error(`FAIL ${name}\n     ${(e as Error).message}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
if (failed) process.exit(1);
