// Run: node --experimental-strip-types tests/phoneapply.test.ts
// V1.56 phone layout editor: the phone (PS GOS and the iPhone web app, both gos/GosLayer.tsx) applies the synced phone
// layout: its pages and their order, a page of panels, the navbar's edge, place and buttons, each page's background and
// look; the Mac's Tab list saves through the main page; and a phone that never had a layout looks exactly as before.
// The layout rules themselves are in tests/phonelayout.test.ts, the phones in tests/phonedevices.test.ts. The pages were
// also checked in a browser at phone size (notes: ~/Projects/ps-handover-notes/phone-editor.md).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanPhoneLayout, defaultPhoneLayout, lookOf, setLook, setNavEdge, addPage, addTile, toggleNav } from "../src/core/phonelayout.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const gos = src("src/gos/GosLayer.tsx");
const AT = "2026-11-13T12:00:00.000Z";

ok("a phone with no phone layout record shows what it always did (the old dock, the three panes)", () => {
  const l = cleanPhoneLayout(undefined, "gos", false);
  assert.deepEqual(l, defaultPhoneLayout("gos", false));
  assert.match(gos, /phoneLayout\(s, kind, red0\) : defaultPhoneLayout\(kind, red0\)/, "the layout comes from the vault, or the default");
});
ok("the phone reads its own kind's layout: PS GOS reads gos, the mobile web app reads ios", () => {
  const pp = src("src/gos/phonepage.ts");
  assert.match(pp, /if \(mode === "gos"\) return "gos";/);
  assert.match(pp, /__psMobile[\s\S]{0,40}=== true\) return "ios";/);
  assert.match(gos, /const kind = thisPhoneKind\(\) \?\? "gos";/);
});
ok("the pages and their order: the swipe and the panes follow the layout; a page of panels is a view of its own", () => {
  assert.match(gos, /const order = useMemo\(\(\) => pl\.pages\.map\(viewOf\), \[pl\]\);/);
  assert.match(gos, /<Swipe pane=\{isPane\(view\) \? view : "list"\} order=\{order\} onPane=\{go\}( invert=\{[^}]+\})?>/);   // V1.57: Invert swipe
  assert.match(gos, /const i = order\.indexOf\(pane\)/, "the swipe steps through the layout's order");
  assert.match(gos, /"panels-l" : "panels-r"/, "the list slides away to the side the page of panels is on");
  assert.match(gos, /if \(view\.startsWith\("page:"\) && !order\.includes\(view\)\) setView\("list"\)/, "a page deleted on the Mac: back to the list");
  assert.match(gos, /view\.startsWith\("page:"\) && !document\.querySelector/, "back from a page of panels goes to the list");
});
ok("the navbar: its buttons and their order from the layout, its edge on the page, its place on the bar", () => {
  assert.match(gos, /const dockItems = pl\.nav\.items\.filter\(\(it\) => it !== "rules" \|\| red\);/);
  assert.match(gos, /dockItems\.map\(\(it\) =>/);
  assert.match(gos, /data-edge=\{pl\.nav\.edge\} data-align=\{pl\.nav\.align\}/);
  assert.match(gos, /document\.documentElement\.dataset\.gosNav = pl\.nav\.edge;/);
  assert.match(gos, /it\.startsWith\("page:"\)\) return <DockBtn/, "a page of panels can have a button in the navbar");
  const css = src("src/gos/phonepages.css");
  assert.match(css, /html\.gos\[data-gos-nav="top"\] \{ --gos-top: calc\(var\(--gos-inset-top/, "a top navbar moves the page's top down");
  assert.match(css, /html\.gos\[data-gos-nav="top"\] \.gos-dock \{ top:/);
  for (const a of ["left", "center", "right"]) assert.ok(css.includes(`.gos-dock[data-align="${a}"]`), a);
  // The shell's inset no longer sets --gos-top itself (it would beat the top navbar's room).
  const br = src("src/gos/bridge.ts");
  assert.match(br, /r\.setProperty\("--gos-inset-top"/);
  assert.ok(!/setProperty\("--gos-top"/.test(br));
  assert.match(src("src/gos/gos.css"), /--gos-top: var\(--gos-inset-top, env\(safe-area-inset-top, 0px\)\);/);
});
ok("each page's background and look reach the list's background and the app's look; the Mac never sets them", () => {
  let l = addPage(defaultPhoneLayout("ios"), 3, AT).layout;
  const id = l.pages[3].id;
  l = setLook(l, id, "bg", "color:g-dusk", AT);
  l = setLook(l, null, "look", "midnight", AT);
  assert.deepEqual(lookOf(l, id), { bg: "color:g-dusk", look: "midnight" });
  assert.match(gos, /const lk = lookOf\(pl, curPage\.id\);/);
  assert.match(src("src/views/TaskMap.tsx"), /bgDesign\(phoneBg \?\? pageBg\(pg\.pages, curPage\.id\) \?\? shownBg\(st\)\)/);
  assert.match(src("src/App.tsx"), /const pageLook = phoneLook \?\? listLook;/);
  assert.match(src("src/gos/phonepage.ts"), /bgDesign\(next\.bg\) === next\.bg \? next\.bg : null/, "only a real background is passed on");
  assert.equal((src("src/views/TaskMap.tsx").match(/setPhoneNow/g) ?? []).length, 0, "the Mac's list never sets the phone page");
});
ok("a page of panels draws the very panels the list draws, on the same grid as the Mac's editor", () => {
  const pages = src("src/gos/PhonePages.tsx");
  assert.match(pages, /return panelElement\(kind\);/);
  assert.match(pages, /const b = cellBox\(t, w\);/);
  assert.match(src("src/views/PhoneEditor.tsx"), /const b = cellBox\(t, W\);/);
  assert.match(src("src/views/TaskMap.tsx"), /\{isPhoneBuild\(\) && <PhoneTilesHost \/>\}/, "mounted inside the list, on the phone only");
  // The Slot hands its element over on the phone too (no Edit mode there).
  const em = src("src/views/EditMode.tsx");
  assert.ok(em.indexOf("if (!isCopy(id)) made.set(id, children);") < em.indexOf("if (!c) return <>{children}</>;\n  const here"), "registered before the phone's early return");
});
ok("a change made on the Mac reaches the vault: the Tab list's save goes to the main page as its own op", () => {
  const ps = src("src/ps.ts");
  assert.match(ps, /w\.kind === "phonelayout"\) \{ psPost\(\{ type: "looks", patch: \{ phoneLayoutOp: w \} \}\)/);
  assert.match(ps, /if \(patch\.phoneLayoutOp\) void runPhoneLayoutOp\(patch\.phoneLayoutOp\)/);
  assert.match(ps, /d\.kind === "phonelayout" \|\| d\.kind === "phonedev"/, "the Tab list sees the layouts and the phones");
  assert.match(src("src/core/vault.ts"), /"phonelayout", "phonedev",/, "owner private, vault key");
});
ok("the phone tells the Mac it exists, change only; the GOS shell's model names it", () => {
  assert.match(gos, /usePhoneBeat\(kind, s\.status === "unlocked" && s\.role === "owner", g\.visible, g\.device\);/);
  assert.match(src("src/core/actions.ts"), /if \(!shouldBeat\(prev, next\)\) return;/);
  assert.match(src("src/gos/bridge.ts"), /device: typeof m\.device === "string" \? m\.device\.slice\(0, 60\) : ""/);
});
ok("the phone button sits in the Mac's Edit overview (a mount point, nothing else there changed)", () => {
  const em = src("src/views/EditMode.tsx");
  assert.match(em, /<PhoneMount live=\{live\} leaving=\{leaving\} red=\{red\} onDone=\{onDone\} \/>/);
});
ok("a layout made for one kind never shows on the other kind", () => {
  let g = toggleNav(setNavEdge(defaultPhoneLayout("gos"), "top", AT), "vault", false, AT);
  const r = addPage(g, 0, AT); g = addTile(r.layout, r.id!, "clipboard", false, AT).layout;
  const asIos = cleanPhoneLayout(g, "ios", false);
  assert.equal(asIos.phone, "ios");
  assert.ok(!asIos.pages.some((p) => p.tiles?.some((t) => t.id === "clipboard")), "GOS only panels never on the iPhone");
});
ok("a change from the Mac (or the phone) glides: tiles slide, navbar buttons slide (FLIP), backgrounds fade in", () => {
  const css = src("src/gos/phonepages.css");
  assert.match(css, /\.pp-tile \{[^}]*transition: left \.5s[^}]*top \.5s[^}]*width \.5s[^}]*height \.5s/);
  assert.match(css, /html\.gos \.tm-p1-scene \{ animation: pp-bg-in/);
  assert.match(gos, /useFlip\(dockRef, `\$\{pl\.nav\.items\.join\(\)\}\|\$\{pl\.nav\.align\}\|\$\{pl\.nav\.edge\}`/);
  assert.match(src("src/gos/flip.ts"), /el\.animate\(\[\{ transform: `translate\(\$\{dx\}px, \$\{dy\}px\)` \}, \{ transform: "none" \}\]/);
  // Back on screen, both phones sync at once (one change only ask): GOS on "visible", the web app on visibilitychange.
  const br = src("src/gos/bridge.ts");
  assert.match(br, /case "visible": set\(\{ visible: m\.on === true \}\); if \(m\.on === true\) \{ void sync\(\);/);
  assert.match(br, /if \(on && vaultStore\.get\(\)\.status === "unlocked"\) void sync\(\);/);
  // Newest wins: the newest record of a phone kind is the one shown (core/phonelayout.ts pickPhoneLayout, by its time).
  assert.match(src("src/views/PhoneEditor.tsx"), /bgCss\(lk\.bg \?\? phoneOwnBg\)/, "the Mac's canvas shows the phone's own background from its Settings");
});
ok("no em or en dashes anywhere in the new code", () => {
  for (const f of ["src/core/phonelayout.ts", "src/core/phonedevices.ts", "src/gos/phonepage.ts", "src/gos/phonebeat.ts", "src/gos/PhonePages.tsx", "src/gos/phonepages.css",
    "src/views/PhoneEditor.tsx", "src/views/phoneeditor.css", "src/gos/flip.ts", "src/ui/phonesfx.ts", "tests/phonelayout.test.ts", "tests/phonedevices.test.ts", "tests/phoneapply.test.ts"]) {
    const t = src(f);
    assert.ok(![...t].some((c) => c.charCodeAt(0) === 0x2013 || c.charCodeAt(0) === 0x2014), `${f} has a dash`);
  }
});

console.log(`\n${n} passed`);
