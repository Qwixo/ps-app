// No browser right click menu anywhere in PS (V1.34, the developer 5 Nov 2026: "currently it just says reload which I don't
// like"). WebKit's own menu in PS offered only Reload, which reloads the whole page under the Tab list. Tasks have
// PS's own menu (views/TaskMenu.tsx); everywhere else a right click does nothing, except in a text box, where the
// usual Cut, Copy and Paste stay. (ps-mac also takes Reload out of every WebKit menu, for its native cards.)
export function keepsNativeMenu(t: EventTarget | null): boolean {
  const el = t instanceof Element ? t : null;
  if (!el) return false;
  if (el.closest("textarea, [contenteditable='true'], [contenteditable='']")) return true;
  const input = el.closest("input");
  return !!input && !["checkbox", "radio", "range", "button", "submit", "color", "file", "image", "reset"].includes((input as HTMLInputElement).type);
}
export function startNoContextMenu(w: Window = window) {
  w.addEventListener("contextmenu", (e) => { if (!keepsNativeMenu(e.target)) e.preventDefault(); });
}
