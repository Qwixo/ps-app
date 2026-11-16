// Run: node --experimental-strip-types tests/outsource.test.ts
// Outsource work to your other computer (src/core/second.ts rules, src/core/outsource.ts engine, PS 1.65) with a FAKE second computer:
// one fake vault shared by the engines, a fake Mac that keeps what it is told, no network, FICTIONAL data only.
import assert from "node:assert/strict";
const S = await import("../src/core/second.ts");
const O = await import("../src/core/outsource.ts");
const C = await import("../src/core/crypto.ts");
import type { PageToMac, MacToPage, KeepRecord } from "../src/core/secondbridge.ts";

let n = 0;
const ok = async (name: string, fn: () => unknown) => { await fn(); n++; console.log("ok -", name); };
const MIN = 60_000, HOUR = 3600_000;
type Eng = ReturnType<typeof O.createEngine>;
type Rec = { id: string; kind: string; data: any };
type Dev = { e: Eng; posts: PageToMac[]; kv: Map<string, string>; label: string; kept: () => KeepRecord | null };

function world(start = Date.UTC(2026, 10, 17, 10, 0, 0)) {
  const vault = new Map<string, Rec>();
  const clock = { t: start };
  const puts: string[] = [];
  const store = (label: string) => ({
    docs: (kind: string) => [...vault.values()].filter((d) => d.kind === kind).map((d) => ({ ...d, ws: null, author: null, updatedAt: null })),
    put: async (kind: string, data: unknown, id: string) => { vault.set(id, { id, kind, data: JSON.parse(JSON.stringify(data)) }); puts.push(`${label}:${kind}`); return id; },
    remove: async (id: string) => { vault.delete(id); },
    poke: () => {},
  });
  /** A Mac (native) or a phone. `macKeep` stands in for the Mac's Keychain: it survives a "restart" of the page. */
  const mk = (label: string, o: { phone?: boolean; kv?: Map<string, string>; macKeep?: { rec: KeepRecord | null } } = {}): Dev => {
    const kv = o.kv ?? new Map<string, string>();
    const macKeep = o.macKeep ?? { rec: null as KeepRecord | null };
    const posts: PageToMac[] = [];
    const local = { get: (k: string) => kv.get(k) ?? null, set: (k: string, v: string) => { kv.set(k, v); }, del: (k: string) => { kv.delete(k); } };
    const e = O.createEngine({
      store: store(label) as never, local, now: () => clock.t, native: !o.phone, phone: !!o.phone,
      post: (m) => { posts.push(m); if (m.op === "keep") macKeep.rec = JSON.parse(JSON.stringify(m.record)); if (m.op === "forget") macKeep.rec = null; },
    });
    const d: Dev = { e, posts, kv, label, kept: () => macKeep.rec };
    (d as unknown as { macKeep: typeof macKeep }).macKeep = macKeep;
    return d;
  };
  const state = (keep: KeepRecord | null, name = "Mac"): MacToPage => ({ type: "outsource", op: "state", v: 1, keep, app: "1.65", model: "Mac", chip: "M1", name, helper: "approved", awake: true, locked: false, cli: ["claude", "git"], folder: "/tmp/ps-outsource" });
  const sync = async (...xs: Dev[]) => { for (let i = 0; i < 3; i++) for (const x of xs) await x.e.onVault(); };
  return { vault, clock, puts, mk, sync, state };
}
async function paired() {
  const w = world();
  const main = w.mk("main"), other = w.mk("other");
  await main.e.onMac(w.state(null, "Main M4"));
  await other.e.onMac(w.state(null, "Old M1"));
  const code = await other.e.startPairing("Old M1");
  const r = await main.e.enterCode(code, false, "Main M4");
  assert.equal(r.ok, true, r.why);
  await w.sync(main, other);
  return { w, main, other, code };
}
const args = { title: "Fix the sort bug", repo: "ps-app", base: "abc1234", prompt: "Make the sort stable and add a test." };
const runs = (d: Dev) => d.posts.filter((p): p is Extract<PageToMac, { op: "run" }> => p.op === "run");
const restarts = (d: Dev) => d.posts.filter((p): p is Extract<PageToMac, { op: "restart" }> => p.op === "restart");
const keysOf = (d: Dev) => d.e._debug.keys()!;

await ok("pairing: wrong code refused, right code pairs both, same check words, the code and keys never stored in the open", async () => {
  const w = world();
  const main = w.mk("main"), other = w.mk("other");
  await main.e.onMac(w.state(null)); await other.e.onMac(w.state(null));
  const code = await other.e.startPairing("Old M1");
  assert.match(code, /^\d{4}-\d{4}$/);
  assert.equal((await main.e.enterCode("0000-0000")).ok, false);
  assert.equal((await main.e.enterCode("12")).ok, false);
  assert.equal(other.e.view().paired, false);
  assert.equal((await main.e.enterCode(code, false, "Main M4")).ok, true);
  await w.sync(main, other);
  const mv = main.e.view(), ov = other.e.view();
  assert.equal(mv.paired && ov.paired, true);
  assert.equal(mv.peerName, "Old M1"); assert.equal(ov.peerName, "Main M4");
  assert.equal(mv.role, "main"); assert.equal(ov.role, "other");
  assert.match(mv.check, /^\w+ \w+ \w+ \w+$/); assert.equal(mv.check, ov.check, "both show the same check words");
  assert.equal(ov.code, "", "the code stops showing once used");
  assert.ok(![...w.vault.values()].some((d) => d.kind === "spair" && d.data.t === "offer"), "the offer is gone");
  const all = JSON.stringify([...w.vault.values()]);
  assert.ok(!all.includes(code.replace("-", "")), "the code is never in the vault");
  assert.ok(!all.includes(keysOf(main).priv) && !all.includes(keysOf(other).priv), "no private key in the vault");
  for (const d of [main, other]) assert.ok(![...d.kv.values()].some((v) => v.includes(keysOf(d).priv)), "no private key in the page's storage on a Mac");
  assert.equal(main.kept()?.priv, keysOf(main).priv, "the Mac keeps the private half");
});

await ok("a code works once, and not after 10 minutes", async () => {
  const w = world();
  const main = w.mk("main"), other = w.mk("other"), third = w.mk("third");
  await other.e.onMac(w.state(null));
  const code = await other.e.startPairing();
  w.clock.t += 11 * MIN;
  assert.equal((await main.e.enterCode(code)).ok, false);
  const code2 = await other.e.startPairing();
  assert.equal((await main.e.enterCode(code2)).ok, true);
  await w.sync(main, other);
  assert.equal((await third.e.enterCode(code2)).ok, false, "the used code no longer matches anything");
});

await ok("a slow pairing proof: guessing is expensive, the proof binds the code to the device and its keys", async () => {
  assert.ok(S.PAIR_ITERS >= 100_000);
  const a = await S.pairCode("1234-5678", "offer", "dev1", "pubA", "encA");
  assert.equal(a, await S.pairCode("12345678", "offer", "dev1", "pubA", "encA"));
  assert.notEqual(a, await S.pairCode("1234-5679", "offer", "dev1", "pubA", "encA"));
  assert.notEqual(a, await S.pairCode("1234-5678", "offer", "dev1", "pubB", "encA"));
});

await ok("stays paired across a restart or an update: the page gets the pairing back from the Mac", async () => {
  const { w, main, other } = await paired();
  const m2 = w.mk("main", { macKeep: (main as any).macKeep }), o2 = w.mk("other", { macKeep: (other as any).macKeep });
  assert.equal(m2.e.view().ready, false, "waits for the Mac");
  await m2.e.onMac(w.state(m2.kept())); await o2.e.onMac(w.state(o2.kept()));
  assert.equal(m2.e.view().paired && o2.e.view().paired, true);
  const r = await m2.e.sendJob(args);
  assert.equal(r.ok, true, r.why);
  await w.sync(m2, o2);
  assert.equal(runs(o2).length, 1, "the restarted other computer takes the job");
});

await ok("a Mac that cannot read its kept key without asking says so and asks to pair again", async () => {
  const { w, main } = await paired();
  const m2 = w.mk("main");
  await m2.e.onMac(w.state({ ...main.kept()!, priv: "" }));
  assert.equal(m2.e.view().paired, false);
  assert.match(m2.e.view().note, /Pair again/);
});

await ok("job round trip: sealed, run on the other computer, bundle checked and landed, the vault tidied", async () => {
  const { w, main, other } = await paired();
  const r = await main.e.sendJob({ ...args, minutes: 20, tool: "codex" });
  assert.equal(r.ok, true, r.why);
  assert.ok(!JSON.stringify(w.vault.get(`sojob-${r.id}`)).includes("sort stable"), "the job is sealed in the vault");
  await w.sync(main, other);
  const run = runs(other)[0];
  assert.equal(run.job.id, r.id); assert.equal(run.job.tool, "codex"); assert.equal(run.job.minutes, 20); assert.equal(run.job.prompt, args.prompt);
  assert.equal(main.e.view().jobs[0].state, "accepted");
  await other.e.onMac({ type: "outsource", op: "progress", id: r.id, state: "running", step: "codex is working", startedAt: w.clock.t });
  await w.sync(main, other);
  assert.equal(main.e.view().jobs[0].state, "running"); assert.equal(main.e.view().jobs[0].step, "codex is working");
  const bytes = new Uint8Array(400_000).map((_, i) => (i * 7919 + (i >> 9)) & 255);
  const sha = await C.sha256hex(bytes);
  const nn = S.chunkCount(bytes.length);
  const report = JSON.stringify({ state: "done", commits: 2, summary: "Made the sort stable." });
  await other.e.onMac({ type: "outsource", op: "done", id: r.id, state: "done", report, exit: 0, bundle: { name: `${r.id}.bundle`, sha256: sha, size: bytes.length, n: nn } });
  for (let i = 0; i < nn; i++) await other.e.onMac({ type: "outsource", op: "chunk", id: r.id, i, b64: C.b64(bytes.slice(i * S.CHUNK, (i + 1) * S.CHUNK)) });
  assert.equal([...w.vault.values()].filter((d) => d.kind === "sfile").length, nn);
  assert.ok(!w.vault.has(`sjobst-${r.id}`), "the progress record goes once the result is there");
  await w.sync(main, other);
  const land = main.posts.find((p) => p.op === "land") as Extract<PageToMac, { op: "land" }>;
  assert.ok(land && land.bundle?.sha256 === sha);
  const got = main.posts.filter((p): p is Extract<PageToMac, { op: "chunk" }> => p.op === "chunk").map((p) => C.unb64(p.b64));
  assert.equal(await C.sha256hex(new Uint8Array(got.flatMap((x) => [...x]))), sha, "the bundle arrives whole");
  await main.e.onMac({ type: "outsource", op: "landed", id: r.id, path: "/tmp/results/x" });
  const row = main.e.view().jobs[0];
  assert.equal(row.state, "done"); assert.equal(row.path, "/tmp/results/x"); assert.match(row.report ?? "", /sort stable/);
  assert.equal([...w.vault.values()].filter((d) => d.kind === "sfile").length, 0, "the pieces leave the vault");
  assert.ok(w.vault.has(`sojob-${r.id}`), "the small job record stays for the list (30 days)");
});

await ok("a bundle with a wrong fingerprint is refused and never handed to the Mac", async () => {
  const { w, main, other } = await paired();
  const r = await main.e.sendJob(args);
  await w.sync(main, other);
  const bytes = C.randomBytes(1000);
  await other.e.onMac({ type: "outsource", op: "done", id: r.id, state: "done", report: "{}", bundle: { name: "x.bundle", sha256: "0".repeat(64), size: bytes.length, n: 1 } });
  await other.e.onMac({ type: "outsource", op: "chunk", id: r.id, i: 0, b64: C.b64(bytes) });
  await w.sync(main, other);
  assert.ok(!main.posts.some((p) => p.op === "land"));
  assert.match(main.e.view().note, /refused/);
});

await ok("a stranger's signature is refused: a job signed by any key but the paired main computer never runs", async () => {
  const { w, main, other } = await paired();
  const ok1 = keysOf(other), stranger = await S.makeKeys(keysOf(main).device);   // even with the main computer's device id
  const peerOther = { device: ok1.device, pub: ok1.pub, encPub: ok1.encPub, role: "secondary" as const };
  const forged = await S.makeJob(stranger, peerOther, args, { now: w.clock.t });
  w.vault.set(`sojob-${forged.body.id}`, { id: `sojob-${forged.body.id}`, kind: "sojob", data: { id: forged.body.id, to: ok1.device, from: stranger.device, at: w.clock.t, exp: forged.body.exp, env: forged.env, title: "x" } });
  // a real job, its sealed bytes changed by someone in the middle
  const real = await S.makeJob(keysOf(main), peerOther, args, { now: w.clock.t });
  const env = JSON.parse(JSON.stringify(real.env)); env.body.ct = env.body.ct.slice(0, -4) + (env.body.ct.endsWith("AAAA") ? "BBBB" : "AAAA");
  w.vault.set(`sojob-${real.body.id}`, { id: `sojob-${real.body.id}`, kind: "sojob", data: { id: real.body.id, to: ok1.device, from: keysOf(main).device, at: w.clock.t, exp: real.body.exp, env, title: "x" } });
  await w.sync(main, other);
  assert.equal(runs(other).length, 0);
  const why = (await S.acceptJob(forged.env, { keys: ok1, peer: { ...main.e._debug.peer()!, ...{ device: keysOf(main).device, pub: keysOf(main).pub, encPub: keysOf(main).encPub }, role: "primary" }, seen: {} })) as { ok: false; why: string };
  assert.equal(why.ok, false); assert.match(why.why, /signature/);
});

await ok("expired: a job nobody picked up in time is refused and shows as out of time", async () => {
  const { w, main, other } = await paired();
  const r = await main.e.sendJob(args);
  w.clock.t += 25 * HOUR;
  await w.sync(main, other);
  assert.equal(runs(other).length, 0);
  assert.ok(["refused", "timeout"].includes(main.e.view().jobs.find((x) => x.id === r.id)?.state ?? ""));
});

await ok("replay: the same signed job copied again, or seen again after a restart, never runs twice", async () => {
  const { w, main, other } = await paired();
  const r = await main.e.sendJob(args);
  await w.sync(main, other);
  assert.equal(runs(other).length, 1);
  const doc = w.vault.get(`sojob-${r.id}`)!;
  w.vault.set("sojob-copy", { ...doc, id: "sojob-copy" });
  await w.sync(main, other);
  assert.equal(runs(other).length, 1, "a copy under another record id is refused");
  const o2 = w.mk("other", { macKeep: (other as any).macKeep });
  await o2.e.onMac(w.state(o2.kept()));
  await w.sync(main, o2);
  assert.equal(runs(o2).length, 0, "after a restart the kept replay list still refuses it");
});

await ok("secrets: a job that looks like it holds a key is not sent, and a signed one with a secret is refused there", async () => {
  const { w, main, other } = await paired();
  for (const prompt of ["use sk-ant-abcdefghijklmnop1234 to call it", "password = hunter2hunter2", "-----BEGIN OPENSSH PRIVATE KEY-----", "token ghp_abcdefghijklmnopqrstuvwxyz123456"]) {
    const r = await main.e.sendJob({ ...args, prompt });
    assert.equal(r.ok, false, prompt); assert.match(r.why, /looks like/);
  }
  const r2 = await main.e.sendJob({ ...args, repo: "https://user:pass@example.com/x.git" });
  assert.equal(r2.ok, false);
  const k = keysOf(main), o = keysOf(other);
  const body = { v: 1, t: "job", id: "secretjob1", from: k.device, to: o.device, at: w.clock.t, exp: w.clock.t + HOUR, type: "claude", args: { ...args, prompt: "key AKIAABCDEFGHIJKLMNOP" } };
  const env = await S.signBody(k, body as never, o.encPub);
  w.vault.set("sojob-secretjob1", { id: "sojob-secretjob1", kind: "sojob", data: { id: "secretjob1", to: o.device, from: k.device, at: w.clock.t, exp: w.clock.t + HOUR, env, title: "x" } });
  await w.sync(main, other);
  assert.equal(runs(other).length, 0);
});

await ok("a result for a job the main computer never sent is ignored", async () => {
  const { w, main, other } = await paired();
  const env = await S.makeStatus(keysOf(other), { ...main.e._debug.peer()!, device: keysOf(main).device, encPub: keysOf(main).encPub, pub: keysOf(main).pub, role: "primary" }, { job: "nevernever1", state: "done", tail: "", summary: "{}" } as never);
  w.vault.set("sores-nevernever1", { id: "sores-nevernever1", kind: "sores", data: { job: "nevernever1", to: keysOf(main).device, from: keysOf(other).device, at: w.clock.t, env, final: true } });
  await w.sync(main, other);
  assert.equal(main.e.view().jobs.length, 0);
  assert.ok(!main.posts.some((p) => p.op === "land"));
});

await ok("cancel: a signed cancel reaches the other computer's Mac", async () => {
  const { w, main, other } = await paired();
  const r = await main.e.sendJob(args);
  await w.sync(main, other);
  assert.equal((await main.e.cancelJob(r.id)).ok, true);
  await w.sync(main, other);
  assert.ok(other.posts.some((p) => p.op === "cancel" && p.id === r.id));
  assert.equal((await main.e.cancelJob("notmine123")).ok, false);
});

await ok("signed restart: from the main computer or a paired phone only, fresh, once", async () => {
  const { w, main, other } = await paired();
  assert.equal((await main.e.restartOther("restart")).ok, true);
  await w.sync(main, other);
  assert.equal(restarts(other).length, 1);
  assert.equal(restarts(other)[0].kind, "restart"); assert.ok(restarts(other)[0].at > 0);
  // the phone pairs with a fresh code, then restarts
  const phone = w.mk("phone", { phone: true });
  assert.equal((await phone.e.enterCode("1234-5678", false)).ok, false, "a phone is never a main computer");
  const code = await other.e.startPairing();
  assert.equal((await phone.e.enterCodeAsPhone(code, "Phone")).ok, true);
  await w.sync(other, phone);
  assert.equal(other.e.view().phones, 1);
  assert.equal(other.e.view().peerName, "Main M4", "pairing a phone keeps the main computer");
  assert.equal((await phone.e.restartOther("restart")).ok, true);
  await w.sync(other, phone);
  assert.equal(restarts(other).length, 2);
  // the phone cannot send a job, even a signed one
  const pk = keysOf(phone), ok1 = keysOf(other);
  const pj = await S.makeJob(pk, { device: ok1.device, pub: ok1.pub, encPub: ok1.encPub, role: "secondary" }, args, { now: w.clock.t });
  w.vault.set(`sojob-${pj.body.id}`, { id: `sojob-${pj.body.id}`, kind: "sojob", data: { id: pj.body.id, to: ok1.device, from: pk.device, at: w.clock.t, exp: pj.body.exp, env: pj.env, title: "x" } });
  await w.sync(other, phone);
  assert.equal(runs(other).length, 0);
  // a stranger's command, a replayed one and an old one do nothing
  const stranger = await S.makeKeys();
  const sc = await S.makeCmd(stranger, { device: ok1.device, pub: ok1.pub, encPub: ok1.encPub, role: "secondary" }, "restart", { now: w.clock.t });
  w.vault.set("scmd-s", { id: "scmd-s", kind: "scmd", data: { id: sc.body.id, to: ok1.device, from: keysOf(main).device, at: w.clock.t, exp: sc.body.exp, env: sc.env } });
  const real = await S.makeCmd(keysOf(main), { device: ok1.device, pub: ok1.pub, encPub: ok1.encPub, role: "secondary" }, "restart", { now: w.clock.t });
  w.vault.set("scmd-r1", { id: "scmd-r1", kind: "scmd", data: { id: real.body.id, to: ok1.device, from: keysOf(main).device, at: w.clock.t, exp: real.body.exp, env: real.env } });
  await w.sync(other);
  assert.equal(restarts(other).length, 3, "the fresh real one runs");
  w.vault.set("scmd-r2", { id: "scmd-r2", kind: "scmd", data: { id: real.body.id, to: ok1.device, from: keysOf(main).device, at: w.clock.t, exp: real.body.exp, env: real.env } });
  await w.sync(other);
  assert.equal(restarts(other).length, 3, "a replayed command is refused");
  const old = await S.makeCmd(keysOf(main), { device: ok1.device, pub: ok1.pub, encPub: ok1.encPub, role: "secondary" }, "restart", { now: w.clock.t });
  w.clock.t += 3 * MIN;
  w.vault.set("scmd-old", { id: "scmd-old", kind: "scmd", data: { id: old.body.id, to: ok1.device, from: keysOf(main).device, at: old.body.at, exp: old.body.exp, env: old.env } });
  await w.sync(other);
  assert.equal(restarts(other).length, 3, "an expired command is refused");
});

await ok("awake and ready: change only status, a still here every 10 minutes, silent for 26 minutes means not heard from", async () => {
  const { w, main, other } = await paired();
  await w.sync(main, other);
  assert.equal(main.e.view().online, true);
  const count = () => w.puts.filter((p) => p === "other:sstat").length;
  const c0 = count();
  await other.e.tick(); await other.e.tick();
  assert.equal(count(), c0, "nothing changed, nothing written");
  await other.e.onMac({ type: "outsource", op: "power", awake: true, locked: true });
  assert.equal(count(), c0 + 1, "a change is written at once");
  await w.sync(main, other);
  assert.equal(main.e.view().status?.locked, true);
  w.clock.t += 11 * MIN; await other.e.tick();
  assert.equal(count(), c0 + 2, "a still here after 10 minutes");
  w.clock.t += 26 * MIN;
  assert.equal(main.e.view().online, false);
});

await ok("the command line: status, send, list, result with the bundle line, cancel; never when not paired", async () => {
  const { w, main, other } = await paired();
  const ans = () => main.posts.filter((p): p is Extract<PageToMac, { op: "cli-answer" }> => p.op === "cli-answer").pop()!;
  await main.e.onMac({ type: "outsource", op: "cli", req: "r1", cmd: { cmd: "status" } });
  assert.match(ans().text, /awake and ready/);
  await main.e.onMac({ type: "outsource", op: "cli", req: "r2", cmd: { cmd: "send", ...args } });
  assert.equal(ans().ok, true); const id = ans().id!;
  await main.e.onMac({ type: "outsource", op: "cli", req: "r3", cmd: { cmd: "send", ...args, prompt: "export API_KEY=abcdef123456789" } });
  assert.equal(ans().ok, false);
  await w.sync(main, other);
  await other.e.onMac({ type: "outsource", op: "done", id, state: "done", report: JSON.stringify({ summary: "ok" }), bundle: { name: `${id}.bundle`, sha256: await C.sha256hex(new Uint8Array([1, 2, 3])), size: 3, n: 1 } });
  await other.e.onMac({ type: "outsource", op: "chunk", id, i: 0, b64: C.b64(new Uint8Array([1, 2, 3])) });
  await w.sync(main, other);
  await main.e.onMac({ type: "outsource", op: "landed", id, path: "/tmp/r" });
  await main.e.onMac({ type: "outsource", op: "cli", req: "r4", cmd: { cmd: "result", id } });
  assert.match(ans().text, new RegExp(`Bundle: /tmp/r/${id}.bundle`));
  await main.e.onMac({ type: "outsource", op: "cli", req: "r5", cmd: { cmd: "list" } });
  assert.match(ans().text, new RegExp(id));
  const lone = w.mk("lone"); await lone.e.onMac(w.state(null));
  await lone.e.onMac({ type: "outsource", op: "cli", req: "r6", cmd: { cmd: "send", ...args } });
  assert.equal((lone.posts.pop() as { ok: boolean }).ok, false);
});

await ok("unpair forgets the peer and its phones; the keys stay so pairing again is quick", async () => {
  const { main, other } = await paired();
  const dev = keysOf(other).device;
  await other.e.unpair();
  assert.equal(other.e.view().paired, false);
  assert.equal(other.kept()?.device, dev);
  assert.equal(other.kept()?.peer, undefined);
  void main;
});

await ok("envelopes: an old style envelope is refused, a body sealed for one pair cannot be moved to another", async () => {
  const a = await S.makeKeys(), b = await S.makeKeys(), c = await S.makeKeys();
  const peerA = { device: a.device, pub: a.pub, encPub: a.encPub, role: "primary" as const };
  const body = { v: 1, t: "msg", id: "msg1234", from: a.device, to: b.device, at: 1, text: "hello" };
  const env = await S.signBody(a, body as never, b.encPub);
  assert.equal((await S.openEnv(b, env, peerA)).ok, true);
  assert.equal((await S.openEnv(c, env, peerA)).ok, false, "not sealed for c");
  assert.equal((await S.openEnv(b, { ...env, v: 1 }, peerA)).ok, false, "old version refused");
  assert.equal((await S.openEnv(b, { ...env, sig: env.sig.slice(0, -3) + "AAA" }, peerA)).ok, false, "a changed signature");
  assert.ok(!JSON.stringify(env).includes("hello"));
});

await ok("looksSecret: real looking secrets are caught, normal words are not", () => {
  for (const s of ["sk-ant-api03-abcdefghijklmnopqrstuv", "ghp_abcdefghijklmnopqrstuvwxyz0123", "AKIAIOSFODNN7EXAMPLE", "password: correcthorse", "-----BEGIN RSA PRIVATE KEY-----", "https://u:p4ss@example.com/x", "Bearer abcdefghijklmnopqrstuvwxyz123456", "export STRIPE_SECRET=abc123def456"]) assert.notEqual(S.looksSecret(s), "", s);
  for (const s of ["Fix the token bucket rate limiter and add tests", "Rename the password field label", "commit 3f2a9c1d4e5b6a7f8091a2b3c4d5e6f708192a3b", "Make the sort stable."]) assert.equal(S.looksSecret(s), "", s);
});

await ok("repoOk and checkJob: no credentials in links, no paths that climb out, limits", () => {
  for (const r of ["ps-app", "https://github.com/example/ps-app.git", "git@github.com:example/ps-app.git", "ssh://git@example.com/x.git"]) assert.equal(S.repoOk(r), "", r);
  for (const r of ["../etc", "/Users/x/repo", "~/repo", "file:///tmp/x", "ext::sh -c x", "https://tok@github.com/x", "a b"]) assert.notEqual(S.repoOk(r), "", r);
  const base = { v: 1, t: "job", id: "abcdef12", from: "a", to: "b", at: 1000, exp: 1000 + HOUR, type: "claude", args };
  assert.equal(S.checkJob(base, 2000), "");
  assert.match(S.checkJob({ ...base, exp: 1000 + 30 * HOUR }, 2000), /too long/);
  assert.match(S.checkJob({ ...base, args: { ...args, base: "--upload-pack=x" } }, 2000), /base/);
  assert.match(S.checkJob({ ...base, args: { ...args, minutes: 999 } }, 2000), /time limit/);
});

console.log(`${n} passed`);
