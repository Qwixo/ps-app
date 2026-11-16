// Run: node --experimental-strip-types tests/sentry-defaults.test.ts
// PS 1.65 (the developer's friend, 17 Nov 2026): Auto approve starts On in AI mode and Sleep mode (never Always), AI Sentry mode starts with
// Sleep mode, one notice asks "Do you want this off?". Pure rules only (core/autoapprove.ts, core/sentry.ts, core/featureintro.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APPROVE_DEFAULTS, APPROVE_FEATURE, APPROVE_INTRO, APPROVE_PICKS, approveAnswer, approveIntroProbe, approveResolve, cleanApprove } from "../src/core/autoapprove.ts";
import { SENTRY_DEFAULTS, cleanSentry, sleepSentry, SLEEP_AUTO_NAME } from "../src/core/sentry.ts";
import { INTROS, nextIntro, emptyState, ACTIVE_NEEDED_MS, type IntroFacts } from "../src/core/featureintro.ts";
import { SLEEP_ENTRIES } from "../src/core/sleepsettings.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

ok("AI mode and Sleep mode start On, Always starts Off", () => {
  assert.deepEqual(APPROVE_DEFAULTS, { ai: true, sleep: true, always: false });
  assert.deepEqual(approveResolve({}), { ai: true, sleep: true, always: false });
});
ok("a saved choice always wins, On or Off", () => {
  assert.deepEqual(approveResolve({ ai: false, sleep: false, always: false }), { ai: false, sleep: false, always: false });
  assert.deepEqual(approveResolve({ ai: false }), { ai: false, sleep: true, always: false });
  assert.equal(approveResolve({ always: true }).always, true);
});
ok("the Mac's state carries whether a default still stands", () => {
  assert.equal(cleanApprove({ ai: true, sleep: true, always: false, on: false, defaulted: true })?.defaulted, true);
  assert.equal(cleanApprove({ ai: true, sleep: false, always: false, on: false })?.defaulted, false);
  assert.equal(cleanApprove(undefined), undefined);
});
ok("the notice shows only while a default stands, waits when unknown, is done after a choice", () => {
  assert.equal(approveIntroProbe(undefined), "unknown");
  assert.equal(approveIntroProbe(cleanApprove({ defaulted: true })), "open");
  assert.equal(approveIntroProbe(cleanApprove({ defaulted: false })), "done");
});
ok("Keep it on keeps the ticked switches, Turn off turns both off", () => {
  assert.deepEqual(approveAnswer(false, ["ai", "sleep"]), [{ key: "ai", on: true }, { key: "sleep", on: true }]);
  assert.deepEqual(approveAnswer(false, ["sleep"]), [{ key: "ai", on: false }, { key: "sleep", on: true }]);
  assert.deepEqual(approveAnswer(true, ["ai", "sleep"]), [{ key: "ai", on: false }, { key: "sleep", on: false }]);
  assert.ok(approveAnswer(false, ["ai", "sleep"]).every((a) => a.key !== "always"), "Always is never touched by the notice");
});
ok("the notice words: plain, a question, two buttons, no dashes", () => {
  assert.match(APPROVE_INTRO.ask, /Do you want this off\?$/);
  assert.equal(APPROVE_INTRO.show, "Keep it on");
  assert.equal(APPROVE_INTRO.later, "Turn off");
  assert.deepEqual(APPROVE_PICKS.map((p) => p.label), ["In AI mode", "In Sleep mode"]);
  assert.doesNotMatch(JSON.stringify([APPROVE_INTRO, APPROVE_PICKS]), /[–—]/);
});
ok("the notice is an island intro with its own id, a choice card with picks", () => {
  const d = INTROS.find((x) => x.id === APPROVE_INTRO.id);
  assert.ok(d); assert.equal(d.choice, true); assert.equal(d.picks?.length, 2);
  assert.equal(INTROS.filter((x) => x.id === APPROVE_INTRO.id).length, 1);
});
ok("the notice comes only after a minute of use, never in Sleep or Sentry mode", () => {
  const f: IntroFacts = { now: 1_000_000_000, notForThem: INTROS.filter((x) => x.id !== APPROVE_INTRO.id).map((x) => x.id), islandBusy: false, sleep: false, sentry: false, dnd: false, sharing: false, fullScreen: false, off: false };
  assert.deepEqual(nextIntro(emptyState(), f), { wait: "notActive" });
  const used = { ...emptyState(), activeMs: ACTIVE_NEEDED_MS };
  assert.equal((nextIntro(used, f) as { show: { id: string } }).show.id, APPROVE_INTRO.id);
  assert.deepEqual(nextIntro(used, { ...f, sleep: true }), { wait: "sleep" });
  assert.deepEqual(nextIntro(used, { ...f, sentry: true }), { wait: "sentry" });
});
ok("AI Sentry mode with Sleep mode is on by default and the person can opt out", () => {
  assert.equal(SENTRY_DEFAULTS.sleepAuto, true);
  assert.equal(cleanSentry({}).sleepAuto, true);
  assert.equal(cleanSentry({ sleepAuto: false }).sleepAuto, false);
  assert.equal(cleanSentry({ sleepAuto: "no" }).sleepAuto, true);
  assert.equal(sleepSentry(cleanSentry({}), null).auto, true);
  assert.equal(sleepSentry(cleanSentry({ sleepAuto: false }), null).auto, false);
});
ok("an old saved Sentry record without the new part gets the defaults, other choices stand", () => {
  const p = cleanSentry({ lowStop: false, lowPct: 20, restartH: 12 });
  assert.equal(p.sleepAuto, true); assert.equal(p.lowStop, false); assert.equal(p.lowPct, 20); assert.equal(p.restartH, 12);
});
ok("every Sentry feature under Sleep mode is on by default (stay awake, battery stop, lid, restart)", () => {
  const sp = sleepSentry(cleanSentry({}), null).plan;
  assert.equal(sp.lowStop, true); assert.equal(sp.lid, true); assert.ok(sp.restartH > 0);
});
ok("Sleep settings lists the opt out row on the Mac, with its name", () => {
  const e = SLEEP_ENTRIES.find((x) => x.id === "sentry-auto");
  assert.ok(e); assert.equal(e.name, SLEEP_AUTO_NAME); assert.deepEqual(e.on, ["mac"]);
});
ok("both features are in features.json (on, owner jan, since 1.65) and FEATURES.md", () => {
  const reg = JSON.parse(read("../../features.json")).features as { id: string; owner: string; since: string; default: string; scope: string }[];
  for (const id of [APPROVE_FEATURE, "sentry-sleep-auto"]) {
    const f = reg.find((x) => x.id === id);
    assert.ok(f, id); assert.equal(f.owner, "jan"); assert.equal(f.scope, "shared"); assert.equal(f.since, "1.65"); assert.equal(f.default, "on");
    assert.match(read("../../FEATURES.md"), new RegExp(id));
  }
});
ok("the Mac side keeps every safety limit: still only the hook or a clear Yes prompt, questions wait", () => {
  const core = read("../../mac/Sources/AutoApproveCore.swift");
  assert.match(core, /questionTools = \["AskUserQuestion", "ExitPlanMode"\]/);
  assert.match(core, /defaultAlways = false/);
  const app = read("../../mac/Sources/AutoApprove.swift");
  assert.match(app, /refreshKeysLine\(ask: false\)/, "starting with the defaults never asks macOS for a permission");
  assert.match(app, /refreshKeysLine\(ask: on\)/, "only a click can ask");
});
console.log(`${n} passed`);
