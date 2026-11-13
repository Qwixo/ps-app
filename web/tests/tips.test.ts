// First use tips (core/tips.ts, V1.55): when each shows, once only, an existing user after the update, and never
// during Do Not Disturb, meetings, Sleep mode, Sentry mode, the setup menu, typing or with 1Password or Signal in front.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TIPS, TIP_ORDER, TIP_WORDS, allSeen, blocker, cleanTipsSeen, hidesShowing, isSeen, lastSeenMs, learnedBy, markSeen, mergeTipsSeen,
  nextTip, ownTaskCount, TIP_PHONE, TIPS_NOT_ON_PHONE, placeTip, resetTips, TIP_SIDES, type BlockFacts, type TipFacts,
} from "../src/core/tips.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const T0 = Date.parse("2026-11-12T12:00:00Z");
const HOUR = 3600_000;

const clear: BlockFacts = {
  listShown: true, pageVisible: true, shownForMs: 20_000, sinceKeyMs: 60_000, typing: false, screenOpen: false, setupOpen: false,
  inMeeting: false, sleepMode: false, sentry: false, dnd: false, protectedFront: false,
};
const allTargets = { swipe: true, dots: true, look: true, edit: true, remind: true };
const facts = (o: Partial<TipFacts> = {}): TipFacts => ({
  seen: { at: {} }, synced: true, owner: true, ownTasks: 3, now: T0, block: null, targets: allTargets, hasReminder: false, ...o,
});

ok("the order and the words (plain, no dashes, the developer's lines)", () => {
  assert.deepEqual([...TIP_ORDER], ["swipe", "dots", "look", "edit", "remind"]);
  assert.equal(TIP_WORDS.swipe.title, "Did you know you can swipe to the right?");
  assert.equal(TIP_WORDS.edit.title, "Did you know you can click the Edit button at the top left?");
  for (const id of TIP_ORDER) for (const t of [TIP_WORDS[id].title, TIP_WORDS[id].line, TIP_WORDS[id].hint ?? ""]) assert.doesNotMatch(t, /[–—]/, id);
  const src = readFileSync(new URL("../src/core/tips.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /[–—]/, "no em or en dashes anywhere in the file");
});

ok("none before the person has added tasks of their own (Example tasks do not count)", () => {
  assert.equal(nextTip(facts({ ownTasks: 0 })), null);
  assert.equal(nextTip(facts({ ownTasks: TIPS.minTasks - 1 })), null);
  assert.equal(nextTip(facts({ ownTasks: TIPS.minTasks })), "swipe");
  assert.equal(ownTaskCount([{ example: true }, { example: true }, {}, {}]), 2);
  assert.equal(ownTaskCount([]), 0);
});

ok("an existing user after updating: tasks already there, nothing seen, so the first tip shows", () => {
  assert.equal(nextTip(facts({ ownTasks: 140, seen: undefined })), "swipe");
  assert.equal(nextTip(facts({ ownTasks: 140, seen: cleanTipsSeen(null) })), "swipe");
});

ok("one at a time, in order, each once only", () => {
  let seen = cleanTipsSeen(null);
  let now = T0;
  const shown: string[] = [];
  for (let i = 0; i < 12; i++) {
    const id = nextTip(facts({ seen, now }));
    if (!id) { now += 2 * HOUR; continue; }
    shown.push(id);
    seen = markSeen(seen, id, now);
    now += 2 * HOUR;
  }
  assert.deepEqual(shown, ["swipe", "dots", "look", "edit", "remind"]);
  assert.ok(allSeen(seen));
  assert.equal(nextTip(facts({ seen, now: now + 100 * HOUR })), null);
});

ok("spaced out: nothing for an hour after a tip, then the next", () => {
  const seen = markSeen(undefined, "swipe", T0);
  assert.equal(nextTip(facts({ seen, now: T0 + 5 * 60_000 })), null);
  assert.equal(nextTip(facts({ seen, now: T0 + TIPS.gapMs - 1 })), null);
  assert.equal(nextTip(facts({ seen, now: T0 + TIPS.gapMs })), "dots");
});

ok("a tip with no target on the screen is skipped, the next one with a target shows", () => {
  assert.equal(nextTip(facts({ targets: { ...allTargets, swipe: false } })), "dots");
  assert.equal(nextTip(facts({ targets: {} })), null);
  assert.equal(nextTip(facts({ seen: { at: { swipe: new Date(T0 - 3 * HOUR).toISOString(), dots: new Date(T0 - 3 * HOUR).toISOString(), look: new Date(T0 - 3 * HOUR).toISOString() } }, targets: { remind: true } })), "remind");
});

ok("the reminder tip is skipped for someone who already has a task reminder", () => {
  const seen = { at: { swipe: "2026-11-01T00:00:00Z", dots: "2026-11-01T00:00:00Z", look: "2026-11-01T00:00:00Z", edit: "2026-11-01T00:00:00Z" } };
  assert.equal(nextTip(facts({ seen, hasReminder: true })), null);
  assert.equal(nextTip(facts({ seen, hasReminder: false })), "remind");
});

ok("not before the settings have arrived, and not on a helper view", () => {
  assert.equal(nextTip(facts({ synced: false })), null);
  assert.equal(nextTip(facts({ owner: false })), null);
});

ok("never during Do Not Disturb, a meeting, Sleep mode, Sentry mode, the setup menu, typing", () => {
  const cases: [Partial<BlockFacts>, string][] = [
    [{ dnd: true }, "dnd"], [{ inMeeting: true }, "meeting"], [{ sleepMode: true }, "sleep"], [{ sentry: true }, "sentry"],
    [{ setupOpen: true }, "setup"], [{ typing: true }, "typing"], [{ screenOpen: true }, "screen"], [{ protectedFront: true }, "protected"],
    [{ listShown: false }, "list"], [{ pageVisible: false }, "page"], [{ sinceKeyMs: 500 }, "keys"], [{ shownForMs: 1000 }, "settling"],
  ];
  for (const [o, want] of cases) {
    const b = blocker({ ...clear, ...o });
    assert.equal(b, want, want);
    assert.equal(nextTip(facts({ block: b })), null, `no tip while ${want}`);
  }
  assert.equal(blocker(clear), null);
  assert.equal(nextTip(facts({ block: blocker(clear) })), "swipe");
});

ok("1Password or Signal in front beats everything, the setup menu beats a plain screen", () => {
  assert.equal(blocker({ ...clear, protectedFront: true, listShown: false, dnd: true }), "protected");
  assert.equal(blocker({ ...clear, setupOpen: true, screenOpen: true }), "setup");
});

ok("what takes a showing tip away at once, and what only stops a new one", () => {
  for (const b of ["protected", "list", "page", "sleep", "sentry", "dnd", "meeting", "setup", "screen"] as const) assert.equal(hidesShowing(b), true, b);
  for (const b of ["typing", "keys", "settling", null] as const) assert.equal(hidesShowing(b), false, String(b));
});

ok("doing the thing yourself counts as knowing it", () => {
  assert.deepEqual(learnedBy({ how: "swipe" }, null), ["swipe"]);
  assert.deepEqual(learnedBy({ how: "key" }, null), ["swipe"]);
  assert.deepEqual(learnedBy({ how: "dot" }, null), ["dots"]);
  assert.deepEqual(learnedBy({ how: "swipe" }, "swipe"), [], "the showing tip handles its own tick");
  assert.deepEqual(learnedBy({ how: "made" }, null), []);
  assert.deepEqual(learnedBy({}, null), []);
});

ok("seen is kept once: a second mark never moves the time", () => {
  const a = markSeen(undefined, "dots", T0);
  const b = markSeen(a, "dots", T0 + HOUR);
  assert.equal(b.at.dots, a.at.dots);
  assert.equal(isSeen(b, "dots"), true);
  assert.equal(isSeen(b, "look"), false);
  assert.equal(lastSeenMs(b), T0);
});

ok("Show tips again: everything older stops counting, new ones count again", () => {
  let s = cleanTipsSeen(null);
  for (const id of TIP_ORDER) s = markSeen(s, id, T0 - 5 * HOUR);
  assert.ok(allSeen(s));
  const r = resetTips(T0);
  assert.deepEqual(r.at, {});
  assert.equal(nextTip(facts({ seen: r })), "swipe");
  // an old copy from another device that still has the old entries
  const merged = mergeTipsSeen(s, r);
  assert.equal(allSeen(merged), false);
  assert.equal(nextTip(facts({ seen: merged })), "swipe");
  const after = markSeen(merged, "swipe", T0 + 1000);
  assert.equal(isSeen(after, "swipe"), true);
  assert.equal(isSeen(after, "dots"), false);
});

ok("two devices never undo each other", () => {
  const a = markSeen(undefined, "swipe", T0);
  const b = markSeen(undefined, "dots", T0 + 1000);
  const m = mergeTipsSeen(a, b);
  assert.equal(isSeen(m, "swipe"), true);
  assert.equal(isSeen(m, "dots"), true);
  assert.equal(mergeTipsSeen(a, a).at.swipe, a.at.swipe);
});

ok("junk in the saved value is dropped", () => {
  assert.deepEqual(cleanTipsSeen("x"), { at: {} });
  assert.deepEqual(cleanTipsSeen({ at: { swipe: "yesterday", nope: "2026-11-12T00:00:00Z", dots: "2026-11-12T00:00:00Z" }, reset: 5 }), { at: { dots: "2026-11-12T00:00:00Z" } });
  assert.equal(isSeen(null, "swipe"), false);
  assert.equal(lastSeenMs(undefined), 0);
});

ok("the card sits beside what it points at, inside the screen", () => {
  const vp = { w: 1000, h: 700 }, card = { w: 300, h: 150 };
  const dots = { x: 440, y: 640, w: 120, h: 20 };
  const a = placeTip(dots, card, vp, TIP_SIDES.dots);
  assert.equal(a.side, "above");
  assert.ok(a.y + card.h < dots.y && a.x >= 12 && a.x + card.w <= 988);
  assert.ok(Math.abs(a.x + a.arrow! - 500) < 1, "the arrow points at the middle of the dots");
  const edit = placeTip({ x: 20, y: 20, w: 70, h: 32 }, card, vp, TIP_SIDES.edit);
  assert.equal(edit.side, "below");
  assert.equal(edit.x, 12, "kept inside the left edge");
  assert.ok(edit.arrow! >= 0 && edit.arrow! <= card.w);
  const row = placeTip({ x: 600, y: 300, w: 380, h: 44 }, card, vp, TIP_SIDES.remind);
  assert.equal(row.side, "left", "no room on the right, so the left");
  const swipe = placeTip({ x: 0, y: 0, w: 1000, h: 700 }, card, vp, TIP_SIDES.swipe);
  assert.equal(swipe.side, "bottom");
  assert.equal(swipe.arrow, null);
  assert.equal(swipe.x, 350);
  assert.equal(placeTip(null, card, vp, TIP_SIDES.dots).side, "bottom");
  const tiny = placeTip({ x: 5, y: 5, w: 10, h: 10 }, { w: 400, h: 300 }, { w: 380, h: 280 }, TIP_SIDES.dots);
  assert.ok(tiny.x >= 12 || tiny.x >= 0);
});

ok("the phone: taps and holds instead of clicks and right clicks, no Edit or right click tips", () => {
  assert.deepEqual([...TIPS_NOT_ON_PHONE], ["edit", "remind"]);
  for (const t of Object.values(TIP_PHONE)) assert.doesNotMatch(t!, /click|[\u2013\u2014]/i);
  assert.match(TIP_PHONE.swipe!, /one finger/);
});

// ---------- the wiring (source checks: the page itself is checked in the browser preview) ----------
const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");

ok("the tips never take the keyboard focus, never open a window, and are drawn only inside the page", () => {
  const v = src("views/Tips.tsx");
  assert.doesNotMatch(v, /\.focus\(/, "nothing is focused");
  assert.doesNotMatch(v, /autoFocus/);
  assert.doesNotMatch(v, /psPost|gosPost|Notification|window\.open/, "no native pop up, no notification");
  assert.match(v, /createPortal\(<TipCard/, "drawn in the page");
  assert.match(v, /tabIndex=\{-1\}/, "the button is not reached by Tab");
  assert.match(v, /onMouseDown=\{\(e\) => \{ e\.preventDefault\(\)/, "a click does not move the focus");
  assert.doesNotMatch(v, /[\u2013\u2014]/, "no em or en dashes");
  const css = src("views/tips.css");
  assert.doesNotMatch(css, /[\u2013\u2014]/);
  assert.match(css, /prefers-reduced-motion/);
});

ok("Esc puts a showing tip away before anything else hears it", () => {
  const v = src("views/Tips.tsx");
  assert.match(v, /e\.key !== "Escape"[\s\S]{0,160}preventDefault\(\); e\.stopImmediatePropagation\(\);[\s\S]{0,60}hide\(true\)/);
  assert.match(v, /addEventListener\("keydown", k, true\)/, "a capture listener, newest first for the Esc handover");
});

ok("it waits for every quiet rule the person named, and a tip showing leaves when they start", () => {
  const v = src("views/Tips.tsx");
  for (const w of ["dndActive(", "afkMeetWindows(", "sleepState().here", "sentryUp()", "useWelcomeShowing()", "useWhatsNewShowing()", "useFaceShowing()", "typingNow()", "isProtectedApp(", "useOverlayShown()", "hidesShowing(block)"]) assert.ok(v.includes(w), w);
});

ok("the tips run on the Mac list, the website and the phone, public build too (nothing gated to the developer)", () => {
  assert.match(src("views/PsApp.tsx"), /<TipsHost \/>/);
  assert.match(src("App.tsx"), /\{WEBSITE_WN && <TipsHost \/>\}/);
  assert.match(src("gos/GosLayer.tsx"), /<TipsHost \/>/);
  const v = src("views/Tips.tsx"), c = src("core/tips.ts");
  assert.doesNotMatch(v + c, /isRedAccount|\.red\b/, "no the developer only gate");
});

ok("it saves as settings.tipsSeen, merged with the vault's newest, and Settings has Show tips again", () => {
  assert.match(src("ps.ts"), /p\.tipsSeen[\s\S]{0,120}mergeTipsSeen\(settingsData\(vaultStore\.get\(\)\)\.tipsSeen, p\.tipsSeen\)/);
  assert.match(src("core/model.ts"), /tipsSeen\?: import\("\.\/tips"\)\.TipsSeen/);
  assert.match(src("core/settingsindex.ts"), /id: "tips", group: "about"/);
  assert.match(src("views/SettingsGroups.tsx"), /"tips": row\(\(\) => <TipsAgainEntry \/>\)/);
  assert.match(src("views/Tips.tsx"), /resetTips\(Date\.now\(\)\)/);
});

ok("the page hooks from the lists chat are heard, and a swipe on its own counts as knowing it", () => {
  assert.match(src("views/Tips.tsx"), /addEventListener\("ps-page-swiped"/);
  assert.match(src("views/ListPager.tsx"), /emit\("ps-page-swiped"/);
  assert.match(src("views/ListPager.tsx"), /emit\("ps-list-created"/);
  assert.match(src("views/Tips.tsx"), /sfx\.done\(\)/, "the tick sound");
});

console.log(`${n} passed`);
