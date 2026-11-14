// Run: node --experimental-strip-types tests/screenrecisland.test.ts
// Screen recorder, the island side as the page sees it (PS 1.60, pull request 12b: core/screenrecmeet.ts, the meetwatch.ts message, the
// feature intro entry, the two new Settings rows). The Mac's rules (meeting found with an app window and the mic, the order of the two
// questions, one card at a time, private mode hiding every sign, the performance watch) are tested in mac/tests/screenrec-island-test.sh
// with fake capture, fake clocks and fake samplers. Nothing here records or asks macOS.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as M from "../src/core/screenrecmeet.ts";
import * as S from "../src/core/screenrec.ts";
import * as FI from "../src/core/featureintro.ts";
import { SETTINGS } from "../src/core/settingsindex.ts";
import type { CalEvent } from "../src/core/model.ts";

let n = 0;
const t = (name: string, f: () => void) => { f(); n++; console.log("ok -", name); };
const NOW = Date.parse("2026-11-14T10:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const ev = (o: Partial<CalEvent> = {}): CalEvent => ({ id: "e1", title: "Call with Sam", start: iso(NOW - 60_000), end: iso(NOW + 29 * 60_000), allDay: false, link: null, attendees: [{ email: "sam@example.com", self: false } as never], ...o });
const st = (o: Record<string, unknown> = {}) => ({ featureOn: true, enabled: true, ...o });

t("a meeting on now with people or a link is found", () => {
  assert.deepEqual(M.liveMeeting([ev()], NOW), { name: "Call with Sam", key: "e1" + iso(NOW - 60_000) });
  assert.equal(M.liveMeeting([ev({ attendees: [], link: "https://example.com/call" })], NOW)?.name, "Call with Sam");
});
t("a solo block, an all day event, a finished or a far off meeting is not found", () => {
  assert.equal(M.liveMeeting([ev({ attendees: [] })], NOW), null);
  assert.equal(M.liveMeeting([ev({ allDay: true })], NOW), null);
  assert.equal(M.liveMeeting([ev({ start: iso(NOW - 3_600_000), end: iso(NOW - 60_000) })], NOW), null);
  assert.equal(M.liveMeeting([ev({ start: iso(NOW + 600_000), end: iso(NOW + 1_800_000) })], NOW), null);
});
t("starting now means from a minute before to 15 minutes after the start", () => {
  assert.ok(M.liveMeeting([ev({ start: iso(NOW + 30_000), end: iso(NOW + 1_800_000) })], NOW));
  assert.ok(M.liveMeeting([ev({ start: iso(NOW - 14 * 60_000), end: iso(NOW + 1_800_000) })], NOW));
  assert.equal(M.liveMeeting([ev({ start: iso(NOW - 20 * 60_000), end: iso(NOW + 1_800_000) })], NOW), null);
});
t("the name is tidied and a blank one is Meeting", () => {
  assert.equal(M.liveMeeting([ev({ title: "  Call   with\nSam " })], NOW)?.name, "Call with Sam");
  assert.equal(M.liveMeeting([ev({ title: "" })], NOW)?.name, "Meeting");
  assert.ok((M.liveMeeting([ev({ title: "x".repeat(500) })], NOW)?.name.length ?? 0) <= 120);
});
t("OFF means nothing is sent: no meeting is looked at for recording", () => {
  assert.equal(M.meetingMessage({ st: null, events: [ev()], now: NOW, privateAskPending: false }), null);
  assert.equal(M.meetingMessage({ st: st({ enabled: false }), events: [ev()], now: NOW, privateAskPending: false }), null);
  assert.equal(M.meetingMessage({ st: st({ featureOn: false }), events: [ev()], now: NOW, privateAskPending: false }), null);
});
t("on: the Mac is told the meeting, and that the private mode question goes first", () => {
  const m = M.meetingMessage({ st: st(), events: [ev()], now: NOW, privateAskPending: true })!;
  assert.equal(m.type, "screenrec"); assert.equal(m.op, "meeting"); assert.equal(m.name, "Call with Sam"); assert.equal(m.privateAsk, true);
  const none = M.meetingMessage({ st: st(), events: [], now: NOW, privateAskPending: false })!;
  assert.equal(none.name, null); assert.equal(none.key, null); assert.equal(none.privateAsk, false);
});
t("the feature intro is for people who said No or have not answered", () => {
  assert.equal(M.introAudience({ mac: true, st: st({ enabled: false }) }), "open");
  assert.equal(M.introAudience({ mac: true, st: st({ enabled: true }) }), "done");
  assert.equal(M.introAudience({ mac: true, st: null }), "unknown");
  assert.equal(M.introAudience({ mac: true, st: st({ featureOn: false, enabled: false }) }), "unknown");
  assert.equal(M.introAudience({ mac: false, st: null }), "done");
});
t("the intro is one new entry in the list, after WhatsApp, with its own words and mark", () => {
  const d = FI.INTROS.find((x) => x.id === "screenrec")!;
  assert.ok(d); assert.equal(d.headline, "Screen recording now in PS"); assert.equal(d.mark, "record");
  assert.ok((d.steps ?? []).length >= 3); assert.ok(FI.INTROS.findIndex((x) => x.id === "screenrec") > FI.INTROS.findIndex((x) => x.id === "whatsapp"));
  assert.equal(new Set(FI.INTROS.map((x) => x.id)).size, FI.INTROS.length);
});
t("the intro shows once like every intro and Yes retires it", () => {
  const d = FI.INTROS.find((x) => x.id === "screenrec")!;
  const s0 = FI.emptyState();
  assert.ok(FI.eligible(d, s0, { notForThem: [] }, NOW));
  assert.equal(FI.eligible(d, s0, { notForThem: ["screenrec"] }, NOW), false);
  assert.equal(FI.eligible(d, FI.retire(s0, "screenrec", NOW), { notForThem: [] }, NOW + 9e9), false);
});
t("the intro probe asks the Mac for its saved choice only and reads the audience rule", () => {
  const src = readFileSync(new URL("../src/views/FeatureIntro.tsx", import.meta.url), "utf8");
  assert.match(src, /screenrec: async \(\) => \{ askScreenRec\(\); return introAudience\(/);
  assert.match(src, /record: recordMark/);
});
t("the meeting watch sends the message only through the gate", () => {
  const src = readFileSync(new URL("../src/meetwatch.ts", import.meta.url), "utf8");
  assert.match(src, /meetingMessage\(\{ st: screenRecNow\(\)/);
  assert.match(src, /privateAskPending: !!asking/);
});
t("two new Settings rows, both on by default, both findable", () => {
  assert.equal(S.DEFAULT_CHOICES.askMeetings, true); assert.equal(S.DEFAULT_CHOICES.perfWatch, true);
  const c = S.cleanChoices({ askMeetings: false, perfWatch: false });
  assert.equal(c.askMeetings, false); assert.equal(c.perfWatch, false);
  assert.equal(S.cleanChoices({}).askMeetings, true);
  assert.deepEqual(S.patchFor("askMeetings", false), { askMeetings: false });
  const ids = SETTINGS.map((x) => x.id);
  assert.ok(ids.includes("screenrec-ask") && ids.includes("screenrec-perf"));
  const src = readFileSync(new URL("../src/views/ScreenRec.tsx", import.meta.url), "utf8");
  assert.match(src, /change\("askMeetings"/); assert.match(src, /change\("perfWatch"/);
});
t("the Mac's message keeps the new switches", () => {
  const x = S.cleanState({ type: "screenrec", settings: { askMeetings: false } })!;
  assert.equal(x.settings.askMeetings, false); assert.equal(x.settings.perfWatch, true);
});
t("every new word is plain: no dashes, no hype", () => {
  for (const w of [...M.screenRecIslandCopy(), S.SR_WORDS.askMeetingsLabel, S.SR_WORDS.askMeetingsLine, S.SR_WORDS.perfLabel, S.SR_WORDS.perfLine]) {
    assert.ok(!/[–—]/.test(w), w); assert.ok(!/!/.test(w), w);
  }
});
console.log(`${n} pass`);
