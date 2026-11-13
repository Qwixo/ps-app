// Pressing a task in the Tab list (core/press.ts, the developer 2 Nov 2026: "it takes multiple clicks").
// The real mouse check is PS's self test area `pin` (ps-mac Sources/PinSelfTest.swift): a press on
// the card's padding turns it white on the mouse down and counts on the mouse up.
import assert from "node:assert/strict";
import { PRESS_SLOP, ROW_CONTROLS, clickAlreadyHandled, pressMoved, pressStarts } from "../src/core/press.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };

ok("a plain left mouse press anywhere on the card starts a press", () => {
  assert.equal(pressStarts({ button: 0, pointerType: "mouse", meta: false, onControl: false }), true);
});
ok("not with Cmd (picks tasks), the right button, touch, or on a control", () => {
  assert.equal(pressStarts({ button: 0, pointerType: "mouse", meta: true, onControl: false }), false);
  assert.equal(pressStarts({ button: 2, pointerType: "mouse", meta: false, onControl: false }), false);
  assert.equal(pressStarts({ button: 0, pointerType: "touch", meta: false, onControl: false }), false);
  assert.equal(pressStarts({ button: 0, pointerType: "mouse", meta: false, onControl: true }), false);
});
ok("the tick, pencil, mini tasks and boxes keep their own clicks; the title does not", () => {
  for (const c of [".no-drag", "input", "textarea", "a", ".mt-panel", "button:not(.tm-text)"]) assert.ok(ROW_CONTROLS.includes(c), c);
  assert.ok(!/(^|,\s*)button(,|$)/.test(ROW_CONTROLS), "a bare button would exclude the title itself");
});
ok("a trackpad wobble is still a press; 6 px is a drag, like the drag itself", () => {
  assert.equal(PRESS_SLOP, 6);
  assert.equal(pressMoved(2, 3), false);
  assert.equal(pressMoved(0, 6), true);
  assert.equal(pressMoved(5, 4), true);
});
ok("the click after a handled press is not a second toggle, but the next press is", () => {
  const last = { id: "t1", at: 1000 };
  assert.equal(clickAlreadyHandled(last, "t1", 1100), true);
  assert.equal(clickAlreadyHandled(last, "t2", 1100), false, "another task");
  assert.equal(clickAlreadyHandled(last, "t1", 1900), false, "much later");
  assert.equal(clickAlreadyHandled(null, "t1", 1100), false, "keyboard or touch: no press came first");
});
console.log(`${n} of ${n} ok`);

// ---------- the tick (V1.34): one press is one tick, every time ----------
import { TICK_PEND_MS, TICK_SLOP, TICK_STAY_MS, tickMoved, tickPressStarts, tickSettled, tickShown, tickStays, tickWant, type TickPend } from "../src/core/press.ts";
let m = 0;
const ok2 = (name: string, fn: () => void) => { fn(); m++; console.log("ok -", name); };

// The press as TaskMap.tsx runs it: the pointer down starts it, the pointer up (wherever it lands) counts once, and
// the click WebKit may or may not send after it is not a second tick. sends: what goes to the main window.
function machine(saved0: boolean) {
  let saved = saved0, pend: TickPend | undefined, pressed: { id: string; at: number } | null = null, t = 1000;
  const sends: boolean[] = [];
  const act = () => { const want = tickWant(saved, pend); pend = { done: want, at: t }; sends.push(want); };
  return {
    sends, now: () => t, wait: (ms: number) => { t += ms; if (pend && tickSettled(saved, pend, t)) pend = undefined; },
    shown: () => tickShown(saved, pend),
    /** The main window saved it and the list came back. */
    back: () => { saved = sends[sends.length - 1]; if (pend && tickSettled(saved, pend, t)) pend = undefined; },
    /** A mouse press: down, then up after a while, the up maybe on another element (the card shrank), then maybe a click. */
    press: (o: { dx?: number; click?: boolean } = {}) => {
      if (!tickPressStarts({ button: 0, pointerType: "mouse", meta: false })) return;
      if (tickMoved(o.dx ?? 0, 0)) return;
      pressed = { id: "t1", at: t }; act();
      if (o.click && !clickAlreadyHandled(pressed, "t1", t + 5)) act();
    },
  };
}
ok2("a press counts on its own mouse up, even when WebKit sends no click (the old miss)", () => {
  const k = machine(false);
  k.press({ click: false });
  assert.deepEqual(k.sends, [true]);
  assert.equal(k.shown(), true, "ticked on screen at once, before the main window answers");
});
ok2("and the click WebKit does send after it is not a second tick", () => {
  const k = machine(false);
  k.press({ click: true });
  assert.deepEqual(k.sends, [true]);
});
ok2("ten presses in a row, each with a slow round trip: every one ticks or unticks exactly once", () => {
  const k = machine(false);
  for (let i = 0; i < 10; i++) {
    const before = k.shown();
    k.press({ click: i % 2 === 0 });
    assert.equal(k.shown(), !before, `press ${i + 1} shows at once`);
    k.wait(900); k.back(); k.wait(10);
    assert.equal(k.shown(), !before, `press ${i + 1} still shows after the list came back`);
  }
  assert.deepEqual(k.sends, [true, false, true, false, true, false, true, false, true, false]);
});
ok2("every message says which way, so a repeat or a late one can never undo a tick", () => {
  const k = machine(false);
  k.press(); k.press();   // two presses before the main window answered: ticked, then deliberately unticked
  assert.deepEqual(k.sends, [true, false], "what the row showed each time, never a blind toggle");
});
ok2("a trackpad wobble still counts; sliding well off is let go", () => {
  assert.equal(TICK_SLOP, 24);
  const k = machine(false);
  k.press({ dx: 10 }); assert.deepEqual(k.sends, [true]);
  k.press({ dx: 30 }); assert.deepEqual(k.sends, [true], "slid away: nothing");
  assert.equal(tickPressStarts({ button: 2, pointerType: "mouse", meta: false }), false, "right click opens the menu instead");
  assert.equal(tickPressStarts({ button: 0, pointerType: "mouse", meta: true }), false, "Cmd picks the task");
  assert.equal(tickPressStarts({ button: 0, pointerType: "touch", meta: false }), false, "touch keeps the plain click");
});
ok2("a tick stays in its place a moment, crossed out, then may move; a pending tick never outlives 6 s", () => {
  const p = { done: true, at: 0 };
  assert.equal(tickStays(p, 100), true);
  assert.equal(tickStays(p, TICK_STAY_MS), false);
  assert.equal(tickStays({ done: false, at: 0 }, 100), false, "an untick moves at once");
  assert.equal(tickSettled(true, p, 100), false, "saved, but still in its moment in place");
  assert.equal(tickSettled(true, p, TICK_STAY_MS), true);
  assert.equal(tickSettled(false, p, TICK_PEND_MS - 1), false, "not saved yet: keeps showing the tick");
  assert.equal(tickSettled(false, p, TICK_PEND_MS + 1), true, "the save never came back: the row shows the truth again");
});
console.log(`${m} of ${m} tick checks ok`);
