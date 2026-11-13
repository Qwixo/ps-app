// Run: node --experimental-strip-types tests/phonedevices.test.ts
// V1.56 phone layout editor (core/phonedevices.ts): which phones an account has, the picker, and where the phone button
// sits in the Mac's Edit overview (never under the Dynamic Island).
import assert from "node:assert/strict";
import { BEAT_HOURS, STALE_DAYS, androidName, cleanPhoneDev, phoneButtonSpot, phoneChoice, phoneLabel, phoneScreen, phonesOf, shouldBeat, type PhoneDev } from "../src/core/phonedevices.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const NOW = Date.parse("2026-11-13T12:00:00.000Z");
const ago = (h: number) => new Date(NOW - h * 3600e3).toISOString();
const pixel = { dev: "pixel0001aa", phone: "gos", name: "Pixel 8", w: 412, h: 915, seen: ago(2) };
const iphone = { dev: "iphone0002bb", phone: "ios", name: "iPhone", w: 393, h: 852, seen: ago(1) };

ok("a record is checked: a known phone kind, a device id, a time; names lose dashes and control characters", () => {
  assert.deepEqual(cleanPhoneDev(pixel), pixel);
  assert.equal(cleanPhoneDev({ ...pixel, phone: "windows" }), null);
  assert.equal(cleanPhoneDev({ ...pixel, dev: "../x" }), null);
  assert.equal(cleanPhoneDev({ ...pixel, seen: "yesterday" }), null);
  assert.equal(cleanPhoneDev({ ...pixel, name: "Pixel\u2014 8\n" })!.name, "Pixel 8");
  assert.equal(cleanPhoneDev({ ...pixel, w: 99999 })!.w, 0, "a silly screen is dropped (the usual one is used)");
});
ok("the account's phones: most recently seen first, each device once (its newest), stale ones left out", () => {
  const old = { ...pixel, seen: ago(30) };
  const gone = { dev: "oldphone03cc", phone: "gos", name: "Pixel 6", w: 412, h: 915, seen: ago(24 * (STALE_DAYS + 1)) };
  const list = phonesOf([old, pixel, iphone, gone, { junk: true }], NOW);
  assert.deepEqual(list.map((d) => d.dev), ["iphone0002bb", "pixel0001aa"]);
  assert.equal(list[1].seen, pixel.seen, "the newer record of the Pixel wins");
});
ok("the phone button: one phone opens it, several give a picker, none asks GrapheneOS or iPhone", () => {
  const one = phonesOf([pixel], NOW);
  assert.deepEqual(phoneChoice(one), { open: one[0] });
  const two = phonesOf([pixel, iphone], NOW);
  assert.deepEqual(phoneChoice(two), { pick: two });
  assert.deepEqual(phoneChoice([]), { ask: true });
});
ok("the picker's names: \"Pixel 8, GrapheneOS\" and \"iPhone\"; twins are told apart", () => {
  const [d] = phonesOf([pixel], NOW);
  assert.equal(phoneLabel(d), "Pixel 8, GrapheneOS");
  assert.equal(phoneLabel(cleanPhoneDev(iphone)!), "iPhone");
  assert.equal(phoneLabel(cleanPhoneDev({ ...pixel, name: "" })!), "Android phone, GrapheneOS");
  const a = cleanPhoneDev(iphone)!, b = cleanPhoneDev({ ...iphone, dev: "iphone0003dd" })!;
  assert.deepEqual([phoneLabel(a, [a, b]), phoneLabel(b, [a, b])], ["iPhone (1)", "iPhone (2)"]);
});
ok("the editor draws the phone's real shape, portrait, or a usual one for its kind", () => {
  assert.deepEqual(phoneScreen(cleanPhoneDev({ ...pixel, w: 915, h: 412 }), "gos"), { w: 412, h: 915 });
  assert.deepEqual(phoneScreen(null, "gos"), { w: 412, h: 915 });
  assert.deepEqual(phoneScreen(null, "ios"), { w: 393, h: 852 });
});
ok("the phone writes its record only when new, changed, or once a day (egress: change only)", () => {
  const prev = cleanPhoneDev(pixel)!;
  const same = { dev: prev.dev, phone: prev.phone, name: prev.name, w: prev.w, h: prev.h };
  assert.equal(shouldBeat(null, same, NOW), true);
  assert.equal(shouldBeat(prev, same, NOW), false);
  assert.equal(shouldBeat(prev, { ...same, w: 400 }, NOW), true);
  assert.equal(shouldBeat({ ...prev, seen: ago(BEAT_HOURS + 1) }, same, NOW), true);
});
ok("the GOS shell's maker and model make a plain name", () => {
  assert.equal(androidName("Google", "Pixel 8"), "Pixel 8");
  assert.equal(androidName("samsung", "SM-S918B"), "samsung SM-S918B");
  assert.equal(androidName("OnePlus", "OnePlus 12"), "OnePlus 12");
  assert.equal(androidName("", ""), "Android phone");
});
ok("the phone button sits top left, and under the Dynamic Island when the island is over that corner", () => {
  assert.deepEqual(phoneButtonSpot(null, 1440), { left: 20, top: 16 });
  assert.deepEqual(phoneButtonSpot({ left: 600, top: 0, right: 840, bottom: 38 }, 1440), { left: 20, top: 16 }, "the island in the middle: nothing moves");
  const s = phoneButtonSpot({ left: 0, top: 0, right: 260, bottom: 90 }, 1440);
  assert.deepEqual(s, { left: 20, top: 100 }, "moved island top left: the button goes under it");
  const box = { left: s.left, top: s.top, right: s.left + 40, bottom: s.top + 40 };
  assert.ok(box.top >= 90, "never covered");
});

console.log(`\n${n} passed`);
