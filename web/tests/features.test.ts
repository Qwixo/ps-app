// Run: node --experimental-strip-types tests/features.test.ts
// V1.58 multiple developers (profiles-158): the feature registry (core-root/features.json shared, ps-layer/features.json
// The developer's private ones), the one question the code asks (feature("id"), src/core/features.ts) and Settings, G Squad,
// "From the squad" (views/FromTheSquad.tsx): other people's shared features, each with its own On/Off switch, off by
// default in a person's own build and on by default in the G Squad build. Nothing here changes what V1.57 shows.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const file = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const json = (p: string) => JSON.parse(file(p));

const F = await import("../src/core/features.ts");
const P = await import("../src/core/profile.ts");
const S = await import("../src/core/settingsindex.ts");
const { RED_ONLY } = await import("../src/core/account.ts");

const core = json("core-root/features.json"), layer = json("ps-layer/features.json");
const gsquad = P.cleanProfile(json("core-root/profiles/gsquad.json"))!;
const red = P.cleanProfile({ schema: 1, name: "red", display: "Owner", channel: { kind: "local" }, othersShared: "off", features: {}, rules: { tabOverProtectedApps: false, islandOverProtectedApps: false } })!;
const feat = (o: Partial<import("../src/core/features.ts").Feature>) => F.cleanFeature({ id: "x", name: "X", owner: "jan", scope: "shared", since: "1.58", parts: ["web"], default: "on", ...o })!;

// ---------- the files ----------
ok("core's registry: every entry is valid, ids unique, all shared, made by core or by a contributor's release name", () => {
  assert.equal(core.schema, 1);
  const reg = F.cleanRegistry(core);
  assert.equal(reg.length, core.features.length, "no entry is dropped");
  assert.equal(new Set(reg.map((f) => f.id)).size, reg.length);
  for (const f of reg) { assert.equal(f.scope, "shared"); assert.ok(f.owner === "core" || /^[a-z][a-z0-9]*$/.test(f.owner), f.id); }
});
ok("core's defaults match today's constants, so the bundle is exactly V1.57's", () => {
  const reg = F.cleanRegistry(core);
  assert.equal(reg.find((f) => f.id === "campaigns")?.default === "on", F.CAMPAIGNS_ON);
  assert.equal(reg.find((f) => f.id === "notebook-looks")?.default === "on", F.NOTEBOOK_ON);
});
ok("The developer's layer: every entry valid, private, made by red, on (as in V1.57 on his account), no id shared with core", () => {
  assert.equal(layer.schema, 1);
  const reg = F.cleanRegistry(layer);
  assert.equal(reg.length, layer.features.length);
  const coreIds = new Set(F.cleanRegistry(core).map((f) => f.id));
  for (const f of reg) {
    assert.equal(f.scope, "private", f.id); assert.equal(f.owner, "red", f.id); assert.equal(f.default, "on", f.id);
    assert.ok(!coreIds.has(f.id), f.id); assert.ok(f.gate, `${f.id}: says where its code is switched`);
  }
  assert.equal(new Set(reg.map((f) => f.id)).size, reg.length);
});
ok("The developer's layer lists at least every the developer only feature of core/account.ts", () => {
  assert.ok(F.cleanRegistry(layer).length >= RED_ONLY.length);
});
ok("the merged registry (core then layer) keeps both", () => {
  const reg = F.cleanRegistry([core, layer]);
  assert.equal(reg.length, core.features.length + layer.features.length);
  assert.equal(F.cleanRegistry([...core.features, ...layer.features]).length, reg.length, "a flat list reads the same");
});

// ---------- the reader ----------
ok("bad entries are left out, a repeated id keeps the first, another schema is refused", () => {
  assert.equal(F.cleanFeature({ id: "Bad" }), null);
  assert.equal(F.cleanFeature({ ...feat({}), owner: "core", scope: "private" }), null, "core is always shared");
  assert.equal(F.cleanFeature({ ...feat({}), since: "v1" }), null);
  assert.equal(F.cleanFeature({ ...feat({}), parts: ["tv"] }), null);
  assert.equal(F.cleanFeature({ ...feat({}), parts: [] }), null);
  const reg = F.cleanRegistry([feat({ name: "First" }), feat({ name: "Second" })]);
  assert.deepEqual(reg.map((f) => f.name), ["First"]);
  assert.deepEqual(F.cleanRegistry({ schema: 2, features: [feat({})] }), []);
});
ok("whoFor: the profile when there is one; no profile: the developer owns his features, a friend gets others' shared features at their defaults (V1.62)", () => {
  assert.equal(F.whoFor(gsquad, "red").name, "gsquad");
  assert.deepEqual(F.whoFor(null, "red"), { name: "red", othersShared: "off", overrides: {} });
  assert.deepEqual(F.whoFor(null, "other"), { name: "", othersShared: "on", overrides: {} });
  assert.equal(F.featureOn(feat({ owner: "jan" }), F.whoFor(null, "other"), undefined), true, "no profile, a friend's account: on (V1.62, the developer's release is the build friends run)");
  assert.equal(F.featureOn(feat({ owner: "jan" }), F.whoFor(null, "other"), { x: false }), false, "their own Off wins");
  assert.equal(F.featureOn(feat({ owner: "jan", default: "off" }), F.whoFor(null, "other"), undefined), false, "a feature shipped off stays off");
  assert.deepEqual(F.whoFor(null, null), { name: "", othersShared: "off", overrides: {} });
});
ok("featureOn: core and the person's own features follow their default and the profile", () => {
  const c = feat({ owner: "core", default: "off" });
  assert.equal(F.featureOn(c, F.whoFor(gsquad, "other"), { x: true }), false, "a person's switch never turns on a core feature");
  assert.equal(F.featureOn(c, { name: "gsquad", othersShared: "on", overrides: { x: true } }, undefined), true, "the profile can");
  assert.equal(F.featureOn(feat({ owner: "red", scope: "private" }), F.whoFor(red, "red"), undefined), true);
});
ok("featureOn: someone else's shared feature is on in the G Squad build, off in a person's own build", () => {
  const j = feat({ owner: "jan" });
  assert.equal(F.featureOn(j, F.whoFor(gsquad, "other"), undefined), true);
  assert.equal(F.featureOn(j, F.whoFor(red, "red"), undefined), false);
  assert.equal(F.featureOn(feat({ owner: "jan", default: "off" }), F.whoFor(gsquad, "other"), undefined), false, "its maker can ship it off");
});
ok("featureOn: the person's own switch wins over the build default, both ways", () => {
  const j = feat({ owner: "jan" });
  assert.equal(F.featureOn(j, F.whoFor(red, "red"), { x: true }), true);
  assert.equal(F.featureOn(j, F.whoFor(gsquad, "other"), { x: false }), false);
  assert.equal(F.featureOn(j, { name: "red", othersShared: "off", overrides: { x: true } }, undefined), true, "the profile's own override");
});
ok("featureOn: someone else's PRIVATE feature is never on (its code is not in this build)", () => {
  assert.equal(F.featureOn(feat({ owner: "jan", scope: "private" }), F.whoFor(gsquad, "other"), { x: true }), false);
});
ok("the V1.57 picture: on the developer's account and on a friend's, every registered feature answers as today", () => {
  const reg = F.cleanRegistry([core, layer]);
  for (const account of ["red", "other", null] as const) {
    const who = F.whoFor(null, account);
    for (const f of reg) {
      // The developer's own (private) features on his account. A friend's shared ones (Jan's, V1.60): on a friend's account at their
      // default (V1.62); on the developer's account with no `own` (core) off, his build turns them on through `own`
      // (tests/own-features.test.ts); nobody signed in: off.
      const want = f.owner === "core" ? f.default === "on" : f.owner === "red" ? account === "red" : account === "other" && f.scope === "shared" && f.default === "on";
      assert.equal(F.featureOn(f, who, undefined), want, `${f.id} on ${account}`);
    }
  }
});
ok("squadList: only other people's shared features, newest first, then by name", () => {
  const reg = [feat({ id: "a", name: "Beta", since: "1.58" }), feat({ id: "b", name: "Alpha", since: "1.58" }), feat({ id: "c", name: "Old", since: "1.9" }),
    feat({ id: "d", since: "1.60" }), feat({ id: "e", owner: "core" }), feat({ id: "f", owner: "red" }), feat({ id: "g", scope: "private" })];
  assert.deepEqual(F.squadList(reg, F.whoFor(red, "red")).map((f) => f.id), ["d", "b", "a", "c"]);
  assert.deepEqual(F.squadList(reg, { name: "jan", othersShared: "off", overrides: {} }).map((f) => f.id), ["f"]);
});
ok("squadList: since V1.60 it holds Jan's shared features, and none of the developer's own", () => {
  const reg = F.cleanRegistry([core, layer]);
  const jan = reg.filter((f) => f.owner === "jan").map((f) => f.id).sort();
  assert.ok(jan.length > 0);
  assert.deepEqual(F.squadList(reg, F.whoFor(red, "red")).map((f) => f.id).sort(), jan);
  assert.ok(F.squadList(reg, F.whoFor(gsquad, "other")).every((f) => f.owner !== "red"), "The developer's private ones never show");
});
ok("cleanSwitches: feature ids and true or false only, at most 200", () => {
  assert.deepEqual(F.cleanSwitches({ "a-b": true, B: true, c: "yes", d: false }), { "a-b": true, d: false });
  assert.deepEqual(F.cleanSwitches([true]), {});
  assert.deepEqual(F.cleanSwitches(null), {});
  const many = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`f${i}`, true]));
  assert.equal(Object.keys(F.cleanSwitches(many)).length, 200);
});
ok("feature(id): unknown is off; follows the build file, who is signed in and their switches", () => {
  P.setBuildForTests(null);
  assert.equal(F.feature("campaigns"), false, "no build file: no registry, everything off (the constants still decide)");
  P.setBuildForTests({ profile: json("core-root/profiles/gsquad.json"), features: [core, [feat({ id: "jan-thing" })]] });
  F.setFeatureContext("other", undefined);
  assert.equal(F.feature("jan-thing"), true);
  assert.equal(F.feature("campaigns"), false);
  assert.equal(F.feature("nope"), false);
  F.setFeatureContext("other", { "jan-thing": false });
  assert.equal(F.feature("jan-thing"), false);
  P.setBuildForTests({ features: [[feat({ id: "jan-thing" })]] });
  F.setFeatureContext("red", undefined);
  assert.equal(F.feature("jan-thing"), false, "no profile, the developer's account: off until he switches it on");
  F.setFeatureContext("red", { "jan-thing": true });
  assert.equal(F.feature("jan-thing"), true);
  F.setFeatureContext(null, undefined);
  assert.equal(F.feature("jan-thing"), false, "nobody signed in: off");
  P.setBuildForTests(undefined);
});
ok("featureAnswers: one true or false per registered id (what the Mac and the phone store)", () => {
  const reg = F.cleanRegistry([core, layer]);
  const a = F.featureAnswers(reg, F.whoFor(null, "red"), undefined);
  assert.equal(Object.keys(a).length, reg.length);
  assert.equal(a.campaigns, F.CAMPAIGNS_ON);
  assert.equal(a.gmail, true);
});

// ---------- the words (the developer approves them) ----------
ok("the page's words are plain and the maker line reads right", () => {
  assert.equal(F.ownerWords("red"), "Owner");
  assert.equal(F.ownerWords("gsquad"), "the G Squad");
  assert.equal(F.SQUAD_WORDS.by({ owner: "jan", since: "1.58" }), "Made by Jan, in V1.58");
  for (const w of [F.SQUAD_WORDS.empty, F.SQUAD_WORDS.startsOff, F.SQUAD_WORDS.startsOn]) assert.ok(/^[A-Z][^"]*\.$/.test(w), w);
});

// ---------- Settings: the row, the control, saving ----------
ok("Settings has the row \"From the squad\" in G Squad, shown on every account and every device (public too)", () => {
  const e = S.settingById("squad-features")!;
  assert.ok(e);
  assert.equal(e.group, "gsquad");
  assert.equal(e.name, "From the squad");
  assert.equal(e.line, "Features your friends made and shared. Switch each one on or off.");
  assert.ok(!e.red, "not the developer only");
  for (const ctx of [{ red: true, where: "mac" }, { red: false, where: "mac" }, { red: false, where: "web" }, { red: false, where: "phone", shell: "gos" }] as const) {
    assert.ok(S.visibleTo(e, ctx), JSON.stringify(ctx));
  }
  assert.equal(S.searchSettings("from the squad", { red: false, where: "mac" })[0]?.e.id, "squad-features");
});
ok("the row's control is the picker, inside Settings (so Esc closes it with Settings)", () => {
  const g = file("src/views/SettingsGroups.tsx");
  assert.ok(g.includes(`import { FromTheSquad } from "./FromTheSquad";`));
  assert.ok(/"squad-features": block\(\(\) => <FromTheSquad \/>\)/.test(g));
});
ok("the picker saves the person's switch with their settings, and the Mac keeps it (cleanLooks)", () => {
  const v = file("src/views/FromTheSquad.tsx");
  assert.ok(v.includes("taskMapActions.looks({ squadFeatures: { ...mine, [id]: on } })"));
  assert.ok(v.includes("SQUAD_WORDS.empty") && v.includes("SQUAD_WORDS.by(f)"));
  const ps = file("src/ps.ts");
  assert.ok(ps.includes("o.squadFeatures = cleanSwitches(p.squadFeatures)"));
  assert.ok(ps.includes("startFeatureSync(psPost)"));
  const sync = file("src/featuresync.ts");
  assert.ok(sync.includes(`post({ type: "features", on })`));
});
ok("no em or en dashes in the new files", () => {
  const bad = (s: string) => [...s].some((c) => c === String.fromCharCode(8211) || c === String.fromCharCode(8212));
  for (const p of ["src/core/features.ts", "src/featuresync.ts", "src/views/FromTheSquad.tsx", "src/views/fromthesquad.css", "core-root/features.json", "ps-layer/features.json", "tests/features.test.ts"]) {
    assert.ok(!bad(file(p)), p);
  }
});
console.log(`${n} ok`);
