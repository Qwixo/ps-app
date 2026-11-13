#!/usr/bin/env node
// The pre-push guard of a person's core clone (V1.58, layers/README.md): nothing of their own layer goes into core.
//
//   node tools/guard.mjs --install --layer <layer.json>   writes .git/hooks/pre-push in this core clone
//   node tools/guard.mjs --layer <layer.json> [<base>..<head>]   checks a range by hand (default origin/main..HEAD)
//
// Refuses a push when any file changed in the outgoing commits:
//   * is under .build/ or is a ps-build.json (assembled trees never go into core);
//   * has the same path as a file the layer adds, or the same content as any file of the layer (replace, add, pinned);
//   * is refused by the layer's own audit command (layer.json "audit": [cmd, ...args], run on a folder holding the
//     outgoing files; the developer's runs his term audit, so his list of words is never copied anywhere).
// Core's own checks (term audit, release/audit.py --source, gitleaks) run again on GitHub for every pull request.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { blobOf, readLayer, PARTS } from "./assemble.mjs";

const CORE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stop = (msg) => { console.error(`guard: STOP, ${msg}`); process.exit(1); };
const git = (...a) => execFileSync("git", ["-C", CORE, ...a], { maxBuffer: 1 << 30 });

const a = process.argv.slice(2);
let layerPath = null, install = false, range = null;
for (let i = 0; i < a.length; i++) {
  if (a[i] === "--layer") layerPath = resolve(a[++i]);
  else if (a[i] === "--install") install = true;
  else if (/\.\./.test(a[i])) range = a[i];
  else stop(`unknown option ${a[i]}`);
}
if (!layerPath) stop("say which layer is yours: --layer <path to layer.json>");

if (install) {
  const hook = join(CORE, ".git/hooks/pre-push");
  mkdirSync(dirname(hook), { recursive: true });
  writeFileSync(hook, `#!/bin/sh\n# PS layer guard (tools/guard.mjs): nothing of the layer below goes into core.\nexec node "${join(CORE, "tools/guard.mjs")}" --layer "${layerPath}"\n`);
  chmodSync(hook, 0o755);
  console.log(`guard: installed ${hook} for the layer ${layerPath}`);
  process.exit(0);
}

const L = readLayer(layerPath);
// The outgoing ranges: from the pre-push hook's stdin, else the range given, else origin/main..HEAD.
const ranges = [];
if (!range && !process.stdin.isTTY) {
  const input = (() => { try { return readFileSync(0, "utf8"); } catch { return ""; } })();
  for (const line of input.split("\n").filter(Boolean)) {
    const [, localSha, , remoteSha] = line.split(/\s+/);
    if (/^0+$/.test(localSha)) continue;   // a delete
    const base = /^0+$/.test(remoteSha) ? (spawnSync("git", ["-C", CORE, "rev-parse", "--verify", "-q", "origin/main"]).status === 0 ? "origin/main" : null) : remoteSha;
    ranges.push(base ? `${base}..${localSha}` : localSha);
  }
}
if (!ranges.length) ranges.push(range || "origin/main..HEAD");

// Everything of the layer: paths it adds, and the content of every file it has.
const addPaths = new Set(PARTS.flatMap((p) => L.add[p].map((f) => `${p}/${f}`)));
const layerBlobs = new Map();
for (const p of PARTS) for (const f of [...L.replace[p], ...L.add[p]]) { const full = join(L.roots[p], f); if (existsSync(full)) layerBlobs.set(blobOf(full), `${p}/${f}`); }
for (const path of Object.keys(L.pinned)) { const p = path.split("/")[0], full = join(L.roots[p], path.slice(p.length + 1)); if (existsSync(full)) layerBlobs.set(blobOf(full), path); }

const problems = [];
const outgoing = new Map();   // path -> blob at the head of its range
for (const r of ranges) {
  const head = r.includes("..") ? r.split("..")[1] : r;
  const files = (r.includes("..") ? git("diff", "--name-only", "--diff-filter=AMR", r) : git("ls-tree", "-r", "--name-only", r)).toString().split("\n").filter(Boolean);
  for (const f of files) {
    const blob = spawnSync("git", ["-C", CORE, "rev-parse", `${head}:${f}`]).stdout.toString().trim();
    if (blob) outgoing.set(f, blob);
  }
}
for (const [f, blob] of outgoing) {
  if (f.startsWith(".build/") || /(^|\/)ps-build\.json$/.test(f)) problems.push(`${f}: an assembled tree file`);
  if (addPaths.has(f)) problems.push(`${f}: a file your layer adds`);
  if (layerBlobs.has(blob)) problems.push(`${f}: the same content as your layer's ${layerBlobs.get(blob)}`);
}
if (L.audit && outgoing.size) {
  const dir = mkdtempSync(join(tmpdir(), "ps-guard-"));
  for (const [f, blob] of outgoing) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), git("cat-file", "blob", blob)); }
  const [cmd, ...args] = L.audit;
  const r = spawnSync(cmd, [...args.map((x) => (x.startsWith(".") ? resolve(L.dir, x) : x)), dir], { stdio: "inherit", cwd: L.dir });
  rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0) problems.push(`your layer's audit (${L.audit.join(" ")}) refused the outgoing files`);
}
if (problems.length) {
  console.error(`guard: STOP, this push would put something of your layer "${L.name}" into core:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`guard: ${outgoing.size} outgoing files, nothing of the layer "${L.name}"`);
