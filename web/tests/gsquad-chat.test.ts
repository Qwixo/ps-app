// Run: node --experimental-strip-types tests/gsquad-chat.test.ts
// G Squad chat (V1.40): period keys sealed per member, a newcomer shut out of older periods without a yes, the hub
// unable to swap a key in, messages bound to author, period and id, the history vote's rules and words, the Tab
// list's ops checked, and the chat only ever talking to the hub. Names are fictional.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import * as S from "../src/core/squadcrypto.ts";
import { sealCard, type HubMember, type SquadRec } from "../src/core/squadrec.ts";
import { chatAad, cleanAbout, cleanBody, cleanText, cleanVotes, hubMicros, joinerLine, openChatDrops, openMessage, planChatRotate, planGive, sealMessage, voteCardDue, voteWords, type VoteInfo } from "../src/core/squadchat.ts";
import { badgeText, cleanChatOp, cleanChatView, EMPTY_CHAT } from "../src/squad/chatview.ts";

const tests: [string, () => Promise<void> | void][] = [];
const ok = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const SQ = "0b6f1a52-7c1d-4b0e-9a3c-1f2e3d4c5b6a";
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function member(id: string, me: string, keys: { gen: number; k: string }[]): Promise<SquadRec> {
  return { v: 1, squadId: SQ, memberId: id, me, keys, sign: await S.newSignPair(), box: await S.newBoxPair(), secret: S.newSecret(), joinedAt: new Date().toISOString() };
}
async function row(r: SquadRec): Promise<HubMember> {
  const c = await sealCard(r, r.me);
  return { id: r.memberId, sign_pub: r.sign.pub, box_pub: r.box.pub, card_ct: c.ct, card_gen: c.gen, left_at: null };
}
const vote = (p: Partial<VoteInfo> = {}): VoteInfo => ({ id: ID(90), j: ID(2), be: 2, at: "2026-11-07T10:00:00.000000+00:00", again: null, res: null, voter: true, mine: null,
  n: 2, k: 0, msgs: 142, from: 4, first: "2026-11-03T09:00:00.000000+00:00", ...p });

const squadKey = await S.newSquadKey();
const A = await member(ID(1), "Alex", [{ gen: 1, k: squadKey }]);
const B = await member(ID(2), "Sam", [{ gen: 1, k: squadKey }]);

ok("a period key is sealed to each member separately; only that member opens their own", async () => {
  const plan = (await planChatRotate(A, [await row(A), await row(B)], 0))!;
  assert.equal(plan.epoch, 1);
  assert.equal(plan.drops.length, 2);
  const ka = new Map<number, string>(), kb = new Map<number, string>();
  assert.deepEqual(await openChatDrops(A, [{ epoch: 1, sealed: plan.drops.find((d) => d.member === A.memberId)!.sealed }], ka), [1]);
  assert.deepEqual(await openChatDrops(B, [{ epoch: 1, sealed: plan.drops.find((d) => d.member === B.memberId)!.sealed }], kb), [1]);
  assert.equal(ka.get(1), plan.raw); assert.equal(kb.get(1), plan.raw);
  const kx = new Map<number, string>();
  assert.deepEqual(await openChatDrops(B, [{ epoch: 1, sealed: plan.drops.find((d) => d.member === A.memberId)!.sealed }], kx), [], "Sam cannot open Alex's drop");
  assert.deepEqual(await openChatDrops(A, [{ epoch: 2, sealed: plan.drops.find((d) => d.member === A.memberId)!.sealed }], kx), [], "a drop relabelled to another period does not open");
});

ok("a newcomer holding the squad key (from the invite) and their own period keys cannot open an older message", async () => {
  const old = (await planChatRotate(A, [await row(A)], 0))!;   // period 1: Alex alone
  const id = S.newUuid();
  const ct = await sealMessage(old.raw, SQ, 1, A.memberId, id, { t: "Before Sam joined" });
  const next = (await planChatRotate(A, [await row(A), await row(B)], 1))!;   // period 2: Alex and Sam
  const kb = new Map<number, string>();
  await openChatDrops(B, next.drops.map((d) => ({ epoch: 2, sealed: d.sealed })), kb);
  assert.deepEqual([...kb.keys()], [2]);
  assert.equal(await openMessage(squadKey, SQ, 1, A.memberId, id, ct), null, "the squad key opens no chat message");
  assert.equal(await openMessage(kb.get(2)!, SQ, 1, A.memberId, id, ct), null, "the newer period's key does not open it");
  assert.equal((await openMessage(old.raw, SQ, 1, A.memberId, id, ct))?.t, "Before Sam joined");
});

ok("after a yes, the older keys are sealed to the newcomer and open; before it, nothing reaches them", async () => {
  const ka = new Map<number, string>([[1, await S.newSquadKey()], [2, await S.newSquadKey()]]);
  const gave = (await planGive(A, ka, await row(B), [1]))!;
  assert.deepEqual(gave.map((g) => g.epoch), [1], "only the periods asked for");
  const kb = new Map<number, string>();
  assert.deepEqual(await openChatDrops(B, gave, kb), [1]);
  assert.equal(kb.get(1), ka.get(1));
});

ok("the hub cannot slip its own box key in: a member whose card does not match is never sealed to", async () => {
  const evil = await S.newBoxPair();
  const swapped = { ...(await row(B)), box_pub: evil.pub };
  assert.equal(await planChatRotate(A, [await row(A), swapped], 0), null);
  assert.equal(await planGive(A, new Map([[1, await S.newSquadKey()]]), swapped, [1]), null);
  const noCard = { ...(await row(B)), card_ct: null };
  // V1.49: no card yet means still getting in: left out of the period (the hub's chat_in agrees), never sealed to
  assert.deepEqual((await planChatRotate(A, [await row(A), noCard], 0))!.drops.map((d) => d.member), [A.memberId], "someone still getting in is never sealed to");
  assert.equal(await planChatRotate(A, [await row(A), { ...(await row(B)), card_ct: "AAAA" }], 0), null, "a card that does not open: wait, never seal around them");
  assert.equal(await planChatRotate(A, [await row(B)], 0), null, "a plan without yourself is no plan");
  const leftOut = { ...(await row(B)), left_at: "2026-11-07T10:00:00Z" };
  assert.deepEqual((await planChatRotate(A, [await row(A), leftOut], 0))!.drops.map((d) => d.member), [A.memberId], "someone who left gets no new key");
});

ok("a message is bound to its author, period and id", async () => {
  const k = await S.newSquadKey(), id = S.newUuid();
  const ct = await sealMessage(k, SQ, 3, A.memberId, id, { t: "Gym at 7?", a: { k: "gym", l: "Squat 100 kg x 5", w: B.memberId } });
  assert.deepEqual(await openMessage(k, SQ, 3, A.memberId, id, ct), { t: "Gym at 7?", a: { k: "gym", l: "Squat 100 kg x 5", w: B.memberId } });
  assert.equal(await openMessage(k, SQ, 3, B.memberId, id, ct), null, "moved to another author");
  assert.equal(await openMessage(k, SQ, 4, A.memberId, id, ct), null, "moved to another period");
  assert.equal(await openMessage(k, SQ, 3, A.memberId, S.newUuid(), ct), null, "moved to another id");
  assert.equal(chatAad.msg(SQ, 3, A.memberId, id), `gsquad-v1:chat:${SQ}:3:${A.memberId}:${id}`);
  await assert.rejects(sealMessage(k, SQ, 3, A.memberId, id, { t: "   " }), /Empty/);
});

ok("text and about are cleaned: no control characters, 2000 characters, blank lines kept short", () => {
  assert.equal(cleanText("  hi\r\nthere\u0007  "), "hi\nthere");
  assert.equal(cleanText("a\n\n\n\n\n\nb"), "a\n\n\nb");
  assert.equal(cleanText("x".repeat(2500)).length, 2000);
  assert.equal(cleanAbout({ k: "gym", l: "" }), undefined);
  assert.equal(cleanAbout({ k: "GYM!", l: "x" }), undefined);
  assert.deepEqual(cleanAbout({ k: "gym", l: " Bench\n80 kg ", w: "nope" }), { k: "gym", l: "Bench 80 kg" });
  assert.equal(cleanBody({ t: "" }), null);
});

ok("the vote pop-up: up until you answer; back for everyone once after 24 hours; gone when decided", () => {
  const none = () => false, seen = () => true;
  assert.equal(voteCardDue(vote(), none), "ask");
  assert.equal(voteCardDue(vote({ mine: true }), none), null, "answered: away");
  assert.equal(voteCardDue(vote({ again: "2026-11-08T10:00:00Z", mine: true }), none), "again", "it comes back for everyone, even those who answered");
  assert.equal(voteCardDue(vote({ again: "2026-11-08T10:00:00Z", mine: true }), seen), null, "once");
  assert.equal(voteCardDue(vote({ again: "2026-11-08T10:00:00Z", mine: null }), seen), "ask", "not answered: it stays");
  assert.equal(voteCardDue(vote({ res: "yes" }), none), null);
  assert.equal(voteCardDue(vote({ voter: false }), none), null, "the newcomer is never asked about themselves");
});

ok("the vote's words: the developer's question word for word, then exactly what the newcomer would see", () => {
  const w = voteWords("Sam", vote(), "ask", "Asia/Dubai");
  assert.equal(w.title, "Sam just joined the G Squad. Do you want them to see your entire conversation history?");
  assert.equal(w.sub, "Everyone has to say Yes. If anyone says No, they will not see it.");
  assert.match(w.body, /^Yes means Sam can read all 142 messages sent in this chat before they joined, from 4 people, going back to 3 Nov: the words of every message, who sent it and when\./);
  assert.match(w.body, /No means Sam only sees messages sent after they joined\. The older ones stay locked to them for good\./);
  assert.match(w.body, /within 24 hours this comes back, and 12 hours after that anyone who has not answered counts as Yes\.$/);
  assert.ok(w.title.length <= 160 && w.sub.length <= 200 && w.body.length <= 600, "fits PS's card (title 160, sub 200, body 600)");
  const again = voteWords("Sam", vote({ again: "x", k: 1 }), "again");
  assert.equal(again.sub, "This came back because 1 person has not answered in 24 hours. In 12 hours, anyone who still has not answered counts as Yes.");
  assert.equal(voteWords("Sam", vote({ again: "x", k: 1, mine: false }), "again").sub, "You said No. Still waiting on 1 of 2. You can change your answer until it is decided.");
  assert.match(voteWords("Sam", vote({ msgs: 1, from: 1 }), "ask").body, /all 1 message sent .* from 1 person/);
  assert.match(voteWords("Sam", vote({ msgs: 0 }), "ask").body, /^There are no older messages left/);
});

ok("the newcomer's line at the top of the chat", () => {
  assert.equal(joinerLine(undefined, false), null);
  assert.equal(joinerLine(vote(), false), "The squad is deciding whether you can see the 142 messages sent before you joined.");
  assert.match(joinerLine(vote({ res: "no" }), false)!, /keep the messages from before you joined to themselves/);
  assert.match(joinerLine(vote({ res: "yes" }), false)!, /arrive as soon as someone from before opens PS/);
  assert.match(joinerLine(vote({ res: "yes" }), true)!, /you can read the messages from before you joined/);
});

ok("votes from the hub are checked field by field", () => {
  const v = cleanVotes([{ id: ID(9).toUpperCase(), j: ID(2), be: 3, res: "maybe", mine: "yes", n: 2, k: "x" }, { id: "bad", j: ID(2) }, null]);
  assert.equal(v.length, 1);
  assert.deepEqual({ id: v[0].id, be: v[0].be, res: v[0].res, mine: v[0].mine, k: v[0].k }, { id: ID(9), be: 3, res: null, mine: null, k: 0 });
  assert.deepEqual(cleanVotes("nope"), []);
});

ok("hub times keep their microseconds (a read message must not count as unread)", () => {
  assert.ok(hubMicros("2026-11-07T16:20:00.123456+00:00") > hubMicros("2026-11-07T16:20:00.123+00:00"));
  assert.equal(hubMicros("2026-11-07T16:20:00.5Z") - hubMicros("2026-11-07T16:20:00Z"), 500_000);
  assert.equal(hubMicros("2026-11-07T20:20:00.000001+04:00"), hubMicros("2026-11-07T16:20:00.000001Z"));
  assert.equal(hubMicros(null), 0);
});

ok("the Tab list's chat ops are checked; anything else is dropped", () => {
  assert.deepEqual(cleanChatOp({ op: "send", text: "  hi  ", a: { k: "gym", l: "Bench" }, extra: 1 }), { op: "send", text: "hi", a: { k: "gym", l: "Bench" } });
  assert.equal(cleanChatOp({ op: "send", text: "   " }), null);
  assert.deepEqual(cleanChatOp({ op: "vote", id: ID(5).toUpperCase(), yes: false }), { op: "vote", id: ID(5), yes: false });
  assert.equal(cleanChatOp({ op: "vote", id: ID(5), yes: "no" }), null);
  assert.equal(cleanChatOp({ op: "del", id: "../x" }), null);
  assert.deepEqual(cleanChatOp({ op: "open", on: 1 }), { op: "open", on: false });
  assert.equal(cleanChatOp({ op: "rotate" }), null, "keys are never the Tab list's business");
  assert.equal(cleanChatOp(null), null);
});

ok("the Tab list's view is checked lightly; nothing but plain lines", () => {
  assert.deepEqual(cleanChatView(null), EMPTY_CHAT);
  const v = cleanChatView({ in: true, unread: -3, lines: [{ id: "a", t: "x".repeat(3000), a: { k: "gym", l: "Bench" }, key: "secret" }], votes: [{ id: "v", stage: "now" }] });
  assert.equal(v.unread, 0);
  assert.equal(v.lines[0].t.length, 2000);
  assert.equal((v.lines[0] as unknown as Record<string, unknown>).key, undefined);
  assert.equal(v.votes[0].stage, null);
  assert.equal(badgeText(0), ""); assert.equal(badgeText(3), "3"); assert.equal(badgeText(12), "9+");
});

ok("the chat only ever talks to the hub, signs every request, and the website may reach the hub", () => {
  const hub = read("src/squad/chathub.ts");
  assert.match(hub, /CHAT_FN = `\$\{HUB_URL\}\/functions\/v1\/chat`/);
  assert.match(hub, /signRequest\(who\.priv, act, who\.member, args\)/);
  for (const f of ["src/squad/chathub.ts", "src/squad/chatflows.ts", "src/squad/chatengine.ts", "src/core/squadchat.ts"]) {
    const t = read(f);
    assert.doesNotMatch(t, /mxusokxekkecebwqgeru|YOUR_OTHER_PROJECT_REF/, `${f} never names another project`);
    assert.doesNotMatch(t, /https:\/\/(?!zxhvchchfrkfqxuyorqo)[a-z0-9.-]+/i, `${f} reaches no other server`);
  }
  assert.match(read("scripts/postbuild.mjs"), /connect-src 'self' \$\{SB\} \$\{SB\.replace\("https", "wss"\)\} \$\{SQUAD_HUB\}/);
  const fn = read("supabase/hub/functions/chat/index.ts");
  assert.match(fn, /\^c_\[a-z\]\{2,10\}\$/, "chat acts are c_* only, never a core act");
  assert.match(fn, /squad_nonces/, "the same replay guard as the core");
  const sql = read("supabase/hub/migrations/chat_001_chat.sql");
  for (const t of ["chat_epochs", "chat_keydrops", "chat_messages", "chat_reads", "chat_votes", "chat_ballots"]) assert.ok(sql.includes(`'${t}'`), `${t} locked down`);
  assert.match(sql, /force row level security/);
  assert.match(sql, /as restrictive for all to anon, authenticated using \(false\)/);
  assert.doesNotMatch(sql, /alter table public\.squad/, "the core's tables are never changed");
});

ok("no em or en dashes in anything the chat added", () => {
  const files = ["src/core/squadchat.ts", "src/squad/chathub.ts", "src/squad/chatflows.ts", "src/squad/chatengine.ts", "src/squad/chatview.ts", "src/squad/chatmirror.ts",
    "src/squad/chatopen.ts", "src/views/GSquadChat.tsx", "src/views/gschat.css", "supabase/hub/functions/chat/index.ts", "scripts/gsquad-chat-hub-check.ts",
    ...readdirSync(new URL("../supabase/hub/migrations/", import.meta.url)).filter((f) => f.startsWith("chat_")).map((f) => `supabase/hub/migrations/${f}`)];
  for (const f of files) assert.doesNotMatch(read(f), /[–—]/, f);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log("ok -", name); }
  catch (e) { failed++; console.log("FAIL -", name); console.log(e); }
}
console.log(`\n${tests.length - failed} of ${tests.length} passed`);
if (failed) process.exit(1);
