// Run: node --experimental-strip-types tests/channel158.test.ts
// Release channels (V1.58, multiple developers): the G Squad channel on GitHub (scripts/github-channel.mjs) only ever
// takes a shared release, and the developer's release command (scripts/release.sh) stops before building anything when the
// version is marked private, while a shared or unmarked one runs exactly as in V1.57. FICTIONAL files; gh is never run.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const G = await import("../scripts/github-channel.mjs");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const hex = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const here = join(import.meta.dirname, "..");

/** A staged channel with a fictional signed note (the note's own `extra` keys) and ps-version.json `made`. */
function staged(extra: Record<string, unknown>, made?: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), "ps-ch158-test-"));
  mkdirSync(join(root, "ps-release/updates"), { recursive: true }); mkdirSync(join(root, "dist/client"), { recursive: true });
  const web = Buffer.from("fictional web");
  writeFileSync(join(root, "ps-release/updates/PS-web-1.zip"), web);
  const signed = { format: 1, kind: "web", made: "2026-11-13T12:00:00Z", name: "V1.58", ...extra,
    web: { src: "abcdef0123456789", built: "2026-11-13T12:00:00.000Z", file: "updates/PS-web-1.zip", size: web.length, sha256: hex(web) } };
  writeFileSync(join(root, "ps-release/ps-update.json"), JSON.stringify({ sig: "fictional", signed: Buffer.from(JSON.stringify(signed)).toString("base64") }));
  writeFileSync(join(root, "dist/client/version.json"), JSON.stringify({ src: "abcdef0123456789", built: "2026-11-13T12:01:00.000Z", compat: 1 }));
  writeFileSync(join(root, "ps-version.json"), JSON.stringify({ version: "1.58", names: { "1.58": "Test" }, ...(made ? { made: { "1.58": made } } : {}) }));
  return root;
}

ok("GitHub channel: an old style release (no maker) plans as in V1.57", () => {
  const root = staged({});
  try { const p = G.plan(root); assert.equal(p.tag, "v1.58"); assert.equal(p.by, null); } finally { rmSync(root, { recursive: true, force: true }); }
});

ok("GitHub channel: a shared release by the developer plans, and says who made it", () => {
  const root = staged({ by: "red", shared: true, channel: "gsquad" }, { by: "red", shared: true });
  try { const p = G.plan(root); assert.equal(p.by, "red"); assert.equal(p.title, "PS V1.58 · Test"); } finally { rmSync(root, { recursive: true, force: true }); }
});

ok("GitHub channel: a private release never goes up", () => {
  const root = staged({}, { by: "jan", shared: false });
  try { assert.throws(() => G.plan(root), /private release by jan/); } finally { rmSync(root, { recursive: true, force: true }); }
});

ok("GitHub channel: a note signed for someone's own channel never goes up", () => {
  const root = staged({ channel: "red" }, { by: "red", shared: true });
  try { assert.throws(() => G.plan(root), /not the G Squad one/); } finally { rmSync(root, { recursive: true, force: true }); }
});

/** release.sh in a throwaway folder with only what it reads before the first build step. */
function release(made?: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), "ps-ch158-rel-"));
  mkdirSync(join(root, "scripts"));
  for (const f of ["release.sh", "ps-version.mjs", "ps-keywords.json"]) copyFileSync(join(here, "scripts", f), join(root, "scripts", f));
  // ps-private.ts is the next thing release.sh runs: a fictional stand in that says where the release got to.
  writeFileSync(join(root, "scripts/ps-private.ts"), 'console.log("REACHED private notes check"); process.exit(1);\n');
  writeFileSync(join(root, "ps-version.json"), JSON.stringify({ version: "1.58", names: { "1.58": "Test" }, ...(made ? { made: { "1.58": made } } : {}) }));
  const r = spawnSync("bash", [join(root, "scripts/release.sh"), "--app", "--wait", "--fast", "--dry-run"], { encoding: "utf8", env: { ...process.env, PS_DRY_LIVE_VERSION: "1.57" } });
  rmSync(root, { recursive: true, force: true });
  return r.stdout + r.stderr;
}

ok("release.sh: a private version stops before anything is built", () => {
  const out = release({ by: "red", shared: false });
  assert.match(out, /STOP: V1\.58 is marked as a private release/);
  assert.doesNotMatch(out, /REACHED/);
});

ok("release.sh: a shared version, and one with no maker at all (the V1.57 way), go on as before", () => {
  assert.match(release({ by: "red", shared: true }), /REACHED private notes check/);
  assert.match(release(), /REACHED private notes check/);
});

console.log(`\n${n} passed`);
