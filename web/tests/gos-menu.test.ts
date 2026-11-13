// Run: node --experimental-strip-types tests/gos-menu.test.ts
// V1.47 phone menu and Plan pane (gos/menu.ts, gos/GosLayer.tsx, gos/gos.css) and the phone's Settings rows
// (core/settingsindex.ts shell rows, gos/PhoneRows.tsx). The developer, 10 Nov 2026: "add more to it: the screen time, the PS rules
// ..., the numerology tab and the timelines ... On the Plan tab I just want the Meetings menu, and put everything else
// including Goals and Time zones in the hamburger icon." and "Redesign the settings menu on the GOS app ... like the macOS app".
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MENU, menuItems, ENDDAY_LINE_FRIEND } from "../src/gos/menu.ts";
import { CAMPAIGNS_ON } from "../src/core/features.ts";
import { SETTINGS, groupsFor, rowsOf, searchSettings, visibleTo, type Ctx } from "../src/core/settingsindex.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const all = () => true;
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

ok("everything the developer named is in the menu: screen time, PS rules, numerology, timelines, goals, time zones, G Squad", () => {
  const m = ids(menuItems({ red: true, has: all }));
  for (const id of ["screentime", "rules", "numerology", "timelines", "goals", "clocks", "gsquad", "settings"]) assert.ok(m.includes(id), id);
});
ok("everything that left the Plan pane and the top row has a menu item (nothing lost)", () => {
  const m = ids(menuItems({ red: true, has: all }));
  // Plan pane before V1.47: clocks, timelines, series map, numerology, campaigns, Dimension X, rule book, Fitness (the dock's Gym).
  // Top row before V1.47: screen time, Morning brief, End your day, clear the clipboard, the gear.
  // Campaigns left in V1.55 behind CAMPAIGNS_ON (core/features.ts): its menu item is only here while that is true.
  for (const id of ["clocks", "timelines", "series", "numerology", ...(CAMPAIGNS_ON ? ["campaigns"] : []), "dimx", "rules", "screentime", "brief", "endday", "clipboard", "settings"]) assert.ok(m.includes(id), id);
  for (const it of MENU) assert.ok(it.was.length > 2, `${it.id} says where it was`);
});
ok("The developer only items never show for anyone else; End your day says what it does for them", () => {
  const f = menuItems({ red: false, has: all });
  for (const id of ["rules", "numerology", "brief", "campaigns"]) assert.ok(!ids(f).includes(id), id);
  assert.equal(f.find((x) => x.id === "endday")!.line, ENDDAY_LINE_FRIEND);
  assert.match(menuItems({ red: true, has: all }).find((x) => x.id === "endday")!.line, /PS rules check/);
});
ok("an item whose real button is not on the page is left out (screen time switched off)", () => {
  const m = ids(menuItems({ red: true, has: (sel) => !sel.includes("tm-st-btn") }));
  assert.ok(!m.includes("screentime"));
  assert.ok(m.includes("clocks") && m.includes("goals") && m.includes("gsquad"), "items GosLayer opens itself never need a button");
});
ok("every item has a label, one plain line, a section and an icon (PS Rules draws its badge)", () => {
  const seen = new Set<string>();
  for (const it of MENU) {
    assert.ok(!seen.has(it.id)); seen.add(it.id);
    assert.ok(it.label.length > 1 && /[.!?]$/.test(it.line), it.id);
    assert.ok(it.icon || it.id === "rules", it.id);
  }
  assert.equal(MENU[MENU.length - 1].id, "settings", "Settings sits at the foot");
});
ok("the Plan pane shows Meetings only; the top row is out of sight but its pop-ups still show", () => {
  const css = read("src/gos/gos.css");
  assert.match(css, /html\.gos \.gos-home \.tm-left > :not\(\.tm-meet, \[data-slot="meetings"\]\) \{[^}]*visibility: hidden/);
  assert.match(css, /html\.gos \.gos-home \.tm-tr \{ visibility: hidden; pointer-events: none; \}/);
  assert.match(css, /\.tm-tr :is\(\.tm-pop, \.tm-st-pop\) \{ visibility: visible; pointer-events: auto; \}/);
  assert.match(css, /\[data-show="clocks"\] \.tm-left > :is\(\.tm-ckdock, \[data-slot="clocks"\]\) \{ position: static !important; visibility: visible/);
});
ok("Goals opens from the menu through one event the list listens for", () => {
  assert.match(read("src/gos/GosLayer.tsx"), /new Event\("ps-open-goals"\)/);
  assert.match(read("src/views/TaskMap.tsx"), /addEventListener\("ps-open-goals", f\)/);
});
ok("the phone's gear opens the Mac's Settings; the old long sheet is gone", () => {
  const l = read("src/gos/GosLayer.tsx");
  assert.ok(!/GosSettings|MobileSettings open/.test(l));
  assert.ok(!/export function GosSettings\(/.test(read("src/gos/GosSettings.tsx")));
});

const GOS: Ctx = { red: true, where: "phone", shell: "gos" }, MW: Ctx = { red: false, where: "phone", shell: "mweb" };
const FRIEND_GOS: Ctx = { red: false, where: "phone", shell: "gos" }, MAC: Ctx = { red: true, where: "mac" };
ok("every old phone sheet setting has its own row in a group", () => {
  const rows = (c: Ctx) => groupsFor(c).flatMap((g) => { const r = rowsOf(g.id, c); return [...r.main, ...r.more].map((e) => e.id); });
  const g = rows(GOS);
  for (const id of ["phone-updates", "phone-macs", "phone-layout", "new-badge", "local-data", "phone-open", "phone-checks", "phone-perms", "phone-usage", "phone-ays", "phone-videos", "phone-haptics", "phone-signin", "phone-stay", "phone-lock", "phone-not-here"]) assert.ok(g.includes(id), id);
  const w = rows(MW);
  for (const id of ["mweb-install", "phone-layout", "new-badge", "phone-haptics", "mweb-alerts", "local-data", "mweb-project", "phone-lock"]) assert.ok(w.includes(id), id);
});
ok("GrapheneOS rows only in the GrapheneOS app, web app rows only in the web app, none on the Mac", () => {
  for (const e of SETTINGS.filter((x) => x.shell === "gos")) { assert.ok(!visibleTo(e, MW), e.id); assert.ok(!visibleTo(e, MAC), e.id); }
  for (const e of SETTINGS.filter((x) => x.shell === "mweb")) { assert.ok(!visibleTo(e, GOS), e.id); assert.ok(!visibleTo(e, MAC), e.id); }
  assert.ok(!SETTINGS.some((e) => e.go === "phone"), "no row points at the old sheet any more");
});
ok("Your Macs and background videos stay the developer's", () => {
  const rows = groupsFor(FRIEND_GOS).flatMap((g) => rowsOf(g.id, FRIEND_GOS).main.map((e) => e.id));
  assert.ok(!rows.includes("phone-macs") && !rows.includes("phone-videos"));
});
ok("the phone's search finds its own settings", () => {
  const first = (q: string, c: Ctx) => searchSettings(q, c)[0]?.e.id;
  assert.equal(first("fingerprint", GOS), "phone-signin");
  assert.equal(first("widget", GOS), "phone-open");
  assert.equal(first("usage access", GOS), "phone-usage");
  assert.equal(first("home screen", MW), "mweb-install");
  assert.equal(first("change project", MW), "mweb-project");
});
ok("every phone row has a control", () => {
  const c = read("src/gos/PhoneRows.tsx");
  // an entry with `parent` is drawn inside its parent's control (phone-bg and phone-fit sit in Background), so it needs no row of its own
  for (const e of SETTINGS.filter((x) => (x.shell || x.id.startsWith("phone-")) && !x.parent)) assert.ok(c.includes(`"${e.id}":`), e.id);
});
ok("no em or en dashes", () => {
  for (const f of ["src/gos/menu.ts", "src/gos/GosLayer.tsx", "src/gos/PhoneRows.tsx", "src/gos/GosSettings.tsx", "src/gos/gos.css", "src/mobile/MobileSettings.tsx", "src/core/settingsindex.ts", "tests/gos-menu.test.ts"])
    assert.doesNotMatch(read(f), new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`), f);
});
console.log(`${n} checks passed`);
