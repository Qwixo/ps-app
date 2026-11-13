// "New in this version" pop-ups (core/newpopups.ts, V1.56): the order, the one minute, the skip rules, the open source link
// that is not live yet, Mac only, never two at once, and the words in one place.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NO_WAIT, POPUPS, POPUP_ORDER, addWait, afterShown, applies, cleanPopupsSeen, cleanWait, fill, found, foundNow, gateOpen, markPopupSeen,
  mergePopupsSeen, nextPopup, openStep, popupSeen, tipsFinished, waitDone, type PopupFacts,
} from "../src/core/newpopups.ts";
import { APPROVE_RISK_LABEL, POPUP_STATUS, POPUP_WORDS } from "../src/core/newpopupwords.ts";
import { APPROVE_LINE } from "../src/core/autoapprove.ts";
import { CHECK_WITH_AI_PROMPT, OPEN_SOURCE_URL, checkWithAiText, cleanSourceUrl, openSourceUrl } from "../src/core/opensource.ts";
import { TIP_ORDER, markSeen, cleanTipsSeen } from "../src/core/tips.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const T0 = Date.parse("2026-11-13T12:00:00Z");
const LIVE = "https://github.com/example/ps";

const facts = (o: Partial<PopupFacts> = {}): PopupFacts => ({
  seen: { at: {} }, synced: true, owner: true, now: T0, block: null, tipShowing: false, enabled: true, gateOpen: true, wait: NO_WAIT,
  mac: true, api: "off", approve: "off", approveRowOpened: false, sourceUrl: null, sourceOpened: false, ...o,
});

/** Run the whole run the way the page does: look every second, show what nextPopup says, count the open time and the
 *  one minute, save what was shown. Returns when each popup came (seconds). */
function run(start: Partial<PopupFacts>, seconds = 600, stepAfter?: (id: string, t: number) => void) {
  let f = facts(start);
  const at: Record<string, number> = {};
  for (let t = 0; t < seconds; t++) {
    f = { ...f, now: T0 + t * 1000, wait: addWait(f.wait, 1000) };
    const id = nextPopup(f);
    if (id) {
      at[id] = t;
      f = { ...f, seen: markPopupSeen(f.seen, id, f.now), wait: afterShown() };
      stepAfter?.(id, t);
    }
  }
  return at;
}

ok("the order and the words (plain, no dashes, all in the words file)", () => {
  assert.deepEqual([...POPUP_ORDER], ["api", "approve", "source"]);
  const all = [
    ...Object.values(POPUP_WORDS).flatMap((w) => [w.title, ...w.lines, w.main, w.second ?? "", w.later]),
    APPROVE_RISK_LABEL, ...Object.values(POPUP_STATUS), APPROVE_LINE,
  ];
  for (const t of all) assert.doesNotMatch(t, /[–—]/, t);
  assert.equal(POPUP_WORDS.api.main, "Turn on and copy for AI");
  assert.equal(POPUP_WORDS.api.second, "Open settings");
  assert.equal(POPUP_WORDS.api.later, "Not now");
  assert.equal(POPUP_WORDS.source.main, "Copy for your AI");
  assert.equal(POPUP_WORDS.source.second, "Open");
  assert.match(POPUP_WORDS.approve.title, /^Also new: /);
  assert.equal(POPUP_STATUS.copiedTitle, "Copied");
  assert.equal(fill("{app} is open source", "PS app"), "PS app is open source");
  for (const f of ["../src/core/newpopupwords.ts", "../src/core/newpopups.ts", "../src/core/opensource.ts", "../src/views/NewPopups.tsx", "../src/views/popupstate.ts"]) {
    assert.doesNotMatch(read(f), /[–—]/, `no em or en dashes in ${f}`);
  }
});

ok("the order: API first, Auto approve a minute of open time later, open source a minute after that", () => {
  const at = run({ sourceUrl: LIVE }, 400);
  assert.deepEqual(Object.keys(at), ["api", "approve", "source"]);
  assert.equal(at.api, 0, "the first one comes at once (as soon as it is calm)");
  assert.equal(at.approve - at.api, 60);
  assert.equal(at.source - at.approve, 60);
});

ok("the timing: the wait counts only PS being open, and a sleeping Mac does not count", () => {
  assert.ok(waitDone(NO_WAIT), "nothing shown yet on this device: no wait");
  let w = afterShown();
  assert.ok(!waitDone(w));
  for (let i = 0; i < 59; i++) w = addWait(w, 1000);
  assert.ok(!waitDone(w), "59 seconds is not a minute");
  w = addWait(w, 1000);
  assert.ok(waitDone(w));
  // the Mac slept for 8 hours between two looks: that is one step, not 8 hours
  assert.equal(openStep(T0, T0 + 8 * 3600_000), POPUPS.maxStepMs);
  assert.equal(openStep(T0, T0 + 1000), 1000);
  assert.equal(openStep(T0, T0 - 5000), 0);
  assert.equal(openStep(0, T0), 0, "the first look counts nothing");
  // a quit PS keeps what it counted
  assert.deepEqual(cleanWait(JSON.parse(JSON.stringify({ armed: true, ms: 41_000 }))), { armed: true, ms: 41_000 });
  assert.deepEqual(cleanWait("junk"), { armed: false, ms: 0 });
  assert.deepEqual(cleanWait({ armed: true, ms: -5 }), { armed: true, ms: 0 });
  assert.equal(cleanWait({ armed: true, ms: 1e12 }).ms, POPUPS.capMs);
  // not shown yet: open time is not counted (there is nothing to wait for)
  assert.deepEqual(addWait(NO_WAIT, 5000), NO_WAIT);
  assert.equal(POPUPS.waitMs, 60_000);
});

ok("a restart in the middle of the minute carries on, it does not start again", () => {
  let w = afterShown();
  for (let i = 0; i < 40; i++) w = addWait(w, 1000);
  const saved = JSON.stringify(w);                 // PS quits here
  w = cleanWait(JSON.parse(saved));                // PS starts again
  for (let i = 0; i < 19; i++) w = addWait(w, 1000);
  assert.ok(!waitDone(w));
  w = addWait(w, 1000);
  assert.ok(waitDone(w), "60 seconds of open time in all");
});

ok("each shows once only, on any number of looks and devices", () => {
  const at = run({ sourceUrl: LIVE }, 2000);
  assert.equal(Object.keys(at).length, 3);
  assert.equal(nextPopup(facts({ seen: { at: { api: "2026-11-13T12:00:00.000Z", approve: "2026-11-13T12:01:00.000Z", source: "2026-11-13T12:02:00.000Z" } }, sourceUrl: LIVE })), null);
  const merged = mergePopupsSeen({ at: { api: "2026-11-13T12:00:00.000Z" } }, { at: { approve: "2026-11-13T12:05:00.000Z" } });
  assert.ok(popupSeen(merged, "api") && popupSeen(merged, "approve") && !popupSeen(merged, "source"), "a second device never repeats one");
  assert.equal(mergePopupsSeen({ at: { api: "2026-11-13T12:00:00.000Z" } }, { at: { api: "2026-11-13T11:00:00.000Z" } }).at.api, "2026-11-13T11:00:00.000Z");
  assert.deepEqual(cleanPopupsSeen("junk"), { at: {} });
  assert.deepEqual(cleanPopupsSeen({ at: { api: "yesterday", nope: "2026-11-13T12:00:00.000Z" } }), { at: {} });
});

ok("skipped when the API is already on", () => {
  assert.ok(found(facts({ api: "on" }), "api"));
  assert.equal(nextPopup(facts({ api: "on", approve: "off" })), "approve");
  assert.deepEqual(foundNow(facts({ api: "on" })), ["api"]);
});

ok("skipped when any Auto approve switch is on or its row was opened", () => {
  assert.equal(nextPopup(facts({ api: "on", approve: "on" })), null);
  assert.equal(nextPopup(facts({ api: "on", approve: "off", approveRowOpened: true })), null);
  assert.deepEqual(foundNow(facts({ approve: "on" })), ["approve"]);
  assert.deepEqual(foundNow(facts({ approveRowOpened: true })), ["approve"]);
  assert.deepEqual(foundNow(facts({ api: "on", approve: "on", sourceUrl: LIVE, sourceOpened: true })), ["api", "approve", "source"]);
});

ok("skipped when the open source link was already opened", () => {
  assert.equal(nextPopup(facts({ api: "on", approve: "on", sourceUrl: LIVE, sourceOpened: true })), null);
  assert.equal(nextPopup(facts({ api: "on", approve: "on", sourceUrl: LIVE })), "source");
});

ok("a skipped pop-up never delays the next (the first shown one comes at once)", () => {
  const at = run({ api: "on", sourceUrl: LIVE }, 300);
  assert.deepEqual(Object.keys(at), ["approve", "source"]);
  assert.equal(at.approve, 0);
  assert.equal(at.source - at.approve, 60);
});

ok("the open source pop-up never shows while the link is null", () => {
  assert.equal(OPEN_SOURCE_URL, "https://github.com/RedbyPS/ps-app", "the public repo (live since 13 Nov 2026)");
  assert.equal(openSourceUrl(), "https://github.com/RedbyPS/ps-app");
  assert.ok(!applies(facts({ sourceUrl: null }), "source"));
  assert.equal(nextPopup(facts({ api: "on", approve: "on", sourceUrl: null })), null);
  const at = run({ sourceUrl: null }, 1000);
  assert.deepEqual(Object.keys(at), ["api", "approve"]);
});

ok("a bad link counts as no link (only https)", () => {
  for (const bad of [null, undefined, "", "github.com/x/y", "http://github.com/x/y", "javascript:alert(1)", "https://", "https://a b.com/x", 5, "ftp://x.com/y"]) assert.equal(cleanSourceUrl(bad), null, String(bad));
  assert.equal(cleanSourceUrl(" https://github.com/example/ps "), "https://github.com/example/ps");
});

ok("when the link is filled in later, the pop-up shows on the next launch for anyone who has not seen it", () => {
  // before: the person saw 1 and 2 weeks ago, the link was null
  const seen = { at: { api: "2026-11-14T12:00:00.000Z", approve: "2026-11-14T12:01:00.000Z" } };
  assert.equal(nextPopup(facts({ seen, sourceUrl: null, wait: { armed: true, ms: 60_000 } })), null);
  // after: the link is live, they launch PS and it is calm
  assert.equal(nextPopup(facts({ seen, sourceUrl: LIVE, wait: { armed: true, ms: 60_000 } })), "source");
  // someone who found and saw everything is left alone
  assert.equal(nextPopup(facts({ seen: { at: { api: "2026-11-14T12:00:00.000Z", approve: "2026-11-14T12:01:00.000Z", source: "2026-11-20T12:00:00.000Z" } }, sourceUrl: LIVE })), null);
});

ok("Mac only for the API and Auto approve; open source is for every platform", () => {
  const phone = { mac: false, api: "unknown" as const, approve: "unknown" as const, sourceUrl: LIVE };
  assert.ok(!applies(facts(phone), "api") && !applies(facts(phone), "approve") && applies(facts(phone), "source"));
  assert.equal(nextPopup(facts(phone)), "source");
  assert.equal(nextPopup(facts({ ...phone, sourceUrl: null })), null, "a phone or website with no link sees nothing");
  // an older PS app that never says anything about them: skipped, not stuck
  assert.equal(nextPopup(facts({ api: "unknown", approve: "unknown", sourceUrl: LIVE })), "source");
  assert.deepEqual(foundNow(facts({ mac: false, api: "on", approve: "on" })), []);
});

ok("never two at once, never over a modal", () => {
  assert.equal(nextPopup(facts({ tipShowing: true })), null, "a first use tip is up");
  assert.equal(nextPopup(facts({ enabled: false })), null, "Show first use tips is Off");
  for (const b of ["list", "page", "settling", "keys", "typing", "screen", "setup", "meeting", "sleep", "sentry", "dnd", "protected"] as const) assert.equal(nextPopup(facts({ block: b })), null, b);
  assert.equal(nextPopup(facts({ synced: false })), null);
  assert.equal(nextPopup(facts({ owner: false })), null);
  // the host keeps one card: the clock only asks when nothing is showing, and the second one waits a full minute
  const at = run({ sourceUrl: LIVE }, 130);
  const t = Object.values(at).sort((a, b) => a - b);
  assert.ok(t[1] - t[0] >= 60 && t[2] - t[1] >= 60);
});

ok("a blocked moment holds the next one back until calm, but the order never skips ahead", () => {
  // the API pop-up is only waiting for a calm moment: the later ones do not jump the queue
  assert.equal(nextPopup(facts({ block: "meeting", sourceUrl: LIVE })), null);
  assert.equal(nextPopup(facts({ block: null, sourceUrl: LIVE })), "api");
  // the API is on (found) so the next in line is Auto approve, never open source
  assert.equal(nextPopup(facts({ api: "on", sourceUrl: LIVE })), "approve");
});

ok("when they start: after What's new closes, or, on a brand new install, after the first use tips finish", () => {
  assert.ok(gateOpen(true, false), "an update: What's new was closed");
  assert.ok(!gateOpen(false, false), "a new install with tips still to come");
  assert.ok(gateOpen(false, true));
  assert.equal(nextPopup(facts({ gateOpen: gateOpen(false, false) })), null);
  assert.equal(nextPopup(facts({ gateOpen: gateOpen(true, false) })), "api");
  // the tips: none seen, some seen, all seen, a reminder already exists, a phone
  let seen = cleanTipsSeen(null);
  assert.ok(!tipsFinished(seen, { hasReminder: false, phone: false }));
  for (const id of TIP_ORDER.slice(0, 4)) seen = markSeen(seen, id, T0);
  assert.ok(!tipsFinished(seen, { hasReminder: false, phone: false }), "the last tip is still to come");
  assert.ok(tipsFinished(seen, { hasReminder: true, phone: false }), "the reminder tip is skipped when a reminder exists");
  seen = markSeen(seen, "remind", T0);
  assert.ok(tipsFinished(seen, { hasReminder: false, phone: false }));
  let p = cleanTipsSeen(null);
  for (const id of ["swipe", "dots", "look"] as const) p = markSeen(p, id, T0);
  assert.ok(tipsFinished(p, { hasReminder: false, phone: true }), "a phone never gets the Edit and reminder tips");
  assert.ok(!tipsFinished(p, { hasReminder: false, phone: false }));
});

ok("the prompt for an AI is the repo's CHECK-WITH-AI.md, word for word", () => {
  let md = "";
  try { md = read("../scripts/open-source/CHECK-WITH-AI.md"); } catch { /* the open source export has no scripts folder */ }
  if (!md) return;
  const block = md.match(/```text\n([\s\S]*?)\n```/)?.[1];
  assert.equal(CHECK_WITH_AI_PROMPT, block, "update CHECK_WITH_AI_PROMPT in src/core/opensource.ts to match scripts/open-source/CHECK-WITH-AI.md");
});

ok("the prompt for an AI and the link text", () => {
  assert.match(CHECK_WITH_AI_PROMPT, /^This folder is the source code of PS/);
  assert.match(CHECK_WITH_AI_PROMPT, /skeptical security reviewer/);
  assert.ok((CHECK_WITH_AI_PROMPT.match(/^\d\. /gm) || []).length >= 7);
  const t = checkWithAiText(LIVE);
  assert.ok(t.includes(LIVE) && t.includes(CHECK_WITH_AI_PROMPT));
  assert.doesNotMatch(t, /[–—]/);
});

ok("source checks: one copy of the text, Esc, no focus, mounts, saving, quiet rules, tips never overlap", () => {
  const view = read("../src/views/NewPopups.tsx");
  const settingsView = read("../src/views/TaskApi.tsx");
  const taskapi = read("../src/taskapi.ts");
  // the Copy for AI text is made in one place: taskapi.ts copyAiGuide (taskapidoc's aiGuide); Settings and the pop-up both call it
  assert.match(taskapi, /export function copyAiGuide/);
  assert.match(view, /copyAiGuide\(/);
  assert.match(settingsView, /copyAiGuide\(/);
  assert.doesNotMatch(view, /aiGuide\(|api:copyGuide/, "the pop-up never builds the text itself");
  assert.doesNotMatch(settingsView, /aiGuide\(/);
  // switches the API on with its own scopes (no scopes sent), then copies
  assert.match(view, /type: "api:set", on: true \}/);
  // Esc: a capture listener that stops the key
  assert.match(view, /key !== "Escape"/);
  assert.match(view, /stopImmediatePropagation/);
  assert.match(view, /addEventListener\("keydown", k, true\)/);
  // never takes focus
  assert.match(view, /onMouseDown=\{\(e\) => \{ e\.preventDefault\(\)/);
  assert.equal((view.match(/tabIndex=\{-1\}/g) || []).length >= 4, true);
  assert.doesNotMatch(view, /\.focus\(\)|autoFocus/);
  // never a native window or a notification
  assert.doesNotMatch(view, /Notification\(|psPost\(\{ type: "(win|notify|card)/);
  // every quiet rule is the tips' (blocker), the open source link comes from one constant
  assert.match(view, /blocker\(facts\)/);
  assert.match(view, /hidesShowing\(block\)/);
  assert.match(view, /tipsOn\(st\.tipsShow\)/);
  assert.match(view, /openSourceUrl\(\)/);
  assert.match(read("../src/core/opensource.ts"), /export const OPEN_SOURCE_URL: string \| null = "https:\/\/github\.com\/RedbyPS\/ps-app";/);
  // the open time is counted only while nothing shows, and saved on this device
  assert.match(view, /openStep\(last, now\)/);
  assert.match(view, /pagehide/);
  // what is saved is merged with the vault's newest
  assert.match(read("../src/ps.ts"), /o\.popupsSeen = mergePopupsSeen\(/);
  assert.match(read("../src/core/model.ts"), /popupsSeen\?:/);
  // mounted on the Mac list, the website and the phone
  assert.match(read("../src/views/PsApp.tsx"), /<NewPopupsHost \/>/);
  assert.match(read("../src/App.tsx"), /<NewPopupsHost \/>/);
  assert.match(read("../src/gos/GosLayer.tsx"), /<NewPopupsHost \/>/);
  // the tips and the pop-ups never overlap, both ways
  const tips = read("../src/views/Tips.tsx");
  assert.match(tips, /if \(popupOn\(\)\) return;/);
  assert.match(tips, /setTipOn\(true\)/);
  assert.match(view, /tipOn\(\)/);
  assert.match(view, /setPopupOn\(true\)/);
  // Auto approve: the settings row is opened at its row; the API one at its tab
  assert.match(view, /openSettings\("sentry", \{ jump: "auto-approve" \}\)/);
  assert.match(view, /openSettings\("api"\)/);
  // the risk line is Settings' own line, not a second copy
  assert.match(view, /APPROVE_LINE/);
  assert.doesNotMatch(read("../src/core/newpopupwords.ts"), /tricks into harm/);
});

console.log(`${n} passed`);
