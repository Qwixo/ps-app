// Run: node --experimental-strip-types tests/notehistory.test.ts
// Patch notes across versions (V1.52, the developer: updating from 1.49 to 1.52 must show what 1.50, 1.51 and 1.52 each
// changed). Which versions show (core/notehistory.ts), and the gate that builds the history (scripts/ps-public.mjs,
// run on a copy in a throwaway folder with made up notes, never the real ps-notes.json or approvals).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as H from "../src/core/notehistory.ts";
import { cleanMacUpdate } from "../src/core/macupdate.ts";

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const read = (f: string) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const blk = (version: string, keyword = "K", notes = [`Point of ${version}.`]) => ({ version, keyword, notes });
const ALL = [blk("1.52", "Newest"), blk("1.51", "Healing"), blk("1.50", "Curiosity"), blk("1.49", "Order"), blk("1.48", "Inspiration")];

ok("installed 1.49, newest 1.52: shows 1.52, 1.51, 1.50, newest first, never 1.49 itself", () => {
  assert.deepEqual(H.catchUp(ALL, "1.49", "1.52").map((b) => b.version), ["1.52", "1.51", "1.50"]);
  assert.deepEqual(H.catchUp([...ALL].reverse(), "V1.49", "V1.52").map((b) => b.version), ["1.52", "1.51", "1.50"]);   // order in does not matter; a leading V is fine
});

ok("a one step update shows only the newest, and an up to date app shows only its own", () => {
  assert.deepEqual(H.catchUp(ALL, "1.51", "1.52").map((b) => b.version), ["1.52"]);
  assert.deepEqual(H.catchUp(ALL, "1.52", "1.52").map((b) => b.version), []);   // nothing newer than itself
});

ok("an unapproved version is skipped, the approved ones around it still show", () => {
  const noMiddle = ALL.filter((b) => b.version !== "1.51");
  assert.deepEqual(H.catchUp(noMiddle, "1.49", "1.52").map((b) => b.version), ["1.52", "1.50"]);
  const noNewest = ALL.filter((b) => b.version !== "1.52");
  assert.deepEqual(H.catchUp(noNewest, "1.49", "1.52").map((b) => b.version), ["1.51", "1.50"]);
});

ok("never past the version being updated to, and an unknown starting point shows only that version", () => {
  assert.deepEqual(H.catchUp(ALL, "1.48", "1.50").map((b) => b.version), ["1.50", "1.49"]);
  assert.deepEqual(H.catchUp(ALL, null, "1.52").map((b) => b.version), ["1.52"]);
  assert.deepEqual(H.catchUp(ALL, "junk", "1.52").map((b) => b.version), ["1.52"]);
  assert.deepEqual(H.catchUp(ALL.filter((b) => b.version !== "1.52"), null, "1.52").map((b) => b.version), []);   // never another version's words under this name
});

ok("versions compare as numbers (1.9 before 1.10)", () => {
  const b = [blk("1.9"), blk("1.10"), blk("1.11")];
  assert.deepEqual(H.catchUp(b, "1.9", "1.11").map((x) => x.version), ["1.11", "1.10"]);
});

ok("bad blocks never show: a long dash, HTML, a non string line, an empty list, a bad version, a long line", () => {
  assert.equal(H.cleanBlock({ version: "1.50", keyword: "K", notes: ["A long dash — here."] }), null);
  assert.equal(H.cleanBlock({ version: "1.50", keyword: "K", notes: ["An en dash – here."] }), null);
  assert.equal(H.cleanBlock({ version: "1.50", keyword: "K", notes: ["<b>bold</b>"] }), null);
  assert.equal(H.cleanBlock({ version: "1.50", keyword: "K", notes: ["Fine.", 3] }), null);
  assert.equal(H.cleanBlock({ version: "1.50", keyword: "K", notes: [] }), null);
  assert.equal(H.cleanBlock({ version: "x.y", keyword: "K", notes: ["Fine."] }), null);
  assert.equal(H.cleanBlock({ version: "1.50", keyword: "K", notes: ["x".repeat(301)] }), null);
  assert.ok(H.cleanBlock({ version: "1.44", keyword: "K", notes: ["x".repeat(222)] }), "V1.44 line of 222 characters is a real approved line");
  assert.equal(H.cleanBlock(null), null);
  assert.equal(H.cleanBlock({ version: "1.50", keyword: "Bad—word", notes: ["Fine."] })!.keyword, "");
  // One bad block among good ones is dropped alone.
  assert.deepEqual(H.cleanBlocks([blk("1.50"), { version: "1.49", notes: ["<i>x</i>"] }, blk("1.48")]).map((b) => b.version), ["1.50", "1.48"]);
});

ok("each version's own block stays short, one block per version, at most 20 versions", () => {
  const long = H.cleanBlock({ version: "1.50", keyword: "K", notes: Array.from({ length: 9 }, (_, i) => `Line ${i}.`) })!;
  assert.equal(long.notes.length, H.BLOCK_LINES);
  const many = Array.from({ length: 30 }, (_, i) => blk(`1.${String(i + 10).padStart(2, "0")}`));
  assert.equal(H.cleanBlocks(many).length, H.MAX_BLOCKS);
  assert.equal(H.cleanBlocks(many)[0].version, "1.39");
  assert.equal(H.cleanBlocks([blk("1.50"), blk("1.50", "Other")]).length, 1);
});

ok("the newest block starts open; a few versions all open, many only the newest two", () => {
  assert.deepEqual([0, 1, 2].map((i) => H.startsOpen(i, 3)), [true, true, true]);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => H.startsOpen(i, 5)), [true, true, false, false, false]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((i) => H.startsOpen(i, 7)), [true, false, false, false, false, false, false]);
  assert.equal(H.blockTitle({ version: "1.51", keyword: "Healing" }), "V1.51 · Healing");
  assert.equal(H.blockTitle({ version: "1.51", keyword: "" }), "V1.51");
});

ok("the Mac update state carries the earlier versions, cleaned, and old states without them still work", () => {
  const u = cleanMacUpdate({ state: "available", version: "V1.52", current: "V1.49", notes: ["One."], history: [blk("1.51"), { version: "1.50", notes: ["<b>x</b>"] }, blk("1.50", "A")] });
  assert.deepEqual(u.history!.map((b) => b.version), ["1.51", "1.50"]);
  assert.equal(u.history![1].keyword, "A");
  assert.equal(cleanMacUpdate({ state: "available", version: "V1.52", notes: ["One."] }).history, undefined);
  assert.equal(cleanMacUpdate({ state: "available", history: "no" }).history, undefined);
});

// ---------- the gate (scripts/ps-public.mjs) ----------
const dir = mkdtempSync(join(tmpdir(), "ps-notehistory-test-"));
try {
  mkdirSync(join(dir, "scripts"));
  copyFileSync(new URL("../scripts/ps-public.mjs", import.meta.url), join(dir, "scripts/ps-public.mjs"));
  const names: Record<string, string> = {};
  for (let m = 36; m <= 60; m++) names[`1.${m}`] = `Name${m}`;
  writeFileSync(join(dir, "ps-version.json"), JSON.stringify({ version: "1.52", names }));
  const run = (...a: string[]) => spawnSync(process.execPath, [join(dir, "scripts/ps-public.mjs"), ...a], { encoding: "utf8" });
  const approvals: Record<string, unknown> = {};
  const approve = (v: string, notes: string[]) => { approvals[v] = { code: "x", at: `2026-11-${v.slice(-2)}T10:00:00.000Z`, keyword: names[v], notes }; };
  const save = () => writeFileSync(join(dir, "ps-public-approvals.json"), JSON.stringify(approvals));
  const hist = () => JSON.parse(run("history-json").stdout) as { version: string; keyword: string; notes: string[] }[];

  ok("the history holds only approved earlier versions, newest first, older than the current one", () => {
    approve("1.49", ["Approved forty nine."]); approve("1.50", ["Approved fifty."]); approve("1.51", ["Approved fifty one a.", "Approved fifty one b."]);
    approve("1.52", ["The current version is not in its own history."]); approve("1.53", ["A later version never rides along."]);
    save();
    assert.deepEqual(hist().map((h) => h.version), ["1.51", "1.50", "1.49"]);
    assert.equal(hist()[0].keyword, "Name51");
    assert.deepEqual(hist()[0].notes, ["Approved fifty one a.", "Approved fifty one b."]);
  });

  ok("notes written but never approved are not in the history", () => {
    writeFileSync(join(dir, "ps-notes.json"), JSON.stringify({ "1.48": { en: ["Written, not approved."], ru: [] }, "1.50": { en: ["Edited after approval."], ru: [] } }));
    assert.deepEqual(hist().map((h) => h.version), ["1.51", "1.50", "1.49"]);
    assert.ok(!JSON.stringify(hist()).includes("Written, not approved"));
    assert.deepEqual(hist().find((h) => h.version === "1.50")!.notes, ["Approved fifty."]);   // the words the developer approved, not later edits
  });

  ok("private notes never ride along: only the approvals file is read, never ps-notes-private.json", () => {
    writeFileSync(join(dir, "ps-notes-private.json"), JSON.stringify({ "1.50": ["A private line for the developer only."], "1.52": ["Another private line."] }));
    const h = hist();
    assert.deepEqual(h.map((x) => x.version), ["1.51", "1.50", "1.49"]);
    assert.ok(!JSON.stringify(h).includes("private line"));
    assert.ok(!run("whatsnew").stdout.includes("private line"));
    assert.ok(!readFileSync(join(dir, "scripts/ps-public.mjs"), "utf8").includes("ps-notes-private"));
  });

  ok("a long dash or HTML in an approved record is left out whole", () => {
    approve("1.48", ["Has a long dash — here."]); approve("1.47", ["<b>html</b>"]); save();
    assert.deepEqual(hist().map((h) => h.version), ["1.51", "1.50", "1.49"]);
    delete approvals["1.48"]; delete approvals["1.47"]; save();
  });

  ok("at most the last 20 versions", () => {
    for (let m = 36; m <= 51; m++) approve(`1.${m}`, [`Approved ${m}.`]);
    save();
    const h = hist();
    assert.equal(h.length, 16);
    for (let m = 20; m < 36; m++) { names[`1.${m}`] = `N${m}`; approvals[`1.${m}`] = { code: "x", at: "2026-10-01T00:00:00Z", keyword: `N${m}`, notes: [`Approved ${m}.`] }; }
    save();
    assert.equal(hist().length, 20);
    assert.equal(hist()[0].version, "1.51");
  });

  ok("release.json keeps every old field and adds the history (up to 20, approved only)", () => {
    mkdirSync(join(dir, "rel"));
    writeFileSync(join(dir, "ps-notes.json"), JSON.stringify({ "1.52": { en: ["Current one.", "Current two.", "Current three."], ru: [] } }));
    const shown = run("show").stdout, code = /Code: ([0-9a-f]{12})/.exec(shown)![1];
    assert.equal(run("approve", code).status, 0);
    assert.equal(run("stage", join(dir, "rel")).status, 0);
    const r = JSON.parse(readFileSync(join(dir, "rel/release.json"), "utf8"));
    assert.equal(r.format, 1); assert.equal(r.version, "1.52"); assert.equal(r.name, "V1.52"); assert.equal(r.keyword, "Name52");
    assert.deepEqual(r.notes, ["Current one.", "Current two.", "Current three."]);
    assert.equal(r.history.length, 20);
    assert.deepEqual(Object.keys(r.history[0]).sort(), ["keyword", "name", "notes", "released", "version"]);
    assert.equal(r.history[0].version, "1.51"); assert.equal(r.history[0].name, "V1.51");
    assert.ok(r.history.every((h: { version: string }) => h.version !== "1.52"));
  });

  ok("the build's What's new bundle carries the history; unapproved current notes give none but the history stays", () => {
    const w = JSON.parse(run("whatsnew").stdout);
    assert.equal(w.format, 1); assert.deepEqual(w.notes, ["Current one.", "Current two.", "Current three."]);
    assert.equal(w.history[0].version, "1.51");
    writeFileSync(join(dir, "ps-notes.json"), JSON.stringify({ "1.52": { en: ["Edited after approval."], ru: [] } }));
    const w2 = JSON.parse(run("whatsnew").stdout);
    assert.deepEqual(w2.notes, []); assert.equal(w2.code, ""); assert.equal(w2.history[0].version, "1.51");
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// ---------- wiring ----------
ok("the signed note, the phone's version.json and the build all take the history from the one gate", () => {
  assert.match(read("scripts/release.sh"), /PS_HISTORY="\$\(node scripts\/ps-public\.mjs history-json/);
  assert.match(read("vite.config.ts"), /history: Array\.isArray\(o\.history\)/);
});

ok("the cards use the shared selection and list", () => {
  assert.match(read("src/views/MacUpdate.tsx"), /catchUp\(/);
  assert.match(read("src/views/MacUpdate.tsx"), /<NoteGroups blocks=\{blocks\}/);
  assert.match(read("src/views/UpdateFace.tsx"), /catchUpNow\(\)/);
  assert.match(read("src/gos/GosUpdate.tsx"), /catchUp\(/);
  assert.match(read("src/views/WhatsNew.tsx"), /updateBlocks\(since, back\)/);
  assert.match(read("src/views/WhatsNew.tsx"), /whatsNewPlan\(\{/);   // V1.53: where this device came from (core/whatsnew.ts)
});

ok("no long dashes in the new words, code or styles", () => {
  for (const f of ["src/core/notehistory.ts", "src/ui/NoteGroups.tsx", "src/ui/notegroups.css", "src/views/WhatsNew.tsx", "src/views/UpdateFace.tsx", "src/views/MacUpdate.tsx", "src/gos/GosUpdate.tsx", "src/dev/whatsnew-demo.ts"]) {
    assert.ok(!/[\u2013\u2014]/.test(read(f)), f);
  }
});

console.log(`\n${n} passed`);
