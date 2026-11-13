// Run: node --experimental-strip-types tests/openkeys.test.ts
// Tab overlay shortcuts (V1.47, core/openkeys.ts): the old settings as the list, the recorder (hold, combo, chord, by
// key code on any layout), clashes and system shortcuts, what works over 1Password and Signal, and the Settings
// wiring (its own tab, Mac only, at least one shortcut, Reset to Tab). The Mac's half is ps-mac tests/openkeys-test.swift.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as K from "../src/core/openkeys.ts";
import { SETTINGS, GROUPS, groupsFor, rowsOf, searchSettings, visibleTo } from "../src/core/settingsindex.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const read = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
type S = K.OpenShortcut;
const P = 35, O = 31, F13 = 105;
const none = { cmd: false, ctrl: false, opt: false, shift: false };
const down = (code: number, mods = none, repeat = false): K.RecKey => ({ type: "down", code, mods, repeat });
const up = (code: number, mods = none): K.RecKey => ({ type: "up", code, mods });
function record(kind: K.OpenKind, keys: K.RecKey[]): { done?: S; hints: string[] } {
  let st: K.RecState = { kind };
  const hints: string[] = [];
  for (const k of keys) {
    const r = K.recStep(st, k);
    if (r.hint) hints.push(r.hint);
    if (r.done) return { done: r.done, hints };
    st = r.st;
  }
  return { hints };
}

ok("existing users: the old settings are the list, exactly", () => {
  assert.deepEqual(K.legacyList("tab", true), [{ kind: "hold", key: 48 }, { kind: "chord", key: 47, first: 44 }]);
  assert.deepEqual(K.legacyList("rightOption", false), [{ kind: "hold", key: 61 }]);
  assert.deepEqual(K.legacyList(undefined, undefined), K.DEFAULT_LIST);   // before the Mac answers: the defaults
  assert.ok(K.canSave(K.legacyList("rightOption", true)));
});

ok("record a hold: any key, or a modifier on its own", () => {
  assert.deepEqual(record("hold", [down(48)]).done, { kind: "hold", key: 48 });
  assert.deepEqual(record("hold", [down(P)]).done, { kind: "hold", key: P });
  assert.deepEqual(record("hold", [down(61), up(61)]).done, { kind: "hold", key: 61 });   // Right Option alone
  const withMod = record("hold", [down(55), down(P, { ...none, cmd: true })]);
  assert.equal(withMod.done, undefined);
  assert.match(withMod.hints[0], /Tap a key combo/);
});
ok("record a combo: the modifiers held with the key, in one order", () => {
  assert.deepEqual(record("combo", [down(59), down(58), down(49, { ...none, ctrl: true, opt: true })]).done, { kind: "combo", key: 49, mods: ["ctrl", "opt"] });
  assert.deepEqual(record("combo", [down(F13)]).done, { kind: "combo", key: F13, mods: [] });
});
ok("record a chord: hold one key, press another; letting go first starts again", () => {
  assert.deepEqual(record("chord", [down(P), down(P, none, true), down(O)]).done, { kind: "chord", first: P, key: O });
  const early = record("chord", [down(P), up(P)]);
  assert.equal(early.done, undefined);
  assert.match(early.hints[0], /Keep holding/);
  assert.deepEqual(record("chord", [down(P), up(P), down(44), down(47)]).done, { kind: "chord", first: 44, key: 47 });
});
ok("keys are kept by where they sit, never by the character (any language)", () => {
  // A Russian or AZERTY Mac sends the same KeyboardEvent.code for the same physical key.
  assert.equal(K.macKeyCode("KeyP"), 35);
  assert.equal(K.macKeyCode("KeyO"), 31);
  assert.equal(K.macKeyCode("Slash"), 44);
  assert.equal(K.macKeyCode("AltRight"), 61);
  assert.equal(K.macKeyCode("F13"), 105);
  assert.equal(K.macKeyCode("Tab"), 48);
  assert.equal(K.macKeyCode("Nonsense"), undefined);
  const ru = { "35": "З", "31": "Щ" };
  assert.equal(K.describe({ kind: "chord", first: P, key: O }, ru), "Hold З, then press Щ");
  assert.equal(K.describe({ kind: "chord", first: P, key: O }), "Hold P, then press O");      // before the Mac answers
  assert.equal(K.describe({ kind: "hold", key: 48 }, ru), "Hold Tab");
  assert.equal(K.describe({ kind: "combo", key: 49, mods: ["opt", "ctrl"] }), "Press Control Option Space");
});
ok("clashes and refusals: same list rules as the Mac", () => {
  assert.ok(!K.canSave([]));
  assert.ok(!K.canSave([{ kind: "hold", key: 48 }, { kind: "hold", key: 48 }]));
  assert.ok(!K.canSave([{ kind: "hold", key: P }, { kind: "chord", first: P, key: O }]));
  assert.ok(K.canSave([{ kind: "chord", first: P, key: O }, { kind: "chord", first: P, key: 0 }]));
  assert.ok(!K.canSave([{ kind: "combo", key: 49, mods: ["ctrl", "opt"] }, { kind: "combo", key: 49, mods: ["opt", "ctrl"] }]));
  for (const bad of [{ kind: "hold", key: 53 }, { kind: "hold", key: 51 }, { kind: "hold", key: 126 }, { kind: "combo", key: P, mods: ["shift"] },
    { kind: "combo", key: P, mods: [] }, { kind: "chord", first: P, key: P }, { kind: "chord", first: 55, key: P }, { kind: "hold", key: 57 }] as S[])
    assert.ok(K.refusal(bad), JSON.stringify(bad));
  assert.equal(K.refusal({ kind: "combo", key: F13, mods: [] }), null);
});
ok("system shortcuts and slow keys are flagged but allowed", () => {
  assert.match(K.systemClash({ kind: "combo", key: 49, mods: ["cmd"] })!, /Spotlight/);
  assert.match(K.systemClash({ kind: "combo", key: 8, mods: ["cmd"] })!, /Copy/);
  assert.equal(K.systemClash({ kind: "combo", key: F13, mods: ["ctrl"] }), null);
  const w = K.problems([{ kind: "hold", key: P }]);
  assert.equal(w.length, 1);
  assert.equal(w[0].error, false);
  assert.match(w[0].text, /slows typing/);
  assert.match(w[0].text, /Right Option/);
  assert.equal(K.problems([{ kind: "hold", key: 48 }]).length, 0);
  assert.equal(K.problems([{ kind: "hold", key: 55 }])[0].error, false);   // Left Command: a warning
});
ok("over 1Password and Signal only what macOS matches itself, never a key that types", () => {
  assert.ok(K.worksOverProtected({ kind: "hold", key: 48 }));
  assert.ok(K.worksOverProtected({ kind: "hold", key: F13 }));
  assert.ok(K.worksOverProtected({ kind: "combo", key: 49, mods: ["ctrl", "opt"] }));
  assert.ok(!K.worksOverProtected({ kind: "hold", key: P }));
  assert.ok(!K.worksOverProtected({ kind: "hold", key: 61 }));
  assert.ok(!K.worksOverProtected({ kind: "chord", first: 44, key: 47 }));
});
ok("editing the list: add, change, remove, tidy", () => {
  const l: S[] = [{ kind: "hold", key: 48 }];
  assert.deepEqual(K.edit(l, -1, { kind: "hold", key: 61 }), [{ kind: "hold", key: 48 }, { kind: "hold", key: 61 }]);
  assert.deepEqual(K.edit(l, 0, { kind: "hold", key: 61 }), [{ kind: "hold", key: 61 }]);
  assert.deepEqual(K.edit([...l, { kind: "hold", key: 61 }], 0, null), [{ kind: "hold", key: 61 }]);
  assert.deepEqual(K.tidy({ kind: "combo", key: 49, mods: ["cmd", "ctrl"], first: 3 }), { kind: "combo", key: 49, mods: ["ctrl", "cmd"] });
  assert.deepEqual(K.tidy({ kind: "hold", key: 48, mods: ["cmd"] }), { kind: "hold", key: 48 });
});

// ---------- the Settings wiring ----------
const MAC = { red: false, where: "mac" as const }, WEB = { red: false, where: "web" as const }, PHONE = { red: false, where: "phone" as const };
ok("a Settings tab called Tab overlay shortcuts, on the Mac only", () => {
  const g = GROUPS.find((x) => x.id === "shortcuts")!;
  assert.equal(g.label, "Tab overlay shortcuts");
  assert.ok(groupsFor(MAC).some((x) => x.id === "shortcuts"));
  assert.ok(!groupsFor(WEB).some((x) => x.id === "shortcuts") && !groupsFor(PHONE).some((x) => x.id === "shortcuts"));
  assert.deepEqual(rowsOf("shortcuts", MAC).main.map((e) => e.id), ["trigger-key"]);
  assert.equal(searchSettings("shortcut", MAC)[0]?.e.id, "trigger-key");
  assert.ok(searchSettings("chord", MAC).some((h) => h.e.id === "trigger-key" || h.e.id === "slash"));
  assert.ok(!visibleTo(SETTINGS.find((e) => e.id === "trigger-key")!, WEB));
});
ok("the tab: Record shortcut, Remove keeps one, Reset to Tab, the 1Password and Signal rule said", () => {
  const v = read("views/OpenShortcuts.tsx");
  assert.match(v, /Record shortcut/);
  assert.match(v, /disabled=\{!ready \|\| !!rec \|\| list\.length <= 1\}/);
  assert.match(v, />Reset to Tab</);
  assert.match(v, /type: "shortcuts:reset"/);
  assert.match(v, /type: "shortcuts:set"/);
  assert.match(v, /Over 1Password and Signal/);
  assert.match(v, /Open list on the/);
  assert.ok(!/[\u2013\u2014]/.test(v + read("core/openkeys.ts")), "no em or en dashes");
  assert.match(read("views/SettingsGroups.tsx"), /"trigger-key": function Trigger\(\{ e \}\) \{ return <SetRow e=\{e\} body=\{<OpenShortcuts \/>\} open \/>; \}/);
});

console.log(`${n} ok`);
