// Run: node --experimental-strip-types tests/phonelooks.test.ts
// V1.56 Saved looks and Reset for the phones (core/phonelooks.ts on the shared store core/looksprofiles.ts). The developer, 13 Nov
// 2026: "save different appearance profiles ... of the GOS or iOS version ... so you can go back to it any point, you
// can rename the appearances as well" and a "reset to default button ... so if you fuck anything up you can reverse it".
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addPage, addTile, defaultPhoneLayout, isDefaultPhone, samePhoneLayout, setLook, setNavEdge, type PhoneLayout } from "../src/core/phonelayout.ts";
import { deleteLook, looksOf, renameLook, restoreLook, saveLook, type LooksStore } from "../src/core/looksprofiles.ts";
import {
  applyPhoneLook, cleanPhoneLookData, currentLookId, looksToSave, phoneDefault, phoneLooks, phoneSnapshot, resetPhone, switchPhoneLook, undoTo,
} from "../src/core/phonelooks.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const T = "2026-11-13T10:00:00.000Z";
let seed = 1;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

/** A phone set up by hand: a page of panels with Meetings and Sleep, the navbar on top, a background. */
function custom(kind: "gos" | "ios" = "gos"): PhoneLayout {
  let l = defaultPhoneLayout(kind, true);
  const p = addPage(l, 3, T, rnd); l = p.layout;
  l = addTile(l, p.id!, "meetings", true, T, rnd).layout;
  l = addTile(l, p.id!, "sleep", true, T, rnd).layout;
  l = setNavEdge(l, "top", T);
  l = setLook(l, null, "bg", "tunnel", T);
  return l;
}

ok("a snapshot is the whole phone layout, checked, without its save time", () => {
  const l = custom();
  const s = phoneSnapshot(l, true);
  assert.equal(s.at, "");
  assert.ok(samePhoneLayout(s, l, true));
  assert.equal(s.nav.edge, "top");
  assert.equal(s.pages.length, 4);
});
ok("a look's data that is not a phone layout is refused", () => {
  assert.equal(cleanPhoneLookData("gos", null), null);
  assert.equal(cleanPhoneLookData("gos", { layout: {}, order: [] }), null);   // a Mac look
  assert.ok(cleanPhoneLookData("gos", { pages: [] }));                     // the built in pages come back
});
ok("putting a look on gives it this phone's kind and a new save time", () => {
  const l = applyPhoneLook(phoneSnapshot(custom("gos"), true), "ios", true, T);
  assert.equal(l.phone, "ios");
  assert.equal(l.at, T);
  assert.equal(l.nav.edge, "top");
});
ok("a GOS only panel in a look never goes onto an iPhone", () => {
  let l = custom("gos");
  const pg = l.pages.find((p) => p.kind === "panels")!.id;
  l = addTile(l, pg, "clipboard", true, T, rnd).layout;
  const on = applyPhoneLook(phoneSnapshot(l, true), "ios", true, T);
  assert.ok(!on.pages.flatMap((p) => p.tiles ?? []).some((t) => t.id.startsWith("clipboard")));
});

ok("save, rename and delete with Undo keep a look exactly", () => {
  const l = custom();
  let store: LooksStore = saveLook({}, "gos", phoneSnapshot(l, true), { name: "Gym days", now: T, rand: rnd }).store;
  const id = looksOf(store, "gos")[0].id;
  store = renameLook(store, "gos", id, "  Work   mode ");
  assert.equal(looksOf(store, "gos")[0].name, "Work mode");
  const d = deleteLook(store, "gos", id);
  assert.equal(looksOf(d.store, "gos").length, 0);
  const back = restoreLook(d.store, d.removed!);
  assert.deepEqual(back, store);
});
ok("switching keeps the setup before as Before switching, and Undo puts it back", () => {
  const before = custom();
  const saved = saveLook({}, "gos", phoneSnapshot(defaultPhoneLayout("gos", true), true), { name: "Plain", now: T, rand: rnd });
  const r = switchPhoneLook(saved.store, before, saved.id!, true, T)!;
  assert.ok(isDefaultPhone(r.layout, true), "the plain look is on");
  const auto = looksOf(r.store, "gos").find((x) => x.auto === "switch")!;
  assert.equal(auto.name, "Before switching");
  assert.equal(auto.id, r.backup);
  const undone = undoTo(r.store, "gos", r.backup, true, T)!;
  assert.ok(samePhoneLayout(undone, before, true), "Undo is the setup from before");
});
ok("Reset goes to PS's own layout and keeps Before reset; only one of each automatic look", () => {
  const l = custom();
  const r1 = resetPhone({}, l, true, T);
  assert.ok(isDefaultPhone(r1.layout, true));
  assert.equal(r1.layout.at, T);
  assert.equal(looksOf(r1.store, "gos").filter((x) => x.auto === "reset").length, 1);
  const c2 = custom();
  const r2 = resetPhone(r1.store, c2, true, T);
  assert.equal(looksOf(r2.store, "gos").filter((x) => x.auto === "reset").length, 1, "never piles up");
  assert.ok(samePhoneLayout(undoTo(r2.store, "gos", r2.backup, true, T)!, c2, true));
  assert.deepEqual(phoneDefault("ios", false, T), { ...defaultPhoneLayout("ios", false), at: T });
});
ok("the look showing now is marked (its save time does not count)", () => {
  const l = custom();
  const s = saveLook({}, "gos", phoneSnapshot(l, true), { name: "Mine", now: T, rand: rnd });
  assert.equal(currentLookId(s.store, { ...l, at: "2027-01-01T00:00:00.000Z" }, true), s.id);
  assert.equal(currentLookId(s.store, defaultPhoneLayout("gos", true), true), null);
});
ok("a phone only ever writes its own kind: the Mac's looks and the other phone's stay", () => {
  const mac = { id: "lmac00001", name: "Desk", at: T, data: { v: 1 } };
  const ios = { id: "lios00001", name: "iPhone", at: T, data: phoneSnapshot(defaultPhoneLayout("ios"), false) };
  const current: LooksStore = { mac: [mac], ios: [ios] };
  const mine = saveLook(current, "gos", phoneSnapshot(custom(), true), { name: "G", now: T, rand: rnd }).store;
  const out = looksToSave(current, mine, "gos");
  assert.deepEqual(out.mac, [mac]);
  assert.deepEqual(out.ios, [ios]);
  assert.equal(out.gos!.length, 1);
  // Bad data in this kind's list is dropped on the way in.
  const bad = looksToSave(current, { gos: [{ id: "lbad00001", name: "Bad", at: T, data: "nope" }] }, "gos");
  assert.deepEqual(bad.gos, []);
  assert.equal(phoneLooks({ gos: [{ id: "lbad00001", name: "Bad", at: T, data: 5 }] }, "gos").length, 0);
});
ok("the Looks panel asks before Reset, says Before reset, and offers Undo on switch, reset and delete", () => {
  const src = read("src/views/PhoneLooks.tsx");
  assert.match(src, /Are you sure\?/);
  assert.match(src, /kept as Before reset/);
  assert.match(src, /say\("Back to the default layout", backTo\(r\.backup\)\)/);
  assert.match(src, /say\(`Now showing \$\{name\}`, backTo\(r\.backup\)\)/);
  assert.match(src, /deleted`, \(\) => \{ void savePhoneLooks\(restoreLook/);
  assert.match(src, /Replace \$\{clash\.name\}\?/);
  // PS on a Mac holds no keys in the Tab list: there the save goes to the main page as a settings patch.
  assert.match(src, /if \(PS\) \{ psPost\(\{ type: "looks", patch: \{ looksSaved: onlyKind\(next, kind\) \} \}\)/);
});
ok("no em or en dashes in the new files", () => {
  for (const f of ["src/core/phonelooks.ts", "src/views/PhoneLooks.tsx", "src/views/phonelooks.css", "src/gos/PhoneEditMode.tsx", "src/gos/phoneeditmode.css", "src/gos/editsfx.ts", "src/gos/phoneedit.ts"])
    assert.ok(!/[\u2013\u2014]/.test(read(f)), f);
});

console.log(`\n${n} passed`);
