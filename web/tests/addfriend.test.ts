// Run: node --experimental-strip-types tests/addfriend.test.ts
// Add friend (V1.44): the QR code (decoded again here, error correction checked), the link inside it, the one time
// invite (used once, gone after 24 hours, wrong key refused, called off on close), the Ask to join code, and the join
// path, all against a fake hub. Names are fictional. The live check (scripts/addfriend-hub-check.ts) runs the same
// code against the real hub with a fictional squad.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as S from "../src/core/squadcrypto.ts";
import { b64url, sha256hex } from "../src/core/crypto.ts";
import { currentKey, type SquadRec } from "../src/core/squadrec.ts";
import { alignAt, eccBlocks, formatBits, gfMul, makeQr, MASKS, qrPath, rawModules, type Ecc } from "../src/core/qrcode.ts";
import { FRIEND_BASE, FRIEND_TTL_MS, friendAskLink, friendExpired, friendJoinLink, isFriendHash, parseFriendLink } from "../src/core/friendlink.ts";
import { acceptFriend, callOffFriendCode, captureFriendLink, dropFriendLink, makeFriendCode, pendingFriendLink, type FriendDeps } from "../src/squad/addfriend.ts";
import { joinSquad } from "../src/squad/flows.ts";
import { HubError } from "../src/squad/hub.ts";
import { cleanSquadOp } from "../src/squad/view.ts";
import { GROUPS, SETTINGS } from "../src/core/settingsindex.ts";

const tests: [string, () => Promise<void> | void][] = [];
const ok = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ---------- a QR reader for the grid itself (no image step): format, unmask, zigzag, blocks, syndromes, bytes ----------
function functionMap(ver: number): boolean[][] {
  const s = ver * 4 + 17, f = Array.from({ length: s }, () => new Array<boolean>(s).fill(false));
  const box = (x0: number, y0: number, w: number, h: number) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < s && y < s) f[y][x] = true; };
  box(0, 0, 9, 9); box(s - 8, 0, 8, 9); box(0, s - 8, 9, 8);   // finders, separators and format areas
  box(6, 0, 1, s); box(0, 6, s, 1);                               // timing
  const at = alignAt(ver), last = at.length - 1;
  at.forEach((a, i) => at.forEach((b, j) => { if (!((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0))) box(a - 2, b - 2, 5, 5); }));
  if (ver >= 7) { box(s - 11, 0, 3, 6); box(0, s - 11, 6, 3); }
  return f;
}
function decodeQr(dark: boolean[][]): { text: string; ecc: Ecc; mask: number } {
  const s = dark.length, ver = (s - 17) / 4;
  let fb = 0;
  for (let i = 0; i <= 5; i++) fb |= Number(dark[i][8]) << i;
  fb |= Number(dark[7][8]) << 6; fb |= Number(dark[8][8]) << 7; fb |= Number(dark[8][7]) << 8;
  for (let i = 9; i < 15; i++) fb |= Number(dark[8][14 - i]) << i;
  let ecc: Ecc | null = null, mask = -1;
  for (const e of ["L", "M", "Q", "H"] as Ecc[]) for (let m = 0; m < 8; m++) if (formatBits(e, m) === fb) { ecc = e; mask = m; }
  assert.ok(ecc, "format bits are a valid BCH code word");
  let fb2 = 0;   // the second copy must say the same
  for (let i = 0; i < 8; i++) fb2 |= Number(dark[8][s - 1 - i]) << i;
  for (let i = 8; i < 15; i++) fb2 |= Number(dark[s - 15 + i][8]) << i;
  assert.equal(fb2, fb, "both copies of the format bits agree");
  assert.equal(dark[s - 8][8], true, "the dark module");
  const fm = functionMap(ver), bits: number[] = [];
  for (let right = s - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < s; v++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? s - 1 - v : v;
      if (!fm[y][x]) bits.push(Number(dark[y][x] !== MASKS[mask](x, y)));
    }
  }
  assert.equal(bits.length, rawModules(ver), "every data module is read once");
  const cw: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) cw.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  const { blocks: nb, eccLen } = eccBlocks(ver, ecc!);
  const raw = Math.floor(rawModules(ver) / 8), short = nb - (raw % nb), shortLen = Math.floor(raw / nb);
  const blocks: number[][] = Array.from({ length: nb }, () => []);
  let k = 0;
  for (let i = 0; i < shortLen + 1; i++) for (let j = 0; j < nb; j++) {
    if (i === shortLen - eccLen && j < short) continue;
    if (k < raw) blocks[j].push(cw[k++]);
  }
  let data: number[] = [];
  for (const b of blocks) {
    // every syndrome is zero: the block is a Reed Solomon code word
    let root = 1;
    for (let r = 0; r < eccLen; r++) {
      let sv = 0;
      for (const c of b) sv = gfMul(sv, root) ^ c;
      assert.equal(sv, 0, "syndrome " + r);
      root = gfMul(root, 2);
    }
    data = data.concat(b.slice(0, b.length - eccLen));
  }
  const db: number[] = [];
  for (const c of data) for (let i = 7; i >= 0; i--) db.push((c >>> i) & 1);
  const take = (n: number) => { const v = db.splice(0, n).reduce((a, b) => (a << 1) | b, 0); return v; };
  assert.equal(take(4), 0b0100, "byte mode");
  const len = take(ver <= 9 ? 8 : 16), bytes: number[] = [];
  for (let i = 0; i < len; i++) bytes.push(take(8));
  return { text: new TextDecoder().decode(new Uint8Array(bytes)), ecc: ecc!, mask };
}

// ---------- a fake hub: the acts Add friend uses, with the same refusals as the real one ----------
type Inv = { id: string; squad: string; by: string; hash: string; wrapped: string; gen: number; exp: number; used: boolean };
function fakeHub(clock = { now: Date.now() }) {
  const invites = new Map<string, Inv>(), members = new Map<string, { squad: string }>(), calls: string[] = [], bodies: string[] = [];
  let squadGen = 1;
  const fetcher = async (_url: string, init: RequestInit) => {
    const body = String(init.body);
    bodies.push(body);
    const b = JSON.parse(body) as { act: string; member: string; args: Record<string, unknown> };
    calls.push(b.act);
    const a = b.args, out = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
    const me = members.get(b.member);
    switch (b.act) {
      case "invite":
        if (!me) return out({ error: "not a member" }, 403);
        if ([...invites.values()].filter((i) => !i.used && i.exp > clock.now && i.squad === me.squad).length >= 20) return out({ error: "too many invites" }, 429);
        invites.set(a.id as string, { id: a.id as string, squad: me.squad, by: b.member, hash: a.hash as string, wrapped: a.wrapped as string, gen: a.gen as number, exp: clock.now + (a.days as number) * 864e5, used: false });
        return out({ ok: true });
      case "uninvite": {
        const i = invites.get(a.id as string);
        if (i && i.by === b.member && !i.used) invites.delete(i.id);
        return out({ ok: true });
      }
      case "join": {
        const i = invites.get(a.invite as string);
        if (!i || i.used || i.exp < clock.now || i.hash !== await sha256hex(a.token as string) || i.gen !== squadGen) return out({ error: "invite" }, 403);
        i.used = true;
        const id = S.newUuid();
        members.set(id, { squad: i.squad });
        return out({ squad: i.squad, member: id, gen: i.gen, wrapped: i.wrapped });
      }
      case "card": return me ? out({ ok: true }) : out({ error: "not a member" }, 403);
    }
    return out({ error: "unknown act" }, 400);
  };
  return { fetcher, invites, members, calls, bodies, clock, bump: () => { squadGen++; } };
}
async function adminOf(hub: ReturnType<typeof fakeHub>, squad = S.newUuid()): Promise<SquadRec> {
  const r: SquadRec = { v: 1, squadId: squad, memberId: S.newUuid(), me: "Alex", keys: [{ gen: 1, k: await S.newSquadKey() }], sign: await S.newSignPair(), box: await S.newBoxPair(),
    secret: S.newSecret(), joinedAt: new Date().toISOString(), creator: true };
  hub.members.set(r.memberId, { squad });
  return r;
}
const deps = (hub: ReturnType<typeof fakeHub>, o: Partial<FriendDeps> = {}): FriendDeps & { joined: SquadRec[]; asked: string[] } => {
  const joined: SquadRec[] = [], asked: string[] = [];
  return {
    joined, asked,
    inSquad: () => joined.length > 0,
    async join(l, me) { const r = await joinSquad(l, me, hub.fetcher); joined.push(r); return "Check Squad"; },
    async ask(id) { asked.push(id); return "The G Squad"; },
    say: (e) => (e instanceof HubError ? `hub ${e.status} ${e.message}` : String(e)),
    now: () => hub.clock.now,
    ...o,
  };
};

// ---------- QR ----------
ok("QR: every level and mask decodes back to the same text, error correction blocks check out", () => {
  const texts = ["A", "https://cincee.com/client/", friendJoinLink(S.newUuid(), new Uint8Array(32).fill(7)), "Zoë and Ünal ✓", "x".repeat(260)];
  for (const t of texts) for (const e of ["L", "M", "Q", "H"] as Ecc[]) for (let m = 0; m < 8; m++) {
    const q = makeQr(t, e, m);
    const d = decodeQr(q.dark);
    assert.deepEqual(d, { text: t, ecc: e, mask: m }, `${t.slice(0, 12)} ${e} ${m}`);
  }
});
ok("QR: a join link fits a small code (version 7 or less at level M), and the best mask is picked", () => {
  const link = friendJoinLink(S.newUuid(), globalThis.crypto.getRandomValues(new Uint8Array(32)));
  const q = makeQr(link);
  assert.ok(q.version <= 7, `version ${q.version}`);
  assert.equal(q.ecc, "M");
  assert.equal(decodeQr(q.dark).text, link);
  const { d, n } = qrPath(q);
  assert.equal(n, q.size + 8, "a quiet zone of 4 on each side");
  assert.ok(/^(M\d+ \d+h\d+v1h-\d+z)+$/.test(d), "one path of plain rectangles");
});
ok("QR: always black on white with its white edge, whatever the look (the looks codemod must leave it alone)", () => {
  assert.match(read("src/views/addfriend.css"), /\.af-qr \{[^}]*background: #FFFFFF; \/\* k-keep/);
  const v = read("src/views/AddFriend.tsx");
  assert.match(v, /<rect width=\{q\.n\} height=\{q\.n\} fill="#FFFFFF" \/>/);
  assert.match(v, /<path d=\{q\.d\} fill="#000000" \/>/);
});
ok("QR: too long is refused, not cut short", () => { assert.throws(() => makeQr("x".repeat(2000)), /Too long/); });
ok("QR: drawn here, no QR service or library anywhere in Add friend", () => {
  for (const p of ["src/core/qrcode.ts", "src/views/AddFriend.tsx", "src/squad/addfriend.ts", "src/core/friendlink.ts"]) {
    const src = read(p);
    assert.ok(!/https?:\/\/(?!cincee\.com)[a-z]/i.test(src.replace(/\/\/.*$/gm, "")), `${p} names no other web address`);
    assert.ok(!/from "(qrcode|qr-|react-qr)/.test(src), `${p} imports no QR library`);
  }
});

// ---------- the link ----------
ok("link: join and ask links read back; the key is only after the #", () => {
  const id = S.newUuid(), secret = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const j = friendJoinLink(id, secret);
  assert.ok(j.startsWith(`${FRIEND_BASE}#add=`), j);
  assert.ok(!j.split("#")[0].includes(b64url(secret)), "nothing secret before the #");
  const p = parseFriendLink(j);
  assert.ok(p && p.kind === "join");
  assert.equal(p.inviteId, id);
  assert.deepEqual([...p.secret], [...secret]);
  assert.ok(parseFriendLink(j.split("#")[1]), "just the part after the # works too");
  const exp = Date.now() + FRIEND_TTL_MS;
  const a = parseFriendLink(friendAskLink(id, exp));
  assert.ok(a && a.kind === "ask");
  assert.equal(a.squadId, id);
  assert.ok(Math.abs(a.expiresAt - exp) < 1000);
  assert.ok(!friendExpired(a, Date.now()));
  assert.ok(friendExpired(a, exp + 1000));
  assert.ok(isFriendHash(`#${j.split("#")[1]}`));
  assert.ok(!isFriendHash("#/todo"));
});
ok("link: old style invite links still read as join links; junk and cut links are refused", () => {
  const id = S.newUuid(), secret = new Uint8Array(32).fill(3);
  const old = S.inviteLink("https://cincee.com/client/", id, secret);
  assert.equal(parseFriendLink(old)?.kind, "join");
  assert.equal(parseFriendLink("#/today"), null);
  assert.equal(parseFriendLink(""), null);
  assert.equal(parseFriendLink(friendJoinLink(id, secret).slice(0, -5)), null, "a cut key");
  assert.equal(parseFriendLink(`#ask=not-a-uuid.abc`), null);
});

// ---------- making the code ----------
ok("code: the admin's is a one time invite for 24 hours; the hub gets a hash and a wrapped key, never the secret", async () => {
  const hub = fakeHub(), a = await adminOf(hub);
  const c = await makeFriendCode(a, { admin: true, listed: true, fetcher: hub.fetcher, now: hub.clock.now });
  assert.equal(c.kind, "join");
  if (c.kind !== "join") return;
  const l = parseFriendLink(c.url);
  assert.ok(l && l.kind === "join");
  const inv = hub.invites.get(l.inviteId)!;
  assert.ok(inv, "the hub has the invite");
  assert.equal(inv.exp - hub.clock.now, 864e5, "runs out in 24 hours on the hub");
  assert.equal(Date.parse(c.expiresAt) - hub.clock.now, FRIEND_TTL_MS);
  const m = await S.squadInviteMaterial(l.secret);
  assert.equal(inv.hash, m.tokenHash);
  for (const b of hub.bodies) {
    assert.ok(!b.includes(b64url(l.secret)), "the secret never went to the hub");
    assert.ok(!b.includes(m.token), "nor the token before joining");
    assert.ok(!b.includes(currentKey(a).raw), "nor the squad key");
  }
});
ok("code: fresh each time (two openings, two different invites)", async () => {
  const hub = fakeHub(), a = await adminOf(hub);
  const c1 = await makeFriendCode(a, { admin: true, listed: false, fetcher: hub.fetcher });
  const c2 = await makeFriendCode(a, { admin: true, listed: false, fetcher: hub.fetcher });
  assert.ok(c1.kind === "join" && c2.kind === "join" && c1.url !== c2.url);
  assert.equal(hub.invites.size, 2);
});
ok("code: not the admin, in the listed squad: an Ask to join code with no key in it; in a private squad: none", async () => {
  const hub = fakeHub(), a = await adminOf(hub);
  const m = { ...a, creator: false };
  const c = await makeFriendCode(m, { admin: false, listed: true, fetcher: hub.fetcher });
  assert.equal(c.kind, "ask");
  if (c.kind === "ask") {
    const l = parseFriendLink(c.url);
    assert.ok(l && l.kind === "ask" && l.squadId === a.squadId);
    assert.ok(!c.url.includes(b64url(new TextEncoder().encode(currentKey(a).raw))), "no key");
  }
  assert.equal(hub.calls.length, 0, "an ask code needs no hub call");
  assert.deepEqual(await makeFriendCode(m, { admin: false, listed: false, fetcher: hub.fetcher }), { kind: "none", why: "private" });
  assert.deepEqual(await makeFriendCode(null, { admin: false, listed: false }), { kind: "none", why: "no-squad" });
});

// ---------- the join path ----------
ok("join: scanning the admin's code joins at once, with the same squad key", async () => {
  const hub = fakeHub(), a = await adminOf(hub);
  const c = await makeFriendCode(a, { admin: true, listed: false, fetcher: hub.fetcher });
  const d = deps(hub);
  const r = await acceptFriend(parseFriendLink(c.kind === "join" ? c.url : ""), "Sam", d);
  assert.deepEqual(r, { state: "in", squad: "Check Squad" });
  assert.equal(d.joined[0].squadId, a.squadId);
  assert.equal(currentKey(d.joined[0]).raw, currentKey(a).raw);
  assert.equal(d.joined[0].me, "Sam");
});
ok("one time: a used code is refused for the next person", async () => {
  const hub = fakeHub(), a = await adminOf(hub);
  const c = await makeFriendCode(a, { admin: true, listed: false, fetcher: hub.fetcher });
  const link = parseFriendLink(c.kind === "join" ? c.url : "");
  assert.equal((await acceptFriend(link, "Sam", deps(hub))).state, "in");
  const r = await acceptFriend(link, "Eve", deps(hub));
  assert.deepEqual(r, { state: "error", message: "hub 403 invite" });
});
ok("expiry: after 24 hours the hub refuses the code; an ask code says it ran out without asking", async () => {
  const hub = fakeHub(), a = await adminOf(hub);
  const c = await makeFriendCode(a, { admin: true, listed: false, fetcher: hub.fetcher, now: hub.clock.now });
  hub.clock.now += FRIEND_TTL_MS + 60_000;
  const r = await acceptFriend(parseFriendLink(c.kind === "join" ? c.url : ""), "Sam", deps(hub));
  assert.deepEqual(r, { state: "error", message: "hub 403 invite" });
  const d = deps(hub);
  const ask = parseFriendLink(friendAskLink(a.squadId, hub.clock.now - 1000));
  assert.deepEqual(await acceptFriend(ask, "Sam", d), { state: "expired" });
  assert.equal(d.asked.length, 0);
});
ok("wrong key: a changed secret is refused by the hub, and even a hub that let it through could not open the squad key", async () => {
  const hub = fakeHub(), a = await adminOf(hub);
  const c = await makeFriendCode(a, { admin: true, listed: false, fetcher: hub.fetcher });
  const l = parseFriendLink(c.kind === "join" ? c.url : "");
  assert.ok(l && l.kind === "join");
  const bad = new Uint8Array(l.secret); bad[0] ^= 1;
  assert.deepEqual(await acceptFriend({ kind: "join", inviteId: l.inviteId, secret: bad }, "Eve", deps(hub)), { state: "error", message: "hub 403 invite" });
  const inv = hub.invites.get(l.inviteId)!;
  assert.equal(inv.used, false, "the real person can still use it");
  const wrong = await S.squadInviteMaterial(bad);
  await assert.rejects(S.unwrapInvite(wrong.wrap, inv.wrapped, S.sqAad.invite(a.squadId, l.inviteId, 1)));
  // a guessed invite id with a random secret: refused too
  assert.equal((await acceptFriend({ kind: "join", inviteId: S.newUuid(), secret: globalThis.crypto.getRandomValues(new Uint8Array(32)) }, "Eve", deps(hub))).state, "error");
});
ok("called off: closing the code deletes the unused invite, so nobody can use it later", async () => {
  const hub = fakeHub(), a = await adminOf(hub);
  const c = await makeFriendCode(a, { admin: true, listed: false, fetcher: hub.fetcher });
  await callOffFriendCode(a, c, hub.fetcher);
  assert.equal(hub.invites.size, 0);
  assert.equal((await acceptFriend(parseFriendLink(c.kind === "join" ? c.url : ""), "Eve", deps(hub))).state, "error");
  await callOffFriendCode(a, { kind: "none", why: "private" }, hub.fetcher);   // nothing to call off: no hub call
  assert.deepEqual(hub.calls.filter((x) => x === "uninvite").length, 1);
});
ok("ask: an Ask to join code sends a request (the admin approves it); a squad off the list says so", async () => {
  const hub = fakeHub(), id = S.newUuid();
  const d = deps(hub);
  assert.deepEqual(await acceptFriend(parseFriendLink(friendAskLink(id, Date.now() + FRIEND_TTL_MS)), "Sam", d), { state: "asked", squad: "The G Squad" });
  assert.deepEqual(d.asked, [id]);
  assert.equal(d.joined.length, 0, "nobody joins before the admin says yes");
  const r = await acceptFriend(parseFriendLink(friendAskLink(id, Date.now() + 60_000)), "Sam", deps(hub, { ask: async () => null }));
  assert.equal(r.state, "error");
});
ok("already in a squad: nothing is joined or asked, no hub call", async () => {
  const hub = fakeHub(), a = await adminOf(hub);
  const c = await makeFriendCode(a, { admin: true, listed: false, fetcher: hub.fetcher });
  const before = hub.calls.length;
  const r = await acceptFriend(parseFriendLink(c.kind === "join" ? c.url : ""), "Sam", deps(hub, { inSquad: () => true }));
  assert.deepEqual(r, { state: "already" });
  assert.equal(hub.calls.length, before);
  assert.deepEqual(await acceptFriend(null, "Sam", deps(hub)), { state: "none" });
});
ok("the waiting link: read once from the address, kept, then dropped", () => {
  const j = friendJoinLink(S.newUuid(), new Uint8Array(32).fill(9));
  const got = captureFriendLink({ hash: `#${j.split("#")[1]}`, href: j });
  assert.equal(got?.kind, "join");
  assert.equal(pendingFriendLink(), got);
  assert.equal(captureFriendLink({ hash: "", href: FRIEND_BASE }), got, "a second read keeps it");
  dropFriendLink();
  assert.equal(pendingFriendLink(), null);
  assert.equal(captureFriendLink({ hash: "#/todo", href: `${FRIEND_BASE}#/todo` }), null);
});

// ---------- wiring ----------
ok("the Tab list may ask for a code and close it (squadOp), nothing else rides along", () => {
  assert.deepEqual(cleanSquadOp({ op: "friend", url: "x" }), { op: "friend" });
  assert.deepEqual(cleanSquadOp({ op: "friendClose" }), { op: "friendClose" });
});
// V1.51 (the developer, 12 Nov 2026): About and updates is the top item, above everything; Add friend comes right after it.
ok("Settings: Add friend is the section right after About and updates, with its one row", () => {
  assert.equal(GROUPS[0].id, "about");
  assert.equal(GROUPS[1].id, "friend");
  assert.equal(SETTINGS.find((e) => e.group === "friend")?.id, "add-friend");
  assert.match(read("src/views/SettingsGroups.tsx"), /"add-friend": function AddFriend/);
});
ok("the hub: uninvite deletes only your own unused invite", () => {
  const f = read("supabase/hub/functions/squad/index.ts");
  assert.match(f, /case "uninvite": \{[\s\S]*?\.delete\(\)\.eq\("id", uuid\(args\.id\)\)\.eq\("created_by", m\.id\)\.is\("used_at", null\)/);
  assert.match(read("src/squad/addfriend.ts"), /days: 1 \}\)/, "the code asks the hub for 24 hours");
});
ok("no em or en dashes in anything Add friend added", () => {
  for (const p of ["src/core/qrcode.ts", "src/core/friendlink.ts", "src/squad/addfriend.ts", "src/views/AddFriend.tsx", "src/views/addfriend.css", "tests/addfriend.test.ts", "scripts/addfriend-hub-check.ts", "src/squad/engine.ts", "src/core/settingsindex.ts"]) {
    assert.ok(!/[\u2013\u2014]/.test(read(p)), p);
  }
});

let pass = 0;
for (const [name, fn] of tests) {
  try { await fn(); pass++; console.log("ok -", name); } catch (e) { console.error("FAIL -", name); console.error(e); process.exitCode = 1; }
}
console.log(`\naddfriend: ${pass} of ${tests.length} passed`);
