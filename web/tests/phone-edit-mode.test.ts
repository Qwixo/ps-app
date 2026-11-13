// Run: node --experimental-strip-types tests/phone-edit-mode.test.ts
// V1.56 the phone's own Edit mode (gos/PhoneEditMode.tsx, gos/phoneedit.ts, gos/editsfx.ts). The developer, 13 Nov 2026: "currently
// when you click the edit panel, you can move stuff around the screen, you can remove stuff, add new stuff in, I want
// the exact same thing on the mobile version as well."
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FLICK, HOLD_SLOP, NAV_HOLD_MS, isSilent, pageAfterSwipe, pagerStep, phoneEditSoundOk } from "../src/gos/phoneedit.ts";
import { MENU, menuItems } from "../src/gos/menu.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const loud = { on: true, volume: 0.4, dndMutesSounds: false, meetingNow: false };

ok("the sounds follow the phone's silent mode (and the shared rules)", () => {
  assert.ok(phoneEditSoundOk(loud, "normal"));
  assert.ok(phoneEditSoundOk(loud, "unknown"), "an older shell or the iPhone: the shared rules only");
  assert.ok(!phoneEditSoundOk(loud, "silent"));
  assert.ok(!phoneEditSoundOk(loud, "vibrate"));
  assert.ok(isSilent("vibrate") && isSilent("silent") && !isSilent("normal"));
  assert.ok(!phoneEditSoundOk({ ...loud, on: false }, "normal"), "Edit mode sounds off");
  assert.ok(!phoneEditSoundOk({ ...loud, volume: 0 }, "normal"), "muted");
  assert.ok(!phoneEditSoundOk({ ...loud, dndMutesSounds: true }, "normal"), "Do Not Disturb");
  assert.ok(!phoneEditSoundOk({ ...loud, meetingNow: true }, "normal"), "a meeting on");
});
ok("a swipe moves whole pages, a quick flick moves one, never past either end", () => {
  const step = pagerStep(400, 0.6, 0.48);
  assert.equal(step, 120 + 16 + 96);
  assert.equal(pageAfterSwipe(2, 5, -step, 0, step), 3, "a page to the left brings the next one");
  assert.equal(pageAfterSwipe(2, 5, step * 2, 0, step), 0);
  assert.equal(pageAfterSwipe(2, 5, -40, -(FLICK + 0.1), step), 3, "a flick");
  assert.equal(pageAfterSwipe(2, 5, -40, -0.1, step), 2, "too slow and too short: stays");
  assert.equal(pageAfterSwipe(4, 5, -step * 3, 0, step), 4);
  assert.equal(pageAfterSwipe(0, 5, step * 3, 0, step), 0);
  assert.ok(NAV_HOLD_MS >= 450 && NAV_HOLD_MS <= 700 && HOLD_SLOP >= 8);
});
ok("the menu opens it: Edit layout taps a hidden button inside the phone's home, for everyone", () => {
  const it = MENU.find((m) => m.id === "edit")!;
  assert.equal(it.sel, ".pm-edit-open");
  assert.ok(!it.red, "the public build has it too");
  assert.ok(menuItems({ red: false, has: () => true }).some((m) => m.id === "edit"));
  assert.ok(!menuItems({ red: false, has: (s) => s !== ".pm-edit-open" }).some((m) => m.id === "edit"), "no button, no item");
  assert.equal(MENU[MENU.length - 1].id, "settings");
  const src = read("src/gos/PhoneEditMode.tsx");
  assert.match(src, /document\.querySelector<HTMLElement>\("\.gos-home"\)/);
  assert.match(src, /className="pm-edit-open"/);
  assert.match(read("src/gos/phoneeditmode.css"), /\.pm-edit-open \{ display: none; \}/);
});
ok("holding the navbar opens it, and the tap that follows does nothing", () => {
  const src = read("src/gos/PhoneEditMode.tsx");
  assert.match(src, /closest\?\.\("\.gos-dock"\)/);
  assert.match(src, /NAV_HOLD_MS\)/);
  assert.match(src, /if \(swallow && /);
});
ok("GosLayer only gains the mount", () => {
  const g = read("src/gos/GosLayer.tsx");
  assert.match(g, /<PhoneEditMount kind=\{kind\} red=\{red\} \/>/);
  assert.equal((g.match(/PhoneEdit/g) ?? []).length, 4, "the import (two names), the element and its comment");
});
ok("it reuses the Mac phone canvas pieces and saves the same record", () => {
  const src = read("src/gos/PhoneEditMode.tsx");
  assert.match(src, /import \{ PhoneGallery, PhoneScreen, Sheet, pageName, type EditProps, type NavDrag, type TileDrag \} from "\.\.\/views\/PhoneEditor"/);
  assert.match(src, /void savePhoneLayout\(l\)/);
  for (const f of ["addPage", "removePage", "orderPages", "renamePage", "addTile", "removeTile", "moveTile", "resizeTile", "tileToPage", "setNavEdge", "setNavAlign", "setNavItems", "toggleNav"])
    assert.match(src, new RegExp(`\\b${f}\\(`), f);
  assert.match(src, /<LooksSlot layout=\{layout\} red=\{red\} sound=\{sound\} onOpen=\{setLooksOpen\}/);
  assert.match(src, /export function setPhoneLooksSlot\(c: ComponentType<LooksSlotProps> \| null\)/);
  assert.match(src, /const DefaultLooks = \(p: LooksSlotProps\) => <PhoneLooks \{\.\.\.p\} variant="phone" \/>/);
});
ok("back and Esc close the innermost thing first, the Looks panel itself, then zoom into the page", () => {
  const src = read("src/gos/PhoneEditMode.tsx");
  assert.match(src, /if \(renaming\) setRenaming\(null\);\s*else if \(gal\) \{ setGal\(false\); \}\s*else if \(drawer\) setDrawer\(false\);\s*else if \(sure\) setSure\(null\);\s*else done\(\);/);
  assert.match(src, /if \(looksRef\.current\) \{ e\.preventDefault\(\); e\.stopImmediatePropagation\(\); window\.dispatchEvent\(new Event\("lk-close"\)\)/);
  assert.match(read("src/views/PhoneEditor.tsx"), /\.lk-panel, \.lk-ask-wrap"\)\) \{ e\.preventDefault\(\); e\.stopImmediatePropagation\(\); window\.dispatchEvent\(new Event\("lk-close"\)\)/);
  assert.match(read("src/views/PhoneLooks.tsx"), /addEventListener\("lk-close", close\)/);
  assert.match(src, /addEventListener\("gos-back", f, true\)/);
  assert.match(src, /phoneNow\.go\(viewOf\(page\)\)/);
});
ok("touch sized: handles about 40 px on screen at any zoom, nothing scrolls the page while editing", () => {
  const css = read("src/gos/phoneeditmode.css");
  assert.match(css, /\.pm-room \.pe-tile-x \{ width: calc\(30px \* var\(--inv\)\)/);
  assert.match(css, /\.pm-room \.pe-tile-rs \{ width: calc\(24px \* var\(--inv\)\)/);
  assert.match(css, /inset: calc\(-8px \* var\(--inv\)\)/);
  assert.match(css, /\.pm-room \{[^}]*touch-action: none/);
  assert.match(css, /\.pm-tool \{[^}]*min-height: 52px/);
  assert.match(css, /prefers-reduced-motion/);
});
ok("the iPhone's silent switch mutes the sounds while Edit mode is open, PS GOS asks the shell", () => {
  const src = read("src/gos/editsfx.ts");
  assert.match(src, /s\.type = "ambient"/);
  assert.match(src, /gosPost\(\{ type: "ringer:get" \}\)/);
  assert.match(src, /editSoundsClose[\s\S]*s\.type = sessionWas/);
  // One sound module for the phone work: the phone editor's (ui/phonesfx.ts), no tones of its own.
  assert.match(src, /import \{ phoneSfx \} from "\.\.\/ui\/phonesfx"/);
  assert.match(src, /phoneSfx\[PHONE_SOUND\[name\]\]\(\)/);
  assert.ok(!/createOscillator|AudioContext/.test(src), "no audio engine of its own");
});

console.log(`\n${n} passed`);
