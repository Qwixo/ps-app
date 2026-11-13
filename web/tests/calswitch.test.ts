// Run: node --experimental-strip-types tests/calswitch.test.ts
// Meetings from your Calendar (G Squad, the developer's rule: every feature that runs for friends has its own switch, and macOS
// is asked only when it is wanted). Off: never read, never asked. On: macOS is asked only from the switch (or the
// refresh icon) while on. Never chosen (an account from before): read only if macOS already allows it, never ask.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CAL_OFF_SNAP, CAL_WORDS, calMayAsk, calMode, localLine } from "../src/core/localcal.ts";

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

ok("the three positions", () => {
  assert.equal(calMode(true), "on"); assert.equal(calMode(false), "off"); assert.equal(calMode(undefined), "quiet"); assert.equal(calMode("yes"), "quiet");
});
ok("macOS is asked only by a click while the switch is on", () => {
  assert.equal(calMayAsk("on", true), true);
  assert.equal(calMayAsk("on", false), false);       // the list opening, a wake, the 2 minute timer
  assert.equal(calMayAsk("quiet", true), false);     // never chosen: never asks, even on the refresh icon
  assert.equal(calMayAsk("off", true), false);
});
ok("off: the Meetings line says so and offers Turn on", () => {
  const l = localLine({ connected: null, checkedAt: null, error: null, busy: false }, null, Date.now(), "off");
  assert.equal(l.text, CAL_WORDS.off); assert.equal(l.turnOn, true); assert.equal(l.settings, false);
});
ok("off: an empty copy replaces the old meetings", () => {
  const s = CAL_OFF_SNAP("2026-11-07T12:00:00.000Z");
  assert.deepEqual(s.events, []); assert.equal(s.account, "mac");
});
ok("holding Tab never asks macOS any more; the reader passes the switch's answer", () => {
  assert.match(src("ps.ts"), /m\.type === "sync"\) \{ void sync\(\); void refreshGmail\(\); calRefreshIfStale\(\); \}/);
  assert.match(src("calrefresh.ts"), /localReader!\(calMayAsk\(localMode\(\), ask\)\)/);
  assert.match(src("calrefresh.ts"), /localMode\(\) !== "off"/);
});
ok("switching off stops the Mac watching, keeps nothing read, and saves an empty copy", () => {
  const ps = src("ps.ts");
  assert.match(ps, /patch\.calendarOn === true\) void saveSettings\(\{ macCalendar: true \}\)\.then\(\(\) => calRefreshNow\(true, true\)\)/);
  assert.match(ps, /psPost\(\{ type: "localCal", op: "off" \}\)/);
  assert.match(ps, /!st\.red && settingsData\(st\)\.macCalendar !== false\)/);
});
ok("the switch is in Settings, Notifications and is never the developer only (V1.43: its own row, everyone but the developer on a Mac)", () => {
  assert.match(src("views/SettingsGroups.tsx"), /"calendar": row\(\(\) => <CalSwitch \/>\)/);
  assert.doesNotMatch(src("views/SettingsGroups.tsx"), /red\s*&&\s*<CalSwitch/);
  assert.match(src("core/settingsindex.ts"), /id: "calendar", [^\n]*on: MAC, notRed: true/);
});
ok("no long dashes in the words", () => { for (const t of Object.values(CAL_WORDS)) assert.doesNotMatch(t, /[–—]/); });
const mac = join(process.env.PS_MAC_DIR || join(homedir(), "Projects", "ps-mac"), "Sources", "LocalCalendar.swift");
const sw = existsSync(mac) ? readFileSync(mac, "utf8") : "";
if (sw.includes('op == "off"')) {
  ok("the Mac stops watching the Calendar app when switched off, and asks only on ask:true", () => {
    assert.match(sw, /if op == "off" \{ unwatch\(\); return \}/);
    assert.match(sw, /read\(ask: msg\["ask"\] as\? Bool == true\)/);
    assert.match(sw, /self\?\.read\(ask: false\)/);   // a Calendar app change never asks
  });
} else console.log(`skip - ${mac} has no "off" yet (ps-mac branch gsquad-welcome not merged); set PS_MAC_DIR to check it`);

console.log(`\n${n} passed`);
