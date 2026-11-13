// First use tips (V1.55, the developer 12 Nov 2026): gentle, one at a time, while the person uses their list. Each one shows
// once per account, synced (settings.tipsSeen), and never inside the setup menu. Pure: no DOM, no vault, no clock.
// views/Tips.tsx draws them, tips.ts (next to App.tsx) feeds this the live facts. tests/tips.test.ts runs it.
//
// The words are the developer's, short and plain, no dashes. Public build too: nothing here is the developer only.
//
// When one shows (nextTip), all of these hold:
//  - the person has added at least TIPS.minTasks tasks of their own (the made up Example tasks of a new account do
//    not count). Someone updating from an older PS already has them, so they see the tips too, once, after updating.
//  - nothing blocks it right now (blocker): a meeting, Sleep mode, Sentry mode, Do Not Disturb, a screen or pop-up
//    already open (the setup menu and What's new too), typing, 1Password or Signal in front, the list not showing.
//  - the list has been up for TIPS.settleMs, and the last tip was at least TIPS.gapMs ago (spaced out).
//  - the tip has something to point at right now (its target is on the screen).
//  - nobody has already learned it: swiping or clicking a dot by yourself marks that tip as known, silently.

export type TipId = "swipe" | "dots" | "look" | "edit" | "remind";
/** The order they come in. */
export const TIP_ORDER: readonly TipId[] = ["swipe", "dots", "look", "edit", "remind"];

export const TIPS = {
  /** Tasks the person made themselves before the first tip (the developer: "after 2 or 3 tasks"). */
  minTasks: 2,
  /** The list must have been showing this long before a tip appears (a quick look never gets one). */
  settleMs: 6_000,
  /** No key pressed for this long ("never while typing"). */
  typingQuietMs: 4_000,
  /** At least this long between one tip and the next (spaced out, never all at once). */
  gapMs: 60 * 60_000,
  /** The green tick shows this long after the swipe before the tip goes. */
  learnedMs: 1_400,
  /** A tip counts as seen once it has been up this long (or dismissed). Put away sooner, it comes back another time. */
  seenAfterMs: 2_500,
  /** Left alone this long it fades by itself, and counts as seen. */
  autoMs: 30_000,
} as const;

/** The words. Every one is shown to other people, so the developer sees them in the release note (first-use-tips.md). */
export interface TipWords { title: string; line: string; hint?: string }
export const TIP_WORDS: Record<TipId, TipWords> = {
  swipe: { title: "Did you know you can swipe to the right?", line: "Swipe with two fingers on your trackpad to go to your next list page.", hint: "Try it now" },
  dots: { title: "The dots are your pages", line: "Each dot is a page. Click one to jump straight to that page." },
  look: { title: "Every page can look different", line: "Right click a dot or a page's name, then pick Page background or Page look to give that page its own style." },
  edit: { title: "Did you know you can click the Edit button at the top left?", line: "Edit zooms out so you can add pages, move panels and tabs between pages, and put them in a new order." },
  remind: { title: "Right click any task to add a reminder", line: "Pick Add annoying reminder and {app} keeps nudging you about that task until it is done." },
};
/** The phone swipes with one finger, taps and holds. */
export const SWIPE_PHONE = "Swipe with one finger on your list to go to your next list page.";
export const TIP_PHONE: Partial<Record<TipId, string>> = {
  swipe: SWIPE_PHONE,
  dots: "Each dot is a page. Tap one to jump straight to that page.",
  look: "Hold a dot or a page's name, then pick Page background or Page look to give that page its own style.",
};
/** Tips that only make sense with a mouse and the Mac's floating list (Edit mode, the right click menu). */
export const TIPS_NOT_ON_PHONE: readonly TipId[] = ["edit", "remind"];
export const TIP_BUTTON = "Got it";
export const LEARNED = "Nice, you got it";

// ---------- what is saved ----------
/** settings.tipsSeen: when each tip was shown or learned (ISO). `reset` ("Show tips again") makes every older entry not count. */
export interface TipsSeen { at: Partial<Record<TipId, string>>; reset?: string }

const ISO = /^\d{4}-\d\d-\d\dT[\d:.]+Z$/;
const okIso = (v: unknown): v is string => typeof v === "string" && v.length <= 32 && ISO.test(v) && Number.isFinite(Date.parse(v));
export const isTipId = (v: unknown): v is TipId => typeof v === "string" && (TIP_ORDER as readonly string[]).includes(v);

/** Whatever came in, as a clean TipsSeen (an unreadable value is "nothing seen yet"). */
export function cleanTipsSeen(v: unknown): TipsSeen {
  const o = (v && typeof v === "object" ? v : {}) as { at?: unknown; reset?: unknown };
  const at: TipsSeen["at"] = {};
  if (o.at && typeof o.at === "object") for (const id of TIP_ORDER) { const t = (o.at as Record<string, unknown>)[id]; if (okIso(t)) at[id] = t; }
  return okIso(o.reset) ? { at, reset: o.reset } : { at };
}

/** Has this tip been seen (shown or learned) since the last "Show tips again"? */
export function isSeen(s: TipsSeen | null | undefined, id: TipId): boolean {
  const t = s?.at?.[id];
  if (!t) return false;
  return !s?.reset || Date.parse(t) >= Date.parse(s.reset);
}

/** When the newest tip was seen (ms), or 0. */
export function lastSeenMs(s: TipsSeen | null | undefined): number {
  let m = 0;
  for (const id of TIP_ORDER) if (isSeen(s, id)) m = Math.max(m, Date.parse(s!.at[id]!));
  return m;
}

/** Mark a tip seen. Merged with what the vault holds now, so two devices never undo each other. */
export function markSeen(cur: TipsSeen | null | undefined, id: TipId, now: number): TipsSeen {
  const c = cleanTipsSeen(cur);
  return { ...c, at: { ...c.at, [id]: isSeen(c, id) ? c.at[id]! : new Date(now).toISOString() } };
}

/** "Show tips again": every tip counts as new. */
export function resetTips(now: number): TipsSeen {
  return { at: {}, reset: new Date(now).toISOString() };
}

/** Two copies of tipsSeen (two devices): the newest reset wins, then every tip seen after it from either. */
export function mergeTipsSeen(a: unknown, b: unknown): TipsSeen {
  const x = cleanTipsSeen(a), y = cleanTipsSeen(b);
  const reset = [x.reset, y.reset].filter((r): r is string => !!r).sort().pop();
  const at: TipsSeen["at"] = {};
  for (const id of TIP_ORDER) {
    const c = [x.at[id], y.at[id]].filter((t): t is string => !!t && (!reset || Date.parse(t) >= Date.parse(reset))).sort()[0];
    if (c) at[id] = c;
  }
  return reset ? { at, reset } : { at };
}

export const allSeen = (s: TipsSeen | null | undefined) => TIP_ORDER.every((id) => isSeen(s, id));

// ---------- the person's own tasks ----------
/** Tasks the person made: not the Example tasks. `todos` are the todo documents' data. */
export function ownTaskCount(todos: readonly { example?: boolean }[]): number {
  let n = 0;
  for (const t of todos) if (!t?.example) n++;
  return n;
}

// ---------- what is blocking, right now ----------
export interface BlockFacts {
  /** The Tab list is on the screen (not hidden between holds of Tab). */
  listShown: boolean;
  /** The page is visible. */
  pageVisible: boolean;
  /** How long the list has been up, ms. */
  shownForMs: number;
  /** ms since the last key press in the page. */
  sinceKeyMs: number;
  /** A text box, the task editor or a text field has the cursor. */
  typing: boolean;
  /** Any screen, pop-up or menu is open (Settings, Add task, a right click menu...). */
  screenOpen: boolean;
  /** The setup menu or What's new is showing (named on their own: "never inside the setup process"). */
  setupOpen: boolean;
  inMeeting: boolean;
  sleepMode: boolean;
  sentry: boolean;
  dnd: boolean;
  /** 1Password or Signal is in front (the Mac may say so; the page never looks). */
  protectedFront: boolean;
}
export type Blocker = "list" | "page" | "settling" | "keys" | "typing" | "screen" | "setup" | "meeting" | "sleep" | "sentry" | "dnd" | "protected";

/** The first thing in the way, or null. */
export function blocker(f: BlockFacts): Blocker | null {
  if (f.protectedFront) return "protected";
  if (!f.listShown) return "list";
  if (!f.pageVisible) return "page";
  if (f.sleepMode) return "sleep";
  if (f.sentry) return "sentry";
  if (f.dnd) return "dnd";
  if (f.inMeeting) return "meeting";
  if (f.setupOpen) return "setup";
  if (f.screenOpen) return "screen";
  if (f.typing) return "typing";
  if (f.sinceKeyMs < TIPS.typingQuietMs) return "keys";
  if (f.shownForMs < TIPS.settleMs) return "settling";
  return null;
}

/** Blockers that take a tip that is already showing away at once (the others just stop a new one starting). */
export function hidesShowing(b: Blocker | null): boolean {
  return b === "protected" || b === "list" || b === "page" || b === "sleep" || b === "sentry" || b === "dnd" || b === "meeting" || b === "setup" || b === "screen";
}

// ---------- which one next ----------
export interface TipFacts {
  seen: TipsSeen | null | undefined;
  /** The synced settings have arrived (never decide from the copy before the first download). */
  synced: boolean;
  /** An owner's own account (a shared helper view never gets tips). */
  owner: boolean;
  ownTasks: number;
  now: number;
  block: Blocker | null;
  /** Which tips have a target on the screen now. */
  targets: Partial<Record<TipId, boolean>>;
  /** A task reminder already exists. */
  hasReminder: boolean;
}

/** The tip to show now, or null. */
export function nextTip(f: TipFacts): TipId | null {
  if (!f.synced || !f.owner || f.block) return null;
  if (f.ownTasks < TIPS.minTasks) return null;
  if (allSeen(f.seen)) return null;
  const last = lastSeenMs(f.seen);
  if (last && f.now - last < TIPS.gapMs) return null;
  for (const id of TIP_ORDER) {
    if (isSeen(f.seen, id)) continue;
    if (id === "remind" && f.hasReminder) continue;
    if (!f.targets[id]) continue;
    return id;
  }
  return null;
}

/** Tips the person has just shown they know (they did the thing themselves), other than the one showing. */
export function learnedBy(ev: { how?: unknown }, showing: TipId | null): TipId[] {
  const how = ev?.how;
  const out: TipId[] = [];
  if (how === "swipe" || how === "key") out.push("swipe");
  if (how === "dot") out.push("dots");
  return out.filter((id) => id !== showing);
}

// ---------- where the card goes ----------
export interface Rect { x: number; y: number; w: number; h: number }
export type Side = "above" | "below" | "right" | "left" | "bottom";
export interface Placed { x: number; y: number; side: Side; /** the arrow's offset along the card's edge, px (null: no arrow) */ arrow: number | null }

/** Where each tip's card sits: beside what it points at. The swipe tip has nothing to point at, so it rests at the bottom middle. */
export const TIP_SIDES: Record<TipId, Side[]> = {
  swipe: ["bottom"],
  dots: ["above", "below"],
  look: ["above", "below"],
  edit: ["below", "right"],
  remind: ["right", "left", "below", "above"],
};

const GAP = 14, MARGIN = 12, BOTTOM_ROOM = 96;

/** Put a card of `card` size beside `target` on the first side with room, kept inside the screen. Pure. */
export function placeTip(target: Rect | null, card: { w: number; h: number }, vp: { w: number; h: number }, sides: readonly Side[]): Placed {
  const clampX = (x: number) => Math.max(MARGIN, Math.min(vp.w - card.w - MARGIN, x));
  const clampY = (y: number) => Math.max(MARGIN, Math.min(vp.h - card.h - MARGIN, y));
  if (!target || sides[0] === "bottom") return { x: clampX((vp.w - card.w) / 2), y: clampY(vp.h - card.h - BOTTOM_ROOM), side: "bottom", arrow: null };
  const cx = target.x + target.w / 2, cy = target.y + target.h / 2;
  for (const side of sides) {
    if (side === "above" && target.y - GAP - card.h >= MARGIN) { const x = clampX(cx - card.w / 2); return { x, y: target.y - GAP - card.h, side, arrow: cx - x }; }
    if (side === "below" && target.y + target.h + GAP + card.h <= vp.h - MARGIN) { const x = clampX(cx - card.w / 2); return { x, y: target.y + target.h + GAP, side, arrow: cx - x }; }
    if (side === "right" && target.x + target.w + GAP + card.w <= vp.w - MARGIN) { const y = clampY(cy - card.h / 2); return { x: target.x + target.w + GAP, y, side, arrow: cy - y }; }
    if (side === "left" && target.x - GAP - card.w >= MARGIN) { const y = clampY(cy - card.h / 2); return { x: target.x - GAP - card.w, y, side, arrow: cy - y }; }
  }
  return { x: clampX((vp.w - card.w) / 2), y: clampY(vp.h - card.h - BOTTOM_ROOM), side: "bottom", arrow: null };
}
