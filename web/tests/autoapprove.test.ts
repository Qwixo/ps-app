// Run: node --experimental-strip-types tests/autoapprove.test.ts
// Auto approve's words and the Mac's state as the page reads it (src/core/autoapprove.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APPROVE_LINE, APPROVE_ROWS, approveLogLine, approveNow, approveTime, cleanApprove } from "../src/core/autoapprove.ts";
import { SETTINGS as ENTRIES } from "../src/core/settingsindex.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };

ok("the settings line is one plain sentence that says the risk", () => {
  assert.equal(APPROVE_LINE.split(". ").length, 1);
  assert.match(APPROVE_LINE, /nothing stops/);
  assert.match(APPROVE_LINE, /web page or file/);
});
ok("three switches: AI mode, Sleep mode and Always", () => {
  assert.deepEqual(APPROVE_ROWS.map((r) => r.key), ["ai", "sleep", "always"]);
});
ok("an older PS app (no state) shows Checking, never a switch that does nothing", () => {
  assert.equal(cleanApprove(undefined), undefined);
  assert.equal(approveNow(undefined), "Checking this Mac…");
});
ok("every switch starts off: odd values are off", () => {
  const s = cleanApprove({ ai: "yes", sleep: 1, always: null })!;
  assert.deepEqual([s.ai, s.sleep, s.always, s.on], [false, false, false, false]);
  assert.match(approveNow(s), /Every switch is off/);
});
ok("on, and why", () => {
  assert.equal(approveNow(cleanApprove({ ai: true, on: true, why: "AI mode" })), "Now: on (AI mode).");
  assert.match(approveNow(cleanApprove({ sleep: true, on: false })), /turns on by itself/);
});
ok("the log is checked line by line and kept to 30", () => {
  const log = Array.from({ length: 40 }, (_, i) => ({ at: 1_800_000_000 + i, app: "Claude Code", how: "hook", what: "Bash: npm test", where: "shop" }));
  const s = cleanApprove({ log: [...log, null, 5, { at: "x", how: "nope", what: 7 }] })!;
  assert.equal(s.log!.length, 30);
  assert.equal(approveLogLine(s.log![0]), "Claude Code in shop: Bash: npm test");
});
ok("log lines read plainly", () => {
  assert.equal(approveLogLine({ at: 0, app: "iTerm2", how: "key", what: "npm test" }), "iTerm2: npm test (Return pressed)");
  assert.equal(approveLogLine({ at: 0, app: "Terminal", how: "waiting", what: "Waiting: npm test." }), "Terminal: Waiting: npm test.");
});
ok("times: HH:MM today, with the day otherwise", () => {
  const now = new Date(2026, 10, 12, 15, 0).getTime();
  assert.equal(approveTime(new Date(2026, 10, 12, 9, 5).getTime() / 1000, now), "09:05");
  assert.match(approveTime(new Date(2026, 10, 10, 9, 5).getTime() / 1000, now), /^10 Nov 09:05$/);
});
ok("Settings has it in Sentry mode, on a Mac, for everyone (not the developer only)", () => {
  const e = ENTRIES.find((x) => x.id === "auto-approve")!;
  assert.equal(e.group, "sentry");
  assert.deepEqual(e.on, ["mac"]);
  assert.equal(e.red, undefined);
  assert.equal(e.line, APPROVE_LINE);
});
ok("the view sends only the three keys and Clear, and never shows a switch as the developer only", () => {
  const v = readFileSync(new URL("../src/views/AutoApprove.tsx", import.meta.url), "utf8");
  assert.match(v, /type: "autoApprove:set", key, on/);
  assert.match(v, /type: "autoApprove:clearLog"/);
  assert.doesNotMatch(v, /\bred\b|isRedAccount|dangerouslySetInnerHTML/);
});
ok("no em or en dashes in Auto approve's words", () => {
  for (const f of ["../src/core/autoapprove.ts", "../src/views/AutoApprove.tsx", "../src/views/autoapprove.css"]) {
    assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), "utf8"), /[\u2013\u2014]/, f);
  }
});
console.log(`${n} passed`);
