// Run: node --experimental-strip-types tests/claimversion.test.ts
// One version number for everyone (V1.58): core-root/tools/claim-version.mjs claims v<version> with a tag on the shared
// repo, so two people can never take the same number, and scripts/ps-version.mjs saves it with who made it.
// Real git, all local: a bare repository in a temp folder stands in for the shared repo. Nothing goes online.
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const C = await import("../core-root/tools/claim-version.mjs");
const V = await import("../scripts/ps-version.mjs");
const run = promisify(execFile);
const here = join(import.meta.dirname, "..");
const tool = join(here, "core-root/tools/claim-version.mjs");

// A fictional identity for the tags (never the developer's own), for this process and every git it starts.
Object.assign(process.env, { GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" });

let n = 0;
const ok = async (name: string, fn: () => unknown) => { await fn(); n++; console.log("ok -", name); };
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** A shared repo (bare) with one commit on main, and `clones` clones of it. */
function shared(clones = 1) {
  const dir = mkdtempSync(join(tmpdir(), "ps-claim-test-"));
  const origin = join(dir, "origin.git");
  execFileSync("git", ["init", "--quiet", "--bare", "--initial-branch=main", origin]);
  const seed = join(dir, "seed");
  execFileSync("git", ["clone", "--quiet", origin, seed], { stdio: "ignore" });
  writeFileSync(join(seed, "README.md"), "fictional core\n");
  git(seed, "add", "."); git(seed, "commit", "--quiet", "-m", "core"); git(seed, "push", "--quiet", "origin", "HEAD:main");
  const list = Array.from({ length: clones }, (_, i) => { const c = join(dir, `clone${i}`); execFileSync("git", ["clone", "--quiet", origin, c], { stdio: "ignore" }); return c; });
  return { dir, origin, clones: list, done: () => rmSync(dir, { recursive: true, force: true }) };
}
const remoteTags = (origin: string) => git(origin, "tag", "-l", "v*").split("\n").filter(Boolean).sort();
const message = (origin: string, tag: string) => JSON.parse(git(origin, "tag", "-l", "--format=%(contents)", tag).trim());

await ok("numbers: one above the highest tag and the floor; 1.99 goes to 2.00", () => {
  assert.equal(C.nextVersion([], "1.57"), "1.58");
  assert.equal(C.nextVersion(["1.58", "1.61", "1.60"], "1.57"), "1.62");
  assert.equal(C.nextVersion(["1.58"], "1.70"), "1.71");
  assert.equal(C.nextVersion(["1.99"], ""), "2.00");
  assert.equal(C.nextVersion(["nonsense", "1.5", "v1.59"], "1.57"), "1.60");
  assert.equal(V.next("1.57"), "1.58");
  assert.equal(V.next("1.99"), "2.00");
});

await ok("tag messages: by, kind and time read back; plain or foreign tags read as nothing", () => {
  assert.deepEqual(C.parseMessage('{"by":"jan","kind":"private","at":"2026-11-13T12:00:00.000Z"}'), { by: "jan", kind: "private", at: "2026-11-13T12:00:00.000Z" });
  assert.deepEqual(C.parseMessage('{"by":"gsquad","kind":"shared","at":"x","name":"Harmony"}')?.name, "Harmony");
  assert.equal(C.parseMessage("release 1.57"), null);
  assert.equal(C.parseMessage('{"by":"Jan Smith","kind":"shared"}'), null);
  assert.equal(C.parseMessage('{"by":"jan","kind":"public"}'), null);
});

await ok("names never repeat and are never Truth", () => {
  const words = { "4": ["Truth", "Foundation", "Order"] };
  assert.equal(C.keywordFor(words, "1.13", []), "Foundation");
  assert.equal(C.keywordFor(words, "1.13", ["foundation"]), "Order");
  assert.equal(C.keywordFor(words, "1.13", ["Foundation", "Order"]), "Foundation II");
  assert.equal(C.banned("Truth"), true); assert.equal(C.banned("truth II"), true); assert.equal(C.banned("Trust"), false);
  // ps-version.mjs: the real list has "Truth" under its number; it is skipped like a used name.
  const kw = JSON.parse(readFileSync(join(here, "scripts/ps-keywords.json"), "utf8"));
  const num = Object.keys(kw).find((k) => kw[k].includes("Truth"))!;
  const v = `1.${String(Number(num)).padStart(2, "0")}`;
  const before = kw[num].slice(0, kw[num].indexOf("Truth"));
  assert.notEqual(V.keywordFor(v, before), "Truth");
  assert.equal(V.banned(V.keywordFor(v, [...kw[num]])), false);
  assert.throws(() => V.record({ version: "1.57", names: { "1.57": "Momentum" } }, "1.58", { by: "red", name: "Truth" }), /may not be used/);
  assert.throws(() => V.record({ version: "1.57", names: { "1.57": "Momentum" } }, "1.58", { by: "red", name: "momentum" }), /may not be used/);
});

await ok("a claim makes an annotated tag on the shared repo with only by, kind, time and the name", () => {
  const s = shared(1);
  try {
    const r = C.claim({ git: C.gitIn(s.clones[0]), by: "jan", kind: "private", floor: "1.57", pickName: () => "Harmony", now: () => new Date("2026-11-13T12:00:00Z") });
    assert.equal(r.version, "1.58"); assert.equal(r.tag, "v1.58"); assert.equal(r.tries, 1);
    assert.deepEqual(remoteTags(s.origin), ["v1.58"]);
    assert.deepEqual(message(s.origin, "v1.58"), { by: "jan", kind: "private", at: "2026-11-13T12:00:00.000Z", name: "Harmony" });
    assert.equal(git(s.origin, "cat-file", "-t", "v1.58").trim(), "tag");   // annotated, not a plain tag
    assert.equal(git(s.origin, "rev-parse", "v1.58^{commit}").trim(), git(s.origin, "rev-parse", "main").trim());
    // The next one, from the same clone: one higher, and the used name is not given again.
    const words = { "5": ["Harmony", "Nurture"] };   // 1.59: 59 -> 14 -> 5
    const r2 = C.claim({ git: C.gitIn(s.clones[0]), by: "gsquad", kind: "shared", floor: "1.57", pickName: (v: string, used: string[]) => C.keywordFor(words, v, used) });
    assert.equal(r2.version, "1.59"); assert.equal(r2.name, "Nurture");
    assert.equal(message(s.origin, "v1.59").name, "Nurture");
  } finally { s.done(); }
});

await ok("a dry run fetches and says what it would claim, and makes no tag anywhere", () => {
  const s = shared(1);
  try {
    const r = C.claim({ git: C.gitIn(s.clones[0]), by: "jan", kind: "shared", floor: "1.57", dryRun: true });
    assert.equal(r.version, "1.58");
    assert.deepEqual(remoteTags(s.origin), []);
    assert.equal(git(s.clones[0], "tag", "-l").trim(), "");
  } finally { s.done(); }
});

await ok("someone takes the number between the fetch and the push: refused, the next number is taken instead", () => {
  const s = shared(2);
  try {
    const a = C.gitIn(s.clones[0]), b = C.gitIn(s.clones[1]);
    let raced = false;
    // Jan's push is about to go; Mia's claim lands first.
    const janGit = (args: string[]) => {
      if (args[0] === "push" && !raced) { raced = true; C.claim({ git: b, by: "mia", kind: "shared", floor: "1.57" }); }
      return a(args);
    };
    const r = C.claim({ git: janGit, by: "jan", kind: "private", floor: "1.57" });
    assert.equal(raced, true);
    assert.equal(r.version, "1.59"); assert.equal(r.tries, 2);
    assert.deepEqual(remoteTags(s.origin), ["v1.58", "v1.59"]);
    assert.equal(message(s.origin, "v1.58").by, "mia");
    assert.equal(message(s.origin, "v1.59").by, "jan");
    // Jan's refused v1.58 is not left behind in his clone as his own.
    assert.equal(message(s.clones[0], "v1.58").by, "mia");
  } finally { s.done(); }
});

await ok("six people claim at the same moment: six different numbers, none lost", async () => {
  const s = shared(6);
  try {
    const got = await Promise.all(s.clones.map((c, i) => run(process.execPath, [tool, "--by", `p${i}`, "--kind", "shared", "--floor", "1.57", "--json"], { cwd: c })
      .then((o) => JSON.parse(o.stdout))));
    const versions = got.map((g) => g.version).sort();
    assert.deepEqual(versions, ["1.58", "1.59", "1.60", "1.61", "1.62", "1.63"]);
    assert.deepEqual(remoteTags(s.origin), versions.map((v) => `v${v}`));
    for (const g of got) assert.equal(message(s.origin, g.tag).by, g.by);
  } finally { s.done(); }
});

await ok("no way to reach the shared repo: it stops with git's words and leaves no tag", () => {
  const s = shared(1);
  try {
    assert.throws(() => C.claim({ git: C.gitIn(s.clones[0]), remote: join(s.dir, "nowhere.git"), by: "jan", kind: "shared", floor: "1.57" }));
    assert.equal(git(s.clones[0], "tag", "-l").trim(), "");
  } finally { s.done(); }
});

await ok("bad input stops before anything is fetched", () => {
  const never = () => { throw new Error("git ran"); };
  assert.throws(() => C.claim({ git: never, by: "Jan", kind: "shared" }), /profile name/);
  assert.throws(() => C.claim({ git: never, by: "jan", kind: "public" }), /private or shared/);
});

await ok("ps-version.mjs claim: from a throwaway repo, the number and name saved with who made it", async () => {
  const s = shared(1);
  try {
    // Someone already claimed 1.58 on the shared repo; this tree is still at 1.57.
    C.claim({ git: C.gitIn(s.clones[0]), by: "mia", kind: "private", floor: "1.57", pickName: () => "Harmony" });
    const data = { version: "1.57", names: { "1.57": "Momentum" } };
    const dry = await V.claimNext(data, { by: "red", shared: true, remote: s.origin, dryRun: true, coreDir: undefined });
    assert.equal(dry.version, "1.59");
    assert.deepEqual(remoteTags(s.origin), ["v1.58"]);
    const r = await V.claimNext(data, { by: "red", shared: true, remote: s.origin, coreDir: undefined });
    assert.equal(r.version, "1.59");
    assert.deepEqual(remoteTags(s.origin), ["v1.58", "v1.59"]);
    assert.equal(message(s.origin, "v1.59").kind, "shared");
    const after = V.record(data, r.version, { by: "red", shared: true, name: r.name });
    assert.equal(after.version, "1.59");
    assert.equal(after.names["1.59"], r.name);
    assert.notEqual(r.name, "Harmony");
    assert.deepEqual(after.made["1.59"], { by: "red", shared: true });
    assert.deepEqual(V.describe(after), { version: "1.59", name: "V1.59", keyword: r.name, by: "red", shared: true });
  } finally { s.done(); }
});

await ok("old ps-version.json with no 'made' reads exactly as in V1.57; bump without a profile saves no 'by'", () => {
  const old = { version: "1.57", names: { "1.57": "Momentum" } };
  assert.deepEqual(V.describe(old), { version: "1.57", name: "V1.57", keyword: "Momentum" });
  assert.equal(V.madeOf(old, "1.57"), null);
  const bumped = V.record(old, V.next(old.version), { by: "", shared: true });
  assert.equal(bumped.version, "1.58"); assert.ok(bumped.names["1.58"]); assert.deepEqual(bumped.made, {});
  const priv = V.record(old, "1.58", { by: "jan", shared: false });
  assert.deepEqual(V.describe(priv).shared, false); assert.equal(V.describe(priv).by, "jan");
});

await ok("the CLI: dry run prints the number and pushes nothing", async () => {
  const s = shared(1);
  try {
    const o = await run(process.execPath, [tool, "--by", "jan", "--kind", "shared", "--floor", "1.60", "--dry-run"], { cwd: s.clones[0] });
    assert.equal(o.stdout.trim(), "1.61");
    assert.deepEqual(remoteTags(s.origin), []);
    await assert.rejects(run(process.execPath, [tool, "--by", "jan", "--kind", "nope"], { cwd: s.clones[0] }));
  } finally { s.done(); }
});

console.log(`\n${n} passed`);
