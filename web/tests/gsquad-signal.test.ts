// Run: node --experimental-strip-types tests/gsquad-signal.test.ts
// G Squad Signal look (PS 1.63): reactions (folding, taking back, travelling sealed through a fake hub, old clients skipping
// them), emoji only messages, the emoji set and its search, GIF messages and the GIPHY address allow list, the hub gif
// function's input checks (a FAKE fetch, never GIPHY), the Tab list's ops, popup placement and the feature registry.
// Names are fictional.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as S from "../src/core/squadcrypto.ts";
import { cleanBody, cleanEmoji, cleanReact, cleanText, openMessage, sealMessage } from "../src/core/squadchat.ts";
import { emojiOnly, emojiSize, foldReactions, insertAt, placeIn, QUICK_EMOJI, reactPlan, whoLine, type ReactEvent } from "../src/squad/chatreact.ts";
import { allEmoji, EMOJI_GROUPS, pushRecent, searchEmoji } from "../src/squad/emoji.ts";
import { cleanGifItems, cleanGifQuery, gifButton, gifMemory, gifUrl, parseGifMessage, stillOf, readLoadGifs, saveLoadGifs, GIF_NO_MS, GIF_YES_MS } from "../src/squad/chatgif.ts";
import * as G from "../supabase/hub/functions/gif/logic.ts";
import { cleanChatOp, cleanChatView, EMPTY_CHAT } from "../src/squad/chatview.ts";
import { ChatSession } from "../src/squad/chatflows.ts";
import { gifApi } from "../src/squad/gifhub.ts";
import type { SquadRec } from "../src/core/squadrec.ts";

const tests: [string, () => Promise<void> | void][] = [];
const ok = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const SQ = "0b6f1a52-7c1d-4b0e-9a3c-1f2e3d4c5b6a";
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ev = (n: number, from: number, to: number, e: string, at = `2026-11-15T10:00:0${n}.000000+00:00`): ReactEvent => ({ id: ID(100 + n), from: ID(from), to: ID(to), e, at });
const known = (...ids: number[]) => (id: string) => ids.some((n) => ID(n) === id);

// ---------- reactions: folding ----------
ok("reactions fold: counts, one per person per emoji, yours lit, order of first use", () => {
  const m = foldReactions([ev(1, 1, 10, "👍"), ev(2, 2, 10, "👍"), ev(3, 2, 10, "❤️"), ev(4, 1, 10, "👍")], known(10), ID(1), (id) => (id === ID(2) ? "Sam" : "Alex"));
  const pills = m.get(ID(10))!;
  assert.deepEqual(pills.map((p) => [p.e, p.n, p.mine]), [["👍", 2, true], ["❤️", 1, false]], "the second 👍 from the same person counts once");
  assert.deepEqual(pills[0].who, ["You", "Sam"]);
  assert.equal(whoLine(pills[0].who), "You and Sam");
  assert.equal(whoLine(["A", "B", "C"]), "A, B and C");
  assert.equal(whoLine([]), "");
});
ok("a reaction on a message that is not there is ignored; one person may use several emoji", () => {
  const m = foldReactions([ev(1, 1, 99, "👍"), ev(2, 1, 10, "👍"), ev(3, 1, 10, "😂")], known(10), ID(1));
  assert.equal(m.has(ID(99)), false);
  assert.deepEqual(m.get(ID(10))!.map((p) => p.e), ["👍", "😂"]);
  assert.equal(foldReactions([], known(10), ID(1)).size, 0);
});
ok("taking one back: the plan names your rows, then the fold drops it; a stranger's is never yours", () => {
  const events = [ev(1, 1, 10, "👍"), ev(2, 2, 10, "👍")];
  assert.deepEqual(reactPlan(events, ID(1), ID(10), "👍"), { remove: [ID(101)] });
  assert.deepEqual(reactPlan(events, ID(1), ID(10), "❤️"), { add: true });
  assert.deepEqual(reactPlan([ev(2, 2, 10, "👍")], ID(1), ID(10), "👍"), { add: true });
  const after = foldReactions(events.filter((x) => x.id !== ID(101)), known(10), ID(1));
  assert.deepEqual(after.get(ID(10))!.map((p) => [p.n, p.mine]), [[1, false]]);
  const dup = [ev(1, 1, 10, "👍"), ev(5, 1, 10, "👍")];
  assert.deepEqual((reactPlan(dup, ID(1), ID(10), "👍") as { remove: string[] }).remove.sort(), [ID(101), ID(105)], "a doubled row is taken back together");
});
ok("same time stamps fold the same on every device (ordered by id)", () => {
  const a = ev(1, 1, 10, "👍", "2026-11-15T10:00:00.000000+00:00"), b = ev(2, 2, 10, "❤️", "2026-11-15T10:00:00.000000+00:00");
  assert.deepEqual(foldReactions([a, b], known(10), ID(9)).get(ID(10))!.map((p) => p.e), foldReactions([b, a], known(10), ID(9)).get(ID(10))!.map((p) => p.e));
});
ok("six quick emoji, all clean single emoji", () => {
  assert.equal(QUICK_EMOJI.length, 6);
  for (const e of QUICK_EMOJI) assert.equal(cleanEmoji(e), e);
});

// ---------- emoji only ----------
ok("emoji only messages are detected and sized", () => {
  assert.equal(emojiOnly("😀"), 1);
  assert.equal(emojiOnly("  😀😂😍 "), 3);
  assert.equal(emojiOnly("👍🏽"), 1, "a skin tone is one emoji");
  assert.equal(emojiOnly("🇸🇰"), 1, "a flag is one");
  assert.equal(emojiOnly("👨‍👩‍👧"), 1, "a joined family is one");
  assert.equal(emojiOnly("1️⃣"), 1, "a keycap is one");
  assert.equal(emojiOnly("❤️ 🔥"), 2);
  for (const t of ["", "   ", "hi 😀", "😀 hi", "1", "#", "2026", "😀!", "a", "😀😀😀😀😀😀😀"]) assert.equal(emojiOnly(t), 0, JSON.stringify(t));
  assert.equal(emojiOnly("😀".repeat(40)), 0, "a wall of emoji is a normal message");
  assert.deepEqual([emojiSize(1), emojiSize(2), emojiSize(3), emojiSize(5), emojiSize(0)], ["xl", "l", "l", "m", ""]);
});

// ---------- the emoji set ----------
ok("the emoji set: categories, every entry a clean emoji with a name, no repeats", () => {
  assert.ok(EMOJI_GROUPS.length >= 8);
  const all = allEmoji();
  assert.ok(all.length > 300);
  for (const it of all) { assert.ok(cleanEmoji(it.e), `clean ${it.e}`); assert.ok(it.name.length > 1, it.e); }
  const seen = new Set<string>();
  for (const it of all) { assert.ok(!seen.has(it.e), `repeat ${it.e}`); seen.add(it.e); }
  for (const e of QUICK_EMOJI) assert.ok(seen.has(e), `quick ${e} is in the set`);
});
ok("picker search by name: prefix words, extra words, ranking, empty and nonsense", () => {
  assert.ok(searchEmoji("pizza").some((x) => x.e === "🍕"));
  assert.equal(searchEmoji("thumbs up")[0].e, "👍");
  assert.ok(searchEmoji("lol").some((x) => x.e === "😂"), "extra words find it");
  assert.ok(searchEmoji("HEART").length >= 5, "case does not matter");
  assert.equal(searchEmoji("   ").length, 0);
  assert.equal(searchEmoji("xqzvw").length, 0);
  assert.equal(searchEmoji("<script>").length, 0);
  assert.ok(searchEmoji("a").length <= 64, "capped");
  assert.equal(searchEmoji("red heart")[0].e, "❤️");
  assert.deepEqual(pushRecent(["a", "b", "c"], "b"), ["b", "a", "c"]);
  assert.equal(pushRecent(Array.from({ length: 30 }, (_, i) => `x${i}`), "n").length, 18);
});
ok("insert at the cursor and respect the limit", () => {
  assert.deepEqual(insertAt("hello", 5, 5, "😀", 2000), { text: "hello😀", at: 7 });
  assert.deepEqual(insertAt("hello", 1, 3, "😀", 2000), { text: "h😀lo", at: 3 });
  assert.deepEqual(insertAt("abc", 99, -5, "😀", 2000), { text: "abc😀", at: 5 });
  assert.deepEqual(insertAt("abcd", 2, 2, "😀", 5), { text: "abcd", at: 2 }, "never past the limit");
});
ok("popup placement stays inside the chat panel", () => {
  const box = { left: 100, top: 50, width: 600, height: 500 };
  assert.deepEqual(placeIn(box, { left: 300, top: 300, width: 30, height: 30 }, { width: 300, height: 300 }), { left: 65, top: 8 });
  const nearTop = placeIn(box, { left: 120, top: 60, width: 30, height: 30 }, { width: 300, height: 300 });
  assert.ok(nearTop.top >= 8 && nearTop.top + 300 <= 500 - 8, "flips below when there is no room above");
  assert.ok(nearTop.left >= 8, "not past the left edge");
  const right = placeIn(box, { left: 690, top: 300, width: 30, height: 30 }, { width: 300, height: 300 });
  assert.ok(right.left + 300 <= 600 - 8, "not past the right edge");
  const tiny = placeIn({ left: 0, top: 0, width: 200, height: 200 }, { left: 10, top: 10, width: 10, height: 10 }, { width: 300, height: 300 });
  assert.ok(tiny.left >= 0 && tiny.top >= 0);
});

// ---------- sealed travel ----------
ok("a reaction body is sealed like a message, opens only under its own author, period and id", async () => {
  const raw = await S.newSquadKey();
  const body = { t: "", r: { to: ID(10), e: "👍" } };
  const ct = await sealMessage(raw, SQ, 1, ID(1), ID(50), body);
  assert.deepEqual(await openMessage(raw, SQ, 1, ID(1), ID(50), ct), body);
  assert.equal(await openMessage(raw, SQ, 1, ID(2), ID(50), ct), null, "another author");
  assert.equal(await openMessage(raw, SQ, 2, ID(1), ID(50), ct), null, "another period");
  assert.equal(await openMessage(raw, SQ, 1, ID(1), ID(51), ct), null, "another id");
  await assert.rejects(() => sealMessage(raw, SQ, 1, ID(1), ID(50), { t: "", r: { to: "nope", e: "👍" } }), /Empty message/);
});
ok("reaction bodies are checked: one emoji only, a real message id", () => {
  assert.deepEqual(cleanBody({ t: "ignored", r: { to: ID(10).toUpperCase(), e: "👍" } }), { t: "", r: { to: ID(10), e: "👍" } });
  for (const r of [{ to: ID(10), e: "hi" }, { to: ID(10), e: "👍👍" }, { to: ID(10), e: "" }, { to: "x", e: "👍" }, { to: ID(10) }, { e: "👍" }, null, "👍", { to: ID(10), e: "<b>" }]) {
    assert.equal(cleanReact(r), undefined, JSON.stringify(r));
  }
  assert.equal(cleanBody({ t: "", r: { to: ID(10), e: "no" } }), null, "no words and no valid reaction is nothing");
  assert.deepEqual(cleanBody({ t: "hello" }), { t: "hello" }, "a plain message is untouched");
  assert.equal(cleanEmoji("👍🏽"), "👍🏽"); assert.equal(cleanEmoji("a👍"), ""); assert.equal(cleanEmoji(7), ""); assert.equal(cleanEmoji("x".repeat(100)), "");
});
ok("a client from before 1.63 finds no words in a reaction row and skips it", () => {
  // The old rule (core/squadchat.ts before 1.63): a body with no words is nothing.
  const oldCleanBody = (b: { t?: unknown }) => (cleanText(b.t) ? { t: cleanText(b.t) } : null);
  assert.equal(oldCleanBody({ t: "", r: { to: ID(10), e: "👍" } }), null);
});

// A fake chat hub: rows in memory, the acts a reaction needs (c_post, c_del, c_pull, c_read).
function fakeHub() {
  const rows: { id: string; member_id: string; epoch: number; ct: string; edited: boolean; deleted: boolean; created_at: string; updated_at: string }[] = [];
  let tick = 0;
  const calls: string[] = [];
  const fetcher = async (_u: string, init: RequestInit) => {
    const req = JSON.parse(String(init.body)) as { act: string; member: string; args: Record<string, unknown> };
    calls.push(req.act);
    const a = req.args;
    const at = () => `2026-11-15T10:00:${String(++tick).padStart(2, "0")}.000000+00:00`;
    let out: unknown = { ok: true };
    if (req.act === "c_post") { const t = at(); rows.push({ id: String(a.id), member_id: req.member, epoch: Number(a.epoch), ct: String(a.ct), edited: false, deleted: false, created_at: t, updated_at: t }); out = { at: t }; }
    else if (req.act === "c_del") { const r = rows.find((x) => x.id === a.id && x.member_id === req.member); if (r) { r.deleted = true; r.ct = ""; r.updated_at = at(); } }
    else if (req.act === "c_pull") out = { now: "2026-11-15T11:00:00.000000+00:00", status: { epoch: 1, rot: false, u: 0, last: null, read: "", votes: [], give: [] }, drops: [], members: [], msgs: rows.map((r) => ({ ...r })), more: false };
    return new Response(JSON.stringify(out), { status: 200 });
  };
  return { rows, calls, fetcher };
}
async function rec(n: number, me: string): Promise<SquadRec> {
  return { v: 1, squadId: SQ, memberId: ID(n), me, keys: [], sign: await S.newSignPair(), box: await S.newBoxPair(), secret: S.newSecret(), joinedAt: new Date().toISOString() };
}
const ready = (s: ChatSession, key: string) => { s.keys.set(1, key); s.status = { epoch: 1, rot: false, u: 0, last: null, read: "", votes: [], give: [] }; };

ok("two people react through a fake hub: it travels sealed, folds the same for both, and taking it back deletes the row", async () => {
  const hub = fakeHub();
  const key = await S.newSquadKey();
  const alex = new ChatSession(await rec(1, "Alex"), hub.fetcher), sam = new ChatSession(await rec(2, "Sam"), hub.fetcher);
  ready(alex, key); ready(sam, key);
  const m = (await alex.send({ t: "Gym at six?" }))!;
  await sam.pull();
  let local = 0;
  await sam.react(m.id, "👍", () => local++);
  await alex.react(m.id, "👍");
  await alex.react(m.id, "🔥");
  assert.equal(local, 1, "the screen heard before the hub answered");
  assert.ok(!hub.rows.some((r) => r.ct.includes("👍")), "the hub holds no readable emoji");
  assert.equal(hub.rows.length, 4);
  await sam.pull(); await alex.pull();
  const fold = (s: ChatSession) => foldReactions([...s.reacts.values()], (id) => s.msgs.has(id), s.rec.memberId, (id) => (id === ID(1) ? "Alex" : "Sam")).get(m.id)!.map((p) => `${p.e}${p.n}${p.mine ? "*" : ""}`);
  assert.deepEqual(fold(sam), ["👍2*", "🔥1"]);
  assert.deepEqual(fold(alex), ["👍2*", "🔥1*"]);
  assert.equal(sam.list().length, 1, "reactions never show as messages");
  // Sam takes his 👍 back: his row is deleted, and the fold drops it for both.
  await sam.react(m.id, "👍");
  assert.equal(sam.reacts.size, 2);
  await alex.pull();
  assert.deepEqual(fold(alex), ["👍1*", "🔥1*"]);
  // A reaction on a message that is not loaded does nothing and calls nothing.
  const before = hub.calls.length;
  await sam.react(ID(77), "👍");
  assert.equal(hub.calls.length, before);
});
ok("a refused reaction puts everything back and says so", async () => {
  const hub = fakeHub();
  const key = await S.newSquadKey();
  const alex = new ChatSession(await rec(1, "Alex"), hub.fetcher);
  ready(alex, key);
  const m = (await alex.send({ t: "hi" }))!;
  const bad = new ChatSession(await rec(1, "Alex"), async () => new Response(JSON.stringify({ error: "slow" }), { status: 429 }));
  ready(bad, key); bad.msgs.set(m.id, m);
  await assert.rejects(() => bad.react(m.id, "👍"));
  assert.equal(bad.reacts.size, 0, "the optimistic pill is gone again");
  await alex.react(m.id, "👍");
  const bad2 = new ChatSession(await rec(1, "Alex"), async (_u, init) => (JSON.parse(String(init.body)).act === "c_del" ? new Response("{}", { status: 500 }) : hub.fetcher(_u, init)));
  ready(bad2, key); await bad2.pull(); bad2.msgs.set(m.id, m);
  const have = bad2.reacts.size;
  await assert.rejects(() => bad2.react(m.id, "👍"));
  assert.equal(bad2.reacts.size, have, "a failed take back keeps the reaction");
});
ok("reactions count as read, so the hub's unread never sticks", async () => {
  const hub = fakeHub();
  const key = await S.newSquadKey();
  const alex = new ChatSession(await rec(1, "Alex"), hub.fetcher);
  ready(alex, key);
  const m = (await alex.send({ t: "hi" }))!;
  alex.reacts.set(ID(60), { id: ID(60), from: ID(2), to: m.id, e: "👍", at: "2026-11-15T10:30:00.000000+00:00" });
  await alex.markRead();
  assert.ok(hub.calls.includes("c_read"), "read up to the reaction, the newest row");
});

// ---------- GIFs ----------
const AT = String.fromCharCode(64);   // an at sign, written this way so no address like text sits in the file
const OKGIF = "https://media2.giphy.com/media/abc123XYZ/200w.gif";
ok("GIF addresses: only https GIPHY media hosts, plain picture paths", () => {
  for (const u of [OKGIF, "https://media.giphy.com/media/abc/giphy.gif", "https://media0.giphy.com/media/v1.Y2lkPTc/200w.webp?cid=ab12&ep=v1_gifs&rid=200w.gif&ct=g", "https://i.giphy.com/media/abc/giphy.gif", "https://media4.giphy.com/media/a/b/giphy.gif"]) assert.ok(gifUrl(u), u);
  for (const u of ["http://media.giphy.com/media/abc/giphy.gif", "https://evil.com/media/abc/giphy.gif", "https://giphy.com/media/abc/giphy.gif", "https://media.giphy.com.evil.com/media/a/giphy.gif",
    `https://media.giphy.com${AT}evil.com/media/a/giphy.gif`, `https://user:pw${AT}media.giphy.com/media/a/giphy.gif`, "https://media.giphy.com:8443/media/a/giphy.gif", "https://media99.giphy.com/media/a/giphy.gif",
    "https://media.giphy.com/media/a/giphy.html", "https://media.giphy.com/media/a/giphy.svg", "https://media.giphy.com/other/a/giphy.gif", "https://media.giphy.com/media/a/giphy.gif#x",
    "https://media.giphy.com/media/a/giphy.gif?x=a b", "javascript:alert(1)", "data:image/gif;base64,AAAA", "//media.giphy.com/media/a/giphy.gif", "https://media.giphy.com/media/../x.gif",
    "https://media.giphy.com/media/a/giphy.gif extra", "", "https://media.giphy.com/" + "a/".repeat(300) + "g.gif"]) assert.equal(gifUrl(u), null, u);
  assert.equal(gifUrl(5), null); assert.equal(gifUrl(null), null);
});
ok("a GIF message is a text that is exactly one allowed address", () => {
  assert.equal(parseGifMessage(OKGIF), OKGIF);
  assert.equal(parseGifMessage(`  ${OKGIF}\n`), OKGIF);
  assert.equal(parseGifMessage(`look ${OKGIF}`), null, "a link inside words stays text");
  assert.equal(parseGifMessage(`${OKGIF} ${OKGIF}`), null);
  assert.equal(parseGifMessage("https://example.com/cat.gif"), null);
  assert.equal(parseGifMessage("hello"), null);
});
ok("the still picture of a GIF", () => {
  assert.equal(stillOf("https://media2.giphy.com/media/abc/200w.gif"), "https://media2.giphy.com/media/abc/200w_s.gif");
  assert.equal(stillOf("https://media2.giphy.com/media/abc/giphy.gif?cid=1"), "https://media2.giphy.com/media/abc/giphy_s.gif?cid=1");
  assert.equal(stillOf("https://media2.giphy.com/media/abc/200w.webp"), "https://media2.giphy.com/media/abc/200w.webp");
  assert.equal(stillOf("https://evil.com/a.gif"), "https://evil.com/a.gif", "never turns something unknown into an allowed address");
});
ok("the picker's list is cleaned: bad addresses dropped, sizes sane, capped", () => {
  const items = cleanGifItems([
    { id: "a1", url: OKGIF, still: "https://media2.giphy.com/media/abc123XYZ/200w_s.gif", w: 200, h: 150, title: "cat\u0000 dance" },
    { id: "a2", url: "https://evil.com/x.gif", still: OKGIF, w: 1, h: 1, title: "" },
    { id: "a3", url: OKGIF, still: "https://evil.com/x.gif", w: 99999, h: "x", title: "x".repeat(500) },
    { id: "bad id!", url: OKGIF }, { url: OKGIF }, null, "x", 5,
  ]);
  assert.deepEqual(items.map((x) => x.id), ["a1", "a3"]);
  assert.equal(items[0].title, "cat  dance");
  assert.equal(items[1].still, OKGIF, "a bad still falls back to the GIF");
  assert.deepEqual([items[1].w, items[1].h], [200, 200]);
  assert.equal(items[1].title.length, 80);
  assert.equal(cleanGifItems(Array.from({ length: 100 }, (_, i) => ({ id: `g${i}`, url: OKGIF }))).length, 30);
  assert.deepEqual(cleanGifItems("nope"), []);
});
ok("picker search text is cleaned", () => {
  assert.equal(cleanGifQuery("  cat \n\t dance  "), "cat dance");
  assert.equal(cleanGifQuery("x".repeat(200)).length, 60);
  assert.equal(cleanGifQuery(5), ""); assert.equal(cleanGifQuery(null), "");
});
ok("the GIF button: only with the feature and a yes from the hub, remembered a week (yes) or 6 hours (no)", () => {
  assert.equal(gifButton(true, true), true);
  assert.equal(gifButton(true, null), false, "not asked yet: hidden");
  assert.equal(gifButton(true, false), false);
  assert.equal(gifButton(false, true), false);
  const now = 1_800_000_000_000;
  assert.equal(gifMemory(JSON.stringify({ on: true, at: now - GIF_YES_MS + 1000 }), now), true);
  assert.equal(gifMemory(JSON.stringify({ on: true, at: now - GIF_YES_MS - 1000 }), now), null, "a yes goes stale after a week");
  assert.equal(gifMemory(JSON.stringify({ on: false, at: now - GIF_NO_MS + 1000 }), now), false);
  assert.equal(gifMemory(JSON.stringify({ on: false, at: now - GIF_NO_MS - 1000 }), now), null, "a no is asked again after 6 hours");
  for (const bad of [null, "", "x", "{}", JSON.stringify({ on: "yes", at: now }), JSON.stringify({ on: true, at: now + 1e9 })]) assert.equal(gifMemory(bad, now), null);
});
ok("Load GIFs: off unless switched on here, and storage trouble never breaks it", () => {
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
  assert.equal(readLoadGifs(store), false, "off by default (GIFs skipped for now)");
  saveLoadGifs(false, store); assert.equal(readLoadGifs(store), false);
  saveLoadGifs(true, store); assert.equal(readLoadGifs(store), true);
  const broken = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); } };
  assert.equal(readLoadGifs(broken), false); saveLoadGifs(false, broken);
  assert.equal(readLoadGifs(null), false);
});

// ---------- the hub gif function (a FAKE GIPHY) ----------
const giphyRow = (id: string, over: Record<string, unknown> = {}) => ({ id, title: `GIF ${id}`, rating: "g", images: {
  fixed_width: { url: `https://media3.giphy.com/media/${id}/200w.gif?cid=x&ct=g`, width: "200", height: "112" },
  fixed_width_still: { url: `https://media3.giphy.com/media/${id}/200w_s.gif?cid=x&ct=g` } }, ...over });
const fake = (body: unknown, status = 200, seen: string[] = []): G.Fetcher => async (u) => { seen.push(u); return { ok: status < 400, status, json: async () => { if (body === "badjson") throw new Error("x"); return body; } }; };

ok("gif function: input checks", () => {
  assert.equal(G.cleanQuery(undefined), ""); assert.equal(G.cleanQuery("  a\u0000  b "), "a b"); assert.equal(G.cleanQuery("x".repeat(500)).length, G.QUERY_MAX);
  for (const q of [5, {}, [], true]) assert.throws(() => G.cleanQuery(q), (e: unknown) => e instanceof G.Fail && e.code === 400);
  assert.equal(G.cleanPos(undefined), 0); assert.equal(G.cleanPos(48), 48); assert.equal(G.cleanPos(400), 400);
  for (const p of [-1, 401, 1.5, "3", NaN, null === undefined ? 0 : {}]) assert.throws(() => G.cleanPos(p), (e: unknown) => e instanceof G.Fail && e.code === 400);
  assert.equal(G.allowed(19), true); assert.equal(G.allowed(20), false);
});
ok("gif function: asks GIPHY with the key, pg-13 at most, search or trending, and shapes the answer", async () => {
  const seen: string[] = [];
  const r = await G.search(fake({ data: [giphyRow("one"), giphyRow("two")], pagination: { offset: 0, count: 2, total_count: 50 } }, 200, seen), "KEY123", { q: " cat dance ", pos: 24 });
  const u = new URL(seen[0]);
  assert.equal(u.hostname, "api.giphy.com"); assert.equal(u.pathname, "/v1/gifs/search");
  assert.equal(u.searchParams.get("api_key"), "KEY123"); assert.equal(u.searchParams.get("rating"), "pg-13");
  assert.equal(u.searchParams.get("q"), "cat dance"); assert.equal(u.searchParams.get("offset"), "24"); assert.equal(u.searchParams.get("limit"), "24");
  assert.equal(r.on, true); assert.equal(r.items.length, 2); assert.equal(r.next, 2);
  assert.deepEqual(Object.keys(r.items[0]).sort(), ["h", "id", "still", "title", "url", "w"], "only what the picker needs");
  assert.equal(r.items[0].still, "https://media3.giphy.com/media/one/200w_s.gif?cid=x&ct=g");
  assert.ok(!JSON.stringify(r).includes("KEY123"), "the key never leaves");
  const t: string[] = [];
  await G.search(fake({ data: [] }, 200, t), "K", {});
  assert.equal(new URL(t[0]).pathname, "/v1/gifs/trending"); assert.equal(new URL(t[0]).searchParams.get("rating"), "pg-13");
});
ok("gif function: odd answers are cut down, never passed on", async () => {
  const r = await G.search(fake({ data: [
    giphyRow("ok1"), giphyRow("r1", { rating: "r" }), giphyRow("pg13", { rating: "PG-13" }),
    giphyRow("evil", { images: { fixed_width: { url: "https://evil.com/a.gif" } } }),
    giphyRow("http", { images: { fixed_width: { url: "http://media.giphy.com/media/x/200w.gif" } } }),
    giphyRow("../bad id"), null, "x", 5, { images: {} }, giphyRow("big", { images: { fixed_width: { url: "https://media.giphy.com/media/b/200w.gif", width: "99999", height: "-4" } } }),
  ], pagination: { offset: 0, count: 11, total_count: 11 } }), "K", { q: "x" });
  assert.deepEqual(r.items.map((x) => x.id), ["ok1", "pg13", "big"]);
  assert.deepEqual([r.items[2].w, r.items[2].h], [200, 200]);
  assert.equal(r.items[2].still, r.items[2].url, "no still falls back to the GIF");
  assert.equal(r.next, null, "the end of the list");
  const many = await G.search(fake({ data: Array.from({ length: 80 }, (_, i) => giphyRow(`g${i}`)) }), "K", {});
  assert.equal(many.items.length, G.PAGE);
  assert.deepEqual((await G.search(fake({}), "K", {})).items, []);
  assert.deepEqual((await G.search(fake(null), "K", {})).items, []);
  assert.deepEqual((await G.search(fake({ data: "x" }), "K", {})).items, []);
});
ok("gif function: failures become plain refusals, and a missing key never calls GIPHY", async () => {
  let called = 0;
  const f: G.Fetcher = async () => { called++; return { ok: true, status: 200, json: async () => ({ data: [] }) }; };
  await assert.rejects(() => G.search(f, "", {}), (e: unknown) => e instanceof G.Fail && e.code === 503);
  assert.equal(called, 0);
  await assert.rejects(() => G.search(fake({}, 500), "K", {}), (e: unknown) => e instanceof G.Fail && e.code === 502);
  await assert.rejects(() => G.search(fake({}, 429), "K", {}), (e: unknown) => e instanceof G.Fail && e.code === 429 && e.message === "slow");
  await assert.rejects(() => G.search(fake("badjson"), "K", {}), (e: unknown) => e instanceof G.Fail && e.code === 502);
  await assert.rejects(() => G.search(async () => { throw new Error("offline"); }, "K", {}), (e: unknown) => e instanceof G.Fail && e.code === 502);
  await assert.rejects(() => G.search(f, "K", { q: 5 }), (e: unknown) => e instanceof G.Fail && e.code === 400);
  await assert.rejects(() => G.search(f, "K", { pos: 999 }), (e: unknown) => e instanceof G.Fail && e.code === 400);
  assert.equal(called, 0, "bad input never reaches GIPHY");
  assert.equal(G.safeUrl("https://media.giphy.com/media/a/giphy.gif"), "https://media.giphy.com/media/a/giphy.gif");
  assert.equal(G.safeUrl("https://evil.com/media/a/giphy.gif"), null);
});
ok("the app's side: signed, hidden on any trouble, only clean items come back", async () => {
  const who = { member: ID(1), priv: (await S.newSignPair()).priv };
  const seen: { act: string; url: string }[] = [];
  const reply = (status: number, body: unknown) => async (u: string, init: RequestInit) => { seen.push({ act: JSON.parse(String(init.body)).act, url: u }); return new Response(JSON.stringify(body), { status }); };
  assert.equal(await gifApi(who, reply(200, { on: true })).status(), true);
  assert.equal(await gifApi(who, reply(200, { on: false })).status(), false);
  assert.equal(await gifApi(who, reply(404, { error: "not found" })).status(), false, "not deployed yet: a quiet no");
  assert.equal(await gifApi(who, async () => { throw new Error("offline"); }).status(), false);
  assert.ok(seen.every((s) => s.url.endsWith("/functions/v1/gif")));
  const r = await gifApi(who, reply(200, { items: [{ id: "a", url: OKGIF, still: OKGIF, w: 10, h: 10 }, { id: "b", url: "https://evil.com/x.gif" }], next: 24 })).search("cat", 0);
  assert.deepEqual(r.items.map((x) => x.id), ["a"]); assert.equal(r.next, 24);
  assert.equal(seen.at(-1)!.act, "g_search");
  await assert.rejects(() => gifApi(who, reply(429, { error: "slow" })).search("cat"));
});

// ---------- the Tab list's side ----------
ok("the Tab list's ops: react, gifs, gifclear checked", () => {
  assert.deepEqual(cleanChatOp({ op: "react", to: ID(10).toUpperCase(), e: "👍" }), { op: "react", to: ID(10), e: "👍" });
  for (const o of [{ op: "react", to: "x", e: "👍" }, { op: "react", to: ID(10), e: "hi" }, { op: "react", to: ID(10) }, { op: "react", e: "👍" }]) assert.equal(cleanChatOp(o), null);
  assert.deepEqual(cleanChatOp({ op: "gifs", q: "  cat\n dance " }), { op: "gifs", q: "cat dance" });
  assert.deepEqual(cleanChatOp({ op: "gifs", q: "x", more: true }), { op: "gifs", q: "x", more: true });
  assert.deepEqual(cleanChatOp({ op: "gifs" }), { op: "gifs", q: "" });
  assert.deepEqual(cleanChatOp({ op: "gifclear" }), { op: "gifclear" });
});
ok("the Tab list's view: reaction pills and the GIF list are checked, the button stays hidden until asked", () => {
  assert.equal(EMPTY_CHAT.gif.on, null);
  assert.equal(cleanChatView(null).gif.on, null);
  const v = cleanChatView({ in: true, loaded: true, lines: [{ id: "m1", from: ID(1), name: "Sam", t: "hi", at: "2026-11-15T10:00:00Z",
    r: [{ e: "👍", n: 2, mine: true, who: ["You", "Sam"] }, { e: "no", n: 1 }, { e: "❤️", n: 0 }, { e: "🔥", n: 1.5 }, null] }],
  gif: { on: true, q: "cat", items: [{ id: "a", url: OKGIF }, { id: "b", url: "https://evil.com/x.gif" }], next: 24, busy: false } });
  assert.deepEqual(v.lines[0].r, [{ e: "👍", n: 2, mine: true, who: ["You", "Sam"] }]);
  assert.equal(v.gif.on, true); assert.equal(v.gif.items.length, 1); assert.equal(v.gif.next, 24);
  assert.equal(cleanChatView({ in: true, gif: { on: "yes" } }).gif.on, null);
  assert.equal(cleanChatView({ in: true, lines: [{ id: "m1", t: "hi" }] }).lines[0].r, undefined);
});

// ---------- registry, switches, policy, wiring ----------
ok("the feature is registered, documented and gated in code", () => {
  const f = JSON.parse(read("../features.json")).features.find((x: { id: string }) => x.id === "gsquad-signal");
  assert.ok(f); assert.equal(f.owner, "jan"); assert.equal(f.scope, "shared"); assert.equal(f.since, "1.63"); assert.equal(f.default, "on");
  assert.match(read("../FEATURES.md"), /G Squad Signal look, emoji and reactions/);
  assert.match(read("src/squad/signal.ts"), /SIGNAL_FEATURE = "gsquad-signal"/);
  assert.match(read("src/views/GSquadWindow.tsx"), /signalOn\(\)/);
  assert.match(read("src/views/GSquadChat.tsx"), /const sig = signalOn\(\)/);
  assert.match(read("src/squad/chatengine.ts"), /feature\(GIF_FEATURE\)/);
  assert.match(read("src/views/GSquadSettings.tsx"), /Load GIFs/);
});
ok("the content security policy lets pictures in from GIPHY only, and nothing else new", () => {
  for (const p of ["scripts/postbuild.mjs", "vite.config.ts", "../mac/Sources/Project.swift", "../phone/app/src/main/java/com/cincee/ps/gos/WebHost.kt"]) {
    const s = read(p);
    assert.match(s, /img-src 'self' data: blob: https:\/\/\*\.giphy\.com/, p);
    assert.ok(!/(script|connect|frame|default)-src[^;"]*giphy/.test(s), `${p}: GIPHY only for pictures`);
  }
});
ok("the hub function is signed, rate limited, keeps the key in a secret and the app never holds it", () => {
  const f = read("supabase/hub/functions/gif/index.ts");
  assert.match(f, /Deno\.env\.get\("GIPHY_API_KEY"\)/);
  assert.match(f, /gsquad-v1\|\$\{act\}/); assert.match(f, /Math\.abs\(Date\.now\(\) \/ 1000 - ts\) > 120/); assert.match(f, /squad_nonces/); assert.match(f, /allowed\(/);
  assert.ok(!/api_key=[A-Za-z0-9]{10,}/.test(f + read("supabase/hub/functions/gif/logic.ts")));
  for (const p of ["src/squad/chatengine.ts", "src/squad/gifhub.ts", "src/squad/chatgif.ts", "src/views/GSquadPickers.tsx"]) assert.ok(!/GIPHY_API_KEY|api\.giphy\.com/.test(read(p)), `${p} never talks to GIPHY itself`);
});
ok("Esc closes the pickers and the reaction bar, and Reduce motion is honoured", () => {
  const p = read("src/views/GSquadPickers.tsx");
  assert.equal((p.match(/useBack\(true, onClose\)/g) ?? []).length, 2);
  assert.match(read("src/views/GSquadChat.tsx"), /useBack\(bar, /);
  assert.match(p, /prefers-reduced-motion: reduce/);
  assert.match(read("src/views/gssignal.css"), /prefers-reduced-motion: reduce/);
  assert.match(p, /referrerPolicy="no-referrer"/);
});

let bad = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { bad++; console.log(`FAIL ${name}\n     ${(e as Error).stack?.split("\n").slice(0, 4).join("\n     ")}`); }
}
console.log(bad ? `\n${bad} failed` : `\n${tests.length} passed`);
process.exit(bad ? 1 : 0);
