// The setup menu's door (G Squad, V1.40). After an update, PS on the Mac offers "See what's new and set it up"
// once (ps-mac Sources/UpdateNudge.swift SetupOffer, Updater.swift offerSetup); a click opens the Tab list and
// fires the event below there. The setup menu itself (views/Welcome.tsx, the gsquad-welcome work) answers it.
// Pure, so tests/setuphook.test.ts runs it with a plain EventTarget; the browser half is src/setuphook.ts.
//
// The contract:
//   window "ps:open-setup" (a CustomEvent, cancelable, detail { from }): open the setup menu now. A listener
//   that opens it calls event.preventDefault(), so the fallback (the What's new panel) stays away.
//   registerSetup(open, { gen }) in src/setuphook.ts does both halves: listens, and tells PS this build has a
//   setup menu of that generation, so PS knows it may offer it after an update (gen 1 = the G Squad menu;
//   raise it when a later menu is worth offering again).

export const SETUP_EVENT = "ps:open-setup";
export type SetupFrom = "update" | "menu" | "test";
export type SetupDetail = { from: SetupFrom };

/** A generation PS accepts: a whole number from 1 to 999, anything else is none (0). */
export function cleanGen(v: unknown): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 999 ? v : 0;
}

/** Where a request came from, from anything (PS hands over a string). */
export function cleanFrom(v: unknown): SetupFrom {
  return v === "update" || v === "menu" || v === "test" ? v : "menu";
}

/** Fires the event on `target`. True when a listener opened the menu (it called preventDefault). */
export function fireSetup(target: EventTarget, from: SetupFrom): boolean {
  const e = new CustomEvent<SetupDetail>(SETUP_EVENT, { cancelable: true, detail: { from } });
  return !target.dispatchEvent(e);
}

/** Listens on `target` and calls `open` (it counts as opened, so the fallback stays away). Returns the undo. */
export function listenSetup(target: EventTarget, open: (d: SetupDetail) => void): () => void {
  const on = (e: Event) => {
    e.preventDefault();
    open({ from: cleanFrom((e as CustomEvent<SetupDetail>).detail?.from) });
  };
  target.addEventListener(SETUP_EVENT, on);
  return () => target.removeEventListener(SETUP_EVENT, on);
}
