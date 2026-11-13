// Run: node --experimental-strip-types tests/offswitches.test.ts
// Open source build: every public feature has an off switch the person can reach in the public build (not only the developer's
// account). This checks the pure rules (core/offswitches.ts, core/squadauto.ts) and that each switch is wired where the
// feature runs. Defaults keep today's behaviour: missing means on.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const O = await import("../src/core/offswitches.ts");
const Q = await import("../src/core/squadauto.ts");
const I = await import("../src/core/settingsindex.ts");
const rd = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const RED_MAC = { red: true, where: "mac" as const }, FRIEND_MAC = { red: false, where: "mac" as const }, FRIEND_WEB = { red: false, where: "web" as const };
const FRIEND_GOS = { red: false, where: "phone" as const, shell: "gos" as const };
const visible = (id: string, ctx: Parameters<typeof I.searchSettings>[1]) => I.searchSettings(I.settingById(id)!.name, ctx).some((h) => h.e.id === id);

ok("on unless switched off: missing, true and odd values are on, only false is off", () => {
  for (const f of [O.onUnlessOff, O.squadAutoOn, O.presenceOn, O.tipsOn, O.phoneScreenTimeOn]) {
    assert.equal(f(undefined), true); assert.equal(f(true), true); assert.equal(f(null), true); assert.equal(f("false"), true); assert.equal(f(0), true);
    assert.equal(f(false), false);
  }
});

ok("G Squad: Off never starts a join and shows its own step", () => {
  assert.equal(Q.shouldJoin(false, null), true, "default: joins as before");
  assert.equal(Q.shouldJoin(false, null, true), true);
  assert.equal(Q.shouldJoin(false, null, false), false);
  assert.equal(Q.shouldJoin(false, { v: 1 }, false), false);
  assert.equal(Q.shouldJoin(true, null, true), false);
  assert.equal(Q.autoStage(null, null), "joining");
  assert.equal(Q.autoStage(null, null, false), "off");
  assert.equal(Q.autoStage(null, "error", false), "off");
  assert.equal(Q.autoStage({ v: 1, left: true }, null, false), "left", "leaving on purpose still says so");
  assert.equal(Q.autoStage({ v: 1, removed: true }, null, false), "removed");
});
ok("G Squad: the engine checks the switch before joining and before the 3 minute wait; Join turns it back on", () => {
  const e = rd("../src/squad/autoengine.ts");
  assert.match(e, /function autoOn\(\) \{ return squadAutoOn\(settingsData\(vaultStore\.get\(\)\)\.squadAutoJoin\); \}/);
  const notIn = e.slice(e.indexOf("async function notIn"), e.indexOf("function restart"));
  assert.ok(notIn.indexOf("if (!autoOn())") > -1 && notIn.indexOf("if (!autoOn())") < notIn.indexOf("newPending("), "checked before any join");
  const restart = e.slice(e.indexOf("function restart"), e.indexOf("// ---------- what the engine tells"));
  assert.ok(restart.indexOf("if (!autoOn()) return;") > -1 && restart.indexOf("if (!autoOn()) return;") < restart.indexOf("setInterval"), "no 3 minute wait while off");
  assert.match(e, /if \(!autoOn\(\)\) await saveSettings\(\{ squadAutoJoin: true \}\)/);
  assert.match(e, /autoStage\(join\.rec, problem\?\.kind \?\? null, autoOn\(\)\)/);
  const v = rd("../src/views/GSquad.tsx");
  assert.ok(/stage === "off" &&/.test(v) && />Join<\/button>/.test(v), "the G Squad screen has a Join button while off");
});

ok("Presence: the private channel is joined only while the switch is on", () => {
  const ps = rd("../src/ps.ts");
  const start = ps.slice(ps.indexOf("export function startPsPresence"), ps.indexOf("// ---------- PS settings"));
  assert.match(start, /const want = [^;]*&& presenceOn\(settingsData\(s\)\.psPresence\);/);
  assert.match(start, /if \(chan && \(!want \|\| topic !== chanTopic\)\) leavePresence\(\);/, "switching off leaves at once");
});

ok("Tips: none while off; Show tips again turns them back on", () => {
  const t = rd("../src/views/Tips.tsx");
  assert.match(t, /if \(!tipsOn\(st\.tipsShow\)\) return;/);
  assert.match(t, /hidesShowing\(block\) \|\| \(st && !tipsOn\(st\.tipsShow\)\)/, "a tip showing goes when switched off");
  assert.match(t, /tipsSeen: resetTips\(Date\.now\(\)\), tipsShow: true/);
});

ok("Phone screen time: the page saves nothing and asks for nothing while off; the shell reads no usage", () => {
  const b = rd("../src/gos/bridge.ts");
  const fn = b.slice(b.indexOf("function screenTime("), b.indexOf("function onMessage("));
  assert.ok(fn.indexOf("phoneScreenTimeOn(state.prefs?.screenTime)") > -1 && fn.indexOf("phoneScreenTimeOn") < fn.indexOf("setPhoneLine"), "checked first");
  assert.match(b, /s\.role === "owner" && phoneScreenTimeOn\(state\.prefs\?\.screenTime\)\) gosPost\(\{ type: "screentime:get" \}\)/);
  assert.match(b, /screenTime\?: boolean;/);
  assert.match(rd("../src/gos/PhoneRows.tsx"), /"phone-screen-time": function ScreenTimeRow[\s\S]*?p\?\.screenTime !== false[\s\S]*?setP\(\{ screenTime: v \}\)/);
});

ok("Dynamic Island: Settings has Off, the same settings.island.mode as the island settings window", () => {
  // V1.58: one shared component (views/IslandSettings.tsx) in Settings > Dynamic Island, the window and Mac settings.
  const p = rd("../src/views/IslandSettings.tsx");
  assert.match(p, /\{ id: "off", label: "Off", hint: "No island" \}/);
  assert.match(p, /save\(\{ mode: m\.id \}\)/);
  assert.match(rd("../src/views/PsSettings.tsx"), /<IslandSettingsPage prefs=\{prefs\} save=\{\(p\) => save\(\{ island: \{ \.\.\.prefs, \.\.\.p \} \}\)\} \/>/);
});

ok("Claude Code hook: tools start Off and say what On does", () => {
  assert.match(rd("../src/views/AiDone.tsx"), /"Off\. On adds one line to its settings and keeps a backup of the file\."/);
});

ok("Restart helper reminder: a switch in Security next to Auto reboot, for every account", () => {
  const s = rd("../src/views/Security.tsx");
  assert.match(s, /<RebootCard title="Auto reboot on this Mac" \/>\s*<HelperRemindRow \/>/);
  assert.match(s, /psPost\(\{ type: "psSettings:helperRemind", on: v \}\)/);
  assert.match(s, /st\.helperRemind !== false/);
});

ok("the synced switches survive the save path (ps.ts cleanLooks keeps them)", () => {
  const ps = rd("../src/ps.ts");
  for (const k of ["squadAutoJoin", "psPresence", "tipsShow"]) assert.ok(new RegExp(`if \\(typeof p\\.${k} === "boolean"\\) o\\.${k} = p\\.${k};`).test(ps), k);
  assert.match(ps, /o\.updateEvery = cleanUpdateEvery\(p\.updateEvery\)/);
  const g = rd("../src/views/SettingsGroups.tsx");
  assert.match(g, /"gs-auto-join": function GsAutoJoin[^\n]*field="squadAutoJoin"/);
  assert.match(g, /"ps-presence": function PsPresence[^\n]*field="psPresence"/);
  assert.match(g, /"tips-show": function TipsShow[^\n]*field="tipsShow"/);
});

ok("every new row is in Settings for everyone it applies to (never the developer only)", () => {
  const rows: [string, string, string][] = [
    ["gs-auto-join", "gsquad", "Join The G Squad automatically"], ["ps-presence", "privacy", "Tell the website PS app is open"],
    ["tips-show", "about", "Show first use tips"], ["phone-screen-time", "time", "Track my screen time"],
    ["helper-remind", "privacy", "Remind me to set up the restart helper"],
  ];
  for (const [id, group, name] of rows) {
    const e = I.settingById(id)!;
    assert.ok(e, id); assert.equal(e.group, group, id); assert.equal(e.name, name, id); assert.ok(!e.red, `${id} is not the developer only`);
  }
  assert.match(I.settingById("ps-presence")!.line, /Lets the website know PS app is open on this Mac/);
  for (const ctx of [RED_MAC, FRIEND_MAC]) for (const id of ["gs-auto-join", "ps-presence", "tips-show", "helper-remind", "island", "update-every"]) assert.ok(visible(id, ctx), `${id} on a Mac`);
  for (const id of ["gs-auto-join", "ps-presence", "tips-show", "update-every"]) assert.ok(visible(id, FRIEND_WEB), `${id} on the website`);
  for (const id of ["gs-auto-join", "tips-show", "phone-screen-time", "update-every"]) assert.ok(visible(id, FRIEND_GOS), `${id} on the phone`);
  assert.equal(I.settingById("helper-remind")!.parent, "security");
});
console.log(`\noffswitches: ${n} checks passed`);
