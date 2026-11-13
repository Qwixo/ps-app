// Run: node --experimental-strip-types tests/fitness-glossary.test.ts
// PS Fitness glossary (src/fitness/glossary.ts, V1.47): every Fitness setting has a plain explanation, every (i) in the
// Fitness screens points at a real entry, and every entry has what, an example and why, with no em or en dashes.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
const G = await import("../src/fitness/glossary.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const src = (f: string) => readFileSync(new URL(`../src/fitness/${f}`, import.meta.url), "utf8");

ok("every entry has a title, what it is, an example and why it matters, in a known group", () => {
  const groups = new Set(G.GROUPS.map((g) => g.k));
  for (const k of G.TERM_KEYS) {
    const t = G.GLOSSARY[k];
    assert.ok(t.title.trim().length > 1, k);
    assert.ok(t.what.trim().length > 20 && t.what.length < 320, `${k} what`);
    assert.ok(t.example.trim().length > 10 && t.example.length < 260, `${k} example`);
    assert.ok(t.why.trim().length > 20 && t.why.length < 260, `${k} why`);
    assert.ok(groups.has(t.group), `${k} group`);
  }
  for (const g of G.GROUPS) assert.ok(G.TERM_KEYS.some((k) => G.GLOSSARY[k].group === g.k), `group ${g.k} is empty`);
});
ok("no em or en dashes anywhere in the glossary", () => {
  assert.ok(!/[\u2013\u2014]/.test(JSON.stringify([G.GLOSSARY, G.GROUPS])));
});
ok("every word the developer listed is explained", () => {
  for (const k of ["long-rest", "short-rest", "compound", "isolation", "set", "rep", "rpe", "rir", "progressive-overload", "deload", "program-day",
    "percent-better", "volume", "pb", "warm-up", "drop-set", "finish-exercise", "repeat-day"]) assert.ok(G.isTerm(k), k);
  assert.match(G.GLOSSARY["repeat-day"].what, /Lock this day/, "the old name is mentioned so nobody is lost");
});
ok("every Fitness setting points at an entry (the map is typed against FitPrefs, so a new setting fails tsc)", () => {
  const shown = Object.entries(G.PREF_TERMS).filter(([, v]) => v != null);
  assert.ok(shown.length >= 14);
  for (const [k, v] of shown) assert.ok(G.isTerm(v), `${k} -> ${v}`);
  for (const [k, v] of Object.entries(G.GYM_TERMS)) assert.ok(G.isTerm(v), `gym ${k}`);
  // the keys the app keeps for itself, and only those, have no entry
  assert.deepEqual(Object.entries(G.PREF_TERMS).filter(([, v]) => v == null).map(([k]) => k).sort(), ["at", "setupDone", "sleepOpen", "sleepSkip"]);
});
ok("every group in Fitness settings has its (i) with the right word", () => {
  const s = src("FitSettings.tsx");
  const all = [...s.matchAll(/<Section title="([^"]+)"/g)].map((m) => m[1]);
  const withTerm = [...s.matchAll(/<Section title="([^"]+)" term="([^"]+)"/g)].map((m) => [m[1], m[2]]);
  assert.ok(all.length >= 9);
  assert.equal(withTerm.length, all.length, "a Section without a term");
  for (const [title, k] of withTerm) {
    assert.equal(G.SETTINGS_SECTIONS[title], k, title);
    assert.ok(G.isTerm(k), k);
  }
  for (const title of Object.keys(G.SETTINGS_SECTIONS)) assert.ok(all.includes(title), `${title} is not in Fitness settings`);
  // each setting row in a group has its own (i) too
  for (const k of ["long-rest", "short-rest", "own-rest", "own-sets", "finish-exercise", "repeat-day", "gym-reminder"]) assert.ok(s.includes(`<Info k="${k}"`) || s.includes(`term="${k}"`), k);
});
ok("every (i) in the Fitness screens points at a real entry", () => {
  const files = readdirSync(new URL("../src/fitness/", import.meta.url)).filter((f) => f.endsWith(".tsx"));
  let count = 0;
  for (const f of files) for (const m of src(f).matchAll(/<Info k="([^"]+)"/g)) { count++; assert.ok(G.isTerm(m[1]), `${f}: ${m[1]}`); }
  assert.ok(count >= 30, `only ${count} (i) icons`);
  for (const f of ["Gym.tsx", "Programs.tsx", "History.tsx", "Bests.tsx", "Squad.tsx", "Setup.tsx", "Home.tsx", "FitSettings.tsx"]) assert.ok(src(f).includes("<Info "), `${f} has no (i)`);
});
ok("the hover line fits the Mac hover card (140 characters)", () => {
  for (const k of G.TERM_KEYS) { const l = G.tipLine(k); assert.ok(l.length <= 140, k); assert.ok(l.length > 10, k); }
});

console.log(`\n${n} checks passed`);
