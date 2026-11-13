// Run: node --experimental-strip-types tests/whatsnew.test.ts
// What's new (V1.36): once after an update, never on a first install, never without the developer's approved words, and
// the approval code changes when one word changes. The notes gate runs on a copy of scripts/ps-public.mjs in
// a throwaway folder with made up notes (fixtures), never on the real ps-notes.json or approvals.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as W from "../src/core/whatsnew.ts";

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const read = (f: string) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

// ---------- the rules (core/whatsnew.ts) ----------
const NOTES = { version: "1.36", keyword: "Example", notes: ["Point one.", "Point two.", "Point three."] };

ok("shows once after an update, then never again for that version", () => {
  const base = { version: "1.36", hasNotes: true, accountOlder: true };
  assert.equal(W.whatsNewStep({ ...base, localSeen: "1.35", syncedSeen: "1.35" }), "show");
  // Got it: both records say 1.36 now.
  assert.equal(W.whatsNewStep({ ...base, localSeen: "1.36", syncedSeen: "1.36" }), "quiet");
  // Only this device knows (the synced write is still on its way): still quiet.
  assert.equal(W.whatsNewStep({ ...base, localSeen: "1.36", syncedSeen: "1.35" }), "quiet");
  // Seen on another device first: quiet here too.
  assert.equal(W.whatsNewStep({ ...base, localSeen: "1.35", syncedSeen: "1.36" }), "quiet");
  // The next version shows again.
  assert.equal(W.whatsNewStep({ ...base, version: "1.37", localSeen: "1.36", syncedSeen: "1.36" }), "show");
});

ok("an update from a build older than this feature (no record yet) still shows", () => {
  assert.equal(W.whatsNewStep({ version: "1.36", hasNotes: true, localSeen: null, syncedSeen: undefined, accountOlder: true }), "show");
});

ok("never on a first ever install: a brand new account only records the version", () => {
  assert.equal(W.whatsNewStep({ version: "1.36", hasNotes: true, localSeen: null, syncedSeen: null, accountOlder: false }), "record");
  // And after that record, the same version stays quiet.
  assert.equal(W.whatsNewStep({ version: "1.36", hasNotes: true, localSeen: "1.36", syncedSeen: "1.36", accountOlder: false }), "quiet");
});

ok("never without approved notes: an update with none only records the version", () => {
  assert.equal(W.whatsNewStep({ version: "1.36", hasNotes: false, localSeen: "1.35", syncedSeen: "1.35", accountOlder: true }), "record");
});

ok("an older build never shows a newer record's version again, and the synced record never goes backwards", () => {
  assert.equal(W.whatsNewStep({ version: "1.35", hasNotes: true, localSeen: null, syncedSeen: "1.36", accountOlder: true }), "quiet");
  assert.equal(W.seenToSave("1.35", "1.36"), null);
  assert.equal(W.seenToSave("1.36", "1.36"), null);
  assert.equal(W.seenToSave("1.36", "1.35"), "1.36");
  assert.equal(W.seenToSave("1.36", undefined), "1.36");
});

ok("versions compare as numbers", () => {
  assert.ok(W.cmpVersion("1.9", "1.10") < 0);
  assert.ok(W.cmpVersion("1.36", "1.35") > 0);
  assert.ok(W.cmpVersion("2.01", "1.99") > 0);
  assert.equal(W.cmpVersion("1.36", "1.36"), 0);
  assert.ok(W.cmpVersion(null, "1.01") < 0);
  assert.equal(W.cleanSeen("1.36"), "1.36");
  for (const bad of ["", "v1.36", "1.36.1", "1", 136, null, "1.36<script>"]) assert.equal(W.cleanSeen(bad), undefined, String(bad));
});

ok("an account with records older than the build ran an earlier version; a new one did not", () => {
  const built = "2026-11-06T00:00:00.000Z";
  assert.equal(W.accountOlderThan(built, ["2026-11-06T01:00:00Z", "2026-10-20T10:00:00Z"]), true);
  assert.equal(W.accountOlderThan(built, ["2026-11-06T01:00:00Z", null, undefined]), false);
  assert.equal(W.accountOlderThan(built, []), false);
  assert.equal(W.accountOlderThan("", ["2020-01-01T00:00:00Z"]), false);
});

ok("the bundled notes are checked again: no notes, a long dash or HTML means no panel at all", () => {
  assert.deepEqual(W.cleanWhatsNew(NOTES), NOTES);
  assert.equal(W.cleanWhatsNew({ ...NOTES, notes: [] }), null);
  assert.equal(W.cleanWhatsNew({ ...NOTES, notes: ["Fine.", "A long dash \u2014 here."] }), null);
  assert.equal(W.cleanWhatsNew({ ...NOTES, notes: ["Fine.", "An en dash \u2013 here."] }), null);
  assert.equal(W.cleanWhatsNew({ ...NOTES, notes: ["<b>bold</b>"] }), null);
  assert.equal(W.cleanWhatsNew({ ...NOTES, notes: ["Fine.", 3] }), null);
  assert.equal(W.cleanWhatsNew({ ...NOTES, version: "" }), null);
  assert.equal(W.cleanWhatsNew(null), null);
  assert.equal(W.cleanWhatsNew({ ...NOTES, notes: Array.from({ length: 9 }, (_, i) => `Point ${i}.`) })!.notes.length, W.MAX_POINTS);
  assert.equal(W.whatsNewTitle(NOTES), "What's new in V1.36 · Example");
  assert.equal(W.whatsNewTitle({ version: "1.36", keyword: "" }), "What's new in V1.36");
});

// ---------- the notes gate (scripts/ps-public.mjs), on a throwaway copy ----------
const dir = mkdtempSync(join(tmpdir(), "ps-whatsnew-test-"));
try {
  mkdirSync(join(dir, "scripts"));
  copyFileSync(new URL("../scripts/ps-public.mjs", import.meta.url), join(dir, "scripts/ps-public.mjs"));
  writeFileSync(join(dir, "ps-version.json"), JSON.stringify({ version: "1.36", names: { "1.35": "Before", "1.36": "Example" } }));
  const run = (...a: string[]) => spawnSync(process.execPath, [join(dir, "scripts/ps-public.mjs"), ...a], { encoding: "utf8" });
  const whatsnew = () => JSON.parse(execFileSync(process.execPath, [join(dir, "scripts/ps-public.mjs"), "whatsnew"], { encoding: "utf8" }));
  const setNotes = (en: string[]) => writeFileSync(join(dir, "ps-notes.json"), JSON.stringify({ "1.36": { en, ru: [] } }));
  const codeOf = () => /Code: ([0-9a-f]{12})/.exec(run("show").stdout)?.[1];

  ok("no notes file: the bundle carries no notes", () => {
    assert.deepEqual(whatsnew(), { format: 1, version: "1.36", keyword: "Example", notes: [], code: "", history: [] });
  });

  ok("notes written but not approved: still none in the bundle", () => {
    setNotes(["Made up point one.", "Made up point two.", "Made up point three."]);
    assert.deepEqual(whatsnew().notes, []);
    assert.equal(run("approved").status, 1);
  });

  ok("a wrong code records nothing", () => {
    assert.equal(run("approve", "000000000000").status, 1);
    assert.deepEqual(whatsnew().notes, []);
  });

  let first = "";
  ok("approved with the code shown for those exact words: the bundle carries them", () => {
    first = codeOf()!;
    assert.match(first, /^[0-9a-f]{12}$/);
    assert.equal(run("approve", first).status, 0);
    const w = whatsnew();
    assert.deepEqual(w.notes, ["Made up point one.", "Made up point two.", "Made up point three."]);
    assert.equal(w.code, first);
    assert.ok(W.cleanWhatsNew(w));
  });

  ok("the approval code changes when one word changes, and the old approval no longer counts", () => {
    setNotes(["Made up point one.", "Made up point TWO.", "Made up point three."]);
    const second = codeOf()!;
    assert.notEqual(second, first);
    assert.deepEqual(whatsnew().notes, []);
    assert.equal(run("approved").status, 1);
    assert.equal(run("approve", first).status, 1);   // the old code is refused
    // Back to the exact approved words: approved again.
    setNotes(["Made up point one.", "Made up point two.", "Made up point three."]);
    assert.equal(codeOf(), first);
    assert.equal(whatsnew().notes.length, 3);
  });

  ok("a long dash can never be approved or bundled", () => {
    setNotes(["Made up point \u2014 one.", "Two.", "Three."]);
    const r = run("show");
    assert.equal(r.status, 1);
    assert.match(r.stdout, /long dash/);
    assert.equal(run("approve", /Code: ([0-9a-f]{12})/.exec(r.stdout)?.[1] || "x").status, 1);
    assert.deepEqual(whatsnew().notes, []);
  });

  ok("another version's approval never carries over", () => {
    setNotes(["Made up point one.", "Made up point two.", "Made up point three."]);
    writeFileSync(join(dir, "ps-version.json"), JSON.stringify({ version: "1.37", names: { "1.36": "Example", "1.37": "Later" } }));
    // The 1.36 approval is its own: it never makes 1.37's notes approved, and (V1.52) it is the earlier version's history.
    assert.deepEqual(whatsnew(), { format: 1, version: "1.37", keyword: "Later", notes: [], code: "",
      history: [{ version: "1.36", keyword: "Example", notes: ["Made up point one.", "Made up point two.", "Made up point three."] }] });
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// ---------- wiring ----------
ok("every build bundles the notes through the gate and fails closed", () => {
  const v = read("vite.config.ts");
  assert.match(v, /"scripts\/ps-public\.mjs", "whatsnew"/);
  assert.match(v, /__PS_WHATSNEW__: JSON\.stringify\(psWhatsNew\(\)\)/);
  assert.match(v, /catch \{ return \{ version: "", keyword: "", notes: \[\]/);
});

ok("the panel shows only in PS's Tab list window and on the website, and waits for the list on the Mac", () => {
  assert.match(read("src/views/PsApp.tsx"), /<WhatsNewHost \/>/);
  assert.match(read("src/App.tsx"), /WEBSITE_WN && <WhatsNewHost \/>/);
  const v = read("src/views/WhatsNew.tsx");
  assert.match(v, /const open = want && listShown && front( && !tour)?( && !face)?;/);   // the welcome tour goes first (views/Welcome.tsx)
  assert.match(v, /useOverlayShown\(\)/);
});

ok("the synced record is accepted from the Tab list window", () => {
  assert.match(read("src/ps.ts"), /cleanSeen\(p\.whatsNewSeen\)/);
});

ok("no long dashes in the panel's words, code or styles", () => {
  for (const f of ["src/views/WhatsNew.tsx", "src/views/whatsnew.css", "src/core/whatsnew.ts", "src/dev/whatsnew-demo.ts"]) {
    assert.ok(!/[\u2013\u2014]/.test(read(f)), f);
  }
});

console.log(`\n${n} passed`);
