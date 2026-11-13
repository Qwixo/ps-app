// Quick add (V1.33, the developer 4 Nov 2026: "it should be EASY to fire away new tasks to add them without having to go
// through all these task settings, maybe add an 'Advanced' button to hide most of the settings, then auto put every
// task priority-less"). The Add task window (views/TaskMap.tsx AddTaskWindow) opens with only the name field;
// Enter, the phone keyboard's Go or Add adds, clears and stays open for the next one. Advanced holds the rest
// (notes, how often, when, priority, client) for the one task being typed, and is closed every time it opens.
// The pure parts live here so they can be tested without a page.

/** The Advanced settings for one task. The defaults are the quick form: one-off, no date, no priority, no client. */
export type AddOpts = {
  kind: "once" | "daily" | "repeat";
  when: "today" | "tomorrow" | "none" | "date";
  date: string;               // used when `when` is "date"
  p1: boolean;                // Priority 1
  place: number | null;       // a place in the numbered list; null = no priority
  clientId: string;           // "" = no client
  notes: string;
};
export const quickDefaults = (today: string): AddOpts => ({ kind: "once", when: "none", date: today, p1: false, place: null, clientId: "", notes: "" });

/** The title as it is saved: pasted line breaks and tabs become spaces, trimmed, at most 500 characters. */
export function cleanTitle(s: string): string {
  return s.replace(/[\r\n\t]+/g, " ").trim().slice(0, 500);
}

/** What the options mean for the saved task. `unranked` = no priority: it shows no P number and waits below the
 *  numbered tasks until it is dragged among them (core/prio.ts). Every day and repeating tasks have no rank at all. */
export function addShape(o: AddOpts): { type: "once" | "daily"; repeat: boolean; due: "today" | "tomorrow" | "date" | null; p1: boolean; unranked: boolean } {
  const daily = o.kind !== "once";
  const due = o.kind === "once" && o.when !== "none" ? o.when : null;
  const p1 = !daily && o.p1;
  return { type: daily ? "daily" : "once", repeat: o.kind === "repeat", due, p1, unranked: !daily && !p1 && o.place === null };
}

/** What a key press in the window does. One answer per press, so one press can never add twice (Cmd or Ctrl+Enter
 *  in the name field used to add the same task twice). "defer": the phone keyboard is still composing the last word,
 *  so add once that word has landed in the field. Shift+Enter in the name and a held Enter (key repeat) do nothing;
 *  in the notes Enter is a new line, and on a button or a menu Enter presses it; there Cmd or Ctrl+Enter adds. */
export function enterAction(e: { key: string; shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; repeat?: boolean; isComposing?: boolean }, where: "title" | "notes" | "other"): "add" | "defer" | null {
  if (e.key !== "Enter" || e.repeat) return null;
  const mod = !!(e.metaKey || e.ctrlKey);
  if (where === "title" ? e.shiftKey && !mod : !mod) return null;
  return e.isComposing ? "defer" : "add";
}

/** Drops a second add of the same title within `ms` (a double tap on Add, an Enter and a Go from the phone keyboard
 *  for one press, a click that arrives twice). A different title, or the same one later, always goes through. */
export function addGate(ms = 700) {
  let last = "", at = -Infinity;
  return (title: string, now: number): boolean => {
    if (title === last && now - at < ms) return false;
    last = title; at = now;
    return true;
  };
}

/** What was typed but not added when the window closed (Esc, back, a tap outside): it is there again next time. */
let draft = "";
export const addDraft = { get: () => draft, set: (s: string) => { draft = s.slice(0, 500); } };

/** How far to scroll the list so the newly added row sits in the part of the list still visible above the
 *  window (the phone's sheet covers the bottom). 0 = it is already in view. `view` is the visible band. */
export function revealBy(row: { top: number; bottom: number }, view: { top: number; bottom: number }, pad = 12): number {
  if (view.bottom - view.top < row.bottom - row.top + pad * 2) return 0;   // no room to show it: leave the list alone
  if (row.bottom > view.bottom - pad) return row.bottom - (view.bottom - pad);
  if (row.top < view.top + pad) return row.top - (view.top + pad);
  return 0;
}
