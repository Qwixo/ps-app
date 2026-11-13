// The setup menu's door, browser half (the rules and the event are in core/setuphook.ts).
//
// For the setup menu (views/Welcome.tsx): call once when the Tab list page starts,
//   registerSetup((d) => openTheMenu(d.from), { gen: 1 })
// It listens for "ps:open-setup" and tells PS (the Tab list window only) that this build has the setup menu, so after
// an update PS offers "See what's new and set it up" once; a click opens the Tab list and calls window.__psOpenSetup.
// Anything else may open the menu with openSetup("menu").
import { PS, psPost } from "./ps";
import { cleanFrom, cleanGen, fireSetup, listenSetup, type SetupDetail, type SetupFrom } from "./core/setuphook";

export { SETUP_EVENT, type SetupDetail, type SetupFrom } from "./core/setuphook";

const OVERLAY = PS && /\/overlay\/?$/.test(location.pathname);

/** The setup menu says it is here. Returns the undo (it stops listening; PS keeps the generation it was told). */
export function registerSetup(open: (d: SetupDetail) => void, opts: { gen?: number } = {}): () => void {
  const off = listenSetup(window, open);
  const gen = cleanGen(opts.gen ?? 1);
  if (OVERLAY && gen) psPost({ type: "setup:can", gen });
  return off;
}

/** Opens the setup menu. With none (an older build, or not wired yet) the What's new panel opens instead. */
export function openSetup(from: SetupFrom = "menu"): boolean {
  if (fireSetup(window, from)) return true;
  void import("./views/WhatsNew").then((m) => m.openWhatsNew());
  return false;
}

// PS calls this after the "See what's new and set it up" click (ps-mac Updater.swift), once the Tab list is up.
(window as Window & { __psOpenSetup?: (from?: unknown) => boolean }).__psOpenSetup = (from) => openSetup(cleanFrom(from));
