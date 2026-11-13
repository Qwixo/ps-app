// Run: node --experimental-strip-types tests/phonepan.test.ts
// V1.57 the mouse in the Mac's phone canvas (core/phonepan.ts, views/usePhonePan.ts): drag, flick, two finger swipe,
// wheel and the edges slide the row of phone pages; a click is still a click. And the speed work (views/PhoneEditor.tsx).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CLICK_SLOP, WHEEL_GAP, WHEEL_STEP, isClick, nearestPage, pageAfterPan, panBounds, panRubber, phoneEdge, phonePansFrom, rowPos, sidewaysWheel, wheelPages, type Row } from "../src/core/phonepan.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const row: Row = { wc: 340, ws: 210, gap: 34, gap2: 26 };
const near = (sel: string) => ({ closest: (q: string) => q.split(",").some((x) => sel.split(" ").includes(x.trim())) || null });

ok("the row's places match the canvas (the middle page big, the others small beside it)", () => {
  assert.equal(rowPos(0, row), 0);
  assert.equal(rowPos(1, row), 170 + 34 + 105);
  assert.equal(rowPos(2, row) - rowPos(1, row), 236);
  assert.equal(rowPos(-2, row), -rowPos(2, row));
});
ok("it slides until a + New page card is in the middle, then gives like a rubber band", () => {
  const b = panBounds(1, 4, row);   // List in the middle of Plan, List, Page 2, Inbox
  assert.equal(b.min, rowPos(-2, row));
  assert.equal(b.max, rowPos(3, row));
  assert.equal(panRubber(100, 1, 4, row), 100);
  const past = panRubber(b.max + 300, 1, 4, row);
  assert.ok(past > b.max && past < b.max + 300, "past the end it moves less and less");
});
ok("letting go rests on the nearest page; a flick carries on at least one page", () => {
  assert.equal(nearestPage(0, 1, 4, row), 1);
  assert.equal(nearestPage(rowPos(1, row) - 20, 1, 4, row), 2);
  assert.equal(pageAfterPan(40, 0, 1, 4, row), 1, "a short slow drag goes back");
  assert.equal(pageAfterPan(40, 1.2, 1, 4, row), 2, "a quick flick goes on");
  assert.equal(pageAfterPan(-40, -1.2, 1, 4, row), 0);
  assert.equal(pageAfterPan(rowPos(3, row) + 200, 0, 1, 4, row), 3, "past the + card: the last page");
  assert.equal(pageAfterPan(0, 9, 3, 4, row), 3, "never past the ends");
});
ok("a press that moves less than 6 px is a click (a page beside still flies into the middle)", () => {
  assert.equal(CLICK_SLOP, 6);
  assert.ok(isClick(3, 3));
  assert.ok(!isClick(8, 0));
});
ok("the wheel: one page a notch, not faster than one per gap; a sideways swipe follows the fingers", () => {
  assert.deepEqual(wheelPages(0, 100, 1000), { step: 1, acc: 0 });
  assert.deepEqual(wheelPages(0, -100, 1000), { step: -1, acc: 0 });
  assert.equal(wheelPages(0, 20, 1000).step, 0, "a small nudge waits");
  assert.equal(wheelPages(40, 30, 200).step, 1, "nudges add up");
  assert.equal(wheelPages(0, 100, WHEEL_GAP - 10).step, 0, "a hard spin does not fly past every page");
  assert.ok(WHEEL_STEP > 0);
  assert.ok(sidewaysWheel(30, 4));
  assert.ok(!sidewaysWheel(2, 40));
  assert.ok(!sidewaysWheel(0, 0));
});
ok("the edges: near the left or right of the pages (never the top row, never past the side sheet)", () => {
  assert.ok(phoneEdge(10, 400, 0, 1100) < 0);
  assert.ok(phoneEdge(1090, 400, 0, 1100) > 0);
  assert.equal(phoneEdge(550, 400, 0, 1100), 0);
  assert.equal(phoneEdge(10, 40, 0, 1100), 0, "the top row holds the buttons");
  assert.equal(phoneEdge(1200, 400, 0, 1100), 0, "over the side sheet");
  assert.ok(Math.abs(phoneEdge(2, 400, 0, 1100)) > Math.abs(phoneEdge(80, 400, 0, 1100)), "faster the closer");
});
ok("what a press may slide from: the room, pages beside, + cards; never a panel, the navbar, a name or a button", () => {
  assert.ok(phonePansFrom(near(".pe-room .pe-dim")));
  assert.ok(phonePansFrom(near(".pe-room .pe-card")));
  assert.ok(phonePansFrom(near(".pe-room .pe-plus button")));
  for (const s of [".pe-room .pe-tile", ".pe-room .pe-nav", ".pe-room .pe-pill", ".pe-room .pe-sheet", ".pe-room .pe-gal", ".pe-room button", ".pe-room .pe-del", ".pe-room select"]) assert.ok(!phonePansFrom(near(s)), s);
  assert.ok(!phonePansFrom(near(".ov-room")), "outside the phone canvas");
  assert.ok(!phonePansFrom(null));
});
ok("wired and fast: one translate on the row, no React draw per frame; saves wait for the paint; pages memoized", () => {
  const ed = read("src/views/PhoneEditor.tsx"), pan = read("src/views/usePhonePan.ts"), css = read("src/views/phoneeditor.css"), em = read("src/views/EditMode.tsx");
  assert.match(pan, /t\.style\.translate = /);
  assert.ok(!/useState|useReducer/.test(pan), "the pan hook holds no React state (nothing draws per frame)");
  assert.match(ed, /const pan = usePhonePan\(roomRef, trackRef, panApi\);/);
  assert.match(ed, /<div ref=\{trackRef\} className="pe-track">/);
  assert.match(ed, /timer\.current = window\.setTimeout\(\(\) => \{ timer\.current = 0; flush\(\); \}, now \? SAVE_SOON : SAVE_LATER\);/, "never a vault write inside the click");
  assert.match(ed, /export const PhoneScreen = memo\(PhoneScreenBody, sameScreen\);/);
  assert.match(ed, /const GridTile = memo\(/);
  assert.match(ed, /samePhoneLayout\(k, fresh, red\)/, "a vault change that did not touch the phone draws nothing");
  assert.match(css, /\.pe-card:not\(\.cur\) \.pe-nav \{ backdrop-filter: none;/);
  assert.match(css, /\.pe-card::after \{[^}]*opacity: \.4;/, "dimmed with a fading layer, not a filter");
  assert.ok(!/\.pe-card \{[^}]*filter: brightness/.test(css));
  assert.match(css, /html\.pe-mac-gone \.ov-room, html\.pe-mac-gone \.ov-top, html\.pe-mac-gone \.tm-overlay\.ed-able \{ visibility: hidden; \}/);
  assert.match(css, /\.pe-stage > \.pe-clip \{[^}]*width: var\(--pe-area, 100vw\); overflow: hidden;/, "the pages never go under the side sheet");
  assert.match(em, /if \(phoneUi\(null\)\) return;   \/\/ V1.57/, "the Mac overview's arrows leave the hidden Mac pages alone");
  for (const s of [ed, pan, read("src/core/phonepan.ts")]) assert.ok(!/[–—]/.test(s), "no dashes");
});
ok("the phone button: 48 px for both faces, the zoom into and out of its middle", () => {
  const ed = read("src/views/PhoneEditor.tsx"), css = read("src/views/phoneeditor.css"), dv = read("src/core/phonedevices.ts");
  assert.match(dv, /export const PHONE_BTN = 48;/);
  assert.match(css, /\.pe-phone-btn \{[^}]*width: 48px; height: 48px;/);
  assert.match(ed, /const centre = \{ x: spot\.left \+ PHONE_BTN \/ 2, y: spot\.top \+ PHONE_BTN \/ 2 \};/);
  assert.match(ed, /<PhoneGlyph size=\{30\} \/>/);
});
console.log(`${n} passed`);
