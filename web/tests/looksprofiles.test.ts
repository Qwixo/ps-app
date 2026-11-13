// Run: node --experimental-strip-types tests/looksprofiles.test.ts
// V1.56 Saved looks (core/looksprofiles.ts, core/maclook.ts): save, rename, switch, delete with undo, reset with an
// automatic backup, device kinds kept apart, and what a Mac look holds and puts back (never tasks).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AUTO_NAMES, LOOKS_MAX, backupLook, canSaveMore, cleanLooksStore, deleteLook, findLook, lookNamed, looksOf, mergeLooksKinds, nextLookName,
  onlyKind, renameLook, replaceLook, restoreLook, saveLook, tidyLookName, type LooksStore,
} from "../src/core/looksprofiles.ts";
import { applyMacLook, cleanLookData, cleanMacLook, macDefault, macPreview, macSnapshot, type MacLook } from "../src/core/maclook.ts";
import type { TabLayout } from "../src/core/tablayout.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
let seed = 1;
const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
const T = (m: number) => `2026-11-13T10:${String(m).padStart(2, "0")}:00.000Z`;

ok("save: Look 1, Look 2 ... a name of your own, a name already used is found (the menu asks first)", () => {
  let s: LooksStore = {};
  assert.equal(nextLookName(s, "mac"), "Look 1");
  const a = saveLook(s, "mac", { x: 1 }, { now: T(1), rand }); s = a.store;
  assert.ok(a.id && /^l[a-z0-9]{8}$/.test(a.id));
  assert.equal(looksOf(s, "mac")[0].name, "Look 1");
  s = saveLook(s, "mac", { x: 2 }, { now: T(2), rand }).store;
  assert.deepEqual(looksOf(s, "mac").map((x) => x.name), ["Look 1", "Look 2"]);
  s = saveLook(s, "mac", { x: 3 }, { name: "  Focus   mode ", now: T(3), rand }).store;
  assert.equal(looksOf(s, "mac")[2].name, "Focus mode");
  assert.equal(nextLookName(s, "mac"), "Look 4");
  assert.equal(lookNamed(s, "mac", "focus MODE")?.name, "Focus mode");
  assert.equal(lookNamed(s, "mac", "Something else"), null);
  assert.equal(tidyLookName("   "), null);
  assert.equal(tidyLookName("x".repeat(80))?.length, 32);
});

ok("saving over a look asks first, then keeps its place (and its name unless a new one is given)", () => {
  let s = saveLook({}, "mac", { v: "old" }, { name: "Work", now: T(1), rand }).store;
  s = saveLook(s, "mac", { v: "b" }, { name: "Play", now: T(2), rand }).store;
  const id = lookNamed(s, "mac", "work")!.id;
  s = replaceLook(s, "mac", id, { v: "new" }, T(5));
  assert.deepEqual(looksOf(s, "mac").map((x) => [x.name, x.data, x.at]), [["Work", { v: "new" }, T(5)], ["Play", { v: "b" }, T(2)]]);
});

ok("rename: double click or the pencil; an empty name changes nothing", () => {
  let s = saveLook({}, "mac", {}, { now: T(1), rand }).store;
  const id = looksOf(s, "mac")[0].id;
  s = renameLook(s, "mac", id, "Evening");
  assert.equal(findLook(s, "mac", id)?.name, "Evening");
  assert.equal(renameLook(s, "mac", id, "   "), s);
  assert.equal(renameLook(s, "mac", "lnothere1", "X"), s);
});

ok("delete with Undo: back exactly where it was", () => {
  let s: LooksStore = {};
  for (const name of ["A", "B", "C"]) s = saveLook(s, "mac", { name }, { name, now: T(1), rand }).store;
  const b = lookNamed(s, "mac", "B")!;
  const d = deleteLook(s, "mac", b.id);
  assert.deepEqual(looksOf(d.store, "mac").map((x) => x.name), ["A", "C"]);
  assert.ok(d.removed);
  const back = restoreLook(d.store, d.removed!);
  assert.deepEqual(looksOf(back, "mac").map((x) => x.name), ["A", "B", "C"]);
  assert.equal(restoreLook(back, d.removed!), back, "never twice");
  // Every look deleted: the kind stays as an empty list, so the vault merge knows they are gone.
  let one = saveLook({}, "gos", {}, { now: T(1), rand }).store;
  one = deleteLook(one, "gos", looksOf(one, "gos")[0].id).store;
  assert.deepEqual(one.gos, []);
});

ok("switch and reset save the setup first as Before switching or Before reset, only the newest of each", () => {
  let s = saveLook({}, "mac", { mine: 1 }, { now: T(1), rand }).store;
  s = backupLook(s, "mac", { was: 1 }, "switch", T(2), rand).store;
  s = backupLook(s, "mac", { was: 2 }, "switch", T(3), rand).store;
  const r = backupLook(s, "mac", { was: 3 }, "reset", T(4), rand); s = r.store;
  const all = looksOf(s, "mac");
  assert.deepEqual(all.map((x) => [x.name, x.auto ?? null]), [["Look 1", null], [AUTO_NAMES.switch, "switch"], [AUTO_NAMES.reset, "reset"]]);
  assert.deepEqual(all[1].data, { was: 2 }, "only the newest Before switching");
  assert.deepEqual(findLook(s, "mac", r.id)?.data, { was: 3 });
  // They never count against your own looks, and renaming one makes it yours.
  assert.equal(nextLookName(s, "mac"), "Look 2");
  const kept = renameLook(s, "mac", r.id, "Old layout");
  assert.equal(findLook(kept, "mac", r.id)?.auto, undefined);
  assert.equal(backupLook(kept, "mac", {}, "reset", T(9), rand).store.mac!.length, 4, "a renamed backup is never replaced");
});

ok("at most twelve of your own per device kind", () => {
  let s: LooksStore = {};
  for (let i = 0; i < LOOKS_MAX; i++) s = saveLook(s, "mac", { i }, { now: T(i), rand }).store;
  assert.equal(canSaveMore(s, "mac"), false);
  const r = saveLook(s, "mac", {}, { now: T(30), rand });
  assert.equal(r.id, null);
  assert.equal(canSaveMore(s, "gos"), true);
  assert.equal(backupLook(s, "mac", {}, "reset", T(31), rand).store.mac!.length, LOOKS_MAX + 1, "the automatic one still goes in");
});

ok("device kinds stay apart: the Mac only sees and only sends Mac looks; a save never overwrites the phones'", () => {
  let s = saveLook({}, "mac", { k: "mac" }, { name: "Desk", now: T(1), rand }).store;
  s = saveLook(s, "gos", { k: "gos" }, { name: "Pixel", now: T(1), rand }).store;
  s = saveLook(s, "ios", { k: "ios" }, { name: "iPhone", now: T(1), rand }).store;
  assert.deepEqual(looksOf(s, "mac").map((x) => x.name), ["Desk"]);
  assert.deepEqual(looksOf(s, "gos").map((x) => x.name), ["Pixel"]);
  assert.equal(lookNamed(s, "mac", "Pixel"), null);
  const sent = onlyKind(saveLook(s, "mac", {}, { name: "Desk 2", now: T(2), rand }).store, "mac");
  assert.deepEqual(Object.keys(sent), ["mac"]);
  // The vault meanwhile got a new phone look from the phone: the Mac's save keeps it.
  const vault = saveLook(s, "gos", { k: "gos2" }, { name: "Pixel 2", now: T(3), rand }).store;
  const merged = mergeLooksKinds(vault, sent);
  assert.deepEqual(looksOf(merged, "mac").map((x) => x.name), ["Desk", "Desk 2"]);
  assert.deepEqual(looksOf(merged, "gos").map((x) => x.name), ["Pixel", "Pixel 2"]);
  assert.deepEqual(looksOf(merged, "ios").map((x) => x.name), ["iPhone"]);
});

ok("from the vault: only well formed looks, each checked by its device's cleaner", () => {
  const raw = {
    mac: [
      { id: "labcdefgh", name: "Good", at: T(1), data: { v: 1, layout: { pos: {}, hidden: [], at: "" }, pages: [], order: ["main"], look: { look: "midnight" } } },
      { id: "BAD", name: "Bad id", at: T(1), data: {} },
      { id: "lzzzzzzzz", name: "Not a Mac look", at: T(1), data: { hello: 1 } },
      { id: "lyyyyyyyy", name: "", at: T(1), data: {} },
    ],
    gos: [{ id: "lgosgosgo", name: "Phone", at: T(1), data: { cards: 3 } }],
    windows: [{ id: "lwinwinwi", name: "x", at: T(1), data: {} }],
  };
  const c = cleanLooksStore(raw, cleanLookData);
  assert.deepEqual(looksOf(c, "mac").map((x) => x.name), ["Good"]);
  assert.deepEqual(looksOf(c, "gos").map((x) => x.name), ["Phone"]);
  assert.equal("windows" in c, false);
  assert.deepEqual(cleanLooksStore(null), {});
});

// ---------- what a Mac look holds ----------
const layoutA: TabLayout = { pos: { clocks: { x: 0.1, y: 0.8, w: 300, h: 60 } }, hidden: ["sleep"], at: T(1), page: { meetings: "pp1abcdefg" } };
const st = {
  look: "midnight", tmBg: "storm", lookAccent: { midnight: "#FF0000" },
  tmPages: [
    { id: "work1abcde", name: "Work", secs: ["g:abc"], bg: "rain" },
    { id: "pp1abcdefg", name: "Page 2", secs: [], kind: "panels" as const },
  ],
  tmPageOrder: ["work1abcde", "main", "pp1abcdefg"],
  tmMuted: true,
};

ok("a Mac look: pages, panels and their places and sizes, each page's background and look, the main look; never tasks", () => {
  const l = macSnapshot(st, layoutA);
  assert.equal(l.v, 1);
  assert.deepEqual(l.layout.pos, layoutA.pos);
  assert.deepEqual(l.look, { look: "midnight", tmBg: "storm", lookAccent: { midnight: "#FF0000" } }, "only appearance, not sounds or anything else");
  assert.deepEqual(l.pages.find((p) => p.id === "work1abcde"), { id: "work1abcde", name: "Work", secs: [], bg: "rain" }, "a list only by its look, never its sections");
  assert.deepEqual(l.pages.find((p) => p.id === "pp1abcdefg"), st.tmPages[1]);
  assert.deepEqual(l.order, ["work1abcde", "main", "pp1abcdefg"]);
  assert.deepEqual(cleanMacLook(JSON.parse(JSON.stringify(l))), l, "survives the vault");
  const pv = macPreview(l);
  assert.equal(pv.pages, 3); assert.equal(pv.main, 1); assert.equal(pv.boxes.length, 1);
});

ok("switching puts the look back; lists made since (with tasks) stay, at the end", () => {
  const saved = macSnapshot(st, layoutA);
  // Since then: Page 2 deleted, a new list made, the Work list's background changed, the layout reset, a new look.
  const now = { look: "light", tmBg: "none", tmPages: [{ id: "work1abcde", name: "Work", secs: ["g:abc"], bg: "sun", look: "paper" }, { id: "new1abcdef", name: "Gym", secs: ["g:x"] }], tmPageOrder: ["main", "work1abcde", "new1abcdef"] };
  const a = applyMacLook(now, saved, T(9));
  assert.equal(a.patch.look, "midnight"); assert.equal(a.patch.tmBg, "storm");
  const work = a.patch.tmPages!.find((p) => p.id === "work1abcde")!;
  assert.deepEqual(work, { id: "work1abcde", name: "Work", secs: ["g:abc"], bg: "rain" }, "its sections (tasks) stay, its own look comes back");
  assert.ok(a.patch.tmPages!.some((p) => p.id === "new1abcdef"), "a list made since is never deleted");
  assert.ok(a.patch.tmPages!.some((p) => p.id === "pp1abcdefg" && p.kind === "panels"), "the page of panels is back");
  assert.deepEqual(a.patch.tmPageOrder, ["work1abcde", "main", "pp1abcdefg", "new1abcdef"]);
  assert.deepEqual(a.layout.pos, layoutA.pos); assert.deepEqual(a.layout.page, layoutA.page); assert.equal(a.layout.at, T(9));
});

ok("Reset to default: every panel back on the main page, no pages of panels, lists keep their tasks", () => {
  const d = macDefault(st, T(7));
  assert.deepEqual(d.layout, { pos: {}, hidden: [], at: T(7) });
  assert.deepEqual(d.patch.tmPages, [{ id: "work1abcde", name: "Work", secs: ["g:abc"] }]);
  assert.deepEqual(d.patch.tmPageOrder, ["work1abcde", "main"]);
  // ...and the setup before it is kept, so Undo (or the Before reset look) brings it all back.
  const b = backupLook({}, "mac", macSnapshot(st, layoutA), "reset", T(7), rand);
  const back = applyMacLook({ ...st, ...d.patch }, findLook<MacLook>(b.store, "mac", b.id)!.data, T(8));
  assert.deepEqual(back.patch.tmPageOrder, ["work1abcde", "main", "pp1abcdefg"]);
  assert.deepEqual(back.layout.pos, layoutA.pos);
});

ok("the vault keeps it: settings.looksSaved merged per device kind, Edit mode sounds saved", () => {
  const ps = readFileSync(new URL("../src/ps.ts", import.meta.url), "utf8");
  assert.match(ps, /o\.looksSaved = mergeLooksKinds\(settingsData\(vaultStore\.get\(\)\)\.looksSaved, cleanLooksStore\(p\.looksSaved, cleanLookData\)\)/);
  assert.match(ps, /if \(typeof p\.editSounds === "boolean"\) o\.editSounds = p\.editSounds;/);
  const em = readFileSync(new URL("../src/views/EditMode.tsx", import.meta.url), "utf8");
  assert.match(em, /looksSaved: onlyKind\(next, "mac"\)/, "the Mac sends only its own looks");
  assert.match(em, /backupLook\(storeNow\(\), "mac", snapNow\(\), "switch", at\(\)\)/);
  assert.match(em, /backupLook\(storeNow\(\), "mac", snapNow\(\), "reset", at\(\)\)/);
});

ok("no em or en dashes", () => {
  for (const f of ["core/looksprofiles.ts", "core/maclook.ts"]) assert.doesNotMatch(readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8"), /[–—]/, f);
});

console.log(`\n${n} passed`);
