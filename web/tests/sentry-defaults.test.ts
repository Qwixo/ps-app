// Run: node --experimental-strip-types tests/sentry-defaults.test.ts
// PS 1.65 (the developer's friend, 17 Nov 2026): Auto approve starts On in AI mode and Sleep mode (never Always), AI Sentry mode starts with
// Sleep mode with the stricter rule, one calm notice per Mac. Pure rules only (core/autoapprove.ts, core/sentry.ts, core/featureintro.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APPROVE_DEFAULTS, APPROVE_FEATURE, APPROVE_INTRO, APPROVE_PICKS, approveAnswer, approveIntroProbe, approveOffAfter, approvePicksFor, approveResolve, approveSyncPosts, cleanApprove, cleanApproveOff } from "../src/core/autoapprove.ts";
import { SENTRY_DEFAULTS, SENTRY_SIDE, cleanSentry, clockRoomPct, sleepSentry, SLEEP_AUTO_LINE, SLEEP_AUTO_NAME } from "../src/core/sentry.ts";
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
ok("until the notice was shown on a Mac the defaults act as off there", () => {
  assert.deepEqual(approveResolve({}, false), { ai: false, sleep: false, always: false });
  assert.deepEqual(approveResolve({ sleep: true }, false), { ai: false, sleep: true, always: false });
});
ok("the Mac's state carries whether a default still stands", () => {
  assert.equal(cleanApprove({ ai: true, sleep: true, always: false, on: false, defaulted: true })?.defaulted, true);
  assert.equal(cleanApprove({ ai: true, sleep: false, always: false, on: false })?.defaulted, false);
  assert.equal(cleanApprove(undefined), undefined);
});
ok("the Mac's state carries which switches are still open there and whether the notice was shown", () => {
  const s = cleanApprove({ defaulted: true, unset: ["sleep", "always", 3, "ai"], noticed: true });
  assert.deepEqual(s?.unset, ["ai", "sleep"]); assert.equal(s?.noticed, true);
  assert.deepEqual(cleanApprove({ unset: "ai" })?.unset, []);
});
ok("the notice shows on each Mac while a switch is open there, waits when unknown, is done after a choice", () => {
  assert.equal(approveIntroProbe(undefined), "unknown");
  assert.equal(approveIntroProbe(cleanApprove({ defaulted: true, unset: ["ai", "sleep"] })), "open");
  assert.equal(approveIntroProbe(cleanApprove({ defaulted: false })), "done");
  // a Mac that has not seen it shows it, even after a Keep it on elsewhere (nothing synced then)
  assert.equal(approveIntroProbe(cleanApprove({ defaulted: true, unset: ["ai", "sleep"] }), []), "open");
  // a Turn off given elsewhere: this Mac applies it (it waits a moment, never shows a card for nothing)
  assert.equal(approveIntroProbe(cleanApprove({ defaulted: true, unset: ["ai", "sleep"] }), ["ai", "sleep"]), "unknown");
  assert.equal(approveIntroProbe(cleanApprove({ defaulted: true, unset: ["ai", "sleep"] }), ["sleep"]), "open");
});
ok("the card shows only the switches still open on this Mac", () => {
  assert.deepEqual(approvePicksFor(cleanApprove({ unset: ["sleep"] })).map((p) => p.id), ["sleep"]);
  assert.deepEqual(approvePicksFor(undefined), []);
});
ok("Keep it on keeps the ticked switches, Turn off turns them off, always quietly, only open ones", () => {
  assert.deepEqual(approveAnswer(false, ["ai", "sleep"]), [{ key: "ai", on: true, quiet: true }, { key: "sleep", on: true, quiet: true }]);
  assert.deepEqual(approveAnswer(false, ["sleep"]), [{ key: "ai", on: false, quiet: true }, { key: "sleep", on: true, quiet: true }]);
  assert.deepEqual(approveAnswer(true, ["ai", "sleep"]), [{ key: "ai", on: false, quiet: true }, { key: "sleep", on: false, quiet: true }]);
  assert.deepEqual(approveAnswer(false, ["ai", "sleep"], ["sleep"]), [{ key: "sleep", on: true, quiet: true }], "a choice already saved on this Mac stands");
  assert.ok(approveAnswer(false, ["ai", "sleep"]).every((a) => a.key !== "always"), "Always is never touched by the notice");
});
ok("Turn off reaches every Mac of the person: kept with their settings, applied to open switches only", () => {
  assert.deepEqual(approveOffAfter(undefined, approveAnswer(true, [])), ["ai", "sleep"]);
  assert.deepEqual(approveOffAfter(["sleep"], approveAnswer(false, ["ai", "sleep"], ["ai"])), ["sleep"], "an earlier Turn off stays");
  assert.deepEqual(approveOffAfter([], approveAnswer(false, ["ai"])), ["sleep"]);
  assert.deepEqual(cleanApproveOff(["always", "ai", 7]), ["ai"]);
  assert.deepEqual(approveSyncPosts(cleanApprove({ unset: ["ai", "sleep"] }), ["ai", "sleep"]), [{ key: "ai", on: false, quiet: true }, { key: "sleep", on: false, quiet: true }]);
  assert.deepEqual(approveSyncPosts(cleanApprove({ unset: ["sleep"] }), ["ai", "sleep"]), [{ key: "sleep", on: false, quiet: true }], "a choice saved on that Mac stands");
  assert.deepEqual(approveSyncPosts(cleanApprove({ unset: [] }), ["ai"]), []);
  assert.deepEqual(approveSyncPosts(undefined, ["ai"]), []);
  assert.deepEqual(approveSyncPosts(cleanApprove({ unset: ["ai"] }), "ai"), [], "an odd synced value does nothing");
});
ok("the notice words: plain, two buttons, no dashes", () => {
  assert.match(APPROVE_INTRO.ask, /Questions still wait for you\.$/);
  assert.equal(APPROVE_INTRO.show, "Keep it on");
  assert.equal(APPROVE_INTRO.later, "Turn off");
  assert.deepEqual(APPROVE_PICKS.map((p) => p.label), ["In AI mode", "In Sleep mode"]);
  assert.doesNotMatch(JSON.stringify([APPROVE_INTRO, APPROVE_PICKS]), /[–—]/);
});
ok("the notice is an island intro with its own id, a choice card with picks", () => {
  const d = INTROS.find((x) => x.id === APPROVE_INTRO.id);
  assert.ok(d); assert.equal(d.choice, true); assert.equal(d.picks?.length, 2); assert.equal(d.mark, "shield");
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
ok("pressing the button keeps the person's own Sentry settings; only a lid they chose may stay awake on an automatic start", () => {
  const sp = sleepSentry(cleanSentry({}), null);
  assert.equal(sp.plan.lowStop, true); assert.equal(sp.plan.lid, true); assert.ok(sp.plan.restartH > 0);
  assert.equal(sp.autoLid, false, "the default lid never keeps a closed Mac awake when it started by itself");
  assert.equal(sleepSentry(cleanSentry({ lid: true, lidSet: true }), null).autoLid, true);
  assert.equal(sleepSentry(cleanSentry({ lid: false, lidSet: true }), null).autoLid, false);
  assert.match(SLEEP_AUTO_LINE, /20 percent battery/);
  const core = read("../../mac/Sources/SleepSentryCore.swift");
  assert.match(core, /q\.lowPct = max\(s\.plan\.lowStop \? s\.plan\.lowPct : 0, sleepStopPct\)/);
  assert.match(core, /q\.lid = s\.plan\.lid && s\.autoLid/);
  assert.match(core, /q\.restartH = 0/);
});
ok("the Customise preview keeps the button's room free like the Mac", () => {
  assert.equal(SENTRY_SIDE, 262);
  assert.equal(clockRoomPct(1200, 0, 94), 94);
  assert.ok(Math.abs(clockRoomPct(1200, SENTRY_SIDE, 94) - 100 * (1200 - 524) / 1200) < 1e-9);
  assert.equal(clockRoomPct(600, SENTRY_SIDE, 94), 40, "never under 40 percent");
  assert.equal(clockRoomPct(0, SENTRY_SIDE, 92), 92);
  assert.match(read("../../mac/Sources/SleepScreen.swift"), /static let sentrySide: Double = 28 \+ 210 \+ 24/);
});
ok("Sleep settings lists the opt out row on the Mac, with its name and line", () => {
  const e = SLEEP_ENTRIES.find((x) => x.id === "sentry-auto");
  assert.ok(e); assert.equal(e.name, SLEEP_AUTO_NAME); assert.equal(e.line, SLEEP_AUTO_LINE); assert.deepEqual(e.on, ["mac"]);
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
  assert.match(app, /refreshKeysLine\(ask: on && !quiet\)/, "only a click in Settings can ask, never the notice or a synced answer");
  assert.match(app, /Features\.observers\.append/, "the feature switch applies without a restart");
  assert.match(app, /ApproveCore\.sleepMode\(screenUp: SleepScreen\.shared\.isUp, alarmOnly:/, "an alarm alone is not Sleep mode");
  assert.match(app, /let keep = ApproveCore\.hookWanted\(saved\(\), active: false\)/, "at launch only a saved On writes the line");
  assert.match(app, /if hookIn && !ApproveCore\.savedOn\(saved\(\)\) \{ hookIn = false; q\.sync/, "a default only line comes out at quit");
});
ok("the notice never takes the keyboard and marks this Mac as shown", () => {
  const v = read("../src/views/FeatureIntro.tsx");
  assert.match(v, /def\.choice && phase === "card" \? \{ quiet: true \}/);
  assert.match(v, /psPost\(\{ type: "autoApprove:noticed" \}\)/);
  assert.match(read("../../mac/Sources/main.swift"), /if !quiet && !Protected\.front && !selfTest \{ panel\.makeKey\(\) \}/);
  assert.match(read("../../mac/Sources/main.swift"), /"autoApprove:noticed" where fromMain \|\| fromOverlay/);
});
console.log(`${n} passed`);
