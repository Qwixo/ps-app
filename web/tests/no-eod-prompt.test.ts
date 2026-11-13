// Run: node --experimental-strip-types tests/no-eod-prompt.test.ts
// "Shall I end my day now?" is gone for good (the developer, 2 Nov 2026: "Remove it completely"). PS must never ask him to
// end his day, on the Mac, the phone or the website; ending it by hand (the moon button, Reset) stays.
// The prompt had no single switch to test: it was a timer and a card in PS's main page (eodask.ts), a strip in
// the Tab list that the phone shows too and a card on the website (views/EodAsk.tsx), its rules (core/eod.ts)
// and settings rows. So this reads every source file (comments taken out) and fails if any piece comes back.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../src/", import.meta.url).pathname;
let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}
/** The code only: line comments, block comments and JSX comments out, so a note saying it was removed is fine. */
const code = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const src = files(root).map((p) => ({ p: p.slice(root.length), s: code(readFileSync(p, "utf8")) }));
const hits = (re: RegExp) => src.filter((f) => re.test(f.s)).map((f) => f.p);

ok("the prompt's files are gone", () => {
  for (const f of ["eodask.ts", "views/EodAsk.tsx", "views/eod.css", "core/eod.ts"]) assert.equal(existsSync(join(root, f)), false, f);
});
ok("nothing imports them", () => {
  assert.deepEqual(hits(/from\s+["'][./]*(eodask|views\/EodAsk|core\/eod|\.\/EodAsk|\.\/eod)["']/), []);
});
ok("no card with the end of day id is ever shown (Mac card stack, phone notification)", () => {
  assert.deepEqual(hits(/id:\s*["']eod(-done)?["']/), []);
  assert.deepEqual(hits(/startEodAsk|eodMessage|EodStrip|EodCard|EodSettings/), []);
});
ok("no screen asks the question", () => {
  assert.deepEqual(hits(/end (my|your) day now/i), []);
  assert.deepEqual(hits(/day\} is still open/), []);   // the prompt's "Friday is still open" line
});
ok("old settings that still carry the prompt's fields are never read", () => {
  assert.deepEqual(hits(/\beod(Ask|At|SnoozeMin|SnoozedUntil)\b/), []);
});
ok("no timer can bring it back: nothing schedules an end of day check", () => {
  assert.deepEqual(hits(/eodState|eodPrefs|eodSummary|lastAskMoment|eodTarget|EOD_AT_DEFAULT|EOD_SNOOZE_DEFAULT/), []);
});
ok("ending the day by hand is still there (the moon button in the Tab list)", () => {
  const tm = src.find((f) => f.p === "views/TaskMap.tsx")!.s;
  assert.ok(/aria-label="End your day \(reset the list\)"/.test(tm));
  assert.ok(/function endDayNow\(/.test(tm));
});

console.log(`\n${n} checks passed: PS never prompts to end the day`);
