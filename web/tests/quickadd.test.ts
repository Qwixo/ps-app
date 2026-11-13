// Quick add (core/quickadd.ts): no priority by default, one add per key press, no double adds, the draft.
import assert from "node:assert/strict";
import { addDraft, addGate, addShape, cleanTitle, enterAction, quickDefaults, revealBy } from "../src/core/quickadd.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const T = "2026-11-04";

ok("the quick form adds a one-off with no date and no priority", () => {
  const o = quickDefaults(T);
  assert.deepEqual(o, { kind: "once", when: "none", date: T, p1: false, place: null, clientId: "", notes: "" });
  assert.deepEqual(addShape(o), { type: "once", repeat: false, due: null, p1: false, unranked: true });
});
ok("Advanced: Priority 1 or a place gives it a priority", () => {
  assert.equal(addShape({ ...quickDefaults(T), p1: true }).unranked, false);
  assert.equal(addShape({ ...quickDefaults(T), p1: true }).p1, true);
  assert.equal(addShape({ ...quickDefaults(T), place: 3 }).unranked, false);
});
ok("Advanced: dates", () => {
  assert.equal(addShape({ ...quickDefaults(T), when: "today" }).due, "today");
  assert.equal(addShape({ ...quickDefaults(T), when: "tomorrow" }).due, "tomorrow");
  assert.equal(addShape({ ...quickDefaults(T), when: "date" }).due, "date");
});
ok("every day and repeating tasks: no rank, no P1, no one-off date", () => {
  const d = addShape({ ...quickDefaults(T), kind: "daily", p1: true, when: "today", place: 2 });
  assert.deepEqual(d, { type: "daily", repeat: false, due: null, p1: false, unranked: false });
  assert.equal(addShape({ ...quickDefaults(T), kind: "repeat" }).repeat, true);
});
ok("titles: pasted line breaks become spaces, trimmed, 500 characters at most", () => {
  assert.equal(cleanTitle("  Call the\nprinter\t "), "Call the printer");
  assert.equal(cleanTitle("   "), "");
  assert.equal(cleanTitle("x".repeat(600)).length, 500);
});
ok("Enter in the name adds once; Cmd or Ctrl+Enter also once (it used to add twice)", () => {
  assert.equal(enterAction({ key: "Enter" }, "title"), "add");
  assert.equal(enterAction({ key: "Enter", metaKey: true }, "title"), "add");
  assert.equal(enterAction({ key: "Enter", ctrlKey: true }, "title"), "add");
  assert.equal(enterAction({ key: "Enter", shiftKey: true }, "title"), null);
  assert.equal(enterAction({ key: "a" }, "title"), null);
});
ok("a held Enter adds nothing more; the phone keyboard still composing waits for the last word", () => {
  assert.equal(enterAction({ key: "Enter", repeat: true }, "title"), null);
  assert.equal(enterAction({ key: "Enter", isComposing: true }, "title"), "defer");
});
ok("in the notes Enter is a new line, Cmd or Ctrl+Enter adds", () => {
  assert.equal(enterAction({ key: "Enter" }, "notes"), null);
  assert.equal(enterAction({ key: "Enter", shiftKey: true }, "notes"), null);
  assert.equal(enterAction({ key: "Enter", metaKey: true }, "notes"), "add");
});
ok("on a button (Advanced, a chip) Enter presses the button; Cmd or Ctrl+Enter adds", () => {
  assert.equal(enterAction({ key: "Enter" }, "other"), null);
  assert.equal(enterAction({ key: "Enter", ctrlKey: true }, "other"), "add");
});
ok("the gate drops the same title twice within 700 ms, nothing else", () => {
  const g = addGate(700);
  assert.equal(g("Book the shoot", 1000), true);
  assert.equal(g("Book the shoot", 1200), false, "a double tap");
  assert.equal(g("Pay the printer", 1250), true, "a different task right after");
  assert.equal(g("Book the shoot", 1300), true, "the same title after another one");
  assert.equal(g("Book the shoot", 2100), true, "the same title later");
});
ok("the draft survives a close", () => {
  addDraft.set("half typed");
  assert.equal(addDraft.get(), "half typed");
  addDraft.set("");
  assert.equal(addDraft.get(), "");
});
ok("the new row is scrolled into the band still visible above the sheet", () => {
  const view = { top: 60, bottom: 400 };
  assert.equal(revealBy({ top: 100, bottom: 150 }, view), 0, "already in view");
  assert.equal(revealBy({ top: 500, bottom: 550 }, view), 550 - 388, "under the sheet: scroll down");
  assert.equal(revealBy({ top: 20, bottom: 70 }, view), 20 - 72, "above the top: scroll up");
  assert.equal(revealBy({ top: 500, bottom: 900 }, view), 0, "taller than the band: leave it");
});
console.log(`quickadd: ${n} passed`);
