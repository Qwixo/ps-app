// Run: node --experimental-strip-types tests/gsquad-names.test.ts
// G Squad names (V1.43), the developer 8 Nov 2026: "make it so you can change the name of the squad once it's created, and you
// can also change your name in the squad." The admin renames the squad (sealed with the squad key; for the listed
// squad the public name in See available squads too), a non-admin is refused, every member can change their own name
// (their card sealed again), and old chat messages show the new name. Names are fictional.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as S from "../src/core/squadcrypto.ts";
import { openCard, type SquadRec } from "../src/core/squadrec.ts";
import { cleanDir } from "../src/core/squaddir.ts";
import { sealMessage } from "../src/core/squadchat.ts";
import { renameMe, renameSquad } from "../src/squad/flows.ts";
import { ChatSession } from "../src/squad/chatflows.ts";
import { cleanSquadOp } from "../src/squad/view.ts";
import type { HubApi, HubMemberRow } from "../src/squad/hub.ts";

const tests: [string, () => Promise<void> | void][] = [];
const ok = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const SQ = "5e4d3c2b-1a0f-4e9d-8c7b-6a5f4e3d2c1b";

async function member(me: string, k: string): Promise<SquadRec> {
  return { v: 1, squadId: SQ, memberId: S.newUuid(), me, keys: [{ gen: 1, k }], sign: await S.newSignPair(), box: await S.newBoxPair(), secret: S.newSecret(), joinedAt: new Date().toISOString() };
}
function fakeApi() {
  const calls: { act: string; args: Record<string, unknown> }[] = [];
  const api = {
    rename: async (a: Record<string, unknown>) => { calls.push({ act: "rename", args: a }); return { ok: true as const, listed: "name" in a }; },
    card: async (ct: string, gen: number) => { calls.push({ act: "card", args: { ct, gen } }); return { ok: true as const }; },
  } as unknown as HubApi;
  return { api, calls };
}

// ---------- the admin renames the squad ----------
ok("rename: the new name is sealed with the squad key; a squad that is not listed never sends it in plain text", async () => {
  const a = await member("Alex", await S.newSquadKey());
  const { api, calls } = fakeApi();
  assert.equal(await renameSquad(a, api, "  Night   Owls  ", false), "Night Owls");
  const args = calls[0].args as { gen: number; meta: string; name?: string };
  assert.equal(args.gen, 1);
  assert.ok(!("name" in args), "no plain name for a squad that is not listed");
  assert.ok(!JSON.stringify(args).includes("Night"));
  assert.deepEqual(await S.open(a.keys[0].k, args.meta, S.sqAad.meta(SQ, 1)), { n: "Night Owls" });
});
ok("rename: the listed squad also sends its public name, the same one the members see", async () => {
  const a = await member("Alex", await S.newSquadKey());
  const { api, calls } = fakeApi();
  await renameSquad(a, api, "The G Squad Elite", true);
  const args = calls[0].args as { meta: string; name?: string };
  assert.equal(args.name, "The G Squad Elite");
  assert.deepEqual(await S.open(a.keys[0].k, args.meta, S.sqAad.meta(SQ, 1)), { n: "The G Squad Elite" });
});
ok("rename: no empty names, and a 40 character limit", async () => {
  const a = await member("Alex", await S.newSquadKey());
  const { api, calls } = fakeApi();
  await assert.rejects(renameSquad(a, api, "   ", false));
  await assert.rejects(renameSquad(a, api, "\u0000\u0001", false));
  assert.equal(calls.length, 0, "nothing sent");
  assert.equal((await renameSquad(a, api, "x".repeat(60), false)).length, 40);
  assert.equal(cleanSquadOp({ op: "renameSquad", name: "  " }), null);
  assert.deepEqual(cleanSquadOp({ op: "renameSquad", name: " Night  Owls " }), { op: "renameSquad", name: "Night Owls" });
  const m = read("supabase/hub/migrations/dir_002_rename.sql");
  assert.match(m, /char_length\(listed_name\) between 1 and 40/);
  const f = read("supabase/hub/functions/squad/index.ts");
  assert.match(f, /if \(!name \|\| name\.length > 40 \|\| \/\[\\u0000-\\u001f\\u007f\]\/\.test\(name\)\) throw new Fail\(400, "name"\)/);
});
ok("rename: a member who is not the admin is refused (hub, engine and screen)", () => {
  const m = read("supabase/hub/migrations/dir_002_rename.sql");
  assert.match(m, /if sq\.created_by is distinct from me\.id then raise exception 'admin'/);
  assert.match(m, /if sq\.rekey or sq\.gen <> p_gen then raise exception 'rekey'/, "never while a re-key is due");
  assert.match(read("src/squad/engine.ts"), /case "renameSquad": \{\s+if \(!rec \|\| !api \|\| !view\.creator\) return;/);
  // V1.47 (one squad, called The G Squad): the screen no longer offers to rename the squad; the hub and engine still refuse a non admin.
  assert.ok(!/label="Squad name"/.test(read("src/views/GSquad.tsx")));
});
ok("rename: the listing lock stays as strong (public name only for the squad already listed, no swap, no new claim)", () => {
  const m = read("supabase/hub/migrations/dir_002_rename.sql");
  assert.match(m, /new\.listed_name is distinct from old\.listed_name and \(old\.listed_squad is null or new\.listed_squad is distinct from old\.listed_squad\)/);
  assert.match(m, /old\.listed_squad is not null and new\.listed_squad is distinct from old\.listed_squad/);
  assert.match(m, /old\.listed_squad is not null and new\.claim_hash is not null/);
  assert.match(m, /if listed and p_name is null then raise exception 'public'/, "the list and the members' name never disagree");
  assert.match(m, /if not listed and p_name is not null then raise exception 'unlisted'/, "a private squad's name is never stored in plain text");
  const body = m.slice(m.indexOf("create or replace function public.dir_rename"), m.indexOf("create or replace function public.dir_list"));
  const sets = [...body.matchAll(/\bset\s+([^;]*?)\s+where\b/g)].map((x) => x[1]).join(", ");
  assert.ok(sets.includes("listed_name = p_name") && !/\b(claim_hash|listed_squad|listed_at)\s*=/.test(sets), "rename never sets the claim or the slot");
  assert.match(body, /update public\.dir_config set listed_name = p_name where id and listed_squad = sq\.id/, "only the public name, and only for its own listed squad");
});
ok("the list shows the listed squad's new name, or The G Squad when it has none", async () => {
  const box = (await S.newBoxPair()).pub;
  assert.equal(cleanDir([{ id: SQ, slot: "gsquad", admin_box: box, name: "Night Owls" }])[0].name, "Night Owls");
  assert.equal(cleanDir([{ id: SQ, slot: "gsquad", admin_box: box, name: null }])[0].name, "The G Squad");
  assert.equal(cleanDir([{ id: SQ, slot: "gsquad", admin_box: box, name: "\u0000" }])[0].name, "The G Squad");
  assert.equal(cleanDir([{ id: SQ, slot: "gsquad", admin_box: box, name: "y".repeat(80) }])[0].name.length, 40);
});

// ---------- your own name ----------
ok("your name: your card is sealed again with the new name and the same keys", async () => {
  const k = await S.newSquadKey();
  const b = await member("Sam", k);
  const { api, calls } = fakeApi();
  const next = await renameMe(b, api, " Sammy ");
  assert.equal(next.me, "Sammy");
  assert.equal(next.memberId, b.memberId);
  const c = calls[0].args as { ct: string; gen: number };
  assert.deepEqual(await openCard(b, b.memberId, c.ct, c.gen), { n: "Sammy", sign: b.sign.pub, box: b.box.pub });
  await assert.rejects(renameMe(b, api, "  "));
  assert.deepEqual(cleanSquadOp({ op: "renameMe", name: "Sammy" }), { op: "renameMe", name: "Sammy" });
  assert.match(read("src/squad/engine.ts"), /await saveRec\(await renameMe\(rec, api, o\.name\)\);/, "your vault record keeps the new name");
});
ok("your name: old chat messages show the new name (names come from cards, by member id)", async () => {
  const k = await S.newSquadKey();
  const [a, b] = await Promise.all([member("Alex", k), member("Sam", k)]);
  const row = async (r: SquadRec, name: string): Promise<HubMemberRow> => {
    const ct = await S.seal(k, { n: name, sign: r.sign.pub, box: r.box.pub }, S.sqAad.card(SQ, r.memberId, 1));
    return { id: r.memberId, sign_pub: r.sign.pub, box_pub: r.box.pub, card_ct: ct, card_gen: 1, joined_at: "2026-11-08T00:00:00Z", left_at: null, updated_at: new Date().toISOString() };
  };
  const ep = await S.newSquadKey(), msgId = S.newUuid();
  const msg = { id: msgId, member_id: b.memberId, epoch: 1, ct: await sealMessage(ep, SQ, 1, b.memberId, msgId, { t: "Morning all" }), edited: false, deleted: false, created_at: "2026-11-08T01:00:00Z", updated_at: "2026-11-08T01:00:00Z" };
  let members: HubMemberRow[] = [await row(a, "Alex"), await row(b, "Sam")], msgs = [msg];
  const status = { epoch: 1, rot: false, u: 0, last: null, read: "2026-11-08T00:00:00Z", votes: [], give: [] };
  const fetcher = async () => new Response(JSON.stringify({ now: new Date().toISOString(), status, drops: [], members, msgs, more: false }), { status: 200 });
  const chat = new ChatSession(a, fetcher);
  chat.keys.set(1, ep);
  await chat.pull();
  const nameOf = (id: string) => chat.people.get(chat.msgs.get(id)!.from)?.name;
  assert.equal(nameOf(msgId), "Sam");
  members = [await row(b, "Sammy")]; msgs = [];   // the next pull: only Sam's card changed, no new message
  await chat.pull();
  assert.equal(nameOf(msgId), "Sammy", "the old message now shows the new name");
  assert.match(read("src/squad/chatengine.ts"), /const p = s!\.people\.get\(m\.from\);/, "the chat view names every message from the people map");
});
ok("screens: Rename for your own name (everyone), in Squad settings, Your name (V1.47)", () => {
  const g = read("src/views/GSquadSettings.tsx");
  assert.match(g, /<NameEdit label="Your name in the squad"/);
  assert.match(g, /squadOp\(\{ op: "renameMe", name \}\)/);
  assert.match(g, /maxLength=\{40\}/);
  assert.match(g, /disabled=\{!clean \|\| clean === value \|\| busy\}/, "an empty name cannot be saved");
});
ok("no em or en dashes in anything this change touched", () => {
  for (const p of ["supabase/hub/migrations/dir_002_rename.sql", "supabase/hub/functions/squad/index.ts", "src/squad/flows.ts", "src/squad/engine.ts", "src/squad/view.ts", "src/squad/hub.ts", "src/core/squaddir.ts", "src/views/GSquad.tsx", "src/views/gsquad.css", "scripts/gsquad-names-hub-check.ts"]) {
    assert.ok(!/[–—]/.test(read(p)), p);
  }
});

let pass = 0;
for (const [name, fn] of tests) {
  try { await fn(); pass++; console.log("ok -", name); } catch (e) { console.error("FAIL -", name); console.error(e); process.exitCode = 1; }
}
console.log(`\ngsquad-names: ${pass} of ${tests.length} passed`);
