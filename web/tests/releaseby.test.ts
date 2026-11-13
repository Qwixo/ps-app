// Run: node --experimental-strip-types tests/releaseby.test.ts
// Who made each release (V1.58, multiple developers): "V1.59 by Jan", "V1.60 by the G Squad". The notes format
// (ps-notes.json, ps-version.json "made", the approvals) carries "by" and "shared"; old notes without them read exactly
// as before; a private release by someone else is never listed; the What's new panel and the history blocks show the
// "by" line. scripts/ps-public.mjs runs on a throwaway copy with FICTIONAL notes and names.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const R = await import("../src/core/releaseby.ts");
const H = await import("../src/core/notehistory.ts");
const W = await import("../src/core/whatsnew.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };

// ---------- the words ----------
ok("the by line: a person by name, the shared build as the G Squad, nothing for old releases", () => {
  assert.equal(R.versionBy("1.59", "jan"), "V1.59 by Jan");
  assert.equal(R.versionBy("V1.60", "gsquad"), "V1.60 by the G Squad");
  assert.equal(R.versionBy("1.57"), "V1.57");
  assert.equal(R.versionBy("1.57", ""), "V1.57");
  assert.equal(R.byLine("mary-jane"), "by Mary-Jane");
  assert.equal(R.byLine("Jan"), "");          // not a profile name
  assert.equal(R.byLine("<b>x</b>"), "");
  assert.equal(R.byLine(42), "");
});

ok("made: by and shared read back; shared unless it says false; nothing without a valid maker", () => {
  assert.deepEqual(R.cleanMade({ by: "jan", shared: false }), { by: "jan", shared: false });
  assert.deepEqual(R.cleanMade({ by: "red" }), { by: "red", shared: true });
  assert.equal(R.cleanMade({ version: "1.57", notes: ["x"] }), null);
  assert.equal(R.cleanMade(null), null);
});

ok("listable: old and shared releases always; a private one only in its own maker's build", () => {
  assert.equal(R.listable({ version: "1.57" }, ""), true);
  assert.equal(R.listable({ by: "jan", shared: true }, ""), true);
  assert.equal(R.listable({ by: "jan", shared: false }, ""), false);
  assert.equal(R.listable({ by: "jan", shared: false }, "mia"), false);
  assert.equal(R.listable({ by: "jan", shared: false }, "jan"), true);
});

ok("the running build's maker: from the bundled What's new, else from the build file wherever ps-version sits", () => {
  assert.deepEqual(R.madeOfBuild({ by: "jan", shared: false }, null, "1.59"), { by: "jan", shared: false });
  const made = { made: { "1.59": { by: "gsquad", shared: true } } };
  assert.deepEqual(R.madeOfBuild({}, made, "1.59"), { by: "gsquad", shared: true });
  assert.deepEqual(R.madeOfBuild({}, { flavour: "gsquad", version: made }, "1.59")?.by, "gsquad");
  assert.deepEqual(R.madeOfBuild({}, { psVersion: made }, "1.59")?.by, "gsquad");
  assert.equal(R.madeOfBuild({}, made, "1.58"), null);
  assert.equal(R.madeOfBuild({ version: "1.57" }, undefined, "1.57"), null);
});

ok("history blocks keep who made them; old blocks have no by and show as before", () => {
  const blocks = H.cleanBlocks([
    { version: "1.59", keyword: "Example", notes: ["One."], by: "jan", shared: true },
    { version: "1.57", keyword: "Before", notes: ["Two."] },
    { version: "1.58", keyword: "Mid", notes: ["Three."], by: "Not A Name" },
  ]);
  assert.deepEqual(blocks.map((b) => b.by), ["jan", undefined, undefined]);
  assert.deepEqual(blocks[2], { version: "1.57", keyword: "Before", notes: ["Two."] });
  assert.equal(H.blockTitle(blocks[0]), "V1.59 · Example");   // the title itself does not change; the by line sits beside it
  const w = W.cleanWhatsNew({ version: "1.59", keyword: "Example", notes: ["One."], by: "gsquad" });
  assert.equal(w?.by, "gsquad");
  assert.deepEqual(W.cleanWhatsNew({ version: "1.57", keyword: "Before", notes: ["Two."] }), { version: "1.57", keyword: "Before", notes: ["Two."] });
});

ok("the panel and the history blocks show the by line (source check)", () => {
  const panel = readFileSync(new URL("../src/views/WhatsNew.tsx", import.meta.url), "utf8");
  assert.match(panel, /byLine\(t\.by\) && <span className="wn-by">V\{t\.version\} \{byLine\(t\.by\)\}<\/span>/);
  assert.match(panel, /listable\(h, MADE && !MADE\.shared \? MADE\.by : ""\)/);
  const groups = readFileSync(new URL("../src/ui/NoteGroups.tsx", import.meta.url), "utf8");
  assert.match(groups, /byLine\(b\.by\) && <span className="ng-by">/);
});

// ---------- the notes gate (scripts/ps-public.mjs), on a throwaway copy ----------
const dir = mkdtempSync(join(tmpdir(), "ps-releaseby-test-"));
try {
  mkdirSync(join(dir, "scripts")); mkdirSync(join(dir, "ps-release"));
  copyFileSync(new URL("../scripts/ps-public.mjs", import.meta.url), join(dir, "scripts/ps-public.mjs"));
  const run = (...a: string[]) => spawnSync(process.execPath, [join(dir, "scripts/ps-public.mjs"), ...a], { encoding: "utf8" });
  const json = (...a: string[]) => JSON.parse(execFileSync(process.execPath, [join(dir, "scripts/ps-public.mjs"), ...a], { encoding: "utf8" }));
  const write = (f: string, o: unknown) => writeFileSync(join(dir, f), JSON.stringify(o));
  const approve = () => { const code = /Code: ([0-9a-f]{12})/.exec(run("show").stdout)?.[1]; assert.ok(code); assert.equal(run("approve", code!).status, 0); return code!; };

  // V1.57 the old way (no by anywhere), approved.
  write("ps-version.json", { version: "1.57", names: { "1.57": "Before" } });
  write("ps-notes.json", { "1.57": { en: ["Old point one.", "Old point two.", "Old point three."], ru: [] } });
  const oldCode = approve();

  ok("old notes with no by: everything reads exactly as in V1.57", () => {
    const w = json("whatsnew");
    assert.equal("by" in w, false); assert.equal("shared" in w, false);
    assert.equal(w.code, oldCode);
    const ok2 = JSON.parse(readFileSync(join(dir, "ps-public-approvals.json"), "utf8"))["1.57"];
    assert.equal("by" in ok2, false);
    assert.equal(run("stage", join(dir, "ps-release")).status, 0);
    const rel = JSON.parse(readFileSync(join(dir, "ps-release/release.json"), "utf8"));
    assert.equal("by" in rel, false);
  });

  ok("a shared release by the developer: by and shared everywhere; the approval code is the same as without them", () => {
    write("ps-version.json", { version: "1.58", names: { "1.57": "Before", "1.58": "Middle" }, made: { "1.58": { by: "red", shared: true } } });
    write("ps-notes.json", { "1.57": { en: ["Old point one.", "Old point two.", "Old point three."], ru: [] }, "1.58": { en: ["Shared one.", "Shared two.", "Shared three."], ru: [] } });
    const code = approve();
    // The same words with no maker give the same code: "by" is not words, every earlier approval stays valid.
    write("ps-version.json", { version: "1.58", names: { "1.57": "Before", "1.58": "Middle" } });
    assert.equal(/Code: ([0-9a-f]{12})/.exec(run("show").stdout)?.[1], code);
    write("ps-version.json", { version: "1.58", names: { "1.57": "Before", "1.58": "Middle" }, made: { "1.58": { by: "red", shared: true } } });
    const w = json("whatsnew");
    assert.equal(w.by, "red"); assert.equal(w.shared, true);
    assert.equal(w.history[0].version, "1.57"); assert.equal("by" in w.history[0], false);
    assert.equal(R.versionBy(w.version, w.by), "V1.58 by the developer");
    assert.equal(run("stage", join(dir, "ps-release")).status, 0);
    const rel = JSON.parse(readFileSync(join(dir, "ps-release/release.json"), "utf8"));
    assert.equal(rel.by, "red"); assert.equal(rel.shared, true);
    const appr = JSON.parse(readFileSync(join(dir, "ps-public-approvals.json"), "utf8"))["1.58"];
    assert.deepEqual([appr.by, appr.shared], ["red", true]);
  });

  ok("the notes entry may name the maker itself and wins over ps-version.json", () => {
    write("ps-version.json", { version: "1.59", names: { "1.57": "Before", "1.58": "Middle", "1.59": "Third" }, made: { "1.59": { by: "red", shared: true } } });
    const notes = JSON.parse(readFileSync(join(dir, "ps-notes.json"), "utf8"));
    notes["1.59"] = { en: ["Jan one.", "Jan two.", "Jan three."], ru: [], by: "jan", shared: true };
    write("ps-notes.json", notes);
    approve();
    const w = json("whatsnew");
    assert.equal(w.by, "jan");
    assert.equal(w.history[0].by, "red");      // V1.58 keeps who made it
    assert.equal(R.versionBy(w.history[0].version, w.history[0].by), "V1.58 by the developer");
  });

  ok("a private release: release.json is never staged, and no public history lists it", () => {
    write("ps-version.json", { version: "1.60", names: { "1.57": "Before", "1.58": "Middle", "1.59": "Third", "1.60": "Fourth" }, made: { "1.60": { by: "red", shared: false } } });
    const notes = JSON.parse(readFileSync(join(dir, "ps-notes.json"), "utf8"));
    notes["1.60"] = { en: ["Private one.", "Private two.", "Private three."], ru: [] };
    write("ps-notes.json", notes);
    approve();
    const st = run("stage", join(dir, "ps-release"));
    assert.equal(st.status, 1); assert.match(st.stderr, /private release/);
    // The developer's own private build lists his private V1.60 itself (the panel's own version).
    const w = json("whatsnew");
    assert.deepEqual([w.version, w.by, w.shared], ["1.60", "red", false]);
    // The next release is shared (the G Squad build): V1.60 is in nothing it carries.
    write("ps-version.json", { version: "1.61", names: { "1.57": "Before", "1.58": "Middle", "1.59": "Third", "1.60": "Fourth", "1.61": "Fifth" }, made: { "1.61": { by: "gsquad", shared: true } } });
    notes["1.61"] = { en: ["Squad one.", "Squad two.", "Squad three."], ru: [] };
    write("ps-notes.json", notes);
    approve();
    const pub = json("whatsnew");
    assert.equal(R.versionBy(pub.version, pub.by), "V1.61 by the G Squad");
    assert.deepEqual(pub.history.map((h: { version: string }) => h.version), ["1.59", "1.58", "1.57"]);
    assert.deepEqual(json("history-json").map((h: { version: string }) => h.version), ["1.59", "1.58", "1.57"]);
    assert.equal(run("stage", join(dir, "ps-release")).status, 0);
    const rel = JSON.parse(readFileSync(join(dir, "ps-release/release.json"), "utf8"));
    assert.deepEqual(rel.history.map((h: { version: string }) => h.version), ["1.59", "1.58", "1.57"]);
    assert.ok(!JSON.stringify(rel).includes("Private one."));
  });

  ok("a later private build by the same maker lists its own earlier private release, never someone else's", () => {
    const appr = JSON.parse(readFileSync(join(dir, "ps-public-approvals.json"), "utf8"));
    appr["1.62"] = { code: "x", at: "2026-11-13T00:00:00Z", keyword: "Sixth", notes: ["Jan private."], by: "jan", shared: false };
    write("ps-public-approvals.json", appr);
    write("ps-version.json", { version: "1.63", names: { "1.63": "Seventh" }, made: { "1.63": { by: "red", shared: false } } });
    const notes = JSON.parse(readFileSync(join(dir, "ps-notes.json"), "utf8"));
    notes["1.63"] = { en: ["The developer again."], ru: [] };
    write("ps-notes.json", notes);
    approve();
    const versions = json("whatsnew").history.map((h: { version: string }) => h.version);
    assert.ok(versions.includes("1.60"));     // The developer's own private one
    assert.ok(!versions.includes("1.62"));    // Jan's private one: nothing
    // And the display filter in the app agrees, given the same entries.
    assert.equal(R.listable({ by: "jan", shared: false }, "red"), false);
  });
} finally { rmSync(dir, { recursive: true, force: true }); }

console.log(`\n${n} passed`);
