// Delete page for the phone layout (V1.57). The developer, 13 Nov 2026: "add a delete page button on the bottom". Pure
// (tests/phonepagedelete.test.ts), used by the Mac's phone canvas (views/PhoneEditor.tsx) and the phone's own Edit mode
// (gos/PhoneEditMode.tsx) through views/PhoneDeletePage.tsx.
//
// A page the phone cannot lose is never deleted, and the button says why instead:
// - the phone's last page (there would be nothing to show),
// - List: it holds your tasks (only that page lists them on the phone),
// - Plan and Inbox: the phone's own pages (meetings; notes and emails), which every phone layout keeps.
// A page of panels can go: its panels are only pictures of things that live elsewhere (no task is ever on a page of
// panels), and Undo puts it back where it was, with its navbar button where it was.
import { removePage, type PhoneLayout, type PhonePage } from "./phonelayout.ts";

/** Why this page cannot be deleted, in the developer's words for the button, or null when it can. */
export function pageDeleteBlock(l: PhoneLayout, id: string): string | null {
  const p = l.pages.find((x) => x.id === id);
  if (!p) return "This page is already gone.";
  if (l.pages.length <= 1) return "This is the phone's last page, so it stays.";
  if (p.kind === "list") return "List holds your tasks, so it always stays. You can move it.";
  if (p.kind === "plan") return "Plan is the phone's own page for your meetings, so it stays. You can move it.";
  if (p.kind === "inbox") return "Inbox is the phone's own page for notes and emails, so it stays. You can move it.";
  return null;
}
/** What the "Are you sure?" says will happen. */
export function pageDeleteSays(p: PhonePage): string {
  const n = p.tiles?.length ?? 0;
  const what = n === 0 ? "It is empty." : n === 1 ? "Its 1 panel goes with it." : `Its ${n} panels go with it.`;
  return `${what} Your tasks stay.`;
}

/** What Undo needs: the page as it was, where it was, and where its navbar button was (-1: it had none). */
export type RemovedPage = { page: PhonePage; index: number; navIndex: number };
/** Delete a page of panels. Nothing happens (removed null) for a page that cannot go (pageDeleteBlock). */
export function deletePage(l: PhoneLayout, id: string, at: string): { layout: PhoneLayout; removed: RemovedPage | null } {
  if (pageDeleteBlock(l, id)) return { layout: l, removed: null };
  const index = l.pages.findIndex((x) => x.id === id);
  const next = removePage(l, id, at);
  if (next === l) return { layout: l, removed: null };
  return { layout: next, removed: { page: l.pages[index], index, navIndex: l.nav.items.indexOf(`page:${id}`) } };
}
/** Undo: the page back at its place (or the nearest one left), its navbar button too. A page with that id that is there
 *  again already (put back some other way) is left as it is. */
export function restorePage(l: PhoneLayout, r: RemovedPage, at: string): PhoneLayout {
  if (l.pages.some((p) => p.id === r.page.id)) return l;
  const pages = [...l.pages];
  pages.splice(Math.max(0, Math.min(pages.length, r.index)), 0, r.page);
  const item = `page:${r.page.id}`;
  let items = l.nav.items;
  if (r.navIndex >= 0 && !items.includes(item)) {
    items = [...items];
    items.splice(Math.max(0, Math.min(items.length, r.navIndex)), 0, item);
  }
  return { ...l, pages, nav: items === l.nav.items ? l.nav : { ...l.nav, items }, at };
}
/** The page to show after one is deleted: the one on its left, else the one on its right, else List. */
export function pageAfterDelete(before: PhoneLayout, id: string): string {
  const i = before.pages.findIndex((p) => p.id === id);
  return before.pages[i - 1]?.id ?? before.pages[i + 1]?.id ?? "list";
}
