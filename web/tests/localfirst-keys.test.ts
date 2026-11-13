// Run: node --experimental-strip-types tests/localfirst-keys.test.ts
// Local first (V1.44): the key holders' message protocol with the Mac and phone shells (core/localholders.ts), with a
// fake shell, and the guards in the vault engine and the app that keep the local copy safe (source checks, as
// tests/own-project.test.ts does for the project gates).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as C from "../src/core/crypto.ts";
import { localKeyMessage, shellHolder } from "../src/core/localholders.ts";
import { createLocalVault, openLocalVault, type KV } from "../src/core/localstore.ts";

const tests: [string, () => Promise<void>][] = [];
const ok = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

/** A fake shell: answers each request the way LocalKey.swift / LocalKey.kt would, a moment later. */
function fakeShell() {
  const sh = { key: null as Uint8Array | null, mode: "ok" as "ok" | "denied" | "silent" | "broken", posts: [] as string[] };
  const post = (m: object) => {
    const o = m as { type: string; req: string };
    sh.posts.push(o.type);
    if (sh.mode === "silent") return;   // an older shell that does not know the message
    setTimeout(() => {
      const op = o.type.replace("localkey:", "");
      let a: Record<string, unknown>;
      if (sh.mode === "broken") a = { status: "error", error: "nope" };
      else if (op === "create") {
        if (sh.key) a = { status: "error", error: "A key is already there." };
        else { sh.key = C.randomBytes(32); a = { status: "ok", key: C.b64(sh.key) }; }
      } else if (op === "forget") { sh.key = null; a = { status: "missing" }; }
      else if (!sh.key) a = { status: "missing" };
      else if (sh.mode === "denied" && op !== "allow") a = { status: "denied" };
      else a = { status: "ok", key: C.b64(sh.key) };
      localKeyMessage({ type: "localkey", req: o.req, ...a });
    }, 5);
  };
  return { sh, post };
}
function memKV(): KV {
  const m = new Map<string, unknown>();
  return {
    async get<T>(k: string) { return structuredClone(m.get(k)) as T | undefined; },
    async set(k: string, v: unknown) { m.set(k, structuredClone(v)); },
    async setMany(e: [string, unknown][]) { for (const [k, v] of e) m.set(k, structuredClone(v)); },
    async del(k: string) { m.delete(k); },
  };
}

ok("the Keychain holder: missing, create, ok, denied, allow; an older shell is unavailable, never missing", async () => {
  const { sh, post } = fakeShell();
  const h = shellHolder("keychain", post, 300);
  assert.equal((await h.get()).status, "missing");
  const k = await h.create();
  assert.equal(k.extractable, false, "the key in the page cannot be read back out");
  assert.equal((await h.get()).status, "ok");
  await assert.rejects(h.create(), /already there/, "never a second key over the first");
  sh.mode = "denied";
  assert.equal((await h.get()).status, "denied");
  assert.equal((await h.allow()).status, "ok", "Allow reads it with the person's OK");
  sh.mode = "broken";
  assert.equal((await h.get()).status, "denied", "an error is treated as there but unreadable: never a new key");
  sh.mode = "silent";
  assert.equal((await h.get()).status, "unavailable");
  await assert.rejects(h.create());
});

ok("a local vault on the Mac opens after a new build is allowed, and is never remade", async () => {
  const { sh, post } = fakeShell();
  const kv = memKV();
  const h = shellHolder("keychain", post, 300);
  const { head } = await createLocalVault(kv, [h], "Sam");
  sh.mode = "denied";                                   // a new PS build, not allowed yet
  const d = await openLocalVault(kv, [h]);
  assert.equal(d.status, "denied");
  await assert.rejects(createLocalVault(kv, [h], "Sam"), /already data/);
  await h.allow();
  sh.mode = "ok";
  const o = await openLocalVault(kv, [h]);
  assert.equal(o.status, "ok");
  if (o.status === "ok") assert.equal(o.head.id, head.id);
  assert.equal(sh.posts.filter((p) => p === "localkey:create").length, 1, "one key, made once");
});

ok("a stray or forged answer opens nothing", async () => {
  assert.equal(localKeyMessage({ type: "localkey", req: "nobody-asked", status: "ok", key: C.b64(C.randomBytes(32)) }), true);
  assert.equal(localKeyMessage({ type: "other" }), false);
  const { post } = fakeShell();
  const h = shellHolder("keystore", (m) => { post(m); }, 300);
  assert.equal((await h.get()).status, "missing");
});

// ---------- the guards around the local copy ----------
ok("the vault engine: local mode never talks to a server and signing out never deletes the local copy", async () => {
  const v = read("src/core/vault.ts");
  assert.match(v, /async function flush\(\) \{\s*if \(meta\?\.local\) return localFlush\(\);/, "saves commit on the device");
  assert.match(v, /async function pull\(\) \{\s*if \(!meta \|\| meta\.local \|\| !navigator\.onLine\) return;/, "no pull");
  assert.match(v, /export async function signOutAndForget\(\) \{\s*if \(meta\?\.local\) \{ lock\(\); return; \}/, "sign out keeps it");
  assert.match(v, /if \(meta\.local\) \{ await localKv\.setMany\(\[\[kMeta\(meta\.login\), meta\], \[kRows\(meta\.login\)/, "one transaction");
  assert.match(v, /if \(!meta\?\.red \|\| meta\.local\) return;\s*rtChannel = sb\.channel/, "no realtime");
  assert.match(v, /if \(fitCh \|\| secondCh \|\| !meta \|\| meta\.local \|\| snap\.status !== "unlocked"\) return;/, "no fitness poke channel");   // V1.57: secondCh reused
  assert.match(v, /if \(psKeepOpen \|\| localOnly\(\)\) return;/, "no auto lock in local mode");
  assert.match(v, /if \(moveGate && role === "owner" && !red\) moved = await moveGate/, "the move never runs for the developer's account");
  for (const f of ["createWorkspace", "createInvite", "workspaceAccess", "revokeAccess", "destroyWorkspace", "accessLog"]) {
    const at = v.indexOf(`export async function ${f}(`);
    const firstLine = v.slice(v.indexOf("\n", at) + 1, v.indexOf("\n", v.indexOf("\n", at) + 1));
    assert.ok(at > 0 && firstLine.trim() === "if (meta?.local) throw new Error(NEEDS_SYNC);", f);
  }
  assert.ok(!/localKv\.del\(/.test(v), "the vault engine never deletes from the local database");
});

ok("the app deletes local data in exactly one place, behind a confirm", async () => {
  const lf = read("src/localfirst.ts");
  assert.ok(!/\.del\(/.test(lf), "no direct delete in src/localfirst.ts");
  assert.equal((lf.match(/discardLocalBackup\(/g) || []).length, 1);
  assert.match(lf, /export async function removeLocalBackup\(confirmed: boolean\)/);
  assert.match(lf, /op === "removeBackup" && o\.confirm === true/);
  const views = read("src/views/LocalFirst.tsx");
  assert.equal((views.match(/op: "removeBackup"/g) || []).length, 1);
  assert.match(views, /Yes, remove it/);
  assert.match(read("src/core/localstore.ts"), /if \(h\.state !== "moved" \|\| !h\.move\?\.verified\) throw/);
});

ok("Start now only where it belongs: never on the website, never where someone signed in, never over local data", async () => {
  const lf = read("src/localfirst.ts");
  assert.match(lf, /export const LOCAL_PLATFORM: "mac" \| "phone" \| "web" \| null = isPs \? "mac" : isGos \? "phone" : isMweb \? "web" : null;/);
  assert.match(lf, /if \(PROJECT\.custom\) return false;/);
  assert.match(lf, /if \(await lastUsername\(\)\.catch\(\(\) => ""\)\) return false;/);
  assert.match(lf, /return !\(await readHead\(localKv\)\.catch\(\(\) => undefined\)\);/);
  // The website's lock card never shows Start now or the local panel (only the phone app's branch does).
  const lock = read("src/views/Lock.tsx");
  assert.match(lock, /if \(import\.meta\.env\.MODE === "gos" && \(localHere \|\| startHere\)\)/);
  assert.match(lock, /\{import\.meta\.env\.MODE === "gos" && <LocalLockPanel look="gos" \/>\}/);
});

let n = 0;
for (const [name, fn] of tests) { await fn(); n++; console.log("ok -", name); }
console.log(`\n${n} passed`);
