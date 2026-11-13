// Run: node --experimental-strip-types tests/phoneswitch.test.ts
// V1.56 the switch between the Mac's Edit overview and the phone (views/PhoneEditor.tsx PhoneMount, phoneeditor.css).
// The developer: "your macOS pages zooms into where the phone icon was and then your phone icon zooms out into the bigger picture
// ... the moment you click on the macOS icon at the top left then I want it to bring the macOS version back into view."
// The motion itself was stepped frame by frame in a browser (numbers in ~/Projects/ps-handover-notes/phone-editor.md);
// this checks the parts that make it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ed = src("src/views/PhoneEditor.tsx");
const css = src("src/views/phoneeditor.css");

ok("into the phone: the Mac pages fly into the icon's spot, then the phone grows out of it", () => {
  assert.match(ed, /phoneSfx\.zoomIn\(\);\s*macAway\(true, centre\);\s*setOpen\(o\); setStage\("toPhone"\);\s*later\(\(\) => setStage\("phone"\), T_SWAP\);/);
  assert.match(ed, /const centre = \{ x: spot\.left \+ 20, y: spot\.top \+ 20 \};/, "the spot is the icon's centre");
  assert.match(ed, /"--pe-rx", `\$\{Math\.round\(p\.x - window\.innerWidth \/ 2\)\}px`/);
  // The Mac's room, bar and live card shrink to the spot; the card fades with a filter (its opacity is held by tm-fade).
  assert.match(css, /html\.pe-mac-away \.ov-room, html\.pe-mac-away \.ov-top \{\s*translate: var\(--pe-rx, 0px\) var\(--pe-ry, 0px\); scale: \.04; opacity: 0;/);
  assert.match(css, /html\.pe-mac-away\.ov-on \.tm-overlay\.ed-able[^{]*\{\s*translate: var\(--pe-rx, 0px\) var\(--pe-ry, 0px\); scale: \.04; filter: opacity\(0\);/);
  // The phone's stage starts at the spot and grows to full size with a soft overshoot.
  assert.match(css, /\.pe-stage \{[^}]*translate: var\(--pe-rx, 0px\) var\(--pe-ry, 0px\); scale: \.04; opacity: 0;/);
  assert.match(css, /\.pe-room\.on \.pe-stage \{ translate: 0px 0px; scale: 1; opacity: 1;\s*transition: translate \.7s cubic-bezier\(\.2, 1\.15, \.32, 1\)/);
});
ok("the overview's own transform is never touched: the zoom uses the separate translate and scale properties", () => {
  assert.ok(!/html\.pe-mac-away[^{]*\{[^}]*\btransform:/.test(css));
  assert.match(css, /html\.pe-anim\.ov-on \.tm-overlay\.ed-able[^{]*\{\s*transition: background-color \.22s ease, transform \.68s var\(--ov-spring/, "editmode's own transitions kept in the list");
});
ok("one button: a phone while the Mac shows, a Mac while the phone shows; it plays the way back", () => {
  assert.match(ed, /if \(stage !== "mac"\) \{ toMac\(\); return; \}/);
  assert.match(ed, /className=\{`pe-phone-btn[^`]*\$\{phoneUp \? " mac" : ""\}`\}/);
  assert.match(css, /\.pe-phone-btn\.mac \.pe-face-mac \{ transform: none; opacity: 1; \}/);
  assert.ok(!ed.includes('className="pe-back"'), "no second back button");
});
ok("back to the Mac: the phone goes into the icon, then the Mac pages grow back; Esc does the same", () => {
  assert.match(ed, /phoneSfx\.zoomOut\(\);\s*setStage\("toMac"\);\s*later\(\(\) => macAway\(false\), T_BACK\);\s*later\(\(\) => \{ setOpen\(null\); setStage\("mac"\); \}, T_DONE\);/);
  assert.match(ed, /stage=\{stage\} onBack=\{toMac\}/);
  assert.match(ed, /useEsc\(true, \(\) => \{ if \(gal\) \{ sfx\.click\(\); setGal\(false\); \} else if \(sure\) setSure\(null\); else onBack\(\); \}\);/);
});
ok("a dark shade sits under the overview (z 88 < 89) so nothing behind shows while the pages fly", () => {
  assert.match(css, /\.pe-shade \{ position: fixed; inset: 0; z-index: 88;/);
});
ok("leaving Edit mode or closing the list mid way puts the Mac back at once; reduced motion skips the waits", () => {
  assert.match(ed, /useEffect\(\(\) => \{ if \(!leaving\) return; setAsking\(false\); macHome\(\); \}, \[leaving\]\);/);
  assert.match(ed, /useEffect\(\(\) => \(\) => \{ timers\.current\.forEach\(\(t\) => window\.clearTimeout\(t\)\); macHome\(\); \}, \[\]\);/);
  assert.match(ed, /reduced\(\) \? 0 : ms/);
  assert.match(css, /html\.pe-anim \.ov-room, html\.pe-anim \.ov-top, html\.pe-anim \.tm-overlay\.ed-able \{ transition-duration: \.01s !important; \}/);
});
ok("sounds: a whoosh in and out, original (made with WebAudio), at the list's own volume", () => {
  const s = src("src/ui/phonesfx.ts");
  assert.match(s, /zoomIn: \(\) => whoosh\(true\)/);
  assert.match(s, /zoomOut: \(\) => whoosh\(false\)/);
  assert.match(s, /const \{ a, v \} = sfxAudio\(\);\s*if \(!a \|\| v <= 0\) return;/, "silent at volume 0");
  assert.ok(![...s, ...ed, ...css].some((c) => c.charCodeAt(0) === 0x2013 || c.charCodeAt(0) === 0x2014), "no em or en dashes");
});

ok("no phone of that kind yet: the button opens Link your phone (the V1.55 pairing), and zooms in once it signs in", () => {
  const li = src("src/views/PhoneLink.tsx");
  assert.match(ed, /const choose = \(k: PhoneKind, d: PhoneDev \| null\) => \{ if \(d\) \{ toPhone\(\{ phone: k, dev: d \}\); return; \} phoneSfx\.click\(\); setAsking\(false\); setLinking\(k\); \};/);
  assert.match(ed, /onLinked=\{\(d\) => toPhone\(\{ phone: linking, dev: d \}\)\} onAnyway=\{\(\) => toPhone\(\{ phone: linking, dev: null \}\)\}/);
  // Reused, not rebuilt: the same QR link, pairing hook and Allow panel as Settings' Link your iPhone.
  assert.match(li, /import \{ PairPanel, usePhonePairing \} from "\.\/LinkPair";/);
  assert.match(li, /phoneLinkUrl\(PROJECT\.url, PROJECT\.key, PROJECT\.schema, undefined, red \? null : v\.username, PROJECT\)/);
  assert.match(li, /const can = PS && !v\.local && \(red \|\| PROJECT\.custom\);/, "the same rule as the Settings row");
  // GrapheneOS: install first (a QR to the download page), then the same sign in code.
  assert.match(li, /useState<"install" \| "link">\(phone === "gos" \? "install" : "link"\)/);
  assert.match(li, /GOS_INSTALL_URL = "https:\/\/cincee\.com\/ps-app-gos\/"/);
  // It notices by itself: Allow done, or a new phone record of that kind arrives; a chime, then the zoom.
  assert.match(li, /if \(linked \|\| !\(pair\.phase\.k === "done" \|\| fresh\)\) return;\s*setLinked\(true\);\s*phoneSfx\.linked\(\);/);
  assert.match(ed, /useEsc\(!!linking && stage === "mac"/, "Esc closes it");
});

console.log(`\n${n} passed`);
