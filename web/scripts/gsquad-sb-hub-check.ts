// Live check of Soundboard sharing on the hub (V1.47): node --experimental-strip-types scripts/gsquad-sb-hub-check.ts
// Talks ONLY to the hub project (zxhvchchfrkfqxuyorqo) with fictional members ("Alex", "Sam") and a made up sound (a
// few seconds of generated noise, never played), runs the same sealing and acts PS runs (core/sbseal.ts), then both
// leave, which deletes the test squad and every sb row with it (on delete cascade). Never touches any vault project.
// Prints the bytes each act moved (the egress estimate).
import assert from "node:assert/strict";
import * as S from "../src/core/squadcrypto.ts";
import { currentKey } from "../src/core/squadrec.ts";
import { openPart, sbAad, sbBytes, sbCall, SbError, sealPart } from "../src/core/sbseal.ts";
import { apiFor, createSquad, joinSquad, makeInvite } from "../src/squad/flows.ts";
import { SHARE_PART, partsFor } from "../src/core/soundboard.ts";

const results: string[] = [];
const step = async (name: string, fn: () => Promise<void>) => { await fn(); results.push(name); console.log("ok -", name); };
const rejects = async (p: Promise<unknown>, status: number, word?: RegExp) => {
  try { await p; } catch (e) {
    assert.ok(e instanceof SbError, String(e)); assert.equal((e as SbError).status, status, (e as Error).message);
    if (word) assert.match((e as Error).message, word);
    return;
  }
  assert.fail(`expected ${status}`);
};
type Row = { id: string; member_id: string; meta_ct: string; gen: number; parts: number; size: number };

const A = await createSquad("Sound Check", "Alex");
let B = A;
const left = new Set<string>();
// A made up "sound": 1.2 MB of pseudo random bytes, so it takes 3 pieces.
const sound = new Uint8Array(1_200_000);
for (let i = 0, x = 7; i < sound.length; i++) { x = (x * 1103515245 + 12345) >>> 0; sound[i] = x >>> 24; }
const file = S.newUuid();
try {
  B = await joinSquad((await makeInvite(A, "https://cincee.com/client/")).link, "Sam");
  await step("Alex shares a 1.2 MB sound in 3 sealed pieces", async () => {
    const { raw, gen } = currentKey(A);
    const parts = partsFor(sound.length);
    assert.equal(parts, 3);
    const meta = await S.seal(raw, { n: "Gym walkout", e: "mp3", s: sound.length, t: "Before a heavy set" }, sbAad.meta(A.squadId, file));
    for (let n = 0; n < parts; n++) {
      const data = await sealPart(raw, sound.subarray(n * SHARE_PART, (n + 1) * SHARE_PART), sbAad.part(A.squadId, file, n));
      const r = await sbCall<{ done: boolean }>(A, "sb_put", n === 0 ? { id: file, n, parts, gen, size: sound.length, meta, data } : { id: file, n, data });
      assert.equal(r.done, n === parts - 1);
    }
  });
  await step("Sam lists it and opens the name and note with the squad key", async () => {
    const r = await sbCall<{ files: Row[] }>(B, "sb_list", {});
    assert.equal(r.files.length, 1);
    const raw = (await import("../src/core/squadrec.ts")).keyFor(B, r.files[0].gen)!;
    const m = await S.open<{ n: string; t: string; s: number }>(raw, r.files[0].meta_ct, sbAad.meta(B.squadId, file));
    assert.equal(m.n, "Gym walkout"); assert.equal(m.t, "Before a heavy set"); assert.equal(m.s, sound.length);
    assert.equal(r.files[0].member_id, A.memberId);
  });
  await step("Sam saves it: every piece opens and the sound is byte for byte the same", async () => {
    const raw = currentKey(B).raw;
    const out: Uint8Array[] = [];
    for (let n = 0; n < 3; n++) out.push(await openPart(raw, (await sbCall<{ data: string }>(B, "sb_get", { id: file, n })).data, sbAad.part(B.squadId, file, n)));
    const all = new Uint8Array(out.reduce((a, p) => a + p.length, 0));
    let at = 0; for (const p of out) { all.set(p, at); at += p.length; }
    assert.deepEqual(all, sound);
  });
  await step("a piece moved to another place does not open (the hub cannot reorder or swap pieces)", async () => {
    const raw = currentKey(B).raw;
    const p0 = (await sbCall<{ data: string }>(B, "sb_get", { id: file, n: 0 })).data;
    await assert.rejects(openPart(raw, p0, sbAad.part(B.squadId, file, 1)));
  });
  await step("only Alex can add to or take off Alex's share; a finished share takes no more pieces", async () => {
    const raw = currentKey(B).raw;
    const data = await sealPart(raw, new Uint8Array(10), sbAad.part(B.squadId, file, 1));
    await rejects(sbCall(B, "sb_put", { id: file, n: 1, data }), 403, /not yours/);
    await rejects(sbCall(A, "sb_put", { id: file, n: 1, data }), 409, /done/);
    await sbCall(B, "sb_del", { id: file });   // not Sam's: nothing happens
    assert.equal((await sbCall<{ files: Row[] }>(A, "sb_list", {})).files.length, 1);
  });
  await step("a request replayed, or signed for another act, is refused", async () => {
    const req = await S.signRequest(A.sign.priv, "sb_list", A.memberId, {});
    const send = (r: unknown) => fetch("https://zxhvchchfrkfqxuyorqo.supabase.co/functions/v1/sb", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(r) });
    assert.equal((await send(req)).status, 200);
    assert.equal((await send(req)).status, 409, "the same nonce twice is refused");
    assert.equal((await send(await S.signRequest(A.sign.priv, "count", A.memberId, {}))).status, 400, "a core act is not an sb act");
  });
  await step("Alex takes it off: gone for Sam too", async () => {
    await sbCall(A, "sb_del", { id: file });
    assert.equal((await sbCall<{ files: Row[] }>(B, "sb_list", {})).files.length, 0);
    await rejects(sbCall(B, "sb_get", { id: file, n: 0 }), 404, /gone/);
  });
  await step("Sam leaves: Sam is shut out", async () => {
    await apiFor(B).leave(); left.add("B");
    await rejects(sbCall(B, "sb_list", {}), 403, /not a member/);
  });
} finally {
  for (const [r, k] of [[B, "B"], [A, "A"]] as const) if (!left.has(k)) { try { await apiFor(r).leave(); } catch { /* already gone */ } }
}
console.log(`\n${results.length} checks passed. Bytes per act (request up, answer down):`);
for (const [act, v] of Object.entries(sbBytes)) console.log(`  ${act.padEnd(8)} calls ${String(v.calls).padStart(3)}  up ${String(v.up).padStart(8)}  down ${String(v.down).padStart(8)}`);
