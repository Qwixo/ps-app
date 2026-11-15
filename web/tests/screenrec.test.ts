// Run: node --experimental-strip-types tests/screenrec.test.ts
// Screen recorder, the page's rules (PS 1.60, pull request 12a: core/screenrec.ts, src/screenrec.ts, views/ScreenRec.tsx, the setup
// card in core/welcome.ts). The recording rules (opt in gate, presets, resolution, space an hour, file names, folder fallback, leave out
// list) are tested on the Mac side in mac/tests/screenrec-test.sh with fake capture; this file checks what the page decides: when the
// button shows, what a click does, the right click menu, private mode hiding the dot and the timer while recording keeps going, the
// real running time when it comes back, the Mac's message checked, the words, the setup card, and that nothing here records or asks.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as S from "../src/core/screenrec.ts";
import * as W from "../src/core/welcome.ts";
import { SETTINGS, GROUPS, visibleTo } from "../src/core/settingsindex.ts";

let n = 0;
const t = (name: string, f: () => void) => { f(); n++; console.log("ok -", name); };
const base = (o: Record<string, unknown> = {}) => S.cleanState({ type: "screenrec", featureOn: true, enabled: true, state: "idle", perms: { screen: "granted", mic: "granted" }, settings: { enabled: true, picked: true }, ...o })!;
const T0 = 1_763_024_400_000;

t("the Mac's message is checked field by field", () => {
  assert.equal(S.cleanState(null), null);
  assert.equal(S.cleanState({ type: "other" }), null);
  const s = S.cleanState({ type: "screenrec", state: "weird", perms: { screen: "x" }, startedAt: "no", pausedTotal: -5, settings: { fps: 99, resolution: "huge", leftOut: [1, "a.b"] } })!;
  assert.equal(s.state, "off"); assert.equal(s.perms.screen, "unknown"); assert.equal(s.startedAt, null); assert.equal(s.pausedTotal, 0);
  assert.equal(s.settings.fps, 15); assert.equal(s.settings.resolution, "p1080"); assert.deepEqual(s.settings.leftOut, ["a.b"]);
  assert.equal(s.enabled, false); assert.equal(s.featureOn, false);
});

t("OFF by default: the button does not show until the feature is on AND the person said yes", () => {
  assert.equal(S.buttonShows({ ps: true, docked: false, st: null }), false);
  assert.equal(S.buttonShows({ ps: true, docked: false, st: base({ enabled: false }) }), false);
  assert.equal(S.buttonShows({ ps: true, docked: false, st: base({ featureOn: false }) }), false);
  assert.equal(S.buttonShows({ ps: false, docked: false, st: base() }), false, "website and phone never show it");
  assert.equal(S.buttonShows({ ps: true, docked: true, st: base() }), false, "not on the docked list");
  assert.equal(S.buttonShows({ ps: true, docked: false, st: base() }), true);
  assert.equal(S.DEFAULT_CHOICES.enabled, false);
});

t("Settings is offered only where the feature is on, so a person can say yes", () => {
  assert.equal(S.settingsShows({ ps: true, st: base({ enabled: false }) }), true);
  assert.equal(S.settingsShows({ ps: true, st: base({ featureOn: false }) }), false);
  assert.equal(S.settingsShows({ ps: false, st: base() }), false);
});

t("a click: first time the picker, then start, a missing permission is explained first, recording opens the controls", () => {
  assert.equal(S.clickAction(base({ settings: { picked: false } })), "picker");
  assert.equal(S.clickAction(base()), "start");
  assert.equal(S.clickAction(base({ perms: { screen: "unknown", mic: "granted" }, needsScreen: true })), "explainScreen");
  assert.equal(S.clickAction(base({ perms: { screen: "granted", mic: "unknown" } })), "explainMic");
  assert.equal(S.clickAction(base({ state: "recording" })), "controls");
  assert.equal(S.clickAction(base({ state: "paused" })), "controls");
  assert.equal(S.clickAction(base({ state: "starting" })), "none");
  assert.equal(S.clickAction(base({ state: "stopping" })), "none");
});

t("audio only with no computer sound never needs the screen permission", () => {
  const s = base({ needsScreen: false, perms: { screen: "unknown", mic: "granted" }, settings: { picked: true, mode: "audioOnly", computerSound: false } });
  assert.equal(S.missingPermission(s), null);
  assert.equal(S.clickAction(s), "start");
  const m = base({ needsScreen: false, perms: { screen: "unknown", mic: "unknown" }, settings: { picked: true, micOn: false, mode: "audioOnly" } });
  assert.equal(S.missingPermission(m), null, "no mic wanted, no mic permission needed");
});

t("the right click menu is the brief's list, and Stop replaces Start while recording", () => {
  assert.deepEqual(S.menuItems(base()).map((m) => m.label), ["Start recording", "Pick screen", "Pick mic", "Leave out apps", "Save folder", "Settings"]);
  assert.equal(S.menuItems(base({ state: "recording" }))[0].id, "stop");
  assert.equal(S.menuItems(base({ state: "paused" }))[0].label, "Stop recording");
});

t("the timer is the real running time, a pause does not count", () => {
  const rec = base({ state: "recording", startedAt: T0 });
  assert.equal(S.elapsedMs(rec, T0 + 65_000), 65_000);
  const paused = base({ state: "paused", startedAt: T0, pausedAt: T0 + 660_000, pausedTotal: 0 });
  assert.equal(S.elapsedMs(paused, T0 + 900_000), 660_000, "stops while paused");
  const back = base({ state: "recording", startedAt: T0, pausedAt: null, pausedTotal: 240_000 });
  assert.equal(S.elapsedMs(back, T0 + 960_000), 720_000, "660 + 60 seconds = 12:00");
  assert.equal(S.elapsedMs(base(), T0), 0);
  assert.equal(S.timerText(65_000), "1:05"); assert.equal(S.timerText(3_725_000), "1:02:05"); assert.equal(S.timerText(-1), "0:00"); assert.equal(S.timerText(59_999), "0:59");
});

t("signs: dot, pulse and timer while recording", () => {
  const sg = S.signs(base({ state: "recording", startedAt: T0 }), T0 + 65_000, false);
  assert.deepEqual(sg, { dot: true, pulsing: true, timer: "1:05", paused: false });
  const p = S.signs(base({ state: "paused", startedAt: T0, pausedAt: T0 + 5_000 }), T0 + 99_000, false);
  assert.equal(p.paused, true); assert.equal(p.pulsing, false); assert.equal(p.timer, "0:05");
  assert.deepEqual(S.signs(null, T0, false), { dot: false, pulsing: false, timer: null, paused: false });
  assert.equal(S.signs(base(), T0, false).dot, false, "nothing while idle");
});

t("private mode hides every sign and keeps recording; the real time is there when it comes back", () => {
  const rec = base({ state: "recording", startedAt: T0 });
  const hidden = S.signs(rec, T0 + 65_000, true);
  assert.deepEqual(hidden, { dot: false, pulsing: false, timer: null, paused: false });
  assert.equal(S.isRecording(rec), true, "the recording itself keeps going");
  assert.equal(S.signs(rec, T0 + 600_000, false).timer, "10:00", "back after ten minutes: the real time, not a frozen one");
  const paused = base({ state: "paused", startedAt: T0, pausedAt: T0 + 100_000 });
  assert.deepEqual(S.signs(paused, T0 + 200_000, true), hidden, "paused in private mode shows nothing, not even the word Paused");
  assert.equal(S.buttonLabel(rec, true), S.SR_WORDS.button, "a screen reader is not told it is recording");
  assert.equal(S.buttonLabel(rec, false), S.SR_WORDS.buttonRecording);
  assert.equal(S.buttonLabel(paused, false), S.SR_WORDS.buttonPaused);
});

t("the view hides the signs through signs(), reads private mode from settings, and only ticks while they show", () => {
  const v = readFileSync(new URL("../src/views/ScreenRec.tsx", import.meta.url), "utf8");
  assert.match(v, /signs\(st, now, priv\)/);
  assert.match(v, /settingsData\(vaultStore\.get\(\)\)\.privateMode === true/);
  assert.match(v, /useNow\(rec && !priv\)/, "no clock runs while private mode hides the timer");
  assert.match(v, /aria-label=\{buttonLabel\(st, priv\)\}/);
});

t("the Mac is asked for nothing but its saved choices until the person acts; nothing records on its own", () => {
  const b = readFileSync(new URL("../src/screenrec.ts", import.meta.url), "utf8");
  assert.match(b, /export function askScreenRec\(\): void \{ if \(PS && !asked\) \{ asked = true; send\("get"\)/);
  const v = readFileSync(new URL("../src/views/ScreenRec.tsx", import.meta.url), "utf8");
  // every op that starts something is behind a click handler
  for (const op of ["start", "askScreen", "askMic", "test"]) {
    const uses = [...v.matchAll(new RegExp(`"${op}"`, "g"))].length;
    assert.ok(uses >= 1, `${op} is used`);
  }
  const effects = v.split("useEffect(").slice(1).map((c) => c.slice(0, c.search(/\}, \[/)));
  assert.ok(effects.length >= 5);
  for (const e of effects) assert.ok(!/send\("(start|askScreen|askMic|test|optin|stop)"/.test(e), "no effect starts a recording or asks macOS");
});

t("presets and choices as words match the Mac's table", () => {
  assert.deepEqual(S.PRESET_LIST.map((p) => p.id), ["calls", "sharp", "tiny", "custom"]);
  assert.match(S.PRESET_LIST[0].line, /1080p, 15 frames a second, Balanced/);
  assert.match(S.PRESET_LIST[1].line, /Same as your screen, 30 frames a second, High/);
  assert.match(S.PRESET_LIST[2].line, /720p, 15 frames a second, Small file/);
  assert.deepEqual(S.FPS_LIST, [15, 30, 60]);
  assert.equal(S.RES_LABEL.p2160, "4K"); assert.equal(S.RES_LABEL.same, "Same as screen");
  assert.deepEqual(S.patchFor("source", { kind: "window", id: 7 }), { sourceKind: "window", sourceId: 7 });
  assert.deepEqual(S.patchFor("fps", 30), { fps: 30 });
});

t("the resolutions offered come from the Mac (only what the screen can do)", () => {
  assert.deepEqual(base({ resolutions: ["p720", "p1080", "same"] }).resolutions, ["p720", "p1080", "same"]);
  assert.deepEqual(base({ resolutions: ["p720", "bogus", "same"] }).resolutions, ["p720", "same"]);
});

t("the picker lists are cleaned: only image data urls, capped", () => {
  const l = S.cleanList({ type: "screenrecList", displays: [{ id: 1, name: "Built-in", w: 3024, h: 1964, thumb: "data:image/jpeg;base64,AAAA" }, { id: 2, thumb: "javascript:alert(1)" }],
    windows: [{ id: 5, title: "Call", app: "Zoom", icon: "https://evil.example/x.png", suggested: true }], apps: [{ id: "", name: "x" }, { id: "a.b", name: "A", icon: null }] })!;
  assert.equal(l.displays[0].thumb, "data:image/jpeg;base64,AAAA");
  assert.equal(l.displays[1].thumb, null);
  assert.equal(l.windows[0].icon, null);
  assert.equal(l.apps.length, 1);
  assert.equal(S.cleanList({ type: "x" }), null);
});

t("the setup card: a Yes or No question, off unless Yes, permissions only while Yes, nothing sent by Create but the opt in", () => {
  const card = W.TOUR_CARDS.find((c) => c.id === "screenRec")!;
  assert.ok(card && card.yesNo && card.ifOn && card.ifOff);
  assert.match(card.title, /Do you want PS to be able to record sales meetings and client calls\?/);
  assert.match(card.what, /PS records only when you say so\. Recordings stay on your Mac and in the cloud storage you pick\./);
  assert.deepEqual(card.permsOn, ["screen", "mic"]);
  assert.equal(W.TOUR_DEFAULTS.screenRec, false);
  assert.equal(W.choiceLabel(card, true), "Yes"); assert.equal(W.choiceLabel(card, false), "No");
  const deck = W.tourDeck({});
  const ctx = { gym: { on: false } } as never;
  const untouched = W.tourPlan(deck, { screenRec: false }, W.startChoices(deck, { screenRec: false }), ctx, "2026-11-14T10:00:00.000Z");
  assert.ok(!untouched.some((o) => o.to === "native" && (o.msg as { type?: string }).type === "screenrec"), "Create with nothing touched sends nothing");
  const yes = W.tourPlan(deck, { screenRec: false }, { ...W.startChoices(deck, { screenRec: false }), screenRec: true }, ctx, "2026-11-14T10:00:00.000Z");
  assert.deepEqual(yes.find((o) => o.to === "native")!, { to: "native", msg: { type: "screenrec", op: "optin", on: true } });
  const no = W.tourPlan(deck, { screenRec: true }, { ...W.startChoices(deck, { screenRec: true }), screenRec: false }, ctx, "2026-11-14T10:00:00.000Z");
  assert.deepEqual(no.find((o) => o.to === "native")!, { to: "native", msg: { type: "screenrec", op: "optin", on: false } }, "No switches it off again");
  assert.ok(!W.tourDeck({ sr: false }).some((c) => c.id === "screenRec"), "feature off: not asked");
  for (const id of ["screen", "mic"] as const) { const p = W.PERMS[id]; assert.ok(p.why && p.never && p.ifNo && p.button); }
  assert.ok(W.SETUP_GEN >= 2, "the update door offers the new question once");
});

t("Settings has a Screen recording group on the Mac only, only where the feature is on", () => {
  const g = GROUPS.find((x) => x.id === "screenrec")!;
  assert.ok(g); assert.deepEqual(g.on, ["mac"]);
  const main = SETTINGS.find((e) => e.id === "screenrec")!;
  assert.ok(main && main.sr && !main.parent);
  assert.equal(visibleTo(main, { red: false, where: "mac", sr: true }), true);
  assert.equal(visibleTo(main, { red: false, where: "mac", sr: false }), false);
  assert.equal(visibleTo(main, { red: false, where: "web", sr: true }), false);
  assert.ok(SETTINGS.filter((e) => e.group === "screenrec" && e.parent).length >= 4, "the search finds the parts");
});

t("registered: features.json, FEATURES.md and the slot", () => {
  const f = JSON.parse(readFileSync(new URL("../../features.json", import.meta.url), "utf8")).features.find((x: { id: string }) => x.id === "screen-recording");
  assert.ok(f); assert.equal(f.owner, "jan"); assert.equal(f.scope, "shared"); assert.equal(f.since, "1.60");
  assert.match(readFileSync(new URL("../../FEATURES.md", import.meta.url), "utf8"), /\| Screen recording \|/);
  assert.match(readFileSync(new URL("../src/core/tablayout.ts", import.meta.url), "utf8"), /id: "screenrec"/);
  assert.equal(S.SR_FEATURE, "screen-recording");
});

t("every word on screen: no long dashes, no semicolons, no exclamation marks", () => {
  const all = [...S.screenRecCopy(), ...W.tourCopy().filter((x) => /record|screen|microphone/i.test(x))];
  for (const w of all) { assert.ok(!/[–—]/.test(w), `dash in: ${w}`); assert.ok(!/[;!]/.test(w), `punctuation in: ${w}`); }
  assert.ok(all.length > 60);
  assert.equal(S.SR_WORDS.remind, "Let everyone on the call know you are recording.");
  assert.match(S.SR_WORDS.menuBarNote, /cannot hide it/);
});

t("Esc closes every screen and menu here", () => {
  const v = readFileSync(new URL("../src/views/ScreenRec.tsx", import.meta.url), "utf8");
  assert.match(v, /e\.key !== "Escape"/);
  assert.match(v, /useEsc\(pop !== null, close\)/, "the button's menu, reminder and controls");
  assert.match(v, /useEsc\(open, close\)/, "the picker");
  const css = readFileSync(new URL("../src/views/screenrec.css", import.meta.url), "utf8");
  assert.match(css, /prefers-reduced-motion: reduce[^}]*\.sr-dot\.pulse \{ animation: none/s, "reduced motion turns the pulse off");
});

console.log(`\n${n} tests passed`);
