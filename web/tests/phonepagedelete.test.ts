// Run: node --experimental-strip-types tests/phonepagedelete.test.ts
// V1.57 Delete page for the phone layout (core/phonepagedelete.ts, views/PhoneDeletePage.tsx): asks first, Undo after,
// never a page the phone cannot lose, and wired into both the Mac's phone canvas and the phone's own Edit mode.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addPage, addTile, defaultPhoneLayout, toggleNav, type PhoneLayout } from "../src/core/phonelayout.ts";
import { deletePage, pageAfterDelete, pageDeleteBlock, pageDeleteSays, restorePage } from "../src/core/phonepagedelete.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const AT = "2026-11-13T12:00:00.000Z";
let seed = 11;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
function withPage(): { l: PhoneLayout; id: string } {
  let l = defaultPhoneLayout("gos", false);
  const r = addPage(l, 2, AT, rnd);
  l = r.layout;
  l = addTile(l, r.id!, "meetings", true, AT, rnd).layout;
  l = addTile(l, r.id!, "sleep", true, AT, rnd).layout;
  l = toggleNav(l, `page:${r.id}`, false, AT);
  return { l, id: r.id! };
}

ok("List, Plan and Inbox are never deleted, each says why; a page of panels can go", () => {
  const { l, id } = withPage();
  assert.match(pageDeleteBlock(l, "list")!, /tasks/);
  assert.match(pageDeleteBlock(l, "plan")!, /stays/);
  assert.match(pageDeleteBlock(l, "inbox")!, /stays/);
  assert.equal(pageDeleteBlock(l, id), null);
  for (const b of ["list", "plan", "inbox"]) { const r = deletePage(l, b, AT); assert.equal(r.removed, null); assert.equal(r.layout, l, "nothing changed"); }
});
ok("the phone's last page is never deleted, and a page already gone says so", () => {
  const one: PhoneLayout = { ...defaultPhoneLayout("ios"), pages: [{ id: "pabcdef12", kind: "panels", name: "Page 2", tiles: [] }] };
  assert.match(pageDeleteBlock(one, "pabcdef12")!, /last page/);
  assert.equal(deletePage(one, "pabcdef12", AT).removed, null);
  assert.match(pageDeleteBlock(one, "pzzzzzz99")!, /gone/);
});
ok("the question says what goes and that tasks stay", () => {
  const { l, id } = withPage();
  const p = l.pages.find((x) => x.id === id)!;
  assert.equal(pageDeleteSays(p), "Its 2 panels go with it. Your tasks stay.");
  assert.equal(pageDeleteSays({ ...p, tiles: [] }), "It is empty. Your tasks stay.");
  assert.equal(pageDeleteSays({ ...p, tiles: p.tiles!.slice(0, 1) }), "Its 1 panel goes with it. Your tasks stay.");
});
ok("delete takes the page and its navbar button; Undo puts both back where they were", () => {
  const { l, id } = withPage();
  const navAt = l.nav.items.indexOf(`page:${id}`);
  assert.ok(navAt >= 0);
  const r = deletePage(l, id, AT);
  assert.ok(r.removed);
  assert.ok(!r.layout.pages.some((p) => p.id === id));
  assert.ok(!r.layout.nav.items.includes(`page:${id}`));
  const back = restorePage(r.layout, r.removed!, AT);
  assert.deepEqual(back.pages.map((p) => p.id), l.pages.map((p) => p.id));
  assert.deepEqual(back.nav.items, l.nav.items);
  assert.deepEqual(back.pages.find((p) => p.id === id)!.tiles, l.pages.find((p) => p.id === id)!.tiles, "its panels too");
  assert.equal(restorePage(back, r.removed!, AT), back, "Undo twice does nothing more");
});
ok("Undo after other changes keeps them, and lands at the nearest place left", () => {
  const { l, id } = withPage();
  const r = deletePage(l, id, AT);
  const fewer: PhoneLayout = { ...r.layout, pages: r.layout.pages.filter((p) => p.id !== "inbox") };
  const back = restorePage(fewer, { ...r.removed!, index: 9 }, AT);
  assert.equal(back.pages[back.pages.length - 1].id, id);
  assert.ok(!back.pages.some((p) => p.id === "inbox"), "the later change stays");
});
ok("after a delete the page on its left shows (else its right, else List)", () => {
  const { l, id } = withPage();
  assert.equal(pageAfterDelete(l, id), "list");
  const first: PhoneLayout = { ...l, pages: [l.pages.find((p) => p.id === id)!, ...l.pages.filter((p) => p.id !== id)] };
  assert.equal(pageAfterDelete(first, id), "plan");
});
ok("wired: Delete page under the page on the Mac and in the phone's bottom row, Undo in both, Esc and back close the question first", () => {
  const mac = read("src/views/PhoneEditor.tsx"), ph = read("src/gos/PhoneEditMode.tsx"), ui = read("src/views/PhoneDeletePage.tsx");
  assert.match(mac, /<DeletePage layout=\{layout\} page=\{page\}[\s\S]{0,300}?onDelete=\{\(\) => delPage\(page\.id\)\}/);
  assert.match(mac, /<UndoDelete key=\{undo\.key\}[\s\S]{0,100}?onUndo=\{undoDel\}/);
  assert.match(mac, /useEsc\(true, \(\) => \{ if \(gal\)[^}]*\} else if \(sure\) \{ sfx\.click\(\); setSure\(null\); \} else onBack\(\); \}\);/);
  assert.match(ph, /<DeletePage phone layout=\{layout\} page=\{page\}[\s\S]{0,300}?onDelete=\{\(\) => delPage\(page\.id\)\}/);
  assert.match(ph, /<UndoDelete phone key=\{undo\.key\}[\s\S]{0,100}?onUndo=\{undoDel\}/);
  assert.match(ph, /else if \(drawer\) setDrawer\(false\);\s*else if \(sure\) setSure\(null\);/);
  assert.match(ui, /<b>Are you sure\?<\/b>/);
  assert.match(ui, /if \(block\) \{ setWhy\(true\);/, "a page that cannot go says why and is not deleted");
  for (const s of [mac, ph, ui, read("src/core/phonepagedelete.ts"), read("src/views/phonedelete.css")]) assert.ok(!/[–—]/.test(s), "no dashes");
});
console.log(`${n} passed`);
