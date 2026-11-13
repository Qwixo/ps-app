// Who is on the Tab list: a first use tip (views/Tips.tsx) or a "new in this version" pop-up (views/NewPopups.tsx).
// Each looks here before it starts, so the two never show at once. Plain flags, set the moment one starts or goes.
let tip = false, popup = false;
export const setTipOn = (v: boolean) => { tip = v; };
export const setPopupOn = (v: boolean) => { popup = v; };
export const tipOn = () => tip;
export const popupOn = () => popup;

/** The open source link was opened somewhere (an "Open" button, a Settings link): the open source pop-up has nothing to teach.
 *  Kept on this device; the pop-up itself also marks itself seen, and that is what syncs. */
const OPENED = "ps.openSourceOpened";
export function noteSourceOpened() { try { localStorage.setItem(OPENED, "1"); } catch { /* private window */ } }
export function sourceWasOpened(): boolean { try { return localStorage.getItem(OPENED) === "1"; } catch { return false; } }
