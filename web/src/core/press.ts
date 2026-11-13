// Pressing a task in the Tab list (the developer, 2 Nov 2026: "it takes multiple clicks").
// The whole card counts, not just its words: the card lights up on hover from edge to edge, but
// only the title's own box used to take the click, so a press on the padding above or below the
// words (about 70% of a one line card) did nothing. The press also no longer waits for a click
// event: WebKit drops a click when anything under the pointer changes between mouse down and up
// (the card shrinks a little on press, and new data redraws it). The card turns white on the mouse
// down itself and the action runs on the mouse up, unless the press became a drag.

/** How far the pointer may travel before a press counts as a drag (the drag starts at 6 px too). */
export const PRESS_SLOP = 6;

/** Controls inside a task card that do their own thing (tick, pencil, mini tasks, boxes, links). */
export const ROW_CONTROLS = ".no-drag, input, textarea, select, a, [contenteditable='true'], .mt-panel, button:not(.tm-text)";

/** Does this pointer down start a press on the card? Mouse only: touch keeps the plain click. */
export function pressStarts(o: { button: number; pointerType: string; meta: boolean; onControl: boolean }): boolean {
  return o.button === 0 && o.pointerType === "mouse" && !o.meta && !o.onControl;
}

/** Has the pointer moved far enough to be a drag rather than a press? */
export function pressMoved(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= PRESS_SLOP;
}

/** The click that follows a press the card already acted on is not a second toggle. */
export function clickAlreadyHandled(last: { id: string; at: number } | null, id: string, now: number): boolean {
  return !!last && last.id === id && now - last.at < 800;
}

// ---------- the tick (V1.34, the developer 5 Nov 2026: "when I actually click a task say I did it it sometimes takes a few
// clicks to actually register as a tick") ----------
// Two causes, both fixed here and in views/TaskMap.tsx:
// 1. The tick waited for a click event, and WebKit drops a click whose mouse up lands on another element than its
//    mouse down. On the mouse down the card shrinks (:active scale .985) and, when the floating list was not the
//    front window, its hover slide (translateX 6 px) only starts then too: the round tick moves up to 10 px right
//    under a still pointer, so a press on its left part let go over the card's padding and the click never came.
//    The tick now acts on the mouse up of its own press, wherever the pointer is by then (unless it slid away).
// 2. In PS the floating list sent "tick" (a toggle) to the main window and showed nothing until the whole list came
//    back; a second press in that wait toggled it straight back, so two presses looked like none. The row now shows
//    the tick at once (a pending tick, like "Working on" does), and the message says which way (done true or false),
//    so a repeat is harmless.

/** A press on the tick may wander this far and still count (no drag ever starts on the tick). */
export const TICK_SLOP = 24;
/** A ticked task stays in its place, crossed out, this long before it slides down to Completed. */
export const TICK_STAY_MS = 450;
/** A pending tick the saved list never confirmed is dropped after this long (the row shows the saved value again). */
export const TICK_PEND_MS = 6000;

/** Does this pointer down start a tick press? Mouse only (touch keeps the plain click), never with Cmd (it picks tasks). */
export function tickPressStarts(o: { button: number; pointerType: string; meta: boolean }): boolean {
  return o.button === 0 && o.pointerType === "mouse" && !o.meta;
}
/** Has a tick press slid off far enough to be let go of? */
export function tickMoved(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= TICK_SLOP;
}

/** A tick sent but not yet back in the saved list: which way, and when. */
export type TickPend = { done: boolean; at: number };
/** What the row shows: the pending tick if there is one, else the saved value. */
export function tickShown(saved: boolean, pend: TickPend | undefined): boolean {
  return pend ? pend.done : saved;
}
/** What one press asks for: always the opposite of what the row shows right now. */
export function tickWant(saved: boolean, pend: TickPend | undefined): boolean {
  return !tickShown(saved, pend);
}
/** A task just ticked stays in its place for a moment, crossed out, so the press always shows. */
export function tickStays(pend: TickPend | undefined, now: number): boolean {
  return !!pend && pend.done && now - pend.at < TICK_STAY_MS;
}
/** The pending tick can go: the saved list agrees and the moment in place is over, or it waited too long. */
export function tickSettled(saved: boolean, pend: TickPend, now: number): boolean {
  return (saved === pend.done && !tickStays(pend, now)) || now - pend.at > TICK_PEND_MS;
}
