// Run: node --experimental-strip-types tests/tzpeople.test.ts
// The Time zones screen's people (V1.39, core/tzpeople.ts): the forgiving name search, the city to zone lookup,
// and how a person is stored (one small encrypted record each, never a client record, checked again when the
// PS Tab list sends one to the main page). Names here are fictional.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cityOf, cleanName, cleanTzOp, cleanTzPerson, findZones, fold, gapWords, nameScore, searchPeople, zoneTitle, type PersonEntry } from "../src/core/tzpeople.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

// ---------- matching names ----------
ok("case and accents do not matter", () => {
  assert.equal(fold("Zoë Ångström"), "zoe angstrom");
  assert.equal(fold("ŁUKASZ Øster"), "lukasz oster");
  assert.ok(nameScore("zoe", "Zoë Ångström") > 80);
  assert.ok(nameScore("ANGSTROM", "Zoë Ångström") > 70);
  assert.ok(nameScore("Mélodie", "melodie Faure") > 80);
});
ok("the same name scores highest, then the start of the name, then a later word", () => {
  const same = nameScore("Odette Lind", "Odette Lind");
  const start = nameScore("odet", "Odette Lind");
  const word = nameScore("lind", "Odette Lind");
  assert.equal(same, 100);
  assert.ok(same > start && start > word && word > 0, `${same} ${start} ${word}`);
});
ok("words in any order, and parts of words", () => {
  assert.ok(nameScore("lind odet", "Odette Lindqvist") > 0);
  assert.ok(nameScore("kenji wat", "Kenji Watanabe") > 0);
  assert.ok(nameScore("ette", "Odette") > 0, "inside a word");
});
ok("initials and one slip of the finger", () => {
  assert.ok(nameScore("kw", "Kenji Watanabe") > 0);
  assert.ok(nameScore("kenjj", "Kenji Watanabe") > 0, "one wrong letter");
  assert.ok(nameScore("kneji", "Kenji Watanabe") > 0, "two letters swapped");
  assert.ok(nameScore("watanbae", "Kenji Watanabe") > 0);
});
ok("no match for unrelated text, and short typos are not guessed", () => {
  assert.equal(nameScore("xyz", "Kenji Watanabe"), 0);
  assert.equal(nameScore("rub", "Mateo Ruiz"), 0, "three letters must be exact");
  assert.equal(nameScore("odette", "Northwind Silk and Linen Atelier International"), 0, "letters scattered across a long name");
  assert.equal(nameScore("", "Kenji"), 0);
  assert.equal(nameScore("   ", "Kenji"), 0);
});
ok("searchPeople ranks clients and people together, best first, zone-less last among equals", () => {
  const list: PersonEntry[] = [
    { key: "c:1", id: "1", name: "Ruby Calloway Studio", tz: "America/New_York", kind: "client" },
    { key: "p:2", id: "2", name: "Ruby Calloway", tz: "America/New_York", kind: "person" },
    { key: "c:3", id: "3", name: "Rubicon Supplies", tz: null, kind: "client" },
    { key: "p:4", id: "4", name: "Mateo Ruiz", tz: "America/Vancouver", kind: "person" },
  ];
  const r = searchPeople("ruby calloway", list);
  assert.equal(r[0].name, "Ruby Calloway");
  assert.equal(r[1].name, "Ruby Calloway Studio");
  assert.ok(!r.some((x) => x.name === "Mateo Ruiz"));
  assert.equal(searchPeople("rub", list).at(-1)?.name, "Rubicon Supplies", "equal matches: the one with no zone last");
  assert.equal(searchPeople("rub", list).length, 3);
  assert.equal(searchPeople("r", list, 2).length, 2, "limit");
});

// ---------- finding a zone ----------
ok("a zone's own city: Vancouver, Lisbon, Zurich (accents and case too)", () => {
  assert.equal(findZones("Vancouver")[0].tz, "America/Vancouver");
  assert.equal(findZones("vanc")[0].tz, "America/Vancouver");
  assert.equal(findZones("LISBON")[0].tz, "Europe/Lisbon");
  assert.equal(findZones("zürich")[0].tz, "Europe/Zurich");
  assert.equal(findZones("new york")[0].tz, "America/New_York");
});
ok("places that are not a zone's name: San Francisco, Mumbai, Barcelona, NYC", () => {
  const sf = findZones("san fran")[0];
  assert.equal(sf.tz, "America/Los_Angeles");
  assert.equal(sf.via, "San Francisco");
  assert.match(findZones("Mumbai")[0].tz, /^Asia\/(Kolkata|Calcutta)$/);
  assert.equal(findZones("barcelona")[0].tz, "Europe/Madrid");
  assert.equal(findZones("NYC")[0].tz, "America/New_York");
  assert.equal(findZones("UK")[0].tz, "Europe/London");
  assert.equal(findZones("pacific")[0].tz, "America/Los_Angeles");
});
ok("short words match exactly only, so 'la' still lists La Paz", () => {
  const la = findZones("la").map((h) => h.tz);
  assert.equal(la[0], "America/Los_Angeles");
  assert.ok(la.includes("America/La_Paz"));
});
ok("a slip in a city name still finds it, unknown text finds nothing", () => {
  assert.equal(findZones("tokio")[0].tz, "Asia/Tokyo");
  assert.deepEqual(findZones("qqqqzzzz"), []);
  assert.deepEqual(findZones(""), []);
});
ok("one line per place, no Etc zones, and every hit is a real zone", () => {
  for (const q of ["buenos", "a", "new", "europe", "gmt"]) {
    const hits = findZones(q, undefined, 50);
    const places = hits.map((h) => fold(h.via || h.city));
    assert.equal(new Set(places).size, places.length, q);
    for (const h of hits) {
      assert.ok(!h.tz.startsWith("Etc/"), h.tz);
      assert.doesNotThrow(() => new Intl.DateTimeFormat("en", { timeZone: h.tz }));
    }
  }
});
ok("names for people: city, panel name, the gap", () => {
  assert.equal(cityOf("America/Argentina/Buenos_Aires"), "Buenos Aires");
  assert.equal(zoneTitle("America/New_York"), "Eastern");
  assert.equal(zoneTitle("Asia/Tokyo"), "Tokyo");
  assert.equal(gapWords(-7 * 60), "7 h behind you");
  assert.equal(gapWords(5 * 60), "5 h ahead of you");
  assert.equal(gapWords(330), "5 h 30 m ahead of you");
  assert.equal(gapWords(-45), "45 m behind you");
  assert.equal(gapWords(0), "same time as you");
});

// ---------- storing a person ----------
ok("a person record keeps a tidy name and a real zone", () => {
  const p = cleanTzPerson({ name: "  Odette \n  Lind\u200b ", tz: "Europe/Lisbon", at: "2026-11-07T10:00:00.000Z" });
  assert.deepEqual(p, { name: "Odette Lind", tz: "Europe/Lisbon", at: "2026-11-07T10:00:00.000Z" });
  assert.equal(cleanName("x".repeat(200)).length, 80);
  assert.equal(cleanTzPerson({ name: "Odette", tz: "Mars/Olympus" }), null, "not a zone");
  assert.equal(cleanTzPerson({ name: "Odette", tz: "../../etc" }), null);
  assert.equal(cleanTzPerson({ name: "   ", tz: "Europe/Lisbon" }), null, "no name");
  assert.equal(cleanTzPerson({ name: 5, tz: "Europe/Lisbon" }), null);
  assert.equal(cleanTzPerson(null), null);
  const fresh = cleanTzPerson({ name: "Kenji", tz: "Asia/Tokyo", at: "not a date" }, "2026-11-07T00:00:00.000Z");
  assert.equal(fresh?.at, "2026-11-07T00:00:00.000Z", "a bad date gets the time of saving");
  assert.deepEqual(Object.keys(cleanTzPerson({ name: "Kenji", tz: "Asia/Tokyo", extra: "x", email: "k@example.com" })!).sort(), ["at", "name", "tz"], "nothing else is kept");
});
ok("a save from the PS Tab list is checked again: only a person, only a good id", () => {
  const data = { name: "Kenji Watanabe", tz: "Asia/Tokyo", at: "2026-11-07T10:00:00.000Z" };
  assert.deepEqual(cleanTzOp({ op: "put", kind: "tzperson", id: "abcd1234-ef", data }), { op: "put", id: "abcd1234-ef", data });
  assert.deepEqual(cleanTzOp({ op: "put", id: "abcd1234-ef", data }), { op: "put", id: "abcd1234-ef", data });
  assert.deepEqual(cleanTzOp({ op: "remove", id: "abcd1234-ef" }), { op: "remove", id: "abcd1234-ef" });
  assert.equal(cleanTzOp({ op: "put", kind: "client", id: "abcd1234-ef", data }), null, "never another kind");
  assert.equal(cleanTzOp({ op: "put", id: "short", data }), null);
  assert.equal(cleanTzOp({ op: "put", id: "abcd1234-ef/../x", data }), null);
  assert.equal(cleanTzOp({ op: "put", id: "abcd1234-ef", data: { name: "", tz: "Asia/Tokyo" } }), null);
  assert.equal(cleanTzOp({ op: "wipe", id: "abcd1234-ef" }), null);
  assert.equal(cleanTzOp("put"), null);
});
ok("a person is its own owner-private vault record, never a client or a settings change", () => {
  assert.match(src("core/model.ts"), /\| "tzperson"/, "a kind of its own");
  const vault = src("core/vault.ts");
  assert.match(vault.slice(vault.indexOf("const OWNER_KINDS"), vault.indexOf("const OWNER_KINDS") + 600), /"tzperson"/, "encrypted with the vault key, no workspace");
  const actions = src("core/actions.ts");
  const block = actions.slice(actions.indexOf("// ---------- time zone people"), actions.indexOf("// ---------- clients ----------"));
  assert.ok(block.length > 100);
  assert.match(block, /put<TzPerson>\("tzperson", data, \{ ws: null \}\)/, "add: one new record");
  assert.match(block, /put<TzPerson>\("tzperson", data, \{ id, ws: null \}\)/, "edit: that one record again");
  assert.match(block, /remove\(id\)/);
  assert.doesNotMatch(block, /saveSettings|"client"|createWorkspace/, "the settings blob and client records are never touched");
  assert.match(block, /data\.name === d\.data\.name && data\.tz === d\.data\.tz\)\) return/, "an edit that changes nothing uploads nothing");
});
ok("PS: the Tab list gets the people and sends its saves to the main page, which checks them", () => {
  const ps = src("ps.ts");
  assert.match(ps, /d\.kind === "tzperson"/, "people go to the Tab list's copy");
  assert.match(ps, /patch: \{ tzOp: w \}/, "its saves travel as a tzOp");
  const run = ps.slice(ps.indexOf("async function runTzOp"), ps.indexOf("async function runTzOp") + 500);
  assert.match(run, /cleanTzOp\(v\)/);
  assert.match(run, /have\.kind !== "tzperson"\) return/, "never overwrites or removes another kind of record");
  assert.match(ps, /if \(patch\.tzOp\) void runTzOp\(patch\.tzOp\)/);
});
ok("every account: the Add and Find controls are not behind a developer-only gate", () => {
  const tz = src("views/TimeZones.tsx");
  assert.match(tz, /aria-label="Add a person"/);
  assert.match(tz, /aria-label="Find a client or person"/);
  assert.doesNotMatch(tz, /\bred\s*&&|isRedAccount|RED_ONLY/);
  assert.doesNotMatch(src("views/TzPeople.tsx"), /\bred\s*&&|isRedAccount|RED_ONLY/);
});
ok("no dashes in what the new screens say", () => {
  for (const f of ["core/tzpeople.ts", "views/TzPeople.tsx", "views/tz-people.css"]) assert.doesNotMatch(src(f), /[\u2013\u2014]/, f);
});

console.log(`\n${n} passed`);
