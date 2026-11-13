// Run: node --experimental-strip-types tests/screentime-public.test.ts
// Screen time on a friend's PS (public PS, 7 Nov 2026). The friend's Tab list showed "under 1m", 0m and an empty week
// while AFK counted 12 hours: screen time was off on that Mac, because PS kept it off until someone switched it on
// (ps-mac ScreenTime.swift read a UserDefaults bool that is false when never set), and the pop-up never said so.
// Fix: never chosen, it is on for everyone but the developer (his Macs keep his own choice); when it is off the pop-up says so
// with a Turn on button and the top bar button reads Off. This checks the pop-up's words and, from the ps-mac source
// (PS_MAC_DIR, default the gsquad-screentime-public worktree, then ~/Projects/ps/mac), the native default.
// The native self test is PS_SELFTEST_ONLY=screentime with PS_SELFTEST_RED=0 and =1 (ps-mac ScreenTimeSelfTest.swift).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { macStChip, macStEmptyText, macStOff, macStOffText } from "../src/core/screentime.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const fmt = (s: number) => `${Math.round(s / 60)}m`;
const dashes = /[\u2013\u2014]/;

ok("a friend's PS with screen time off: the pop-up says off and the button reads Off", () => {
  assert.equal(macStOff(true, false), true);
  assert.equal(macStChip(0, true, fmt), "Off");
  assert.match(macStOffText("PS"), /^Screen time is off on this Mac/);
  assert.match(macStOffText("Focus"), /Turn it on and Focus shows your apps/);   // a renamed app keeps its own name
});

ok("on, or not known: never the off note", () => {
  assert.equal(macStOff(true, true), false);
  assert.equal(macStOff(true, undefined), false);   // a PS too old to say, or not answered yet
  assert.equal(macStOff(false, false), false);      // the website and the phone never say the Mac is off
  assert.equal(macStChip(0, false, fmt), "0m");
  assert.equal(macStChip(600, true, fmt), "10m");    // something counted today always shows its total
});

ok("the empty day tells the friend what to do", () => {
  assert.match(macStEmptyText(true, "PS"), /^Screen time is on\. PS adds your apps here a few minutes after you use them\.$/);
  assert.match(macStEmptyText(undefined, "PS"), /Check screen time is on in PS: Settings, Mac settings, Screen time\.$/);
});

ok("no em or en dashes in the new words", () => {
  for (const t of [macStOffText("PS"), macStEmptyText(true, "PS"), macStEmptyText(undefined, "PS"), macStEmptyText(false, "PS")]) assert.doesNotMatch(t, dashes, t);
});

const macDir = process.env.PS_MAC_DIR
  || [join(homedir(), "Projects/.worktrees/gsquad-screentime-public"), join(homedir(), "Projects/ps/mac")].find((d) => existsSync(join(d, "Sources/ScreenTimeSelfTest.swift")));
if (!macDir || !existsSync(join(macDir, "Sources/ScreenTime.swift"))) {
  console.log("note - ps-mac with the screen time fix not found here (PS_MAC_DIR): the native checks were skipped");
} else {
  const src = readFileSync(join(macDir, "Sources/ScreenTime.swift"), "utf8");
  const main = readFileSync(join(macDir, "Sources/main.swift"), "utf8");
  ok("native: never chosen, on for everyone but the developer (PS_SELFTEST_RED=0 on, =1 off)", () => {
    assert.match(src, /static func enabledDefault\(red: Bool\) -> Bool \{ !red \}/);
    assert.match(src, /get \{ choice \?\? ScreenTime\.enabledDefault\(red: Owner\.red\) \}/);
    assert.doesNotMatch(src, /UserDefaults\.standard\.bool\(forKey: "screenTime\.enabled"\)/);   // the old "false when never set"
  });
  ok("native: a test copy never reads or writes the developer's real screen time", () => {
    assert.match(src, /UserDefaults\(suiteName: "com\.cincee\.ps\.st-selftest"\)/);
    assert.match(src, /testDir\.map \{ URL\(fileURLWithPath: \$0/);
    assert.equal((src.match(/UserDefaults\.standard/g) || []).length, 0, "every read and write goes through ScreenTime.store");
  });
  ok("native: the pop-up's Turn on reaches PS from the Tab list, and the self test area exists", () => {
    assert.match(main, /case "psSettings:screenTime" where fromMain \|\| fromOverlay:/);
    assert.match(main, /PS_SELFTEST_ONLY"\] == "screentime"/);
  });
}
console.log(`${n} passed`);
