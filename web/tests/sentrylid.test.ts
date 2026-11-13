// V1.54 (the developer, 12 Nov 2026; lid-notice-154): the lid row of the pop up before engaging, and no lid text on the Sentry
// screen. Run: node --experimental-strip-types tests/sentrylid.test.ts (ps-mac next to this checkout, or PS_MAC_DIR).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { LID_WARN, LID_CHECK_WAIT_MS, SLEEP_SENTRY_WORDS, RESTART_WARN, lidLine, lidNote, noteFor, okLidGap, preEngage, preEngageLines, preEngageSetUp, preEngageTitle, restartCheck, restartWarnLines } from "../src/core/sentry.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };

const fine = restartCheck({ helper: "on", fileVault: "on" }, 8);
const off = restartCheck({ helper: "off", fileVault: "on" }, 8)!;

ok("when the lid row shows: lid on and a gap; never with the lid off or when it works", () => {
  assert.equal(fine, null);
  assert.equal(preEngage(fine, true, null), null, "it works and the restart is fine: engage at once");
  assert.equal(preEngage(fine, false, "helper"), null, "lid off: no lid row");
  assert.deepEqual(preEngage(fine, true, "helper"), { restart: null, lid: "helper" });
  assert.deepEqual(preEngage(off, true, "refused"), { restart: off, lid: "refused" });
  assert.deepEqual(preEngage(off, false, "refused"), { restart: off, lid: null });
});
ok("the lid only pop up: its own title, the why, Set up the helper", () => {
  const w = preEngage(fine, true, "helper")!;
  assert.equal(preEngageTitle(w), LID_WARN.title);
  assert.deepEqual(preEngageLines(w), [LID_WARN.helper]);
  assert.equal(preEngageSetUp(w), true);
  assert.match(lidLine("refused"), /Setting the helper up again/);
});
ok("with the restart check: its title and lines, the lid line last, one Set up the helper", () => {
  const w = preEngage(off, true, "refused")!;
  assert.equal(preEngageTitle(w), RESTART_WARN.title);
  assert.deepEqual(preEngageLines(w), [...restartWarnLines(off), LID_WARN.refused]);
  assert.equal(preEngageSetUp(w), true);
  const onlyRestartOff = restartCheck({ helper: "on", fileVault: "on" }, 0)!;
  assert.equal(preEngageSetUp({ restart: onlyRestartOff, lid: null }), false, "Turn on restart only: no Set up the helper");
  assert.equal(preEngageSetUp({ restart: onlyRestartOff, lid: "helper" }), true, "the lid gap adds it");
});
ok("the Mac's answer is checked: only helper and refused are gaps", () => {
  assert.equal(okLidGap("helper"), "helper");
  assert.equal(okLidGap("refused"), "refused");
  for (const v of [null, undefined, "", "on", 3, {}]) assert.equal(okLidGap(v), null);
  assert.ok(LID_CHECK_WAIT_MS > 6000 && LID_CHECK_WAIT_MS <= 15000, "waits longer than the Mac's few seconds, never for ever");
});
ok("a stop during Sentry mode is said once after the unlock, in plain words", () => {
  for (const c of ["batteryLow", "tooHot", "helperMissing", "refused", "other"]) {
    const t = lidNote(c)!;
    assert.match(t, /^While Sentry mode was on, keeping your Mac awake with the lid closed stopped/);
    assert.ok(!/still on/.test(t), "Sentry mode has ended when this is read");
    assert.equal(noteFor({ stopped: "unlock", lid: c }), t, "with the end of Sentry mode");
  }
  assert.equal(lidNote("zzz"), null);
  assert.match(noteFor({ stopped: "battery", lid: "batteryLow" })!, /locked/, "the battery stop says its own line first");
});
ok("words: the sleep screen gets the same, no em or en dashes", () => {
  assert.equal(SLEEP_SENTRY_WORDS.lidTitle, LID_WARN.title);
  assert.equal(SLEEP_SENTRY_WORDS.lidHelper, LID_WARN.helper);
  assert.equal(SLEEP_SENTRY_WORDS.lidRefused, LID_WARN.refused);
  for (const w of Object.values(LID_WARN)) assert.ok(!/[\u2013\u2014]/.test(w), w);
  for (const c of ["batteryLow", "tooHot", "helperMissing", "refused", "other"]) assert.ok(!/[\u2013\u2014]/.test(lidNote(c)!));
});
ok("the AI button: the lid check runs with the fresh helper check (lid on only), one busy state, then one decision", () => {
  const v = readFileSync(new URL("../src/views/Sentry.tsx", import.meta.url), "utf8");
  assert.ok(v.includes('psPost({ type: "sentry:lidCheck", id })') && v.includes("__psSentryLid"));
  assert.ok(v.includes("const lidNow: Promise<LidGap | null> = pr.lid ? checkLid() : Promise.resolve(null);"), "lid off: no lid check");
  assert.ok(v.includes("void Promise.all([helperNow, lidNow])"), "both at once, never one after the other");
  assert.ok(v.includes('s.busy || checking ? " busy" : ""') && v.includes("{HELPER_CHECK.words}"), "one busy state and one Checking line for both");
  assert.ok(!v.includes("lidBusy"), "no second busy state");
  assert.ok(v.includes("if (!alive.current) return;\n      setChecking(false);\n      decide(pr, facts, g);"), "nothing engages if the button went away");
  assert.ok(v.includes("if (restartCheck(facts, pr.restartH) || preEngage(null, pr.lid, g))"), "one decision: a pop up for either, or engage");
  assert.ok(v.includes("<RestartWarning check={check} lid={lidGap}") && v.includes("{!check && lidGap && ("), "a lid row, or the lid only pop up");
  assert.ok(v.includes("{lid && <p className=\"sn-warn-p\">{lidLine(lid)}</p>}"), "RestartWarning shows the lid line");
  assert.ok(/LidWarning[\s\S]*e\.key === "Escape"[\s\S]*onClose\(\)/.test(v), "Esc closes the lid pop up");
  assert.ok(v.includes("if (stay) return;"), "a lid note stays until closed");
});

const mac = process.env.PS_MAC_DIR || `${process.env.HOME}/Projects/ps-mac`;
if (existsSync(`${mac}/Sources/SleepSentryCore.swift`) && existsSync(`${mac}/Sources/Sentry.swift`)) {
  ok("the Mac: the same words as fallbacks, the same message names, no lid text on the Sentry screen", () => {
    const core = readFileSync(`${mac}/Sources/SleepSentryCore.swift`, "utf8"), s = readFileSync(`${mac}/Sources/Sentry.swift`, "utf8");
    for (const [k, w] of Object.entries({ lidTitle: LID_WARN.title, lidHelper: LID_WARN.helper, lidRefused: LID_WARN.refused, lidSetUp: LID_WARN.setUp, lidAnyway: LID_WARN.anyway, lidCancel: LID_WARN.cancel }))
      assert.ok(core.includes(`"${k}": "${w}"`), `the Mac's ${k}`);
    assert.ok(s.includes('case "sentry:lidCheck"') && s.includes("window.__psSentryLid"));
    assert.ok(!s.includes("notice = CATextLayer()") && s.includes("send(stopped: why, lid: lidStopCode)"));
    const lidSrc = readFileSync(`${mac}/Sources/SentryLid.swift`, "utf8");
    for (const g of ["helper", "refused"]) assert.ok(lidSrc.includes(g), `the Mac's gap ${g}`);
  });
} else console.log(`skip - ps-mac lid check: no ${mac}/Sources/SleepSentryCore.swift (set PS_MAC_DIR)`);

console.log(`sentry lid: ${n} passed`);
