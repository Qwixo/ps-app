// Run: node --experimental-strip-types tests/islandcards.test.ts
// V1.55 notifications out of the Dynamic Island (the developer, 12 Nov 2026: "I want it to come out with the dynamic island
// instead, but I also want to be able to customize it in the dynamic island settings. But I want it to be on by
// default. And if it's off then the notification comes on the top right"), which kinds go where ("decide which
// notifications actually pop out the dynamic island and which notifications go on the top"), and the AI chat cards
// going by themselves ("by default it takes fifteen seconds"). The placement, the routing on the Mac and the line's
// animation are native (ps-mac tests/notedrop-test.sh); this checks the settings and what reaches the Mac.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const I = await import("../src/core/island.ts");
const X = await import("../src/core/settingsindex.ts");
const D = await import("../src/core/chatdone.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const base = { todos: [], today: "2026-11-12", mail: 0, leads: 0, event: null };
const S = (island: unknown) => I.islandState({ ...base, settings: { island } as never });
const src = (p: string) => readFileSync(p, "utf8");

// ---------- the main switch ----------
ok("on by default, for every account (nothing saved yet)", () => {
  assert.equal(I.islandPrefs(undefined).cards, true);
  assert.equal(I.islandPrefs({}).cards, true);
  assert.equal(I.ISLAND_DEFAULT.cards, true);
});
ok("only an explicit false switches it off; anything else keeps it on", () => {
  assert.equal(I.islandPrefs({ cards: false }).cards, false);
  for (const v of [true, "false", 0, null, 1, "off", {}]) assert.equal(I.islandPrefs({ cards: v }).cards, true, String(v));
});
ok("it travels to the Mac in the island state, on and off", () => {
  assert.equal(S(undefined).cards, true);
  assert.equal(S({ mode: "pill", idle: "next", cards: false }).cards, false);
  assert.equal(S({ mode: "off", idle: "next", cards: false }).cards, false);
});

// ---------- which kinds go where ----------
ok("every kind comes out of the island by default", () => {
  const p = I.islandPrefs(undefined);
  assert.deepEqual(p.top, []);
  for (const k of I.CARD_KINDS) assert.equal(I.cardPlace(p, k.k), "island", k.k);
});
ok("the kinds match the Mac's (NoteDropCore.swift NoteDrop.kinds)", () => {
  const ks = ["mail", "chats", "leads", "meetings", "network", "mac", "reminders", "update", "helper", "notes", "sound"];
  assert.deepEqual(I.CARD_KINDS.map((x) => x.k), ks);
  const mac = process.env.PS_MAC_DIR || `${process.env.HOME}/Projects/.worktrees/island-notifications`;
  let swift = "";
  try { swift = readFileSync(`${mac}/Sources/NoteDropCore.swift`, "utf8"); } catch { console.log("skip - ps-mac NoteDropCore.swift not found (set PS_MAC_DIR)"); }
  if (swift) assert.ok(swift.includes(`static let kinds = [${ks.map((k) => `"${k}"`).join(", ")}]`), "the same list, in the same order");
});
ok("the pop ups with windows of their own are kinds too: each on Island by default, its other choice its usual place", () => {
  const pops = I.CARD_KINDS.filter((x) => x.pop).map((x) => x.k);
  assert.deepEqual(pops, ["reminders", "update", "helper", "notes", "sound"]);
  const p = I.islandPrefs(undefined);
  for (const k of pops) assert.equal(I.cardPlace(p, k), "island", k);
  const moved = I.withCardPlace(p, "update", "top");
  assert.equal(I.cardPlace(moved, "update"), "top");
  assert.equal(I.cardPlace(moved, "reminders"), "island");
  assert.deepEqual(I.islandPrefs({ top: ["sound", "helper", "bogus"] }).top, ["helper", "sound"]);
  for (const k of pops) assert.equal(I.cardPlace(I.islandPrefs({ cards: false }), k), "top", k);
  assert.ok(I.CARD_KINDS.filter((x) => x.pop).every((x) => !x.red), "everyone gets every pop up choice");
  const c = src("src/views/IslandCards.tsx");
  assert.match(c, /x\.pop \? "Usual place" : "Top right"/);
  assert.match(c, /Pop ups/);
});
ok("a kind sent to the top right goes there; the others stay on the island", () => {
  const p = I.withCardPlace(I.islandPrefs(undefined), "leads", "top");
  assert.deepEqual(p.top, ["leads"]);
  assert.equal(I.cardPlace(p, "leads"), "top");
  assert.equal(I.cardPlace(p, "mail"), "island");
  const back = I.withCardPlace(p, "leads", "island");
  assert.deepEqual(back.top, []);
});
ok("main switch off or the island off: everything goes top right", () => {
  const off = I.islandPrefs({ cards: false });
  const islandOff = I.islandPrefs({ mode: "off", idle: "next" });
  for (const k of I.CARD_KINDS) { assert.equal(I.cardPlace(off, k.k), "top"); assert.equal(I.cardPlace(islandOff, k.k), "top"); }
});
ok("the top right list is cleaned: known kinds, once each, in order", () => {
  assert.deepEqual(I.cardsTop(["meetings", "mail", "mail", "evil", 3, null]), ["mail", "meetings"]);
  assert.deepEqual(I.cardsTop("mail"), []);
  assert.deepEqual(I.islandPrefs({ top: ["chats", "nope"] }).top, ["chats"]);
});
ok("the choice travels to the Mac in the island state", () => {
  assert.deepEqual(S({ mode: "notch", idle: "next", top: ["network", "mac"] }).top, ["network", "mac"]);
  assert.deepEqual(S(undefined).top, []);
});
ok("switching one kind keeps every other island choice", () => {
  const prefs = I.islandPrefs({ mode: "pill", idle: "none", hide: 300, cards: true });
  const next = I.withCardPlace(prefs, "mac", "top");
  assert.deepEqual({ ...next, top: [] }, prefs);
});

// ---------- AI chat cards go by themselves ----------
ok("10 seconds by default (V1.56, was 15), the choices 5, 10, 15, 30 and 60, and Off", () => {
  assert.equal(D.chatFade(undefined), 10);
  for (const v of [5, 10, 15, 30, 60]) assert.equal(D.chatFade(v), v);
  assert.equal(D.chatFade(0), 0);
  for (const v of [7, -1, "15", null, 9999, NaN]) assert.equal(D.chatFade(v), 10, String(v));
});
ok("the chat card carries its time to the Mac; Off carries none (it stays until dismissed)", () => {
  assert.deepEqual(D.chatLife(undefined), { life: 10 });
  assert.deepEqual(D.chatLife(30), { life: 30 });
  assert.deepEqual(D.chatLife(0), {});
  assert.match(src("src/mailcards.ts"), /tone: "done"[^\n]*\n\s*\.\.\.chatLife\(st\.chatFade\)/);
});
ok("only AI chat cards get a time: client emails and lead replies stay until dismissed", () => {
  const m = src("src/mailcards.ts");
  // V1.58: a message from an AI takes the place of its chat's plain card, so it keeps the same time on screen.
  assert.equal((m.match(/chatLife\(/g) || []).length, 2);
  assert.match(m, /tone: "ai"[^\n]*\n[^\n]*\.\.\.chatLife\(st\.chatFade\)/);
});

// ---------- where the developer finds them ----------
ok("the switch and the list live in the Dynamic Island's own settings (the island menu and Settings > Mac)", () => {
  const tm = src("src/views/TaskMap.tsx"), ps = src("src/views/PsSettings.tsx");
  // V1.58: one shared island settings component (views/IslandSettings.tsx) with a Notifications section, shown in the
  // island settings window, Settings > Dynamic Island and the older Mac settings page.
  const isl = src("src/views/IslandSettings.tsx");
  assert.match(isl, /\{ id: "notify", name: "Notifications"/);
  assert.match(isl, /\{PS && <IslandCardsRows prefs=\{prefs\}/);
  assert.match(ps, /<IslandSettingsPage prefs=\{prefs\}/);
  assert.match(tm, /<IslandSettingsWindow /);
  const e = X.settingById("island");
  assert.ok(e && /notifications/.test(e.line) && e.words.includes("notifications"));
});
ok("no second switch anywhere else (one synced setting, never two)", () => {
  assert.equal(X.settingById("island-cards"), undefined);
  assert.doesNotMatch(src("src/views/SettingsGroups.tsx"), /island-cards|IslandCardsRows/);
  assert.doesNotMatch(ps(), /IslandCardsSetting/);
  function ps() { return src("src/views/PsSettings.tsx"); }
});
ok("the list greys out while the switch is off; the developer's own kinds are hidden from everyone else", () => {
  const c = src("src/views/IslandCards.tsx");
  assert.match(c, /const listOn = on && islandOn;/);
  assert.match(c, /ic-kinds\$\{listOn \? "" : " ic-off"\}/);
  assert.match(c, /disabled=\{!listOn\}/);
  assert.match(c, /CARD_KINDS\.filter\(\(x\) => red \|\| !x\.red \|\| \(mail && /);
  assert.deepEqual(I.CARD_KINDS.filter((x) => x.red).map((x) => x.k), ["mail", "leads"]);
});
ok("the AI chat cards' time is with the AI chat finished cards settings, for everyone on a Mac", () => {
  assert.match(src("src/views/SettingsGroups.tsx"), /<ChatFadeRow value=\{fade\} save=\{\(chatFade\) => save\(\{ chatFade \}\)\} \/>/);
  const e = X.settingById("ai-done")!;
  assert.ok(!e.red && X.visibleTo(e, { red: false, where: "mac" as never }));
  assert.ok(e.words.includes("disappear"));
});
ok("plain words, no long dashes", () => {
  for (const f of ["src/views/IslandCards.tsx", "src/views/islandcards.css", "src/core/island.ts", "src/core/chatdone.ts"]) assert.doesNotMatch(src(f), /[–—]/, f);
});
console.log(`${n} passed`);
