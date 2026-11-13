// V1.43 No stray highlighting, the keyboard half (the mouse half is src/ui/noselect.css).
// Cmd A (Ctrl A off the Mac) inside a text box selects its words as usual. Anywhere else it never paints the whole
// screen: inside an area marked "selectable" (a chat message, an email being replied to) it selects only that area,
// otherwise it selects nothing. Started once by every entry (main.tsx, gos/main.tsx, mobile/main.tsx).

/** A place where typing happens: Cmd A there is the browser's own. */
export function isTextBox(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !/^(checkbox|radio|range|button|submit|reset|color|file|image|hidden)$/i.test(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}

/** True for Cmd A on a Mac (Ctrl A elsewhere), with no other key held. */
export function isSelectAll(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }, mac: boolean): boolean {
  if (e.altKey || e.shiftKey || e.key.toLowerCase() !== "a") return false;
  return mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

let started = false;
export function startNoSelect(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  const mac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
  window.addEventListener("keydown", (e) => {
    if (!isSelectAll(e, mac)) return;
    const target = e.target instanceof Element ? e.target : null;
    if (isTextBox(target) || isTextBox(document.activeElement)) return;
    e.preventDefault();
    const sel = window.getSelection();
    if (!sel) return;
    const at = sel.anchorNode;
    const area = (at instanceof Element ? at : at?.parentElement)?.closest(".selectable") ?? target?.closest(".selectable");
    if (!area) { sel.removeAllRanges(); return; }
    const r = document.createRange();
    r.selectNodeContents(area);
    sel.removeAllRanges();
    sel.addRange(r);
  }, true);
}
