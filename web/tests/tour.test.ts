// Run: node --experimental-strip-types tests/tour.test.ts
// The "where things live" tour (core/tour.ts, PS 1.65) and how it joins the island intro rules (core/featureintro.ts). Fake times only.
import { readFileSync } from "node:fs";
import { ACTIVE_NEEDED_MS, GAP_MS, INTROS, addActive, answer, cleanState, emptyState, markShown, nextIntro, retireFolded, eligible, type IntroFacts, type IntroState } from "../src/core/featureintro.ts";
import * as T from "../src/core/tour.ts";
import { AGAIN_KEY, TOUR_FEATURE, TOUR_FOLDS, TOUR_ID, TOUR_STEPS, TOUR_WORDS, buttonWord, stepAfter, tourSteps, type TourFacts } from "../src/core/tour.ts";
import { GROUPS, SETTINGS, settingById } from "../src/core/settingsindex.ts";

let fails = 0, n = 0;
const ok = (name: string, c: boolean) => { n++; if (!c) { fails++; console.log(`FAIL ${name}`); } };
const T0 = 1_800_000_000_000;
const TOUR = INTROS.find((d) => d.id === TOUR_ID)!;
const facts = (over: Partial<IntroFacts> = {}): IntroFacts => ({ now: T0, notForThem: [], islandBusy: false, sleep: false, sentry: false, dnd: false, sharing: false, fullScreen: false, off: false, ...over });
const active = (ms = ACTIVE_NEEDED_MS): IntroState => ({ ...emptyState(), ver: "V1.65", activeMs: ms });
const pick = (s: IntroState, f: IntroFacts) => nextIntro(s, f, [TOUR]);
const shows = (s: IntroState, f: IntroFacts) => { const p = pick(s, f); return !!p && "show" in p; };
const waits = (s: IntroState, f: IntroFacts) => { const p = pick(s, f); return p && "wait" in p ? p.wait : null; };

// ---- the list and its words
ok("the tour is an intro, flagged tour, updaters only, first install gets none", !!TOUR && TOUR.tour === true && TOUR.updatersOnly === true);
ok("the tour comes before the separate 1.65 intros it replaces", TOUR_FOLDS.every((id) => INTROS.findIndex((d) => d.id === TOUR_ID) < INTROS.findIndex((d) => d.id === id)));
ok("every folded id is a real intro", TOUR_FOLDS.every((id) => INTROS.some((d) => d.id === id)));
ok("no dashes in any word", !/[–—]/.test(JSON.stringify([TOUR_STEPS, TOUR_WORDS, TOUR])));
ok("step ids are unique and each has words and a place", new Set(TOUR_STEPS.map((s) => s.ids[0])).size === TOUR_STEPS.length && TOUR_STEPS.every((s) => s.title && s.line && s.where && s.ids.length));
ok("the ten things are all there", ["posture-reminder", "checklist-reminder", "device-backgrounds", "receipts", "notif-stack", "proton-bridge", "fuller-history", "gsquad-v3", "whats-new-tour", "gsquad-pieces"].every((id) => TOUR_STEPS.some((s) => s.ids.includes(id))));

// ---- every place named is a real Settings place (group and row names come from core/settingsindex.ts)
const group = (id: string) => GROUPS.find((g) => g.id === id)!.label;
ok("posture and checklist tabs exist with those names", TOUR_STEPS.find((s) => s.ids[0] === "posture-reminder")!.where === `Settings, ${group("posture")}` && TOUR_STEPS.find((s) => s.ids[0] === "checklist-reminder")!.where === `Settings, ${group("chkremind")}`);
const dev = settingById("device-bg")!;
ok("backgrounds per device: Appearance, Background, its row", TOUR_STEPS.find((s) => s.ids[0] === "device-backgrounds")!.where === `Settings, ${group("looks")}, ${settingById(dev.parent!)!.name}, ${dev.name}`);
const rc = settingById("receipts")!;
ok("receipts: its Settings row is named right", TOUR_STEPS.find((s) => s.ids[0] === "receipts")!.where.includes(`Settings, ${group(rc.group)}, ${rc.name}`));
const fh = settingById("fuller-history")!;
ok("fuller history: group and row", TOUR_STEPS.find((s) => s.ids[0] === "fuller-history")!.where === `Settings, ${group(fh.group)}, ${fh.name}`);
ok("stacked notifications: switch is in the squad group's From the squad row", TOUR_STEPS.find((s) => s.ids[0] === "notif-stack")!.where.endsWith(`Settings, ${group("gsquad")}, ${settingById("squad-features")!.name}`));
ok("a Show the tour again row sits in About and updates", settingById("tour-again")?.group === "about" && settingById("tour-again")!.name === TOUR_WORDS.again.name);
ok("settings ids stay unique", new Set(SETTINGS.map((e) => e.id)).size === SETTINGS.length);

// ---- which steps a person gets
const allOn = (where: TourFacts["where"], over: Partial<TourFacts> = {}): TourFacts => ({ where, on: () => true, owner: true, mail: true, ...over });
const titles = (f: TourFacts) => tourSteps(f).map((s) => s.title);
ok("Mac with everything on: all but the phone's Edit mode, in order", titles(allOn("mac")).join("|") === TOUR_STEPS.filter((s) => !s.on || s.on.includes("mac")).map((s) => s.title).join("|") && !titles(allOn("mac")).includes("Edit mode on your phone"));
ok("phone: no Mac only steps, no Posture or Checklist, has Edit mode", (() => { const t = titles(allOn("phone")); return !t.includes("Proton Mail") && !t.includes("Stacked notifications") && !t.includes("Posture reminder") && !t.includes("Checklist reminder") && t.includes("Edit mode on your phone"); })());
ok("website: no Mac only steps and no phone Edit mode", (() => { const t = titles(allOn("web")); return !t.includes("Proton Mail") && !t.includes("Stacked notifications") && !t.includes("Edit mode on your phone") && t.includes("Posture reminder"); })());
ok("a feature that is off skips only its own step", (() => { const t = titles(allOn("mac", { on: (id) => id !== "receipts" })); return !t.includes("Receipts and Purchases") && t.includes("Fuller history") && t.length === titles(allOn("mac")).length - 1; })());
ok("an id the build does not know is skipped (on answers false)", titles(allOn("mac", { on: (id) => id === "fuller-history" })).join() === "Fuller history");
ok("nothing on: no steps (no tour)", tourSteps(allOn("mac", { on: () => false })).length === 0);
ok("receipts only for the owner of the vault", !titles(allOn("mac", { owner: false })).includes("Receipts and Purchases"));
ok("Proton Mail only where Client emails can be switched on", !titles(allOn("mac", { mail: false })).includes("Proton Mail"));
ok("G Squad step shows when any of its ids is on", titles(allOn("mac", { on: (id) => id === "gsquad-dm" })).join() === "G Squad, new look" && titles(allOn("mac", { on: (id) => id === "gsquad-v3" })).join() === "G Squad, new look");
ok("only the old gsquad-newlook look on: no DM step", titles(allOn("mac", { on: (id) => id === "gsquad-newlook" })).length === 0);
ok("a custom list is filtered the same way", tourSteps(allOn("web"), [{ ids: ["x"], title: "X", line: "l", where: "w" }]).length === 1);

// ---- stepping
ok("Next goes on, the last step ends", stepAfter(0, 3) === 1 && stepAfter(1, 3) === 2 && stepAfter(2, 3) === null);
ok("one step only: Done at once", stepAfter(0, 1) === null && buttonWord(0, 1) === TOUR_WORDS.done);
ok("button says Next until the last step, then Done", buttonWord(0, 4) === TOUR_WORDS.next && buttonWord(2, 4) === TOUR_WORDS.next && buttonWord(3, 4) === TOUR_WORDS.done);
ok("counter is one based", TOUR_WORDS.count(0, 6) === "1 of 6" && TOUR_WORDS.count(5, 6) === "6 of 6");

// ---- timing and eligibility
ok("not right after the update: zero active seconds waits", waits(addActive(active(), { version: "V1.66", deltaMs: 0, idleMs: 0, listShown: true }), facts()) === "notActive");
ok("59 seconds waits, a minute starts it", waits(active(ACTIVE_NEEDED_MS - 1), facts()) === "notActive" && shows(active(), facts()));
let t = emptyState();
for (let i = 0; i < 12; i++) t = addActive(t, { version: "V1.65", deltaMs: 5000, idleMs: 200, listShown: true });
ok("twelve active ticks of 5 s start it", shows(t, facts()));
let idle = emptyState();
for (let i = 0; i < 400; i++) idle = addActive(idle, { version: "V1.65", deltaMs: 5000, idleMs: 3_600_000, listShown: true });
ok("idle never starts it", !shows(idle, facts()));
ok("never in a meeting", waits(active(), facts({ meeting: true })) === "meeting");
ok("never in Sleep mode", waits(active(), facts({ sleep: true })) === "sleep");
ok("never in Sentry mode or Do Not Disturb", waits(active(), facts({ sentry: true })) === "sentry" && waits(active(), facts({ dnd: true })) === "dnd");
ok("never with another island card up", waits(active(), facts({ islandBusy: true })) === "busy");
ok("never over a full screen app or while sharing", waits(active(), facts({ fullScreen: true })) === "fullScreen" && waits(active(), facts({ sharing: true })) === "sharing");
ok("switched off: waits as off", waits(active(), facts({ off: true })) === "off");
ok("not for someone it does not apply to (first install)", pick(active(), facts({ notForThem: [TOUR_ID] })) === null);
ok("the one day gap after another intro does not hold the tour back", shows({ ...active(), lastAt: T0 - 1000 }, facts()));
ok("the gap still holds an ordinary intro", (() => { const w = INTROS.find((d) => d.id === "whatsapp")!; const p = nextIntro({ ...active(), lastAt: T0 - 1000 }, facts(), [w]); return !!p && "wait" in p && p.wait === "gap"; })());
ok("a meeting also holds the ordinary intros", (() => { const w = INTROS.find((d) => d.id === "whatsapp")!; const p = nextIntro(active(), facts({ meeting: true }), [w]); return !!p && "wait" in p && p.wait === "meeting"; })());

// ---- once per person
let s = markShown(active(), TOUR_ID, T0);
ok("shown once but not finished: it comes back (a meeting began, the page closed)", eligible(TOUR, s, facts(), T0 + 60_000) && eligible(TOUR, s, facts(), T0 + 30 * GAP_MS));
s = answer(s, TOUR_ID, "show");
ok("Done (or Esc) ends it for good, even a month later", !eligible(TOUR, s, facts(), T0 + 90 * GAP_MS) && pick(s, facts({ now: T0 + 90 * GAP_MS })) === null);
ok("the finished record survives save and load", !eligible(TOUR, cleanState(JSON.parse(JSON.stringify(s))), facts(), T0 + 90 * GAP_MS));
ok("Show the tour again: with its record gone it is eligible again", (() => { const { [TOUR_ID]: _x, ...recs } = s.recs; return eligible(TOUR, { ...s, recs }, facts(), T0); })());

// ---- the four old intros are folded in
const s2 = retireFolded(markShown(active(), TOUR_ID, T0), T0);
ok("running the tour marks all nine 1.65 intros done (the Settings assistant joined)", TOUR_FOLDS.every((id) => s2.recs[id]?.closed === true) && TOUR_FOLDS.length === 9);
ok("none of them can show on its own after that", INTROS.filter((d) => TOUR_FOLDS.includes(d.id)).every((d) => !eligible(d, s2, facts(), T0 + 90 * GAP_MS)));
ok("other intros are left alone", !s2.recs["whatsapp"] && !s2.recs["squad-p1"]);
ok("folding is safe twice", JSON.stringify(retireFolded(s2, T0 + 5)) === JSON.stringify(s2) || TOUR_FOLDS.every((id) => retireFolded(s2, T0 + 5).recs[id]?.closed));

// ---- the switch, the settings row and the wiring
const feats = JSON.parse(readFileSync(new URL("../../features.json", import.meta.url), "utf8")).features as { id: string; owner: string; scope: string; since: string; default: string }[];
const f = feats.find((x) => x.id === TOUR_FEATURE);
ok("features.json has the tour switch: jan, shared, 1.65, on", !!f && f.owner === "jan" && f.scope === "shared" && f.since === "1.65" && f.default === "on");
ok("FEATURES.md names it", readFileSync(new URL("../../FEATURES.md", import.meta.url), "utf8").includes("Where things live tour"));
ok("AGAIN_KEY is a plain storage key", /^ps\.[A-Za-z]+$/.test(AGAIN_KEY));
const view = readFileSync(new URL("../src/views/FeatureIntro.tsx", import.meta.url), "utf8");
ok("the tour never takes focus: it is a choice card, whose button has no autoFocus", TOUR.choice === true && /autoFocus=\{!def\.choice\}/.test(view));
ok("the four folded intros read their probe through the tour switch", ["receipts", "\"posture-165\"", "\"checklist-165\"", "\"notif-stack-165\""].every((k) => new RegExp(`${k}:? foldedUnlessTour|${k.replace(/"/g, "")}: foldedUnlessTour`).test(view) || view.includes(`${k}: foldedUnlessTour`)));
ok("Done saves introsDone so it is once per person, synced", /if \(id === TOUR_ID\) \{[\s\S]*?introsDone: \[\.\.\.done, id\]/.test(view));
ok("the Settings row is drawn", readFileSync(new URL("../src/views/SettingsGroups.tsx", import.meta.url), "utf8").includes('"tour-again": row('));

// A tour cut short (a meeting, Sleep mode) goes on at the step it was on, never past the end, never from a bad number.
ok("resumeAt: the saved step when it still exists", T.resumeAt(3, 6) === 3);
ok("resumeAt: past the end or the last gone starts again", T.resumeAt(6, 6) === 0 && T.resumeAt(9, 4) === 0);
ok("resumeAt: odd numbers start at the first step", T.resumeAt(-1, 5) === 0 && T.resumeAt(1.5, 5) === 0 && T.resumeAt(NaN, 5) === 0);
ok("the card starts at resumeAt and Next reports the step to the host", /useState\(\(\) => resumeAt\(tourAt, tour\.length\)\)/.test(view) && /setTi\(n\); onTourStep\?\.\(n\)/.test(view));
ok("Done, Esc and Show the tour again start the next tour from the first step", (view.match(/tourAt\.current = 0/g) || []).length >= 2);

if (fails) { console.log(`tour: ${fails} FAILED of ${n}`); process.exit(1); }
console.log(`tour: ${n} passed`);
