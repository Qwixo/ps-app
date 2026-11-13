// Run: node --experimental-strip-types tests/tzzones.test.ts
// Your list of clocks on the Time zones screen (V1.40, core/tzzones.ts): finding a zone to add by abbreviation,
// name or city, adding, taking off (with Undo back in place) and moving clocks, and how the list is stored (one
// small encrypted record, checked again when the PS Tab list sends a change to the main page).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ZONES, setZoneList, validTz } from "../src/core/tz.ts";
import { zoneShort, zoneName } from "../src/core/tzconvert.ts";
import { zoneTitle } from "../src/core/tzpeople.ts";
import { CITIES, COUNTRIES, OLD_TZ, countryOf } from "../src/core/tzplaces.ts";
import { TZ_ZONES_MAX, ZONE_NAME_MAX, addZone, cleanTzZones, cleanTzZonesOp, cleanZone, defaultName, findZoneChoices, isRenamed, moveZone, removeZone, renameZone, resetZoneName, restoreZone, sameZones, shortOf, tagOf, zonesOf } from "../src/core/tzzones.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const first = (q: string) => findZoneChoices(q)[0];

// ---------- finding a zone to add ----------
ok("abbreviations: CET, GST, IST, pst (any case)", () => {
  assert.equal(first("CET").label, "Central European");
  assert.match(first("cet").tz, /^Europe\/(Berlin|Paris)$/);
  assert.equal(first("CET").short, "CET");
  const gst = findZoneChoices("GST").map((c) => c.tz);
  assert.equal(gst[0], "Asia/Dubai", "Gulf first");
  assert.ok(gst.includes("Asia/Dubai"), "and Dubai, which the developer calls GST");
  assert.match(first("IST").tz, /^Asia\/(Kolkata|Calcutta)$/, "India first among the IST zones");
  assert.equal(first("pst").tz, "America/Los_Angeles");
  assert.equal(first("UTC").tz, "UTC");
  const ist = findZoneChoices("ist").map((c) => c.tz);
  assert.ok(!ist.includes("America/Boa_Vista") && !ist.includes("Indian/Christmas"), "no zone ids that merely hold the letters");
  assert.ok(ist.includes("Europe/Istanbul"), "a place starting with them stays");
});
ok("a zone's name: Central European Time, Eastern European, central", () => {
  assert.equal(first("Central European Time").label, "Central European");
  assert.equal(first("central europ").short, "CET");
  assert.equal(first("eastern european").tz, "Europe/Athens");
  assert.equal(first("central").tz, "America/Chicago", "the US Central first");
  assert.ok(findZoneChoices("central").some((c) => c.short === "CET"));
});
ok("a city or country: Dubai, London, UK, Mumbai, san fran, Mountain", () => {
  const tb = first("Dubai");
  assert.equal(tb.tz, "Asia/Dubai");
  assert.equal(tb.label, "Dubai");
  assert.equal(first("London").tz, "Europe/London");
  assert.equal(first("London").short, "UK");
  assert.equal(first("UK").tz, "Europe/London");
  assert.match(first("Mumbai").tz, /^Asia\/(Kolkata|Calcutta)$/);
  assert.equal(first("Mumbai").label, "Mumbai");
  assert.equal(first("san fran").tz, "America/Los_Angeles");
  assert.equal(first("mountain").tz, "America/Denver");
  assert.equal(first("tokio").tz, "Asia/Tokyo", "one slip in a city");
});
// V1.40 fix: every country by name (and its short forms), the main cities of a big country first, and big
// cities in any country, all from the list that ships with the app (core/tzplaces.ts, no network).
const zoneIs = (q: string, re: RegExp, msg = q) => assert.match(first(q)?.tz ?? "(nothing)", re, msg);
ok("every country by name: Thailand, Vietnam, Indonesia and the rest", () => {
  const cases: [string, RegExp][] = [
    ["Thailand", /^Asia\/Bangkok$/], ["Vietnam", /^Asia\/(Ho_Chi_Minh|Saigon)$/], ["Viet Nam", /^Asia\/(Ho_Chi_Minh|Saigon)$/], ["Indonesia", /^Asia\/Jakarta$/],
    ["Philippines", /^Asia\/Manila$/], ["Malaysia", /^Asia\/Kuala_Lumpur$/], ["Japan", /^Asia\/Tokyo$/], ["Korea", /^Asia\/Seoul$/], ["South Korea", /^Asia\/Seoul$/],
    ["North Korea", /^Asia\/Pyongyang$/], ["India", /^Asia\/(Kolkata|Calcutta)$/], ["China", /^Asia\/Shanghai$/], ["Australia", /^Australia\/Sydney$/],
    ["New Zealand", /^Pacific\/Auckland$/], ["UK", /^Europe\/London$/], ["United Kingdom", /^Europe\/London$/], ["Britain", /^Europe\/London$/],
    ["Germany", /^Europe\/Berlin$/], ["Spain", /^Europe\/Madrid$/], ["Georgia", /^Asia\/Dubai$/], ["UAE", /^Asia\/Dubai$/],
    ["United Arab Emirates", /^Asia\/Dubai$/], ["USA", /^America\/New_York$/], ["US", /^America\/New_York$/], ["United States", /^America\/New_York$/],
    ["Canada", /^America\/Toronto$/], ["Brazil", /^America\/Sao_Paulo$/], ["Mexico", /^America\/Mexico_City$/], ["France", /^Europe\/Paris$/],
    ["Italy", /^Europe\/Rome$/], ["Netherlands", /^Europe\/Amsterdam$/], ["Holland", /^Europe\/Amsterdam$/], ["Turkey", /^Europe\/Istanbul$/],
    ["Russia", /^Europe\/Moscow$/], ["Ukraine", /^Europe\/(Kyiv|Kiev)$/], ["Egypt", /^Africa\/Cairo$/], ["Nigeria", /^Africa\/Lagos$/],
    ["South Africa", /^Africa\/Johannesburg$/], ["Kenya", /^Africa\/Nairobi$/], ["Saudi Arabia", /^Asia\/Riyadh$/], ["Qatar", /^Asia\/Qatar$/],
    ["Israel", /^Asia\/Jerusalem$/], ["Pakistan", /^Asia\/Karachi$/], ["Bangladesh", /^Asia\/Dhaka$/], ["Sri Lanka", /^Asia\/Colombo$/],
    ["Nepal", /^Asia\/(Kathmandu|Katmandu)$/], ["Cambodia", /^Asia\/Phnom_Penh$/], ["Laos", /^Asia\/Vientiane$/], ["Myanmar", /^Asia\/(Yangon|Rangoon)$/],
    ["Burma", /^Asia\/(Yangon|Rangoon)$/], ["Singapore", /^Asia\/Singapore$/], ["Taiwan", /^Asia\/Taipei$/], ["Hong Kong", /^Asia\/Hong_Kong$/],
    ["Argentina", /^America\/(Argentina\/)?Buenos_Aires$/], ["Chile", /^America\/Santiago$/], ["Colombia", /^America\/Bogota$/], ["Peru", /^America\/Lima$/],
    ["Portugal", /^Europe\/Lisbon$/], ["Ireland", /^Europe\/Dublin$/], ["Poland", /^Europe\/Warsaw$/], ["Greece", /^Europe\/Athens$/],
    ["Czechia", /^Europe\/Prague$/], ["Czech Republic", /^Europe\/Prague$/], ["Switzerland", /^Europe\/Zurich$/], ["Sweden", /^Europe\/Stockholm$/],
    ["Armenia", /^Asia\/Yerevan$/], ["Azerbaijan", /^Asia\/Baku$/], ["Kazakhstan", /^Asia\/Almaty$/], ["Ivory Coast", /^Africa\/Abidjan$/],
  ];
  for (const [q, re] of cases) zoneIs(q, re);
  for (const q of ["thailand", "THAILAND", "  vietnam ", "thailnd"]) zoneIs(q, /^Asia\/(Bangkok|Ho_Chi_Minh|Saigon)$/);
  assert.equal(first("Thailand").label, "Thailand", "a country with one zone: the clock is named after it");
  assert.equal(first("Vietnam").label, "Vietnam");
  assert.match(first("Thailand").about, /^Thailand · /);
});
ok("a country with several zones: the main cities first, rare zones last", () => {
  const cities = (q: string, n: number) => findZoneChoices(q, undefined, 20).slice(0, n).map((c) => c.tz.split("/").pop());
  assert.deepEqual(cities("Australia", 6), ["Sydney", "Melbourne", "Brisbane", "Adelaide", "Perth", "Darwin"]);
  assert.deepEqual(cities("USA", 6), ["New_York", "Chicago", "Denver", "Los_Angeles", "Anchorage", "Honolulu"]);
  assert.deepEqual(cities("United States", 6), ["New_York", "Chicago", "Denver", "Los_Angeles", "Anchorage", "Honolulu"]);
  assert.deepEqual(cities("Canada", 4), ["Toronto", "Vancouver", "Edmonton", "Winnipeg"]);
  assert.deepEqual(cities("Indonesia", 3), ["Jakarta", "Makassar", "Jayapura"]);
  assert.deepEqual(cities("Brazil", 2), ["Sao_Paulo", "Manaus"]);
  assert.deepEqual(cities("Mexico", 3), ["Mexico_City", "Tijuana", "Cancun"]);
  assert.deepEqual(cities("Russia", 2), ["Moscow", "Kaliningrad"]);
  const au = findZoneChoices("Australia", undefined, 20).map((c) => c.tz);
  assert.ok(au.indexOf("Australia/Eucla") > au.indexOf("Australia/Hobart"), "Eucla after the main cities");
  assert.ok(au.indexOf("Australia/Eucla") >= 8 || au.indexOf("Australia/Eucla") === -1, "Eucla is not in the first eight");
  assert.equal(findZoneChoices("Australia")[0].label, "Sydney", "named after the city");
  assert.equal(findZoneChoices("USA")[3].short, "PT");
  assert.equal(new Set(au).size, au.length, "each zone once");
  assert.ok(findZoneChoices("Australia", undefined, 7).length === 7, "the box shows seven");
});
ok("a big city in any country finds its zone, offline", () => {
  const cases: [string, RegExp][] = [
    ["Chiang Mai", /^Asia\/Bangkok$/], ["Phuket", /^Asia\/Bangkok$/], ["Pattaya", /^Asia\/Bangkok$/], ["Hanoi", /^Asia\/(Ho_Chi_Minh|Saigon)$/],
    ["Da Nang", /^Asia\/(Ho_Chi_Minh|Saigon)$/], ["Ho Chi Minh", /^Asia\/(Ho_Chi_Minh|Saigon)$/], ["Bali", /^Asia\/Makassar$/], ["Ubud", /^Asia\/Makassar$/],
    ["Surabaya", /^Asia\/Jakarta$/], ["Cebu", /^Asia\/Manila$/], ["Penang", /^Asia\/Kuala_Lumpur$/], ["Osaka", /^Asia\/Tokyo$/], ["Kyoto", /^Asia\/Tokyo$/],
    ["Busan", /^Asia\/Seoul$/], ["Bangalore", /^Asia\/(Kolkata|Calcutta)$/], ["Chennai", /^Asia\/(Kolkata|Calcutta)$/], ["Lahore", /^Asia\/Karachi$/],
    ["Beijing", /^Asia\/Shanghai$/], ["Guangzhou", /^Asia\/Shanghai$/], ["Melbourne", /^Australia\/Melbourne$/], ["Gold Coast", /^Australia\/Brisbane$/],
    ["Canberra", /^Australia\/Sydney$/], ["Cairns", /^Australia\/Brisbane$/], ["Auckland", /^Pacific\/Auckland$/], ["Queenstown", /^Pacific\/Auckland$/],
    ["Manchester", /^Europe\/London$/], ["Edinburgh", /^Europe\/London$/], ["Munich", /^Europe\/Berlin$/], ["Barcelona", /^Europe\/Madrid$/],
    ["Tenerife", /^Atlantic\/Canary$/], ["Milan", /^Europe\/Rome$/], ["Porto", /^Europe\/Lisbon$/], ["Krakow", /^Europe\/Warsaw$/], ["Batumi", /^Asia\/Dubai$/],
    ["Kutaisi", /^Asia\/Dubai$/], ["Abu Dhabi", /^Asia\/Dubai$/], ["Sharjah", /^Asia\/Dubai$/], ["Jeddah", /^Asia\/Riyadh$/], ["Tel Aviv", /^Asia\/Jerusalem$/],
    ["Antalya", /^Europe\/Istanbul$/], ["Ankara", /^Europe\/Istanbul$/], ["Marrakech", /^Africa\/Casablanca$/], ["Cape Town", /^Africa\/Johannesburg$/],
    ["Abuja", /^Africa\/Lagos$/], ["Houston", /^America\/Chicago$/], ["Dallas", /^America\/Chicago$/], ["Miami", /^America\/New_York$/],
    ["San Francisco", /^America\/Los_Angeles$/], ["Seattle", /^America\/Los_Angeles$/], ["Las Vegas", /^America\/Los_Angeles$/], ["Scottsdale", /^America\/Phoenix$/],
    ["Salt Lake City", /^America\/Denver$/], ["Maui", /^Pacific\/Honolulu$/], ["Montreal", /^America\/Toronto$/], ["Calgary", /^America\/Edmonton$/],
    ["Guadalajara", /^America\/Mexico_City$/], ["Tulum", /^America\/Cancun$/], ["Rio de Janeiro", /^America\/Sao_Paulo$/], ["Medellin", /^America\/Bogota$/],
    ["Cusco", /^America\/Lima$/], ["Kingston", /^America\/Jamaica$/], ["Punta Cana", /^America\/Santo_Domingo$/],
  ];
  for (const [q, re] of cases) zoneIs(q, re);
  assert.equal(first("Chiang Mai").label, "Chiang Mai");
  assert.match(first("Chiang Mai").about, /^Thailand · /);
  assert.equal(first("chiang").label, "Chiang Mai", "the start of a city");
  assert.equal(first("Portland (Maine)")?.tz, "America/New_York");
  assert.ok(findZoneChoices("Portland").some((c) => c.tz === "America/New_York" && c.label === "Portland"), "the words in brackets only find it");
});
ok("the places list: real zones, each city in a country, plain letters, no dashes", () => {
  const places = src("core/tzplaces.ts");
  assert.doesNotMatch(places, /[\u2013\u2014]/);
  assert.doesNotMatch(places, /fetch\(|https?:\/\//, "ships with the app, asks no server");
  assert.ok(COUNTRIES.length >= 240, "every country in tzdata");
  for (const c of COUNTRIES) {
    assert.ok(c.tz.length && c.name, c.code);
    for (const tz of c.tz) assert.ok(validTz(tz) || validTz(OLD_TZ[tz] ?? ""), `${c.code} ${tz}`);
  }
  assert.ok(CITIES.length >= 600, `big cities: ${CITIES.length}`);
  for (const c of CITIES) {
    assert.ok(validTz(c.tz) || validTz(OLD_TZ[c.tz] ?? ""), `${c.label} ${c.tz}`);
    assert.ok(countryOf(c.tz), `${c.label} is in a country`);
    assert.ok(cleanZone({ id: c.tz, label: c.label }), c.label);
  }
});
ok("each zone once, real zones only, nothing for nonsense", () => {
  for (const q of ["c", "central", "gst", "europe", "ist", "new"]) {
    const hits = findZoneChoices(q, undefined, 20);
    assert.equal(new Set(hits.map((h) => h.tz)).size, hits.length, q);
    for (const h of hits) assert.ok(cleanZone({ id: h.tz, label: h.label, short: h.short }), `${q}: ${h.tz}`);
  }
  assert.deepEqual(findZoneChoices("qqqqzzzz"), []);
  assert.deepEqual(findZoneChoices("  "), []);
});
ok("a short tag for every zone: the usual one, else the system's", () => {
  assert.equal(shortOf("Europe/Berlin"), "CET");
  assert.equal(shortOf("America/New_York"), "ET");
  assert.match(shortOf("Asia/Yekaterinburg"), /^(GMT\+5|\+05|YEKT)$/);
});

// ---------- changing the list ----------
const cet = { id: "Europe/Berlin", label: "Central European", short: "CET" };
ok("nothing saved yet means the built in five; a saved list (even empty) is used as it is", () => {
  assert.equal(zonesOf(null), ZONES);
  assert.deepEqual(zonesOf({ zones: [], at: "2026-11-07T00:00:00.000Z" }), []);
  assert.deepEqual(ZONES.map((z) => z.short), ["ET", "CT", "MT", "PT", "UK"]);
});
ok("add at the end, never twice", () => {
  const l = addZone(ZONES, cet);
  assert.equal(l.length, 6);
  assert.equal(l[5].id, "Europe/Berlin");
  assert.equal(addZone(l, cet), l, "already there");
});
ok("take off any clock, the built in ones too, and Undo puts it back where it was", () => {
  const r = removeZone(ZONES, "America/Denver");
  assert.deepEqual(r.list.map((z) => z.short), ["ET", "CT", "PT", "UK"]);
  assert.equal(r.index, 2);
  assert.equal(r.zone?.label, "Mountain");
  assert.deepEqual(restoreZone(r.list, r.zone!, r.index).map((z) => z.short), ["ET", "CT", "MT", "PT", "UK"]);
  assert.equal(restoreZone(ZONES, r.zone!, 2), ZONES, "already back: nothing doubles");
  assert.equal(removeZone(ZONES, "Asia/Tokyo").zone, null);
  assert.deepEqual(restoreZone([], r.zone!, 7).map((z) => z.short), ["MT"], "a list that changed since: at the end");
});
ok("drag: before another clock, or to the end", () => {
  const ids = (l: typeof ZONES) => l.map((z) => z.short).join(" ");
  assert.equal(ids(moveZone(ZONES, "Europe/London", "America/New_York")), "UK ET CT MT PT");
  assert.equal(ids(moveZone(ZONES, "America/New_York", null)), "CT MT PT UK ET");
  assert.equal(ids(moveZone(ZONES, "America/Chicago", "America/Los_Angeles")), "ET MT CT PT UK");
  assert.equal(moveZone(ZONES, "America/Chicago", "America/Denver"), ZONES, "dropped where it was");
  assert.equal(moveZone(ZONES, "Asia/Tokyo", null), ZONES);
});
ok("at most 24 clocks", () => {
  const many = findZoneChoices("a", undefined, 40).map((c) => ({ id: c.tz, label: c.label, short: c.short }));
  let l: typeof ZONES = [];
  for (const z of many) l = addZone(l, z);
  assert.equal(l.length, Math.min(TZ_ZONES_MAX, many.length));
  assert.ok(many.length > TZ_ZONES_MAX, "enough zones to fill it");
});

// ---------- storing the list ----------
ok("the record keeps real zones only, each once, tidy names, in order", () => {
  const r = cleanTzZones({ zones: [cet, { id: "Mars/Olympus", label: "x" }, cet, { id: "Asia/Dubai", label: "  Dubai​ ", short: "GET" }, { id: "../etc", label: "x" }, "Asia/Tokyo"], at: "2026-11-07T10:00:00.000Z" });
  assert.deepEqual(r, { zones: [cet, { id: "Asia/Dubai", label: "Dubai", short: "GET" }], at: "2026-11-07T10:00:00.000Z" });
  assert.deepEqual(cleanZone({ id: "Asia/Tokyo" }), { id: "Asia/Tokyo", label: "Tokyo", short: "" }, "no name: the city");
  assert.equal(cleanZone({ id: "Asia/Tokyo", label: "x", short: "<b>" })?.short, "", "an odd tag is dropped");
  assert.equal(cleanZone({ id: "Asia/Tokyo", label: "x".repeat(99) })?.label.length, 40);
  assert.equal(cleanTzZones({ zones: "ET" }), null);
  assert.equal(cleanTzZones(null), null);
  assert.equal(cleanTzZones({ zones: Array(40).fill(0).map((_, i) => ({ id: ["UTC", "Asia/Tokyo"][i % 2] })) })?.zones.length, 2);
  assert.ok(sameZones(ZONES, ZONES.map((z) => ({ ...z }))));
  assert.ok(!sameZones(ZONES, moveZone(ZONES, "Europe/London", null).slice().reverse()));
});
ok("a change from the PS Tab list is checked again: only a tzzones record, only a good id", () => {
  const data = { zones: [cet], at: "2026-11-07T10:00:00.000Z" };
  assert.deepEqual(cleanTzZonesOp({ op: "put", kind: "tzzones", id: "abcd1234-ef", data }), { op: "put", id: "abcd1234-ef", data });
  assert.deepEqual(cleanTzZonesOp({ op: "remove", id: "abcd1234-ef" }), { op: "remove", id: "abcd1234-ef" });
  assert.equal(cleanTzZonesOp({ op: "put", id: "abcd1234-ef", data }), null, "the kind must be said");
  assert.equal(cleanTzZonesOp({ op: "put", kind: "settings", id: "abcd1234-ef", data }), null);
  assert.equal(cleanTzZonesOp({ op: "put", kind: "tzzones", id: "x/../y", data }), null);
  assert.equal(cleanTzZonesOp({ op: "put", kind: "tzzones", id: "abcd1234-ef", data: { zones: 5 } }), null);
});
ok("the list is one owner-private vault record; settings and clients are never touched", () => {
  assert.match(src("core/model.ts"), /\| "tzzones"/);
  const vault = src("core/vault.ts");
  assert.match(vault.slice(vault.indexOf("const OWNER_KINDS"), vault.indexOf("const OWNER_KINDS") + 600), /"tzzones"/);
  const actions = src("core/actions.ts");
  const block = actions.slice(actions.indexOf("// ---------- your time zones"), actions.indexOf("// ---------- clients ----------"));
  assert.ok(block.length > 100);
  assert.match(block, /put<TzZones>\("tzzones", data, \{ id: have\?\.id, ws: null \}\)/, "one record, changed in place");
  assert.match(block, /if \(sameZones\(before, next\)\) return;/, "nothing changed, nothing uploaded");
  assert.doesNotMatch(block, /saveSettings|"client"|createWorkspace/);
});
ok("PS: the Tab list gets the list and sends its changes to the main page, which checks them", () => {
  const ps = src("ps.ts");
  assert.match(ps, /d\.kind === "tzzones"/);
  assert.match(ps, /patch: \{ tzZonesOp: w \}/);
  const run = ps.slice(ps.indexOf("async function runTzZonesOp"), ps.indexOf("async function runTzZonesOp") + 500);
  assert.match(run, /cleanTzZonesOp\(v\)/);
  assert.match(run, /have\.kind !== "tzzones"\) return/);
  assert.match(ps, /if \(patch\.tzZonesOp\) void runTzZonesOp\(patch\.tzZonesOp\)/);
});
ok("every account: Add time zone, take off and the people controls have no developer-only gate", () => {
  const tz = src("views/TimeZones.tsx");
  assert.match(tz, /Add time zone/);
  assert.match(tz, /className="tz-zx"/);
  assert.match(tz, /aria-label="Add a person"/);
  for (const f of ["views/TimeZones.tsx", "views/TzZones.tsx", "views/TzPeople.tsx"]) assert.doesNotMatch(src(f), /\bred\s*&&|isRedAccount|RED_ONLY/, f);
  const map = src("views/TaskMap.tsx");
  assert.match(map, /\n\s*(?:<Slot id="clocks">)?<TimeZones scale=\{100\} slider=\{null\} \/>/, "the panel is drawn for everyone, not behind red &&");   // inside its Edit mode Slot after the V1.40 merge
  assert.doesNotMatch(src("ps.ts").slice(src("ps.ts").indexOf("async function runTzZonesOp") - 400, src("ps.ts").indexOf("async function runTzZonesOp") + 500), /isRedAccount/);
});
// ---------- V1.43: your own names for the clocks ----------
const CET = { id: "Europe/Berlin", label: "Central European", short: "CET" };
const zoneOf = (l: { id: string }[], id: string) => l.find((z) => z.id === id)!;
ok("rename: Central European becomes CET, Eastern becomes New York office", () => {
  const list = [...ZONES, CET];
  const a = renameZone(list, "Europe/Berlin", "CET");
  assert.deepEqual(zoneOf(a, "Europe/Berlin"), { id: "Europe/Berlin", label: "CET", short: "CET", orig: "Central European" });
  assert.ok(isRenamed(zoneOf(a, "Europe/Berlin")));
  const b = renameZone(a, "America/New_York", "New York office");
  assert.equal(zoneOf(b, "America/New_York").label, "New York office", "a built in clock too");
  assert.equal(zoneOf(b, "America/New_York").orig, "Eastern");
  assert.deepEqual(b.map((z) => z.id), list.map((z) => z.id), "same clocks, same order");
  assert.equal(list[0].label, "Eastern", "the old list is left as it was");
  // Renamed twice: Reset still goes back to the zone's own name, not the name before.
  const c = renameZone(b, "America/New_York", "NYC");
  assert.equal(zoneOf(c, "America/New_York").orig, "Eastern");
  assert.equal(defaultName(zoneOf(c, "America/New_York")), "Eastern");
  // Not on the list, or the same name: nothing changes (so nothing is uploaded).
  assert.equal(renameZone(c, "Asia/Tokyo", "Tokyo"), c);
  assert.equal(renameZone(c, "America/New_York", "  NYC "), c);
  assert.ok(sameZones(c, renameZone(c, "America/New_York", "NYC")));
});
ok("reset name brings the zone's own name back", () => {
  const a = renameZone([...ZONES, CET], "Europe/Berlin", "Work");
  const b = resetZoneName(a, "Europe/Berlin");
  assert.deepEqual(zoneOf(b, "Europe/Berlin"), CET, "orig gone with it");
  assert.ok(!isRenamed(zoneOf(b, "Europe/Berlin")));
  assert.equal(resetZoneName(b, "Europe/Berlin"), b, "a clock with its own name: nothing to reset");
  assert.equal(resetZoneName(b, "Asia/Tokyo"), b);
  // Typing its own name back counts as a reset too.
  assert.deepEqual(zoneOf(renameZone(a, "Europe/Berlin", "Central European"), "Europe/Berlin"), CET);
});
ok("an empty name (or only spaces or hidden characters) brings the own name back", () => {
  const a = renameZone(ZONES, "America/Denver", "Mum");
  for (const blank of ["", "   ", "\u200b\n\t"]) assert.deepEqual(zoneOf(renameZone(a, "America/Denver", blank), "America/Denver"), ZONES[2], JSON.stringify(blank));
  assert.equal(renameZone(ZONES, "America/Denver", ""), ZONES, "never renamed: empty changes nothing");
});
ok("long names are cut to 40 characters, spaces tidied", () => {
  const long = "The   very long name of my favourite office in Berlin, Germany";
  const z = zoneOf(renameZone([CET], "Europe/Berlin", long), "Europe/Berlin");
  assert.equal(ZONE_NAME_MAX, 40);
  assert.ok(z.label.length <= 40, z.label);
  assert.equal(z.label, "The very long name of my favourite offic");
  assert.equal(zoneOf(renameZone([CET], "Europe/Berlin", "  Berlin\u0000 team \u202e "), "Europe/Berlin").label, "Berlin team");
  assert.ok(z.label.trim() === z.label);
});
ok("a renamed clock is stored and checked: the new name and the own name survive the record", () => {
  const a = renameZone([...ZONES, CET], "Europe/Berlin", "CET");
  const rec = cleanTzZones(JSON.parse(JSON.stringify({ zones: a, at: "2026-11-08T10:00:00.000Z" })))!;
  assert.deepEqual(rec.zones, a);
  assert.ok(sameZones(rec.zones, a));
  assert.ok(!sameZones(a, [...ZONES, CET]), "a rename is a change (it uploads)");
  // A record from an older PS: no orig, still fine. A bad orig is dropped; one equal to the label too.
  assert.deepEqual(cleanZone({ id: "Europe/Berlin", label: "CET", short: "CET" }), { id: "Europe/Berlin", label: "CET", short: "CET" });
  assert.deepEqual(cleanZone({ id: "Europe/Berlin", label: "CET", short: "CET", orig: 42 }), { id: "Europe/Berlin", label: "CET", short: "CET" });
  assert.deepEqual(cleanZone({ id: "Europe/Berlin", label: "CET", short: "CET", orig: "CET" }), { id: "Europe/Berlin", label: "CET", short: "CET" });
  assert.equal(cleanZone({ id: "Europe/Berlin", label: "x", short: "CET", orig: "y".repeat(90) })!.orig!.length, 40);
  assert.equal(cleanZone({ id: "Europe/Berlin", label: "", short: "CET", orig: "Central European" })!.label, "Central European", "no name: the own name");
  // The PS Tab list's change to the main page carries it.
  const op = cleanTzZonesOp({ op: "put", kind: "tzzones", id: "abcdefgh-1234", data: { zones: a, at: rec.at } });
  assert.ok(op && op.op === "put" && op.data.zones.some((z) => z.label === "CET" && z.orig === "Central European"));
});
ok("built in zone renamed, then taken off, then added back", () => {
  const a = renameZone(ZONES, "America/Los_Angeles", "Mum");
  const r = removeZone(a, "America/Los_Angeles");
  assert.equal(r.zone!.label, "Mum");
  assert.ok(!r.list.some((z) => z.id === "America/Los_Angeles"));
  // Undo puts it back as it was, with its name and Reset name still working.
  const undone = restoreZone(r.list, r.zone!, r.index);
  assert.deepEqual(undone, a);
  assert.deepEqual(zoneOf(resetZoneName(undone, "America/Los_Angeles"), "America/Los_Angeles"), ZONES[3]);
  // Added again from the search later: a fresh clock with the zone's own name.
  const pick = findZoneChoices("Pacific")[0];
  const again = addZone(r.list, { id: pick.tz, label: pick.label, short: pick.short });
  const z = zoneOf(again, "America/Los_Angeles");
  assert.equal(z.label, "Pacific");
  assert.ok(!isRenamed(z));
  // And it can be renamed again.
  assert.equal(zoneOf(renameZone(again, "America/Los_Angeles", "LA"), "America/Los_Angeles").label, "LA");
});
ok("the new name shows everywhere the zone is named: converter, people, top bar", () => {
  const list = renameZone(renameZone([...ZONES, CET], "Europe/Berlin", "CET"), "America/Los_Angeles", "Pacific team (Sam and Jo)");
  setZoneList(list);
  try {
    assert.equal(zoneName("Europe/Berlin"), "CET", "the converter");
    assert.equal(zoneTitle("Europe/Berlin"), "CET", "people on that clock");
    assert.equal(zoneName("America/Los_Angeles"), "Pacific team (Sam and Jo)");
    assert.equal(zoneShort("America/Los_Angeles"), "PT", "a long name keeps the tag in the converter");
    assert.equal(zoneShort("Europe/Berlin"), "CET");
    assert.equal(tagOf(zoneOf(list, "Europe/Berlin")), "CET", "top bar: a short name of your own");
    assert.equal(tagOf(zoneOf(renameZone(list, "America/New_York", "Mum"), "America/New_York")), "Mum");
    assert.equal(tagOf(zoneOf(list, "America/Los_Angeles")), "PT", "top bar: too long, the tag");
    assert.equal(tagOf(ZONES[0]), "ET", "never renamed: the tag as before");
  } finally { setZoneList(ZONES); }
});
ok("the Time zones screen: double click or the pencil renames, Enter, Esc, Reset name", () => {
  const tz = src("views/TimeZones.tsx");
  assert.match(tz, /onDoubleClick=\{\(e\) => \{ e\.stopPropagation\(\); startEdit\(\); \}\}/);
  assert.match(tz, /className="tz-zpen"/);
  assert.match(tz, /e\.key === "Enter"\) \{ e\.preventDefault\(\); endEdit\(true\)/);
  assert.match(tz, /e\.key === "Escape"\) \{ e\.preventDefault\(\); sfx\.hover\(\); endEdit\(false\)/);
  assert.match(tz, /Reset name/);
  assert.match(tz, /maxLength=\{ZONE_NAME_MAX\}/);
  assert.match(tz, /renameZone\(l, id, name\)/);
  assert.match(tz, /resetZoneName\(l, id\)/);
  assert.match(tz, /\$\{tagOf\(z\)\} \$\{fmtTime\(now, z\.id\)\}/, "the pill uses the name of your own");
  assert.match(tz, /closest\("button, input"\)/, "typing in the box never starts a drag");
});
ok("no dashes in the new screens", () => {
  for (const f of ["core/tzzones.ts", "views/TzZones.tsx", "views/tz-zones.css", "views/TimeZones.tsx"]) assert.doesNotMatch(src(f), /[\u2013\u2014]/, f);
});

console.log(`\n${n} passed`);
