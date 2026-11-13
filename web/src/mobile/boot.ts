// The mobile web app (cincee.com/todolist-mobile). Imported FIRST by src/mobile/main.tsx, so it runs before the
// vault code: it marks the page as the mobile web app and hands over the project this phone linked
// (src/mobile/link.ts), the same way the Mac app hands over its own (core/project.ts chooseProject).
import { readLinked, saveAccountHint, saveLinked } from "./link";
import { hasLinkFragment, readLinkText } from "./linkcode";

const g = globalThis as { __psMobile?: boolean; __psProject?: unknown };
g.__psMobile = true;

/** Link your iPhone by scan: the Mac's QR code opens this page with the project after the # (never sent to a server).
 *  Read it here, before the project is handed over: a good link is saved, a bad one is said in plain words on the
 *  Connect screen. Either way the # part is taken off the address at once. */
export type FragmentLink = { state: "saved" } | { state: "bad"; message: string } | null;
function takeFragment(): FragmentLink {
  if (typeof location === "undefined" || !hasLinkFragment(location.hash)) return null;
  const r = readLinkText(location.hash);
  try { history.replaceState(null, "", location.pathname + location.search); } catch { /* the address stays: harmless, it is public */ }
  if (!r) return null;
  if ("error" in r) return { state: "bad", message: r.error };
  try { saveLinked(r.ok); saveAccountHint(r.ok.url, r.account); } catch { return { state: "bad", message: "This browser will not keep anything (private browsing?). Open the page normally and scan again." }; }
  return { state: "saved" };
}
/** What the address held when the page opened (the Connect screen and the install guide say so). */
const BAD = "psm.linkbad";
function earlier(): FragmentLink {   // a bad link that arrived while this page was already open: said after the restart
  try { const m = sessionStorage.getItem(BAD); sessionStorage.removeItem(BAD); return m ? { state: "bad", message: m } : null; } catch { return null; }
}
export const fragmentLink: FragmentLink = takeFragment() ?? earlier();

// The Camera app opened the code while this page was already open in Safari: only the # changed, so the page did not
// start again. Take the link, then start it again so the vault opens on the new project (core/vault.ts reads it once).
if (typeof addEventListener === "function") addEventListener("hashchange", () => {
  const r = takeFragment();
  if (!r) return;
  if (r.state === "bad") { try { sessionStorage.setItem(BAD, r.message); } catch { /* storage off */ } }
  location.reload();
});

const linked = readLinked();
if (linked) g.__psProject = linked;
// The phone look from the first paint (src/gos/ CSS is under html.gos, the mobile app's own under html.mweb).
if (typeof document !== "undefined") document.documentElement.classList.add("gos", "mweb");
