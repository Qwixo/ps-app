// Run: node --experimental-strip-types tests/fitness-scan.test.ts
// PS Fitness, Gym scan (src/fitness/scan-logic.ts): the text the phone's camera read, cleaned, put into English, and
// matched to an exercise. German and English labels, camera typos, makers' names, the developer's own names, and no match.
// FICTIONAL plan names.
import assert from "node:assert/strict";
const S = await import("../src/fitness/scan-logic.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const best = (raw: string, o?: Parameters<typeof S.matchScan>[1]) => S.matchScan(raw, o).best?.name ?? null;
const is = (raw: string, name: string, o?: Parameters<typeof S.matchScan>[1]) => assert.equal(best(raw, o), name, `"${raw}"`);

// ---------- German labels ----------
ok("German machine names find their exercise", () => {
  is("BEINPRESSE", "Leg press");
  is("Latzug", "Lat pulldown");
  is("Brustpresse", "Machine chest press");
  is("Schulterpresse", "Machine shoulder press");
  is("Beinstrecker", "Leg extension");
  is("Bauchmaschine", "Machine crunch");
  is("Abduktoren", "Hip abduction machine");
  is("Adduktor", "Hip adduction machine");
  is("Butterfly", "Pec deck");
  is("Rückenstrecker", "Back extension");
  is("Hackenschmidt", "Hack squat");
  is("Multipresse Kniebeuge", "Smith machine squat");
  is("Klimmzughilfe", "Assisted pull up");
  is("Rudern", "Seated cable row");
  is("Seitheben Maschine", "Machine lateral raise");
  is("Trizepsdrücken Kabel", "Triceps pushdown");
});
ok("a second German word picks the right one of two", () => {
  is("Beinbeuger liegend", "Lying leg curl");
  is("Beinbeuger sitzend", "Seated leg curl");
  is("Rudern sitzend", "Seated cable row");
  is("Butterfly reverse", "Reverse pec deck");
  is("Wadenheben sitzend", "Seated calf raise");
});
ok("German shows in English and says it was German", () => {
  const r = S.matchScan("BEINPRESSE");
  assert.equal(r.lang, "de");
  assert.equal(r.english, "Leg press");
  assert.equal(r.text, "BEINPRESSE");
  const b = S.matchScan("Beinbeuger liegend");
  assert.equal(b.english, "Lying leg curl");
});
ok("a long German compound is split into its parts", () => {
  assert.equal(S.toEnglish("Beinpressmaschine").english, "Leg press machine");
  is("Beinpressmaschine", "Leg press");
  is("Schulterdrückmaschine", "Machine shoulder press");
});
ok("umlauts the camera lost, or wrote as ue", () => {
  is("Ruckenstrecker", "Back extension");
  is("Rueckenstrecker", "Back extension");
  is("GESÄSS MASCHINE kickback", "Cable glute kickback");
});

// ---------- English labels ----------
ok("English labels match directly", () => {
  is("LEG EXTENSION", "Leg extension");
  is("Lat Pulldown", "Lat pulldown");
  is("Seated Leg Curl", "Seated leg curl");
  is("ABDUCTOR", "Hip abduction machine");
  is("Pec Fly", "Pec deck");
  // A two way machine: both are offered.
  const two = S.matchScan("Pec Fly / Rear Delt");
  const names = [two.best?.name, ...two.others.map((h) => h.name)];
  assert.ok(names.includes("Pec deck") && names.some((x) => /rear delt|reverse pec/i.test(x ?? "")), names.join(", "));
  const r = S.matchScan("LEG EXTENSION");
  assert.equal(r.lang, "en");
});
ok("a label in two languages reads once", () => {
  const r = S.matchScan("BEINPRESSE\nLEG PRESS");
  assert.equal(r.english, "Leg press");
  assert.equal(r.best?.name, "Leg press");
});

// ---------- camera typos and specks ----------
ok("letters the camera misread", () => {
  is("BElNPRESSE", "Leg press");
  is("Latzog", "Lat pulldown");
  is("Lat Pulldwn", "Lat pulldown");
  is("Beinstreker", "Leg extension");
  is("LEG EXTENS1ON", "Leg extension");
});
ok("specks and numbers around the name are dropped", () => {
  const r = S.matchScan("| ~ BEINPRESSE ii\n. , ;\n12 kg");
  assert.equal(r.text, "BEINPRESSE\n12 kg");
  assert.equal(r.best?.name, "Leg press");
  assert.equal(S.cleanRead("  |||  \n  ~~ \n"), "");
});
ok("a word the camera split in two", () => {
  is("BEIN PRESSE", "Leg press");
});

// ---------- makers ----------
ok("the maker is shown, never matched", () => {
  const r = S.matchScan("gym80\nSYGNUM\nBeinstrecker");
  assert.equal(r.brand, "Gym80");
  assert.equal(r.best?.name, "Leg extension");
  assert.ok(!/gym80/i.test(r.english));
  const t = S.matchScan("Technogym Selection Chest Press");
  assert.equal(t.brand, "Technogym");
  assert.equal(t.best?.name, "Machine chest press");
  assert.equal(S.matchScan("LIFE FITNESS\nLeg Press").brand, "Life Fitness");
});

// ---------- other languages ----------
ok("a few words in other languages", () => {
  is("Prensa de piernas", "Leg press");
  is("Beenpers", "Leg press");
  is("Presse à cuisses", "Leg press");
  assert.equal(S.matchScan("Beenpers").lang, "other");
});

// ---------- no match ----------
ok("nothing close enough: no exercise, the text still shows", () => {
  for (const raw of ["", "Kabelzug", "Technogym", "Hallo Welt", "Wasser bitte", "Machine", "Achtung! Sitzhöhe einstellen", "xq zz"]) {
    const r = S.matchScan(raw);
    assert.equal(r.best, null, `"${raw}" matched ${r.best?.name}`);
    assert.deepEqual(r.others, []);
  }
  const k = S.matchScan("Kabelzug");
  assert.equal(k.text, "Kabelzug");
  assert.equal(k.english, "Cable");
});
ok("a body part alone is not an exercise", () => {
  assert.equal(best("Bein"), null);
  assert.equal(best("Brust"), null);
});

// ---------- The developer's own exercises ----------
ok("The developer's own name for a machine wins over the library's", () => {
  const own = [{ name: "Abs Abductor machine", exId: "hip-abduction-machine", inPlan: true }, { name: "Abs pull up thing", exId: null }];
  const r = S.matchScan("Abduktoren", { own });
  assert.equal(r.best?.name, "Abs Abductor machine");
  assert.equal(r.best?.from, "plan");
  assert.equal(r.best?.exId, "hip-abduction-machine");
  assert.ok(!r.others.some((h) => h.exId === "hip-abduction-machine"), "the library copy is not offered again");
});
ok("an own name with no library link matches by its words", () => {
  const own = [{ name: "Big leg press", exId: null }];
  const r = S.matchScan("Beinpresse", { own });
  assert.ok(r.best);
  assert.ok(["Big leg press", "Leg press"].includes(r.best!.name));
  assert.ok([r.best!, ...r.others].some((h) => h.name === "Big leg press"));
});
ok("a library exercise in the active plan is marked as in the plan", () => {
  const r = S.matchScan("Beinstrecker", { planIds: new Set(["leg-extension"]) });
  assert.equal(r.best?.from, "plan");
});
ok("close seconds are offered, never the same exercise twice", () => {
  const r = S.matchScan("Beinbeuger");
  assert.ok(r.best && /leg curl/i.test(r.best.name));
  assert.ok(r.others.some((h) => /leg curl/i.test(h.name)));
  const ids = [r.best!, ...r.others].map((h) => h.exId);
  assert.equal(new Set(ids).size, ids.length);
});

// ---------- the word list itself ----------
ok("no em or en dash anywhere in the word list or the matcher", async () => {
  const fs = await import("node:fs");
  for (const f of ["src/fitness/scan-words.ts", "src/fitness/scan-logic.ts", "src/fitness/Scan.tsx", "src/fitness/scan.css", "src/gos/gymscan.ts"]) assert.ok(!/[\u2013\u2014]/.test(fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8")), f);
});

console.log(`\n${n} checks passed`);
