// Who is on the Tab list: a first use tip (views/Tips.tsx), a "new in this version" pop-up (views/NewPopups.tsx) or the
// "what is new" walkthrough (views/Walkthrough.tsx, V1.58). Each looks here before it starts, so no two ever show at once.
// Plain flags, set the moment one starts or goes.
let tip = false, popup = false, walk = false, walkWaiting = false;
export const setTipOn = (v: boolean) => { tip = v; };
export const setPopupOn = (v: boolean) => { popup = v; };
export const setWalkOn = (v: boolean) => { walk = v; };
/** The walkthrough has steps left and its gate is open: the V1.56 pop-ups let it go first. */
export const setWalkWaiting = (v: boolean) => { walkWaiting = v; };
export const tipOn = () => tip;
export const popupOn = () => popup;
export const walkOn = () => walk;
export const walkWaitingNow = () => walkWaiting;

/** The open source link was opened somewhere (an "Open" button, a Settings link): the open source pop-up has nothing to teach.
 *  Kept on this device; the pop-up itself also marks itself seen, and that is what syncs. */
const OPENED = "ps.openSourceOpened";
export function noteSourceOpened() { try { localStorage.setItem(OPENED, "1"); } catch { /* private window */ } }
export function sourceWasOpened(): boolean { try { return localStorage.getItem(OPENED) === "1"; } catch { return false; } }
