// Run: node --experimental-strip-types tests/outsource.test.ts
// Outsource work to your other computer (src/core/second.ts rules, src/core/outsource.ts engine, PS 1.65) with a FAKE second computer:
// one fake vault shared by two engines, no network, no Mac, FICTIONAL data only.
import assert from "node:assert/strict";
const S = await import("../src/core/second.ts");
const O = await import("../src/core/outsource.ts");
const C = await import("../src/core/crypto.ts");
import type { PageToMac, MacToPage } from "../src/core/secondbridge.ts";

let n = 0;
const ok = async (name: string, fn: () => unknown) => { await fn(); n++; console.log("ok -", name); };
const MIN = 60_000, HOUR = 3600_000;

type Rec = { id: string; kind: string; data: any };
function world(start = Date.UTC(2026, 10, 17, 10, 0, 0)) {
  const vault = new Map<string, Rec>();
  const clock = { t: start };
  const puts: string[] = [];
  const pokes: string[] = [];
  const mk = (label: string, saved?: Map<string, string>) => {
    const kv = saved ?? new Map<string, string>();
    const posts: PageToMac[] = [];
    const store = {
      docs: (kind: string) => [...vault.values()].filter((d) => d.kind === kind).map((d) => ({ ...d, ws: null, author: null, updatedAt: null })),
      put: async (kind: string, data: unknown, id: string) => { vault.set(id, { id, kind, data: JSON.parse(JSON.stringify(data)) }); puts.push(`${label}:${kind}`); return id; },
      remove: async (id: string) => { vault.delete(id); },
      poke: (k: string) => { pokes.push(`${label}:${k}`); },
    };
    const local = { get: (k: string) => kv.get(k) ?? null, set: (k: string, v: string) => { kv.set(k, v); }, del: (k: string) => { kv.delete(k); } };
    const e = O.createEngine({ store: store as any, post: (m) => posts.push(m), local, now: () => clock.t, native: true });
    return { e, posts, kv, label };
  };
  const sync = async (...xs: { e: ReturnType<typeof O.createEngine> }[]) => { for (let i = 0; i < 2; i++) for (const x of xs) await x.e.onVault(); };
  return { vault, clock, puts, pokes, mk, sync };
}
async function paired() {
  const w = world();
  const main = w.mk("main"), other = w.mk("other");
  await other.e.onMac({ type: "outsource", op: "state", v: 1, keep: null, app: "1.65", model: "MacBook Air", chip: "M1", name: "Old M1", helper: "approved", awake: true, locked: false, cli: ["claude", "git"], folder: "/x" });
  const code = await other.e.startPairing("Old M1");
  const r = await main.e.enterCode(code, false, "Main M4");
  assert.equal(r.ok, true);
  await w.sync(main, other);
  return { w, main, other, code };
}
const args = { title: "Fix the sort bug", repo: "ps-app", base: "abc1234", prompt: "Make the sort stable and add a test." };

await ok("pairing: wrong code refused, right code pairs both, offer is cleaned up", async () => {
  const w = world();
  const main = w.mk("main"), other = w.mk("other");
  const code = await other.e.startPairing("Old M1");
  assert.match(code, /^\d{4}-\d{4}$/);
  assert.equal((await main.e.enterCode("0000-0000")).ok, false);
  assert.equal((await main.e.enterCode("12")).ok, false);
  assert.equal(other.e.view().paired, false);
  assert.equal((await main.e.enterCode(code)).ok, true);
  await w.sync(main, other);
  assert.equal(main.e.view().paired, true);
  assert.equal(other.e.view().paired, true);
  assert.equal(main.e.view().peerName, "Old M1");
  assert.equal(other.e.view().role, "other");
  assert.equal(main.e.view().role, "main");
  assert.ok(![...w.vault.values()].some((d) => d.kind === "spair"), "pairing records are gone");
  assert.ok(![...w.vault.values()].some((d) => JSON.stringify(d.data).includes(code.replace("-", ""))), "the code is never in the vault");
  assert.ok(main.posts.some((p) => p.type === "outsource" && p.op === "keep"), "the Mac is told to keep the pairing");
});

await ok("an old code stops working after 10 minutes", async () => {
  const w = world();
  const main = w.mk("main"), other = w.mk("other");
  const code = await other.e.startPairing();
  w.clock.t += 11 * MIN;
  assert.equal((await main.e.enterCode(code)).ok, false);
});

await ok("staying paired: a new engine from the same saved data is still paired (nothing ties it to a version)", async () => {
  const { w, main } = await paired();
  const again = w.mk("main2", main.kv);
  assert.equal(again.e.view().paired, true);
  assert.equal(again.e.view().role, "main");
  assert.ok(!JSON.stringify([...main.kv.values()]).match(/1\.6\d/), "no app version in the saved pairing");
});

await ok("job round trip with a bundle: signed, sealed, run, result and bundle verified and landed", async () => {
  const { w, main, other } = await paired();
  const sent = await main.e.sendJob(args);
  assert.equal(sent.ok, true);
  const raw = JSON.stringify([...w.vault.values()]);
  assert.ok(!raw.includes("sort stable"), "the prompt is sealed in the vault record");
  await w.sync(main, other);
  const run = other.posts.find((p) => p.type === "outsource" && p.op === "run") as Extract<PageToMac, { op: "run" }>;
  assert.ok(run);
  assert.equal(run.job.prompt, args.prompt);
  assert.equal(run.job.repo, "ps-app");
  assert.equal(run.job.tool, "claude");
  assert.ok(run.job.expiresAt > w.clock.t);
  // the other computer works
  await other.e.onMac({ type: "outsource", op: "progress", id: sent.id, state: "running", step: "tests", tail: "ok", startedAt: w.clock.t });
  await w.sync(main, other);
  assert.equal(main.e.view().jobs[0].state, "running");
  const bundle = new Uint8Array(S.CHUNK + 1000).map((_, i) => i % 251);
  const sha = await C.sha256hex(bundle);
  const m = (x: MacToPage) => other.e.onMac(x);
  await m({ type: "outsource", op: "done", id: sent.id, state: "done", report: "Fixed it. 2 commits.", bundle: { name: "job.bundle", sha256: sha, size: bundle.length, n: 2 } });
  await m({ type: "outsource", op: "chunk", id: sent.id, i: 0, b64: C.b64(bundle.slice(0, S.CHUNK)) });
  await m({ type: "outsource", op: "chunk", id: sent.id, i: 1, b64: C.b64(bundle.slice(S.CHUNK)) });
  await w.sync(main, other);
  const land = main.posts.find((p) => p.type === "outsource" && p.op === "land") as Extract<PageToMac, { op: "land" }>;
  assert.ok(land, "main asks its Mac to land the bundle");
  assert.equal(land.report, "Fixed it. 2 commits.");
  const chunks = main.posts.filter((p) => p.type === "outsource" && p.op === "chunk") as Extract<PageToMac, { op: "chunk" }>[];
  assert.equal(chunks.length, 2);
  const got = new Uint8Array([...C.unb64(chunks[0].b64), ...C.unb64(chunks[1].b64)]);
  assert.equal(await C.sha256hex(got), sha);
  await main.e.onMac({ type: "outsource", op: "landed", id: sent.id, path: "/Outsource/job.bundle" });
  const row = main.e.view().jobs[0];
  assert.equal(row.state, "done");
  assert.equal(row.report, "Fixed it. 2 commits.");
  assert.equal(row.path, "/Outsource/job.bundle");
});

await ok("a tampered bundle (wrong fingerprint) is refused and never reaches the Mac", async () => {
  const { w, main, other } = await paired();
  const sent = await main.e.sendJob(args);
  await w.sync(main, other);
  const bytes = new Uint8Array(100).fill(7);
  await other.e.onMac({ type: "outsource", op: "done", id: sent.id, state: "done", report: "r", bundle: { name: "a.bundle", sha256: "0".repeat(64), size: 100, n: 1 } });
  await other.e.onMac({ type: "outsource", op: "chunk", id: sent.id, i: 0, b64: C.b64(bytes) });
  await w.sync(main, other);
  assert.ok(!main.posts.some((p) => p.type === "outsource" && p.op === "chunk"));
});

await ok("a job signed by a stranger is refused (not run, nothing leaks)", async () => {
  const { w, main, other } = await paired();
  const stranger = await S.makeKeys("stranger-device");
  const otherKeys = other.e._debug.keys()!;
  const peerFake = { device: otherKeys.device, pub: otherKeys.pub, encPub: otherKeys.encPub, role: "secondary" as const };
  const { env } = await S.makeJob(stranger, peerFake, args, { now: w.clock.t });
  w.vault.set("sojob-evil", { id: "sojob-evil", kind: "sojob", data: { id: "evil-1", to: otherKeys.device, from: "stranger-device", at: w.clock.t, exp: w.clock.t + HOUR, env, title: "x" } });
  await w.sync(main, other);
  assert.ok(!other.posts.some((p) => p.type === "outsource" && p.op === "run"));
  // claiming to be the main computer but signed with the stranger's key
  const mainDev = main.e._debug.keys()!.device;
  const forged = await S.signBody({ ...stranger, device: mainDev }, { v: 1, t: "job", id: "forged-job-1", from: mainDev, to: otherKeys.device, at: w.clock.t, exp: w.clock.t + HOUR, type: "claude", args } as any, otherKeys.encPub);
  w.vault.set("sojob-forged", { id: "sojob-forged", kind: "sojob", data: { id: "forged-job-1", to: otherKeys.device, from: mainDev, at: w.clock.t, exp: w.clock.t + HOUR, env: forged, title: "x" } });
  await w.sync(main, other);
  assert.ok(!other.posts.some((p) => p.type === "outsource" && p.op === "run"), "forged signature refused");
});

await ok("a job addressed to another computer cannot be opened", async () => {
  const { w, main, other } = await paired();
  const k = main.e._debug.keys()!, p = main.e._debug.peer()!;
  const third = await S.makeKeys("third");
  const { env } = await S.makeJob(k, { ...p, device: "third", encPub: third.encPub }, args, { now: w.clock.t });
  const res = await S.acceptJob(env, { keys: other.e._debug.keys()!, peer: { device: k.device, pub: k.pub, encPub: k.encPub, role: "primary" }, seen: {}, now: w.clock.t });
  assert.equal(res.ok, false);
});

await ok("an expired job is refused", async () => {
  const { w, main, other } = await paired();
  const t0 = w.clock.t;
  const k = main.e._debug.keys()!, p = main.e._debug.peer()!;
  const { env } = await S.makeJob(k, p, args, { now: t0, ttlMs: HOUR });
  const ctx = { keys: other.e._debug.keys()!, peer: { device: k.device, pub: k.pub, encPub: k.encPub, role: "primary" as const }, seen: {} };
  const late = await S.acceptJob(env, { ...ctx, now: t0 + 2 * HOUR });
  assert.equal(late.ok, false);
  assert.match((late as any).why, /expired/);
  const fresh = await S.acceptJob(env, { ...ctx, now: t0 + 10 * MIN });
  assert.equal(fresh.ok, true);
  // and a job from far in the future
  const { env: fut } = await S.makeJob(k, p, args, { now: t0 + 3 * HOUR });
  assert.equal((await S.acceptJob(fut, { ...ctx, now: t0 })).ok, false);
  // end to end through the engine: the job sits unread for 2 hours
  await main.e.sendJob(args, { now: t0 });
  w.clock.t = t0 + 7 * HOUR;   // nobody picked it up
  await w.sync(other);
  assert.ok(!other.posts.some((p) => p.type === "outsource" && p.op === "run"), "an expired job never runs");
});

await ok("a replayed job is refused, also after a restart of the other computer's page", async () => {
  const { w, main, other } = await paired();
  const sent = await main.e.sendJob(args);
  await w.sync(main, other);
  assert.equal(other.posts.filter((p) => p.type === "outsource" && p.op === "run").length, 1);
  const rec = w.vault.get(`sojob-${sent.id}`)!;
  w.vault.set("sojob-copy", { id: "sojob-copy", kind: "sojob", data: rec.data });   // the same sealed job again
  await w.sync(main, other);
  assert.equal(other.posts.filter((p) => p.type === "outsource" && p.op === "run").length, 1, "same job twice runs once");
  const reborn = w.mk("other2", other.kv);   // PS restarted: a new page, same saved data
  await reborn.e.onVault();
  assert.equal(reborn.posts.filter((p) => p.type === "outsource" && p.op === "run").length, 0, "no re run after a restart");
  const refused = [...w.vault.values()].filter((d) => d.kind === "sores");
  assert.ok(refused.length >= 1, "the main computer is told it was refused");
  await w.sync(main);
  assert.ok(main.e.view().jobs.some((x) => x.id === sent.id));
});

await ok("a secret in a job is refused on the main computer and on the other one", async () => {
  const { w, main, other } = await paired();
  const bad = await main.e.sendJob({ ...args, prompt: "deploy with sk-abcdefghijklmnopqrstuvwx" });
  assert.equal(bad.ok, false);
  assert.match(bad.why, /API key/);
  assert.equal((await main.e.sendJob({ ...args, repo: "https://user:pw123456@example.com/a/b.git" })).ok, false);
  // a main computer that skips its own check still cannot get a secret run
  const k = main.e._debug.keys()!, p = main.e._debug.peer()!;
  const body: any = { v: 1, t: "job", id: "secret-job-1", from: k.device, to: p.device, at: w.clock.t, exp: w.clock.t + HOUR, type: "claude", args: { ...args, prompt: "token ghp_" + "a".repeat(30) } };
  const env = await S.signBody(k, body, p.encPub);
  const res = await S.acceptJob(env, { keys: other.e._debug.keys()!, peer: { device: k.device, pub: k.pub, encPub: k.encPub, role: "primary" }, seen: {}, now: w.clock.t });
  assert.equal(res.ok, false);
  assert.match((res as any).why, /GitHub token/);
});

await ok("restart command: signed, runs once, replay and expiry and strangers refused", async () => {
  const { w, main, other } = await paired();
  const r = await main.e.restartOther("restart");
  assert.equal(r.ok, true);
  await w.sync(main, other);
  assert.equal(other.posts.filter((p) => p.type === "outsource" && p.op === "restart").length, 1);
  const rec = [...w.vault.values()].find((d) => d.kind === "scmd")!;
  w.vault.set("scmd-copy", { id: "scmd-copy", kind: "scmd", data: rec.data });
  await w.sync(main, other);
  assert.equal(other.posts.filter((p) => p.type === "outsource" && p.op === "restart").length, 1, "replay refused");
  // a stranger
  const stranger = await S.makeKeys("stranger-x");
  const ok2 = other.e._debug.keys()!;
  const { env, body } = await S.makeCmd(stranger, { device: ok2.device, pub: ok2.pub, encPub: ok2.encPub, role: "secondary" }, "restart", { now: w.clock.t });
  w.vault.set("scmd-evil", { id: "scmd-evil", kind: "scmd", data: { id: body.id, to: ok2.device, from: "stranger-x", at: w.clock.t, exp: body.exp, env } });
  await w.sync(main, other);
  assert.equal(other.posts.filter((p) => p.type === "outsource" && p.op === "restart").length, 1, "stranger refused");
  // too old
  const k = main.e._debug.keys()!, p = main.e._debug.peer()!;
  const { env: old } = await S.makeCmd(k, p, "restart", { now: w.clock.t });
  const res = await S.acceptCmd(old, { keys: ok2, peer: { device: k.device, pub: k.pub, encPub: k.encPub, role: "primary" }, seen: {}, now: w.clock.t + 10 * MIN });
  assert.equal(res.ok, false);
  // shutdown also works
  await main.e.restartOther("shutdown"); await w.sync(main, other);
  assert.ok(other.posts.some((x) => x.type === "outsource" && x.op === "restart" && x.kind === "shutdown"));
});

await ok("the phone: pairs with the other computer's code, then its restart is accepted; the phone cannot send jobs", async () => {
  const { w, main, other } = await paired();
  const phone = w.mk("phone");
  const code = await other.e.startPairing();
  assert.equal((await phone.e.enterCodeAsPhone(code, "My phone")).ok, true);
  await w.sync(phone, other, main);
  assert.equal(other.e.view().phones, 1);
  assert.equal(other.e.view().peerName, "Main M4", "the main computer stays the paired main one");
  assert.equal((await phone.e.restartOther("restart")).ok, true);
  await w.sync(phone, other);
  assert.equal(other.posts.filter((p) => p.type === "outsource" && p.op === "restart").length, 1);
  assert.equal((await phone.e.sendJob(args)).ok, false);
  // a phone job smuggled into the vault is not run
  const k = phone.e._debug.keys()!, p = phone.e._debug.peer()!;
  const { env } = await S.makeJob(k, p, args, { now: w.clock.t });
  w.vault.set("sojob-phone", { id: "sojob-phone", kind: "sojob", data: { id: "ph-1", to: p.device, from: k.device, at: w.clock.t, exp: w.clock.t + HOUR, env, title: "x" } });
  await w.sync(other);
  assert.ok(!other.posts.some((x) => x.type === "outsource" && x.op === "run"));
});

await ok("a result from a stranger, or for a job we never sent, is refused", async () => {
  const { w, main, other } = await paired();
  const mk = main.e._debug.keys()!, mp = main.e._debug.peer()!;
  const ok2 = other.e._debug.keys()!, op = other.e._debug.peer()!;
  const envOk = await S.makeStatus(ok2, op, { job: "never-sent-1", state: "done", tail: "" } as any);
  const a = await S.acceptResult(envOk, { keys: mk, peer: mp, seen: {} }, () => false);
  assert.equal(a.ok, false);
  const stranger = await S.makeKeys("s2");
  const envBad = await S.makeStatus({ ...stranger, device: ok2.device }, { device: mk.device, pub: mk.pub, encPub: mk.encPub, role: "primary" }, { job: "j-1", state: "done", tail: "" } as any);
  const b = await S.acceptResult(envBad, { keys: mk, peer: mp, seen: {} }, () => true);
  assert.equal(b.ok, false);
  void w;
});

await ok("change only sync: an unchanged status does not write again before 2 minutes", async () => {
  const { w, other } = await paired();
  await new Promise((r) => setTimeout(r, 30));   // let the pairing time status finish
  const before = w.puts.filter((x) => x === "other:sstat").length;
  await other.e.tick(); await other.e.tick();
  assert.equal(w.puts.filter((x) => x === "other:sstat").length, before);
  w.clock.t += 3 * MIN;
  await other.e.tick();
  assert.equal(w.puts.filter((x) => x === "other:sstat").length, before + 1);
});

await ok("awake and ready status reaches the main computer; silent for 6 minutes means offline", async () => {
  const { w, main, other } = await paired();
  await other.e.tick();
  await new Promise((r) => setTimeout(r, 30));
  await w.sync(main, other);
  assert.equal(main.e.view().online, true);
  assert.equal(main.e.view().status?.awake, true);
  w.clock.t += 6 * MIN;
  assert.equal(main.e.view().online, false);
});

await ok("unpair forgets the peer on that computer and tells the Mac", async () => {
  const { main } = await paired();
  await main.e.unpair();
  assert.equal(main.e.view().paired, false);
  assert.ok(main.posts.some((p) => p.type === "outsource" && p.op === "forget"));
  assert.equal((await main.e.sendJob(args)).ok, false);
});

await ok("the command line asks the engine: status, send, list", async () => {
  const { w, main, other } = await paired();
  await main.e.onMac({ type: "outsource", op: "cli", req: "r1", cmd: { cmd: "send", ...args } });
  await main.e.onMac({ type: "outsource", op: "cli", req: "r2", cmd: { cmd: "list" } });
  const ans = main.posts.filter((p) => p.type === "outsource" && p.op === "cli-answer") as Extract<PageToMac, { op: "cli-answer" }>[];
  assert.equal(ans[0].ok, true);
  assert.match(ans[1].text, /sent/);
  void w; void other;
});

// ---------- the plain rules ----------
await ok("looksSecret: real looking secrets are caught, normal words are not", () => {
  for (const s of ["-----BEGIN RSA PRIVATE KEY-----", "sk-ant1234567890abcdefghij", "github_pat_" + "a".repeat(30), "AKIA" + "A".repeat(16), "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abc",
    "https://bob:hunter22@example.com/x", "password = correcthorse", "export API_TOKEN=abcdef123456", "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123", "sb_secret_abcdefgh12345"])
    assert.notEqual(S.looksSecret(s), "", s);
  for (const s of ["Fix the sort bug in tasks.ts", "commit 0123456789abcdef0123456789abcdef01234567", "Add a test for the password reset screen", "see https://example.com/docs", ""])
    assert.equal(S.looksSecret(s), "", s);
});
await ok("repoOk, secretPath, sharePathOk, fileRefusal", () => {
  assert.equal(S.repoOk("ps-app"), ""); assert.equal(S.repoOk("https://example.com/a/b.git"), ""); assert.equal(S.repoOk("git@example.com:a/b.git"), "");
  for (const r of ["../x", "/etc", "~/x", "https://u:p@example.com/a", "file:///x", "", "a b"]) assert.notEqual(S.repoOk(r), "", r);
  assert.equal(S.secretPath(".env"), true); assert.equal(S.secretPath("a/.ssh/id_rsa"), true); assert.equal(S.secretPath("src/app.ts"), false); assert.equal(S.secretPath("x/cert.pem"), true);
  assert.equal(S.sharePathOk("a/b.txt"), true); assert.equal(S.sharePathOk("../b"), false); assert.equal(S.sharePathOk("/etc/passwd"), false); assert.equal(S.sharePathOk(".env"), false);
  assert.notEqual(S.fileRefusal("a.pem", 10), ""); assert.notEqual(S.fileRefusal("a.txt", S.FILE_MAX + 1), ""); assert.equal(S.fileRefusal("a.txt", 10), "");
});
await ok("small helpers: sizes, names, times, links, reboot settings", () => {
  assert.equal(S.fmtSize(0), "0 B"); assert.equal(S.fmtSize(1536), "1.5 KB"); assert.equal(S.fmtSize(5 * S.MB), "5.0 MB");
  assert.equal(S.cleanName("../a/b<c>.txt"), "bc.txt"); assert.equal(S.cleanName(""), "file");
  assert.equal(S.freeName("a.txt", (x) => x === "a.txt"), "a 2.txt");
  assert.equal(S.seenText(1000, 1000 + 10_000), "just now"); assert.equal(S.seenText(0), "never"); assert.equal(S.seenText(1, 1 + 5 * MIN), "5 min ago");
  assert.equal(S.isOnline({ at: 100 }, 100 + MIN), true); assert.equal(S.isOnline({ at: 100 }, 100 + 6 * MIN), false); assert.equal(S.isOnline(null), false);
  assert.deepEqual(S.parseShareLink(S.shareLink("d1", "docs", "a b/c.txt")), { device: "d1", root: "docs", path: "a b/c.txt" });
  assert.deepEqual(S.rebootSet({ mode: "active", minutes: 99999 }), { mode: "active", minutes: 1440 }); assert.equal(S.rebootSet(null).mode, "off");
  assert.equal(S.tail("a\nb\nc".repeat(100), 20).length <= 20, true);
  assert.equal(S.outsourceTitle({ args: { title: "  Hello   world " } }), "Hello world");
});
await ok("codes: 8 digits, pairing proof needs the right code", async () => {
  const c = S.makeCode(); assert.equal(S.codeOk(c), true);
  assert.notEqual(await S.pairCode(c, "d", "p"), await S.pairCode("0000-0000", "d", "p"));
  assert.equal(await S.pairCode("1234-5678", "d", "p"), await S.pairCode("12345678", "d", "p"));
});

console.log(`${n} passed`);
