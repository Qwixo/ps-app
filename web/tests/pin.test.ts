// Pinning a screen in the Tab list (core/pinrules.ts, src/ui/pin.ts; the developer 2 Nov 2026). The page side
// (double click, hide and show, restart) is PS's self test area `pin` (ps-mac Sources/PinSelfTest.swift).
import assert from "node:assert/strict";
import { DANGER, INTERACTIVE, NOT_SCREEN, SCREEN_SEL, keyOf, launchFrom, parsePin } from "../src/core/pinrules.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const el = (tag: string, cls: string[], label: string | null = null) => ({ tagName: tag.toUpperCase(), classList: cls, getAttribute: (k: string) => (k === "aria-label" ? label : null) });

ok("a screen's name ignores state classes, so open, closing or peeking is the same screen", () => {
  assert.equal(keyOf(el("section", ["cs-win", "nm-win"], "Network monitor")), keyOf(el("section", ["nm-win", "cs-win", "open"], "Network monitor")));
  assert.equal(keyOf(el("div", ["tm-pop", "mix-pop", "s-busy"], "Volume mixer")), "div.mix-pop.tm-pop|Volume");
  assert.notEqual(keyOf(el("section", ["cs-win", "nm-win"])), keyOf(el("section", ["cs-win", "mac-win"])));
});
ok("dialogs, pop-ups and labelled panels are screens; side panels and the task list are not", () => {
  for (const s of ["[role='dialog']", "[data-pin-screen]", ".tm-pop", "aside[aria-label]"]) assert.ok(SCREEN_SEL.includes(s), s);
  for (const s of [".tm-aware", ".tm-meet", ".tm-list"]) assert.ok(NOT_SCREEN.includes(s), s);
  assert.ok(INTERACTIVE.startsWith("button,"), "double clicking a button on the bar never pins");
});
ok("opened by a click: that button (and the one before, eg the gear then Mac settings)", () => {
  const r = [{ sel: "a", at: 100 }, { sel: "gear", at: 2000 }, { sel: "mac", at: 2400 }];
  assert.deepEqual(launchFrom(r, 2450, "own"), { mode: "click", steps: ["gear", "mac"], owner: "own" });
  assert.deepEqual(launchFrom([{ sel: "b", at: 1000 }], 1200, "o").steps, ["b"]);
});
ok("no click just before it: it opened on hover, so a restart hovers its owner", () => {
  assert.deepEqual(launchFrom([{ sel: "old", at: 0 }], 5000, "div.tm-tl"), { mode: "hover", steps: [], owner: "div.tm-tl" });
  assert.equal(launchFrom([], 10, "x").mode, "hover");
});
ok("risky buttons are never replayed after a restart", () => {
  for (const t of ["Delete", "Reset the list", "End my day", "Unpair", "Shut down", "Send"]) assert.ok(DANGER.test(t), t);
  for (const t of ["Numerology", "Network monitor", "Settings", "Map"]) assert.ok(!DANGER.test(t), t);
});
ok("a stored pin is checked before use", () => {
  const good = JSON.stringify({ key: "section.nu-win|Numerology", launch: { mode: "click", steps: ["a", "b", "c"], owner: "o" }, at: 5 });
  assert.deepEqual(parsePin(good), { key: "section.nu-win|Numerology", launch: { mode: "click", steps: ["b", "c"], owner: "o" }, at: 5 });
  assert.equal(parsePin(null), null);
  assert.equal(parsePin("{"), null);
  assert.equal(parsePin(JSON.stringify({ key: "", launch: { mode: "click" } })), null);
  assert.equal(parsePin(JSON.stringify({ key: "x", launch: { mode: "drag" } })), null);
});
console.log(`${n} of ${n} ok`);
