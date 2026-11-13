// Run: node --experimental-strip-types tests/webtodo.test.ts
// V1.44, the developer 8 Nov 2026: "make the web app much better, almost mimicking what the PS app overlay is, in the to-do list
// section of my web app ... The same design as the Tab overlay but in web app form. Something that doesn't require
// all the permissions." The website's To-do page draws the Tab list itself (views/WebTodo.tsx, TaskMap Overlay `web`),
// leaving out only what needs PS on a Mac. Checks the rules (core/webtodo.ts) and the wiring (sources, comments out).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as W from "../src/core/webtodo.ts";
import { SETTINGS, visibleTo } from "../src/core/settingsindex.ts";

const read = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const raw = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };

// ---------- the rules ----------
ok("the web form leaves out exactly the parts that need a Mac", () => {
  assert.deepEqual([...W.WEB_HIDDEN].sort(), ["afk", "glass", "mixer", "net", "screentime", "second", "security"]);
  for (const id of ["clocks", "timelines", "series", "meetings", "dimx", "fitness", "endday", "clipboard", "gear", "gsquad", "dnd",
    "meetnotes", "leftovers", "undo", "overdue"]) assert.ok(W.webShows(id), `${id} shows on the web`);
  for (const id of W.WEB_HIDDEN) assert.equal(W.webShows(id), false, `${id} hidden`);
});
ok("the Get the Mac app note: shown until its x, then away for 30 days; a broken or future time shows it", () => {
  const now = Date.parse("2026-11-08T12:00:00Z"), day = 86400_000;
  assert.equal(W.macNoteShown(null, now), true);
  assert.equal(W.macNoteShown(now - day, now), false);
  assert.equal(W.macNoteShown(now - 29 * day, now), false);
  assert.equal(W.macNoteShown(now - 30 * day, now), true);
  assert.equal(W.macNoteShown(NaN, now), true);
  assert.equal(W.macNoteShown(now + day, now), true);
  assert.match(W.MAC_NOTE.link, /^https:\/\/cincee\.com\/ps-app-mac\/$/);
});
ok("no hash: the developer lands on Today as before, everyone else on their list (the QR code's landing)", () => {
  assert.equal(W.landingPage("", true), "today");
  assert.equal(W.landingPage("", false), "todo");
  assert.equal(W.landingPage("clients", false), "clients");
  assert.equal(W.landingPage("todo", true), "todo");
});
ok("Back: one history entry per open window, taken off again when a window closes some other way", () => {
  assert.equal(W.backPlan(0, 0), null);
  assert.deepEqual(W.backPlan(1, 0), { push: 1 });
  assert.deepEqual(W.backPlan(2, 1), { push: 1 });
  assert.deepEqual(W.backPlan(0, 2), { pop: 2 });
  assert.deepEqual(W.backPlan(1, 2), { pop: 1 });
  assert.equal(W.backPlan(-3, 0), null);
  assert.equal(W.backPlan(1.7, 1), null);
});
ok("Coming up on the web: the Mac's copy with its age, or one plain line, never a Mac only button", () => {
  const now = Date.parse("2026-11-08T12:00:00Z");
  assert.equal(W.webCalLine(null, now).text, W.WEB_CAL_NONE);
  assert.equal(W.webCalLine("not a date", now).text, W.WEB_CAL_NONE);
  assert.equal(W.webCalLine("2026-11-08T11:56:00Z", now).text, "From your Mac's Calendar · 4 min ago");
  assert.equal(W.webCalLine("2026-11-08T11:59:50Z", now).text, "From your Mac's Calendar · just now");
  assert.equal(W.webCalLine("2026-11-08T09:00:00Z", now).text, "From your Mac's Calendar · 3 h ago");
  assert.equal(W.webCalLine("2026-11-06T12:00:00Z", now).text, "From your Mac's Calendar · 2 d ago");
  assert.equal(W.webCalLine(null, now).settings, false);
  assert.equal(W.webCalLine(null, now).turnOn, undefined);
});
ok("G Squad runs in the page on the website only", () => {
  assert.equal(W.webSquadAllowed({ mode: "production", mobileWeb: false }), true);
  assert.equal(W.webSquadAllowed({ mode: "development", mobileWeb: false }), true);
  assert.equal(W.webSquadAllowed({ mode: "ps", mobileWeb: false }), false);
  assert.equal(W.webSquadAllowed({ mode: "gos", mobileWeb: false }), false);
  assert.equal(W.webSquadAllowed({ mode: "production", mobileWeb: true }), false);
});
ok("Settings on the web has Get the Mac app; the Mac never shows it", () => {
  const e = SETTINGS.find((x) => x.id === "mac-app");
  assert.ok(e && e.go === "macApp" && e.group === "about");
  assert.equal(visibleTo(e!, { red: false, where: "web" }), true);
  assert.equal(visibleTo(e!, { red: true, where: "web" }), true);
  assert.equal(visibleTo(e!, { red: false, where: "mac" }), false);
  assert.equal(visibleTo(e!, { red: false, where: "phone" }), false);
  // the Mac only groups stay off the web
  for (const id of ["trigger-key", "island", "afk", "network", "screen-time", "security", "transparency"])
    assert.equal(visibleTo(SETTINGS.find((x) => x.id === id)!, { red: false, where: "web" }), false, `${id} not on the web`);
});

// ---------- the wiring ----------
const tm = read("views/TaskMap.tsx");
const app = read("App.tsx");
ok("the To-do page is the Tab list in web form (the phone's mobile web app keeps its page)", () => {
  assert.match(app, /if \(page === "todo"\) body = MWEB \? <TodoView \/> : <WebTodoView \/>;/);
  assert.match(read("views/WebTodo.tsx"), /<Overlay docked web onClose=\{\(\) => \{\}\} footer=\{<MacNote \/>\} \/>/);
});
ok("the Overlay hides the Mac parts by slot, and shows G Squad on the web", () => {
  for (const id of ["afk", "screentime", "mixer"]) assert.match(tm, new RegExp(`\\{shows\\("${id}"\\) && <Slot id="${id}">`));
  assert.match(tm, /\{\(\(PS && !docked\) \|\| web\) && <Slot id="gsquad"><GSquadButton \/><\/Slot>\}/);
  assert.match(tm, /\{!PS && !web && !isPhoneBuild\(\) && <GSquadChatWeb \/>\}/, "the chat lives in the G Squad window there (V1.47: the phone too)");
  assert.match(tm, /\{!docked && \(<Slot id="glass">/, "Keep overlay and Hover mode stay the Mac's");
  assert.match(tm, /const editable = !docked && !GOS;/, "Edit mode stays the floating list's");
  assert.match(tm, /\{!docked && PS && <Slot id="security">/);
});
ok("looks, backgrounds and rain follow the floating list, not the old docked board", () => {
  assert.match(tm, /const floating = !docked \|\| !!web;/);
  assert.match(tm, /const rainNow = !floating \? "off"/);
  assert.match(tm, /bgLayers\(\{ bg: bgLook, docked: !floating,/);
  assert.match(tm, /const calm = floating && \(/);
  assert.match(tm, /const nb = !floating \|\|/);
  assert.match(app, /useAppearanceEngine\([^\n]*\|\| webTodo\) && s\.status === "unlocked"\)/);
});
ok("Coming up on the web: no island switch, no refresh for anyone but the developer", () => {
  const peek = tm.slice(tm.indexOf("function MeetingsPeek("), tm.indexOf("const useCalStatus"));
  assert.doesNotMatch(peek, /IslandSwitch/);   // V1.58: the island's settings left the Meetings panel (right click on the island, Settings)
  assert.match(peek, /\{!\(web && local\) && (?:<Inner kind="calrefresh">)?<CalRefresh local=\{local\} \/>(?:<\/Inner>)?\}/);
  assert.match(tm, /local=\{!red\} web=\{web\} \/>/);
});
ok("holding Tab in the browser is the developer's only and never on To-do", () => {
  assert.match(app, /\{red && page !== "todo" && <TaskMap \/>\}/);
  assert.equal((app.match(/<TaskMap \/>/g) || []).length, 1);
});
ok("Esc steps back one window on the website too; Back closes the top window", () => {
  assert.match(read("escstart.ts"), /else if \(import\.meta\.env\.MODE !== "gos"\) startEscape\(\{ web: true \}\);/);
  const esc = read("ui/escape.ts");
  assert.match(esc, /e\.key !== "Escape" \|\| !e\.isTrusted \|\| e\.isComposing \|\| !document\.querySelector\("\.tm-web"\)/, "only a real Esc, only on the web To-do page");
  assert.match(read("ui/webback.ts"), /void psEscape\(\)/);
  assert.match(read("views/WebTodo.tsx"), /useEffect\(\(\) => startWebBack\(\), \[\]\);/);
});
ok("G Squad screens read the engine in the page on the website, the copy in PS's Tab list", () => {
  const m = read("squad/mirror.ts");
  assert.match(m, /const local = \(\) => !PS && !mirrorSet;/);
  assert.match(m, /if \(local\(\)\) \{ const c = cleanSquadOp\(o\); if \(c\) void runSquadOp\(c\); return; \}/);
  assert.match(read("views/WebTodo.tsx"), /startWebSquad\(MWEB\)/);
});
ok("the G Squad button keeps its size with no squad yet (Settings' empty search had the same class name)", () => {
  const css = readFileSync(new URL("../src/views/settingsscreen.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /^\.gs-none\b/m);
  assert.match(css, /^\.gs-layer \.gs-none \{/m);
});
ok("the new web files have no em or en dashes", () => {
  for (const f of ["core/webtodo.ts", "views/WebTodo.tsx", "views/webtodo.css", "ui/webback.ts", "squad/webhost.ts"])
    assert.doesNotMatch(raw(f), /[\u2013\u2014]/, f);
});

console.log(`webtodo: ${n} passed`);
